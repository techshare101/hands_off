// 🎯 MOLMO VISION — UI element grounding via OpenRouter (Molmo 2)
// Uses Molmo's point-token training to return pixel-precise coordinates
// for UI elements that Gemini's vision may miss or mislocate.
//
// Architecture: Gemini reasons → Molmo grounds → Agent clicks
// Molmo only fires on low-confidence clicks (~10-20% of actions),
// keeping costs near zero during normal operation.

import { groundWithMolmo } from './openRouterClient';

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
  model: 'allenai/molmo-2-8b',
  confidenceThreshold: 0.98, // Gemini self-reports ~0.9 even when wrong; run Molmo on nearly all clicks
  enabled: true,
  maxTokens: 256,
  timeout: 45000,
};

const STORAGE_KEY = 'molmo_vision_config';

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
    const result = await chrome.storage.local.get(['molmo_enabled', 'molmo_openrouter_key']);
    return !!result.molmo_enabled && !!result.molmo_openrouter_key;
  }

  private async getApiKey(): Promise<string | null> {
    const result = await chrome.storage.local.get(['molmo_openrouter_key', 'molmo_enabled']);
    if (!result.molmo_enabled) return null;
    return result.molmo_openrouter_key || null;
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

    const apiKey = await this.getApiKey();
    if (!apiKey) {
      console.warn('[MolmoVision] OpenRouter API key not configured');
      return null;
    }

    const startTime = Date.now();

    const result = await groundWithMolmo(
      screenshotBase64,
      targetDescription,
      apiKey,
      viewportWidth,
      viewportHeight,
    );

    if (!result) {
      this.consecutiveFailures++;
      console.warn(`[MolmoVision] Grounding failed (${this.consecutiveFailures}/${this.maxConsecutiveFailures})`);
      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        this.sessionDisabled = true;
        console.error('[MolmoVision] Too many consecutive failures — disabled for this session. Agent will use Gemini coords only.');
      }
      return null;
    }

    // Reset failure counter on success
    this.consecutiveFailures = 0;
    this.groundingCount++;

    console.log(`[MolmoVision] Grounded "${targetDescription}" → (${result.x}, ${result.y}) via OpenRouter`);
    return {
      x: result.x,
      y: result.y,
      confidence: result.confidence,
      raw: result.raw,
      latencyMs: Date.now() - startTime,
    };
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
