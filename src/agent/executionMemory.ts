// 🧠 EXECUTION MEMORY — Persistent action memory that learns from every run
// "Every failure makes the system better automatically"
// Stores action traces, outcomes, failures, timing, and learned patterns per site+task

import { ActionSchema } from './prompts';

export interface ExecutionTrace {
  id: string;
  task: string;
  taskFingerprint: string; // normalized task signature for matching
  sitePattern: string; // URL domain/path pattern
  startedAt: number;
  completedAt?: number;
  success: boolean;
  actions: TracedAction[];
  totalDuration: number;
  failurePoint?: FailureRecord;
  learnedPatterns: LearnedPattern[];
  version: number; // increments each time this trace is improved
}

export interface TracedAction {
  order: number;
  action: ActionSchema;
  screenshotHash?: string; // lightweight hash, not the full screenshot
  pageUrl: string;
  timestamp: number;
  duration: number; // ms to complete
  success: boolean;
  error?: string;
  retries: number;
  domContext?: DOMContext; // what DOM state was like
  visualContext?: string; // observation from LLM
}

export interface DOMContext {
  activeElementTag?: string;
  activeElementSelector?: string;
  visibleTextNear?: string; // text near the click target
  viewportScroll?: { x: number; y: number };
}

export interface FailureRecord {
  actionIndex: number;
  action: ActionSchema;
  error: string;
  pageUrl: string;
  timestamp: number;
  category: FailureCategory;
  fixApplied?: string; // description of fix if one was generated
  fixWorked?: boolean;
}

export type FailureCategory =
  | 'element_not_found'
  | 'wrong_coordinates'
  | 'page_not_loaded'
  | 'navigation_failed'
  | 'timeout'
  | 'selector_changed'
  | 'captcha_blocked'
  | 'auth_required'
  | 'rate_limited'
  | 'unknown';

