import type { BloodSuit } from './blood-types';
import type { CalcMeld } from './blood-calc-notation';
import { calcBloodHu } from '../blood-calc-engine';
import { rankOf, suitOf, tileCode } from './blood-tiles';
import { isWinPinghu, shantenPinghu } from './ev-engine';

export type SplitStage = 'early' | 'mid' | 'late';
export type SplitRoute = 'standard' | 'sevenPairs';

export type SplitOpponent = { dingque: BloodSuit | null; hu: boolean };

export type TenpaiWaitDetail = {
  tileKey: number;
  remain: number;
  ronGain: number;
  zimoGain: number;
  ronMultiplier: number;
  zimoMultiplier: number;
};

export type TenpaiSummary = {
  winTiles: Array<number>;
  winKinds: number;
  winCount: number;
  waits: Array<TenpaiWaitDetail>;
  avgRonGain: number;
  avgZimoGain: number;
};

export type ImproveSummary = {
  improveTiles: Array<number>;
  improveKinds: number;
  improveCount: number;
  pImprove: number | null;
};

export type StateSummary = {
  key: string;
  shanten: number;
  blockedByDingque: boolean;
  windowScore: number;
  tenpai: TenpaiSummary | null;
  improve: ImproveSummary | null;
};

export type DrawAfterDiscard = {
  drawTile: number;
  remain: number;
  bestDiscard: number;
  nextShanten: number;
  nextKey: string;
  sameTierDiscards: Array<number>;
};

export type StateDetails = {
  draws: Array<DrawAfterDiscard>;
};

export type AvgRonRange = { min: number; max: number };

export type KongRegressionDetail = {
  tileKey: number;
  remain: number;
  broken: boolean;
};

export type KongRegressionSummary = {
  tripletKinds: number;
  tripletRemain: number;
  breakCount: number;
  items: Array<KongRegressionDetail>;
};

export function computeSplitStage(wallRemaining: number): SplitStage {
  const w = Number.isFinite(wallRemaining) ? Math.trunc(wallRemaining) : 0;
  if (w >= 37) return 'early';
  if (w >= 19) return 'mid';
  return 'late';
}

function encodeCountsKey(counts: ReadonlyArray<number>): string {
  let out = '';
  for (let i = 0; i < 27; i++) out += String(counts[i] ?? 0);
  return out;
}

function stateKey(fixedMeldCount: number, counts13: ReadonlyArray<number>): string {
  return `${fixedMeldCount}|${encodeCountsKey(counts13)}`;
}

function detailKey(
  fixedMeldCount: number,
  counts13: ReadonlyArray<number>,
  publicCounts: ReadonlyArray<number>,
  remCounts: ReadonlyArray<number>,
): string {
  return `${fixedMeldCount}|${encodeCountsKey(counts13)}|${encodeCountsKey(publicCounts)}|${encodeCountsKey(remCounts)}`;
}

function summaryKey(fixedMeldCount: number, counts13: ReadonlyArray<number>, remCounts: ReadonlyArray<number>): string {
  return `${fixedMeldCount}|${encodeCountsKey(counts13)}|${encodeCountsKey(remCounts)}`;
}

function rangeKey(fixedMeldCount: number, counts13: ReadonlyArray<number>, remCounts: ReadonlyArray<number>): string {
  return `${fixedMeldCount}|${encodeCountsKey(counts13)}|${encodeCountsKey(remCounts)}`;
}

function tileWindowCount(tileKey: number): number {
  const r = rankOf(tileKey);
  if (r === 1 || r === 9) return 1;
  if (r === 2 || r === 8) return 2;
  return 3;
}

function computeWindowScore(counts13: ReadonlyArray<number>): number {
  let score = 0;
  for (let k = 0; k < 27; k++) {
    const c = counts13[k] ?? 0;
    if (c <= 0) continue;
    score += c * tileWindowCount(k);
  }
  return score;
}

