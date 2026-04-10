import { useState, useEffect } from 'react';
import { X, Key, Save, Check, Eye, Brain, Globe, Video, FileDown, Plug, Plus, Trash2, Share2 } from 'lucide-react';
import { OPENROUTER_VISION_MODELS } from '../../agent/openRouterClient';
import { ROUTELLM_MODELS } from '../../agent/routeLLMClient';
import { OPENAI_MODELS, GROQ_MODELS, DEEPSEEK_MODELS, QWEN_MODELS, MISTRAL_MODELS } from '../../agent/openAICompatClient';
import { ANTHROPIC_MODELS } from '../../agent/anthropicClient';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

type LLMProvider = 'gemini' | 'openrouter' | 'routellm' | 'openai' | 'anthropic' | 'groq' | 'deepseek' | 'qwen' | 'mistral';

const PROVIDERS: { id: LLMProvider; label: string; icon: string; color: string }[] = [
  { id: 'gemini', label: 'Gemini', icon: '\uD83D\uDD37', color: 'blue' },
  { id: 'openai', label: 'OpenAI', icon: '\uD83D\uDFE2', color: 'green' },
  { id: 'anthropic', label: 'Claude', icon: '\uD83D\uDFE0', color: 'orange' },
  { id: 'groq', label: 'Groq', icon: '\u26A1', color: 'yellow' },
  { id: 'deepseek', label: 'DeepSeek', icon: '\uD83D\uDD35', color: 'indigo' },
  { id: 'qwen', label: 'Qwen', icon: '\uD83C\uDDE8\uD83C\uDDF3', color: 'purple' },
  { id: 'mistral', label: 'Mistral', icon: '\uD83C\uDF0A', color: 'cyan' },
  { id: 'openrouter', label: 'OpenRouter', icon: '\uD83C\uDF10', color: 'pink' },
  { id: 'routellm', label: 'RouteLLM', icon: '\uD83D\uDEE4\uFE0F', color: 'gray' },
];

interface ProviderMeta {
  storageKey: string;
  modelStorageKey: string;
  placeholder: string;
  link: string;
  linkLabel: string;
  models?: { id: string; name: string; description?: string; provider?: string }[];
}

const PROVIDER_META: Record<LLMProvider, ProviderMeta> = {
  gemini:     { storageKey: 'geminiApiKey',    modelStorageKey: '',              placeholder: 'AIza...', link: 'https://aistudio.google.com/apikey', linkLabel: 'Google AI Studio', models: undefined },
  openai:     { storageKey: 'openaiApiKey',    modelStorageKey: 'openaiModel',    placeholder: 'sk-proj-...', link: 'https://platform.openai.com/api-keys', linkLabel: 'OpenAI', models: OPENAI_MODELS },
  anthropic:  { storageKey: 'anthropicApiKey', modelStorageKey: 'anthropicModel', placeholder: 'sk-ant-...', link: 'https://console.anthropic.com/settings/keys', linkLabel: 'Anthropic', models: ANTHROPIC_MODELS },
  groq:       { storageKey: 'groqApiKey',      modelStorageKey: 'groqModel',      placeholder: 'gsk_...', link: 'https://console.groq.com/keys', linkLabel: 'Groq', models: GROQ_MODELS },
  deepseek:   { storageKey: 'deepseekApiKey',  modelStorageKey: 'deepseekModel',  placeholder: 'sk-...', link: 'https://platform.deepseek.com/api_keys', linkLabel: 'DeepSeek', models: DEEPSEEK_MODELS },
  qwen:       { storageKey: 'qwenApiKey',      modelStorageKey: 'qwenModel',      placeholder: 'sk-...', link: 'https://dashscope.console.aliyun.com/apiKey', linkLabel: 'DashScope', models: QWEN_MODELS },
  mistral:    { storageKey: 'mistralApiKey',   modelStorageKey: 'mistralModel',   placeholder: '...', link: 'https://console.mistral.ai/api-keys', linkLabel: 'Mistral', models: MISTRAL_MODELS },
  openrouter: { storageKey: 'openRouterApiKey', modelStorageKey: 'openRouterModel', placeholder: 'sk-or-...', link: 'https://openrouter.ai/keys', linkLabel: 'OpenRouter', models: OPENROUTER_VISION_MODELS },
  routellm:   { storageKey: 'routeLLMApiKey',  modelStorageKey: 'routeLLMModel',  placeholder: '...', link: 'https://routellm.ai', linkLabel: 'RouteLLM', models: ROUTELLM_MODELS },
};

