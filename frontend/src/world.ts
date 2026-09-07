import { Camera, Quaternion, Vector3 } from "three";

import { Movement } from "./movement";
import { Client } from "./client";
import { mostCommon, rectangleOverlap, filterMostCommon, compareZYX } from "./utils";
import { MouseTracker } from "./mouse-tracker";
import { Setup } from './setup';
import type { Render } from "./object-view";
import type { BloodHuOverlayRender, GuobiaoSeatInnerDisplayTileRender } from "./blood-hu-overlay";
import { Conditions, ThingInfo, SoundType, Fives, Place, ThingType, Size, DealType, GameType, Points, DiceInfo } from "./types";
import { Slot } from "./slot";
import { Thing } from "./thing";
import { applyMobileHandLayout, computeDiscardEdge, computeHandMeldMarkerEdge } from "./mobile-hand-layout";
import type { BloodSuit, BloodState, BloodGangType } from "./blood";
import { suitOf, tileKeyFromTypeIndex } from "./blood-tiles";
import type { GuobiaoState } from "./guobiao";
import { GUOBIAO_NON_FLOWER_TILE_COUNT, guobiaoTileKeyFromTypeIndex, guobiaoTileSortKey, guobiaoTileTypeIndex } from "./guobiao-tiles";
import { computeTenpaiPreviewAfterDiscard, type TenpaiPreview } from "./blood-tenpai-preview";

export interface ObjectViewLike {
  replaceThings(params: Map<number, any>): void;
  replaceShadows(places: Array<Place>): void;
  updateScores(scores: Array<number | null>): void;
  updateThings(things: Array<Render>): void;
  updateDropShadows(places: Array<Place>): void;
  setTileTypeIndex?(tileId: number, typeIndex: number): void;
  setGuobiaoTileAtlas?(enabled: boolean): void;
  updateBloodHuOverlays?(overlays: Array<BloodHuOverlayRender | null>): void;
  updateGuobiaoSeatInnerDisplay?(overlays: Array<GuobiaoSeatInnerDisplayTileRender>): void;
}

export interface SoundPlayerLike {
  play(type: SoundType, side: number | null, tileKey?: number | null, tileId?: number | null): void;
  playLocalOnly?(type: SoundType, side: number | null, actorSeat: number | null, tileKey?: number | null, tileId?: number | null): void;
  playDiscardTileVoiceLocalOnly?(side: number | null, actorSeat: number | null, tileKey: number | null, tileId?: number | null): void;
  playBuhuaLocalOnly?(side: number | null, actorSeat: number | null): void;
}

interface Select extends Place {
  id: any;
}

