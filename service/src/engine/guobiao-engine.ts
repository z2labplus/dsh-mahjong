import { Entry, Message } from './protocol';
import { Game } from './game';
import type { ReplayEvent } from './replay-store';
import {
  GUOBIAO_DECK_SIZE,
  guobiaoTileCode,
  isGuobiaoFlower,
  isGuobiaoNumberTile,
  isGuobiaoTileKey,
  makeGuobiaoTileKeyDeck,
} from './core/guobiao-tiles';
import {
  calculateGuobiaoFans,
  type GuobiaoFanApplied,
  type GuobiaoFanMeld,
  type GuobiaoFanResult,
  type GuobiaoWinContext,
} from './core/guobiao-fan';

type ThingInfo = {
  slotName: string;
  rotationIndex: number;
  claimedBy: number | null;
  heldRotation: { x: number; y: number; z: number; w: number };
  shiftSlotName: string | null;
};

type SeatInfo = { seat: number | null; startBeans?: number };
type GuobiaoClaimAction = 'hu' | 'chi' | 'peng' | 'mingGang' | 'pass';
type GuobiaoAction =
  | { kind: 'discard'; tileId: number }
  | { kind: 'claim'; pendingId: number; action: GuobiaoClaimAction; optionId?: string }
  | { kind: 'hu'; source: 'self' }
  | { kind: 'buhua'; tileId: number }
  | { kind: 'setAutoBuhua'; enabled: boolean }
  | { kind: 'anGang'; tileKey?: number; tileIds?: Array<number> }
  | { kind: 'addGang'; tileId?: number; meldId?: number };

type GuobiaoLedgerTransfer = { fromSeat: number; toSeat: number; ruleScore: number; points: number };
type GuobiaoLedgerEntry = {
  kind: 'hu' | 'wrongHu' | 'draw';
  label: string;
  seat?: number;
  fromSeat?: number | null;
  fanTotal?: number;
  fans?: Array<GuobiaoFanApplied>;
  transfers: Array<GuobiaoLedgerTransfer>;
  at: number;
  note?: string;
};

type GuobiaoFlowerMeld = {
  kind: 'flower';
  tileKey: number;
  tileId: number;
  row: number;
  col: number;
};

type GuobiaoTileMeld = {
  id: number;
  kind: 'chi' | 'peng' | 'mingGang' | 'anGang' | 'addGang';
  tileKeys: Array<number>;
  tileIds: Array<number>;
  fromSeat: number | null;
  claimedTileId: number | null;
  claimedTileKey: number | null;
  row: number;
  concealed?: boolean;
};

type GuobiaoMeld = GuobiaoFlowerMeld | GuobiaoTileMeld;

type GuobiaoPlayerState = {
  seat: number;
  playerId: string | null;
  points: number;
  ruleScore: number;
  flowers: Array<number>;
  melds: Array<GuobiaoMeld>;
  hu: boolean;
  huTileKey: number | null;
  wrongHu: boolean;
};

type GuobiaoHuKind = 'legal' | 'wrongHuRisk' | 'none';

type GuobiaoChiOption = {
  optionId: string;
  tileIds: Array<number>;
  tileKeys: Array<number>;
  sequence: Array<number>;
};

type GuobiaoClaimOptions = {
  hu: boolean;
  huKind: GuobiaoHuKind;
  chi: Array<GuobiaoChiOption>;
  peng: boolean;
  mingGang: boolean;
  pass: boolean;
};

type GuobiaoPendingResponse = {
  action: GuobiaoClaimAction;
  optionId?: string;
};

type GuobiaoPendingClaim = {
  kind: 'discardClaim' | 'robGangHu';
  id: number;
  since: number;
  deadline: number | null;
  fromSeat: number;
  tileId: number;
  tileKey: number;
  options: Record<number, GuobiaoClaimOptions>;
  responses: Record<number, GuobiaoPendingResponse | null>;
};

type GuobiaoEndSummary = {
  kind: 'hu' | 'draw';
  ruleVersion: string;
  baseRuleScore: number;
  pointsScale: number;
  winners: Array<number>;
  fromSeat: number | null;
  fanTotal: number;
  fans: Array<GuobiaoFanApplied>;
  pointsBySeat: Record<number, number>;
  ruleScoreBySeat: Record<number, number>;
  pointsDeltaBySeat: Record<number, number>;
  ruleScoreDeltaBySeat: Record<number, number>;
};

type GuobiaoLastDrawSource = 'wall' | 'kongSupplement' | 'flowerSupplement';

type GuobiaoLastDraw = {
  seat: number;
  tileId: number;
  tileKey?: number;
  source: GuobiaoLastDrawSource;
};

type GuobiaoBuhuaCandidate = { tileId: number; tileKey: number; info: ThingInfo };
type GuobiaoReplayFrame = {
  gb: any;
  things: Array<[number, ThingInfo]>;
  tileFacePublic: Array<[number, number | null]>;
};
type GuobiaoReplayPrivateFrame = {
  gb: any;
  tileFaceSelf: Array<[number, number | null]>;
};

export type GuobiaoState = {
  version: 1;
  ruleVersion: string;
  baseRuleScore: number;
  pointsScale: number;
  initialPointsBySeat: Record<number, number>;
  phase: 'playing' | 'settling' | 'done';
  dealer: number;
  roundWind: number;
  turnSeat: number;
  turnStep: 'discard' | 'draw';
  turnSince: number;
  turnDeadline: number | null;
  wallOrder: Array<number>;
  wallHeadIndex: number;
  wallTailIndex: number;
  nextId: number;
  pending: GuobiaoPendingClaim | null;
  ledger: Array<GuobiaoLedgerEntry>;
  players: Record<number, GuobiaoPlayerState>;
  revealAllHands: boolean;
  lastDraw?: GuobiaoLastDraw | null;
  initialEventInterrupted?: boolean;
  drawCountBySeat?: Record<number, number>;
  discardCountBySeat?: Record<number, number>;
  autoBuhuaBySeat?: Record<number, boolean>;
  openingBuhuaSkippedBySeat?: Record<number, boolean>;
  settlingSince?: number | null;
  endSummary?: GuobiaoEndSummary | null;
};

const RULE_VERSION = 'mcr-81-v1';
const BASE_RULE_SCORE = 8;
const POINTS_SCALE = 100;
const WRONG_HU_RULE_SCORE = 10;
const DEFAULT_START_POINTS = 0;
const SETTLING_DELAY_MS = 5000;
const DEFAULT_DECISION_DEADLINE_MS = 6 * 60 * 1000;
const RESPONSE_DEADLINE_MS = DEFAULT_DECISION_DEADLINE_MS;
const DISCARD_DEADLINE_MS = DEFAULT_DECISION_DEADLINE_MS;
const HELD_ROTATION_IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

export class GuobiaoEngine {
  private game: Game;
  private appendReplayEvents: (events: Array<ReplayEvent>) => void;
  private tileKeyById: Map<number, number> = new Map();
  private pendingResponsesById: Map<number, Record<number, GuobiaoPendingResponse | null>> = new Map();
  private replaySeq: number = Date.now();
  private replayMetaLogged: boolean = false;

  constructor(game: Game, options: { appendReplayEvents: (events: Array<ReplayEvent>) => void }) {
    this.game = game;
    this.appendReplayEvents = options.appendReplayEvents;
  }

  // Cloudflare adapter: preserve all private state and replay sequencing on sleep.
  exportCheckpoint() { return { version: 1 as const, secret: this.exportSecretState(), replaySeq: this.replaySeq, replayMetaLogged: this.replayMetaLogged }; }
  restoreCheckpoint(saved: ReturnType<GuobiaoEngine['exportCheckpoint']>) {
    if (saved?.version !== 1) throw new Error('Unsupported guobiao checkpoint');
    this.restoreSecretState(saved.secret); this.replaySeq = saved.replaySeq; this.replayMetaLogged = saved.replayMetaLogged;
  }
  currentState(): GuobiaoState | null { return this.getState(); }
  viewState(seat: number | null): GuobiaoState | null { const state = this.getState(); return state ? this.sanitizeStateForSeat(state, seat) : null; }
  dshObserverTileFaceEntries(seat: number, _reveal: boolean): Entry[] {
    return this.findPrivateTileFaceIdsForSeat(seat).map(id => ['tileFaceSelf', id, this.tileKeyById.get(id) ?? null] as Entry);
  }
  recordAiDecisionResolution(input: any): void { this.logReplay('ai_decision', { seat: input.seat, scene: input.scene, source: input.source, modelId: input.modelId, modelLabel: input.modelLabel, elapsedMs: input.elapsedMs, actionKind: input.actionKind }, { [input.seat]: { action: input.privateActionLabel } }); }

  private friendDecisionTimeoutMs(): number | null {
    const match: any = this.game.get('match', 0);
    if (String(match?.roomType ?? '') !== 'friend') return null;
    const cfg: any = match?.friendConfig ?? match?.bloodConfig ?? null;
    if (String(cfg?.waitMode ?? '') !== 'timeoutAuto') return null;
    const value = Math.trunc(Number(cfg?.timeoutMs));
    return Number.isFinite(value) && value > 0 ? value : 6 * 60 * 1000;
  }

  private discardDeadline(now: number): number | null {
    const friendTimeoutMs = this.friendDecisionTimeoutMs();
    if (friendTimeoutMs === null) {
      const match: any = this.game.get('match', 0);
      if (String(match?.roomType ?? '') === 'friend') return null;
      return now + DISCARD_DEADLINE_MS;
    }
    return now + friendTimeoutMs;
  }

  private responseDeadline(now: number): number | null {
    const friendTimeoutMs = this.friendDecisionTimeoutMs();
    if (friendTimeoutMs === null) {
      const match: any = this.game.get('match', 0);
      if (String(match?.roomType ?? '') === 'friend') return null;
      return now + RESPONSE_DEADLINE_MS;
    }
    return now + friendTimeoutMs;
  }

  onPlayerConnected(playerId: string): void {
    const state = this.getState();
    if (!state) return;
    const seat = this.game.getSeatForPlayer(playerId);
    if (seat === null) return;
    this.sendPrivateStateForSeat(state, seat, playerId);
    this.sendTileFaceSelfFull(seat, playerId);
  }

  tick(now: number = Date.now()): void {
    if (!isAuthoritativeMode()) return;
    const match = this.game.get('match', 0);
    if (!match || match?.conditions?.gameType !== 'GUOBIAO') return;

    const state = this.getState();
    if (!state) {
      const seatToPlayer = this.getSeatToPlayer();
      const ready = [0, 1, 2, 3].every((s) => typeof seatToPlayer[s] === 'string' && seatToPlayer[s] !== null);
      if (ready) this.startGame(now);
      return;
    }

    const storedState = (this.game.get('gb', 0) as GuobiaoState | null) ?? null;
    if (storedState && this.stateNeedsPublicSanitization(storedState)) {
      this.setState(state, []);
    }

    this.migrateLegacyFlowerSlots(state);

    if (this.syncPlayers(state)) return;
    if (state.phase === 'done') return;

    if (state.phase === 'settling') {
      const since = state.settlingSince ?? null;
      if (since === null) {
        this.setState({ ...state, settlingSince: now }, []);
        return;
      }
      if (now - since >= SETTLING_DELAY_MS) {
        this.setState({ ...state, phase: 'done' }, []);
      }
      return;
    }

    if (state.pending) {
      this.tickPending(state, now);
      return;
    }

    if (state.turnStep === 'draw') {
      this.drawForSeat(state, state.turnSeat, now);
      return;
    }

    if (state.turnStep === 'discard' && state.turnDeadline !== null && now >= state.turnDeadline) {
      this.autoResolveDiscardTurn(state, now);
    }
  }

  handleAction(playerId: string, rawAction: any, now: number = Date.now()): { ok: true } | { ok: false; error: string } {
    const action = normalizeAction(rawAction);
    if (!action) return { ok: false, error: 'invalid action' };
    const seat = this.game.getSeatForPlayer(playerId);
    if (seat === null) return { ok: false, error: 'not seated' };
    const state = this.getState();
    if (!state) return { ok: false, error: 'game not started' };
    const me = state.players[seat];
    if (!me || me.playerId !== playerId) return { ok: false, error: 'seat mismatch' };

    if (action.kind === 'discard') {
      return this.handleDiscard(state, seat, action.tileId, now);
    }
    if (action.kind === 'claim') {
      return this.handleClaim(state, seat, action.pendingId, action.action, now, action.optionId);
    }
    if (action.kind === 'hu') {
      return this.handleSelfHu(state, seat, now);
    }
    if (action.kind === 'buhua') {
      return this.handleBuhua(state, seat, action.tileId, now);
    }
    if (action.kind === 'setAutoBuhua') {
      return this.handleSetAutoBuhua(state, seat, action.enabled);
    }
    if (action.kind === 'anGang') {
      return this.handleAnGang(state, seat, action, now);
    }
    if (action.kind === 'addGang') {
      return this.handleAddGang(state, seat, action, now);
    }
    return { ok: false, error: 'invalid action' };
  }

  exportSecretState(): { tileKeyById: Array<[number, number]>; pendingResponsesById?: Array<[number, Array<[number, GuobiaoPendingResponse | null]>]> } {
    const pendingResponsesById = Array.from(this.pendingResponsesById.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([pendingId, responses]) => [pendingId, Object.entries(responses)
        .map(([seat, response]) => [Math.trunc(Number(seat)), clonePendingResponse(response)] as [number, GuobiaoPendingResponse | null])
        .sort((a, b) => a[0] - b[0])] as [number, Array<[number, GuobiaoPendingResponse | null]>]);
    return {
      tileKeyById: Array.from(this.tileKeyById.entries()).sort((a, b) => a[0] - b[0]),
      ...(pendingResponsesById.length > 0 ? { pendingResponsesById } : {}),
    };
  }

  restoreSecretState(raw: any): void {
    const rows = Array.isArray(raw?.tileKeyById) ? raw.tileKeyById : [];
    const next = new Map<number, number>();
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const id = Math.trunc(Number(row[0]));
      const key = Math.trunc(Number(row[1]));
      if (!Number.isFinite(id) || !Number.isFinite(key)) continue;
      next.set(id, key);
    }
    if (next.size > 0) this.tileKeyById = next;

