/**
 * SettingsPanel - 幻灯片设置面板
 */
import React, { memo } from 'react';
import { Clock, Monitor, Image, Crop, Music, Volume2, VolumeX } from 'lucide-react';

interface SettingsPanelProps {
  show: boolean;
  intervalSec: number;
  transition: 'crossfade' | 'kenburns' | 'pageflip';
  orientationFilter: 'all' | 'landscape' | 'portrait';
  imageQuality: 'display' | 'original';
  isRandomOrder: boolean;
  isMuted: boolean;
  bgmList: { id: string; filename: string }[];
  currentBgmIndex: number;
  onIntervalChange: (sec: number) => void;
  onTransitionChange: (t: 'crossfade' | 'kenburns' | 'pageflip') => void;
  onOrientationChange: (o: 'all' | 'landscape' | 'portrait') => void;
  onQualityChange: (q: 'display' | 'original') => void;
  onRandomOrderChange: (random: boolean) => void;
  onMuteChange: (muted: boolean) => void;
  onBgmChange: (index: number) => void;
}

const INTERVAL_OPTIONS = [3, 5, 8, 10, 15, 30];

function SettingsPanel({
  show,
  intervalSec,
  transition,
  orientationFilter,
  imageQuality,
  isRandomOrder,
  isMuted,
  bgmList,
  currentBgmIndex,
  onIntervalChange,
  onTransitionChange,
  onOrientationChange,
  onQualityChange,
  onRandomOrderChange,
  onMuteChange,
  onBgmChange,
}: SettingsPanelProps) {
  if (!show) return null;

  return (
    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-md rounded-2xl p-5 min-w-[320px] max-w-[90vw] max-h-[60vh] overflow-y-auto">
      <div className="space-y-4">
        {/* 切换间隔 */}
        <div>
          <div className="flex items-center gap-2 text-white/70 text-sm mb-2">
            <Clock className="w-4 h-4" />
            <span>切换间隔</span>
          </div>
          <div className="flex gap-2">
            {INTERVAL_OPTIONS.map((sec) => (
              <button
                key={sec}
                onClick={() => onIntervalChange(sec)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                  intervalSec === sec
                    ? 'bg-amber-500 text-black'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>

        {/* 切换效果 */}
        <div>
          <div className="flex items-center gap-2 text-white/70 text-sm mb-2">
            <Monitor className="w-4 h-4" />
            <span>切换效果</span>
          </div>
          <div className="flex gap-2">
            {[
              { key: 'crossfade', label: '淡入淡出' },
              { key: 'kenburns', label: 'Ken Burns' },
              { key: 'pageflip', label: '翻页' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => onTransitionChange(key as typeof transition)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                  transition === key
                    ? 'bg-amber-500 text-black'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 图片方向 */}
        <div>
          <div className="flex items-center gap-2 text-white/70 text-sm mb-2">
            <Crop className="w-4 h-4" />
            <span>图片方向</span>
          </div>
          <div className="flex gap-2">
            {[
              { key: 'all', label: '全部' },
              { key: 'landscape', label: '横屏' },
              { key: 'portrait', label: '竖屏' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => onOrientationChange(key as typeof orientationFilter)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                  orientationFilter === key
                    ? 'bg-amber-500 text-black'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 图片质量 */}
        <div>
          <div className="flex items-center gap-2 text-white/70 text-sm mb-2">
            <Image className="w-4 h-4" />
            <span>图片质量</span>
          </div>
          <div className="flex gap-2">
            {[
              { key: 'display', label: '显示版' },
              { key: 'original', label: '原图' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => onQualityChange(key as typeof imageQuality)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                  imageQuality === key
                    ? 'bg-amber-500 text-black'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 播放模式 */}
        <div className="flex items-center justify-between">
          <span className="text-white/70 text-sm">随机播放</span>
          <button
            onClick={() => onRandomOrderChange(!isRandomOrder)}
            className={`w-12 h-6 rounded-full transition-all ${
              isRandomOrder ? 'bg-amber-500' : 'bg-white/20'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white transition-transform ${
                isRandomOrder ? 'translate-x-6' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {/* BGM 设置 */}
        {bgmList.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-white/70 text-sm">
                <Music className="w-4 h-4" />
                <span>背景音乐</span>
              </div>
              <button
                onClick={() => onMuteChange(!isMuted)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20"
              >
                {isMuted ? (
                  <VolumeX className="w-4 h-4 text-white" />
                ) : (
                  <Volume2 className="w-4 h-4 text-white" />
                )}
              </button>
            </div>
            <select
              value={currentBgmIndex}
              onChange={(e) => onBgmChange(Number(e.target.value))}
              className="w-full bg-white/10 text-white rounded-lg px-3 py-2 text-sm"
            >
              {bgmList.map((bgm, idx) => (
                <option key={bgm.id} value={idx} className="bg-black">
                  {bgm.filename.replace(/\.[^/.]+$/, '')}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(SettingsPanel);
