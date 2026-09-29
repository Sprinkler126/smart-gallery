import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Photo } from '../types';
import { galleryApi, GalleryStats, GalleryConfig, ImageSource, PhotoQuery } from '../services/galleryApi';
import { socketService } from '../services/socketService';
import { GALLERY_DATA, APP_NAME, PHOTOGRAPHER_NAME } from '../constants';

export interface UseGalleryOptions { enableRealtime?: boolean; autoRefresh?: boolean; refreshInterval?: number; }
const PAGE_SIZE = 120;

export function useGallery({ enableRealtime = true, autoRefresh = false, refreshInterval = 60000 }: UseGalleryOptions = {}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [categories, setCategories] = useState<string[]>(['All']);
  const [sources, setSources] = useState<ImageSource[]>([]);
  const [stats, setStats] = useState<GalleryStats | null>(null);
  const [config, setConfig] = useState<GalleryConfig | null>(null);
  const [currentCategory, setCurrentCategory] = useState('All');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isApiAvailable, setIsApiAvailable] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [searchQuery, setSearchQueryState] = useState('');
  const [searchMode, setSearchModeState] = useState<'fuzzy' | 'semantic'>('fuzzy');
  const [isSearching, setIsSearching] = useState(false);
  const [appliedSearch, setAppliedSearch] = useState<{ q?: string; ids?: string[] } | null>(null);
  const [totalPhotos, setTotalPhotos] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const page = useRef({ offset: 0, hasMore: false, busy: false, version: 0 });
  const controller = useRef<AbortController | null>(null);
  const searchVersion = useRef(0);
  const loaded = useRef<Photo[]>([]);
  const query = useMemo<PhotoQuery>(() => ({ category: currentCategory, ...appliedSearch }), [currentCategory, appliedSearch]);
  const queryRef = useRef(query);
  queryRef.current = query;

  const loadMetadata = useCallback(async () => {
    const [cats, srcs, counts, settings] = await Promise.all([
      galleryApi.getCategories(), galleryApi.getSources(), galleryApi.getStats(), galleryApi.getConfig()
    ]);
    setCategories(cats); setSources(srcs); setStats(counts); setConfig(settings);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        if (!await galleryApi.healthCheck()) {
          if (cancelled) return;
          setPhotos(GALLERY_DATA); loaded.current = GALLERY_DATA;
          setCategories(['All', ...new Set(GALLERY_DATA.map(photo => photo.category))]);
          setConfig({ appName: APP_NAME, photographerName: PHOTOGRAPHER_NAME, supportedFormats: [], autoRefreshInterval: 0, enableFileWatcher: false });
          setTotalPhotos(GALLERY_DATA.length); setIsLoading(false);
          return;
        }
        await loadMetadata();
        if (cancelled) return;
        setIsApiAvailable(true);
        if (enableRealtime) {
          try { await socketService.connect(); if (!cancelled) setIsConnected(true); }
          catch (err) { console.warn('实时连接不可用', err); }
        }
      } catch (err) {
        if (!cancelled) { setError((err as Error).message); setIsLoading(false); }
      }
    }
    void initialize();
    return () => { cancelled = true; controller.current?.abort(); if (enableRealtime) socketService.disconnect(); };
  }, [enableRealtime, loadMetadata]);

  useEffect(() => {
    if (!isApiAvailable) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const version = ++page.current.version;
    page.current.offset = 0; page.current.hasMore = false; page.current.busy = true;
    setPhotos([]); loaded.current = []; setHasMore(false); setIsLoadingMore(true); setError(null);
    galleryApi.getPhotos({ ...query, limit: PAGE_SIZE }, abort.signal).then(result => {
      if (version !== page.current.version || abort.signal.aborted) return;
      loaded.current = result.photos; setPhotos(result.photos);
      page.current.offset = result.photos.length;
      page.current.hasMore = result.pagination.hasMore;
      setHasMore(result.pagination.hasMore); setTotalPhotos(result.pagination.total);
    }).catch(err => {
      if (!abort.signal.aborted) setError(err.message);
    }).finally(() => {
      if (version === page.current.version) { page.current.busy = false; setIsLoadingMore(false); setIsLoading(false); }
    });
    return () => abort.abort();
  }, [isApiAvailable, query, revision]);

  const loadMore = useCallback(async () => {
    if (!isApiAvailable || page.current.busy || !page.current.hasMore) return;
    const version = page.current.version;
    page.current.busy = true; setIsLoadingMore(true); setError(null);
    try {
      const result = await galleryApi.getPhotos({ ...queryRef.current, limit: PAGE_SIZE, offset: page.current.offset }, controller.current?.signal);
      if (version !== page.current.version || controller.current?.signal.aborted) return;
      const ids = new Set(loaded.current.map(photo => photo.id));
      loaded.current = [...loaded.current, ...result.photos.filter(photo => !ids.has(photo.id))];
      setPhotos(loaded.current);
      page.current.offset += result.photos.length;
      page.current.hasMore = result.pagination.hasMore;
      setHasMore(result.pagination.hasMore); setTotalPhotos(result.pagination.total);
      return true;
    } catch (err) {
      if (version === page.current.version && !controller.current?.signal.aborted) setError((err as Error).message);
    } finally {
      if (version === page.current.version) { page.current.busy = false; setIsLoadingMore(false); }
    }
  }, [isApiAvailable]);

  const reload = useCallback(async () => {
    if (!isApiAvailable) return;
    try { await loadMetadata(); setRevision(value => value + 1); }
    catch (err) { setError((err as Error).message); throw err; }
  }, [isApiAvailable, loadMetadata]);
  const refresh = useCallback(async () => {
    if (!isApiAvailable) return;
    setIsRefreshing(true);
    try { await galleryApi.refresh(); await reload(); }
    catch (err) { setError((err as Error).message); }
    finally { setIsRefreshing(false); }
  }, [isApiAvailable, reload]);

  useEffect(() => {
    if (!enableRealtime || !isConnected) return;
    let timer: ReturnType<typeof setTimeout>;
    const invalidate = () => { clearTimeout(timer); timer = setTimeout(() => { void reload().catch(() => {}); }, 250); };
    const unsubscribers = [socketService.onPhotoAdded(invalidate), socketService.onPhotoRemoved(invalidate),
      socketService.onPhotoUpdated(invalidate), socketService.onGalleryRefreshed(invalidate), socketService.onStatsUpdate(setStats)];
    return () => { clearTimeout(timer); unsubscribers.forEach(unsubscribe => unsubscribe()); };
  }, [enableRealtime, isConnected, reload]);
  useEffect(() => {
    if (!autoRefresh || !isApiAvailable) return;
    const timer = setInterval(() => { void refresh(); }, refreshInterval);
    return () => clearInterval(timer);
  }, [autoRefresh, isApiAvailable, refreshInterval, refresh]);

  const clearSearch = useCallback(() => {
    searchVersion.current++; setIsSearching(false); setSearchQueryState(''); setAppliedSearch(null);
  }, []);
  const setSearchQuery = useCallback((value: string) => { setSearchQueryState(value); if (!value.trim()) clearSearch(); }, [clearSearch]);
  const performSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) { clearSearch(); return; }
    const version = ++searchVersion.current;
    setIsSearching(true); setError(null);
    try {
      if (searchMode === 'semantic' && isApiAvailable) {
        const response = await fetch(`/photowall/api/analysis/search?q=${encodeURIComponent(q)}`);
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '语义搜索失败');
        if (version === searchVersion.current) setAppliedSearch({ ids: data.data.map((result: { photo: Photo }) => result.photo.id) });
      } else if (version === searchVersion.current) setAppliedSearch({ q });
    } catch (err) { if (version === searchVersion.current) setError((err as Error).message); }
    finally { if (version === searchVersion.current) setIsSearching(false); }
  }, [searchQuery, searchMode, isApiAvailable, clearSearch]);
  const setSearchMode = useCallback((mode: 'fuzzy' | 'semantic') => {
    searchVersion.current++; setIsSearching(false); setSearchModeState(mode); setAppliedSearch(null);
  }, []);
  const filteredPhotos = useMemo(() => {
    if (isApiAvailable) return photos;
    return photos.filter(photo => (currentCategory === 'All' || photo.category === currentCategory)
      && (!appliedSearch?.q || [photo.title, photo.category, photo.location, photo.date].join(' ').toLowerCase().includes(appliedSearch.q.toLowerCase())));
  }, [isApiAvailable, photos, currentCategory, appliedSearch]);

  // Slideshow playback uses a complete metadata snapshot. Bulk selection needs IDs alone.
  const getAllPhotos = useCallback(async () => {
    if (!isApiAvailable) return filteredPhotos;
    const version = page.current.version;
    const snapshot = { ...queryRef.current };
    const results: Photo[] = [];
    let offset = 0;
    while (true) {
      const result = await galleryApi.getPhotos({ ...snapshot, limit: 500, offset });
      if (version !== page.current.version) throw new Error('筛选条件已变化，请重新开始放映');
      results.push(...result.photos); offset += result.photos.length;
      if (!result.pagination.hasMore || result.photos.length === 0) return results;
    }
  }, [isApiAvailable, filteredPhotos]);

  return {
    photos, categories, sources, stats, config, isLoading, isRefreshing, error, isApiAvailable, isConnected,
    searchQuery, searchMode, isSearching, searchResults: appliedSearch ? filteredPhotos : null,
    refresh, reload, filterByCategory: setCurrentCategory, currentCategory, filteredPhotos,
    setSearchQuery, setSearchMode, performSearch, clearSearch,
    totalPhotos: isApiAvailable ? totalPhotos : filteredPhotos.length, hasMore, isLoadingMore, loadMore, getAllPhotos,
    query, revision,
    getAllPhotoIds: () => isApiAvailable ? galleryApi.getPhotoIds(query) : Promise.resolve(filteredPhotos.map(photo => photo.id)),
    addSource: async (source: Parameters<typeof galleryApi.addSource>[0]) => { await galleryApi.addSource(source); await reload(); },
    removeSource: async (id: string) => { await galleryApi.deleteSource(id); await reload(); },
    scanSource: async (id: string) => { await galleryApi.scanSource(id); await reload(); }
  };
}
