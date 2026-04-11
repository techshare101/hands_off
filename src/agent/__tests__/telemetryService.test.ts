// TelemetryService Integration Tests
// Validates event tracking, metrics computation, buffer management, flush, and reset

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock chrome APIs ────────────────────────────────────────────────

const storageData: Record<string, unknown> = {};
const alarmListeners: Array<(alarm: { name: string }) => void> = [];

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const result: Record<string, unknown> = {};
        const keyArr = Array.isArray(keys) ? keys : [keys];
        for (const k of keyArr) {
          if (k in storageData) result[k] = storageData[k];
        }
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(storageData, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const keyArr = Array.isArray(keys) ? keys : [keys];
        for (const k of keyArr) delete storageData[k];
      }),
    },
    onChanged: { addListener: vi.fn() },
  },
  alarms: {
    create: vi.fn(async () => {}),
    onAlarm: {
      addListener: vi.fn((fn: typeof alarmListeners[0]) => {
        alarmListeners.push(fn);
      }),
    },
  },
});

// ── Import after mocks ──────────────────────────────────────────────

// We import the class fresh for each test by dynamically importing
// But since it's a singleton module, we need a workaround.
// Instead, we'll test via the exported singleton and reset between tests.

const { telemetry } = await import('../telemetryService');

// ── Tests ───────────────────────────────────────────────────────────

describe('TelemetryService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const k of Object.keys(storageData)) delete storageData[k];
    await telemetry.reset();
  });

  // ── Initialization ──────────────────────────────────────────────

  it('init sets up alarm and tracks sw_wakeup', async () => {
    await telemetry.init();

    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'handoff_telemetry_flush',
      expect.objectContaining({ periodInMinutes: 15 })
    );

    const metrics = await telemetry.getMetrics();
    expect(metrics.swWakeups).toBeGreaterThanOrEqual(1);
    expect(metrics.totalEvents).toBeGreaterThanOrEqual(1);
  });

  // ── Event Tracking ──────────────────────────────────────────────

  it('tracks tool_usage events and updates toolUsage metrics', async () => {
    telemetry.track('tool_usage', { toolName: 'click' });
    telemetry.track('tool_usage', { toolName: 'click' });
    telemetry.track('tool_usage', { toolName: 'type' });

    const metrics = await telemetry.getMetrics();
    expect(metrics.toolUsage.click).toBe(2);
    expect(metrics.toolUsage.type).toBe(1);
  });

  it('tracks error events and computes error rate', async () => {
    // Track some events to establish a baseline
    telemetry.track('tool_usage', { toolName: 'scroll' });
    telemetry.track('tool_usage', { toolName: 'scroll' });
    telemetry.track('error', { message: 'Something failed' });

    const metrics = await telemetry.getMetrics();
    expect(metrics.errorCount).toBeGreaterThanOrEqual(1);
    expect(metrics.errorRate).toBeGreaterThan(0);
    expect(metrics.errorRate).toBeLessThanOrEqual(1);
  });

  it('tracks task lifecycle events', async () => {
    telemetry.track('task_start', { task: 'Search Google' });
    telemetry.track('task_complete', { task: 'Search Google' });
    telemetry.track('task_start', { task: 'Fill form' });
    telemetry.track('task_error', { task: 'Fill form', error: 'timeout' });

    const metrics = await telemetry.getMetrics();
    expect(metrics.taskCount).toBe(2);
    expect(metrics.taskSuccessCount).toBe(1);
  });

  it('tracks routing_decision events', async () => {
    telemetry.track('routing_decision', { route: 'mcp' });
    telemetry.track('routing_decision', { route: 'mcp' });
    telemetry.track('routing_decision', { route: 'browser' });

    const metrics = await telemetry.getMetrics();
    expect(metrics.routingDecisions.mcp).toBe(2);
    expect(metrics.routingDecisions.browser).toBe(1);
  });

  it('tracks connection_status events', async () => {
    telemetry.track('connection_status', { app: 'github', status: 'connected' });

    const metrics = await telemetry.getMetrics();
    expect(metrics.totalEvents).toBeGreaterThanOrEqual(1);
  });

  // ── Buffer Management ───────────────────────────────────────────

  it('persists buffer to chrome.storage', async () => {
    telemetry.track('tool_usage', { toolName: 'navigate' });

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        handoff_telemetry_buffer: expect.arrayContaining([
          expect.objectContaining({ type: 'tool_usage' }),
        ]),
      })
    );
  });

  it('persists metrics to chrome.storage', async () => {
    telemetry.track('tool_usage', { toolName: 'click' });

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        handoff_telemetry_metrics: expect.objectContaining({
          totalEvents: expect.any(Number),
        }),
      })
    );
  });

  // ── Flush ───────────────────────────────────────────────────────

  it('flush clears buffer and updates lastFlush', async () => {
    telemetry.track('tool_usage', { toolName: 'click' });
    telemetry.track('error', { message: 'test error' });

    const beforeFlush = await telemetry.getBuffer();
    expect(beforeFlush.length).toBeGreaterThan(0);

    await telemetry.flush();

    const afterFlush = await telemetry.getBuffer();
    expect(afterFlush.length).toBe(0);

    const metrics = await telemetry.getMetrics();
    expect(metrics.lastFlush).toBeGreaterThan(0);
    // Metrics are preserved after flush (only buffer is cleared)
    expect(metrics.totalEvents).toBeGreaterThan(0);
  });

  it('flush is a no-op when buffer is empty', async () => {
    await telemetry.flush();
    // Should not throw or corrupt state
    const metrics = await telemetry.getMetrics();
    expect(metrics).toBeDefined();
  });

  // ── Reset ───────────────────────────────────────────────────────

  it('reset clears all data', async () => {
    telemetry.track('tool_usage', { toolName: 'click' });
    telemetry.track('error', { message: 'err' });

    await telemetry.reset();

    const metrics = await telemetry.getMetrics();
    expect(metrics.totalEvents).toBe(0);
    expect(metrics.errorCount).toBe(0);
    expect(metrics.swWakeups).toBe(0);
    expect(Object.keys(metrics.toolUsage)).toHaveLength(0);

    expect(chrome.storage.local.remove).toHaveBeenCalledWith([
      'handoff_telemetry_buffer',
      'handoff_telemetry_metrics',
    ]);
  });

  // ── firstEventAt ────────────────────────────────────────────────

  it('sets firstEventAt on first event', async () => {
    const before = Date.now();
    telemetry.track('tool_usage', { toolName: 'test' });
    const after = Date.now();

    const metrics = await telemetry.getMetrics();
    expect(metrics.firstEventAt).toBeGreaterThanOrEqual(before);
    expect(metrics.firstEventAt).toBeLessThanOrEqual(after);
  });
});
