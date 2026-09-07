import {
  FACT_KEYS,
  RISK_TAG_IDS,
  candidateIdForAction,
  factId,
  type ChooseMissingSuitMetricsCore,
  type DiscardMetricsCore,
  type EngineCandidate,
  type Exchange3MetricsCore,
  type FactKey,
  type GangMetricsCore,
  type HuMethod,
  type LlmAction,
  type LlmCandidate,
  type LlmConstraints,
  type LlmRecoConfidence,
  type LlmRecoInput,
  type LlmRecoOutput,
  type RecoAction,
  type RecoStage,
  type ReactNonHuMetricsCore,
  type RiskTagId,
  type StateSummary,
  type StylePref,
  type TileCode,
} from './contract';

export type ValidationIssue = { path: string; message: string };
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: Array<ValidationIssue> };

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function err<T>(issues: Array<ValidationIssue>): ValidationResult<T> {
  return { ok: false, issues };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addIssue(issues: Array<ValidationIssue>, path: string, message: string): void {
  issues.push({ path, message });
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlyArray<string>,
  path: string,
  issues: Array<ValidationIssue>,
): void {
  const allowed = new Set(allowedKeys);
  for (const k of Object.keys(value)) {
    if (!allowed.has(k)) addIssue(issues, `${path}.${k}`, 'unexpected key');
  }
}

function readString(value: unknown, path: string, issues: Array<ValidationIssue>): string | null {
  if (typeof value === 'string') return value;
  addIssue(issues, path, 'expected string');
  return null;
}

function readBoolean(value: unknown, path: string, issues: Array<ValidationIssue>): boolean | null {
  if (typeof value === 'boolean') return value;
  addIssue(issues, path, 'expected boolean');
  return null;
}

function readFiniteNumber(value: unknown, path: string, issues: Array<ValidationIssue>): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  addIssue(issues, path, 'expected finite number');
  return null;
}

function readInt(value: unknown, path: string, issues: Array<ValidationIssue>): number | null {
  const n = readFiniteNumber(value, path, issues);
  if (n === null) return null;
  if (!Number.isInteger(n)) {
    addIssue(issues, path, 'expected integer');
    return null;
  }
  return n;
}

function readNonNegInt(value: unknown, path: string, issues: Array<ValidationIssue>): number | null {
  const n = readInt(value, path, issues);
  if (n === null) return null;
  if (n < 0) {
    addIssue(issues, path, 'expected >= 0');
    return null;
  }
  return n;
}

function readNonNegNumber(value: unknown, path: string, issues: Array<ValidationIssue>): number | null {
  const n = readFiniteNumber(value, path, issues);
  if (n === null) return null;
  if (n < 0) {
    addIssue(issues, path, 'expected >= 0');
    return null;
  }
  return n;
}

function readArray(value: unknown, path: string, issues: Array<ValidationIssue>): Array<unknown> | null {
  if (Array.isArray(value)) return value as Array<unknown>;
  addIssue(issues, path, 'expected array');
  return null;
}

const TILE_CODE_RE = /^[1-9][mps]$/;

export function isTileCodeStrict(value: unknown): value is TileCode {
  return typeof value === 'string' && TILE_CODE_RE.test(value);
}

function readTileCodeStrict(value: unknown, path: string, issues: Array<ValidationIssue>): TileCode | null {
  const s = readString(value, path, issues);
  if (s === null) return null;
  if (!TILE_CODE_RE.test(s)) {
    addIssue(issues, path, 'invalid tileCode (expected like 5p/7m/3s)');
    return null;
  }
  return s;
}

function readSuit(value: unknown, path: string, issues: Array<ValidationIssue>): 'm' | 'p' | 's' | null {
  const s = readString(value, path, issues);
  if (s === null) return null;
  if (s === 'm' || s === 'p' || s === 's') return s;
  addIssue(issues, path, 'invalid suit (expected m/p/s)');
  return null;
}

function readStage(value: unknown, path: string, issues: Array<ValidationIssue>): RecoStage | null {
  const s = readString(value, path, issues);
  if (s === null) return null;
  if (s === 'exchange_3' || s === 'choose_missing_suit' || s === 'my_turn' || s === 'react') return s;
  addIssue(issues, path, 'invalid stage');
  return null;
}

function readStylePref(value: unknown, path: string, issues: Array<ValidationIssue>): StylePref | null {
  const s = readString(value, path, issues);
  if (s === null) return null;
  if (s === '稳健' || s === '均衡' || s === '激进') return s;
  addIssue(issues, path, 'invalid style_pref');
  return null;
}

function readHuMethod(value: unknown, path: string, issues: Array<ValidationIssue>): HuMethod | null {
  const s = readString(value, path, issues);
  if (s === null) return null;
  if (s === 'zimo' || s === 'dianpao' || s === 'qianggang') return s;
  addIssue(issues, path, 'invalid hu.method');
  return null;
}

