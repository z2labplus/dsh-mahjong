import {
  BoxGeometry,
  Camera,
  Group,
  Mesh,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { HAND_TAP_RAISE_RATIO, World } from './world';
import { SelectionBox } from './selection-box';
import { tileKeyFromTypeIndex } from './blood-tiles';
import type { TenpaiPreview } from './blood-tenpai-preview';
import { GameType } from './types';
// @ts-ignore
import tilesPng from 'url:../img/tiles.auto.png';
// @ts-ignore
import tile1sSvg from 'url:../img/1s.svg';

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 10;
const DRAG_START_PX = 8;

const TILE_ATLAS_COLS = 8;
// `img/tiles.auto.png`: 512x512, 8 cols, each cell is 64x80 (exported from 256x256 svg grid).
const TILE_ATLAS_PX = 512;
const TILE_ATLAS_CELL_W = TILE_ATLAS_PX / TILE_ATLAS_COLS; // 64
const TILE_ATLAS_CELL_H = 80;
// `#blood-tenpai-preview .tenpai-tile` visual size (CSS px).
const TENPAI_TILE_W = 24;
const TENPAI_TILE_H = 30;

type RectPx = { left: number; top: number; right: number; bottom: number };

const PROJECT_CORNERS = Array.from({ length: 8 }, () => new Vector3());

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function applyTenpaiTileFace(tile: HTMLElement, tileKey: number): void {
  if (tileKey === 18) {
    // 1s (一条)：使用定制牌面，保持与对局中的贴图一致
    tile.style.backgroundImage = `url(${tile1sSvg})`;
    tile.style.backgroundSize = '100% 100%';
    tile.style.backgroundPosition = '0 0';
    return;
  }

  tile.style.backgroundImage = `url(${tilesPng})`;

  // Scale the 512x512 atlas so each cell becomes `TENPAI_TILE_W` x `TENPAI_TILE_H`.
  const scale = TENPAI_TILE_W / TILE_ATLAS_CELL_W; // e.g. 24/64 = 0.375
  tile.style.backgroundSize = `${TILE_ATLAS_PX * scale}px ${TILE_ATLAS_PX * scale}px`;

  const col = tileKey % TILE_ATLAS_COLS;
  const row = Math.floor(tileKey / TILE_ATLAS_COLS);
  tile.style.backgroundPosition = `${-(col * TILE_ATLAS_CELL_W * scale)}px ${-(row * TILE_ATLAS_CELL_H * scale)}px`;
}

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
  place: { position: Vector3; size: Vector3 },
  camera: any,
  vp: { left: number; top: number; width: number; height: number },
): RectPx | null {
  const hx = place.size.x * 0.5;
  const hy = place.size.y * 0.5;
  const hz = place.size.z * 0.5;
  const ndc = projectAabbToNdc(
    place.position.x - hx,
    place.position.y - hy,
    place.position.z - hz,
    place.position.x + hx,
    place.position.y + hy,
    place.position.z + hz,
    camera,
  );
  if (!ndc) return null;

  let left = vp.left + ((ndc.minX + 1) * 0.5) * vp.width;
  let right = vp.left + ((ndc.maxX + 1) * 0.5) * vp.width;
  let top = vp.top + ((1 - ndc.maxY) * 0.5) * vp.height;
  let bottom = vp.top + ((1 - ndc.minY) * 0.5) * vp.height;

  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
    return null;
  }
  if (left > right) [left, right] = [right, left];
  if (top > bottom) [top, bottom] = [bottom, top];
  return { left, top, right, bottom };
}

export class TouchUi {
  private world: World;
  private mainGroup: Group;
  private raycaster: Raycaster;
  private camera: Camera | null = null;
  private viewport: { left: number; top: number; width: number; height: number } | null = null;

  private main: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;
  private raycastGroup: Group;
  private raycastObjects: Array<Mesh>;
  private raycastTable: Mesh;
  private currentObjects: Array<Mesh> = [];

  private selectionBox: SelectionBox | null = null;
  private selection: HTMLElement | null;

