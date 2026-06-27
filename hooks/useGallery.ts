/**
 * useGallery Hook
 * Manages gallery state with API integration and real-time updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Photo } from '../types';
import { galleryApi, GalleryStats, GalleryConfig, ImageSource } from '../services/galleryApi';
import { socketService } from '../services/socketService';

// Fallback to static data if API is not available
import { GALLERY_DATA, APP_NAME, PHOTOGRAPHER_NAME } from '../constants';

export interface UseGalleryOptions {
  enableRealtime?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export interface UseGalleryReturn {
  // Data
  photos: Photo[];
  categories: string[];
  sources: ImageSource[];
  stats: GalleryStats | null;
  config: GalleryConfig | null;
  
  // State
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  isApiAvailable: boolean;
  isConnected: boolean;
  
  // Search state
  searchQuery: string;
  searchMode: 'fuzzy' | 'semantic';
  isSearching: boolean;
  searchResults: Photo[] | null;
  
  // Actions
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
  filterByCategory: (category: string) => void;
  addSource: (source: Parameters<typeof galleryApi.addSource>[0]) => Promise<void>;
  removeSource: (id: string) => Promise<void>;
  scanSource: (id: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSearchMode: (mode: 'fuzzy' | 'semantic') => void;
  performSearch: () => Promise<void>;
  clearSearch: () => void;
  
  // Current filter state
  currentCategory: string;
  filteredPhotos: Photo[];
}

export function useGallery(options: UseGalleryOptions = {}): UseGalleryReturn {
  const {
    enableRealtime = true,
    autoRefresh = false,
    refreshInterval = 60000,
  } = options;

  // State
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [categories, setCategories] = useState<string[]>(['All']);
  const [sources, setSources] = useState<ImageSource[]>([]);
  const [stats, setStats] = useState<GalleryStats | null>(null);
  const [config, setConfig] = useState<GalleryConfig | null>(null);
  const [currentCategory, setCurrentCategory] = useState<string>('All');
  
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isApiAvailable, setIsApiAvailable] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  // Search state
  const [searchQuery, setSearchQueryState] = useState<string>('');
  const [searchMode, setSearchModeState] = useState<'fuzzy' | 'semantic'>('fuzzy');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Photo[] | null>(null);

  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Initialize with fallback to static data
   */
  const initializeWithFallback = useCallback(() => {
    console.log('📷 Using static gallery data (API not available)');
    setPhotos(GALLERY_DATA);
    
    // Extract categories from static data
    const cats = new Set(GALLERY_DATA.map(p => p.category));
    setCategories(['All', ...Array.from(cats)]);
    
    setConfig({
      appName: APP_NAME,
      photographerName: PHOTOGRAPHER_NAME,
      supportedFormats: ['.jpg', '.jpeg', '.png', '.webp'],
      autoRefreshInterval: 0,
      enableFileWatcher: false,
    });
    
    setIsLoading(false);
    setIsApiAvailable(false);
  }, []);

  /**
   * Load data from API
   */
  const loadFromApi = useCallback(async () => {
    try {
      setError(null);
      
      // Fetch all data in parallel
      const [photosRes, categoriesRes, sourcesRes, statsRes, configRes] = await Promise.all([
        galleryApi.getPhotos(),
        galleryApi.getCategories(),
        galleryApi.getSources(),
        galleryApi.getStats(),
        galleryApi.getConfig(),
      ]);

      setPhotos(photosRes.photos);
      setCategories(categoriesRes);
      setSources(sourcesRes);
      setStats(statsRes);
      setConfig(configRes);
      setIsApiAvailable(true);
      
      console.log(`✅ Loaded ${photosRes.photos.length} photos from API`);
    } catch (err) {
      console.error('Failed to load from API:', err);
      throw err;
    }
  }, []);

  /**
   * Initialize gallery
   */
  const initialize = useCallback(async () => {
    setIsLoading(true);
    
    try {
      // Check if API is available
      const apiAvailable = await galleryApi.healthCheck();
      
      if (apiAvailable) {
        await loadFromApi();
        
        // Connect to WebSocket if realtime is enabled
        if (enableRealtime) {
          try {
            await socketService.connect();
            setIsConnected(true);
          } catch (err) {
            console.warn('WebSocket connection failed, continuing without realtime updates');
          }
        }
      } else {
        initializeWithFallback();
      }
    } catch (err) {
      console.warn('API not available, using static data');
      initializeWithFallback();
    } finally {
      setIsLoading(false);
    }
  }, [enableRealtime, loadFromApi, initializeWithFallback]);

  /**
   * Refresh gallery data
   */
  const refresh = useCallback(async () => {
    if (!isApiAvailable) {
      console.log('API not available, skipping refresh');
      return;
    }
    
    setIsRefreshing(true);
    try {
      await galleryApi.refresh();
      await loadFromApi();
    } catch (err) {
      setError('Failed to refresh gallery');
      console.error('Refresh failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [isApiAvailable, loadFromApi]);

  /**
   * Filter photos by category
   */
  const filterByCategory = useCallback((category: string) => {
    setCurrentCategory(category);
  }, []);

  /**
   * Add a new image source
   */
  const addSource = useCallback(async (source: Parameters<typeof galleryApi.addSource>[0]) => {
    if (!isApiAvailable) {
      throw new Error('API not available');
    }
    
    const newSource = await galleryApi.addSource(source);
    setSources(prev => [...prev, newSource]);
    
    // Reload photos after adding source
    await loadFromApi();
  }, [isApiAvailable, loadFromApi]);

  /**
   * Remove an image source
   */
  const removeSource = useCallback(async (id: string) => {
    if (!isApiAvailable) {
      throw new Error('API not available');
    }
    
    await galleryApi.deleteSource(id);
    setSources(prev => prev.filter(s => s.id !== id));
    
    // Reload photos after removing source
    await loadFromApi();
  }, [isApiAvailable, loadFromApi]);

  /**
   * Scan a specific source
   */
  const scanSource = useCallback(async (id: string) => {
    if (!isApiAvailable) {
      throw new Error('API not available');
    }
    
    await galleryApi.scanSource(id);
    await loadFromApi();
  }, [isApiAvailable, loadFromApi]);

  /**
   * Set search query
   */
  const setSearchQuery = useCallback((query: string) => {
    setSearchQueryState(query);
    // Auto-clear search results when query is empty
    if (!query.trim()) {
      setSearchResults(null);
    }
  }, []);

  /**
   * Set search mode
   */
  const setSearchMode = useCallback((mode: 'fuzzy' | 'semantic') => {
    setSearchModeState(mode);
    // Re-run search if there's an active query
    if (searchQuery.trim() && searchResults) {
      performSearch();
    }
  }, [searchQuery, searchResults]);

  /**
   * Perform search based on current mode
   */
  const performSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults(null);
      return;
    }

    setIsSearching(true);
    
    try {
      if (searchMode === 'semantic' && isApiAvailable) {
        // Semantic search via AI analysis API
        const response = await fetch(`/photowall/api/analysis/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();
        
        if (data.success && data.data) {
          // Map search results back to Photo objects
          const resultIds = new Set(data.data.map((r: any) => r.photo.id));
          const matchedPhotos = photos.filter(p => resultIds.has(p.id));
          setSearchResults(matchedPhotos);
        } else {
          setSearchResults([]);
        }
      } else {
        // Fuzzy search - search in title, category, location
        const lowerQuery = query.toLowerCase();
        const matched = photos.filter(photo => {
          const searchableText = [
            photo.title,
            photo.category,
            photo.location,
            photo.date
          ].join(' ').toLowerCase();
          return searchableText.includes(lowerQuery);
        });
        setSearchResults(matched);
      }
    } catch (err) {
      console.error('Search failed:', err);
      // Fallback to fuzzy search on error
      const lowerQuery = query.toLowerCase();
      const matched = photos.filter(photo => {
        const searchableText = [
          photo.title,
          photo.category,
          photo.location,
          photo.date
        ].join(' ').toLowerCase();
        return searchableText.includes(lowerQuery);
      });
      setSearchResults(matched);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, searchMode, photos, isApiAvailable]);

  /**
   * Clear search
   */
  const clearSearch = useCallback(() => {
    setSearchQueryState('');
    setSearchResults(null);
  }, []);

  // Initialize on mount
  useEffect(() => {
    initialize();
    
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
      socketService.disconnect();
    };
  }, [initialize]);

  // Set up real-time updates
  useEffect(() => {
    if (!enableRealtime || !isConnected) return;

    const unsubscribers: (() => void)[] = [];

    // Photo added
    unsubscribers.push(
      socketService.onPhotoAdded((photo) => {
        setPhotos(prev => {
          // Check if photo already exists
          if (prev.some(p => p.id === photo.id)) {
            return prev;
          }
          return [photo, ...prev];
        });
      })
    );

    // Photo removed
    unsubscribers.push(
      socketService.onPhotoRemoved(({ id }) => {
        setPhotos(prev => prev.filter(p => p.id !== id));
      })
    );

    // Photo updated
    unsubscribers.push(
      socketService.onPhotoUpdated((photo) => {
        setPhotos(prev => prev.map(p => p.id === photo.id ? photo : p));
      })
    );

    // Gallery refreshed
    unsubscribers.push(
      socketService.onGalleryRefreshed((newStats) => {
        setStats(newStats);
        loadFromApi(); // Reload all data
      })
    );

    // Stats update
    unsubscribers.push(
      socketService.onStatsUpdate((newStats) => {
        setStats(newStats);
      })
    );

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [enableRealtime, isConnected, loadFromApi]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh || !isApiAvailable) return;

    refreshIntervalRef.current = setInterval(() => {
      refresh();
    }, refreshInterval);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [autoRefresh, isApiAvailable, refreshInterval, refresh]);

  // Compute filtered photos (apply category filter first, then search results if active)
  const basePhotos = currentCategory === 'All'
    ? photos
    : photos.filter(p => p.category === currentCategory);
  
  // If search is active, use search results; otherwise use category-filtered photos
  const filteredPhotos = searchResults !== null 
    ? searchResults.filter(p => currentCategory === 'All' || p.category === currentCategory)
    : basePhotos;

  return {
    // Data
    photos,
    categories,
    sources,
    stats,
    config,
    
    // State
    isLoading,
    isRefreshing,
    error,
    isApiAvailable,
    isConnected,
    
    // Search state
    searchQuery,
    searchMode,
    isSearching,
    searchResults,
    
    // Actions
    refresh,
    reload: loadFromApi,
    filterByCategory,
    addSource,
    removeSource,
    scanSource,
    setSearchQuery,
    setSearchMode,
    performSearch,
    clearSearch,
    
    // Filter state
    currentCategory,
    filteredPhotos,
  };
}
