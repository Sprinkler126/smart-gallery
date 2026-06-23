import React, { useEffect, useMemo, useState } from 'react';
import { Download, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { Photo } from '../types';
import { adminFetch } from '../services/adminAuth';

interface ExifFramePanelProps {
  photo: Photo;
  onClose: () => void;
}

interface TemplateItem {
  id: string;
  name: string;
  description: string;
  layout?: string;
}

interface ExifFields {
  brand: string;
  brandSlug: string;
  camera: string;
  lens: string;
  date: string;
  location: string;
  focalLength: string;
  aperture: string;
  shutter: string;
  iso: string;
  signature: string;
  title: string;
}

interface LogoInfo {
  available: boolean;
  filename?: string;
  expectedNames?: string[];
  directory?: string;
}

const EMPTY_FIELDS: ExifFields = {
  brand: '',
  brandSlug: '',
  camera: '',
  lens: '',
  date: '',
  location: '',
  focalLength: '',
  aperture: '',
  shutter: '',
  iso: '',
  signature: '',
  title: ''
};

const TEMPLATE_CLASSES: Record<string, string> = {
  'classic-white': 'bg-[#f7f4ef] text-neutral-950',
  'minimal-black': 'bg-neutral-950 text-neutral-50',
  magazine: 'bg-[#ece7dc] text-neutral-950',
  mobile: 'bg-white text-neutral-950',
  'top-logo': 'bg-[#f5f2ec] text-neutral-950',
  'right-rail': 'bg-[#f0eee8] text-neutral-950',
  poster: 'bg-white text-neutral-950',
  'warm-card': 'bg-[#eadfce] text-[#211a13]',
  'blurred-glass': 'bg-neutral-950 text-white'
};

const ExifFramePanel: React.FC<ExifFramePanelProps> = ({ photo, onClose }) => {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [templateId, setTemplateId] = useState('classic-white');
  const [fields, setFields] = useState<ExifFields>(EMPTY_FIELDS);
  const [logo, setLogo] = useState<LogoInfo>({ available: false });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadPreview = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/photowall/api/exif-frame/${photo.id}`);
        const json = await response.json();
        if (!response.ok || !json.success) {
          throw new Error(json.error || 'Failed to load EXIF frame data');
        }
        if (cancelled) return;
        setFields({ ...EMPTY_FIELDS, ...json.data.fields });
        setLogo(json.data.logo || { available: false });
        setTemplates(json.data.templates || []);
        if (json.data.templates?.[0]?.id) setTemplateId(json.data.templates[0].id);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [photo.id]);

  const settingsLine = useMemo(() => {
    return [
      fields.focalLength,
      fields.aperture,
      fields.shutter,
      fields.iso ? `ISO ${fields.iso}` : ''
    ].filter(Boolean).join('   ');
  }, [fields]);

  const updateField = (key: keyof ExifFields, value: string) => {
    setFields(prev => ({ ...prev, [key]: value }));
    setResultUrl('');
  };

  const downloadUrl = (url: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `exif-frame-${photo.title || photo.id}.jpg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const generateFrame = async () => {
    setGenerating(true);
    setError('');
    try {
      const response = await adminFetch(`/photowall/api/exif-frame/${photo.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId,
          width: 1800,
          overrides: fields
        })
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || 'Failed to generate EXIF frame');
      }
      setResultUrl(json.data.url);
      downloadUrl(json.data.url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const selectedTemplate = templates.find(item => item.id === templateId);
  const isDark = templateId === 'minimal-black';
  const isBlurredGlass = templateId === 'blurred-glass';
  const frameClass = TEMPLATE_CLASSES[templateId] || TEMPLATE_CLASSES['classic-white'];

  return (
    <div className="fixed inset-0 z-[70] bg-obsidian/95 backdrop-blur-md text-white flex flex-col">
      <div className="flex items-center justify-between gap-4 px-4 md:px-6 py-4 border-b border-white/10">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.24em] text-gold">EXIF Frame</p>
          <h2 className="text-xl md:text-2xl font-serif truncate">{photo.title}</h2>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X size={22} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="h-full min-h-[480px] flex items-center justify-center text-gray-400">
            <Loader2 size={28} className="animate-spin mr-3" />
            Loading EXIF frame...
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(420px,1fr)_420px] gap-5 md:gap-6 p-4 md:p-6 max-w-7xl mx-auto">
            <section className="space-y-4">
              <div className="rounded-lg bg-charcoal/70 border border-white/10 p-3 md:p-5">
                <div
                  className={`mx-auto w-full max-w-4xl p-[5%] shadow-2xl ${frameClass}`}
                  style={isBlurredGlass ? {
                    backgroundImage: `linear-gradient(rgba(0,0,0,0.36), rgba(0,0,0,0.46)), url(${photo.url})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center'
                  } : undefined}
                >
                  <div className={`bg-black/5 ${isDark ? 'ring-1 ring-white/10' : 'ring-1 ring-black/5'}`}>
                    <img
                      src={photo.url}
                      alt={photo.title}
                      className="w-full max-h-[58vh] object-contain select-none"
                      draggable={false}
                    />
                  </div>
                  <div className="grid grid-cols-[28%_1fr] gap-[4%] pt-[5%] items-start">
                    <div className="min-h-16 flex items-start">
                      <div className="font-black text-2xl md:text-4xl uppercase leading-none break-words">
                        {fields.brand || 'CAMERA'}
                      </div>
                    </div>
                    <div className="space-y-2 min-w-0">
                      {templateId === 'magazine' && (
                        <p className="text-xl md:text-3xl font-semibold truncate">{fields.title || photo.title}</p>
                      )}
                      <p className="text-base md:text-xl font-semibold break-words">
                        {[fields.camera, fields.lens].filter(Boolean).join('  |  ') || 'Unknown Camera'}
                      </p>
                      <p className="text-base md:text-xl break-words">{settingsLine || 'EXIF data unavailable'}</p>
                      <p className={`text-sm md:text-base ${isDark ? 'text-neutral-400' : 'text-neutral-500'} break-words`}>
                        {[fields.date, fields.location].filter(Boolean).join(' / ')}
                      </p>
                      {fields.signature && (
                        <p className={`text-xs md:text-sm pt-3 ${isDark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                          {fields.signature}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              {resultUrl && (
                <div className="rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300 flex items-center justify-between gap-3">
                  <span>已生成相框图片。</span>
                  <button
                    onClick={() => downloadUrl(resultUrl)}
                    className="text-green-100 hover:text-white underline underline-offset-4"
                  >
                    重新下载
                  </button>
                </div>
              )}
            </section>

            <aside className="space-y-5">
              <div className="rounded-lg bg-charcoal/80 border border-white/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-300">模板</h3>
                  <ImageIcon size={17} className="text-gold" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {templates.map(template => (
                    <button
                      key={template.id}
                      onClick={() => setTemplateId(template.id)}
                      className={`text-left rounded-md border px-3 py-2 transition-colors ${
                        templateId === template.id
                          ? 'border-gold bg-gold/10 text-white'
                          : 'border-white/10 bg-white/[0.03] text-gray-300 hover:border-white/25'
                      }`}
                    >
                      <span className="block text-sm font-medium">{template.name}</span>
                      <span className="block text-xs text-gray-500 mt-1 leading-relaxed">{template.description}</span>
                    </button>
                  ))}
                </div>
                {selectedTemplate && (
                  <p className="text-xs text-gray-500 leading-relaxed">{selectedTemplate.description}</p>
                )}
              </div>

              <div className="rounded-lg bg-charcoal/80 border border-white/10 p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-300">品牌与 Logo</h3>
                  <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                    {logo.available
                      ? `已匹配 ${logo.filename}，生成时会优先使用目录中的 logo。`
                      : `未找到 logo，将使用文字品牌。可把 ${logo.expectedNames?.join(' / ') || 'brand.svg'} 放入 ${logo.directory || './public/brand-logos'}。`}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
                  {([
                    ['brand', '品牌'],
                    ['camera', '相机'],
                    ['lens', '镜头'],
                    ['focalLength', '焦距'],
                    ['aperture', '光圈'],
                    ['shutter', '快门'],
                    ['iso', 'ISO'],
                    ['date', '日期'],
                    ['location', '地点'],
                    ['signature', '署名'],
                    ['title', '标题']
                  ] as Array<[keyof ExifFields, string]>).map(([key, label]) => (
                    <label key={key} className="space-y-1">
                      <span className="text-xs text-gray-500">{label}</span>
                      <input
                        value={fields[key]}
                        onChange={(event) => updateField(key, event.target.value)}
                        className="w-full rounded-md bg-black/30 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-gold"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <button
                onClick={generateFrame}
                disabled={generating}
                className="w-full rounded-md bg-gold text-obsidian hover:bg-gold/90 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-3 font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                {generating ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                {generating ? '生成中...' : '生成并下载'}
              </button>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExifFramePanel;
