import { rankOf, suitOf } from './blood-tiles';
import type { CalcMeld } from './blood-calc-notation';
import type { BloodSuit } from './blood';

export type HuMethod = 'zimo' | 'dianpao';

export interface HuEvents {
  gangShangKaiHua?: boolean;
  gangShangPao?: boolean;
  qiangGangHu?: boolean;
  haiDi?: boolean;
}

export interface HuCalcHand {
  concealedTiles: Array<number>;
  melds: Array<CalcMeld>;
}

export interface HuCalcOptions {
  base: number;
  huMethod: HuMethod;
  remainingOpponents?: number;
  events?: HuEvents;
  cap?: number;
  // 仅按“标准形(4面子+1对)”计算胡牌（不走七对）。
  // 默认 false：保持现有逻辑（七对优先于标准形）。
  standardOnly?: boolean;
}

export interface FanApplied {
  id: FanId;
  name: string;
  multiplier: number;
}

export interface HuCalcResult {
  ok: boolean;
  errors: Array<string>;
  warnings: Array<string>;
  fans: Array<FanApplied>;
  multiplierRaw: number;
  multiplierCapped: number;
  perOpponent: number;
  payerCount: number;
  winnerGain: number;
  explanation: Array<string>;
}

type FanId =
  | 'qingYiSe'
  | 'jiang'
  | '7pairs'
  | 'goldHook'
  | 'yaojiu'
  | 'root'
  | 'zimo'
  | 'gangShangKaiHua'
  | 'gangShangPao'
  | 'qiangGangHu'
  | 'haiDi'
  | 'pongpong'
  | 'duanYaoJiu'
  | 'pinghu';

type HandKind = 'sevenPairs' | 'standard';

type SetDef =
  | { kind: 'triplet'; tileKey: number }
  | { kind: 'sequence'; startTileKey: number };

type StandardDecomposition = {
  pairTileKey: number;
  concealedSets: Array<SetDef>;
};

type HandContextBase = {
  kind: HandKind;
  qing: boolean;
  jiang: boolean;
  duanYaoJiu: boolean;
  rootCount: number;
  meldCount: number;
  kongCount: number;
};

type SevenPairsContext = HandContextBase & {
  kind: 'sevenPairs';
  quadCount: number;
};

type StandardContext = HandContextBase & {
  kind: 'standard';
  pongpong: boolean;
  yaojiu: boolean;
  goldHook: boolean;
  eighteenArhats: boolean;
};

type HandContext = SevenPairsContext | StandardContext;

const FAN_MULT_QING = 4;
const FAN_MULT_JIANG = 4;
const FAN_MULT_YAOJIU = 4;
const FAN_MULT_DUANYAOJIU = 2;

const FAN_MULT_7PAIRS = 4;
const FAN_MULT_GOLD_HOOK = 4;
const FAN_MULT_PONGPONG = 2;
const FAN_MULT_PINGHU = 1;

const FAN_MULT_EVENT = 2;

