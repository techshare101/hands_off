// TelemetryService — Local event tracking with MV3-safe buffered persistence
// Uses chrome.storage.local for durability across service worker suspensions
// and chrome.alarms for periodic flush.

const STORAGE_BUFFER = 'handoff_telemetry_buffer';
const STORAGE_METRICS = 'handoff_telemetry_metrics';
const FLUSH_ALARM = 'handoff_telemetry_flush';
const FLUSH_INTERVAL_MINUTES = 15;
const MAX_BUFFER_SIZE = 50;

// ── Types ────────────────────────────────────────────────────────────

export type TelemetryEventType =
  | 'tool_usage'
  | 'routing_decision'
  | 'error'
  | 'sw_wakeup'
  | 'connection_status'
  | 'task_start'
  | 'task_complete'
  | 'task_error';

export interface TelemetryEvent {
  type: TelemetryEventType;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface TelemetryMetrics {
  totalEvents: number;
  errorCount: number;
  errorRate: number;
  toolUsage: Record<string, number>;
  routingDecisions: Record<string, number>;
  taskCount: number;
  taskSuccessCount: number;
  swWakeups: number;
  lastFlush: number;
  firstEventAt: number;
}

// ── Service ──────────────────────────────────────────────────────────

class TelemetryServiceEngine {
  private buffer: TelemetryEvent[] = [];
  private metrics: TelemetryMetrics = this.defaultMetrics();
  private initialized = false;
  private flushInProgress = false;

  private defaultMetrics(): TelemetryMetrics {
    return {
      totalEvents: 0,
      errorCount: 0,
      errorRate: 0,
      toolUsage: {},
      routingDecisions: {},
      taskCount: 0,
      taskSuccessCount: 0,
      swWakeups: 0,
      lastFlush: Date.now(),
      firstEventAt: 0,
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const data = await chrome.storage.local.get([STORAGE_BUFFER, STORAGE_METRICS]);
      if (data[STORAGE_BUFFER]) this.buffer = data[STORAGE_BUFFER];
      if (data[STORAGE_METRICS]) this.metrics = { ...this.defaultMetrics(), ...data[STORAGE_METRICS] };
    } catch (e) {
      console.warn('[Telemetry] Failed to load persisted data:', e);
    }

    // Set up periodic flush via alarm (survives SW suspension)
    try {
      await chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_INTERVAL_MINUTES });
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === FLUSH_ALARM) this.flush();
      });
    } catch (e) {
      console.warn('[Telemetry] Failed to create flush alarm:', e);
    }

    this.track('sw_wakeup', { reason: 'init' });
    console.log(`[Telemetry] Initialized: ${this.buffer.length} buffered events, ${this.metrics.totalEvents} total`);
  }

  // ── Public API ──────────────────────────────────────────────────

  track(type: TelemetryEventType, payload: Record<string, unknown> = {}): void {
    const event: TelemetryEvent = { type, timestamp: Date.now(), payload };
    this.buffer.push(event);
    this.updateMetrics(event);

    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.flush();
    } else {
      this.persistBuffer();
    }
  }

  async flush(): Promise<void> {
    if (this.flushInProgress || this.buffer.length === 0) return;
    this.flushInProgress = true;

    try {
      console.log(`[Telemetry] Flushing ${this.buffer.length} events`);
      this.buffer = [];
      this.metrics.lastFlush = Date.now();
      await Promise.all([this.persistBuffer(), this.persistMetrics()]);
    } catch (e) {
      console.error('[Telemetry] Flush failed:', e);
    } finally {
      this.flushInProgress = false;
    }
  }

  async getMetrics(): Promise<TelemetryMetrics> {
    if (!this.initialized) {
      try {
        const data = await chrome.storage.local.get(STORAGE_METRICS);
        if (data[STORAGE_METRICS]) return { ...this.defaultMetrics(), ...data[STORAGE_METRICS] };
      } catch { /* fall through */ }
    }
    return { ...this.metrics };
  }

  async getBuffer(): Promise<TelemetryEvent[]> {
    return [...this.buffer];
  }

  async reset(): Promise<void> {
    this.buffer = [];
    this.metrics = this.defaultMetrics();
    await chrome.storage.local.remove([STORAGE_BUFFER, STORAGE_METRICS]);
    console.log('[Telemetry] Reset');
  }

  // ── Internal ────────────────────────────────────────────────────

  private updateMetrics(event: TelemetryEvent): void {
    this.metrics.totalEvents++;

    if (!this.metrics.firstEventAt) {
      this.metrics.firstEventAt = event.timestamp;
    }

    switch (event.type) {
      case 'error':
      case 'task_error':
        this.metrics.errorCount++;
        this.metrics.errorRate = this.metrics.errorCount / this.metrics.totalEvents;
        break;

      case 'tool_usage': {
        const toolName = String(event.payload.toolName || 'unknown');
        this.metrics.toolUsage[toolName] = (this.metrics.toolUsage[toolName] || 0) + 1;
        break;
      }

      case 'routing_decision': {
        const route = String(event.payload.route || 'unknown');
        this.metrics.routingDecisions[route] = (this.metrics.routingDecisions[route] || 0) + 1;
        break;
      }

      case 'task_start':
        this.metrics.taskCount++;
        break;

      case 'task_complete':
        this.metrics.taskSuccessCount++;
        break;

      case 'sw_wakeup':
        this.metrics.swWakeups++;
        break;
    }

    this.persistMetrics();
  }

  private async persistBuffer(): Promise<void> {
    try {
      await chrome.storage.local.set({ [STORAGE_BUFFER]: this.buffer });
    } catch (e) {
      console.warn('[Telemetry] Buffer persist failed:', e);
    }
  }

  private async persistMetrics(): Promise<void> {
    try {
      await chrome.storage.local.set({ [STORAGE_METRICS]: this.metrics });
    } catch (e) {
      console.warn('[Telemetry] Metrics persist failed:', e);
    }
  }
}

// Singleton
export const telemetry = new TelemetryServiceEngine();
