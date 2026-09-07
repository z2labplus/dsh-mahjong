export type EvV1Config = {
  oppDiscardsBeforeYourDraw: number;
  baseZimo: number;
  baseRon: number;
  lossDealIn: number;
  lossMingKong: number;
};

export type EvDiscardResult = {
  discardTile: number;
  winTiles: Array<number>;
  winCount: number;
  evZimo: number;
  evRon: number;
  gainTotal: number;
  riskDealInBase: number;
  riskMingKong: number;
  riskTotal: number;
  netEv: number;
  pZimo: number;
  pRon: number;
  pDealInBase: number;
  pMingKong: number;
};

export type EvImproveDetail = {
  drawTile: number;
  weight: number;
  bestDiscard: number;
  nextShanten: number;
  value: number;
};

export type EvChanceResult = {
  discardTile: number;
  shantenAfter: number;
  improveTiles: Array<number>;
  improveCount: number;
  tenpaiValue: number | null;
  improveDetails: Array<EvImproveDetail>;
  // tenpai 时：winTiles/winCount/tenpaiValue 都来自 v1 的直接评估
  winTiles: Array<number>;
  winCount: number;
  // 当前弃牌风险（只算这一次 x）
  riskDealInBase: number;
  riskMingKong: number;
  riskTotal: number;
};

export const EV_V1_DEFAULT_CONFIG: EvV1Config = {
  oppDiscardsBeforeYourDraw: 3,
  baseZimo: 6,
  baseRon: 1,
  lossDealIn: 1,
  lossMingKong: 2,
};

export const EV_TILE_TYPES = 27;
export const EV_COPIES_PER_TILE = 4;

export function countsFromTiles(tiles: ReadonlyArray<number>, tileTypes = EV_TILE_TYPES): Array<number> {
  const counts = Array.from({ length: tileTypes }, () => 0);
  for (const t of tiles) {
    if (!Number.isInteger(t) || t < 0 || t >= tileTypes) {
      throw new Error(`非法牌 key: ${String(t)}`);
    }
    counts[t]! += 1;
  }
  return counts;
}

export function sumCounts(counts: ReadonlyArray<number>): number {
  let s = 0;
  for (const c of counts) s += c;
  return s;
}

export function computeRemCounts(params: {
  handCounts: ReadonlyArray<number>;
  meldCounts?: ReadonlyArray<number>;
  visibleCounts?: ReadonlyArray<number>;
  copiesPerTile?: number;
}): { rem: Array<number>; errors: Array<string> } {
  const copies = params.copiesPerTile ?? EV_COPIES_PER_TILE;
  const meld = params.meldCounts ?? Array.from({ length: params.handCounts.length }, () => 0);
  const vis = params.visibleCounts ?? Array.from({ length: params.handCounts.length }, () => 0);

  if (meld.length !== params.handCounts.length || vis.length !== params.handCounts.length) {
    throw new Error('counts 长度不一致');
  }

  const rem = Array.from({ length: params.handCounts.length }, () => 0);
  const errors: Array<string> = [];
  for (let i = 0; i < params.handCounts.length; i++) {
    const used = (params.handCounts[i] ?? 0) + (meld[i] ?? 0) + (vis[i] ?? 0);
    if (used > copies) {
      errors.push(`牌 key=${i} 已知张数超过 ${copies}（hand+meld+visible=${used}）`);
      rem[i] = 0;
      continue;
    }
    if (used < 0) {
      errors.push(`牌 key=${i} 张数为负（hand+meld+visible=${used}）`);
      rem[i] = 0;
      continue;
    }
    rem[i] = copies - used;
  }
  return { rem, errors };
}

export function computeRootsFromTiles(tiles: ReadonlyArray<number>): { roots: number; errors: Array<string> } {
  const counts = countsFromTiles(tiles);
  const errors: Array<string> = [];
  let roots = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i] ?? 0;
    if (c > EV_COPIES_PER_TILE) {
      errors.push(`根牌输入里：牌 key=${i} 张数超过 ${EV_COPIES_PER_TILE}（=${c}）`);
    }
    if (c === EV_COPIES_PER_TILE) roots += 1;
  }
  return { roots, errors };
}

