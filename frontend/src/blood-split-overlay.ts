import type { Client } from './client';
import type { AiPref, AiProfilePublic } from './ai-settings-api';
import { fetchAiSettings, resolveEffectiveAiModelLabel } from './ai-settings-api';
import { BLOOD_SUITS, type BloodPendingClaim, type BloodState, type BloodSuit } from './blood';
import { calcBloodHu, type FanApplied, type HuCalcResult } from './blood-calc-engine';
import type { CalcMeld } from './blood-calc-notation';
import type { World } from './world';
import { createHudLucideIcon, setHudLucideIcon } from './hud-lucide';
import { MAHJONG_TILE_URLS, type MahjongTileCode } from './mahjong-tile-urls';
import { rankOf, suitOf, tileCode, tileLabel } from './blood-tiles';
import { countSuitTiles, evaluateSuitKeepScore, recommendSwap3ByStructure, type Swap3StructureCandidate } from './evplus-swap3-dingque';
import {
  SplitAnalyzer,
  computeDiscardHardSafety,
  computeSplitStage,
  type KongRegressionSummary,
  type SplitRoute,
  type SplitStage,
  type SplitOpponent,
  type StateSummary,
} from './blood-split-engine';
import { BloodSplitTop1Engine, type BloodPendingClaimLike, type SplitTop1Snapshot } from './blood-split-top1';
import { findRecoGlossaryEntry, type RecoGlossaryEntry } from './reco-glossary';
import { requestRecoLlmJudge } from './reco-api';
import {
  candidateIdForAction,
  factId,
  type ExplainFact,
  type FactKey,
  type LlmCandidate,
  type LlmRecoInput,
  type RecoAction,
  type RecoStage,
  type RiskTagId,
} from '../server/reco/contract';
import type { RecoResolution } from '../server/reco/contract-validate';
import type { AiFollowupMode, AiHistoryItem, AiScene } from '../server/protocol';

type SplitSnapshot = {
  ok: boolean;
  reason?: string;
  seat: number;
  blood: BloodState;
  myDingque: BloodSuit | null;
  melds: Array<CalcMeld>;
  handTilesOrdered: Array<{ tileKey: number; isExtra: boolean }>;
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
};

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

type SplitActionKind = 'hu' | 'gang' | 'discard';

type SplitGangDrawOutcome = {
  kind: 'kaihua' | 'continue';
  tileKey: number;
  remain: number;
  gain: number;
  gainMin: number;
  gainMax: number;
  multiplier: number;
  discardTileKey: number | null;
};

type SplitDiscardBranch = {
  tileKey: number;
  counts13: Array<number>;
  summary: StateSummary;
  route: SplitRoute;
  valueMin: number;
  valueMax: number;
  score: number;
};

type SplitAnalyzerSet = Partial<Record<SplitRoute, SplitAnalyzer | null>>;

type SplitTurnAction =
  | {
      kind: 'hu';
      key: string;
      label: string;
      displayValue: string;
      score: number;
      gain: number;
      calc: HuCalcResult;
    }
  | {
      kind: 'gang';
      key: string;
      label: string;
      displayValue: string;
      score: number;
      gangType: 'an' | 'add';
      tileKey: number;
      immediateGain: number;
      gainMin: number;
      gainMax: number;
      outcomes: Array<SplitGangDrawOutcome>;
      zeroRemain: number;
    }
  | {
      kind: 'discard';
      key: string;
      label: string;
      displayValue: string;
      score: number;
      rangeMin: number;
      rangeMax: number;
      ranked: RankedCandidates;
      branches: Map<number, SplitDiscardBranch>;
      bestTileKey: number | null;
    };

type SplitClaimGangDrawOutcome = {
  kind: 'kaihua' | 'continue';
  tileKey: number;
  remain: number;
  gain: number;
  gainMin: number;
  gainMax: number;
  multiplier: number;
  discardTileKey: number | null;
  // 向听口径：按“补张后 -> 推荐弃牌分支”弃掉一张后的向听；杠开花无该值。
  shanten: number | null;
};

type SplitClaimShantenBucket = { shanten: number; kindCount: number; tileCount: number };

type SplitClaimAction =
  | {
      kind: 'claimHu';
      key: string;
      label: string;
      displayValue: string;
      score: number;
      gain: number;
      calc: HuCalcResult;
    }
  | {
      kind: 'claimMingGang';
      key: string;
      label: string;
      displayValue: string;
      score: number;
      tileKey: number;
      immediateGain: number;
      gainMin: number;
      gainMax: number;
      outcomes: Array<SplitClaimGangDrawOutcome>;
      zeroRemain: number;
      worstShanten: number;
      kaihuaKindCount: number;
      kaihuaTileCount: number;
      shantenBuckets: Array<SplitClaimShantenBucket>;
    }
  | {
      kind: 'claimPeng';
      key: string;
      label: string;
      displayValue: string;
      score: number;
      tileKey: number;
      rangeMin: number;
      rangeMax: number;
      worstShanten: number;
      bestDiscardTileKey: number | null;
      bestRoute: SplitRoute;
      bestSummary: StateSummary | null;
      blockedByDingque: boolean;
      publicCountsAfter: Array<number>;
    }
  | {
      kind: 'claimPass';
      key: string;
      label: string;
      displayValue: string;
      score: number;
      rangeMin: number;
      rangeMax: number;
      worstShanten: number;
      route: SplitRoute;
      summary: StateSummary | null;
      blockedByDingque: boolean;
    };

type SplitAction = SplitTurnAction | SplitClaimAction;

type SplitSwap3Action = {
  kind: 'swap3';
  key: string;
  tiles: [number, number, number];
  structureLoss: number;
  isolatedCount: number;
  detail: Swap3StructureCandidate;
};

type SplitDingqueAction = {
  kind: 'dingque';
  key: string;
  suit: BloodSuit;
  clearCount: number;
  keepScore: number;
  shanten: number;
  improveCount: number;
  improveKinds: number;
  postClearUnknownPoolSize: number;
  postClearCanDraw: boolean;
  route: SplitRoute;
  summary: StateSummary;
};

type DingqueEvalState = {
  counts: Array<number>;
  publicCounts: Array<number>;
  remCounts: Array<number>;
  wallRemaining: number;
  unknownPoolSize: number;
  stage: SplitStage;
};

type SplitPanelMode = 'turn' | 'claim' | 'swap3' | 'dingque';

type RecoUiMapping = { actionKey: string; discardTileKey: number | null };

type AiHostedDecisionSource = 'engine' | 'llm';

type RecoJudgeSource = 'auto' | 'hosted' | 'manual';

type TurnDiscardHistory = {
  gameId: string;
  seat: number;
  updatedAt: number;
  snap: SplitSnapshot;
  discardAction: Extract<SplitTurnAction, { kind: 'discard' }>;
  analyzers: SplitAnalyzerSet;
  chosenDiscardTileKey: number | null;
  engineTop1DiscardTileKey: number | null;
  ctx: RecoUiContext | null;
  resolution: RecoResolution | null;
  chosenCandidateId: string | null;
};

type RecoUiContext = {
  decisionKey: string;
  stage: RecoStage;
  input: LlmRecoInput;
  confidenceEngine: number;
  engineTop1Locked: boolean;
  candidateUiMap: Map<string, RecoUiMapping>;
};

type RecoFollowupMessage = { role: 'user' | 'assistant'; text: string; at: number };

type RecoFollowupThread = {
  decisionKey: string;
  createdAt: number;
  updatedAt: number;
  label: string;
  messages: Array<RecoFollowupMessage>;
};

type RecoFollowupStoragePayload = { v: 2; gameId: string; threads: Array<RecoFollowupThread> };

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

type DingqueComputeJob = {
  token: number;
  snap: SplitSnapshot;
  handKey: string;
  accums: Array<DingqueSuitRolloutAccum>;
  accIndex: number;
};

function isBloodSuit(v: unknown): v is BloodSuit {
  return v === 'm' || v === 'p' || v === 's';
}

function computeHandViewportRatio(viewportRatio: number): number {
  if (viewportRatio >= 2.5) return 0.15;
  if (viewportRatio >= 2.0) return 0.17;
  if (viewportRatio >= 1.8) return 0.19;
  return 0.21;
}

const RECO_FOLLOWUP_STORAGE_PREFIX = 'mjlab.split.followup.v1:';
const AI_HOSTED_SETTINGS_STORAGE_KEY = 'mjlab.split.aihosted.v1';
const DEFAULT_AI_HOSTED_DELAY_MS = 5000;
const RECO_FOLLOWUP_MAX_TEXT = 1200;
const RECO_FOLLOWUP_PERSIST_TRIM_MAX_ITERS = 200;
const RECO_FOLLOWUP_PERSIST_TRIM_MAX_CUT = 20;
const RECO_FOLLOWUP_DEFAULT_CHIPS: Array<string> = [
  '为什么这步更稳？',
  '向听是什么意思？',
  '进张U(K种) 怎么算？',
  '安全分/熟/壁/筋 怎么算？',
  '预估得分是什么意思？',
  '窗口分W是什么意思？',
];

const AI_HOSTED_RECO_WAIT_MS = 8000;
const RECO_AUTO_JUDGE_TRIED_MAX_KEYS = 240;

function toMahjongTileCode(tileKey: number): MahjongTileCode {
  return tileCode(tileKey) as MahjongTileCode;
}

function tileImg(tileKey: number, className: string): HTMLImageElement {
  const code = toMahjongTileCode(tileKey);
  const img = document.createElement('img');
  img.className = className;
  img.src = MAHJONG_TILE_URLS[code];
  img.alt = tileLabel(tileKey);
  img.loading = 'lazy';
  img.decoding = 'async';
  return img;
}

const FOLLOWUP_INLINE_TILE_TOKEN_RE =
  /([1-9](?:[1-9]|[\/、,，\s]){0,20})([mps])|([1-9](?:[1-9]|[\/、,，\s]){0,20})([万筒条])子?|([一二三四五六七八九两](?:[一二三四五六七八九两]|[\/、,，\s]){0,20})([万筒条])子?/g;

function followupSuitFromHan(suit: string): BloodSuit | null {
  if (suit === '万') return 'm';
  if (suit === '筒') return 'p';
  if (suit === '条') return 's';
  return null;
}

function followupRankFromHanDigit(ch: string): number | null {
  if (ch === '一') return 1;
  if (ch === '二' || ch === '两') return 2;
  if (ch === '三') return 3;
  if (ch === '四') return 4;
  if (ch === '五') return 5;
  if (ch === '六') return 6;
  if (ch === '七') return 7;
  if (ch === '八') return 8;
  if (ch === '九') return 9;
  return null;
}

function followupIsRankSepChar(ch: string): boolean {
  if (ch === '/' || ch === '、' || ch === ',' || ch === '，') return true;
  return ch.trim() === '';
}

function followupParseRankSeqDigits(seq: string): Array<number> | null {
  const ranks: Array<number> = [];
  for (const ch of seq) {
    if (followupIsRankSepChar(ch)) continue;
    if (ch < '1' || ch > '9') return null;
    ranks.push(ch.charCodeAt(0) - 48);
    if (ranks.length > 12) return null;
  }
  return ranks.length > 0 ? ranks : null;
}

function followupParseRankSeqHan(seq: string): Array<number> | null {
  const ranks: Array<number> = [];
  for (const ch of seq) {
    if (followupIsRankSepChar(ch)) continue;
    const r = followupRankFromHanDigit(ch);
    if (!r) return null;
    ranks.push(r);
    if (ranks.length > 12) return null;
  }
  return ranks.length > 0 ? ranks : null;
}

function followupTileKeyFromRankSuit(rank: number, suit: BloodSuit): number | null {
  if (!Number.isFinite(rank) || rank < 1 || rank > 9) return null;
  const base = suit === 'm' ? 0 : suit === 'p' ? 9 : 18;
  return base + (rank - 1);
}

function followupTilesFromRankSeq(ranks: ReadonlyArray<number>, suit: BloodSuit): Array<number> | null {
  const out: Array<number> = [];
  for (const r of ranks) {
    const k = followupTileKeyFromRankSuit(r, suit);
    if (k === null) return null;
    out.push(k);
  }
  return out.length > 0 ? out : null;
}

function followupTilesFromTokenMatch(m: RegExpExecArray): Array<number> | null {
  const letterSeq = m[1] ?? '';
  const letterSuit = m[2] ?? '';
  const hanDigitSeq = m[3] ?? '';
  const hanSuit = m[4] ?? '';
  const hanSeq = m[5] ?? '';
  const hanSuit2 = m[6] ?? '';

  if (letterSeq && (letterSuit === 'm' || letterSuit === 'p' || letterSuit === 's')) {
    const ranks = followupParseRankSeqDigits(letterSeq);
    return ranks ? followupTilesFromRankSeq(ranks, letterSuit) : null;
  }
  if (hanDigitSeq && hanSuit) {
    const suit = followupSuitFromHan(hanSuit);
    const ranks = followupParseRankSeqDigits(hanDigitSeq);
    return suit && ranks ? followupTilesFromRankSeq(ranks, suit) : null;
  }
  if (hanSeq && hanSuit2) {
    const suit = followupSuitFromHan(hanSuit2);
    const ranks = followupParseRankSeqHan(hanSeq);
    return suit && ranks ? followupTilesFromRankSeq(ranks, suit) : null;
  }
  return null;
}

function renderFollowupRichText(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const s = String(text ?? '');
  if (!s) return frag;

  FOLLOWUP_INLINE_TILE_TOKEN_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null = null;
  while ((m = FOLLOWUP_INLINE_TILE_TOKEN_RE.exec(s)) !== null) {
    const start = m.index ?? 0;
    if (start > last) frag.appendChild(document.createTextNode(s.slice(last, start)));
    const tiles = followupTilesFromTokenMatch(m);
    if (tiles && tiles.length > 0) {
      const wrap = document.createElement('span');
      wrap.className = 'split-inline-tiles';
      for (const tileKey of tiles) wrap.appendChild(tileImg(tileKey, 'split-action-tile'));
      frag.appendChild(wrap);
    } else {
      frag.appendChild(document.createTextNode(m[0] ?? ''));
    }
    last = start + (m[0]?.length ?? 0);
  }
  if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
  return frag;
}

function tilesFromCounts(counts: ReadonlyArray<number>): Array<number> {
  const out: Array<number> = [];
  for (let k = 0; k < 27; k++) {
    const c = counts[k] ?? 0;
    for (let i = 0; i < c; i++) out.push(k);
  }
  return out;
}

function listSeatMelds(blood: BloodState, seat: number): Array<CalcMeld> {
  const ps = blood.players?.[seat] ?? null;
  const melds = Array.isArray(ps?.melds) ? ps.melds : [];
  const out: Array<CalcMeld> = [];
  for (const meld of melds as Array<any>) {
    const kind = meld?.kind;
    const tileKey = Number.isFinite(meld?.tileKey) ? Math.trunc(meld.tileKey) : null;
    if ((kind !== 'peng' && kind !== 'gang') || tileKey === null || tileKey < 0 || tileKey >= 27) continue;
    if (kind === 'gang') {
      const gt = meld?.gangType;
      if (gt === 'an' || gt === 'ming' || gt === 'add') {
        out.push({ kind: 'gang', tileKey, gangType: gt });
        continue;
      }
    }
    out.push({ kind, tileKey });
  }
  return out;
}

function countPublicMeldsFromBlood(blood: BloodState): Array<number> {
  const out = new Array<number>(27).fill(0);
  for (let seat = 0; seat < 4; seat++) {
    const melds = listSeatMelds(blood, seat);
    for (const meld of melds) {
      const add = meld.kind === 'gang' ? 4 : 3;
      out[meld.tileKey] = (out[meld.tileKey] ?? 0) + add;
    }
  }
  return out;
}

function isAlwaysPublicFaceSlot(slotName: string): boolean {
  return slotName.startsWith('discard.') || slotName.startsWith('hu.taken.');
}

function countPublicFacesFromSlots(client: Client, seat: number): Array<number> {
  const out = new Array<number>(27).fill(0);
  for (const [tileId, info] of client.things.entries()) {
    const slotName = typeof (info as any)?.slotName === 'string' ? String((info as any).slotName) : '';
    const tileKeyRaw = client.tileFacePublic.get(tileId) ?? null;
    const isOwnHand = slotName.startsWith('hand.') && slotName.endsWith(`@${seat}`);
    const isRevealedHand = slotName.startsWith('hand.') && !isOwnHand && tileKeyRaw !== null;
    if (!isAlwaysPublicFaceSlot(slotName) && !isRevealedHand) continue;
    const tileKey = typeof tileKeyRaw === 'number' && Number.isFinite(tileKeyRaw) ? Math.trunc(tileKeyRaw) : null;
    if (tileKey === null || tileKey < 0 || tileKey >= 27) continue;
    out[tileKey] = (out[tileKey] ?? 0) + 1;
  }
  return out;
}

function countPublicHuDisplayFromBlood(blood: BloodState): Array<number> {
  const out = new Array<number>(27).fill(0);
  const revealAll = !!(blood.revealAllHands || blood.phase === 'settling' || blood.phase === 'done');
  if (revealAll) return out;
  for (let seat = 0; seat < 4; seat++) {
    const player = blood.players?.[seat] ?? null;
    const tileKey = Number.isFinite(player?.huTileKey) ? Math.trunc(player!.huTileKey as number) : null;
    if (!player?.hu || player.huSource !== 'self' || tileKey === null || tileKey < 0 || tileKey >= 27) continue;
    out[tileKey] = (out[tileKey] ?? 0) + 1;
  }
  return out;
}

function buildPublicCounts(client: Client, blood: BloodState, seat: number): Array<number> {
  const faceCounts = countPublicFacesFromSlots(client, seat);
  const meldCounts = countPublicMeldsFromBlood(blood);
  const huDisplayCounts = countPublicHuDisplayFromBlood(blood);
  const out = new Array<number>(27).fill(0);
  for (let k = 0; k < 27; k++) out[k] = (faceCounts[k] ?? 0) + (meldCounts[k] ?? 0) + (huDisplayCounts[k] ?? 0);
  return out;
}

function countOwnKnownHandFromSlots(client: Client, seat: number): Array<number> {
  const out = new Array<number>(27).fill(0);
  for (const [tileId, info] of client.things.entries()) {
    const slotName = typeof (info as any)?.slotName === 'string' ? String((info as any).slotName) : '';
    if (!slotName.startsWith('hand.') || !slotName.endsWith(`@${seat}`)) continue;
    const tileKeyRaw = client.tileFaceSelf.get(tileId) ?? client.tileFacePublic.get(tileId) ?? null;
    const tileKey = typeof tileKeyRaw === 'number' && Number.isFinite(tileKeyRaw) ? Math.trunc(tileKeyRaw) : null;
    if (tileKey === null || tileKey < 0 || tileKey >= 27) continue;
    out[tileKey] = (out[tileKey] ?? 0) + 1;
  }
  return out;
}

function countOwnHandSlotCount(client: Client, seat: number): number {
  let out = 0;
  for (const [, info] of client.things.entries()) {
    const slotName = typeof (info as any)?.slotName === 'string' ? String((info as any).slotName) : '';
    if (!slotName.startsWith('hand.') || !slotName.endsWith(`@${seat}`)) continue;
    out += 1;
  }
  return out;
}

function countUnknownOpponentHandTiles(client: Client, seat: number): number {
  let out = 0;
  for (const [tileId, info] of client.things.entries()) {
    const slotName = typeof (info as any)?.slotName === 'string' ? String((info as any).slotName) : '';
    if (!slotName.startsWith('hand.') || slotName.endsWith(`@${seat}`)) continue;
    if (client.tileFacePublic.get(tileId) !== undefined && client.tileFacePublic.get(tileId) !== null) continue;
    out += 1;
  }
  return out;
}

function listHandTilesOrdered(client: Client, seat: number, dingque: BloodSuit | null): Array<{ tileKey: number; isExtra: boolean }> {
  const items: Array<{ tileId: number; tileKey: number; isExtra: boolean }> = [];
  for (const [tileId, info] of client.things.entries()) {
    const slotName = typeof (info as any)?.slotName === 'string' ? String((info as any).slotName) : '';
    if (!slotName.startsWith('hand.') || !slotName.endsWith(`@${seat}`)) continue;
    const tileKeyRaw = client.tileFaceSelf.get(tileId) ?? client.tileFacePublic.get(tileId) ?? null;
    const tileKey = Number.isFinite(tileKeyRaw) ? Math.trunc(tileKeyRaw as number) : null;
    if (tileKey === null || tileKey < 0 || tileKey >= 27) continue;
    const isExtra = slotName.startsWith('hand.extra');
    items.push({ tileId, tileKey, isExtra });
  }
  items.sort((a, b) => {
    if (a.isExtra !== b.isExtra) return a.isExtra ? 1 : -1;
    if (dingque) {
      const aDef = suitOf(a.tileKey) === dingque;
      const bDef = suitOf(b.tileKey) === dingque;
      if (aDef !== bDef) return aDef ? 1 : -1;
    }
    if (a.tileKey !== b.tileKey) return a.tileKey - b.tileKey;
    return a.tileId - b.tileId;
  });
  return items.map((x) => ({ tileKey: x.tileKey, isExtra: x.isExtra }));
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

function formatApproxRatio(numer: number, denom: number, canDraw = true): string {
  const n = Number.isFinite(numer) ? Math.max(0, Math.trunc(numer)) : 0;
  if (!canDraw) return 'P≈0/--';
  const d = Number.isFinite(denom) ? Math.max(0, Math.trunc(denom)) : 0;
  if (d <= 0) return `P≈${n}/0=--`;
  const percent = Math.round((n / d) * 100);
  return `P≈${n}/${d}=${percent}%`;
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

function formatGainRange(min: number, max: number): string {
  const lo = Math.max(0, Math.round(min));
  const hi = Math.max(lo, Math.round(max));
  return lo === hi ? String(lo) : `${lo}-${hi}`;
}

function midpoint(min: number, max: number): number {
  return (min + max) / 2;
}

function hasDingqueTileInCounts(counts: ReadonlyArray<number>, dingque: BloodSuit | null): boolean {
  if (!dingque) return false;
  for (let k = 0; k < 27; k++) {
    if ((counts[k] ?? 0) <= 0) continue;
    if (suitOf(k) === dingque) return true;
  }
  return false;
}

function formatFansLine(fans: ReadonlyArray<FanApplied>): string {
  if (!Array.isArray(fans) || fans.length === 0) return '--';
  return fans.map((fan) => `${fan.name}×${fan.multiplier}`).join(' · ');
}

function handCountsKey(counts: ReadonlyArray<number>): string {
  let out = '';
  for (let i = 0; i < counts.length; i++) out += String(counts[i] ?? 0);
  return out;
}

function fnv1a32(text: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hash64Hex(text: string): string {
  const a = fnv1a32(text, 0x811c9dc5);
  const b = fnv1a32(text, 0x811c9dc5 ^ 0x9e3779b9);
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

function suitText(suit: BloodSuit): string {
  return suit === 'm' ? '万' : suit === 'p' ? '筒' : '条';
}

function relativeSeatText(viewerSeat: number, seat: number): string {
  const rel = ((seat - viewerSeat) % 4 + 4) % 4;
  if (rel === 1) return '下家';
  if (rel === 2) return '对家';
  if (rel === 3) return '上家';
  return '本家';
}

function buildSnapshot(client: Client, world: World): SplitSnapshot {
  const seat = world.seat;
  const blood = client.blood.get(0) as BloodState | null;
  if (seat === null || !blood) {
    return {
      ok: false,
      reason: '牌局未就绪',
      seat: 0,
      blood: blood as any,
      myDingque: 'm',
      melds: [],
      handTilesOrdered: [],
      hasExtraTile: false,
      canSelfTurnAct: false,
      handCounts14: [],
      publicCounts: [],
      remCounts: [],
      wallRemaining: 0,
      unknownPoolSize: 0,
      stage: 'early',
      opponents: [],
      aliveOpponents: 3,
      base: 400,
      cap: 0,
    };
  }
  const me = blood.players?.[seat] ?? null;
  const myDingque = (me?.dingque ?? null) || client.localDingqueSuit();
  const phaseAllowsMissingDingque = blood.phase === 'swap3' || blood.phase === 'dingque';
  if (!isBloodSuit(myDingque) && !phaseAllowsMissingDingque) {
    return {
      ok: false,
      reason: '还未定缺，当前不可拆牌',
      seat,
      blood,
      myDingque: null,
      melds: [],
      handTilesOrdered: [],
      hasExtraTile: false,
      canSelfTurnAct: false,
      handCounts14: [],
      publicCounts: [],
      remCounts: [],
      wallRemaining: 0,
      unknownPoolSize: 0,
      stage: 'early',
      opponents: [],
      aliveOpponents: 3,
      base: blood.base ?? 400,
      cap: 0,
    };
  }

  const melds = listSeatMelds(blood, seat);
  const resolvedDingque = isBloodSuit(myDingque) ? myDingque : null;
  const handTilesOrdered = listHandTilesOrdered(client, seat, resolvedDingque);
  const ownHandSlotCount = countOwnHandSlotCount(client, seat);
  const expectedMinTiles = phaseAllowsMissingDingque ? 13 : 0;
  const handIncomplete =
    (ownHandSlotCount > 0 && handTilesOrdered.length < ownHandSlotCount) ||
    (ownHandSlotCount === 0 && expectedMinTiles > 0 && handTilesOrdered.length < expectedMinTiles);
  if (handIncomplete) {
    return {
      ok: false,
      reason: '手牌同步中，稍后再试',
      seat,
      blood,
      myDingque: resolvedDingque,
      melds,
      handTilesOrdered: [],
      hasExtraTile: false,
      canSelfTurnAct: false,
      handCounts14: [],
      publicCounts: [],
      remCounts: [],
      wallRemaining: 0,
      unknownPoolSize: 0,
      stage: 'early',
      opponents: [],
      aliveOpponents: 3,
      base: blood.base ?? 400,
      cap: 0,
    };
  }
  const hasExtraTile = handTilesOrdered.some((it) => it.isExtra);
  const canSelfTurnAct =
    blood.phase === 'playing' &&
    blood.pending === null &&
    blood.turnSeat === seat &&
    blood.turnStep === 'discard';
  const handCounts14 = new Array<number>(27).fill(0);
  for (const it of handTilesOrdered) handCounts14[it.tileKey] = (handCounts14[it.tileKey] ?? 0) + 1;

  const publicCounts = buildPublicCounts(client, blood, seat);
  const ownKnownHandCounts = countOwnKnownHandFromSlots(client, seat);
  const remCounts = new Array<number>(27).fill(0);
  for (let k = 0; k < 27; k++) {
    const known = (publicCounts[k] ?? 0) + (ownKnownHandCounts[k] ?? 0);
    remCounts[k] = Math.max(0, 4 - known);
  }

  const wallIndex = Number.isFinite(blood.wallIndex) ? Math.trunc(blood.wallIndex) : 0;
  const fromOrder = Array.isArray(blood.wallOrder) ? blood.wallOrder.length - wallIndex : 0;
  let wallRemaining = fromOrder;
  if (wallRemaining <= 0) {
    let bySlots = 0;
    for (const [, info] of client.things.entries()) {
      const slotName = typeof (info as any)?.slotName === 'string' ? String((info as any).slotName) : '';
      if (slotName.startsWith('wall.')) bySlots += 1;
    }
    wallRemaining = bySlots;
  }
  wallRemaining = Math.max(0, wallRemaining);
  const unknownOpponentTiles = countUnknownOpponentHandTiles(client, seat);
  const unknownPoolSize = Math.max(0, wallRemaining + unknownOpponentTiles);
  const stage = computeSplitStage(wallRemaining);

  const opponents: Array<SplitOpponent> = [];
  for (let rel = 1; rel <= 3; rel++) {
    const s = (seat + rel) % 4;
    const ps = blood.players?.[s] ?? null;
    const dq = ps?.dingque;
    const dingque: BloodSuit | null = isBloodSuit(dq) ? dq : null;
    opponents.push({ dingque, hu: !!ps?.hu });
  }
  const aliveOpponents = opponents.filter((o) => !o.hu).length;

  return {
    ok: true,
    seat,
    blood,
    myDingque: resolvedDingque,
    melds,
    handTilesOrdered,
    hasExtraTile,
    canSelfTurnAct,
    handCounts14,
    publicCounts,
    remCounts,
    wallRemaining,
    unknownPoolSize,
    stage,
    opponents,
    aliveOpponents: Math.max(1, Math.min(3, aliveOpponents)),
    base: Number.isFinite(blood.base) ? Math.trunc(blood.base) : 400,
    cap: 0,
  };
}

export class BloodSplitOverlay {
  private client: Client;
  private world: World;
  private root: HTMLElement;
  private anchorBtn: HTMLButtonElement;
  private onClose: () => void;

  private open = false;
  // 当前展示的动作建议是否为“非可操作回合”的历史结果。
  private actionsHistorical = false;
  private expandedCandidates = new Set<number>();
  private helpOpen = false;
  private helpSideBySide = false;
  private glossaryOpenKey: string | null = null;
  private suitOpen: BloodSuit | null = null;
  private routeMode: SplitRoute = 'standard';
  private top1Engine = new BloodSplitTop1Engine();

  private recoCtx: RecoUiContext | null = null;
  private recoCtxGameId: string | null = null;
  private recoCtxLast: RecoUiContext | null = null;
  private recoCtxLastGameId: string | null = null;
  private recoResolution: RecoResolution | null = null;
  private recoResolutionLast: RecoResolution | null = null;
  private recoLoading = false;
  private recoInFlightSource: RecoJudgeSource | null = null;
  private recoError: string | null = null;
  private recoReqSeq = 0;
  private recoCache = new Map<string, RecoResolution>();
  private recoModelCache = new Map<string, string>();
  private recoEvidenceOpen = false;
  private recoEvidenceDecisionKey: string | null = null;
  private recoAiEnabled = false;
  private recoAutoJudgeEnabled = false;
  private recoAutoJudgeTried = new Map<string, number>();
  private recoFollowupOpen = false;
  private recoFollowupDecisionKey: string | null = null;
  private recoFollowupGameId: string | null = null;
  private recoFollowupThreads = new Map<string, RecoFollowupThread>();
  private recoFollowupReqSeq = 0;
  private recoFollowupInflight: { clientRequestId: string; decisionKey: string; mode: AiFollowupMode } | null = null;
  private recoFollowupStrictFallback:
    | { gameId: string; decisionKey: string; scene: AiScene; snapshotId: string; prompt: string; question: string }
    | null = null;
  private recoFollowupError: string | null = null;
  private recoFollowupNotice: string | null = null;
  private recoFollowupContextNotice: string | null = null;
  private recoFollowupMessages: Array<RecoFollowupMessage> = [];
  private recoFollowupStreaming: { clientRequestId: string; decisionKey: string; text: string } | null = null;
  private recoFollowupScrollPending = false;
  private recoFollowupFocusPending = false;
  private recoFollowupAfterRenderScheduled = false;
  private recoFollowupPinned = true;
  private recoFollowupRestoreScrollTop: number | null = null;
  private recoFollowupSuppressScroll = false;
  private recoFollowupDomGameId: string | null = null;
  private recoFollowupDomThreadOrder: Array<string> = [];
  private recoFollowupDomThreads = new Map<
    string,
    { root: HTMLDivElement; divider: HTMLDivElement; msgsEl: HTMLDivElement; renderedLen: number; label: string }
  >();
  private recoFollowupDomTipEl: HTMLDivElement | null = null;
  private recoFollowupDomNoticeEl: HTMLDivElement | null = null;
  private recoFollowupDomStatusEl: HTMLDivElement | null = null;
  private recoFollowupDomStreamingEl: HTMLDivElement | null = null;
  private recoFollowupDomStreamingDecisionKey: string | null = null;

  private aiHostedEnabled = false;
  private aiHostedDecisionSource: AiHostedDecisionSource = 'engine';
  private aiHostedActDelayMs = DEFAULT_AI_HOSTED_DELAY_MS;
  private aiHostedSettingsDraft: { source: AiHostedDecisionSource; delayMs: number } | null = null;
  private aiHostedLastActedDecisionKey: string | null = null;
  private aiHostedPendingActionIds: Set<string> = new Set();
  private aiHostedWait: { decisionKey: string; startedAt: number } | null = null;
  private aiHostedPlannedAct:
    | {
        decisionKey: string;
        stage: RecoStage;
        chosenCandidateId: string;
        snapshotKey: string;
        plannedAt: number;
        dueAt: number;
      }
    | null = null;
  private aiHostedPlannedTimer: number | null = null;
  private aiHostedNotice: { decisionKey: string; text: string; at: number } | null = null;
  private aiHostedExitReason: string | null = null;
  private aiHostedTickTimer: number | null = null;
  private aiSettingsReqSeq = 0;
  private aiSettingsLoadedGameId: string | null = null;
  private aiSettingsDataGameId: string | null = null;
  private aiSettingsInFlight: { gameId: string; seq: number } | null = null;
  private aiSettingsError: string | null = null;
  private aiSettingsRetryAt = 0;
  private aiSettingsRetryDelayMs = 0;
  private aiSettingsRetryTimer: number | null = null;
  private aiSettingsRetryTimerAt = 0;
  private aiEffectivePref: AiPref = { source: 'official', profileId: null };
  private aiProfiles: Array<AiProfilePublic> = [];
  private aiOfficialModel = '';

  private backdrop: HTMLDivElement;
  private panel: HTMLDivElement;
  private helpPanel: HTMLDivElement;
  private glossaryBackdrop: HTMLDivElement;
  private glossaryDrawer: HTMLDivElement;
  private glossaryTitleEl: HTMLDivElement;
  private glossaryBodyEl: HTMLDivElement;
  private hostedSettingsBackdrop: HTMLDivElement;
  private hostedSettingsDrawer: HTMLDivElement;
  private hostedSettingsTitleEl: HTMLDivElement;
  private hostedSettingsBodyEl: HTMLDivElement;
  private subbar: HTMLDivElement;
  private actionBar: HTMLDivElement;
  private subbarSide: HTMLDivElement;
  private routeBar: HTMLDivElement;
  private routeButtons: Partial<Record<SplitRoute, HTMLButtonElement>> = {};
  private suitBar: HTMLDivElement;
  private suitPanel: HTMLDivElement;
  private suitButtons: Partial<Record<BloodSuit, HTMLButtonElement>> = {};
  private floatingHandEl: HTMLDivElement;
  private floatingHandTilesEl: HTMLSpanElement;
  private floatingHandSource: { handRow: HTMLElement; tilesWrap: HTMLElement } | null = null;
  private floatingHandObserver: IntersectionObserver | null = null;
  private floatingHandScrollFallback: (() => void) | null = null;
  private topbar: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private titleHandEl: HTMLDivElement;
  private helpBtn: HTMLButtonElement;
  private helpIcon: SVGSVGElement;
  private refreshBtn: HTMLButtonElement;
  private recoAiBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;
  private bodyEl: HTMLDivElement;

  private statusEl: HTMLDivElement;
  private listEl: HTMLDivElement;
  private helpBodyEl: HTMLDivElement;
  private followupPanel: HTMLDivElement;
  private followupLogEl: HTMLDivElement;
  private followupChipsEl: HTMLDivElement;
  private followupInput: HTMLInputElement;
  private followupSendBtn: HTMLButtonElement;

  private snapshot: SplitSnapshot | null = null;
  private swap3HistoricalSnapshot: SplitSnapshot | null = null;
  private swap3ActionsCache: { snap: SplitSnapshot; actions: Array<SplitSwap3Action> } | null = null;
  private dingqueActionsCache: { snap: SplitSnapshot; actions: Array<SplitDingqueAction> } | null = null;
  private turnDiscardHistory: TurnDiscardHistory | null = null;
  private dingqueComputeJob: DingqueComputeJob | null = null;
  private dingqueComputeToken = 0;
  private analyzers: SplitAnalyzerSet = {};
  private selectedActionKey: string | null = null;
  private pendingScrollTileKey: number | null = null;

  private bodyScrollDrag: { pointerId: number; startY: number; startScrollTop: number; capturing: boolean } | null = null;

  private buildFrameSeed(values: ReadonlyArray<number>): number {
    let seed = 17;
    for (const raw of values) {
      const v = Number.isFinite(raw) ? Math.trunc(raw) : 0;
      seed = (seed * 131 + v + 1009) % 104729;
    }
    return seed;
  }

  private trimRecoAutoJudgeTried(max = RECO_AUTO_JUDGE_TRIED_MAX_KEYS): void {
    if (this.recoAutoJudgeTried.size <= max) return;
    const extra = this.recoAutoJudgeTried.size - max;
    const keys = Array.from(this.recoAutoJudgeTried.keys()).slice(0, extra);
    for (const k of keys) this.recoAutoJudgeTried.delete(k);
  }

  private applyFrameAccent(el: HTMLElement, seed: number, depth = 0): void {
    const palette = [
      [8, 92, 66],
      [24, 96, 61],
      [44, 98, 60],
      [72, 90, 56],
      [104, 82, 58],
      [138, 78, 56],
      [168, 82, 54],
      [188, 90, 58],
      [206, 96, 64],
      [226, 90, 68],
      [248, 84, 71],
      [272, 82, 69],
      [296, 80, 66],
      [324, 88, 66],
      [344, 92, 64],
    ] as const;
    const idx = (((seed * 7 + depth * 5) % palette.length) + palette.length) % palette.length;
    const [hue, satBase, lightBase] = palette[idx]!;
    const sat = Math.max(72, satBase - (depth % 3) * 3);
    const light = Math.max(56, lightBase - (depth % 4) * 2);
    el.style.setProperty('--split-frame-color', `hsla(${hue}, ${sat}%, ${light}%, 0.82)`);
    el.style.setProperty('--split-frame-border', `hsla(${hue}, ${sat}%, ${light}%, 0.5)`);
    el.style.setProperty('--split-frame-border-strong', `hsla(${hue}, ${sat}%, ${Math.min(light + 10, 88)}%, 0.82)`);
    el.style.setProperty('--split-frame-bg', 'rgba(255, 255, 255, 0.02)');
    el.style.setProperty('--split-frame-bg-strong', 'rgba(255, 255, 255, 0.04)');
    el.style.setProperty('--split-frame-ring', `hsla(${hue}, ${sat}%, ${Math.min(light + 14, 92)}%, 0.42)`);
  }

  constructor(params: { client: Client; world: World; root: HTMLElement; anchorBtn: HTMLButtonElement; onClose: () => void }) {
    this.client = params.client;
    this.world = params.world;
    this.root = params.root;
    this.anchorBtn = params.anchorBtn;
    this.onClose = params.onClose;

    const stop = (e: Event) => e.stopPropagation();

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'split-backdrop hidden';
    // 背景区域不用于关闭面板：关闭只允许通过“拆牌”按钮或右上角 X。
    this.root.appendChild(this.backdrop);

    this.panel = document.createElement('div');
    this.panel.className = 'split-panel hidden';
    // Prevent underlying game interactions when interacting with the split panel.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'wheel'] as const) {
      this.panel.addEventListener(type, stop);
    }
    this.root.appendChild(this.panel);

    this.helpPanel = document.createElement('div');
    this.helpPanel.className = 'split-help-panel hidden';
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'wheel'] as const) {
      this.helpPanel.addEventListener(type, stop);
    }
    this.root.appendChild(this.helpPanel);

    this.glossaryBackdrop = document.createElement('div');
    this.glossaryBackdrop.className = 'split-glossary-backdrop hidden';
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'wheel'] as const) {
      this.glossaryBackdrop.addEventListener(type, stop);
    }
    this.glossaryBackdrop.onclick = () => this.closeRecoGlossary();
    this.root.appendChild(this.glossaryBackdrop);

    this.glossaryDrawer = document.createElement('div');
    this.glossaryDrawer.className = 'split-glossary-drawer hidden';
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'wheel'] as const) {
      this.glossaryDrawer.addEventListener(type, stop);
    }
    this.root.appendChild(this.glossaryDrawer);

    const gHead = document.createElement('div');
    gHead.className = 'split-glossary-head';
    this.glossaryTitleEl = document.createElement('div');
    this.glossaryTitleEl.className = 'split-glossary-title';
    gHead.appendChild(this.glossaryTitleEl);
    const gSpacer = document.createElement('div');
    gSpacer.className = 'split-glossary-spacer';
    gHead.appendChild(gSpacer);
    const gClose = document.createElement('button');
    gClose.type = 'button';
    gClose.className = 'split-icon-btn split-glossary-close';
    gClose.title = '关闭';
    gClose.appendChild(createHudLucideIcon('x'));
    gClose.onclick = () => this.closeRecoGlossary();
    gHead.appendChild(gClose);
    this.glossaryDrawer.appendChild(gHead);

	    this.glossaryBodyEl = document.createElement('div');
	    this.glossaryBodyEl.className = 'split-glossary-body';
	    this.glossaryDrawer.appendChild(this.glossaryBodyEl);

	    this.hostedSettingsBackdrop = document.createElement('div');
	    this.hostedSettingsBackdrop.className = 'split-hosted-backdrop hidden';
	    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'wheel'] as const) {
	      this.hostedSettingsBackdrop.addEventListener(type, stop);
	    }
	    this.hostedSettingsBackdrop.onclick = () => this.closeAiHostedSettings();
	    this.root.appendChild(this.hostedSettingsBackdrop);

	    this.hostedSettingsDrawer = document.createElement('div');
	    this.hostedSettingsDrawer.className = 'split-hosted-drawer hidden';
	    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'wheel'] as const) {
	      this.hostedSettingsDrawer.addEventListener(type, stop);
	    }
	    this.root.appendChild(this.hostedSettingsDrawer);

	    const hHead = document.createElement('div');
	    hHead.className = 'split-hosted-head';
	    this.hostedSettingsTitleEl = document.createElement('div');
	    this.hostedSettingsTitleEl.className = 'split-hosted-title';
	    hHead.appendChild(this.hostedSettingsTitleEl);
	    const hSpacer = document.createElement('div');
	    hSpacer.className = 'split-hosted-spacer';
	    hHead.appendChild(hSpacer);
	    const hClose = document.createElement('button');
	    hClose.type = 'button';
	    hClose.className = 'split-icon-btn split-hosted-close';
	    hClose.title = '关闭';
	    hClose.appendChild(createHudLucideIcon('x'));
	    hClose.onclick = () => this.closeAiHostedSettings();
	    hHead.appendChild(hClose);
	    this.hostedSettingsDrawer.appendChild(hHead);

	    this.hostedSettingsBodyEl = document.createElement('div');
	    this.hostedSettingsBodyEl.className = 'split-hosted-body';
	    this.hostedSettingsDrawer.appendChild(this.hostedSettingsBodyEl);

	    this.topbar = document.createElement('div');
	    this.topbar.className = 'split-topbar';
	    this.panel.appendChild(this.topbar);

    this.subbar = document.createElement('div');
    this.subbar.className = 'split-subbar';
    this.panel.appendChild(this.subbar);

    this.actionBar = document.createElement('div');
    this.actionBar.className = 'split-actions hidden';
    this.subbar.appendChild(this.actionBar);

    this.subbarSide = document.createElement('div');
    this.subbarSide.className = 'split-subbar-side';
    this.subbar.appendChild(this.subbarSide);

    this.routeBar = document.createElement('div');
    this.routeBar.className = 'split-routes hidden';
    const addRouteBtn = (route: SplitRoute, label: string): void => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'split-route-btn';
      btn.textContent = label;
      btn.onclick = () => this.setRoute(route);
      this.routeButtons[route] = btn;
      this.routeBar.appendChild(btn);
    };
    addRouteBtn('standard', '标准');
    addRouteBtn('sevenPairs', '七对');

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'split-title';
    this.titleEl.textContent = '--';
    this.topbar.appendChild(this.titleEl);

    this.titleHandEl = document.createElement('div');
    this.titleHandEl.className = 'split-topbar-hand';
    this.topbar.appendChild(this.titleHandEl);

    const spacer = document.createElement('div');
    spacer.className = 'split-topbar-spacer';
    this.topbar.appendChild(spacer);

    this.suitBar = document.createElement('div');
    this.suitBar.className = 'split-suits hidden';
    this.suitBar.setAttribute('aria-label', '余牌');
    const addSuitBtn = (suit: BloodSuit, label: string): void => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'split-suit-btn';
      btn.textContent = label;
      btn.setAttribute('aria-pressed', 'false');
      btn.onclick = () => this.toggleSuitPanel(suit);
      this.suitButtons[suit] = btn;
      this.suitBar.appendChild(btn);
    };
    // 顺序：条 / 筒 / 万
    addSuitBtn('s', '条');
    addSuitBtn('p', '筒');
    addSuitBtn('m', '万');
    this.topbar.appendChild(this.suitBar);

    this.helpBtn = document.createElement('button');
    this.helpBtn.type = 'button';
    this.helpBtn.className = 'split-icon-btn split-help-btn';
    this.helpBtn.title = '指标说明';
    this.helpIcon = createHudLucideIcon('circleHelp');
    this.helpBtn.appendChild(this.helpIcon);
    this.helpBtn.onclick = () => this.toggleHelp();
    this.topbar.appendChild(this.helpBtn);

    this.refreshBtn = document.createElement('button');
    this.refreshBtn.type = 'button';
    this.refreshBtn.className = 'split-icon-btn';
    this.refreshBtn.title = '刷新';
    this.refreshBtn.appendChild(createHudLucideIcon('refreshCw'));
    this.refreshBtn.onclick = () => this.refresh(false);
    this.topbar.appendChild(this.refreshBtn);

    this.recoAiBtn = document.createElement('button');
    this.recoAiBtn.type = 'button';
    this.recoAiBtn.className = 'split-icon-btn split-ai-btn';
    this.recoAiBtn.appendChild(createHudLucideIcon('brain'));
    this.recoAiBtn.onclick = () => this.toggleRecoAi();
    this.topbar.appendChild(this.recoAiBtn);
    this.updateRecoAiBtn();

    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'split-icon-btn';
    this.closeBtn.title = '关闭';
    this.closeBtn.appendChild(createHudLucideIcon('x'));
    this.closeBtn.onclick = () => this.setOpen(false);
    this.topbar.appendChild(this.closeBtn);

    this.suitPanel = document.createElement('div');
    this.suitPanel.className = 'split-suit-panel hidden';
    this.subbarSide.appendChild(this.suitPanel);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'split-body';
    this.panel.appendChild(this.bodyEl);
    this.bodyEl.appendChild(this.routeBar);

    this.floatingHandEl = document.createElement('div');
    this.floatingHandEl.className = 'split-floating-hand hidden';
    this.floatingHandEl.setAttribute('aria-hidden', 'true');
    this.floatingHandEl.appendChild(document.createTextNode('当前暗手：'));
    this.floatingHandTilesEl = document.createElement('span');
    this.floatingHandTilesEl.className = 'split-tiles';
    this.floatingHandEl.appendChild(this.floatingHandTilesEl);
    this.panel.appendChild(this.floatingHandEl);

    // 触摸设备滚动兜底（同 AI 面板）
    const isScrollDragBlockedTarget = (target: EventTarget | null): boolean => {
      const el = target instanceof HTMLElement ? target : null;
      if (!el) return false;
      return !!el.closest('button, input, textarea, select, summary, details, a');
    };
    const clearBodyScrollDrag = (): void => {
      if (!this.bodyScrollDrag) return;
      const pointerId = this.bodyScrollDrag.pointerId;
      this.bodyScrollDrag = null;
      try {
        this.bodyEl.releasePointerCapture(pointerId);
      } catch {}
    };
    this.bodyEl.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      if (this.bodyScrollDrag) return;
      if (isScrollDragBlockedTarget(event.target)) return;
      this.bodyScrollDrag = { pointerId: event.pointerId, startY: event.clientY, startScrollTop: this.bodyEl.scrollTop, capturing: false };
    });
    this.bodyEl.addEventListener('pointermove', (event: PointerEvent) => {
      const drag = this.bodyScrollDrag;
      if (!drag) return;
      if (event.pointerType !== 'touch' || event.pointerId !== drag.pointerId) return;
      const dy = event.clientY - drag.startY;
      if (!drag.capturing) {
        if (Math.abs(dy) < 6) return;
        drag.capturing = true;
        try {
          this.bodyEl.setPointerCapture(drag.pointerId);
        } catch {}
      }
      this.bodyEl.scrollTop = drag.startScrollTop - dy;
      event.preventDefault();
    });
    this.bodyEl.addEventListener('pointerup', clearBodyScrollDrag);
    this.bodyEl.addEventListener('pointercancel', clearBodyScrollDrag);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'split-status';
    this.bodyEl.appendChild(this.statusEl);

    this.listEl = document.createElement('div');
    this.listEl.className = 'split-list';
    this.bodyEl.appendChild(this.listEl);

	    this.followupPanel = document.createElement('div');
	    this.followupPanel.className = 'split-followup';
	    this.followupLogEl = document.createElement('div');
	    this.followupLogEl.className = 'split-followup-log';
	    this.followupLogEl.addEventListener('scroll', () => this.onRecoFollowupScroll());
	    this.followupPanel.appendChild(this.followupLogEl);
	    this.followupChipsEl = document.createElement('div');
	    this.followupChipsEl.className = 'split-followup-chips';
	    this.followupPanel.appendChild(this.followupChipsEl);
    const row = document.createElement('div');
    row.className = 'split-followup-row';
    this.followupInput = document.createElement('input');
    this.followupInput.type = 'text';
    this.followupInput.className = 'split-followup-input';
    this.followupInput.placeholder = '追问：为什么更稳？向听/进张/安全怎么算？';
    row.appendChild(this.followupInput);
    this.followupSendBtn = document.createElement('button');
	    this.followupSendBtn.type = 'button';
	    this.followupSendBtn.className = 'split-followup-send';
	    this.followupSendBtn.textContent = '发送';
	    this.followupSendBtn.onclick = () => void this.sendRecoFollowup();
	    row.appendChild(this.followupSendBtn);
	    this.followupPanel.appendChild(row);
	    this.followupPanel.classList.add('hidden');
	    this.bodyEl.appendChild(this.followupPanel);

    const helpHead = document.createElement('div');
    helpHead.className = 'split-help-head';
    helpHead.textContent = '📘 指标说明';
    this.helpPanel.appendChild(helpHead);

    this.helpBodyEl = document.createElement('div');
    this.helpBodyEl.className = 'split-help-body';
    this.helpBodyEl.appendChild(this.renderHelpContent());
    this.helpPanel.appendChild(this.helpBodyEl);

    this.loadAiHostedSettings();

    window.addEventListener('resize', () => {
      this.layout();
      this.render();
    });

	    this.client.on('aiDelta', (msg: any) => this.onFollowupAiDelta(msg));
	    this.client.on('aiResult', (msg: any) => this.onFollowupAiResult(msg?.item));
	    this.client.on('aiError', (msg: any) => this.onFollowupAiError(msg));
	    this.client.on('actionAck', (ack: any) => this.onAiHostedActionAck(ack));
	    this.client.on('disconnect', () => {
	      if (this.aiHostedEnabled) {
	        this.setAiHostedEnabled(false, '连接已断开');
	      }
	    });
	    this.client.blood.on('update', () => this.onBloodUpdate());
	  }

  isOpen(): boolean {
    return this.open;
  }

  syncActability(): void {
    if (!this.open) return;
    const seat = this.world.seat;
    const blood = this.client.blood.get(0) as BloodState | null;
    const livePhase = blood?.phase ?? null;
    const snapPhase = this.snapshot?.blood?.phase ?? null;
    if (livePhase !== snapPhase) {
      this.refresh(false);
      return;
    }
    if (seat !== null && blood && this.snapshot && !this.snapshot.ok && this.snapshot.reason === '手牌同步中，稍后再试') {
      const ownHandSlotCount = countOwnHandSlotCount(this.client, seat);
      const knownCount = this.totalTileCount(countOwnKnownHandFromSlots(this.client, seat));
      const isComplete = ownHandSlotCount > 0 ? knownCount >= ownHandSlotCount : (blood.phase === 'swap3' || blood.phase === 'dingque') && knownCount >= 13;
      if (isComplete) {
        this.refresh(false);
        return;
      }
      return;
    }
    const canSelfTurnActNow =
      seat !== null &&
      !!blood &&
      blood.phase === 'playing' &&
      blood.pending === null &&
      blood.turnSeat === seat &&
      blood.turnStep === 'discard';
    const canSelfClaimActNow = (() => {
      if (seat === null || !blood || blood.phase !== 'playing') return false;
      const pending = blood.pending;
      if (!pending || pending.kind !== 'claim') return false;
      if ((pending.responses?.[seat] ?? null) !== null) return false;
      const opt = pending.options?.[seat] ?? null;
      if (!opt) return false;
      return !!(opt.hu || opt.peng || opt.gang);
    })();
    const canSelfSwap3ActNow =
      seat !== null &&
      !!blood &&
      blood.phase === 'swap3' &&
      !!blood.swap3 &&
      blood.swap3.animatingSince === null &&
      (blood.swap3.selections?.[seat] ?? null) === null;
    const canSelfDingqueActNow =
      seat !== null && !!blood && blood.phase === 'dingque' && (blood.players?.[seat]?.dingqueReady ?? false) !== true;

    // claim 属于可操作窗口：进入 claim 时需要刷新 snapshot（否则会继续显示上一次 discard 的旧结果）。
    if (canSelfClaimActNow && blood?.pending?.kind === 'claim') {
      const liveId = blood.pending.id;
      const snapId = this.snapshot?.ok && this.snapshot.blood.pending?.kind === 'claim' ? this.snapshot.blood.pending.id : null;
      if (snapId !== liveId) {
        this.refresh(false);
        return;
      }
    }

    if (blood?.phase === 'swap3' && this.snapshot?.ok && this.snapshot.blood.phase === 'swap3') {
      const liveAnimating = blood.swap3?.animatingSince ?? null;
      const snapAnimating = this.snapshot.blood.swap3?.animatingSince ?? null;
      const liveSelection = seat !== null ? (blood.swap3?.selections?.[seat] ?? null) : null;
      const snapSelection = seat !== null ? (this.snapshot.blood.swap3?.selections?.[seat] ?? null) : null;
      if (liveAnimating !== snapAnimating || liveSelection !== snapSelection) {
        this.refresh(false);
        return;
      }
    }

    const nextHistorical = !(canSelfTurnActNow || canSelfClaimActNow || canSelfSwap3ActNow || canSelfDingqueActNow);
    if (nextHistorical === this.actionsHistorical) return;
    this.actionsHistorical = nextHistorical;
    this.render();
  }

  private isSelfClaimWindow(snap: SplitSnapshot): { pending: BloodPendingClaim; opt: { hu: boolean; peng: boolean; gang: boolean } } | null {
    const pending = snap.blood.pending;
    if (!pending || pending.kind !== 'claim') return null;
    const seat = snap.seat;
    if ((pending.responses?.[seat] ?? null) !== null) return null;
    const opt = pending.options?.[seat] ?? { hu: false, peng: false, gang: false };
    // 口径：仅在“轮到本家响应”（确有可选项）时展示 claim 动作条；否则视作非可操作窗口。
    if (!opt.hu && !opt.peng && !opt.gang) return null;
    return { pending, opt };
  }

  private isSelfSwap3Window(snap: SplitSnapshot): boolean {
    const swap3 = snap.blood.swap3 ?? null;
    if (snap.blood.phase !== 'swap3' || !swap3) return false;
    if (swap3.animatingSince !== null) return false;
    return (swap3.selections?.[snap.seat] ?? null) === null;
  }

  private isSelfDingqueWindow(snap: SplitSnapshot): boolean {
    if (snap.blood.phase !== 'dingque') return false;
    const me = snap.blood.players?.[snap.seat] ?? null;
    return !!me && (me.dingqueReady ?? false) !== true;
  }

  private syncSwap3HistoricalSnapshot(next: SplitSnapshot | null, prev: SplitSnapshot | null = this.snapshot): void {
    if (prev?.ok && this.isSelfSwap3Window(prev)) this.swap3HistoricalSnapshot = prev;
    if (!next) {
      this.swap3HistoricalSnapshot = null;
      return;
    }
    if (!next.ok) {
      if (next.blood?.phase !== 'swap3') this.swap3HistoricalSnapshot = null;
      return;
    }
    if (next.blood.phase !== 'swap3') {
      this.swap3HistoricalSnapshot = null;
      return;
    }
    if (this.isSelfSwap3Window(next)) this.swap3HistoricalSnapshot = next;
  }

  private getSwap3DisplaySnapshot(snap: SplitSnapshot): SplitSnapshot | null {
    if (!this.actionsHistorical) return snap;
    if (this.swap3HistoricalSnapshot?.ok && this.swap3HistoricalSnapshot.blood.phase === 'swap3') {
      return this.swap3HistoricalSnapshot;
    }
    return null;
  }

  private getPanelMode(snap: SplitSnapshot): { mode: SplitPanelMode; claimCtx: ReturnType<BloodSplitOverlay['isSelfClaimWindow']> } {
    if (snap.blood.phase === 'swap3') return { mode: 'swap3', claimCtx: null };
    if (snap.blood.phase === 'dingque') return { mode: 'dingque', claimCtx: null };
    const claimCtx = this.isSelfClaimWindow(snap);
    return { mode: claimCtx ? 'claim' : 'turn', claimCtx };
  }

  openBestDetail(): void {
    if (!this.open) return;
    const snap = this.snapshot;
    if (!snap || !snap.ok) return;
    this.expandedCandidates.clear();
    this.selectedActionKey = null;
    this.render();
  }

  syncAndOpenBestDetail(): void {
    if (!this.open) return;
    this.snapshot = buildSnapshot(this.client, this.world);
    if (!this.snapshot.ok) {
      this.analyzers = {};
      this.statusEl.textContent = this.snapshot.reason ?? '当前不可拆牌';
      this.render();
      return;
    }
    if (this.snapshot.blood.phase === 'playing' && this.snapshot.myDingque) {
      this.analyzers = {
        standard: new SplitAnalyzer({
          route: 'standard',
          fixedMeldCount: this.snapshot.melds.length,
          melds: this.snapshot.melds,
          dingque: this.snapshot.myDingque,
          base: this.snapshot.base,
          cap: this.snapshot.cap,
          aliveOpponents: this.snapshot.aliveOpponents,
          unknownPoolSize: this.snapshot.unknownPoolSize,
          stage: this.snapshot.stage,
          publicCounts: this.snapshot.publicCounts,
          remCounts: this.snapshot.remCounts,
          opponents: this.snapshot.opponents,
        }),
        sevenPairs: new SplitAnalyzer({
          route: 'sevenPairs',
          fixedMeldCount: this.snapshot.melds.length,
          melds: this.snapshot.melds,
          dingque: this.snapshot.myDingque,
          base: this.snapshot.base,
          cap: this.snapshot.cap,
          aliveOpponents: this.snapshot.aliveOpponents,
          unknownPoolSize: this.snapshot.unknownPoolSize,
          stage: this.snapshot.stage,
          publicCounts: this.snapshot.publicCounts,
          remCounts: this.snapshot.remCounts,
          opponents: this.snapshot.opponents,
        }),
      };
      if (!this.getRouteAnalyzer('sevenPairs')?.isAvailable()) this.routeMode = 'standard';
    } else {
      this.analyzers = {};
    }
    this.openBestDetail();
  }

  setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.anchorBtn.classList.toggle('active', open);
    this.backdrop.classList.toggle('hidden', !open);
    this.panel.classList.toggle('hidden', !open);
			    if (!open) {
		      // 关闭拆牌面板：同时关闭 AI托管 / 自动裁决，避免“面板已关但仍在自动操作/扣费”的误解与风险。
		      if (this.aiHostedEnabled) {
		        this.setAiHostedEnabled(false, '拆牌面板已关闭');
		      }
		      // 关闭面板：取消进行中的裁决请求（不区分来源）。
		      this.cancelRecoLlmJudge();
		      this.setRecoAutoJudgeEnabled(false, { cancelInflight: false, render: false });
			      this.closeAiHostedSettings();
			      this.clearFloatingHandSource();
			      this.suitOpen = null;
		      this.routeMode = 'standard';
	      this.snapshot = null;
      this.swap3HistoricalSnapshot = null;
      this.swap3ActionsCache = null;
      this.dingqueActionsCache = null;
      this.dingqueComputeJob = null;
      this.analyzers = {};
      this.selectedActionKey = null;
      this.pendingScrollTileKey = null;
      this.expandedCandidates.clear();
      this.helpOpen = false;
      this.helpSideBySide = false;
      this.helpPanel.classList.add('hidden');
	      this.closeRecoGlossary();
	      this.updateHelpBtn();
	      this.actionsHistorical = false;
	      this.followupPanel.classList.add('hidden');
	      this.bodyEl.classList.remove('has-followup');
	      this.listEl.innerHTML = '';
	      this.onClose();
	      return;
	    }
    this.refresh(true);
    this.layout();
  }

  private toggleSuitPanel(suit: BloodSuit): void {
    if (!this.open) return;
    const snap = this.snapshot;
    if (!snap || !snap.ok) return;
    this.suitOpen = this.suitOpen === suit ? null : suit;
    this.renderSuitPanel(snap);
  }

  private renderSuitPanel(snap: SplitSnapshot): void {
    this.suitBar.classList.remove('hidden');
    const open = this.suitOpen;
    for (const s of ['s', 'p', 'm'] as const) {
      const btn = this.suitButtons[s];
      if (!btn) continue;
      btn.classList.toggle('is-on', open === s);
      btn.setAttribute('aria-pressed', open === s ? 'true' : 'false');
    }

    if (!open) {
      this.suitPanel.classList.add('hidden');
      this.suitPanel.innerHTML = '';
      this.updateSubbarVisibility();
      this.updateFloatingHandPosition();
      return;
    }

    const base = open === 'm' ? 0 : open === 'p' ? 9 : 18;
    const grid = document.createElement('div');
    grid.className = 'split-suit-grid';
    for (let i = 0; i < 9; i++) {
      const tileKey = base + i;
      const remain = snap.remCounts[tileKey] ?? 0;
      if (remain <= 0) continue;
      const tile = document.createElement('div');
      tile.className = 'split-suit-tile';
      const num = document.createElement('div');
      num.className = 'split-suit-num';
      num.textContent = String(remain);
      tile.appendChild(num);
      const img = tileImg(tileKey, 'split-suit-img');
      tile.appendChild(img);
      grid.appendChild(tile);
    }

    this.suitPanel.innerHTML = '';
    this.suitPanel.classList.remove('hidden');
    if (grid.childElementCount === 0) {
      const empty = document.createElement('div');
      empty.className = 'split-empty';
      empty.textContent = '该花色余牌为 0';
      this.suitPanel.appendChild(empty);
    } else {
      this.suitPanel.appendChild(grid);
    }
    this.updateSubbarVisibility();
    this.updateFloatingHandPosition();
  }

  private updateSubbarVisibility(): void {
    const actionInSubbarVisible = this.actionBar.parentElement === this.subbar && !this.actionBar.classList.contains('hidden');
    const show = actionInSubbarVisible || !this.suitPanel.classList.contains('hidden');
    this.subbar.classList.toggle('hidden', !show);
  }

	  private renderInlineHelpInList(hideActionBar = false): void {
	    this.routeBar.classList.add('hidden');
	    if (hideActionBar) this.actionBar.classList.add('hidden');
	    this.followupPanel.classList.add('hidden');
	    this.bodyEl.classList.remove('has-followup');
	    this.listEl.innerHTML = '';
	    this.listEl.classList.remove('hidden');
	    const box = document.createElement('div');
    box.className = 'split-help-inline';
    box.appendChild(this.renderHelpContent());
    this.listEl.appendChild(box);
    this.updateSubbarVisibility();
  }

  private updateFloatingHandPosition(): void {
    const top = this.bodyEl.offsetTop;
    this.floatingHandEl.style.top = `${top}px`;
  }

  private clearFloatingHandSource(): void {
    this.floatingHandSource = null;
    if (this.floatingHandObserver) {
      this.floatingHandObserver.disconnect();
      this.floatingHandObserver = null;
    }
    if (this.floatingHandScrollFallback) {
      this.bodyEl.removeEventListener('scroll', this.floatingHandScrollFallback);
      this.floatingHandScrollFallback = null;
    }
    this.floatingHandEl.classList.add('hidden');
    this.floatingHandTilesEl.innerHTML = '';
  }

  private setFloatingHandSource(handRow: HTMLElement, tilesWrap: HTMLElement): void {
    if (this.floatingHandSource?.handRow === handRow) return;

    this.updateFloatingHandPosition();
    this.clearFloatingHandSource();
    this.floatingHandSource = { handRow, tilesWrap };
    this.floatingHandTilesEl.innerHTML = tilesWrap.innerHTML;

    const updateVisible = (isVisible: boolean): void => {
      this.floatingHandEl.classList.toggle('hidden', isVisible);
      if (!isVisible) this.floatingHandTilesEl.innerHTML = tilesWrap.innerHTML;
    };

    try {
      this.floatingHandObserver = new IntersectionObserver(
        (entries) => {
          const e = entries[0] ?? null;
          const visible = !!e && e.isIntersecting && e.intersectionRatio > 0;
          updateVisible(visible);
        },
        { root: this.bodyEl, threshold: [0, 0.01] },
      );
      this.floatingHandObserver.observe(handRow);

      // 初次绑定时主动算一次，避免等待 observer 回调。
      const bodyRect = this.bodyEl.getBoundingClientRect();
      const rowRect = handRow.getBoundingClientRect();
      const visible = rowRect.bottom > bodyRect.top && rowRect.top < bodyRect.bottom;
      updateVisible(visible);
    } catch {
      // IntersectionObserver 不可用时退化：监听 scroll 做轻量判断（移动端更稳）。
      const checkVisible = (): void => {
        const bodyRect = this.bodyEl.getBoundingClientRect();
        const rowRect = handRow.getBoundingClientRect();
        const visible = rowRect.bottom > bodyRect.top && rowRect.top < bodyRect.bottom;
        updateVisible(visible);
      };
      this.floatingHandScrollFallback = () => checkVisible();
      this.bodyEl.addEventListener('scroll', this.floatingHandScrollFallback, { passive: true });
      checkVisible();
    }
  }

  private updateHelpBtn(): void {
    const icon = this.helpOpen ? 'arrowLeft' : 'circleHelp';
    setHudLucideIcon(this.helpIcon, icon);
    this.helpBtn.title = this.helpOpen ? '收起说明' : '指标说明';
    this.helpBtn.classList.toggle('is-on', this.helpOpen);
    this.helpBtn.setAttribute('aria-pressed', this.helpOpen ? 'true' : 'false');
  }

  private toggleHelp(): void {
    if (!this.open) return;
    this.helpOpen = !this.helpOpen;
    this.updateHelpBtn();
    this.layout();
    this.render();
  }

  private placeRouteBar(inTopbar: boolean): void {
    if (inTopbar) {
      if (this.routeBar.parentElement !== this.topbar) {
        this.topbar.insertBefore(this.routeBar, this.titleEl);
      }
      return;
    }
    if (this.routeBar.parentElement !== this.bodyEl) {
      this.bodyEl.insertBefore(this.routeBar, this.statusEl);
    }
  }

  private placeActionBar(inBody: boolean): void {
    if (inBody) {
      if (this.actionBar.parentElement !== this.bodyEl) {
        const first = this.bodyEl.firstChild;
        if (first) this.bodyEl.insertBefore(this.actionBar, first);
        else this.bodyEl.appendChild(this.actionBar);
      }
      return;
    }
    if (this.actionBar.parentElement !== this.subbar) {
      this.subbar.insertBefore(this.actionBar, this.subbarSide);
    }
  }

  private hasDingqueTilesInCounts(counts: ReadonlyArray<number>, dingque: BloodSuit | null): boolean {
    if (!dingque) return false;
    for (let k = 0; k < 27; k++) {
      if ((counts[k] ?? 0) <= 0) continue;
      if (suitOf(k) === dingque) return true;
    }
    return false;
  }

  private hasDingqueTiles(snap: SplitSnapshot): boolean {
    return this.hasDingqueTilesInCounts(snap.handCounts14, snap.myDingque);
  }

  private getRouteAnalyzer(route: SplitRoute, analyzers: SplitAnalyzerSet = this.analyzers): SplitAnalyzer | null {
    return analyzers[route] ?? null;
  }

  private getActiveRouteForCounts(
    snap: SplitSnapshot,
    counts: ReadonlyArray<number>,
    analyzers: SplitAnalyzerSet = this.analyzers,
  ): SplitRoute {
    if (this.hasDingqueTilesInCounts(counts, snap.myDingque)) return 'standard';
    if (this.routeMode === 'sevenPairs') {
      const analyzer = this.getRouteAnalyzer('sevenPairs', analyzers);
      if (analyzer && analyzer.isAvailable()) return 'sevenPairs';
      return 'standard';
    }
    return 'standard';
  }

  private getActiveRoute(snap: SplitSnapshot | null, analyzers: SplitAnalyzerSet = this.analyzers): SplitRoute {
    if (!snap) return 'standard';
    return this.getActiveRouteForCounts(snap, snap.handCounts14, analyzers);
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

  private formatDingqueShanten(value: number): string {
    const rounded = Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
    if (Math.abs(rounded - Math.trunc(rounded)) < 1e-9) return String(Math.trunc(rounded));
    return rounded.toFixed(1).replace(/\.0$/, '');
  }

  private formatDingqueMetric(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
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

  private buildDingqueEvalSnap(snap: SplitSnapshot, suit: BloodSuit, state: DingqueEvalState): SplitSnapshot {
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

  private buildDingqueAnalyzers(snap: SplitSnapshot, suit: BloodSuit, state: DingqueEvalState): SplitAnalyzerSet {
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

  private pickBestAutoDiscardTile(snap: SplitSnapshot, suit: BloodSuit, state: DingqueEvalState): number | null {
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
      const route = this.getAutoRouteForClearedCandidate(counts13, publicCounts, state.remCounts, analyzers);
      const analyzer = this.getRouteAnalyzer(route, analyzers);
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
      const aAnalyzer = this.getRouteAnalyzer(a.route, analyzers);
      const bAnalyzer = this.getRouteAnalyzer(b.route, analyzers);
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

  private pickBestDingqueDiscardTile(snap: SplitSnapshot, suit: BloodSuit, state: DingqueEvalState): number | null {
    if (!this.hasDingqueTilesInCounts(state.counts, suit)) {
      return this.pickBestAutoDiscardTile(snap, suit, state);
    }
    const tempSnap = this.buildDingqueEvalSnap(snap, suit, state);
    const analyzers = this.buildDingqueAnalyzers(snap, suit, state);
    const ranked = this.rankCandidates(tempSnap, analyzers);
    return ranked.candidates[0]?.tileKey ?? null;
  }

  private summarizeDingqueState(
    snap: SplitSnapshot,
    suit: BloodSuit,
    state: DingqueEvalState,
  ): { route: SplitRoute; summary: StateSummary; wallRemaining: number; unknownPoolSize: number } | null {
    if (this.totalTileCount(state.counts) !== 13) return null;
    const analyzers = this.buildDingqueAnalyzers(snap, suit, state);
    const route = this.hasDingqueTilesInCounts(state.counts, suit)
      ? 'standard'
      : this.getAutoRouteForClearedCandidate(state.counts.slice(), state.publicCounts, state.remCounts, analyzers);
    const analyzer = this.getRouteAnalyzer(route, analyzers);
    const summary = analyzer ? analyzer.summary(state.counts.slice(), state.remCounts) : null;
    return summary
      ? { route, summary, wallRemaining: state.wallRemaining, unknownPoolSize: state.unknownPoolSize }
      : null;
  }

  private runDingqueRollout(
    snap: SplitSnapshot,
    suit: BloodSuit,
    initialState: DingqueEvalState,
    rng: () => number,
  ): { route: SplitRoute; summary: StateSummary; wallRemaining: number; unknownPoolSize: number } | null {
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

  private getAutoRouteForClearedCandidate(
    counts13: Array<number>,
    publicCounts: ReadonlyArray<number>,
    remCounts: ReadonlyArray<number>,
    analyzers: SplitAnalyzerSet = this.analyzers,
  ): SplitRoute {
    const standardAnalyzer = this.getRouteAnalyzer('standard', analyzers);
    const sevenPairsAnalyzer = this.getRouteAnalyzer('sevenPairs', analyzers);
    if (!standardAnalyzer) return 'standard';
    if (!sevenPairsAnalyzer || !sevenPairsAnalyzer.isAvailable()) return 'standard';

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

  private updateRouteButtons(snap: SplitSnapshot): void {
    const hasDingque = this.hasDingqueTiles(snap);
    const sevenAvailable = !!this.getRouteAnalyzer('sevenPairs')?.isAvailable();
    this.routeBar.classList.toggle('hidden', hasDingque || !sevenAvailable);
    const activeRoute = this.getActiveRoute(snap);
    for (const route of ['standard', 'sevenPairs'] as const) {
      const btn = this.routeButtons[route];
      if (!btn) continue;
      btn.classList.toggle('active', route === activeRoute);
      const disabled = route === 'sevenPairs' && !sevenAvailable;
      btn.disabled = disabled;
      btn.title = disabled ? '有副露时不可走七对' : '';
    }
  }

  private setRoute(route: SplitRoute): void {
    if (!this.open || this.routeMode === route) return;
    const snap = this.snapshot;
    if (!snap || !snap.ok) return;
    if (route === 'sevenPairs' && !this.getRouteAnalyzer('sevenPairs')?.isAvailable()) return;
    this.routeMode = route;
    this.expandedCandidates.clear();
    this.render();
    const ranked = this.rankCandidates(snap);
    const best = ranked.candidates[0]?.tileKey ?? null;
    if (best === null) {
      this.pendingScrollTileKey = null;
      return;
    }
    if (this.helpOpen && !this.helpSideBySide) {
      this.pendingScrollTileKey = best;
      return;
    }
    this.pendingScrollTileKey = null;
    this.scrollToCandidate(best);
  }

  private currentHuEvents(snap: SplitSnapshot): { gangShangKaiHua?: boolean; haiDi?: boolean } {
    const afterGang = (snap.blood.afterGangSeat ?? null) === snap.seat;
    if (afterGang) return { gangShangKaiHua: true };
    if (snap.wallRemaining === 0) return { haiDi: true };
    return {};
  }

  private buildAnalyzersForState(params: {
    snap: SplitSnapshot;
    melds: Array<CalcMeld>;
    publicCounts: Array<number>;
    remCounts: Array<number>;
    unknownPoolSize: number;
    stage: SplitStage;
    dingque: BloodSuit;
  }): SplitAnalyzerSet {
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

  private evaluateGangContinuation(
    snap: SplitSnapshot,
    nextMelds: Array<CalcMeld>,
    nextPublicCounts: Array<number>,
    nextCounts: Array<number>,
    drawTile: number,
  ): {
    gainMin: number;
    gainMax: number;
    discardTileKey: number | null;
  } {
    const remCounts = snap.remCounts.slice();
    remCounts[drawTile] = Math.max(0, (remCounts[drawTile] ?? 0) - 1);
    const wallRemaining = Math.max(0, snap.wallRemaining - 1);
    const unknownPoolSize = Math.max(0, snap.unknownPoolSize - 1);
    const stage = computeSplitStage(wallRemaining);
    const tempSnap: SplitSnapshot = {
      ...snap,
      melds: nextMelds,
      handCounts14: nextCounts,
      publicCounts: nextPublicCounts,
      remCounts,
      wallRemaining,
      unknownPoolSize,
      stage,
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
    const discard = this.buildDiscardAction(tempSnap, analyzers);
    const bestBranch = discard.bestTileKey !== null ? discard.branches.get(discard.bestTileKey) ?? null : null;
    const gainMin = bestBranch?.valueMin ?? 0;
    const gainMax = bestBranch?.valueMax ?? 0;
    return {
      gainMin,
      gainMax,
      discardTileKey: discard.bestTileKey,
    };
  }

  private buildHuAction(snap: SplitSnapshot): SplitTurnAction | null {
    if (!snap.canSelfTurnAct || !snap.hasExtraTile) return null;
    if (hasDingqueTileInCounts(snap.handCounts14, snap.myDingque)) return null;
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
    if (!calc.ok) return null;
    return {
      kind: 'hu',
      key: 'hu',
      label: '自摸',
      displayValue: String(Math.round(calc.winnerGain)),
      score: calc.winnerGain,
      gain: calc.winnerGain,
      calc,
    };
  }

  private buildGangAction(snap: SplitSnapshot, gangType: 'an' | 'add', tileKey: number): SplitTurnAction | null {
    // 暗杠/加杠必须发生在“摸牌后”的本回合；碰后进入弃牌回合（无 extra）时不允许宣杠。
    if (!snap.canSelfTurnAct || !snap.hasExtraTile) return null;
    // 血战规则：杠后必须能补张；墙剩 0 时不允许杠。
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
    const outcomes: Array<SplitGangDrawOutcome> = [];
    let zeroRemain = 0;
    let gainMin = Infinity;
    let gainMax = 0;

    for (let drawTile = 0; drawTile < 27; drawTile++) {
      const remain = snap.remCounts[drawTile] ?? 0;
      if (remain <= 0) continue;

      const nextCounts = nextCountsBase.slice();
      nextCounts[drawTile] = (nextCounts[drawTile] ?? 0) + 1;

      let gain = 0;
      let gainRangeMin = 0;
      let gainRangeMax = 0;
      let multiplier = 0;
      let discardTileKey: number | null = null;
      if (!hasDingqueTileInCounts(nextCounts, snap.myDingque)) {
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
          gain = Math.trunc(calc.winnerGain);
          gainRangeMin = gain;
          gainRangeMax = gain;
          multiplier = Math.trunc(calc.multiplierCapped);
          outcomes.push({ kind: 'kaihua', tileKey: drawTile, remain, gain, gainMin: gain, gainMax: gain, multiplier, discardTileKey: null });
        } else {
          const follow = this.evaluateGangContinuation(snap, nextMelds, nextPublicCounts, nextCounts, drawTile);
          gainRangeMin = follow.gainMin;
          gainRangeMax = follow.gainMax;
          discardTileKey = follow.discardTileKey;
          gain = midpoint(gainRangeMin, gainRangeMax);
          if (gain > 0 || gainRangeMax > 0) {
            outcomes.push({
              kind: 'continue',
              tileKey: drawTile,
              remain,
              gain,
              gainMin: gainRangeMin,
              gainMax: gainRangeMax,
              multiplier: 0,
              discardTileKey,
            });
          }
        }
      } else {
        const follow = this.evaluateGangContinuation(snap, nextMelds, nextPublicCounts, nextCounts, drawTile);
        gainRangeMin = follow.gainMin;
        gainRangeMax = follow.gainMax;
        discardTileKey = follow.discardTileKey;
        gain = midpoint(gainRangeMin, gainRangeMax);
        if (gain > 0 || gainRangeMax > 0) {
          outcomes.push({
            kind: 'continue',
            tileKey: drawTile,
            remain,
            gain,
            gainMin: gainRangeMin,
            gainMax: gainRangeMax,
            multiplier: 0,
            discardTileKey,
          });
        }
      }

      if (gain <= 0 && gainRangeMax <= 0) zeroRemain += remain;
      if (gainRangeMin < gainMin) gainMin = gainRangeMin;
      if (gainRangeMax > gainMax) gainMax = gainRangeMax;
    }

    if (!Number.isFinite(gainMin)) gainMin = 0;
    const totalMin = immediateGain + gainMin;
    const totalMax = immediateGain + gainMax;

    outcomes.sort((a, b) => {
      if (b.remain !== a.remain) return b.remain - a.remain;
      return a.tileKey - b.tileKey;
    });

    return {
      kind: 'gang',
      key: `gang:${gangType}:${tileKey}`,
      label: `${gangType === 'an' ? '暗杠' : '加杠'}${tileCode(tileKey)}`,
      displayValue: formatGainRange(totalMin, totalMax),
      score: midpoint(totalMin, totalMax),
      gangType,
      tileKey,
      immediateGain,
      gainMin: totalMin,
      gainMax: totalMax,
      outcomes,
      zeroRemain,
    };
  }

  private buildDiscardBranch(
    snap: SplitSnapshot,
    ranked: RankedCandidates,
    candidate: SplitCandidate,
    analyzers: SplitAnalyzerSet = this.analyzers,
  ): SplitDiscardBranch | null {
    const counts13 = snap.handCounts14.slice();
    counts13[candidate.tileKey] = (counts13[candidate.tileKey] ?? 0) - 1;
    const branchPublicCounts = snap.publicCounts.slice();
    branchPublicCounts[candidate.tileKey] = (branchPublicCounts[candidate.tileKey] ?? 0) + 1;
    const blocked = this.hasDingqueTilesInCounts(counts13, snap.myDingque);
    const route =
      blocked
        ? 'standard'
        : this.hasDingqueTiles(snap)
          ? this.getAutoRouteForClearedCandidate(counts13, branchPublicCounts, snap.remCounts, analyzers)
          : this.getActiveRouteForCounts(snap, counts13, analyzers);
    const analyzer = this.getRouteAnalyzer(route, analyzers);
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

    const branchScore = (() => {
      if (blocked || snap.wallRemaining <= 0) return 0;
      if (summary.tenpai) {
        const pWin = snap.unknownPoolSize > 0 ? summary.tenpai.winCount / snap.unknownPoolSize : 0;
        const avgGain = (summary.tenpai.avgRonGain + summary.tenpai.avgZimoGain) / 2;
        return avgGain * pWin;
      }
      if (summary.improve) {
        const pImprove = summary.improve.pImprove ?? 0;
        return midpoint(valueMin, valueMax) * pImprove;
      }
      return 0;
    })();

    return {
      tileKey: candidate.tileKey,
      counts13,
      summary,
      route,
      valueMin,
      valueMax,
      score: branchScore,
    };
  }

  private buildDiscardAction(
    snap: SplitSnapshot,
    analyzers: SplitAnalyzerSet = this.analyzers,
  ): Extract<SplitTurnAction, { kind: 'discard' }> {
    const ranked = this.rankCandidates(snap, analyzers);
    const branches = new Map<number, SplitDiscardBranch>();
    const bestTileKey = ranked.candidates[0]?.tileKey ?? null;

    for (const candidate of ranked.candidates) {
      const branch = this.buildDiscardBranch(snap, ranked, candidate, analyzers);
      if (!branch) continue;
      branches.set(candidate.tileKey, branch);
    }

    const bestBranch = bestTileKey !== null ? branches.get(bestTileKey) ?? null : null;
    const rangeMin = bestBranch?.valueMin ?? 0;
    const rangeMax = bestBranch?.valueMax ?? 0;
    const displayValue = ranked.kind === 'dingque' ? '清缺' : formatGainRange(rangeMin, rangeMax);

    return {
      kind: 'discard',
      key: 'discard',
      label: '出牌',
      displayValue,
      score: midpoint(rangeMin, rangeMax),
      rangeMin,
      rangeMax,
      ranked,
      branches,
      bestTileKey,
    };
  }

  private buildTurnActions(snap: SplitSnapshot): Array<SplitTurnAction> {
    const out: Array<SplitTurnAction> = [];
    if (snap.canSelfTurnAct) {
      const hu = this.buildHuAction(snap);
      if (hu) out.push(hu);

      for (let tileKey = 0; tileKey < 27; tileKey++) {
        if ((snap.handCounts14[tileKey] ?? 0) >= 4 && suitOf(tileKey) !== snap.myDingque) {
          const row = this.buildGangAction(snap, 'an', tileKey);
          if (row) out.push(row);
        }
      }
      const seenAdd = new Set<number>();
      for (const meld of snap.melds) {
        if (meld.kind !== 'peng') continue;
        if (seenAdd.has(meld.tileKey)) continue;
        seenAdd.add(meld.tileKey);
        if (suitOf(meld.tileKey) === snap.myDingque) continue;
        if ((snap.handCounts14[meld.tileKey] ?? 0) <= 0) continue;
        const row = this.buildGangAction(snap, 'add', meld.tileKey);
        if (row) out.push(row);
      }
      // 仅在本家“需要弃牌”的可操作窗口才计算弃牌候选与推荐。
      out.push(this.buildDiscardAction(snap));
    }
    return out;
  }

  private buildClaimHuAction(
    snap: SplitSnapshot,
    pending: BloodPendingClaim,
  ): Extract<SplitClaimAction, { kind: 'claimHu' }> | null {
    const tileKey = pending.tileKey;
    const counts14 = snap.handCounts14.slice();
    counts14[tileKey] = (counts14[tileKey] ?? 0) + 1;
    if (hasDingqueTileInCounts(counts14, snap.myDingque)) return null;

    const trigger = pending.trigger ?? 'discard';
    const events = {
      gangShangPao: trigger === 'discard' && Boolean(pending.afterGang),
      qiangGangHu: trigger === 'addKong',
    };
    const calc = calcBloodHu(
      { concealedTiles: tilesFromCounts(counts14), melds: snap.melds },
      {
        base: snap.base,
        cap: snap.cap,
        huMethod: 'dianpao',
        events,
      },
    );
    if (!calc.ok) return null;
    return {
      kind: 'claimHu',
      key: `claim:${pending.id}:hu`,
      label: '胡',
      displayValue: String(Math.round(calc.winnerGain)),
      score: calc.winnerGain,
      gain: calc.winnerGain,
      calc,
    };
  }

  private buildClaimPassAction(snap: SplitSnapshot, pending: BloodPendingClaim): Extract<SplitClaimAction, { kind: 'claimPass' }> {
    const counts13 = snap.handCounts14.slice();
    const blockedByDingque = this.hasDingqueTilesInCounts(counts13, snap.myDingque);
    const route = blockedByDingque ? 'standard' : this.getActiveRouteForCounts(snap, counts13);
    const analyzer = this.getRouteAnalyzer(route);
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
    const worstShanten = summary ? summary.shanten : Infinity;
    return {
      kind: 'claimPass',
      key: `claim:${pending.id}:pass`,
      label: '过',
      displayValue: formatGainRange(valueMin, valueMax),
      score: midpoint(valueMin, valueMax),
      rangeMin: valueMin,
      rangeMax: valueMax,
      worstShanten,
      route,
      summary,
      blockedByDingque,
    };
  }

  private buildClaimPengAction(
    snap: SplitSnapshot,
    pending: BloodPendingClaim,
  ): Extract<SplitClaimAction, { kind: 'claimPeng' }> | null {
    const tileKey = pending.tileKey;
    const take = snap.handCounts14[tileKey] ?? 0;
    if (take < 2) return null;
    if (suitOf(tileKey) === snap.myDingque) return null;

    const nextCounts14 = snap.handCounts14.slice();
    nextCounts14[tileKey] = Math.max(0, (nextCounts14[tileKey] ?? 0) - 2);
    const nextMelds: Array<CalcMeld> = [...snap.melds, { kind: 'peng', tileKey }];
    // publicCounts：pending tile 已在 discard 里计入 1；碰后变为 3，因此 +2。
    const nextPublicCounts = snap.publicCounts.slice();
    nextPublicCounts[tileKey] = (nextPublicCounts[tileKey] ?? 0) + 2;

    const tempSnap: SplitSnapshot = { ...snap, melds: nextMelds, handCounts14: nextCounts14, publicCounts: nextPublicCounts };
	    const analyzers = this.buildAnalyzersForState({
	      snap: tempSnap,
	      melds: nextMelds,
	      publicCounts: nextPublicCounts,
	      remCounts: snap.remCounts,
	      unknownPoolSize: snap.unknownPoolSize,
	      stage: snap.stage,
        dingque: snap.myDingque ?? 'm',
	    });
	    const discard = this.buildDiscardAction(tempSnap, analyzers);
	    const best = discard.bestTileKey;
	    const bestBranch = best !== null ? discard.branches.get(best) ?? null : null;

	    const bestRoute = bestBranch?.route ?? discard.ranked.route;
	    const bestSummary = bestBranch?.summary ?? null;
	    const blockedByDingque = bestSummary ? !!bestSummary.blockedByDingque : false;
	    const bestDiscardText = best !== null ? tileCode(best) : '--';
	    const canContinue = snap.wallRemaining > 0;
    const rangeMin = canContinue ? bestBranch?.valueMin ?? 0 : 0;
    const rangeMax = canContinue ? bestBranch?.valueMax ?? 0 : 0;
    // 海底（墙剩 0）下：碰只会多一次强制弃牌，不会再进入新摸牌分支；收益按 0 处理。
    const worstShanten = canContinue ? bestBranch?.summary?.shanten ?? Infinity : Infinity;

    return {
      kind: 'claimPeng',
      key: `claim:${pending.id}:peng:${tileKey}`,
      label: `碰${tileCode(tileKey)} · 弃${bestDiscardText}`,
      displayValue: formatGainRange(rangeMin, rangeMax),
      score: midpoint(rangeMin, rangeMax),
      tileKey,
      rangeMin,
      rangeMax,
      worstShanten,
      bestDiscardTileKey: best,
      bestRoute,
      bestSummary,
      blockedByDingque,
      publicCountsAfter: nextPublicCounts,
    };
  }

  private evaluateClaimGangContinuation(
    snap: SplitSnapshot,
    nextMelds: Array<CalcMeld>,
    nextPublicCounts: Array<number>,
    nextCounts14: Array<number>,
    drawTile: number,
  ): { gainMin: number; gainMax: number; discardTileKey: number | null; shanten: number } {
    const remCounts = snap.remCounts.slice();
    remCounts[drawTile] = Math.max(0, (remCounts[drawTile] ?? 0) - 1);
    const wallRemaining = Math.max(0, snap.wallRemaining - 1);
    const unknownPoolSize = Math.max(0, snap.unknownPoolSize - 1);
    const stage = computeSplitStage(wallRemaining);
    const tempSnap: SplitSnapshot = {
      ...snap,
      melds: nextMelds,
      handCounts14: nextCounts14,
      publicCounts: nextPublicCounts,
      remCounts,
      wallRemaining,
      unknownPoolSize,
      stage,
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
    const discard = this.buildDiscardAction(tempSnap, analyzers);
    const bestTileKey = discard.bestTileKey;
    const bestBranch = bestTileKey !== null ? discard.branches.get(bestTileKey) ?? null : null;
    // 杠后补到最后一张（墙剩 0）时，弃牌后不再进入新摸牌分支，后续收益按 0 处理。
    const canContinue = wallRemaining > 0;
    const gainMin = canContinue ? bestBranch?.valueMin ?? 0 : 0;
    const gainMax = canContinue ? bestBranch?.valueMax ?? 0 : 0;
    const shanten = bestBranch?.summary?.shanten ?? Infinity;
    return { gainMin, gainMax, discardTileKey: bestTileKey, shanten };
  }

  private buildClaimMingGangAction(
    snap: SplitSnapshot,
    pending: BloodPendingClaim,
  ): Extract<SplitClaimAction, { kind: 'claimMingGang' }> | null {
    // 血战规则：杠后必须能补张；墙剩 0 时不生成（见 docs/归档/拆牌-Claim响应动作推荐-20260315.md Q9）。
    if (snap.wallRemaining === 0) return null;
    const tileKey = pending.tileKey;
    const take = snap.handCounts14[tileKey] ?? 0;
    if (take < 3) return null;
    if (suitOf(tileKey) === snap.myDingque) return null;

    const nextCountsBase = snap.handCounts14.slice();
    nextCountsBase[tileKey] = Math.max(0, (nextCountsBase[tileKey] ?? 0) - 3);
    const nextMelds: Array<CalcMeld> = [...snap.melds, { kind: 'gang', tileKey, gangType: 'ming' }];
    // publicCounts：pending tile 已在 discard 里计入 1；明杠后变为 4，因此 +3。
    const nextPublicCounts = snap.publicCounts.slice();
    nextPublicCounts[tileKey] = (nextPublicCounts[tileKey] ?? 0) + 3;

    const immediateGain = snap.base * 2;
    const outcomes: Array<SplitClaimGangDrawOutcome> = [];
    let zeroRemain = 0;
    let gainMin = Infinity;
    let gainMax = 0;
    let worstShanten = Number.NEGATIVE_INFINITY;
    let kaihuaKindCount = 0;
    let kaihuaTileCount = 0;
    const shantenMap = new Map<number, { kindCount: number; tileCount: number }>();

    for (let drawTile = 0; drawTile < 27; drawTile++) {
      const remain = snap.remCounts[drawTile] ?? 0;
      if (remain <= 0) continue;

      const nextCounts14 = nextCountsBase.slice();
      nextCounts14[drawTile] = (nextCounts14[drawTile] ?? 0) + 1;

      let gain = 0;
      let gainRangeMin = 0;
      let gainRangeMax = 0;
      let multiplier = 0;
      let discardTileKey: number | null = null;
      let shanten: number | null = null;

      if (!hasDingqueTileInCounts(nextCounts14, snap.myDingque)) {
        const calc = calcBloodHu(
          { concealedTiles: tilesFromCounts(nextCounts14), melds: nextMelds },
          {
            base: snap.base,
            cap: snap.cap,
            huMethod: 'zimo',
            remainingOpponents: snap.aliveOpponents,
            events: { gangShangKaiHua: true },
          },
        );
        if (calc.ok) {
          gain = Math.trunc(calc.winnerGain);
          gainRangeMin = gain;
          gainRangeMax = gain;
          multiplier = Math.trunc(calc.multiplierCapped);
          outcomes.push({
            kind: 'kaihua',
            tileKey: drawTile,
            remain,
            gain,
            gainMin: gain,
            gainMax: gain,
            multiplier,
            discardTileKey: null,
            shanten: null,
          });
          kaihuaKindCount += 1;
          kaihuaTileCount += remain;
        } else {
          const follow = this.evaluateClaimGangContinuation(snap, nextMelds, nextPublicCounts, nextCounts14, drawTile);
          gainRangeMin = follow.gainMin;
          gainRangeMax = follow.gainMax;
          discardTileKey = follow.discardTileKey;
          shanten = Number.isFinite(follow.shanten) ? follow.shanten : Infinity;
          gain = midpoint(gainRangeMin, gainRangeMax);
          if (gain > 0 || gainRangeMax > 0) {
            outcomes.push({
              kind: 'continue',
              tileKey: drawTile,
              remain,
              gain,
              gainMin: gainRangeMin,
              gainMax: gainRangeMax,
              multiplier: 0,
              discardTileKey,
              shanten,
            });
          }
        }
      } else {
        const follow = this.evaluateClaimGangContinuation(snap, nextMelds, nextPublicCounts, nextCounts14, drawTile);
        gainRangeMin = follow.gainMin;
        gainRangeMax = follow.gainMax;
        discardTileKey = follow.discardTileKey;
        shanten = Number.isFinite(follow.shanten) ? follow.shanten : Infinity;
        gain = midpoint(gainRangeMin, gainRangeMax);
        if (gain > 0 || gainRangeMax > 0) {
          outcomes.push({
            kind: 'continue',
            tileKey: drawTile,
            remain,
            gain,
            gainMin: gainRangeMin,
            gainMax: gainRangeMax,
            multiplier: 0,
            discardTileKey,
            shanten,
          });
        }
      }

      if (shanten !== null && Number.isFinite(shanten)) {
        worstShanten = Math.max(worstShanten, shanten);
        const prev = shantenMap.get(shanten) ?? { kindCount: 0, tileCount: 0 };
        shantenMap.set(shanten, { kindCount: prev.kindCount + 1, tileCount: prev.tileCount + remain });
      }

      if (gain <= 0 && gainRangeMax <= 0) zeroRemain += remain;
      if (gainRangeMin < gainMin) gainMin = gainRangeMin;
      if (gainRangeMax > gainMax) gainMax = gainRangeMax;
    }

    if (!Number.isFinite(gainMin)) gainMin = 0;
    if (!Number.isFinite(worstShanten) || worstShanten < 0) worstShanten = 0;
    const totalMin = immediateGain + gainMin;
    const totalMax = immediateGain + gainMax;

    outcomes.sort((a, b) => {
      if (b.remain !== a.remain) return b.remain - a.remain;
      return a.tileKey - b.tileKey;
    });

    const shantenBuckets = Array.from(shantenMap.entries())
      .map(([shanten, v]) => ({ shanten, kindCount: v.kindCount, tileCount: v.tileCount }))
      .sort((a, b) => a.shanten - b.shanten);

    return {
      kind: 'claimMingGang',
      key: `claim:${pending.id}:mingGang:${tileKey}`,
      label: `明杠${tileCode(tileKey)}`,
      displayValue: formatGainRange(totalMin, totalMax),
      score: midpoint(totalMin, totalMax),
      tileKey,
      immediateGain,
      gainMin: totalMin,
      gainMax: totalMax,
      outcomes,
      zeroRemain,
      worstShanten,
      kaihuaKindCount,
      kaihuaTileCount,
      shantenBuckets,
    };
  }

  private buildClaimActions(snap: SplitSnapshot, pending: BloodPendingClaim): Array<SplitClaimAction> {
    const seat = snap.seat;
    const opt = pending.options?.[seat] ?? { hu: false, peng: false, gang: false };
    const hu = opt.hu ? this.buildClaimHuAction(snap, pending) : null;
    const mingGang = opt.gang ? this.buildClaimMingGangAction(snap, pending) : null;
    const peng = opt.peng ? this.buildClaimPengAction(snap, pending) : null;
    const pass = this.buildClaimPassAction(snap, pending);

    const nonHu: Array<Exclude<SplitClaimAction, { kind: 'claimHu' }>> = [];
    if (mingGang) nonHu.push(mingGang);
    if (peng) nonHu.push(peng);
    nonHu.push(pass);

	    const kindOrder = (action: Exclude<SplitClaimAction, { kind: 'claimHu' }>): number => {
	      if (action.kind === 'claimMingGang') return 0;
	      if (action.kind === 'claimPeng') return 1;
	      return 2; // pass
	    };
	    nonHu.sort((a, b) => {
	      if (a.worstShanten !== b.worstShanten) return a.worstShanten - b.worstShanten;
	      if (b.score !== a.score) return b.score - a.score;
	      if (kindOrder(a) !== kindOrder(b)) return kindOrder(a) - kindOrder(b);
	      return a.key.localeCompare(b.key);
	    });

    if (hu) return [hu, ...nonHu];
    return nonHu;
  }

  private pickRecommendedAction(actions: ReadonlyArray<SplitAction>, mode: 'turn' | 'claim'): SplitAction | null {
    if (actions.length === 0) return null;
    // 口径：只要可胡，永远推荐胡（turn=自摸；claim=点炮/抢杠胡），不和其他动作用同一标尺硬比。
    if (mode === 'turn') {
      const hu = actions.find((a) => a.kind === 'hu') ?? null;
      if (hu) return hu;
    } else {
      const hu = actions.find((a) => a.kind === 'claimHu') ?? null;
      if (hu) return hu;
    }

    const kindOrder = (action: SplitAction): number => {
      if (mode === 'turn') {
        if (action.kind === 'gang') return action.gangType === 'an' ? 0 : 1;
        if (action.kind === 'discard') return 2;
        return 3;
      }
      // claim 同分兜底：明杠 > 碰 > 过（见 docs/归档/拆牌-Claim响应动作推荐-20260315.md Q8）
      if (action.kind === 'claimMingGang') return 0;
      if (action.kind === 'claimPeng') return 1;
      if (action.kind === 'claimPass') return 2;
      return 3;
    };

    const worstShanten = (action: SplitAction): number => {
      if (action.kind === 'claimMingGang' || action.kind === 'claimPeng' || action.kind === 'claimPass') return action.worstShanten;
      return 0;
    };

	    return (
	      actions
	        .slice()
	        .sort((a, b) => {
	          if (mode === 'claim' && worstShanten(a) !== worstShanten(b)) return worstShanten(a) - worstShanten(b);
	          if (b.score !== a.score) return b.score - a.score;
	          if (kindOrder(a) !== kindOrder(b)) return kindOrder(a) - kindOrder(b);
	          return a.key.localeCompare(b.key);
	        })[0] ?? null
	    );
	  }

  private resolveSelectedAction(actions: ReadonlyArray<SplitAction>, mode: 'turn' | 'claim', forceRecommended = false): SplitAction | null {
    const recommended = this.pickRecommendedAction(actions, mode);
    if (!recommended) {
      this.selectedActionKey = null;
      return null;
    }
    if (!forceRecommended && this.selectedActionKey) {
      const found = actions.find((action) => action.key === this.selectedActionKey) ?? null;
      if (found) return found;
    }
    this.selectedActionKey = recommended.key;
    return recommended;
  }

  private renderTileRow(tiles: ReadonlyArray<number>, className: string): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = className;
    for (const tileKey of tiles) {
      wrap.appendChild(tileImg(tileKey, 'split-action-tile'));
    }
    return wrap;
  }

  private buildSwap3Actions(snap: SplitSnapshot): Array<SplitSwap3Action> {
    const reco = recommendSwap3ByStructure({ handCounts: snap.handCounts14 });
    const handKey = handCountsKey(snap.handCounts14);
    return reco.ranked.slice(0, 20).map((detail) => ({
      kind: 'swap3',
      key: `swap3:${handKey}:${detail.tiles.join('-')}`,
      tiles: detail.tiles,
      structureLoss: detail.structureLoss,
      isolatedCount: detail.isolatedCount,
      detail,
    }));
  }

  private getCachedSwap3Actions(snap: SplitSnapshot): Array<SplitSwap3Action> {
    const cached = this.swap3ActionsCache;
    if (cached && cached.snap === snap) return cached.actions;
    const actions = this.buildSwap3Actions(snap);
    this.swap3ActionsCache = { snap, actions };
    return actions;
  }

  private buildSwap3ExplainTags(action: SplitSwap3Action): Array<string> {
    const tags: Array<string> = [];
    const detail = action.detail;
    if (detail.breakMeldCount > 0) tags.push(`拆成型结构${detail.breakMeldCount}组`);
    else tags.push('尽量不拆成型结构');
    if (detail.feedRiskTier === 'meld') tags.push('送成型牌风险高');
    else if (detail.feedRiskTier === 'pair') tags.push('送对子风险');
    else if (detail.feedRiskTier === 'ryanmen') tags.push('送两面搭子风险');
    else if (detail.feedRiskTier === 'taatsu') tags.push('送边嵌搭子风险');
    else tags.push('送牌风险低');
    if (detail.kongLoss > 0) tags.push('损失杠潜力');
    if (detail.pairLoss > 0) tags.push('损失将牌潜力');
    if (detail.isolatedCount > 0) tags.push(`孤张${detail.isolatedCount}`);
    return tags;
  }

  private renderSwap3ActionExplain(action: SplitSwap3Action): HTMLElement {
    const box = document.createElement('div');
    box.className = 'split-metrics';
    this.applyFrameAccent(box, this.buildFrameSeed([151, action.structureLoss, action.isolatedCount]), 1);

    const title = document.createElement('div');
    title.className = 'split-detail-discard';
    title.appendChild(document.createTextNode('换'));
    title.appendChild(this.renderTileRow(action.tiles, 'split-inline-tiles'));
    title.appendChild(
      document.createTextNode(
        ` · 结构损失${action.structureLoss} · 孤张${action.isolatedCount}`,
      ),
    );
    box.appendChild(title);

    const detail = action.detail;
    const line1 = document.createElement('div');
    line1.className = 'split-row-text';
    line1.textContent = `原结构分${detail.before.score} · 换后结构分${detail.after.score} · 结构损失${detail.structureLoss}`;
    box.appendChild(line1);

    const line2 = document.createElement('div');
    line2.className = 'split-row-text';
    line2.textContent = `面子${detail.before.meldCount}->${detail.after.meldCount} · 搭子${detail.before.taatsuCount}->${detail.after.taatsuCount} · 对子${detail.before.pairCount}->${detail.after.pairCount}`;
    box.appendChild(line2);

    const line3 = document.createElement('div');
    line3.className = 'split-row-text';
    line3.textContent = this.buildSwap3ExplainTags(action).join(' · ');
    box.appendChild(line3);
    return box;
  }

  private renderSwap3ActionAccordion(
    actions: ReadonlyArray<SplitSwap3Action>,
    opened: SplitSwap3Action | null,
    reco?: { chosenActionKey: string | null; engineTop1ActionKey: string | null },
  ): void {
    this.actionBar.innerHTML = '';
    if (actions.length === 0) {
      this.actionBar.classList.add('hidden');
      return;
    }

    this.actionBar.classList.remove('hidden');
    this.actionBar.classList.add('is-claim');
    this.actionBar.classList.toggle('is-historical', this.actionsHistorical);
    if (this.actionsHistorical) {
      const note = document.createElement('span');
      note.className = 'split-action-note';
      note.textContent = '上次计算';
      this.actionBar.appendChild(note);
    }

    const recommended = reco?.chosenActionKey ? actions.find((a) => a.key === reco.chosenActionKey) ?? null : actions[0] ?? null;
    const engineTop1 = reco?.engineTop1ActionKey ? actions.find((a) => a.key === reco.engineTop1ActionKey) ?? null : actions[0] ?? null;
    for (const action of actions) {
      const item = document.createElement('details');
      item.className = 'split-claim-action';
      item.open = !!opened && opened.key === action.key;

      const summary = document.createElement('summary');
      summary.className = 'split-claim-action-summary';
      if (recommended && recommended.key === action.key) summary.classList.add('is-best');
      if (engineTop1 && engineTop1.key === action.key && recommended?.key !== engineTop1.key) summary.classList.add('is-engine');
      summary.dataset.splitAction = action.key;

      const label = document.createElement('span');
      label.className = 'split-action-label';
      label.appendChild(document.createTextNode('换'));
      label.appendChild(this.renderTileRow(action.tiles, 'split-inline-tiles'));
      summary.appendChild(label);

      const loss = document.createElement('span');
      loss.className = 'split-action-meta';
      loss.textContent = `结构损失${action.structureLoss}`;
      summary.appendChild(loss);

      const value = document.createElement('span');
      value.className = 'split-action-value';
      value.textContent = `孤张${action.isolatedCount}`;
      summary.appendChild(value);

      item.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'split-claim-action-body';
      if (item.open) body.appendChild(this.renderSwap3ActionExplain(action));
      item.appendChild(body);

      item.addEventListener('toggle', () => {
        if (this.actionsHistorical) {
          item.open = false;
          return;
        }
        if (item.open) this.selectedActionKey = action.key;
        else if (this.selectedActionKey === action.key) this.selectedActionKey = null;
        this.render();
      });

      this.actionBar.appendChild(item);
    }
  }

  private startDingqueActionsCompute(snap: SplitSnapshot): void {
    const token = (this.dingqueComputeToken += 1);
    const handKey = handCountsKey(snap.handCounts14);
    const suitCounts = countSuitTiles(snap.handCounts14);
    const accums: Array<DingqueSuitRolloutAccum> = [];
    for (const suit of BLOOD_SUITS) {
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
    const job: DingqueComputeJob = { token, snap, handKey, accums, accIndex: 0 };
    this.dingqueComputeJob = job;
    this.scheduleDingqueActionsCompute(job);
  }

  private scheduleDingqueActionsCompute(job: DingqueComputeJob): void {
    const cb = (deadline?: { timeRemaining?: () => number }) => {
      if (this.dingqueComputeJob !== job) return;
      this.stepDingqueActionsCompute(job, deadline);
    };
    const idle = (window as any).requestIdleCallback as undefined | ((fn: (d: any) => void, opts?: { timeout?: number }) => number);
    if (typeof idle === 'function') {
      idle(cb, { timeout: 200 });
      return;
    }
    window.setTimeout(() => cb(), 0);
  }

  private finalizeDingqueAccum(job: DingqueComputeJob, accum: DingqueSuitRolloutAccum): SplitDingqueAction | null {
    if (accum.used <= 0) return null;
    const route: SplitRoute = accum.sevenCount > accum.standardCount ? 'sevenPairs' : 'standard';
    const summary = route === 'sevenPairs' ? accum.sevenPick ?? accum.standardPick : accum.standardPick ?? accum.sevenPick;
    if (!summary) return null;
    return {
      kind: 'dingque',
      key: `dingque:${job.handKey}:${accum.suit}`,
      suit: accum.suit,
      clearCount: accum.clearCount,
      keepScore: accum.keepScore,
      shanten: accum.shantenSum / accum.used,
      improveCount: accum.improveCountSum / accum.used,
      improveKinds: accum.improveKindsSum / accum.used,
      postClearUnknownPoolSize: accum.postClearUnknownPoolSizeSum / accum.used,
      postClearCanDraw: accum.postClearCanDraw,
      route,
      summary,
    };
  }

  private stepDingqueActionsCompute(job: DingqueComputeJob, deadline?: { timeRemaining?: () => number }): void {
    if (this.dingqueComputeJob !== job || this.dingqueComputeJob.token !== job.token) return;
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    const hardDeadline = now + 8;
    while (true) {
      const remaining = typeof deadline?.timeRemaining === 'function' ? deadline.timeRemaining() : null;
      const t = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
      if (remaining !== null ? remaining <= 1 : t >= hardDeadline) break;

      while (job.accIndex < job.accums.length && job.accums[job.accIndex]!.i >= job.accums[job.accIndex]!.samples) {
        job.accIndex += 1;
      }
      if (job.accIndex >= job.accums.length) break;
      const accum = job.accums[job.accIndex]!;
      const outcome = this.runDingqueRollout(job.snap, accum.suit, accum.initialState, accum.rng);
      accum.i += 1;
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

    if (job.accIndex < job.accums.length) {
      this.scheduleDingqueActionsCompute(job);
      return;
    }

	    const actions = job.accums.map((accum) => this.finalizeDingqueAccum(job, accum)).filter((row): row is SplitDingqueAction => !!row);
	    actions.sort((a, b) => {
	      // dingque v1：先看清缺成本（清缺越快越优先），再看该门保留值（越弱越适合作为缺门），最后才看清缺后的强度指标。
	      if (a.clearCount !== b.clearCount) return a.clearCount - b.clearCount;
	      if (a.keepScore !== b.keepScore) return a.keepScore - b.keepScore;
	      if (a.shanten !== b.shanten) return a.shanten - b.shanten;
	      if (b.improveCount !== a.improveCount) return b.improveCount - a.improveCount;
	      if (b.improveKinds !== a.improveKinds) return b.improveKinds - a.improveKinds;
	      return BLOOD_SUITS.indexOf(a.suit) - BLOOD_SUITS.indexOf(b.suit);
	    });

    if (this.snapshot === job.snap) {
      this.dingqueActionsCache = { snap: job.snap, actions };
    }
    this.dingqueComputeJob = null;
    this.render();
  }

  private getCachedDingqueActions(snap: SplitSnapshot): Array<SplitDingqueAction> | null {
    const cached = this.dingqueActionsCache;
    if (cached && cached.snap === snap) return cached.actions;
    if (this.dingqueComputeJob?.snap === snap) return null;
    this.dingqueActionsCache = null;
    this.startDingqueActionsCompute(snap);
    return null;
  }

  private cloneSplitSnapshotForHistory(snap: SplitSnapshot): SplitSnapshot {
    return {
      ...snap,
      melds: snap.melds.map((m) => ({ ...(m as any) })),
      handTilesOrdered: snap.handTilesOrdered.map((t) => ({ tileKey: t.tileKey, isExtra: !!t.isExtra })),
      handCounts14: snap.handCounts14.slice(),
      publicCounts: snap.publicCounts.slice(),
      remCounts: snap.remCounts.slice(),
      opponents: snap.opponents.map((o) => ({ dingque: o.dingque, hu: !!o.hu })),
    };
  }

  private updateTurnDiscardHistory(params: {
    snap: SplitSnapshot;
    discardAction: Extract<SplitTurnAction, { kind: 'discard' }>;
    analyzers: SplitAnalyzerSet;
    chosenDiscardTileKey: number | null;
    engineTop1DiscardTileKey: number | null;
    ctx: RecoUiContext | null;
    resolution: RecoResolution | null;
    chosenCandidateId: string | null;
  }): void {
    const gid = this.client.gameId();
    if (!gid) return;
    const next: TurnDiscardHistory = {
      gameId: gid,
      seat: params.snap.seat,
      updatedAt: Date.now(),
      snap: this.cloneSplitSnapshotForHistory(params.snap),
      discardAction: params.discardAction,
      analyzers: params.analyzers,
      chosenDiscardTileKey: params.chosenDiscardTileKey,
      engineTop1DiscardTileKey: params.engineTop1DiscardTileKey,
      ctx: params.ctx,
      resolution: params.resolution,
      chosenCandidateId: params.chosenCandidateId,
    };
	    const prev = this.turnDiscardHistory;
	    const prevKey = prev?.ctx?.decisionKey ?? null;
	    const nextKey = params.ctx?.decisionKey ?? null;
	    const prevRes = prev?.resolution ?? null;
	    const nextRes = next.resolution ?? null;
	    const sameResolution =
	      prevRes === null
	        ? nextRes === null
	        : nextRes !== null &&
	          prevRes.chosen_candidate_id === nextRes.chosen_candidate_id &&
	          prevRes.source === nextRes.source &&
	          prevRes.llm_used === nextRes.llm_used &&
	          prevRes.fallback_reason === nextRes.fallback_reason &&
	          prevRes.confidence_final === nextRes.confidence_final;
	    if (
	      prev &&
	      prev.gameId === next.gameId &&
	      prev.seat === next.seat &&
	      prevKey === nextKey &&
	      prev.snap.wallRemaining === next.snap.wallRemaining &&
	      prev.chosenCandidateId === next.chosenCandidateId &&
	      sameResolution
	    ) {
	      return;
	    }
	    this.turnDiscardHistory = next;
	  }

  private getTurnDiscardHistoryForCurrentGame(snap: SplitSnapshot | null): TurnDiscardHistory | null {
    const hist = this.turnDiscardHistory;
    if (!hist) return null;
    const gid = this.client.gameId();
    if (!gid || hist.gameId !== gid) return null;
    if (snap && hist.seat !== snap.seat) return null;
    return hist;
  }

  private renderDingqueActionExplain(_snap: SplitSnapshot, action: SplitDingqueAction): HTMLElement {
    const box = document.createElement('div');
    box.className = 'split-metrics';
    this.applyFrameAccent(box, this.buildFrameSeed([173, action.clearCount, action.shanten, action.improveCount]), 1);

    const title = document.createElement('div');
    title.className = 'split-subtitle';
    title.textContent = `缺${suitText(action.suit)}详情`;
    box.appendChild(title);

    const line1 = document.createElement('div');
    line1.className = 'split-row-text';
    const improveCount = this.formatDingqueMetric(action.improveCount);
    const improveKinds = this.formatDingqueMetric(action.improveKinds);
    line1.textContent = `清缺${action.clearCount}张 · 清缺后${this.formatDingqueShanten(action.shanten)}向听 · 进张${improveCount}(${improveKinds}种) · ${formatApproxRatio(improveCount, action.postClearUnknownPoolSize, action.postClearCanDraw)}`;
    box.appendChild(line1);

    const line2 = document.createElement('div');
    line2.className = 'split-row-text';
    line2.textContent = action.route === 'sevenPairs' ? '清缺后按七对口径评估' : '清缺后按标准口径评估';
    box.appendChild(line2);

    const noteRow = document.createElement('div');
    noteRow.className = 'split-row-text';
    noteRow.textContent =
      action.clearCount > 0
        ? `当前仍需清缺${action.clearCount}张；后续每次摸牌后，系统会按当时手牌重新计算先清哪张。`
        : '当前无需清缺；进入出牌阶段后可直接按拆牌推荐决策。';
    box.appendChild(noteRow);
    return box;
  }

  private renderDingqueActionAccordion(
    snap: SplitSnapshot,
    actions: ReadonlyArray<SplitDingqueAction>,
    opened: SplitDingqueAction | null,
    reco?: { chosenActionKey: string | null; engineTop1ActionKey: string | null },
  ): void {
    this.actionBar.innerHTML = '';
    if (actions.length === 0) {
      this.actionBar.classList.add('hidden');
      return;
    }

    this.actionBar.classList.remove('hidden');
    this.actionBar.classList.add('is-claim');
    this.actionBar.classList.toggle('is-historical', this.actionsHistorical);
    if (this.actionsHistorical) {
      const note = document.createElement('span');
      note.className = 'split-action-note';
      note.textContent = '上次计算';
      this.actionBar.appendChild(note);
    }

    const recommended = reco?.chosenActionKey ? actions.find((a) => a.key === reco.chosenActionKey) ?? null : actions[0] ?? null;
    const engineTop1 = reco?.engineTop1ActionKey ? actions.find((a) => a.key === reco.engineTop1ActionKey) ?? null : actions[0] ?? null;
    for (const action of actions) {
      const item = document.createElement('details');
      item.className = 'split-claim-action';
      item.open = !!opened && opened.key === action.key;

      const summary = document.createElement('summary');
      summary.className = 'split-claim-action-summary';
      if (recommended && recommended.key === action.key) summary.classList.add('is-best');
      if (engineTop1 && engineTop1.key === action.key && recommended?.key !== engineTop1.key) summary.classList.add('is-engine');
      summary.dataset.splitAction = action.key;

      const label = document.createElement('span');
      label.className = 'split-action-label';
      label.textContent = `缺${suitText(action.suit)}`;
      summary.appendChild(label);

      const clear = document.createElement('span');
      clear.className = 'split-action-meta';
      clear.textContent = `清缺${action.clearCount}张`;
      summary.appendChild(clear);

      const shanten = document.createElement('span');
      shanten.className = 'split-action-shanten';
      shanten.textContent = `清缺后${this.formatDingqueShanten(action.shanten)}向听`;
      summary.appendChild(shanten);

      const value = document.createElement('span');
      value.className = 'split-action-value';
      const improveCount = this.formatDingqueMetric(action.improveCount);
      const improveKinds = this.formatDingqueMetric(action.improveKinds);
      value.textContent = `进张${improveCount}(${improveKinds}种) · ${formatApproxRatio(improveCount, action.postClearUnknownPoolSize, action.postClearCanDraw)}`;
      summary.appendChild(value);

      item.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'split-claim-action-body';
      if (item.open) body.appendChild(this.renderDingqueActionExplain(snap, action));
      item.appendChild(body);

      item.addEventListener('toggle', () => {
        if (this.actionsHistorical) {
          item.open = false;
          return;
        }
        if (item.open) this.selectedActionKey = action.key;
        else if (this.selectedActionKey === action.key) this.selectedActionKey = null;
        this.render();
      });

      this.actionBar.appendChild(item);
    }
  }

  private renderClaimPengMetricsLine(snap: SplitSnapshot, action: Extract<SplitClaimAction, { kind: 'claimPeng' }>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'split-action-detail';

    const box = document.createElement('div');
    box.className = 'split-metrics';
    this.applyFrameAccent(box, this.buildFrameSeed([107, action.tileKey, action.rangeMin, action.rangeMax]), 1);

    if (action.blockedByDingque) {
      const warn = document.createElement('div');
      warn.className = 'split-warn';
      warn.textContent = '仍有定缺牌：建议先清缺（缺门牌不能碰/杠/胡），本页暂不计算向听/进张。';
      wrap.appendChild(box);
      wrap.appendChild(warn);
      return wrap;
    }

    const sum = action.bestSummary;
    const u = sum?.tenpai ? sum.tenpai.winCount : sum?.improve?.improveCount ?? 0;
    const k = sum?.tenpai ? sum.tenpai.winKinds : sum?.improve?.improveKinds ?? 0;
    const estimateText = sum?.tenpai ? `平均点炮=${Math.round(sum.tenpai.avgRonGain)}` : `预估点炮区间=${formatGainRange(action.rangeMin, action.rangeMax)}`;

    const safetySnap: SplitSnapshot = { ...snap, publicCounts: action.publicCountsAfter };
    const safety =
      action.bestDiscardTileKey !== null
        ? this.computeSafetyParts(safetySnap, action.bestDiscardTileKey)
        : { safeText: '--', familiarCount: 0, wallCount: 0, sujiCount: 0 };

    const fields: Array<string> = [];
    fields.push(`${sum?.shanten ?? '--'}向听`);
    fields.push(`进张${u}(${k}种)`);
    fields.push(formatApproxRatio(u, snap.unknownPoolSize, snap.wallRemaining > 0));
    fields.push(estimateText);
    if (action.bestRoute === 'standard' && sum && Number.isFinite(sum.windowScore)) fields.push(`窗口分${sum.windowScore}`);
    fields.push(`安全分${safety.safeText}·熟↑${safety.familiarCount}·壁↑${safety.wallCount}·筋↑${safety.sujiCount}`);

    const line = document.createElement('div');
    line.className = 'split-row-text';
    line.textContent = fields.join(' · ');
    box.appendChild(line);
    wrap.appendChild(box);
    return wrap;
  }

  private renderClaimActionExplain(snap: SplitSnapshot, pending: BloodPendingClaim, action: SplitClaimAction): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'split-claim-action-explain';

    if (action.kind === 'claimHu') {
      wrap.appendChild(this.renderClaimHuDetail(pending, action));
    } else if (action.kind === 'claimMingGang') {
      wrap.appendChild(this.renderClaimMingGangDetail(action));
    } else if (action.kind === 'claimPeng') {
      wrap.appendChild(this.renderClaimPengMetricsLine(snap, action));
    } else {
      // claimPass
      wrap.appendChild(this.renderClaimPassDetail(snap, action));
    }
    return wrap;
  }

  private renderClaimActionAccordion(
    snap: SplitSnapshot,
    pending: BloodPendingClaim,
    actions: ReadonlyArray<SplitClaimAction>,
    opened: SplitClaimAction | null,
    reco?: { chosenActionKey: string | null; engineTop1ActionKey: string | null },
  ): void {
    this.actionBar.innerHTML = '';
    if (actions.length === 0) {
      this.actionBar.classList.add('hidden');
      return;
    }

    this.actionBar.classList.remove('hidden');
    this.actionBar.classList.add('is-claim');
    this.actionBar.classList.toggle('is-historical', this.actionsHistorical);
    if (this.actionsHistorical) {
      const note = document.createElement('span');
      note.className = 'split-action-note';
      note.textContent = '上次计算';
      this.actionBar.appendChild(note);
    }

    const recommended = reco?.chosenActionKey
      ? actions.find((a) => a.key === reco.chosenActionKey) ?? null
      : this.pickRecommendedAction(actions, 'claim');
    const engineTop1 = reco?.engineTop1ActionKey ? actions.find((a) => a.key === reco.engineTop1ActionKey) ?? null : null;
    for (const action of actions) {
      if (action.kind === 'claimHu') {
        const item = document.createElement('div');
        item.className = 'split-claim-action';

        const summary = document.createElement('div');
        summary.className = 'split-claim-action-summary is-static';
        if (recommended && recommended.key === action.key) summary.classList.add('is-best');
        if (engineTop1 && engineTop1.key === action.key && recommended?.key !== engineTop1.key) summary.classList.add('is-engine');

        const label = document.createElement('span');
        label.className = 'split-action-label';
        label.appendChild(document.createTextNode(action.label));
        label.appendChild(document.createTextNode(relativeSeatText(snap.seat, pending.fromSeat)));
        label.appendChild(tileImg(pending.tileKey, 'split-action-tile'));

        const trigger = pending.trigger ?? 'discard';
        const isQiangGangHu = trigger === 'addKong';
        const isGangShangPao = trigger === 'discard' && Boolean(pending.afterGang);
        const huKind = document.createElement('span');
        huKind.className = 'split-action-meta';
        huKind.textContent = isQiangGangHu ? '抢杠' : isGangShangPao ? '杠上炮' : '点炮';
        label.appendChild(huKind);

        const fans = formatFansLine(action.calc.fans);
        if (fans !== '--') {
          const fanText = document.createElement('span');
          fanText.className = 'split-action-meta';
          fanText.textContent = fans;
          label.appendChild(fanText);
        }

        const mult = document.createElement('span');
        mult.className = 'split-action-meta';
        mult.textContent = `${action.calc.multiplierCapped}倍`;
        label.appendChild(mult);

        summary.appendChild(label);

        const value = document.createElement('span');
        value.className = 'split-action-value';
        value.textContent = action.displayValue;
        summary.appendChild(value);

        item.appendChild(summary);
        this.actionBar.appendChild(item);
        continue;
      }

      const item = document.createElement('details');
      item.className = 'split-claim-action';
      item.open = !!opened && opened.key === action.key;

      const summary = document.createElement('summary');
      summary.className = 'split-claim-action-summary';
      if (item.open) summary.classList.add('active');
      if (recommended && recommended.key === action.key) summary.classList.add('is-best');
      if (engineTop1 && engineTop1.key === action.key && recommended?.key !== engineTop1.key) summary.classList.add('is-engine');
      summary.dataset.splitAction = action.key;

      const label = document.createElement('span');
      label.className = 'split-action-label';
      if (action.kind === 'claimPeng') {
        label.appendChild(document.createTextNode('碰'));
        label.appendChild(tileImg(action.tileKey, 'split-action-tile'));
        label.appendChild(document.createTextNode('弃'));
        if (action.bestDiscardTileKey !== null) {
          label.appendChild(tileImg(action.bestDiscardTileKey, 'split-action-tile'));
        } else {
          const empty = document.createElement('span');
          empty.className = 'split-action-unknown';
          empty.textContent = '--';
          label.appendChild(empty);
        }
      } else if (action.kind === 'claimMingGang') {
        label.appendChild(document.createTextNode('明杠'));
        label.appendChild(tileImg(action.tileKey, 'split-action-tile'));
      } else {
        label.textContent = action.label;
      }
      summary.appendChild(label);

      const shantenText = (() => {
        if (action.kind === 'claimPeng') {
          if (action.blockedByDingque) return '--向听';
          const sh = action.bestSummary?.shanten ?? null;
          if (sh !== null && Number.isFinite(sh)) return `${sh}向听`;
          if (Number.isFinite(action.worstShanten)) return `${action.worstShanten}向听`;
          return '--向听';
        }
        if (action.kind === 'claimPass') {
          if (action.blockedByDingque) return '--向听';
          const sh = action.summary?.shanten ?? null;
          if (sh !== null && Number.isFinite(sh)) return `${sh}向听`;
          if (Number.isFinite(action.worstShanten)) return `${action.worstShanten}向听`;
          return '--向听';
        }
        // claimMingGang
        if (Number.isFinite(action.worstShanten)) return `最坏${action.worstShanten}向听`;
        return '--向听';
      })();
      const shanten = document.createElement('span');
      shanten.className = 'split-action-shanten';
      shanten.textContent = shantenText;
      summary.appendChild(shanten);

      if (action.kind === 'claimPeng') {
        const canAddKong = (() => {
          // 碰后只能有“第4张仍可能存在 / 不可能存在”两种情况；墙剩 0 时不考虑加杠。
          if (snap.wallRemaining <= 0) return false;
          const take = snap.handCounts14[action.tileKey] ?? 0;
          const afterPengInHand = Math.max(0, take - 2);
          const discardSame = action.bestDiscardTileKey === action.tileKey ? 1 : 0;
          const inHandAfterDiscard = Math.max(0, afterPengInHand - discardSame);
          if (inHandAfterDiscard > 0) return true;
          return (snap.remCounts[action.tileKey] ?? 0) > 0;
        })();
        const kong = document.createElement('span');
        kong.className = 'split-action-kong';
        kong.textContent = canAddKong ? '可以加杠' : '不可加杠';
        summary.appendChild(kong);
      }

      const value = document.createElement('span');
      value.className = 'split-action-value';
      value.textContent = action.displayValue;
      summary.appendChild(value);

      item.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'split-claim-action-body';
      if (item.open) body.appendChild(this.renderClaimActionExplain(snap, pending, action));
      item.appendChild(body);

      item.addEventListener('toggle', () => {
        if (this.actionsHistorical) {
          item.open = false;
          return;
        }
        if (item.open) this.selectedActionKey = action.key;
        else if (this.selectedActionKey === action.key) this.selectedActionKey = null;
        this.render();
      });

      this.actionBar.appendChild(item);
    }
  }

  private renderActionBar(
    actions: ReadonlyArray<SplitAction>,
    selected: SplitAction | null,
    mode: 'turn' | 'claim',
    reco?: { chosenActionKey: string | null; engineTop1ActionKey: string | null },
  ): void {
    this.actionBar.innerHTML = '';
    const meaningfulActions = actions.filter((action) => action.kind !== 'discard');
    if (actions.length === 0) {
      this.actionBar.classList.add('hidden');
      return;
    }
    // turn 模式下“仅弃牌”时平时不展示动作条；但历史模式需要显式提示“上次计算”，避免误解为实时结果。
    if (meaningfulActions.length === 0) {
      if (!this.actionsHistorical) {
        this.actionBar.classList.add('hidden');
        return;
      }
      this.actionBar.classList.remove('hidden');
      this.actionBar.classList.toggle('is-claim', mode === 'claim');
      this.actionBar.classList.toggle('is-historical', true);
      const note = document.createElement('span');
      note.className = 'split-action-note';
      note.textContent = '上次计算';
      this.actionBar.appendChild(note);
      return;
    }

    this.actionBar.classList.remove('hidden');
    this.actionBar.classList.toggle('is-claim', mode === 'claim');
    this.actionBar.classList.toggle('is-historical', this.actionsHistorical);
    if (this.actionsHistorical) {
      const note = document.createElement('span');
      note.className = 'split-action-note';
      note.textContent = '上次计算';
      this.actionBar.appendChild(note);
    }
    const recommended = reco?.chosenActionKey ? actions.find((a) => a.key === reco.chosenActionKey) ?? null : this.pickRecommendedAction(actions, mode);
    const engineTop1 = reco?.engineTop1ActionKey ? actions.find((a) => a.key === reco.engineTop1ActionKey) ?? null : null;
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'split-action-btn';
      btn.disabled = this.actionsHistorical;
      if (selected && selected.key === action.key) btn.classList.add('active');
      if (recommended && recommended.key === action.key) btn.classList.add('is-best');
      if (engineTop1 && engineTop1.key === action.key && recommended?.key !== engineTop1.key) btn.classList.add('is-engine');
      btn.dataset.splitAction = action.key;
      btn.onclick = () => {
        if (this.actionsHistorical) return;
        this.selectedActionKey = action.key;
        if (action.kind !== 'discard') this.expandedCandidates.clear();
        this.render();
      };

      const label = document.createElement('span');
      label.className = 'split-action-label';
      if (action.kind === 'gang') {
        label.appendChild(document.createTextNode(action.gangType === 'an' ? '暗杠' : '加杠'));
        label.appendChild(tileImg(action.tileKey, 'split-action-tile'));
      } else {
        label.textContent = action.label;
      }
      btn.appendChild(label);

      const value = document.createElement('span');
      value.className = 'split-action-value';
      value.textContent = action.displayValue;
      btn.appendChild(value);

      this.actionBar.appendChild(btn);
    }
  }

  private rankCandidates(snap: SplitSnapshot, analyzers: SplitAnalyzerSet = this.analyzers): RankedCandidates {
    const activeRoute = this.getActiveRoute(snap, analyzers);
    const analyzer = this.getRouteAnalyzer(activeRoute, analyzers);
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

    // 非定缺阶段：候选 = 手牌全部不同 tileKey
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

  layout(): void {
    if (!this.open) return;
    const rect = this.anchorBtn.getBoundingClientRect();
    const gap = 8;
    const rootPos = window.getComputedStyle(this.root).position;

    const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

    const applyDocked = (bounds: { left: number; top: number; width: number; height: number }, btnLeft: number): void => {
      const viewportRatio = bounds.width / Math.max(1, bounds.height);
      const handRatio = computeHandViewportRatio(viewportRatio);
      const handHeight = Math.max(1, Math.floor(bounds.height * handRatio));
      const tableHeight = Math.max(1, Math.floor(bounds.height) - handHeight);
      const handTop = bounds.top + tableHeight;

      const right = btnLeft - gap;
      const rightClamped = clamp(right, bounds.left, bounds.left + bounds.width);
      const top = bounds.top;
      const height = Math.max(1, handTop - top);
      const availableWidth = Math.max(0, rightClamped - bounds.left);
      // 面板内容较长（指标逐步增加），桌面端给更宽的上限；移动端仍由 availableWidth 限制。
      const maxPanelWidth = 820;
      const width = availableWidth >= 260 ? Math.min(maxPanelWidth, availableWidth) : Math.max(1, availableWidth);
      const topClamped = clamp(top, bounds.top, bounds.top + bounds.height);

      this.panel.style.boxSizing = 'border-box';
      this.panel.style.left = `${rightClamped}px`;
      this.panel.style.top = `${topClamped}px`;
      this.panel.style.transform = 'translate(-100%, 0)';
      this.panel.style.width = `${Math.floor(width)}px`;
      // 高度跟随内容收缩，但仍不超过面板可用高度（maxHeight）。
      this.panel.style.height = 'auto';
      this.panel.style.maxHeight = `${Math.floor(height)}px`;

      // 指标说明：宽屏并排在左侧；窄屏降级为面板内“说明页”。
      this.helpSideBySide = false;
      this.helpPanel.classList.add('hidden');
      if (!this.helpOpen) return;

      const panelLeft = rightClamped - width;
      const minHelpWidth = 240;
      const maxHelpWidth = 320;
      const availableHelpWidth = panelLeft - gap - bounds.left;
      if (availableHelpWidth < minHelpWidth) return;

      const helpWidth = Math.min(maxHelpWidth, Math.floor(availableHelpWidth));
      this.helpSideBySide = true;
      this.helpPanel.classList.remove('hidden');
      this.helpPanel.style.boxSizing = 'border-box';
      this.helpPanel.style.left = `${panelLeft - gap}px`;
      this.helpPanel.style.top = `${topClamped}px`;
      this.helpPanel.style.transform = 'translate(-100%, 0)';
      this.helpPanel.style.width = `${helpWidth}px`;
      this.helpPanel.style.height = `${Math.floor(height)}px`;
      this.helpPanel.style.maxHeight = `${Math.floor(height)}px`;
    };

    if (rootPos === 'fixed') {
      const main = document.getElementById('main') as HTMLElement | null;
      if (main) {
        const stageRect = main.getBoundingClientRect();
        applyDocked({ left: stageRect.left, top: stageRect.top, width: stageRect.width, height: stageRect.height }, rect.left);
        this.updateFloatingHandPosition();
        return;
      }
      applyDocked({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }, rect.left);
      this.updateFloatingHandPosition();
      return;
    }

    const main = document.getElementById('main') as HTMLElement | null;
    if (!main) {
      applyDocked({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }, rect.left);
      this.updateFloatingHandPosition();
      return;
    }
    const stageRect = main.getBoundingClientRect();
    const stageW = main.clientWidth;
    const stageH = main.clientHeight;
    const scaleX = stageRect.width / Math.max(1, stageW);
    const invScaleX = Number.isFinite(scaleX) && scaleX > 1e-6 ? 1 / scaleX : 1;
    const left = (rect.left - stageRect.left) * invScaleX;
    applyDocked({ left: 0, top: 0, width: stageW, height: stageH }, left);
    this.updateFloatingHandPosition();
  }

  private refresh(openBest: boolean): void {
    if (!this.open) return;
    this.maybeRefreshAiSettings();
    const prevSnapshot = this.snapshot;
    this.swap3ActionsCache = null;
    this.dingqueActionsCache = null;
    this.dingqueComputeJob = null;
    this.snapshot = buildSnapshot(this.client, this.world);
    this.syncSwap3HistoricalSnapshot(this.snapshot, prevSnapshot);
    if (!this.snapshot.ok) {
      this.analyzers = {};
      this.statusEl.textContent = this.snapshot.reason ?? '当前不可拆牌';
      this.expandedCandidates.clear();
      this.actionsHistorical = true;
      this.render();
      return;
    }
    const canSelfClaimActNow = this.isSelfClaimWindow(this.snapshot) !== null;
    const canSelfSwap3ActNow = this.isSelfSwap3Window(this.snapshot);
    const canSelfDingqueActNow = this.isSelfDingqueWindow(this.snapshot);
    this.actionsHistorical = !(this.snapshot.canSelfTurnAct || canSelfClaimActNow || canSelfSwap3ActNow || canSelfDingqueActNow);
    if (this.snapshot.blood.phase === 'playing' && this.snapshot.myDingque) {
      this.analyzers = {
        standard: new SplitAnalyzer({
          route: 'standard',
          fixedMeldCount: this.snapshot.melds.length,
          melds: this.snapshot.melds,
          dingque: this.snapshot.myDingque,
          base: this.snapshot.base,
          cap: this.snapshot.cap,
          aliveOpponents: this.snapshot.aliveOpponents,
          unknownPoolSize: this.snapshot.unknownPoolSize,
          stage: this.snapshot.stage,
          publicCounts: this.snapshot.publicCounts,
          remCounts: this.snapshot.remCounts,
          opponents: this.snapshot.opponents,
        }),
        sevenPairs: new SplitAnalyzer({
          route: 'sevenPairs',
          fixedMeldCount: this.snapshot.melds.length,
          melds: this.snapshot.melds,
          dingque: this.snapshot.myDingque,
          base: this.snapshot.base,
          cap: this.snapshot.cap,
          aliveOpponents: this.snapshot.aliveOpponents,
          unknownPoolSize: this.snapshot.unknownPoolSize,
          stage: this.snapshot.stage,
          publicCounts: this.snapshot.publicCounts,
          remCounts: this.snapshot.remCounts,
          opponents: this.snapshot.opponents,
        }),
      };
      if (!this.getRouteAnalyzer('sevenPairs')?.isAvailable()) this.routeMode = 'standard';
    } else {
      this.analyzers = {};
    }
    if (openBest) {
      this.expandedCandidates.clear();
      this.selectedActionKey = null;
      this.render();
      return;
    }
    this.render();
  }

  private suitZh(suit: BloodSuit): string {
    return suit === 'm' ? '万' : suit === 'p' ? '筒' : '条';
  }

  private computeAlivePlayerCount(blood: BloodState): number {
    let alive = 0;
    for (const p of Object.values(blood.players ?? {})) {
      if (p && !p.hu) alive += 1;
    }
    if (alive <= 0) return 1;
    if (alive > 4) return 4;
    return alive;
  }

  private buildRecoStateSummary(params: {
    snap: SplitSnapshot;
    stage: RecoStage;
    eventType: string;
    missingSuit: BloodSuit | null;
    blockedByDingque: boolean;
  }): LlmRecoInput['state_summary'] {
    const { snap } = params;
    return {
      stage: params.stage,
      'event.type': params.eventType,
      seat_id: snap.seat,
      missing_suit: params.missingSuit,
      blockedByDingque: params.blockedByDingque,
      wall_remaining: snap.wallRemaining,
      alive_player_count: this.computeAlivePlayerCount(snap.blood),
      my_hand_size: this.totalTileCount(snap.handCounts14),
    };
  }

  private makeExplainFact(candidateId: string, key: FactKey, text: string): ExplainFact {
    return { id: factId(candidateId, key), text };
  }

  private makeStateMissingSuitFact(candidateId: string, suit: BloodSuit): ExplainFact {
    return this.makeExplainFact(candidateId, 'state.missing_suit', `定缺：missing_suit=${suit}（${this.suitZh(suit)}）`);
  }

	  private buildRecoDecisionKey(input: LlmRecoInput): string {
	    const ss = input.state_summary;
	    let hashBase = '';
	    try {
	      hashBase = JSON.stringify(input);
    } catch {
      const ids = input.candidates_topk.map((c) => c.candidate_id).join('|');
      hashBase = [
        'fallback',
        ss.stage,
        ss['event.type'],
        String(ss.seat_id),
        ss.missing_suit ?? '-',
        ss.blockedByDingque ? '1' : '0',
        String(ss.wall_remaining),
        String(ss.alive_player_count),
        String(ss.my_hand_size),
        input.engine_top1_candidate_id,
        input.engine_top1_locked ? 'L' : 'U',
        ids,
      ].join(';');
    }
    const inputHash = hash64Hex(hashBase);
    return [
      'reco.v2',
      ss.stage,
      ss['event.type'],
      String(ss.seat_id),
      ss.missing_suit ?? '-',
      ss.blockedByDingque ? '1' : '0',
      String(ss.wall_remaining),
      String(ss.alive_player_count),
      String(ss.my_hand_size),
      input.engine_top1_candidate_id,
      input.engine_top1_locked ? 'L' : 'U',
	      `h=${inputHash}`,
	    ].join(';');
	  }

	  private applyAiHostedRecoOverrides(ctx: RecoUiContext): RecoUiContext {
	    // 托管=只听LLM：允许 LLM 覆盖 Top1，即在托管裁决请求中强制解锁 engine_top1_locked。
	    // 该开关只在 AI托管期间生效，避免影响纯“展示/追问”的默认口径。
	    if (!this.aiHostedEnabled) return ctx;
	    if (this.aiHostedDecisionSource !== 'llm') return ctx;
	    if (!ctx.input.engine_top1_locked) return ctx;
	    const input: LlmRecoInput = { ...ctx.input, engine_top1_locked: false };
	    const decisionKey = this.buildRecoDecisionKey(input);
	    return { ...ctx, decisionKey, input, engineTop1Locked: false };
	  }

	  private trimRecoCache(max = 50): void {
	    if (this.recoCache.size <= max) return;
	    const extra = this.recoCache.size - max;
	    const keys = Array.from(this.recoCache.keys()).slice(0, extra);
    for (const k of keys) {
      this.recoCache.delete(k);
      this.recoModelCache.delete(k);
    }
  }

  private updateRecoAiBtn(): void {
    const on = this.recoAiEnabled;
    this.recoAiBtn.classList.toggle('is-on', on);
    this.recoAiBtn.title = on ? 'AI面板（开）' : 'AI面板（关）';
    this.recoAiBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  private maybeRefreshAiSettings(force = false): void {
    const gid = String(this.client.gameId() ?? '').trim();
    if (!gid) {
      this.aiSettingsLoadedGameId = null;
      this.aiSettingsDataGameId = null;
      this.aiSettingsInFlight = null;
      this.aiSettingsError = null;
      this.aiSettingsRetryAt = 0;
      this.aiSettingsRetryDelayMs = 0;
      if (this.aiSettingsRetryTimer !== null) {
        window.clearTimeout(this.aiSettingsRetryTimer);
        this.aiSettingsRetryTimer = null;
        this.aiSettingsRetryTimerAt = 0;
      }
      this.aiEffectivePref = { source: 'official', profileId: null };
      this.aiProfiles = [];
      this.aiOfficialModel = '';
      return;
    }
    if (this.aiSettingsInFlight?.gameId === gid) return;

    const now = Date.now();
    const hasErrorForGid = !!this.aiSettingsError && this.aiSettingsDataGameId === gid;
    if (!force && this.aiSettingsLoadedGameId === gid) {
      if (!hasErrorForGid) return;
      if (now < this.aiSettingsRetryAt) {
        // Ensure we won't get stuck in error state if the retryAt was pushed out while a previous timer was pending.
        this.scheduleAiSettingsRetry();
        return;
      }
    }

    const prevLoaded = this.aiSettingsLoadedGameId;
    this.aiSettingsLoadedGameId = gid;
    if (prevLoaded !== gid) {
      this.aiSettingsRetryAt = 0;
      this.aiSettingsRetryDelayMs = 0;
      if (this.aiSettingsRetryTimer !== null) {
        window.clearTimeout(this.aiSettingsRetryTimer);
        this.aiSettingsRetryTimer = null;
        this.aiSettingsRetryTimerAt = 0;
      }
    }
    if (this.aiSettingsDataGameId !== gid) {
      this.aiSettingsDataGameId = null;
      this.aiSettingsError = null;
      this.aiEffectivePref = { source: 'official', profileId: null };
      this.aiProfiles = [];
      this.aiOfficialModel = '';
    }

    const seq = ++this.aiSettingsReqSeq;
    this.aiSettingsInFlight = { gameId: gid, seq };
    void fetchAiSettings({ gameId: gid })
      .then((data) => {
        if (this.aiSettingsInFlight?.seq !== seq) return;
        this.aiSettingsDataGameId = gid;
        this.aiSettingsError = null;
        this.aiSettingsRetryAt = 0;
        this.aiSettingsRetryDelayMs = 0;
        if (this.aiSettingsRetryTimer !== null) {
          window.clearTimeout(this.aiSettingsRetryTimer);
          this.aiSettingsRetryTimer = null;
          this.aiSettingsRetryTimerAt = 0;
        }
        this.aiProfiles = Array.isArray(data.profiles) ? data.profiles : [];
        this.aiEffectivePref = (data.effective as any) ?? { source: 'official', profileId: null };
        this.aiOfficialModel = typeof data.official?.model === 'string' ? data.official.model : '';
        if (this.open) this.render();
        if (!this.hostedSettingsDrawer.classList.contains('hidden')) this.renderAiHostedSettings();
      })
      .catch((err: unknown) => {
        if (this.aiSettingsInFlight?.seq !== seq) return;
        const now2 = Date.now();
        this.aiSettingsDataGameId = gid;
        this.aiSettingsError = String((err as any)?.message ?? err);
        this.aiSettingsRetryDelayMs = this.aiSettingsRetryDelayMs > 0 ? Math.min(30_000, this.aiSettingsRetryDelayMs * 2) : 3000;
        this.aiSettingsRetryAt = now2 + this.aiSettingsRetryDelayMs;
        this.aiProfiles = [];
        this.aiEffectivePref = { source: 'official', profileId: null };
        this.aiOfficialModel = '';
        if (this.open) this.render();
        if (!this.hostedSettingsDrawer.classList.contains('hidden')) this.renderAiHostedSettings();
        this.scheduleAiSettingsRetry();
      })
      .finally(() => {
        if (this.aiSettingsInFlight?.seq === seq) this.aiSettingsInFlight = null;
      });
  }

  private scheduleAiSettingsRetry(): void {
    if (!this.open) return;
    const gid = String(this.client.gameId() ?? '').trim();
    if (!gid) return;
    if (!this.aiSettingsError || this.aiSettingsDataGameId !== gid) return;
    if (this.aiSettingsInFlight?.gameId === gid) return;

    const desiredAt = Number.isFinite(this.aiSettingsRetryAt) ? Math.max(0, Math.trunc(this.aiSettingsRetryAt)) : 0;
    const now = Date.now();
    if (this.aiSettingsRetryTimer !== null) {
      if (this.aiSettingsRetryTimerAt === desiredAt) return;
      window.clearTimeout(this.aiSettingsRetryTimer);
      this.aiSettingsRetryTimer = null;
      this.aiSettingsRetryTimerAt = 0;
    }

    const delay = Math.max(100, Math.trunc(desiredAt - now));
    this.aiSettingsRetryTimerAt = desiredAt;
    this.aiSettingsRetryTimer = window.setTimeout(() => {
      this.aiSettingsRetryTimer = null;
      this.aiSettingsRetryTimerAt = 0;
      if (!this.open) return;
      this.maybeRefreshAiSettings(false);
    }, delay);
  }

  private getEffectiveAiModelLabel(): string | null {
    const gid = String(this.client.gameId() ?? '').trim();
    if (!gid) return null;
    if (!this.aiSettingsDataGameId || this.aiSettingsDataGameId !== gid) return null;
    return resolveEffectiveAiModelLabel({
      effective: this.aiEffectivePref,
      profiles: this.aiProfiles,
      officialModel: this.aiOfficialModel,
    });
  }

  private describeAiHostedModel(source: AiHostedDecisionSource): { badge: string; text: string; title: string } {
    if (source !== 'llm') {
      return {
        badge: '不使用LLM',
        text: '当前模型：未使用（托管走引擎Top1）',
        title: '当前模型：未使用（托管走引擎Top1）',
      };
    }
    const gid = String(this.client.gameId() ?? '').trim();
    if (!gid) {
      return { badge: '未加入牌局', text: '当前模型：未加入牌局', title: '当前模型：未加入牌局' };
    }
    const modelLabel = this.getEffectiveAiModelLabel();
    if (modelLabel) {
      return { badge: `模型·${modelLabel}`, text: `当前模型：${modelLabel}`, title: `当前模型：${modelLabel}` };
    }
    if (this.aiSettingsInFlight?.gameId === gid || this.aiSettingsLoadedGameId !== gid) {
      return { badge: '模型加载中', text: '当前模型：加载中...', title: '当前模型：加载中...' };
    }
    if (this.aiSettingsError) {
      return { badge: '模型读取失败', text: '当前模型：读取失败', title: `当前模型读取失败：${this.aiSettingsError}` };
    }
    return { badge: '模型待获取', text: '当前模型：待获取', title: '当前模型：待获取' };
  }

  private describeAiHostedModelBadge(source: AiHostedDecisionSource): { text: string; title: string; className?: string } | null {
    if (source !== 'llm') return null;
    const gid = String(this.client.gameId() ?? '').trim();
    if (!gid) {
      return {
        text: '未加入牌局',
        title: '当前模型：未加入牌局',
        className: ' is-loading',
      };
    }
    const modelLabel = this.getEffectiveAiModelLabel();
    if (modelLabel) {
      return {
        text: modelLabel,
        title: modelLabel,
      };
    }
    if (this.aiSettingsInFlight?.gameId === gid || this.aiSettingsLoadedGameId !== gid) {
      return {
        text: '模型加载中',
        title: '当前模型：加载中...',
        className: ' is-loading',
      };
    }
    if (this.aiSettingsError) {
      return {
        text: '模型读取失败',
        title: `当前模型读取失败：${this.aiSettingsError}`,
        className: ' is-error',
      };
    }
    return {
      text: '模型待获取',
      title: '当前模型：待获取',
      className: ' is-loading',
    };
  }

  private describeAiHostedTimingBadge(params?: {
    stage?: RecoStage | null;
    snapshotKey?: string | null;
  }): { text: string; title: string; className?: string } | null {
    const delayMs = Number.isFinite(this.aiHostedActDelayMs) ? Math.max(0, Math.trunc(this.aiHostedActDelayMs)) : 0;
    const waiting = Boolean(
      params?.stage &&
        params?.snapshotKey &&
        this.aiHostedPlannedAct &&
        this.aiHostedPlannedAct.stage === params.stage &&
        this.aiHostedPlannedAct.snapshotKey === params.snapshotKey
    );
    if (waiting && delayMs > 0) {
      const sec = Math.round(delayMs / 100) / 10;
      return {
        text: `${sec}s后执行`,
        title: this.hostedDelayLabel(delayMs),
        className: ' is-loading',
      };
    }
    if (waiting) {
      return {
        text: '等待执行',
        title: '动作已进入执行队列',
        className: ' is-loading',
      };
    }
    if (delayMs > 0) {
      const sec = Math.round(delayMs / 100) / 10;
      return {
        text: `延迟${sec}s`,
        title: this.hostedDelayLabel(delayMs),
        className: ' is-loading',
      };
    }
    return null;
  }

  private appendRecoBadge(
    badges: HTMLElement,
    text: string,
    opts?: { title?: string; className?: string }
  ): void {
    const value = String(text ?? '').trim();
    if (!value) return;
    const b = document.createElement('span');
    b.className = `split-reco-badge${opts?.className ?? ''}`;
    b.textContent = value;
    if (opts?.title) b.title = opts.title;
    badges.appendChild(b);
  }

  private appendAiHostedRecoBadges(params: {
    badges: HTMLElement;
    stage?: RecoStage | null;
    snapshotKey?: string | null;
    decisionKey?: string | null;
  }): void {
    this.appendRecoBadge(
      params.badges,
      this.aiHostedDecisionSource === 'llm' ? '托管·LLM' : '托管·Top1',
      {
        title: this.hostedDecisionSourceLabel(this.aiHostedDecisionSource),
        className: this.aiHostedDecisionSource === 'llm' ? ' is-llm' : '',
      }
    );
    const modelBadge = this.describeAiHostedModelBadge(this.aiHostedDecisionSource);
    if (modelBadge) {
      this.appendRecoBadge(params.badges, modelBadge.text, {
        title: modelBadge.title,
        className: modelBadge.className,
      });
    }
    const timingBadge = this.describeAiHostedTimingBadge({
      stage: params.stage ?? null,
      snapshotKey: params.snapshotKey ?? null,
    });
    if (timingBadge) {
      this.appendRecoBadge(params.badges, timingBadge.text, {
        title: timingBadge.title,
        className: timingBadge.className,
      });
    }
    if (params.decisionKey && this.aiHostedNotice && this.aiHostedNotice.decisionKey === params.decisionKey) {
      this.appendRecoBadge(params.badges, '按TOP1', {
        title: this.aiHostedNotice.text,
        className: ' is-fallback',
      });
    }
  }

  private buildAiHostedButtonTitle(): string {
    const hostedPolicy = this.aiHostedDecisionSource === 'llm' ? 'LLM' : '引擎Top1';
    const hostedDelayText = this.aiHostedActDelayMs > 0 ? `·延迟${Math.round(this.aiHostedActDelayMs / 100) / 10}s` : '';
    const modelInfo = this.describeAiHostedModel(this.aiHostedDecisionSource).title;
    if (this.aiHostedEnabled) return `AI托管（开）·${hostedPolicy}${hostedDelayText} · ${modelInfo}`;
    if (this.aiHostedExitReason) return `AI托管（关）：${this.aiHostedExitReason}`;
    return `AI托管（关）·${hostedPolicy}${hostedDelayText} · ${modelInfo}`;
  }

  private scheduleAiHostedTick(delayMs: number): void {
    if (!this.aiHostedEnabled) return;
    if (this.aiHostedTickTimer !== null) return;
    const ms = Number.isFinite(delayMs) ? Math.max(0, Math.trunc(delayMs)) : 0;
		    this.aiHostedTickTimer = window.setTimeout(() => {
		      this.aiHostedTickTimer = null;
		      this.maybeAiHostedAct();
		    }, ms);
		  }

		  private hostedDecisionSourceLabel(source: AiHostedDecisionSource): string {
		    return source === 'llm' ? '只听LLM（允许非Top1）' : '只听引擎Top1（托管不依赖LLM）';
		  }

		  private hostedDelayLabel(ms: number): string {
		    const n = Number.isFinite(ms) ? Math.max(0, Math.trunc(ms)) : 0;
		    if (n <= 0) return '立即执行';
		    const sec = Math.round(n / 100) / 10;
		    return `${sec}s后执行`;
		  }

		  private openAiHostedSettings(): void {
		    if (!this.open) return;
		    // Keep an explicit draft so async model refresh won't overwrite pending edits in the drawer.
		    if (!this.aiHostedSettingsDraft) {
		      this.aiHostedSettingsDraft = { source: this.aiHostedDecisionSource, delayMs: this.aiHostedActDelayMs };
		    }
		    this.maybeRefreshAiSettings(true);
		    this.hostedSettingsTitleEl.textContent = 'AI托管设置';
		    this.hostedSettingsBackdrop.classList.remove('hidden');
		    this.hostedSettingsDrawer.classList.remove('hidden');
		    this.renderAiHostedSettings();
		  }

		  private closeAiHostedSettings(): void {
		    this.hostedSettingsBackdrop.classList.add('hidden');
		    this.hostedSettingsDrawer.classList.add('hidden');
		    this.hostedSettingsTitleEl.textContent = '';
		    this.hostedSettingsBodyEl.innerHTML = '';
		    this.aiHostedSettingsDraft = null;
		  }

		  private renderAiHostedSettings(): void {
		    const body = this.hostedSettingsBodyEl;
		    body.innerHTML = '';
		    const mkTitle = (t: string): HTMLDivElement => {
		      const el = document.createElement('div');
		      el.className = 'split-hosted-sec-title';
		      el.textContent = t;
		      return el;
		    };
		    const mkDesc = (t: string): HTMLDivElement => {
		      const el = document.createElement('div');
		      el.className = 'split-hosted-sec-desc';
		      el.textContent = t;
		      return el;
		    };

		    const draft =
		      this.aiHostedSettingsDraft ?? { source: this.aiHostedDecisionSource, delayMs: this.aiHostedActDelayMs };
		    this.aiHostedSettingsDraft = draft;
		    let source: AiHostedDecisionSource = draft.source;
		    let delayMs: number = draft.delayMs;

		    const sec1 = document.createElement('div');
		    sec1.className = 'split-hosted-sec';
		    sec1.appendChild(mkTitle('裁决来源（冲突时听谁）'));
		    sec1.appendChild(mkDesc('该设置只影响 AI托管的实际出牌/响应；不影响你手动点候选。'));
		    const seg = document.createElement('div');
		    seg.className = 'split-hosted-seg';
		    const mkSegBtn = (value: AiHostedDecisionSource): HTMLButtonElement => {
		      const btn = document.createElement('button');
		      btn.type = 'button';
		      btn.className = 'split-hosted-seg-btn';
		      btn.textContent = value === 'llm' ? 'LLM' : '引擎Top1';
		      btn.onclick = () => {
		        source = value;
		        draft.source = source;
		        sync();
		      };
		      return btn;
		    };
		    const sourceBtnLlm = mkSegBtn('llm');
		    const sourceBtnEngine = mkSegBtn('engine');
		    seg.appendChild(sourceBtnLlm);
		    seg.appendChild(sourceBtnEngine);
		    sec1.appendChild(seg);
		    const sourceHint = document.createElement('div');
		    sourceHint.className = 'split-hosted-hint';
		    sec1.appendChild(sourceHint);
		    const modelHint = document.createElement('div');
		    modelHint.className = 'split-hosted-hint';
		    sec1.appendChild(modelHint);
		    body.appendChild(sec1);

		    const sec2 = document.createElement('div');
		    sec2.className = 'split-hosted-sec';
		    sec2.appendChild(mkTitle('执行延迟（为了看清再执行）'));
		    sec2.appendChild(mkDesc('注意：你选择“延迟”后，响应窗口也会延迟，可能错过时机导致动作被拒绝。'));
		    const delaySelect = document.createElement('select');
		    delaySelect.className = 'split-hosted-select';
		    const addOpt = (ms: number, label: string) => {
		      const opt = document.createElement('option');
		      opt.value = String(ms);
		      opt.textContent = label;
		      delaySelect.appendChild(opt);
		    };
		    addOpt(0, '立即');
		    addOpt(2000, '2秒');
		    addOpt(5000, '5秒');
		    delaySelect.value = String(delayMs);
		    delaySelect.onchange = () => {
		      const v = Math.trunc(Number(delaySelect.value));
		      delayMs = Number.isFinite(v) ? Math.max(0, v) : 0;
		      draft.delayMs = delayMs;
		      sync();
		    };
		    sec2.appendChild(delaySelect);
		    const delayHint = document.createElement('div');
		    delayHint.className = 'split-hosted-hint';
		    sec2.appendChild(delayHint);
		    body.appendChild(sec2);

		    const footer = document.createElement('div');
		    footer.className = 'split-hosted-footer';
		    const cancelBtn = document.createElement('button');
		    cancelBtn.type = 'button';
		    cancelBtn.className = 'split-hosted-btn';
		    cancelBtn.textContent = '取消';
		    cancelBtn.onclick = () => this.closeAiHostedSettings();
		    const okBtn = document.createElement('button');
		    okBtn.type = 'button';
		    okBtn.className = 'split-hosted-btn primary';
		    okBtn.textContent = this.aiHostedEnabled ? '应用' : '开启托管';
		    okBtn.onclick = () => {
		      this.aiHostedDecisionSource = source;
		      this.aiHostedActDelayMs = delayMs;
		      this.persistAiHostedSettings();
		      this.closeAiHostedSettings();
		      if (!this.aiHostedEnabled) {
		        this.setAiHostedEnabled(true, '用户开启托管');
		      } else if (this.open) {
		        // 仅更新 UI；下一次 tick 会按新设置执行。
		        this.render();
		      }
		    };
		    footer.appendChild(cancelBtn);
		    footer.appendChild(okBtn);
		    body.appendChild(footer);

		    const sync = () => {
		      sourceBtnLlm.classList.toggle('is-on', source === 'llm');
		      sourceBtnEngine.classList.toggle('is-on', source === 'engine');
		      sourceHint.textContent = this.hostedDecisionSourceLabel(source);
		      const modelInfo = this.describeAiHostedModel(source);
		      modelHint.textContent = modelInfo.text;
		      modelHint.title = modelInfo.title;
		      delaySelect.value = String(delayMs);
		      delayHint.textContent = this.hostedDelayLabel(delayMs);
		    };
		    sync();
		  }

		  private setAiHostedNotice(decisionKey: string, text: string): void {
		    const key = String(decisionKey ?? '').trim();
		    const msg = String(text ?? '').trim();
		    if (!key || !msg) return;
		    if (this.aiHostedNotice && this.aiHostedNotice.decisionKey === key && this.aiHostedNotice.text === msg) return;
		    this.aiHostedNotice = { decisionKey: key, text: msg, at: Date.now() };
		    if (this.open) this.render();
		  }

		  private clearAiHostedNotice(decisionKey?: string): void {
		    if (!this.aiHostedNotice) return;
		    if (decisionKey && this.aiHostedNotice.decisionKey !== decisionKey) return;
		    this.aiHostedNotice = null;
		  }

			  private clearAiHostedPlannedAct(): void {
			    if (this.aiHostedPlannedTimer !== null) {
			      window.clearTimeout(this.aiHostedPlannedTimer);
			      this.aiHostedPlannedTimer = null;
			    }
			    this.aiHostedPlannedAct = null;
			  }

		  private setAiHostedEnabled(enabled: boolean, reason?: string): void {
		    const next = !!enabled;
		    if (this.aiHostedEnabled === next) return;

	    if (next) {
	      if (!this.client.isAuthoritative()) {
	        this.aiHostedExitReason = '当前模式不支持 AI托管';
	        this.aiHostedEnabled = false;
	        if (this.open) this.render();
	        return;
	      }
	      const gid = this.client.gameId();
	      const seat = this.world.seat;
	      const blood = this.client.blood.get(0) as BloodState | null;
	      if (!gid || seat === null || !blood) {
	        this.aiHostedExitReason = '未加入牌局';
	        this.aiHostedEnabled = false;
	        if (this.open) this.render();
	        return;
	      }
	    }

	    this.aiHostedEnabled = next;
		    this.aiHostedExitReason = next ? null : reason ? String(reason) : null;
		    this.aiHostedLastActedDecisionKey = null;
		    this.aiHostedPendingActionIds.clear();
		    this.aiHostedWait = null;
		    this.clearAiHostedPlannedAct();
		    this.aiHostedNotice = null;
		    if (this.aiHostedTickTimer !== null) {
		      window.clearTimeout(this.aiHostedTickTimer);
		      this.aiHostedTickTimer = null;
		    }

	    this.world.setAiHosted(next, 'split');

	    if (next) {
	      if (!this.recoAiEnabled) {
	        this.toggleRecoAi();
	      }
	      this.maybeAiHostedAct();
	    } else {
	      if (this.open) this.render();
	    }
	  }

	  private onBloodUpdate(): void {
	    if (!this.aiHostedEnabled) return;
	    const seat = this.world.seat;
	    const blood = this.client.blood.get(0) as BloodState | null;
	    if (!blood || seat === null) {
	      this.setAiHostedEnabled(false, '未加入牌局');
	      return;
	    }
	    this.maybeAiHostedAct();
	  }

	  private onAiHostedActionAck(ack: any): void {
	    if (!this.aiHostedEnabled) return;
	    const actionId = String(ack?.actionId ?? '').trim();
	    if (!actionId) return;
	    if (!this.aiHostedPendingActionIds.has(actionId)) return;
	    this.aiHostedPendingActionIds.delete(actionId);
	    const ok = Boolean(ack?.ok);
	    if (!ok) {
	      const err = String(ack?.error ?? '').trim() || '动作被拒绝';
	      this.setAiHostedEnabled(false, err);
	      return;
	    }
	    this.scheduleAiHostedTick(0);
	  }

	  private collectOwnHandTilesWithIds(seat: number): Array<{ tileId: number; tileKey: number; isExtra: boolean }> {
	    const out: Array<{ tileId: number; tileKey: number; isExtra: boolean }> = [];
	    for (const [tileId, info] of this.client.things.entries()) {
	      const slotName = typeof (info as any)?.slotName === 'string' ? String((info as any).slotName) : '';
	      if (!slotName.startsWith('hand.') || !slotName.endsWith(`@${seat}`)) continue;
	      const tileKeyRaw = this.client.tileFaceSelf.get(tileId) ?? this.client.tileFacePublic.get(tileId) ?? null;
	      const tileKey = Number.isFinite(tileKeyRaw) ? Math.trunc(tileKeyRaw as number) : null;
	      if (tileKey === null || tileKey < 0 || tileKey >= 27) continue;
	      const isExtra = slotName.startsWith('hand.extra');
	      out.push({ tileId, tileKey, isExtra });
	    }
	    out.sort((a, b) => a.tileId - b.tileId);
	    return out;
	  }

	  private pickOwnHandTileId(seat: number, tileKey: number): number | null {
	    const items = this.collectOwnHandTilesWithIds(seat).filter((x) => x.tileKey === tileKey);
	    if (items.length === 0) return null;
	    const extra = items.find((x) => x.isExtra) ?? null;
	    if (extra) return extra.tileId;
	    const normal = items.find((x) => !x.isExtra) ?? null;
	    if (normal) return normal.tileId;
	    return items[0]?.tileId ?? null;
	  }

	  private pickOwnHandTileIds(seat: number, tileKeys: ReadonlyArray<number>): Array<number> | null {
	    const pool = this.collectOwnHandTilesWithIds(seat);
	    const byKey = new Map<number, Array<number>>();
	    for (const it of pool) {
	      const arr = byKey.get(it.tileKey) ?? [];
	      arr.push(it.tileId);
	      byKey.set(it.tileKey, arr);
	    }
	    for (const arr of byKey.values()) arr.sort((a, b) => a - b);
	    const picked: Array<number> = [];
	    for (const k of tileKeys) {
	      const arr = byKey.get(k) ?? null;
	      if (!arr || arr.length === 0) return null;
	      picked.push(arr.shift()!);
	    }
	    return picked;
	  }

	  private buildHostedAnalyzers(snap: SplitSnapshot): SplitAnalyzerSet {
	    if (snap.blood.phase !== 'playing') return {};
	    if (!snap.myDingque) return {};
	    return this.buildAnalyzersForState({
	      snap,
	      melds: snap.melds,
	      publicCounts: snap.publicCounts,
	      remCounts: snap.remCounts,
	      unknownPoolSize: snap.unknownPoolSize,
	      stage: snap.stage,
	      dingque: snap.myDingque,
	    });
	  }

		  private buildAiHostedSnapshotKey(snap: SplitSnapshot): string {
		    const pending = snap.blood.pending;
		    const pendingId = pending?.kind === 'claim' ? pending.id : null;
		    const pendingSelfResp = pending?.kind === 'claim' ? (pending.responses?.[snap.seat] ?? null) : null;
		    const swapSince = snap.blood.swap3?.since ?? null;
		    const swapAnimating = snap.blood.swap3?.animatingSince ?? null;
		    const swapSelection = snap.blood.swap3?.selections?.[snap.seat] ?? null;
		    const me = snap.blood.players?.[snap.seat] ?? null;
		    const dingque = me?.dingque ?? null;
		    const dingqueReady = me?.dingqueReady ?? null;
		    return [
		      'aihost.snap.v1',
		      `seat=${snap.seat}`,
		      `phase=${snap.blood.phase}`,
		      `turnSeat=${snap.blood.turnSeat}`,
		      `turnStep=${snap.blood.turnStep}`,
		      `pendingId=${pendingId ?? ''}`,
		      `pendingSelfResp=${pendingSelfResp ?? ''}`,
		      `swapSince=${swapSince ?? ''}`,
		      `swapAnim=${swapAnimating ?? ''}`,
		      `swapSel=${swapSelection ?? ''}`,
		      `dingque=${dingque ?? ''}`,
		      `dingqueReady=${dingqueReady ?? ''}`,
		      `hand=${handCountsKey(snap.handCounts14)}`,
		    ].join('|');
		  }

	  private maybeAiHostedAct(): void {
	    if (!this.aiHostedEnabled) return;
	    if (this.aiHostedPendingActionIds.size > 0) return;

	    const seat = this.world.seat;
	    const blood = this.client.blood.get(0) as BloodState | null;
	    if (!blood || seat === null) {
	      this.setAiHostedEnabled(false, '未加入牌局');
	      return;
	    }

	    const fresh = buildSnapshot(this.client, this.world);
	    const prev = this.snapshot;
	    const snap = prev && prev.ok && fresh.ok && this.buildAiHostedSnapshotKey(prev) === this.buildAiHostedSnapshotKey(fresh) ? prev : fresh;
	    this.snapshot = snap;
	    if (!snap.ok) {
	      // 等待手牌同步/进入可操作窗口。
	      this.scheduleAiHostedTick(200);
	      return;
	    }

		    const canSelfClaimActNow = this.isSelfClaimWindow(snap) !== null;
		    const canSelfSwap3ActNow = this.isSelfSwap3Window(snap);
		    const canSelfDingqueActNow = this.isSelfDingqueWindow(snap);
		    const canAct = Boolean(snap.canSelfTurnAct || canSelfClaimActNow || canSelfSwap3ActNow || canSelfDingqueActNow);
		    if (!canAct) {
		      this.actionsHistorical = true;
		      this.aiHostedWait = null;
		      this.clearAiHostedPlannedAct();
		      if (this.open) this.render();
		      return;
		    }

			    // Hosted 期间总是按实时口径处理（不展示“上次计算”）。
			    this.actionsHistorical = false;

				    const { mode, claimCtx } = this.getPanelMode(snap);

				    // 若上一轮已规划了“延迟执行”，且局面未变，则本轮不重复决策，等待定时器触发即可。
				    const snapKeyNow = this.buildAiHostedSnapshotKey(snap);
				    if (this.aiHostedPlannedAct) {
				      const sameSnap = this.aiHostedPlannedAct.snapshotKey === snapKeyNow;
				      const stageNow: RecoStage = mode === 'swap3' ? 'exchange_3' : mode === 'dingque' ? 'choose_missing_suit' : mode === 'claim' ? 'react' : 'my_turn';
				      const sameStage = this.aiHostedPlannedAct.stage === stageNow;
				      if (sameSnap && sameStage) {
				        return;
				      }
				      this.clearAiHostedPlannedAct();
				    }

	    if (mode === 'turn' || mode === 'claim') {
	      this.analyzers = this.buildHostedAnalyzers(snap);
	      if (!this.getRouteAnalyzer('standard', this.analyzers)) {
	        this.scheduleAiHostedTick(200);
	        return;
	      }
	    }

		    const resolveAndAct = (ctx: RecoUiContext, chosenCandidateId: string, actions: ReadonlyArray<any>, pending?: BloodPendingClaim | null): void => {
		      if (ctx.decisionKey === this.aiHostedLastActedDecisionKey) return;
		      const map = ctx.candidateUiMap.get(chosenCandidateId) ?? null;
		      if (!map) return;

	      if (ctx.stage === 'exchange_3') {
	        const action = (actions as Array<SplitSwap3Action>).find((a) => a.key === map.actionKey) ?? null;
	        if (!action) return;
	        const tileIds = this.pickOwnHandTileIds(seat, action.tiles);
	        if (!tileIds || tileIds.length !== 3) {
	          this.scheduleAiHostedTick(200);
	          return;
	        }
	        const actionId = this.client.sendBloodAction({ kind: 'swap3', tileIds } as any);
	        if (!actionId) {
	          this.setAiHostedEnabled(false, '发送动作失败');
	          return;
	        }
	        this.aiHostedPendingActionIds.add(actionId);
	        this.aiHostedLastActedDecisionKey = ctx.decisionKey;
	        this.aiHostedWait = null;
	        return;
	      }

		      if (ctx.stage === 'choose_missing_suit') {
		        const cand = ctx.input.candidates_topk.find((c) => c.candidate_id === chosenCandidateId) ?? null;
		        const suit = cand && cand.action.type === 'choose_missing_suit' ? cand.action.suit : null;
		        if (!suit) return;
		        const actionId = this.client.sendBloodAction({ kind: 'dingque', suit } as any);
		        if (!actionId) {
		          this.setAiHostedEnabled(false, '发送动作失败');
		          return;
		        }
	        this.aiHostedPendingActionIds.add(actionId);
	        this.aiHostedLastActedDecisionKey = ctx.decisionKey;
	        this.aiHostedWait = null;
	        return;
	      }

	      if (ctx.stage === 'react') {
	        const pendingClaim = pending ?? null;
	        if (!pendingClaim) return;
	        const action = (actions as Array<SplitClaimAction>).find((a) => a.key === map.actionKey) ?? null;
	        if (!action) return;
	        const act: any =
	          action.kind === 'claimHu'
	            ? 'hu'
	            : action.kind === 'claimPeng'
	              ? 'peng'
	              : action.kind === 'claimMingGang'
	                ? 'gang'
	                : 'pass';
	        const actionId = this.client.sendBloodAction({ kind: 'claim', pendingId: pendingClaim.id, action: act } as any);
	        if (!actionId) {
	          this.setAiHostedEnabled(false, '发送动作失败');
	          return;
	        }
	        this.aiHostedPendingActionIds.add(actionId);
	        this.aiHostedLastActedDecisionKey = ctx.decisionKey;
	        this.aiHostedWait = null;
	        return;
	      }

	      // my_turn
	      if (map.discardTileKey !== null) {
	        const tileId = this.pickOwnHandTileId(seat, map.discardTileKey);
	        if (tileId === null) {
	          this.scheduleAiHostedTick(200);
	          return;
	        }
	        const actionId = this.client.sendBloodAction({ kind: 'discard', tileId } as any);
	        if (!actionId) {
	          this.setAiHostedEnabled(false, '发送动作失败');
	          return;
	        }
	        this.aiHostedPendingActionIds.add(actionId);
	        this.aiHostedLastActedDecisionKey = ctx.decisionKey;
	        this.aiHostedWait = null;
	        return;
	      }
	      const action = (actions as Array<SplitTurnAction>).find((a) => a.key === map.actionKey) ?? null;
	      if (!action) return;
	      if (action.kind === 'hu') {
	        const actionId = this.client.sendBloodAction({ kind: 'hu', source: 'self' } as any);
	        if (!actionId) {
	          this.setAiHostedEnabled(false, '发送动作失败');
	          return;
	        }
	        this.aiHostedPendingActionIds.add(actionId);
	        this.aiHostedLastActedDecisionKey = ctx.decisionKey;
	        this.aiHostedWait = null;
	        return;
	      }
	      if (action.kind === 'gang') {
	        const actionId = this.client.sendBloodAction({ kind: 'kong', gangType: action.gangType, tileKey: action.tileKey } as any);
	        if (!actionId) {
	          this.setAiHostedEnabled(false, '发送动作失败');
	          return;
	        }
		        this.aiHostedPendingActionIds.add(actionId);
		        this.aiHostedLastActedDecisionKey = ctx.decisionKey;
		        this.aiHostedWait = null;
		      }
		    };

		    const scheduleResolveAndAct = (
		      ctx: RecoUiContext,
		      chosenCandidateId: string,
		      actions: ReadonlyArray<any>,
		      pending?: BloodPendingClaim | null,
		    ): void => {
		      const delayMs = Number.isFinite(this.aiHostedActDelayMs) ? Math.max(0, Math.trunc(this.aiHostedActDelayMs)) : 0;
		      if (delayMs <= 0) {
		        resolveAndAct(ctx, chosenCandidateId, actions, pending);
		        return;
		      }
		      const plannedAt = Date.now();
		      const dueAt = plannedAt + delayMs;
		      const snapshotKey = snapKeyNow;
		      this.clearAiHostedPlannedAct();
		      this.aiHostedPlannedAct = { decisionKey: ctx.decisionKey, stage: ctx.stage, chosenCandidateId, snapshotKey, plannedAt, dueAt };
		      if (this.open) this.render();
			      this.aiHostedPlannedTimer = window.setTimeout(() => {
			        this.aiHostedPlannedTimer = null;
			        const plan = this.aiHostedPlannedAct;
			        if (!plan || plan.decisionKey !== ctx.decisionKey) return;
		        if (!this.aiHostedEnabled) {
		          this.aiHostedPlannedAct = null;
		          if (this.open) this.render();
		          return;
		        }
		        if (this.aiHostedPendingActionIds.size > 0) return;
		        const fresh2 = buildSnapshot(this.client, this.world);
		        if (!fresh2.ok) {
		          this.aiHostedPlannedAct = null;
		          this.scheduleAiHostedTick(200);
		          if (this.open) this.render();
		          return;
		        }
			        const snapKey2 = this.buildAiHostedSnapshotKey(fresh2);
			        if (snapKey2 !== snapshotKey) {
			          this.aiHostedPlannedAct = null;
			          this.scheduleAiHostedTick(0);
			          if (this.open) this.render();
			          return;
			        }
			        if (pending && ctx.stage === 'react') {
			          const claimCtx2 = this.isSelfClaimWindow(fresh2);
			          if (!claimCtx2 || claimCtx2.pending.id !== pending.id) {
			            this.aiHostedPlannedAct = null;
			            this.scheduleAiHostedTick(0);
			            if (this.open) this.render();
			            return;
			          }
			        }
			        this.aiHostedPlannedAct = null;
			        resolveAndAct(ctx, chosenCandidateId, actions, pending);
			        if (this.open) this.render();
			      }, delayMs);
			    };

				  const pickHostedCandidateId = (ctx: RecoUiContext): string | null => {
				    const decisionKey = ctx.decisionKey;
				    if (this.aiHostedDecisionSource === 'engine') {
				      this.aiHostedWait = null;
				      this.clearAiHostedNotice(decisionKey);
				      return ctx.input.engine_top1_candidate_id;
				    }

				    // LLM托管：每次决策都尝试请求一次 LLM；失败/超时则用引擎 Top1 兜底。
				    const cached = this.recoCache.get(decisionKey) ?? null;
				    if (cached) {
				      this.aiHostedWait = null;
				      this.clearAiHostedNotice(decisionKey);
				      return cached.chosen_candidate_id;
				    }

					    const inFlight = this.recoLoading && this.recoCtx?.decisionKey === decisionKey;
					    // AI托管·LLM：等待 LLM 的窗口（超时则按 Top1 兜底并执行）。
					    const timeoutMs = 8000;
					    if (!inFlight) {
				      if (this.recoAutoJudgeTried.has(decisionKey)) {
				        const msg = '本次 LLM 不可用，已用引擎 Top1 兜底';
				        this.setAiHostedNotice(decisionKey, msg);
				        return ctx.input.engine_top1_candidate_id;
				      }
					      this.recoAutoJudgeTried.set(decisionKey, Date.now());
					      this.trimRecoAutoJudgeTried();
					      // 后端超时应略高于前端等待窗口，避免“前端已兜底但后端还长时间跑 LLM”。
					      this.startRecoLlmJudge(ctx, { render: false, timeoutMs: timeoutMs + 800, source: 'hosted' });
					    } else {
					      // 可能已有自动裁决发起的 in-flight：升级来源标签，确保追问等取消逻辑不误杀托管裁决。
					      this.startRecoLlmJudge(ctx, { render: false, timeoutMs: timeoutMs + 800, source: 'hosted' });
					    }

				    const now = Date.now();
				    const waitKey = `llm:${decisionKey}`;
				    let wait = this.aiHostedWait;
				    if (!wait || wait.decisionKey !== waitKey) {
				      wait = { decisionKey: waitKey, startedAt: now };
				      this.aiHostedWait = wait;
				    }
				    const elapsed = now - wait.startedAt;
				    if (elapsed < timeoutMs) {
				      this.scheduleAiHostedTick(80);
				      return null;
				    }
			      // 超时：取消 in-flight，避免迟到结果覆盖 UI；并提示本次按 Top1 兜底。
			      this.cancelRecoLlmJudge();
			      this.clearAiHostedNotice(decisionKey);
			      this.setAiHostedNotice(decisionKey, '本次 LLM 不可用，已用引擎 Top1 兜底');
			      return ctx.input.engine_top1_candidate_id;
			    };

			    if (mode === 'swap3') {
			      const actions = this.buildSwap3Actions(snap);
			      let ctx = this.buildRecoCtxExchange3(snap, actions);
			      if (!ctx) return;
			      ctx = this.applyAiHostedRecoOverrides(ctx);
			      this.ensureRecoResolution(ctx, snap);
			      const chosenCandidateId = pickHostedCandidateId(ctx);
			      if (!chosenCandidateId) return;
			      scheduleResolveAndAct(ctx, chosenCandidateId, actions);
			      return;
			    }

				    if (mode === 'dingque') {
				      const actions = this.getCachedDingqueActions(snap);
				      // 定缺候选需要异步 rollouts 计算。为保证“托管·引擎/LLM”和面板显示口径一致，
				      // 这里统一等待 actions 就绪后再执行（避免 fast ctx 造成 Top1 不一致 / 重复 LLM 请求等问题）。
				      if (!actions) {
				        this.scheduleAiHostedTick(80);
				        return;
				      }
				      let ctx = this.buildRecoCtxChooseMissingSuit(snap, actions);
				      if (!ctx) return;
			      ctx = this.applyAiHostedRecoOverrides(ctx);
			      this.ensureRecoResolution(ctx, snap);
			      const chosenCandidateId = pickHostedCandidateId(ctx);
			      if (!chosenCandidateId) return;
			      scheduleResolveAndAct(ctx, chosenCandidateId, actions);
			      return;
					    }

			    if (mode === 'claim' && claimCtx) {
			      const actions = this.buildClaimActions(snap, claimCtx.pending);
			      let ctx = this.buildRecoCtxReact(snap, claimCtx.pending, actions);
			      if (!ctx) return;
			      ctx = this.applyAiHostedRecoOverrides(ctx);
			      this.ensureRecoResolution(ctx, snap);
			      const chosenCandidateId = pickHostedCandidateId(ctx);
			      if (!chosenCandidateId) return;
			      scheduleResolveAndAct(ctx, chosenCandidateId, actions, claimCtx.pending);
			      return;
			    }

			    // turn
			    const actions = this.buildTurnActions(snap);
			    let ctx = this.buildRecoCtxMyTurn(snap, actions);
			    if (!ctx) return;
			    ctx = this.applyAiHostedRecoOverrides(ctx);
			    this.ensureRecoResolution(ctx, snap);
			    const chosenCandidateId = pickHostedCandidateId(ctx);
			    if (!chosenCandidateId) return;
			    scheduleResolveAndAct(ctx, chosenCandidateId, actions);
			  }

  private toggleRecoAi(): void {
    const next = !this.recoAiEnabled;
    this.recoAiEnabled = next;
		    if (!next) {
		      // 关闭 AI面板：同时关闭 AI托管，避免“面板关了但仍在自动代操作”的误解/风险。
		      if (this.aiHostedEnabled) {
		        this.setAiHostedEnabled(false, 'AI面板已关闭');
		      }
		      // 关闭 AI面板：同时关闭自动裁决，并取消进行中的裁决请求。
		      this.cancelRecoLlmJudge();
		      this.setRecoAutoJudgeEnabled(false, { cancelInflight: false, render: false });
		      this.recoFollowupOpen = false;
		      this.recoFollowupDecisionKey = null;
	      // 注意：不要清空 in-flight 的追问请求状态。用户可能只是隐藏面板，但服务端请求仍会返回；
	      // 保留 inflight/streaming 可确保 AI_RESULT 能被正确接收并落到历史线程中，避免“请求成功但结果丢失/已扣费无显示”。
	      this.setRecoFollowupPanelVisible(false);
	    }
	    this.updateRecoAiBtn();
	    this.render();
	  }

  private cancelRecoLlmJudge(opts?: { onlyIfSource?: RecoJudgeSource }): void {
	    if (!this.recoLoading) return;
	    if (opts?.onlyIfSource && this.recoInFlightSource !== opts.onlyIfSource) return;
	    // 通过递增序列号让 in-flight 结果自然失效；同时清空 loading。
	    this.recoReqSeq += 1;
	    this.recoLoading = false;
	    this.recoInFlightSource = null;
	  }

	  private setRecoAutoJudgeEnabled(enabled: boolean, opts?: { cancelInflight?: boolean; render?: boolean }): void {
	    const next = !!enabled;
	    if (this.recoAutoJudgeEnabled === next) {
	      if (!next && opts?.cancelInflight) this.cancelRecoLlmJudge({ onlyIfSource: 'auto' });
	      return;
	    }
	    this.recoAutoJudgeEnabled = next;
	    if (!next && opts?.cancelInflight) this.cancelRecoLlmJudge({ onlyIfSource: 'auto' });
	    if (opts?.render === false) return;
	    if (this.open) this.render();
	  }

			  private startRecoLlmJudge(ctx: RecoUiContext, opts?: { render?: boolean; timeoutMs?: number; source?: RecoJudgeSource }): void {
			    if (this.actionsHistorical) return;

			    const gid = this.client.gameId() ?? null;
			    const sameInFlight = this.recoLoading && this.recoCtx?.decisionKey === ctx.decisionKey && (!gid || this.recoCtxGameId === gid);
			    const source: RecoJudgeSource = opts?.source ?? 'manual';
			    const sourcePrio = (s: RecoJudgeSource | null): number => (s === 'hosted' ? 3 : s === 'manual' ? 2 : s === 'auto' ? 1 : 0);
			    if (sameInFlight) {
			      // 已有同决策的 in-flight：不重复发起，但允许“升级”来源标签（用于取消策略等逻辑）。
			      const prev = this.recoInFlightSource;
			      this.recoInFlightSource = sourcePrio(source) > sourcePrio(prev) ? source : prev;
			      return;
			    }
			    if (this.recoLoading) this.cancelRecoLlmJudge();

		    this.recoCtx = ctx;
			    this.recoCtxGameId = gid;
			    this.recoError = null;
			    this.recoLoading = true;
			    this.recoInFlightSource = source;

		    if (opts?.render !== false) this.render();

		    const req = (this.recoReqSeq += 1);
		    const gameId = this.client.gameId();
			    if (gameId) {
			      this.recoCtxLast = ctx;
			      this.recoCtxLastGameId = gameId;
			    }

				    const timeout_ms = Number.isFinite(opts?.timeoutMs) ? Math.max(1000, Math.trunc(opts!.timeoutMs!)) : 120_000;
				    // 服务端要求 (0,1) 且会在 confidence_final < threshold 时回退 Top1。
				    // 托管·LLM 希望“尽量听 LLM”，因此把 threshold 设得很低，只在极端低置信时才回退。
				    const low_confidence_threshold = this.aiHostedEnabled && this.aiHostedDecisionSource === 'llm' ? 0.01 : 0.6;
				    void requestRecoLlmJudge({
				      input: ctx.input,
			      confidence_engine: ctx.confidenceEngine,
			      low_confidence_threshold,
		      timeout_ms,
		      gameId: gameId ?? undefined,
		    })
		      .then((resp) => {
			        if (req !== this.recoReqSeq) return;
			        if (this.recoCtx?.decisionKey !== ctx.decisionKey) return;
			        this.recoLoading = false;
			        this.recoInFlightSource = null;
			        this.recoResolution = resp.resolution;
        const model = typeof resp?.model === 'string' ? resp.model.trim() : '';
        if (model) this.recoModelCache.set(ctx.decisionKey, model);
	        if (gameId && this.recoCtxLast?.decisionKey === ctx.decisionKey) {
	          this.recoResolutionLast = resp.resolution;
	        }
		        this.recoCache.set(ctx.decisionKey, resp.resolution);
		        this.trimRecoCache();
		        if (this.aiHostedEnabled && this.aiHostedDecisionSource === 'llm' && resp.resolution?.source === 'fallback') {
		          const msg = '本次 LLM 不可用，已用引擎 Top1 兜底';
		          this.setAiHostedNotice(ctx.decisionKey, msg);
		        }
		        this.render();
	      })
	      .catch((err: unknown) => {
		        if (req !== this.recoReqSeq) return;
		        if (this.recoCtx?.decisionKey !== ctx.decisionKey) return;
		        this.recoLoading = false;
		        this.recoInFlightSource = null;
		        this.recoError = String((err as any)?.message ?? err);
	        if (this.aiHostedEnabled && this.aiHostedDecisionSource === 'llm') {
	          const msg = '本次 LLM 不可用，已用引擎 Top1 兜底';
	          this.setAiHostedNotice(ctx.decisionKey, msg);
	        }
	        this.render();
	      });
  }

	  private getSessionStorage(): Storage | null {
	    try {
	      const s = (globalThis as any)?.sessionStorage;
	      if (!s || typeof s.getItem !== 'function') return null;
	      return s as Storage;
	    } catch {
	      return null;
	    }
	  }

	  private loadAiHostedSettings(): void {
	    const storage = this.getSessionStorage();
	    if (!storage) return;
	    let raw: string | null = null;
	    try {
	      raw = storage.getItem(AI_HOSTED_SETTINGS_STORAGE_KEY);
	    } catch {
	      raw = null;
	    }
	    if (!raw) return;
	    try {
	      const data: any = JSON.parse(raw);
	      if (!data || typeof data !== 'object') return;
	      const v = Math.trunc(Number((data as any).v));
	      if (v !== 1) return;
	      const src = (data as any).source;
	      if (src === 'engine' || src === 'llm') {
	        this.aiHostedDecisionSource = src;
	      }
	      const delayRaw = Math.trunc(Number((data as any).delay_ms));
	      if (Number.isFinite(delayRaw)) {
	        this.aiHostedActDelayMs = Math.max(0, Math.min(30_000, delayRaw));
	      }
	    } catch {
	      // ignore invalid payload
	    }
	  }

	  private persistAiHostedSettings(): void {
	    const storage = this.getSessionStorage();
	    if (!storage) return;
	    const payload = { v: 1, source: this.aiHostedDecisionSource, delay_ms: this.aiHostedActDelayMs };
	    try {
	      storage.setItem(AI_HOSTED_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
	    } catch {
	      // ignore quota errors
	    }
	  }

	  private recoFollowupStorageKey(gameId: string): string {
	    return `${RECO_FOLLOWUP_STORAGE_PREFIX}${gameId}`;
	  }

  private trimRecoFollowupText(text: unknown): string {
    const s = String(text ?? '').trim();
    if (!s) return '';
    if (s.length <= RECO_FOLLOWUP_MAX_TEXT) return s;
    return `${s.slice(0, RECO_FOLLOWUP_MAX_TEXT)}…`;
  }

  private coerceRecoFollowupMessage(raw: any): RecoFollowupMessage | null {
    if (!raw || typeof raw !== 'object') return null;
    const role: RecoFollowupMessage['role'] | null = raw.role === 'user' || raw.role === 'assistant' ? raw.role : null;
    if (!role) return null;
    const text = this.trimRecoFollowupText(raw.text);
    if (!text) return null;
    const atRaw = Number(raw.at);
    const at = Number.isFinite(atRaw) ? Math.trunc(atRaw) : Date.now();
    return { role, text, at };
  }

	  private coerceRecoFollowupThread(raw: any): RecoFollowupThread | null {
	    if (!raw || typeof raw !== 'object') return null;
	    const decisionKey = typeof raw.decisionKey === 'string' ? raw.decisionKey.trim() : '';
	    if (!decisionKey) return null;
	    const labelRaw = typeof raw.label === 'string' ? raw.label.trim() : '';
	    const messagesRaw = Array.isArray(raw.messages) ? raw.messages : [];
	    const messages: Array<RecoFollowupMessage> = [];
		    for (const m of messagesRaw) {
		      const mm = this.coerceRecoFollowupMessage(m);
		      if (mm) messages.push(mm);
		    }
		    if (messages.length === 0) return null;
		    const createdAtRaw = Number((raw as any).createdAt);
		    const createdAt = Number.isFinite(createdAtRaw) ? Math.trunc(createdAtRaw) : messages[0]!.at;
		    const updatedAtRaw = Number(raw.updatedAt);
		    const updatedAt = Number.isFinite(updatedAtRaw) ? Math.trunc(updatedAtRaw) : messages[messages.length - 1]!.at;
		    const label = labelRaw || this.defaultRecoFollowupThreadLabel(decisionKey);
		    return { decisionKey, createdAt, updatedAt, label, messages };
		  }

	  private parseRecoStageFromDecisionKey(decisionKey: string): RecoStage | null {
	    const parts = String(decisionKey ?? '').split(';');
	    const stage = (parts[1] ?? '').trim();
	    return stage === 'exchange_3' || stage === 'choose_missing_suit' || stage === 'react' || stage === 'my_turn' ? (stage as any) : null;
	  }

	  private recoStageZhForFollowup(stage: RecoStage | null): string {
	    if (!stage) return '追问';
	    return stage === 'exchange_3'
	      ? '换三张'
	      : stage === 'choose_missing_suit'
	        ? '定缺'
	        : stage === 'react'
	          ? '响应'
	          : stage === 'my_turn'
	            ? '弃牌'
	            : String(stage);
	  }

	  private defaultRecoFollowupThreadLabel(decisionKey: string): string {
	    const stage = this.parseRecoStageFromDecisionKey(decisionKey);
	    return this.recoStageZhForFollowup(stage);
	  }

	  private splitStageZhForFollowup(stage: SplitStage | null | undefined): string {
	    return stage === 'early' ? '早局' : stage === 'mid' ? '中局' : stage === 'late' ? '后局' : '牌局';
	  }

	  private tileZhFromTileCode(code: string): string {
	    const key = this.parseTileCodeToTileKey(code);
	    return key !== null ? tileLabel(key) : String(code ?? '').trim();
	  }

	  private describeRecoActionForFollowup(action: RecoAction): string {
	    if (!action || typeof action !== 'object') return '推荐';
	    if (action.type === 'discard') {
	      return `推荐出 ${this.tileZhFromTileCode(action.tile)}`;
	    }
	    if (action.type === 'exchange_3') {
	      const parts = Array.isArray((action as any).tiles) ? (action as any).tiles.map((t: any) => String(t ?? '').trim()).filter((s: string) => !!s) : [];
	      return parts.length > 0 ? `推荐换 ${parts.join('/')}` : '推荐换三张';
	    }
	    if (action.type === 'choose_missing_suit') {
	      return `推荐定缺 ${this.suitZh((action as any).suit)}`;
	    }
	    if (action.type === 'peng') {
	      return `推荐碰 ${this.tileZhFromTileCode((action as any).tile)}`;
	    }
	    if (action.type === 'ming_gang') {
	      return `推荐明杠 ${this.tileZhFromTileCode((action as any).tile)}`;
	    }
	    if (action.type === 'jia_gang') {
	      return `推荐加杠 ${this.tileZhFromTileCode((action as any).tile)}`;
	    }
	    if (action.type === 'an_gang') {
	      return `推荐暗杠 ${this.tileZhFromTileCode((action as any).tile)}`;
	    }
	    if (action.type === 'hu') {
	      const m = (action as any).method;
	      return m === 'zimo' ? '推荐胡（自摸）' : m === 'qianggang' ? '推荐胡（抢杠）' : '推荐胡（点炮）';
	    }
	    if (action.type === 'pass') {
	      return '推荐过';
	    }
	    return '推荐';
	  }

	  private buildRecoFollowupThreadLabel(params: { snap: SplitSnapshot; stage: RecoStage; action: RecoAction }): string {
	    const stageLabel = this.splitStageZhForFollowup(params.snap?.stage);
	    const phaseLabel =
	      params.stage === 'my_turn'
	        ? params.action.type === 'discard'
	          ? '弃牌'
	          : params.action.type === 'hu'
	            ? '胡牌'
	            : params.action.type === 'an_gang' || params.action.type === 'jia_gang' || params.action.type === 'ming_gang'
	              ? '杠'
	              : '我的回合'
	        : this.recoStageZhForFollowup(params.stage);
	    const actionText = this.describeRecoActionForFollowup(params.action);
	    return `${stageLabel} · ${phaseLabel} · ${actionText}`;
	  }

		  private ensureRecoFollowupThreadsLoaded(gameId: string): void {
		    if (this.recoFollowupGameId === gameId) return;
		    this.recoFollowupGameId = gameId;
		    this.recoFollowupThreads.clear();
		    this.resetRecoFollowupDom();
		    this.recoFollowupNotice = null;
		    const storage = this.getSessionStorage();
		    if (!storage) return;
    const key = this.recoFollowupStorageKey(gameId);
    let raw: string | null = null;
    try {
      raw = storage.getItem(key);
    } catch {
      raw = null;
    }
	    if (!raw) return;
	    try {
	      const data: any = JSON.parse(raw);
	      if (!data || typeof data !== 'object') return;
	      const v = Math.trunc(Number((data as any).v));
	      if (v !== 1 && v !== 2) return;
	      if (typeof data.gameId !== 'string' || data.gameId !== gameId) return;
	      const threadsRaw = Array.isArray(data.threads) ? data.threads : [];
	      for (const t of threadsRaw) {
	        const tt = this.coerceRecoFollowupThread(t);
        if (tt) this.recoFollowupThreads.set(tt.decisionKey, tt);
      }
      this.pruneRecoFollowupThreads();
    } catch {
      // ignore invalid payload
    }
  }

	  private pruneRecoFollowupThreads(): void {
	    if (this.recoFollowupThreads.size === 0) return;

	    for (const [k, t] of Array.from(this.recoFollowupThreads.entries())) {
	      const trimmed: Array<RecoFollowupMessage> = [];
	      for (const m of t.messages) {
	        const text = this.trimRecoFollowupText(m.text);
	        if (!text) continue;
	        const atRaw = Number(m.at);
	        const at = Number.isFinite(atRaw) ? Math.trunc(atRaw) : Date.now();
	        trimmed.push({ role: m.role, text, at });
	      }
		      if (trimmed.length === 0) {
		        this.recoFollowupThreads.delete(k);
		        continue;
		      }
		      const createdAtRaw = Number((t as any).createdAt);
		      const createdAt = Number.isFinite(createdAtRaw) ? Math.trunc(createdAtRaw) : trimmed[0]!.at;
		      const updatedAtRaw = Number(t.updatedAt);
		      const updatedAt = Number.isFinite(updatedAtRaw) ? Math.trunc(updatedAtRaw) : trimmed[trimmed.length - 1]!.at;
		      const label = typeof (t as any).label === 'string' && String((t as any).label).trim() ? String((t as any).label).trim() : this.defaultRecoFollowupThreadLabel(t.decisionKey);
		      this.recoFollowupThreads.set(k, { decisionKey: t.decisionKey, createdAt, updatedAt, label, messages: trimmed });
		    }
		  }

	  private persistRecoFollowupThreads(gameId: string): void {
	    const storage = this.getSessionStorage();
	    if (!storage) return;
	    const key = this.recoFollowupStorageKey(gameId);
	    const tryWrite = (): boolean => {
	      const threads = Array.from(this.recoFollowupThreads.values()).sort((a, b) => a.createdAt - b.createdAt);
	      const payload: RecoFollowupStoragePayload = { v: 2, gameId, threads };
	      try {
	        if (threads.length === 0) storage.removeItem(key);
	        else storage.setItem(key, JSON.stringify(payload));
	        return true;
	      } catch {
	        return false;
	      }
	    };

	    if (tryWrite()) return;

	    // sessionStorage 配额不足：删除旧的，保留新的（整局全量的上限由浏览器容量决定）。
	    let trimmed = false;
	    for (let i = 0; i < RECO_FOLLOWUP_PERSIST_TRIM_MAX_ITERS && this.recoFollowupThreads.size > 0; i++) {
	      trimmed = true;
	      const oldest = Array.from(this.recoFollowupThreads.values()).sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
	      if (!oldest) break;
	      if (this.recoFollowupThreads.size > 1) {
	        this.recoFollowupThreads.delete(oldest.decisionKey);
	      } else {
	        const msgs = oldest.messages ?? [];
	        if (msgs.length <= 2) {
	          this.recoFollowupThreads.delete(oldest.decisionKey);
	        } else {
	          const cut = Math.max(1, Math.min(RECO_FOLLOWUP_PERSIST_TRIM_MAX_CUT, Math.floor(msgs.length / 3)));
	          const kept = msgs.slice(cut);
	          const createdAt = kept[0]?.at ?? Date.now();
	          const updatedAt = kept[kept.length - 1]?.at ?? createdAt;
	          this.recoFollowupThreads.set(oldest.decisionKey, { ...oldest, createdAt, updatedAt, messages: kept });
	        }
	      }
	      this.pruneRecoFollowupThreads();
	      if (tryWrite()) {
	        this.recoFollowupNotice = '历史过长，已自动清理最早部分（保留最新）';
	        return;
	      }
	    }
	    if (trimmed) {
	      this.recoFollowupNotice = '历史过长，无法持久化全部内容（保留最新）';
	    }
	  }

	  private upsertRecoFollowupThread(params: {
	    gameId: string;
	    decisionKey: string;
	    messages: Array<RecoFollowupMessage>;
	    label?: string | null;
	    createdAt?: number | null;
	  }): void {
	    this.ensureRecoFollowupThreadsLoaded(params.gameId);
		    const filtered = params.messages
		      .map((m) => this.coerceRecoFollowupMessage(m))
		      .filter((m): m is RecoFollowupMessage => !!m)
		      .slice();
		    if (filtered.length === 0) {
		      this.recoFollowupThreads.delete(params.decisionKey);
		    } else {
		      const existing = this.recoFollowupThreads.get(params.decisionKey) ?? null;
	      const createdAtRaw = Number(params.createdAt);
	      const createdAt = existing?.createdAt ?? (Number.isFinite(createdAtRaw) ? Math.trunc(createdAtRaw) : filtered[0]!.at);
	      const updatedAt = filtered[filtered.length - 1]!.at;
	      const label = (typeof params.label === 'string' && params.label.trim()) ? params.label.trim() : existing?.label ?? this.defaultRecoFollowupThreadLabel(params.decisionKey);
	      this.recoFollowupThreads.set(params.decisionKey, { decisionKey: params.decisionKey, createdAt, updatedAt, label, messages: filtered });
	    }
	    this.pruneRecoFollowupThreads();
	    this.persistRecoFollowupThreads(params.gameId);
	  }

		  private loadRecoFollowupMessages(decisionKey: string): Array<RecoFollowupMessage> {
		    const t = this.recoFollowupThreads.get(decisionKey) ?? null;
		    return t ? t.messages.slice() : [];
		  }

		  private resetRecoFollowupDom(): void {
		    this.recoFollowupDomGameId = null;
		    this.recoFollowupDomThreadOrder = [];
		    this.recoFollowupDomThreads.clear();
		    this.recoFollowupDomTipEl = null;
		    this.recoFollowupDomNoticeEl = null;
		    this.recoFollowupDomStatusEl = null;
		    this.recoFollowupDomStreamingEl = null;
		    this.recoFollowupDomStreamingDecisionKey = null;
		    try {
		      this.followupLogEl.innerHTML = '';
		    } catch {}
		  }

		  private isRecoFollowupNearBottom(thresholdPx = 16): boolean {
		    try {
		      const el = this.followupLogEl;
		      const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight);
	      return remaining <= thresholdPx;
	    } catch {
	      return true;
	    }
	  }

			  private onRecoFollowupScroll(): void {
			    if (!this.followupPanel.isConnected) return;
			    if (this.recoFollowupSuppressScroll) return;
			    this.recoFollowupPinned = this.isRecoFollowupNearBottom();
			  }

		  private setRecoFollowupPanelVisible(visible: boolean): void {
		    this.followupPanel.classList.toggle('hidden', !visible);
		    this.bodyEl.classList.toggle('has-followup', visible);
		  }

  private scheduleRecoFollowupAfterRender(): void {
    if (this.recoFollowupAfterRenderScheduled) return;
    this.recoFollowupAfterRenderScheduled = true;
    window.requestAnimationFrame(() => {
		      this.recoFollowupAfterRenderScheduled = false;
		      if (!this.recoFollowupOpen) return;
		      if (!this.followupPanel.isConnected) return;
		      if (this.followupPanel.classList.contains('hidden')) return;

	      const shouldFocus = this.recoFollowupFocusPending;
	      const shouldScrollToBottom = this.recoFollowupScrollPending || this.recoFollowupPinned;
	      const restoreTop = shouldScrollToBottom ? null : this.recoFollowupRestoreScrollTop;
	      this.recoFollowupFocusPending = false;
	      this.recoFollowupScrollPending = false;
	      this.recoFollowupRestoreScrollTop = null;

	      if (shouldFocus) {
	        try {
	          this.followupInput.focus();
	          const len = this.followupInput.value.length;
	          try {
	            this.followupInput.setSelectionRange(len, len);
	          } catch {}
	        } catch {}
	      }
	      if (shouldScrollToBottom) {
	        this.followupLogEl.scrollTop = this.followupLogEl.scrollHeight;
	      } else if (restoreTop !== null) {
	        this.followupLogEl.scrollTop = restoreTop;
	      }
    });
  }

  private isRecoFollowupAllowedInHistorical(snap: SplitSnapshot | null): boolean {
    try {
      const phase = snap?.blood?.phase ?? null;
      return phase === 'settling' || phase === 'done';
    } catch {
      return false;
    }
  }

  private buildHandFollowupDecisionKey(params: { gameId: string; seat: number }): string {
    return `handfree.v1;my_turn;gid=${params.gameId};seat=${params.seat}`;
  }

  private isHandFollowupDecisionKey(decisionKey: string | null): boolean {
    return typeof decisionKey === 'string' && decisionKey.startsWith('handfree.v1;');
  }

  private buildFreeChatFollowupDecisionKey(params: { gameId: string }): string {
    return `freechat.v1;gid=${params.gameId}`;
  }

  private isFreeChatFollowupDecisionKey(decisionKey: string | null): boolean {
    return typeof decisionKey === 'string' && decisionKey.startsWith('freechat.v1;');
  }

  private isFreeFollowupDecisionKey(decisionKey: string | null): boolean {
    return this.isHandFollowupDecisionKey(decisionKey) || this.isFreeChatFollowupDecisionKey(decisionKey);
  }

  private pickRecoFollowupDecisionKey(ctx: RecoUiContext | null): string | null {
    const snap = this.snapshot;
    const gid = this.client.gameId();
    const wantHandFollowup = (() => {
      if (!snap || !snap.ok) return false;
      if (snap.blood.phase !== 'playing') return false;
      if (this.isSelfClaimWindow(snap)) return false;
      return !snap.canSelfTurnAct;
    })();
    if (wantHandFollowup) {
      if (!gid || !snap || !snap.ok) return null;
      return this.buildHandFollowupDecisionKey({ gameId: gid, seat: snap.seat });
    }
    if (ctx?.decisionKey) return ctx.decisionKey;
    if (gid) return this.buildFreeChatFollowupDecisionKey({ gameId: gid });
    return null;
  }

  private canUseRecoFollowupNow(snap: SplitSnapshot | null): boolean {
    const gid = this.client.gameId();
    // “追问”在牌局界面内应始终可用；在未开局/未坐下等情况下，后端会按 free 模式兜底。
    return this.recoAiEnabled && !!gid;
  }

  private getRecoCtxForFollowup(): RecoUiContext | null {
    const gid = this.client.gameId();
    if (gid && this.recoCtx && this.recoCtxGameId === gid) return this.recoCtx;
    if (gid && this.recoCtxLast && this.recoCtxLastGameId === gid) return this.recoCtxLast;
    return null;
  }

  private getRecoResolutionForDecisionKey(decisionKey: string): RecoResolution | null {
    if (this.recoCtx?.decisionKey === decisionKey) return this.recoResolution;
    if (this.recoCtxLast?.decisionKey === decisionKey) return this.recoResolutionLast;
    return this.recoCache.get(decisionKey) ?? null;
  }

  private toggleRecoFollowup(): void {
    const snap = this.snapshot;
    if (!this.canUseRecoFollowupNow(snap)) return;
    const ctx = this.getRecoCtxForFollowup();
    const gid = this.client.gameId();
    if (gid) this.ensureRecoFollowupThreadsLoaded(gid);
    const decisionKey = this.pickRecoFollowupDecisionKey(ctx);
    if (!decisionKey) return;

    if (!this.isFreeFollowupDecisionKey(decisionKey)) {
      if (!ctx) return;
      const resolution = this.getRecoResolutionForDecisionKey(ctx.decisionKey);
      const chosenCandidateId = resolution ? resolution.chosen_candidate_id : ctx.input.engine_top1_candidate_id;
      const hasChosen = ctx.input.candidates_topk.some((c) => c.candidate_id === chosenCandidateId);
      if (!hasChosen) return;
    }

	  const same = this.recoFollowupDecisionKey === decisionKey;
	  const nextOpen = same ? !this.recoFollowupOpen : true;
	  this.recoFollowupDecisionKey = decisionKey;
	  this.recoFollowupOpen = nextOpen;
	  if (!same) {
	    this.recoFollowupMessages = this.loadRecoFollowupMessages(decisionKey);
	    this.followupInput.value = '';
	  }
		  if (nextOpen) {
		    // 进入追问：关闭“自动裁决”（不影响托管），避免对话过程中自动裁决继续扣费/上下文跳变。
		    this.setRecoAutoJudgeEnabled(false, { cancelInflight: true, render: false });
		      // 打开追问面板：默认吸底（最新一条），之后仅在用户处于底部时才自动跟随新增/流式。
		      this.recoFollowupPinned = true;
		      this.recoFollowupRestoreScrollTop = null;
		    }
	    this.recoFollowupFocusPending = nextOpen;
	    this.render();
	  }

  private normalizeClientRequestId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const s = value.trim();
    return s ? s : null;
  }

		  private ensureRecoFollowupLogDom(gameId: string | null): void {
		    const gid = gameId ?? null;
		    if (this.recoFollowupDomGameId !== gid) {
		      this.recoFollowupDomGameId = gid;
		      this.recoFollowupDomThreadOrder = [];
		      this.recoFollowupDomThreads.clear();
		      this.recoFollowupDomTipEl = null;
		      this.recoFollowupDomNoticeEl = null;
		      this.recoFollowupDomStatusEl = null;
		      this.recoFollowupDomStreamingEl = null;
		      this.recoFollowupDomStreamingDecisionKey = null;
		      try {
		        this.followupLogEl.innerHTML = '';
		      } catch {}
		    }

			    if (!this.recoFollowupDomTipEl) {
			      const tip = document.createElement('div');
			      tip.className = 'split-followup-tip';
			      tip.textContent = '在这里追问：可问当前手牌怎么打，也可复盘推荐与解释指标。';
			      tip.style.display = 'none';
			      this.recoFollowupDomTipEl = tip;
			    }
		    if (!this.recoFollowupDomNoticeEl) {
		      const note = document.createElement('div');
		      note.className = 'split-followup-status is-notice';
		      note.style.display = 'none';
		      this.recoFollowupDomNoticeEl = note;
		    }
		    if (!this.recoFollowupDomStatusEl) {
		      const st = document.createElement('div');
		      st.className = 'split-followup-status';
		      st.style.display = 'none';
		      this.recoFollowupDomStatusEl = st;
		    }

		    const el = this.followupLogEl;
		    const tip = this.recoFollowupDomTipEl;
		    const notice = this.recoFollowupDomNoticeEl;
		    const status = this.recoFollowupDomStatusEl;
		    if (tip && tip.parentElement !== el) el.appendChild(tip);
		    if (notice && notice.parentElement !== el) el.appendChild(notice);
		    if (status && status.parentElement !== el) el.appendChild(status);

		    // 确保它们始终位于最末尾：... tip → notice → status
		    if (status && el.lastChild !== status) el.appendChild(status);
		    if (notice && status && status.previousSibling !== notice) el.insertBefore(notice, status);
		    if (tip && notice && notice.previousSibling !== tip) el.insertBefore(tip, notice);
		  }

		  private syncRecoFollowupLogDom(params: {
		    gameId: string | null;
		    activeStreaming: { clientRequestId: string; decisionKey: string; text: string } | null;
		    inflight: boolean;
		  }): void {
		    this.ensureRecoFollowupLogDom(params.gameId);
		    const tipEl = this.recoFollowupDomTipEl;
		    const noticeEl = this.recoFollowupDomNoticeEl;
		    const statusEl = this.recoFollowupDomStatusEl;
		    if (!tipEl || !noticeEl || !statusEl) return;

		    const allThreads = Array.from(this.recoFollowupThreads.values()).sort((a, b) => a.createdAt - b.createdAt);
		    const threads = allThreads.filter((t) => Array.isArray(t.messages) && t.messages.length > 0);
		    const desiredKeys = threads.map((t) => t.decisionKey);
		    const desiredSet = new Set<string>(desiredKeys);

		    for (const [k, dom] of Array.from(this.recoFollowupDomThreads.entries())) {
		      if (desiredSet.has(k)) continue;
		      try {
		        dom.root.remove();
		      } catch {}
		      this.recoFollowupDomThreads.delete(k);
		    }
		    this.recoFollowupDomThreadOrder = this.recoFollowupDomThreadOrder.filter((k) => desiredSet.has(k));

		    for (const t of threads) {
		      const key = t.decisionKey;
		      let dom = this.recoFollowupDomThreads.get(key) ?? null;
		      if (!dom) {
		        const root = document.createElement('div');
		        root.className = 'split-followup-thread';
		        const divider = document.createElement('div');
		        divider.className = 'split-followup-divider';
		        root.appendChild(divider);
		        this.followupLogEl.insertBefore(root, tipEl);
		        dom = { root, divider, msgsEl: root, renderedLen: 0, label: '' };
		        this.recoFollowupDomThreads.set(key, dom);
		        this.recoFollowupDomThreadOrder.push(key);
		      }

		      const label = String(t.label ?? '').trim() || '追问';
		      const dividerText = `—— ${label} ——`;
		      if (dom.label !== label || dom.divider.textContent !== dividerText) {
		        dom.divider.textContent = dividerText;
		        dom.label = label;
		      }

		      const msgs = t.messages ?? [];
		      if (msgs.length < dom.renderedLen) {
		        // 极少数情况下（例如 sessionStorage 触发自动清理）消息会变短：对该 thread 做一次“局部重建”。
		        while (dom.root.childNodes.length > 1) dom.root.removeChild(dom.root.lastChild!);
		        dom.renderedLen = 0;
		      }
		      for (let i = dom.renderedLen; i < msgs.length; i++) {
		        const msg = msgs[i]!;
		        const row = document.createElement('div');
		        row.className = `split-followup-msg${msg.role === 'user' ? ' is-user' : ' is-assistant'}`;
		        row.appendChild(renderFollowupRichText(msg.text));
		        dom.root.appendChild(row);
		      }
		      dom.renderedLen = msgs.length;
		    }

		    const desiredKeySig = desiredKeys.join('|');
		    const currentKeySig = this.recoFollowupDomThreadOrder.join('|');
		    if (desiredKeySig !== currentKeySig) {
		      for (const k of desiredKeys) {
		        const dom = this.recoFollowupDomThreads.get(k) ?? null;
		        if (dom) this.followupLogEl.insertBefore(dom.root, tipEl);
		      }
		      this.recoFollowupDomThreadOrder = desiredKeys;
		    }

		    const streaming = params.activeStreaming && params.activeStreaming.text ? params.activeStreaming : null;
		    if (streaming) {
		      const k = streaming.decisionKey;
		      const dom = this.recoFollowupDomThreads.get(k) ?? null;
		      if (dom) {
		        if (!this.recoFollowupDomStreamingEl) {
		          const row = document.createElement('div');
		          row.className = 'split-followup-msg is-assistant';
		          this.recoFollowupDomStreamingEl = row;
		        }
		        if (this.recoFollowupDomStreamingDecisionKey !== k) {
		          try {
		            this.recoFollowupDomStreamingEl.remove();
		          } catch {}
		          dom.root.appendChild(this.recoFollowupDomStreamingEl);
		          this.recoFollowupDomStreamingDecisionKey = k;
		        }
		        this.recoFollowupDomStreamingEl.innerHTML = '';
		        this.recoFollowupDomStreamingEl.appendChild(renderFollowupRichText(streaming.text));
		      }
		    } else if (this.recoFollowupDomStreamingEl) {
		      try {
		        this.recoFollowupDomStreamingEl.remove();
		      } catch {}
		      this.recoFollowupDomStreamingDecisionKey = null;
		    }

		    const hasAny = desiredKeys.length > 0 || !!streaming;
		    tipEl.style.display = hasAny ? 'none' : 'block';

			    const noticeText = [this.recoFollowupContextNotice, this.recoFollowupNotice].filter((x) => !!x).join(' / ');
			    if (noticeText) {
			      noticeEl.textContent = noticeText;
			      noticeEl.style.display = 'block';
			    } else {
			      noticeEl.textContent = '';
			      noticeEl.style.display = 'none';
			    }

		    if (this.recoFollowupError) {
		      statusEl.className = 'split-followup-status is-error';
		      statusEl.textContent = this.recoFollowupError;
		      statusEl.style.display = 'block';
		    } else if (params.inflight) {
		      statusEl.className = 'split-followup-status';
		      statusEl.textContent = 'AI 回复中...';
		      statusEl.style.display = 'block';
		    } else {
		      statusEl.className = 'split-followup-status';
		      statusEl.textContent = '';
		      statusEl.style.display = 'none';
		    }
		  }

  private renderRecoFollowupPanel(params?: { resolution: RecoResolution | null }): HTMLElement {
    const enabled = this.canUseRecoFollowupNow(this.snapshot);
    const inflight = this.recoFollowupInflight !== null;
    // 追问始终可用：在非操作窗口/未开局/未坐下时给一行提示，避免误解。
	    const snap = this.snapshot;
	    const dk = this.recoFollowupDecisionKey;
	    const parts: Array<string> = [];
	    if (this.isFreeFollowupDecisionKey(dk)) {
	      if (!snap || !snap.ok) {
	        parts.push('自由追问：暂时无法读取你的手牌（未开局/未坐下），将按通用策略回答');
	      } else if (snap.blood.phase === 'playing' && !snap.canSelfTurnAct && !this.isSelfClaimWindow(snap)) {
	        parts.push('自由追问：当前非操作窗口，候选TopN为历史参考');
	      }
	    }
	    if (this.aiHostedEnabled) {
	      parts.push(
	        this.aiHostedDecisionSource === 'llm'
	          ? '托管·LLM 运行中：追问不暂停托管，仍会自动出牌并请求裁决'
	          : '托管·Top1 运行中：追问不暂停托管，仍会自动出牌',
	      );
	    }
	    this.recoFollowupContextNotice = parts.length > 0 ? parts.join(' / ') : null;
			    const activeStreaming =
			      inflight && this.recoFollowupInflight && this.recoFollowupStreaming && this.recoFollowupStreaming.clientRequestId === this.recoFollowupInflight.clientRequestId
			        ? this.recoFollowupStreaming
			        : null;

		    const gid = this.client.gameId();
		    if (gid) this.ensureRecoFollowupThreadsLoaded(gid);

		    this.recoFollowupSuppressScroll = true;
		    try {
		      this.syncRecoFollowupLogDom({ gameId: gid, activeStreaming, inflight });
		    } finally {
		      this.recoFollowupSuppressScroll = false;
		    }

		    this.followupChipsEl.innerHTML = '';
			    const chipsRaw = params?.resolution?.llm_output?.followups_supported;
		    const chipTexts: Array<{ text: string; display: string }> = [];
		    const seen = new Set<string>();
		    const source = Array.isArray(chipsRaw) && chipsRaw.length > 0 ? chipsRaw : RECO_FOLLOWUP_DEFAULT_CHIPS;
			    for (const raw of source) {
			      const text = typeof raw === 'string' ? raw.trim() : '';
			      if (!text) continue;
			      if (seen.has(text)) continue;
			      seen.add(text);
			      chipTexts.push({ text, display: text.length > 24 ? `${text.slice(0, 24)}…` : text });
			      if (chipTexts.length >= 5) break;
			    }
			    for (const t of chipTexts) {
			      const chip = document.createElement('button');
			      chip.type = 'button';
			      chip.className = 'split-followup-chip';
			      chip.textContent = t.display;
		      chip.disabled = !enabled || inflight;
		      chip.onclick = () => {
		        if (!enabled || inflight) return;
		        this.followupInput.value = t.text;
		        void this.sendRecoFollowup();
		      };
			      this.followupChipsEl.appendChild(chip);
			    }

				    const isFreeFollowup = this.isFreeFollowupDecisionKey(this.recoFollowupDecisionKey);
				    const placeholder = isFreeFollowup ? '追问：可问当前手牌怎么打，也可以随便聊' : '追问：为什么更稳？向听/进张/安全怎么算？';
				    if (this.followupInput.placeholder !== placeholder) this.followupInput.placeholder = placeholder;

			    this.followupInput.disabled = !enabled || inflight;
			    this.followupSendBtn.disabled = !enabled || inflight;
		    // 追问面板常驻 DOM：只在需要时做 focus/吸底。
		    if (this.recoFollowupFocusPending || this.recoFollowupScrollPending || this.recoFollowupPinned) {
		      this.scheduleRecoFollowupAfterRender();
		    }
		    return this.followupPanel;
		  }

  private buildRecoFollowupHistoryBlock(maxMessages = 8): string {
    const recent = this.recoFollowupMessages.slice(Math.max(0, this.recoFollowupMessages.length - maxMessages));
    if (recent.length === 0) return '';
    const lines: Array<string> = [];
    for (const m of recent) {
      const role = m.role === 'user' ? '用户' : '助手';
      const text = String(m.text ?? '').trim();
      if (!text) continue;
      lines.push(`${role}：${text.length > 240 ? `${text.slice(0, 240)}…` : text}`);
    }
    if (lines.length === 0) return '';
    return `\n\n【对话历史（最近${lines.length}条）】\n${lines.join('\n')}`;
  }

  private describeRecoCandidateActionForFollowup(action: RecoAction): string {
    if (!action || typeof action !== 'object') return '动作';
    if (action.type === 'discard') {
      const code = String((action as any).tile ?? '').trim();
      return `出 ${this.tileZhFromTileCode(code)}${code ? `(${code})` : ''}`;
    }
    if (action.type === 'exchange_3') {
      const tiles = Array.isArray((action as any).tiles)
        ? (action as any).tiles.map((t: any) => String(t ?? '').trim()).filter((s: string) => !!s)
        : [];
      if (tiles.length <= 0) return '换三张';
      const zh = tiles.map((t: string) => this.tileZhFromTileCode(t)).join('/');
      const raw = tiles.join('/');
      return `换 ${zh}（${raw}）`;
    }
    if (action.type === 'choose_missing_suit') {
      const suit = String((action as any).suit ?? '').trim();
      return `定缺 ${this.suitZh(suit as any)}${suit ? `(${suit})` : ''}`;
    }
    if (action.type === 'peng') {
      const code = String((action as any).tile ?? '').trim();
      return `碰 ${this.tileZhFromTileCode(code)}${code ? `(${code})` : ''}`;
    }
    if (action.type === 'ming_gang') {
      const code = String((action as any).tile ?? '').trim();
      return `明杠 ${this.tileZhFromTileCode(code)}${code ? `(${code})` : ''}`;
    }
    if (action.type === 'jia_gang') {
      const code = String((action as any).tile ?? '').trim();
      return `加杠 ${this.tileZhFromTileCode(code)}${code ? `(${code})` : ''}`;
    }
    if (action.type === 'an_gang') {
      const code = String((action as any).tile ?? '').trim();
      return `暗杠 ${this.tileZhFromTileCode(code)}${code ? `(${code})` : ''}`;
    }
    if (action.type === 'hu') {
      const m = (action as any).method;
      return m === 'zimo' ? '胡（自摸）' : m === 'qianggang' ? '胡（抢杠）' : '胡（点炮）';
    }
    if (action.type === 'pass') return '过';
    return '动作';
  }

  private compactRecoFollowupCandidateFactText(text: string): string {
    const raw = String(text ?? '').trim();
    if (!raw) return '';
    return raw
      .replace(/（越大越好）/g, '')
      .replace(/（越小越好）/g, '')
      .replace(/（不可用，请忽略该指标）/g, '')
      .trim();
  }

  private buildRecoFollowupCandidatesBlock(params: { ctx: RecoUiContext; chosenCandidateId: string }): string {
    const candidates = params.ctx.input.candidates_topk.slice(0, 20);
    if (candidates.length <= 0) return '';
    const lines: Array<string> = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!;
      const marks: Array<string> = [];
      if (c.candidate_id === params.chosenCandidateId) marks.push('最终选择');
      if (c.candidate_id === params.ctx.input.engine_top1_candidate_id) marks.push('引擎Top1');
      const markText = marks.length > 0 ? `【${marks.join('+')}】` : '';

      const label = this.describeRecoCandidateActionForFollowup(c.action as any);
      const factParts = c.explain_facts.facts
        .filter((f) => {
          const m = /^.+::(.+)$/.exec(String(f.id ?? '').trim());
          return m ? m[1] !== 'state.missing_suit' : true;
        })
        .map((f) => this.compactRecoFollowupCandidateFactText(f.text))
        .filter((s) => !!s);
      const factsText = factParts.length > 0 ? `：${factParts.join(' · ')}` : '';
      lines.push(`${i + 1}) ${markText}${label}${factsText}`);
    }
    return `\n\n【候选对比表（按引擎排序，最多${lines.length}条；用于回答“为什么不推荐X”）】\n${lines.join('\n')}`;
  }

  private async sendRecoFollowup(): Promise<void> {
    const snap = this.snapshot;
    if (!this.canUseRecoFollowupNow(snap)) return;
    if (this.recoFollowupInflight) return;

    const q = this.followupInput.value.trim();
    if (!q) {
      this.recoFollowupError = '请输入追问内容';
      this.render();
      return;
    }

    const gid = this.client.gameId();
    const ctx = this.getRecoCtxForFollowup();
    const decisionKey = this.recoFollowupDecisionKey ?? this.pickRecoFollowupDecisionKey(ctx);
    if (!decisionKey) {
      this.recoFollowupError = '当前不可追问';
      this.render();
      return;
    }

    if (!gid) {
      this.recoFollowupError = '当前不可追问';
      this.render();
      return;
    }

    if (this.isFreeFollowupDecisionKey(decisionKey)) {
      const scene: AiScene = (() => {
        if (!snap || !snap.ok) return 'turn';
        if (snap.blood.phase === 'swap3') return 'swap3';
        if (snap.blood.phase === 'dingque') return 'dingque';
        const pending: any = (snap.blood as any)?.pending ?? null;
        return pending && pending.kind === 'claim' ? 'claim' : 'turn';
      })();
      const computedSnapshotId =
        snap && snap.ok ? await this.computeAiSnapshotId({ blood: snap.blood, seat: snap.seat, scene }) : null;
      const snapshotId = computedSnapshotId || `free-${Date.now()}`;

      const historyBlock = this.buildRecoFollowupHistoryBlock(8);
      const tiles = snap && snap.ok ? tilesFromCounts(snap.handCounts14).sort((a, b) => a - b) : [];
      const handCodes = tiles.map((t) => tileCode(t)).join(' ');
      const handZh = tiles.map((t) => tileLabel(t)).join(' ');
      const context = snap && snap.ok
        ? {
            seat_id: snap.seat,
            stage: snap.stage,
            missing_suit: snap.myDingque,
            blockedByDingque: this.hasDingqueTiles(snap),
            wall_remaining: snap.wallRemaining,
            alive_player_count: this.computeAlivePlayerCount(snap.blood),
            my_hand_size: this.totalTileCount(snap.handCounts14),
            turn_seat: snap.blood.turnSeat,
            turn_step: snap.blood.turnStep,
            pending_kind: (snap.blood as any)?.pending ? String(((snap.blood as any).pending as any).kind ?? '') : null,
          }
        : {
            seat_id: null,
            stage: null,
            missing_suit: null,
            blockedByDingque: null,
            wall_remaining: null,
            alive_player_count: null,
            my_hand_size: null,
            turn_seat: null,
            turn_step: null,
            pending_kind: null,
          };

      const prompt = `你是血战到底麻将“拆牌面板”的追问助手。

你可以基于【当前牌局信息】回答用户关于当前手牌、策略、术语解释的任何问题；用户也可能闲聊，请正常回答。
如果用户的问题需要更多信息（例如对手弃牌河/副露明细）而当前信息里没有，请先说明“信息不足”，再给一般性建议。

注意：拆牌面板在等待态展示的候选TopN可能是“上次计算”的历史结果；如果与当前手牌不一致，以【当前手牌】为准。

如果当前无法读取手牌（未开局/未坐下），请明确提示“手牌信息不足”，再按通用原则回答。

【当前牌局信息（结构化）】
${JSON.stringify(context, null, 2)}

【当前手牌】
- tileCode: ${handCodes || '--'}
- 中文: ${handZh || '--'}${historyBlock}

【用户追问】
{{QUESTION}}

请用中文回答，尽量短、口语化。`;

      const threadLabel = snap && snap.ok ? `${this.splitStageZhForFollowup(snap.stage)} · 当前手牌` : '自由追问';
      const clientRequestId = `split-followup-${Date.now()}-${++this.recoFollowupReqSeq}`;
      this.recoFollowupDecisionKey = decisionKey;
      this.recoFollowupError = null;
      this.recoFollowupStrictFallback = null;
      this.recoFollowupPinned = true;
      this.recoFollowupRestoreScrollTop = null;
      this.recoFollowupInflight = { clientRequestId, decisionKey, mode: 'free' };
      this.recoFollowupStreaming = null;
      this.recoFollowupScrollPending = false;
      this.recoFollowupMessages = [...this.recoFollowupMessages, { role: 'user', text: this.trimRecoFollowupText(q), at: Date.now() }];
      this.upsertRecoFollowupThread({ gameId: gid, decisionKey, messages: this.recoFollowupMessages, label: threadLabel, createdAt: Date.now() });
      this.followupInput.value = '';
      this.recoFollowupFocusPending = true;
      this.render();

      this.client.aiFollowup({
        clientRequestId,
        gameId: gid,
        scene,
        snapshotId,
        followupMode: 'free',
        prompt,
        question: q,
      });
      return;
    }

    if (!ctx) {
      this.recoFollowupError = '当前不可追问';
      this.render();
      return;
    }
    if (!snap || !snap.ok) {
      this.recoFollowupError = '当前不可追问';
      this.render();
      return;
    }

    const stage = ctx.input.state_summary.stage;
    const scene = this.stageToAiScene(stage);
    const computedSnapshotId = await this.computeAiSnapshotId({ blood: snap.blood, seat: snap.seat, scene });
    const followupMode: AiFollowupMode = computedSnapshotId ? 'strict' : 'free';
    const snapshotId = computedSnapshotId || `free-${Date.now()}`;

    const resolution = this.getRecoResolutionForDecisionKey(ctx.decisionKey);
    const chosenCandidateId = resolution ? resolution.chosen_candidate_id : ctx.input.engine_top1_candidate_id;
    const chosen = ctx.input.candidates_topk.find((c) => c.candidate_id === chosenCandidateId) ?? null;
    if (!chosen) {
      this.recoFollowupError = '推荐已变化，请刷新拆牌';
      this.render();
      return;
    }

    const historyBlock = this.buildRecoFollowupHistoryBlock(8);
    const candidatesBlock = this.buildRecoFollowupCandidatesBlock({ ctx, chosenCandidateId });

    const riskTags = this.computeRecoRiskTags({
      stage: ctx.stage,
      blockedByDingque: ctx.input.state_summary.blockedByDingque,
      chosen,
    });
    const riskTagText = (t: RiskTagId): string =>
      t === 'must_clear_missing_suit'
        ? '清缺中'
        : t === 'breaks_tenpai'
          ? '可能退听'
          : t === 'high_fangchong_risk'
            ? '放铳风险高'
            : t === 'low_safety_evidence'
              ? '安全证据弱'
              : t === 'high_send_tile_risk'
                ? '送牌风险高'
                : t === 'high_structure_loss'
                  ? '结构损失大'
                  : t;

    const cited = (() => {
      if (resolution && resolution.llm_output && resolution.source !== 'fallback') return resolution.llm_output.cited_fact_ids;
      return this.pickEngineCitedFactIds(chosen, ctx.stage, ctx.input.state_summary.blockedByDingque);
    })();

    const factById = new Map<string, ExplainFact>();
    for (const f of chosen.explain_facts.facts) factById.set(f.id, f);
    const citedFacts: Array<ExplainFact> = [];
    for (const id of cited) {
      const f = factById.get(id) ?? null;
      if (f) citedFacts.push(f);
    }

    const context = {
      state_summary: ctx.input.state_summary,
      chosen_candidate_id: chosenCandidateId,
      engine_top1_candidate_id: ctx.input.engine_top1_candidate_id,
      action: chosen.action,
      evidence: citedFacts.map((f) => ({ id: f.id, text: f.text })),
      risk_tags: riskTags.map((t) => ({ id: t, text: riskTagText(t) })),
      source: resolution?.source ?? 'engine',
    };

    const prompt = `你是血战到底麻将“拆牌面板”的追问助手。

你只能基于【本次拆牌推荐】做解释/教学，不要提出新的打法建议；不要杜撰当前牌局的新事实。
如果用户实质在要求“换一种打法/改动作/再选一次”，请提示“需要走重新推荐入口”，不要直接给新动作。

当用户问“为什么不推荐 X / 为什么不选 X”这类对比问题时：
- 优先从【候选对比表】里找到 X 对应的那条，再与【最终选择】对比指标差异后回答；
- 只对比这两项，不要把所有候选都讲一遍；
- 如果 X 不在表里，请说明“本次候选中没有 X，需要走重新推荐入口”。

【本次拆牌推荐（结构化）】
${JSON.stringify(context, null, 2)}${candidatesBlock}${historyBlock}

【用户追问】
{{QUESTION}}

		请用中文回答，尽量短、口语化。`;
    const freeFallbackPrompt = `注意：如果【本次拆牌推荐】与 STATE_BLOCK（当前局面）不一致，请以【本次拆牌推荐】为准。\n\n${prompt}`;
    const sendPrompt = followupMode === 'free' ? freeFallbackPrompt : prompt;

    const threadLabel = this.buildRecoFollowupThreadLabel({ snap, stage, action: chosen.action });
    const clientRequestId = `split-followup-${Date.now()}-${++this.recoFollowupReqSeq}`;
    this.recoFollowupDecisionKey = ctx.decisionKey;
    this.recoFollowupError = null;
    this.recoFollowupStrictFallback =
      followupMode === 'strict' ? { gameId: gid, decisionKey: ctx.decisionKey, scene, snapshotId, prompt: freeFallbackPrompt, question: q } : null;
    this.recoFollowupPinned = true;
    this.recoFollowupRestoreScrollTop = null;
    this.recoFollowupInflight = { clientRequestId, decisionKey: ctx.decisionKey, mode: followupMode };
    this.recoFollowupStreaming = null;
    this.recoFollowupScrollPending = false;
    this.recoFollowupMessages = [...this.recoFollowupMessages, { role: 'user', text: this.trimRecoFollowupText(q), at: Date.now() }];
    this.upsertRecoFollowupThread({ gameId: gid, decisionKey: ctx.decisionKey, messages: this.recoFollowupMessages, label: threadLabel, createdAt: Date.now() });
    this.followupInput.value = '';
    this.recoFollowupFocusPending = true;
    this.render();

    this.client.aiFollowup({
      clientRequestId,
      gameId: gid,
      scene,
      snapshotId,
      followupMode,
      prompt: sendPrompt,
      question: q,
    });
  }

  private onFollowupAiDelta(msg: any): void {
    const incomingClientRequestId = this.normalizeClientRequestId(msg?.clientRequestId);
    const inflight = this.recoFollowupInflight;
    if (!inflight || !incomingClientRequestId || inflight.clientRequestId !== incomingClientRequestId) return;
    const delta = typeof msg?.delta === 'string' ? msg.delta : '';
    if (!delta) return;

    if (!this.recoFollowupStreaming || this.recoFollowupStreaming.clientRequestId !== incomingClientRequestId) {
      this.recoFollowupStreaming = { clientRequestId: incomingClientRequestId, decisionKey: inflight.decisionKey, text: delta };
    } else {
      this.recoFollowupStreaming = { clientRequestId: incomingClientRequestId, decisionKey: inflight.decisionKey, text: this.recoFollowupStreaming.text + delta };
    }
    if (this.recoFollowupPinned) this.recoFollowupScrollPending = true;
    this.render();
  }

  private onFollowupAiResult(item: AiHistoryItem | null | undefined): void {
    if (!item) return;
    if (item.kind !== 'followup') return;
    const incomingClientRequestId = this.normalizeClientRequestId((item as any)?.clientRequestId);
    const inflight = this.recoFollowupInflight;
    if (!inflight || !incomingClientRequestId || inflight.clientRequestId !== incomingClientRequestId) return;

    const decisionKey = inflight.decisionKey;
    this.recoFollowupInflight = null;
    this.recoFollowupStrictFallback = null;
    this.recoFollowupStreaming = null;
    if (!item.ok) {
      const err = String(item.error ?? '').trim() || 'AI 请求失败';
      this.recoFollowupError = err;
    } else {
      const text = String(item.response ?? '').trim();
      this.recoFollowupError = null;
      if (text) {
        const gid = this.client.gameId();
        if (gid) this.ensureRecoFollowupThreadsLoaded(gid);
        const existing: Array<RecoFollowupMessage> = this.loadRecoFollowupMessages(decisionKey);
        const nextMessages: Array<RecoFollowupMessage> = [
          ...existing,
          { role: 'assistant', text: this.trimRecoFollowupText(text), at: item.at ?? Date.now() },
        ];
        if (this.recoFollowupDecisionKey === decisionKey) {
          this.recoFollowupMessages = nextMessages;
        }
        if (gid) this.upsertRecoFollowupThread({ gameId: gid, decisionKey, messages: nextMessages });
      }
    }
    this.recoFollowupFocusPending = (() => {
      try {
        return this.recoFollowupOpen && document.activeElement === this.followupInput;
      } catch {
        return false;
      }
    })();
    this.render();
  }

  private onFollowupAiError(msg: any): void {
    const incomingClientRequestId = this.normalizeClientRequestId(msg?.clientRequestId);
    const inflight = this.recoFollowupInflight;
    if (!inflight || !incomingClientRequestId || inflight.clientRequestId !== incomingClientRequestId) return;
    this.recoFollowupStreaming = null;
    const err = String(msg?.error ?? '').trim() || 'AI 请求失败';

    const canRetryAsFree = (() => {
      if (inflight.mode !== 'strict') return false;
      const fb = this.recoFollowupStrictFallback;
      if (!fb || fb.decisionKey !== inflight.decisionKey) return false;
      if (err.includes('局面已变化') || err.includes('请重新荐牌')) return true;
      const e = err.toLowerCase();
      return e === 'not your turn' || e === 'scene mismatch' || e === 'not seated' || e === 'game not started' || e === 'missing scene';
    })();

    if (canRetryAsFree) {
      const fb = this.recoFollowupStrictFallback;
      this.recoFollowupStrictFallback = null;
      if (!fb) return;
      const clientRequestId = `split-followup-${Date.now()}-${++this.recoFollowupReqSeq}`;
      this.recoFollowupInflight = { clientRequestId, decisionKey: inflight.decisionKey, mode: 'free' };
      this.recoFollowupError = null;
      this.recoFollowupNotice = '局面已变化，本次按自由追问回答';
      this.recoFollowupFocusPending = (() => {
        try {
          return this.recoFollowupOpen && document.activeElement === this.followupInput;
        } catch {
          return false;
        }
      })();
      this.render();
      this.client.aiFollowup({
        clientRequestId,
        gameId: fb.gameId,
        scene: fb.scene,
        snapshotId: fb.snapshotId,
        followupMode: 'free',
        prompt: fb.prompt,
        question: fb.question,
      });
      return;
    }

    this.recoFollowupInflight = null;
    this.recoFollowupStrictFallback = null;
    this.recoFollowupError = err;
    this.recoFollowupFocusPending = (() => {
      try {
        return this.recoFollowupOpen && document.activeElement === this.followupInput;
      } catch {
        return false;
      }
    })();
    this.render();
  }

  private stageToAiScene(stage: RecoStage): AiScene {
    return stage === 'exchange_3' ? 'swap3' : stage === 'choose_missing_suit' ? 'dingque' : stage === 'react' ? 'claim' : 'turn';
  }

  private buildAiSnapshotKey(params: { blood: BloodState; seat: number; scene: AiScene }): string {
    const me = params.blood.players?.[params.seat] ?? null;
    const dingque = me?.dingque ?? null;
    const pendingId = (params.blood as any)?.pending?.id ?? null;
    const swapSince = (params.blood as any)?.swap3?.since ?? null;
    const swapAnimating = (params.blood as any)?.swap3?.animatingSince ?? null;
    return [
      'mjlab.ai.snapshot.v1',
      `scene=${params.scene}`,
      `phase=${params.blood.phase}`,
      `turnSeat=${params.blood.turnSeat}`,
      `turnStep=${params.blood.turnStep}`,
      `pendingId=${pendingId}`,
      `swapSince=${swapSince}`,
      `swapAnim=${swapAnimating}`,
      `dingque=${dingque ?? ''}`,
      `hu=${me?.hu ? 1 : 0}`,
      `wallIndex=${params.blood.wallIndex}`,
      `nextId=${params.blood.nextId}`,
    ].join('|');
  }

  private async sha256Hex(text: string): Promise<string | null> {
    const subtle = (globalThis as any)?.crypto?.subtle;
    if (!subtle || typeof subtle.digest !== 'function') return null;
    try {
      const data = new TextEncoder().encode(String(text ?? ''));
      const buf = await subtle.digest('SHA-256', data);
      const bytes = new Uint8Array(buf);
      let hex = '';
      for (const b of bytes) hex += b.toString(16).padStart(2, '0');
      return hex;
    } catch {
      return null;
    }
  }

  private async computeAiSnapshotId(params: { blood: BloodState; seat: number; scene: AiScene }): Promise<string | null> {
    const key = this.buildAiSnapshotKey(params);
    const hex = await this.sha256Hex(key);
    if (!hex) return null;
    return hex.slice(0, 16);
  }

  private ensureRecoResolution(ctx: RecoUiContext, snap: SplitSnapshot): void {
    const gid = this.client.gameId() ?? null;

    const same = this.recoCtx?.decisionKey === ctx.decisionKey && (!gid || this.recoCtxGameId === gid);

    if (same) {
      const cached = this.recoCache.get(ctx.decisionKey) ?? null;
      if (cached) this.recoResolution = cached;
      if (gid) {
        this.recoCtxLast = this.recoCtx;
        this.recoCtxLastGameId = gid;
        this.recoResolutionLast = this.recoResolution;
      }
    } else {
	      this.recoCtx = ctx;
	      this.recoCtxGameId = gid;
	      this.recoError = null;
	      this.recoLoading = false;
	      this.recoInFlightSource = null;
	      this.recoResolution = this.recoCache.get(ctx.decisionKey) ?? null;
	      if (gid) {
	        this.recoCtxLast = ctx;
        this.recoCtxLastGameId = gid;
        this.recoResolutionLast = this.recoResolution;
      }
    }

		    // 自动裁决：只用于 AI面板的“自动裁决”开关。
		    // 托管·LLM 的裁决请求由托管流程统一发起（pickHostedCandidateId），以保证 timeout/cost 口径一致。
		    const wantAutoJudge =
		      this.recoAiEnabled &&
		      !this.actionsHistorical &&
		      !this.recoFollowupOpen &&
		      this.recoAutoJudgeEnabled;
		    if (!wantAutoJudge) return;

    const decisionKey = ctx.decisionKey;
    if (this.recoCache.has(decisionKey)) return;
    if (this.recoResolution && this.recoCtx?.decisionKey === decisionKey) return;
	    if (this.recoAutoJudgeTried.has(decisionKey)) return;
	    this.recoAutoJudgeTried.set(decisionKey, Date.now());
	    this.trimRecoAutoJudgeTried();
	    this.startRecoLlmJudge(ctx, { render: false, source: 'auto' });
	  }

  private pickEngineCitedFactIds(candidate: LlmCandidate, stage: RecoStage, blockedByDingque: boolean): Array<string> {
    const ids = candidate.explain_facts.facts.map((f) => f.id);
    const has = new Set(ids);
    const pick = (key: FactKey): string | null => {
      const id = factId(candidate.candidate_id, key);
      return has.has(id) ? id : null;
    };

    const out: Array<string> = [];
    const push = (id: string | null) => {
      if (!id) return;
      if (out.includes(id)) return;
      out.push(id);
    };

    if (stage === 'exchange_3') {
      push(pick('swap.structure_loss'));
      push(pick('swap.send_tile_risk'));
      return out.slice(0, 4);
    }
    if (stage === 'choose_missing_suit') {
      push(pick('dingque.clear_count'));
      push(pick('dingque.keep_score'));
      push(pick('metric.shanten_after'));
      push(pick('metric.ukeire_u'));
      return out.slice(0, 4);
    }
    if (stage === 'my_turn') {
      const a = candidate.action;
      if (a.type === 'hu') {
        push(pick('hu.gain'));
        return out.slice(0, 4);
      }
      if (a.type === 'an_gang' || a.type === 'jia_gang') {
        push(pick('gang.immediate_gain'));
        push(pick('metric.est_ron_mid'));
        return out.slice(0, 4);
      }
      if (a.type === 'discard') {
        if (blockedByDingque) {
          push(pick('rule.must_clear_missing_suit'));
          push(pick('metric.public_seen'));
          push(pick('metric.rem'));
          push(pick('metric.safety_evidence'));
          return out.slice(0, 4);
        }
        push(pick('metric.shanten_after'));
        push(pick('metric.ukeire_u'));
        push(pick('metric.safe_score'));
        push(pick('metric.safety_evidence'));
        return out.slice(0, 4);
      }
      return out.slice(0, 4);
    }
    if (stage === 'react') {
      const a = candidate.action;
      if (a.type === 'hu') {
        push(pick('hu.gain'));
        return out.slice(0, 4);
      }
      if (a.type === 'ming_gang') {
        push(pick('gang.immediate_gain'));
        push(pick('metric.shanten_after'));
        push(pick('metric.est_ron_mid'));
        return out.slice(0, 4);
      }
      if (a.type === 'peng' || a.type === 'pass') {
        push(pick('metric.shanten_after'));
        push(pick('metric.ukeire_u'));
        push(pick('metric.est_ron_mid'));
        return out.slice(0, 4);
      }
      return out.slice(0, 4);
    }
    return out.slice(0, 4);
  }

  private computeRecoRiskTags(params: {
    stage: RecoStage;
    blockedByDingque: boolean;
    chosen: LlmCandidate;
  }): Array<RiskTagId> {
    const out: Array<RiskTagId> = [];
    if (params.blockedByDingque) out.push('must_clear_missing_suit');

    const byKey = new Map<string, string>();
    for (const f of params.chosen.explain_facts.facts) {
      const m = /^.+::(.+)$/.exec(f.id);
      if (m) byKey.set(m[1]!, f.text);
    }

    if (params.stage === 'exchange_3') {
      const send = byKey.get('swap.send_tile_risk') ?? '';
      const loss = byKey.get('swap.structure_loss') ?? '';
      if (/高/.test(send)) out.push('high_send_tile_risk');
      if (/高/.test(loss)) out.push('high_structure_loss');
    }

    if (params.stage === 'my_turn' && params.chosen.action.type === 'discard') {
      const safety = byKey.get('metric.safety_evidence') ?? '';
      if (/偏弱/.test(safety)) out.push('low_safety_evidence');
      const safeScore = byKey.get('metric.safe_score') ?? '';
      if (/0\/[1-3]/.test(safeScore)) out.push('high_fangchong_risk');
    }

    return out;
  }

  private compactRecoEvidenceFactText(text: string): string {
    const raw = String(text ?? '').trim();
    if (!raw) return '';
    let out = raw;
    const idx = out.indexOf('（');
    if (idx >= 0) out = out.slice(0, idx).trim();
    const idx2 = out.indexOf('(');
    if (idx2 >= 0) out = out.slice(0, idx2).trim();
    if (out.length > 24) {
      const m = /[，,;；。]/.exec(out);
      if (m) out = out.slice(0, m.index).trim();
    }
    return out;
  }

  private renderRecoPlaceholderCard(params: { title: string; subtitle: string }): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'split-reco';

    const head = document.createElement('div');
    head.className = 'split-reco-head';

    const mainLine = document.createElement('div');
    mainLine.className = 'split-reco-action';
    const prefix = document.createElement('span');
    prefix.className = 'split-reco-prefix';
    prefix.textContent = params.title;
    mainLine.appendChild(prefix);
    const label = document.createElement('span');
    label.className = 'split-reco-action-label';
    label.textContent = params.subtitle;
    mainLine.appendChild(label);
    head.appendChild(mainLine);

    const tools = document.createElement('div');
    tools.className = 'split-reco-tools';

	    const hostedBtn = document.createElement('button');
	    hostedBtn.type = 'button';
	    hostedBtn.className = 'split-icon-btn split-hosted-btn';
	    hostedBtn.classList.toggle('is-on', this.aiHostedEnabled);
	    hostedBtn.title = this.buildAiHostedButtonTitle();
    hostedBtn.setAttribute('aria-pressed', this.aiHostedEnabled ? 'true' : 'false');
    hostedBtn.appendChild(createHudLucideIcon('sparkles'));
    hostedBtn.onclick = (e) => {
      e.stopPropagation();
      if (this.aiHostedEnabled) {
        this.setAiHostedEnabled(false, '用户取消托管');
        return;
      }
      this.openAiHostedSettings();
    };
    tools.appendChild(hostedBtn);

    const followupBtn = document.createElement('button');
    followupBtn.type = 'button';
    followupBtn.className = 'split-icon-btn split-followup-btn';
    const followupKey = this.pickRecoFollowupDecisionKey(null);
    const isHandFollowup = this.isHandFollowupDecisionKey(followupKey);
    const followupOpen = Boolean(followupKey && this.recoFollowupDecisionKey === followupKey && this.recoFollowupOpen);
    followupBtn.classList.toggle('is-on', followupOpen);
    followupBtn.title = followupOpen ? (isHandFollowup ? '返回历史TopN' : '返回候选') : (isHandFollowup ? '问当前手牌' : '追问');
    followupBtn.setAttribute('aria-pressed', followupOpen ? 'true' : 'false');
    followupBtn.appendChild(createHudLucideIcon(followupOpen ? 'arrowLeft' : 'send'));
    followupBtn.onclick = (e) => {
      e.stopPropagation();
      this.toggleRecoFollowup();
    };
	    followupBtn.disabled = !followupKey || !this.canUseRecoFollowupNow(this.snapshot);
	    tools.appendChild(followupBtn);

	    if (this.aiHostedEnabled) {
	      const badges = document.createElement('div');
	      badges.className = 'split-reco-badges';
	      this.appendAiHostedRecoBadges({ badges });
	      tools.appendChild(badges);
	    } else if (followupOpen) {
      const model = this.getEffectiveAiModelLabel() ?? '';
      if (model) {
        const badges = document.createElement('div');
        badges.className = 'split-reco-badges';
        const b = document.createElement('span');
        b.className = 'split-reco-badge';
        b.textContent = model;
        b.title = model;
        badges.appendChild(b);
        tools.appendChild(badges);
      }
	    }

	    head.appendChild(tools);
    wrap.appendChild(head);
    return wrap;
  }

			  private renderRecoCard(params: {
			    ctx: RecoUiContext;
			    resolution: RecoResolution | null;
			    chosenCandidateId: string;
			    historical?: boolean;
			    aiHostedSnapshotKey?: string | null;
			  }): HTMLElement {
	    const wrap = document.createElement('div');
	    wrap.className = 'split-reco';

    const resolution = params.resolution;
    const chosen = params.ctx.input.candidates_topk.find((c) => c.candidate_id === params.chosenCandidateId) ?? null;
    const action = chosen?.action ?? null;
    const evidenceOpen =
      this.recoEvidenceDecisionKey === params.ctx.decisionKey ? this.recoEvidenceOpen : false;

    const head = document.createElement('div');
    head.className = 'split-reco-head';
    const mainLine = document.createElement('div');
    mainLine.className = 'split-reco-action';
	    const prefix = document.createElement('span');
	    prefix.className = 'split-reco-prefix';
	    prefix.textContent = params.historical ? '上次' : '推荐';
	    mainLine.appendChild(prefix);
    if (action) {
      const label = document.createElement('span');
      label.className = 'split-reco-action-label';
      const pushText = (t: string) => label.appendChild(document.createTextNode(t));
      if (action.type === 'discard') {
        pushText('出 ');
        const key = this.parseTileCodeToTileKey(action.tile);
        if (key !== null) label.appendChild(tileImg(key, 'split-action-tile'));
        else pushText(action.tile);
      } else if (action.type === 'exchange_3') {
        pushText('换 ');
        const tiles: Array<number> = [];
        for (const t of action.tiles) {
          const key = this.parseTileCodeToTileKey(t);
          if (key !== null) tiles.push(key);
        }
        if (tiles.length === 3) label.appendChild(this.renderTileRow(tiles as any, 'split-inline-tiles'));
      } else if (action.type === 'choose_missing_suit') {
        pushText(`定缺 ${this.suitZh(action.suit)}`);
      } else if (action.type === 'an_gang' || action.type === 'jia_gang' || action.type === 'ming_gang' || action.type === 'peng') {
        const verb =
          action.type === 'an_gang' ? '暗杠 ' : action.type === 'jia_gang' ? '加杠 ' : action.type === 'ming_gang' ? '明杠 ' : '碰 ';
        pushText(verb);
        const key = this.parseTileCodeToTileKey(action.tile);
        if (key !== null) label.appendChild(tileImg(key, 'split-action-tile'));
        else pushText(action.tile);
      } else if (action.type === 'hu') {
        pushText(action.method === 'zimo' ? '胡（自摸）' : action.method === 'qianggang' ? '胡（抢杠）' : '胡（点炮）');
      } else if (action.type === 'pass') {
        pushText('过');
      }
      mainLine.appendChild(label);
    } else {
      mainLine.appendChild(document.createTextNode('--'));
    }

    head.appendChild(mainLine);

	    const tools = document.createElement('div');
	    tools.className = 'split-reco-tools';

		    const hostedBtn = document.createElement('button');
		    hostedBtn.type = 'button';
		    hostedBtn.className = 'split-icon-btn split-hosted-btn';
		    hostedBtn.classList.toggle('is-on', this.aiHostedEnabled);
		    hostedBtn.title = this.buildAiHostedButtonTitle();
	    hostedBtn.setAttribute('aria-pressed', this.aiHostedEnabled ? 'true' : 'false');
	    hostedBtn.appendChild(createHudLucideIcon('sparkles'));
	    hostedBtn.onclick = (e) => {
	      e.stopPropagation();
	      if (this.aiHostedEnabled) {
	        this.setAiHostedEnabled(false, '用户取消托管');
	        return;
	      }
	      this.openAiHostedSettings();
	    };
	    tools.appendChild(hostedBtn);

		    const followupBtn = document.createElement('button');
		    followupBtn.type = 'button';
		    followupBtn.className = 'split-icon-btn split-followup-btn';
		    const followupKey = this.pickRecoFollowupDecisionKey(params.ctx);
		    const isHandFollowup = this.isHandFollowupDecisionKey(followupKey);
		    const followupOpen = Boolean(followupKey && this.recoFollowupDecisionKey === followupKey && this.recoFollowupOpen);
		    followupBtn.classList.toggle('is-on', followupOpen);
    followupBtn.title = followupOpen ? (isHandFollowup ? '返回历史TopN' : '返回候选') : (isHandFollowup ? '问当前手牌' : '追问');
    followupBtn.setAttribute('aria-pressed', followupOpen ? 'true' : 'false');
    followupBtn.appendChild(createHudLucideIcon(followupOpen ? 'arrowLeft' : 'send'));
			    followupBtn.onclick = (e) => {
			      e.stopPropagation();
			      this.toggleRecoFollowup();
			    };
	    const followupEnabled = followupKey
	      ? this.isFreeFollowupDecisionKey(followupKey)
	        ? this.canUseRecoFollowupNow(this.snapshot)
	        : this.canUseRecoFollowupNow(this.snapshot) && !!action
	      : false;
	    followupBtn.disabled = !followupEnabled;
	    tools.appendChild(followupBtn);

			    const judgeBtn = document.createElement('button');
			    judgeBtn.type = 'button';
			    judgeBtn.className = 'split-icon-btn split-judge-btn';
			    const judgeOn = this.recoAutoJudgeEnabled;
			    judgeBtn.classList.toggle('is-on', judgeOn);
			    judgeBtn.setAttribute('aria-pressed', judgeOn ? 'true' : 'false');
			    judgeBtn.title = judgeOn ? (this.recoLoading ? 'AI裁决（开）·裁决中' : 'AI裁决（开）') : 'AI裁决（关）';
			    judgeBtn.appendChild(createHudLucideIcon('chatgpt'));
			    judgeBtn.disabled = this.actionsHistorical;
		    judgeBtn.onclick = (e) => {
		      e.stopPropagation();
		      if (this.actionsHistorical) return;
			      if (this.recoAutoJudgeEnabled) {
			        // 再次点击：关闭自动裁决（并取消自动裁决的 in-flight 裁决请求）。
			        this.setRecoAutoJudgeEnabled(false, { cancelInflight: true });
			        return;
			      }
		      // 打开自动裁决：立即对当前推荐裁决一次。
			      this.setRecoAutoJudgeEnabled(true, { render: false });
			      this.recoAutoJudgeTried.set(params.ctx.decisionKey, Date.now());
			      this.trimRecoAutoJudgeTried();
			      this.startRecoLlmJudge(params.ctx, { source: 'auto' });
			    };
		    tools.appendChild(judgeBtn);

	    const badges = document.createElement('div');
	    badges.className = 'split-reco-badges';

	    if (!this.aiHostedEnabled && resolution && resolution.llm_used && resolution.source !== 'fallback') {
	      const b = document.createElement('span');
	      b.className = 'split-reco-badge is-llm';
	      b.textContent = '按LLM';
	      badges.appendChild(b);
	    }
    if (!this.aiHostedEnabled) {
      if (followupOpen) {
        const model = this.getEffectiveAiModelLabel() ?? '';
        if (model) {
          const b = document.createElement('span');
          b.className = 'split-reco-badge';
          b.textContent = model;
          b.title = model;
          badges.appendChild(b);
        }
      } else {
        const inFlight = this.recoLoading && this.recoCtx?.decisionKey === params.ctx.decisionKey;
        const usedLlm = !!resolution?.llm_used;
        if (inFlight || usedLlm) {
          const cached = this.recoModelCache.get(params.ctx.decisionKey) ?? '';
          const effective = this.getEffectiveAiModelLabel() ?? '';
          const model = cached || effective;
          if (model) {
            const b = document.createElement('span');
            b.className = 'split-reco-badge';
            b.textContent = model;
            b.title = model;
            badges.appendChild(b);
          }
        }
      }
    }
	    if (!this.aiHostedEnabled && this.recoLoading) {
	      const b = document.createElement('span');
	      b.className = 'split-reco-badge is-loading';
	      b.textContent = 'AI裁决中';
	      badges.appendChild(b);
	    }

	    if (!this.aiHostedEnabled && this.recoError) {
	      const b = document.createElement('span');
	      b.className = 'split-reco-badge is-error';
	      b.textContent = 'LLM裁决失败';
	      badges.appendChild(b);
	    }

		    if (this.aiHostedEnabled) {
		      this.appendAiHostedRecoBadges({
		        badges,
		        stage: params.ctx.stage,
		        snapshotKey: params.aiHostedSnapshotKey ?? null,
		        decisionKey: params.ctx.decisionKey,
		      });
	    }

	    if (badges.childNodes.length > 0) tools.appendChild(badges);
	    head.appendChild(tools);
	    wrap.appendChild(head);

    if (!chosen) return wrap;

    const riskTags = this.computeRecoRiskTags({
      stage: params.ctx.stage,
      blockedByDingque: params.ctx.input.state_summary.blockedByDingque,
      chosen,
    });
    const riskTagText = (t: RiskTagId): string =>
      t === 'must_clear_missing_suit'
        ? '清缺中'
        : t === 'breaks_tenpai'
          ? '可能退听'
          : t === 'high_fangchong_risk'
            ? '放铳风险高'
            : t === 'low_safety_evidence'
              ? '安全证据弱'
              : t === 'high_send_tile_risk'
                ? '送牌风险高'
                : t === 'high_structure_loss'
                  ? '结构损失大'
                  : t;

    const cited = (() => {
      if (resolution && resolution.llm_output && resolution.source !== 'fallback') return resolution.llm_output.cited_fact_ids;
      return this.pickEngineCitedFactIds(chosen, params.ctx.stage, params.ctx.input.state_summary.blockedByDingque);
    })();

    const factById = new Map<string, ExplainFact>();
    for (const f of chosen.explain_facts.facts) factById.set(f.id, f);
    const citedFacts: Array<ExplainFact> = [];
    for (const id of cited) {
      const f = factById.get(id) ?? null;
      if (f) citedFacts.push(f);
    }

    const isFallback = resolution?.source === 'fallback';
    const makeFallbackTag = (): HTMLSpanElement => {
      const tag = document.createElement('span');
      tag.className = 'split-reco-inline-tag is-fallback';
      tag.textContent = '按TOP1';
      tag.title = '回退：采用规则引擎Top1';
      return tag;
    };
    if (citedFacts.length > 0) {
      mainLine.classList.add('is-toggle');
      mainLine.title = evidenceOpen ? '点击收起证据' : '点击展开证据';
      mainLine.addEventListener('click', (e) => {
        e.stopPropagation();
        const same = this.recoEvidenceDecisionKey === params.ctx.decisionKey;
        const nextOpen = same ? !this.recoEvidenceOpen : true;
        this.recoEvidenceDecisionKey = params.ctx.decisionKey;
        this.recoEvidenceOpen = nextOpen;
        this.render();
      });

      const parts: Array<string> = [];
      for (const f of citedFacts) {
        const compact = this.compactRecoEvidenceFactText(f.text);
        if (compact) parts.push(compact);
      }
      const inline = document.createElement('span');
      inline.className = 'split-reco-evidence-inline';
      inline.textContent = ` · 证据：${parts.join(' · ')}（${citedFacts.length}条）`;
      mainLine.appendChild(inline);

      if (evidenceOpen) {
        if (resolution && resolution.llm_output && resolution.source !== 'fallback') {
          const reason = document.createElement('div');
          reason.className = 'split-reco-reason';
          reason.textContent = resolution.llm_output.explanation;
          wrap.appendChild(reason);
        }

        const evidence = document.createElement('div');
        evidence.className = 'split-reco-evidence';
        const body = document.createElement('div');
        body.className = 'split-reco-evidence-body';
        const mergedParts: Array<string> = [];
        for (const f of citedFacts) mergedParts.push(f.text);
        for (const t of riskTags) mergedParts.push(riskTagText(t));
        const row = document.createElement('div');
        row.className = 'split-reco-fact';
        row.textContent = mergedParts.join(' · ');
        if (isFallback) {
          row.appendChild(document.createTextNode(' · '));
          row.appendChild(makeFallbackTag());
        }
        body.appendChild(row);
        evidence.appendChild(body);
        wrap.appendChild(evidence);
      }
    }

    if (!evidenceOpen) {
      if (citedFacts.length > 0) {
        const mergedParts: Array<string> = [];
        for (const f of citedFacts) mergedParts.push(f.text);
        for (const t of riskTags) mergedParts.push(riskTagText(t));
        const preview = document.createElement('div');
        preview.className = 'split-reco-evidence-preview';
        const text = document.createElement('span');
        text.className = 'split-reco-evidence-preview-text';
        text.textContent = mergedParts.join(' · ');
        preview.appendChild(text);
        if (isFallback) preview.appendChild(makeFallbackTag());
        wrap.appendChild(preview);
      } else if (riskTags.length > 0) {
        const box = document.createElement('div');
        box.className = 'split-reco-risks';
        for (const t of riskTags) {
          const b = document.createElement('span');
          b.className = 'split-reco-risk';
          b.textContent = riskTagText(t);
          box.appendChild(b);
        }
        if (isFallback) box.appendChild(makeFallbackTag());
        wrap.appendChild(box);
      }
    }

    return wrap;
  }

  private parseTileCodeToTileKey(code: string): number | null {
    const m = /^([1-9])(m|p|s)$/.exec(String(code).trim());
    if (!m) return null;
    const rank = Number(m[1]);
    const suit = m[2];
    const base = suit === 'm' ? 0 : suit === 'p' ? 9 : suit === 's' ? 18 : 0;
    const idx = base + (rank - 1);
    if (!Number.isFinite(idx) || idx < 0 || idx >= 27) return null;
    return idx;
  }

  private buildSharedTop1Snapshot(snap: SplitSnapshot): SplitTop1Snapshot | null {
    if (!snap.ok) return null;
    const afterGangRaw: unknown = (snap.blood as any)?.afterGangSeat;
    const afterGangSeat = Number.isFinite(afterGangRaw as any) ? Math.trunc(afterGangRaw as any) : null;
    return {
      seat: snap.seat,
      myDingque: snap.myDingque,
      melds: snap.melds,
      hasExtraTile: snap.hasExtraTile,
      canSelfTurnAct: snap.canSelfTurnAct,
      handCounts14: snap.handCounts14,
      publicCounts: snap.publicCounts,
      remCounts: snap.remCounts,
      wallRemaining: snap.wallRemaining,
      unknownPoolSize: snap.unknownPoolSize,
      stage: snap.stage,
      opponents: snap.opponents,
      aliveOpponents: snap.aliveOpponents,
      base: snap.base,
      cap: snap.cap,
      afterGangSeat,
    };
  }

  private toPendingLike(pending: BloodPendingClaim): BloodPendingClaimLike {
    return {
      kind: 'claim',
      id: pending.id,
      trigger: pending.trigger,
      afterGang: pending.afterGang,
      fromSeat: pending.fromSeat,
      tileId: pending.tileId,
      tileKey: pending.tileKey,
      options: pending.options,
    };
  }

  private moveCandidateToFront(candidates: Array<LlmCandidate>, candidateId: string): void {
    const idx = candidates.findIndex((c) => c.candidate_id === candidateId);
    if (idx <= 0) return;
    const [hit] = candidates.splice(idx, 1);
    if (!hit) return;
    candidates.unshift(hit);
  }

	  private buildRecoCtxExchange3(snap: SplitSnapshot, actions: ReadonlyArray<SplitSwap3Action>): RecoUiContext | null {
	    if (actions.length <= 0) return null;
    const stage: RecoStage = 'exchange_3';
    const stateSummary = this.buildRecoStateSummary({
      snap,
      stage,
      eventType: 'exchange_3',
      missingSuit: null,
      blockedByDingque: false,
    });

    const candidateUiMap = new Map<string, RecoUiMapping>();
    const candidates_topk: Array<LlmCandidate> = [];
    for (const row of actions) {
      const tiles: [string, string, string] = [tileCode(row.tiles[0]), tileCode(row.tiles[1]), tileCode(row.tiles[2])] as any;
      const action: RecoAction = { type: 'exchange_3', tiles } as any;
      const candidate_id = candidateIdForAction(action);

      const detail = row.detail;
      const sendLevel =
        detail.feedRiskTier === 'meld'
          ? '高'
          : detail.feedRiskTier === 'pair' || detail.feedRiskTier === 'ryanmen'
            ? '中'
            : detail.feedRiskTier === 'taatsu'
              ? '低'
              : '低';
      const sendText =
        sendLevel === '高'
          ? `送牌风险：高（feedRiskScore=${Math.round(detail.feedRiskScore)}），更可能把成型/关键牌送出去`
          : sendLevel === '中'
            ? `送牌风险：中（feedRiskScore=${Math.round(detail.feedRiskScore)}），有一定把好牌送出去的可能`
            : `送牌风险：低（feedRiskScore=${Math.round(detail.feedRiskScore)}），更不容易送出关键牌`;

      const lossLevel = row.structureLoss >= 120 ? '高' : row.structureLoss >= 60 ? '中' : '低';
      const lossText =
        lossLevel === '高'
          ? `结构损失：高（structureLoss=${row.structureLoss}，拆结构=${detail.breakMeldCount}），会明显拖慢成型效率`
          : lossLevel === '中'
            ? `结构损失：中（structureLoss=${row.structureLoss}，拆结构=${detail.breakMeldCount}），对牌效有一定影响`
            : `结构损失：低（structureLoss=${row.structureLoss}），对牌效影响较小`;

      const facts: Array<ExplainFact> = [
        this.makeExplainFact(candidate_id, 'swap.send_tile_risk', sendText),
        this.makeExplainFact(candidate_id, 'swap.structure_loss', lossText),
      ];

      candidates_topk.push({ candidate_id, action: action as any, explain_facts: { facts } });
      candidateUiMap.set(candidate_id, { actionKey: row.key, discardTileKey: null });
      if (candidates_topk.length >= 20) break;
	    }

	    if (candidates_topk.length <= 0) return null;

	    // Keep panel Top1 consistent with the shared engine (used by NewbieBot).
	    const top1Snap = this.buildSharedTop1Snapshot(snap);
	    this.top1Engine.routeMode = this.routeMode;
	    const top1 = top1Snap ? this.top1Engine.pickTop1Action({ scene: 'swap3', snap: top1Snap }) : null;
	    const engineTop1CandidateId =
	      top1 && top1.kind === 'swap3'
	        ? candidateIdForAction({
	            type: 'exchange_3',
	            tiles: [tileCode(top1.tiles[0]), tileCode(top1.tiles[1]), tileCode(top1.tiles[2])],
	          } as any)
	        : null;
	    if (engineTop1CandidateId) this.moveCandidateToFront(candidates_topk, engineTop1CandidateId);

	    const confidenceEngine = candidates_topk.length <= 1 ? 0.9 : 0.7;
	    const engineTop1Locked = confidenceEngine >= 0.8;
	    const input: LlmRecoInput = {
	      state_summary: stateSummary,
	      engine_top1_candidate_id: candidates_topk[0]!.candidate_id,
      engine_top1_locked: engineTop1Locked,
      constraints: { must_choose_from_candidates_topk: true },
      candidates_topk,
    };
    return {
      decisionKey: this.buildRecoDecisionKey(input),
      stage,
      input,
      confidenceEngine,
      engineTop1Locked,
      candidateUiMap,
		    };
		  }

		  private buildRecoCtxChooseMissingSuit(snap: SplitSnapshot, actions: ReadonlyArray<SplitDingqueAction>): RecoUiContext | null {
		    if (actions.length <= 0) return null;
		    const stage: RecoStage = 'choose_missing_suit';
		    const stateSummary = this.buildRecoStateSummary({
      snap,
      stage,
      eventType: 'choose_missing_suit',
      missingSuit: null,
      blockedByDingque: false,
    });

    const candidateUiMap = new Map<string, RecoUiMapping>();
    const candidates_topk: Array<LlmCandidate> = [];
    for (const row of actions) {
      const action: RecoAction = { type: 'choose_missing_suit', suit: row.suit } as any;
      const candidate_id = candidateIdForAction(action);

      const pressure = row.clearCount >= 5 ? '压力高' : row.clearCount >= 3 ? '压力中' : '压力低';
      const clearText = `缺门：${this.suitZh(row.suit)} · clear_count=${row.clearCount}（${pressure}）`;
      const keepLevel = row.keepScore >= 160 ? '保留度高' : row.keepScore >= 90 ? '保留度中' : '保留度低';
      const keepText = `缺门：${this.suitZh(row.suit)} · keep_score=${Math.round(row.keepScore)}（${keepLevel}）`;

      const facts: Array<ExplainFact> = [
        this.makeExplainFact(candidate_id, 'dingque.clear_count', clearText),
        this.makeExplainFact(candidate_id, 'dingque.keep_score', keepText),
        this.makeExplainFact(candidate_id, 'metric.shanten_after', `向听：shanten_after=${this.formatDingqueShanten(row.shanten)}（越小越好）`),
        this.makeExplainFact(candidate_id, 'metric.ukeire_u', `进张总数：ukeire_u=${this.formatDingqueMetric(row.improveCount)}（越大越好）`),
        this.makeExplainFact(candidate_id, 'metric.ukeire_k', `进张种类：ukeire_k=${this.formatDingqueMetric(row.improveKinds)}（越大越好）`),
      ];

      candidates_topk.push({ candidate_id, action: action as any, explain_facts: { facts } });
      candidateUiMap.set(candidate_id, { actionKey: row.key, discardTileKey: null });
    }

    const confidenceEngine = candidates_topk.length <= 1 ? 0.9 : 0.7;
    const engineTop1Locked = confidenceEngine >= 0.8;
    const input: LlmRecoInput = {
      state_summary: stateSummary,
      engine_top1_candidate_id: candidates_topk[0]!.candidate_id,
      engine_top1_locked: engineTop1Locked,
      constraints: { must_choose_from_candidates_topk: true },
      candidates_topk,
    };
    return {
      decisionKey: this.buildRecoDecisionKey(input),
      stage,
      input,
      confidenceEngine,
      engineTop1Locked,
      candidateUiMap,
    };
  }

  private buildRecoCtxReact(
    snap: SplitSnapshot,
    pending: BloodPendingClaim,
    actions: ReadonlyArray<SplitClaimAction>,
  ): RecoUiContext | null {
    if (actions.length <= 0) return null;
    const missingSuit = snap.myDingque;
    if (!missingSuit) return null;
    const blocked = this.hasDingqueTiles(snap);
    const stage: RecoStage = 'react';
    const stateSummary = this.buildRecoStateSummary({
      snap,
      stage,
      eventType: 'react',
      missingSuit,
      blockedByDingque: blocked,
    });

    const candidateUiMap = new Map<string, RecoUiMapping>();
    const candidates_topk: Array<LlmCandidate> = [];
    for (const row of actions) {
      if (row.kind === 'claimHu') {
        const method = (pending.trigger ?? 'discard') === 'addKong' ? 'qianggang' : 'dianpao';
        const action: RecoAction = { type: 'hu', method } as any;
        const candidate_id = candidateIdForAction(action);
        const facts: Array<ExplainFact> = [
          this.makeStateMissingSuitFact(candidate_id, missingSuit),
          this.makeExplainFact(candidate_id, 'hu.gain', `胡牌收益：gain=${Math.round(row.gain)}（越大越好）`),
        ];
        candidates_topk.push({ candidate_id, action: action as any, explain_facts: { facts } });
        candidateUiMap.set(candidate_id, { actionKey: row.key, discardTileKey: null });
        continue;
      }
      if (row.kind === 'claimMingGang') {
        const action: RecoAction = { type: 'ming_gang', tile: tileCode(row.tileKey) } as any;
        const candidate_id = candidateIdForAction(action);
        const facts: Array<ExplainFact> = [
          this.makeStateMissingSuitFact(candidate_id, missingSuit),
          this.makeExplainFact(candidate_id, 'gang.immediate_gain', `杠即时收益：immediate_gain=${Math.round(row.immediateGain)}（越大越好）`),
          this.makeExplainFact(candidate_id, 'metric.shanten_after', `向听：shanten_after=${Math.round(row.worstShanten)}（越小越好）`),
          this.makeExplainFact(candidate_id, 'metric.ukeire_u', `进张总数：ukeire_u=0（越大越好）`),
          this.makeExplainFact(candidate_id, 'metric.ukeire_k', `进张种类：ukeire_k=0（越大越好）`),
          this.makeExplainFact(candidate_id, 'metric.est_ron_mid', `预估收益中值：est_ron_mid=${Math.round(midpoint(row.gainMin, row.gainMax))}（越大越好）`),
        ];
        candidates_topk.push({ candidate_id, action: action as any, explain_facts: { facts } });
        candidateUiMap.set(candidate_id, { actionKey: row.key, discardTileKey: null });
        continue;
      }
      if (row.kind === 'claimPeng') {
        const action: RecoAction = { type: 'peng', tile: tileCode(row.tileKey) } as any;
        const candidate_id = candidateIdForAction(action);
        const sum = row.bestSummary;
        const u = sum ? this.summaryU(sum) : 0;
        const k = sum ? this.summaryK(sum) : 0;
        const shantenText = sum && Number.isFinite(sum.shanten) ? String(sum.shanten) : '未知';
        const facts: Array<ExplainFact> = [
          this.makeStateMissingSuitFact(candidate_id, missingSuit),
          this.makeExplainFact(
            candidate_id,
            'metric.shanten_after',
            `向听：shanten_after=${shantenText}${shantenText === '未知' ? '（不可用，请忽略该指标）' : '（越小越好）'}`,
          ),
          this.makeExplainFact(candidate_id, 'metric.ukeire_u', `进张总数：ukeire_u=${Math.round(u)}（越大越好）`),
          this.makeExplainFact(candidate_id, 'metric.ukeire_k', `进张种类：ukeire_k=${Math.round(k)}（越大越好）`),
          this.makeExplainFact(candidate_id, 'metric.est_ron_mid', `预估收益中值：est_ron_mid=${Math.round(midpoint(row.rangeMin, row.rangeMax))}（越大越好）`),
        ];
        candidates_topk.push({ candidate_id, action: action as any, explain_facts: { facts } });
        candidateUiMap.set(candidate_id, { actionKey: row.key, discardTileKey: null });
        continue;
      }
      if (row.kind === 'claimPass') {
        const action: RecoAction = { type: 'pass' } as any;
        const candidate_id = candidateIdForAction(action);
        const sum = row.summary;
        const u = sum ? this.summaryU(sum) : 0;
        const k = sum ? this.summaryK(sum) : 0;
        const shantenText = sum && Number.isFinite(sum.shanten) ? String(sum.shanten) : '未知';
        const facts: Array<ExplainFact> = [
          this.makeStateMissingSuitFact(candidate_id, missingSuit),
          this.makeExplainFact(
            candidate_id,
            'metric.shanten_after',
            `向听：shanten_after=${shantenText}${shantenText === '未知' ? '（不可用，请忽略该指标）' : '（越小越好）'}`,
          ),
          this.makeExplainFact(candidate_id, 'metric.ukeire_u', `进张总数：ukeire_u=${Math.round(u)}（越大越好）`),
          this.makeExplainFact(candidate_id, 'metric.ukeire_k', `进张种类：ukeire_k=${Math.round(k)}（越大越好）`),
          this.makeExplainFact(candidate_id, 'metric.est_ron_mid', `预估收益中值：est_ron_mid=${Math.round(midpoint(row.rangeMin, row.rangeMax))}（越大越好）`),
        ];
        candidates_topk.push({ candidate_id, action: action as any, explain_facts: { facts } });
        candidateUiMap.set(candidate_id, { actionKey: row.key, discardTileKey: null });
      }
    }

    if (candidates_topk.length <= 0) return null;

    // Keep panel Top1 consistent with the shared engine (used by NewbieBot).
    const top1Snap = this.buildSharedTop1Snapshot(snap);
    this.top1Engine.routeMode = this.routeMode;
    const pendingLike = this.toPendingLike(pending);
    const top1 = top1Snap ? this.top1Engine.pickTop1Action({ scene: 'claim', snap: top1Snap, pending: pendingLike }) : null;
    const engineTop1CandidateId = (() => {
      if (!top1 || top1.kind !== 'claim') return null;
      if (top1.action === 'hu') {
        const method = (pending.trigger ?? 'discard') === 'addKong' ? 'qianggang' : 'dianpao';
        return candidateIdForAction({ type: 'hu', method } as any);
      }
      if (top1.action === 'gang') return candidateIdForAction({ type: 'ming_gang', tile: tileCode(pending.tileKey) } as any);
      if (top1.action === 'peng') return candidateIdForAction({ type: 'peng', tile: tileCode(pending.tileKey) } as any);
      return candidateIdForAction({ type: 'pass' } as any);
    })();
    if (engineTop1CandidateId) this.moveCandidateToFront(candidates_topk, engineTop1CandidateId);

    const confidenceEngine = candidates_topk[0]!.action.type === 'hu' ? 0.9 : candidates_topk.length <= 1 ? 0.9 : 0.7;
    const engineTop1Locked = confidenceEngine >= 0.8;
    const input: LlmRecoInput = {
      state_summary: stateSummary,
      engine_top1_candidate_id: candidates_topk[0]!.candidate_id,
      engine_top1_locked: engineTop1Locked,
      constraints: { must_choose_from_candidates_topk: true },
      candidates_topk,
    };
    return {
      decisionKey: this.buildRecoDecisionKey(input),
      stage,
      input,
      confidenceEngine,
      engineTop1Locked,
      candidateUiMap,
    };
  }

  private buildRecoCtxMyTurn(snap: SplitSnapshot, actions: ReadonlyArray<SplitTurnAction>): RecoUiContext | null {
    const missingSuit = snap.myDingque;
    if (!missingSuit) return null;
    const stage: RecoStage = 'my_turn';
    const blocked = this.hasDingqueTiles(snap);
    const stateSummary = this.buildRecoStateSummary({
      snap,
      stage,
      eventType: 'my_turn',
      missingSuit,
      blockedByDingque: blocked,
    });

    const discardAction = actions.find((a): a is Extract<SplitTurnAction, { kind: 'discard' }> => a.kind === 'discard') ?? null;
    if (!discardAction) return null;

    const gangActions = actions.filter((a): a is Extract<SplitTurnAction, { kind: 'gang' }> => a.kind === 'gang');
    const huAction = actions.find((a): a is Extract<SplitTurnAction, { kind: 'hu' }> => a.kind === 'hu') ?? null;

    const discards: Array<LlmCandidate> = [];
    const gangs: Array<{ cand: LlmCandidate; mid: number; kindOrder: number; id: string }> = [];
    const candidateUiMap = new Map<string, RecoUiMapping>();

    const safetyEvidenceLevel = (familiar: number, wall: number, suji: number): string => {
      const total = familiar + wall + suji;
      if (total >= 4) return '偏强';
      if (total >= 2) return '一般';
      return '偏弱';
    };

    for (const c of discardAction.ranked.candidates) {
      const action: RecoAction = { type: 'discard', tile: tileCode(c.tileKey) } as any;
      const candidate_id = candidateIdForAction(action);

      const facts: Array<ExplainFact> = [this.makeStateMissingSuitFact(candidate_id, missingSuit)];
      const safety = this.computeSafetyParts(snap, c.tileKey);
      const safeEvidence = `安全证据：熟=${safety.familiarCount}，壁=${safety.wallCount}，筋=${safety.sujiCount}（${safetyEvidenceLevel(
        safety.familiarCount,
        safety.wallCount,
        safety.sujiCount,
      )}）`;

      facts.push(this.makeExplainFact(candidate_id, 'metric.safe_score', `安全分：safe_score=${safety.safeText}（越大越好）`));
      facts.push(this.makeExplainFact(candidate_id, 'metric.safety_evidence', safeEvidence));

      if (blocked) {
        facts.push(this.makeExplainFact(candidate_id, 'rule.must_clear_missing_suit', '清缺优先：仍持缺门牌，建议优先处理缺门'));
        facts.push(
          this.makeExplainFact(
            candidate_id,
            'metric.public_seen',
            `公开已见：public_seen=${c.publicSeen}（${tileLabel(c.tileKey)}）`,
          ),
        );
        facts.push(this.makeExplainFact(candidate_id, 'metric.rem', `外剩：rem=${c.rem}（${tileLabel(c.tileKey)}）`));
      } else {
        const branch = discardAction.branches.get(c.tileKey) ?? null;
        const sum = branch?.summary ?? null;
        const shantenText = sum && Number.isFinite(sum.shanten) ? String(sum.shanten) : '未知';
        const u = sum ? this.summaryU(sum) : 0;
        const k = sum ? this.summaryK(sum) : 0;
        const estMid = branch ? midpoint(branch.valueMin, branch.valueMax) : 0;
        facts.push(
          this.makeExplainFact(
            candidate_id,
            'metric.shanten_after',
            `向听：shanten_after=${shantenText}${shantenText === '未知' ? '（不可用，请忽略该指标）' : '（越小越好）'}`,
          ),
        );
        facts.push(this.makeExplainFact(candidate_id, 'metric.ukeire_u', `进张总数：ukeire_u=${Math.round(u)}（越大越好）`));
        facts.push(this.makeExplainFact(candidate_id, 'metric.ukeire_k', `进张种类：ukeire_k=${Math.round(k)}（越大越好）`));
        facts.push(this.makeExplainFact(candidate_id, 'metric.est_ron_mid', `预估收益中值：est_ron_mid=${Math.round(estMid)}（越大越好）`));
        if (branch?.route === 'standard' && sum && Number.isFinite(sum.windowScore)) {
          facts.push(this.makeExplainFact(candidate_id, 'metric.window_score', `窗口分：window_score=${sum.windowScore}（越大越好）`));
        }
      }

      discards.push({ candidate_id, action: action as any, explain_facts: { facts } });
      candidateUiMap.set(candidate_id, { actionKey: discardAction.key, discardTileKey: c.tileKey });
    }

    for (const g of gangActions) {
      const action: RecoAction = { type: g.gangType === 'an' ? 'an_gang' : 'jia_gang', tile: tileCode(g.tileKey) } as any;
      const candidate_id = candidateIdForAction(action);
      const estMid = midpoint(g.gainMin, g.gainMax);
      const facts: Array<ExplainFact> = [
        this.makeStateMissingSuitFact(candidate_id, missingSuit),
        this.makeExplainFact(candidate_id, 'gang.immediate_gain', `杠即时收益：immediate_gain=${Math.round(g.immediateGain)}（越大越好）`),
        this.makeExplainFact(candidate_id, 'metric.est_ron_mid', `预估收益中值：est_ron_mid=${Math.round(estMid)}（越大越好）`),
      ];
      const mid = estMid;
      const kindOrder = g.gangType === 'an' ? 0 : 1;
      const cand: LlmCandidate = { candidate_id, action: action as any, explain_facts: { facts } };
      gangs.push({ cand, mid, kindOrder, id: candidate_id });
      candidateUiMap.set(candidate_id, { actionKey: g.key, discardTileKey: null });
    }

    gangs.sort((a, b) => {
      if (b.mid !== a.mid) return b.mid - a.mid;
      if (a.kindOrder !== b.kindOrder) return a.kindOrder - b.kindOrder;
      return a.id.localeCompare(b.id);
    });

	    const huCand: LlmCandidate | null = huAction
	      ? (() => {
	          const action: RecoAction = { type: 'hu', method: 'zimo' } as any;
	          const candidate_id = candidateIdForAction(action);
          const facts: Array<ExplainFact> = [
            this.makeStateMissingSuitFact(candidate_id, missingSuit),
            this.makeExplainFact(candidate_id, 'hu.gain', `胡牌收益：gain=${Math.round(huAction.gain)}（越大越好）`),
          ];
          candidateUiMap.set(candidate_id, { actionKey: huAction.key, discardTileKey: null });
          return { candidate_id, action: action as any, explain_facts: { facts } };
	        })()
	      : null;

	    // Keep panel Top1 consistent with the shared engine (used by NewbieBot).
	    const engineTop1CandidateId =
	      (() => {
	        const top1Snap = this.buildSharedTop1Snapshot(snap);
	        if (!top1Snap) return null;
	        this.top1Engine.routeMode = this.routeMode;
	        const top1 = this.top1Engine.pickTop1Action({ scene: 'turn', snap: top1Snap });
	        if (!top1) return null;
	        if (top1.kind === 'turnHu') return huCand?.candidate_id ?? candidateIdForAction({ type: 'hu', method: 'zimo' } as any);
	        if (top1.kind === 'turnKong') {
	          const a: RecoAction = { type: top1.gangType === 'an' ? 'an_gang' : 'jia_gang', tile: tileCode(top1.tileKey) } as any;
	          return candidateIdForAction(a);
	        }
	        if (top1.kind === 'turnDiscard') {
	          const a: RecoAction = { type: 'discard', tile: tileCode(top1.tileKey) } as any;
	          return candidateIdForAction(a);
	        }
	        return null;
	      })() ?? discards[0]?.candidate_id ?? candidateIdForAction({ type: 'discard', tile: '1m' } as any);

	    const top1IsGang = gangs.some((g) => g.cand.candidate_id === engineTop1CandidateId);

	    const ordered: Array<LlmCandidate> = [];
	    if (huCand) {
	      ordered.push(huCand);
	      for (const it of gangs) ordered.push(it.cand);
	      for (const d of discards) ordered.push(d);
	    } else if (top1IsGang) {
	      for (const it of gangs) ordered.push(it.cand);
	      for (const d of discards) ordered.push(d);
	    } else {
	      for (const d of discards) ordered.push(d);
	      for (const it of gangs) ordered.push(it.cand);
	    }

	    this.moveCandidateToFront(ordered, engineTop1CandidateId);

	    const candidates_topk = ordered.slice(0, 20);
	    if (candidates_topk.length <= 0) return null;

	    const confidenceEngine = candidates_topk[0]!.action.type === 'hu' ? 0.9 : candidates_topk.length <= 1 ? 0.9 : 0.7;
	    const engineTop1Locked = confidenceEngine >= 0.8;
	    const input: LlmRecoInput = {
      state_summary: stateSummary,
      engine_top1_candidate_id: candidates_topk[0]!.candidate_id,
      engine_top1_locked: engineTop1Locked,
      constraints: { must_choose_from_candidates_topk: true },
      candidates_topk,
    };
    return {
      decisionKey: this.buildRecoDecisionKey(input),
      stage,
      input,
      confidenceEngine,
      engineTop1Locked,
      candidateUiMap,
    };
  }

	  private render(): void {
	    this.clearFloatingHandSource();
	    const snap = this.snapshot;
	    if (!snap || !snap.ok) {
	      this.titleEl.textContent = '拆牌';
	      this.titleHandEl.innerHTML = '';
	      this.subbar.classList.add('hidden');
      this.actionBar.classList.add('hidden');
      this.routeBar.classList.add('hidden');
      this.suitBar.classList.add('hidden');
      this.suitPanel.classList.add('hidden');
      this.suitPanel.innerHTML = '';
	      this.pendingScrollTileKey = null;
	      this.suitOpen = null;
	      this.statusEl.style.display = 'block';
	      this.statusEl.textContent = snap?.reason ?? '当前不可拆牌';
	      this.setRecoFollowupPanelVisible(false);
	      this.listEl.innerHTML = '';
	      this.helpPanel.classList.add('hidden');
	      return;
	    }

    const { mode, claimCtx } = this.getPanelMode(snap);
    const swap3DisplaySnap = mode === 'swap3' ? this.getSwap3DisplaySnapshot(snap) : null;
    const viewSnap = swap3DisplaySnap ?? snap;
    this.placeActionBar(mode !== 'turn');
    const stageLabel = viewSnap.stage === 'early' ? '早局' : viewSnap.stage === 'mid' ? '中局' : '后局';
    if (claimCtx) {
      // 仅在 claim 需要本家响应时展示向听：按“过”的当前手牌口径计算。
      const counts13 = snap.handCounts14.slice();
      const blockedByDingque = this.hasDingqueTilesInCounts(counts13, snap.myDingque);
      let shantenText = blockedByDingque ? '清缺中' : '--向听';
      if (!blockedByDingque) {
        const route = this.getActiveRouteForCounts(snap, counts13);
        const analyzer = this.getRouteAnalyzer(route);
        const sum = analyzer ? analyzer.summary(counts13, snap.remCounts) : null;
        if (sum && Number.isFinite(sum.shanten)) shantenText = `${sum.shanten}向听`;
      }
      this.titleEl.textContent = `${stageLabel} · 墙${snap.wallRemaining} · ${shantenText}`;
    } else if (mode === 'swap3') {
      this.titleEl.textContent = `${stageLabel} · 墙${viewSnap.wallRemaining} · 换三张`;
    } else if (mode === 'dingque') {
      this.titleEl.textContent = `${stageLabel} · 墙${snap.wallRemaining} · 定缺`;
    } else {
      this.titleEl.textContent = `${stageLabel} · 墙${snap.wallRemaining}`;
    }

    this.titleHandEl.innerHTML = '';
    for (const it of viewSnap.handTilesOrdered) {
      const img = tileImg(it.tileKey, `split-title-tile${it.isExtra ? ' is-extra' : ''}`);
      this.titleHandEl.appendChild(img);
    }
	    this.statusEl.textContent = '';
	    this.statusEl.style.display = 'none';
	    this.listEl.classList.remove('hidden');
	    this.setRecoFollowupPanelVisible(false);

		    if (mode === 'swap3') {
	      this.suitOpen = null;
	      this.routeBar.classList.add('hidden');
	      this.suitBar.classList.add('hidden');
	      this.suitPanel.classList.add('hidden');
	      this.suitPanel.innerHTML = '';
      if (!swap3DisplaySnap) {
        this.actionBar.classList.add('hidden');
        if (this.helpOpen && !this.helpSideBySide) {
          this.renderInlineHelpInList(true);
          return;
        }
        this.updateSubbarVisibility();
        this.statusEl.style.display = 'block';
        this.statusEl.textContent = '换牌已提交，历史推荐不可用。';
        this.listEl.innerHTML = '';
        this.listEl.classList.add('hidden');
        return;
		      }
		      const actions = this.getCachedSwap3Actions(swap3DisplaySnap);
		      let recoCtx = this.buildRecoCtxExchange3(swap3DisplaySnap, actions);
			      if (recoCtx) recoCtx = this.applyAiHostedRecoOverrides(recoCtx);
			      if (recoCtx) this.ensureRecoResolution(recoCtx, swap3DisplaySnap);
			      const recoResolution = recoCtx && this.recoCtx?.decisionKey === recoCtx.decisionKey ? this.recoResolution : null;
			      const aiHostedSnapshotKey = this.aiHostedEnabled ? this.buildAiHostedSnapshotKey(swap3DisplaySnap) : null;
			      const plan = this.aiHostedPlannedAct;
			      const plannedChosenCandidateId =
			        recoCtx &&
			        plan &&
			        aiHostedSnapshotKey &&
			        plan.stage === recoCtx.stage &&
			        plan.snapshotKey === aiHostedSnapshotKey &&
			        recoCtx.input.candidates_topk.some((c) => c.candidate_id === plan.chosenCandidateId)
			          ? plan.chosenCandidateId
			          : null;
			      const chosenCandidateId = recoCtx
			        ? plannedChosenCandidateId ?? (recoResolution ? recoResolution.chosen_candidate_id : recoCtx.input.engine_top1_candidate_id)
			        : null;
			      const chosenActionKey = chosenCandidateId ? recoCtx?.candidateUiMap.get(chosenCandidateId)?.actionKey ?? null : null;
		      const engineTop1ActionKey = recoCtx ? recoCtx.candidateUiMap.get(recoCtx.input.engine_top1_candidate_id)?.actionKey ?? null : null;
		      const showAiReco = Boolean(this.recoAiEnabled && recoCtx && chosenCandidateId);
	      if (!showAiReco) {
	        const opened = this.selectedActionKey ? actions.find((action) => action.key === this.selectedActionKey) ?? null : null;
	        if (!opened) this.selectedActionKey = null;
	        this.renderSwap3ActionAccordion(actions, opened, { chosenActionKey, engineTop1ActionKey });
	      } else {
	        this.actionBar.innerHTML = '';
	        this.actionBar.classList.add('hidden');
	        this.actionBar.classList.remove('is-claim', 'is-historical');
	      }
	      if (this.helpOpen && !this.helpSideBySide) {
	        this.renderInlineHelpInList(true);
	        return;
	      }
			      this.updateSubbarVisibility();
			      this.listEl.innerHTML = '';
			      const followupOpen = Boolean(recoCtx && this.recoFollowupDecisionKey === recoCtx.decisionKey && this.recoFollowupOpen);
			      if (showAiReco && recoCtx && chosenCandidateId) {
			        this.listEl.appendChild(this.renderRecoCard({ ctx: recoCtx, resolution: recoResolution, chosenCandidateId, aiHostedSnapshotKey }));
			        const followupVisible = !!followupOpen;
			        this.setRecoFollowupPanelVisible(followupVisible);
				        if (followupVisible) this.renderRecoFollowupPanel({ resolution: recoResolution });
			      } else {
		        this.setRecoFollowupPanelVisible(false);
		        this.listEl.classList.add('hidden');
		      }
		      return;
		    }

	    if (mode === 'dingque') {
	      this.suitOpen = null;
	      this.routeBar.classList.add('hidden');
	      this.suitBar.classList.add('hidden');
      this.suitPanel.classList.add('hidden');
	      this.suitPanel.innerHTML = '';
	      const actions = this.getCachedDingqueActions(snap);
      if (!actions) {
        this.actionBar.classList.add('hidden');
        if (this.helpOpen && !this.helpSideBySide) {
          this.renderInlineHelpInList(true);
          return;
        }
        this.updateSubbarVisibility();
        this.statusEl.style.display = 'block';
        this.statusEl.textContent = '定缺推荐计算中...';
        this.listEl.innerHTML = '';
        this.listEl.classList.add('hidden');
        return;
	      }
			      let recoCtx = this.buildRecoCtxChooseMissingSuit(snap, actions);
			      if (recoCtx) recoCtx = this.applyAiHostedRecoOverrides(recoCtx);
			      if (recoCtx) this.ensureRecoResolution(recoCtx, snap);
			      const recoResolution = recoCtx && this.recoCtx?.decisionKey === recoCtx.decisionKey ? this.recoResolution : null;
			      const aiHostedSnapshotKey = this.aiHostedEnabled ? this.buildAiHostedSnapshotKey(snap) : null;
			      const plan = this.aiHostedPlannedAct;
			      const plannedChosenCandidateId =
			        recoCtx &&
			        plan &&
			        aiHostedSnapshotKey &&
			        plan.stage === recoCtx.stage &&
			        plan.snapshotKey === aiHostedSnapshotKey &&
			        recoCtx.input.candidates_topk.some((c) => c.candidate_id === plan.chosenCandidateId)
			          ? plan.chosenCandidateId
			          : null;
			      const chosenCandidateId = recoCtx
			        ? plannedChosenCandidateId ?? (recoResolution ? recoResolution.chosen_candidate_id : recoCtx.input.engine_top1_candidate_id)
			        : null;
			      const chosenActionKey = chosenCandidateId ? recoCtx?.candidateUiMap.get(chosenCandidateId)?.actionKey ?? null : null;
		      const engineTop1ActionKey = recoCtx ? recoCtx.candidateUiMap.get(recoCtx.input.engine_top1_candidate_id)?.actionKey ?? null : null;
		      const showAiReco = Boolean(this.recoAiEnabled && recoCtx && chosenCandidateId);
	      if (!showAiReco) {
	        const opened = this.selectedActionKey ? actions.find((action) => action.key === this.selectedActionKey) ?? null : null;
	        if (!opened) this.selectedActionKey = null;
	        this.renderDingqueActionAccordion(snap, actions, opened, { chosenActionKey, engineTop1ActionKey });
	      } else {
	        this.actionBar.innerHTML = '';
	        this.actionBar.classList.add('hidden');
	        this.actionBar.classList.remove('is-claim', 'is-historical');
	      }
	      if (this.helpOpen && !this.helpSideBySide) {
	        this.renderInlineHelpInList(true);
	        return;
	      }
			      this.updateSubbarVisibility();
			      this.listEl.innerHTML = '';
			      const followupOpen = Boolean(recoCtx && this.recoFollowupDecisionKey === recoCtx.decisionKey && this.recoFollowupOpen);
			      if (showAiReco && recoCtx && chosenCandidateId) {
			        this.listEl.appendChild(this.renderRecoCard({ ctx: recoCtx, resolution: recoResolution, chosenCandidateId, aiHostedSnapshotKey }));
			        const followupVisible = !!followupOpen;
			        this.setRecoFollowupPanelVisible(followupVisible);
				        if (followupVisible) this.renderRecoFollowupPanel({ resolution: recoResolution });
			      } else {
		        this.setRecoFollowupPanelVisible(false);
		        this.listEl.classList.add('hidden');
		      }
		      return;
		    }

    const actions: Array<SplitAction> = claimCtx ? this.buildClaimActions(snap, claimCtx.pending) : this.buildTurnActions(snap);
	    if (mode === 'turn' && actions.length === 0) {
	      this.selectedActionKey = null;
	      this.routeBar.classList.add('hidden');
	      this.actionBar.classList.add('hidden');
	      this.renderSuitPanel(snap);

	      if (this.helpOpen && !this.helpSideBySide) {
	        this.renderInlineHelpInList(true);
	        return;
	      }

	      const allowEndedFollowup = this.isRecoFollowupAllowedInHistorical(snap);
	      if (allowEndedFollowup && this.recoAiEnabled) {
	        const ctx = this.getRecoCtxForFollowup();
	        if (ctx) {
	          const resolution = this.getRecoResolutionForDecisionKey(ctx.decisionKey);
	          const chosenCandidateId = resolution ? resolution.chosen_candidate_id : ctx.input.engine_top1_candidate_id;
	          const followupOpen = Boolean(this.recoFollowupDecisionKey === ctx.decisionKey && this.recoFollowupOpen);
		          this.statusEl.style.display = 'block';
		          this.statusEl.textContent = '对局已结束，可继续追问复盘。';
		          this.listEl.innerHTML = '';
		          this.listEl.classList.remove('hidden');
		          this.listEl.appendChild(this.renderRecoCard({ ctx, resolution, chosenCandidateId, historical: true }));
		          const followupVisible = !!followupOpen;
		          this.setRecoFollowupPanelVisible(followupVisible);
		          if (followupVisible) this.renderRecoFollowupPanel({ resolution });
		          return;
		        }
	      }

      const waitText = (() => {
        const pending = snap.blood.pending;
        if (pending && pending.kind === 'claim') return '等待其他玩家响应（碰/杠/胡）…';
        if (snap.blood.turnSeat !== snap.seat) return `等待${relativeSeatText(snap.seat, snap.blood.turnSeat)}行动…`;
        if (snap.blood.turnStep === 'drawOrKong') return '等待摸牌/补张…';
        return '未轮到本家操作…';
      })();

      const hist = this.getTurnDiscardHistoryForCurrentGame(snap);
      this.statusEl.style.display = 'block';
      this.statusEl.textContent = hist ? `${waitText} 下方为上次弃牌窗口的候选TopN（历史）。` : `${waitText} 暂无历史候选TopN。`;

      this.listEl.innerHTML = '';
      this.listEl.classList.remove('hidden');

      const followupKey = this.pickRecoFollowupDecisionKey(this.getRecoCtxForFollowup());
      const followupOpen = Boolean(followupKey && this.recoFollowupDecisionKey === followupKey && this.recoFollowupOpen);

      const toolsCard = (() => {
        if (!this.recoAiEnabled) return null;
        if (hist && hist.ctx) {
          const chosenCandidateId = hist.chosenCandidateId || hist.ctx.input.engine_top1_candidate_id;
          return this.renderRecoCard({ ctx: hist.ctx, resolution: hist.resolution, chosenCandidateId, historical: true });
        }
        return this.renderRecoPlaceholderCard({ title: '等待', subtitle: '可先设置托管或追问' });
      })();

      if (followupOpen) {
        if (toolsCard) this.listEl.appendChild(toolsCard);
        this.setRecoFollowupPanelVisible(true);
        this.renderRecoFollowupPanel({ resolution: hist?.resolution ?? null });
        return;
      }

      this.setRecoFollowupPanelVisible(false);
	      if (hist) {
	        this.renderCandidateList(hist.snap, hist.discardAction, {
	          chosenDiscardTileKey: hist.chosenDiscardTileKey,
	          engineTop1DiscardTileKey: hist.engineTop1DiscardTileKey,
	        }, hist.analyzers);
	        if (toolsCard) this.listEl.insertBefore(toolsCard, this.listEl.firstChild);
        const tip = document.createElement('div');
        tip.className = 'split-tip';
        tip.textContent = '提示：等待态展示的是上次弃牌窗口的候选TopN（历史），可能与当前手牌不一致。';
        this.listEl.appendChild(tip);
      } else {
        if (toolsCard) this.listEl.appendChild(toolsCard);
        const tip = document.createElement('div');
        tip.className = 'split-tip';
        tip.textContent = '暂无历史候选TopN；等你进入弃牌窗口后会自动生成。';
        this.listEl.appendChild(tip);
      }
      return;
    }
	    let recoCtx = claimCtx
	      ? this.buildRecoCtxReact(snap, claimCtx.pending, actions as Array<SplitClaimAction>)
	      : this.buildRecoCtxMyTurn(snap, actions as Array<SplitTurnAction>);
		    if (recoCtx) recoCtx = this.applyAiHostedRecoOverrides(recoCtx);
		    if (recoCtx) this.ensureRecoResolution(recoCtx, snap);
		    const recoResolution = recoCtx && this.recoCtx?.decisionKey === recoCtx.decisionKey ? this.recoResolution : null;
		    const aiHostedSnapshotKey = this.aiHostedEnabled ? this.buildAiHostedSnapshotKey(snap) : null;
		    const plan = this.aiHostedPlannedAct;
		    const plannedChosenCandidateId =
		      recoCtx &&
		      plan &&
		      aiHostedSnapshotKey &&
		      plan.stage === recoCtx.stage &&
		      plan.snapshotKey === aiHostedSnapshotKey &&
		      recoCtx.input.candidates_topk.some((c) => c.candidate_id === plan.chosenCandidateId)
		        ? plan.chosenCandidateId
		        : null;
		    const chosenCandidateId = recoCtx
		      ? plannedChosenCandidateId ?? (recoResolution ? recoResolution.chosen_candidate_id : recoCtx.input.engine_top1_candidate_id)
		      : null;
		    const chosenMap = chosenCandidateId ? recoCtx?.candidateUiMap.get(chosenCandidateId) ?? null : null;
		    const engineTop1Map = recoCtx ? recoCtx.candidateUiMap.get(recoCtx.input.engine_top1_candidate_id) ?? null : null;
		    const recoCard =
		      this.recoAiEnabled && recoCtx && chosenCandidateId
		        ? this.renderRecoCard({ ctx: recoCtx, resolution: recoResolution, chosenCandidateId, aiHostedSnapshotKey })
		        : null;

	    if (mode === 'turn' && snap.canSelfTurnAct) {
	      const discardAction = (actions as Array<SplitTurnAction>).find((a) => a.kind === 'discard') as Extract<SplitTurnAction, { kind: 'discard' }> | undefined;
	      if (discardAction) {
	        const engineTop1DiscardTileKey = engineTop1Map?.discardTileKey ?? discardAction.bestTileKey ?? null;
		        this.updateTurnDiscardHistory({
		          snap,
		          discardAction,
		          analyzers: this.analyzers,
		          chosenDiscardTileKey: chosenMap?.discardTileKey ?? null,
		          engineTop1DiscardTileKey,
		          ctx: recoCtx,
		          resolution: recoResolution,
		          chosenCandidateId,
	        });
	      }
	    }

	    let selectedAction: SplitAction | null = null;
	    if (mode === 'turn') {
	      const engineRecommended = this.pickRecommendedAction(actions, mode);
	      if (chosenMap?.actionKey) {
	        const shouldAuto = !this.selectedActionKey || (engineRecommended && this.selectedActionKey === engineRecommended.key);
	        if (shouldAuto) this.selectedActionKey = chosenMap.actionKey;
	      }
	      selectedAction = this.resolveSelectedAction(actions, mode);
	      this.renderActionBar(actions, selectedAction, mode, { chosenActionKey: chosenMap?.actionKey ?? null, engineTop1ActionKey: engineTop1Map?.actionKey ?? null });
	    } else {
	      if (this.selectedActionKey) selectedAction = actions.find((action) => action.key === this.selectedActionKey) ?? null;
	      if (!selectedAction) this.selectedActionKey = null;
	      if (claimCtx) {
	        this.renderClaimActionAccordion(snap, claimCtx.pending, actions as Array<SplitClaimAction>, selectedAction as SplitClaimAction | null, {
	          chosenActionKey: chosenMap?.actionKey ?? null,
	          engineTop1ActionKey: engineTop1Map?.actionKey ?? null,
	        });
	        if (mode === 'claim' && recoCard && !this.actionBar.classList.contains('hidden')) {
	          recoCard.classList.add('is-in-claim-actions');
	          const firstClaimAction = Array.from(this.actionBar.children).find((el) => (el as HTMLElement).classList?.contains('split-claim-action')) as
	            | HTMLElement
	            | undefined;
	          if (firstClaimAction) this.actionBar.insertBefore(recoCard, firstClaimAction);
	          else this.actionBar.appendChild(recoCard);
	        }
	      }
	    }
	    this.renderSuitPanel(snap);
	    this.updateSubbarVisibility();
	    const hasMeaningfulActions = mode === 'claim' ? actions.length > 0 : actions.some((action) => action.kind !== 'discard');
	    this.placeRouteBar(!hasMeaningfulActions);

    if (this.helpOpen && !this.helpSideBySide) {
      this.renderInlineHelpInList();
      return;
    }

		    if (mode === 'claim') {
		      this.routeBar.classList.add('hidden');
		      this.listEl.innerHTML = '';
			      const followupOpen = Boolean(recoCtx && this.recoFollowupDecisionKey === recoCtx.decisionKey && this.recoFollowupOpen);
			      this.listEl.classList.add('hidden');
			      const followupVisible = !!(followupOpen && recoCtx && chosenCandidateId);
			      this.setRecoFollowupPanelVisible(followupVisible);
			      if (followupVisible && recoCtx && chosenCandidateId) {
				        this.renderRecoFollowupPanel({ resolution: recoResolution });
			      }
			      return;
			    }

    if (!selectedAction) {
      this.routeBar.classList.add('hidden');
      this.listEl.innerHTML = '';
      return;
    }

	    if (mode === 'turn' && selectedAction.kind === 'discard') {
	      this.updateRouteButtons(snap);
	      const followupOpen = Boolean(recoCtx && this.recoFollowupDecisionKey === recoCtx.decisionKey && this.recoFollowupOpen);
	      if (followupOpen && recoCtx && chosenCandidateId && recoCard) {
	        this.listEl.innerHTML = '';
	        this.listEl.appendChild(recoCard);
	        this.setRecoFollowupPanelVisible(true);
	        this.renderRecoFollowupPanel({ resolution: recoResolution });
	      } else {
	        this.setRecoFollowupPanelVisible(false);
	        this.renderCandidateList(snap, selectedAction, {
	          chosenDiscardTileKey: chosenMap?.discardTileKey ?? null,
	          engineTop1DiscardTileKey: engineTop1Map?.discardTileKey ?? null,
	        });
        if (recoCard) this.listEl.insertBefore(recoCard, this.listEl.firstChild);
      }
      return;
    }

    this.routeBar.classList.add('hidden');
    this.renderActionDetail(snap, selectedAction as Exclude<SplitTurnAction, { kind: 'discard' }>);
    if (recoCard) this.listEl.insertBefore(recoCard, this.listEl.firstChild);
  }

  private computeSafetyParts(snap: SplitSnapshot, tileKey: number): {
    safeText: string;
    familiarCount: number;
    wallCount: number;
    sujiCount: number;
  } {
    const aliveOpps = snap.opponents.filter((o) => !o.hu);
    const safeDen = aliveOpps.length;
    let safeNum = 0;
    if (safeDen > 0) {
      const suit = suitOf(tileKey);
      if (snap.stage === 'late') {
        let allSafe = true;
        for (const o of aliveOpps) {
          if (o.dingque !== suit) {
            allSafe = false;
            break;
          }
        }
        safeNum = allSafe ? safeDen : 0;
      } else {
        for (const o of aliveOpps) {
          if (o.dingque === suit) safeNum += 1;
        }
      }
    }
    return {
      safeText: safeDen > 0 ? `${safeNum}/${safeDen}` : '--',
      familiarCount: snap.publicCounts[tileKey] ?? 0,
      wallCount: adjacentWallCount(tileKey, snap.remCounts),
      sujiCount: sujiPublicCount(tileKey, snap.publicCounts),
    };
  }

  private buildCandidateMetaText(
    snap: SplitSnapshot,
    ranked: RankedCandidates,
    candidate: SplitCandidate,
    counts13: Array<number>,
    summary: StateSummary,
    analyzer: SplitAnalyzer,
    branch: SplitDiscardBranch | null,
  ): string {
    if (ranked.kind === 'dingque') {
      const pointBin = computePointBin(candidate.tileKey);
      const safety = this.computeSafetyParts(snap, candidate.tileKey);
      const fields = [
        `公开已见${candidate.publicSeen}`,
        `剩余${candidate.rem}`,
        `点数档${pointBin}`,
        `安全分${safety.safeText}`,
        `熟↑${safety.familiarCount}`,
        `壁↑${safety.wallCount}`,
        `筋↑${safety.sujiCount}`,
      ];
      return fields.join(' · ');
    }

    const u = summary.tenpai ? summary.tenpai.winCount : summary.improve?.improveCount ?? 0;
    const k = summary.tenpai ? summary.tenpai.winKinds : summary.improve?.improveKinds ?? 0;
    const estimateText = (() => {
      if (summary.tenpai) return `平均点炮=${Math.round(summary.tenpai.avgRonGain)}`;
      const nextPublicCounts = snap.publicCounts.slice();
      nextPublicCounts[candidate.tileKey] = (nextPublicCounts[candidate.tileKey] ?? 0) + 1;
      const range = analyzer.avgRonRange(counts13, nextPublicCounts, snap.remCounts);
      const rangeText = range ? `${range.min}-${range.max}` : '--';
      return `预估点炮区间=${rangeText}`;
    })();
    const safety = this.computeSafetyParts(snap, candidate.tileKey);
    const fields = [
      `${summary.shanten}向听`,
      `进张${u}(${k}种)`,
      formatApproxRatio(u, snap.unknownPoolSize, snap.wallRemaining > 0),
      estimateText,
    ];
    if (ranked.route === 'standard') {
      fields.push(`窗口分${Number.isFinite(summary.windowScore) ? summary.windowScore : '--'}`);
    }
    fields.push(`安全分${safety.safeText}·熟↑${safety.familiarCount}·壁↑${safety.wallCount}·筋↑${safety.sujiCount}`);

    if (ranked.route === 'standard') {
      let pairKinds = 0;
      let pairU = 0;
      for (let kx = 0; kx < 27; kx++) {
        const c13 = counts13[kx] ?? 0;
        if (c13 === 2) {
          pairKinds += 1;
          pairU += snap.remCounts[kx] ?? 0;
        }
      }
      const kongRegression = analyzer.kongRegression(counts13);
      const kongText = `杠${kongRegression.tripletKinds}种${kongRegression.tripletRemain}张`;
      fields.push(`碰${pairKinds}种${pairU}张`);
      fields.push(kongRegression.breakCount > 0 ? `${kongText}·退${kongRegression.breakCount}` : kongText);
    }

    return fields.join(' · ');
  }

  private renderCandidateList(
    snap: SplitSnapshot,
    discardAction: Extract<SplitTurnAction, { kind: 'discard' }>,
    reco?: { chosenDiscardTileKey: number | null; engineTop1DiscardTileKey: number | null },
    analyzers: SplitAnalyzerSet = this.analyzers,
  ): void {
    const ranked = discardAction.ranked;
    const candidates = ranked.candidates;
    if (candidates.length === 0) {
      this.listEl.innerHTML = '';
      return;
    }

    this.listEl.innerHTML = '';

    const list = document.createElement('div');
    list.className = 'split-candidates';
    this.listEl.appendChild(list);

    const chosenTileKey = reco?.chosenDiscardTileKey ?? discardAction.bestTileKey ?? null;
    const engineTop1TileKey = reco?.engineTop1DiscardTileKey ?? discardAction.bestTileKey ?? null;

    const candidateKeys = new Set<number>();
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      candidateKeys.add(c.tileKey);
      const s = c.summary;
      const item = document.createElement('details');
      item.className = `split-cand-item${chosenTileKey === c.tileKey ? ' is-best' : ''}${
        engineTop1TileKey !== null && engineTop1TileKey === c.tileKey && engineTop1TileKey !== chosenTileKey ? ' is-engine' : ''
      }`;
      item.dataset.splitCand = String(c.tileKey);
      this.applyFrameAccent(item, this.buildFrameSeed([ranked.route === 'standard' ? 1 : 2, c.tileKey, i]), 0);

      const summaryEl = document.createElement('summary');
      summaryEl.className = 'split-cand-summary';

      const left = document.createElement('div');
      left.className = 'split-cand-left';
      left.appendChild(tileImg(c.tileKey, 'split-tile'));
      const count = document.createElement('span');
      count.className = 'split-cand-count';
      count.textContent = c.countInHand >= 2 ? `×${c.countInHand}` : '';
      left.appendChild(count);
      summaryEl.appendChild(left);

	      const meta = document.createElement('div');
	      meta.className = 'split-cand-meta';
	      const analyzer = this.getRouteAnalyzer(ranked.route, analyzers);
	      const branch = discardAction.branches.get(c.tileKey) ?? null;
	      if (analyzer) {
	        const counts13 = snap.handCounts14.slice();
	        counts13[c.tileKey] = (counts13[c.tileKey] ?? 0) - 1;
	        const sum = branch?.summary ?? s ?? analyzer.summary(counts13, snap.remCounts);
        meta.textContent = this.buildCandidateMetaText(snap, ranked, c, counts13, sum, analyzer, branch);
      } else {
        meta.textContent = '--';
      }
      summaryEl.appendChild(meta);

      item.appendChild(summaryEl);

      const body = document.createElement('div');
      body.className = 'split-cand-body';
      item.appendChild(body);

	      const loadDetail = (): void => {
	        if ((body as any)._loaded) return;
	        (body as any)._loaded = true;
	        body.appendChild(this.renderCandidateDetail(snap, c.tileKey, analyzers));
	      };

      const shouldOpen = this.expandedCandidates.has(c.tileKey);
      item.open = shouldOpen;
      if (shouldOpen) loadDetail();

      item.addEventListener('toggle', () => {
        if (item.open) {
          this.expandedCandidates.add(c.tileKey);
          loadDetail();
        } else {
          this.expandedCandidates.delete(c.tileKey);
          if (this.floatingHandSource?.handRow && item.contains(this.floatingHandSource.handRow)) {
            this.clearFloatingHandSource();
          }
        }
      });

      list.appendChild(item);
    }

    for (const k of Array.from(this.expandedCandidates.values())) {
      if (!candidateKeys.has(k)) this.expandedCandidates.delete(k);
    }

    if (this.pendingScrollTileKey !== null && candidateKeys.has(this.pendingScrollTileKey)) {
      const tileKey = this.pendingScrollTileKey;
      this.pendingScrollTileKey = null;
      this.scrollToCandidate(tileKey);
    }

    if (ranked.kind === 'dingque') {
      const tip = document.createElement('div');
      tip.className = 'split-tip';
      tip.textContent = '排序口径：公开已见最多优先；并列依次看剩余张数、局况点数档、安全分、壁牌、筋牌。';
      this.listEl.appendChild(tip);
    }
  }

  private renderClaimHuDetail(pending: BloodPendingClaim, action: Extract<SplitClaimAction, { kind: 'claimHu' }>): HTMLElement {
    const box = document.createElement('div');
    box.className = 'split-metrics';
    this.applyFrameAccent(box, this.buildFrameSeed([97, action.gain]), 1);

    const trigger = pending.trigger ?? 'discard';
    const isQiangGangHu = trigger === 'addKong';
    const isGangShangPao = trigger === 'discard' && Boolean(pending.afterGang);
    const title = document.createElement('div');
    title.className = 'split-subtitle';
    title.textContent = isQiangGangHu ? '抢杠胡详情' : isGangShangPao ? '杠上炮详情' : '点炮胡详情';
    box.appendChild(title);

    const line1 = document.createElement('div');
    line1.className = 'split-row-text';
    line1.textContent = `番型：${formatFansLine(action.calc.fans)}`;
    box.appendChild(line1);

    const line2 = document.createElement('div');
    line2.className = 'split-row-text';
    line2.textContent = `倍数 ${action.calc.multiplierCapped}倍 · 总分 ${action.calc.winnerGain}`;
    box.appendChild(line2);
    return box;
  }

  private renderClaimPassDetail(snap: SplitSnapshot, action: Extract<SplitClaimAction, { kind: 'claimPass' }>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'split-action-detail';

    const box = document.createElement('div');
    box.className = 'split-metrics';
    this.applyFrameAccent(box, this.buildFrameSeed([103, action.rangeMin, action.rangeMax]), 1);

    const title = document.createElement('div');
    title.className = 'split-subtitle';
    title.textContent = '过详情';
    box.appendChild(title);

    const line1 = document.createElement('div');
    line1.className = 'split-row-text';
    line1.textContent = `收益区间 ${formatGainRange(action.rangeMin, action.rangeMax)}`;
    box.appendChild(line1);

    if (action.blockedByDingque) {
      const warn = document.createElement('div');
      warn.className = 'split-warn';
      warn.textContent = '仍有定缺牌：建议先清缺（缺门牌不能碰/杠/胡），本页暂不计算向听/进张。';
      wrap.appendChild(box);
      wrap.appendChild(warn);
      return wrap;
    }

    const sum = action.summary;
    const u = sum?.tenpai ? sum.tenpai.winCount : sum?.improve?.improveCount ?? 0;
    const k = sum?.tenpai ? sum.tenpai.winKinds : sum?.improve?.improveKinds ?? 0;
    const estimateText = sum?.tenpai ? `平均点炮=${Math.round(sum.tenpai.avgRonGain)}` : `预估点炮区间=${formatGainRange(action.rangeMin, action.rangeMax)}`;
    const fields: Array<string> = [];
    fields.push(`${sum?.shanten ?? '--'}向听`);
    fields.push(`进张${u}(${k}种)`);
    fields.push(formatApproxRatio(u, snap.unknownPoolSize, snap.wallRemaining > 0));
    fields.push(estimateText);
    if (action.route === 'standard' && sum && Number.isFinite(sum.windowScore)) fields.push(`窗口分${sum.windowScore}`);

    const line2 = document.createElement('div');
    line2.className = 'split-row-text';
    line2.textContent = fields.join(' · ');
    box.appendChild(line2);

    wrap.appendChild(box);
    return wrap;
  }

  private renderClaimPengDetail(snap: SplitSnapshot, action: Extract<SplitClaimAction, { kind: 'claimPeng' }>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'split-action-detail';

    const box = document.createElement('div');
    box.className = 'split-metrics';
    this.applyFrameAccent(box, this.buildFrameSeed([107, action.tileKey, action.rangeMin, action.rangeMax]), 1);

    const title = document.createElement('div');
    title.className = 'split-subtitle';
    title.textContent = `碰 ${tileCode(action.tileKey)}`;
    box.appendChild(title);

    const line1 = document.createElement('div');
    line1.className = 'split-row-text';
    const discardText = action.bestDiscardTileKey !== null ? tileCode(action.bestDiscardTileKey) : '--';
    line1.textContent = `推荐弃 ${discardText} · 收益区间 ${formatGainRange(action.rangeMin, action.rangeMax)}`;
    box.appendChild(line1);

    if (action.blockedByDingque) {
      const warn = document.createElement('div');
      warn.className = 'split-warn';
      warn.textContent = '仍有定缺牌：建议先清缺（缺门牌不能碰/杠/胡），本页暂不计算向听/进张。';
      wrap.appendChild(box);
      wrap.appendChild(warn);
      return wrap;
    }

    const sum = action.bestSummary;
    const u = sum?.tenpai ? sum.tenpai.winCount : sum?.improve?.improveCount ?? 0;
    const k = sum?.tenpai ? sum.tenpai.winKinds : sum?.improve?.improveKinds ?? 0;
    const estimateText = sum?.tenpai ? `平均点炮=${Math.round(sum.tenpai.avgRonGain)}` : `预估点炮区间=${formatGainRange(action.rangeMin, action.rangeMax)}`;

    const safetySnap: SplitSnapshot = { ...snap, publicCounts: action.publicCountsAfter };
    const safety =
      action.bestDiscardTileKey !== null ? this.computeSafetyParts(safetySnap, action.bestDiscardTileKey) : { safeText: '--', familiarCount: 0, wallCount: 0, sujiCount: 0 };

    const fields: Array<string> = [];
    fields.push(`${sum?.shanten ?? '--'}向听`);
    fields.push(`进张${u}(${k}种)`);
    fields.push(formatApproxRatio(u, snap.unknownPoolSize, snap.wallRemaining > 0));
    fields.push(estimateText);
    if (action.bestRoute === 'standard' && sum && Number.isFinite(sum.windowScore)) fields.push(`窗口分${sum.windowScore}`);
    fields.push(`安全分${safety.safeText}·熟↑${safety.familiarCount}·壁↑${safety.wallCount}·筋↑${safety.sujiCount}`);

    const line2 = document.createElement('div');
    line2.className = 'split-row-text';
    line2.textContent = fields.join(' · ');
    box.appendChild(line2);

    wrap.appendChild(box);
    return wrap;
  }

  private renderClaimMingGangDetail(action: Extract<SplitClaimAction, { kind: 'claimMingGang' }>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'split-gang-detail';

    const box = document.createElement('div');
    box.className = 'split-metrics';
    this.applyFrameAccent(box, this.buildFrameSeed([113, action.tileKey, action.outcomes.length]), 1);

    const title = document.createElement('div');
    title.className = 'split-subtitle';
    title.textContent = `明杠 ${tileCode(action.tileKey)}`;
    box.appendChild(title);

    const line1 = document.createElement('div');
    line1.className = 'split-row-text';
    line1.textContent = `杠豆 ${formatGainRange(action.immediateGain, action.immediateGain)}`;
    box.appendChild(line1);

    const line2 = document.createElement('div');
    line2.className = 'split-row-text';
    line2.textContent = `总收益区间 ${formatGainRange(action.gainMin, action.gainMax)} · 最坏向听 ${action.worstShanten}`;
    box.appendChild(line2);

    if (action.kaihuaKindCount > 0) {
      const line = document.createElement('div');
      line.className = 'split-row-text';
      line.textContent = `杠开花：${action.kaihuaKindCount}种/${action.kaihuaTileCount}张`;
      box.appendChild(line);
    }
    if (action.shantenBuckets.length > 0) {
      const dist = action.shantenBuckets.map((b) => `${b.shanten}向听 ${b.kindCount}种/${b.tileCount}张`).join('；');
      const line = document.createElement('div');
      line.className = 'split-row-text';
      line.textContent = `补张后向听分布：${dist}`;
      box.appendChild(line);
    }

    wrap.appendChild(box);

    const detailBox = document.createElement('div');
    detailBox.className = 'split-tenpai';
    this.applyFrameAccent(detailBox, this.buildFrameSeed([127, action.tileKey, 1]), 1);
    const detailTitle = document.createElement('div');
    detailTitle.className = 'split-subtitle';
    detailTitle.textContent = '补张明细';
    detailBox.appendChild(detailTitle);

    if (action.outcomes.length === 0 && action.zeroRemain <= 0) {
      const empty = document.createElement('div');
      empty.className = 'split-empty';
      empty.textContent = '暂无有效补张';
      detailBox.appendChild(empty);
    } else {
      const table = document.createElement('div');
      table.className = 'split-table';
      for (const outcome of action.outcomes) {
        const row = document.createElement('div');
        row.className = 'split-row';
        row.appendChild(tileImg(outcome.tileKey, 'split-tile-sm'));
        const text = document.createElement('div');
        text.className = 'split-row-text';
        if (outcome.kind === 'kaihua') {
          text.textContent = `×${outcome.remain} · 杠开${outcome.gain} · 倍${outcome.multiplier}`;
        } else {
          const discardText = outcome.discardTileKey !== null ? `续出${tileCode(outcome.discardTileKey)}` : '后续';
          const shantenText = outcome.shanten !== null && Number.isFinite(outcome.shanten) ? ` · ${outcome.shanten}向听` : '';
          text.textContent = `×${outcome.remain} · ${discardText} · ${formatGainRange(outcome.gainMin, outcome.gainMax)}${shantenText}`;
        }
        row.appendChild(text);
        table.appendChild(row);
      }
      if (action.zeroRemain > 0) {
        const row = document.createElement('div');
        row.className = 'split-row';
        const text = document.createElement('div');
        text.className = 'split-row-text';
        text.textContent = `其余补张 ×${action.zeroRemain} · 0`;
        row.appendChild(text);
        table.appendChild(row);
      }
      detailBox.appendChild(table);
    }
    wrap.appendChild(detailBox);
    return wrap;
  }

  private renderActionDetail(snap: SplitSnapshot, action: Exclude<SplitTurnAction, { kind: 'discard' }>): void {
    this.listEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'split-action-detail';
    wrap.appendChild(action.kind === 'hu' ? this.renderHuDetail(action) : this.renderGangDetail(snap, action));
    this.listEl.appendChild(wrap);
  }

  private renderHuDetail(action: Extract<SplitTurnAction, { kind: 'hu' }>): HTMLElement {
    const box = document.createElement('div');
    box.className = 'split-metrics';
    this.applyFrameAccent(box, this.buildFrameSeed([11, action.gain]), 1);

    const line = document.createElement('div');
    line.className = 'split-row-text';
    line.textContent = `${formatFansLine(action.calc.fans)} · ${action.calc.multiplierCapped}倍 · 总分${action.calc.winnerGain}`;
    box.appendChild(line);

    return box;
  }

  private renderGangDetail(snap: SplitSnapshot, action: Extract<SplitTurnAction, { kind: 'gang' }>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'split-gang-detail';

    const box = document.createElement('div');
    box.className = 'split-metrics';
    this.applyFrameAccent(box, this.buildFrameSeed([17, action.tileKey, action.gangType === 'an' ? 1 : 2]), 1);

    const title = document.createElement('div');
    title.className = 'split-detail-discard';
    title.appendChild(document.createTextNode(action.gangType === 'an' ? '暗杠' : '加杠'));
    title.appendChild(tileImg(action.tileKey, 'split-action-tile'));
    title.appendChild(
      document.createTextNode(
        `· 杠豆 ${formatGainRange(action.immediateGain, action.immediateGain)} · 总收益区间 ${formatGainRange(action.gainMin, action.gainMax)}`,
      ),
    );
    box.appendChild(title);
    wrap.appendChild(box);

    const detailBox = document.createElement('div');
    detailBox.className = 'split-tenpai';
    this.applyFrameAccent(detailBox, this.buildFrameSeed([29, action.tileKey, action.outcomes.length]), 1);
    const detailTitle = document.createElement('div');
    detailTitle.className = 'split-subtitle';
    detailTitle.textContent = '补张明细';
    detailBox.appendChild(detailTitle);

    if (action.outcomes.length === 0 && action.zeroRemain <= 0) {
      const empty = document.createElement('div');
      empty.className = 'split-empty';
      empty.textContent = '暂无有效补张';
      detailBox.appendChild(empty);
    } else {
      const table = document.createElement('div');
      table.className = 'split-table';
      for (const outcome of action.outcomes) {
        const row = document.createElement('div');
        row.className = 'split-row';
        row.appendChild(tileImg(outcome.tileKey, 'split-tile-sm'));
        const text = document.createElement('div');
        text.className = 'split-row-text';
        if (outcome.kind === 'kaihua') {
          text.textContent = `×${outcome.remain} · 杠开${outcome.gain} · 倍${outcome.multiplier}`;
        } else {
          const discardText = outcome.discardTileKey !== null ? `续出${tileCode(outcome.discardTileKey)}` : '后续';
          text.textContent = `×${outcome.remain} · ${discardText} · ${formatGainRange(outcome.gainMin, outcome.gainMax)}`;
        }
        row.appendChild(text);
        table.appendChild(row);
      }
      if (action.zeroRemain > 0) {
        const row = document.createElement('div');
        row.className = 'split-row';
        const text = document.createElement('div');
        text.className = 'split-row-text';
        text.textContent = `其余补张 ×${action.zeroRemain} · 0`;
        row.appendChild(text);
        table.appendChild(row);
      }
      detailBox.appendChild(table);
    }
    wrap.appendChild(detailBox);

    return wrap;
  }

  private scrollToCandidate(tileKey: number): void {
    const key = tileKey;
    window.requestAnimationFrame(() => {
      const el = this.listEl.querySelector(`[data-split-cand="${key}"]`) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ block: 'start' });
    });
  }

  private renderCandidateDetail(snap: SplitSnapshot, discardTileKey: number, analyzers: SplitAnalyzerSet = this.analyzers): HTMLElement {
    const counts13 = snap.handCounts14.slice();
    counts13[discardTileKey] = (counts13[discardTileKey] ?? 0) - 1;
    const branchPublicCounts = snap.publicCounts.slice();
    branchPublicCounts[discardTileKey] = (branchPublicCounts[discardTileKey] ?? 0) + 1;
    const blocked = this.hasDingqueTilesInCounts(counts13, snap.myDingque);
	    const route =
	      blocked
	        ? 'standard'
	        : this.hasDingqueTiles(snap)
	          ? this.getAutoRouteForClearedCandidate(counts13, branchPublicCounts, snap.remCounts, analyzers)
	          : this.getActiveRouteForCounts(snap, counts13, analyzers);
	    const analyzer = this.getRouteAnalyzer(route, analyzers);
    if (!analyzer) {
      const out = document.createElement('div');
      out.className = 'split-empty';
      out.textContent = '--';
      return out;
    }
    const summary = blocked ? null : analyzer.summary(counts13, snap.remCounts);

    const wrap = document.createElement('div');
    wrap.className = 'split-cand-detail';

    const head = document.createElement('div');
    head.className = 'split-detail-head';

    const discardRow = document.createElement('div');
    discardRow.className = 'split-detail-discard';
    const routeLabel = route === 'standard' ? '标准' : '七对';
    const detailText = (() => {
      if (blocked) return `出 ${tileCode(discardTileKey)} · 清缺优先`;
      const sum = summary!;
      if (sum.tenpai) {
        return `出 ${tileCode(discardTileKey)} · ${routeLabel} · 0向听 · 平均点炮 ${Math.round(sum.tenpai.avgRonGain)} · 平均自摸 ${Math.round(sum.tenpai.avgZimoGain)}`;
      }
      const range = analyzer.avgRonRange(counts13, branchPublicCounts, snap.remCounts);
      const rangeText = range ? `${range.min}-${range.max}` : '--';
      const improveU = sum.improve?.improveCount ?? 0;
      const improveK = sum.improve?.improveKinds ?? 0;
      return `出 ${tileCode(discardTileKey)} · ${routeLabel} · ${sum.shanten}向听 · 进张${improveU}(${improveK}种) · 预估点炮区间 ${rangeText}`;
    })();
    discardRow.textContent = detailText;
    head.appendChild(discardRow);

	    const handRow = document.createElement('div');
	    handRow.className = 'split-detail-hand';
	    handRow.appendChild(document.createTextNode(snap === this.snapshot ? '当前暗手：' : '当时暗手：'));
    const tilesWrap = document.createElement('span');
    tilesWrap.className = 'split-tiles';
    handRow.appendChild(tilesWrap);
    const safety = this.computeSafetyParts(snap, discardTileKey);
    const safetyText = document.createElement('span');
    safetyText.className = 'split-detail-inline-safety';
    safetyText.textContent = `· 安全分${safety.safeText} · 熟${safety.familiarCount} · 壁${safety.wallCount} · 筋${safety.sujiCount}`;
    handRow.appendChild(safetyText);
    head.appendChild(handRow);
    wrap.appendChild(head);

    const setCurrentHand = (nextCounts13: ReadonlyArray<number>): void => {
      tilesWrap.innerHTML = '';
      const tiles = tilesFromCounts(nextCounts13).sort((a, b) => a - b);
      for (const t of tiles) tilesWrap.appendChild(tileImg(t, 'split-tile-sm'));
      if (this.floatingHandSource?.tilesWrap === tilesWrap) {
        this.floatingHandTilesEl.innerHTML = tilesWrap.innerHTML;
      }
    };
    setCurrentHand(counts13);
    this.setFloatingHandSource(handRow, tilesWrap);
    wrap.addEventListener('pointerdown', () => this.setFloatingHandSource(handRow, tilesWrap));

	    if (blocked) {
	      const warn = document.createElement('div');
	      warn.className = 'split-warn';
	      warn.textContent = '仍有定缺牌：先清缺（缺门牌不能碰/杠/胡），本页暂不计算向听/进张。';
	      wrap.appendChild(warn);
	    } else {
	      const sum = summary!;
	      if (route === 'standard') {
	        const kongRegression = analyzer.kongRegression(counts13);
	        if (kongRegression.breakCount > 0) {
	          wrap.appendChild(this.renderKongRegression(kongRegression, this.buildFrameSeed([discardTileKey, 101])));
	        }
	      }
		      if (sum.tenpai) {
		        wrap.appendChild(this.renderTenpaiWaits(sum, this.buildFrameSeed([discardTileKey, 211])));
		      } else if (sum.improve) {
		        if (route === 'standard') {
		          wrap.appendChild(this.renderImproveTree(analyzer, counts13, branchPublicCounts, snap.remCounts, this.buildFrameSeed([discardTileKey, 307]), setCurrentHand));
		        } else {
		          wrap.appendChild(this.renderSevenPairsImproveList(snap.remCounts, sum, this.buildFrameSeed([discardTileKey, 409])));
		        }
		      }
		    }

    return wrap;
  }

  private renderKongRegression(summary: KongRegressionSummary, seed: number): HTMLElement {
    const box = document.createElement('div');
    box.className = 'split-metrics';
    this.applyFrameAccent(box, seed, 1);

    const title = document.createElement('div');
    title.className = 'split-subtitle';
    title.textContent = '拆刻子退值（尽量保留）';
    box.appendChild(title);

    const table = document.createElement('div');
    table.className = 'split-table';
    for (const item of summary.items.filter((x) => x.broken)) {
      const row = document.createElement('div');
      row.className = 'split-row';
      row.appendChild(tileImg(item.tileKey, 'split-tile-sm'));
      const text = document.createElement('div');
      text.className = 'split-row-text';
      text.textContent = `×${item.remain} → 退1`;
      row.appendChild(text);
      table.appendChild(row);
    }
    box.appendChild(table);
    return box;
  }

  private renderTenpaiWaits(summary: StateSummary, seed: number): HTMLElement {
    const box = document.createElement('div');
    box.className = 'split-tenpai';
    this.applyFrameAccent(box, seed, 1);

    const waits = summary.tenpai?.waits ?? [];
    if (waits.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'split-empty';
      empty.textContent = '无进张（可能都已见光）';
      box.appendChild(empty);
      return box;
    }

    const table = document.createElement('div');
    table.className = 'split-table';
    for (const w of waits) {
      const row = document.createElement('div');
      row.className = 'split-row';
      row.appendChild(tileImg(w.tileKey, 'split-tile-sm'));
      const text = document.createElement('div');
      text.className = 'split-row-text';
      const multText =
        w.ronMultiplier === w.zimoMultiplier
          ? `倍${w.ronMultiplier}`
          : `倍(点炮/自摸)${w.ronMultiplier}/${w.zimoMultiplier}`;
      text.textContent = `×${w.remain} · 点炮${w.ronGain} · 自摸${w.zimoGain} · ${multText}`;
      row.appendChild(text);
      table.appendChild(row);
    }
    box.appendChild(table);
    return box;
  }

  private renderSevenPairsImproveList(remCounts: ReadonlyArray<number>, summary: StateSummary, seed: number): HTMLElement {
    const box = document.createElement('div');
    box.className = 'split-metrics';
    this.applyFrameAccent(box, seed, 1);

    const title = document.createElement('div');
    title.className = 'split-subtitle';
    title.textContent = '进张明细';
    box.appendChild(title);

    const improve = summary.improve;
    if (!improve || improve.improveTiles.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'split-empty';
      empty.textContent = '暂无有效进张';
      box.appendChild(empty);
      return box;
    }

	    const table = document.createElement('div');
	    table.className = 'split-table';
	    for (const tileKey of improve.improveTiles) {
      const row = document.createElement('div');
      row.className = 'split-row';
      row.appendChild(tileImg(tileKey, 'split-tile-sm'));
      const text = document.createElement('div');
      text.className = 'split-row-text';
	      const remain = remCounts[tileKey] ?? 0;
	      text.textContent = `×${remain}`;
      row.appendChild(text);
      table.appendChild(row);
    }
    box.appendChild(table);
    return box;
  }

  private renderImproveTree(
    analyzer: SplitAnalyzer,
    rootCounts13: Array<number>,
    rootPublicCounts: ReadonlyArray<number>,
    rootRemCounts: ReadonlyArray<number>,
    seedBase: number,
    onActiveCounts?: (counts13: ReadonlyArray<number>) => void,
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'split-improve';

    const countsByDetails = new WeakMap<HTMLDetailsElement, Array<number>>();
    const openedAt = new WeakMap<HTMLDetailsElement, number>();
    let openSeq = 0;
    let activeDetails: HTMLDetailsElement | null = null;
    const updateActiveCounts = (): void => {
      if (!onActiveCounts) return;
      const openEls = Array.from(wrap.querySelectorAll('details.split-draw[open]')) as Array<HTMLDetailsElement>;
      const visibleOpen = openEls.filter((el) => {
        let p: HTMLElement | null = el.parentElement;
        while (p) {
          if (p instanceof HTMLDetailsElement && p.classList.contains('split-draw') && !p.open) return false;
          p = p.parentElement;
        }
        return true;
      });
      if (visibleOpen.length === 0) {
        if (activeDetails) activeDetails.classList.remove('is-active');
        activeDetails = null;
        onActiveCounts(rootCounts13);
        return;
      }
      let best: HTMLDetailsElement | null = null;
      let bestDepth = -1;
      let bestOpen = -1;
      for (const el of visibleOpen) {
        const depth = Number.isFinite(Number(el.dataset.splitDepth)) ? Math.trunc(Number(el.dataset.splitDepth)) : 0;
        const ord = openedAt.get(el) ?? 0;
        if (depth > bestDepth || (depth === bestDepth && ord > bestOpen)) {
          best = el;
          bestDepth = depth;
          bestOpen = ord;
        }
      }
      const counts = best ? countsByDetails.get(best) : null;
      if (best !== activeDetails) {
        if (activeDetails) activeDetails.classList.remove('is-active');
        if (best) best.classList.add('is-active');
        activeDetails = best;
      }
      onActiveCounts(counts ?? rootCounts13);
    };

    const details = analyzer.details(rootCounts13, rootPublicCounts, rootRemCounts);
    if (details.draws.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'split-empty';
      empty.textContent = '暂无有效进张';
      wrap.appendChild(empty);
      return wrap;
    }

    const list = document.createElement('div');
    list.className = 'split-tree';
    wrap.appendChild(list);

    const formatLine = (
      counts13: Array<number>,
      sum: StateSummary,
      publicCounts: ReadonlyArray<number>,
      remCounts: ReadonlyArray<number>,
    ): string => {
      if (sum.tenpai) return `0向听 · 进张${sum.tenpai.winCount}(${sum.tenpai.winKinds}种) · 平均点炮=${Math.round(sum.tenpai.avgRonGain)}`;
      if (sum.improve) {
        const range = analyzer.avgRonRange(counts13, publicCounts, remCounts);
        const rangeText = range ? `${range.min}-${range.max}` : '--';
        return `${sum.shanten}向听 · 进张${sum.improve.improveCount}(${sum.improve.improveKinds}种) · 预估点炮区间=${rangeText}`;
      }
      return `${sum.shanten}向听`;
    };

    const renderNode = (
      container: HTMLElement,
      counts13: Array<number>,
      publicCounts: ReadonlyArray<number>,
      remCounts: ReadonlyArray<number>,
      showTitle = true,
      nodeDepth = 0,
    ): void => {
      const sum = analyzer.summary(counts13, remCounts);
      const box = document.createElement('div');
      box.className = 'split-node';
      this.applyFrameAccent(
        box,
        this.buildFrameSeed([seedBase, nodeDepth, counts13[0] ?? 0, counts13[8] ?? 0, counts13[17] ?? 0, counts13[26] ?? 0]),
        nodeDepth + 1,
      );

      if (showTitle) {
        const title = document.createElement('div');
        title.className = 'split-node-title';
        title.textContent = formatLine(counts13, sum, publicCounts, remCounts);
        box.appendChild(title);
      }

      if (sum.tenpai) {
        box.appendChild(this.renderTenpaiWaits(sum, this.buildFrameSeed([seedBase, nodeDepth, 701])));
        container.appendChild(box);
        return;
      }

      const det = analyzer.details(counts13, publicCounts, remCounts);
      const draws = det.draws;
      if (draws.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'split-empty';
        empty.textContent = '暂无有效进张';
        box.appendChild(empty);
        container.appendChild(box);
        return;
      }

      const drawList = document.createElement('div');
      drawList.className = 'split-draw-list';
      for (let drawIndex = 0; drawIndex < draws.length; drawIndex++) {
        const d = draws[drawIndex]!;
        const sameTier = Array.isArray(d.sameTierDiscards) && d.sameTierDiscards.length > 0 ? d.sameTierDiscards : [d.bestDiscard];
        for (let discardIndex = 0; discardIndex < sameTier.length; discardIndex++) {
          const discard = sameTier[discardIndex]!;
          const nextCounts13 = (() => {
            const next = counts13.slice();
            next[d.drawTile] = (next[d.drawTile] ?? 0) + 1;
            next[discard] = (next[discard] ?? 0) - 1;
            return next;
          })();
          const nextPublicCounts = publicCounts.slice();
          nextPublicCounts[discard] = (nextPublicCounts[discard] ?? 0) + 1;
          const nextRemCounts = remCounts.slice();
          if ((nextRemCounts[d.drawTile] ?? 0) > 0) nextRemCounts[d.drawTile] = (nextRemCounts[d.drawTile] ?? 0) - 1;
          const nextSum = analyzer.summary(nextCounts13, nextRemCounts);
          const nextText = formatLine(nextCounts13, nextSum, nextPublicCounts, nextRemCounts);

          const item = document.createElement('details');
          item.className = 'split-draw';
          item.dataset.splitDepth = String(nodeDepth + 1);
          this.applyFrameAccent(item, this.buildFrameSeed([seedBase, nodeDepth, drawIndex, discardIndex, d.drawTile, discard]), nodeDepth + 2);
          countsByDetails.set(item, nextCounts13);
          const sumEl = document.createElement('summary');
          sumEl.className = 'split-draw-summary';
          sumEl.appendChild(document.createTextNode('摸 '));
          sumEl.appendChild(tileImg(d.drawTile, 'split-tile-sm'));
          sumEl.appendChild(document.createTextNode(` ×${d.remain} → 弃 `));
          sumEl.appendChild(tileImg(discard, 'split-tile-sm'));
          sumEl.appendChild(document.createTextNode(` ${nextText}`));
          item.appendChild(sumEl);

          const body = document.createElement('div');
          body.className = 'split-draw-body';
          item.appendChild(body);

          item.addEventListener('toggle', () => {
            if (item.open) {
              openedAt.set(item, ++openSeq);
              updateActiveCounts();
              if ((body as any)._loaded) return;
              (body as any)._loaded = true;
              renderNode(body, nextCounts13, nextPublicCounts, nextRemCounts, false, nodeDepth + 1);
              return;
            }
            updateActiveCounts();
          });

          drawList.appendChild(item);
        }
      }
      box.appendChild(drawList);
      container.appendChild(box);
    };

    renderNode(list, rootCounts13, rootPublicCounts, rootRemCounts, true, 0);
    return wrap;
  }

  private renderHelpContent(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'split-help-content';

    const lead = document.createElement('div');
    lead.className = 'split-help-lead';
    const leadTitle = document.createElement('div');
    leadTitle.className = 'split-help-title';
    leadTitle.textContent = '🧭 怎么看（推荐顺序）';
    lead.appendChild(leadTitle);

    const leadLines = [
      '① 先看动作条：自摸 / 暗杠 / 加杠 / 出牌，带“荐”的为本回合建议。',
      '② 若选择出牌，再分路线：标准型与七对分别计算，不混算。',
      '③ 再看主指标：向听 → 进张U(K种) → P≈U/N → 预估得分。',
      '④ 最后看形状/安全：标准型再看窗口分，两页都看安全分、熟↑、壁↑、筋↑。',
    ];
    for (const t of leadLines) {
      const p = document.createElement('div');
      p.className = 'split-help-line';
      p.textContent = t;
      lead.appendChild(p);
    }
    wrap.appendChild(lead);

    type HelpItem = { k: string; v: string };
    type HelpGroup = { title: string; items: Array<HelpItem> };
    const groups: Array<HelpGroup> = [
      {
        title: '📌 共通',
        items: [
          { k: '动作条', v: '当前回合真实可选动作；自摸显示精确值，杠/出牌显示区间。' },
          { k: '路线路径', v: '标准型与七对分开计算、分开排序，不把两条路线混成一个值。' },
          { k: '标准型', v: '常规成型路线（顺子/刻子为主），与七对分开计算。' },
          { k: '七对', v: '以凑齐七个对子为目标的路线；与标准型分开计算。' },
          { k: '定缺', v: '定缺后未清缺前，缺门牌不能碰/杠/胡；清缺中会有额外限制。' },
          { k: '清缺', v: '把缺门牌打完；清缺中优先推荐清缺动作，部分指标会降级/暂停。' },
          { k: '向听', v: '离听牌还差几步；数字越小越快。' },
          { k: '进张U(K种)', v: '下一摸能让当前路线向听严格变小的牌；K=种类数，U=剩余张数总和。0向听也统一叫进张。' },
          { k: '进张口径', v: '当前只统计向听严格变小，不含同向听改良。' },
          { k: 'P≈U/N', v: '下一摸命中进张的近似概率；N=未知牌池=牌墙剩余+所有对手未公开暗手。' },
          { k: '预估得分', v: '0向听显示平均点炮；非0向听显示预估点炮区间。' },
        ],
      },
      {
        title: '🀄 标准型',
        items: [
          { k: '排序', v: '向听 → U → K → 预估得分 → 窗口分 → 安全。' },
          { k: '窗口分W', v: '1/9=1，2/8=2，3-7=3；只用于标准型的粗粒度形状判断，不能等同于搭子分类。' },
          { k: '碰/杠/退K', v: '仅标准型显示；保留当前教学口径。' },
          { k: '递归树', v: '标准型在非0向听时展示递归进张树，树内也只按标准型口径递归。' },
        ],
      },
      {
        title: '🀫 七对',
        items: [
          { k: '排序', v: '向听 → U → K → 预估得分 → 安全。' },
          { k: '不看窗口分', v: '七对页不显示窗口分，也不把窗口分当作七对形状指标。' },
          { k: '不看递归树', v: '七对页前台不展示递归树；后台只为计算区间而递归。' },
        ],
      },
      {
        title: '🛡️ 安全',
        items: [
          { k: '安全分k/n', v: '只表示定缺硬安全；不与熟、壁、筋混成一个总分。' },
          { k: '熟↑x', v: '这张候选弃牌在公开区里已出现多少张；熟↑0 就等于生牌。' },
          { k: '壁↑x', v: '只算满壁；看相邻牌在已知区里是否4张全见，x 只会是0/1/2。' },
          { k: '筋↑x', v: '看同花色±3的两张牌在公开区里出现多少张，总和越大筋证据越多。' },
          { k: '安全排序', v: '安全分 → 熟 → 壁 → 筋。' },
        ],
      },
    ];

    const renderGroup = (g: HelpGroup) => {
      const group = document.createElement('div');
      group.className = 'split-help-group';

      const title = document.createElement('div');
      title.className = 'split-help-title';
      title.textContent = g.title;
      group.appendChild(title);

      const dict = document.createElement('div');
      dict.className = 'split-help-dict';
      for (const it of g.items) {
        const row = document.createElement('div');
        row.className = 'split-help-item';
        const entry = findRecoGlossaryEntry(it.k);
        const key = document.createElement(entry ? 'button' : 'span');
        key.className = `split-help-k${entry ? ' is-term' : ''}`;
        key.textContent = it.k;
        if (entry) {
          (key as HTMLButtonElement).type = 'button';
          (key as HTMLButtonElement).onclick = (e) => {
            e.stopPropagation();
            this.openRecoGlossary(entry);
          };
        }
        const val = document.createElement('span');
        val.className = 'split-help-v';
        val.textContent = `：${it.v}`;
        row.appendChild(key);
        row.appendChild(val);
        dict.appendChild(row);
      }
      group.appendChild(dict);
      return group;
    };

    for (const g of groups) wrap.appendChild(renderGroup(g));

    return wrap;
  }

  private openRecoGlossary(entry: RecoGlossaryEntry): void {
    if (!this.open) return;
    this.glossaryOpenKey = entry.key;
    this.glossaryBackdrop.classList.remove('hidden');
    this.glossaryDrawer.classList.remove('hidden');
    this.renderRecoGlossary(entry);
  }

  private closeRecoGlossary(): void {
    this.glossaryOpenKey = null;
    this.glossaryBackdrop.classList.add('hidden');
    this.glossaryDrawer.classList.add('hidden');
    this.glossaryTitleEl.textContent = '';
    this.glossaryBodyEl.innerHTML = '';
  }

  private renderRecoGlossary(entry: RecoGlossaryEntry): void {
    this.glossaryTitleEl.textContent = entry.title;
    this.glossaryBodyEl.innerHTML = '';

    const addSection = (title: string, text: string): void => {
      const sec = document.createElement('div');
      sec.className = 'split-glossary-sec';
      const k = document.createElement('div');
      k.className = 'split-glossary-k';
      k.textContent = title;
      const v = document.createElement('div');
      v.className = 'split-glossary-v';
      v.textContent = text;
      sec.appendChild(k);
      sec.appendChild(v);
      this.glossaryBodyEl.appendChild(sec);
    };

    addSection('一句白话', entry.plain);
    addSection('放到当前牌局里的意思', entry.inGame);
    addSection('一个迷你例子', entry.example);
  }
}
