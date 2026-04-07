// 👁️ HF VISION PIPELINE — Screenshot analysis using Hugging Face models
// Runs object detection + zero-shot detection on screenshots to find UI elements
// Results are injected as high-confidence hints into the LLM prompt
// This gives the agent "structured eyes" instead of just raw pixel guessing

import { getHFClient, DetectedObject, BoundingBox } from './hfClient';

// ── Types ───────────────────────────────────────────────────────────

export interface UIElement {
  type: 'button' | 'input' | 'link' | 'dropdown' | 'checkbox' | 'text' | 'icon' | 'image' | 'unknown';
  label: string;
  confidence: number;
  x: number; // center x in pixels
  y: number; // center y in pixels
  width: number;
  height: number;
  box: BoundingBox;
}

export interface PageAnalysis {
  elements: UIElement[];
  caption?: string;
  searchBar?: UIElement;
  primaryButton?: UIElement;
  inputFields: UIElement[];
  clickableElements: UIElement[];
  latencyMs: number;
}

// ── UI Element Labels ───────────────────────────────────────────────
// Used for zero-shot detection — describe what we're looking for

const UI_ELEMENT_QUERIES = [
  'search bar',
  'text input field',
  'submit button',
  'navigation menu',
  'dropdown menu',
  'close button',
  'login button',
  'link',
  'checkbox',
  'price filter',
  'date picker',
];

// Map DETR COCO labels to UI element types
const COCO_TO_UI: Record<string, UIElement['type']> = {
  'keyboard': 'input',
  'remote': 'button',
  'cell phone': 'button',
  'laptop': 'unknown',
  'mouse': 'unknown',
  'tv': 'unknown',
  'book': 'text',
};

// Map zero-shot labels to UI types
const LABEL_TO_UI_TYPE: Record<string, UIElement['type']> = {
  'search bar': 'input',
  'text input field': 'input',
  'submit button': 'button',
  'navigation menu': 'link',
  'dropdown menu': 'dropdown',
  'close button': 'button',
  'login button': 'button',
  'link': 'link',
  'checkbox': 'checkbox',
  'price filter': 'input',
  'date picker': 'input',
};

// ── Vision Pipeline ─────────────────────────────────────────────────

class HFVisionPipeline {
  private lastAnalysis: PageAnalysis | null = null;
  private analysisCache: Map<string, { analysis: PageAnalysis; timestamp: number }> = new Map();
  private cacheMaxAge = 5000; // 5s cache — pages change

  // Full page analysis: object detection + zero-shot + captioning
  async analyzePage(
    screenshotBase64: string,
    options: {
      detectObjects?: boolean;
      zeroShotDetect?: boolean;
      caption?: boolean;
      targetElements?: string[]; // custom zero-shot queries
    } = {}
  ): Promise<PageAnalysis> {
    const hf = getHFClient();
    const enabled = await hf.isEnabled();
    if (!enabled) {
      return { elements: [], inputFields: [], clickableElements: [], latencyMs: 0 };
    }

    const startTime = Date.now();

    // Check cache
    const cacheKey = screenshotBase64.slice(-100); // use tail as key
    const cached = this.analysisCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheMaxAge) {
      return cached.analysis;
    }

    const {
      detectObjects = true,
      zeroShotDetect = true,
      caption = false,
      targetElements,
    } = options;

    const elements: UIElement[] = [];
    let captionText: string | undefined;

    // Run detection pipelines in parallel
    const promises: Promise<void>[] = [];

    // 1. General object detection (DETR)
    if (detectObjects) {
      promises.push(
        hf.detectObjects(screenshotBase64).then(result => {
          if (result.success && result.objects) {
            for (const obj of result.objects) {
              const uiType = COCO_TO_UI[obj.label] || 'unknown';
              // Only include if it maps to a useful UI type
              if (uiType !== 'unknown') {
                elements.push(this.objectToUIElement(obj, uiType));
              }
            }
          }
        }).catch(e => console.warn('[HFVision] Object detection failed:', e))
      );
    }

    // 2. Zero-shot detection (OWL-ViT) — find specific UI elements
    if (zeroShotDetect) {
      const queries = targetElements || UI_ELEMENT_QUERIES;
      promises.push(
        hf.detectByDescription(screenshotBase64, queries).then(result => {
          if (result.success && result.objects) {
            for (const obj of result.objects) {
              const uiType = LABEL_TO_UI_TYPE[obj.label] || 'unknown';
              elements.push(this.objectToUIElement(obj, uiType));
            }
          }
        }).catch(e => console.warn('[HFVision] Zero-shot detection failed:', e))
      );
    }

    // 3. Image captioning
    if (caption) {
      promises.push(
        hf.captionImage(screenshotBase64).then(result => {
          if (result.success) captionText = result.caption;
        }).catch(e => console.warn('[HFVision] Captioning failed:', e))
      );
    }

    await Promise.allSettled(promises);

    // Deduplicate overlapping elements
    const deduped = this.deduplicateElements(elements);

    // Classify elements
    const searchBar = deduped.find(e => e.type === 'input' && e.label.toLowerCase().includes('search'));
    const primaryButton = deduped.find(e => e.type === 'button' && e.confidence > 0.5);
    const inputFields = deduped.filter(e => e.type === 'input');
    const clickableElements = deduped.filter(e =>
      e.type === 'button' || e.type === 'link' || e.type === 'checkbox' || e.type === 'dropdown'
    );

    const analysis: PageAnalysis = {
      elements: deduped,
      caption: captionText,
      searchBar,
      primaryButton,
      inputFields,
      clickableElements,
      latencyMs: Date.now() - startTime,
    };

