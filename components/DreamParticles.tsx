/**
 * DreamParticles v2 - 沙粒构成画面 + 随风摆动
 * 
 * 改进点：
 * - 高分辨率渲染（devicePixelRatio）
 * - 粒子是圆形沙粒，大小不一
 * - 风场模拟：粒子在原位随风摆动，而非单纯消散
 * - 粒子生命周期：构成 → 摆动 → 飘散 → 重生
 */
import React, { useEffect, useRef, useCallback, memo } from 'react';

interface SandParticle {
  x: number;
  y: number;
  originX: number;
  originY: number;
  color: string;
  size: number;
  // 风场相关
  windPhaseX: number;   // 风场相位X（决定摆动节奏）
  windPhaseY: number;   // 风场相位Y
  windAmpX: number;     // 摆动幅度X
  windAmpY: number;     // 摆动幅度Y
  // 生命周期
  alpha: number;
  life: number;         // 已存活时间(ms)
  maxLife: number;      // 最大寿命(ms)
  phase: 'forming' | 'swaying' | 'scattering' | 'fading';
  scatterAngle: number;
  scatterSpeed: number;
}

interface DreamParticlesProps {
  thumbnailUrl: string;
  visible: boolean;
}

const CONFIG = {
  STEP: 4,                // 采样步长：4px（更密集）
  MAX_PARTICLES: 15000,   // 最大粒子数
  FPS: 40,                // 目标帧率
  // 生命周期
  FORMING_MS: 2000,       // 构成阶段持续
  SWAY_MIN_MS: 3000,      // 摆动最短时间
  SWAY_MAX_MS: 8000,      // 摆动最长时间
  // 风场
  WIND_BASE_SPEED: 0.0008, // 风场基础流速
  WIND_AMPLITUDE: 3.5,     // 最大摆动幅度(px)
  WIND_TURBULENCE: 0.003,  // 湍流强度
};

/**
 * 2D 噪声函数（简化版 Simplex Noise）
 * 用于生成自然的风场
 */
function noise2D(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}

/**
 * 平滑风场噪声
 */
function windNoise(x: number, y: number, time: number): { dx: number; dy: number } {
  const t = time * CONFIG.WIND_BASE_SPEED;
  // 多层噪声叠加，产生更自然的运动
  const n1 = noise2D(x * 0.01 + t, y * 0.008);
  const n2 = noise2D(x * 0.005 - t * 0.7, y * 0.012 + t * 0.3);
  const n3 = noise2D(x * 0.02 + t * 1.5, y * 0.015 - t * 0.5);
  
  // 主风向：从左到右 + 轻微向上
  const baseWindX = Math.sin(t * 0.5) * 0.6 + 0.3;
  const baseWindY = Math.cos(t * 0.3) * 0.3 - 0.15;
  
  return {
    dx: (n1 * 0.5 + n2 * 0.3 + n3 * 0.2 + baseWindX) * CONFIG.WIND_AMPLITUDE,
    dy: (n1 * 0.3 + n2 * 0.5 + n3 * 0.2 + baseWindY) * CONFIG.WIND_AMPLITUDE * 0.6,
  };
}

