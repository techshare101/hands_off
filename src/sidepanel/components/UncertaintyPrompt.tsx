// 🎨 UX/TRUST AGENT — Uncertainty Microcopy
// "I'm not sure — want me to try anyway?"

// React is used for JSX transformation
import { HelpCircle, ThumbsUp, ThumbsDown, SkipForward } from 'lucide-react';

interface UncertaintyPromptProps {
  isVisible: boolean;
  confidence: number;
  reasoning: string;
  proposedAction: {
    type: string;
    target?: string;
  };
  onProceed: () => void;
  onSkip: () => void;
  onStop: () => void;
}

function getUncertaintyMessage(confidence: number, actionType: string): string {
  if (confidence < 0.3) {
    return "I'm quite uncertain about this. Should I try anyway?";
  }
  if (confidence < 0.5) {
    return "I'm not fully confident, but this seems like the right move.";
  }
  if (confidence < 0.7) {
    return `This looks like a ${actionType} action. Does that seem right?`;
  }
  return "I think I found it. Confirm to proceed.";
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.7) return 'text-green-400';
  if (confidence >= 0.5) return 'text-yellow-400';
  if (confidence >= 0.3) return 'text-orange-400';
  return 'text-red-400';
}

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return 'High confidence';
  if (confidence >= 0.6) return 'Medium confidence';
  if (confidence >= 0.4) return 'Low confidence';
  return 'Very uncertain';
}

export default function UncertaintyPrompt({
  isVisible,
  confidence,
  reasoning,
  proposedAction,
  onProceed,
  onSkip,
  onStop,
}: UncertaintyPromptProps) {
  if (!isVisible) return null;

  const message = getUncertaintyMessage(confidence, proposedAction.type);
  const confidenceColor = getConfidenceColor(confidence);
  const confidenceLabel = getConfidenceLabel(confidence);

  return (
    <div className="bg-handoff-surface border border-yellow-500/30 rounded-xl p-4 mx-3 mb-3">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
          <HelpCircle className="w-4 h-4 text-yellow-400" />
        </div>
        <div className="flex-1">
          <p className="text-white text-sm font-medium">{message}</p>
          <p className="text-handoff-muted text-xs mt-1">{reasoning}</p>
        </div>
      </div>

      {/* Confidence indicator */}
      <div className="flex items-center gap-2 mb-3 bg-handoff-dark/50 rounded-lg px-3 py-2">
        <span className="text-xs text-handoff-muted">Confidence:</span>
        <div className="flex-1 h-1.5 bg-handoff-dark rounded-full overflow-hidden">
          <div
            className={`h-full ${confidence >= 0.7 ? 'bg-green-500' : confidence >= 0.5 ? 'bg-yellow-500' : 'bg-orange-500'}`}
            style={{ width: `${confidence * 100}%` }}
          />
        </div>
        <span className={`text-xs font-medium ${confidenceColor}`}>
          {confidenceLabel}
        </span>
      </div>

      {/* Proposed action */}
      <div className="text-xs text-handoff-muted mb-3">
        Proposed: <span className="text-white capitalize">{proposedAction.type}</span>
        {proposedAction.target && (
          <span className="text-handoff-primary"> on "{proposedAction.target}"</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onProceed}
          className="flex-1 flex items-center justify-center gap-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-400 text-sm font-medium py-2 px-3 rounded-lg transition-colors"
        >
          <ThumbsUp className="w-3.5 h-3.5" />
          Try it
        </button>
        <button
          onClick={onSkip}
          className="flex-1 flex items-center justify-center gap-1.5 bg-handoff-dark hover:bg-handoff-dark/70 text-handoff-muted text-sm font-medium py-2 px-3 rounded-lg transition-colors"
        >
          <SkipForward className="w-3.5 h-3.5" />
          Skip
        </button>
        <button
          onClick={onStop}
          className="flex items-center justify-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-medium py-2 px-3 rounded-lg transition-colors"
        >
          <ThumbsDown className="w-3.5 h-3.5" />
          Stop
        </button>
      </div>
    </div>
  );
}
