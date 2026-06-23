import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import sharp from 'sharp';

const clamp = (value, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
};

const toDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const dayOfYear = (date) => {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
};

const parseScore = (value) => {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return score > 10 ? score / 10 : score;
};

const gridCells = (columns, rows, count = columns * rows) =>
  Array.from({ length: count }, (_, index) => ({
    x: (index % columns) / columns,
    y: Math.floor(index / columns) / rows,
    w: 1 / columns,
    h: 1 / rows
  }));

const normalizeCells = (cells = []) =>
  cells
    .map(cell => ({
      x: clamp(Number(cell.x) || 0, 0, 1),
      y: clamp(Number(cell.y) || 0, 0, 1),
      w: clamp(Number(cell.w) || 0, 0.05, 1),
      h: clamp(Number(cell.h) || 0, 0.05, 1)
    }))
    .filter(cell => cell.x + cell.w <= 1.02 && cell.y + cell.h <= 1.02);

const normalizeFocus = (items = []) =>
  items.map(item => ({
    x: clamp(Number(item?.x), 0, 1),
    y: clamp(Number(item?.y), 0, 1)
  }));

export class CreativeService {
  constructor({ galleryService, aiAnalysisService, config = {}, baseDir = process.cwd() }) {
    this.galleryService = galleryService;
    this.aiAnalysisService = aiAnalysisService;
    this.config = config;
    this.baseDir = baseDir;
    this.outputDir = path.resolve(baseDir, config.creations?.outputDir || './server/cache/creations');
    fs.ensureDirSync(this.outputDir);
  }

  getPromptSuggestions(now = new Date()) {
    const yyyy = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return [
      {
        id: 'on-this-day',
        label: '那年今日',
        prompt: `那年今日 ${month}-${day} 适合做回忆拼图的照片`,
        intent: 'anniversary',
        description: '按月日窗口召回历年照片，再用 AI 美学和质量分排序'
      },
      {
        id: 'recent-best',
        label: '最近高光',
        prompt: `${yyyy} 最近适合做照片墙封面的高质量照片`,
        intent: 'highlight',
        description: '优先近期、横图、AI 美学分较高的照片'
      },
      {
        id: 'travel-story',
        label: '旅行故事',
        prompt: '旅行 风景 城市 适合自动剪辑的照片',
        intent: 'story',
        description: '用语义标签和描述召回可串成短片的照片'
      },
      {
        id: 'people-moments',
        label: '人物瞬间',
        prompt: '人物 合照 快乐 适合拼图的照片',
        intent: 'people',
        description: '偏向人物和情绪标签，适合手机相册式引导'
      }
    ];
  }

