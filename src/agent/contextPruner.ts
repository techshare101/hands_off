// ═══════════════════════════════════════════════════════════════════════════
// Context Pruner — Compresses agent context to fit within LLM token limits
// Summarizes completed A2UI/MCP/A2A interactions, keeps recent state minimal.
// ═══════════════════════════════════════════════════════════════════════════

import type { A2UIWidgetPayload, A2UIUserAction } from './a2ui';
import type { A2ATask } from './a2aProtocol';

// ── Types ─────────────────────────────────────────────────────────────────

export interface PruningContext {
  task: string;
  actionHistory: string[];
  a2uiWidgets: A2UIWidgetPayload[];
  a2uiActions: A2UIUserAction[];
  mcpCalls: { toolName: string; status: 'pending' | 'success' | 'error'; summary?: string }[];
  a2aTasks: A2ATask[];
  correctionContext: string | null;
  pageUrl: string;
  pageTitle: string;
}

export interface PrunedContext {
  task: string;
  summary: string;           // 1-line summary of progress
  recentActions: string[];   // Last 3-5 significant actions
  activeState: {
    widgets: A2UIWidgetPayload[];
    pendingMCP: string[];
    pendingA2A: string[];
  };
  completedOutcomes: string[]; // Summarized 1-line outcomes
  correctionContext: string | null;
  contextBudget: { used: number; limit: number; percent: number };
}

// ── Pruning Engine ────────────────────────────────────────────────────────

class ContextPrunerEngine {
  private readonly TOKEN_LIMIT = 4000; // Conservative limit for Gemini Pro
  private readonly CHARS_PER_TOKEN = 4; // Rough estimate
  private readonly MAX_ACTION_HISTORY = 5;
  private readonly MAX_ACTIVE_WIDGETS = 3;
  private readonly MAX_PENDING_MCP = 3;
  private readonly MAX_PENDING_A2A = 2;

  // ── Main Pruning Method ──────────────────────────────────────────────

  prune(ctx: PruningContext): PrunedContext {
    const initialChars = this.estimateChars(ctx);
    const budget = {
      used: 0,
      limit: this.TOKEN_LIMIT * this.CHARS_PER_TOKEN,
      percent: 0,
    };

    // Step 1: Summarize completed interactions
    const completedOutcomes = this.summarizeCompletedInteractions(
      ctx.a2uiActions,
      ctx.mcpCalls,
      ctx.a2aTasks
    );

    // Step 2: Compress action history to significant moments
    const recentActions = this.compressActionHistory(ctx.actionHistory);

    // Step 3: Keep only active/important state
    const activeState = {
      widgets: ctx.a2uiWidgets.slice(-this.MAX_ACTIVE_WIDGETS),
      pendingMCP: ctx.mcpCalls
        .filter(c => c.status === 'pending')
        .map(c => c.toolName)
        .slice(-this.MAX_PENDING_MCP),
      pendingA2A: ctx.a2aTasks
        .filter(t => t.status === 'pending' || t.status === 'in_progress')
        .map(t => t.taskId)
        .slice(-this.MAX_PENDING_A2A),
    };

    // Step 4: Generate 1-line summary
    const summary = this.generateSummary(ctx, completedOutcomes, activeState);

    // Step 5: Calculate budget
    budget.used = this.estimatePrunedChars({
      task: ctx.task,
      summary,
      recentActions,
      activeState,
      completedOutcomes,
      correctionContext: ctx.correctionContext,
    });
    budget.percent = Math.round((budget.used / budget.limit) * 100);

    // Step 6: Emergency pruning if still over budget
    let finalCorrectionContext = ctx.correctionContext;
    if (budget.percent > 90) {
      console.warn('[ContextPruner] Budget exceeded, emergency pruning...');
      // Truncate completed outcomes
      while (completedOutcomes.length > 3) completedOutcomes.shift();
      // Drop old actions
      while (recentActions.length > 3) recentActions.shift();
      // Truncate correction context
      if (finalCorrectionContext && finalCorrectionContext.length > 200) {
        finalCorrectionContext = finalCorrectionContext.slice(-200) + '...[truncated]';
      }
      // Recalculate
      budget.used = this.estimatePrunedChars({
        task: ctx.task,
        summary,
        recentActions,
        activeState,
        completedOutcomes,
        correctionContext: finalCorrectionContext,
      });
      budget.percent = Math.round((budget.used / budget.limit) * 100);
    }

    console.log(`[ContextPruner] Initial: ~${initialChars} chars, Pruned: ~${budget.used} chars (${budget.percent}% budget)`);

    return {
      task: ctx.task,
      summary,
      recentActions,
      activeState,
      completedOutcomes,
      correctionContext: finalCorrectionContext,
      contextBudget: budget,
    };
  }

  // ── Summarization ────────────────────────────────────────────────────────

