import type { Game } from './game';
import type { BloodEngine, BloodState } from './blood-engine';
import type { AiScene } from './protocol';
import {
  computeAiSnapshotKey,
  computeAllowedActions,
  determineAiScene,
  snapshotIdForKey,
  withActionIds,
} from './blood-ai';
import { tileCode } from './core/blood-tiles';

type BloodSuit = 'm' | 'p' | 's';
type SeatKey = '0' | '1' | '2' | '3';

export type BloodAiRawAction =
  | { kind: 'swap3'; tileIds: Array<number> }
  | { kind: 'dingque'; suit: BloodSuit }
  | { kind: 'discard'; tileId: number }
  | { kind: 'claim'; pendingId: number; action: 'hu' | 'peng' | 'gang' | 'pass' }
  | { kind: 'kong'; gangType: 'an' | 'add'; tileKey: number }
  | { kind: 'hu'; source: 'self' };

type PublicActionBase = { legalActionId: string };

export type BloodAiPublicAction =
  | (PublicActionBase & { kind: 'swap3'; tiles: Array<string> })
  | (PublicActionBase & { kind: 'dingque'; suit: BloodSuit })
  | (PublicActionBase & { kind: 'discard'; tile: string })
  | (PublicActionBase & { kind: 'claim'; action: 'hu' | 'peng' | 'gang' | 'pass' })
  | (PublicActionBase & { kind: 'kong'; gangType: 'an' | 'add'; tile: string })
  | (PublicActionBase & { kind: 'hu'; source: 'self' });

export type BloodAiHandState = {
  dingque: BloodSuit | null;
  concealedTiles: Array<{ tile: string; drawn: boolean }>;
};

export type BloodAiPublicMeld = {
  kind: 'peng' | 'gang';
  tile: string;
  fromSeat: number | null;
  gangType?: 'an' | 'ming' | 'add';
};

export type BloodAiPublicPlayer = {
  dingque: BloodSuit | null;
  dingqueReady: boolean;
  hu: boolean;
  huTile: string | null;
  huSource: 'self' | 'discard' | null;
  beans: number;
  kongGain: number;
  concealedTileCount: number;
  melds: Array<BloodAiPublicMeld>;
};

export type BloodAiPublicState = {
  phase: BloodState['phase'];
  base: number;
  dealer: number | null;
  turnSeat: number | null;
  turnStep: BloodState['turnStep'];
  wallRemaining: number;
  afterGangSeat: number | null;
  playersBySeat: Record<SeatKey, BloodAiPublicPlayer>;
  discardsBySeat: Record<SeatKey, Array<string>>;
  claim: {
    fromSeat: number;
    tile: string;
    trigger: 'discard' | 'addKong';
    afterGang: boolean;
  } | null;
};

export type BloodAiDecisionCatalog = {
  seat: number;
  scene: AiScene;
  snapshotKey: string;
  snapshotId: string;
  handState: BloodAiHandState;
  publicState: BloodAiPublicState;
  publicActions: Array<BloodAiPublicAction>;
  rawByActionId: ReadonlyMap<string, BloodAiRawAction>;
};

export type BloodAiDecisionEnvelope = {
  schemaVersion: 1;
  gameId: string;
  seat: number;
  decisionId: string;
  modelId?: string;
  modelLabel?: string;
  scene: AiScene;
  snapshotId: string;
  openedAtMs: number;
  deadlineAtMs: number;
  handState: BloodAiHandState;
  publicState: BloodAiPublicState;
  legalActions: Array<BloodAiPublicAction>;
};

export function buildBloodAiDecisionCatalog(params: {
  game: Game;
  engine: BloodEngine;
  state: BloodState;
  seat: number;
}): BloodAiDecisionCatalog | null {
  const seat = normalizeSeat(params.seat);
  if (seat === null) return null;

  const scene = determineAiScene(params.state, seat);
  if (scene === null) return null;

  const snapshotKey = computeAiSnapshotKey(params.state, seat, scene);
  const snapshotId = snapshotIdForKey(snapshotKey);
  const handTiles = listOwnConcealedTiles(params.game, params.engine, seat);
  const actionsWithIds = withActionIds(computeAllowedActions({ ...params, seat, scene }));
  const publicActions: Array<BloodAiPublicAction> = [];
  const rawByActionId = new Map<string, BloodAiRawAction>();

  for (const action of actionsWithIds) {
    const legalActionId = typeof action?.action_id === 'string' ? action.action_id : '';
    if (!legalActionId) continue;
    const rawAction = toRawAction(action);
    const publicAction = toPublicAction(action, legalActionId);
    if (rawAction === null || publicAction === null) continue;
    rawByActionId.set(legalActionId, rawAction);
    publicActions.push(publicAction);
  }

  const me: any = params.state.players?.[seat] ?? null;
  return {
    seat,
    scene,
    snapshotKey,
    snapshotId,
    handState: {
      dingque: normalizeSuit(me?.dingque),
      concealedTiles: handTiles.map((item) => ({ tile: tileCode(item.tileKey), drawn: item.drawn })),
    },
    publicState: buildPublicState(params.game, params.state),
    publicActions,
    rawByActionId,
  };
}

