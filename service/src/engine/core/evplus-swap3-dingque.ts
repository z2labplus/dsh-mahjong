import type { BloodSuit } from './blood-types';
import type { CalcMeld } from './blood-calc-notation';
import { suitOf } from './blood-tiles';
import { createEvplusMemo, evalStateValue, remCountsFromKnown, shantenBlood, bestDiscardFromHand, type EvplusContext, type EvplusOpponent, type EvplusSeat } from './evplus-engine';

const SUITS: ReadonlyArray<BloodSuit> = ['m', 'p', 's'];

export type Swap3StructureBreakdown = {
  meldCount: number;
  taatsuCount: number;
  pairCount: number;
  score: number;
};

export type Swap3StructureCandidate = {
  index: number;
  tiles: [number, number, number];
  suit: BloodSuit;
  before: Swap3StructureBreakdown;
  after: Swap3StructureBreakdown;
  structureLoss: number;
  isolatedCount: number;
  breakMeldCount: number;
  feedRiskScore: number;
  feedRiskTier: 'meld' | 'pair' | 'ryanmen' | 'taatsu' | 'low';
  kongLoss: number;
  pairLoss: number;
};

export type Swap3StructureRecommendation = {
  bestIndex: number;
  candidates: Array<Swap3StructureCandidate>;
  ranked: Array<Swap3StructureCandidate>;
  selectedSuit: BloodSuit | null;
  suitKeepScores: Partial<Record<BloodSuit, number>>;
};

export function countSuitTiles(handCounts: ReadonlyArray<number>): Record<BloodSuit, number> {
  const out: Record<BloodSuit, number> = { m: 0, p: 0, s: 0 };
  for (let k = 0; k < handCounts.length; k++) {
    const c = handCounts[k] ?? 0;
    if (c <= 0) continue;
    out[suitOf(k)] += c;
  }
  return out;
}

export function recommendDingqueSimple(handCounts: ReadonlyArray<number>): BloodSuit {
  const counts = countSuitTiles(handCounts);
  let best: BloodSuit = 'm';
  let bestCount = counts[best] ?? 0;
  for (const s of ['p', 's'] as const) {
    const c = counts[s] ?? 0;
    if (c < bestCount) {
      best = s;
      bestCount = c;
      continue;
    }
    if (c === bestCount && evaluateSuitKeepScore(handCounts, s) < evaluateSuitKeepScore(handCounts, best)) {
      best = s;
    }
  }
  return best;
}

function emptyBreakdown(): Swap3StructureBreakdown {
  return { meldCount: 0, taatsuCount: 0, pairCount: 0, score: 0 };
}

type Swap3SuitKeepBreakdown = {
  groupCount: number;
  meldCount: number;
  pairCount: number;
  ryanmenCount: number;
  taatsuCount: number;
  fourRunBonus: number;
  quadBonus: number;
  score: number;
};

function emptySuitKeepBreakdown(): Swap3SuitKeepBreakdown {
  return { groupCount: 0, meldCount: 0, pairCount: 0, ryanmenCount: 0, taatsuCount: 0, fourRunBonus: 0, quadBonus: 0, score: 0 };
}

function addSuitKeepBreakdown(
  base: Swap3SuitKeepBreakdown,
  delta: {
    groupCount?: number;
    meldCount?: number;
    pairCount?: number;
    ryanmenCount?: number;
    taatsuCount?: number;
    fourRunBonus?: number;
    quadBonus?: number;
    score?: number;
  },
): Swap3SuitKeepBreakdown {
  return {
    groupCount: base.groupCount + (delta.groupCount ?? 0),
    meldCount: base.meldCount + (delta.meldCount ?? 0),
    pairCount: base.pairCount + (delta.pairCount ?? 0),
    ryanmenCount: base.ryanmenCount + (delta.ryanmenCount ?? 0),
    taatsuCount: base.taatsuCount + (delta.taatsuCount ?? 0),
    fourRunBonus: base.fourRunBonus + (delta.fourRunBonus ?? 0),
    quadBonus: base.quadBonus + (delta.quadBonus ?? 0),
    score: base.score + (delta.score ?? 0),
  };
}

