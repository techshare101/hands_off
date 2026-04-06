import { Play, Pause, RotateCcw, Square, MessageSquare } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';

export default function Controls() {
  const { status, pauseTask, resumeTask, stopTask, retryTask } = useAgentStore();
  
  const isPaused = status === 'paused';
  const isRunning = status !== 'idle' && status !== 'complete' && status !== 'error' && status !== 'paused';
  const canRetry = status === 'error';
  const isComplete = status === 'complete';
  const { reset } = useAgentStore();

  return (
    <div className="p-4 border-t border-handoff-surface bg-handoff-dark">
      <div className="flex items-center gap-2">
        {isComplete ? (
          <button
            onClick={reset}
            className="flex-1 flex items-center justify-center gap-2 bg-handoff-accent hover:bg-handoff-accent/80 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
          >
            <Play className="w-4 h-4" />
            New Task
          </button>
        ) : isPaused ? (
          <button
            onClick={resumeTask}
            className="flex-1 flex items-center justify-center gap-2 bg-handoff-accent hover:bg-handoff-accent/80 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
          >
            <Play className="w-4 h-4" />
            Resume
          </button>
        ) : isRunning ? (
          <button
            onClick={pauseTask}
            className="flex-1 flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-500/80 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
          >
            <Pause className="w-4 h-4" />
            Pause
          </button>
        ) : canRetry ? (
          <button
            onClick={retryTask}
            className="flex-1 flex items-center justify-center gap-2 bg-handoff-primary hover:bg-handoff-primary/80 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Retry
          </button>
        ) : null}

        {(isRunning || isPaused) && (
          <button
            onClick={stopTask}
            className="p-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-colors"
          >
            <Square className="w-4 h-4" />
          </button>
        )}

        <button
          className="p-2.5 bg-handoff-surface hover:bg-handoff-surface/80 text-handoff-muted rounded-xl transition-colors"
          title="Send feedback to agent"
        >
          <MessageSquare className="w-4 h-4" />
        </button>
      </div>

      {(isRunning || isPaused) && (
        <p className="text-xs text-handoff-muted text-center mt-2">
          {isPaused ? 'Agent paused. Click Resume to continue.' : 'Agent is working...'}
        </p>
      )}
    </div>
  );
}