function readAction(value: unknown, path: string, issues: Array<ValidationIssue>): RecoAction | null {
  if (!isJsonObject(value)) {
    addIssue(issues, path, 'expected object');
    return null;
  }
  const typeRaw = (value as any).type;
  const type = readString(typeRaw, `${path}.type`, issues);
  if (type === null) return null;

  if (type === 'exchange_3') {
    hasOnlyKeys(value, ['type', 'tiles'], path, issues);
    const tilesRaw = readArray((value as any).tiles, `${path}.tiles`, issues);
    if (tilesRaw === null) return null;
    if (tilesRaw.length !== 3) addIssue(issues, `${path}.tiles`, 'expected length=3');
    const tiles: Array<TileCode> = [];
    for (let i = 0; i < tilesRaw.length; i++) {
      const t = readTileCodeStrict(tilesRaw[i], `${path}.tiles[${i}]`, issues);
      if (t !== null) tiles.push(t);
    }
    if (tiles.length !== 3) return null;
    return { type: 'exchange_3', tiles: [tiles[0]!, tiles[1]!, tiles[2]!] };
  }

  if (type === 'choose_missing_suit') {
    hasOnlyKeys(value, ['type', 'suit'], path, issues);
    const suit = readSuit((value as any).suit, `${path}.suit`, issues);
    if (suit === null) return null;
    return { type: 'choose_missing_suit', suit };
  }

  if (type === 'discard' || type === 'an_gang' || type === 'jia_gang' || type === 'ming_gang' || type === 'peng') {
    hasOnlyKeys(value, ['type', 'tile'], path, issues);
    const tile = readTileCodeStrict((value as any).tile, `${path}.tile`, issues);
    if (tile === null) return null;
    if (type === 'discard') return { type: 'discard', tile };
    if (type === 'an_gang') return { type: 'an_gang', tile };
    if (type === 'jia_gang') return { type: 'jia_gang', tile };
    if (type === 'ming_gang') return { type: 'ming_gang', tile };
    return { type: 'peng', tile };
  }

  if (type === 'hu') {
    hasOnlyKeys(value, ['type', 'method', 'tags'], path, issues);
    const method = readHuMethod((value as any).method, `${path}.method`, issues);
    if (method === null) return null;
    const tagsRaw = (value as any).tags;
    if (tagsRaw !== undefined) {
      const arr = readArray(tagsRaw, `${path}.tags`, issues);
      if (arr === null) return null;
      for (let i = 0; i < arr.length; i++) {
        const s = readString(arr[i], `${path}.tags[${i}]`, issues);
        if (s === null) return null;
      }
      return { type: 'hu', method, tags: arr as Array<string> };
    }
    return { type: 'hu', method };
  }

  if (type === 'pass') {
    // Engine contract allows reason, but LLM contract must not include it.
    hasOnlyKeys(value, ['type', 'reason'], path, issues);
    const reasonRaw = (value as any).reason;
    if (reasonRaw !== undefined) {
      const reason = readString(reasonRaw, `${path}.reason`, issues);
      if (reason === null) return null;
      return { type: 'pass', reason };
    }
    return { type: 'pass' };
  }

  addIssue(issues, `${path}.type`, 'unknown action type');
  return null;
}

function readLlmAction(value: unknown, path: string, issues: Array<ValidationIssue>): LlmAction | null {
  const action = readAction(value, path, issues);
  if (action === null) return null;
  if (action.type === 'pass') {
    // LLM input must not contain pass.reason.
    if ('reason' in action) addIssue(issues, path, 'pass.reason must not be sent to LLM');
    return { type: 'pass' };
  }
  return action as LlmAction;
}

function readFactKey(value: string, path: string, issues: Array<ValidationIssue>): FactKey | null {
  if ((FACT_KEYS as ReadonlyArray<string>).includes(value)) return value as FactKey;
  addIssue(issues, path, 'unknown fact_key');
  return null;
}

function validateStateMissingSuitText(text: string): boolean {
  // Fixed template in contract: 定缺：missing_suit=<suit>（<中文>）
  return /^定缺：missing_suit=(m|p|s)（(万|筒|条)）$/.test(text.trim());
}

function readExplainFacts(
  value: unknown,
  path: string,
  candidateId: string,
  issues: Array<ValidationIssue>,
): { factsByKey: Map<FactKey, { id: string; text: string }>; facts: Array<{ id: string; text: string }> } | null {
  if (!isJsonObject(value)) {
    addIssue(issues, path, 'expected object');
    return null;
  }
  hasOnlyKeys(value, ['facts'], path, issues);
  const factsRaw = readArray((value as any).facts, `${path}.facts`, issues);
  if (factsRaw === null) return null;

  const seenIds = new Set<string>();
  const factsByKey = new Map<FactKey, { id: string; text: string }>();
  const facts: Array<{ id: string; text: string }> = [];
  for (let i = 0; i < factsRaw.length; i++) {
    const itemPath = `${path}.facts[${i}]`;
    const item = factsRaw[i];
    if (!isJsonObject(item)) {
      addIssue(issues, itemPath, 'expected object');
      continue;
    }
    hasOnlyKeys(item, ['id', 'text'], itemPath, issues);
    const id = readString((item as any).id, `${itemPath}.id`, issues);
    const text = readString((item as any).text, `${itemPath}.text`, issues);
    if (id === null || text === null) continue;
    if (!text.trim()) addIssue(issues, `${itemPath}.text`, 'expected non-empty text');

    if (seenIds.has(id)) addIssue(issues, `${itemPath}.id`, 'duplicate id');
    seenIds.add(id);

    const m = /^(.+)::(.+)$/.exec(id);
    if (!m) {
      addIssue(issues, `${itemPath}.id`, 'expected "<candidate_id>::<fact_key>"');
      continue;
    }
    if (m[1] !== candidateId) addIssue(issues, `${itemPath}.id`, 'candidate_id mismatch');
    const key = readFactKey(m[2]!, `${itemPath}.id`, issues);
    if (key === null) continue;

    const expectedId = factId(candidateId, key);
    if (id !== expectedId) addIssue(issues, `${itemPath}.id`, 'id must equal "<candidate_id>::<fact_key>"');

    if (key === 'state.missing_suit') {
      if (!validateStateMissingSuitText(text)) addIssue(issues, `${itemPath}.text`, 'invalid state.missing_suit text template');
    }

    if (factsByKey.has(key)) addIssue(issues, `${itemPath}.id`, 'duplicate fact_key within candidate');
    factsByKey.set(key, { id, text });
    facts.push({ id, text });
  }
  return { factsByKey, facts };
}