export function calcBloodHu(hand: HuCalcHand, options: HuCalcOptions): HuCalcResult {
  const errors: Array<string> = [];
  const warnings: Array<string> = [];
  const capOpt = options.cap;
  const cap = Number.isFinite(capOpt ?? NaN) && Math.trunc(capOpt as number) > 0 ? Math.trunc(capOpt as number) : null;
  const base = options.base;
  if (!Number.isFinite(base) || base <= 0) {
    errors.push('底分必须为正数');
  }

  const huMethod = options.huMethod;
  const remainingOpponents = options.remainingOpponents ?? 0;
  if (huMethod === 'zimo') {
    if (!Number.isInteger(remainingOpponents) || remainingOpponents < 1 || remainingOpponents > 3) {
      errors.push('自摸需要填写“剩余未胡对手数”(1-3)');
    }
  }

  const events = options.events ?? {};
  const eventFlags = normalizeEvents(huMethod, events, errors, warnings);

  const meldCount = hand.melds.length;
  const kongCount = hand.melds.filter((m) => m.kind === 'gang').length;
  const concealedCount = hand.concealedTiles.length;
  if (meldCount > 4) {
    errors.push('副露最多 4 组');
  }
  if (meldCount <= 4) {
    const expectedStandardConcealed = (4 - meldCount) * 3 + 2;
    if (concealedCount !== expectedStandardConcealed) {
      if (meldCount === 0) {
        errors.push(`暗手张数应为 14 张（当前 ${concealedCount} 张）`);
      } else {
        errors.push(`当前副露 ${meldCount} 组，标准形暗手应为 ${expectedStandardConcealed} 张（当前 ${concealedCount} 张）`);
      }
    }
  }

  const countsTotal = new Array(27).fill(0);
  const countsConcealed = new Array(27).fill(0);

  for (const t of hand.concealedTiles) {
    if (!Number.isInteger(t) || t < 0 || t >= 27) {
      errors.push('暗手包含非法牌');
      break;
    }
    countsConcealed[t] += 1;
    countsTotal[t] += 1;
  }
  for (const m of hand.melds) {
    if (!Number.isInteger(m.tileKey) || m.tileKey < 0 || m.tileKey >= 27) {
      errors.push('副露包含非法牌');
      break;
    }
    const tileCount = m.kind === 'gang' ? 4 : 3;
    countsTotal[m.tileKey] += tileCount;
  }

  for (let i = 0; i < 27; i++) {
    if (countsTotal[i] > 4) {
      errors.push(`同一张牌最多 4 张（${tileKeyHint(i)} 已有 ${countsTotal[i]} 张）`);
    }
  }

  const suits = suitsUsed(countsTotal);
  if (suits.size > 2) {
    errors.push('手牌包含三门花色（花猪），不满足“最多两门花色才能胡牌”');
  }

  const rootCount = countRoots(countsTotal);

  if (errors.length > 0) {
    return emptyResult(false, errors, warnings);
  }

  const { ok: okHand, ctx, best, reason } = evaluateHand(countsConcealed, hand.melds, {
    meldCount,
    kongCount,
    rootCount,
    suits,
    standardOnly: !!options.standardOnly,
  });
  if (!okHand || !ctx || !best) {
    return emptyResult(false, [reason ?? '不能胡牌：牌型不成立'], warnings);
  }

  const fans: Array<FanApplied> = buildHandFans(ctx);
  const eventFans = buildEventFans(huMethod, eventFlags);
  fans.push(...eventFans);

  let multiplierRaw = 1;
  for (const f of fans) {
    multiplierRaw *= f.multiplier;
  }
  const multiplierCapped = cap === null ? multiplierRaw : Math.min(multiplierRaw, cap);

  const payerCount = huMethod === 'zimo' ? remainingOpponents : 1;
  const perOpponent = base * multiplierCapped;
  const winnerGain = perOpponent * payerCount;

  const explanation = buildExplanation({
    base,
    cap,
    huMethod,
    payerCount,
    perOpponent,
    winnerGain,
    multiplierRaw,
    multiplierCapped,
    fans,
  });

  return {
    ok: true,
    errors: [],
    warnings,
    fans,
    multiplierRaw,
    multiplierCapped,
    perOpponent,
    payerCount,
    winnerGain,
    explanation,
  };
}

function normalizeEvents(huMethod: HuMethod, events: HuEvents, errors: Array<string>, warnings: Array<string>): Required<HuEvents> {
  const normalized: Required<HuEvents> = {
    gangShangKaiHua: Boolean(events.gangShangKaiHua),
    gangShangPao: Boolean(events.gangShangPao),
    qiangGangHu: Boolean(events.qiangGangHu),
    haiDi: Boolean(events.haiDi),
  };

  if (huMethod === 'zimo') {
    if (normalized.gangShangPao) errors.push('“杠上炮”只能点炮');
    if (normalized.qiangGangHu) errors.push('“抢杠胡”只能点炮');
  } else {
    if (normalized.gangShangKaiHua) errors.push('“杠上开花”只能自摸');
    if (normalized.haiDi) errors.push('“海底捞月”只能自摸');
  }

  if (normalized.gangShangPao && normalized.qiangGangHu) {
    // 按规则：不会同时成立。若同时传入，优先按“抢杠胡”处理（清掉杠上炮）。
    warnings.push('“杠上炮”和“抢杠胡”不会同时成立：已按“抢杠胡”处理（忽略杠上炮）。');
    normalized.gangShangPao = false;
  }

  if (normalized.gangShangKaiHua && normalized.haiDi) {
    // 按规则：海底不包含杠后补张，因此不会同时成立。若同时传入，优先按“杠上开花”处理（清掉海底）。
    warnings.push('“杠上开花”和“海底捞月”不会同时成立：已按“杠上开花”处理（忽略海底捞月）。');
    normalized.haiDi = false;
  }

  return normalized;
}

