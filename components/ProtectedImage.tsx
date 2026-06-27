import React, { useState, useEffect, useRef, useCallback } from 'react';

interface ProtectedImageProps {
  src: string;
  blurPlaceholder?: string; // Base64 encoded tiny blurred image (LQIP)
  alt: string;
  className?: string;
  imgClassName?: string;
  onClick?: () => void;
  aspectRatio?: string;
  lazy?: boolean;
  threshold?: number;
  rootMargin?: string;
  releaseOnExit?: boolean;
  placeholderColor?: string;
}

/**
 * ProtectedImage Component with Lazy Loading + LQIP
 * 
 * Features:
 * - Intersection Observer lazy loading
 * - Blur placeholder (LQIP) while loading
 * - Right-click protection
 * - Drag protection
 * - Smooth fade-in with blur transition
 */
const ProtectedImage: React.FC<ProtectedImageProps> = ({
  src,
  blurPlaceholder,
  alt,
  className,
  imgClassName,
  onClick,
  aspectRatio,
  lazy = true,
  threshold = 0.1,
  rootMargin = '100px',
  releaseOnExit = true,
  placeholderColor = '#1a1a1a',
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(!lazy);
  const [error, setError] = useState(false);
  const [highResSrc, setHighResSrc] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    return false;
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    return false;
  }, []);

  useEffect(() => {
    setIsLoaded(false);
    setError(false);
    setHighResSrc(null);
  }, [src]);

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  // Set up Intersection Observer for lazy loading
  useEffect(() => {
    if (!containerRef.current || !lazy) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            return;
          }

          if (releaseOnExit) {
            setIsInView(false);
            setIsLoaded(false);
            setHighResSrc(null);
          }
        });
      },
      {
        threshold,
        rootMargin,
      }
    );

    observerRef.current.observe(containerRef.current);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [lazy, threshold, rootMargin, releaseOnExit]);

  // Load high-res image when in view
  useEffect(() => {
    if (!isInView || highResSrc) return;
    let cancelled = false;

    // Preload the high-res image
    const img = new Image();
    setError(false);
    
    img.onload = () => {
      if (cancelled) return;
      setHighResSrc(src);
    };
    
    img.onerror = () => {
      if (cancelled) return;
      setError(true);
    };

    img.src = src;

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
      img.src = '';
    };
  }, [isInView, src, highResSrc]);

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
  }, []);

  const handleError = useCallback(() => {
    setError(true);
  }, []);

  // Default image classes with protection
  const defaultImageClasses = 'w-full h-full object-cover protected-image';

  // Determine what to show
  const hasBlurPlaceholder = !!blurPlaceholder;
  // Show blur placeholder immediately (don't wait for isInView)
  const showBlurPlaceholder = hasBlurPlaceholder && !isLoaded && !error;
  const showHighRes = isLoaded && highResSrc;

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden group select-none ${className || ''}`}
      onContextMenu={handleContextMenu}
      onClick={onClick}
      style={{ 
        backgroundColor: placeholderColor,
        aspectRatio: aspectRatio || undefined,
      }}
    >
      {/* Blur Placeholder (LQIP) - shown while loading */}
      {showBlurPlaceholder && (
        <div
          className="absolute inset-0 z-0 transition-opacity duration-700"
          style={{
            backgroundImage: `url(${blurPlaceholder})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(20px)',
            transform: 'scale(1.1)', // Prevent blur edges
          }}
        />
      )}

      {/* Loading Spinner - shown if no blur placeholder */}
      {!hasBlurPlaceholder && !isLoaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-0">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      )}

      {/* High-res Image */}
      {highResSrc && (
        <img
          src={highResSrc}
          alt={alt}
          draggable={false}
          loading="lazy"
          decoding="async"
          className={`absolute inset-0 w-full h-full transition-all duration-700 ease-out group-hover:scale-105 pointer-events-none ${
            imgClassName || defaultImageClasses
          } ${showHighRes ? 'opacity-100' : 'opacity-0'}`}
          style={{
            filter: isLoaded ? 'blur(0px)' : 'blur(10px)',
            transform: isLoaded ? 'scale(1)' : 'scale(1.05)',
          }}
          onLoad={handleLoad}
          onError={handleError}
        />
      )}

      {/* Error State */}
      {error && (
        <div className="absolute inset-0 z-0 flex items-center justify-center bg-charcoal/50">
          <span className="text-gray-500 text-xs">Failed to load</span>
        </div>
      )}

      {/* Invisible overlay to intercept clicks/drags */}
      <div
        className="absolute inset-0 z-10 bg-transparent"
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
      />

      {/* Optional: Simple Copyright Watermark Overlay (Visible on hover) */}
      <div className="absolute bottom-2 right-2 z-20 opacity-0 group-hover:opacity-50 transition-opacity duration-300 pointer-events-none">
        <span className="text-[10px] text-white font-light tracking-widest uppercase">
          © Lumina Protected
        </span>
      </div>

      {/* Hover Overlay Effect */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 pointer-events-none z-10" />
    </div>
  );
};

export default ProtectedImage;