    // Cache it
    this.analysisCache.set(cacheKey, { analysis, timestamp: Date.now() });
    this.lastAnalysis = analysis;

    console.log(`[HFVision] Found ${deduped.length} elements in ${analysis.latencyMs}ms`);
    return analysis;
  }

  // Quick search bar detection — faster, single model call
  async findSearchBar(screenshotBase64: string): Promise<UIElement | null> {
    const hf = getHFClient();
    const enabled = await hf.isEnabled();
    if (!enabled) return null;

    const result = await hf.detectByDescription(screenshotBase64, [
      'search bar',
      'search input',
      'text input field',
    ]);

    if (!result.success || !result.objects?.length) return null;

    const best = result.objects[0];
    return this.objectToUIElement(best, 'input');
  }

  // Ask a question about the current page
  async askAboutPage(screenshotBase64: string, question: string): Promise<string | null> {
    const hf = getHFClient();
    const enabled = await hf.isEnabled();
    if (!enabled) return null;

    const result = await hf.visualQA(screenshotBase64, question);
    return result.success ? (result.answer || null) : null;
  }

  // Classify the current page type
  async classifyPage(screenshotBase64: string): Promise<string | null> {
    const hf = getHFClient();
    const enabled = await hf.isEnabled();
    if (!enabled) return null;

    // Get a caption first, then classify it
    const captionResult = await hf.captionImage(screenshotBase64);
    if (!captionResult.success || !captionResult.caption) return null;

    const classResult = await hf.classify(captionResult.caption, [
      'search page',
      'form page',
      'results page',
      'article page',
      'login page',
      'error page',
      'home page',
      'settings page',
      'dashboard',
    ]);

    if (!classResult.success || !classResult.classifications?.length) return null;
    return classResult.classifications[0].label;
  }

  // ── Format for LLM Prompt ─────────────────────────────────────────
  // Convert analysis into text hints that get injected into the LLM prompt

  formatAsPromptHints(analysis: PageAnalysis): string {
    if (analysis.elements.length === 0) return '';

    let hints = '\n\n## HF VISION DETECTION (high-confidence element locations)\n';

    // Highlight search bar if found
    if (analysis.searchBar) {
      const sb = analysis.searchBar;
      hints += `🔍 **SEARCH BAR DETECTED** at center (${sb.x}, ${sb.y}) — Click here, then type your query, then press Enter\n`;
    }

    // List input fields
    if (analysis.inputFields.length > 0) {
      hints += `\n**Input Fields:**\n`;
      for (const el of analysis.inputFields.slice(0, 5)) {
        hints += `  - "${el.label}" at (${el.x}, ${el.y}) [${Math.round(el.confidence * 100)}% confidence]\n`;
      }
    }

    // List clickable elements
    if (analysis.clickableElements.length > 0) {
      hints += `\n**Clickable Elements:**\n`;
      for (const el of analysis.clickableElements.slice(0, 8)) {
        hints += `  - ${el.type.toUpperCase()}: "${el.label}" at (${el.x}, ${el.y}) [${Math.round(el.confidence * 100)}% confidence]\n`;
      }
    }

    // Primary action button
    if (analysis.primaryButton) {
      const pb = analysis.primaryButton;
      hints += `\n⚡ **PRIMARY BUTTON**: "${pb.label}" at (${pb.x}, ${pb.y})\n`;
    }

    // Caption
    if (analysis.caption) {
      hints += `\n**Page Description**: ${analysis.caption}\n`;
    }

    hints += `\n_Use these coordinates with HIGH confidence — they come from vision AI, not guessing._\n`;

    return hints;
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private objectToUIElement(obj: DetectedObject, type: UIElement['type']): UIElement {
    const box = obj.box;
    return {
      type,
      label: obj.label,
      confidence: obj.score,
      x: Math.round((box.xmin + box.xmax) / 2),
      y: Math.round((box.ymin + box.ymax) / 2),
      width: Math.round(box.xmax - box.xmin),
      height: Math.round(box.ymax - box.ymin),
      box,
    };
  }

  private deduplicateElements(elements: UIElement[]): UIElement[] {
    const result: UIElement[] = [];

    for (const el of elements) {
      // Check if overlaps with existing element
      const overlapping = result.find(existing => this.iou(existing.box, el.box) > 0.5);
      if (overlapping) {
        // Keep the higher confidence one
        if (el.confidence > overlapping.confidence) {
          const idx = result.indexOf(overlapping);
          result[idx] = el;
        }
      } else {
        result.push(el);
      }
    }

    return result.sort((a, b) => b.confidence - a.confidence);
  }

  // Intersection over Union — measures box overlap
  private iou(a: BoundingBox, b: BoundingBox): number {
    const xOverlap = Math.max(0, Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin));
    const yOverlap = Math.max(0, Math.min(a.ymax, b.ymax) - Math.max(a.ymin, b.ymin));
    const intersection = xOverlap * yOverlap;

    const areaA = (a.xmax - a.xmin) * (a.ymax - a.ymin);
    const areaB = (b.xmax - b.xmin) * (b.ymax - b.ymin);
    const union = areaA + areaB - intersection;

    return union > 0 ? intersection / union : 0;
  }

  getLastAnalysis(): PageAnalysis | null {
    return this.lastAnalysis;
  }

  clearCache(): void {
    this.analysisCache.clear();
    this.lastAnalysis = null;
  }
}

// Singleton
export const hfVision = new HFVisionPipeline();