function evaluateHand(
  countsConcealed: ReadonlyArray<number>,
  melds: ReadonlyArray<CalcMeld>,
  info: { meldCount: number; kongCount: number; rootCount: number; suits: Set<BloodSuit>; standardOnly?: boolean },
): { ok: boolean; ctx: HandContext | null; best: { multiplierRaw: number } | null; reason?: string } {
  const concealedCount = countsConcealed.reduce((a, b) => a + b, 0);

  // 七对：必须无副露
  if (!info.standardOnly && info.meldCount === 0 && concealedCount === 14 && isSevenPairs(countsConcealed)) {
    const quadCount = countQuads(countsConcealed);
    const ctx: SevenPairsContext = {
      kind: 'sevenPairs',
      qing: info.suits.size === 1,
      jiang: isJiang(countsConcealed, new Array(27).fill(0)),
      duanYaoJiu: isDuanYao(countsConcealed, new Array(27).fill(0)),
      rootCount: quadCount,
      meldCount: 0,
      kongCount: 0,
      quadCount,
    };
    return { ok: true, ctx, best: { multiplierRaw: handMultiplier(ctx) } };
  }

  // 标准形：张数由副露数决定
  const setsNeeded = 4 - info.meldCount;
  if (setsNeeded < 0) {
    return { ok: false, ctx: null, best: null, reason: '副露过多（最多 4 组）' };
  }
  const expectedConcealed = setsNeeded * 3 + 2;
  if (concealedCount !== expectedConcealed) {
    return { ok: false, ctx: null, best: null, reason: '暗手张数不匹配（需要按副露数填写）' };
  }

  const meldSets: Array<SetDef> = melds.map((m) => ({ kind: 'triplet', tileKey: m.tileKey }));
  const decompositions = enumerateStandardDecompositions(countsConcealed, setsNeeded);
  if (decompositions.length === 0) {
    return { ok: false, ctx: null, best: null, reason: '暗手无法组成标准胡牌结构（4组+将）' };
  }

  const meldCountArr = meldCounts(melds);
  const jiang = isJiang(countsConcealed, meldCountArr);
  const duanYaoJiu = isDuanYao(countsConcealed, meldCountArr);

  let bestCtx: StandardContext | null = null;
  let bestMult = 0;

  for (const d of decompositions) {
    const allSets = [...meldSets, ...d.concealedSets];
    const pongpong = allSets.every((s) => s.kind === 'triplet');
    const yaojiu = isYaoJiu(allSets, d.pairTileKey);
    const ctx: StandardContext = {
      kind: 'standard',
      qing: info.suits.size === 1,
      jiang,
      duanYaoJiu,
      rootCount: info.rootCount,
      meldCount: info.meldCount,
      kongCount: info.kongCount,
      pongpong,
      yaojiu,
      goldHook: info.meldCount === 4,
      eighteenArhats: info.meldCount === 4 && info.kongCount === 4,
    };
    const mult = handMultiplier(ctx);

    if (mult > bestMult) {
      bestMult = mult;
      bestCtx = ctx;
    }
  }

  if (!bestCtx) {
    return { ok: false, ctx: null, best: null, reason: '暗手无法组成标准胡牌结构（4组+将）' };
  }

  return { ok: true, ctx: bestCtx, best: { multiplierRaw: bestMult } };
}

function handMultiplier(ctx: HandContext): number {
  let mult = 1;

  // 结构番（四选一）：七对 > 金钩钓 > 碰碰胡 > 平胡
  if (ctx.kind === 'sevenPairs') {
    mult *= FAN_MULT_7PAIRS;
  } else if (ctx.goldHook) {
    mult *= FAN_MULT_GOLD_HOOK;
  } else if (ctx.pongpong) {
    mult *= FAN_MULT_PONGPONG;
  } else {
    mult *= FAN_MULT_PINGHU;
  }

  // 属性番（可叠加）
  if (ctx.qing) mult *= FAN_MULT_QING;

  if (ctx.kind === 'standard' && ctx.yaojiu) {
    mult *= FAN_MULT_YAOJIU;
  } else if (ctx.jiang) {
    mult *= FAN_MULT_JIANG;
  } else if (ctx.duanYaoJiu) {
    mult *= FAN_MULT_DUANYAOJIU;
  }

  // 根：2^根数
  if (ctx.rootCount > 0) mult *= Math.pow(2, ctx.rootCount);

  return mult;
}

