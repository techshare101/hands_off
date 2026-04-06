// 📝 WORKFLOW MEMORY — Save & replay successful automations
// Users are crying for: "I have to re-teach it the same thing every time"

export interface SavedWorkflow {
  id: string;
  name: string;
  description?: string;
  task: string;
  steps: WorkflowStep[];
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
  successRate: number;
  tags: string[];
  sitePattern?: string; // URL pattern where this workflow works
}

export interface WorkflowStep {
  order: number;
  action: {
    type: 'click' | 'type' | 'scroll' | 'wait';
    target?: string;
    value?: string;
    selector?: string;
    coordinates?: { x: number; y: number };
  };
  description: string;
  screenshot?: string;
  waitAfter?: number;
}

export interface WorkflowExecution {
  workflowId: string;
  startedAt: number;
  completedAt?: number;
  success: boolean;
  stepsCompleted: number;
  error?: string;
}

const STORAGE_KEY = 'handoff_workflows';
const MAX_WORKFLOWS = 50;

class WorkflowMemoryService {
  private workflows: Map<string, SavedWorkflow> = new Map();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const saved = result[STORAGE_KEY] || [];
      saved.forEach((w: SavedWorkflow) => this.workflows.set(w.id, w));
      this.initialized = true;
    } catch (error) {
      console.error('[WorkflowMemory] Failed to load:', error);
    }
  }

  private async save(): Promise<void> {
    const workflows = Array.from(this.workflows.values());
    await chrome.storage.local.set({ [STORAGE_KEY]: workflows });
  }

  private generateId(): string {
    return `wf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  async saveWorkflow(
    name: string,
    task: string,
    steps: WorkflowStep[],
    options?: {
      description?: string;
      tags?: string[];
      sitePattern?: string;
    }
  ): Promise<SavedWorkflow> {
    await this.init();

    // Check limit
    if (this.workflows.size >= MAX_WORKFLOWS) {
      // Remove oldest unused workflow
      const oldest = Array.from(this.workflows.values())
        .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
      if (oldest) {
        this.workflows.delete(oldest.id);
      }
    }

    const workflow: SavedWorkflow = {
      id: this.generateId(),
      name,
      description: options?.description,
      task,
      steps,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 0,
      successRate: 1.0,
      tags: options?.tags || [],
      sitePattern: options?.sitePattern,
    };

    this.workflows.set(workflow.id, workflow);
    await this.save();

    return workflow;
  }

  async getWorkflow(id: string): Promise<SavedWorkflow | null> {
    await this.init();
    return this.workflows.get(id) || null;
  }

  async getAllWorkflows(): Promise<SavedWorkflow[]> {
    await this.init();
    return Array.from(this.workflows.values())
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  async searchWorkflows(query: string): Promise<SavedWorkflow[]> {
    await this.init();
    const lowerQuery = query.toLowerCase();
    
    return Array.from(this.workflows.values())
      .filter(w => 
        w.name.toLowerCase().includes(lowerQuery) ||
        w.task.toLowerCase().includes(lowerQuery) ||
        w.description?.toLowerCase().includes(lowerQuery) ||
        w.tags.some(t => t.toLowerCase().includes(lowerQuery))
      )
      .sort((a, b) => b.useCount - a.useCount);
  }

  async findMatchingWorkflows(url: string, task: string): Promise<SavedWorkflow[]> {
    await this.init();
    const lowerTask = task.toLowerCase();
    
    return Array.from(this.workflows.values())
      .filter(w => {
        // Check URL pattern match
        if (w.sitePattern) {
          try {
            const pattern = new RegExp(w.sitePattern);
            if (!pattern.test(url)) return false;
          } catch {
            // Invalid pattern, skip URL check
          }
        }
        
        // Check task similarity (simple keyword matching)
        const taskWords = lowerTask.split(/\s+/);
        const workflowWords = w.task.toLowerCase().split(/\s+/);
        const matchingWords = taskWords.filter(word => 
          workflowWords.some(ww => ww.includes(word) || word.includes(ww))
        );
        
        return matchingWords.length >= Math.min(2, taskWords.length * 0.5);
      })
      .sort((a, b) => (b.successRate * b.useCount) - (a.successRate * a.useCount));
  }

  async recordExecution(workflowId: string, success: boolean): Promise<void> {
    await this.init();
    
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return;

    workflow.useCount++;
    workflow.lastUsedAt = Date.now();
    
    // Update success rate (weighted average)
    const weight = Math.min(workflow.useCount, 10);
    workflow.successRate = (
      (workflow.successRate * (weight - 1) + (success ? 1 : 0)) / weight
    );

    await this.save();
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    await this.init();
    
    if (this.workflows.delete(id)) {
      await this.save();
      return true;
    }
    return false;
  }

  async updateWorkflow(id: string, updates: Partial<SavedWorkflow>): Promise<SavedWorkflow | null> {
    await this.init();
    
    const workflow = this.workflows.get(id);
    if (!workflow) return null;

    Object.assign(workflow, updates);
    await this.save();
    
    return workflow;
  }

  async exportWorkflow(id: string): Promise<string | null> {
    const workflow = await this.getWorkflow(id);
    if (!workflow) return null;
    
    return JSON.stringify(workflow, null, 2);
  }

  async importWorkflow(json: string): Promise<SavedWorkflow | null> {
    try {
      const workflow = JSON.parse(json) as SavedWorkflow;
      
      // Validate structure
      if (!workflow.name || !workflow.task || !workflow.steps) {
        throw new Error('Invalid workflow structure');
      }

      // Generate new ID to avoid conflicts
      workflow.id = this.generateId();
      workflow.createdAt = Date.now();
      workflow.lastUsedAt = Date.now();
      workflow.useCount = 0;

      this.workflows.set(workflow.id, workflow);
      await this.save();

      return workflow;
    } catch (error) {
      console.error('[WorkflowMemory] Import failed:', error);
      return null;
    }
  }

  // Convert current task execution to replayable workflow
  async createFromExecution(
    name: string,
    task: string,
    completedSteps: Array<{
      description: string;
      action: WorkflowStep['action'];
      screenshot?: string;
    }>
  ): Promise<SavedWorkflow> {
    const steps: WorkflowStep[] = completedSteps.map((step, index) => ({
      order: index + 1,
      action: step.action,
      description: step.description,
      screenshot: step.screenshot,
      waitAfter: 500, // Default wait between steps
    }));

    return this.saveWorkflow(name, task, steps);
  }
}

// Singleton
export const workflowMemory = new WorkflowMemoryService();
