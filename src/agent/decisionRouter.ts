// ═══════════════════════════════════════════════════════════════════════════
// Decision Router — The brain that decides HOW to fulfill each agent step
// Routes between: Browser Action | A2UI Widget | MCP Tool | A2A Delegation
// ═══════════════════════════════════════════════════════════════════════════

import { a2ui, A2UI_TEMPLATES } from './a2ui';
import type { A2UIWidgetPayload } from './a2ui';
import { mcpClient } from './mcpClient';
import type { MCPTool } from './mcpClient';
import { a2aProtocol } from './a2aProtocol';
import type { ActionSchema, GeminiResponse } from './prompts';

// ── Route Types ───────────────────────────────────────────────────────────

export type RouteDecision =
  | { route: 'browser_action'; action: ActionSchema; reasoning: string }
  | { route: 'a2ui_widget'; widget: A2UIWidgetPayload; reasoning: string }
  | { route: 'mcp_tool'; serverId: string; toolName: string; args: Record<string, unknown>; reasoning: string }
  | { route: 'a2a_delegate'; agentId: string; intent: string; description: string; input: Record<string, unknown>; reasoning: string }
  | { route: 'wait_for_user'; question: string; reasoning: string };

// ── Intent Signals (detected from LLM response + task context) ────────────

interface RoutingContext {
  task: string;
  pageUrl: string;
  pageTitle: string;
  llmResponse: GeminiResponse;
  iteration: number;
  actionHistory: ActionSchema[];
  mcpToolsAvailable: MCPTool[];
  hasActiveWidgets: boolean;
}

// ── Pattern Matchers ──────────────────────────────────────────────────────
// These detect when the LLM's reasoning or task implies a non-browser route

const WIDGET_INTENT_PATTERNS: { pattern: RegExp; template?: keyof typeof A2UI_TEMPLATES; intent: string }[] = [
  { pattern: /book(?:ing)?\s+(?:a\s+)?(?:table|reservation|restaurant)/i, template: 'restaurantBooking', intent: 'book_restaurant' },
  { pattern: /(?:confirm|are you sure|proceed|approve)/i, template: 'confirmation', intent: 'confirm_action' },
  { pattern: /(?:filter|search|find|narrow\s+down)/i, template: 'searchFilter', intent: 'filter_results' },
  { pattern: /(?:select|choose|pick)\s+(?:from|one|an?\s+)/i, template: 'selectionPicker', intent: 'select_item' },
  { pattern: /(?:show|display|present)\s+(?:results|data|table|list)/i, template: 'dataResults', intent: 'show_results' },
  { pattern: /(?:step|wizard|guide|walkthrough|multi-step)/i, template: 'stepWizard', intent: 'multi_step' },
  { pattern: /(?:need|require|ask|collect)\s+(?:user\s+)?(?:input|information|details|data|preference)/i, intent: 'collect_input' },
  { pattern: /(?:date|time|schedule|calendar|appointment|when)/i, intent: 'collect_datetime' },
  { pattern: /(?:how many|quantity|number of|guests|people|seats)/i, intent: 'collect_number' },
];

const MCP_INTENT_PATTERNS: { pattern: RegExp; toolHint: string }[] = [
  { pattern: /(?:stripe|payment|charge|invoice)/i, toolHint: 'stripe' },
  { pattern: /(?:slack|message|channel|notify)/i, toolHint: 'slack' },
  { pattern: /(?:github|repo|pull\s+request|commit)/i, toolHint: 'github' },
  { pattern: /(?:database|query|sql|record)/i, toolHint: 'database' },
  { pattern: /(?:email|send\s+mail|inbox)/i, toolHint: 'email' },
  { pattern: /(?:calendar|event|meeting)/i, toolHint: 'calendar' },
  { pattern: /(?:salesforce|crm|lead|contact)/i, toolHint: 'salesforce' },
  { pattern: /(?:api|endpoint|webhook|rest)/i, toolHint: 'api' },
];