function requiredFactKeysForCandidate(params: {
  stage: RecoStage;
  blockedByDingque: boolean;
  action: LlmAction;
}): Array<FactKey> {
  const { stage, blockedByDingque, action } = params;
  if (stage === 'exchange_3') return ['swap.send_tile_risk', 'swap.structure_loss'];
  if (stage === 'choose_missing_suit') return ['dingque.clear_count', 'dingque.keep_score'];

  if (stage === 'my_turn') {
    const base: Array<FactKey> = ['state.missing_suit'];
    if (action.type === 'discard') {
      if (blockedByDingque) {
        return [
          ...base,
          'rule.must_clear_missing_suit',
          'metric.public_seen',
          'metric.rem',
          'metric.safe_score',
          'metric.safety_evidence',
        ];
      }
      // Non-clear: require core metrics + safety, and at least one of window_score/est_ron_mid (checked separately).
      return [...base, 'metric.shanten_after', 'metric.ukeire_u', 'metric.ukeire_k', 'metric.safe_score', 'metric.safety_evidence'];
    }
    if (action.type === 'an_gang' || action.type === 'jia_gang') {
      return [...base, 'gang.immediate_gain', 'metric.est_ron_mid'];
    }
    if (action.type === 'hu') {
      return [...base, 'hu.gain'];
    }
    // my_turn should not include other action types.
    return base;
  }

  if (stage === 'react') {
    const base: Array<FactKey> = ['state.missing_suit'];
    if (action.type === 'hu') return [...base, 'hu.gain'];
    if (action.type === 'peng') return [...base, 'metric.shanten_after', 'metric.ukeire_u', 'metric.ukeire_k'];
    if (action.type === 'ming_gang') {
      return [...base, 'gang.immediate_gain', 'metric.shanten_after', 'metric.ukeire_u', 'metric.ukeire_k'];
    }
    if (action.type === 'pass') return [...base, 'metric.shanten_after', 'metric.ukeire_u', 'metric.ukeire_k'];
    return base;
  }

  return [];
}

function validateExplainFactsCoverage(params: {
  stage: RecoStage;
  blockedByDingque: boolean;
  action: LlmAction;
  factsByKey: Map<FactKey, any>;
  issues: Array<ValidationIssue>;
  path: string;
}): void {
  const required = requiredFactKeysForCandidate({
    stage: params.stage,
    blockedByDingque: params.blockedByDingque,
    action: params.action,
  });
  for (const key of required) {
    if (!params.factsByKey.has(key)) addIssue(params.issues, `${params.path}.${key}`, 'missing required fact');
  }

  // Special conditional rule: discard(non-clear) must contain at least one of window_score / est_ron_mid.
  if (params.stage === 'my_turn' && params.action.type === 'discard' && !params.blockedByDingque) {
    const hasWindow = params.factsByKey.has('metric.window_score');
    const hasEst = params.factsByKey.has('metric.est_ron_mid');
    if (!hasWindow && !hasEst) {
      addIssue(params.issues, params.path, 'discard(non-clear) must include metric.window_score or metric.est_ron_mid');
    }
  }
}

export function validateLlmCandidate(raw: unknown, params: { stage: RecoStage; blockedByDingque: boolean }): ValidationResult<LlmCandidate> {
  const issues: Array<ValidationIssue> = [];
  const path = 'candidate';
  if (!isJsonObject(raw)) return err([{ path, message: 'expected object' }]);
  hasOnlyKeys(raw, ['candidate_id', 'action', 'explain_facts'], path, issues);
  const candidateId = readString((raw as any).candidate_id, `${path}.candidate_id`, issues);
  const action = readLlmAction((raw as any).action, `${path}.action`, issues);
  if (candidateId && action) {
    const expected = candidateIdForAction(action as any);
    if (candidateId !== expected) addIssue(issues, `${path}.candidate_id`, `candidate_id must equal ${expected}`);
  }
  const explain = readExplainFacts((raw as any).explain_facts, `${path}.explain_facts`, candidateId ?? '', issues);
  if (candidateId && action && explain) {
    validateExplainFactsCoverage({
      stage: params.stage,
      blockedByDingque: params.blockedByDingque,
      action,
      factsByKey: explain.factsByKey,
      issues,
      path: `${path}.explain_facts.factsByKey`,
    });
  }

  if (issues.length > 0 || !candidateId || !action || !explain) return err(issues);
  return ok({ candidate_id: candidateId, action: action, explain_facts: { facts: explain.facts } });
}

