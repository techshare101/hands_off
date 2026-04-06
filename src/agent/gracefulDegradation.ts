// 🔄 GRACEFUL DEGRADATION — Partial completion instead of total failure
// Users are crying for: "It fails completely instead of saving my progress"

export interface TaskProgress {
  taskId: string;
  task: string;
  startedAt: number;
  completedSteps: CompletedStep[];
  pendingSteps: string[];
  failedStep?: FailedStep;
  overallProgress: number; // 0-100
  canResume: boolean;
  partialResult?: string;
}

export interface CompletedStep {
  stepNumber: number;
  description: string;
  action: {
    type: string;
    target?: string;
  };
  screenshot?: string;
  timestamp: number;
}

export interface FailedStep {
  stepNumber: number;
  description: string;
  error: string;
  recoveryOptions: RecoveryOption[];
  screenshot?: string;
}

export interface RecoveryOption {
  id: string;
  label: string;
  description: string;
  action: 'retry' | 'skip' | 'alternative' | 'manual' | 'abort';
}

export class GracefulDegradationManager {
  private progress: TaskProgress | null = null;
  private checkpointInterval = 5000; // Save checkpoint every 5 seconds
  private lastCheckpoint = 0;

  startTask(taskId: string, task: string): void {
    this.progress = {
      taskId,
      task,
      startedAt: Date.now(),
      completedSteps: [],
      pendingSteps: [],
      overallProgress: 0,
      canResume: true,
    };
    this.saveCheckpoint();
  }

  recordStep(step: Omit<CompletedStep, 'stepNumber' | 'timestamp'>): void {
    if (!this.progress) return;

    const completedStep: CompletedStep = {
      ...step,
      stepNumber: this.progress.completedSteps.length + 1,
      timestamp: Date.now(),
    };

    this.progress.completedSteps.push(completedStep);
    this.updateProgress();
    
    // Auto-checkpoint
    if (Date.now() - this.lastCheckpoint > this.checkpointInterval) {
      this.saveCheckpoint();
    }
  }

  recordFailure(error: string, description: string, screenshot?: string): FailedStep {
    if (!this.progress) {
      throw new Error('No active task');
    }

    const failedStep: FailedStep = {
      stepNumber: this.progress.completedSteps.length + 1,
      description,
      error,
      screenshot,
      recoveryOptions: this.generateRecoveryOptions(error),
    };

    this.progress.failedStep = failedStep;
    this.progress.canResume = true;
    this.saveCheckpoint();

    return failedStep;
  }

  private generateRecoveryOptions(error: string): RecoveryOption[] {
    const options: RecoveryOption[] = [];

    // Always offer retry
    options.push({
      id: 'retry',
      label: 'Try Again',
      description: 'Retry the failed step with the same approach',
      action: 'retry',
    });

    // Offer skip if not critical
    if (!this.isCriticalError(error)) {
      options.push({
        id: 'skip',
        label: 'Skip This Step',
        description: 'Skip this step and continue with the next one',
        action: 'skip',
      });
    }

    // Offer alternative approach
    options.push({
      id: 'alternative',
      label: 'Try Different Approach',
      description: 'Let the agent try a different way to accomplish this',
      action: 'alternative',
    });

    // Offer manual intervention
    options.push({
      id: 'manual',
      label: 'I\'ll Do It',
      description: 'Complete this step manually, then continue automation',
      action: 'manual',
    });

    // Always offer abort with partial save
    options.push({
      id: 'abort',
      label: 'Stop Here',
      description: 'Stop the task and save what was completed',
      action: 'abort',
    });

    return options;
  }

  private isCriticalError(error: string): boolean {
    const criticalPatterns = [
      'authentication',
      'permission denied',
      'access denied',
      'payment',
      'security',
    ];
    const lowerError = error.toLowerCase();
    return criticalPatterns.some(pattern => lowerError.includes(pattern));
  }

  private updateProgress(): void {
    if (!this.progress) return;

    // Estimate progress based on completed steps
    // This is a heuristic - in practice, you'd want task-specific estimates
    const estimatedTotalSteps = Math.max(
      this.progress.completedSteps.length + this.progress.pendingSteps.length,
      this.progress.completedSteps.length + 3 // Assume at least 3 more steps
    );
    
    this.progress.overallProgress = Math.round(
      (this.progress.completedSteps.length / estimatedTotalSteps) * 100
    );
  }

  getProgress(): TaskProgress | null {
    return this.progress;
  }

  getPartialResult(): string | null {
    if (!this.progress || this.progress.completedSteps.length === 0) {
      return null;
    }

    const completedActions = this.progress.completedSteps
      .map((step, i) => `${i + 1}. ${step.description}`)
      .join('\n');

    return `Partial completion (${this.progress.overallProgress}%):\n\n${completedActions}`;
  }

  async saveCheckpoint(): Promise<void> {
    if (!this.progress) return;

    try {
      await chrome.storage.local.set({
        [`task_checkpoint_${this.progress.taskId}`]: {
          ...this.progress,
          savedAt: Date.now(),
        },
      });
      this.lastCheckpoint = Date.now();
    } catch (error) {
      console.error('[GracefulDegradation] Failed to save checkpoint:', error);
    }
  }

  async loadCheckpoint(taskId: string): Promise<TaskProgress | null> {
    try {
      const result = await chrome.storage.local.get(`task_checkpoint_${taskId}`);
      return result[`task_checkpoint_${taskId}`] || null;
    } catch {
      return null;
    }
  }

  async resumeFromCheckpoint(taskId: string): Promise<TaskProgress | null> {
    const checkpoint = await this.loadCheckpoint(taskId);
    if (checkpoint && checkpoint.canResume) {
      this.progress = checkpoint;
      return checkpoint;
    }
    return null;
  }

  clearProgress(): void {
    if (this.progress) {
      chrome.storage.local.remove(`task_checkpoint_${this.progress.taskId}`);
    }
    this.progress = null;
  }

  complete(partialResult?: string): TaskProgress | null {
    if (!this.progress) return null;

    this.progress.overallProgress = 100;
    this.progress.partialResult = partialResult;
    this.progress.canResume = false;
    this.saveCheckpoint();

    return this.progress;
  }
}

// Singleton instance
export const gracefulDegradation = new GracefulDegradationManager();