function shantenSevenPairs(counts13: ReadonlyArray<number>): number {
  // 血战七对：允许“四张=两对”（龙七对/根），因此只看“对子的数量”。
  // 以弃牌后 13 张为基准：pairs=6 时 0 向听；pairs=5 时 1 向听；…；pairs=0 时 6 向听。
  let pairs = 0;
  for (let i = 0; i < 27; i++) {
    const c = counts13[i] ?? 0;
    if (c >= 2) pairs += Math.floor(c / 2);
  }
  const s = 6 - pairs;
  return s < -1 ? -1 : s;
}

function findSevenPairsWaitTile(counts13: ReadonlyArray<number>): number | null {
  // 七对 0 向听时（pairs=6）必然只有 1 张“单张”（可能来自 1 张或 3 张的奇数数量）。
  // 这里取“奇数张”的那种牌作为胡张。
  let wait: number | null = null;
  for (let i = 0; i < 27; i++) {
    const c = counts13[i] ?? 0;
    if ((c & 1) === 0) continue;
    if (wait !== null) return null; // 不止一种奇数张：不是合法七对听牌态
    wait = i;
  }
  return wait;
}

function hasDingqueTile(counts: ReadonlyArray<number>, dingque: BloodSuit): boolean {
  const start = dingque === 'm' ? 0 : dingque === 'p' ? 9 : 18;
  for (let i = 0; i < 9; i++) {
    if ((counts[start + i] ?? 0) > 0) return true;
  }
  return false;
}

function tilesFromCounts(counts: ReadonlyArray<number>): Array<number> {
  const out: Array<number> = [];
  for (let k = 0; k < 27; k++) {
    const c = counts[k] ?? 0;
    for (let i = 0; i < c; i++) out.push(k);
  }
  return out;
}

function adjacentWallCount(tileKey: number, remCounts: ReadonlyArray<number>): number {
  const suit = suitOf(tileKey);
  const rank = rankOf(tileKey);
  let out = 0;
  if (rank > 1) {
    const left = tileKey - 1;
    if (suitOf(left) === suit && (remCounts[left] ?? 0) === 0) out += 1;
  }
  if (rank < 9) {
    const right = tileKey + 1;
    if (suitOf(right) === suit && (remCounts[right] ?? 0) === 0) out += 1;
  }
  return out;
}

function sujiPublicCount(tileKey: number, visibleCounts: ReadonlyArray<number>): number {
  const suit = suitOf(tileKey);
  const rank = rankOf(tileKey);
  let out = 0;
  if (rank > 3) {
    const left = tileKey - 3;
    if (suitOf(left) === suit) out += visibleCounts[left] ?? 0;
  }
  if (rank < 7) {
    const right = tileKey + 3;
    if (suitOf(right) === suit) out += visibleCounts[right] ?? 0;
  }
  return out;
}

export function computeDiscardHardSafety(params: {
  discardTile: number;
  opponents: ReadonlyArray<SplitOpponent>;
  stage: SplitStage;
}): { minSafe: number; avgSafe: number; score: number } {
  const suit = suitOf(params.discardTile);
  const alive = params.opponents.filter((o) => !o.hu);
  if (alive.length === 0) return { minSafe: 1, avgSafe: 1, score: 1 };
  if (alive.some((o) => o.dingque === null)) return { minSafe: 0, avgSafe: 0, score: 0 };

  let sum = 0;
  let min = 1;
  for (const opp of alive) {
    const safe = opp.dingque === suit ? 1 : 0;
    sum += safe;
    if (safe < min) min = safe;
  }
  const avg = sum / alive.length;
  const score = params.stage === 'late' ? min : avg;
  return { minSafe: min, avgSafe: avg, score };
}

