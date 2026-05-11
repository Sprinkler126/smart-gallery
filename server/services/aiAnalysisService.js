/**
 * AI Analysis Service
 * Provides image analysis capabilities using multimodal LLM
 * 
 * Usage:
 * 1. Configure your API endpoint in config.json or environment variables
 * 2. The service will automatically analyze new photos
 * 3. Analysis results are cached and stored with photo metadata
 */

import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';

export class AIAnalysisService {
  constructor(config = {}, redisCacheService = null) {
    this.config = {
      // API Configuration - User can customize these
      apiEndpoint: config.aiApiEndpoint || process.env.AI_API_ENDPOINT || '',
      apiKey: config.aiApiKey || process.env.AI_API_KEY || '',
      model: config.aiModel || process.env.AI_MODEL || 'multimodal-large',
      
      // Analysis Configuration
      enableAutoAnalysis: config.enableAutoAnalysis !== false, // Default: true
      analysisTimeout: config.analysisTimeout || 60000, // 60 seconds by default for faster failure/retry feedback
      maxConcurrent: config.maxConcurrentAnalysis || 4, // Parallel batch analysis to improve throughput
      maxTokens: config.aiMaxTokens || 8000,
      temperature: config.aiTemperature ?? 0.2,
      imageDetail: config.aiImageDetail || 'low', // low detail is much faster and enough for thumbnails
      batchDelayMs: config.aiBatchDelayMs ?? 0,
      
      // Cache Configuration
      cacheDir: config.aiCacheDir || './server/cache/analysis',
      
      // Analysis Features
      features: {
        tags: true,           // Generate semantic tags
        category: true,       // Auto-categorize
        description: true,    // Generate description
        depict: true,         // Generate poetic depiction
        quality: true,        // Quality assessment
        aesthetic: true,      // Aesthetic score
        technical: true,      // Technical feedback
      },
      
      ...config
    };
    
    this.analysisQueue = [];
    this.isProcessing = false;
    this.cache = new Map(); // In-memory cache
    this.cacheLoaded = false;
    this.redisCache = redisCacheService;
    this.cacheNamespace = 'ai-analysis';
    this.saveTimer = null;
    this.saveInFlight = null;
    
    // Store baseDir for later path resolution in initialize()
    this._baseDir = null;
    
    // Note: ensureDirSync is called in initialize() after path resolution
    
    // Note: loadCache() should be called explicitly after instantiation
    // to properly await the async operation
  }
  
  /**
   * Initialize the service - must be called after instantiation
   * @param {string} baseDir - Optional base directory to resolve relative paths
   */
  async initialize(baseDir = null) {
    console.log('🧠 Initializing AI Analysis Service...');
    
    // Resolve cache directory to absolute path if needed
    if (baseDir && !path.isAbsolute(this.config.cacheDir)) {
      this.config.cacheDir = path.resolve(baseDir, this.config.cacheDir);
    } else if (!path.isAbsolute(this.config.cacheDir)) {
      this.config.cacheDir = path.resolve(this.config.cacheDir);
    }
    
    // Ensure cache directory exists (now that we have the correct path)
    await fs.ensureDir(this.config.cacheDir);
    
    console.log(`   Cache directory: ${this.config.cacheDir}`);
    if (!this.cacheLoaded) {
      await this.loadCache();
      this.cacheLoaded = true;
      console.log(`   Cache loaded: ${this.cache.size} analyses`);
    } else {
      console.log('   Cache already loaded');
    }
  }

  /**
   * Check if AI analysis is configured and available
   */
  isAvailable() {
    return !!(this.config.apiEndpoint && this.config.apiKey);
  }

  /**
   * Get cache key for a photo
   * CHANGED: Use photoId directly as cache key for stability across path changes
   */
  getCacheKey(photoId, imagePath) {
    // Use photoId directly as cache key (more stable across path changes)
    return photoId;
  }

