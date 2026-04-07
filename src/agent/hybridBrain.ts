// 🧬 HYBRID BRAIN — Adaptive execution engine with mode selection
// Chooses between DOM mode, Vision mode, and Memory mode per action
// DOM mode = fast + reliable when selectors exist
// Vision mode = flexible for messy/dynamic UIs (Ark Vision)
// Memory mode = instant replay from learned patterns
// System picks automatically based on confidence + site history

import { ActionSchema } from './prompts';
import { executionMemory } from './executionMemory';
import { autoSkill, SkillStep } from './autoSkill';
import { failureLearning, FixStrategy } from './failureLearning';

export type ExecutionMode = 'dom' | 'vision' | 'memory' | 'skill';

export interface ModeDecision {
  mode: ExecutionMode;
  confidence: number;
  reason: string;
  skillId?: string; // if mode is 'skill'
  skillSteps?: SkillStep[]; // pre-computed steps for skill mode
  memoryHint?: string; // context from execution memory for vision mode
  fixStrategy?: FixStrategy; // if we have a known fix from failure learning
}

export interface ExecutionContext {
  task: string;
  pageUrl: string;
  pageTitle: string;
  iteration: number;
  previousActions: ActionSchema[];
  lastError?: string;
  retryCount: number;
  domAvailable: boolean; // can we access DOM selectors?
  hasScreenshot: boolean;
}

interface SiteProfile {
  site: string;
  domReliability: number; // 0-1 how reliable DOM selectors are on this site
  visionReliability: number; // 0-1 how reliable vision-based actions are
  avgActionDuration: number;
  totalActions: number;
  lastUpdated: number;
}

const SITE_PROFILES_KEY = 'handoff_site_profiles';

