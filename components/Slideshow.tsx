import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Play, Pause, ChevronLeft, ChevronRight,
  Clock, Settings, Monitor, Image, Crop, Columns3,
  Volume2, VolumeX, Music
} from 'lucide-react';
import { Photo } from '../types';

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
    const res = await fetch('/api/orientations');
    const data = await res.json();
    return data.success ? data.orientations : {};
  } catch { return {}; }
};

const TRANSITION_MS = 1200;
const PROGRESS_TICK = 100; // ms

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
const Slideshow: React.FC<SlideshowProps> = ({ photos, initialIndex = 0, onClose }) => {
  /* ---------- 所有 UI 状态 ---------- */
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [prevIndex, setPrevIndex]       = useState<number | null>(null);
  const [isPlaying, setIsPlaying]       = useState(false); // 默认暂停，10秒后自动开始
  const [intervalSec, setIntervalSec]   = useState<IntervalOption>(5);
  const [showControls, setShowControls] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [imageLoaded, setImageLoaded]   = useState(false);
  const [orientationFilter, setOrientationFilter] = useState<OrientationFilter>('all');
  const [photoOrientations, setPhotoOrientations] = useState<Record<string, 'landscape' | 'portrait' | 'square'>>({});
  const [orientationsLoaded, setOrientationsLoaded] = useState(false);
  const [isLoading, setIsLoading]       = useState(true);
  const [transition, setTransition]     = useState<TransitionType>('kenburns');
  const [progress, setProgress]         = useState(0);
  const [idleSeconds, setIdleSeconds]   = useState(0); // 空闲计时
  const [isRandomOrder, setIsRandomOrder] = useState(false); // 随机播放/顺序播放
  const [shuffledIndices, setShuffledIndices] = useState<number[]>([]); // 随机排序后的索引
  
  /* ---------- Page Flip 状态 ---------- */
  const [flipDirection, setFlipDirection] = useState<FlipDirection>('right');
  const [isFlipping, setIsFlipping]       = useState(false);

  /* ---------- BGM 状态 ---------- */
  const [bgmList, setBgmList]           = useState<{id: string, filename: string, url: string}[]>([]);
  const [currentBgmIndex, setCurrentBgmIndex] = useState(0);
  const [isMuted, setIsMuted]           = useState(true); // 默认静音
  const [bgmLoaded, setBgmLoaded]       = useState(false);

  /* ---------- Refs ---------- */
  const containerRef     = useRef<HTMLDivElement>(null);
  const controlsTimer    = useRef<ReturnType<typeof setTimeout>>();
  const prevIndexTimer   = useRef<ReturnType<typeof setTimeout>>();
  const kenBurnsCache    = useRef<Map<number, KenBurnsTransform>>(new Map());
  const audioRef         = useRef<HTMLAudioElement | null>(null);

  // ★ 核心：用一个 ref 保存自动播放需要读取的所有"最新值"
  // 这样定时器回调永远读到最新状态，不需要重建定时器
  const playStateRef = useRef({
    isPlaying: true,
    intervalSec: 5 as IntervalOption,
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
  
  // 预加载下一张照片（顺序播放和随机播放都支持）
  const preloadNextPhoto = useCallback(() => {
    if (filteredPhotos.length <= 1) return;
    
    let nextIndex: number;
    if (isRandomOrder && shuffledIndices.length > 0) {
      // 随机播放：找到当前在随机列表中的位置，取下一个
      const currentShuffledIdx = shuffledIndices.indexOf(currentIndex);
      const nextShuffledIdx = (currentShuffledIdx + 1) % shuffledIndices.length;
      nextIndex = shuffledIndices[nextShuffledIdx];
    } else {
      // 顺序播放
      nextIndex = (currentIndex + 1) % filteredPhotos.length;
    }
    
    const nextPhoto = filteredPhotos[nextIndex];
    if (nextPhoto) {
      const img = new window.Image();
      img.src = nextPhoto.url;
      console.log('📥 Preloading next photo:', nextIndex, nextPhoto.title);
    }
  }, [currentIndex, filteredPhotos, isRandomOrder, shuffledIndices]);

  useEffect(() => { playStateRef.current.isPlaying = isPlaying; }, [isPlaying]);
  useEffect(() => { playStateRef.current.intervalSec = intervalSec; }, [intervalSec]);
  useEffect(() => { playStateRef.current.isLoading = isLoading; }, [isLoading]);

  /* ---------- BGM 加载和控制 ---------- */
  // 加载 BGM 列表
  useEffect(() => {
    const loadBgmList = async () => {
      try {
        const res = await fetch('/api/bgm/list');
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

    // 根据静音状态和幻灯片播放状态控制音乐
    // 静音 或 幻灯片暂停 时，音乐暂停
    if (isMuted || !isPlaying) {
      audio.pause();
    } else {
      // 非静音且幻灯片播放中，音乐从当前进度续播
      audio.play().catch(err => console.log('Audio play failed:', err));
    }

    // 当前歌曲结束，播放下一首
    const handleEnded = () => {
      setCurrentBgmIndex((prev) => (prev + 1) % bgmList.length);
    };

    audio.addEventListener('ended', handleEnded);
    return () => audio.removeEventListener('ended', handleEnded);
  }, [bgmLoaded, bgmList, currentBgmIndex, isMuted, isPlaying]);

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
    setProgress(0);

    // 清除上一次的 prevIndex 清理定时器
    if (prevIndexTimer.current) clearTimeout(prevIndexTimer.current);
    prevIndexTimer.current = setTimeout(() => {
      setPrevIndex(null);
      setIsFlipping(false);
    }, TRANSITION_MS + 200);
  }, [isRandomOrder, shuffledIndices]); // 依赖随机播放状态

  /* ================================================================ */
  /*  ★ 自动播放：唯一的一个 setInterval，mount 时创建，unmount 时销毁  */
  /*  回调内通过 ref 读取最新状态，永远不需要重建                       */
  /* ================================================================ */
  useEffect(() => {
    const elapsed = { current: 0 };

    const tick = () => {
      const { isPlaying: playing, intervalSec: sec, isLoading: loading, filteredLength: len } = playStateRef.current;

      if (!playing || loading || len <= 1) {
        // 暂停时重置进度（可选）
        elapsed.current = 0;
        setProgress(0);
        return;
      }

      elapsed.current += PROGRESS_TICK;
      const total = sec * 1000;
      const pct = Math.min(elapsed.current / total, 1);
      setProgress(pct);

      if (elapsed.current >= total) {
        elapsed.current = 0;
        setProgress(0);
        // 翻页
        navigate(1);
      }
    };

    const id = window.setInterval(tick, PROGRESS_TICK);
    return () => window.clearInterval(id);
  }, [navigate]); // navigate 是稳定的，所以这个 Effect 只跑一次

  // 手动翻页时重置计时
  // （navigate 里已经 setProgress(0)，但 elapsed 在 interval 闭包里，
  //   所以我们用一个额外 ref 来通知 interval 重置 elapsed）
  // → 更简洁的做法：让 interval 监听 currentIndex 变化自动重置
  const lastIndexRef = useRef(currentIndex);
  useEffect(() => {
    // currentIndex 变了 = 翻页了（不管手动还是自动），interval 的 elapsed 需要重置
    // 由于 elapsed 在闭包里我们拿不到，改用另一种方式：
    // 直接重启 interval（只在 index 变化时）
    // 但这又回到了老路... 所以我们改为：
    // 把 elapsed 也放到 ref 里
    lastIndexRef.current = currentIndex;
  }, [currentIndex]);

  // ★ 更干净的做法：把 elapsed 也放到 playStateRef
  // 重写上面的自动播放 Effect：

  // （删除上面的 useEffect，用下面这个替代）

  /* ================================================================ */
  /*  图片预加载                                                       */
  /* ================================================================ */
  useEffect(() => {
    if (!currentPhoto) return;
    let cancelled = false;
    const img = new window.Image();
    img.src = currentPhoto.url;
    img.onload = () => { if (!cancelled) setImageLoaded(true); };
    img.onerror = () => {
      if (!cancelled) {
        // 加载失败直接跳过，不重试（避免循环）
        console.warn('⏭️ Image load failed, skipping:', currentPhoto.title);
        navigate(1);
      }
    };
    return () => { cancelled = true; img.src = ''; };
  }, [safeIndex, currentPhoto?.url]); // 只在真正换照片时触发

  // 预加载下一张（使用智能预加载，支持随机和顺序播放）
  useEffect(() => {
    // 当前照片加载完成后，预加载下一张
    if (imageLoaded) {
      preloadNextPhoto();
    }
  }, [imageLoaded, preloadNextPhoto]);

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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, navigate, showControlsBriefly]);

  /* ================================================================ */
  /*  Cleanup                                                          */
  /* ================================================================ */
  useEffect(() => () => {
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    if (prevIndexTimer.current) clearTimeout(prevIndexTimer.current);
  }, []);

  /* ================================================================ */
  /*  Derived                                                          */
  /* ================================================================ */
  const currentOrientation = currentPhoto ? (photoOrientations[currentPhoto.id] ?? 'landscape') : 'landscape';
  const isPortrait = currentOrientation === 'portrait';

  const changeInterval = useCallback((sec: IntervalOption) => {
    setIntervalSec(sec);
    playStateRef.current.intervalSec = sec;
    setProgress(0);
    setShowSettings(false);
  }, []);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */
  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center overflow-hidden"
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
      <div className={`absolute inset-0 flex items-center justify-center p-8 transition-opacity duration-500 ${isLoading ? 'opacity-0' : 'opacity-100'}`}>
        {/* 3D Page Flip Container */}
        <div 
          className="relative w-full h-full"
          style={{
            perspective: '1200px',
            transformStyle: 'preserve-3d',
          }}
        >
          {currentPhoto && !isPortrait && (
            <div className="relative w-full h-full overflow-hidden">
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
                    src={currentPhoto.url}
                    alt={currentPhoto.title}
                    className="max-w-full max-h-full object-contain select-none"
                    draggable={false}
                  />
                </div>
              </div>
            </div>
          )}

        {currentPhoto && isPortrait && (
          <div className="flex gap-4 h-full items-center">
            <div className="flex-1 h-full opacity-30">
              {filteredPhotos.length > 1 && (
                <img
                  src={filteredPhotos[(safeIndex - 1 + filteredPhotos.length) % filteredPhotos.length].url}
                  alt=""
                  className="w-full h-full object-contain"
                />
              )}
            </div>
            <div className="flex-[2] h-full relative">
              <img
                key={currentPhoto.id}
                src={currentPhoto.url}
                alt={currentPhoto.title}
                className={`w-full h-full object-contain transition-opacity duration-700 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
              />
            </div>
            <div className="flex-1 h-full opacity-30">
              {filteredPhotos.length > 1 && (
                <img
                  src={filteredPhotos[(safeIndex + 1) % filteredPhotos.length].url}
                  alt=""
                  className="w-full h-full object-contain"
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
        <div className="flex items-center justify-between px-8 py-6">
          <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-3 text-white/30 hover:text-white/70 rounded-full hover:bg-white/5 transition-colors" title="Exit (ESC)">
            <X size={24} strokeWidth={1.5} />
          </button>
          <div className="flex items-center gap-3">
            {/* BGM Mute Toggle */}
            {bgmLoaded && bgmList.length > 0 && (
              <button 
                onClick={(e) => { e.stopPropagation(); setIsMuted((p) => !p); }} 
                className={`p-3 rounded-full transition-colors ${isMuted ? 'text-white/30 hover:text-white/70 hover:bg-white/5' : 'text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10'}`} 
                title={isMuted ? 'Unmute Music (M)' : 'Mute Music (M)'}
              >
                {isMuted ? <VolumeX size={20} strokeWidth={1.5} /> : <Volume2 size={20} strokeWidth={1.5} />}
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); setShowSettings((p) => !p); }} className={`p-3 rounded-full transition-colors ${showSettings ? 'bg-yellow-400 text-black' : 'text-white/30 hover:text-white/70 hover:bg-white/5'}`} title="Settings (S)">
              <Settings size={20} strokeWidth={1.5} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); setIsPlaying((p) => !p); }} className="p-3 text-white/30 hover:text-white/70 hover:bg-white/5 rounded-full transition-colors" title={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? <Pause size={24} strokeWidth={1.5} /> : <Play size={24} strokeWidth={1.5} />}
            </button>
          </div>
        </div>
      </div>

      {/* Settings Panel */}
      <div 
        className={`absolute top-24 right-8 z-20 transition-all duration-300 ${showSettings && showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-5 w-80 shadow-2xl max-h-[70vh] overflow-y-auto">
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

          {/* Shortcuts */}
          <div className="mt-4 pt-4 border-t border-white/10 text-white/40 text-xs space-y-1">
            <div><span className="text-white/60">Space</span> Play/Pause</div>
            <div><span className="text-white/60">← →</span> Navigate</div>
            <div><span className="text-white/60">ESC</span> Exit</div>
            <div><span className="text-white/60">T</span> Transition ({transition})</div>
            <div><span className="text-white/60">R</span> Order ({isRandomOrder ? 'Random' : 'Sequential'})</div>
            <div><span className="text-white/60">M</span> Music</div>
          </div>
        </div>
      </div>

      {/* Navigation Arrows */}
      <button onClick={(e) => { e.stopPropagation(); navigate(-1); }} className={`absolute left-4 z-10 p-2 text-white/20 hover:text-white/60 transition-all ${showControls ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}>
        <ChevronLeft size={32} strokeWidth={1.5} />
      </button>
      <button onClick={(e) => { e.stopPropagation(); navigate(1); }} className={`absolute right-4 z-10 p-2 text-white/20 hover:text-white/60 transition-all ${showControls ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}>
        <ChevronRight size={32} strokeWidth={1.5} />
      </button>

      {/* Bottom Info - 始终显示 */}
      <div className="absolute bottom-0 left-0 right-0 z-30">
        <div className="bg-gradient-to-t from-black/70 via-black/30 to-transparent pt-32 pb-8 px-10">
          <div className="flex items-end justify-between max-w-6xl mx-auto">
            {currentPhoto && (
              <div>
                {/* 照片标题 - 幻灯片时不显示 */}
                {!isPlaying && (
                  <h2 className="text-white text-2xl font-light tracking-wide mb-2">{currentPhoto.title}</h2>
                )}
                <div className="flex items-center gap-4 text-white/60 text-sm font-light">
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
                      {currentPhoto.date}
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
            <div className="text-white/40 text-sm font-light tabular-nums">
              {safeIndex + 1} / {filteredPhotos.length}
            </div>
          </div>
        </div>
      </div>

      {/* Progress Bar - 始终显示 */}
      <div className="absolute bottom-0 left-0 right-0 z-40 h-[2px]">
        <div className="h-full bg-white/10 relative overflow-hidden">
          <div className="h-full bg-yellow-400/60" style={{ width: `${progress * 100}%`, transition: 'width 0.1s linear' }} />
        </div>
      </div>
      
      {/* Page Flip Animation Styles */}
      <style>{`
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
