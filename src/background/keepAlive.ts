// ═══════════════════════════════════════════════════════════════════════════
// MV3 Service Worker Keep-Alive + State Checkpoint/Resume
// Prevents Chrome from killing the agent during long-running tasks.
// ═══════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'handoff_agent_checkpoint';
const HEARTBEAT_INTERVAL_MINUTES = 0.5; // 30 seconds
const IDLE_TIMEOUT_MS = 25000; // Chrome kills SW after ~30s idle

// ── Types ─────────────────────────────────────────────────────────────────

export interface AgentCheckpoint {
  taskId: string;
  task: string;
  tabId: number;
  iteration: number;
  actionHistory: unknown[];
  correctionContext: string | null;
  retryCount: number;
  consecutiveScrolls: number;
  lastActionSignature: string | null;
  timestamp: number;
  isRunning: boolean;
  autonomyLevel: 'cautious' | 'balanced' | 'autonomous';
}

interface KeepAliveState {
  lastHeartbeat: number;
  activeTaskId: string | null;
  checkpointExists: boolean;
}

// ── Keep-Alive Engine ──────────────────────────────────────────────────────

class KeepAliveEngine {
  private state: KeepAliveState = {
    lastHeartbeat: 0,
    activeTaskId: null,
    checkpointExists: false,
  };
  private heartbeatAlarmName = 'handoff-agent-heartbeat';
  private isInitialized = false;

  // ── Initialization ─────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.isInitialized) return;

    // Check if alarms API is available (it should be in service worker)
    if (typeof chrome === 'undefined' || !chrome.alarms) {
      console.warn('[KeepAlive] chrome.alarms API not available, skipping keep-alive');
      this.isInitialized = true;
      return;
    }

    try {
      // Create the heartbeat alarm
      await chrome.alarms.create(this.heartbeatAlarmName, {
        periodInMinutes: HEARTBEAT_INTERVAL_MINUTES,
      });

      // Listen for alarm
      chrome.alarms.onAlarm.addListener(this.onAlarm.bind(this));
    } catch (error) {
      console.warn('[KeepAlive] Failed to create alarm:', error);
    }

    // Note: beforeunload is NOT supported in MV3 service workers
    // Instead we rely on checkpoint saves during heartbeat alarms

    // Check for existing checkpoint on startup
    await this.checkForCheckpoint();

    this.isInitialized = true;
    console.log('[KeepAlive] Initialized');
  }

  // ── Heartbeat Handler ──────────────────────────────────────────────

  private async onAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
    if (alarm.name !== this.heartbeatAlarmName) return;

    this.state.lastHeartbeat = Date.now();

    // If we have an active task, save checkpoint
    if (this.state.activeTaskId) {
      await this.saveCheckpoint();
      console.log('[KeepAlive] Heartbeat - checkpoint saved for task:', this.state.activeTaskId);
    }

    // Ping the state machine to ensure it's still responsive
    // This prevents Chrome from considering the SW "idle"
    try {
      await chrome.runtime.sendMessage({ type: 'KEEPALIVE_PING' });
    } catch {
      // Sidepanel may not be open — that's fine
    }
  }

  // ── Checkpoint Management ─────────────────────────────────────────

  async startTask(taskId: string, initialState: Omit<AgentCheckpoint, 'taskId' | 'timestamp' | 'isRunning'>): Promise<void> {
    this.state.activeTaskId = taskId;
    this.state.checkpointExists = true;

    const checkpoint: AgentCheckpoint = {
      ...initialState,
      taskId,
      timestamp: Date.now(),
      isRunning: true,
    };

    await chrome.storage.local.set({ [STORAGE_KEY]: checkpoint });
    console.log('[KeepAlive] Task started, checkpoint created:', taskId);
  }

  async saveCheckpoint(): Promise<void> {
    if (!this.state.activeTaskId) return;

    // Get current state from agentCore via message
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_AGENT_STATE' });
      if (response && response.state) {
        const checkpoint: AgentCheckpoint = {
          ...response.state,
          taskId: this.state.activeTaskId,
          timestamp: Date.now(),
          isRunning: true,
        };
        await chrome.storage.local.set({ [STORAGE_KEY]: checkpoint });
      }
    } catch (error) {
      console.warn('[KeepAlive] Failed to save checkpoint:', error);
    }
  }

  async loadCheckpoint(): Promise<AgentCheckpoint | null> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const checkpoint = result[STORAGE_KEY] as AgentCheckpoint | undefined;

      if (checkpoint && checkpoint.isRunning) {
        // Check if checkpoint is fresh (less than 5 minutes old)
        const ageMs = Date.now() - checkpoint.timestamp;
        if (ageMs < 5 * 60 * 1000) {
          this.state.checkpointExists = true;
          this.state.activeTaskId = checkpoint.taskId;
          console.log('[KeepAlive] Checkpoint loaded, age:', Math.round(ageMs / 1000), 's');
          return checkpoint;
        } else {
          console.log('[KeepAlive] Checkpoint too old, discarding');
          await this.clearCheckpoint();
        }
      }
    } catch (error) {
      console.warn('[KeepAlive] Failed to load checkpoint:', error);
    }
    return null;
  }

  async clearCheckpoint(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEY);
    this.state.checkpointExists = false;
    this.state.activeTaskId = null;
    console.log('[KeepAlive] Checkpoint cleared');
  }

  async completeTask(taskId: string): Promise<void> {
    if (this.state.activeTaskId === taskId) {
      await this.clearCheckpoint();
      console.log('[KeepAlive] Task completed:', taskId);
    }
  }

  // ── Recovery ──────────────────────────────────────────────────────

  async checkForCheckpoint(): Promise<void> {
    const checkpoint = await this.loadCheckpoint();
    if (checkpoint) {
      // Notify that we have a checkpoint to resume
      try {
        await chrome.runtime.sendMessage({
          type: 'CHECKPOINT_AVAILABLE',
          payload: checkpoint,
        });
      } catch {
        // Sidepanel not open — checkpoint will be available when it opens
      }
    }
  }

  // ── Status ─────────────────────────────────────────────────────────

  getStatus(): KeepAliveState & { isHealthy: boolean } {
    const timeSinceHeartbeat = Date.now() - this.state.lastHeartbeat;
    return {
      ...this.state,
      isHealthy: timeSinceHeartbeat < IDLE_TIMEOUT_MS,
    };
  }

  hasActiveCheckpoint(): boolean {
    return this.state.checkpointExists;
  }
}

// Singleton
export const keepAlive = new KeepAliveEngine();
