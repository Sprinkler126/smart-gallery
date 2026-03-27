/**
 * SlideControls - 幻灯片控制按钮
 */
import React, { memo } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight, Settings } from 'lucide-react';

interface SlideControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleSettings: () => void;
  showSettings: boolean;
}

function SlideControls({
  isPlaying,
  onPlayPause,
  onPrev,
  onNext,
  onToggleSettings,
  showSettings,
}: SlideControlsProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onPrev}
        className="p-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-sm transition-all"
        aria-label="上一张"
      >
        <ChevronLeft className="w-6 h-6 text-white" />
      </button>

      <button
        onClick={onPlayPause}
        className="p-4 rounded-full bg-amber-500/90 hover:bg-amber-400 backdrop-blur-sm transition-all"
        aria-label={isPlaying ? '暂停' : '播放'}
      >
        {isPlaying ? (
          <Pause className="w-6 h-6 text-black" />
        ) : (
          <Play className="w-6 h-6 text-black" />
        )}
      </button>

      <button
        onClick={onNext}
        className="p-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-sm transition-all"
        aria-label="下一张"
      >
        <ChevronRight className="w-6 h-6 text-white" />
      </button>

      <button
        onClick={onToggleSettings}
        className={`p-3 rounded-full backdrop-blur-sm transition-all ${
          showSettings ? 'bg-amber-500/90' : 'bg-white/10 hover:bg-white/20'
        }`}
        aria-label="设置"
      >
        <Settings className={`w-5 h-5 ${showSettings ? 'text-black' : 'text-white'}`} />
      </button>
    </div>
  );
}

export default memo(SlideControls);
