// 👁️ MOLMOWEB CLIENT — Vision-based web agent integration
// Connects to a self-hosted MolmoWeb model server (POST /predict)
// MolmoWeb takes screenshot + task → returns thought + browser action
// Used as the "vision mode" provider in the Hybrid Brain

import { ActionSchema, GeminiResponse } from './prompts';
import { AnalysisRequest, AnalysisResult } from './geminiClient';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8001';
const STORAGE_KEY_ENDPOINT = 'molmoweb_endpoint';
const STORAGE_KEY_ENABLED = 'molmoweb_enabled';

// MolmoWeb raw response format
interface MolmoWebRawResponse {
  thought?: string;
  action?: string;
  action_type?: string;
  coordinate?: [number, number]; // normalized [x, y] 0-1
  text?: string;
  key?: string;
  url?: string;
  direction?: string;
  error?: string;
}

// MolmoWeb action types from the model
type MolmoActionType =
  | 'click'
  | 'type'
  | 'scroll'
  | 'press'
  | 'navigate'
  | 'wait'
  | 'done'
  | 'message';

export class MolmoWebClient {
  private endpoint: string = DEFAULT_ENDPOINT;
  private enabled = false;
  private initialized = false;
  private requestCount = 0;
  private lastRequestTime = 0;
  private requestTimeout = 45000; // 45s — model inference can be slow
  private abortController: AbortController | null = null;
  // Viewport dimensions for coordinate conversion (default 1280x720)
  private viewportWidth = 1280;
  private viewportHeight = 720;

