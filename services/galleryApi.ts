/**
 * Gallery API Service
 * Client-side service for communicating with the gallery backend
 */

import { Photo } from '../types';
import { withAdminHeaders } from './adminAuth';

// API base URL - can be configured for different environments
// Use relative path with /photowall prefix for production
const API_BASE = import.meta.env.VITE_API_URL || '/photowall/api';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: {
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  };
}

export interface PhotosResponse {
  photos: Photo[];
  pagination: {
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  };
}

export interface ImageSource {
  id: string;
  name: string;
  type: string;
  path: string;
  enabled: boolean;
  photoCount: number;
  lastScanned: string | null;
  status: string;
  watch: boolean;
}

export interface PhotoQuery {
  category?: string;
  sourceId?: string;
  q?: string;
  ids?: string[];
  south?: number;
  north?: number;
  west?: number;
  east?: number;
}

export interface MapPoint {
  id: string;
  version?: string;
  x: number;
  y: number;
  latitude: number;
  longitude: number;
  count: number;
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface MapResponse {
  points: MapPoint[];
  total: number;
  locatedTotal: number;
  unlocatedTotal: number;
  extent: { south: number; north: number; west: number; east: number } | null;
}

function queryParams(options: object) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) params.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
  }
  return params;
}

export interface GalleryStats {
  totalPhotos: number;
  totalSources: number;
  categories: Record<string, number>;
  sources: Record<string, number>;
  lastScanTime: string | null;
  isScanning: boolean;
}

export interface GalleryConfig {
  appName: string;
  photographerName: string;
  supportedFormats: string[];
  autoRefreshInterval: number;
  enableFileWatcher: boolean;
}

export interface CacheStats {
  count: number;
  maxSize: number;
  totalSizeBytes: number;
  totalSizeMB: string;
  directory: string;
}