  getTemplates() {
    return [
      {
        id: 'single-hero',
        name: '单图封面',
        ratio: '4:5',
        minPhotos: 1,
        maxPhotos: 1,
        cells: [{ x: 0, y: 0, w: 1, h: 1 }]
      },
      {
        id: 'duo-split',
        name: '双图并列',
        ratio: '4:3',
        minPhotos: 2,
        maxPhotos: 2,
        cells: [
          { x: 0, y: 0, w: 0.5, h: 1 },
          { x: 0.5, y: 0, w: 0.5, h: 1 }
        ]
      },
      {
        id: 'duo-stack',
        name: '双图上下',
        ratio: '4:5',
        minPhotos: 2,
        maxPhotos: 2,
        cells: [
          { x: 0, y: 0, w: 1, h: 0.5 },
          { x: 0, y: 0.5, w: 1, h: 0.5 }
        ]
      },
      {
        id: 'story-triptych',
        name: '三图故事',
        ratio: '16:9',
        minPhotos: 3,
        maxPhotos: 3,
        cells: [
          { x: 0, y: 0, w: 0.58, h: 1 },
          { x: 0.58, y: 0, w: 0.42, h: 0.5 },
          { x: 0.58, y: 0.5, w: 0.42, h: 0.5 }
        ]
      },
      {
        id: 'three-stack',
        name: '三段竖版',
        ratio: '9:16',
        minPhotos: 3,
        maxPhotos: 3,
        cells: [
          { x: 0, y: 0, w: 1, h: 0.45 },
          { x: 0, y: 0.45, w: 1, h: 0.275 },
          { x: 0, y: 0.725, w: 1, h: 0.275 }
        ]
      },
      {
        id: 'classic-grid-4',
        name: '四宫格',
        ratio: '1:1',
        minPhotos: 4,
        maxPhotos: 4,
        cells: gridCells(2, 2)
      },
      {
        id: 'asym-4',
        name: '主图四拼',
        ratio: '4:3',
        minPhotos: 4,
        maxPhotos: 4,
        cells: [
          { x: 0, y: 0, w: 0.62, h: 1 },
          { x: 0.62, y: 0, w: 0.38, h: 0.34 },
          { x: 0.62, y: 0.34, w: 0.38, h: 0.33 },
          { x: 0.62, y: 0.67, w: 0.38, h: 0.33 }
        ]
      },
      {
        id: 'cover-plus-4',
        name: '封面加四格',
        ratio: '4:5',
        minPhotos: 5,
        maxPhotos: 5,
        cells: [
          { x: 0, y: 0, w: 1, h: 0.56 },
          { x: 0, y: 0.56, w: 0.5, h: 0.22 },
          { x: 0.5, y: 0.56, w: 0.5, h: 0.22 },
          { x: 0, y: 0.78, w: 0.5, h: 0.22 },
          { x: 0.5, y: 0.78, w: 0.5, h: 0.22 }
        ]
      },
      {
        id: 'postcard-5',
        name: '明信片五图',
        ratio: '3:2',
        minPhotos: 5,
        maxPhotos: 5,
        cells: [
          { x: 0, y: 0, w: 0.5, h: 0.5 },
          { x: 0.5, y: 0, w: 0.5, h: 0.5 },
          { x: 0, y: 0.5, w: 0.34, h: 0.5 },
          { x: 0.34, y: 0.5, w: 0.33, h: 0.5 },
          { x: 0.67, y: 0.5, w: 0.33, h: 0.5 }
        ]
      },
      {
        id: 'magazine-6',
        name: '杂志六图',
        ratio: '3:2',
        minPhotos: 6,
        maxPhotos: 6,
        cells: [
          { x: 0, y: 0, w: 0.5, h: 0.66 },
          { x: 0.5, y: 0, w: 0.25, h: 0.33 },
          { x: 0.75, y: 0, w: 0.25, h: 0.33 },
          { x: 0.5, y: 0.33, w: 0.5, h: 0.33 },
          { x: 0, y: 0.66, w: 0.5, h: 0.34 },
          { x: 0.5, y: 0.66, w: 0.5, h: 0.34 }
        ]
      },
      {
        id: 'film-strip-6',
        name: '电影胶片',
        ratio: '16:9',
        minPhotos: 4,
        maxPhotos: 6,
        cells: [
          { x: 0, y: 0, w: 0.52, h: 1 },
          { x: 0.52, y: 0, w: 0.24, h: 0.5 },
          { x: 0.76, y: 0, w: 0.24, h: 0.5 },
          { x: 0.52, y: 0.5, w: 0.16, h: 0.5 },
          { x: 0.68, y: 0.5, w: 0.16, h: 0.5 },
          { x: 0.84, y: 0.5, w: 0.16, h: 0.5 }
        ]
      },
      {
        id: 'mosaic-8',
        name: '八图马赛克',
        ratio: '4:5',
        minPhotos: 6,
        maxPhotos: 8,
        cells: [
          { x: 0, y: 0, w: 0.66, h: 0.5 },
          { x: 0.66, y: 0, w: 0.34, h: 0.25 },
          { x: 0.66, y: 0.25, w: 0.34, h: 0.25 },
          { x: 0, y: 0.5, w: 0.33, h: 0.25 },
          { x: 0.33, y: 0.5, w: 0.34, h: 0.25 },
          { x: 0.67, y: 0.5, w: 0.33, h: 0.25 },
          { x: 0, y: 0.75, w: 0.5, h: 0.25 },
          { x: 0.5, y: 0.75, w: 0.5, h: 0.25 }
        ]
      },
      {
        id: 'nine-grid',
        name: '九宫格',
        ratio: '1:1',
        minPhotos: 7,
        maxPhotos: 9,
        cells: gridCells(3, 3)
      },
      {
        id: 'twelve-wall',
        name: '十二图照片墙',
        ratio: '16:9',
        minPhotos: 10,
        maxPhotos: 12,
        cells: gridCells(4, 3)
      }
    ];
  }

