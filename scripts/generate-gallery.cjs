const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const exifr = require('exifr');

// CONFIGURATION
const SOURCE_DIR = path.join(__dirname, '../public/photos'); 
const THUMB_DIR = path.join(__dirname, '../public/photos/thumbnails');
const OUTPUT_FILE = path.join(__dirname, '../constants.ts');

// Ensure directories exist
fs.ensureDirSync(SOURCE_DIR);
fs.ensureDirSync(THUMB_DIR);

/**
 * Format shutter speed (e.g., 0.005 -> "1/200")
 */
function formatShutterSpeed(time) {
  if (!time) return '';
  if (time >= 1) return `${time}s`;
  const fraction = Math.round(1 / time);
  return `1/${fraction}`;
}

/**
 * Recursive function to scan directories
 */
async function scanDirectory(dir, category = 'General') {
  let results = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      // Skip thumbnails folder and hidden folders
      if (item.name === 'thumbnails' || item.name.startsWith('.')) continue;
      // Recursively scan, using the folder name as the new category
      const subResults = await scanDirectory(fullPath, item.name);
      results = results.concat(subResults);
    } else if (/\.(jpg|jpeg|png|webp|avif)$/i.test(item.name)) {
      results.push({
        path: fullPath,
        filename: item.name,
        category: category
      });
    }
  }
  return results;
}

async function processGallery() {
  console.log('📷 Starting Gallery Generation...');
  console.log('   Scanning subfolders for categories...');

  // 1. Scan all images recursively
  const allImages = await scanDirectory(SOURCE_DIR);

  const galleryData = [];

  for (const img of allImages) {
    // Generate a unique ID based on path to avoid conflicts in different folders
    const relativePath = path.relative(SOURCE_DIR, img.path);
    const safeId = relativePath.replace(/[\/\\]/g, '_').replace(/\./g, '-');
    
    // Thumbnail Logic: Flatten structure into thumbnails dir with unique names
    const thumbFilename = `thumb_${safeId}`;
    const thumbPath = path.join(THUMB_DIR, thumbFilename);
    
    // Web-accessible paths
    // Note: Windows paths use backslashes, replace them for URLs
    const webUrl = `/photos/${relativePath.replace(/\\/g, '/')}`;
    const webThumb = `/photos/thumbnails/${thumbFilename}`;

    process.stdout.write(`Processing: ${relativePath} ... `);

    // 2. Generate Thumbnail
    if (!fs.existsSync(thumbPath)) {
        try {
            await sharp(img.path)
            .rotate() // Auto-rotate based on EXIF orientation
            .resize(800, null, { withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toFile(thumbPath);
        } catch (err) {
            console.error(`\n❌ Error creating thumbnail for ${img.filename}: ${err.message}`);
            continue; 
        }
    }

    // 3. Extract EXIF Data & Real Date
    let exifData = {};
    let dateStr = new Date().toISOString().split('T')[0]; // Default to today
    
    try {
        const output = await exifr.parse(img.path, {
            tiff: true,
            exif: true,
            gps: false,
        });
        
        if (output) {
            exifData = {
                camera: output.Model || 'Unknown Camera',
                lens: output.LensModel || 'Unknown Lens',
                aperture: output.FNumber ? `f/${output.FNumber}` : '',
                shutter: formatShutterSpeed(output.ExposureTime),
                iso: output.ISO ? output.ISO.toString() : ''
            };

            // Attempt to get the real creation date
            if (output.DateTimeOriginal) {
                dateStr = output.DateTimeOriginal.toISOString().split('T')[0];
            } else if (output.CreateDate) {
                dateStr = output.CreateDate.toISOString().split('T')[0];
            }
        } else {
            // Fallback to file creation time if no EXIF
            const stats = fs.statSync(img.path);
            dateStr = stats.birthtime.toISOString().split('T')[0];
        }
    } catch (e) {
        // console.warn(`(No EXIF)`);
    }

    galleryData.push({
        id: safeId,
        url: webUrl,
        thumbnail: webThumb,
        title: img.filename.split('.')[0].replace(/[-_]/g, ' '),
        category: img.category,
        date: dateStr,
        location: 'Earth', 
        exif: exifData
    });
    
    console.log(`OK [${dateStr}]`);
  }

  // Sort by date (Newest first)
  galleryData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // 5. Generate Content for constants.ts
  const fileContent = `
import { Photo } from './types';

export const APP_NAME = "SPRINKLER";
export const PHOTOGRAPHER_NAME = "Sprinkler";

/**
 * ⚠️ THIS LIST IS AUTO-GENERATED.
 * DO NOT EDIT MANUALLY IF YOU USE THE GENERATION SCRIPT.
 * Run 'node scripts/generate-gallery.cjs' to update.
 */
export const GALLERY_DATA: Photo[] = ${JSON.stringify(galleryData, null, 2)};
`;

  fs.writeFileSync(OUTPUT_FILE, fileContent);
  console.log(`\n✅ Success! Processed ${galleryData.length} photos.`);
  console.log(`📁 Gallery data written to ${OUTPUT_FILE}`);
}

processGallery().catch(err => {
    console.error("Error generating gallery:", err);
});