    this.pendingResponsesById.clear();
    const pendingRows = Array.isArray(raw?.pendingResponsesById) ? raw.pendingResponsesById : [];
    for (const row of pendingRows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const pendingId = Math.trunc(Number(row[0]));
      if (!Number.isFinite(pendingId)) continue;
      const responseRows = Array.isArray(row[1]) ? row[1] : [];
      const responses = emptyPendingResponses();
      for (const responseRow of responseRows) {
        if (!Array.isArray(responseRow) || responseRow.length < 2) continue;
        const seat = Math.trunc(Number(responseRow[0]));
        if (!Number.isFinite(seat) || seat < 0 || seat > 3) continue;
        responses[seat] = clonePendingResponse(responseRow[1] as GuobiaoPendingResponse | null);
      }
      this.pendingResponsesById.set(pendingId, responses);
    }
  }

  listHandTilesForSeat(seat: number): Array<{ tileId: number; tileKey: number; slotName: string }> {
    const out: Array<{ tileId: number; tileKey: number; slotName: string }> = [];
    for (const tileId of this.findHandTileIds(seat)) {
      const info = this.getThing(tileId);
      const tileKey = this.tileKeyById.get(tileId) ?? null;
      if (!info || tileKey === null) continue;
      out.push({ tileId, tileKey, slotName: info.slotName });
    }
    out.sort((a, b) => a.slotName.localeCompare(b.slotName) || a.tileId - b.tileId);
    return out;
  }

  claimOptionsForSeat(state: GuobiaoState, seat: number): GuobiaoClaimOptions {
    if (!state.pending) return emptySeatClaimOptions();
    return cloneClaimOptions(this.getPendingClaimOptions(state, state.pending)[seat] ?? emptySeatClaimOptions());
  }

  fanMeldsForSeat(state: GuobiaoState, seat: number): Array<GuobiaoFanMeld> {
    const ps = state.players?.[seat] ?? null;
    return (ps?.melds ?? [])
      .filter((m): m is GuobiaoTileMeld => m.kind !== 'flower')
      .map((meld) => this.toFanMeld(meld));
  }

  canAttemptSelfHuForSeat(state: GuobiaoState, seat: number): boolean {
    if (state.phase !== 'playing' || state.pending !== null || state.turnSeat !== seat || state.turnStep !== 'discard') {
      return false;
    }
    if (state.players[seat]?.wrongHu === true) return false;
    const currentSelfDraw = this.findCurrentSelfDrawForHu(state, seat);
    const isHeavenlyHand = this.isHeavenlyHand(state, seat);
    if (!isHeavenlyHand && currentSelfDraw === null) return false;
    const selfHuTileKey = currentSelfDraw?.tileKey ?? this.findExtraTileKey(seat);
    if (!isHeavenlyHand && selfHuTileKey !== null && isGuobiaoFlower(selfHuTileKey)) return false;
    return true;
  }

  selfHuFanResultForSeat(state: GuobiaoState, seat: number): GuobiaoFanResult | null {
    if (!this.canAttemptSelfHuForSeat(state, seat)) return null;
    const currentSelfDraw = this.findCurrentSelfDrawForHu(state, seat);
    const isHeavenlyHand = this.isHeavenlyHand(state, seat);
    const selfHuTileKey = currentSelfDraw?.tileKey ?? this.findExtraTileKey(seat);
    return this.calculateSeatWin(seat, null, {
      isSelfDrawn: true,
      isKongDraw: this.isImmediateKongSupplementWin(state, seat, selfHuTileKey),
      isLastTileDraw: state.wallHeadIndex > state.wallTailIndex,
      isHeavenlyHand,
      isHumanHandTwo: this.isHumanHandTwoSelfDraw(state, seat, selfHuTileKey),
      winningTileKey: isHeavenlyHand ? undefined : selfHuTileKey ?? undefined,
    });
  }

  private startGame(now: number): void {
    const seatToPlayer = this.getSeatToPlayer();
    const initialPointsBySeat = this.getSeatStartPoints();
    const players: Record<number, GuobiaoPlayerState> = {
      0: emptyPlayer(0, seatToPlayer[0] ?? null, initialPointsBySeat[0] ?? DEFAULT_START_POINTS),
      1: emptyPlayer(1, seatToPlayer[1] ?? null, initialPointsBySeat[1] ?? DEFAULT_START_POINTS),
      2: emptyPlayer(2, seatToPlayer[2] ?? null, initialPointsBySeat[2] ?? DEFAULT_START_POINTS),
      3: emptyPlayer(3, seatToPlayer[3] ?? null, initialPointsBySeat[3] ?? DEFAULT_START_POINTS),
    };

    this.tileKeyById = makeShuffledTileMapping();
    const things = this.makeInitialDealThings();
    const wallOrder = computeWallOrderFromThings(things);
    let state: GuobiaoState = {
      version: 1,
      ruleVersion: RULE_VERSION,
      baseRuleScore: BASE_RULE_SCORE,
      pointsScale: POINTS_SCALE,
      initialPointsBySeat,
      phase: 'playing',
      dealer: 0,
      roundWind: 0,
      turnSeat: 0,
      turnStep: 'discard',
      turnSince: now,
      turnDeadline: this.discardDeadline(now),
      wallOrder,
      wallHeadIndex: 0,
      wallTailIndex: wallOrder.length - 1,
      nextId: 1,
      pending: null,
      ledger: [],
      players,
      revealAllHands: false,
      lastDraw: null,
      initialEventInterrupted: false,
      drawCountBySeat: emptySeatCounter(),
      discardCountBySeat: emptySeatCounter(),
      autoBuhuaBySeat: this.initialAutoBuhuaBySeat(),
      settlingSince: null,
      endSummary: null,
    };

    const publicFaces: Array<[number, number]> = [];
    const openingBuhuaLogs: Array<{
      seat: number;
      publicFaces: Array<[number, number]>;
      replacementDraws: Array<{ tileId: number; tileKey: number }>;
    }> = [];
    for (let seat = 0; seat < 4; seat++) {
      if (this.canAutoBuhua(state, seat)) {
        const out = this.autoBuhuaInThingMap(state, things, seat);
        state = out.state;
        publicFaces.push(...out.publicFaces);
        if (out.publicFaces.length > 0) {
          openingBuhuaLogs.push({ seat, publicFaces: out.publicFaces, replacementDraws: out.replacementDraws });
        }
      }
    }

    const entries: Array<Entry> = [];
    for (const [tileId, info] of things.entries()) entries.push(['things', tileId, info]);
    for (const [tileId, tileKey] of publicFaces) entries.push(['tileFacePublic', tileId, tileKey]);
    this.setState(state, entries);

    if (!this.replayMetaLogged) {
      this.replayMetaLogged = true;
      this.logReplay('meta', {
        variant: 'guobiao',
        base: BASE_RULE_SCORE * POINTS_SCALE,
        dealer: state.dealer,
        ruleVersion: RULE_VERSION,
        baseRuleScore: BASE_RULE_SCORE,
        pointsScale: POINTS_SCALE,
        rules: {
          variant: 'guobiao',
          ruleVersion: RULE_VERSION,
          baseRuleScore: BASE_RULE_SCORE,
          pointsScale: POINTS_SCALE,
        },
      }, null);
    }
    for (const item of openingBuhuaLogs) {
      this.logReplayBuhuaEvents(item.seat, item.publicFaces, item.replacementDraws, true);
    }
    this.logReplay('hands', { phase: 'playing' }, this.buildHandsReplayPrivate());
    this.logReplay('phase', { from: 'dealing', to: 'playing' }, null);

    for (let seat = 0; seat < 4; seat++) {
      const pid = state.players[seat]?.playerId ?? null;
      if (pid) this.sendTileFaceSelfFull(seat, pid);
    }
  }

  private handleDiscard(state: GuobiaoState, seat: number, tileId: number, now: number): { ok: true } | { ok: false; error: string } {
    if (state.phase !== 'playing' || state.pending !== null || state.turnSeat !== seat || state.turnStep !== 'discard') {
      return { ok: false, error: 'not your discard turn' };
    }
    const thing = this.getThing(tileId);
    if (!thing) return { ok: false, error: 'tile not found' };
    if (!isHandSlot(thing.slotName, seat)) return { ok: false, error: 'tile not in hand' };
    const tileKey = this.tileKeyById.get(tileId) ?? null;
    if (tileKey === null) return { ok: false, error: 'unknown tile' };
    const discardSlot = this.pickNextDiscardSlot(seat);
    if (!discardSlot) return { ok: false, error: 'no discard slot' };

    const fromSlotName = thing.slotName;
    const entries: Array<Entry> = [];
    entries.push(['things', tileId, { ...thing, slotName: discardSlot, rotationIndex: 0, claimedBy: null, shiftSlotName: null }]);

    const extraTileId = this.findTileInSlot(`hand.extra@${seat}`);
    if (extraTileId !== null && extraTileId !== tileId && !fromSlotName.startsWith('hand.extra')) {
      const ex = this.getThing(extraTileId);
      if (ex) entries.push(['things', extraTileId, { ...ex, slotName: fromSlotName, rotationIndex: 0, claimedBy: null, shiftSlotName: null }]);
    }
    entries.push(['tileFacePublic', tileId, tileKey]);

    const stateAfterDiscard: GuobiaoState = {
      ...state,
      discardCountBySeat: incrementSeatCounter(state.discardCountBySeat, seat),
      lastDraw: null,
    };
    const options = isGuobiaoFlower(tileKey) ? emptyClaimOptions() : this.computeDiscardClaimOptions(stateAfterDiscard, seat, tileId, tileKey);
    const hasClaim = [0, 1, 2, 3].some((s) => hasAnyClaimOption(options[s]));
    let nextState: GuobiaoState = {
      ...stateAfterDiscard,
      pending: null,
      turnSeat: nextSeat(seat),
      turnStep: 'draw',
      turnSince: now,
      turnDeadline: null,
    };
    if (hasClaim) {
      const pendingId = state.nextId;
      nextState = {
        ...stateAfterDiscard,
        pending: {
          kind: 'discardClaim',
          id: pendingId,
          since: now,
          deadline: this.responseDeadline(now),
          fromSeat: seat,
          tileId,
          tileKey,
          options,
          responses: { 0: null, 1: null, 2: null, 3: null },
        },
        nextId: pendingId + 1,
        lastDraw: null,
        turnDeadline: null,
      };
    }
    this.setState(nextState, entries);
    this.logReplay('discard', { seat, tile: guobiaoTileCode(tileKey) }, null);
    this.tick(now);
    return { ok: true };
  }

  private handleClaim(
    state: GuobiaoState,
    seat: number,
    pendingId: number,
    action: GuobiaoClaimAction,
    now: number,
    optionId?: string,
  ): { ok: true } | { ok: false; error: string } {
    const pending = state.pending;
    if (state.phase !== 'playing' || !pending) return { ok: false, error: 'no pending claim' };
    if (pending.id !== pendingId) return { ok: false, error: 'pendingId mismatch' };
    if (seat === pending.fromSeat) return { ok: false, error: 'cannot claim own discard' };
    if (pending.responses[seat] !== null) return { ok: false, error: 'already responded' };
    const pendingOptions = this.getPendingClaimOptions(state, pending);
    const opt = pendingOptions[seat] ?? emptySeatClaimOptions();
    if (!hasAnyClaimOption(opt)) return { ok: false, error: 'no claim option' };
    if (action === 'hu' && !opt.hu) return { ok: false, error: 'action not allowed' };
    if (action === 'chi' && !opt.chi.some((x) => x.optionId === optionId)) return { ok: false, error: 'action not allowed' };
    if (action === 'peng' && !opt.peng) return { ok: false, error: 'action not allowed' };
    if (action === 'mingGang' && !opt.mingGang) return { ok: false, error: 'action not allowed' };
    if (action !== 'hu' && pending.kind === 'robGangHu' && action !== 'pass') return { ok: false, error: 'action not allowed' };
    if (action === 'pass' && !opt.pass) return { ok: false, error: 'action not allowed' };

    const nextPending: GuobiaoPendingClaim = {
      ...pending,
      responses: { ...pending.responses, [seat]: optionId ? { action, optionId } : { action } },
    };
    const nextState = { ...state, pending: nextPending };
    this.setState(nextState, []);
    this.tickPending(nextState, now);
    return { ok: true };
  }

  private handleSelfHu(state: GuobiaoState, seat: number, now: number): { ok: true } | { ok: false; error: string } {
    if (state.phase !== 'playing' || state.pending !== null || state.turnSeat !== seat || state.turnStep !== 'discard') {
      return { ok: false, error: 'not your turn' };
    }
    if (state.players[seat]?.wrongHu === true) {
      return { ok: false, error: 'already wrong hu' };
    }
    const currentSelfDraw = this.findCurrentSelfDrawForHu(state, seat);
    const isHeavenlyHand = this.isHeavenlyHand(state, seat);
    if (!isHeavenlyHand && currentSelfDraw === null) {
      return { ok: false, error: 'not self draw' };
    }
    const selfHuTileKey = currentSelfDraw?.tileKey ?? this.findExtraTileKey(seat);
    if (!isHeavenlyHand && selfHuTileKey !== null && isGuobiaoFlower(selfHuTileKey)) {
      return { ok: false, error: 'not a winning hand' };
    }
    const calc = this.selfHuFanResultForSeat(state, seat);
    if (!calc?.valid) return { ok: false, error: 'not a winning hand' };
    if (calc.qualifyingFanTotal < BASE_RULE_SCORE) {
      this.applyWrongHu(state, seat, now, '未满 8 番');
      return { ok: true };
    }
    this.settleHu(state, [seat], null, calc, now, selfHuTileKey);
    return { ok: true };
  }

  private handleBuhua(state: GuobiaoState, seat: number, tileId: number, now: number): { ok: true } | { ok: false; error: string } {
    if (state.phase !== 'playing' || state.pending !== null || state.turnSeat !== seat || state.turnStep !== 'discard') {
      return { ok: false, error: 'not your turn' };
    }
    if (!hasWallTile(state)) return { ok: false, error: 'cannot buhua at haitei' };
    const info = this.getThing(tileId);
    if (!info || !isHandSlot(info.slotName, seat)) return { ok: false, error: 'tile not in hand' };
    const tileKey = this.tileKeyById.get(tileId) ?? null;
    if (tileKey === null || !isGuobiaoFlower(tileKey)) return { ok: false, error: 'not a flower tile' };
    const things = this.currentThingMap();
    const out = this.buhuaOneInThingMap(state, things, seat, { tileId, tileKey, info });
    if (!out.ok) return { ok: false, error: out.error };
    let nextState = out.state;
    nextState = {
      ...nextState,
      lastDraw: out.replacementDraw ? { seat, tileId: out.replacementDraw.tileId, source: 'flowerSupplement' } : null,
      turnSeat: seat,
      turnStep: 'discard',
      turnSince: now,
      turnDeadline: this.discardDeadline(now),
    };
    const entries: Array<Entry> = [];
    for (const [id, thing] of things.entries()) entries.push(['things', id, thing]);
    for (const [id, key] of out.publicFaces) entries.push(['tileFacePublic', id, key]);
    this.setState(nextState, entries);
    const pid = nextState.players[seat]?.playerId ?? null;
    if (pid) this.sendTileFaceSelfFull(seat, pid);
    this.logReplayBuhuaEvents(seat, out.publicFaces, out.replacementDraw ? [out.replacementDraw] : [], false);
    this.tick(now);
    return { ok: true };
  }

  private handleSetAutoBuhua(state: GuobiaoState, seat: number, enabled: boolean): { ok: true } | { ok: false; error: string } {
    if (state.phase !== 'playing') return { ok: false, error: 'game not playing' };
    const nextState: GuobiaoState = {
      ...state,
      autoBuhuaBySeat: { ...this.autoBuhuaBySeat(state), [seat]: enabled },
    };
    this.setState(nextState, []);
    return { ok: true };
  }

  private handleAnGang(
    state: GuobiaoState,
    seat: number,
    action: Extract<GuobiaoAction, { kind: 'anGang' }>,
    now: number,
  ): { ok: true } | { ok: false; error: string } {
    if (state.phase !== 'playing' || state.pending !== null || state.turnSeat !== seat || state.turnStep !== 'discard') {
      return { ok: false, error: 'not your turn' };
    }
    if (!hasWallTile(state)) return { ok: false, error: 'cannot gang at haitei' };

    const ids = Array.isArray(action.tileIds) && action.tileIds.length === 4
      ? action.tileIds.map((x) => Math.trunc(Number(x)))
      : null;
    if (ids && (ids.some((id) => !Number.isFinite(id)) || new Set(ids).size !== 4)) {
      return { ok: false, error: 'need 4 unique tiles' };
    }
    const tileKey = typeof action.tileKey === 'number' && Number.isFinite(action.tileKey)
      ? Math.trunc(action.tileKey)
      : (ids ? this.tileKeyById.get(ids[0]!) ?? null : null);
    if (tileKey === null || !isGuobiaoTileKey(tileKey) || isGuobiaoFlower(tileKey)) return { ok: false, error: 'invalid gang tile' };

    const tiles = ids ?? this.findHandTilesByKey(seat, tileKey).slice(0, 4);
    if (tiles.length !== 4) return { ok: false, error: 'need 4 tiles' };
    for (const id of tiles) {
      const info = this.getThing(id);
      if (!info || !isHandSlot(info.slotName, seat)) return { ok: false, error: 'tile not in hand' };
      if ((this.tileKeyById.get(id) ?? null) !== tileKey) return { ok: false, error: 'tile key mismatch' };
    }

    const ps = state.players[seat];
    if (!ps) return { ok: false, error: 'no player' };
    const row = this.pickMeldRow(ps);
    if (row === null) return { ok: false, error: 'no meld row' };

    const things = this.currentThingMap();
    const targets = [`meld.${row}.0@${seat}`, `meld.${row}.1@${seat}`, `meld.${row}.2@${seat}`, `meld.${row}.3@${seat}`];
    // 国标暗杠在对局中对其他玩家四张盖住；牌面只通过私有 tileFaceSelf 发给杠牌本人，盘末再公开。
    const rotations = [2, 2, 2, 2];
    for (let i = 0; i < 4; i++) {
      const id = tiles[i]!;
      const info = things.get(id);
      if (!info) return { ok: false, error: 'tile not found' };
      things.set(id, { ...info, slotName: targets[i]!, rotationIndex: rotations[i]!, claimedBy: null, shiftSlotName: null });
    }
    this.moveExtraToHandInThingMap(things, seat, new Set(tiles));

    let nextState: GuobiaoState = {
      ...state,
      initialEventInterrupted: true,
      players: {
        ...state.players,
        [seat]: {
          ...ps,
          melds: [
            ...ps.melds,
            {
              id: state.nextId,
              kind: 'anGang',
              tileKeys: [tileKey, tileKey, tileKey, tileKey],
              tileIds: [...tiles],
              fromSeat: null,
              claimedTileId: null,
              claimedTileKey: null,
              row,
              concealed: true,
            },
          ],
        },
      },
      nextId: state.nextId + 1,
    };
    const draw = this.drawSupplementInThingMap(nextState, things, seat);
    if (!draw.ok) return { ok: false, error: draw.error };
    nextState = {
      ...draw.state,
      lastDraw: this.lastKongSupplementDraw(draw, seat),
      turnSeat: seat,
      turnStep: 'discard',
      turnSince: now,
      turnDeadline: this.discardDeadline(now),
    };

    const entries = thingMapEntries(things);
    this.setState(nextState, entries);
    const pid = nextState.players[seat]?.playerId ?? null;
    if (pid) this.sendTileFaceSelfFull(seat, pid);
    this.logReplay('anGang', { seat }, { [String(seat)]: { tile: guobiaoTileCode(tileKey) } });
    this.logReplayDraw(seat, this.lastKongSupplementDraw(draw, seat));
    return { ok: true };
  }

  private handleAddGang(
    state: GuobiaoState,
    seat: number,
    action: Extract<GuobiaoAction, { kind: 'addGang' }>,
    now: number,
  ): { ok: true } | { ok: false; error: string } {
    if (state.phase !== 'playing' || state.pending !== null || state.turnSeat !== seat || state.turnStep !== 'discard') {
      return { ok: false, error: 'not your turn' };
    }
    if (!hasWallTile(state)) return { ok: false, error: 'cannot gang at haitei' };

    const ps = state.players[seat];
    if (!ps) return { ok: false, error: 'no player' };
    const tileId = typeof action.tileId === 'number' && Number.isFinite(action.tileId)
      ? Math.trunc(action.tileId)
      : null;
    const explicitMeldId = typeof action.meldId === 'number' && Number.isFinite(action.meldId)
      ? Math.trunc(action.meldId)
      : null;
    const tileKey = tileId !== null ? (this.tileKeyById.get(tileId) ?? null) : null;
    const peng = ps.melds.find((m) => {
      if (m.kind !== 'peng') return false;
      if (explicitMeldId !== null) return m.id === explicitMeldId;
      return tileKey !== null && m.claimedTileKey === tileKey;
    }) as GuobiaoTileMeld | undefined;
    if (!peng) return { ok: false, error: 'no peng meld' };
    const gangTileKey = peng.claimedTileKey ?? peng.tileKeys[0] ?? null;
    if (gangTileKey === null) return { ok: false, error: 'invalid peng meld' };

    const chosenTileId = tileId ?? this.findPreferredHandTileByKey(seat, gangTileKey);
    if (chosenTileId === null) return { ok: false, error: 'missing tile' };
    const info = this.getThing(chosenTileId);
    if (!info || !isHandSlot(info.slotName, seat)) return { ok: false, error: 'tile not in hand' };
    if ((this.tileKeyById.get(chosenTileId) ?? null) !== gangTileKey) return { ok: false, error: 'tile key mismatch' };

    const options = this.computeRobGangOptions(state, seat, chosenTileId, gangTileKey);
    const hasRob = [0, 1, 2, 3].some((s) => hasAnyClaimOption(options[s]));
    if (hasRob) {
      const pendingId = state.nextId;
      const nextState: GuobiaoState = {
        ...state,
        pending: {
          kind: 'robGangHu',
          id: pendingId,
          since: now,
          deadline: this.responseDeadline(now),
          fromSeat: seat,
          tileId: chosenTileId,
          tileKey: gangTileKey,
          options,
          responses: { 0: null, 1: null, 2: null, 3: null },
        },
        nextId: pendingId + 1,
        initialEventInterrupted: true,
        turnDeadline: null,
      };
      this.setState(nextState, []);
      this.logReplay('addGang', { seat, tile: guobiaoTileCode(gangTileKey), pending: true }, null);
      return { ok: true };
    }

    return this.finalizeAddGang(state, {
      kind: 'robGangHu',
      id: state.nextId,
      since: now,
      deadline: now,
      fromSeat: seat,
      tileId: chosenTileId,
      tileKey: gangTileKey,
      options,
      responses: { 0: { action: 'pass' }, 1: { action: 'pass' }, 2: { action: 'pass' }, 3: { action: 'pass' } },
    }, now);
  }

  private tickPending(state: GuobiaoState, now: number): void {
    let pending = state.pending;
    if (!pending) return;

    const responseSeats = this.pendingResponseSeats(state, pending);
    if (pending.deadline !== null && now >= pending.deadline) {
      const responses = { ...pending.responses };
      let changed = false;
      for (const seat of responseSeats) {
        if (responses[seat] === null) {
          responses[seat] = { action: 'pass' };
          changed = true;
        }
      }
      if (changed) {
        pending = { ...pending, responses };
        state = { ...state, pending };
        this.setState(state, []);
      }
    }

    const allDone = responseSeats.every((s) => pending?.responses[s] !== null);
    if (!allDone) return;

    let workingState = state;
    const huResponders = claimOrder(pending.fromSeat).filter((s) => pending?.responses[s]?.action === 'hu');
    for (const winner of huResponders) {
      const calc = this.calculateSeatWin(winner, pending.tileKey, {
        isRobbingKong: pending.kind === 'robGangHu',
        isLastTileClaim: pending.kind === 'discardClaim' && workingState.wallHeadIndex > workingState.wallTailIndex,
        isEarthlyHand: pending.kind === 'discardClaim' && this.isEarthlyHandClaim(workingState, pending.fromSeat, winner),
        isHumanHandOne: pending.kind === 'discardClaim' && this.isHumanHandOneClaim(workingState, pending.fromSeat, winner),
      }, pending.tileId);
      if (!calc.valid) continue;
      if (calc.qualifyingFanTotal >= BASE_RULE_SCORE) {
        const settlementEntries = pending.kind === 'robGangHu'
          ? this.makeRobGangHuSettlementEntries(pending)
          : [];
        this.settleHu(workingState, [winner], pending.fromSeat, calc, now, pending.tileKey, settlementEntries);
        return;
      }
      workingState = this.applyWrongHuToState(workingState, winner, now, '未满 8 番');
      if (allPlayersWrongHu(workingState.players)) {
        this.settleDraw(workingState, now);
        return;
      }
    }

    if (pending.kind === 'robGangHu') {
      this.finalizeAddGang(workingState, pending, now);
      return;
    }

    for (const seat of claimOrder(pending.fromSeat)) {
      const response = pending.responses[seat];
      if (response?.action === 'mingGang') {
        if (this.applyMingGang(workingState, pending, seat, now)) return;
      }
      if (response?.action === 'peng') {
        if (this.applyPeng(workingState, pending, seat, now)) return;
      }
    }

    const chiSeat = nextSeat(pending.fromSeat);
    const chiResponse = pending.responses[chiSeat];
    if (chiResponse?.action === 'chi' && chiResponse.optionId) {
      if (this.applyChi(workingState, pending, chiSeat, chiResponse.optionId, now)) return;
    }

    {
      const nextState: GuobiaoState = {
        ...workingState,
        pending: null,
        turnSeat: nextSeat(pending.fromSeat),
        turnStep: 'draw',
        turnSince: now,
        turnDeadline: null,
      };
      this.setState(nextState, []);
      this.tick(now);
    }
  }

  private drawForSeat(state: GuobiaoState, seat: number, now: number): void {
    if (state.wallHeadIndex > state.wallTailIndex) {
      this.settleDraw(state, now);
      return;
    }

    const tileId = state.wallOrder[state.wallHeadIndex]!;
    const info = this.getThing(tileId);
    if (!info) {
      this.settleDraw(state, now);
      return;
    }
    const target = this.pickDrawSlot(seat);
    if (!target) {
      this.settleDraw(state, now);
      return;
    }

    const things = this.currentThingMap();
    things.set(tileId, { ...info, slotName: target, rotationIndex: 0, claimedBy: null, shiftSlotName: null });
    let nextState: GuobiaoState = {
      ...state,
      wallHeadIndex: state.wallHeadIndex + 1,
      drawCountBySeat: incrementSeatCounter(state.drawCountBySeat, seat),
      turnSeat: seat,
      turnStep: 'discard',
      turnSince: now,
      turnDeadline: this.discardDeadline(now),
    };
    const out = this.autoBuhuaInThingMap(nextState, things, seat);
    const drawnTileKey = this.tileKeyById.get(tileId) ?? null;
    nextState = {
      ...out.state,
      lastDraw: out.replacementDraws.length > 0
        ? this.lastFlowerSupplementDraw(out, seat)
        : (drawnTileKey === null ? null : { seat, tileId, source: 'wall' }),
      turnSeat: seat,
      turnStep: 'discard',
      turnSince: now,
      turnDeadline: this.discardDeadline(now),
    };

    const entries: Array<Entry> = [];
    for (const [id, thing] of things.entries()) entries.push(['things', id, thing]);
    for (const [id, key] of out.publicFaces) entries.push(['tileFacePublic', id, key]);
    this.setState(nextState, entries);

    const pid = nextState.players[seat]?.playerId ?? null;
    if (pid) this.sendTileFaceSelfFull(seat, pid);
    this.logReplayDraw(seat, drawnTileKey === null ? null : { seat, tileId, tileKey: drawnTileKey, source: 'wall' });
    this.logReplayBuhuaEvents(seat, out.publicFaces, out.replacementDraws, true);
  }

  private autoResolveDiscardTurn(state: GuobiaoState, now: number): void {
    const seat = state.turnSeat;
    const hand = this.listHandTilesForSeat(seat);
    if (hand.length <= 0) return;
    const extra = hand.find((x) => x.slotName === `hand.extra@${seat}` && !isGuobiaoFlower(x.tileKey)) ?? null;
    const nonFlowers = hand.filter((x) => !isGuobiaoFlower(x.tileKey));
    const discard = extra ?? nonFlowers.sort((a, b) => b.tileKey - a.tileKey || b.tileId - a.tileId)[0] ?? null;
    if (discard) {
      this.logReplay('timeoutDiscard', { seat, tile: guobiaoTileCode(discard.tileKey) }, null);
      this.handleDiscard(state, seat, discard.tileId, now);
      return;
    }
    const flower = hand.find((x) => isGuobiaoFlower(x.tileKey)) ?? null;
    if (flower && hasWallTile(state) && this.canAutoBuhua(state, seat)) {
      this.logReplay('timeoutBuhua', { seat, tile: guobiaoTileCode(flower.tileKey) }, null);
      this.applyAutoBuhuaForSeat(state, seat, now);
      return;
    }
    if (flower) {
      this.logReplay('timeoutDiscard', { seat, tile: guobiaoTileCode(flower.tileKey) }, null);
      this.handleDiscard(state, seat, flower.tileId, now);
    }
  }

  private applyAutoBuhuaForSeat(state: GuobiaoState, seat: number, now: number): void {
    const things = this.currentThingMap();
    const out = this.autoBuhuaInThingMap(state, things, seat);
    const nextState: GuobiaoState = {
      ...out.state,
      lastDraw: this.lastFlowerSupplementDraw(out, seat),
      turnSeat: seat,
      turnStep: 'discard',
      turnSince: now,
      turnDeadline: this.discardDeadline(now),
    };
    const entries: Array<Entry> = [];
    for (const [id, thing] of things.entries()) entries.push(['things', id, thing]);
    for (const [id, key] of out.publicFaces) entries.push(['tileFacePublic', id, key]);
    this.setState(nextState, entries);
    const pid = nextState.players[seat]?.playerId ?? null;
    if (pid) this.sendTileFaceSelfFull(seat, pid);
    this.logReplayBuhuaEvents(seat, out.publicFaces, out.replacementDraws, true);
    this.tick(now);
  }

  private settleHu(
    state: GuobiaoState,
    winners: Array<number>,
    fromSeat: number | null,
    calc: GuobiaoFanResult,
    now: number,
    huTileKey: number | null,
    extraEntries: Array<Entry> = [],
  ): void {
    const players: Record<number, GuobiaoPlayerState> = { ...state.players };
    const pointDelta: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    const ruleDelta: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    const transfers: Array<GuobiaoLedgerTransfer> = [];
    const fanTotal = Math.max(0, Math.trunc(calc.fanTotal));

    for (const winner of winners) {
      const ps = players[winner];
      if (ps) players[winner] = { ...ps, hu: true, huTileKey };
      if (fromSeat === null) {
        for (let loser = 0; loser < 4; loser++) {
          if (loser === winner) continue;
          const ruleScore = fanTotal + BASE_RULE_SCORE;
          transfers.push({ fromSeat: loser, toSeat: winner, ruleScore, points: ruleScore * POINTS_SCALE });
        }
      } else {
        for (let payer = 0; payer < 4; payer++) {
          if (payer === winner) continue;
          const ruleScore = payer === fromSeat ? fanTotal + BASE_RULE_SCORE : BASE_RULE_SCORE;
          transfers.push({ fromSeat: payer, toSeat: winner, ruleScore, points: ruleScore * POINTS_SCALE });
        }
      }
    }

    applyTransfers(players, transfers, pointDelta, ruleDelta);
    const entry: GuobiaoLedgerEntry = {
      kind: 'hu',
      label: fromSeat === null ? '自摸' : '点和',
      seat: winners[0],
      fromSeat,
      fanTotal,
      fans: calc.fans,
      transfers,
      at: now,
    };
    const ledger = [...state.ledger, entry];
    const endSummary: GuobiaoEndSummary = {
      kind: 'hu',
      ruleVersion: state.ruleVersion,
      baseRuleScore: state.baseRuleScore,
      pointsScale: state.pointsScale,
      winners,
      fromSeat,
      fanTotal,
      fans: calc.fans,
      pointsBySeat: buildPointsBySeat(players),
      ruleScoreBySeat: buildRuleScoreBySeat(players),
      pointsDeltaBySeat: buildPointsDeltaBySeat(players, state.initialPointsBySeat),
      ruleScoreDeltaBySeat: buildRuleScoreBySeat(players),
    };
    const nextState: GuobiaoState = {
      ...state,
      phase: 'settling',
      turnStep: 'discard',
      pending: null,
      players,
      ledger,
      revealAllHands: true,
      settlingSince: now,
      endSummary,
    };
    const extraEntryKeys = new Set(extraEntries.map(([kind, key]) => `${kind}:${String(key)}`));
    const revealEntries = this.makeRevealAllEntries(nextState)
      .filter(([kind, key]) => !extraEntryKeys.has(`${kind}:${String(key)}`));
    this.setState(nextState, [...extraEntries, ...revealEntries]);
    this.logReplay('hu', {
      source: fromSeat === null ? 'self' : 'discard',
      seat: fromSeat === null ? winners[0] : undefined,
      winners,
      fromSeat,
      tile: huTileKey === null ? null : guobiaoTileCode(huTileKey),
    }, null);
    this.logReplay('ledger', { entry }, null);
    this.logReplay('end', buildGuobiaoEndReplayPublic(endSummary), null);
  }

  private makeRobGangHuSettlementEntries(pending: GuobiaoPendingClaim): Array<Entry> {
    if (pending.kind !== 'robGangHu') return [];
    const entries: Array<Entry> = [];
    const info = this.getThing(pending.tileId);
    if (info && isHandSlot(info.slotName, pending.fromSeat)) {
      const target = this.pickRobGangHuDisplaySlot(pending.fromSeat);
      if (target) {
        const fromSlotName = info.slotName;
        entries.push(['things', pending.tileId, { ...info, slotName: target, rotationIndex: 0, claimedBy: null, shiftSlotName: null }]);
        const extraTileId = this.findTileInSlot(`hand.extra@${pending.fromSeat}`);
        if (extraTileId !== null && extraTileId !== pending.tileId && !fromSlotName.startsWith('hand.extra')) {
          const extraInfo = this.getThing(extraTileId);
          if (extraInfo) {
            entries.push(['things', extraTileId, { ...extraInfo, slotName: fromSlotName, rotationIndex: 0, claimedBy: null, shiftSlotName: null }]);
          }
        }
      }
    }
    entries.push(['tileFacePublic', pending.tileId, pending.tileKey]);
    return entries;
  }

  private pickRobGangHuDisplaySlot(seat: number): string | null {
    const discardSlot = this.pickNextDiscardSlot(seat);
    if (discardSlot) return discardSlot;
    const used = new Set<string>();
    for (const [, raw] of this.game.entries('things')) used.add((raw as ThingInfo)?.slotName);
    for (let i = 0; i < 4; i++) {
      const slot = `discard.extra.${i}@${seat}`;
      if (!used.has(slot)) return slot;
    }
    return null;
  }

  private settleDraw(state: GuobiaoState, now: number): void {
    const entry: GuobiaoLedgerEntry = {
      kind: 'draw',
      label: '荒牌',
      transfers: [],
      at: now,
    };
    const endSummary: GuobiaoEndSummary = {
      kind: 'draw',
      ruleVersion: state.ruleVersion,
      baseRuleScore: state.baseRuleScore,
      pointsScale: state.pointsScale,
      winners: [],
      fromSeat: null,
      fanTotal: 0,
      fans: [],
      pointsBySeat: buildPointsBySeat(state.players),
      ruleScoreBySeat: buildRuleScoreBySeat(state.players),
      pointsDeltaBySeat: buildPointsDeltaBySeat(state.players, state.initialPointsBySeat),
      ruleScoreDeltaBySeat: buildRuleScoreBySeat(state.players),
    };
    const nextState: GuobiaoState = {
      ...state,
      phase: 'settling',
      pending: null,
      revealAllHands: true,
      settlingSince: now,
      ledger: [...state.ledger, entry],
      endSummary,
    };
    this.setState(nextState, this.makeRevealAllEntries(nextState));
    this.logReplay('ledger', { entry }, null);
    this.logReplay('end', buildGuobiaoEndReplayPublic(endSummary), null);
  }

  private applyWrongHu(state: GuobiaoState, seat: number, now: number, note: string): void {
    const nextState = this.applyWrongHuToState(state, seat, now, note);
    if (allPlayersWrongHu(nextState.players)) {
      this.settleDraw(nextState, now);
      return;
    }
    this.setState(nextState, []);
  }

  private applyWrongHuToState(state: GuobiaoState, seat: number, now: number, note: string): GuobiaoState {
    const players: Record<number, GuobiaoPlayerState> = { ...state.players };
    const transfers: Array<GuobiaoLedgerTransfer> = [];
    for (let toSeat = 0; toSeat < 4; toSeat++) {
      if (toSeat === seat) continue;
      transfers.push({
        fromSeat: seat,
        toSeat,
        ruleScore: WRONG_HU_RULE_SCORE,
        points: WRONG_HU_RULE_SCORE * POINTS_SCALE,
      });
    }
    const pointDelta: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    const ruleDelta: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    applyTransfers(players, transfers, pointDelta, ruleDelta);
    const ps = players[seat];
    if (ps) players[seat] = { ...ps, wrongHu: true };
    const entry: GuobiaoLedgerEntry = {
      kind: 'wrongHu',
      label: '错和',
      seat,
      transfers,
      at: now,
      note,
    };
    const nextState = { ...state, players, ledger: [...state.ledger, entry] };
    this.logReplay('ledger', { entry }, null, nextState);
    return nextState;
  }

  private computeDiscardClaimOptions(state: GuobiaoState, fromSeat: number, tileId: number, tileKey: number): Record<number, GuobiaoClaimOptions> {
    const options = emptyClaimOptions();
    const haiteiDiscard = !hasWallTile(state);
    for (let seat = 0; seat < 4; seat++) {
      if (seat === fromSeat) continue;
      const ps = state.players[seat];
      if (!ps || ps.playerId === null) continue;
      const calc = this.calculateSeatWin(seat, tileKey, {
        isLastTileClaim: state.wallHeadIndex > state.wallTailIndex,
        isEarthlyHand: this.isEarthlyHandClaim(state, fromSeat, seat),
        isHumanHandOne: this.isHumanHandOneClaim(state, fromSeat, seat),
      }, tileId);
      const handCount = this.countHandTilesByKey(seat, tileKey);
      const opt = emptySeatClaimOptions();
      if (!ps.wrongHu && calc.valid) {
        opt.hu = true;
        opt.huKind = calc.qualifyingFanTotal >= BASE_RULE_SCORE ? 'legal' : 'wrongHuRisk';
      }
      if (!haiteiDiscard) {
        opt.peng = handCount >= 2;
        opt.mingGang = handCount >= 3 && hasWallTile(state);
        if (seat === nextSeat(fromSeat) && isGuobiaoNumberTile(tileKey)) {
          opt.chi = this.computeChiOptions(seat, tileKey);
        }
      }
      options[seat] = opt;
    }
    return options;
  }

  private computeRobGangOptions(state: GuobiaoState, fromSeat: number, tileId: number, tileKey: number): Record<number, GuobiaoClaimOptions> {
    const options = emptyClaimOptions();
    for (let seat = 0; seat < 4; seat++) {
      if (seat === fromSeat) continue;
      const ps = state.players[seat];
      if (!ps || ps.playerId === null || ps.wrongHu) continue;
      const calc = this.calculateSeatWin(seat, tileKey, { isRobbingKong: true }, tileId);
      const opt = emptySeatClaimOptions();
      if (calc.valid) {
        opt.hu = true;
        opt.huKind = calc.qualifyingFanTotal >= BASE_RULE_SCORE ? 'legal' : 'wrongHuRisk';
      }
      options[seat] = opt;
    }
    return options;
  }

  private calculateSeatWin(
    seat: number,
    winningTileKey: number | null,
    winContext: GuobiaoWinContext = {},
    winningTileId: number | null = null,
  ): GuobiaoFanResult {
    const tiles: Array<number> = [];
    for (const tileId of this.findHandTileIds(seat)) {
      const key = this.tileKeyById.get(tileId);
      if (key === undefined) continue;
      tiles.push(key);
    }
    if (winningTileKey !== null) tiles.push(winningTileKey);
    const state = this.getState();
    const ps = state?.players[seat] ?? null;
    const flowers = ps?.flowers.length ?? 0;
    const melds = (ps?.melds ?? [])
      .filter((m): m is GuobiaoTileMeld => m.kind !== 'flower')
      .map((meld) => this.toFanMeld(meld));
    const sourceWinContext = winningTileKey === null
      ? winContext
      : { ...winContext, winningTileKey };
    const contextWinningTileKey = sourceWinContext.winningTileKey ?? null;
    const inferredLastTile = contextWinningTileKey !== null
      && this.isLastTileWin(state, seat, contextWinningTileKey, winningTileId, winningTileKey !== null || winContext.isRobbingKong === true);
    return calculateGuobiaoFans({
      tiles,
      melds,
      flowerCount: flowers,
      winContext: {
        ...sourceWinContext,
        isLastTile: sourceWinContext.isLastTile === true || inferredLastTile,
        seatWind: seat,
        roundWind: state?.roundWind ?? 0,
      },
    });
  }

  private toFanMeld(meld: GuobiaoTileMeld): GuobiaoFanMeld {
    const hydrated = meld.kind === 'anGang' ? this.hydrateConcealedGangMeld(meld) : meld;
    return {
      kind: hydrated.kind,
      tileKeys: hydrated.tileKeys,
      concealed: hydrated.concealed,
      fromSeat: hydrated.fromSeat,
    };
  }

  private findExtraTileKey(seat: number): number | null {
    const extraTileId = this.findTileInSlot(`hand.extra@${seat}`);
    if (extraTileId !== null) {
      return this.tileKeyById.get(extraTileId) ?? null;
    }
    return null;
  }

  private isImmediateKongSupplementWin(state: GuobiaoState, seat: number, selfHuTileKey: number | null): boolean {
    const lastDraw = state.lastDraw ?? null;
    if (!lastDraw || lastDraw.seat !== seat || lastDraw.source !== 'kongSupplement') return false;
    if (selfHuTileKey === null) return false;
    return this.tileKeyForLastDraw(lastDraw) === selfHuTileKey;
  }

  private findCurrentSelfDrawForHu(state: GuobiaoState, seat: number): { tileId: number; tileKey: number } | null {
    const lastDraw = state.lastDraw ?? null;
    if (!lastDraw || lastDraw.seat !== seat) return null;
    const info = this.getThing(lastDraw.tileId);
    if (!info || !isHandSlot(info.slotName, seat)) return null;
    const tileKey = this.tileKeyById.get(lastDraw.tileId) ?? null;
    if (tileKey === null) return null;
    return { tileId: lastDraw.tileId, tileKey };
  }

  private isHeavenlyHand(state: GuobiaoState, seat: number): boolean {
    return seat === state.dealer
      && state.turnSeat === seat
      && state.turnStep === 'discard'
      && state.initialEventInterrupted !== true
      && this.totalDiscardCount(state) === 0
      && !this.hasNonFlowerMeld(state);
  }

  private isEarthlyHandClaim(state: GuobiaoState, fromSeat: number, winner: number): boolean {
    return winner !== state.dealer
      && fromSeat === state.dealer
      && state.initialEventInterrupted !== true
      && this.discardCountForSeat(state, fromSeat) === 1
      && this.drawCountForSeat(state, winner) === 0
      && !this.hasNonFlowerMeld(state);
  }

  private isHumanHandOneClaim(state: GuobiaoState, fromSeat: number, winner: number): boolean {
    return winner !== state.dealer
      && fromSeat !== state.dealer
      && fromSeat !== winner
      && state.initialEventInterrupted !== true
      && this.discardCountForSeat(state, fromSeat) === 1
      && this.drawCountForSeat(state, winner) === 0
      && !this.hasNonFlowerMeld(state);
  }

  private isHumanHandTwoSelfDraw(state: GuobiaoState, seat: number, selfHuTileKey: number | null): boolean {
    const lastDraw = state.lastDraw ?? null;
    return seat !== state.dealer
      && state.initialEventInterrupted !== true
      && this.drawCountForSeat(state, seat) === 1
      && lastDraw !== null
      && lastDraw.seat === seat
      && lastDraw.source === 'wall'
      && selfHuTileKey !== null
      && this.tileKeyForLastDraw(lastDraw) === selfHuTileKey
      && !this.hasNonFlowerMeld(state);
  }

  private tileKeyForLastDraw(lastDraw: GuobiaoLastDraw | null | undefined): number | null {
    if (!lastDraw) return null;
    return this.tileKeyById.get(lastDraw.tileId) ?? null;
  }

  private isLastTileWin(
    state: GuobiaoState | null,
    winner: number,
    winningTileKey: number,
    winningTileId: number | null,
    isExternalWinningTile: boolean,
  ): boolean {
    if (!state || isGuobiaoFlower(winningTileKey)) return false;
    let count = 0;
    for (const [rawId, rawKey] of this.game.entries('tileFacePublic')) {
      const tileId = Math.trunc(Number(rawId));
      if (winningTileId !== null && tileId === winningTileId) continue;
      const tileKey = Math.trunc(Number(rawKey));
      if (tileKey === winningTileKey) count += 1;
    }
    for (const tileId of this.findHandTileIds(winner)) {
      if (winningTileId !== null && isExternalWinningTile && tileId === winningTileId) continue;
      if ((this.tileKeyById.get(tileId) ?? null) === winningTileKey) count += 1;
    }
    if (isExternalWinningTile) count += 1;
    return count >= 4;
  }

  private lastFlowerSupplementDraw(
    out: { replacementDraws: Array<{ tileId: number; tileKey: number }> },
    seat: number,
  ): GuobiaoLastDraw | null {
    const last = out.replacementDraws[out.replacementDraws.length - 1] ?? null;
    return last ? { seat, tileId: last.tileId, source: 'flowerSupplement' } : null;
  }

  private lastKongSupplementDraw(
    draw: { ok: true; tileId: number },
    seat: number,
  ): GuobiaoLastDraw | null {
    const tileKey = this.tileKeyById.get(draw.tileId) ?? null;
    return tileKey === null ? null : { seat, tileId: draw.tileId, source: 'kongSupplement' };
  }

  private initialAutoBuhuaBySeat(): Record<number, boolean> {
    const match: any = this.game.get('match', 0);
    const raw = match?.guobiaoConfig?.autoBuhuaBySeat ?? match?.gbConfig?.autoBuhuaBySeat ?? null;
    const unknownDefault = String(match?.roomType ?? '') === 'friend' ? false : true;
    const out = emptySeatBoolean(unknownDefault);
    if (raw && typeof raw === 'object') {
      for (let seat = 0; seat < 4; seat++) {
        if (typeof raw[seat] === 'boolean') out[seat] = raw[seat];
        else if (typeof raw[String(seat)] === 'boolean') out[seat] = raw[String(seat)];
      }
    }
    return out;
  }

  private autoBuhuaBySeat(state: GuobiaoState): Record<number, boolean> {
    return { ...emptySeatBoolean(true), ...(state.autoBuhuaBySeat ?? {}) };
  }

  private isAutoBuhuaEnabled(state: GuobiaoState, seat: number): boolean {
    return this.autoBuhuaBySeat(state)[seat] !== false;
  }

  private isKongSupplementFlowerPending(state: GuobiaoState, seat: number): boolean {
    const lastDraw = state.lastDraw ?? null;
    const tileKey = this.tileKeyForLastDraw(lastDraw);
    return lastDraw?.seat === seat && lastDraw.source === 'kongSupplement' && tileKey !== null && isGuobiaoFlower(tileKey);
  }

  private canAutoBuhua(state: GuobiaoState, seat: number): boolean {
    return this.isAutoBuhuaEnabled(state, seat)
      && !this.isKongSupplementFlowerPending(state, seat);
  }

  private buhuaOneInThingMap(
    state: GuobiaoState,
    things: Map<number, ThingInfo>,
    seat: number,
    flower: GuobiaoBuhuaCandidate,
  ): { ok: true; state: GuobiaoState; publicFaces: Array<[number, number]>; replacementDraw: { tileId: number; tileKey: number } | null } | { ok: false; error: string } {
    if (!hasWallTile(state)) return { ok: false, error: 'wall exhausted' };
    const ps = state.players[seat];
    if (!ps) return { ok: false, error: 'no player' };
    const flowerIndex = ps.melds.filter((m) => m.kind === 'flower').length;
    if (flowerIndex >= 8) return { ok: false, error: 'flower slots full' };

    const row = Math.floor(flowerIndex / 4);
    const col = flowerIndex % 4;
    things.set(flower.tileId, {
      ...flower.info,
      slotName: `flower.store.${flowerIndex}@${seat}`,
      rotationIndex: 0,
      claimedBy: null,
      shiftSlotName: null,
    });

    let nextState: GuobiaoState = {
      ...state,
      players: {
        ...state.players,
        [seat]: {
          ...ps,
          flowers: [...ps.flowers, flower.tileKey],
          melds: [...ps.melds, { kind: 'flower', tileKey: flower.tileKey, tileId: flower.tileId, row, col }],
        },
      },
    };

    const replacementId = nextState.wallOrder[nextState.wallTailIndex]!;
    const replacement = things.get(replacementId);
    if (!replacement) return { ok: false, error: 'supplement tile not found' };
    const replacementKey = this.tileKeyById.get(replacementId) ?? null;
    things.set(replacementId, {
      ...replacement,
      slotName: flower.info.slotName,
      rotationIndex: 0,
      claimedBy: null,
      shiftSlotName: null,
    });
    nextState = { ...nextState, wallTailIndex: nextState.wallTailIndex - 1 };

    return {
      ok: true,
      state: nextState,
      publicFaces: [[flower.tileId, flower.tileKey]],
      replacementDraw: replacementKey === null ? null : { tileId: replacementId, tileKey: replacementKey },
    };
  }

  private autoBuhuaInThingMap(
    state: GuobiaoState,
    things: Map<number, ThingInfo>,
    seat: number,
  ): { state: GuobiaoState; publicFaces: Array<[number, number]>; replacementDraws: Array<{ tileId: number; tileKey: number }> } {
    let nextState = state;
    const publicFaces: Array<[number, number]> = [];
    const replacementDraws: Array<{ tileId: number; tileKey: number }> = [];
    if (!this.canAutoBuhua(nextState, seat)) return { state: nextState, publicFaces, replacementDraws };
    const guardLimit = 16;
    for (let guard = 0; guard < guardLimit; guard++) {
      if (!hasWallTile(nextState)) break;
      const flower = findFirstHandFlower(things, this.tileKeyById, seat);
      if (!flower) break;
      const out = this.buhuaOneInThingMap(nextState, things, seat, flower);
      if (!out.ok) break;
      publicFaces.push(...out.publicFaces);
      if (out.replacementDraw) replacementDraws.push(out.replacementDraw);
      nextState = out.state;
    }
    return { state: nextState, publicFaces, replacementDraws };
  }

  private migrateLegacyFlowerSlots(state: GuobiaoState): void {
    const things = this.currentThingMap();
    const plan = new Map<number, ThingInfo>();
    const targetToTile = new Map<string, number>();
    const slotToTile = new Map<string, number>();

    for (const [tileId, info] of things.entries()) {
      slotToTile.set(info.slotName, tileId);
    }

    for (let seat = 0; seat < 4; seat++) {
      const ps = state.players[seat];
      if (!ps) continue;
      const flowers = ps.melds.filter((m): m is GuobiaoFlowerMeld => m.kind === 'flower').slice(0, 8);
      for (let i = 0; i < flowers.length; i++) {
        const meld = flowers[i]!;
        const info = things.get(meld.tileId);
        if (!info) continue;
        const targetSlot = `flower.store.${i}@${seat}`;
        if (info.slotName === targetSlot) continue;
        if (!info.slotName.startsWith('meld.')) continue;
        if (targetToTile.has(targetSlot)) {
          console.warn(`[${this.game.gameId}] skip legacy guobiao flower migration: duplicate target ${targetSlot}`);
          continue;
        }
        const occupant = slotToTile.get(targetSlot);
        if (occupant !== undefined && occupant !== meld.tileId && !plan.has(occupant)) {
          console.warn(`[${this.game.gameId}] skip legacy guobiao flower migration: target occupied ${targetSlot}`);
          continue;
        }
        targetToTile.set(targetSlot, meld.tileId);
        plan.set(meld.tileId, {
          ...info,
          slotName: targetSlot,
          rotationIndex: 0,
          claimedBy: null,
          shiftSlotName: null,
        });
      }
    }

    if (plan.size <= 0) return;
    const entries: Array<Entry> = [];
    for (const [tileId, info] of plan.entries()) entries.push(['things', tileId, info]);
    this.game.systemUpdate(entries);
    console.warn(`[${this.game.gameId}] migrated legacy guobiao flower slots: ${entries.length}`);
  }

  private applyChi(state: GuobiaoState, pending: GuobiaoPendingClaim, seat: number, optionId: string, now: number): boolean {
    if (pending.kind !== 'discardClaim' || seat !== nextSeat(pending.fromSeat)) return false;
    const ps = state.players[seat];
    if (!ps) return false;
    const option = this.getPendingClaimOptions(state, pending)[seat]?.chi.find((x) => x.optionId === optionId) ?? null;
    if (!option) return false;
    const row = this.pickMeldRow(ps);
    if (row === null) return false;

    const things = this.currentThingMap();
    const calledInfo = things.get(pending.tileId);
    if (!calledInfo) return false;
    const targetSlots = [`meld.${row}.0@${seat}`, `meld.${row}.1@${seat}`, `meld.${row}.2@${seat}`];
    const calledIndex = option.sequence.findIndex((key) => key === pending.tileKey);
    if (calledIndex < 0) return false;
    const handTiles = [...option.tileIds];
    let handCursor = 0;
    const tileIds: Array<number> = [];
    for (let i = 0; i < 3; i++) {
      if (i === calledIndex) {
        tileIds.push(pending.tileId);
        things.set(pending.tileId, { ...calledInfo, slotName: targetSlots[i]!, rotationIndex: 1, claimedBy: null, shiftSlotName: null });
      } else {
        const id = handTiles[handCursor++]!;
        const info = things.get(id);
        if (!info || !isHandSlot(info.slotName, seat)) return false;
        tileIds.push(id);
        things.set(id, { ...info, slotName: targetSlots[i]!, rotationIndex: 0, claimedBy: null, shiftSlotName: null });
      }
    }

    const meld: GuobiaoTileMeld = {
      id: state.nextId,
      kind: 'chi',
      tileKeys: [...option.sequence],
      tileIds,
      fromSeat: pending.fromSeat,
      claimedTileId: pending.tileId,
      claimedTileKey: pending.tileKey,
      row,
    };
    const nextState: GuobiaoState = {
      ...state,
      pending: null,
      nextId: state.nextId + 1,
      lastDraw: null,
      initialEventInterrupted: true,
      players: { ...state.players, [seat]: { ...ps, melds: [...ps.melds, meld] } },
      turnSeat: seat,
      turnStep: 'discard',
      turnSince: now,
      turnDeadline: this.discardDeadline(now),
    };
    const entries = thingMapEntries(things);
    for (let i = 0; i < tileIds.length; i++) entries.push(['tileFacePublic', tileIds[i]!, option.sequence[i]!]);
    this.setState(nextState, entries);
    this.logReplay('chi', { seat, fromSeat: pending.fromSeat, tile: guobiaoTileCode(pending.tileKey) }, null);
    return true;
  }

  private applyPeng(state: GuobiaoState, pending: GuobiaoPendingClaim, seat: number, now: number): boolean {
    if (pending.kind !== 'discardClaim') return false;
    const ps = state.players[seat];
    if (!ps) return false;
    const takeFromHand = this.findHandTilesByKey(seat, pending.tileKey).slice(0, 2);
    if (takeFromHand.length < 2) return false;
    const row = this.pickMeldRow(ps);
    if (row === null) return false;

    const things = this.currentThingMap();
    const calledInfo = things.get(pending.tileId);
    const a = things.get(takeFromHand[0]!);
    const b = things.get(takeFromHand[1]!);
    if (!calledInfo || !a || !b) return false;

    const targetSlots = [`meld.${row}.0@${seat}`, `meld.${row}.1@${seat}`, `meld.${row}.2@${seat}`];
    const relFrom = ((pending.fromSeat - seat) % 4 + 4) % 4;
    const calledSlot = relFrom === 3 ? targetSlots[2]! : relFrom === 2 ? targetSlots[1]! : targetSlots[0]!;
    const otherSlots = targetSlots.filter((slot) => slot !== calledSlot);
    things.set(pending.tileId, { ...calledInfo, slotName: calledSlot, rotationIndex: 1, claimedBy: null, shiftSlotName: null });
    things.set(takeFromHand[0]!, { ...a, slotName: otherSlots[0]!, rotationIndex: 0, claimedBy: null, shiftSlotName: null });
    things.set(takeFromHand[1]!, { ...b, slotName: otherSlots[1]!, rotationIndex: 0, claimedBy: null, shiftSlotName: null });

    const tileIds = [pending.tileId, ...takeFromHand];
    const meld: GuobiaoTileMeld = {
      id: state.nextId,
      kind: 'peng',
      tileKeys: [pending.tileKey, pending.tileKey, pending.tileKey],
      tileIds,
      fromSeat: pending.fromSeat,
      claimedTileId: pending.tileId,
      claimedTileKey: pending.tileKey,
      row,
    };
    const nextState: GuobiaoState = {
      ...state,
      pending: null,
      nextId: state.nextId + 1,
      lastDraw: null,
      initialEventInterrupted: true,
      players: { ...state.players, [seat]: { ...ps, melds: [...ps.melds, meld] } },
      turnSeat: seat,
      turnStep: 'discard',
      turnSince: now,
      turnDeadline: this.discardDeadline(now),
    };
    const entries = thingMapEntries(things);
    for (const id of tileIds) entries.push(['tileFacePublic', id, pending.tileKey]);
    this.setState(nextState, entries);
    this.logReplay('peng', { seat, fromSeat: pending.fromSeat, tile: guobiaoTileCode(pending.tileKey) }, null);
    return true;
  }

  private applyMingGang(state: GuobiaoState, pending: GuobiaoPendingClaim, seat: number, now: number): boolean {
    if (pending.kind !== 'discardClaim' || !hasWallTile(state)) return false;
    const ps = state.players[seat];
    if (!ps) return false;
    const takeFromHand = this.findHandTilesByKey(seat, pending.tileKey).slice(0, 3);
    if (takeFromHand.length < 3) return false;
    const row = this.pickMeldRow(ps);
    if (row === null) return false;

    const things = this.currentThingMap();
    const calledInfo = things.get(pending.tileId);
    if (!calledInfo) return false;
    const targetSlots = [`meld.${row}.0@${seat}`, `meld.${row}.1@${seat}`, `meld.${row}.2@${seat}`, `meld.${row}.3@${seat}`];
    const relFrom = ((pending.fromSeat - seat) % 4 + 4) % 4;
    const calledSlot = relFrom === 3 ? targetSlots[2]! : relFrom === 2 ? targetSlots[1]! : targetSlots[0]!;
    const otherSlots = targetSlots.filter((slot) => slot !== calledSlot);
    things.set(pending.tileId, { ...calledInfo, slotName: calledSlot, rotationIndex: 1, claimedBy: null, shiftSlotName: null });
    for (let i = 0; i < 3; i++) {
      const id = takeFromHand[i]!;
      const info = things.get(id);
      if (!info) return false;
      things.set(id, { ...info, slotName: otherSlots[i]!, rotationIndex: 0, claimedBy: null, shiftSlotName: null });
    }

    let nextState: GuobiaoState = {
      ...state,
      pending: null,
      nextId: state.nextId + 1,
      initialEventInterrupted: true,
      players: {
        ...state.players,
        [seat]: {
          ...ps,
          melds: [
            ...ps.melds,
            {
              id: state.nextId,
              kind: 'mingGang',
              tileKeys: [pending.tileKey, pending.tileKey, pending.tileKey, pending.tileKey],
              tileIds: [pending.tileId, ...takeFromHand],
              fromSeat: pending.fromSeat,
              claimedTileId: pending.tileId,
              claimedTileKey: pending.tileKey,
              row,
            },
          ],
        },
      },
    };
    const draw = this.drawSupplementInThingMap(nextState, things, seat);
    if (!draw.ok) return false;
    nextState = {
      ...draw.state,
      lastDraw: this.lastKongSupplementDraw(draw, seat),
      turnSeat: seat,
      turnStep: 'discard',
      turnSince: now,
      turnDeadline: this.discardDeadline(now),
    };

    const tileIds = [pending.tileId, ...takeFromHand];
    const entries = thingMapEntries(things);
    for (const id of tileIds) entries.push(['tileFacePublic', id, pending.tileKey]);
    this.setState(nextState, entries);
    const pid = nextState.players[seat]?.playerId ?? null;
    if (pid) this.sendTileFaceSelfFull(seat, pid);
    this.logReplay('mingGang', { seat, fromSeat: pending.fromSeat, tile: guobiaoTileCode(pending.tileKey) }, null);
    this.logReplayDraw(seat, this.lastKongSupplementDraw(draw, seat));
    return true;
  }

  private finalizeAddGang(
    state: GuobiaoState,
    pending: GuobiaoPendingClaim,
    now: number,
  ): { ok: true } | { ok: false; error: string } {
    const seat = pending.fromSeat;
    const ps = state.players[seat];
    if (!ps) return { ok: false, error: 'no player' };
    if (!hasWallTile(state)) return { ok: false, error: 'cannot gang at haitei' };
    const peng = ps.melds.find((m) => m.kind === 'peng' && m.claimedTileKey === pending.tileKey) as GuobiaoTileMeld | undefined;
    if (!peng) return { ok: false, error: 'no peng meld' };
    const info = this.getThing(pending.tileId);
    if (!info || !isHandSlot(info.slotName, seat)) return { ok: false, error: 'tile not in hand' };

    const things = this.currentThingMap();
    const liveInfo = things.get(pending.tileId);
    if (!liveInfo) return { ok: false, error: 'tile not found' };
    things.set(pending.tileId, { ...liveInfo, slotName: `meld.${peng.row}.3@${seat}`, rotationIndex: 2, claimedBy: null, shiftSlotName: null });
    this.moveExtraToHandInThingMap(things, seat, new Set([pending.tileId]));

    const updatedMeld: GuobiaoTileMeld = {
      ...peng,
      kind: 'addGang',
      tileKeys: [...peng.tileKeys, pending.tileKey],
      tileIds: [...peng.tileIds, pending.tileId],
    };
    let nextState: GuobiaoState = {
      ...state,
      pending: null,
      initialEventInterrupted: true,
      players: {
        ...state.players,
        [seat]: {
          ...ps,
          melds: ps.melds.map((m) => (m === peng ? updatedMeld : m)),
        },
      },
    };
    const draw = this.drawSupplementInThingMap(nextState, things, seat);
    if (!draw.ok) return { ok: false, error: draw.error };
    nextState = {
      ...draw.state,
      lastDraw: this.lastKongSupplementDraw(draw, seat),
      turnSeat: seat,
      turnStep: 'discard',
      turnSince: now,
      turnDeadline: this.discardDeadline(now),
    };

    const entries = thingMapEntries(things);
    entries.push(['tileFacePublic', pending.tileId, pending.tileKey]);
    this.setState(nextState, entries);
    const pid = nextState.players[seat]?.playerId ?? null;
    if (pid) this.sendTileFaceSelfFull(seat, pid);
    this.logReplay('addGang', { seat, tile: guobiaoTileCode(pending.tileKey), pending: false }, null);
    this.logReplayDraw(seat, this.lastKongSupplementDraw(draw, seat));
    return { ok: true };
  }

  private syncPlayers(state: GuobiaoState): boolean {
    const seatToPlayer = this.getSeatToPlayer();
    let changed = false;
    const players: Record<number, GuobiaoPlayerState> = { ...state.players };
    for (let seat = 0; seat < 4; seat++) {
      const pid = seatToPlayer[seat] ?? null;
      const cur = players[seat];
      if (!cur) continue;
      if (cur.playerId !== pid) {
        players[seat] = { ...cur, playerId: pid };
        changed = true;
      }
    }
    if (changed) {
      this.setState({ ...state, players }, []);
      return true;
    }
    return false;
  }

  private getPendingClaimOptions(state: GuobiaoState, pending: GuobiaoPendingClaim | null): Record<number, GuobiaoClaimOptions> {
    if (!pending) return emptyClaimOptions();
    if ([0, 1, 2, 3].some((seat) => hasAnyClaimOption(pending.options?.[seat]))) {
      return pending.options;
    }
    if (pending.kind === 'robGangHu') {
      return this.computeRobGangOptions(state, pending.fromSeat, pending.tileId, pending.tileKey);
    }
    return this.computeDiscardClaimOptions(state, pending.fromSeat, pending.tileId, pending.tileKey);
  }

  private pendingResponseSeats(state: GuobiaoState, pending: GuobiaoPendingClaim): Array<number> {
    const options = this.getPendingClaimOptions(state, pending);
    return [0, 1, 2, 3].filter((seat) => hasAnyClaimOption(options[seat]));
  }

  private fullPendingResponses(pending: GuobiaoPendingClaim): Record<number, GuobiaoPendingResponse | null> {
    const publicResponses = clonePendingResponses(pending.responses ?? emptyPendingResponses());
    const stored = this.pendingResponsesById.get(pending.id) ?? null;
    if (!stored) return publicResponses;
    const out = clonePendingResponses(stored);
    for (const seat of [0, 1, 2, 3]) {
      if (out[seat] === null && publicResponses[seat] !== null) {
        out[seat] = publicResponses[seat];
      }
    }
    return out;
  }

  private withFullPendingResponses(state: GuobiaoState): GuobiaoState {
    if (!state.pending) return state;
    return {
      ...state,
      pending: {
        ...state.pending,
        responses: this.fullPendingResponses(state.pending),
      },
    };
  }

  private rememberPendingResponses(state: GuobiaoState): void {
    this.pendingResponsesById.clear();
    if (!state.pending) return;
    this.pendingResponsesById.set(state.pending.id, clonePendingResponses(state.pending.responses));
  }

  private sanitizeStateForSeat(state: GuobiaoState, viewerSeat: number | null): GuobiaoState {
    const out = JSON.parse(JSON.stringify(state)) as GuobiaoState;
    if (out.lastDraw) {
      out.lastDraw = {
        seat: out.lastDraw.seat,
        tileId: out.lastDraw.tileId,
        source: out.lastDraw.source,
      };
    }

    const revealAll = out.revealAllHands === true || out.phase === 'settling' || out.phase === 'done';
    for (let seat = 0; seat < 4; seat++) {
      const player = out.players?.[seat] ?? (out.players as any)?.[String(seat)] ?? null;
      if (!player || !Array.isArray(player.melds)) continue;
      player.melds = player.melds.map((meld: GuobiaoMeld) => {
        if (!meld || meld.kind !== 'anGang') return meld;
        if (revealAll || viewerSeat === seat) return this.hydrateConcealedGangMeld(meld);
        return { ...meld, tileKeys: [], claimedTileKey: null };
      });
    }

    if (out.pending) {
      const sanitizedOptions = emptyClaimOptions();
      const sanitizedResponses = emptyPendingResponses();
      if (viewerSeat !== null && viewerSeat !== out.pending.fromSeat) {
        const fullOptions = this.getPendingClaimOptions(state, state.pending);
        sanitizedOptions[viewerSeat] = cloneClaimOptions(fullOptions[viewerSeat] ?? emptySeatClaimOptions());
        sanitizedResponses[viewerSeat] = clonePendingResponse(state.pending?.responses?.[viewerSeat] ?? null);
      }
      out.pending = { ...out.pending, options: sanitizedOptions, responses: sanitizedResponses };
    }

    return out;
  }

  private stateNeedsPublicSanitization(state: GuobiaoState): boolean {
    if (state.lastDraw && state.lastDraw.tileKey !== undefined) return true;
    if (state.pending && [0, 1, 2, 3].some((seat) => hasAnyClaimOption(state.pending?.options?.[seat]))) return true;
    if (state.pending && [0, 1, 2, 3].some((seat) => state.pending?.responses?.[seat] !== null)) return true;
    const revealAll = state.revealAllHands === true || state.phase === 'settling' || state.phase === 'done';
    if (revealAll) return false;
    for (let seat = 0; seat < 4; seat++) {
      const player = state.players?.[seat] ?? null;
      if (!player) continue;
      if (player.melds.some((meld) => meld.kind === 'anGang' && Array.isArray(meld.tileKeys) && meld.tileKeys.length > 0)) {
        return true;
      }
    }
    return false;
  }

  private hydrateConcealedGangMeld(meld: GuobiaoTileMeld): GuobiaoTileMeld {
    if (meld.kind !== 'anGang') return meld;
    const tileIds = Array.isArray(meld.tileIds) ? meld.tileIds : [];
    const tileKeys: Array<number> = [];
    for (const rawId of tileIds) {
      const tileId = Math.trunc(Number(rawId));
      const tileKey = Number.isFinite(tileId) ? (this.tileKeyById.get(tileId) ?? null) : null;
      if (tileKey === null) return meld;
      tileKeys.push(tileKey);
    }
    return tileKeys.length === tileIds.length && tileKeys.length > 0 ? { ...meld, tileKeys } : meld;
  }

  private sendPrivateStateForSeats(state: GuobiaoState): void {
    for (let seat = 0; seat < 4; seat++) {
      const playerId = state.players?.[seat]?.playerId ?? null;
      if (!playerId) continue;
      this.sendPrivateStateForSeat(state, seat, playerId);
    }
  }

  private sendPrivateStateForSeat(state: GuobiaoState, seat: number, playerId: string): void {
    this.game.sendToPlayer(playerId, {
      type: 'UPDATE',
      entries: [['gb', 0, this.sanitizeStateForSeat(state, seat)]],
      full: false,
    } as Message);
  }

  private setState(state: GuobiaoState, extraEntries: Array<Entry>): void {
    this.rememberPendingResponses(state);
    const entries = extraEntries.filter(([kind, key]) => !(kind === 'gb' && key === 0));
    this.game.systemUpdate([...entries, ['gb', 0, this.sanitizeStateForSeat(state, null)]]);
    this.sendPrivateStateForSeats(state);
  }

  private getState(): GuobiaoState | null {
    const state = (this.game.get('gb', 0) as GuobiaoState | null) ?? null;
    return state ? this.withFullPendingResponses(state) : null;
  }

  private getSeatToPlayer(): Record<number, string | null> {
    const out: Record<number, string | null> = { 0: null, 1: null, 2: null, 3: null };
    for (const [playerId, raw] of this.game.entries('seats')) {
      const seat = parseSeat(raw);
      if (seat === null || seat < 0 || seat > 3) continue;
      out[seat] = String(playerId);
    }
    return out;
  }

  private getSeatStartPoints(): Record<number, number> {
    const out: Record<number, number> = {
      0: DEFAULT_START_POINTS,
      1: DEFAULT_START_POINTS,
      2: DEFAULT_START_POINTS,
      3: DEFAULT_START_POINTS,
    };
    for (const [, raw] of this.game.entries('seats')) {
      const seat = parseSeat(raw);
      if (seat === null || seat < 0 || seat > 3) continue;
      const value = Number((raw as SeatInfo)?.startBeans ?? DEFAULT_START_POINTS);
      out[seat] = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : DEFAULT_START_POINTS;
    }
    return out;
  }

  private getThing(tileId: number): ThingInfo | null {
    const raw = this.game.get('things', tileId);
    if (!raw || typeof (raw as any).slotName !== 'string') return null;
    return raw as ThingInfo;
  }

  private currentThingMap(): Map<number, ThingInfo> {
    const out = new Map<number, ThingInfo>();
    for (const [rawId, raw] of this.game.entries('things')) {
      const tileId = Math.trunc(Number(rawId));
      if (!Number.isFinite(tileId)) continue;
      if (!raw || typeof (raw as any).slotName !== 'string') continue;
      out.set(tileId, raw as ThingInfo);
    }
    return out;
  }

  private countDiscardedTiles(seat?: number): number {
    let count = 0;
    for (const [, raw] of this.game.entries('things')) {
      const slotName = String((raw as ThingInfo)?.slotName ?? '');
      if (!slotName.startsWith('discard.')) continue;
      if (seat !== undefined && !slotName.endsWith(`@${seat}`)) continue;
      count += 1;
    }
    return count;
  }

  private drawCountForSeat(state: GuobiaoState, seat: number): number {
    return state.drawCountBySeat?.[seat] ?? 0;
  }

  private discardCountForSeat(state: GuobiaoState, seat: number): number {
    return state.discardCountBySeat?.[seat] ?? this.countDiscardedTiles(seat);
  }

  private totalDiscardCount(state: GuobiaoState): number {
    if (state.discardCountBySeat) {
      return [0, 1, 2, 3].reduce((sum, seat) => sum + (state.discardCountBySeat?.[seat] ?? 0), 0);
    }
    return this.countDiscardedTiles();
  }

  private hasNonFlowerMeld(state: GuobiaoState | null = this.getState()): boolean {
    if (!state) return false;
    for (let seat = 0; seat < 4; seat++) {
      const melds = state.players[seat]?.melds ?? [];
      if (melds.some((meld) => meld.kind !== 'flower')) return true;
    }
    return false;
  }

  private findHandTileIds(seat: number): Array<number> {
    const out: Array<number> = [];
    for (const [rawId, raw] of this.game.entries('things')) {
      const tileId = Math.trunc(Number(rawId));
      const info = raw as ThingInfo;
      if (!Number.isFinite(tileId) || !info?.slotName) continue;
      if (isHandSlot(info.slotName, seat)) out.push(tileId);
    }
    out.sort((a, b) => a - b);
    return out;
  }

  private findHandTilesByKey(seat: number, tileKey: number): Array<number> {
    const out: Array<number> = [];
    for (const tileId of this.findHandTileIds(seat)) {
      if ((this.tileKeyById.get(tileId) ?? null) === tileKey) out.push(tileId);
    }
    out.sort((a, b) => {
      const aExtra = this.getThing(a)?.slotName.startsWith('hand.extra') ? 1 : 0;
      const bExtra = this.getThing(b)?.slotName.startsWith('hand.extra') ? 1 : 0;
      return bExtra - aExtra || a - b;
    });
    return out;
  }

  private findPreferredHandTileByKey(seat: number, tileKey: number): number | null {
    return this.findHandTilesByKey(seat, tileKey)[0] ?? null;
  }

  private countHandTilesByKey(seat: number, tileKey: number): number {
    return this.findHandTilesByKey(seat, tileKey).length;
  }

  private computeChiOptions(seat: number, tileKey: number): Array<GuobiaoChiOption> {
    if (!isGuobiaoNumberTile(tileKey)) return [];
    const suitBase = Math.floor(tileKey / 9) * 9;
    const rank = (tileKey % 9) + 1;
    const options: Array<GuobiaoChiOption> = [];
    for (const startRank of [rank - 2, rank - 1, rank]) {
      if (startRank < 1 || startRank > 7) continue;
      const sequence = [suitBase + startRank - 1, suitBase + startRank, suitBase + startRank + 1];
      if (!sequence.includes(tileKey)) continue;
      const need = sequence.filter((key) => key !== tileKey);
      const tileIds: Array<number> = [];
      let ok = true;
      for (const key of need) {
        const id = this.findHandTilesByKey(seat, key).find((candidate) => !tileIds.includes(candidate)) ?? null;
        if (id === null) {
          ok = false;
          break;
        }
        tileIds.push(id);
      }
      if (!ok || tileIds.length !== 2) continue;
      options.push({
        optionId: `chi:${sequence.join('-')}`,
        tileIds,
        tileKeys: need,
        sequence,
      });
    }
    return options;
  }

  private findTileInSlot(slotName: string): number | null {
    for (const [rawId, raw] of this.game.entries('things')) {
      const id = Math.trunc(Number(rawId));
      if (!Number.isFinite(id)) continue;
      if ((raw as ThingInfo)?.slotName === slotName) return id;
    }
    return null;
  }

  private pickDrawSlot(seat: number): string | null {
    if (this.findTileInSlot(`hand.extra@${seat}`) === null) return `hand.extra@${seat}`;
    const used = new Set<string>();
    for (const [, raw] of this.game.entries('things')) used.add((raw as ThingInfo)?.slotName);
    for (let i = 0; i < 14; i++) {
      const slot = `hand.${i}@${seat}`;
      if (!used.has(slot)) return slot;
    }
    return null;
  }

  private findEmptyHandSlotInThingMap(things: Map<number, ThingInfo>, seat: number): string | null {
    const used = new Set<string>();
    for (const info of things.values()) used.add(info.slotName);
    for (let i = 0; i < 14; i++) {
      const slot = `hand.${i}@${seat}`;
      if (!used.has(slot)) return slot;
    }
    return null;
  }

  private moveExtraToHandInThingMap(things: Map<number, ThingInfo>, seat: number, movingTileIds: Set<number>): void {
    const extraTileId = this.findTileInSlotInThingMap(things, `hand.extra@${seat}`);
    if (extraTileId === null || movingTileIds.has(extraTileId)) return;
    const target = this.findEmptyHandSlotInThingMap(things, seat);
    if (!target) return;
    const info = things.get(extraTileId);
    if (!info) return;
    things.set(extraTileId, { ...info, slotName: target, rotationIndex: 0, claimedBy: null, shiftSlotName: null });
  }

  private drawSupplementInThingMap(
    state: GuobiaoState,
    things: Map<number, ThingInfo>,
    seat: number,
  ): { ok: true; state: GuobiaoState; tileId: number } | { ok: false; error: string } {
    if (!hasWallTile(state)) return { ok: false, error: 'wall exhausted' };
    const tileId = state.wallOrder[state.wallTailIndex]!;
    const info = things.get(tileId);
    if (!info) return { ok: false, error: 'supplement tile not found' };
    const target = this.findTileInSlotInThingMap(things, `hand.extra@${seat}`) === null
      ? `hand.extra@${seat}`
      : this.findEmptyHandSlotInThingMap(things, seat);
    if (!target) return { ok: false, error: 'no hand slot' };
    things.set(tileId, { ...info, slotName: target, rotationIndex: 0, claimedBy: null, shiftSlotName: null });
    return { ok: true, state: { ...state, wallTailIndex: state.wallTailIndex - 1 }, tileId };
  }

  private findTileInSlotInThingMap(things: Map<number, ThingInfo>, slotName: string): number | null {
    for (const [id, info] of things.entries()) {
      if (info.slotName === slotName) return id;
    }
    return null;
  }

  private pickMeldRow(ps: GuobiaoPlayerState): number | null {
    const used = new Set<number>();
    for (const meld of ps.melds) {
      if (meld.kind !== 'flower') used.add(meld.row);
    }
    for (let row = 0; row < 4; row++) {
      if (!used.has(row)) return row;
    }
    return null;
  }

  private pickNextDiscardSlot(seat: number): string | null {
    const used = new Set<string>();
    for (const [, raw] of this.game.entries('things')) used.add((raw as ThingInfo)?.slotName);
    for (const name of discardSlots(seat)) {
      if (!used.has(name)) return name;
    }
    return null;
  }

  private makeInitialDealThings(): Map<number, ThingInfo> {
    const out = new Map<number, ThingInfo>();
    const allTileIds = Array.from({ length: GUOBIAO_DECK_SIZE }, (_, i) => i);
    shuffleInPlace(allTileIds);
    let idx = 0;
    const take = (): number => allTileIds[idx++]!;
    for (let seat = 0; seat < 4; seat++) {
      for (let i = 0; i < 13; i++) out.set(take(), emptyThing(`hand.${i}@${seat}`));
    }
    out.set(take(), emptyThing('hand.extra@0'));
    const walls = [wallSlots(0), wallSlots(1), wallSlots(2), wallSlots(3)].flat();
    let wallIdx = 0;
    while (idx < allTileIds.length && wallIdx < walls.length) {
      out.set(take(), emptyThing(walls[wallIdx++]!));
    }
    return out;
  }

  private makeRevealAllEntries(state: GuobiaoState | null = null): Array<Entry> {
    const entries: Array<Entry> = [];
    for (const [tileId, tileKey] of this.tileKeyById.entries()) {
      entries.push(['tileFacePublic', tileId, tileKey]);
    }
    if (state) entries.push(...this.makeConcealedGangRevealEntries(state));
    return entries;
  }

  private makeConcealedGangRevealEntries(state: GuobiaoState): Array<Entry> {
    const entries: Array<Entry> = [];
    for (let seat = 0; seat < 4; seat++) {
      const ps = state.players?.[seat] ?? null;
      if (!ps) continue;
      for (const meld of ps.melds ?? []) {
        if (meld.kind === 'flower') continue;
        if (meld.kind !== 'anGang' && meld.concealed !== true) continue;
        for (const rawId of meld.tileIds ?? []) {
          const tileId = Math.trunc(Number(rawId));
          if (!Number.isFinite(tileId)) continue;
          const info = this.getThing(tileId);
          if (!info || !String(info.slotName).startsWith('meld.')) continue;
          entries.push(['things', tileId, { ...info, rotationIndex: 0, claimedBy: null, shiftSlotName: null }]);
        }
      }
    }
    return entries;
  }

  private sendTileFaceSelfFull(seat: number, playerId: string): void {
    const entries: Array<Entry> = [];
    for (const tileId of this.findPrivateTileFaceIdsForSeat(seat)) {
      const key = this.tileKeyById.get(tileId) ?? null;
      if (key === null) continue;
      entries.push(['tileFaceSelf', tileId, key]);
    }
    if (entries.length > 0) {
      this.game.sendToPlayer(playerId, { type: 'UPDATE', entries, full: false } as Message);
    }
  }

  private findPrivateTileFaceIdsForSeat(seat: number): Array<number> {
    const out = new Set<number>(this.findHandTileIds(seat));
    const ps = this.getState()?.players?.[seat] ?? null;
    for (const meld of ps?.melds ?? []) {
      if (meld.kind === 'flower') continue;
      if (meld.kind !== 'anGang' && meld.concealed !== true) continue;
      for (const tileId of meld.tileIds ?? []) {
        const id = Math.trunc(Number(tileId));
        if (Number.isFinite(id)) out.add(id);
      }
    }
    return Array.from(out).sort((a, b) => a - b);
  }

  private buildHandsReplayPrivate(): Record<string, any> {
    const out: Record<string, any> = {};
    for (let seat = 0; seat < 4; seat++) {
      out[String(seat)] = { hand: this.listHandCodesForSeat(seat) };
    }
    return out;
  }

  private listHandCodesForSeat(seat: number): Array<string> {
    return this.listHandTilesForSeat(seat)
      .sort((a, b) => handSlotSortValue(a.slotName) - handSlotSortValue(b.slotName) || a.tileId - b.tileId)
      .map((tile) => guobiaoTileCode(tile.tileKey));
  }

  private logReplayDraw(seat: number, draw: GuobiaoLastDraw | null): void {
    if (!draw) return;
    const tileKey = this.tileKeyForLastDraw(draw) ?? draw.tileKey ?? null;
    if (tileKey === null) return;
    this.logReplay('draw', {
      seat,
      source: draw.source,
    }, {
      [String(seat)]: { tile: guobiaoTileCode(tileKey), source: draw.source },
    });
  }

  private logReplayBuhuaEvents(
    seat: number,
    publicFaces: Array<[number, number]>,
    replacementDraws: Array<{ tileId: number; tileKey: number }>,
    auto: boolean,
  ): void {
    for (let i = 0; i < publicFaces.length; i++) {
      const [, tileKey] = publicFaces[i]!;
      const replacement = replacementDraws[i] ?? null;
      this.logReplay('buhua', {
        seat,
        tile: guobiaoTileCode(tileKey),
        auto,
      }, replacement ? {
        [String(seat)]: { replacement: guobiaoTileCode(replacement.tileKey) },
      } : null);
    }
  }

  private buildReplayFrame(state: GuobiaoState): { publicFrame: GuobiaoReplayFrame; privateFramesBySeat: Record<string, GuobiaoReplayPrivateFrame> } {
    const things: Array<[number, ThingInfo]> = [];
    const tileFacePublic: Array<[number, number | null]> = [];
    const tileIds: Array<number> = [];
    for (const [rawId, raw] of this.game.entries('things')) {
      const tileId = Math.trunc(Number(rawId));
      const info = raw as ThingInfo;
      if (!Number.isFinite(tileId) || !info || typeof info.slotName !== 'string') continue;
      tileIds.push(tileId);
      things.push([tileId, info]);
    }
    tileIds.sort((a, b) => a - b);
    things.sort((a, b) => a[0] - b[0]);
    for (const tileId of tileIds) {
      const raw = this.game.get('tileFacePublic', tileId);
      const value = Number.isFinite(raw ?? NaN) ? Math.trunc(raw as number) : null;
      tileFacePublic.push([tileId, value]);
    }

    const privateFramesBySeat: Record<string, GuobiaoReplayPrivateFrame> = {};
    for (let seat = 0; seat < 4; seat++) {
      const privateIds = new Set(this.findPrivateTileFaceIdsForSeat(seat));
      const tileFaceSelf: Array<[number, number | null]> = [];
      for (const tileId of tileIds) {
        const key = privateIds.has(tileId) ? (this.tileKeyById.get(tileId) ?? null) : null;
        tileFaceSelf.push([tileId, key]);
      }
      privateFramesBySeat[String(seat)] = {
        gb: this.sanitizeReplayStateForSeat(state, seat),
        tileFaceSelf,
      };
    }

    return {
      publicFrame: {
        gb: this.sanitizeReplayStateForSeat(state, null),
        things,
        tileFacePublic,
      },
      privateFramesBySeat,
    };
  }

  private sanitizeReplayStateForSeat(state: GuobiaoState, viewerSeat: number | null): any {
    return this.sanitizeStateForSeat(state, viewerSeat);
  }

  private logReplay(type: string, publicPayload: any, privateBySeat: Record<string, any> | null, frameState?: GuobiaoState): void {
    const state = frameState ?? this.getState();
    const frame = state ? this.buildReplayFrame(state) : null;
    const publicBase = publicPayload && typeof publicPayload === 'object' && !Array.isArray(publicPayload)
      ? { ...publicPayload }
      : (publicPayload ?? null);
    const ev: ReplayEvent = {
      seq: this.nextReplaySeq(),
      at: Date.now(),
      type,
      public: frame && publicBase && typeof publicBase === 'object' && !Array.isArray(publicBase)
        ? { ...publicBase, frame: frame.publicFrame }
        : publicBase,
    };
    const nextPrivate: Record<string, any> = {};
    if (privateBySeat) {
      for (const [seat, payload] of Object.entries(privateBySeat)) {
        nextPrivate[seat] = payload && typeof payload === 'object' && !Array.isArray(payload) ? { ...payload } : payload;
      }
    }
    if (frame) {
      for (let seat = 0; seat < 4; seat++) {
        const key = String(seat);
        const base = nextPrivate[key] && typeof nextPrivate[key] === 'object' && !Array.isArray(nextPrivate[key])
          ? nextPrivate[key]
          : {};
        nextPrivate[key] = { ...base, frame: frame.privateFramesBySeat[key] };
      }
    }
    if (Object.keys(nextPrivate).length > 0) ev.private = nextPrivate;
    this.appendReplayEvents([ev]);
  }

  private nextReplaySeq(): number {
    const now = Date.now();
    const seq = now <= this.replaySeq ? this.replaySeq + 1 : now;
    this.replaySeq = seq;
    return seq;
  }
}