export class SplitAnalyzer {
  private route: SplitRoute;
  private fixedMeldCount: number;
  private melds: Array<CalcMeld>;
  private dingque: BloodSuit;
  private base: number;
  private cap: number;
  private aliveOpponents: number;
  private unknownPoolSize: number;
  private stage: SplitStage;
  private publicCounts: ReadonlyArray<number>;
  private remCounts: ReadonlyArray<number>;
  private opponents: ReadonlyArray<SplitOpponent>;

  private shantenMemo = new Map<string, number>();
  private winMemo = new Map<string, boolean>();
  private routeShantenMemo = new Map<string, number>();
  private summaryCache = new Map<string, StateSummary>();
  private detailsCache = new Map<string, StateDetails>();
  private avgRonRangeCache = new Map<string, AvgRonRange | null>();
  private kongRegressionCache = new Map<string, KongRegressionSummary>();

  constructor(params: {
    route: SplitRoute;
    fixedMeldCount: number;
    melds: Array<CalcMeld>;
    dingque: BloodSuit;
    base: number;
    cap: number;
    aliveOpponents: number;
    unknownPoolSize: number;
    stage: SplitStage;
    publicCounts: ReadonlyArray<number>;
    remCounts: ReadonlyArray<number>;
    opponents: ReadonlyArray<SplitOpponent>;
  }) {
    this.route = params.route;
    this.fixedMeldCount = Math.max(0, Math.trunc(params.fixedMeldCount));
    this.melds = Array.isArray(params.melds) ? params.melds : [];
    this.dingque = params.dingque;
    this.base = Number.isFinite(params.base) ? Math.trunc(params.base) : 400;
    this.cap = Number.isFinite(params.cap) ? Math.trunc(params.cap) : 0;
    this.aliveOpponents = Math.max(1, Math.min(3, Math.trunc(params.aliveOpponents)));
    this.unknownPoolSize = Number.isFinite(params.unknownPoolSize) ? Math.max(0, Math.trunc(params.unknownPoolSize)) : 0;
    this.stage = params.stage;
    this.publicCounts = params.publicCounts;
    this.remCounts = params.remCounts;
    this.opponents = params.opponents;
  }

  isAvailable(): boolean {
    return this.route === 'standard' || this.fixedMeldCount === 0;
  }

  private routeShanten(counts13: Array<number>): number {
    const key = stateKey(this.fixedMeldCount, counts13);
    const cached = this.routeShantenMemo.get(key);
    if (cached !== undefined) return cached;

    const s =
      this.route === 'standard'
        ? shantenPinghu({ counts: counts13, fixedMeldCount: this.fixedMeldCount, memo: this.shantenMemo })
        : this.fixedMeldCount === 0
          ? shantenSevenPairs(counts13)
          : Infinity;
    this.routeShantenMemo.set(key, s);
    return s;
  }

  summary(counts13: Array<number>, remCounts: ReadonlyArray<number> = this.remCounts): StateSummary {
    const key = summaryKey(this.fixedMeldCount, counts13, remCounts);
    const cached = this.summaryCache.get(key);
    if (cached) return cached;

    const blockedByDingque = hasDingqueTile(counts13, this.dingque);
    const windowScore = computeWindowScore(counts13);
    const shanten = this.routeShanten(counts13);

    if (blockedByDingque) {
      const out: StateSummary = { key, shanten, blockedByDingque: true, windowScore, tenpai: null, improve: null };
      this.summaryCache.set(key, out);
      return out;
    }

    if (shanten === 0) {
      const tenpai =
        this.route === 'standard' ? this.computeTenpaiStandard(counts13, remCounts) : this.computeTenpaiSevenPairs(counts13, remCounts);
      const out: StateSummary = { key, shanten, blockedByDingque: false, windowScore, tenpai, improve: null };
      this.summaryCache.set(key, out);
      return out;
    }

    const improve = this.computeImprove(counts13, shanten, remCounts);
    const out: StateSummary = { key, shanten, blockedByDingque: false, windowScore, tenpai: null, improve };
    this.summaryCache.set(key, out);
    return out;
  }