  private pointerId: number | null = null;
  private downClient: { x: number; y: number } | null = null;
  private moved = false;
  private longPressTimer: number | null = null;
  private longPressFired = false;
  private bloodDiscardConfirm: { tileId: number; tileKey: number | null; preview: TenpaiPreview | null } | null = null;
  private tenpaiRoot: HTMLDivElement;
  private tenpaiPopup: HTMLDivElement;
  private tenpaiRenderKey: string = '';
  private enabled: boolean;

  private mode: 'idle' | 'tap' | 'dragCandidate' | 'dragging' = 'idle';
  private dragPlaneZ = 0;

  private mouse2: Vector2 | null = null;
  private mouse3: Vector3 | null = null;
  private selectStart3: Vector3 | null = null;
  private hoveredId: number | null = null;

  constructor(world: World, mainGroup: Group, options?: { enabled?: boolean }) {
    this.world = world;
    this.mainGroup = mainGroup;
    this.raycaster = new Raycaster();
    this.enabled = options?.enabled !== false;

    this.main = document.getElementById('main')!;
    this.canvas = this.main.querySelector('canvas') as HTMLCanvasElement | null;
    this.selection = document.getElementById('selection') as HTMLElement | null;

    this.raycastObjects = [];
    this.raycastGroup = new Group();
    this.mainGroup.add(this.raycastGroup);
    this.raycastGroup.visible = false;
    this.raycastGroup.matrixAutoUpdate = false;

    for (let i = 0; i < this.world.slots.size; i++) {
      const obj = new Mesh(new BoxGeometry(1, 1, 1));
      obj.name = 'raycastBox';
      obj.visible = false;
      obj.matrixAutoUpdate = false;
      this.raycastObjects.push(obj);
      this.raycastGroup.add(obj);
    }

    this.raycastTable = new Mesh(new PlaneGeometry(World.WIDTH * 3, World.WIDTH * 3));
    this.raycastTable.visible = false;
    this.raycastTable.position.set(World.WIDTH / 2, World.WIDTH / 2, 0);
    this.raycastGroup.add(this.raycastTable);

    this.tenpaiRoot = document.createElement('div');
    this.tenpaiRoot.id = 'blood-tenpai-preview';
    this.tenpaiRoot.style.display = 'none';
    this.main.appendChild(this.tenpaiRoot);

    this.tenpaiPopup = document.createElement('div');
    this.tenpaiPopup.className = 'tenpai-popup';
    this.tenpaiRoot.appendChild(this.tenpaiPopup);

    if (this.enabled) {
      this.setupEvents();
    }
  }

  setCamera(camera: Camera): void {
    if (this.camera !== camera) {
      this.camera = camera;
      this.selectionBox = new SelectionBox(camera);
    }
  }

  setViewport(viewport: { left: number; top: number; width: number; height: number } | null): void {
    this.viewport = viewport;
  }

  updateObjects(): void {
    this.currentObjects = this.prepareObjects();
  }

  update(): void {
    if (!this.enabled) {
      this.hideTenpaiPopup();
      return;
    }
    this.updateTenpaiPopup();
    // 只有在主画布上有活跃指针时才驱动 world 的 hover/move，
    // 避免与手牌 UI 层的拖动事件互相覆盖。
    if (this.pointerId === null) {
      return;
    }
    if (!this.camera || this.mouse2 === null) {
      return;
    }

    this.raycaster.setFromCamera(this.mouse2, this.camera);

    const intersects = this.raycaster.intersectObjects(this.currentObjects);
    let hovered: number | null = null;
    let hoverPos: Vector3 | null = null;
    if (intersects.length > 0) {
      hovered = intersects[0].object.userData.id as number;
      hoverPos = intersects[0].point.clone();
      this.raycastGroup.worldToLocal(hoverPos);
    }
    this.hoveredId = hovered;
    this.world.onHover(hovered);

    this.raycastTable.position.z = this.mode === 'dragging' ? this.dragPlaneZ : 0;
    this.raycastTable.updateMatrixWorld();
    const intersectsTable = this.raycaster.intersectObject(this.raycastTable);
    let levelPos: Vector3 | null = null;
    if (intersectsTable.length > 0) {
      levelPos = intersectsTable[0].point.clone();
      this.raycastGroup.worldToLocal(levelPos);
    }

    if (this.prepareSelection()) {
      const selected: Array<any> = [];
      for (const obj of this.selectionBox!.select(this.currentObjects)) {
        selected.push(obj.userData.id);
      }
      this.world.onSelect(selected);
      if (levelPos) {
        this.mouse3 = levelPos;
      }
    } else if (this.mode === 'dragging') {
      this.mouse3 = levelPos ?? this.mouse3;
    } else {
      this.mouse3 = hoverPos ?? levelPos ?? this.mouse3;
    }

    this.world.onMove(this.mouse3);
  }

