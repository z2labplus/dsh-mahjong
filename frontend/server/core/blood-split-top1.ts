import type { HuCalcResult } from '../blood-calc-engine';
import { calcBloodHu } from '../blood-calc-engine';
import type { CalcMeld } from './blood-calc-notation';
import type { BloodSuit } from './blood-types';
import { rankOf, suitOf } from './blood-tiles';
import {
  SplitAnalyzer,
  computeDiscardHardSafety,
  computeSplitStage,
  type SplitOpponent,
  type SplitRoute,
  type SplitStage,
  type StateSummary,
} from './blood-split-engine';
import { countSuitTiles, evaluateSuitKeepScore, recommendSwap3ByStructure } from './evplus-swap3-dingque';

export type BloodPendingClaimLike = {
  kind: 'claim';
  id: number;
  trigger?: 'discard' | 'addKong';
  afterGang?: boolean;
  fromSeat: number;
  tileId: number;
  tileKey: number;
  options: Record<number, { hu: boolean; peng: boolean; gang: boolean }>;
};

export type SplitTop1Snapshot = {
  seat: number;
  myDingque: BloodSuit | null;
  melds: Array<CalcMeld>;
  hasExtraTile: boolean;
  canSelfTurnAct: boolean;
  handCounts14: Array<number>;
  publicCounts: Array<number>;
  remCounts: Array<number>;
  wallRemaining: number;
  unknownPoolSize: number;
  stage: SplitStage;
  opponents: Array<SplitOpponent>;
  aliveOpponents: number;
  base: number;
  cap: number;
  afterGangSeat: number | null;
};

export type Top1Scene = 'swap3' | 'dingque' | 'turn' | 'claim';

export type Top1Action =
  | { kind: 'swap3'; tiles: [number, number, number] }
  | { kind: 'dingque'; suit: BloodSuit }
  | { kind: 'turnHu' }
  | { kind: 'turnKong'; gangType: 'an' | 'add'; tileKey: number }
  | { kind: 'turnDiscard'; tileKey: number }
  | { kind: 'claim'; pendingId: number; action: 'hu' | 'gang' | 'peng' | 'pass' };

type SplitCandidate = {
  tileKey: number;
  countInHand: number;
  summary: StateSummary | null;
  safeScore: number;
  publicSeen: number;
  familiarCount: number;
  wallCount: number;
  sujiCount: number;
  rem: number;
  stageBinOrder: number;
};

type RankedCandidates = { kind: 'dingque' | 'normal'; route: SplitRoute; candidates: Array<SplitCandidate> };

type DiscardBranch = {
  tileKey: number;
  counts13: Array<number>;
  summary: StateSummary;
  route: SplitRoute;
  valueMin: number;
  valueMax: number;
};

type TurnDiscardEval = {
  bestTileKey: number | null;
  rangeMin: number;
  rangeMax: number;
  // For reuse by claim/peng evaluation.
  branches: Map<number, DiscardBranch>;
  ranked: RankedCandidates;
};

type TurnGangEval = {
  gangType: 'an' | 'add';
  tileKey: number;
  immediateGain: number;
  gainMin: number;
  gainMax: number;
  score: number;
};

type ClaimEval = {
  kind: 'gang' | 'peng' | 'pass';
  worstShanten: number;
  score: number;
  key: string;
};

type DingqueEvalState = {
  counts: Array<number>;
  publicCounts: Array<number>;
  remCounts: Array<number>;
  wallRemaining: number;
  unknownPoolSize: number;
  stage: SplitStage;
};

type DingqueSuitRolloutAccum = {
  suit: BloodSuit;
  clearCount: number;
  keepScore: number;
  initialState: DingqueEvalState;
  samples: number;
  rng: () => number;
  i: number;
  used: number;
  shantenSum: number;
  improveCountSum: number;
  improveKindsSum: number;
  postClearUnknownPoolSizeSum: number;
  postClearCanDraw: boolean;
  standardPick: StateSummary | null;
  sevenPick: StateSummary | null;
  standardCount: number;
  sevenCount: number;
};

type DingqueRolloutOutcome = { route: SplitRoute; summary: StateSummary; wallRemaining: number; unknownPoolSize: number };

const BLOOD_SUIT_ORDER: ReadonlyArray<BloodSuit> = ['m', 'p', 's'];

function tilesFromCounts(counts: ReadonlyArray<number>): Array<number> {
  const out: Array<number> = [];
  for (let k = 0; k < 27; k++) {
    const c = counts[k] ?? 0;
    for (let i = 0; i < c; i++) out.push(k);
  }
  return out;
}

function midpoint(min: number, max: number): number {
  return (min + max) / 2;
}

function estimateRangeScore(
  summary: StateSummary,
  analyzer: SplitAnalyzer | null,
  counts13: Array<number>,
  publicCounts?: ReadonlyArray<number>,
  remCounts?: ReadonlyArray<number>,
): number {
  if (!analyzer) return Number.NEGATIVE_INFINITY;
  if (summary.tenpai) return summary.tenpai.avgRonGain;
  const range = analyzer.avgRonRange(counts13, publicCounts, remCounts);
  if (!range) return Number.NEGATIVE_INFINITY;
  return (range.min + range.max) / 2;
}

function computePointBin(tileKey: number): '34567' | '28' | '19' {
  const r = rankOf(tileKey);
  if (r === 1 || r === 9) return '19';
  if (r === 2 || r === 8) return '28';
  return '34567';
}

