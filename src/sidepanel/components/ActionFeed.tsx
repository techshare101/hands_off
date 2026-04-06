import React, { useEffect, useRef } from 'react';
import { Eye, MousePointer, Type, CheckCircle, AlertCircle, Pause, Brain, Sparkles } from 'lucide-react';
import { useAgentStore, AgentStep } from '../../store/agentStore';

const stepIcons = {
  seeing: Eye,
  thinking: Brain,
  clicking: MousePointer,
  typing: Type,
  verifying: CheckCircle,
  error: AlertCircle,
  paused: Pause,
  learning: Sparkles,
};

const stepColors = {
  seeing: 'text-blue-400 bg-blue-500/10',
  thinking: 'text-purple-400 bg-purple-500/10',
  clicking: 'text-yellow-400 bg-yellow-500/10',
  typing: 'text-orange-400 bg-orange-500/10',
  verifying: 'text-green-400 bg-green-500/10',
  error: 'text-red-400 bg-red-500/10',
  paused: 'text-orange-400 bg-orange-500/10',
  learning: 'text-emerald-400 bg-emerald-500/10',
};

function StepItem({ step }: { step: AgentStep }) {
  const Icon = stepIcons[step.type] || Eye;
  const colorClass = stepColors[step.type] || stepColors.seeing;

  return (
    <div className="flex gap-3 p-3 rounded-lg bg-handoff-surface/50 hover:bg-handoff-surface transition-colors">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white capitalize">{step.type}</span>
          <span className="text-xs text-handoff-muted">
            {new Date(step.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <p className="text-sm text-handoff-muted mt-0.5 truncate">{step.description}</p>
        {step.screenshot && (
          <img 
            src={step.screenshot} 
            alt="Step screenshot" 
            className="mt-2 rounded-lg border border-handoff-surface max-h-32 object-cover"
          />
        )}
      </div>
    </div>
  );
}

export default function ActionFeed() {
  const { steps, currentTask } = useAgentStore();
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [steps]);

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="px-4 py-2 border-b border-handoff-surface">
        <h3 className="text-sm font-medium text-white">Action Feed</h3>
        {currentTask && (
          <p className="text-xs text-handoff-muted mt-0.5 truncate">
            Task: {currentTask}
          </p>
        )}
      </div>
      
      <div ref={feedRef} className="flex-1 overflow-y-auto p-4 space-y-2">
        {steps.length === 0 ? (
          <div className="text-center text-handoff-muted text-sm py-8">
            Agent actions will appear here...
          </div>
        ) : (
          steps.map((step) => <StepItem key={step.id} step={step} />)
        )}
      </div>
    </div>
  );
}
