// 🎨 UX/TRUST AGENT — API Key Setup Prompt
import React, { useState } from 'react';
import { Key, ExternalLink, Loader2, Check } from 'lucide-react';

interface ApiKeyPromptProps {
  onKeySet: () => void;
}

export default function ApiKeyPrompt({ onKeySet }: ApiKeyPromptProps) {
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      // Save API key via background worker
      const response = await chrome.runtime.sendMessage({
        type: 'SET_API_KEY',
        payload: { apiKey: apiKey.trim() },
      });

      if (response.success) {
        onKeySet();
      } else {
        setError(response.error || 'Failed to save API key');
      }
    } catch (err) {
      setError('Failed to save API key');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-handoff-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Key className="w-8 h-8 text-handoff-primary" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">
            Connect to Gemini
          </h2>
          <p className="text-sm text-handoff-muted">
            HandOff uses Gemini 2.0 Flash for computer use. Enter your API key to get started.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your Gemini API key"
              className="w-full bg-handoff-surface text-white placeholder-handoff-muted rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-handoff-primary/50"
            />
            {error && (
              <p className="text-red-400 text-sm mt-2">{error}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={!apiKey.trim() || isLoading}
            className="w-full flex items-center justify-center gap-2 bg-handoff-primary hover:bg-handoff-primary/80 disabled:bg-handoff-muted disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-xl transition-colors"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Check className="w-5 h-5" />
                Connect
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-handoff-primary hover:underline"
          >
            Get your API key from Google AI Studio
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="mt-4 p-3 bg-handoff-surface/50 rounded-xl">
          <p className="text-xs text-handoff-muted text-center">
            🔒 Your API key is stored locally and never sent to our servers.
          </p>
        </div>
      </div>
    </div>
  );
}
