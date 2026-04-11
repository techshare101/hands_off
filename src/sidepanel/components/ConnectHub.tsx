"use client";
import React, { useState, useEffect } from 'react';
import { Search, Plug, Users, Key, X, CheckCircle, AlertCircle, Loader2, ExternalLink, ChevronRight, Unplug } from 'lucide-react';
import {
  APP_REGISTRY,
  CATEGORY_META,
  getConnectionManager,
  type AppDefinition,
  type AppConnection,
  type ConnectionMethod,
  type AppCategory,
} from '../../agent/connectHub';

interface ConnectHubProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ConnectHub({ isOpen, onClose }: ConnectHubProps) {
  const [search, setSearch] = useState('');
  const [selectedApp, setSelectedApp] = useState<AppDefinition | null>(null);
  const [connections, setConnections] = useState<Map<string, AppConnection>>(new Map());
  const [activeCategory, setActiveCategory] = useState<AppCategory | 'all'>('all');
  const [connecting, setConnecting] = useState(false);
  const [method, setMethod] = useState<ConnectionMethod>('api');
  const [configFields, setConfigFields] = useState<Record<string, string>>({});
  const [connectResult, setConnectResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Load connections on mount
  useEffect(() => {
    if (!isOpen) return;
    const mgr = getConnectionManager();
    mgr.getAllConnections().then(conns => {
      const map = new Map<string, AppConnection>();
      conns.forEach(c => map.set(c.appId, c));
      setConnections(map);
    });
  }, [isOpen]);

  if (!isOpen) return null;

  // Filter apps
  const filtered = APP_REGISTRY.filter(app => {
    const matchSearch = !search || app.name.toLowerCase().includes(search.toLowerCase()) || app.description.toLowerCase().includes(search.toLowerCase());
    const matchCat = activeCategory === 'all' || app.category === activeCategory;
    return matchSearch && matchCat;
  });

  // Group by category
  const categories = [...new Set(APP_REGISTRY.map(a => a.category))];
  const connectedCount = Array.from(connections.values()).filter(c => c.status === 'connected').length;

  const openAppModal = (app: AppDefinition) => {
    setSelectedApp(app);
    setMethod(app.methods[0]);
    setConfigFields({});
    setConnectResult(null);
  };

  const handleConnect = async () => {
    if (!selectedApp) return;
    setConnecting(true);
    setConnectResult(null);
    try {
      const mgr = getConnectionManager();
      const conn = await mgr.connect(selectedApp.id, method, configFields);
      setConnections(prev => new Map(prev).set(selectedApp.id, conn));
      if (conn.status === 'connected') {
        setConnectResult({ ok: true, msg: `${selectedApp.name} connected!` });
      } else {
        setConnectResult({ ok: false, msg: conn.error || 'Connection failed' });
      }
    } catch (e) {
      setConnectResult({ ok: false, msg: e instanceof Error ? e.message : 'Unknown error' });
    }
    setConnecting(false);
  };

  const handleDisconnect = async (appId: string) => {
    const mgr = getConnectionManager();
    await mgr.disconnect(appId);
    setConnections(prev => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
  };

  const getStatusBadge = (appId: string) => {
    const conn = connections.get(appId);
    if (!conn) return null;
    if (conn.status === 'connected') return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">Connected</span>;
    if (conn.status === 'error') return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">Error</span>;
    return null;
  };

  const defaults = selectedApp?.defaults[method];

  const METHOD_ICONS: Record<ConnectionMethod, React.ReactNode> = {
    api: <Key className="w-3.5 h-3.5" />,
    mcp: <Plug className="w-3.5 h-3.5" />,
    a2a: <Users className="w-3.5 h-3.5" />,
  };

  const METHOD_LABELS: Record<ConnectionMethod, string> = {
    api: 'Direct API',
    mcp: 'MCP Server',
    a2a: 'A2A Agent',
  };

  return (
    <div className={`fixed inset-0 z-50 transition-transform duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
      <div className="h-full bg-handoff-darker flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-handoff-dark">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Plug className="w-5 h-5 text-purple-400" />
              Connect Hub
            </h2>
            <p className="text-xs text-handoff-muted">{connectedCount} app{connectedCount !== 1 ? 's' : ''} connected</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-handoff-dark text-handoff-muted hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-handoff-muted w-4 h-4" />
            <input
              type="text"
              placeholder="Search apps..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-handoff-dark text-white placeholder-handoff-muted rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            />
          </div>
        </div>

        {/* Category Tabs */}
        <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveCategory('all')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${activeCategory === 'all' ? 'bg-purple-500/20 text-purple-300' : 'bg-handoff-dark text-handoff-muted hover:text-white'}`}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${activeCategory === cat ? 'bg-purple-500/20 text-purple-300' : 'bg-handoff-dark text-handoff-muted hover:text-white'}`}
            >
              {CATEGORY_META[cat].icon} {CATEGORY_META[cat].label}
            </button>
          ))}
        </div>

        {/* App Grid */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
          {filtered.map(app => {
            const conn = connections.get(app.id);
            const isConnected = conn?.status === 'connected';
            return (
              <div
                key={app.id}
                className={`flex items-center justify-between p-3 rounded-xl border transition-colors cursor-pointer ${
                  isConnected
                    ? 'bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40'
                    : 'bg-handoff-dark/50 border-handoff-dark hover:border-purple-500/30'
                }`}
                onClick={() => openAppModal(app)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-2xl flex-shrink-0">{app.icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white truncate">{app.name}</h3>
                      {getStatusBadge(app.id)}
                    </div>
                    <p className="text-[11px] text-handoff-muted truncate">{app.description}</p>
                    <div className="flex gap-1 mt-1">
                      {app.methods.map(m => (
                        <span key={m} className="text-[9px] px-1.5 py-0.5 rounded bg-handoff-dark text-handoff-muted">
                          {METHOD_LABELS[m]}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  {isConnected && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDisconnect(app.id); }}
                      className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                      title="Disconnect"
                    >
                      <Unplug className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <ChevronRight className="w-4 h-4 text-handoff-muted" />
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="text-center py-8 text-handoff-muted text-sm">
              No apps found matching "{search}"
            </div>
          )}
        </div>

        {/* Connection Modal */}
        {selectedApp && (
          <div className="fixed inset-0 z-60 bg-black/60 flex items-center justify-center p-4" onClick={() => setSelectedApp(null)}>
            <div className="bg-handoff-darker rounded-2xl w-full max-w-sm border border-handoff-dark shadow-2xl" onClick={e => e.stopPropagation()}>
              {/* Modal Header */}
              <div className="flex items-center gap-3 p-4 border-b border-handoff-dark">
                <span className="text-3xl">{selectedApp.icon}</span>
                <div>
                  <h3 className="text-base font-bold text-white">{selectedApp.name}</h3>
                  <p className="text-xs text-handoff-muted">{selectedApp.description}</p>
                </div>
              </div>

              {/* Method Tabs */}
              {selectedApp.methods.length > 1 && (
                <div className="flex gap-1 p-3 pb-0">
                  {selectedApp.methods.map(m => (
                    <button
                      key={m}
                      onClick={() => { setMethod(m); setConfigFields({}); setConnectResult(null); }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        method === m ? 'bg-purple-500/20 text-purple-300' : 'bg-handoff-dark text-handoff-muted hover:text-white'
                      }`}
                    >
                      {METHOD_ICONS[m]} {METHOD_LABELS[m]}
                    </button>
                  ))}
                </div>
              )}

              {/* Config Form */}
              <div className="p-4 space-y-3">
                {defaults?.description && (
                  <p className="text-xs text-handoff-muted">{defaults.description}</p>
                )}

                {/* MCP endpoint input */}
                {method === 'mcp' && (
                  <div>
                    <label className="text-xs text-handoff-muted mb-1 block">MCP Server URL or Command</label>
                    <input
                      type="text"
                      value={configFields.endpoint || defaults?.endpoint || ''}
                      onChange={e => setConfigFields(prev => ({ ...prev, endpoint: e.target.value }))}
                      placeholder={defaults?.endpoint || 'http://localhost:3000/mcp'}
                      className="w-full bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    />
                  </div>
                )}

                {/* A2A endpoint input */}
                {method === 'a2a' && (
                  <div>
                    <label className="text-xs text-handoff-muted mb-1 block">Agent Endpoint URL</label>
                    <input
                      type="text"
                      value={configFields.endpoint || ''}
                      onChange={e => setConfigFields(prev => ({ ...prev, endpoint: e.target.value }))}
                      placeholder="https://agent.example.com/.well-known/agent.json"
                      className="w-full bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    />
                  </div>
                )}

                {/* API Key input */}
                {(defaults?.authType === 'api_key' || defaults?.authType === 'oauth') && (
                  <div>
                    <label className="text-xs text-handoff-muted mb-1 block">{defaults.keyLabel || 'API Key'}</label>
                    <input
                      type="password"
                      value={configFields.apiKey || ''}
                      onChange={e => setConfigFields(prev => ({ ...prev, apiKey: e.target.value }))}
                      placeholder={defaults.keyPlaceholder || 'Paste your key...'}
                      className="w-full bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    />
                    {defaults.keyLink && (
                      <a
                        href={defaults.keyLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-purple-400 hover:text-purple-300 mt-1 inline-flex items-center gap-1"
                      >
                        Get your key <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                )}

                {/* Capabilities */}
                {defaults?.tools && defaults.tools.length > 0 && (
                  <div>
                    <label className="text-xs text-handoff-muted mb-1 block">Capabilities</label>
                    <div className="flex flex-wrap gap-1">
                      {defaults.tools.map(tool => (
                        <span key={tool} className="text-[10px] px-2 py-0.5 rounded-full bg-handoff-dark text-handoff-muted">
                          {tool.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Result */}
                {connectResult && (
                  <div className={`flex items-center gap-2 p-2 rounded-lg text-xs ${
                    connectResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                  }`}>
                    {connectResult.ok ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    {connectResult.msg}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex justify-end gap-2 p-4 pt-0">
                <button
                  onClick={() => setSelectedApp(null)}
                  className="px-4 py-2 text-sm text-handoff-muted hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConnect}
                  disabled={connecting}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/50 text-white rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {connecting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting...</> : 'Connect'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
