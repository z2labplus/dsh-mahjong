import { Client } from './client';
import { GameType } from './types';
import type {
  BloodAction,
  BloodLedgerEntry,
  BloodLedgerTransfer,
  BloodSeatEndSummary,
  BloodState,
  BloodSwap3Direction,
  BloodSwap3State,
} from './blood';
import type { ThingInfo } from './types';
import { World } from './world';
import { suitOf, tileCode, tileKeyFromTypeIndex } from './blood-tiles';
import { canHuCounts } from './blood-win';
import { calcBloodHu, type HuCalcHand, type HuEvents } from './blood-calc-engine';

export class BloodController {
  private client: Client;
  private world: World;
  private processedSeq: Map<string, number> = new Map();
  private lastSlotByThing: Map<number, string> = new Map();
  private pendingMoves: Array<{ thingId: number; from: string | null; to: string }> = [];
  // 用于“弃牌集合”兜底检测：当增量 move 丢失(from=null/被 full update 覆盖)时，仍能识别新弃牌。
  private discardSnapshot: Array<Set<number>> | null = null;
  // seat0 写入 blood 后，本地 map 不会立刻更新（需要服务端回显）。
  // 为避免“回合状态未推进但又收到第二次弃牌”导致双出牌，使用 shadowState 做本地权威视图。
  private shadowState: BloodState | null = null;
  private readonly claimTimeoutMs = 16 * 60 * 1000;
  private readonly swap3TimeoutMs = 6 * 60 * 1000;
  private readonly swap3AnimDelayMs = 1200;
  private readonly settlingDelayMs = 16000;
  private replaySeq: number = Date.now();
  private replayMetaLogged: boolean = false;
  private replayHandsLogged: boolean = false;

  constructor(client: Client, world: World) {
    this.client = client;
    this.world = world;

    this.client.blood.on('update', this.onBlood.bind(this));
    this.client.bloodAction.on('update', this.tick.bind(this));
    this.client.seats.on('update', this.tick.bind(this));
    this.client.match.on('update', this.tick.bind(this));
    this.client.things.on('update', this.onThings.bind(this));

    // 超时自动过需要周期性 tick（否则所有人都不点按钮会卡局）
    setInterval(() => this.tick(), 250);
  }

  private onBlood(): void {
    const state = this.client.blood.get(0) as BloodState | null;
    this.shadowState = state;
    this.tick();
  }

  private commit(next: BloodState): void {
    const prev = this.shadowState;
    this.shadowState = next;
    this.maybeLogStateDiff(prev, next);
    this.client.blood.set(0, next);
  }

  private onThings(entries: Array<[number, ThingInfo | null]>, full: boolean): void {
    if (full) {
      // full update 可能由 server 的 unique 冲突触发（会丢失增量 move 信息）。
      // 为了不让“弃牌/摸牌”等关键动作在 full update 时被吞掉，
      // 这里用上一次快照(lastSlotByThing) 与本次快照(client.things) 做 diff，重建 moves。
      const prev = this.lastSlotByThing;
      const nextMap: Map<number, string> = new Map();
      this.pendingMoves.splice(0);
      for (const [id, info] of this.client.things.entries()) {
        const from = prev.get(id) ?? null;
        const to = info.slotName;
        nextMap.set(id, to);
        if (from !== null && from !== to) {
          this.pendingMoves.push({ thingId: id, from, to });
        }
      }
      this.lastSlotByThing = nextMap;
      this.tick();
      return;
    }

    for (const [thingId, info] of entries) {
      if (info === null) {
        this.lastSlotByThing.delete(thingId);
        continue;
      }
      const from = this.lastSlotByThing.get(thingId) ?? null;
      const to = info.slotName;
      this.lastSlotByThing.set(thingId, to);
      this.pendingMoves.push({ thingId, from, to });
    }
    this.tick();
  }

  private computeDiscardSnapshot(): Array<Set<number>> {
    const bySeat: Array<Set<number>> = [new Set(), new Set(), new Set(), new Set()];
    for (const [tileId, info] of this.client.things.entries()) {
      const m = /^discard(?:\..*)?@(\d)$/.exec(info.slotName);
      if (!m) continue;
      const seat = parseInt(m[1], 10);
      if (seat >= 0 && seat < 4) {
        bySeat[seat].add(tileId);
      }
    }
    return bySeat;
  }

