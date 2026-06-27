import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, EyeOff, Loader2, RefreshCw, Shuffle, X } from 'lucide-react';
import { Photo } from '../types';

interface PixelStretchPanelProps {
  photos: Photo[];
  initialPhotoId?: string;
  onClose: () => void;
}

type StretchEdge = 'left' | 'right' | 'top' | 'bottom';

interface StretchRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  edge: StretchEdge;
  enabled: boolean;
}

interface CanvasPoint {
  x: number;
  y: number;
}

interface SelectionBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const edges: StretchEdge[] = ['left', 'right', 'top', 'bottom'];
const minAverageSize = 24;
const maxAverageSize = 240;
const maxRectCount = 1600;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalizeUrl = (url?: string) => {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('/')) return url;
  return `/photowall/${url.replace(/^\/+/, '')}`;
};

const makeSeed = () => Math.random().toString(36).slice(2, 10);

const hashSeed = (seed: string) => {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createRandom = (seed: string) => {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const getPhotoSource = (photo: Photo) =>
  normalizeUrl(photo.originalUrl || photo.url || photo.previewUrl || photo.thumbnail);

const safeFilename = (name: string) =>
  name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 80) || 'photo';

const pickEdge = (random: () => number) => edges[Math.floor(random() * edges.length)];

const getNormalizedBox = (start: CanvasPoint, current: CanvasPoint): SelectionBox => ({
  x: Math.min(start.x, current.x),
  y: Math.min(start.y, current.y),
  w: Math.abs(current.x - start.x),
  h: Math.abs(current.y - start.y),
});

const rectIntersectsBox = (rect: StretchRect, box: SelectionBox) =>
  rect.x < box.x + box.w &&
  rect.x + rect.w > box.x &&
  rect.y < box.y + box.h &&
  rect.y + rect.h > box.y;

const generateStretchRects = (width: number, height: number, averageSize: number, seed: string): StretchRect[] => {
  const random = createRandom(seed);
  const targetCount = clamp(Math.round((width * height) / (averageSize * averageSize)), 1, maxRectCount);
  const minChunk = Math.max(8, Math.round(averageSize * 0.3));
  let rects: Array<Omit<StretchRect, 'id' | 'edge' | 'enabled'>> = [{ x: 0, y: 0, w: width, h: height }];

  while (rects.length < targetCount) {
    const candidates = rects
      .map((rect, index) => ({ rect, index, area: rect.w * rect.h }))
      .filter(item => item.rect.w >= minChunk * 2 || item.rect.h >= minChunk * 2)
      .sort((a, b) => b.area - a.area);

    const candidate = candidates[0];
    if (!candidate) break;

    const { rect, index } = candidate;
    const preferVertical = rect.w > rect.h * 1.18;
    const preferHorizontal = rect.h > rect.w * 1.18;
    let splitAxis: 'x' | 'y' = preferVertical ? 'x' : preferHorizontal ? 'y' : (random() > 0.5 ? 'x' : 'y');

    if (splitAxis === 'x' && rect.w < minChunk * 2) splitAxis = 'y';
    if (splitAxis === 'y' && rect.h < minChunk * 2) splitAxis = 'x';

    const span = splitAxis === 'x' ? rect.w : rect.h;
    if (span < minChunk * 2) break;

    const ratio = 0.35 + random() * 0.3;
    const cut = clamp(Math.round(span * ratio), minChunk, span - minChunk);

    const nextRects = splitAxis === 'x'
      ? [
          { x: rect.x, y: rect.y, w: cut, h: rect.h },
          { x: rect.x + cut, y: rect.y, w: rect.w - cut, h: rect.h },
        ]
      : [
          { x: rect.x, y: rect.y, w: rect.w, h: cut },
          { x: rect.x, y: rect.y + cut, w: rect.w, h: rect.h - cut },
        ];

    rects = [
      ...rects.slice(0, index),
      ...nextRects,
      ...rects.slice(index + 1),
    ];
  }

  return rects.map((rect, index) => ({
    ...rect,
    id: `${rect.x}-${rect.y}-${rect.w}-${rect.h}-${index}`,
    edge: pickEdge(random),
    enabled: true,
  }));
};

const drawStretchRect = (ctx: CanvasRenderingContext2D, image: HTMLImageElement, rect: StretchRect) => {
  if (!rect.enabled) {
    ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
    return;
  }

  if (rect.edge === 'left') {
    ctx.drawImage(image, rect.x, rect.y, 1, rect.h, rect.x, rect.y, rect.w, rect.h);
    return;
  }

  if (rect.edge === 'right') {
    ctx.drawImage(image, rect.x + rect.w - 1, rect.y, 1, rect.h, rect.x, rect.y, rect.w, rect.h);
    return;
  }

  if (rect.edge === 'top') {
    ctx.drawImage(image, rect.x, rect.y, rect.w, 1, rect.x, rect.y, rect.w, rect.h);
    return;
  }

  ctx.drawImage(image, rect.x, rect.y + rect.h - 1, rect.w, 1, rect.x, rect.y, rect.w, rect.h);
};

const drawOutput = (
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  rects: StretchRect[],
  showGrid: boolean,
  selectedIds: Set<string> = new Set(),
  selectionBox: SelectionBox | null = null
) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  rects.forEach(rect => drawStretchRect(ctx, image, rect));

  if (showGrid) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.34)';
    ctx.lineWidth = Math.max(1, Math.round(Math.min(canvas.width, canvas.height) / 1200));
    rects.forEach(rect => ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1));
    ctx.restore();
  }

  if (selectedIds.size > 0) {
    ctx.save();
    ctx.fillStyle = 'rgba(217,170,76,0.16)';
    ctx.strokeStyle = 'rgba(217,170,76,0.95)';
    ctx.lineWidth = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) / 900));
    rects.forEach(rect => {
      if (!selectedIds.has(rect.id)) return;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeRect(rect.x + 1, rect.y + 1, Math.max(1, rect.w - 2), Math.max(1, rect.h - 2));
    });
    ctx.restore();
  }

  if (selectionBox && selectionBox.w > 2 && selectionBox.h > 2) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.lineWidth = Math.max(1, Math.round(Math.min(canvas.width, canvas.height) / 1200));
    ctx.setLineDash([8, 6]);
    ctx.fillRect(selectionBox.x, selectionBox.y, selectionBox.w, selectionBox.h);
    ctx.strokeRect(selectionBox.x, selectionBox.y, selectionBox.w, selectionBox.h);
    ctx.restore();
  }
};

