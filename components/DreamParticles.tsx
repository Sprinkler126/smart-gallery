/**
 * DreamParticles v3 - 粒子精确匹配照片位置
 * 
 * 核心改进：
 * - 粒子坐标基于照片的实际显示区域（而非整个容器）
 * - 使用与 img 相同的 object-contain 逻辑计算绘制区域
 * - 风场摆动更加自然
 */
import React, { useEffect, useRef, useCallback, memo } from 'react';

interface SandParticle {
  x: number;
  y: number;
  originX: number;
  originY: number;
  color: string;
  size: number;
  windSeed: number;       // 随机种子，决定摆动节奏
  alpha: number;
  life: number;
  maxLife: number;
  phase: 'forming' | 'swaying' | 'scattering' | 'fading';
  scatterAngle: number;
  scatterSpeed: number;
}

interface DreamParticlesProps {
  thumbnailUrl: string;
  visible: boolean;
}

const CONFIG = {
  STEP: 3,                // 采样步长：3px（更密集）
  MAX_PARTICLES: 30000,   // 最大粒子数（覆盖全画面）
  FPS: 40,
  FORMING_MS: 1800,
  SWAY_MIN_MS: 3000,
  SWAY_MAX_MS: 8000,
  WIND_SPEED: 0.001,
  WIND_STRENGTH: 4.0,
};

/**
 * 2D value noise（简化版）
 */
function hash(x: number, y: number): number {
  let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  // smoothstep
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  // 四角插值
  const n00 = hash(ix, iy);
  const n10 = hash(ix + 1, iy);
  const n01 = hash(ix, iy + 1);
  const n11 = hash(ix + 1, iy + 1);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

/**
 * 分形布朗运动噪声（多层叠加）
 */
function fbm(x: number, y: number, octaves = 3): number {
  let val = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * smoothNoise(x * freq, y * freq);
    amp *= 0.5;
    freq *= 2.0;
  }
  return val;
}

/**
 * 计算风场偏移
 */
function windDisplacement(
  originX: number,
  originY: number,
  time: number,
  seed: number
): { dx: number; dy: number } {
  const t = time * CONFIG.WIND_SPEED;
  const scale = 0.006;

  // 两层噪声：主风 + 湍流
  const n1 = fbm(originX * scale + t * 1.2, originY * scale * 0.8 + seed * 10, 3);
  const n2 = fbm(originX * scale * 0.5 - t * 0.8, originY * scale + t * 0.6 + seed * 20, 2);

  // 主风向：从左下到右上
  const baseX = Math.sin(t * 0.4) * 0.5 + 0.4;
  const baseY = Math.cos(t * 0.25) * 0.3 - 0.2;

  const dx = (n1 * 0.6 + n2 * 0.4 - 0.5 + baseX) * CONFIG.WIND_STRENGTH * 2;
  const dy = (n1 * 0.4 + n2 * 0.6 - 0.5 + baseY) * CONFIG.WIND_STRENGTH * 1.2;

  return { dx, dy };
}

/**
 * 计算 object-contain 的实际绘制区域
 * 模拟 CSS object-fit: contain 的行为
 */
function calcContainRect(
  containerW: number,
  containerH: number,
  contentW: number,
  contentH: number
): { x: number; y: number; w: number; h: number } {
  const containerAspect = containerW / containerH;
  const contentAspect = contentW / contentH;

  let drawW: number, drawH: number, offsetX: number, offsetY: number;

  if (contentAspect > containerAspect) {
    // 内容更宽 → 以容器宽度为准
    drawW = containerW;
    drawH = containerW / contentAspect;
    offsetX = 0;
    offsetY = (containerH - drawH) / 2;
  } else {
    // 内容更高 → 以容器高度为准
    drawH = containerH;
    drawW = containerH * contentAspect;
    offsetX = (containerW - drawW) / 2;
    offsetY = 0;
  }

  return { x: offsetX, y: offsetY, w: drawW, h: drawH };
}

