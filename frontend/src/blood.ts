export type BloodSuit = 'm' | 'p' | 's';

export const BLOOD_SUITS: ReadonlyArray<BloodSuit> = ['m', 'p', 's'];

export type BloodPhase = 'lobby' | 'dealing' | 'swap3' | 'dingque' | 'playing' | 'settling' | 'done';

export type BloodSwap3Direction = 'cw' | 'ccw' | 'across';

export interface BloodSwap3State {
  dir: BloodSwap3Direction;
  // 用于“超时自动选牌”（以 seat0 的本地时间写入，单位 ms）
  since: number;
  // 开始换牌动画的时间戳（ms）；为 null 表示仍在选牌阶段
  animatingSince: number | null;
  // 各家已确认的 3 张（tileId）；null 表示未确认/未提交
  selections: Record<number, Array<number> | null>;
}

export interface BloodLedgerTransfer {
  fromSeat: number;
  toSeat: number;
  beans: number;
}

export interface BloodFanApplied {
  id: string;
  name: string;
  multiplier: number;
}

export interface BloodLedgerEntry {
  kind: 'kong' | 'hu' | 'penalty';
  label: string;
  // 主要关联座位（用于展示/回放）；例如：胡牌者/杠牌者
  seat?: number;
  // 点炮来源座位（用于展示/回放）；例如：点炮/抢杠胡/杠上炮的出牌者
  fromSeat?: number;
  multiplier: number;
  transfers: Array<BloodLedgerTransfer>;
  at: number;
  // 仅用于展示/回放：胡牌番型与倍数原值（兼容旧局封顶字段）
  fans?: Array<BloodFanApplied>;
  multiplierRaw?: number;
  cap?: number;
  note?: string;
}

export interface BloodSeatEndSummary {
  isActive: boolean;
  hu: boolean;
  isPig: boolean;
  ting: boolean;
  waits: Array<number>;
  maxWaits: Array<number>;
  maxMultiplier: number;
  maxMultiplierRaw: number;
  maxFans: Array<BloodFanApplied>;
}

export interface BloodEndSummary {
  initialBeans: number;
  initialBeansBySeat?: Record<number, number>;
  base: number;
  cap: number;
  seats: Record<number, BloodSeatEndSummary>;
}

export type BloodClaimAction = 'hu' | 'peng' | 'gang' | 'pass';

export interface BloodPendingClaim {
  kind: 'claim';
  id: number;
  // 用于“超时自动过”（以 seat0 的本地时间写入，单位 ms）
  since: number;
  // 触发来源：弃牌 / 加杠（可被抢杠胡）
  trigger?: 'discard' | 'addKong';
  // 是否为“杠后第一张弃牌”（用于杠上炮判定）
  afterGang?: boolean;
  fromSeat: number;
  tileId: number;
  tileKey: number;
  // 各家可选项（seat -> 可选）
  options: Record<number, { hu: boolean; peng: boolean; gang: boolean }>;
  // 各家应答（seat -> 选择）
  responses: Record<number, BloodClaimAction | null>;
}

export type BloodGangType = 'an' | 'ming' | 'add';

export interface BloodMeld {
  kind: 'peng' | 'gang';
  tileKey: number;
  // 明碰/明杠来自哪家；暗杠为 null
  fromSeat: number | null;
  gangType?: BloodGangType;
  // 使用 meld.<row>.* 这一行
  row: number;
}

export interface BloodPlayerState {
  seat: number;
  playerId: string | null;
  dingque: BloodSuit | null;
  // 已提交定缺（定缺阶段只公开该标记，不公开花色）
  dingqueReady?: boolean;
  hu: boolean;
  // 胡牌展示（移动端）：公开信息，所有人都能看到
  huTileKey: number | null;
  huSource: 'self' | 'discard' | null;
  beans: number;
  kongGain: number;
  melds: Array<BloodMeld>;
}

export interface BloodState {
  version: 1;
  base: number;
  // 本局开局豆（用于结算展示净输赢）；可选字段：兼容旧状态/回放
  initialBeans?: number;
  // 各座位本局开局豆（用于按人头展示/结算）；可选字段：兼容旧状态/回放
  initialBeansBySeat?: Record<number, number>;
  phase: BloodPhase;
  dealer: number;

  // 当前行动玩家（始终跳过已胡玩家）
  turnSeat: number;
  // 当前回合步骤：庄家起手直接弃牌；其余为摸牌/杠/胡后弃牌
  turnStep: 'discard' | 'drawOrKong';

  // 牌墙抽牌顺序：存 tileId，seat0 作为裁判推进 wallIndex
  wallOrder: Array<number>;
  wallIndex: number;

  // 用于生成 pending.id 等
  nextId: number;

  pending: BloodPendingClaim | null;

  // 最近一次杠牌的座位：用于自动识别“杠上开花/杠上炮”
  afterGangSeat?: number | null;

  // 血战：换三张（发牌后、定缺前）。仅在 phase='swap3' 时生效；结束后可置为 null。
  swap3?: BloodSwap3State | null;

  // 血战：本局流水（记分明细）。可选字段：兼容旧状态/回放。
  ledger?: Array<BloodLedgerEntry>;

  // 0..3
  players: Record<number, BloodPlayerState>;

  // 结算时亮全手牌
  revealAllHands: boolean;

  // 结算明细（听牌/最大番/等），仅在 phase='settling' 后写入；可选字段：兼容旧状态/回放
  endSummary?: BloodEndSummary;

  /**
   * 进入 settling 的时间戳（ms）。
   * - 用于 seat0 在固定延迟后自动把 phase 推进到 done
   * - 可选字段：兼容旧状态/回放
   */
  settlingSince?: number | null;
}

export type BloodAction =
  | { kind: 'dingque'; suit: BloodSuit }
  | { kind: 'swap3'; tileIds: Array<number> }
  | { kind: 'discard'; tileId: number }
  | { kind: 'claim'; pendingId: number; action: BloodClaimAction }
  | { kind: 'kong'; gangType: BloodGangType; tileKey: number }
  | { kind: 'hu'; source: 'self' };
