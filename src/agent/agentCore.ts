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
import { ArkVisionClient, getArkClient } from './arkClient';
import { metaAgent } from './metaAgent';
import { hfVision } from './hfVision';
import { getHFClient } from './hfClient';
import { decisionRouter } from './decisionRouter';
import { mcpClient } from './mcpClient';
import { a2ui } from './a2ui';
import { a2aProtocol } from './a2aProtocol';
import { molmoVision } from './molmoVision';

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
  private ark: ArkVisionClient;
  private useArk = false;
  private useHF = false;

  constructor(config: AgentConfig, gemini: GeminiClient) {
    this.config = config;
    this.gemini = gemini;
    this.ark = getArkClient();
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
    console.log('[AgentCore] start() called');
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
    console.log('[AgentCore] Usage check passed, initializing...');
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
    console.log('[AgentCore] Initializing subsystems...');
    try { await executionMemory.init(); } catch (e) { console.warn('[AgentCore] executionMemory.init failed:', e); }
    try { await autoSkill.init(); } catch (e) { console.warn('[AgentCore] autoSkill.init failed:', e); }
    try { await hybridBrain.init(); } catch (e) { console.warn('[AgentCore] hybridBrain.init failed:', e); }
    try { await metaAgent.init(); } catch (e) { console.warn('[AgentCore] metaAgent.init failed:', e); }
    // Initialize MCP client and A2A protocol (both have try/catch internally)
    try {
      await mcpClient.init();
    } catch (e) {
      console.warn('[AgentCore] MCP client init failed (non-critical):', e);
    }
    try {
      await a2aProtocol.init();
    } catch (e) {
      console.warn('[AgentCore] A2A protocol init failed (non-critical):', e);
    }

    // Discover MCP tools so the decision router knows what's available
    try {
      const mcpToolCount = (await mcpClient.discoverTools()).length;
      if (mcpToolCount > 0) {
        this.emitStep('learning', `MCP: ${mcpToolCount} external tool(s) available`);
      }
    } catch (e) {
      console.warn('[AgentCore] MCP tool discovery failed:', e);
    }
    const a2aAgentCount = a2aProtocol.getRemoteAgents().length;
    if (a2aAgentCount > 0) {
      this.emitStep('learning', `A2A: ${a2aAgentCount} remote agent(s) connected`);
    }

    // Check if Hugging Face Vision is enabled
    console.log('[AgentCore] Checking vision engines...');
    const hfClient = getHFClient();
    try { await hfClient.init(); } catch (e) { console.warn('[AgentCore] hfClient.init failed:', e); }
    this.useHF = await hfClient.isEnabled().catch(() => false);
    if (this.useHF) {
      this.emitStep('learning', `HuggingFace vision pipeline active`);
    }

    // Check if Ark Vision is enabled and server is reachable
    this.useArk = await this.ark.isEnabled().catch(() => false);
    if (this.useArk) {
      const available = await this.ark.isServerAvailable();
      if (available) {
        this.emitStep('learning', `Ark Vision engine connected`);
      } else {
        console.log('[AgentCore] Ark Vision enabled but server unreachable, using LLM fallback');
        this.useArk = false;
      }
    }

    // Start execution trace for this task
    console.log('[AgentCore] Starting execution trace...');
    const initialPageUrl = await this.getPageUrl().catch(() => '');
    try { await executionMemory.startTrace(this.config.task, initialPageUrl); } catch (e) { console.warn('[AgentCore] startTrace failed:', e); }
    this.emitStep('learning', `Memory loaded. Checking for learned patterns on this site...`);

    // Decide execution mode (skill replay, vision, DOM, or memory-guided)
    console.log('[AgentCore] Deciding execution mode...');
    try {
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
    } catch (e) {
      console.warn('[AgentCore] hybridBrain.decideMode failed, using defaults:', e);
      this.modeDecision = { mode: 'vision', confidence: 0.5, reason: 'Fallback — hybridBrain unavailable' };
    }

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
    try { gracefulDegradation.startTask(`task_${Date.now()}`, this.config.task); } catch (e) { console.warn('[AgentCore] gracefulDegradation failed:', e); }

    // Run expert review challenge before starting
    if (this.config.onChallenge) {
      try {
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
      } catch (e) {
        console.warn('[AgentCore] Expert review failed:', e);
      }
    }

    console.log('[AgentCore] Entering runLoop...');
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
      const maxScreenshotRetries = 5;
      
      while (!screenshotResult.success && screenshotRetries < maxScreenshotRetries) {
        screenshotRetries++;
        
        const screenshotPromise = this.tools.execute('seeScreen', {});
        const timeoutPromise = new Promise<{ success: false; error: string }>((resolve) => 
          setTimeout(() => resolve({ success: false, error: 'Screenshot timeout' }), 15000)
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
        interactiveElements?: Array<{
          type: string; label: string; value: string; placeholder: string;
          x: number; y: number; width: number; height: number;
          tagName: string; inputType: string; ariaLabel: string; name: string; role: string;
        }>;
      };
      const screenshot = screenshotData.screenshot;
      const cursorPosition = screenshotData.cursorPosition;
      const salientElements = screenshotData.salientElements || [];
      const interactiveElements = screenshotData.interactiveElements || [];
      
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

      // Inject routing capabilities (MCP tools, A2A agents, active widgets)
      try {
        const routingAddition = decisionRouter.buildRoutingPromptAddition();
        if (routingAddition) taskWithContext += routingAddition;
      } catch (e) {
        console.warn('[AgentCore] Routing prompt addition failed:', e);
      }

      // Add detected salient elements as hints
      if (salientElements.length > 0) {
        const elementHints = salientElements.map(e => 
          `- ${e.type.toUpperCase()}: "${e.label}" at coordinates (${e.x}, ${e.y})`
        ).join('\n');
        taskWithContext += `\n\n[DETECTED ELEMENTS - USE THESE COORDINATES]:\n${elementHints}`;
      }

      // Add DOM interactive elements as precise targeting hints
      if (interactiveElements.length > 0) {
        const inputFields = interactiveElements.filter(e => 
          ['text', 'textarea', 'search', 'email', 'tel', 'url', 'number', 'password', 'combobox', 'textbox'].includes(e.type)
        );
        const buttons = interactiveElements.filter(e => e.type === 'button');
        
        let domHints = '\n\n[PAGE INTERACTIVE ELEMENTS - PRECISE COORDINATES]:';
        
        if (inputFields.length > 0) {
          domHints += '\nInput Fields:';
          for (const f of inputFields) {
            const desc = f.label || f.placeholder || f.ariaLabel || f.name || 'unlabeled';
            const val = f.value ? ` (current value: "${f.value}")` : ' (empty)';
            domHints += `\n  - "${desc}"${val} → click (${f.x}, ${f.y})`;
          }
        }
        
        if (buttons.length > 0) {
          domHints += '\nButtons:';
          for (const b of buttons.slice(0, 10)) {
            domHints += `\n  - "${b.label}" → click (${b.x}, ${b.y})`;
          }
        }
        
        domHints += '\n\nIMPORTANT: Use the EXACT coordinates above to click on the correct element. Match the field label/placeholder to the task requirement.';
        taskWithContext += domHints;
        console.log(`[AgentCore] DOM hints: ${inputFields.length} inputs, ${buttons.length} buttons`);
      }

      // HuggingFace Vision: detect UI elements with ML models
      if (this.useHF) {
        try {
          const hfAnalysis = await hfVision.analyzePage(screenshot, {
            detectObjects: true,
            zeroShotDetect: true,
            caption: iteration === 0, // caption only on first iteration
          });
          if (hfAnalysis.elements.length > 0) {
            const hfHints = hfVision.formatAsPromptHints(hfAnalysis);
            taskWithContext += hfHints;
            console.log(`[AgentCore] HF Vision found ${hfAnalysis.elements.length} elements in ${hfAnalysis.latencyMs}ms`);
          }
        } catch (e) {
          console.warn('[AgentCore] HF Vision analysis failed, continuing without:', e);
        }
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

      // Choose analyzer: Ark Vision or Gemini (default)
      // Ark is preferred in vision mode when available
      let analysis: AnalysisResult;
      const arkEnabled = this.useArk && (this.modeDecision?.mode === 'vision' || !this.modeDecision);

      if (arkEnabled) {
        this.emitStep('thinking', `Ark analyzing page... [vision mode]`, screenshot);
        const arkPromise = this.ark.analyze(analysisRequest);
        const arkTimeout = new Promise<{ success: false; error: string }>((resolve) =>
          setTimeout(() => resolve({ success: false, error: 'Ark Vision timeout' }), 45000)
        );
        analysis = await Promise.race([arkPromise, arkTimeout]) as AnalysisResult;

        // Fallback to Gemini if Ark fails
        if (!analysis.success) {
          console.log('[AgentCore] Ark Vision failed, falling back to Gemini:', analysis.error);
          this.emitStep('thinking', 'Ark unavailable, using Gemini...', screenshot);
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

      // Step 4: Decision Router — decide HOW to fulfill this step
      // Prefer API/tool execution over browser when a connection exists
      let __routeHandled = false;
      try {
        const routeDecision = await decisionRouter.decideRoute({
          task: this.config.task,
          pageUrl,
          pageTitle,
          llmResponse: response,
          iteration,
          actionHistory: this.actionHistory,
          mcpToolsAvailable: mcpClient.getAllCachedTools() || [],
          hasActiveWidgets: false,
        });
        console.log('[AgentCore] Route decision:', routeDecision.route);

        // Execute non-browser routes directly
        if (routeDecision.route === 'mcp_tool') {
          const mcpResult = await this.executeMCPRoute(
            routeDecision.serverId,
            routeDecision.toolName,
            routeDecision.args,
          );
          if (mcpResult.success) {
            __routeHandled = true;
            decisionRouter.markRouteSuccess(true);
            this.emitStep('executing', `Tool executed: ${routeDecision.toolName} → ${JSON.stringify(mcpResult.data).slice(0, 120)}`);
            executionMemory.recordAction(
              { type: 'navigate', url: `mcp://${routeDecision.serverId}/${routeDecision.toolName}` } as ActionSchema,
              pageUrl, true, 0, { visualContext: `Tool route: ${routeDecision.toolName}` },
            );
            this.retryCount = 0;
            this.lastError = null;
            this.correctionContext = `Tool "${routeDecision.toolName}" returned: ${JSON.stringify(mcpResult.data).slice(0, 300)}. Use this result to continue.`;
            await this.sleep(500);
            continue; // Next iteration — agent sees tool result via correctionContext
          } else {
            decisionRouter.markRouteSuccess(false);
            console.warn(`[AgentCore] MCP route failed (${routeDecision.toolName}), falling back to browser:`, mcpResult.error);
          }
        }

        if (routeDecision.route === 'a2a_delegate') {
          try {
            const a2aResult = await a2aProtocol.sendTask(
              routeDecision.agentId,
              routeDecision.intent,
              routeDecision.description,
              routeDecision.input,
            );
            if (a2aResult) {
              __routeHandled = true;
              decisionRouter.markRouteSuccess(true);
              this.emitStep('executing', `Delegated to agent: ${routeDecision.agentId}`);
              this.correctionContext = `A2A delegation result: ${JSON.stringify(a2aResult).slice(0, 300)}`;
              await this.sleep(500);
              continue;
            }
          } catch (e) {
            decisionRouter.markRouteSuccess(false);
            console.warn('[AgentCore] A2A delegation failed, falling back to browser:', e);
          }
        }

        if (routeDecision.route === 'wait_for_user') {
          this.stateMachine.send({ type: 'NEED_INPUT', question: routeDecision.question });
          this.emitStep('waiting', routeDecision.question);
          await this.sleep(2000);
          continue;
        }

      } catch (e) {
        console.warn('[AgentCore] Decision routing failed, using default browser action:', e);
      }

      // Step 4b: Check if complete
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

      // Molmo grounding: if this is a click and confidence is low, use Molmo to verify coordinates
      if (response.action.type === 'click' && response.action.target) {
        try {
          const resolved = await molmoVision.resolveClickTarget(
            { x: response.action.x!, y: response.action.y!, confidence: response.confidence, target: response.action.target },
            screenshot,
          );
          if (resolved.overridden) {
            response.action.x = resolved.x;
            response.action.y = resolved.y;
            this.emitStep('learning', `Molmo grounding: "${response.action.target}" → (${resolved.x}, ${resolved.y})`);
          }
        } catch (e) {
          console.warn('[AgentCore] Molmo grounding failed, using Gemini coords:', e);
        }
      }

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
      
      // FORCE press Enter after typing — this is the #1 cause of getting stuck
      if (response.action.type === 'type') {
        this.correctionContext = 'MANDATORY: You just typed text. Your VERY NEXT action MUST be {"type": "press", "key": "Enter"} to submit. Do NOT look for a button. Do NOT click anything. Just press Enter NOW.';
      } else if (response.action.type === 'press' && this.correctionContext?.includes('MANDATORY')) {
        // Clear the hint after Enter was pressed
        this.correctionContext = null;
      } else if (response.action.type !== 'press') {
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
      
      // Check if same action repeated too many times — with smarter recovery hints
      const signatureCount = this.recentActionSignatures.filter(s => s === actionSignature).length;
      if (signatureCount >= this.maxRepeatedActions) {
        const actionType = response.action.type;
        let recovery = '';
        if (actionType === 'click') {
          recovery = 'Your clicks are not working. Try: 1) Press Enter instead of clicking. 2) Use Tab to focus the element then Enter. 3) Try completely different coordinates. 4) The element might be off-screen — scroll first.';
        } else if (actionType === 'type') {
          recovery = 'You are typing repeatedly. After typing, you MUST press Enter to submit. Use {"type": "press", "key": "Enter"} as your next action.';
        } else if (actionType === 'scroll') {
          recovery = 'You are scrolling in circles. Stop scrolling and work with what is visible NOW. If you cannot find the target, try navigating directly to the URL.';
        } else {
          recovery = 'You are stuck repeating the same action. Try a completely different approach to accomplish the task.';
        }
        this.correctionContext = `STUCK DETECTED: You repeated "${actionType}" on "${response.action.target || 'same element'}" ${signatureCount} times. ${recovery}`;
        this.recentActionSignatures = []; // Reset to give fresh start
      }

      // Detect type→click loop (agent types then clicks instead of pressing Enter)
      if (this.actionHistory.length >= 2) {
        const prev = this.actionHistory[this.actionHistory.length - 1];
        const prevPrev = this.actionHistory.length >= 3 ? this.actionHistory[this.actionHistory.length - 2] : null;
        if (prev?.type === 'type' && response.action.type === 'click' && prevPrev?.type === 'type') {
          this.correctionContext = 'PATTERN DETECTED: You keep typing then clicking instead of submitting. After typing in a search box, you MUST press Enter. Use {"type": "press", "key": "Enter"} NOW.';
        }
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

  private async executeMCPRoute(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    try {
      // Zapier NLA tools: route to zapierNLA client
      if (toolName.startsWith('zapier_nla_')) {
        const actionId = toolName.replace('zapier_nla_', '');
        const { zapierNLA } = await import('./zapierNLA');
        const result = await zapierNLA.executeAction(actionId, args);
        if (result.status === 'success') {
          return { success: true, data: result.result };
        }
        return { success: false, error: result.error || 'Zapier execution failed' };
      }

      // Connect Hub virtual tools (connecthub_* servers) — delegate to background worker
      if (serverId.startsWith('connecthub_')) {
        const appId = serverId.replace('connecthub_', '');
        const result = await chrome.runtime.sendMessage({
          type: 'CONNECTHUB_EXECUTE_TOOL',
          payload: { appId, toolName, args },
        });
        if (result?.success) {
          return { success: true, data: result.data || result.result };
        }
        return { success: false, error: result?.error || 'Connect Hub tool execution failed' };
      }

      // Real MCP servers: use mcpClient directly
      const result = await mcpClient.callTool(serverId, toolName, args);
      return { success: true, data: result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'MCP tool call failed';
      console.error(`[AgentCore] MCP route execution error (${toolName}):`, e);
      return { success: false, error: msg };
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