function readStateSummary(value: unknown, path: string, issues: Array<ValidationIssue>): StateSummary | null {
  if (!isJsonObject(value)) {
    addIssue(issues, path, 'expected object');
    return null;
  }
  hasOnlyKeys(
    value,
    ['stage', 'event.type', 'seat_id', 'missing_suit', 'blockedByDingque', 'wall_remaining', 'alive_player_count', 'my_hand_size'],
    path,
    issues,
  );

  const stage = readStage((value as any).stage, `${path}.stage`, issues);
  const eventType = readString((value as any)['event.type'], `${path}.event.type`, issues);
  const seatId = readNonNegInt((value as any).seat_id, `${path}.seat_id`, issues);
  const missingSuitRaw = (value as any).missing_suit;
  const missingSuit =
    missingSuitRaw === null ? null : missingSuitRaw === undefined ? null : readSuit(missingSuitRaw, `${path}.missing_suit`, issues);
  const blocked = readBoolean((value as any).blockedByDingque, `${path}.blockedByDingque`, issues);
  const wallRemaining = readNonNegInt((value as any).wall_remaining, `${path}.wall_remaining`, issues);
  const alive = readNonNegInt((value as any).alive_player_count, `${path}.alive_player_count`, issues);
  const handSize = readNonNegInt((value as any).my_hand_size, `${path}.my_hand_size`, issues);

  if (stage === null || eventType === null || seatId === null || blocked === null || wallRemaining === null || alive === null || handSize === null)
    return null;
  if (seatId < 0 || seatId > 3) addIssue(issues, `${path}.seat_id`, 'seat_id must be 0..3');
  if (alive < 1 || alive > 4) addIssue(issues, `${path}.alive_player_count`, 'alive_player_count must be 1..4');

  return {
    stage,
    'event.type': eventType,
    seat_id: seatId,
    missing_suit: missingSuit,
    blockedByDingque: blocked,
    wall_remaining: wallRemaining,
    alive_player_count: alive,
    my_hand_size: handSize,
  };
}

function readConstraints(value: unknown, path: string, issues: Array<ValidationIssue>): LlmConstraints | null {
  if (!isJsonObject(value)) {
    addIssue(issues, path, 'expected object');
    return null;
  }
  hasOnlyKeys(value, ['must_choose_from_candidates_topk'], path, issues);
  const flag = (value as any).must_choose_from_candidates_topk;
  if (flag !== true) addIssue(issues, `${path}.must_choose_from_candidates_topk`, 'must be true');
  return { must_choose_from_candidates_topk: true };
}

export function validateLlmRecoInput(raw: unknown): ValidationResult<LlmRecoInput> {
  const issues: Array<ValidationIssue> = [];
  const path = 'input';
  if (!isJsonObject(raw)) return err([{ path, message: 'expected object' }]);
  hasOnlyKeys(raw, ['state_summary', 'engine_top1_candidate_id', 'engine_top1_locked', 'constraints', 'style_pref', 'candidates_topk'], path, issues);

  const stateSummary = readStateSummary((raw as any).state_summary, `${path}.state_summary`, issues);
  const engineTop1 = readString((raw as any).engine_top1_candidate_id, `${path}.engine_top1_candidate_id`, issues);
  const locked = readBoolean((raw as any).engine_top1_locked, `${path}.engine_top1_locked`, issues);
  const constraints = readConstraints((raw as any).constraints, `${path}.constraints`, issues);

  const styleRaw = (raw as any).style_pref;
  const stylePref = styleRaw === undefined ? undefined : readStylePref(styleRaw, `${path}.style_pref`, issues) ?? undefined;

  const candidatesRaw = readArray((raw as any).candidates_topk, `${path}.candidates_topk`, issues);
  const candidates: Array<LlmCandidate> = [];
  if (candidatesRaw) {
    if (candidatesRaw.length === 0) addIssue(issues, `${path}.candidates_topk`, 'must be non-empty');
    if (candidatesRaw.length > 20) addIssue(issues, `${path}.candidates_topk`, 'must be <=20');
    for (let i = 0; i < candidatesRaw.length; i++) {
      const c = validateLlmCandidate(candidatesRaw[i], {
        stage: stateSummary?.stage ?? 'my_turn',
        blockedByDingque: stateSummary?.blockedByDingque ?? false,
      });
      if (c.ok) candidates.push(c.value);
      else {
        for (const issue of c.issues) addIssue(issues, `${path}.candidates_topk[${i}].${issue.path}`, issue.message);
      }
    }
  }

  if (engineTop1 && candidates.length > 0) {
    if (candidates[0]!.candidate_id !== engineTop1) {
      addIssue(issues, `${path}.engine_top1_candidate_id`, 'must equal candidates_topk[0].candidate_id');
    }
  }

  // Uniqueness of candidate_id
  const ids = new Set<string>();
  for (let i = 0; i < candidates.length; i++) {
    const id = candidates[i]!.candidate_id;
    if (ids.has(id)) addIssue(issues, `${path}.candidates_topk[${i}].candidate_id`, 'duplicate candidate_id');
    ids.add(id);
  }

  if (issues.length > 0 || !stateSummary || !engineTop1 || locked === null || !constraints) return err(issues);
  return ok({
    state_summary: stateSummary,
    engine_top1_candidate_id: engineTop1,
    engine_top1_locked: locked,
    constraints,
    ...(stylePref ? { style_pref: stylePref } : {}),
    candidates_topk: candidates,
  });
}

