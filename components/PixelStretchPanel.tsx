import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, EyeOff, Loader2, Shuffle, UserRoundCheck, X } from 'lucide-react';
import { SelfieSegmentation } from '@mediapipe/selfie_segmentation';
import { Photo } from '../types';

interface PixelStretchPanelProps { photos: Photo[]; initialPhotoId?: string; onClose: () => void; }
type StretchEdge = 'left' | 'right' | 'top' | 'bottom';
type EffectMode = 'background' | 'abstract';
type Tool = 'select' | 'stretch' | 'mask-add' | 'mask-erase';
interface CanvasPoint { x: number; y: number; }
interface SelectionBox { x: number; y: number; w: number; h: number; }
interface StretchRect { id: string; x: number; y: number; w: number; h: number; edge: StretchEdge; enabled: boolean; groupId?: string; }
interface StretchStroke { id: string; start: CanvasPoint; end: CanvasPoint; twist: number; }
interface DraftStroke { start: CanvasPoint; end: CanvasPoint; twist: number; }
interface ContextMenuState { rectId: string; x: number; y: number; }

const edges: StretchEdge[] = ['left', 'right', 'top', 'bottom'];
const edgeLabels: Record<StretchEdge, string> = { left: '向左', right: '向右', top: '向上', bottom: '向下' };
const minAverageSizePercent = 2;
const maxAverageSizePercent = 30;
const maxRectCount = 1600;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const normalizeUrl = (url?: string) => !url ? '' : (url.startsWith('http') || url.startsWith('/') ? url : `/photowall/${url.replace(/^\/+/, '')}`);
const makeSeed = () => Math.random().toString(36).slice(2, 10);
const safeFilename = (name: string) => name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 80) || 'photo';
const getPhotoSource = (photo: Photo) => normalizeUrl(photo.originalUrl || photo.url || photo.previewUrl || photo.thumbnail);
const pickEdge = (random: () => number) => edges[Math.floor(random() * edges.length)];

