import { Entry, Message, type AiScene } from './protocol';
import { Game } from './game';
import type { ReplayEvent } from './replay-store';
import { calcBloodHu, type HuCalcHand, type HuEvents } from './blood-calc-engine';

type ThingInfo = {
  slotName: string;
  rotationIndex: number;
  claimedBy: number | null;
  heldRotation: { x: number; y: number; z: number; w: number };
  shiftSlotName: string | null;
};

type SeatInfo = { seat: number | null; startBeans?: number };

type BloodSuit = 'm' | 'p' | 's';
type BloodSwap3Direction = 'cw' | 'ccw' | 'across';
type BloodClaimAction = 'hu' | 'peng' | 'gang' | 'pass';
type BloodGangType = 'an' | 'ming' | 'add';

type BloodMeld = {
  kind: 'peng' | 'gang';
  tileKey: number;
  fromSeat: number | null;
  gangType?: BloodGangType;
  row: number;
};

type BloodPlayerState = {
  seat: number;
  playerId: string | null;
  dingque: BloodSuit | null;
  // 已提交定缺（定缺阶段只公开该标记，不公开花色）
  dingqueReady?: boolean;
  hu: boolean;
  huTileKey: number | null;
  huSource: 'self' | 'discard' | null;
  beans: number;
  kongGain: number;
  melds: Array<BloodMeld>;
};

type BloodPendingClaim = {
  kind: 'claim';
  id: number;
  since: number;
  // 触发来源：弃牌 / 加杠（可被抢杠胡）
  trigger?: 'discard' | 'addKong';
  // 是否为“杠后第一张弃牌”（用于杠上炮判定）
  afterGang?: boolean;
  fromSeat: number;
  tileId: number;
  tileKey: number;
  options: Record<number, { hu: boolean; peng: boolean; gang: boolean }>;
  responses: Record<number, BloodClaimAction | null>;
};

type BloodSwap3State = {
  dir: BloodSwap3Direction;
  since: number;
  animatingSince: number | null;
  selections: Record<number, Array<number> | null>;
};

type BloodLedgerTransfer = { fromSeat: number; toSeat: number; beans: number };
type BloodLedgerEntry = {
  kind: 'kong' | 'hu' | 'penalty';
  label: string;
  seat?: number;
  fromSeat?: number;
  multiplier: number;
  transfers: Array<BloodLedgerTransfer>;
  at: number;
  // 仅用于展示/回放：胡牌番型与倍数原值（兼容旧局封顶字段）
  fans?: Array<{ id: string; name: string; multiplier: number }>;
  multiplierRaw?: number;
  cap?: number;
  note?: string;
};

export type BloodState = {
  version: 1;
  base: number;
  // 本局开局豆（用于结算展示净输赢）；可选字段：兼容旧状态/回放
  initialBeans?: number;
  // 各座位本局开局豆（用于按人头展示/结算）；可选字段：兼容旧状态/回放
  initialBeansBySeat?: Record<number, number>;
  phase: 'swap3' | 'dingque' | 'playing' | 'settling' | 'done';
  // 进入定缺阶段的时间戳（ms）；用于“超时自动定缺”
  dingqueSince?: number | null;
  dealer: number;
  turnSeat: number;
  turnStep: 'discard' | 'drawOrKong';
  wallOrder: Array<number>;
  wallIndex: number;
  nextId: number;
  pending: BloodPendingClaim | null;
  // 最近一次杠牌的座位：用于自动识别“杠上开花/杠上炮”
  afterGangSeat?: number | null;
  swap3?: BloodSwap3State | null;
  ledger?: Array<BloodLedgerEntry>;
  players: Record<number, BloodPlayerState>;
  revealAllHands: boolean;
  // 结算明细（听牌/最大番/等），仅在 phase='settling' 后写入；可选字段：兼容旧状态/回放
  endSummary?: any;
  settlingSince?: number | null;
};

type BloodAction =
  | { kind: 'swap3'; tileIds: Array<number> }
  | { kind: 'dingque'; suit: BloodSuit }
  | { kind: 'discard'; tileId: number }
  | { kind: 'claim'; pendingId: number; action: BloodClaimAction }
  | { kind: 'kong'; gangType: Exclude<BloodGangType, 'ming'>; tileKey: number }
  | { kind: 'hu'; source: 'self' };

const BASE = 400;
const START_BEANS = 0;
const LEGACY_START_BEANS = 50000;

const SWAP3_ANIM_DELAY_MS = 1200;
const DEFAULT_DECISION_TIMEOUT_MS = 6 * 60 * 1000;
const SETTLING_DELAY_MS = 16000;

const HELD_ROTATION_IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

export class BloodEngine {
  private game: Game;
  private appendReplayEvents: (events: Array<ReplayEvent>) => void;

  // Secret mapping: physical tileId -> tileKey (0..26)
  private tileKeyById: Map<number, number> = new Map();

  private replaySeq: number = Date.now();
  private replayMetaLogged: boolean = false;
  private replayHandsLogged: boolean = false;

  private lastTurnKey: string | null = null;
  private turnSince: number = Date.now();
  private pendingDingqueBySeat: Record<number, BloodSuit | null> = { 0: null, 1: null, 2: null, 3: null };

  constructor(game: Game, options: { appendReplayEvents: (events: Array<ReplayEvent>) => void }) {
    this.game = game;
    this.appendReplayEvents = options.appendReplayEvents;
  }

  private decisionTimeoutMs(): number | null {
    const match: any = this.game.get('match', 0);
    const cfg: any = String(match?.roomType ?? '') === 'friend'
      ? (match?.friendConfig ?? match?.bloodConfig ?? null)
      : (match?.bloodConfig ?? null);
    const mode = typeof cfg?.waitMode === 'string' ? String(cfg.waitMode) : '';
    if (mode !== 'timeoutAuto') {
      return null;
    }
    const raw = cfg?.timeoutMs;
    const n = typeof raw === 'number' ? Math.trunc(raw) : null;
    if (n !== null && Number.isFinite(n) && n > 0) {
      return n;
    }
    return DEFAULT_DECISION_TIMEOUT_MS;
  }

  private pickAutoDingqueSuit(seat: number): BloodSuit {
    const counts: Record<BloodSuit, number> = { m: 0, p: 0, s: 0 };
    for (const tileId of this.findHandTileIds(seat)) {
      const k = this.tileKeyById.get(tileId);
      if (k === undefined) continue;
      const suit = suitOf(k);
      counts[suit] = (counts[suit] ?? 0) + 1;
    }
    let best: BloodSuit = 'm';
    let bestCount = counts[best] ?? 0;
    for (const suit of ['p', 's'] as Array<BloodSuit>) {
      const c = counts[suit] ?? 0;
      if (c < bestCount) {
        best = suit;
        bestCount = c;
      }
    }
    return best;
  }

  private isDingqueCommitted(ps: BloodPlayerState | null | undefined): boolean {
    if (!ps || ps.playerId === null) return false;
    return ps.dingqueReady === true || ps.dingque !== null;
  }

  private clearPendingDingque(): void {
    this.pendingDingqueBySeat = { 0: null, 1: null, 2: null, 3: null };
  }

  private tryAdvanceFromDingque(state: BloodState, now: number): boolean {
    const allReady = [0, 1, 2, 3].every((s) => this.isDingqueCommitted(state.players[s]));
    if (!allReady) return false;

    const players: Record<number, BloodPlayerState> = { ...state.players };
    let missingCommittedSuit = false;
    for (let s = 0; s < 4; s++) {
      const ps = players[s];
      if (!ps || ps.playerId === null) continue;
      const suit = this.pendingDingqueBySeat[s] ?? ps.dingque ?? null;
      if (!suit) {
        // 避免“已提交但花色丢失”时静默改写为自动定缺：回退为未提交，等待玩家重选。
        players[s] = { ...ps, dingqueReady: false };
        missingCommittedSuit = true;
        continue;
      }
      players[s] = { ...ps, dingque: suit, dingqueReady: true };
    }

    if (missingCommittedSuit) {
      this.setState({ ...state, players }, []);
      return true;
    }

    this.clearPendingDingque();
    this.transitionPhase(
      { ...state, players },
      'playing',
      { turnSeat: state.dealer, turnStep: 'discard', dingqueSince: null },
      now,
    );
    return true;
  }

  onPlayerConnected(playerId: string): void {
    const state = this.getState();
    if (!state) return;
    const seat = this.game.getSeatForPlayer(playerId);
    if (seat === null) return;
    this.sendTileFaceSelfFull(seat, playerId);
  }

  tick(now: number = Date.now()): void {
    if (!isAuthoritativeMode()) {
      return;
    }
    this.ensureMatch();

    const match = this.game.get('match', 0);
    if (!match || match?.conditions?.gameType !== 'BLOOD_BATTLE') {
      return;
    }

    const state = this.getState();
    if (!state) {
      // Start when all 4 seats are occupied.
      const seatToPlayer = this.getSeatToPlayer();
      const ready = [0, 1, 2, 3].every((s) => typeof seatToPlayer[s] === 'string' && seatToPlayer[s] !== null);
      const hasPendingReservedSeat = Object.values((match as any)?.seatActors ?? {}).some(
        (actor: any) => actor?.kind === 'ai-pending' || actor?.kind === 'human-pending',
      );
      if (ready && !hasPendingReservedSeat) {
        this.startGame(now);
      }
      return;
    }

    // Sync playerId bindings from seats -> blood.players
    {
      const seatToPlayer = this.getSeatToPlayer();
      let changed = false;
      const players: Record<number, BloodPlayerState> = { ...state.players };
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
        return;
      }
    }

    // Track discard timeout window.
    {
      const key = this.makeTurnKey(state);
      if (key !== this.lastTurnKey) {
        this.lastTurnKey = key;
        this.turnSince = now;
      }
    }

    if (state.phase === 'swap3') {
      this.tickSwap3(state, now);
      return;
    }

    if (state.phase === 'dingque') {
      const since = state.dingqueSince ?? null;
      if (since === null) {
        this.setState({ ...state, dingqueSince: now }, []);
        return;
      }

      if (this.tryAdvanceFromDingque(state, now)) {
        return;
      }

      return;
    }

