/**
 * Gallery Service
 * Manages image sources, scanning, and real-time updates
 */

import fs from 'fs-extra';
import path from 'path';
import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import ImageProcessor from './imageProcessor.js';

export class GalleryService extends EventEmitter {
  constructor(config, databaseService = null) {
    super();
    this.config = config;
    this.database = databaseService;
    this.sources = new Map();
    this.photos = new Map();
    this.watchers = new Map();
    this.imageProcessor = new ImageProcessor(config);
    this.supportedFormats = config.supportedFormats || ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'];
    this.isScanning = false;
    this.lastScanTime = null;
    this.scans = new Map();
  }

  /**
   * Initialize all configured image sources
   */
  async initialize() {
    console.log('🖼️  Initializing Gallery Service...');

    if (this.database) {
      console.log(`   SQLite catalog contains ${this.database.getCatalogStats().totalPhotos} photos`);
    }
    
    for (const source of this.config.imageSources) {
      if (source.enabled) {
        await this.addSource(source);
      }
    }

    // Set up auto-refresh if configured
    if (this.config.autoRefreshInterval > 0) {
      setInterval(() => {
        this.refreshAll();
      }, this.config.autoRefreshInterval);
    }

    if (this.imageProcessor.thumbnailConfig.autoClean) await this.cleanThumbnailCache();

    console.log(`✅ Gallery Service initialized with ${this.sources.size} sources`);
  }

  /**
   * Add a new image source
   */
  async addSource(sourceConfig) {
    const { id, name, type, path: sourcePath, enabled, defaultCategory, useFolderAsCategory, watch } = sourceConfig;
    
    // Resolve path
    const resolvedPath = path.resolve(sourcePath);
    
    // Check if path exists
    if (!await fs.pathExists(resolvedPath)) {
      console.warn(`⚠️  Source path does not exist: ${resolvedPath}`);
      // Create the directory if it's a local source
      if (type === 'local') {
        await fs.ensureDir(resolvedPath);
        console.log(`📁 Created directory: ${resolvedPath}`);
      }
    }

    this.sources.set(id, {
      ...sourceConfig,
      resolvedPath,
      photoCount: 0,
      lastScanned: null,
      status: 'idle'
    });
    this.database?.upsertSource(this.sources.get(id));

    // Scan the source
    await this.scanSource(id);

    // Set up file watcher if enabled
    if (watch && this.config.enableFileWatcher) {
      this.setupWatcher(id, resolvedPath);
    }

    return this.sources.get(id);
  }

  /**
   * Remove an image source
   */
  async removeSource(sourceId) {
    // Stop watcher
    if (this.watchers.has(sourceId)) {
      this.watchers.get(sourceId).close();
      this.watchers.delete(sourceId);
    }

    // Remove photos from this source
    for (const [photoId, photo] of this.photos) {
      if (photo.sourceId === sourceId) {
        this.photos.delete(photoId);
      }
    }

    this.sources.delete(sourceId);
    this.database?.removePhotosBySource(sourceId);
    this.emit('sourceRemoved', sourceId);
  }

  /**
   * Set up file watcher for a source
   */
  setupWatcher(sourceId, sourcePath) {
    const source = this.sources.get(sourceId);
    if (!source) return;

    // Build glob pattern for supported formats
    const patterns = this.supportedFormats.map(ext => 
      path.join(sourcePath, '**', `*${ext}`)
    );

    const watcher = chokidar.watch(patterns, {
      ignored: /(^|[\/\\])\.|thumbnails/,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    });

    watcher
      .on('add', async (filePath) => {
        console.log(`📷 New image detected: ${filePath}`);
        await this.processNewImage(sourceId, filePath);
      })
      .on('change', async (filePath) => {
        console.log(`🔄 Image changed: ${filePath}`);
        await this.processChangedImage(sourceId, filePath);
      })
      .on('unlink', (filePath) => {
        console.log(`🗑️  Image removed: ${filePath}`);
        this.removeImage(sourceId, filePath);
      });

    this.watchers.set(sourceId, watcher);
    console.log(`👁️  Watching for changes in: ${sourcePath}`);
  }

  /**
   * Scan a single source for images
   */
  async scanSource(sourceId) {
    if (this.scans.has(sourceId)) return this.scans.get(sourceId);
    const task = this.performScan(sourceId);
    this.scans.set(sourceId, task);
    try { return await task; } finally { this.scans.delete(sourceId); }
  }

