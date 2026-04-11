// 🔧 EXTENSION ENGINEER AGENT — Background Service Worker
// Orchestrates agent lifecycle and message passing

import { AgentCore, AgentConfig, AgentStepEvent } from '../agent/agentCore';
import { GeminiClient } from '../agent/geminiClient';
import { OpenRouterClient } from '../agent/openRouterClient';
import { RouteLLMClient } from '../agent/routeLLMClient';
import { OpenAIClient, GroqClient, DeepSeekClient, QwenClient, MistralClient } from '../agent/openAICompatClient';
import { AnthropicClient } from '../agent/anthropicClient';
import { ProposedAction } from '../agent/stateMachine';
import { usageTracker } from '../agent/usageTracker';
import { executionMemory } from '../agent/executionMemory';
import { autoSkill } from '../agent/autoSkill';
import { hybridBrain } from '../agent/hybridBrain';
import { failureLearning } from '../agent/failureLearning';
import { getArkClient } from '../agent/arkClient';
import { getHFClient } from '../agent/hfClient';
import { hfEmbeddings } from '../agent/hfEmbeddings';
import { metaAgent } from '../agent/metaAgent';
import { apiTool } from '../agent/apiTool';
import { skillRecorder, BUILT_IN_TEMPLATES } from '../agent/skillRecorder';
import { fileTool } from '../agent/fileTool';
import { mcpServer } from '../agent/mcpServer';
import { a2ui, A2UI_TEMPLATES, validateWidgetPayload } from '../agent/a2ui';
import type { A2UIWidgetPayload, A2UIUserAction } from '../agent/a2ui';
import { mcpClient } from '../agent/mcpClient';
import { a2aProtocol } from '../agent/a2aProtocol';
import { getComposioClient } from '../agent/composioClient';
import { keepAlive } from './keepAlive';

// LLM Client interface (all clients implement this)
interface LLMClient {
  hasApiKey(): Promise<boolean>;
  analyze(request: unknown): Promise<unknown>;
}

// State
let currentAgent: AgentCore | null = null;
let currentTabId: number | null = null;
let currentTaskId: string | null = null;
let pendingApproval: {
  resolve: (decision: 'approve' | 'reject' | 'override') => void;
  action: ProposedAction;
} | null = null;

// Initialize LLM clients
const geminiClient = new GeminiClient();
const openRouterClient = new OpenRouterClient();
const routeLLMClient = new RouteLLMClient();
const openaiClient = new OpenAIClient();
const anthropicClient = new AnthropicClient();
const groqClient = new GroqClient();
const deepseekClient = new DeepSeekClient();
const qwenClient = new QwenClient();
const mistralClient = new MistralClient();

