// 🧠 ANTHROPIC CLIENT — Claude Models via Messages API
// Claude uses a different API format than OpenAI-compatible providers

import { getPromptForTask, validateGeminiResponse, GeminiResponse, ActionSchema } from './prompts';

export interface AnalysisRequest {
  screenshot: string;
  task: string;
  taskType?: 'general' | 'form' | 'research' | 'cleanup';
  history?: ActionSchema[];
  pageUrl?: string;
  pageTitle?: string;
}

export interface AnalysisResult {
  success: boolean;
  response?: GeminiResponse;
  rawText?: string;
  error?: string;
  latencyMs?: number;
}

export const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Latest Sonnet' },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', description: 'Most capable' },
  { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', description: 'Extended thinking' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet v2', description: 'Fast & strong' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Ultra-fast' },
];

const ANTHROPIC_API_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicClient {
  private apiKey: string | null = null;
  private model: string = 'claude-sonnet-4-20250514';
  private requestCount = 0;
  private lastRequestTime = 0;
  private minRequestInterval = 200;
  private requestTimeout = 45000;
  private abortController: AbortController | null = null;

  constructor() {
    this.loadApiKey();
  }

  private async loadApiKey(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['anthropicApiKey', 'anthropicModel']);
      this.apiKey = result.anthropicApiKey || null;
      this.model = result.anthropicModel || 'claude-sonnet-4-20250514';

      // API keys are loaded exclusively from chrome.storage.local (user settings)
    } catch {
      console.warn('[AnthropicClient] Failed to load API key from storage');
    }
  }

  async setApiKey(key: string): Promise<void> {
    this.apiKey = key;
    await chrome.storage.local.set({ anthropicApiKey: key });
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
    await chrome.storage.local.set({ anthropicModel: model });
  }

  async hasApiKey(): Promise<boolean> {
    if (!this.apiKey) await this.loadApiKey();
    return !!this.apiKey;
  }

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const startTime = Date.now();

    if (!this.apiKey) {
      await this.loadApiKey();
      if (!this.apiKey) {
        return { success: false, error: 'Anthropic API key not configured. Open settings to add your key.' };
      }
    }

    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
    }

    try {
      const systemPrompt = getPromptForTask(request.taskType || 'general');
      const userMessage = this.buildUserMessage(request);

      // Strip data URL prefix for Anthropic's base64 format
      const imageData = request.screenshot.replace(/^data:image\/\w+;base64,/, '');

      console.log('[AnthropicClient] Sending request to model:', this.model);

      this.abortController = new AbortController();
      const timeoutId = setTimeout(() => this.abortController?.abort(), this.requestTimeout);

      const response = await fetch(ANTHROPIC_API_ENDPOINT, {
        signal: this.abortController.signal,
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 2048,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: imageData,
                  },
                },
                { type: 'text', text: userMessage },
              ],
            },
          ],
        }),
      });

      clearTimeout(timeoutId);
      this.lastRequestTime = Date.now();
      this.requestCount++;

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[AnthropicClient] API error:', response.status, errorText);
        if (response.status === 429) return { success: false, error: 'Rate limit exceeded. Please wait.', latencyMs: Date.now() - startTime };
        if (response.status === 401) return { success: false, error: 'Invalid Anthropic API key. Check settings.', latencyMs: Date.now() - startTime };
        return { success: false, error: `Anthropic error: ${response.status}`, latencyMs: Date.now() - startTime };
      }

      const data = await response.json();
      // Anthropic response: { content: [{ type: 'text', text: '...' }] }
      const rawText = data.content?.map((c: { type: string; text?: string }) => c.text || '').join('') || '';

      const parsed = this.parseJsonFromText(rawText);
      if (!parsed) return { success: false, rawText, error: 'Failed to parse JSON response', latencyMs: Date.now() - startTime };

      const validated = validateGeminiResponse(parsed);
      if (!validated) return { success: false, rawText, error: 'Response validation failed', latencyMs: Date.now() - startTime };

      return { success: true, response: validated, rawText, latencyMs: Date.now() - startTime };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'Anthropic request timed out.', latencyMs: Date.now() - startTime };
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error', latencyMs: Date.now() - startTime };
    }
  }

  abort(): void {
    if (this.abortController) { this.abortController.abort(); this.abortController = null; }
  }

  private buildUserMessage(request: AnalysisRequest): string {
    let message = `TASK: ${request.task}\n\n`;
    if (request.pageUrl) message += `Current URL: ${request.pageUrl}\n`;
    if (request.pageTitle) message += `Page Title: ${request.pageTitle}\n`;
    if (request.history && request.history.length > 0) {
      message += `\nPrevious actions:\n`;
      request.history.slice(-5).forEach((action, i) => {
        message += `${i + 1}. ${action.type}${action.target ? ` on "${action.target}"` : ''}\n`;
      });
    }
    message += `\nAnalyze the screenshot and determine the next action. Respond with valid JSON only.`;
    return message;
  }

  private parseJsonFromText(text: string): unknown {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) { try { return JSON.parse(jsonMatch[1].trim()); } catch { /* continue */ } }
    try { return JSON.parse(text.trim()); } catch {
      const objectMatch = text.match(/\{[\s\S]*\}/);
      if (objectMatch) { try { return JSON.parse(objectMatch[0]); } catch { return null; } }
    }
    return null;
  }

  getStats() { return { requestCount: this.requestCount, model: this.model, provider: 'Anthropic' }; }
}
