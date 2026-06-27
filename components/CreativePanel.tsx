import React, { useEffect, useMemo, useState } from 'react';
import { Film, ImagePlus, Loader2, Sparkles, Wand2, X } from 'lucide-react';
import { Photo } from '../types';
import { adminFetch } from '../services/adminAuth';

interface CreativePanelProps {
  onClose: () => void;
}

interface PromptSuggestion {
  id: string;
  label: string;
  prompt: string;
  description: string;
}

interface CollageCell {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CollageTemplate {
  id: string;
  name: string;
  ratio: string;
  minPhotos: number;
  maxPhotos: number;
  cells: CollageCell[];
  score?: number;
  reason?: string;
}

interface SelectedPhoto {
  photo: Photo;
  score: number;
  reasons: string[];
  analysis: {
    tags: string[];
    description?: string;
    category?: string;
  } | null;
}

interface SelectionResult {
  prompt: string;
  intent: string;
  totalCandidates: number;
  selected: SelectedPhoto[];
  recommendedTemplates: CollageTemplate[];
}

interface CollageResult {
  url: string;
  template: CollageTemplate;
  size: { width: number; height: number };
}

interface VideoDemoResult {
  url: string;
  totalDuration: number;
  storyboard: Array<{
    photoId: string;
    title: string;
    effect: string;
    duration: number;
    caption: string;
  }>;
}

type DragHandle =
  | { axis: 'x'; value: number }
  | { axis: 'y'; value: number };

const defaultPrompt = '那年今日 适合做回忆拼图的照片';
const minCellSize = 0.06;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalizeUrl = (url?: string) => {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('/')) return url;
  return `/photowall/${url.replace(/^\/+/, '')}`;
};

const ratioToPercent = (ratio: string) => {
  const [w, h] = ratio.split(':').map(Number);
  if (!w || !h) return '100%';
  return `${(h / w) * 100}%`;
};

const closeEnough = (a: number, b: number) => Math.abs(a - b) < 0.004;

const getInternalBoundaries = (cells: CollageCell[]) => {
  const xs = new Set<number>();
  const ys = new Set<number>();

  cells.forEach(cell => {
    [cell.x, cell.x + cell.w].forEach(value => {
      if (value > 0.04 && value < 0.96) xs.add(Number(value.toFixed(3)));
    });
    [cell.y, cell.y + cell.h].forEach(value => {
      if (value > 0.04 && value < 0.96) ys.add(Number(value.toFixed(3)));
    });
  });

  return {
    xs: Array.from(xs).sort((a, b) => a - b),
    ys: Array.from(ys).sort((a, b) => a - b)
  };
};

const getBoundaryRange = (cells: CollageCell[], handle: DragHandle) => {
  let min = 0.02;
  let max = 0.98;

  cells.forEach(cell => {
    if (handle.axis === 'x') {
      const left = cell.x;
      const right = cell.x + cell.w;
      if (closeEnough(right, handle.value)) min = Math.max(min, left + minCellSize);
      if (closeEnough(left, handle.value)) max = Math.min(max, right - minCellSize);
      return;
    }

    const top = cell.y;
    const bottom = cell.y + cell.h;
    if (closeEnough(bottom, handle.value)) min = Math.max(min, top + minCellSize);
    if (closeEnough(top, handle.value)) max = Math.min(max, bottom - minCellSize);
  });

  return { min, max: Math.max(min, max) };
};

const updateBoundary = (cells: CollageCell[], handle: DragHandle, nextValue: number) => {
  const value = clamp(nextValue, 0.02, 0.98);

  return cells.map(cell => {
    if (handle.axis === 'x') {
      const left = cell.x;
      const right = cell.x + cell.w;
      if (closeEnough(right, handle.value)) {
        const nextRight = Math.max(left + minCellSize, value);
        return { ...cell, w: Number((nextRight - left).toFixed(4)) };
      }
      if (closeEnough(left, handle.value)) {
        const nextLeft = Math.min(right - minCellSize, value);
        return { ...cell, x: Number(nextLeft.toFixed(4)), w: Number((right - nextLeft).toFixed(4)) };
      }
      return cell;
    }

    const top = cell.y;
    const bottom = cell.y + cell.h;
    if (closeEnough(bottom, handle.value)) {
      const nextBottom = Math.max(top + minCellSize, value);
      return { ...cell, h: Number((nextBottom - top).toFixed(4)) };
    }
    if (closeEnough(top, handle.value)) {
      const nextTop = Math.min(bottom - minCellSize, value);
      return { ...cell, y: Number(nextTop.toFixed(4)), h: Number((bottom - nextTop).toFixed(4)) };
    }
    return cell;
  });
};