  getAnalysis(photoId) {
    return this.aiAnalysisService.cache?.get?.(photoId) || null;
  }

  toPublicPhoto(photo) {
    return {
      id: photo.id,
      url: `/photowall/api/display/${photo.id}`,
      originalUrl: `/photowall/api/image/${photo.id}`,
      thumbnail: `/photowall/api/thumbnail/${photo.id}`,
      blurPlaceholder: photo.blurPlaceholder,
      title: photo.title,
      category: photo.category,
      date: photo.date,
      location: photo.location,
      exif: photo.exif,
      dimensions: photo.dimensions,
      sourceId: photo.sourceId
    };
  }

  buildSearchText(photo, analysis) {
    return [
      photo.title,
      photo.category,
      photo.location,
      photo.date,
      ...(analysis?.tags || []),
      analysis?.category,
      analysis?.description,
      analysis?.depict,
      analysis?.technical?.composition,
      analysis?.technical?.lighting
    ].filter(Boolean).join(' ').toLowerCase();
  }

  detectIntent(prompt) {
    const value = String(prompt || '').toLowerCase();
    if (value.includes('那年今日') || value.includes('today') || value.includes('同一天') || value.includes('回忆')) {
      return 'anniversary';
    }
    if (value.includes('剪辑') || value.includes('视频') || value.includes('短片') || value.includes('movie') || value.includes('video')) {
      return 'video';
    }
    if (value.includes('拼图') || value.includes('海报') || value.includes('collage')) {
      return 'collage';
    }
    return 'search';
  }

  tokenize(prompt) {
    return String(prompt || '')
      .toLowerCase()
      .replace(/[^\p{Script=Han}a-z0-9]+/gu, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 2 && !['照片', '图片', '适合', '自动', '生成'].includes(token));
  }

  scorePhoto(photo, analysis, tokens, intent, now = new Date()) {
    const text = this.buildSearchText(photo, analysis);
    const matchedTokens = tokens.filter(token => text.includes(token));
    let score = matchedTokens.length * 12;
    const reasons = [];

    if (matchedTokens.length > 0) {
      reasons.push(`匹配关键词: ${matchedTokens.slice(0, 4).join(', ')}`);
    }

    const photoDate = toDate(photo.date);
    if (intent === 'anniversary' && photoDate) {
      const delta = Math.abs(dayOfYear(photoDate) - dayOfYear(now));
      const wrappedDelta = Math.min(delta, 366 - delta);
      if (wrappedDelta === 0) {
        score += 45;
        reasons.push('月日完全匹配那年今日');
      } else if (wrappedDelta <= 7) {
        score += 24 - wrappedDelta * 2;
        reasons.push(`接近那年今日: ${wrappedDelta} 天内`);
      }
    }

    const quality = parseScore(analysis?.quality?.score);
    const aesthetic = parseScore(analysis?.aesthetic?.score);
    if (quality > 0 || aesthetic > 0) {
      score += (quality + aesthetic) * 4;
      reasons.push('使用 AI 质量/美学评分加权');
    }

    const ratio = photo.dimensions?.width && photo.dimensions?.height
      ? photo.dimensions.width / photo.dimensions.height
      : 1;
    if (ratio >= 1.15) {
      score += 4;
      reasons.push('横图适合封面/视频');
    } else if (ratio <= 0.82) {
      score += 2;
      reasons.push('竖图适合手机拼图');
    }

    if (!analysis && tokens.length > 0) {
      reasons.push('未分析照片仅使用基础元数据');
    }

    return {
      photo,
      analysis,
      score,
      reasons: reasons.length ? reasons : ['图库候选照片']
    };
  }

