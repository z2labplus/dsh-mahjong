import { AssetLoader } from "./asset-loader";
import { Mesh, CanvasTexture, Vector2, MeshLambertMaterial, Texture } from "three";
import { Client } from "./client";
import { DiceInfo } from "./types";
import type { BloodState } from "./blood";
import type { GuobiaoState } from "./guobiao";

export type CenterStyle = 'default' | 'mahjongMobile';

type DigitSprite = {
  img: CanvasImageSource;
  w: number;
  h: number;
  cellW: number;
  cellH: number;
};

type RGB = [number, number, number];

type TileBackGlowPalette = {
  bright: RGB;
  mid: RGB;
  dark: RGB;
};

const CENTER_COUNTDOWN_START = 16;
const CENTER_COUNTDOWN_CYCLE_MS = (CENTER_COUNTDOWN_START + 1) * 1000;

export class Center {
  mesh: Mesh;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: CanvasTexture;
  private baseImage: CanvasImageSource;
  private style: CenterStyle;
  // 3D 牌使用的贴图（用于在中心盘数码屏里绘制“完全一致”的牌背小图标）
  private tileAtlasImage: CanvasImageSource | null = null;
  private tileAtlasW = 0;
  private tileAtlasH = 0;
  // 牌背黄系高亮：从牌背贴图采样得到（固定 back=0，不跟随 conditions.back）
  private tileBackGlowPalette: TileBackGlowPalette | null = null;
  private tileBackGlowPaletteTried = false;
  // Safari/WebKit 预渲染的 7 段数字贴图（让 Chrome/Safari 显示一致）
  private digitsBig: DigitSprite | null = null;
  private digitsSmall: DigitSprite | null = null;

  scores: Array<number | null> = new Array(5).fill(null);
  nicks: Array<string | null> = new Array(4).fill(null);
  dealer: number | null = null;
  honba = 0;
  diceInfo: DiceInfo = { dice: [1, 1], state: 'ignore' };
  shouldDrawDice = false;

  private countdownSeconds: number | null = CENTER_COUNTDOWN_START;
  private countdownLoopBaseMs: number = Date.now();
  private countdownLoopEnabled = false;
  private wallRemaining: number | null = null;
  private activeTurnSeat: number | null = null;
  diceImg: HTMLImageElement;

  client: Client;

  dirty = true;

  constructor(loader: AssetLoader, client: Client, options?: { style?: CenterStyle }) {
    this.style = options?.style ?? 'default';
    this.mesh = loader.makeCenter();
    this.canvas = document.getElementById('center')! as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;

    const material = this.mesh.material as MeshLambertMaterial;
    const image = material.map!.image as HTMLImageElement;
    this.baseImage = image;

    this.canvas.width = image.width;
    this.canvas.height = image.height;
    this.ctx.drawImage(image, 0, 0);

    // 读取 tile mesh 使用的同一张贴图，保证小图标与 3D 牌背纹理完全一致
    try {
      const tileMaterial = loader.meshes.tile.material as MeshLambertMaterial;
      const tileMapImg = tileMaterial.map?.image as any;
      const w = tileMapImg?.naturalWidth ?? tileMapImg?.width ?? 0;
      const h = tileMapImg?.naturalHeight ?? tileMapImg?.height ?? 0;
      if (tileMapImg && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        this.tileAtlasImage = tileMapImg as CanvasImageSource;
        this.tileAtlasW = Math.trunc(w);
        this.tileAtlasH = Math.trunc(h);
      }
    } catch {
      // 没拿到贴图就不画（不做额外 fallback，避免引入未要求的视觉兼容逻辑）
    }

    // 数码屏数字：使用预渲染贴图，避免不同浏览器的字体栅格化差异
    this.digitsBig = this.readDigitSprite(loader.textures.segment7DigitsBig);
    this.digitsSmall = this.readDigitSprite(loader.textures.segment7DigitsSmall);

    this.texture = new CanvasTexture(this.canvas);
    this.texture.flipY = false;
    this.texture.rotation = Math.PI;
    this.texture.center = new Vector2(0.5, 0.5);
    this.texture.anisotropy = 16;
    material.map = this.texture;
    if (this.style === 'mahjongMobile') {
      // 移动端中心盘希望更“通透”，避免模型局部在当前灯光下过暗
      material.emissive.setRGB(0.08, 0.08, 0.08);
      material.emissiveIntensity = 1;
      // 允许 canvas 贴图出现“真透明”像素（方位环背景挖空）
      material.transparent = true;
      // 避免完全透明区域仍写入深度，导致“看不穿”的伪透明
      material.alphaTest = 0.01;
      material.needsUpdate = true;
    }

    this.client = client;
    this.client.nicks.on('update', this.update.bind(this));
    this.client.match.on('update', this.update.bind(this));
    this.client.seats.on('update', this.update.bind(this));
    this.client.dice.on('update', this.updateDice.bind(this));
    if (this.style === 'mahjongMobile') {
      this.client.things.on('update', () => this.updateWallRemaining());
      this.updateWallRemaining();
      this.client.blood.on('update', () => this.updateTurnState());
      this.client.gb.on('update', () => this.updateTurnState());
      this.updateTurnState();
      this.client.on('connect', () => this.resetCountdownLoop());
      this.resetCountdownLoop();
      // 轮到谁的方位高亮：用“呼吸闪烁”提升可见性（约 1Hz）
      window.setInterval(() => {
        if (this.countdownLoopEnabled) {
          this.updateCountdownLoop();
        }
        if (this.activeTurnSeat !== null) {
          this.dirty = true;
        }
      }, 50);
    }

    this.diceImg = document.getElementById('dice-img')! as HTMLImageElement;

    client.on('disconnect', this.update.bind(this));
  }