function encodeCountsKey(counts: ReadonlyArray<number>): string {
  // counts 只应包含 0..4；用无分隔拼接可以减少开销
  let out = '';
  for (let i = 0; i < counts.length; i++) out += String(counts[i] ?? 0);
  return out;
}

function encodeCountsKeyWithFixedMelds(counts: ReadonlyArray<number>, fixedMeldCount: number): string {
  return `${fixedMeldCount}|${encodeCountsKey(counts)}`;
}

function canFormAllMelds(counts: Array<number>, memo: Map<string, boolean>): boolean {
  const key = encodeCountsKey(counts);
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  let first = -1;
  for (let i = 0; i < counts.length; i++) {
    if ((counts[i] ?? 0) > 0) {
      first = i;
      break;
    }
  }
  if (first === -1) {
    memo.set(key, true);
    return true;
  }

  const c = counts[first] ?? 0;
  // 刻子
  if (c >= 3) {
    counts[first] = c - 3;
    if (canFormAllMelds(counts, memo)) {
      counts[first] = c;
      memo.set(key, true);
      return true;
    }
    counts[first] = c;
  }

  // 顺子：同花色且点数<=7
  const r = first % 9; // 0..8
  if (r <= 6) {
    const c1 = counts[first + 1] ?? 0;
    const c2 = counts[first + 2] ?? 0;
    if (c1 > 0 && c2 > 0) {
      counts[first] = c - 1;
      counts[first + 1] = c1 - 1;
      counts[first + 2] = c2 - 1;
      if (canFormAllMelds(counts, memo)) {
        counts[first] = c;
        counts[first + 1] = c1;
        counts[first + 2] = c2;
        memo.set(key, true);
        return true;
      }
      counts[first] = c;
      counts[first + 1] = c1;
      counts[first + 2] = c2;
    }
  }

  memo.set(key, false);
  return false;
}

export function isWinPinghu(params: {
  counts: Array<number>;
  fixedMeldCount: number;
  memo?: Map<string, boolean>;
}): boolean {
  const needMelds = 4 - params.fixedMeldCount;
  if (needMelds < 0) return false;

  const total = sumCounts(params.counts);
  if (total !== needMelds * 3 + 2) return false;

  const memo = params.memo ?? new Map<string, boolean>();

  for (let i = 0; i < params.counts.length; i++) {
    const c = params.counts[i] ?? 0;
    if (c < 2) continue;
    params.counts[i] = c - 2;
    const ok = canFormAllMelds(params.counts, memo);
    params.counts[i] = c;
    if (ok) return true;
  }
  return false;
}

