/**
 * DreamParticles - 沙粒消散效果（优化版）
 * 粒子构成照片，逐渐飘散消逝，如梦境回忆般
 */
import { useEffect, useRef, useCallback } from 'react';

interface SandParticle {
  x: number;
  y: number;
  originX: number;
  originY: number;
  color: string;
  size: number;
  vx: number;
  vy: number;
  alpha: number;
  scattered: boolean;
  scatterTime: number;
  life: number;
}

interface DreamParticlesProps {
  thumbnailUrl: string;
  visible: boolean;
}

// 性能优化配置
const CONFIG = {
  STEP: 6,              // 采样步长：6px 一个粒子（减少数量）
  MAX_PARTICLES: 8000,  // 最大粒子数限制
  FPS: 30,              // 目标帧率
  FADE_START: 1000,     // 散开后多久开始淡出
  FADE_SPEED: 0.015,    // 淡出速度
};

export default function DreamParticles({ thumbnailUrl, visible }: DreamParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<SandParticle[]>([]);
  const animRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const gradientRef = useRef<CanvasGradient | null>(null);
  const isReadyRef = useRef(false);

  /** 动画循环（优化版） */
  const animate = useCallback((time: number) => {
    // FPS 节流
    if (time - lastFrameRef.current < 1000 / CONFIG.FPS) {
      animRef.current = requestAnimationFrame(animate);
      return;
    }
    lastFrameRef.current = time;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // 清空画布
    ctx.clearRect(0, 0, w, h);

    const particles = particlesRef.current;
    if (particles.length === 0 || !isReadyRef.current) {
      animRef.current = requestAnimationFrame(animate);
      return;
    }

    // 批量绘制：先按颜色分组，减少状态切换
    const colorGroups: Map<string, SandParticle[]> = new Map();

    // 更新粒子状态
    for (const p of particles) {
      p.life += 33; // 约 30fps

      if (!p.scattered) {
        // 呼吸抖动（简化计算）
        p.x = p.originX + Math.sin(p.life * 0.002) * 0.3;
        p.y = p.originY + Math.cos(p.life * 0.002) * 0.2;

        if (p.life > p.scatterTime) {
          p.scattered = true;
          const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
          const speed = 0.5 + Math.random() * 1.0;
          p.vx = Math.cos(angle) * speed;
          p.vy = Math.sin(angle) * speed;
        }
      } else {
        // 散开中
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.995;
        p.vy *= 0.995;

        // 简化扰动
        p.vx += Math.sin(p.life * 0.0005) * 0.01;

        // 渐隐
        const scatterElapsed = p.life - p.scatterTime;
        if (scatterElapsed > CONFIG.FADE_START) {
          p.alpha -= CONFIG.FADE_SPEED;
        }
      }

      // 重生
      if (p.alpha <= 0) {
        p.x = p.originX;
        p.y = p.originY;
        p.alpha = 1;
        p.scattered = false;
        p.life = 0;
        p.scatterTime = 1500 + Math.random() * 5000;
        continue;
      }

      // 按颜色分组
      if (!colorGroups.has(p.color)) {
        colorGroups.set(p.color, []);
      }
      colorGroups.get(p.color)!.push(p);
    }

    // 批量绘制（每颜色只设置一次 fillStyle）
    ctx.globalAlpha = 1;
    for (const [color, group] of colorGroups) {
      ctx.fillStyle = color;
      for (const p of group) {
        ctx.globalAlpha = Math.max(0, p.alpha * 0.9);
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }

    // 边缘柔化（使用缓存的渐变）
    if (!gradientRef.current) {
      gradientRef.current = ctx.createRadialGradient(
        w / 2, h / 2, Math.min(w, h) * 0.3,
        w / 2, h / 2, Math.min(w, h) * 0.6
      );
      gradientRef.current.addColorStop(0, 'rgba(0,0,0,0)');
      gradientRef.current.addColorStop(0.7, 'rgba(0,0,0,0.2)');
      gradientRef.current.addColorStop(1, 'rgba(0,0,0,0.85)');
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = gradientRef.current;
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

      // 限制 canvas 尺寸，降低计算量
      const maxSize = 800;
      let w = Math.min(parent.clientWidth || 960, maxSize);
      let h = Math.min(parent.clientHeight || 640, maxSize);

      canvas.width = w;
      canvas.height = h;

      // 计算图片绘制区域
      const imgAspect = img.width / img.height;
      const canvasAspect = w / h;
      let drawW: number, drawH: number, offsetX: number, offsetY: number;

      if (imgAspect > canvasAspect) {
        drawW = w;
        drawH = w / imgAspect;
        offsetX = 0;
        offsetY = (h - drawH) / 2;
      } else {
        drawH = h;
        drawW = h * imgAspect;
        offsetX = (w - drawW) / 2;
        offsetY = 0;
      }

      // 采样粒子
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
          if (r + g + b < 40 || r + g + b > 720) continue;

          particles.push({
            x: x + offsetX,
            y: y + offsetY,
            originX: x + offsetX,
            originY: y + offsetY,
            color: `rgb(${r},${g},${b})`,
            size: 1.5 + Math.random() * 1.5,
            vx: (Math.random() - 0.5) * 0.2,
            vy: -0.1 - Math.random() * 0.3,
            alpha: 0.8 + Math.random() * 0.2,
            scattered: false,
            scatterTime: 1000 + Math.random() * 4000,
            life: Math.random() * 1000,
          });
        }
      }

      particlesRef.current = particles;
      gradientRef.current = null; // 重置渐变缓存
      isReadyRef.current = true;
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
        mask: 'radial-gradient(ellipse 85% 85% at center, black 60%, transparent 100%)',
        WebkitMask: 'radial-gradient(ellipse 85% 85% at center, black 60%, transparent 100%)',
      }}
    />
  );
}
