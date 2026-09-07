import type { AiScene } from './protocol';
import type { Game } from './game';
import type { BloodEngine, BloodState } from './blood-engine';
import { computeAllowedActions } from './blood-ai';
import type { BloodSuit } from './core/blood-types';
import type { CalcMeld } from './core/blood-calc-notation';
import { computeSplitStage, type SplitOpponent } from './core/blood-split-engine';
import { BloodSplitTop1Engine, type BloodPendingClaimLike, type SplitTop1Snapshot } from './core/blood-split-top1';

type HandTile = {
  tileId: number;
  tileKey: number;
  slotName: string;
  isExtra: boolean;
};

function toInt(value: string | number): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.trunc(value);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function countByTileKeys(tileKeys: ReadonlyArray<number>, size = 27): Array<number> {
  const out = new Array<number>(size).fill(0);
  for (const tileKey of tileKeys) {
    if (!Number.isInteger(tileKey) || tileKey < 0 || tileKey >= size) continue;
    out[tileKey] = (out[tileKey] ?? 0) + 1;
  }
  return out;
}

export class BloodTop1ActionPicker {
  private top1Engine = new BloodSplitTop1Engine();

  pickAction(params: {
    game: Game;
    engine: BloodEngine;
    state: BloodState;
    scene: AiScene;
    seat: number;
  }): any | null {
    const { game, engine, state, scene, seat } = params;
    const allowed = computeAllowedActions({ game, engine, state, seat, scene });
    if (!Array.isArray(allowed) || allowed.length === 0) return null;

    try {
      if (scene === 'swap3') {
        return this.pickSwap3Action({ game, engine, state, seat, allowed });
      }
      if (scene === 'dingque') {
        return this.pickDingqueAction({ game, engine, state, seat, allowed });
      }
      if (scene === 'turn') {
        return this.pickTurnAction({ game, engine, state, seat, allowed });
      }
      if (scene === 'claim') {
        return this.pickClaimAction({ game, engine, state, seat, allowed });
      }
    } catch (err: unknown) {
      console.error(`[${game.gameId}] newbie bot pickAction failed scene=${scene} seat=${seat}`, err);
      return this.fallbackActionForScene({ scene, state, allowed });
    }

    return null;
  }

  private pickSwap3Action(params: {
    game: Game;
    engine: BloodEngine;
    state: BloodState;
    seat: number;
    allowed: Array<any>;
  }): any | null {
    const { game, engine, state, seat, allowed } = params;
    const swapActions = allowed.filter((a) => a?.kind === 'swap3' && Array.isArray(a?.tileIds));
    if (swapActions.length === 0) return null;

    const snap = this.buildTop1Snapshot({ game, engine, state, seat });
    if (!snap) {
      return { kind: 'swap3', tileIds: (swapActions[0]!.tileIds as Array<number>).slice(0, 3) };
    }

    const reco = this.top1Engine.pickTop1Action({ scene: 'swap3', snap });
    if (reco && reco.kind === 'swap3') {
      const handTiles = this.listHandTiles(game, engine, seat);
      const tileIds = this.pickHandTileIdsForKeys(handTiles, reco.tiles);
      if (tileIds && tileIds.length === 3) {
        const action = { kind: 'swap3', tileIds };
        if (this.isAllowedAction(allowed, action)) return action;
      }
    }

    return { kind: 'swap3', tileIds: (swapActions[0]!.tileIds as Array<number>).slice(0, 3) };
  }

  private pickDingqueAction(params: {
    game: Game;
    engine: BloodEngine;
    state: BloodState;
    seat: number;
    allowed: Array<any>;
  }): any | null {
    const { game, engine, state, seat, allowed } = params;
    const dingqueActions = allowed.filter((a) => a?.kind === 'dingque');
    if (dingqueActions.length === 0) return null;

    const snap = this.buildTop1Snapshot({ game, engine, state, seat });
    if (!snap) {
      const firstSuit = dingqueActions[0]?.suit;
      return typeof firstSuit === 'string' ? { kind: 'dingque', suit: firstSuit } : null;
    }
    const reco = this.top1Engine.pickTop1Action({ scene: 'dingque', snap });
    const suit = reco && reco.kind === 'dingque' ? reco.suit : null;
    if (suit) {
      const hit = dingqueActions.find((a) => a?.suit === suit) ?? null;
      if (hit) return { kind: 'dingque', suit };
    }
    const firstSuit = dingqueActions[0]?.suit;
    return typeof firstSuit === 'string' ? { kind: 'dingque', suit: firstSuit } : null;
  }