function betterSuitKeepBreakdown(a: Swap3SuitKeepBreakdown, b: Swap3SuitKeepBreakdown): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.groupCount !== b.groupCount) return a.groupCount > b.groupCount;
  if (a.meldCount !== b.meldCount) return a.meldCount > b.meldCount;
  if (a.pairCount !== b.pairCount) return a.pairCount > b.pairCount;
  if (a.ryanmenCount !== b.ryanmenCount) return a.ryanmenCount > b.ryanmenCount;
  if (a.taatsuCount !== b.taatsuCount) return a.taatsuCount > b.taatsuCount;
  return false;
}

function addBreakdown(
  base: Swap3StructureBreakdown,
  delta: { meldCount?: number; taatsuCount?: number; pairCount?: number; score?: number },
): Swap3StructureBreakdown {
  return {
    meldCount: base.meldCount + (delta.meldCount ?? 0),
    taatsuCount: base.taatsuCount + (delta.taatsuCount ?? 0),
    pairCount: base.pairCount + (delta.pairCount ?? 0),
    score: base.score + (delta.score ?? 0),
  };
}

function betterBreakdown(a: Swap3StructureBreakdown, b: Swap3StructureBreakdown): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.meldCount !== b.meldCount) return a.meldCount > b.meldCount;
  if (a.taatsuCount !== b.taatsuCount) return a.taatsuCount > b.taatsuCount;
  if (a.pairCount !== b.pairCount) return a.pairCount > b.pairCount;
  return false;
}

function scoreSuitStructure(
  counts: ReadonlyArray<number>,
  start: number,
  memo: Map<string, Swap3StructureBreakdown>,
): Swap3StructureBreakdown {
  let key = `${start}:`;
  for (let i = 0; i < 9; i++) key += String(counts[start + i] ?? 0);
  const cached = memo.get(key);
  if (cached) return cached;

  let first = -1;
  for (let i = 0; i < 9; i++) {
    if ((counts[start + i] ?? 0) > 0) {
      first = i;
      break;
    }
  }
  if (first === -1) {
    const out = emptyBreakdown();
    memo.set(key, out);
    return out;
  }

  const tile = start + first;
  let best: Swap3StructureBreakdown | null = null;
  const next = counts.slice();

  const tryUse = (delta: { meldCount?: number; taatsuCount?: number; pairCount?: number; score?: number }, deltas: Array<number>): void => {
    for (const idx of deltas) next[idx] = (next[idx] ?? 0) - 1;
    const candidate = addBreakdown(scoreSuitStructure(next, start, memo), delta);
    for (const idx of deltas) next[idx] = (next[idx] ?? 0) + 1;
    if (!best || betterBreakdown(candidate, best)) best = candidate;
  };

  tryUse({}, [tile]);

  if ((counts[tile] ?? 0) >= 3) {
    tryUse({ meldCount: 1, score: 100 }, [tile, tile, tile]);
  }
  if (first <= 6 && (counts[tile + 1] ?? 0) > 0 && (counts[tile + 2] ?? 0) > 0) {
    tryUse({ meldCount: 1, score: 100 }, [tile, tile + 1, tile + 2]);
  }
  if ((counts[tile] ?? 0) >= 2) {
    tryUse({ pairCount: 1, score: 10 }, [tile, tile]);
  }
  if (first <= 7 && (counts[tile + 1] ?? 0) > 0) {
    const adjacentScore = first >= 1 && first <= 6 ? 40 : 30;
    tryUse({ taatsuCount: 1, score: adjacentScore }, [tile, tile + 1]);
  }
  if (first <= 6 && (counts[tile + 2] ?? 0) > 0) {
    tryUse({ taatsuCount: 1, score: 30 }, [tile, tile + 2]);
  }

  const out = best ?? emptyBreakdown();
  memo.set(key, out);
  return out;
}

