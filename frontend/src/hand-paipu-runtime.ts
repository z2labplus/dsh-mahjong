import type { ThingInfo, MatchInfo, Conditions } from './types';
import type { Client } from './client';
import type { BloodGangType, BloodLedgerEntry, BloodMeld, BloodPlayerState, BloodState, BloodSuit } from './blood';
import type { PaipuDetail } from './paipu-api';
import { canHuCounts } from './blood-win';
import { DealType, GameType } from './types';

type TileToken = {
  tileId: number;
  code: string | null;
};

type SeatMeldState = {
  kind: 'peng' | 'gang';
  tile: string;
  fromSeat: number | null;
  gangType: BloodGangType;
  tokens: Array<TileToken>;
};

type SeatState = {
  concealed: Array<TileToken>;
  extra: TileToken | null;
  discards: Array<TileToken>;
  melds: Array<SeatMeldState>;
  dingque: BloodSuit | null;
  hu: boolean;
  huSource: 'self' | 'discard' | null;
  huTile: string | null;
  dingqueReady: boolean;
  beans: number;
  kongGain: number;
};

type PendingAddKongState = {
  fromSeat: number;
  tile: string;
  tileId: number;
};

type RuntimeMutableState = {
  phase: BloodState['phase'];
  turnSeat: number;
  turnStep: BloodState['turnStep'];
  players: Record<number, SeatState>;
  wall: Array<TileToken>;
  huTaken: Array<TileToken>;
  ledger: Array<BloodLedgerEntry>;
  endSummary: BloodState['endSummary'];
  nextId: number;
  swap3: BloodState['swap3'] | null;
  pendingAddKong: PendingAddKongState | null;
};

type HandPaipuFrame = {
  eventIndex: number;
  title: string;
  detail: string;
  blood: BloodState;
  things: Array<[number, ThingInfo]>;
  tileFacePublic: Array<[number, number | null]>;
  tileFaceSelf: Array<[number, number | null]>;
};

type BloodClaimOption = { hu: boolean; peng: boolean; gang: boolean };

function tileSortValue(code: string): number {
  const value = String(code ?? '').trim();
  const rank = Number(value.slice(0, -1));
  const suit = value.slice(-1);
  const suitOrder = suit === 'm' ? 0 : suit === 'p' ? 1 : suit === 's' ? 2 : 9;
  return suitOrder * 10 + (Number.isFinite(rank) ? rank : 0);
}

function sortTileCodes(codes: Array<string>): Array<string> {
  return [...codes].sort((a, b) => tileSortValue(a) - tileSortValue(b) || a.localeCompare(b));
}

function normalizeEventAt(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : Date.now();
}

function removeTokenByCode(list: Array<TileToken>, code: string): TileToken | null {
  const idx = list.findIndex((item) => item.code === code);
  if (idx < 0) return null;
  return list.splice(idx, 1)[0] ?? null;
}

function takeLastToken(list: Array<TileToken>): TileToken | null {
  return list.length > 0 ? (list.pop() ?? null) : null;
}

function tileKeyFromCode(code: string | null): number | null {
  const raw = String(code ?? '').trim();
  const m = /^([1-9])([mps])$/.exec(raw);
  if (!m) return null;
  const rank = parseInt(m[1] ?? '', 10);
  const suit = m[2] ?? '';
  if (!Number.isFinite(rank) || rank < 1 || rank > 9) return null;
  const base = suit === 'm' ? 0 : suit === 'p' ? 9 : suit === 's' ? 18 : -1;
  if (base < 0) return null;
  return base + rank - 1;
}

function normalizeSuit(raw: unknown): BloodSuit | null {
  return raw === 'm' || raw === 'p' || raw === 's' ? raw : null;
}

function suitOf(tileKey: number): BloodSuit {
  if (tileKey < 9) return 'm';
  if (tileKey < 18) return 'p';
  return 's';
}

function hasSuit(counts: ReadonlyArray<number>, suit: BloodSuit): boolean {
  for (let i = 0; i < counts.length; i += 1) {
    if ((counts[i] ?? 0) > 0 && suitOf(i) === suit) {
      return true;
    }
  }
  return false;
}

function sortOwnerHandTokens(tokens: Array<TileToken>): Array<TileToken> {
  return [...tokens].sort((a, b) => tileSortValue(a.code ?? '0z') - tileSortValue(b.code ?? '0z') || a.tileId - b.tileId);
}

function cloneLedgerEntry(entry: any): BloodLedgerEntry {
  return {
    kind: entry?.kind === 'kong' || entry?.kind === 'penalty' ? entry.kind : 'hu',
    label: String(entry?.label ?? '').trim(),
    seat: Number.isFinite(entry?.seat) ? Math.trunc(entry.seat) : undefined,
    fromSeat: Number.isFinite(entry?.fromSeat) ? Math.trunc(entry.fromSeat) : undefined,
    multiplier: Number.isFinite(entry?.multiplier) ? Math.trunc(entry.multiplier) : 0,
    transfers: Array.isArray(entry?.transfers)
      ? entry.transfers
          .filter((item: any) => Number.isFinite(item?.fromSeat) && Number.isFinite(item?.toSeat) && Number.isFinite(item?.beans))
          .map((item: any) => ({
            fromSeat: Math.trunc(item.fromSeat),
            toSeat: Math.trunc(item.toSeat),
            beans: Math.trunc(item.beans),
          }))
      : [],
    at: Number.isFinite(entry?.at) ? Math.trunc(entry.at) : Date.now(),
    fans: Array.isArray(entry?.fans)
      ? entry.fans
          .filter((item: any) => item && typeof item === 'object')
          .map((item: any) => ({
            id: String(item.id ?? ''),
            name: String(item.name ?? ''),
            multiplier: Number.isFinite(item.multiplier) ? Math.trunc(item.multiplier) : 0,
          }))
      : undefined,
    multiplierRaw: Number.isFinite(entry?.multiplierRaw) ? Math.trunc(entry.multiplierRaw) : undefined,
    cap: Number.isFinite(entry?.cap) ? Math.trunc(entry.cap) : undefined,
    note: typeof entry?.note === 'string' ? entry.note : undefined,
  };
}

