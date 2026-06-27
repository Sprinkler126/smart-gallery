import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Info, MapPin, Camera, Aperture, ImageOff, ZoomIn, ZoomOut, Trash2, Brain, Wand2 } from 'lucide-react';
import { Photo } from '../types';

interface LightboxProps {
  photo: Photo;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
  onDelete?: (photoId: string) => void;
  onAIAnalysis?: () => void;
  onExifFrame?: () => void;
  onPixelStretch?: () => void;
}

const Lightbox: React.FC<LightboxProps> = ({ photo, onClose, onNext, onPrev, hasNext, hasPrev, onDelete, onAIAnalysis, onExifFrame, onPixelStretch }) => {
  const [showInfo, setShowInfo] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset state when photo changes
  useEffect(() => {
    setShowInfo(false);
    setImageLoaded(false);
    setImageError(false);
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }, [photo.id]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDeleteConfirm) {
          setShowDeleteConfirm(false);
        } else {
          onClose();
        }
      }
      if (e.key === 'ArrowRight' && hasNext) onNext();
      if (e.key === 'ArrowLeft' && hasPrev) onPrev();
      if (e.key === 'i') setShowInfo(!showInfo);
      if (e.key === '0' || e.key === '1') resetZoom();
      if (e.key === '+' || e.key === '=') zoomIn();
      if (e.key === '-') zoomOut();
      if (e.key === 'Delete' && onDelete) handleDeleteClick();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onNext, onPrev, hasNext, hasPrev, showInfo, showDeleteConfirm, onDelete, photo.id]);

  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageError(false);
  };

  const handleImageError = () => {
    setImageError(true);
    setImageLoaded(true);
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (onDelete) {
      await onDelete(photo.id);
      setShowDeleteConfirm(false);
      onClose();
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  // Zoom controls
  const zoomIn = () => setZoom(prev => Math.min(prev * 1.2, 5));
  const zoomOut = () => setZoom(prev => {
    const newZoom = Math.max(prev / 1.2, 1);
    return newZoom;
  });
  const resetZoom = () => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  };
  
  // ★ 方案 A: 当缩放从 >1 变为 1 时，自动平滑重置位置
  const prevZoomRef = useRef(zoom);
  useEffect(() => {
    // 从放大状态回到正常大小时，自动重置位置
    if (prevZoomRef.current > 1 && zoom === 1) {
      setPosition({ x: 0, y: 0 });
    }
    prevZoomRef.current = zoom;
  }, [zoom]);

  // Wheel zoom - use native event listener with passive: false
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(prev => {
        const newZoom = prev * delta;
        return Math.max(1, Math.min(newZoom, 5));
      });
    };

    // Key: { passive: false } allows preventDefault() to work
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || zoom <= 1) return;
    e.preventDefault();
    e.stopPropagation();
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  // ★ 方案 C: 双击快速重置，带平滑动画
  const [isResetting, setIsResetting] = useState(false);
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (zoom > 1 || position.x !== 0 || position.y !== 0) {
      setIsResetting(true);
      resetZoom();
      // 动画结束后清除状态
      setTimeout(() => setIsResetting(false), 300);
    }
  };

  // Touch support for mobile
  const [touchStartDist, setTouchStartDist] = useState<number | null>(null);
  const [touchStartZoom, setTouchStartZoom] = useState(1);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [isSwiping, setIsSwiping] = useState(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // 双指开始 - 收缩/放大
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      setTouchStartDist(dist);
      setTouchStartZoom(zoom);
      setIsSwiping(false);
    } else if (e.touches.length === 1 && zoom <= 1) {
      // 单指开始 - 可能是左右滑动
      setTouchStartX(e.touches[0].clientX);
      setTouchStartY(e.touches[0].clientY);
      setIsSwiping(false);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDist !== null) {
      // 双指缩放
      e.preventDefault();
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scale = dist / touchStartDist;
      setZoom(prev => Math.max(1, Math.min(touchStartZoom * scale, 5)));
    } else if (e.touches.length === 1 && touchStartX !== null && zoom <= 1) {
      // 单指滑动检测
      const deltaX = e.touches[0].clientX - touchStartX;
      const deltaY = e.touches[0].clientY - touchStartY;
      // 水平滑动距离 > 30px 且水平位移 > 垂直位移
      if (Math.abs(deltaX) > 30 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        setIsSwiping(true);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isSwiping && touchStartX !== null) {
      const endX = e.changedTouches[0].clientX;
      const deltaX = endX - touchStartX;
      if (deltaX > 80 && hasPrev) {
        onPrev();
      } else if (deltaX < -80 && hasNext) {
        onNext();
      }
    }
    setTouchStartDist(null);
    setTouchStartX(null);
    setTouchStartY(null);
    setIsSwiping(false);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-obsidian/95 backdrop-blur-md safe-screen"
      onClick={onClose}
    >
      
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div 
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={handleDeleteCancel}
        >
          <div 
            className="bg-charcoal border border-gray-700 rounded-lg p-6 max-w-md mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-semibold text-white mb-2">Delete Photo?</h3>
            <p className="text-gray-400 mb-6">
              This will permanently delete both the original image and thumbnail.
              <br />
              <span className="text-sm text-gray-500">This action cannot be undone.</span>
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleDeleteCancel}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors flex items-center gap-2"
              >
                <Trash2 size={18} />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <button 
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute top-4 right-4 md:top-6 md:right-6 z-50 p-3 md:p-2 text-gray-400 hover:text-white active:text-white transition-colors bg-black/30 hover:bg-black/50 rounded-full backdrop-blur-sm touch-manipulation"
        aria-label="Close"
      >
        <X size={28} className="md:w-6 md:h-6" />
      </button>

      {/* Delete Button */}
      {onDelete && (
        <button 
          onClick={(e) => { e.stopPropagation(); handleDeleteClick(); }}
          className="absolute top-4 left-4 md:top-6 md:left-6 z-50 p-3 md:p-2 text-gray-400 hover:text-red-400 active:text-red-400 transition-colors bg-black/30 hover:bg-black/50 rounded-full backdrop-blur-sm touch-manipulation"
          title="Delete photo (Delete key)"
        >
          <Trash2 size={24} />
        </button>
      )}

      {/* AI Analysis Button */}
      {onAIAnalysis && (
        <button 
          onClick={(e) => { e.stopPropagation(); onAIAnalysis(); }}
          className="absolute top-4 left-16 md:top-6 md:left-20 z-50 p-3 md:p-2 text-gray-400 hover:text-gold active:text-gold transition-colors bg-black/30 hover:bg-black/50 rounded-full backdrop-blur-sm touch-manipulation"
          title="AI Analysis"
        >
          <Brain size={24} />
        </button>
      )}

      {/* EXIF Frame Button */}
      {onExifFrame && (
        <button
          onClick={(e) => { e.stopPropagation(); onExifFrame(); }}
          className="absolute top-4 left-28 md:top-6 md:left-32 z-50 p-3 md:p-2 text-gray-400 hover:text-gold active:text-gold transition-colors bg-black/30 hover:bg-black/50 rounded-full backdrop-blur-sm touch-manipulation"
          title="EXIF Frame"
        >
          <Camera size={24} />
        </button>
      )}

      {/* Pixel Stretch Button */}
      {onPixelStretch && (
        <button
          onClick={(e) => { e.stopPropagation(); onPixelStretch(); }}
          className="absolute top-4 left-40 md:top-6 md:left-44 z-50 p-3 md:p-2 text-gray-400 hover:text-gold active:text-gold transition-colors bg-black/30 hover:bg-black/50 rounded-full backdrop-blur-sm touch-manipulation"
          title="Pixel Stretch"
          aria-label="Pixel Stretch"
        >
          <Wand2 size={24} />
        </button>
      )}

      {hasPrev && (
        <button 
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          className="absolute left-2 md:left-4 z-50 p-3 md:p-4 text-gray-400 hover:text-white active:text-white transition-colors hover:scale-110 touch-manipulation"
          aria-label="Previous photo"
        >
          <ChevronLeft size={48} strokeWidth={1} className="md:w-10 md:h-10" />
        </button>
      )}

      {hasNext && (
        <button 
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          className="absolute right-2 md:right-4 z-50 p-3 md:p-4 text-gray-400 hover:text-white active:text-white transition-colors hover:scale-110 touch-manipulation"
          aria-label="Next photo"
        >
          <ChevronRight size={48} strokeWidth={1} className="md:w-10 md:h-10" />
        </button>
      )}

      {/* Main Image Container */}
      <div 
        ref={containerRef}
        className="relative w-full h-full flex items-center justify-center px-2 pt-16 pb-24 sm:p-4 lg:p-12 overflow-hidden cursor-grab"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={handleDoubleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div 
          className={`relative flex items-center justify-center ${isResetting ? 'transition-all duration-300 ease-out' : 'transition-transform duration-100 ease-out'}`}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
            width: 'min(90vw, 1400px)',
            height: 'min(85vh, calc(100svh - 8rem))',
          }}
        >
          {/* Single thumbnail - always in the same position */}
          {photo.thumbnail && !imageError && (
            <img
              src={photo.thumbnail}
              alt=""
              draggable={false}
              className={`max-h-[calc(100svh-8rem)] md:max-h-[85vh] max-w-[calc(100vw-1rem)] md:max-w-[90vw] w-auto h-auto object-contain select-none transition-all duration-700 ${
                imageLoaded ? 'opacity-0 blur-none' : 'opacity-100 blur-md'
              }`}
              style={{ WebkitUserSelect: 'none', pointerEvents: 'none' }}
            />
          )}

          {/* Full image - absolutely stacked on top of thumbnail */}
          <img
            ref={imageRef}
            src={photo.url}
            alt={photo.title}
            onLoad={handleImageLoad}
            onError={handleImageError}
            draggable={false}
            className={`max-h-[calc(100svh-8rem)] md:max-h-[85vh] max-w-[calc(100vw-1rem)] md:max-w-[90vw] w-auto h-auto object-contain shadow-2xl select-none transition-opacity duration-700 protected-image absolute ${
              imageLoaded && !imageError ? 'opacity-100' : 'opacity-0'
            } ${zoom > 1 ? 'cursor-grabbing' : 'cursor-grab'}`}
            onContextMenu={(e) => e.preventDefault()}
            onDragStart={(e) => e.preventDefault()}
            style={{
              WebkitUserSelect: 'none',
              MozUserSelect: 'none',
              msUserSelect: 'none',
              userSelect: 'none',
              WebkitUserDrag: 'none',
              pointerEvents: 'none',
            }}
          />

          {/* Dreamy loading overlay - on top while loading */}
          {!imageLoaded && !imageError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 pointer-events-none" style={{ zIndex: 2 }}>
              {/* Soft vignette */}
              <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.3) 100%)' }} />
              {/* Breathing glow */}
              <div className="relative">
                <div 
                  className="w-24 h-24 rounded-full"
                  style={{
                    background: 'radial-gradient(circle, rgba(217,170,76,0.15) 0%, transparent 70%)',
                    animation: 'breathe 3s ease-in-out infinite',
                  }}
                />
                <div 
                  className="absolute inset-4 rounded-full"
                  style={{
                    background: 'radial-gradient(circle, rgba(217,170,76,0.25) 0%, transparent 70%)',
                    animation: 'breathe 3s ease-in-out infinite 0.5s',
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div 
                    className="w-1.5 h-1.5 rounded-full bg-gold/80"
                    style={{ animation: 'breathe 2s ease-in-out infinite' }}
                  />
                </div>
              </div>
              <p className="relative text-white/30 text-[10px] tracking-[0.5em] uppercase font-light">Loading</p>
            </div>
          )}

          {/* Error State */}
          {imageError && (
            <div className="flex flex-col items-center justify-center w-[85vw] md:w-[60vw] h-[50vh] md:h-[60vh] bg-charcoal/50 rounded-lg text-gray-500 px-6 text-center">
              <ImageOff size={48} className="mb-4 opacity-50" />
              <p>Failed to load image</p>
              <p className="text-sm mt-2 text-gray-600">{photo.title}</p>
            </div>
          )}
        </div>
        
        {/* Zoom Controls */}
        {imageLoaded && !imageError && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-50 flex items-center gap-1.5 md:gap-2 bg-black/60 backdrop-blur-md px-2.5 md:px-4 py-2 md:py-2 rounded-full">
            <button
              onClick={(e) => { e.stopPropagation(); zoomOut(); }}
              className="p-2.5 md:p-2 text-white/80 hover:text-white active:text-white hover:bg-white/10 rounded-full transition-colors disabled:opacity-30 touch-manipulation"
              disabled={zoom <= 1}
              title="Zoom Out (Scroll or -)"
            >
              <ZoomOut size={22} />
            </button>
            
            <span className="text-white/80 text-sm font-medium min-w-[50px] md:min-w-[60px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            
            <button
              onClick={(e) => { e.stopPropagation(); zoomIn(); }}
              className="p-2.5 md:p-2 text-white/80 hover:text-white active:text-white hover:bg-white/10 rounded-full transition-colors disabled:opacity-30 touch-manipulation"
              disabled={zoom >= 5}
              title="Zoom In (Scroll or +)"
            >
              <ZoomIn size={22} />
            </button>
            
            {zoom > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); resetZoom(); }}
                className="ml-1 md:ml-2 px-3 py-1.5 md:py-1 text-xs text-white/80 hover:text-white active:text-white hover:bg-white/10 rounded-full transition-colors touch-manipulation"
                title="Reset Zoom (Double-click or 0)"
              >
                Reset
              </button>
            )}
          </div>
        )}
        
        {/* Metadata Overlay Toggle */}
        {imageLoaded && !imageError && (
          <div className="absolute bottom-20 right-4 md:bottom-4 z-50 flex gap-3">
             <button 
              onClick={(e) => { e.stopPropagation(); setShowInfo(!showInfo); }}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 md:py-2 rounded-full text-sm font-medium backdrop-blur-md transition-all touch-manipulation ${
                showInfo ? 'bg-gold text-obsidian' : 'bg-black/40 text-white hover:bg-black/60'
              }`}
            >
              {showInfo ? <X size={16}/> : <Info size={16} />}
              <span className="hidden sm:inline">Details</span>
            </button>
          </div>
        )}
        
        {/* Swipe Hint - 移动端显示 */}
        {imageLoaded && !imageError && zoom === 1 && (
          <div className="md:hidden absolute top-4 left-1/2 transform -translate-x-1/2 z-50 w-[calc(100%-7rem)] max-w-xs px-3 py-2 bg-black/40 backdrop-blur-md rounded-full text-white/60 text-xs text-center pointer-events-none">
            左右滑动切换 · 双指缩放
          </div>
        )}
        
        {/* Zoom Hint - 桌面端显示 */}
        {imageLoaded && !imageError && zoom === 1 && (
          <div className="hidden md:block absolute top-4 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 bg-black/40 backdrop-blur-md rounded-full text-white/60 text-xs pointer-events-none">
            Scroll to zoom • Drag to pan • Double-click to reset
          </div>
        )}
      </div>

      {/* Info Panel (Slide in from right) */}
      {showInfo && (
        <div 
          className="absolute right-0 top-0 bottom-0 w-full sm:w-96 bg-charcoal/95 backdrop-blur-xl border-l border-white/5 z-40 p-5 sm:p-8 pt-[calc(4rem+env(safe-area-inset-top))] overflow-y-auto shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sm:mt-12 space-y-6 sm:space-y-8">
            
            {/* Header */}
            <div>
              <h2 className="text-2xl sm:text-3xl font-serif text-white mb-2 break-words">{photo.title}</h2>
              <div className="flex items-center gap-2 text-gold text-sm uppercase tracking-widest font-medium">
                <MapPin size={14} className="flex-shrink-0" />
                <span className="truncate">{photo.location || 'Unknown Location'}</span>
              </div>
              <p className="text-gray-400 text-sm mt-1">{photo.date}</p>
              {photo.category && (
                <span className="inline-block mt-3 px-3 py-1 bg-gold/20 text-gold text-xs uppercase tracking-wider rounded-full">
                  {photo.category}
                </span>
              )}
            </div>

            {/* EXIF Data */}
            {photo.exif && (photo.exif.camera || photo.exif.lens || photo.exif.aperture) && (
              <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-4 py-6 border-y border-white/5">
                 {photo.exif.camera && (
                   <div className="space-y-1">
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Camera</p>
                      <div className="flex items-center gap-2 text-gray-200">
                        <Camera size={16} className="text-gold" />
                        <span className="text-sm break-words">{photo.exif.camera}</span>
                      </div>
                   </div>
                 )}
                 {photo.exif.aperture && (
                   <div className="space-y-1">
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Aperture</p>
                      <div className="flex items-center gap-2 text-gray-200">
                        <Aperture size={16} className="text-gold" />
                        <span className="text-sm">{photo.exif.aperture}</span>
                      </div>
                   </div>
                 )}
                 {photo.exif.lens && (
                   <div className="space-y-1">
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Lens</p>
                      <span className="text-sm text-gray-200 break-words">{photo.exif.lens}</span>
                   </div>
                 )}
                 {(photo.exif.shutter || photo.exif.iso) && (
                   <div className="space-y-1">
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Settings</p>
                      <span className="text-sm text-gray-200">
                        {[photo.exif.shutter, photo.exif.iso ? `ISO ${photo.exif.iso}` : ''].filter(Boolean).join(' • ')}
                      </span>
                   </div>
                 )}
              </div>
            )}

            {/* Keyboard Shortcuts Hint */}
            <div className="pt-4 border-t border-white/5">
              <p className="text-xs text-gray-600 uppercase tracking-wide mb-2">Keyboard Shortcuts</p>
              <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                <span className="px-2 py-1 bg-white/5 rounded">← → Navigate</span>
                <span className="px-2 py-1 bg-white/5 rounded">ESC Close</span>
                <span className="px-2 py-1 bg-white/5 rounded">I Toggle Info</span>
                <span className="px-2 py-1 bg-white/5 rounded">+ / - Zoom</span>
                <span className="px-2 py-1 bg-white/5 rounded">0 Reset Zoom</span>
              </div>
            </div>

            <div className="pt-8 text-center">
               <p className="text-[10px] text-gray-600 uppercase tracking-widest">
                 © {new Date().getFullYear()} All Rights Reserved.
               </p>
            </div>

          </div>
        </div>
      )}
      
      <style>{`
        @keyframes breathe {
          0%, 100% { transform: scale(0.85); opacity: 0.3; }
          50% { transform: scale(1.15); opacity: 0.8; }
        }
      `}</style>
    </div>
  );
};

export default Lightbox;