  constructor() {
    this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY_ENDPOINT, STORAGE_KEY_ENABLED]);
      this.endpoint = result[STORAGE_KEY_ENDPOINT] || DEFAULT_ENDPOINT;
      this.enabled = result[STORAGE_KEY_ENABLED] === true;
      this.initialized = true;
    } catch {
      this.initialized = true;
    }
  }

  async isEnabled(): Promise<boolean> {
    if (!this.initialized) await this.loadConfig();
    return this.enabled;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    await chrome.storage.local.set({ [STORAGE_KEY_ENABLED]: enabled });
  }

  async setEndpoint(endpoint: string): Promise<void> {
    this.endpoint = endpoint.replace(/\/+$/, ''); // trim trailing slashes
    await chrome.storage.local.set({ [STORAGE_KEY_ENDPOINT]: this.endpoint });
  }

  async getEndpoint(): Promise<string> {
    if (!this.initialized) await this.loadConfig();
    return this.endpoint;
  }

  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  // ── Health Check ────────────────────────────────────────────────

  async isServerAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${this.endpoint}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'ping',
          image_base64: '',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      // Server is available if it responds (even with an error about bad input)
      return res.status < 500;
    } catch {
      return false;
    }
  }

  // ── Main Analysis ───────────────────────────────────────────────

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    if (!this.initialized) await this.loadConfig();
    if (!this.enabled) {
      return { success: false, error: 'MolmoWeb is not enabled' };
    }

    const startTime = Date.now();

    try {
      // Strip data URL prefix if present
      const imageData = request.screenshot.replace(/^data:image\/\w+;base64,/, '');

      // Build the prompt for MolmoWeb
      const prompt = this.buildPrompt(request);

      // Make request to MolmoWeb server
      this.abortController = new AbortController();
      const timeoutId = setTimeout(() => this.abortController?.abort(), this.requestTimeout);

      const response = await fetch(`${this.endpoint}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          image_base64: imageData,
        }),
        signal: this.abortController.signal,
      });

      clearTimeout(timeoutId);
      this.lastRequestTime = Date.now();
      this.requestCount++;

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[MolmoWeb] Server error:', response.status, errorText);
        return {
          success: false,
          error: `MolmoWeb server error: ${response.status}`,
          latencyMs: Date.now() - startTime,
        };
      }

      const rawResponse: MolmoWebRawResponse = await response.json();
      console.log('[MolmoWeb] Raw response:', rawResponse);

      if (rawResponse.error) {
        return {
          success: false,
          error: `MolmoWeb model error: ${rawResponse.error}`,
          latencyMs: Date.now() - startTime,
        };
      }

      // Parse MolmoWeb response into HandOff's format
      const parsed = this.parseResponse(rawResponse, request);

      return {
        success: true,
        response: parsed,
        rawText: JSON.stringify(rawResponse),
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: 'MolmoWeb request timed out. Model server may be overloaded.',
          latencyMs: Date.now() - startTime,
        };
      }
      console.error('[MolmoWeb] Analysis error:', error);
      return {
        success: false,
        error: error instanceof Error
          ? `MolmoWeb connection failed: ${error.message}`
          : 'MolmoWeb unknown error',
        latencyMs: Date.now() - startTime,
      };
    }
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  // ── Prompt Building ─────────────────────────────────────────────

  private buildPrompt(request: AnalysisRequest): string {
    let prompt = request.task;

    if (request.pageUrl) {
      prompt += `\n\nCurrent page: ${request.pageUrl}`;
    }
    if (request.pageTitle) {
      prompt += ` (${request.pageTitle})`;
    }

    if (request.history && request.history.length > 0) {
      const recent = request.history.slice(-5);
      const historyStr = recent
        .map((a, i) => `${i + 1}. ${a.type}${a.target ? ` on "${a.target}"` : ''}${a.text ? `: "${a.text}"` : ''}`)
        .join('\n');
      prompt += `\n\nPrevious actions:\n${historyStr}`;
    }

    return prompt;
  }

  // ── Response Parsing ────────────────────────────────────────────

  // MolmoWeb outputs: { thought, action_type, coordinate, text, key, url, direction }
  // HandOff expects: GeminiResponse { observation, reasoning, action, confidence, ... }
  private parseResponse(raw: MolmoWebRawResponse, _request: AnalysisRequest): GeminiResponse {
    const thought = raw.thought || '';
    const actionType = this.normalizeActionType(raw.action_type || raw.action || '');

    // Check if task is complete
    if (actionType === 'done' || actionType === 'message') {
      return {
        observation: thought || 'Task appears complete.',
        reasoning: thought || 'MolmoWeb determined the task is done.',
        action: null,
        confidence: 0.85,
        requiresApproval: false,
        isComplete: true,
        nextStep: '',
      };
    }

    // Build action from MolmoWeb output
    const action = this.buildAction(actionType as MolmoActionType, raw);

    return {
      observation: thought || `Performing ${actionType}`,
      reasoning: thought || `MolmoWeb visual analysis: ${actionType}`,
      action,
      confidence: action ? 0.75 : 0.3, // MolmoWeb doesn't output confidence, use reasonable default
      requiresApproval: this.shouldRequireApproval(action),
      isComplete: false,
      nextStep: thought || '',
    };
  }

  private normalizeActionType(raw: string): string {
    const lower = raw.toLowerCase().trim();
    // Map MolmoWeb action names to HandOff action types
    const mapping: Record<string, string> = {
      click: 'click',
      type: 'type',
      scroll: 'scroll',
      press: 'press',
      navigate: 'navigate',
      goto: 'navigate',
      go_to_url: 'navigate',
      wait: 'wait',
      done: 'done',
      finish: 'done',
      complete: 'done',
      message: 'message',
      send_msg_to_user: 'message',
      key: 'press',
    };
    return mapping[lower] || lower;
  }

  private buildAction(actionType: MolmoActionType, raw: MolmoWebRawResponse): ActionSchema | null {
    switch (actionType) {
      case 'click': {
        if (!raw.coordinate || raw.coordinate.length < 2) return null;
        // MolmoWeb coordinates are normalized 0-1, convert to viewport pixels
        const x = Math.round(raw.coordinate[0] * this.viewportWidth);
        const y = Math.round(raw.coordinate[1] * this.viewportHeight);
        return {
          type: 'click',
          x,
          y,
          target: raw.text || undefined,
          confidence: 0.75,
        };
      }

      case 'type': {
        if (!raw.text) return null;
        return {
          type: 'type',
          text: raw.text,
          confidence: 0.8,
        };
      }

      case 'scroll': {
        const dir = (raw.direction || 'down').toLowerCase();
        return {
          type: 'scroll',
          direction: (['up', 'down', 'left', 'right'].includes(dir)
            ? dir
            : 'down') as 'up' | 'down' | 'left' | 'right',
          confidence: 0.8,
        };
      }

      case 'press': {
        return {
          type: 'press',
          key: raw.key || raw.text || 'Enter',
          confidence: 0.8,
        };
      }

      case 'navigate': {
        if (!raw.url) return null;
        return {
          type: 'navigate',
          url: raw.url,
          confidence: 0.8,
        };
      }

      case 'wait': {
        return {
          type: 'wait',
          duration: 2000,
          confidence: 0.9,
        };
      }

      default:
        return null;
    }
  }

  private shouldRequireApproval(action: ActionSchema | null): boolean {
    if (!action) return false;
    // Navigate to unknown URLs should require approval
    if (action.type === 'navigate') return true;
    // Type actions with sensitive-looking text
    if (action.type === 'type' && action.text) {
      const sensitive = /password|credit|card|ssn|social/i;
      if (sensitive.test(action.text)) return true;
    }
    return false;
  }

  // ── Stats ───────────────────────────────────────────────────────

  getStats(): { requestCount: number; lastRequestTime: number; endpoint: string; enabled: boolean } {
    return {
      requestCount: this.requestCount,
      lastRequestTime: this.lastRequestTime,
      endpoint: this.endpoint,
      enabled: this.enabled,
    };
  }
}

// Singleton
let molmoInstance: MolmoWebClient | null = null;

export function getMolmoClient(): MolmoWebClient {
  if (!molmoInstance) {
    molmoInstance = new MolmoWebClient();
  }
  return molmoInstance;
}
