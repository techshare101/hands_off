// 🎨 UX/TRUST AGENT — Approval Modal for Human-in-the-Loop
import React from 'react';
import { AlertTriangle, Check, X, Edit3 } from 'lucide-react';

interface ProposedAction {
  type: string;
  target?: string;
  confidence: number;
  reasoning: string;
}

interface ApprovalModalProps {
  isOpen: boolean;
  action: ProposedAction | null;
  reasons: string[];
  onApprove: () => void;
  onReject: () => void;
  onOverride?: () => void;
}

export default function ApprovalModal({
  isOpen,
  action,
  reasons,
  onApprove,
  onReject,
}: ApprovalModalProps) {
  if (!isOpen || !action) return null;

  const confidenceColor = 
    action.confidence >= 0.8 ? 'text-green-400' :
    action.confidence >= 0.6 ? 'text-yellow-400' :
    'text-red-400';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-handoff-surface rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-handoff-primary/20">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-orange-500/10 border-b border-orange-500/20">
          <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Approval Required</h2>
            <p className="text-sm text-orange-300">Review before continuing</p>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Action Details */}
          <div className="bg-handoff-dark rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-handoff-muted">Proposed Action</span>
              <span className={`text-sm font-mono ${confidenceColor}`}>
                {Math.round(action.confidence * 100)}% confident
              </span>
            </div>
            <div className="text-white font-medium">
              <span className="capitalize">{action.type}</span>
              {action.target && (
                <span className="text-handoff-muted"> on "{action.target}"</span>
              )}
            </div>
          </div>

          {/* Reasoning */}
          <div>
            <span className="text-sm font-medium text-handoff-muted">Reasoning</span>
            <p className="text-sm text-white mt-1">{action.reasoning}</p>
          </div>

          {/* Reasons for approval */}
          {reasons.length > 0 && (
            <div className="bg-orange-500/5 rounded-xl p-3 border border-orange-500/20">
              <span className="text-xs font-medium text-orange-400 uppercase tracking-wide">
                Why approval is needed
              </span>
              <ul className="mt-2 space-y-1">
                {reasons.map((reason, i) => (
                  <li key={i} className="text-sm text-orange-200 flex items-start gap-2">
                    <span className="text-orange-400 mt-0.5">•</span>
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 p-4 border-t border-handoff-dark">
          <button
            onClick={onReject}
            className="flex-1 flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium py-3 px-4 rounded-xl transition-colors"
          >
            <X className="w-4 h-4" />
            Reject
          </button>
          <button
            onClick={onApprove}
            className="flex-1 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-500/80 text-white font-medium py-3 px-4 rounded-xl transition-colors"
          >
            <Check className="w-4 h-4" />
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