class GalleryApiService {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...withAdminHeaders(),
          ...options.headers,
        },
        ...options,
      });

      const data = await response.json();
      
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP error ${response.status}`);
      }

      return data;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') console.error(`API Error (${endpoint}):`, error);
      throw error;
    }
  }

  // ==================== PHOTOS ====================

  /**
   * Fetch one catalog page with optional filtering
   */
  async getPhotos(options: PhotoQuery & {
    sortBy?: 'date' | 'title' | 'category';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  } = {}, signal?: AbortSignal): Promise<PhotosResponse> {
    const queryString = queryParams(options).toString();
    const endpoint = `/photos${queryString ? `?${queryString}` : ''}`;
    
    const response = await this.request<Photo[]>(endpoint, { signal });
    
    return {
      photos: response.data || [],
      pagination: response.pagination || {
        total: 0,
        offset: 0,
        limit: 0,
        hasMore: false,
      },
    };
  }

  /**
   * Get a single photo by ID
   */
  async getPhotoIds(query: PhotoQuery): Promise<string[]> {
    const response = await this.request<string[]>(`/photos/ids?${queryParams(query)}`);
    return response.data || [];
  }

  async getMapPoints(query: PhotoQuery & { zoom?: number }, signal?: AbortSignal): Promise<MapResponse> {
    const response = await this.request<MapResponse>(`/map/points?${queryParams(query)}`, { signal });
    if (!response.data) throw new Error('地图数据为空');
    return response.data;
  }

  async getPhoto(id: string): Promise<Photo | null> {
    try {
      const response = await this.request<Photo>(`/photos/${encodeURIComponent(id)}`);
      return response.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Get image URL for a photo
   */
  getImageUrl(photoId: string): string {
    return `${this.baseUrl}/image/${photoId}`;
  }

  /**
   * Get thumbnail URL for a photo
   */
  getThumbnailUrl(photoId: string): string {
    return `${this.baseUrl}/thumbnail/${photoId}`;
  }

  // ==================== CATEGORIES ====================

  /**
   * Get all available categories
   */
  async getCategories(): Promise<string[]> {
    const response = await this.request<string[]>('/categories');
    return response.data || ['All'];
  }

  async getUploadCategories(): Promise<string[]> {
    const response = await this.request<string[]>('/uploads/categories');
    return response.data || [];
  }

  async createUploadCategory(name: string): Promise<{ name: string; created: boolean }> {
    const response = await this.request<{ name: string; created: boolean }>('/uploads/categories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return response.data!;
  }

  async uploadImages(category: string, files: File[]): Promise<{
    category: string;
    count: number;
    files: string[];
    original: true;
    indexed: boolean;
    warning: string | null;
  }> {
    const form = new FormData();
    form.append('category', category);
    files.forEach(file => form.append('images', file));

    const response = await fetch(`${this.baseUrl}/uploads`, {
      method: 'POST',
      body: form,
      headers: withAdminHeaders(),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `HTTP error ${response.status}`);
    }
    return data.data;
  }

  // ==================== SOURCES ====================

  /**
   * Get all image sources
   */
  async getSources(): Promise<ImageSource[]> {
    const response = await this.request<ImageSource[]>('/sources');
    return response.data || [];
  }

  /**
   * Add a new image source
   */
  async addSource(source: {
    id: string;
    name: string;
    type?: string;
    path: string;
    enabled?: boolean;
    defaultCategory?: string;
    useFolderAsCategory?: boolean;
    watch?: boolean;
  }): Promise<ImageSource> {
    const response = await this.request<ImageSource>('/sources', {
      method: 'POST',
      body: JSON.stringify(source),
    });
    return response.data!;
  }

  /**
   * Update an image source
   */
  async updateSource(
    id: string,
    updates: Partial<ImageSource>
  ): Promise<ImageSource> {
    const response = await this.request<ImageSource>(`/sources/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    return response.data!;
  }

  /**
   * Delete an image source
   */
  async deleteSource(id: string): Promise<void> {
    await this.request(`/sources/${id}`, {
      method: 'DELETE',
    });
  }

  /**
   * Trigger a scan for a specific source
   */
  async scanSource(id: string): Promise<{ count: number }> {
    const response = await this.request<{ count: number }>(`/sources/${id}/scan`, {
      method: 'POST',
    });
    return response.data || { count: 0 };
  }

  // ==================== SYSTEM ====================

  /**
   * Get gallery statistics
   */
  async getStats(): Promise<GalleryStats> {
    const response = await this.request<GalleryStats>('/stats');
    return response.data || {
      totalPhotos: 0,
      totalSources: 0,
      categories: {},
      sources: {},
      lastScanTime: null,
      isScanning: false,
    };
  }

  /**
   * Trigger a full refresh of all sources
   */
  async refresh(): Promise<GalleryStats> {
    const response = await this.request<GalleryStats>('/refresh', {
      method: 'POST',
    });
    return response.data!;
  }

  /**
   * Get configuration
   */
  async getConfig(): Promise<GalleryConfig> {
    const response = await this.request<GalleryConfig>('/config');
    return response.data || {
      appName: 'SPRINKLER',
      photographerName: 'Sprinkler',
      supportedFormats: [],
      autoRefreshInterval: 60000,
      enableFileWatcher: true,
    };
  }

  /**
   * Update configuration
   */
  async updateConfig(updates: Partial<GalleryConfig>): Promise<GalleryConfig> {
    const response = await this.request<GalleryConfig>('/config', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    return response.data!;
  }

  /**
   * Check if the API is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request('/stats');
      return true;
    } catch {
      return false;
    }
  }

  // ==================== CACHE MANAGEMENT ====================

  /**
   * Get thumbnail cache statistics
   */
  async getCacheStats(): Promise<CacheStats> {
    const response = await this.request<CacheStats>('/cache/stats');
    return response.data || {
      count: 0,
      maxSize: 1000,
      totalSizeBytes: 0,
      totalSizeMB: '0',
      directory: '',
    };
  }

  /**
   * Clean up old cached thumbnails
   */
  async cleanCache(validHashes?: string[]): Promise<{ cleaned: number }> {
    const response = await this.request<{ cleaned: number }>('/cache/clean', {
      method: 'POST',
      body: JSON.stringify({ validHashes }),
    });
    return response.data || { cleaned: 0 };
  }
}

// Export singleton instance
export const galleryApi = new GalleryApiService();

// Export class for custom instances
export { GalleryApiService };
