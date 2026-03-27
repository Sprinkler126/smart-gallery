/**
 * PhotoSlide - 单张照片展示（包含过渡效果）
 */
import React, { memo, useMemo } from 'react';
import { Photo } from '../../types';
import DreamParticles from '../DreamParticles';

interface KenBurnsTransform {
  startScale: number;
  endScale: number;
  startX: number;
  endX: number;
  startY: number;
  endY: number;
}

interface PhotoSlideProps {
  photo: Photo;
  isActive: boolean;
  isPrev: boolean;
  transition: 'crossfade' | 'kenburns' | 'pageflip';
  flipDirection: 'left' | 'right';
  isFlipping: boolean;
  kenBurnsTransform?: KenBurnsTransform;
  imageLoaded: boolean;
  thumbnailLoaded: boolean;
  effectiveUrl: string;
}

const TRANSITION_MS = 1200;

function PhotoSlide({
  photo,
  isActive,
  isPrev,
  transition,
  flipDirection,
  isFlipping,
  kenBurnsTransform,
  imageLoaded,
  thumbnailLoaded,
  effectiveUrl,
}: PhotoSlideProps) {
  // Ken Burns 动画样式
  const kenBurnsStyle = useMemo(() => {
    if (transition !== 'kenburns' || !kenBurnsTransform) {
      return {};
    }
    return {
      '--kb-start-scale': kenBurnsTransform.startScale,
      '--kb-end-scale': kenBurnsTransform.endScale,
      '--kb-start-x': `${kenBurnsTransform.startX}%`,
      '--kb-end-x': `${kenBurnsTransform.endX}%`,
      '--kb-start-y': `${kenBurnsTransform.startY}%`,
      '--kb-end-y': `${kenBurnsTransform.endY}%`,
    } as React.CSSProperties;
  }, [transition, kenBurnsTransform]);

  // 基础样式
  const baseClasses = 'absolute inset-0 w-full h-full';
  const visibilityClasses = isActive
    ? 'opacity-100 z-10'
    : isPrev
    ? 'opacity-0 z-0'
    : 'opacity-0 z-0 pointer-events-none';

  // 过渡动画类
  const transitionClasses = useMemo(() => {
    switch (transition) {
      case 'crossfade':
        return 'transition-opacity duration-[1200ms] ease-out';
      case 'kenburns':
        return isActive ? 'animate-kenburns' : 'transition-opacity duration-[800ms]';
      case 'pageflip':
        return '';
      default:
        return 'transition-opacity duration-[1200ms]';
    }
  }, [transition, isActive]);

  // 翻页效果样式
  const flipStyle = useMemo(() => {
    if (transition !== 'pageflip') return {};

    const baseTransform = flipDirection === 'left' ? -1 : 1;

    if (isActive && isFlipping) {
      return {
        transform: `rotateY(${baseTransform * 90}deg)`,
        transformOrigin: flipDirection === 'left' ? 'left center' : 'right center',
        transition: `transform ${TRANSITION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        opacity: 1,
      };
    }
    if (isPrev && isFlipping) {
      return {
        transform: `rotateY(${-baseTransform * 90}deg)`,
        transformOrigin: flipDirection === 'left' ? 'right center' : 'left center',
        transition: `transform ${TRANSITION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        opacity: 1,
      };
    }
    return {};
  }, [transition, isActive, isPrev, isFlipping, flipDirection]);

  // 缩略图 URL
  const thumbnailUrl = photo.thumbnail || effectiveUrl;

  return (
    <div
      className={`${baseClasses} ${visibilityClasses} ${transitionClasses}`}
      style={{ ...kenBurnsStyle, ...flipStyle, perspective: '1200px' }}
    >
      {/* 沙粒效果背景 */}
      <DreamParticles thumbnailUrl={thumbnailUrl} visible={isActive && transition === 'crossfade'} />

      {/* 图片容器 */}
      <div className="relative w-full h-full flex items-center justify-center p-8">
        {/* 缩略图（模糊占位） */}
        {!imageLoaded && thumbnailLoaded && (
          <img
            src={photo.thumbnail}
            alt=""
            className="absolute max-w-full max-h-full object-contain blur-lg scale-105 opacity-50"
          />
        )}

        {/* 主图 */}
        <img
          src={effectiveUrl}
          alt={photo.title}
          className={`relative max-w-full max-h-full object-contain transition-opacity duration-500 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          }}
        />
      </div>

      {/* 照片信息 */}
      <div className="absolute bottom-8 left-8 right-8 text-white/80">
        <h2 className="text-xl font-light mb-1">{photo.title}</h2>
        <div className="flex items-center gap-4 text-sm text-white/60">
          <span>{photo.category}</span>
          {photo.date && <span>{new Date(photo.date).toLocaleDateString('zh-CN')}</span>}
          {photo.exif?.camera && <span>{photo.exif.camera}</span>}
        </div>
      </div>
    </div>
  );
}

export default memo(PhotoSlide);
