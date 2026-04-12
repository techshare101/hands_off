// 🤗 HUGGING FACE CLIENT — Inference API integration
// Provides access to HF hosted models for vision, OCR, embeddings, and classification
// Free tier: ~30k tokens/day, Pro: unlimited
// All requests go through https://api-inference.huggingface.co/models/{model}

const HF_API_BASE = 'https://api-inference.huggingface.co/models';
const STORAGE_KEY_TOKEN = 'hf_api_token';
const STORAGE_KEY_ENABLED = 'hf_enabled';

// ── Types ───────────────────────────────────────────────────────────

export interface HFConfig {
  token: string;
  enabled: boolean;
}

export interface HFModelResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  latencyMs?: number;
}

export interface BoundingBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export interface DetectedObject {
  label: string;
  score: number;
  box: BoundingBox;
}

export interface OCRWord {
  text: string;
  score: number;
  box: BoundingBox;
}

export interface EmbeddingResult {
  embedding: number[];
}

export interface ClassificationResult {
  label: string;
  score: number;
}

// ── Default Models ──────────────────────────────────────────────────

export const HF_MODELS = {
  // Object detection — finds UI elements in screenshots
  objectDetection: 'facebook/detr-resnet-50',
  // Zero-shot object detection — finds anything by description
  zeroShotDetection: 'google/owlvit-base-patch32',
  // OCR — reads text from screenshots
  ocr: 'microsoft/trocr-large-printed',
  // Document understanding — structured text + layout
  documentQA: 'impira/layoutlm-document-qa',
  // Image captioning — describes what's on screen
  captioning: 'Salesforce/blip-image-captioning-large',
  // Visual QA — answer questions about screenshots
  visualQA: 'dandelin/vilt-b32-finetuned-vqa',
  // Sentence embeddings — for skill/task matching
  embeddings: 'BAAI/bge-small-en-v1.5',
  // Zero-shot classification — classify pages/tasks
  classification: 'facebook/bart-large-mnli',
  // Vision-language model — UI element grounding (pointing)
  molmo: 'allenai/Molmo-7B-D-0924',
};

// ── HF Inference Client ─────────────────────────────────────────────

