// Tests for MolmoVision — Molmo grounding client via OpenRouter
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock chrome.storage ────────────────────────────────────────────
let storageData: Record<string, unknown> = {
  openRouterApiKey: 'sk-or-test-key', // Default: OpenRouter enabled
};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const result: Record<string, unknown> = {};
        const keyArr = Array.isArray(keys) ? keys : [keys];
        for (const k of keyArr) {
          if (storageData[k] !== undefined) result[k] = storageData[k];
        }
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(storageData, items);
      }),
    },
  },
});

// ── Mock OpenRouter client ─────────────────────────────────────────
const mockGroundWithMolmo = vi.fn();

vi.mock('../openRouterClient', () => ({
  groundWithMolmo: (...args: unknown[]) => mockGroundWithMolmo(...args),
}));

// Import after mocks
import { molmoVision } from '../molmoVision';

describe('MolmoVision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageData = { openRouterApiKey: 'sk-or-test-key' };
    molmoVision.resetSession();
  });

  // ── groundElement ─────────────────────────────────────────────

  it('grounds element with point tag format', async () => {
    mockGroundWithMolmo.mockResolvedValue({
      x: 640,
      y: 200,
      confidence: 0.92,
      raw: '<point x="50.0" y="25.0" alt="search bar">search bar</point>',
      latencyMs: 200,
    });

    const result = await molmoVision.groundElement(
      'base64screenshot',
      'search bar',
      1280,
      800,
    );

    expect(result).not.toBeNull();
    expect(result!.x).toBe(640);
    expect(result!.y).toBe(200);
    expect(result!.confidence).toBe(0.92);
    expect(mockGroundWithMolmo).toHaveBeenCalledWith(
      'base64screenshot',
      'search bar',
      'sk-or-test-key',
      1280,
      800,
    );
  });

  it('returns null when OpenRouter call fails', async () => {
    mockGroundWithMolmo.mockResolvedValue(null);

    const result = await molmoVision.groundElement(
      'base64screenshot',
      'search bar',
      1280,
      800,
    );

    expect(result).toBeNull();
  });

  it('returns null when OpenRouter API key is not configured', async () => {
    storageData = {}; // No API key

    const result = await molmoVision.groundElement(
      'base64screenshot',
      'search bar',
      1280,
      800,
    );

    expect(result).toBeNull();
    expect(mockGroundWithMolmo).not.toHaveBeenCalled();
  });

  // ── resolveClickTarget ────────────────────────────────────────

  it('skips Molmo when Gemini confidence exceeds threshold (0.98)', async () => {
    const result = await molmoVision.resolveClickTarget(
      { x: 100, y: 200, confidence: 0.99, target: 'button' },
      'base64screenshot',
    );

    expect(result.source).toBe('gemini');
    expect(result.overridden).toBe(false);
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
    expect(mockGroundWithMolmo).not.toHaveBeenCalled();
  });

  it('runs Molmo even at high confidence when Gemini reports 0.95 (below 0.98 threshold)', async () => {
    mockGroundWithMolmo.mockResolvedValue({
      x: 512,
      y: 160,
      confidence: 0.92,
      raw: '<point x="40.0" y="20.0" alt="search bar">search bar</point>',
      latencyMs: 200,
    });

    const result = await molmoVision.resolveClickTarget(
      { x: 100, y: 200, confidence: 0.95, target: 'search bar' },
      'base64screenshot',
      1280,
      800,
    );

    expect(result.source).toBe('molmo');
    expect(result.overridden).toBe(true);
    expect(result.x).toBe(512);
    expect(result.y).toBe(160);
    expect(mockGroundWithMolmo).toHaveBeenCalled();
  });

  it('forces Molmo grounding even at max confidence when forceGround is set', async () => {
    mockGroundWithMolmo.mockResolvedValue({
      x: 640,
      y: 400,
      confidence: 0.92,
      raw: '<point x="50.0" y="50.0" alt="submit">submit</point>',
      latencyMs: 200,
    });

    const result = await molmoVision.resolveClickTarget(
      { x: 100, y: 200, confidence: 0.99, target: 'submit button' },
      'base64screenshot',
      1280,
      800,
      { forceGround: true },
    );

    expect(result.source).toBe('molmo');
    expect(result.overridden).toBe(true);
    expect(result.x).toBe(640);
    expect(result.y).toBe(400);
    expect(mockGroundWithMolmo).toHaveBeenCalled();
  });

  it('overrides Gemini with Molmo on low confidence', async () => {
    mockGroundWithMolmo.mockResolvedValue({
      x: 768,
      y: 240,
      confidence: 0.92,
      raw: '<point x="60.0" y="30.0" alt="search bar">search bar</point>',
      latencyMs: 250,
    });

    const result = await molmoVision.resolveClickTarget(
      { x: 100, y: 200, confidence: 0.5, target: 'search bar' },
      'base64screenshot',
      1280,
      800,
    );

    expect(result.source).toBe('molmo');
    expect(result.overridden).toBe(true);
    expect(result.x).toBe(768);
    expect(result.y).toBe(240);
  });

  it('falls back to Gemini when Molmo fails', async () => {
    mockGroundWithMolmo.mockResolvedValue(null);

    const result = await molmoVision.resolveClickTarget(
      { x: 100, y: 200, confidence: 0.5, target: 'search bar' },
      'base64screenshot',
    );

    expect(result.source).toBe('gemini');
    expect(result.overridden).toBe(false);
    expect(result.x).toBe(100);
  });

  it('skips Molmo when no target description even with forceGround', async () => {
    const result = await molmoVision.resolveClickTarget(
      { x: 100, y: 200, confidence: 0.3 },
      'base64screenshot',
      1280, 800,
      { forceGround: true },
    );

    expect(result.source).toBe('gemini');
    expect(result.overridden).toBe(false);
    expect(mockGroundWithMolmo).not.toHaveBeenCalled();
  });

  // ── Stats ─────────────────────────────────────────────────────

  it('tracks grounding stats', () => {
    const stats = molmoVision.getStats();
    expect(stats).toHaveProperty('groundingCount');
    expect(stats).toHaveProperty('overrideCount');
    expect(stats).toHaveProperty('overrideRate');
  });
});
