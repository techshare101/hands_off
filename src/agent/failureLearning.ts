// 🔬 FAILURE LEARNING ENGINE — Analyzes failures, generates fixes, stores rules
// "Every failure makes the system better automatically"
// When something breaks: capture context → analyze why → generate fix → store rule → next run includes fix

import { ActionSchema } from './prompts';
import { FailureCategory, LearnedPattern } from './executionMemory';
import { executionMemory } from './executionMemory';

export interface FailureAnalysis {
  category: FailureCategory;
  rootCause: string;
  fixStrategy: FixStrategy;
  preventionRule?: LearnedPattern;
  confidence: number;
}

export interface FixStrategy {
  type: 'retry_modified' | 'alternative_action' | 'skip_and_continue' | 'wait_and_retry' | 'change_coordinates' | 'use_fallback' | 'escalate';
  description: string;
  modifiedAction?: Partial<ActionSchema>;
  waitMs?: number;
  fallbackActions?: ActionSchema[];
  maxRetries?: number;
}

export interface FailureContext {
  action: ActionSchema;
  error: string;
  pageUrl: string;
  pageTitle: string;
  iteration: number;
  previousActions: ActionSchema[];
  observation?: string; // LLM's last observation
  retryCount: number;
}

// Error signature for deduplication
interface ErrorSignature {
  actionType: string;
  target: string;
  site: string;
  errorPattern: string;
}

const ERROR_PATTERNS: Record<string, FailureCategory> = {
  'no element': 'element_not_found',
  'element not found': 'element_not_found',
  'not found at coordinates': 'wrong_coordinates',
  'no input element': 'element_not_found',
  'timeout': 'timeout',
  'content script timeout': 'timeout',
  'page may still be loading': 'page_not_loaded',
  'navigation failed': 'navigation_failed',
  'cannot click on browser page': 'navigation_failed',
  'captcha': 'captcha_blocked',
  'authentication': 'auth_required',
  'login': 'auth_required',
  'rate limit': 'rate_limited',
  'too many requests': 'rate_limited',
  'selector': 'selector_changed',
  'click failed': 'wrong_coordinates',
  'type failed': 'element_not_found',
};

class FailureLearningEngine {
  private failureLog: Map<string, FailureAnalysis[]> = new Map();

  // Analyze a failure and generate a fix strategy
  analyze(context: FailureContext): FailureAnalysis {
    const category = this.categorize(context.error);
    const rootCause = this.diagnoseRootCause(context, category);
    const fixStrategy = this.generateFix(context, category, rootCause);
    const confidence = this.estimateFixConfidence(context, category);

    const analysis: FailureAnalysis = {
      category,
      rootCause,
      fixStrategy,
      confidence,
    };

    // Store in memory for future reference
    const sig = this.errorSignature(context);
    const sigKey = JSON.stringify(sig);
    const existing = this.failureLog.get(sigKey) || [];
    existing.push(analysis);
    this.failureLog.set(sigKey, existing);

    // Record failure in execution memory
    executionMemory.recordFailure(
      context.action,
      context.error,
      context.pageUrl,
      category
    );

    console.log(`[FailureLearning] ${category}: ${rootCause} → ${fixStrategy.type}`);

    return analysis;
  }

  // Check if we've seen this exact failure before and have a known fix
  async findKnownFix(context: FailureContext): Promise<FixStrategy | null> {
    const site = executionMemory.extractSitePattern(context.pageUrl);
    const patterns = await executionMemory.getApplicablePatterns(context.action.target || '', site);

    // Look for correction patterns that match this failure
    for (const pattern of patterns) {
      if (pattern.type !== 'correction') continue;

      try {
        const rule = JSON.parse(pattern.rule);
        if (
          rule.avoid?.type === context.action.type &&
          rule.avoid?.target === context.action.target
        ) {
          console.log(`[FailureLearning] Found known fix from pattern ${pattern.id}`);

          // Generate a fix based on the known failure
          return {
            type: 'alternative_action',
            description: `Known issue: ${pattern.description}. Using alternative approach.`,
            maxRetries: 1,
          };
        }
      } catch {
        // Skip invalid pattern
      }
    }

    // Check failure log for repeated errors
    const sig = this.errorSignature(context);
    const sigKey = JSON.stringify(sig);
    const history = this.failureLog.get(sigKey);

    if (history && history.length >= 2) {
      // We've failed at this exact spot multiple times
      const lastFix = history[history.length - 1].fixStrategy;

      // Don't repeat the same fix — escalate
      if (lastFix.type !== 'escalate') {
        return {
          type: 'escalate',
          description: `Repeated failure at "${context.action.target}". Tried ${history.length} fixes. Needs human intervention or alternative approach.`,
        };
      }
    }

    return null;
  }

