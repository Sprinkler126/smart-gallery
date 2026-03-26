import React, { useState, useEffect, useRef, useCallback } from 'react';

interface LazyImageProps {
  src: string;
  blurPlaceholder?: string; // Base64 encoded tiny blurred image
  alt: string;
  className?: string;
  imgClassName?: string;
  onClick?: () => void;
  aspectRatio?: string;
  lazy?: boolean;
  threshold?: number;
  rootMargin?: string;
}

/**
 * LazyImage Component with LQIP (Low Quality Image Placeholder)
 * 
 * Features:
 * - Intersection Observer lazy loading
 * - Blur placeholder while loading (LQIP effect)
 * - Smooth fade-in transition
 * - Image preloading
 */
const LazyImage: React.FC<LazyImageProps> = ({
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
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(!lazy);
  const [error, setError] = useState(false);
  const [highResSrc, setHighResSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

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
    if (isInView || !imgRef.current || !lazy) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            if (observerRef.current) {
              observerRef.current.unobserve(entry.target);
            }
          }
        });
      },
      {
        threshold,
        rootMargin,
      }
    );

    observerRef.current.observe(imgRef.current);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [lazy, threshold, rootMargin, isInView]);

  // Load high-res image when in view
  useEffect(() => {
    if (!isInView || highResSrc) return;

    // Preload the high-res image
    const img = new Image();
    img.src = src;
    
    img.onload = () => {
      setHighResSrc(src);
    };
    
    img.onerror = () => {
      setError(true);
    };
  }, [isInView, src, highResSrc]);

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
  }, []);

  const handleError = useCallback(() => {
    setError(true);
  }, []);

  // Default image classes
  const defaultImageClasses = 'w-full h-full object-cover';

  // Determine what to show
  const hasBlurPlaceholder = !!blurPlaceholder;
  const showBlurPlaceholder = hasBlurPlaceholder && !isLoaded && !error;
  const showHighRes = isLoaded && highResSrc;

  return (
    <div
      className={`relative overflow-hidden group select-none ${className || ''}`}
      onClick={onClick}
      style={{ 
        backgroundColor: '#1a1a1a',
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
            opacity: isLoaded ? 0 : 1,
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
          ref={imgRef}
          src={highResSrc}
          alt={alt}
          draggable={false}
          loading="lazy"
          decoding="async"
          className={`absolute inset-0 w-full h-full transition-all duration-700 ease-out group-hover:scale-105 ${
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

      {/* Invisible placeholder for intersection observer */}
      {!highResSrc && (
        <div ref={imgRef} className="absolute inset-0" />
      )}

      {/* Error State */}
      {error && (
        <div className="absolute inset-0 z-0 flex items-center justify-center bg-charcoal/50">
          <span className="text-gray-500 text-xs">Failed to load</span>
        </div>
      )}

      {/* Hover Overlay Effect */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 pointer-events-none z-10" />
    </div>
  );
};

export default LazyImage;