  /**
   * Load cached analyses from disk
   * MIGRATION: Automatically migrate old MD5-based keys to photoId-based keys
   */
  async loadCache() {
    try {
      const cachePath = path.join(this.config.cacheDir, 'analysis-cache.json');
      const absolutePath = path.resolve(cachePath);
      console.log(`   Looking for cache at: ${absolutePath}`);
      const exists = await fs.pathExists(cachePath);
      console.log(`   Cache file exists: ${exists}`);
      if (exists) {
        const data = await fs.readJson(cachePath);
        const rawCache = new Map(Object.entries(data));
        
        // MIGRATION: Convert old MD5 keys to photoId keys
        let migratedCount = 0;
        this.cache = new Map();
        for (const [key, value] of rawCache) {
          // Check if this is an old MD5 key (32 hex chars) or already a photoId
          if (key.length === 32 && /^[a-f0-9]+$/.test(key)) {
            // Old MD5 key - migrate to photoId
            if (value.photoId) {
              this.cache.set(value.photoId, value);
              migratedCount++;
            } else {
              // Skip entries without photoId (can't migrate)
              console.warn(`   Skipping cache entry without photoId: ${key}`);
            }
          } else {
            // Already using photoId as key
            this.cache.set(key, value);
          }
        }
        
        console.log(`🧠 Loaded ${this.cache.size} cached AI analyses (${migratedCount} migrated from old format)`);
        
        // Save migrated cache back to disk
        if (migratedCount > 0) {
          await this.saveCache();
          console.log(`   Migrated cache saved to disk`);
        }
      } else {
        console.log('   No cache file found');
      }

      if (this.redisCache?.isConnected()) {
        const redisEntries = await this.redisCache.loadNamespace(this.cacheNamespace);
        for (const [key, value] of redisEntries) {
          this.cache.set(key, value);
        }
        if (redisEntries.size > 0) {
          console.log(`🔴 Merged ${redisEntries.size} AI analyses from Redis cache`);
        }
      }
    } catch (error) {
      console.warn('Failed to load AI analysis cache:', error.message);
    }
  }

  /**
   * Save cache to disk
   */
  async saveCache() {
    try {
      const cachePath = path.join(this.config.cacheDir, 'analysis-cache.json');
      const data = Object.fromEntries(this.cache);
      await fs.writeJson(cachePath, data, { spaces: 2 });
    } catch (error) {
      console.warn('Failed to save AI analysis cache:', error.message);
    }
  }

