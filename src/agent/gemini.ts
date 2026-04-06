const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';

export interface GeminiAction {
  type: 'click' | 'type' | 'scroll' | 'drag' | 'wait' | 'verify';
  x?: number;
  y?: number;
  text?: string;
  target?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
}

export interface GeminiAnalysisRequest {
  screenshot: string;
  task: string;
  history?: GeminiAction[];
}

export interface GeminiAnalysisResponse {
  success: boolean;
  action?: GeminiAction;
  reasoning?: string;
  isComplete?: boolean;
  error?: string;
}

const SYSTEM_PROMPT = `You are a computer-use agent operating inside a Chrome browser.
You can interact with the UI exactly like a human would.

RULES:
1. Always confirm page state before acting
2. Prefer visual landmarks over DOM assumptions
3. Verify each action succeeded before proceeding
4. If uncertain, describe what you see and ask for clarification
5. Log every step with clear reasoning

AVAILABLE ACTIONS:
- click: Click at specific coordinates { type: "click", x: number, y: number, target?: string }
- type: Type text { type: "type", text: string }
- scroll: Scroll the page { type: "scroll", direction: "up" | "down" | "left" | "right" }
- wait: Wait for page to update { type: "wait" }

RESPONSE FORMAT (JSON):
{
  "reasoning": "Brief explanation of what you see and why you're taking this action",
  "action": { ... action object ... } | null,
  "isComplete": boolean
}

If the task is complete, set isComplete to true and action to null.
If you need to take an action, provide the action object and set isComplete to false.`;

export class GeminiClient {
  private apiKey: string | null = null;

  constructor() {
    this.loadApiKey();
  }

  private async loadApiKey() {
    const result = await chrome.storage.local.get('geminiApiKey');
    this.apiKey = result.geminiApiKey || null;
  }

  async setApiKey(key: string) {
    this.apiKey = key;
    await chrome.storage.local.set({ geminiApiKey: key });
  }

  async analyze(request: GeminiAnalysisRequest): Promise<GeminiAnalysisResponse> {
    if (!this.apiKey) {
      await this.loadApiKey();
      if (!this.apiKey) {
        return { success: false, error: 'API key not configured' };
      }
    }

    try {
      const imageData = request.screenshot.replace(/^data:image\/\w+;base64,/, '');
      
      const historyContext = request.history?.length 
        ? `\n\nPrevious actions:\n${request.history.map((a, i) => `${i + 1}. ${JSON.stringify(a)}`).join('\n')}`
        : '';

      const response = await fetch(`${GEMINI_API_ENDPOINT}?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `${SYSTEM_PROMPT}\n\nTASK: ${request.task}${historyContext}\n\nAnalyze the screenshot and determine the next action.`,
                },
                {
                  inlineData: {
                    mimeType: 'image/png',
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
            maxOutputTokens: 1024,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[HandOff] Gemini API error:', errorText);
        return { success: false, error: `API error: ${response.status}` };
      }

      const data = await response.json();
      const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textContent) {
        return { success: false, error: 'No response from Gemini' };
      }

      // Parse JSON response
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { success: false, error: 'Invalid response format' };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        success: true,
        action: parsed.action || undefined,
        reasoning: parsed.reasoning,
        isComplete: parsed.isComplete || false,
      };
    } catch (error) {
      console.error('[HandOff] Gemini analysis error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
}
