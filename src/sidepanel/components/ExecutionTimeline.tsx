// 🎯 VISUAL EXECUTION TIMELINE — Screenshot thumbnails + confidence scores per step
// Users are crying for: "I can't see what's happening"

import { useState } from 'react';
import { Eye, Brain, Target, Play, CheckCircle, AlertTriangle, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';

interface TimelineStep {
  id: string;
  type: 'seeing' | 'thinking' | 'proposing' | 'executing' | 'verifying' | 'complete' | 'error';
  description: string;
  reasoning?: string;
  screenshot?: string;
  confidence?: number;
  timestamp: number;
  duration?: number;
}

const STEP_ICONS = {
  seeing: Eye,
  thinking: Brain,
  proposing: Target,
  executing: Play,
  verifying: CheckCircle,
  complete: CheckCircle,
  error: AlertTriangle,
};

const STEP_COLORS = {
  seeing: 'text-blue-400 bg-blue-500/20',
  thinking: 'text-purple-400 bg-purple-500/20',
  proposing: 'text-yellow-400 bg-yellow-500/20',
  executing: 'text-green-400 bg-green-500/20',
  verifying: 'text-cyan-400 bg-cyan-500/20',
  complete: 'text-green-400 bg-green-500/20',
  error: 'text-red-400 bg-red-500/20',
};

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const color = confidence >= 0.8 ? 'bg-green-500' : confidence >= 0.6 ? 'bg-yellow-500' : 'bg-orange-500';
  const label = confidence >= 0.8 ? 'High' : confidence >= 0.6 ? 'Medium' : 'Low';
  
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-xs text-handoff-muted">{label} ({Math.round(confidence * 100)}%)</span>
    </div>
  );
}

function TimelineStepCard({ step, isExpanded, onToggle }: { 
  step: TimelineStep; 
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const Icon = STEP_ICONS[step.type];
  const colorClass = STEP_COLORS[step.type];
  const time = new Date(step.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="relative">
      {/* Timeline connector */}
      <div className="absolute left-4 top-10 bottom-0 w-0.5 bg-handoff-dark" />
      
      <div 
        className={`bg-handoff-surface rounded-xl p-3 cursor-pointer hover:bg-handoff-surface/80 transition-colors ${
          step.type === 'error' ? 'border border-red-500/30' : ''
        }`}
        onClick={onToggle}
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${colorClass}`}>
            <Icon className="w-4 h-4" />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-white capitalize">{step.type}</span>
              <div className="flex items-center gap-2">
                {step.confidence !== undefined && (
                  <ConfidenceBadge confidence={step.confidence} />
                )}
                <span className="text-xs text-handoff-muted flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {time}
                </span>
              </div>
            </div>
            <p className="text-sm text-handoff-muted mt-0.5 truncate">{step.description}</p>
          </div>
          
          <button className="p-1 text-handoff-muted hover:text-white">
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Expanded content */}
        {isExpanded && (
          <div className="mt-3 pl-11 space-y-3">
            {/* Screenshot thumbnail */}
            {step.screenshot && (
              <div className="relative group">
                <img 
                  src={step.screenshot} 
                  alt="Screenshot" 
                  className="w-full rounded-lg border border-handoff-dark"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                  <span className="text-xs text-white">Click to enlarge</span>
                </div>
              </div>
            )}
            
            {/* Reasoning - "Why I did this" */}
            {step.reasoning && (
              <div className="bg-handoff-dark/50 rounded-lg p-3">
                <div className="text-xs font-medium text-handoff-primary mb-1">💭 Why I did this</div>
                <p className="text-sm text-handoff-muted">{step.reasoning}</p>
              </div>
            )}

            {/* Duration */}
            {step.duration && (
              <div className="text-xs text-handoff-muted">
                Duration: {step.duration}ms
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ExecutionTimeline() {
  const { steps } = useAgentStore();
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  // Convert store steps to timeline format
  const timelineSteps: TimelineStep[] = steps.map((step, index) => ({
    id: `step-${index}`,
    type: step.type as TimelineStep['type'],
    description: step.description,
    reasoning: step.reasoning,
    screenshot: step.screenshot,
    confidence: step.confidence,
    timestamp: step.timestamp,
  }));

  if (timelineSteps.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-16 h-16 bg-handoff-surface rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Eye className="w-8 h-8 text-handoff-muted" />
          </div>
          <p className="text-handoff-muted text-sm">
            Start a task to see the execution timeline
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-white">Execution Timeline</h3>
        <span className="text-xs text-handoff-muted">{timelineSteps.length} steps</span>
      </div>
      
      {timelineSteps.map((step) => (
        <TimelineStepCard
          key={step.id}
          step={step}
          isExpanded={expandedSteps.has(step.id)}
          onToggle={() => toggleStep(step.id)}
        />
      ))}
    </div>
  );
}
