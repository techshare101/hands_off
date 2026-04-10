// 🤖 AGENT RUNTIME AGENT — Hashbrown-style State Machine
// Deterministic state transitions for trustworthy agent behavior

export type AgentState = 
  | 'idle'
  | 'initializing'
  | 'seeing'
  | 'thinking'
  | 'proposing'      // Action proposed, awaiting approval
  | 'executing'
  | 'verifying'
  | 'paused'
  | 'waiting_input'  // Needs human clarification
  | 'complete'
  | 'error';

export type AgentEvent =
  | { type: 'START'; task: string }
  | { type: 'SCREENSHOT_READY'; screenshot: string }
  | { type: 'ACTION_PROPOSED'; action: ProposedAction }
  | { type: 'ACTION_APPROVED' }
  | { type: 'ACTION_REJECTED'; reason?: string }
  | { type: 'ACTION_OVERRIDE'; newAction: ProposedAction }
  | { type: 'ACTION_EXECUTED' }
  | { type: 'VERIFICATION_SUCCESS' }
  | { type: 'VERIFICATION_FAILED'; reason: string }
  | { type: 'TASK_COMPLETE' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'ERROR'; message: string }
  | { type: 'NEED_INPUT'; question: string };

export interface ProposedAction {
  type: 'click' | 'type' | 'scroll' | 'drag' | 'wait' | 'press' | 'navigate';
  params: Record<string, unknown>;
  target?: string;
  confidence: number;
  reasoning: string;
  requiresApproval: boolean;
}

export interface AgentContext {
  task: string;
  currentAction: ProposedAction | null;
  actionHistory: ProposedAction[];
  screenshots: string[];
  iteration: number;
  maxIterations: number;
  error: string | null;
}

type StateTransition = {
  [K in AgentState]?: {
    [E in AgentEvent['type']]?: AgentState;
  };
};

const transitions: StateTransition = {
  idle: {
    START: 'initializing',
  },
  initializing: {
    SCREENSHOT_READY: 'seeing',
    ERROR: 'error',
    STOP: 'idle',
    PAUSE: 'paused',
  },
  seeing: {
    ACTION_PROPOSED: 'proposing',
    TASK_COMPLETE: 'complete',
    ERROR: 'error',
    PAUSE: 'paused',
    STOP: 'idle',
    NEED_INPUT: 'waiting_input',
  },
  thinking: {
    ACTION_PROPOSED: 'proposing',
    TASK_COMPLETE: 'complete',
    ERROR: 'error',
    PAUSE: 'paused',
    STOP: 'idle',
  },
  proposing: {
    ACTION_APPROVED: 'executing',
    ACTION_REJECTED: 'seeing',
    ACTION_OVERRIDE: 'executing',
    ERROR: 'error',
    PAUSE: 'paused',
    STOP: 'idle',
  },
  executing: {
    ACTION_EXECUTED: 'verifying',
    ERROR: 'error',
    PAUSE: 'paused',
    STOP: 'idle',
  },
  verifying: {
    VERIFICATION_SUCCESS: 'seeing',
    VERIFICATION_FAILED: 'seeing',
    TASK_COMPLETE: 'complete',
    ERROR: 'error',
    PAUSE: 'paused',
  },
  paused: {
    RESUME: 'seeing',
    STOP: 'idle',
  },
  waiting_input: {
    ACTION_APPROVED: 'seeing',
    STOP: 'idle',
    PAUSE: 'paused',
    ERROR: 'error',
  },
  complete: {
    START: 'initializing',
  },
  error: {
    START: 'initializing',
    STOP: 'idle',
  },
};

export class AgentStateMachine {
  private state: AgentState = 'idle';
  private context: AgentContext;
  private listeners: ((state: AgentState, context: AgentContext) => void)[] = [];

  constructor() {
    this.context = this.createInitialContext();
  }

  private createInitialContext(): AgentContext {
    return {
      task: '',
      currentAction: null,
      actionHistory: [],
      screenshots: [],
      iteration: 0,
      maxIterations: 50,
      error: null,
    };
  }

  getState(): AgentState {
    return this.state;
  }

  getContext(): AgentContext {
    return { ...this.context };
  }

  canTransition(event: AgentEvent): boolean {
    const stateTransitions = transitions[this.state];
    return stateTransitions?.[event.type] !== undefined;
  }

  send(event: AgentEvent): AgentState {
    const stateTransitions = transitions[this.state];
    const nextState = stateTransitions?.[event.type];

    if (!nextState) {
      console.warn(`[StateMachine] Invalid transition: ${this.state} + ${event.type}`);
      return this.state;
    }

    // Update context based on event
    this.updateContext(event);

    // Transition state
    const prevState = this.state;
    this.state = nextState;

    console.log(`[StateMachine] ${prevState} → ${nextState} (${event.type})`);

    // Notify listeners
    this.listeners.forEach((listener) => listener(this.state, this.context));

    return this.state;
  }

  private updateContext(event: AgentEvent): void {
    switch (event.type) {
      case 'START':
        this.context = this.createInitialContext();
        this.context.task = event.task;
        break;
      case 'SCREENSHOT_READY':
        this.context.screenshots.push(event.screenshot);
        if (this.context.screenshots.length > 10) {
          this.context.screenshots.shift(); // Keep last 10
        }
        break;
      case 'ACTION_PROPOSED':
        this.context.currentAction = event.action;
        break;
      case 'ACTION_OVERRIDE':
        this.context.currentAction = event.newAction;
        break;
      case 'ACTION_EXECUTED':
        if (this.context.currentAction) {
          this.context.actionHistory.push(this.context.currentAction);
        }
        this.context.iteration++;
        break;
      case 'ERROR':
        this.context.error = event.message;
        break;
      case 'STOP':
        this.context = this.createInitialContext();
        break;
    }
  }

  subscribe(listener: (state: AgentState, context: AgentContext) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  reset(): void {
    this.state = 'idle';
    this.context = this.createInitialContext();
  }
}