function bloodConditions(): Conditions {
  return {
    gameType: GameType.BLOOD_BATTLE,
    back: 0,
    fives: '000',
    points: '25',
    dealType: DealType.HANDS,
  };
}

function buildInitialOwnerHand(detail: PaipuDetail): Array<string> {
  const ownerSeat = detail.perspective.ownerSeat;
  const handEvent =
    detail.events.find((event: any) => event?.type === 'hands' && Array.isArray(event?.private?.[String(ownerSeat)]?.hand)) ?? null;
  const current = Array.isArray(handEvent?.private?.[String(ownerSeat)]?.hand)
    ? handEvent.private[String(ownerSeat)].hand.map((item: any) => String(item ?? '').trim()).filter(Boolean)
    : [];
  if (current.length <= 0) return [];
  const swapEvent = detail.events.find((event: any) => event?.type === 'swap3' && event?.private?.[String(ownerSeat)]) ?? null;
  const incoming = Array.isArray(swapEvent?.private?.[String(ownerSeat)]?.in)
    ? swapEvent.private[String(ownerSeat)].in.map((item: any) => String(item ?? '').trim()).filter(Boolean)
    : [];
  const outgoing = Array.isArray(swapEvent?.private?.[String(ownerSeat)]?.out)
    ? swapEvent.private[String(ownerSeat)].out.map((item: any) => String(item ?? '').trim()).filter(Boolean)
    : [];
  const out = [...current];
  for (const code of incoming) {
    const idx = out.indexOf(code);
    if (idx >= 0) out.splice(idx, 1);
  }
  out.push(...outgoing);
  return sortTileCodes(out);
}

function wallSlotNames(): Array<string> {
  const out: Array<string> = [];
  for (let seat = 0; seat < 2; seat += 1) {
    for (let col = 0; col < 19; col += 1) {
      out.push(`wall.${col}.0@${seat}`);
      out.push(`wall.${col}.1@${seat}`);
    }
  }
  return out.slice(0, 55);
}

function discardSlotName(seat: number, index: number): string {
  const row = Math.trunc(index / 6);
  const col = index % 6;
  if (index < 18) {
    return `discard.${row}.${col}@${seat}`;
  }
  return `discard.stack.${row - 3}.${col}@${seat}`;
}

function huTakenSlotName(index: number): string {
  return `hu.taken.${index}`;
}

function cloneSeatState(src: SeatState): SeatState {
  return {
    concealed: src.concealed.map((token) => ({ ...token })),
    extra: src.extra ? { ...src.extra } : null,
    discards: src.discards.map((token) => ({ ...token })),
    melds: src.melds.map((meld) => ({
      ...meld,
      tokens: meld.tokens.map((token) => ({ ...token })),
    })),
    dingque: src.dingque,
    hu: src.hu,
    huSource: src.huSource,
    huTile: src.huTile,
    dingqueReady: src.dingqueReady,
    beans: src.beans,
    kongGain: src.kongGain,
  };
}

function cloneMutableState(src: RuntimeMutableState): RuntimeMutableState {
  return {
    phase: src.phase,
    turnSeat: src.turnSeat,
    turnStep: src.turnStep,
    players: {
      0: cloneSeatState(src.players[0]!),
      1: cloneSeatState(src.players[1]!),
      2: cloneSeatState(src.players[2]!),
      3: cloneSeatState(src.players[3]!),
    },
    wall: src.wall.map((token) => ({ ...token })),
    huTaken: src.huTaken.map((token) => ({ ...token })),
    ledger: src.ledger.map((entry) => cloneLedgerEntry(entry)),
    endSummary: src.endSummary ? JSON.parse(JSON.stringify(src.endSummary)) : undefined,
    nextId: src.nextId,
    swap3: src.swap3 ? JSON.parse(JSON.stringify(src.swap3)) : null,
    pendingAddKong: src.pendingAddKong ? { ...src.pendingAddKong } : null,
  };
}

export class HandPaipuRuntime {
  private readonly detail: PaipuDetail;
  private readonly ownerSeat: number;
  private readonly ownerPlayerId: string;
  private readonly playerIds: Record<number, string>;
  private readonly settlementHandsBySeat: Record<number, Array<string>>;
  private readonly matchInfo: MatchInfo & { roomType: string | null };
  private readonly seatEntries: Array<[string, { seat: number; startBeans: number }]>;
  private readonly nickEntries: Array<[string, string]>;
  private readonly avatarEntries: Array<[string, number]>;
  private readonly frames: Array<HandPaipuFrame>;
  private readonly navigationIndices: Array<number>;
  private currentIndex = 0;

  constructor(detail: PaipuDetail, tileIds: Array<number>, ownerPlayerId: string) {
    this.detail = detail;
    this.ownerSeat = Math.trunc(detail.perspective.ownerSeat ?? 0);
    this.ownerPlayerId = ownerPlayerId;
    this.playerIds = {
      0: this.ownerSeat === 0 ? ownerPlayerId : 'paipu-seat-0',
      1: this.ownerSeat === 1 ? ownerPlayerId : 'paipu-seat-1',
      2: this.ownerSeat === 2 ? ownerPlayerId : 'paipu-seat-2',
      3: this.ownerSeat === 3 ? ownerPlayerId : 'paipu-seat-3',
    };
    this.settlementHandsBySeat = {
      0: Array.isArray(detail.settlementHandsBySeat?.['0']) ? detail.settlementHandsBySeat!['0'].map((item) => String(item ?? '').trim()).filter(Boolean) : [],
      1: Array.isArray(detail.settlementHandsBySeat?.['1']) ? detail.settlementHandsBySeat!['1'].map((item) => String(item ?? '').trim()).filter(Boolean) : [],
      2: Array.isArray(detail.settlementHandsBySeat?.['2']) ? detail.settlementHandsBySeat!['2'].map((item) => String(item ?? '').trim()).filter(Boolean) : [],
      3: Array.isArray(detail.settlementHandsBySeat?.['3']) ? detail.settlementHandsBySeat!['3'].map((item) => String(item ?? '').trim()).filter(Boolean) : [],
    };
    const bySeat = [0, 1, 2, 3].map((seat) => detail.players.find((player) => player.seat === seat) ?? null);
    this.matchInfo = {
      dealer: Math.trunc(detail.rules?.dealer ?? 0),
      honba: 0,
      conditions: bloodConditions(),
      bloodConfig: { waitMode: 'noTimeout', timeoutMs: null },
      roomType: detail.roomType ?? null,
    };
    this.seatEntries = [0, 1, 2, 3].map((seat) => [
      this.playerIds[seat]!,
      {
        seat,
        startBeans: Math.trunc(bySeat[seat]?.startBeans ?? (seat === this.ownerSeat ? detail.summary.startBeans : 0)),
      },
    ]);
    this.nickEntries = [0, 1, 2, 3].map((seat) => [
      this.playerIds[seat]!,
      String(bySeat[seat]?.nickname ?? `玩家${seat + 1}`),
    ]);
    this.avatarEntries = [0, 1, 2, 3].map((seat) => [
      this.playerIds[seat]!,
      Number.isFinite(bySeat[seat]?.avatarIndex) ? Math.trunc(bySeat[seat]!.avatarIndex) : seat,
    ]);
    this.frames = this.buildFrames(tileIds);
    this.navigationIndices = this.buildNavigationIndices();
  }