function binOrder(stage: SplitStage, bin: '34567' | '28' | '19'): number {
  const early: Array<'34567' | '28' | '19'> = ['34567', '28', '19'];
  const mid: Array<'34567' | '28' | '19'> = ['28', '19', '34567'];
  const late: Array<'34567' | '28' | '19'> = ['19', '28', '34567'];
  const order = stage === 'early' ? early : stage === 'mid' ? mid : late;
  const idx = order.indexOf(bin);
  return idx === -1 ? 9 : idx;
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

function handCountsKey(counts: ReadonlyArray<number>): string {
  let out = '';
  for (let i = 0; i < counts.length; i++) out += String(counts[i] ?? 0);
  return out;
}

export class BloodSplitTop1Engine {
  routeMode: SplitRoute = 'standard';

  private hasDingqueTilesInCounts(counts: ReadonlyArray<number>, dingque: BloodSuit | null): boolean {
    if (!dingque) return false;
    for (let k = 0; k < 27; k++) {
      if ((counts[k] ?? 0) <= 0) continue;
      if (suitOf(k) === dingque) return true;
    }
    return false;
  }

  private hasDingqueTiles(snap: SplitTop1Snapshot): boolean {
    return this.hasDingqueTilesInCounts(snap.handCounts14, snap.myDingque);
  }

  private getActiveRouteForCounts(snap: SplitTop1Snapshot, counts: ReadonlyArray<number>): SplitRoute {
    if (this.hasDingqueTilesInCounts(counts, snap.myDingque)) return 'standard';
    if (this.routeMode === 'sevenPairs') return 'sevenPairs';
    return 'standard';
  }

  private getActiveRoute(snap: SplitTop1Snapshot | null): SplitRoute {
    if (!snap) return 'standard';
    return this.getActiveRouteForCounts(snap, snap.handCounts14);
  }

  private summaryU(summary: StateSummary): number {
    return summary.tenpai ? summary.tenpai.winCount : summary.improve ? summary.improve.improveCount : 0;
  }

  private summaryK(summary: StateSummary): number {
    return summary.tenpai ? summary.tenpai.winKinds : summary.improve ? summary.improve.improveKinds : 0;
  }

  private totalTileCount(counts: ReadonlyArray<number>): number {
    let total = 0;
    for (let k = 0; k < counts.length; k++) total += counts[k] ?? 0;
    return total;
  }

  private buildAnalyzersForState(params: {
    snap: SplitTop1Snapshot;
    melds: Array<CalcMeld>;
    publicCounts: Array<number>;
    remCounts: Array<number>;
    unknownPoolSize: number;
    stage: SplitStage;
    dingque: BloodSuit;
  }): { standard: SplitAnalyzer; sevenPairs: SplitAnalyzer } {
    const { snap, melds, publicCounts, remCounts, unknownPoolSize, stage, dingque } = params;
    return {
      standard: new SplitAnalyzer({
        route: 'standard',
        fixedMeldCount: melds.length,
        melds,
        dingque,
        base: snap.base,
        cap: snap.cap,
        aliveOpponents: snap.aliveOpponents,
        unknownPoolSize,
        stage,
        publicCounts,
        remCounts,
        opponents: snap.opponents,
      }),
      sevenPairs: new SplitAnalyzer({
        route: 'sevenPairs',
        fixedMeldCount: melds.length,
        melds,
        dingque,
        base: snap.base,
        cap: snap.cap,
        aliveOpponents: snap.aliveOpponents,
        unknownPoolSize,
        stage,
        publicCounts,
        remCounts,
        opponents: snap.opponents,
      }),
    };
  }

  private buildFrameSeed(values: ReadonlyArray<number>): number {
    let seed = 17;
    for (const raw of values) {
      const v = Number.isFinite(raw) ? Math.trunc(raw) : 0;
      seed = (seed * 131 + v + 1009) % 104729;
    }
    return seed;
  }

  private makeSampleRng(seed: number): () => number {
    let state = (seed >>> 0) || 1;
    return () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  private sampleTileFromRemCounts(remCounts: ReadonlyArray<number>, rng: () => number): number | null {
    let total = 0;
    for (let k = 0; k < 27; k++) total += remCounts[k] ?? 0;
    if (total <= 0) return null;
    let pick = Math.floor(rng() * total);
    for (let k = 0; k < 27; k++) {
      const count = remCounts[k] ?? 0;
      if (count <= 0) continue;
      if (pick < count) return k;
      pick -= count;
    }
    return null;
  }

  private advanceDingqueOpponentTurn(state: DingqueEvalState, rng: () => number): void {
    if (state.wallRemaining <= 0 || state.unknownPoolSize <= 0) return;
    const revealedTile = this.sampleTileFromRemCounts(state.remCounts, rng);
    if (revealedTile !== null) {
      if ((state.remCounts[revealedTile] ?? 0) > 0) state.remCounts[revealedTile] = (state.remCounts[revealedTile] ?? 0) - 1;
      state.publicCounts[revealedTile] = (state.publicCounts[revealedTile] ?? 0) + 1;
    }
    state.wallRemaining = Math.max(0, state.wallRemaining - 1);
    state.unknownPoolSize = Math.max(0, state.unknownPoolSize - 1);
    state.stage = computeSplitStage(state.wallRemaining);
  }

  private buildDingqueEvalSnap(snap: SplitTop1Snapshot, suit: BloodSuit, state: DingqueEvalState): SplitTop1Snapshot {
    return {
      ...snap,
      myDingque: suit,
      handCounts14: state.counts,
      publicCounts: state.publicCounts,
      remCounts: state.remCounts,
      wallRemaining: state.wallRemaining,
      unknownPoolSize: state.unknownPoolSize,
      stage: state.stage,
      hasExtraTile: this.totalTileCount(state.counts) > 13,
    };
  }

  private buildDingqueAnalyzers(snap: SplitTop1Snapshot, suit: BloodSuit, state: DingqueEvalState): { standard: SplitAnalyzer; sevenPairs: SplitAnalyzer } {
    const tempSnap = this.buildDingqueEvalSnap(snap, suit, state);
    return this.buildAnalyzersForState({
      snap: tempSnap,
      melds: snap.melds,
      publicCounts: state.publicCounts,
      remCounts: state.remCounts,
      unknownPoolSize: state.unknownPoolSize,
      stage: state.stage,
      dingque: suit,
    });
  }

  private pickBestAutoDiscardTile(
    snap: SplitTop1Snapshot,
    suit: BloodSuit,
    state: DingqueEvalState,
  ): number | null {
    const tempSnap = this.buildDingqueEvalSnap(snap, suit, state);
    const analyzers = this.buildDingqueAnalyzers(snap, suit, state);
    const options: Array<{
      tileKey: number;
      route: SplitRoute;
      summary: StateSummary;
      counts13: Array<number>;
      publicCounts: Array<number>;
      safeScore: number;
      familiarCount: number;
      wallCount: number;
      sujiCount: number;
    }> = [];

    for (let tileKey = 0; tileKey < 27; tileKey++) {
      if ((state.counts[tileKey] ?? 0) <= 0) continue;
      const counts13 = state.counts.slice();
      counts13[tileKey] = (counts13[tileKey] ?? 0) - 1;
      const publicCounts = state.publicCounts.slice();
      publicCounts[tileKey] = (publicCounts[tileKey] ?? 0) + 1;
      const route = this.getAutoRouteForClearedCandidate({ counts13, publicCounts, remCounts: state.remCounts, analyzers });
      const analyzer = route === 'sevenPairs' ? analyzers.sevenPairs : analyzers.standard;
      const summary = analyzer ? analyzer.summary(counts13, state.remCounts) : null;
      if (!summary) continue;
      options.push({
        tileKey,
        route,
        summary,
        counts13,
        publicCounts,
        safeScore: computeDiscardHardSafety({ discardTile: tileKey, opponents: tempSnap.opponents, stage: state.stage }).score,
        familiarCount: tempSnap.publicCounts[tileKey] ?? 0,
        wallCount: adjacentWallCount(tileKey, state.remCounts),
        sujiCount: sujiPublicCount(tileKey, tempSnap.publicCounts),
      });
    }

    options.sort((a, b) => {
      if (a.summary.shanten !== b.summary.shanten) return a.summary.shanten - b.summary.shanten;
      const aU = this.summaryU(a.summary);
      const bU = this.summaryU(b.summary);
      if (bU !== aU) return bU - aU;
      const aK = this.summaryK(a.summary);
      const bK = this.summaryK(b.summary);
      if (bK !== aK) return bK - aK;
      const aAnalyzer = a.route === 'sevenPairs' ? analyzers.sevenPairs : analyzers.standard;
      const bAnalyzer = b.route === 'sevenPairs' ? analyzers.sevenPairs : analyzers.standard;
      const aScore = estimateRangeScore(a.summary, aAnalyzer, a.counts13, a.publicCounts, state.remCounts);
      const bScore = estimateRangeScore(b.summary, bAnalyzer, b.counts13, b.publicCounts, state.remCounts);
      if (bScore !== aScore) return bScore - aScore;
      if (a.route === 'standard' && b.route === 'standard' && b.summary.windowScore !== a.summary.windowScore) {
        return b.summary.windowScore - a.summary.windowScore;
      }
      if (b.safeScore !== a.safeScore) return b.safeScore - a.safeScore;
      if (b.familiarCount !== a.familiarCount) return b.familiarCount - a.familiarCount;
      if (b.wallCount !== a.wallCount) return b.wallCount - a.wallCount;
      if (b.sujiCount !== a.sujiCount) return b.sujiCount - a.sujiCount;
      return a.tileKey - b.tileKey;
    });

    return options[0]?.tileKey ?? null;
  }

  private pickBestDingqueDiscardTile(
    snap: SplitTop1Snapshot,
    suit: BloodSuit,
    state: DingqueEvalState,
  ): number | null {
    const analyzers = this.buildDingqueAnalyzers(snap, suit, state);
    if (!this.hasDingqueTilesInCounts(state.counts, suit)) {
      return this.pickBestAutoDiscardTile(snap, suit, state);
    }
    const tempSnap = this.buildDingqueEvalSnap(snap, suit, state);
    const ranked = this.rankCandidates(tempSnap, analyzers);
    return ranked.candidates[0]?.tileKey ?? null;
  }

  private summarizeDingqueState(
    snap: SplitTop1Snapshot,
    suit: BloodSuit,
    state: DingqueEvalState,
  ): DingqueRolloutOutcome | null {
    if (this.totalTileCount(state.counts) !== 13) return null;
    const analyzers = this.buildDingqueAnalyzers(snap, suit, state);
    const route = this.hasDingqueTilesInCounts(state.counts, suit)
      ? 'standard'
      : this.getAutoRouteForClearedCandidate({ counts13: state.counts.slice(), publicCounts: state.publicCounts, remCounts: state.remCounts, analyzers });
    const analyzer = route === 'sevenPairs' ? analyzers.sevenPairs : analyzers.standard;
    const summary = analyzer ? analyzer.summary(state.counts.slice(), state.remCounts) : null;
    return summary ? { route, summary, wallRemaining: state.wallRemaining, unknownPoolSize: state.unknownPoolSize } : null;
  }

  private runDingqueRollout(
    snap: SplitTop1Snapshot,
    suit: BloodSuit,
    initialState: DingqueEvalState,
    rng: () => number,
  ): DingqueRolloutOutcome | null {
    const opponentTurnCount = snap.opponents.filter((o) => !o.hu).length;
    const state: DingqueEvalState = {
      counts: initialState.counts.slice(),
      publicCounts: initialState.publicCounts.slice(),
      remCounts: initialState.remCounts.slice(),
      wallRemaining: initialState.wallRemaining,
      unknownPoolSize: initialState.unknownPoolSize,
      stage: initialState.stage,
    };

    let guard = 0;
    while (guard < 64) {
      guard += 1;
      const total = this.totalTileCount(state.counts);
      if (total > 14 || total < 13) return null;

      if (total === 14) {
        const discardTile = this.pickBestDingqueDiscardTile(snap, suit, state);
        if (discardTile === null || (state.counts[discardTile] ?? 0) <= 0) return null;
        state.counts[discardTile] = (state.counts[discardTile] ?? 0) - 1;
        state.publicCounts[discardTile] = (state.publicCounts[discardTile] ?? 0) + 1;
        continue;
      }

      if (!this.hasDingqueTilesInCounts(state.counts, suit) || state.wallRemaining <= 0 || state.unknownPoolSize <= 0) {
        return this.summarizeDingqueState(snap, suit, state);
      }

      for (let i = 0; i < opponentTurnCount; i++) {
        this.advanceDingqueOpponentTurn(state, rng);
        if (state.wallRemaining <= 0 || state.unknownPoolSize <= 0) {
          return this.summarizeDingqueState(snap, suit, state);
        }
      }

      const drawTile = this.sampleTileFromRemCounts(state.remCounts, rng);
      if (drawTile === null) {
        return this.summarizeDingqueState(snap, suit, state);
      }
      state.counts[drawTile] = (state.counts[drawTile] ?? 0) + 1;
      if ((state.remCounts[drawTile] ?? 0) > 0) state.remCounts[drawTile] = (state.remCounts[drawTile] ?? 0) - 1;
      state.wallRemaining = Math.max(0, state.wallRemaining - 1);
      state.unknownPoolSize = Math.max(0, state.unknownPoolSize - 1);
      state.stage = computeSplitStage(state.wallRemaining);
    }

    return this.summarizeDingqueState(snap, suit, state);
  }

  private getAutoRouteForClearedCandidate(params: {
    counts13: Array<number>;
    publicCounts: ReadonlyArray<number>;
    remCounts: ReadonlyArray<number>;
    analyzers: { standard: SplitAnalyzer; sevenPairs: SplitAnalyzer };
  }): SplitRoute {
    const { counts13, publicCounts, remCounts, analyzers } = params;
    const standardAnalyzer = analyzers.standard;
    const sevenPairsAnalyzer = analyzers.sevenPairs;
    if (!sevenPairsAnalyzer.isAvailable()) return 'standard';

    const stdSummary = standardAnalyzer.summary(counts13, remCounts);
    const sevenSummary = sevenPairsAnalyzer.summary(counts13, remCounts);

    if (stdSummary.shanten !== sevenSummary.shanten) {
      return stdSummary.shanten < sevenSummary.shanten ? 'standard' : 'sevenPairs';
    }

    const stdU = this.summaryU(stdSummary);
    const sevenU = this.summaryU(sevenSummary);
    if (stdU !== sevenU) return stdU > sevenU ? 'standard' : 'sevenPairs';

    const stdK = this.summaryK(stdSummary);
    const sevenK = this.summaryK(sevenSummary);
    if (stdK !== sevenK) return stdK > sevenK ? 'standard' : 'sevenPairs';

    const stdScore = estimateRangeScore(stdSummary, standardAnalyzer, counts13, publicCounts, remCounts);
    const sevenScore = estimateRangeScore(sevenSummary, sevenPairsAnalyzer, counts13, publicCounts, remCounts);
    if (stdScore !== sevenScore) return stdScore > sevenScore ? 'standard' : 'sevenPairs';

    return 'standard';
  }

  private rankCandidates(snap: SplitTop1Snapshot, analyzers: { standard: SplitAnalyzer; sevenPairs: SplitAnalyzer }): RankedCandidates {
    const activeRoute = this.getActiveRoute(snap);
    const analyzer = activeRoute === 'sevenPairs' ? analyzers.sevenPairs : analyzers.standard;
    if (!analyzer) return { kind: 'normal', route: activeRoute, candidates: [] };

    const myDingque = snap.myDingque;
    const handCounts14 = snap.handCounts14;

    const dingqueTiles: Array<number> = [];
    for (let k = 0; k < 27; k++) {
      if ((handCounts14[k] ?? 0) <= 0) continue;
      if (suitOf(k) === myDingque) dingqueTiles.push(k);
    }

    const candidates: Array<SplitCandidate> = [];
    const pushCandidate = (tileKey: number): void => {
      const countInHand = handCounts14[tileKey] ?? 0;
      if (countInHand <= 0) return;
      const safeScore = computeDiscardHardSafety({ discardTile: tileKey, opponents: snap.opponents, stage: snap.stage }).score;
      const publicSeen = snap.publicCounts[tileKey] ?? 0;
      const familiarCount = publicSeen;
      const wallCount = adjacentWallCount(tileKey, snap.remCounts);
      const sujiCount = sujiPublicCount(tileKey, snap.publicCounts);
      const rem = snap.remCounts[tileKey] ?? 0;
      const stageBinOrder = binOrder(snap.stage, computePointBin(tileKey));
      candidates.push({ tileKey, countInHand, summary: null, safeScore, publicSeen, familiarCount, wallCount, sujiCount, rem, stageBinOrder });
    };

    if (dingqueTiles.length > 0) {
      for (const k of dingqueTiles) pushCandidate(k);

      const allOppDingque = snap.opponents.every((o) => o.hu || o.dingque === myDingque);
      const seenCandidates = candidates.filter((c) => c.publicSeen > 0);
      const filtered = allOppDingque ? candidates : seenCandidates.length > 0 ? seenCandidates : candidates;

      const hasAnySeen = filtered.some((c) => c.publicSeen > 0);
      filtered.sort((a, b) => {
        if (hasAnySeen) {
          if (b.publicSeen !== a.publicSeen) return b.publicSeen - a.publicSeen;
          if (a.rem !== b.rem) return a.rem - b.rem;
          if (a.stageBinOrder !== b.stageBinOrder) return a.stageBinOrder - b.stageBinOrder;
          if (b.safeScore !== a.safeScore) return b.safeScore - a.safeScore;
          if (b.wallCount !== a.wallCount) return b.wallCount - a.wallCount;
          if (b.sujiCount !== a.sujiCount) return b.sujiCount - a.sujiCount;
          return a.tileKey - b.tileKey;
        }
        if (a.stageBinOrder !== b.stageBinOrder) return a.stageBinOrder - b.stageBinOrder;
        if (a.rem !== b.rem) return a.rem - b.rem;
        if (b.safeScore !== a.safeScore) return b.safeScore - a.safeScore;
        if (b.familiarCount !== a.familiarCount) return b.familiarCount - a.familiarCount;
        if (b.wallCount !== a.wallCount) return b.wallCount - a.wallCount;
        if (b.sujiCount !== a.sujiCount) return b.sujiCount - a.sujiCount;
        return a.tileKey - b.tileKey;
      });

      return { kind: 'dingque', route: activeRoute, candidates: filtered };
    }

    for (let k = 0; k < 27; k++) {
      if ((handCounts14[k] ?? 0) <= 0) continue;
      pushCandidate(k);
    }

    for (const c of candidates) {
      const counts13 = handCounts14.slice();
      counts13[c.tileKey] = (counts13[c.tileKey] ?? 0) - 1;
      c.summary = analyzer.summary(counts13);
    }

    candidates.sort((a, b) => {
      const sa = a.summary;
      const sb = b.summary;
      if (!sa || !sb) return a.tileKey - b.tileKey;
      if (sa.shanten !== sb.shanten) return sa.shanten - sb.shanten;

      if (sa.tenpai && sb.tenpai) {
        if (sb.tenpai.winCount !== sa.tenpai.winCount) return sb.tenpai.winCount - sa.tenpai.winCount;
        if (sb.tenpai.winKinds !== sa.tenpai.winKinds) return sb.tenpai.winKinds - sa.tenpai.winKinds;
        if (sb.tenpai.avgRonGain !== sa.tenpai.avgRonGain) return sb.tenpai.avgRonGain - sa.tenpai.avgRonGain;
      } else if (sa.improve && sb.improve) {
        if (sb.improve.improveCount !== sa.improve.improveCount) return sb.improve.improveCount - sa.improve.improveCount;
        if (sb.improve.improveKinds !== sa.improve.improveKinds) return sb.improve.improveKinds - sa.improve.improveKinds;
        const counts13a = handCounts14.slice();
        counts13a[a.tileKey] = (counts13a[a.tileKey] ?? 0) - 1;
        const publicCountsA = snap.publicCounts.slice();
        publicCountsA[a.tileKey] = (publicCountsA[a.tileKey] ?? 0) + 1;
        const counts13b = handCounts14.slice();
        counts13b[b.tileKey] = (counts13b[b.tileKey] ?? 0) - 1;
        const publicCountsB = snap.publicCounts.slice();
        publicCountsB[b.tileKey] = (publicCountsB[b.tileKey] ?? 0) + 1;
        const scoreA = estimateRangeScore(sa, analyzer, counts13a, publicCountsA, snap.remCounts);
        const scoreB = estimateRangeScore(sb, analyzer, counts13b, publicCountsB, snap.remCounts);
        if (scoreB !== scoreA) return scoreB - scoreA;
      }

      if (activeRoute === 'standard' && sb.windowScore !== sa.windowScore) return sb.windowScore - sa.windowScore;
      if (b.safeScore !== a.safeScore) return b.safeScore - a.safeScore;
      if (b.familiarCount !== a.familiarCount) return b.familiarCount - a.familiarCount;
      if (b.wallCount !== a.wallCount) return b.wallCount - a.wallCount;
      if (b.sujiCount !== a.sujiCount) return b.sujiCount - a.sujiCount;
      return a.tileKey - b.tileKey;
    });

    return { kind: 'normal', route: activeRoute, candidates };
  }

  private buildDiscardBranch(params: {
    snap: SplitTop1Snapshot;
    ranked: RankedCandidates;
    candidate: SplitCandidate;
    analyzers: { standard: SplitAnalyzer; sevenPairs: SplitAnalyzer };
  }): DiscardBranch | null {
    const { snap, ranked, candidate, analyzers } = params;
    const counts13 = snap.handCounts14.slice();
    counts13[candidate.tileKey] = (counts13[candidate.tileKey] ?? 0) - 1;
    const branchPublicCounts = snap.publicCounts.slice();
    branchPublicCounts[candidate.tileKey] = (branchPublicCounts[candidate.tileKey] ?? 0) + 1;
    const blocked = this.hasDingqueTilesInCounts(counts13, snap.myDingque);
    const route =
      blocked
        ? 'standard'
        : this.hasDingqueTiles(snap)
          ? this.getAutoRouteForClearedCandidate({
              counts13,
              publicCounts: branchPublicCounts,
              remCounts: snap.remCounts,
              analyzers,
            })
          : this.getActiveRouteForCounts(snap, counts13);
    const analyzer = route === 'sevenPairs' ? analyzers.sevenPairs : analyzers.standard;
    if (!analyzer) return null;

    const summary = analyzer.summary(counts13, snap.remCounts);
    let valueMin = 0;
    let valueMax = 0;
    if (!blocked) {
      if (summary.tenpai) {
        valueMin = Math.round(summary.tenpai.avgRonGain);
        valueMax = valueMin;
      } else if (summary.improve) {
        const range = analyzer.avgRonRange(counts13, branchPublicCounts, snap.remCounts);
        valueMin = range?.min ?? 0;
        valueMax = range?.max ?? 0;
      }
    }

    return { tileKey: candidate.tileKey, counts13, summary, route, valueMin, valueMax };
  }

  private buildDiscardEval(snap: SplitTop1Snapshot, analyzers: { standard: SplitAnalyzer; sevenPairs: SplitAnalyzer }): TurnDiscardEval {
    const ranked = this.rankCandidates(snap, analyzers);
    const branches = new Map<number, DiscardBranch>();
    const bestTileKey = ranked.candidates[0]?.tileKey ?? null;
    for (const candidate of ranked.candidates) {
      const branch = this.buildDiscardBranch({ snap, ranked, candidate, analyzers });
      if (!branch) continue;
      branches.set(candidate.tileKey, branch);
    }
    const bestBranch = bestTileKey !== null ? branches.get(bestTileKey) ?? null : null;
    const rangeMin = bestBranch?.valueMin ?? 0;
    const rangeMax = bestBranch?.valueMax ?? 0;
    return { bestTileKey, rangeMin, rangeMax, branches, ranked };
  }

  private currentHuEvents(snap: SplitTop1Snapshot): { gangShangKaiHua?: boolean; haiDi?: boolean } {
    const afterGang = (snap.afterGangSeat ?? null) === snap.seat;
    if (afterGang) return { gangShangKaiHua: true };
    if (snap.wallRemaining === 0) return { haiDi: true };
    return {};
  }

  private canSelfHu(snap: SplitTop1Snapshot): { ok: true; calc: HuCalcResult } | { ok: false } {
    if (!snap.canSelfTurnAct || !snap.hasExtraTile) return { ok: false };
    if (this.hasDingqueTilesInCounts(snap.handCounts14, snap.myDingque)) return { ok: false };
    const calc = calcBloodHu(
      { concealedTiles: tilesFromCounts(snap.handCounts14), melds: snap.melds },
      {
        base: snap.base,
        cap: snap.cap,
        huMethod: 'zimo',
        remainingOpponents: snap.aliveOpponents,
        events: this.currentHuEvents(snap),
      },
    );
    if (!calc.ok) return { ok: false };
    return { ok: true, calc };
  }

  private evaluateGangContinuation(params: {
    snap: SplitTop1Snapshot;
    nextMelds: Array<CalcMeld>;
    nextPublicCounts: Array<number>;
    nextCounts: Array<number>;
    drawTile: number;
  }): { gainMin: number; gainMax: number } {
    const { snap, nextMelds, nextPublicCounts, nextCounts, drawTile } = params;
    const remCounts = snap.remCounts.slice();
    remCounts[drawTile] = Math.max(0, (remCounts[drawTile] ?? 0) - 1);
    const wallRemaining = Math.max(0, snap.wallRemaining - 1);
    const unknownPoolSize = Math.max(0, snap.unknownPoolSize - 1);
    const stage = computeSplitStage(wallRemaining);
    const tempSnap: SplitTop1Snapshot = {
      ...snap,
      melds: nextMelds,
      handCounts14: nextCounts,
      publicCounts: nextPublicCounts,
      remCounts,
      wallRemaining,
      unknownPoolSize,
      stage,
      hasExtraTile: this.totalTileCount(nextCounts) > 13,
    };
    const analyzers = this.buildAnalyzersForState({
      snap: tempSnap,
      melds: nextMelds,
      publicCounts: nextPublicCounts,
      remCounts,
      unknownPoolSize,
      stage,
      dingque: snap.myDingque ?? 'm',
    });
    const discard = this.buildDiscardEval(tempSnap, analyzers);
    const bestBranch = discard.bestTileKey !== null ? discard.branches.get(discard.bestTileKey) ?? null : null;
    const gainMin = bestBranch?.valueMin ?? 0;
    const gainMax = bestBranch?.valueMax ?? 0;
    return { gainMin, gainMax };
  }

  private evaluateGang(params: { snap: SplitTop1Snapshot; gangType: 'an' | 'add'; tileKey: number }): TurnGangEval | null {
    const { snap, gangType, tileKey } = params;
    if (!snap.canSelfTurnAct || !snap.hasExtraTile) return null;
    if (snap.wallRemaining === 0) return null;

    let nextMelds: Array<CalcMeld> = [];
    const nextCountsBase = snap.handCounts14.slice();
    const nextPublicCounts = snap.publicCounts.slice();
    if (gangType === 'an') {
      if ((nextCountsBase[tileKey] ?? 0) < 4) return null;
      nextCountsBase[tileKey] = (nextCountsBase[tileKey] ?? 0) - 4;
      nextPublicCounts[tileKey] = (nextPublicCounts[tileKey] ?? 0) + 4;
      nextMelds = [...snap.melds, { kind: 'gang', tileKey, gangType: 'an' }];
    } else {
      if ((nextCountsBase[tileKey] ?? 0) <= 0) return null;
      let upgraded = false;
      nextMelds = snap.melds.map((meld) => {
        if (!upgraded && meld.kind === 'peng' && meld.tileKey === tileKey) {
          upgraded = true;
          return { kind: 'gang', tileKey, gangType: 'add' };
        }
        return meld;
      });
      if (!upgraded) return null;
      nextCountsBase[tileKey] = (nextCountsBase[tileKey] ?? 0) - 1;
      nextPublicCounts[tileKey] = (nextPublicCounts[tileKey] ?? 0) + 1;
    }

    const immediateGain = snap.base * (gangType === 'an' ? 2 : 1) * snap.aliveOpponents;
    let gainMin = Infinity;
    let gainMax = 0;

    for (let drawTile = 0; drawTile < 27; drawTile++) {
      const remain = snap.remCounts[drawTile] ?? 0;
      if (remain <= 0) continue;
      const nextCounts = nextCountsBase.slice();
      nextCounts[drawTile] = (nextCounts[drawTile] ?? 0) + 1;

      let gainRangeMin = 0;
      let gainRangeMax = 0;
      if (!this.hasDingqueTilesInCounts(nextCounts, snap.myDingque)) {
        const calc = calcBloodHu(
          { concealedTiles: tilesFromCounts(nextCounts), melds: nextMelds },
          {
            base: snap.base,
            cap: snap.cap,
            huMethod: 'zimo',
            remainingOpponents: snap.aliveOpponents,
            events: { gangShangKaiHua: true },
          },
        );
        if (calc.ok) {
          const gain = Math.trunc(calc.winnerGain);
          gainRangeMin = gain;
          gainRangeMax = gain;
        } else {
          const follow = this.evaluateGangContinuation({ snap, nextMelds, nextPublicCounts, nextCounts, drawTile });
          gainRangeMin = follow.gainMin;
          gainRangeMax = follow.gainMax;
        }
      } else {
        const follow = this.evaluateGangContinuation({ snap, nextMelds, nextPublicCounts, nextCounts, drawTile });
        gainRangeMin = follow.gainMin;
        gainRangeMax = follow.gainMax;
      }
      if (gainRangeMin < gainMin) gainMin = gainRangeMin;
      if (gainRangeMax > gainMax) gainMax = gainRangeMax;
    }

    if (!Number.isFinite(gainMin)) gainMin = 0;
    const totalMin = immediateGain + gainMin;
    const totalMax = immediateGain + gainMax;
    return { gangType, tileKey, immediateGain, gainMin: totalMin, gainMax: totalMax, score: midpoint(totalMin, totalMax) };
  }

  private pickTop1TurnInternal(snap: SplitTop1Snapshot): Top1Action | null {
    const hu = this.canSelfHu(snap);
    if (hu.ok) return { kind: 'turnHu' };

    const analyzers = this.buildAnalyzersForState({
      snap,
      melds: snap.melds,
      publicCounts: snap.publicCounts,
      remCounts: snap.remCounts,
      unknownPoolSize: snap.unknownPoolSize,
      stage: snap.stage,
      dingque: snap.myDingque ?? 'm',
    });
    const discard = this.buildDiscardEval(snap, analyzers);
    const discardScore = midpoint(discard.rangeMin, discard.rangeMax);

    const gangs: Array<TurnGangEval> = [];
    for (let tileKey = 0; tileKey < 27; tileKey++) {
      if ((snap.handCounts14[tileKey] ?? 0) >= 4 && suitOf(tileKey) !== snap.myDingque) {
        const g = this.evaluateGang({ snap, gangType: 'an', tileKey });
        if (g) gangs.push(g);
      }
    }
    const seenAdd = new Set<number>();
    for (const meld of snap.melds) {
      if (meld.kind !== 'peng') continue;
      if (seenAdd.has(meld.tileKey)) continue;
      seenAdd.add(meld.tileKey);
      if (suitOf(meld.tileKey) === snap.myDingque) continue;
      if ((snap.handCounts14[meld.tileKey] ?? 0) <= 0) continue;
      const g = this.evaluateGang({ snap, gangType: 'add', tileKey: meld.tileKey });
      if (g) gangs.push(g);
    }

    // pickRecommendedAction 口径：score desc；同分：暗杠 > 加杠 > 弃牌；再按 key asc。
    let best: Top1Action = { kind: 'turnDiscard', tileKey: discard.bestTileKey ?? 0 };
    let bestScore = discardScore;
    const kindOrder = (a: Top1Action): number => {
      if (a.kind === 'turnKong') return a.gangType === 'an' ? 0 : 1;
      if (a.kind === 'turnDiscard') return 2;
      return 3;
    };
    const keyOf = (a: Top1Action): string => {
      if (a.kind === 'turnKong') return `gang:${a.gangType}:${a.tileKey}`;
      if (a.kind === 'turnDiscard') return 'discard';
      return a.kind;
    };
    const consider = (cand: Top1Action, score: number): void => {
      if (score > bestScore) {
        best = cand;
        bestScore = score;
        return;
      }
      if (score < bestScore) return;
      if (kindOrder(cand) !== kindOrder(best)) {
        if (kindOrder(cand) < kindOrder(best)) best = cand;
        return;
      }
      if (keyOf(cand).localeCompare(keyOf(best)) < 0) best = cand;
    };
    for (const g of gangs) {
      consider({ kind: 'turnKong', gangType: g.gangType, tileKey: g.tileKey }, g.score);
    }

    if (best.kind === 'turnDiscard') {
      const tk = discard.bestTileKey;
      if (tk === null) return null;
      return { kind: 'turnDiscard', tileKey: tk };
    }
    return best;
  }

  private summarizeCounts13(params: {
    snap: SplitTop1Snapshot;
    counts13: Array<number>;
    publicCounts: Array<number>;
  }): { route: SplitRoute; summary: StateSummary } | null {
    const { snap, counts13, publicCounts } = params;
    const analyzers = this.buildAnalyzersForState({
      snap,
      melds: snap.melds,
      publicCounts,
      remCounts: snap.remCounts,
      unknownPoolSize: snap.unknownPoolSize,
      stage: snap.stage,
      dingque: snap.myDingque ?? 'm',
    });
    const blockedByDingque = this.hasDingqueTilesInCounts(counts13, snap.myDingque);
    const route = blockedByDingque
      ? 'standard'
      : this.getAutoRouteForClearedCandidate({ counts13: counts13.slice(), publicCounts, remCounts: snap.remCounts, analyzers });
    const analyzer = route === 'sevenPairs' ? analyzers.sevenPairs : analyzers.standard;
    const summary = analyzer ? analyzer.summary(counts13.slice(), snap.remCounts) : null;
    return summary ? { route, summary } : null;
  }

  private evaluateClaimPass(params: {
    snap: SplitTop1Snapshot;
    pending: BloodPendingClaimLike;
  }): { worstShanten: number; score: number; key: string } {
    const { snap, pending } = params;
    const counts13 = snap.handCounts14.slice();
    const blockedByDingque = this.hasDingqueTilesInCounts(counts13, snap.myDingque);
    const analyzers = this.buildAnalyzersForState({
      snap,
      melds: snap.melds,
      publicCounts: snap.publicCounts,
      remCounts: snap.remCounts,
      unknownPoolSize: snap.unknownPoolSize,
      stage: snap.stage,
      dingque: snap.myDingque ?? 'm',
    });
    const route = blockedByDingque ? 'standard' : this.getActiveRouteForCounts(snap, counts13);
    const analyzer = route === 'sevenPairs' ? analyzers.sevenPairs : analyzers.standard;
    const summary = analyzer ? analyzer.summary(counts13, snap.remCounts) : null;
    let valueMin = 0;
    let valueMax = 0;
    const canContinue = snap.wallRemaining > 0;
    if (canContinue && !blockedByDingque && analyzer && summary) {
      if (summary.tenpai) {
        valueMin = Math.round(summary.tenpai.avgRonGain);
        valueMax = valueMin;
      } else if (summary.improve) {
        const range = analyzer.avgRonRange(counts13, snap.publicCounts, snap.remCounts);
        valueMin = range?.min ?? 0;
        valueMax = range?.max ?? 0;
      }
    }
    const worstShanten = canContinue ? summary?.shanten ?? Infinity : Infinity;
    const score = midpoint(valueMin, valueMax);
    return { worstShanten, score, key: `claim:${pending.id}:pass` };
  }

  private evaluateClaimPeng(params: {
    snap: SplitTop1Snapshot;
    pending: BloodPendingClaimLike;
  }): { worstShanten: number; score: number; key: string } | null {
    const { snap, pending } = params;
    const tileKey = pending.tileKey;
    const take = snap.handCounts14[tileKey] ?? 0;
    if (take < 2) return null;
    if (suitOf(tileKey) === snap.myDingque) return null;

    const nextCounts14 = snap.handCounts14.slice();
    nextCounts14[tileKey] = Math.max(0, (nextCounts14[tileKey] ?? 0) - 2);
    const nextMelds: Array<CalcMeld> = [...snap.melds, { kind: 'peng', tileKey }];
    const nextPublicCounts = snap.publicCounts.slice();
    nextPublicCounts[tileKey] = (nextPublicCounts[tileKey] ?? 0) + 2;

    const tempSnap: SplitTop1Snapshot = { ...snap, melds: nextMelds, handCounts14: nextCounts14, publicCounts: nextPublicCounts };
    const analyzers = this.buildAnalyzersForState({
      snap: tempSnap,
      melds: nextMelds,
      publicCounts: nextPublicCounts,
      remCounts: snap.remCounts,
      unknownPoolSize: snap.unknownPoolSize,
      stage: snap.stage,
      dingque: snap.myDingque ?? 'm',
    });
    const discard = this.buildDiscardEval(tempSnap, analyzers);
    const best = discard.bestTileKey;
    const bestBranch = best !== null ? discard.branches.get(best) ?? null : null;
    const canContinue = snap.wallRemaining > 0;
    const rangeMin = canContinue ? bestBranch?.valueMin ?? 0 : 0;
    const rangeMax = canContinue ? bestBranch?.valueMax ?? 0 : 0;
    const worstShanten = canContinue ? bestBranch?.summary?.shanten ?? Infinity : Infinity;
    const score = midpoint(rangeMin, rangeMax);
    return { worstShanten, score, key: `claim:${pending.id}:peng:${tileKey}` };
  }

  private evaluateClaimGangContinuation(params: {
    snap: SplitTop1Snapshot;
    nextMelds: Array<CalcMeld>;
    nextPublicCounts: Array<number>;
    nextCounts14: Array<number>;
    drawTile: number;
  }): { gainMin: number; gainMax: number; shanten: number } {
    const { snap, nextMelds, nextPublicCounts, nextCounts14, drawTile } = params;
    const remCounts = snap.remCounts.slice();
    remCounts[drawTile] = Math.max(0, (remCounts[drawTile] ?? 0) - 1);
    const wallRemaining = Math.max(0, snap.wallRemaining - 1);
    const unknownPoolSize = Math.max(0, snap.unknownPoolSize - 1);
    const stage = computeSplitStage(wallRemaining);
    const tempSnap: SplitTop1Snapshot = {
      ...snap,
      melds: nextMelds,
      handCounts14: nextCounts14,
      publicCounts: nextPublicCounts,
      remCounts,
      wallRemaining,
      unknownPoolSize,
      stage,
      hasExtraTile: this.totalTileCount(nextCounts14) > 13,
    };
    const analyzers = this.buildAnalyzersForState({
      snap: tempSnap,
      melds: nextMelds,
      publicCounts: nextPublicCounts,
      remCounts,
      unknownPoolSize,
      stage,
      dingque: snap.myDingque ?? 'm',
    });
    const discard = this.buildDiscardEval(tempSnap, analyzers);
    const bestTileKey = discard.bestTileKey;
    const bestBranch = bestTileKey !== null ? discard.branches.get(bestTileKey) ?? null : null;
    const canContinue = wallRemaining > 0;
    const gainMin = canContinue ? bestBranch?.valueMin ?? 0 : 0;
    const gainMax = canContinue ? bestBranch?.valueMax ?? 0 : 0;
    const shanten = bestBranch?.summary?.shanten ?? Infinity;
    return { gainMin, gainMax, shanten };
  }

  private evaluateClaimMingGang(params: {
    snap: SplitTop1Snapshot;
    pending: BloodPendingClaimLike;
  }): { worstShanten: number; score: number; key: string } | null {
    const { snap, pending } = params;
    if (snap.wallRemaining === 0) return null;
    const tileKey = pending.tileKey;
    const take = snap.handCounts14[tileKey] ?? 0;
    if (take < 3) return null;
    if (suitOf(tileKey) === snap.myDingque) return null;

    const nextCountsBase = snap.handCounts14.slice();
    nextCountsBase[tileKey] = Math.max(0, (nextCountsBase[tileKey] ?? 0) - 3);
    const nextMelds: Array<CalcMeld> = [...snap.melds, { kind: 'gang', tileKey, gangType: 'ming' }];
    const nextPublicCounts = snap.publicCounts.slice();
    nextPublicCounts[tileKey] = (nextPublicCounts[tileKey] ?? 0) + 3;

	    const immediateGain = snap.base * 2;
	    let gainMin = Infinity;
	    let gainMax = 0;
	    // Track the worst (max) shanten across possible补张 outcomes.
	    // Must start from -Infinity; otherwise it will never update.
	    let worstShanten = -Infinity;

    for (let drawTile = 0; drawTile < 27; drawTile++) {
      const remain = snap.remCounts[drawTile] ?? 0;
      if (remain <= 0) continue;
      const nextCounts14 = nextCountsBase.slice();
      nextCounts14[drawTile] = (nextCounts14[drawTile] ?? 0) + 1;
	      let gainRangeMin = 0;
	      let gainRangeMax = 0;
	      let shanten = Infinity;
	      if (!this.hasDingqueTilesInCounts(nextCounts14, snap.myDingque)) {
	        const calc = calcBloodHu(
	          { concealedTiles: tilesFromCounts(nextCounts14), melds: nextMelds },
	          {
	            base: snap.base,
	            cap: snap.cap,
	            huMethod: 'zimo',
	            remainingOpponents: snap.aliveOpponents,
	            // 自摸只允许自摸事件；点炮事件（杠上炮/抢杠胡）会被计分引擎判为矛盾输入。
	            events: { gangShangKaiHua: true },
	          },
	        );
        if (calc.ok) {
          const gain = Math.trunc(calc.winnerGain);
          gainRangeMin = gain;
          gainRangeMax = gain;
          shanten = 0;
        } else {
          const follow = this.evaluateClaimGangContinuation({ snap, nextMelds, nextPublicCounts, nextCounts14, drawTile });
          gainRangeMin = follow.gainMin;
          gainRangeMax = follow.gainMax;
          shanten = follow.shanten;
        }
      } else {
        const follow = this.evaluateClaimGangContinuation({ snap, nextMelds, nextPublicCounts, nextCounts14, drawTile });
        gainRangeMin = follow.gainMin;
        gainRangeMax = follow.gainMax;
        shanten = follow.shanten;
      }
      if (gainRangeMin < gainMin) gainMin = gainRangeMin;
      if (gainRangeMax > gainMax) gainMax = gainRangeMax;
      if (shanten > worstShanten) worstShanten = shanten;
    }

    if (!Number.isFinite(gainMin)) gainMin = 0;
    if (!Number.isFinite(worstShanten)) worstShanten = Infinity;
    const totalMin = immediateGain + gainMin;
    const totalMax = immediateGain + gainMax;
    const score = midpoint(totalMin, totalMax);
    return { worstShanten, score, key: `claim:${pending.id}:gang:${tileKey}` };
  }

  pickTop1Action(params: { scene: Top1Scene; snap: SplitTop1Snapshot; pending?: BloodPendingClaimLike | null }): Top1Action | null {
    const { scene, snap } = params;

    if (scene === 'swap3') {
      const reco = recommendSwap3ByStructure({ handCounts: snap.handCounts14 });
      const top = reco.ranked[0] ?? null;
      if (!top) return null;
      return { kind: 'swap3', tiles: top.tiles };
    }

    if (scene === 'dingque') {
      const suitCounts = countSuitTiles(snap.handCounts14);
      const accums: Array<DingqueSuitRolloutAccum> = [];
      for (const suit of BLOOD_SUIT_ORDER) {
        const clearCount = suitCounts[suit] ?? 0;
        const initialState: DingqueEvalState = {
          counts: snap.handCounts14.slice(),
          publicCounts: snap.publicCounts.slice(),
          remCounts: snap.remCounts.slice(),
          wallRemaining: snap.wallRemaining,
          unknownPoolSize: snap.unknownPoolSize,
          stage: snap.stage,
        };
        const initialTotal = this.totalTileCount(initialState.counts);
        const futureClearSteps = Math.max(0, clearCount - (initialTotal > 13 ? 1 : 0));
        const needsFutureDraws = futureClearSteps > 0;
        const samples = needsFutureDraws ? Math.min(64, Math.max(24, clearCount * 12)) : 1;
        const seed = this.buildFrameSeed([211, suit === 'm' ? 1 : suit === 'p' ? 2 : 3, clearCount, snap.wallRemaining, snap.unknownPoolSize, ...snap.handCounts14]);
        accums.push({
          suit,
          clearCount,
          keepScore: evaluateSuitKeepScore(snap.handCounts14, suit),
          initialState,
          samples,
          rng: this.makeSampleRng(seed),
          i: 0,
          used: 0,
          shantenSum: 0,
          improveCountSum: 0,
          improveKindsSum: 0,
          postClearUnknownPoolSizeSum: 0,
          postClearCanDraw: false,
          standardPick: null,
          sevenPick: null,
          standardCount: 0,
          sevenCount: 0,
        });
      }

      const actions: Array<{
        suit: BloodSuit;
        clearCount: number;
        keepScore: number;
        shanten: number;
        improveCount: number;
        improveKinds: number;
      }> = [];
      for (const accum of accums) {
        for (; accum.i < accum.samples; accum.i++) {
          const outcome = this.runDingqueRollout(snap, accum.suit, accum.initialState, accum.rng);
          if (!outcome) continue;
          accum.used += 1;
          accum.shantenSum += outcome.summary.shanten;
          accum.improveCountSum += this.summaryU(outcome.summary);
          accum.improveKindsSum += this.summaryK(outcome.summary);
          accum.postClearUnknownPoolSizeSum += outcome.unknownPoolSize;
          if (outcome.wallRemaining > 0) accum.postClearCanDraw = true;
          if (outcome.route === 'standard') {
            accum.standardCount += 1;
            if (!accum.standardPick) accum.standardPick = outcome.summary;
          } else {
            accum.sevenCount += 1;
            if (!accum.sevenPick) accum.sevenPick = outcome.summary;
          }
        }
        if (accum.used <= 0) continue;
        actions.push({
          suit: accum.suit,
          clearCount: accum.clearCount,
          keepScore: accum.keepScore,
          shanten: accum.shantenSum / accum.used,
          improveCount: accum.improveCountSum / accum.used,
          improveKinds: accum.improveKindsSum / accum.used,
        });
      }

      actions.sort((a, b) => {
        if (a.clearCount !== b.clearCount) return a.clearCount - b.clearCount;
        if (a.keepScore !== b.keepScore) return a.keepScore - b.keepScore;
        if (a.shanten !== b.shanten) return a.shanten - b.shanten;
        if (b.improveCount !== a.improveCount) return b.improveCount - a.improveCount;
        if (b.improveKinds !== a.improveKinds) return b.improveKinds - a.improveKinds;
        return BLOOD_SUIT_ORDER.indexOf(a.suit) - BLOOD_SUIT_ORDER.indexOf(b.suit);
      });

      const best = actions[0] ?? null;
      return best ? { kind: 'dingque', suit: best.suit } : null;
    }

    if (scene === 'turn') {
      return this.pickTop1TurnInternal(snap);
    }

    if (scene === 'claim') {
      const pending = params.pending ?? null;
      if (!pending || pending.kind !== 'claim') return null;
      const seat = snap.seat;
      const opt = pending.options?.[seat] ?? { hu: false, peng: false, gang: false };
      if (opt.hu) return { kind: 'claim', pendingId: pending.id, action: 'hu' };

      const evals: Array<ClaimEval> = [];
      if (opt.gang) {
        const g = this.evaluateClaimMingGang({ snap, pending });
        if (g) evals.push({ kind: 'gang', worstShanten: g.worstShanten, score: g.score, key: g.key });
      }
      if (opt.peng) {
        const p = this.evaluateClaimPeng({ snap, pending });
        if (p) evals.push({ kind: 'peng', worstShanten: p.worstShanten, score: p.score, key: p.key });
      }
      const pass = this.evaluateClaimPass({ snap, pending });
      evals.push({ kind: 'pass', worstShanten: pass.worstShanten, score: pass.score, key: pass.key });

      const kindOrder = (k: ClaimEval['kind']): number => {
        if (k === 'gang') return 0;
        if (k === 'peng') return 1;
        return 2;
      };
      evals.sort((a, b) => {
        if (a.worstShanten !== b.worstShanten) return a.worstShanten - b.worstShanten;
        if (b.score !== a.score) return b.score - a.score;
        if (kindOrder(a.kind) !== kindOrder(b.kind)) return kindOrder(a.kind) - kindOrder(b.kind);
        return a.key.localeCompare(b.key);
      });
      const best = evals[0] ?? null;
      if (!best) return null;
      const action = best.kind === 'gang' ? 'gang' : best.kind === 'peng' ? 'peng' : 'pass';
      return { kind: 'claim', pendingId: pending.id, action };
    }

    return null;
  }
}
