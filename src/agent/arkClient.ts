// 👁️ ARK VISION CLIENT — Vision-based web agent integration
// Connects to a self-hosted Ark Vision server (POST /predict)
// Ark takes screenshot + task → returns thought + browser action
// Used as the "vision mode" provider in the Hybrid Brain

import { ActionSchema, GeminiResponse } from './prompts';
import { AnalysisRequest, AnalysisResult } from './geminiClient';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';
const STORAGE_KEY_ENDPOINT = 'ark_endpoint';
const STORAGE_KEY_ENABLED = 'ark_enabled';
const STORAGE_KEY_MODEL = 'ark_model';

// Ark Vision raw response format
interface ArkRawResponse {
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

// Ark Vision action types from the model
type ArkActionType =
  | 'click'
  | 'type'
  | 'scroll'
  | 'press'
  | 'navigate'
  | 'wait'
  | 'done'
  | 'message';

export class ArkVisionClient {
  private endpoint: string = DEFAULT_ENDPOINT;
  private enabled = false;
  private initialized = false;
  private requestCount = 0;
  private lastRequestTime = 0;
  private requestTimeout = 60000; // 60s — local model inference can be slow
  private abortController: AbortController | null = null;
  // Viewport dimensions for coordinate conversion (default 1280x720)
  private viewportWidth = 1280;
  private viewportHeight = 720;
  private model = 'gemma4:e4b'; // default Ollama vision model
  private backend: 'ollama' | 'ark' = 'ollama'; // auto-detect from endpoint

