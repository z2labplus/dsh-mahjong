/* eslint no-console: 0 */

import { EventEmitter } from 'events';

import type { AiFollowupMode, AiScene, AiTemplate, Message } from '../server/protocol';
import { Entry } from '../server/protocol';

import { BaseClient, Game } from './base-client';
import { ThingInfo, MatchInfo, MouseInfo, SoundInfo, SeatInfo, DiceInfo } from './types';
import type { BloodAction, BloodState, BloodSuit } from './blood';
import type { GuobiaoAction, GuobiaoState } from './guobiao';

const DINGQUE_STORAGE_PREFIX = 'mjlab.dingque.';

export class Client extends BaseClient {
  match: Collection<number, MatchInfo>;
  seats: Collection<string, SeatInfo>;
  things: Collection<number, ThingInfo>;
  nicks: Collection<string, string>;
  avatars: Collection<string, number>;
  mouse: Collection<string, MouseInfo>;
  sound: Collection<number, SoundInfo>;
  dice: Collection<number, DiceInfo>;
  blood: Collection<number, BloodState>;
  bloodAction: Collection<string, { seq: number; action: BloodAction }>;
  gb: Collection<number, GuobiaoState>;
  gbAction: Collection<string, { seq: number; action: GuobiaoAction }>;
  tileFacePublic: Collection<number, number>;
  tileFaceSelf: Collection<number, number>;

  private bloodActionSeq: number = Date.now();
  private gbActionSeq: number = Date.now();
  private pendingActionById: Map<string, BloodAction | GuobiaoAction> = new Map();
  private localCommittedDingqueSuit: BloodSuit | null = null;
  private ackedDingqueSuit: BloodSuit | null = null;
  private lastAutoResendDingqueAtMs: number = 0;
  private lastAutoResendDingqueSuit: BloodSuit | null = null;

  seat: number | null = null;
  seatPlayers: Array<string | null> = new Array(4).fill(null);

  constructor() {
    super();

    // Make sure match is first, as it triggers reorganization of slots and things.
    this.match = new Collection('match', this, { sendOnConnect: true }),

    this.seats = new Collection('seats', this, { unique: 'seat' });
    this.things = new Collection('things', this, { unique: 'slotName', sendOnConnect: true });
    this.nicks = new Collection('nicks', this, { perPlayer: true });
    this.avatars = new Collection('avatars', this, { perPlayer: true });
    this.mouse = new Collection('mouse', this, { rateLimit: 100, perPlayer: true });
    this.sound = new Collection('sound', this, { ephemeral: true });
    this.dice = new Collection('dice', this, { ephemeral: true });
    this.blood = new Collection('blood', this);
    this.bloodAction = new Collection('bloodAction', this, { ephemeral: true, perPlayer: true });
    this.gb = new Collection('gb', this);
    this.gbAction = new Collection('gbAction', this, { ephemeral: true, perPlayer: true });
    this.tileFacePublic = new Collection('tileFacePublic', this);
    this.tileFaceSelf = new Collection('tileFaceSelf', this);
    this.seats.on('update', this.onSeats.bind(this));
    this.blood.on('update', this.onBlood.bind(this));
    this.on('actionAck', this.onActionAck.bind(this));
    this.on('connectionState', state => {
      if (state === 'ready') this.maybeResendDingqueAction();
    });
  }

  sendBloodAction(action: BloodAction): string | null {
    if (this.isAuthoritative()) {
      const gameId = this.gameId();
      if (!gameId || !this.actionsReady()) return null;
      const now = Date.now();
      const seq = now <= this.bloodActionSeq ? this.bloodActionSeq + 1 : now;
      this.bloodActionSeq = seq;
      // ACTION actionId is unique across reconnects for this game/user. Blood & Guobiao actions
      // share the server-side ledger, so prefix independent counters to avoid collisions.
      const actionId = `b-${seq}`;
      this.pendingActionById.set(actionId, action);
      if (action.kind === 'dingque') {
        // 服务端在盲选阶段不会立即公开 dingque；本地先记住自己的选择用于 HUD 展示。
        this.localCommittedDingqueSuit = action.suit;
        // 先落盘，覆盖“提交后快速重连但 ACK 尚未返回”的窗口。
        this.writeStoredDingqueSuit(action.suit);
      }
      this.send({ type: 'ACTION', gameId, actionId, action } as any);
      return actionId;
    }
    const now = Date.now();
    const seq = now <= this.bloodActionSeq ? this.bloodActionSeq + 1 : now;
    this.bloodActionSeq = seq;
    this.bloodAction.set(this.playerId(), { seq, action });
    return String(seq);
  }

