// Tests for MolmoVision — Molmo grounding client via HF Inference API
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock chrome.storage ────────────────────────────────────────────
let storageData: Record<string, unknown> = {};

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

// ── Mock fetch ─────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Mock HF client ─────────────────────────────────────────────────
const mockChatCompletion = vi.fn();
const mockIsEnabled = vi.fn();

vi.mock('../hfClient', () => ({
  getHFClient: () => ({
    init: vi.fn(),
    isEnabled: mockIsEnabled,
    chatCompletionWithImage: mockChatCompletion,
  }),
  HF_MODELS: {
    molmo: 'allenai/Molmo-7B-D-0924',
    objectDetection: 'facebook/detr-resnet-50',
    zeroShotDetection: 'google/owlvit-base-patch32',
    ocr: 'microsoft/trocr-large-printed',
    documentQA: 'impira/layoutlm-document-qa',
    captioning: 'Salesforce/blip-image-captioning-large',
    visualQA: 'dandelin/vilt-b32-finetuned-vqa',
    embeddings: 'BAAI/bge-small-en-v1.5',
    classification: 'facebook/bart-large-mnli',
  },
}));

// Import after mocks
import { molmoVision } from '../molmoVision';

describe('MolmoVision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageData = {};
    mockIsEnabled.mockResolvedValue(true);
  });

  // ── groundElement ─────────────────────────────────────────────

  it('grounds element with point tag format', async () => {
    mockChatCompletion.mockResolvedValue({
      success: true,
      text: '<point x="50.0" y="25.0" alt="search bar">search bar</point>',
      latencyMs: 200,
    });

    const result = await molmoVision.groundElement(
      'base64screenshot',
      'search bar',
      1280,
      800,
    );

    expect(result).not.toBeNull();
    expect(result!.x).toBe(640);  // 50% of 1280
    expect(result!.y).toBe(200);  // 25% of 800
    expect(result!.confidence).toBe(0.95);
  });

  it('grounds element with inner point format', async () => {
    mockChatCompletion.mockResolvedValue({
      success: true,
      text: 'The element is at <point>75, 50</point>.',
      latencyMs: 150,
    });

    const result = await molmoVision.groundElement(
      'base64screenshot',
      'submit button',
      1280,
      800,
    );

    expect(result).not.toBeNull();
    expect(result!.x).toBe(960);  // 75% of 1280
    expect(result!.y).toBe(400);  // 50% of 800
    expect(result!.confidence).toBe(0.95);
  });

  it('falls back to loose coordinate parsing', async () => {
    mockChatCompletion.mockResolvedValue({
      success: true,
      text: 'The element is located at x: 640, y: 400',
      latencyMs: 180,
    });

    const result = await molmoVision.groundElement(
      'base64screenshot',
      'login button',
      1280,
      800,
    );

    expect(result).not.toBeNull();
    expect(result!.x).toBe(640);
    expect(result!.y).toBe(400);
    expect(result!.confidence).toBe(0.7);
  });

  it('parses parenthesized coordinates', async () => {
    mockChatCompletion.mockResolvedValue({
      success: true,
      text: 'Found the button at (320, 240)',
      latencyMs: 100,
    });

    const result = await molmoVision.groundElement(
      'base64screenshot',
      'close button',
      1280,
      800,
    );

    expect(result).not.toBeNull();
    expect(result!.x).toBe(320);
    expect(result!.y).toBe(240);
  });

  it('returns null when no coordinates in response', async () => {
    mockChatCompletion.mockResolvedValue({
      success: true,
      text: 'I cannot find that element on the page.',
      latencyMs: 200,
    });

    const result = await molmoVision.groundElement(
      'base64screenshot',
      'nonexistent button',
      1280,
      800,
    );

    expect(result).toBeNull();
  });

  it('returns null when HF call fails', async () => {
    mockChatCompletion.mockResolvedValue({
      success: false,
      error: 'HF API error 500',
    });

    const result = await molmoVision.groundElement(
      'base64screenshot',
      'search bar',
      1280,
      800,
    );

    expect(result).toBeNull();
  });

  it('returns null when HF is not enabled', async () => {
    mockIsEnabled.mockResolvedValue(false);

    const result = await molmoVision.groundElement(
      'base64screenshot',
      'search bar',
      1280,
      800,
    );

    expect(result).toBeNull();
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
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it('runs Molmo even at high confidence when Gemini reports 0.95 (below 0.98 threshold)', async () => {
    mockChatCompletion.mockResolvedValue({
      success: true,
      text: '<point x="40.0" y="20.0" alt="search bar">search bar</point>',
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
    expect(result.x).toBe(512);  // 40% of 1280
    expect(result.y).toBe(160);  // 20% of 800
    expect(mockChatCompletion).toHaveBeenCalled();
  });

  it('forces Molmo grounding even at max confidence when forceGround is set', async () => {
    mockChatCompletion.mockResolvedValue({
      success: true,
      text: '<point x="50.0" y="50.0" alt="submit">submit</point>',
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
    expect(result.x).toBe(640);  // 50% of 1280
    expect(result.y).toBe(400);  // 50% of 800
    expect(mockChatCompletion).toHaveBeenCalled();
  });

  it('overrides Gemini with Molmo on low confidence', async () => {
    mockChatCompletion.mockResolvedValue({
      success: true,
      text: '<point x="60.0" y="30.0" alt="search bar">search bar</point>',
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
    expect(result.x).toBe(768);  // 60% of 1280
    expect(result.y).toBe(240);  // 30% of 800
  });

  it('falls back to Gemini when Molmo fails', async () => {
    mockChatCompletion.mockResolvedValue({
      success: false,
      error: 'Model loading',
    });

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
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  // ── Stats ─────────────────────────────────────────────────────

  it('tracks grounding stats', () => {
    const stats = molmoVision.getStats();
    expect(stats).toHaveProperty('groundingCount');
    expect(stats).toHaveProperty('overrideCount');
    expect(stats).toHaveProperty('overrideRate');
  });
});
