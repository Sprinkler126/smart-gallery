import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import sharp from 'sharp';

const BRAND_ALIASES = [
  { brand: 'Canon', slug: 'canon', patterns: [/canon/i] },
  { brand: 'Nikon', slug: 'nikon', patterns: [/nikon/i] },
  { brand: 'Sony', slug: 'sony', patterns: [/sony/i, /\bilce\b/i, /\bdsc-rx/i] },
  { brand: 'Fujifilm', slug: 'fujifilm', patterns: [/fujifilm/i, /\bfuji\b/i] },
  { brand: 'Leica', slug: 'leica', patterns: [/leica/i] },
  { brand: 'Panasonic', slug: 'lumix', patterns: [/panasonic/i, /lumix/i] },
  { brand: 'Olympus', slug: 'olympus', patterns: [/olympus/i, /om system/i] },
  { brand: 'DJI', slug: 'dji', patterns: [/\bdji\b/i] },
  { brand: 'Apple', slug: 'apple', patterns: [/apple/i, /iphone/i] },
  { brand: 'Xiaomi', slug: 'xiaomi', patterns: [/xiaomi/i, /redmi/i] },
  { brand: 'Huawei', slug: 'huawei', patterns: [/huawei/i] },
  { brand: 'Samsung', slug: 'samsung', patterns: [/samsung/i] },
  { brand: 'GoPro', slug: 'gopro', patterns: [/gopro/i] },
  { brand: 'Ricoh', slug: 'ricoh', patterns: [/ricoh/i, /gr iii/i] },
  { brand: 'Pentax', slug: 'pentax', patterns: [/pentax/i] },
  { brand: 'Sigma', slug: 'sigma', patterns: [/sigma/i] }
];