  private prepareSelection(): boolean {
    if (!this.camera || !this.selectionBox || !this.selection) {
      return false;
    }

    if (this.selectStart3 === null || this.mouse2 === null) {
      this.selection.style.visibility = 'hidden';
      return false;
    }

    const vp = this.viewport;
    const w = vp ? vp.width : this.main.clientWidth;
    const h = vp ? vp.height : this.main.clientHeight;
    const offsetX = vp ? vp.left : 0;
    const offsetY = vp ? vp.top : 0;

    const p = this.selectStart3.clone();
    this.raycastGroup.localToWorld(p);
    const selectStart2 = p.project(this.camera!);

    const x1 = Math.min(selectStart2.x, this.mouse2.x);
    const y1 = Math.min(selectStart2.y, this.mouse2.y);
    const x2 = Math.max(selectStart2.x, this.mouse2.x);
    const y2 = Math.max(selectStart2.y, this.mouse2.y);

    const sx1 = (x1 + 1) * w / 2;
    const sx2 = (x2 + 1) * w / 2;
    const sy1 = (-y2 + 1) * h / 2;
    const sy2 = (-y1 + 1) * h / 2;

    this.selection.style.left = `${sx1 + offsetX}px`;
    this.selection.style.top = `${sy1 + offsetY}px`;
    this.selection.style.width = `${sx2 - sx1}px`;
    this.selection.style.height = `${sy2 - sy1}px`;
    this.selection.style.visibility = 'visible';

    this.selectionBox.update(new Vector2(x1, y1), new Vector2(x2, y2));
    return true;
  }

  private setupEvents(): void {
    this.main.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.main.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.main.addEventListener('pointerup', this.onPointerUp.bind(this));
    this.main.addEventListener('pointercancel', this.onPointerCancel.bind(this));
    this.main.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blood-tenpai-dismiss', () => this.clearBloodDiscardConfirm());
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.pointerId !== null) {
      return;
    }

    const target = event.target as Element | null;
    if (this.world.isAiHosted()) {
      // 托管中：屏蔽本家手牌触摸（只拦截画布，避免误伤 HUD/弹窗等 HTML 面板的点击）。
      const canvas = this.canvas ?? (this.canvas = this.main.querySelector('canvas') as HTMLCanvasElement | null);
      if (canvas && target === canvas) {
        event.preventDefault();
        return;
      }
    }
    if (this.world.isBloodDiscardLocked()) {
      // 移动端血战/国标：二次确认弃牌后到服务端回显前，禁止一切手牌交互（点/拖/长按/点空白取消等）。
      // 只拦截画布（手牌触摸来源），避免误伤 HUD/弹窗等 HTML 面板的点击。
      const canvas = this.canvas ?? (this.canvas = this.main.querySelector('canvas') as HTMLCanvasElement | null);
      if (canvas && target === canvas) {
        event.preventDefault();
      }
      return;
    }
    if (this.world.isBloodSwap3Phase() && target && target.closest('#blood-ui')) {
      // swap3（换三张）：血战面板按钮依赖当前选中的 3 张牌，不能在 pointerdown 阶段被清空。
      // 同时不抢占 pointer，避免影响按钮的正常点击。
      return;
    }

