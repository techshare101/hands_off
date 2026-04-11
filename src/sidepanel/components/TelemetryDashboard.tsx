"use client";

import { useEffect, useState } from 'react';
import { BarChart3, Activity, AlertTriangle, RefreshCw, Trash2, Zap } from 'lucide-react';
import type { TelemetryMetrics } from '../../agent/telemetryService';

export default function TelemetryDashboard() {
  const [metrics, setMetrics] = useState<TelemetryMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMetrics = async () => {
    setLoading(true);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'TELEMETRY_GET_METRICS' });
      if (res?.success && res.metrics) setMetrics(res.metrics);
    } catch (e) {
      console.error('[TelemetryDashboard] Failed to load metrics:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadMetrics();

    // Auto-refresh when metrics change in storage
    const listener = (changes: Record<string, chrome.storage.StorageChange>, namespace: string) => {
      if (namespace === 'local' && changes.handoff_telemetry_metrics) {
        setMetrics(changes.handoff_telemetry_metrics.newValue);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const handleFlush = async () => {
    await chrome.runtime.sendMessage({ type: 'TELEMETRY_FLUSH' });
    await loadMetrics();
  };

  const handleReset = async () => {
    await chrome.runtime.sendMessage({ type: 'TELEMETRY_RESET' });
    await loadMetrics();
  };

  if (loading && !metrics) {
    return <div className="text-handoff-muted text-sm text-center py-6">Loading telemetry...</div>;
  }

  if (!metrics) {
    return <div className="text-handoff-muted text-sm text-center py-6">No telemetry data yet.</div>;
  }

  const healthStatus = metrics.errorRate < 0.05 ? 'Healthy' : metrics.errorRate < 0.15 ? 'Degraded' : 'Critical';
  const healthColor = healthStatus === 'Healthy' ? 'text-green-400' : healthStatus === 'Degraded' ? 'text-yellow-400' : 'text-red-400';
  const healthBg = healthStatus === 'Healthy' ? 'bg-green-500/10 border-green-500/20' : healthStatus === 'Degraded' ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-red-500/10 border-red-500/20';

  const taskSuccessRate = metrics.taskCount > 0
    ? Math.round((metrics.taskSuccessCount / metrics.taskCount) * 100)
    : 0;

  const topTools = Object.entries(metrics.toolUsage)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

  const topRoutes = Object.entries(metrics.routingDecisions)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4);

  const maxToolCount = topTools.length > 0 ? topTools[0][1] : 1;

  const uptimeMs = Date.now() - (metrics.firstEventAt || Date.now());
  const uptimeHours = Math.max(0, Math.round(uptimeMs / 3600000 * 10) / 10);

  return (
    <div className="space-y-4">
      {/* System Health Banner */}
      <div className={`${healthBg} border rounded-xl p-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <Activity className={`w-4 h-4 ${healthColor}`} />
          <span className={`text-sm font-semibold ${healthColor}`}>{healthStatus}</span>
          <span className="text-xs text-handoff-muted">
            {metrics.errorRate > 0 ? `${(metrics.errorRate * 100).toFixed(1)}% error rate` : 'No errors'}
          </span>
        </div>
        <button onClick={handleFlush} className="p-1.5 hover:bg-white/5 rounded-lg transition-colors" title="Flush buffer">
          <RefreshCw className="w-3.5 h-3.5 text-handoff-muted" />
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard icon={<BarChart3 className="w-3.5 h-3.5 text-blue-400" />} label="Total Events" value={metrics.totalEvents.toLocaleString()} />
        <StatCard icon={<AlertTriangle className="w-3.5 h-3.5 text-red-400" />} label="Errors" value={metrics.errorCount.toLocaleString()} />
        <StatCard icon={<Zap className="w-3.5 h-3.5 text-yellow-400" />} label="SW Wakeups" value={metrics.swWakeups.toLocaleString()} />
        <StatCard
          icon={<Activity className="w-3.5 h-3.5 text-green-400" />}
          label="Tasks"
          value={`${metrics.taskSuccessCount}/${metrics.taskCount}`}
          sub={metrics.taskCount > 0 ? `${taskSuccessRate}% success` : undefined}
        />
      </div>

      {/* Top Tools */}
      {topTools.length > 0 && (
        <div className="bg-handoff-dark/50 rounded-xl p-3">
          <div className="text-xs text-handoff-muted mb-2 font-medium">Top Tools Used</div>
          <div className="space-y-1.5">
            {topTools.map(([tool, count]) => (
              <div key={tool} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-gray-300 truncate">{tool}</span>
                    <span className="font-mono text-blue-400 ml-2">{count}</span>
                  </div>
                  <div className="w-full bg-handoff-dark rounded-full h-1">
                    <div
                      className="bg-blue-500/60 h-1 rounded-full transition-all"
                      style={{ width: `${Math.round((count / maxToolCount) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Routing Decisions */}
      {topRoutes.length > 0 && (
        <div className="bg-handoff-dark/50 rounded-xl p-3">
          <div className="text-xs text-handoff-muted mb-2 font-medium">Routing Decisions</div>
          <div className="flex flex-wrap gap-1.5">
            {topRoutes.map(([route, count]) => (
              <span key={route} className="inline-flex items-center gap-1 px-2 py-1 bg-purple-500/10 border border-purple-500/20 rounded-md text-xs">
                <span className="text-purple-300">{route}</span>
                <span className="text-purple-400 font-mono">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-handoff-muted">
        <span>Uptime: {uptimeHours}h | Last flush: {new Date(metrics.lastFlush).toLocaleTimeString()}</span>
        <button
          onClick={handleReset}
          className="flex items-center gap-1 px-2 py-1 hover:bg-red-500/10 hover:text-red-400 rounded transition-colors"
        >
          <Trash2 className="w-3 h-3" /> Reset
        </button>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-handoff-dark/50 rounded-xl p-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs text-handoff-muted">{label}</span>
      </div>
      <div className="text-lg font-semibold text-white leading-tight">{value}</div>
      {sub && <div className="text-xs text-handoff-muted mt-0.5">{sub}</div>}
    </div>
  );
}
