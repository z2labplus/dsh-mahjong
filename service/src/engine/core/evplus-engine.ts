import type { BloodSuit } from './blood-types';
import { calcBloodHu } from '../blood-calc-engine';
import type { CalcMeld } from './blood-calc-notation';
import { suitOf } from './blood-tiles';
import { comb, pOpponentHasAtLeastKOfTile, shantenPinghu, sumCounts } from './ev-engine';

export const EVPLUS_TILE_TYPES = 27;
export const EVPLUS_COPIES_PER_TILE = 4;

export type EvplusSeat = 'B' | 'C' | 'D';

export type EvplusOpponent = {
  handSize: number;
  dingque: BloodSuit;
  hu: boolean;
};

export type EvplusContext = {
  base: number;
  cap: number;
  wallRemaining: number;
  myDingque: BloodSuit;
  opponents: Record<EvplusSeat, EvplusOpponent>;
  oppDiscardsBeforeYourDraw: number;
};

export type EvplusRisk = {
  pDealIn: number;
  pMingKong: number;
  riskDealIn: number;
  riskMingKong: number;
  riskTotal: number;
};

export type EvplusTenpai = {
  winTiles: Array<number>;
  winCount: number;
  pZimo: number;
  pRon: number;
  avgZimoGain: number;
  avgRonGain: number;
  evZimo: number;
  evRon: number;
  gainTotal: number;
};

export type EvplusImproveDetail = {
  drawTile: number;
  weight: number;
  bestDiscard: number;
  nextShanten: number;
  value: number;
};

export type EvplusChanceResult = {
  discardTile: number;
  shantenAfter: number;
  improveTiles: Array<number>;
  improveCount: number;
  tenpaiValue: number | null;
  improveDetails: Array<EvplusImproveDetail>;
  // tenpai 时：补充可解释分解
  tenpai: EvplusTenpai | null;
  risk: EvplusRisk;
};

export type EvplusStateValue = {
  shanten: number;
  improveTiles: Array<number>;
  improveCount: number;
  value: number | null;
  improveDetails: Array<EvplusImproveDetail>;
  tenpai: EvplusTenpai | null;
};

export type EvplusEvalMemo = {
  shanten: Map<string, number>;
  value: Map<string, { value: number | null; improveCount: number; improveDetails: Array<EvplusImproveDetail> }>;
  tenpai: Map<string, EvplusTenpai>;
  huGain: Map<string, number>;
};

export function createEvplusMemo(): EvplusEvalMemo {
  return {
    shanten: new Map(),
    value: new Map(),
    tenpai: new Map(),
    huGain: new Map(),
  };
}

export function sumOpponentHands(opps: Record<EvplusSeat, EvplusOpponent>): number {
  return opps.B.handSize + opps.C.handSize + opps.D.handSize;
}

export function aliveOpponents(opps: Record<EvplusSeat, EvplusOpponent>): Array<EvplusSeat> {
  const out: Array<EvplusSeat> = [];
  for (const seat of ['B', 'C', 'D'] as const) {
    if (!opps[seat].hu) out.push(seat);
  }
  return out;
}

function encodeCountsKey(counts: ReadonlyArray<number>): string {
  let out = '';
  for (let i = 0; i < counts.length; i++) out += String(counts[i] ?? 0);
  return out;
}

function encodeMeldsKey(melds: ReadonlyArray<CalcMeld>): string {
  if (melds.length === 0) return '-';
  return melds
    .map((m) => `${m.kind[0]}${m.tileKey}${m.kind === 'gang' && m.gangType ? m.gangType[0] : ''}`)
    .sort()
    .join(',');
}

