// 🔧 EXTENSION ENGINEER AGENT — Background Service Worker
// Orchestrates agent lifecycle and message passing

import { AgentCore, AgentConfig, AgentStepEvent } from '../agent/agentCore';
import { GeminiClient } from '../agent/geminiClient';
import { OpenRouterClient } from '../agent/openRouterClient';
import { RouteLLMClient } from '../agent/routeLLMClient';
import { ProposedAction } from '../agent/stateMachine';
import { usageTracker } from '../agent/usageTracker';
import { executionMemory } from '../agent/executionMemory';
import { autoSkill } from '../agent/autoSkill';
import { hybridBrain } from '../agent/hybridBrain';
import { failureLearning } from '../agent/failureLearning';
import { getMolmoClient } from '../agent/molmoClient';

// LLM Client interface (all clients implement this)
interface LLMClient {
  hasApiKey(): Promise<boolean>;
  analyze(request: unknown): Promise<unknown>;
}

// State
let currentAgent: AgentCore | null = null;
let currentTabId: number | null = null;
let pendingApproval: {
  resolve: (decision: 'approve' | 'reject' | 'override') => void;
  action: ProposedAction;
} | null = null;

// Initialize LLM clients
const geminiClient = new GeminiClient();
const openRouterClient = new OpenRouterClient();
const routeLLMClient = new RouteLLMClient();

// Get the active LLM client based on settings
async function getActiveLLMClient(): Promise<LLMClient> {
  const result = await chrome.storage.local.get('llmProvider');
  const provider = result.llmProvider || 'gemini';
  if (provider === 'openrouter') return openRouterClient;
  if (provider === 'routellm') return routeLLMClient;
  return geminiClient;
}

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    currentTabId = tab.id;
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// Handle messages from side panel and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ success: false, error: error.message }));
  return true; // Keep channel open for async response
});