const TEMPLATES = [
  {
    id: 'exif-split',
    layout: 'split-footer',
    name: '参数两侧',
    description: '左下角放曝光参数和日期，右下角放 Logo、相机和镜头。',
    background: '#f0eff4',
    imageBackground: '#ffffff',
    text: '#171717',
    muted: '#626262',
    accent: '#171717',
    border: '#ffffff'
  },
  {
    id: 'bare-photo', layout: 'bare-photo', name: '纯照片',
    description: '只保留照片，不添加边框或参数。',
    background: '#ffffff', imageBackground: '#ffffff', text: '#171717', muted: '#666666', accent: '#171717', border: '#ffffff'
  },
  {
    id: 'clean-border', layout: 'clean-border', name: '纯白相框',
    description: '照片四周留白，不显示参数。',
    background: '#ffffff', imageBackground: '#ffffff', text: '#171717', muted: '#666666', accent: '#171717', border: '#ffffff'
  },
  {
    id: 'center-single', layout: 'center-single', name: '居中单行',
    description: '相机、镜头与曝光参数在白色底栏中居中排成一行。',
    background: '#ffffff', imageBackground: '#ffffff', text: '#171717', muted: '#666666', accent: '#171717', border: '#ffffff'
  },
  {
    id: 'center-double', layout: 'center-double', name: '居中双行',
    description: '底栏第一行是相机镜头，第二行是曝光参数。',
    background: '#ffffff', imageBackground: '#ffffff', text: '#171717', muted: '#666666', accent: '#171717', border: '#ffffff'
  },
  {
    id: 'single-date', layout: 'single-date', name: '单行＋时间',
    description: '底栏左侧是一行参数，右侧是拍摄时间。',
    background: '#ffffff', imageBackground: '#ffffff', text: '#171717', muted: '#666666', accent: '#171717', border: '#ffffff'
  },
  {
    id: 'double-date', layout: 'double-date', name: '双行＋时间',
    description: '底栏居中显示两行参数，拍摄时间在第三行。',
    background: '#ffffff', imageBackground: '#ffffff', text: '#171717', muted: '#666666', accent: '#171717', border: '#ffffff'
  },
  {
    id: 'film-data', layout: 'film-data', name: '胶片信息',
    description: '琥珀色参数直接落在照片下方的左右两角。',
    background: '#111111', imageBackground: '#111111', text: '#f5b94d', muted: '#f5b94d', accent: '#f5b94d', border: '#111111'
  },
  {
    id: 'monitor-strip', layout: 'monitor-strip', name: '监视器',
    description: '照片下沿的黑条将光圈、快门、ISO 和焦距分格显示。',
    background: '#000000', imageBackground: '#000000', text: '#ffffff', muted: '#ffffff', accent: '#ffffff', border: '#000000'
  },
  {
    id: 'lightroom-strip', layout: 'lightroom-strip', name: '暗色参数栏',
    description: '黑色窄底栏分别放曝光参数、器材和日期。',
    background: '#1e1e1e', imageBackground: '#1e1e1e', text: '#ffffff', muted: '#c5c5c5', accent: '#ffffff', border: '#1e1e1e'
  },
  {
    id: 'photo-poster', layout: 'photo-poster', name: '照片海报',
    description: '标题放在照片左上角，地点与日期放在左下角。',
    background: '#111111', imageBackground: '#111111', text: '#ffffff', muted: '#eeeeee', accent: '#ffffff', border: '#111111'
  },
  {
    id: 'notice-overlay', layout: 'notice-overlay', name: '照片告示',
    description: '相机信息放在照片右上角，曝光参数放在底部中央。',
    background: '#111111', imageBackground: '#111111', text: '#ffffff', muted: '#eeeeee', accent: '#ffffff', border: '#111111'
  },
  {
    id: 'cinema-wide', layout: 'cinema-wide', name: '电影画幅',
    description: '上下黑色遮幅，照片以宽银幕比例显示。',
    background: '#000000', imageBackground: '#000000', text: '#ffffff', muted: '#ffffff', accent: '#ffffff', border: '#000000'
  },
  {
    id: 'classic-white',
    layout: 'left-footer',
    name: '经典白边',
    description: '接近 EXIF Frame 的白色留白版式，适合大多数照片。',
    background: '#f7f4ef',
    imageBackground: '#ffffff',
    text: '#111111',
    muted: '#676767',
    accent: '#111111',
    border: '#ffffff'
  },
  {
    id: 'minimal-black',
    layout: 'left-footer',
    name: '黑底画廊',
    description: '深色背景与高对比信息栏，适合夜景和舞台照片。',
    background: '#111111',
    imageBackground: '#171717',
    text: '#f7f7f7',
    muted: '#a0a0a0',
    accent: '#ffffff',
    border: '#1f1f1f'
  },
  {
    id: 'magazine',
    layout: 'title-footer',
    name: '杂志页脚',
    description: '更强的品牌文字区，适合分享和作品集封面。',
    background: '#ece7dc',
    imageBackground: '#ffffff',
    text: '#151515',
    muted: '#6f675d',
    accent: '#8c6a2f',
    border: '#fbfaf6'
  },
  {
    id: 'right-rail',
    layout: 'right-rail',
    name: 'Right Rail',
    description: 'Photo on the left with a vertical metadata rail on the right.',
    background: '#f0eee8',
    imageBackground: '#ffffff',
    text: '#111111',
    muted: '#666666',
    accent: '#111111',
    border: '#ffffff'
  },
  {
    id: 'blurred-glass',
    layout: 'blurred-frame',
    name: '模糊背景',
    description: '照片居中悬浮，底部居中放相机镜头和曝光参数。',
    background: '#141414',
    imageBackground: '#ffffff',
    text: '#ffffff',
    muted: '#d0d0d0',
    accent: '#ffffff',
    border: '#ffffff'
  }
];

const escapeXml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const cleanText = (value, fallback = '') => {
  const text = String(value || '').trim();
  return text || fallback;
};

const compactParts = (parts) => parts.map(part => cleanText(part)).filter(Boolean);

const safeNumber = (value, fallback, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
};

const REFERENCE_LAYOUTS = new Set([
  'bare-photo', 'clean-border', 'center-single', 'center-double', 'single-date', 'double-date',
  'film-data', 'monitor-strip', 'lightroom-strip', 'photo-poster', 'notice-overlay', 'cinema-wide'
]);

export class ExifFrameService {
  constructor({ galleryService, config = {}, baseDir = process.cwd() }) {
    this.galleryService = galleryService;
    this.config = config;
    this.baseDir = baseDir;
    this.outputDir = path.resolve(baseDir, config.exifFrame?.outputDir || './server/cache/exif-frames');
    this.logoDir = path.resolve(baseDir, config.exifFrame?.logoDir || './public/brand-logos');
    fs.ensureDirSync(this.outputDir);
    fs.ensureDirSync(this.logoDir);
  }

  getTemplates() {
    return TEMPLATES.map(({ id, name, description, layout }) => ({ id, name, description, layout }));
  }