function stateKey(counts: ReadonlyArray<number>, melds: ReadonlyArray<CalcMeld>): string {
  return `${encodeMeldsKey(melds)}|${encodeCountsKey(counts)}`;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function countsFromMelds(melds: ReadonlyArray<CalcMeld>): Array<number> {
  const counts = new Array(EVPLUS_TILE_TYPES).fill(0);
  for (const m of melds) {
    const add = m.kind === 'gang' ? 4 : 3;
    counts[m.tileKey] += add;
  }
  return counts;
}

export function tilesFromCounts(counts: ReadonlyArray<number>): Array<number> {
  const tiles: Array<number> = [];
  for (let k = 0; k < counts.length; k++) {
    const c = counts[k] ?? 0;
    for (let i = 0; i < c; i++) tiles.push(k);
  }
  return tiles;
}

export function suitCounts(counts: ReadonlyArray<number>): Record<BloodSuit, number> {
  const out: Record<BloodSuit, number> = { m: 0, p: 0, s: 0 };
  for (let k = 0; k < counts.length; k++) {
    const c = counts[k] ?? 0;
    if (c <= 0) continue;
    out[suitOf(k)] += c;
  }
  return out;
}

export function sevenPairsShanten(counts13: ReadonlyArray<number>): number {
  // 13 张下：shanten = 6 - pairs（pairs=Σ floor(ci/2)，四张算两对）
  let pairs = 0;
  for (let i = 0; i < counts13.length; i++) pairs += Math.floor((counts13[i] ?? 0) / 2);
  const s = 6 - pairs;
  return s < 0 ? 0 : s;
}

export function shantenBlood(params: {
  counts13: Array<number>;
  melds: ReadonlyArray<CalcMeld>;
  memo: Map<string, number>;
}): number {
  const key = `${params.melds.length}|${encodeCountsKey(params.counts13)}`;
  const cached = params.memo.get(key);
  if (cached !== undefined) return cached;

  const standard = shantenPinghu({ counts: params.counts13, fixedMeldCount: params.melds.length });
  let best = standard;
  if (params.melds.length === 0) {
    const s7 = sevenPairsShanten(params.counts13);
    if (s7 < best) best = s7;
  }
  params.memo.set(key, best);
  return best;
}

export function pDealInBase(params: {
  U: number;
  Rx: number;
  opponents: Record<EvplusSeat, EvplusOpponent>;
  tileSuit: BloodSuit;
}): number {
  const U = params.U;
  if (U <= 0 || params.Rx <= 0) return 0;
  let n = 0;
  for (const seat of ['B', 'C', 'D'] as const) {
    const opp = params.opponents[seat];
    if (opp.hu) continue;
    if (opp.dingque === params.tileSuit) continue;
    n += 1;
  }
  if (n <= 0) return 0;
  return clamp01(1 - Math.pow(1 - params.Rx / U, n));
}

export function pAnyOpponentMingKongFiltered(params: {
  U: number;
  Rx: number;
  opponents: Record<EvplusSeat, EvplusOpponent>;
  tileSuit: BloodSuit;
}): number {
  const U = params.U;
  const R = params.Rx;
  if (U <= 0 || R <= 0) return 0;
  const ps: Array<number> = [];
  for (const seat of ['B', 'C', 'D'] as const) {
    const opp = params.opponents[seat];
    if (opp.hu) continue;
    if (opp.dingque === params.tileSuit) continue;
    ps.push(pOpponentHasAtLeastKOfTile(U, opp.handSize, R, 3));
  }
  if (ps.length === 0) return 0;
  if (R === 3) {
    let s = 0;
    for (const p of ps) s += p;
    return clamp01(s);
  }
  let prod = 1;
  for (const p of ps) prod *= 1 - p;
  return clamp01(1 - prod);
}

function hasDingqueTile(counts: ReadonlyArray<number>, dingque: BloodSuit): boolean {
  const start = dingque === 'm' ? 0 : dingque === 'p' ? 9 : 18;
  for (let i = 0; i < 9; i++) {
    if ((counts[start + i] ?? 0) > 0) return true;
  }
  return false;
}

function calcHuGainCached(params: {
  concealedCounts: ReadonlyArray<number>;
  melds: ReadonlyArray<CalcMeld>;
  base: number;
  cap: number;
  huMethod: 'zimo' | 'dianpao';
  remainingOpponents: number;
  memo: Map<string, number>;
}): number {
  const key = `${params.huMethod}|${params.remainingOpponents}|${params.base}|${params.cap}|${stateKey(params.concealedCounts, params.melds)}`;
  const cached = params.memo.get(key);
  if (cached !== undefined) return cached;

  const hand = { concealedTiles: tilesFromCounts(params.concealedCounts), melds: [...params.melds] };
  const res = calcBloodHu(hand, {
    base: params.base,
    cap: params.cap,
    huMethod: params.huMethod,
    remainingOpponents: params.huMethod === 'zimo' ? params.remainingOpponents : undefined,
    events: {},
  });
  const gain = res.ok ? res.winnerGain : 0;
  params.memo.set(key, gain);
  return gain;
}

function computeTenpai(params: {
  counts13: Array<number>;
  melds: ReadonlyArray<CalcMeld>;
  U: number;
  remCounts: ReadonlyArray<number>;
  ctx: EvplusContext;
  memo: EvplusEvalMemo;
}): EvplusTenpai {
  const alive = aliveOpponents(params.ctx.opponents).length;
  const key = `${params.ctx.base}|${params.ctx.cap}|${params.U}|${params.ctx.myDingque}|${alive}|${params.ctx.oppDiscardsBeforeYourDraw}|${stateKey(params.counts13, params.melds)}`;
  const cached = params.memo.tenpai.get(key);
  if (cached) return cached;

  const out: EvplusTenpai = {
    winTiles: [],
    winCount: 0,
    pZimo: 0,
    pRon: 0,
    avgZimoGain: 0,
    avgRonGain: 0,
    evZimo: 0,
    evRon: 0,
    gainTotal: 0,
  };

  // 定缺：只要手里还有缺门，则不可能胡（v1：直接视为无胡张）
  if (hasDingqueTile(params.counts13, params.ctx.myDingque)) {
    params.memo.tenpai.set(key, out);
    return out;
  }

  const baseCounts = params.counts13.slice();
  const winTiles: Array<number> = [];
  const zimoGains: Array<{ tile: number; weight: number; gain: number }> = [];
  const ronGains: Array<{ tile: number; weight: number; gain: number }> = [];

  for (let t = 0; t < params.remCounts.length; t++) {
    const w = params.remCounts[t] ?? 0;
    if (w <= 0) continue;
    if (suitOf(t) === params.ctx.myDingque) continue;

    baseCounts[t] = (baseCounts[t] ?? 0) + 1;
    const gainRon = calcHuGainCached({
      concealedCounts: baseCounts,
      melds: params.melds,
      base: params.ctx.base,
      cap: params.ctx.cap,
      huMethod: 'dianpao',
      remainingOpponents: alive,
      memo: params.memo.huGain,
    });
    if (gainRon > 0) {
      winTiles.push(t);
      ronGains.push({ tile: t, weight: w, gain: gainRon });

      const gainZimo =
        alive >= 1
          ? calcHuGainCached({
              concealedCounts: baseCounts,
              melds: params.melds,
              base: params.ctx.base,
              cap: params.ctx.cap,
              huMethod: 'zimo',
              remainingOpponents: alive,
              memo: params.memo.huGain,
            })
          : 0;
      zimoGains.push({ tile: t, weight: w, gain: gainZimo });
    }
    baseCounts[t]! -= 1;
  }

  let W = 0;
  let sumWZ = 0;
  let sumWR = 0;
  let sumWZGain = 0;
  let sumWRGain = 0;

  for (const g of ronGains) {
    W += g.weight;
    sumWR += g.weight;
    sumWRGain += g.weight * g.gain;
  }
  for (const g of zimoGains) {
    sumWZ += g.weight;
    sumWZGain += g.weight * g.gain;
  }

  out.winTiles = winTiles.slice();
  out.winCount = W;

  const U = params.U;
  const pZimo = U > 0 ? clamp01(W / U) : 0;
  out.pZimo = pZimo;
  out.avgZimoGain = sumWZ > 0 ? sumWZGain / sumWZ : 0;
  out.evZimo = U > 0 ? sumWZGain / U : 0;

  const pHit = U > 0 ? clamp01(W / U) : 0;
  out.pRon = clamp01(1 - Math.pow(1 - pHit, params.ctx.oppDiscardsBeforeYourDraw));
  out.avgRonGain = sumWR > 0 ? sumWRGain / sumWR : 0;
  out.evRon = out.pRon * out.avgRonGain;

  out.gainTotal = out.evZimo + out.evRon;

  params.memo.tenpai.set(key, out);
  return out;
}

function evalDiscardTenpaiNet(params: {
  handCounts: Array<number>;
  melds: ReadonlyArray<CalcMeld>;
  discardTile: number;
  U: number;
  remCounts: ReadonlyArray<number>;
  ctx: EvplusContext;
  memo: EvplusEvalMemo;
}): { tenpai: EvplusTenpai; risk: EvplusRisk; netEv: number } {
  const Rx = params.remCounts[params.discardTile] ?? 0;
  const tileSuit = suitOf(params.discardTile);
  const pDealIn = pDealInBase({ U: params.U, Rx, opponents: params.ctx.opponents, tileSuit });
  const riskDealIn = pDealIn * params.ctx.base;

  const pMingKong = pAnyOpponentMingKongFiltered({ U: params.U, Rx, opponents: params.ctx.opponents, tileSuit });
  const riskMingKong = pMingKong * (params.ctx.base * 2);

  const riskTotal = riskDealIn + riskMingKong;
  const risk: EvplusRisk = { pDealIn, pMingKong, riskDealIn, riskMingKong, riskTotal };

  const next13 = params.handCounts.slice();
  next13[params.discardTile] = (next13[params.discardTile] ?? 0) - 1;
  const tenpai = computeTenpai({ counts13: next13, melds: params.melds, U: params.U, remCounts: params.remCounts, ctx: params.ctx, memo: params.memo });

  const netEv = tenpai.gainTotal - riskTotal;
  return { tenpai, risk, netEv };
}

function bestDiscardAfterDrawToReduceShanten(params: {
  baseAfterDiscard: Array<number>;
  melds: ReadonlyArray<CalcMeld>;
  drawTile: number;
  prevShanten: number;
  U: number;
  remCounts: ReadonlyArray<number>;
  ctx: EvplusContext;
  memo: EvplusEvalMemo;
}): { bestDiscard: number; nextShanten: number; value: number } | null {
  const counts14 = params.baseAfterDiscard.slice();
  counts14[params.drawTile] = (counts14[params.drawTile] ?? 0) + 1;

  let bestS = Infinity;
  let bestV = -Infinity;
  let bestY = -1;

  for (let y = 0; y < counts14.length; y++) {
    if ((counts14[y] ?? 0) <= 0) continue;
    counts14[y]! -= 1;
    const nextCounts13 = counts14;

    const sNext = shantenBlood({ counts13: nextCounts13, melds: params.melds, memo: params.memo.shanten });
    if (sNext < params.prevShanten) {
      let v: number;
      if (sNext === 0) {
        const tmp14 = params.baseAfterDiscard.slice();
        tmp14[params.drawTile] = (tmp14[params.drawTile] ?? 0) + 1;
        const r = evalDiscardTenpaiNet({
          handCounts: tmp14,
          melds: params.melds,
          discardTile: y,
          U: params.U,
          remCounts: params.remCounts,
          ctx: params.ctx,
          memo: params.memo,
        });
        v = r.netEv;
      } else {
        const st = stateValueToTenpai({
          counts13: nextCounts13.slice(),
          melds: params.melds,
          U: params.U,
          remCounts: params.remCounts,
          ctx: params.ctx,
          memo: params.memo,
        });
        v = st.value ?? 0;
      }

      if (sNext < bestS || (sNext === bestS && v > bestV)) {
        bestS = sNext;
        bestV = v;
        bestY = y;
      }
    }

    counts14[y]! += 1;
  }

  if (bestY === -1 || !Number.isFinite(bestV) || bestS === Infinity) return null;
  return { bestDiscard: bestY, nextShanten: bestS, value: bestV };
}

function stateValueToTenpai(params: {
  counts13: Array<number>;
  melds: ReadonlyArray<CalcMeld>;
  U: number;
  remCounts: ReadonlyArray<number>;
  ctx: EvplusContext;
  memo: EvplusEvalMemo;
}): { value: number | null; improveCount: number; improveDetails: Array<EvplusImproveDetail> } {
  const alive = aliveOpponents(params.ctx.opponents).length;
  const key = `${params.ctx.base}|${params.ctx.cap}|${params.U}|${params.ctx.myDingque}|${alive}|${params.ctx.oppDiscardsBeforeYourDraw}|${stateKey(params.counts13, params.melds)}`;
  const cached = params.memo.value.get(key);
  if (cached) return cached;

  const s0 = shantenBlood({ counts13: params.counts13, melds: params.melds, memo: params.memo.shanten });
  const details: Array<EvplusImproveDetail> = [];
  let sumW = 0;
  let sumWV = 0;

  if (s0 > 0) {
    for (let t = 0; t < params.remCounts.length; t++) {
      const w = params.remCounts[t] ?? 0;
      if (w <= 0) continue;

      const best = bestDiscardAfterDrawToReduceShanten({
        baseAfterDiscard: params.counts13,
        melds: params.melds,
        drawTile: t,
        prevShanten: s0,
        U: params.U,
        remCounts: params.remCounts,
        ctx: params.ctx,
        memo: params.memo,
      });
      if (!best) continue;

      details.push({ drawTile: t, weight: w, bestDiscard: best.bestDiscard, nextShanten: best.nextShanten, value: best.value });
      sumW += w;
      sumWV += w * best.value;
    }
  }

  const value = sumW > 0 ? sumWV / sumW : null;
  const out = { value, improveCount: sumW, improveDetails: details };
  params.memo.value.set(key, out);
  return out;
}

export function evalStateValue(params: {
  counts13: Array<number>;
  melds: ReadonlyArray<CalcMeld>;
  U: number;
  remCounts: ReadonlyArray<number>;
  ctx: EvplusContext;
  memo: EvplusEvalMemo;
}): EvplusStateValue {
  const s = shantenBlood({ counts13: params.counts13, melds: params.melds, memo: params.memo.shanten });
  if (s === 0) {
    const tenpai = computeTenpai({ counts13: params.counts13, melds: params.melds, U: params.U, remCounts: params.remCounts, ctx: params.ctx, memo: params.memo });
    return {
      shanten: 0,
      improveTiles: tenpai.winTiles.slice(),
      improveCount: tenpai.winCount,
      value: tenpai.gainTotal,
      improveDetails: [],
      tenpai,
    };
  }

  const st = stateValueToTenpai({
    counts13: params.counts13,
    melds: params.melds,
    U: params.U,
    remCounts: params.remCounts,
    ctx: params.ctx,
    memo: params.memo,
  });
  return {
    shanten: s,
    improveTiles: st.improveDetails.map((d) => d.drawTile),
    improveCount: st.improveCount,
    value: st.value,
    improveDetails: st.improveDetails,
    tenpai: null,
  };
}

export function evalDiscardChance(params: {
  handCounts: Array<number>;
  melds: ReadonlyArray<CalcMeld>;
  discardTile: number;
  U: number;
  remCounts: ReadonlyArray<number>;
  ctx: EvplusContext;
  memo: EvplusEvalMemo;
}): EvplusChanceResult {
  const afterDiscard = params.handCounts.slice();
  afterDiscard[params.discardTile] = (afterDiscard[params.discardTile] ?? 0) - 1;

  const s = shantenBlood({ counts13: afterDiscard, melds: params.melds, memo: params.memo.shanten });

  const tenpaiEval = s === 0 ? evalDiscardTenpaiNet(params) : null;

  const risk = ((): EvplusRisk => {
    const Rx = params.remCounts[params.discardTile] ?? 0;
    const tileSuit = suitOf(params.discardTile);
    const pDealIn = pDealInBase({ U: params.U, Rx, opponents: params.ctx.opponents, tileSuit });
    const riskDealIn = pDealIn * params.ctx.base;

    const pMingKong = pAnyOpponentMingKongFiltered({ U: params.U, Rx, opponents: params.ctx.opponents, tileSuit });
    const riskMingKong = pMingKong * (params.ctx.base * 2);

    const riskTotal = riskDealIn + riskMingKong;
    return { pDealIn, pMingKong, riskDealIn, riskMingKong, riskTotal };
  })();

  if (s === 0 && tenpaiEval) {
    return {
      discardTile: params.discardTile,
      shantenAfter: 0,
      improveTiles: tenpaiEval.tenpai.winTiles.slice(),
      improveCount: tenpaiEval.tenpai.winCount,
      tenpaiValue: tenpaiEval.netEv,
      improveDetails: [],
      tenpai: tenpaiEval.tenpai,
      risk,
    };
  }

  const st = stateValueToTenpai({
    counts13: afterDiscard,
    melds: params.melds,
    U: params.U,
    remCounts: params.remCounts,
    ctx: params.ctx,
    memo: params.memo,
  });
  const improveTiles = st.improveDetails.map((d) => d.drawTile);

  return {
    discardTile: params.discardTile,
    shantenAfter: s,
    improveTiles,
    improveCount: st.improveCount,
    tenpaiValue: st.value,
    improveDetails: st.improveDetails,
    tenpai: null,
    risk,
  };
}

export function bestDiscardFromHand(params: {
  handCounts: Array<number>;
  melds: ReadonlyArray<CalcMeld>;
  U: number;
  remCounts: ReadonlyArray<number>;
  ctx: EvplusContext;
  memo: EvplusEvalMemo;
}): EvplusChanceResult | null {
  const candidates: Array<EvplusChanceResult> = [];
  for (let t = 0; t < params.handCounts.length; t++) {
    if ((params.handCounts[t] ?? 0) <= 0) continue;
    candidates.push(
      evalDiscardChance({
        handCounts: params.handCounts,
        melds: params.melds,
        discardTile: t,
        U: params.U,
        remCounts: params.remCounts,
        ctx: params.ctx,
        memo: params.memo,
      }),
    );
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.shantenAfter !== b.shantenAfter) return a.shantenAfter - b.shantenAfter;
    if (b.improveCount !== a.improveCount) return b.improveCount - a.improveCount;
    const av = a.tenpaiValue ?? -Infinity;
    const bv = b.tenpaiValue ?? -Infinity;
    if (bv !== av) return bv - av;
    if (a.risk.riskTotal !== b.risk.riskTotal) return a.risk.riskTotal - b.risk.riskTotal;
    const ar = params.remCounts[a.discardTile] ?? 0;
    const br = params.remCounts[b.discardTile] ?? 0;
    return ar - br;
  });

  return candidates[0] ?? null;
}

