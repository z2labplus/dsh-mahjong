import type { ThingInfo, MatchInfo, Conditions } from './types';
import type { Client } from './client';
import type { PaipuDetail } from './paipu-api';
import type { GuobiaoState } from './guobiao';
import { DealType, GameType } from './types';

type GuobiaoReplayFramePublic = {
  gb: GuobiaoState;
  things: Array<[number, ThingInfo]>;
  tileFacePublic: Array<[number, number | null]>;
};

type GuobiaoReplayFramePrivate = {
  gb?: GuobiaoState;
  tileFaceSelf?: Array<[number, number | null]>;
};

type GuobiaoPaipuFrame = {
  eventIndex: number;
  title: string;
  detail: string;
  gb: GuobiaoState;
  things: Array<[number, ThingInfo]>;
  tileFacePublic: Array<[number, number | null]>;
  tileFaceSelf: Array<[number, number | null]>;
};

function guobiaoConditions(): Conditions {
  return {
    gameType: GameType.GUOBIAO,
    back: 0,
    fives: '000',
    points: '25',
    dealType: DealType.HANDS,
  };
}

function normalizeFrameEntries<T>(raw: unknown): Array<[number, T | null]> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: any) => {
      const tileId = Array.isArray(item) && Number.isFinite(item[0]) ? Math.trunc(item[0]) : NaN;
      const value = Array.isArray(item) ? item[1] ?? null : null;
      return [tileId, value] as [number, T | null];
    })
    .filter((item) => Number.isFinite(item[0]));
}

function normalizeThingEntries(raw: unknown): Array<[number, ThingInfo]> {
  return normalizeFrameEntries<ThingInfo>(raw)
    .filter((item): item is [number, ThingInfo] => {
      const value = item[1] as ThingInfo | null;
      return !!value && typeof value.slotName === 'string';
    })
    .sort((a, b) => a[0] - b[0]);
}

function normalizeConcealedGangDisplayThings(things: Array<[number, ThingInfo]>, gb: GuobiaoState): Array<[number, ThingInfo]> {
  const rows = new Set<string>();
  for (let seat = 0; seat < 4; seat++) {
    for (const meld of gb.players?.[seat]?.melds ?? []) {
      if (meld.kind === 'flower') continue;
      if (meld.kind !== 'anGang' && meld.concealed !== true) continue;
      const row = Math.trunc(Number(meld.row));
      if (Number.isFinite(row)) rows.add(`${seat}:${row}`);
    }
  }
  if (rows.size === 0) return things;

  const revealAll = gb.revealAllHands === true || gb.phase === 'settling' || gb.phase === 'done';
  const rotationIndex = revealAll ? 0 : 2;
  return things.map(([tileId, info]): [number, ThingInfo] => {
    const match = /^meld\.(\d+)\.(\d+)@(\d+)$/.exec(info.slotName);
    if (!match) return [tileId, info];
    const row = Math.trunc(Number(match[1]));
    const seat = Math.trunc(Number(match[3]));
    if (!Number.isFinite(row) || !Number.isFinite(seat) || !rows.has(`${seat}:${row}`)) return [tileId, info];
    return [tileId, info.rotationIndex === rotationIndex ? info : { ...info, rotationIndex }];
  });
}

export class GuobiaoPaipuRuntime {
  private readonly detail: PaipuDetail;
  private readonly ownerSeat: number;
  private readonly ownerPlayerId: string;
  private readonly playerIds: Record<number, string>;
  private readonly matchInfo: MatchInfo & { roomType: string | null };
  private readonly seatEntries: Array<[string, { seat: number; startBeans: number }]>;
  private readonly nickEntries: Array<[string, string]>;
  private readonly avatarEntries: Array<[string, number]>;
  private readonly frames: Array<GuobiaoPaipuFrame>;
  private readonly navigationIndices: Array<number>;
  private currentIndex = 0;