  private summarizeCompletedInteractions(
    a2uiActions: A2UIUserAction[],
    mcpCalls: { toolName: string; status: 'pending' | 'success' | 'error'; summary?: string }[],
    a2aTasks: A2ATask[]
  ): string[] {
    const outcomes: string[] = [];

    // Summarize A2UI interactions
    if (a2uiActions.length > 0) {
      const latestAction = a2uiActions[a2uiActions.length - 1];
      const widgetId = latestAction.widgetId;
      const actionDesc = `User submitted ${latestAction.actionId} in widget ${widgetId.slice(0, 8)}`;
      outcomes.push(actionDesc);
    }

    // Summarize completed MCP calls
    for (const call of mcpCalls.filter(c => c.status === 'success' || c.status === 'error')) {
      const status = call.status === 'success' ? 'succeeded' : 'failed';
      outcomes.push(`MCP tool "${call.toolName}" ${status}${call.summary ? `: ${call.summary}` : ''}`);
    }

    // Summarize completed A2A tasks
    for (const task of a2aTasks.filter(t => t.status === 'completed' || t.status === 'failed')) {
      const status = task.status === 'completed' ? 'completed' : 'failed';
      outcomes.push(`A2A task "${task.intent}" ${status}${task.result ? ' with result' : ''}`);
    }

    return outcomes;
  }

  // ── Action History Compression ─────────────────────────────────────────

  private compressActionHistory(actions: string[]): string[] {
    if (actions.length <= this.MAX_ACTION_HISTORY) return actions;

    // Always keep first (for context) and last 3 (recent progress)
    const compressed: string[] = [];

    // First action (establish context)
    compressed.push(actions[0]);

    // Last 3 actions (recent progress)
    const recent = actions.slice(-3);
    if (actions.length > 4) {
      compressed.push(`... (${actions.length - 4} actions omitted) ...`);
    }
    compressed.push(...recent);

    return compressed;
  }

  // ── Summary Generation ─────────────────────────────────────────────────

  private generateSummary(
    ctx: PruningContext,
    completedOutcomes: string[],
    activeState: { widgets: A2UIWidgetPayload[]; pendingMCP: string[]; pendingA2A: string[] }
  ): string {
    const parts: string[] = [];

    // Task progress
    parts.push(`Task: "${ctx.task.slice(0, 60)}${ctx.task.length > 60 ? '...' : ''}"`);

    // Location
    parts.push(`On: ${ctx.pageTitle || ctx.pageUrl.slice(0, 40)}`);

    // Completed work
    if (completedOutcomes.length > 0) {
      parts.push(`Completed: ${completedOutcomes.length} interactions`);
    }

    // Pending state
    const pending: string[] = [];
    if (activeState.widgets.length > 0) pending.push(`${activeState.widgets.length} widget(s) active`);
    if (activeState.pendingMCP.length > 0) pending.push(`${activeState.pendingMCP.length} MCP call(s) pending`);
    if (activeState.pendingA2A.length > 0) pending.push(`${activeState.pendingA2A.length} A2A task(s) pending`);

    if (pending.length > 0) {
      parts.push(`Waiting: ${pending.join(', ')}`);
    }

    return parts.join(' | ');
  }

  // ── Budget Estimation ──────────────────────────────────────────────────

  private estimateChars(ctx: PruningContext): number {
    let chars = ctx.task.length;
    chars += ctx.actionHistory.join('').length;
    chars += ctx.a2uiWidgets.length * 100; // Rough estimate per widget
    chars += ctx.mcpCalls.length * 50;
    chars += ctx.a2aTasks.length * 100;
    chars += ctx.correctionContext?.length || 0;
    return chars;
  }

  private estimatePrunedChars(ctx: Omit<PrunedContext, 'contextBudget'>): number {
    let chars = ctx.task.length;
    chars += ctx.summary.length;
    chars += ctx.recentActions.join('').length;
    chars += ctx.activeState.widgets.length * 100;
    chars += ctx.activeState.pendingMCP.join('').length;
    chars += ctx.activeState.pendingA2A.join('').length;
    chars += ctx.completedOutcomes.join('').length;
    chars += ctx.correctionContext?.length || 0;
    return chars;
  }

  // ── Prompt Builder ──────────────────────────────────────────────────────

  buildPrunedPrompt(pruned: PrunedContext): string {
    const lines: string[] = [];

    lines.push(`[CONTEXT SUMMARY]: ${pruned.summary}`);

    if (pruned.completedOutcomes.length > 0) {
      lines.push(`[COMPLETED]: ${pruned.completedOutcomes.join('; ')}`);
    }

    if (pruned.recentActions.length > 0) {
      lines.push(`[RECENT ACTIONS]: ${pruned.recentActions.join(' → ')}`);
    }

    if (pruned.activeState.widgets.length > 0) {
      lines.push(`[ACTIVE WIDGETS]: ${pruned.activeState.widgets.map(w => w.title || w.widgetId.slice(0, 8)).join(', ')}`);
    }

    if (pruned.activeState.pendingMCP.length > 0) {
      lines.push(`[PENDING MCP]: ${pruned.activeState.pendingMCP.join(', ')}`);
    }

    if (pruned.activeState.pendingA2A.length > 0) {
      lines.push(`[PENDING A2A]: ${pruned.activeState.pendingA2A.join(', ')}`);
    }

    if (pruned.correctionContext) {
      lines.push(`[CORRECTION]: ${pruned.correctionContext}`);
    }

    if (pruned.contextBudget.percent > 80) {
      lines.push(`[NOTE]: Context budget at ${pruned.contextBudget.percent}%. Prioritize efficiency.`);
    }

    return lines.join('\n');
  }

  // ── Stats ─────────────────────────────────────────────────────────────

  getStats(): { limit: number; charsPerToken: number; maxHistory: number } {
    return {
      limit: this.TOKEN_LIMIT,
      charsPerToken: this.CHARS_PER_TOKEN,
      maxHistory: this.MAX_ACTION_HISTORY,
    };
  }
}

// Singleton
export const contextPruner = new ContextPrunerEngine();