  async selectPhotos({ prompt = '', limit = 9, mode = 'collage' } = {}) {
    const photos = this.galleryService.getPhotos({}).photos;
    const intent = this.detectIntent(`${prompt || ''} ${mode || ''}`);
    const tokens = this.tokenize(prompt);
    const scored = photos
      .map(photo => this.scorePhoto(photo, this.getAnalysis(photo.id), tokens, intent))
      .filter(item => item.score > 0 || tokens.length === 0 || intent === 'anniversary')
      .sort((a, b) => b.score - a.score)
      .slice(0, clamp(Number(limit) || 9, 1, 24));

    const selected = scored.length > 0 ? scored : photos.slice(0, clamp(Number(limit) || 9, 1, 24)).map(photo => ({
      photo,
      analysis: this.getAnalysis(photo.id),
      score: 0,
      reasons: ['兜底展示最近图库照片']
    }));

    return {
      prompt,
      intent,
      totalCandidates: photos.length,
      selected: selected.map(item => ({
        photo: this.toPublicPhoto(item.photo),
        score: Math.round(item.score * 10) / 10,
        reasons: item.reasons,
        analysis: item.analysis ? {
          tags: item.analysis.tags || [],
          category: item.analysis.category,
          description: item.analysis.description,
          aesthetic: item.analysis.aesthetic,
          quality: item.analysis.quality
        } : null
      })),
      recommendedTemplates: this.recommendTemplates(selected.map(item => item.photo))
    };
  }

  recommendTemplates(photos) {
    const count = photos.length;
    const ratios = photos.map(photo => (
      photo.dimensions?.width && photo.dimensions?.height
        ? photo.dimensions.width / photo.dimensions.height
        : 1
    ));
    const landscapeCount = ratios.filter(ratio => ratio >= 1.15).length;
    const portraitCount = ratios.filter(ratio => ratio <= 0.82).length;

    return this.getTemplates()
      .map(template => {
        let score = 100;
        if (count < template.minPhotos || count > template.maxPhotos) {
          score -= Math.abs(count - clamp(count, template.minPhotos, template.maxPhotos)) * 35;
        }
        if (template.cells.length === count) score += 30;
        if (template.id.includes('cover') && landscapeCount > 0) score += 12;
        if (template.ratio === '4:5' && portraitCount >= landscapeCount) score += 8;
        if (template.ratio === '16:9' && landscapeCount >= portraitCount) score += 8;
        return {
          ...template,
          score,
          reason: this.describeTemplateReason(template, count, landscapeCount, portraitCount)
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }

  describeTemplateReason(template, count, landscapeCount, portraitCount) {
    if (template.cells.length === count) return '照片数量完全匹配模板';
    if (template.id.includes('cover') && landscapeCount > 0) return '包含横图，适合封面式拼图';
    if (template.ratio === '4:5' && portraitCount >= landscapeCount) return '竖图偏多，适合手机分享比例';
    return `适合 ${template.minPhotos}-${template.maxPhotos} 张照片`;
  }

  templateSize(template, width = 1600) {
    const [rw, rh] = template.ratio.split(':').map(Number);
    return {
      width,
      height: Math.round(width * (rh || 1) / (rw || 1))
    };
  }

  async renderCoverBuffer(imagePath, width, height, focus = { x: 0.5, y: 0.5 }) {
    const metadata = await sharp(imagePath).rotate().metadata();
    const sourceWidth = metadata.width || width;
    const sourceHeight = metadata.height || height;
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const resizedWidth = Math.max(width, Math.ceil(sourceWidth * scale));
    const resizedHeight = Math.max(height, Math.ceil(sourceHeight * scale));
    const maxLeft = Math.max(0, resizedWidth - width);
    const maxTop = Math.max(0, resizedHeight - height);
    const left = Math.round(maxLeft * clamp(focus.x, 0, 1));
    const top = Math.round(maxTop * clamp(focus.y, 0, 1));

    return sharp(imagePath)
      .rotate()
      .resize(resizedWidth, resizedHeight, { fit: 'fill' })
      .extract({
        left: clamp(left, 0, maxLeft),
        top: clamp(top, 0, maxTop),
        width,
        height
      })
      .jpeg({ quality: 88 })
      .toBuffer();
  }

  async createCollage({ prompt = '', photoIds = [], templateId, customCells = [], cellFocus = [], width = 1600, gap = 12 } = {}) {
    const selectedPhotos = photoIds.length > 0
      ? photoIds.map(id => this.galleryService.getPhoto(id)).filter(Boolean)
      : (await this.selectPhotos({ prompt, mode: 'collage', limit: 9 })).selected.map(item => item.photo);

    if (selectedPhotos.length === 0) {
      throw new Error('No photos available for collage');
    }

    const recommended = this.recommendTemplates(selectedPhotos);
    const baseTemplate = this.getTemplates().find(item => item.id === templateId) || recommended[0] || this.getTemplates()[0];
    const normalizedCustomCells = normalizeCells(customCells).slice(0, selectedPhotos.length);
    const template = normalizedCustomCells.length > 0
      ? { ...baseTemplate, cells: normalizedCustomCells, name: `${baseTemplate.name}（已调整）` }
      : baseTemplate;

    const { width: canvasWidth, height: canvasHeight } = this.templateSize(template, clamp(Number(width) || 1600, 600, 2600));
    const background = { r: 16, g: 16, b: 18, alpha: 1 };
    const cells = template.cells.slice(0, selectedPhotos.length);
    const normalizedFocus = normalizeFocus(cellFocus);

    const composites = [];
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const photo = selectedPhotos[index];
      const left = Math.round(cell.x * canvasWidth + gap);
      const top = Math.round(cell.y * canvasHeight + gap);
      const cellWidth = Math.max(1, Math.round(cell.w * canvasWidth - gap * 2));
      const cellHeight = Math.max(1, Math.round(cell.h * canvasHeight - gap * 2));
      const input = await this.renderCoverBuffer(
        photo.originalPath,
        cellWidth,
        cellHeight,
        normalizedFocus[index] || { x: 0.5, y: 0.5 }
      );

      composites.push({ input, left, top });
    }

    const hash = crypto.createHash('md5')
      .update(JSON.stringify({
        prompt,
        photoIds: selectedPhotos.map(photo => photo.id),
        templateId: template.id,
        customCells: normalizedCustomCells,
        cellFocus: normalizedFocus,
        width
      }))
      .update(String(Date.now()))
      .digest('hex')
      .slice(0, 12);
    const filename = `collage_${hash}.jpg`;
    const outputPath = path.join(this.outputDir, filename);

    await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 4,
        background
      }
    })
      .composite(composites)
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(outputPath);

