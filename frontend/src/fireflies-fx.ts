type FirefliesFxOptions = {
  stageWidth: number;
  stageHeight: number;
  /** 返回 /hand/ 虚拟舞台的缩放比例（MainView.getStageScale）。 */
  getStageScale?: () => number;
  /** 最大渲染像素比（dpr * stageScale 的上限），控制性能。 */
  maxPixelRatio?: number;
};

export type FirefliesFxHandle = {
  destroy: () => void;
  setEnabled: (enabled: boolean) => void;
};

type Firefly = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  sprite: HTMLCanvasElement;
  spriteRadius: number;
  baseAlpha: number;
  pulseAmp: number;
  pulseDuration: number;
  nextPulseIn: number;
  pulseLeft: number;
  phase: number;
  phaseSpeed: number;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(items: Array<T>): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function shouldReduceMotion(): boolean {
  try {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function shouldSaveData(): boolean {
  const conn = (navigator as any).connection;
  return Boolean(conn && typeof conn === 'object' && conn.saveData);
}

function computeParticleCount(stageScale: number): number {
  const mem = Number((navigator as any).deviceMemory ?? 0);
  const cores = Number(navigator.hardwareConcurrency ?? 0);
  let n = 26;
  if (stageScale < 0.8) n = 20;
  if ((mem > 0 && mem <= 2) || (cores > 0 && cores <= 4)) n = Math.min(n, 18);
  return clamp(Math.round(n), 12, 32);
}

function createGlowSprite(radius: number, tint: { core: string; mid: string }): HTMLCanvasElement {
  const r = Math.max(3, Math.round(radius));
  // 圆点：padding 用于容纳外圈柔光；保持小而克制
  const padding = Math.max(3, Math.round(r * 0.32));
  const size = r * 2 + padding * 2;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) {
    return c;
  }

  const cx = size / 2;
  const cy = size / 2;

  const outer = r + padding;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer);
  // #FEF169
  grad.addColorStop(0, 'rgba(254, 241, 105, 1)');
  grad.addColorStop(0.22, tint.core);
  grad.addColorStop(0.62, tint.mid);
  grad.addColorStop(1, 'rgba(254, 241, 105, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // 核心亮点：小而亮，增强“萤火虫”感觉
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = 'rgba(254, 241, 105, 0.95)';
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, Math.round(r * 0.12)), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  return c;
}

function makeFirefly(stageW: number, stageH: number): Firefly {
  const glow = rand(3, 6);
  const speed = rand(6, 14);
  const angle = rand(0, Math.PI * 2);
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;

  // 统一“昏黄”色系（像萤火虫），只做轻微色温变化
  const tints = [
    { core: 'rgba(254, 241, 105, 0.9)', mid: 'rgba(254, 241, 105, 0.16)' },
  ];
  const tint = pick(tints);
  const sprite = createGlowSprite(glow, tint);

  return {
    x: rand(0, stageW),
    y: rand(0, stageH),
    vx,
    vy,
    sprite,
    spriteRadius: sprite.width / 2,
    baseAlpha: rand(0.04, 0.08),
    pulseAmp: rand(0.20, 0.42),
    pulseDuration: rand(0.6, 1.1),
    nextPulseIn: rand(0, 4), // 让首屏不要同时闪
    pulseLeft: 0,
    phase: rand(0, Math.PI * 2),
    phaseSpeed: rand(0.35, 0.75),
  };
}