  sendGbAction(action: GuobiaoAction): string | null {
    if (this.isAuthoritative()) {
      const gameId = this.gameId();
      if (!gameId || !this.actionsReady()) return null;
      const now = Date.now();
      const seq = now <= this.gbActionSeq ? this.gbActionSeq + 1 : now;
      this.gbActionSeq = seq;
      // See sendBloodAction(): the game/user action ledger is shared across game variants.
      const actionId = `g-${seq}`;
      this.pendingActionById.set(actionId, action);
      this.send({ type: 'ACTION', gameId, actionId, action } as any);
      return actionId;
    }
    const now = Date.now();
    const seq = now <= this.gbActionSeq ? this.gbActionSeq + 1 : now;
    this.gbActionSeq = seq;
    this.gbAction.set(this.playerId(), { seq, action });
    return String(seq);
  }

  localDingqueSuit(): BloodSuit | null {
    return this.localCommittedDingqueSuit;
  }

  private dingqueStorageKey(): string | null {
    const gameId = this.gameId();
    const playerId = this.playerId();
    if (!gameId || !playerId) return null;
    return `${DINGQUE_STORAGE_PREFIX}${gameId}.${playerId}`;
  }

  private readStoredDingqueSuit(): BloodSuit | null {
    const key = this.dingqueStorageKey();
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (raw === 'm' || raw === 'p' || raw === 's') return raw;
    } catch {
      // ignore
    }
    return null;
  }

  private writeStoredDingqueSuit(suit: BloodSuit | null): void {
    const key = this.dingqueStorageKey();
    if (!key) return;
    try {
      if (suit === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, suit);
      }
    } catch {
      // ignore
    }
  }

  private resolveMyPlayerState(state: BloodState | null): BloodState['players'][number] | null {
    if (!state) return null;
    const mySeat = this.seat;
    if (mySeat !== null && mySeat >= 0 && mySeat <= 3) {
      return state.players?.[mySeat] ?? null;
    }
    const myPlayerId = this.playerId();
    for (const s of [0, 1, 2, 3]) {
      const ps = state.players?.[s] ?? null;
      if (ps?.playerId === myPlayerId) return ps;
    }
    return null;
  }

  private authoritativeDingqueSuit(): BloodSuit | null {
    const state = this.blood.get(0) as BloodState | null;
    const me = this.resolveMyPlayerState(state);
    const suit = me?.dingque ?? null;
    if (suit === 'm' || suit === 'p' || suit === 's') return suit;
    return this.ackedDingqueSuit;
  }

  private onSeats(): void {
    this.seat = null;
    this.seatPlayers.fill(null);
    for (const [playerId, seatInfo] of this.seats.entries()) {
      if (playerId === this.playerId()) {
        this.seat = seatInfo.seat;
      }
      if (seatInfo.seat !== null) {
        this.seatPlayers[seatInfo.seat] = playerId;
      }
    }
  }

  private onBlood(): void {
    const state = this.blood.get(0) as BloodState | null;
    if (!state) {
      this.localCommittedDingqueSuit = null;
      this.ackedDingqueSuit = null;
      return;
    }
    if (state.phase === 'swap3') {
      this.localCommittedDingqueSuit = null;
      this.ackedDingqueSuit = null;
      this.writeStoredDingqueSuit(null);
      return;
    }
    const me = this.resolveMyPlayerState(state);
    if (!me) return;
    if (me?.dingque) {
      this.ackedDingqueSuit = me.dingque;
      this.localCommittedDingqueSuit = me.dingque;
      this.writeStoredDingqueSuit(me.dingque);
      return;
    }
    if (state.phase === 'dingque' && me.dingqueReady === true) {
      const stored = this.readStoredDingqueSuit();
      if (stored) {
        this.ackedDingqueSuit = stored;
        this.localCommittedDingqueSuit = stored;
      }
    }

    this.maybeResendDingqueAction();
  }

  private maybeResendDingqueAction(): void {
    if (!this.isAuthoritative() || !this.actionsReady()) return;
    const state = this.blood.get(0) as BloodState | null;
    if (!state || state.phase !== 'dingque') return;
    const me = this.resolveMyPlayerState(state);
    if (!me) return;
    if (me.dingqueReady === true || me.dingque !== null) return;

    const suit = (this.localCommittedDingqueSuit ?? this.readStoredDingqueSuit()) as BloodSuit | null;
    if (suit !== 'm' && suit !== 'p' && suit !== 's') return;

    const now = Date.now();
    // 防抖：避免在弱网/高频 update 下疯狂重发。
    if (this.lastAutoResendDingqueSuit === suit && now - this.lastAutoResendDingqueAtMs < 1500) return;
    this.lastAutoResendDingqueAtMs = now;
    this.lastAutoResendDingqueSuit = suit;

    this.sendBloodAction({ kind: 'dingque', suit });
  }

  private onActionAck(ack: Extract<Message, { type: 'ACTION_ACK' }>): void {
    const action = this.pendingActionById.get(ack.actionId) ?? null;
    if (!action) return;
    this.pendingActionById.delete(ack.actionId);
    if (action.kind !== 'dingque') return;
    if (ack.ok) {
      // 以服务端接受的 action 为准，修正连点/乱序造成的本地花色漂移。
      this.ackedDingqueSuit = action.suit;
      this.localCommittedDingqueSuit = action.suit;
      this.writeStoredDingqueSuit(action.suit);
      return;
    }
    // 断线重连竞态：可能重复补发已被服务端记录的定缺，服务端会回 already dingque 且不更新 blood。
    // 这类 ACK 失败不应清空本地/落盘花色，否则 HUD/UI 会丢失已选信息。
    if (String(ack.error ?? '').trim() === 'already dingque') {
      return;
    }
    const committed = this.authoritativeDingqueSuit();
    if (committed !== null) {
      this.localCommittedDingqueSuit = committed;
      return;
    }
    if (this.localCommittedDingqueSuit === action.suit) {
      this.localCommittedDingqueSuit = null;
      this.writeStoredDingqueSuit(null);
    }
  }

  bindLoginToken(loginToken: string): void {
    const token = (loginToken ?? '').trim();
    if (!token) return;
    // Best-effort; server will ignore if not joined yet.
    this.send({ type: 'BIND_USER', loginToken: token } as any);
  }

  sendReplayLog(events: Array<any>): void {
    if (!Array.isArray(events) || events.length === 0) return;
    this.send({ type: 'REPLAY_LOG', events } as any);
  }

  aiGetTemplates(): void {
    this.send({ type: 'AI_TEMPLATES_GET' } as any);
  }

  aiSaveTemplate(params: { mode: 'create' | 'update' | 'clone'; template: Partial<Pick<AiTemplate, 'id'>> & Pick<AiTemplate, 'scene' | 'name' | 'model' | 'body'>; setDefault?: boolean }): void {
    this.send({ type: 'AI_TEMPLATE_SAVE', mode: params.mode, template: params.template, setDefault: params.setDefault } as any);
  }

  aiDeleteTemplate(templateId: string): void {
    this.send({ type: 'AI_TEMPLATE_DELETE', templateId } as any);
  }

  aiSetDefaultTemplate(scene: AiScene, templateId: string | null): void {
    this.send({ type: 'AI_TEMPLATE_SET_DEFAULT', scene, templateId } as any);
  }

  aiGetHistory(gameId: string): void {
    this.send({ type: 'AI_HISTORY_GET', gameId } as any);
  }

  aiRecommend(params: {
    clientRequestId?: string | null;
    gameId: string;
    scene: AiScene;
    templateId?: string | null;
    model?: string | null;
    prompt: string;
  }): void {
    this.send({ type: 'AI_RECOMMEND', ...params } as any);
  }

  aiFollowup(params: {
    clientRequestId?: string | null;
    gameId: string;
    scene: AiScene;
    snapshotId: string;
    followupMode?: AiFollowupMode | null;
    model?: string | null;
    prompt: string;
    question: string;
  }): void {
    this.send({ type: 'AI_FOLLOWUP', ...params } as any);
  }

  aiPreview(params: {
    gameId: string;
    scene: AiScene;
    kind: 'recommend' | 'followup';
    snapshotId?: string | null;
    model?: string | null;
    prompt: string;
    question?: string | null;
  }): void {
    this.send({ type: 'AI_PREVIEW_GET', ...params } as any);
  }

  setBloodConfig(params: { gameId: string; config: { waitMode: 'noTimeout' | 'timeoutAuto'; timeoutMs?: number | null } }): void {
    this.send({ type: 'BLOOD_CONFIG_SET', ...params } as any);
  }

  setFriendConfig(params: { gameId: string; config: { waitMode: 'noTimeout' | 'timeoutAuto'; timeoutMs?: number | null } }): void {
    this.send({ type: 'FRIEND_CONFIG_SET', ...params } as any);
  }

  setGuobiaoConfig(params: { gameId: string; config: { autoBuhua?: boolean; autoBuhuaBySeat?: Record<number, boolean> } }): void {
    this.send({ type: 'GUOBIAO_CONFIG_SET', ...params } as any);
  }
}

