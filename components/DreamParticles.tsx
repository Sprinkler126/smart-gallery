/**
 * DreamParticles - 沙粒消散效果
 * 粒子构成照片，逐渐飘散消逝，如梦境回忆般
 */
import { useEffect, useRef, useCallback } from 'react';

interface SandParticle {
  x: number;        // 当前位置
  y: number;
  originX: number;  // 原始位置（照片中的位置）
  originY: number;
  color: string;
  size: number;
  vx: number;       // 漂移速度
  vy: number;
  alpha: number;
  scattered: boolean; // 是否已散开
  scatterTime: number; // 何时开始散开
  life: number;
}

interface DreamParticlesProps {
  thumbnailUrl: string;
  visible: boolean;
}

export default function DreamParticles({ thumbnailUrl, visible }: DreamParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<SandParticle[]>([]);
  const animRef = useRef<number>(0);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const colorsRef = useRef<string[]>([]);

  /** 从缩略图采样粒子 */
  const sampleParticles = useCallback((img: HTMLImageElement, w: number, h: number): SandParticle[] => {
    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return [];

    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const particles: SandParticle[] = [];
    const step = 4; // 每 4px 采样一个粒子
    const colors: string[] = [];

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        if (a < 50) continue; // 跳过透明像素

        const color = `rgb(${r},${g},${b})`;
        colors.push(color);

        // 随机延迟散开时间（2-8秒后开始消散）
        const scatterDelay = 2000 + Math.random() * 6000;

        particles.push({
          x, y,
          originX: x,
          originY: y,
          color,
          size: 1.5 + Math.random() * 1.5,
          vx: (Math.random() - 0.5) * 0.3,
          vy: -0.1 - Math.random() * 0.4, // 主要向上飘
          alpha: 1,
          scattered: false,
          scatterTime: scatterDelay,
          life: 0,
        });
      }
    }

    colorsRef.current = [...new Set(colors)].slice(0, 20);
    return particles;
  }, []);

  /** 动画循环 */
  const animate = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // 清空画布
    ctx.clearRect(0, 0, w, h);

    const particles = particlesRef.current;
    if (particles.length === 0) {
      animRef.current = requestAnimationFrame(animate);
      return;
    }

    // 绘制每个粒子
    for (const p of particles) {
      p.life += 16;

      if (!p.scattered) {
        // 还在照片位置，轻微抖动（沙粒呼吸感）
        p.x = p.originX + Math.sin(p.life * 0.003 + p.originX * 0.1) * 0.5;
        p.y = p.originY + Math.cos(p.life * 0.004 + p.originY * 0.1) * 0.3;

        // 到了散开时间
        if (p.life > p.scatterTime) {
          p.scattered = true;
          // 给一个随机的散开速度
          const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8; // 主要向上
          const speed = 0.3 + Math.random() * 1.2;
          p.vx = Math.cos(angle) * speed;
          p.vy = Math.sin(angle) * speed;
        }
      } else {
        // 散开中：缓慢飘走，逐渐减速
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.998; // 轻微阻力
        p.vy *= 0.998;

        // 添加微风扰动
        p.vx += Math.sin(p.life * 0.001 + p.originY * 0.01) * 0.02;
        p.vy += Math.cos(p.life * 0.0015 + p.originX * 0.01) * 0.01;

        // 渐隐
        const scatterElapsed = p.life - p.scatterTime;
        const fadeStart = 1500; // 散开后 1.5 秒开始淡出
        if (scatterElapsed > fadeStart) {
          p.alpha -= 0.008;
        }
      }

      // 死亡 → 重生在原位
      if (p.alpha <= 0) {
        p.x = p.originX;
        p.y = p.originY;
        p.alpha = 1;
        p.scattered = false;
        p.life = 0;
        p.scatterTime = 2000 + Math.random() * 6000;
        p.vx = (Math.random() - 0.5) * 0.3;
        p.vy = -0.1 - Math.random() * 0.4;
        continue;
      }

      // 绘制（圆角矩形 + 辉光，更梦幻）
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = p.scattered ? p.size * 2 : 1;
      const s = p.size;
      const r = s * 0.4;
      ctx.beginPath();
      ctx.roundRect(p.x - s / 2, p.y - s / 2, s, s, r);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.globalAlpha = 1;

    // 边缘柔化渐变（梦境感）
    const gradient = ctx.createRadialGradient(
      w / 2, h / 2, Math.min(w, h) * 0.25,
      w / 2, h / 2, Math.min(w, h) * 0.55
    );
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.6, 'rgba(0,0,0,0.15)');
    gradient.addColorStop(0.85, 'rgba(0,0,0,0.5)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.92)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    animRef.current = requestAnimationFrame(animate);
  }, []);
  useEffect(() => {
    if (!thumbnailUrl || !visible) return;

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = thumbnailUrl;
    img.onload = () => {
      imageRef.current = img;

      const canvas = canvasRef.current;
      if (!canvas) return;

      // 获取容器尺寸
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth || 960;
      const h = parent.clientHeight || 640;

      canvas.width = w;
      canvas.height = h;

      // 计算图片缩放后在 canvas 中的绘制区域
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
      const particles: SandParticle[] = [];
      const offscreen = document.createElement('canvas');
      offscreen.width = Math.floor(drawW);
      offscreen.height = Math.floor(drawH);
      const offCtx = offscreen.getContext('2d');
      if (!offCtx) return;

      offCtx.drawImage(img, 0, 0, drawW, drawH);
      const data = offCtx.getImageData(0, 0, offscreen.width, offscreen.height).data;

      const step = 3; // 每 3px 一个粒子
      for (let y = 0; y < offscreen.height; y += step) {
        for (let x = 0; x < offscreen.width; x += step) {
          const i = (y * offscreen.width + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 50) continue;

          // 跳过全黑/全白像素（通常是边框）
          if (r + g + b < 30 || r + g + b > 740) continue;

          const scatterDelay = 1500 + Math.random() * 7000;
          particles.push({
            x: x + offsetX,
            y: y + offsetY,
            originX: x + offsetX,
            originY: y + offsetY,
            color: `rgb(${r},${g},${b})`,
            size: 1.0 + Math.random() * 2.5,
            vx: (Math.random() - 0.5) * 0.3,
            vy: -0.1 - Math.random() * 0.5,
            alpha: 1,
            scattered: false,
            scatterTime: scatterDelay,
            life: Math.random() * 2000, // 错开启动时间
          });
        }
      }

      particlesRef.current = particles;
    };
  }, [thumbnailUrl, visible]);

  // 动画控制
  useEffect(() => {
    if (!visible) {
      cancelAnimationFrame(animRef.current);
      particlesRef.current = [];
      return;
    }
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