const SHIFT_TIME = 100;
const REMOTE_DISCARD_TILE_RETRY_MAX = 2;
const REMOTE_DISCARD_TILE_RETRY_DELAY_MS = 45;
const HAND_LOCAL_BACK_ROTATION = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
const HAND_VIEW_LAYER = 1;
const WORLD_WIDTH = 174;
const WORLD_CENTER_VECTOR = new Vector3(WORLD_WIDTH * 0.5, WORLD_WIDTH * 0.5, 0);
const WORLD_Z_AXIS = new Vector3(0, 0, 1);
// /hand/ 移动端血战：胡牌展示往“胡家所在边”靠一点（更接近红线/手牌条，视觉更聚焦）。
const HU_OVERLAY_OUTWARD_SHIFT = Size.TILE.y * 0.8;
const HU_OVERLAY_OUTWARD_DIR = [
  new Vector3(0, -1, 0), // seat0：屏幕下
  new Vector3(1, 0, 0),  // seat1：屏幕右
  new Vector3(0, 1, 0),  // seat2：屏幕上
  new Vector3(-1, 0, 0), // seat3：屏幕左
];
// 国标座位内侧展示区在移动端属于桌面层，会被 table viewport 硬裁切。
// 这里用与 /hand/ 桌面取景一致的世界边界做小幅安全回推，避免花牌/胡牌贴边缺角。
const GUOBIAO_INNER_DISPLAY_SAFE_MARGIN = Size.TILE.x * 0.08;
const GUOBIAO_INNER_DISPLAY_BOTTOM_BOUND_Y = 42;
const GUOBIAO_INNER_DISPLAY_SIDE_BOUND_MIN = GUOBIAO_INNER_DISPLAY_BOTTOM_BOUND_Y - Size.TILE.x - Size.TILE.y;
const GUOBIAO_INNER_DISPLAY_SIDE_BOUND_MAX = WORLD_WIDTH - GUOBIAO_INNER_DISPLAY_SIDE_BOUND_MIN;
const GUOBIAO_INNER_DISPLAY_CANONICAL_ALONG = [
  new Vector3(1, 0, 0),
  new Vector3(0, -1, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
];
const GUOBIAO_INNER_DISPLAY_CANONICAL_OUTWARD = [
  new Vector3(0, -1, 0),
  new Vector3(1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(-1, 0, 0),
];
type SeatInnerDisplayBase = {
  position: Vector3;
  rotation: Quaternion;
  badgePosition: Vector3;
  badgeRotation: Quaternion;
};
export const HAND_TAP_RAISE_RATIO = 0.35;

export class World {
  private setup: Setup;

  private objectView: ObjectViewLike;

  slots: Map<string, Slot>;
  things: Map<number, Thing>;
  private pushes: Array<[Slot, Slot]>;

  private hovered: Thing | null = null;
  private selected: Array<Thing> = [];
  private mouse: Vector3 | null = null;
  private localHandHidden: Set<number> = new Set();
  private thingsSynced: boolean = false;

  private movement: Movement | null = null;
  private heldMouse: Vector3 | null = null;
  mouseTracker: MouseTracker;

  soundPlayer: SoundPlayerLike;

  seat: number | null = 0;

  static WIDTH = WORLD_WIDTH;

  private client: Client;

  conditions: Conditions;

  private aiHosted: boolean = false;
  private aiHostedSources: Set<string> = new Set();

  private layoutMode: 'default' | 'mobileHand';
  private mobileLayoutSeat: number | null = null;
  // 仅移动端：布局每次重算递增，用于通知相机重新取景（避免每帧抖动）。
  mobileLayoutVersion: number = 0;
  // 移动端血战：弃牌后到 blood 状态回显前，禁止再次弃牌，避免“双出牌”竞态。
  private bloodDiscardLock: { tileId: number; fromSlotName: string } | null = null;
  // 仅权威模式：记录最近一次“出牌”动作的 actionId，用于 ACK 失败时精准解锁。
  private pendingBloodDiscardActionId: string | null = null;
  // 诊断模式下保留到权威状态真正应用，以便 ACK 先到时仍能关联本次出牌。
  private bloodDiscardDiagnosticActionId: string | null = null;
  private pendingDiagnosticRenderActionId: string | null = null;
  // 移动端血战：多组暗杠时“点杠再点牌”的候选集合（用于高亮与点击确认）。
  private bloodKongPick: { seat: number; options: Array<{ tileKey: number; gangType: BloodGangType }>; tileKeys: Set<number> } | null =
    null;
  // 教练模式：额外高亮（不影响真实选中）。
  private coachHighlights: Set<number> = new Set();
  // 教练模式：弃牌限制（用于“强制动作/禁止误触”）。
  private coachDiscardRule: { allow: 'none' } | { allow: 'only'; tileIds: Set<number> } | null = null;
  // 他家出牌：当 things 先于 tileFacePublic 到达时，延迟补播牌名音。
  private pendingRemoteDiscardVoices: Map<number, { side: number; actorSeat: number; retries: number }> = new Map();
  private remoteDiscardVoiceRetryTimers: Map<number, number> = new Map();
  // 国标私有牌面会在公共 full update 中短暂清空；缓存上一帧本家手牌牌面，避免手牌退回隐藏牌后重新排序造成闪动。
  private guobiaoSelfTileFaceCache: Map<number, number> = new Map();

  constructor(
    objectView: ObjectViewLike,
    soundPlayer: SoundPlayerLike,
    client: Client,
    options?: { layoutMode?: 'default' | 'mobileHand' },
  ) {
    this.layoutMode = options?.layoutMode ?? 'default';
    this.setup = new Setup();
    this.slots = this.setup.slots;
    this.things = this.setup.things;
    this.pushes = this.setup.pushes;
    this.conditions = Conditions.initial();
    this.setup.setup(this.conditions);

    this.objectView = objectView;
    this.setupView();

    this.client = client;
    this.mouseTracker = new MouseTracker(this.client);

    this.soundPlayer = soundPlayer;

    this.client.seats.on('update', this.onSeat.bind(this));
    this.client.things.on('update', this.onThings.bind(this));
    this.client.match.on('update', this.onMatch.bind(this));
    this.client.dice.on('update', this.onDice.bind(this));
    this.client.blood.on('update', this.onBlood.bind(this));
    this.client.gb.on('update', this.onGb.bind(this));
    this.client.tileFacePublic.on('update', (entries, full) => this.onTileFaces('public', entries, full));
    this.client.tileFaceSelf.on('update', (entries, full) => this.onTileFaces('self', entries, full));
    this.client.on('actionAck', this.onActionAck.bind(this));
    this.sendUpdate();
  }

  private setBloodDiscardLock(lock: { tileId: number; fromSlotName: string }, actionId: string | null = null): void {
    this.bloodDiscardLock = lock;
    this.pendingBloodDiscardActionId = actionId;
    this.bloodDiscardDiagnosticActionId = actionId;
  }

  private clearBloodDiscardLock(reason: 'reset' | 'rejected' | 'state-applied' = 'reset', source = 'unknown'): void {
    const diagnosticActionId = this.bloodDiscardDiagnosticActionId;
    if (reason === 'state-applied' && diagnosticActionId) {
      this.client.markActionStateApplied(diagnosticActionId, source);
      this.pendingDiagnosticRenderActionId = diagnosticActionId;
    }
    this.bloodDiscardLock = null;
    this.pendingBloodDiscardActionId = null;
    this.bloodDiscardDiagnosticActionId = null;
  }

  isBloodDiscardLocked(): boolean {
    return (this.isBloodMobile() || this.isGuobiaoMobile()) && this.bloodDiscardLock !== null;
  }

  setAiHosted(enabled: boolean, source = 'default'): void {
    const src = String(source ?? '').trim() || 'default';
    const before = this.aiHostedSources.size > 0;
    if (enabled) {
      this.aiHostedSources.add(src);
    } else {
      this.aiHostedSources.delete(src);
    }
    const next = this.aiHostedSources.size > 0;
    if (before === next) {
      this.aiHosted = next;
      return;
    }
    this.aiHosted = next;
    if (next) {
      // 进入托管：清理本地交互态，避免残留选中/悬停影响视觉或误触。
      this.onHover(null);
      this.onSelect([]);
      this.onMove(null);
    }
  }

  isAiHosted(): boolean {
    return this.aiHosted;
  }

  private onBlood(): void {
    if (!this.isBloodMobile()) {
      return;
    }
    if (!this.bloodDiscardLock) {
      return;
    }
    const lock = this.bloodDiscardLock;
    const seat = this.seat;
    if (seat === null) {
      this.clearBloodDiscardLock();
      return;
    }
    const state = this.client.blood.get(0);
    if (!state) {
      return;
    }
    const stillWaitingForAck =
      state.phase === 'playing' &&
      state.pending === null &&
      state.turnSeat === seat &&
      state.turnStep === 'discard';
    if (!stillWaitingForAck) {
      // 等到“状态不再等 ACK”且该牌已离开原手牌槽位，再解除锁。
      // 这样可避免 blood 状态先到、things 后到时出现“可操作但牌还没出”的竞态。
      const lockedThing = this.things.get(lock.tileId) ?? null;
      const moved = !!(lockedThing && lockedThing.slot.name !== lock.fromSlotName);
      if (!lockedThing || moved) {
        this.clearBloodDiscardLock('state-applied', 'blood');
      }
    }
  }

  private onGb(): void {
    if (!this.isGuobiaoMobile()) {
      return;
    }
    if (!this.bloodDiscardLock) {
      return;
    }
    const lock = this.bloodDiscardLock;
    const seat = this.seat;
    if (seat === null) {
      this.clearBloodDiscardLock();
      return;
    }
    const state = this.client.gb.get(0) as GuobiaoState | null;
    if (!state) {
      return;
    }
    const stillWaitingForAck =
      state.phase === 'playing' &&
      state.pending === null &&
      state.turnSeat === seat &&
      state.turnStep === 'discard';
    if (!stillWaitingForAck) {
      const lockedThing = this.things.get(lock.tileId) ?? null;
      const moved = !!(lockedThing && lockedThing.slot.name !== lock.fromSlotName);
      if (!lockedThing || moved) {
        this.clearBloodDiscardLock('state-applied', 'guobiao');
      }
    }
  }

  private onActionAck(ack: { actionId: string; ok: boolean }): void {
    if (!this.isBloodMobile() && !this.isGuobiaoMobile()) {
      return;
    }
    if (!this.bloodDiscardLock) {
      return;
    }
    const pendingActionId = this.pendingBloodDiscardActionId;
    if (!pendingActionId || ack.actionId !== pendingActionId) {
      return;
    }
    if (!ack.ok) {
      // 服务端拒绝本次出牌时不会推进 blood/things；必须在 ACK 失败分支立即解锁。
      this.clearBloodDiscardLock('rejected', 'action-ack');
      return;
    }
    // ACK 成功后继续等待状态推进来清锁；这里只清 actionId，避免后续无关 ACK 干扰。
    this.pendingBloodDiscardActionId = null;
  }

  toggleDealer(): void {
    const match = this.client.match.get(0) ?? { dealer: 3, honba: 0, conditions: Conditions.initial()};
    match.dealer = (match.dealer + 1) % 4;
    this.client.match.set(0, match);
  }

  toggleHonba(): void {
    const match = this.client.match.get(0) ?? { dealer: 0, honba: 0, conditions: Conditions.initial()};
    match.honba = (match.honba + 1) % 8;
    this.client.match.set(0, match);
  };

  private onSeat(): void {
    const previousSeat = this.seat;
    this.seat = this.client.seat;
    this.localHandHidden.clear();
    if (previousSeat !== this.seat) {
      this.guobiaoSelfTileFaceCache.clear();
    }
    this.clearBloodDiscardLock();
    this.bloodKongPick = null;
    this.coachHighlights.clear();
    this.coachDiscardRule = null;
    this.clearAllPendingRemoteDiscardVoices();
    if (this.layoutMode === 'mobileHand' && this.seat !== null && this.mobileLayoutSeat !== this.seat) {
      applyMobileHandLayout(this.slots, this.seat);
      this.mobileLayoutSeat = this.seat;
      this.mobileLayoutVersion++;
      this.setupView();
    }
    if (this.thingsSynced && this.normalizeSelfHandRotations()) {
      this.checkPushes();
      this.sendUpdate();
    }
  }

  private normalizeSelfHandRotations(): boolean {
    if (this.layoutMode !== 'mobileHand') {
      return false;
    }
    const viewerSeat = this.seat;
    if (viewerSeat === null) {
      return false;
    }
    let changed = false;
    for (const thing of this.things.values()) {
      if (thing.type !== ThingType.TILE) {
        continue;
      }
      if (thing.claimedBy !== null) {
        continue;
      }
      const slot = thing.slot;
      if (slot.group !== 'hand' || slot.seat !== viewerSeat) {
        continue;
      }
      if (thing.rotationIndex !== 0) {
        thing.rotationIndex = 0;
        thing.sent = false;
        changed = true;
      }
    }
    return changed;
  }

  toggleLocalHandHidden(thingId: number): void {
    if (this.layoutMode !== 'mobileHand') {
      return;
    }
    const viewerSeat = this.seat;
    if (viewerSeat === null) {
      return;
    }
    const thing = this.things.get(thingId);
    if (!thing || thing.type !== ThingType.TILE) {
      return;
    }
    const slot = thing.slot;
    if (slot.group !== 'hand' || slot.seat !== viewerSeat) {
      return;
    }
    if (this.localHandHidden.has(thingId)) {
      this.localHandHidden.delete(thingId);
    } else {
      this.localHandHidden.add(thingId);
    }
  }

  isLocalHandHidden(thingId: number): boolean {
    return this.localHandHidden.has(thingId);
  }

  private onThings(entries: Array<[number, ThingInfo | null]>, full: boolean = false): void {
    const now = new Date().getTime();
    this.thingsSynced = true;
    const remoteDiscards: Array<{ tileId: number; side: number; actorSeat: number }> = [];
    const guobiaoBuhuas: Array<{ side: number; actorSeat: number }> = [];

    // 若 seat0 回滚了我们刚才的弃牌（非法/竞态），解除本地弃牌锁，允许重新操作。
    if (this.bloodDiscardLock) {
      for (const [thingIndex, thingInfo] of entries) {
        if (thingIndex !== this.bloodDiscardLock.tileId) {
          continue;
        }
        // 只有在“本地已把牌移走”后，服务端又把它送回原手牌槽位，才算真正回滚。
        const thing = this.things.get(thingIndex) ?? null;
        const movedAway = !!(thing && thing.slot.name !== this.bloodDiscardLock.fromSlotName);
        if (movedAway && thingInfo && thingInfo.slotName === this.bloodDiscardLock.fromSlotName) {
          this.clearBloodDiscardLock('state-applied', 'things-rollback');
          break;
        }
      }
    }

    for (const [thingIndex, thingInfo] of entries) {
      // TODO handle deletion
      if (thingInfo === null) {
        continue;
      }

      const thing = this.things.get(thingIndex)!;
      const fromSlot = thing.slot;
      const toSlot = this.slots.get(thingInfo.slotName) ?? null;
      if (!full && toSlot && this.shouldPlayRemoteDiscard(fromSlot, toSlot)) {
        remoteDiscards.push({
          tileId: thing.index,
          side: toSlot.seat!,
          actorSeat: toSlot.seat!,
        });
      }
      if (!full && toSlot && this.shouldPlayGuobiaoBuhua(fromSlot, toSlot)) {
        guobiaoBuhuas.push({
          side: toSlot.seat!,
          actorSeat: toSlot.seat!,
        });
      }
      thing.prepareMove();
    }
    for (const [thingIndex, thingInfo] of entries) {
      if (thingInfo === null) {
        continue;
      }

      const thing = this.things.get(thingIndex)!;
      const slot = this.slots.get(thingInfo.slotName)!;
      thing.moveTo(slot, thingInfo.rotationIndex);
      thing.sent = true;

      // 移动端血战：二次确认弃牌后保持“上抬+高亮”，直到该牌真正离开自家手牌（进入弃牌区/被胡牌拿走等）再清掉高亮。
      if (this.bloodDiscardLock && thingIndex === this.bloodDiscardLock.tileId) {
        const viewerSeat = this.seat;
        const stillInSelfHand =
          viewerSeat !== null && slot.group === 'hand' && slot.seat === viewerSeat;
        if (!stillInSelfHand) {
          this.selected.splice(0);
        }
      }

      thing.claimedBy = thingInfo.claimedBy;
      thing.heldRotation.set(
        thingInfo.heldRotation.x,
        thingInfo.heldRotation.y,
        thingInfo.heldRotation.z,
        thingInfo.heldRotation.w,
      );

      const shiftSlot = thingInfo.shiftSlotName ? this.slots.get(thingInfo.shiftSlotName)! : null;
      if (thing.shiftSlot !== shiftSlot) {
        thing.lastShiftSlot = thing.shiftSlot;
        thing.lastShiftSlotTime = now;
        thing.shiftSlot = shiftSlot;
      }
    }
    if (this.isBloodMobile() && this.bloodDiscardLock) {
      const lock = this.bloodDiscardLock;
      const seat = this.seat;
      const state = this.client.blood.get(0);
      const stillWaitingForAck = !!(
        state &&
        seat !== null &&
        state.phase === 'playing' &&
        state.pending === null &&
        state.turnSeat === seat &&
        state.turnStep === 'discard'
      );
      if (state && !stillWaitingForAck) {
        const lockedThing = this.things.get(lock.tileId) ?? null;
        const moved = !!(lockedThing && lockedThing.slot.name !== lock.fromSlotName);
        if (!lockedThing || moved) {
          this.clearBloodDiscardLock('state-applied', 'things-blood');
        }
      }
    }
    if (this.isGuobiaoMobile() && this.bloodDiscardLock) {
      const lock = this.bloodDiscardLock;
      const seat = this.seat;
      const state = this.client.gb.get(0) as GuobiaoState | null;
      const stillWaitingForAck = !!(
        state &&
        seat !== null &&
        state.phase === 'playing' &&
        state.pending === null &&
        state.turnSeat === seat &&
        state.turnStep === 'discard'
      );
      if (state && !stillWaitingForAck) {
        const lockedThing = this.things.get(lock.tileId) ?? null;
        const moved = !!(lockedThing && lockedThing.slot.name !== lock.fromSlotName);
        if (!lockedThing || moved) {
          this.clearBloodDiscardLock('state-applied', 'things-guobiao');
        }
      }
    }
    if (this.layoutMode === 'mobileHand' && this.seat !== null) {
      applyMobileHandLayout(this.slots, this.seat);
      this.mobileLayoutVersion++;
    }
    this.pruneGuobiaoSelfTileFaceCache();
    this.normalizeSelfHandRotations();
    this.checkPushes();
    this.sendUpdate();

    if (remoteDiscards.length > 0) {
      for (const item of remoteDiscards) {
        this.playRemoteDiscardAudio(item);
      }
    }
    if (guobiaoBuhuas.length > 0) {
      for (const item of guobiaoBuhuas) {
        this.playGuobiaoBuhuaAudio(item);
      }
    }
  }

  private playRemoteDiscardAudio(item: { tileId: number; side: number; actorSeat: number }): void {
    const tileKey = this.resolveTileKeyForAudio(item.tileId);
    if (this.soundPlayer.playLocalOnly) {
      this.soundPlayer.playLocalOnly(SoundType.DISCARD, item.side, item.actorSeat, tileKey, item.tileId);
    } else {
      this.soundPlayer.play(SoundType.DISCARD, item.side, tileKey, item.tileId);
    }
    if (tileKey !== null) {
      this.clearPendingRemoteDiscardVoice(item.tileId);
      return;
    }
    this.pendingRemoteDiscardVoices.set(item.tileId, { side: item.side, actorSeat: item.actorSeat, retries: 0 });
    this.schedulePendingRemoteDiscardVoice(item.tileId);
  }

  private resolveTileKeyForAudio(tileId: number): number | null {
    const raw = this.client.tileFacePublic.get(tileId) ?? this.client.tileFaceSelf.get(tileId) ?? null;
    if (!Number.isFinite(raw)) return null;
    const tileKey = Math.trunc(raw as number);
    const maxTileKey = this.conditions.gameType === GameType.GUOBIAO ? GUOBIAO_NON_FLOWER_TILE_COUNT : 27;
    if (tileKey < 0 || tileKey >= maxTileKey) return null;
    return tileKey;
  }

  private playGuobiaoBuhuaAudio(item: { side: number; actorSeat: number }): void {
    if (this.soundPlayer.playBuhuaLocalOnly) {
      this.soundPlayer.playBuhuaLocalOnly(item.side, item.actorSeat);
    }
  }

  private schedulePendingRemoteDiscardVoice(tileId: number): void {
    const pending = this.pendingRemoteDiscardVoices.get(tileId);
    if (!pending) return;
    const prevTimer = this.remoteDiscardVoiceRetryTimers.get(tileId);
    if (prevTimer !== undefined) {
      window.clearTimeout(prevTimer);
      this.remoteDiscardVoiceRetryTimers.delete(tileId);
    }
    const delayMs = (pending.retries + 1) * REMOTE_DISCARD_TILE_RETRY_DELAY_MS;
    const timerId = window.setTimeout(() => {
      this.remoteDiscardVoiceRetryTimers.delete(tileId);
      this.tryPlayPendingRemoteDiscardVoice(tileId);
    }, delayMs);
    this.remoteDiscardVoiceRetryTimers.set(tileId, timerId);
  }

  private tryPlayPendingRemoteDiscardVoice(tileId: number): void {
    const pending = this.pendingRemoteDiscardVoices.get(tileId);
    if (!pending) return;
    const tileKey = this.resolveTileKeyForAudio(tileId);
    if (tileKey !== null) {
      if (this.soundPlayer.playDiscardTileVoiceLocalOnly) {
        this.soundPlayer.playDiscardTileVoiceLocalOnly(pending.side, pending.actorSeat, tileKey, tileId);
      } else if (this.soundPlayer.playLocalOnly) {
        // Fallback for older sound players: this may replay chupai once.
        this.soundPlayer.playLocalOnly(SoundType.DISCARD, pending.side, pending.actorSeat, tileKey, tileId);
      } else {
        this.soundPlayer.play(SoundType.DISCARD, pending.side, tileKey, tileId);
      }
      this.clearPendingRemoteDiscardVoice(tileId);
      return;
    }
    if (pending.retries >= REMOTE_DISCARD_TILE_RETRY_MAX) {
      this.clearPendingRemoteDiscardVoice(tileId);
      return;
    }
    this.pendingRemoteDiscardVoices.set(tileId, { ...pending, retries: pending.retries + 1 });
    this.schedulePendingRemoteDiscardVoice(tileId);
  }

  private clearPendingRemoteDiscardVoice(tileId: number): void {
    this.pendingRemoteDiscardVoices.delete(tileId);
    const timerId = this.remoteDiscardVoiceRetryTimers.get(tileId);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      this.remoteDiscardVoiceRetryTimers.delete(tileId);
    }
  }

  private clearAllPendingRemoteDiscardVoices(): void {
    for (const timerId of this.remoteDiscardVoiceRetryTimers.values()) {
      window.clearTimeout(timerId);
    }
    this.remoteDiscardVoiceRetryTimers.clear();
    this.pendingRemoteDiscardVoices.clear();
  }

  private shouldPlayRemoteDiscard(fromSlot: Slot, toSlot: Slot): boolean {
    if (fromSlot.group !== 'hand' || toSlot.group !== 'discard') {
      return false;
    }
    if (fromSlot.seat === null || toSlot.seat === null) {
      return false;
    }
    if (fromSlot.seat !== toSlot.seat) {
      return false;
    }
    // 本机自己的出牌在操作路径里已经即时播过，避免重复。
    if (this.seat !== null && toSlot.seat === this.seat) {
      return false;
    }
    return true;
  }

  private shouldPlayGuobiaoBuhua(fromSlot: Slot, toSlot: Slot): boolean {
    if (this.conditions.gameType !== GameType.GUOBIAO) {
      return false;
    }
    if (toSlot.group !== 'flower.store' || toSlot.seat === null) {
      return false;
    }
    if (fromSlot.group !== 'hand' || fromSlot.seat !== toSlot.seat) {
      return false;
    }
    return true;
  }

  private onMatch(): void {
    const match = this.client.match.get(0);
    if (!match) {
      return;
    }

    const conditions = this.normalizeIncomingConditions(match.conditions);
    if (!Conditions.equals(conditions, this.conditions)) {
      this.updateConditions(conditions);

      // Prevent selection persisting after deal
      this.selected.splice(0);
    }

    if (this.client.isAuthoritative()) {
      this.applyTileFacesFull();
    }
  }

  private onTileFaces(source: 'public' | 'self', entries: Array<[number, number | null]>, full: boolean): void {
    if (!this.client.isAuthoritative()) {
      return;
    }

    this.updateGuobiaoSelfTileFaceCache(source, entries, full);

    if (full) {
      this.applyTileFacesFull();
      return;
    }

    const tileIds: Array<number> = [];
    for (const [tileId] of entries) {
      if (Number.isFinite(tileId)) {
        tileIds.push(Math.trunc(tileId));
      }
    }
    this.applyTileFaces(tileIds);
    for (const tileId of tileIds) {
      if (!this.pendingRemoteDiscardVoices.has(tileId)) continue;
      this.tryPlayPendingRemoteDiscardVoice(tileId);
    }
  }

  private updateGuobiaoSelfTileFaceCache(
    source: 'public' | 'self',
    entries: Array<[number, number | null]>,
    full: boolean
  ): void {
    if (this.conditions.gameType !== GameType.GUOBIAO || source !== 'self') {
      return;
    }

    // `full=true` on tileFaceSelf is a public full snapshot side effect. It often has 0 entries
    // and should not erase the last visible self hand faces before the private resend arrives.
    if (full && entries.length === 0) {
      return;
    }

    for (const [rawTileId, rawTileKey] of entries) {
      const tileId = Math.trunc(Number(rawTileId));
      if (!Number.isFinite(tileId)) continue;
      if (rawTileKey === null) {
        this.guobiaoSelfTileFaceCache.delete(tileId);
        continue;
      }
      const tileKey = Math.trunc(Number(rawTileKey));
      if (!Number.isFinite(tileKey)) continue;
      const thing = this.things.get(tileId) ?? null;
      if (thing && this.isViewerSelfHandTile(thing)) {
        this.guobiaoSelfTileFaceCache.set(tileId, tileKey);
      }
    }
  }

  private isViewerSelfHandTile(thing: Thing): boolean {
    if (this.layoutMode !== 'mobileHand') return false;
    const viewerSeat = this.seat;
    if (viewerSeat === null) return false;
    if (thing.type !== ThingType.TILE) return false;
    const slot = thing.slot;
    return slot.group === 'hand' && slot.seat === viewerSeat;
  }

  private pruneGuobiaoSelfTileFaceCache(): void {
    if (this.guobiaoSelfTileFaceCache.size === 0) return;
    if (this.conditions.gameType !== GameType.GUOBIAO) {
      this.guobiaoSelfTileFaceCache.clear();
      return;
    }
    for (const tileId of Array.from(this.guobiaoSelfTileFaceCache.keys())) {
      const thing = this.things.get(tileId) ?? null;
      if (!thing || !this.isViewerSelfHandTile(thing)) {
        this.guobiaoSelfTileFaceCache.delete(tileId);
      }
    }
  }

  private applyTileFacesFull(): void {
    const tileIds: Array<number> = [];
    for (const thing of this.things.values()) {
      if (thing.type !== ThingType.TILE) continue;
      tileIds.push(thing.index);
    }
    this.applyTileFaces(tileIds);
  }

  private applyTileFaces(tileIds: Array<number>): void {
    const back = Number.isFinite(this.conditions.back) ? Math.trunc(this.conditions.back) : 0;
    // Keep hidden tiles mapped outside the active rule tile-key space so sort/selection logic treats them as unknown.
    // Blood cannot use 34-36 because those are red-five aliases; Guobiao cannot use 27-33 because those are honors.
    const hiddenTypeIndex = this.conditions.gameType === GameType.GUOBIAO
      ? 34 + 37 * back
      : 31 + 37 * back;

    for (const tileId of tileIds) {
      const thing = this.things.get(tileId);
      if (!thing || thing.type !== ThingType.TILE) continue;

      const cachedGuobiaoSelfKey =
        this.conditions.gameType === GameType.GUOBIAO && this.isViewerSelfHandTile(thing)
          ? (this.guobiaoSelfTileFaceCache.get(tileId) ?? null)
          : null;
      const tileKey = this.client.tileFacePublic.get(tileId) ?? this.client.tileFaceSelf.get(tileId) ?? cachedGuobiaoSelfKey;
      const desired = tileKey !== null
        ? (this.conditions.gameType === GameType.GUOBIAO
          ? guobiaoTileTypeIndex(Math.trunc(tileKey), back)
          : Math.trunc(tileKey) + 37 * back)
        : hiddenTypeIndex;
      if (thing.typeIndex === desired) continue;

      thing.typeIndex = desired;
      this.objectView.setTileTypeIndex?.(tileId, desired);
    }
  }

  private onDice(): void {
    const diceInfo = this.client.dice.get(0);
    if (!diceInfo) {
      return;
    }

    this.objectView;
  }

  updateConditions(conditions: Conditions, replacePoints: boolean = false): void {
    const normalized = this.normalizeIncomingConditions(conditions);
    this.conditions = normalized;
    this.objectView.setGuobiaoTileAtlas?.(normalized.gameType === GameType.GUOBIAO);
    this.setup.replace(normalized, replacePoints);
    if (this.layoutMode === 'mobileHand') {
      // replace() 会重建 slots，需重新应用移动端布局；但必须在 seat 已知后才能按“相对左右”生效
      this.mobileLayoutSeat = null;
      if (this.seat !== null) {
        applyMobileHandLayout(this.slots, this.seat);
        this.mobileLayoutSeat = this.seat;
        this.mobileLayoutVersion++;
      }
    }
    this.setupView();
  }

  private sendUpdate(full?: boolean): void {
    const entries: Array<[number, ThingInfo | null]> = [];
    if (full) {
      for (const thing of this.things.values()) {
        entries.push([thing.index, this.describeThing(thing)]);
        thing.sent = true;
      }
      for (const [index,] of this.client.things.entries()) {
        if (!this.things.has(index)) {
          entries.push([index, null]);
        }
      }
      this.client.things.update(entries);
    } else {
      for (const thing of this.things.values()) {
        if (!thing.sent) {
          const desc = this.describeThing(thing);
          if (JSON.stringify(desc) !== JSON.stringify(this.client.things.get(thing.index))) {
            entries.push([thing.index, desc]);
          }
          thing.sent = true;
        }
      }
      if (entries.length > 0) {
        this.client.things.update(entries);
      }
    }
  }

  private sendMouse(): void {
    if (this.seat !== null) {
      this.mouseTracker.update(this.mouse, this.heldMouse);
    }
  }

  private describeThing(thing: Thing): ThingInfo {
    return {
      slotName: thing.slot.name,
      rotationIndex: thing.rotationIndex,
      claimedBy: thing.claimedBy,
      heldRotation:
        {
          x: thing.heldRotation.x,
          y: thing.heldRotation.y,
          z: thing.heldRotation.z,
          w: thing.heldRotation.w,
      },
      shiftSlotName: thing.shiftSlot?.name ?? null,
    };
  }

  deal(dealType: DealType, gameType: GameType, fives: Fives, points: Points): void {
    if (this.seat === null) {
      return;
    }

    for (const thing of this.things.values()) {
      thing.release();
    }
    this.selected.splice(0);
    this.checkPushes();

    const back = 1 - this.conditions.back;
    const conditions = { ...this.conditions, back, gameType, fives, points, dealType };

    let match = this.client.match.get(0);
    let honba;
    if (!match || match.dealer !== this.seat) {
      honba = 0;
    } else if (dealType === DealType.HANDS) {
      honba = (match.honba + 1) % 8;
    } else {
      honba = match.honba;
    }

    match = {dealer: this.seat, honba, conditions};

    this.updateConditions(conditions);
    const dice = this.setup.deal(this.seat);
    const diceInfo: DiceInfo = {dice, state: this.setup.usesDice() ? 'rolled': 'ignore'};

    this.client.transaction(() => {
      this.client.match.set(0, match!);
      this.client.dice.set(0, diceInfo);
      this.sendUpdate(true);
    });
  }

  resetPoints(points: Points): void {
    for (const thing of this.things.values()) {
      thing.release();
    }
    this.selected.splice(0);
    this.checkPushes();

    const conditions = { ...this.conditions, points };
    this.updateConditions(conditions, true);

    let match = this.client.match.get(0)!;
    match = { ...match, conditions };

    this.client.transaction(() => {
      this.client.match.set(0, match);
      this.sendUpdate(true);
    });
  }

  private isHolding(): boolean {
    if (this.seat === null) {
      return false;
    }

    for (const thing of this.things.values()) {
      if (thing.claimedBy === this.seat) {
        return true;
      }
    }
    return false;
  }

  onHover(id: any): void {
    if (this.aiHosted) {
      this.hovered = null;
      return;
    }
    if (!this.isHolding()) {
      this.hovered = id === null ? null : this.things.get(id as number)!;

      if (this.hovered !== null && !this.canSelect(this.hovered, [])) {
        this.hovered = null;
      }
    }
  }

  onSelect(ids: Array<any>): void {
    if (this.aiHosted && Array.isArray(ids) && ids.length > 0) {
      return;
    }
    this.selected = ids.map(id => this.things.get(id as number)!);
    this.selected = this.selected.filter(
      thing => this.canSelect(thing, this.selected));

    if (this.selected.length === 0) {
      return;
    }

    this.selected = filterMostCommon(this.selected, thing => thing.slot.group + '@' + thing.slot.seat);
  }

  isSelected(id: number): boolean {
    return this.selected.some(thing => thing.index === id);
  }

  getSelectedThingIds(): Array<number> {
    return this.selected.map((t) => t.index);
  }

  onMove(mouse: Vector3 | null): void {
    if (this.aiHosted && mouse !== null) {
      return;
    }
    if ((this.mouse === null && mouse === null) ||
        (this.mouse !== null && mouse !== null && this.mouse.equals(mouse))) {
      return;
    }

    this.mouse = mouse;
    this.sendMouse();

    this.drag();
    this.sendUpdate();
  }

  private drag(): void {
    if (this.mouse === null || this.heldMouse === null) {
      return;
    }

    this.movement = new Movement();

    const held: Array<Thing> = [];

    for (const thing of this.things.values()) {
      if (thing.claimedBy === this.seat) {
        if (thing.shiftSlot !== null) {
          thing.release();
        } else {
          held.push(thing);
        }
      }
    }
    // this.things.filter(thing => thing.claimedBy === this.seat);
    held.sort((a, b) => compareZYX(a.slot.origin, b.slot.origin));

    for (let i = 0; i < held.length; i++) {
      const thing = held[i];
      const place = thing.place();
      const x = place.position.x + this.mouse.x - this.heldMouse.x;
      const y = place.position.y + this.mouse.y - this.heldMouse.y;

      const targetSlot = this.findSlot(x, y, place.size.x, place.size.y, thing);
      if (targetSlot === null) {
        this.movement = null;
        return;
      }
      this.movement.move(thing, targetSlot);
    }

    const relevantThings = [...this.things.values()].filter(thing =>
      thing.type === held[0].type
    );
    if (!this.movement.findShift(relevantThings, [
      slot => slot.links.shiftLeft ?? null,
      slot => slot.links.shiftRight ?? null,
    ])) {
      this.movement = null;
      return;
    }
    this.movement.rotateHeld();
    this.movement.applyShift(this.seat!);
  }

  private canSelect(thing: Thing, otherSelected: Array<Thing>): boolean {
    const upSlot = thing.slot.links.up;
    if (upSlot && upSlot.thing !== null) {
      if (otherSelected.indexOf(upSlot.thing) !== -1) {
        // the player is also selecting the tile above, let them pick it up
        return true;
      }
      if (upSlot.thing.claimedBy !== null) {
        // someone else is holding this tile
        return true;
      }
      return false;
    }
    return true;
  }

  private isBloodMobile(): boolean {
    return this.layoutMode === 'mobileHand' && this.conditions.gameType === GameType.BLOOD_BATTLE;
  }

  private isGuobiaoMobile(): boolean {
    return this.layoutMode === 'mobileHand' && this.conditions.gameType === GameType.GUOBIAO;
  }

  private isSortedMobileHand(): boolean {
    return this.isBloodMobile() || this.isGuobiaoMobile();
  }

  private normalizeIncomingConditions(conditions: Conditions): Conditions {
    if (this.layoutMode === 'mobileHand' && conditions.gameType === GameType.BLOOD_BATTLE && conditions.back !== 0) {
      return { ...conditions, back: 0 };
    }
    if (this.layoutMode === 'mobileHand' && conditions.gameType === GameType.GUOBIAO && conditions.back !== 0) {
      return { ...conditions, back: 0 };
    }
    return conditions;
  }

  private computeMobileSelfHandSortedPlaces(viewerSeat: number, rotationIndex: number = 0): Map<number, Place> {
    const dingque =
      this.isBloodMobile()
        ? (this.client.blood.get(0)?.players?.[viewerSeat]?.dingque ?? null) as BloodSuit | null
        : null;

    const handTiles: Array<Thing> = [];
    for (const thing of this.things.values()) {
      if (thing.type !== ThingType.TILE) continue;
      const slot = thing.slot;
      if (slot.group !== 'hand' || slot.seat !== viewerSeat) continue;
      // hand.extra 作为“摸牌位”保持独立显示（等价于 chainjong 的 justDrawn 永远在最右）。
      if (slot.name.startsWith('hand.extra')) continue;
      handTiles.push(thing);
    }

    handTiles.sort((a, b) => {
      const ka = this.conditions.gameType === GameType.GUOBIAO
        ? guobiaoTileKeyFromTypeIndex(a.typeIndex)
        : tileKeyFromTypeIndex(a.typeIndex);
      const kb = this.conditions.gameType === GameType.GUOBIAO
        ? guobiaoTileKeyFromTypeIndex(b.typeIndex)
        : tileKeyFromTypeIndex(b.typeIndex);

      // 明牌尚未同步时放到最后并保持稳定。
      if (ka === null || kb === null) {
        if (ka === null && kb !== null) return 1;
        if (kb === null && ka !== null) return -1;
        return a.index - b.index;
      }

      // 定缺后：缺门花色永远放到最右侧（与 chainjong 一致）。
      if (dingque) {
        const aDef = suitOf(ka) === dingque;
        const bDef = suitOf(kb) === dingque;
        if (aDef !== bDef) return aDef ? 1 : -1;
      }

      // 血战：万/筒/条 + 点数；国标：万/筒/条/风/箭/花。
      const sa = this.conditions.gameType === GameType.GUOBIAO ? guobiaoTileSortKey(ka) : ka;
      const sb = this.conditions.gameType === GameType.GUOBIAO ? guobiaoTileSortKey(kb) : kb;
      if (sa !== sb) return sa - sb;
      return a.index - b.index;
    });

    const result = new Map<number, Place>();
    for (let i = 0; i < handTiles.length && i < 14; i++) {
      const target = this.slots.get(`hand.${i}@${viewerSeat}`);
      if (!target) continue;
      result.set(handTiles[i].index, target.placeWithOffset(rotationIndex));
    }
    return result;
  }

  getMobileSelfHandDisplayPlace(tileId: number): Place | null {
    if (!this.isSortedMobileHand()) {
      return null;
    }
    const viewerSeat = this.seat;
    if (viewerSeat === null) {
      return null;
    }
    const thing = this.things.get(tileId) ?? null;
    if (!thing || thing.type !== ThingType.TILE) {
      return null;
    }
    const slot = thing.slot;
    if (slot.group !== 'hand' || slot.seat !== viewerSeat) {
      return null;
    }
    const sorted = this.computeMobileSelfHandSortedPlaces(viewerSeat).get(tileId);
    if (sorted) {
      return sorted;
    }
    return slot.placeWithOffset(0);
  }

  private computeMobileOpponentHandPackedPlaces(
    viewerSeat: number,
    handRotationIndexForSeat: (seat: number) => number = () => 0,
  ): Map<number, Place> {
    const result = new Map<number, Place>();

    for (let seat = 0; seat < 4; seat++) {
      if (seat === viewerSeat) {
        continue;
      }

      const rotIndex = handRotationIndexForSeat(seat);
      const mainTiles: Array<Thing> = [];
      let extra: Thing | null = null;

      for (const thing of this.things.values()) {
        if (thing.type !== ThingType.TILE) continue;
        const slot = thing.slot;
        if (slot.group !== 'hand' || slot.seat !== seat) continue;
        if (slot.name === `hand.extra@${seat}`) {
          extra = thing;
          continue;
        }
        mainTiles.push(thing);
      }

      // 对手手牌是背面信息：顺序不重要，但要稳定（避免抖动/闪烁）。
      mainTiles.sort((a, b) => {
        const ia = a.slot.indexes[0] ?? 0;
        const ib = b.slot.indexes[0] ?? 0;
        if (ia !== ib) return ia - ib;
        return a.index - b.index;
      });

      // 把对手手牌“按数量打包”到连续的 hand.0..hand.n-1（不改服务器 slotName）。
      for (let i = 0; i < mainTiles.length && i < 14; i++) {
        const target = this.slots.get(`hand.${i}@${seat}`) ?? null;
        if (!target) continue;
        result.set(mainTiles[i].index, target.placeWithOffset(rotIndex));
      }

      // 摸牌位（hand.extra）保持独立显示（仍是背面），但也跟随我们移动端布局的位置。
      if (extra) {
        const targetExtra = this.slots.get(`hand.extra@${seat}`) ?? null;
        if (targetExtra) {
          result.set(extra.index, targetExtra.placeWithOffset(rotIndex));
        }
      }
    }

    return result;
  }

  private getSeatInnerDisplayBases(): Array<SeatInnerDisplayBase | null> {
    const bases: Array<SeatInnerDisplayBase | null> = [null, null, null, null];

    // 座位内侧展示区固定位置（红框）：由“弃牌区中间一行”的交点确定。
    // 规则（按屏幕方向）：
    // - 左上：上 × 左
    // - 左下：下 × 左
    // - 右上：上 × 右
    // - 右下：下 × 右
    //
    // 注意：/hand/ 会把视角旋转到“viewerSeat 在屏幕下方”，因此这里必须基于 viewerSeat 做相对映射。
    const viewerSeat = this.seat !== null ? ((this.seat % 4) + 4) % 4 : 0;
    const bottomSeat = viewerSeat;
    const rightSeat = (viewerSeat + 1) % 4;
    const topSeat = (viewerSeat + 2) % 4;
    const leftSeat = (viewerSeat + 3) % 4;

    type Line2 = { x0: number; y0: number; x1: number; y1: number; z: number };
    const getDiscardMidRowLine = (seat: number): Line2 | null => {
      // discard: 6×3，row=0/1/2；“中间一行”取 row=1。
      // 用两端点构造直线，避免依赖“seat0/2 用 y、seat1/3 用 x”的假设（对相机旋转/布局更稳健）。
      const slot0 = this.slots.get(`discard.1.0@${seat}`) ?? null;
      const slot5 = this.slots.get(`discard.1.5@${seat}`) ?? null;
      if (!slot0 || !slot5) return null;
      // 重要：用“无 offset 的基准 place”，避免 discard 的 push/shift 导致直线漂移（红框应稳定）。
      const rot = slot0.thing?.rotationIndex ?? slot5.thing?.rotationIndex ?? 0;
      const idx0 = Math.max(0, Math.min(rot, slot0.places.length - 1));
      const idx5 = Math.max(0, Math.min(rot, slot5.places.length - 1));
      const p0 = slot0.places[idx0]?.position;
      const p1 = slot5.places[idx5]?.position;
      if (!p0 || !p1) return null;
      return { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y, z: Math.max(p0.z, p1.z) };
    };

    const getDiscardMidColPoint = (seat: number): Vector3 | null => {
      // 需求：胡字标识对齐弃牌区 6 张一行的“第3/4张中线”。
      // 这里选用固定槽位（row=1, col=2/3）的基准位置（无 offset），保证稳定不随 push/shift 漂移。
      const slot2 = this.slots.get(`discard.1.2@${seat}`) ?? null;
      const slot3 = this.slots.get(`discard.1.3@${seat}`) ?? null;
      if (!slot2 || !slot3) return null;
      const rot = slot2.thing?.rotationIndex ?? slot3.thing?.rotationIndex ?? 0;
      const idx2 = Math.max(0, Math.min(rot, slot2.places.length - 1));
      const idx3 = Math.max(0, Math.min(rot, slot3.places.length - 1));
      const p2 = slot2.places[idx2]?.position;
      const p3 = slot3.places[idx3]?.position;
      if (!p2 || !p3) return null;
      return new Vector3((p2.x + p3.x) * 0.5, (p2.y + p3.y) * 0.5, Math.max(p2.z, p3.z));
    };

    const intersect2d = (a: Line2 | null, b: Line2 | null): Vector3 | null => {
      if (!a || !b) return null;
      const ax = a.x1 - a.x0;
      const ay = a.y1 - a.y0;
      const bx = b.x1 - b.x0;
      const by = b.y1 - b.y0;
      const denom = ax * by - ay * bx;
      if (!Number.isFinite(denom) || Math.abs(denom) < 1e-6) return null;
      const cx = b.x0 - a.x0;
      const cy = b.y0 - a.y0;
      const t = (cx * by - cy * bx) / denom;
      if (!Number.isFinite(t)) return null;
      const x = a.x0 + t * ax;
      const y = a.y0 + t * ay;
      const z = Math.max(a.z, b.z);
      return new Vector3(x, y, z);
    };

    const lineBottom = getDiscardMidRowLine(bottomSeat);
    const lineTop = getDiscardMidRowLine(topSeat);
    const lineLeft = getDiscardMidRowLine(leftSeat);
    const lineRight = getDiscardMidRowLine(rightSeat);

    // rel=0..3：下/右/上/左（屏幕方向）
    const anchorsByRel: Array<Vector3 | null> = [
      intersect2d(lineBottom, lineRight), // 右下：下玩家
      intersect2d(lineTop, lineRight), // 右上：右玩家
      intersect2d(lineTop, lineLeft), // 左上：上玩家
      intersect2d(lineBottom, lineLeft), // 左下：左玩家
    ];

    // “红线（table/hand 分界）”本质是屏幕概念，但我们选用 world-unit 策略：
    // 把胡牌锚点沿胡家所在边方向外推固定距离，让底边更靠近红线/手牌条。
    const huOutwardShift = HU_OVERLAY_OUTWARD_SHIFT;

    // 胡牌展示需要落在“红框交点”里（红框按桌面弃牌的 FACE_UP 尺寸绘制）：
    // - 位置：使用交点的 x/y/z（弃牌中心点的 z=2），这样投影与红框一致（避免因抬高 z 引起透视偏移）
    // - 朝向：必须与“胡家在当前视角下的弃牌/副露单牌朝向”一致（不同 viewerSeat 下会不同）。
    //   取法：优先用该 seat 现有弃牌/副露里“最常见的 face-up rotationIndex(0/1)”对应的 place.rotation；
    //   若还没有公开牌，则回退到该 seat 的 discard 槽位 FACE_UP(0) 旋转（稳定）。
    const isFaceUpRotationIndex = (rot: number): boolean => rot === 0 || rot === 1;
    const pickMostCommonFaceUpRotation = (things: Array<Thing>): Quaternion | null => {
      const candidates = things.filter((t) => isFaceUpRotationIndex(t.rotationIndex));
      const rot = mostCommon(candidates, (t) => t.rotationIndex);
      if (rot === null) return null;
      const sample = candidates.find((t) => t.rotationIndex === rot) ?? candidates[0] ?? null;
      return sample ? sample.place().rotation.clone() : null;
    };
    const getSeatFaceUpRotation = (seat: number): Quaternion => {
      const discardTiles: Array<Thing> = [];
      const meldTiles: Array<Thing> = [];
      for (const thing of this.things.values()) {
        if (thing.type !== ThingType.TILE) continue;
        const slot = thing.slot;
        if (slot.seat !== seat) continue;
        if (slot.group === 'discard') discardTiles.push(thing);
        else if (slot.group === 'meld') meldTiles.push(thing);
      }
      return (
        pickMostCommonFaceUpRotation(discardTiles) ??
        pickMostCommonFaceUpRotation(meldTiles) ??
        this.slots.get(`discard.0.0@${seat}`)?.places?.[0]?.rotation?.clone() ??
        new Quaternion()
      );
    };

    for (let seat = 0; seat < 4; seat++) {
      const rel = ((seat - viewerSeat) % 4 + 4) % 4;
      const anchor = anchorsByRel[rel] ?? null;
      if (!anchor) continue;
      // XY 用“红框交点”；Z 用交点的基准 z（与红框一致）
      const position = new Vector3(anchor.x, anchor.y, anchor.z);
      const dir = HU_OVERLAY_OUTWARD_DIR[seat];
      position.x += dir.x * huOutwardShift;
      position.y += dir.y * huOutwardShift;
      const rotation = getSeatFaceUpRotation(seat);

      const badgeBase = getDiscardMidColPoint(seat);
      const badgePosition = badgeBase ? badgeBase.clone() : new Vector3(anchor.x, anchor.y, anchor.z);
      // 胡字标识也往“胡家所在边”靠一点（更接近红线/手牌条，视觉更聚焦）。
      badgePosition.x += dir.x * huOutwardShift;
      badgePosition.y += dir.y * huOutwardShift;
      badgePosition.z += 0.03;

      bases[seat] = {
        position,
        rotation,
        badgePosition,
        badgeRotation: rotation,
      };
    }

    return bases;
  }

  getBloodMobileHuOverlays(state: BloodState): Array<BloodHuOverlayRender | null> {
    const overlays: Array<BloodHuOverlayRender | null> = [null, null, null, null];
    const bases = this.getSeatInnerDisplayBases();

    for (let seat = 0; seat < 4; seat++) {
      const ps = state.players?.[seat] ?? null;
      if (!ps || !ps.hu || ps.huTileKey === null) {
        continue;
      }
      const base = bases[seat] ?? null;
      if (!base) continue;

      overlays[seat] = {
        tileKey: ps.huTileKey,
        position: base.position.clone(),
        rotation: base.rotation.clone(),
        // 胡牌展示属于“桌面公共信息”，统一放在主桌面层（layer=0），避免被手牌视口裁切。
        layer: 0,
        badgePosition: base.badgePosition.clone(),
        badgeRotation: base.badgeRotation.clone(),
      };
    }

    return overlays;
  }

  private getGuobiaoHuBadgeOverlays(state: GuobiaoState): Array<BloodHuOverlayRender | null> {
    const overlays: Array<BloodHuOverlayRender | null> = [null, null, null, null];
    const bases = this.getSeatInnerDisplayBases();

    for (let seat = 0; seat < 4; seat++) {
      const ps = state.players?.[seat] ?? null;
      const huTileKey = ps?.hu && Number.isFinite(ps.huTileKey) ? Math.trunc(ps.huTileKey as number) : null;
      if (huTileKey === null) continue;
      const base = bases[seat] ?? null;
      if (!base) continue;

      overlays[seat] = {
        tileKey: huTileKey,
        position: base.position.clone(),
        rotation: base.rotation.clone(),
        layer: 0,
        badgePosition: base.badgePosition.clone(),
        badgeRotation: base.badgeRotation.clone(),
        hideTile: true,
      };
    }

    return overlays;
  }

  private getGuobiaoSeatInnerDisplayOverlays(state: GuobiaoState): Array<GuobiaoSeatInnerDisplayTileRender> {
    const bases = this.getSeatInnerDisplayBases();

    const viewerSeat = this.seat !== null ? ((this.seat % 4) + 4) % 4 : 0;
    const tileScale = 0.78;
    const huScale = 0.82;
    const tileStep = Size.TILE.x * 0.84;
    const rowStep = Size.TILE.y * 0.78;
    const overlays: Array<GuobiaoSeatInnerDisplayTileRender> = [];

    for (let seat = 0; seat < 4; seat++) {
      const ps = state.players?.[seat] ?? null;
      if (!ps) continue;
      const base = bases[seat] ?? null;
      if (!base) continue;

      const rel = ((seat - viewerSeat) % 4 + 4) % 4;
      const along = this.guobiaoViewerRelativeVector(viewerSeat, GUOBIAO_INNER_DISPLAY_CANONICAL_ALONG[rel]!);
      const row = this.guobiaoViewerRelativeVector(viewerSeat, GUOBIAO_INNER_DISPLAY_CANONICAL_OUTWARD[rel]!);
      const rotation = base.rotation.clone();
      const basePosition = base.position.clone();
      basePosition.z += 0.16;

      const flowers = (ps.flowers ?? [])
        .map((value) => Math.trunc(Number(value)))
        .filter((tileKey) => Number.isFinite(tileKey) && tileKey >= GUOBIAO_NON_FLOWER_TILE_COUNT && tileKey < GUOBIAO_NON_FLOWER_TILE_COUNT + 8)
        .slice(0, 8);

      const seatOverlays: Array<GuobiaoSeatInnerDisplayTileRender> = [];
      for (let i = 0; i < flowers.length; i++) {
        const col = i % 4;
        const rowIndex = Math.floor(i / 4);
        const position = basePosition.clone()
          .addScaledVector(along, (col - 1.5) * tileStep)
          .addScaledVector(row, (0.5 - rowIndex) * rowStep);
        position.z += i * 0.01;
        seatOverlays.push({
          tileKey: flowers[i]!,
          position,
          rotation,
          layer: 0,
          scale: tileScale,
        });
      }

      const huTileKey = ps.hu ? (Number.isFinite(ps.huTileKey) ? Math.trunc(ps.huTileKey as number) : null) : null;
      if (huTileKey !== null) {
        const huPosition = basePosition.clone();
        huPosition.z += Size.TILE.z + 0.35;
        seatOverlays.push({
          tileKey: huTileKey,
          position: huPosition,
          rotation,
          layer: 0,
          scale: huScale,
        });
      }

      this.keepGuobiaoInnerDisplayInsideTable(rel, row, seatOverlays);
      overlays.push(...seatOverlays);
    }

    return overlays;
  }

  private guobiaoViewerRelativeVector(viewerSeat: number, vector: Vector3): Vector3 {
    return vector.clone().applyAxisAngle(WORLD_Z_AXIS, viewerSeat * Math.PI * 0.5);
  }

  private keepGuobiaoInnerDisplayInsideTable(
    rel: number,
    outward: Vector3,
    overlays: Array<GuobiaoSeatInnerDisplayTileRender>,
  ): void {
    if (overlays.length === 0) return;
    const boundaryDot = this.guobiaoInnerDisplayOuterBoundaryDot(rel, outward);
    if (boundaryDot === null) return;

    const targetOuterDot = boundaryDot - GUOBIAO_INNER_DISPLAY_SAFE_MARGIN;
    let overflow = 0;
    for (const item of overlays) {
      const halfSpan = Size.TILE.y * item.scale * 0.5;
      const outerDot = item.position.dot(outward) + halfSpan;
      overflow = Math.max(overflow, outerDot - targetOuterDot);
    }
    if (overflow <= 0) return;

    for (const item of overlays) {
      item.position.addScaledVector(outward, -overflow);
    }
  }

  private getGuobiaoConcealedGangRows(state: GuobiaoState | null): Set<string> {
    const rows = new Set<string>();
    if (!state) return rows;
    for (let seat = 0; seat < 4; seat++) {
      for (const meld of state.players?.[seat]?.melds ?? []) {
        if (meld.kind === 'flower') continue;
        if (meld.kind !== 'anGang' && meld.concealed !== true) continue;
        const row = Math.trunc(Number(meld.row));
        if (Number.isFinite(row)) rows.add(`${seat}:${row}`);
      }
    }
    return rows;
  }

  private guobiaoForcedConcealedGangRotationIndex(slot: Slot, concealedGangRows: Set<string>, revealAll: boolean): number | null {
    if (concealedGangRows.size === 0 || slot.group !== 'meld' || slot.seat === null) return null;
    const row = slot.indexes[0];
    if (!Number.isFinite(row)) return null;
    return concealedGangRows.has(`${slot.seat}:${row}`) ? (revealAll ? 0 : 2) : null;
  }

  private guobiaoInnerDisplayOuterBoundaryDot(rel: number, outward: Vector3): number | null {
    const canonicalOutward = GUOBIAO_INNER_DISPLAY_CANONICAL_OUTWARD[rel] ?? null;
    if (!canonicalOutward) return null;

    let canonicalBoundaryDot: number | null = null;
    if (rel === 0) canonicalBoundaryDot = -GUOBIAO_INNER_DISPLAY_BOTTOM_BOUND_Y;
    else if (rel === 1) canonicalBoundaryDot = GUOBIAO_INNER_DISPLAY_SIDE_BOUND_MAX;
    else if (rel === 2) canonicalBoundaryDot = GUOBIAO_INNER_DISPLAY_SIDE_BOUND_MAX;
    else if (rel === 3) canonicalBoundaryDot = -GUOBIAO_INNER_DISPLAY_SIDE_BOUND_MIN;
    if (canonicalBoundaryDot === null) return null;

    return canonicalBoundaryDot
      - canonicalOutward.dot(WORLD_CENTER_VECTOR)
      + outward.dot(WORLD_CENTER_VECTOR);
  }

  // 临时调试：测量当前手牌/副露/marker 与弃牌之间的间距（世界单位）。
  measureHandDiscardGap(seat: number): number | null {
    const discardSlots = [...this.slots.values()].filter(
      (s) => s.seat === seat && s.group === 'discard' && !s.name.startsWith('discard.stack')
    );
    if (discardSlots.length === 0) return null;

    const discardEdge = computeDiscardEdge(discardSlots, seat);
    const handEdge = computeHandMeldMarkerEdge(this.slots, seat);
    if (discardEdge === null || handEdge === null) return null;

    const gap = (seat === 0 || seat === 3) ? (discardEdge - handEdge) : (handEdge - discardEdge);
    return gap;
  }

  /**
   * 屏幕空间对齐：让四家的“手牌/副露/marker ↔ 弃牌”在屏幕上看到的像素间隙一致。
   * - 使用当前桌面相机 + 桌面 viewport，把 hand/discard 边投影到屏幕，按平均像素间隙对齐。
   * - 仅移动 hand/meld/marker（保持弃牌贴中心盘），不会向外扩展取景。
   */
	  alignHandDiscardScreenGaps(
	    camera: Camera | null,
	    viewport: { left: number; top: number; width: number; height: number },
	  ): void {
	    if (this.layoutMode !== 'mobileHand') return;
	    if (!camera || viewport.width <= 0 || viewport.height <= 0) return;
	    let changed = false;

    type Rect = { minX: number; maxX: number; minY: number; maxY: number };
    const projectToPixel = (p: Vector3): { x: number; y: number } => {
      const ndc = p.clone().project(camera);
      return {
        x: ((ndc.x + 1) * 0.5) * viewport.width + viewport.left,
        y: ((1 - ndc.y) * 0.5) * viewport.height + viewport.top,
      };
    };

    const computeRect = (groups: Array<string>, seat: number, requireThing = false): Rect | null => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const slot of this.slots.values()) {
        if (slot.seat !== seat) continue;
        if (!groups.includes(slot.group)) continue;
        if (requireThing && !slot.thing) continue;
        const rotationIndex = slot.group === 'hand'
          ? 0
          : Math.max(0, Math.min(slot.thing?.rotationIndex ?? 0, slot.places.length - 1));
        const place = slot.placeWithOffset(rotationIndex);
        minX = Math.min(minX, place.position.x - place.size.x * 0.5);
        maxX = Math.max(maxX, place.position.x + place.size.x * 0.5);
        minY = Math.min(minY, place.position.y - place.size.y * 0.5);
        maxY = Math.max(maxY, place.position.y + place.size.y * 0.5);
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        return null;
      }
      return { minX, maxX, minY, maxY };
    };

    const screenGaps: Array<number | null> = [null, null, null, null];
    const seatMeta: Array<{
      seat: number;
      handEdge: number;
      discardEdge: number;
      rect: Rect | null;
      discardRect: Rect | null;
      worldPerPixel: number;
      gapPx: number;
    }> = [];

    for (let seat = 0; seat < 4; seat++) {
      const discardSlots = [...this.slots.values()].filter(
        (s) => s.seat === seat && s.group === 'discard' && !s.name.startsWith('discard.stack')
      );
      if (discardSlots.length === 0) continue;
      const discardEdge = computeDiscardEdge(discardSlots, seat);
      const handEdge = computeHandMeldMarkerEdge(this.slots, seat);
      if (discardEdge === null || handEdge === null) continue;

      const rect = computeRect(['hand', 'meld', 'marker'], seat);
      const discardRect = computeRect(['discard'], seat);
      if (!rect || !discardRect) continue;

      // 选择与该边平行的“横坐标/纵坐标”采样点：取 hand+discard 中心的平均值，避免在边缘处投影误差大。
      const sampleX = (rect.minX + rect.maxX + discardRect.minX + discardRect.maxX) * 0.25;
      const sampleY = (rect.minY + rect.maxY + discardRect.minY + discardRect.maxY) * 0.25;
      const axis: 'x' | 'y' = (seat === 0 || seat === 2) ? 'y' : 'x';

      // 计算屏幕像素 gap
      const handPoint = axis === 'y' ? new Vector3(sampleX, handEdge, 0) : new Vector3(handEdge, sampleY, 0);
      const discardPoint = axis === 'y' ? new Vector3(sampleX, discardEdge, 0) : new Vector3(discardEdge, sampleY, 0);
      const pHand = projectToPixel(handPoint);
      const pDiscard = projectToPixel(discardPoint);
      const gapPx = axis === 'y'
        ? Math.abs(pDiscard.y - pHand.y)
        : Math.abs(pDiscard.x - pHand.x);
      screenGaps[seat] = gapPx;

      // 估算“沿该轴 1 世界单位”对应的屏幕像素长度
      const unitPoint = axis === 'y'
        ? new Vector3(sampleX, handEdge + 1, 0)
        : new Vector3(handEdge + 1, sampleY, 0);
      const pUnit = projectToPixel(unitPoint);
      const unitPx = axis === 'y'
        ? Math.abs(pUnit.y - pHand.y)
        : Math.abs(pUnit.x - pHand.x);
      const worldPerPixel = unitPx > 1e-4 ? (1 / unitPx) : 0;

      seatMeta.push({ seat, handEdge, discardEdge, rect, discardRect, worldPerPixel, gapPx });
    }

    const validGaps = screenGaps.filter((g): g is number => Number.isFinite(g));
    if (validGaps.length === 0) {
      return;
    }
    // 目标像素间隙：取平均值，避免极端值；不扩张过度。
    const targetPx = validGaps.reduce((a, b) => a + b, 0) / validGaps.length;

	    for (const meta of seatMeta) {
	      if (meta.worldPerPixel <= 0) continue;
	      const deltaPx = targetPx - meta.gapPx;
	      if (Math.abs(deltaPx) <= 0.5) continue; // 小于半像素忽略抖动

      const sign = (meta.seat === 0 || meta.seat === 3) ? -1 : 1;
      const targetGapWorld = targetPx * meta.worldPerPixel;
      const targetHandEdge = meta.discardEdge + sign * targetGapWorld;
      const shift = targetHandEdge - meta.handEdge;
      if (!Number.isFinite(shift) || Math.abs(shift) < 0.01) continue;

      const dx =
        meta.seat === 1 ? shift :
        meta.seat === 3 ? shift :
        0;
	      const dy =
	        meta.seat === 0 ? shift :
	        meta.seat === 2 ? shift :
	        0;

	      for (const slot of this.slots.values()) {
	        if (slot.seat !== meta.seat) continue;
	        if (slot.group !== 'hand' && slot.group !== 'meld' && slot.group !== 'marker') continue;
	        slot.origin.x += dx;
	        slot.origin.y += dy;
	        slot.places = slot.rotations.map(slot.makePlace.bind(slot));
	        changed = true;
	      }
	    }
	
	    if (changed) {
	      // 保持 push/shift 等 slot.offset 逻辑仍然生效（避免副露/立直等产生重叠）。
	      this.checkPushes();
	      this.mobileLayoutVersion++;
	    }
	  }

  getBloodMobileHuZones(state: BloodState | null): Array<{ seat: number; corners: [Vector3, Vector3, Vector3, Vector3] } | null> {
    const zones: Array<{ seat: number; corners: [Vector3, Vector3, Vector3, Vector3] } | null> = [null, null, null, null];
    if (!state) {
      return zones;
    }

    const computeDiscardZoneAabb = (seat: number): { minX: number; maxX: number; minY: number; maxY: number; z: number } | null => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let z = 0;

      for (const slot of this.slots.values()) {
        if (slot.group !== 'discard' || slot.seat !== seat) continue;
        if (!slot.name.startsWith('discard.')) continue;
        if (slot.name.startsWith('discard.stack')) continue;
        if (slot.name.startsWith('discard.extra')) continue;
        const p = slot.placeWithOffset(0);
        minX = Math.min(minX, p.position.x - p.size.x / 2);
        maxX = Math.max(maxX, p.position.x + p.size.x / 2);
        minY = Math.min(minY, p.position.y - p.size.y / 2);
        maxY = Math.max(maxY, p.position.y + p.size.y / 2);
        z = p.position.z;
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        return null;
      }
      return { minX, maxX, minY, maxY, z };
    };

    const computeGroupAabb = (
      seat: number,
      groups: Array<string>,
      requireThing = false,
    ): { minX: number; maxX: number; minY: number; maxY: number } | null => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (const slot of this.slots.values()) {
        if (slot.seat !== seat) continue;
        if (!groups.includes(slot.group)) continue;
        if (requireThing && !slot.thing) continue;

        let rotationIndex = 0;
        if (slot.group === 'hand') {
          rotationIndex = 0;
        } else if (slot.thing && slot.thing.rotationIndex !== null) {
          rotationIndex = slot.thing.rotationIndex;
        }
        rotationIndex = Math.max(0, Math.min(rotationIndex, slot.places.length - 1));
        const p = slot.placeWithOffset(rotationIndex);
        minX = Math.min(minX, p.position.x - p.size.x / 2);
        maxX = Math.max(maxX, p.position.x + p.size.x / 2);
        minY = Math.min(minY, p.position.y - p.size.y / 2);
        maxY = Math.max(maxY, p.position.y + p.size.y / 2);
      }

      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        return null;
      }
      return { minX, maxX, minY, maxY };
    };

    for (let seat = 0; seat < 4; seat++) {
      const nextSeat = (seat + 1) % 4;

      const discard = computeDiscardZoneAabb(seat);
      const discardNext = computeDiscardZoneAabb(nextSeat);
      if (!discard || !discardNext) continue;

      const hasMeld = state?.players?.[seat]?.melds?.length > 0;
      const hasMeldNext = state?.players?.[nextSeat]?.melds?.length > 0;
      const meldAabb = hasMeld ? computeGroupAabb(seat, ['meld'], true) : null;
      const handAabb = computeGroupAabb(seat, ['hand'], true);
      const anchor = meldAabb ?? handAabb ?? computeGroupAabb(seat, ['hand']);

      const meldAabbNext = hasMeldNext ? computeGroupAabb(nextSeat, ['meld'], true) : null;
      const handAabbNext = computeGroupAabb(nextSeat, ['hand'], true);
      const anchorNext = meldAabbNext ?? handAabbNext ?? computeGroupAabb(nextSeat, ['hand']);

      if (!anchor || !anchorNext) continue;

      const pad = Size.TILE.y * 0.25;
      const anchorBox = anchor;
      const anchorNextBox = anchorNext;

      // seat -> primary axis ('x' for seat0/2, 'y' for seat1/3)
      const primaryAxis = (s: number): 'x' | 'y' => (s === 1 || s === 3 ? 'y' : 'x');
      const orthAxis = (s: number): 'x' | 'y' => (primaryAxis(s) === 'x' ? 'y' : 'x');
      const ownAxis = orthAxis(seat);
      const nextAxis = orthAxis(nextSeat);

      const ownMin = ownAxis === 'x'
        ? Math.min(anchorBox.minX, discard.minX) + pad
        : Math.min(anchorBox.minY, discard.minY) + pad;
      const ownMax = ownAxis === 'x'
        ? Math.max(anchorBox.maxX, discard.maxX) - pad
        : Math.max(anchorBox.maxY, discard.maxY) - pad;

      const nextMin = nextAxis === 'x'
        ? Math.min(anchorNextBox.minX, discardNext.minX) + pad
        : Math.min(anchorNextBox.minY, discardNext.minY) + pad;
      const nextMax = nextAxis === 'x'
        ? Math.max(anchorNextBox.maxX, discardNext.maxX) - pad
        : Math.max(anchorNextBox.maxY, discardNext.maxY) - pad;

      if (!(ownMin < ownMax) || !(nextMin < nextMax)) continue;

      // 让胡牌区贴近“自家副露/手牌”这一侧：在 own 轴上收缩到以自家中心为主的带状区域
      const ownCenter = ownAxis === 'x'
        ? (anchorBox.minX + anchorBox.maxX) * 0.5
        : (anchorBox.minY + anchorBox.maxY) * 0.5;
      const ownSpan = ownMax - ownMin;
      const ownBandHalf = Math.min(ownSpan * 0.25, Size.TILE.y * 1.2);
      let ownBandMin = ownCenter - ownBandHalf;
      let ownBandMax = ownCenter + ownBandHalf;
      if (ownBandMin < ownMin) { ownBandMax += ownMin - ownBandMin; ownBandMin = ownMin; }
      if (ownBandMax > ownMax) { ownBandMin -= ownBandMax - ownMax; ownBandMax = ownMax; }
      if (!(ownBandMin < ownBandMax)) {
        ownBandMin = ownMin;
        ownBandMax = ownMax;
      }

      let minX: number, maxX: number, minY: number, maxY: number;
      if (ownAxis === 'y' && nextAxis === 'x') {
        minX = nextMin; maxX = nextMax;
        minY = ownBandMin; maxY = ownBandMax;
      } else if (ownAxis === 'x' && nextAxis === 'y') {
        minX = ownBandMin; maxX = ownBandMax;
        minY = nextMin; maxY = nextMax;
      } else {
        // fallback (should not happen)
        continue;
      }

      const z = discard.z;
      zones[seat] = {
        seat,
        corners: [
          new Vector3(minX, minY, z),
          new Vector3(maxX, minY, z),
          new Vector3(maxX, maxY, z),
          new Vector3(minX, maxY, z),
        ],
      };
    }

    return zones;
  }

  private canDropTileToSlot(thing: Thing, slot: Slot): boolean {
    if (!this.isSortedMobileHand()) {
      return true;
    }
    const viewerSeat = this.seat;
    if (viewerSeat === null) {
      return false;
    }
    if (thing.type !== ThingType.TILE) {
      return false;
    }

    // 移动端血战/国标：只允许整理自己的手牌；弃牌统一走“点两次确认”的 ACTION 路径。
    const fromOwnHand = thing.slot.group === 'hand' && thing.slot.seat === viewerSeat;
    if (!fromOwnHand) {
      return false;
    }

    if (slot.group === 'hand' && slot.seat === viewerSeat) {
      return true;
    }

    if (slot.group === 'discard' && slot.seat === viewerSeat) {
      // 移动端血战/国标：弃牌使用“点两次确认”（touch-ui.ts），不支持拖动到弃牌区。
      return false;
    }

    return false;
  }

  // 移动端：自家手牌“点两次确认”（touch-ui.ts），自动弃到自己弃牌区（不需要拖动）。
  // - 血战：需要满足回合/无 pending/无锁；权威模式会发送 discard action 并加本地锁，等待 ACK/回显。
  // - 非血战：仅在非权威模式下做本地移动（权威模式由服务端驱动更新，直接返回 false 以避免不同步）。
  // 返回 true 表示已成功发起/执行弃牌；false 表示当前不允许（例如不轮到自己 / pending 响应窗口 / 锁 / authoritative）。
  quickDiscard(tileId: number): boolean {
    if (this.aiHosted) {
      return false;
    }
    const viewerSeat = this.seat;
    if (viewerSeat === null) {
      return false;
    }

    const thing = this.things.get(tileId);
    if (!thing || thing.type !== ThingType.TILE) {
      return false;
    }
    const rawDiscardTileKey = this.conditions.gameType === GameType.GUOBIAO
      ? guobiaoTileKeyFromTypeIndex(thing.typeIndex)
      : tileKeyFromTypeIndex(thing.typeIndex);
    const maxDiscardTileKey = this.conditions.gameType === GameType.GUOBIAO ? GUOBIAO_NON_FLOWER_TILE_COUNT : 27;
    const discardTileKey = rawDiscardTileKey !== null && rawDiscardTileKey >= 0 && rawDiscardTileKey < maxDiscardTileKey
      ? rawDiscardTileKey
      : null;
    const from = thing.slot;
    if (from.group !== 'hand' || from.seat !== viewerSeat) {
      return false;
    }

    if (this.coachDiscardRule) {
      if (this.coachDiscardRule.allow === 'none') {
        return false;
      }
      if (this.coachDiscardRule.allow === 'only' && !this.coachDiscardRule.tileIds.has(tileId)) {
        return false;
      }
    }

    if (this.isBloodMobile() || this.isGuobiaoMobile()) {
      if (this.bloodDiscardLock) {
        return false;
      }

      const state = this.isGuobiaoMobile()
        ? (this.client.gb.get(0) as GuobiaoState | null)
        : this.client.blood.get(0);
      if (!state) {
        return false;
      }
      const canDiscardNow =
        state.phase === 'playing' &&
        state.pending === null &&
        state.turnSeat === viewerSeat &&
        state.turnStep === 'discard';
      if (!canDiscardNow) {
        return false;
      }

      if (this.client.isAuthoritative()) {
        const interactionAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
        const actionId = this.isGuobiaoMobile()
          ? this.client.sendGbAction({ kind: 'discard', tileId })
          : this.client.sendBloodAction({ kind: 'discard', tileId });
        if (!actionId) {
          return false;
        }
        this.client.markActionInteraction(actionId, interactionAt);
        this.setBloodDiscardLock({ tileId: thing.index, fromSlotName: from.name }, actionId);
        this.soundPlayer.play(SoundType.DISCARD, viewerSeat, discardTileKey);
        return true;
      }
    } else {
      // 非血战/非权威模式：允许“点两次确认”直接弃到自家弃牌区。
      // 权威模式下 things/match 等集合由服务端掌控（BaseClient 会过滤客户端 UPDATE），避免本地不同步。
      if (this.client.isAuthoritative()) {
        return false;
      }
    }

    const discardedFromExtra = from.name.startsWith('hand.extra');

    // 找到自己弃牌区下一个空槽（按 slotName 顺序填充，确保稳定一致）。
    const targets = [...this.slots.values()]
      .filter((s) =>
        s.group === 'discard' &&
        s.seat === viewerSeat &&
        s.type === ThingType.TILE &&
        s.thing === null &&
        // 与拖拽逻辑一致：需要满足 requires（例如 discard.extra / discard.stack 必须等第一层填满才可用）
        !(s.links.requires && s.links.requires.thing === null)
      )
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const target = targets[0] ?? null;
    if (!target) {
      return false;
    }

    // 直接移动并保持“明牌”朝上（discard slots 的 FACE_UP 为 rotationIndex=0）。
    thing.prepareMove();
    thing.moveTo(target, 0);

    // 若本回合有“摸牌位(hand.extra)”的牌：
    // - 若弃的不是刚摸的那张，则把摸牌位的牌并入手牌（清空 hand.extra），满足“出牌后回归排序”的体验。
    // - 为了让 seat0 在极端情况下回滚弃牌时不发生 slot 冲突，这里优先塞到“另一个空的 hand.i”里，
    //   保留 from 作为空位（如果弃牌被回滚，discarded tile 可以无冲突回到 from）。
	    if (!discardedFromExtra) {
	      const extraThing =
        [...this.things.values()].find((t) =>
          t.type === ThingType.TILE &&
          t.slot.group === 'hand' &&
          t.slot.seat === viewerSeat &&
          t.slot.name === `hand.extra@${viewerSeat}`
        ) ?? null;

      if (extraThing) {
        let mergeTarget: Slot | null = null;
        let maxIndex = -1;
        for (let i = 0; i < 14; i++) {
          const s = this.slots.get(`hand.${i}@${viewerSeat}`) ?? null;
          if (!s) continue;
          if (s === from) continue;
          if (s.thing !== null) {
            maxIndex = i;
          }
        }

        const preferred = Math.min(13, maxIndex + 1);
        for (let i = preferred; i < 14; i++) {
          const s = this.slots.get(`hand.${i}@${viewerSeat}`) ?? null;
          if (!s) continue;
          if (s === from) continue;
          if (s.thing === null) {
            mergeTarget = s;
            break;
          }
        }
        if (!mergeTarget) {
          for (let i = 13; i >= 0; i--) {
            const s = this.slots.get(`hand.${i}@${viewerSeat}`) ?? null;
            if (!s) continue;
            if (s === from) continue;
            if (s.thing === null) {
              mergeTarget = s;
              break;
            }
          }
        }
        if (mergeTarget) {
          extraThing.prepareMove();
          extraThing.moveTo(mergeTarget, 0);
        }
      }
	    }

    // 复用原拖动弃牌的“本地锁”语义：等待裁判推进/回显后再允许下一次弃牌。
    if (this.isBloodMobile() || this.isGuobiaoMobile()) {
      this.setBloodDiscardLock({ tileId: thing.index, fromSlotName: from.name });
    }

    this.checkPushes();
    this.finishDrop([from]);
    this.soundPlayer.play(SoundType.DISCARD, viewerSeat, discardTileKey);
    return true;
  }

	  canBloodDiscardNow(): boolean {
	    if (!this.isBloodMobile()) {
	      return false;
	    }
	    const viewerSeat = this.seat;
	    if (viewerSeat === null) {
	      return false;
	    }
	    if (this.bloodDiscardLock) {
	      return false;
	    }
	    const state = this.client.blood.get(0) as BloodState | null;
	    if (!state) {
	      return false;
	    }
	    return (
	      state.phase === 'playing' &&
	      state.pending === null &&
	      state.turnSeat === viewerSeat &&
	      state.turnStep === 'discard'
	    );
	  }

  canGuobiaoDiscardNow(): boolean {
    if (!this.isGuobiaoMobile()) {
      return false;
    }
    const viewerSeat = this.seat;
    if (viewerSeat === null) {
      return false;
    }
    if (this.bloodDiscardLock) {
      return false;
    }
    const state = this.client.gb.get(0) as GuobiaoState | null;
    if (!state) {
      return false;
    }
    return (
      state.phase === 'playing' &&
      state.pending === null &&
      state.turnSeat === viewerSeat &&
      state.turnStep === 'discard'
    );
  }

	  private computeBloodRemainingCounts(mySeat: number): Array<number> {
	    const known = new Array(27).fill(0);
	    for (const t of this.things.values()) {
	      if (t.type !== ThingType.TILE) continue;
	      const k = tileKeyFromTypeIndex(t.typeIndex);
	      if (k === null) continue;
	      const group = t.slot.group;
	      if (group === 'discard' || group === 'meld' || (group === 'hand' && t.slot.seat === mySeat)) {
	        known[k] += 1;
	      }
	    }
	    return known.map((n) => Math.max(0, 4 - n));
	  }

	  private collectBloodHandCounts(seat: number): Uint8Array | null {
	    const counts = new Uint8Array(27);
	    for (const t of this.things.values()) {
	      if (t.type !== ThingType.TILE) continue;
	      if (t.slot.group !== 'hand' || t.slot.seat !== seat) continue;
	      const k = tileKeyFromTypeIndex(t.typeIndex);
	      if (k === null) return null;
	      if (counts[k] >= 4) return null;
	      counts[k] += 1;
	    }
	    return counts;
	  }

	  getBloodTenpaiPreviewAfterDiscard(tileId: number): TenpaiPreview | null {
      if (this.client.match.get(0)?.caseStudy?.partial) return null;
	    if (!this.canBloodDiscardNow()) {
	      return null;
	    }
	    const viewerSeat = this.seat;
	    if (viewerSeat === null) {
	      return null;
	    }
	    const state = this.client.blood.get(0) as BloodState | null;
	    if (!state) {
	      return null;
	    }
	    const me = state.players?.[viewerSeat] ?? null;
	    if (!me || me.hu || me.dingque === null) {
	      return null;
	    }

	    const thing = this.things.get(tileId) ?? null;
	    if (!thing || thing.type !== ThingType.TILE) {
	      return null;
	    }
	    if (thing.slot.group !== 'hand' || thing.slot.seat !== viewerSeat) {
	      return null;
	    }
	    const discardTileKey = tileKeyFromTypeIndex(thing.typeIndex);
	    if (discardTileKey === null) {
	      return null;
	    }

	    const meldCount = (me.melds ?? []).length;
	    const expected = 14 - 3 * meldCount;

	    const counts14 = this.collectBloodHandCounts(viewerSeat);
	    if (!counts14) {
	      return null;
	    }
	    let actual = 0;
	    for (let i = 0; i < 27; i++) {
	      actual += counts14[i] ?? 0;
	    }
	    if (actual !== expected) {
	      return null;
	    }
	    if ((counts14[discardTileKey] ?? 0) <= 0) {
	      return null;
	    }

	    const counts13 = new Uint8Array(counts14);
	    counts13[discardTileKey] -= 1;

	    const base = Number.isFinite(state.base ?? NaN) ? Math.trunc(state.base) : 400;
	    const melds = (me.melds ?? [])
	      .filter((m) => !!m && (m.kind === 'peng' || m.kind === 'gang') && Number.isFinite(m.tileKey))
	      .map((m) => ({ kind: m.kind, tileKey: m.tileKey, gangType: m.kind === 'gang' ? m.gangType : undefined }));

	    const remainingCounts = this.computeBloodRemainingCounts(viewerSeat);

	    const preview = computeTenpaiPreviewAfterDiscard({
	      countsAfterDiscard: counts13,
	      melds,
	      meldCount,
	      dingque: me.dingque,
	      remainingCounts,
	      base,
	    });
	    return preview.isTenpai ? preview : null;
	  }

	  setBloodKongPick(seat: number, options: Array<{ tileKey: number; gangType: BloodGangType }>): void {
	    if (!this.isBloodMobile()) {
	      return;
	    }
    const tileKeys = new Set<number>();
    const normalized: Array<{ tileKey: number; gangType: BloodGangType }> = [];
    for (const opt of options) {
      if (!Number.isFinite(opt.tileKey)) continue;
      if (tileKeys.has(opt.tileKey)) continue;
      tileKeys.add(opt.tileKey);
      normalized.push(opt);
    }
    this.bloodKongPick = { seat, options: normalized, tileKeys };
  }

  clearBloodKongPick(): void {
    this.bloodKongPick = null;
  }

  hasBloodKongPick(): boolean {
    return this.bloodKongPick !== null;
  }

  // === Coach helpers ===
  setCoachHighlights(tileIds: Array<number>): void {
    this.coachHighlights.clear();
    for (const id of tileIds) {
      if (Number.isFinite(id)) {
        this.coachHighlights.add(Math.trunc(id));
      }
    }
  }

  setCoachDiscardRule(rule: { allow: 'none' } | { allow: 'only'; tileIds: Array<number> } | null): void {
    if (!rule) {
      this.coachDiscardRule = null;
      return;
    }
    if (rule.allow === 'none') {
      this.coachDiscardRule = { allow: 'none' };
      return;
    }
    const tileIds = new Set<number>();
    for (const id of rule.tileIds ?? []) {
      if (Number.isFinite(id)) tileIds.add(Math.trunc(id));
    }
    this.coachDiscardRule = { allow: 'only', tileIds };
  }

  isBloodSwap3Phase(): boolean {
    if (!this.isBloodMobile()) {
      return false;
    }
    const state = this.client.blood.get(0) as BloodState | null;
    return !!(state && state.phase === 'swap3');
  }

  canBloodSwap3Select(): boolean {
    if (!this.isBloodMobile()) {
      return false;
    }
    const viewerSeat = this.seat;
    if (viewerSeat === null) {
      return false;
    }
    const state = this.client.blood.get(0) as BloodState | null;
    const swap3 = state?.swap3 ?? null;
    if (!state || state.phase !== 'swap3' || !swap3) {
      return false;
    }
    if (swap3.animatingSince !== null) {
      return false;
    }
    return (swap3.selections?.[viewerSeat] ?? null) === null;
  }

  tryBloodSwap3Toggle(tileId: number): boolean {
    if (this.aiHosted) {
      return false;
    }
    if (!this.canBloodSwap3Select()) {
      return false;
    }
    const viewerSeat = this.seat;
    if (viewerSeat === null) {
      return false;
    }

    const thing = this.things.get(tileId);
    if (!thing || thing.type !== ThingType.TILE) {
      return false;
    }
    const slot = thing.slot;
    if (slot.group !== 'hand' || slot.seat !== viewerSeat) {
      return false;
    }

    const tileKey = tileKeyFromTypeIndex(thing.typeIndex);
    if (tileKey === null) {
      return false;
    }
    const tappedSuit = suitOf(tileKey);

    const selectedIds = this.selected
      .filter((t) => t.type === ThingType.TILE && t.slot.group === 'hand' && t.slot.seat === viewerSeat)
      .map((t) => t.index);

    const existing = selectedIds.indexOf(tileId);
    if (existing !== -1) {
      selectedIds.splice(existing, 1);
      this.onSelect(selectedIds);
      return true;
    }

    if (selectedIds.length > 0) {
      const first = this.things.get(selectedIds[0]!) ?? null;
      const firstKey = first ? tileKeyFromTypeIndex(first.typeIndex) : null;
      const firstSuit = firstKey !== null ? suitOf(firstKey) : null;
      // 换三张：必须同花色。若点到不同花色，则视为“切换花色”并清空之前选择。
      // 不做任何提示/确认：直接以新点的牌作为新花色第 1 张。
      if (firstSuit === null || tappedSuit !== firstSuit) {
        this.onSelect([tileId]);
        return true;
      }
    }

    // 同花色：最多 3 张；满 3 后继续点则 FIFO 替换最早选中的那张。
    if (selectedIds.length >= 3) {
      selectedIds.shift();
    }
    selectedIds.push(tileId);
    this.onSelect(selectedIds);
    return true;
  }

  tryBloodKongPick(tileId: number): boolean {
    if (this.aiHosted) {
      return false;
    }
    if (!this.isBloodMobile()) {
      return false;
    }
    const pick = this.bloodKongPick;
    if (!pick) {
      return false;
    }
    if (this.seat === null || pick.seat !== this.seat) {
      return false;
    }

    const thing = this.things.get(tileId);
    if (!thing || thing.type !== ThingType.TILE) {
      return false;
    }
    const slot = thing.slot;
    if (slot.group !== 'hand' || slot.seat !== pick.seat) {
      return false;
    }
    const tileKey = tileKeyFromTypeIndex(thing.typeIndex);
    if (tileKey === null) {
      return false;
    }
    const opt = pick.options.find((o) => o.tileKey === tileKey) ?? null;
    if (!opt) {
      return false;
    }

    this.client.sendBloodAction({ kind: 'kong', gangType: opt.gangType, tileKey });
    this.clearBloodKongPick();
    return true;
  }

  private findSlot(x: number, y: number, w: number, h: number, thing: Thing): Slot | null {
    const minOverlap = 1;
    let bestOverlap = minOverlap ;
    let bestSlot = null;

    // Empty slots
    for (const slot of this.slots.values()) {
      if (slot.type !== thing.type) {
        continue;
      }
      if (!this.canDropTileToSlot(thing, slot)) {
        continue;
      }

      if (slot.thing !== null && slot.thing.claimedBy !== this.seat) {
        // Occupied. But can it be potentially shifted?
        if (!slot.links.shiftLeft && !slot.links.shiftRight) {
          continue;
        }
      }
      // Already proposed for another thing
      if (this.movement?.hasSlot(slot)) {
        continue;
      }
      // The slot requires other slots to be occupied first
      if (slot.links.requires && slot.links.requires.thing === null) {
        continue;
      }

      const place = slot.placeWithOffset(0);

      const margin = Size.TILE.x / 2;
      const overlap1 = rectangleOverlap(
        x, y, w, h,
        place.position.x, place.position.y, place.size.x, place.size.y,
      );
      const overlap2 = rectangleOverlap(
        x, y, w + margin, h + margin,
        place.position.x, place.position.y, place.size.x + margin, place.size.y + margin,
      );
      const overlap = overlap1 + overlap2 * 0.5;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSlot = slot;
      }
    }
    return bestSlot;
  }

  onDragStart(): boolean {
    if (this.aiHosted) {
      return false;
    }
    if (this.seat === null) {
      return false;
    }

    if (this.hovered !== null && !this.isHolding()) {
      let toHold;
      if (this.selected.indexOf(this.hovered) !== -1) {
        toHold = [...this.selected];
      } else {
        toHold = [this.hovered];
        this.selected.splice(0);
      }

      // 移动端血战/国标：一次只允许拖动一张牌（手牌整理靠 shift），避免一次性移动多张导致状态错乱。
      if (this.isSortedMobileHand()) {
        toHold = [this.hovered];
        this.selected.splice(0);
      }

      toHold = toHold.filter(thing => thing.claimedBy === null);

      for (const thing of toHold) {
        thing.hold(this.seat);
      }
      this.hovered = null;
      this.heldMouse = this.mouse;

      this.drag();
      this.sendMouse();
      this.sendUpdate();

      return true;
    }
    return false;
  }

  onDragEnd(): void {
    if (this.isHolding()) {
      if (this.heldMouse !== null && this.mouse !== null &&
          this.heldMouse.equals(this.mouse)) {

        // No movement; unselect
        this.selected.splice(0);
        this.dropInPlace();
        // if (this.hovered !== null) {
        //   this.selected.push(this.hovered);
        // }
      } else if (this.canDrop()) {
        // Successful movement
        this.drop();
      } else {
        this.dropInPlace();
      }
    }

  }

  onFlip(direction: number, animated?: boolean): void {
    if (this.isHolding()) {
      return;
    }

    if (this.selected.length > 0) {
      const rotationIndex = mostCommon(this.selected, thing => thing.rotationIndex)!;
      const toFlip = [];
      for (const thing of this.selected) {
        if (this.selected.length === 1 || thing.slot.canFlipMultiple) {
          toFlip.push(thing);
        }
      }
      if (toFlip.length > 1 && animated) {
        toFlip.sort((a, b) => a.slot.name.localeCompare(b.slot.name, undefined, { numeric: true }));
        this.flipAnimated(toFlip, 0, rotationIndex + direction);
      } else {
        for (const thing of toFlip) {
          thing.flip(rotationIndex + direction);
        }
        this.checkPushes();
        this.selected.splice(0);
      }
    } else if (this.hovered !== null) {
      this.hovered.flip(this.hovered.rotationIndex + direction);
      this.sendUpdate();
      this.checkPushes();
    }
    this.sendUpdate();

  }

  private flipAnimated(things: Array<Thing>, i: number, rotationIndex: number): void {
    const thing = things[i];
    if (this.selected.indexOf(things[i]) === -1) {
      this.selected.splice(0);
      return;
    }
    thing.flip(rotationIndex);
    this.sendUpdate();
    if (i + 1 < things.length) {
      setTimeout(() => this.flipAnimated(things, i + 1, rotationIndex), 100);
    } else {
      this.selected.splice(0);
    }
  }

  private drop(): void {
    if(!this.movement) {
      return;
    }

    const sourceSlots = [];
    let discardSide = null;
    let discardTileKey: number | null = null;
    let discardLock: { tileId: number; fromSlotName: string } | null = null;
    let hasStick = false;
    for (const thing of this.movement.things()) {
      const source = thing.slot;
      const target = this.movement.get(thing)!;
      if (target.group === 'discard' &&
        !(source.group === 'discard' && source.seat === target.seat)) {
        discardSide = target.seat;
        discardTileKey = this.conditions.gameType === GameType.GUOBIAO
          ? this.resolveTileKeyForAudio(thing.index)
          : tileKeyFromTypeIndex(thing.typeIndex);
        if (this.isBloodMobile() && source.group === 'hand' && this.seat !== null && target.seat === this.seat) {
          discardLock = { tileId: thing.index, fromSlotName: source.name };
        }
      } else if (target.group === 'riichi') {
        hasStick = true;
      }
      sourceSlots.push(source);
    }

    this.movement.apply();
    if (discardLock) {
      this.setBloodDiscardLock(discardLock);
    }
    this.checkPushes();
    this.finishDrop(sourceSlots);

    if (discardSide !== null) {
      this.soundPlayer.play(SoundType.DISCARD, discardSide, discardTileKey);
    }
    if (hasStick) {
      this.soundPlayer.play(SoundType.STICK, null);
    }
  }

  private dropInPlace(): void {
    this.finishDrop([]);
  }

  private finishDrop(sourceSlots: Array<Slot>): void {
    const targetSlots = [];
    for (const thing of this.things.values()) {
      if (thing.claimedBy === this.seat) {
        thing.release();
        targetSlots.push(thing.slot);
      }
    }
    this.selected.splice(0);
    this.heldMouse = null;
    this.movement = null;

    for (const slot of sourceSlots) {
      if (slot.links.up) {
        this.dropDown(slot.links.up);
      }
    }
    for (const slot of targetSlots) {
      this.dropDown(slot);
    }

    this.sendUpdate();
    this.sendMouse();
  }

  private dropDown(slot: Slot): void {
    const thing = slot.thing;
    if (thing && thing.claimedBy === null) {
      const downSlot = slot.links.down;
      if (downSlot && downSlot.thing === null) {
        thing.prepareMove();
        thing.moveTo(downSlot);
      }
    }
  }

  private canDrop(): boolean {
    return this.movement ? this.movement.valid() : false;
  }

  private checkPushes(): void {
    for (const [source, target] of this.pushes) {
      target.handlePush(source);
    }
  }

  updateView(): void {
    this.updateViewThings();
    this.updateViewDropShadows();
    this.objectView.updateScores(this.setup.getScores());
    if (this.pendingDiagnosticRenderActionId) {
      this.client.markActionRendered(this.pendingDiagnosticRenderActionId);
      this.pendingDiagnosticRenderActionId = null;
    }
  }

  private updateViewThings(): void {
    const toRender: Array<Render> = [];
    const canDrop = this.canDrop();
    const now = new Date().getTime();
    const viewerSeat = this.seat;
    const tapSelectedId =
      this.selected.length === 1 &&
      this.selected[0] &&
      this.selected[0].type === ThingType.TILE
        ? this.selected[0].index
        : null;
    const useHandViewport =
      this.layoutMode === 'mobileHand' &&
      viewerSeat !== null;
    const bloodState = this.isBloodMobile() ? (this.client.blood.get(0) as BloodState | null) : null;
    const guobiaoState = this.isGuobiaoMobile() ? (this.client.gb.get(0) as GuobiaoState | null) : null;
    const guobiaoDisplayState = this.conditions.gameType === GameType.GUOBIAO
      ? (this.client.gb.get(0) as GuobiaoState | null)
      : null;
    const guobiaoFlowerMeldTileIds = new Set<number>();
    if (guobiaoState) {
      for (let seat = 0; seat < 4; seat++) {
        for (const meld of guobiaoState.players?.[seat]?.melds ?? []) {
          if (meld.kind === 'flower') guobiaoFlowerMeldTileIds.add(meld.tileId);
        }
      }
    }
    const inSwap3 = !!(bloodState && bloodState.phase === 'swap3');
    const swap3RaisedIds =
      inSwap3 && viewerSeat !== null
        ? this.selected
            .filter((t) => t.type === ThingType.TILE && t.slot.group === 'hand' && t.slot.seat === viewerSeat)
            .map((t) => t.index)
        : null;
    const revealAllHands = !!(
      (bloodState && (bloodState.revealAllHands || bloodState.phase === 'settling' || bloodState.phase === 'done')) ||
      (guobiaoState && (guobiaoState.revealAllHands || guobiaoState.phase === 'settling' || guobiaoState.phase === 'done'))
    );
    const revealAllGuobiaoMelds = !!(
      guobiaoDisplayState &&
      (guobiaoDisplayState.revealAllHands || guobiaoDisplayState.phase === 'settling' || guobiaoDisplayState.phase === 'done')
    );
    const guobiaoConcealedGangRows = this.getGuobiaoConcealedGangRows(guobiaoDisplayState);
    const mobileSelfHandPlaces =
      this.isSortedMobileHand() && viewerSeat !== null
        ? this.computeMobileSelfHandSortedPlaces(viewerSeat)
        : null;
    const mobileOpponentHandPackedPlaces =
      this.isSortedMobileHand() && viewerSeat !== null && !revealAllHands
        ? this.computeMobileOpponentHandPackedPlaces(viewerSeat, (seat) => {
            // 胡牌玩家的暗手：平躺背面（不亮牌）直到结算亮牌。
            return bloodState?.players?.[seat]?.hu ? 2 : 0;
          })
        : null;
    const mobileRevealedOpponentHandPlaces =
      this.isSortedMobileHand() && viewerSeat !== null && revealAllHands
        ? (() => {
            const map = new Map<number, Place>();
            for (let seat = 0; seat < 4; seat++) {
              if (seat === viewerSeat) continue;
              const sorted = this.computeMobileSelfHandSortedPlaces(seat, 1);
              for (const [id, place] of sorted.entries()) {
                map.set(id, place);
              }
            }
            return map;
          })()
        : null;

    const isHandTile = (thing: Thing): boolean => {
      if (this.layoutMode !== 'mobileHand') return false;
      if (viewerSeat === null) return false;
      if (thing.type !== ThingType.TILE) return false;
      const slot = thing.slot;
      return slot.group === 'hand' && slot.seat !== null;
    };

    // 清理本地“翻牌隐藏”状态（牌离开自家手牌后不再保留）
    if (this.layoutMode === 'mobileHand' && viewerSeat !== null && this.localHandHidden.size > 0) {
      for (const id of Array.from(this.localHandHidden)) {
        const thing = this.things.get(id);
        if (!thing || thing.type !== ThingType.TILE) {
          this.localHandHidden.delete(id);
          continue;
        }
        const slot = thing.slot;
        if (slot.group !== 'hand' || slot.seat !== viewerSeat) {
          this.localHandHidden.delete(id);
        }
      }
    }

    for (const thing of this.things.values()) {
      if (this.layoutMode === 'mobileHand' && thing.type === ThingType.STICK) {
        continue;
      }

      const slot = thing.slot;
      const hideWall =
        this.layoutMode === 'mobileHand' &&
        thing.type === ThingType.TILE &&
        slot.group.startsWith('wall');
      const handTile = isHandTile(thing);
      const selfHand = handTile && slot.seat === viewerSeat;
      const huPlayer = handTile && !revealAllHands && bloodState?.players?.[slot.seat ?? -1]?.hu;
      const forceFaceDownForHu = !!(handTile && !selfHand && huPlayer);
      const meldRotationIndex =
        this.guobiaoForcedConcealedGangRotationIndex(slot, guobiaoConcealedGangRows, revealAllGuobiaoMelds) ??
        thing.rotationIndex;

      // 移动端：默认手牌用“竖立”显示；结算亮牌时仅对手“推倒”(face-up 平放)。
      // 对手平时只显示背面；自家可本地隐藏（翻到背面）。
      const forcedRotationIndex = handTile ? (!selfHand && revealAllHands ? 1 : (forceFaceDownForHu ? 2 : 0)) : meldRotationIndex;
      let place = slot.placeWithOffset(forcedRotationIndex);
      // 移动端血战/国标：自家手牌在本地排序（不改服务器 slotName，避免同步侧产生歧义）。
      if (handTile && selfHand && mobileSelfHandPlaces) {
        const sorted = mobileSelfHandPlaces.get(thing.index);
        if (sorted) {
          place = sorted;
        }
      }
      // 移动端血战/国标：对手手牌
      // - 常规：按“张数打包”到连续位置（背面信息，顺序不重要）
      // - 结算亮牌：按“该玩家自己看到的顺序”排序，并推倒为 face-up
      if (handTile && !selfHand) {
        if (revealAllHands && mobileRevealedOpponentHandPlaces) {
          const revealed = mobileRevealedOpponentHandPlaces.get(thing.index);
          if (revealed) {
            place = revealed;
          }
        } else if (mobileOpponentHandPackedPlaces) {
          const packed = mobileOpponentHandPackedPlaces.get(thing.index);
          if (packed) {
            place = packed;
          }
        }
      }

      if (thing.claimedBy !== null && thing.shiftSlot === null) {
        let mouse = null, heldMouse = null;
        if (thing.claimedBy === this.seat) {
          mouse = this.mouse;
          heldMouse = this.heldMouse;
        } else {
          mouse = this.mouseTracker.getMouse(thing.claimedBy, now);
          heldMouse = this.mouseTracker.getHeld(thing.claimedBy);
        }

        if (mouse && heldMouse) {
          place = {
            ...place,
            position: place.position.clone(),
            // 手牌：
            // - 自己正在拖动：用 heldRotation（与 PC 端一致，有旋转预览）
            // - 对手正在拖动：仍用 slot 的旋转（不依赖远端 heldRotation，避免露牌）
            rotation: handTile
              ? (thing.claimedBy === viewerSeat ? thing.heldRotation.clone() : place.rotation)
              : thing.heldRotation.clone(),
          };
          place.position.x += mouse.x - heldMouse.x;
          place.position.y += mouse.y - heldMouse.y;
        }
      } else if (thing.lastShiftSlotTime >= now - SHIFT_TIME) {
        if (thing.lastShiftSlot !== null) {
          place = thing.lastShiftSlot.places[forcedRotationIndex];
        }
      } else if (thing.claimedBy !== null && thing.shiftSlot !== null) {
        place = thing.shiftSlot.places[forcedRotationIndex];
      }

      // 最终决定“手牌是否露牌”：
      // - 默认：只让自己看到牌面
      // - 结算（revealAllHands=true）：所有人都亮牌
      if (handTile) {
        if (!revealAllHands && selfHand && thing.claimedBy === null && this.localHandHidden.has(thing.index)) {
          place = {
            ...place,
            rotation: place.rotation.clone().multiply(HAND_LOCAL_BACK_ROTATION),
          };
        } else if (!selfHand && !revealAllHands && !forceFaceDownForHu) {
          place = {
            ...place,
            rotation: place.rotation.clone().multiply(HAND_LOCAL_BACK_ROTATION),
          };
        }
      }

      // 点选抬起：
      // - swap3（换三张）：选中的 1~3 张牌都上抬
      // - 其他阶段：只对“本家单张选中手牌”上抬
      // 约束：不抬起拖动中/shift 中的牌，避免与动画/拖拽冲突。
      const shouldRaise =
        (inSwap3 && swap3RaisedIds !== null && swap3RaisedIds.includes(thing.index)) ||
        (!inSwap3 && tapSelectedId !== null && thing.index === tapSelectedId);
      if (
        shouldRaise &&
        viewerSeat !== null &&
        slot.group === 'hand' &&
        slot.seat === viewerSeat &&
        thing.claimedBy === null &&
        thing.shiftSlot === null
      ) {
        const raise = place.size.z * HAND_TAP_RAISE_RATIO;
        if (raise > 1e-6) {
          place = { ...place, position: place.position.clone() };
          if (viewerSeat === 0) {
            place.position.y += raise;
          } else if (viewerSeat === 1) {
            place.position.x -= raise;
          } else if (viewerSeat === 2) {
            place.position.y -= raise;
          } else {
            place.position.x += raise;
          }
        }
      }

      const held = thing.claimedBy !== null && thing.shiftSlot === null;
      const kongCandidate =
        this.isBloodMobile() &&
        this.bloodKongPick !== null &&
        viewerSeat !== null &&
        this.bloodKongPick.seat === viewerSeat &&
        thing.type === ThingType.TILE &&
        slot.group === 'hand' &&
        slot.seat === viewerSeat &&
        (() => {
          const k = tileKeyFromTypeIndex(thing.typeIndex);
          return k !== null && this.bloodKongPick!.tileKeys.has(k);
        })();
      const userSelected = this.selected.indexOf(thing) !== -1;
      const selfHandUserSelected =
        userSelected &&
        this.layoutMode === 'mobileHand' &&
        viewerSeat !== null &&
        slot.group === 'hand' &&
        slot.seat === viewerSeat &&
        thing.type === ThingType.TILE &&
        thing.claimedBy === null;
      // `Render.selected` controls OutlinePass highlighting (描边)，不是“上抬选中”本身。
      // 移动端血战：自家手牌点选/换三张（swap3）用“上抬”表达选中，因此不再描边。
      const selected =
        kongCandidate ||
        this.coachHighlights.has(thing.index) ||
        (userSelected && !selfHandUserSelected);
      const hovered = thing === this.hovered ||
        (selected && this.selected.indexOf(this.hovered!) !== -1);
      const temporary = held && thing.claimedBy === this.seat && !canDrop;

      // 移动端血战：牌墙只作为“牌库计数”的来源，不需要 3D 墙牌模型占画面。
      // 注意：不能简单从渲染列表里移除（TileThingGroup 依赖 index 连续映射），
      // 所以用 scale=0 让实例矩阵为零来隐藏。
      // 胡牌展示：自摸胡时，hand.extra 那张就是胡牌，本体不再显示（避免与“胡牌展示区”重复）。
      const hideHuExtra =
        this.isBloodMobile() &&
        !revealAllHands &&
        thing.type === ThingType.TILE &&
        slot.seat !== null &&
        slot.name === `hand.extra@${slot.seat}` &&
        !!(bloodState?.players?.[slot.seat]?.hu && bloodState?.players?.[slot.seat]?.huSource === 'self');

      const hideHuTaken = slot.group === 'hu.taken';
      const hideGuobiaoFlowerMeld =
        this.conditions.gameType === GameType.GUOBIAO &&
        slot.group === 'meld' &&
        guobiaoFlowerMeldTileIds.has(thing.index);

      const scale = (hideWall || hideHuExtra || hideHuTaken || hideGuobiaoFlowerMeld) ? 0 : (slot.sizeScale ?? 1);

      const bottom =
        !held &&
        slot.links.up !== undefined &&
        (slot.links.up.thing === null ||
         slot.links.up.thing.claimedBy !== null);

      // 移动端双相机：自家手牌/副露/定缺标识放到 layer=1（底部手牌视口相机只渲染这一层）
      let layer = 0;
      if (useHandViewport && slot.seat === viewerSeat && (slot.group === 'hand' || slot.group === 'meld' || slot.group === 'marker')) {
        layer = HAND_VIEW_LAYER;
      }

      toRender.push({
        type: thing.type,
        thingIndex: thing.index,
        place,
        scale,
        selected,
        hovered,
        held,
        temporary,
        bottom,
        layer,
      });
    }
    this.objectView.updateThings(toRender);

    // 移动端胡牌展示（胡牌+小“胡”徽章）是额外的叠层渲染，不占用 Thing id。
    if (this.objectView.updateBloodHuOverlays) {
      let overlays: Array<BloodHuOverlayRender | null> = [null, null, null, null];
      if (this.isBloodMobile()) {
        const state = this.client.blood.get(0) as BloodState | null;
        overlays = state ? this.getBloodMobileHuOverlays(state) : overlays;
      } else if (this.isGuobiaoMobile()) {
        const state = this.client.gb.get(0) as GuobiaoState | null;
        overlays = state ? this.getGuobiaoHuBadgeOverlays(state) : overlays;
      }
      this.objectView.updateBloodHuOverlays(overlays);
    }

    if (this.objectView.updateGuobiaoSeatInnerDisplay) {
      const state = this.isGuobiaoMobile() ? (this.client.gb.get(0) as GuobiaoState | null) : null;
      const overlays = state ? this.getGuobiaoSeatInnerDisplayOverlays(state) : [];
      this.objectView.updateGuobiaoSeatInnerDisplay(overlays);
    }
  }

  private updateViewDropShadows(): void {
    const places = [];
    if (this.canDrop()) {
      for (const slot of this.movement!.slots()) {
        places.push(slot.placeWithOffset(0));
      }
    }
    this.objectView.updateDropShadows(places);
  }

  toSelect(): Array<Select> {
    const result = [];
    if (this.seat !== null && !this.isHolding()) {
      const tapSelectedId =
        this.selected.length === 1 &&
        this.selected[0] &&
        this.selected[0].type === ThingType.TILE
          ? this.selected[0].index
          : null;
      const bloodState = this.isBloodMobile() ? (this.client.blood.get(0) as BloodState | null) : null;
      const inSwap3 = !!(bloodState && bloodState.phase === 'swap3');
      const swap3RaisedIds =
        inSwap3
          ? this.selected
              .filter((t) => t.type === ThingType.TILE && t.slot.group === 'hand' && t.slot.seat === this.seat)
              .map((t) => t.index)
          : null;
      const mobileSelfHandPlaces =
        this.isSortedMobileHand()
          ? this.computeMobileSelfHandSortedPlaces(this.seat)
          : null;
      for (const thing of this.things.values()) {
        if (this.layoutMode === 'mobileHand' && thing.type === ThingType.STICK) {
          continue;
        }
        if (this.layoutMode === 'mobileHand' && thing.type === ThingType.TILE) {
          const slot = thing.slot;
          if (this.conditions.gameType === GameType.BLOOD_BATTLE || this.conditions.gameType === GameType.GUOBIAO) {
            // 移动端血战/国标：只允许选择自家手牌（弃牌/副露/牌墙都不可拖动）
            if (slot.group !== 'hand' || slot.seat !== this.seat) {
              continue;
            }
          } else if (slot.group === 'hand') {
            // 其他移动端模式：仍然只允许选择自家手牌（对手手牌只显示背面且不可点选）
            if (slot.seat !== this.seat) {
              continue;
            }
          }
        }
        if (thing.claimedBy === null) {
          const slot = thing.slot;
          let place: Place;
          if (this.layoutMode === 'mobileHand' && slot.group === 'hand') {
            place = slot.placeWithOffset(0);
            if (mobileSelfHandPlaces && slot.seat === this.seat) {
              const sorted = mobileSelfHandPlaces.get(thing.index);
              if (sorted) {
                place = sorted;
              }
            }
          } else {
            place = thing.place();
          }
          const shouldRaise =
            (inSwap3 && swap3RaisedIds !== null && swap3RaisedIds.includes(thing.index)) ||
            (!inSwap3 && tapSelectedId !== null && thing.index === tapSelectedId);
          if (shouldRaise && slot.group === 'hand' && slot.seat === this.seat && thing.shiftSlot === null) {
            const raise = place.size.z * HAND_TAP_RAISE_RATIO;
            if (raise > 1e-6) {
              place = { ...place, position: place.position.clone() };
              if (this.seat === 0) {
                place.position.y += raise;
              } else if (this.seat === 1) {
                place.position.x -= raise;
              } else if (this.seat === 2) {
                place.position.y -= raise;
              } else {
                place.position.x += raise;
              }
            }
          }
          result.push({...place, id: thing.index});
        }
      }
    }
    return result;
  }

  setupView(): void {
    this.objectView.replaceThings(this.things);

    const places = [];
    for (const slot of this.slots.values()) {
      if (slot.drawShadow) {
        // 移动端对战界面：不显示“槽位占位阴影”（更接近手游观感）
        if (this.layoutMode === 'mobileHand') continue;
        places.push(slot.places[slot.shadowRotation]);
      }
    }
    this.objectView.replaceShadows(places);
  }
}