interface CollectionOptions {
  // Key that has to be kept unique. Enforced by the server.
  // For example, for 'things', the unique key is 'slotName', and if you
  // attempt to store two things with the same slots, server will reject the
  // update.
  unique?: string;

  // Updates will be sent to other players, but not stored on the server (new
  // will not receive them on connection).
  ephemeral?: boolean;

  // This is a collection indexed by player ID, and values will be deleted
  // when a player disconnect.
  perPlayer?: boolean;

  // The server will not send all updates, but limit to N per second.
  rateLimit?: number;

  // If we are initializing the server (i.e. we're the first player), send
  // our value.
  sendOnConnect?: boolean;
}

export class Collection<K extends string | number, V> {
  private kind: string;
  private client: Client;
  private map: Map<K, V> = new Map();
  private pending: Map<K, V | null> = new Map();
  private events: EventEmitter = new EventEmitter();
  private options: CollectionOptions;
  private intervalId: any | null = null;
  private lastUpdate: number = 0;

  constructor(
    kind: string,
    client: Client,
    options?: CollectionOptions) {

    this.kind = kind;
    this.client = client;
    this.options = options ?? {};

    this.client.on('update', this.onUpdate.bind(this));
    this.client.on('connect', this.onConnect.bind(this));
    this.client.on('disconnect', this.onDisconnect.bind(this));
  }