	    if (state.phase === 'playing') {
	      // End conditions are checked before auto actions to avoid drawing after game end (3 hu).
	      // Ensure wallOrder is computed once.
	      if (state.wallOrder.length === 0) {
	        const wallOrder = this.computeWallOrder();
	        this.setState({ ...state, wallOrder, wallIndex: 0 }, []);
	        return;
	      }

      // Pending resolution
      if (state.pending?.kind === 'claim') {
        this.tickPending(state, now);
        return;
      }

	      // End conditions (MVP): 3 hu OR cannot draw when required.
	      const huCount = [0, 1, 2, 3].filter((s) => !!state.players[s]?.hu).length;
      const wallEmpty = state.wallIndex >= state.wallOrder.length;
      const noTileToDraw = wallEmpty && state.turnStep === 'drawOrKong';
      if (huCount >= 3 || noTileToDraw) {
        const base = state.base;
        const initialBeans = state.initialBeans ?? START_BEANS;
        const initialBeansBySeat: Record<number, number> =
          state.initialBeansBySeat ??
          {
            0: initialBeans,
            1: initialBeans,
            2: initialBeans,
            3: initialBeans,
          };
        const ledgerBeforeEnd = [...(state.ledger ?? [])];

        const updatedPlayers: Record<number, BloodPlayerState> = { ...state.players };
        const isActive = (seat: number): boolean => updatedPlayers[seat]?.playerId !== null;
        const activeSeats = [0, 1, 2, 3].filter(isActive);

        const concealedTilesForSeat = (seat: number): Array<number> => {
          const tiles: Array<number> = [];
          for (const tileId of this.findHandTileIds(seat)) {
            const k = this.tileKeyById.get(tileId) ?? null;
            if (k !== null) tiles.push(k);
          }
          return tiles;
        };

        const isPigBySeat: Record<number, boolean> = { 0: false, 1: false, 2: false, 3: false };
        for (let s = 0; s < 4; s++) {
          const ps = updatedPlayers[s];
          if (!ps || ps.playerId === null || ps.dingque === null) continue;
          for (const tileId of this.findHandTileIds(s)) {
            const k = this.tileKeyById.get(tileId) ?? null;
            if (k !== null && suitOf(k) === ps.dingque) {
              isPigBySeat[s] = true;
              break;
            }
          }
        }

        // 公开可证绝张（死听剔除）：仅使用“公开可见信息”=弃牌+副露（暗杠为亮杠，计入公开可见范围）。
        const publicCounts = new Array<number>(27).fill(0);
        for (const [rawId, raw] of this.game.entries('things')) {
          const info = raw as ThingInfo;
          const slotName = info?.slotName;
          if (typeof slotName !== 'string') continue;
          if (!slotName.startsWith('discard.') && !slotName.startsWith('hu.taken.')) continue;
          const tileId = Math.trunc(rawId as number);
          const k = this.tileKeyById.get(tileId) ?? null;
          if (k !== null) publicCounts[k] += 1;
        }
        for (let s = 0; s < 4; s++) {
          const ps = updatedPlayers[s];
          if (!ps || ps.playerId === null) continue;
          for (const m of ps.melds ?? []) {
            const k = Math.trunc(m.tileKey as number);
            if (!Number.isFinite(k) || k < 0 || k >= 27) continue;
            publicCounts[k] += m.kind === 'gang' ? 4 : 3;
          }
        }

        const seatsSummary: Record<number, any> = {
          0: { isActive: false, hu: false, isPig: false, ting: false, waits: [], maxWaits: [], maxMultiplier: 0, maxMultiplierRaw: 0, maxFans: [] },
          1: { isActive: false, hu: false, isPig: false, ting: false, waits: [], maxWaits: [], maxMultiplier: 0, maxMultiplierRaw: 0, maxFans: [] },
          2: { isActive: false, hu: false, isPig: false, ting: false, waits: [], maxWaits: [], maxMultiplier: 0, maxMultiplierRaw: 0, maxFans: [] },
          3: { isActive: false, hu: false, isPig: false, ting: false, waits: [], maxWaits: [], maxMultiplier: 0, maxMultiplierRaw: 0, maxFans: [] },
        };

        // 结算用“听牌/最大番”（点炮口径、仅牌型+根、不计自摸×2/过程事件；且剔除“公开可证绝张”）
        for (let s = 0; s < 4; s++) {
          const ps = updatedPlayers[s];
          if (!ps || ps.playerId === null) continue;
          const isPig = Boolean(isPigBySeat[s]);
          if (ps.hu || ps.dingque === null || isPig) {
            seatsSummary[s] = {
              isActive: true,
              hu: Boolean(ps.hu),
              isPig,
              ting: false,
              waits: [],
              maxWaits: [],
              maxMultiplier: 0,
              maxMultiplierRaw: 0,
              maxFans: [],
            };
            continue;
          }

          const melds = ps.melds.map((m) => ({ kind: m.kind, tileKey: m.tileKey, gangType: m.gangType }));
          const meldCount = melds.length;
          const targetBaseConcealed = 13 - meldCount * 3;

          // 结算时可能存在“仍持有 extra(摸牌未打)”等边界：先把暗手规范化到 13-3*副露 张，再枚举听牌。
          const allTileIds = this.findHandTileIds(s);
          const extraTileId = this.findTileInSlot(`hand.extra@${s}`);
          const allKeys: Array<number> = [];
          const noExtraKeys: Array<number> = [];
          for (const tileId of allTileIds) {
            const k = this.tileKeyById.get(tileId) ?? null;
            if (k === null) continue;
            allKeys.push(k);
            if (tileId !== extraTileId) noExtraKeys.push(k);
          }

          // Prefer dropping the extra draw tile if present; fall back to “drop any 1 tile” when oversized.
          let baseKeys = noExtraKeys.length >= targetBaseConcealed ? noExtraKeys : allKeys;
          let baseCandidates: Array<Array<number>> = [];
          if (baseKeys.length === targetBaseConcealed) {
            baseCandidates = [baseKeys];
          } else if (baseKeys.length > targetBaseConcealed) {
            // Consider all possible discards to avoid false “未听” penalties.
            for (let drop = 0; drop < baseKeys.length; drop++) {
              const cand = [...baseKeys.slice(0, drop), ...baseKeys.slice(drop + 1)];
              if (cand.length === targetBaseConcealed) baseCandidates.push(cand);
            }
          } else {
            // Too few tiles: keep as-is (will likely yield no waits), but avoid crashing.
            baseCandidates = [baseKeys];
          }

          const waitSet: Set<number> = new Set();
          let maxMultiplier = 0;
          let maxMultiplierRaw = 0;
          let maxFans: Array<{ id: string; name: string; multiplier: number }> = [];
          let maxWaits: Array<number> = [];

          for (const baseConcealed of baseCandidates) {
            for (let tileKey = 0; tileKey < 27; tileKey++) {
              if (suitOf(tileKey) === ps.dingque) continue;
              if ((publicCounts[tileKey] ?? 0) >= 4) continue;
              const calc = calcBloodHu(
                { concealedTiles: [...baseConcealed, tileKey], melds } as HuCalcHand,
                { base, huMethod: 'dianpao', events: {} },
              );
              if (!calc.ok) continue;
              waitSet.add(tileKey);
              const mult = calc.multiplierCapped;
              if (mult > maxMultiplier) {
                maxMultiplier = mult;
                maxMultiplierRaw = calc.multiplierRaw;
                maxFans = calc.fans.map((f) => ({ id: f.id, name: f.name, multiplier: f.multiplier }));
                maxWaits = [tileKey];
              } else if (mult === maxMultiplier && mult > 0) {
                maxWaits.push(tileKey);
              }
            }
          }

          const waits = [...waitSet].sort((a, b) => a - b);
          maxWaits = [...new Set(maxWaits)].sort((a, b) => a - b);

          seatsSummary[s] = {
            isActive: true,
            hu: false,
            isPig: false,
            ting: waits.length > 0,
            waits,
            maxWaits,
            maxMultiplier,
            maxMultiplierRaw,
            maxFans,
          };
        }

        const notTingSeats = activeSeats.filter((s) => !updatedPlayers[s]!.hu && (seatsSummary[s]?.isPig || !seatsSummary[s]?.ting));
        const tingNotHuSeats = activeSeats.filter((s) => !updatedPlayers[s]!.hu && !seatsSummary[s]?.isPig && seatsSummary[s]?.ting);

        const applyTransfers = (transfers: ReadonlyArray<BloodLedgerTransfer>): void => {
          for (const tr of transfers) {
            const from = updatedPlayers[tr.fromSeat];
            const to = updatedPlayers[tr.toSeat];
            if (!from || !to) continue;
            if (from.playerId === null || to.playerId === null) continue;
            updatedPlayers[tr.fromSeat] = { ...from, beans: from.beans - tr.beans };
            updatedPlayers[tr.toSeat] = { ...to, beans: to.beans + tr.beans };
          }
        };

        // 查花猪：花猪向每位非花猪玩家（含已胡玩家）各赔 16 倍底分
        const pigPay = base * 16;
        const pigTransfers: Array<BloodLedgerTransfer> = [];
        for (const pig of activeSeats.filter((s) => isPigBySeat[s])) {
          for (const other of activeSeats) {
            if (other === pig) continue;
            if (isPigBySeat[other]) continue;
            pigTransfers.push({ fromSeat: pig, toSeat: other, beans: pigPay });
          }
        }

        // 退税：未听牌玩家撤销本局所有“作为收款方收到的杠豆”（按原支付关系原路退回）
        const tuishuiTransfers: Array<BloodLedgerTransfer> = [];
        const notTingSet = new Set<number>(notTingSeats);
        for (const entry of ledgerBeforeEnd) {
          if (!entry || entry.kind !== 'kong') continue;
          for (const tr of entry.transfers ?? []) {
            if (!tr) continue;
            if (!notTingSet.has(tr.toSeat)) continue;
            tuishuiTransfers.push({ fromSeat: tr.toSeat, toSeat: tr.fromSeat, beans: tr.beans });
          }
        }

        // 查大叫：未听牌玩家向“听牌未胡玩家”赔付其最大可能倍数（点炮口径，仅牌型+根，不计过程番）
        const dajiaoTransfers: Array<BloodLedgerTransfer> = [];
        for (const payer of notTingSeats) {
          for (const recv of tingNotHuSeats) {
            const mult = seatsSummary[recv]?.maxMultiplier ?? 0;
            if (mult <= 0) continue;
            dajiaoTransfers.push({ fromSeat: payer, toSeat: recv, beans: base * mult });
          }
        }

        applyTransfers(pigTransfers);
        applyTransfers(tuishuiTransfers);
        applyTransfers(dajiaoTransfers);

        const penaltyEntries: Array<BloodLedgerEntry> = [];
        if (pigTransfers.length > 0) {
          penaltyEntries.push({
            kind: 'penalty',
            label: '查花猪',
            multiplier: 16,
            transfers: pigTransfers,
            at: now,
            note: '花猪：含缺门花色牌者赔付非花猪玩家（含已胡）',
          });
        }
        if (tuishuiTransfers.length > 0) {
          penaltyEntries.push({
            kind: 'penalty',
            label: '退税',
            multiplier: 0,
            transfers: tuishuiTransfers,
            at: now,
            note: '未听：撤销本局作为收款方收到的杠豆（原路退回）',
          });
        }
        if (dajiaoTransfers.length > 0) {
          penaltyEntries.push({
            kind: 'penalty',
            label: '查大叫',
            multiplier: 0,
            transfers: dajiaoTransfers,
            at: now,
            note: '未听：赔付听牌未胡玩家的最大可能倍数（点炮口径，仅牌型+根）',
          });
        }

        for (const entry of penaltyEntries) {
          this.logReplay('ledger', { entry }, null);
        }

        const endSummary = { initialBeans, initialBeansBySeat, base, cap: 0, seats: seatsSummary };

        const beans: Record<string, number> = {};
        for (let s = 0; s < 4; s++) {
          const b = updatedPlayers[s]?.beans ?? null;
          if (typeof b === 'number' && Number.isFinite(b)) beans[String(s)] = Math.trunc(b);
        }
        this.logReplay('end', { beans, endSummary, seatActors: this.replaySeatActors() }, null);

	        const nextState: BloodState = {
	          ...state,
	          phase: 'settling',
	          revealAllHands: true,
	          settlingSince: now,
	          afterGangSeat: null,
	          players: updatedPlayers,
	          pending: null,
	          ledger: [...ledgerBeforeEnd, ...penaltyEntries],
	          endSummary,
	        };
	        const reveal = this.makeRevealAllEntries();
	        this.setState(nextState, reveal);
	        return;
	      }

	      // Auto draw when needed
	      if (state.turnStep === 'drawOrKong') {
	        if (this.tryAutoDraw(state, now)) {
	          return;
	        }
	      }

	      return;
	    }