  bindClient(client: Client): void {
    client.setLocalGame({ gameId: this.detail.gameId, playerId: this.ownerPlayerId, authoritative: true });
    client.match.update([[0, this.matchInfo]]);
    client.seats.update(this.seatEntries);
    client.nicks.update(this.nickEntries);
    client.avatars.update(this.avatarEntries);
    this.applyCurrentFrame(client);
  }

  canPrev(): boolean {
    return this.findPrevNavigationIndex(this.currentIndex) !== null;
  }

  canNext(): boolean {
    return this.findNextNavigationIndex(this.currentIndex) !== null;
  }

  prev(client: Client): boolean {
    const prevIndex = this.findPrevNavigationIndex(this.currentIndex);
    if (prevIndex === null) return false;
    this.currentIndex = prevIndex;
    this.applyCurrentFrame(client);
    return true;
  }

  next(client: Client): boolean {
    const nextIndex = this.findNextNavigationIndex(this.currentIndex);
    if (nextIndex === null) return false;
    this.currentIndex = nextIndex;
    this.applyCurrentFrame(client);
    return true;
  }

  currentFrame(): HandPaipuFrame | null {
    return this.frames[this.currentIndex] ?? null;
  }

  currentEventIndex(): number | null {
    return this.currentFrame()?.eventIndex ?? null;
  }

  private applyCurrentFrame(client: Client): void {
    const frame = this.currentFrame();
    if (!frame) return;
    client.things.update(frame.things);
    client.blood.update([[0, frame.blood]]);
    client.tileFacePublic.update(frame.tileFacePublic);
    client.tileFaceSelf.update(frame.tileFaceSelf);
  }

  private buildFrames(tileIds: Array<number>): Array<HandPaipuFrame> {
    const ids = [...tileIds].sort((a, b) => a - b);
    if (ids.length < 108) {
      throw new Error(`牌谱回放初始化失败：牌桌瓦片数量不足（${ids.length}/108）`);
    }
    const mutable = this.makeInitialState(ids.slice(0, 108));
    const out: Array<HandPaipuFrame> = [];
    for (let index = 0; index < this.detail.events.length; index += 1) {
      const event = this.detail.events[index] ?? null;
      if (!event) continue;
      this.applyEvent(mutable, event);
      out.push(this.buildFrame(index, mutable, event));
    }
    return out;
  }

  private buildNavigationIndices(): Array<number> {
    const out: Array<number> = [];
    for (let frameIndex = 0; frameIndex < this.frames.length; frameIndex += 1) {
      const frame = this.frames[frameIndex] ?? null;
      const event = frame ? (this.detail.events[frame.eventIndex] ?? null) : null;
      if (!this.isNavigationEvent(event)) continue;
      out.push(frameIndex);
    }
    return out;
  }

  private isNavigationEvent(event: any): boolean {
    const type = String(event?.type ?? '').trim();
    const seat = Number.isFinite(event?.public?.seat) ? Math.trunc(event.public.seat) : null;
    if (type === 'swap3_select') return seat === this.ownerSeat;
    if (type === 'swap3') return true;
    if (type === 'dingque') return seat === this.ownerSeat;
    // 牌谱模式下，自己的“可拆牌时点”必须能停住：
    // 1. 庄家首打前的 hands 帧
    // 2. 自己摸牌后的 draw 帧
    if (type === 'hands') return Math.trunc(this.detail.rules?.dealer ?? 0) === this.ownerSeat;
    if (type === 'draw') return seat === this.ownerSeat;
    return type === 'discard' || type === 'peng' || type === 'gang' || type === 'hu' || type === 'ledger' || type === 'end';
  }

  private findPrevNavigationIndex(fromIndex: number): number | null {
    for (let i = this.navigationIndices.length - 1; i >= 0; i -= 1) {
      const value = this.navigationIndices[i] ?? null;
      if (value !== null && value < fromIndex) return value;
    }
    return null;
  }

  private findNextNavigationIndex(fromIndex: number): number | null {
    for (const value of this.navigationIndices) {
      if (value > fromIndex) return value;
    }
    return null;
  }

  private makeInitialState(tileIds: Array<number>): RuntimeMutableState {
    const wall = tileIds.map((tileId) => ({ tileId, code: null as string | null }));
    const dealer = Math.trunc(this.detail.rules?.dealer ?? 0);
    const ownerInitial = buildInitialOwnerHand(this.detail);
    const players: Record<number, SeatState> = {} as Record<number, SeatState>;
    for (let seat = 0; seat < 4; seat += 1) {
      const visible = seat === this.ownerSeat ? [...ownerInitial] : [];
      const concealedCount = seat === dealer ? 14 : 13;
      const concealed: Array<TileToken> = [];
      let extra: TileToken | null = null;
      for (let i = 0; i < concealedCount; i += 1) {
        const token = wall.shift();
        if (!token) throw new Error('牌谱回放初始化失败：牌墙不足');
        if (seat === this.ownerSeat) {
          token.code = visible[i] ?? null;
        }
        if (seat === dealer && i === concealedCount - 1) {
          extra = token;
        } else {
          concealed.push(token);
        }
      }
      players[seat] = {
        concealed: seat === this.ownerSeat ? sortOwnerHandTokens(concealed) : concealed,
        extra,
        discards: [],
        melds: [],
        dingque: null,
        hu: false,
        huSource: null,
        huTile: null,
        dingqueReady: false,
        beans: Math.trunc(this.detail.players.find((player) => player.seat === seat)?.startBeans ?? 0),
        kongGain: 0,
      };
    }
    return {
      phase: 'swap3',
      turnSeat: dealer,
      turnStep: 'discard',
      players,
      wall,
      huTaken: [],
      ledger: [],
      endSummary: undefined,
      nextId: 1,
      swap3: {
        dir: 'cw',
        since: this.detail.createdAt,
        animatingSince: null,
        selections: { 0: null, 1: null, 2: null, 3: null },
      },
      pendingAddKong: null,
    };
  }