const CONF_VALUES: ReadonlyArray<LlmRecoConfidence> = [0.3, 0.55, 0.7, 0.9];

function readConfidence(value: unknown, path: string, issues: Array<ValidationIssue>): LlmRecoConfidence | null {
  const n = readFiniteNumber(value, path, issues);
  if (n === null) return null;
  if ((CONF_VALUES as ReadonlyArray<number>).includes(n)) return n as LlmRecoConfidence;
  addIssue(issues, path, 'invalid confidence_llm (must be 0.3/0.55/0.7/0.9)');
  return null;
}

const FORBIDDEN_EXPLANATION_RE = {
  tileCode: /[1-9][mps]/,
  // Keep this conservative to avoid false positives like "1万分" / "3条证据".
  tileLabel: /[1-9]筒/,
  // Avoid single-character matches ("过/碰/杠/胡") which frequently appear in normal Chinese phrases (e.g. 不过/碰到/杠杆/胡乱).
  actionWords: /(弃牌|打出|自摸|点炮|抢杠|胡牌|碰牌|杠牌|过牌)/,
  // Candidate ids are always token-like; "pass" is a special-case without "_" suffix.
  candidateId: /\b(?:exchange_3|choose_missing_suit|discard|an_gang|jia_gang|ming_gang|peng|hu)_|\bpass\b/,
};

function validateExplanationText(text: string, path: string, issues: Array<ValidationIssue>): void {
  const len = Array.from(text).length;
  if (len > 130) addIssue(issues, path, 'explanation too long (>130 chars)');
  if (FORBIDDEN_EXPLANATION_RE.tileCode.test(text)) addIssue(issues, path, 'explanation must not contain tileCode (e.g. 5p)');
  if (FORBIDDEN_EXPLANATION_RE.tileLabel.test(text)) addIssue(issues, path, 'explanation must not contain Chinese tile labels (e.g. 5筒)');
  if (FORBIDDEN_EXPLANATION_RE.actionWords.test(text)) addIssue(issues, path, 'explanation must not describe concrete actions');
  if (FORBIDDEN_EXPLANATION_RE.candidateId.test(text)) addIssue(issues, path, 'explanation must not contain candidate_id');
}

export function validateLlmRecoOutput(raw: unknown, input: LlmRecoInput): ValidationResult<LlmRecoOutput> {
  const issues: Array<ValidationIssue> = [];
  const path = 'output';
  if (!isJsonObject(raw)) return err([{ path, message: 'expected object' }]);
  hasOnlyKeys(raw, ['chosen_candidate_id', 'confidence_llm', 'cited_fact_ids', 'explanation', 'followups_supported'], path, issues);

  const chosen = readString((raw as any).chosen_candidate_id, `${path}.chosen_candidate_id`, issues);
  const conf = readConfidence((raw as any).confidence_llm, `${path}.confidence_llm`, issues);
  const citedRaw = readArray((raw as any).cited_fact_ids, `${path}.cited_fact_ids`, issues);
  const explanation = readString((raw as any).explanation, `${path}.explanation`, issues);
  if (explanation) validateExplanationText(explanation, `${path}.explanation`, issues);

  const followupsRaw = (raw as any).followups_supported;
  let followups: Array<string> | undefined = undefined;
  if (followupsRaw !== undefined) {
    // Optional field: allow only string[] and ignore other types to avoid invalidating the whole output.
    if (Array.isArray(followupsRaw)) {
      const out: Array<string> = [];
      for (let i = 0; i < followupsRaw.length; i++) {
        const item = followupsRaw[i];
        if (typeof item !== 'string') continue;
        const s = item.trim();
        if (s) out.push(s);
      }
      if (out.length > 0) followups = out;
    }
  }

  if (chosen && input.engine_top1_locked && chosen !== input.engine_top1_candidate_id) {
    addIssue(issues, `${path}.chosen_candidate_id`, 'engine_top1_locked=true requires choosing engine_top1_candidate_id');
  }

  // chosen must be within candidates_topk
  const chosenCand = chosen ? input.candidates_topk.find((c) => c.candidate_id === chosen) ?? null : null;
  if (chosen && !chosenCand) addIssue(issues, `${path}.chosen_candidate_id`, 'must be one of candidates_topk[*].candidate_id');

  const cited: Array<string> = [];
  if (citedRaw) {
    if (citedRaw.length < 1 || citedRaw.length > 4) addIssue(issues, `${path}.cited_fact_ids`, 'length must be 1..4');
    const seen = new Set<string>();
    for (let i = 0; i < citedRaw.length; i++) {
      const s = readString(citedRaw[i], `${path}.cited_fact_ids[${i}]`, issues);
      if (s === null) continue;
      if (seen.has(s)) addIssue(issues, `${path}.cited_fact_ids[${i}]`, 'duplicate cited_fact_id');
      seen.add(s);
      cited.push(s);
    }
  }

  if (chosenCand) {
    const factIds = new Set(chosenCand.explain_facts.facts.map((f) => f.id));
    for (let i = 0; i < cited.length; i++) {
      const id = cited[i]!;
      if (!factIds.has(id)) addIssue(issues, `${path}.cited_fact_ids[${i}]`, 'must be subset of selected_candidate.explain_facts.facts[].id');
    }
  }

  if (chosen && chosen !== input.engine_top1_candidate_id) {
    if (cited.length < 2) addIssue(issues, `${path}.cited_fact_ids`, 'when choosing non-top1, cited_fact_ids.length must be >=2');
    if (conf !== null && conf !== 0.7 && conf !== 0.9) {
      addIssue(issues, `${path}.confidence_llm`, 'when choosing non-top1, confidence_llm must be 0.7 or 0.9');
    }
  }

  if (issues.length > 0 || !chosen || conf === null || !citedRaw || explanation === null) return err(issues);
  const out: LlmRecoOutput = {
    chosen_candidate_id: chosen,
    confidence_llm: conf,
    cited_fact_ids: cited,
    explanation,
    ...(followups ? { followups_supported: followups } : {}),
  };
  return ok(out);
}