  /**
   * Schedule disk cache persistence without blocking AI responses.
   */
  scheduleCacheSave(delayMs = 1000) {
    if (this.saveTimer) {
      return;
    }

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveInFlight = this.saveCache().finally(() => {
        this.saveInFlight = null;
      });
    }, delayMs);
  }

  /**
   * Flush any pending disk cache write.
   */
  async flushCacheSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      await this.saveCache();
    }

    if (this.saveInFlight) {
      await this.saveInFlight;
    }
  }

  /**
   * Analyze a single image
   * @param {Object} photo - Photo object with id, originalPath, etc.
   * @param {boolean} force - Force re-analysis even if cached
   * @returns {Promise<Object>} Analysis result
   */
  async analyzeImage(photo, force = false) {
    if (!this.isAvailable()) {
      throw new Error('AI analysis not configured. Please set AI_API_ENDPOINT and AI_API_KEY');
    }

    const cacheKey = this.getCacheKey(photo.id, photo.originalPath);
    
    // Check cache first (unless force re-analysis)
    if (!force && this.cache.has(cacheKey)) {
      console.log(`🧠 Using cached analysis for ${photo.title}`);
      return this.cache.get(cacheKey);
    }

    if (!force && this.redisCache?.isConnected()) {
      const cached = await this.redisCache.get(this.cacheNamespace, cacheKey);
      if (cached) {
        this.cache.set(cacheKey, cached);
        console.log(`🔴 Using Redis cached analysis for ${photo.title}`);
        return cached;
      }
    }

    console.log(`🧠 Analyzing image: ${photo.title}${force ? ' (forced re-analysis)' : ''}`);

    try {
      // Use thumbnail for analysis to reduce upload size and improve speed
      // Thumbnail is typically 800px wide, sufficient for AI analysis
      const imagePathToAnalyze = photo.thumbnailPath || photo.originalPath;
      const imageBuffer = await fs.readFile(imagePathToAnalyze);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = this.getMimeType(imagePathToAnalyze);
      
      console.log(`📤 Using ${photo.thumbnailPath ? 'thumbnail' : 'original'} for analysis (${Math.round(imageBuffer.length / 1024)}KB)`);

      // Prepare analysis prompt
      const prompt = this.buildAnalysisPrompt();

      // Call AI API
      const result = await this.callAIAPI(base64Image, mimeType, prompt);

      // Parse and structure the result
      const analysis = this.parseAIResult(result, photo);

      // Cache the result
      this.cache.set(cacheKey, analysis);
      if (this.redisCache?.isConnected()) {
        await this.redisCache.set(this.cacheNamespace, cacheKey, analysis);
      }
      this.scheduleCacheSave();

      console.log(`✅ Analysis complete for ${photo.title}`);
      return analysis;

    } catch (error) {
      console.error(`❌ Analysis failed for ${photo.title}:`, error.message);
      throw error;
    }
  }

  /**
   * Build the analysis prompt for the AI
   */
  buildAnalysisPrompt() {
    const features = this.config.features;
    
    let prompt = 'Analyze this image and provide the following information in JSON format. All text fields must be in Chinese (中文):\n\n';
    
    if (features.tags) {
      prompt += '- tags: Array of 5-10 descriptive tags in Chinese (标签，如：海景, 日落, 山脉, 人物, 建筑, 美食, 动物, 植物, 城市, 自然, 室内, 户外, 白天, 夜晚, 彩色, 黑白)\n';
    }
    if (features.category) {
      prompt += '- category: Best single category in Chinese (分类，如：风景, 人像, 街拍, 建筑, 自然, 美食, 活动, 动物, 植物, 静物, 夜景, 旅行)\n';
    }
    if (features.description) {
      prompt += '- description: A detailed description in Chinese (图片的中文描述，客观描述画面内容。如果知道拍摄地点（如城市、地标、景点、经典机位），请具体指出是哪里的什么景点或机位，例如"香港维多利亚港夜景"、"北京故宫角楼"、"上海外滩"等)\n';
    }
    if (features.depict) {
      prompt += '- depict: A poetic and evocative description in Chinese (重点是用一句话(10字左右)点出图片的特别之处，简短有力，勾起欣赏者的回忆。1.可以是画面内容描述，用简洁优美的语言描绘画面内容，不追求全面，只抓重点；2.可结合贴合画面的诗词；3.如果知道是哪里也可以直接说是哪里的什么，或者是形容这里的诗句。无论是哪种描述方法，切记要简短，简单易懂，信达雅)\n';
    }
    if (features.quality) {
      prompt += '- quality: Object with {score: 1-10, issues: array of quality issues in Chinese (质量问题，如：模糊, 过曝, 欠曝, 噪点)}\n';
    }
    if (features.aesthetic) {
      prompt += '- aesthetic: Object with {score: 1-10, strengths: array of aesthetic strengths in Chinese (美学优点，如：构图优美, 色彩和谐, 光影出色)}\n';
    }
    if (features.technical) {
      prompt += '- technical: Object with {composition: string in Chinese (构图，详细说明构图方式和特点), lighting: string in Chinese (光线，详细说明光源、光质、光位、光影效果), focus: string in Chinese (对焦，详细说明焦点位置和景深效果), exposure: string in Chinese (曝光，详细说明曝光参数和曝光效果)}\n';
    }
    
    prompt += '\nRespond ONLY with valid JSON, no markdown formatting. All text values must be in Chinese (中文).';
    
    return prompt;
  }

  /**
   * Call the AI API
   * This is a template - users can customize for their specific API
   */
  async callAIAPI(base64Image, mimeType, prompt) {
    const { apiEndpoint, apiKey, model } = this.config;

    // Template for OpenAI-compatible API
    const requestBody = {
      model: model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: this.config.imageDetail
              }
            }
          ]
        }
      ],
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature
    };

    // Create timeout controller for better compatibility
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.analysisTimeout);
    
    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      
      // Debug: log finish_reason and usage
      const choice = data.choices?.[0];
      if (choice) {
        console.log(`   API finish_reason: ${choice.finish_reason}`);
        console.log(`   API usage:`, JSON.stringify(data.usage || {}));
      }
      
      // Extract content from response (OpenAI format)
      return data.choices?.[0]?.message?.content || '';
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Parse AI result into structured format
   */
  parseAIResult(result, photo) {
    try {
      // Try to extract JSON from the response
      // The AI might wrap JSON in markdown code blocks
      let jsonStr = result;
      
      // Remove markdown code blocks if present
      const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      
      // Try to find JSON object in the text
      const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        jsonStr = objectMatch[0];
      }

      const parsed = JSON.parse(jsonStr);

      return {
        photoId: photo.id,
        analyzedAt: new Date().toISOString(),
        tags: parsed.tags || [],
        category: parsed.category || photo.category,
        description: parsed.description || '',
        depict: parsed.depict || '',
        quality: parsed.quality || { score: 0, issues: [] },
        aesthetic: parsed.aesthetic || { score: 0, strengths: [] },
        technical: parsed.technical || { composition: '', lighting: '', focus: '', exposure: '' },
        raw: result // Keep raw response for debugging
      };

    } catch (error) {
      console.warn('Failed to parse AI result as JSON, using fallback:', error.message);
      
      // Fallback: return raw text
      return {
        photoId: photo.id,
        analyzedAt: new Date().toISOString(),
        tags: [],
        category: photo.category,
        description: result.substring(0, 200), // First 200 chars
        depict: '',
        quality: { score: 0, issues: [] },
        aesthetic: { score: 0, strengths: [] },
        technical: { composition: '', lighting: '', focus: '', exposure: '' },
        raw: result,
        parseError: error.message
      };
    }
  }

  /**
   * Get MIME type from file path
   */
  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.avif': 'image/avif'
    };
    return mimeTypes[ext] || 'image/jpeg';
  }

  /**
   * Batch analyze multiple images
   */
  async analyzeBatch(photos, onProgress) {
    const results = new Array(photos.length).fill(null);
    const total = photos.length;
    const workerCount = Math.max(1, Math.min(this.config.maxConcurrent, total));
    let nextIndex = 0;
    let completed = 0;

    const runWorker = async () => {
      while (nextIndex < total) {
        const currentIndex = nextIndex++;
        const photo = photos[currentIndex];

        try {
          const analysis = await this.analyzeImage(photo);
          results[currentIndex] = analysis;

          if (this.config.batchDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, this.config.batchDelayMs));
          }
        } catch (error) {
          console.error(`Failed to analyze ${photo.title}:`, error.message);
        } finally {
          completed++;
          if (onProgress) {
            onProgress(completed, total, photo, results[currentIndex]);
          }
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, runWorker));
    await this.flushCacheSave();
    return results;
  }

  /**
   * Get analysis for a photo (from cache or analyze)
   */
  async getAnalysis(photo) {
    const cacheKey = this.getCacheKey(photo.id, photo.originalPath);
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    if (this.config.enableAutoAnalysis && this.isAvailable()) {
      return await this.analyzeImage(photo);
    }
    
    return null;
  }

  /**
   * Search photos by tags and description (fuzzy matching)
   * Searches photos that have been analyzed (cached)
   * Supports partial matching in tags and description
   * Works with cached data even without API configuration
   */
  async searchByQuery(query, photos) {
    // Allow search if we have cached analyses, even without API config
    if (this.cache.size === 0 && !this.isAvailable()) {
      throw new Error('AI analysis not configured and no cached data available');
    }

    const results = [];
    const queryLower = query.toLowerCase().trim();
    
    if (!queryLower) {
      return results;
    }
    
    for (const photo of photos) {
      const cacheKey = this.getCacheKey(photo.id, photo.originalPath);
      
      // Only search photos that have been analyzed (in cache)
      if (!this.cache.has(cacheKey)) {
        continue;
      }
      
      const analysis = this.cache.get(cacheKey);

      // Build searchable text from tags, description, category, and technical fields
      const tagsText = (analysis.tags || []).join(' ').toLowerCase();
      const descriptionText = (analysis.description || '').toLowerCase();
      const categoryText = (analysis.category || '').toLowerCase();
      const compositionText = (analysis.technical?.composition || '').toLowerCase();
      const lightingText = (analysis.technical?.lighting || '').toLowerCase();
      
      // Check for matches in different fields with different weights
      let score = 0;
      let matchedFields = [];
      
      // Tag match (highest weight - exact or partial match)
      if (tagsText.includes(queryLower)) {
        score += 1.0;
        matchedFields.push('tags');
      }
      
      // Description match (high weight)
      if (descriptionText.includes(queryLower)) {
        score += 0.8;
        matchedFields.push('description');
      }
      
      // Category match (medium weight)
      if (categoryText.includes(queryLower)) {
        score += 0.6;
        matchedFields.push('category');
      }
      
      // Technical fields match (lower weight)
      if (compositionText.includes(queryLower) || lightingText.includes(queryLower)) {
        score += 0.4;
        matchedFields.push('technical');
      }
      
      // Also check individual keywords for multi-word queries
      const keywords = queryLower.split(/\s+/).filter(k => k.length > 1);
      if (keywords.length > 1) {
        const allSearchText = `${tagsText} ${descriptionText} ${categoryText} ${compositionText} ${lightingText}`;
        const keywordMatches = keywords.filter(kw => allSearchText.includes(kw)).length;
        if (keywordMatches > 0) {
          score += (keywordMatches / keywords.length) * 0.3;
        }
      }

      if (score > 0) {
        results.push({
          photo,
          analysis,
          relevanceScore: score,
          matchedFields
        });
      }
    }

    // Sort by relevance score (descending)
    return results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Clear all cached analyses
   */
  async clearCache() {
    this.cache.clear();
    const cachePath = path.join(this.config.cacheDir, 'analysis-cache.json');
    if (await fs.pathExists(cachePath)) {
      await fs.remove(cachePath);
    }
    if (this.redisCache?.isConnected()) {
      await this.redisCache.clearNamespace(this.cacheNamespace);
    }
    console.log('🧠 AI analysis cache cleared');
  }

  /**
   * Get statistics about analyses
   */
  getStats() {
    const analyses = Array.from(this.cache.values());
    
    return {
      totalAnalyzed: analyses.length,
      averageQualityScore: analyses.reduce((sum, a) => sum + (a.quality?.score || 0), 0) / analyses.length || 0,
      averageAestheticScore: analyses.reduce((sum, a) => sum + (a.aesthetic?.score || 0), 0) / analyses.length || 0,
      topCategories: this.getTopCategories(analyses),
      topTags: this.getTopTags(analyses)
    };
  }

  /**
   * Get top categories from analyses
   */
  getTopCategories(analyses) {
    const categories = {};
    analyses.forEach(a => {
      if (a.category) {
        categories[a.category] = (categories[a.category] || 0) + 1;
      }
    });
    return Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }

  /**
   * Get top tags from analyses
   */
  getTopTags(analyses) {
    const tags = {};
    analyses.forEach(a => {
      (a.tags || []).forEach(tag => {
        tags[tag] = (tags[tag] || 0) + 1;
      });
    });
    return Object.entries(tags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
  }
}

export default AIAnalysisService;