  private applyEvent(state: RuntimeMutableState, event: any): void {
    const type = String(event?.type ?? '').trim();
    const pub = event?.public ?? null;
    const priv = event?.private?.[String(this.ownerSeat)] ?? null;
    if (type === 'phase') {
      const to = String(pub?.to ?? '').trim();
      if (to === 'swap3' || to === 'dingque' || to === 'playing' || to === 'settling' || to === 'done') {
        state.phase = to;
      }
      if (to === 'dingque') {
        state.swap3 = null;
      }
      if (to === 'playing') {
        state.turnSeat = Math.trunc(this.detail.rules?.dealer ?? 0);
        state.turnStep = 'discard';
      }
      if (to === 'done' || to === 'settling') {
        state.turnStep = 'drawOrKong';
      }
      return;
    }

    if (type === 'swap3_select') {
      const seat = Number.isFinite(pub?.seat) ? Math.trunc(pub.seat) : null;
      if (seat !== null && state.swap3) {
        const selectedIds = seat === this.ownerSeat
          ? this.resolveOwnerSwap3SelectionIds(state.players[seat]!, Array.isArray(priv?.tiles) ? priv.tiles : [])
          : [];
        state.swap3 = {
          ...state.swap3,
          selections: { ...state.swap3.selections, [seat]: selectedIds },
        };
      }
      return;
    }

    if (type === 'swap3') {
      if (state.swap3) {
        const dir = String(pub?.dir ?? '').trim();
        if (dir === 'cw' || dir === 'ccw' || dir === 'across') {
          state.swap3 = { ...state.swap3, dir, animatingSince: normalizeEventAt(event?.at) };
        }
      }
      const incoming = Array.isArray(priv?.in) ? priv.in.map((item: any) => String(item ?? '').trim()).filter(Boolean) : [];
      const outgoing = Array.isArray(priv?.out) ? priv.out.map((item: any) => String(item ?? '').trim()).filter(Boolean) : [];
      if (incoming.length > 0 || outgoing.length > 0) {
        this.reconcileOwnerHandCodes(state, incoming, outgoing);
      }
      return;
    }

    if (type === 'dingque') {
      const seat = Number.isFinite(pub?.seat) ? Math.trunc(pub.seat) : null;
      const suit = normalizeSuit(pub?.suit) ?? normalizeSuit(priv?.suit);
      if (seat !== null && state.players[seat]) {
        state.players[seat]!.dingqueReady = true;
        if (suit) {
          state.players[seat]!.dingque = suit;
        }
      }
      return;
    }

    if (type === 'hands') {
      const hand = Array.isArray(priv?.hand) ? priv.hand.map((item: any) => String(item ?? '').trim()).filter(Boolean) : [];
      if (hand.length > 0) {
        this.setOwnerHandExact(state, hand);
      }
      state.phase = 'playing';
      state.turnSeat = Math.trunc(this.detail.rules?.dealer ?? 0);
      state.turnStep = 'discard';
      return;
    }

    if (type === 'draw') {
      const seat = Number.isFinite(pub?.seat) ? Math.trunc(pub.seat) : null;
      if (seat === null) return;
      this.mergeExtraIntoHand(state.players[seat]!, seat);
      const token = state.wall.shift();
      if (!token) return;
      token.code = seat === this.ownerSeat && typeof priv?.tile === 'string' ? String(priv.tile).trim() || null : null;
      state.players[seat]!.extra = token;
      state.turnSeat = seat;
      state.turnStep = 'discard';
      return;
    }

    if (type === 'discard') {
      const seat = Number.isFinite(pub?.seat) ? Math.trunc(pub.seat) : null;
      const tile = String(pub?.tile ?? '').trim();
      if (seat === null || !tile) return;
      const player = state.players[seat]!;
      let discarded: TileToken | null = null;
      if (seat === this.ownerSeat) {
        if (player.extra && player.extra.code === tile) {
          discarded = player.extra;
          player.extra = null;
        } else {
          discarded = removeTokenByCode(player.concealed, tile);
          if (player.extra) {
            player.concealed.push(player.extra);
            player.extra = null;
            player.concealed = sortOwnerHandTokens(player.concealed);
          }
        }
      } else {
        discarded = player.extra ?? takeLastToken(player.concealed);
        player.extra = null;
      }
      if (!discarded) return;
      discarded.code = tile;
      player.discards.push(discarded);
      state.turnSeat = seat;
      state.turnStep = 'drawOrKong';
      return;
    }

    if (type === 'peng') {
      const seat = Number.isFinite(pub?.seat) ? Math.trunc(pub.seat) : null;
      const fromSeat = Number.isFinite(pub?.fromSeat) ? Math.trunc(pub.fromSeat) : null;
      const tile = String(pub?.tile ?? '').trim();
      if (seat === null || fromSeat === null || !tile) return;
      const fromPlayer = state.players[fromSeat]!;
      const calledIdx = fromPlayer.discards.map((item) => item.code).lastIndexOf(tile);
      const called = calledIdx >= 0 ? (fromPlayer.discards.splice(calledIdx, 1)[0] ?? null) : null;
      if (!called) return;
      const claimant = state.players[seat]!;
      const a = seat === this.ownerSeat ? removeTokenByCode(claimant.concealed, tile) : takeLastToken(claimant.concealed);
      const b = seat === this.ownerSeat ? removeTokenByCode(claimant.concealed, tile) : takeLastToken(claimant.concealed);
      if (!a || !b) return;
      a.code = tile;
      b.code = tile;
      const relFrom = ((fromSeat - seat) % 4 + 4) % 4;
      const slotTokens: Array<TileToken | null> = [null, null, null];
      const calledSlot = relFrom === 3 ? 2 : relFrom === 2 ? 1 : 0;
      slotTokens[calledSlot] = called;
      const others = [0, 1, 2].filter((value) => value !== calledSlot);
      slotTokens[others[0]!] = a;
      slotTokens[others[1]!] = b;
      claimant.melds.push({ kind: 'peng', tile, fromSeat, gangType: 'ming', tokens: slotTokens.filter(Boolean) as Array<TileToken> });
      state.turnSeat = seat;
      state.turnStep = 'discard';
      return;
    }

    if (type === 'gang') {
      const seat = Number.isFinite(pub?.seat) ? Math.trunc(pub.seat) : null;
      const fromSeat = Number.isFinite(pub?.fromSeat) ? Math.trunc(pub.fromSeat) : null;
      const tile = String(pub?.tile ?? '').trim();
      const gangType = String(pub?.gangType ?? '').trim() as BloodGangType;
      if (seat === null || !tile) return;
      const player = state.players[seat]!;
      if (pub?.pending) {
        if (gangType === 'add') {
          const pendingTile = this.findSeatTokenByCode(player, tile);
          state.pendingAddKong =
            pendingTile
              ? { fromSeat: seat, tile, tileId: pendingTile.tileId }
              : null;
        } else {
          state.pendingAddKong = null;
        }
        state.turnStep = 'drawOrKong';
        return;
      }
      state.pendingAddKong = null;
      if (gangType === 'add') {
        const target = player.melds.find((meld) => meld.kind === 'peng' && meld.tile === tile) ?? null;
        let token: TileToken | null = null;
        if (player.extra && player.extra.code === tile) {
          token = player.extra;
          player.extra = null;
        } else {
          token = seat === this.ownerSeat ? removeTokenByCode(player.concealed, tile) : takeLastToken(player.concealed);
        }
        if (target && token) {
          token.code = tile;
          target.kind = 'gang';
          target.gangType = 'add';
          target.tokens.push(token);
        }
        this.mergeExtraIntoHand(player, seat);
        state.turnSeat = seat;
        state.turnStep = 'drawOrKong';
        return;
      }

      const tokens: Array<TileToken> = [];
      if (gangType === 'ming' && fromSeat !== null) {
        const fromPlayer = state.players[fromSeat]!;
        const calledIdx = fromPlayer.discards.map((item) => item.code).lastIndexOf(tile);
        const called = calledIdx >= 0 ? (fromPlayer.discards.splice(calledIdx, 1)[0] ?? null) : null;
        if (called) tokens.push(called);
      }
      // Ming kong (from discard) is 1 called + 3 concealed = 4 tiles total.
      const need = 4;
      while (tokens.length < need) {
        const next = seat === this.ownerSeat ? removeTokenByCode(player.concealed, tile) : takeLastToken(player.concealed);
        if (!next) break;
        next.code = tile;
        tokens.push(next);
      }
      if (tokens.length < need) return;
      if (gangType === 'ming' && fromSeat !== null) {
        const relFrom = ((fromSeat - seat) % 4 + 4) % 4;
        const slotTokens: Array<TileToken | null> = [null, null, null, null];
        const calledSlot = relFrom === 3 ? 2 : relFrom === 2 ? 1 : 0;
        slotTokens[calledSlot] = tokens[0]!;
        const others = [0, 1, 2, 3].filter((value) => value !== calledSlot);
        slotTokens[others[0]!] = tokens[1]!;
        slotTokens[others[1]!] = tokens[2]!;
        slotTokens[others[2]!] = tokens[3]!;
        player.melds.push({ kind: 'gang', tile, fromSeat, gangType: 'ming', tokens: slotTokens.filter(Boolean) as Array<TileToken> });
      } else {
        player.melds.push({ kind: 'gang', tile, fromSeat: null, gangType: 'an', tokens });
      }
      this.mergeExtraIntoHand(player, seat);
      state.turnSeat = seat;
      state.turnStep = 'drawOrKong';
      return;
    }

    if (type === 'hu') {
      const tile = String(pub?.tile ?? '').trim() || null;
      const source = String(pub?.source ?? '').trim();
      if (source === 'self') {
        const seat = Number.isFinite(pub?.seat) ? Math.trunc(pub.seat) : null;
        if (seat === null) return;
        const player = state.players[seat]!;
        player.hu = true;
        player.huSource = 'self';
        player.huTile = tile;
        state.pendingAddKong = null;
        state.turnSeat = seat;
        state.turnStep = 'drawOrKong';
        return;
      }
      const fromSeat = Number.isFinite(pub?.fromSeat) ? Math.trunc(pub.fromSeat) : null;
      const winners = Array.isArray(pub?.winners)
        ? pub.winners.filter((value: any) => Number.isFinite(value)).map((value: any) => Math.trunc(value))
        : [];
      if (fromSeat !== null && tile) {
        const fromPlayer = state.players[fromSeat]!;
        const idx = fromPlayer.discards.map((item) => item.code).lastIndexOf(tile);
        const taken =
          idx >= 0
            ? (fromPlayer.discards.splice(idx, 1)[0] ?? null)
            : this.matchesPendingAddKong(state.pendingAddKong, fromSeat, tile)
              ? this.takePendingAddKongToken(fromPlayer, state.pendingAddKong)
              : null;
        if (taken) {
          taken.code = tile;
          state.huTaken.push(taken);
        }
      }
      state.pendingAddKong = null;
      for (const seat of winners) {
        const player = state.players[seat]!;
        player.hu = true;
        player.huSource = 'discard';
        player.huTile = tile;
      }
      state.turnStep = 'drawOrKong';
      return;
    }

    if (type === 'ledger') {
      if (pub?.entry) {
        const entry = cloneLedgerEntry(pub.entry);
        state.ledger.push(entry);
        for (const transfer of entry.transfers) {
          const fromPlayer = state.players[transfer.fromSeat]!;
          const toPlayer = state.players[transfer.toSeat]!;
          fromPlayer.beans -= transfer.beans;
          toPlayer.beans += transfer.beans;
          if (entry.kind === 'kong' && transfer.toSeat >= 0 && transfer.toSeat <= 3) {
            state.players[transfer.toSeat]!.kongGain += transfer.beans;
          }
        }
      }
      return;
    }

    if (type === 'end') {
      const beans = pub?.beans ?? null;
      for (let seat = 0; seat < 4; seat += 1) {
        const value = Number((beans as any)?.[seat]);
        if (Number.isFinite(value)) {
          state.players[seat]!.beans = Math.trunc(value);
        }
      }
      if (pub?.endSummary) {
        state.endSummary = JSON.parse(JSON.stringify(pub.endSummary));
      }
      state.phase = 'done';
      state.turnStep = 'drawOrKong';
    }
  }