function readRiskTags(value: unknown, path: string, issues: Array<ValidationIssue>): Array<RiskTagId> | null {
  const arr = readArray(value, path, issues);
  if (arr === null) return null;
  const out: Array<RiskTagId> = [];
  const seen = new Set<string>();
  for (let i = 0; i < arr.length; i++) {
    const s = readString(arr[i], `${path}[${i}]`, issues);
    if (s === null) continue;
    if (!(RISK_TAG_IDS as ReadonlyArray<string>).includes(s)) {
      addIssue(issues, `${path}[${i}]`, 'unknown risk_tag_id');
      continue;
    }
    if (seen.has(s)) addIssue(issues, `${path}[${i}]`, 'duplicate risk_tag_id');
    seen.add(s);
    out.push(s as RiskTagId);
  }
  return out;
}

function readMetricsCoreExchange3(value: unknown, path: string, issues: Array<ValidationIssue>): Exchange3MetricsCore | null {
  if (!isJsonObject(value)) {
    addIssue(issues, path, 'expected object');
    return null;
  }
  hasOnlyKeys(value, ['structure_loss', 'isolated_count', 'break_meld_count', 'send_tile_risk_score', 'kong_loss', 'pair_loss'], path, issues);
  const structure_loss = readNonNegNumber((value as any).structure_loss, `${path}.structure_loss`, issues);
  const isolated_count = readNonNegInt((value as any).isolated_count, `${path}.isolated_count`, issues);
  const break_meld_count = readNonNegInt((value as any).break_meld_count, `${path}.break_meld_count`, issues);
  const send_tile_risk_score = readNonNegNumber((value as any).send_tile_risk_score, `${path}.send_tile_risk_score`, issues);
  const kong_loss = readNonNegNumber((value as any).kong_loss, `${path}.kong_loss`, issues);
  const pair_loss = readNonNegNumber((value as any).pair_loss, `${path}.pair_loss`, issues);
  if (
    structure_loss === null ||
    isolated_count === null ||
    break_meld_count === null ||
    send_tile_risk_score === null ||
    kong_loss === null ||
    pair_loss === null
  )
    return null;
  return { structure_loss, isolated_count, break_meld_count, send_tile_risk_score, kong_loss, pair_loss };
}

function readMetricsCoreChooseMissingSuit(
  value: unknown,
  path: string,
  issues: Array<ValidationIssue>,
): ChooseMissingSuitMetricsCore | null {
  if (!isJsonObject(value)) {
    addIssue(issues, path, 'expected object');
    return null;
  }
  hasOnlyKeys(value, ['clear_count', 'keep_score', 'shanten_after', 'ukeire_u', 'ukeire_k'], path, issues);
  const clear_count = readNonNegInt((value as any).clear_count, `${path}.clear_count`, issues);
  const keep_score = readNonNegNumber((value as any).keep_score, `${path}.keep_score`, issues);
  const shanten_after = readNonNegInt((value as any).shanten_after, `${path}.shanten_after`, issues);
  const ukeire_u = readNonNegInt((value as any).ukeire_u, `${path}.ukeire_u`, issues);
  const ukeire_k = readNonNegInt((value as any).ukeire_k, `${path}.ukeire_k`, issues);
  if (clear_count === null || keep_score === null || shanten_after === null || ukeire_u === null || ukeire_k === null) return null;
  return { clear_count, keep_score, shanten_after, ukeire_u, ukeire_k };
}

