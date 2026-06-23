/**
 * API Routes
 * RESTful API endpoints for the gallery
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs-extra';
import orientationService from '../services/orientationService.js';
import { CreativeService } from '../services/creativeService.js';

// Use native fetch (Node.js 18+)
const fetch = globalThis.fetch || (await import('node-fetch')).default;

export function createApiRouter(galleryService, aiAnalysisService, vectorSearchService, config) {
  const router = Router();
  const adminToken = process.env.ADMIN_TOKEN || config.adminToken || '';
  const creativeService = new CreativeService({
    galleryService,
    aiAnalysisService,
    config,
    baseDir: process.cwd()
  });

  const getHostName = (value = '') => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
      return new URL(trimmed).hostname;
    } catch {
      return trimmed.split(':')[0].replace(/^\[|\]$/g, '');
    }
  };

  const isLocalOrPrivateHost = (hostname) => {
    const host = (hostname || '').toLowerCase();
    if (!host) return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (host.startsWith('192.168.') || host.startsWith('10.')) return true;
    const match = host.match(/^172\.(\d+)\./);
    return !!match && Number(match[1]) >= 16 && Number(match[1]) <= 31;
  };

  const isAdminRequest = (req) => {
    const suppliedToken =
      req.get('x-admin-token') ||
      (req.get('authorization') || '').replace(/^Bearer\s+/i, '') ||
      req.query.adminToken ||
      '';

    if (adminToken && suppliedToken === adminToken) {
      return true;
    }

    const originHost = getHostName(req.get('origin') || req.get('referer') || '');
    const requestHost = getHostName(req.get('host') || '');
    return isLocalOrPrivateHost(originHost || requestHost);
  };

  const requireAdmin = (req, res, next) => {
    if (isAdminRequest(req)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: adminToken
        ? 'Admin token required'
        : 'Admin access is restricted to local/private hosts. Set ADMIN_TOKEN to allow authorized remote admin requests.'
    });
  };

  const normalizeImportedProviders = (providers = []) => {
    const existing = new Map((config.aiProviders || []).map(provider => [provider.id, provider]));

    return providers.map((provider, index) => {
      const id = provider.id || `provider-${index + 1}`;
      const existingProvider = existing.get(id) || {};
      const apiKey = provider.apiKey === '••••••••'
        ? existingProvider.apiKey || ''
        : provider.apiKey || '';

      return {
        id,
        name: provider.name || id,
        apiEndpoint: provider.apiEndpoint || provider.endpoint || '',
        apiKey,
        model: provider.model || 'multimodal-large',
        enabled: provider.enabled !== false,
        priority: Number.isFinite(Number(provider.priority)) ? Number(provider.priority) : index
      };
    });
  };

  const applyAiConfig = async (updates) => {
    if (updates.aiApiEndpoint !== undefined) config.aiApiEndpoint = updates.aiApiEndpoint;
    if (updates.aiApiKey !== undefined && updates.aiApiKey !== '••••••••') config.aiApiKey = updates.aiApiKey;
    if (updates.aiModel !== undefined) config.aiModel = updates.aiModel;
    if (updates.enableAutoAnalysis !== undefined) config.enableAutoAnalysis = updates.enableAutoAnalysis;
    if (updates.maxConcurrentAnalysis !== undefined) config.maxConcurrentAnalysis = updates.maxConcurrentAnalysis;
    if (updates.aiProviders !== undefined || updates.providers !== undefined) {
      config.aiProviders = normalizeImportedProviders(updates.aiProviders || updates.providers || []);
    }

    aiAnalysisService.updateRuntimeConfig({
      aiApiEndpoint: config.aiApiEndpoint,
      aiApiKey: config.aiApiKey,
      aiModel: config.aiModel,
      enableAutoAnalysis: config.enableAutoAnalysis,
      maxConcurrentAnalysis: config.maxConcurrentAnalysis,
      aiProviders: config.aiProviders || []
    });

    const configPath = path.resolve('./server/config.json');
    await fs.writeJson(configPath, config, { spaces: 2 });
  };

  // ==================== PHOTOS ====================

  /**
   * GET /api/photos
   * Get all photos with optional filtering and pagination
   */
  router.get('/photos', (req, res) => {
    try {
      const {
        category,
        sourceId,
        sortBy = 'date',
        sortOrder = 'desc',
        limit,
        offset = 0
      } = req.query;

      const result = galleryService.getPhotos({
        category,
        sourceId,
        sortBy,
        sortOrder,
        limit: limit ? parseInt(limit) : undefined,
        offset: parseInt(offset)
      });

      // Transform photos to API format
      const photos = result.photos.map(photo => ({
        id: photo.id,
        url: `/photowall/api/display/${photo.id}`,
        originalUrl: `/photowall/api/image/${photo.id}`,
        thumbnail: `/photowall/api/thumbnail/${photo.id}`,
        blurPlaceholder: photo.blurPlaceholder, // LQIP for lazy loading
        title: photo.title,
        category: photo.category,
        date: photo.date,
        location: photo.location,
        exif: photo.exif,
        dimensions: photo.dimensions,
        sourceId: photo.sourceId
      }));

      res.json({
        success: true,
        data: photos,
        pagination: {
          total: result.total,
          offset: result.offset,
          limit: result.limit,
          hasMore: result.offset + photos.length < result.total
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/photos/:id
   * Get a single photo by ID
   */
  router.get('/photos/:id', (req, res) => {
    try {
      const photo = galleryService.getPhoto(req.params.id);
      
      if (!photo) {
        return res.status(404).json({
          success: false,
          error: 'Photo not found'
        });
      }

      res.json({
        success: true,
        data: {
          id: photo.id,
          url: `/photowall/api/display/${photo.id}`,
          originalUrl: `/photowall/api/image/${photo.id}`,
          thumbnail: `/photowall/api/thumbnail/${photo.id}`,
          blurPlaceholder: photo.blurPlaceholder, // LQIP for lazy loading
          title: photo.title,
          category: photo.category,
          date: photo.date,
          location: photo.location,
          exif: photo.exif,
          dimensions: photo.dimensions,
          sourceId: photo.sourceId
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // ==================== IMAGES ====================

  /**
   * GET /api/image/:id
   * Serve the full-resolution image
   */
  router.get('/image/:id', async (req, res) => {
    try {
      const photo = galleryService.getPhoto(req.params.id);
      
      if (!photo) {
        return res.status(404).json({
          success: false,
          error: 'Photo not found'
        });
      }

      // Check if file exists
      if (!await fs.pathExists(photo.originalPath)) {
        return res.status(404).json({
          success: false,
          error: 'Image file not found'
        });
      }

      // Set cache headers (use hash instead of ID to avoid invalid characters in ETag)
      res.set('Cache-Control', 'public, max-age=31536000');
      res.set('ETag', `"${photo.lastModified || photo.id.replace(/[^a-zA-Z0-9]/g, '-')}"`);

      // Send file
      res.sendFile(photo.originalPath);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/display/:id
   * Serve 4K compressed display image (for slideshow)
   */
  router.get('/display/:id', async (req, res) => {
    try {
      const photo = galleryService.getPhoto(req.params.id);

      if (!photo) {
        return res.status(404).json({ success: false, error: 'Photo not found' });
      }

      if (!await fs.pathExists(photo.originalPath)) {
        return res.status(404).json({ success: false, error: 'Image file not found' });
      }

      // Generate or get cached 4K display image
      const display = await galleryService.imageProcessor.getDisplayImage(photo.originalPath);

      if (!display) {
        // Fallback to original if display generation fails
        return res.sendFile(photo.originalPath);
      }

      res.set('Cache-Control', 'public, max-age=31536000');
      res.set('ETag', `"disp-${photo.lastModified || photo.id.replace(/[^a-zA-Z0-9]/g, '-')}"`);
      res.sendFile(display.path);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/thumbnail/:id
   * Serve the thumbnail image
   */
  router.get('/thumbnail/:id', async (req, res) => {
    try {
      const photo = galleryService.getPhoto(req.params.id);
      
      if (!photo) {
        return res.status(404).json({
          success: false,
          error: 'Photo not found'
        });
      }

      // Check if thumbnail exists
      if (!await fs.pathExists(photo.thumbnailPath)) {
        // Try to regenerate thumbnail
        try {
          await galleryService.imageProcessor.getThumbnail(photo.originalPath);
        } catch {
          return res.status(404).json({
            success: false,
            error: 'Thumbnail not available'
          });
        }
      }

      // Set cache headers (use hash instead of filename to avoid invalid characters in ETag)
      res.set('Cache-Control', 'public, max-age=31536000');
      res.set('ETag', `"${photo.lastModified || photo.thumbnailFilename.replace(/[^a-zA-Z0-9]/g, '-')}"`);

      // Send file
      res.sendFile(photo.thumbnailPath);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // ==================== CATEGORIES ====================

  /**
   * GET /api/categories
   * Get all available categories
   */
  router.get('/categories', (req, res) => {
    try {
      const categories = galleryService.getCategories();
      res.json({
        success: true,
        data: categories
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // ==================== SOURCES ====================

  /**
   * GET /api/sources
   * Get all image sources
   */
  router.get('/sources', (req, res) => {
    try {
      const sources = galleryService.getSources();
      res.json({
        success: true,
        data: sources.map(s => ({
          id: s.id,
          name: s.name,
          type: s.type,
          path: s.path,
          enabled: s.enabled,
          photoCount: s.photoCount,
          lastScanned: s.lastScanned,
          status: s.status,
          watch: s.watch
        }))
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/sources
   * Add a new image source
   */
  router.post('/sources', requireAdmin, async (req, res) => {
    try {
      const { id, name, type = 'local', path: sourcePath, enabled = true, defaultCategory = 'General', useFolderAsCategory = true, watch = true } = req.body;

      if (!id || !name || !sourcePath) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: id, name, path'
        });
      }

      const source = await galleryService.addSource({
        id,
        name,
        type,
        path: sourcePath,
        enabled,
        defaultCategory,
        useFolderAsCategory,
        watch
      });

      res.json({
        success: true,
        data: {
          id: source.id,
          name: source.name,
          type: source.type,
          path: source.path,
          enabled: source.enabled,
          photoCount: source.photoCount,
          lastScanned: source.lastScanned,
          status: source.status
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * PUT /api/sources/:id
   * Update an image source
   */
  router.put('/sources/:id', requireAdmin, async (req, res) => {
    try {
      const source = await galleryService.updateSource(req.params.id, req.body);
      
      res.json({
        success: true,
        data: {
          id: source.id,
          name: source.name,
          type: source.type,
          path: source.path,
          enabled: source.enabled,
          photoCount: source.photoCount,
          lastScanned: source.lastScanned,
          status: source.status
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * DELETE /api/sources/:id
   * Remove an image source
   */
  router.delete('/sources/:id', requireAdmin, async (req, res) => {
    try {
      await galleryService.removeSource(req.params.id);
      res.json({
        success: true,
        message: 'Source removed successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/sources/:id/scan
   * Trigger a scan for a specific source
   */
  router.post('/sources/:id/scan', requireAdmin, async (req, res) => {
    try {
      const images = await galleryService.scanSource(req.params.id);
      res.json({
        success: true,
        message: `Scanned ${images.length} images`,
        count: images.length
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // ==================== SYSTEM ====================

  /**
   * GET /api/stats
   * Get gallery statistics
   */
  router.get('/stats', (req, res) => {
    try {
      const stats = galleryService.getStats();
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/refresh
   * Trigger a full refresh of all sources
   */
  router.post('/refresh', requireAdmin, async (req, res) => {
    try {
      await galleryService.refreshAll();
      const stats = galleryService.getStats();
      res.json({
        success: true,
        message: 'Refresh completed',
        data: stats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/reset
   * Reset: clear all thumbnail cache and rebuild from scratch
   */
  router.post('/reset', requireAdmin, async (req, res) => {
    try {
      console.log('🔄 Starting full reset...');
      
      // Clear all thumbnail cache
      const cacheStats = await galleryService.imageProcessor.getCacheStats();
      await galleryService.imageProcessor.clearAllCache();
      console.log(`🧹 Cleared ${cacheStats.count} cached thumbnails`);
      
      // Force rescan all sources
      await galleryService.refreshAll();
      
      const stats = galleryService.getStats();
      res.json({
        success: true,
        message: 'Reset completed - cache cleared and rebuilt',
        data: {
          ...stats,
          cacheCleared: cacheStats.count,
          cacheSizeBefore: cacheStats.totalSizeMB
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/config
   * Get current configuration (safe subset)
   */
  router.get('/config', (req, res) => {
    try {
      res.json({
        success: true,
        data: {
          appName: config.appName,
          photographerName: config.photographerName,
          supportedFormats: config.supportedFormats,
          autoRefreshInterval: config.autoRefreshInterval,
          enableFileWatcher: config.enableFileWatcher,
          aiApiEndpoint: config.aiApiEndpoint || '',
          aiApiKey: config.aiApiKey ? '••••••••' : '',
          aiModel: config.aiModel || 'multimodal-large',
          enableAutoAnalysis: config.enableAutoAnalysis || false,
          maxConcurrentAnalysis: config.maxConcurrentAnalysis || 2,
          aiProviders: aiAnalysisService.getSafeProviders()
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // ==================== DELETE PHOTO ====================

  /**
   * DELETE /api/photo/:id
   * Delete a photo (both original file and thumbnail)
   */
  router.delete('/photo/:id', requireAdmin, async (req, res) => {
    try {
      const photo = galleryService.getPhoto(req.params.id);
      
      if (!photo) {
        return res.status(404).json({
          success: false,
          error: 'Photo not found'
        });
      }

      // Delete the original file
      const originalPath = photo.originalPath;
      if (await fs.pathExists(originalPath)) {
        await fs.remove(originalPath);
      }

      // Delete thumbnail from cache
      await galleryService.imageProcessor.deleteThumbnail(photo.id);

      // Remove from gallery service
      galleryService.removePhoto(photo.id);

      res.json({
        success: true,
        message: 'Photo deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // ==================== CACHE MANAGEMENT ====================

  /**
   * GET /api/cache/stats
   * Get thumbnail cache statistics
   */
  router.get('/cache/stats', async (req, res) => {
    try {
      const stats = await galleryService.imageProcessor.getCacheStats();
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/cache/clean
   * Clean up old cached thumbnails
   */
  router.post('/cache/clean', requireAdmin, async (req, res) => {
    try {
      const { validHashes } = req.body || {};
      const cleaned = await galleryService.imageProcessor.cleanupCache(validHashes || []);
      res.json({
        success: true,
        message: `Cleaned ${cleaned} cached thumbnails`,
        data: { cleaned }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * PUT /api/config
   * Update configuration
   */
  router.put('/config', requireAdmin, async (req, res) => {
    try {
      const { appName, photographerName } = req.body;
      
      if (appName) config.appName = appName;
      if (photographerName) config.photographerName = photographerName;
      
      // AI Analysis config
      await applyAiConfig(req.body);

      res.json({
        success: true,
        message: 'Configuration updated',
        data: {
          appName: config.appName,
          photographerName: config.photographerName,
          aiApiEndpoint: config.aiApiEndpoint,
          aiModel: config.aiModel,
          enableAutoAnalysis: config.enableAutoAnalysis,
          maxConcurrentAnalysis: config.maxConcurrentAnalysis || 2,
          aiProviders: aiAnalysisService.getSafeProviders()
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // ==================== ORIENTATION ====================

  /**
   * GET /api/orientations
   * Get all photo orientations (for slideshow)
   */
  router.get('/orientations', async (req, res) => {
    try {
      const photos = galleryService.getPhotos({}).photos;
      const orientations = await orientationService.getOrientations(photos);
      
      res.json({
        success: true,
        orientations,
        cacheInfo: orientationService.getCacheInfo()
      });
    } catch (error) {
      console.error('Error getting orientations:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/orientations/clear
   * Clear orientation cache
   */
  router.post('/orientations/clear', requireAdmin, async (req, res) => {
    try {
      const result = await orientationService.clearCache();
      res.json({
        success: result,
        message: result ? 'Cache cleared successfully' : 'Failed to clear cache'
      });
    } catch (error) {
      console.error('Error clearing orientations:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/orientations/cache
   * Get cache info
   */
  router.get('/orientations/cache', (req, res) => {
    try {
      const cacheInfo = orientationService.getCacheInfo();
      res.json({
        success: true,
        cacheInfo
      });
    } catch (error) {
      console.error('Error getting cache info:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // ==================== CREATIONS ====================

  router.get('/creations/prompts', (req, res) => {
    try {
      res.json({
        success: true,
        data: creativeService.getPromptSuggestions()
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/creations/templates', (req, res) => {
    try {
      res.json({
        success: true,
        data: creativeService.getTemplates()
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/creations/select', async (req, res) => {
    try {
      const result = await creativeService.selectPhotos(req.body || {});
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/creations/collage', requireAdmin, async (req, res) => {
    try {
      const result = await creativeService.createCollage(req.body || {});
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/creations/video-demo', requireAdmin, async (req, res) => {
    try {
      const result = await creativeService.createVideoDemo(req.body || {});
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/creations/file/:filename', async (req, res) => {
    try {
      const filePath = creativeService.getCreationFile(req.params.filename);
      if (!await fs.pathExists(filePath)) {
        return res.status(404).json({ success: false, error: 'Creation file not found' });
      }
      res.set('Cache-Control', 'public, max-age=86400');
      res.sendFile(filePath);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ==================== AI ANALYSIS ====================
  // NOTE: Specific routes (search, stats, cache, test) must be defined BEFORE
  // parameterized routes (:id) to avoid being caught as photo IDs

  /**
   * POST /api/analysis/test
   * Test AI API connection with a simple request
   */
  router.post('/analysis/test', requireAdmin, async (req, res) => {
    try {
      const { providerId } = req.body;
      const provider = providerId ? aiAnalysisService.getProvider(providerId) : null;
      const apiEndpoint = provider?.apiEndpoint || req.body.apiEndpoint;
      const apiKey = provider?.apiKey || req.body.apiKey;
      const model = provider?.model || req.body.model;
      
      if (!apiEndpoint || !apiKey) {
        return res.status(400).json({
          success: false,
          error: 'API endpoint and key are required'
        });
      }

      // Test with a simple request (no image, just text)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const testResponse = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || 'multimodal-large',
          messages: [{ role: 'user', content: 'Hello, this is a test.' }],
          max_tokens: 10
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!testResponse.ok) {
        const errorText = await testResponse.text();
        throw new Error(`API returned ${testResponse.status}: ${errorText}`);
      }

      const data = await testResponse.json();
      
      res.json({
        success: true,
        message: 'API connection successful',
        model: data.model || model,
        response: data.choices?.[0]?.message?.content || 'OK'
      });
    } catch (error) {
      console.error('API test failed:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/analysis/batch
   * Batch analyze multiple photos
   */
  router.post('/analysis/batch', requireAdmin, async (req, res) => {
    try {
      const { photoIds } = req.body;
      
      if (!Array.isArray(photoIds)) {
        return res.status(400).json({
          success: false,
          error: 'photoIds must be an array'
        });
      }

      if (!aiAnalysisService.isAvailable()) {
        return res.status(503).json({
          success: false,
          error: 'AI analysis not configured'
        });
      }

      const photos = photoIds
        .map(id => galleryService.getPhoto(id))
        .filter(Boolean);

      const job = aiAnalysisService.createBatchJob(photos);

      res.json({
        success: true,
        data: job
      });
    } catch (error) {
      console.error('Error in batch analysis:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/analysis/search
   * Search photos by tags and description (fuzzy matching)
   */
  router.get('/analysis/search', async (req, res) => {
    try {
      const { q: query } = req.query;
      
      if (!query) {
        return res.status(400).json({
          success: false,
          error: 'Query parameter "q" is required'
        });
      }

      // Allow search if we have cached analyses (even without API config)
      const cacheSize = aiAnalysisService.cache?.size || 0;
      if (cacheSize === 0 && !aiAnalysisService.isAvailable()) {
        return res.status(503).json({
          success: false,
          error: 'AI analysis not configured and no cached data available'
        });
      }

      const allPhotos = galleryService.getPhotos({}).photos;
      const results = await aiAnalysisService.searchByQuery(query, allPhotos);

      res.json({
        success: true,
        query,
        total: results.length,
        data: results.map(r => ({
          photo: {
            id: r.photo.id,
            url: `/photowall/api/display/${r.photo.id}`,
            originalUrl: `/photowall/api/image/${r.photo.id}`,
            thumbnail: `/photowall/api/thumbnail/${r.photo.id}`,
            title: r.photo.title,
            category: r.photo.category,
            date: r.photo.date
          },
          analysis: {
            tags: r.analysis.tags || [],
            category: r.analysis.category,
            description: r.analysis.description
          },
          relevanceScore: r.relevanceScore,
          matchedFields: r.matchedFields || []
        }))
      });
    } catch (error) {
      console.error('Error searching photos:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/analysis/stats
   * Get AI analysis statistics
   */
  router.get('/analysis/stats', (req, res) => {
    try {
      const stats = aiAnalysisService.getStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting analysis stats:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * DELETE /api/analysis/cache
   * Clear AI analysis cache
   */
  router.delete('/analysis/cache', requireAdmin, async (req, res) => {
    try {
      await aiAnalysisService.clearCache();
      
      res.json({
        success: true,
        message: 'AI analysis cache cleared'
      });
    } catch (error) {
      console.error('Error clearing analysis cache:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/analysis/status
   * Get analysis status for all photos (efficient batch check)
   */
  router.get('/analysis/status', (req, res) => {
    try {
      const allPhotos = galleryService.getPhotos({}).photos;
      const analyzedIds = new Set();
      
      // Get all analyzed photo IDs from cache
      // Cache key is now photoId directly (changed from MD5 hash)
      for (const [cacheKey, analysis] of aiAnalysisService.cache) {
        // cacheKey is now the photoId
        if (analysis) {
          analyzedIds.add(cacheKey);
        }
      }
      
      const analyzed = [];
      const unanalyzed = [];
      
      for (const photo of allPhotos) {
        if (analyzedIds.has(photo.id)) {
          analyzed.push({
            id: photo.id,
            title: photo.title,
            thumbnail: photo.thumbnailPath
          });
        } else {
          unanalyzed.push({
            id: photo.id,
            title: photo.title,
            thumbnail: photo.thumbnailPath
          });
        }
      }
      
      res.json({
        success: true,
        data: {
          total: allPhotos.length,
          analyzed: analyzed.length,
          unanalyzed: unanalyzed.length,
          analyzedPhotos: analyzed,
          unanalyzedPhotos: unanalyzed
        }
      });
    } catch (error) {
      console.error('Error getting analysis status:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/analysis/jobs
   * Get recent server-side batch analysis jobs
   */
  router.get('/analysis/jobs', (req, res) => {
    try {
      res.json({
        success: true,
        data: aiAnalysisService.getRecentBatchJobs()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/analysis/jobs/:jobId
   * Get a server-side batch analysis job
   */
  router.get('/analysis/jobs/:jobId', (req, res) => {
    try {
      const job = aiAnalysisService.getBatchJob(req.params.jobId);
      if (!job) {
        return res.status(404).json({
          success: false,
          error: 'Analysis job not found'
        });
      }

      res.json({
        success: true,
        data: job
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/analysis/config/export
   * Export AI provider queue config, including API keys.
   */
  router.get('/analysis/config/export', requireAdmin, (req, res) => {
    try {
      res.json({
        success: true,
        data: aiAnalysisService.getExportConfig()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/analysis/config/import
   * Import AI provider queue config from JSON.
   */
  router.post('/analysis/config/import', requireAdmin, async (req, res) => {
    try {
      const imported = req.body?.data || req.body || {};
      const providers = imported.providers || imported.aiProviders;

      if (!Array.isArray(providers)) {
        return res.status(400).json({
          success: false,
          error: 'AI config JSON must include a providers array'
        });
      }

      await applyAiConfig({
        enableAutoAnalysis: imported.enableAutoAnalysis,
        maxConcurrentAnalysis: imported.maxConcurrentAnalysis,
        aiProviders: providers
      });

      res.json({
        success: true,
        message: 'AI provider config imported',
        data: {
          enableAutoAnalysis: config.enableAutoAnalysis,
          maxConcurrentAnalysis: config.maxConcurrentAnalysis || 2,
          aiProviders: aiAnalysisService.getSafeProviders()
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/analysis/:id
   * Get AI analysis for a specific photo
   * NOTE: Must be defined AFTER specific routes to avoid catching them as IDs
   */
  router.get('/analysis/:id', async (req, res) => {
    try {
      const photo = galleryService.getPhoto(req.params.id);
      
      if (!photo) {
        return res.status(404).json({
          success: false,
          error: 'Photo not found'
        });
      }

      const cachedAnalysis = aiAnalysisService.getCachedAnalysis(photo);
      if (cachedAnalysis) {
        return res.json({
          success: true,
          data: cachedAnalysis
        });
      }

      if (!aiAnalysisService.isAvailable()) {
        return res.status(503).json({
          success: false,
          error: 'AI analysis not configured and no cached analysis available'
        });
      }

      const analysis = await aiAnalysisService.getAnalysis(photo);
      
      res.json({
        success: true,
        data: analysis
      });
    } catch (error) {
      console.error('Error getting AI analysis:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/analysis/:id
   * Trigger AI analysis for a specific photo
   * Query params: ?force=true to force re-analysis
   * NOTE: Must be defined AFTER specific routes to avoid catching them as IDs
   */
  router.post('/analysis/:id', requireAdmin, async (req, res) => {
    try {
      const photo = galleryService.getPhoto(req.params.id);
      
      if (!photo) {
        return res.status(404).json({
          success: false,
          error: 'Photo not found'
        });
      }

      if (!aiAnalysisService.isAvailable()) {
        return res.status(503).json({
          success: false,
          error: 'AI analysis not configured'
        });
      }

      const force = req.query.force === 'true';
      const analysis = await aiAnalysisService.analyzeImage(photo, force);
      
      res.json({
        success: true,
        data: analysis
      });
    } catch (error) {
      console.error('Error analyzing image:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // ==================== BGM (Background Music) ====================

  /**
   * GET /api/bgm/list
   * Get list of background music files
   */
  router.get('/bgm/list', async (req, res) => {
    try {
      const __dirname = path.dirname(new URL(import.meta.url).pathname);
      const bgmDir = path.resolve(__dirname, '../../bgm');
      
      if (!await fs.pathExists(bgmDir)) {
        return res.json({
          success: true,
          data: []
        });
      }

      const files = await fs.readdir(bgmDir);
      const musicFiles = files
        .filter(file => {
          const ext = path.extname(file).toLowerCase();
          return ['.mp3', '.m4a', '.aac', '.wav', '.ogg'].includes(ext);
        })
        .map(file => ({
          id: path.basename(file, path.extname(file)),
          filename: file,
          url: `/photowall/api/bgm/${encodeURIComponent(file)}`
        }));

      res.json({
        success: true,
        data: musicFiles
      });
    } catch (error) {
      console.error('Error listing BGM:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/bgm/:filename
   * Serve a background music file
   */
  router.get('/bgm/:filename', async (req, res) => {
    try {
      const __dirname = path.dirname(new URL(import.meta.url).pathname);
      const bgmDir = path.resolve(__dirname, '../../bgm');
      const filename = decodeURIComponent(req.params.filename);
      const filePath = path.join(bgmDir, filename);

      // Security check: ensure file is within BGM directory
      if (!filePath.startsWith(bgmDir)) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

      if (!await fs.pathExists(filePath)) {
        return res.status(404).json({
          success: false,
          error: 'Music file not found'
        });
      }

      // Set cache headers
      res.set('Cache-Control', 'public, max-age=31536000');
      
      // Send file
      res.sendFile(filePath);
    } catch (error) {
      console.error('Error serving BGM:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
}

export default createApiRouter;