const PhotoImg: React.FC<{ photo: Photo; className?: string; style?: React.CSSProperties }> = ({ photo, className, style }) => {
  const sources = [normalizeUrl(photo.thumbnail), normalizeUrl(photo.url), normalizeUrl(photo.originalUrl)].filter(Boolean);
  const [sourceIndex, setSourceIndex] = useState(0);

  useEffect(() => {
    setSourceIndex(0);
  }, [photo.id]);

  return (
    <img
      src={sources[sourceIndex] || ''}
      alt={photo.title}
      className={className}
      style={style}
      draggable={false}
      onError={() => {
        if (sourceIndex < sources.length - 1) setSourceIndex(sourceIndex + 1);
      }}
    />
  );
};

const CreativePanel: React.FC<CreativePanelProps> = ({ onClose }) => {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [mode, setMode] = useState<'collage' | 'video'>('collage');
  const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);
  const [templates, setTemplates] = useState<CollageTemplate[]>([]);
  const [selection, setSelection] = useState<SelectionResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [templateId, setTemplateId] = useState('');
  const [draftCells, setDraftCells] = useState<CollageCell[]>([]);
  const [topPanelsCollapsed, setTopPanelsCollapsed] = useState(false);
  const [photoFocus, setPhotoFocus] = useState<Record<string, { x: number; y: number }>>({});
  const [collage, setCollage] = useState<CollageResult | null>(null);
  const [videoDemo, setVideoDemo] = useState<VideoDemoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPhotos = useMemo(
    () => selection?.selected.filter(item => selectedIds.has(item.photo.id)) || [],
    [selection, selectedIds]
  );

  const activeTemplate = useMemo(() => {
    return templates.find(template => template.id === templateId)
      || selection?.recommendedTemplates?.[0]
      || templates[0]
      || null;
  }, [selection, templateId, templates]);

  const templateChoices = useMemo(() => {
    const recommended = new Map<string, CollageTemplate>(
      (selection?.recommendedTemplates || []).map((template): [string, CollageTemplate] => [template.id, template])
    );
    return templates
      .map(template => {
        const recommendedTemplate = recommended.get(template.id);
        return recommendedTemplate ? { ...template, ...recommendedTemplate } : template;
      })
      .sort((a, b) => {
        const aFits = selectedPhotos.length >= a.minPhotos && selectedPhotos.length <= a.maxPhotos ? 1 : 0;
        const bFits = selectedPhotos.length >= b.minPhotos && selectedPhotos.length <= b.maxPhotos ? 1 : 0;
        return bFits - aFits || (b.score || 0) - (a.score || 0);
      });
  }, [selection, selectedPhotos.length, templates]);

  const previewCells = useMemo(() => {
    if (!activeTemplate) return [];
    const source = draftCells.length ? draftCells : activeTemplate.cells;
    return source.slice(0, Math.max(1, selectedPhotos.length));
  }, [activeTemplate, draftCells, selectedPhotos.length]);

  const boundaries = useMemo(() => getInternalBoundaries(previewCells), [previewCells]);
  const getPhotoFocus = (index: number) => photoFocus[String(index)] || { x: 0.5, y: 0.5 };

  useEffect(() => {
    const loadCreativeConfig = async () => {
      const [promptResponse, templateResponse] = await Promise.all([
        fetch('/photowall/api/creations/prompts'),
        fetch('/photowall/api/creations/templates')
      ]);
      const promptData = await promptResponse.json();
      const templateData = await templateResponse.json();
      if (promptData.success) setSuggestions(promptData.data || []);
      if (templateData.success) setTemplates(templateData.data || []);
    };

    loadCreativeConfig().catch(() => {
      setSuggestions([]);
      setTemplates([]);
    });
  }, []);

  useEffect(() => {
    if (!activeTemplate) return;
    setDraftCells(activeTemplate.cells.map(cell => ({ ...cell })));
    setPhotoFocus({});
  }, [activeTemplate?.id]);

  const runSelection = async () => {
    setLoading(true);
    setError(null);
    setCollage(null);
    setVideoDemo(null);
    setTopPanelsCollapsed(false);
    try {
      const response = await fetch('/photowall/api/creations/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mode, limit: mode === 'video' ? 8 : 12 })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Selection failed');
      setSelection(data.data);
      setSelectedIds(new Set(data.data.selected.map((item: SelectedPhoto) => item.photo.id)));
      setTemplateId(data.data.recommendedTemplates?.[0]?.id || templates[0]?.id || '');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const togglePhoto = (photoId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const handlePreviewPointerDown = (handle: DragHandle) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setTopPanelsCollapsed(true);
    const preview = event.currentTarget.closest('[data-collage-preview]') as HTMLDivElement | null;
    if (!preview) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    let activeHandle = { ...handle };

    const onMove = (moveEvent: PointerEvent) => {
      const rect = preview.getBoundingClientRect();
      const rawValue = activeHandle.axis === 'x'
        ? (moveEvent.clientX - rect.left) / rect.width
        : (moveEvent.clientY - rect.top) / rect.height;
      setDraftCells(prev => {
        const range = getBoundaryRange(prev, activeHandle);
        const nextValue = clamp(rawValue, range.min, range.max);
        const nextCells = updateBoundary(prev, activeHandle, nextValue);
        activeHandle = { ...activeHandle, value: nextValue };
        return nextCells;
      });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handlePhotoPointerDown = (index: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setTopPanelsCollapsed(true);

    const cell = event.currentTarget;
    cell.setPointerCapture?.(event.pointerId);
    const rect = cell.getBoundingClientRect();
    const start = getPhotoFocus(index);
    const startX = event.clientX;
    const startY = event.clientY;

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setPhotoFocus(prev => ({
        ...prev,
        [String(index)]: {
          x: clamp(start.x - dx / rect.width, 0, 1),
          y: clamp(start.y - dy / rect.height, 0, 1)
        }
      }));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const createCollage = async () => {
    setCreating(true);
    setError(null);
    try {
      const response = await adminFetch('/photowall/api/creations/collage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          photoIds: selectedPhotos.map(item => item.photo.id),
          templateId,
          customCells: previewCells,
          cellFocus: previewCells.map((_, index) => getPhotoFocus(index))
        })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Create collage failed');
      setCollage(data.data);
      const link = document.createElement('a');
      link.href = data.data.url;
      link.download = data.data.url.split('/').pop() || 'smart-gallery-collage.jpg';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const createVideoDemo = async () => {
    setCreating(true);
    setError(null);
    try {
      const response = await adminFetch('/photowall/api/creations/video-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          photoIds: selectedPhotos.map(item => item.photo.id),
          duration: 24
        })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Create video demo failed');
      setVideoDemo(data.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-stretch sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-obsidian border border-white/10 w-full sm:max-w-7xl sm:max-h-[94vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-gold/15 text-gold flex items-center justify-center rounded">
              <Sparkles size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-serif text-white truncate">智能创作</h2>
              <p className="text-xs text-gray-500 truncate">选图、模板、实时拼图编辑和剪辑 demo</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-6 space-y-5">
          <section className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {suggestions.map(item => (
                <button
                  key={item.id}
                  onClick={() => setPrompt(item.prompt)}
                  className="px-3 py-2 bg-white/5 hover:bg-gold/15 border border-white/10 hover:border-gold/40 text-sm text-gray-300 hover:text-gold rounded transition-colors"
                  title={item.description}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={3}
                className="w-full bg-charcoal border border-white/10 focus:border-gold/50 outline-none rounded px-4 py-3 text-sm text-white resize-none"
                placeholder="描述你想要的照片集合，例如：那年今日、夏天海边、适合做九宫格的人像..."
              />
              <div className="flex lg:flex-col gap-2">
                <button
                  onClick={() => setMode('collage')}
                  className={`flex-1 lg:flex-none px-4 py-2 rounded text-sm flex items-center justify-center gap-2 ${mode === 'collage' ? 'bg-gold text-obsidian' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}
                >
                  <ImagePlus size={16} />
                  拼图
                </button>
                <button
                  onClick={() => setMode('video')}
                  className={`flex-1 lg:flex-none px-4 py-2 rounded text-sm flex items-center justify-center gap-2 ${mode === 'video' ? 'bg-gold text-obsidian' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}
                >
                  <Film size={16} />
                  剪辑
                </button>
                <button
                  onClick={runSelection}
                  disabled={loading || !prompt.trim()}
                  className="flex-1 lg:flex-none px-4 py-2 rounded bg-white text-obsidian hover:bg-gold disabled:opacity-50 text-sm flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                  选图
                </button>
              </div>
            </div>
          </section>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-300 text-sm rounded">
              {error}
            </div>
          )}

          {selection && (
            <section className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-gray-500">
                  {selectedIds.size}/{selection.selected.length} 已选，意图: {selection.intent}
                </div>
                <button
                  onClick={() => setTopPanelsCollapsed(!topPanelsCollapsed)}
                  className="px-3 py-1.5 rounded bg-white/5 text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                >
                  {topPanelsCollapsed ? '展开候选图与模板' : '折叠候选图与模板'}
                </button>
              </div>

              {!topPanelsCollapsed && (
                <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4">
                  <div className="bg-charcoal border border-white/10 rounded p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-white font-medium">候选照片</h3>
                      <span className="text-xs text-gray-500">左上 2/3</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-72 overflow-y-auto pr-1">
                      {selection.selected.map(item => (
                        <button
                          key={item.photo.id}
                          onClick={() => togglePhoto(item.photo.id)}
                          className={`text-left bg-black/30 border overflow-hidden rounded transition-all ${selectedIds.has(item.photo.id) ? 'border-gold ring-1 ring-gold/50' : 'border-white/10 hover:border-white/30'}`}
                        >
                          <div className="aspect-[4/3] bg-black">
                            <PhotoImg photo={item.photo} className="w-full h-full object-cover" />
                          </div>
                          <div className="p-2 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-white truncate">{item.photo.title}</span>
                              <span className="text-[11px] text-gold">{item.score}</span>
                            </div>
                            <p className="text-[10px] text-gray-500 line-clamp-1">{item.reasons.join(' / ')}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="bg-charcoal border border-white/10 rounded p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-white font-medium">模板库</h3>
                      <span className="text-xs text-gray-500">右上 1/3</span>
                    </div>
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {templateChoices.map(template => {
                        const fits = selectedPhotos.length >= template.minPhotos && selectedPhotos.length <= template.maxPhotos;
                        return (
                          <button
                            key={template.id}
                            onClick={() => setTemplateId(template.id)}
                            className={`w-full text-left p-3 rounded border transition-colors ${templateId === template.id ? 'border-gold bg-gold/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm text-white">{template.name}</span>
                              <span className={`text-xs ${fits ? 'text-gold' : 'text-gray-600'}`}>{template.ratio}</span>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                              {template.reason || `${template.minPhotos}-${template.maxPhotos} 张照片`}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-charcoal border border-white/10 rounded p-4 space-y-3">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-white font-medium">实时预览</h3>
                    <p className="text-xs text-gray-500 mt-1">{activeTemplate?.name} · 编辑时会自动隐藏候选图与模板</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={mode === 'collage' ? createCollage : createVideoDemo}
                      disabled={creating || selectedPhotos.length === 0}
                      className="px-4 py-2 rounded bg-gold text-obsidian hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center justify-center gap-2"
                    >
                      {creating ? <Loader2 size={16} className="animate-spin" /> : mode === 'collage' ? <ImagePlus size={16} /> : <Film size={16} />}
                      {mode === 'collage' ? '生成拼图' : '生成剪辑 Demo'}
                    </button>
                  </div>
                </div>

                <div className="bg-black/60 p-3 rounded border border-white/10 max-h-[82vh] overflow-auto">
                  <div
                    className="relative mx-auto"
                    style={{ width: '100%' }}
                  >
                    <div
                      data-collage-preview
                      className="relative w-full overflow-hidden bg-black"
                      style={{ paddingTop: ratioToPercent(activeTemplate?.ratio || '1:1') }}
                    >
                      <div className="absolute inset-0">
                        {previewCells.map((cell, index) => {
                          const item = selectedPhotos[index % Math.max(1, selectedPhotos.length)];
                          if (!item) return null;
                          const focus = getPhotoFocus(index);
                          return (
                            <div
                              key={`${item.photo.id}-${index}`}
                              onPointerDown={handlePhotoPointerDown(index)}
                              className="absolute overflow-hidden border border-black bg-neutral-900 cursor-move touch-none"
                              style={{
                                left: `${cell.x * 100}%`,
                                top: `${cell.y * 100}%`,
                                width: `${cell.w * 100}%`,
                                height: `${cell.h * 100}%`
                              }}
                              title="拖动照片调整露出位置"
                            >
                              <PhotoImg
                                photo={item.photo}
                                className="w-full h-full object-cover select-none pointer-events-none"
                                style={{ objectPosition: `${focus.x * 100}% ${focus.y * 100}%` }}
                              />
                            </div>
                          );
                        })}

                        {boundaries.xs.map(value => (
                          <div
                            key={`x-${value}`}
                            onPointerDown={handlePreviewPointerDown({ axis: 'x', value })}
                            className="absolute top-0 bottom-0 w-4 -translate-x-1/2 cursor-col-resize bg-gold/0 hover:bg-gold/30 active:bg-gold/40 z-20"
                            style={{ left: `${value * 100}%` }}
                            title="拖动调整列宽"
                          />
                        ))}
                        {boundaries.ys.map(value => (
                          <div
                            key={`y-${value}`}
                            onPointerDown={handlePreviewPointerDown({ axis: 'y', value })}
                            className="absolute left-0 right-0 h-4 -translate-y-1/2 cursor-row-resize bg-gold/0 hover:bg-gold/30 active:bg-gold/40 z-20"
                            style={{ top: `${value * 100}%` }}
                            title="拖动调整行高"
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <p className="text-xs text-gray-500">
                  外框固定，拖动内部热区调整分割线；拖动照片本身调整在格子里的露出位置。开始编辑时，上方候选图与模板会自动折叠。
                </p>

                {collage && (
                  <div className="space-y-2">
                    <img src={collage.url} alt="Generated collage" className="w-full max-w-2xl rounded border border-white/10" />
                    <a href={collage.url} target="_blank" rel="noreferrer" className="block text-xs text-gold hover:text-white">
                      打开生成结果 ({collage.size.width}x{collage.size.height})
                    </a>
                  </div>
                )}

                {videoDemo && (
                  <div className="space-y-3">
                    <div className="text-sm text-gray-300">
                      Demo 时长约 {videoDemo.totalDuration}s，已生成 storyboard manifest。
                    </div>
                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {videoDemo.storyboard.map((clip, index) => (
                        <div key={`${clip.photoId}-${index}`} className="p-2 bg-white/5 rounded text-xs text-gray-400">
                          <div className="text-white truncate">{index + 1}. {clip.title}</div>
                          <div>{clip.effect} · {clip.duration}s · {clip.caption}</div>
                        </div>
                      ))}
                    </div>
                    <a href={videoDemo.url} target="_blank" rel="noreferrer" className="block text-xs text-gold hover:text-white">
                      打开剪辑 Demo JSON
                    </a>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreativePanel;
