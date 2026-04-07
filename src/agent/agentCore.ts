// 🤖 AGENT RUNTIME AGENT — Core Agent Loop with State Machine
// Hashbrown-style orchestration with human-in-the-loop + self-learning

import { AgentStateMachine, ProposedAction } from './stateMachine';
import { GeminiClient, AnalysisRequest, AnalysisResult } from './geminiClient';
import { ToolRegistry, createDefaultTools } from './tools';
import { evaluateApproval, ApprovalContext, checkUsageLimits, FREE_TIER_LIMITS, UsageTracker } from './approvalGates';
import { ActionSchema } from './prompts';
import { expertReview, RiskAssessment, ChallengeResult } from './expertReview';
import { gracefulDegradation } from './gracefulDegradation';
import { executionMemory } from './executionMemory';
import { failureLearning } from './failureLearning';
import { autoSkill, SkillStep } from './autoSkill';
import { hybridBrain, ModeDecision } from './hybridBrain';
import { MolmoWebClient, getMolmoClient } from './molmoClient';
import { metaAgent } from './metaAgent';

export interface AgentConfig {
  tabId: number;
  task: string;
  taskType?: 'general' | 'form' | 'research' | 'cleanup';
  autonomyLevel?: 'cautious' | 'balanced' | 'autonomous';
  onStep: (step: AgentStepEvent) => void;
  onStateChange: (state: string) => void;
  onApprovalNeeded: (action: ProposedAction, reasons: string[]) => Promise<'approve' | 'reject' | 'override'>;
  onExpertReview?: (assessment: RiskAssessment) => Promise<'proceed' | 'cancel' | 'cautious'>;
  onChallenge?: (challenge: ChallengeResult) => Promise<'accept' | 'override' | 'cautious'>;
  onComplete: (summary: string) => void;
  onError: (error: string) => void;
}

export interface AgentStepEvent {
  type: 'seeing' | 'thinking' | 'proposing' | 'executing' | 'verifying' | 'waiting' | 'complete' | 'error' | 'learning';
  description: string;
  screenshot?: string;
  action?: ActionSchema;
  confidence?: number;
  timestamp: number;
  executionMode?: string;
}

export class AgentCore {
  private config: AgentConfig;
  private stateMachine: AgentStateMachine;
  private gemini: GeminiClient;
  private tools: ToolRegistry;
  private usageTracker: UsageTracker;
  private isRunning = false;
  private shouldStop = false;
  private actionHistory: ActionSchema[] = [];
  private retryCount = 0;
  private maxRetries = 2;
  private lastError: string | null = null;
  private correctionContext: string | null = null;
  private consecutiveScrolls = 0;
  private maxConsecutiveScrolls = 3;
  private autonomyLevel: 'cautious' | 'balanced' | 'autonomous' = 'autonomous';
  private recentActionSignatures: string[] = [];
  private maxRepeatedActions = 3;
  private modeDecision: ModeDecision | null = null;
  private skillStepIndex = 0;
  private activeSkillSteps: SkillStep[] | null = null;
  private molmo: MolmoWebClient;
  private useMolmo = false;