const hashSeed = (seed: string) => {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) { hash ^= seed.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
};
const createRandom = (seed: string) => {
  let state = hashSeed(seed) || 1;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
const getNormalizedBox = (start: CanvasPoint, current: CanvasPoint): SelectionBox => ({ x: Math.min(start.x, current.x), y: Math.min(start.y, current.y), w: Math.abs(current.x - start.x), h: Math.abs(current.y - start.y) });
const rectIntersectsBox = (rect: StretchRect, box: SelectionBox) => rect.x < box.x + box.w && rect.x + rect.w > box.x && rect.y < box.y + box.h && rect.y + rect.h > box.y;

const generateStretchRects = (width: number, height: number, averageSize: number, seed: string): StretchRect[] => {
  const random = createRandom(seed);
  const targetCount = clamp(Math.round((width * height) / (averageSize * averageSize)), 1, maxRectCount);
  const minChunk = Math.max(8, Math.round(averageSize * 0.3));
  let rects: Array<Omit<StretchRect, 'id' | 'edge' | 'enabled'>> = [{ x: 0, y: 0, w: width, h: height }];
  while (rects.length < targetCount) {
    const candidate = rects.map((rect, index) => ({ rect, index, area: rect.w * rect.h })).filter(item => item.rect.w >= minChunk * 2 || item.rect.h >= minChunk * 2).sort((a, b) => b.area - a.area)[0];
    if (!candidate) break;
    const { rect, index } = candidate;
    let axis: 'x' | 'y' = rect.w > rect.h * 1.18 ? 'x' : rect.h > rect.w * 1.18 ? 'y' : (random() > .5 ? 'x' : 'y');
    if (axis === 'x' && rect.w < minChunk * 2) axis = 'y';
    if (axis === 'y' && rect.h < minChunk * 2) axis = 'x';
    const span = axis === 'x' ? rect.w : rect.h;
    if (span < minChunk * 2) break;
    const cut = clamp(Math.round(span * (.35 + random() * .3)), minChunk, span - minChunk);
    const next = axis === 'x' ? [{ x: rect.x, y: rect.y, w: cut, h: rect.h }, { x: rect.x + cut, y: rect.y, w: rect.w - cut, h: rect.h }] : [{ x: rect.x, y: rect.y, w: rect.w, h: cut }, { x: rect.x, y: rect.y + cut, w: rect.w, h: rect.h - cut }];
    rects = [...rects.slice(0, index), ...next, ...rects.slice(index + 1)];
  }
  return rects.map((rect, index) => ({ ...rect, id: `${rect.x}-${rect.y}-${rect.w}-${rect.h}-${index}`, edge: pickEdge(random), enabled: true }));
};

const drawStretchRect = (ctx: CanvasRenderingContext2D, image: HTMLImageElement, rect: StretchRect) => {
  if (!rect.enabled) return void ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
  if (rect.edge === 'left') return void ctx.drawImage(image, rect.x, rect.y, 1, rect.h, rect.x, rect.y, rect.w, rect.h);
  if (rect.edge === 'right') return void ctx.drawImage(image, rect.x + rect.w - 1, rect.y, 1, rect.h, rect.x, rect.y, rect.w, rect.h);
  if (rect.edge === 'top') return void ctx.drawImage(image, rect.x, rect.y, rect.w, 1, rect.x, rect.y, rect.w, rect.h);
  ctx.drawImage(image, rect.x, rect.y + rect.h - 1, rect.w, 1, rect.x, rect.y, rect.w, rect.h);
};

const createCanvas = (width: number, height: number) => Object.assign(document.createElement('canvas'), { width, height });

const drawEdgeStretch = (ctx: CanvasRenderingContext2D, image: HTMLImageElement, edge: StretchEdge, band: number, extent: number, strength: number, fade: number) => {
  const { naturalWidth: width, naturalHeight: height } = image;
  const distance = Math.max(1, Math.round((edge === 'left' || edge === 'right' ? width : height) * extent / 100));
  const source = Math.max(1, Math.round(band));
  const horizontal = edge === 'left' || edge === 'right';
  const x = edge === 'right' ? width - distance : 0;
  const y = edge === 'bottom' ? height - distance : 0;
  const layer = createCanvas(width, height);
  const layerCtx = layer.getContext('2d');
  if (!layerCtx) return;
  if (edge === 'left') layerCtx.drawImage(image, 0, 0, source, height, 0, 0, distance, height);
  if (edge === 'right') layerCtx.drawImage(image, width - source, 0, source, height, width - distance, 0, distance, height);
  if (edge === 'top') layerCtx.drawImage(image, 0, 0, width, source, 0, 0, width, distance);
  if (edge === 'bottom') layerCtx.drawImage(image, 0, height - source, width, source, 0, height - distance, width, distance);
  const gradient = horizontal ? layerCtx.createLinearGradient(edge === 'left' ? 0 : width, 0, edge === 'left' ? distance : width - distance, 0) : layerCtx.createLinearGradient(0, edge === 'top' ? 0 : height, 0, edge === 'top' ? distance : height - distance);
  const fadeStop = clamp(fade / 100, .02, 1);
  gradient.addColorStop(0, `rgba(0,0,0,${strength / 100})`);
  gradient.addColorStop(fadeStop, 'rgba(0,0,0,0)');
  layerCtx.globalCompositeOperation = 'destination-in';
  layerCtx.fillStyle = gradient;
  layerCtx.fillRect(x, y, horizontal ? distance : width, horizontal ? height : distance);
  ctx.drawImage(layer, 0, 0);
};

const drawStroke = (ctx: CanvasRenderingContext2D, image: HTMLImageElement, stroke: DraftStroke | StretchStroke, width: number, strength: number, preview = false) => {
  const dx = stroke.end.x - stroke.start.x;
  const dy = stroke.end.y - stroke.start.y;
  const length = Math.hypot(dx, dy);
  if (length < 2) return;
  const angle = Math.atan2(dy, dx) + stroke.twist;
  const center = { x: (stroke.start.x + stroke.end.x) / 2, y: (stroke.start.y + stroke.end.y) / 2 };
  const halfLength = length / 2;
  const start = { x: center.x - Math.cos(angle) * halfLength, y: center.y - Math.sin(angle) * halfLength };
  const end = { x: center.x + Math.cos(angle) * halfLength, y: center.y + Math.sin(angle) * halfLength };
  const layer = createCanvas(image.naturalWidth, image.naturalHeight);
  const layerCtx = layer.getContext('2d');
  if (!layerCtx) return;
  layerCtx.save();
  layerCtx.translate(start.x, start.y);
  layerCtx.rotate(angle);
  layerCtx.drawImage(image, start.x - .5, start.y - width / 2, 1, width, 0, -width / 2, length, width);
  const gradient = layerCtx.createLinearGradient(0, 0, length, 0);
  gradient.addColorStop(0, `rgba(0,0,0,${strength / 100})`);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  layerCtx.globalCompositeOperation = 'destination-in';
  layerCtx.fillStyle = gradient;
  layerCtx.fillRect(0, -width / 2, length, width);
  layerCtx.restore();
  ctx.drawImage(layer, 0, 0);
  if (preview) {
    ctx.save(); ctx.strokeStyle = '#d9aa4c'; ctx.lineWidth = Math.max(2, width / 28); ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke(); ctx.restore();
  }
};

const drawMaskedForeground = (ctx: CanvasRenderingContext2D, image: HTMLImageElement, mask: HTMLCanvasElement) => {
  const foreground = createCanvas(image.naturalWidth, image.naturalHeight);
  const foregroundCtx = foreground.getContext('2d');
  if (!foregroundCtx) return;
  foregroundCtx.drawImage(image, 0, 0);
  foregroundCtx.globalCompositeOperation = 'destination-in';
  foregroundCtx.drawImage(mask, 0, 0);
  ctx.drawImage(foreground, 0, 0);
};

const PixelStretchPanel: React.FC<PixelStretchPanelProps> = ({ photos, initialPhotoId, onClose }) => {
  const [selectedPhotoId, setSelectedPhotoId] = useState(initialPhotoId || photos[0]?.id || '');
  const [mode, setMode] = useState<EffectMode>('background');
  const [tool, setTool] = useState<Tool>('stretch');
  const [direction, setDirection] = useState<StretchEdge>('left');
  const [strength, setStrength] = useState(82);
  const [fade, setFade] = useState(72);
  const [sourceBand, setSourceBand] = useState(16);
  const [extent, setExtent] = useState(34);
  const [protectSubject, setProtectSubject] = useState(true);
  const [showMask, setShowMask] = useState(false);
  const [maskRevision, setMaskRevision] = useState(0);
  const [brushSize, setBrushSize] = useState(96);
  const [strokes, setStrokes] = useState<StretchStroke[]>([]);
  const [draftStroke, setDraftStroke] = useState<DraftStroke | null>(null);
  const [averageSizePercent, setAverageSizePercent] = useState(10);
  const [seed, setSeed] = useState(makeSeed);
  const [showGrid, setShowGrid] = useState(true);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [rects, setRects] = useState<StretchRect[]>([]);
  const [selectedRectIds, setSelectedRectIds] = useState<Set<string>>(new Set());
  const [dragSelection, setDragSelection] = useState<{ start: CanvasPoint; current: CanvasPoint } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [loading, setLoading] = useState(false);
  const [segmenting, setSegmenting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const maskDrawingRef = useRef(false);
  const maskLastPointRef = useRef<CanvasPoint | null>(null);

  const selectedPhoto = useMemo(() => photos.find(photo => photo.id === selectedPhotoId) || photos[0] || null, [photos, selectedPhotoId]);
  const sourceUrl = selectedPhoto ? getPhotoSource(selectedPhoto) : '';
  const activeSelectionBox = dragSelection ? getNormalizedBox(dragSelection.start, dragSelection.current) : null;
  const selectedCount = selectedRectIds.size;
  const contextRect = contextMenu ? rects.find(rect => rect.id === contextMenu.rectId) || null : null;
  const averageSize = imageSize.width && imageSize.height
    ? clamp(Math.round(Math.min(imageSize.width, imageSize.height) * averageSizePercent / 100), 8, Math.max(imageSize.width, imageSize.height))
    : 0;

  const render = useCallback((canvas: HTMLCanvasElement, includeGuides: boolean) => {
    const image = imageRef.current;
    const ctx = canvas.getContext('2d');
    if (!image || !ctx) return;
    if (canvas.width !== image.naturalWidth) canvas.width = image.naturalWidth;
    if (canvas.height !== image.naturalHeight) canvas.height = image.naturalHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (mode === 'abstract') {
      rects.forEach(rect => drawStretchRect(ctx, image, rect));
      if (includeGuides && showGrid) { ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.34)'; rects.forEach(rect => ctx.strokeRect(rect.x + .5, rect.y + .5, rect.w - 1, rect.h - 1)); ctx.restore(); }
      if (includeGuides && selectedRectIds.size) { ctx.save(); ctx.fillStyle = 'rgba(217,170,76,.16)'; ctx.strokeStyle = '#d9aa4c'; rects.forEach(rect => { if (selectedRectIds.has(rect.id)) { ctx.fillRect(rect.x, rect.y, rect.w, rect.h); ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2); } }); ctx.restore(); }
      if (includeGuides && activeSelectionBox) { ctx.save(); ctx.strokeStyle = 'white'; ctx.setLineDash([8, 6]); ctx.strokeRect(activeSelectionBox.x, activeSelectionBox.y, activeSelectionBox.w, activeSelectionBox.h); ctx.restore(); }
      return;
    }
    ctx.drawImage(image, 0, 0);
    drawEdgeStretch(ctx, image, direction, sourceBand, extent, strength, fade);
    strokes.forEach(stroke => drawStroke(ctx, image, stroke, brushSize, strength));
    if (draftStroke && includeGuides) drawStroke(ctx, image, draftStroke, brushSize, strength, true);
    if (protectSubject && maskRef.current) drawMaskedForeground(ctx, image, maskRef.current);
    if (includeGuides && showMask && maskRef.current) { ctx.save(); ctx.globalAlpha = .42; ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(maskRef.current, 0, 0); ctx.restore(); }
  }, [activeSelectionBox, brushSize, direction, draftStroke, extent, fade, mode, protectSubject, rects, selectedRectIds, showGrid, showMask, sourceBand, strength, strokes]);

  useEffect(() => { if (!selectedPhoto && photos[0]) setSelectedPhotoId(photos[0].id); }, [photos, selectedPhoto]);
  useEffect(() => { if (initialPhotoId) setSelectedPhotoId(initialPhotoId); }, [initialPhotoId]);
  useEffect(() => {
    if (!sourceUrl) return;
    let cancelled = false;
    const image = new Image(); setLoading(true); setError('');
    image.onload = () => { if (cancelled) return; imageRef.current = image; setImageSize({ width: image.naturalWidth, height: image.naturalHeight }); maskRef.current = createCanvas(image.naturalWidth, image.naturalHeight); setStrokes([]); setLoading(false); };
    image.onerror = () => { if (!cancelled) { setError('图片加载失败，无法生成像素拉伸效果。'); setLoading(false); } };
    image.src = sourceUrl;
    return () => { cancelled = true; image.src = ''; };
  }, [sourceUrl]);
  useEffect(() => { if (imageSize.width) setRects(generateStretchRects(imageSize.width, imageSize.height, averageSize, seed)); }, [averageSize, imageSize.height, imageSize.width, seed]);
  useEffect(() => { const canvas = canvasRef.current; if (canvas && imageSize.width) render(canvas, true); }, [imageSize, maskRevision, render]);

  const getCanvasPoint = useCallback((clientX: number, clientY: number): CanvasPoint | null => {
    const canvas = canvasRef.current; if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect(); return { x: (clientX - bounds.left) * canvas.width / bounds.width, y: (clientY - bounds.top) * canvas.height / bounds.height };
  }, []);
  const findRectIdAt = useCallback((point: CanvasPoint) => rects.find(rect => point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h)?.id || '', [rects]);
  const paintMask = useCallback((point: CanvasPoint, add: boolean) => {
    const mask = maskRef.current; if (!mask) return;
    const ctx = mask.getContext('2d'); if (!ctx) return;
    const previous = maskLastPointRef.current;
    ctx.save(); ctx.globalCompositeOperation = add ? 'source-over' : 'destination-out'; ctx.fillStyle = add ? '#00ff80' : '#000'; ctx.strokeStyle = ctx.fillStyle; ctx.lineCap = 'round'; ctx.lineWidth = brushSize;
    if (previous) { ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(point.x, point.y); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    maskLastPointRef.current = point;
    setMaskRevision(value => value + 1);
  }, [brushSize]);
  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const point = getCanvasPoint(event.clientX, event.clientY); if (!point) return;
    setError(''); setContextMenu(null);
    if (mode === 'background') {
      if (tool === 'stretch') { setDraftStroke({ start: point, end: point, twist: 0 }); return; }
      maskDrawingRef.current = true; maskLastPointRef.current = null; paintMask(point, tool === 'mask-add'); return;
    }
    setDragSelection({ start: point, current: point });
  };
  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(event.clientX, event.clientY); if (!point) return;
    if (mode === 'background') {
      if (draftStroke) { setDraftStroke(value => value ? { ...value, end: point } : null); return; }
      if (maskDrawingRef.current) paintMask(point, tool === 'mask-add'); return;
    }
    if (dragSelection) setDragSelection(value => value ? { ...value, current: point } : null);
  };
  const handleMouseUp = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(event.clientX, event.clientY);
    if (mode === 'background') {
      if (draftStroke && point) { const next = { ...draftStroke, end: point, id: `stroke-${Date.now()}` }; if (Math.hypot(next.end.x - next.start.x, next.end.y - next.start.y) > 4) setStrokes(value => [...value, next]); setDraftStroke(null); }
      maskDrawingRef.current = false; maskLastPointRef.current = null; return;
    }
    if (!dragSelection) return;
    const box = point ? getNormalizedBox(dragSelection.start, point) : null; setDragSelection(null);
    if (!box || box.w < 4 || box.h < 4) { if (point) { const id = findRectIdAt(point); setSelectedRectIds(id ? new Set([id]) : new Set()); } return; }
    setSelectedRectIds(event.shiftKey ? previous => new Set([...previous, ...rects.filter(rect => rectIntersectsBox(rect, box)).map(rect => rect.id)]) : new Set(rects.filter(rect => rectIntersectsBox(rect, box)).map(rect => rect.id)));
  };
  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (mode !== 'background' || !draftStroke) return;
    event.preventDefault(); setDraftStroke(value => value ? { ...value, twist: value.twist + (event.deltaY > 0 ? .08 : -.08) } : null);
  };
  const handleContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== 'abstract') return;
    event.preventDefault();
    const point = getCanvasPoint(event.clientX, event.clientY); if (!point) return;
    const id = findRectIdAt(point); if (!id) return void setContextMenu(null);
    setSelectedRectIds(value => value.has(id) ? value : new Set([...value, id]));
    setContextMenu({ rectId: id, x: clamp(event.clientX, 12, window.innerWidth - 196), y: clamp(event.clientY, 12, window.innerHeight - 220) });
  };
  const setContextRectEdge = (edge: StretchEdge) => {
    if (!contextRect) return;
    setRects(value => value.map(rect => rect.id === contextRect.id || (contextRect.groupId && rect.groupId === contextRect.groupId) ? { ...rect, edge } : rect));
    setContextMenu(null);
  };
  const runSegmentation = async () => {
    const image = imageRef.current; const mask = maskRef.current;
    if (!image || !mask) return;
    setSegmenting(true); setError('');
    let segmenter: SelfieSegmentation | null = null;
    try {
      segmenter = new SelfieSegmentation({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}` });
      segmenter.setOptions({ modelSelection: image.naturalWidth > image.naturalHeight ? 1 : 0 });
      await new Promise<void>((resolve, reject) => {
        segmenter.onResults((result: { segmentationMask: CanvasImageSource }) => {
          const ctx = mask.getContext('2d'); if (!ctx) return reject(new Error('无法创建主体遮罩。'));
          ctx.clearRect(0, 0, mask.width, mask.height); ctx.drawImage(result.segmentationMask, 0, 0, mask.width, mask.height);
          ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#00ff80'; ctx.fillRect(0, 0, mask.width, mask.height); ctx.globalCompositeOperation = 'source-over'; resolve();
        });
        segmenter.send({ image }).catch(reject);
      });
      setProtectSubject(true); setShowMask(true);
    } catch (err) { setError((err as Error).message || '人像分割失败，请检查网络后重试。'); } finally { segmenter?.close(); setMaskRevision(value => value + 1); setSegmenting(false); }
  };
  const mergeSelectedRects = () => {
    if (selectedCount < 2) return;
    const selected = rects.filter(rect => selectedRectIds.has(rect.id));
    const left = Math.min(...selected.map(rect => rect.x)); const top = Math.min(...selected.map(rect => rect.y)); const right = Math.max(...selected.map(rect => rect.x + rect.w)); const bottom = Math.max(...selected.map(rect => rect.y + rect.h));
    const exactRectangle = selected.reduce((sum, rect) => sum + rect.w * rect.h, 0) === (right - left) * (bottom - top);
    if (!exactRectangle) { const groupId = `group-${Date.now()}`; setRects(value => value.map(rect => selectedRectIds.has(rect.id) ? { ...rect, groupId } : rect)); setError('已组合并：保留不规则边界，不会把未选区域误合并。'); return; }
    const random = createRandom(`${seed}-merge-${Date.now()}`); const merged: StretchRect = { id: `merge-${Date.now()}`, x: left, y: top, w: right - left, h: bottom - top, edge: pickEdge(random), enabled: selected.every(rect => rect.enabled) };
    setRects(value => [...value.filter(rect => !selectedRectIds.has(rect.id)), merged]); setSelectedRectIds(new Set([merged.id]));
  };
  const splitSelectedRects = () => {
    if (!selectedCount) return;
    const random = createRandom(`${seed}-split-${Date.now()}`); const nextIds = new Set<string>(); let changed = false;
    const next = rects.flatMap(rect => { if (!selectedRectIds.has(rect.id)) return [rect]; const axis = rect.w >= rect.h ? 'x' : 'y'; const span = axis === 'x' ? rect.w : rect.h; if (span < 16) return [rect]; const cut = clamp(Math.round(span / 2), 8, span - 8); const id = `${rect.id}-${Date.now()}-${random()}`; changed = true; const children = axis === 'x' ? [{ ...rect, id: `${id}-a`, w: cut, groupId: undefined }, { ...rect, id: `${id}-b`, x: rect.x + cut, w: rect.w - cut, groupId: undefined }] : [{ ...rect, id: `${id}-a`, h: cut, groupId: undefined }, { ...rect, id: `${id}-b`, y: rect.y + cut, h: rect.h - cut, groupId: undefined }]; children.forEach(child => nextIds.add(child.id)); return children; });
    if (changed) { setRects(next); setSelectedRectIds(nextIds); }
  };
  const exportPng = async () => {
    const image = imageRef.current; if (!image || !selectedPhoto) return;
    setExporting(true); try { const output = createCanvas(image.naturalWidth, image.naturalHeight); render(output, false); const blob = await new Promise<Blob | null>(resolve => output.toBlob(resolve, 'image/png')); if (!blob) throw new Error('导出 PNG 失败。'); const url = URL.createObjectURL(blob); const link = Object.assign(document.createElement('a'), { href: url, download: `pixel-stretch-${safeFilename(selectedPhoto.title || selectedPhoto.id)}.png` }); link.click(); URL.revokeObjectURL(url); } catch (err) { setError((err as Error).message); } finally { setExporting(false); }
  };

  const control = (label: string, value: number, onChange: (value: number) => void, min: number, max: number, suffix = '%') => <label className="block"><span className="mb-1 flex justify-between text-xs text-gray-300"><span>{label}</span><span className="text-gold">{value}{suffix}</span></span><input type="range" min={min} max={max} value={value} onChange={event => onChange(Number(event.target.value))} className="w-full accent-gold" /></label>;

  return <div className="fixed inset-0 z-[70] flex flex-col bg-obsidian/95 text-white backdrop-blur-md">
    <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-4 md:px-6"><div><p className="text-xs uppercase tracking-[.24em] text-gold">Pixel Stretch</p><h2 className="text-xl font-serif md:text-2xl">像素拉伸</h2></div><button onClick={onClose} className="rounded-full bg-white/5 p-2 text-gray-300 hover:bg-white/10" aria-label="关闭"><X size={22} /></button></div>
    <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)]"><aside className="border-b border-white/10 bg-black/20 p-4 xl:overflow-y-auto xl:border-b-0 xl:border-r"><div className="space-y-4">
      <label className="block"><span className="mb-2 block text-sm text-gray-200">照片</span><select value={selectedPhoto?.id || ''} onChange={event => setSelectedPhotoId(event.target.value)} className="h-10 w-full rounded border border-white/10 bg-charcoal px-3 text-sm">{photos.map(photo => <option key={photo.id} value={photo.id}>{photo.title}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-2"><button onClick={() => setMode('background')} className={`h-10 rounded text-sm ${mode === 'background' ? 'bg-gold text-obsidian' : 'bg-white/5 text-gray-300'}`}>背景拉伸</button><button onClick={() => setMode('abstract')} className={`h-10 rounded text-sm ${mode === 'abstract' ? 'bg-gold text-obsidian' : 'bg-white/5 text-gray-300'}`}>抽象分块</button></div>
      {mode === 'background' ? <>
        <div className="rounded border border-white/10 bg-white/[.03] p-3"><p className="mb-2 text-sm text-gray-200">全局背景拉伸</p><div className="grid grid-cols-4 gap-1">{edges.map(edge => <button key={edge} onClick={() => setDirection(edge)} className={`h-9 rounded text-xs ${direction === edge ? 'bg-gold text-obsidian' : 'bg-white/5 text-gray-300'}`}>{edgeLabels[edge]}</button>)}</div><div className="mt-3 space-y-2">{control('拉伸强度', strength, setStrength, 0, 100)}{control('渐隐距离', fade, setFade, 1, 100)}{control('拉伸范围', extent, setExtent, 0, 100)}{control('边缘取样带', sourceBand, setSourceBand, 1, 80, 'px')}</div></div>
        <div className="rounded border border-white/10 bg-white/[.03] p-3"><p className="mb-2 text-sm text-gray-200">直线拉伸画笔</p><div className="grid grid-cols-3 gap-1"><button onClick={() => setTool('stretch')} className={`h-9 rounded text-xs ${tool === 'stretch' ? 'bg-gold text-obsidian' : 'bg-white/5'}`}>拉伸</button><button onClick={() => setTool('mask-add')} className={`h-9 rounded text-xs ${tool === 'mask-add' ? 'bg-gold text-obsidian' : 'bg-white/5'}`}>保护画笔</button><button onClick={() => setTool('mask-erase')} className={`h-9 rounded text-xs ${tool === 'mask-erase' ? 'bg-gold text-obsidian' : 'bg-white/5'}`}>擦除保护</button></div><div className="mt-3">{control('画笔宽度', brushSize, setBrushSize, 12, 360, 'px')}</div><p className="mt-2 text-xs leading-relaxed text-gray-500">拉伸工具：从像素起点拖出直线；拖动中滚轮可扭转方向。保护画笔可修正人像遮罩。</p><button onClick={() => setStrokes([])} disabled={!strokes.length} className="mt-2 h-8 w-full rounded bg-white/5 text-xs text-gray-300 disabled:opacity-40">清除直线拉伸</button></div>
        <div className="rounded border border-white/10 bg-white/[.03] p-3"><div className="flex items-center justify-between"><span className="text-sm text-gray-200">保护主体</span><button onClick={() => setProtectSubject(value => !value)} className={`rounded px-2 py-1 text-xs ${protectSubject ? 'bg-gold text-obsidian' : 'bg-white/5 text-gray-300'}`}>{protectSubject ? '已开启' : '已关闭'}</button></div><button onClick={runSegmentation} disabled={segmenting || loading} className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded bg-white/5 text-sm hover:bg-white/10 disabled:opacity-40">{segmenting ? <Loader2 size={15} className="animate-spin" /> : <UserRoundCheck size={15} />} {segmenting ? '正在识别人像…' : '自动识别人像'}</button><button onClick={() => setShowMask(value => !value)} className="mt-2 h-8 w-full rounded bg-white/5 text-xs text-gray-300">{showMask ? '关闭遮罩预览' : '显示遮罩预览'}</button></div>
      </> : <>
        {control('平均矩形大小', averageSizePercent, setAverageSizePercent, minAverageSizePercent, maxAverageSizePercent)}<p className="-mt-3 text-xs text-gray-500">按图片短边计算，当前约 {averageSize}px。</p><label className="block"><span className="mb-1 block text-xs text-gray-300">随机种子</span><div className="flex gap-2"><input value={seed} onChange={event => setSeed(event.target.value)} className="min-w-0 flex-1 rounded border border-white/10 bg-charcoal px-2 text-sm"/><button onClick={() => setSeed(makeSeed())} className="rounded bg-white/5 p-2"><Shuffle size={15}/></button></div></label><button onClick={() => setShowGrid(value => !value)} className="flex h-9 w-full items-center justify-center gap-2 rounded bg-white/5 text-sm">{showGrid ? <EyeOff size={15}/> : <Eye size={15}/>} {showGrid ? '关闭辅助线' : '显示辅助线'}</button>
        <div className="rounded border border-white/10 bg-white/[.03] p-3"><div className="mb-2 flex justify-between text-sm"><span>选区编辑</span><span className="text-gold">{selectedCount} 块</span></div><div className="grid grid-cols-2 gap-2"><button onClick={() => setRects(value => value.map(rect => selectedRectIds.has(rect.id) ? { ...rect, enabled: true } : rect))} disabled={!selectedCount} className="h-9 rounded bg-white/5 text-xs disabled:opacity-40">全部拉伸</button><button onClick={() => setRects(value => value.map(rect => selectedRectIds.has(rect.id) ? { ...rect, enabled: false } : rect))} disabled={!selectedCount} className="h-9 rounded bg-white/5 text-xs disabled:opacity-40">取消拉伸</button><button onClick={splitSelectedRects} disabled={!selectedCount} className="h-9 rounded bg-white/5 text-xs disabled:opacity-40">再次分割</button><button onClick={mergeSelectedRects} disabled={selectedCount < 2} className="h-9 rounded bg-white/5 text-xs disabled:opacity-40">合并/组合并</button></div><p className="mt-2 text-xs text-gray-500">不规则选区将组合并，保留其真实边界。</p></div>
      </>}
      <button onClick={exportPng} disabled={loading || exporting || !imageSize.width} className="flex h-11 w-full items-center justify-center gap-2 rounded bg-gold text-sm font-medium text-obsidian disabled:opacity-40">{exporting ? <Loader2 size={17} className="animate-spin" /> : <Download size={17}/>} 导出 PNG</button>
      {error && <div className="rounded border border-red-500/30 bg-red-500/10 p-2 text-xs leading-relaxed text-red-200">{error}</div>}
    </div></aside><main className="min-h-0 overflow-auto p-4 md:p-6">{loading ? <div className="flex h-full min-h-[420px] items-center justify-center text-gray-400"><Loader2 className="mr-2 animate-spin"/>正在加载图片…</div> : <div className="mx-auto flex min-h-full max-w-6xl items-center justify-center"><canvas ref={canvasRef} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={() => { setDraftStroke(null); maskDrawingRef.current = false; maskLastPointRef.current = null; setDragSelection(null); }} onWheel={handleWheel} onContextMenu={handleContextMenu} className="block max-h-[calc(100svh-8rem)] max-w-full cursor-crosshair select-none bg-black shadow-2xl"/></div>}</main></div>
    {contextMenu && contextRect && <div className="fixed z-[90] w-48 overflow-hidden rounded border border-white/10 bg-charcoal/95 shadow-2xl" style={{ left: contextMenu.x, top: contextMenu.y }} onContextMenu={event => event.preventDefault()}><p className="border-b border-white/10 px-3 py-2 text-xs text-gray-400">拉伸来源方向{contextRect.groupId ? '（组合并）' : ''}</p><div className="grid grid-cols-2 gap-1 p-2">{edges.map(edge => <button key={edge} onClick={() => setContextRectEdge(edge)} className={`h-8 rounded text-xs ${contextRect.edge === edge ? 'bg-gold text-obsidian' : 'bg-white/5 text-gray-200'}`}>{edgeLabels[edge]}</button>)}</div></div>}
  </div>;
};

export default PixelStretchPanel;
