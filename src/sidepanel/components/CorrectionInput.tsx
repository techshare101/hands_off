// 🎨 UX/TRUST AGENT — Correction Feedback Loop
// "No, the button below" → feeds back into context

import React, { useState } from 'react';
import { MessageSquare, Send, X } from 'lucide-react';

interface CorrectionInputProps {
  isVisible: boolean;
  lastAction?: {
    type: string;
    target?: string;
    description?: string;
  };
  onCorrection: (correction: string) => void;
  onDismiss: () => void;
}

const QUICK_CORRECTIONS = [
  { label: 'Wrong element', value: 'That was the wrong element. Try the one below it.' },
  { label: 'Try again', value: 'That didn\'t work. Please try again.' },
  { label: 'Skip this', value: 'Skip this step and move to the next one.' },
  { label: 'Different approach', value: 'Try a different approach to accomplish this.' },
];

export default function CorrectionInput({
  isVisible,
  lastAction,
  onCorrection,
  onDismiss,
}: CorrectionInputProps) {
  const [customCorrection, setCustomCorrection] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isVisible) return null;

  const handleQuickCorrection = (correction: string) => {
    onCorrection(correction);
    setIsExpanded(false);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customCorrection.trim()) {
      onCorrection(customCorrection.trim());
      setCustomCorrection('');
      setIsExpanded(false);
    }
  };

  return (
    <div className="bg-handoff-surface border-t border-handoff-dark p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm text-handoff-muted">
          <MessageSquare className="w-4 h-4" />
          <span>Need to correct the agent?</span>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 hover:bg-handoff-dark rounded"
        >
          <X className="w-4 h-4 text-handoff-muted" />
        </button>
      </div>

      {/* Last action context */}
      {lastAction && (
        <div className="text-xs text-handoff-muted mb-2 bg-handoff-dark/50 rounded px-2 py-1">
          Last: <span className="text-white">{lastAction.type}</span>
          {lastAction.target && <span> on "{lastAction.target}"</span>}
        </div>
      )}

      {/* Quick corrections */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {QUICK_CORRECTIONS.map((qc) => (
          <button
            key={qc.label}
            onClick={() => handleQuickCorrection(qc.value)}
            className="text-xs bg-handoff-dark hover:bg-handoff-primary/20 text-white px-2 py-1 rounded-full transition-colors"
          >
            {qc.label}
          </button>
        ))}
      </div>

      {/* Custom input */}
      {isExpanded ? (
        <form onSubmit={handleCustomSubmit} className="flex gap-2">
          <input
            type="text"
            value={customCorrection}
            onChange={(e) => setCustomCorrection(e.target.value)}
            placeholder="Tell the agent what to do instead..."
            className="flex-1 bg-handoff-dark text-white text-sm placeholder-handoff-muted rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-handoff-primary"
            autoFocus
          />
          <button
            type="submit"
            disabled={!customCorrection.trim()}
            className="bg-handoff-primary hover:bg-handoff-primary/80 disabled:bg-handoff-muted disabled:cursor-not-allowed text-white p-2 rounded-lg transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      ) : (
        <button
          onClick={() => setIsExpanded(true)}
          className="w-full text-left text-sm text-handoff-muted hover:text-white bg-handoff-dark/50 hover:bg-handoff-dark rounded-lg px-3 py-2 transition-colors"
        >
          Or type a custom correction...
        </button>
      )}
    </div>
  );
}