  async performScan(sourceId) {
    const source = this.sources.get(sourceId);
    if (!source) {
      throw new Error(`Source not found: ${sourceId}`);
    }

    source.status = 'scanning';
    this.emit('scanStart', sourceId);

    try {
      const images = await this.scanDirectory(
        source.resolvedPath,
        sourceId,
        source.defaultCategory,
        source.useFolderAsCategory
      );

      const activeIds = new Set(images.map(image => image.id));
      const existingIds = this.database ? this.database.getPhotoIds({ sourceId }) : [...this.photos.values()].filter(photo => photo.sourceId === sourceId).map(photo => photo.id);
      for (const photoId of existingIds) {
        const photo = this.database ? { sourceId } : this.photos.get(photoId);
        if (photo.sourceId === sourceId && !activeIds.has(photoId)) {
          this.photos.delete(photoId);
          this.emit('photoRemoved', photoId);
        }
      }

      // Update photos map
      for (const image of images) {
        if (!this.database) this.photos.set(image.id, image);
      }

      this.database?.upsertPhotos(images.filter(image => image.catalogChanged));

      this.database?.markMissingPhotosForSource(sourceId, [...activeIds]);

      source.photoCount = images.length;
      source.lastScanned = new Date().toISOString();
      source.status = 'ready';
      this.database?.upsertSource(source);

      this.emit('scanComplete', sourceId, images.length);
      console.log(`✅ Scanned ${images.length} images from ${source.name}`);

      return images;
    } catch (error) {
      source.status = 'error';
      source.error = error.message;
      this.database?.upsertSource(source);
      this.emit('scanError', sourceId, error);
      throw error;
    }
  }

  /**
   * Recursively scan a directory for images
   */
  async scanDirectory(dir, sourceId, defaultCategory = 'General', useFolderAsCategory = true, currentCategory = null) {
    const results = [];
    
    if (!await fs.pathExists(dir)) {
      return results;
    }

    const items = await fs.readdir(dir, { withFileTypes: true });
    const source = this.sources.get(sourceId);

    for (const item of items) {
      const fullPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        // Skip hidden folders and thumbnails
        if (item.name.startsWith('.') || item.name === 'thumbnails') continue;
        
        // Use folder name as category
        const category = useFolderAsCategory ? item.name : (currentCategory || defaultCategory);
        const subResults = await this.scanDirectory(fullPath, sourceId, defaultCategory, useFolderAsCategory, category);
        results.push(...subResults);
      } else if (this.isImageFile(item.name)) {
        try {
          const category = currentCategory || defaultCategory;
          const previous = this.database?.getPhotoByPath(fullPath) || [...this.photos.values()].find(photo => photo.originalPath === fullPath);
          const fileStats = await fs.stat(fullPath);
          // Catalog metadata and generated files can be reused until the source or processing format changes.
          if (previous?.metadataVersion === 1 && previous.sourceId === sourceId && previous.category === category
            && previous.lastModified === fileStats.mtime.toISOString() && previous.fileSize === fileStats.size
            && await fs.pathExists(previous.thumbnailPath)) {
            results.push(previous);
            continue;
          }
          const photo = await this.imageProcessor.processImage(fullPath, {
            sourceId,
            category,
            basePath: source.resolvedPath
          });
          // Skip unsupported formats (photo is null)
          if (photo) {
            photo.catalogChanged = true;
            results.push(photo);
          }
        } catch (error) {
          console.error(`Error processing ${fullPath}:`, error.message);
        }
      }
    }

