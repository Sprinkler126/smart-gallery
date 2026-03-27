/**
 * Image Processing Service
 * Handles thumbnail generation, EXIF extraction, and image metadata
 */

import sharp from 'sharp';
import exifr from 'exifr';
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';

export class ImageProcessor {
  constructor(config) {
    // Use __dirname to ensure absolute path regardless of working directory
    const __dirname = path.dirname(new URL(import.meta.url).pathname);
    
    this.thumbnailConfig = config.thumbnails || {
      width: 800,
      quality: 80,
      format: 'jpeg',
      cacheDir: path.join(__dirname, 'cache', 'thumbnails'),
      maxCacheSize: 1000,
      autoClean: true
    };
    this.cacheDir = this.thumbnailConfig.cacheDir;
    this.cacheIndex = new Map(); // Track cache usage
    fs.ensureDirSync(this.cacheDir);
    
    // Auto-clean cache on startup if enabled
    if (this.thumbnailConfig.autoClean) {
      this.cleanupOldCache();
    }
  }

  /**
   * Generate a unique hash for the image based on path and modification time
   */
  generateImageHash(imagePath, stats) {
    const data = `${imagePath}-${stats.mtime.getTime()}-${stats.size}`;
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * Check if image format is supported (by extension)
   */
  isSupportedFormat(imagePath) {
    const ext = path.extname(imagePath).toLowerCase();
    // Skip HEIF/HEIC formats that require additional libraries
    const unsupportedFormats = ['.heif', '.heic', '.hif'];
    return !unsupportedFormats.includes(ext);
  }

  /**
   * Check if file is actually HEIF format by reading magic bytes
   * Some HEIF files have .jpg extension but are actually HEIF
   */
  async isHeifFormat(imagePath) {
    try {
      const buffer = await fs.readFile(imagePath, { length: 12 });
      // HEIF files start with ftyp box: 00 00 00 XX 66 74 79 70 68 65 69 63
      // or 00 00 00 XX 66 74 79 70 6D 69 66 31
      const ftypSignature = buffer.toString('hex', 4, 8);
      if (ftypSignature === '66747970') { // 'ftyp'
        const brand = buffer.toString('ascii', 8, 12);
        if (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'msf1') {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get or create thumbnail for an image
   */
  async getThumbnail(imagePath) {
    try {
      // Skip unsupported formats by extension
      if (!this.isSupportedFormat(imagePath)) {
        console.warn(`⚠️ Skipping unsupported format: ${imagePath}`);
        return null;
      }

      // Check if file is actually HEIF (some have .jpg extension)
      if (await this.isHeifFormat(imagePath)) {
        console.warn(`⚠️ Skipping HEIF file with wrong extension: ${imagePath}`);
        return null;
      }

      const stats = await fs.stat(imagePath);
      const hash = this.generateImageHash(imagePath, stats);
      const thumbFilename = `thumb_${hash}.${this.thumbnailConfig.format}`;
      const thumbPath = path.join(this.cacheDir, thumbFilename);

      // Check if thumbnail already exists and is valid
      if (await fs.pathExists(thumbPath)) {
        return {
          path: thumbPath,
          filename: thumbFilename,
          cached: true
        };
      }

      // Generate new thumbnail
      await sharp(imagePath)
        .rotate() // Auto-rotate based on EXIF orientation
        .resize(this.thumbnailConfig.width, null, { withoutEnlargement: true })
        .jpeg({ quality: this.thumbnailConfig.quality })
        .toFile(thumbPath);

      return {
        path: thumbPath,
        filename: thumbFilename,
        cached: false
      };
    } catch (error) {
      console.error(`Error generating thumbnail for ${imagePath}:`, error.message);
      // Return null instead of throwing to allow graceful degradation
      return null;
    }
  }

  /**
   * Generate a tiny blur placeholder (LQIP - Low Quality Image Placeholder)
   * Returns base64 encoded tiny image (20px width, heavily blurred)
   */
  async getBlurPlaceholder(imagePath) {
    try {
      // Skip unsupported formats
      if (!this.isSupportedFormat(imagePath) || await this.isHeifFormat(imagePath)) {
        return null;
      }

      const stats = await fs.stat(imagePath);
      const hash = this.generateImageHash(imagePath, stats);
      const blurFilename = `blur_${hash}.base64`;
      const blurPath = path.join(this.cacheDir, blurFilename);

      // Check if blur placeholder already exists
      if (await fs.pathExists(blurPath)) {
        return await fs.readFile(blurPath, 'utf-8');
      }

      // Generate tiny blurred image (20px width)
      const buffer = await sharp(imagePath)
        .rotate()
        .resize(20, null, { withoutEnlargement: true })
        .blur(0.5) // Slight blur for smoother look
        .jpeg({ quality: 30, progressive: true })
        .toBuffer();

      // Convert to base64 data URL
      const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
      
      // Cache to file
      await fs.writeFile(blurPath, base64, 'utf-8');

      return base64;
    } catch (error) {
      console.error(`Error generating blur placeholder for ${imagePath}:`, error.message);
      return null;
    }
  }

  /**
   * Extract EXIF data from an image
   */
  async extractExif(imagePath) {
    try {
      const output = await exifr.parse(imagePath, {
        tiff: true,
        exif: true,
        gps: true,
      });

      if (!output) {
        return this.getDefaultExif(imagePath);
      }

      // Get date from EXIF or file stats
      let dateStr = new Date().toISOString().split('T')[0];
      if (output.DateTimeOriginal) {
        dateStr = output.DateTimeOriginal.toISOString().split('T')[0];
      } else if (output.CreateDate) {
        dateStr = output.CreateDate.toISOString().split('T')[0];
      } else {
        const stats = await fs.stat(imagePath);
        dateStr = stats.birthtime.toISOString().split('T')[0];
      }

      // Extract GPS location if available
      let location = 'Earth';
      if (output.latitude && output.longitude) {
        location = `${output.latitude.toFixed(4)}, ${output.longitude.toFixed(4)}`;
      }

      return {
        date: dateStr,
        location,
        exif: {
          camera: output.Model || output.Make || 'Unknown Camera',
          lens: output.LensModel || 'Unknown Lens',
          aperture: output.FNumber ? `f/${output.FNumber}` : '',
          shutter: this.formatShutterSpeed(output.ExposureTime),
          iso: output.ISO ? output.ISO.toString() : '',
          focalLength: output.FocalLength ? `${output.FocalLength}mm` : ''
        }
      };
    } catch (error) {
      return this.getDefaultExif(imagePath);
    }
  }

  /**
   * Get default EXIF data when extraction fails
   */
  async getDefaultExif(imagePath) {
    try {
      const stats = await fs.stat(imagePath);
      return {
        date: stats.birthtime.toISOString().split('T')[0],
        location: 'Earth',
        exif: {
          camera: 'Unknown Camera',
          lens: 'Unknown Lens',
          aperture: '',
          shutter: '',
          iso: ''
        }
      };
    } catch {
      return {
        date: new Date().toISOString().split('T')[0],
        location: 'Earth',
        exif: {}
      };
    }
  }

  /**
   * Format shutter speed (e.g., 0.005 -> "1/200")
   */
  formatShutterSpeed(time) {
    if (!time) return '';
    if (time >= 1) return `${time}s`;
    const fraction = Math.round(1 / time);
    return `1/${fraction}`;
  }

  /**
   * Get image dimensions
   */
  async getImageDimensions(imagePath) {
    try {
      const metadata = await sharp(imagePath).metadata();
      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format
      };
    } catch {
      return { width: 0, height: 0, format: 'unknown' };
    }
  }

  /**
   * Process a single image and return full metadata
   */
  async processImage(imagePath, options = {}) {
    const { sourceId, category, basePath } = options;
    
    const filename = path.basename(imagePath);
    const relativePath = basePath ? path.relative(basePath, imagePath) : filename;
    
    // Generate unique ID
    const safeId = `${sourceId}_${relativePath}`.replace(/[\/\\]/g, '_').replace(/\./g, '-').replace(/\s/g, '_');
    
    // Get thumbnail
    const thumbnail = await this.getThumbnail(imagePath);
    
    // Skip unsupported formats (thumbnail is null)
    if (!thumbnail) {
      return null;
    }
    
    // Get blur placeholder (LQIP)
    const blurPlaceholder = await this.getBlurPlaceholder(imagePath);
    
    // Get EXIF data
    const metadata = await this.extractExif(imagePath);
    
    // Get dimensions
    const dimensions = await this.getImageDimensions(imagePath);

    return {
      id: safeId,
      sourceId,
      originalPath: imagePath,
      relativePath,
      filename,
      title: this.formatTitle(filename),
      category: category || 'General',
      thumbnailPath: thumbnail.path,
      thumbnailFilename: thumbnail.filename,
      blurPlaceholder, // Base64 encoded tiny blurred image
      ...metadata,
      dimensions,
      lastModified: (await fs.stat(imagePath)).mtime.toISOString()
    };
  }

  /**
   * Format filename into readable title
   */
  formatTitle(filename) {
    const nameWithoutExt = filename.split('.').slice(0, -1).join('.');
    return nameWithoutExt
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Clean up old cached thumbnails
   */
  async cleanupCache(validHashes = []) {
    try {
      const files = await fs.readdir(this.cacheDir);
      let cleaned = 0;
      
      for (const file of files) {
        const hash = file.replace('thumb_', '').replace(`.${this.thumbnailConfig.format}`, '');
        if (!validHashes.includes(hash)) {
          await fs.remove(path.join(this.cacheDir, file));
          cleaned++;
          this.cacheIndex.delete(hash);
        }
      }
      
      console.log(`🧹 Cleaned ${cleaned} old cached thumbnails`);
      return cleaned;
    } catch (error) {
      console.error('Error cleaning cache:', error);
      return 0;
    }
  }

  /**
   * Get or create a 4K display image (max 3840px, quality 85, progressive JPEG)
   * For slideshow use - much smaller than original but still sharp on 4K displays
   */
  async getDisplayImage(imagePath) {
    try {
      if (!this.isSupportedFormat(imagePath)) return null;
      if (await this.isHeifFormat(imagePath)) return null;

      const stats = await fs.stat(imagePath);
      const hash = this.generateImageHash(imagePath, stats);
      const displayFilename = `display_${hash}.jpg`;
      const displayDir = path.join(path.dirname(this.cacheDir), 'display');
      const displayPath = path.join(displayDir, displayFilename);

      // Return cached if exists
      if (await fs.pathExists(displayPath)) {
        return { path: displayPath, filename: displayFilename, cached: true };
      }

      await fs.ensureDir(displayDir);

      // Generate 4K display image
      await sharp(imagePath)
        .rotate()
        .resize(3840, null, {
          withoutEnlargement: true,
          fit: 'inside',
        })
        .jpeg({ quality: 85, progressive: true, mozjpeg: true })
        .toFile(displayPath);

      return { path: displayPath, filename: displayFilename, cached: false };
    } catch (error) {
      console.error(`Error generating display image for ${imagePath}:`, error.message);
      return null;
    }
  }

  /**
   * Clean up old cache based on size limit (LRU-style)
   */
  async cleanupOldCache() {
    try {
      const files = await fs.readdir(this.cacheDir);
      const maxCacheSize = this.thumbnailConfig.maxCacheSize || 1000;
      
      if (files.length <= maxCacheSize) {
        console.log(`✅ Cache size OK: ${files.length}/${maxCacheSize}`);
        return;
      }

      // Get file stats and sort by access time
      const fileStats = await Promise.all(
        files.map(async (file) => {
          const filePath = path.join(this.cacheDir, file);
          try {
            const stats = await fs.stat(filePath);
            return { file, atime: stats.atimeMs, filePath };
          } catch {
            return null;
          }
        })
      );

      const validStats = fileStats.filter(Boolean);
      validStats.sort((a, b) => a.atime - b.atime); // Oldest first

      const toDelete = validStats.slice(0, validStats.length - maxCacheSize);
      let cleaned = 0;

      for (const { file, filePath } of toDelete) {
        await fs.remove(filePath);
        const hash = file.replace('thumb_', '').replace(`.${this.thumbnailConfig.format}`, '');
        this.cacheIndex.delete(hash);
        cleaned++;
      }

      console.log(`🧹 Auto-cleaned ${cleaned} old cached thumbnails (LRU)`);
    } catch (error) {
      console.error('Error in auto-cleanup:', error);
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    try {
      const files = await fs.readdir(this.cacheDir);
      let totalSize = 0;
      
      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        try {
          const stats = await fs.stat(filePath);
          totalSize += stats.size;
        } catch {
          // Ignore errors
        }
      }

      return {
        count: files.length,
        maxSize: this.thumbnailConfig.maxCacheSize || 1000,
        totalSizeBytes: totalSize,
        totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
        directory: this.cacheDir
      };
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return null;
    }
  }

  /**
   * Delete a specific thumbnail from cache
   */
  async deleteThumbnail(photoId) {
    try {
      // Try to find thumbnail by scanning cache (simplified approach)
      const files = await fs.readdir(this.cacheDir);
      
      for (const file of files) {
        if (file.startsWith('thumb_')) {
          // We can't directly map photoId to thumbnail without the hash
          // So we'll clean up old thumbnails periodically instead
          // For immediate deletion, we'd need to store the hash in the photo record
        }
      }
      
      // For now, just trigger cache cleanup which will remove orphaned thumbnails
      await this.cleanupOldCache();
      
      return { success: true };
    } catch (error) {
      console.error(`Error deleting thumbnail for ${photoId}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clear all cached thumbnails
   */
  async clearAllCache() {
    try {
      console.log('🧹 Clearing all thumbnail cache...');
      
      // Remove all files in cache directory
      await fs.emptyDir(this.cacheDir);
      
      // Reset cache index
      this.cacheIndex.clear();
      
      console.log('✅ All thumbnail cache cleared');
      return { success: true };
    } catch (error) {
      console.error('Error clearing cache:', error);
      return { success: false, error: error.message };
    }
  }
}

export default ImageProcessor;