  // Apply a fix strategy to generate a modified action
  applyFix(
    originalAction: ActionSchema,
    fix: FixStrategy
  ): { action: ActionSchema; correctionContext: string } | null {
    switch (fix.type) {
      case 'retry_modified':
        return {
          action: { ...originalAction, ...fix.modifiedAction },
          correctionContext: fix.description,
        };

      case 'change_coordinates': {
        // Shift coordinates by a small amount to find the actual target
        const shiftX = (fix.modifiedAction?.x ?? 0) || (Math.random() > 0.5 ? 20 : -20);
        const shiftY = (fix.modifiedAction?.y ?? 0) || (Math.random() > 0.5 ? 15 : -15);
        return {
          action: {
            ...originalAction,
            x: (originalAction.x || 0) + shiftX,
            y: (originalAction.y || 0) + shiftY,
          },
          correctionContext: `Previous click missed the target. Trying adjusted coordinates. ${fix.description}`,
        };
      }

      case 'wait_and_retry':
        return {
          action: originalAction,
          correctionContext: `Page was still loading. Waited ${fix.waitMs || 2000}ms before retrying. ${fix.description}`,
        };

      case 'alternative_action':
        if (fix.fallbackActions && fix.fallbackActions.length > 0) {
          return {
            action: fix.fallbackActions[0],
            correctionContext: fix.description,
          };
        }
        return {
          action: originalAction,
          correctionContext: `Try a completely different approach. ${fix.description}`,
        };

      case 'skip_and_continue':
        return null; // Signal to skip this action

      case 'escalate':
        return null; // Signal to ask for human help

      default:
        return {
          action: originalAction,
          correctionContext: fix.description,
        };
    }
  }

  // ── Private Helpers ─────────────────────────────────────────────

  private categorize(error: string): FailureCategory {
    const lowerError = error.toLowerCase();
    for (const [pattern, category] of Object.entries(ERROR_PATTERNS)) {
      if (lowerError.includes(pattern)) return category;
    }
    return 'unknown';
  }

  private diagnoseRootCause(context: FailureContext, category: FailureCategory): string {
    switch (category) {
      case 'element_not_found':
        return `Target "${context.action.target}" not found on page. Element may have moved, not rendered yet, or requires scrolling.`;

      case 'wrong_coordinates':
        return `Click at (${context.action.x},${context.action.y}) missed the target "${context.action.target}". Coordinates may be offset or element has shifted.`;

      case 'page_not_loaded':
        return `Page at ${context.pageUrl} was still loading when action was attempted. Need longer wait.`;

      case 'timeout':
        return `Action timed out. Page or element response too slow. Possible network issue or heavy page.`;

      case 'navigation_failed':
        return `Navigation to target URL failed. URL may be invalid or page restricted.`;

      case 'selector_changed':
        return `DOM selector for "${context.action.target}" has changed. Site may have updated its layout.`;

      case 'captcha_blocked':
        return `CAPTCHA detected. Cannot proceed without human solving.`;

      case 'auth_required':
        return `Authentication required. User needs to log in first.`;

      case 'rate_limited':
        return `Rate limited by the website. Need to slow down requests.`;

      default:
        return `Unknown error: ${context.error}. Occurred during ${context.action.type} on "${context.action.target}".`;
    }
  }