const A2A_INTENT_PATTERNS: { pattern: RegExp; capabilityHint: string }[] = [
  { pattern: /(?:flight|airline|fly|airport)/i, capabilityHint: 'flight_booking' },
  { pattern: /(?:hotel|accommodation|stay|room)/i, capabilityHint: 'hotel_booking' },
  { pattern: /(?:translate|language|localize)/i, capabilityHint: 'translation' },
  { pattern: /(?:analyze\s+(?:data|spreadsheet|csv))/i, capabilityHint: 'data_analysis' },
  { pattern: /(?:code|program|develop|debug)/i, capabilityHint: 'code_generation' },
];

// ── Decision Router Engine ────────────────────────────────────────────────

class DecisionRouterEngine {
  private routeHistory: { route: string; intent: string; timestamp: number; success?: boolean }[] = [];

  // ── Main Routing Decision ──────────────────────────────────────────

  async decideRoute(ctx: RoutingContext): Promise<RouteDecision> {
    const combinedText = `${ctx.task} ${ctx.llmResponse.reasoning} ${ctx.llmResponse.observation}`;

    // Priority 1: Does the LLM explicitly say it needs user input?
    if (this.needsUserInput(ctx)) {
      const widgetRoute = await this.tryWidgetRoute(combinedText, ctx);
      if (widgetRoute) {
        this.recordRoute('a2ui_widget', 'user_input');
        return widgetRoute;
      }
    }

    // Priority 2: Can an MCP tool handle this more efficiently than browser?
    if (ctx.mcpToolsAvailable.length > 0) {
      const mcpRoute = this.tryMCPRoute(combinedText, ctx);
      if (mcpRoute) {
        this.recordRoute('mcp_tool', mcpRoute.route === 'mcp_tool' ? mcpRoute.toolName : 'unknown');
        return mcpRoute;
      }
    }

    // Priority 3: Is this outside HandOff's browser capability? Delegate via A2A
    const a2aRoute = await this.tryA2ARoute(combinedText, ctx);
    if (a2aRoute) {
      this.recordRoute('a2a_delegate', a2aRoute.route === 'a2a_delegate' ? a2aRoute.intent : 'unknown');
      return a2aRoute;
    }

    // Priority 4: Default — execute as browser action
    if (ctx.llmResponse.action) {
      this.recordRoute('browser_action', ctx.llmResponse.action.type);
      return {
        route: 'browser_action',
        action: ctx.llmResponse.action,
        reasoning: ctx.llmResponse.reasoning,
      };
    }

    // Fallback: wait for more info
    return {
      route: 'wait_for_user',
      question: ctx.llmResponse.reasoning || 'How should I proceed?',
      reasoning: 'No clear action determined',
    };
  }

  // ── User Input Detection ───────────────────────────────────────────

  private needsUserInput(ctx: RoutingContext): boolean {
    const r = ctx.llmResponse;

    // LLM says it's not complete, confidence is low, and no action
    if (!r.action && !r.isComplete && r.confidence < 0.6) return true;

    // LLM explicitly asks a question
    if (r.reasoning.includes('?') && !r.action) return true;

    // Task requires structured input (dates, selections, etc.)
    const taskLower = ctx.task.toLowerCase();
    if (/(?:book|reserve|schedule|order|configure|customize)/.test(taskLower) && ctx.iteration === 0) return true;

    return false;
  }

  // ── A2UI Widget Routing ────────────────────────────────────────────

  private async tryWidgetRoute(text: string, ctx: RoutingContext): Promise<RouteDecision | null> {
    // Don't render new widgets if one is already active
    if (ctx.hasActiveWidgets) return null;

    for (const pattern of WIDGET_INTENT_PATTERNS) {
      if (pattern.pattern.test(text)) {
        let widget: A2UIWidgetPayload;

        if (pattern.template && A2UI_TEMPLATES[pattern.template]) {
          // Use a pre-built template
          widget = this.buildTemplateWidget(pattern.template, text, ctx);
        } else {
          // Build a dynamic widget based on detected intent
          widget = this.buildDynamicWidget(pattern.intent, text, ctx);
        }

        return {
          route: 'a2ui_widget',
          widget,
          reasoning: `Task requires structured user input (${pattern.intent}). Rendering interactive widget instead of text chat.`,
        };
      }
    }

    return null;
  }

