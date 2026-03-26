/**
 * Vector Search Service
 * Lightweight local semantic search using TensorFlow.js
 * 
 * Approach:
 * 1. Use AI-generated tags, description, category as text
 * 2. Generate embeddings using Universal Sentence Encoder (lightweight)
 * 3. Store vectors locally
 * 4. Search using cosine similarity
 */

import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';

export class VectorSearchService {
  constructor(config = {}) {
    this.config = {
      cacheDir: config.vectorCacheDir || './server/cache/vectors',
      ...config
    };
    
    this.vectors = new Map(); // photoId -> { vector, metadata }
    this.model = null; // TensorFlow model
    this.tf = null; // TensorFlow library
    
    fs.ensureDirSync(this.config.cacheDir);
    this.loadCache();
  }

  /**
   * Check if service is ready (model loaded)
   */
  isReady() {
    return this.model !== null;
  }

  /**
   * Initialize the embedding model
   */
  async initialize() {
    if (this.model) return;
    
    try {
      console.log('🧠 Loading embedding model...');
      
      // Dynamic import to avoid loading TF if not needed
      this.tf = await import('@tensorflow/tfjs');
      const use = await import('@tensorflow-models/universal-sentence-encoder');
      
      // Load lightweight model
      this.model = await use.load();
      
      console.log('✅ Embedding model loaded');
    } catch (error) {
      console.error('Failed to load embedding model:', error.message);
      throw error;
    }
  }

  /**
   * Generate embedding for text
   */
  async generateEmbedding(text) {
    if (!this.model) {
      await this.initialize();
    }
    
    const embeddings = await this.model.embed([text]);
    const vector = await embeddings.data();
    embeddings.dispose();
    
    return Array.from(vector);
  }

  /**
   * Build search text from analysis
   */
  buildSearchText(analysis) {
    const parts = [];
    
    if (analysis.tags?.length) {
      parts.push(...analysis.tags);
    }
    
    if (analysis.category) {
      parts.push(analysis.category);
    }
    
    if (analysis.description) {
      parts.push(analysis.description);
    }
    
    if (analysis.technical?.composition) {
      parts.push(analysis.technical.composition);
    }
    
    if (analysis.technical?.lighting) {
      parts.push(analysis.technical.lighting);
    }
    
    return parts.join('. ');
  }

  /**
   * Index a photo's analysis for vector search
   */
  async indexPhoto(photoId, analysis) {
    try {
      const searchText = this.buildSearchText(analysis);
      
      if (!searchText.trim()) {
        console.warn(`No searchable text for photo ${photoId}`);
        return null;
      }
      
      const vector = await this.generateEmbedding(searchText);
      
      const entry = {
        photoId,
        vector,
        text: searchText,
        indexedAt: new Date().toISOString()
      };
      
      this.vectors.set(photoId, entry);
      await this.saveCache();
      
      return entry;
    } catch (error) {
      console.error(`Failed to index photo ${photoId}:`, error.message);
      return null;
    }
  }

  /**
   * Batch index multiple photos
   */
  async indexBatch(analyses, onProgress) {
    const results = [];
    
    for (let i = 0; i < analyses.length; i++) {
      const analysis = analyses[i];
      const result = await this.indexPhoto(analysis.photoId, analysis);
      results.push(result);
      
      if (onProgress) {
        onProgress(i + 1, analyses.length, analysis.photoId);
      }
      
      // Small delay to prevent blocking
      if (i < analyses.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    
    return results;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Semantic search using vector similarity
   */
  async search(query, topK = 10, minScore = 0.3) {
    if (!this.model) {
      await this.initialize();
    }
    
    if (this.vectors.size === 0) {
      return [];
    }
    
    const queryVector = await this.generateEmbedding(query);
    
    const results = [];
    
    for (const [photoId, entry] of this.vectors) {
      const similarity = this.cosineSimilarity(queryVector, entry.vector);
      
      if (similarity >= minScore) {
        results.push({
          photoId,
          similarity,
          text: entry.text
        });
      }
    }
    
    // Sort by similarity (descending)
    results.sort((a, b) => b.similarity - a.similarity);
    
    return results.slice(0, topK);
  }

  /**
   * Hybrid search: combine vector similarity with keyword matching
   */
  async hybridSearch(query, analyses, options = {}) {
    const { 
      topK = 10, 
      minVectorScore = 0.3,
      keywordBoost = 0.2  // Boost for keyword matches
    } = options;
    
    // Get vector search results
    const vectorResults = await this.search(query, topK * 2, minVectorScore);
    
    // Build keyword set
    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 1);
    
    // Combine with keyword matching
    const combinedResults = vectorResults.map(result => {
      const analysis = analyses.find(a => a.photoId === result.photoId);
      let keywordScore = 0;
      
      if (analysis && keywords.length > 0) {
        const searchText = this.buildSearchText(analysis).toLowerCase();
        const matches = keywords.filter(kw => searchText.includes(kw)).length;
        keywordScore = (matches / keywords.length) * keywordBoost;
      }
      
      return {
        ...result,
        finalScore: result.similarity + keywordScore,
        analysis
      };
    });
    
    // Re-sort by final score
    combinedResults.sort((a, b) => b.finalScore - a.finalScore);
    
    return combinedResults.slice(0, topK);
  }

  /**
   * Remove a photo from index
   */
  async removePhoto(photoId) {
    this.vectors.delete(photoId);
    await this.saveCache();
  }

  /**
   * Clear all vectors
   */
  async clearIndex() {
    this.vectors.clear();
    await this.saveCache();
    console.log('🧠 Vector index cleared');
  }

  /**
   * Save vectors to disk
   */
  async saveCache() {
    try {
      const cachePath = path.join(this.config.cacheDir, 'vector-index.json');
      const data = Object.fromEntries(this.vectors);
      await fs.writeJson(cachePath, data, { spaces: 2 });
    } catch (error) {
      console.warn('Failed to save vector cache:', error.message);
    }
  }

  /**
   * Load vectors from disk
   */
  async loadCache() {
    try {
      const cachePath = path.join(this.config.cacheDir, 'vector-index.json');
      if (await fs.pathExists(cachePath)) {
        const data = await fs.readJson(cachePath);
        this.vectors = new Map(Object.entries(data));
        console.log(`🧠 Loaded ${this.vectors.size} vectors from cache`);
      }
    } catch (error) {
      console.warn('Failed to load vector cache:', error.message);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalIndexed: this.vectors.size,
      isReady: this.isReady()
    };
  }
}

export default VectorSearchService;