  private reconcileOwnerHandCodes(state: RuntimeMutableState, incoming: Array<string>, outgoing: Array<string>): void {
    const owner = state.players[this.ownerSeat]!;
    const current = [...owner.concealed, ...(owner.extra ? [owner.extra] : [])];
    const codes = current.map((token) => token.code).filter((value): value is string => !!value);
    for (const code of outgoing) {
      const idx = codes.indexOf(code);
      if (idx >= 0) codes.splice(idx, 1);
    }
    codes.push(...incoming);
    this.assignHandTokens(owner, sortTileCodes(codes), true);
  }

  private resolveOwnerSwap3SelectionIds(player: SeatState, rawCodes: Array<any>): Array<number> {
    const desiredCodes = rawCodes.map((item) => String(item ?? '').trim()).filter(Boolean);
    if (desiredCodes.length <= 0) return [];
    const tokens = [...player.concealed, ...(player.extra ? [player.extra] : [])];
    const byCode = new Map<string, Array<TileToken>>();
    for (const token of tokens) {
      if (!token.code) continue;
      const bucket = byCode.get(token.code) ?? [];
      bucket.push(token);
      byCode.set(token.code, bucket);
    }
    const used = new Set<number>();
    const out: Array<number> = [];
    for (const code of desiredCodes) {
      const bucket = byCode.get(code) ?? [];
      const token = bucket.find((item) => !used.has(item.tileId)) ?? null;
      if (!token) continue;
      used.add(token.tileId);
      out.push(token.tileId);
    }
    return out;
  }