function readMetricsCoreDiscard(value: unknown, path: string, issues: Array<ValidationIssue>, blockedByDingque: boolean): DiscardMetricsCore | null {
  if (!isJsonObject(value)) {
    addIssue(issues, path, 'expected object');
    return null;
  }
  hasOnlyKeys(
    value,
    [
      'shanten_after',
      'ukeire_u',
      'ukeire_k',
      'est_ron_mid',
      'window_score',
      'safe_score',
      'familiar_count',
      'wall_count',
      'suji_count',
      'public_seen',
      'rem',
      'stage_bin_order',
    ],
    path,
    issues,
  );

  const shanten_after = readNonNegInt((value as any).shanten_after, `${path}.shanten_after`, issues);
  const ukeire_u = readNonNegInt((value as any).ukeire_u, `${path}.ukeire_u`, issues);
  const ukeire_k = readNonNegInt((value as any).ukeire_k, `${path}.ukeire_k`, issues);
  const est_ron_mid = readNonNegNumber((value as any).est_ron_mid, `${path}.est_ron_mid`, issues);
  const safe_score = readNonNegNumber((value as any).safe_score, `${path}.safe_score`, issues);
  const familiar_count = readNonNegInt((value as any).familiar_count, `${path}.familiar_count`, issues);
  const wall_count = readNonNegInt((value as any).wall_count, `${path}.wall_count`, issues);
  const suji_count = readNonNegInt((value as any).suji_count, `${path}.suji_count`, issues);

  const windowRaw = (value as any).window_score;
  const window_score = windowRaw === undefined ? undefined : readFiniteNumber(windowRaw, `${path}.window_score`, issues) ?? undefined;

  const public_seen_raw = (value as any).public_seen;
  const rem_raw = (value as any).rem;
  const stage_bin_raw = (value as any).stage_bin_order;
  const public_seen =
    public_seen_raw === undefined ? undefined : readNonNegInt(public_seen_raw, `${path}.public_seen`, issues) ?? undefined;
  const rem = rem_raw === undefined ? undefined : readNonNegInt(rem_raw, `${path}.rem`, issues) ?? undefined;
  const stage_bin_order =
    stage_bin_raw === undefined ? undefined : readNonNegInt(stage_bin_raw, `${path}.stage_bin_order`, issues) ?? undefined;

  if (
    shanten_after === null ||
    ukeire_u === null ||
    ukeire_k === null ||
    est_ron_mid === null ||
    safe_score === null ||
    familiar_count === null ||
    wall_count === null ||
    suji_count === null
  )
    return null;

  if (blockedByDingque) {
    if (public_seen === undefined) addIssue(issues, `${path}.public_seen`, 'required when blockedByDingque=true');
    if (rem === undefined) addIssue(issues, `${path}.rem`, 'required when blockedByDingque=true');
    if (stage_bin_order === undefined) addIssue(issues, `${path}.stage_bin_order`, 'required when blockedByDingque=true');
  }

  return {
    shanten_after,
    ukeire_u,
    ukeire_k,
    est_ron_mid,
    ...(window_score === undefined ? {} : { window_score }),
    safe_score,
    familiar_count,
    wall_count,
    suji_count,
    ...(public_seen === undefined ? {} : { public_seen }),
    ...(rem === undefined ? {} : { rem }),
    ...(stage_bin_order === undefined ? {} : { stage_bin_order }),
  };
}

function readMetricsCoreGang(value: unknown, path: string, issues: Array<ValidationIssue>): GangMetricsCore | null {
  if (!isJsonObject(value)) {
    addIssue(issues, path, 'expected object');
    return null;
  }
  hasOnlyKeys(value, ['gain_range_min', 'gain_range_max'], path, issues);
  const min = readFiniteNumber((value as any).gain_range_min, `${path}.gain_range_min`, issues);
  const max = readFiniteNumber((value as any).gain_range_max, `${path}.gain_range_max`, issues);
  if (min === null || max === null) return null;
  if (max < min) addIssue(issues, `${path}.gain_range_max`, 'must be >= gain_range_min');
  return { gain_range_min: min, gain_range_max: max };
}

function readMetricsCoreReactNonHu(value: unknown, path: string, issues: Array<ValidationIssue>): ReactNonHuMetricsCore | null {
  if (!isJsonObject(value)) {
    addIssue(issues, path, 'expected object');
    return null;
  }
  hasOnlyKeys(value, ['worst_shanten', 'gain_range_min', 'gain_range_max'], path, issues);
  const worst = readNonNegInt((value as any).worst_shanten, `${path}.worst_shanten`, issues);
  const min = readFiniteNumber((value as any).gain_range_min, `${path}.gain_range_min`, issues);
  const max = readFiniteNumber((value as any).gain_range_max, `${path}.gain_range_max`, issues);
  if (worst === null || min === null || max === null) return null;
  if (max < min) addIssue(issues, `${path}.gain_range_max`, 'must be >= gain_range_min');
  return { worst_shanten: worst, gain_range_min: min, gain_range_max: max };
}

function readMetricsCoreEmpty(value: unknown, path: string, issues: Array<ValidationIssue>): Record<string, never> | null {
  if (!isJsonObject(value)) {
    addIssue(issues, path, 'expected object');
    return null;
  }
  hasOnlyKeys(value, [], path, issues);
  return {};
}