    const canvas = this.canvas ?? (this.canvas = this.main.querySelector('canvas') as HTMLCanvasElement | null);
    if (canvas && event.target !== canvas) {
      // 点到 HUD/弹窗/按钮：视为“点空白取消选中”，不抢占 pointer。
      this.clearBloodDiscardConfirm();
      this.world.onSelect([]);
      return;
    }
    if (this.viewport && !this.isInsideViewport(event)) {
      // 只在底部“手牌视口”内响应触摸，避免桌面区域误触抢占 pointer
      // 但仍需支持“点空白取消选中/关闭听牌预览”。
      this.clearBloodDiscardConfirm();
      this.world.onSelect([]);
      return;
    }

    this.pointerId = event.pointerId;
    this.main.setPointerCapture(event.pointerId);

    this.downClient = { x: event.clientX, y: event.clientY };
    this.moved = false;
    this.longPressFired = false;

    this.updateMouse2(event);
    this.update();

    const hovered = this.hoveredId;
    this.selectStart3 = hovered === null && this.mouse3 ? this.mouse3.clone() : null;
    this.mode = hovered !== null ? 'dragCandidate' : 'tap';

    this.startLongPressTimer();
    event.preventDefault();
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) {
      return;
    }

    this.updateMouse2(event);
    this.update();

    const dist = this.distanceFromDown(event);
    if (dist !== null && dist > MOVE_CANCEL_PX) {
      this.moved = true;
      this.cancelLongPressTimer();
    }

    if (this.mode === 'dragCandidate' && dist !== null && dist > DRAG_START_PX) {
      this.cancelLongPressTimer();
      this.clearBloodDiscardConfirm();
      this.selectStart3 = null;
      if (this.world.onDragStart()) {
        this.mode = 'dragging';
        this.dragPlaneZ = this.mouse3?.z ?? 0;
      } else {
        this.mode = 'tap';
      }
    }

    event.preventDefault();
  }

  private onPointerUp(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) {
      return;
    }

    this.cancelLongPressTimer();

    if (this.mode === 'dragging') {
      this.clearBloodDiscardConfirm();
      this.world.onDragEnd();
    } else if (this.selectStart3 !== null) {
      // 框选结束：保持当前 selection，不要被“轻触选中”覆盖。
      // 但如果没有移动（等价于点空白），则按需求取消选中。
      if (!this.longPressFired && !this.moved) {
        this.clearBloodDiscardConfirm();
        this.world.onSelect([]);
      } else {
        this.clearBloodDiscardConfirm();
      }
    } else if (!this.longPressFired && !this.moved) {
      // 轻触：
      // - 出牌：点一下选中（上抬/可预览听牌），再点同一张确认出牌
      // - 其他状态：单击选中（用于观察高亮）
      // 移动端血战：多组暗杠的“选牌模式”——只允许点高亮手牌完成杠，或点“过”按钮放弃。
      if (this.world.isBloodSwap3Phase()) {
        this.clearBloodDiscardConfirm();
        if (this.hoveredId !== null) {
          this.world.tryBloodSwap3Toggle(this.hoveredId);
        } else {
          this.world.onSelect([]);
        }
      } else if (this.world.hasBloodKongPick()) {
        this.clearBloodDiscardConfirm();
        if (this.hoveredId !== null) {
          const ok = this.world.tryBloodKongPick(this.hoveredId);
          if (ok) {
            // 杠成功后清空选中，避免残留高亮。
            this.world.onSelect([]);
          }
        }
      } else if (this.hoveredId !== null) {
        const tileId = this.hoveredId;
        const thing = this.world.things.get(tileId) ?? null;
        const tileKey = thing ? tileKeyFromTypeIndex(thing.typeIndex) : null;

        const isBlood = this.world.conditions.gameType === GameType.BLOOD_BATTLE;
        const isGuobiao = this.world.conditions.gameType === GameType.GUOBIAO;
        const canDiscardNow = isBlood
          ? this.world.canBloodDiscardNow()
          : (isGuobiao ? this.world.canGuobiaoDiscardNow() : true);
        const selectedIds = this.world.getSelectedThingIds();
        const isConfirm = selectedIds.length === 1 && selectedIds[0] === tileId;

        if (isConfirm) {
          // 二次确认：仅在满足出牌条件时触发；否则忽略（保持选中态）。
          if (!canDiscardNow) {
            // ignore
          } else {
            const ok = this.world.quickDiscard(tileId);
            if (ok) {
              this.clearBloodDiscardConfirm();
            }
          }
        } else {
          // 首次点选 / 切换到另一张牌：更新选中与听牌预览（若可用）。
          this.world.onSelect([tileId]);
          if (this.world.canBloodDiscardNow() || this.world.canGuobiaoDiscardNow()) {
            this.setBloodDiscardConfirm(tileId, tileKey);
          } else {
            this.clearBloodDiscardConfirm();
          }
        }
      } else {
        this.clearBloodDiscardConfirm();
        this.world.onSelect([]);
      }
    } else {
      // 非“轻触”手势（长按/拖动/移动取消等），不参与“点两次确认”。
      this.clearBloodDiscardConfirm();
    }

    this.resetPointer();
    event.preventDefault();
  }

  private onPointerCancel(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) {
      return;
    }
    this.cancelLongPressTimer();
    if (this.mode === 'dragging') {
      this.world.onDragEnd();
    }
    this.resetPointer();
    event.preventDefault();
  }

  private resetPointer(): void {
    this.pointerId = null;
    this.downClient = null;
    this.moved = false;
    this.longPressFired = false;
    this.mode = 'idle';
    this.dragPlaneZ = 0;
    this.mouse2 = null;
    this.mouse3 = null;
    this.selectStart3 = null;
    this.hoveredId = null;
    if (this.selection) {
      this.selection.style.visibility = 'hidden';
    }
    this.world.onHover(null);
    this.world.onMove(null);
  }

  private updateMouse2(event: PointerEvent): void {
    const rect = this.main.getBoundingClientRect();
    const scaleX = rect.width / Math.max(1, this.main.clientWidth);
    const scaleY = rect.height / Math.max(1, this.main.clientHeight);
    const invScaleX = Number.isFinite(scaleX) && scaleX > 1e-6 ? 1 / scaleX : 1;
    const invScaleY = Number.isFinite(scaleY) && scaleY > 1e-6 ? 1 / scaleY : 1;
    let px = (event.clientX - rect.left) * invScaleX;
    let py = (event.clientY - rect.top) * invScaleY;
    let w = this.main.clientWidth;
    let h = this.main.clientHeight;
    if (this.viewport) {
      px -= this.viewport.left;
      py -= this.viewport.top;
      w = this.viewport.width;
      h = this.viewport.height;
    }
    const x = px / Math.max(1, w);
    const y = py / Math.max(1, h);

    if (this.mouse2 === null) {
      this.mouse2 = new Vector2();
    }
    this.mouse2.x = x * 2 - 1;
    this.mouse2.y = -(y * 2 - 1);
  }

  private isInsideViewport(event: PointerEvent): boolean {
    if (!this.viewport) {
      return true;
    }
    const rect = this.main.getBoundingClientRect();
    const scaleX = rect.width / Math.max(1, this.main.clientWidth);
    const scaleY = rect.height / Math.max(1, this.main.clientHeight);
    const invScaleX = Number.isFinite(scaleX) && scaleX > 1e-6 ? 1 / scaleX : 1;
    const invScaleY = Number.isFinite(scaleY) && scaleY > 1e-6 ? 1 / scaleY : 1;
    const x = (event.clientX - rect.left) * invScaleX;
    const y = (event.clientY - rect.top) * invScaleY;
    return (
      x >= this.viewport.left &&
      x <= this.viewport.left + this.viewport.width &&
      y >= this.viewport.top &&
      y <= this.viewport.top + this.viewport.height
    );
  }

  private distanceFromDown(event: PointerEvent): number | null {
    if (!this.downClient) {
      return null;
    }
    const dx = event.clientX - this.downClient.x;
    const dy = event.clientY - this.downClient.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private startLongPressTimer(): void {
    this.cancelLongPressTimer();

    this.longPressTimer = window.setTimeout(() => {
      if (this.pointerId === null) {
        return;
      }
      if (this.mode === 'dragging' || this.moved) {
        return;
      }
      if (this.hoveredId === null) {
        return;
      }

      // 长按：
      // - 自家手牌：本地翻到背面/恢复（不广播，防偷看）
      // - 其他牌：直接翻牌（广播；不批量翻，避免误操作）
      this.longPressFired = true;
      this.clearBloodDiscardConfirm();
      const viewerSeat = this.world.seat;
      const thing = this.world.things.get(this.hoveredId);
      if (
        thing &&
        viewerSeat !== null &&
        thing.type === 'TILE' &&
        thing.slot.group === 'hand' &&
        thing.slot.seat === viewerSeat
      ) {
        this.mode = 'idle';
        this.world.toggleLocalHandHidden(this.hoveredId);
        return;
      }

      this.mode = 'idle';
      this.world.onSelect([]);
      this.world.onHover(this.hoveredId);
      this.world.onFlip(1);
    }, LONG_PRESS_MS);
  }

  private cancelLongPressTimer(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private prepareObjects(): Array<Mesh> {
    const toSelect = this.world.toSelect();
    const objs: Array<Mesh> = [];

    const minSize = 3;

    for (let i = 0; i < toSelect.length; i++) {
      const select = toSelect[i];
      const obj = this.raycastObjects[i];
      obj.position.copy(select.position);
      obj.scale.copy(select.size);

      if (obj.scale.x < minSize) obj.scale.x = minSize;
      if (obj.scale.y < minSize) obj.scale.y = minSize;

      obj.updateMatrix();
      obj.updateMatrixWorld();
      obj.userData.id = select.id;
      objs.push(obj);
    }
    return objs;
  }

  private clearBloodDiscardConfirm(): void {
    this.bloodDiscardConfirm = null;
    this.tenpaiRoot.style.display = 'none';
    this.tenpaiRenderKey = '';
    this.main.classList.remove('blood-tenpai-open');
  }

  private setBloodDiscardConfirm(tileId: number, tileKey: number | null): void {
    const preview = this.world.getBloodTenpaiPreviewAfterDiscard(tileId);
    this.bloodDiscardConfirm = { tileId, tileKey, preview };
    this.renderTenpaiPopup();
  }

  private renderTenpaiPopup(): void {
    const info = this.bloodDiscardConfirm;
    const preview = info?.preview ?? null;
    if (!info || !preview) {
      this.tenpaiRoot.style.display = 'none';
      this.tenpaiRenderKey = '';
      this.main.classList.remove('blood-tenpai-open');
      return;
    }

    const waits = (preview.waits ?? []) as Array<{ tileKey: number; remain: number; multiplier: number }>;
    const maxPart = preview.maxMultiplier !== null ? ` · 最大番×${preview.maxMultiplier}` : '';
    const key = `${preview.total}|${preview.kinds}|${preview.maxMultiplier ?? ''}|${waits.map((w) => `${w.tileKey}:${w.remain}:${w.multiplier}`).join(',')}`;
    if (key === this.tenpaiRenderKey) {
      this.tenpaiRoot.style.display = 'block';
      this.main.classList.add('blood-tenpai-open');
      return;
    }
    this.tenpaiRenderKey = key;

    this.tenpaiRoot.style.display = 'block';
    this.main.classList.add('blood-tenpai-open');

    this.tenpaiPopup.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'tenpai-head';
    head.textContent = `听牌 ${preview.total}张/${preview.kinds}种${maxPart}`;
    this.tenpaiPopup.appendChild(head);

    if (waits.length === 0) {
      return;
    }

    const list = document.createElement('div');
    list.className = 'tenpai-list';
    this.tenpaiPopup.appendChild(list);

    for (const w of waits) {
      const line = document.createElement('div');
      line.className = 'tenpai-line';
      const tile = document.createElement('span');
      tile.className = 'tenpai-tile';
      applyTenpaiTileFace(tile, w.tileKey);
      line.appendChild(tile);

      const text = document.createElement('span');
      text.className = 'tenpai-line-text';
      text.textContent = `剩余${w.remain} 点炮×${w.multiplier}`;
      line.appendChild(text);
      list.appendChild(line);
    }
  }

  private updateTenpaiPopup(): void {
    if (!this.world.canBloodDiscardNow()) {
      if (this.bloodDiscardConfirm !== null) {
        this.clearBloodDiscardConfirm();
      }
      return;
    }

    const info = this.bloodDiscardConfirm;
    if (!info || !info.preview) {
      this.tenpaiRoot.style.display = 'none';
      this.main.classList.remove('blood-tenpai-open');
      return;
    }

    if (!this.camera) {
      return;
    }

    const thing = this.world.things.get(info.tileId) ?? null;
    if (!thing) {
      this.tenpaiRoot.style.display = 'none';
      this.main.classList.remove('blood-tenpai-open');
      return;
    }
    let anchorPlace = this.world.getMobileSelfHandDisplayPlace(info.tileId) ?? thing.place();
    // 与“点选上抬”保持一致：听牌预览锚点也跟随上抬后的牌位。
    const selectedIds = this.world.getSelectedThingIds();
	    const isRaised = selectedIds.length === 1 && selectedIds[0] === info.tileId;
	    if (isRaised) {
	      const viewerSeat = this.world.seat;
	      if (viewerSeat !== null) {
	        const raise = anchorPlace.size.z * HAND_TAP_RAISE_RATIO;
	        if (raise > 1e-6) {
	          anchorPlace = { ...anchorPlace, position: anchorPlace.position.clone() };
	          if (viewerSeat === 0) {
	            anchorPlace.position.y += raise;
          } else if (viewerSeat === 1) {
            anchorPlace.position.x -= raise;
          } else if (viewerSeat === 2) {
            anchorPlace.position.y -= raise;
          } else {
            anchorPlace.position.x += raise;
          }
        }
      }
    }

    const rootPos = window.getComputedStyle(this.tenpaiRoot).position;
    const w = this.main.clientWidth;
    const h = this.main.clientHeight;

    const rect = (() => {
      // /hand/：tenpaiRoot 被收进 #main（absolute）；坐标使用“舞台像素”（未缩放的 1280×720）。
      if (rootPos !== 'fixed') {
        const vp = this.viewport ?? { left: 0, top: 0, width: w, height: h };
        return projectPlaceToRectPx(anchorPlace, this.camera, vp);
      }

      // 兼容其他页面：tenpaiRoot 仍为 fixed 覆盖全屏，需要用“屏幕像素”坐标。
      const mainRect = this.main.getBoundingClientRect();
      const scaleX = mainRect.width / Math.max(1, w);
      const scaleY = mainRect.height / Math.max(1, h);
      const localVp = this.viewport ?? { left: 0, top: 0, width: mainRect.width, height: mainRect.height };
      const vp = {
        left: mainRect.left + localVp.left * scaleX,
        top: mainRect.top + localVp.top * scaleY,
        width: localVp.width * scaleX,
        height: localVp.height * scaleY,
      };
      return projectPlaceToRectPx(anchorPlace, this.camera, vp);
    })();
    if (!rect) {
      this.tenpaiRoot.style.display = 'none';
      this.main.classList.remove('blood-tenpai-open');
      return;
    }

    this.main.classList.add('blood-tenpai-open');
    const clampW = rootPos === 'fixed' ? window.innerWidth : w;
    const clampH = rootPos === 'fixed' ? window.innerHeight : h;
    const x = clamp((rect.left + rect.right) * 0.5, 10, clampW - 10);
    const y = clamp(rect.top - 6, 10, clampH - 10);
    this.tenpaiPopup.style.left = `${x}px`;
    this.tenpaiPopup.style.top = `${y}px`;
  }

  private hideTenpaiPopup(): void {
    this.tenpaiRoot.style.display = 'none';
    this.main.classList.remove('blood-tenpai-open');
  }
}
