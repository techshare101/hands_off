// 🎯 MOLMO VISION — UI element grounding via Hugging Face Inference API
// Uses Molmo's point-token training to return pixel-precise coordinates
// for UI elements that Gemini's vision may miss or mislocate.
//
// Architecture: Gemini reasons → Molmo grounds → Agent clicks
// Molmo only fires on low-confidence clicks (~10-20% of actions),
// keeping HF costs near zero during normal operation.

import { getHFClient, HF_MODELS } from './hfClient';

// ── Types ───────────────────────────────────────────────────────────

export interface GroundingResult {
  x: number;
  y: number;
  confidence: number;
  raw: string;
  latencyMs: number;
}

export interface MolmoConfig {
  model: string;
  confidenceThreshold: number; // Below this, Molmo overrides Gemini
  enabled: boolean;
  maxTokens: number;
  timeout: number;
}

const DEFAULT_CONFIG: MolmoConfig = {
  model: HF_MODELS.molmo,
  confidenceThreshold: 0.85,
  enabled: true,
  maxTokens: 256,
  timeout: 45000,
};

const STORAGE_KEY = 'molmo_vision_config';

// ── Coordinate Parsers ──────────────────────────────────────────────
// Molmo outputs coordinates in several possible formats depending on
// the model version and prompt. We handle all known variants.

function parsePointTag(raw: string): { x: number; y: number } | null {
  // Format: <point x="52.3" y="34.1" alt="...">...</point>
  const attrMatch = raw.match(/<point\s+x="([\d.]+)"\s+y="([\d.]+)"/i);
  if (attrMatch) {
    return { x: parseFloat(attrMatch[1]), y: parseFloat(attrMatch[2]) };
  }

  // Format: <point>52.3, 34.1</point>
  const innerMatch = raw.match(/<point>\s*([\d.]+)\s*,\s*([\d.]+)\s*<\/point>/i);
  if (innerMatch) {
    return { x: parseFloat(innerMatch[1]), y: parseFloat(innerMatch[2]) };
  }

  return null;
}

function parseLooseCoords(raw: string): { x: number; y: number } | null {
  // Format: "x: 123, y: 456" or "(123, 456)" or "x=123 y=456"
  const patterns = [
    /x[:\s=]*(\d+)[,\s]+y[:\s=]*(\d+)/i,
    /\((\d+)\s*,\s*(\d+)\)/,
    /coordinates?[:\s]*(\d+)\s*,\s*(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
    }
  }

  return null;
}