export function createFirefliesFx(container: HTMLElement, options: FirefliesFxOptions): FirefliesFxHandle {
  const stageW = Math.max(1, Math.floor(options.stageWidth));
  const stageH = Math.max(1, Math.floor(options.stageHeight));
  const maxPixelRatio = clamp(Number(options.maxPixelRatio ?? 2.4), 1, 4);

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  // 放在 three.js canvas 之下、背景图之上
  canvas.style.zIndex = '-1';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    // 极少数环境无法创建 2D ctx；直接返回空句柄。
    return {
      destroy: () => {
        canvas.remove();
      },
      setEnabled: () => {},
    };
  }

  let destroyed = false;
  let enabled = true;
  let running = false;
  let rafId: number | null = null;
  let lastDrawMs = 0;

  const getStageScale = options.getStageScale ?? (() => 1);

  const allowMotion = !shouldReduceMotion() && !shouldSaveData();
  if (!allowMotion) {
    enabled = false;
  }

  let lastPixelRatio = 0;
  const syncCanvas = (): number => {
    const scale = clamp(Number(getStageScale() || 1), 0.1, 6);
    const dpr = clamp(Number(window.devicePixelRatio || 1), 1, 6);
    const pixelRatio = clamp(dpr * scale, 1, maxPixelRatio);
    if (Math.abs(pixelRatio - lastPixelRatio) < 0.0001 && canvas.width > 0 && canvas.height > 0) {
      return pixelRatio;
    }
    lastPixelRatio = pixelRatio;
    canvas.width = Math.max(1, Math.round(stageW * pixelRatio));
    canvas.height = Math.max(1, Math.round(stageH * pixelRatio));
    return pixelRatio;
  };

  const stageScaleAtInit = clamp(Number(getStageScale() || 1), 0.1, 6);
  const particles: Array<Firefly> = [];
  const count = computeParticleCount(stageScaleAtInit);
  for (let i = 0; i < count; i += 1) {
    particles.push(makeFirefly(stageW, stageH));
  }

  const wrap = (p: Firefly): void => {
    const margin = 60;
    if (p.x < -margin) p.x = stageW + margin;
    if (p.x > stageW + margin) p.x = -margin;
    if (p.y < -margin) p.y = stageH + margin;
    if (p.y > stageH + margin) p.y = -margin;
  };

  const updateAndDraw = (nowMs: number): void => {
    const dt = clamp((nowMs - lastDrawMs) / 1000, 0.001, 0.06);
    lastDrawMs = nowMs;

    const pixelRatio = syncCanvas();
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, stageW, stageH);

    // 用 screen 叠加，避免“脏灰点”
    ctx.globalCompositeOperation = 'screen';

    const t = nowMs / 1000;
    for (const p of particles) {
      // 轻微随机游走：像“风”一样的漂移
      p.vx += rand(-1.2, 1.2) * dt;
      p.vy += rand(-1.0, 1.0) * dt;
      const v = Math.hypot(p.vx, p.vy);
      const vmax = 18;
      if (v > vmax) {
        const s = vmax / v;
        p.vx *= s;
        p.vy *= s;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      wrap(p);

      // 轻微常驻呼吸 + 偶发脉冲闪烁
      const breathe = 0.5 + 0.5 * Math.sin(t * p.phaseSpeed + p.phase);
      let alpha = p.baseAlpha + 0.06 * (breathe * breathe);
      if (p.pulseLeft > 0) {
        p.pulseLeft = Math.max(0, p.pulseLeft - dt);
        if (p.pulseLeft <= 0) {
          // 平均每只约 4~9 秒触发一次更亮的闪烁
          p.nextPulseIn = rand(3.5, 8.5);
        }
      } else {
        p.nextPulseIn -= dt;
        if (p.nextPulseIn <= 0) {
          p.pulseLeft = p.pulseDuration;
        }
      }
      if (p.pulseLeft > 0) {
        const u = 1 - p.pulseLeft / p.pulseDuration;
        const bell = Math.sin(Math.PI * u);
        alpha += p.pulseAmp * bell * bell;
      }
      alpha = clamp(alpha, 0, 0.65);

      ctx.globalAlpha = alpha;
      ctx.drawImage(p.sprite, p.x - p.spriteRadius, p.y - p.spriteRadius);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  const shouldRun = (): boolean => enabled && !destroyed && !document.hidden;

  const schedule = (): void => {
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(frame);
  };

  const cancel = (): void => {
    if (rafId === null) return;
    window.cancelAnimationFrame(rafId);
    rafId = null;
  };

  const frame = (nowMs: number): void => {
    rafId = null;
    if (!shouldRun()) {
      running = false;
      return;
    }
    running = true;

    // 限制到约 30fps：足够“闪烁/漂移”，同时更省电
    const targetFrameMs = 1000 / 30;
    if (lastDrawMs === 0 || nowMs - lastDrawMs >= targetFrameMs) {
      updateAndDraw(nowMs);
    }

    schedule();
  };

  const onVis = (): void => {
    if (!shouldRun()) {
      cancel();
      return;
    }
    // 重新可见时重置时间基线，避免 dt 瞬间很大
    lastDrawMs = 0;
    schedule();
  };

  document.addEventListener('visibilitychange', onVis, { passive: true });

  if (shouldRun()) {
    schedule();
  }

  return {
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      cancel();
      document.removeEventListener('visibilitychange', onVis);
      canvas.remove();
    },
    setEnabled: (next: boolean) => {
      enabled = Boolean(next);
      if (!enabled) {
        cancel();
        return;
      }
      if (running) return;
      lastDrawMs = 0;
      schedule();
    },
  };
}