  entries(): Iterable<[K, V]> {
    return this.map.entries();
  }

  get(key: K): V | null {
    return this.map.get(key) ?? null;
  }

  update(localEntries: Array<[K, V | null]>): void {
    if (!this.client.connected()) {
      for (const [key, value] of localEntries) {
        if (value !== null) {
          this.map.set(key, value);
        } else {
          this.map.delete(key);
        }
      }
      this.events.emit('update', localEntries, false);
    } else {
      const now = new Date().getTime();
      for (const [key, value] of localEntries) {
        this.pending.set(key, value);
      }
      if (!this.options.rateLimit || now > this.lastUpdate + this.options.rateLimit) {
        this.sendPending();
      }
    }
  }

  set(key: K, value: V | null): void {
    this.update([[key, value]]);
  }

  on(what: 'update', handler: (localEntries: Array<[K, V | null]>, full: boolean) => void): void;
  on(what: string, handler: (...args: any[]) => void): void {
    this.events.on(what, handler);
  }

  private onUpdate(entries: Array<Entry>, full: boolean): void {
    if (full) {
      this.map.clear();
    }
    const localEntries = [];
    for (const [kind, key, value] of entries) {
      if (kind === this.kind) {
        localEntries.push([key, value]);
        if (value !== null) {
          this.map.set(key as K, value);
        } else {
          this.map.delete(key as K);
        }
      }
    }
    if (full || localEntries.length > 0) {
      console.log(full ? 'full update' : 'update', this.kind, localEntries.length);
      this.events.emit('update', localEntries, full);
    }
  }

  private onConnect(_game: Game, isFirst: boolean): void {
    if (isFirst) {
      if (this.options.unique) {
        this.client.update([['unique', this.kind, this.options.unique]]);
      }
      if (this.options.ephemeral) {
        this.client.update([['ephemeral', this.kind, true]]);
      }
      if (this.options.perPlayer) {
        this.client.update([['perPlayer', this.kind, true]]);
      }
      if (this.options.sendOnConnect) {
        const entries: Array<Entry> = [];
        for (const [key, value] of this.map.entries()) {
          entries.push([this.kind, key, value]);
        }
        this.client.update(entries);
      }
    }
    if (this.options.rateLimit) {
      this.intervalId = setInterval(this.sendPending.bind(this), this.options.rateLimit);
    }
  }

  private onDisconnect(game: Game | null): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (game && this.options.perPlayer) {
      const localEntries: Array<Entry> = [];
      for (const [key, value] of this.map.entries()) {
        localEntries.push([this.kind, key, null]);
        if (key === game.playerId) {
          localEntries.push([this.kind, 'offline', value]);
        }
      }
      this.onUpdate(localEntries, true);
    }
  }

  private sendPending(): void {
    if (this.pending.size > 0) {
      const entries: Array<Entry> = [];
      for (const [k, v] of this.pending.entries()) {
        entries.push([this.kind, k, v]);
      }
      this.client.update(entries);
      this.lastUpdate = new Date().getTime();
      this.pending.clear();
    }
  }
}
