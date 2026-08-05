import React, { useEffect, useState } from 'react';
import { X, Plus, Trash2, FolderOpen, RefreshCw, HardDrive, Eye, Search, Upload, FolderPlus, Images } from 'lucide-react';
import { galleryApi, ImageSource, GalleryStats } from '../services/galleryApi';

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
  isResetting?: boolean;
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
  isResetting = false,
  onClose,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [scanningSource, setScanningSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadCategories, setUploadCategories] = useState<string[]>([]);
  const [uploadCategory, setUploadCategory] = useState('General');
  const [newCategory, setNewCategory] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const loadUploadCategories = async () => {
    try {
      const categories = await galleryApi.getUploadCategories();
      setUploadCategories(categories);
      if (categories.length > 0 && !categories.includes(uploadCategory)) {
        setUploadCategory(categories[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load upload categories');
    }
  };

  useEffect(() => {
    void loadUploadCategories();
  }, []);

  const handleCreateCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newCategory.trim()) return;
    setIsCreatingCategory(true);
    setError(null);
    try {
      const result = await galleryApi.createUploadCategory(newCategory);
      setUploadCategory(result.name);
      setNewCategory('');
      await loadUploadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create category');
    } finally {
      setIsCreatingCategory(false);
    }
  };

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedFiles.length || !uploadCategory.trim()) return;
    setIsUploading(true);
    setError(null);
    setUploadMessage(null);
    try {
      const result = await galleryApi.uploadImages(uploadCategory, selectedFiles);
      setUploadMessage(result.indexed
        ? `已原图上传 ${result.count} 张图片到“${result.category}”`
        : `原图已安全保存，但图库索引暂未更新，请稍后点击“刷新全部”：${result.warning}`);
      setSelectedFiles([]);
      setFileInputKey(key => key + 1);
      await Promise.allSettled([loadUploadCategories(), onRefresh()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

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

        {/* Authenticated upload manager */}
        <div className="mb-6 rounded-xl border border-gold/20 bg-gold/5 p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <Upload size={18} className="text-gold" />
            <h3 className="font-medium text-white">上传图片</h3>
            <span className="text-xs text-gray-500">原图直传，不压缩、不转码</span>
          </div>

          <form onSubmit={handleCreateCategory} className="mb-4 flex flex-col gap-2 sm:flex-row">
            <input
              value={newCategory}
              onChange={event => setNewCategory(event.target.value)}
              placeholder="新建分类，例如：2026 夏天"
              maxLength={80}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-gold"
            />
            <button
              type="submit"
              disabled={isCreatingCategory || !newCategory.trim()}
              className="flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/15 disabled:opacity-50"
            >
              <FolderPlus size={16} />
              {isCreatingCategory ? '创建中…' : '创建分类'}
            </button>
          </form>

          <form onSubmit={handleUpload} className="grid gap-3 md:grid-cols-[minmax(160px,0.35fr)_1fr_auto] md:items-end">
            <label className="block">
              <span className="mb-1 block text-xs text-gray-400">上传到分类</span>
              <input
                list="upload-category-options"
                value={uploadCategory}
                onChange={event => setUploadCategory(event.target.value)}
                maxLength={80}
                required
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-gold"
              />
              <datalist id="upload-category-options">
                {uploadCategories.map(category => <option key={category} value={category} />)}
              </datalist>
            </label>

            <label className="block min-w-0">
              <span className="mb-1 block text-xs text-gray-400">选择原图（不限单张大小，一次最多 20 张）</span>
              <span className="flex min-h-[38px] cursor-pointer items-center gap-2 rounded-lg border border-dashed border-white/20 bg-black/20 px-3 py-2 text-sm text-gray-300 hover:border-gold/60">
                <Images size={16} className="shrink-0 text-gold" />
                <span className="truncate">{selectedFiles.length ? `已选择 ${selectedFiles.length} 张` : '从相册、相机或电脑选择'}</span>
              </span>
              <input
                key={fileInputKey}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
                multiple
                className="sr-only"
                onChange={event => setSelectedFiles(Array.from(event.target.files || []).slice(0, 20))}
              />
            </label>

            <button
              type="submit"
              disabled={isUploading || !selectedFiles.length || !uploadCategory.trim()}
              className="flex items-center justify-center gap-2 rounded-lg bg-gold px-5 py-2 text-sm font-medium text-obsidian transition-colors hover:bg-gold/90 disabled:opacity-50"
            >
              <Upload size={16} />
              {isUploading ? '上传中…' : '开始上传'}
            </button>
          </form>
          {uploadMessage && <p className="mt-3 text-sm text-green-400">{uploadMessage}</p>}
        </div>

        {/* Sources List */}
        <div className="space-y-3 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              Configured Sources
            </h3>
            <div className="grid grid-cols-2 sm:flex gap-2">
              <button
                onClick={() => onRefresh()}
                disabled={isRefreshing || isResetting}
                className="px-3 py-2 sm:py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                title="Reload photos from sources"
              >
                <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                Refresh All
              </button>
              {onReset && (
                <button
                  onClick={() => onReset()}
                  disabled={isRefreshing || isResetting}
                  className="px-3 py-2 sm:py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50 border border-red-500/30"
                  title="Clear all cache and rebuild thumbnails"
                >
                  <RefreshCw size={14} className={isResetting ? 'animate-spin' : ''} />
                  {isResetting ? 'Resetting...' : 'Reset Cache'}
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