class HybridBrainEngine {
  private siteProfiles: Map<string, SiteProfile> = new Map();
  private initialized = false;
  private currentMode: ExecutionMode = 'vision'; // default

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const result = await chrome.storage.local.get(SITE_PROFILES_KEY);
      const saved: SiteProfile[] = result[SITE_PROFILES_KEY] || [];
      saved.forEach((p) => this.siteProfiles.set(p.site, p));
      this.initialized = true;
    } catch {
      this.initialized = true;
    }
  }

  private async persist(): Promise<void> {
    const profiles = Array.from(this.siteProfiles.values());
    await chrome.storage.local.set({ [SITE_PROFILES_KEY]: profiles });
  }

  // ── Mode Selection ──────────────────────────────────────────────

  async decideMode(context: ExecutionContext): Promise<ModeDecision> {
    await this.init();

    const site = executionMemory.extractSitePattern(context.pageUrl);
    const profile = this.siteProfiles.get(site);

    // Priority 1: Check if we have a known fix from failure learning
    if (context.lastError && context.retryCount > 0) {
      const knownFix = await failureLearning.findKnownFix({
        action: context.previousActions[context.previousActions.length - 1] || {
          type: 'click',
          confidence: 0,
        },
        error: context.lastError,
        pageUrl: context.pageUrl,
        pageTitle: context.pageTitle,
        iteration: context.iteration,
        previousActions: context.previousActions,
        retryCount: context.retryCount,
      });

      if (knownFix && knownFix.type !== 'escalate') {
        return {
          mode: 'vision', // use vision to re-analyze with fix context
          confidence: 0.7,
          reason: `Applying known fix: ${knownFix.description}`,
          fixStrategy: knownFix,
        };
      }
    }

    // Priority 2: Check if a proven skill matches this task
    const skillMatches = await autoSkill.findMatchingSkills(
      context.task,
      context.pageUrl
    );

    const provenSkill = skillMatches.find(
      (m) =>
        m.confidence >= 0.7 &&
        (m.skill.metadata.reliability === 'proven' ||
          m.skill.metadata.reliability === 'stable')
    );

    if (provenSkill && context.iteration === 0) {
      const steps = autoSkill.getSkillActions(provenSkill.skill.id);
      if (steps && steps.length > 0) {
        return {
          mode: 'skill',
          confidence: provenSkill.confidence,
          reason: `Using proven skill "${provenSkill.skill.name}" (${Math.round(provenSkill.skill.metadata.successRate * 100)}% success rate)`,
          skillId: provenSkill.skill.id,
          skillSteps: steps,
        };
      }
    }

    // Priority 3: Use execution memory context
    const memoryContext = await executionMemory.buildMemoryContext(
      context.task,
      context.pageUrl
    );

    // Priority 4: Choose between DOM and Vision based on site profile
    if (profile) {
      if (profile.domReliability > 0.8 && context.domAvailable) {
        return {
          mode: 'dom',
          confidence: profile.domReliability,
          reason: `DOM mode preferred for ${site} (${Math.round(profile.domReliability * 100)}% reliability)`,
          memoryHint: memoryContext || undefined,
        };
      }

      if (profile.visionReliability > profile.domReliability) {
        return {
          mode: 'vision',
          confidence: profile.visionReliability,
          reason: `Vision mode preferred for ${site} (DOM unreliable)`,
          memoryHint: memoryContext || undefined,
        };
      }
    }

    // Default: Vision mode with memory hints
    return {
      mode: 'vision',
      confidence: 0.6,
      reason: memoryContext
        ? 'Vision mode with execution memory hints'
        : 'Vision mode (default — no site profile yet)',
      memoryHint: memoryContext || undefined,
    };
  }

  getCurrentMode(): ExecutionMode {
    return this.currentMode;
  }

  setCurrentMode(mode: ExecutionMode): void {
    this.currentMode = mode;
  }

  // ── Outcome Tracking ────────────────────────────────────────────

  // Record whether the chosen mode succeeded for this action
  async recordModeOutcome(
    pageUrl: string,
    mode: ExecutionMode,
    success: boolean,
    actionDuration: number
  ): Promise<void> {
    await this.init();

    const site = executionMemory.extractSitePattern(pageUrl);
    let profile = this.siteProfiles.get(site);

    if (!profile) {
      profile = {
        site,
        domReliability: 0.5,
        visionReliability: 0.5,
        avgActionDuration: 1000,
        totalActions: 0,
        lastUpdated: Date.now(),
      };
    }

    profile.totalActions++;
    profile.lastUpdated = Date.now();

    // Exponential moving average for duration
    const alpha = 0.2;
    profile.avgActionDuration =
      alpha * actionDuration + (1 - alpha) * profile.avgActionDuration;

    // Update reliability for the mode used
    const reliabilityAlpha = 0.15;
    const outcomeValue = success ? 1 : 0;

    if (mode === 'dom') {
      profile.domReliability =
        reliabilityAlpha * outcomeValue + (1 - reliabilityAlpha) * profile.domReliability;
    } else if (mode === 'vision' || mode === 'skill') {
      profile.visionReliability =
        reliabilityAlpha * outcomeValue + (1 - reliabilityAlpha) * profile.visionReliability;
    }

    this.siteProfiles.set(site, profile);
    await this.persist();
  }

  // ── Context Enhancement ─────────────────────────────────────────

  // Build enhanced prompt context based on mode decision
  buildModeContext(decision: ModeDecision): string {
    let context = '';

    if (decision.memoryHint) {
      context += decision.memoryHint;
    }

    if (decision.fixStrategy) {
      context += `\n\n## RECOVERY MODE\n`;
      context += `Applying learned fix: ${decision.fixStrategy.description}\n`;
      if (decision.fixStrategy.type === 'change_coordinates') {
        context += 'Try clicking at DIFFERENT coordinates than before.\n';
      }
      if (decision.fixStrategy.type === 'wait_and_retry') {
        context += `Wait ${decision.fixStrategy.waitMs || 2000}ms before retrying.\n`;
      }
    }

    if (decision.mode === 'skill' && decision.skillSteps) {
      context += `\n\n## SKILL MODE\n`;
      context += `Following proven skill with ${decision.skillSteps.length} steps.\n`;
      context += 'Steps:\n';
      decision.skillSteps.forEach((step, i) => {
        context += `  ${i + 1}. ${step.description} (${Math.round(step.successRate * 100)}% success)\n`;
      });
    }

    return context;
  }

  // ── Stats ───────────────────────────────────────────────────────

  async getSiteProfile(pageUrl: string): Promise<SiteProfile | null> {
    await this.init();
    const site = executionMemory.extractSitePattern(pageUrl);
    return this.siteProfiles.get(site) || null;
  }

  async getAllProfiles(): Promise<SiteProfile[]> {
    await this.init();
    return Array.from(this.siteProfiles.values()).sort(
      (a, b) => b.totalActions - a.totalActions
    );
  }

  async getStats(): Promise<{
    totalSites: number;
    avgDomReliability: number;
    avgVisionReliability: number;
    topSites: Array<{ site: string; actions: number; domR: number; visionR: number }>;
  }> {
    await this.init();
    const profiles = Array.from(this.siteProfiles.values());

    if (profiles.length === 0) {
      return {
        totalSites: 0,
        avgDomReliability: 0,
        avgVisionReliability: 0,
        topSites: [],
      };
    }

    return {
      totalSites: profiles.length,
      avgDomReliability:
        profiles.reduce((s, p) => s + p.domReliability, 0) / profiles.length,
      avgVisionReliability:
        profiles.reduce((s, p) => s + p.visionReliability, 0) / profiles.length,
      topSites: profiles
        .sort((a, b) => b.totalActions - a.totalActions)
        .slice(0, 5)
        .map((p) => ({
          site: p.site,
          actions: p.totalActions,
          domR: Math.round(p.domReliability * 100),
          visionR: Math.round(p.visionReliability * 100),
        })),
    };
  }
}

// Singleton
export const hybridBrain = new HybridBrainEngine();
