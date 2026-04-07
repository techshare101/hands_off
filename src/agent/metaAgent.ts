// 🧬 META-AGENT — Self-Optimizing Prompt & Strategy Engine
// Inspired by AutoAgent: score-driven hill climbing on prompts, routing, and tool configs
// Reads execution traces → identifies weak points → generates prompt mutations → keeps if better
//
// This runs INSIDE the Chrome extension (no Docker needed).
// The "benchmark" is real user task data from executionMemory.

import { executionMemory, ExecutionTrace } from './executionMemory';
import { autoSkill } from './autoSkill';

// ── Types ───────────────────────────────────────────────────────────

export interface PromptPatch {
  id: string;
  type: 'append' | 'replace_section' | 'add_rule' | 'site_specific';
  section?: string; // which section to modify (e.g., 'CRITICAL RULES', 'VISUAL PERCEPTION')
  content: string;
  generatedFrom: string; // what trace/pattern triggered this
  createdAt: number;
  score: number; // 0.0 → 1.0 effectiveness
  appliedCount: number;
  successCount: number;
  status: 'candidate' | 'active' | 'proven' | 'rejected';
}

export interface OptimizationExperiment {
  id: string;
  patch: PromptPatch;
  baselineScore: number;
  experimentScore: number;
  tasksEvaluated: number;
  startedAt: number;
  completedAt?: number;
  verdict: 'pending' | 'keep' | 'discard';
}

export interface SiteStrategy {
  sitePattern: string;
  preferredMode: 'dom' | 'vision' | 'memory' | 'skill';
  customRules: string[];
  avgSuccessRate: number;
  totalRuns: number;
  lastUpdated: number;
}

export interface MetaAgentStats {
  totalExperiments: number;
  activePatches: number;
  provenPatches: number;
  rejectedPatches: number;
  siteStrategies: number;
  overallScoreImprovement: number;
  lastOptimizationRun: number;
}

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  instruction: string;
  siteUrl: string;
  verificationRules: VerificationRule[];
  category: 'form' | 'research' | 'navigation' | 'extraction' | 'workflow';
  expectedSteps: number;
  timeoutMs: number;
  createdAt: number;
  lastScore: number;
  runCount: number;
}

export interface VerificationRule {
  type: 'url_contains' | 'url_changed' | 'element_visible' | 'text_present' | 'action_count_under' | 'completed_flag';
  value: string;
  weight: number; // 0.0 → 1.0 contribution to final score
}

export interface TaskScore {
  taskId: string;
  score: number; // 0.0 → 1.0
  breakdown: { rule: string; passed: boolean; weight: number }[];
  duration: number;
  actionCount: number;
  timestamp: number;
}

// ── Storage Keys ────────────────────────────────────────────────────

const PATCHES_KEY = 'handoff_meta_patches';
const EXPERIMENTS_KEY = 'handoff_meta_experiments';
const SITE_STRATEGIES_KEY = 'handoff_site_strategies';
const TEMPLATES_KEY = 'handoff_task_templates';
const SCORES_KEY = 'handoff_task_scores';
const META_STATS_KEY = 'handoff_meta_stats';

// ── Meta-Agent Service ──────────────────────────────────────────────

class MetaAgentService {
  private patches: Map<string, PromptPatch> = new Map();
  private experiments: Map<string, OptimizationExperiment> = new Map();
  private siteStrategies: Map<string, SiteStrategy> = new Map();
  private templates: Map<string, TaskTemplate> = new Map();
  private scores: TaskScore[] = [];
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const result = await chrome.storage.local.get([
        PATCHES_KEY, EXPERIMENTS_KEY, SITE_STRATEGIES_KEY,
        TEMPLATES_KEY, SCORES_KEY,
      ]);
      const savedPatches: PromptPatch[] = result[PATCHES_KEY] || [];
      const savedExperiments: OptimizationExperiment[] = result[EXPERIMENTS_KEY] || [];
      const savedStrategies: SiteStrategy[] = result[SITE_STRATEGIES_KEY] || [];
      const savedTemplates: TaskTemplate[] = result[TEMPLATES_KEY] || [];
      this.scores = result[SCORES_KEY] || [];

      savedPatches.forEach(p => this.patches.set(p.id, p));
      savedExperiments.forEach(e => this.experiments.set(e.id, e));
      savedStrategies.forEach(s => this.siteStrategies.set(s.sitePattern, s));
      savedTemplates.forEach(t => this.templates.set(t.id, t));

