import { create } from 'zustand';
import type { A2UIWidgetPayload, A2UIUserAction } from '../agent/a2ui';

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
  | 'learning'
  | 'widget';

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
  activeWidgets: A2UIWidgetPayload[];
  
  // Actions
  startTask: (task: string) => void;
  pauseTask: () => void;
  resumeTask: () => void;
  stopTask: () => void;
  retryTask: () => void;
  addStep: (step: Omit<AgentStep, 'id' | 'timestamp'>) => void;
  setStatus: (status: AgentStatus) => void;
  setError: (error: string | null) => void;
  addWidget: (payload: A2UIWidgetPayload) => void;
  dismissWidget: (widgetId: string) => void;
  updateWidget: (widgetId: string, updates: Partial<A2UIWidgetPayload>) => void;
  handleWidgetAction: (action: A2UIUserAction) => void;
  reset: () => void;
}

const generateId = () => Math.random().toString(36).substring(2, 9);

export const useAgentStore = create<AgentState>((set, get) => ({
  status: 'idle',
  currentTask: null,
  steps: [],
  tasksRemaining: 10,
  error: null,
  activeWidgets: [],

  startTask: (task: string) => {
    console.log('[AgentStore] startTask called:', task);
    set({
      status: 'seeing',
      currentTask: task,
      steps: [],
      error: null,
    });
    
    // Notify background worker to start the agent
    console.log('[AgentStore] Sending START_TASK message...');
    chrome.runtime.sendMessage({
      type: 'START_TASK',
      payload: { task },
    }).then((response) => {
      console.log('[AgentStore] START_TASK response:', response);
    }).catch((err) => {
      console.error('[AgentStore] START_TASK failed:', err);
      set({ status: 'error', error: 'Failed to start: ' + err.message });
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

  addWidget: (payload: A2UIWidgetPayload) => {
    set((state) => ({
      activeWidgets: [...state.activeWidgets.filter(w => w.widgetId !== payload.widgetId), payload],
    }));
    // Also add a step so the widget appears in the feed
    get().addStep({ type: 'widget', description: payload.title || 'Interactive widget', metadata: { widgetId: payload.widgetId } });
  },

  dismissWidget: (widgetId: string) => {
    set((state) => ({
      activeWidgets: state.activeWidgets.filter(w => w.widgetId !== widgetId),
    }));
  },

  updateWidget: (widgetId: string, updates: Partial<A2UIWidgetPayload>) => {
    set((state) => ({
      activeWidgets: state.activeWidgets.map(w =>
        w.widgetId === widgetId ? { ...w, ...updates, widgetId } : w
      ),
    }));
  },

  handleWidgetAction: (action: A2UIUserAction) => {
    // Send to background worker for the agent to process
    chrome.runtime.sendMessage({
      type: 'A2UI_USER_ACTION',
      payload: action,
    });
  },

  reset: () => set({
    status: 'idle',
    currentTask: null,
    steps: [],
    error: null,
    activeWidgets: [],
  }),
}));