		    if (state.phase === 'settling') {
		      const settlingSince = state.settlingSince ?? null;
		      if (settlingSince === null) {
		        this.setState({ ...state, settlingSince: now }, []);
		        return;
		      }
		      if (now - settlingSince >= SETTLING_DELAY_MS) {
		        this.transitionPhase(state, 'done', {}, now);
		      }
		      return;
		    }
		  }

  handleAction(playerId: string, rawAction: any, now: number = Date.now()): { ok: true } | { ok: false; error: string } {
    const action = normalizeAction(rawAction);
    if (!action) {
      return { ok: false, error: 'invalid action' };
    }
    const seat = this.game.getSeatForPlayer(playerId);
    if (seat === null) {
      return { ok: false, error: 'not seated' };
    }
    const state = this.getState();
    if (!state) {
      return { ok: false, error: 'game not started' };
    }

    const me = state.players[seat];
    if (!me || me.playerId !== playerId) {
      return { ok: false, error: 'seat mismatch' };
    }

    if (action.kind === 'swap3') {
      const swap3 = state.swap3 ?? null;
      if (state.phase !== 'swap3' || !swap3 || swap3.animatingSince !== null) {
        return { ok: false, error: 'not in swap3' };
      }
      if (swap3.selections?.[seat] !== null) {
        return { ok: false, error: 'already selected' };
      }
      const ids = (Array.isArray(action.tileIds) ? action.tileIds : [])
        .filter((x) => Number.isFinite(x))
        .slice(0, 3)
        .map((x) => Math.trunc(x as number));
      const uniq = new Set(ids);
      if (ids.length !== 3 || uniq.size !== 3) {
        return { ok: false, error: 'need 3 distinct tiles' };
      }
      // Must be from own hand and same suit.
      let suit: BloodSuit | null = null;
      for (const tileId of ids) {
        const info = this.getThing(tileId);
        if (!info) return { ok: false, error: 'tile not found' };
        if (!info.slotName.startsWith('hand.') || !info.slotName.endsWith(`@${seat}`)) {
          return { ok: false, error: 'tile not in hand' };
        }
        const tileKey = this.tileKeyById.get(tileId) ?? null;
        if (tileKey === null) return { ok: false, error: 'unknown tile' };
        const s = suitOf(tileKey);
        if (suit === null) suit = s;
        else if (s !== suit) return { ok: false, error: 'must be same suit' };
      }

      const nextSwap3: BloodSwap3State = {
        ...swap3,
        selections: { ...swap3.selections, [seat]: ids.slice(0, 3) },
      };
      this.setState({ ...state, swap3: nextSwap3 }, []);
      const codes = ids.map((id) => tileCode(this.tileKeyById.get(id)!));
      this.logReplay('swap3_select', { seat }, { [String(seat)]: { tiles: codes } });
      return { ok: true };
    }

    if (action.kind === 'dingque') {
      if (state.phase !== 'dingque') {
        return { ok: false, error: 'not in dingque' };
      }
      if (this.isDingqueCommitted(me)) {
        return { ok: false, error: 'already dingque' };
      }
      const suit = action.suit;
      this.pendingDingqueBySeat[seat] = suit;
      const nextPlayers = { ...state.players, [seat]: { ...me, dingqueReady: true } };
      const nextState: BloodState = { ...state, players: nextPlayers };
      if (!this.tryAdvanceFromDingque(nextState, now)) {
        this.setState(nextState, []);
      }
      this.logReplay('dingque', { seat }, { [String(seat)]: { suit } });
      return { ok: true };
    }

    if (action.kind === 'discard') {
      if (state.phase !== 'playing' || state.pending !== null || state.turnSeat !== seat || state.turnStep !== 'discard') {
        return { ok: false, error: 'not your discard turn' };
      }
      if (me.hu) {
        return { ok: false, error: 'already hu' };
      }
      if (me.dingque === null) {
        return { ok: false, error: 'dingque required' };
      }
      const tileId = action.tileId;
      const thing = this.getThing(tileId);
      if (!thing) return { ok: false, error: 'tile not found' };
      if (!thing.slotName.startsWith('hand.') || !thing.slotName.endsWith(`@${seat}`)) {
        return { ok: false, error: 'tile not in hand' };
      }
      const tileKey = this.tileKeyById.get(tileId) ?? null;
      if (tileKey === null) return { ok: false, error: 'unknown tile' };
      const discardSlot = this.pickNextDiscardSlot(seat);
      if (!discardSlot) return { ok: false, error: 'no discard slot' };

      const fromSlotName = thing.slotName;
      const updates: Map<number, ThingInfo> = new Map();
      updates.set(tileId, { ...thing, slotName: discardSlot, rotationIndex: 0, claimedBy: null, shiftSlotName: null });

      // If extra exists and we're discarding from hand.*, merge extra into the freed slot.
      const extraTileId = this.findTileInSlot(`hand.extra@${seat}`);
      if (extraTileId !== null && extraTileId !== tileId && !fromSlotName.startsWith('hand.extra')) {
        const ex = this.getThing(extraTileId);
        if (ex) {
          updates.set(extraTileId, { ...ex, slotName: fromSlotName, rotationIndex: 0, claimedBy: null, shiftSlotName: null });
        }
      }

      // Compute claim options.
      const options = this.computeClaimOptions(state, seat, tileId, tileKey);
      const pendingId = state.nextId;
      const afterGang = (state.afterGangSeat ?? null) === seat;
      const nextState: BloodState = {
        ...state,
        pending: {
          kind: 'claim',
          id: pendingId,
          since: now,
          trigger: 'discard',
          afterGang,
          fromSeat: seat,
          tileId,
          tileKey,
          options,
          responses: { 0: null, 1: null, 2: null, 3: null },
        },
        nextId: pendingId + 1,
        afterGangSeat: afterGang ? null : (state.afterGangSeat ?? null),
      };

      const entries: Array<Entry> = [];
      for (const [id, info] of updates.entries()) {
        entries.push(['things', id, info]);
      }
      entries.push(['tileFacePublic', tileId, tileKey]);
      entries.push(['blood', 0, nextState]);
      this.game.systemUpdate(entries);

      this.logReplay('discard', { seat, tile: tileCode(tileKey) }, null);
      this.tick(now);
      return { ok: true };
    }

    if (action.kind === 'claim') {
      const pending = state.pending;
      if (state.phase !== 'playing' || !pending || pending.kind !== 'claim') {
        return { ok: false, error: 'no pending claim' };
      }
      if (pending.id !== action.pendingId) {
        return { ok: false, error: 'pendingId mismatch' };
      }
      if (seat === pending.fromSeat) {
        return { ok: false, error: 'cannot claim own discard' };
      }
      if (pending.responses[seat] !== null) {
        return { ok: false, error: 'already responded' };
      }
      const opt = pending.options[seat] ?? { hu: false, peng: false, gang: false };
      const a = action.action;
      // Defensive: even if pending.options is stale/corrupted, still enforce wallRemaining>0 for claim 明杠（见 Q9）。
      const canDrawAfterGang = state.wallIndex < state.wallOrder.length;
      const allowed =
        a === 'pass' ||
        (a === 'hu' && opt.hu) ||
        (a === 'peng' && opt.peng) ||
        (a === 'gang' && opt.gang && canDrawAfterGang);
      if (!allowed) {
        return { ok: false, error: 'action not allowed' };
      }

      const nextPending: BloodPendingClaim = { ...pending, responses: { ...pending.responses, [seat]: a } };
      this.setState({ ...state, pending: nextPending }, []);
      this.tick(now);
      return { ok: true };
    }

    if (action.kind === 'kong') {
      if (state.phase !== 'playing' || state.pending !== null || state.turnSeat !== seat || state.turnStep !== 'discard') {
        return { ok: false, error: 'not your turn' };
      }
      if (me.hu) {
        return { ok: false, error: 'already hu' };
      }
      if (me.dingque === null) {
        return { ok: false, error: 'dingque required' };
      }
      if (!Number.isFinite(action.tileKey)) {
        return { ok: false, error: 'invalid tileKey' };
      }
      if (suitOf(action.tileKey) === me.dingque) {
        return { ok: false, error: 'dingque suit not allowed' };
      }
      // Tencent/四川常见口径：暗杠/加杠只能在“摸牌后”的本回合进行；
      // 碰后直接进入弃牌回合（无 hand.extra），此时不允许立刻宣杠。
      const extraTileId = this.findTileInSlot(`hand.extra@${seat}`);
      if (extraTileId === null) {
        return { ok: false, error: 'must draw before kong' };
      }

      if (action.gangType === 'an') {
        const res = this.tryAnGang(state, seat, action.tileKey, now);
        if (!res.ok) return res;
        this.tick(now);
        return { ok: true };
      }
      if (action.gangType === 'add') {
        const res = this.tryAddGang(state, seat, action.tileKey, now);
        if (!res.ok) return res;
        this.tick(now);
        return { ok: true };
      }
      return { ok: false, error: 'invalid gangType' };
    }

    if (action.kind === 'hu') {
      if (action.source !== 'self') {
        return { ok: false, error: 'invalid hu source' };
      }
      const res = this.trySelfHu(state, seat, now);
      if (!res.ok) return res;
      this.tick(now);
      return { ok: true };
    }

    return { ok: false, error: 'unsupported action' };
  }

  tileKeyForId(tileId: number): number | null {
    const key = this.tileKeyById.get(tileId) ?? null;
    return key === null ? null : Math.trunc(key);
  }

  exportSecretState(): { tileKeyById: Array<[number, number]>; pendingDingqueBySeat: Array<[number, BloodSuit]> } {
    const tileKeyById = Array.from(this.tileKeyById.entries())
      .map(([tileId, tileKey]) => [Math.trunc(tileId), Math.trunc(tileKey)] as [number, number])
      .filter(([tileId, tileKey]) => Number.isFinite(tileId) && Number.isFinite(tileKey))
      .sort((a, b) => a[0] - b[0]);
    const pendingDingqueBySeat = [0, 1, 2, 3]
      .map((seat) => {
        const suit = this.pendingDingqueBySeat[seat] ?? null;
        if (!suit) return null;
        return [seat, suit] as [number, BloodSuit];
      })
      .filter((row): row is [number, BloodSuit] => row !== null);
    return { tileKeyById, pendingDingqueBySeat };
  }

  restoreSecretState(raw: any): void {
    const rows = Array.isArray(raw?.tileKeyById) ? raw.tileKeyById : [];
    const next = new Map<number, number>();
    for (const item of rows) {
      if (!Array.isArray(item) || item.length < 2) continue;
      const tileId = Math.trunc(Number(item[0]));
      const tileKey = Math.trunc(Number(item[1]));
      if (!Number.isFinite(tileId) || !Number.isFinite(tileKey)) continue;
      if (tileKey < 0 || tileKey >= 27) continue;
      next.set(tileId, tileKey);
    }
    this.tileKeyById = next;

    const state = this.getState();
    const pending: Record<number, BloodSuit | null> = { 0: null, 1: null, 2: null, 3: null };
    if (state?.phase === 'dingque') {
      const pendingRows = Array.isArray(raw?.pendingDingqueBySeat) ? raw.pendingDingqueBySeat : [];
      for (const item of pendingRows) {
        if (!Array.isArray(item) || item.length < 2) continue;
        const seat = parseSeat(item[0]);
        const suit = item[1];
        if (seat === null) continue;
        if (suit !== 'm' && suit !== 'p' && suit !== 's') continue;
        pending[seat] = suit;
      }
      // 兼容旧快照：若 state 中已有公开花色，则可直接恢复为 pending。
      for (let s = 0; s < 4; s++) {
        if (pending[s] !== null) continue;
        const ps = state.players[s];
        if (!ps || ps.playerId === null || ps.dingqueReady !== true) continue;
        const suit = ps.dingque;
        if (suit === 'm' || suit === 'p' || suit === 's') {
          pending[s] = suit;
        }
      }
    }
    this.pendingDingqueBySeat = pending;

    this.lastTurnKey = null;
    this.turnSince = Date.now();
  }

  // Cloudflare may evict a table between messages. Keep timing and replay identity
  // alongside the concealed tiles so restoring cannot extend a decision window.
  exportCheckpoint() {
    return {
      secret: this.exportSecretState(),
      replaySeq: this.replaySeq, replayMetaLogged: this.replayMetaLogged,
      replayHandsLogged: this.replayHandsLogged, lastTurnKey: this.lastTurnKey,
      turnSince: this.turnSince,
    };
  }

  restoreCheckpoint(saved: ReturnType<BloodEngine['exportCheckpoint']>): void {
    this.restoreSecretState(saved.secret);
    this.replaySeq = saved.replaySeq;
    this.replayMetaLogged = saved.replayMetaLogged;
    this.replayHandsLogged = saved.replayHandsLogged;
    this.lastTurnKey = saved.lastTurnKey;
    this.turnSince = saved.turnSince;
  }

  private ensureMatch(): void {
    if (!isAuthoritativeMode()) return;
    const current = this.game.get('match', 0);
    if (current) return;
    const match = {
      dealer: 0,
      honba: 0,
      roomType: 'friend',
      conditions: {
        gameType: 'BLOOD_BATTLE',
        back: 0,
        fives: '000',
        points: '25',
        dealType: 'HANDS',
      },
      friendConfig: { waitMode: 'noTimeout', timeoutMs: null },
    };
    this.game.systemUpdate([['match', 0, match]]);
  }

  private startGame(now: number): void {
    const seatToPlayer = this.getSeatToPlayer();
    const startBeansBySeat = this.getSeatStartBeans();
    const players: Record<number, BloodPlayerState> = {
      0: emptyPlayer(0, seatToPlayer[0] ?? null),
      1: emptyPlayer(1, seatToPlayer[1] ?? null),
      2: emptyPlayer(2, seatToPlayer[2] ?? null),
      3: emptyPlayer(3, seatToPlayer[3] ?? null),
    };
    for (let seat = 0; seat < 4; seat++) {
      const ps = players[seat];
      if (!ps) continue;
      players[seat] = { ...ps, beans: startBeansBySeat[seat] ?? START_BEANS };
    }

    this.tileKeyById = makeShuffledTileMapping();
    this.clearPendingDingque();

    const swapDirs: Array<BloodSwap3Direction> = ['cw', 'ccw', 'across'];
    const dir = swapDirs[Math.floor(Math.random() * swapDirs.length)] ?? 'cw';

    const state: BloodState = {
      version: 1,
      base: BASE,
      initialBeans: startBeansBySeat[0] ?? START_BEANS,
      initialBeansBySeat: startBeansBySeat,
      phase: 'swap3',
      dealer: 0,
      turnSeat: 0,
      turnStep: 'discard',
      wallOrder: [],
      wallIndex: 0,
      nextId: 1,
      pending: null,
      afterGangSeat: null,
      swap3: {
        dir,
        since: now,
        animatingSince: null,
        selections: { 0: null, 1: null, 2: null, 3: null },
      },
      ledger: [],
      players,
      revealAllHands: false,
      endSummary: undefined,
      settlingSince: null,
    };

    const thingEntries = this.makeInitialDealThings();

    const entries: Array<Entry> = [];
    for (const [tileId, info] of thingEntries.entries()) {
      entries.push(['things', tileId, info]);
    }
    entries.push(['blood', 0, state]);
    this.game.systemUpdate(entries);

    // Replay meta + phase.
    if (!this.replayMetaLogged) {
      this.replayMetaLogged = true;
      this.logReplay('meta', {
        variant: 'xuezhan',
        base: BASE,
        dealer: 0,
        rules: { variant: 'xuezhan', base: BASE },
        seatActors: this.replaySeatActors(),
      }, null);
    }
    this.logReplay('phase', { from: 'dealing', to: 'swap3' }, null);

    // Private initial hands.
    for (let seat = 0; seat < 4; seat++) {
      const pid = players[seat].playerId;
      if (!pid) continue;
      this.sendTileFaceSelfFull(seat, pid);
    }
  }

  private tickSwap3(state: BloodState, now: number): void {
    const swap3 = state.swap3 ?? null;
    if (!swap3) {
      const swapDirs: Array<BloodSwap3Direction> = ['cw', 'ccw', 'across'];
      const dir = swapDirs[Math.floor(Math.random() * swapDirs.length)] ?? 'cw';
      this.setState(
        {
          ...state,
          swap3: {
            dir,
            since: now,
            animatingSince: null,
            selections: { 0: null, 1: null, 2: null, 3: null },
          },
        },
        [],
      );
      return;
    }

    // Animation delay -> advance to dingque.
    if (swap3.animatingSince !== null) {
      if (now - swap3.animatingSince >= SWAP3_ANIM_DELAY_MS) {
        this.transitionPhase(state, 'dingque', { swap3: null, dingqueSince: now }, now);
      }
      return;
    }

    let selections = swap3.selections;
    let changed = false;

    const allPicked = [0, 1, 2, 3].every((s) => Array.isArray(selections[s]) && (selections[s] as Array<number>).length === 3);
    if (!allPicked) return;

    // Execute swap (moves are public but tile faces remain private).
    const destSeat = (from: number): number => {
      if (swap3.dir === 'cw') return (from + 1) % 4;
      if (swap3.dir === 'ccw') return (from + 3) % 4;
      return (from + 2) % 4;
    };

    const handSlotOrder = (slotName: string): number => {
      if (slotName.startsWith('hand.extra')) return 1000;
      const m = /^hand\.(\d+)@(\d)$/.exec(slotName);
      if (!m) return 2000;
      const idx = parseInt(m[1] ?? '', 10);
      return Number.isFinite(idx) ? idx : 2000;
    };

    const outBySeat: Record<number, Array<{ tileId: number; slotName: string }>> = { 0: [], 1: [], 2: [], 3: [] };
    for (let s = 0; s < 4; s++) {
      const ids = selections[s] as Array<number>;
      const items: Array<{ tileId: number; slotName: string }> = [];
      for (const tileId of ids) {
        const info = this.getThing(tileId);
        if (!info) continue;
        items.push({ tileId, slotName: info.slotName });
      }
      items.sort((a, b) => handSlotOrder(a.slotName) - handSlotOrder(b.slotName) || a.tileId - b.tileId);
      outBySeat[s] = items.slice(0, 3);
    }

    const moved: Map<number, ThingInfo> = new Map();
    for (let from = 0; from < 4; from++) {
      const to = destSeat(from);
      const fromTiles = outBySeat[from];
      const toSlots = outBySeat[to].map((x) => x.slotName);
      for (let i = 0; i < 3; i++) {
        const tileId = fromTiles[i]?.tileId ?? null;
        const slotName = toSlots[i] ?? null;
        if (tileId === null || slotName === null) continue;
        const info = this.getThing(tileId);
        if (!info) continue;
        moved.set(tileId, { ...info, slotName, rotationIndex: 0, claimedBy: null, shiftSlotName: null });
      }
    }

    // Replay swap3 exchange (private per seat).
    const outCodes: Record<number, Array<string>> = { 0: [], 1: [], 2: [], 3: [] };
    const inCodes: Record<number, Array<string>> = { 0: [], 1: [], 2: [], 3: [] };
    for (let s = 0; s < 4; s++) {
      outCodes[s] = (outBySeat[s] ?? []).map((x) => tileCode(this.tileKeyById.get(x.tileId)!));
    }
    for (let from = 0; from < 4; from++) {
      const to = destSeat(from);
      inCodes[to] = outCodes[from] ?? [];
    }
    const priv: Record<string, any> = {};
    for (let s = 0; s < 4; s++) {
      priv[String(s)] = { out: outCodes[s] ?? [], in: inCodes[s] ?? [] };
    }
    this.logReplay('swap3', { dir: swap3.dir }, priv);

    const nextState: BloodState = { ...state, swap3: { ...swap3, selections, animatingSince: now } };
    const entries: Array<Entry> = [];
    for (const [id, info] of moved.entries()) entries.push(['things', id, info]);
    entries.push(['blood', 0, nextState]);
    this.game.systemUpdate(entries);

    // Send private reveals for incoming tiles.
    for (let to = 0; to < 4; to++) {
      const pid = state.players[to]?.playerId ?? null;
      if (!pid) continue;
      // Tiles received by `to` are exactly the ones sent out by the unique `from`
      // such that destSeat(from) === to.
      let fromSeat = 0;
      for (let s = 0; s < 4; s++) {
        if (destSeat(s) === to) {
          fromSeat = s;
          break;
        }
      }
      const received = outBySeat[fromSeat]?.map((x) => x.tileId) ?? [];
      this.sendTileFaceSelf(to, pid, received);
    }
  }

  private tickPending(state: BloodState, now: number): void {
    const pending = state.pending;
    if (!pending || pending.kind !== 'claim') return;

    const seatsNeedingResponse: Array<number> = [];
	    for (let s = 0; s < 4; s++) {
	      const opt = pending.options[s];
	      if (opt && (opt.hu || opt.peng || opt.gang)) seatsNeedingResponse.push(s);
	    }
	    const allResponded = seatsNeedingResponse.every((s) => pending.responses[s] !== null);
	    if (!allResponded) return;

    const resp = (s: number) => pending.responses[s] ?? 'pass';
    const respondersPeng = seatsNeedingResponse.filter((s) => resp(s) === 'peng');
    const respondersGang = seatsNeedingResponse.filter((s) => resp(s) === 'gang');
    const respondersHu = seatsNeedingResponse.filter((s) => resp(s) === 'hu');

    if (respondersHu.length > 0) {
      const winners: Array<number> = [];
      for (const s of respondersHu) {
        const ps = state.players[s];
        if (!ps || ps.hu || ps.dingque === null) continue;
        if (suitOf(pending.tileKey) === ps.dingque) continue;
        const countsAll = this.countsForSeat(s);
        if (hasSuit(countsAll, ps.dingque)) continue;
        countsAll[pending.tileKey] += 1;
        if (canHuCounts(countsAll, ps.melds.length)) {
          winners.push(s);
        }
      }
      if (winners.length > 0) {
        const base = state.base;
        const updatedPlayers = { ...state.players };
        const ledgerEntries: Array<BloodLedgerEntry> = [];

        const trigger = pending.trigger ?? 'discard';
        const isQiangGangHu = trigger === 'addKong';
        const isGangShangPao = trigger === 'discard' && Boolean(pending.afterGang);
        const huLabel = isQiangGangHu ? '抢杠胡' : isGangShangPao ? '杠上炮' : '点炮';
        const huEvents: HuEvents = { gangShangPao: isGangShangPao, qiangGangHu: isQiangGangHu };

        for (const w of winners) {
          const wps = state.players[w];
          if (!wps) continue;

          const concealedTiles: Array<number> = [];
          for (const id of this.findHandTileIds(w)) {
            const k = this.tileKeyById.get(id) ?? null;
            if (k !== null) concealedTiles.push(k);
          }
          concealedTiles.push(pending.tileKey);

          const melds = wps.melds.map((m) => ({ kind: m.kind, tileKey: m.tileKey, gangType: m.gangType }));
          const calc = calcBloodHu({ concealedTiles, melds } as HuCalcHand, { base, huMethod: 'dianpao', events: huEvents });
          if (!calc.ok) {
            continue;
          }

          const pay = calc.perOpponent;
          updatedPlayers[pending.fromSeat] = { ...updatedPlayers[pending.fromSeat] };
          updatedPlayers[pending.fromSeat].beans -= pay;
          updatedPlayers[w] = { ...updatedPlayers[w] };
          updatedPlayers[w].beans += pay;
          updatedPlayers[w].hu = true;
          updatedPlayers[w].huTileKey = pending.tileKey;
          updatedPlayers[w].huSource = 'discard';

          const entry: BloodLedgerEntry = {
            kind: 'hu',
            label: huLabel,
            seat: w,
            fromSeat: pending.fromSeat,
            multiplier: calc.multiplierCapped,
            multiplierRaw: calc.multiplierRaw,
            fans: calc.fans.map((f) => ({ id: f.id, name: f.name, multiplier: f.multiplier })),
            transfers: [{ fromSeat: pending.fromSeat, toSeat: w, beans: pay }],
            at: now,
          };
          ledgerEntries.push(entry);
          this.logReplay('ledger', { entry }, null);
        }

        const appliedWinners = ledgerEntries.map((e) => e.transfers[0]!.toSeat);
        if (appliedWinners.length > 0) {
          this.logReplay('hu', { source: 'discard', fromSeat: pending.fromSeat, tile: tileCode(pending.tileKey), winners: [...appliedWinners] }, null);

          // Anchor: farthest winner clockwise from discarder.
          let anchorSeat = appliedWinners[0]!;
          for (let i = 1; i <= 4; i++) {
            const s = (pending.fromSeat + i) % 4;
            if (appliedWinners.includes(s)) anchorSeat = s;
          }
          const nextSeat = this.nextActiveSeat(anchorSeat, updatedPlayers);

          const nextState: BloodState = {
            ...state,
            pending: null,
            players: updatedPlayers,
            ledger: [...(state.ledger ?? []), ...ledgerEntries],
            afterGangSeat: null,
            turnSeat: nextSeat ?? pending.fromSeat,
            turnStep: 'drawOrKong',
          };

          const moveEntries: Array<Entry> = [];
          const takeSlot = this.pickHuTakenSlot();
          const takenInfo = this.getThing(pending.tileId);
	          if (takeSlot && takenInfo) {
	            moveEntries.push([
	              'things',
	              pending.tileId,
	              { ...takenInfo, slotName: takeSlot, rotationIndex: 0, claimedBy: null, shiftSlotName: null },
	            ]);
	          }
	          const shouldFinish = [0, 1, 2, 3].filter((s) => !!updatedPlayers[s]?.hu).length >= 3;
	          moveEntries.push(['blood', 0, nextState]);
	          this.game.systemUpdate(moveEntries);
	          if (shouldFinish) {
	            this.tick(now);
	          }
	          return;
	        }
	      }
	    }

    if (respondersGang.length > 0) {
      let winner: number | null = null;
      for (let i = 1; i <= 4; i++) {
        const s = (pending.fromSeat + i) % 4;
        if (respondersGang.includes(s)) {
          winner = s;
          break;
        }
      }
      if (winner !== null) {
        const res = this.applyMingGang(state, pending, winner, now);
        if (res) return;
      }
    }

    if (respondersPeng.length > 0) {
      let winner: number | null = null;
      for (let i = 1; i <= 4; i++) {
        const s = (pending.fromSeat + i) % 4;
        if (respondersPeng.includes(s)) {
          winner = s;
          break;
        }
      }
      if (winner !== null) {
        const res = this.applyPeng(state, pending, winner, now);
        if (res) return;
      }
    }

    // All pass: next seat draws.
    const trigger = pending.trigger ?? 'discard';
    if (trigger === 'addKong') {
      const seat = pending.fromSeat;
      const ps = state.players[seat];
      if (ps && !ps.hu && ps.dingque !== null && suitOf(pending.tileKey) !== ps.dingque) {
        const peng = ps.melds.find((m) => m.kind === 'peng' && m.tileKey === pending.tileKey) ?? null;
        const info = this.getThing(pending.tileId);
        if (peng && info) {
          const moved: Array<Entry> = [];
          moved.push([
            'things',
            pending.tileId,
            { ...info, slotName: `meld.${peng.row}.3@${seat}`, rotationIndex: 2, claimedBy: null, shiftSlotName: null },
          ]);
          moved.push(['tileFacePublic', pending.tileId, pending.tileKey]);

          this.moveExtraToHandIfNeeded(seat, moved);

          const base = state.base;
          const perPay = base;
          const updatedPlayers = { ...state.players };
          updatedPlayers[seat] = { ...updatedPlayers[seat] };
          const transfers: Array<BloodLedgerTransfer> = [];
          let totalGain = 0;
          for (let s = 0; s < 4; s++) {
            if (s === seat) continue;
            const other = updatedPlayers[s];
            if (!other || other.hu || other.playerId === null) continue;
            updatedPlayers[s] = { ...other, beans: other.beans - perPay };
            totalGain += perPay;
            transfers.push({ fromSeat: s, toSeat: seat, beans: perPay });
          }
          updatedPlayers[seat].beans += totalGain;
          updatedPlayers[seat].kongGain += totalGain;
          updatedPlayers[seat].melds = updatedPlayers[seat].melds.map((m) => (m === peng ? { ...m, kind: 'gang', gangType: 'add' } : m));

          const ledgerEntry: BloodLedgerEntry = { kind: 'kong', label: '加杠', multiplier: 1, transfers, at: now };
          this.logReplay('gang', { seat, gangType: 'add', fromSeat: peng.fromSeat, tile: tileCode(pending.tileKey) }, null);
          this.logReplay('ledger', { entry: ledgerEntry }, null);

          const nextState: BloodState = {
            ...state,
            pending: null,
            players: updatedPlayers,
            ledger: [...(state.ledger ?? []), ledgerEntry],
            afterGangSeat: seat,
            // 加杠后补张，继续由杠家行动
            turnSeat: seat,
            turnStep: 'drawOrKong',
          };
          moved.push(['blood', 0, nextState]);
          this.game.systemUpdate(moved);
          return;
        }
      }
    }

    const nextSeat = this.nextActiveSeat(pending.fromSeat, state.players);
    if (nextSeat !== null) {
      this.setState({ ...state, pending: null, turnSeat: nextSeat, turnStep: 'drawOrKong' }, []);
    }
  }

  private applyPeng(state: BloodState, pending: BloodPendingClaim, winner: number, now: number): boolean {
    const ps = state.players[winner];
    if (!ps || ps.hu || ps.dingque === null) return false;
    if (suitOf(pending.tileKey) === ps.dingque) return false;
    const takeFromHand = this.findHandTilesByKey(winner, pending.tileKey).slice(0, 2);
    if (takeFromHand.length < 2) return false;

    const row = this.pickMeldRow(ps);
    if (row === null) return false;

    const targetSlots = [`meld.${row}.0@${winner}`, `meld.${row}.1@${winner}`, `meld.${row}.2@${winner}`];
    const relFrom = ((pending.fromSeat - winner) % 4 + 4) % 4; // 1=右,2=对,3=左
    const [slot0, slot1, slot2] = targetSlots;
    const calledSlot = relFrom === 3 ? slot2 : relFrom === 2 ? slot1 : slot0;
    const otherSlots: [string, string] = relFrom === 3 ? [slot0, slot1] : relFrom === 2 ? [slot0, slot2] : [slot1, slot2];

    const moved: Array<Entry> = [];
    const calledInfo = this.getThing(pending.tileId);
    const a = this.getThing(takeFromHand[0]);
    const b = this.getThing(takeFromHand[1]);
    if (!calledInfo || !a || !b) return false;

    moved.push(['things', pending.tileId, { ...calledInfo, slotName: calledSlot, rotationIndex: 1, claimedBy: null, shiftSlotName: null }]);
    moved.push(['things', takeFromHand[0], { ...a, slotName: otherSlots[0], rotationIndex: 0, claimedBy: null, shiftSlotName: null }]);
    moved.push(['things', takeFromHand[1], { ...b, slotName: otherSlots[1], rotationIndex: 0, claimedBy: null, shiftSlotName: null }]);

    // Reveal all 3 tiles.
    moved.push(['tileFacePublic', pending.tileId, pending.tileKey]);
    moved.push(['tileFacePublic', takeFromHand[0], pending.tileKey]);
    moved.push(['tileFacePublic', takeFromHand[1], pending.tileKey]);

    const updatedPlayers: Record<number, BloodPlayerState> = { ...state.players };
    updatedPlayers[winner] = {
      ...ps,
      melds: [...ps.melds, { kind: 'peng', tileKey: pending.tileKey, fromSeat: pending.fromSeat, row }],
    };
    const nextState: BloodState = { ...state, pending: null, players: updatedPlayers, turnSeat: winner, turnStep: 'discard' };
    moved.push(['blood', 0, nextState]);
    this.game.systemUpdate(moved);
    this.logReplay('peng', { seat: winner, fromSeat: pending.fromSeat, tile: tileCode(pending.tileKey) }, null);
    return true;
  }

  private applyMingGang(state: BloodState, pending: BloodPendingClaim, winner: number, now: number): boolean {
    // 血战规则：明杠后必须能补张；墙剩 0 时不允许明杠（全链路一致，见 Q9）。
    if (state.wallIndex >= state.wallOrder.length) return false;
    const ps = state.players[winner];
    if (!ps || ps.hu || ps.dingque === null) return false;
    if (suitOf(pending.tileKey) === ps.dingque) return false;
    const takeFromHand = this.findHandTilesByKey(winner, pending.tileKey).slice(0, 3);
    if (takeFromHand.length < 3) return false;

    const row = this.pickMeldRow(ps);
    if (row === null) return false;
    const targetSlots = [`meld.${row}.0@${winner}`, `meld.${row}.1@${winner}`, `meld.${row}.2@${winner}`, `meld.${row}.3@${winner}`];

    const relFrom = ((pending.fromSeat - winner) % 4 + 4) % 4; // 1=右,2=对,3=左
    const [slot0, slot1, slot2, slot3] = targetSlots;
    const calledSlot = relFrom === 3 ? slot2 : relFrom === 2 ? slot1 : slot0;
    const otherSlots: [string, string, string] =
      relFrom === 3 ? [slot0, slot1, slot3] : relFrom === 2 ? [slot0, slot2, slot3] : [slot1, slot2, slot3];

    const moved: Array<Entry> = [];
    const calledInfo = this.getThing(pending.tileId);
    const a = this.getThing(takeFromHand[0]);
    const b = this.getThing(takeFromHand[1]);
    const c = this.getThing(takeFromHand[2]);
    if (!calledInfo || !a || !b || !c) return false;

    moved.push(['things', pending.tileId, { ...calledInfo, slotName: calledSlot, rotationIndex: 1, claimedBy: null, shiftSlotName: null }]);
    moved.push(['things', takeFromHand[0], { ...a, slotName: otherSlots[0], rotationIndex: 0, claimedBy: null, shiftSlotName: null }]);
    moved.push(['things', takeFromHand[1], { ...b, slotName: otherSlots[1], rotationIndex: 0, claimedBy: null, shiftSlotName: null }]);
    moved.push(['things', takeFromHand[2], { ...c, slotName: otherSlots[2], rotationIndex: 0, claimedBy: null, shiftSlotName: null }]);

    // Reveal all 4 tiles.
    moved.push(['tileFacePublic', pending.tileId, pending.tileKey]);
    moved.push(['tileFacePublic', takeFromHand[0], pending.tileKey]);
    moved.push(['tileFacePublic', takeFromHand[1], pending.tileKey]);
    moved.push(['tileFacePublic', takeFromHand[2], pending.tileKey]);

    const gain = state.base * 2;
    const updatedPlayers = { ...state.players };
    updatedPlayers[winner] = { ...ps };
    updatedPlayers[pending.fromSeat] = { ...updatedPlayers[pending.fromSeat] };
    updatedPlayers[winner].melds = [...updatedPlayers[winner].melds, { kind: 'gang', tileKey: pending.tileKey, fromSeat: pending.fromSeat, gangType: 'ming', row }];
    updatedPlayers[winner].beans += gain;
    updatedPlayers[winner].kongGain += gain;
    updatedPlayers[pending.fromSeat].beans -= gain;

    const ledgerEntry: BloodLedgerEntry = {
      kind: 'kong',
      label: '明杠',
      multiplier: 2,
      transfers: [{ fromSeat: pending.fromSeat, toSeat: winner, beans: gain }],
      at: now,
    };
    this.logReplay('gang', { seat: winner, gangType: 'ming', fromSeat: pending.fromSeat, tile: tileCode(pending.tileKey) }, null);
    this.logReplay('ledger', { entry: ledgerEntry }, null);

    const nextState: BloodState = {
      ...state,
      pending: null,
      players: updatedPlayers,
      ledger: [...(state.ledger ?? []), ledgerEntry],
      afterGangSeat: winner,
      turnSeat: winner,
      turnStep: 'drawOrKong',
    };
    moved.push(['blood', 0, nextState]);
    this.game.systemUpdate(moved);
    return true;
  }

  private tryAutoDraw(state: BloodState, now: number): boolean {
    const seat = state.turnSeat;
    const ps = state.players[seat];
    if (!ps || ps.hu || ps.playerId === null) {
      const nextSeat = this.nextActiveSeat(seat, state.players);
      if (nextSeat !== null) {
        this.setState({ ...state, turnSeat: nextSeat, turnStep: 'drawOrKong' }, []);
        return true;
      }
      return false;
    }

    const extraSlot = `hand.extra@${seat}`;
    const extraTileId = this.findTileInSlot(extraSlot);
    if (extraTileId !== null) {
      // Already has extra: shouldn't happen, but avoid slot conflicts.
      this.setState({ ...state, turnStep: 'discard' }, []);
      return true;
    }

    if (state.wallIndex >= state.wallOrder.length) {
      return false;
    }
    const tileId = state.wallOrder[state.wallIndex]!;
    const info = this.getThing(tileId);
    if (!info || !info.slotName.startsWith('wall.')) {
      // Skip invalid wall entries.
      this.setState({ ...state, wallIndex: state.wallIndex + 1 }, []);
      return true;
    }

    const moved: ThingInfo = { ...info, slotName: extraSlot, rotationIndex: 0, claimedBy: null, shiftSlotName: null };
    const nextState: BloodState = { ...state, wallIndex: state.wallIndex + 1, turnStep: 'discard' };
    this.game.systemUpdate([
      ['things', tileId, moved],
      ['blood', 0, nextState],
    ]);

    const tileKey = this.tileKeyById.get(tileId) ?? null;
    if (tileKey !== null) {
      this.logReplay('draw', { seat }, { [String(seat)]: { tile: tileCode(tileKey) } });
      this.sendTileFaceSelf(seat, ps.playerId, [tileId]);
    } else {
      this.logReplay('draw', { seat }, null);
    }
    return true;
  }

  private trySelfHu(state: BloodState, seat: number, now: number): { ok: true } | { ok: false; error: string } {
    const ps = state.players[seat];
    if (!ps || ps.hu || ps.dingque === null) {
      return { ok: false, error: 'cannot hu' };
    }
    if (state.phase !== 'playing' || state.pending !== null || state.turnSeat !== seat || state.turnStep !== 'discard') {
      return { ok: false, error: 'not your turn' };
    }
    const extraTileId = this.findTileInSlot(`hand.extra@${seat}`);
    if (extraTileId === null) {
      return { ok: false, error: 'no drawn tile' };
    }

    const counts = this.countsForSeat(seat);
    if (hasSuit(counts, ps.dingque)) {
      return { ok: false, error: 'has dingque suit' };
    }
    if (!canHuCounts(counts, ps.melds.length)) {
      return { ok: false, error: 'not a winning hand' };
    }

    const concealedTiles: Array<number> = [];
    for (const id of this.findHandTileIds(seat)) {
      const k = this.tileKeyById.get(id) ?? null;
      if (k !== null) concealedTiles.push(k);
    }
    const melds = ps.melds.map((m) => ({ kind: m.kind, tileKey: m.tileKey, gangType: m.gangType }));

    const payers: Array<number> = [];
    for (let s = 0; s < 4; s++) {
      if (s === seat) continue;
      const other = state.players[s];
      if (!other || other.hu || other.playerId === null) continue;
      payers.push(s);
    }

    const base = state.base;
    const gangShangKaiHua = (state.afterGangSeat ?? null) === seat;
    const events: HuEvents = {
      gangShangKaiHua,
      // 海底：摸到最后一张牌后自摸胡（wallOrder 为空时不视为海底，避免初始化阶段误判）
      haiDi: state.wallOrder.length > 0 && state.wallIndex >= state.wallOrder.length,
    };
    const calc = calcBloodHu(
      { concealedTiles, melds } as HuCalcHand,
      { base, huMethod: 'zimo', remainingOpponents: payers.length, events },
    );
    if (!calc.ok) {
      return { ok: false, error: `calc failed: ${calc.errors.join('; ')}` };
    }
    const perPay = calc.perOpponent;
    const updatedPlayers = { ...state.players };
    updatedPlayers[seat] = { ...updatedPlayers[seat] };

    const transfers: Array<BloodLedgerTransfer> = [];
    let gain = 0;
    for (const s of payers) {
      const other = updatedPlayers[s]!;
      updatedPlayers[s] = { ...other, beans: other.beans - perPay };
      gain += perPay;
      transfers.push({ fromSeat: s, toSeat: seat, beans: perPay });
    }
    updatedPlayers[seat].beans += gain;
    updatedPlayers[seat].hu = true;

    const huTileKey = this.tileKeyById.get(extraTileId) ?? null;
    updatedPlayers[seat].huTileKey = huTileKey;
    updatedPlayers[seat].huSource = 'self';

    const nextSeat = this.nextActiveSeat(seat, updatedPlayers);
    const ledgerEntry: BloodLedgerEntry = {
      kind: 'hu',
      label: '自摸',
      seat,
      multiplier: calc.multiplierCapped,
      multiplierRaw: calc.multiplierRaw,
      fans: calc.fans.map((f) => ({ id: f.id, name: f.name, multiplier: f.multiplier })),
      transfers,
      at: now,
    };
    this.logReplay('hu', { source: 'self', seat, tile: huTileKey === null ? null : tileCode(huTileKey) }, null);
    this.logReplay('ledger', { entry: ledgerEntry }, null);

    const nextState: BloodState = {
      ...state,
      players: updatedPlayers,
      ledger: [...(state.ledger ?? []), ledgerEntry],
      pending: null,
      afterGangSeat: null,
      turnSeat: nextSeat ?? seat,
      turnStep: 'drawOrKong',
    };
    this.setState(nextState, []);
    return { ok: true };
  }

  private tryAnGang(state: BloodState, seat: number, tileKey: number, now: number): { ok: true } | { ok: false; error: string } {
    const ps = state.players[seat];
    if (!ps) return { ok: false, error: 'no player' };
    const tiles = this.findHandTilesByKey(seat, tileKey).slice(0, 4);
    if (tiles.length < 4) return { ok: false, error: 'need 4 tiles' };
    const row = this.pickMeldRow(ps);
    if (row === null) return { ok: false, error: 'no meld row' };

    const targets = [`meld.${row}.0@${seat}`, `meld.${row}.1@${seat}`, `meld.${row}.2@${seat}`, `meld.${row}.3@${seat}`];
    const rotations = [2, 0, 0, 2];
    const moved: Array<Entry> = [];
    for (let i = 0; i < 4; i++) {
      const id = tiles[i]!;
      const info = this.getThing(id);
      if (!info) return { ok: false, error: 'tile not found' };
      moved.push(['things', id, { ...info, slotName: targets[i]!, rotationIndex: rotations[i]!, claimedBy: null, shiftSlotName: null }]);
      moved.push(['tileFacePublic', id, tileKey]);
    }

    // Ensure extra is free for补张.
    this.moveExtraToHandIfNeeded(seat, moved);

    const base = state.base;
    const perPay = base * 2;
    const updatedPlayers = { ...state.players };
    updatedPlayers[seat] = { ...updatedPlayers[seat] };
    const transfers: Array<BloodLedgerTransfer> = [];
    let totalGain = 0;
    for (let s = 0; s < 4; s++) {
      if (s === seat) continue;
      const other = updatedPlayers[s];
      if (!other || other.hu || other.playerId === null) continue;
      updatedPlayers[s] = { ...other, beans: other.beans - perPay };
      totalGain += perPay;
      transfers.push({ fromSeat: s, toSeat: seat, beans: perPay });
    }
    updatedPlayers[seat].beans += totalGain;
    updatedPlayers[seat].kongGain += totalGain;
    updatedPlayers[seat].melds = [...updatedPlayers[seat].melds, { kind: 'gang', tileKey, fromSeat: null, gangType: 'an', row }];

    const ledgerEntry: BloodLedgerEntry = { kind: 'kong', label: '暗杠', multiplier: 2, transfers, at: now };
    this.logReplay('gang', { seat, gangType: 'an', fromSeat: null, tile: tileCode(tileKey) }, null);
    this.logReplay('ledger', { entry: ledgerEntry }, null);

    const nextState: BloodState = {
      ...state,
      players: updatedPlayers,
      ledger: [...(state.ledger ?? []), ledgerEntry],
      afterGangSeat: seat,
      turnStep: 'drawOrKong',
    };
    moved.push(['blood', 0, nextState]);
    this.game.systemUpdate(moved);
    return { ok: true };
  }

  private tryAddGang(state: BloodState, seat: number, tileKey: number, now: number): { ok: true } | { ok: false; error: string } {
    const ps = state.players[seat];
    if (!ps) return { ok: false, error: 'no player' };
    const peng = ps.melds.find((m) => m.kind === 'peng' && m.tileKey === tileKey) ?? null;
    if (!peng) return { ok: false, error: 'no peng' };
    // Prefer using extra tile for add-kong (common case: draw the 4th tile).
    const extraTileId = this.findTileInSlot(`hand.extra@${seat}`);
    const canUseExtra = extraTileId !== null && (this.tileKeyById.get(extraTileId) ?? null) === tileKey;
    const tiles = this.findHandTilesByKey(seat, tileKey);
    const id = canUseExtra ? (extraTileId as number) : tiles[0] ?? null;
    if (id === null) return { ok: false, error: 'missing tile' };

    // Check rob-kong hu candidates (抢杠胡)：若存在则进入 pending 给其他家“胡”窗口。
    const robOptions: Record<number, { hu: boolean; peng: boolean; gang: boolean }> = {
      0: { hu: false, peng: false, gang: false },
      1: { hu: false, peng: false, gang: false },
      2: { hu: false, peng: false, gang: false },
      3: { hu: false, peng: false, gang: false },
    };
    let anyRobHu = false;
    for (let s = 0; s < 4; s++) {
      if (s === seat) continue;
      const other = state.players[s];
      if (!other || other.hu || other.playerId === null) continue;
      if (other.dingque === null) continue;
      if (suitOf(tileKey) === other.dingque) continue;
      const canHu = (() => {
        const countsAll = this.countsForSeat(s);
        if (hasSuit(countsAll, other.dingque!)) return false;
        countsAll[tileKey] += 1;
        return canHuCounts(countsAll, other.melds.length);
      })();
      robOptions[s] = { hu: canHu, peng: false, gang: false };
      if (canHu) anyRobHu = true;
    }

    if (anyRobHu) {
      const pendingId = state.nextId;
      const nextState: BloodState = {
        ...state,
        pending: {
          kind: 'claim',
          id: pendingId,
          since: now,
          trigger: 'addKong',
          fromSeat: seat,
          tileId: id,
          tileKey,
          options: robOptions,
          responses: { 0: null, 1: null, 2: null, 3: null },
        },
        nextId: pendingId + 1,
      };
      this.logReplay('gang', { seat, gangType: 'add', fromSeat: peng.fromSeat, tile: tileCode(tileKey), pending: true }, null);
      this.setState(nextState, []);
      return { ok: true };
    }

    const info = this.getThing(id);
    if (!info) return { ok: false, error: 'tile not found' };
    const moved: Array<Entry> = [];
    moved.push(['things', id, { ...info, slotName: `meld.${peng.row}.3@${seat}`, rotationIndex: 2, claimedBy: null, shiftSlotName: null }]);
    moved.push(['tileFacePublic', id, tileKey]);

    this.moveExtraToHandIfNeeded(seat, moved);

    const base = state.base;
    const perPay = base;
    const updatedPlayers = { ...state.players };
    updatedPlayers[seat] = { ...updatedPlayers[seat] };
    const transfers: Array<BloodLedgerTransfer> = [];
    let totalGain = 0;
    for (let s = 0; s < 4; s++) {
      if (s === seat) continue;
      const other = updatedPlayers[s];
      if (!other || other.hu || other.playerId === null) continue;
      updatedPlayers[s] = { ...other, beans: other.beans - perPay };
      totalGain += perPay;
      transfers.push({ fromSeat: s, toSeat: seat, beans: perPay });
    }
    updatedPlayers[seat].beans += totalGain;
    updatedPlayers[seat].kongGain += totalGain;
    updatedPlayers[seat].melds = updatedPlayers[seat].melds.map((m) => (m === peng ? { ...m, kind: 'gang', gangType: 'add' } : m));

    const ledgerEntry: BloodLedgerEntry = { kind: 'kong', label: '加杠', multiplier: 1, transfers, at: now };
    this.logReplay('gang', { seat, gangType: 'add', fromSeat: peng.fromSeat, tile: tileCode(tileKey) }, null);
    this.logReplay('ledger', { entry: ledgerEntry }, null);

    const nextState: BloodState = {
      ...state,
      players: updatedPlayers,
      ledger: [...(state.ledger ?? []), ledgerEntry],
      afterGangSeat: seat,
      turnStep: 'drawOrKong',
    };
    moved.push(['blood', 0, nextState]);
    this.game.systemUpdate(moved);
    return { ok: true };
  }

  private moveExtraToHandIfNeeded(seat: number, movedEntries: Array<Entry>): void {
    const extraTileId = this.findTileInSlot(`hand.extra@${seat}`);
    if (extraTileId === null) return;
    // If already moved, no-op.
    if (movedEntries.some((e) => e[0] === 'things' && Number(e[1]) === extraTileId)) return;
    const target = this.findEmptyHandSlot(seat);
    if (!target) return;
    const info = this.getThing(extraTileId);
    if (!info) return;
    movedEntries.push(['things', extraTileId, { ...info, slotName: target, rotationIndex: 0, claimedBy: null, shiftSlotName: null }]);
  }

  private setState(state: BloodState, extraEntries: Array<Entry>): void {
    const entries: Array<Entry> = [...extraEntries, ['blood', 0, state]];
    this.game.systemUpdate(entries);

    // Replay: hands snapshot once playing starts.
    if (!this.replayHandsLogged && state.phase === 'playing') {
      this.replayHandsLogged = true;
      const priv: Record<string, any> = {};
      for (let s = 0; s < 4; s++) {
        if (state.players[s]?.playerId === null) continue;
        priv[String(s)] = { hand: this.handCodesForSeat(s) };
      }
      this.logReplay('hands', { phase: 'playing' }, priv);
    }

    if (state.phase === 'done') {
      const beans: Record<string, number> = {};
      for (let s = 0; s < 4; s++) {
        const b = state.players[s]?.beans ?? null;
        if (typeof b === 'number' && Number.isFinite(b)) beans[String(s)] = Math.trunc(b);
      }
      this.logReplay('end', { beans, seatActors: this.replaySeatActors() }, null);
    }
  }

  private transitionPhase(
    prev: BloodState,
    nextPhase: BloodState['phase'],
    patch: Partial<BloodState>,
    now: number,
  ): void {
    if (prev.phase === nextPhase) return;
    const next: BloodState = { ...prev, ...patch, phase: nextPhase };
    this.setState(next, []);
    this.logReplay('phase', { from: prev.phase, to: nextPhase }, null);
  }

  private getState(): BloodState | null {
    const state = this.game.get('blood', 0);
    return state ? (state as BloodState) : null;
  }

  private getThing(tileId: number): ThingInfo | null {
    const info = this.game.get('things', tileId);
    return info ? (info as ThingInfo) : null;
  }

  private getSeatToPlayer(): Array<string | null> {
    const seatToPlayer: Array<string | null> = [null, null, null, null];
    for (const [playerId, raw] of this.game.entries('seats')) {
      const seat = parseSeat((raw as SeatInfo | null)?.seat ?? null);
      if (seat === null) continue;
      seatToPlayer[seat] = String(playerId);
    }
    return seatToPlayer;
  }

  private getSeatStartBeans(): Record<number, number> {
    const bySeat: Record<number, number> = {
      0: START_BEANS,
      1: START_BEANS,
      2: START_BEANS,
      3: START_BEANS,
    };
    for (const [, raw] of this.game.entries('seats')) {
      const seatInfo = raw as SeatInfo | null;
      const seat = parseSeat(seatInfo?.seat ?? null);
      if (seat === null) continue;
      const hasStartBeans = !!seatInfo && Object.prototype.hasOwnProperty.call(seatInfo, 'startBeans');
      if (hasStartBeans) {
        bySeat[seat] = sanitizeBeans(seatInfo?.startBeans ?? START_BEANS);
      } else {
        bySeat[seat] = LEGACY_START_BEANS;
      }
    }
    return bySeat;
  }

  private makeInitialDealThings(): Map<number, ThingInfo> {
    const out: Map<number, ThingInfo> = new Map();
    const allTileIds = Array.from({ length: 108 }, (_, i) => i);
    // Shuffle physical tile placement to break any inference from tileId.
    shuffleInPlace(allTileIds);

    let idx = 0;
    const take = (): number => allTileIds[idx++]!;

    // Hands: 13 each, dealer has 1 extra.
    for (let seat = 0; seat < 4; seat++) {
      for (let i = 0; i < 13; i++) {
        out.set(take(), emptyThing(`hand.${i}@${seat}`));
      }
    }
    out.set(take(), emptyThing(`hand.extra@0`));

    // Wall: remaining 55 tiles -> wall.0.0.. for seat0 (38) then seat1 (17)
    const wall0 = wallSlots(0);
    for (let i = 0; i < 38; i++) {
      out.set(take(), emptyThing(wall0[i]!));
    }
    const wall1 = wallSlots(1);
    for (let i = 0; i < 17; i++) {
      out.set(take(), emptyThing(wall1[i]!));
    }

    // Any leftovers (shouldn't happen) -> remaining wall slots for seat2/3.
    while (idx < allTileIds.length) {
      const tid = take();
      out.set(tid, emptyThing(`wall.0.0@2`));
    }

    return out;
  }

  private computeWallOrder(): Array<number> {
    const tiles: Array<{ tileId: number; seat: number; col: number; stack: number }> = [];
    for (const [rawId, raw] of this.game.entries('things')) {
      const tileId = Math.trunc(rawId as number);
      if (!Number.isFinite(tileId)) continue;
      const slot = (raw as any)?.slotName;
      const m = /^wall\.(\d+)\.(\d+)@(\d)$/.exec(String(slot));
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

  private computeClaimOptions(state: BloodState, fromSeat: number, tileId: number, tileKey: number): Record<number, { hu: boolean; peng: boolean; gang: boolean }> {
    const options: Record<number, { hu: boolean; peng: boolean; gang: boolean }> = {
      0: { hu: false, peng: false, gang: false },
      1: { hu: false, peng: false, gang: false },
      2: { hu: false, peng: false, gang: false },
      3: { hu: false, peng: false, gang: false },
    };
    // 血战规则：明杠后必须能补张；墙剩 0 时不允许 claim 明杠（全链路一致，见 docs/归档/拆牌-Claim响应动作推荐-20260315.md Q9）。
    const canDrawAfterGang = state.wallIndex < state.wallOrder.length;

    const counts: Array<number> = [0, 0, 0, 0];
    for (let s = 0; s < 4; s++) {
      counts[s] = this.findHandTilesByKey(s, tileKey).length;
    }

    for (let s = 0; s < 4; s++) {
      if (s === fromSeat) continue;
      const ps = state.players[s];
      if (!ps || ps.hu) continue;
      if (ps.dingque === null) continue;
      if (suitOf(tileKey) === ps.dingque) continue;

      const canHu = (() => {
        const countsAll = this.countsForSeat(s);
        if (hasSuit(countsAll, ps.dingque!)) return false;
        countsAll[tileKey] += 1;
        return canHuCounts(countsAll, ps.melds.length);
      })();
      options[s] = { hu: canHu, peng: counts[s] >= 2, gang: canDrawAfterGang && counts[s] >= 3 };
    }

    return options;
  }

  private countsForSeat(seat: number): number[] {
    const counts = new Array(27).fill(0);
    for (const tileId of this.findHandTileIds(seat)) {
      const k = this.tileKeyById.get(tileId);
      if (k === undefined) continue;
      counts[k] += 1;
    }
    return counts;
  }

  private findHandTileIds(seat: number): Array<number> {
    const out: Array<number> = [];
    for (const [rawId, raw] of this.game.entries('things')) {
      const tileId = Math.trunc(rawId as number);
      const info = raw as ThingInfo;
      if (!info?.slotName) continue;
      if (info.slotName.startsWith('hand.') && info.slotName.endsWith(`@${seat}`)) {
        out.push(tileId);
      }
    }
    return out;
  }

  private findHandTilesByKey(seat: number, tileKey: number): Array<number> {
    const out: Array<number> = [];
    for (const id of this.findHandTileIds(seat)) {
      if (this.tileKeyById.get(id) === tileKey) out.push(id);
    }
    out.sort((a, b) => a - b);
    return out;
  }

  private nextActiveSeat(fromSeat: number, players: Record<number, BloodPlayerState>): number | null {
    for (let i = 1; i <= 4; i++) {
      const s = (fromSeat + i) % 4;
      const ps = players[s];
      if (ps && !ps.hu && ps.playerId !== null) return s;
    }
    return null;
  }

  private pickMeldRow(ps: BloodPlayerState): number | null {
    const used = new Set<number>(ps.melds.map((m) => m.row));
    let row = 0;
    while (used.has(row) && row < 4) row++;
    return row < 4 ? row : null;
  }

  private pickNextDiscardSlot(seat: number): string | null {
    const used = new Set<string>();
    for (const [, raw] of this.game.entries('things')) {
      const name = (raw as ThingInfo)?.slotName;
      if (typeof name === 'string') used.add(name);
    }
    for (const name of discardSlots(seat)) {
      if (!used.has(name)) return name;
    }
    return null;
  }

  private pickHuTakenSlot(): string | null {
    const used = new Set<string>();
    for (const [, raw] of this.game.entries('things')) {
      const name = (raw as ThingInfo)?.slotName;
      if (typeof name === 'string') used.add(name);
    }
    for (let i = 0; i < 16; i++) {
      const name = `hu.taken.${i}`;
      if (!used.has(name)) return name;
    }
    return null;
  }

  private findTileInSlot(slotName: string): number | null {
    for (const [rawId, raw] of this.game.entries('things')) {
      const info = raw as ThingInfo;
      if (info?.slotName === slotName) {
        return Math.trunc(rawId as number);
      }
    }
    return null;
  }

  private findEmptyHandSlot(seat: number): string | null {
    const occupied = new Set<string>();
    for (const [, raw] of this.game.entries('things')) {
      const name = (raw as ThingInfo)?.slotName;
      if (typeof name === 'string' && name.startsWith('hand.') && name.endsWith(`@${seat}`) && !name.startsWith('hand.extra')) {
        occupied.add(name);
      }
    }
    for (let i = 0; i < 14; i++) {
      const slot = `hand.${i}@${seat}`;
      if (!occupied.has(slot)) return slot;
    }
    return null;
  }

  private pickRandomDiscardTile(seat: number): number | null {
    const candidates = this.findHandTileIds(seat);
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
  }

  private pickSwap3TimeoutTiles(seat: number): Array<number> | null {
    const hand = this.findHandTileIds(seat);
    const bySuit: Record<BloodSuit, Array<number>> = { m: [], p: [], s: [] };
    for (const id of hand) {
      const k = this.tileKeyById.get(id);
      if (k === undefined) continue;
      bySuit[suitOf(k)].push(id);
    }
    const suits: Array<BloodSuit> = ['m', 'p', 's'];
    for (const s of suits) {
      if (bySuit[s].length >= 3) {
        bySuit[s].sort((a, b) => a - b);
        return bySuit[s].slice(0, 3);
      }
    }
    return null;
  }

  private sendTileFaceSelfFull(seat: number, playerId: string): void {
    const entries: Array<Entry> = [];
    for (const tileId of this.findHandTileIds(seat)) {
      const key = this.tileKeyById.get(tileId) ?? null;
      if (key === null) continue;
      entries.push(['tileFaceSelf', tileId, key]);
    }
    // NOTE: `UPDATE.full` means "full snapshot of the entire game state" in the existing
    // protocol; sending `full=true` with only tileFaceSelf would wipe other client collections.
    this.game.sendToPlayer(playerId, { type: 'UPDATE', entries, full: false } as Message);
  }

  /**
   * Builds the private tile-face overlay for a read-only DSH observer.
   * A full overlay is valid only for an all-AI table; callers enforce that policy.
   */
  dshObserverTileFaceEntries(viewerSeat: number | null, full: boolean): Array<Entry> {
    const allowedTileIds = full
      ? new Set<number>(this.tileKeyById.keys())
      : new Set<number>(viewerSeat === null ? [] : this.findHandTileIds(viewerSeat));
    const entries: Array<Entry> = [];
    for (const tileId of Array.from(allowedTileIds.values()).sort((left, right) => left - right)) {
      const tileKey = this.tileKeyById.get(tileId) ?? null;
      if (tileKey === null) continue;
      entries.push(['tileFaceSelf', tileId, tileKey]);
    }
    return entries;
  }

  private sendTileFaceSelf(seat: number, playerId: string, tileIds: Array<number>): void {
    const entries: Array<Entry> = [];
    for (const tileId of tileIds) {
      const key = this.tileKeyById.get(tileId) ?? null;
      if (key === null) continue;
      entries.push(['tileFaceSelf', tileId, key]);
    }
    if (entries.length > 0) {
      this.game.sendToPlayer(playerId, { type: 'UPDATE', entries, full: false } as Message);
    }
  }

  private handCodesForSeat(seat: number): Array<string> {
    const items: Array<{ order: number; slotName: string; code: string }> = [];
    for (const tileId of this.findHandTileIds(seat)) {
      const info = this.getThing(tileId);
      const k = this.tileKeyById.get(tileId) ?? null;
      if (!info || k === null) continue;
      const slotName = info.slotName;
      const m = /^hand\.(\d+)@/.exec(slotName);
      const order = slotName.startsWith('hand.extra') ? 1000 : m ? parseInt(m[1] ?? '999', 10) : 999;
      items.push({ order, slotName, code: tileCode(k) });
    }
    items.sort((a, b) => a.order - b.order || a.slotName.localeCompare(b.slotName));
    return items.map((x) => x.code);
  }

  private makeRevealAllEntries(): Array<Entry> {
    const entries: Array<Entry> = [];
    for (const [tileId, tileKey] of this.tileKeyById.entries()) {
      entries.push(['tileFacePublic', tileId, tileKey]);
    }
    return entries;
  }

  private makeTurnKey(state: BloodState): string {
    const pendingId = state.pending?.kind === 'claim' ? state.pending.id : 'none';
    return `${state.phase}:${state.turnSeat}:${state.turnStep}:${pendingId}:${state.wallIndex}`;
  }

  recordAiDecisionResolution(params: {
    seat: number;
    scene: AiScene;
    modelId: string;
    modelLabel: string;
    decisionId: string;
    source: 'agent' | 'timeout_top1';
    elapsedMs: number;
    legalActionId: string | null;
    actionKind: string;
    actionLabel: string;
    privateActionLabel: string;
  }): void {
    const shared = {
      seat: Math.trunc(params.seat),
      scene: params.scene,
      modelId: String(params.modelId ?? '').trim(),
      modelLabel: String(params.modelLabel ?? '').trim(),
      decisionId: String(params.decisionId ?? '').trim(),
      source: params.source,
      label: params.source === 'timeout_top1' ? '超时托管' : 'AI 决策',
      elapsedMs: Math.max(0, Math.trunc(params.elapsedMs)),
      legalActionId: params.legalActionId ? String(params.legalActionId) : null,
      actionKind: String(params.actionKind ?? '').trim() || 'action',
      actionLabel: String(params.actionLabel ?? '').trim() || '执行动作',
    };
    const { legalActionId: _privateSelector, ...publicPayload } = shared;
    this.logReplay('ai_decision', params.scene === 'claim' ? null : publicPayload, {
      [String(Math.trunc(params.seat))]: {
        ...shared,
        actionLabel: String(params.privateActionLabel ?? '').trim() || String(params.actionLabel ?? '').trim() || '执行动作',
      },
    });
  }

  private replaySeatActors(): Record<string, { kind: 'ai'; modelId: string; modelLabel: string }> {
    const source = (this.game.get('match', 0) as any)?.seatActors ?? {};
    const out: Record<string, { kind: 'ai'; modelId: string; modelLabel: string }> = {};
    for (let seat = 0; seat < 4; seat += 1) {
      const actor = source?.[String(seat)] ?? source?.[seat] ?? null;
      if (actor?.kind !== 'ai') continue;
      const modelId = String(actor?.modelId ?? '').trim();
      const modelLabel = String(actor?.modelLabel ?? modelId).trim();
      if (!modelId || !modelLabel) continue;
      out[String(seat)] = { kind: 'ai', modelId, modelLabel };
    }
    return out;
  }

  private logReplay(type: string, publicPayload: any, privateBySeat: Record<string, any> | null): void {
    const ev: ReplayEvent = {
      seq: this.nextReplaySeq(),
      at: Date.now(),
      type,
      public: publicPayload ?? null,
    };
    if (privateBySeat && Object.keys(privateBySeat).length > 0) {
      ev.private = privateBySeat;
    }
    this.appendReplayEvents([ev]);
  }

  private nextReplaySeq(): number {
    const now = Date.now();
    const seq = now <= this.replaySeq ? this.replaySeq + 1 : now;
    this.replaySeq = seq;
    return seq;
  }
}

function emptyPlayer(seat: number, playerId: string | null): BloodPlayerState {
  return {
    seat,
    playerId,
    dingque: null,
    dingqueReady: false,
    hu: false,
    huTileKey: null,
    huSource: null,
    beans: START_BEANS,
    kongGain: 0,
    melds: [],
  };
}

function sanitizeBeans(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
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

function parseSeat(value: any): number | null {
  if (value === null || value === undefined) return null;
  const n = Math.trunc(value as number);
  if (!Number.isFinite(n) || n < 0 || n > 3) return null;
  return n;
}

function wallSlots(seat: number): Array<string> {
  const out: Array<string> = [];
  for (let col = 0; col < 19; col++) {
    for (let stack = 0; stack < 2; stack++) {
      out.push(`wall.${col}.${stack}@${seat}`);
    }
  }
  return out;
}

function discardSlots(seat: number): Array<string> {
  const out: Array<string> = [];
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 6; row++) {
      out.push(`discard.${col}.${row}@${seat}`);
    }
  }
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 6; row++) {
      out.push(`discard.stack.${col}.${row}@${seat}`);
    }
  }
  return out;
}