function DreamParticles({ thumbnailUrl, visible }: DreamParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<SandParticle[]>([]);
  const animRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const isReadyRef = useRef(false);
  const startTimeRef = useRef<number>(0);
  // 保存绘制区域信息（用于动画中的坐标偏移）
  const drawRectRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  /** 动画循环 */
  const animate = useCallback((time: number) => {
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

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const particles = particlesRef.current;
    if (particles.length === 0 || !isReadyRef.current) {
      animRef.current = requestAnimationFrame(animate);
      return;
    }

    const elapsed = time - startTimeRef.current;
    const colorGroups = new Map<string, SandParticle[]>();

    for (const p of particles) {
      p.life += dt;

      switch (p.phase) {
        case 'forming': {
          const progress = Math.min(p.life / CONFIG.FORMING_MS, 1);
          const ease = 1 - Math.pow(1 - progress, 3);
          // 从边缘飞入
          const noise = smoothNoise(p.originX * 0.02, p.originY * 0.02);
          const angle = noise * Math.PI * 2;
          const dist = 80 + noise * 120;
          p.x = p.originX + Math.cos(angle) * dist * (1 - ease);
          p.y = p.originY + Math.sin(angle) * dist * (1 - ease);
          p.alpha = ease * 0.95;
          if (p.life >= CONFIG.FORMING_MS) {
            p.phase = 'swaying';
            p.life = 0;
            p.maxLife = CONFIG.SWAY_MIN_MS + Math.random() * (CONFIG.SWAY_MAX_MS - CONFIG.SWAY_MIN_MS);
          }
          break;
        }
        case 'swaying': {
          const wind = windDisplacement(p.originX, p.originY, elapsed, p.windSeed);
          p.x = p.originX + wind.dx;
          p.y = p.originY + wind.dy;
          // 微弱呼吸
          p.alpha = 0.88 + Math.sin(p.life * 0.003 + p.windSeed * 6.28) * 0.08;
          if (p.life >= p.maxLife) {
            p.phase = 'scattering';
            p.life = 0;
            p.scatterAngle = -Math.PI / 2 + (Math.random() - 0.5) * 2.5;
            p.scatterSpeed = 0.3 + Math.random() * 1.0;
          }
          break;
        }
        case 'scattering': {
          const wind = windDisplacement(p.originX, p.originY, elapsed, p.windSeed);
          p.x += Math.cos(p.scatterAngle) * p.scatterSpeed + wind.dx * 0.04;
          p.y += Math.sin(p.scatterAngle) * p.scatterSpeed + wind.dy * 0.04;
          p.scatterSpeed *= 0.994;
          p.alpha -= 0.006;
          if (p.alpha <= 0.03) p.phase = 'fading';
          break;
        }
        case 'fading': {
          p.alpha = 0;
          if (p.life > p.maxLife + 800) {
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

      if (p.alpha > 0.01) {
        if (!colorGroups.has(p.color)) colorGroups.set(p.color, []);
        colorGroups.get(p.color)!.push(p);
      }
    }

    // 绘制圆形沙粒
    colorGroups.forEach((group, color) => {
      ctx.fillStyle = color;
      for (const p of group) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // 暗角（在照片区域上加）
    const rect = drawRectRef.current;
    if (rect.w > 0 && rect.h > 0) {
      const cx = (rect.x + rect.w / 2) * dpr;
      const cy = (rect.y + rect.h / 2) * dpr;
      const r = Math.max(rect.w, rect.h) * 0.5 * dpr;
      const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 0.75);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.65, 'rgba(0,0,0,0.1)');
      grad.addColorStop(1, 'rgba(0,0,0,0.65)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    animRef.current = requestAnimationFrame(animate);
  }, []);

  // 初始化粒子
  useEffect(() => {
    if (!thumbnailUrl || !visible) {
      isReadyRef.current = false;
      return;
    }

    let cancelled = false;

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = thumbnailUrl;
    img.onload = () => {
      if (cancelled) return;

      // ★ 延迟一帧，确保容器已完成布局
      requestAnimationFrame(() => {
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const parent = canvas.parentElement;
        if (!parent) return;

        const dpr = window.devicePixelRatio || 1;
        const cssW = parent.clientWidth;
        const cssH = parent.clientHeight;

        // 容器尺寸为 0 时跳过（布局未完成）
        if (cssW < 10 || cssH < 10) {
          console.warn('🏜️ DreamParticles: container too small, retrying...');
          setTimeout(() => {
            if (!cancelled) img.onload?.(new Event('load'));
          }, 100);
          return;
        }

        // 设置 canvas 物理尺寸（CSS 尺寸由 w-full h-full 控制）
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.width = '';
        canvas.style.height = '';

        // ★ 计算照片在容器中的实际显示区域（object-contain 语义）
        const rect = calcContainRect(cssW, cssH, img.naturalWidth, img.naturalHeight);
        drawRectRef.current = rect;

        console.log(`🏜️ DreamParticles: container=${cssW}x${cssH}, img=${img.naturalWidth}x${img.naturalHeight}, draw=${Math.round(rect.w)}x${Math.round(rect.h)}@(${Math.round(rect.x)},${Math.round(rect.y)})`);

        // 在照片区域内采样颜色
        const offscreen = document.createElement('canvas');
        offscreen.width = Math.round(rect.w);
        offscreen.height = Math.round(rect.h);
        const offCtx = offscreen.getContext('2d');
        if (!offCtx) return;

        offCtx.drawImage(img, 0, 0, offscreen.width, offscreen.height);
        const data = offCtx.getImageData(0, 0, offscreen.width, offscreen.height).data;

        const particles: SandParticle[] = [];
        const step = CONFIG.STEP;

        for (let y = 0; y < offscreen.height && particles.length < CONFIG.MAX_PARTICLES; y += step) {
          for (let x = 0; x < offscreen.width && particles.length < CONFIG.MAX_PARTICLES; x += step) {
            const i = (y * offscreen.width + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];

            if (a < 60) continue;
            if (r + g + b < 30 || r + g + b > 730) continue;

            // ★ 粒子坐标 = 照片区域偏移 + 采样位置（转换为物理像素）
            const px = (rect.x + x) * dpr;
            const py = (rect.y + y) * dpr;

            particles.push({
              x: px, y: py,
              originX: px, originY: py,
              color: `rgb(${r},${g},${b})`,
              size: (0.8 + Math.random() * 1.6) * dpr,
              windSeed: Math.random(),
              alpha: 0,
              life: Math.random() * 1200,
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
      }); // end requestAnimationFrame
    }; // end img.onload

    return () => { cancelled = true; isReadyRef.current = false; };
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
        pointerEvents: 'none',
      }}
    />
  );
}

export default memo(DreamParticles);
