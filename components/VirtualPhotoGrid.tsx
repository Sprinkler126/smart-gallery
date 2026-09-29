import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Photo, ViewMode } from '../types';
import { buildPhotoLayout, visibleLayoutRange } from '../services/photoLayout.js';

interface Props {
  photos: Photo[];
  mode: ViewMode;
  renderPhoto: (photo: Photo, index: number) => React.ReactNode;
}

export default function VirtualPhotoGrid({ photos, mode, renderPhoto }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, start: 0, end: 0 });
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      setViewport({ width: rect.width, start: Math.max(0, -rect.top - 800), end: Math.max(0, window.innerHeight - rect.top + 800) });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  }, []);
  const layout = useMemo(() => buildPhotoLayout(photos, viewport.width, mode), [photos, viewport.width, mode]);
  const range = visibleLayoutRange(layout, viewport.start, viewport.end);
  return <div ref={container} className="relative w-full" style={{ height: layout.height }}>
    {layout.items.slice(range.start, range.end).map(item => <div
      key={item.kind === 'photo' ? photos[item.index].id : `${item.kind}-${item.y}`}
      className="absolute"
      style={{ left: item.x, top: item.y, width: item.width, height: item.height }}
    >
      {item.kind === 'photo' ? renderPhoto(photos[item.index], item.index) : item.kind === 'year'
        ? <h2 className="border-b border-white/5 py-3 font-serif text-5xl font-bold text-white/20">{item.label}</h2>
        : <h3 className="font-serif text-2xl text-gold">{item.label}</h3>}
    </div>)}
  </div>;
}
