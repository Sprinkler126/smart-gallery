import React, { useState, useMemo, useEffect } from 'react';
import { useGallery } from './hooks/useGallery';
import { Photo, ViewMode } from './types';
import ProtectedImage from './components/ProtectedImage';
import Lightbox from './components/Lightbox';
import TimelineView from './components/TimelineView';
import AdminPanel from './components/AdminPanel';
import AIAnalysisPanel from './components/AIAnalysisPanel';
import CreativePanel from './components/CreativePanel';
import ExifFramePanel from './components/ExifFramePanel';
import Slideshow from './components/Slideshow';
import { adminFetch } from './services/adminAuth';
import { Grid, LayoutTemplate, Search, ChevronDown, Camera, Instagram, Mail, Clock, Settings, RefreshCw, Wifi, WifiOff, Loader2, Play, Check, Square, Trash2, X, Brain, Sparkles } from 'lucide-react';

// 检测是否为本地访问（只有本地才能看到管理入口）
const isLocalAccess = (): boolean => {
  const hostname = window.location.hostname;
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('172.16.') ||
    hostname.startsWith('172.17.') ||
    hostname.startsWith('172.18.') ||
    hostname.startsWith('172.19.') ||
    hostname.startsWith('172.2') ||
    hostname.startsWith('172.30.') ||
    hostname.startsWith('172.31.')
  );
};