function emptyPlayer(seat: number, playerId: string | null, points: number): GuobiaoPlayerState {
  return {
    seat,
    playerId,
    points,
    ruleScore: 0,
    flowers: [],
    melds: [],
    hu: false,
    huTileKey: null,
    wrongHu: false,
  };
}

function handSlotSortValue(slotName: string): number {
  const raw = String(slotName ?? '');
  const hand = /^hand\.(\d+)@/.exec(raw);
  if (hand) return parseInt(hand[1] ?? '0', 10);
  if (/^hand\.extra@/.test(raw)) return 100;
  return 1000;
}

function emptyThing(slotName: string): ThingInfo {
  return {
    slotName,
    rotationIndex: 0,
    claimedBy: null,
    heldRotation: HELD_ROTATION_IDENTITY,
    shiftSlotName: null,
  };
}

function emptySeatClaimOptions(): GuobiaoClaimOptions {
  return { hu: false, huKind: 'none', chi: [], peng: false, mingGang: false, pass: true };
}

function emptyClaimOptions(): Record<number, GuobiaoClaimOptions> {
  return {
    0: emptySeatClaimOptions(),
    1: emptySeatClaimOptions(),
    2: emptySeatClaimOptions(),
    3: emptySeatClaimOptions(),
  };
}

function emptyPendingResponses(): Record<number, GuobiaoPendingResponse | null> {
  return { 0: null, 1: null, 2: null, 3: null };
}