  private pickTurnAction(params: {
    game: Game;
    engine: BloodEngine;
    state: BloodState;
    seat: number;
    allowed: Array<any>;
  }): any | null {
    const { game, engine, state, seat, allowed } = params;
    const snap = this.buildTop1Snapshot({ game, engine, state, seat });
    if (!snap) return this.fallbackTurnAction({ allowed });

    const reco = this.top1Engine.pickTop1Action({ scene: 'turn', snap });
    if (!reco) return this.fallbackTurnAction({ allowed });

    if (reco.kind === 'turnHu') {
      const action = { kind: 'hu', source: 'self' };
      return this.isAllowedAction(allowed, action) ? action : this.fallbackTurnAction({ allowed });
    }
    if (reco.kind === 'turnKong') {
      const action = { kind: 'kong', gangType: reco.gangType, tileKey: reco.tileKey };
      return this.isAllowedAction(allowed, action) ? action : this.fallbackTurnAction({ allowed });
    }
    if (reco.kind === 'turnDiscard') {
      const handTiles = this.listHandTiles(game, engine, seat);
      const tileId = this.pickDiscardTileId(handTiles, reco.tileKey);
      if (tileId === null) return this.fallbackTurnAction({ allowed });
      const action = { kind: 'discard', tileId };
      return this.isAllowedAction(allowed, action) ? action : this.fallbackTurnAction({ allowed });
    }

    return this.fallbackTurnAction({ allowed });
  }

  private pickClaimAction(params: {
    game: Game;
    engine: BloodEngine;
    state: BloodState;
    seat: number;
    allowed: Array<any>;
  }): any | null {
    const { game, engine, state, seat, allowed } = params;
    const pending = state.pending;
    if (!pending || pending.kind !== 'claim') {
      return this.fallbackClaimAction({ allowed, pendingId: 0 });
    }

    const snap = this.buildTop1Snapshot({ game, engine, state, seat });
    if (!snap) return this.fallbackClaimAction({ allowed, pendingId: pending.id });

    const reco = this.top1Engine.pickTop1Action({
      scene: 'claim',
      snap,
      pending: pending as unknown as BloodPendingClaimLike,
    });
    if (!reco || reco.kind !== 'claim') return this.fallbackClaimAction({ allowed, pendingId: pending.id });

    const action = { kind: 'claim', pendingId: pending.id, action: reco.action };
    return this.isAllowedAction(allowed, action) ? action : this.fallbackClaimAction({ allowed, pendingId: pending.id });
  }

  private listHandTiles(game: Game, engine: BloodEngine, seat: number): Array<HandTile> {
    const out: Array<HandTile> = [];
    for (const [k, info] of game.entries('things')) {
      const tileId = toInt(k);
      if (tileId === null) continue;
      const slotName = typeof (info as any)?.slotName === 'string' ? String((info as any).slotName) : '';
      if (!slotName.startsWith('hand.') || !slotName.endsWith(`@${seat}`)) continue;
      const tileKey = engine.tileKeyForId(tileId);
      if (tileKey === null) continue;
      out.push({
        tileId,
        tileKey,
        slotName,
        isExtra: slotName.startsWith('hand.extra'),
      });
    }
    return out;
  }

  private listSeatMelds(state: BloodState, seat: number): Array<CalcMeld> {
    const me = state.players?.[seat] ?? null;
    if (!me || !Array.isArray(me.melds)) return [];
    const out: Array<CalcMeld> = [];
    for (const meld of me.melds as Array<any>) {
      const kind = meld?.kind;
      const tileKey = toInt(meld?.tileKey);
      if ((kind !== 'peng' && kind !== 'gang') || tileKey === null) continue;
      if (kind === 'gang') {
        const gangType = meld?.gangType;
        if (gangType === 'an' || gangType === 'ming' || gangType === 'add') {
          out.push({ kind: 'gang', tileKey, gangType });
          continue;
        }
      }
      out.push({ kind, tileKey });
    }
    return out;
  }

