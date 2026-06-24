import React, { memo, useCallback, useEffect, useRef } from 'react';

interface PhotoParticle {
  x: number;
  y: number;
  originX: number;
  originY: number;
  color: string;
  size: number;
  seed: number;
  alpha: number;
  life: number;
  maxLife: number;
  phase: 'forming' | 'swaying' | 'scattering' | 'fading';
  scatterAngle: number;
  scatterSpeed: number;
}

interface AtmosphereOrb {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  seed: number;
  speed: number;
  sprite: HTMLCanvasElement;
}

interface DreamParticlesProps {
  thumbnailUrl: string;
  visible: boolean;
  particleCount?: number;
  shouldDestroy?: boolean;
}

const BASE_CONFIG = {
  FORMING_MS: 1100,
  SWAY_MIN_MS: 2400,
  SWAY_MAX_MS: 5600,
  WIND_STRENGTH: 3.2,
  ORB_COUNT: 90,
};

const PARTICLE_LEVELS = [
  { step: 10, max: 1000, fps: 36 },
  { step: 8, max: 1800, fps: 40 },
  { step: 7, max: 2800, fps: 45 },
  { step: 6, max: 4200, fps: 45 },
  { step: 5, max: 6000, fps: 45 },
  { step: 4, max: 8000, fps: 45 },
  { step: 4, max: 10500, fps: 40 },
  { step: 3, max: 13000, fps: 36 },
  { step: 3, max: 16000, fps: 32 },
  { step: 2, max: 20000, fps: 30 },
];

const ORB_PALETTE = [
  'rgba(248,215,139,',
  'rgba(139,221,214,',
  'rgba(223,156,210,',
  'rgba(168,190,255,',
];

function getConfig(particleLevel: number = 5) {
  const level = Math.max(1, Math.min(10, particleLevel));
  const settings = PARTICLE_LEVELS[level - 1];
  return {
    ...BASE_CONFIG,
    STEP: settings.step,
    MAX_PARTICLES: settings.max,
    FPS: settings.fps,
    ORB_COUNT: Math.round(BASE_CONFIG.ORB_COUNT * (0.55 + level * 0.08)),
  };
}

function calcContainRect(
  containerW: number,
  containerH: number,
  contentW: number,
  contentH: number
): { x: number; y: number; w: number; h: number } {
  const containerAspect = containerW / containerH;
  const contentAspect = contentW / contentH;

  if (contentAspect > containerAspect) {
    const w = containerW;
    const h = containerW / contentAspect;
    return { x: 0, y: (containerH - h) / 2, w, h };
  }

  const h = containerH;
  const w = containerH * contentAspect;
  return { x: (containerW - w) / 2, y: 0, w, h };
}

function quantizeColor(r: number, g: number, b: number) {
  const qr = Math.round(r / 16) * 16;
  const qg = Math.round(g / 16) * 16;
  const qb = Math.round(b / 16) * 16;
  return `rgb(${qr},${qg},${qb})`;
}