function makeShuffledTileMapping(): Map<number, number> {
  const keys: Array<number> = [];
  for (let k = 0; k < 27; k++) {
    for (let i = 0; i < 4; i++) keys.push(k);
  }
  shuffleInPlace(keys);
  const map = new Map<number, number>();
  for (let id = 0; id < 108; id++) {
    map.set(id, keys[id]!);
  }
  return map;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j]!;
    arr[j] = tmp!;
  }
}

function suitOf(tileKey: number): BloodSuit {
  if (tileKey < 9) return 'm';
  if (tileKey < 18) return 'p';
  return 's';
}

function rankOf(tileKey: number): number {
  return (tileKey % 9) + 1;
}

function tileCode(tileKey: number): string {
  return `${rankOf(tileKey)}${suitOf(tileKey)}`;
}

function hasSuit(counts: ReadonlyArray<number>, suit: BloodSuit): boolean {
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0 && suitOf(i) === suit) return true;
  }
  return false;
}

// Blood Battle Hu check:
// - Standard hand (melds + pair)
// - Seven pairs (concealed only)
export function canHuCounts(counts: ReadonlyArray<number>, meldCount: number): boolean {
  const concealed = counts.reduce((a, b) => a + b, 0);
  const setsNeeded = 4 - meldCount;
  const needTiles = setsNeeded * 3 + 2;
  if (concealed !== needTiles) {
    return false;
  }

  if (meldCount === 0 && isSevenPairs(counts)) {
    return true;
  }

  const buf = counts.slice();
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] >= 2) {
      buf[i] -= 2;
      if (canMakeSets(buf, setsNeeded, new Map())) {
        return true;
      }
      buf[i] += 2;
    }
  }
  return false;
}