function clonePendingResponse(response: GuobiaoPendingResponse | null | undefined): GuobiaoPendingResponse | null {
  if (!response) return null;
  return response.optionId
    ? { action: response.action, optionId: response.optionId }
    : { action: response.action };
}

function clonePendingResponses(responses: Record<number, GuobiaoPendingResponse | null> | null | undefined): Record<number, GuobiaoPendingResponse | null> {
  const out = emptyPendingResponses();
  for (const seat of [0, 1, 2, 3]) {
    out[seat] = clonePendingResponse(responses?.[seat] ?? (responses as any)?.[String(seat)] ?? null);
  }
  return out;
}

function cloneClaimOptions(opt: GuobiaoClaimOptions): GuobiaoClaimOptions {
  return {
    hu: opt.hu === true,
    huKind: opt.huKind,
    chi: (opt.chi ?? []).map((item) => ({
      optionId: item.optionId,
      tileIds: [...item.tileIds],
      tileKeys: [...item.tileKeys],
      sequence: [...item.sequence],
    })),
    peng: opt.peng === true,
    mingGang: opt.mingGang === true,
    pass: opt.pass === true,
  };
}

function hasAnyClaimOption(opt: GuobiaoClaimOptions | undefined): boolean {
  if (!opt) return false;
  return opt.hu || opt.peng || opt.mingGang || opt.chi.length > 0;
}