  private setOwnerHandExact(state: RuntimeMutableState, hand: Array<string>): void {
    const owner = state.players[this.ownerSeat]!;
    this.assignHandTokens(owner, sortTileCodes(hand), true);
  }

  private assignHandTokens(player: SeatState, desiredCodes: Array<string>, sortConcealed: boolean): void {
    const pool = [...player.concealed, ...(player.extra ? [player.extra] : [])];
    while (pool.length < desiredCodes.length) {
      const token = takeLastToken(player.concealed);
      if (!token) break;
      pool.push(token);
    }
    const byCode = new Map<string, Array<TileToken>>();
    const rest: Array<TileToken> = [];
    const unused = new Set<TileToken>();
    for (const token of pool) {
      unused.add(token);
      if (token.code) {
        const bucket = byCode.get(token.code) ?? [];
        bucket.push(token);
        byCode.set(token.code, bucket);
      } else {
        rest.push(token);
      }
    }
    const takeBucketToken = (bucket: Array<TileToken>): TileToken | null => {
      while (bucket.length > 0) {
        const token = bucket.shift() ?? null;
        if (token && unused.has(token)) {
          unused.delete(token);
          return token;
        }
      }
      return null;
    };
    const takeRestToken = (): TileToken | null => {
      while (rest.length > 0) {
        const token = rest.shift() ?? null;
        if (token && unused.has(token)) {
          unused.delete(token);
          return token;
        }
      }
      return null;
    };
    const takeAnyUnusedToken = (): TileToken | null => {
      for (const token of unused) {
        unused.delete(token);
        return token;
      }
      return null;
    };
    const next: Array<TileToken> = [];
    for (const code of desiredCodes) {
      const bucket = byCode.get(code) ?? [];
      const token = takeBucketToken(bucket) ?? takeRestToken() ?? takeAnyUnusedToken();
      if (!token) continue;
      token.code = code;
      next.push(token);
    }
    const hasExtra = player.extra !== null || desiredCodes.length >= 14;
    player.extra = hasExtra && next.length > 0 ? (next.pop() ?? null) : null;
    player.concealed = sortConcealed ? sortOwnerHandTokens(next) : next;
  }

  private assignSettlementRevealHand(player: SeatState, seat: number): void {
    const desiredCodes = this.settlementHandsBySeat[seat] ?? [];
    const currentCount = player.concealed.length + (player.extra ? 1 : 0);
    if (currentCount <= 0 || desiredCodes.length !== currentCount) {
      return;
    }
    this.assignHandTokens(player, [...desiredCodes], false);
  }

  private mergeExtraIntoHand(player: SeatState, seat: number): void {
    if (!player.extra) return;
    player.concealed.push(player.extra);
    player.extra = null;
    if (seat === this.ownerSeat) {
      player.concealed = sortOwnerHandTokens(player.concealed);
    }
  }

