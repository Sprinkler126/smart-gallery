/**
 * ProgressBar - 幻灯片进度条（使用 ref 避免重渲染）
 */
import React, { useRef, useEffect } from 'react';

interface ProgressBarProps {
  isPlaying: boolean;
  intervalSec: number;
  isLoading: boolean;
  currentIndex: number;
  onComplete: () => void;
}

const PROGRESS_TICK = 100; // ms

export default function ProgressBar({
  isPlaying,
  intervalSec,
  isLoading,
  currentIndex,
  onComplete,
}: ProgressBarProps) {
  const progressRef = useRef(0);
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    if (!isPlaying || isLoading) {
      progressRef.current = 0;
      if (barRef.current) {
        barRef.current.style.width = '0%';
      }
      return;
    }

    const total = intervalSec * 1000;
    lastTimeRef.current = performance.now();

    const tick = (now: number) => {
      const elapsed = now - lastTimeRef.current;
      lastTimeRef.current = now;

      progressRef.current += elapsed;
      const pct = Math.min((progressRef.current / total) * 100, 100);

      if (barRef.current) {
        barRef.current.style.width = `${pct}%`;
      }

      if (progressRef.current >= total) {
        progressRef.current = 0;
        onComplete();
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, intervalSec, isLoading, onComplete]);

  // 重置进度（翻页或间隔变化时）
  useEffect(() => {
    progressRef.current = 0;
    if (barRef.current) {
      barRef.current.style.width = '0%';
    }
  }, [intervalSec, currentIndex]);

  return (
    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
      <div
        ref={barRef}
        className="h-full bg-gradient-to-r from-amber-400 to-amber-500 transition-none"
        style={{ width: '0%' }}
      />
    </div>
  );
}
