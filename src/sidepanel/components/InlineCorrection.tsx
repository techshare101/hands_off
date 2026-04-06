// 💬 INLINE CORRECTION — "No, click the other button" without restarting
// Users are crying for: "When it makes a mistake, I have to start over"

import { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, X, CornerDownLeft, Sparkles } from 'lucide-react';

interface InlineCorrectionProps {
  isVisible: boolean;
  currentAction?: {
    type: string;
    target?: string;
    x?: number;
    y?: number;
  };
  onCorrection: (correction: CorrectionPayload) => void;
  onDismiss: () => void;
}

export interface CorrectionPayload {
  type: 'text' | 'position' | 'skip' | 'retry' | 'alternative';
  text?: string;
  newPosition?: { x: number; y: number };
  alternativeAction?: string;
}

const SMART_SUGGESTIONS = [
  { label: 'Try the one below', value: 'Click the element below the current target instead.' },
  { label: 'Try the one above', value: 'Click the element above the current target instead.' },
  { label: 'Wrong field', value: 'That was the wrong input field. Look for a different one.' },
  { label: 'Skip this step', value: 'Skip this action and move to the next step.' },
  { label: 'Try different approach', value: 'Try a completely different approach to accomplish this.' },
  { label: 'Scroll first', value: 'Scroll the page first to find the correct element.' },
];

export default function InlineCorrection({
  isVisible,
  currentAction,
  onCorrection,
  onDismiss,
}: InlineCorrectionProps) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isVisible]);

  if (!isVisible) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onCorrection({ type: 'text', text: input.trim() });
      setInput('');
    }
  };

  const handleSuggestion = (suggestion: string) => {
    onCorrection({ type: 'text', text: suggestion });
  };

  const handleSkip = () => {
    onCorrection({ type: 'skip' });
  };

  const handleRetry = () => {
    onCorrection({ type: 'retry' });
  };

  return (
    <div className="bg-gradient-to-b from-handoff-surface to-handoff-dark border-t border-handoff-primary/30 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-handoff-primary/20 flex items-center justify-center">
            <MessageSquare className="w-3.5 h-3.5 text-handoff-primary" />
          </div>
          <span className="text-sm font-medium text-white">Correct the Agent</span>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 text-handoff-muted hover:text-white rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Current action context */}
      {currentAction && (
        <div className="bg-handoff-dark/50 rounded-lg px-3 py-2 mb-3 text-xs">
          <span className="text-handoff-muted">Last action: </span>
          <span className="text-white capitalize">{currentAction.type}</span>
          {currentAction.target && (
            <span className="text-handoff-primary"> on "{currentAction.target}"</span>
          )}
        </div>
      )}

      {/* Smart suggestions */}
      {showSuggestions && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="w-3 h-3 text-yellow-400" />
            <span className="text-xs text-handoff-muted">Quick corrections</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SMART_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion.label}
                onClick={() => handleSuggestion(suggestion.value)}
                className="text-xs bg-handoff-dark hover:bg-handoff-primary/20 text-white px-2.5 py-1.5 rounded-full transition-colors border border-transparent hover:border-handoff-primary/30"
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Text input */}
      <form onSubmit={handleSubmit} className="relative">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setShowSuggestions(false)}
          onBlur={() => setTimeout(() => setShowSuggestions(true), 200)}
          placeholder="Tell me what to do instead..."
          className="w-full bg-handoff-dark text-white text-sm placeholder-handoff-muted rounded-xl pl-4 pr-12 py-3 focus:outline-none focus:ring-2 focus:ring-handoff-primary/50"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-handoff-primary hover:bg-handoff-primary/80 disabled:bg-handoff-muted disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      {/* Keyboard hint */}
      <div className="flex items-center justify-between mt-2 text-xs text-handoff-muted">
        <div className="flex items-center gap-1">
          <CornerDownLeft className="w-3 h-3" />
          <span>Enter to send</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRetry}
            className="hover:text-white transition-colors"
          >
            Retry same action
          </button>
          <span>•</span>
          <button
            onClick={handleSkip}
            className="hover:text-white transition-colors"
          >
            Skip step
          </button>
        </div>
      </div>
    </div>
  );
}
