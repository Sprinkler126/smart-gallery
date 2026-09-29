/**
 * Image Processing Service
 * Handles thumbnail generation, EXIF extraction, and image metadata
 */

import sharp from 'sharp';
import exifr from 'exifr';
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';

async function writeCachedImage(pipeline, destination) {
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  try {
    await pipeline.toFile(temporary);
    await fs.move(temporary, destination, { overwrite: true });
  } finally {
    await fs.remove(temporary);
  }
}

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
    this.cacheDir = path.isAbsolute(this.thumbnailConfig.cacheDir)
      ? this.thumbnailConfig.cacheDir
      : path.resolve(process.cwd(), this.thumbnailConfig.cacheDir);
    this.thumbnailConfig.cacheDir = this.cacheDir;
    this.cacheIndex = new Map(); // Track cache usage
    this.thumbnailInFlight = new Map();
    this.previewInFlight = new Map();
    this.displayInFlight = new Map();
    fs.ensureDirSync(this.cacheDir);
    
    // Active thumbnails belong to the catalog. Cleanup runs after indexing, using catalog references.
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
    let handle;
    try {
      // fs.readFile ignores a `length` option and would load the entire image.
      // Read just the file signature so repeated scans cannot retain large buffers.
      handle = await fs.open(imagePath, 'r');
      const buffer = Buffer.alloc(12);
      const { bytesRead } = await fs.read(handle, buffer, 0, buffer.length, 0);
      if (bytesRead < buffer.length) return false;
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
    } finally {
      if (typeof handle === 'number') await fs.close(handle);
      else await handle?.close();
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
        if (this.thumbnailInFlight.has(thumbPath)) await this.thumbnailInFlight.get(thumbPath);
        return {
          path: thumbPath,
          filename: thumbFilename,
          cached: true
        };
      }

      if (this.thumbnailInFlight.has(thumbPath)) {
        await this.thumbnailInFlight.get(thumbPath);
        return { path: thumbPath, filename: thumbFilename, cached: true };
      }
      const generate = writeCachedImage(sharp(imagePath).rotate()
        .resize(this.thumbnailConfig.width, null, { withoutEnlargement: true })
        .jpeg({ quality: this.thumbnailConfig.quality }), thumbPath);
      this.thumbnailInFlight.set(thumbPath, generate);
      try { await generate; } finally { this.thumbnailInFlight.delete(thumbPath); }

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
  async getBlurPlaceholder(imagePath, thumbnailPath = imagePath) {
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
      const buffer = await sharp(thumbnailPath)
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
      if (Number.isFinite(output.latitude) && Number.isFinite(output.longitude)) {
        location = `${output.latitude.toFixed(4)}, ${output.longitude.toFixed(4)}`;
      }

      return {
        date: dateStr,
        location,
        latitude: Number.isFinite(output.latitude) && Math.abs(output.latitude) <= 90 ? output.latitude : null,
        longitude: Number.isFinite(output.longitude) && Math.abs(output.longitude) <= 180 ? output.longitude : null,
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
      const rawWidth = metadata.width || 0;
      const rawHeight = metadata.height || 0;
      const shouldSwap = [5, 6, 7, 8].includes(Number(metadata.orientation));
      return {
        width: shouldSwap ? rawHeight : rawWidth,
        height: shouldSwap ? rawWidth : rawHeight,
        rawWidth,
        rawHeight,
        orientation: metadata.orientation || 1,
        format: metadata.format
      };
    } catch {
      return { width: 0, height: 0, rawWidth: 0, rawHeight: 0, orientation: 1, format: 'unknown' };
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
    const blurPlaceholder = await this.getBlurPlaceholder(imagePath, thumbnail.path);
    
    // Get EXIF data
    const metadata = await this.extractExif(imagePath);
    
    // Get dimensions
    const dimensions = await this.getImageDimensions(imagePath);
    const fileStats = await fs.stat(imagePath);

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
      lastModified: fileStats.mtime.toISOString(),
      fileSize: fileStats.size,
      metadataVersion: 1
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
  async cleanupCache(validHashes) {
    if (!Array.isArray(validHashes)) throw new Error('Catalog hashes are required for cache cleanup');
    const keep = new Set(validHashes);
    const files = await fs.readdir(this.cacheDir);
    let cleaned = 0;
    for (const file of files) {
      const match = /^(?:thumb|blur)_([a-f0-9]{32})\.(?:jpeg|jpg|webp|png|base64)$/.exec(file);
      if (!match || keep.has(match[1])) continue;
      await fs.remove(path.join(this.cacheDir, file));
      this.cacheIndex.delete(match[1]); cleaned++;
    }
    return cleaned;
  }

  /**
   * Get or create a 1920px preview image for progressive slideshow loading.
   */
  async getPreviewImage(imagePath) {
    try {
      if (!this.isSupportedFormat(imagePath)) return null;
      if (await this.isHeifFormat(imagePath)) return null;

      const stats = await fs.stat(imagePath);
      const hash = this.generateImageHash(imagePath, stats);
      const previewFilename = `preview_${hash}.jpg`;
      const previewDir = path.join(path.dirname(this.cacheDir), 'preview');
      const previewPath = path.join(previewDir, previewFilename);

      if (await fs.pathExists(previewPath)) {
        return { path: previewPath, filename: previewFilename, cached: true };
      }

      await fs.ensureDir(previewDir);

      const inFlightKey = previewPath;
      if (this.previewInFlight.has(inFlightKey)) {
        await this.previewInFlight.get(inFlightKey);
        if (await fs.pathExists(previewPath)) {
          return { path: previewPath, filename: previewFilename, cached: true };
        }
      }

      const generatePreview = writeCachedImage(sharp(imagePath)
        .rotate()
        .resize(1920, null, {
          withoutEnlargement: true,
          fit: 'inside',
        })
        .jpeg({ quality: 82, progressive: true, mozjpeg: true }), previewPath);

      this.previewInFlight.set(inFlightKey, generatePreview);

      try {
        await generatePreview;
      } finally {
        this.previewInFlight.delete(inFlightKey);
      }

      return { path: previewPath, filename: previewFilename, cached: false };
    } catch (error) {
      console.error(`Error generating preview image for ${imagePath}:`, error.message);
      return null;
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

      const inFlightKey = displayPath;
      if (this.displayInFlight.has(inFlightKey)) {
        await this.displayInFlight.get(inFlightKey);
        if (await fs.pathExists(displayPath)) {
          return { path: displayPath, filename: displayFilename, cached: true };
        }
      }

      const generateDisplay = writeCachedImage(sharp(imagePath)
        .rotate()
        .resize(3840, null, {
          withoutEnlargement: true,
          fit: 'inside',
        })
        .jpeg({ quality: 85, progressive: true, mozjpeg: true }), displayPath);

      this.displayInFlight.set(inFlightKey, generateDisplay);

      try {
        await generateDisplay;
      } finally {
        this.displayInFlight.delete(inFlightKey);
      }

      return { path: displayPath, filename: displayFilename, cached: false };
    } catch (error) {
      console.error(`Error generating display image for ${imagePath}:`, error.message);
      return null;
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    try {
      const cacheDirs = [
        this.cacheDir,
        path.join(path.dirname(this.cacheDir), 'preview'),
        path.join(path.dirname(this.cacheDir), 'display')
      ];
      let count = 0;
      let totalSize = 0;
      
      for (const dir of cacheDirs) {
        if (!await fs.pathExists(dir)) continue;
        const files = await fs.readdir(dir);
        count += files.length;

        for (const file of files) {
          const filePath = path.join(dir, file);
          try {
            const stats = await fs.stat(filePath);
            totalSize += stats.size;
          } catch {
            // Ignore errors
          }
        }
      }

      return {
        count,
        maxSize: this.thumbnailConfig.maxCacheSize || 1000,
        totalSizeBytes: totalSize,
        totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
        directory: this.cacheDir,
        directories: cacheDirs
      };
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return null;
    }
  }

  /**
   * Delete a specific thumbnail from cache
   */
  async deleteThumbnail(photo) {
    const match = /^thumb_([a-f0-9]{32})\.(?:jpeg|jpg|webp|png)$/.exec(photo.thumbnailFilename || '');
    if (!match) throw new Error('Invalid catalog thumbnail filename');
    await fs.remove(path.join(this.cacheDir, photo.thumbnailFilename));
    await fs.remove(path.join(this.cacheDir, `blur_${match[1]}.base64`));
    return { success: true };
  }

  /**
   * Clear all cached thumbnails
   */
  async clearAllCache() {
    try {
      console.log('🧹 Clearing all thumbnail cache...');
      
      const cacheDirs = [
        this.cacheDir,
        path.join(path.dirname(this.cacheDir), 'preview'),
        path.join(path.dirname(this.cacheDir), 'display')
      ];

      for (const dir of cacheDirs) {
        await fs.ensureDir(dir);
        await fs.emptyDir(dir);
      }
      
      // Reset cache index
      this.cacheIndex.clear();
      this.previewInFlight.clear();
      this.displayInFlight.clear();
      
      console.log('✅ All thumbnail cache cleared');
      return { success: true };
    } catch (error) {
      console.error('Error clearing cache:', error);
      return { success: false, error: error.message };
    }
  }
}

export default ImageProcessor;