  constructor(config: AgentConfig, gemini: GeminiClient) {
    this.config = config;
    this.gemini = gemini;
    this.molmo = getMolmoClient();
    this.stateMachine = new AgentStateMachine();
    this.tools = createDefaultTools(config.tabId);
    this.autonomyLevel = config.autonomyLevel || 'autonomous';
    this.usageTracker = {
      tasksToday: 0,
      actionsThisTask: 0,
      screenshotsThisTask: 0,
      lastResetDate: new Date().toISOString().split('T')[0],
    };

    // Subscribe to state changes
    this.stateMachine.subscribe((state) => {
      this.config.onStateChange(state);
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[AgentCore] Already running, stopping first...');
      this.stop();
      await this.sleep(100);
    }

    // Check usage limits
    const limitCheck = checkUsageLimits(this.usageTracker, FREE_TIER_LIMITS);
    if (!limitCheck.allowed) {
      this.config.onError(limitCheck.reason || 'Usage limit reached');
      return;
    }

    // Reset all state for new task
    this.isRunning = true;
    this.shouldStop = false;
    this.actionHistory = [];
    this.retryCount = 0;
    this.lastError = null;
    this.correctionContext = null;
    this.consecutiveScrolls = 0;
    this.recentActionSignatures = [];
    this.modeDecision = null;
    this.skillStepIndex = 0;
    this.activeSkillSteps = null;
    this.usageTracker.tasksToday++;
    this.usageTracker.actionsThisTask = 0;
    this.usageTracker.screenshotsThisTask = 0;

    // Reset state machine to idle first, then start
    this.stateMachine.reset();
    this.stateMachine.send({ type: 'START', task: this.config.task });

    // Initialize self-learning subsystems
    await executionMemory.init();
    await autoSkill.init();
    await hybridBrain.init();
    await metaAgent.init();

    // Check if MolmoWeb is enabled and server is reachable
    this.useMolmo = await this.molmo.isEnabled();
    if (this.useMolmo) {
      const available = await this.molmo.isServerAvailable();
      if (available) {
        this.emitStep('learning', `MolmoWeb vision engine connected`);
      } else {
        console.log('[AgentCore] MolmoWeb enabled but server unreachable, using Gemini');
        this.useMolmo = false;
      }
    }

    // Start execution trace for this task
    const initialPageUrl = await this.getPageUrl();
    await executionMemory.startTrace(this.config.task, initialPageUrl);
    this.emitStep('learning', `Memory loaded. Checking for learned patterns on this site...`);

    // Decide execution mode (skill replay, vision, DOM, or memory-guided)
    this.modeDecision = await hybridBrain.decideMode({
      task: this.config.task,
      pageUrl: initialPageUrl,
      pageTitle: '',
      iteration: 0,
      previousActions: [],
      retryCount: 0,
      domAvailable: true,
      hasScreenshot: false,
    });

    // If a proven skill matches, prepare for skill-guided execution
    if (this.modeDecision.mode === 'skill' && this.modeDecision.skillSteps) {
      this.activeSkillSteps = this.modeDecision.skillSteps;
      this.skillStepIndex = 0;
      this.emitStep('learning', `Using proven skill: ${this.modeDecision.reason}`, undefined, undefined, this.modeDecision.confidence);
    } else if (this.modeDecision.memoryHint) {
      this.emitStep('learning', `Loaded execution memory for this site`, undefined, undefined, this.modeDecision.confidence);
    }

    hybridBrain.setCurrentMode(this.modeDecision.mode);

    // Initialize graceful degradation tracking
    gracefulDegradation.startTask(`task_${Date.now()}`, this.config.task);

    // Run expert review challenge before starting
    if (this.config.onChallenge) {
      const challenge = expertReview.challengeWorkflow({
        task: this.config.task,
        pageUrl: '',
        pageTitle: '',
        proposedActions: [],
        previousActions: [],
      });

      if (challenge) {
        const response = await this.config.onChallenge(challenge);
        if (response === 'cautious') {
          this.autonomyLevel = 'cautious';
        }
      }
    }

    try {
      await this.runLoop();
    } catch (error) {
      this.stateMachine.send({ 
        type: 'ERROR', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      });
      this.config.onError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      this.isRunning = false;
    }
  }

  private async runLoop(): Promise<void> {
    const maxIterations = 50;
    let iteration = 0;
    let firstIteration = true;

    while (!this.shouldStop && iteration < maxIterations) {
      const state = this.stateMachine.getState();

      // Handle paused state
      if (state === 'paused') {
        await this.sleep(500);
        continue;
      }

      // Handle terminal states
      if (state === 'complete' || state === 'error' || state === 'idle') {
        break;
      }

      iteration++;

      // Step 1: Capture screenshot with timeout and retry
      this.emitStep('seeing', 'Analyzing page...');
      
      let screenshotResult: { success: boolean; data?: unknown; error?: string } = { success: false, error: 'Not attempted' };
      let screenshotRetries = 0;
      const maxScreenshotRetries = 3;
      
      while (!screenshotResult.success && screenshotRetries < maxScreenshotRetries) {
        screenshotRetries++;
        
        const screenshotPromise = this.tools.execute('seeScreen', {});
        const timeoutPromise = new Promise<{ success: false; error: string }>((resolve) => 
          setTimeout(() => resolve({ success: false, error: 'Screenshot timeout' }), 8000)
        );
        
        screenshotResult = await Promise.race([screenshotPromise, timeoutPromise]);
        
        if (!screenshotResult.success && screenshotRetries < maxScreenshotRetries) {
          console.log(`[AgentCore] Screenshot attempt ${screenshotRetries} failed, retrying...`);
          this.emitStep('seeing', `Retrying page capture (${screenshotRetries}/${maxScreenshotRetries})...`);
          await this.sleep(500);
        }
      }
      
      if (!screenshotResult.success) {
        console.error('[AgentCore] Screenshot failed after retries:', screenshotResult.error);
        this.stateMachine.send({ type: 'ERROR', message: 'Unable to see page after retries: ' + (screenshotResult.error || 'unknown') });
        break;
      }

      const screenshotData = screenshotResult.data as { 
        screenshot: string; 
        cursorPosition?: { x: number; y: number };
        salientElements?: Array<{ type: string; label: string; x: number; y: number }>;
      };
      const screenshot = screenshotData.screenshot;
      const cursorPosition = screenshotData.cursorPosition;
      const salientElements = screenshotData.salientElements || [];
      
      this.usageTracker.screenshotsThisTask++;
      
      // Send SCREENSHOT_READY only on first iteration to transition from 'initializing' to 'seeing'
      if (firstIteration) {
        this.stateMachine.send({ type: 'SCREENSHOT_READY', screenshot });
        firstIteration = false;
      }

      // Log detected elements for debugging
      if (salientElements.length > 0) {
        console.log('[AgentCore] Detected salient elements:', salientElements);
      }
      if (cursorPosition && (cursorPosition.x > 0 || cursorPosition.y > 0)) {
        console.log('[AgentCore] Cursor position:', cursorPosition);
      }

      // Step 2: Get page info (with fallback for restricted pages)
      let pageUrl = '';
      let pageTitle = '';
      try {
        const tab = await chrome.tabs.get(this.config.tabId);
        pageUrl = tab.url || '';
        pageTitle = tab.title || '';
      } catch (e) {
        console.log('[AgentCore] Could not get tab info, using fallback');
        const pageInfo = await this.tools.execute('getPageInfo', {});
        pageUrl = (pageInfo.data as { url?: string })?.url || '';
        pageTitle = (pageInfo.data as { title?: string })?.title || '';
      }

      // Step 3: Analyze with Gemini (enhanced with self-learning context)
      const currentMode = hybridBrain.getCurrentMode();
      const skillProgress = this.activeSkillSteps ? ` step ${this.skillStepIndex + 1}/${this.activeSkillSteps.length}` : '';
      this.emitStep('thinking', `Deciding next action... [${currentMode} mode${skillProgress}]`, screenshot);
      
      // Build task with correction context and detected elements
      let taskWithContext = this.config.task;
      
      // Inject hybrid brain context (memory hints, fix strategies, skill guidance)
      if (this.modeDecision) {
        const modeContext = hybridBrain.buildModeContext(this.modeDecision);
        if (modeContext) {
          taskWithContext += modeContext;
        }
      }

      // Inject meta-agent prompt optimizations (auto-generated rules + site strategy)
      const metaEnhancements = await metaAgent.getActivePromptEnhancements();
      if (metaEnhancements) taskWithContext += metaEnhancements;
      const siteAdditions = await metaAgent.getSitePromptAdditions(pageUrl);
      if (siteAdditions) taskWithContext += siteAdditions;

      // Add detected salient elements as hints
      if (salientElements.length > 0) {
        const elementHints = salientElements.map(e => 
          `- ${e.type.toUpperCase()}: "${e.label}" at coordinates (${e.x}, ${e.y})`
        ).join('\n');
        taskWithContext += `\n\n[DETECTED ELEMENTS - USE THESE COORDINATES]:\n${elementHints}`;
      }
      
      // Add cursor position
      if (cursorPosition && (cursorPosition.x > 0 || cursorPosition.y > 0)) {
        taskWithContext += `\n\n[CURSOR POSITION]: (${cursorPosition.x}, ${cursorPosition.y})`;
      }
      
      if (this.correctionContext) {
        taskWithContext += `\n\n[CORRECTION]: ${this.correctionContext}`;
      }

      const analysisRequest: AnalysisRequest = {
        screenshot,
        task: taskWithContext,
        taskType: this.config.taskType,
        history: this.actionHistory,
        pageUrl,
        pageTitle,
      };

      // Choose analyzer: MolmoWeb (vision) or Gemini (default)
      // MolmoWeb is preferred in vision mode when available
      let analysis: AnalysisResult;
      const molmoEnabled = this.useMolmo && (this.modeDecision?.mode === 'vision' || !this.modeDecision);

      if (molmoEnabled) {
        this.emitStep('thinking', `MolmoWeb analyzing page... [vision mode]`, screenshot);
        const molmoPromise = this.molmo.analyze(analysisRequest);
        const molmoTimeout = new Promise<{ success: false; error: string }>((resolve) =>
          setTimeout(() => resolve({ success: false, error: 'MolmoWeb timeout' }), 45000)
        );
        analysis = await Promise.race([molmoPromise, molmoTimeout]) as AnalysisResult;

        // Fallback to Gemini if MolmoWeb fails
        if (!analysis.success) {
          console.log('[AgentCore] MolmoWeb failed, falling back to Gemini:', analysis.error);
          this.emitStep('thinking', 'MolmoWeb unavailable, using Gemini...', screenshot);
          const geminiPromise = this.gemini.analyze(analysisRequest);
          const geminiTimeout = new Promise<{ success: false; error: string }>((resolve) =>
            setTimeout(() => resolve({ success: false, error: 'Analysis timeout - Gemini took too long' }), 30000)
          );
          analysis = await Promise.race([geminiPromise, geminiTimeout]) as AnalysisResult;
        }
      } else {
        const analysisPromise = this.gemini.analyze(analysisRequest);
        const timeoutPromise = new Promise<{ success: false; error: string }>((resolve) =>
          setTimeout(() => resolve({ success: false, error: 'Analysis timeout - Gemini took too long' }), 30000)
        );
        analysis = await Promise.race([analysisPromise, timeoutPromise]) as AnalysisResult;
      }

      if (!analysis.success || !analysis.response) {
        console.error('[AgentCore] Analysis failed:', analysis.error);
        // Don't break on first failure, retry once
        if (iteration > 1) {
          this.emitStep('error', analysis.error || 'Analysis failed');
          this.stateMachine.send({ type: 'ERROR', message: analysis.error || 'Analysis failed' });
          break;
        }
        this.emitStep('seeing', 'Retrying analysis...');
        continue;
      }

      const response = analysis.response;

      // Step 4: Check if complete
      if (response.isComplete) {
        // Complete execution trace as successful
        const trace = await executionMemory.completeTrace(true);
        if (trace) {
          console.log(`[AgentCore] Trace completed: ${trace.actions.length} actions in ${Math.round(trace.totalDuration / 1000)}s`);
        }

        // Auto-detect new skills from accumulated traces
        const newSkills = await autoSkill.detectNewSkills();
        if (newSkills.length > 0) {
          this.emitStep('learning', `Learned ${newSkills.length} new skill(s): ${newSkills.map(s => s.name).join(', ')}`);
        }

        // Evaluate meta-agent experiments with this trace
        if (trace) {
          await metaAgent.evaluateExperiments(trace);
        }

        // Record skill execution result if we were using a skill
        if (this.modeDecision?.skillId) {
          await autoSkill.recordExecution({
            skillId: this.modeDecision.skillId,
            success: true,
            stepsCompleted: this.actionHistory.length,
            totalSteps: this.activeSkillSteps?.length || this.actionHistory.length,
            duration: trace?.totalDuration || 0,
          });
        }

        this.emitStep('complete', response.observation);
        this.stateMachine.send({ type: 'TASK_COMPLETE' });
        this.config.onComplete(response.observation);
        break;
      }

      // Step 5: Propose action
      if (!response.action) {
        // No action but not complete - might need input
        if (response.confidence < 0.5) {
          this.stateMachine.send({ type: 'NEED_INPUT', question: response.reasoning });
          this.emitStep('waiting', response.reasoning);
          await this.sleep(2000);
          continue;
        }
        continue;
      }

      const proposedAction: ProposedAction = {
        type: response.action.type,
        params: response.action as unknown as Record<string, unknown>,
        target: response.action.target,
        confidence: response.confidence,
        reasoning: response.reasoning,
        requiresApproval: response.requiresApproval,
      };

      this.stateMachine.send({ type: 'ACTION_PROPOSED', action: proposedAction });
      this.emitStep('proposing', response.reasoning, undefined, response.action, response.confidence);

      // Step 6: Check approval gates
      const approvalContext: ApprovalContext = {
        pageUrl,
        pageTitle,
        iteration,
        previousActions: this.actionHistory,
      };

      const approval = evaluateApproval(response.action, approvalContext);

      // In autonomous mode, only require approval for truly destructive actions
      const needsApproval = 
        this.autonomyLevel === 'cautious' || // Always ask in cautious mode
        (this.autonomyLevel === 'balanced' && (
          approval.level === 'require' || 
          response.requiresApproval ||
          response.confidence < 0.7
        )) ||
        (this.autonomyLevel === 'autonomous' && approval.level === 'require' && response.requiresApproval);

      if (needsApproval) {
        // Need human approval
        const decision = await this.config.onApprovalNeeded(proposedAction, approval.reasons);
        
        if (decision === 'reject') {
          this.stateMachine.send({ type: 'ACTION_REJECTED', reason: 'User rejected' });
          continue;
        }
        // 'approve' or 'override' - continue with execution
      }

      // Step 7: Execute action (with execution memory tracking)
      this.stateMachine.send({ type: 'ACTION_APPROVED' });
      this.emitStep('executing', `Executing: ${response.action.type}${response.action.target ? ` on "${response.action.target}"` : ''}`, undefined, undefined, undefined);

      const actionStartTime = Date.now();
      const execResult = await this.executeAction(response.action);
      const actionDuration = Date.now() - actionStartTime;
      
      if (!execResult.success) {
        // Record failure in execution memory
        executionMemory.recordAction(response.action, pageUrl, false, actionDuration, {
          error: execResult.error,
          retries: this.retryCount,
          visualContext: response.observation,
        });

        // Use failure learning engine instead of naive retry
        this.lastError = execResult.error || 'Action failed';
        this.retryCount++;

        const failureAnalysis = failureLearning.analyze({
          action: response.action,
          error: this.lastError,
          pageUrl,
          pageTitle,
          iteration,
          previousActions: this.actionHistory,
          observation: response.observation,
          retryCount: this.retryCount,
        });

        // Track mode outcome for hybrid brain
        await hybridBrain.recordModeOutcome(pageUrl, hybridBrain.getCurrentMode(), false, actionDuration);

        if (failureAnalysis.fixStrategy.type === 'escalate' || this.retryCount > this.maxRetries) {
          this.emitStep('error', `${failureAnalysis.rootCause}. Fix: ${failureAnalysis.fixStrategy.description}`);
          this.stateMachine.send({ type: 'ERROR', message: this.lastError });
          break;
        }

        // Apply the learned fix
        const fixResult = failureLearning.applyFix(response.action, failureAnalysis.fixStrategy);
        if (fixResult) {
          this.correctionContext = fixResult.correctionContext;
          this.emitStep('learning', `Learning from failure: ${failureAnalysis.fixStrategy.description} (confidence: ${Math.round(failureAnalysis.confidence * 100)}%)`);
        } else {
          this.correctionContext = `Previous action failed: ${this.lastError}. Try a different approach.`;
        }

        // Apply wait if fix strategy requires it
        if (failureAnalysis.fixStrategy.waitMs) {
          await this.sleep(failureAnalysis.fixStrategy.waitMs);
        } else {
          await this.sleep(1000);
        }

        continue; // Retry with learned fix context
      }
      
      // Record successful action in execution memory
      executionMemory.recordAction(response.action, pageUrl, true, actionDuration, {
        retries: this.retryCount,
        visualContext: response.observation,
      });

      // Track mode outcome for hybrid brain
      await hybridBrain.recordModeOutcome(pageUrl, hybridBrain.getCurrentMode(), true, actionDuration);

      // Reset retry count on success
      this.retryCount = 0;
      this.lastError = null;
      
      // Hint to press Enter after typing in search boxes
      if (response.action.type === 'type') {
        this.correctionContext = 'You just typed text. If this was in a search box, press Enter to submit the search. Do not wait - take action immediately.';
      } else {
        this.correctionContext = null;
      }

      // Track consecutive scrolls to detect loops
      if (response.action.type === 'scroll') {
        this.consecutiveScrolls++;
        if (this.consecutiveScrolls >= this.maxConsecutiveScrolls) {
          this.correctionContext = 'You have scrolled multiple times without finding the target. Try a different approach - look for the element on the current screen or ask for help.';
          this.consecutiveScrolls = 0;
        }
      } else {
        this.consecutiveScrolls = 0;
      }

      // Detect repeated action loops (same action type + target)
      const actionSignature = `${response.action.type}:${response.action.target || ''}:${response.action.x || ''}:${response.action.y || ''}`;
      this.recentActionSignatures.push(actionSignature);
      if (this.recentActionSignatures.length > 6) {
        this.recentActionSignatures.shift();
      }
      
      // Check if same action repeated too many times
      const signatureCount = this.recentActionSignatures.filter(s => s === actionSignature).length;
      if (signatureCount >= this.maxRepeatedActions) {
        this.correctionContext = `STOP: You are repeating the same action "${response.action.type}" on "${response.action.target}" multiple times without success. The element may not be where you think it is. Try clicking at DIFFERENT coordinates, or look for the element in a different location. On LinkedIn, the search bar is in the TOP LEFT corner around x:180, y:45.`;
        this.recentActionSignatures = []; // Reset to give fresh start
      }

      this.actionHistory.push(response.action);
      this.usageTracker.actionsThisTask++;
      this.stateMachine.send({ type: 'ACTION_EXECUTED' });

      // Step 8: Verify
      this.emitStep('verifying', 'Verifying action result...');
      await this.sleep(1000); // Let page update
      this.stateMachine.send({ type: 'VERIFICATION_SUCCESS' });
    }

    // Complete execution trace on exit (success or failure)
    const finalTrace = executionMemory.getCurrentTrace();
    if (finalTrace) {
      const wasSuccessful = this.stateMachine.getState() === 'complete';
      await executionMemory.completeTrace(wasSuccessful);

      // Record skill failure if applicable
      if (!wasSuccessful && this.modeDecision?.skillId) {
        await autoSkill.recordExecution({
          skillId: this.modeDecision.skillId,
          success: false,
          stepsCompleted: this.actionHistory.length,
          totalSteps: this.activeSkillSteps?.length || 0,
          failedAt: this.actionHistory.length,
          error: this.lastError || 'Unknown',
          duration: Date.now() - finalTrace.startedAt,
        });
      }

      // Always try to detect new skills from accumulated data
      await autoSkill.detectNewSkills();
    }

    if (iteration >= maxIterations) {
      this.config.onError('Maximum iterations reached. Task may be incomplete.');
    }
  }

  private async executeAction(action: ActionSchema): Promise<{ success: boolean; error?: string }> {
    switch (action.type) {
      case 'click':
        return this.tools.execute('click', { x: action.x, y: action.y, target: action.target });
      case 'type':
        return this.tools.execute('type', { text: action.text });
      case 'scroll':
        return this.tools.execute('scroll', { direction: action.direction });
      case 'press':
        return this.tools.execute('press', { key: action.key });
      case 'wait':
        return this.tools.execute('wait', { ms: action.duration || 1000 });
      case 'navigate':
        return this.tools.execute('navigate', { url: action.url });
      default:
        return { success: false, error: `Unknown action type: ${action.type}` };
    }
  }

  private emitStep(
    type: AgentStepEvent['type'],
    description: string,
    screenshot?: string,
    action?: ActionSchema,
    confidence?: number
  ): void {
    this.config.onStep({
      type,
      description,
      screenshot,
      action,
      confidence,
      timestamp: Date.now(),
    });
  }

  pause(): void {
    this.stateMachine.send({ type: 'PAUSE' });
  }

  resume(): void {
    this.stateMachine.send({ type: 'RESUME' });
  }

  stop(): void {
    this.shouldStop = true;
    this.stateMachine.send({ type: 'STOP' });
  }

  getState(): string {
    return this.stateMachine.getState();
  }

  applyCorrection(correction: string): void {
    this.correctionContext = correction;
    console.log('[AgentCore] Correction applied:', correction);
  }

  private async getPageUrl(): Promise<string> {
    try {
      const tab = await chrome.tabs.get(this.config.tabId);
      return tab.url || '';
    } catch {
      return '';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
