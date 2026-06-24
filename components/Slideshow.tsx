import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Play, Pause, ChevronLeft, ChevronRight,
  Clock, Settings, Monitor, Image, Crop, Columns3,
  Volume2, VolumeX, Music
} from 'lucide-react';
import { Photo, AIAnalysisResult } from '../types';
import DreamParticles from './DreamParticles';
import ProgressBar from './slideshow/ProgressBar';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface SlideshowProps {
  photos: Photo[];
  initialIndex?: number;
  onClose: () => void;
}

type IntervalOption = 3 | 5 | 8 | 10 | 15 | 30;
type OrientationFilter = 'all' | 'landscape' | 'portrait';
type TransitionType = 'crossfade' | 'kenburns' | 'pageflip';

interface KenBurnsTransform {
  startScale: number; endScale: number;
  startX: number; endX: number;
  startY: number; endY: number;
}

const generateKenBurns = (): KenBurnsTransform => {
  // 纯随机轻微缩放 4%-6%
  const scaleRange = 0.04 + Math.random() * 0.02; // 4% - 6%
  
  return {
    startScale: 1 + Math.random() * 0.02,
    endScale: 1 + scaleRange,
    startX: (Math.random() - 0.5) * 2,
    endX: (Math.random() - 0.5) * 2,
    startY: (Math.random() - 0.5) * 2,
    endY: (Math.random() - 0.5) * 2,
  };
};

// 翻页方向类型
 type FlipDirection = 'left' | 'right';
 
 // 生成随机翻页方向
 const generateFlipDirection = (): FlipDirection => 
   Math.random() > 0.5 ? 'left' : 'right';

const fetchOrientations = async (): Promise<Record<string, 'landscape' | 'portrait' | 'square'>> => {
  try {
    const res = await fetch('/photowall/api/orientations');
    const data = await res.json();
    return data.success ? data.orientations : {};
  } catch { return {}; }
};

const TRANSITION_MS = 1200;
const PROGRESS_TICK = 100; // ms

type ImageFetchPriority = 'high' | 'low' | 'auto';

const configureImageLoad = (img: HTMLImageElement, priority: ImageFetchPriority) => {
  img.decoding = 'async';
  (img as HTMLImageElement & { fetchPriority?: ImageFetchPriority }).fetchPriority = priority;
};