export interface LearnedPattern {
  id: string;
  type: 'timing' | 'selector' | 'fallback' | 'skip' | 'correction';
  site: string;
  description: string;
  rule: string; // machine-readable rule
  confidence: number;
  appliedCount: number;
  successCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryQuery {
  task?: string;
  sitePattern?: string;
  onlySuccessful?: boolean;
  limit?: number;
}

const STORAGE_KEY = 'handoff_execution_memory';
const PATTERNS_KEY = 'handoff_learned_patterns';
const MAX_TRACES = 200;
const MAX_PATTERNS = 500;

class ExecutionMemoryService {
  private traces: Map<string, ExecutionTrace> = new Map();
  private patterns: Map<string, LearnedPattern> = new Map();
  private initialized = false;
  private currentTrace: ExecutionTrace | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY, PATTERNS_KEY]);
      const savedTraces: ExecutionTrace[] = result[STORAGE_KEY] || [];
      const savedPatterns: LearnedPattern[] = result[PATTERNS_KEY] || [];
      savedTraces.forEach((t) => this.traces.set(t.id, t));
      savedPatterns.forEach((p) => this.patterns.set(p.id, p));
      this.initialized = true;
      console.log(`[ExecutionMemory] Loaded ${this.traces.size} traces, ${this.patterns.size} patterns`);
    } catch (error) {
      console.error('[ExecutionMemory] Failed to load:', error);
      this.initialized = true; // continue without saved data
    }
  }

  private async persist(): Promise<void> {
    const traces = Array.from(this.traces.values());
    const patterns = Array.from(this.patterns.values());
    await chrome.storage.local.set({
      [STORAGE_KEY]: traces,
      [PATTERNS_KEY]: patterns,
    });
  }

  private generateId(): string {
    return `et_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  // ── Fingerprinting ──────────────────────────────────────────────
  // Normalizes a task description into a comparable signature
  fingerprint(task: string): string {
    return task
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .sort()
      .join('_');
  }

  extractSitePattern(url: string): string {
    try {
      const u = new URL(url);
      return u.hostname + u.pathname.split('/').slice(0, 2).join('/');
    } catch {
      return 'unknown';
    }
  }

  // ── Trace Lifecycle ─────────────────────────────────────────────

  async startTrace(task: string, pageUrl: string): Promise<ExecutionTrace> {
    await this.init();

    const trace: ExecutionTrace = {
      id: this.generateId(),
      task,
      taskFingerprint: this.fingerprint(task),
      sitePattern: this.extractSitePattern(pageUrl),
      startedAt: Date.now(),
      success: false,
      actions: [],
      totalDuration: 0,
      learnedPatterns: [],
      version: 1,
    };

    this.currentTrace = trace;
    return trace;
  }

  recordAction(
    action: ActionSchema,
    pageUrl: string,
    success: boolean,
    duration: number,
    options?: {
      error?: string;
      retries?: number;
      domContext?: DOMContext;
      visualContext?: string;
    }
  ): void {
    if (!this.currentTrace) return;

    const traced: TracedAction = {
      order: this.currentTrace.actions.length,
      action,
      pageUrl,
      timestamp: Date.now(),
      duration,
      success,
      error: options?.error,
      retries: options?.retries || 0,
      domContext: options?.domContext,
      visualContext: options?.visualContext,
    };

    this.currentTrace.actions.push(traced);
  }

  recordFailure(
    action: ActionSchema,
    error: string,
    pageUrl: string,
    category: FailureCategory
  ): void {
    if (!this.currentTrace) return;

    this.currentTrace.failurePoint = {
      actionIndex: this.currentTrace.actions.length,
      action,
      error,
      pageUrl,
      timestamp: Date.now(),
      category,
    };
  }

  async completeTrace(success: boolean): Promise<ExecutionTrace | null> {
    if (!this.currentTrace) return null;

    this.currentTrace.success = success;
    this.currentTrace.completedAt = Date.now();
    this.currentTrace.totalDuration = Date.now() - this.currentTrace.startedAt;

    // Store trace
    this.traces.set(this.currentTrace.id, this.currentTrace);

    // Enforce storage limit (evict oldest unsuccessful traces first)
    if (this.traces.size > MAX_TRACES) {
      this.evictOldTraces();
    }

    // Auto-extract patterns from this trace
    if (success) {
      this.extractPatternsFromSuccess(this.currentTrace);
    } else {
      this.extractPatternsFromFailure(this.currentTrace);
    }

    const completed = this.currentTrace;
    this.currentTrace = null;

    await this.persist();
    return completed;
  }

  getCurrentTrace(): ExecutionTrace | null {
    return this.currentTrace;
  }

  // ── Query ───────────────────────────────────────────────────────

  async findRelevantTraces(query: MemoryQuery): Promise<ExecutionTrace[]> {
    await this.init();

    let results = Array.from(this.traces.values());

    if (query.task) {
      const fp = this.fingerprint(query.task);
      results = results.filter((t) => {
        // Exact fingerprint match or significant overlap
        if (t.taskFingerprint === fp) return true;
        const overlap = this.fingerprintOverlap(t.taskFingerprint, fp);
        return overlap > 0.5;
      });
    }

    if (query.sitePattern) {
      results = results.filter((t) => t.sitePattern.includes(query.sitePattern!));
    }

    if (query.onlySuccessful) {
      results = results.filter((t) => t.success);
    }

    // Sort by recency and success
    results.sort((a, b) => {
      if (a.success !== b.success) return a.success ? -1 : 1;
      return (b.completedAt || b.startedAt) - (a.completedAt || a.startedAt);
    });

    return results.slice(0, query.limit || 10);
  }

  // Find patterns applicable to current task+site
  async getApplicablePatterns(_task: string, sitePattern: string): Promise<LearnedPattern[]> {
    await this.init();

    return Array.from(this.patterns.values())
      .filter((p) => {
        if (p.site !== '*' && !sitePattern.includes(p.site)) return false;
        if (p.confidence < 0.3) return false;
        return true;
      })
      .sort((a, b) => b.confidence - a.confidence);
  }

  // Build a context string the LLM can use
  async buildMemoryContext(task: string, pageUrl: string): Promise<string> {
    const site = this.extractSitePattern(pageUrl);
    const traces = await this.findRelevantTraces({
      task,
      sitePattern: site,
      limit: 3,
    });
    const patterns = await this.getApplicablePatterns(task, site);

    if (traces.length === 0 && patterns.length === 0) return '';

    let context = '\n\n## EXECUTION MEMORY (learned from previous runs)\n';

    // Add successful trace hints
    const successfulTraces = traces.filter((t) => t.success);
    if (successfulTraces.length > 0) {
      const best = successfulTraces[0];
      context += '\n### Previously Successful Approach\n';
      context += `Task: "${best.task}" completed in ${best.actions.length} steps (${Math.round(best.totalDuration / 1000)}s)\n`;
      context += 'Steps that worked:\n';
      best.actions.slice(0, 8).forEach((a, i) => {
        context += `  ${i + 1}. ${a.action.type}${a.action.target ? ` on "${a.action.target}"` : ''}${a.action.x ? ` at (${a.action.x},${a.action.y})` : ''}\n`;
      });
    }

    // Add failure warnings
    const failedTraces = traces.filter((t) => !t.success && t.failurePoint);
    if (failedTraces.length > 0) {
      context += '\n### Known Failure Points (AVOID THESE)\n';
      failedTraces.slice(0, 3).forEach((t) => {
        const fp = t.failurePoint!;
        context += `- "${fp.action.type} on ${fp.action.target}" failed: ${fp.error} (${fp.category})\n`;
        if (fp.fixApplied) {
          context += `  Fix: ${fp.fixApplied}\n`;
        }
      });
    }

    // Add learned patterns
    if (patterns.length > 0) {
      context += '\n### Learned Rules\n';
      patterns.slice(0, 5).forEach((p) => {
        context += `- [${p.type}] ${p.description} (confidence: ${Math.round(p.confidence * 100)}%, used ${p.appliedCount}x)\n`;
      });
    }

    return context;
  }

  // ── Pattern Extraction ──────────────────────────────────────────

  private extractPatternsFromSuccess(trace: ExecutionTrace): void {
    const site = trace.sitePattern;

    // Timing pattern: learn average wait times for this site
    const waitActions = trace.actions.filter(
      (a) => a.action.type === 'wait' && a.success
    );
    if (waitActions.length > 0) {
      const avgWait = waitActions.reduce((s, a) => s + (a.action.duration || 1000), 0) / waitActions.length;
      this.upsertPattern({
        type: 'timing',
        site,
        description: `Optimal wait time for ${site}: ${Math.round(avgWait)}ms`,
        rule: JSON.stringify({ site, waitMs: Math.round(avgWait) }),
        confidence: 0.7,
      });
    }

    // Selector pattern: learn which coordinates/targets work for common actions
    const clickActions = trace.actions.filter(
      (a) => a.action.type === 'click' && a.success && a.action.target
    );
    clickActions.forEach((a) => {
      this.upsertPattern({
        type: 'selector',
        site,
        description: `Click "${a.action.target}" at (${a.action.x},${a.action.y}) works on ${site}`,
        rule: JSON.stringify({
          site,
          target: a.action.target,
          x: a.action.x,
          y: a.action.y,
          pageUrl: a.pageUrl,
        }),
        confidence: 0.6,
      });
    });
  }

  private extractPatternsFromFailure(trace: ExecutionTrace): void {
    if (!trace.failurePoint) return;
    const fp = trace.failurePoint;
    const site = trace.sitePattern;

    // Create avoidance pattern
    this.upsertPattern({
      type: 'correction',
      site,
      description: `AVOID: ${fp.action.type} on "${fp.action.target}" at (${fp.action.x},${fp.action.y}) — ${fp.error}`,
      rule: JSON.stringify({
        site,
        avoid: {
          type: fp.action.type,
          target: fp.action.target,
          x: fp.action.x,
          y: fp.action.y,
        },
        reason: fp.error,
        category: fp.category,
      }),
      confidence: 0.8,
    });

    // If we have successful actions before the failure, learn the valid prefix
    const successfulPrefix = trace.actions.filter((a) => a.success);
    if (successfulPrefix.length >= 2) {
      this.upsertPattern({
        type: 'fallback',
        site,
        description: `First ${successfulPrefix.length} steps work for "${trace.task}" on ${site}`,
        rule: JSON.stringify({
          site,
          task: trace.task,
          validSteps: successfulPrefix.length,
          failsAt: fp.actionIndex,
        }),
        confidence: 0.5,
      });
    }
  }

  private upsertPattern(data: {
    type: LearnedPattern['type'];
    site: string;
    description: string;
    rule: string;
    confidence: number;
  }): void {
    // Look for existing similar pattern
    const existing = Array.from(this.patterns.values()).find(
      (p) => p.type === data.type && p.site === data.site && p.rule === data.rule
    );

    if (existing) {
      existing.appliedCount++;
      existing.confidence = Math.min(1, existing.confidence + 0.05);
      existing.updatedAt = Date.now();
    } else {
      if (this.patterns.size >= MAX_PATTERNS) {
        // Evict lowest confidence pattern
        const lowest = Array.from(this.patterns.entries())
          .sort((a, b) => a[1].confidence - b[1].confidence)[0];
        if (lowest) this.patterns.delete(lowest[0]);
      }

      const pattern: LearnedPattern = {
        id: `lp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        ...data,
        appliedCount: 1,
        successCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.patterns.set(pattern.id, pattern);
    }
  }

  // Record that a pattern was used and whether it helped
  async recordPatternOutcome(patternId: string, success: boolean): Promise<void> {
    const pattern = this.patterns.get(patternId);
    if (!pattern) return;

    pattern.appliedCount++;
    if (success) pattern.successCount++;

    // Update confidence based on success rate
    const rate = pattern.successCount / pattern.appliedCount;
    pattern.confidence = 0.3 * pattern.confidence + 0.7 * rate;
    pattern.updatedAt = Date.now();

    // Remove patterns that consistently fail
    if (pattern.appliedCount >= 5 && pattern.confidence < 0.2) {
      this.patterns.delete(patternId);
    }

    await this.persist();
  }

  // ── Utilities ───────────────────────────────────────────────────

  private fingerprintOverlap(fp1: string, fp2: string): number {
    const words1 = new Set(fp1.split('_'));
    const words2 = new Set(fp2.split('_'));
    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  private evictOldTraces(): void {
    const sorted = Array.from(this.traces.entries())
      .sort((a, b) => {
        // Keep successful traces longer
        if (a[1].success !== b[1].success) return a[1].success ? 1 : -1;
        return (a[1].completedAt || a[1].startedAt) - (b[1].completedAt || b[1].startedAt);
      });

    while (this.traces.size > MAX_TRACES && sorted.length > 0) {
      const [id] = sorted.shift()!;
      this.traces.delete(id);
    }
  }

  async getStats(): Promise<{
    totalTraces: number;
    successfulTraces: number;
    totalPatterns: number;
    topSites: string[];
  }> {
    await this.init();
    const allTraces = Array.from(this.traces.values());
    const siteCounts = new Map<string, number>();
    allTraces.forEach((t) => {
      siteCounts.set(t.sitePattern, (siteCounts.get(t.sitePattern) || 0) + 1);
    });

    return {
      totalTraces: allTraces.length,
      successfulTraces: allTraces.filter((t) => t.success).length,
      totalPatterns: this.patterns.size,
      topSites: Array.from(siteCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([site]) => site),
    };
  }

  async clearAll(): Promise<void> {
    this.traces.clear();
    this.patterns.clear();
    this.currentTrace = null;
    await chrome.storage.local.remove([STORAGE_KEY, PATTERNS_KEY]);
  }
}

// Singleton
export const executionMemory = new ExecutionMemoryService();