async function handleMessage(
  message: { type: string; payload?: unknown },
  _sender: chrome.runtime.MessageSender
): Promise<unknown> {
  console.log('[Worker] Received:', message.type);

  switch (message.type) {
    case 'START_TASK':
      return startTask(message.payload as { task: string; taskType?: string });

    case 'PAUSE_TASK':
      if (currentAgent) {
        currentAgent.pause();
      }
      return { success: true };

    case 'RESUME_TASK':
      if (currentAgent) {
        currentAgent.resume();
      }
      return { success: true };

    case 'STOP_TASK':
      if (currentAgent) {
        currentAgent.stop();
        currentAgent = null;
      }
      return { success: true };

    case 'APPROVAL_RESPONSE':
      if (pendingApproval) {
        const decision = (message.payload as { decision: 'approve' | 'reject' | 'override' }).decision;
        pendingApproval.resolve(decision);
        pendingApproval = null;
      }
      return { success: true };

    case 'CHECK_API_KEY':
      const activeLLM = await getActiveLLMClient();
      const hasApiKey = await activeLLM.hasApiKey();
      return { success: true, hasApiKey };

    case 'SET_API_KEY':
      // This is now handled by the Settings component directly via chrome.storage
      return { success: true };

    case 'GET_AGENT_STATE':
      return {
        success: true,
        state: currentAgent?.getState() || 'idle',
        isRunning: currentAgent !== null,
      };

    case 'GET_USAGE':
      const usage = await usageTracker.getUsageSummary();
      return { success: true, usage };

    case 'SEND_CORRECTION':
      if (currentAgent) {
        currentAgent.applyCorrection((message.payload as { correction: string }).correction);
      }
      return { success: true };

    // ── Self-Learning Engine Messages ──────────────────────────────

    case 'GET_LEARNING_STATS': {
      const memStats = await executionMemory.getStats();
      const skillStats = await autoSkill.getStats();
      const brainStats = await hybridBrain.getStats();
      const failureStats = failureLearning.getFailureSummary();
      return {
        success: true,
        stats: { memory: memStats, skills: skillStats, brain: brainStats, failures: failureStats },
      };
    }

    case 'GET_SKILLS': {
      const skills = await autoSkill.getAllSkills();
      return { success: true, skills };
    }

    case 'DELETE_SKILL': {
      const deleted = await autoSkill.deleteSkill((message.payload as { skillId: string }).skillId);
      return { success: true, deleted };
    }

    case 'CREATE_SKILL': {
      const p = message.payload as { name: string; description: string; task: string; actions: unknown[]; sitePattern?: string };
      const skill = await autoSkill.createManualSkill(
        p.name, p.description, p.task, p.actions as any[], p.sitePattern
      );
      return { success: true, skill };
    }

    case 'GET_EXECUTION_MEMORY': {
      const q = message.payload as { task?: string; sitePattern?: string; limit?: number } | undefined;
      const traces = await executionMemory.findRelevantTraces({
        task: q?.task,
        sitePattern: q?.sitePattern,
        limit: q?.limit || 10,
      });
      return { success: true, traces };
    }

    case 'CLEAR_LEARNING_DATA': {
      await executionMemory.clearAll();
      return { success: true };
    }

    case 'MOLMO_HEALTH_CHECK': {
      const molmo = getMolmoClient();
      const ep = (message.payload as { endpoint?: string })?.endpoint;
      if (ep) await molmo.setEndpoint(ep);
      const available = await molmo.isServerAvailable();
      return { success: true, available };
    }

    case 'MOLMO_GET_STATUS': {
      const mc = getMolmoClient();
      const stats = mc.getStats();
      const enabled = await mc.isEnabled();
      return { success: true, ...stats, enabled };
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

async function startTask(payload: { task: string; taskType?: string }): Promise<{ success: boolean; error?: string }> {
  // ALWAYS get the current active tab - don't use stale tabId
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // Find a valid tab to work with
  let targetTab = activeTab;
  
  // If active tab is a chrome:// or extension page, find the last regular tab
  if (targetTab?.url?.startsWith('chrome://') || targetTab?.url?.startsWith('chrome-extension://') || !targetTab?.url) {
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    // Find the most recent non-chrome tab
    const regularTabs = allTabs.filter(t => 
      t.url && 
      !t.url.startsWith('chrome://') && 
      !t.url.startsWith('chrome-extension://') &&
      !t.url.startsWith('about:')
    );
    if (regularTabs.length > 0) {
      targetTab = regularTabs[regularTabs.length - 1];
      console.log('[Worker] Active tab is restricted, using:', targetTab.url);
    }
  }
  
  currentTabId = targetTab?.id ?? null;
  console.log('[Worker] Starting task on tab:', currentTabId, targetTab?.url);

  if (!currentTabId) {
    notifySidePanel('AGENT_ERROR', { error: 'No valid tab found. Please open a website first.' });
    return { success: false, error: 'No valid tab found' };
  }
  
  // Verify the tab URL is not restricted
  const tabUrl = targetTab?.url || '';
  if (tabUrl.startsWith('chrome://') || tabUrl.startsWith('chrome-extension://') || tabUrl.startsWith('about:') || !tabUrl) {
    notifySidePanel('AGENT_ERROR', { error: 'Cannot run on browser pages. Please open a website like google.com first.' });
    return { success: false, error: 'Cannot run on restricted page' };
  }

  // Get active LLM client based on settings
  const llmClient = await getActiveLLMClient();

  // Check API key
  const hasKey = await llmClient.hasApiKey();
  if (!hasKey) {
    notifySidePanel('AGENT_ERROR', { error: 'API key not configured. Please open settings.' });
    return { success: false, error: 'API key not configured' };
  }

  // Stop existing agent if running
  if (currentAgent) {
    currentAgent.stop();
  }

  // Create agent config
  const config: AgentConfig = {
    tabId: currentTabId,
    task: payload.task,
    taskType: (payload.taskType as 'general' | 'form' | 'research' | 'cleanup') || 'general',
    
    onStep: (step: AgentStepEvent) => {
      notifySidePanel('AGENT_STEP', step);
    },
    
    onStateChange: (state: string) => {
      notifySidePanel('AGENT_STATE', { state });
    },
    
    onApprovalNeeded: async (action: ProposedAction, reasons: string[]): Promise<'approve' | 'reject' | 'override'> => {
      return new Promise((resolve) => {
        pendingApproval = { resolve, action };
        notifySidePanel('APPROVAL_NEEDED', { action, reasons });
      });
    },
    
    onComplete: (summary: string) => {
      notifySidePanel('AGENT_COMPLETE', { summary });
      currentAgent = null;
    },
    
    onError: (error: string) => {
      notifySidePanel('AGENT_ERROR', { error });
      currentAgent = null;
    },
  };

  // Create and start agent with the selected LLM client
  currentAgent = new AgentCore(config, llmClient as GeminiClient);
  currentAgent.start();

  return { success: true };
}

function notifySidePanel(type: string, payload: unknown): void {
  chrome.runtime.sendMessage({ type, payload }).catch(() => {
    // Side panel might not be open - that's okay
  });
}

// Track active tab
chrome.tabs.onActivated.addListener((activeInfo) => {
  currentTabId = activeInfo.tabId;
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentTabId) {
    if (currentAgent) {
      currentAgent.stop();
      currentAgent = null;
    }
    currentTabId = null;
  }
});

console.log('[HandOff] Background worker initialized');