  detectBrand(camera = '', lens = '') {
    const text = `${camera || ''} ${lens || ''}`;
    const matched = BRAND_ALIASES.find(item => item.patterns.some(pattern => pattern.test(text)));
    if (matched) return matched;

    const firstToken = cleanText(camera).split(/\s+/)[0];
    if (firstToken) {
      const slug = firstToken.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return { brand: firstToken, slug: slug || 'camera', patterns: [] };
    }

    return { brand: 'Camera', slug: 'camera', patterns: [] };
  }

  getLogoPath(slug) {
    const safeSlug = String(slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '');
    if (!safeSlug) return null;

    for (const ext of ['png', 'svg', 'jpg', 'jpeg', 'webp']) {
      const logoPath = path.join(this.logoDir, `${safeSlug}.${ext}`);
      if (fs.existsSync(logoPath)) return logoPath;
    }

    return null;
  }

  async getLogoPngBuffer(slug) {
    const logoPath = this.getLogoPath(slug);
    if (!logoPath) return null;

    try {
      let input = logoPath;
      if (path.extname(logoPath).toLowerCase() === '.svg') {
        let svg = await fs.readFile(logoPath, 'utf8');
        // Remove the common full-canvas white backdrop used by downloaded logo SVGs.
        svg = svg.replace(/<path\b(?=[^>]*\bfill=["']#fff(?:fff)?["'])(?=[^>]*\bd=["']M0 0h[\d.]+v[\d.]+H0V0z["'])[^>]*\/>/gi, '');
        input = Buffer.from(svg);
      }

      return await sharp(input).trim({ threshold: 2 }).png().toBuffer();
    } catch {
      return null;
    }
  }

  buildFields(photo, overrides = {}) {
    const exif = photo.exif || {};
    const camera = cleanText(overrides.camera, exif.camera || 'Unknown Camera');
    const lens = cleanText(overrides.lens, exif.lens || '');
    const brandInfo = this.detectBrand(cleanText(overrides.brand, camera), lens);
    const brand = cleanText(overrides.brand, brandInfo.brand);

    return {
      brand,
      brandSlug: this.detectBrand(brand, lens).slug || brandInfo.slug,
      camera,
      lens,
      date: cleanText(overrides.date, photo.date || ''),
      location: cleanText(overrides.location, photo.location || ''),
      focalLength: cleanText(overrides.focalLength, exif.focalLength || ''),
      aperture: cleanText(overrides.aperture, exif.aperture || ''),
      shutter: cleanText(overrides.shutter, exif.shutter || ''),
      iso: cleanText(overrides.iso, exif.iso || ''),
      signature: cleanText(overrides.signature, this.config.photographerName || ''),
      title: cleanText(overrides.title, photo.title || '')
    };
  }

  getPreview(photoId, overrides = {}) {
    const photo = this.galleryService.getPhoto(photoId);
    if (!photo) throw new Error('Photo not found');

    const fields = this.buildFields(photo, overrides);
    const logoPath = this.getLogoPath(fields.brandSlug);
    return {
      photo: {
        id: photo.id,
        title: photo.title,
        url: `/photowall/api/display/${photo.id}`,
        thumbnail: `/photowall/api/thumbnail/${photo.id}`
      },
      fields,
      logo: logoPath ? {
        available: true,
        filename: path.basename(logoPath),
        url: `/photowall/api/exif-frame/logo/${encodeURIComponent(fields.brandSlug)}`
      } : {
        available: false,
        expectedNames: [
          `${fields.brandSlug}.svg`,
          `${fields.brandSlug}.png`,
          `${fields.brandSlug}.jpg`
        ],
        directory: './public/brand-logos'
      },
      templates: this.getTemplates()
    };
  }

  async buildLogoComposite(fields, template, left, top, width, height, customLogoBuffer = null) {
    const logoBuffer = customLogoBuffer
      ? await sharp(customLogoBuffer).trim({ threshold: 2 }).png().toBuffer()
      : await this.getLogoPngBuffer(fields.brandSlug);
    if (!logoBuffer) return null;

    try {
      const buffer = await sharp(logoBuffer)
        .resize(width, height, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      const metadata = await sharp(buffer).metadata();
      return {
        input: buffer,
        left: left + Math.round((width - metadata.width) / 2),
        top: top + Math.round((height - metadata.height) / 2)
      };
    } catch {
      return this.buildBrandTextComposite(fields.brand, template, left, top, width, height);
    }
  }

  buildBrandTextComposite(brand, template, left, top, width, height) {
    const label = String(brand || 'CAMERA').toUpperCase();
    const maxByHeight = Math.max(30, Math.round(height * 0.42));
    const maxByWidth = Math.max(24, Math.floor(width / Math.max(1, label.length) * 1.05));
    const fontSize = Math.min(maxByHeight, maxByWidth);
    const svg = Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${height}" rx="16" fill="none"/>
        <text x="0" y="${Math.round(height * 0.62)}"
          font-family="Arial, Helvetica, sans-serif"
          font-size="${fontSize}"
          font-weight="800"
          letter-spacing="0"
          fill="${template.accent}">${escapeXml(label)}</text>
      </svg>
    `);
    return { input: svg, left, top };
  }

  buildTextSvg(fields, template, width, height, mode) {
    const settings = compactParts([
      fields.focalLength,
      fields.aperture,
      fields.shutter,
      fields.iso ? `ISO ${fields.iso}` : ''
    ]).join('   ');
    const context = compactParts([fields.date, fields.location]).join(' / ');
    const cameraLine = compactParts([fields.camera, fields.lens]).join('  |  ');
    const title = fields.title || 'Untitled';
    const splitCameraLine = cameraLine.length > 36 && fields.lens;
    const cameraFontSize = splitCameraLine ? 31 : (cameraLine.length > 44 ? 28 : 34);
    const secondLine = splitCameraLine ? fields.lens : (settings || title);
    const settingsLine = splitCameraLine ? (settings || title) : '';
    const secondLineY = splitCameraLine ? 88 : 90;
    const settingsY = splitCameraLine ? 132 : 0;
    const contextY = splitCameraLine ? 174 : 140;

    if (mode === 'magazine') {
      return Buffer.from(`
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
          <text x="0" y="48" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700" fill="${template.text}">${escapeXml(title)}</text>
          <text x="0" y="94" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="${template.muted}">${escapeXml(context)}</text>
          <text x="0" y="145" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="600" fill="${template.text}">${escapeXml(cameraLine)}</text>
          <text x="0" y="190" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="${template.text}">${escapeXml(settings)}</text>
          <text x="0" y="232" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="${template.muted}">${escapeXml(fields.signature)}</text>
        </svg>
      `);
    }

    return Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <text x="0" y="42" font-family="Arial, Helvetica, sans-serif" font-size="${cameraFontSize}" font-weight="700" fill="${template.text}">${escapeXml(splitCameraLine ? fields.camera : cameraLine)}</text>
        <text x="0" y="${secondLineY}" font-family="Arial, Helvetica, sans-serif" font-size="${splitCameraLine ? 25 : 34}" fill="${template.text}">${escapeXml(secondLine)}</text>
        ${settingsLine ? `<text x="0" y="${settingsY}" font-family="Arial, Helvetica, sans-serif" font-size="25" fill="${template.text}">${escapeXml(settingsLine)}</text>` : ''}
        <text x="0" y="${contextY}" font-family="Arial, Helvetica, sans-serif" font-size="23" fill="${template.muted}">${escapeXml(context)}</text>
        <text x="0" y="${contextY + 42}" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="${template.muted}">${escapeXml(fields.signature)}</text>
      </svg>
    `);
  }

  buildRailTextSvg(fields, template, width, height) {
    const settings = compactParts([
      fields.focalLength,
      fields.aperture,
      fields.shutter,
      fields.iso ? `ISO ${fields.iso}` : ''
    ]).join('  ');
    return Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <text x="0" y="42" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="${template.text}">${escapeXml(fields.camera || 'Unknown Camera')}</text>
        <text x="0" y="86" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="${template.text}">${escapeXml(fields.lens || fields.title || '')}</text>
        <text x="0" y="130" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="${template.muted}">${escapeXml(settings || fields.title || '')}</text>
        <text x="0" y="178" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="${template.muted}">${escapeXml(compactParts([fields.date, fields.location]).join(' / '))}</text>
        <text x="0" y="222" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="${template.muted}">${escapeXml(fields.signature)}</text>
      </svg>
    `);
  }

  buildSplitFooterSvg(fields, template, width, height) {
    const exposure = compactParts([
      fields.iso ? `ISO ${fields.iso}` : '',
      fields.focalLength,
      fields.aperture,
      fields.shutter
    ]).join('   ');
    const camera = fields.camera || 'Unknown Camera';
    const lens = fields.lens || '';
    const rightEdge = width - Math.round(width * 0.02);
    const cameraSize = camera.length > 28 ? 20 : camera.length > 20 ? 24 : 29;
    const lensSize = lens.length > 40 ? 17 : lens.length > 28 ? 21 : 25;
    const firstLineY = Math.round(height * 0.43);
    const secondLineY = Math.round(height * 0.7);
    return Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <text x="${Math.round(width * 0.02)}" y="${firstLineY}" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="600" fill="${template.text}">${escapeXml(exposure)}</text>
        <text x="${Math.round(width * 0.02)}" y="${secondLineY}" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="${template.muted}">${escapeXml(fields.date)}</text>
        <line x1="${Math.round(width * 0.79)}" x2="${Math.round(width * 0.79)}" y1="${Math.round(height * 0.18)}" y2="${Math.round(height * 0.78)}" stroke="${template.muted}" stroke-width="2"/>
        <text x="${rightEdge}" y="${firstLineY}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="${cameraSize}" font-weight="700" fill="${template.text}">${escapeXml(camera)}</text>
        <text x="${rightEdge}" y="${secondLineY}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="${lensSize}" fill="${template.muted}">${escapeXml(lens)}</text>
      </svg>
    `);
  }

  buildBlurredFooterSvg(fields, width, height) {
    const cameraLine = compactParts([fields.camera, fields.lens]).join('  |  ');
    const exposure = compactParts([
      fields.iso ? `ISO ${fields.iso}` : '',
      fields.focalLength,
      fields.aperture,
      fields.shutter
    ]).join('  |  ');
    return Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <text x="${Math.round(width / 2)}" y="${Math.round(height * 0.3)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="27" fill="#ffffff">${escapeXml(cameraLine)}</text>
        <text x="${Math.round(width / 2)}" y="${Math.round(height * 0.56)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="26" fill="#ffffff">${escapeXml(exposure)}</text>
      </svg>
    `);
  }

  async createReferenceFrame({ photo, fields, template, canvasWidth }) {
    const layout = template.layout;
    const centeredFooter = ['center-single', 'center-double', 'single-date', 'double-date'].includes(layout);
    const padding = Math.round(canvasWidth * (
      layout === 'clean-border' || centeredFooter ? 0.022 : layout === 'lightroom-strip' ? 0.008 : 0
    ));
    const headerHeight = layout === 'cinema-wide' ? Math.round(canvasWidth * 0.065) : 0;
    const footerHeight = Math.round(canvasWidth * ({
      'center-single': 0.065, 'center-double': 0.088,
      'single-date': 0.065, 'double-date': 0.115,
      'monitor-strip': 0.03, 'lightroom-strip': 0.04,
      'cinema-wide': 0.065
    }[layout] || 0));
    const targetWidth = canvasWidth - padding * 2;
    const photoPipeline = sharp(photo.originalPath).rotate();
    const imageBuffer = layout === 'cinema-wide'
      ? await photoPipeline.resize(canvasWidth, Math.round(canvasWidth * 0.54), { fit: 'cover' }).jpeg({ quality: 92 }).toBuffer()
      : layout === 'bare-photo'
        ? await photoPipeline.resize({ width: canvasWidth }).jpeg({ quality: 92 }).toBuffer()
        : await photoPipeline.resize({ width: targetWidth, height: Math.round(canvasWidth * 1.1), fit: 'inside' }).jpeg({ quality: 92 }).toBuffer();
    const imageMeta = await sharp(imageBuffer).metadata();
    const imageWidth = imageMeta.width;
    const imageHeight = imageMeta.height;
    const canvasHeight = imageHeight + padding * 2 + headerHeight + footerHeight;
    const imageLeft = Math.round((canvasWidth - imageWidth) / 2);
    const imageTop = padding + headerHeight;
    const exposure = compactParts([fields.iso ? `ISO ${fields.iso}` : '', fields.focalLength, fields.aperture, fields.shutter]).join('   ');
    const camera = compactParts([fields.camera, fields.lens]).join('  |  ');
    const date = fields.date || '';
    const composites = [{ input: imageBuffer, left: imageLeft, top: imageTop }];
    const overlay = (content, width = canvasWidth, height = footerHeight, left = 0, top = imageTop + imageHeight) => {
      composites.push({
        input: Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${content}</svg>`),
        left, top
      });
    };

    if (centeredFooter) {
      const middle = Math.round(canvasWidth / 2);
      const first = layout === 'center-single' ? compactParts([camera, exposure]).join('  ·  ') : camera;
      const firstSize = Math.max(20, 29 - Math.max(0, first.length - 55) * 0.15);
      if (layout === 'single-date') {
        overlay(`
          <text x="${padding + 20}" y="${Math.round(footerHeight * 0.57)}" font-family="Arial, sans-serif" font-size="25" fill="#222">${escapeXml(exposure)}</text>
          <text x="${canvasWidth - padding - 20}" y="${Math.round(footerHeight * 0.57)}" text-anchor="end" font-family="Arial, sans-serif" font-size="24" fill="#777">${escapeXml(date)}</text>
        `);
      } else {
        const firstY = Math.round(footerHeight * (layout === 'center-single' ? 0.56 : layout === 'double-date' ? 0.32 : 0.39));
        overlay(`
          <text x="${middle}" y="${firstY}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${firstSize}" font-weight="600" fill="#222">${escapeXml(first)}</text>
          ${layout !== 'center-single' ? `<text x="${middle}" y="${Math.round(footerHeight * (layout === 'double-date' ? 0.6 : 0.75))}" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" fill="#666">${escapeXml(exposure)}</text>` : ''}
          ${layout === 'double-date' ? `<text x="${middle}" y="${Math.round(footerHeight * 0.84)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#888">${escapeXml(date)}</text>` : ''}
        `);
      }
    } else if (layout === 'film-data') {
      const left = compactParts([fields.camera, fields.lens, date]);
      const right = compactParts([fields.aperture, fields.shutter, fields.iso ? `ISO ${fields.iso}` : '', fields.focalLength]);
      overlay(`
        <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".62"/></linearGradient></defs>
        <rect y="${Math.round(imageHeight * 0.68)}" width="${imageWidth}" height="${Math.round(imageHeight * 0.32)}" fill="url(#shade)"/>
        ${left.map((line, index) => `<text x="32" y="${imageHeight - 90 + index * 27}" font-family="Arial, sans-serif" font-size="21" fill="#f6bb58">${escapeXml(line)}</text>`).join('')}
        ${right.map((line, index) => `<text x="${imageWidth - 32}" y="${imageHeight - 116 + index * 27}" text-anchor="end" font-family="Arial, sans-serif" font-size="21" fill="#f6bb58">${escapeXml(line)}</text>`).join('')}
      `, imageWidth, imageHeight, imageLeft, imageTop);
    } else if (layout === 'monitor-strip') {
      const values = [fields.aperture, fields.shutter, fields.iso ? `ISO ${fields.iso}` : '', fields.focalLength];
      overlay(`<rect width="${canvasWidth}" height="${footerHeight}" fill="#050505"/>${values.map((value, index) => `<text x="${Math.round(canvasWidth * (index + 0.5) / 4)}" y="${Math.round(footerHeight * 0.67)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#fff">${escapeXml(value)}</text>`).join('')}`);
    } else if (layout === 'lightroom-strip') {
      overlay(`
        <rect width="${canvasWidth}" height="${footerHeight}" fill="#1c1c1c"/>
        <text x="32" y="${Math.round(footerHeight * 0.64)}" font-family="Arial, sans-serif" font-size="23" fill="#eee">${escapeXml(exposure)}</text>
        <text x="${Math.round(canvasWidth / 2)}" y="${Math.round(footerHeight * 0.64)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="23" fill="#eee">${escapeXml(camera)}</text>
        <text x="${canvasWidth - 32}" y="${Math.round(footerHeight * 0.64)}" text-anchor="end" font-family="Arial, sans-serif" font-size="22" fill="#bbb">${escapeXml(date)}</text>
      `);
    } else if (layout === 'photo-poster' || layout === 'notice-overlay') {
      const shade = `<defs><linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".56"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient><linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient></defs><rect width="${imageWidth}" height="${Math.round(imageHeight * 0.32)}" fill="url(#top)"/><rect y="${Math.round(imageHeight * 0.66)}" width="${imageWidth}" height="${Math.round(imageHeight * 0.34)}" fill="url(#bottom)"/>`;
      const body = layout === 'photo-poster'
        ? `<text x="48" y="100" font-family="Arial, sans-serif" font-size="72" font-weight="700" fill="#fff">${escapeXml(fields.title)}</text><text x="48" y="${imageHeight - 76}" font-family="Arial, sans-serif" font-size="35" fill="#fff">${escapeXml(fields.location || fields.signature)}</text><text x="48" y="${imageHeight - 36}" font-family="Arial, sans-serif" font-size="24" fill="#eee">${escapeXml(date)}</text>`
        : `<text x="${imageWidth - 48}" y="70" text-anchor="end" font-family="Arial, sans-serif" font-size="35" font-weight="700" fill="#fff">${escapeXml(fields.camera)}</text><text x="${imageWidth - 48}" y="112" text-anchor="end" font-family="Arial, sans-serif" font-size="27" fill="#eee">${escapeXml(fields.lens)}</text><text x="${Math.round(imageWidth / 2)}" y="${imageHeight - 42}" text-anchor="middle" font-family="Arial, sans-serif" font-size="27" fill="#fff">${escapeXml(exposure)}</text>`;
      overlay(shade + body, imageWidth, imageHeight, imageLeft, imageTop);
    }

    const hash = crypto.createHash('md5')
      .update(JSON.stringify({ photoId: photo.id, layout, fields, canvasWidth }))
      .update(String(Date.now()))
      .digest('hex').slice(0, 12);
    const filename = `exif_frame_${hash}.jpg`;
    const outputPath = path.join(this.outputDir, filename);
    await sharp({ create: { width: canvasWidth, height: canvasHeight, channels: 4, background: template.background } })
      .composite(composites)
      .jpeg({ quality: 92, mozjpeg: true })
      .toFile(outputPath);
    return {
      filename, url: `/photowall/api/exif-frame/file/${filename}`, path: outputPath,
      template: { id: template.id, name: template.name }, fields,
      size: { width: canvasWidth, height: canvasHeight }, logoUsed: false
    };
  }

  async createFrame({ photoId, templateId = 'exif-split', overrides = {}, width = 1800, customLogoBuffer = null } = {}) {
    const photo = this.galleryService.getPhoto(photoId);
    if (!photo) throw new Error('Photo not found');
    if (!photo.originalPath || !await fs.pathExists(photo.originalPath)) {
      throw new Error('Original image file not found');
    }

    const template = TEMPLATES.find(item => item.id === templateId) || TEMPLATES[0];
    const fields = this.buildFields(photo, overrides);
    const canvasWidth = safeNumber(width, 1800, 900, 2800);
    const layout = template.layout || 'left-footer';
    if (REFERENCE_LAYOUTS.has(layout)) {
      return this.createReferenceFrame({ photo, fields, template, canvasWidth });
    }
    const outerPadding = Math.round(canvasWidth * (layout === 'split-footer' ? 0.025 : 0.06));
    const sideWidth = layout === 'right-rail' ? Math.round(canvasWidth * 0.28) : 0;
    const footerHeight = layout === 'right-rail'
      ? 0
      : Math.round(canvasWidth * (
        layout === 'title-footer' ? 0.28 :
          layout === 'split-footer' ? 0.095 :
            layout === 'blurred-frame' ? 0.085 : 0.24
      ));
    const imageMaxWidth = layout === 'blurred-frame'
      ? Math.round(canvasWidth * 0.78)
      : canvasWidth - outerPadding * 2 - sideWidth - (sideWidth > 0 ? outerPadding : 0);

    const imageBuffer = await sharp(photo.originalPath)
      .rotate()
      .resize({
        width: imageMaxWidth,
        height: Math.round(canvasWidth * 1.1),
        fit: 'inside'
      })
      .jpeg({ quality: 92 })
      .toBuffer();
    const imageMeta = await sharp(imageBuffer).metadata();
    const imageWidth = imageMeta.width || imageMaxWidth;
    const imageHeight = imageMeta.height || Math.round(canvasWidth * 0.75);
    const canvasHeight = imageHeight + outerPadding * (layout === 'blurred-frame' ? 1 : 2) + footerHeight;
    const imageLeft = layout === 'right-rail'
      ? outerPadding
      : Math.round((canvasWidth - imageWidth) / 2);
    const imageTop = outerPadding;
    const footerTop = imageTop + imageHeight + Math.round(outerPadding * (layout === 'blurred-frame' ? 0 : layout === 'split-footer' ? 0.1 : 0.58));
    const footerInnerWidth = canvasWidth - outerPadding * 2;
    const logoWidth = Math.round(footerInnerWidth * (layout === 'title-footer' ? 0.26 : 0.22));
    const logoHeight = Math.max(64, Math.round((footerHeight || canvasWidth * 0.2) * 0.55));
    const textLeft = outerPadding + logoWidth + Math.round(canvasWidth * 0.035);
    const textWidth = Math.max(300, canvasWidth - textLeft - outerPadding);
    const textHeight = Math.max(250, footerHeight - Math.round(outerPadding * 0.2));

    const composites = [
      ...(layout === 'blurred-frame' ? [] : [{
        input: await sharp({
          create: {
            width: imageWidth + 10,
            height: imageHeight + 10,
            channels: 4,
            background: template.border
          }
        }).png().toBuffer(),
        left: imageLeft - 5,
        top: imageTop - 5
      }]),
      { input: imageBuffer, left: imageLeft, top: imageTop },
    ];

    if (layout === 'split-footer') {
      const plateHeight = imageHeight + footerHeight;
      composites.unshift({
        input: await sharp({ create: { width: imageWidth, height: plateHeight, channels: 4, background: '#ffffff' } }).png().toBuffer(),
        left: imageLeft,
        top: imageTop
      });
      composites.push({ input: this.buildSplitFooterSvg(fields, template, imageWidth, footerHeight), left: imageLeft, top: footerTop });
      const splitLogoWidth = Math.round(imageWidth * 0.145);
      const splitLogoHeight = Math.round(footerHeight * 0.62);
      const splitLogoLeft = imageLeft + Math.round(imageWidth * 0.625);
      const splitLogoTop = footerTop + Math.round(footerHeight * 0.12);
      const splitLogo = await this.buildLogoComposite(fields, template, splitLogoLeft, splitLogoTop, splitLogoWidth, splitLogoHeight, customLogoBuffer);
      composites.push(splitLogo || this.buildBrandTextComposite(fields.brand, template, splitLogoLeft, splitLogoTop, splitLogoWidth, splitLogoHeight));
    } else if (layout === 'blurred-frame') {
      composites.push({
        input: this.buildBlurredFooterSvg(fields, canvasWidth, footerHeight),
        left: 0,
        top: footerTop
      });
    } else if (layout === 'right-rail') {
      const railLeft = imageLeft + imageWidth + outerPadding;
      const railWidth = Math.max(260, canvasWidth - railLeft - outerPadding);
      const railLogoHeight = Math.round(canvasHeight * 0.14);
      const railLogo = await this.buildLogoComposite(fields, template, railLeft, imageTop, railWidth, railLogoHeight, customLogoBuffer);
      composites.push(railLogo || this.buildBrandTextComposite(fields.brand, template, railLeft, imageTop, railWidth, railLogoHeight));
      composites.push({
        input: this.buildRailTextSvg(fields, template, railWidth, Math.max(360, imageHeight - railLogoHeight - outerPadding)),
        left: railLeft,
        top: imageTop + railLogoHeight + outerPadding
      });
    } else {
      composites.push({
        input: this.buildTextSvg(fields, template, textWidth, textHeight, template.id),
        left: textLeft,
        top: footerTop
      });
      const logoComposite = await this.buildLogoComposite(
        fields,
        template,
        outerPadding,
        footerTop + Math.round(textHeight * 0.08),
        logoWidth,
        logoHeight,
        customLogoBuffer
      );
      composites.push(logoComposite || this.buildBrandTextComposite(fields.brand, template, outerPadding, footerTop, logoWidth, logoHeight));
    }

    const hash = crypto.createHash('md5')
      .update(JSON.stringify({ photoId, templateId, overrides, width }))
      .update(String(Date.now()))
      .digest('hex')
      .slice(0, 12);
    const filename = `exif_frame_${hash}.jpg`;
    const outputPath = path.join(this.outputDir, filename);

    const baseImage = layout === 'blurred-frame'
      ? sharp(photo.originalPath)
        .rotate()
        .resize(canvasWidth, canvasHeight, { fit: 'cover' })
        .blur(46)
        .modulate({ brightness: 0.72, saturation: 0.85 })
      : sharp({
        create: {
          width: canvasWidth,
          height: canvasHeight,
          channels: 4,
          background: template.background
        }
      });

    await baseImage
      .composite(composites.filter(Boolean))
      .jpeg({ quality: 92, mozjpeg: true })
      .toFile(outputPath);

    return {
      filename,
      url: `/photowall/api/exif-frame/file/${filename}`,
      path: outputPath,
      template: { id: template.id, name: template.name },
      fields,
      size: { width: canvasWidth, height: canvasHeight },
      logoUsed: Boolean(customLogoBuffer || this.getLogoPath(fields.brandSlug))
    };
  }

  getFrameFile(filename) {
    return path.join(this.outputDir, path.basename(filename));
  }
}