export function shantenPinghu(params: {
  counts: Array<number>;
  fixedMeldCount: number;
  memo?: Map<string, number>;
}): number {
  const key = encodeCountsKeyWithFixedMelds(params.counts, params.fixedMeldCount);
  const cached = params.memo?.get(key);
  if (cached !== undefined) return cached;

  const fixed = params.fixedMeldCount;
  // 对标准 4 面子 + 1 对将：shanten 最小为 -1（已胡），这里主要用于弃牌后（13张）所以一般 >=0
  let best = 8;

  const work = params.counts.slice();

  const dfs = (mentsu: number, taatsu: number, hasPair: number): void => {
    // 找第一个非 0
    let i = -1;
    for (let k = 0; k < work.length; k++) {
      if ((work[k] ?? 0) > 0) {
        i = k;
        break;
      }
    }

    if (i === -1) {
      let m = fixed + mentsu;
      if (m > 4) m = 4;
      let t = taatsu;
      const maxT = 4 - m;
      if (t > maxT) t = maxT;
      const s = 8 - 2 * m - t - hasPair;
      if (s < best) best = s;
      return;
    }

    const c0 = work[i] ?? 0;

    // 刻子
    if (c0 >= 3) {
      work[i] = c0 - 3;
      dfs(mentsu + 1, taatsu, hasPair);
      work[i] = c0;
    }

    // 顺子
    const r = i % 9;
    if (r <= 6) {
      const c1 = work[i + 1] ?? 0;
      const c2 = work[i + 2] ?? 0;
      if (c1 > 0 && c2 > 0) {
        work[i] = c0 - 1;
        work[i + 1] = c1 - 1;
        work[i + 2] = c2 - 1;
        dfs(mentsu + 1, taatsu, hasPair);
        work[i] = c0;
        work[i + 1] = c1;
        work[i + 2] = c2;
      }
    }

    // 将（对）
    if (hasPair === 0 && c0 >= 2) {
      work[i] = c0 - 2;
      dfs(mentsu, taatsu, 1);
      work[i] = c0;
    }

    // 搭子（对子当搭子）
    if (c0 >= 2) {
      work[i] = c0 - 2;
      dfs(mentsu, taatsu + 1, hasPair);
      work[i] = c0;
    }

    // 搭子（两面/边张 i,i+1）
    if (r <= 7) {
      const c1 = work[i + 1] ?? 0;
      if (c1 > 0) {
        work[i] = c0 - 1;
        work[i + 1] = c1 - 1;
        dfs(mentsu, taatsu + 1, hasPair);
        work[i] = c0;
        work[i + 1] = c1;
      }
    }

    // 搭子（坎张 i,i+2）
    if (r <= 6) {
      const c2 = work[i + 2] ?? 0;
      if (c2 > 0) {
        work[i] = c0 - 1;
        work[i + 2] = c2 - 1;
        dfs(mentsu, taatsu + 1, hasPair);
        work[i] = c0;
        work[i + 2] = c2;
      }
    }

    // 单张丢弃（不形成组）
    work[i] = c0 - 1;
    dfs(mentsu, taatsu, hasPair);
    work[i] = c0;
  };

  dfs(0, 0, 0);

  if (params.memo) params.memo.set(key, best);
  return best;
}

export function comb(n: number, k: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(k)) return 0;
  const nn = Math.floor(n);
  const kk = Math.floor(k);
  if (kk < 0 || kk > nn) return 0;
  const k2 = Math.min(kk, nn - kk);
  let res = 1;
  for (let i = 1; i <= k2; i++) {
    res *= nn - (k2 - i);
    res /= i;
  }
  return res;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function pOpponentHasAtLeastKOfTile(U: number, h: number, R: number, k: number): number {
  if (U <= 0 || h <= 0 || R <= 0) return 0;
  if (k <= 0) return 1;
  if (k > h || k > R) return 0;

  const denom = comb(U, h);
  if (denom <= 0) return 0;

  let s = 0;
  const max = Math.min(R, h);
  for (let x = k; x <= max; x++) {
    s += (comb(R, x) * comb(U - R, h - x)) / denom;
  }
  return clamp01(s);
}

export function pAnyOpponentMingKong(U: number, oppHandSizes: ReadonlyArray<number>, R: number): number {
  const ps = oppHandSizes.map((h) => pOpponentHasAtLeastKOfTile(U, h, R, 3));
  if (R === 3) {
    let sum = 0;
    for (const p of ps) sum += p;
    return clamp01(sum);
  }
  let prod = 1;
  for (const p of ps) prod *= 1 - p;
  return clamp01(1 - prod);
}