  private metricU(summary: StateSummary): number {
    return summary.tenpai ? summary.tenpai.winCount : summary.improve ? summary.improve.improveCount : 0;
  }

  private metricK(summary: StateSummary): number {
    return summary.tenpai ? summary.tenpai.winKinds : summary.improve ? summary.improve.improveKinds : 0;
  }

  private estimatedRonValue(
    counts13: Array<number>,
    summary: StateSummary,
    publicCounts: ReadonlyArray<number> = this.publicCounts,
    remCounts: ReadonlyArray<number> = this.remCounts,
  ): number {
    if (summary.tenpai) return summary.tenpai.avgRonGain;
    const range = this.avgRonRange(counts13, publicCounts, remCounts);
    if (!range) return Number.NEGATIVE_INFINITY;
    return (range.min + range.max) / 2;
  }

  private compareStateStrength(
    aCounts13: Array<number>,
    aSummary: StateSummary,
    bCounts13: Array<number>,
    bSummary: StateSummary,
    aPublicCounts: ReadonlyArray<number> = this.publicCounts,
    aRemCounts: ReadonlyArray<number> = this.remCounts,
    bPublicCounts: ReadonlyArray<number> = this.publicCounts,
    bRemCounts: ReadonlyArray<number> = this.remCounts,
  ): number {
    if (aSummary.shanten !== bSummary.shanten) return aSummary.shanten - bSummary.shanten;

    const aU = this.metricU(aSummary);
    const bU = this.metricU(bSummary);
    if (bU !== aU) return bU - aU;

    const aK = this.metricK(aSummary);
    const bK = this.metricK(bSummary);
    if (bK !== aK) return bK - aK;

    const aScore = this.estimatedRonValue(aCounts13, aSummary, aPublicCounts, aRemCounts);
    const bScore = this.estimatedRonValue(bCounts13, bSummary, bPublicCounts, bRemCounts);
    if (bScore !== aScore) return bScore - aScore;

    if (this.route === 'standard' && bSummary.windowScore !== aSummary.windowScore) {
      return bSummary.windowScore - aSummary.windowScore;
    }
    return 0;
  }

  private discardTieBreak(
    tileKey: number,
    publicCounts: ReadonlyArray<number> = this.publicCounts,
    remCounts: ReadonlyArray<number> = this.remCounts,
  ): { safeScore: number; familiarCount: number; wallCount: number; sujiCount: number } {
    return {
      safeScore: computeDiscardHardSafety({ discardTile: tileKey, opponents: this.opponents, stage: this.stage }).score,
      familiarCount: publicCounts[tileKey] ?? 0,
      wallCount: adjacentWallCount(tileKey, remCounts),
      sujiCount: sujiPublicCount(tileKey, publicCounts),
    };
  }

  private compareDiscardTieBreak(
    a: { safeScore: number; familiarCount: number; wallCount: number; sujiCount: number },
    b: { safeScore: number; familiarCount: number; wallCount: number; sujiCount: number },
  ): number {
    if (b.safeScore !== a.safeScore) return b.safeScore - a.safeScore;
    if (b.familiarCount !== a.familiarCount) return b.familiarCount - a.familiarCount;
    if (b.wallCount !== a.wallCount) return b.wallCount - a.wallCount;
    if (b.sujiCount !== a.sujiCount) return b.sujiCount - a.sujiCount;
    return 0;
  }

