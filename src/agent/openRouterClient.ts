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
      
      // API keys are loaded exclusively from chrome.storage.local (user settings)
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
      
      // Build request body
      const requestBody = JSON.stringify({
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
      });
      
      console.log(`[OpenRouterClient] Request body size: ${Math.round(requestBody.length / 1024)}KB`);
      
      // Create abort controller for timeout (60s for large payloads)
      this.abortController = new AbortController();
      const timeoutId = setTimeout(() => this.abortController?.abort(), 60000);
      
      let response: Response | undefined;
      try {
        response = await fetch(OPENROUTER_API_ENDPOINT, {
          signal: this.abortController.signal,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: requestBody,
        });
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        console.error('[OpenRouterClient] fetch() threw:', fetchErr, 'Type:', typeof fetchErr, 'Name:', (fetchErr as Error)?.name);
        // Retry once without image
        console.log('[OpenRouterClient] Retrying without image...');
        try {
          const retryBody = JSON.stringify({
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage + '\n\n[Note: Screenshot could not be sent. Describe what to do based on the task alone.]' }
            ],
            max_tokens: 2048,
            temperature: 0.1,
          });
          response = await fetch(OPENROUTER_API_ENDPOINT, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: retryBody,
          });
          console.log('[OpenRouterClient] Text-only retry succeeded, status:', response.status);
        } catch (retryErr) {
          console.error('[OpenRouterClient] Text-only retry also failed:', retryErr);
          return {
            success: false,
            error: `Cannot reach OpenRouter API: ${(retryErr as Error)?.message || retryErr}. Check your internet connection.`,
            latencyMs: Date.now() - startTime,
          };
        }
      }
      
      clearTimeout(timeoutId);
      if (!response) {
        return { success: false, error: 'No response received from OpenRouter', latencyMs: Date.now() - startTime };
      }
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
  { id: 'allenai/molmo-2-8b', name: 'Molmo 2 8B (Vision Grounding)', provider: 'AllenAI' },
];

export interface GroundingResult {
  x: number;
  y: number;
  confidence: number;
  raw: string;
  latencyMs: number;
}

/**
 * Vision grounding using Molmo on OpenRouter
 * Returns pixel coordinates for UI elements
 */
export async function groundWithMolmo(
  imageBase64: string,
  targetDescription: string,
  apiKey: string,
  viewportWidth = 1280,
  viewportHeight = 800,
): Promise<GroundingResult | null> {
  const startTime = Date.now();
  const MOLMO_MODEL = 'allenai/molmo-2-8b';

  // Strip data URI prefix if present
  const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const dataUrl = `data:image/png;base64,${cleanBase64}`;

  const prompt = `Point to the "${targetDescription}" element on this webpage screenshot. Return the coordinates as <point x="X" y="Y" alt="${targetDescription}"> where X and Y are percentage positions (0-100) relative to the image dimensions.`;

  try {
    const response = await fetch(OPENROUTER_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://handoff-extension.local',
        'X-Title': 'HandOff Chrome Extension',
      },
      body: JSON.stringify({
        model: MOLMO_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 256,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[OpenRouter] Molmo grounding failed:', response.status, error);
      return null;
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';

    // Parse point tag: <point x="52.3" y="34.1" alt="...">
    const attrMatch = raw.match(/<point\s+x="([\d.]+)"\s+y="([\d.]+)"/i);
    if (attrMatch) {
      const xPct = parseFloat(attrMatch[1]);
      const yPct = parseFloat(attrMatch[2]);
      // Convert percentages to pixels
      const x = Math.round((xPct / 100) * viewportWidth);
      const y = Math.round((yPct / 100) * viewportHeight);
      return { x, y, confidence: 0.92, raw, latencyMs: Date.now() - startTime };
    }

    // Try loose coordinate formats
    const looseMatch = raw.match(/x[:\s=]*(\d+)[,\s]+y[:\s=]*(\d+)/i) ||
                       raw.match(/\((\d+)\s*,\s*(\d+)\)/);
    if (looseMatch) {
      const x = parseInt(looseMatch[1], 10);
      const y = parseInt(looseMatch[2], 10);
      // If values are 0-100, treat as percentages
      if (x <= 100 && y <= 100) {
        return {
          x: Math.round((x / 100) * viewportWidth),
          y: Math.round((y / 100) * viewportHeight),
          confidence: 0.7,
          raw,
          latencyMs: Date.now() - startTime,
        };
      }
      return { x, y, confidence: 0.7, raw, latencyMs: Date.now() - startTime };
    }

    console.warn('[OpenRouter] Could not parse coordinates from Molmo:', raw.slice(0, 200));
    return null;
  } catch (err) {
    console.error('[OpenRouter] Molmo grounding error:', err);
    return null;
  }
}