function DreamParticles({ thumbnailUrl, visible }: DreamParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<SandParticle[]>([]);
  const animRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const isReadyRef = useRef(false);
  const startTimeRef = useRef<number>(0);

  /** 动画循环 */
  const animate = useCallback((time: number) => {
    // FPS 节流
    if (time - lastFrameRef.current < 1000 / CONFIG.FPS) {
      animRef.current = requestAnimationFrame(animate);
      return;
    }
    const dt = time - lastFrameRef.current;
    lastFrameRef.current = time;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const dpr = window.devicePixelRatio || 1;

    // 清空（使用物理像素）
    ctx.clearRect(0, 0, w, h);

    const particles = particlesRef.current;
    if (particles.length === 0 || !isReadyRef.current) {
      animRef.current = requestAnimationFrame(animate);
      return;
    }

    const elapsed = time - startTimeRef.current;

    // 按颜色分组批量绘制
    const colorGroups: Map<string, SandParticle[]> = new Map();

    for (const p of particles) {
      p.life += dt;

      switch (p.phase) {
        case 'forming': {
          // 从随机位置飞向原位
          const progress = Math.min(p.life / CONFIG.FORMING_MS, 1);
          const ease = 1 - Math.pow(1 - progress, 3); // easeOutCubic
          // 初始偏移（随机方向）
          const initDx = (noise2D(p.originX * 0.1, p.originY * 0.1) * 100);
          const initDy = (noise2D(p.originY * 0.1, p.originX * 0.1) * 100);
          p.x = p.originX + initDx * (1 - ease);
          p.y = p.originY + initDy * (1 - ease);
          p.alpha = ease * 0.9;

          if (p.life >= CONFIG.FORMING_MS) {
            p.phase = 'swaying';
            p.life = 0;
            p.maxLife = CONFIG.SWAY_MIN_MS + Math.random() * (CONFIG.SWAY_MAX_MS - CONFIG.SWAY_MIN_MS);
          }
          break;
        }

        case 'swaying': {
          // 🌬️ 随风摆动 - 核心效果
          const wind = windNoise(p.originX, p.originY, elapsed);
          p.x = p.originX + wind.dx * p.windAmpX / CONFIG.WIND_AMPLITUDE;
          p.y = p.originY + wind.dy * p.windAmpY / CONFIG.WIND_AMPLITUDE;
          p.alpha = 0.85 + Math.sin(p.life * 0.002 + p.windPhaseX) * 0.1;

          if (p.life >= p.maxLife) {
            p.phase = 'scattering';
            p.life = 0;
            p.scatterAngle = -Math.PI / 2 + (Math.random() - 0.5) * 2;
            p.scatterSpeed = 0.4 + Math.random() * 1.2;
          }
          break;
        }

        case 'scattering': {
          // 被风吹走
          const wind = windNoise(p.originX, p.originY, elapsed);
          p.x += Math.cos(p.scatterAngle) * p.scatterSpeed + wind.dx * 0.05;
          p.y += Math.sin(p.scatterAngle) * p.scatterSpeed + wind.dy * 0.03;
          p.scatterSpeed *= 0.993;
          p.alpha -= 0.008;

          if (p.alpha <= 0.05) {
            p.phase = 'fading';
          }
          break;
        }

        case 'fading': {
          p.alpha = 0;
          // 重生
          if (p.life > p.maxLife + 500) {
            p.x = p.originX;
            p.y = p.originY;
            p.alpha = 0;
            p.life = 0;
            p.phase = 'forming';
            p.maxLife = CONFIG.SWAY_MIN_MS + Math.random() * (CONFIG.SWAY_MAX_MS - CONFIG.SWAY_MIN_MS);
          }
          break;
        }
      }

      // 收集可见粒子
      if (p.alpha > 0.01) {
        if (!colorGroups.has(p.color)) {
          colorGroups.set(p.color, []);
        }
        colorGroups.get(p.color)!.push(p);
      }
    }

    // 批量绘制圆形沙粒
    colorGroups.forEach((group, color) => {
      ctx.fillStyle = color;
      for (const p of group) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
        // 圆形沙粒（arc 比 fillRect 更像沙子）
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // 柔化边缘（暗角）
    const minDim = Math.min(w, h) / dpr;
    const grad = ctx.createRadialGradient(
      w / 2, h / 2, minDim * 0.25 * dpr,
      w / 2, h / 2, minDim * 0.55 * dpr
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.15)');
    grad.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    animRef.current = requestAnimationFrame(animate);
  }, []);

  // 初始化粒子
  useEffect(() => {
    if (!thumbnailUrl || !visible) {
      isReadyRef.current = false;
      return;
    }

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = thumbnailUrl;
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const parent = canvas.parentElement;
      if (!parent) return;

      const dpr = window.devicePixelRatio || 1;
      
      // 提升渲染分辨率
      const maxSize = 1200;
      const cssW = Math.min(parent.clientWidth || 960, maxSize);
      const cssH = Math.min(parent.clientHeight || 640, maxSize);

      // 物理像素 = CSS 像素 × DPR
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';

      // 图片适配
      const imgAspect = img.width / img.height;
      const canvasAspect = cssW / cssH;
      let drawW: number, drawH: number, offsetX: number, offsetY: number;

      if (imgAspect > canvasAspect) {
        drawW = cssW;
        drawH = cssW / imgAspect;
        offsetX = 0;
        offsetY = (cssH - drawH) / 2;
      } else {
        drawH = cssH;
        drawW = cssH * imgAspect;
        offsetX = (cssW - drawW) / 2;
        offsetY = 0;
      }

      // 采样图片颜色
      const offscreen = document.createElement('canvas');
      offscreen.width = Math.floor(drawW);
      offscreen.height = Math.floor(drawH);
      const offCtx = offscreen.getContext('2d');
      if (!offCtx) return;

      offCtx.drawImage(img, 0, 0, drawW, drawH);
      const data = offCtx.getImageData(0, 0, offscreen.width, offscreen.height).data;

      const particles: SandParticle[] = [];
      const step = CONFIG.STEP;

      for (let y = 0; y < offscreen.height && particles.length < CONFIG.MAX_PARTICLES; y += step) {
        for (let x = 0; x < offscreen.width && particles.length < CONFIG.MAX_PARTICLES; x += step) {
          const i = (y * offscreen.width + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];

          if (a < 60) continue;
          if (r + g + b < 30 || r + g + b > 730) continue;

          // 转换为物理像素坐标
          const px = (x + offsetX) * dpr;
          const py = (y + offsetY) * dpr;

          particles.push({
            x: px,
            y: py,
            originX: px,
            originY: py,
            color: `rgb(${r},${g},${b})`,
            size: (1 + Math.random() * 1.8) * dpr, // 沙粒大小不一
            windPhaseX: Math.random() * Math.PI * 2,
            windPhaseY: Math.random() * Math.PI * 2,
            windAmpX: 0.5 + Math.random() * 1.0,  // 每个粒子摆动幅度不同
            windAmpY: 0.3 + Math.random() * 0.7,
            alpha: 0,
            life: Math.random() * 1500, // 错开启动
            maxLife: CONFIG.SWAY_MIN_MS + Math.random() * (CONFIG.SWAY_MAX_MS - CONFIG.SWAY_MIN_MS),
            phase: 'forming',
            scatterAngle: 0,
            scatterSpeed: 0,
          });
        }
      }

      particlesRef.current = particles;
      isReadyRef.current = true;
      startTimeRef.current = performance.now();
    };

    return () => {
      isReadyRef.current = false;
    };
  }, [thumbnailUrl, visible]);

  // 动画控制
  useEffect(() => {
    if (!visible) {
      cancelAnimationFrame(animRef.current);
      particlesRef.current = [];
      isReadyRef.current = false;
      return;
    }
    lastFrameRef.current = 0;
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [visible, animate]);

  if (!visible) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{
        zIndex: 0,
        borderRadius: '24px',
        mask: 'radial-gradient(ellipse 85% 85% at center, black 55%, transparent 100%)',
        WebkitMask: 'radial-gradient(ellipse 85% 85% at center, black 55%, transparent 100%)',
      }}
    />
  );
}

export default memo(DreamParticles);