const drawFinalOutput = (canvas: HTMLCanvasElement, image: HTMLImageElement, rects: StretchRect[]) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  rects.forEach(rect => drawStretchRect(ctx, image, rect));
};

const PixelStretchPanel: React.FC<PixelStretchPanelProps> = ({ photos, initialPhotoId, onClose }) => {
  const [selectedPhotoId, setSelectedPhotoId] = useState(initialPhotoId || photos[0]?.id || '');
  const [averageSize, setAverageSize] = useState(96);
  const [seed, setSeed] = useState(makeSeed);
  const [showGrid, setShowGrid] = useState(true);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [rects, setRects] = useState<StretchRect[]>([]);
  const [selectedRectIds, setSelectedRectIds] = useState<Set<string>>(new Set());
  const [dragSelection, setDragSelection] = useState<{ start: CanvasPoint; current: CanvasPoint } | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const selectedPhoto = useMemo(
    () => photos.find(photo => photo.id === selectedPhotoId) || photos[0] || null,
    [photos, selectedPhotoId]
  );

  const sourceUrl = selectedPhoto ? getPhotoSource(selectedPhoto) : '';
  const disabledCount = rects.filter(rect => !rect.enabled).length;
  const selectedCount = selectedRectIds.size;
  const activeSelectionBox = dragSelection ? getNormalizedBox(dragSelection.start, dragSelection.current) : null;

  useEffect(() => {
    if (!selectedPhoto && photos[0]) {
      setSelectedPhotoId(photos[0].id);
    }
  }, [photos, selectedPhoto]);

  useEffect(() => {
    if (initialPhotoId) setSelectedPhotoId(initialPhotoId);
  }, [initialPhotoId]);

  useEffect(() => {
    if (!sourceUrl) {
      imageRef.current = null;
      setImageSize({ width: 0, height: 0 });
      setRects([]);
      return;
    }

    let cancelled = false;
    const image = new Image();
    setLoading(true);
    setError('');
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
      setLoading(false);
    };
    image.onerror = () => {
      if (cancelled) return;
      imageRef.current = null;
      setImageSize({ width: 0, height: 0 });
      setRects([]);
      setError('图片加载失败，无法生成像素拉伸效果。');
      setLoading(false);
    };
    image.src = sourceUrl;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
      image.src = '';
    };
  }, [sourceUrl]);

  useEffect(() => {
    if (!imageSize.width || !imageSize.height) return;
    setRects(generateStretchRects(imageSize.width, imageSize.height, averageSize, seed));
    setSelectedRectIds(new Set());
    setDragSelection(null);
  }, [averageSize, imageSize.height, imageSize.width, seed]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (selectedRectIds.size === 0 && !dragSelection) return;
      event.preventDefault();
      setSelectedRectIds(new Set());
      setDragSelection(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dragSelection, selectedRectIds.size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !imageSize.width || !imageSize.height) return;

    if (canvas.width !== imageSize.width) canvas.width = imageSize.width;
    if (canvas.height !== imageSize.height) canvas.height = imageSize.height;
    drawOutput(canvas, image, rects, showGrid, selectedRectIds, activeSelectionBox);
  }, [activeSelectionBox, imageSize.height, imageSize.width, rects, selectedRectIds, showGrid]);

  const regenerate = () => {
    setSeed(makeSeed());
  };

  const getCanvasPoint = useCallback((clientX: number, clientY: number): CanvasPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (clientX - bounds.left) * (canvas.width / bounds.width),
      y: (clientY - bounds.top) * (canvas.height / bounds.height),
    };
  }, []);

  const findRectIdAt = useCallback((point: CanvasPoint) => {
    return rects.find(rect =>
      point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h
    )?.id || '';
  }, [rects]);

  const toggleRectAt = (clientX: number, clientY: number) => {
    const point = getCanvasPoint(clientX, clientY);
    if (!point) return;
    const hitId = findRectIdAt(point);
    if (!hitId) return;
    setRects(prev => prev.map(rect =>
      rect.id === hitId ? { ...rect, enabled: !rect.enabled } : rect
    ));
  };

  const handleCanvasMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const point = getCanvasPoint(event.clientX, event.clientY);
    if (!point) return;
    setDragSelection({ start: point, current: point });
    setError('');
  };

  const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragSelection) return;
    const point = getCanvasPoint(event.clientX, event.clientY);
    if (!point) return;
    setDragSelection(prev => prev ? { ...prev, current: point } : null);
  };

  const handleCanvasMouseUp = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragSelection) return;
    const point = getCanvasPoint(event.clientX, event.clientY);
    const nextBox = point ? getNormalizedBox(dragSelection.start, point) : activeSelectionBox;
    setDragSelection(null);
    if (!nextBox || nextBox.w < 4 || nextBox.h < 4) {
      if (!point) {
        setSelectedRectIds(new Set());
        return;
      }
      const hitId = findRectIdAt(point);
      if (!hitId || !selectedRectIds.has(hitId)) {
        setSelectedRectIds(new Set());
      }
      return;
    }

    const nextIds = rects.filter(rect => rectIntersectsBox(rect, nextBox)).map(rect => rect.id);
    setSelectedRectIds(prev => {
      const selected = event.shiftKey ? new Set(prev) : new Set<string>();
      nextIds.forEach(id => selected.add(id));
      return selected;
    });
  };

  const handleCanvasContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const point = getCanvasPoint(event.clientX, event.clientY);
    if (!point) return;
    const hitId = findRectIdAt(point);
    if (!hitId) return;
    setSelectedRectIds(prev => {
      const next = new Set(prev);
      if (next.has(hitId)) {
        next.delete(hitId);
      } else {
        next.add(hitId);
      }
      return next;
    });
  };

  const resetDisabledRects = () => {
    setRects(prev => prev.map(rect => ({ ...rect, enabled: true })));
  };

  const setSelectedRectsEnabled = (enabled: boolean) => {
    if (selectedRectIds.size === 0) return;
    setRects(prev => prev.map(rect =>
      selectedRectIds.has(rect.id) ? { ...rect, enabled } : rect
    ));
  };

  const splitSelectedRects = () => {
    if (selectedRectIds.size === 0) return;
    const random = createRandom(`${seed}-split-${Date.now()}`);
    const nextSelectedIds = new Set<string>();
    let changed = false;

    const nextRects = rects.flatMap(rect => {
      if (!selectedRectIds.has(rect.id)) return [rect];

      const canSplitX = rect.w >= 16;
      const canSplitY = rect.h >= 16;
      if (!canSplitX && !canSplitY) return [rect];

      const axis: 'x' | 'y' = canSplitX && (!canSplitY || rect.w >= rect.h) ? 'x' : 'y';
      const span = axis === 'x' ? rect.w : rect.h;
      const cut = clamp(Math.round(span * (0.45 + random() * 0.1)), 8, span - 8);
      const idBase = `${rect.id}-split-${Math.round(random() * 1000000)}`;
      changed = true;

      const children = axis === 'x'
        ? [
            { ...rect, id: `${idBase}-a`, w: cut, edge: pickEdge(random) },
            { ...rect, id: `${idBase}-b`, x: rect.x + cut, w: rect.w - cut, edge: pickEdge(random) },
          ]
        : [
            { ...rect, id: `${idBase}-a`, h: cut, edge: pickEdge(random) },
            { ...rect, id: `${idBase}-b`, y: rect.y + cut, h: rect.h - cut, edge: pickEdge(random) },
          ];

      children.forEach(child => nextSelectedIds.add(child.id));
      return children;
    });

    if (!changed) {
      setError('选中的矩形太小，无法继续分割。');
      return;
    }

    setRects(nextRects);
    setSelectedRectIds(nextSelectedIds);
    setError('');
  };

  const mergeSelectedRects = () => {
    if (selectedRectIds.size < 2) return;

    const selectedRects = rects.filter(rect => selectedRectIds.has(rect.id));
    const left = Math.min(...selectedRects.map(rect => rect.x));
    const top = Math.min(...selectedRects.map(rect => rect.y));
    const right = Math.max(...selectedRects.map(rect => rect.x + rect.w));
    const bottom = Math.max(...selectedRects.map(rect => rect.y + rect.h));
    const selectedArea = selectedRects.reduce((sum, rect) => sum + rect.w * rect.h, 0);
    const boundsArea = (right - left) * (bottom - top);

    if (selectedArea !== boundsArea) {
      setError('只能合并刚好组成完整矩形的选区。请重新框选一个没有空洞的矩形区域。');
      return;
    }

    const random = createRandom(`${seed}-merge-${Date.now()}`);
    const mergedRect: StretchRect = {
      id: `merge-${left}-${top}-${right - left}-${bottom - top}-${Math.round(random() * 1000000)}`,
      x: left,
      y: top,
      w: right - left,
      h: bottom - top,
      edge: pickEdge(random),
      enabled: selectedRects.every(rect => rect.enabled),
    };

    setRects(prev => [
      ...prev.filter(rect => !selectedRectIds.has(rect.id)),
      mergedRect,
    ]);
    setSelectedRectIds(new Set([mergedRect.id]));
    setError('');
  };

  const exportPng = async () => {
    const image = imageRef.current;
    if (!image || !imageSize.width || !imageSize.height || !selectedPhoto) return;

    setExporting(true);
    setError('');
    try {
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = imageSize.width;
      outputCanvas.height = imageSize.height;
      drawFinalOutput(outputCanvas, image, rects);

      const blob = await new Promise<Blob | null>(resolve => outputCanvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('导出 PNG 失败。');

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pixel-stretch-${safeFilename(selectedPhoto.title || selectedPhoto.id)}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message || '导出失败。');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-obsidian/95 text-white backdrop-blur-md flex flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-4 md:px-6">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.24em] text-gold">Pixel Stretch</p>
          <h2 className="truncate text-xl font-serif md:text-2xl">矩形像素拉伸</h2>
        </div>
        <button
          onClick={onClose}
          className="rounded-full bg-white/5 p-2 text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="关闭"
        >
          <X size={22} />
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-b border-white/10 bg-black/20 p-4 xl:border-b-0 xl:border-r xl:overflow-y-auto">
          <div className="space-y-5">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-200">照片</span>
              <select
                value={selectedPhoto?.id || ''}
                onChange={event => setSelectedPhotoId(event.target.value)}
                className="h-11 w-full rounded-md border border-white/10 bg-charcoal px-3 text-sm text-white outline-none focus:border-gold"
              >
                {photos.map(photo => (
                  <option key={photo.id} value={photo.id}>{photo.title}</option>
                ))}
              </select>
            </label>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="pixel-average-size" className="text-sm font-medium text-gray-200">平均矩形大小</label>
                <span className="text-sm text-gold">{averageSize}px</span>
              </div>
              <input
                id="pixel-average-size"
                type="range"
                min={minAverageSize}
                max={maxAverageSize}
                step={4}
                value={averageSize}
                onChange={event => setAverageSize(Number(event.target.value))}
                className="w-full accent-gold"
              />
              <p className="mt-2 text-xs leading-relaxed text-gray-500">
                数值越小，分割越密。单张图最多生成 {maxRectCount} 个矩形以避免浏览器卡顿。
              </p>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-200">随机种子</span>
              <div className="flex gap-2">
                <input
                  value={seed}
                  onChange={event => setSeed(event.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-white/10 bg-charcoal px-3 text-sm text-white outline-none focus:border-gold"
                />
                <button
                  onClick={regenerate}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-white/5 text-gray-300 transition-colors hover:bg-white/10 hover:text-gold"
                  title="重新随机"
                  aria-label="重新随机"
                >
                  <Shuffle size={18} />
                </button>
              </div>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setShowGrid(value => !value)}
                className={`inline-flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm transition-colors ${
                  showGrid
                    ? 'bg-gold/20 text-gold hover:bg-gold/25'
                    : 'bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white'
                }`}
                aria-pressed={showGrid}
                title="只控制编辑预览中的矩形辅助线，导出 PNG 不包含这些线"
              >
                {showGrid ? <EyeOff size={16} /> : <Eye size={16} />}
                {showGrid ? '辅助线开' : '辅助线关'}
              </button>
              <button
                onClick={resetDisabledRects}
                disabled={disabledCount === 0}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-white/5 px-3 text-sm text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw size={16} />
                恢复全部
              </button>
            </div>
            <p className="-mt-3 text-xs text-gray-500">
              辅助线只用于编辑定位，导出 PNG 时始终不会保留。
            </p>

            <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-gray-200">选区编辑</span>
                <span className="text-xs text-gold">{selectedCount} 个矩形</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSelectedRectsEnabled(true)}
                  disabled={selectedCount === 0}
                  className="inline-flex h-10 items-center justify-center rounded-md bg-white/5 px-3 text-sm text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  全部拉伸
                </button>
                <button
                  onClick={() => setSelectedRectsEnabled(false)}
                  disabled={selectedCount === 0}
                  className="inline-flex h-10 items-center justify-center rounded-md bg-white/5 px-3 text-sm text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  取消拉伸
                </button>
                <button
                  onClick={splitSelectedRects}
                  disabled={selectedCount === 0}
                  className="inline-flex h-10 items-center justify-center rounded-md bg-white/5 px-3 text-sm text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  再次分割
                </button>
                <button
                  onClick={mergeSelectedRects}
                  disabled={selectedCount < 2}
                  className="inline-flex h-10 items-center justify-center rounded-md bg-white/5 px-3 text-sm text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  合并选区
                </button>
              </div>
              <button
                onClick={() => setSelectedRectIds(new Set())}
                disabled={selectedCount === 0}
                className="mt-2 h-9 w-full rounded-md px-3 text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                清除选区
              </button>
            </div>

            <button
              onClick={exportPng}
              disabled={!rects.length || loading || exporting}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-gold px-4 font-medium text-obsidian transition-colors hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              导出 PNG
            </button>

            <div className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-gray-400">
              <p>双击预览中的任意矩形，可切换该区域的拉伸效果和原图显示。</p>
              {imageSize.width > 0 && (
                <p className="mt-2 text-gray-500">
                  当前尺寸 {imageSize.width} x {imageSize.height}，矩形 {rects.length} 个，已关闭 {disabledCount} 个。
                </p>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-auto p-4 md:p-6">
          {!selectedPhoto ? (
            <div className="flex h-full min-h-[420px] items-center justify-center text-gray-500">
              当前没有可用照片。
            </div>
          ) : loading ? (
            <div className="flex h-full min-h-[420px] items-center justify-center text-gray-400">
              <Loader2 size={28} className="mr-3 animate-spin text-gold" />
              正在加载图片...
            </div>
          ) : (
            <div className="mx-auto flex min-h-full max-w-6xl items-center justify-center">
              <canvas
                ref={canvasRef}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={() => setDragSelection(null)}
                onContextMenu={handleCanvasContextMenu}
                onDoubleClick={event => toggleRectAt(event.clientX, event.clientY)}
                className="block max-h-[calc(100svh-8rem)] w-auto max-w-full cursor-crosshair select-none bg-black shadow-2xl"
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default PixelStretchPanel;