export function buildBloodAiDecisionEnvelope(
  catalog: BloodAiDecisionCatalog,
  params: {
    gameId: string;
    seat: number;
    decisionId: string;
    modelId?: string | null;
    modelLabel?: string | null;
    openedAtMs: number;
    deadlineAtMs: number;
  },
): BloodAiDecisionEnvelope {
  const gameId = cleanRequiredText(params.gameId, 'gameId');
  const decisionId = cleanRequiredText(params.decisionId, 'decisionId');
  const seat = normalizeSeat(params.seat);
  if (seat === null || seat !== catalog.seat) throw new Error('decision seat does not match catalog');

  const openedAtMs = normalizeTimestamp(params.openedAtMs, 'openedAtMs');
  const deadlineAtMs = normalizeTimestamp(params.deadlineAtMs, 'deadlineAtMs');
  if (deadlineAtMs <= openedAtMs) throw new Error('deadlineAtMs must be greater than openedAtMs');

  const modelId = cleanOptionalText(params.modelId);
  const modelLabel = cleanOptionalText(params.modelLabel);
  return {
    schemaVersion: 1,
    gameId,
    seat,
    decisionId,
    ...(modelId ? { modelId } : {}),
    ...(modelLabel ? { modelLabel } : {}),
    scene: catalog.scene,
    snapshotId: catalog.snapshotId,
    openedAtMs,
    deadlineAtMs,
    handState: catalog.handState,
    publicState: catalog.publicState,
    legalActions: catalog.publicActions,
  };
}

function buildPublicState(game: Game, state: BloodState): BloodAiPublicState {
  const concealedCounts = countConcealedTilesBySeat(game);
  const playersBySeat = emptyPlayersBySeat();
  for (let seat = 0; seat < 4; seat += 1) {
    const source: any = state.players?.[seat] ?? null;
    // 定缺阶段只公开是否已提交；花色要等阶段结束后才是桌面公开信息。
    const publicDingque = state.phase === 'swap3' || state.phase === 'dingque'
      ? null
      : normalizeSuit(source?.dingque);
    playersBySeat[String(seat) as SeatKey] = {
      dingque: publicDingque,
      dingqueReady: source?.dingqueReady === true || normalizeSuit(source?.dingque) !== null,
      hu: source?.hu === true,
      huTile: toTileCode(source?.huTileKey),
      huSource: source?.huSource === 'self' || source?.huSource === 'discard' ? source.huSource : null,
      beans: finiteInteger(source?.beans, 0),
      kongGain: finiteInteger(source?.kongGain, 0),
      concealedTileCount: concealedCounts[String(seat) as SeatKey],
      melds: publicMelds(source?.melds),
    };
  }

  const pending: any = state.pending;
  const claimTile = toTileCode(pending?.tileKey);
  const claimFromSeat = normalizeSeat(pending?.fromSeat);
  const claim = pending?.kind === 'claim' && claimTile !== null && claimFromSeat !== null
    ? {
        fromSeat: claimFromSeat,
        tile: claimTile,
        trigger: pending.trigger === 'addKong' ? 'addKong' as const : 'discard' as const,
        afterGang: pending.afterGang === true,
      }
    : null;

  return {
    phase: state.phase,
    base: finiteInteger(state.base, 0),
    dealer: normalizeSeat(state.dealer),
    turnSeat: normalizeSeat(state.turnSeat),
    turnStep: state.turnStep,
    wallRemaining: publicWallRemaining(game, state),
    afterGangSeat: normalizeSeat(state.afterGangSeat ?? null),
    playersBySeat,
    discardsBySeat: listPublicDiscards(game),
    claim,
  };
}

function publicWallRemaining(game: Game, state: BloodState): number {
  const order = Array.isArray(state.wallOrder) ? state.wallOrder : [];
  if (order.length > 0) {
    return Math.max(0, order.length - finiteInteger(state.wallIndex, 0));
  }
  let remaining = 0;
  for (const [, rawInfo] of game.entries('things')) {
    const slotName = typeof (rawInfo as any)?.slotName === 'string' ? String((rawInfo as any).slotName) : '';
    if (slotName.startsWith('wall.')) remaining += 1;
  }
  return remaining;
}

