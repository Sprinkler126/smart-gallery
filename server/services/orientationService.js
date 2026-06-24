import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_FILE = path.join(__dirname, '../orientation-cache.json');
const CACHE_VERSION = 2;
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days

function orientDimensions(width = 0, height = 0, orientation = 1) {
  const numericOrientation = Number(orientation) || 1;
  if ([5, 6, 7, 8].includes(numericOrientation)) {
    return { width: height, height: width, orientation: numericOrientation };
  }

  return { width, height, orientation: numericOrientation };
}

function classifyOrientation(width, height) {
  if (!width || !height) return 'landscape';

  const aspectRatio = width / height;
  if (aspectRatio > 1.06) return 'landscape';
  if (aspectRatio < 0.94) return 'portrait';
  return 'square';
}

function buildCacheKey(photo, imageUrl) {
  const dimensions = photo?.dimensions || {};
  return [
    imageUrl || '',
    photo?.lastModified || '',
    dimensions.width || 0,
    dimensions.height || 0,
    dimensions.rawWidth || 0,
    dimensions.rawHeight || 0,
    dimensions.orientation || ''
  ].join('|');
}

class OrientationService {
  constructor() {
    this.cache = null;
    this.isInitializing = false;
  }

  async loadCache() {
    try {
      if (await fs.pathExists(CACHE_FILE)) {
        const data = await fs.readJson(CACHE_FILE);
        const isExpired = Date.now() - data.timestamp > CACHE_EXPIRY;
        if (!isExpired && data.version === CACHE_VERSION) {
          this.cache = data;
          console.log(`✅ Orientation cache loaded: ${Object.keys(data.orientations).length} photos`);
          return true;
        } else {
          console.log('⏰ Orientation cache expired, will rebuild');
        }
      }
    } catch (error) {
      console.error('Error loading orientation cache:', error.message);
    }
    return false;
  }

  async saveCache() {
    try {
      await fs.writeJson(CACHE_FILE, this.cache, { spaces: 2 });
      console.log(`💾 Orientation cache saved: ${Object.keys(this.cache.orientations).length} photos`);
    } catch (error) {
      console.error('Error saving orientation cache:', error.message);
    }
  }

  async getOrientation(photo, imageUrl) {
    const photoId = photo.id;
    const cacheKey = buildCacheKey(photo, imageUrl);

    // Check cache first
    if (this.cache?.orientations?.[photoId]) {
      const cached = this.cache.orientations[photoId];
      if (cached.cacheKey === cacheKey || (!cached.cacheKey && cached.url === imageUrl && cached.lastModified === photo.lastModified)) {
        return cached.orientation;
      }
    }
    
    let width, height;
    const dimensions = photo.dimensions;
    
    // Use dimensions if provided (from photo metadata)
    if (dimensions && dimensions.width && dimensions.height && dimensions.orientation) {
      width = dimensions.width;
      height = dimensions.height;
    } else {
      // Fallback: try to read from image file
      try {
        const fullPath = photo.originalPath || path.join(__dirname, '../../', imageUrl?.replace(/^\/+/, '') || '');
        const metadata = await sharp(fullPath).metadata();
        const oriented = orientDimensions(metadata.width || 0, metadata.height || 0, metadata.orientation || 1);
        width = oriented.width;
        height = oriented.height;
      } catch (error) {
        console.error(`Error reading image for ${photoId}:`, error.message);
        return 'landscape'; // Default
      }
    }
    
    const orientation = classifyOrientation(width, height);
    
    // Update cache
    if (!this.cache) {
      this.cache = {
        version: CACHE_VERSION,
        timestamp: Date.now(),
        orientations: {}
      };
    }
    if (!this.cache.orientations) {
      this.cache.orientations = {};
    }
    this.cache.orientations[photoId] = {
      orientation,
      url: imageUrl,
      cacheKey,
      lastModified: photo.lastModified || '',
      width,
      height
    };
    
    return orientation;
  }

  async getOrientations(photos) {
    const orientations = {};
    let cacheHits = 0;
    let cacheMisses = 0;

    // Process in batches to avoid overwhelming the server
    const batchSize = 20;
    for (let i = 0; i < photos.length; i += batchSize) {
      const batch = photos.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (photo) => {
          const url = photo.thumbnailPath || photo.thumbnail || photo.originalPath || photo.url;
          const before = this.cache?.orientations?.[photo.id];
          orientations[photo.id] = await this.getOrientation(photo, url);
          const after = this.cache?.orientations?.[photo.id];
          if (before && after && before.cacheKey === after.cacheKey) {
            cacheHits++;
          } else {
            cacheMisses++;
          }
        })
      );
    }

    console.log(`📊 Orientation detection: ${cacheHits} cached, ${cacheMisses} new`);
    
    // Save cache if there were new detections
    if (cacheMisses > 0) {
      await this.saveCache();
    }

    return orientations;
  }

  async clearCache() {
    try {
      this.cache = {
        version: CACHE_VERSION,
        timestamp: Date.now(),
        orientations: {}
      };
      await this.saveCache();
      console.log('🗑️ Orientation cache cleared');
      return true;
    } catch (error) {
      console.error('Error clearing cache:', error.message);
      return false;
    }
  }

  getCacheInfo() {
    if (!this.cache) {
      return { loaded: false, count: 0 };
    }
    return {
      loaded: true,
      count: Object.keys(this.cache.orientations).length,
      timestamp: this.cache.timestamp,
      version: this.cache.version
    };
  }
}

// Export singleton instance
export const orientationService = new OrientationService();
export default orientationService;
