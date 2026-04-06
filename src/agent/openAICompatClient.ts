// 🔌 OPENAI-COMPATIBLE CLIENT — Shared base for OpenAI, Groq, DeepSeek, and others
// All providers using the OpenAI chat completions format

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

export interface ProviderConfig {
  name: string;
  apiEndpoint: string;
  storageKeyApi: string;
  storageKeyModel: string;
  envKeyName: string;
  defaultModel: string;
  maxTokens: number;
  requestTimeout: number;
  extraHeaders?: Record<string, string>;
  imageFormat?: 'url' | 'base64'; // Some providers want base64, some want data URL
}

export class OpenAICompatClient {
  private apiKey: string | null = null;
  private model: string;
  private config: ProviderConfig;
  private requestCount = 0;
  private lastRequestTime = 0;
  private minRequestInterval = 200;
  private abortController: AbortController | null = null;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.model = config.defaultModel;
    this.loadApiKey();
  }

  private async loadApiKey(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([this.config.storageKeyApi, this.config.storageKeyModel]);
      this.apiKey = result[this.config.storageKeyApi] || null;
      this.model = result[this.config.storageKeyModel] || this.config.defaultModel;

      if (!this.apiKey && typeof import.meta !== 'undefined') {
        const envKey = (import.meta as any).env?.[this.config.envKeyName];
        if (envKey && !envKey.includes('your_')) {
          this.apiKey = envKey;
          await chrome.storage.local.set({ [this.config.storageKeyApi]: envKey });
          console.log(`[${this.config.name}] Loaded API key from environment`);
        }
      }
    } catch {
      console.warn(`[${this.config.name}] Failed to load API key from storage`);
    }
  }

  async setApiKey(key: string): Promise<void> {
    this.apiKey = key;
    await chrome.storage.local.set({ [this.config.storageKeyApi]: key });
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
    await chrome.storage.local.set({ [this.config.storageKeyModel]: model });
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
        return { success: false, error: `${this.config.name} API key not configured. Open settings to add your key.` };
      }
    }

    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
    }

    try {
      const systemPrompt = getPromptForTask(request.taskType || 'general');
      const userMessage = this.buildUserMessage(request);

      // Format image based on provider preference
      const imageContent = this.config.imageFormat === 'base64'
        ? { type: 'image_url' as const, image_url: { url: request.screenshot.startsWith('data:') ? request.screenshot : `data:image/png;base64,${request.screenshot}` } }
        : { type: 'image_url' as const, image_url: { url: request.screenshot } };

      console.log(`[${this.config.name}] Sending request to model: ${this.model}`);

      this.abortController = new AbortController();
      const timeoutId = setTimeout(() => this.abortController?.abort(), this.config.requestTimeout);

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...this.config.extraHeaders,
      };

      const response = await fetch(this.config.apiEndpoint, {
        signal: this.abortController.signal,
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: userMessage },
                imageContent,
              ],
            },
          ],
          max_tokens: this.config.maxTokens,
          temperature: 0.1,
        }),
      });

      clearTimeout(timeoutId);
      this.lastRequestTime = Date.now();
      this.requestCount++;

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${this.config.name}] API error:`, response.status, errorText);
        if (response.status === 429) return { success: false, error: 'Rate limit exceeded. Please wait.', latencyMs: Date.now() - startTime };
        if (response.status === 401 || response.status === 403) return { success: false, error: 'Invalid API key. Check settings.', latencyMs: Date.now() - startTime };
        return { success: false, error: `${this.config.name} error: ${response.status}`, latencyMs: Date.now() - startTime };
      }

      const data = await response.json();
      const rawText = data.choices?.[0]?.message?.content || '';

      const parsed = this.parseJsonFromText(rawText);
      if (!parsed) return { success: false, rawText, error: 'Failed to parse JSON response', latencyMs: Date.now() - startTime };

      const validated = validateGeminiResponse(parsed);
      if (!validated) return { success: false, rawText, error: 'Response validation failed', latencyMs: Date.now() - startTime };

      return { success: true, response: validated, rawText, latencyMs: Date.now() - startTime };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: `${this.config.name} request timed out.`, latencyMs: Date.now() - startTime };
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

  getStats() { return { requestCount: this.requestCount, model: this.model, provider: this.config.name }; }
}

// ── OpenAI ────────────────────────────────────────────────────────

export const OPENAI_MODELS = [
  { id: 'gpt-4.1', name: 'GPT-4.1', description: 'Latest flagship' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', description: 'Fast & cheap' },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', description: 'Ultra-fast' },
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Multimodal flagship' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast multimodal' },
  { id: 'o4-mini', name: 'o4-mini', description: 'Reasoning model' },
  { id: 'o3', name: 'o3', description: 'Advanced reasoning' },
  { id: 'o3-mini', name: 'o3-mini', description: 'Fast reasoning' },
];

export class OpenAIClient extends OpenAICompatClient {
  constructor() {
    super({
      name: 'OpenAI',
      apiEndpoint: 'https://api.openai.com/v1/chat/completions',
      storageKeyApi: 'openaiApiKey',
      storageKeyModel: 'openaiModel',
      envKeyName: 'VITE_OPENAI_API_KEY',
      defaultModel: 'gpt-4o',
      maxTokens: 2048,
      requestTimeout: 30000,
    });
  }
}

// ── Groq ──────────────────────────────────────────────────────────

export const GROQ_MODELS = [
  { id: 'llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B', description: 'Meta Llama 4 (fast)' },
  { id: 'llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick 17B', description: 'Meta Llama 4 large' },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout (Meta)', description: 'Meta hosted' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', description: 'Versatile, fast' },
  { id: 'llama-3.2-90b-vision-preview', name: 'Llama 3.2 90B Vision', description: 'Vision model' },
  { id: 'llama-3.2-11b-vision-preview', name: 'Llama 3.2 11B Vision', description: 'Small vision model' },
  { id: 'gemma2-9b-it', name: 'Gemma 2 9B', description: 'Google Gemma' },
  { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', description: 'Mistral MoE' },
];

export class GroqClient extends OpenAICompatClient {
  constructor() {
    super({
      name: 'Groq',
      apiEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
      storageKeyApi: 'groqApiKey',
      storageKeyModel: 'groqModel',
      envKeyName: 'VITE_GROQ_API_KEY',
      defaultModel: 'llama-4-scout-17b-16e-instruct',
      maxTokens: 2048,
      requestTimeout: 15000, // Groq is very fast
    });
  }
}

// ── DeepSeek ──────────────────────────────────────────────────────

export const DEEPSEEK_MODELS = [
  { id: 'deepseek-chat', name: 'DeepSeek-V3', description: 'Flagship chat model' },
  { id: 'deepseek-reasoner', name: 'DeepSeek-R1', description: 'Reasoning model' },
];

export class DeepSeekClient extends OpenAICompatClient {
  constructor() {
    super({
      name: 'DeepSeek',
      apiEndpoint: 'https://api.deepseek.com/chat/completions',
      storageKeyApi: 'deepseekApiKey',
      storageKeyModel: 'deepseekModel',
      envKeyName: 'VITE_DEEPSEEK_API_KEY',
      defaultModel: 'deepseek-chat',
      maxTokens: 2048,
      requestTimeout: 45000,
    });
  }
}

// ── Qwen (via DashScope) ──────────────────────────────────────────

export const QWEN_MODELS = [
  { id: 'qwen-vl-max', name: 'Qwen-VL-Max', description: 'Best vision model' },
  { id: 'qwen-vl-plus', name: 'Qwen-VL-Plus', description: 'Balanced vision' },
  { id: 'qwen-max', name: 'Qwen-Max', description: 'Flagship text' },
  { id: 'qwen-plus', name: 'Qwen-Plus', description: 'Fast text' },
  { id: 'qwen-turbo', name: 'Qwen-Turbo', description: 'Ultra fast' },
  { id: 'qwen3-235b-a22b', name: 'Qwen3 235B (MoE)', description: 'Largest MoE' },
  { id: 'qwen3-32b', name: 'Qwen3 32B', description: 'Strong dense' },
  { id: 'qwen3-14b', name: 'Qwen3 14B', description: 'Medium dense' },
];

export class QwenClient extends OpenAICompatClient {
  constructor() {
    super({
      name: 'Qwen',
      apiEndpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      storageKeyApi: 'qwenApiKey',
      storageKeyModel: 'qwenModel',
      envKeyName: 'VITE_QWEN_API_KEY',
      defaultModel: 'qwen-vl-max',
      maxTokens: 2048,
      requestTimeout: 45000,
    });
  }
}

// ── Mistral ───────────────────────────────────────────────────────

export const MISTRAL_MODELS = [
  { id: 'pixtral-large-latest', name: 'Pixtral Large', description: 'Vision flagship' },
  { id: 'mistral-large-latest', name: 'Mistral Large', description: 'Flagship text' },
  { id: 'mistral-medium-latest', name: 'Mistral Medium', description: 'Balanced' },
  { id: 'mistral-small-latest', name: 'Mistral Small', description: 'Fast & cheap' },
  { id: 'codestral-latest', name: 'Codestral', description: 'Code specialist' },
];

export class MistralClient extends OpenAICompatClient {
  constructor() {
    super({
      name: 'Mistral',
      apiEndpoint: 'https://api.mistral.ai/v1/chat/completions',
      storageKeyApi: 'mistralApiKey',
      storageKeyModel: 'mistralModel',
      envKeyName: 'VITE_MISTRAL_API_KEY',
      defaultModel: 'pixtral-large-latest',
      maxTokens: 2048,
      requestTimeout: 30000,
    });
  }
}