function scoreHandStructure(counts: ReadonlyArray<number>): Swap3StructureBreakdown {
  const memo = new Map<string, Swap3StructureBreakdown>();
  const out = emptyBreakdown();
  for (const start of [0, 9, 18]) {
    const part = scoreSuitStructure(counts, start, memo);
    out.meldCount += part.meldCount;
    out.taatsuCount += part.taatsuCount;
    out.pairCount += part.pairCount;
    out.score += part.score;
  }
  return out;
}

function scoreSuitKeepCore(
  counts: ReadonlyArray<number>,
  start: number,
  groupsLeft: number,
  memo: Map<string, Swap3SuitKeepBreakdown>,
): Swap3SuitKeepBreakdown {
  let key = `${start}:${groupsLeft}:`;
  for (let i = 0; i < 9; i++) key += String(counts[start + i] ?? 0);
  const cached = memo.get(key);
  if (cached) return cached;

  if (groupsLeft <= 0) {
    const out = emptySuitKeepBreakdown();
    memo.set(key, out);
    return out;
  }

  let first = -1;
  for (let i = 0; i < 9; i++) {
    if ((counts[start + i] ?? 0) > 0) {
      first = i;
      break;
    }
  }
  if (first === -1) {
    const out = emptySuitKeepBreakdown();
    memo.set(key, out);
    return out;
  }

  const tile = start + first;
  let best: Swap3SuitKeepBreakdown | null = null;
  const next = counts.slice();

  const tryUse = (
    delta: { groupCount?: number; meldCount?: number; pairCount?: number; ryanmenCount?: number; taatsuCount?: number; score?: number },
    deltas: Array<number>,
    consumeGroup: boolean,
  ): void => {
    for (const idx of deltas) next[idx] = (next[idx] ?? 0) - 1;
    const child = scoreSuitKeepCore(next, start, consumeGroup ? groupsLeft - 1 : groupsLeft, memo);
    const candidate = addSuitKeepBreakdown(child, delta);
    for (const idx of deltas) next[idx] = (next[idx] ?? 0) + 1;
    if (!best || betterSuitKeepBreakdown(candidate, best)) best = candidate;
  };

  tryUse({}, [tile], false);

  if ((counts[tile] ?? 0) >= 3) {
    tryUse({ groupCount: 1, meldCount: 1, score: 100 }, [tile, tile, tile], true);
  }
  if (first <= 6 && (counts[tile + 1] ?? 0) > 0 && (counts[tile + 2] ?? 0) > 0) {
    tryUse({ groupCount: 1, meldCount: 1, score: 100 }, [tile, tile + 1, tile + 2], true);
  }
  if ((counts[tile] ?? 0) >= 2) {
    tryUse({ groupCount: 1, pairCount: 1, score: 60 }, [tile, tile], true);
  }
  if (first <= 7 && (counts[tile + 1] ?? 0) > 0) {
    if (first >= 1 && first <= 6) {
      tryUse({ groupCount: 1, ryanmenCount: 1, score: 25 }, [tile, tile + 1], true);
    } else {
      tryUse({ groupCount: 1, taatsuCount: 1, score: 20 }, [tile, tile + 1], true);
    }
  }
  if (first <= 6 && (counts[tile + 2] ?? 0) > 0) {
    tryUse({ groupCount: 1, taatsuCount: 1, score: 20 }, [tile, tile + 2], true);
  }

  const out = best ?? emptySuitKeepBreakdown();
  memo.set(key, out);
  return out;
}