// Molmo outputs percentages (0-100) of image dimensions.
// Convert to pixel coordinates given the viewport size.
function percentToPixels(
  point: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  // If values are 0-100, treat as percentages
  if (point.x <= 100 && point.y <= 100) {
    return {
      x: Math.round((point.x / 100) * viewportWidth),
      y: Math.round((point.y / 100) * viewportHeight),
    };
  }
  // Already pixel values
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

// ── Molmo Vision Client ─────────────────────────────────────────────

class MolmoVisionClient {
  private config: MolmoConfig = { ...DEFAULT_CONFIG };
  private initialized = false;
  private groundingCount = 0;
  private overrideCount = 0;

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      if (stored[STORAGE_KEY]) {
        this.config = { ...DEFAULT_CONFIG, ...stored[STORAGE_KEY] };
      }
      this.initialized = true;
    } catch {
      this.initialized = true;
    }
  }

  async setConfig(config: Partial<MolmoConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    await chrome.storage.local.set({ [STORAGE_KEY]: this.config });
  }

  async getConfig(): Promise<MolmoConfig> {
    if (!this.initialized) await this.init();
    return { ...this.config };
  }

  async isEnabled(): Promise<boolean> {
    if (!this.initialized) await this.init();
    if (!this.config.enabled) return false;
    const hf = getHFClient();
    return hf.isEnabled();
  }

  // ── Core Grounding Method ───────────────────────────────────────

  async groundElement(
    screenshotBase64: string,
    targetDescription: string,
    viewportWidth = 1280,
    viewportHeight = 800,
  ): Promise<GroundingResult | null> {
    if (!this.initialized) await this.init();
    if (!this.config.enabled) return null;

    const hf = getHFClient();
    const enabled = await hf.isEnabled();
    if (!enabled) return null;

    const prompt =
      `Point to the "${targetDescription}" element on this webpage screenshot. ` +
      `Return the coordinates as <point x="X" y="Y" alt="${targetDescription}">` +
      `where X and Y are percentage positions (0-100) relative to the image dimensions.`;

    const startTime = Date.now();

    const result = await hf.chatCompletionWithImage(prompt, screenshotBase64, {
      model: this.config.model,
      maxTokens: this.config.maxTokens,
      temperature: 0.1,
      timeout: this.config.timeout,
    });

    if (!result.success || !result.text) {
      console.warn('[MolmoVision] Grounding failed:', result.error);
      return null;
    }

    const raw = result.text;
    this.groundingCount++;

    // Try structured point tag first (highest confidence)
    const pointTag = parsePointTag(raw);
    if (pointTag) {
      const px = percentToPixels(pointTag, viewportWidth, viewportHeight);
      console.log(`[MolmoVision] Grounded "${targetDescription}" → (${px.x}, ${px.y}) from point tag`);
      return { ...px, confidence: 0.95, raw, latencyMs: Date.now() - startTime };
    }

    // Try loose coordinate formats (lower confidence)
    const loose = parseLooseCoords(raw);
    if (loose) {
      const px = percentToPixels(loose, viewportWidth, viewportHeight);
      console.log(`[MolmoVision] Grounded "${targetDescription}" → (${px.x}, ${px.y}) from loose coords`);
      return { ...px, confidence: 0.7, raw, latencyMs: Date.now() - startTime };
    }

    console.warn(`[MolmoVision] Could not parse coordinates from: ${raw.slice(0, 200)}`);
    return null;
  }

  // ── Click Target Resolution ─────────────────────────────────────
  // The main integration point: decides whether to override Gemini's
  // click coordinates with Molmo's grounded coordinates.

  async resolveClickTarget(
    geminiTarget: { x: number; y: number; confidence: number; target?: string },
    screenshotBase64: string,
    viewportWidth = 1280,
    viewportHeight = 800,
  ): Promise<{ x: number; y: number; source: 'gemini' | 'molmo'; overridden: boolean }> {
    // Fast path: skip ALL async work when confidence is high or no target
    if (!geminiTarget.target || geminiTarget.confidence >= (this.initialized ? this.config.confidenceThreshold : DEFAULT_CONFIG.confidenceThreshold)) {
      return { x: geminiTarget.x, y: geminiTarget.y, source: 'gemini', overridden: false };
    }

    if (!this.initialized) await this.init();

    // Re-check threshold after init (config may differ from default)
    if (geminiTarget.confidence >= this.config.confidenceThreshold) {
      return { x: geminiTarget.x, y: geminiTarget.y, source: 'gemini', overridden: false };
    }

    // Try Molmo grounding
    const grounding = await this.groundElement(
      screenshotBase64,
      geminiTarget.target,
      viewportWidth,
      viewportHeight,
    );

    if (grounding && grounding.confidence > 0.5) {
      this.overrideCount++;
      console.log(
        `[MolmoVision] Override: Gemini (${geminiTarget.x},${geminiTarget.y}) @ ${Math.round(geminiTarget.confidence * 100)}% → ` +
        `Molmo (${grounding.x},${grounding.y}) @ ${Math.round(grounding.confidence * 100)}% for "${geminiTarget.target}"`,
      );
      return { x: grounding.x, y: grounding.y, source: 'molmo', overridden: true };
    }

    // Molmo failed → fall back to Gemini
    return { x: geminiTarget.x, y: geminiTarget.y, source: 'gemini', overridden: false };
  }

  // ── Stats ──────────────────────────────────────────────────────

  getStats(): { groundingCount: number; overrideCount: number; overrideRate: number } {
    return {
      groundingCount: this.groundingCount,
      overrideCount: this.overrideCount,
      overrideRate: this.groundingCount > 0 ? this.overrideCount / this.groundingCount : 0,
    };
  }
}

// Singleton
export const molmoVision = new MolmoVisionClient();