  private buildFrame(eventIndex: number, mutable: RuntimeMutableState, sourceEvent: any): HandPaipuFrame {
    const state = cloneMutableState(mutable);
    const sourceType = String(sourceEvent?.type ?? '').trim();
    const sourceSeat = Number.isFinite(sourceEvent?.public?.seat) ? Math.trunc(sourceEvent.public.seat) : null;
    if (sourceType === 'dingque' && sourceSeat === this.ownerSeat && state.phase === 'playing') {
      state.phase = 'dingque';
    }
    const revealAllHands = state.phase === 'settling' || state.phase === 'done';
    if (revealAllHands) {
      for (let seat = 0; seat < 4; seat += 1) {
        this.assignSettlementRevealHand(state.players[seat]!, seat);
      }
    }
    const thingsById = new Map<number, ThingInfo>();
    const publicFacesById = new Map<number, number | null>();
    const selfFacesById = new Map<number, number | null>();
    const wallSlots = wallSlotNames();

    const assignThing = (token: TileToken, slotName: string, rotationIndex: number, faceScope: 'public' | 'self' | 'hidden'): void => {
      thingsById.set(token.tileId, {
        slotName,
        rotationIndex,
        claimedBy: null,
        heldRotation: { x: 0, y: 0, z: 0, w: 1 },
        shiftSlotName: null,
      });
      const key = tileKeyFromCode(token.code);
      if (faceScope === 'public') {
        publicFacesById.set(token.tileId, key);
        selfFacesById.set(token.tileId, null);
      } else if (faceScope === 'self') {
        selfFacesById.set(token.tileId, key);
        publicFacesById.set(token.tileId, null);
      } else {
        publicFacesById.set(token.tileId, null);
        selfFacesById.set(token.tileId, null);
      }
    };

    for (let seat = 0; seat < 4; seat += 1) {
      const player = state.players[seat]!;
      const concealed = seat === this.ownerSeat ? sortOwnerHandTokens(player.concealed) : [...player.concealed];
      for (let index = 0; index < concealed.length; index += 1) {
        const faceScope = revealAllHands ? 'public' : (seat === this.ownerSeat ? 'self' : 'hidden');
        assignThing(concealed[index]!, `hand.${index}@${seat}`, 0, faceScope);
      }
      if (player.extra) {
        const faceScope = revealAllHands ? 'public' : (seat === this.ownerSeat ? 'self' : 'hidden');
        assignThing(player.extra, `hand.extra@${seat}`, 0, faceScope);
      }
      for (let row = 0; row < player.melds.length; row += 1) {
        const meld = player.melds[row]!;
        if (meld.gangType === 'an') {
          const rotations = [2, 0, 0, 2];
          meld.tokens.forEach((token, idx) => {
            assignThing(token, `meld.${row}.${idx}@${seat}`, rotations[idx] ?? 0, 'public');
          });
          continue;
        }
        const relFrom = meld.fromSeat === null ? null : ((meld.fromSeat - seat) % 4 + 4) % 4;
        const calledIndex = relFrom === 3 ? 2 : relFrom === 2 ? 1 : 0;
        meld.tokens.forEach((token, idx) => {
          const rotationIndex =
            meld.gangType === 'add' && idx === 3
              ? 2
              : meld.fromSeat !== null && idx === calledIndex
                ? 1
                : 0;
          assignThing(token, `meld.${row}.${idx}@${seat}`, rotationIndex, 'public');
        });
      }
      for (let index = 0; index < player.discards.length; index += 1) {
        assignThing(player.discards[index]!, discardSlotName(seat, index), 0, 'public');
      }
    }

    for (let index = 0; index < state.huTaken.length; index += 1) {
      assignThing(state.huTaken[index]!, huTakenSlotName(index), 0, 'public');
    }
    for (let index = 0; index < state.wall.length && index < wallSlots.length; index += 1) {
      assignThing(state.wall[index]!, wallSlots[index]!, 0, 'hidden');
    }

    const things: Array<[number, ThingInfo]> = [];
    const tileFacePublic: Array<[number, number | null]> = [];
    const tileFaceSelf: Array<[number, number | null]> = [];
    for (const tileId of Array.from(thingsById.keys()).sort((a, b) => a - b)) {
      things.push([tileId, thingsById.get(tileId)!]);
      tileFacePublic.push([tileId, publicFacesById.get(tileId) ?? null]);
      tileFaceSelf.push([tileId, selfFacesById.get(tileId) ?? null]);
    }

    const bloodPlayers: Record<number, BloodPlayerState> = {} as Record<number, BloodPlayerState>;
    const initialBySeat: Record<number, number> = {} as Record<number, number>;
    for (let seat = 0; seat < 4; seat += 1) {
      const player = state.players[seat]!;
      const meta = this.detail.players.find((item) => item.seat === seat) ?? null;
      initialBySeat[seat] = Math.trunc(meta?.startBeans ?? 0);
      const melds: Array<BloodMeld> = player.melds.map((meld, row) => ({
        kind: meld.kind,
        tileKey: tileKeyFromCode(meld.tile) ?? 0,
        fromSeat: meld.fromSeat,
        gangType: meld.kind === 'gang' ? meld.gangType : undefined,
        row,
      }));
      bloodPlayers[seat] = {
        seat,
        playerId: this.playerIds[seat]!,
        dingque: player.dingque,
        dingqueReady: player.dingqueReady,
        hu: player.hu,
        huTileKey: tileKeyFromCode(player.huTile),
        huSource: player.huSource,
        beans: player.beans,
        kongGain: player.kongGain,
        melds,
      };
    }

    const pending = this.buildReplayClaimPending(state, eventIndex);
    const blood: BloodState = {
      version: 1,
      base: Math.trunc(this.detail.rules?.base ?? 400),
      initialBeans: initialBySeat[this.ownerSeat] ?? 0,
      initialBeansBySeat: initialBySeat,
      phase: state.phase,
      dealer: Math.trunc(this.detail.rules?.dealer ?? 0),
      turnSeat: state.turnSeat,
      turnStep: state.turnStep,
      wallOrder: state.wall.map((token) => token.tileId),
      wallIndex: 0,
      nextId: pending ? Math.max(state.nextId, pending.id + 1) : state.nextId,
      pending,
      afterGangSeat: null,
      swap3: state.swap3,
      ledger: state.ledger,
      players: bloodPlayers,
      revealAllHands,
      endSummary: state.endSummary,
      settlingSince: null,
    };
    const timeline = this.detail.timeline.find((item) => item.eventIndex === eventIndex) ?? null;
    return {
      eventIndex,
      title: timeline?.label ?? String(this.detail.events[eventIndex]?.type ?? '动作'),
      detail: timeline?.detail ?? '',
      blood,
      things,
      tileFacePublic,
      tileFaceSelf,
    };
  }