  avgRonRange(
    counts13: Array<number>,
    publicCounts: ReadonlyArray<number> = this.publicCounts,
    remCounts: ReadonlyArray<number> = this.remCounts,
  ): AvgRonRange | null {
    // 预估区间只取主路线同强分支的 min-max；安全/熟壁筋只影响默认推荐，不该打碎递归缓存。
    const key = rangeKey(this.fixedMeldCount, counts13, remCounts);
    if (this.avgRonRangeCache.has(key)) {
      return this.avgRonRangeCache.get(key) ?? null;
    }

    const s0 = this.summary(counts13, remCounts);
    if (s0.blockedByDingque) {
      this.avgRonRangeCache.set(key, null);
      return null;
    }

    if (s0.tenpai) {
      const v = Math.round(s0.tenpai.avgRonGain);
      const out: AvgRonRange = { min: v, max: v };
      this.avgRonRangeCache.set(key, out);
      return out;
    }

    if (!s0.improve || !Number.isFinite(s0.shanten) || s0.shanten <= 0) {
      this.avgRonRangeCache.set(key, null);
      return null;
    }

    const det = this.details(counts13, publicCounts, remCounts);
    if (det.draws.length === 0) {
      this.avgRonRangeCache.set(key, null);
      return null;
    }

    let min = Infinity;
    let max = -Infinity;

    for (const d of det.draws) {
      const discards = Array.isArray(d.sameTierDiscards) && d.sameTierDiscards.length > 0 ? d.sameTierDiscards : [d.bestDiscard];
      for (const discard of discards) {
        const next = counts13.slice();
        next[d.drawTile] = (next[d.drawTile] ?? 0) + 1;
        next[discard] = (next[discard] ?? 0) - 1;
        const nextPublicCounts = publicCounts.slice();
        nextPublicCounts[discard] = (nextPublicCounts[discard] ?? 0) + 1;
        const nextRemCounts = remCounts.slice();
        if ((nextRemCounts[d.drawTile] ?? 0) > 0) nextRemCounts[d.drawTile] = (nextRemCounts[d.drawTile] ?? 0) - 1;
        const r = this.avgRonRange(next, nextPublicCounts, nextRemCounts);
        if (!r) continue;
        if (r.min < min) min = r.min;
        if (r.max > max) max = r.max;
      }
    }

    const out = Number.isFinite(min) && Number.isFinite(max) ? ({ min, max } satisfies AvgRonRange) : null;
    this.avgRonRangeCache.set(key, out);
    return out;
  }