  constructor(detail: PaipuDetail, ownerPlayerId: string) {
    this.detail = detail;
    this.ownerSeat = Math.trunc(detail.perspective.ownerSeat ?? 0);
    this.ownerPlayerId = ownerPlayerId;
    this.playerIds = {
      0: this.ownerSeat === 0 ? ownerPlayerId : 'gb-paipu-seat-0',
      1: this.ownerSeat === 1 ? ownerPlayerId : 'gb-paipu-seat-1',
      2: this.ownerSeat === 2 ? ownerPlayerId : 'gb-paipu-seat-2',
      3: this.ownerSeat === 3 ? ownerPlayerId : 'gb-paipu-seat-3',
    };
    const bySeat = [0, 1, 2, 3].map((seat) => detail.players.find((player) => player.seat === seat) ?? null);
    this.matchInfo = {
      dealer: Math.trunc(detail.rules?.dealer ?? 0),
      honba: 0,
      conditions: guobiaoConditions(),
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
    this.frames = this.buildFrames();
    if (this.frames.length <= 0) {
      throw new Error('国标牌谱缺少可播放帧');
    }
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

  currentFrame(): GuobiaoPaipuFrame | null {
    return this.frames[this.currentIndex] ?? null;
  }

  currentEventIndex(): number | null {
    return this.currentFrame()?.eventIndex ?? null;
  }

  private applyCurrentFrame(client: Client): void {
    const frame = this.currentFrame();
    if (!frame) return;
    client.things.update(frame.things);
    client.gb.update([[0, frame.gb]]);
    client.blood.update([[0, null as any]]);
    client.tileFacePublic.update(frame.tileFacePublic);
    client.tileFaceSelf.update(frame.tileFaceSelf);
  }

  private buildFrames(): Array<GuobiaoPaipuFrame> {
    const out: Array<GuobiaoPaipuFrame> = [];
    for (let eventIndex = 0; eventIndex < this.detail.events.length; eventIndex += 1) {
      const event = this.detail.events[eventIndex] ?? null;
      const frame = this.extractFrame(event, eventIndex);
      if (frame) out.push(frame);
    }
    return out;
  }

  private extractFrame(event: any, eventIndex: number): GuobiaoPaipuFrame | null {
    const publicFrame = event?.public?.frame as GuobiaoReplayFramePublic | null | undefined;
    if (!publicFrame || !publicFrame.gb) return null;
    const privateFrame = event?.private?.[String(this.ownerSeat)]?.frame as GuobiaoReplayFramePrivate | null | undefined;
    const timeline = this.detail.timeline.find((item) => item.eventIndex === eventIndex) ?? null;
    const tileFaceSelf = normalizeFrameEntries<number>(privateFrame?.tileFaceSelf);
    return {
      eventIndex,
      title: timeline?.label ?? String(event?.type ?? '动作'),
      detail: timeline?.detail ?? '',
      gb: privateFrame?.gb ?? publicFrame.gb,
      things: normalizeConcealedGangDisplayThings(normalizeThingEntries(publicFrame.things), privateFrame?.gb ?? publicFrame.gb),
      tileFacePublic: normalizeFrameEntries<number>(publicFrame.tileFacePublic),
      tileFaceSelf,
    };
  }

  private buildNavigationIndices(): Array<number> {
    const out: Array<number> = [];
    for (let frameIndex = 0; frameIndex < this.frames.length; frameIndex += 1) {
      const frame = this.frames[frameIndex] ?? null;
      const event = frame ? (this.detail.events[frame.eventIndex] ?? null) : null;
      if (!this.isNavigationEvent(event)) continue;
      out.push(frameIndex);
    }
    return out.length > 0 ? out : this.frames.map((_, index) => index);
  }

  private isNavigationEvent(event: any): boolean {
    const type = String(event?.type ?? '').trim();
    return [
      'meta',
      'hands',
      'draw',
      'buhua',
      'discard',
      'chi',
      'peng',
      'mingGang',
      'anGang',
      'addGang',
      'hu',
      'ledger',
      'end',
    ].includes(type);
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
}
