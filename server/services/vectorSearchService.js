import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';

const DEFAULT_CONFIG = {
  enabled: false,
  modelId: 'Xenova/multilingual-e5-small',
  cacheDir: './server/cache/vectors',
  minScore: 0.35,
};

const hashText = (text) => crypto.createHash('sha256').update(text).digest('hex');

export class VectorSearchService {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...(config.vectorSearch || {}), cacheDir: config.vectorCacheDir || config.vectorSearch?.cacheDir || DEFAULT_CONFIG.cacheDir };
    this.vectors = new Map();
    this.extractor = null;
    this.loadingPromise = null;
    this.lastError = '';
    this.queue = [];
    this.queuedIds = new Set();
    this.processing = false;
    fs.ensureDirSync(this.config.cacheDir);
    this.loadCache();
  }

  updateRuntimeConfig(updates = {}) {
    this.config = { ...this.config, ...updates };
    if (updates.modelId && updates.modelId !== this.extractor?.model_id) {
      this.extractor = null;
      this.loadingPromise = null;
    }
  }

  isEnabled() { return this.config.enabled === true; }

  getStatus() {
    const configured = Boolean(this.config.modelId);
    let state = this.extractor ? 'ready' : 'disabled';
    if (this.isEnabled() && !configured) state = 'unavailable';
    else if (this.isEnabled() && this.lastError) state = 'unavailable';
    else if (this.loadingPromise) state = 'warming';
    else if (this.isEnabled() && this.extractor) state = 'ready';
    else if (this.isEnabled()) state = 'warming';
    return { enabled: this.isEnabled(), configured, state, modelId: this.config.modelId || '', indexed: this.vectors.size, queued: this.queue.length, error: this.lastError || null };
  }

  getStats() {
    const status = this.getStatus();
    return { totalIndexed: status.indexed, isReady: status.state === 'ready' };
  }

  buildSearchText(analysis) {
    return [
      ...(analysis.tags || []),
      analysis.category,
      analysis.description,
      analysis.technical?.composition,
      analysis.technical?.lighting,
    ].filter(Boolean).join('. ');
  }

  async ensureReady({ allowDisabled = false } = {}) {
    if (!this.isEnabled() && !allowDisabled) throw new Error('Vector search is disabled');
    if (!this.config.modelId) throw new Error('Vector search model is not configured');
    if (this.extractor) return this.extractor;
    if (!this.loadingPromise) {
      this.lastError = '';
      this.loadingPromise = (async () => {
        try {
          const { pipeline } = await import('@huggingface/transformers');
          const extractor = await pipeline('feature-extraction', this.config.modelId, { dtype: 'q8' });
          this.extractor = extractor;
          return extractor;
        } catch (error) {
          this.lastError = error.message || 'Failed to load vector model';
          throw error;
        } finally {
          this.loadingPromise = null;
        }
      })();
    }
    return this.loadingPromise;
  }

  async generateEmbedding(text) {
    const extractor = await this.ensureReady();
    const output = await extractor(`passage: ${text}`, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  async downloadModel() {
    await this.ensureReady({ allowDisabled: true });
    return this.getStatus();
  }

  scheduleIndex(analysis) {
    if (!this.isEnabled() || !analysis?.photoId || this.queuedIds.has(analysis.photoId)) return;
    this.queue.push(analysis);
    this.queuedIds.add(analysis.photoId);
    void this.processQueue();
  }

  scheduleBatch(analyses = []) {
    analyses.forEach(analysis => this.scheduleIndex(analysis));
  }

  async processQueue() {
    if (this.processing || !this.isEnabled()) return;
    this.processing = true;
    try {
      while (this.queue.length && this.isEnabled()) {
        const analysis = this.queue.shift();
        this.queuedIds.delete(analysis.photoId);
        await this.indexPhoto(analysis.photoId, analysis);
      }
    } catch (error) {
      this.lastError = error.message || 'Vector indexing failed';
    } finally {
      this.processing = false;
    }
  }

  async indexPhoto(photoId, analysis) {
    const text = this.buildSearchText(analysis);
    if (!text.trim()) return null;
    const textHash = hashText(text);
    const existing = this.vectors.get(photoId);
    if (existing?.textHash === textHash && existing?.modelId === this.config.modelId) return existing;
    const vector = await this.generateEmbedding(text);
    const entry = { photoId, vector, textHash, modelId: this.config.modelId, indexedAt: new Date().toISOString() };
    this.vectors.set(photoId, entry);
    await this.saveCache();
    return entry;
  }

  cosineSimilarity(a, b) {
    let dot = 0;
    let aNorm = 0;
    let bNorm = 0;
    for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; aNorm += a[i] * a[i]; bNorm += b[i] * b[i]; }
    return aNorm && bNorm ? dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm)) : 0;
  }

  async search(query, topK = 100) {
    if (!this.isEnabled() || this.vectors.size === 0) return [];
    const queryVector = await (await this.ensureReady())(`query: ${query}`, { pooling: 'mean', normalize: true });
    const vector = Array.from(queryVector.data);
    return [...this.vectors.values()]
      .filter(entry => entry.modelId === this.config.modelId && Array.isArray(entry.vector))
      .map(entry => ({ photoId: entry.photoId, similarity: this.cosineSimilarity(vector, entry.vector) }))
      .filter(result => result.similarity >= this.config.minScore)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  async removePhoto(photoId) {
    if (this.vectors.delete(photoId)) await this.saveCache();
  }

  async saveCache() {
    await fs.writeJson(path.join(this.config.cacheDir, 'vector-index.json'), Object.fromEntries(this.vectors), { spaces: 0 });
  }

  async loadCache() {
    try {
      const cachePath = path.join(this.config.cacheDir, 'vector-index.json');
      if (await fs.pathExists(cachePath)) this.vectors = new Map(Object.entries(await fs.readJson(cachePath)));
    } catch (error) {
      this.lastError = `Failed to load vector cache: ${error.message}`;
    }
  }
}

export default VectorSearchService;