export function evalDiscardV1(params: {
  handCounts: Array<number>;
  fixedMeldCount: number;
  discardTile: number;
  roots: number;
  U: number;
  oppHandSizes: ReadonlyArray<number>;
  remCounts: ReadonlyArray<number>;
  config?: Partial<EvV1Config>;
  memo?: Map<string, boolean>;
}): EvDiscardResult {
  const cfg: EvV1Config = { ...EV_V1_DEFAULT_CONFIG, ...(params.config ?? {}) };
  const mult = Math.pow(2, params.roots);

  const base = params.handCounts.slice();
  if ((base[params.discardTile] ?? 0) <= 0) {
    throw new Error('discardTile 不在手牌中');
  }
  base[params.discardTile]! -= 1;

  const memo = params.memo ?? new Map<string, boolean>();
  const winTiles: Array<number> = [];
  for (let t = 0; t < params.remCounts.length; t++) {
    const r = params.remCounts[t] ?? 0;
    if (r <= 0) continue;
    base[t] = (base[t] ?? 0) + 1;
    const ok = isWinPinghu({ counts: base, fixedMeldCount: params.fixedMeldCount, memo });
    base[t]! -= 1;
    if (ok) winTiles.push(t);
  }

  let W = 0;
  for (const t of winTiles) W += params.remCounts[t] ?? 0;

  const U = params.U;
  const pZimo = U > 0 ? clamp01(W / U) : 0;
  const evZimo = pZimo * (cfg.baseZimo * mult);

  const pHit = U > 0 ? clamp01(W / U) : 0;
  const pRon = clamp01(1 - Math.pow(1 - pHit, cfg.oppDiscardsBeforeYourDraw));
  const evRon = pRon * (cfg.baseRon * mult);
  const gainTotal = evZimo + evRon;

  const Rx = params.remCounts[params.discardTile] ?? 0;
  const pDealInBase = clamp01(1 - Math.pow(1 - (U > 0 ? Rx / U : 0), 3));
  const riskDealInBase = pDealInBase * cfg.lossDealIn;

  const pMingKong = pAnyOpponentMingKong(U, params.oppHandSizes, Rx);
  const riskMingKong = pMingKong * cfg.lossMingKong;

  const riskTotal = riskDealInBase + riskMingKong;
  const netEv = gainTotal - riskTotal;

  return {
    discardTile: params.discardTile,
    winTiles,
    winCount: W,
    evZimo,
    evRon,
    gainTotal,
    riskDealInBase,
    riskMingKong,
    riskTotal,
    netEv,
    pZimo,
    pRon,
    pDealInBase,
    pMingKong,
  };
}