  private buildReplayClaimPending(state: RuntimeMutableState, eventIndex: number): BloodState['pending'] {
    if (state.phase !== 'playing') return null;
    const event = this.detail.events[eventIndex] ?? null;
    const type = String(event?.type ?? '').trim();
    const owner = state.players[this.ownerSeat] ?? null;
    if (!owner || owner.hu || owner.dingque === null) return null;

    if (type === 'discard') {
      const fromSeat = Number.isFinite(event?.public?.seat) ? Math.trunc(event.public.seat) : null;
      const tileCode = String(event?.public?.tile ?? '').trim();
      if (fromSeat === null || fromSeat === this.ownerSeat || !tileCode) return null;
      const tileKey = tileKeyFromCode(tileCode);
      if (tileKey === null || suitOf(tileKey) === owner.dingque) return null;
      const options = this.computeOwnerDiscardClaimOption(owner, tileKey);
      if (!options || (!options.hu && !options.peng && !options.gang)) return null;
      const discards = state.players[fromSeat]?.discards ?? [];
      const discarded = discards.length > 0 ? (discards[discards.length - 1] ?? null) : null;
      return this.makeClaimPending(eventIndex, {
        trigger: 'discard',
        fromSeat,
        tileId: discarded?.tileId ?? 0,
        tileKey,
        options,
      });
    }

    if (type === 'gang' && event?.public?.pending) {
      const fromSeat = Number.isFinite(event?.public?.seat) ? Math.trunc(event.public.seat) : null;
      const tileCode = String(event?.public?.tile ?? '').trim();
      if (fromSeat === null || fromSeat === this.ownerSeat || !tileCode) return null;
      const tileKey = tileKeyFromCode(tileCode);
      if (tileKey === null || suitOf(tileKey) === owner.dingque) return null;
      const canHu = this.computeOwnerRobKongHu(owner, tileKey);
      if (!canHu) return null;
      const pendingTile =
        this.matchesPendingAddKong(state.pendingAddKong, fromSeat, tileCode)
          ? this.findSeatTokenById(state.players[fromSeat] ?? null, state.pendingAddKong!.tileId)
          : this.findSeatTokenByCode(state.players[fromSeat] ?? null, tileCode);
      return this.makeClaimPending(eventIndex, {
        trigger: 'addKong',
        fromSeat,
        tileId: pendingTile?.tileId ?? 0,
        tileKey,
        options: { hu: true, peng: false, gang: false },
      });
    }

    return null;
  }

  private makeClaimPending(
    eventIndex: number,
    params: {
      trigger: 'discard' | 'addKong';
      fromSeat: number;
      tileId: number;
      tileKey: number;
      options: BloodClaimOption;
    },
  ): NonNullable<BloodState['pending']> {
    const ownerOptions: Record<number, BloodClaimOption> = {
      0: { hu: false, peng: false, gang: false },
      1: { hu: false, peng: false, gang: false },
      2: { hu: false, peng: false, gang: false },
      3: { hu: false, peng: false, gang: false },
    };
    ownerOptions[this.ownerSeat] = params.options;
    return {
      kind: 'claim',
      id: eventIndex + 1,
      since: normalizeEventAt(this.detail.events[eventIndex]?.at),
      trigger: params.trigger,
      fromSeat: params.fromSeat,
      tileId: params.tileId,
      tileKey: params.tileKey,
      options: ownerOptions,
      responses: { 0: null, 1: null, 2: null, 3: null },
    };
  }

  private computeOwnerDiscardClaimOption(owner: SeatState, tileKey: number): BloodClaimOption | null {
    const counts = this.ownerConcealedCounts(owner);
    const dingque = owner.dingque;
    if (!dingque) return null;
    const canHu = (() => {
      const countsAll = counts.slice();
      if (hasSuit(countsAll, dingque)) return false;
      countsAll[tileKey] += 1;
      return canHuCounts(countsAll, owner.melds.length);
    })();
    return {
      hu: canHu,
      peng: (counts[tileKey] ?? 0) >= 2,
      gang: (counts[tileKey] ?? 0) >= 3,
    };
  }

  private computeOwnerRobKongHu(owner: SeatState, tileKey: number): boolean {
    const dingque = owner.dingque;
    if (!dingque) return false;
    const counts = this.ownerConcealedCounts(owner);
    if (hasSuit(counts, dingque)) return false;
    counts[tileKey] += 1;
    return canHuCounts(counts, owner.melds.length);
  }

  private ownerConcealedCounts(owner: SeatState): Array<number> {
    const counts = new Array<number>(27).fill(0);
    const tokens = [...owner.concealed, ...(owner.extra ? [owner.extra] : [])];
    for (const token of tokens) {
      const tileKey = tileKeyFromCode(token.code);
      if (tileKey === null) continue;
      counts[tileKey] += 1;
    }
    return counts;
  }

  private findSeatTokenByCode(player: SeatState | null, code: string): TileToken | null {
    if (!player) return null;
    if (player.extra?.code === code) return player.extra;
    for (let i = player.concealed.length - 1; i >= 0; i -= 1) {
      const token = player.concealed[i] ?? null;
      if (token?.code === code) return token;
    }
    for (let i = player.discards.length - 1; i >= 0; i -= 1) {
      const token = player.discards[i] ?? null;
      if (token?.code === code) return token;
    }
    return null;
  }

  private findSeatTokenById(player: SeatState | null, tileId: number): TileToken | null {
    if (!player) return null;
    if (player.extra?.tileId === tileId) return player.extra;
    for (let i = player.concealed.length - 1; i >= 0; i -= 1) {
      const token = player.concealed[i] ?? null;
      if (token?.tileId === tileId) return token;
    }
    for (let i = player.discards.length - 1; i >= 0; i -= 1) {
      const token = player.discards[i] ?? null;
      if (token?.tileId === tileId) return token;
    }
    return null;
  }

  private matchesPendingAddKong(pending: PendingAddKongState | null, fromSeat: number, tile: string): pending is PendingAddKongState {
    return !!pending && pending.fromSeat === fromSeat && pending.tile === tile;
  }

  private takePendingAddKongToken(player: SeatState, pending: PendingAddKongState): TileToken | null {
    if (player.extra?.tileId === pending.tileId) {
      const token = player.extra;
      player.extra = null;
      return token;
    }
    const concealedIdx = player.concealed.findIndex((token) => token.tileId === pending.tileId);
    if (concealedIdx >= 0) {
      return player.concealed.splice(concealedIdx, 1)[0] ?? null;
    }
    return removeTokenByCode(player.concealed, pending.tile);
  }
}
