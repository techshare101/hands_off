// 🧠 PER-STEP RATIONALE — "Why I did this" explanations
// Users are crying for: "I don't understand why it made that decision"

import { useState } from 'react';
import { Brain, ChevronRight, Lightbulb, Target, AlertCircle, CheckCircle } from 'lucide-react';

interface RationaleProps {
  reasoning: string;
  observation: string;
  confidence: number;
  alternatives?: string[];
  risks?: string[];
  isExpanded?: boolean;
}

export default function StepRationale({
  reasoning,
  observation,
  confidence,
  alternatives = [],
  risks = [],
  isExpanded: initialExpanded = false,
}: RationaleProps) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);

  const confidenceLevel = confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low';
  const confidenceColors = {
    high: 'text-green-400 bg-green-500/10 border-green-500/30',
    medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
    low: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  };

  return (
    <div className="bg-handoff-surface rounded-xl overflow-hidden">
      {/* Collapsed view */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 p-3 hover:bg-handoff-dark/30 transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
          <Brain className="w-4 h-4 text-purple-400" />
        </div>
        <div className="flex-1 text-left">
          <div className="text-sm font-medium text-white">Why I did this</div>
          <p className="text-xs text-handoff-muted truncate">{reasoning}</p>
        </div>
        <ChevronRight className={`w-4 h-4 text-handoff-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
      </button>

      {/* Expanded view */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Observation */}
          <div className="bg-handoff-dark/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Target className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs font-medium text-blue-400">What I observed</span>
            </div>
            <p className="text-sm text-handoff-muted">{observation}</p>
          </div>

          {/* Reasoning */}
          <div className="bg-handoff-dark/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Lightbulb className="w-3.5 h-3.5 text-yellow-400" />
              <span className="text-xs font-medium text-yellow-400">My reasoning</span>
            </div>
            <p className="text-sm text-handoff-muted">{reasoning}</p>
          </div>

          {/* Confidence */}
          <div className={`rounded-lg p-3 border ${confidenceColors[confidenceLevel]}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {confidenceLevel === 'high' ? (
                  <CheckCircle className="w-3.5 h-3.5" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5" />
                )}
                <span className="text-xs font-medium">Confidence: {Math.round(confidence * 100)}%</span>
              </div>
              <span className="text-xs capitalize">{confidenceLevel}</span>
            </div>
            <div className="mt-2 h-1.5 bg-black/20 rounded-full overflow-hidden">
              <div 
                className={`h-full ${
                  confidenceLevel === 'high' ? 'bg-green-500' : 
                  confidenceLevel === 'medium' ? 'bg-yellow-500' : 'bg-orange-500'
                }`}
                style={{ width: `${confidence * 100}%` }}
              />
            </div>
          </div>

          {/* Alternatives considered */}
          {alternatives.length > 0 && (
            <div className="bg-handoff-dark/50 rounded-lg p-3">
              <div className="text-xs font-medium text-handoff-muted mb-2">Alternatives I considered:</div>
              <ul className="space-y-1">
                {alternatives.map((alt, i) => (
                  <li key={i} className="text-xs text-handoff-muted flex items-start gap-2">
                    <span className="text-handoff-primary">•</span>
                    {alt}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risks identified */}
          {risks.length > 0 && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
              <div className="text-xs font-medium text-red-400 mb-2">Potential risks:</div>
              <ul className="space-y-1">
                {risks.map((risk, i) => (
                  <li key={i} className="text-xs text-red-300 flex items-start gap-2">
                    <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                    {risk}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Compact inline version for action feed
export function RationaleInline({ reasoning, confidence }: { reasoning: string; confidence: number }) {
  const confidenceColor = confidence >= 0.8 ? 'text-green-400' : confidence >= 0.6 ? 'text-yellow-400' : 'text-orange-400';
  
  return (
    <div className="flex items-start gap-2 mt-2 p-2 bg-handoff-dark/30 rounded-lg">
      <Brain className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-handoff-muted line-clamp-2">{reasoning}</p>
        <span className={`text-xs ${confidenceColor}`}>
          {Math.round(confidence * 100)}% confident
        </span>
      </div>
    </div>
  );
}