  private isAlwaysPublicFaceSlot(slotName: string): boolean {
    return slotName.startsWith('discard.') || slotName.startsWith('hu.taken.');
  }

  private countPublicHuDisplayFromState(state: BloodState): Array<number> {
    const out = new Array<number>(27).fill(0);
    const revealAll = !!(state.revealAllHands || state.phase === 'settling' || state.phase === 'done');
    if (revealAll) return out;
    for (let seat = 0; seat < 4; seat++) {
      const player = state.players?.[seat] ?? null;
      const tileKey = Number.isFinite(player?.huTileKey) ? Math.trunc(player!.huTileKey as number) : null;
      if (!player?.hu || player.huSource !== 'self' || tileKey === null || tileKey < 0 || tileKey >= 27) continue;
      out[tileKey] = (out[tileKey] ?? 0) + 1;
    }
    return out;
  }

  private countPublicMeldsFromState(state: BloodState): Array<number> {
    const out = new Array<number>(27).fill(0);
    for (let seat = 0; seat < 4; seat++) {
      const player = state.players?.[seat] ?? null;
      if (!player || !Array.isArray(player.melds)) continue;
      for (const meld of player.melds as Array<any>) {
        const kind = meld?.kind;
        const tileKey = toInt(meld?.tileKey);
        if ((kind !== 'peng' && kind !== 'gang') || tileKey === null || tileKey < 0 || tileKey >= 27) continue;
        const add = kind === 'gang' ? 4 : 3;
        out[tileKey] = (out[tileKey] ?? 0) + add;
      }
    }
    return out;
  }

  private countPublicFacesFromSlots(game: Game, seat: number): Array<number> {
    const out = new Array<number>(27).fill(0);
    const tileFaceById = new Map<number, number | null>();
    for (const [rawId, rawTileKey] of game.entries('tileFacePublic')) {
      const tileId = toInt(rawId as any);
      const tileKey = toInt(rawTileKey as any);
      if (tileId === null) continue;
      tileFaceById.set(tileId, tileKey);
    }
    for (const [rawId, info] of game.entries('things')) {
      const tileId = toInt(rawId as any);
      if (tileId === null) continue;
      const slotName = typeof (info as any)?.slotName === 'string' ? String((info as any).slotName) : '';
      const tileKeyRaw = tileFaceById.get(tileId) ?? null;
      const isOwnHand = slotName.startsWith('hand.') && slotName.endsWith(`@${seat}`);
      const isRevealedHand = slotName.startsWith('hand.') && !isOwnHand && tileKeyRaw !== null;
      if (!this.isAlwaysPublicFaceSlot(slotName) && !isRevealedHand) continue;
      const tileKey = typeof tileKeyRaw === 'number' && Number.isFinite(tileKeyRaw) ? Math.trunc(tileKeyRaw) : null;
      if (tileKey === null || tileKey < 0 || tileKey >= 27) continue;
      out[tileKey] = (out[tileKey] ?? 0) + 1;
    }
    return out;
  }

  private buildPublicCounts(game: Game, state: BloodState, seat: number): Array<number> {
    const faceCounts = this.countPublicFacesFromSlots(game, seat);
    const meldCounts = this.countPublicMeldsFromState(state);
    const huDisplayCounts = this.countPublicHuDisplayFromState(state);
    const out = new Array<number>(27).fill(0);
    for (let k = 0; k < 27; k++) out[k] = (faceCounts[k] ?? 0) + (meldCounts[k] ?? 0) + (huDisplayCounts[k] ?? 0);
    return out;
  }

  private countUnknownOpponentHandTiles(game: Game, seat: number): number {
    let out = 0;
    const tileFaceById = new Map<number, number | null>();
    for (const [rawId, rawTileKey] of game.entries('tileFacePublic')) {
      const tileId = toInt(rawId as any);
      const tileKey = toInt(rawTileKey as any);
      if (tileId === null) continue;
      tileFaceById.set(tileId, tileKey);
    }
    for (const [rawId, info] of game.entries('things')) {
      const tileId = toInt(rawId as any);
      if (tileId === null) continue;
      const slotName = typeof (info as any)?.slotName === 'string' ? String((info as any).slotName) : '';
      if (!slotName.startsWith('hand.') || slotName.endsWith(`@${seat}`)) continue;
      const tileKeyRaw = tileFaceById.get(tileId);
      if (tileKeyRaw !== undefined && tileKeyRaw !== null) continue;
      out += 1;
    }
    return out;
  }

