// ⚡ AUTOSKILL ENGINE — Turns repeated workflows into portable, reusable skills
// "This task has been done 5 times → stabilize it"
// Detects patterns across execution traces and crystallizes them into callable skills

import { ActionSchema } from './prompts';
import { executionMemory, ExecutionTrace } from './executionMemory';

export interface Skill {
  id: string;
  name: string;
  description: string;
  trigger: SkillTrigger;
  steps: SkillStep[];
  metadata: SkillMetadata;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface SkillTrigger {
  taskPatterns: string[]; // normalized task keywords that activate this skill
  sitePatterns: string[]; // URL patterns where this skill applies
  minConfidence: number; // minimum confidence to auto-suggest
}

export interface SkillStep {
  order: number;
  action: ActionSchema;
  description: string;
  waitAfter: number; // learned optimal wait
  retryStrategy: 'none' | 'once' | 'adaptive'; // learned from failures
  fallbackAction?: ActionSchema; // alternative if primary fails
  isOptional: boolean; // can be skipped without breaking workflow
  successRate: number; // 0-1 based on historical data
}

export interface SkillMetadata {
  sourceTraceIds: string[]; // traces this skill was built from
  totalExecutions: number;
  successfulExecutions: number;
  successRate: number;
  avgDuration: number; // ms
  reliability: 'experimental' | 'stable' | 'proven'; // based on success rate + execution count
  lastExecuted?: number;
  userApproved: boolean; // user explicitly saved/approved this skill
}

export interface SkillMatch {
  skill: Skill;
  confidence: number;
  matchReason: string;
}

export interface SkillExecutionResult {
  skillId: string;
  success: boolean;
  stepsCompleted: number;
  totalSteps: number;
  failedAt?: number;
  error?: string;
  duration: number;
}

const STORAGE_KEY = 'handoff_skills';
const MAX_SKILLS = 100;
const MIN_TRACES_TO_STABILIZE = 3; // need at least 3 successful runs to create a skill
const STABILIZATION_SUCCESS_RATE = 0.7; // 70% success rate to auto-create skill

class AutoSkillEngine {
  private skills: Map<string, Skill> = new Map();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const saved: Skill[] = result[STORAGE_KEY] || [];
      saved.forEach((s) => this.skills.set(s.id, s));
      this.initialized = true;
      console.log(`[AutoSkill] Loaded ${this.skills.size} skills`);
    } catch (error) {
      console.error('[AutoSkill] Failed to load:', error);
      this.initialized = true;
    }
  }

  private async persist(): Promise<void> {
    const skills = Array.from(this.skills.values());
    await chrome.storage.local.set({ [STORAGE_KEY]: skills });
  }

  private generateId(): string {
    return `sk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  // ── Skill Detection ─────────────────────────────────────────────

  // Analyze recent traces and detect if a new skill should be created
  async detectNewSkills(): Promise<Skill[]> {
    await this.init();
    const newSkills: Skill[] = [];

    // Group traces by task fingerprint + site
    const traceGroups = await this.groupSimilarTraces();

    for (const [groupKey, traces] of traceGroups.entries()) {
      // Need minimum successful traces
      const successful = traces.filter((t) => t.success);
      if (successful.length < MIN_TRACES_TO_STABILIZE) continue;

      const successRate = successful.length / traces.length;
      if (successRate < STABILIZATION_SUCCESS_RATE) continue;

      // Check if we already have a skill for this group
      const existingSkill = this.findSkillForGroup(groupKey);
      if (existingSkill) {
        // Update existing skill with new data
        this.updateSkillFromTraces(existingSkill, successful);
        continue;
      }

      // Create new skill
      const skill = this.crystallizeSkill(successful, traces.length);
      if (skill) {
        newSkills.push(skill);
        this.skills.set(skill.id, skill);
      }
    }

    if (newSkills.length > 0) {
      await this.persist();
      console.log(`[AutoSkill] Created ${newSkills.length} new skills`);
    }

    return newSkills;
  }

  // ── Skill Matching ──────────────────────────────────────────────

  // Find skills that match a given task + site
  async findMatchingSkills(task: string, pageUrl: string): Promise<SkillMatch[]> {
    await this.init();

    const taskFp = executionMemory.fingerprint(task);
    const site = executionMemory.extractSitePattern(pageUrl);
    const taskWords = new Set(taskFp.split('_'));
    const matches: SkillMatch[] = [];

    for (const skill of this.skills.values()) {
      let confidence = 0;
      let matchReason = '';

      // Check task pattern match
      for (const pattern of skill.trigger.taskPatterns) {
        const patternWords = new Set(pattern.split('_'));
        const intersection = new Set([...taskWords].filter((w) => patternWords.has(w)));
        const overlap = intersection.size / Math.max(taskWords.size, patternWords.size);

        if (overlap > confidence) {
          confidence = overlap;
          matchReason = `Task matches "${pattern}" (${Math.round(overlap * 100)}% overlap)`;
        }
      }

      // Boost confidence if site matches
      const siteMatch = skill.trigger.sitePatterns.some((p) => site.includes(p) || p === '*');
      if (siteMatch) {
        confidence = Math.min(1, confidence + 0.2);
        matchReason += ` + site match (${site})`;
      }

      // Boost based on reliability
      if (skill.metadata.reliability === 'proven') {
        confidence = Math.min(1, confidence + 0.1);
      }

      // Must meet minimum confidence
      if (confidence >= skill.trigger.minConfidence) {
        matches.push({ skill, confidence, matchReason });
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  // ── Skill Execution ─────────────────────────────────────────────

  // Get the action sequence for a skill (to be executed by agentCore)
  getSkillActions(skillId: string): SkillStep[] | null {
    const skill = this.skills.get(skillId);
    if (!skill) return null;
    return [...skill.steps];
  }

  // Record execution result to improve the skill
  async recordExecution(result: SkillExecutionResult): Promise<void> {
    const skill = this.skills.get(result.skillId);
    if (!skill) return;

    skill.metadata.totalExecutions++;
    if (result.success) {
      skill.metadata.successfulExecutions++;
    }

    // Update success rate
    skill.metadata.successRate =
      skill.metadata.successfulExecutions / skill.metadata.totalExecutions;

    // Update avg duration
    skill.metadata.avgDuration =
      (skill.metadata.avgDuration * (skill.metadata.totalExecutions - 1) + result.duration) /
      skill.metadata.totalExecutions;

    skill.metadata.lastExecuted = Date.now();

    // Update reliability tier
    skill.metadata.reliability = this.computeReliability(skill.metadata);

    // If a step failed, reduce its success rate
    if (!result.success && result.failedAt !== undefined) {
      const failedStep = skill.steps[result.failedAt];
      if (failedStep) {
        const total = skill.metadata.totalExecutions;
        failedStep.successRate =
          (failedStep.successRate * (total - 1) + 0) / total;

        // If step consistently fails, mark as optional or add retry
        if (failedStep.successRate < 0.5 && total >= 5) {
          failedStep.isOptional = true;
          failedStep.retryStrategy = 'adaptive';
        }
      }
    }

    // Bump version
    skill.version++;
    skill.updatedAt = Date.now();

    await this.persist();
  }

  // ── Skill CRUD ──────────────────────────────────────────────────

  async getSkill(id: string): Promise<Skill | null> {
    await this.init();
    return this.skills.get(id) || null;
  }

  async getAllSkills(): Promise<Skill[]> {
    await this.init();
    return Array.from(this.skills.values()).sort(
      (a, b) => b.metadata.successRate - a.metadata.successRate
    );
  }

  async deleteSkill(id: string): Promise<boolean> {
    await this.init();
    if (this.skills.delete(id)) {
      await this.persist();
      return true;
    }
    return false;
  }

  // Manually create a skill from user-provided data
  async createManualSkill(
    name: string,
    description: string,
    task: string,
    actions: ActionSchema[],
    sitePattern?: string
  ): Promise<Skill> {
    await this.init();

    const skill: Skill = {
      id: this.generateId(),
      name,
      description,
      trigger: {
        taskPatterns: [executionMemory.fingerprint(task)],
        sitePatterns: sitePattern ? [sitePattern] : ['*'],
        minConfidence: 0.4,
      },
      steps: actions.map((action, i) => ({
        order: i,
        action,
        description: `${action.type}${action.target ? ` on "${action.target}"` : ''}`,
        waitAfter: 500,
        retryStrategy: 'once' as const,
        isOptional: false,
        successRate: 1.0,
      })),
      metadata: {
        sourceTraceIds: [],
        totalExecutions: 0,
        successfulExecutions: 0,
        successRate: 1.0,
        avgDuration: 0,
        reliability: 'experimental',
        userApproved: true,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
    };

    this.skills.set(skill.id, skill);
    await this.persist();
    return skill;
  }

  // ── Skill Building Internals ────────────────────────────────────

  private async groupSimilarTraces(): Promise<Map<string, ExecutionTrace[]>> {
    const groups = new Map<string, ExecutionTrace[]>();

    // Get all traces from execution memory
    const allTraces = await executionMemory.findRelevantTraces({ limit: 100 });

    for (const trace of allTraces) {
      const key = `${trace.taskFingerprint}::${trace.sitePattern}`;
      const existing = groups.get(key) || [];
      existing.push(trace);
      groups.set(key, existing);
    }

    return groups;
  }

  private findSkillForGroup(groupKey: string): Skill | null {
    const [taskFp, site] = groupKey.split('::');

    for (const skill of this.skills.values()) {
      const taskMatch = skill.trigger.taskPatterns.some((p) => p === taskFp);
      const siteMatch = skill.trigger.sitePatterns.some(
        (p) => p === site || p === '*'
      );
      if (taskMatch && siteMatch) return skill;
    }
    return null;
  }

  private crystallizeSkill(
    successfulTraces: ExecutionTrace[],
    totalTraceCount: number
  ): Skill | null {
    if (successfulTraces.length === 0) return null;

    // Find the most common action sequence across successful traces
    const consensusSteps = this.buildConsensusSequence(successfulTraces);
    if (consensusSteps.length === 0) return null;

    const representative = successfulTraces[0];
    const avgDuration =
      successfulTraces.reduce((s, t) => s + t.totalDuration, 0) / successfulTraces.length;

    const skill: Skill = {
      id: this.generateId(),
      name: this.generateSkillName(representative),
      description: `Auto-generated from ${successfulTraces.length} successful executions of "${representative.task}"`,
      trigger: {
        taskPatterns: [...new Set(successfulTraces.map((t) => t.taskFingerprint))],
        sitePatterns: [...new Set(successfulTraces.map((t) => t.sitePattern))],
        minConfidence: 0.5,
      },
      steps: consensusSteps,
      metadata: {
        sourceTraceIds: successfulTraces.map((t) => t.id),
        totalExecutions: totalTraceCount,
        successfulExecutions: successfulTraces.length,
        successRate: successfulTraces.length / totalTraceCount,
        avgDuration,
        reliability: this.computeReliability({
          totalExecutions: totalTraceCount,
          successRate: successfulTraces.length / totalTraceCount,
        }),
        userApproved: false,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
    };

    // Enforce limit
    if (this.skills.size >= MAX_SKILLS) {
      const worst = Array.from(this.skills.entries())
        .filter(([, s]) => !s.metadata.userApproved)
        .sort((a, b) => a[1].metadata.successRate - b[1].metadata.successRate)[0];
      if (worst) this.skills.delete(worst[0]);
    }

    return skill;
  }

  // Build a consensus action sequence from multiple traces
  private buildConsensusSequence(traces: ExecutionTrace[]): SkillStep[] {
    if (traces.length === 0) return [];

    // Use the shortest successful trace as the base
    const sorted = [...traces].sort((a, b) => a.actions.length - b.actions.length);
    const base = sorted[0];

    return base.actions
      .filter((a) => a.success)
      .map((tracedAction, i) => {
        // Calculate success rate for this step across all traces
        const stepSuccessCount = traces.filter((t) => {
          const correspondingAction = t.actions[i];
          return (
            correspondingAction &&
            correspondingAction.success &&
            correspondingAction.action.type === tracedAction.action.type
          );
        }).length;

        const stepSuccessRate = stepSuccessCount / traces.length;

        // Calculate optimal wait time from all traces
        const waits = traces
          .map((t) => t.actions[i]?.duration || 500)
          .filter((w) => w > 0);
        const avgWait = waits.reduce((s, w) => s + w, 0) / waits.length;

        return {
          order: i,
          action: tracedAction.action,
          description: `${tracedAction.action.type}${tracedAction.action.target ? ` on "${tracedAction.action.target}"` : ''}`,
          waitAfter: Math.round(Math.min(avgWait, 3000)),
          retryStrategy: stepSuccessRate < 0.9 ? ('adaptive' as const) : ('once' as const),
          isOptional: stepSuccessRate < 0.5,
          successRate: stepSuccessRate,
        };
      });
  }

  private updateSkillFromTraces(skill: Skill, newTraces: ExecutionTrace[]): void {
    // Update trigger patterns with any new ones
    for (const trace of newTraces) {
      if (!skill.trigger.taskPatterns.includes(trace.taskFingerprint)) {
        skill.trigger.taskPatterns.push(trace.taskFingerprint);
      }
      if (!skill.trigger.sitePatterns.includes(trace.sitePattern)) {
        skill.trigger.sitePatterns.push(trace.sitePattern);
      }
    }

    // Rebuild consensus steps with more data
    const allSourceTraces = newTraces.filter((t) => t.success);
    if (allSourceTraces.length > 0) {
      const updatedSteps = this.buildConsensusSequence(allSourceTraces);
      if (updatedSteps.length > 0) {
        skill.steps = updatedSteps;
      }
    }

    skill.version++;
    skill.updatedAt = Date.now();
    skill.metadata.reliability = this.computeReliability(skill.metadata);
  }

  private computeReliability(
    metadata: Pick<SkillMetadata, 'totalExecutions' | 'successRate'>
  ): SkillMetadata['reliability'] {
    if (metadata.totalExecutions >= 10 && metadata.successRate >= 0.9) return 'proven';
    if (metadata.totalExecutions >= 5 && metadata.successRate >= 0.7) return 'stable';
    return 'experimental';
  }

  private generateSkillName(trace: ExecutionTrace): string {
    // Extract meaningful name from task
    const words = trace.task
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 4);

    const site = trace.sitePattern.split('/')[0].replace('www.', '');
    return `${words.join(' ')} (${site})`;
  }

  async getStats(): Promise<{
    totalSkills: number;
    provenSkills: number;
    stableSkills: number;
    experimentalSkills: number;
    topSkills: Array<{ name: string; successRate: number; executions: number }>;
  }> {
    await this.init();
    const all = Array.from(this.skills.values());

    return {
      totalSkills: all.length,
      provenSkills: all.filter((s) => s.metadata.reliability === 'proven').length,
      stableSkills: all.filter((s) => s.metadata.reliability === 'stable').length,
      experimentalSkills: all.filter((s) => s.metadata.reliability === 'experimental').length,
      topSkills: all
        .sort((a, b) => b.metadata.successRate - a.metadata.successRate)
        .slice(0, 5)
        .map((s) => ({
          name: s.name,
          successRate: s.metadata.successRate,
          executions: s.metadata.totalExecutions,
        })),
    };
  }
}

// Singleton
export const autoSkill = new AutoSkillEngine();
