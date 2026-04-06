// 💰 COST TRANSPARENCY DASHBOARD — Real-time token usage per action
// Users are crying for: "I don't know how much this is costing me"

import { useState, useEffect } from 'react';
import { DollarSign, Zap, Image, Brain, Clock, ChevronDown, ChevronUp } from 'lucide-react';

interface CostBreakdown {
  screenshots: number;
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

interface TaskCost {
  taskId: string;
  taskName: string;
  startTime: number;
  endTime?: number;
  breakdown: CostBreakdown;
}

interface CostDashboardProps {
  isVisible: boolean;
  currentTask?: TaskCost;
  history?: TaskCost[];
  onClose?: () => void;
}

// Gemini 2.0 Flash pricing (approximate)
const PRICING = {
  inputTokenPer1M: 0.075,   // $0.075 per 1M input tokens
  outputTokenPer1M: 0.30,   // $0.30 per 1M output tokens
  imagePer1K: 0.0025,       // ~$0.0025 per image (estimated)
};

function formatCost(cost: number): string {
  if (cost < 0.01) return `<$0.01`;
  return `$${cost.toFixed(3)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toString();
}

function CostMeter({ label, value, max, icon: Icon, color }: {
  label: string;
  value: number;
  max: number;
  icon: typeof Zap;
  color: string;
}) {
  const percentage = Math.min((value / max) * 100, 100);
  
  return (
    <div className="bg-handoff-dark/50 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${color}`} />
          <span className="text-xs text-handoff-muted">{label}</span>
        </div>
        <span className="text-sm font-medium text-white">{value}</span>
      </div>
      <div className="h-1.5 bg-handoff-dark rounded-full overflow-hidden">
        <div 
          className={`h-full ${color.replace('text-', 'bg-')}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export default function CostDashboard({
  isVisible,
  currentTask,
  history = [],
  onClose: _onClose,
}: CostDashboardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [liveBreakdown, setLiveBreakdown] = useState<CostBreakdown>({
    screenshots: 0,
    apiCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
  });

  useEffect(() => {
    if (currentTask) {
      setLiveBreakdown(currentTask.breakdown);
    }
  }, [currentTask]);

  if (!isVisible) return null;

  const totalCost = liveBreakdown.estimatedCost;
  const sessionCost = history.reduce((sum, t) => sum + t.breakdown.estimatedCost, 0) + totalCost;

  return (
    <div className="bg-handoff-surface border-t border-handoff-dark">
      {/* Compact header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-handoff-dark/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-green-400" />
          <span className="text-sm text-white">Cost Tracker</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-green-400">{formatCost(totalCost)}</span>
          {isExpanded ? <ChevronDown className="w-4 h-4 text-handoff-muted" /> : <ChevronUp className="w-4 h-4 text-handoff-muted" />}
        </div>
      </button>

      {/* Expanded view */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Current task breakdown */}
          <div className="grid grid-cols-2 gap-2">
            <CostMeter
              label="Screenshots"
              value={liveBreakdown.screenshots}
              max={100}
              icon={Image}
              color="text-blue-400"
            />
            <CostMeter
              label="API Calls"
              value={liveBreakdown.apiCalls}
              max={50}
              icon={Brain}
              color="text-purple-400"
            />
          </div>

          {/* Token usage */}
          <div className="bg-handoff-dark/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-yellow-400" />
              <span className="text-xs font-medium text-white">Token Usage</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-handoff-muted text-xs">Input</div>
                <div className="text-white font-medium">{formatTokens(liveBreakdown.inputTokens)}</div>
              </div>
              <div>
                <div className="text-handoff-muted text-xs">Output</div>
                <div className="text-white font-medium">{formatTokens(liveBreakdown.outputTokens)}</div>
              </div>
            </div>
          </div>

          {/* Cost breakdown */}
          <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-green-400">This task</span>
              <span className="text-lg font-bold text-green-400">{formatCost(totalCost)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-handoff-muted">
              <span>Session total</span>
              <span>{formatCost(sessionCost)}</span>
            </div>
          </div>

          {/* Pricing info */}
          <div className="text-xs text-handoff-muted text-center">
            <span>Gemini 2.0 Flash: </span>
            <span className="text-handoff-primary">${PRICING.inputTokenPer1M}/1M input</span>
            <span> • </span>
            <span className="text-handoff-primary">${PRICING.outputTokenPer1M}/1M output</span>
          </div>

          {/* History */}
          {history.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-3.5 h-3.5 text-handoff-muted" />
                <span className="text-xs text-handoff-muted">Recent tasks</span>
              </div>
              <div className="space-y-1">
                {history.slice(-3).map((task) => (
                  <div key={task.taskId} className="flex items-center justify-between text-xs bg-handoff-dark/30 rounded px-2 py-1.5">
                    <span className="text-handoff-muted truncate max-w-[150px]">{task.taskName}</span>
                    <span className="text-white">{formatCost(task.breakdown.estimatedCost)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Hook to track costs in real-time
export function useCostTracker() {
  const [breakdown, setBreakdown] = useState<CostBreakdown>({
    screenshots: 0,
    apiCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
  });

  const recordScreenshot = () => {
    setBreakdown(prev => {
      const newScreenshots = prev.screenshots + 1;
      // Cost is added directly
      return {
        ...prev,
        screenshots: newScreenshots,
        estimatedCost: prev.estimatedCost + PRICING.imagePer1K,
      };
    });
  };

  const recordApiCall = (inputTokens: number, outputTokens: number) => {
    setBreakdown(prev => {
      const inputCost = (inputTokens / 1000000) * PRICING.inputTokenPer1M;
      const outputCost = (outputTokens / 1000000) * PRICING.outputTokenPer1M;
      return {
        ...prev,
        apiCalls: prev.apiCalls + 1,
        inputTokens: prev.inputTokens + inputTokens,
        outputTokens: prev.outputTokens + outputTokens,
        estimatedCost: prev.estimatedCost + inputCost + outputCost,
      };
    });
  };

  const reset = () => {
    setBreakdown({
      screenshots: 0,
      apiCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
    });
  };

  return { breakdown, recordScreenshot, recordApiCall, reset };
}