export function canHuNow(params: {
  concealedCounts14: ReadonlyArray<number>;
  melds: ReadonlyArray<CalcMeld>;
  ctx: EvplusContext;
  memo: EvplusEvalMemo;
  method: 'zimo' | 'dianpao';
}): { ok: boolean; gain: number } {
  // 定缺：手里若含缺门，直接不可胡
  if (hasDingqueTile(params.concealedCounts14, params.ctx.myDingque)) {
    return { ok: false, gain: 0 };
  }
  const alive = aliveOpponents(params.ctx.opponents).length;
  const gain = calcHuGainCached({
    concealedCounts: params.concealedCounts14,
    melds: params.melds,
    base: params.ctx.base,
    cap: params.ctx.cap,
    huMethod: params.method,
    remainingOpponents: alive,
    memo: params.memo.huGain,
  });
  return { ok: gain > 0, gain };
}

export function pDrawTileFromUnknown(U: number, rem: number): number {
  if (U <= 0 || rem <= 0) return 0;
  return clamp01(rem / U);
}

export function pOppHasAllThreeWhenRx3(U: number, h: number): number {
  if (U <= 2 || h < 3) return 0;
  // (h/U)*((h-1)/(U-1))*((h-2)/(U-2))
  return clamp01((h / U) * ((h - 1) / (U - 1)) * ((h - 2) / (U - 2)));
}