  details(
    counts13: Array<number>,
    publicCounts: ReadonlyArray<number> = this.publicCounts,
    remCounts: ReadonlyArray<number> = this.remCounts,
  ): StateDetails {
    const key = detailKey(this.fixedMeldCount, counts13, publicCounts, remCounts);
    const cached = this.detailsCache.get(key);
    if (cached) return cached;

    const s0 = this.summary(counts13, remCounts);
    if (s0.blockedByDingque || s0.shanten === 0 || !s0.improve) {
      const out: StateDetails = { draws: [] };
      this.detailsCache.set(key, out);
      return out;
    }

    const draws: Array<DrawAfterDiscard> = [];

    for (const t of s0.improve.improveTiles) {
      const remain = remCounts[t] ?? 0;
      if (remain <= 0) continue;

      const counts14 = counts13.slice();
      counts14[t] = (counts14[t] ?? 0) + 1;

      let bestNextS = Infinity;
      const candidates: Array<{ discard: number; nextCounts13: Array<number> }> = [];
      for (let y = 0; y < 27; y++) {
        if ((counts14[y] ?? 0) <= 0) continue;
        const next = counts14.slice();
        next[y] = (next[y] ?? 0) - 1;
        const sNext = this.routeShanten(next);
        if (sNext < bestNextS) {
          bestNextS = sNext;
          candidates.length = 0;
          candidates.push({ discard: y, nextCounts13: next });
        } else if (sNext === bestNextS) {
          candidates.push({ discard: y, nextCounts13: next });
        }
      }

      if (!Number.isFinite(bestNextS) || bestNextS >= s0.shanten) {
        continue;
      }

      // 破同：按（下一状态强度）+（弃牌安全度）+（tileKey 稳定输出）
      const ranked = candidates
        .map((cand) => {
          const nextRemCounts = remCounts.slice();
          if ((nextRemCounts[t] ?? 0) > 0) nextRemCounts[t] = (nextRemCounts[t] ?? 0) - 1;
          const summary = this.summary(cand.nextCounts13, nextRemCounts);
          const nextPublicCounts = publicCounts.slice();
          nextPublicCounts[cand.discard] = (nextPublicCounts[cand.discard] ?? 0) + 1;
          const tieBreak = this.discardTieBreak(cand.discard, nextPublicCounts, nextRemCounts);
          return { discard: cand.discard, nextCounts13: cand.nextCounts13, summary, tieBreak, publicCounts: nextPublicCounts, remCounts: nextRemCounts };
        })
        .sort((a, b) => {
          const cmp = this.compareStateStrength(
            a.nextCounts13,
            a.summary,
            b.nextCounts13,
            b.summary,
            a.publicCounts,
            a.remCounts,
            b.publicCounts,
            b.remCounts,
          );
          if (cmp !== 0) return cmp; // cmp<0 表示 a 更强
          const discardCmp = this.compareDiscardTieBreak(a.tieBreak, b.tieBreak);
          if (discardCmp !== 0) return discardCmp;
          return a.discard - b.discard; // 稳定输出
        });

      const best = ranked[0] ?? null;
      const bestSummary = best?.summary ?? null;
      const sameTierDiscards =
        best && bestSummary
          ? ranked
              .filter((cand) => {
                const cmp = this.compareStateStrength(
                  best.nextCounts13,
                  bestSummary,
                  cand.nextCounts13,
                  cand.summary,
                  best.publicCounts,
                  best.remCounts,
                  cand.publicCounts,
                  cand.remCounts,
                );
                // 安全只用于默认推荐分支；主路线同强的并行分支仍应保留到递归树/区间里。
                return cmp === 0;
              })
              .map((cand) => cand.discard)
          : [];

      if (!best || !bestSummary) continue;

      draws.push({
        drawTile: t,
        remain,
        bestDiscard: best.discard,
        nextShanten: bestNextS,
        nextKey: bestSummary.key,
        sameTierDiscards,
      });
    }

    draws.sort((a, b) => {
      if (b.remain !== a.remain) return b.remain - a.remain;
      return a.drawTile - b.drawTile;
    });

    const out: StateDetails = { draws };
    this.detailsCache.set(key, out);
    return out;
  }

  kongRegression(counts13: Array<number>): KongRegressionSummary {
    const key = stateKey(this.fixedMeldCount, counts13);
    const cached = this.kongRegressionCache.get(key);
    if (cached) return cached;

    if (this.route !== 'standard') {
      const out: KongRegressionSummary = { tripletKinds: 0, tripletRemain: 0, breakCount: 0, items: [] };
      this.kongRegressionCache.set(key, out);
      return out;
    }

    // 只关心“未来可杠”的暗刻：弃后暗手里正好 3 张，且外剩 = 1（公开未见）。
    const candidates: Array<number> = [];
    let tripletRemain = 0;
    for (let k = 0; k < 27; k++) {
      if ((counts13[k] ?? 0) !== 3) continue;
      const remain = this.remCounts[k] ?? 0;
      if (remain !== 1) continue;
      candidates.push(k);
      tripletRemain += remain;
    }

    const tripletKinds = candidates.length;
    let breakCount = 0;
    let items: Array<KongRegressionDetail> = [];

    // 退K：只按标准型自身口径，在不增加标准型最小向听的前提下，尽量保留这些暗刻为刻子。
    if (tripletKinds > 0) {
      const sStd = shantenPinghu({ counts: counts13, fixedMeldCount: this.fixedMeldCount, memo: this.shantenMemo });
      const popcount = (x: number): number => {
        let c = 0;
        for (let v = x >>> 0; v !== 0; v &= v - 1) c += 1;
        return c;
      };

      const n = candidates.length;
      const totalMasks = 1 << n;
      let bestKeep = -1;
      let bestMask = 0;

      for (let mask = 0; mask < totalMasks; mask++) {
        const keep = popcount(mask);
        if (keep < bestKeep) continue;

        const reduced = counts13.slice();
        for (let i = 0; i < n; i++) {
          if ((mask & (1 << i)) === 0) continue;
          const tk = candidates[i]!;
          reduced[tk] = (reduced[tk] ?? 0) - 3;
        }

        const nextStd = shantenPinghu({
          counts: reduced,
          fixedMeldCount: this.fixedMeldCount + keep,
          memo: this.shantenMemo,
        });
        if (nextStd !== sStd) continue;

        if (keep > bestKeep || (keep === bestKeep && mask < bestMask)) {
          bestKeep = keep;
          bestMask = mask;
        }
      }

      const keepFinal = Math.max(0, bestKeep);
      breakCount = tripletKinds - keepFinal;
      items = candidates.map((tileKey, i) => ({
        tileKey,
        remain: this.remCounts[tileKey] ?? 0,
        broken: (bestMask & (1 << i)) === 0,
      }));
    }

    const out: KongRegressionSummary = { tripletKinds, tripletRemain, breakCount, items };
    this.kongRegressionCache.set(key, out);
    return out;
  }