function claimOrder(fromSeat: number): Array<number> {
  return [1, 2, 3].map((i) => (fromSeat + i) % 4);
}

function hasWallTile(state: GuobiaoState): boolean {
  return state.wallHeadIndex <= state.wallTailIndex;
}

function allPlayersWrongHu(players: Record<number, GuobiaoPlayerState>): boolean {
  return [0, 1, 2, 3].every((seat) => players[seat]?.wrongHu === true);
}

function parseSeat(raw: any): number | null {
  const n = Math.trunc(Number((raw as SeatInfo)?.seat));
  if (!Number.isFinite(n) || n < 0 || n > 3) return null;
  return n;
}

function isHandSlot(slotName: string, seat: number): boolean {
  return slotName.startsWith('hand.') && slotName.endsWith(`@${seat}`);
}

function nextSeat(seat: number): number {
  return (seat + 1) % 4;
}

function wallSlots(seat: number): Array<string> {
  const out: Array<string> = [];
  for (let col = 0; col < 19; col++) {
    out.push(`wall.${col}.1@${seat}`);
    out.push(`wall.${col}.0@${seat}`);
  }
  return out;
}

function discardSlots(seat: number): Array<string> {
  const out: Array<string> = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) out.push(`discard.${row}.${col}@${seat}`);
  }
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) out.push(`discard.stack.${row}.${col}@${seat}`);
  }
  return out;
}

