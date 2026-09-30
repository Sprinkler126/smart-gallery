import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed, Loader2, MapPin, X } from 'lucide-react';
import { Photo } from '../types';
import { galleryApi, MapPoint, MapResponse, PhotoQuery } from '../services/galleryApi';
import ProtectedImage from './ProtectedImage';
import './PhotoMapView.css';

export interface SavedMapView { center: [number, number]; zoom: number; }
interface Props {
  query: PhotoQuery;
  revision: number;
  isApiAvailable: boolean;
  savedView: React.MutableRefObject<SavedMapView | null>;
  onOpenPhoto: (photo: Photo) => void;
}

function normalizedBounds(map: L.Map) {
  const bounds = map.getBounds();
  const wrap = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
  return {
    south: Math.max(-90, bounds.getSouth()), north: Math.min(90, bounds.getNorth()),
    west: bounds.getEast() - bounds.getWest() >= 360 ? -180 : wrap(bounds.getWest()),
    east: bounds.getEast() - bounds.getWest() >= 360 ? 180 : wrap(bounds.getEast())
  };
}

export default function PhotoMapView({ query, revision, isApiAvailable, savedView, onOpenPhoto }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const openRef = useRef(onOpenPhoto);
  openRef.current = onOpenPhoto;
  const [data, setData] = useState<MapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tileError, setTileError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selectedCluster, setSelectedCluster] = useState<MapPoint | null>(null);
  const [clusterPhotos, setClusterPhotos] = useState<Photo[]>([]);
  const [clusterTotal, setClusterTotal] = useState(0);
  const [clusterLoading, setClusterLoading] = useState(false);
  const [clusterError, setClusterError] = useState<string | null>(null);
  const [clusterOffset, setClusterOffset] = useState(0);
  const clusterVersion = useRef(0);
  const clusterAbort = useRef<AbortController | null>(null);
  const [clusterRetry, setClusterRetry] = useState(0);
  const [satellite, setSatellite] = useState(false);

  useEffect(() => {
    if (!element.current) return;
    const previous = savedView.current;
    const map = L.map(element.current, {
      center: previous?.center || [30, 105], zoom: previous?.zoom ?? 3,
      minZoom: 1, maxZoom: 19, worldCopyJump: true, scrollWheelZoom: true
    });
    mapRef.current = map;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(element.current);
    return () => {
      savedView.current = { center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom() };
      observer.disconnect(); map.remove(); mapRef.current = null; markers.current.clear();
      clusterAbort.current?.abort();
    };
  }, [savedView]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setTileError(false);
    const tiles = L.tileLayer(satellite
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, maxNativeZoom: satellite ? 17 : 19,
      updateWhenZooming: false, keepBuffer: 3,
      attribution: satellite ? 'Tiles &copy; Esri' : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    tiles.on('tileerror', () => setTileError(true));
    return () => { tiles.off(); map.removeLayer(tiles); };
  }, [satellite, retry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isApiAvailable) return;
    let disposed = false;
    let request = 0;
    let abort: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout>;
    clusterVersion.current++; clusterAbort.current?.abort();
    setSelectedCluster(null); setClusterPhotos([]); setError(null);
    markers.current.forEach(marker => map.removeLayer(marker)); markers.current.clear();
    const render = (result: MapResponse) => {
      const next = new Set<string>();
      for (const point of result.points) {
        const key = `${map.getZoom()}:${point.x}:${point.y}:${point.id}:${point.count}:${point.version}`;
        next.add(key);
        if (markers.current.has(key)) continue;
        const content = document.createElement('div');
        content.className = 'gallery-map-photo';
        const image = document.createElement('img');
        image.src = `/photowall/api/thumbnail/${encodeURIComponent(point.id)}?v=${encodeURIComponent(point.version || '')}`;
        image.alt = point.count > 1 ? `${point.count} 张照片` : '查看照片'; image.loading = 'lazy';
        content.append(image);
        if (point.count > 1) {
          const badge = document.createElement('span'); badge.textContent = point.count.toLocaleString(); content.append(badge);
        }
        const marker = L.marker([point.latitude, point.longitude], {
          icon: L.divIcon({ html: content, className: 'gallery-map-marker', iconSize: [64, 64], iconAnchor: [32, 32] }),
          title: point.count > 1 ? `查看此处的 ${point.count} 张照片` : '查看照片'
        }).addTo(map);
        marker.on('click', () => {
          setSelectedCluster(point); setClusterOffset(0); setClusterPhotos([]); setClusterTotal(0);
        });
        markers.current.set(key, marker);
      }
      for (const [key, marker] of markers.current) {
        if (!next.has(key)) { map.removeLayer(marker); markers.current.delete(key); }
      }
    };
    const fetchPoints = async (fit = false) => {
      abort?.abort(); abort = new AbortController();
      const signal = abort.signal;
      const token = ++request;
      setLoading(true); setError(null);
      try {
        const result = await galleryApi.getMapPoints({ ...query, ...(fit ? {} : normalizedBounds(map)), zoom: fit ? 2 : map.getZoom() }, signal);
        if (disposed || token !== request || signal.aborted) return;
        setData(result);
        if (fit && result.extent) {
          const { south, north, west, east } = result.extent;
          map.fitBounds([[south, west], [north, east]], { padding: [60, 60], maxZoom: 13, animate: false });
          schedule();
        } else render(result);
      } catch (err) { if (!disposed && !signal.aborted) setError((err as Error).message); }
      finally { if (!disposed && token === request) setLoading(false); }
    };
    const schedule = () => {
      request++; abort?.abort(); clearTimeout(timer);
      timer = setTimeout(() => { void fetchPoints(); }, 180);
    };
    map.on('moveend', schedule);
    void fetchPoints(!savedView.current);
    return () => { disposed = true; clearTimeout(timer); abort?.abort(); map.off('moveend', schedule); };
  }, [query, revision, isApiAvailable, retry, savedView]);

  useEffect(() => {
    if (!selectedCluster) return;
    clusterAbort.current?.abort();
    const abort = new AbortController(); clusterAbort.current = abort;
    const version = ++clusterVersion.current;
    setClusterLoading(true); setClusterError(null);
    const { south, north, west, east } = selectedCluster;
    galleryApi.getPhotos({ ...query, south, north, west, east, limit: 60, offset: clusterOffset }, abort.signal).then(result => {
      if (abort.signal.aborted || version !== clusterVersion.current) return;
      setClusterPhotos(previous => clusterOffset === 0 ? result.photos : [...previous, ...result.photos]);
      setClusterTotal(result.pagination.total);
      if (selectedCluster.count === 1 && result.photos.length === 1) { openRef.current(result.photos[0]); setSelectedCluster(null); }
    }).catch(err => { if (!abort.signal.aborted) setClusterError(err.message); }).finally(() => {
      if (!abort.signal.aborted && version === clusterVersion.current) setClusterLoading(false);
    });
    return () => abort.abort();
  }, [selectedCluster, clusterOffset, query, clusterRetry]);

  const fitAll = () => {
    const extent = data?.extent;
    if (extent) mapRef.current?.fitBounds([[extent.south, extent.west], [extent.north, extent.east]], { padding: [60, 60], maxZoom: 13 });
  };
  const expandCluster = () => {
    if (!selectedCluster) return;
    const { south, north, west, east } = selectedCluster;
    mapRef.current?.fitBounds([[south, west], [north, east]], { padding: [90, 90], maxZoom: 19 });
    setSelectedCluster(null);
  };
  return <section className="gallery-map relative isolate overflow-hidden rounded-2xl border border-white/10 bg-charcoal" aria-label="地图相册">
    <div ref={element} className="h-[70vh] min-h-[440px] w-full" />
    <div className="absolute left-14 right-3 top-3 z-[500] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
      <div className="rounded-xl border border-white/10 bg-obsidian/90 px-3 py-2 text-xs text-gray-300 backdrop-blur pointer-events-auto">
        <span className="inline-flex items-center gap-2"><MapPin size={14} className="text-gold" />{data ? `${data.locatedTotal.toLocaleString()} 张有定位 · ${data.unlocatedTotal.toLocaleString()} 张无定位` : '读取照片位置'}{loading && <Loader2 size={12} className="animate-spin" />}</span>
      </div>
      <div className="flex gap-1 rounded-xl border border-white/10 bg-obsidian/90 p-1 text-xs pointer-events-auto">
        <button onClick={fitAll} disabled={!data?.extent} className="flex items-center gap-1 rounded-lg px-3 py-2 text-gold disabled:opacity-40" title="显示全部拍摄地点"><LocateFixed size={15} />全部地点</button>
        <button onClick={() => setSatellite(value => !value)} className="rounded-lg px-3 py-2 text-gray-300">{satellite ? '普通地图' : '卫星地图'}</button>
      </div>
    </div>
    {(error || data?.locatedTotal === 0) && <div className="absolute inset-0 z-[450] flex items-center justify-center pointer-events-none">
      <div className="max-w-sm rounded-2xl border border-white/10 bg-obsidian/95 p-6 text-center pointer-events-auto">
        <MapPin size={32} className="mx-auto mb-3 text-gold" /><p className="text-sm text-gray-300">{error || '当前筛选没有带 GPS 定位的照片'}</p>
        {error ? <button onClick={() => setRetry(value => value + 1)} className="mt-3 text-sm text-gold">重新加载</button> : <p className="mt-2 text-xs text-gray-500">保留照片原始定位信息后，即可在地图中浏览。</p>}
      </div>
    </div>}
    {tileError && <div className="absolute bottom-7 left-3 z-[500] rounded-lg bg-obsidian/90 px-3 py-2 text-xs text-gray-300">底图加载失败，照片位置仍可查看。<button onClick={() => setRetry(value => value + 1)} className="ml-2 text-gold">重试</button></div>}
    {selectedCluster && <aside className="absolute inset-x-3 bottom-8 z-[600] max-h-[55%] overflow-auto rounded-xl border border-white/10 bg-obsidian/95 p-4 shadow-2xl backdrop-blur sm:left-auto sm:top-16 sm:w-80 sm:max-h-none">
      <div className="mb-3 flex items-center justify-between gap-2"><span className="text-sm text-white">此处的 {selectedCluster.count.toLocaleString()} 张照片</span><button aria-label="关闭地点相册" onClick={() => setSelectedCluster(null)} className="p-1 text-gray-400"><X size={18} /></button></div>
      {selectedCluster.count > 1 && <button onClick={expandCluster} className="mb-3 text-xs text-gold">放大查看这些地点</button>}
      <div className="grid grid-cols-3 gap-2">{clusterPhotos.map(photo => <button key={photo.id} onClick={() => onOpenPhoto(photo)} aria-label={`查看 ${photo.title}`} className="aspect-square overflow-hidden rounded-md">
        <ProtectedImage src={photo.thumbnail} alt={photo.title} className="h-full w-full" aspectRatio="1" />
      </button>)}</div>
      {clusterError && <p className="mt-3 text-xs text-red-400">{clusterError}<button onClick={() => setClusterRetry(value => value + 1)} className="ml-2 text-gold">重试</button></p>}
      {clusterLoading ? <Loader2 size={18} className="mx-auto mt-3 animate-spin text-gold" /> : clusterPhotos.length < clusterTotal && !clusterError &&
        <button onClick={() => setClusterOffset(clusterPhotos.length)} className="mt-3 w-full rounded border border-white/10 py-2 text-xs text-gold">更多照片（{clusterPhotos.length} / {clusterTotal}）</button>}
    </aside>}
    <p className="absolute bottom-2 left-3 z-[500] text-[10px] text-gray-500 pointer-events-none">原始 GPS 拍摄位置 · 滚轮或双指缩放</p>
  </section>;
}