  private generateFix(
    context: FailureContext,
    category: FailureCategory,
    _rootCause: string
  ): FixStrategy {
    switch (category) {
      case 'element_not_found':
        if (context.retryCount === 0) {
          return {
            type: 'wait_and_retry',
            description: 'Element may not be rendered yet. Waiting for page to settle.',
            waitMs: 2000,
            maxRetries: 2,
          };
        }
        return {
          type: 'alternative_action',
          description: `Element "${context.action.target}" not findable. Try scrolling to find it or use a different interaction method.`,
          fallbackActions: [
            { type: 'scroll', direction: 'down', target: 'Find element', confidence: 0.6 },
          ],
        };

      case 'wrong_coordinates':
        return {
          type: 'change_coordinates',
          description: `Coordinates (${context.action.x},${context.action.y}) missed. Adjusting.`,
          modifiedAction: {
            x: 0, // Will be computed in applyFix
            y: 0,
          },
          maxRetries: 2,
        };

      case 'page_not_loaded':
        return {
          type: 'wait_and_retry',
          description: 'Page still loading. Increasing wait time.',
          waitMs: 3000,
          maxRetries: 3,
        };

      case 'timeout':
        return {
          type: 'wait_and_retry',
          description: 'Timeout — retrying with longer wait.',
          waitMs: 5000,
          maxRetries: 2,
        };

      case 'navigation_failed':
        return {
          type: 'alternative_action',
          description: 'Navigation failed. Trying direct URL or alternative path.',
        };

      case 'captcha_blocked':
        return {
          type: 'escalate',
          description: 'CAPTCHA detected. Requires human intervention.',
        };

      case 'auth_required':
        return {
          type: 'escalate',
          description: 'Login required. Please authenticate first.',
        };

      case 'rate_limited':
        return {
          type: 'wait_and_retry',
          description: 'Rate limited. Backing off before retry.',
          waitMs: 10000,
          maxRetries: 1,
        };

      case 'selector_changed':
        return {
          type: 'alternative_action',
          description: 'Selector changed. Relying on visual identification instead.',
        };

      default:
        if (context.retryCount < 2) {
          return {
            type: 'retry_modified',
            description: 'Unknown error. Retrying with fresh screenshot analysis.',
            maxRetries: 2,
          };
        }
        return {
          type: 'escalate',
          description: `Failed ${context.retryCount + 1} times. Needs human review.`,
        };
    }
  }

  private estimateFixConfidence(context: FailureContext, category: FailureCategory): number {
    // Higher retry count = lower confidence in our fix
    const retryPenalty = context.retryCount * 0.15;

    const baseCategoryConfidence: Record<FailureCategory, number> = {
      element_not_found: 0.6,
      wrong_coordinates: 0.7,
      page_not_loaded: 0.8,
      timeout: 0.7,
      navigation_failed: 0.5,
      selector_changed: 0.4,
      captcha_blocked: 0.1,
      auth_required: 0.1,
      rate_limited: 0.6,
      unknown: 0.3,
    };

    return Math.max(0.1, (baseCategoryConfidence[category] || 0.3) - retryPenalty);
  }

  private errorSignature(context: FailureContext): ErrorSignature {
    return {
      actionType: context.action.type,
      target: context.action.target || '',
      site: executionMemory.extractSitePattern(context.pageUrl),
      errorPattern: this.categorize(context.error),
    };
  }

  // Get summary of all learned failures
  getFailureSummary(): { totalFailures: number; topCategories: Record<string, number> } {
    const categories: Record<string, number> = {};
    let total = 0;

    for (const analyses of this.failureLog.values()) {
      for (const analysis of analyses) {
        categories[analysis.category] = (categories[analysis.category] || 0) + 1;
        total++;
      }
    }

    return { totalFailures: total, topCategories: categories };
  }

  // Reset learning for a specific site
  clearSiteLearning(sitePattern: string): void {
    for (const [key] of this.failureLog.entries()) {
      const sig: ErrorSignature = JSON.parse(key);
      if (sig.site === sitePattern) {
        this.failureLog.delete(key);
      }
    }
  }
}

// Singleton
export const failureLearning = new FailureLearningEngine();