  private wallRemaining(state: BloodState, game: Game): number {
    const fromOrder = Array.isArray(state.wallOrder) ? state.wallOrder.length - Math.trunc(state.wallIndex ?? 0) : 0;
    if (fromOrder > 0) return fromOrder;
    let bySlots = 0;
    for (const [, info] of game.entries('things')) {
      const slotName = typeof (info as any)?.slotName === 'string' ? String((info as any).slotName) : '';
      if (slotName.startsWith('wall.')) bySlots += 1;
    }
    return Math.max(0, bySlots);
  }

  private baseScore(state: BloodState): number {
    const b = Number((state as any)?.base);
    if (!Number.isFinite(b) || b <= 0) return 400;
    return Math.trunc(b);
  }

  private buildTop1Snapshot(params: { game: Game; engine: BloodEngine; state: BloodState; seat: number }): SplitTop1Snapshot | null {
    const { game, engine, state, seat } = params;
    const me = state.players?.[seat] ?? null;
    if (!me) return null;
    const myDingque: BloodSuit | null = me.dingque === 'm' || me.dingque === 'p' || me.dingque === 's' ? me.dingque : null;
    const melds = this.listSeatMelds(state, seat);
    const handTiles = this.listHandTiles(game, engine, seat);
    const hasExtraTile = handTiles.some((t) => t.isExtra);
    const canSelfTurnAct = state.phase === 'playing' && state.pending === null && state.turnSeat === seat && state.turnStep === 'discard';
    const handCounts14 = countByTileKeys(handTiles.map((t) => t.tileKey));

    const publicCounts = this.buildPublicCounts(game, state, seat);
    const remCounts = new Array<number>(27).fill(0);
    for (let k = 0; k < 27; k++) {
      const known = (publicCounts[k] ?? 0) + (handCounts14[k] ?? 0);
      remCounts[k] = Math.max(0, 4 - known);
    }

    const wallRemaining = Math.max(0, this.wallRemaining(state, game));
    const unknownOpponentTiles = this.countUnknownOpponentHandTiles(game, seat);
    const unknownPoolSize = Math.max(0, wallRemaining + unknownOpponentTiles);
    const stage = computeSplitStage(wallRemaining);

    const opponents: Array<SplitOpponent> = [];
    // During dingque phase, opponents' missing suit is not public; match split panel constraints.
    const opponentDingquePublic = state.phase !== 'dingque';
    for (let rel = 1; rel <= 3; rel++) {
      const s = (seat + rel) % 4;
      const ps = state.players?.[s] ?? null;
      const dq = ps?.dingque;
      const dingque: BloodSuit | null =
        opponentDingquePublic && (dq === 'm' || dq === 'p' || dq === 's') ? dq : null;
      opponents.push({ dingque, hu: !!ps?.hu });
    }
    const aliveOpponents = opponents.filter((o) => !o.hu).length;

    const afterGangSeat = Number.isFinite(state.afterGangSeat) ? Math.trunc(state.afterGangSeat as number) : null;

    return {
      seat,
      myDingque,
      melds,
      hasExtraTile,
      canSelfTurnAct,
      handCounts14,
      publicCounts,
      remCounts,
      wallRemaining,
      unknownPoolSize,
      stage,
      opponents,
      aliveOpponents: Math.max(1, Math.min(3, aliveOpponents)),
      base: this.baseScore(state),
      cap: 0,
      afterGangSeat,
    };
  }

  private pickHandTileIdsForKeys(handTiles: ReadonlyArray<HandTile>, keys: ReadonlyArray<number>): Array<number> | null {
    const remaining = handTiles
      .slice()
      .sort((a, b) => {
        if (a.isExtra !== b.isExtra) return a.isExtra ? 1 : -1;
        if (a.tileKey !== b.tileKey) return a.tileKey - b.tileKey;
        return a.tileId - b.tileId;
      });
    const used = new Set<number>();
    const out: Array<number> = [];
    for (const key of keys) {
      const pick = remaining.find((t) => !used.has(t.tileId) && t.tileKey === key) ?? null;
      if (!pick) return null;
      used.add(pick.tileId);
      out.push(pick.tileId);
    }
    return out;
  }