const App: React.FC = () => {
  // 全局图片保护：禁用右键、拖拽、选择
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // 只保护图片区域，其他区域（如按钮）允许右键
      const target = e.target as HTMLElement;
      if (target.tagName === 'IMG' || target.closest('.protected-image')) {
        e.preventDefault();
      }
    };
    
    const handleDragStart = (e: DragEvent) => {
      e.preventDefault();
    };
    
    const handleSelectStart = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'IMG') {
        e.preventDefault();
      }
    };
    
    // 禁用保存快捷键
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S / Cmd+S
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('selectstart', handleSelectStart);
    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('dragstart', handleDragStart);
      document.removeEventListener('selectstart', handleSelectStart);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Use the gallery hook for API integration
  const {
    photos,
    categories,
    sources,
    stats,
    config,
    isLoading,
    isRefreshing,
    error,
    isApiAvailable,
    isConnected,
    refresh,
    filterByCategory,
    currentCategory,
    filteredPhotos,
    addSource,
    removeSource,
    scanSource,
    searchQuery,
    searchMode,
    isSearching,
    searchResults,
    setSearchQuery,
    setSearchMode,
    performSearch,
    clearSearch,
  } = useGallery({
    enableRealtime: true,
    autoRefresh: false,
  });

  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.MASONRY);
  const [showAdmin, setShowAdmin] = useState(false);
  
  // Multi-select state
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  
  // Slideshow state
  const [showSlideshow, setShowSlideshow] = useState(false);
  const [slideshowIndex, setSlideshowIndex] = useState(0);
  
  // AI Analysis state
  const [showAIAnalysis, setShowAIAnalysis] = useState(false);
  const [aiAnalysisPhoto, setAiAnalysisPhoto] = useState<Photo | undefined>(undefined);
  const [showCreativePanel, setShowCreativePanel] = useState(false);
  const [exifFramePhoto, setExifFramePhoto] = useState<Photo | undefined>(undefined);
  
  // Mobile overlay state - for touch devices
  const [mobileOverlayPhotoId, setMobileOverlayPhotoId] = useState<string | null>(null);
  
  // Hero section state
  const [heroIndex, setHeroIndex] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [heroPhotos, setHeroPhotos] = useState<Photo[]>([]);
  
  // 首页空闲检测 - 10秒无操作自动进入幻灯片
  const [homeIdleSeconds, setHomeIdleSeconds] = useState(0);
  const [idlePaused, setIdlePaused] = useState(false);

  // 是否显示管理功能（只有本地访问才显示）
  const showAdminFeatures = isLocalAccess() && isApiAvailable;

  // Get app name and photographer name from config or fallback
  const appName = config?.appName || 'SPRINKLER';
  const photographerName = config?.photographerName || 'Sprinkler';

  // 获取横图用于首页 Hero 展示
  useEffect(() => {
    if (photos.length === 0) return;
    
    const fetchOrientations = async () => {
      try {
        const res = await fetch('/photowall/api/orientations');
        const data = await res.json();
        if (!data.success) return;
        
        const orientations = data.orientations as Record<string, 'landscape' | 'portrait' | 'square'>;
        // 只选横图（landscape 或 square）
        const landscapePhotos = photos.filter(p => {
          const o = orientations[p.id];
          return o === 'landscape' || o === 'square';
        });
        
        // 如果没有横图，fallback 到所有照片
        const pool = landscapePhotos.length > 0 ? landscapePhotos : photos;
        
        // 随机打乱取前 5 张
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        setHeroPhotos(shuffled.slice(0, Math.min(5, shuffled.length)));
        setHeroIndex(0);
      } catch {
        // fallback: 用所有照片
        setHeroPhotos(photos.slice(0, 5));
      }
    };
    
    fetchOrientations();
  }, [photos]);

  // Hero Image Auto-Rotation - 12秒切换一次
  useEffect(() => {
    if (heroPhotos.length === 0) return;
    const interval = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % heroPhotos.length);
    }, 12000);
    return () => clearInterval(interval);
  }, [heroPhotos.length]);

  // Scroll detection
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
  // ================================================================
  // 首页空闲检测 - 10秒无操作自动进入幻灯片
  // 注意：大图预览(Lightbox)打开时不触发自动幻灯片
  // ================================================================
  useEffect(() => {
    // 如果已经在幻灯片模式，或打开了 Lightbox，不执行空闲检测
    if (showSlideshow || selectedPhotoIndex !== null) return;
    
    const IDLE_THRESHOLD = 10; // 10秒
    
    const interval = setInterval(() => {
      if (idlePaused || photos.length === 0) return;
      
      setHomeIdleSeconds((prev) => {
        const next = prev + 1;
        if (next >= IDLE_THRESHOLD) {
          // 达到阈值，自动进入幻灯片
          setSlideshowIndex(0);
          setShowSlideshow(true);
          return 0;
        }
        return next;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [showSlideshow, idlePaused, photos.length, selectedPhotoIndex]);
  
  // 用户操作时重置首页空闲计时
  useEffect(() => {
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    const handler = () => setHomeIdleSeconds(0);
    
    events.forEach((e) => window.addEventListener(e, handler));
    return () => events.forEach((e) => window.removeEventListener(e, handler));
  }, []);

  const handleNext = () => {
    if (selectedPhotoIndex === null) return;
    if (selectedPhotoIndex < filteredPhotos.length - 1) {
      setSelectedPhotoIndex(selectedPhotoIndex + 1);
    }
  };

  const handlePrev = () => {
    if (selectedPhotoIndex === null) return;
    if (selectedPhotoIndex > 0) {
      setSelectedPhotoIndex(selectedPhotoIndex - 1);
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    try {
      const response = await adminFetch(`/photowall/api/photo/${photoId}`, {
        method: 'DELETE',
      });
      
      const result = await response.json();
      
      if (result.success) {
        await refresh();
        console.log('✅ Photo deleted successfully');
      } else {
        console.error('Failed to delete photo:', result.error);
        alert('Failed to delete photo: ' + result.error);
      }
    } catch (error) {
      console.error('Error deleting photo:', error);
      alert('Error deleting photo: ' + (error as Error).message);
    }
  };

  const handleReset = async () => {
    if (!confirm('⚠️ Reset Gallery?\n\nThis will:\n1. Delete ALL cached thumbnails\n2. Rebuild thumbnails from scratch\n\nThis may take a while if you have many photos.\n\nContinue?')) {
      return;
    }

    try {
      console.log('🔄 Starting reset...');
      
      const response = await adminFetch('/photowall/api/reset', {
        method: 'POST',
      });
      
      const result = await response.json();
      
      if (result.success) {
        console.log('✅ Reset completed:', result.data);
        alert(`✅ Reset Completed!\n\nCleared ${result.data.cacheCleared} cached thumbnails\nRebuilt ${result.data.totalPhotos} photos\n\nCache size: ${result.data.cacheSizeBefore}MB → 0MB`);
      } else {
        console.error('Reset failed:', result.error);
        alert('Reset failed: ' + result.error);
      }
    } catch (error) {
      console.error('Error resetting gallery:', error);
      alert('Error resetting gallery: ' + (error as Error).message);
    }
  };

  // Multi-select handlers
  const toggleMultiSelectMode = () => {
    setIsMultiSelectMode(!isMultiSelectMode);
    if (!isMultiSelectMode) {
      setSelectedPhotos(new Set());
    }
  };

  const togglePhotoSelection = (photoId: string) => {
    setSelectedPhotos((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(photoId)) {
        newSet.delete(photoId);
      } else {
        newSet.add(photoId);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    setSelectedPhotos(new Set(filteredPhotos.map((p) => p.id)));
  };

  const deselectAll = () => {
    setSelectedPhotos(new Set());
  };

  const handleMultiDelete = async () => {
    if (selectedPhotos.size === 0) return;
    
    const confirmed = confirm(
      `⚠️ Delete ${selectedPhotos.size} photos?\n\nThis will permanently delete these photos and their thumbnails. This action cannot be undone.`
    );
    
    if (!confirmed) return;

    const idsToDelete = Array.from(selectedPhotos);
    let successCount = 0;
    let failCount = 0;

    for (const photoId of idsToDelete) {
      try {
        const response = await adminFetch(`/photowall/api/photo/${photoId}`, {
          method: 'DELETE',
        });
        const result = await response.json();
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        console.error('Error deleting photo:', photoId, error);
        failCount++;
      }
    }

    await refresh();
    setSelectedPhotos(new Set());
    setIsMultiSelectMode(false);
    
    if (failCount > 0) {
      alert(`✅ Deleted ${successCount} photos\n❌ Failed to delete ${failCount} photos`);
    } else {
      alert(`✅ Successfully deleted ${successCount} photos`);
    }
  };

  const openSlideshow = (startIndex: number = 0) => {
    setSlideshowIndex(startIndex);
    setShowSlideshow(true);
  };

  const scrollToGallery = () => {
    document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleCategoryClick = (cat: string) => {
    filterByCategory(cat);
    scrollToGallery();
  };

  const currentHeroPhoto = heroPhotos[heroIndex];

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-obsidian text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={48} className="animate-spin text-gold" />
          <p className="text-gray-400">Loading gallery...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-obsidian text-white flex flex-col font-sans overflow-x-hidden">
      
      {/* Connection Status Indicator - 只在本地显示 */}
      {showAdminFeatures && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs transition-all ${
          isConnected 
            ? 'bg-green-500/20 text-green-400' 
            : 'bg-yellow-500/20 text-yellow-400'
        }`}>
          {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
          <span className="hidden sm:inline">
            {isConnected ? 'Live' : 'API Only'}
          </span>
        </div>
      )}

      {/* 1. Full Screen Hero Section */}
      <section className="relative h-[100svh] min-h-[560px] md:h-screen w-full overflow-hidden flex items-center justify-center">
        
        {/* Dynamic Frosted Background */}
        <div className="absolute inset-0 z-0">
          {heroPhotos.map((photo, index) => (
            <div 
              key={photo.id}
              className={`absolute inset-0 bg-cover bg-center transition-opacity duration-[2000ms] ease-in-out blur-3xl scale-110 opacity-60 ${
                index === heroIndex ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ backgroundImage: `url(${photo.thumbnail || photo.url})` }}
            />
          ))}
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-obsidian/20 to-obsidian" />
        </div>

        {/* Hero Content */}
        <div className="relative z-10 flex flex-col items-center justify-center w-full h-full px-3 sm:px-4 py-16 sm:py-20 text-center">
           
           {/* Glass Card Container for Main Image */}
           <div className="glass-card p-2.5 sm:p-4 rounded-xl shadow-2xl animate-fade-in transform hover:scale-[1.01] transition-transform duration-700 max-w-4xl w-full mb-5 sm:mb-8">
              <div className="relative aspect-[16/9] md:aspect-[21/9] w-full overflow-hidden rounded-lg bg-black/50">
                 {/* Carousel Images - 使用原图 */}
                 {heroPhotos.map((photo, index) => (
                    <img 
                      key={photo.id}
                      src={photo.url}
                      alt={photo.title}
                      className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-[1500ms] ${
                        index === heroIndex ? 'opacity-100' : 'opacity-0'
                      }`}
                      draggable={false}
                    />
                 ))}
                 
                 {/* Overlay Text inside image - 只显示分类 */}
                 <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-8 bg-gradient-to-t from-black/80 to-transparent text-left">
                    {currentHeroPhoto && (
                      <p className="text-gold text-xs sm:text-sm uppercase tracking-widest animate-fade-in-slow">
                        {currentHeroPhoto.category}
                      </p>
                    )}
                 </div>
              </div>
           </div>

           {/* Branding */}
           <div className="animate-slide-up mb-8 max-w-full">
             <h1 className="text-4xl sm:text-5xl md:text-7xl font-serif text-white tracking-tight md:tracking-tighter mb-2 break-words">
               {appName}
             </h1>
             <p className="text-xs sm:text-sm md:text-base text-gray-300 tracking-[0.18em] sm:tracking-[0.3em] font-light uppercase leading-relaxed max-w-full">
               Photography by {photographerName}
             </p>
           </div>

           {/* Scroll Down Indicator - 固定在底部 */}
           <button 
             onClick={scrollToGallery}
             className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-pulse-slow text-white/50 hover:text-white transition-colors z-20"
           >
             <div className="flex flex-col items-center gap-2">
               <span className="text-[10px] uppercase tracking-widest">Explore Gallery</span>
               <ChevronDown size={24} />
             </div>
           </button>
           
           {/* 空闲倒计时提示 - 自动播放幻灯片 */}
           {homeIdleSeconds > 0 && !showSlideshow && (
             <div className="absolute bottom-24 left-1/2 transform -translate-x-1/2 z-20 w-[calc(100%-2rem)] max-w-sm">
               <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-full text-white/70 text-xs sm:text-sm flex items-center justify-center gap-2 animate-fade-in">
                 <Play size={14} className="text-yellow-400" />
                 <span>
                   {homeIdleSeconds < 10 
                     ? `${10 - homeIdleSeconds}秒后自动播放幻灯片` 
                     : '即将开始...'}
                 </span>
               </div>
             </div>
           )}
        </div>
      </section>

      {/* 2. Navigation / Sticky Header */}
      <header className={`sticky top-0 z-40 transition-all duration-300 border-b border-white/5 ${
        scrolled ? 'bg-obsidian/90 backdrop-blur-md py-2 shadow-lg' : 'bg-obsidian py-4'
      }`}>
        <div className="max-w-7xl mx-auto px-3 md:px-6 flex items-center justify-between gap-2">
          <div className={`hidden sm:flex flex-col min-w-0 transition-all duration-300 ${scrolled ? 'opacity-100' : 'opacity-0 lg:opacity-100'}`}>
             {scrolled && <span className="font-serif text-lg tracking-tight">{appName}</span>}
          </div>

          <div className="flex flex-1 sm:flex-none flex-wrap sm:flex-nowrap items-center justify-end gap-2 md:gap-4 min-w-0">
            {/* Search Box - 移动端简化 */}
            <div className="flex basis-full sm:basis-auto flex-1 sm:flex-none items-center gap-1 md:gap-2 bg-white/5 rounded-lg px-2 md:px-3 py-2 sm:py-1.5 min-w-0">
              <Search size={16} className="text-gray-500 flex-shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && performSearch()}
                placeholder="搜索..."
                className="bg-transparent border-none outline-none text-[16px] sm:text-sm text-white placeholder-gray-500 w-16 sm:w-28 md:w-48 min-w-0"
              />
              {searchQuery && (
                <button
                  onClick={clearSearch}
                  className="text-gray-500 hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
              {/* Search Mode Toggle - 桌面端显示 */}
              <button
                onClick={() => setSearchMode(searchMode === 'fuzzy' ? 'semantic' : 'fuzzy')}
                className={`hidden md:inline-block text-xs px-2 py-0.5 rounded border transition-colors ${
                  searchMode === 'semantic'
                    ? 'border-gold text-gold'
                    : 'border-gray-600 text-gray-500 hover:border-gray-400'
                }`}
                title={searchMode === 'fuzzy' ? '模糊搜索 - 点击切换标签搜索' : '标签搜索 - 点击切换模糊搜索'}
              >
                {searchMode === 'fuzzy' ? '模糊' : '标签'}
              </button>
              <button
                onClick={performSearch}
                disabled={isSearching || !searchQuery.trim()}
                className="p-2.5 sm:p-1.5 rounded bg-gold/20 text-gold hover:bg-gold/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSearching ? <Loader2 size={16} className="animate-spin sm:w-3.5 sm:h-3.5" /> : <Search size={16} className="sm:w-3.5 sm:h-3.5" />}
              </button>
            </div>

            {/* View Mode Toggle + Slideshow */}
            <div className="flex flex-shrink-0 gap-1 bg-white/5 p-1 rounded-lg">
              <button 
                onClick={() => setViewMode(ViewMode.GRID)}
                className={`p-2.5 sm:p-2 rounded-md transition-all ${viewMode === ViewMode.GRID ? 'bg-charcoal text-gold shadow-sm' : 'text-gray-500 hover:text-white'}`}
                title="Grid View"
              >
                <Grid size={16} className="md:w-[18px] md:h-[18px]" />
              </button>
              <button 
                onClick={() => setViewMode(ViewMode.MASONRY)}
                className={`p-2.5 sm:p-2 rounded-md transition-all ${viewMode === ViewMode.MASONRY ? 'bg-charcoal text-gold shadow-sm' : 'text-gray-500 hover:text-white'}`}
                title="Masonry View"
              >
                <LayoutTemplate size={16} className="md:w-[18px] md:h-[18px]" />
              </button>
              <button 
                onClick={() => setViewMode(ViewMode.TIMELINE)}
                className={`p-2.5 sm:p-2 rounded-md transition-all ${viewMode === ViewMode.TIMELINE ? 'bg-charcoal text-gold shadow-sm' : 'text-gray-500 hover:text-white'}`}
                title="Timeline View"
              >
                <Clock size={16} className="md:w-[18px] md:h-[18px]" />
              </button>
              {/* Slideshow Button */}
              <button
                onClick={() => openSlideshow(0)}
                className="p-2.5 sm:p-2 rounded-md bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gold transition-all border-l border-white/10 ml-1"
                title="Start Slideshow"
              >
                <Play size={16} className="md:w-[18px] md:h-[18px]" />
              </button>
            </div>

            {/* Refresh & Reset Buttons - 只在本地显示 */}
            {showAdminFeatures && (
              <div className="hidden md:flex items-center gap-2">
                <button
                  onClick={() => setShowCreativePanel(true)}
                  className="p-2 rounded-md bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gold transition-all"
                  title="Creative Tools"
                >
                  <Sparkles size={18} />
                </button>

                {/* AI Analysis Button */}
                <button
                  onClick={() => {
                    setAiAnalysisPhoto(undefined);
                    setShowAIAnalysis(true);
                  }}
                  className="p-2 rounded-md bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gold transition-all"
                  title="AI Analysis"
                >
                  <Brain size={18} />
                </button>

                {/* Multi-select Toggle */}
                <button
                  onClick={toggleMultiSelectMode}
                  className={`p-2 rounded-md transition-all ${
                    isMultiSelectMode 
                      ? 'bg-gold text-obsidian' 
                      : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white'
                  }`}
                  title="Multi-select mode"
                >
                  {isMultiSelectMode ? <X size={18} /> : <Check size={18} />}
                </button>

                {/* Refresh Button */}
                <button
                  onClick={() => refresh()}
                  disabled={isRefreshing}
                  className={`p-2 rounded-md bg-white/5 hover:bg-white/10 transition-all ${isRefreshing ? 'opacity-50' : ''}`}
                  title="Refresh Gallery (reload photos)"
                >
                  <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
                </button>

                {/* Admin Panel Toggle */}
                <button
                  onClick={() => setShowAdmin(!showAdmin)}
                  className={`p-2 rounded-md transition-all ${showAdmin ? 'bg-gold text-obsidian' : 'bg-white/5 hover:bg-white/10 text-gray-400'}`}
                  title="Admin Panel"
                >
                  <Settings size={18} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Categories Navigation */}
        <div className="border-t border-white/5 bg-black/20">
          <div className="max-w-7xl mx-auto px-3 md:px-6 py-3">
            {/* 桌面端：横排按钮 */}
            <div className="hidden md:flex flex-wrap items-center gap-x-8 gap-y-2">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => handleCategoryClick(cat)}
                  className={`text-sm font-medium transition-colors relative py-1 ${
                    currentCategory === cat ? 'text-gold' : 'text-gray-500 hover:text-white'
                  }`}
                >
                  {cat}
                  {stats?.categories && cat !== 'All' && (
                    <span className="ml-1 text-xs text-gray-600">
                      ({stats.categories[cat] || 0})
                    </span>
                  )}
                  {currentCategory === cat && <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-gold" />}
                </button>
              ))}
            </div>
            {/* 移动端：下拉选择器 */}
            <div className="md:hidden relative">
              <button
                onClick={() => {
                  const el = document.getElementById('mobile-cat-dropdown');
                  if (el) el.classList.toggle('hidden');
                }}
                className="flex items-center gap-2 text-sm font-medium text-gold bg-white/5 rounded-lg px-3 py-2 w-full"
              >
                <span className="truncate">{currentCategory}</span>
                {stats?.categories && currentCategory !== 'All' && (
                  <span className="text-xs text-gray-500">({stats.categories[currentCategory] || 0})</span>
                )}
                <ChevronDown size={14} className="ml-auto text-gray-500 flex-shrink-0" />
              </button>
              <div
                id="mobile-cat-dropdown"
                className="hidden absolute top-full left-0 right-0 mt-1 bg-charcoal/95 backdrop-blur-md border border-white/10 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto"
              >
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => {
                      handleCategoryClick(cat);
                      document.getElementById('mobile-cat-dropdown')?.classList.add('hidden');
                    }}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                      currentCategory === cat
                        ? 'text-gold bg-gold/10'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <span>{cat}</span>
                    {stats?.categories && cat !== 'All' && (
                      <span className="text-xs text-gray-600">{stats.categories[cat] || 0}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Admin Panel - 只在本地显示 */}
      {showAdmin && showAdminFeatures && (
        <AdminPanel
          sources={sources}
          stats={stats}
          onAddSource={addSource}
          onRemoveSource={removeSource}
          onScanSource={scanSource}
          onRefresh={refresh}
          onReset={handleReset}
          isRefreshing={isRefreshing}
          onClose={() => setShowAdmin(false)}
        />
      )}

      {/* 3. Main Gallery Grid */}
      <main id="gallery" className="flex-grow p-3 sm:p-4 md:p-6 lg:p-12 max-w-7xl mx-auto w-full min-h-[50vh]">
        {error && (
          <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {filteredPhotos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-600">
            <Search size={48} strokeWidth={1} className="mb-4 opacity-50"/>
            {searchResults !== null ? (
              <>
                <p>没有找到匹配 "{searchQuery}" 的照片</p>
                <p className="text-sm text-gray-500 mt-2">
                  当前模式: {searchMode === 'fuzzy' ? '模糊搜索' : '语义搜索'}
                </p>
                <button 
                  onClick={clearSearch}
                  className="mt-4 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm transition-colors"
                >
                  清除搜索
                </button>
              </>
            ) : (
              <>
                <p>No photos found in this category.</p>
                {showAdminFeatures && (
                  <button 
                    onClick={() => refresh()}
                    className="mt-4 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm transition-colors"
                  >
                    Refresh Gallery
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {viewMode === ViewMode.TIMELINE ? (
              <TimelineView 
                photos={filteredPhotos} 
                onPhotoClick={(photo, index) => setSelectedPhotoIndex(filteredPhotos.indexOf(photo))}
              />
            ) : (
              <div className={viewMode === ViewMode.MASONRY ? 'columns-1 sm:columns-2 lg:columns-3 gap-3 md:gap-6 space-y-3 md:space-y-6' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6'}>
                {filteredPhotos.map((photo, index) => (
                  <div 
                    key={photo.id} 
                    className={`break-inside-avoid relative group cursor-pointer rounded-md sm:rounded-sm overflow-hidden bg-charcoal shadow-lg transition-transform duration-500 hover:-translate-y-1 ${viewMode === ViewMode.MASONRY ? 'mb-3 md:mb-6' : ''} ${
                      selectedPhotos.has(photo.id) ? 'ring-2 ring-gold ring-offset-2 ring-offset-obsidian' : ''
                    }`}
                    onClick={(e) => {
                      // 移动端：第一次点击显示overlay，第二次点击打开lightbox
                      const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
                      if (isMobile && !isMultiSelectMode) {
                        if (mobileOverlayPhotoId !== photo.id) {
                          e.preventDefault();
                          setMobileOverlayPhotoId(photo.id);
                          return;
                        }
                        setMobileOverlayPhotoId(null);
                      }
                      if (isMultiSelectMode) {
                        togglePhotoSelection(photo.id);
                      } else {
                        setSelectedPhotoIndex(index);
                      }
                    }}
                    onMouseLeave={() => {
                      // 鼠标离开时清除移动端overlay
                      if (mobileOverlayPhotoId === photo.id) {
                        setMobileOverlayPhotoId(null);
                      }
                    }}
                  >
                    {/* Multi-select Checkbox */}
                    {isMultiSelectMode && (
                      <div 
                        className="absolute top-3 left-3 z-20"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePhotoSelection(photo.id);
                        }}
                      >
                        <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all ${
                          selectedPhotos.has(photo.id)
                            ? 'bg-gold border-gold'
                            : 'border-white/50 bg-black/30 hover:border-white'
                        }`}>
                          {selectedPhotos.has(photo.id) && <Check size={14} className="text-obsidian" />}
                        </div>
                      </div>
                    )}
                    
                    <ProtectedImage 
                      src={photo.thumbnail || photo.url} 
                      blurPlaceholder={photo.blurPlaceholder}
                      alt={photo.title}
                      aspectRatio={photo.dimensions ? `${photo.dimensions.width}/${photo.dimensions.height}` : undefined}
                      onClick={() => {
                        if (isMultiSelectMode) {
                          togglePhotoSelection(photo.id);
                        } else {
                          setSelectedPhotoIndex(index);
                        }
                      }}
                    />
                    
                    {/* Hover/Tap Overlay Info */}
                    <div 
                      className={`absolute inset-0 bg-black/40 transition-opacity duration-300 flex flex-col justify-end p-4 md:p-6 pointer-events-none backdrop-blur-[2px] ${
                        mobileOverlayPhotoId === photo.id 
                          ? 'opacity-100' 
                          : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <div className={`transform transition-transform duration-300 ${
                        mobileOverlayPhotoId === photo.id 
                          ? 'translate-y-0' 
                          : 'translate-y-4 group-hover:translate-y-0'
                      }`}>
                        <div className="flex justify-between items-end gap-3">
                           <div className="min-w-0">
                            <span className="inline-block px-2 py-1 bg-gold/90 text-obsidian text-[10px] font-bold uppercase tracking-widest mb-2 rounded-sm">
                              {photo.category}
                            </span>
                            <h3 className="text-lg md:text-xl font-serif text-white truncate">{photo.title}</h3>
                            <p className="text-xs text-gray-300 mt-1 truncate">{photo.location}</p>
                           </div>
                           <div className="text-white/60 text-xs flex flex-col items-end flex-shrink-0">
                              <span>{photo.date.split('-')[0]}</span>
                              <span className="text-[10px] opacity-70">{photo.date.substring(5)}</span>
                           </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Multi-select Action Bar */}
      {isMultiSelectMode && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-charcoal/95 backdrop-blur-md border-t border-white/10 px-4 sm:px-6 py-3 sm:py-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-4">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex items-center justify-between sm:justify-start gap-4">
              <span className="text-white font-medium">
                {selectedPhotos.size} selected
              </span>
              <button
                onClick={selectAll}
                className="text-sm text-gold hover:text-gold/80 transition-colors"
              >
                Select All
              </button>
              <button
                onClick={deselectAll}
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Deselect All
              </button>
            </div>
            
            <div className="flex items-center justify-end gap-2 sm:gap-3">
              <button
                onClick={() => {
                  setIsMultiSelectMode(false);
                  setSelectedPhotos(new Set());
                }}
                className="px-3 sm:px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleMultiDelete}
                disabled={selectedPhotos.size === 0}
                className="px-3 sm:px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center gap-2 text-sm sm:text-base"
              >
                <Trash2 size={18} />
                <span className="hidden sm:inline">Delete Selected</span>
                <span className="sm:hidden">Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-white/5 bg-charcoal py-12 md:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-10 md:gap-12">
          
          <div className="text-center md:text-left space-y-4">
            <h2 className="text-2xl font-serif text-white">{appName}</h2>
            <p className="text-sm text-gray-500 max-w-xs leading-relaxed">
              Capturing moments of silence, chaos, and beauty in between. A visual journey by {photographerName}.
            </p>
            <div className="flex gap-4 justify-center md:justify-start pt-2">
               <button className="p-2 bg-white/5 rounded-full hover:bg-gold hover:text-obsidian transition-colors"><Instagram size={18}/></button>
               <button className="p-2 bg-white/5 rounded-full hover:bg-gold hover:text-obsidian transition-colors"><Mail size={18}/></button>
               <button className="p-2 bg-white/5 rounded-full hover:bg-gold hover:text-obsidian transition-colors"><Camera size={18}/></button>
            </div>
          </div>

          <div className="text-[10px] text-gray-600 uppercase tracking-widest text-center md:text-right space-y-2">
            <p>© {new Date().getFullYear()} {photographerName}. All Rights Reserved.</p>
            {stats && (
              <p>{stats.totalPhotos} Photos</p>
            )}
          </div>
        </div>
      </footer>

      {/* Lightbox Modal */}
      {selectedPhotoIndex !== null && (
        <Lightbox
          photo={filteredPhotos[selectedPhotoIndex]}
          onClose={() => setSelectedPhotoIndex(null)}
          onNext={handleNext}
          onPrev={handlePrev}
          hasNext={selectedPhotoIndex < filteredPhotos.length - 1}
          hasPrev={selectedPhotoIndex > 0}
          onDelete={handleDeletePhoto}
          onAIAnalysis={() => {
            setAiAnalysisPhoto(filteredPhotos[selectedPhotoIndex]);
            setShowAIAnalysis(true);
          }}
          onExifFrame={showAdminFeatures ? () => {
            setExifFramePhoto(filteredPhotos[selectedPhotoIndex]);
          } : undefined}
        />
      )}

      {/* Slideshow Modal */}
      {showSlideshow && (
        <Slideshow
          photos={filteredPhotos}
          initialIndex={slideshowIndex}
          onClose={() => {
            setShowSlideshow(false);
            setHomeIdleSeconds(0); // 关闭幻灯片后重置空闲计时
          }}
        />
      )}

      {/* AI Analysis Panel */}
      {showAIAnalysis && (
        <AIAnalysisPanel
          photo={aiAnalysisPhoto}
          onClose={() => setShowAIAnalysis(false)}
        />
      )}

      {showCreativePanel && (
        <CreativePanel
          onClose={() => setShowCreativePanel(false)}
        />
      )}

      {exifFramePhoto && (
        <ExifFramePanel
          photo={exifFramePhoto}
          onClose={() => setExifFramePhoto(undefined)}
        />
      )}

    </div>
  );
};

export default App;