export function expectedHandSizeBeforeDiscard(meldCount: number): number {
  return 14 - 3 * meldCount;
}

export function expectedHandSizeAfterDiscard(meldCount: number): number {
  return 13 - 3 * meldCount;
}

export function validateCountsUnder108(params: {
  concealedCounts: ReadonlyArray<number>;
  melds: ReadonlyArray<CalcMeld>;
  visibleCounts: ReadonlyArray<number>;
}): Array<string> {
  const errs: Array<string> = [];
  const meldCounts = countsFromMelds(params.melds);
  for (let i = 0; i < EVPLUS_TILE_TYPES; i++) {
    const used = (params.concealedCounts[i] ?? 0) + (meldCounts[i] ?? 0) + (params.visibleCounts[i] ?? 0);
    if (used > EVPLUS_COPIES_PER_TILE) errs.push(`牌 key=${i} 已知 ${used} 张（超过 4）`);
    if (used < 0) errs.push(`牌 key=${i} 张数为负（已知 ${used}）`);
  }
  const knownTotal = sumCounts(params.concealedCounts) + sumCounts(meldCounts) + sumCounts(params.visibleCounts);
  if (knownTotal > 108) errs.push(`已知牌张数=${knownTotal} 超过 108（可能重复计数了可见牌/副露）`);
  return errs;
}

export function remCountsFromKnown(params: {
  concealedCounts: ReadonlyArray<number>;
  melds: ReadonlyArray<CalcMeld>;
  visibleCounts: ReadonlyArray<number>;
}): Array<number> {
  const meldCounts = countsFromMelds(params.melds);
  const rem = new Array(EVPLUS_TILE_TYPES).fill(0);
  for (let i = 0; i < EVPLUS_TILE_TYPES; i++) {
    const used = (params.concealedCounts[i] ?? 0) + (meldCounts[i] ?? 0) + (params.visibleCounts[i] ?? 0);
    rem[i] = Math.max(0, EVPLUS_COPIES_PER_TILE - used);
  }
  return rem;
}

export function pExactOpponentHas3WhenRx3(U: number, h: number): number {
  // 只用于解释：R=3 时“明杠必须拿到这 3 张”
  if (U <= 0 || h < 3) return 0;
  const denom = comb(U, h);
  if (denom <= 0) return 0;
  return clamp01(comb(U - 3, h - 3) / denom);
}
