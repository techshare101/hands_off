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
  confidenceThreshold: 0.98, // Gemini self-reports ~0.9 even when wrong; run Molmo on nearly all clicks
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
  private consecutiveFailures = 0;
  private readonly maxConsecutiveFailures = 3;
  private sessionDisabled = false;

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
      this.consecutiveFailures++;
      console.warn(`[MolmoVision] Grounding failed (${this.consecutiveFailures}/${this.maxConsecutiveFailures}):`, result.error);
      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        this.sessionDisabled = true;
        console.error('[MolmoVision] Too many consecutive failures — disabled for this session. Agent will use Gemini coords only.');
      }
      return null;
    }

    // Reset failure counter on success
    this.consecutiveFailures = 0;
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
    options: { forceGround?: boolean } = {},
  ): Promise<{ x: number; y: number; source: 'gemini' | 'molmo'; overridden: boolean }> {
    // No target description → can't ground anything
    if (!geminiTarget.target) {
      console.log('[MolmoVision] Skip: no target description');
      return { x: geminiTarget.x, y: geminiTarget.y, source: 'gemini', overridden: false };
    }

    // Circuit breaker: too many consecutive failures → stop calling Molmo
    if (this.sessionDisabled) {
      console.log('[MolmoVision] Skip: session disabled after repeated failures');
      return { x: geminiTarget.x, y: geminiTarget.y, source: 'gemini', overridden: false };
    }

    if (!this.initialized) await this.init();

    // Skip only when confidence truly exceeds threshold AND not forced
    if (!options.forceGround && geminiTarget.confidence >= this.config.confidenceThreshold) {
      console.log(`[MolmoVision] Skip: confidence ${Math.round(geminiTarget.confidence * 100)}% >= ${Math.round(this.config.confidenceThreshold * 100)}% threshold`);
      return { x: geminiTarget.x, y: geminiTarget.y, source: 'gemini', overridden: false };
    }

    if (options.forceGround) {
      console.log(`[MolmoVision] FORCE grounding for "${geminiTarget.target}" (stuck-click recovery)`);
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

  // ── Session Management ──────────────────────────────────────────

  resetSession(): void {
    this.consecutiveFailures = 0;
    this.sessionDisabled = false;
    console.log('[MolmoVision] Session reset — circuit breaker cleared');
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