function listOwnConcealedTiles(
  game: Game,
  engine: BloodEngine,
  seat: number,
): Array<{ tileKey: number; drawn: boolean; slotName: string; tileId: number }> {
  const out: Array<{ tileKey: number; drawn: boolean; slotName: string; tileId: number }> = [];
  for (const [rawTileId, rawInfo] of game.entries('things')) {
    const tileId = finiteIntegerOrNull(rawTileId);
    const slotName = typeof (rawInfo as any)?.slotName === 'string' ? String((rawInfo as any).slotName) : '';
    if (tileId === null || !slotName.startsWith('hand.') || !slotName.endsWith(`@${seat}`)) continue;
    const tileKey = engine.tileKeyForId(tileId);
    if (tileKey === null || tileKey < 0 || tileKey >= 27) continue;
    out.push({ tileKey, drawn: slotName.startsWith('hand.extra'), slotName, tileId });
  }
  out.sort((a, b) => handSlotOrder(a.slotName) - handSlotOrder(b.slotName) || a.tileId - b.tileId);
  return out;
}

function countConcealedTilesBySeat(game: Game): Record<SeatKey, number> {
  const out: Record<SeatKey, number> = { '0': 0, '1': 0, '2': 0, '3': 0 };
  for (const [, rawInfo] of game.entries('things')) {
    const slotName = typeof (rawInfo as any)?.slotName === 'string' ? String((rawInfo as any).slotName) : '';
    const match = /^hand\.(?:\d+|extra)@(\d)$/.exec(slotName);
    const seat = normalizeSeat(match?.[1] ?? null);
    if (seat === null) continue;
    const key = String(seat) as SeatKey;
    out[key] += 1;
  }
  return out;
}

function listPublicDiscards(game: Game): Record<SeatKey, Array<string>> {
  const rows: Record<SeatKey, Array<{ order: number; tileId: number; tile: string }>> = {
    '0': [],
    '1': [],
    '2': [],
    '3': [],
  };
  const publicFaces = new Map<number, number>();
  for (const [rawTileId, rawTileKey] of game.entries('tileFacePublic')) {
    const tileId = finiteIntegerOrNull(rawTileId);
    const tileKey = finiteIntegerOrNull(rawTileKey);
    if (tileId === null || tileKey === null || tileKey < 0 || tileKey >= 27) continue;
    publicFaces.set(tileId, tileKey);
  }
  for (const [rawTileId, rawInfo] of game.entries('things')) {
    const tileId = finiteIntegerOrNull(rawTileId);
    const slotName = typeof (rawInfo as any)?.slotName === 'string' ? String((rawInfo as any).slotName) : '';
    if (tileId === null) continue;
    const parsed = parseDiscardSlot(slotName);
    const tileKey = publicFaces.get(tileId) ?? null;
    if (parsed === null || tileKey === null) continue;
    rows[String(parsed.seat) as SeatKey].push({ order: parsed.order, tileId, tile: tileCode(tileKey) });
  }
  return {
    '0': orderedDiscardTiles(rows['0']),
    '1': orderedDiscardTiles(rows['1']),
    '2': orderedDiscardTiles(rows['2']),
    '3': orderedDiscardTiles(rows['3']),
  };
}

function orderedDiscardTiles(rows: Array<{ order: number; tileId: number; tile: string }>): Array<string> {
  return rows.sort((a, b) => a.order - b.order || a.tileId - b.tileId).map((row) => row.tile);
}

function parseDiscardSlot(slotName: string): { seat: number; order: number } | null {
  const extra = /^discard\.extra\.(\d+)@(\d)$/.exec(slotName);
  if (extra) {
    const seat = normalizeSeat(extra[2]);
    const index = finiteIntegerOrNull(extra[1]);
    return seat === null || index === null ? null : { seat, order: 900 + index };
  }
  const match = /^discard(\.stack)?\.(\d+)\.(\d+)@(\d)$/.exec(slotName);
  if (!match) return null;
  const seat = normalizeSeat(match[4]);
  const row = finiteIntegerOrNull(match[2]);
  const col = finiteIntegerOrNull(match[3]);
  if (seat === null || row === null || col === null) return null;
  return { seat, order: (match[1] ? 1000 : 0) + row * 100 + col };
}

function publicMelds(value: unknown): Array<BloodAiPublicMeld> {
  if (!Array.isArray(value)) return [];
  const out: Array<BloodAiPublicMeld> = [];
  for (const source of value) {
    if (source?.kind !== 'peng' && source?.kind !== 'gang') continue;
    const tile = toTileCode(source?.tileKey);
    if (tile === null) continue;
    const gangType = source?.gangType === 'an' || source?.gangType === 'ming' || source?.gangType === 'add'
      ? source.gangType
      : null;
    out.push({
      kind: source.kind,
      tile,
      fromSeat: normalizeSeat(source?.fromSeat),
      ...(gangType ? { gangType } : {}),
    });
  }
  return out;
}