function evaluateSuitKeepBreakdown(counts: ReadonlyArray<number>, suit: BloodSuit): Swap3SuitKeepBreakdown {
  const start = suit === 'm' ? 0 : suit === 'p' ? 9 : 18;
  const memo = new Map<string, Swap3SuitKeepBreakdown>();
  const core = scoreSuitKeepCore(counts, start, 2, memo);

  let hasFourRun = false;
  for (let i = 0; i <= 5; i++) {
    if ((counts[start + i] ?? 0) > 0 && (counts[start + i + 1] ?? 0) > 0 && (counts[start + i + 2] ?? 0) > 0 && (counts[start + i + 3] ?? 0) > 0) {
      hasFourRun = true;
      break;
    }
  }

  let quadCount = 0;
  for (let i = 0; i < 9; i++) {
    if ((counts[start + i] ?? 0) >= 4) quadCount += 1;
  }

  return addSuitKeepBreakdown(core, {
    fourRunBonus: hasFourRun ? 20 : 0,
    quadBonus: quadCount * 120,
    score: (hasFourRun ? 20 : 0) + quadCount * 120,
  });
}

export function evaluateSuitKeepScore(counts: ReadonlyArray<number>, suit: BloodSuit): number {
  return evaluateSuitKeepBreakdown(counts, suit).score;
}

function compareTripleTiles(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function isIsolatedTileInHand(counts: ReadonlyArray<number>, tileKey: number): boolean {
  if ((counts[tileKey] ?? 0) >= 2) return false;
  const base = Math.floor(tileKey / 9) * 9;
  const rank = tileKey % 9;
  for (const delta of [-2, -1, 1, 2] as const) {
    const nextRank = rank + delta;
    if (nextRank < 0 || nextRank >= 9) continue;
    if ((counts[base + nextRank] ?? 0) > 0) return false;
  }
  return true;
}

function countIsolatedTilesInSelection(counts: ReadonlyArray<number>, tiles: ReadonlyArray<number>): number {
  let out = 0;
  for (const tileKey of tiles) {
    if (isIsolatedTileInHand(counts, tileKey)) out += 1;
  }
  return out;
}

function buildCountsWithTiles(tiles: ReadonlyArray<number>): Array<number> {
  const counts = new Array<number>(27).fill(0);
  for (const tileKey of tiles) counts[tileKey] = (counts[tileKey] ?? 0) + 1;
  return counts;
}

type Swap3FeedRiskBreakdown = {
  meldCount: number;
  pairCount: number;
  ryanmenCount: number;
  taatsuCount: number;
  score: number;
};

function emptyFeedRisk(): Swap3FeedRiskBreakdown {
  return { meldCount: 0, pairCount: 0, ryanmenCount: 0, taatsuCount: 0, score: 0 };
}

function addFeedRisk(
  base: Swap3FeedRiskBreakdown,
  delta: { meldCount?: number; pairCount?: number; ryanmenCount?: number; taatsuCount?: number; score?: number },
): Swap3FeedRiskBreakdown {
  return {
    meldCount: base.meldCount + (delta.meldCount ?? 0),
    pairCount: base.pairCount + (delta.pairCount ?? 0),
    ryanmenCount: base.ryanmenCount + (delta.ryanmenCount ?? 0),
    taatsuCount: base.taatsuCount + (delta.taatsuCount ?? 0),
    score: base.score + (delta.score ?? 0),
  };
}

function higherFeedRisk(a: Swap3FeedRiskBreakdown, b: Swap3FeedRiskBreakdown): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.meldCount !== b.meldCount) return a.meldCount > b.meldCount;
  if (a.pairCount !== b.pairCount) return a.pairCount > b.pairCount;
  if (a.ryanmenCount !== b.ryanmenCount) return a.ryanmenCount > b.ryanmenCount;
  if (a.taatsuCount !== b.taatsuCount) return a.taatsuCount > b.taatsuCount;
  return false;
}