      this.initialized = true;
      console.log(`[MetaAgent] Loaded ${this.patches.size} patches, ${this.siteStrategies.size} site strategies, ${this.templates.size} templates`);
    } catch (error) {
      console.error('[MetaAgent] Failed to load:', error);
      this.initialized = true;
    }
  }

  private async persist(): Promise<void> {
    await chrome.storage.local.set({
      [PATCHES_KEY]: Array.from(this.patches.values()),
      [EXPERIMENTS_KEY]: Array.from(this.experiments.values()).slice(-50),
      [SITE_STRATEGIES_KEY]: Array.from(this.siteStrategies.values()),
      [TEMPLATES_KEY]: Array.from(this.templates.values()),
      [SCORES_KEY]: this.scores.slice(-200),
    });
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  }

  // ── Score Calculation ─────────────────────────────────────────────
  // The "benchmark score" for HandOff — computed from real execution traces

  async computeOverallScore(): Promise<number> {
    await executionMemory.init();
    const stats = await executionMemory.getStats();
    if (stats.totalTraces === 0) return 0;

    const successRate = stats.successfulTraces / stats.totalTraces;

    // Factor in efficiency (fewer actions = better)
    const traces = await executionMemory.findRelevantTraces({ limit: 50 });
    const successfulTraces = traces.filter(t => t.success);
    let efficiencyScore = 0.5;
    if (successfulTraces.length > 0) {
      const avgActions = successfulTraces.reduce((s, t) => s + t.actions.length, 0) / successfulTraces.length;
      // Fewer actions is better; normalize to 0-1 (1 action = 1.0, 50+ actions = 0.1)
      efficiencyScore = Math.max(0.1, 1 - (avgActions / 50));
    }

    // Factor in skill reliability
    const skills = await autoSkill.getAllSkills();
    const provenSkills = skills.filter((s: { metadata: { reliability: string } }) => s.metadata.reliability === 'proven');
    const skillBonus = Math.min(0.15, provenSkills.length * 0.03);

    // Weighted score
    return Math.min(1.0, successRate * 0.6 + efficiencyScore * 0.25 + skillBonus + 0.1);
  }

  // Score a specific trace
  scoreTrace(trace: ExecutionTrace): number {
    let score = 0;

    // Success is the primary signal (60%)
    if (trace.success) score += 0.6;

    // Efficiency: fewer actions for the same task (20%)
    const actionCount = trace.actions.length;
    score += Math.max(0, 0.2 * (1 - actionCount / 40));

    // Speed: faster is better (10%)
    const durationMinutes = trace.totalDuration / 60000;
    score += Math.max(0, 0.1 * (1 - durationMinutes / 5));

    // No failures along the way (10%)
    const failedActions = trace.actions.filter(a => !a.success).length;
    score += Math.max(0, 0.1 * (1 - failedActions / Math.max(1, actionCount)));

    return Math.min(1.0, Math.max(0, score));
  }

  // ── Prompt Optimization ───────────────────────────────────────────
  // Analyzes execution traces and generates prompt patches

  async runOptimizationCycle(): Promise<{
    patchesGenerated: number;
    experimentsStarted: number;
    insights: string[];
  }> {
    await this.init();
    await executionMemory.init();

    const insights: string[] = [];
    let patchesGenerated = 0;
    let experimentsStarted = 0;

    // 1. Analyze recent failures to find prompt weaknesses
    const recentTraces = await executionMemory.findRelevantTraces({ limit: 30 });
    const failedTraces = recentTraces.filter(t => !t.success);
    const successfulTraces = recentTraces.filter(t => t.success);

    if (recentTraces.length < 3) {
      insights.push('Not enough execution data yet. Run more tasks to enable optimization.');
      return { patchesGenerated, experimentsStarted, insights };
    }

    const baselineScore = await this.computeOverallScore();
    insights.push(`Current baseline score: ${(baselineScore * 100).toFixed(1)}%`);

    // 2. Identify failure patterns
    const failureCategories = new Map<string, number>();
    failedTraces.forEach(t => {
      if (t.failurePoint) {
        const cat = t.failurePoint.category;
        failureCategories.set(cat, (failureCategories.get(cat) || 0) + 1);
      }
    });

    // 3. Generate patches based on failure analysis
    for (const [category, count] of failureCategories.entries()) {
      if (count >= 2) {
        const patch = this.generatePatchForFailure(category, failedTraces, count);
        if (patch) {
          this.patches.set(patch.id, patch);
          patchesGenerated++;
          insights.push(`Generated patch for ${category} failures (${count} occurrences)`);
        }
      }
    }

    // 4. Analyze site-specific patterns
    const siteFailures = new Map<string, ExecutionTrace[]>();
    failedTraces.forEach(t => {
      const site = t.sitePattern;
      if (!siteFailures.has(site)) siteFailures.set(site, []);
      siteFailures.get(site)!.push(t);
    });

    for (const [site, traces] of siteFailures.entries()) {
      if (traces.length >= 2) {
        const strategy = this.analyzeSiteStrategy(site, traces, successfulTraces.filter(t => t.sitePattern === site));
        this.siteStrategies.set(site, strategy);
        insights.push(`Updated strategy for ${site}: prefer ${strategy.preferredMode} mode (${(strategy.avgSuccessRate * 100).toFixed(0)}% success)`);
      }
    }

    // 5. Generate efficiency patches from successful traces
    if (successfulTraces.length >= 3) {
      const inefficientTraces = successfulTraces.filter(t => t.actions.length > 15);
      if (inefficientTraces.length > 0) {
        const patch = this.generateEfficiencyPatch(inefficientTraces);
        if (patch) {
          this.patches.set(patch.id, patch);
          patchesGenerated++;
          insights.push(`Generated efficiency patch: ${inefficientTraces.length} tasks took too many steps`);
        }
      }
    }

    // 6. Start experiments for new candidate patches
    const candidates = Array.from(this.patches.values()).filter(p => p.status === 'candidate');
    for (const patch of candidates.slice(0, 3)) { // max 3 experiments at a time
      const experiment: OptimizationExperiment = {
        id: this.generateId('exp'),
        patch,
        baselineScore,
        experimentScore: 0,
        tasksEvaluated: 0,
        startedAt: Date.now(),
        verdict: 'pending',
      };
      this.experiments.set(experiment.id, experiment);
      patch.status = 'active';
      experimentsStarted++;
    }

    await this.persist();
    await this.persistStats();

    return { patchesGenerated, experimentsStarted, insights };
  }

  // Generate a prompt patch to address a specific failure category
  private generatePatchForFailure(
    category: string,
    failedTraces: ExecutionTrace[],
    _count: number
  ): PromptPatch | null {
    const relevantTraces = failedTraces.filter(t => t.failurePoint?.category === category);

    const patchMap: Record<string, { section: string; content: string }> = {
      'element_not_found': {
        section: 'CRITICAL RULES',
        content: 'Before clicking, verify the target element is visible in the current viewport. If an element is not found after 2 attempts, scroll to find it or try an alternative selector. Common causes: page not fully loaded, element behind a modal, or dynamic content not yet rendered.',
      },
      'wrong_coordinates': {
        section: 'VISUAL PERCEPTION',
        content: 'Double-check click coordinates against visual landmarks. If your last click missed (no state change), offset by 10-20px in each direction. For small buttons, aim for the center text, not the edge. On high-DPI displays, coordinates may need scaling.',
      },
      'page_not_loaded': {
        section: 'CRITICAL RULES',
        content: 'After every navigation or page change, WAIT for the page to fully load before acting. Look for: loading spinners gone, main content visible, URL has changed. If the page shows a blank/loading state, use wait action for 2-3 seconds.',
      },
      'timeout': {
        section: 'CRITICAL RULES',
        content: 'If an action takes too long, the page may be slow or the element may be behind a lazy-load. Try: 1) Wait 2s then retry, 2) Scroll to trigger lazy loading, 3) Navigate directly to the target URL if possible.',
      },
      'navigation_failed': {
        section: 'CRITICAL RULES',
        content: 'If navigation fails, check: 1) Is the URL correct? 2) Is there a redirect? 3) Does the site require authentication? Use the navigate action with full URLs including https://. If blocked, try an alternative route to the target page.',
      },
      'selector_changed': {
        section: 'VISUAL PERCEPTION',
        content: 'Website elements change over time. If a previously working selector fails, use visual cues instead: look for the element by its visible text, icon shape, or position relative to other elements. Never rely on exact coordinates from past runs if the page layout looks different.',
      },
      'captcha_blocked': {
        section: 'CRITICAL RULES',
        content: 'If you encounter a CAPTCHA, you cannot solve it. Mark the action as requiring approval and describe what type of CAPTCHA is present. The user will need to solve it manually.',
      },
      'auth_required': {
        section: 'CRITICAL RULES',
        content: 'If a page requires login, check if credentials are available in the task context. If not, mark as requiring approval and explain that authentication is needed. Never guess passwords.',
      },
      'rate_limited': {
        section: 'CRITICAL RULES',
        content: 'If you see rate limiting (429 errors, "too many requests", or similar), slow down. Use wait actions of 5-10 seconds between requests. If the site continues to block, inform the user.',
      },
    };

    const patchDef = patchMap[category];
    if (!patchDef) return null;

    // Check if we already have a similar patch
    const existing = Array.from(this.patches.values()).find(
      p => p.section === patchDef.section && p.content === patchDef.content
    );
    if (existing) return null;

    // Extract specific examples from traces
    const examples = relevantTraces.slice(0, 2).map(t => {
      const fp = t.failurePoint!;
      return `${fp.action.type} on "${fp.action.target}" at ${t.sitePattern}`;
    });

    return {
      id: this.generateId('patch'),
      type: 'add_rule',
      section: patchDef.section,
      content: patchDef.content + (examples.length > 0 ? `\n(Learned from failures: ${examples.join('; ')})` : ''),
      generatedFrom: `${category} failures (${relevantTraces.length} instances)`,
      createdAt: Date.now(),
      score: 0,
      appliedCount: 0,
      successCount: 0,
      status: 'candidate',
    };
  }

  // Generate a patch to improve efficiency
  private generateEfficiencyPatch(inefficientTraces: ExecutionTrace[]): PromptPatch | null {
    // Analyze common patterns in inefficient traces
    const redundantPatterns: string[] = [];

    for (const trace of inefficientTraces) {
      // Detect repeated clicks on same target
      const clickTargets = trace.actions
        .filter(a => a.action.type === 'click')
        .map(a => a.action.target);
      const targetCounts = new Map<string, number>();
      clickTargets.forEach(t => {
        if (t) targetCounts.set(t, (targetCounts.get(t) || 0) + 1);
      });
      for (const [target, count] of targetCounts.entries()) {
        if (count >= 3) {
          redundantPatterns.push(`Clicking "${target}" ${count} times`);
        }
      }

      // Detect back-and-forth navigation
      const navActions = trace.actions.filter(a => a.action.type === 'navigate');
      if (navActions.length > 3) {
        redundantPatterns.push(`${navActions.length} navigation actions (possible wandering)`);
      }
    }

    if (redundantPatterns.length === 0) return null;

    return {
      id: this.generateId('patch'),
      type: 'add_rule',
      section: 'CRITICAL RULES',
      content: `EFFICIENCY: Avoid redundant actions. If you've clicked the same element 2+ times without effect, it's not working — try a different approach. If you've navigated to 3+ different pages, you may be wandering — re-read the task and plan a direct route. Common issues detected: ${redundantPatterns.slice(0, 3).join('; ')}.`,
      generatedFrom: `Efficiency analysis (${inefficientTraces.length} slow traces)`,
      createdAt: Date.now(),
      score: 0,
      appliedCount: 0,
      successCount: 0,
      status: 'candidate',
    };
  }

  // ── Site Strategy Analysis ────────────────────────────────────────

  private analyzeSiteStrategy(
    site: string,
    failures: ExecutionTrace[],
    successes: ExecutionTrace[]
  ): SiteStrategy {
    const totalRuns = failures.length + successes.length;
    const successRate = successes.length / totalRuns;

    // Determine best mode based on success patterns
    const modeSuccess = new Map<string, { success: number; total: number }>();
    [...failures, ...successes].forEach(t => {
      t.actions.forEach(a => {
        // Infer mode from action patterns
        const mode = a.action.type === 'navigate' ? 'dom' :
                     a.visualContext ? 'vision' : 'dom';
        const current = modeSuccess.get(mode) || { success: 0, total: 0 };
        current.total++;
        if (a.success) current.success++;
        modeSuccess.set(mode, current);
      });
    });

    let preferredMode: 'dom' | 'vision' | 'memory' | 'skill' = 'dom';
    let bestRate = 0;
    for (const [mode, stats] of modeSuccess.entries()) {
      const rate = stats.total > 0 ? stats.success / stats.total : 0;
      if (rate > bestRate) {
        bestRate = rate;
        preferredMode = mode as typeof preferredMode;
      }
    }

    // Extract custom rules from failure patterns
    const customRules: string[] = [];
    const failureTypes = new Map<string, number>();
    failures.forEach(t => {
      if (t.failurePoint) {
        failureTypes.set(t.failurePoint.category, (failureTypes.get(t.failurePoint.category) || 0) + 1);
      }
    });
    for (const [type, count] of failureTypes.entries()) {
      if (count >= 2) {
        customRules.push(`High ${type} failure rate (${count}x) — adjust approach for this site`);
      }
    }

    return {
      sitePattern: site,
      preferredMode,
      customRules,
      avgSuccessRate: successRate,
      totalRuns,
      lastUpdated: Date.now(),
    };
  }

  // ── Active Prompt Enhancement ─────────────────────────────────────
  // Returns additional prompt content based on active/proven patches

  async getActivePromptEnhancements(): Promise<string> {
    await this.init();

    const activePatches = Array.from(this.patches.values())
      .filter(p => p.status === 'active' || p.status === 'proven')
      .sort((a, b) => b.score - a.score);

    if (activePatches.length === 0) return '';

    let enhancement = '\n\n## META-AGENT OPTIMIZATIONS (auto-generated)\n';
    enhancement += 'The following rules were learned from analyzing your execution history:\n\n';

    for (const patch of activePatches.slice(0, 8)) {
      enhancement += `- ${patch.content}\n`;
    }

    return enhancement;
  }

  // Get site-specific strategy for current URL
  async getSiteStrategy(pageUrl: string): Promise<SiteStrategy | null> {
    await this.init();
    const site = executionMemory.extractSitePattern(pageUrl);
    return this.siteStrategies.get(site) || null;
  }

  // Get site-specific prompt additions
  async getSitePromptAdditions(pageUrl: string): Promise<string> {
    const strategy = await this.getSiteStrategy(pageUrl);
    if (!strategy || strategy.customRules.length === 0) return '';

    let additions = `\n\n## SITE-SPECIFIC RULES (${strategy.sitePattern})\n`;
    additions += `Preferred execution mode: ${strategy.preferredMode}\n`;
    additions += `Historical success rate: ${(strategy.avgSuccessRate * 100).toFixed(0)}% over ${strategy.totalRuns} runs\n`;
    strategy.customRules.forEach(rule => {
      additions += `- ${rule}\n`;
    });
    return additions;
  }

  // ── Experiment Evaluation ─────────────────────────────────────────
  // Called after a task completes to evaluate active experiments

  async evaluateExperiments(trace: ExecutionTrace): Promise<void> {
    await this.init();

    const traceScore = this.scoreTrace(trace);

    // Update all pending experiments
    const pendingExperiments = Array.from(this.experiments.values())
      .filter(e => e.verdict === 'pending');

    for (const experiment of pendingExperiments) {
      experiment.tasksEvaluated++;
      experiment.experimentScore = (
        (experiment.experimentScore * (experiment.tasksEvaluated - 1)) + traceScore
      ) / experiment.tasksEvaluated;

      // Update patch stats
      const patch = this.patches.get(experiment.patch.id);
      if (patch) {
        patch.appliedCount++;
        if (trace.success) patch.successCount++;
        patch.score = patch.appliedCount > 0 ? patch.successCount / patch.appliedCount : 0;
      }

      // Evaluate after enough data
      if (experiment.tasksEvaluated >= 5) {
        experiment.completedAt = Date.now();
        const improvement = experiment.experimentScore - experiment.baselineScore;

        if (improvement > 0.02) {
          // Patch improved performance → promote
          experiment.verdict = 'keep';
          if (patch) patch.status = 'proven';
          console.log(`[MetaAgent] Patch ${experiment.patch.id} PROVEN: +${(improvement * 100).toFixed(1)}% improvement`);
        } else if (improvement < -0.05) {
          // Patch made things worse → reject
          experiment.verdict = 'discard';
          if (patch) patch.status = 'rejected';
          console.log(`[MetaAgent] Patch ${experiment.patch.id} REJECTED: ${(improvement * 100).toFixed(1)}% regression`);
        } else {
          // Neutral — need more data, keep active
          if (experiment.tasksEvaluated >= 15) {
            // Too many runs without clear signal → reject
            experiment.verdict = 'discard';
            if (patch) patch.status = 'rejected';
          }
        }
      }
    }

    await this.persist();
  }

  // ── Task Templates ────────────────────────────────────────────────
  // Reusable task definitions with built-in verification

  async createTemplate(template: Omit<TaskTemplate, 'id' | 'createdAt' | 'lastScore' | 'runCount'>): Promise<TaskTemplate> {
    await this.init();
    const t: TaskTemplate = {
      ...template,
      id: this.generateId('tpl'),
      createdAt: Date.now(),
      lastScore: 0,
      runCount: 0,
    };
    this.templates.set(t.id, t);
    await this.persist();
    return t;
  }

  async getTemplates(): Promise<TaskTemplate[]> {
    await this.init();
    return Array.from(this.templates.values());
  }

  async getTemplate(id: string): Promise<TaskTemplate | null> {
    await this.init();
    return this.templates.get(id) || null;
  }

  async deleteTemplate(id: string): Promise<void> {
    this.templates.delete(id);
    await this.persist();
  }

  // Score a completed task against its template
  scoreTaskAgainstTemplate(
    template: TaskTemplate,
    trace: ExecutionTrace,
    verificationResults: { ruleIndex: number; passed: boolean }[]
  ): TaskScore {
    let totalWeight = 0;
    let weightedScore = 0;

    const breakdown = template.verificationRules.map((rule, i) => {
      const result = verificationResults.find(r => r.ruleIndex === i);
      const passed = result?.passed ?? false;
      totalWeight += rule.weight;
      if (passed) weightedScore += rule.weight;
      return { rule: `${rule.type}: ${rule.value}`, passed, weight: rule.weight };
    });

    // Add implicit scoring
    const completionWeight = 0.3;
    totalWeight += completionWeight;
    if (trace.success) weightedScore += completionWeight;
    breakdown.push({ rule: 'task_completed', passed: trace.success, weight: completionWeight });

    const score: TaskScore = {
      taskId: template.id,
      score: totalWeight > 0 ? weightedScore / totalWeight : 0,
      breakdown,
      duration: trace.totalDuration,
      actionCount: trace.actions.length,
      timestamp: Date.now(),
    };

    // Update template stats
    template.lastScore = score.score;
    template.runCount++;

    this.scores.push(score);
    return score;
  }

  // ── Stats & Reporting ─────────────────────────────────────────────

  async getStats(): Promise<MetaAgentStats> {
    await this.init();
    const patches = Array.from(this.patches.values());
    const experiments = Array.from(this.experiments.values());

    const provenPatches = patches.filter(p => p.status === 'proven');
    const rejectedPatches = patches.filter(p => p.status === 'rejected');

    // Compute score improvement from first to recent experiments
    const completedExps = experiments.filter(e => e.verdict !== 'pending' && e.completedAt);
    let scoreImprovement = 0;
    if (completedExps.length >= 2) {
      const first = completedExps[0];
      const last = completedExps[completedExps.length - 1];
      scoreImprovement = last.experimentScore - first.baselineScore;
    }

    return {
      totalExperiments: experiments.length,
      activePatches: patches.filter(p => p.status === 'active').length,
      provenPatches: provenPatches.length,
      rejectedPatches: rejectedPatches.length,
      siteStrategies: this.siteStrategies.size,
      overallScoreImprovement: scoreImprovement,
      lastOptimizationRun: Math.max(0, ...experiments.map(e => e.startedAt)),
    };
  }

  async getActivePatches(): Promise<PromptPatch[]> {
    await this.init();
    return Array.from(this.patches.values())
      .filter(p => p.status === 'active' || p.status === 'proven');
  }

  async getSiteStrategies(): Promise<SiteStrategy[]> {
    await this.init();
    return Array.from(this.siteStrategies.values());
  }

  async getScoreHistory(): Promise<TaskScore[]> {
    await this.init();
    return this.scores.slice(-50);
  }

  private async persistStats(): Promise<void> {
    const stats = await this.getStats();
    await chrome.storage.local.set({ [META_STATS_KEY]: stats });
  }

  async clearAll(): Promise<void> {
    this.patches.clear();
    this.experiments.clear();
    this.siteStrategies.clear();
    this.templates.clear();
    this.scores = [];
    await chrome.storage.local.remove([
      PATCHES_KEY, EXPERIMENTS_KEY, SITE_STRATEGIES_KEY,
      TEMPLATES_KEY, SCORES_KEY, META_STATS_KEY,
    ]);
  }
}

// Singleton
export const metaAgent = new MetaAgentService();
