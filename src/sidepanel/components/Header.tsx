import { useState, useEffect } from 'react';
import { Zap, Settings, Sparkles } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';

interface HeaderProps {
  onSettingsClick: () => void;
  onLearningClick?: () => void;
}

export default function Header({ onSettingsClick, onLearningClick }: HeaderProps) {
  const { status, tasksRemaining } = useAgentStore();
  const [provider, setProvider] = useState<string>('gemini');
  const [model, setModel] = useState<string>('');

  useEffect(() => {
    // Load current provider and model
    chrome.storage.local.get(['llmProvider', 'openRouterModel', 'routeLLMModel']).then((result) => {
      const prov = result.llmProvider || 'gemini';
      setProvider(prov);
      if (prov === 'openrouter') {
        setModel(result.openRouterModel?.split('/').pop() || '');
      } else if (prov === 'routellm') {
        setModel(result.routeLLMModel || 'router');
      } else {
        setModel('2.0-flash');
      }
    });

    // Listen for storage changes
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.llmProvider) setProvider(changes.llmProvider.newValue || 'gemini');
      if (changes.openRouterModel) setModel(changes.openRouterModel.newValue?.split('/').pop() || '');
      if (changes.routeLLMModel) setModel(changes.routeLLMModel.newValue || 'router');
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const statusColors = {
    idle: 'bg-gray-500',
    seeing: 'bg-blue-500 animate-pulse',
    thinking: 'bg-purple-500 animate-pulse',
    acting: 'bg-yellow-500 animate-pulse',
    verifying: 'bg-green-500 animate-pulse',
    paused: 'bg-orange-500',
    error: 'bg-red-500',
    complete: 'bg-green-500',
  };

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-handoff-surface">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 bg-gradient-to-br from-handoff-primary to-handoff-secondary rounded-lg flex items-center justify-center">
          <Zap className="w-5 h-5 text-white" />
        </div>
        <span className="font-bold text-lg text-white">HandOff</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <div className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
          <span className="text-handoff-muted capitalize">{status}</span>
        </div>
        
        <div className="text-xs text-handoff-muted bg-handoff-surface px-2 py-1 rounded" title={`Provider: ${provider}`}>
          {provider === 'gemini' ? '🔷' : provider === 'openrouter' ? '🌐' : '🛤️'} {model}
        </div>

        {onLearningClick && (
          <button 
            onClick={onLearningClick}
            className="p-1.5 hover:bg-handoff-surface rounded-lg transition-colors"
            title="Self-Learning Engine"
          >
            <Sparkles className="w-4 h-4 text-emerald-400" />
          </button>
        )}

        <button 
          onClick={onSettingsClick}
          className="p-1.5 hover:bg-handoff-surface rounded-lg transition-colors"
          title="Settings"
        >
          <Settings className="w-4 h-4 text-handoff-muted" />
        </button>
      </div>
    </header>
  );
}
