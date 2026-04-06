// 🛡️ AGENT CHALLENGE — Agent pushes back on unsafe workflows
// "Professional users want agents that challenge unsafe logic"

import { useState } from 'react';
import { MessageSquareWarning, ThumbsUp, ThumbsDown, Shield, ArrowRight } from 'lucide-react';
import type { ChallengeResult } from '../../agent/expertReview';

interface AgentChallengeProps {
  challenge: ChallengeResult | null;
  isVisible: boolean;
  onAcceptChallenge: () => void;
  onOverride: () => void;
  onSwitchToCautious: () => void;
}

export default function AgentChallenge({
  challenge,
  isVisible,
  onAcceptChallenge,
  onOverride,
  onSwitchToCautious,
}: AgentChallengeProps) {
  const [selectedResponse, setSelectedResponse] = useState<string | null>(null);

  if (!isVisible || !challenge) return null;

  return (
    <div className="bg-gradient-to-b from-purple-500/10 to-handoff-surface border border-purple-500/30 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-purple-500/20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
            <MessageSquareWarning className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <div className="text-sm font-medium text-white">Agent has concerns</div>
            <div className="text-xs text-purple-300">I want to make sure we're on the right track</div>
          </div>
        </div>
      </div>

      {/* Challenges */}
      <div className="p-4 space-y-3">
        {challenge.challenges.map((text, i) => (
          <div 
            key={i}
            className="bg-handoff-dark/50 rounded-lg p-3 border-l-2 border-purple-500"
          >
            <p className="text-sm text-white">{text}</p>
          </div>
        ))}

        {/* Suggested mode */}
        {challenge.suggestedMode === 'cautious' && (
          <div className="flex items-center gap-2 text-xs text-purple-300 bg-purple-500/10 rounded-lg px-3 py-2">
            <Shield className="w-3.5 h-3.5" />
            <span>I recommend switching to Cautious Mode for this workflow</span>
          </div>
        )}
      </div>

      {/* Response options */}
      <div className="px-4 pb-4 space-y-2">
        <div className="text-xs text-handoff-muted mb-2">How would you like to proceed?</div>
        
        <button
          onClick={() => {
            setSelectedResponse('accept');
            onAcceptChallenge();
          }}
          className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
            selectedResponse === 'accept' 
              ? 'bg-green-500/20 border border-green-500/30' 
              : 'bg-handoff-dark hover:bg-handoff-dark/70'
          }`}
        >
          <ThumbsUp className="w-4 h-4 text-green-400" />
          <div className="flex-1 text-left">
            <div className="text-sm text-white">Good catch, let's be careful</div>
            <div className="text-xs text-handoff-muted">Proceed with extra verification</div>
          </div>
          <ArrowRight className="w-4 h-4 text-handoff-muted" />
        </button>

        <button
          onClick={() => {
            setSelectedResponse('cautious');
            onSwitchToCautious();
          }}
          className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
            selectedResponse === 'cautious' 
              ? 'bg-yellow-500/20 border border-yellow-500/30' 
              : 'bg-handoff-dark hover:bg-handoff-dark/70'
          }`}
        >
          <Shield className="w-4 h-4 text-yellow-400" />
          <div className="flex-1 text-left">
            <div className="text-sm text-white">Switch to Cautious Mode</div>
            <div className="text-xs text-handoff-muted">Ask me before every action</div>
          </div>
          <ArrowRight className="w-4 h-4 text-handoff-muted" />
        </button>

        <button
          onClick={() => {
            setSelectedResponse('override');
            onOverride();
          }}
          className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
            selectedResponse === 'override' 
              ? 'bg-orange-500/20 border border-orange-500/30' 
              : 'bg-handoff-dark hover:bg-handoff-dark/70'
          }`}
        >
          <ThumbsDown className="w-4 h-4 text-orange-400" />
          <div className="flex-1 text-left">
            <div className="text-sm text-white">I know what I'm doing</div>
            <div className="text-xs text-handoff-muted">Proceed anyway (not recommended)</div>
          </div>
          <ArrowRight className="w-4 h-4 text-handoff-muted" />
        </button>
      </div>
    </div>
  );
}
