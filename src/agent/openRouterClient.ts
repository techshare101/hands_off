// 🌐 OPENROUTER CLIENT — Alternative LLM Provider
// Supports multiple models via OpenRouter API

import { getPromptForTask, validateGeminiResponse, GeminiResponse, ActionSchema } from './prompts';

const OPENROUTER_API_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

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

export class OpenRouterClient {
  private apiKey: string | null = null;
  private model: string = 'google/gemini-2.0-flash-exp:free'; // Default model
  private requestCount = 0;
  private lastRequestTime = 0;
  private minRequestInterval = 200; // Reduced for faster responses
  private requestTimeout = 30000; // 30 second timeout
  private abortController: AbortController | null = null;

  constructor() {
    this.loadApiKey();
  }

  private async loadApiKey(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['openRouterApiKey', 'openRouterModel']);
      this.apiKey = result.openRouterApiKey || null;
      this.model = result.openRouterModel || 'google/gemini-2.0-flash-exp:free';
      
      // Fallback to env variable
      if (!this.apiKey && typeof import.meta !== 'undefined') {
        const envKey = (import.meta as any).env?.VITE_OPENROUTER_API_KEY;
        if (envKey && envKey !== 'your_api_key_here') {
          this.apiKey = envKey;
          await chrome.storage.local.set({ openRouterApiKey: envKey });
          console.log('[OpenRouterClient] Loaded API key from environment');
        }
      }
    } catch {
      console.warn('[OpenRouterClient] Failed to load API key from storage');
    }
  }

  async setApiKey(key: string): Promise<void> {
    this.apiKey = key;
    await chrome.storage.local.set({ openRouterApiKey: key });
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
    await chrome.storage.local.set({ openRouterModel: model });
  }

  async hasApiKey(): Promise<boolean> {
    if (!this.apiKey) {
      await this.loadApiKey();
    }
    return !!this.apiKey;
  }

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const startTime = Date.now();

    if (!this.apiKey) {
      await this.loadApiKey();
      if (!this.apiKey) {
        return { success: false, error: 'OpenRouter API key not configured. Open settings to add your key.' };
      }
    }

    // Rate limiting
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
    }

    try {
      const systemPrompt = getPromptForTask(request.taskType || 'general');
      const userMessage = this.buildUserMessage(request);

      // Ensure screenshot has proper data URL prefix
      let screenshotUrl = request.screenshot;
      if (!screenshotUrl.startsWith('data:')) {
        screenshotUrl = `data:image/jpeg;base64,${screenshotUrl}`;
      }
      const screenshotSizeKB = Math.round(screenshotUrl.length / 1024);
      console.log(`[OpenRouterClient] Sending request to model: ${this.model} (screenshot: ${screenshotSizeKB}KB)`);
      
      // Create abort controller for timeout
      this.abortController = new AbortController();
      const timeoutId = setTimeout(() => this.abortController?.abort(), this.requestTimeout);
      
      const response = await fetch(OPENROUTER_API_ENDPOINT, {
        signal: this.abortController.signal,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://handoff-extension.local',
          'X-Title': 'HandOff Browser Agent',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: userMessage },
                {
                  type: 'image_url',
                  image_url: { url: screenshotUrl }
                }
              ]
            }
          ],
          max_tokens: 2048,
          temperature: 0.1,
        }),
      });
      
      clearTimeout(timeoutId);
      console.log('[OpenRouterClient] Response status:', response.status);

      this.lastRequestTime = Date.now();
      this.requestCount++;

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[OpenRouterClient] API error:', response.status, errorText);
        return {
          success: false,
          error: `OpenRouter API error: ${response.status} - ${errorText}`,
          latencyMs: Date.now() - startTime,
        };
      }

      const data = await response.json();
      console.log('[OpenRouterClient] Response data:', JSON.stringify(data).slice(0, 500));
      const rawText = data.choices?.[0]?.message?.content || '';

      // Parse JSON from response
      const parsed = this.parseJsonFromText(rawText);
      if (!parsed) {
        return {
          success: false,
          rawText,
          error: 'Failed to parse JSON response',
          latencyMs: Date.now() - startTime,
        };
      }

      const validated = validateGeminiResponse(parsed);
      if (!validated) {
        return {
          success: false,
          rawText,
          error: 'Response validation failed',
          latencyMs: Date.now() - startTime,
        };
      }

      return {
        success: true,
        response: validated,
        rawText,
        latencyMs: Date.now() - startTime,
      };

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('[OpenRouterClient] Request timed out after', this.requestTimeout, 'ms');
        return {
          success: false,
          error: 'Request timed out. Try a faster model or check your connection.',
          latencyMs: Date.now() - startTime,
        };
      }
      console.error('[OpenRouterClient] Request failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
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

  private buildUserMessage(request: AnalysisRequest): string {
    let message = `TASK: ${request.task}\n\n`;

    if (request.pageUrl) {
      message += `Current URL: ${request.pageUrl}\n`;
    }
    if (request.pageTitle) {
      message += `Page Title: ${request.pageTitle}\n`;
    }

    if (request.history && request.history.length > 0) {
      message += `\nPrevious actions:\n`;
      request.history.slice(-5).forEach((action, i) => {
        message += `${i + 1}. ${action.type}${action.target ? ` on "${action.target}"` : ''}\n`;
      });
    }

    message += `\nAnalyze the screenshot and determine the next action to complete the task.`;
    message += `\nRespond with valid JSON only.`;

    return message;
  }

  private parseJsonFromText(text: string): unknown {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch {
        // Continue to try other methods
      }
    }

    // Try to parse the whole text as JSON
    try {
      return JSON.parse(text.trim());
    } catch {
      // Try to find JSON object in text
      const objectMatch = text.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try {
          return JSON.parse(objectMatch[0]);
        } catch {
          return null;
        }
      }
    }

    return null;
  }

  getStats() {
    return {
      requestCount: this.requestCount,
      model: this.model,
    };
  }
}

// Available models on OpenRouter with vision support
export const OPENROUTER_VISION_MODELS = [
  { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free)', provider: 'Google' },
  { id: 'google/gemini-pro-vision', name: 'Gemini Pro Vision', provider: 'Google' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', provider: 'Anthropic' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI' },
];