function computeWallOrderFromThings(things: Map<number, ThingInfo>): Array<number> {
  const tiles: Array<{ tileId: number; seat: number; col: number; stack: number }> = [];
  for (const [tileId, info] of things.entries()) {
    const m = /^wall\.(\d+)\.(\d+)@(\d)$/.exec(String(info.slotName));
    if (!m) continue;
    tiles.push({
      tileId,
      col: parseInt(m[1] ?? '0', 10),
      stack: parseInt(m[2] ?? '0', 10),
      seat: parseInt(m[3] ?? '0', 10),
    });
  }
  tiles.sort((a, b) => a.seat - b.seat || a.col - b.col || b.stack - a.stack);
  return tiles.map((t) => t.tileId);
}

function thingMapEntries(things: Map<number, ThingInfo>): Array<Entry> {
  const entries: Array<Entry> = [];
  for (const [id, info] of things.entries()) entries.push(['things', id, info]);
  return entries;
}

function emptySeatCounter(): Record<number, number> {
  return { 0: 0, 1: 0, 2: 0, 3: 0 };
}

function emptySeatBoolean(value: boolean): Record<number, boolean> {
  return { 0: value, 1: value, 2: value, 3: value };
}

function incrementSeatCounter(source: Record<number, number> | undefined, seat: number): Record<number, number> {
  const next = emptySeatCounter();
  for (const s of [0, 1, 2, 3]) next[s] = source?.[s] ?? 0;
  next[seat] = (next[seat] ?? 0) + 1;
  return next;
}

