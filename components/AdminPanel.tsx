import React, { useState } from 'react';
import { X, Plus, Trash2, FolderOpen, RefreshCw, HardDrive, Eye, EyeOff, Search } from 'lucide-react';
import { ImageSource, GalleryStats } from '../services/galleryApi';

interface AdminPanelProps {
  sources: ImageSource[];
  stats: GalleryStats | null;
  onAddSource: (source: {
    id: string;
    name: string;
    type?: string;
    path: string;
    enabled?: boolean;
    defaultCategory?: string;
    useFolderAsCategory?: boolean;
    watch?: boolean;
  }) => Promise<void>;
  onRemoveSource: (id: string) => Promise<void>;
  onScanSource: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onReset?: () => Promise<void>;
  isRefreshing: boolean;
  onClose: () => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({
  sources,
  stats,
  onAddSource,
  onRemoveSource,
  onScanSource,
  onRefresh,
  onReset,
  isRefreshing,
  onClose,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [scanningSource, setScanningSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state for new source
  const [newSource, setNewSource] = useState({
    id: '',
    name: '',
    path: '',
    defaultCategory: 'General',
    useFolderAsCategory: true,
    watch: true,
  });

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsAdding(true);

    try {
      // Generate ID from name if not provided
      const id = newSource.id || newSource.name.toLowerCase().replace(/\s+/g, '-');
      
      await onAddSource({
        ...newSource,
        id,
        type: 'local',
        enabled: true,
      });

      // Reset form
      setNewSource({
        id: '',
        name: '',
        path: '',
        defaultCategory: 'General',
        useFolderAsCategory: true,
        watch: true,
      });
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add source');
    } finally {
      setIsAdding(false);
    }
  };

  const handleScanSource = async (sourceId: string) => {
    setScanningSource(sourceId);
    try {
      await onScanSource(sourceId);
    } finally {
      setScanningSource(null);
    }
  };

  const handleRemoveSource = async (sourceId: string) => {
    if (!confirm('Are you sure you want to remove this source? Photos will be removed from the gallery.')) {
      return;
    }
    
    try {
      await onRemoveSource(sourceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove source');
    }
  };

  return (
    <div className="bg-charcoal border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-5 sm:mb-6">
          <h2 className="text-lg sm:text-xl font-serif text-white flex items-center gap-2 min-w-0">
            <HardDrive size={20} className="text-gold" />
            <span className="truncate">Image Sources Manager</span>
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="hover:text-red-300">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Stats Overview */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <div className="bg-white/5 rounded-lg p-3 sm:p-4">
              <div className="text-xl sm:text-2xl font-bold text-gold">{stats.totalPhotos}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Total Photos</div>
            </div>
            <div className="bg-white/5 rounded-lg p-3 sm:p-4">
              <div className="text-xl sm:text-2xl font-bold text-gold">{stats.totalSources}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Sources</div>
            </div>
            <div className="bg-white/5 rounded-lg p-3 sm:p-4">
              <div className="text-xl sm:text-2xl font-bold text-gold">{Object.keys(stats.categories).length}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Categories</div>
            </div>
            <div className="bg-white/5 rounded-lg p-3 sm:p-4">
              <div className="text-sm text-gray-400 truncate">
                {stats.lastScanTime ? new Date(stats.lastScanTime).toLocaleString() : 'Never'}
              </div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Last Scan</div>
            </div>
          </div>
        )}

        {/* Sources List */}
        <div className="space-y-3 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              Configured Sources
            </h3>
            <div className="grid grid-cols-2 sm:flex gap-2">
              <button
                onClick={() => onRefresh()}
                disabled={isRefreshing}
                className="px-3 py-2 sm:py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                title="Reload photos from sources"
              >
                <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                Refresh All
              </button>
              {onReset && (
                <button
                  onClick={() => onReset()}
                  disabled={isRefreshing}
                  className="px-3 py-2 sm:py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50 border border-red-500/30"
                  title="Clear all cache and rebuild thumbnails"
                >
                  <RefreshCw size={14} />
                  Reset Cache
                </button>
              )}
              <button
                onClick={() => setShowAddForm(true)}
                className="col-span-2 sm:col-span-1 px-3 py-2 sm:py-1.5 bg-gold text-obsidian rounded-lg text-sm flex items-center justify-center gap-2 hover:bg-gold/90 transition-colors"
              >
                <Plus size={14} />
                Add Source
              </button>
            </div>
          </div>

          {sources.length === 0 ? (
            <div className="bg-white/5 rounded-lg p-8 text-center text-gray-500">
              <FolderOpen size={32} className="mx-auto mb-2 opacity-50" />
              <p>No image sources configured</p>
              <p className="text-xs mt-1">Add a source to start loading images</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sources.map((source) => (
                <div
                  key={source.id}
                  className="bg-white/5 rounded-lg p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`p-2 rounded-lg ${source.enabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-500'}`}>
                      <FolderOpen size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-white truncate">{source.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          source.status === 'ready' ? 'bg-green-500/20 text-green-400' :
                          source.status === 'scanning' ? 'bg-yellow-500/20 text-yellow-400' :
                          source.status === 'error' ? 'bg-red-500/20 text-red-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {source.status}
                        </span>
                        {source.watch && (
                          <Eye size={12} className="text-blue-400" title="Auto-watching for changes" />
                        )}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{source.path}</div>
                      <div className="text-xs text-gray-600 mt-1">
                        {source.photoCount} photos • Last scanned: {source.lastScanned ? new Date(source.lastScanned).toLocaleTimeString() : 'Never'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleScanSource(source.id)}
                      disabled={scanningSource === source.id}
                      className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
                      title="Scan Source"
                    >
                      <Search size={16} className={scanningSource === source.id ? 'animate-pulse' : ''} />
                    </button>
                    <button
                      onClick={() => handleRemoveSource(source.id)}
                      className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                      title="Remove Source"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add Source Form */}
        {showAddForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-charcoal rounded-xl p-4 sm:p-6 max-w-md w-full max-h-[90svh] overflow-y-auto shadow-2xl border border-white/10">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-serif text-white">Add Image Source</h3>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="p-1 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleAddSource} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Source Name *</label>
                  <input
                    type="text"
                    value={newSource.name}
                    onChange={(e) => setNewSource({ ...newSource, name: e.target.value })}
                    placeholder="My NAS Photos"
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-gold"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Path *</label>
                  <input
                    type="text"
                    value={newSource.path}
                    onChange={(e) => setNewSource({ ...newSource, path: e.target.value })}
                    placeholder="/mnt/nas/photos or ./public/photos"
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-gold"
                  />
                  <p className="text-xs text-gray-600 mt-1">
                    Local path, NAS mount point, or relative path
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Default Category</label>
                  <input
                    type="text"
                    value={newSource.defaultCategory}
                    onChange={(e) => setNewSource({ ...newSource, defaultCategory: e.target.value })}
                    placeholder="General"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-gold"
                  />
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newSource.useFolderAsCategory}
                      onChange={(e) => setNewSource({ ...newSource, useFolderAsCategory: e.target.checked })}
                      className="w-4 h-4 rounded border-white/20 bg-white/5 text-gold focus:ring-gold"
                    />
                    <span className="text-sm text-gray-400">Use folders as categories</span>
                  </label>
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newSource.watch}
                      onChange={(e) => setNewSource({ ...newSource, watch: e.target.checked })}
                      className="w-4 h-4 rounded border-white/20 bg-white/5 text-gold focus:ring-gold"
                    />
                    <span className="text-sm text-gray-400">Watch for file changes</span>
                  </label>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isAdding || !newSource.name || !newSource.path}
                    className="flex-1 px-4 py-2 bg-gold text-obsidian rounded-lg hover:bg-gold/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isAdding ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" />
                        Adding...
                      </>
                    ) : (
                      <>
                        <Plus size={16} />
                        Add Source
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Usage Instructions */}
        <div className="bg-white/5 rounded-lg p-4 text-sm text-gray-500 overflow-hidden">
          <h4 className="text-xs uppercase tracking-wider text-gray-400 mb-2">Supported Paths</h4>
          <ul className="space-y-1 text-xs">
            <li>• <code className="text-gold">./public/photos</code> - Relative path from server</li>
            <li>• <code className="text-gold">/home/user/photos</code> - Absolute local path</li>
            <li>• <code className="text-gold">/mnt/nas/photos</code> - NAS/Network mount point</li>
            <li>• <code className="text-gold">/Volumes/MyDrive/photos</code> - External drive (macOS)</li>
          </ul>
          <p className="mt-3 text-xs text-gray-600">
            Tip: Create subfolders to organize photos by category. Each subfolder becomes a category automatically.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
