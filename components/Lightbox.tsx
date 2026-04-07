import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, Info, MapPin, Camera, Aperture, ImageOff, ZoomIn, ZoomOut, Trash2, Brain } from 'lucide-react';
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
}

const Lightbox: React.FC<LightboxProps> = ({ photo, onClose, onNext, onPrev, hasNext, hasPrev, onDelete, onAIAnalysis }) => {
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
  const zoomOut = () => setZoom(prev => Math.max(prev / 1.2, 1));
  const resetZoom = () => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  };

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

  // Double click to reset
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    resetZoom();
  };

  // Touch support for mobile
  const [touchStartDist, setTouchStartDist] = useState<number | null>(null);
  const [touchStartZoom, setTouchStartZoom] = useState(1);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      setTouchStartDist(dist);
      setTouchStartZoom(zoom);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDist !== null) {
      e.preventDefault();
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scale = dist / touchStartDist;
      setZoom(prev => Math.max(1, Math.min(touchStartZoom * scale, 5)));
    }
  };

  const handleTouchEnd = () => {
    setTouchStartDist(null);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-obsidian/95 backdrop-blur-md"
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
        className="absolute top-6 right-6 z-50 p-2 text-gray-400 hover:text-white transition-colors bg-black/20 hover:bg-black/50 rounded-full backdrop-blur-sm"
      >
        <X size={24} />
      </button>

      {/* Delete Button */}
      {onDelete && (
        <button 
          onClick={(e) => { e.stopPropagation(); handleDeleteClick(); }}
          className="absolute top-6 left-6 z-50 p-2 text-gray-400 hover:text-red-400 transition-colors bg-black/20 hover:bg-black/50 rounded-full backdrop-blur-sm"
          title="Delete photo (Delete key)"
        >
          <Trash2 size={24} />
        </button>
      )}

      {/* AI Analysis Button */}
      {onAIAnalysis && (
        <button 
          onClick={(e) => { e.stopPropagation(); onAIAnalysis(); }}
          className="absolute top-6 left-20 z-50 p-2 text-gray-400 hover:text-gold transition-colors bg-black/20 hover:bg-black/50 rounded-full backdrop-blur-sm"
          title="AI Analysis"
        >
          <Brain size={24} />
        </button>
      )}

      {hasPrev && (
        <button 
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          className="absolute left-4 z-50 p-3 text-gray-400 hover:text-white transition-colors hover:scale-110"
        >
          <ChevronLeft size={40} strokeWidth={1} />
        </button>
      )}

      {hasNext && (
        <button 
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          className="absolute right-4 z-50 p-3 text-gray-400 hover:text-white transition-colors hover:scale-110"
        >
          <ChevronRight size={40} strokeWidth={1} />
        </button>
      )}

      {/* Main Image Container */}
      <div 
        ref={containerRef}
        className="relative w-full h-full flex items-center justify-center p-4 lg:p-12 overflow-hidden cursor-grab"
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
          className="relative transition-transform duration-100 ease-out"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          {/* Loading Placeholder - Elegant Cinematic Loader */}
          {!imageLoaded && !imageError && (
            <div className="flex flex-col items-center justify-center w-[60vw] h-[60vh]">
              <div className="relative">
                <div className="w-24 h-24 rounded-full border border-gold/20 animate-spin" style={{ animationDuration: '3s' }} />
                <div className="absolute inset-2 rounded-full border border-gold/30 animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gold/40 to-amber-600/30 animate-pulse" />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-3 h-3 rounded-full bg-gold animate-ping" style={{ animationDuration: '2s' }} />
                </div>
              </div>
              <div className="mt-8 text-center">
                <p className="text-white/60 text-sm tracking-[0.3em] uppercase font-light animate-pulse">Loading</p>
                <p className="text-gold/80 text-xs mt-2 font-serif italic">{photo.title}</p>
              </div>
            </div>
          )}

          {/* Error State */}
          {imageError && (
            <div className="flex flex-col items-center justify-center w-[60vw] h-[60vh] bg-charcoal/50 rounded-lg text-gray-500">
              <ImageOff size={48} className="mb-4 opacity-50" />
              <p>Failed to load image</p>
              <p className="text-sm mt-2 text-gray-600">{photo.title}</p>
            </div>
          )}

          {/* Actual Image with Protection */}
          <img
            ref={imageRef}
            src={photo.url}
            alt={photo.title}
            onLoad={handleImageLoad}
            onError={handleImageError}
            draggable={false}
            className={`max-h-[85vh] max-w-[90vw] w-auto h-auto object-contain shadow-2xl select-none transition-opacity duration-300 protected-image ${
              imageLoaded && !imageError ? 'opacity-100' : 'opacity-0 absolute'
            } ${zoom > 1 ? 'cursor-grbing' : 'cursor-grab'}`}
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
        </div>
        
        {/* Zoom Controls */}
        {imageLoaded && !imageError && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-50 flex items-center gap-2 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full">
            <button
              onClick={(e) => { e.stopPropagation(); zoomOut(); }}
              className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-colors disabled:opacity-30"
              disabled={zoom <= 1}
              title="Zoom Out (Scroll or -)"
            >
              <ZoomOut size={20} />
            </button>
            
            <span className="text-white/80 text-sm font-medium min-w-[60px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            
            <button
              onClick={(e) => { e.stopPropagation(); zoomIn(); }}
              className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-colors disabled:opacity-30"
              disabled={zoom >= 5}
              title="Zoom In (Scroll or +)"
            >
              <ZoomIn size={20} />
            </button>
            
            {zoom > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); resetZoom(); }}
                className="ml-2 px-3 py-1 text-xs text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                title="Reset Zoom (Double-click or 0)"
              >
                Reset
              </button>
            )}
          </div>
        )}
        
        {/* Metadata Overlay Toggle */}
        {imageLoaded && !imageError && (
          <div className="absolute bottom-4 right-4 z-50 flex gap-3">
             <button 
              onClick={(e) => { e.stopPropagation(); setShowInfo(!showInfo); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium backdrop-blur-md transition-all ${
                showInfo ? 'bg-gold text-obsidian' : 'bg-black/40 text-white hover:bg-black/60'
              }`}
            >
              {showInfo ? <X size={16}/> : <Info size={16} />}
              <span>Details</span>
            </button>
          </div>
        )}
        
        {/* Zoom Hint - 桌面端显示 */}
        {imageLoaded && !imageError && zoom === 1 && (
          <div className="hidden md:block absolute top-4 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 bg-black/40 backdrop-blur-md rounded-full text-white/60 text-xs pointer-events-none">
            🖱️ Scroll to zoom • Drag to pan • Double-click to reset
          </div>
        )}
      </div>

      {/* Info Panel (Slide in from right) */}
      {showInfo && (
        <div 
          className="absolute right-0 top-0 bottom-0 w-full sm:w-96 bg-charcoal/95 backdrop-blur-xl border-l border-white/5 z-40 p-8 overflow-y-auto shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mt-12 space-y-8">
            
            {/* Header */}
            <div>
              <h2 className="text-3xl font-serif text-white mb-2">{photo.title}</h2>
              <div className="flex items-center gap-2 text-gold text-sm uppercase tracking-widest font-medium">
                <MapPin size={14} />
                <span>{photo.location || 'Unknown Location'}</span>
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
              <div className="grid grid-cols-2 gap-4 py-6 border-y border-white/5">
                 {photo.exif.camera && (
                   <div className="space-y-1">
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Camera</p>
                      <div className="flex items-center gap-2 text-gray-200">
                        <Camera size={16} className="text-gold" />
                        <span className="text-sm">{photo.exif.camera}</span>
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
                      <span className="text-sm text-gray-200">{photo.exif.lens}</span>
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
    </div>
  );
};

export default Lightbox;