function buildEventFans(huMethod: HuMethod, events: Required<HuEvents>): Array<FanApplied> {
  const fans: Array<FanApplied> = [];
  if (huMethod === 'zimo') {
    fans.push({ id: 'zimo', name: '自摸', multiplier: FAN_MULT_EVENT });
    if (events.gangShangKaiHua) fans.push({ id: 'gangShangKaiHua', name: '杠上开花', multiplier: FAN_MULT_EVENT });
    if (events.haiDi) fans.push({ id: 'haiDi', name: '海底捞月', multiplier: FAN_MULT_EVENT });
  } else {
    if (events.gangShangPao) fans.push({ id: 'gangShangPao', name: '杠上炮', multiplier: FAN_MULT_EVENT });
    if (events.qiangGangHu) fans.push({ id: 'qiangGangHu', name: '抢杠胡', multiplier: FAN_MULT_EVENT });
  }
  return fans;
}

function buildHandFans(ctx: HandContext): Array<FanApplied> {
  const fans: Array<FanApplied> = [];

  // 结构番（四选一）：七对 > 金钩钓 > 碰碰胡 > 平胡
  if (ctx.kind === 'sevenPairs') {
    fans.push({ id: '7pairs', name: '七对', multiplier: FAN_MULT_7PAIRS });
  } else if (ctx.goldHook) {
    fans.push({ id: 'goldHook', name: '金钩钓', multiplier: FAN_MULT_GOLD_HOOK });
  } else if (ctx.pongpong) {
    fans.push({ id: 'pongpong', name: '碰碰胡', multiplier: FAN_MULT_PONGPONG });
  } else {
    fans.push({ id: 'pinghu', name: '平胡', multiplier: FAN_MULT_PINGHU });
  }

  // 属性番（可叠加）
  if (ctx.qing) fans.push({ id: 'qingYiSe', name: '清一色', multiplier: FAN_MULT_QING });

  if (ctx.kind === 'standard' && ctx.yaojiu) {
    fans.push({ id: 'yaojiu', name: '幺九', multiplier: FAN_MULT_YAOJIU });
  } else if (ctx.jiang) {
    fans.push({ id: 'jiang', name: '将', multiplier: FAN_MULT_JIANG });
  } else if (ctx.duanYaoJiu) {
    fans.push({ id: 'duanYaoJiu', name: '断幺九', multiplier: FAN_MULT_DUANYAOJIU });
  }

  // 根：2^根数（根与杠豆互不影响）
  if (ctx.rootCount > 0) fans.push({ id: 'root', name: `${ctx.rootCount}根`, multiplier: Math.pow(2, ctx.rootCount) });

  return fans;
}

function emptyResult(ok: boolean, errors: Array<string>, warnings: Array<string>): HuCalcResult {
  return {
    ok,
    errors,
    warnings,
    fans: [],
    multiplierRaw: 0,
    multiplierCapped: 0,
    perOpponent: 0,
    payerCount: 0,
    winnerGain: 0,
    explanation: [],
  };
}

function buildExplanation(params: {
  base: number;
  cap: number | null;
  huMethod: HuMethod;
  payerCount: number;
  perOpponent: number;
  winnerGain: number;
  multiplierRaw: number;
  multiplierCapped: number;
  fans: Array<FanApplied>;
}): Array<string> {
  const parts = params.fans.map((f) => `${f.name}×${f.multiplier}`);
  const lines: Array<string> = [];
  if (parts.length > 0) {
    lines.push(`倍数 = ${parts.join(' × ')}`);
  }
  if (params.cap !== null && params.multiplierRaw !== params.multiplierCapped) {
    lines.push(`封顶：min(${params.multiplierRaw}, ${params.cap}) = ${params.multiplierCapped}`);
  } else lines.push(`合计倍数 = ${params.multiplierCapped}`);
  lines.push(`单家应付 = ${params.base} × ${params.multiplierCapped} = ${params.perOpponent}`);
  if (params.huMethod === 'zimo') {
    lines.push(`自摸（剩余${params.payerCount}家）：总得分 = ${params.perOpponent} × ${params.payerCount} = ${params.winnerGain}`);
  } else {
    lines.push(`点炮：总得分 = ${params.perOpponent} × 1 = ${params.winnerGain}`);
  }
  return lines;
}

