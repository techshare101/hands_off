// 🧠 HF EMBEDDINGS — Semantic skill/task matching via sentence embeddings
// Uses BAAI/bge-small-en-v1.5 to compute similarity between tasks and learned skills
// Replaces keyword-based matching with semantic understanding:
//   "Find flights to LA" ↔ "Search flights NYC to Los Angeles" → high similarity
//   "Book a hotel" ↔ "Search flights" → low similarity

import { getHFClient } from './hfClient';

// ── Types ───────────────────────────────────────────────────────────

export interface SemanticMatch {
  id: string;
  text: string;
  similarity: number; // -1.0 to 1.0 (cosine similarity)
}

// ── Embedding Cache ─────────────────────────────────────────────────

const CACHE_KEY = 'hf_embedding_cache';
const MAX_CACHE_SIZE = 200;

interface CachedEmbedding {
  text: string;
  embedding: number[];
  createdAt: number;
}

// ── Semantic Matching Service ───────────────────────────────────────

class SemanticMatcher {
  private cache: Map<string, CachedEmbedding> = new Map();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const result = await chrome.storage.local.get(CACHE_KEY);
      const saved: CachedEmbedding[] = result[CACHE_KEY] || [];
      saved.forEach(e => this.cache.set(e.text, e));
      this.initialized = true;
      console.log(`[HFEmbed] Loaded ${this.cache.size} cached embeddings`);
    } catch {
      this.initialized = true;
    }
  }

  private async persistCache(): Promise<void> {
    const entries = Array.from(this.cache.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_CACHE_SIZE);
    await chrome.storage.local.set({ [CACHE_KEY]: entries });
  }

  // ── Core Embedding ────────────────────────────────────────────────

  async getEmbedding(text: string): Promise<number[] | null> {
    await this.init();

    // Normalize text for cache lookup
    const normalized = text.toLowerCase().trim();

    // Check cache
    const cached = this.cache.get(normalized);
    if (cached) return cached.embedding;

    // Fetch from HF
    const hf = getHFClient();
    const enabled = await hf.isEnabled();
    if (!enabled) return null;

    const result = await hf.getEmbedding(normalized);
    if (!result.success || !result.embedding) return null;

    // Cache it
    this.cache.set(normalized, {
      text: normalized,
      embedding: result.embedding,
      createdAt: Date.now(),
    });

    // Persist periodically (every 10 new embeddings)
    if (this.cache.size % 10 === 0) {
      await this.persistCache();
    }

    return result.embedding;
  }

  // ── Similarity Computation ────────────────────────────────────────

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator > 0 ? dotProduct / denominator : 0;
  }

  // ── Semantic Search ───────────────────────────────────────────────
  // Find the best matches for a query among a set of candidates

  async findBestMatches(
    query: string,
    candidates: Array<{ id: string; text: string }>,
    topK = 5,
    threshold = 0.5
  ): Promise<SemanticMatch[]> {
    const queryEmb = await this.getEmbedding(query);
    if (!queryEmb) return [];

    const matches: SemanticMatch[] = [];

    // Get embeddings for all candidates (batch if possible)
    const hf = getHFClient();
    const enabled = await hf.isEnabled();
    if (!enabled) return [];

    // Check cache first, collect uncached
    const uncachedTexts: string[] = [];
    const uncachedIndices: number[] = [];
    const candidateEmbs: (number[] | null)[] = new Array(candidates.length).fill(null);

    for (let i = 0; i < candidates.length; i++) {
      const normalized = candidates[i].text.toLowerCase().trim();
      const cached = this.cache.get(normalized);
      if (cached) {
        candidateEmbs[i] = cached.embedding;
      } else {
        uncachedTexts.push(normalized);
        uncachedIndices.push(i);
      }
    }

    // Batch fetch uncached embeddings
    if (uncachedTexts.length > 0) {
      const batchResult = await hf.getEmbeddings(uncachedTexts);
      if (batchResult.success && batchResult.embeddings) {
        for (let j = 0; j < uncachedTexts.length; j++) {
          const emb = batchResult.embeddings[j];
          const idx = uncachedIndices[j];
          candidateEmbs[idx] = emb;

          // Cache it
          this.cache.set(uncachedTexts[j], {
            text: uncachedTexts[j],
            embedding: emb,
            createdAt: Date.now(),
          });
        }
        await this.persistCache();
      }
    }

    // Compute similarities
    for (let i = 0; i < candidates.length; i++) {
      const emb = candidateEmbs[i];
      if (!emb) continue;

      const similarity = this.cosineSimilarity(queryEmb, emb);
      if (similarity >= threshold) {
        matches.push({
          id: candidates[i].id,
          text: candidates[i].text,
          similarity,
        });
      }
    }

    // Sort by similarity, return top K
    return matches
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  // ── Task Classification ───────────────────────────────────────────
  // Classify a task into categories using embeddings

  async classifyTask(task: string): Promise<{
    category: 'form' | 'research' | 'navigation' | 'extraction' | 'workflow' | 'general';
    confidence: number;
  }> {
    const categories = [
      { id: 'form', text: 'fill out a form, enter data into fields, submit information' },
      { id: 'research', text: 'search for information, find facts, look up data, read articles' },
      { id: 'navigation', text: 'go to a website, navigate to a page, open a link' },
      { id: 'extraction', text: 'extract data from a page, scrape information, copy text into a table' },
      { id: 'workflow', text: 'complete a multi-step process, follow a sequence of actions' },
      { id: 'general', text: 'general web browsing task' },
    ];

    const matches = await this.findBestMatches(task, categories, 1, 0.3);

    if (matches.length === 0) {
      return { category: 'general', confidence: 0.5 };
    }

    return {
      category: matches[0].id as any,
      confidence: matches[0].similarity,
    };
  }

  // ── Skill Matching ────────────────────────────────────────────────
  // Find the best matching skill for a new task

  async matchSkills(
    task: string,
    skills: Array<{ id: string; name: string; description: string; task: string }>
  ): Promise<SemanticMatch[]> {
    if (skills.length === 0) return [];

    // Combine skill name + description + original task for richer matching
    const candidates = skills.map(s => ({
      id: s.id,
      text: `${s.name}: ${s.description}. Task: ${s.task}`,
    }));

    return this.findBestMatches(task, candidates, 3, 0.6);
  }

  // ── Site Pattern Matching ─────────────────────────────────────────
  // Find similar sites for transferring learned strategies

  async matchSites(
    currentSite: string,
    knownSites: Array<{ id: string; text: string }>
  ): Promise<SemanticMatch[]> {
    return this.findBestMatches(currentSite, knownSites, 3, 0.7);
  }

  // ── Stats ─────────────────────────────────────────────────────────

  getCacheSize(): number {
    return this.cache.size;
  }

  async clearCache(): Promise<void> {
    this.cache.clear();
    await chrome.storage.local.remove(CACHE_KEY);
  }
}

// Singleton
export const hfEmbeddings = new SemanticMatcher();
