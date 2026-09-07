import type { BloodSuit } from './blood';
import type { CalcMeld } from './blood-calc-notation';
import { suitOf } from './blood-tiles';
import { calcBloodHu } from './blood-calc-engine';
import { canHuCounts } from './blood-win';

export type TenpaiWait = { tileKey: number; remain: number; multiplier: number };

export type TenpaiPreview = {
  isTenpai: boolean;
  waits: Array<TenpaiWait>;
  total: number;
  kinds: number;
  maxMultiplier: number | null;
};

function hasSuit(counts: Uint8Array, suit: BloodSuit): boolean {
  const base = suit === 'm' ? 0 : suit === 'p' ? 9 : 18;
  for (let i = 0; i < 9; i++) {
    if ((counts[base + i] ?? 0) > 0) return true;
  }
  return false;
}

function buildConcealedTiles(counts: Uint8Array): Array<number> {
  const tiles: Array<number> = [];
  for (let tileKey = 0; tileKey < 27; tileKey++) {
    const n = counts[tileKey] ?? 0;
    for (let i = 0; i < n; i++) tiles.push(tileKey);
  }
  return tiles;
}

function sortByRemainDesc(a: TenpaiWait, b: TenpaiWait): number {
  if (b.remain !== a.remain) return b.remain - a.remain;
  return a.tileKey - b.tileKey;
}

export function computeTenpaiPreviewAfterDiscard(params: {
  countsAfterDiscard: Uint8Array;
  melds: Array<CalcMeld>;
  meldCount: number;
  dingque: BloodSuit;
  remainingCounts: ReadonlyArray<number>;
  base: number;
}): TenpaiPreview {
  if (hasSuit(params.countsAfterDiscard, params.dingque)) {
    return { isTenpai: false, waits: [], total: 0, kinds: 0, maxMultiplier: null };
  }

  const base = Number.isFinite(params.base) ? Math.trunc(params.base) : 400;
  const meldCount = Math.max(0, Math.trunc(params.meldCount));

  let isTenpai = false;
  const waits: Array<TenpaiWait> = [];
  let maxMultiplier = 0;

  const concealedTiles13 = buildConcealedTiles(params.countsAfterDiscard);

  const counts14 = new Uint8Array(params.countsAfterDiscard);
  for (let winTileKey = 0; winTileKey < 27; winTileKey++) {
    if (suitOf(winTileKey) === params.dingque) continue;
    if ((counts14[winTileKey] ?? 0) >= 4) continue;

    counts14[winTileKey] += 1;
    const canHu = canHuCounts(Array.from(counts14.values()), meldCount);
    counts14[winTileKey] -= 1;
    if (!canHu) continue;

    isTenpai = true;

    const remain = params.remainingCounts[winTileKey] ?? 0;
    if (remain <= 0) continue;

    const res = calcBloodHu(
      { concealedTiles: [...concealedTiles13, winTileKey], melds: params.melds },
      { base, huMethod: 'dianpao' },
    );
    if (!res.ok) continue;
    const mult = Math.trunc(res.multiplierCapped);
    waits.push({ tileKey: winTileKey, remain, multiplier: mult });
    maxMultiplier = Math.max(maxMultiplier, mult);
  }

  waits.sort(sortByRemainDesc);
  const total = waits.reduce((acc, w) => acc + w.remain, 0);
  const kinds = waits.length;

  return {
    isTenpai,
    waits,
    total,
    kinds,
    maxMultiplier: kinds > 0 ? maxMultiplier : null,
  };
}
