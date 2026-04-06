import { useState, useEffect } from 'react';
import { X, Key, Save, Check, Eye } from 'lucide-react';
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
  const [molmoEnabled, setMolmoEnabled] = useState(false);
  const [molmoEndpoint, setMolmoEndpoint] = useState('http://127.0.0.1:8001');
  const [molmoStatus, setMolmoStatus] = useState<'unknown' | 'checking' | 'online' | 'offline'>('unknown');

  useEffect(() => {
    const allStorageKeys = ['llmProvider', 'molmoweb_enabled', 'molmoweb_endpoint'];
    Object.values(PROVIDER_META).forEach(m => {
      allStorageKeys.push(m.storageKey);
      if (m.modelStorageKey) allStorageKeys.push(m.modelStorageKey);
    });
    chrome.storage.local.get(allStorageKeys).then((result) => {
      if (result.llmProvider) setProvider(result.llmProvider);
      if (result.molmoweb_enabled) setMolmoEnabled(result.molmoweb_enabled);
      if (result.molmoweb_endpoint) setMolmoEndpoint(result.molmoweb_endpoint);
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
      molmoweb_enabled: molmoEnabled,
      molmoweb_endpoint: molmoEndpoint,
      ...keys,
      ...models,
    };
    await chrome.storage.local.set(data);
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

          {/* MolmoWeb Vision Engine */}
          <div className="border-t border-handoff-dark pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-white flex items-center gap-2">
                <Eye className="w-4 h-4 text-purple-400" />
                MolmoWeb Vision Engine
              </label>
              <button
                onClick={() => setMolmoEnabled(!molmoEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${molmoEnabled ? 'bg-emerald-500' : 'bg-handoff-dark'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${molmoEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <p className="text-xs text-handoff-muted mb-3">
              Optional AI2 open-weight vision agent. Falls back to selected LLM if unreachable.
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
