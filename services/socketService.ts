/**
 * Socket.IO Service
 * Real-time updates for the gallery
 */

import { io, Socket } from 'socket.io-client';
import { Photo } from '../types';

export type PhotoEvent = 'photo:added' | 'photo:removed' | 'photo:updated';
export type GalleryEvent = 'gallery:refreshed' | 'gallery:stats';
export type ScanEvent = 'scan:start' | 'scan:complete';

export interface GalleryStats {
  totalPhotos: number;
  totalSources: number;
  categories: Record<string, number>;
  sources: Record<string, number>;
  lastScanTime: string | null;
  isScanning: boolean;
}

type EventCallback<T> = (data: T) => void;

class SocketService {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<EventCallback<any>>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private isConnected = false;

  /**
   * Connect to the WebSocket server
   */
  connect(url?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve();
        return;
      }

      const socketUrl = url || (import.meta.env.VITE_API_URL || window.location.origin);
      
      this.socket = io(socketUrl, {
        path: '/photowall/socket.io',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
      });

      this.socket.on('connect', () => {
        console.log('🔌 Connected to gallery server');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        resolve();
      });

      this.socket.on('disconnect', (reason) => {
        console.log('📴 Disconnected from gallery server:', reason);
        this.isConnected = false;
      });

      this.socket.on('connect_error', (error) => {
        console.warn('⚠️ Connection error:', error.message);
        this.reconnectAttempts++;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          reject(new Error('Failed to connect to gallery server'));
        }
      });

      // Set up event forwarding
      this.setupEventForwarding();
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
    }
  }

  /**
   * Set up event forwarding from socket to local listeners
   */
  private setupEventForwarding(): void {
    if (!this.socket) return;

    const events = [
      'photo:added',
      'photo:removed',
      'photo:updated',
      'gallery:refreshed',
      'gallery:stats',
      'scan:start',
      'scan:complete',
    ];

    events.forEach(event => {
      this.socket!.on(event, (data: any) => {
        this.emit(event, data);
      });
    });
  }

  /**
   * Emit event to local listeners
   */
  private emit(event: string, data: any): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * Subscribe to an event
   */
  on<T>(event: string, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  /**
   * Subscribe to photo added events
   */
  onPhotoAdded(callback: EventCallback<Photo>): () => void {
    return this.on<Photo>('photo:added', callback);
  }

  /**
   * Subscribe to photo removed events
   */
  onPhotoRemoved(callback: EventCallback<{ id: string }>): () => void {
    return this.on<{ id: string }>('photo:removed', callback);
  }

  /**
   * Subscribe to photo updated events
   */
  onPhotoUpdated(callback: EventCallback<Photo>): () => void {
    return this.on<Photo>('photo:updated', callback);
  }

  /**
   * Subscribe to gallery refresh events
   */
  onGalleryRefreshed(callback: EventCallback<GalleryStats>): () => void {
    return this.on<GalleryStats>('gallery:refreshed', callback);
  }

  /**
   * Subscribe to stats updates
   */
  onStatsUpdate(callback: EventCallback<GalleryStats>): () => void {
    return this.on<GalleryStats>('gallery:stats', callback);
  }

  /**
   * Subscribe to scan start events
   */
  onScanStart(callback: EventCallback<{ sourceId: string }>): () => void {
    return this.on<{ sourceId: string }>('scan:start', callback);
  }

  /**
   * Subscribe to scan complete events
   */
  onScanComplete(callback: EventCallback<{ sourceId: string; count: number }>): () => void {
    return this.on<{ sourceId: string; count: number }>('scan:complete', callback);
  }

  /**
   * Request a gallery refresh via socket
   */
  requestRefresh(): void {
    if (this.socket?.connected) {
      this.socket.emit('gallery:refresh');
    }
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected && this.socket?.connected === true;
  }
}

// Export singleton instance
export const socketService = new SocketService();

// Export class for custom instances
export { SocketService };
