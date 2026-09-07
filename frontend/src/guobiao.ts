import type { GuobiaoFanApplied } from '../server/core/guobiao-fan';

export type GuobiaoPhase = 'playing' | 'settling' | 'done';
export type GuobiaoTurnStep = 'discard' | 'draw';
export type GuobiaoClaimAction = 'hu' | 'chi' | 'peng' | 'mingGang' | 'pass';

export interface GuobiaoLedgerTransfer {
  fromSeat: number;
  toSeat: number;
  ruleScore: number;
  points: number;
}

export interface GuobiaoLedgerEntry {
  kind: 'hu' | 'wrongHu' | 'draw';
  label: string;
  seat?: number;
  fromSeat?: number | null;
  fanTotal?: number;
  fans?: Array<GuobiaoFanApplied>;
  transfers: Array<GuobiaoLedgerTransfer>;
  at: number;
  note?: string;
}

export interface GuobiaoFlowerMeld {
  kind: 'flower';
  tileKey: number;
  tileId: number;
  row: number;
  col: number;
}

export interface GuobiaoTileMeld {
  kind: 'chi' | 'peng' | 'mingGang' | 'anGang' | 'addGang';
  id: number;
  tileKeys: Array<number>;
  tileIds: Array<number>;
  fromSeat: number | null;
  claimedTileId: number | null;
  claimedTileKey: number | null;
  row: number;
  concealed?: boolean;
}

export type GuobiaoMeld = GuobiaoFlowerMeld | GuobiaoTileMeld;

export interface GuobiaoPlayerState {
  seat: number;
  playerId: string | null;
  points: number;
  ruleScore: number;
  flowers: Array<number>;
  melds: Array<GuobiaoMeld>;
  hu: boolean;
  huTileKey: number | null;
  wrongHu: boolean;
}

export type GuobiaoHuKind = 'legal' | 'wrongHuRisk' | 'none';

export interface GuobiaoChiOption {
  optionId: string;
  tileIds: Array<number>;
  tileKeys: Array<number>;
  sequence: Array<number>;
}

export interface GuobiaoClaimOptions {
  hu: boolean;
  huKind: GuobiaoHuKind;
  chi: Array<GuobiaoChiOption>;
  peng: boolean;
  mingGang: boolean;
  pass: boolean;
}

export interface GuobiaoPendingResponse {
  action: GuobiaoClaimAction;
  optionId?: string;
}

export interface GuobiaoPendingClaim {
  kind: 'discardClaim' | 'robGangHu';
  id: number;
  since: number;
  deadline: number | null;
  fromSeat: number;
  tileId: number;
  tileKey: number;
  options: Record<number, GuobiaoClaimOptions>;
  responses: Record<number, GuobiaoPendingResponse | null>;
}

export interface GuobiaoEndSummary {
  kind: 'hu' | 'draw';
  ruleVersion: string;
  baseRuleScore: number;
  pointsScale: number;
  winners: Array<number>;
  fromSeat: number | null;
  fanTotal: number;
  fans: Array<GuobiaoFanApplied>;
  pointsBySeat: Record<number, number>;
  ruleScoreBySeat: Record<number, number>;
  pointsDeltaBySeat: Record<number, number>;
  ruleScoreDeltaBySeat: Record<number, number>;
}

export interface GuobiaoState {
  version: 1;
  ruleVersion: string;
  baseRuleScore: number;
  pointsScale: number;
  initialPointsBySeat: Record<number, number>;
  phase: GuobiaoPhase;
  dealer: number;
  roundWind: number;
  turnSeat: number;
  turnStep: GuobiaoTurnStep;
  turnSince: number;
  turnDeadline: number | null;
  wallOrder: Array<number>;
  wallHeadIndex: number;
  wallTailIndex: number;
  nextId: number;
  pending: GuobiaoPendingClaim | null;
  ledger: Array<GuobiaoLedgerEntry>;
  players: Record<number, GuobiaoPlayerState>;
  revealAllHands: boolean;
  initialEventInterrupted?: boolean;
  drawCountBySeat?: Record<number, number>;
  discardCountBySeat?: Record<number, number>;
  lastDraw?: { seat: number; tileId: number; tileKey?: number; source: 'wall' | 'flowerSupplement' | 'kongSupplement' } | null;
  autoBuhuaBySeat?: Record<number, boolean>;
  openingBuhuaSkippedBySeat?: Record<number, boolean>;
  settlingSince?: number | null;
  endSummary?: GuobiaoEndSummary | null;
}

export type GuobiaoAction =
  | { kind: 'discard'; tileId: number }
  | { kind: 'claim'; pendingId: number; action: GuobiaoClaimAction; optionId?: string }
  | { kind: 'hu'; source: 'self' }
  | { kind: 'buhua'; tileId: number }
  | { kind: 'setAutoBuhua'; enabled: boolean }
  | { kind: 'anGang'; tileKey?: number; tileIds?: Array<number> }
  | { kind: 'addGang'; tileId?: number; meldId?: number };
