import type { BloodSuit } from '../core/blood-types';

export type RecoStage = 'exchange_3' | 'choose_missing_suit' | 'my_turn' | 'react';

// Tile code exposed to LLM/UI. Runtime-validated by regex in contract-validate.
export type TileCode = string;

export type HuMethod = 'zimo' | 'dianpao' | 'qianggang';

export type RecoAction =
  | { type: 'exchange_3'; tiles: [TileCode, TileCode, TileCode] }
  | { type: 'choose_missing_suit'; suit: BloodSuit }
  | { type: 'discard'; tile: TileCode }
  | { type: 'an_gang'; tile: TileCode }
  | { type: 'jia_gang'; tile: TileCode }
  | { type: 'ming_gang'; tile: TileCode }
  | { type: 'peng'; tile: TileCode }
  | { type: 'hu'; method: HuMethod; tags?: Array<string> }
  | { type: 'pass'; reason?: string };

// LLM-facing action excludes fields we explicitly do not send (e.g. pass.reason).
export type LlmAction = Exclude<RecoAction, { type: 'pass' }> | { type: 'pass' };

export const FACT_KEYS = [
  'state.missing_suit',
  'rule.must_clear_missing_suit',
  'metric.shanten_after',
  'metric.ukeire_u',
  'metric.ukeire_k',
  'metric.window_score',
  'metric.est_ron_mid',
  'metric.safe_score',
  'metric.safety_evidence',
  'metric.public_seen',
  'metric.rem',
  'swap.send_tile_risk',
  'swap.structure_loss',
  'dingque.clear_count',
  'dingque.keep_score',
  'hu.gain',
  'gang.immediate_gain',
] as const;
export type FactKey = (typeof FACT_KEYS)[number];

export const RISK_TAG_IDS = [
  'must_clear_missing_suit',
  'breaks_tenpai',
  'high_fangchong_risk',
  'low_safety_evidence',
  'high_send_tile_risk',
  'high_structure_loss',
] as const;
export type RiskTagId = (typeof RISK_TAG_IDS)[number];

export type ExplainFact = { id: string; text: string };
export type ExplainFacts = { facts: Array<ExplainFact> };

export type StylePref = '稳健' | '均衡' | '激进';

export type StateSummary = {
  stage: RecoStage;
  'event.type': string;
  seat_id: number;
  missing_suit: BloodSuit | null;
  blockedByDingque: boolean;
  wall_remaining: number;
  alive_player_count: number;
  my_hand_size: number;
};

export type LlmConstraints = { must_choose_from_candidates_topk: true };

export type LlmCandidate = {
  candidate_id: string;
  action: LlmAction;
  explain_facts: ExplainFacts;
};

export type LlmRecoInput = {
  state_summary: StateSummary;
  engine_top1_candidate_id: string;
  engine_top1_locked: boolean;
  constraints: LlmConstraints;
  style_pref?: StylePref;
  candidates_topk: Array<LlmCandidate>;
};

export type LlmRecoConfidence = 0.3 | 0.55 | 0.7 | 0.9;

export type LlmRecoOutput = {
  chosen_candidate_id: string;
  confidence_llm: LlmRecoConfidence;
  cited_fact_ids: Array<string>;
  explanation: string;
  followups_supported?: Array<string>;
};

export type Exchange3MetricsCore = {
  structure_loss: number;
  isolated_count: number;
  break_meld_count: number;
  send_tile_risk_score: number;
  kong_loss: number;
  pair_loss: number;
};

export type ChooseMissingSuitMetricsCore = {
  clear_count: number;
  keep_score: number;
  shanten_after: number;
  ukeire_u: number;
  ukeire_k: number;
};

export type DiscardMetricsCore = {
  shanten_after: number;
  ukeire_u: number;
  ukeire_k: number;
  est_ron_mid: number;
  window_score?: number;
  safe_score: number;
  familiar_count: number;
  wall_count: number;
  suji_count: number;
  public_seen?: number;
  rem?: number;
  stage_bin_order?: number;
};

export type GangMetricsCore = { gain_range_min: number; gain_range_max: number };

export type ReactNonHuMetricsCore = { worst_shanten: number; gain_range_min: number; gain_range_max: number };

export type EngineCandidate = {
  candidate_id: string;
  action: RecoAction;
  legal: boolean;
  metrics_core: unknown;
  metrics_extra?: unknown;
  risk_tags: Array<RiskTagId>;
  explain_facts: ExplainFacts;
};

export function sortTileCodes3(tiles: [TileCode, TileCode, TileCode]): [TileCode, TileCode, TileCode] {
  const sorted = tiles.slice().sort() as Array<TileCode>;
  return [sorted[0]!, sorted[1]!, sorted[2]!];
}

export function candidateIdForAction(action: RecoAction): string {
  switch (action.type) {
    case 'exchange_3': {
      const [a, b, c] = sortTileCodes3(action.tiles);
      return `exchange_3_${a}-${b}-${c}`;
    }
    case 'choose_missing_suit':
      return `choose_missing_suit_${action.suit}`;
    case 'discard':
      return `discard_${action.tile}`;
    case 'an_gang':
      return `an_gang_${action.tile}`;
    case 'jia_gang':
      return `jia_gang_${action.tile}`;
    case 'ming_gang':
      return `ming_gang_${action.tile}`;
    case 'peng':
      return `peng_${action.tile}`;
    case 'hu':
      return `hu_${action.method}`;
    case 'pass':
      return 'pass';
    default: {
      const _exhaustive: never = action;
      return String(_exhaustive);
    }
  }
}

export function factId(candidateId: string, factKey: FactKey): string {
  return `${candidateId}::${factKey}`;
}