const decodeLoadedImage = async (img: HTMLImageElement) => {
  try {
    await img.decode();
  } catch {
    // onload is still valid when decode() rejects for cached or partially decoded images.
  }
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
const Slideshow: React.FC<SlideshowProps> = ({ photos, initialIndex = 0, onClose }) => {
  /* ---------- 所有 UI 状态 ---------- */
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [prevIndex, setPrevIndex]       = useState<number | null>(null);
  const [isPlaying, setIsPlaying]       = useState(false); // 默认暂停，10秒后自动开始
  const [intervalSec, setIntervalSec]   = useState<IntervalOption>(10);
  const [showControls, setShowControls] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [imageLoaded, setImageLoaded]   = useState(false);
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false);
  const [thumbDisplayReady, setThumbDisplayReady] = useState(false); // ★ 缩略图显示满足最小时间
  const thumbLoadTimeRef = useRef<number>(0); // ★ 记录缩略图加载完成时间
  const [nextImageReady, setNextImageReady] = useState(false); // ★ 下一张高清图是否准备好（Page Flip 模式用）
  const [orientationFilter, setOrientationFilter] = useState<OrientationFilter>('all');
  const [photoOrientations, setPhotoOrientations] = useState<Record<string, 'landscape' | 'portrait' | 'square'>>({});
  const [orientationsLoaded, setOrientationsLoaded] = useState(false);
  const [isLoading, setIsLoading]       = useState(true);
  const [displayedUrl, setDisplayedUrl] = useState(''); // ★ 加载完成后才放上 img 标签
  const [transition, setTransition]     = useState<TransitionType>('kenburns');
  const [idleSeconds, setIdleSeconds]   = useState(0); // 空闲计时
  const [isRandomOrder, setIsRandomOrder] = useState(false); // 随机播放/顺序播放
  const [imageQuality, setImageQuality] = useState<'display' | 'original'>('display'); // 画质模式
  const [shuffledIndices, setShuffledIndices] = useState<number[]>([]); // 随机排序后的索引
  const [particleLevel, setParticleLevel] = useState<number>(5); // 粒子数量级别 1-10
  const [photoAnalysis, setPhotoAnalysis] = useState<AIAnalysisResult | null>(null); // 当前照片的分析结果
  
  /* ---------- Page Flip 状态 ---------- */
  const [flipDirection, setFlipDirection] = useState<FlipDirection>('right');
  const [isFlipping, setIsFlipping]       = useState(false);

  /* ---------- BGM 状态 ---------- */
  const [bgmList, setBgmList]           = useState<{id: string, filename: string, url: string}[]>([]);
  const [currentBgmIndex, setCurrentBgmIndex] = useState(0);
  const [isMuted, setIsMuted]           = useState(false); // 默认播放音乐
  const [bgmLoaded, setBgmLoaded]       = useState(false);
  const [showSongList, setShowSongList] = useState(false); // 歌曲列表弹窗
  const [musicMode, setMusicMode]       = useState<'background' | 'companion'>('background'); // 播放模式

  /* ---------- Refs ---------- */
  const containerRef     = useRef<HTMLDivElement>(null);
  const controlsTimer    = useRef<ReturnType<typeof setTimeout>>();
  const prevIndexTimer   = useRef<ReturnType<typeof setTimeout>>();
  const kenBurnsCache    = useRef<Map<number, KenBurnsTransform>>(new Map());
  const audioRef         = useRef<HTMLAudioElement | null>(null);

  // ================================================================
  // ★ 分级图片缓存系统
  // L1: 缩略图 - 常驻内存，数量多但体积小
  // L2: 预览图 (800px) - LRU 缓存，中等数量
  // L3: 高清原图 - 严格限制数量，用完即释放
  // ================================================================
  
  // L1: 缩略图缓存 - 常驻内存，可存 500+ 张
  const THUMB_CACHE_SIZE = 500;
  const thumbCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const thumbUrls = useRef<Set<string>>(new Set());
  
  // L2: 预览图缓存 (800px) - LRU，最多 50 张
  const PREVIEW_CACHE_SIZE = 50;
  const previewCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const previewUrls = useRef<Set<string>>(new Set());
  
  // L3: 高清原图缓存 - 严格限制最多 5 张（当前显示 + 预加载）
  const FULL_CACHE_SIZE = 5;
  const fullCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const fullUrls = useRef<Set<string>>(new Set());
  
  // 统一的预加载 URL 集合（用于快速检查）
  const preloadedUrls = useRef<Set<string>>(new Set());

  // ★ 添加缩略图到 L1 缓存
  const addToThumbCache = useCallback((key: string, img: HTMLImageElement) => {
    if (thumbCache.current.has(key)) {
      thumbCache.current.delete(key);
    }
    while (thumbCache.current.size >= THUMB_CACHE_SIZE) {
      const firstKey = thumbCache.current.keys().next().value;
      if (firstKey) {
        thumbCache.current.delete(firstKey);
        thumbUrls.current.delete(firstKey);
        preloadedUrls.current.delete(firstKey);
      }
    }
    thumbCache.current.set(key, img);
    thumbUrls.current.add(key);
    preloadedUrls.current.add(key);
  }, []);

  // ★ 添加预览图到 L2 缓存
  const addToPreviewCache = useCallback((key: string, img: HTMLImageElement) => {
    if (previewCache.current.has(key)) {
      previewCache.current.delete(key);
    }
    while (previewCache.current.size >= PREVIEW_CACHE_SIZE) {
      const firstKey = previewCache.current.keys().next().value;
      if (firstKey) {
        previewCache.current.delete(firstKey);
        previewUrls.current.delete(firstKey);
        preloadedUrls.current.delete(firstKey);
      }
    }
    previewCache.current.set(key, img);
    previewUrls.current.add(key);
    preloadedUrls.current.add(key);
  }, []);

  // ★ 添加高清图到 L3 缓存（严格限制）
  const addToFullCache = useCallback((key: string, img: HTMLImageElement) => {
    if (fullCache.current.has(key)) {
      fullCache.current.delete(key);
    }
    while (fullCache.current.size >= FULL_CACHE_SIZE) {
      const firstKey = fullCache.current.keys().next().value;
      if (firstKey) {
        fullCache.current.delete(firstKey);
        fullUrls.current.delete(firstKey);
        preloadedUrls.current.delete(firstKey);
      }
    }
    fullCache.current.set(key, img);
    fullUrls.current.add(key);
    preloadedUrls.current.add(key);
  }, []);

  // ★ 从缓存获取图片（按优先级）
  const getFromCache = useCallback((key: string): HTMLImageElement | undefined => {
    // 优先高清图
    if (fullCache.current.has(key)) {
      const img = fullCache.current.get(key)!;
      // 更新 LRU 顺序
      fullCache.current.delete(key);
      fullCache.current.set(key, img);
      return img;
    }
    // 其次预览图
    if (previewCache.current.has(key)) {
      const img = previewCache.current.get(key)!;
      previewCache.current.delete(key);
      previewCache.current.set(key, img);
      return img;
    }
    // 最后缩略图
    if (thumbCache.current.has(key)) {
      const img = thumbCache.current.get(key)!;
      thumbCache.current.delete(key);
      thumbCache.current.set(key, img);
      return img;
    }
    return undefined;
  }, []);

  // ★ 启动时清空所有缓存
  useEffect(() => {
    thumbCache.current.clear();
    thumbUrls.current.clear();
    previewCache.current.clear();
    previewUrls.current.clear();
    fullCache.current.clear();
    fullUrls.current.clear();
    preloadedUrls.current.clear();
    kenBurnsCache.current.clear();
  }, []);

  // ★ 定时清理：每 30 分钟清理一次
  useEffect(() => {
    const CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 分钟
    
    const interval = setInterval(() => {
      const beforeSize = preloadedUrls.current.size;
      
      // 清理缩略图：保留最近 300 张
      if (thumbCache.current.size > 300) {
        const entries = Array.from(thumbCache.current.entries());
        const toDelete = entries.slice(0, entries.length - 300);
        toDelete.forEach(([key]) => {
          thumbCache.current.delete(key);
          thumbUrls.current.delete(key);
          preloadedUrls.current.delete(key);
        });
      }
      
      // 清理预览图：保留最近 30 张
      if (previewCache.current.size > 30) {
        const entries = Array.from(previewCache.current.entries());
        const toDelete = entries.slice(0, entries.length - 30);
        toDelete.forEach(([key]) => {
          previewCache.current.delete(key);
          previewUrls.current.delete(key);
          preloadedUrls.current.delete(key);
        });
      }
      
      // 高清图保持严格限制，不额外清理
      
      const afterSize = preloadedUrls.current.size;
      if (beforeSize !== afterSize) {
        console.log(`🧹 Cache cleanup: ${beforeSize} → ${afterSize} items (thumb=${thumbCache.current.size}, preview=${previewCache.current.size}, full=${fullCache.current.size})`);
      }
    }, CLEANUP_INTERVAL);
    
    return () => clearInterval(interval);
  }, []);

  // ★ 旧的 LRU 缓存管理（兼容代码，逐步迁移）
  const MAX_CACHE_SIZE = 100;
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const addToImageCache = useCallback((key: string, img: HTMLImageElement) => {
    // 根据 key 前缀判断类型
    if (key.startsWith('thumb:')) {
      addToThumbCache(key, img);
    } else if (key.startsWith('preview:')) {
      addToPreviewCache(key, img);
    } else if (key.startsWith('full:')) {
      addToFullCache(key, img);
    } else {
      // 默认放入预览缓存
      addToPreviewCache(key, img);
    }
  }, [addToThumbCache, addToPreviewCache, addToFullCache]);

  // ★ 核心：用一个 ref 保存自动播放需要读取的所有"最新值"
  // 这样定时器回调永远读到最新状态，不需要重建定时器
  const playStateRef = useRef({
    isPlaying: true,
    intervalSec: 10 as IntervalOption,
    isLoading: true,
    filteredLength: photos.length,
  });

  /* ---------- 派生：filteredPhotos ---------- */
  const filteredPhotos = React.useMemo(() => {
    if (!orientationsLoaded || orientationFilter === 'all') return photos;
    return photos.filter((p) => {
      const o = photoOrientations[p.id];
      if (!o) return false;
      if (orientationFilter === 'landscape') return o === 'landscape' || o === 'square';
      return o === 'portrait';
    });
  }, [photos, orientationFilter, photoOrientations, orientationsLoaded]);

  // 同步到 ref
  useEffect(() => {
    playStateRef.current.filteredLength = filteredPhotos.length;
  }, [filteredPhotos.length]);
  
  // 生成随机播放列表（预加载整个播放顺序）
  const generateShuffledIndices = useCallback(() => {
    const indices = Array.from({ length: filteredPhotos.length }, (_, i) => i);
    // Fisher-Yates 洗牌算法
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    setShuffledIndices(indices);
    console.log('🎲 Generated random playlist:', indices.slice(0, 10), '...');
  }, [filteredPhotos.length]);
  
  // 切换随机/顺序播放时重新生成列表
  useEffect(() => {
    if (isRandomOrder) {
      generateShuffledIndices();
    }
  }, [isRandomOrder, generateShuffledIndices]);
  
  // ★ 智能预加载：分级策略，严格限制高清图数量
  // L1: 缩略图 - 预加载前后 10 张
  // L2: 预览图 - 预加载前后 3 张
  // L3: 高清原图 - 严格限制最多 5 张（当前 + 前后各 2 张）
  const PRELOAD_THUMB_AHEAD = 10;  // 缩略图预加载范围
  const PRELOAD_PREVIEW_AHEAD = 3; // 预览图预加载范围
  const MAX_FULL_PRELOAD = 5;      // 高清图最大预加载数量
  
  const getPlaybackIndex = useCallback((centerIdx: number, offset: number, len = filteredPhotos.length) => {
    if (len <= 0) return 0;

    if (isRandomOrder && shuffledIndices.length === len) {
      const playlistPosition = shuffledIndices.indexOf(centerIdx);
      if (playlistPosition !== -1) {
        return shuffledIndices[(playlistPosition + offset + len) % len];
      }
    }

    return (centerIdx + offset + len) % len;
  }, [filteredPhotos.length, isRandomOrder, shuffledIndices]);

  const qualityRef = useRef(imageQuality);
  useEffect(() => { qualityRef.current = imageQuality; }, [imageQuality]);
  
  // 跟踪正在加载的高清图数量
  const loadingFullCount = useRef(0);
  const loadingFullUrls = useRef<Set<string>>(new Set());
  const fullPreloadQueue = useRef<string[]>([]);

  const preloadRange = useCallback((centerIdx: number, list: Photo[]) => {
    const len = list.length;
    if (len <= 1) return;
    const quality = qualityRef.current;
    const collectPlaybackIndices = (ahead: number, behind: number) => {
      const indices: number[] = [];
      const seen = new Set<number>();
      const maxOffset = Math.max(ahead, behind);

      for (let offset = 1; offset <= maxOffset; offset++) {
        if (offset <= ahead) {
          const idx = getPlaybackIndex(centerIdx, offset, len);
          if (!seen.has(idx)) {
            seen.add(idx);
            indices.push(idx);
          }
        }

        if (offset <= behind) {
          const idx = getPlaybackIndex(centerIdx, -offset, len);
          if (!seen.has(idx)) {
            seen.add(idx);
            indices.push(idx);
          }
        }
      }

      return indices;
    };

    // ========== L1: 缩略图预加载（前后 10 张）==========
    for (const idx of collectPlaybackIndices(PRELOAD_THUMB_AHEAD, 2)) {
      const photo = list[idx];
      if (!photo || !photo.thumbnail) continue;
      
      const photoUrl = quality === 'original' && photo.originalUrl ? photo.originalUrl : photo.url;
      const thumbKey = `thumb:${photoUrl}`;
      
      if (!thumbUrls.current.has(thumbKey)) {
        const tImg = new window.Image();
        configureImageLoad(tImg, 'low');
        tImg.src = photo.thumbnail;
        tImg.onload = () => addToThumbCache(thumbKey, tImg);
      }
    }

    // ========== L2: 预览图预加载（前后 3 张）==========
    for (const idx of collectPlaybackIndices(PRELOAD_PREVIEW_AHEAD, 1)) {
      const photo = list[idx];
      if (!photo) continue;
      
      const photoUrl = quality === 'original' && photo.originalUrl ? photo.originalUrl : photo.url;
      const previewKey = `preview:${photoUrl}`;
      
      // 如果后端支持预览图尺寸，这里可以加载 800px 版本
      // 目前先用缩略图作为预览图
      if (!previewUrls.current.has(previewKey) && photo.thumbnail) {
        const pImg = new window.Image();
        configureImageLoad(pImg, 'low');
        pImg.src = photo.thumbnail;
        pImg.onload = () => addToPreviewCache(previewKey, pImg);
      }
    }

    // ========== L3: 高清原图预加载（严格限制 5 张）==========
    // 计算需要预加载的高清图索引
    const fullIndices = collectPlaybackIndices(2, 2);
    
    // 限制高清图缓存大小
    while (fullCache.current.size >= MAX_FULL_PRELOAD) {
      const firstKey = fullCache.current.keys().next().value;
      if (firstKey) {
        fullCache.current.delete(firstKey);
        fullUrls.current.delete(firstKey);
        preloadedUrls.current.delete(firstKey);
      }
    }
    
    // 加载高清图（限制并发）
    for (const idx of fullIndices) {
      if (loadingFullCount.current >= 2) break; // 最多同时加载 2 张高清图
      
      const photo = list[idx];
      if (!photo) continue;
      
      const photoUrl = quality === 'original' && photo.originalUrl ? photo.originalUrl : photo.url;
      const fullKey = `full:${photoUrl}`;
      
      if (!fullUrls.current.has(fullKey) && !loadingFullUrls.current.has(fullKey)) {
        loadingFullCount.current++;
        loadingFullUrls.current.add(fullKey);
        const fImg = new window.Image();
        configureImageLoad(fImg, 'low');
        fImg.src = photoUrl;
        fImg.onload = async () => {
          await decodeLoadedImage(fImg);
          addToFullCache(fullKey, fImg);
          loadingFullCount.current--;
          loadingFullUrls.current.delete(fullKey);
        };
        fImg.onerror = () => {
          loadingFullCount.current--;
          loadingFullUrls.current.delete(fullKey);
        };
      }
    }
    
    console.log(`📦 Preload: thumb=${thumbCache.current.size}, preview=${previewCache.current.size}, full=${fullCache.current.size} (loading: ${loadingFullCount.current})`);
  }, [addToThumbCache, addToPreviewCache, addToFullCache, getPlaybackIndex]);

  useEffect(() => { playStateRef.current.isPlaying = isPlaying; }, [isPlaying]);
  useEffect(() => { playStateRef.current.intervalSec = intervalSec; }, [intervalSec]);
  useEffect(() => { playStateRef.current.isLoading = isLoading; }, [isLoading]);

  /* ---------- BGM 加载和控制 ---------- */
  // 加载 BGM 列表
  useEffect(() => {
    const loadBgmList = async () => {
      try {
        const res = await fetch('/photowall/api/bgm/list');
        const data = await res.json();
        if (data.success && data.data.length > 0) {
          // 随机排序
          const shuffled = [...data.data].sort(() => Math.random() - 0.5);
          setBgmList(shuffled);
          setCurrentBgmIndex(0);
          setBgmLoaded(true);
        }
      } catch (err) {
        console.error('Failed to load BGM:', err);
      }
    };
    loadBgmList();
  }, []);

  // 音频播放控制（与幻灯片播放状态同步，支持暂停续播）
  useEffect(() => {
    if (!bgmLoaded || bgmList.length === 0) return;

    // 创建或更新音频元素
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = 0.5;
      // 恢复上次保存的音量
      const savedVolume = localStorage.getItem('sg_bgm_volume');
      if (savedVolume) audioRef.current.volume = parseFloat(savedVolume);
    }

    const audio = audioRef.current;
    const currentBgm = bgmList[currentBgmIndex];
    
    // 只在需要切换歌曲时才更新 src（避免暂停/播放时重置进度）
    const expectedSrc = currentBgm.url;
    const currentSrc = audio.src.replace(window.location.origin, '');
    
    if (!audio.src || currentSrc !== expectedSrc) {
      // 保存当前播放进度（如果是同一首歌）
      const wasPlaying = !audio.paused;
      const currentTime = audio.currentTime;
      
      audio.src = currentBgm.url;
      audio.load();
      
      // 如果是切歌，从头播放；如果是恢复播放，保持进度
      if (wasPlaying && currentTime > 0 && currentSrc === expectedSrc) {
        audio.currentTime = currentTime;
      }
    }

    // 根据静音状态和播放模式控制音乐
    if (isMuted) {
      audio.pause();
    } else if (musicMode === 'background') {
      // 背景音模式：音乐不受幻灯片暂停影响，始终播放
      audio.play().catch(err => console.log('Audio play failed:', err));
    } else {
      // 伴随模式：音乐与幻灯片同步
      if (isPlaying) {
        audio.play().catch(err => console.log('Audio play failed:', err));
      } else {
        audio.pause();
      }
    }

    // 当前歌曲结束，播放下一首
    const handleEnded = () => {
      setCurrentBgmIndex((prev) => (prev + 1) % bgmList.length);
    };

    // 保存播放进度（每秒）
    const saveInterval = setInterval(() => {
      if (audio.src && !audio.paused) {
        localStorage.setItem('sg_bgm_progress', JSON.stringify({
          src: audio.src.replace(window.location.origin, ''),
          time: audio.currentTime,
          index: currentBgmIndex,
        }));
      }
    }, 1000);

    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.removeEventListener('ended', handleEnded);
      clearInterval(saveInterval);
    };
  }, [bgmLoaded, bgmList, currentBgmIndex, isMuted, isPlaying, musicMode]);

  // 清理音频
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // 切换 filter 时重置索引
  const prevFilterRef = useRef(orientationFilter);
  useEffect(() => {
    if (prevFilterRef.current !== orientationFilter) {
      setCurrentIndex(0);
      prevFilterRef.current = orientationFilter;
    }
  }, [orientationFilter]);

  // 安全获取当前照片（index 越界时钳位）
  const safeIndex = filteredPhotos.length > 0
    ? currentIndex % filteredPhotos.length
    : 0;
  const currentPhoto = filteredPhotos[safeIndex];

  // 根据画质设置选择 URL
  const effectiveUrl = currentPhoto
    ? (imageQuality === 'original' && currentPhoto.originalUrl ? currentPhoto.originalUrl : currentPhoto.url)
    : '';

  // 加载当前照片的分析结果
  useEffect(() => {
    if (!currentPhoto) {
      setPhotoAnalysis(null);
      return;
    }
    
    const loadAnalysis = async () => {
      try {
        const res = await fetch(`/photowall/api/analysis/${currentPhoto.id}`);
        const data = await res.json();
        if (data.success) {
          setPhotoAnalysis(data.data);
        } else {
          setPhotoAnalysis(null);
        }
      } catch {
        setPhotoAnalysis(null);
      }
    };
    
    loadAnalysis();
  }, [currentPhoto?.id]);

  /* ---------- Ken Burns helper ---------- */
  const getKenBurns = (idx: number) => {
    if (!kenBurnsCache.current.has(idx)) {
      kenBurnsCache.current.set(idx, generateKenBurns());
    }
    return kenBurnsCache.current.get(idx)!;
  };

  /* ================================================================ */
  /*  ★ 核心导航：goNext / goPrev                                     */
  /*  完全不依赖任何 state —— 全部通过 ref 或 setState(fn) 读取        */
  /* ================================================================ */
  const navigate = useCallback((direction: 1 | -1) => {
    const { isLoading: loading, filteredLength: len } = playStateRef.current;
    if (loading || len <= 1) return;

    // 设置翻页方向（用于 pageflip 效果）
    setFlipDirection(direction === 1 ? 'right' : 'left');
    setIsFlipping(true);

    setCurrentIndex((prev) => {
      setPrevIndex(prev);
      
      if (isRandomOrder && shuffledIndices.length > 0) {
        // 随机播放模式：使用洗牌后的索引
        const currentShuffledIdx = shuffledIndices.indexOf(prev);
        const nextShuffledIdx = (currentShuffledIdx + direction + len) % len;
        return shuffledIndices[nextShuffledIdx];
      } else {
        // 顺序播放模式
        return (prev + direction + len) % len;
      }
    });
    setImageLoaded(false);
    // ★ 不再清空 displayedUrl，保持旧图显示直到新图加载完成

    // 清除上一次的 prevIndex 清理定时器
    if (prevIndexTimer.current) clearTimeout(prevIndexTimer.current);
    prevIndexTimer.current = setTimeout(() => {
      setPrevIndex(null);
      setIsFlipping(false);
    }, TRANSITION_MS + 200);
  }, [isRandomOrder, shuffledIndices]); // 依赖随机播放状态

  /* ================================================================ */
  /*  ★ 自动播放：ProgressBar 组件自己管理 elapsed 和 progress         */
  /*  Page Flip 模式下需等待下一张高清图加载完成才能切换              */
  /* ================================================================ */
  const handleProgressComplete = useCallback(() => {
    // Page Flip 模式下，需要等待下一张高清图加载完成
    if (transition === 'pageflip' && !nextImageReady) {
      // 暂停播放，等待下一张图加载完成
      setIsPlaying(false);
      return;
    }
    navigate(1);
  }, [navigate, transition, nextImageReady]);

  /* ================================================================ */
  /*  ★ 图片加载：真正异步 + 状态驱动 + 并行加载                        */
  /* ================================================================ */
  useEffect(() => {
    if (!currentPhoto || !effectiveUrl) return;
    let cancelled = false;

    // ★ 切换照片时：重置加载状态，但保持旧图显示
    setImageLoaded(false);
    setThumbnailLoaded(false);

    const thumbKey = `thumb:${effectiveUrl}`;
    const fullKey = `full:${effectiveUrl}`;

    // 重置最小显示时间状态
    setThumbDisplayReady(false);
    thumbLoadTimeRef.current = 0;

    // ① 两个都已缓存 → 瞬间显示
    if (preloadedUrls.current.has(thumbKey) && preloadedUrls.current.has(fullKey)) {
      setThumbnailLoaded(true);
      setDisplayedUrl(effectiveUrl);
      setImageLoaded(true);
      return;
    }

    // ② 并行加载缩略图和原图（真正的异步）
    
    // 加载缩略图（独立，不阻塞）- 使用 L1 缓存
    if (currentPhoto.thumbnail && !thumbUrls.current.has(thumbKey)) {
      const tImg = new window.Image();
      configureImageLoad(tImg, 'low');
      tImg.src = currentPhoto.thumbnail;
      tImg.onload = () => {
        if (cancelled) return;
        addToThumbCache(thumbKey, tImg);
        setThumbnailLoaded(true);
        thumbLoadTimeRef.current = Date.now();
      };
      tImg.onerror = () => {
        // 缩略图失败，直接标记为已加载（会跳过粒子显示）
        if (!cancelled) setThumbnailLoaded(true);
      };
    } else {
      // 没有缩略图或已缓存
      setThumbnailLoaded(true);
    }

    // ★ 等待最小显示时间的辅助函数
    const waitForMinDisplay = (callback: () => void) => {
      const MIN_DISPLAY_MS = 3000; // 最小 3 秒
      const elapsed = Date.now() - thumbLoadTimeRef.current;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
      
      setTimeout(() => {
        if (!cancelled) callback();
      }, remaining);
    };

    // 加载原图（独立，不阻塞）- 使用 L3 缓存
    if (!fullUrls.current.has(fullKey)) {
      const fImg = new window.Image();
      configureImageLoad(fImg, 'high');
      fImg.src = effectiveUrl;
      fImg.onload = async () => {
        if (cancelled) return;
        await decodeLoadedImage(fImg);
        if (cancelled) return;
        addToFullCache(fullKey, fImg);
        // ★ 原图加载完成，但等待最小显示时间
        waitForMinDisplay(() => {
          if (!cancelled) {
            setDisplayedUrl(effectiveUrl);
            setImageLoaded(true);
          }
        });
      };
      fImg.onerror = () => {
        if (cancelled) return;
        console.warn('⏭️ Image load failed, skipping:', currentPhoto.title);
        navigate(1);
      };
    } else {
      // 原图已缓存，更新 LRU 顺序，然后等待最小显示时间
      const cachedImg = fullCache.current.get(fullKey);
      if (cachedImg) addToFullCache(fullKey, cachedImg);
      waitForMinDisplay(() => {
        if (!cancelled) {
          setDisplayedUrl(effectiveUrl);
          setImageLoaded(true);
        }
      });
    }

    return () => { cancelled = true; };
  }, [safeIndex, effectiveUrl, currentPhoto?.thumbnail, addToThumbCache, addToFullCache]);

  // ⑤ 预加载后续照片（当前照片有任何一张加载到位就开始）
  useEffect(() => {
    if (imageLoaded || thumbnailLoaded) {
      preloadRange(safeIndex, filteredPhotos);
    }
  }, [imageLoaded, thumbnailLoaded, safeIndex, filteredPhotos, preloadRange]);

  // ⑥ Page Flip 模式：预加载下一张高清图，加载完成后恢复播放
  useEffect(() => {
    if (transition !== 'pageflip') {
      setNextImageReady(false);
      return;
    }

    const len = filteredPhotos.length;
    if (len <= 1) {
      setNextImageReady(true);
      return;
    }

    const nextIdx = getPlaybackIndex(safeIndex, 1, len);

    const nextPhoto = filteredPhotos[nextIdx];
    if (!nextPhoto) {
      setNextImageReady(true);
      return;
    }

    const nextUrl = imageQuality === 'original' && nextPhoto.originalUrl 
      ? nextPhoto.originalUrl 
      : nextPhoto.url;
    const fullKey = `full:${nextUrl}`;

    // 检查是否已缓存
    if (fullUrls.current.has(fullKey)) {
      // 更新 LRU 顺序
      const cachedImg = fullCache.current.get(fullKey);
      if (cachedImg) addToFullCache(fullKey, cachedImg);
      setNextImageReady(true);
      // 如果之前因为等待而暂停，恢复播放
      if (!isPlaying) {
        setIsPlaying(true);
      }
      return;
    }

    if (loadingFullUrls.current.has(fullKey)) {
      setNextImageReady(false);
      const waitForExistingLoad = window.setInterval(() => {
        if (fullUrls.current.has(fullKey)) {
          window.clearInterval(waitForExistingLoad);
          setNextImageReady(true);
          setIsPlaying(true);
          return;
        }

        if (!loadingFullUrls.current.has(fullKey)) {
          window.clearInterval(waitForExistingLoad);
          setNextImageReady(true);
          setIsPlaying(true);
        }
      }, 120);

      return () => window.clearInterval(waitForExistingLoad);
    }

    // 重置状态，开始加载
    setNextImageReady(false);

    // 预加载下一张高清图
    const fImg = new window.Image();
    configureImageLoad(fImg, 'high');
    loadingFullUrls.current.add(fullKey);
    fImg.src = nextUrl;
    fImg.onload = async () => {
      await decodeLoadedImage(fImg);
      addToFullCache(fullKey, fImg);
      loadingFullUrls.current.delete(fullKey);
      setNextImageReady(true);
      // 加载完成，恢复播放
      setIsPlaying(true);
    };
    fImg.onerror = () => {
      loadingFullUrls.current.delete(fullKey);
      // 加载失败也标记为准备好，避免卡住
      setNextImageReady(true);
      setIsPlaying(true);
    };

    return () => {
      // 清理，但让图片继续加载（不 abort）
    };
  }, [safeIndex, filteredPhotos, transition, imageQuality, isPlaying, addToFullCache, getPlaybackIndex]);

  /* ================================================================ */
  /*  加载 orientations                                                */
  /* ================================================================ */
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetchOrientations().then((o) => {
      if (cancelled) return;
      setPhotoOrientations(o);
      setOrientationsLoaded(true);
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  /* ================================================================ */
  /*  10秒空闲检测 - 自动开始放映                                       */
  /* ================================================================ */
  useEffect(() => {
    const IDLE_THRESHOLD = 10; // 10秒
    
    const interval = setInterval(() => {
      setIdleSeconds((prev) => {
        const next = prev + 1;
        if (next >= IDLE_THRESHOLD && !isPlaying && !isLoading) {
          // 达到阈值，自动开始播放
          setIsPlaying(true);
          return 0; // 重置计时
        }
        return next;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isPlaying, isLoading]);
  
  // 用户操作时重置空闲计时
  const resetIdleTimer = useCallback(() => {
    setIdleSeconds(0);
  }, []);
  
  useEffect(() => {
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    const handler = () => resetIdleTimer();
    
    events.forEach((e) => window.addEventListener(e, handler));
    return () => events.forEach((e) => window.removeEventListener(e, handler));
  }, [resetIdleTimer]);

  /* ================================================================ */
  /*  Controls 显示控制（不再自动隐藏）                                  */
  /* ================================================================ */
  const showControlsBriefly = useCallback(() => {
    setShowControls(true);
    // 不再自动隐藏，只隐藏设置面板
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      setShowSettings(false);
    }, 3000);
  }, []);

  useEffect(() => {
    const onMove = () => showControlsBriefly();
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [showControlsBriefly]);

  /* ================================================================ */
  /*  键盘控制                                                         */
  /* ================================================================ */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      showControlsBriefly();
      switch (e.key) {
        case 'Escape':     onClose(); break;
        case 'ArrowRight': navigate(1); break;
        case 'ArrowLeft':  navigate(-1); break;
        case ' ':          e.preventDefault(); setIsPlaying((p) => !p); break;
        case 's':          setShowSettings((p) => !p); break;
        case 'f':
          if (!document.fullscreenElement) containerRef.current?.requestFullscreen().catch(() => {});
          else document.exitFullscreen();
          break;
        case 't':          setTransition((p) => {
          const transitions: TransitionType[] = ['crossfade', 'kenburns', 'pageflip'];
          const currentIdx = transitions.indexOf(p);
          return transitions[(currentIdx + 1) % transitions.length];
        }); break;
        case 'r':          setIsRandomOrder((p) => !p); break;
        case 'm':          if (bgmLoaded && bgmList.length > 0) setIsMuted((p) => !p); break;
        case 'n':          if (bgmLoaded && bgmList.length > 0) setCurrentBgmIndex((p) => (p + 1) % bgmList.length); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, navigate, showControlsBriefly]);

  /* ================================================================ */
  /*  Cleanup - 幻灯片关闭时彻底清理所有资源                          */
  /* ================================================================ */
  useEffect(() => () => {
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    if (prevIndexTimer.current) clearTimeout(prevIndexTimer.current);
    
    // ★ 清理音频
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    
    // ★ 清理所有图片缓存
    thumbCache.current.clear();
    thumbUrls.current.clear();
    previewCache.current.clear();
    previewUrls.current.clear();
    fullCache.current.clear();
    fullUrls.current.clear();
    preloadedUrls.current.clear();
    imageCache.current.clear();
    loadingFullUrls.current.clear();
    kenBurnsCache.current.clear();
    
    // ★ 清理预加载队列
    fullPreloadQueue.current = [];
    loadingFullCount.current = 0;
    
    console.log('🧹 Slideshow cleanup: all resources released');
  }, []);

  /* ================================================================ */
  /*  Derived                                                          */
  /* ================================================================ */
  const currentOrientation = currentPhoto ? (photoOrientations[currentPhoto.id] ?? 'landscape') : 'landscape';
  const isPortrait = currentOrientation === 'portrait';
  const previousPlaybackPhoto = filteredPhotos.length > 1
    ? filteredPhotos[getPlaybackIndex(safeIndex, -1)]
    : undefined;
  const nextPlaybackPhoto = filteredPhotos.length > 1
    ? filteredPhotos[getPlaybackIndex(safeIndex, 1)]
    : undefined;

  const changeInterval = useCallback((sec: IntervalOption) => {
    setIntervalSec(sec);
    playStateRef.current.intervalSec = sec;
    setShowSettings(false);
  }, []);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */
  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center overflow-hidden safe-screen"
      onClick={showControlsBriefly}
    >
      {/* Loading */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 border-4 border-white/10 border-t-yellow-400/60 rounded-full animate-spin" />
            <p className="text-white/60 text-lg">Preparing slideshow...</p>
          </div>
        </div>
      )}

      {/* Empty */}
      {!isLoading && filteredPhotos.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-4">
            <p className="text-white/60 text-xl">No photos found for this filter</p>
            <button
              onClick={() => setOrientationFilter('all')}
              className="px-6 py-3 bg-yellow-400 text-black rounded-full font-medium hover:bg-yellow-300 transition-colors"
            >
              Show All Photos
            </button>
          </div>
        </div>
      )}

      {/* ★ Main Image Area */}
      <div className={`absolute inset-0 flex items-center justify-center p-3 sm:p-5 md:p-8 transition-opacity duration-500 ${isLoading ? 'opacity-0' : 'opacity-100'}`}>
        {/* 3D Page Flip Container */}
        <div 
          className="relative w-full h-full"
          style={{
            perspective: '1200px',
            transformStyle: 'preserve-3d',
          }}
        >
          {currentPhoto && !isPortrait && (
            <div className="relative w-full h-full overflow-hidden transition-all duration-500 ease-out">
              {/* Exiting image - with page flip animation */}
              {prevIndex !== null && filteredPhotos[prevIndex] && transition === 'pageflip' && isFlipping && (
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ 
                    zIndex: 2,
                    transformOrigin: flipDirection === 'right' ? 'left center' : 'right center',
                    animation: `pageFlipOut${flipDirection === 'right' ? 'Right' : 'Left'} ${TRANSITION_MS}ms ease-in-out forwards`,
                    transformStyle: 'preserve-3d',
                  }}
                >
                  <img
                    src={filteredPhotos[prevIndex].url}
                    alt=""
                    className="max-w-full max-h-full object-contain"
                    style={{
                      backfaceVisibility: 'hidden',
                    }}
                  />
                  {/* 翻页时的背面阴影效果 */}
                  <div 
                    className="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent"
                    style={{
                      transform: 'rotateY(180deg)',
                      backfaceVisibility: 'hidden',
                    }}
                  />
                </div>
              )}
              
              {/* Exiting image - normal fade */}
              {prevIndex !== null && filteredPhotos[prevIndex] && transition !== 'pageflip' && (
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ zIndex: 0, opacity: 0, transition: `opacity ${TRANSITION_MS}ms ease` }}
                >
                  <img
                    src={filteredPhotos[prevIndex].url}
                    alt=""
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              )}
              
              {/* 加载状态：缩略图也没加载出来时显示呼吸粒子 */}
              {!imageLoaded && !thumbnailLoaded && (
                <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 1 }}>
                  <div className="relative">
                    {/* 呼吸的光晕效果 */}
                    <div 
                      className="w-32 h-32 rounded-full bg-gradient-to-br from-yellow-400/30 to-orange-500/20"
                      style={{
                        animation: 'breathe 2s ease-in-out infinite',
                        filter: 'blur(20px)',
                      }}
                    />
                    {/* 中心点 */}
                    <div 
                      className="absolute inset-0 m-auto w-4 h-4 rounded-full bg-yellow-400/60"
                      style={{
                        animation: 'breathe 2s ease-in-out infinite 0.3s',
                      }}
                    />
                  </div>
                </div>
              )}
              
              {/* 梦幻粒子效果（原图加载中时显示） */}
              {!imageLoaded && thumbnailLoaded && particleLevel > 0 && (
                <DreamParticles
                  thumbnailUrl={currentPhoto.thumbnail}
                  visible={true}
                  particleCount={particleLevel}
                  shouldDestroy={false}
                />
              )}
              {/* 缩略图（半透明叠加在粒子上） */}
              {!imageLoaded && thumbnailLoaded && (
                <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 1 }}>
                  <img
                    key={`${currentPhoto.id}-thumb`}
                    src={currentPhoto.thumbnail}
                    alt={currentPhoto.title}
                    className="max-w-full max-h-full object-contain select-none"
                    draggable={false}
                    style={{ filter: 'blur(20px)', opacity: 0.35 }}
                  />
                </div>
              )}
              
              {/* Entering / Active image */}
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{
                  zIndex: 1,
                  opacity: imageLoaded ? 1 : 0,
                  transition: transition === 'pageflip' && isFlipping 
                    ? 'none'
                    : `opacity ${TRANSITION_MS}ms ease`,
                  animation: transition === 'pageflip' && isFlipping
                    ? `pageFlipIn${flipDirection === 'right' ? 'Right' : 'Left'} ${TRANSITION_MS}ms ease-in-out forwards`
                    : undefined,
                  transformOrigin: flipDirection === 'right' ? 'right center' : 'left center',
                  transformStyle: 'preserve-3d',
                }}
              >
                <div
                  className="w-full h-full flex items-center justify-center overflow-hidden"
                  style={
                    transition === 'kenburns' && imageLoaded
                      ? {
                          transform: `scale(${getKenBurns(safeIndex).endScale}) translate(${getKenBurns(safeIndex).endX}%, ${getKenBurns(safeIndex).endY}%)`,
                          transition: `transform ${intervalSec * 1000}ms cubic-bezier(0.25,0.1,0.25,1)`,
                        }
                      : undefined
                  }
                >
                  <img
                    key={currentPhoto.id}
                    src={displayedUrl}
                    alt={currentPhoto.title}
                    className="max-w-full max-h-full object-contain select-none"
                    draggable={false}
                  />
                </div>
              </div>
            </div>
          )}

        {currentPhoto && isPortrait && (
          <div className="flex gap-0 md:gap-4 h-full w-full items-center transition-all duration-500 ease-out">
            <div className="hidden md:block flex-1 h-full opacity-30">
              {previousPlaybackPhoto && (
                <img
                  src={previousPlaybackPhoto.thumbnail}
                  alt=""
                  className="w-full h-full object-contain"
                  decoding="async"
                />
              )}
            </div>
            <div className="flex-1 md:flex-[2] h-full relative overflow-hidden">
              {/* Ken Burns wrapper for portrait */}
              <div
                className="w-full h-full"
                style={
                  transition === 'kenburns' && imageLoaded
                    ? {
                        transform: `scale(${getKenBurns(safeIndex).endScale}) translate(${getKenBurns(safeIndex).endX}%, ${getKenBurns(safeIndex).endY}%)`,
                        transition: `transform ${intervalSec * 1000}ms cubic-bezier(0.25,0.1,0.25,1)`,
                      }
                    : undefined
                }
              >
                {/* 梦幻粒子效果（原图加载中时显示） */}
                <DreamParticles
                  thumbnailUrl={currentPhoto.thumbnail}
                  visible={!imageLoaded && particleLevel > 0}
                  particleCount={particleLevel}
                  shouldDestroy={imageLoaded || particleLevel === 0}
                />
                {/* 缩略图（半透明叠加在粒子上） */}
                {!imageLoaded && thumbnailLoaded && (
                  <img
                    key={`${currentPhoto.id}-thumb`}
                    src={currentPhoto.thumbnail}
                    alt={currentPhoto.title}
                    className="absolute inset-0 w-full h-full object-contain"
                    style={{ zIndex: 1, filter: 'blur(20px)', opacity: 0.35 }}
                  />
                )}
                {/* 原图（加载完成后才设置 src，避免渐进式渲染） */}
                <img
                  key={currentPhoto.id}
                  src={displayedUrl}
                  alt={currentPhoto.title}
                  className="absolute inset-0 w-full h-full object-contain"
                  style={{
                    zIndex: 2,
                    opacity: imageLoaded ? 1 : 0,
                    transition: `opacity ${TRANSITION_MS}ms ease`,
                  }}
                />
              </div>
            </div>
            <div className="hidden md:block flex-1 h-full opacity-30">
              {nextPlaybackPhoto && (
                <img
                  src={nextPlaybackPhoto.thumbnail}
                  alt=""
                  className="w-full h-full object-contain"
                  decoding="async"
                />
              )}
            </div>
          </div>
        )}

        {!currentPhoto && !isPortrait && <div className="text-white/40 text-xl">No photos to display</div>}
      </div>
      </div>

      {/* Vignette */}
      <div className="absolute inset-0 z-10 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.3) 100%)' }} />

      {/* Top Bar */}
      <div className={`absolute top-0 left-0 right-0 z-20 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="flex items-center justify-between px-3 sm:px-5 md:px-8 py-3 sm:py-5 md:py-6 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:pt-5 md:pt-6">
          <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-2.5 md:p-3 text-white/30 hover:text-white/70 rounded-full hover:bg-white/5 transition-colors" title="Exit (ESC)">
            <X size={24} strokeWidth={1.5} />
          </button>
          <div className="flex items-center gap-1.5 sm:gap-3">
            {/* BGM Mute Toggle with Hover Track Name */}
            {bgmLoaded && bgmList.length > 0 && (
              <div className="group relative flex items-center">
                {/* Current Track Name - appears on hover */}
                <div 
                  className={`hidden sm:flex absolute right-full mr-2 items-center gap-2 px-3 py-1.5 rounded-full whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0 cursor-pointer select-none ${isMuted ? 'bg-white/5' : 'bg-yellow-400/10'}`}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setShowSongList((p) => !p);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // 右键切下一首
                    setCurrentBgmIndex((prev) => (prev + 1) % bgmList.length);
                  }}
                  title="双击显示列表 · 右键下一首"
                >
                  <Music size={14} className={`${isMuted ? 'text-white/40' : 'text-yellow-400'} flex-shrink-0`} />
                  <span className={`text-sm max-w-[200px] truncate ${isMuted ? 'text-white/50' : 'text-yellow-200'}`}>
                    {bgmList[currentBgmIndex]?.filename.replace(/\.[^/.]+$/, '')}
                  </span>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); setIsMuted((p) => !p); }} 
                  className={`p-2.5 md:p-3 rounded-full transition-colors ${isMuted ? 'text-white/30 hover:text-white/70 hover:bg-white/5' : 'text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10'}`} 
                  title={isMuted ? 'Unmute Music (M)' : 'Mute Music (M)'}
                >
                  {isMuted ? <VolumeX size={20} strokeWidth={1.5} /> : <Volume2 size={20} strokeWidth={1.5} />}
                </button>
              </div>
            )}
            <button onClick={(e) => { e.stopPropagation(); setShowSettings((p) => !p); }} className={`p-2.5 md:p-3 rounded-full transition-colors ${showSettings ? 'bg-yellow-400 text-black' : 'text-white/30 hover:text-white/70 hover:bg-white/5'}`} title="Settings (S)">
              <Settings size={20} strokeWidth={1.5} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setIsPlaying((p) => !p); }} className="p-2.5 md:p-3 text-white/30 hover:text-white/70 hover:bg-white/5 rounded-full transition-colors" title={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? <Pause size={24} strokeWidth={1.5} /> : <Play size={24} strokeWidth={1.5} />}
            </button>
          </div>
        </div>
      </div>

      {/* Settings Panel */}
      <div 
        className={`absolute top-20 sm:top-24 left-3 right-3 sm:left-auto sm:right-8 z-20 transition-all duration-300 ${showSettings && showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-5 w-full sm:w-80 shadow-2xl max-h-[70svh] overflow-y-auto">
          <h3 className="text-white font-medium mb-4 text-lg">Settings</h3>

          {/* Duration */}
          <div className="space-y-2 mb-4">
            <p className="text-white/60 text-xs flex items-center gap-2"><Clock size={14} /> Duration</p>
            <div className="grid grid-cols-6 gap-1">
              {([3, 5, 8, 10, 15, 30] as IntervalOption[]).map((sec) => (
                <button
                  key={sec}
                  onClick={(e) => { e.stopPropagation(); changeInterval(sec); }}
                  className={`px-1 py-2 rounded-lg text-xs font-medium transition-all ${intervalSec === sec ? 'bg-yellow-400 text-black' : 'bg-white/5 text-white/80 hover:bg-white/10'}`}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>

          {/* Transition */}
          <div className="space-y-3 mb-5">
            <p className="text-white/60 text-sm flex items-center gap-2"><Crop size={16} /> Transition</p>
            <div className="grid grid-cols-3 gap-2">
              {(['crossfade', 'kenburns', 'pageflip'] as TransitionType[]).map((t) => (
                <button
                  key={t}
                  onClick={(e) => { e.stopPropagation(); setTransition(t); }}
                  className={`px-2 py-3 rounded-xl text-xs font-medium transition-all border-2 ${transition === t ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-white/5 text-white/80 hover:bg-white/10 border-transparent'}`}
                >
                  {t === 'crossfade' ? 'Fade' : t === 'kenburns' ? 'Pan' : '📖 Flip'}
                </button>
              ))}
            </div>
          </div>

          {/* Playback Order */}
          <div className="space-y-2 mb-4">
            <p className="text-white/60 text-xs flex items-center gap-2">🔀 Order</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setIsRandomOrder(false); }}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${!isRandomOrder ? 'bg-yellow-400 text-black' : 'bg-white/5 text-white/80 hover:bg-white/10'}`}
              >
                ➡️ Sequential
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setIsRandomOrder(true); }}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${isRandomOrder ? 'bg-yellow-400 text-black' : 'bg-white/5 text-white/80 hover:bg-white/10'}`}
              >
                🔀 Random
              </button>
            </div>
          </div>

          {/* Image Quality */}
          <div className="space-y-2 mb-4">
            <p className="text-white/60 text-xs flex items-center gap-2">🖼️ Quality</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setImageQuality('display'); }}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${imageQuality === 'display' ? 'bg-yellow-400 text-black' : 'bg-white/5 text-white/80 hover:bg-white/10'}`}
              >
                ⚡ 4K 压缩
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setImageQuality('original'); }}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${imageQuality === 'original' ? 'bg-yellow-400 text-black' : 'bg-white/5 text-white/80 hover:bg-white/10'}`}
              >
                💎 无损原图
              </button>
            </div>
          </div>

          {/* Orientation */}
          <div className="space-y-2 mb-4">
            <p className="text-white/60 text-xs flex items-center gap-2"><Crop size={14} /> Orientation</p>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: 'all' as const, icon: Image, label: 'All' },
                { key: 'landscape' as const, icon: Monitor, label: 'Land' },
                { key: 'portrait' as const, icon: Columns3, label: 'Port' },
              ]).map(({ key, icon: Icon, label }) => (
                <button
                  key={key}
                  onClick={(e) => { e.stopPropagation(); setOrientationFilter(key); }}
                  className={`px-2 py-2 rounded-lg text-xs font-medium transition-all flex flex-col items-center gap-1 ${orientationFilter === key ? 'bg-yellow-400 text-black' : 'bg-white/5 text-white/80 hover:bg-white/10'}`}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Particle Toggle + Slider */}
          <div className="space-y-2 mb-4">
            <div className="flex items-center justify-between">
              <span className="text-white/70 text-sm">✨ 粒子效果</span>
              <button
                onClick={(e) => { e.stopPropagation(); setParticleLevel((prev) => prev > 0 ? 0 : 5); }}
                className={`w-12 h-6 rounded-full transition-all ${
                  particleLevel > 0 ? 'bg-amber-500' : 'bg-white/20'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform ${
                    particleLevel > 0 ? 'translate-x-6' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            {particleLevel > 0 && (
              <div className="flex items-center gap-3 pt-1">
                <span className="text-white/40 text-xs">少量</span>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={particleLevel}
                  onChange={(e) => { setParticleLevel(parseInt(e.target.value)); }}
                  className="flex-1 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-yellow-400"
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="text-white/40 text-xs">密集</span>
              </div>
            )}
          </div>

          {/* Music Mode */}
          <div className="space-y-2 mb-4">
            <p className="text-white/60 text-xs flex items-center gap-2">🎵 音乐模式</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setMusicMode('background'); }}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${musicMode === 'background' ? 'bg-yellow-400 text-black' : 'bg-white/5 text-white/80 hover:bg-white/10'}`}
              >
                🎧 背景音
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setMusicMode('companion'); }}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${musicMode === 'companion' ? 'bg-yellow-400 text-black' : 'bg-white/5 text-white/80 hover:bg-white/10'}`}
              >
                🎶 伴随
              </button>
            </div>
            <p className="text-white/30 text-[10px]">
              {musicMode === 'background' ? '幻灯片暂停时音乐继续播放' : '音乐与幻灯片同步暂停/播放'}
            </p>
          </div>

          {/* Shortcuts */}
          <div className="mt-4 pt-4 border-t border-white/10 text-white/40 text-xs space-y-1">
            <div><span className="text-white/60">Space</span> Play/Pause</div>
            <div><span className="text-white/60">← →</span> Navigate</div>
            <div><span className="text-white/60">ESC</span> Exit</div>
            <div><span className="text-white/60">T</span> Transition ({transition})</div>
            <div><span className="text-white/60">R</span> Order ({isRandomOrder ? 'Random' : 'Sequential'})</div>
            <div><span className="text-white/60">M</span> Music</div>
            <div><span className="text-white/60">N</span> Next Song</div>
          </div>
        </div>
      </div>

      {/* Navigation Arrows */}
      <button onClick={(e) => { e.stopPropagation(); navigate(-1); }} className={`absolute left-1 sm:left-4 z-10 p-2 text-white/20 hover:text-white/60 transition-all ${showControls ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}>
        <ChevronLeft size={32} strokeWidth={1.5} />
      </button>
      <button onClick={(e) => { e.stopPropagation(); navigate(1); }} className={`absolute right-1 sm:right-4 z-10 p-2 text-white/20 hover:text-white/60 transition-all ${showControls ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}>
        <ChevronRight size={32} strokeWidth={1.5} />
      </button>

      {/* Bottom Info - 始终显示 */}
      <div className="absolute bottom-0 left-0 right-0 z-30">
        <div className="bg-gradient-to-t from-black/70 via-black/30 to-transparent pt-20 md:pt-32 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-8 px-3 sm:px-4 md:px-10">
          <div className="flex items-end justify-between gap-3 max-w-6xl mx-auto">
            {currentPhoto && (
              <div className="flex-1 min-w-0">
                {/* 照片标题/意境描述 - 幻灯片时不显示 */}
                {!isPlaying && (
                  <h2 className="text-white text-base sm:text-lg md:text-2xl font-light tracking-wide mb-2 truncate">
                    {photoAnalysis?.depict || currentPhoto.title}
                  </h2>
                )}
                {/* 移动端：双排布局 */}
                <div className="md:hidden flex flex-col gap-1.5 text-white/60 text-xs font-light">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    {currentPhoto.category && (
                      <span className="flex items-center gap-1">
                        <span className="text-yellow-400/80">📁</span>
                        <span className="truncate max-w-[8rem]">{currentPhoto.category}</span>
                      </span>
                    )}
                    {currentPhoto.date && (
                      <span className="flex items-center gap-1">
                        <span className="text-yellow-400/80">📅</span>
                        {currentPhoto.date}
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 bg-white/10 rounded text-[10px] uppercase text-white/50">{currentOrientation}</span>
                  </div>
                  {currentPhoto.exif && (
                    <div className="flex items-center gap-1 text-white/40 text-[11px]">
                      <span>📷</span>
                      <span className="truncate">
                        {currentPhoto.exif.camera}
                        {currentPhoto.exif.aperture && ` · ${currentPhoto.exif.aperture}`}
                        {currentPhoto.exif.shutter && ` · ${currentPhoto.exif.shutter}`}
                        {currentPhoto.exif.iso && ` · ISO ${currentPhoto.exif.iso}`}
                      </span>
                    </div>
                  )}
                </div>
                {/* 桌面端：单排布局 */}
                <div className="hidden md:flex items-center gap-4 text-white/60 text-sm font-light">
                  {/* 文件夹/分类 */}
                  {currentPhoto.category && (
                    <span className="flex items-center gap-1.5">
                      <span className="text-yellow-400/80">📁</span>
                      {currentPhoto.category}
                    </span>
                  )}
                  {/* 拍摄时间 */}
                  {currentPhoto.date && (
                    <span className="flex items-center gap-1.5">
                      <span className="text-yellow-400/80">📅</span>
                      <span className="truncate">{currentPhoto.date}</span>
                    </span>
                  )}
                  {/* EXIF 信息 */}
                  {currentPhoto.exif && (
                    <span className="flex items-center gap-1.5 text-white/40">
                      <span>📷</span>
                      {currentPhoto.exif.camera}
                      {currentPhoto.exif.aperture && ` · ${currentPhoto.exif.aperture}`}
                      {currentPhoto.exif.shutter && ` · ${currentPhoto.exif.shutter}`}
                      {currentPhoto.exif.iso && ` · ISO ${currentPhoto.exif.iso}`}
                    </span>
                  )}
                  <span className="px-2 py-0.5 bg-white/10 rounded text-xs uppercase text-white/50">{currentOrientation}</span>
                </div>
                {/* 空闲倒计时提示 */}
                {!isPlaying && idleSeconds > 0 && (
                  <div className="mt-3 text-white/30 text-xs">
                    {idleSeconds < 10 ? (
                      <span>⏳ {10 - idleSeconds}秒后自动播放</span>
                    ) : (
                      <span>▶️ 即将开始...</span>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="text-white/40 text-xs md:text-sm font-light tabular-nums flex-shrink-0">
              {safeIndex + 1} / {filteredPhotos.length}
            </div>
          </div>
        </div>
      </div>

      {/* Progress Bar - 使用 ref 避免重渲染 */}
      <ProgressBar
        isPlaying={isPlaying}
        intervalSec={intervalSec}
        isLoading={isLoading}
        currentIndex={currentIndex}
        onComplete={handleProgressComplete}
      />
      
      {/* Song List Popup */}
      {showSongList && bgmList.length > 0 && (
        <div 
          className="absolute top-20 sm:top-24 left-3 right-3 sm:left-auto sm:right-8 z-30"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl p-4 w-full sm:w-72 shadow-2xl max-h-[50svh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-medium text-sm flex items-center gap-2">
                <Music size={14} className="text-yellow-400" />
                歌曲列表
              </h3>
              <button 
                onClick={(e) => { e.stopPropagation(); setShowSongList(false); }}
                className="text-white/40 hover:text-white/70 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-1">
              {bgmList.map((bgm, idx) => (
                <button
                  key={bgm.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentBgmIndex(idx);
                    setShowSongList(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2 ${
                    idx === currentBgmIndex
                      ? 'bg-yellow-400/20 text-yellow-300'
                      : 'text-white/70 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span className="text-xs text-white/30 w-5 text-right flex-shrink-0">
                    {idx === currentBgmIndex ? '▶' : `${idx + 1}`}
                  </span>
                  <span className="truncate">
                    {bgm.filename.replace(/\.[^/.]+$/, '')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      
      {/* Animation Styles */}
      <style>{`
        @keyframes breathe {
          0%, 100% {
            transform: scale(0.8);
            opacity: 0.4;
          }
          50% {
            transform: scale(1.2);
            opacity: 0.8;
          }
        }
        
        @keyframes pageFlipOutRight {
          0% {
            transform: rotateY(0deg);
            opacity: 1;
          }
          100% {
            transform: rotateY(-90deg);
            opacity: 0.3;
          }
        }
        
        @keyframes pageFlipOutLeft {
          0% {
            transform: rotateY(0deg);
            opacity: 1;
          }
          100% {
            transform: rotateY(90deg);
            opacity: 0.3;
          }
        }
        
        @keyframes pageFlipInRight {
          0% {
            transform: rotateY(90deg);
            opacity: 0.3;
          }
          100% {
            transform: rotateY(0deg);
            opacity: 1;
          }
        }
        
        @keyframes pageFlipInLeft {
          0% {
            transform: rotateY(-90deg);
            opacity: 0.3;
          }
          100% {
            transform: rotateY(0deg);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
};

export default Slideshow;