function bestDiscardAfterDrawToReduceShanten(params: {
  baseAfterDiscard: Array<number>;
  fixedMeldCount: number;
  drawTile: number;
  prevShanten: number;
  U: number;
  oppHandSizes: ReadonlyArray<number>;
  remCounts: ReadonlyArray<number>;
  winMemo: Map<string, boolean>;
  shantenMemo: Map<string, number>;
  valueMemo: Map<string, { value: number | null; improveCount: number; improveDetails: Array<EvImproveDetail> }>;
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

    const sNext = shantenPinghu({ counts: nextCounts13, fixedMeldCount: params.fixedMeldCount, memo: params.shantenMemo });
    if (sNext < params.prevShanten) {
      let v: number;
      if (sNext === 0) {
        // 进到听牌：用“这次弃 y” 的 v1 净值作为 V_t
        const v1 = evalDiscardV1({
          handCounts: params.baseAfterDiscard.slice().map((c, i) => (i === params.drawTile ? (c ?? 0) + 1 : c ?? 0)),
          fixedMeldCount: params.fixedMeldCount,
          discardTile: y,
          roots: 0,
          U: params.U,
          oppHandSizes: params.oppHandSizes,
          remCounts: params.remCounts,
          memo: params.winMemo,
        });
        v = v1.netEv;
      } else {
        const st = stateValueToTenpai({
          counts13: nextCounts13.slice(),
          fixedMeldCount: params.fixedMeldCount,
          U: params.U,
          oppHandSizes: params.oppHandSizes,
          remCounts: params.remCounts,
          winMemo: params.winMemo,
          shantenMemo: params.shantenMemo,
          valueMemo: params.valueMemo,
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
  fixedMeldCount: number;
  U: number;
  oppHandSizes: ReadonlyArray<number>;
  remCounts: ReadonlyArray<number>;
  winMemo: Map<string, boolean>;
  shantenMemo: Map<string, number>;
  valueMemo: Map<string, { value: number | null; improveCount: number; improveDetails: Array<EvImproveDetail> }>;
}): { value: number | null; improveCount: number; improveDetails: Array<EvImproveDetail> } {
  const key = encodeCountsKeyWithFixedMelds(params.counts13, params.fixedMeldCount);
  const cached = params.valueMemo.get(key);
  if (cached) return cached;

  const s0 = shantenPinghu({ counts: params.counts13, fixedMeldCount: params.fixedMeldCount, memo: params.shantenMemo });

  // 只定义在 s0>0 的状态上；若 s0==0，应该在外层用 v1 直接算
  const details: Array<EvImproveDetail> = [];
  let sumW = 0;
  let sumWV = 0;

  if (s0 > 0) {
    for (let t = 0; t < params.remCounts.length; t++) {
      const w = params.remCounts[t] ?? 0;
      if (w <= 0) continue;

      const best = bestDiscardAfterDrawToReduceShanten({
        baseAfterDiscard: params.counts13,
        fixedMeldCount: params.fixedMeldCount,
        drawTile: t,
        prevShanten: s0,
        U: params.U,
        oppHandSizes: params.oppHandSizes,
        remCounts: params.remCounts,
        winMemo: params.winMemo,
        shantenMemo: params.shantenMemo,
        valueMemo: params.valueMemo,
      });
      if (!best) continue;

      details.push({ drawTile: t, weight: w, bestDiscard: best.bestDiscard, nextShanten: best.nextShanten, value: best.value });
      sumW += w;
      sumWV += w * best.value;
    }
  }

  const value = sumW > 0 ? sumWV / sumW : null;
  const out = { value, improveCount: sumW, improveDetails: details };
  params.valueMemo.set(key, out);
  return out;
}

export function evalDiscardChance(params: {
  handCounts: Array<number>;
  fixedMeldCount: number;
  discardTile: number;
  U: number;
  oppHandSizes: ReadonlyArray<number>;
  remCounts: ReadonlyArray<number>;
  winMemo?: Map<string, boolean>;
  shantenMemo?: Map<string, number>;
  valueMemo?: Map<string, { value: number | null; improveCount: number; improveDetails: Array<EvImproveDetail> }>;
}): EvChanceResult {
  const winMemo = params.winMemo ?? new Map<string, boolean>();
  const shantenMemo = params.shantenMemo ?? new Map<string, number>();
  const valueMemo =
    params.valueMemo ?? new Map<string, { value: number | null; improveCount: number; improveDetails: Array<EvImproveDetail> }>();

  const v1 = evalDiscardV1({
    handCounts: params.handCounts,
    fixedMeldCount: params.fixedMeldCount,
    discardTile: params.discardTile,
    roots: 0,
    U: params.U,
    oppHandSizes: params.oppHandSizes,
    remCounts: params.remCounts,
    memo: winMemo,
  });

  const baseAfterDiscard = params.handCounts.slice();
  baseAfterDiscard[params.discardTile]! -= 1;
  const s = shantenPinghu({ counts: baseAfterDiscard, fixedMeldCount: params.fixedMeldCount, memo: shantenMemo });

  if (s === 0) {
    return {
      discardTile: params.discardTile,
      shantenAfter: 0,
      improveTiles: v1.winTiles.slice(),
      improveCount: v1.winCount,
      tenpaiValue: v1.netEv,
      improveDetails: [],
      winTiles: v1.winTiles.slice(),
      winCount: v1.winCount,
      riskDealInBase: v1.riskDealInBase,
      riskMingKong: v1.riskMingKong,
      riskTotal: v1.riskTotal,
    };
  }

  const st = stateValueToTenpai({
    counts13: baseAfterDiscard,
    fixedMeldCount: params.fixedMeldCount,
    U: params.U,
    oppHandSizes: params.oppHandSizes,
    remCounts: params.remCounts,
    winMemo,
    shantenMemo,
    valueMemo,
  });

  const improveTiles = st.improveDetails.map((d) => d.drawTile);

  return {
    discardTile: params.discardTile,
    shantenAfter: s,
    improveTiles,
    improveCount: st.improveCount,
    tenpaiValue: st.value,
    improveDetails: st.improveDetails,
    winTiles: [],
    winCount: 0,
    riskDealInBase: v1.riskDealInBase,
    riskMingKong: v1.riskMingKong,
    riskTotal: v1.riskTotal,
  };
}