  constructor() {
    this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY_ENDPOINT, STORAGE_KEY_ENABLED, STORAGE_KEY_MODEL]);
      this.endpoint = result[STORAGE_KEY_ENDPOINT] || DEFAULT_ENDPOINT;
      this.enabled = result[STORAGE_KEY_ENABLED] === true;
      this.model = result[STORAGE_KEY_MODEL] || 'gemma4:e4b';
      this.backend = this.detectBackend(this.endpoint);
      this.initialized = true;
      console.log(`[Ark] Config loaded: ${this.backend} backend, model=${this.model}, endpoint=${this.endpoint}`);
    } catch {
      this.initialized = true;
    }
  }

  private detectBackend(endpoint: string): 'ollama' | 'ark' {
    // Ollama default port is 11434
    if (endpoint.includes(':11434') || endpoint.includes('ollama')) return 'ollama';
    return 'ark';
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
    this.backend = this.detectBackend(this.endpoint);
    await chrome.storage.local.set({ [STORAGE_KEY_ENDPOINT]: this.endpoint });
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
    await chrome.storage.local.set({ [STORAGE_KEY_MODEL]: this.model });
  }

  async getModel(): Promise<string> {
    if (!this.initialized) await this.loadConfig();
    return this.model;
  }

  getBackend(): string {
    return this.backend;
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

      if (this.backend === 'ollama') {
        // Ollama health check — list models
        const res = await fetch(`${this.endpoint}/api/tags`, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          const models = (data.models || []).map((m: { name: string }) => m.name);
          console.log('[Ark] Ollama models available:', models);
          return true;
        }
        return false;
      } else {
        // Original Ark server health check
        const res = await fetch(`${this.endpoint}/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'ping', image_base64: '' }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        return res.status < 500;
      }
    } catch {
      return false;
    }
  }

  // ── Main Analysis ───────────────────────────────────────────────

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    if (!this.initialized) await this.loadConfig();
    if (!this.enabled) {
      return { success: false, error: 'Ark Vision is not enabled' };
    }

    const startTime = Date.now();

    try {
      // Strip data URL prefix if present
      const imageData = request.screenshot.replace(/^data:image\/\w+;base64,/, '');

      // Build the prompt for Ark Vision
      const prompt = this.buildPrompt(request);

      // Make request to vision server (Ollama or Ark)
      this.abortController = new AbortController();
      const timeoutId = setTimeout(() => this.abortController?.abort(), this.requestTimeout);

      let rawResponse: ArkRawResponse;

      if (this.backend === 'ollama') {
        // Ollama /api/chat with vision
        const ollamaBody = {
          model: this.model,
          messages: [{
            role: 'system',
            content: this.buildOllamaSystemPrompt(),
          }, {
            role: 'user',
            content: prompt,
            images: [imageData],
          }],
          stream: false,
          options: { temperature: 0.1 },
        };

        console.log(`[Ark/Ollama] Sending to ${this.model} (image: ${Math.round(imageData.length / 1024)}KB)`);
        const response = await fetch(`${this.endpoint}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ollamaBody),
          signal: this.abortController.signal,
        });

        clearTimeout(timeoutId);
        this.lastRequestTime = Date.now();
        this.requestCount++;

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[Ark/Ollama] Server error:', response.status, errorText);
          return { success: false, error: `Ollama error: ${response.status} ${errorText}`, latencyMs: Date.now() - startTime };
        }

        const ollamaResp = await response.json();
        console.log('[Ark/Ollama] Response:', ollamaResp.message?.content?.slice(0, 200));
        rawResponse = this.parseOllamaResponse(ollamaResp.message?.content || '');
      } else {
        // Original Ark /predict endpoint
        const response = await fetch(`${this.endpoint}/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, image_base64: imageData }),
          signal: this.abortController.signal,
        });

        clearTimeout(timeoutId);
        this.lastRequestTime = Date.now();
        this.requestCount++;

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[Ark] Server error:', response.status, errorText);
          return { success: false, error: `Ark Vision server error: ${response.status}`, latencyMs: Date.now() - startTime };
        }

        rawResponse = await response.json();
      }

      console.log('[Ark] Parsed response:', rawResponse);

      if (rawResponse.error) {
        return {
          success: false,
          error: `Ark Vision model error: ${rawResponse.error}`,
          latencyMs: Date.now() - startTime,
        };
      }

      // Parse Ark response into HandOff's format
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
          error: 'Ark Vision request timed out. Model server may be overloaded.',
          latencyMs: Date.now() - startTime,
        };
      }
      console.error('[Ark] Analysis error:', error);
      return {
        success: false,
        error: error instanceof Error
          ? `Ark Vision connection failed: ${error.message}`
          : 'Ark Vision unknown error',
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

  // Ark outputs: { thought, action_type, coordinate, text, key, url, direction }
  // HandOff expects: GeminiResponse { observation, reasoning, action, confidence, ... }
  private parseResponse(raw: ArkRawResponse, _request: AnalysisRequest): GeminiResponse {
    const thought = raw.thought || '';
    const actionType = this.normalizeActionType(raw.action_type || raw.action || '');

    // Check if task is complete
    if (actionType === 'done' || actionType === 'message') {
      return {
        observation: thought || 'Task appears complete.',
        reasoning: thought || 'Ark Vision determined the task is done.',
        action: null,
        confidence: 0.85,
        requiresApproval: false,
        isComplete: true,
        nextStep: '',
      };
    }

    // Build action from Ark output
    const action = this.buildAction(actionType as ArkActionType, raw);

    return {
      observation: thought || `Performing ${actionType}`,
      reasoning: thought || `Ark visual analysis: ${actionType}`,
      action,
      confidence: action ? 0.75 : 0.3, // Ark doesn't output confidence, use reasonable default
      requiresApproval: this.shouldRequireApproval(action),
      isComplete: false,
      nextStep: thought || '',
    };
  }

  private normalizeActionType(raw: string): string {
    const lower = raw.toLowerCase().trim();
    // Map Ark action names to HandOff action types
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

  private buildAction(actionType: ArkActionType, raw: ArkRawResponse): ActionSchema | null {
    switch (actionType) {
      case 'click': {
        if (!raw.coordinate || raw.coordinate.length < 2) return null;
        // Ark coordinates are normalized 0-1, convert to viewport pixels
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

  // ── Ollama Integration ─────────────────────────────────────────

  private buildOllamaSystemPrompt(): string {
    return `You are a browser automation vision agent. Given a screenshot of a web page and a task, output a JSON object with the next action.

You MUST respond with ONLY valid JSON, no extra text. Format:
{
  "thought": "what I see and my reasoning",
  "action_type": "click" | "type" | "scroll" | "press" | "navigate" | "wait" | "done",
  "coordinate": [x, y],  // normalized 0.0-1.0, for click actions
  "text": "text to type",  // for type actions
  "key": "Enter",  // for press actions
  "url": "https://...",  // for navigate actions
  "direction": "up" | "down"  // for scroll actions
}

Rules:
- Coordinates are normalized: (0,0) = top-left, (1,1) = bottom-right
- For click: provide coordinate of the element center
- For type: the text will be typed into the currently focused element
- Use "done" when the task is complete
- Be precise with coordinates — look at the actual element positions in the screenshot`;
  }

  private parseOllamaResponse(text: string): ArkRawResponse {
    // Try to extract JSON from the response
    try {
      // Look for JSON block in the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          thought: parsed.thought || parsed.reasoning || '',
          action_type: parsed.action_type || parsed.action || 'done',
          coordinate: parsed.coordinate || undefined,
          text: parsed.text || undefined,
          key: parsed.key || undefined,
          url: parsed.url || undefined,
          direction: parsed.direction || undefined,
        };
      }
    } catch (e) {
      console.warn('[Ark/Ollama] Failed to parse JSON response:', e);
    }

    // Fallback: try to interpret natural language response
    const lower = text.toLowerCase();
    if (lower.includes('click') || lower.includes('tap')) {
      // Try to extract coordinates from text like "click at (0.5, 0.3)"
      const coordMatch = text.match(/(\d+\.?\d*)\s*,\s*(\d+\.?\d*)/);
      if (coordMatch) {
        let x = parseFloat(coordMatch[1]);
        let y = parseFloat(coordMatch[2]);
        // If coordinates look like pixels (>1), normalize
        if (x > 1) x = x / this.viewportWidth;
        if (y > 1) y = y / this.viewportHeight;
        return { thought: text, action_type: 'click', coordinate: [x, y] };
      }
    }
    if (lower.includes('type') || lower.includes('enter text')) {
      const textMatch = text.match(/["']([^"']+)["']/);
      return { thought: text, action_type: 'type', text: textMatch?.[1] || '' };
    }
    if (lower.includes('scroll down')) return { thought: text, action_type: 'scroll', direction: 'down' };
    if (lower.includes('scroll up')) return { thought: text, action_type: 'scroll', direction: 'up' };
    if (lower.includes('done') || lower.includes('complete')) return { thought: text, action_type: 'done' };

    // Can't parse — return as thought with done
    return { thought: text, action_type: 'done' };
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
let arkInstance: ArkVisionClient | null = null;

export function getArkClient(): ArkVisionClient {
  if (!arkInstance) {
    arkInstance = new ArkVisionClient();
  }
  return arkInstance;
}