export function validateEngineCandidate(params: {
  stage: RecoStage;
  blockedByDingque: boolean;
  value: unknown;
}): ValidationResult<EngineCandidate> {
  const issues: Array<ValidationIssue> = [];
  const path = 'candidate';
  const raw = params.value;
  if (!isJsonObject(raw)) return err([{ path, message: 'expected object' }]);
  hasOnlyKeys(raw, ['candidate_id', 'action', 'legal', 'metrics_core', 'metrics_extra', 'risk_tags', 'explain_facts'], path, issues);

  const candidateId = readString((raw as any).candidate_id, `${path}.candidate_id`, issues);
  const action = readAction((raw as any).action, `${path}.action`, issues);
  const legal = readBoolean((raw as any).legal, `${path}.legal`, issues);
  const riskTags = readRiskTags((raw as any).risk_tags, `${path}.risk_tags`, issues);

  let metricsCore: unknown = null;
  if (action) {
    const mcPath = `${path}.metrics_core`;
    const mc = (raw as any).metrics_core;
    if (params.stage === 'exchange_3') metricsCore = readMetricsCoreExchange3(mc, mcPath, issues);
    else if (params.stage === 'choose_missing_suit') metricsCore = readMetricsCoreChooseMissingSuit(mc, mcPath, issues);
    else if (params.stage === 'my_turn') {
      if (action.type === 'discard') metricsCore = readMetricsCoreDiscard(mc, mcPath, issues, params.blockedByDingque);
      else if (action.type === 'an_gang' || action.type === 'jia_gang') metricsCore = readMetricsCoreGang(mc, mcPath, issues);
      else if (action.type === 'hu') metricsCore = readMetricsCoreEmpty(mc, mcPath, issues);
      else addIssue(issues, `${path}.action.type`, 'invalid action.type for my_turn');
    } else if (params.stage === 'react') {
      if (action.type === 'hu') metricsCore = readMetricsCoreEmpty(mc, mcPath, issues);
      else if (action.type === 'ming_gang' || action.type === 'peng' || action.type === 'pass') metricsCore = readMetricsCoreReactNonHu(mc, mcPath, issues);
      else addIssue(issues, `${path}.action.type`, 'invalid action.type for react');
    } else {
      addIssue(issues, `${path}.stage`, 'unknown stage');
    }
  }

  if (candidateId && action) {
    const expected = candidateIdForAction(action);
    if (candidateId !== expected) addIssue(issues, `${path}.candidate_id`, `candidate_id must equal ${expected}`);
  }

  const explain = readExplainFacts((raw as any).explain_facts, `${path}.explain_facts`, candidateId ?? '', issues);
  if (candidateId && action && explain) {
    validateExplainFactsCoverage({
      stage: params.stage,
      blockedByDingque: params.blockedByDingque,
      action: action as any,
      factsByKey: explain.factsByKey,
      issues,
      path: `${path}.explain_facts.factsByKey`,
    });
  }

  if (issues.length > 0 || !candidateId || !action || legal === null || !riskTags || !explain || metricsCore === null) return err(issues);

  return ok({
    candidate_id: candidateId,
    action,
    legal,
    metrics_core: metricsCore,
    ...(Object.prototype.hasOwnProperty.call(raw, 'metrics_extra') ? { metrics_extra: (raw as any).metrics_extra } : {}),
    risk_tags: riskTags,
    explain_facts: { facts: explain.facts },
  });
}

export type RecoResolutionSource = 'engine' | 'llm' | 'fallback';

export type RecoResolution = {
  chosen_candidate_id: string;
  source: RecoResolutionSource;
  llm_used: boolean;
  confidence_engine: number;
  confidence_llm: LlmRecoConfidence | null;
  confidence_final: number;
  llm_output: LlmRecoOutput | null;
  fallback_reason?: string;
};

export function resolveRecoWithOptionalLlm(params: {
  input: LlmRecoInput;
  confidence_engine: number;
  llm_output_raw: unknown | null;
  low_confidence_threshold?: number;
}): RecoResolution {
  const engineTop1 = params.input.engine_top1_candidate_id;
  const confidenceEngine =
    typeof params.confidence_engine === 'number' && Number.isFinite(params.confidence_engine) ? params.confidence_engine : 0.5;
  const threshold = typeof params.low_confidence_threshold === 'number' ? params.low_confidence_threshold : 0.6;

  if (params.llm_output_raw === null) {
    return {
      chosen_candidate_id: engineTop1,
      source: 'engine',
      llm_used: false,
      confidence_engine: confidenceEngine,
      confidence_llm: null,
      confidence_final: confidenceEngine,
      llm_output: null,
    };
  }

  const v = validateLlmRecoOutput(params.llm_output_raw, params.input);
  if (!v.ok) {
    return {
      chosen_candidate_id: engineTop1,
      source: 'fallback',
      llm_used: true,
      confidence_engine: confidenceEngine,
      confidence_llm: null,
      confidence_final: confidenceEngine,
      llm_output: null,
      fallback_reason: 'llm_output_invalid',
    };
  }

  const chosen = v.value.chosen_candidate_id;
  const confidenceFinal = Math.min(confidenceEngine, v.value.confidence_llm);
  // Low-confidence guardrail:
  // - If LLM wants to deviate from engine Top1, require confidence_final >= threshold.
  // - If LLM agrees with engine Top1, always accept (do not mark as fallback), regardless of confidence.
  if (chosen !== engineTop1 && confidenceFinal < threshold) {
    return {
      chosen_candidate_id: engineTop1,
      source: 'fallback',
      llm_used: true,
      confidence_engine: confidenceEngine,
      confidence_llm: v.value.confidence_llm,
      confidence_final: confidenceFinal,
      llm_output: v.value,
      fallback_reason: 'low_confidence',
    };
  }

  const source: RecoResolutionSource = chosen === engineTop1 ? 'engine' : 'llm';
  return {
    chosen_candidate_id: chosen,
    source,
    llm_used: true,
    confidence_engine: confidenceEngine,
    confidence_llm: v.value.confidence_llm,
    confidence_final: confidenceFinal,
    llm_output: v.value,
  };
}