    return results;
  }

  /**
   * Check if a file is a supported image format
   */
  isImageFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return this.supportedFormats.includes(ext);
  }

  /**
   * Process a newly added image
   */
  async processNewImage(sourceId, filePath) {
    const source = this.sources.get(sourceId);
    if (!source) return;

    try {
      // Determine category from folder structure
      const relativePath = path.relative(source.resolvedPath, filePath);
      const pathParts = relativePath.split(path.sep);
      const category = pathParts.length > 1 && source.useFolderAsCategory 
        ? pathParts[0] 
        : source.defaultCategory;

      const photo = await this.imageProcessor.processImage(filePath, {
        sourceId,
        category,
        basePath: source.resolvedPath
      });

      if (!photo) {
        return;
      }

      const existed = !!this.getPhoto(photo.id);
      if (!this.database) this.photos.set(photo.id, photo);
      this.database?.upsertPhoto(photo);
      if (!existed) {
        source.photoCount++;
      }
      this.database?.upsertSource(source);
      
      this.emit('photoAdded', photo);
    } catch (error) {
      console.error(`Error processing new image ${filePath}:`, error.message);
    }
  }

  /**
   * Process a changed image
   */
  async processChangedImage(sourceId, filePath) {
    await this.processNewImage(sourceId, filePath);
  }

  /**
   * Remove an image from the gallery
   */
  removeImage(sourceId, filePath) {
    if (this.database) {
      const photo = this.database.getPhotoByPath(filePath);
      if (photo?.sourceId === sourceId) this.removePhoto(photo.id);
      return;
    }
    for (const [photoId, photo] of this.photos) {
      if (photo.originalPath === filePath && photo.sourceId === sourceId) {
        this.photos.delete(photoId);
        this.database?.removePhoto(photoId);
        const source = this.sources.get(sourceId);
        if (source) {
          source.photoCount--;
          this.database?.upsertSource(source);
        }
        this.emit('photoRemoved', photoId);
        return;
      }
    }
  }

  /**
   * Refresh all sources
   */
  async refreshAll() {
    if (this.isScanning) {
      console.log('⏳ Scan already in progress, skipping...');
      return;
    }

    this.isScanning = true;
    this.emit('refreshStart');

    try {
      for (const [sourceId] of this.sources) {
        await this.scanSource(sourceId);
      }
      this.lastScanTime = new Date().toISOString();
      this.emit('refreshComplete');
    } finally {
      this.isScanning = false;
    }
  }

  async cleanThumbnailCache() {
    const filenames = this.database
      ? this.database.db.prepare("SELECT thumbnail_filename FROM photos WHERE status = 'active'").all().map(row => row.thumbnail_filename)
      : [...this.photos.values()].map(photo => photo.thumbnailFilename);
    const hashes = filenames.map(filename => /^thumb_([a-f0-9]{32})\./.exec(filename || '')?.[1]).filter(Boolean);
    return this.imageProcessor.cleanupCache(hashes);
  }

  /**
   * Get all photos, optionally filtered
   */
  getPhotos(options = {}) {
    if (this.database) return this.database.queryPhotos(options);
    const { category, sourceId, sortBy = 'date', sortOrder = 'desc', limit, offset = 0 } = options;
    
    let photos = Array.from(this.photos.values());

    // Filter by source
    if (sourceId) {
      photos = photos.filter(p => p.sourceId === sourceId);
    }

    // Filter by category
    if (category && category !== 'All') {
      photos = photos.filter(p => p.category === category);
    }

    // Sort
    photos.sort((a, b) => {
      let aVal, bVal;
      switch (sortBy) {
        case 'date':
          aVal = new Date(a.date).getTime();
          bVal = new Date(b.date).getTime();
          break;
        case 'title':
          aVal = a.title.toLowerCase();
          bVal = b.title.toLowerCase();
          break;
        case 'category':
          aVal = a.category.toLowerCase();
          bVal = b.category.toLowerCase();
          break;
        default:
          aVal = a.date;
          bVal = b.date;
      }
      return sortOrder === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
    });

    // Pagination
    const total = photos.length;
    if (limit) {
      photos = photos.slice(offset, offset + limit);
    }

    return {
      photos,
      total,
      offset,
      limit: limit || total
    };
  }

  /**
   * Get a single photo by ID
   */
  getPhoto(photoId) {
    return this.database ? this.database.getPhoto(photoId) : this.photos.get(photoId);
  }

  /**
   * Get all categories
   */
  getCategories() {
    if (this.database) return ['All', ...Object.keys(this.database.getCatalogStats().categories).sort()];
    const categories = new Set();
    for (const photo of this.photos.values()) {
      categories.add(photo.category);
    }
    return ['All', ...Array.from(categories).sort()];
  }

  /**
   * Get all sources status
   */
  getSources() {
    return Array.from(this.sources.values());
  }

  /**
   * Get gallery statistics
   */
  getStats() {
    if (this.database) return { ...this.database.getCatalogStats(), totalSources: this.sources.size, lastScanTime: this.lastScanTime, isScanning: this.isScanning || this.scans.size > 0 };
    const categories = {};
    const sources = {};

    for (const photo of this.photos.values()) {
      categories[photo.category] = (categories[photo.category] || 0) + 1;
      sources[photo.sourceId] = (sources[photo.sourceId] || 0) + 1;
    }

    return {
      totalPhotos: this.photos.size,
      totalSources: this.sources.size,
      categories,
      sources,
      lastScanTime: this.lastScanTime,
      isScanning: this.isScanning
    };
  }

  /**
   * Update source configuration
   */
  async updateSource(sourceId, updates) {
    const source = this.sources.get(sourceId);
    if (!source) {
      throw new Error(`Source not found: ${sourceId}`);
    }

    // Stop existing watcher if path changed
    if (updates.path && updates.path !== source.path) {
      if (this.watchers.has(sourceId)) {
        this.watchers.get(sourceId).close();
        this.watchers.delete(sourceId);
      }
    }

    // Update config
    Object.assign(source, updates);
    if (updates.path) {
      source.resolvedPath = path.resolve(updates.path);
    }

    // Rescan if needed
    if (updates.path || updates.useFolderAsCategory !== undefined) {
      // Clear photos from this source
      for (const [photoId, photo] of this.photos) {
        if (photo.sourceId === sourceId) {
          this.photos.delete(photoId);
        }
      }
      this.database?.removePhotosBySource(sourceId);
      await this.scanSource(sourceId);
    }

    // Restart watcher if needed
    if (source.watch && this.config.enableFileWatcher && !this.watchers.has(sourceId)) {
      this.setupWatcher(sourceId, source.resolvedPath);
    }

    this.emit('sourceUpdated', source);
    this.database?.upsertSource(source);
    return source;
  }

  /**
   * Remove a photo from the gallery (called after file deletion)
   */
  removePhoto(photoId) {
    const photo = this.getPhoto(photoId);
    if (photo) {
      this.photos.delete(photoId);
      this.database?.removePhoto(photoId);
      
      // Update source photo count
      const source = this.sources.get(photo.sourceId);
      if (source) {
        source.photoCount = (source.photoCount || 0) - 1;
        this.database?.upsertSource(source);
      }
      
      this.emit('photoRemoved', photoId);
      console.log(`🗑️  Removed photo from gallery: ${photoId}`);
    }
  }
}

export default GalleryService;