function scoreSuitFeedRisk(
  counts: ReadonlyArray<number>,
  start: number,
  memo: Map<string, Swap3FeedRiskBreakdown>,
): Swap3FeedRiskBreakdown {
  let key = `${start}:`;
  for (let i = 0; i < 9; i++) key += String(counts[start + i] ?? 0);
  const cached = memo.get(key);
  if (cached) return cached;

  let first = -1;
  for (let i = 0; i < 9; i++) {
    if ((counts[start + i] ?? 0) > 0) {
      first = i;
      break;
    }
  }
  if (first === -1) {
    const out = emptyFeedRisk();
    memo.set(key, out);
    return out;
  }

  const tile = start + first;
  let best: Swap3FeedRiskBreakdown | null = null;
  const next = counts.slice();

  const tryUse = (
    delta: { meldCount?: number; pairCount?: number; ryanmenCount?: number; taatsuCount?: number; score?: number },
    deltas: Array<number>,
  ): void => {
    for (const idx of deltas) next[idx] = (next[idx] ?? 0) - 1;
    const candidate = addFeedRisk(scoreSuitFeedRisk(next, start, memo), delta);
    for (const idx of deltas) next[idx] = (next[idx] ?? 0) + 1;
    if (!best || higherFeedRisk(candidate, best)) best = candidate;
  };

  tryUse({}, [tile]);

  if ((counts[tile] ?? 0) >= 3) {
    tryUse({ meldCount: 1, score: 100 }, [tile, tile, tile]);
  }
  if (first <= 6 && (counts[tile + 1] ?? 0) > 0 && (counts[tile + 2] ?? 0) > 0) {
    tryUse({ meldCount: 1, score: 100 }, [tile, tile + 1, tile + 2]);
  }
  if ((counts[tile] ?? 0) >= 2) {
    tryUse({ pairCount: 1, score: 70 }, [tile, tile]);
  }
  if (first <= 7 && (counts[tile + 1] ?? 0) > 0) {
    if (first >= 1 && first <= 6) {
      tryUse({ ryanmenCount: 1, score: 50 }, [tile, tile + 1]);
    } else {
      tryUse({ taatsuCount: 1, score: 30 }, [tile, tile + 1]);
    }
  }
  if (first <= 6 && (counts[tile + 2] ?? 0) > 0) {
    tryUse({ taatsuCount: 1, score: 30 }, [tile, tile + 2]);
  }

  const out = best ?? emptyFeedRisk();
  memo.set(key, out);
  return out;
}

function scoreFeedRisk(counts: ReadonlyArray<number>): Swap3FeedRiskBreakdown {
  const memo = new Map<string, Swap3FeedRiskBreakdown>();
  const out = emptyFeedRisk();
  for (const start of [0, 9, 18]) {
    const part = scoreSuitFeedRisk(counts, start, memo);
    out.meldCount += part.meldCount;
    out.pairCount += part.pairCount;
    out.ryanmenCount += part.ryanmenCount;
    out.taatsuCount += part.taatsuCount;
    out.score += part.score;
  }
  return out;
}

function feedRiskTierOf(breakdown: Swap3FeedRiskBreakdown): 'meld' | 'pair' | 'ryanmen' | 'taatsu' | 'low' {
  if (breakdown.meldCount > 0) return 'meld';
  if (breakdown.pairCount > 0) return 'pair';
  if (breakdown.ryanmenCount > 0) return 'ryanmen';
  if (breakdown.taatsuCount > 0) return 'taatsu';
  return 'low';
}

function computeKongLoss(before: ReadonlyArray<number>, after: ReadonlyArray<number>, tiles: ReadonlyArray<number>): number {
  let out = 0;
  const seen = new Set<number>();
  for (const tileKey of tiles) {
    if (seen.has(tileKey)) continue;
    seen.add(tileKey);
    const prev = before[tileKey] ?? 0;
    const next = after[tileKey] ?? 0;
    const removed = Math.max(0, prev - next);
    if (removed <= 0) continue;
    if (prev >= 4) out += removed * 2;
    else if (prev === 3) out += removed;
  }
  return out;
}

function computePairLoss(before: ReadonlyArray<number>, after: ReadonlyArray<number>, tiles: ReadonlyArray<number>): number {
  let out = 0;
  const seen = new Set<number>();
  for (const tileKey of tiles) {
    if (seen.has(tileKey)) continue;
    seen.add(tileKey);
    const prevPairs = Math.floor((before[tileKey] ?? 0) / 2);
    const nextPairs = Math.floor((after[tileKey] ?? 0) / 2);
    out += Math.max(0, prevPairs - nextPairs);
  }
  return out;
}

