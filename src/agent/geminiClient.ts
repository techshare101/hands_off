// 🧠 GEMINI INTEGRATION AGENT — Enhanced Gemini Client
// Production-ready client with proper error handling and response validation

import { getPromptForTask, validateGeminiResponse, GeminiResponse, ActionSchema } from './prompts';

// Use Gemini 2.0 Flash - stable and available
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Log model on load
console.log('[Gemini] Using model:', GEMINI_MODEL);

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

export class GeminiClient {
  private apiKey: string | null = null;
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
      const result = await chrome.storage.local.get('geminiApiKey');
      this.apiKey = result.geminiApiKey || null;
      
      // API keys are loaded exclusively from chrome.storage.local (user settings)
    } catch {
      console.warn('[GeminiClient] Failed to load API key from storage');
    }
  }

  async setApiKey(key: string): Promise<void> {
    this.apiKey = key;
    await chrome.storage.local.set({ geminiApiKey: key });
  }

  async hasApiKey(): Promise<boolean> {
    if (!this.apiKey) {
      await this.loadApiKey();
    }
    return !!this.apiKey;
  }

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const startTime = Date.now();

    // Ensure API key is loaded
    if (!this.apiKey) {
      await this.loadApiKey();
      if (!this.apiKey) {
        return { success: false, error: 'API key not configured. Open settings to add your Gemini API key.' };
      }
    }

    // Rate limiting
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await this.sleep(this.minRequestInterval - timeSinceLastRequest);
    }

    try {
      // Prepare image data - strip data URL prefix
      const imageData = request.screenshot.replace(/^data:image\/\w+;base64,/, '');
      const mimeType = request.screenshot.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      
      // Build context
      const systemPrompt = getPromptForTask(request.taskType || 'general');
      const historyContext = this.buildHistoryContext(request.history);
      const pageContext = this.buildPageContext(request.pageUrl, request.pageTitle);

      const userPrompt = `## CURRENT TASK
${request.task}

${pageContext}
${historyContext}

Analyze the screenshot and determine the next action. Respond with valid JSON only.`;

      // Make API request with timeout
      this.abortController = new AbortController();
      const timeoutId = setTimeout(() => this.abortController?.abort(), this.requestTimeout);
      
      const response = await fetch(`${GEMINI_API_ENDPOINT}?key=${this.apiKey}`, {
        signal: this.abortController.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: `${systemPrompt}\n\n${userPrompt}` },
                {
                  inlineData: {
                    mimeType,
                    data: imageData,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            topK: 32,
            topP: 1,
            maxOutputTokens: 2048,
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          ],
        }),
      });

      clearTimeout(timeoutId);
      this.lastRequestTime = Date.now();
      this.requestCount++;

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GeminiClient] API error:', response.status, errorText);
        
        if (response.status === 429) {
          // Retry with exponential backoff for rate limits
          const retryAfter = response.headers.get('Retry-After');
          const baseDelay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
          
          for (let retry = 0; retry < 3; retry++) {
            const delay = baseDelay * Math.pow(2, retry);
            console.log(`[GeminiClient] Rate limited, retrying in ${delay}ms (attempt ${retry + 1}/3)`);
            await this.sleep(delay);
            
            try {
              const retryController = new AbortController();
              const retryTimeoutId = setTimeout(() => retryController.abort(), this.requestTimeout);
              const retryResp = await fetch(`${GEMINI_API_ENDPOINT}?key=${this.apiKey}`, {
                signal: retryController.signal,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ parts: [
                    { text: `${getPromptForTask(request.taskType || 'general')}\n\n${request.task}` },
                    { inlineData: { mimeType: 'image/png', data: request.screenshot.replace(/^data:image\/\w+;base64,/, '') } },
                  ]}],
                  generationConfig: { temperature: 0.1, topK: 32, topP: 1, maxOutputTokens: 2048 },
                  safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                  ],
                }),
              });
              clearTimeout(retryTimeoutId);
              if (retryResp.ok) {
                const retryData = await retryResp.json();
                const retryText = retryData.candidates?.[0]?.content?.parts?.[0]?.text;
                if (retryText) {
                  const parsed = this.parseResponse(retryText);
                  if (parsed) {
                    const validated = validateGeminiResponse(parsed);
                    if (validated) {
                      return { success: true, response: validated, rawText: retryText, latencyMs: Date.now() - startTime };
                    }
                  }
                }
              }
              if (retryResp.status !== 429) break;
            } catch { /* retry failed, continue */ }
          }
          return { success: false, error: 'Rate limit exceeded after retries. Please wait a minute and try again.' };
        }
        if (response.status === 401 || response.status === 403) {
          return { success: false, error: 'Invalid API key. Please check your settings.' };
        }
        return { success: false, error: `API error: ${response.status} — ${errorText.slice(0, 200)}` };
      }

      const data = await response.json();
      const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textContent) {
        return { success: false, error: 'No response from Gemini' };
      }

      // Parse and validate response
      const parsed = this.parseResponse(textContent);
      if (!parsed) {
        // Fallback: if raw text signals task completion, synthesize a valid response
        const completionFallback = this.tryExtractCompletion(textContent);
        if (completionFallback) {
          console.log('[GeminiClient] Parse failed but detected completion signal in raw text');
          return { success: true, response: completionFallback, rawText: textContent, latencyMs: Date.now() - startTime };
        }
        return { 
          success: false, 
          error: 'Invalid response format from Gemini',
          rawText: textContent,
        };
      }

      const validated = validateGeminiResponse(parsed);
      if (!validated) {
        // Fallback: if validation failed but isComplete was present, try to recover
        if ((parsed as Record<string, unknown>).isComplete === true || (parsed as Record<string, unknown>).is_complete === true) {
          console.log('[GeminiClient] Validation failed but isComplete=true, recovering');
          const recovered: GeminiResponse = {
            observation: String((parsed as Record<string, unknown>).observation || 'Task appears complete'),
            reasoning: String((parsed as Record<string, unknown>).reasoning || 'Task completed'),
            action: null,
            confidence: Number((parsed as Record<string, unknown>).confidence) || 0.8,
            requiresApproval: false,
            isComplete: true,
            nextStep: '',
          };
          return { success: true, response: recovered, rawText: textContent, latencyMs: Date.now() - startTime };
        }
        return { 
          success: false, 
          error: 'Response validation failed',
          rawText: textContent,
        };
      }

      return {
        success: true,
        response: validated,
        rawText: textContent,
        latencyMs: Date.now() - startTime,
      };

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('[GeminiClient] Request timed out after', this.requestTimeout, 'ms');
        return {
          success: false,
          error: 'Request timed out. Check your connection.',
          latencyMs: Date.now() - startTime,
        };
      }
      console.error('[GeminiClient] Analysis error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
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

  private buildHistoryContext(history?: ActionSchema[]): string {
    if (!history?.length) return '';
    
    const recentActions = history.slice(-5); // Last 5 actions
    const formatted = recentActions.map((action, i) => {
      return `${i + 1}. ${action.type}${action.target ? ` on "${action.target}"` : ''}`;
    }).join('\n');
    
    return `## PREVIOUS ACTIONS (last ${recentActions.length})
${formatted}`;
  }

  private buildPageContext(url?: string, title?: string): string {
    if (!url && !title) return '';
    
    return `## PAGE CONTEXT
URL: ${url || 'Unknown'}
Title: ${title || 'Unknown'}`;
  }

  private parseResponse(text: string): Record<string, unknown> | null {
    // Strategy 1: Extract from ```json ... ``` or ``` ... ``` code fences
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      const parsed = this.tryParseJSON(fenceMatch[1]);
      if (parsed) return parsed;
    }

    // Strategy 2: Find balanced JSON object(s) and try each
    const candidates = this.extractJSONObjects(text);
    for (const candidate of candidates) {
      const parsed = this.tryParseJSON(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }

    // Strategy 3: Try the entire text as JSON (Gemini sometimes returns bare JSON)
    const directParsed = this.tryParseJSON(text.trim());
    if (directParsed) return directParsed;

    console.error('[GeminiClient] Failed to parse response:', text.slice(0, 500));
    return null;
  }

  private tryParseJSON(text: string): Record<string, unknown> | null {
    try {
      // Strip trailing commas before } or ] (common Gemini mistake)
      const cleaned = text.replace(/,\s*([}\]])/g, '$1');
      const result = JSON.parse(cleaned);
      if (result && typeof result === 'object') return result;
      return null;
    } catch {
      return null;
    }
  }

  private tryExtractCompletion(text: string): GeminiResponse | null {
    const lower = text.toLowerCase();
    const completionSignals = [
      'task is complete',
      'task is done',
      'task has been completed',
      'task completed',
      'successfully completed',
      'i have completed',
      'the task is finished',
      'all done',
      '"iscomplete": true',
      '"iscomplete":true',
      '"is_complete": true',
      '"is_complete":true',
    ];

    const isCompletion = completionSignals.some(signal => lower.includes(signal));
    if (!isCompletion) return null;

    // Extract a summary from the raw text (first meaningful line)
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 10 && !l.startsWith('```') && !l.startsWith('{'));
    const summary = lines[0] || 'Task completed successfully';

    return {
      observation: summary,
      reasoning: 'Task completion detected from response text',
      action: null,
      confidence: 0.8,
      requiresApproval: false,
      isComplete: true,
      nextStep: '',
    };
  }

  private extractJSONObjects(text: string): string[] {
    const results: string[] = [];
    let depth = 0;
    let start = -1;

    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (text[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          results.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStats(): { requestCount: number } {
    return { requestCount: this.requestCount };
  }
}

// Singleton instance
let clientInstance: GeminiClient | null = null;

export function getGeminiClient(): GeminiClient {
  if (!clientInstance) {
    clientInstance = new GeminiClient();
  }
  return clientInstance;
}
