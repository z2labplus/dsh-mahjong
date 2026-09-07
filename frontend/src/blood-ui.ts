import { Vector3 } from 'three';

import { Client } from './client';
import { GameType, ThingType } from './types';
import type { BloodAction, BloodState, BloodSuit, BloodSwap3Direction } from './blood';
import { World } from './world';
import { suitOf, tileKeyFromTypeIndex } from './blood-tiles';
import { canHuCounts } from './blood-win';
import { computeDiscardEdge, computeHandMeldEdge } from './mobile-hand-layout';
import type { Place } from './types';
import type { MainView } from './main-view';

type RectPx = { left: number; top: number; right: number; bottom: number };
type LockedClaimAction = 'hu' | 'peng' | 'gang';
type PanelButton = { text: string; cls?: string; disabled?: boolean; hidden?: boolean; onClick?: () => void };
type DingqueButton = {
  text: string;
  suit: BloodSuit;
  onClick?: () => void;
  selected?: boolean;
  muted?: boolean;
  disabled?: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isDingqueCommitted(player: { dingque: BloodSuit | null; dingqueReady?: boolean } | null | undefined): boolean {
  if (!player) return false;
  return player.dingqueReady === true || player.dingque !== null;
}

const DEFAULT_DECISION_TIMEOUT_MS = 6 * 60 * 1000;

const PROJECT_CORNERS = Array.from({ length: 8 }, () => new Vector3());

function projectAabbToNdc(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  camera: any,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  PROJECT_CORNERS[0].set(minX, minY, minZ);
  PROJECT_CORNERS[1].set(minX, minY, maxZ);
  PROJECT_CORNERS[2].set(minX, maxY, minZ);
  PROJECT_CORNERS[3].set(minX, maxY, maxZ);
  PROJECT_CORNERS[4].set(maxX, minY, minZ);
  PROJECT_CORNERS[5].set(maxX, minY, maxZ);
  PROJECT_CORNERS[6].set(maxX, maxY, minZ);
  PROJECT_CORNERS[7].set(maxX, maxY, maxZ);

  let outMinX = Infinity;
  let outMaxX = -Infinity;
  let outMinY = Infinity;
  let outMaxY = -Infinity;
  for (const corner of PROJECT_CORNERS) {
    corner.project(camera);
    outMinX = Math.min(outMinX, corner.x);
    outMaxX = Math.max(outMaxX, corner.x);
    outMinY = Math.min(outMinY, corner.y);
    outMaxY = Math.max(outMaxY, corner.y);
  }
  if (!Number.isFinite(outMinX) || !Number.isFinite(outMaxX) || !Number.isFinite(outMinY) || !Number.isFinite(outMaxY)) {
    return null;
  }
  return { minX: outMinX, maxX: outMaxX, minY: outMinY, maxY: outMaxY };
}

function projectPlaceToRectPx(
  place: Place,
  camera: any,
  tableVp: { left: number; top: number; width: number; height: number },
): RectPx | null {
  const hx = place.size.x * 0.5;
  const hy = place.size.y * 0.5;
  const hz = place.size.z * 0.5;
  const aabbMinX = place.position.x - hx;
  const aabbMaxX = place.position.x + hx;
  const aabbMinY = place.position.y - hy;
  const aabbMaxY = place.position.y + hy;
  const aabbMinZ = place.position.z - hz;
  const aabbMaxZ = place.position.z + hz;

  const ndc = projectAabbToNdc(aabbMinX, aabbMinY, aabbMinZ, aabbMaxX, aabbMaxY, aabbMaxZ, camera);
  if (!ndc) return null;

  let left = tableVp.left + ((ndc.minX + 1) * 0.5) * tableVp.width;
  let right = tableVp.left + ((ndc.maxX + 1) * 0.5) * tableVp.width;
  let top = tableVp.top + ((1 - ndc.maxY) * 0.5) * tableVp.height;
  let bottom = tableVp.top + ((1 - ndc.minY) * 0.5) * tableVp.height;

  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
    return null;
  }
  if (left > right) [left, right] = [right, left];
  if (top > bottom) [top, bottom] = [bottom, top];
  return { left, top, right, bottom };
}

