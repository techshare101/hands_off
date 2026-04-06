// 🔒 GUARDRAILS AGENT — Approval Gates & Safety Rules
// Determines which actions need human approval

import { ActionSchema } from './prompts';

export type ApprovalLevel = 'auto' | 'notify' | 'require';

export interface ApprovalRule {
  name: string;
  check: (action: ActionSchema, context: ApprovalContext) => ApprovalLevel;
  reason: string;
}

export interface ApprovalContext {
  pageUrl: string;
  pageTitle: string;
  iteration: number;
  previousActions: ActionSchema[];
}

// Patterns that require approval
const DANGEROUS_URL_PATTERNS = [
  /checkout/i,
  /payment/i,
  /billing/i,
  /subscribe/i,
  /delete/i,
  /remove/i,
  /cancel/i,
  /account.*settings/i,
  /password/i,
  /security/i,
];

const DANGEROUS_TARGET_PATTERNS = [
  /submit/i,
  /confirm/i,
  /delete/i,
  /remove/i,
  /cancel/i,
  /pay/i,
  /purchase/i,
  /buy/i,
  /checkout/i,
  /sign.*out/i,
  /log.*out/i,
  /unsubscribe/i,
];

const SAFE_ACTIONS = ['scroll', 'wait', 'click', 'type', 'press', 'navigate'];

export const approvalRules: ApprovalRule[] = [
  {
    name: 'low_confidence',
    reason: 'Action confidence is below threshold',
    check: (action) => {
      if (action.confidence < 0.5) return 'require';
      if (action.confidence < 0.7) return 'notify';
      return 'auto';
    },
  },
  {
    name: 'dangerous_url',
    reason: 'Page URL suggests sensitive operation',
    check: (_, context) => {
      if (DANGEROUS_URL_PATTERNS.some((p) => p.test(context.pageUrl))) {
        return 'require';
      }
      return 'auto';
    },
  },
  {
    name: 'dangerous_target',
    reason: 'Target element suggests destructive action',
    check: (action) => {
      if (!action.target) return 'auto';
      if (DANGEROUS_TARGET_PATTERNS.some((p) => p.test(action.target!))) {
        return 'require';
      }
      return 'auto';
    },
  },
  {
    name: 'form_submission',
    reason: 'Form submission detected',
    check: (action) => {
      if (action.type === 'click' && action.target) {
        if (/submit|send|confirm|save/i.test(action.target)) {
          return 'require';
        }
      }
      return 'auto';
    },
  },
  {
    name: 'safe_action',
    reason: 'Safe navigation action',
    check: (action) => {
      if (SAFE_ACTIONS.includes(action.type)) {
        return 'auto';
      }
      return 'notify';
    },
  },
  {
    name: 'iteration_limit',
    reason: 'Many iterations on same task',
    check: (_, context) => {
      if (context.iteration > 20) return 'require';
      if (context.iteration > 10) return 'notify';
      return 'auto';
    },
  },
  {
    name: 'repeated_action',
    reason: 'Same action attempted multiple times',
    check: (action, context) => {
      const recentActions = context.previousActions.slice(-3);
      const sameActionCount = recentActions.filter(
        (a) => a.type === action.type && a.x === action.x && a.y === action.y
      ).length;
      if (sameActionCount >= 2) return 'require';
      return 'auto';
    },
  },
];

export function evaluateApproval(
  action: ActionSchema,
  context: ApprovalContext
): { level: ApprovalLevel; reasons: string[] } {
  let highestLevel: ApprovalLevel = 'auto';
  const reasons: string[] = [];

  for (const rule of approvalRules) {
    const level = rule.check(action, context);
    
    if (level === 'require') {
      highestLevel = 'require';
      reasons.push(rule.reason);
    } else if (level === 'notify' && highestLevel !== 'require') {
      highestLevel = 'notify';
      reasons.push(rule.reason);
    }
  }

  return { level: highestLevel, reasons };
}

// Usage limits for free tier
export interface UsageLimits {
  tasksPerDay: number;
  actionsPerTask: number;
  screenshotsPerTask: number;
}

export const FREE_TIER_LIMITS: UsageLimits = {
  tasksPerDay: 10,
  actionsPerTask: 50,
  screenshotsPerTask: 100,
};

export const PRO_TIER_LIMITS: UsageLimits = {
  tasksPerDay: Infinity,
  actionsPerTask: 200,
  screenshotsPerTask: 500,
};

export interface UsageTracker {
  tasksToday: number;
  actionsThisTask: number;
  screenshotsThisTask: number;
  lastResetDate: string;
}

export function checkUsageLimits(
  tracker: UsageTracker,
  limits: UsageLimits
): { allowed: boolean; reason?: string } {
  const today = new Date().toISOString().split('T')[0];
  
  // Reset daily counter if new day
  if (tracker.lastResetDate !== today) {
    tracker.tasksToday = 0;
    tracker.lastResetDate = today;
  }

  if (tracker.tasksToday >= limits.tasksPerDay) {
    return { allowed: false, reason: `Daily task limit reached (${limits.tasksPerDay})` };
  }

  if (tracker.actionsThisTask >= limits.actionsPerTask) {
    return { allowed: false, reason: `Action limit per task reached (${limits.actionsPerTask})` };
  }

  if (tracker.screenshotsThisTask >= limits.screenshotsPerTask) {
    return { allowed: false, reason: `Screenshot limit per task reached (${limits.screenshotsPerTask})` };
  }

  return { allowed: true };
}
