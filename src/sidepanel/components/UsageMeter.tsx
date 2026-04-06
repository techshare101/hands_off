// 🔒 GUARDRAILS AGENT — Usage Meter UI
// Shows remaining tasks and soft paywall

import { useEffect, useState } from 'react';
import { Zap, Crown, AlertCircle } from 'lucide-react';

interface UsageData {
  tasksUsed: number;
  tasksLimit: number;
  tier: string;
  percentUsed: number;
}

export default function UsageMeter() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  useEffect(() => {
    loadUsage();
  }, []);

  const loadUsage = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_USAGE' });
      if (response.success) {
        setUsage(response.usage);
      }
    } catch {
      // Fallback for when background isn't ready
      setUsage({
        tasksUsed: 0,
        tasksLimit: 10,
        tier: 'free',
        percentUsed: 0,
      });
    }
  };

  if (!usage) return null;

  const remaining = usage.tasksLimit - usage.tasksUsed;
  const isLow = remaining <= 2;
  const isOut = remaining <= 0;

  return (
    <>
      <div 
        className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs cursor-pointer transition-colors ${
          isOut ? 'bg-red-500/20 text-red-400' :
          isLow ? 'bg-orange-500/20 text-orange-400' :
          'bg-handoff-dark text-handoff-muted hover:text-white'
        }`}
        onClick={() => setShowUpgrade(true)}
      >
        {usage.tier === 'pro' ? (
          <Crown className="w-3.5 h-3.5 text-yellow-400" />
        ) : (
          <Zap className="w-3.5 h-3.5" />
        )}
        <span>{remaining} tasks left</span>
      </div>

      {/* Upgrade Modal */}
      {showUpgrade && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-handoff-surface rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="p-4">
              {/* Header */}
              <div className="text-center mb-4">
                {isOut ? (
                  <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                    <AlertCircle className="w-6 h-6 text-red-400" />
                  </div>
                ) : (
                  <div className="w-12 h-12 bg-handoff-primary/20 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Zap className="w-6 h-6 text-handoff-primary" />
                  </div>
                )}
                <h3 className="text-lg font-semibold text-white">
                  {isOut ? "You're out of tasks" : 'Usage'}
                </h3>
                <p className="text-sm text-handoff-muted mt-1">
                  {isOut 
                    ? 'Upgrade to Pro for unlimited automation'
                    : `${usage.tasksUsed} of ${usage.tasksLimit} tasks used today`
                  }
                </p>
              </div>

              {/* Progress bar */}
              <div className="mb-4">
                <div className="h-2 bg-handoff-dark rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      isOut ? 'bg-red-500' : isLow ? 'bg-orange-500' : 'bg-handoff-primary'
                    }`}
                    style={{ width: `${Math.min(usage.percentUsed, 100)}%` }}
                  />
                </div>
              </div>

              {/* Tier comparison */}
              <div className="space-y-2 mb-4">
                <div className={`flex items-center justify-between p-2 rounded-lg ${
                  usage.tier === 'free' ? 'bg-handoff-dark' : 'bg-handoff-dark/50'
                }`}>
                  <span className="text-sm text-white">Free</span>
                  <span className="text-xs text-handoff-muted">10 tasks/day</span>
                </div>
                <div className={`flex items-center justify-between p-2 rounded-lg border ${
                  usage.tier === 'pro' 
                    ? 'bg-yellow-500/10 border-yellow-500/30' 
                    : 'bg-handoff-dark/50 border-transparent'
                }`}>
                  <div className="flex items-center gap-2">
                    <Crown className="w-4 h-4 text-yellow-400" />
                    <span className="text-sm text-white">Pro</span>
                  </div>
                  <span className="text-xs text-handoff-muted">100 tasks/day</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => setShowUpgrade(false)}
                  className="flex-1 bg-handoff-dark hover:bg-handoff-dark/70 text-white text-sm font-medium py-2.5 px-4 rounded-xl transition-colors"
                >
                  Maybe later
                </button>
                {usage.tier === 'free' && (
                  <button
                    onClick={() => {
                      // TODO: Stripe integration
                      window.open('https://handoff.dev/pro', '_blank');
                    }}
                    className="flex-1 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 text-white text-sm font-medium py-2.5 px-4 rounded-xl transition-colors"
                  >
                    Upgrade
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