function suitsUsed(counts: ReadonlyArray<number>): Set<BloodSuit> {
  const s = new Set<BloodSuit>();
  for (let i = 0; i < 27; i++) {
    if (counts[i] > 0) s.add(suitOf(i));
  }
  return s;
}

function tileKeyHint(tileKey: number): string {
  const r = rankOf(tileKey);
  const suit = suitOf(tileKey);
  const suitText = suit === 'm' ? '万' : suit === 'p' ? '筒' : '条';
  return `${r}${suitText}`;
}

function countRoots(counts: ReadonlyArray<number>): number {
  let roots = 0;
  for (let i = 0; i < 27; i++) {
    if (counts[i] === 4) roots += 1;
  }
  return roots;
}

function countQuads(counts: ReadonlyArray<number>): number {
  let q = 0;
  for (let i = 0; i < 27; i++) {
    if (counts[i] === 4) q += 1;
  }
  return q;
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

function enumerateStandardDecompositions(counts: ReadonlyArray<number>, setsNeeded: number): Array<StandardDecomposition> {
  const buf = counts.slice();
  const out: Array<StandardDecomposition> = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] < 2) continue;
    buf[i] -= 2;
    const setsLists = enumerateSets(buf, setsNeeded);
    for (const sets of setsLists) {
      out.push({ pairTileKey: i, concealedSets: sets });
    }
    buf[i] += 2;
  }
  return out;
}

function enumerateSets(counts: number[], setsNeeded: number): Array<Array<SetDef>> {
  if (setsNeeded === 0) {
    return counts.every((c) => c === 0) ? [[]] : [];
  }

  let first = 0;
  while (first < counts.length && counts[first] === 0) first++;
  if (first >= counts.length) return [];

  const results: Array<Array<SetDef>> = [];

  // Triplet
  if (counts[first] >= 3) {
    counts[first] -= 3;
    for (const rest of enumerateSets(counts, setsNeeded - 1)) {
      results.push([{ kind: 'triplet', tileKey: first }, ...rest]);
    }
    counts[first] += 3;
  }

  // Sequence (same suit, rank <= 7)
  const r = first % 9;
  if (r <= 6) {
    const i1 = first + 1;
    const i2 = first + 2;
    if (counts[i1] > 0 && counts[i2] > 0) {
      counts[first] -= 1;
      counts[i1] -= 1;
      counts[i2] -= 1;
      for (const rest of enumerateSets(counts, setsNeeded - 1)) {
        results.push([{ kind: 'sequence', startTileKey: first }, ...rest]);
      }
      counts[first] += 1;
      counts[i1] += 1;
      counts[i2] += 1;
    }
  }

  return results;
}

function isYaoJiu(sets: ReadonlyArray<SetDef>, pairTileKey: number): boolean {
  const pairRank = rankOf(pairTileKey);
  if (pairRank !== 1 && pairRank !== 9) return false;
  for (const s of sets) {
    if (s.kind === 'triplet') {
      const r = rankOf(s.tileKey);
      if (r !== 1 && r !== 9) return false;
    } else {
      const start = rankOf(s.startTileKey);
      if (start !== 1 && start !== 7) return false;
    }
  }
  return true;
}

function isDuanYao(countsConcealed: ReadonlyArray<number>, countsMeld: ReadonlyArray<number>): boolean {
  for (let i = 0; i < 27; i++) {
    const total = countsConcealed[i] + countsMeld[i];
    if (total === 0) continue;
    const r = rankOf(i);
    if (r === 1 || r === 9) return false;
  }
  return true;
}

function isJiang(countsConcealed: ReadonlyArray<number>, countsMeld: ReadonlyArray<number>): boolean {
  for (let i = 0; i < 27; i++) {
    const total = countsConcealed[i] + countsMeld[i];
    if (total === 0) continue;
    const r = rankOf(i);
    if (r !== 2 && r !== 5 && r !== 8) return false;
  }
  return true;
}

function meldCounts(melds: ReadonlyArray<CalcMeld>): Array<number> {
  const c = new Array(27).fill(0);
  for (const m of melds) {
    c[m.tileKey] += m.kind === 'gang' ? 4 : 3;
  }
  return c;
}