function findFirstHandFlower(
  things: Map<number, ThingInfo>,
  tileKeyById: Map<number, number>,
  seat: number,
): { tileId: number; tileKey: number; info: ThingInfo } | null {
  const flowers: Array<{ tileId: number; tileKey: number; info: ThingInfo }> = [];
  for (const [tileId, info] of things.entries()) {
    if (!isHandSlot(info.slotName, seat)) continue;
    const tileKey = tileKeyById.get(tileId);
    if (tileKey === undefined || !isGuobiaoFlower(tileKey)) continue;
    flowers.push({ tileId, tileKey, info });
  }
  flowers.sort((a, b) => a.info.slotName.localeCompare(b.info.slotName) || a.tileId - b.tileId);
  return flowers[0] ?? null;
}

function makeShuffledTileMapping(): Map<number, number> {
  const deck = makeGuobiaoTileKeyDeck();
  shuffleInPlace(deck);
  const out = new Map<number, number>();
  for (let tileId = 0; tileId < GUOBIAO_DECK_SIZE; tileId++) out.set(tileId, deck[tileId]!);
  return out;
}

function shuffleInPlace<T>(xs: Array<T>): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = xs[i]!;
    xs[i] = xs[j]!;
    xs[j] = t;
  }
}

function applyTransfers(
  players: Record<number, GuobiaoPlayerState>,
  transfers: Array<GuobiaoLedgerTransfer>,
  pointDelta: Record<number, number>,
  ruleDelta: Record<number, number>,
): void {
  for (const tr of transfers) {
    const from = players[tr.fromSeat];
    const to = players[tr.toSeat];
    if (!from || !to) continue;
    players[tr.fromSeat] = {
      ...from,
      points: from.points - tr.points,
      ruleScore: from.ruleScore - tr.ruleScore,
    };
    players[tr.toSeat] = {
      ...to,
      points: to.points + tr.points,
      ruleScore: to.ruleScore + tr.ruleScore,
    };
    pointDelta[tr.fromSeat] = (pointDelta[tr.fromSeat] ?? 0) - tr.points;
    pointDelta[tr.toSeat] = (pointDelta[tr.toSeat] ?? 0) + tr.points;
    ruleDelta[tr.fromSeat] = (ruleDelta[tr.fromSeat] ?? 0) - tr.ruleScore;
    ruleDelta[tr.toSeat] = (ruleDelta[tr.toSeat] ?? 0) + tr.ruleScore;
  }
}