  private buildTemplateWidget(templateName: keyof typeof A2UI_TEMPLATES, text: string, ctx: RoutingContext): A2UIWidgetPayload {
    switch (templateName) {
      case 'restaurantBooking': {
        const nameMatch = text.match(/(?:at|for|to)\s+([A-Z][a-zA-Z'\s]+)/);
        const name = nameMatch?.[1]?.trim() || ctx.pageTitle || 'Restaurant';
        return A2UI_TEMPLATES.restaurantBooking(name);
      }
      case 'confirmation':
        return A2UI_TEMPLATES.confirmation('Confirm Action', ctx.llmResponse.reasoning, 'confirm');
      case 'searchFilter':
        return A2UI_TEMPLATES.searchFilter('Filter Results', [
          { value: 'all', label: 'All' },
          { value: 'recent', label: 'Recent' },
          { value: 'popular', label: 'Popular' },
        ]);
      case 'selectionPicker':
        return A2UI_TEMPLATES.selectionPicker('Select an Option', [
          { id: 'option_1', primary: 'Option 1' },
          { id: 'option_2', primary: 'Option 2' },
        ]);
      case 'dataResults':
        return A2UI_TEMPLATES.dataResults('Results', ['Item', 'Details'], []);
      case 'stepWizard':
        return A2UI_TEMPLATES.stepWizard('Setup', [
          { id: 'step1', label: 'Details' },
          { id: 'step2', label: 'Review' },
          { id: 'step3', label: 'Confirm' },
        ]);
      default:
        return A2UI_TEMPLATES.confirmation('Action Required', ctx.llmResponse.reasoning, 'proceed');
    }
  }

  private buildDynamicWidget(intent: string, _text: string, ctx: RoutingContext): A2UIWidgetPayload {
    const widgetId = `dynamic_${Date.now()}`;

    switch (intent) {
      case 'collect_datetime':
        return {
          widgetId,
          title: 'Select Date & Time',
          intent,
          components: [
            { id: 'heading', type: 'heading', content: 'When would you like to schedule?', level: 3 },
            { id: 'date', type: 'date_picker', label: 'Date', required: true, min: new Date().toISOString().split('T')[0] },
            { id: 'time', type: 'time_picker', label: 'Time', required: true, step: 15 },
            { id: 'submit', type: 'button', text: 'Continue', action: 'submit_datetime', variant: 'primary' },
          ],
        };

      case 'collect_number':
        return {
          widgetId,
          title: 'Enter Details',
          intent,
          components: [
            { id: 'heading', type: 'heading', content: ctx.llmResponse.reasoning || 'How many?', level: 3 },
            { id: 'count', type: 'number_input', label: 'Count', value: 2, min: 1, max: 100, required: true },
            { id: 'submit', type: 'button', text: 'Continue', action: 'submit_number', variant: 'primary' },
          ],
        };

      case 'collect_input':
      default:
        return {
          widgetId,
          title: 'Input Required',
          intent,
          components: [
            { id: 'heading', type: 'heading', content: ctx.llmResponse.reasoning || 'Please provide the following:', level: 3 },
            { id: 'input', type: 'text_input', label: 'Your response', placeholder: 'Type here...', required: true },
            { id: 'submit', type: 'button', text: 'Submit', action: 'submit_input', variant: 'primary' },
          ],
        };
    }
  }

  // ── MCP Tool Routing ───────────────────────────────────────────────

  private tryMCPRoute(text: string, ctx: RoutingContext): RouteDecision | null {
    for (const pattern of MCP_INTENT_PATTERNS) {
      if (pattern.pattern.test(text)) {
        // Find a matching MCP tool
        const matchingTool = ctx.mcpToolsAvailable.find(t =>
          t.name.toLowerCase().includes(pattern.toolHint) ||
          t.description.toLowerCase().includes(pattern.toolHint)
        );

        if (matchingTool) {
          return {
            route: 'mcp_tool',
            serverId: matchingTool.serverId,
            toolName: matchingTool.name,
            args: this.extractToolArgs(text, matchingTool),
            reasoning: `MCP tool "${matchingTool.name}" from ${matchingTool.serverName} can handle this more efficiently than browser navigation.`,
          };
        }
      }
    }

    return null;
  }

  private extractToolArgs(text: string, tool: MCPTool): Record<string, unknown> {
    // Basic arg extraction from natural language — the LLM will refine this
    const args: Record<string, unknown> = {};
    const schema = tool.inputSchema as { properties?: Record<string, { type: string }> };

    if (schema?.properties) {
      for (const [key, _prop] of Object.entries(schema.properties)) {
        // Try to find values in the text for common param names
        if (key === 'query' || key === 'search' || key === 'text') {
          const quotedMatch = text.match(/"([^"]+)"/);
          if (quotedMatch) args[key] = quotedMatch[1];
        }
        if (key === 'url') {
          const urlMatch = text.match(/https?:\/\/[^\s]+/);
          if (urlMatch) args[key] = urlMatch[0];
        }
        if (key === 'amount' || key === 'count' || key === 'limit') {
          const numMatch = text.match(/\b(\d+)\b/);
          if (numMatch) args[key] = parseInt(numMatch[1]);
        }
      }
    }

    return args;
  }

  // ── A2A Delegation Routing ─────────────────────────────────────────

  private async tryA2ARoute(text: string, ctx: RoutingContext): Promise<RouteDecision | null> {
    const agents = a2aProtocol.getTrustedAgents();
    if (agents.length === 0) return null;

    for (const pattern of A2A_INTENT_PATTERNS) {
      if (pattern.pattern.test(text)) {
        const matchingAgent = a2aProtocol.findAgentForIntent(pattern.capabilityHint);

        if (matchingAgent) {
          return {
            route: 'a2a_delegate',
            agentId: matchingAgent.id,
            intent: pattern.capabilityHint,
            description: ctx.task,
            input: {
              task: ctx.task,
              pageUrl: ctx.pageUrl,
              context: ctx.llmResponse.observation,
            },
            reasoning: `Delegating to specialized agent "${matchingAgent.card.name}" which has ${pattern.capabilityHint} capability.`,
          };
        }
      }
    }

    return null;
  }

  // ── Observability ──────────────────────────────────────────────────

  private recordRoute(route: string, intent: string): void {
    this.routeHistory.push({ route, intent, timestamp: Date.now() });
    if (this.routeHistory.length > 200) this.routeHistory = this.routeHistory.slice(-100);
    console.log(`[DecisionRouter] Route: ${route} | Intent: ${intent}`);
  }

  markRouteSuccess(success: boolean): void {
    const last = this.routeHistory[this.routeHistory.length - 1];
    if (last) last.success = success;
  }

  getRouteHistory(limit = 20): typeof this.routeHistory {
    return this.routeHistory.slice(-limit);
  }

  getStats(): { totalRoutes: number; byType: Record<string, number>; successRate: number } {
    const byType: Record<string, number> = {};
    let successes = 0;
    let rated = 0;

    for (const r of this.routeHistory) {
      byType[r.route] = (byType[r.route] || 0) + 1;
      if (r.success !== undefined) {
        rated++;
        if (r.success) successes++;
      }
    }

    return {
      totalRoutes: this.routeHistory.length,
      byType,
      successRate: rated > 0 ? successes / rated : 0,
    };
  }

  // ── Prompt Injection ───────────────────────────────────────────────
  // Add routing context to the LLM prompt so it can hint at the right route

  buildRoutingPromptAddition(): string {
    const mcpTools = mcpClient.getAllCachedTools();
    const agents = a2aProtocol.getRemoteAgents();
    const activeWidgets = a2ui.getActiveWidgets();

    let addition = '';

    if (mcpTools.length > 0) {
      addition += mcpClient.formatToolsForPrompt();
    }

    if (agents.length > 0) {
      addition += a2aProtocol.formatForPrompt();
    }

    if (activeWidgets.length > 0) {
      addition += a2ui.formatActiveWidgetsForPrompt();
    }

    if (addition) {
      addition = '\n\n[ROUTING CAPABILITIES]:\n' +
        'When your task involves structured user input, say "NEEDS_WIDGET" in your reasoning.\n' +
        'When an MCP tool can handle it, say "USE_MCP:<tool_name>" in your reasoning.\n' +
        'When delegation is needed, say "DELEGATE:<capability>" in your reasoning.\n' +
        addition;
    }

    return addition;
  }
}

// Singleton
export const decisionRouter = new DecisionRouterEngine();