function isSevenPairs(counts: ReadonlyArray<number>): boolean {
  let pairs = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i];
    if (c === 0) continue;
    if (c === 2) pairs += 1;
    else if (c === 4) pairs += 2;
    else return false;
  }
  return pairs === 7;
}

function canMakeSets(counts: number[], setsNeeded: number, memo: Map<string, boolean>): boolean {
  if (setsNeeded === 0) {
    return counts.every((c) => c === 0);
  }

  const key = `${setsNeeded}:${counts.join(',')}`;
  const cached = memo.get(key);
  if (cached !== undefined) {
    return cached;
  }

  let i = 0;
  while (i < counts.length && counts[i] === 0) i++;
  if (i >= counts.length) {
    memo.set(key, false);
    return false;
  }

  // Triplet
  if (counts[i] >= 3) {
    counts[i] -= 3;
    if (canMakeSets(counts, setsNeeded - 1, memo)) {
      counts[i] += 3;
      memo.set(key, true);
      return true;
    }
    counts[i] += 3;
  }

  // Sequence (same suit, rank <= 7)
  const r = i % 9;
  if (r <= 6) {
    const i1 = i + 1;
    const i2 = i + 2;
    if (counts[i1] > 0 && counts[i2] > 0) {
      counts[i] -= 1;
      counts[i1] -= 1;
      counts[i2] -= 1;
      if (canMakeSets(counts, setsNeeded - 1, memo)) {
        counts[i] += 1;
        counts[i1] += 1;
        counts[i2] += 1;
        memo.set(key, true);
        return true;
      }
      counts[i] += 1;
      counts[i1] += 1;
      counts[i2] += 1;
    }
  }

  memo.set(key, false);
  return false;
}