  private tick(): void {
    const match = this.client.match.get(0);
    if (!match || match.conditions.gameType !== GameType.BLOOD_BATTLE) {
      return;
    }
    // seat0 作为裁判推进逻辑
    if (this.client.seat !== 0) {
      return;
    }

    const stateFromServer = this.client.blood.get(0) as BloodState | null;
    if (!this.shadowState) {
      this.shadowState = stateFromServer;
    }
    const state = this.shadowState as BloodState | null;
    if (!state) {
      return;
    }

	    if (!this.replayMetaLogged) {
	      this.replayMetaLogged = true;
	      this.logReplay('meta', {
	        variant: 'xuezhan',
	        base: state.base,
	        dealer: state.dealer,
	        rules: { variant: 'xuezhan', base: state.base },
	      }, null);
	    }

    // 兼容旧局/异常状态：若牌局已经结束（settling/done），确保全员亮牌。
    // 过去版本可能直接 phase='done' 且 revealAllHands=false，导致结束后仍然背面。
    if ((state.phase === 'settling' || state.phase === 'done') && !state.revealAllHands) {
      this.commit({ ...state, revealAllHands: true });
      return;
    }

    const discardNow = this.computeDiscardSnapshot();
    const discardPrev = this.discardSnapshot;

    const seatToPlayer: Array<string | null> = new Array(4).fill(null);
    const playerToSeat: Map<string, number> = new Map();
    for (const [playerId, seatInfo] of this.client.seats.entries()) {
      if (seatInfo.seat === null) {
        continue;
      }
      if (seatInfo.seat < 0 || seatInfo.seat > 3) {
        continue;
      }
      seatToPlayer[seatInfo.seat] = playerId;
      playerToSeat.set(playerId, seatInfo.seat);
    }

    let next: BloodState = state;
    let changed = false;
    let kongRequest: { seat: number; action: Extract<BloodAction, { kind: 'kong' }> } | null = null;
    let selfHuRequestSeat: number | null = null;

    // wallIndex 容错：在 full update/丢增量时，可能出现“wallOrder[wallIndex] 已不在 wall 里”的情况，
    // 导致无法摸牌且 wallEmpty 永远不成立。这里把 wallIndex 前移到下一个仍在 wall.* 的 tileId。
    // 注意：wallOrder 只包含主墙（wall.<col>.<stack>），但有些 tile 可能被移到 wall.open；仍允许 startsWith('wall.') 的可摸牌来源。
    const normalizeWallIndex = (): void => {
      if (next.wallOrder.length === 0) return;
      let idx = Math.max(0, next.wallIndex);
      while (idx < next.wallOrder.length) {
        const tileId = next.wallOrder[idx];
        const info = this.client.things.get(tileId);
        if (info && info.slotName.startsWith('wall.')) {
          break;
        }
        idx += 1;
      }
      if (idx === next.wallIndex) return;
      next = { ...next, wallIndex: idx };
      changed = true;
    };

    // 同步 players[*].playerId（以 seats 集合为准）
    for (let seat = 0; seat < 4; seat++) {
      const pid = seatToPlayer[seat];
      const cur = next.players[seat];
      if (!cur) {
        continue;
      }
      if (cur.playerId !== pid) {
        if (!changed) {
          next = { ...next, players: { ...next.players } };
          changed = true;
        }
        next.players[seat] = { ...cur, playerId: pid };
      }
    }

    // 处理玩家动作（定缺等）
    for (const [playerId, payload] of this.client.bloodAction.entries()) {
      if (!payload) {
        continue;
      }
      const lastSeq = this.processedSeq.get(playerId) ?? 0;
      if (payload.seq <= lastSeq) {
        continue;
      }
      this.processedSeq.set(playerId, payload.seq);

      const seat = playerToSeat.get(playerId);
      if (seat === undefined) {
        continue;
      }
      const action: BloodAction = payload.action;
      if (action.kind === 'dingque') {
        const cur = next.players[seat];
        if (cur && cur.dingque === null) {
          if (!changed) {
            next = { ...next, players: { ...next.players } };
            changed = true;
          }
          next.players[seat] = { ...cur, dingque: action.suit };
        }
      } else if (action.kind === 'swap3') {
        const swap3 = next.swap3 ?? null;
        const alreadyPicked = swap3?.selections?.[seat] ?? null;
        if (next.phase === 'swap3' && swap3 && swap3.animatingSince === null && alreadyPicked === null) {
          const raw = Array.isArray(action.tileIds) ? action.tileIds : [];
          const ids = raw.filter((x) => Number.isFinite(x)).slice(0, 3).map((x) => Math.trunc(x as number));
          const uniq = new Set(ids);
          if (ids.length === 3 && uniq.size === 3) {
            let suit: ReturnType<typeof suitOf> | null = null;
            let ok = true;
            for (const tileId of ids) {
              const info = this.client.things.get(tileId);
              if (!info) { ok = false; break; }
              // 必须来自自己手牌（含 hand.extra）
              if (!info.slotName.endsWith(`@${seat}`) || !info.slotName.startsWith('hand.')) { ok = false; break; }
              const thing = this.world.things.get(tileId) ?? null;
              const tileKey = thing ? tileKeyFromTypeIndex(thing.typeIndex) : null;
              if (tileKey === null) { ok = false; break; }
              const s = suitOf(tileKey);
              if (suit === null) suit = s;
              else if (s !== suit) { ok = false; break; }
            }
            if (ok) {
              const selections: Record<number, Array<number> | null> = { ...swap3.selections };
              selections[seat] = ids.slice(0, 3);
              next = { ...next, swap3: { ...swap3, selections } };
              changed = true;
            }
          }
        }
      } else if (action.kind === 'claim') {
        const pending = next.pending;
        if (pending && pending.kind === 'claim' && pending.id === action.pendingId) {
          const opt = pending.options[seat] ?? { hu: false, peng: false, gang: false };
          const allowed =
            action.action === 'pass' ||
            (action.action === 'hu' && opt.hu) ||
            (action.action === 'peng' && opt.peng) ||
            (action.action === 'gang' && opt.gang);
          if (allowed && pending.responses[seat] === null) {
            if (!changed) {
              next = { ...next, pending: { ...pending, options: pending.options, responses: { ...pending.responses } } };
              changed = true;
            } else {
              next = { ...next, pending: { ...pending, options: pending.options, responses: { ...pending.responses } } };
            }
            next.pending!.responses[seat] = action.action;
          }
        }
      } else if (action.kind === 'kong') {
        kongRequest = { seat, action };
      } else if (action.kind === 'hu' && action.source === 'self') {
        selfHuRequestSeat = seat;
      }

      // 清理动作，避免重复处理
      this.client.bloodAction.set(playerId, null);
    }

    const initSwap3 = (): BloodSwap3State => {
      const dirs: Array<BloodSwap3Direction> = ['cw', 'ccw', 'across'];
      const dir = dirs[Math.floor(Math.random() * dirs.length)] ?? 'cw';
      return {
        dir,
        since: Date.now(),
        animatingSince: null,
        selections: { 0: null, 1: null, 2: null, 3: null },
      };
    };

    const pickSwap3ForSeat = (seat: number): Array<number> | null => {
      type TileInfo = { tileId: number; tileKey: number; rank: number };
      const tiles: Array<TileInfo> = [];
      for (const t of this.world.things.values()) {
        if (t.slot.group !== 'hand' || t.slot.seat !== seat) continue;
        const tileKey = tileKeyFromTypeIndex(t.typeIndex);
        if (tileKey === null) continue;
        tiles.push({ tileId: t.index, tileKey, rank: (tileKey % 9) + 1 });
      }

      const bySuit: Record<'m' | 'p' | 's', Array<TileInfo>> = { m: [], p: [], s: [] };
      for (const ti of tiles) {
        const s = suitOf(ti.tileKey);
        bySuit[s].push(ti);
      }

      const suits: Array<'m' | 'p' | 's'> = ['m', 'p', 's'];
      const candidates = suits.filter((s) => bySuit[s].length >= 3);
      if (candidates.length <= 0) return null;

      // 若某门刚好 3 张，优先直接换这 3 张（更接近常见“做缺门/做手”思路）。
      const exact3 = candidates.filter((s) => bySuit[s].length === 3);
      const pickSuit = (): 'm' | 'p' | 's' => {
        const pool = exact3.length > 0 ? exact3 : candidates;
        if (pool.length === 1) return pool[0]!;

        // 选“最差三张”总分最高的花色；打平时随机。
        const scoreSuit = (s: 'm' | 'p' | 's'): number => {
          const ranks = new Array(10).fill(0);
          for (const ti of bySuit[s]) ranks[ti.rank] += 1;

          const scoreTile = (r: number): number => {
            const c = ranks[r] ?? 0;
            const hasL = (r > 1 && (ranks[r - 1] ?? 0) > 0) || (r > 2 && (ranks[r - 2] ?? 0) > 0);
            const hasR = (r < 9 && (ranks[r + 1] ?? 0) > 0) || (r < 8 && (ranks[r + 2] ?? 0) > 0);

            let score = 0;
            // 单张更“差”；对子/刻子更“好”（尽量不换走）
            if (c <= 1) score += 2.0;
            else if (c === 2) score -= 1.0;
            else score -= 1.6;

            // 缺少搭子更“差”
            if (!hasL && !hasR) score += 1.4;
            else if (hasL && hasR) score -= 0.6;
            else score += 0.2;

            // 边张更“差”
            if (r === 1 || r === 9) score += 0.6;
            else if (r === 2 || r === 8) score += 0.25;

            return score;
          };

          const tileScores = bySuit[s].map((ti) => ({ tileId: ti.tileId, score: scoreTile(ti.rank) }));
          tileScores.sort((a, b) => (b.score - a.score) || (a.tileId - b.tileId));
          const top3 = tileScores.slice(0, 3);
          return top3.reduce((sum, x) => sum + x.score, 0);
        };

        let best: Array<'m' | 'p' | 's'> = [];
        let bestScore = -Infinity;
        for (const s of pool) {
          const score = scoreSuit(s);
          if (score > bestScore + 1e-6) {
            bestScore = score;
            best = [s];
          } else if (Math.abs(score - bestScore) <= 1e-6) {
            best.push(s);
          }
        }
        return best[Math.floor(Math.random() * best.length)] ?? pool[0]!;
      };

      const chosenSuit = pickSuit();
      const suitTiles = bySuit[chosenSuit];

      const ranks = new Array(10).fill(0);
      for (const ti of suitTiles) ranks[ti.rank] += 1;
      const scoreTile = (r: number): number => {
        const c = ranks[r] ?? 0;
        const hasL = (r > 1 && (ranks[r - 1] ?? 0) > 0) || (r > 2 && (ranks[r - 2] ?? 0) > 0);
        const hasR = (r < 9 && (ranks[r + 1] ?? 0) > 0) || (r < 8 && (ranks[r + 2] ?? 0) > 0);
        let score = 0;
        if (c <= 1) score += 2.0;
        else if (c === 2) score -= 1.0;
        else score -= 1.6;
        if (!hasL && !hasR) score += 1.4;
        else if (hasL && hasR) score -= 0.6;
        else score += 0.2;
        if (r === 1 || r === 9) score += 0.6;
        else if (r === 2 || r === 8) score += 0.25;
        return score;
      };

      const scored = suitTiles.map((ti) => ({ tileId: ti.tileId, score: scoreTile(ti.rank) }));
      scored.sort((a, b) => (b.score - a.score) || (a.tileId - b.tileId));
      return scored.slice(0, 3).map((x) => x.tileId);
    };

    const handSlotOrder = (slotName: string): number => {
      if (slotName.startsWith('hand.extra')) return 1000;
      const m = /^hand\.(\d+)@(\d)$/.exec(slotName);
      if (!m) return 2000;
      const idx = parseInt(m[1] ?? '', 10);
      return Number.isFinite(idx) ? idx : 2000;
    };

    // 阶段推进：换三张 -> 定缺
    if (next.phase === 'swap3') {
      const allPresent = [0, 1, 2, 3].every((s) => next.players[s].playerId !== null);
      if (allPresent) {
        const swap3 = next.swap3 ?? initSwap3();
        if (!next.swap3) {
          next = { ...next, swap3 };
          changed = true;
        }

        // 换牌动画阶段：延迟一段时间再进入定缺（让玩家看到牌移动）。
        if (swap3.animatingSince !== null) {
          if (Date.now() - swap3.animatingSince >= this.swap3AnimDelayMs) {
            next = { ...next, phase: 'dingque', swap3: null };
            changed = true;
          }
        } else {
          const timedOut = Date.now() - swap3.since >= this.swap3TimeoutMs;
          let selections = swap3.selections;

          if (timedOut) {
            let changedSelections = false;
            const nextSelections: Record<number, Array<number> | null> = { ...selections };
            for (let s = 0; s < 4; s++) {
              if (nextSelections[s] !== null) continue;
              const picked = pickSwap3ForSeat(s);
              if (picked && picked.length === 3) {
                nextSelections[s] = picked;
                changedSelections = true;
              }
            }
            if (changedSelections) {
              selections = nextSelections;
              next = { ...next, swap3: { ...swap3, selections } };
              changed = true;
            }
          }

          const allPicked = [0, 1, 2, 3].every((s) => (selections[s] ?? null) !== null);
          if (allPicked) {
            // 执行换三张：用“真实牌移动”做动画，并把 swap3 标记为 animating。
            const dir = swap3.dir;
            const destSeat = (from: number): number => {
              if (dir === 'cw') return (from + 1) % 4;
              if (dir === 'ccw') return (from + 3) % 4;
              return (from + 2) % 4;
            };

            const outBySeat: Record<number, Array<{ tileId: number; slotName: string }>> = { 0: [], 1: [], 2: [], 3: [] };
            for (let s = 0; s < 4; s++) {
              const ids = selections[s] as Array<number>;
              const items: Array<{ tileId: number; slotName: string }> = [];
              for (const tileId of ids) {
                const info = this.client.things.get(tileId);
                if (!info) continue;
                items.push({ tileId, slotName: info.slotName });
              }
              items.sort((a, b) => (handSlotOrder(a.slotName) - handSlotOrder(b.slotName)) || (a.tileId - b.tileId));
              outBySeat[s] = items.slice(0, 3);
            }

            const movedInfos = new Map<number, ThingInfo>();
            for (let from = 0; from < 4; from++) {
              const to = destSeat(from);
              const fromTiles = outBySeat[from];
              const toSlots = outBySeat[to].map((x) => x.slotName);
              for (let i = 0; i < 3; i++) {
                const tileId = fromTiles[i]?.tileId ?? null;
                const slotName = toSlots[i] ?? null;
                if (tileId === null || slotName === null) continue;
                const info = this.client.things.get(tileId);
                if (!info) continue;
                movedInfos.set(tileId, {
                  ...info,
                  slotName,
                  rotationIndex: 0,
                  claimedBy: null,
                  shiftSlotName: null,
                });
              }
            }

            const now = Date.now();
            const updated: BloodState = { ...next, swap3: { ...swap3, selections, animatingSince: now } };

            // Replay: record swap3 exchange (private per seat).
            const outCodes: Record<number, Array<string>> = { 0: [], 1: [], 2: [], 3: [] };
            const inCodes: Record<number, Array<string>> = { 0: [], 1: [], 2: [], 3: [] };
            for (let s = 0; s < 4; s++) {
              outCodes[s] = (outBySeat[s] ?? [])
                .map((x) => this.tileCodeFromThingId(x.tileId))
                .filter(Boolean) as Array<string>;
            }
            for (let from = 0; from < 4; from++) {
              const to = destSeat(from);
              inCodes[to] = outCodes[from] ?? [];
            }
            const priv: Record<string, any> = {};
            for (let s = 0; s < 4; s++) {
              priv[String(s)] = { out: outCodes[s] ?? [], in: inCodes[s] ?? [] };
            }
            this.logReplay('swap3', { dir }, priv);

            this.shadowState = updated;
            this.client.transaction(() => {
              for (const [tileId, info] of movedInfos.entries()) {
                this.client.things.set(tileId, info);
              }
              this.client.blood.set(0, updated);
            });
            return;
          }
        }
      }
    }

    // 轮到自己时的“暗杠/加杠/自摸胡”（由 seat0 执行并结算豆）
    if (selfHuRequestSeat !== null &&
        next.phase === 'playing' &&
        next.pending === null &&
        next.turnSeat === selfHuRequestSeat &&
        next.turnStep === 'discard') {
      const seat = selfHuRequestSeat;
      const ps = next.players[seat];
      if (ps && !ps.hu && ps.dingque !== null) {
        // 自摸胡必须是刚摸到/补张后的回合：需要存在 hand.extra@seat。
        // 否则会出现“碰/杠后进入弃牌阶段还能点自摸胡”的错误行为。
        const extraSlot = `hand.extra@${seat}`;
        let extraTileId: number | null = null;
        for (const [tileId, info] of this.client.things.entries()) {
          if (info.slotName === extraSlot) {
            extraTileId = tileId;
            break;
          }
        }
        if (extraTileId === null) {
          // 非摸牌回合（例如碰后）不允许自摸胡；忽略该请求即可。
          // UI 侧也会隐藏“胡”按钮，但这里做兜底校验避免被绕过。
        } else {
          const counts = new Array(27).fill(0);
          for (const t of this.world.things.values()) {
            if (t.slot.group !== 'hand' || t.slot.seat !== seat) continue;
            const k = tileKeyFromTypeIndex(t.typeIndex);
            if (k !== null) counts[k] += 1;
          }
          // 胡牌必须无缺门
          let hasDingque = false;
          for (let i = 0; i < 27; i++) {
            if (counts[i] > 0 && suitOf(i) === ps.dingque) {
              hasDingque = true;
              break;
            }
          }
          const meldCount = ps.melds.length;
          if (!hasDingque && canHuCounts(counts, meldCount)) {
            const updatedPlayers = { ...next.players };
            updatedPlayers[seat] = { ...updatedPlayers[seat] };

            const payers: Array<number> = [];
            for (let s = 0; s < 4; s++) {
              if (s === seat) continue;
              const other = updatedPlayers[s];
              if (!other || other.hu) continue;
              payers.push(s);
            }

            const concealedTiles: Array<number> = [];
            for (const t of this.world.things.values()) {
              if (t.slot.group !== 'hand' || t.slot.seat !== seat) continue;
              const k = tileKeyFromTypeIndex(t.typeIndex);
              if (k !== null) concealedTiles.push(k);
            }
            const melds = ps.melds.map((m) => ({ kind: m.kind, tileKey: m.tileKey, gangType: m.gangType }));

            const base = next.base;
            const gangShangKaiHua = (next.afterGangSeat ?? null) === seat;
            const events: HuEvents = {
              gangShangKaiHua,
              // 海底：摸到最后一张牌后自摸胡（wallOrder 为空时不视为海底，避免 debug/初始化阶段误判）
              haiDi: next.wallOrder.length > 0 && next.wallIndex >= next.wallOrder.length,
            };
            const calc = calcBloodHu(
              { concealedTiles, melds } as HuCalcHand,
              { base, huMethod: 'zimo', remainingOpponents: payers.length, events },
            );
            if (!calc.ok) {
              // 兜底：理论上不应发生（已通过 canHuCounts 校验）
              return;
            }
            const perPay = calc.perOpponent;

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
            // 自摸胡：胡牌展示用 hand.extra 的那张牌（即刚摸到的牌）。
            const huTileKey = (() => {
              const extra = this.world.things.get(extraTileId);
              return extra ? tileKeyFromTypeIndex(extra.typeIndex) : null;
            })();
            updatedPlayers[seat].huTileKey = huTileKey;
            updatedPlayers[seat].huSource = 'self';

            const nextSeat = (() => {
              for (let i = 1; i <= 4; i++) {
                const s = (seat + i) % 4;
                const p = updatedPlayers[s];
                if (p && !p.hu && p.playerId !== null) return s;
              }
              return null;
            })();

            const ledgerEntry: BloodLedgerEntry = {
              kind: 'hu',
              label: '自摸',
              seat,
              multiplier: calc.multiplierCapped,
              multiplierRaw: calc.multiplierRaw,
              fans: calc.fans.map((f) => ({ id: f.id, name: f.name, multiplier: f.multiplier })),
              transfers,
              at: Date.now(),
            };
            this.logReplay('hu', { source: 'self', seat, tile: huTileKey === null ? null : tileCode(huTileKey) }, null);
            this.logReplay('ledger', { entry: ledgerEntry }, null);
            const updated: BloodState = {
              ...next,
              players: updatedPlayers,
              ledger: [...(next.ledger ?? []), ledgerEntry],
              pending: null,
              afterGangSeat: null,
              turnSeat: nextSeat ?? seat,
              turnStep: 'drawOrKong',
            };

            this.commit(updated);
            return;
          }
        }
      }
    }

    // 轮到自己时的“暗杠/加杠”（由 seat0 执行并结算豆）
    if (kongRequest &&
        next.phase === 'playing' &&
        next.pending === null &&
        next.turnSeat === kongRequest.seat &&
        next.turnStep === 'discard') {
      const seat = kongRequest.seat;
      const action = kongRequest.action;
      const ps = next.players[seat];
      if (ps && !ps.hu && ps.dingque !== null) {
        // 血战规则：杠后必须能补张；墙剩 0（无牌可摸）时不允许杠。
        const wallEmpty = next.wallIndex >= next.wallOrder.length;
        if (wallEmpty) {
          // 非致命：忽略该次杠请求，继续本帧其它状态推进。
          kongRequest = null;
        } else if (suitOf(action.tileKey) !== ps.dingque) {
          // 定缺花色不能碰/杠
          const extraSlot = `hand.extra@${seat}`;
          let extraTileId: number | null = null;
          for (const [id, info] of this.client.things.entries()) {
            if (info.slotName === extraSlot) {
              extraTileId = id;
              break;
            }
          }

          const findEmptyHandSlot = (): string | null => {
            const occupied = new Set<string>();
            for (const [, info] of this.client.things.entries()) {
              if (info.slotName.startsWith('hand.') && info.slotName.endsWith(`@${seat}`) && !info.slotName.startsWith('hand.extra')) {
                occupied.add(info.slotName);
              }
            }
            for (let i = 0; i < 14; i++) {
              const slot = `hand.${i}@${seat}`;
              if (!occupied.has(slot)) return slot;
            }
            return null;
          };

          const movedInfos = new Map<number, ThingInfo>();
          const updatedPlayers = { ...next.players };
          updatedPlayers[seat] = { ...updatedPlayers[seat] };

          const usedRows = new Set<number>(updatedPlayers[seat].melds.map((m) => m.row));
          const pickRow = (): number | null => {
            let row = 0;
            while (usedRows.has(row) && row < 4) row++;
            return row < 4 ? row : null;
          };

          if (action.gangType === 'an') {
            // 暗杠：手里 4 张同牌
            const tiles: Array<number> = [];
            for (const t of this.world.things.values()) {
              if (t.slot.group !== 'hand' || t.slot.seat !== seat) continue;
              const k = tileKeyFromTypeIndex(t.typeIndex);
              if (k === action.tileKey) {
                tiles.push(t.index);
              }
            }
            tiles.sort((a, b) => a - b);
            if (tiles.length >= 4) {
              const row = pickRow();
              if (row !== null) {
                const targetSlots = [
                  `meld.${row}.0@${seat}`,
                  `meld.${row}.1@${seat}`,
                  `meld.${row}.2@${seat}`,
                  `meld.${row}.3@${seat}`,
                ];
                const infos = tiles.slice(0, 4).map((id) => this.client.things.get(id));
                if (infos.every((x) => x !== null)) {
                  // 方案A：背-面-面-背（暗杠两头盖住）
                  const rotations = [2, 0, 0, 2];
                  for (let i = 0; i < 4; i++) {
                    const id = tiles[i];
                    movedInfos.set(id, {
                      ...(infos[i] as ThingInfo),
                      slotName: targetSlots[i],
                      rotationIndex: rotations[i],
                      claimedBy: null,
                      shiftSlotName: null,
                    });
                  }

                  // 若 extra 里有牌且未被本次移动消耗，先挪回手牌空位，腾出 extra 给补张
                  if (extraTileId !== null && !movedInfos.has(extraTileId)) {
                    const target = findEmptyHandSlot();
                    const info = this.client.things.get(extraTileId);
                    if (target && info) {
                      movedInfos.set(extraTileId, {
                        ...info,
                        slotName: target,
                        rotationIndex: 0,
                        claimedBy: null,
                        shiftSlotName: null,
                      });
                    }
                  }

                  const base = next.base;
                  const perPay = base * 2;
                  const transfers: Array<BloodLedgerTransfer> = [];
                  let totalGain = 0;
                  for (let s = 0; s < 4; s++) {
                    if (s === seat) continue;
                    const other = updatedPlayers[s];
                    if (!other || other.hu) continue;
                    updatedPlayers[s] = { ...other, beans: other.beans - perPay };
                    totalGain += perPay;
                    transfers.push({ fromSeat: s, toSeat: seat, beans: perPay });
                  }
                  updatedPlayers[seat].beans += totalGain;
                  updatedPlayers[seat].kongGain += totalGain;
                  updatedPlayers[seat].melds = [
                    ...updatedPlayers[seat].melds,
                    { kind: 'gang', tileKey: action.tileKey, fromSeat: null, gangType: 'an', row },
                  ];

                  const ledgerEntry: BloodLedgerEntry = {
                    kind: 'kong',
                    label: '刮风',
                    seat,
                    multiplier: 2,
                    transfers,
                    at: Date.now(),
                  };
                  this.logReplay('gang', { seat, gangType: 'an', fromSeat: null, tile: tileCode(action.tileKey) }, null);
                  this.logReplay('ledger', { entry: ledgerEntry }, null);
                  const updated: BloodState = {
                    ...next,
                    players: updatedPlayers,
                    ledger: [...(next.ledger ?? []), ledgerEntry],
                    afterGangSeat: seat,
                    turnStep: 'drawOrKong',
                  };

                  this.shadowState = updated;
                  this.client.transaction(() => {
                    for (const [id, info] of movedInfos.entries()) {
                      this.client.things.set(id, info);
                    }
                    this.client.blood.set(0, updated);
                  });
                  return;
                }
              }
            }
          } else if (action.gangType === 'add') {
            // 加杠：已有碰，再把第4张补上；允许“抢杠胡”（胡 > 杠 > 碰）
            const peng = updatedPlayers[seat].melds.find((m) => m.kind === 'peng' && m.tileKey === action.tileKey) ?? null;
            if (!peng) {
              // no-op
            } else {
              const pickAddTileId = (): number | null => {
                // 优先使用 extra（常见为“刚摸到这张就加杠”），避免后续留着 extra 卡住摸牌逻辑
                if (extraTileId !== null) {
                  const extraThing = this.world.things.get(extraTileId) ?? null;
                  const k = extraThing ? tileKeyFromTypeIndex(extraThing.typeIndex) : null;
                  if (k === action.tileKey) return extraTileId;
                }
                for (const t of this.world.things.values()) {
                  if (t.slot.group !== 'hand' || t.slot.seat !== seat) continue;
                  const k = tileKeyFromTypeIndex(t.typeIndex);
                  if (k === action.tileKey) return t.index;
                }
                return null;
              };

              const addTileId = pickAddTileId();
              const addTileInfo = addTileId === null ? null : (this.client.things.get(addTileId) ?? null);
              if (addTileId === null || !addTileInfo) {
                // no-op
              } else {
                // 先判断是否存在“可抢杠胡”的玩家；若存在则进入 pending，给其他家胡牌窗口。
                const robOptions: Record<number, { hu: boolean; peng: boolean; gang: boolean }> = {
                  0: { hu: false, peng: false, gang: false },
                  1: { hu: false, peng: false, gang: false },
                  2: { hu: false, peng: false, gang: false },
                  3: { hu: false, peng: false, gang: false },
                };
                let anyRobHu = false;
                for (let s = 0; s < 4; s++) {
                  if (s === seat) continue;
                  const other = next.players[s];
                  if (!other || other.hu || other.playerId === null) continue;
                  if (other.dingque === null) continue;
                  if (suitOf(action.tileKey) === other.dingque) continue;
                  const canHu = (() => {
                    const countsAll = new Array(27).fill(0);
                    for (const t of this.world.things.values()) {
                      if (t.slot.group !== 'hand' || t.slot.seat !== s) continue;
                      const k = tileKeyFromTypeIndex(t.typeIndex);
                      if (k !== null) countsAll[k] += 1;
                    }
                    for (let i = 0; i < 27; i++) {
                      if (countsAll[i] > 0 && suitOf(i) === other.dingque) return false;
                    }
                    countsAll[action.tileKey] += 1;
                    return canHuCounts(countsAll, other.melds.length);
                  })();
                  robOptions[s] = { hu: canHu, peng: false, gang: false };
                  if (canHu) anyRobHu = true;
                }

                if (anyRobHu) {
                  const pendingId = next.nextId;
                  const updated: BloodState = {
                    ...next,
                    pending: {
                      kind: 'claim',
                      id: pendingId,
                      since: Date.now(),
                      trigger: 'addKong',
                      fromSeat: seat,
                      tileId: addTileId,
                      tileKey: action.tileKey,
                      options: robOptions,
                      responses: { 0: null, 1: null, 2: null, 3: null },
                    },
                    nextId: pendingId + 1,
                  };
                  this.logReplay(
                    'gang',
                    { seat, gangType: 'add', fromSeat: peng.fromSeat, tile: tileCode(action.tileKey), pending: true },
                    null,
                  );
                  this.commit(updated);
                  return;
                }

                // 没人可抢：直接执行加杠结算（与旧逻辑一致）
                movedInfos.set(addTileId, {
                  ...addTileInfo,
                  slotName: `meld.${peng.row}.3@${seat}`,
                  // 加杠/补杠：第 4 张用背面区分于直杠（其余 3 张保持碰的“来源方向”展示）
                  rotationIndex: 2,
                  claimedBy: null,
                  shiftSlotName: null,
                });

                if (extraTileId !== null && !movedInfos.has(extraTileId)) {
                  const target = findEmptyHandSlot();
                  const ex = this.client.things.get(extraTileId);
                  if (target && ex) {
                    movedInfos.set(extraTileId, {
                      ...ex,
                      slotName: target,
                      rotationIndex: 0,
                      claimedBy: null,
                      shiftSlotName: null,
                    });
                  }
                }

                const base = next.base;
                const perPay = base; // 加杠：其余未胡玩家各付 1 倍底分
                const transfers: Array<BloodLedgerTransfer> = [];
                let totalGain = 0;
	                for (let s = 0; s < 4; s++) {
	                  if (s === seat) continue;
	                  const other = updatedPlayers[s];
	                  if (!other || other.hu) continue;
	                  updatedPlayers[s] = { ...other, beans: other.beans - perPay };
	                  totalGain += perPay;
	                  transfers.push({ fromSeat: s, toSeat: seat, beans: perPay });
	                }
                updatedPlayers[seat].beans += totalGain;
                updatedPlayers[seat].kongGain += totalGain;
                updatedPlayers[seat].melds = updatedPlayers[seat].melds.map((m) =>
                  m === peng ? { ...m, kind: 'gang', gangType: 'add' } : m
                );

                const ledgerEntry: BloodLedgerEntry = {
                  kind: 'kong',
                  label: '刮风',
                  seat,
                  multiplier: 1,
                  transfers,
                  at: Date.now(),
                };
                this.logReplay(
                  'gang',
                  { seat, gangType: 'add', fromSeat: peng.fromSeat, tile: tileCode(action.tileKey) },
                  null,
                );
                this.logReplay('ledger', { entry: ledgerEntry }, null);
                const updated: BloodState = {
                  ...next,
                  players: updatedPlayers,
                  ledger: [...(next.ledger ?? []), ledgerEntry],
                  afterGangSeat: seat,
                  turnStep: 'drawOrKong',
                };

                this.shadowState = updated;
                this.client.transaction(() => {
                  for (const [tid, tinfo] of movedInfos.entries()) {
                    this.client.things.set(tid, tinfo);
                  }
                  this.client.blood.set(0, updated);
                });
                return;
              }
            }
          }
        }
      }
    }

    // 兜底：回合/响应之外的“非法弃牌”回滚（防止多端乱拖导致并发出牌）
    // 仅处理 hand -> discard（我们先按优先级把“出牌”收敛为规则驱动）。
    if (next.phase === 'playing') {
      let createdClaimPending = false;
      const moves = this.pendingMoves.splice(0);
      for (const mv of moves) {
        if (!mv.from) continue;
        const fromM = /^hand(?:\\.extra|\\.\\d+)?@(\\d)$/.exec(mv.from);
        const toM = /^discard(?:\\..*)?@(\\d)$/.exec(mv.to);
        if (!fromM || !toM) {
          continue;
        }
        const fromSeat = parseInt(fromM[1], 10);
        const toSeat = parseInt(toM[1], 10);

        const legal =
          next.pending === null &&
          next.turnStep === 'discard' &&
          fromSeat === toSeat &&
          fromSeat === next.turnSeat;

        if (!legal) {
          const info = this.client.things.get(mv.thingId);
          if (info) {
            this.client.things.set(mv.thingId, {
              ...info,
              slotName: mv.from,
              rotationIndex: 0,
              claimedBy: null,
              shiftSlotName: null,
            });
          }
          continue;
        }

        // 合法弃牌：生成 pending；若同一帧出现多个弃牌，后续弃牌会因 pending!=null 而在上面的分支被回滚
        const thing = this.world.things.get(mv.thingId);
        if (!thing) {
          continue;
        }
        const tileKey = tileKeyFromTypeIndex(thing.typeIndex);
        if (tileKey === null) {
          continue;
        }

        this.logReplay('discard', { seat: fromSeat, tile: tileCode(tileKey) }, null);

        const options: Record<number, { hu: boolean; peng: boolean; gang: boolean }> = {
          0: { hu: false, peng: false, gang: false },
          1: { hu: false, peng: false, gang: false },
          2: { hu: false, peng: false, gang: false },
          3: { hu: false, peng: false, gang: false },
        };

        // 先计算各家手牌里该牌的张数（用于碰/明杠）
        const counts: Array<number> = [0, 0, 0, 0];
        for (const t of this.world.things.values()) {
          if (t.slot.group !== 'hand' || t.slot.seat === null) continue;
          const s = t.slot.seat;
          const k = tileKeyFromTypeIndex(t.typeIndex);
          if (k === tileKey) {
            counts[s] += 1;
          }
        }

        const wallEmpty = next.wallIndex >= next.wallOrder.length;
        for (let s = 0; s < 4; s++) {
          if (s === fromSeat) continue;
          const ps = next.players[s];
          if (!ps || ps.hu) continue;
          if (ps.dingque === null) continue;
          // 定缺花色的牌不能碰/杠，且胡牌也必须无缺门
          if (suitOf(tileKey) === ps.dingque) {
            continue;
          }
          // 胡牌判定（点炮）：手牌+这张弃牌能否成胡，且手里不能有缺门花色
          const canHu = (() => {
            const countsAll = new Array(27).fill(0);
            for (const t of this.world.things.values()) {
              if (t.slot.group !== 'hand' || t.slot.seat !== s) continue;
              const k = tileKeyFromTypeIndex(t.typeIndex);
              if (k !== null) countsAll[k] += 1;
            }
            for (let i = 0; i < 27; i++) {
              if (countsAll[i] > 0 && suitOf(i) === ps.dingque) {
                return false;
              }
            }
            countsAll[tileKey] += 1;
            return canHuCounts(countsAll, ps.melds.length);
          })();
          options[s] = {
            hu: canHu,
            peng: counts[s] >= 2,
            gang: !wallEmpty && counts[s] >= 3,
          };
        }

        const afterGang = (next.afterGangSeat ?? null) === fromSeat;
        const pendingId = next.nextId;
        next = {
          ...next,
          pending: {
            kind: 'claim',
            id: pendingId,
            since: Date.now(),
            trigger: 'discard',
            afterGang,
            fromSeat,
            tileId: mv.thingId,
            tileKey,
            options,
            responses: { 0: null, 1: null, 2: null, 3: null },
          },
          nextId: pendingId + 1,
          afterGangSeat: afterGang ? null : (next.afterGangSeat ?? null),
        };
        changed = true;
        createdClaimPending = true;
        // 不 break：继续处理本批次里的其它 hand->discard 变动，确保会回滚
      }

      // 兜底：当增量 move 丢失（mv.from=null 或被 full update 吞掉）时，用“弃牌集合差异”识别本轮新弃牌。
      if (!createdClaimPending &&
          discardPrev &&
          next.pending === null &&
          next.turnStep === 'discard') {
        const seat = next.turnSeat;
        const prevSet = discardPrev[seat];
        const curSet = discardNow[seat];
        if (curSet.size > prevSet.size) {
          let newTileId: number | null = null;
          for (const id of curSet) {
            if (!prevSet.has(id)) {
              newTileId = id;
              break;
            }
          }
          if (newTileId !== null) {
            const thing = this.world.things.get(newTileId);
            const tileKey = thing ? tileKeyFromTypeIndex(thing.typeIndex) : null;
            if (tileKey !== null) {
              const fromSeat = seat;
              this.logReplay('discard', { seat: fromSeat, tile: tileCode(tileKey) }, null);
              const options: Record<number, { hu: boolean; peng: boolean; gang: boolean }> = {
                0: { hu: false, peng: false, gang: false },
                1: { hu: false, peng: false, gang: false },
                2: { hu: false, peng: false, gang: false },
                3: { hu: false, peng: false, gang: false },
              };

              const counts: Array<number> = [0, 0, 0, 0];
              for (const t of this.world.things.values()) {
                if (t.slot.group !== 'hand' || t.slot.seat === null) continue;
                const s = t.slot.seat;
                const k = tileKeyFromTypeIndex(t.typeIndex);
                if (k === tileKey) counts[s] += 1;
              }

              const wallEmpty = next.wallIndex >= next.wallOrder.length;
              for (let s = 0; s < 4; s++) {
                if (s === fromSeat) continue;
                const ps = next.players[s];
                if (!ps || ps.hu) continue;
                if (ps.dingque === null) continue;
                if (suitOf(tileKey) === ps.dingque) continue;
                const canHu = (() => {
                  const countsAll = new Array(27).fill(0);
                  for (const t of this.world.things.values()) {
                    if (t.slot.group !== 'hand' || t.slot.seat !== s) continue;
                    const k = tileKeyFromTypeIndex(t.typeIndex);
                    if (k !== null) countsAll[k] += 1;
                  }
                  for (let i = 0; i < 27; i++) {
                    if (countsAll[i] > 0 && suitOf(i) === ps.dingque) return false;
                  }
                  countsAll[tileKey] += 1;
                  return canHuCounts(countsAll, ps.melds.length);
                })();
                options[s] = {
                  hu: canHu,
                  peng: counts[s] >= 2,
                  gang: !wallEmpty && counts[s] >= 3,
                };
              }

              const afterGang = (next.afterGangSeat ?? null) === fromSeat;
              const pendingId = next.nextId;
              next = {
                ...next,
                pending: {
                  kind: 'claim',
                  id: pendingId,
                  since: Date.now(),
                  trigger: 'discard',
                  afterGang,
                  fromSeat,
                  tileId: newTileId,
                  tileKey,
                  options,
                  responses: { 0: null, 1: null, 2: null, 3: null },
                },
                nextId: pendingId + 1,
                afterGangSeat: afterGang ? null : (next.afterGangSeat ?? null),
              };
              changed = true;
            }
          }
        }
      }
    }

    // 阶段推进：定缺结束 -> 开始打牌（后续步骤会补齐摸牌/弃牌/响应）
    if (next.phase === 'dingque') {
      const allReady =
        [0, 1, 2, 3].every((s) => next.players[s].playerId !== null && next.players[s].dingque !== null);
      if (allReady) {
        next = {
          ...next,
          phase: 'playing',
          turnSeat: next.dealer,
          turnStep: 'discard',
        };
        changed = true;
      }
    }

    // 生成牌墙抽牌顺序（只生成一次）
    if (next.phase === 'playing' && next.wallOrder.length === 0) {
      const wallTiles: Array<{ tileId: number; seat: number; col: number; stack: number }> = [];
      for (const [tileId, info] of this.client.things.entries()) {
        const slot = info.slotName;
        const m = /^wall\.(\d+)\.(\d+)@(\d)$/.exec(slot);
        if (!m) {
          continue;
        }
        wallTiles.push({
          tileId,
          col: parseInt(m[1], 10),
          stack: parseInt(m[2], 10),
          seat: parseInt(m[3], 10),
        });
      }
      // 默认抽牌顺序：按座位 -> 列 -> 上层(1)先于下层(0)
      wallTiles.sort((a, b) =>
        (a.seat - b.seat) ||
        (a.col - b.col) ||
        (b.stack - a.stack)
      );
      const wallOrder = wallTiles.map((t) => t.tileId);
      next = {
        ...next,
        wallOrder,
        wallIndex: 0,
      };
      changed = true;
    }

    // 识别“弃牌”动作：玩家把自己手牌拖入自己弃牌区
    // 自动摸牌（摸到 hand.extra@seat），只在没有 pending 响应时进行
    if (next.phase === 'playing' && next.pending === null) {
      normalizeWallIndex();
      const seat = next.turnSeat;
      const player = next.players[seat];
      if (player && !player.hu && next.turnStep === 'drawOrKong') {
        const extraSlot = `hand.extra@${seat}`;
        let extraTileId: number | null = null;
        let mainHandCount = 0;
        const occupiedHandSlots = new Set<string>();
        for (const [tileId, info] of this.client.things.entries()) {
          const slotName = info.slotName;
          if (!slotName.endsWith(`@${seat}`)) continue;
          if (!slotName.startsWith('hand.')) continue;
          occupiedHandSlots.add(slotName);
          if (slotName === extraSlot) {
            extraTileId = tileId;
          } else if (!slotName.startsWith('hand.extra')) {
            mainHandCount += 1;
          }
        }

        // 异常容错：若处于“摸牌阶段(drawOrKong)”但 hand.extra 已被占用，会导致无法摸牌而卡住。
        // 常见原因：玩家整理手牌时把一张牌拖到了 hand.extra，或发生回滚/全量同步后 slot 留在 extra。
        // 处理策略：
        // - 若主手牌已满 13 且 extra 也有牌：视为“已经摸了牌但回合步骤未推进”，直接推进到 discard。
        // - 若主手牌不足 13 且 extra 有牌：把 extra 那张挪回一个空的 hand.i，腾出 extra 再摸牌。
        if (extraTileId !== null) {
          if (mainHandCount >= 13) {
            this.commit({ ...next, turnStep: 'discard' });
            return;
          }

          let emptyHandSlot: string | null = null;
          for (let i = 0; i < 14; i++) {
            const slot = `hand.${i}@${seat}`;
            if (!occupiedHandSlots.has(slot)) {
              emptyHandSlot = slot;
              break;
            }
          }

          if (emptyHandSlot) {
            const extraInfo = this.client.things.get(extraTileId);
            if (extraInfo) {
              // 若还能摸牌，则在一个事务里同时“清空 extra + 摸牌 + 推进回合”，避免中间态被其他端看到。
              if (next.wallIndex < next.wallOrder.length) {
                const drawTileId = next.wallOrder[next.wallIndex];
                const drawInfo = this.client.things.get(drawTileId);
                if (drawInfo && drawInfo.slotName.startsWith('wall.')) {
                  const movedExtra: ThingInfo = {
                    ...extraInfo,
                    slotName: emptyHandSlot,
                    rotationIndex: 0,
                    claimedBy: null,
                    shiftSlotName: null,
                  };
                  const movedDraw: ThingInfo = {
                    ...drawInfo,
                    slotName: extraSlot,
                    rotationIndex: 0,
                    claimedBy: null,
                    shiftSlotName: null,
                  };
                  const drawn = this.tileCodeFromThingId(drawTileId);
                  if (drawn) {
                    this.logReplay('draw', { seat }, { [String(seat)]: { tile: drawn } });
                  } else {
                    this.logReplay('draw', { seat }, null);
                  }
                  const updated: BloodState = {
                    ...next,
                    wallIndex: next.wallIndex + 1,
                    turnStep: 'discard',
                  };
                  this.shadowState = updated;
                  this.client.transaction(() => {
                    this.client.things.set(extraTileId!, movedExtra);
                    this.client.things.set(drawTileId, movedDraw);
                    this.client.blood.set(0, updated);
                  });
                  return;
                }
              }

              // 只先把 extra 挪回主手牌，等下一次 tick 再摸牌。
              this.client.things.set(extraTileId, {
                ...extraInfo,
                slotName: emptyHandSlot,
                rotationIndex: 0,
                claimedBy: null,
                shiftSlotName: null,
              });
              return;
            }
          }
        }

        if (extraTileId === null && next.wallIndex < next.wallOrder.length) {
          const tileId = next.wallOrder[next.wallIndex];
          const info = this.client.things.get(tileId);
          if (info && info.slotName.startsWith('wall.')) {
            const drawn = this.tileCodeFromThingId(tileId);
            if (drawn) {
              this.logReplay('draw', { seat }, { [String(seat)]: { tile: drawn } });
            } else {
              this.logReplay('draw', { seat }, null);
            }
            const moved: ThingInfo = {
              ...info,
              slotName: extraSlot,
              rotationIndex: 0,
              claimedBy: null,
              shiftSlotName: null,
            };
            const updated: BloodState = {
              ...next,
              wallIndex: next.wallIndex + 1,
              turnStep: 'discard',
            };
            // 原子更新：先更新牌的移动，再更新 blood 状态
            this.shadowState = updated;
            this.client.transaction(() => {
              this.client.things.set(tileId, moved);
              this.client.blood.set(0, updated);
            });
            return;
          }
        }
      }
    }

    // 处理 pending（碰/杠/胡/过）：MVP 先实现“碰”和“全过进入下一家”
    if (next.phase === 'playing' && next.pending?.kind === 'claim') {
      const pending = next.pending;
      const seatsNeedingResponse: Array<number> = [];
      for (let s = 0; s < 4; s++) {
        const opt = pending.options[s];
        if (opt && (opt.hu || opt.peng || opt.gang)) {
          seatsNeedingResponse.push(s);
        }
      }
      const timedOut = typeof pending.since === 'number' && Date.now() - pending.since > this.claimTimeoutMs;
      const allResponded = timedOut || seatsNeedingResponse.every((s) => pending.responses[s] !== null);
      if (allResponded) {
        const resp = (s: number) => pending.responses[s] ?? 'pass';
        const wallEmpty = next.wallIndex >= next.wallOrder.length;
        const respondersPeng = seatsNeedingResponse.filter((s) => resp(s) === 'peng');
        const respondersGang = wallEmpty ? [] : seatsNeedingResponse.filter((s) => resp(s) === 'gang');
        const respondersHu = seatsNeedingResponse.filter((s) => resp(s) === 'hu');

        // 优先级：胡 > 杠 > 碰（胡/杠在后续步骤补齐）
        if (respondersHu.length > 0) {
          // 点炮胡：允许一炮多响；点炮者分别付给每个胡牌者 1 倍底分
          const winners: Array<number> = [];
          for (const s of respondersHu) {
            const ps = next.players[s];
            if (!ps || ps.hu || ps.dingque === null) continue;
            if (suitOf(pending.tileKey) === ps.dingque) continue;
            const countsAll = new Array(27).fill(0);
            for (const t of this.world.things.values()) {
              if (t.slot.group !== 'hand' || t.slot.seat !== s) continue;
              const k = tileKeyFromTypeIndex(t.typeIndex);
              if (k !== null) countsAll[k] += 1;
            }
            let hasDingque = false;
            for (let i = 0; i < 27; i++) {
              if (countsAll[i] > 0 && suitOf(i) === ps.dingque) {
                hasDingque = true;
                break;
              }
            }
            if (hasDingque) continue;
            countsAll[pending.tileKey] += 1;
            if (canHuCounts(countsAll, ps.melds.length)) {
              winners.push(s);
            }
          }

          if (winners.length > 0) {
            const base = next.base;
            const updatedPlayers = { ...next.players };
            const ledgerEntries: Array<BloodLedgerEntry> = [];
            const now = Date.now();
            const trigger = pending.trigger ?? 'discard';
            const isQiangGangHu = trigger === 'addKong';
            const isGangShangPao = trigger === 'discard' && Boolean(pending.afterGang);
            const huLabel = isQiangGangHu ? '抢杠胡' : isGangShangPao ? '杠上炮' : '点炮';
            const huEvents: HuEvents = { gangShangPao: isGangShangPao, qiangGangHu: isQiangGangHu };

            for (const w of winners) {
              const wps = next.players[w];
              if (!wps) continue;

              const concealedTiles: Array<number> = [];
              for (const t of this.world.things.values()) {
                if (t.slot.group !== 'hand' || t.slot.seat !== w) continue;
                const k = tileKeyFromTypeIndex(t.typeIndex);
                if (k !== null) concealedTiles.push(k);
              }
              concealedTiles.push(pending.tileKey);

              const melds = wps.melds.map((m) => ({ kind: m.kind, tileKey: m.tileKey, gangType: m.gangType }));

              const calc = calcBloodHu(
                { concealedTiles, melds } as HuCalcHand,
                { base, huMethod: 'dianpao', events: huEvents },
              );
              if (!calc.ok) continue;

              const pay = calc.perOpponent;

              updatedPlayers[pending.fromSeat] = {
                ...updatedPlayers[pending.fromSeat],
                beans: updatedPlayers[pending.fromSeat].beans - pay,
              };
              updatedPlayers[w] = {
                ...updatedPlayers[w],
                beans: updatedPlayers[w].beans + pay,
                hu: true,
                huTileKey: pending.tileKey,
                huSource: 'discard',
              };

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
              this.logReplay(
                'hu',
                { source: 'discard', fromSeat: pending.fromSeat, tile: tileCode(pending.tileKey), winners: [...appliedWinners] },
                null,
              );

              // 血战到底：点炮胡后，胡牌者视为“本次最后行动玩家”，
              // 下一轮从“胡牌者的下家”开始（跳过已胡/空座位）。
              // 一炮多响时，用“离点炮者最远的胡牌者”（按顺时针座次）作为锚点，保证确定性。
              let anchorSeat: number = appliedWinners[0]!;
              for (let i = 1; i <= 4; i++) {
                const s = (pending.fromSeat + i) % 4;
                if (appliedWinners.includes(s)) {
                  anchorSeat = s;
                }
              }

              const nextSeat = (() => {
                for (let i = 1; i <= 4; i++) {
                  const s = (anchorSeat + i) % 4;
                  const p = updatedPlayers[s];
                  if (p && !p.hu && p.playerId !== null) return s;
                }
                return null;
              })();

              next = {
                ...next,
                pending: null,
                players: updatedPlayers,
                ledger: [...(next.ledger ?? []), ...ledgerEntries],
                afterGangSeat: null,
                turnSeat: nextSeat ?? pending.fromSeat,
                turnStep: 'drawOrKong',
              };
              // 方案B：点炮胡后，被胡的那张弃牌要从弃牌区“拿走”（不再保留在弃牌区）。
              // 由于一炮多响需要在多个胡家各显示一张“复制的胡牌”，这里不移动真实牌到胡家，
              // 而是把这张弃牌移动到一个隐藏槽位（渲染层会用 overlay 额外渲染胡牌牌面）。
              const takeSlot = (() => {
                for (let i = 0; i < 16; i++) {
                  const name = `hu.taken.${i}`;
                  let occupied = false;
                  for (const [, info] of this.client.things.entries()) {
                    if (info.slotName === name) {
                      occupied = true;
                      break;
                    }
                  }
                  if (!occupied) {
                    return name;
                  }
                }
                return null;
              })();

              const takenInfo = this.client.things.get(pending.tileId);
              if (takeSlot && takenInfo) {
                const moved: ThingInfo = {
                  ...takenInfo,
                  slotName: takeSlot,
                  rotationIndex: 0,
                  claimedBy: null,
                  shiftSlotName: null,
                };

                const updated: BloodState = next;
                this.shadowState = updated;
                this.client.transaction(() => {
                  this.client.things.set(pending.tileId, moved);
                  this.client.blood.set(0, updated);
                });
                return;
              }

              changed = true;
            }
          }
        } else if (respondersGang.length > 0) {
          // 明杠：按“离弃牌者最近”优先（直杠）
          let winner: number | null = null;
          for (let i = 1; i <= 4; i++) {
            const s = (pending.fromSeat + i) % 4;
            if (respondersGang.includes(s)) {
              winner = s;
              break;
            }
          }

          if (winner !== null) {
            const takeFromHand: Array<number> = [];
            for (const t of this.world.things.values()) {
              if (t.slot.group !== 'hand' || t.slot.seat !== winner) continue;
              const k = tileKeyFromTypeIndex(t.typeIndex);
              if (k === pending.tileKey) {
                takeFromHand.push(t.index);
              }
            }
            takeFromHand.sort((a, b) => a - b);
            const need = 3;
            if (takeFromHand.length >= need) {
              const usedRows = new Set<number>(next.players[winner].melds.map((m) => m.row));
              let row = 0;
              while (usedRows.has(row) && row < 4) row++;
              if (row < 4) {
                const targetSlots = [
                  `meld.${row}.0@${winner}`,
                  `meld.${row}.1@${winner}`,
                  `meld.${row}.2@${winner}`,
                  `meld.${row}.3@${winner}`,
                ];

                const ids = [pending.tileId, takeFromHand[0], takeFromHand[1], takeFromHand[2]];
                const infos = ids.map((id) => this.client.things.get(id));
                if (infos.every((x) => x !== null)) {
                  // 明杠展示：四张都亮面，且“弃牌来的那张”用横放表示来源方向（以杠牌者视角）
                  // - 上家(左) 点炮：竖 横 竖 竖
                  // - 对家(上) 点炮：竖 竖 横 竖
                  // - 下家(右) 点炮：竖 竖 竖 横
                  const relFrom = ((pending.fromSeat - winner) % 4 + 4) % 4; // 1=右,2=对,3=左
                  const [slot0, slot1, slot2, slot3] = targetSlots;
                  const calledSlot = relFrom === 3 ? slot2 : relFrom === 2 ? slot1 : slot0;
                  const otherSlots: [string, string, string] =
                    relFrom === 3 ? [slot0, slot1, slot3] :
                    relFrom === 2 ? [slot0, slot2, slot3] :
                    [slot1, slot2, slot3];

                  const movedInfos = new Map<number, ThingInfo>();
                  movedInfos.set(pending.tileId, {
                    ...(infos[0] as ThingInfo),
                    slotName: calledSlot,
                    rotationIndex: 1,
                    claimedBy: null,
                    shiftSlotName: null,
                  });
                  movedInfos.set(takeFromHand[0], {
                    ...(infos[1] as ThingInfo),
                    slotName: otherSlots[0],
                    rotationIndex: 0,
                    claimedBy: null,
                    shiftSlotName: null,
                  });
                  movedInfos.set(takeFromHand[1], {
                    ...(infos[2] as ThingInfo),
                    slotName: otherSlots[1],
                    rotationIndex: 0,
                    claimedBy: null,
                    shiftSlotName: null,
                  });
                  movedInfos.set(takeFromHand[2], {
                    ...(infos[3] as ThingInfo),
                    slotName: otherSlots[2],
                    rotationIndex: 0,
                    claimedBy: null,
                    shiftSlotName: null,
                  });

                  const base = next.base;
                  const gain = base * 2; // 明杠：被杠玩家付 2 倍底分

                  const updatedPlayers = { ...next.players };
                  updatedPlayers[winner] = { ...updatedPlayers[winner] };
                  updatedPlayers[pending.fromSeat] = { ...updatedPlayers[pending.fromSeat] };
                  updatedPlayers[winner].melds = [
                    ...updatedPlayers[winner].melds,
                    { kind: 'gang', tileKey: pending.tileKey, fromSeat: pending.fromSeat, gangType: 'ming', row },
                  ];
                  updatedPlayers[winner].beans += gain;
                  updatedPlayers[winner].kongGain += gain;
                  updatedPlayers[pending.fromSeat].beans -= gain;

                  const ledgerEntry: BloodLedgerEntry = {
                    kind: 'kong',
                    label: '刮风',
                    multiplier: 2,
                    transfers: [{ fromSeat: pending.fromSeat, toSeat: winner, beans: gain }],
                    at: Date.now(),
                  };
                  this.logReplay(
                    'gang',
                    { seat: winner, gangType: 'ming', fromSeat: pending.fromSeat, tile: tileCode(pending.tileKey) },
                    null,
                  );
                  this.logReplay('ledger', { entry: ledgerEntry }, null);
                  const updated: BloodState = {
                    ...next,
                    pending: null,
                    players: updatedPlayers,
                    ledger: [...(next.ledger ?? []), ledgerEntry],
                    afterGangSeat: winner,
                    // 杠后补张，继续由杠家行动
                    turnSeat: winner,
                    turnStep: 'drawOrKong',
                  };

                  this.shadowState = updated;
                  this.client.transaction(() => {
                    for (const [id, info] of movedInfos.entries()) {
                      this.client.things.set(id, info);
                    }
                    this.client.blood.set(0, updated);
                  });
                  return;
                }
              }
            }
          }
        } else if (respondersPeng.length > 0) {
          // 碰：按“离弃牌者最近”优先
          let winner: number | null = null;
          for (let i = 1; i <= 4; i++) {
            const s = (pending.fromSeat + i) % 4;
            if (respondersPeng.includes(s)) {
              winner = s;
              break;
            }
          }

          if (winner !== null) {
            // 找两张同牌从赢家手牌移入副露
            const takeFromHand: Array<number> = [];
            for (const t of this.world.things.values()) {
              if (t.slot.group !== 'hand' || t.slot.seat !== winner) continue;
              const k = tileKeyFromTypeIndex(t.typeIndex);
              if (k === pending.tileKey) {
                takeFromHand.push(t.index);
              }
            }
            takeFromHand.sort((a, b) => a - b);
            const need = 2;
            if (takeFromHand.length >= need) {
              const usedRows = new Set<number>(next.players[winner].melds.map((m) => m.row));
              let row = 0;
              while (usedRows.has(row) && row < 4) row++;
              if (row < 4) {
                const targetSlots = [
                  `meld.${row}.0@${winner}`,
                  `meld.${row}.1@${winner}`,
                  `meld.${row}.2@${winner}`,
                ];

                const ids = [pending.tileId, takeFromHand[0], takeFromHand[1]];
                const infos = ids.map((id) => this.client.things.get(id));
                if (infos.every((x) => x !== null)) {
                  // 碰牌展示：横放位置=来源方向（以碰牌者视角）
                  // - 上家(左) 点炮：横放最左
                  // - 对家(上) 点炮：横放中间
                  // - 下家(右) 点炮：横放最右
                  const relFrom = ((pending.fromSeat - winner) % 4 + 4) % 4; // 1=右,2=对,3=左
                  const [slot0, slot1, slot2] = targetSlots;
                  const calledSlot = relFrom === 3 ? slot2 : relFrom === 2 ? slot1 : slot0;
                  const otherSlots: [string, string] =
                    relFrom === 3 ? [slot0, slot1] :
                    relFrom === 2 ? [slot0, slot2] :
                    [slot1, slot2];

                  const movedInfos = new Map<number, ThingInfo>();
                  movedInfos.set(pending.tileId, {
                    ...(infos[0] as ThingInfo),
                    slotName: calledSlot,
                    rotationIndex: 1,
                    claimedBy: null,
                    shiftSlotName: null,
                  });
                  movedInfos.set(takeFromHand[0], {
                    ...(infos[1] as ThingInfo),
                    slotName: otherSlots[0],
                    rotationIndex: 0,
                    claimedBy: null,
                    shiftSlotName: null,
                  });
                  movedInfos.set(takeFromHand[1], {
                    ...(infos[2] as ThingInfo),
                    slotName: otherSlots[1],
                    rotationIndex: 0,
                    claimedBy: null,
                    shiftSlotName: null,
                  });

                  const updatedPlayers = { ...next.players, [winner]: { ...next.players[winner] } };
                  updatedPlayers[winner].melds = [
                    ...updatedPlayers[winner].melds,
                    { kind: 'peng', tileKey: pending.tileKey, fromSeat: pending.fromSeat, row },
                  ];

                  const updated: BloodState = {
                    ...next,
                    pending: null,
                    players: updatedPlayers,
                    turnSeat: winner,
                    turnStep: 'discard',
                  };

                  this.logReplay('peng', { seat: winner, fromSeat: pending.fromSeat, tile: tileCode(pending.tileKey) }, null);

                  this.shadowState = updated;
                  this.client.transaction(() => {
                    for (const [id, info] of movedInfos.entries()) {
                      this.client.things.set(id, info);
                    }
                    this.client.blood.set(0, updated);
                  });
                  return;
                }
              }
            }
          }
        } else {
          const trigger = pending.trigger ?? 'discard';

          // 加杠无人抢：执行加杠并补张（继续由杠家行动）
          if (trigger === 'addKong') {
            const seat = pending.fromSeat;
            const ps = next.players[seat];
            if (ps && !ps.hu && ps.dingque !== null && suitOf(pending.tileKey) !== ps.dingque) {
              const extraSlot = `hand.extra@${seat}`;
              let extraTileId: number | null = null;
              for (const [id, info] of this.client.things.entries()) {
                if (info.slotName === extraSlot) {
                  extraTileId = id;
                  break;
                }
              }

              const findEmptyHandSlot = (): string | null => {
                const occupied = new Set<string>();
                for (const [, info] of this.client.things.entries()) {
                  if (info.slotName.startsWith('hand.') && info.slotName.endsWith(`@${seat}`) && !info.slotName.startsWith('hand.extra')) {
                    occupied.add(info.slotName);
                  }
                }
                for (let i = 0; i < 14; i++) {
                  const slot = `hand.${i}@${seat}`;
                  if (!occupied.has(slot)) return slot;
                }
                return null;
              };

              const movedInfos = new Map<number, ThingInfo>();
              const updatedPlayers = { ...next.players };
              updatedPlayers[seat] = { ...updatedPlayers[seat] };

              const peng = updatedPlayers[seat].melds.find((m) => m.kind === 'peng' && m.tileKey === pending.tileKey) ?? null;
              const info = this.client.things.get(pending.tileId) ?? null;
              if (peng && info) {
                movedInfos.set(pending.tileId, {
                  ...info,
                  slotName: `meld.${peng.row}.3@${seat}`,
                  rotationIndex: 2,
                  claimedBy: null,
                  shiftSlotName: null,
                });

                if (extraTileId !== null && !movedInfos.has(extraTileId)) {
                  const target = findEmptyHandSlot();
                  const ex = this.client.things.get(extraTileId);
                  if (target && ex) {
                    movedInfos.set(extraTileId, {
                      ...ex,
                      slotName: target,
                      rotationIndex: 0,
                      claimedBy: null,
                      shiftSlotName: null,
                    });
                  }
                }

                const base = next.base;
                const perPay = base; // 加杠：其余未胡玩家各付 1 倍底分
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
                updatedPlayers[seat].melds = updatedPlayers[seat].melds.map((m) =>
                  m === peng ? { ...m, kind: 'gang', gangType: 'add' } : m
                );

                const ledgerEntry: BloodLedgerEntry = {
                  kind: 'kong',
                  label: '刮风',
                  multiplier: 1,
                  transfers,
                  at: Date.now(),
                };
                this.logReplay(
                  'gang',
                  { seat, gangType: 'add', fromSeat: peng.fromSeat, tile: tileCode(pending.tileKey) },
                  null,
                );
                this.logReplay('ledger', { entry: ledgerEntry }, null);

                const updated: BloodState = {
                  ...next,
                  pending: null,
                  players: updatedPlayers,
                  ledger: [...(next.ledger ?? []), ledgerEntry],
                  afterGangSeat: seat,
                  // 加杠后补张，继续由杠家行动
                  turnSeat: seat,
                  turnStep: 'drawOrKong',
                };

                this.shadowState = updated;
                this.client.transaction(() => {
                  for (const [tid, tinfo] of movedInfos.entries()) {
                    this.client.things.set(tid, tinfo);
                  }
                  this.client.blood.set(0, updated);
                });
                return;
              }
            }
          }

          // 弃牌无人碰/杠/胡：轮到下一家摸牌
          const nextSeat = (() => {
            for (let i = 1; i <= 4; i++) {
              const s = (pending.fromSeat + i) % 4;
              const ps = next.players[s];
              if (ps && !ps.hu && ps.playerId !== null) return s;
            }
            return null;
          })();
          if (nextSeat !== null) {
            next = { ...next, pending: null, turnSeat: nextSeat, turnStep: 'drawOrKong' };
            changed = true;
          }
        }
      }
    }

    // 结束条件：
    // - 3 人胡：立即结束
    // - 牌墙摸完：仅在需要“轮到某人摸牌”但已无牌可摸时结束（最后一张摸起后仍允许弃牌/响应）
    if (next.phase === 'playing' && next.pending === null) {
      const huCount = [0, 1, 2, 3].filter((s) => next.players[s]?.hu).length;
      const wallEmpty = next.wallIndex >= next.wallOrder.length;
      const noTileToDraw = wallEmpty && next.turnStep === 'drawOrKong';
      if (huCount >= 3 || noTileToDraw) {
        const base = next.base;
        const initialBeans = next.initialBeans ?? 0;
        const initialBeansBySeat = next.initialBeansBySeat ?? {
          0: initialBeans,
          1: initialBeans,
          2: initialBeans,
          3: initialBeans,
        };
        const ledgerBeforeEnd = [...(next.ledger ?? [])];

        const updatedPlayers = { ...next.players };
        const isActive = (seat: number): boolean => updatedPlayers[seat]?.playerId !== null;
        const activeSeats = [0, 1, 2, 3].filter(isActive);

        const concealedTilesForSeat = (seat: number): Array<number> => {
          const tiles: Array<number> = [];
          for (const t of this.world.things.values()) {
            if (t.slot.group !== 'hand' || t.slot.seat !== seat) continue;
            const k = tileKeyFromTypeIndex(t.typeIndex);
            if (k !== null) tiles.push(k);
          }
          return tiles;
        };

        const isPigBySeat: Record<number, boolean> = { 0: false, 1: false, 2: false, 3: false };
        for (let s = 0; s < 4; s++) {
          const ps = updatedPlayers[s];
          if (!ps || ps.playerId === null || ps.dingque === null) continue;
          for (const t of this.world.things.values()) {
            if (t.slot.group !== 'hand' || t.slot.seat !== s) continue;
            const k = tileKeyFromTypeIndex(t.typeIndex);
            if (k !== null && suitOf(k) === ps.dingque) {
              isPigBySeat[s] = true;
              break;
            }
          }
        }

        // 公开可证绝张（死听剔除）：仅使用“公开可见信息”=弃牌+副露（暗杠为亮杠，计入公开可见范围）。
        const publicCounts = new Array<number>(27).fill(0);
        for (const t of this.world.things.values()) {
          if (t.slot.group !== 'discard' && t.slot.group !== 'hu.taken') continue;
          const k = tileKeyFromTypeIndex(t.typeIndex);
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

        // 结算用“听牌/最大番”（点炮口径、仅牌型+根、不计自摸×2/过程事件；且剔除“公开可证绝张”）
        const seatsSummary: Record<number, BloodSeatEndSummary> = {
          0: { isActive: false, hu: false, isPig: false, ting: false, waits: [], maxWaits: [], maxMultiplier: 0, maxMultiplierRaw: 0, maxFans: [] },
          1: { isActive: false, hu: false, isPig: false, ting: false, waits: [], maxWaits: [], maxMultiplier: 0, maxMultiplierRaw: 0, maxFans: [] },
          2: { isActive: false, hu: false, isPig: false, ting: false, waits: [], maxWaits: [], maxMultiplier: 0, maxMultiplierRaw: 0, maxFans: [] },
          3: { isActive: false, hu: false, isPig: false, ting: false, waits: [], maxWaits: [], maxMultiplier: 0, maxMultiplierRaw: 0, maxFans: [] },
        };

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

          const concealed = concealedTilesForSeat(s);
          const melds = ps.melds.map((m) => ({ kind: m.kind, tileKey: m.tileKey, gangType: m.gangType }));

          const waits: Array<number> = [];
          let maxMultiplier = 0;
          let maxMultiplierRaw = 0;
          let maxFans: Array<{ id: string; name: string; multiplier: number }> = [];
          let maxWaits: Array<number> = [];

          for (let tileKey = 0; tileKey < 27; tileKey++) {
            if (suitOf(tileKey) === ps.dingque) continue;
            if ((publicCounts[tileKey] ?? 0) >= 4) continue;
            const calc = calcBloodHu(
              { concealedTiles: [...concealed, tileKey], melds } as HuCalcHand,
              { base, huMethod: 'dianpao', events: {} },
            );
            if (!calc.ok) continue;
            waits.push(tileKey);
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
        const now = Date.now();
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

        next = {
          ...next,
          phase: 'settling',
          revealAllHands: true,
          settlingSince: null,
          afterGangSeat: null,
          players: updatedPlayers,
          pending: null,
          ledger: [...ledgerBeforeEnd, ...penaltyEntries],
          endSummary: { initialBeans, initialBeansBySeat, base, cap: 0, seats: seatsSummary },
        };
        changed = true;
      }
    }

    if (changed) {
      this.commit(next);
    }
    this.discardSnapshot = discardNow;
  }

  private nextReplaySeq(): number {
    const now = Date.now();
    const seq = now <= this.replaySeq ? this.replaySeq + 1 : now;
    this.replaySeq = seq;
    return seq;
  }

  private logReplay(type: string, publicPayload: any, privateBySeat: Record<string, any> | null): void {
    if (!this.client.connected()) {
      return;
    }
    const ev: any = {
      seq: this.nextReplaySeq(),
      at: Date.now(),
      type,
      public: publicPayload ?? null,
    };
    if (privateBySeat && Object.keys(privateBySeat).length > 0) {
      ev.private = privateBySeat;
    }
    this.client.sendReplayLog([ev]);
  }

  private tileCodeFromThingId(tileId: number): string | null {
    const thing = this.world.things.get(tileId) ?? null;
    if (!thing) return null;
    const k = tileKeyFromTypeIndex(thing.typeIndex);
    if (k === null) return null;
    return tileCode(k);
  }

  private handCodesForSeat(seat: number): Array<string> {
    const items: Array<{ order: number; slotName: string; code: string }> = [];
    for (const t of this.world.things.values()) {
      if (t.slot.group !== 'hand' || t.slot.seat !== seat) continue;
      const k = tileKeyFromTypeIndex(t.typeIndex);
      if (k === null) continue;
      const slotName = t.slot.name;
      const m = /^hand\.(\d+)@/.exec(slotName);
      const order = slotName.startsWith('hand.extra') ? 1000 : m ? parseInt(m[1] ?? '999', 10) : 999;
      items.push({ order, slotName, code: tileCode(k) });
    }
    items.sort((a, b) => (a.order - b.order) || a.slotName.localeCompare(b.slotName));
    return items.map((x) => x.code);
  }

  private maybeLogStateDiff(prev: BloodState | null, next: BloodState): void {
    if (!prev) return;

    if (prev.phase !== next.phase) {
      this.logReplay('phase', { from: prev.phase, to: next.phase }, null);
    }

    for (let s = 0; s < 4; s++) {
      const before = prev.players?.[s]?.dingque ?? null;
      const after = next.players?.[s]?.dingque ?? null;
      if (before === null && after !== null) {
        this.logReplay('dingque', { seat: s, suit: after }, null);
      }
    }

    // swap3 selection is private: record which 3 tiles (as codes) the seat picked.
    if (prev.phase === 'swap3' && next.phase === 'swap3' && prev.swap3 && next.swap3) {
      for (let s = 0; s < 4; s++) {
        const before = prev.swap3.selections?.[s] ?? null;
        const after = next.swap3.selections?.[s] ?? null;
        if (before === null && Array.isArray(after) && after.length === 3) {
          const codes = after.map((id) => this.tileCodeFromThingId(id)).filter(Boolean) as Array<string>;
          this.logReplay('swap3_select', { seat: s }, { [String(s)]: { tiles: codes } });
        }
      }
    }

    // Initial hands snapshot once the game starts playing.
    if (!this.replayHandsLogged && prev.phase !== 'playing' && next.phase === 'playing') {
      this.replayHandsLogged = true;
      const priv: Record<string, any> = {};
      for (let s = 0; s < 4; s++) {
        if (next.players[s]?.playerId === null) continue;
        priv[String(s)] = { hand: this.handCodesForSeat(s) };
      }
      this.logReplay('hands', { phase: 'playing' }, priv);
    }

    const enteredEnd =
      (prev.phase !== 'settling' && next.phase === 'settling') ||
      (prev.phase !== 'done' && next.phase === 'done');
    if (enteredEnd) {
      const beans: Record<string, number> = {};
      for (let s = 0; s < 4; s++) {
        const b = next.players[s]?.beans ?? null;
        if (typeof b === 'number' && Number.isFinite(b)) beans[String(s)] = Math.trunc(b);
      }
      this.logReplay('end', { beans, endSummary: next.endSummary ?? null }, null);
    }
  }
}