function projectPointToPx(
  p: Vector3,
  camera: any,
  tableVp: { left: number; top: number; width: number; height: number },
): { x: number; y: number } | null {
  const ndc = p.clone().project(camera);
  if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) return null;
  const x = tableVp.left + ((ndc.x + 1) * 0.5) * tableVp.width;
  const y = tableVp.top + ((1 - ndc.y) * 0.5) * tableVp.height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export class BloodUi {
  private client: Client;
  private world: World;
  private mainView: MainView;
  private root: HTMLElement;
  private mainEl: HTMLElement | null = null;
  private dismissedKey: string | null = null;
  private dingqueEl: HTMLDivElement | null = null;
  private panelEl: HTMLDivElement | null = null;
  private kongPickKey: string | null = null;
  private lockedClaim: { pendingId: number; action: LockedClaimAction } | null = null;
  private swapLock: boolean = false;
  private lastPhase: BloodState['phase'] | null = null;
  private swapTitleEl: HTMLDivElement | null = null;
  private swapHintEl: HTMLDivElement | null = null;
  private swapConfirmBtn: HTMLButtonElement | null = null;
  private swapTimeoutMs: number | null = null;
  private interactiveEnabled: boolean;
  private replayReadonlyEnabled: boolean;

  constructor(client: Client, world: World, mainView: MainView, root: HTMLElement, options?: { interactive?: boolean; replayReadonly?: boolean }) {
    this.client = client;
    this.world = world;
    this.mainView = mainView;
    this.root = root;
    this.mainEl = document.getElementById('main');
    this.interactiveEnabled = options?.interactive !== false;
    this.replayReadonlyEnabled = options?.replayReadonly === true;

    this.client.blood.on('update', this.render.bind(this));
    this.client.seats.on('update', this.render.bind(this));
    this.client.match.on('update', this.render.bind(this));
    // 定缺按钮会依赖 client.localDingqueSuit() 做“本地提交即锁定”。
    // 当 ACTION_ACK(ok=false) 且服务端不更新 blood 时，需要靠 ACK 触发一次重渲染来解锁重试。
    this.client.on('actionAck', () => {
      const state = this.client.blood.get(0) as BloodState | null;
      if (state?.phase === 'dingque') this.render();
    });
    // Server-authoritative mode reveals hand tile faces via tileFaceSelf updates.
    // Re-render so "胡/杠" prompts reflect newly revealed tiles (e.g. drawing the 4th tile for an-gang).
    this.client.tileFaceSelf.on('update', this.render.bind(this));
    this.render();
  }

  private rectToStagePx(rect: DOMRect): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
    const main = this.mainEl;
    if (!main) {
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    }
    const stageRect = main.getBoundingClientRect();
    const scaleX = stageRect.width / Math.max(1, main.clientWidth);
    const scaleY = stageRect.height / Math.max(1, main.clientHeight);
    const invScaleX = Number.isFinite(scaleX) && scaleX > 1e-6 ? 1 / scaleX : 1;
    const invScaleY = Number.isFinite(scaleY) && scaleY > 1e-6 ? 1 / scaleY : 1;
    const left = (rect.left - stageRect.left) * invScaleX;
    const top = (rect.top - stageRect.top) * invScaleY;
    const width = rect.width * invScaleX;
    const height = rect.height * invScaleY;
    return { left, top, right: left + width, bottom: top + height, width, height };
  }

  private send(action: BloodAction): void {
    this.client.sendBloodAction(action);
  }

  private clearSwapSelection(): void {
    this.world.onSelect([]);
  }

  private applySwapSelection(ids: Array<number> | null | undefined): void {
    this.world.onSelect(Array.isArray(ids) ? ids : []);
  }

  private hide(): void {
    this.root.style.display = 'none';
    this.root.innerHTML = '';
    this.dingqueEl = null;
    this.panelEl = null;
    this.kongPickKey = null;
    this.lockedClaim = null;
    this.swapLock = false;
    this.lastPhase = null;
    this.swapTitleEl = null;
    this.swapHintEl = null;
    this.swapConfirmBtn = null;
    this.swapTimeoutMs = null;
    this.world.clearBloodKongPick();
  }

  private swapDirLabel(dir: BloodSwap3Direction): string {
    if (dir === 'cw') return '顺时针';
    if (dir === 'ccw') return '逆时针';
    return '对家';
  }

  private formatMs(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  private computeSwapPick(seat: number): { ids: Array<number>; ok: boolean; reason: string } {
    const idsRaw = this.world.getSelectedThingIds();
    const ids = idsRaw.filter((id) => {
      const t = this.world.things.get(id) ?? null;
      return !!(t && t.type === ThingType.TILE && t.slot.group === 'hand' && t.slot.seat === seat);
    });
    if (ids.length !== 3) {
      return { ids, ok: false, reason: '请选择 3 张同花色手牌' };
    }
    let suit: BloodSuit | null = null;
    const keyed: Array<{ id: number; tileKey: number }> = [];
    for (const id of ids) {
      const t = this.world.things.get(id) ?? null;
      const k = t ? tileKeyFromTypeIndex(t.typeIndex) : null;
      if (k === null) {
        return { ids, ok: false, reason: '请选择数牌（万/筒/条）' };
      }
      keyed.push({ id, tileKey: k });
      const s = suitOf(k);
      if (suit === null) suit = s;
      else if (s !== suit) {
        return { ids, ok: false, reason: '必须选择同一花色的 3 张牌' };
      }
    }
    // 确认发送：按牌面排序后顺序提交（同花色时即按点数升序；重复牌按 tileId 稳定排序）。
    keyed.sort((a, b) => a.tileKey - b.tileKey || a.id - b.id);
    return { ids: keyed.map((x) => x.id), ok: true, reason: '' };
  }

  private showSwapPanel(
    dir: BloodSwap3Direction,
    since: number,
    timeoutMs: number | null,
    options?: { readonly?: boolean; hint?: string; confirmDisabled?: boolean },
  ): void {
    this.root.style.display = 'block';
    this.root.innerHTML = '';
    this.dingqueEl = null;
    this.panelEl = null;
    this.kongPickKey = null;
    this.lockedClaim = null;
    this.swapTitleEl = null;
    this.swapHintEl = null;
    this.swapConfirmBtn = null;
    this.swapTimeoutMs = timeoutMs;

    const panel = document.createElement('div');
    panel.className = 'blood-panel';
    if (options?.readonly) panel.classList.add('readonly');

    const title = document.createElement('div');
    title.className = 'blood-title';
    panel.appendChild(title);
    this.swapTitleEl = title;

    const hint = document.createElement('div');
    hint.className = 'blood-title';
    hint.style.fontWeight = '700';
    hint.style.fontSize = 'calc(var(--action-btn, 56px) * 0.22)';
    hint.style.opacity = '0.95';
    hint.textContent = options?.hint ?? '请选择 3 张同花色手牌';
    panel.appendChild(hint);
    this.swapHintEl = hint;

    const row = document.createElement('div');
    row.className = 'blood-row';

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'blood-btn action-gang action-confirm';
    // “确定”是双字：保持 0.60 的“大字体感”，用横向压缩让回退态不出圈。
    const confirmText = document.createElement('span');
    confirmText.textContent = '确定';
    confirmText.style.display = 'inline-block';
    confirmText.style.transformOrigin = 'center';
    confirmText.style.transform = 'scaleX(0.82)';
    confirmText.style.letterSpacing = '-0.08em';
    confirm.appendChild(confirmText);
    confirm.style.fontSize = 'calc(var(--action-btn, 56px) * 0.60)';
    if (!options?.readonly) {
      confirm.onclick = () => {
        const seat = this.client.seat;
        const state = this.client.blood.get(0) as BloodState | null;
        if (seat === null || !state || state.phase !== 'swap3') return;
        const pick = this.computeSwapPick(seat);
        if (!pick.ok) return;
        this.swapLock = true;
        this.clearSwapSelection();
        this.send({ kind: 'swap3', tileIds: pick.ids });
        this.showPanel('已确定，等待其他玩家…', []);
      };
    }
    if (options?.confirmDisabled) {
      confirm.disabled = true;
    }
    row.appendChild(confirm);
    this.swapConfirmBtn = confirm;

    panel.appendChild(row);
    this.root.appendChild(panel);
    this.panelEl = panel;

    // 记录起始时间用于 update() 更新倒计时（通过 closure 捕获 since/dir）。
    const updateTitle = () => {
      if (timeoutMs === null) {
        title.textContent = `换三张 · ${this.swapDirLabel(dir)} · 不限时`;
        return;
      }
      const remain = Math.max(0, timeoutMs - (Date.now() - since));
      title.textContent = `换三张 · ${this.swapDirLabel(dir)} · ${this.formatMs(remain)}`;
    };
    updateTitle();

    this.update();
  }

  private showPanel(
    title: string,
    buttons: Array<PanelButton>,
  ): void {
    this.root.style.display = 'block';
    this.root.innerHTML = '';
    this.dingqueEl = null;
    this.panelEl = null;

    const panel = document.createElement('div');
    panel.className = 'blood-panel';

    if (title.trim().length > 0) {
      const t = document.createElement('div');
      t.className = 'blood-title';
      t.textContent = title;
      panel.appendChild(t);
    }

    if (buttons.length > 0) {
      const row = document.createElement('div');
      row.className = 'blood-row';
      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `blood-btn${b.cls ? ` ${b.cls}` : ''}`;
        btn.textContent = b.text;
        const hidden = Boolean(b.hidden);
        const disabled = Boolean(b.disabled) || hidden;
        btn.disabled = disabled;
        if (hidden) {
          btn.style.visibility = 'hidden';
          btn.style.pointerEvents = 'none';
          btn.tabIndex = -1;
        }
        if (!disabled && b.onClick) {
          btn.onclick = b.onClick;
        }
        row.appendChild(btn);
      }
      panel.appendChild(row);
    }
    this.root.appendChild(panel);
    this.panelEl = panel;

    // Position immediately to avoid a 1-frame "center" flash.
    this.update();
  }

  private showDingquePanel(buttons: Array<DingqueButton>, options?: { readonly?: boolean; hint?: string }): void {
    this.root.style.display = 'block';
    this.root.innerHTML = '';
    this.panelEl = null;

    const wrap = document.createElement('div');
    wrap.className = 'blood-dingque';
    if (options?.readonly) wrap.classList.add('readonly');

    const row = document.createElement('div');
    row.className = 'blood-dingque-row';

    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `blood-dingque-btn suit-${b.suit}`;
      if (b.selected) btn.classList.add('readonly-selected');
      if (b.muted) btn.classList.add('readonly-muted');
      btn.textContent = b.text;
      if (!options?.readonly && b.onClick) {
        btn.onclick = b.onClick;
      }
      btn.disabled = !!b.disabled;
      row.appendChild(btn);
    }

    const hint = document.createElement('div');
    hint.className = 'blood-dingque-hint';
    hint.textContent = options?.hint ?? '缺一门才能胡';

    wrap.appendChild(row);
    wrap.appendChild(hint);
    this.root.appendChild(wrap);
    this.dingqueEl = wrap;

    // Ensure we position it at least once immediately.
    this.update();
  }

	  private computeDingqueAnchor(): { x: number; y: number; tilePx: number } | null {
    const seat = this.client.seat;
    if (seat === null) return null;

    const tableVp = this.mainView.getTableViewport();
    const camera: any = this.mainView.camera;

    // Discard is 6x3; we want the middle row (rowIndex=1), columns 0..5.
    let union: RectPx | null = null;
    let sample: RectPx | null = null;

    for (let col = 0; col < 6; col++) {
      const slot = this.world.slots.get(`discard.1.${col}@${seat}`) ?? null;
      const place = slot?.places?.[0] ?? null;
      if (!place) continue;
      const rect = projectPlaceToRectPx(place, camera, tableVp);
      if (!rect) continue;
      sample = sample ?? rect;
      union = union
        ? {
            left: Math.min(union.left, rect.left),
            top: Math.min(union.top, rect.top),
            right: Math.max(union.right, rect.right),
            bottom: Math.max(union.bottom, rect.bottom),
          }
        : rect;
    }

    if (!union || !sample) return null;

    const tilePx = Math.max(1, Math.min(sample.right - sample.left, sample.bottom - sample.top));
    return {
      x: (union.left + union.right) * 0.5,
      y: (union.top + union.bottom) * 0.5,
      tilePx,
    };
		  }

  private estimateDiscardTilePx(seat: number): number | null {
    const tableVp = this.mainView.getTableViewport();
    const camera: any = this.mainView.camera;
    const slot = this.world.slots.get(`discard.1.0@${seat}`) ?? null;
    const place = slot?.places?.[0] ?? null;
    if (!place) return null;
    const rect = projectPlaceToRectPx(place, camera, tableVp);
    if (!rect) return null;
    return Math.max(1, Math.min(rect.right - rect.left, rect.bottom - rect.top));
  }

  private computeBottomRightActionRectPx(): { left: number; top: number; right: number; bottom: number } | null {
    const viewerSeat = this.client.seat;
    if (viewerSeat === null) return null;

    const tableVp = this.mainView.getTableViewport();
    const camera: any = this.mainView.camera;

    const bottomSeat = viewerSeat;
    const rightSeat = (viewerSeat + 1) % 4;

    const isXSeat = (seat: number): boolean => seat === 1 || seat === 3;
    const seatX = isXSeat(bottomSeat) ? bottomSeat : rightSeat;
    const seatY = isXSeat(bottomSeat) ? rightSeat : bottomSeat;

    const discardSlotsX = [...this.world.slots.values()].filter(
      (s) => s.seat === seatX && s.group === 'discard' && !s.name.startsWith('discard.stack'),
    );
    const discardSlotsY = [...this.world.slots.values()].filter(
      (s) => s.seat === seatY && s.group === 'discard' && !s.name.startsWith('discard.stack'),
    );

    const discardEdgeX = computeDiscardEdge(discardSlotsX, seatX);
    const handEdgeX = computeHandMeldEdge(this.world.slots, seatX);
    const discardEdgeY = computeDiscardEdge(discardSlotsY, seatY);
    const handEdgeY = computeHandMeldEdge(this.world.slots, seatY);
    if (discardEdgeX === null || handEdgeX === null || discardEdgeY === null || handEdgeY === null) return null;

    const x0 = Math.min(discardEdgeX, handEdgeX);
    const x1 = Math.max(discardEdgeX, handEdgeX);
    const y0 = Math.min(discardEdgeY, handEdgeY);
    const y1 = Math.max(discardEdgeY, handEdgeY);
    if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(y0) || !Number.isFinite(y1)) {
      return null;
    }
    if (Math.abs(x1 - x0) < 1e-6 || Math.abs(y1 - y0) < 1e-6) return null;

    const zWorld = Math.max(
      this.world.slots.get(`discard.1.0@${seatX}`)?.places?.[0]?.position?.z ?? 0,
      this.world.slots.get(`discard.1.0@${seatY}`)?.places?.[0]?.position?.z ?? 0,
    );

    const points = [
      new Vector3(x0, y0, zWorld),
      new Vector3(x1, y0, zWorld),
      new Vector3(x0, y1, zWorld),
      new Vector3(x1, y1, zWorld),
    ].map((p) => projectPointToPx(p, camera, tableVp));

    if (points.some((p) => p === null)) return null;
    const pts = points as Array<{ x: number; y: number }>;
    let left = Math.min(...pts.map((p) => p.x));
    let right = Math.max(...pts.map((p) => p.x));
    let top = Math.min(...pts.map((p) => p.y));
    let bottom = Math.max(...pts.map((p) => p.y));

    const vpLeft = tableVp.left;
    const vpRight = tableVp.left + tableVp.width;
    const vpTop = tableVp.top;
    const vpBottom = tableVp.top + tableVp.height;
    left = clamp(left, vpLeft, vpRight);
    right = clamp(right, vpLeft, vpRight);
    top = clamp(top, vpTop, vpBottom);
    bottom = clamp(bottom, vpTop, vpBottom);
    if (right - left < 4 || bottom - top < 4) return null;

    return { left, top, right, bottom };
  }

  update(): void {
    if (!this.interactiveEnabled && !this.replayReadonlyEnabled) {
      this.hide();
      return;
    }
    if (!this.dingqueEl && !this.panelEl) return;

    // 多组暗杠“选牌模式”：点到牌后会立即清掉 world 里的 pick，
    // 这里不等 seat0 回显，先把面板隐藏，避免用户看到“请选择要杠的牌”残留一段时间。
    if (this.kongPickKey !== null && !this.world.hasBloodKongPick()) {
      this.kongPickKey = null;
      this.hide();
      return;
    }

    const anchor = this.dingqueEl ? this.computeDingqueAnchor() : null;
    if (this.dingqueEl && anchor) {
      const tableVp = this.mainView.getTableViewport();
      const vpLeft = tableVp.left;
      const vpRight = tableVp.left + tableVp.width;
      const vpTop = tableVp.top;
      const vpBottom = tableVp.top + tableVp.height;

      // “刚好包住文字”的圆：移动端适度放大，提升可点性；仍会在 tableViewport 内自动 clamp。
      const btnPx = Math.round(clamp(anchor.tilePx * 1.625, 52, 80));
      this.dingqueEl.style.setProperty('--dingque-btn', `${btnPx}px`);

      // We want the button row to sit on the discard middle row center (anchor.y),
      // not the whole container (because hint text is below).
      this.dingqueEl.style.left = `${anchor.x}px`;
      this.dingqueEl.style.top = `${anchor.y}px`;
      this.dingqueEl.style.transform = 'translate(-50%, -50%)';

      const row = this.dingqueEl.querySelector('.blood-dingque-row') as HTMLDivElement | null;
      if (row) {
        const rowRect = this.rectToStagePx(row.getBoundingClientRect());
        const rowCenterY = rowRect.top + rowRect.height * 0.5;
        const dyAlign = anchor.y - rowCenterY;

        this.dingqueEl.style.transform = `translate(-50%, -50%) translate(0px, ${dyAlign}px)`;

        // Clamp inside tableViewport (if the viewport is very small).
        const wrapRect = this.rectToStagePx(this.dingqueEl.getBoundingClientRect());
        let dxClamp = 0;
        let dyClamp = 0;
        if (wrapRect.left < vpLeft) dxClamp = vpLeft - wrapRect.left;
        if (wrapRect.right > vpRight) dxClamp = vpRight - wrapRect.right;
        if (wrapRect.top < vpTop) dyClamp = vpTop - wrapRect.top;
        if (wrapRect.bottom > vpBottom) dyClamp = vpBottom - wrapRect.bottom;

        if (dxClamp !== 0 || dyClamp !== 0) {
          this.dingqueEl.style.transform =
            `translate(-50%, -50%) translate(0px, ${dyAlign}px) translate(${dxClamp}px, ${dyClamp}px)`;
        }
      }
    }

	    if (this.panelEl) {
	      const targetRect = this.computeBottomRightActionRectPx();
	      if (!targetRect) return;
	      const center = { x: (targetRect.left + targetRect.right) * 0.5, y: (targetRect.top + targetRect.bottom) * 0.5 };

	      const viewerSeat = this.client.seat;
	      const tilePx = viewerSeat !== null ? this.estimateDiscardTilePx(viewerSeat) : null;
	      const actionBtnPx = Math.round(clamp((tilePx ?? 50) * 1.25, 44, 60));
	      if (this.panelEl) {
	        this.panelEl.style.setProperty('--action-btn', `${actionBtnPx}px`);
	      }

	      if (this.panelEl) {
	        this.panelEl.style.left = `${center.x}px`;
	        this.panelEl.style.top = `${center.y}px`;
	        this.panelEl.style.transform = 'translate(-50%, -50%)';

	        const tableVp = this.mainView.getTableViewport();
	        const vpLeft = tableVp.left;
	        const vpRight = tableVp.left + tableVp.width;
	        const vpTop = tableVp.top;
		        const vpBottom = tableVp.top + tableVp.height;

		        // Ensure the panel stays inside the "hand side" boundaries (right/bottom),
		        // but allow it to overflow into discards (left/top) if needed.
		        const rect = this.rectToStagePx(this.panelEl.getBoundingClientRect());
		        const clampLeft = vpLeft;
		        const clampTop = vpTop;
		        const clampRight = Math.min(vpRight, targetRect.right);
		        const clampBottom = Math.min(vpBottom, targetRect.bottom);
	        let dxClamp = 0;
	        let dyClamp = 0;
	        if (rect.left < clampLeft) dxClamp = clampLeft - rect.left;
	        if (rect.right > clampRight) dxClamp = clampRight - rect.right;
	        if (rect.top < clampTop) dyClamp = clampTop - rect.top;
	        if (rect.bottom > clampBottom) dyClamp = clampBottom - rect.bottom;
	        if (dxClamp !== 0 || dyClamp !== 0) {
	          this.panelEl.style.transform = `translate(-50%, -50%) translate(${dxClamp}px, ${dyClamp}px)`;
	        }
	      }
	    }

    // swap3：更新倒计时与“确定”可用状态（不要触发 rerender，避免打断选牌）。
    const state = this.client.blood.get(0) as BloodState | null;
    const seat = this.client.seat;
    if (this.interactiveEnabled && state && seat !== null && state.phase === 'swap3' && this.swapTitleEl && this.swapConfirmBtn && state.swap3) {
      const dir = state.swap3.dir;
      const timeoutMs = this.swapTimeoutMs;
      if (timeoutMs === null) {
        this.swapTitleEl.textContent = `换三张 · ${this.swapDirLabel(dir)} · 不限时`;
      } else {
        const remain = Math.max(0, timeoutMs - (Date.now() - state.swap3.since));
        this.swapTitleEl.textContent = `换三张 · ${this.swapDirLabel(dir)} · ${this.formatMs(remain)}`;
      }

      const already = (state.swap3.selections?.[seat] ?? null) !== null;
      const locked = already || this.swapLock || state.swap3.animatingSince !== null;
      if (locked) {
        this.swapConfirmBtn.disabled = true;
        if (this.swapHintEl) this.swapHintEl.textContent = state.swap3.animatingSince !== null ? '换牌中…' : '已确定，等待其他玩家…';
      } else {
        const pick = this.computeSwapPick(seat);
        this.swapConfirmBtn.disabled = !pick.ok;
        if (this.swapHintEl) this.swapHintEl.textContent = pick.ok ? '请选择 3 张同花色手牌' : pick.reason;
      }
    }
  }

  private render(): void {
    if (!this.interactiveEnabled && !this.replayReadonlyEnabled) {
      this.hide();
      return;
    }
    const match = this.client.match.get(0);
    if (!match) {
      this.hide();
      return;
    }
    if (match.conditions.gameType !== GameType.BLOOD_BATTLE) {
      return;
    }

    const seat = this.client.seat;
    const state = this.client.blood.get(0) as BloodState | null;
    if (seat === null || !state) {
      this.hide();
      return;
    }

    const me = state.players[seat];
    if (!me) {
      this.hide();
      return;
    }

    if (this.replayReadonlyEnabled) {
      this.renderReplayReadonly(state, seat, me);
      return;
    }

    const prevPhase = this.lastPhase;
    // 进入 swap3：清理可能遗留的选中高亮/锁。
    if (prevPhase !== 'swap3' && state.phase === 'swap3') {
      this.swapLock = false;
      this.world.onSelect([]);
    }
    // 从 swap3 切走：清理本地锁与选中高亮。
    if (prevPhase === 'swap3' && state.phase !== 'swap3') {
      this.swapLock = false;
      this.world.onSelect([]);
    }
    this.lastPhase = state.phase;

    // AI 托管：屏蔽本家手动操作（换三张/定缺/碰杠胡/自摸胡/杠等），由 AI 自动发送 ACTION。
    if (this.world.isAiHosted()) {
      this.swapLock = false;
      this.lockedClaim = null;
      this.kongPickKey = null;
      this.world.clearBloodKongPick();
      this.world.onSelect([]);

      if (state.phase === 'swap3') {
        const swap3 = state.swap3 ?? null;
        const already = swap3 ? (swap3.selections?.[seat] ?? null) !== null : false;
        if (swap3 && swap3.animatingSince === null && !already) {
          this.showPanel('托管中：AI 换三张…', []);
          return;
        }
      }
      if (state.phase === 'dingque' && !isDingqueCommitted(me)) {
        this.showPanel('托管中：AI 定缺…', []);
        return;
      }
      if (state.phase === 'playing' && state.pending?.kind === 'claim') {
        const pending = state.pending;
        const opt = pending.options[seat] ?? { hu: false, peng: false, gang: false };
        const any = opt.hu || opt.peng || opt.gang;
        const already = pending.responses[seat] !== null;
        if (any && !already) {
          this.showPanel('托管中：AI 响应中…', []);
          return;
        }
      }
      if (
        state.phase === 'playing' &&
        state.pending === null &&
        state.turnSeat === seat &&
        state.turnStep === 'discard' &&
        me.dingque !== null
      ) {
        this.showPanel('托管中：AI 出牌中…', []);
        return;
      }

      this.hide();
      return;
    }

	    if (state.phase === 'swap3') {
	      const swap3 = state.swap3 ?? null;
	      if (!swap3) {
	        this.showPanel('换三张准备中…', []);
	        return;
      }

      // 换牌动画阶段：只提示“换牌中”，不允许操作。
      if (swap3.animatingSince !== null) {
        this.swapLock = false;
        this.world.onSelect([]);
        this.showPanel('换牌中…', []);
        return;
      }

      const already = (swap3.selections?.[seat] ?? null) !== null;
      if (already) {
        this.swapLock = false;
        this.world.onSelect([]);
        this.showPanel('已确定，等待其他玩家…', []);
        return;
      }
	      if (this.swapLock) {
	        this.showPanel('已确定，等待其他玩家…', []);
	        return;
	      }

        const match: any = this.client.match.get(0);
        const cfg: any = String(match?.roomType ?? '') === 'friend'
          ? (match?.friendConfig ?? match?.bloodConfig ?? null)
          : (match?.bloodConfig ?? null);
        const mode = typeof cfg?.waitMode === 'string' ? String(cfg.waitMode) : '';
        const timeoutMs =
          mode === 'timeoutAuto'
            ? Math.max(1000, Math.trunc(Number.isFinite(cfg?.timeoutMs) ? cfg.timeoutMs : DEFAULT_DECISION_TIMEOUT_MS))
            : null;
	      this.showSwapPanel(swap3.dir, swap3.since, timeoutMs);
	      return;
	    }

    if (state.phase === 'dingque') {
      const localSuit = this.client.localDingqueSuit();
      const serverCommitted = isDingqueCommitted(me);
      const committedSuit = (me.dingque ?? localSuit) ?? null;

      // 未提交：展示可点选的 3 个按钮。
      if (!serverCommitted && localSuit === null) {
        const mk = (text: string, suit: BloodSuit): { text: string; suit: BloodSuit; onClick: () => void } => ({
          text,
          suit,
          onClick: () => {
            this.send({ kind: 'dingque', suit });
            // 立即按本地提交态刷新 UI，避免弱网下“角标已变但按钮仍可点”的错觉。
            this.render();
          },
        });
        // 定缺选择：无底板，3 个圆形按钮，位置在本家弃牌区 6x3 的中排。
        this.showDingquePanel([mk('万', 'm'), mk('筒', 'p'), mk('条', 's')]);
        return;
      }

      // 已提交（本地或服务端已确认）：锁定 UI，避免用户连点/误以为未成功。
      const suitToText = (suit: BloodSuit): string => (suit === 'm' ? '万' : suit === 'p' ? '筒' : '条');
      const hint = '已提交，等待其他玩家…';
      if (committedSuit) {
        this.showDingquePanel([{ text: suitToText(committedSuit), suit: committedSuit, selected: true }], { readonly: true, hint });
      } else {
        // 极端情况：服务端标记已提交但本地未能拿到花色（例如跨设备重连）。
        this.showDingquePanel(
          [
            { text: '万', suit: 'm', muted: true },
            { text: '筒', suit: 'p', muted: true },
            { text: '条', suit: 's', muted: true },
          ],
          { readonly: true, hint: '已提交，等待其他玩家…' },
        );
      }
      return;
    }

	    if (state.phase === 'playing' && state.pending?.kind === 'claim') {
	      const pending = state.pending;
	      if (this.lockedClaim && this.lockedClaim.pendingId !== pending.id) {
	        this.lockedClaim = null;
	      }
	      const opt = pending.options[seat] ?? { hu: false, peng: false, gang: false };
	      const response = pending.responses[seat];
	      if (response === 'pass') {
	        this.lockedClaim = null;
	      }
	      const locked: LockedClaimAction | null =
	        response === 'hu' || response === 'peng' || response === 'gang'
	          ? response
	          : (this.lockedClaim && this.lockedClaim.pendingId === pending.id ? this.lockedClaim.action : null);
	      const already = response !== null;
	      const any = opt.hu || opt.peng || opt.gang;

	      const showLocked = (action: LockedClaimAction): void => {
	        this.lockedClaim = { pendingId: pending.id, action };
	        this.kongPickKey = null;
	        this.world.clearBloodKongPick();

	        const buttons: Array<PanelButton> = [];
	        if (opt.hu) buttons.push({ text: '胡', cls: 'action-hu', disabled: action === 'hu', hidden: action !== 'hu' });
	        if (opt.gang) buttons.push({ text: '杠', cls: 'action-gang action-gang-act', disabled: action === 'gang', hidden: action !== 'gang' });
	        if (opt.peng) buttons.push({ text: '碰', cls: 'action-peng action-peng-act', disabled: action === 'peng', hidden: action !== 'peng' });
	        // “过”消失，但保留占位，避免所选按钮位置发生位移。
	        buttons.push({ text: '过', cls: 'secondary action-pass', hidden: true });

	        this.showPanel('', buttons);
	      };

	      // 已选择（碰/杠/胡）后：锁定并等待裁决，只显示已点的按钮（置灰），不允许改选/过。
	      if (any && locked !== null) {
	        showLocked(locked);
	        return;
	      }

	      if (any && !already) {
	        this.kongPickKey = null;
	        this.world.clearBloodKongPick();
	        const buttons: Array<PanelButton> = [];
	        if (opt.hu) {
	          buttons.push({
	            text: '胡',
	            cls: 'action-hu',
	            onClick: () => {
	              showLocked('hu');
	              this.send({ kind: 'claim', pendingId: pending.id, action: 'hu' });
	            },
	          });
	        }
	        if (opt.gang) {
	          buttons.push({
	            text: '杠',
	            cls: 'action-gang action-gang-act',
	            onClick: () => {
	              showLocked('gang');
	              this.send({ kind: 'claim', pendingId: pending.id, action: 'gang' });
	            },
	          });
	        }
	        if (opt.peng) {
	          buttons.push({
	            text: '碰',
	            cls: 'action-peng action-peng-act',
	            onClick: () => {
	              showLocked('peng');
	              this.send({ kind: 'claim', pendingId: pending.id, action: 'peng' });
	            },
	          });
	        }
	        buttons.push({
	          text: '过',
	          cls: 'secondary action-pass',
	          onClick: () => this.send({ kind: 'claim', pendingId: pending.id, action: 'pass' }),
	        });
	        this.showPanel('', buttons);
	        return;
	      }
	    }

    // 轮到自己时的“暗杠/加杠”提示（非常驻；点“过”即可隐藏并继续弃牌）
	    if (state.phase === 'playing' &&
	        state.pending === null &&
	        state.turnSeat === seat &&
	        state.turnStep === 'discard' &&
	        me.dingque !== null) {
	      const wallIndex = Number.isFinite(state.wallIndex) ? Math.trunc(state.wallIndex) : 0;
	      const wallLen = Array.isArray(state.wallOrder) ? state.wallOrder.length : 0;
	      const wallRemaining = Math.max(0, wallLen - wallIndex);
	      const allowKong = wallRemaining > 0;
	      const kongKey = `${seat}:${state.wallIndex}:${state.turnStep}`;
	      if (this.dismissedKey !== kongKey) {
	        type KongOpt = { tileKey: number; gangType: 'an' | 'add' };
	        const counts: Map<number, number> = new Map();
	        const countsArr = new Array(27).fill(0);
	        let hasExtra = false;
	        for (const t of this.world.things.values()) {
	          if (t.slot.group !== 'hand' || t.slot.seat !== seat) continue;
	          if (t.slot.name === `hand.extra@${seat}`) hasExtra = true;
          const k = tileKeyFromTypeIndex(t.typeIndex);
          if (k === null) continue;
          counts.set(k, (counts.get(k) ?? 0) + 1);
          countsArr[k] += 1;
        }

        const myMelds = me.melds ?? [];
	        const hasPeng = (tileKey: number): boolean =>
	          myMelds.some((m) => m.kind === 'peng' && m.tileKey === tileKey);

	        const kongOptions: Array<KongOpt> = [];

	        // 自摸胡提示（MVP：只做基础胡牌判定）
	        let hasDingque = false;
	        for (let i = 0; i < 27; i++) {
          if (countsArr[i] > 0 && suitOf(i) === me.dingque) {
            hasDingque = true;
	            break;
	          }
	        }
	        // 自摸胡必须是“摸牌位(hand.extra)”存在（碰/吃后进入弃牌阶段不应出现自摸胡）。
	        const canSelfHu = hasExtra && !hasDingque && canHuCounts(countsArr, myMelds.length);

	        // 暗杠/加杠必须发生在“摸牌后”的本回合；碰后进入弃牌回合（无 extra）时不允许宣杠。
	        if (hasExtra) {
	          for (const [k, n] of counts.entries()) {
	            if (suitOf(k) === me.dingque) continue;
	            if (!allowKong) continue;
	            if (n >= 4) {
	              kongOptions.push({ tileKey: k, gangType: 'an' });
	            } else if (n >= 1 && hasPeng(k)) {
	              kongOptions.push({ tileKey: k, gangType: 'add' });
	            }
	          }
	        }

	        // If we're currently picking a kong, keep showing the "pass" button.
	        if (this.kongPickKey === kongKey && this.world.hasBloodKongPick()) {
	          if (!allowKong) {
	            // 墙剩 0 时不允许杠：清掉选择态，避免提示出一个不可执行的动作。
	            this.kongPickKey = null;
	            this.world.clearBloodKongPick();
	            this.hide();
	            return;
	          }
	          this.showPanel('请选择要杠的牌', [
	            {
	              text: '过',
	              cls: 'secondary action-pass',
	              onClick: () => {
	                this.dismissedKey = kongKey;
	                this.kongPickKey = null;
	                this.world.clearBloodKongPick();
	                this.hide();
	              },
	            },
	          ]);
	          return;
	        }

	        // Not in pick mode: clear any stale pick state.
	        this.kongPickKey = null;
	        this.world.clearBloodKongPick();

	        if (canSelfHu || kongOptions.length > 0) {
	          const buttons: Array<{ text: string; cls?: string; onClick: () => void }> = [];
	          if (canSelfHu) {
	            buttons.push({ text: '胡', cls: 'action-hu', onClick: () => this.send({ kind: 'hu', source: 'self' }) });
	          }
	          if (kongOptions.length > 0) {
	            buttons.push({
	              text: '杠',
	              cls: 'action-gang action-gang-act',
	              onClick: () => {
	                if (kongOptions.length === 1) {
	                  const only = kongOptions[0];
	                  this.send({ kind: 'kong', gangType: only.gangType, tileKey: only.tileKey });
	                  this.hide();
	                  return;
	                }
	                this.kongPickKey = kongKey;
	                this.world.setBloodKongPick(seat, kongOptions);
	                this.showPanel('请选择要杠的牌', [
	                  {
	                    text: '过',
	                    cls: 'secondary action-pass',
	                    onClick: () => {
	                      this.dismissedKey = kongKey;
	                      this.kongPickKey = null;
	                      this.world.clearBloodKongPick();
	                      this.hide();
	                    },
	                  },
	                ]);
	              },
	            });
	          }
	          buttons.push({
	            text: '过',
	            cls: 'secondary action-pass',
	            onClick: () => {
	              this.dismissedKey = kongKey;
	              this.kongPickKey = null;
	              this.world.clearBloodKongPick();
	              this.hide();
	            },
	          });
	          this.showPanel('', buttons);
	          return;
	        }
	    }
	  }

	    this.hide();
	  }

  private renderReplayReadonly(state: BloodState, seat: number, me: BloodState['players'][number]): void {
    const prevPhase = this.lastPhase;
    if (prevPhase !== state.phase && prevPhase === 'swap3') {
      this.clearSwapSelection();
    }
    this.lastPhase = state.phase;
    this.swapLock = false;
    this.lockedClaim = null;
    this.kongPickKey = null;
    this.dismissedKey = null;
    this.world.clearBloodKongPick();

    if (state.phase === 'swap3') {
      const swap3 = state.swap3 ?? null;
      if (!swap3) {
        this.clearSwapSelection();
        this.showPanel('换三张准备中…', []);
        return;
      }
      const picked = swap3.selections?.[seat] ?? null;
      const pickedIds = Array.isArray(picked) ? picked : [];
      const match: any = this.client.match.get(0);
      const cfg: any = String(match?.roomType ?? '') === 'friend'
        ? (match?.friendConfig ?? match?.bloodConfig ?? null)
        : (match?.bloodConfig ?? null);
      const mode = typeof cfg?.waitMode === 'string' ? String(cfg.waitMode) : '';
      const timeoutMs =
        mode === 'timeoutAuto'
          ? Math.max(1000, Math.trunc(Number.isFinite(cfg?.timeoutMs) ? cfg.timeoutMs : DEFAULT_DECISION_TIMEOUT_MS))
          : null;

      if (swap3.animatingSince !== null) {
        this.clearSwapSelection();
        this.showPanel('换牌中…', []);
        return;
      }

      this.applySwapSelection(pickedIds);
      this.showSwapPanel(swap3.dir, swap3.since, timeoutMs, {
        readonly: true,
        hint: pickedIds.length > 0 ? '已确定，等待其他玩家…' : '请选择 3 张同花色手牌',
        confirmDisabled: true,
      });
      return;
    }

    this.clearSwapSelection();
    if (state.phase === 'dingque') {
      const selectedSuit = me.dingque ?? null;
      const buttons: Array<DingqueButton> = [
        { text: '万', suit: 'm', selected: selectedSuit === 'm', muted: selectedSuit !== null && selectedSuit !== 'm' },
        { text: '筒', suit: 'p', selected: selectedSuit === 'p', muted: selectedSuit !== null && selectedSuit !== 'p' },
        { text: '条', suit: 's', selected: selectedSuit === 's', muted: selectedSuit !== null && selectedSuit !== 's' },
      ];
      this.showDingquePanel(buttons, { readonly: true, hint: selectedSuit ? '已定缺' : '缺一门才能胡' });
      return;
    }

    if (state.phase === 'playing' && state.pending?.kind === 'claim') {
      const pending = state.pending;
      if (seat !== pending.fromSeat && pending.responses?.[seat] === null) {
        const opt = pending.options?.[seat] ?? { hu: false, peng: false, gang: false };
        if (opt.hu || opt.peng || opt.gang) {
          const buttons: Array<PanelButton> = [];
          if (opt.hu) buttons.push({ text: '胡', cls: 'action-hu', disabled: true });
          if (opt.gang) buttons.push({ text: '杠', cls: 'action-gang action-gang-act', disabled: true });
          if (opt.peng) buttons.push({ text: '碰', cls: 'action-peng action-peng-act', disabled: true });
          buttons.push({ text: '过', cls: 'secondary action-pass', disabled: true });
          this.showPanel('', buttons);
          return;
        }
      }
    }

    this.hide();
  }
}