function normalizeAction(raw: any): BloodAction | null {
  const kind = typeof raw?.kind === 'string' ? raw.kind : null;
  if (!kind) return null;
  if (kind === 'swap3') {
    return { kind: 'swap3', tileIds: Array.isArray(raw.tileIds) ? raw.tileIds : [] };
  }
  if (kind === 'dingque') {
    const suit = raw.suit;
    if (suit !== 'm' && suit !== 'p' && suit !== 's') return null;
    return { kind: 'dingque', suit };
  }
  if (kind === 'discard') {
    const tileId = raw.tileId;
    if (!Number.isFinite(tileId)) return null;
    return { kind: 'discard', tileId: Math.trunc(tileId) };
  }
  if (kind === 'claim') {
    const pendingId = raw.pendingId;
    const action = raw.action;
    if (!Number.isFinite(pendingId)) return null;
    if (action !== 'hu' && action !== 'peng' && action !== 'gang' && action !== 'pass') return null;
    return { kind: 'claim', pendingId: Math.trunc(pendingId), action };
  }
  if (kind === 'kong') {
    const gangType = raw.gangType;
    const tileKey = raw.tileKey;
    if (gangType !== 'an' && gangType !== 'add') return null;
    if (!Number.isFinite(tileKey)) return null;
    return { kind: 'kong', gangType, tileKey: Math.trunc(tileKey) };
  }
  if (kind === 'hu') {
    const source = raw.source;
    if (source !== 'self') return null;
    return { kind: 'hu', source };
  }
  return null;
}

function isAuthoritativeMode(): boolean {
  return true;
}