  private readDigitSprite(texture: Texture | undefined): DigitSprite | null {
    const img = texture?.image as any;
    if (!img) return null;
    const w = img?.naturalWidth ?? img?.width ?? 0;
    const h = img?.naturalHeight ?? img?.height ?? 0;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return null;
    }
    const cols = 11; // "0123456789-"
    const cellW = Math.round(w / cols);
    if (cellW <= 0 || Math.abs(cellW * cols - w) > 0.001) {
      return null;
    }
    return { img, w: Math.trunc(w), h: Math.trunc(h), cellW, cellH: Math.trunc(h) };
  }

  private digitSpriteIndex(ch: string): number | null {
    if (ch === '-') return 10;
    const code = ch.charCodeAt(0);
    if (code < 48 || code > 57) return null;
    return code - 48;
  }

  private measureDigitSprite(text: string, sprite: DigitSprite | null, scale = 1): number {
    if (!sprite) return 0;
    return text.length * sprite.cellW * scale;
  }

  private drawDigitSpriteText(
    text: string,
    x: number,
    y: number,
    sprite: DigitSprite | null,
    options?: { align?: 'left' | 'center' | 'right'; scale?: number },
  ): void {
    if (!sprite || text.length === 0) return;
    const align = options?.align ?? 'left';
    const scale = options?.scale ?? 1;

    const sw = sprite.cellW;
    const sh = sprite.cellH;
    const dw = sw * scale;
    const dh = sh * scale;

    const width = text.length * dw;
    const startX =
      align === 'center' ? (x - width * 0.5) :
        align === 'right' ? (x - width) :
          x;
    const topY = y - dh * 0.5;

    for (let i = 0; i < text.length; i++) {
      const idx = this.digitSpriteIndex(text[i]!);
      if (idx === null) continue;
      const sx = idx * sw;
      const dx = startX + i * dw;
      this.ctx.drawImage(sprite.img, sx, 0, sw, sh, dx, topY, dw, dh);
    }
  }

  update(): void {
    for (let i = 0; i < 4; i++) {
      if (this.client.connected()) {
        const playerId = this.client.seatPlayers[i];
        const nick = playerId !== null ? this.client.nicks.get(playerId) : null;
        this.nicks[i] = nick ?? null;
      } else {
        this.nicks[i] = null;
      }
    }

    this.dealer = this.client.match.get(0)?.dealer ?? null;
    this.honba = this.client.match.get(0)?.honba ?? 0;

    this.dirty = true;
  }

  updateDice(): void {
    this.diceInfo = this.client.dice.get(0) ?? { dice: [1, 1], state: 'ignore' };
    if (this.diceInfo.state == 'rolled') {
      this.shouldDrawDice = true;
      this.dirty = true;
      setTimeout(() => {
        this.shouldDrawDice = false;
        this.dirty = true;
        this.draw();
      }, 1000);
    }
  }

  private updateWallRemaining(): void {
    const next = this.computeWallRemaining();
    if (next !== this.wallRemaining) {
      this.wallRemaining = next;
      this.dirty = true;
    }
  }

  private updateTurnState(): void {
    if (this.client.match.get(0)?.caseStudy?.partial) {
      this.countdownLoopEnabled = false;
      this.countdownSeconds = null;
      this.activeTurnSeat = null;
      this.dirty = true;
      return;
    }
    const gbState = this.client.gb.get(0) as GuobiaoState | null;
    const bloodState = this.client.blood.get(0) as BloodState | null;
    const state = gbState ?? bloodState;
    const phase = state?.phase ?? null;
    const match = this.client.match.get(0);
    const untimed = !!match?.sourceReplay || match?.friendConfig?.waitMode === 'noTimeout';
    const shouldRunCountdown =
      phase === 'swap3' || phase === 'dingque' || phase === 'playing';
    // Recorded and untimed hands have no decision countdown. Keep the turn
    // indication and remaining-tile count without inventing a cycling clock.
    if (untimed) {
      this.countdownLoopEnabled = false;
      if (this.countdownSeconds !== null) {
        this.countdownSeconds = null;
        this.dirty = true;
      }
    } else if (shouldRunCountdown && !this.countdownLoopEnabled) {
      this.countdownLoopEnabled = true;
      this.resetCountdownLoop();
    } else if (!shouldRunCountdown && this.countdownLoopEnabled) {
      this.countdownLoopEnabled = false;
      if (this.countdownSeconds !== CENTER_COUNTDOWN_START) {
        this.countdownSeconds = CENTER_COUNTDOWN_START;
        this.dirty = true;
      }
    }

    const nextTurnSeat =
      state && state.phase === 'playing' ? state.turnSeat : null;
    if (nextTurnSeat !== this.activeTurnSeat) {
      this.activeTurnSeat = nextTurnSeat;
      this.dirty = true;
    }
  }

  private resetCountdownLoop(nowMs: number = Date.now()): void {
    if (this.client.match.get(0)?.sourceReplay || this.client.match.get(0)?.friendConfig?.waitMode === 'noTimeout') {
      this.countdownLoopEnabled = false;
      this.countdownSeconds = null;
      this.dirty = true;
      return;
    }
    this.countdownLoopBaseMs = Math.trunc(nowMs);
    if (!this.countdownLoopEnabled) {
      if (this.countdownSeconds !== CENTER_COUNTDOWN_START) {
        this.countdownSeconds = CENTER_COUNTDOWN_START;
        this.dirty = true;
      }
      return;
    }
    this.updateCountdownLoop(nowMs);
  }

  private updateCountdownLoop(nowMs: number = Date.now()): void {
    const elapsedMs = Math.max(0, Math.trunc(nowMs) - this.countdownLoopBaseMs);
    const elapsedSec = Math.floor((elapsedMs % CENTER_COUNTDOWN_CYCLE_MS) / 1000);
    const next = CENTER_COUNTDOWN_START - elapsedSec;
    if (this.countdownSeconds !== next) {
      this.countdownSeconds = next;
      this.dirty = true;
    }
  }

  private computeWallRemaining(): number | null {
    if (this.client.match.get(0)?.caseStudy?.partial) return null;
    let count = 0;
    for (const [index, thingInfo] of this.client.things.entries()) {
      // Tile things are < 1000; sticks/markers use other ranges.
      if (index >= 1000) {
        continue;
      }
      const slotName = thingInfo?.slotName;
      if (typeof slotName === 'string' && slotName.startsWith('wall')) {
        count += 1;
      }
    }
    return count;
  }

  setScores(scores: Array<number | null>): void {
    for (let i = 0; i < 5; i++) {
      if (scores[i] !== this.scores[i]) {
        this.dirty = true;
      }
      this.scores[i] = scores[i];
    }
  }

  draw(): void {
    if (!this.dirty) {
      return;
    }
    this.dirty = false;

    const w = this.canvas.width;
    const h = this.canvas.height;

    const offset = 0.24 * 512;
    const width = 0.52 * 512;

    this.ctx.resetTransform();

    this.ctx.clearRect(0, 0, w, h);

    if (this.style === 'mahjongMobile') {
      this.drawMahjongMobile();
    } else {
      // 默认样式基于模型自带底图叠画，避免每帧叠字产生残影
      this.ctx.drawImage(this.baseImage, 0, 0, w, h);
      this.drawDefault(offset, width);
    }

    this.texture.needsUpdate = true;
  }

  private drawDefault(offset: number, width: number): void {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(offset, offset, width, width);

    this.ctx.textBaseline = 'middle';

    this.ctx.translate(256, 256);

    for (let i = 0; i < 4; i++) {
      this.drawScore(this.scores[i]);
      this.drawNick(this.nicks[i]);
      if (this.dealer === i) {
        this.drawDealer();
      }
      this.ctx.rotate(-Math.PI / 2);
    }

    if (this.shouldDrawDice) {
      this.ctx.rotate(Math.PI / 4);
      this.drawDice();
    }
  }

  private formatCountdown(): string {
    if (this.countdownSeconds === null) {
      return '--';
    }
    const n = Math.max(0, Math.floor(this.countdownSeconds));
    return String(n).padStart(2, '0');
  }

  private formatWallRemaining(): string {
    if (this.wallRemaining === null) {
      return '--';
    }
    return String(Math.max(0, Math.floor(this.wallRemaining)));
  }

  private roundedRectPath(x: number, y: number, w: number, h: number, r: number): void {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    this.ctx.beginPath();
    this.ctx.moveTo(x + radius, y);
    this.ctx.arcTo(x + w, y, x + w, y + h, radius);
    this.ctx.arcTo(x + w, y + h, x, y + h, radius);
    this.ctx.arcTo(x, y + h, x, y, radius);
    this.ctx.arcTo(x, y, x + w, y, radius);
    this.ctx.closePath();
  }

  private fillRoundedRect(x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient): void {
    this.roundedRectPath(x, y, w, h, r);
    this.ctx.fillStyle = fill;
    this.ctx.fill();
  }

  private strokeRoundedRect(x: number, y: number, w: number, h: number, r: number): void {
    this.roundedRectPath(x, y, w, h, r);
    this.ctx.stroke();
  }

  private rgba(rgb: RGB, a: number): string {
    const [r, g, b] = rgb;
    return `rgba(${r},${g},${b},${a})`;
  }

  private getTileBackGlowPalette(): TileBackGlowPalette | null {
    if (this.tileBackGlowPaletteTried) {
      return this.tileBackGlowPalette;
    }
    this.tileBackGlowPaletteTried = true;
    this.tileBackGlowPalette = this.sampleTileBackGlowPalette();
    return this.tileBackGlowPalette;
  }

  private sampleTileBackGlowPalette(): TileBackGlowPalette | null {
    const img = this.tileAtlasImage;
    if (!img || this.tileAtlasW <= 0 || this.tileAtlasH <= 0) {
      return null;
    }

    // back=0 的牌背（不跟随 conditions.back）
    const DU = 32 / 256;
    const DV = 40 / 256;
    const BACK_COL = 7;
    const BACK_ROW = 4;
    const sx = (BACK_COL * DU) * this.tileAtlasW;
    const sy = (BACK_ROW * DV) * this.tileAtlasH;
    const sw = DU * this.tileAtlasW;
    const sh = DV * this.tileAtlasH;
    if (!(sw > 2 && sh > 2)) {
      return null;
    }

    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw));
    c.height = Math.max(1, Math.round(sh));
    const cctx = c.getContext('2d', { willReadFrequently: true });
    if (!cctx) {
      return null;
    }
    try {
      cctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    } catch {
      return null;
    }

    const sampleAvg = (cyRatio: number): RGB => {
      const w = c.width;
      const h = c.height;
      const cx = w * 0.5;
      const cy = h * cyRatio;
      const rw = w * 0.34;
      const rh = h * 0.22;
      const x0 = Math.max(0, Math.min(w - 1, Math.round(cx - rw * 0.5)));
      const y0 = Math.max(0, Math.min(h - 1, Math.round(cy - rh * 0.5)));
      const x1 = Math.max(x0 + 1, Math.min(w, Math.round(cx + rw * 0.5)));
      const y1 = Math.max(y0 + 1, Math.min(h, Math.round(cy + rh * 0.5)));
      let data: Uint8ClampedArray;
      try {
        data = cctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      } catch {
        return [230, 175, 60];
      }
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] / 255;
        if (a <= 0) continue;
        r += data[i] * a;
        g += data[i + 1] * a;
        b += data[i + 2] * a;
        n += a;
      }
      if (n <= 1e-6) {
        return [230, 175, 60];
      }
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    };

    const lum = (rgb: RGB): number => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    const samples: Array<RGB> = [sampleAvg(0.22), sampleAvg(0.52), sampleAvg(0.82)];
    samples.sort((a, b) => lum(b) - lum(a));
    const bright: RGB = samples[0] ?? [255, 235, 160];
    const mid: RGB = samples[1] ?? [230, 175, 60];
    const dark: RGB = samples[2] ?? [120, 85, 20];
    return { bright, mid, dark };
  }

  private drawTileBackIcon(x: number, y: number, w: number, h: number): void {
    const img = this.tileAtlasImage;
    if (!img || this.tileAtlasW <= 0 || this.tileAtlasH <= 0) {
      return;
    }

    // 跟随 match.conditions.back：back=0/1 对应不同的牌背变体
    const backRaw = this.client.match.get(0)?.conditions?.back ?? 0;
    const back = backRaw === 1 ? 1 : 0;

    // 贴图裁切规则与 TileThingGroup 的 UV 规则一致：
    // - 单格尺寸：UV 以 256x256 为基准，其中 tile 单元为 32x40（导出成更高分辨率后比例不变）
    // - 牌背位于第 7 列、第 4 行（back=0）与第 5 行（back=1）
    const DU = 32 / 256;
    const DV = 40 / 256;
    const BACK_COL = 7;
    const BACK_ROW_BASE = 4;

    const sx = (BACK_COL * DU) * this.tileAtlasW;
    const sy = ((BACK_ROW_BASE + back) * DV) * this.tileAtlasH;
    const sw = DU * this.tileAtlasW;
    const sh = DV * this.tileAtlasH;
    if (!(sw > 0 && sh > 0)) {
      return;
    }

    // 保持图标占位尺寸 (w/h) 不变，但不拉伸牌背纹理（等比缩放后居中）
    const srcRatio = sw / sh;
    const dstRatio = w / Math.max(1e-6, h);
    let dw = w;
    let dh = h;
    if (dstRatio >= srcRatio) {
      dh = h;
      dw = dh * srcRatio;
    } else {
      dw = w;
      dh = dw / srcRatio;
    }
    const dx = x + (w - dw) * 0.5;
    const dy = y + (h - dh) * 0.5;

    this.ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  private drawMahjongMobile(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // 移动端：完全自绘整张贴图，不再叠加模型自带底图（避免露出黑条/旧元素）
    // 为了避免“外方角/内圆角”在角落出现底色差异，这里外层与外壳使用同一套底色。
    const shellGradient = ctx.createLinearGradient(0, 0, 0, h);
    shellGradient.addColorStop(0, '#4a515b');
    shellGradient.addColorStop(1, '#2b313a');
    ctx.fillStyle = shellGradient;
    ctx.fillRect(0, 0, w, h);

    // 外壳/底座（偏蓝灰，匹配整体桌面风格）
    // 仅保留很小的边距，用来避免描边被裁切；外层颜色已与外壳一致，不会再产生角落色差
    const bezelPad = Math.min(w, h) * 0.02;
    const bezelX = bezelPad;
    const bezelY = bezelPad;
    const bezelW = w - bezelPad * 2;
    const bezelH = h - bezelPad * 2;
    const bezelR = Math.min(bezelW, bezelH) * 0.18;

    this.fillRoundedRect(bezelX, bezelY, bezelW, bezelH, bezelR, shellGradient);
    ctx.lineWidth = Math.max(1, Math.round(Math.min(bezelW, bezelH) * 0.03));
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    this.strokeRoundedRect(bezelX, bezelY, bezelW, bezelH, bezelR);
    ctx.lineWidth = Math.max(1, Math.round(Math.min(bezelW, bezelH) * 0.015));
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    this.strokeRoundedRect(
      bezelX + bezelW * 0.02,
      bezelY + bezelH * 0.02,
      bezelW * 0.96,
      bezelH * 0.96,
      bezelR * 0.92,
    );

    const size = Math.min(w, h);
    const panelSize = size * 0.62;
    const x0 = (w - panelSize) / 2;
    const y0 = (h - panelSize) / 2;
    const r = panelSize * 0.01;
    const cx = w / 2;
    const cy = h / 2;

    // 方位环背景：真透明（挖空），让下层桌面/HTML 背景透出
    ctx.save();
    this.roundedRectPath(x0, y0, panelSize, panelSize, r);
    ctx.clip();
    ctx.clearRect(x0, y0, panelSize, panelSize);
    ctx.restore();

    // 外边框与内高光，做出一点“面板”质感
    ctx.lineWidth = panelSize * 0.02;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    this.strokeRoundedRect(x0, y0, panelSize, panelSize, r);
    ctx.lineWidth = panelSize * 0.01;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    this.strokeRoundedRect(
      x0 + panelSize * 0.015,
      y0 + panelSize * 0.015,
      panelSize * 0.97,
      panelSize * 0.97,
      r * 0.85,
    );

    // 东南西北：保持原本顺序（下东、右南、上西、左北），但文字朝向按腾讯那样“面向各自方位”
    // 高亮区域与风位字：
    // - 外框/蓝面板属于“桌面坐标系”（不做反向旋转），因此高亮边要按 turnSeat 的绝对方位选边
    // - 数码屏会做反向旋转保持可读，因此高亮时“连接到数码屏的哪一条边”要按相对视角选边
    const winds = { bottom: '东', right: '南', top: '西', left: '北' } as const;
    const viewerSeat = this.client.seat ?? 0;
    const activeSide =
      this.activeTurnSeat === 0 ? 'bottom' :
        this.activeTurnSeat === 1 ? 'right' :
          this.activeTurnSeat === 2 ? 'top' :
            this.activeTurnSeat === 3 ? 'left' :
              null;
    const screenRel =
      this.activeTurnSeat === null ? null :
        (this.activeTurnSeat - viewerSeat + 4) % 4;
    const screenSide =
      screenRel === 0 ? 'bottom' :
        screenRel === 1 ? 'right' :
          screenRel === 2 ? 'top' :
            screenRel === 3 ? 'left' :
              null;
    const pulse = activeSide
      ? (0.5 + 0.5 * Math.sin((Date.now() / 1000) * Math.PI * 2))
      : 0;

    // 中心“数码屏”参数：用于高亮区域的几何计算，以及后续数码屏绘制
    const screenW = panelSize * 0.44;
    const screenH = panelSize * 0.38;
    const sx = cx - screenW / 2;
    const sy = cy - screenH / 2;
    const sr = Math.min(screenW, screenH) * 0.01;

    const seatAngle = ((viewerSeat % 4) + 4) % 4 * (Math.PI / 2);

    // 轮到谁：对应边的“扇区四边形”闪烁（连接 外框该侧两角 -> 数码屏该侧两角）
    // - 颜色：牌背黄系，由外框更亮 -> 靠数码屏更暗（反向渐变）
    // - 与数码屏一样做反向旋转：内侧边严格贴合最终看到的数码屏边缘
    if (activeSide && screenSide) {
      const cos = Math.cos(-seatAngle);
      const sin = Math.sin(-seatAngle);
      const rot = (x: number, y: number): { x: number; y: number } => {
        const dx = x - cx;
        const dy = y - cy;
        return {
          x: cx + dx * cos - dy * sin,
          y: cy + dx * sin + dy * cos,
        };
      };

      const sTL = rot(sx, sy);
      const sTR = rot(sx + screenW, sy);
      const sBL = rot(sx, sy + screenH);
      const sBR = rot(sx + screenW, sy + screenH);

      // 外框边（绝对方位）
      let bezelA: { x: number; y: number };
      let bezelB: { x: number; y: number };
      if (activeSide === 'bottom') {
        bezelA = { x: bezelX, y: bezelY + bezelH };
        bezelB = { x: bezelX + bezelW, y: bezelY + bezelH };
      } else if (activeSide === 'right') {
        bezelA = { x: bezelX + bezelW, y: bezelY };
        bezelB = { x: bezelX + bezelW, y: bezelY + bezelH };
      } else if (activeSide === 'top') {
        bezelA = { x: bezelX + bezelW, y: bezelY };
        bezelB = { x: bezelX, y: bezelY };
      } else {
        // left
        bezelA = { x: bezelX, y: bezelY + bezelH };
        bezelB = { x: bezelX, y: bezelY };
      }
      const outerMid = { x: (bezelA.x + bezelB.x) * 0.5, y: (bezelA.y + bezelB.y) * 0.5 };

      // 数码屏边（相对视角）
      let screenA: { x: number; y: number };
      let screenB: { x: number; y: number };
      if (screenSide === 'bottom') {
        screenA = sBL;
        screenB = sBR;
      } else if (screenSide === 'right') {
        screenA = sTR;
        screenB = sBR;
      } else if (screenSide === 'top') {
        screenA = sTL;
        screenB = sTR;
      } else {
        // left
        screenA = sTL;
        screenB = sBL;
      }
      const innerMid = { x: (screenA.x + screenB.x) * 0.5, y: (screenA.y + screenB.y) * 0.5 };

      // 让屏幕边的两个角与外框边的两个角“就近配对”，避免四边形自交
      const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }): number => {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return dx * dx + dy * dy;
      };
      let p2 = screenA;
      let p3 = screenB;
      if (dist2(screenB, bezelB) < dist2(screenA, bezelB)) {
        p2 = screenB;
        p3 = screenA;
      }
      const p0 = bezelA;
      const p1 = bezelB;

      // 亮度用“底亮 + 呼吸幅度”控制；screen 混合下不宜太大，否则会泛白
      const a = 0.05 + 0.18 * pulse;
      const palette = this.getTileBackGlowPalette();
      const dark = palette?.dark ?? ([120, 85, 20] as RGB);
      const mid = palette?.mid ?? ([230, 175, 60] as RGB);
      const bright = palette?.bright ?? ([255, 235, 160] as RGB);
      ctx.save();
      // 只在外框范围内闪烁，避免溢出到外框圆角之外
      this.roundedRectPath(bezelX, bezelY, bezelW, bezelH, bezelR);
      ctx.clip();

      const grad = ctx.createLinearGradient(innerMid.x, innerMid.y, outerMid.x, outerMid.y);
      grad.addColorStop(0, this.rgba(dark, a));
      grad.addColorStop(0.55, this.rgba(mid, a));
      grad.addColorStop(1, this.rgba(bright, a));
      ctx.fillStyle = grad;
      // 用 screen 叠加做“打光”效果，避免黄+蓝叠成脏绿
      ctx.globalCompositeOperation = 'screen';
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const windFontSize = Math.round(panelSize * 0.14);
    ctx.font = `${windFontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;

    const drawWind = (side: keyof typeof winds, x: number, y: number, rot: number): void => {
      const highlight = activeSide === side;
      ctx.save();
      ctx.translate(x, y);
      if (rot !== 0) {
        ctx.rotate(rot);
      }
      if (highlight) {
        ctx.fillStyle = `rgba(255,255,255,${0.92 + 0.06 * pulse})`;
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
      }
      ctx.fillText(winds[side], 0, 0);
      ctx.restore();
    };

    drawWind('top', cx, y0 + panelSize * 0.13, Math.PI);
    drawWind('bottom', cx, y0 + panelSize * 0.87, 0);
    drawWind('left', x0 + panelSize * 0.13, cy, Math.PI / 2);
    drawWind('right', x0 + panelSize * 0.87, cy, -Math.PI / 2);

    // 中心“数码屏”：尽量贴近腾讯（数字更大、更居中、并始终正向可读）
    // 说明：移动端会旋转视角（seat 旋转桌面），为了让数字永远面向当前玩家，这里在贴图上对“数码屏”做反向旋转抵消。
    ctx.save();
    ctx.translate(cx, cy);
    // Canvas 的正角度是顺时针（Y 轴向下）；视角是通过旋转相机组实现的，因此这里用反向角度抵消“数字侧转”
    ctx.rotate(-seatAngle);
    ctx.translate(-cx, -cy);

    // 四角“凹槽”对角线：外壳角 -> 数码屏外框角（不进入数码屏内部），并跟随数码屏反向旋转保持正向可读
    const grooveLineW = Math.max(1, Math.round(panelSize * 0.008));
    const grooveOffset = grooveLineW * 0.65;
    const grooveLight = 'rgba(255,255,255,0.18)';
    const grooveShadow = 'rgba(0,0,0,0.22)';
    const appendRoundedRectPath = (x: number, y: number, rw: number, rh: number, rr: number): void => {
      const radius = Math.max(0, Math.min(rr, rw / 2, rh / 2));
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + rw, y, x + rw, y + rh, radius);
      ctx.arcTo(x + rw, y + rh, x, y + rh, radius);
      ctx.arcTo(x, y + rh, x, y, radius);
      ctx.arcTo(x, y, x + rw, y, radius);
      ctx.closePath();
    };
    const drawGroove = (x1: number, y1: number, x2: number, y2: number): void => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len <= 0.001) {
        return;
      }
      // 单位法线（两侧），用于做“高光/阴影”双线偏移
      const nx = dy / len;
      const ny = -dx / len;
      // 默认光源方向：左上（常见）
      const lx = -1 / Math.SQRT2;
      const ly = -1 / Math.SQRT2;
      const dot = nx * lx + ny * ly;
      const hx = dot >= 0 ? nx : -nx;
      const hy = dot >= 0 ? ny : -ny;

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = grooveLineW;

      ctx.strokeStyle = grooveLight;
      ctx.beginPath();
      ctx.moveTo(x1 + hx * grooveOffset, y1 + hy * grooveOffset);
      ctx.lineTo(x2 + hx * grooveOffset, y2 + hy * grooveOffset);
      ctx.stroke();

      ctx.strokeStyle = grooveShadow;
      ctx.beginPath();
      ctx.moveTo(x1 - hx * grooveOffset, y1 - hy * grooveOffset);
      ctx.lineTo(x2 - hx * grooveOffset, y2 - hy * grooveOffset);
      ctx.stroke();
    };
    ctx.save();
    // 只在“外壳内”绘制，并且挖掉数码屏区域，避免半透明黑底下露出凹槽线
    ctx.beginPath();
    appendRoundedRectPath(bezelX, bezelY, bezelW, bezelH, bezelR);
    appendRoundedRectPath(sx, sy, screenW, screenH, sr);
    ctx.clip('evenodd');
    drawGroove(bezelX, bezelY, sx, sy);
    drawGroove(bezelX + bezelW, bezelY, sx + screenW, sy);
    drawGroove(bezelX, bezelY + bezelH, sx, sy + screenH);
    drawGroove(bezelX + bezelW, bezelY + bezelH, sx + screenW, sy + screenH);
    ctx.restore();

    // 数码屏：上下两层背景（上层略亮、下层略暗）
    ctx.save();
    this.roundedRectPath(sx, sy, screenW, screenH, sr);
    ctx.clip();

    const split = sy + screenH * 0.60;
    const overlap = Math.round(Math.max(2, Math.min(4, screenH * 0.03)));
    const edgeY = split + overlap;

    // 下层：更深的蓝黑底（左 -> 右逐步提亮）
    const bottomGrad = ctx.createLinearGradient(sx, 0, sx + screenW, 0);
    bottomGrad.addColorStop(0, '#0b2230');
    bottomGrad.addColorStop(0.55, '#123e56');
    bottomGrad.addColorStop(1, '#1f5f86');
    ctx.fillStyle = bottomGrad;
    ctx.fillRect(sx, split, screenW, sy + screenH - split);

    // 上层：略亮一些（左 -> 右逐步提亮），并向下覆盖 overlap 像素
    const topGrad = ctx.createLinearGradient(sx, 0, sx + screenW, 0);
    topGrad.addColorStop(0, '#0f2c40');
    topGrad.addColorStop(0.55, '#1a4f73');
    topGrad.addColorStop(1, '#2a6f9a');
    ctx.fillStyle = topGrad;
    ctx.fillRect(sx, sy, screenW, edgeY - sy);

    // 上下层分界：保持干净，不额外加“压边/投影”，避免出现一段明显的黑带

    ctx.restore();

    // 外框描边（保持与之前一致）
    ctx.lineWidth = Math.max(1, Math.round(screenW * 0.045));
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    this.strokeRoundedRect(sx, sy, screenW, screenH, sr);

    // 倒计时（更大更醒目）
    // 让倒计时在“上层面板”里居中（不要用全屏比例写死，后续调 split 也不会跑偏）
    this.drawDigitSpriteText(this.formatCountdown(), cx, sy + (split - sy) * 0.55, this.digitsBig, { align: 'center', scale: 0.85 });

    // 牌墙剩余： [牌背] + 数字（整体居中，避免偏左）
    const wallText = this.formatWallRemaining();
    const wallTextWidth = this.measureDigitSprite(wallText, this.digitsSmall);

    const iconH = screenH * 0.30;
    const iconW = iconH * 0.78;
    const gap = screenW * 0.06;
    const groupW = iconW + gap + wallTextWidth;
    const groupX = cx - groupW / 2;
    const rowY = sy + screenH * 0.78;

    this.drawTileBackIcon(groupX, rowY - iconH / 2, iconW, iconH);

    this.drawDigitSpriteText(wallText, groupX + iconW + gap, rowY, this.digitsSmall, { align: 'left' });

    ctx.restore();
  }

  drawScore(score: number | null): void {
    if (score === null) {
      return;
    }

    this.ctx.textAlign = 'right';
    this.ctx.font = '40px Segment7Standard, monospace';
    if (score > 0) {
      this.ctx.fillStyle = '#eee';
    } else if (0 <= score && score <= 1000) {
      this.ctx.fillStyle = '#e80';
    } else {
      this.ctx.fillStyle = '#e00';
    }
    const text = '' + score;
    this.ctx.fillText(text, 60, 100);
  }

  drawNick(nick: string | null): void {
    let text;
    if (nick === null) {
      text = '';
    } else if (nick === '') {
      text = 'Player';
    } else {
      text = nick.substr(0, 10);
    }

    this.ctx.textAlign = 'center';
    this.ctx.font = '20px Verdana, Arial';
    this.ctx.fillStyle = '#afa';
    this.ctx.fillText(text, 0, 55);
  }

  drawDealer(): void {
    this.ctx.fillStyle = '#a60';
    this.ctx.fillRect(-132, 132, 264, -13);
    if (this.honba > 0) {
      this.ctx.textAlign = 'right';
      this.ctx.font = '40px Segment7Standard, monospace';
      this.ctx.fillText('' + this.honba, -90, 100);
    }
  }

  drawDice(): void {
    let [a, b] = this.diceInfo.dice;

    // Animate
    // const t = Math.floor(new Date().getTime() / 100);
    // a = t % 6 + 1;
    // // https://en.wikipedia.org/wiki/Linear_congruential_generator
    // b = (t * 1664525 + 1013904223) % 6 + 1;

    this.drawDie(a, -44, -20, 40);
    this.drawDie(b, 4, -20, 40);
  }

  drawDie(n: number, dx: number, dy: number, dstSize: number) {
    const srcSize = this.diceImg.naturalHeight;
    this.ctx.drawImage(
      this.diceImg,
      (n - 1) * srcSize, 0,
      srcSize, srcSize,
      dx, dy,
      dstSize, dstSize,
    );
  }
}