function toRawAction(action: any): BloodAiRawAction | null {
  if (action?.kind === 'swap3' && Array.isArray(action.tileIds)) {
    const tileIds = action.tileIds.map(finiteIntegerOrNull);
    if (tileIds.length !== 3 || tileIds.some((tileId: number | null) => tileId === null)) return null;
    return { kind: 'swap3', tileIds: tileIds as Array<number> };
  }
  if (action?.kind === 'dingque') {
    const suit = normalizeSuit(action.suit);
    return suit === null ? null : { kind: 'dingque', suit };
  }
  if (action?.kind === 'discard') {
    const tileId = finiteIntegerOrNull(action.tileId);
    return tileId === null ? null : { kind: 'discard', tileId };
  }
  if (action?.kind === 'claim') {
    const pendingId = finiteIntegerOrNull(action.pendingId);
    const claimAction = normalizeClaimAction(action.action);
    return pendingId === null || claimAction === null
      ? null
      : { kind: 'claim', pendingId, action: claimAction };
  }
  if (action?.kind === 'kong') {
    const tileKey = finiteIntegerOrNull(action.tileKey);
    const gangType = action.gangType === 'an' || action.gangType === 'add' ? action.gangType : null;
    return tileKey === null || gangType === null ? null : { kind: 'kong', gangType, tileKey };
  }
  if (action?.kind === 'hu' && action.source === 'self') return { kind: 'hu', source: 'self' };
  return null;
}

function toPublicAction(action: any, legalActionId: string): BloodAiPublicAction | null {
  if (action?.kind === 'swap3' && Array.isArray(action.tiles) && action.tiles.every((tile: unknown) => typeof tile === 'string')) {
    return { legalActionId, kind: 'swap3', tiles: [...action.tiles] };
  }
  if (action?.kind === 'dingque') {
    const suit = normalizeSuit(action.suit);
    return suit === null ? null : { legalActionId, kind: 'dingque', suit };
  }
  if (action?.kind === 'discard' && typeof action.tile === 'string') {
    return { legalActionId, kind: 'discard', tile: action.tile };
  }
  if (action?.kind === 'claim') {
    const claimAction = normalizeClaimAction(action.action);
    return claimAction === null ? null : { legalActionId, kind: 'claim', action: claimAction };
  }
  if (action?.kind === 'kong' && typeof action.tile === 'string') {
    const gangType = action.gangType === 'an' || action.gangType === 'add' ? action.gangType : null;
    return gangType === null ? null : { legalActionId, kind: 'kong', gangType, tile: action.tile };
  }
  if (action?.kind === 'hu' && action.source === 'self') return { legalActionId, kind: 'hu', source: 'self' };
  return null;
}

function normalizeClaimAction(value: unknown): 'hu' | 'peng' | 'gang' | 'pass' | null {
  return value === 'hu' || value === 'peng' || value === 'gang' || value === 'pass' ? value : null;
}

function normalizeSuit(value: unknown): BloodSuit | null {
  return value === 'm' || value === 'p' || value === 's' ? value : null;
}

function normalizeSeat(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const seat = Number(value);
  return Number.isInteger(seat) && seat >= 0 && seat <= 3 ? seat : null;
}

function finiteInteger(value: unknown, fallback: number): number {
  const result = finiteIntegerOrNull(value);
  return result === null ? fallback : result;
}

function finiteIntegerOrNull(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? Math.trunc(result) : null;
}

function toTileCode(value: unknown): string | null {
  const tileKey = finiteIntegerOrNull(value);
  return tileKey === null || tileKey < 0 || tileKey >= 27 ? null : tileCode(tileKey);
}

function handSlotOrder(slotName: string): number {
  if (slotName.startsWith('hand.extra')) return 1000;
  const match = /^hand\.(\d+)@(\d)$/.exec(slotName);
  const index = finiteIntegerOrNull(match?.[1] ?? null);
  return index ?? 2000;
}

function emptyPlayersBySeat(): Record<SeatKey, BloodAiPublicPlayer> {
  const empty = (): BloodAiPublicPlayer => ({
    dingque: null,
    dingqueReady: false,
    hu: false,
    huTile: null,
    huSource: null,
    beans: 0,
    kongGain: 0,
    concealedTileCount: 0,
    melds: [],
  });
  return { '0': empty(), '1': empty(), '2': empty(), '3': empty() };
}

function cleanRequiredText(value: unknown, field: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw new Error(`missing ${field}`);
  return result;
}

function cleanOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeTimestamp(value: unknown, field: string): number {
  const result = finiteIntegerOrNull(value);
  if (result === null || result < 0) throw new Error(`invalid ${field}`);
  return result;
}
