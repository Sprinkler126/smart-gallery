/**
 * API Routes
 * RESTful API endpoints for the gallery
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';
import orientationService from '../services/orientationService.js';
import { CreativeService } from '../services/creativeService.js';
import { ExifFrameService } from '../services/exifFrameService.js';

// Use native fetch (Node.js 18+)
const fetch = globalThis.fetch || (await import('node-fetch')).default;

export function createApiRouter(galleryService, aiAnalysisService, vectorSearchService, config, authService) {
  const router = Router();
  const resetJobs = new Map();
  const loginAttempts = new Map();
  const creativeService = new CreativeService({
    galleryService,
    aiAnalysisService,
    config,
    baseDir: process.cwd()
  });
  const exifFrameService = new ExifFrameService({
    galleryService,
    config,
    baseDir: process.cwd()
  });

  const withTimeout = (promise, timeoutMs) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Vector search timed out')), timeoutMs))
  ]);

  const fuseSearchResults = (query, lexicalResults, vectorResults, photos) => {
    const photoById = new Map(photos.map(photo => [photo.id, photo]));
    const analysisById = new Map([...aiAnalysisService.cache.values()].map(analysis => [analysis.photoId, analysis]));
    const lexicalById = new Map(lexicalResults.map((result, index) => [result.photo.id, { ...result, rank: index + 1 }]));
    const vectorById = new Map(vectorResults.map((result, index) => [result.photoId, { ...result, rank: index + 1 }]));
    const ids = new Set([...lexicalById.keys(), ...vectorById.keys()]);
    const normalizedQuery = query.trim().toLowerCase();

    return [...ids].map(photoId => {
      const lexical = lexicalById.get(photoId);
      const vector = vectorById.get(photoId);
      const photo = photoById.get(photoId);
      const analysis = lexical?.analysis || analysisById.get(photoId);
      if (!photo || !analysis) return null;
      const tags = (analysis.tags || []).map(tag => String(tag).toLowerCase());
      const exactTag = tags.includes(normalizedQuery);
      const exactPhrase = [analysis.description, analysis.category, photo.title, photo.location].filter(Boolean).some(value => String(value).toLowerCase().includes(normalizedQuery));
      const rrf = (lexical ? 1 / (60 + lexical.rank) : 0) + (vector ? 1 / (60 + vector.rank) : 0);
      const relevanceScore = rrf + (exactTag ? 1 : 0) + (exactPhrase ? 0.2 : 0);
      return {
        photo,
        analysis,
        relevanceScore,
        matchedFields: lexical?.matchedFields || [],
        semanticScore: vector?.similarity ?? null,
        exactMatch: exactTag || exactPhrase
      };
    }).filter(Boolean).sort((a, b) => b.relevanceScore - a.relevanceScore);
  };

  const getDependencyStatus = async () => {
    const logoDir = path.resolve('./public/brand-logos');
    const logoFiles = await fs.readdir(logoDir).catch(() => []);
    const logos = logoFiles.filter(name => /\.(svg|png|jpe?g|webp)$/i.test(name)).sort();
    return {
      vectorModel: vectorSearchService.getStatus(),
      logoPack: {
        source: 'WorldVectorLogo',
        termsUrl: 'https://worldvectorlogo.com/about',
        apiKeyConfigured: Boolean(process.env.WORLD_VECTOR_LOGO_API_KEY),
        count: logos.length,
        logos,
        missing: BRAND_LOGO_PACK.filter(item => !logos.includes(`${item.slug}.svg`)).map(item => item.slug),
        available: BRAND_LOGO_PACK.filter(item => logos.includes(`${item.slug}.svg`)).map(item => ({ brand: item.brand, slug: item.slug }))
      }
    };
  };

  const parseCustomLogo = (dataUrl) => {
    if (!dataUrl) return null;
    const match = /^data:image\/(svg\+xml|png|jpeg|webp);base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
    if (!match) throw new Error('自定义 Logo 必须是 SVG、PNG、JPEG 或 WebP 图片。');
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 2 * 1024 * 1024) throw new Error('自定义 Logo 不能为空且不能超过 2MB。');
    if (match[1].toLowerCase() === 'svg+xml' && !buffer.toString('utf8', 0, 256).includes('<svg')) throw new Error('SVG Logo 内容无效。');
    return buffer;
  };

  const BRAND_LOGO_PACK = [
    ['Canon', 'canon-2'], ['Nikon', 'nikon'], ['Sony', 'sony'], ['Fujifilm', 'fujifilm'],
    ['Leica', 'leica'], ['Panasonic', 'panasonic'], ['Olympus', 'olympus'], ['DJI', 'dji'],
    ['Apple', 'apple'], ['Xiaomi', 'xiaomi'], ['Huawei', 'huawei'], ['Samsung', 'samsung'],
    ['GoPro', 'gopro'], ['Ricoh', 'ricoh'], ['Pentax', 'pentax'], ['Sigma', 'sigma']
  ].map(([brand, sourceSlug]) => ({ brand, slug: brand.toLowerCase().replace(/[^a-z0-9]+/g, '-'), sourceSlug }));
  let logoDownloadPromise = null;

  const downloadBrandLogoPack = async () => {
    const logoDir = path.resolve('./public/brand-logos');
    await fs.ensureDir(logoDir);
    const results = [];
    for (const item of BRAND_LOGO_PACK) {
      const outputPath = path.join(logoDir, `${item.slug}.svg`);
      if (await fs.pathExists(outputPath)) { results.push({ ...item, status: 'already_installed' }); continue; }
      try {
        const headers = { Accept: 'application/json' };
        if (process.env.WORLD_VECTOR_LOGO_API_KEY) headers.Authorization = `Bearer ${process.env.WORLD_VECTOR_LOGO_API_KEY}`;
        const response = await fetch(`https://worldvectorlogo.com/api/v1/logos/${encodeURIComponent(item.sourceSlug)}`, { headers });
        if (!response.ok) throw new Error(`source returned ${response.status}`);
        const payload = await response.json();
        const svg = payload?.data?.svg_content || payload?.svg_content;
        if (typeof svg !== 'string' || !svg.trimStart().startsWith('<svg') || svg.length > 5_000_000) throw new Error('source did not return a valid SVG');
        await fs.writeFile(outputPath, svg, 'utf8');
        results.push({ ...item, status: 'downloaded' });
      } catch (error) {
        results.push({ ...item, status: 'failed', error: error.message });
      }
    }
    return results;
  };

  const requireAdmin = (req, res, next) => {
    if (authService.getSession(req)) {
      return next();
    }
    return res.status(401).json({
      success: false,
      error: authService.isConfigured() ? 'Admin authentication required' : '管理员认证尚未在此服务器初始化。'
    });
  };

  const takeLoginAttempt = (req) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempts = (loginAttempts.get(key) || []).filter(timestamp => now - timestamp < 15 * 60 * 1000);
    if (attempts.length >= 5) return false;
    attempts.push(now);
    loginAttempts.set(key, attempts);
    return true;
  };

  const serializeResetJob = (job) => ({
    id: job.id,
    type: job.type,
    status: job.status,
    step: job.step,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error,
    result: job.result
  });

  const getActiveResetJob = () => Array.from(resetJobs.values())
    .find(job => job.status === 'queued' || job.status === 'running');

  const updateResetJob = (job, updates) => {
    Object.assign(job, updates, { updatedAt: new Date().toISOString() });
  };

  const processResetJob = async (jobId) => {
    const job = resetJobs.get(jobId);
    if (!job) return;

    try {
      updateResetJob(job, { status: 'running', step: 'Reading cache stats' });
      console.log(`🔄 Starting reset job ${job.id}...`);

      const cacheStats = await galleryService.imageProcessor.getCacheStats();

      updateResetJob(job, { step: 'Clearing derived image cache' });
      const clearResult = await galleryService.imageProcessor.clearAllCache();
      if (!clearResult?.success) {
        throw new Error(clearResult?.error || 'Failed to clear derived image cache');
      }
      console.log(`🧹 Reset job ${job.id}: cleared ${cacheStats?.count || 0} cached thumbnails`);

      updateResetJob(job, { step: 'Rebuilding gallery catalog' });
      await galleryService.refreshAll();

      const stats = galleryService.getStats();
      updateResetJob(job, {
        status: 'completed',
        step: 'Completed',
        result: {
          ...stats,
          cacheCleared: cacheStats?.count || 0,
          cacheSizeBefore: cacheStats?.totalSizeMB || '0.00'
        }
      });
      console.log(`✅ Reset job ${job.id} completed`);
    } catch (error) {
      updateResetJob(job, {
        status: 'failed',
        step: 'Failed',
        error: error.message
      });
      console.error(`❌ Reset job ${job.id} failed:`, error);
    }
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
    if (updates.vectorSearchEnabled !== undefined) config.vectorSearch = { ...(config.vectorSearch || {}), enabled: updates.vectorSearchEnabled === true };
    if (updates.vectorSearchModelId !== undefined) config.vectorSearch = { ...(config.vectorSearch || {}), modelId: updates.vectorSearchModelId };
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
    vectorSearchService.updateRuntimeConfig(config.vectorSearch || {});
    if (vectorSearchService.isEnabled()) vectorSearchService.scheduleBatch([...aiAnalysisService.cache.values()]);

    const configPath = path.resolve('./server/config.json');
    await fs.writeJson(configPath, config, { spaces: 2 });
  };

  // ==================== PHOTOS ====================

  router.get('/auth/session', (req, res) => {
    const session = authService.getSession(req);
    res.json({ success: true, data: { authenticated: Boolean(session), role: session?.role || 'visitor' } });
  });

  router.post('/auth/login', async (req, res) => {
    if (!authService.isConfigured()) return res.status(503).json({ success: false, error: '管理员认证尚未初始化。' });
    if (!takeLoginAttempt(req)) return res.status(429).json({ success: false, error: '登录尝试过多，请 15 分钟后重试。' });
    try {
      const passwordValid = await authService.verifyPassword(req.body?.password);
      const totpValid = passwordValid && authService.verifyTotp(req.body?.code);
      if (!totpValid) return res.status(401).json({ success: false, error: '密码或动态验证码错误。' });
      authService.setSessionCookie(req, res, authService.createSession());
      loginAttempts.delete(req.ip || req.socket.remoteAddress || 'unknown');
      res.json({ success: true, data: { authenticated: true, role: 'admin' } });
    } catch (error) {
      console.error('Admin login failed:', error.message);
      res.status(500).json({ success: false, error: '管理员登录不可用。' });
    }
  });

  router.post('/auth/logout', (req, res) => {
    authService.clearSessionCookie(req, res);
    res.json({ success: true });
  });

  // Public dependency status and download endpoints. The model ID is server-configured;
  // callers cannot supply arbitrary URLs or package names.
  router.get('/dependencies', async (_req, res) => {
    res.json({ success: true, data: await getDependencyStatus() });
  });

  router.post('/dependencies/vector-model/download', async (_req, res) => {
    try {
      const status = await vectorSearchService.downloadModel();
      res.json({ success: true, data: status });
    } catch (error) {
      res.status(503).json({ success: false, error: error.message, data: vectorSearchService.getStatus() });
    }
  });

  router.post('/dependencies/brand-logos/download', async (req, res) => {
    if (req.body?.acceptTerms !== true) {
      return res.status(400).json({ success: false, error: '请先确认 WorldVectorLogo 的商标与使用条款。' });
    }
    try {
      if (!logoDownloadPromise) logoDownloadPromise = downloadBrandLogoPack();
      const results = await logoDownloadPromise;
      const status = await getDependencyStatus();
      res.json({ success: true, data: { results, status } });
    } catch (error) {
      res.status(503).json({ success: false, error: error.message });
    } finally {
      logoDownloadPromise = null;
    }
  });

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
        previewUrl: `/photowall/api/preview/${photo.id}`,
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
          previewUrl: `/photowall/api/preview/${photo.id}`,
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
   * GET /api/preview/:id
   * Serve 1920px progressive preview image (for slideshow warm-up)
   */
  router.get('/preview/:id', async (req, res) => {
    try {
      const photo = galleryService.getPhoto(req.params.id);

      if (!photo) {
        return res.status(404).json({ success: false, error: 'Photo not found' });
      }

      if (!await fs.pathExists(photo.originalPath)) {
        return res.status(404).json({ success: false, error: 'Image file not found' });
      }

      const preview = await galleryService.imageProcessor.getPreviewImage(photo.originalPath);

      if (!preview) {
        return res.status(404).json({ success: false, error: 'Preview image not available' });
      }

      res.set('Cache-Control', 'public, max-age=31536000');
      res.set('ETag', `"prev-${photo.lastModified || photo.id.replace(/[^a-zA-Z0-9]/g, '-')}"`);
      res.sendFile(preview.path);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
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
      const activeResetJob = getActiveResetJob();
      if (activeResetJob) {
        return res.status(409).json({
          success: false,
          error: 'Reset cache is already running',
          data: serializeResetJob(activeResetJob)
        });
      }

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
   * Start a background reset job: clear derived image cache and rebuild from scratch
   */
  router.post('/reset', requireAdmin, async (req, res) => {
    try {
      const activeResetJob = getActiveResetJob();
      if (activeResetJob) {
        return res.status(409).json({
          success: false,
          error: 'Reset cache is already running',
          data: serializeResetJob(activeResetJob)
        });
      }

      if (galleryService.isScanning) {
        return res.status(409).json({
          success: false,
          error: 'Gallery scan is already running. Try reset after the current scan finishes.'
        });
      }

      const now = new Date().toISOString();
      const job = {
        id: crypto.randomUUID(),
        type: 'reset-cache',
        status: 'queued',
        step: 'Queued',
        createdAt: now,
        updatedAt: now,
        error: null,
        result: null
      };

      resetJobs.set(job.id, job);
      setTimeout(() => processResetJob(job.id), 0);

      res.json({
        success: true,
        message: 'Reset cache job started',
        data: serializeResetJob(job)
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/reset/jobs/:jobId
   * Get reset cache job status
   */
  router.get('/reset/jobs/:jobId', requireAdmin, (req, res) => {
    try {
      const job = resetJobs.get(req.params.jobId);
      if (!job) {
        return res.status(404).json({
          success: false,
          error: 'Reset job not found'
        });
      }

      res.json({
        success: true,
        data: serializeResetJob(job)
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/reset-sync
   * Legacy synchronous reset endpoint.
   */
  router.post('/reset-sync', requireAdmin, async (req, res) => {
    try {
      console.log('🔄 Starting full reset...');
      
      // Clear derived image cache
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
          aiProviders: aiAnalysisService.getSafeProviders(),
          vectorSearch: vectorSearchService.getStatus()
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

  // ==================== EXIF FRAME ====================

  router.get('/exif-frame/templates', (req, res) => {
    try {
      res.json({
        success: true,
        data: exifFrameService.getTemplates()
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/exif-frame/file/:filename', async (req, res) => {
    try {
      const filePath = exifFrameService.getFrameFile(req.params.filename);
      if (!await fs.pathExists(filePath)) {
        return res.status(404).json({ success: false, error: 'EXIF frame file not found' });
      }
      res.set('Cache-Control', 'public, max-age=86400');
      res.sendFile(filePath);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/exif-frame/:id', (req, res) => {
    try {
      const result = exifFrameService.getPreview(req.params.id, req.query || {});
      res.json({ success: true, data: result });
    } catch (error) {
      const status = error.message === 'Photo not found' ? 404 : 500;
      res.status(status).json({ success: false, error: error.message });
    }
  });

  router.post('/exif-frame/:id', async (req, res) => {
    try {
      const result = await exifFrameService.createFrame({
        photoId: req.params.id,
        templateId: req.body?.templateId,
        overrides: req.body?.overrides || {},
        width: req.body?.width,
        customLogoBuffer: parseCustomLogo(req.body?.customLogoDataUrl)
      });
      res.json({ success: true, data: result });
    } catch (error) {
      const status = error.message === 'Photo not found' ? 404 : 500;
      res.status(status).json({ success: false, error: error.message });
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
      const lexicalResults = await aiAnalysisService.searchByQuery(query, allPhotos);
      let results = lexicalResults;
      let searchMode = 'lexical';
      let vectorStatus = vectorSearchService.getStatus();

      if (vectorStatus.enabled) {
        vectorSearchService.scheduleBatch([...aiAnalysisService.cache.values()]);
        try {
          const vectorResults = await withTimeout(
            vectorSearchService.search(query, 100),
            config.vectorSearch?.timeoutMs || 600
          );
          if (vectorResults.length > 0) {
            results = fuseSearchResults(query, lexicalResults, vectorResults, allPhotos);
            searchMode = 'hybrid';
          }
        } catch (error) {
          console.warn(`Vector search fallback: ${error.message}`);
          searchMode = 'lexical_fallback';
        }
        vectorStatus = vectorSearchService.getStatus();
      }

      res.json({
        success: true,
        query,
        total: results.length,
        searchMode,
        vectorSearch: vectorStatus,
        data: results.map(r => ({
          photo: {
            id: r.photo.id,
            url: `/photowall/api/display/${r.photo.id}`,
            previewUrl: `/photowall/api/preview/${r.photo.id}`,
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
          matchedFields: r.matchedFields || [],
          semanticScore: r.semanticScore ?? null
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
      vectorSearchService.scheduleIndex(analysis);
      
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