  private computeTenpaiStandard(counts13: Array<number>, remCounts: ReadonlyArray<number>): TenpaiSummary {
    const winTiles: Array<number> = [];
    const waits: Array<TenpaiWaitDetail> = [];

    const counts14 = counts13.slice();
    for (let t = 0; t < 27; t++) {
      const remain = remCounts[t] ?? 0;
      if (remain <= 0) continue;
      if (suitOf(t) === this.dingque) continue;
      if ((counts14[t] ?? 0) >= 4) continue;

      counts14[t] = (counts14[t] ?? 0) + 1;
      const ok = isWinPinghu({ counts: counts14, fixedMeldCount: this.fixedMeldCount, memo: this.winMemo });
      counts14[t] = (counts14[t] ?? 0) - 1;
      if (!ok) continue;

      winTiles.push(t);

      // 逐胡张计算点炮/自摸分（只考虑标准形，不算过程番）。
      const concealedTiles = [...tilesFromCounts(counts13), t];
      const ronRes = calcBloodHu(
        { concealedTiles, melds: this.melds },
        { base: this.base, cap: this.cap, huMethod: 'dianpao', standardOnly: true },
      );
      const zimoRes = calcBloodHu(
        { concealedTiles, melds: this.melds },
        { base: this.base, cap: this.cap, huMethod: 'zimo', remainingOpponents: this.aliveOpponents, standardOnly: true },
      );
      const ronGain = ronRes.ok ? Math.trunc(ronRes.winnerGain) : 0;
      const zimoGain = zimoRes.ok ? Math.trunc(zimoRes.winnerGain) : 0;
      const ronMultiplier = ronRes.ok ? Math.trunc(ronRes.multiplierCapped) : 1;
      const zimoMultiplier = zimoRes.ok ? Math.trunc(zimoRes.multiplierCapped) : 1;
      waits.push({ tileKey: t, remain, ronGain, zimoGain, ronMultiplier, zimoMultiplier });
    }

    waits.sort((a, b) => {
      if (b.remain !== a.remain) return b.remain - a.remain;
      return a.tileKey - b.tileKey;
    });

    let winCount = 0;
    let sumRon = 0;
    let sumZimo = 0;
    for (const w of waits) {
      winCount += w.remain;
      sumRon += w.remain * w.ronGain;
      sumZimo += w.remain * w.zimoGain;
    }

    const avgRonGain = winCount > 0 ? sumRon / winCount : 0;
    const avgZimoGain = winCount > 0 ? sumZimo / winCount : 0;

    return {
      winTiles,
      winKinds: waits.length,
      winCount,
      waits,
      avgRonGain,
      avgZimoGain,
    };
  }