    return {
      filename,
      url: `/photowall/api/creations/file/${filename}`,
      path: outputPath,
      template,
      photos: selectedPhotos.map(photo => ({ id: photo.id, title: photo.title })),
      size: { width: canvasWidth, height: canvasHeight }
    };
  }

  async createVideoDemo({ prompt = '', photoIds = [], duration = 24 } = {}) {
    const selectedPhotos = photoIds.length > 0
      ? photoIds.map(id => this.galleryService.getPhoto(id)).filter(Boolean)
      : (await this.selectPhotos({ prompt, mode: 'video', limit: 8 })).selected.map(item => item.photo);

    if (selectedPhotos.length === 0) {
      throw new Error('No photos available for video demo');
    }

    const clipDuration = Math.max(2.5, Math.round((Number(duration) || 24) / selectedPhotos.length * 10) / 10);
    const storyboard = selectedPhotos.map((photo, index) => ({
      index,
      photoId: photo.id,
      title: photo.title,
      source: photo.originalPath,
      effect: index % 2 === 0 ? 'ken-burns-in' : 'ken-burns-out',
      duration: clipDuration,
      caption: `${photo.date || ''} ${photo.category || ''}`.trim()
    }));

    const filename = `video_demo_${Date.now()}.json`;
    const outputPath = path.join(this.outputDir, filename);
    const manifest = {
      prompt,
      status: 'demo-only',
      message: 'This demo produces a storyboard and ffmpeg command plan; real rendering can be wired later.',
      totalDuration: Math.round(storyboard.length * clipDuration * 10) / 10,
      storyboard,
      ffmpegConcept: [
        'Use each image as a looped input',
        'Apply scale/crop/zoompan for Ken Burns movement',
        'Concatenate clips with xfade transitions',
        'Mix optional BGM from /bgm'
      ]
    };

    await fs.writeJson(outputPath, manifest, { spaces: 2 });

    return {
      ...manifest,
      filename,
      url: `/photowall/api/creations/file/${filename}`
    };
  }

  getCreationFile(filename) {
    const safeName = path.basename(filename);
    return path.join(this.outputDir, safeName);
  }
}
