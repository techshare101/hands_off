import { create } from 'zustand';

export type AgentStatus = 
  | 'idle' 
  | 'seeing' 
  | 'thinking' 
  | 'acting' 
  | 'verifying' 
  | 'paused' 
  | 'error' 
  | 'complete';

export type StepType = 
  | 'seeing' 
  | 'thinking' 
  | 'clicking' 
  | 'typing' 
  | 'verifying' 
  | 'error' 
  | 'paused'
  | 'learning';

export interface AgentStep {
  id: string;
  type: StepType;
  description: string;
  timestamp: number;
  screenshot?: string;
  reasoning?: string;
  confidence?: number;
  action?: {
    type: string;
    target?: string;
    x?: number;
    y?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface AgentAction {
  type: 'click' | 'type' | 'scroll' | 'drag' | 'wait' | 'verify' | 'press';
  target?: string;
  value?: string;
  coordinates?: { x: number; y: number };
}

interface AgentState {
  status: AgentStatus;
  currentTask: string | null;
  steps: AgentStep[];
  tasksRemaining: number;
  error: string | null;
  
  // Actions
  startTask: (task: string) => void;
  pauseTask: () => void;
  resumeTask: () => void;
  stopTask: () => void;
  retryTask: () => void;
  addStep: (step: Omit<AgentStep, 'id' | 'timestamp'>) => void;
  setStatus: (status: AgentStatus) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const generateId = () => Math.random().toString(36).substring(2, 9);

export const useAgentStore = create<AgentState>((set, get) => ({
  status: 'idle',
  currentTask: null,
  steps: [],
  tasksRemaining: 10,
  error: null,

  startTask: (task: string) => {
    set({
      status: 'seeing',
      currentTask: task,
      steps: [],
      error: null,
    });
    
    // Notify background worker to start the agent
    chrome.runtime.sendMessage({
      type: 'START_TASK',
      payload: { task },
    });
  },

  pauseTask: () => {
    set({ status: 'paused' });
    get().addStep({ type: 'paused', description: 'Task paused by user' });
    chrome.runtime.sendMessage({ type: 'PAUSE_TASK' });
  },

  resumeTask: () => {
    set({ status: 'seeing' });
    chrome.runtime.sendMessage({ type: 'RESUME_TASK' });
  },

  stopTask: () => {
    set({
      status: 'idle',
      currentTask: null,
      steps: [],
    });
    chrome.runtime.sendMessage({ type: 'STOP_TASK' });
  },

  retryTask: () => {
    const { currentTask } = get();
    if (currentTask) {
      set({ status: 'seeing', steps: [], error: null });
      chrome.runtime.sendMessage({
        type: 'START_TASK',
        payload: { task: currentTask },
      });
    }
  },

  addStep: (step) => {
    const newStep: AgentStep = {
      ...step,
      id: generateId(),
      timestamp: Date.now(),
    };
    set((state) => ({
      steps: [...state.steps, newStep],
    }));
  },

  setStatus: (status: AgentStatus) => set({ status }),

  setError: (error: string | null) => set({ error, status: error ? 'error' : 'idle' }),

  reset: () => set({
    status: 'idle',
    currentTask: null,
    steps: [],
    error: null,
  }),
}));