function createGlowSprite(colorPrefix: string, size: number) {
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext('2d');
  if (!ctx) return sprite;

  const center = size / 2;
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, `${colorPrefix}0.36)`);
  gradient.addColorStop(0.26, `${colorPrefix}0.16)`);
  gradient.addColorStop(0.72, `${colorPrefix}0.045)`);
  gradient.addColorStop(1, `${colorPrefix}0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return sprite;
}

function buildAtmosphereOrbs(
  rect: { x: number; y: number; w: number; h: number },
  dpr: number,
  count: number
) {
  const spriteSize = Math.round(120 * dpr);
  const sprites = ORB_PALETTE.map((color) => createGlowSprite(color, spriteSize));
  const orbs: AtmosphereOrb[] = [];

  for (let i = 0; i < count; i++) {
    const seed = Math.random();
    const sprite = sprites[i % sprites.length];
    orbs.push({
      x: (rect.x + rect.w * (0.08 + Math.random() * 0.84)) * dpr,
      y: (rect.y + rect.h * (0.08 + Math.random() * 0.84)) * dpr,
      radius: (34 + Math.random() * 90) * dpr,
      alpha: 0.18 + Math.random() * 0.24,
      seed,
      speed: 0.00016 + Math.random() * 0.00028,
      sprite,
    });
  }

  return orbs;
}

function reservoirPush<T>(items: T[], item: T, seen: number, max: number) {
  if (items.length < max) {
    items.push(item);
    return;
  }

  const replaceIndex = Math.floor(Math.random() * seen);
  if (replaceIndex < max) {
    items[replaceIndex] = item;
  }
}

class ParticleSystemManager {
  private static instance: ParticleSystemManager;
  private activeSystems: Set<string> = new Set();
  private totalParticles = 0;

  static getInstance(): ParticleSystemManager {
    if (!ParticleSystemManager.instance) {
      ParticleSystemManager.instance = new ParticleSystemManager();
    }
    return ParticleSystemManager.instance;
  }

  register(systemId: string, particleCount: number) {
    this.activeSystems.add(systemId);
    this.totalParticles += particleCount;
  }

  unregister(systemId: string, particleCount: number) {
    this.activeSystems.delete(systemId);
    this.totalParticles = Math.max(0, this.totalParticles - particleCount);
  }

  getStats() {
    return {
      activeSystems: this.activeSystems.size,
      totalParticles: this.totalParticles,
    };
  }
}

const particleManager = ParticleSystemManager.getInstance();

function DreamParticles({ thumbnailUrl, visible, particleCount = 5, shouldDestroy = false }: DreamParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<PhotoParticle[]>([]);
  const particleGroupsRef = useRef<Map<string, PhotoParticle[]>>(new Map());
  const orbsRef = useRef<AtmosphereOrb[]>([]);
  const animRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const isReadyRef = useRef(false);
  const startTimeRef = useRef(0);
  const drawRectRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const dprRef = useRef(1);
  const configRef = useRef(getConfig(particleCount));
  const systemIdRef = useRef(`particle-system-${Math.random().toString(36).slice(2, 11)}`);
  const isRegisteredRef = useRef(false);

  useEffect(() => {
    configRef.current = getConfig(particleCount);
  }, [particleCount]);

  const cleanup = useCallback(() => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = 0;
    }

    const particleTotal = particlesRef.current.length;
    particlesRef.current = [];
    particleGroupsRef.current.clear();
    orbsRef.current = [];
    isReadyRef.current = false;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    if (isRegisteredRef.current) {
      particleManager.unregister(systemIdRef.current, particleTotal);
      isRegisteredRef.current = false;
    }
  }, []);

  const animate = useCallback((time: number) => {
    const config = configRef.current;
    if (time - lastFrameRef.current < 1000 / config.FPS) {
      animRef.current = requestAnimationFrame(animate);
      return;
    }

    const dt = Math.min(50, time - lastFrameRef.current);
    lastFrameRef.current = time;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!isReadyRef.current || particlesRef.current.length === 0) {
      animRef.current = requestAnimationFrame(animate);
      return;
    }

    const elapsed = time - startTimeRef.current;
    const rect = drawRectRef.current;
    const dpr = dprRef.current;

    const centerX = (rect.x + rect.w / 2) * dpr;
    const centerY = (rect.y + rect.h / 2) * dpr;
    const radius = Math.max(rect.w, rect.h) * dpr;

    const baseGlow = ctx.createRadialGradient(centerX, centerY, radius * 0.08, centerX, centerY, radius * 0.7);
    baseGlow.addColorStop(0, 'rgba(255,244,214,0.11)');
    baseGlow.addColorStop(0.42, 'rgba(137,210,212,0.055)');
    baseGlow.addColorStop(1, 'rgba(13,10,24,0)');
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = baseGlow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalCompositeOperation = 'lighter';
    for (const orb of orbsRef.current) {
      const driftX = Math.sin(elapsed * orb.speed + orb.seed * 10) * orb.radius * 0.26;
      const driftY = Math.cos(elapsed * orb.speed * 0.72 + orb.seed * 8) * orb.radius * 0.18;
      const pulse = 0.72 + Math.sin(elapsed * 0.001 + orb.seed * 6.28) * 0.22;
      const size = orb.radius * 2 * pulse;
      ctx.globalAlpha = orb.alpha;
      ctx.drawImage(orb.sprite, orb.x + driftX - size / 2, orb.y + driftY - size / 2, size, size);
    }

    ctx.globalCompositeOperation = 'source-over';
    particleGroupsRef.current.forEach((group, color) => {
      ctx.fillStyle = color;
      for (const p of group) {
        p.life += dt;

        switch (p.phase) {
          case 'forming': {
            const progress = Math.min(p.life / config.FORMING_MS, 1);
            const ease = 1 - Math.pow(1 - progress, 3);
            const angle = p.seed * Math.PI * 2 + p.originX * 0.002 - p.originY * 0.001;
            const dist = (58 + p.seed * 88) * dpr;
            p.x = p.originX + Math.cos(angle) * dist * (1 - ease);
            p.y = p.originY + Math.sin(angle) * dist * (1 - ease);
            p.alpha = ease * 0.92;
            if (progress >= 1) {
              p.phase = 'swaying';
              p.life = 0;
              p.maxLife = config.SWAY_MIN_MS + Math.random() * (config.SWAY_MAX_MS - config.SWAY_MIN_MS);
            }
            break;
          }
          case 'swaying': {
            const t = elapsed * 0.00065;
            const windX = Math.sin(t + p.seed * 6.28) * config.WIND_STRENGTH * dpr;
            const windY = Math.cos(t * 0.72 + p.seed * 4.71) * config.WIND_STRENGTH * 0.46 * dpr;
            p.x = p.originX + windX;
            p.y = p.originY + windY;
            p.alpha = 0.78 + Math.sin(p.life * 0.002 + p.seed * 6.28) * 0.12;
            if (p.life >= p.maxLife) {
              p.phase = 'scattering';
              p.life = 0;
              p.scatterAngle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
              p.scatterSpeed = (0.32 + Math.random() * 0.62) * dpr;
            }
            break;
          }
          case 'scattering': {
            p.x += Math.cos(p.scatterAngle) * p.scatterSpeed;
            p.y += Math.sin(p.scatterAngle) * p.scatterSpeed - 0.12 * dpr;
            p.scatterSpeed *= 0.985;
            p.alpha -= 0.01;
            if (p.alpha <= 0.04) {
              p.phase = 'fading';
            }
            break;
          }
          case 'fading': {
            p.alpha = 0;
            if (p.life > 700) {
              p.x = p.originX;
              p.y = p.originY;
              p.life = Math.random() * 220;
              p.phase = 'forming';
            }
            break;
          }
        }

        if (p.alpha > 0.01) {
          ctx.globalAlpha = p.alpha;
          ctx.fillRect(p.x, p.y, p.size, p.size);
        }
      }
    });

    const vignette = ctx.createRadialGradient(centerX, centerY, radius * 0.24, centerX, centerY, radius * 0.82);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(0.66, 'rgba(0,0,0,0.08)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';

    animRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    if (shouldDestroy || !thumbnailUrl || !visible) {
      cleanup();
      return;
    }

    let cancelled = false;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = thumbnailUrl;
    img.onload = () => {
      if (cancelled) return;

      requestAnimationFrame(() => {
        if (cancelled) return;

        const canvas = canvasRef.current;
        const parent = canvas?.parentElement;
        if (!canvas || !parent) return;

        const cssW = parent.clientWidth;
        const cssH = parent.clientHeight;
        if (cssW < 10 || cssH < 10) {
          window.setTimeout(() => {
            if (!cancelled) img.onload?.(new Event('load'));
          }, 100);
          return;
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        dprRef.current = dpr;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);

        const rect = calcContainRect(cssW, cssH, img.naturalWidth, img.naturalHeight);
        drawRectRef.current = rect;

        const offscreen = document.createElement('canvas');
        offscreen.width = Math.max(1, Math.round(rect.w));
        offscreen.height = Math.max(1, Math.round(rect.h));
        const offCtx = offscreen.getContext('2d', { willReadFrequently: true });
        if (!offCtx) return;

        offCtx.drawImage(img, 0, 0, offscreen.width, offscreen.height);
        const data = offCtx.getImageData(0, 0, offscreen.width, offscreen.height).data;
        const config = configRef.current;
        const sampled: { x: number; y: number; r: number; g: number; b: number }[] = [];
        let seen = 0;

        for (let y = 0; y < offscreen.height; y += config.STEP) {
          for (let x = 0; x < offscreen.width; x += config.STEP) {
            const i = (y * offscreen.width + x) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            if (a < 30) continue;
            const brightness = r + g + b;
            if (brightness < 18 || brightness > 750) continue;

            seen++;
            reservoirPush(sampled, { x, y, r, g, b }, seen, config.MAX_PARTICLES);
          }
        }

        const particles: PhotoParticle[] = [];
        const groups = new Map<string, PhotoParticle[]>();
        for (const pixel of sampled) {
          const color = quantizeColor(pixel.r, pixel.g, pixel.b);
          const p: PhotoParticle = {
            x: (rect.x + pixel.x) * dpr,
            y: (rect.y + pixel.y) * dpr,
            originX: (rect.x + pixel.x) * dpr,
            originY: (rect.y + pixel.y) * dpr,
            color,
            size: (1 + Math.random() * 1.45) * dpr,
            seed: Math.random(),
            alpha: 0,
            life: Math.random() * config.FORMING_MS,
            maxLife: config.SWAY_MIN_MS + Math.random() * (config.SWAY_MAX_MS - config.SWAY_MIN_MS),
            phase: 'forming',
            scatterAngle: 0,
            scatterSpeed: 0,
          };
          particles.push(p);
          if (!groups.has(color)) groups.set(color, []);
          groups.get(color)!.push(p);
        }

        cleanup();
        particlesRef.current = particles;
        particleGroupsRef.current = groups;
        orbsRef.current = buildAtmosphereOrbs(rect, dpr, config.ORB_COUNT);
        isReadyRef.current = true;
        startTimeRef.current = performance.now();
        lastFrameRef.current = 0;

        particleManager.register(systemIdRef.current, particles.length);
        isRegisteredRef.current = true;
        if (!animRef.current) {
          animRef.current = requestAnimationFrame(animate);
        }
      });
    };

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [thumbnailUrl, visible, particleCount, shouldDestroy, cleanup, animate]);

  useEffect(() => {
    if (shouldDestroy || !visible) {
      cleanup();
      return;
    }

    lastFrameRef.current = 0;
    animRef.current = requestAnimationFrame(animate);
    return () => cleanup();
  }, [visible, animate, shouldDestroy, cleanup]);

  if (shouldDestroy || !visible) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ zIndex: 0, pointerEvents: 'none' }}
    />
  );
}

export default memo(DreamParticles);
