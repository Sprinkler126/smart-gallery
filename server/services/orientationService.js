import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_FILE = path.join(__dirname, '../orientation-cache.json');
const CACHE_VERSION = 1;
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days

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

  async getOrientation(photoId, imageUrl, dimensions) {
    // Check cache first
    if (this.cache?.orientations?.[photoId]) {
      const cached = this.cache.orientations[photoId];
      if (cached.url === imageUrl) {
        return cached.orientation;
      }
    }
    
    let width, height;
    
    // Use dimensions if provided (from photo metadata)
    if (dimensions && dimensions.width && dimensions.height) {
      width = dimensions.width;
      height = dimensions.height;
    } else {
      // Fallback: try to read from image file
      try {
        const cleanPath = imageUrl && imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl;
        const fullPath = path.join(__dirname, '../../', cleanPath);
        const metadata = await sharp(fullPath).metadata();
        width = metadata.width || 0;
        height = metadata.height || 0;
      } catch (error) {
        console.error(`Error reading image for ${photoId}:`, error.message);
        return 'landscape'; // Default
      }
    }
    
    // Determine orientation using aspect ratio
    // More accurate threshold: 1.1 instead of 1.2
    const aspectRatio = width / height;
    let orientation;
    if (aspectRatio > 1.1) {
      orientation = 'landscape';  // Width > Height by 10%
    } else if (aspectRatio < 0.9) {
      orientation = 'portrait';   // Height > Width by 10%
    } else {
      orientation = 'square';     // Nearly square (within 10%)
    }
    
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
          const url = photo.thumbnail || photo.url;
          orientations[photo.id] = await this.getOrientation(photo.id, url, photo.dimensions);
          if (this.cache?.orientations[photo.id] && this.cache.orientations[photo.id].url === url) {
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