  private pickDiscardTileId(handTiles: ReadonlyArray<HandTile>, tileKey: number): number | null {
    const matches = handTiles
      .filter((t) => t.tileKey === tileKey)
      .slice()
      .sort((a, b) => {
        // Prefer discarding the drawn tile when possible (stable and matches user expectation).
        if (a.isExtra !== b.isExtra) return a.isExtra ? -1 : 1;
        return a.tileId - b.tileId;
      });
    return matches[0]?.tileId ?? null;
  }

  private isAllowedAction(allowed: Array<any>, action: any): boolean {
    if (!action) return false;
    if (action.kind === 'hu') return allowed.some((a) => a?.kind === 'hu');
    if (action.kind === 'kong') {
      return allowed.some((a) => a?.kind === 'kong' && a?.gangType === action.gangType && Math.trunc(a?.tileKey) === action.tileKey);
    }
    if (action.kind === 'discard') {
      return allowed.some((a) => a?.kind === 'discard' && toInt(a?.tileId) === toInt(action.tileId));
    }
    if (action.kind === 'dingque') {
      return allowed.some((a) => a?.kind === 'dingque' && a?.suit === action.suit);
    }
    if (action.kind === 'claim') {
      return allowed.some(
        (a) => a?.kind === 'claim' && toInt(a?.pendingId) === toInt(action.pendingId) && a?.action === action.action,
      );
    }
    if (action.kind === 'swap3') {
      const ids = Array.isArray(action.tileIds) ? action.tileIds.slice(0, 3).map((x: any) => Math.trunc(x)).sort((l: number, r: number) => l - r) : [];
      const key = ids.join(',');
      return allowed.some((a) => {
        if (a?.kind !== 'swap3' || !Array.isArray(a?.tileIds)) return false;
        const aIds = (a.tileIds as Array<any>).slice(0, 3).map((x) => Math.trunc(x)).sort((l, r) => l - r);
        return aIds.join(',') === key;
      });
    }
    return false;
  }

  private fallbackTurnAction(params: { allowed: Array<any> }): any | null {
    const { allowed } = params;
    const hu = allowed.find((a) => a?.kind === 'hu');
    if (hu) return { kind: 'hu', source: 'self' };

    const kong = allowed.find((a) => a?.kind === 'kong');
    if (kong) {
      const gangType = kong.gangType === 'an' || kong.gangType === 'add' ? kong.gangType : null;
      const tileKey = toInt(kong.tileKey);
      if (gangType && tileKey !== null) {
        return { kind: 'kong', gangType, tileKey };
      }
    }

    const discard = allowed.find((a) => a?.kind === 'discard');
    const tileId = discard ? toInt(discard.tileId) : null;
    if (tileId !== null) {
      return { kind: 'discard', tileId };
    }
    return null;
  }

  private fallbackActionForScene(params: { scene: AiScene; state: BloodState; allowed: Array<any> }): any | null {
    const { scene, state, allowed } = params;
    if (scene === 'swap3') {
      const firstSwap = allowed.find((a) => a?.kind === 'swap3' && Array.isArray(a?.tileIds));
      return firstSwap ? { kind: 'swap3', tileIds: (firstSwap.tileIds as Array<number>).slice(0, 3) } : null;
    }
    if (scene === 'dingque') {
      const firstDingque = allowed.find((a) => a?.kind === 'dingque');
      return firstDingque && typeof firstDingque?.suit === 'string'
        ? { kind: 'dingque', suit: firstDingque.suit }
        : null;
    }
    if (scene === 'turn') {
      return this.fallbackTurnAction({ allowed });
    }
    if (scene === 'claim') {
      const pendingId = state.pending?.kind === 'claim' ? state.pending.id : 0;
      return this.fallbackClaimAction({ allowed, pendingId });
    }
    return null;
  }

  private fallbackClaimAction(params: { allowed: Array<any>; pendingId: number }): any | null {
    const { allowed, pendingId } = params;
    const choose = (action: 'hu' | 'gang' | 'peng' | 'pass'): any | null => {
      const hit = allowed.find((a) => a?.kind === 'claim' && a?.action === action);
      return hit ? { kind: 'claim', pendingId, action } : null;
    };
    return choose('hu') ?? choose('gang') ?? choose('peng') ?? choose('pass') ?? null;
  }
}
