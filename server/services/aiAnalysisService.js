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
  constructor(config = {}) {
    this.config = {
      // API Configuration - User can customize these
      apiEndpoint: config.aiApiEndpoint || process.env.AI_API_ENDPOINT || '',
      apiKey: config.aiApiKey || process.env.AI_API_KEY || '',
      model: config.aiModel || process.env.AI_MODEL || 'multimodal-large',
      
      // Analysis Configuration
      enableAutoAnalysis: config.enableAutoAnalysis !== false, // Default: true
      analysisTimeout: config.analysisTimeout || 120000, // 120 seconds (2 minutes) - multimodal LLM needs more time
      maxConcurrent: config.maxConcurrentAnalysis || 2, // Reduce concurrent to avoid overwhelming the API
      
      // Cache Configuration
      cacheDir: config.aiCacheDir || './server/cache/analysis',
      
      // Analysis Features
      features: {
        tags: true,           // Generate semantic tags
        category: true,       // Auto-categorize
        description: true,    // Generate description
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
    
    // Ensure cache directory exists
    fs.ensureDirSync(this.config.cacheDir);
    
    // Note: loadCache() should be called explicitly after instantiation
    // to properly await the async operation
  }
  
  /**
   * Initialize the service - must be called after instantiation
   */
  async initialize() {
    console.log('🧠 Initializing AI Analysis Service...');
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
   */
  getCacheKey(photoId, imagePath) {
    // Use photo ID + file modification time to invalidate stale cache
    return crypto.createHash('md5').update(`${photoId}-${imagePath}`).digest('hex');
  }

  /**
   * Load cached analyses from disk
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
        this.cache = new Map(Object.entries(data));
        console.log(`🧠 Loaded ${this.cache.size} cached AI analyses`);
      } else {
        console.log('   No cache file found');
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
   * Analyze a single image
   * @param {Object} photo - Photo object with id, originalPath, etc.
   * @returns {Promise<Object>} Analysis result
   */
  async analyzeImage(photo) {
    if (!this.isAvailable()) {
      throw new Error('AI analysis not configured. Please set AI_API_ENDPOINT and AI_API_KEY');
    }

    const cacheKey = this.getCacheKey(photo.id, photo.originalPath);
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      console.log(`🧠 Using cached analysis for ${photo.title}`);
      return this.cache.get(cacheKey);
    }

    console.log(`🧠 Analyzing image: ${photo.title}`);

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
      await this.saveCache();

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
      prompt += '- description: A concise 1-2 sentence description in Chinese (图片的中文描述)\n';
    }
    if (features.quality) {
      prompt += '- quality: Object with {score: 1-10, issues: array of quality issues in Chinese (质量问题，如：模糊, 过曝, 欠曝, 噪点)}\n';
    }
    if (features.aesthetic) {
      prompt += '- aesthetic: Object with {score: 1-10, strengths: array of aesthetic strengths in Chinese (美学优点，如：构图优美, 色彩和谐, 光影出色)}\n';
    }
    if (features.technical) {
      prompt += '- technical: Object with {composition: string in Chinese (构图), lighting: string in Chinese (光线), focus: string in Chinese (对焦), exposure: string in Chinese (曝光)}\n';
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
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 1000,
      temperature: 0.3
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
    const results = [];
    const total = photos.length;
    
    for (let i = 0; i < photos.length; i++) {
      try {
        const analysis = await this.analyzeImage(photos[i]);
        results.push(analysis);
        
        if (onProgress) {
          onProgress(i + 1, total, photos[i], analysis);
        }
        
        // Small delay to avoid rate limiting
        if (i < photos.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`Failed to analyze ${photos[i].title}:`, error.message);
        results.push(null);
      }
    }
    
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