function compareSwap3Candidate(a: Swap3StructureCandidate, b: Swap3StructureCandidate): number {
  if (a.structureLoss !== b.structureLoss) return a.structureLoss - b.structureLoss;
  if (a.isolatedCount !== b.isolatedCount) return b.isolatedCount - a.isolatedCount;
  if (a.breakMeldCount !== b.breakMeldCount) return a.breakMeldCount - b.breakMeldCount;
  if (a.feedRiskScore !== b.feedRiskScore) return a.feedRiskScore - b.feedRiskScore;
  if (a.kongLoss !== b.kongLoss) return a.kongLoss - b.kongLoss;
  if (a.pairLoss !== b.pairLoss) return a.pairLoss - b.pairLoss;
  if (a.suit !== b.suit) return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
  return compareTripleTiles(a.tiles, b.tiles);
}

export function enumerateSwap3CandidatesBySuit(handCounts: ReadonlyArray<number>): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const seen = new Set<string>();
  for (const suit of SUITS) {
    const base = suit === 'm' ? 0 : suit === 'p' ? 9 : 18;
    const tiles: Array<number> = [];
    for (let i = 0; i < 9; i++) {
      const tileKey = base + i;
      const count = handCounts[tileKey] ?? 0;
      for (let n = 0; n < count; n++) tiles.push(tileKey);
    }
    if (tiles.length < 3) continue;
    for (let i = 0; i < tiles.length - 2; i++) {
      for (let j = i + 1; j < tiles.length - 1; j++) {
        for (let k = j + 1; k < tiles.length; k++) {
          const triple: [number, number, number] = [tiles[i]!, tiles[j]!, tiles[k]!];
          const key = triple.join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(triple);
        }
      }
    }
  }
  out.sort(compareTripleTiles);
  return out;
}

