import { useState, useEffect } from 'react';
import { X, Key, Save, Check, Eye } from 'lucide-react';
import { OPENROUTER_VISION_MODELS } from '../../agent/openRouterClient';
import { ROUTELLM_MODELS } from '../../agent/routeLLMClient';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

type LLMProvider = 'gemini' | 'openrouter' | 'routellm';

export default function Settings({ isOpen, onClose }: SettingsProps) {
  const [provider, setProvider] = useState<LLMProvider>('gemini');
  const [geminiKey, setGeminiKey] = useState('');
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [openRouterModel, setOpenRouterModel] = useState('google/gemini-2.0-flash-exp:free');
  const [routeLLMKey, setRouteLLMKey] = useState('');
  const [routeLLMModel, setRouteLLMModel] = useState('router');
  const [saved, setSaved] = useState(false);
  const [molmoEnabled, setMolmoEnabled] = useState(false);
  const [molmoEndpoint, setMolmoEndpoint] = useState('http://127.0.0.1:8001');
  const [molmoStatus, setMolmoStatus] = useState<'unknown' | 'checking' | 'online' | 'offline'>('unknown');

  useEffect(() => {
    // Load existing settings
    chrome.storage.local.get(['llmProvider', 'geminiApiKey', 'openRouterApiKey', 'openRouterModel', 'routeLLMApiKey', 'routeLLMModel', 'molmoweb_enabled', 'molmoweb_endpoint']).then((result) => {
      if (result.llmProvider) setProvider(result.llmProvider);
      if (result.geminiApiKey) setGeminiKey(result.geminiApiKey);
      if (result.openRouterApiKey) setOpenRouterKey(result.openRouterApiKey);
      if (result.openRouterModel) setOpenRouterModel(result.openRouterModel);
      if (result.routeLLMApiKey) setRouteLLMKey(result.routeLLMApiKey);
      if (result.routeLLMModel) setRouteLLMModel(result.routeLLMModel);
      if (result.molmoweb_enabled) setMolmoEnabled(result.molmoweb_enabled);
      if (result.molmoweb_endpoint) setMolmoEndpoint(result.molmoweb_endpoint);
    });
  }, []);

  const handleSave = async () => {
    await chrome.storage.local.set({
      llmProvider: provider,
      geminiApiKey: geminiKey,
      openRouterApiKey: openRouterKey,
      openRouterModel: openRouterModel,
      routeLLMApiKey: routeLLMKey,
      routeLLMModel: routeLLMModel,
      molmoweb_enabled: molmoEnabled,
      molmoweb_endpoint: molmoEndpoint,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const checkMolmoServer = async () => {
    setMolmoStatus('checking');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'MOLMO_HEALTH_CHECK', payload: { endpoint: molmoEndpoint } });
      setMolmoStatus(res?.available ? 'online' : 'offline');
    } catch {
      setMolmoStatus('offline');
    }
    setTimeout(() => setMolmoStatus('unknown'), 5000);
  };

  const currentKey = provider === 'gemini' ? geminiKey : provider === 'openrouter' ? openRouterKey : routeLLMKey;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-handoff-surface rounded-2xl w-full max-w-md mx-4 overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-handoff-dark">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-handoff-dark rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-handoff-muted" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Provider Selection */}
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              LLM Provider
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setProvider('gemini')}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  provider === 'gemini'
                    ? 'bg-handoff-primary text-white'
                    : 'bg-handoff-dark text-handoff-muted hover:text-white'
                }`}
              >
                Gemini
              </button>
              <button
                onClick={() => setProvider('openrouter')}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  provider === 'openrouter'
                    ? 'bg-handoff-primary text-white'
                    : 'bg-handoff-dark text-handoff-muted hover:text-white'
                }`}
              >
                OpenRouter
              </button>
              <button
                onClick={() => setProvider('routellm')}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  provider === 'routellm'
                    ? 'bg-handoff-primary text-white'
                    : 'bg-handoff-dark text-handoff-muted hover:text-white'
                }`}
              >
                RouteLLM
              </button>
            </div>
          </div>

          {/* Gemini Settings */}
          {provider === 'gemini' && (
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4" />
                  Gemini API Key
                </div>
              </label>
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="Enter your Gemini API key"
                className="w-full bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-handoff-primary/50"
              />
              <p className="text-xs text-handoff-muted mt-2">
                Get your API key from{' '}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-handoff-primary hover:underline"
                >
                  Google AI Studio
                </a>
              </p>
            </div>
          )}

          {/* OpenRouter Settings */}
          {provider === 'openrouter' && (
            <>
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4" />
                    OpenRouter API Key
                  </div>
                </label>
                <input
                  type="password"
                  value={openRouterKey}
                  onChange={(e) => setOpenRouterKey(e.target.value)}
                  placeholder="Enter your OpenRouter API key"
                  className="w-full bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-handoff-primary/50"
                />
                <p className="text-xs text-handoff-muted mt-2">
                  Get your API key from{' '}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-handoff-primary hover:underline"
                  >
                    OpenRouter
                  </a>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Model
                </label>
                <select
                  value={openRouterModel}
                  onChange={(e) => setOpenRouterModel(e.target.value)}
                  className="w-full bg-handoff-dark text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-handoff-primary/50"
                >
                  {OPENROUTER_VISION_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} ({model.provider})
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* RouteLLM Settings */}
          {provider === 'routellm' && (
            <>
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4" />
                    RouteLLM API Key
                  </div>
                </label>
                <input
                  type="password"
                  value={routeLLMKey}
                  onChange={(e) => setRouteLLMKey(e.target.value)}
                  placeholder="Enter your RouteLLM API key"
                  className="w-full bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-handoff-primary/50"
                />
                <p className="text-xs text-handoff-muted mt-2">
                  Get your API key from{' '}
                  <a
                    href="https://routellm.ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-handoff-primary hover:underline"
                  >
                    RouteLLM
                  </a>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Model
                </label>
                <select
                  value={routeLLMModel}
                  onChange={(e) => setRouteLLMModel(e.target.value)}
                  className="w-full bg-handoff-dark text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-handoff-primary/50"
                >
                  {ROUTELLM_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-handoff-muted mt-2">
                  Auto Router intelligently selects the best model for each request.
                </p>
              </div>
            </>
          )}

          {/* MolmoWeb Vision Engine */}
          <div className="border-t border-handoff-dark pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-white flex items-center gap-2">
                <Eye className="w-4 h-4 text-purple-400" />
                MolmoWeb Vision Engine
              </label>
              <button
                onClick={() => setMolmoEnabled(!molmoEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  molmoEnabled ? 'bg-emerald-500' : 'bg-handoff-dark'
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  molmoEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
            <p className="text-xs text-handoff-muted mb-3">
              Use AI2's open visual web agent for screenshot-based perception. Requires a self-hosted MolmoWeb model server.
            </p>
            {molmoEnabled && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={molmoEndpoint}
                    onChange={(e) => setMolmoEndpoint(e.target.value)}
                    placeholder="http://127.0.0.1:8001"
                    className="flex-1 bg-handoff-dark text-white placeholder-handoff-muted rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                  <button
                    onClick={checkMolmoServer}
                    disabled={molmoStatus === 'checking'}
                    className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                      molmoStatus === 'online' ? 'bg-emerald-500/20 text-emerald-400' :
                      molmoStatus === 'offline' ? 'bg-red-500/20 text-red-400' :
                      molmoStatus === 'checking' ? 'bg-purple-500/20 text-purple-400 animate-pulse' :
                      'bg-handoff-dark text-handoff-muted hover:text-white'
                    }`}
                  >
                    {molmoStatus === 'checking' ? 'Testing...' :
                     molmoStatus === 'online' ? 'Online' :
                     molmoStatus === 'offline' ? 'Offline' : 'Test'}
                  </button>
                </div>
                <p className="text-[10px] text-handoff-muted">
                  Run <code className="text-purple-400">bash scripts/start_server.sh</code> in your MolmoWeb checkout. Falls back to Gemini if unreachable.
                </p>
              </div>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={!currentKey.trim()}
            className="w-full flex items-center justify-center gap-2 bg-handoff-primary hover:bg-handoff-primary/80 disabled:bg-handoff-muted disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
          >
            {saved ? (
              <>
                <Check className="w-4 h-4" />
                Saved!
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Settings
              </>
            )}
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