function buildPointsBySeat(players: Record<number, GuobiaoPlayerState>): Record<number, number> {
  const out: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let seat = 0; seat < 4; seat++) {
    out[seat] = Math.trunc(Number(players[seat]?.points ?? 0));
  }
  return out;
}

function buildRuleScoreBySeat(players: Record<number, GuobiaoPlayerState>): Record<number, number> {
  const out: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let seat = 0; seat < 4; seat++) {
    out[seat] = Math.trunc(Number(players[seat]?.ruleScore ?? 0));
  }
  return out;
}

function buildPointsDeltaBySeat(
  players: Record<number, GuobiaoPlayerState>,
  initialPointsBySeat: Record<number, number>,
): Record<number, number> {
  const out: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let seat = 0; seat < 4; seat++) {
    const finalPoints = Math.trunc(Number(players[seat]?.points ?? 0));
    const initialPoints = Math.trunc(Number(initialPointsBySeat?.[seat] ?? 0));
    out[seat] = finalPoints - initialPoints;
  }
  return out;
}

function buildGuobiaoEndReplayPublic(summary: GuobiaoEndSummary): any {
  return {
    variant: 'guobiao',
    kind: summary.kind,
    ruleVersion: summary.ruleVersion,
    baseRuleScore: summary.baseRuleScore,
    pointsScale: summary.pointsScale,
    winners: summary.winners,
    fromSeat: summary.fromSeat,
    fanTotal: summary.fanTotal,
    fans: summary.fans,
    pointsBySeat: summary.pointsBySeat,
    ruleScoreBySeat: summary.ruleScoreBySeat,
    pointsDeltaBySeat: summary.pointsDeltaBySeat,
    ruleScoreDeltaBySeat: summary.ruleScoreDeltaBySeat,
    // Keep the existing replay/record field name; for guobiao it stores final platform points.
    beans: summary.pointsBySeat,
    endSummary: summary,
  };
}

function normalizeAction(raw: any): GuobiaoAction | null {
  const kind = typeof raw?.kind === 'string' ? raw.kind : null;
  if (kind === 'discard') {
    if (!Number.isFinite(raw.tileId)) return null;
    return { kind: 'discard', tileId: Math.trunc(raw.tileId) };
  }
  if (kind === 'claim') {
    if (!Number.isFinite(raw.pendingId)) return null;
    const action = raw.action;
    if (action !== 'hu' && action !== 'chi' && action !== 'peng' && action !== 'mingGang' && action !== 'pass') return null;
    const optionId = typeof raw.optionId === 'string' ? raw.optionId : undefined;
    return optionId
      ? { kind: 'claim', pendingId: Math.trunc(raw.pendingId), action, optionId }
      : { kind: 'claim', pendingId: Math.trunc(raw.pendingId), action };
  }
  if (kind === 'hu') {
    if (raw.source !== 'self') return null;
    return { kind: 'hu', source: 'self' };
  }
  if (kind === 'buhua') {
    if (!Number.isFinite(raw.tileId)) return null;
    return { kind: 'buhua', tileId: Math.trunc(raw.tileId) };
  }
  if (kind === 'setAutoBuhua') {
    if (typeof raw.enabled !== 'boolean') return null;
    return { kind: 'setAutoBuhua', enabled: raw.enabled };
  }
  if (kind === 'anGang') {
    const tileKey = Number.isFinite(raw.tileKey) ? Math.trunc(raw.tileKey) : undefined;
    const tileIds = Array.isArray(raw.tileIds)
      ? raw.tileIds.filter((x: unknown) => Number.isFinite(x)).map((x: number) => Math.trunc(x))
      : undefined;
    if (tileKey === undefined && (!tileIds || tileIds.length !== 4)) return null;
    return tileIds ? { kind: 'anGang', tileKey, tileIds } : { kind: 'anGang', tileKey };
  }
  if (kind === 'addGang') {
    const tileId = Number.isFinite(raw.tileId) ? Math.trunc(raw.tileId) : undefined;
    const meldId = Number.isFinite(raw.meldId) ? Math.trunc(raw.meldId) : undefined;
    if (tileId === undefined && meldId === undefined) return null;
    return tileId !== undefined ? { kind: 'addGang', tileId, meldId } : { kind: 'addGang', meldId };
  }
  return null;
}

function isAuthoritativeMode(): boolean {
  return true;
}
