import { GeminiClient, GeminiAction } from './gemini';

export interface AgentStep {
  type: 'seeing' | 'thinking' | 'clicking' | 'typing' | 'verifying' | 'error' | 'paused';
  description: string;
  screenshot?: string;
}

export interface AgentRunnerConfig {
  tabId: number;
  task: string;
  gemini: GeminiClient;
  onStep: (step: AgentStep) => void;
  onStatus: (status: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
  isPaused: () => boolean;
}

export class AgentRunner {
  private config: AgentRunnerConfig;
  private isRunning = false;
  private shouldStop = false;
  private maxIterations = 50;
  private iteration = 0;

  constructor(config: AgentRunnerConfig) {
    this.config = config;
  }

  async run() {
    this.isRunning = true;
    this.shouldStop = false;
    this.iteration = 0;

    try {
      await this.agentLoop();
    } catch (error) {
      this.config.onError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      this.isRunning = false;
    }
  }

  private async agentLoop() {
    while (!this.shouldStop && this.iteration < this.maxIterations) {
      // Check if paused
      while (this.config.isPaused() && !this.shouldStop) {
        await this.sleep(500);
      }

      if (this.shouldStop) break;

      this.iteration++;

      // Step 1: Capture screenshot
      this.config.onStatus('seeing');
      this.config.onStep({ type: 'seeing', description: 'Analyzing page...' });
      
      const screenshot = await this.captureScreenshot();
      if (!screenshot) {
        this.config.onError('Failed to capture screenshot');
        return;
      }

      // Step 2: Send to Gemini for reasoning
      this.config.onStatus('thinking');
      this.config.onStep({ 
        type: 'thinking', 
        description: 'Deciding next action...',
        screenshot 
      });

      const response = await this.config.gemini.analyze({
        screenshot,
        task: this.config.task,
        history: [], // TODO: Add action history
      });

      if (!response.success) {
        this.config.onError(response.error || 'Gemini analysis failed');
        return;
      }

      // Check if task is complete
      if (response.isComplete) {
        this.config.onStep({ 
          type: 'verifying', 
          description: response.reasoning || 'Task completed successfully!' 
        });
        this.config.onStatus('complete');
        this.config.onComplete();
        return;
      }

      // Step 3: Execute action
      if (response.action) {
        this.config.onStatus('acting');
        await this.executeAction(response.action);
      }

      // Step 4: Verify action
      this.config.onStatus('verifying');
      this.config.onStep({ type: 'verifying', description: 'Verifying action result...' });
      
      // Small delay to let page update
      await this.sleep(1000);
    }

    if (this.iteration >= this.maxIterations) {
      this.config.onError('Maximum iterations reached');
    }
  }

  private async captureScreenshot(): Promise<string | null> {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(undefined, {
        format: 'png',
        quality: 90,
      });
      return dataUrl;
    } catch (error) {
      console.error('[HandOff] Screenshot capture failed:', error);
      return null;
    }
  }

  private async executeAction(action: GeminiAction) {
    const stepDescription = this.getActionDescription(action);
    this.config.onStep({ 
      type: action.type === 'click' ? 'clicking' : 'typing', 
      description: stepDescription 
    });

    try {
      await chrome.tabs.sendMessage(this.config.tabId, {
        type: 'EXECUTE_ACTION',
        payload: action,
      });
    } catch (error) {
      console.error('[HandOff] Action execution failed:', error);
      throw error;
    }
  }

  private getActionDescription(action: GeminiAction): string {
    switch (action.type) {
      case 'click':
        return `Clicking at (${action.x}, ${action.y})${action.target ? ` on "${action.target}"` : ''}`;
      case 'type':
        return `Typing "${action.text?.substring(0, 30)}${(action.text?.length || 0) > 30 ? '...' : ''}"`;
      case 'scroll':
        return `Scrolling ${action.direction || 'down'}`;
      case 'wait':
        return 'Waiting for page to update...';
      default:
        return `Performing ${action.type}`;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  stop() {
    this.shouldStop = true;
    this.isRunning = false;
  }

  resume() {
    // Resume is handled by the isPaused check in the loop
  }

  get running() {
    return this.isRunning;
  }
}