// Get the active LLM client based on settings
async function getActiveLLMClient(): Promise<LLMClient> {
  const result = await chrome.storage.local.get('llmProvider');
  const provider = result.llmProvider || 'gemini';
  switch (provider) {
    case 'openrouter': return openRouterClient;
    case 'routellm': return routeLLMClient;
    case 'openai': return openaiClient;
    case 'anthropic': return anthropicClient;
    case 'groq': return groqClient;
    case 'deepseek': return deepseekClient;
    case 'qwen': return qwenClient;
    case 'mistral': return mistralClient;
    default: return geminiClient;
  }
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
  console.log('[Worker] RAW message received:', message?.type, message);
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
    case 'START_TASK': {
      const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      currentTaskId = taskId;
      keepAlive.startTask(taskId, {
        task: (message.payload as { task: string }).task,
        tabId: currentTabId || 0,
        iteration: 0,
        actionHistory: [],
        correctionContext: null,
        retryCount: 0,
        consecutiveScrolls: 0,
        lastActionSignature: null,
        autonomyLevel: 'balanced',
      }).catch(console.error);
      return await startTask(message.payload as { task: string; taskType?: string });
    }

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

    case 'ARK_HEALTH_CHECK': {
      const ark = getArkClient();
      const ep = (message.payload as { endpoint?: string })?.endpoint;
      if (ep) await ark.setEndpoint(ep);
      const available = await ark.isServerAvailable();
      return { success: true, available };
    }

    case 'ARK_GET_STATUS': {
      const ac = getArkClient();
      const stats = ac.getStats();
      const enabled = await ac.isEnabled();
      return { success: true, ...stats, enabled };
    }

    // ── HuggingFace Handlers ────────────────────────────────────

    case 'HF_GET_CONFIG': {
      const hf = getHFClient();
      const config = await hf.getConfig();
      return { success: true, ...config };
    }

    case 'HF_SET_CONFIG': {
      const hf = getHFClient();
      await hf.setConfig(message.payload as any);
      return { success: true };
    }

    case 'HF_GET_STATS': {
      const hf = getHFClient();
      const hfStats = hf.getStats();
      const embedCacheSize = hfEmbeddings.getCacheSize();
      return { success: true, ...hfStats, embedCacheSize };
    }

    case 'HF_TEST_CONNECTION': {
      const hf = getHFClient();
      const p = message.payload as { token?: string };
      if (p?.token) await hf.setConfig({ token: p.token, enabled: true });
      // Just validate the token against HF's whoami endpoint — fast + reliable
      try {
        const token = p?.token || (await hf.getConfig()).token;
        const resp = await fetch('https://huggingface.co/api/whoami-v2', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) {
          const user = await resp.json();
          console.log('[HF] Token valid, user:', user?.name || user?.fullname);
          return { success: true, available: true, user: user?.name || user?.fullname };
        }
        const errText = await resp.text();
        return { success: true, available: false, error: `Token invalid (${resp.status}): ${errText.slice(0, 100)}` };
      } catch (e) {
        return { success: true, available: false, error: e instanceof Error ? e.message : 'Connection failed' };
      }
    }

    case 'HF_CLASSIFY_TASK': {
      const taskText = (message.payload as { task: string }).task;
      const classification = await hfEmbeddings.classifyTask(taskText);
      return { success: true, ...classification };
    }

    // ── Meta-Agent Handlers ──────────────────────────────────────

    case 'META_RUN_OPTIMIZATION': {
      await metaAgent.init();
      const result = await metaAgent.runOptimizationCycle();
      return { success: true, ...result };
    }

    case 'META_GET_STATS': {
      const metaStats = await metaAgent.getStats();
      return { success: true, ...metaStats };
    }

    case 'META_GET_SCORE': {
      const score = await metaAgent.computeOverallScore();
      return { success: true, score };
    }

    case 'META_GET_PATCHES': {
      const patches = await metaAgent.getActivePatches();
      return { success: true, patches };
    }

    case 'META_GET_SITE_STRATEGIES': {
      const strategies = await metaAgent.getSiteStrategies();
      return { success: true, strategies };
    }

    case 'META_GET_TEMPLATES': {
      const templates = await metaAgent.getTemplates();
      return { success: true, templates };
    }

    case 'META_CREATE_TEMPLATE': {
      const tpl = message.payload as any;
      const template = await metaAgent.createTemplate(tpl);
      return { success: true, template };
    }

    case 'META_DELETE_TEMPLATE': {
      await metaAgent.deleteTemplate((message.payload as { id: string }).id);
      return { success: true };
    }

    case 'META_GET_SCORE_HISTORY': {
      const history = await metaAgent.getScoreHistory();
      return { success: true, history };
    }

    case 'META_CLEAR_ALL': {
      await metaAgent.clearAll();
      return { success: true };
    }

    // ── API Tool Handlers ─────────────────────────────────────────

    case 'API_EXECUTE': {
      const req = message.payload as { method: string; url: string; headers?: Record<string,string>; body?: unknown; timeout?: number };
      const apiResult = await apiTool.execute({
        method: req.method as any,
        url: req.url,
        headers: req.headers,
        body: req.body,
        timeout: req.timeout,
      });
      return { success: true, result: apiResult };
    }

    case 'API_EXECUTE_ENDPOINT': {
      const ep = message.payload as { endpointId: string; variables?: Record<string,string> };
      const epResult = await apiTool.executeEndpoint(ep.endpointId, ep.variables);
      return { success: true, result: epResult };
    }

    case 'API_GET_CONFIG': {
      const apiConfig = await apiTool.getConfig();
      return { success: true, config: apiConfig };
    }

    case 'API_SET_CONFIG': {
      await apiTool.setConfig(message.payload as any);
      return { success: true };
    }

    case 'API_ADD_DOMAIN': {
      await apiTool.addDomain((message.payload as { domain: string }).domain);
      return { success: true };
    }

    case 'API_REMOVE_DOMAIN': {
      await apiTool.removeDomain((message.payload as { domain: string }).domain);
      return { success: true };
    }

    case 'API_ADD_ENDPOINT': {
      const saved = await apiTool.addEndpoint(message.payload as any);
      return { success: true, endpoint: saved };
    }

    case 'API_REMOVE_ENDPOINT': {
      await apiTool.removeEndpoint((message.payload as { id: string }).id);
      return { success: true };
    }

    case 'API_GET_LOG': {
      const apiLog = await apiTool.getLog((message.payload as { limit?: number })?.limit);
      return { success: true, log: apiLog };
    }

    case 'API_GET_STATS': {
      const apiStats = apiTool.getStats();
      return { success: true, ...apiStats };
    }

    // ── Skill Recorder Handlers ───────────────────────────────────

    case 'RECORDER_START': {
      const rp = message.payload as { name: string; description: string; startUrl: string };
      const session = await skillRecorder.startRecording(rp.name, rp.description, rp.startUrl);
      return { success: true, session };
    }

    case 'RECORDER_RECORD_STEP': {
      const sp = message.payload as { action: any; pageUrl: string; pageTitle: string; selector?: string };
      await skillRecorder.recordStep(sp.action, sp.pageUrl, sp.pageTitle, sp.selector);
      return { success: true };
    }

    case 'RECORDER_STOP': {
      const completed = await skillRecorder.stopRecording();
      return { success: true, session: completed };
    }

    case 'RECORDER_PAUSE': {
      await skillRecorder.pauseRecording();
      return { success: true };
    }

    case 'RECORDER_RESUME': {
      await skillRecorder.resumeRecording();
      return { success: true };
    }

    case 'RECORDER_CANCEL': {
      await skillRecorder.cancelRecording();
      return { success: true };
    }

    case 'RECORDER_GET_STATUS': {
      const isRec = skillRecorder.isRecording();
      const active = skillRecorder.getActiveRecording();
      return { success: true, isRecording: isRec, session: active };
    }

    case 'RECORDER_CONVERT_TO_SKILL': {
      const cp = message.payload as { recordingId: string; variables?: any[] };
      const skill = await skillRecorder.convertToSkill(cp.recordingId, cp.variables);
      return { success: true, skill };
    }

    case 'RECORDER_GET_RECORDINGS': {
      const recordings = await skillRecorder.getRecordings();
      return { success: true, recordings };
    }

    case 'RECORDER_DELETE': {
      await skillRecorder.deleteRecording((message.payload as { id: string }).id);
      return { success: true };
    }

    case 'RECORDER_GET_TEMPLATES': {
      return { success: true, templates: BUILT_IN_TEMPLATES };
    }

    case 'RECORDER_INSTALL_TEMPLATE': {
      const tplId = (message.payload as { templateId: string }).templateId;
      const tpl = BUILT_IN_TEMPLATES.find(t => t.id === tplId);
      if (!tpl) return { success: false, error: 'Template not found' };
      const installed = await skillRecorder.installTemplate(tpl);
      return { success: true, skill: installed };
    }

    // ── File Tool Handlers ────────────────────────────────────────

    case 'FILE_GENERATE': {
      const fg = message.payload as { filename: string; content: string; mimeType?: string };
      const fileResult = await fileTool.generateFile(fg);
      return { success: true, result: fileResult };
    }

    case 'FILE_DOWNLOAD': {
      const fd = message.payload as { url: string; filename?: string };
      const dlResult = await fileTool.downloadFile(fd);
      return { success: true, result: dlResult };
    }

    case 'FILE_EXPORT_JSON': {
      const ej = message.payload as { data: unknown; filename?: string };
      const ejResult = await fileTool.exportJSON(ej.data, ej.filename);
      return { success: true, result: ejResult };
    }

    case 'FILE_EXPORT_CSV': {
      const ec = message.payload as { headers: string[]; rows: string[][]; filename?: string };
      const ecResult = await fileTool.exportCSV(ec.headers, ec.rows, ec.filename);
      return { success: true, result: ecResult };
    }

    case 'FILE_EXPORT_HTML': {
      const eh = message.payload as { title: string; bodyContent: string; filename?: string };
      const ehResult = await fileTool.exportHTML(eh.title, eh.bodyContent, eh.filename);
      return { success: true, result: ehResult };
    }

    case 'FILE_EXPORT_MARKDOWN': {
      const em = message.payload as { title: string; sections: { heading: string; content: string }[]; filename?: string };
      const emResult = await fileTool.exportMarkdown(em.title, em.sections, em.filename);
      return { success: true, result: emResult };
    }

    case 'FILE_EXPORT_CODE': {
      const ecd = message.payload as { code: string; filename: string; language?: string };
      const ecdResult = await fileTool.exportCode(ecd.code, ecd.filename, ecd.language);
      return { success: true, result: ecdResult };
    }

    case 'FILE_GET_LOG': {
      const fileLog = await fileTool.getLog((message.payload as { limit?: number })?.limit);
      return { success: true, log: fileLog };
    }

    case 'FILE_GET_STATS': {
      const fileStats = fileTool.getStats();
      return { success: true, ...fileStats };
    }

    // ── MCP Server Handlers ───────────────────────────────────────

    case 'MCP_GET_CONFIG': {
      const mcpConfig = await mcpServer.getConfig();
      return { success: true, config: mcpConfig };
    }

    case 'MCP_SET_CONFIG': {
      await mcpServer.setConfig(message.payload as any);
      return { success: true };
    }

    case 'MCP_GET_TOOLS': {
      const tools = mcpServer.getAvailableTools();
      return { success: true, tools };
    }

    case 'MCP_GET_STATS': {
      const mcpStats = mcpServer.getStats();
      return { success: true, ...mcpStats };
    }

    case 'MCP_HANDLE_REQUEST': {
      const mcpReq = message.payload as any;
      const mcpResp = await mcpServer.handleExternalMessage(mcpReq);
      return { success: true, response: mcpResp };
    }

    // ── A2UI Widget Handlers ──────────────────────────────────────

    case 'A2UI_RENDER_WIDGET': {
      const widgetPayload = message.payload as A2UIWidgetPayload;
      const validation = a2ui.renderWidget(widgetPayload);
      if (!validation.valid) {
        return { success: false, error: `Invalid widget: ${validation.errors.join(', ')}` };
      }
      // Broadcast to sidepanel
      chrome.runtime.sendMessage({ type: 'A2UI_RENDER_WIDGET', payload: widgetPayload }).catch(() => {});
      return { success: true };
    }

    case 'A2UI_DISMISS_WIDGET': {
      const wid = (message.payload as { widgetId: string }).widgetId;
      a2ui.dismissWidget(wid);
      chrome.runtime.sendMessage({ type: 'A2UI_DISMISS_WIDGET', payload: { widgetId: wid } }).catch(() => {});
      return { success: true };
    }

    case 'A2UI_UPDATE_WIDGET': {
      const up = message.payload as { widgetId: string } & Partial<A2UIWidgetPayload>;
      a2ui.updateWidget(up.widgetId, up);
      chrome.runtime.sendMessage({ type: 'A2UI_UPDATE_WIDGET', payload: up }).catch(() => {});
      return { success: true };
    }

    case 'A2UI_USER_ACTION': {
      const action = message.payload as A2UIUserAction;
      a2ui.handleUserAction(action);
      console.log('[Worker] A2UI user action:', action.actionId, 'values:', action.values);
      return { success: true };
    }

    case 'A2UI_GET_TEMPLATES': {
      return { success: true, templates: Object.keys(A2UI_TEMPLATES) };
    }

    case 'A2UI_RENDER_TEMPLATE': {
      const tp = message.payload as { template: string; args: unknown[] };
      const templateFn = (A2UI_TEMPLATES as Record<string, (...args: any[]) => A2UIWidgetPayload>)[tp.template];
      if (!templateFn) return { success: false, error: `Unknown template: ${tp.template}` };
      const tplPayload = templateFn(...(tp.args || []));
      const tplValidation = a2ui.renderWidget(tplPayload);
      if (!tplValidation.valid) return { success: false, error: tplValidation.errors.join(', ') };
      chrome.runtime.sendMessage({ type: 'A2UI_RENDER_WIDGET', payload: tplPayload }).catch(() => {});
      return { success: true, widgetId: tplPayload.widgetId };
    }

    case 'A2UI_VALIDATE': {
      const vResult = validateWidgetPayload(message.payload);
      return { success: vResult.valid, errors: vResult.errors };
    }

    case 'A2UI_GET_ACTIVE': {
      return { success: true, widgets: a2ui.getActiveWidgets() };
    }

    case 'A2UI_CLEAR_ALL': {
      a2ui.clearAll();
      chrome.runtime.sendMessage({ type: 'A2UI_CLEAR_ALL' }).catch(() => {});
      return { success: true };
    }

    // ── MCP Client Handlers ──────────────────────────────────────

    case 'MCP_CLIENT_ADD_SERVER': {
      const server = await mcpClient.addServer(message.payload as any);
      return { success: true, result: server };
    }

    case 'MCP_CLIENT_REMOVE_SERVER': {
      await mcpClient.removeServer((message.payload as { serverId: string }).serverId);
      return { success: true };
    }

    case 'MCP_CLIENT_LIST_SERVERS': {
      return { success: true, result: mcpClient.getServers() };
    }

    case 'MCP_CLIENT_DISCOVER_TOOLS': {
      const tools = await mcpClient.discoverTools((message.payload as { serverId?: string })?.serverId);
      return { success: true, result: tools };
    }

    case 'MCP_CLIENT_CALL_TOOL': {
      const { serverId, toolName, args } = message.payload as { serverId: string; toolName: string; args: Record<string, unknown> };
      const toolResult = await mcpClient.callTool(serverId, toolName, args);
      return { success: true, result: toolResult };
    }

    case 'MCP_CLIENT_PING': {
      const pingResult = await mcpClient.pingServer((message.payload as { serverId: string }).serverId);
      return { success: true, result: pingResult };
    }

    // ── A2A Protocol Handlers ────────────────────────────────────

    case 'A2A_REGISTER_AGENT': {
      const agent = await a2aProtocol.registerAgent(message.payload as any);
      return { success: true, result: agent };
    }

    case 'A2A_REMOVE_AGENT': {
      await a2aProtocol.removeAgent((message.payload as { agentId: string }).agentId);
      return { success: true };
    }

    case 'A2A_LIST_AGENTS': {
      return { success: true, result: a2aProtocol.getRemoteAgents() };
    }

    case 'A2A_DISCOVER_AGENT': {
      const { endpoint, apiKey: dApiKey } = message.payload as { endpoint: string; apiKey?: string };
      const card = await a2aProtocol.discoverAgent(endpoint, dApiKey);
      return { success: true, result: card };
    }

    case 'A2A_SEND_TASK': {
      const { agentId, intent, description, input } = message.payload as { agentId: string; intent: string; description: string; input: Record<string, unknown> };
      const task = await a2aProtocol.sendTask(agentId, intent, description, input);
      return { success: true, result: task };
    }

    case 'A2A_GET_ACTIVE_TASKS': {
      return { success: true, result: a2aProtocol.getActiveTasks() };
    }

    case 'A2A_GET_CARD': {
      return { success: true, result: a2aProtocol.agentCard };
    }

    case 'A2A_HANDLE_INCOMING': {
      const inResult = await a2aProtocol.handleIncomingTask(message.payload as any);
      return { success: true, result: inResult };
    }

    // ── Composio Handlers ─────────────────────────────────────────

    case 'COMPOSIO_HEALTH_CHECK': {
      const composio = getComposioClient();
      await composio.loadConfig();
      const available = await composio.healthCheck();
      return { success: true, available };
    }

    case 'COMPOSIO_GET_TOOLKITS': {
      const composio = getComposioClient();
      const toolkits = await composio.getToolkitsWithStatus();
      return { success: true, result: toolkits };
    }

    case 'COMPOSIO_GET_CATEGORIES': {
      const composio = getComposioClient();
      const categories = await composio.getCategories();
      return { success: true, result: categories };
    }

    case 'COMPOSIO_GET_TOOLS': {
      const composio = getComposioClient();
      const { toolkit, search, limit } = (message.payload || {}) as { toolkit?: string; search?: string; limit?: number };
      const tools = await composio.getTools({ toolkit, search, limit });
      return { success: true, result: tools };
    }

    case 'COMPOSIO_EXECUTE_TOOL': {
      const composio = getComposioClient();
      const { toolSlug, params, connectedAccountId } = message.payload as { toolSlug: string; params: Record<string, unknown>; connectedAccountId?: string };
      const execResult = await composio.executeTool(toolSlug, params, connectedAccountId);
      return { success: true, result: execResult };
    }

    case 'COMPOSIO_INITIATE_CONNECTION': {
      const composio = getComposioClient();
      const { toolkitSlug, redirectUrl } = message.payload as { toolkitSlug: string; redirectUrl?: string };
      const connResult = await composio.initiateConnection(toolkitSlug, redirectUrl);
      return { success: true, result: connResult };
    }

    case 'COMPOSIO_GET_CONNECTED_ACCOUNTS': {
      const composio = getComposioClient();
      const { toolkit_slug } = (message.payload || {}) as { toolkit_slug?: string };
      const accounts = await composio.getConnectedAccounts({ toolkit_slug });
      return { success: true, result: accounts };
    }

    case 'COMPOSIO_DISCONNECT': {
      const composio = getComposioClient();
      const { nanoid } = message.payload as { nanoid: string };
      await composio.disconnectAccount(nanoid);
      return { success: true };
    }

    case 'KEEPALIVE_PING':
      return { pong: true, timestamp: Date.now() };

    case 'RESUME_FROM_CHECKPOINT':
      return { success: true, message: 'Checkpoint acknowledged' };

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// ── MCP External Message Listener ────────────────────────────────
// Listen for messages from other extensions (MCP clients)
// Initialize keep-alive safely on startup
try {
  keepAlive.init().then(() => {
    console.log('[Worker] Keep-alive initialized');
  }).catch((err: unknown) => {
    console.warn('[Worker] Keep-alive init failed (non-critical):', err);
  });
} catch (e) {
  console.warn('[Worker] Keep-alive init error:', e);
}

chrome.runtime.onMessageExternal?.addListener(
  (request, sender, sendResponse) => {
    mcpServer.handleExternalMessage(request, sender.id).then(sendResponse);
    return true; // async
  }
);

async function startTask(payload: { task: string; taskType?: string }): Promise<{ success: boolean; error?: string }> {
  console.log('[Worker] startTask called with:', payload.task);
  
  // ALWAYS get the current active tab - don't use stale tabId
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('[Worker] Active tab:', activeTab?.id, activeTab?.url);
  
  // Find a valid tab to work with
  console.log('[Worker] Finding valid tab...');
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
  console.log('[Worker] Target tab selected:', currentTabId, targetTab?.url);

  if (!currentTabId) {
    console.error('[Worker] No valid tab found');
    notifySidePanel('AGENT_ERROR', { error: 'No valid tab found. Please open a website first.' });
    return { success: false, error: 'No valid tab found' };
  }
  console.log('[Worker] Tab validated:', currentTabId);
  
  // Verify the tab URL is not restricted
  const tabUrl = targetTab?.url || '';
  if (tabUrl.startsWith('chrome://') || tabUrl.startsWith('chrome-extension://') || tabUrl.startsWith('about:') || !tabUrl) {
    notifySidePanel('AGENT_ERROR', { error: 'Cannot run on browser pages. Please open a website like google.com first.' });
    return { success: false, error: 'Cannot run on restricted page' };
  }

  // Get active LLM client based on settings
  console.log('[Worker] Getting LLM client...');
  const llmClient = await getActiveLLMClient();
  console.log('[Worker] LLM client obtained');

  // Check API key
  console.log('[Worker] Checking API key...');
  const hasKey = await llmClient.hasApiKey();
  console.log('[Worker] API key present:', hasKey);
  if (!hasKey) {
    notifySidePanel('AGENT_ERROR', { error: 'API key not configured. Please open settings.' });
    return { success: false, error: 'API key not configured' };
  }

  // Pre-flight connectivity check for OpenRouter
  const result2 = await chrome.storage.local.get('llmProvider');
  const currentProvider = result2.llmProvider || 'gemini';
  console.log('[Worker] LLM Provider:', currentProvider);
  if (currentProvider === 'openrouter') {
    try {
      console.log('[Worker] Testing OpenRouter connectivity...');
      const testResp = await fetch('https://openrouter.ai/api/v1/models', { method: 'GET' });
      console.log('[Worker] OpenRouter test response:', testResp.status);
    } catch (e) {
      console.error('[Worker] OpenRouter connectivity FAILED:', e);
      notifySidePanel('AGENT_ERROR', { error: `Cannot reach OpenRouter API: ${(e as Error)?.message}. Check internet or firewall.` });
      return { success: false, error: 'Cannot reach OpenRouter API' };
    }
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
  console.log('[Worker] Creating AgentCore...');
  currentAgent = new AgentCore(config, llmClient as GeminiClient);
  console.log('[Worker] AgentCore created, starting (fire-and-forget)...');
  
  // Fire-and-forget — don't await, or the message handler blocks forever
  currentAgent.start().catch((error) => {
    console.error('[Worker] Agent start failed:', error);
    notifySidePanel('AGENT_ERROR', { 
      error: error instanceof Error ? error.message : 'Failed to start agent' 
    });
    currentAgent = null;
  });

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
