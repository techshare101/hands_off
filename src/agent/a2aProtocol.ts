// ═══════════════════════════════════════════════════════════════════════════
// A2A Protocol — Agent-to-Agent Communication for HandOff
// Enables delegation of tasks to specialized remote agents and
// allows external agents to discover and use HandOff's capabilities.
// ═══════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'handoff_a2a_config';

// ── Agent Card (self-description) ─────────────────────────────────────────

export interface AgentCard {
  name: string;
  description: string;
  version: string;
  capabilities: AgentCapability[];
  protocols: string[];
  endpoint?: string;
  authentication?: { type: 'none' | 'api_key' | 'oauth'; required: boolean };
}

export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

// ── Task Lifecycle ────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'accepted' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface A2ATask {
  taskId: string;
  senderId: string;
  receiverId: string;
  intent: string;
  description: string;
  input: Record<string, unknown>;
  status: TaskStatus;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface A2AMessage {
  type: 'task_send' | 'task_accept' | 'task_update' | 'task_complete' | 'task_fail' | 'task_cancel' | 'discover' | 'agent_card';
  taskId?: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

// ── Remote Agent Registry ─────────────────────────────────────────────────

export interface RemoteAgent {
  id: string;
  card: AgentCard;
  endpoint: string;
  apiKey?: string;
  lastSeen: number;
  trusted: boolean;
}

// ── A2A Engine ────────────────────────────────────────────────────────────

class A2AProtocolEngine {
  private remoteAgents: Map<string, RemoteAgent> = new Map();
  private activeTasks: Map<string, A2ATask> = new Map();
  private taskHistory: A2ATask[] = [];
  private listeners: Set<(event: A2AEvent) => void> = new Set();
  private initialized = false;

  // HandOff's own agent card
  readonly agentCard: AgentCard = {
    name: 'HandOff',
    description: 'AI-powered browser automation agent. Can see, click, type, and verify actions on any web page.',
    version: '2.0.0',
    capabilities: [
      {
        id: 'browser_navigate',
        name: 'Navigate to URL',
        description: 'Navigate the browser to a specific URL',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      },
      {
        id: 'browser_click',
        name: 'Click Element',
        description: 'Click on a specific element on the current page',
        inputSchema: { type: 'object', properties: { selector: { type: 'string' }, description: { type: 'string' } } },
      },
      {
        id: 'browser_type',
        name: 'Type Text',
        description: 'Type text into a form field or input',
        inputSchema: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } }, required: ['text'] },
      },
      {
        id: 'browser_extract',
        name: 'Extract Data',
        description: 'Extract structured data from the current page',
        inputSchema: { type: 'object', properties: { description: { type: 'string' } }, required: ['description'] },
      },
      {
        id: 'browser_screenshot',
        name: 'Take Screenshot',
        description: 'Capture a screenshot of the current page',
      },
      {
        id: 'full_task',
        name: 'Execute Full Task',
        description: 'Execute a complete browser automation task described in natural language',
        inputSchema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
      },
      {
        id: 'render_widget',
        name: 'Render A2UI Widget',
        description: 'Render an interactive widget in the HandOff sidepanel',
        inputSchema: { type: 'object', properties: { widget: { type: 'object' } }, required: ['widget'] },
      },
    ],
    protocols: ['a2a/1.0', 'mcp/1.0'],
    authentication: { type: 'none', required: false },
  };

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const data = result[STORAGE_KEY] || {};
      if (data.remoteAgents) {
        (data.remoteAgents as RemoteAgent[]).forEach(a => this.remoteAgents.set(a.id, a));
      }
      if (data.taskHistory) {
        this.taskHistory = data.taskHistory;
      }
      this.initialized = true;
      console.log(`[A2A] Initialized: ${this.remoteAgents.size} known agents, ${this.taskHistory.length} historical tasks`);
    } catch {
      this.initialized = true;
    }
  }

  // ── Agent Discovery ────────────────────────────────────────────────

  async registerAgent(agent: Omit<RemoteAgent, 'id' | 'lastSeen'>): Promise<RemoteAgent> {
    await this.init();
    const registered: RemoteAgent = {
      ...agent,
      id: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      lastSeen: Date.now(),
    };
    this.remoteAgents.set(registered.id, registered);
    await this.saveConfig();
    this.emit({ type: 'agent_registered', agent: registered });
    console.log(`[A2A] Registered agent: ${registered.card.name}`);
    return registered;
  }

  async removeAgent(agentId: string): Promise<void> {
    this.remoteAgents.delete(agentId);
    await this.saveConfig();
  }

  getRemoteAgents(): RemoteAgent[] {
    return Array.from(this.remoteAgents.values());
  }

  getTrustedAgents(): RemoteAgent[] {
    return this.getRemoteAgents().filter(a => a.trusted);
  }

  // ── Discover agent capabilities via endpoint ───────────────────────

  async discoverAgent(endpoint: string, apiKey?: string): Promise<AgentCard | null> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'discover',
          payload: { requestCard: true },
          timestamp: Date.now(),
        }),
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data.card || data.agentCard || null;
    } catch (error) {
      console.error(`[A2A] Failed to discover agent at ${endpoint}:`, error);
      return null;
    }
  }

  // ── Task Delegation ────────────────────────────────────────────────

  async sendTask(agentId: string, intent: string, description: string, input: Record<string, unknown>): Promise<A2ATask> {
    await this.init();
    const agent = this.remoteAgents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    const task: A2ATask = {
      taskId: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      senderId: 'handoff',
      receiverId: agentId,
      intent,
      description,
      input,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.activeTasks.set(task.taskId, task);

    // Send to remote agent
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (agent.apiKey) headers['Authorization'] = `Bearer ${agent.apiKey}`;

      const res = await fetch(agent.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'task_send',
          taskId: task.taskId,
          payload: { intent, description, input, senderCard: this.agentCard },
          timestamp: Date.now(),
        } satisfies A2AMessage),
      });

      if (res.ok) {
        const result = await res.json();
        task.status = result.status || 'accepted';
        task.updatedAt = Date.now();
        if (result.result) task.result = result.result;
      } else {
        task.status = 'failed';
        task.error = `Agent returned ${res.status}`;
      }
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Network error';
    }

    this.activeTasks.set(task.taskId, task);
    this.emit({ type: 'task_updated', task });
    console.log(`[A2A] Task ${task.taskId} sent to ${agent.card.name}: ${task.status}`);
    return task;
  }

  // ── Handle incoming task (when HandOff is the receiver) ────────────

  async handleIncomingTask(message: A2AMessage, senderId?: string): Promise<Record<string, unknown>> {
    switch (message.type) {
      case 'discover':
        return { type: 'agent_card', card: this.agentCard };

      case 'task_send': {
        const payload = message.payload as { intent: string; description: string; input: Record<string, unknown> };
        const task: A2ATask = {
          taskId: message.taskId || `incoming_${Date.now()}`,
          senderId: senderId || 'unknown',
          receiverId: 'handoff',
          intent: payload.intent,
          description: payload.description,
          input: payload.input,
          status: 'accepted',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        this.activeTasks.set(task.taskId, task);
        this.emit({ type: 'task_received', task });

        return { status: 'accepted', taskId: task.taskId };
      }

      case 'task_cancel': {
        const taskId = message.taskId;
        if (taskId) {
          const task = this.activeTasks.get(taskId);
          if (task) {
            task.status = 'cancelled';
            task.updatedAt = Date.now();
            this.emit({ type: 'task_updated', task });
          }
        }
        return { status: 'cancelled' };
      }

      default:
        return { error: 'Unknown message type' };
    }
  }

  // ── Task Updates ───────────────────────────────────────────────────

  updateTaskStatus(taskId: string, status: TaskStatus, result?: Record<string, unknown>, error?: string): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    task.status = status;
    task.updatedAt = Date.now();
    if (result) task.result = result;
    if (error) task.error = error;

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      this.taskHistory.push(task);
      this.activeTasks.delete(taskId);
      this.saveConfig();
    }

    this.emit({ type: 'task_updated', task });
  }

  // ── Query ──────────────────────────────────────────────────────────

  getActiveTasks(): A2ATask[] {
    return Array.from(this.activeTasks.values());
  }

  getTaskHistory(limit = 20): A2ATask[] {
    return this.taskHistory.slice(-limit);
  }

  // ── Find the best agent for an intent ──────────────────────────────

  findAgentForIntent(intent: string): RemoteAgent | null {
    const agents = this.getTrustedAgents();
    for (const agent of agents) {
      const hasCapability = agent.card.capabilities.some(c =>
        c.id === intent || c.name.toLowerCase().includes(intent.toLowerCase()) ||
        c.description.toLowerCase().includes(intent.toLowerCase())
      );
      if (hasCapability) return agent;
    }
    return null;
  }

  // ── Agent Prompt Integration ───────────────────────────────────────

  formatForPrompt(): string {
    const agents = this.getRemoteAgents();
    if (agents.length === 0) return '';

    const active = this.getActiveTasks();
    let prompt = `\n[A2A AGENTS AVAILABLE]: ${agents.length} remote agent(s):\n`;
    prompt += agents.map(a =>
      `  - ${a.card.name}: ${a.card.description} (${a.card.capabilities.length} capabilities)${a.trusted ? ' [TRUSTED]' : ''}`
    ).join('\n');

    if (active.length > 0) {
      prompt += `\n[ACTIVE A2A TASKS]: ${active.length}\n`;
      prompt += active.map(t => `  - ${t.taskId}: ${t.description} [${t.status}]`).join('\n');
    }

    prompt += '\nYou can delegate tasks to these agents using A2A protocol.\n';
    return prompt;
  }

  // ── Event System ───────────────────────────────────────────────────

  on(listener: (event: A2AEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: A2AEvent): void {
    this.listeners.forEach(fn => fn(event));
  }

  // ── Persistence ────────────────────────────────────────────────────

  private async saveConfig(): Promise<void> {
    const data = {
      remoteAgents: Array.from(this.remoteAgents.values()),
      taskHistory: this.taskHistory.slice(-100),
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
  }

  getStats(): { remoteAgents: number; activeTasks: number; completedTasks: number } {
    return {
      remoteAgents: this.remoteAgents.size,
      activeTasks: this.activeTasks.size,
      completedTasks: this.taskHistory.length,
    };
  }
}

// ── Event Types ───────────────────────────────────────────────────────────

export type A2AEvent =
  | { type: 'agent_registered'; agent: RemoteAgent }
  | { type: 'task_received'; task: A2ATask }
  | { type: 'task_updated'; task: A2ATask };

// Singleton
export const a2aProtocol = new A2AProtocolEngine();