  private computeTenpaiSevenPairs(counts13: Array<number>, remCounts: ReadonlyArray<number>): TenpaiSummary {
    const winTiles: Array<number> = [];
    const waits: Array<TenpaiWaitDetail> = [];

    const waitTile = findSevenPairsWaitTile(counts13);
    if (waitTile === null) {
      return { winTiles: [], winKinds: 0, winCount: 0, waits: [], avgRonGain: 0, avgZimoGain: 0 };
    }

    const remain = remCounts[waitTile] ?? 0;
    if (remain > 0) {
      winTiles.push(waitTile);
      const concealedTiles = [...tilesFromCounts(counts13), waitTile];
      const ronRes = calcBloodHu(
        { concealedTiles, melds: this.melds },
        { base: this.base, cap: this.cap, huMethod: 'dianpao' },
      );
      const zimoRes = calcBloodHu(
        { concealedTiles, melds: this.melds },
        { base: this.base, cap: this.cap, huMethod: 'zimo', remainingOpponents: this.aliveOpponents },
      );
      const ronGain = ronRes.ok ? Math.trunc(ronRes.winnerGain) : 0;
      const zimoGain = zimoRes.ok ? Math.trunc(zimoRes.winnerGain) : 0;
      const ronMultiplier = ronRes.ok ? Math.trunc(ronRes.multiplierCapped) : 1;
      const zimoMultiplier = zimoRes.ok ? Math.trunc(zimoRes.multiplierCapped) : 1;
      waits.push({ tileKey: waitTile, remain, ronGain, zimoGain, ronMultiplier, zimoMultiplier });
    }

    let winCount = 0;
    let sumRon = 0;
    let sumZimo = 0;
    for (const w of waits) {
      winCount += w.remain;
      sumRon += w.remain * w.ronGain;
      sumZimo += w.remain * w.zimoGain;
    }
    const avgRonGain = winCount > 0 ? sumRon / winCount : 0;
    const avgZimoGain = winCount > 0 ? sumZimo / winCount : 0;

    return {
      winTiles,
      winKinds: waits.length,
      winCount,
      waits,
      avgRonGain,
      avgZimoGain,
    };
  }

  private computeImprove(counts13: Array<number>, shanten0: number, remCounts: ReadonlyArray<number>): ImproveSummary {
    const improveTiles: Array<number> = [];
    let improveCount = 0;

    for (let t = 0; t < 27; t++) {
      const remain = remCounts[t] ?? 0;
      if (remain <= 0) continue;
      if (suitOf(t) === this.dingque) continue;
      if ((counts13[t] ?? 0) >= 4) continue;

      const counts14 = counts13.slice();
      counts14[t] = (counts14[t] ?? 0) + 1;

      let bestNextS = Infinity;
      for (let y = 0; y < 27; y++) {
        if ((counts14[y] ?? 0) <= 0) continue;
        const next = counts14.slice();
        next[y] = (next[y] ?? 0) - 1;
        const sNext = this.routeShanten(next);
        if (sNext < bestNextS) bestNextS = sNext;
      }

      if (!Number.isFinite(bestNextS) || bestNextS >= shanten0) continue;
      improveTiles.push(t);
      improveCount += remain;
    }

    improveTiles.sort((a, b) => {
      const ra = remCounts[a] ?? 0;
      const rb = remCounts[b] ?? 0;
      if (rb !== ra) return rb - ra;
      return a - b;
    });

    const improveKinds = improveTiles.length;
    const pImprove = this.unknownPoolSize > 0 ? improveCount / this.unknownPoolSize : null;

    return { improveTiles, improveKinds, improveCount, pImprove };
  }
}

export function formatTileShort(tileKey: number): string {
  return tileCode(tileKey);
}