export function recommendSwap3ByStructure(params: {
  handCounts: ReadonlyArray<number>;
  candidates?: ReadonlyArray<Readonly<[number, number, number]>>;
}): Swap3StructureRecommendation {
  const rawCandidates = params.candidates ?? enumerateSwap3CandidatesBySuit(params.handCounts);
  const before = scoreHandStructure(params.handCounts);
  const candidates: Array<Swap3StructureCandidate> = rawCandidates.map((cand, index) => {
    const tiles: [number, number, number] = [cand[0]!, cand[1]!, cand[2]!];
    const afterCounts = params.handCounts.slice();
    afterCounts[tiles[0]] = (afterCounts[tiles[0]] ?? 0) - 1;
    afterCounts[tiles[1]] = (afterCounts[tiles[1]] ?? 0) - 1;
    afterCounts[tiles[2]] = (afterCounts[tiles[2]] ?? 0) - 1;
    const after = scoreHandStructure(afterCounts);
    const feedRisk = scoreFeedRisk(buildCountsWithTiles(tiles));
    return {
      index,
      tiles,
      suit: suitOf(tiles[0]),
      before,
      after,
      structureLoss: before.score - after.score,
      isolatedCount: countIsolatedTilesInSelection(params.handCounts, tiles),
      breakMeldCount: Math.max(0, before.meldCount - after.meldCount),
      feedRiskScore: feedRisk.score,
      feedRiskTier: feedRiskTierOf(feedRisk),
      kongLoss: computeKongLoss(params.handCounts, afterCounts, tiles),
      pairLoss: computePairLoss(params.handCounts, afterCounts, tiles),
    };
  });
  const candidatesBySuit = new Map<BloodSuit, Array<Swap3StructureCandidate>>();
  for (const candidate of candidates) {
    const arr = candidatesBySuit.get(candidate.suit) ?? [];
    arr.push(candidate);
    candidatesBySuit.set(candidate.suit, arr);
  }

  const suitKeepScores: Partial<Record<BloodSuit, number>> = {};
  const suitChoices: Array<{ suit: BloodSuit; keepScore: number; ranked: Array<Swap3StructureCandidate> }> = [];
  for (const suit of SUITS) {
    const suitCandidates = candidatesBySuit.get(suit) ?? [];
    if (suitCandidates.length === 0) continue;
    const keep = evaluateSuitKeepBreakdown(params.handCounts, suit);
    suitKeepScores[suit] = keep.score;
    suitChoices.push({ suit, keepScore: keep.score, ranked: suitCandidates.slice().sort(compareSwap3Candidate) });
  }

  suitChoices.sort((a, b) => {
    if (a.keepScore !== b.keepScore) return a.keepScore - b.keepScore;
    const bestA = a.ranked[0] ?? null;
    const bestB = b.ranked[0] ?? null;
    if (bestA && bestB) {
      const diff = compareSwap3Candidate(bestA, bestB);
      if (diff !== 0) return diff;
    }
    return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
  });

  const selectedSuit = suitChoices[0]?.suit ?? null;
  const ranked = selectedSuit ? (candidatesBySuit.get(selectedSuit) ?? []).slice().sort(compareSwap3Candidate) : [];
  return {
    bestIndex: ranked[0]?.index ?? -1,
    candidates,
    ranked,
    selectedSuit,
    suitKeepScores,
  };
}

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function hashCounts(counts: ReadonlyArray<number>, extra: number): number {
  let h = 2166136261 ^ extra;
  for (let i = 0; i < counts.length; i++) {
    h ^= (counts[i] ?? 0) + (i * 131);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function sampleOneTileKeyOfSuit(rem: ReadonlyArray<number>, suit: BloodSuit, rng: () => number): number | null {
  const base = suit === 'm' ? 0 : suit === 'p' ? 9 : 18;
  let total = 0;
  for (let i = 0; i < 9; i++) total += rem[base + i] ?? 0;
  if (total <= 0) return null;
  let r = Math.floor(rng() * total);
  for (let i = 0; i < 9; i++) {
    const k = base + i;
    const c = rem[k] ?? 0;
    if (c <= 0) continue;
    if (r < c) return k;
    r -= c;
  }
  return null;
}

function sampleTriple(remOrig: ReadonlyArray<number>, suit: BloodSuit, rng: () => number): [number, number, number] | null {
  const rem = remOrig.slice();
  const a = sampleOneTileKeyOfSuit(rem, suit, rng);
  if (a === null) return null;
  rem[a] = Math.max(0, (rem[a] ?? 0) - 1);
  const b = sampleOneTileKeyOfSuit(rem, suit, rng);
  if (b === null) return null;
  rem[b] = Math.max(0, (rem[b] ?? 0) - 1);
  const c = sampleOneTileKeyOfSuit(rem, suit, rng);
  if (c === null) return null;
  return [a, b, c];
}

function dummyOpponents(params: { oppHandSizes: [number, number, number] }): Record<EvplusSeat, EvplusOpponent> {
  // swap3/dingque 阶段对手定缺未知：这里不做风险计算，只给一个合法占位。
  return {
    B: { handSize: params.oppHandSizes[0], dingque: 'm', hu: false },
    C: { handSize: params.oppHandSizes[1], dingque: 'm', hu: false },
    D: { handSize: params.oppHandSizes[2], dingque: 'm', hu: false },
  };
}

function evalChanceMetric(params: {
  handCounts: Array<number>;
  melds: ReadonlyArray<CalcMeld>;
  isDealerLike: boolean;
  U: number;
  wallRemaining: number;
  base: number;
  cap: number;
  oppHandSizes: [number, number, number];
  dingque: BloodSuit;
  memo: ReturnType<typeof createEvplusMemo>;
}): { shanten: number; improveCount: number } {
  const visibleCounts = new Array<number>(27).fill(0);
  const remCounts = remCountsFromKnown({ concealedCounts: params.handCounts, melds: params.melds, visibleCounts });
  const ctx: EvplusContext = {
    base: params.base,
    cap: params.cap,
    wallRemaining: params.wallRemaining,
    myDingque: params.dingque,
    opponents: dummyOpponents({ oppHandSizes: params.oppHandSizes }),
    oppDiscardsBeforeYourDraw: 3,
  };

  if (params.isDealerLike) {
    const best = bestDiscardFromHand({ handCounts: params.handCounts, melds: params.melds, U: params.U, remCounts, ctx, memo: params.memo });
    if (!best) {
      const s = shantenBlood({ counts13: params.handCounts.slice(), melds: params.melds, memo: params.memo.shanten });
      return { shanten: s, improveCount: 0 };
    }
    return { shanten: best.shantenAfter, improveCount: best.improveCount };
  }

  const st = evalStateValue({ counts13: params.handCounts, melds: params.melds, U: params.U, remCounts, ctx, memo: params.memo });
  return { shanten: st.shanten, improveCount: st.improveCount };
}

export function recommendSwap3ByOpportunity(params: {
  // 当前手牌（含 extra 时即 14-3*m；不含则 13-3*m），仅用于生成 remCountsOrig（不允许看别人暗手）
  handCounts: ReadonlyArray<number>;
  melds?: ReadonlyArray<CalcMeld>;
  candidates: ReadonlyArray<Readonly<[number, number, number]>>;
  // 交换后仍然由同一套“机会数”衡量（shanten → improveCount）
  wallRemaining: number;
  oppHandSizes: [number, number, number];
  base: number;
  cap?: number;
  // 是否“像 dealer 一样”会立刻面临弃牌（拥有 extra）
  isDealerLike: boolean;
  N?: number;
}): { bestIndex: number; scores: Array<number> } {
  const melds = params.melds ?? [];
  const cap = params.cap ?? 0;
  const N = Math.max(1, Math.min(256, Math.trunc(params.N ?? 32)));
  const wallRemaining = Math.max(0, Math.trunc(params.wallRemaining));
  const U = wallRemaining + params.oppHandSizes[0] + params.oppHandSizes[1] + params.oppHandSizes[2];
  const memo = createEvplusMemo();

  // 采样分布：只基于“当前已知”（手牌 + 可见 + 副露）。swap3/dingque 阶段这里认为 visible=0。
  const visibleCounts = new Array<number>(27).fill(0);
  const remCountsOrig = remCountsFromKnown({ concealedCounts: params.handCounts, melds, visibleCounts });

  const scores: Array<number> = [];

  for (let i = 0; i < params.candidates.length; i++) {
    const cand = params.candidates[i]!;
    const baseHand = params.handCounts.slice();
    baseHand[cand[0]] = (baseHand[cand[0]] ?? 0) - 1;
    baseHand[cand[1]] = (baseHand[cand[1]] ?? 0) - 1;
    baseHand[cand[2]] = (baseHand[cand[2]] ?? 0) - 1;

    const seed = hashCounts(baseHand, i + 17);
    const rng = makeRng(seed);

    let acc = 0;
    let used = 0;
    for (let n = 0; n < N; n++) {
      const suitIn = SUITS[Math.floor(rng() * 3)] ?? 'm';
      const triple = sampleTriple(remCountsOrig, suitIn, rng);
      if (!triple) continue;
      const handAfter = baseHand.slice();
      handAfter[triple[0]] = (handAfter[triple[0]] ?? 0) + 1;
      handAfter[triple[1]] = (handAfter[triple[1]] ?? 0) + 1;
      handAfter[triple[2]] = (handAfter[triple[2]] ?? 0) + 1;

      const dingque = recommendDingqueSimple(handAfter);
      const m = evalChanceMetric({
        handCounts: handAfter,
        melds,
        isDealerLike: params.isDealerLike,
        U,
        wallRemaining,
        base: params.base,
        cap,
        oppHandSizes: params.oppHandSizes,
        dingque,
        memo,
      });
      const score = -m.shanten * 100000 + m.improveCount;
      acc += score;
      used += 1;
    }
    scores.push(used > 0 ? acc / used : -1e18);
  }

  let bestIndex = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i]! > scores[bestIndex]!) bestIndex = i;
  }
  return { bestIndex, scores };
}
