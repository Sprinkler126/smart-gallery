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
  { brand: 'Panasonic', slug: 'panasonic', patterns: [/panasonic/i, /lumix/i] },
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
    id: 'mobile',
    layout: 'compact-footer',
    name: '手机水印',
    description: '紧凑信息栏，适合手机样张和社交平台。',
    background: '#ffffff',
    imageBackground: '#ffffff',
    text: '#171717',
    muted: '#707070',
    accent: '#171717',
    border: '#ffffff'
  },
  {
    id: 'top-logo',
    layout: 'top-header',
    name: 'Top Brand',
    description: 'Logo and title sit above the photo, EXIF details stay below.',
    background: '#f5f2ec',
    imageBackground: '#ffffff',
    text: '#141414',
    muted: '#6b6b6b',
    accent: '#111111',
    border: '#ffffff'
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
    id: 'poster',
    layout: 'center-footer',
    name: 'Poster',
    description: 'Large photo with centered brand and a quiet caption area underneath.',
    background: '#ffffff',
    imageBackground: '#ffffff',
    text: '#171717',
    muted: '#777777',
    accent: '#171717',
    border: '#ffffff'
  },
  {
    id: 'warm-card',
    layout: 'left-footer',
    name: 'Warm Card',
    description: 'Warm editorial card with a larger footer and relaxed spacing.',
    background: '#eadfce',
    imageBackground: '#fffaf2',
    text: '#211a13',
    muted: '#766b5d',
    accent: '#7a4f20',
    border: '#fffaf2'
  },
  {
    id: 'blurred-glass',
    layout: 'blurred-frame',
    name: 'Blurred Glass',
    description: 'Frosted glass frame using a blurred copy of the photo as the background.',
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

    for (const ext of ['svg', 'png', 'jpg', 'jpeg', 'webp']) {
      const logoPath = path.join(this.logoDir, `${safeSlug}.${ext}`);
      if (fs.existsSync(logoPath)) return logoPath;
    }

    return null;
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
        filename: path.basename(logoPath)
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
    const logoPath = customLogoBuffer ? null : this.getLogoPath(fields.brandSlug);
    if (!customLogoBuffer && !logoPath) return null;

    try {
      const buffer = await sharp(customLogoBuffer || logoPath)
        .resize(width, height, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      return { input: buffer, left, top };
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

  buildHeaderSvg(fields, template, width, height) {
    return Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <text x="0" y="${Math.round(height * 0.42)}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(height * 0.28)}" font-weight="700" fill="${template.text}">${escapeXml(fields.title || 'Untitled')}</text>
        <text x="0" y="${Math.round(height * 0.72)}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(height * 0.16)}" fill="${template.muted}">${escapeXml(compactParts([fields.date, fields.location]).join(' / '))}</text>
      </svg>
    `);
  }

  buildCenterTextSvg(fields, template, width, height) {
    const settings = compactParts([
      fields.camera,
      fields.lens,
      fields.focalLength,
      fields.aperture,
      fields.shutter,
      fields.iso ? `ISO ${fields.iso}` : ''
    ]).join('  |  ');
    return Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <text x="${Math.round(width / 2)}" y="44" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="${template.text}">${escapeXml(fields.title || 'Untitled')}</text>
        <text x="${Math.round(width / 2)}" y="92" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="${template.text}">${escapeXml(settings)}</text>
        <text x="${Math.round(width / 2)}" y="136" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="${template.muted}">${escapeXml(compactParts([fields.date, fields.location]).join(' / '))}</text>
        <text x="${Math.round(width / 2)}" y="178" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="${template.muted}">${escapeXml(fields.signature)}</text>
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

  buildGlassOverlaySvg(width, height, panelX, panelY, panelWidth, panelHeight) {
    return Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="v" cx="50%" cy="42%" r="72%">
            <stop offset="0%" stop-color="rgba(0,0,0,0)"/>
            <stop offset="100%" stop-color="rgba(0,0,0,0.42)"/>
          </radialGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="rgba(255,255,255,0.08)"/>
        <rect width="${width}" height="${height}" fill="url(#v)"/>
        <rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" fill="rgba(20,20,20,0.34)" stroke="rgba(255,255,255,0.36)" stroke-width="2"/>
      </svg>
    `);
  }

  async createFrame({ photoId, templateId = 'classic-white', overrides = {}, width = 1800, customLogoBuffer = null } = {}) {
    const photo = this.galleryService.getPhoto(photoId);
    if (!photo) throw new Error('Photo not found');
    if (!photo.originalPath || !await fs.pathExists(photo.originalPath)) {
      throw new Error('Original image file not found');
    }

    const template = TEMPLATES.find(item => item.id === templateId) || TEMPLATES[0];
    const fields = this.buildFields(photo, overrides);
    const canvasWidth = safeNumber(width, 1800, 900, 2800);
    const layout = template.layout || 'left-footer';
    const isMobileTemplate = template.id === 'mobile';
    const outerPadding = Math.round(canvasWidth * (isMobileTemplate ? 0.045 : 0.06));
    const headerHeight = layout === 'top-header' ? Math.round(canvasWidth * 0.16) : 0;
    const sideWidth = layout === 'right-rail' ? Math.round(canvasWidth * 0.28) : 0;
    const footerHeight = layout === 'right-rail'
      ? 0
      : Math.round(canvasWidth * (
        layout === 'compact-footer' ? 0.16 :
          layout === 'title-footer' ? 0.28 :
            layout === 'center-footer' ? 0.3 :
              layout === 'blurred-frame' ? 0.24 : 0.24
      ));
    const imageMaxWidth = canvasWidth - outerPadding * 2 - sideWidth - (sideWidth > 0 ? outerPadding : 0);

    const imageBuffer = await sharp(photo.originalPath)
      .rotate()
      .resize({
        width: imageMaxWidth,
        height: Math.round(canvasWidth * 1.1),
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 92 })
      .toBuffer();
    const imageMeta = await sharp(imageBuffer).metadata();
    const imageWidth = imageMeta.width || imageMaxWidth;
    const imageHeight = imageMeta.height || Math.round(canvasWidth * 0.75);
    const canvasHeight = imageHeight + outerPadding * 2 + footerHeight + headerHeight;
    const imageLeft = layout === 'right-rail'
      ? outerPadding
      : Math.round((canvasWidth - imageWidth) / 2);
    const imageTop = outerPadding + headerHeight;
    const footerTop = imageTop + imageHeight + Math.round(outerPadding * 0.58);
    const footerInnerWidth = canvasWidth - outerPadding * 2;
    const logoWidth = Math.round(footerInnerWidth * (layout === 'title-footer' ? 0.26 : 0.22));
    const logoHeight = Math.max(64, Math.round((footerHeight || canvasWidth * 0.2) * 0.55));
    const textLeft = outerPadding + logoWidth + Math.round(canvasWidth * 0.035);
    const textWidth = Math.max(300, canvasWidth - textLeft - outerPadding);
    const textHeight = Math.max(250, footerHeight - Math.round(outerPadding * 0.2));

    const composites = [
      {
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
      },
      { input: imageBuffer, left: imageLeft, top: imageTop },
    ];

    if (layout === 'blurred-frame') {
      const glassPanelX = imageLeft - 5;
      const glassPanelY = imageTop + imageHeight + Math.round(outerPadding * 0.45);
      const glassPanelWidth = imageWidth + 10;
      const glassBottomMargin = Math.round(outerPadding * 0.5);
      const glassPanelHeight = Math.max(200, canvasHeight - glassPanelY - glassBottomMargin);
      const glassPad = Math.round(canvasWidth * 0.028);
      const glassGap = Math.round(canvasWidth * 0.035);
      const glassLogoWidth = Math.round(glassPanelWidth * 0.22);
      const glassLogoHeight = Math.max(56, glassPanelHeight - glassPad * 2);
      const glassTextLeft = glassPanelX + glassPad + glassLogoWidth + glassGap;
      const glassTextWidth = Math.max(260, glassPanelX + glassPanelWidth - glassTextLeft - glassPad);
      const glassTextTop = glassPanelY + glassPad;
      const glassTextHeight = Math.max(190, glassPanelHeight - glassPad * 2);
      composites.unshift({
        input: this.buildGlassOverlaySvg(canvasWidth, canvasHeight, glassPanelX, glassPanelY, glassPanelWidth, glassPanelHeight),
        left: 0,
        top: 0
      });
      composites.push({
        input: this.buildTextSvg(fields, template, glassTextWidth, glassTextHeight, template.id),
        left: glassTextLeft,
        top: glassTextTop
      });
      const logoComposite = await this.buildLogoComposite(
        fields,
        template,
        glassPanelX + glassPad,
        glassTextTop + Math.round(glassTextHeight * 0.08),
        glassLogoWidth,
        glassLogoHeight,
        customLogoBuffer
      );
      composites.push(logoComposite || this.buildBrandTextComposite(fields.brand, template, glassPanelX + glassPad, glassTextTop, glassLogoWidth, glassLogoHeight));
    } else if (layout === 'top-header') {
      const headerLogoWidth = Math.round(canvasWidth * 0.2);
      const headerLogoHeight = Math.round(headerHeight * 0.58);
      const headerLogoTop = outerPadding + Math.round(headerHeight * 0.18);
      const headerTextLeft = outerPadding + headerLogoWidth + Math.round(canvasWidth * 0.04);
      const headerLogo = await this.buildLogoComposite(fields, template, outerPadding, headerLogoTop, headerLogoWidth, headerLogoHeight, customLogoBuffer);
      composites.push(headerLogo || this.buildBrandTextComposite(fields.brand, template, outerPadding, headerLogoTop, headerLogoWidth, headerLogoHeight));
      composites.push({
        input: this.buildHeaderSvg(fields, template, canvasWidth - headerTextLeft - outerPadding, headerHeight),
        left: headerTextLeft,
        top: outerPadding
      });
      composites.push({
        input: this.buildTextSvg(fields, template, footerInnerWidth, Math.max(210, footerHeight), template.id),
        left: outerPadding,
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
    } else if (layout === 'center-footer') {
      const centerLogoWidth = Math.round(footerInnerWidth * 0.24);
      const centerLogoHeight = Math.round(footerHeight * 0.36);
      const centerLogoLeft = Math.round((canvasWidth - centerLogoWidth) / 2);
      const centerLogo = await this.buildLogoComposite(fields, template, centerLogoLeft, footerTop, centerLogoWidth, centerLogoHeight, customLogoBuffer);
      composites.push(centerLogo || this.buildBrandTextComposite(fields.brand, template, centerLogoLeft, footerTop, centerLogoWidth, centerLogoHeight));
      composites.push({
        input: this.buildCenterTextSvg(fields, template, footerInnerWidth, Math.max(190, footerHeight - centerLogoHeight), template.id),
        left: outerPadding,
        top: footerTop + centerLogoHeight + Math.round(outerPadding * 0.2)
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