class HFInferenceClient {
  private token: string = '';
  private enabled = false;
  private initialized = false;
  private requestCount = 0;
  private lastRequestTime = 0;
  private minRequestInterval = 200; // ms between requests (rate limit)

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY_TOKEN, STORAGE_KEY_ENABLED]);
      this.token = result[STORAGE_KEY_TOKEN] || '';
      this.enabled = result[STORAGE_KEY_ENABLED] === true;
      this.initialized = true;
      console.log(`[HF] Initialized: enabled=${this.enabled}, hasToken=${!!this.token}`);
    } catch {
      this.initialized = true;
    }
  }

  async isEnabled(): Promise<boolean> {
    if (!this.initialized) await this.init();
    return this.enabled && !!this.token;
  }

  async setConfig(config: Partial<HFConfig>): Promise<void> {
    if (config.token !== undefined) this.token = config.token;
    if (config.enabled !== undefined) this.enabled = config.enabled;
    await chrome.storage.local.set({
      [STORAGE_KEY_TOKEN]: this.token,
      [STORAGE_KEY_ENABLED]: this.enabled,
    });
  }

  async getConfig(): Promise<HFConfig> {
    if (!this.initialized) await this.init();
    return { token: this.token, enabled: this.enabled };
  }

  // ── Core Request Method ───────────────────────────────────────────

  private async request(
    model: string,
    body: unknown,
    options: { isBlob?: boolean; timeout?: number } = {}
  ): Promise<HFModelResponse> {
    if (!this.initialized) await this.init();
    if (!this.enabled || !this.token) {
      return { success: false, error: 'HF not enabled or no API token' };
    }

    // Rate limiting
    const now = Date.now();
    const timeSinceLast = now - this.lastRequestTime;
    if (timeSinceLast < this.minRequestInterval) {
      await new Promise(r => setTimeout(r, this.minRequestInterval - timeSinceLast));
    }

    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = options.timeout || 30000;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
      };

      let fetchBody: BodyInit;
      if (body instanceof Blob || body instanceof ArrayBuffer) {
        headers['Content-Type'] = 'application/octet-stream';
        fetchBody = body as BodyInit;
      } else {
        headers['Content-Type'] = 'application/json';
        fetchBody = JSON.stringify(body);
      }

      const response = await fetch(`${HF_API_BASE}/${model}`, {
        method: 'POST',
        headers,
        body: fetchBody,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      this.lastRequestTime = Date.now();
      this.requestCount++;

      if (!response.ok) {
        const errorText = await response.text();
        // Check for model loading state
        if (response.status === 503) {
          const parsed = JSON.parse(errorText);
          if (parsed.estimated_time) {
            console.log(`[HF] Model ${model} loading, ETA: ${parsed.estimated_time}s`);
            return {
              success: false,
              error: `Model loading (ETA: ${Math.ceil(parsed.estimated_time)}s). Try again shortly.`,
              latencyMs: Date.now() - startTime,
            };
          }
        }
        return {
          success: false,
          error: `HF API error ${response.status}: ${errorText.slice(0, 200)}`,
          latencyMs: Date.now() - startTime,
        };
      }

      const data = await response.json();
      return {
        success: true,
        data,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'HF request timed out', latencyMs: Date.now() - startTime };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown HF error',
        latencyMs: Date.now() - startTime,
      };
    }
  }

  // ── Object Detection ──────────────────────────────────────────────
  // Finds UI elements (buttons, inputs, links, images) in screenshots

  async detectObjects(imageBase64: string, model?: string): Promise<{
    success: boolean;
    objects?: DetectedObject[];
    error?: string;
    latencyMs?: number;
  }> {
    const imageData = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const binaryData = this.base64ToBlob(imageData);

    const result = await this.request(model || HF_MODELS.objectDetection, binaryData, { timeout: 20000 });

    if (!result.success) return { success: false, error: result.error, latencyMs: result.latencyMs };

    const objects = (result.data as Array<{ label: string; score: number; box: BoundingBox }>)
      .filter(obj => obj.score > 0.5)
      .map(obj => ({
        label: obj.label,
        score: obj.score,
        box: obj.box,
      }));

    return { success: true, objects, latencyMs: result.latencyMs };
  }

  // ── Zero-Shot Object Detection ────────────────────────────────────
  // Find specific UI elements by description (e.g., "search bar", "submit button")

  async detectByDescription(
    imageBase64: string,
    candidateLabels: string[],
    model?: string
  ): Promise<{
    success: boolean;
    objects?: DetectedObject[];
    error?: string;
    latencyMs?: number;
  }> {
    const imageData = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const result = await this.request(model || HF_MODELS.zeroShotDetection, {
      image: imageData,
      candidate_labels: candidateLabels,
    }, { timeout: 25000 });

    if (!result.success) return { success: false, error: result.error, latencyMs: result.latencyMs };

    // OWL-ViT returns array of detections
    const rawData = result.data as Array<{ label: string; score: number; box: BoundingBox }> | undefined;
    if (!rawData || !Array.isArray(rawData)) {
      return { success: true, objects: [], latencyMs: result.latencyMs };
    }

    const objects = rawData
      .filter(obj => obj.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .map(obj => ({
        label: obj.label,
        score: obj.score,
        box: obj.box,
      }));

    return { success: true, objects, latencyMs: result.latencyMs };
  }

  // ── Image Captioning ──────────────────────────────────────────────
  // Describe what's on the screen

  async captionImage(imageBase64: string): Promise<{
    success: boolean;
    caption?: string;
    error?: string;
    latencyMs?: number;
  }> {
    const imageData = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const binaryData = this.base64ToBlob(imageData);

    const result = await this.request(HF_MODELS.captioning, binaryData, { timeout: 20000 });

    if (!result.success) return { success: false, error: result.error, latencyMs: result.latencyMs };

    const captions = result.data as Array<{ generated_text: string }>;
    return {
      success: true,
      caption: captions?.[0]?.generated_text || '',
      latencyMs: result.latencyMs,
    };
  }

  // ── Visual Question Answering ─────────────────────────────────────
  // Ask questions about what's on screen

  async visualQA(imageBase64: string, question: string): Promise<{
    success: boolean;
    answer?: string;
    score?: number;
    error?: string;
    latencyMs?: number;
  }> {
    const imageData = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const result = await this.request(HF_MODELS.visualQA, {
      image: imageData,
      question,
    }, { timeout: 20000 });

    if (!result.success) return { success: false, error: result.error, latencyMs: result.latencyMs };

    const answers = result.data as Array<{ answer: string; score: number }>;
    const best = answers?.[0];
    return {
      success: true,
      answer: best?.answer || '',
      score: best?.score || 0,
      latencyMs: result.latencyMs,
    };
  }

  // ── Document QA ───────────────────────────────────────────────────
  // Extract specific information from page screenshots

  async documentQA(imageBase64: string, question: string): Promise<{
    success: boolean;
    answer?: string;
    score?: number;
    error?: string;
    latencyMs?: number;
  }> {
    const imageData = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const result = await this.request(HF_MODELS.documentQA, {
      image: imageData,
      question,
    }, { timeout: 20000 });

    if (!result.success) return { success: false, error: result.error, latencyMs: result.latencyMs };

    const answers = result.data as Array<{ answer: string; score: number }>;
    const best = answers?.[0];
    return {
      success: true,
      answer: best?.answer || '',
      score: best?.score || 0,
      latencyMs: result.latencyMs,
    };
  }

  // ── Sentence Embeddings ───────────────────────────────────────────
  // For semantic skill/task matching

  async getEmbedding(text: string, model?: string): Promise<{
    success: boolean;
    embedding?: number[];
    error?: string;
    latencyMs?: number;
  }> {
    const result = await this.request(model || HF_MODELS.embeddings, {
      inputs: text,
    }, { timeout: 10000 });

    if (!result.success) return { success: false, error: result.error, latencyMs: result.latencyMs };

    // BGE returns array directly or nested
    const data = result.data as number[] | number[][];
    const embedding = Array.isArray(data[0]) ? (data as number[][])[0] : data as number[];

    return { success: true, embedding, latencyMs: result.latencyMs };
  }

  // Get embeddings for multiple texts in one call
  async getEmbeddings(texts: string[], model?: string): Promise<{
    success: boolean;
    embeddings?: number[][];
    error?: string;
    latencyMs?: number;
  }> {
    const result = await this.request(model || HF_MODELS.embeddings, {
      inputs: texts,
    }, { timeout: 15000 });

    if (!result.success) return { success: false, error: result.error, latencyMs: result.latencyMs };

    const data = result.data as number[][];
    return { success: true, embeddings: data, latencyMs: result.latencyMs };
  }

  // ── Zero-Shot Classification ──────────────────────────────────────
  // Classify text into categories without training

  async classify(
    text: string,
    candidateLabels: string[],
    multiLabel = false
  ): Promise<{
    success: boolean;
    classifications?: ClassificationResult[];
    error?: string;
    latencyMs?: number;
  }> {
    const result = await this.request(HF_MODELS.classification, {
      inputs: text,
      parameters: {
        candidate_labels: candidateLabels,
        multi_label: multiLabel,
      },
    }, { timeout: 15000 });

    if (!result.success) return { success: false, error: result.error, latencyMs: result.latencyMs };

    const data = result.data as { labels: string[]; scores: number[] };
    const classifications = data.labels.map((label, i) => ({
      label,
      score: data.scores[i],
    }));

    return { success: true, classifications, latencyMs: result.latencyMs };
  }

  // ── Utility ───────────────────────────────────────────────────────

  private base64ToBlob(base64: string): Blob {
    const byteChars = atob(base64);
    const byteArrays = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArrays[i] = byteChars.charCodeAt(i);
    }
    return new Blob([byteArrays], { type: 'image/png' });
  }

  // ── Chat Completion with Image (VLM) ─────────────────────────────
  // Uses HF's OpenAI-compatible /v1/chat/completions endpoint
  // Works with Molmo, LLaVA, and other vision-language models

  async chatCompletionWithImage(
    prompt: string,
    imageBase64: string,
    options: { model?: string; maxTokens?: number; temperature?: number; timeout?: number } = {}
  ): Promise<{
    success: boolean;
    text?: string;
    error?: string;
    latencyMs?: number;
  }> {
    if (!this.initialized) await this.init();
    if (!this.enabled || !this.token) {
      return { success: false, error: 'HF not enabled or no API token' };
    }

    const model = options.model || HF_MODELS.molmo;
    const startTime = Date.now();

    // Rate limiting
    const now = Date.now();
    const timeSinceLast = now - this.lastRequestTime;
    if (timeSinceLast < this.minRequestInterval) {
      await new Promise(r => setTimeout(r, this.minRequestInterval - timeSinceLast));
    }

    // Strip data URI prefix if present
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const body = {
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${cleanBase64}` } },
          { type: 'text', text: prompt },
        ],
      }],
      max_tokens: options.maxTokens || 256,
      temperature: options.temperature ?? 0.1,
    };

    // Retry loop for HF cold starts (503)
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = options.timeout || 60000;
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(
          `https://api-inference.huggingface.co/models/${model}/v1/chat/completions`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );

        clearTimeout(timeoutId);
        this.lastRequestTime = Date.now();
        this.requestCount++;

        if (response.status === 503) {
          // Model is loading — wait and retry
          const waitMs = attempt * 3000;
          console.log(`[HF] Model ${model} loading, retry ${attempt}/${maxAttempts} in ${waitMs}ms`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        if (!response.ok) {
          const errText = await response.text();
          return {
            success: false,
            error: `HF chat API ${response.status}: ${errText.slice(0, 200)}`,
            latencyMs: Date.now() - startTime,
          };
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';

        return {
          success: true,
          text,
          latencyMs: Date.now() - startTime,
        };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return { success: false, error: 'HF chat request timed out', latencyMs: Date.now() - startTime };
        }
        if (attempt === maxAttempts) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'HF chat completion failed',
            latencyMs: Date.now() - startTime,
          };
        }
        await new Promise(r => setTimeout(r, attempt * 2000));
      }
    }

    return { success: false, error: 'HF chat completion failed after retries', latencyMs: Date.now() - startTime };
  }

  getStats(): { requestCount: number; lastRequestTime: number; enabled: boolean; hasToken: boolean } {
    return {
      requestCount: this.requestCount,
      lastRequestTime: this.lastRequestTime,
      enabled: this.enabled,
      hasToken: !!this.token,
    };
  }
}

// Singleton
let hfInstance: HFInferenceClient | null = null;

export function getHFClient(): HFInferenceClient {
  if (!hfInstance) {
    hfInstance = new HFInferenceClient();
  }
  return hfInstance;
}

export { HFInferenceClient };