export default function Settings({ isOpen, onClose }: SettingsProps) {
  const [provider, setProvider] = useState<LLMProvider>('gemini');
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [models, setModels] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [arkEnabled, setArkEnabled] = useState(false);
  const [arkEndpoint, setArkEndpoint] = useState('http://127.0.0.1:11434');
  const [arkModel, setArkModel] = useState('gemma4:e4b');
  const [arkStatus, setArkStatus] = useState<'unknown' | 'checking' | 'online' | 'offline'>('unknown');
  const [hfToken, setHfToken] = useState('');
  const [hfEnabled, setHfEnabled] = useState(false);
  const [hfStatus, setHfStatus] = useState<'unknown' | 'checking' | 'online' | 'offline'>('unknown');

  // API Tool state
  const [apiEnabled, setApiEnabled] = useState(false);
  const [apiDomains, setApiDomains] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState('');

  // Skill Recorder state
  const [recorderEnabled, setRecorderEnabled] = useState(true);

  // File Tool state
  const [fileToolEnabled, setFileToolEnabled] = useState(true);

  // MCP Server state
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [mcpAuthRequired, setMcpAuthRequired] = useState(false);
  const [mcpAuthToken, setMcpAuthToken] = useState('');
  const [mcpOrigins, setMcpOrigins] = useState<string[]>([]);
  const [newOrigin, setNewOrigin] = useState('');

  // MCP Client state (connect TO external MCP servers)
  const [mcpClientServers, setMcpClientServers] = useState<{id: string; name: string; url: string; enabled: boolean}[]>([]);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpUrl, setNewMcpUrl] = useState('');
  const [newMcpApiKey, setNewMcpApiKey] = useState('');
  const [mcpClientTestResult, setMcpClientTestResult] = useState<string | null>(null);

  // A2A state (connect to remote agents)
  const [a2aAgents, setA2aAgents] = useState<{id: string; endpoint: string; card: {name: string; description: string; capabilities: {id: string; name: string}[]}}[]>([]);
  const [newA2aEndpoint, setNewA2aEndpoint] = useState('');
  const [newA2aApiKey, setNewA2aApiKey] = useState('');
  const [a2aTestResult, setA2aTestResult] = useState<string | null>(null);

  // Test states
  const [apiTestResult, setApiTestResult] = useState<string | null>(null);
  const [fileTestResult, setFileTestResult] = useState<string | null>(null);
  const [recorderTestResult, setRecorderTestResult] = useState<string | null>(null);
  const [mcpTestResult, setMcpTestResult] = useState<string | null>(null);

  useEffect(() => {
    const allStorageKeys = ['llmProvider', 'ark_enabled', 'ark_endpoint', 'ark_model', 'hf_api_token', 'hf_enabled', 'handoff_api_tool_config', 'handoff_mcp_config', 'handoff_mcp_client_config', 'handoff_a2a_config'];
    Object.values(PROVIDER_META).forEach(m => {
      allStorageKeys.push(m.storageKey);
      if (m.modelStorageKey) allStorageKeys.push(m.modelStorageKey);
    });
    chrome.storage.local.get(allStorageKeys).then((result) => {
      if (result.llmProvider) setProvider(result.llmProvider);
      if (result.ark_enabled) setArkEnabled(result.ark_enabled);
      if (result.ark_endpoint) setArkEndpoint(result.ark_endpoint);
      if (result.ark_model) setArkModel(result.ark_model);
      if (result.hf_api_token) setHfToken(result.hf_api_token);
      if (result.hf_enabled) setHfEnabled(result.hf_enabled);
      if (result.handoff_api_tool_config) {
        const apiCfg = result.handoff_api_tool_config;
        setApiEnabled(apiCfg.enabled ?? false);
        setApiDomains(apiCfg.allowedDomains ?? []);
      }
      if (result.handoff_mcp_config) {
        const mcpCfg = result.handoff_mcp_config;
        setMcpEnabled(mcpCfg.enabled ?? false);
        setMcpAuthRequired(mcpCfg.requireAuth ?? false);
        setMcpAuthToken(mcpCfg.authToken ?? '');
        setMcpOrigins(mcpCfg.allowedOrigins ?? []);
      }
      if (result.handoff_mcp_client_config) {
        setMcpClientServers(result.handoff_mcp_client_config || []);
      }
      if (result.handoff_a2a_config?.remoteAgents) {
        setA2aAgents(result.handoff_a2a_config.remoteAgents || []);
      }
      const loadedKeys: Record<string, string> = {};
      const loadedModels: Record<string, string> = {};
      Object.entries(PROVIDER_META).forEach(([, meta]) => {
        if (result[meta.storageKey]) loadedKeys[meta.storageKey] = result[meta.storageKey];
        if (meta.modelStorageKey && result[meta.modelStorageKey]) loadedModels[meta.modelStorageKey] = result[meta.modelStorageKey];
      });
      setKeys(loadedKeys);
      setModels(loadedModels);
    });
  }, []);

  const handleSave = async () => {
    const data: Record<string, unknown> = {
      llmProvider: provider,
      ark_enabled: arkEnabled,
      ark_endpoint: arkEndpoint,
      ark_model: arkModel,
      hf_api_token: hfToken,
      hf_enabled: hfEnabled,
      ...keys,
      ...models,
    };
    await chrome.storage.local.set(data);

    // Save API Tool config
    await chrome.runtime.sendMessage({ type: 'API_SET_CONFIG', payload: { enabled: apiEnabled, allowedDomains: apiDomains } });

    // Save MCP Server config
    await chrome.runtime.sendMessage({ type: 'MCP_SET_CONFIG', payload: { enabled: mcpEnabled, requireAuth: mcpAuthRequired, authToken: mcpAuthToken, allowedOrigins: mcpOrigins } });

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const checkArkServer = async () => {
    setArkStatus('checking');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'ARK_HEALTH_CHECK', payload: { endpoint: arkEndpoint } });
      setArkStatus(res?.available ? 'online' : 'offline');
    } catch {
      setArkStatus('offline');
    }
    setTimeout(() => setArkStatus('unknown'), 5000);
  };

  const checkHFConnection = async () => {
    setHfStatus('checking');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'HF_TEST_CONNECTION', payload: { token: hfToken } });
      if (res?.available) {
        setHfStatus('online');
      } else {
        console.warn('[HF Test] Failed:', res?.error);
        setHfStatus('offline');
      }
    } catch (e) {
      console.warn('[HF Test] Error:', e);
      setHfStatus('offline');
    }
    setTimeout(() => setHfStatus('unknown'), 8000);
  };

  const meta = PROVIDER_META[provider];
  const currentKey = keys[meta.storageKey] || '';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-handoff-surface rounded-2xl w-full max-w-md mx-4 overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-handoff-dark">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-handoff-dark rounded-lg transition-colors">
            <X className="w-5 h-5 text-handoff-muted" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Provider Grid */}
          <div>
            <label className="block text-sm font-medium text-white mb-2">LLM Provider</label>
            <div className="grid grid-cols-3 gap-1.5">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setProvider(p.id)}
                  className={`py-2 px-2 rounded-lg text-xs font-medium transition-colors text-center ${
                    provider === p.id
                      ? 'bg-handoff-primary text-white'
                      : 'bg-handoff-dark text-handoff-muted hover:text-white'
                  }`}
                >
                  <span className="mr-1">{p.icon}</span>{p.label}
                </button>
              ))}
            </div>
          </div>

          {/* API Key Input */}
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4" />
                {PROVIDERS.find(p => p.id === provider)?.label} API Key
              </div>
            </label>
            <input
              type="password"
              value={currentKey}
              onChange={(e) => setKeys({ ...keys, [meta.storageKey]: e.target.value })}
              placeholder={meta.placeholder}
              className="w-full bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-handoff-primary/50"
            />
            <p className="text-xs text-handoff-muted mt-2">
              Get your key from{' '}
              <a href={meta.link} target="_blank" rel="noopener noreferrer" className="text-handoff-primary hover:underline">
                {meta.linkLabel}
              </a>
            </p>
          </div>

          {/* Model Selector */}
          {meta.models && meta.modelStorageKey && (
            <div>
              <label className="block text-sm font-medium text-white mb-2">Model</label>
              <select
                value={models[meta.modelStorageKey] || meta.models[0]?.id || ''}
                onChange={(e) => setModels({ ...models, [meta.modelStorageKey]: e.target.value })}
                className="w-full bg-handoff-dark text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-handoff-primary/50"
              >
                {meta.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}{model.description ? ` — ${model.description}` : ''}{(model as any).provider ? ` (${(model as any).provider})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Ark Vision Engine (Ollama) */}
          <div className="border-t border-handoff-dark pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-white flex items-center gap-2">
                <Eye className="w-4 h-4 text-purple-400" />
                Ark Vision Engine
              </label>
              <button
                onClick={() => setArkEnabled(!arkEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${arkEnabled ? 'bg-emerald-500' : 'bg-handoff-dark'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${arkEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <p className="text-xs text-handoff-muted mb-3">
              Local vision engine via Ollama. Uses multimodal models (Gemma4, LLaVA, Molmo) for screenshot analysis. Falls back to selected LLM if unreachable.
            </p>
            {arkEnabled && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={arkEndpoint}
                    onChange={(e) => setArkEndpoint(e.target.value)}
                    placeholder="http://127.0.0.1:11434"
                    className="flex-1 bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                  <button
                    onClick={checkArkServer}
                    disabled={arkStatus === 'checking'}
                    className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                      arkStatus === 'online' ? 'bg-emerald-500/20 text-emerald-400' :
                      arkStatus === 'offline' ? 'bg-red-500/20 text-red-400' :
                      arkStatus === 'checking' ? 'bg-purple-500/20 text-purple-400 animate-pulse' :
                      'bg-handoff-dark text-handoff-muted hover:text-white'
                    }`}
                  >
                    {arkStatus === 'checking' ? 'Testing...' :
                     arkStatus === 'online' ? 'Online' :
                     arkStatus === 'offline' ? 'Offline' : 'Test'}
                  </button>
                </div>
                <input
                  type="text"
                  value={arkModel}
                  onChange={(e) => setArkModel(e.target.value)}
                  placeholder="gemma4:e4b"
                  className="w-full bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                />
                <p className="text-[10px] text-handoff-muted">Model name from Ollama (e.g. gemma4:e4b, llava, moondream)</p>
              </div>
            )}
          </div>

          {/* HuggingFace Vision */}
          <div className="border-t border-handoff-dark pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-white flex items-center gap-2">
                <Brain className="w-4 h-4 text-amber-400" />
                HuggingFace Vision
              </label>

              <button
                onClick={() => setHfEnabled(!hfEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${hfEnabled ? 'bg-emerald-500' : 'bg-handoff-dark'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${hfEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <p className="text-xs text-handoff-muted mb-3">
              ML-powered element detection, OCR, and semantic skill matching via HuggingFace Inference API.
            </p>
            {hfEnabled && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={hfToken}
                    onChange={(e) => setHfToken(e.target.value)}
                    placeholder="hf_..."
                    className="flex-1 bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  />
                  <button
                    onClick={checkHFConnection}
                    disabled={hfStatus === 'checking' || !hfToken.trim()}
                    className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                      hfStatus === 'online' ? 'bg-emerald-500/20 text-emerald-400' :
                      hfStatus === 'offline' ? 'bg-red-500/20 text-red-400' :
                      hfStatus === 'checking' ? 'bg-amber-500/20 text-amber-400 animate-pulse' :
                      'bg-handoff-dark text-handoff-muted hover:text-white'
                    }`}
                  >
                    {hfStatus === 'checking' ? 'Testing (may take ~15s)...' :
                     hfStatus === 'online' ? 'Connected' :
                     hfStatus === 'offline' ? 'Failed' : 'Test'}
                  </button>
                </div>
                <p className="text-[10px] text-handoff-muted">
                  Get your free token from <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">huggingface.co/settings/tokens</a>
                </p>
              </div>
            )}
          </div>

          {/* ── API Tool ──────────────────────────────────── */}
          <div className="border-t border-handoff-dark pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-white flex items-center gap-2">
                <Globe className="w-4 h-4 text-sky-400" />
                API Tool
              </label>
              <button
                onClick={() => setApiEnabled(!apiEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${apiEnabled ? 'bg-emerald-500' : 'bg-handoff-dark'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${apiEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <p className="text-xs text-handoff-muted mb-3">
              Call external REST APIs (Stripe, Slack, webhooks). Requires domain whitelist for security.
            </p>
            {apiEnabled && (
              <div className="space-y-2">
                <label className="block text-xs text-handoff-muted">Allowed Domains</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    placeholder="e.g. api.stripe.com"
                    className="flex-1 bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newDomain.trim()) {
                        setApiDomains([...apiDomains, newDomain.trim().toLowerCase()]);
                        setNewDomain('');
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (newDomain.trim()) {
                        setApiDomains([...apiDomains, newDomain.trim().toLowerCase()]);
                        setNewDomain('');
                      }
                    }}
                    className="px-3 py-2 rounded-xl text-xs font-medium bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                {apiDomains.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {apiDomains.map((d, i) => (
                      <span key={i} className="flex items-center gap-1 bg-handoff-dark text-xs text-sky-300 px-2 py-1 rounded-lg">
                        {d}
                        <button onClick={() => setApiDomains(apiDomains.filter((_, j) => j !== i))} className="text-handoff-muted hover:text-red-400">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {apiDomains.length === 0 && (
                  <p className="text-[10px] text-amber-400">No domains whitelisted. Agent cannot make API calls until you add one.</p>
                )}
                {apiDomains.length > 0 && (
                  <button
                    onClick={async () => {
                      setApiTestResult('testing...');
                      try {
                        // Save config first so the domain is whitelisted
                        await chrome.runtime.sendMessage({ type: 'API_SET_CONFIG', payload: { enabled: true, allowedDomains: apiDomains } });
                        const testDomain = apiDomains[0];
                        const testUrl = testDomain.includes('jsonplaceholder') ? 'https://jsonplaceholder.typicode.com/posts/1'
                          : testDomain.includes('httpbin') ? 'https://httpbin.org/get'
                          : `https://${testDomain}`;
                        const res = await chrome.runtime.sendMessage({ type: 'API_EXECUTE', payload: { method: 'GET', url: testUrl, timeout: 10000 } });
                        if (res?.result?.success) {
                          setApiTestResult(`${res.result.status} OK (${res.result.latencyMs}ms)`);
                        } else {
                          setApiTestResult(`Failed: ${res?.result?.error || 'Unknown error'}`);
                        }
                      } catch (e: any) {
                        setApiTestResult(`Error: ${e.message}`);
                      }
                      setTimeout(() => setApiTestResult(null), 6000);
                    }}
                    className={`mt-2 w-full py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      apiTestResult?.includes('OK') ? 'bg-emerald-500/20 text-emerald-400' :
                      apiTestResult?.includes('Failed') || apiTestResult?.includes('Error') ? 'bg-red-500/20 text-red-400' :
                      apiTestResult === 'testing...' ? 'bg-sky-500/20 text-sky-400 animate-pulse' :
                      'bg-sky-500/10 text-sky-400 hover:bg-sky-500/20'
                    }`}
                  >
                    {apiTestResult || `Test API call to ${apiDomains[0]}`}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Skill Recorder ────────────────────────────── */}
          <div className="border-t border-handoff-dark pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-white flex items-center gap-2">
                <Video className="w-4 h-4 text-rose-400" />
                Skill Recorder
              </label>
              <button
                onClick={() => setRecorderEnabled(!recorderEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${recorderEnabled ? 'bg-emerald-500' : 'bg-handoff-dark'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${recorderEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <p className="text-xs text-handoff-muted mb-1">
              Record browser actions and replay them as reusable skills. Manage recordings in the Learning tab.
            </p>
            {recorderEnabled && (
              <div className="mt-2 space-y-2">
                <p className="text-[10px] text-emerald-400">Active — Use the Learning tab to start/stop recordings and install templates.</p>
                <button
                  onClick={async () => {
                    setRecorderTestResult('installing...');
                    try {
                      const res = await chrome.runtime.sendMessage({ type: 'RECORDER_INSTALL_TEMPLATE', payload: { templateId: 'tpl_google_search' } });
                      if (res?.success) {
                        setRecorderTestResult(`Installed: ${res.skill?.name || 'Google Search'}`);
                      } else {
                        setRecorderTestResult(`Failed: ${res?.error}`);
                      }
                    } catch (e: any) {
                      setRecorderTestResult(`Error: ${e.message}`);
                    }
                    setTimeout(() => setRecorderTestResult(null), 5000);
                  }}
                  className={`w-full py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    recorderTestResult?.includes('Installed') ? 'bg-emerald-500/20 text-emerald-400' :
                    recorderTestResult?.includes('Failed') || recorderTestResult?.includes('Error') ? 'bg-red-500/20 text-red-400' :
                    recorderTestResult === 'installing...' ? 'bg-rose-500/20 text-rose-400 animate-pulse' :
                    'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20'
                  }`}
                >
                  {recorderTestResult || 'Install "Google Search" skill template'}
                </button>
              </div>
            )}
          </div>

          {/* ── File Tool ─────────────────────────────────── */}
          <div className="border-t border-handoff-dark pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-white flex items-center gap-2">
                <FileDown className="w-4 h-4 text-teal-400" />
                File Generator
              </label>
              <button
                onClick={() => setFileToolEnabled(!fileToolEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${fileToolEnabled ? 'bg-emerald-500' : 'bg-handoff-dark'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${fileToolEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <p className="text-xs text-handoff-muted mb-1">
              Generate and download files: JSON, CSV, HTML reports, Markdown, code files.
            </p>
            {fileToolEnabled && (
              <div className="mt-2 space-y-2">
                <p className="text-[10px] text-emerald-400">Active — Agent can generate and save files to your Downloads folder.</p>
                <button
                  onClick={async () => {
                    setFileTestResult('generating...');
                    try {
                      const res = await chrome.runtime.sendMessage({
                        type: 'FILE_EXPORT_HTML',
                        payload: {
                          title: 'HandOff Test Report',
                          bodyContent: `
                            <h2>File Generator Works!</h2>
                            <p>This report was generated by HandOff's File Tool at <strong>${new Date().toLocaleString()}</strong>.</p>
                            <table>
                              <tr><th>Tool</th><th>Status</th></tr>
                              <tr><td>API Tool</td><td>Ready</td></tr>
                              <tr><td>Skill Recorder</td><td>Ready</td></tr>
                              <tr><td>File Generator</td><td>Active</td></tr>
                              <tr><td>MCP Server</td><td>Ready</td></tr>
                            </table>
                            <p>Check your <strong>Downloads</strong> folder for this file.</p>
                          `,
                          filename: 'handoff-test-report.html',
                        },
                      });
                      if (res?.result?.success) {
                        setFileTestResult('Downloaded! Check your Downloads folder');
                      } else {
                        setFileTestResult(`Failed: ${res?.result?.error || 'Unknown error'}`);
                      }
                    } catch (e: any) {
                      setFileTestResult(`Error: ${e.message}`);
                    }
                    setTimeout(() => setFileTestResult(null), 6000);
                  }}
                  className={`w-full py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    fileTestResult?.includes('Downloaded') ? 'bg-emerald-500/20 text-emerald-400' :
                    fileTestResult?.includes('Failed') || fileTestResult?.includes('Error') ? 'bg-red-500/20 text-red-400' :
                    fileTestResult === 'generating...' ? 'bg-teal-500/20 text-teal-400 animate-pulse' :
                    'bg-teal-500/10 text-teal-400 hover:bg-teal-500/20'
                  }`}
                >
                  {fileTestResult || 'Generate test HTML report'}
                </button>
              </div>
            )}
          </div>

          {/* ── MCP Client (Connect to external servers) ───── */}
          <div className="border-t border-handoff-dark pt-4">
            <label className="text-sm font-medium text-white flex items-center gap-2 mb-2">
              <Globe className="w-4 h-4 text-cyan-400" />
              MCP Client
            </label>
            <p className="text-xs text-handoff-muted mb-3">
              Connect to external MCP servers (LearnForge, custom tools). The agent can discover and use their tools.
            </p>
            <div className="space-y-3">
              {mcpClientServers.map((srv) => (
                <div key={srv.id} className="flex items-center gap-2 bg-handoff-dark rounded-xl p-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white font-medium truncate">{srv.name}</div>
                    <div className="text-[10px] text-handoff-muted truncate">{srv.url}</div>
                  </div>
                  <button
                    onClick={async () => {
                      setMcpClientTestResult(`Pinging ${srv.name}...`);
                      try {
                        const res = await chrome.runtime.sendMessage({ type: 'MCP_CLIENT_PING', payload: { serverId: srv.id } });
                        if (res?.success && res.result) {
                          setMcpClientTestResult(`${srv.name}: connected!`);
                        } else {
                          setMcpClientTestResult(`${srv.name}: failed`);
                        }
                      } catch (e: any) {
                        setMcpClientTestResult(`Error: ${e.message}`);
                      }
                      setTimeout(() => setMcpClientTestResult(null), 4000);
                    }}
                    className="px-2 py-1 rounded-lg text-[10px] bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30"
                  >Ping</button>
                  <button
                    onClick={async () => {
                      setMcpClientTestResult(`Discovering tools on ${srv.name}...`);
                      try {
                        const res = await chrome.runtime.sendMessage({ type: 'MCP_CLIENT_DISCOVER_TOOLS', payload: { serverId: srv.id } });
                        if (res?.success && res.result) {
                          setMcpClientTestResult(`${srv.name}: ${res.result.length} tool(s) found`);
                        } else {
                          setMcpClientTestResult(`${srv.name}: no tools`);
                        }
                      } catch (e: any) {
                        setMcpClientTestResult(`Error: ${e.message}`);
                      }
                      setTimeout(() => setMcpClientTestResult(null), 5000);
                    }}
                    className="px-2 py-1 rounded-lg text-[10px] bg-violet-500/20 text-violet-400 hover:bg-violet-500/30"
                  >Tools</button>
                  <button
                    onClick={async () => {
                      await chrome.runtime.sendMessage({ type: 'MCP_CLIENT_REMOVE_SERVER', payload: { serverId: srv.id } });
                      setMcpClientServers(mcpClientServers.filter(s => s.id !== srv.id));
                    }}
                    className="text-handoff-muted hover:text-red-400"
                  ><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <div className="space-y-2">
                <input
                  type="text"
                  value={newMcpName}
                  onChange={(e) => setNewMcpName(e.target.value)}
                  placeholder="Server name (e.g. LearnForge)"
                  className="w-full bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
                <input
                  type="text"
                  value={newMcpUrl}
                  onChange={(e) => setNewMcpUrl(e.target.value)}
                  placeholder="https://example.com/api/mcp"
                  className="w-full bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={newMcpApiKey}
                    onChange={(e) => setNewMcpApiKey(e.target.value)}
                    placeholder="API key (optional)"
                    className="flex-1 bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                  <button
                    onClick={async () => {
                      if (!newMcpName.trim() || !newMcpUrl.trim()) return;
                      try {
                        const res = await chrome.runtime.sendMessage({
                          type: 'MCP_CLIENT_ADD_SERVER',
                          payload: {
                            name: newMcpName.trim(),
                            url: newMcpUrl.trim(),
                            transport: 'http',
                            enabled: true,
                            ...(newMcpApiKey.trim() ? { apiKey: newMcpApiKey.trim() } : {}),
                          },
                        });
                        if (res?.success && res.result) {
                          setMcpClientServers([...mcpClientServers, res.result]);
                          setNewMcpName('');
                          setNewMcpUrl('');
                          setNewMcpApiKey('');
                          setMcpClientTestResult('Server added!');
                          setTimeout(() => setMcpClientTestResult(null), 3000);
                        }
                      } catch (e: any) {
                        setMcpClientTestResult(`Error: ${e.message}`);
                        setTimeout(() => setMcpClientTestResult(null), 4000);
                      }
                    }}
                    className="px-3 py-2 rounded-xl text-xs font-medium bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {mcpClientTestResult && (
                <div className={`text-xs py-1.5 px-3 rounded-lg text-center ${
                  mcpClientTestResult.includes('connected') || mcpClientTestResult.includes('found') || mcpClientTestResult.includes('added')
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : mcpClientTestResult.includes('Error') || mcpClientTestResult.includes('failed')
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-cyan-500/20 text-cyan-400 animate-pulse'
                }`}>
                  {mcpClientTestResult}
                </div>
              )}
            </div>
          </div>

          {/* ── A2A Agent-to-Agent ─────────────────────────── */}
          <div className="border-t border-handoff-dark pt-4">
            <label className="text-sm font-medium text-white flex items-center gap-2 mb-2">
              <Share2 className="w-4 h-4 text-orange-400" />
              A2A Agents
            </label>
            <p className="text-xs text-handoff-muted mb-3">
              Connect to remote AI agents. HandOff can delegate entire tasks to them (e.g. &quot;Create a course on LearnForge&quot;).
            </p>
            <div className="space-y-3">
              {a2aAgents.map((agent) => (
                <div key={agent.id} className="bg-handoff-dark rounded-xl p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs text-white font-medium">{agent.card?.name || 'Unknown'}</div>
                    <button
                      onClick={async () => {
                        await chrome.runtime.sendMessage({ type: 'A2A_REMOVE_AGENT', payload: { agentId: agent.id } });
                        setA2aAgents(a2aAgents.filter(a => a.id !== agent.id));
                      }}
                      className="text-handoff-muted hover:text-red-400"
                    ><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  <div className="text-[10px] text-handoff-muted truncate mb-1">{agent.endpoint}</div>
                  {agent.card?.capabilities?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {agent.card.capabilities.slice(0, 4).map((cap) => (
                        <span key={cap.id} className="text-[9px] bg-orange-500/10 text-orange-400 px-1.5 py-0.5 rounded">{cap.name}</span>
                      ))}
                      {agent.card.capabilities.length > 4 && (
                        <span className="text-[9px] text-handoff-muted">+{agent.card.capabilities.length - 4} more</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div className="space-y-2">
                <input
                  type="text"
                  value={newA2aEndpoint}
                  onChange={(e) => setNewA2aEndpoint(e.target.value)}
                  placeholder="Agent endpoint (e.g. https://app.com/api/a2a)"
                  className="w-full bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={newA2aApiKey}
                    onChange={(e) => setNewA2aApiKey(e.target.value)}
                    placeholder="API key (optional)"
                    className="flex-1 bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                  />
                  <button
                    onClick={async () => {
                      if (!newA2aEndpoint.trim()) return;
                      setA2aTestResult('Discovering agent...');
                      try {
                        const discoverRes = await chrome.runtime.sendMessage({
                          type: 'A2A_DISCOVER_AGENT',
                          payload: { endpoint: newA2aEndpoint.trim(), apiKey: newA2aApiKey.trim() || undefined },
                        });
                        if (discoverRes?.success && discoverRes.result) {
                          const card = discoverRes.result;
                          const regRes = await chrome.runtime.sendMessage({
                            type: 'A2A_REGISTER_AGENT',
                            payload: {
                              card,
                              endpoint: newA2aEndpoint.trim(),
                              apiKey: newA2aApiKey.trim() || undefined,
                              trusted: true,
                            },
                          });
                          if (regRes?.success && regRes.result) {
                            setA2aAgents([...a2aAgents, regRes.result]);
                            setNewA2aEndpoint('');
                            setNewA2aApiKey('');
                            setA2aTestResult(`Connected to ${card.name}! (${card.capabilities?.length || 0} capabilities)`);
                          }
                        } else {
                          setA2aTestResult('Discovery failed — agent did not return a valid card');
                        }
                      } catch (e: any) {
                        setA2aTestResult(`Error: ${e.message}`);
                      }
                      setTimeout(() => setA2aTestResult(null), 5000);
                    }}
                    className="px-3 py-2 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors"
                  >
                    Discover
                  </button>
                </div>
              </div>
              {a2aTestResult && (
                <div className={`text-xs py-1.5 px-3 rounded-lg text-center ${
                  a2aTestResult.includes('Connected') ? 'bg-emerald-500/20 text-emerald-400'
                  : a2aTestResult.includes('Error') || a2aTestResult.includes('failed') ? 'bg-red-500/20 text-red-400'
                  : 'bg-orange-500/20 text-orange-400 animate-pulse'
                }`}>
                  {a2aTestResult}
                </div>
              )}
              {a2aAgents.length === 0 && !a2aTestResult && (
                <p className="text-[10px] text-handoff-muted text-center">No remote agents connected. Enter an endpoint and click Discover.</p>
              )}
            </div>
          </div>

          {/* ── MCP Server ────────────────────────────────── */}
          <div className="border-t border-handoff-dark pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-white flex items-center gap-2">
                <Plug className="w-4 h-4 text-violet-400" />
                MCP Server
              </label>
              <button
                onClick={() => setMcpEnabled(!mcpEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${mcpEnabled ? 'bg-emerald-500' : 'bg-handoff-dark'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${mcpEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <p className="text-xs text-handoff-muted mb-3">
              Expose HandOff as an MCP tool server. External agents (Claude, Cursor) can control the browser through HandOff.
            </p>
            {mcpEnabled && (
              <div className="space-y-3">
                {/* Auth toggle */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-handoff-muted">Require Auth Token</span>
                  <button
                    onClick={() => setMcpAuthRequired(!mcpAuthRequired)}
                    className={`relative w-8 h-4 rounded-full transition-colors ${mcpAuthRequired ? 'bg-violet-500' : 'bg-handoff-dark'}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${mcpAuthRequired ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                {mcpAuthRequired && (
                  <input
                    type="password"
                    value={mcpAuthToken}
                    onChange={(e) => setMcpAuthToken(e.target.value)}
                    placeholder="Auth token for MCP clients"
                    className="w-full bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                  />
                )}

                {/* Allowed origins */}
                <div>
                  <label className="block text-xs text-handoff-muted mb-1">Allowed Extension IDs</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newOrigin}
                      onChange={(e) => setNewOrigin(e.target.value)}
                      placeholder="Extension ID"
                      className="flex-1 bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newOrigin.trim()) {
                          setMcpOrigins([...mcpOrigins, newOrigin.trim()]);
                          setNewOrigin('');
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        if (newOrigin.trim()) {
                          setMcpOrigins([...mcpOrigins, newOrigin.trim()]);
                          setNewOrigin('');
                        }
                      }}
                      className="px-3 py-2 rounded-xl text-xs font-medium bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {mcpOrigins.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {mcpOrigins.map((o, i) => (
                        <span key={i} className="flex items-center gap-1 bg-handoff-dark text-xs text-violet-300 px-2 py-1 rounded-lg">
                          {o.slice(0, 16)}...
                          <button onClick={() => setMcpOrigins(mcpOrigins.filter((_, j) => j !== i))} className="text-handoff-muted hover:text-red-400">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-handoff-muted mt-1">Leave empty to allow all extensions. Add IDs to restrict access.</p>
                </div>

                <button
                  onClick={async () => {
                    setMcpTestResult('testing...');
                    try {
                      await chrome.runtime.sendMessage({ type: 'MCP_SET_CONFIG', payload: { enabled: true } });
                      const res = await chrome.runtime.sendMessage({
                        type: 'MCP_HANDLE_REQUEST',
                        payload: { jsonrpc: '2.0', id: 'test-1', method: 'ping' },
                      });
                      if (res?.response?.result?.status === 'ok') {
                        setMcpTestResult('MCP Server responding (ping OK)');
                      } else {
                        setMcpTestResult(`Failed: ${JSON.stringify(res?.response?.error || 'no response')}`);
                      }
                    } catch (e: any) {
                      setMcpTestResult(`Error: ${e.message}`);
                    }
                    setTimeout(() => setMcpTestResult(null), 5000);
                  }}
                  className={`w-full py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    mcpTestResult?.includes('OK') ? 'bg-emerald-500/20 text-emerald-400' :
                    mcpTestResult?.includes('Failed') || mcpTestResult?.includes('Error') ? 'bg-red-500/20 text-red-400' :
                    mcpTestResult === 'testing...' ? 'bg-violet-500/20 text-violet-400 animate-pulse' :
                    'bg-violet-500/10 text-violet-400 hover:bg-violet-500/20'
                  }`}
                >
                  {mcpTestResult || 'Test MCP Server (ping)'}
                </button>
              </div>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={!currentKey.trim()}
            className="w-full flex items-center justify-center gap-2 bg-handoff-primary hover:bg-handoff-primary/80 disabled:bg-handoff-muted disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
          >
            {saved ? (<><Check className="w-4 h-4" /> Saved!</>) : (<><Save className="w-4 h-4" /> Save Settings</>)}
          </button>
        </div>

        <div className="px-4 py-3 bg-handoff-dark/50 border-t border-handoff-dark">
          <p className="text-xs text-handoff-muted text-center">
            Your API keys are stored locally and never sent to our servers.
          </p>
        </div>
      </div>
    </div>
  );
}
