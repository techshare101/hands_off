// 🔒 GUARDRAILS AGENT — Persistent Usage Tracking
// Uses chrome.storage.local for cross-session persistence

export interface UsageData {
  tasksToday: number;
  actionsThisTask: number;
  screenshotsThisTask: number;
  lastResetDate: string;
  totalTasksAllTime: number;
  tier: 'free' | 'pro';
}

export interface UsageLimits {
  maxTasksPerDay: number;
  maxActionsPerTask: number;
  maxScreenshotsPerTask: number;
}

export const FREE_LIMITS: UsageLimits = {
  maxTasksPerDay: 10,
  maxActionsPerTask: 50,
  maxScreenshotsPerTask: 100,
};

export const PRO_LIMITS: UsageLimits = {
  maxTasksPerDay: 100,
  maxActionsPerTask: 200,
  maxScreenshotsPerTask: 500,
};

const STORAGE_KEY = 'handoff_usage';

class UsageTrackerService {
  private data: UsageData | null = null;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const today = new Date().toISOString().split('T')[0];
    
    if (result[STORAGE_KEY]) {
      this.data = result[STORAGE_KEY];
      
      // Reset daily counters if new day
      if (this.data!.lastResetDate !== today) {
        this.data!.tasksToday = 0;
        this.data!.lastResetDate = today;
        await this.save();
      }
    } else {
      // First time setup
      this.data = {
        tasksToday: 0,
        actionsThisTask: 0,
        screenshotsThisTask: 0,
        lastResetDate: today,
        totalTasksAllTime: 0,
        tier: 'free',
      };
      await this.save();
    }
    
    this.initialized = true;
  }

  private async save(): Promise<void> {
    if (this.data) {
      await chrome.storage.local.set({ [STORAGE_KEY]: this.data });
    }
  }

  async getData(): Promise<UsageData> {
    await this.init();
    return { ...this.data! };
  }

  getLimits(): UsageLimits {
    return this.data?.tier === 'pro' ? PRO_LIMITS : FREE_LIMITS;
  }

  async canStartTask(): Promise<{ allowed: boolean; reason?: string }> {
    await this.init();
    const limits = this.getLimits();
    
    if (this.data!.tasksToday >= limits.maxTasksPerDay) {
      return {
        allowed: false,
        reason: this.data!.tier === 'free' 
          ? `Daily limit reached (${limits.maxTasksPerDay} tasks). Upgrade to Pro for more.`
          : `Daily limit reached (${limits.maxTasksPerDay} tasks).`,
      };
    }
    
    return { allowed: true };
  }

  async canPerformAction(): Promise<{ allowed: boolean; reason?: string }> {
    await this.init();
    const limits = this.getLimits();
    
    if (this.data!.actionsThisTask >= limits.maxActionsPerTask) {
      return {
        allowed: false,
        reason: `Action limit reached for this task (${limits.maxActionsPerTask}). Try breaking into smaller tasks.`,
      };
    }
    
    return { allowed: true };
  }

  async startTask(): Promise<void> {
    await this.init();
    this.data!.tasksToday++;
    this.data!.totalTasksAllTime++;
    this.data!.actionsThisTask = 0;
    this.data!.screenshotsThisTask = 0;
    await this.save();
  }

  async recordAction(): Promise<void> {
    await this.init();
    this.data!.actionsThisTask++;
    await this.save();
  }

  async recordScreenshot(): Promise<void> {
    await this.init();
    this.data!.screenshotsThisTask++;
    await this.save();
  }

  async upgradeToPro(): Promise<void> {
    await this.init();
    this.data!.tier = 'pro';
    await this.save();
  }

  async getUsageSummary(): Promise<{
    tasksUsed: number;
    tasksLimit: number;
    actionsUsed: number;
    actionsLimit: number;
    tier: string;
    percentUsed: number;
  }> {
    await this.init();
    const limits = this.getLimits();
    
    return {
      tasksUsed: this.data!.tasksToday,
      tasksLimit: limits.maxTasksPerDay,
      actionsUsed: this.data!.actionsThisTask,
      actionsLimit: limits.maxActionsPerTask,
      tier: this.data!.tier,
      percentUsed: Math.round((this.data!.tasksToday / limits.maxTasksPerDay) * 100),
    };
  }
}

// Singleton
export const usageTracker = new UsageTrackerService();
