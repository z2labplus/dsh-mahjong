import { Vector3 } from 'three';

import type { Client } from './client';
import type { BloodLedgerEntry, BloodPhase, BloodState, BloodSuit } from './blood';
import type { GuobiaoLedgerEntry, GuobiaoState } from './guobiao';
import type { AiScene } from '../server/protocol';
import type { ObjectView } from './object-view';
import type { MainView } from './main-view';
import type { World } from './world';
import { GameType, ThingType } from './types';
import { createPaipuShare } from './paipu-api';
import { createPracticeBranch, enterPracticeBranch, listPracticeBranches } from './practice-branch-api';
import { getBasePath } from './ws-url';
import { guobiaoNewbieNew, newbieNew } from './user';
import { readGuobiaoAutoBuhuaPreference, writeGuobiaoAutoBuhuaPreference } from './guobiao-preferences';
import { suitOf, tileKeyFromTypeIndex, tileLabel } from './blood-tiles';
import { parseMeldsText, parseTilesNotation } from './blood-calc-notation';
import { BLOOD_FAN_EXAMPLE_GROUPS, type BloodFanExampleDef } from './blood-fan-examples';
import { BloodAiOverlay } from './blood-ai-overlay';
import { BloodSplitOverlay } from './blood-split-overlay';
import { initHudActionButton } from './hud-action-button';
import { MAHJONG_TILE_URLS, type MahjongTileCode } from './mahjong-tile-urls';

// @ts-ignore
import avatar0 from 'url:../img/avatar0.jpg';
// @ts-ignore
import avatar1 from 'url:../img/avatar1.jpg';
// @ts-ignore
import avatar2 from 'url:../img/avatar2.jpg';
// @ts-ignore
import avatar3 from 'url:../img/avatar3.jpg';

type RectPx = { left: number; top: number; right: number; bottom: number };

type HudBoxNorm = { x: number; y: number; w: number; h: number };

// HUD 与左右玩家麻将牌之间的水平间隙（CSS px）。
const HUD_RAIL_GAP_PX = 3;
// 当 HUD 超出 tableViewport 左/右边界时，沿对应侧“向上”移动的步长（CSS px）。
const HUD_UPWARD_STEP_PX = 1;
// 固定布局时：HUD 与牌面重叠的最小间隙（CSS px）。
const HUD_OVERLAP_GAP_PX = 2;
// 固定布局时：HUD 允许的最大水平避让（CSS px）。
const HUD_OVERLAP_SHIFT_MAX_PX = 12;

// /hand/ 固定画布（1280×720）HUD 位置：来源 tmp/1280-720.png。
const HUD_BOX_BY_REL_SEAT_FIXED: Record<number, HudBoxNorm> = {
  // rel=3（左家） -> 左上
  3: { x: 0.106721, y: 0.222862, w: 0.054688, h: 0.138889 },
  // rel=0（本家/下家） -> 左下
  0: { x: 0.029409, y: 0.667222, w: 0.054688, h: 0.138889 },
  // rel=2（上家） -> 右上
  2: { x: 0.797057, y: 0.024306, w: 0.054688, h: 0.138889 },
  // rel=1（右家） -> 右下
  1: { x: 0.876312, y: 0.440278, w: 0.054688, h: 0.138889 },
};

// 轨道布局（tableViewport 归一化）：来源旧采样图 1703×752。
const HUD_BOX_BY_REL_SEAT_RAIL: Record<number, HudBoxNorm> = {
  3: { x: 268 / 1703, y: 77 / 752, w: 88 / 1703, h: 121 / 752 },
  0: { x: 149 / 1703, y: 622 / 752, w: 87 / 1703, h: 119 / 752 },
  2: { x: 1304 / 1703, y: 20 / 752, w: 84 / 1703, h: 124 / 752 },
  1: { x: 1427 / 1703, y: 398 / 752, w: 85 / 1703, h: 124 / 752 },
};

const HUD_AVATARS = [avatar0, avatar1, avatar2, avatar3];

function relSeat(viewerSeat: number | null, seat: number): number {
  if (viewerSeat === null) {
    return seat;
  }
  return (seat - viewerSeat + 4) % 4;
}

function suitToLabel(suit: BloodSuit | null): string | null {
  if (!suit) return null;
  if (suit === 'm') return '万';
  if (suit === 'p') return '筒';
  return '条';
}

function isDingqueCommitted(player: { dingque: BloodSuit | null; dingqueReady?: boolean } | null | undefined): boolean {
  if (!player) return false;
  return player.dingqueReady === true || player.dingque !== null;
}

function suitToDingqueBadgeBg(suit: BloodSuit | null): string | null {
  if (!suit) return null;
  // 需求：只改“定缺角标”的圆形背景色（文本/描边/高光/阴影保持现状）
  // 条/万/筒
  if (suit === 's') return '#316C4C';
  if (suit === 'm') return '#92302F';
  return '#A35E2D';
}

function formatScore(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) {
    return '--';
  }
  return String(Math.trunc(value as number));
}

function relativeOpponentLabel(viewerSeat: number, otherSeat: number): string {
  const rel = (otherSeat - viewerSeat + 4) % 4;
  if (rel === 1) return '下家';
  if (rel === 2) return '对家';
  if (rel === 3) return '上家';
  return '自己';
}

function formatSigned(n: number): string {
  const v = Math.trunc(n);
  if (v > 0) return `+${v}`;
  if (v < 0) return String(v);
  return '0';
}

function fitHudScoreText(el: HTMLDivElement, inner: HTMLSpanElement, cardHeight: number): void {
  const base = Math.max(10, Math.round(cardHeight * 0.22));
  const min = 8;
  inner.style.fontSize = `${base}px`;
  inner.style.transform = 'scaleX(1)';
  inner.style.transformOrigin = 'center';

  const available = Math.max(0, el.clientWidth - 12);
  if (available <= 0) {
    return;
  }

  const w0 = inner.scrollWidth;
  if (!Number.isFinite(w0) || w0 <= available) {
    return;
  }

  const target = Math.max(min, Math.floor((base * available) / w0));
  inner.style.fontSize = `${target}px`;

  const w1 = inner.scrollWidth;
  if (!Number.isFinite(w1) || w1 <= available) {
    return;
  }
  // 最小字号仍放不下：保持字号不变，通过水平压缩保证完整可见。
  if (target <= min && w1 > 0) {
    const sx = Math.max(0.1, Math.min(1, available / w1));
    inner.style.transform = `scaleX(${sx})`;
  }
}

function formatTileKeys(tileKeys: Array<number>): string {
  const list = tileKeys
    .filter((k) => Number.isFinite(k))
    .map((k) => tileLabel(Math.trunc(k)))
    .join(' ');
  return list || '--';
}

function formatFansBreakdown(entry: BloodLedgerEntry): string {
  const fans = Array.isArray(entry.fans) ? entry.fans : [];
  const parts = fans
    .filter((f) => f && Number.isFinite((f as any).multiplier ?? NaN))
    .map((f) => ({ name: String(f.name ?? '').trim(), mult: Math.trunc(f.multiplier as number) }))
    .filter((f) => f.name && f.mult !== 1);
  if (parts.length === 0) return '';

  const raw = Number.isFinite(entry.multiplierRaw ?? NaN) ? Math.trunc(entry.multiplierRaw as number) : null;
  const capped = Number.isFinite(entry.multiplier ?? NaN) ? Math.trunc(entry.multiplier as number) : null;
  const cap = Number.isFinite(entry.cap ?? NaN) ? Math.trunc(entry.cap as number) : null;
  const cappedSuffix = raw !== null && capped !== null && cap !== null && raw > capped ? ` 封顶${cap}` : '';

  const body = parts.map((p) => `${p.name}×${p.mult}`).join(' ');
  return `（${body}${cappedSuffix}）`;
}

function formatGuobiaoFansBreakdown(entry: GuobiaoLedgerEntry): string {
  const fans = Array.isArray(entry.fans) ? entry.fans : [];
  const parts = fans
    .map((f) => ({ name: String(f.name ?? '').trim(), points: Math.trunc(Number(f.points ?? 0)) }))
    .filter((f) => f.name && Number.isFinite(f.points) && f.points > 0);
  const total = Number.isFinite(entry.fanTotal ?? NaN) ? Math.trunc(entry.fanTotal as number) : null;
  const body = parts.length > 0 ? parts.map((p) => `${p.name}${p.points}番`).join(' / ') : '';
  if (total !== null && body) return `（${total}番：${body}）`;
  if (total !== null) return `（${total}番）`;
  return body ? `（${body}）` : '';
}

type BloodRuleBasicSection = { title: string; lines: Array<string> };
type BloodRuleDisplayTile = { tile: MahjongTileCode; sideways?: boolean };
type BloodRuleDisplayExample = { label: string; tiles: Array<BloodRuleDisplayTile> };
type BloodRuleDisplaySection = { title: string; lines: Array<string>; examples: Array<BloodRuleDisplayExample> };
type BloodRuleFanGuideBase = {
  name: string;
  multiplier: string;
  desc: string;
  tiles: Array<MahjongTileCode>;
  kindLabel?: string;
};
type BloodRuleFanGuide =
  | (BloodRuleFanGuideBase & { kind: 'event'; code: string })
  | (BloodRuleFanGuideBase & { kind: 'pattern'; code: string })
  | (BloodRuleFanGuideBase & { kind: 'root' });

function repeatTile(tile: MahjongTileCode, count: number): Array<MahjongTileCode> {
  const out: Array<MahjongTileCode> = [];
  for (let i = 0; i < count; i += 1) {
    out.push(tile);
  }
  return out;
}

const BLOOD_RULE_BASIC_SECTIONS: Array<BloodRuleBasicSection> = [
  {
    title: '牌组与底分',
    lines: [
      '4 人对局，牌组为万/筒/条 1-9，共 108 张。',
      '底分 400，倍数不封顶。',
      '庄家固定 seat0。',
    ],
  },
  {
    title: '开局流程',
    lines: [
      '每家 13 张，庄家 14 张先手。',
      '换三张：每人选择 3 张同花色手牌，随机方向交换。',
      '定缺：每人选择万/筒/条一门，锁定后不可更改。',
    ],
  },
  {
    title: '对局规则',
    lines: [
      '只能碰/杠/胡，不能吃。',
      '支持一炮多响，胡牌玩家退出后续行动，牌局继续。',
      '定缺限制：缺门牌不能碰/杠/胡，胡牌时手牌不得含缺门。',
    ],
  },
  {
    title: '计分口径',
    lines: [
      '明杠：点杠者支付 底分×2；暗杠：其余未胡玩家各支付 底分×2；加杠：其余未胡玩家各支付 底分×1。',
      '胡牌结算：单家应付 = 底分×倍数，自摸由所有未胡对手分别支付。',
      '每 1 根额外 ×2；根与杠豆互不影响。',
    ],
  },
  {
    title: '过程番（事件番）',
    lines: [
      '自摸×2、杠上开花×2、海底捞月×2。',
      '杠上炮×2、抢杠胡×2。',
      '过程番与牌型番、根相乘（倍数不封顶）。',
    ],
  },
  {
    title: '终局与惩罚',
    lines: [
      '三家胡牌或牌墙摸空即终局。',
      '退税：未听牌玩家退回本局收取的杠豆。',
      '查大叫：未听牌玩家赔付听牌未胡玩家“最大可能倍数”。',
      '查花猪：仍持缺门牌者向每位非花猪玩家各赔 16×底分。',
    ],
  },
];

const BLOOD_RULE_DISPLAY_SAMPLE_TILE: MahjongTileCode = '5m';

const BLOOD_RULE_DISPLAY_PENG_EXAMPLES: Array<BloodRuleDisplayExample> = [
  {
    label: '左家',
    tiles: [
      { tile: BLOOD_RULE_DISPLAY_SAMPLE_TILE, sideways: true },
      { tile: BLOOD_RULE_DISPLAY_SAMPLE_TILE },
      { tile: BLOOD_RULE_DISPLAY_SAMPLE_TILE },
    ],
  },
  {
    label: '对家',
    tiles: [
      { tile: BLOOD_RULE_DISPLAY_SAMPLE_TILE },
      { tile: BLOOD_RULE_DISPLAY_SAMPLE_TILE, sideways: true },
      { tile: BLOOD_RULE_DISPLAY_SAMPLE_TILE },
    ],
  },
  {
    label: '右家',
    tiles: [
      { tile: BLOOD_RULE_DISPLAY_SAMPLE_TILE },
      { tile: BLOOD_RULE_DISPLAY_SAMPLE_TILE },
      { tile: BLOOD_RULE_DISPLAY_SAMPLE_TILE, sideways: true },
    ],
  },
];

const BLOOD_RULE_DISPLAY_MING_GANG_EXAMPLES: Array<BloodRuleDisplayExample> = BLOOD_RULE_DISPLAY_PENG_EXAMPLES.map((ex) => ({
  label: ex.label,
  tiles: [{ tile: BLOOD_RULE_DISPLAY_SAMPLE_TILE }, ...ex.tiles.map((t) => ({ ...t }))],
}));

const BLOOD_RULE_DISPLAY_ADD_GANG_EXAMPLES: Array<BloodRuleDisplayExample> = BLOOD_RULE_DISPLAY_PENG_EXAMPLES.map((ex) => ({
  label: ex.label,
  tiles: [{ tile: 'back' }, ...ex.tiles.map((t) => ({ ...t }))],
}));

const BLOOD_RULE_DISPLAY_SECTIONS: Array<BloodRuleDisplaySection> = [
  {
    title: '碰牌（来源方向）',
    lines: [
      '副露里横放的那张牌，表示“从别人弃牌拿来的那张”。',
      '下面示例以 5万 为例（以碰牌者视角）：左家=「横 竖 竖」、对家=「竖 横 竖」、右家=「竖 竖 横」。',
    ],
    examples: BLOOD_RULE_DISPLAY_PENG_EXAMPLES,
  },
  {
    title: '明杠（来源方向）',
    lines: [
      '四张都亮面，其中横放的那张牌表示“从别人弃牌拿来的那张”。',
      '可以理解为：在碰牌的 3 张最左侧再加 1 张竖牌（新增那张永远在最左）。',
      '下面示例以 5万 为例（以杠牌者视角）：左家=「竖 横 竖 竖」、对家=「竖 竖 横 竖」、右家=「竖 竖 竖 横」。',
    ],
    examples: BLOOD_RULE_DISPLAY_MING_GANG_EXAMPLES,
  },
  {
    title: '暗杠',
    lines: [
      '暗杠用“背-面-面-背”显示（两头盖住）。',
    ],
    examples: [{ label: '示例', tiles: [{ tile: 'back' }, { tile: '5m' }, { tile: '5m' }, { tile: 'back' }] }],
  },
  {
    title: '加杠（补杠）',
    lines: [
      '加杠是在原来的碰上补第 4 张。',
      '第 4 张用背面显示，用来与明杠区分；原碰里横放那张仍表示来源方向。',
    ],
    examples: BLOOD_RULE_DISPLAY_ADD_GANG_EXAMPLES.map((ex) => ({ label: ex.label, tiles: [...ex.tiles] })),
  },
];

const BLOOD_RULE_FAN_GUIDES: Array<BloodRuleFanGuide> = [
  {
    kind: 'pattern',
    code: '8-1',
    name: '七对',
    multiplier: '×4',
    desc: '门清，14 张牌组成 7 个对子；四张同牌视为“两对 + 1根”。',
    tiles: ['1m', '1m', '2m', '2m', '3p', '3p', '4p', '4p', '5s', '5s', '6s', '6s', '7m', '7m'],
  },
  {
    kind: 'pattern',
    code: '8-2',
    name: '金钩钓',
    multiplier: '×4',
    desc: '副露 4 组，暗手仅剩 1 张单钓胡牌；不再另计碰碰胡。',
    tiles: [...repeatTile('1m', 3), ...repeatTile('2p', 3), ...repeatTile('3s', 3), ...repeatTile('4m', 3), '5p', '5p'],
  },
  {
    kind: 'pattern',
    code: '8-3',
    name: '碰碰胡',
    multiplier: '×2',
    desc: '由 4 个刻子/杠 + 1 对将组成。',
    tiles: [...repeatTile('1m', 3), ...repeatTile('2m', 3), ...repeatTile('3p', 3), ...repeatTile('4p', 3), '5m', '5m'],
  },
  {
    kind: 'pattern',
    code: '8-4',
    name: '平胡',
    multiplier: '×1',
    desc: '标准胡牌结构：4 组面子（刻子或顺子）+ 1 对将。',
    tiles: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '1p', '1p'],
  },
  {
    kind: 'pattern',
    code: '8-5',
    name: '清一色',
    multiplier: '×4',
    desc: '全手牌（含副露）只使用万/筒/条之一。',
    tiles: ['1m', '1m', '2m', '2m', '3m', '3m', '4m', '4m', '4m', '5m', '6m', '7m', '8m', '9m'],
  },
  {
    kind: 'pattern',
    code: '8-6',
    name: '将',
    multiplier: '×4',
    desc: '全手牌（含副露）只由 2/5/8 组成；成立将不再另计断幺九。',
    tiles: [...repeatTile('2m', 3), ...repeatTile('5m', 3), ...repeatTile('8m', 3), ...repeatTile('2p', 3), '5p', '5p'],
  },
  {
    kind: 'pattern',
    code: '8-7',
    name: '幺九',
    multiplier: '×4',
    desc: '仅适用于平胡/碰碰胡/金钩钓：刻子/杠=111/999，顺子=123/789，将=11/99；与断幺九互斥。',
    tiles: ['1m', '2m', '3m', '7m', '8m', '9m', ...repeatTile('1p', 3), ...repeatTile('9p', 3), '1m', '1m'],
  },
  {
    kind: 'pattern',
    code: '8-8',
    name: '断幺九',
    multiplier: '×2',
    desc: '胡牌时手牌（含副露）不包含 1、9 序数牌；若同时成立将，则只计将不再另计断幺九。',
    tiles: ['2m', '2m', '3m', '3m', '3m', '4m', '4m', '4m', '5m', '5p', '5p', '6p', '7p', '8p'],
  },
  {
    kind: 'root',
    name: '根',
    multiplier: '每根×2',
    desc: '同一种牌累计出现 4 张记 1 根；多根按 2^根数 叠乘（根与杠豆互不影响）。',
    tiles: ['1m', '1m', '1m', '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '1p'],
  },
  {
    kind: 'event',
    code: '5-1',
    name: '自摸',
    multiplier: '×2',
    desc: '自摸胡牌（仅自摸）。',
    tiles: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '1p', '1p'],
  },
  {
    kind: 'event',
    code: '5-2',
    name: '杠上开花',
    multiplier: '×2',
    desc: '杠牌后补张自摸胡牌（仅自摸）。',
    tiles: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '1p', '1p'],
  },
  {
    kind: 'event',
    code: '5-3',
    name: '海底捞月',
    multiplier: '×2',
    desc: '正常摸牌摸到牌墙最后 1 张后自摸胡牌（不含杠后补张）；与杠上开花互斥。',
    tiles: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '1p', '1p'],
  },
  {
    kind: 'event',
    code: '5-4',
    name: '杠上炮',
    multiplier: '×2',
    desc: '杠家补张后打出的第一张弃牌被点炮胡牌（按点炮口径）。',
    tiles: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '1p', '1p'],
  },
  {
    kind: 'event',
    code: '5-5',
    name: '抢杠胡',
    multiplier: '×2',
    desc: '胡别人加杠/补杠所用的那张牌（按点炮口径，被抢则不产生杠豆）。',
    tiles: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '1p', '1p'],
  },
];

const GUOBIAO_RULE_BASIC_SECTIONS: Array<BloodRuleBasicSection> = [
  {
    title: '主规则口径',
    lines: [
      '本玩法采用标准国标 81 番种，8 番起和。',
      '当前为单盘国标麻将；除盘数外不做规则简化。',
      '本项目使用 144 张国标牌，含花牌。',
    ],
  },
  {
    title: '牌组',
    lines: [
      '万/筒/条 1-9 各 4 张，共 108 张。',
      '风牌东南西北各 4 张，共 16 张；箭牌中发白各 4 张，共 12 张。',
      '花牌春夏秋冬梅兰竹菊各 1 张，共 8 张。',
    ],
  },
  {
    title: '开局与补花',
    lines: [
      '庄家初始 14 张，其余玩家 13 张。',
      '开局补花按东南西北顺序处理；摸到花牌后明放，并从牌墙尾部补牌。',
      '默认自动补花；规则层保留取消自动补花、暂不补花、后续补花和打出花牌的能力。',
      '打出花牌后，其他玩家不能吃、碰、杠、和，直接进入下一家摸牌。',
    ],
  },
  {
    title: '行牌动作',
    lines: [
      '自己回合：摸牌后可自摸和、暗杠、加杠、补花、打牌。',
      '响应他家弃牌：可和、碰、明杠、吃、过；吃只能吃上家弃牌。',
      '和牌优先级最高；无人和时，碰/明杠优先于吃。',
      '加杠可被抢杠和；抢杠和按点和处理。暗杠对其他玩家隐藏，盘末公开。',
    ],
  },
  {
    title: '和牌与终局',
    lines: [
      '基本和牌型为 4 面子 + 1 将；特殊型包括七对、十三幺、全不靠、七星不靠、组合龙、连七对等。',
      '8 番起和；花牌番参与总分，但不计入 8 番起和门槛。',
      '采用截和制：多人同时声明和同一张牌，只认从放铳者逆时针顺序最靠前的一家。',
      '本盘一人合法和牌即结束；牌墙摸尽且无人合法和牌为荒庄。',
    ],
  },
  {
    title: '海底规则',
    lines: [
      '摸起牌墙最后一张后，摸牌者不能开杠、不能补花。',
      '摸牌者不能自摸则必须打一张。',
      '其他人只能和或不和，不能吃、碰、杠；都不和则荒庄。',
    ],
  },
  {
    title: '计分与积分',
    lines: [
      '国标底分为 8。',
      '自摸规则分：和牌人 +(8+番数)×3；其他三家各 -(8+番数)。',
      '点和规则分：和牌人 +(8×3+番数)；点炮者 -(8+番数)；非点炮者 -8。',
      '本项目积分变化 = 规则分 ×100；结算与流水会区分规则分和积分。',
    ],
  },
  {
    title: '和牌校验',
    lines: [
      '服务只接受满足牌型与 8 番门槛的合法和牌。',
      '未达到门槛或不符合牌型的请求会被拒绝，不改变牌局。',
      '花牌只计入总分，不能用来补足起和门槛。',
    ],
  },
];

const GUOBIAO_RULE_FAN_GUIDES: Array<BloodRuleFanGuide> = [
  {
    kind: 'pattern',
    kindLabel: '番种索引',
    code: '88',
    name: '88 番',
    multiplier: '88番',
    desc: '大四喜、大三元、绿一色、九莲宝灯、四杠、连七对、十三幺。',
    tiles: ['1z', '1z', '1z', '2z', '2z', '2z', '3z', '3z', '3z', '4z', '4z', '4z', '5m', '5m'],
  },
  {
    kind: 'pattern',
    kindLabel: '番种索引',
    code: '64',
    name: '64 番',
    multiplier: '64番',
    desc: '清幺九、小四喜、小三元、字一色、四暗刻、一色双龙会。',
    tiles: ['1m', '1m', '1m', '9m', '9m', '9m', '1p', '1p', '1p', '9p', '9p', '9p', '1s', '1s'],
  },
  {
    kind: 'pattern',
    kindLabel: '番种索引',
    code: '48',
    name: '48 番',
    multiplier: '48番',
    desc: '一色四同顺、一色四节高。',
    tiles: ['1m', '2m', '3m', '1m', '2m', '3m', '1m', '2m', '3m', '1m', '2m', '3m', '5p', '5p'],
  },
  {
    kind: 'pattern',
    kindLabel: '番种索引',
    code: '32',
    name: '32 番',
    multiplier: '32番',
    desc: '一色四步高、三杠、混幺九。',
    tiles: ['1m', '2m', '3m', '2m', '3m', '4m', '3m', '4m', '5m', '4m', '5m', '6m', '7p', '7p'],
  },
  {
    kind: 'pattern',
    kindLabel: '番种索引',
    code: '24',
    name: '24 番',
    multiplier: '24番',
    desc: '七对、七星不靠、全双刻、清一色、一色三同顺、一色三节高、全大、全中、全小。',
    tiles: ['1m', '1m', '2m', '2m', '3p', '3p', '4p', '4p', '5s', '5s', '6s', '6s', '7m', '7m'],
  },
  {
    kind: 'pattern',
    kindLabel: '番种索引',
    code: '16',
    name: '16 番',
    multiplier: '16番',
    desc: '清龙、三色双龙会、一色三步高、全带五、三同刻、三暗刻。',
    tiles: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '2p', '3p', '4p', '5s', '5s'],
  },
  {
    kind: 'pattern',
    kindLabel: '番种索引',
    code: '12',
    name: '12 番',
    multiplier: '12番',
    desc: '全不靠、组合龙、大于五、小于五、三风刻。',
    tiles: ['1m', '4m', '7m', '2p', '5p', '8p', '3s', '6s', '9s', '1z', '2z', '3z', '5z', '5z'],
  },
  {
    kind: 'event',
    kindLabel: '番种索引',
    code: '8',
    name: '8 番',
    multiplier: '8番',
    desc: '花龙、推不倒、三色三同顺、三色三节高、无番和、妙手回春、海底捞月、杠上开花、抢杠和。',
    tiles: ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '2m', '2m', '2m', '5p', '5p'],
  },
  {
    kind: 'pattern',
    kindLabel: '番种索引',
    code: '6',
    name: '6 番',
    multiplier: '6番',
    desc: '碰碰和、混一色、三色三步高、五门齐、全求人、双暗杠、双箭刻。',
    tiles: ['1m', '1m', '1m', '2p', '2p', '2p', '3s', '3s', '3s', '5z', '5z', '5z', '7z', '7z'],
  },
  {
    kind: 'pattern',
    kindLabel: '番种索引',
    code: '4',
    name: '4 番',
    multiplier: '4番',
    desc: '全带幺、不求人、双明杠、和绝张。',
    tiles: ['1m', '2m', '3m', '7m', '8m', '9m', '1p', '1p', '1p', '9s', '9s', '9s', '1z', '1z'],
  },
  {
    kind: 'pattern',
    kindLabel: '番种索引',
    code: '2',
    name: '2 番',
    multiplier: '2番',
    desc: '箭刻、圈风刻、门风刻、门前清、平和、四归一、双同刻、双暗刻、暗杠、断幺。',
    tiles: ['2m', '3m', '4m', '3p', '4p', '5p', '4s', '5s', '6s', '6m', '7m', '8m', '5p', '5p'],
  },
  {
    kind: 'event',
    kindLabel: '番种索引',
    code: '1',
    name: '1 番',
    multiplier: '1番',
    desc: '一般高、喜相逢、连六、老少副、幺九刻、明杠、缺一门、无字、边张、嵌张、单钓将、自摸、花牌。',
    tiles: ['1m', '2m', '3m', '1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '5m', '5m'],
  },
];

const GUOBIAO_RULE_DISPLAY_SECTIONS: Array<BloodRuleDisplaySection> = [
  {
    title: '副露来源方向',
    lines: [
      '吃、碰、明杠里横放的牌表示“从别人弃牌拿来的那张”。',
      '吃只能吃上家弃牌；碰/明杠可响应任意他家弃牌。',
    ],
    examples: [
      { label: '吃牌', tiles: [{ tile: '3m' }, { tile: '4m', sideways: true }, { tile: '5m' }] },
      { label: '碰牌', tiles: [{ tile: '5m' }, { tile: '5m', sideways: true }, { tile: '5m' }] },
      { label: '明杠', tiles: [{ tile: '5m' }, { tile: '5m' }, { tile: '5m', sideways: true }, { tile: '5m' }] },
    ],
  },
  {
    title: '暗杠与加杠',
    lines: [
      '暗杠对其他玩家隐藏，盘末公开；对局中四张都盖住。',
      '加杠是在原碰牌上补第 4 张；加杠可被抢杠和。',
    ],
    examples: [
      { label: '暗杠', tiles: [{ tile: 'back' }, { tile: 'back' }, { tile: 'back' }, { tile: 'back' }] },
      { label: '加杠', tiles: [{ tile: 'back' }, { tile: '5m' }, { tile: '5m', sideways: true }, { tile: '5m' }] },
    ],
  },
  {
    title: '花牌展示',
    lines: [
      '花牌不放入吃碰杠副露区，按座位放在座位内侧展示区。',
      '每家最多 8 张花牌；花牌番参与总分，但不计入 8 番起和门槛。',
    ],
    examples: [
      { label: '四季', tiles: [{ tile: 'chun' }, { tile: 'xia' }, { tile: 'qiu' }, { tile: 'dong' }] },
      { label: '四君子', tiles: [{ tile: 'mei' }, { tile: 'lan' }, { tile: 'zu' }, { tile: 'ju' }] },
    ],
  },
  {
    title: '结算展示',
    lines: [
      '结算页延续血战弹层视觉，但字段按国标展示。',
      '规则分使用国标底分 8；平台积分为规则分 ×100。',
      '流水和结算详情会展示番种、总番、规则分和积分变化。',
    ],
    examples: [],
  },
];

const PROJECT_CORNERS = Array.from({ length: 8 }, () => new Vector3());

function projectAabbToNdc(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  camera: any,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  PROJECT_CORNERS[0].set(minX, minY, minZ);
  PROJECT_CORNERS[1].set(minX, minY, maxZ);
  PROJECT_CORNERS[2].set(minX, maxY, minZ);
  PROJECT_CORNERS[3].set(minX, maxY, maxZ);
  PROJECT_CORNERS[4].set(maxX, minY, minZ);
  PROJECT_CORNERS[5].set(maxX, minY, maxZ);
  PROJECT_CORNERS[6].set(maxX, maxY, minZ);
  PROJECT_CORNERS[7].set(maxX, maxY, maxZ);

  let outMinX = Infinity;
  let outMaxX = -Infinity;
  let outMinY = Infinity;
  let outMaxY = -Infinity;
  for (const corner of PROJECT_CORNERS) {
    corner.project(camera);
    outMinX = Math.min(outMinX, corner.x);
    outMaxX = Math.max(outMaxX, corner.x);
    outMinY = Math.min(outMinY, corner.y);
    outMaxY = Math.max(outMaxY, corner.y);
  }
  if (!Number.isFinite(outMinX) || !Number.isFinite(outMaxX) || !Number.isFinite(outMinY) || !Number.isFinite(outMaxY)) {
    return null;
  }
  return { minX: outMinX, maxX: outMaxX, minY: outMinY, maxY: outMaxY };
}

export class HandHudOverlay {
  private mainEl: HTMLElement;
  private root: HTMLDivElement;
  private ledgerRoot: HTMLDivElement;
  private ledgerBtn: HTMLButtonElement;
  private ledgerOpen: boolean = false;
  private ledgerPlacement: 'byHud' | 'byFullscreen';
  private dingqueBadgeBySuit: boolean = false;
  private hudLayout: 'rail' | 'fixed' = 'rail';
  private hudActionsRoot: HTMLDivElement;
  private fullscreenBtn: HTMLButtonElement | null;
  private homeBtn: HTMLButtonElement | null;
  private rulesRoot: HTMLDivElement;
  private rulesBtn: HTMLButtonElement;
  private rulesOpen: boolean = false;
  private rulesLayer: HTMLDivElement;
  private rulesPanel: HTMLDivElement;
  private rulesTitle: HTMLDivElement;
  private rulesCloseBtn: HTMLButtonElement;
  private rulesTabBasicBtn: HTMLButtonElement;
  private rulesTabFansBtn: HTMLButtonElement;
  private rulesTabDisplayBtn: HTMLButtonElement;
  private rulesBasicPane: HTMLDivElement;
  private rulesFansPane: HTMLDivElement;
  private rulesDisplayPane: HTMLDivElement;
  private rulesFansRendered: boolean = false;
  private rulesDisplayRendered: boolean = false;
  private rulesRenderedGameType: GameType | null = null;
  private settingsRoot: HTMLDivElement;
  private settingsBtn: HTMLButtonElement;
  private settingsOpen: boolean = false;
  private settingsLayer: HTMLDivElement;
  private settingsPanel: HTMLDivElement;
  private autoBuhuaSwitch: HTMLButtonElement;
  private autoBuhuaStateText: HTMLSpanElement;
  private ledgerBackdrop: HTMLDivElement;
  private ledgerPanel: HTMLDivElement;
  private ledgerTitle: HTMLDivElement;
  private ledgerList: HTMLDivElement;
  private ledgerFooter: HTMLDivElement;
  private practiceCreateBtn: HTMLButtonElement;
  private shareBtn: HTMLButtonElement;
  private shareOut: HTMLDivElement;
  private shareOutInput: HTMLInputElement;
  private shareOutCopyBtn: HTMLButtonElement;

  private settlementRoot: HTMLDivElement;
  private settlementBtn: HTMLButtonElement;
  private playAgainBtn: HTMLButtonElement;
  private playAgainBusy: boolean = false;
  private settlementOpen: boolean = false;
  private settlementBackdrop: HTMLDivElement;
  private settlementPanel: HTMLDivElement;
  private settlementTitle: HTMLDivElement;
  private settlementBody: HTMLDivElement;
  private settlementReplayBtn: HTMLButtonElement;
  private settlementPracticeBtn: HTMLButtonElement;
  private settlementCloseBtn: HTMLButtonElement;
  private settlementRenderKey: string = '';
  private settlementExpandedSeat: number | null = null;
  private settlementOverviewRows = new Map<number, HTMLDivElement>();
  private settlementOverviewDetailOuters = new Map<number, HTMLDivElement>();
  private settlementOverviewDetailInners = new Map<number, HTMLDivElement>();
  private settlementOverviewDetailBtns = new Map<number, HTMLButtonElement>();

  private debugFansEnabled: boolean = false;
  private debugFansRoot: HTMLDivElement | null = null;
  private debugFansBtn: HTMLButtonElement | null = null;
  private debugFansOpen: boolean = false;
  private debugFansBackdrop: HTMLDivElement | null = null;
  private debugFansPanel: HTMLDivElement | null = null;
  private debugFansStatus: HTMLDivElement | null = null;
  private debugFansAwaitHu: { since: number; title: string } | null = null;
  private debugFansScript:
    | {
      kind: 'gangShangKaiHua';
      title: string;
      startedAt: number;
      step: 'kong' | 'waitDraw';
      kong: { gangType: 'an' | 'add'; tileKey: number };
      winTileKey: number;
    }
    | null = null;

  private teachRoot: HTMLDivElement;
  private teachBtn: HTMLButtonElement;
  private teachEnabled: boolean = false;
  private teachHosted: boolean = false;
  private teachHostedPrefix: HTMLSpanElement | null = null;
  private aiOverlay: BloodAiOverlay;
  private lastBloodPhase: BloodPhase | null = null;
  private teachToast: HTMLDivElement;
  private teachToastTimer: number | null = null;

  private splitRoot: HTMLDivElement;
  private splitBtn: HTMLButtonElement;
  private practiceQuickBtn: HTMLButtonElement;
  private replayPrevBtn: HTMLButtonElement;
  private replayNextBtn: HTMLButtonElement;
  private splitOverlay: BloodSplitOverlay;
  private splitAutoDismissed: boolean = false;
  private practiceBusy: boolean = false;
  private practiceBranchCount: number = 0;
  private practiceEnterBranchId: string | null = null;
  private practiceKnownSnapshotKeys: Set<string> = new Set();
  private practiceLocalCreatedKeys: Set<string> = new Set();
  private practiceLastSummaryGameId: string | null = null;
  private practiceLastSummaryKey: string | null = null;
  private practiceSummaryLoading: boolean = false;
  private practiceNextSummaryRetryAt: number = 0;
  private splitCloseBySystem: boolean = false;
  private lastShowSplit: boolean = false;
  private replayControls:
    | {
      canPrev: () => boolean;
      canNext: () => boolean;
      onPrev: () => void;
      onNext: () => void;
      canShare: boolean;
    }
    | null = null;

  private cards: Array<{
    seat: number;
    el: HTMLDivElement;
    avatarImg: HTMLImageElement;
    lastAvatarSrc: string;
    nicknameText: HTMLDivElement;
    scoreText: HTMLDivElement;
    scoreInner: HTMLSpanElement;
    lastScoreKey: string;
    lastScoreW: number;
    lastScoreH: number;
    badgeText: HTMLDivElement;
  }>;

  constructor(
    private mainView: MainView,
    private client: Client,
    private world: World,
    private objectView: ObjectView,
    options?: {
      ledgerPlacement?: 'byHud' | 'byFullscreen';
      dingqueBadgeBySuit?: boolean;
      hudLayout?: 'rail' | 'fixed';
    },
  ) {
    const main = document.getElementById('main');
    if (!main) {
      throw new Error('HandHudOverlay: #main not found');
    }
    this.mainEl = main;
    const root = document.createElement('div');
    root.id = 'hud-overlay';
    main.appendChild(root);
    this.root = root;

    this.cards = [];
    for (let seat = 0; seat < 4; seat++) {
      const el = document.createElement('div');
      el.className = 'hud-card';

      const inner = document.createElement('div');
      inner.className = 'hud-card-inner';

      // “轮到出牌”玩家的 HUD 跑光边框（SVG + CSS dashoffset 动画）。
      // - 常驻 DOM：只通过 class 切换显示/暂停动画，避免频繁创建销毁。
      // - SVG 使用百分比尺寸与固定 rx=4，保证圆角与 HUD 一致（CSS px）。
      const turnRing = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      turnRing.setAttribute('class', 'hud-turn-ring');
      turnRing.setAttribute('aria-hidden', 'true');
      turnRing.setAttribute('focusable', 'false');
      const mkRingRect = (cls: string): SVGRectElement => {
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('class', cls);
        r.setAttribute('x', '0');
        r.setAttribute('y', '0');
        r.setAttribute('width', '100%');
        r.setAttribute('height', '100%');
        r.setAttribute('rx', '4');
        r.setAttribute('ry', '4');
        // 用标准化长度（100）表达 dasharray / dashoffset，保证不同 HUD 尺寸下仍只出现“一段光带”。
        r.setAttribute('pathLength', '100');
        r.setAttribute('fill', 'none');
        return r;
      };
      turnRing.appendChild(mkRingRect('hud-turn-tail'));
      turnRing.appendChild(mkRingRect('hud-turn-head'));
      turnRing.appendChild(mkRingRect('hud-turn-spark'));

      const avatar = document.createElement('div');
      avatar.className = 'hud-avatar';
      const avatarImg = document.createElement('img');
      avatarImg.className = 'hud-avatar-img';
      avatarImg.alt = '';
      avatarImg.draggable = false;
      avatar.appendChild(avatarImg);

      const scoreText = document.createElement('div');
      scoreText.className = 'hud-score';
      const scoreInner = document.createElement('span');
      scoreInner.className = 'hud-score-text';
      scoreInner.textContent = '--';
      scoreText.appendChild(scoreInner);

      const badgeText = document.createElement('div');
      badgeText.className = 'hud-badge hidden';

      const nicknameText = document.createElement('div');
      nicknameText.className = 'hud-nickname';
      const details = document.createElement('div');
      details.className = 'hud-details';
      details.appendChild(scoreText);
      details.appendChild(nicknameText);
      inner.appendChild(avatar);
      inner.appendChild(details);
      el.dataset.seat = String(seat);
      el.appendChild(inner);
      // 头像、积分与昵称共用外轮廓，跑光沿完整信息卡裁切。
      inner.appendChild(turnRing);
      el.appendChild(badgeText);
      root.appendChild(el);

      this.cards.push({
        seat,
        el,
        avatarImg,
        lastAvatarSrc: '',
        nicknameText,
        scoreText,
        scoreInner,
        lastScoreKey: '',
        lastScoreW: 0,
        lastScoreH: 0,
        badgeText,
      });
    }

    const ledgerRoot = document.createElement('div');
    ledgerRoot.id = 'ledger-ui';
    main.appendChild(ledgerRoot);
    this.ledgerRoot = ledgerRoot;

    this.ledgerPlacement = options?.ledgerPlacement ?? 'byHud';
    this.dingqueBadgeBySuit = options?.dingqueBadgeBySuit ?? false;
    this.hudLayout = options?.hudLayout ?? 'rail';
    this.fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement | null;
    this.homeBtn = document.getElementById('home-btn') as HTMLButtonElement | null;
    const hudActions =
      (document.getElementById('hud-actions') as HTMLDivElement | null) ??
      (() => {
        const el = document.createElement('div');
        el.id = 'hud-actions';
        main.appendChild(el);
        return el;
      })();
    this.hudActionsRoot = hudActions;
    if (this.fullscreenBtn) {
      this.fullscreenBtn.classList.add('mj-hud-btn');
      if (this.fullscreenBtn.parentElement !== hudActions) {
        hudActions.appendChild(this.fullscreenBtn);
      }
    }
    if (this.homeBtn) {
      this.homeBtn.classList.add('mj-hud-btn');
      if (this.homeBtn.parentElement !== hudActions) {
        hudActions.appendChild(this.homeBtn);
      }
    }

    const rulesRoot = document.createElement('div');
    rulesRoot.id = 'rules-ui';
    main.appendChild(rulesRoot);
    this.rulesRoot = rulesRoot;

    const rulesBtn = document.createElement('button');
    rulesBtn.type = 'button';
    initHudActionButton(rulesBtn, { label: '规则', icon: 'circleHelp', kind: 'rules', title: '规则' });
    rulesBtn.setAttribute('aria-expanded', 'false');
    rulesBtn.onclick = () => this.setRulesOpen(!this.rulesOpen);
    this.hudActionsRoot.appendChild(rulesBtn);
    this.rulesBtn = rulesBtn;

    const rulesLayer = document.createElement('div');
    rulesLayer.className = 'rules-layer hidden';
    rulesLayer.onclick = (e) => {
      if (e.target === rulesLayer) {
        this.setRulesOpen(false);
      }
    };
    rulesRoot.appendChild(rulesLayer);
    this.rulesLayer = rulesLayer;

    const rulesPanel = document.createElement('div');
    rulesPanel.className = 'rules-panel';
    rulesPanel.setAttribute('role', 'dialog');
    rulesPanel.setAttribute('aria-modal', 'true');
    rulesPanel.setAttribute('aria-label', '血战到底规则');
    rulesLayer.appendChild(rulesPanel);
    this.rulesPanel = rulesPanel;

    const rulesHead = document.createElement('div');
    rulesHead.className = 'rules-head';
    rulesPanel.appendChild(rulesHead);

    const rulesTitle = document.createElement('div');
    rulesTitle.className = 'rules-title';
    rulesTitle.textContent = '血战到底规则';
    rulesHead.appendChild(rulesTitle);
    this.rulesTitle = rulesTitle;

    const rulesClose = document.createElement('button');
    rulesClose.type = 'button';
    rulesClose.className = 'rules-close';
    rulesClose.textContent = 'X';
    rulesClose.onclick = () => this.setRulesOpen(false);
    rulesHead.appendChild(rulesClose);
    this.rulesCloseBtn = rulesClose;

    const rulesBody = document.createElement('div');
    rulesBody.className = 'rules-body';
    rulesPanel.appendChild(rulesBody);

    const rulesNav = document.createElement('div');
    rulesNav.className = 'rules-nav';
    rulesBody.appendChild(rulesNav);

    const tabBasic = document.createElement('button');
    tabBasic.type = 'button';
    tabBasic.className = 'rules-tab active';
    tabBasic.textContent = '基础规则';
    tabBasic.onclick = () => this.switchRulesTab('basic');
    rulesNav.appendChild(tabBasic);
    this.rulesTabBasicBtn = tabBasic;

    const tabFans = document.createElement('button');
    tabFans.type = 'button';
    tabFans.className = 'rules-tab';
    tabFans.textContent = '番型规则';
    tabFans.onclick = () => this.switchRulesTab('fans');
    rulesNav.appendChild(tabFans);
    this.rulesTabFansBtn = tabFans;

    const tabDisplay = document.createElement('button');
    tabDisplay.type = 'button';
    tabDisplay.className = 'rules-tab';
    tabDisplay.textContent = '显示规则';
    tabDisplay.onclick = () => this.switchRulesTab('display');
    rulesNav.appendChild(tabDisplay);
    this.rulesTabDisplayBtn = tabDisplay;

    const rulesContent = document.createElement('div');
    rulesContent.className = 'rules-content';
    rulesBody.appendChild(rulesContent);

    const basicPane = document.createElement('div');
    basicPane.className = 'rules-pane';
    rulesContent.appendChild(basicPane);
    this.rulesBasicPane = basicPane;

    const fansPane = document.createElement('div');
    fansPane.className = 'rules-pane hidden';
    rulesContent.appendChild(fansPane);
    this.rulesFansPane = fansPane;

    const displayPane = document.createElement('div');
    displayPane.className = 'rules-pane hidden';
    rulesContent.appendChild(displayPane);
    this.rulesDisplayPane = displayPane;

    const settingsRoot = document.createElement('div');
    settingsRoot.id = 'settings-ui';
    main.appendChild(settingsRoot);
    this.settingsRoot = settingsRoot;

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    initHudActionButton(settingsBtn, { label: '设置', icon: 'settings', kind: 'settings', title: '对局设置' });
    settingsBtn.classList.add('is-hidden');
    settingsBtn.setAttribute('aria-expanded', 'false');
    settingsBtn.onclick = () => this.setSettingsOpen(!this.settingsOpen);
    this.hudActionsRoot.appendChild(settingsBtn);
    this.settingsBtn = settingsBtn;

    const settingsLayer = document.createElement('div');
    settingsLayer.className = 'settings-layer hidden';
    settingsLayer.onclick = (e) => {
      if (e.target === settingsLayer) {
        this.setSettingsOpen(false);
      }
    };
    settingsRoot.appendChild(settingsLayer);
    this.settingsLayer = settingsLayer;

    const settingsPanel = document.createElement('div');
    settingsPanel.className = 'settings-panel';
    settingsPanel.setAttribute('role', 'dialog');
    settingsPanel.setAttribute('aria-modal', 'true');
    settingsPanel.setAttribute('aria-label', '对局设置');
    settingsLayer.appendChild(settingsPanel);
    this.settingsPanel = settingsPanel;

    const settingsHead = document.createElement('div');
    settingsHead.className = 'settings-head';
    settingsPanel.appendChild(settingsHead);

    const settingsTitle = document.createElement('div');
    settingsTitle.className = 'settings-title';
    settingsTitle.textContent = '对局设置';
    settingsHead.appendChild(settingsTitle);

    const settingsClose = document.createElement('button');
    settingsClose.type = 'button';
    settingsClose.className = 'settings-close';
    settingsClose.textContent = 'X';
    settingsClose.onclick = () => this.setSettingsOpen(false);
    settingsHead.appendChild(settingsClose);

    const settingsBody = document.createElement('div');
    settingsBody.className = 'settings-body';
    settingsPanel.appendChild(settingsBody);

    const autoRow = document.createElement('div');
    autoRow.className = 'settings-row';
    settingsBody.appendChild(autoRow);

    const autoCopy = document.createElement('div');
    autoCopy.className = 'settings-copy';
    autoRow.appendChild(autoCopy);

    const autoLabel = document.createElement('div');
    autoLabel.className = 'settings-label';
    autoLabel.textContent = '自动补花';
    autoCopy.appendChild(autoLabel);

    const autoHint = document.createElement('div');
    autoHint.className = 'settings-hint';
    autoHint.textContent = '摸到普通花牌时自动从牌墙尾补牌。关闭后，花牌会留在手里。';
    autoCopy.appendChild(autoHint);

    const autoSwitch = document.createElement('button');
    autoSwitch.type = 'button';
    autoSwitch.className = 'settings-switch';
    autoSwitch.setAttribute('aria-label', '自动补花');
    autoSwitch.onclick = () => this.toggleGuobiaoAutoBuhua();
    autoRow.appendChild(autoSwitch);
    this.autoBuhuaSwitch = autoSwitch;

    const autoStateText = document.createElement('span');
    autoStateText.className = 'settings-switch-text';
    autoSwitch.appendChild(autoStateText);
    this.autoBuhuaStateText = autoStateText;
    this.syncSettingsPanel();

    this.ensureRulesRenderedForCurrentGame();

    const teachRoot = document.createElement('div');
    teachRoot.id = 'teach-ui';
    main.appendChild(teachRoot);
    this.teachRoot = teachRoot;

    const splitRoot = document.createElement('div');
    splitRoot.id = 'split-ui';
    main.appendChild(splitRoot);
    this.splitRoot = splitRoot;

    const toast = document.createElement('div');
    toast.className = 'mj-hud-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
    this.teachToast = toast;

    const teachBtn = document.createElement('button');
    teachBtn.type = 'button';
    initHudActionButton(teachBtn, { label: '荐牌', icon: 'sparkles', kind: 'teach', title: '荐牌' });
    {
      const hostedPrefix = document.createElement('span');
      hostedPrefix.className = 'mj-hud-btn-prefix';
      hostedPrefix.textContent = '托管中';
      const iconWrap = teachBtn.querySelector('.mj-hud-btn-icon');
      if (iconWrap) {
        teachBtn.insertBefore(hostedPrefix, iconWrap);
      } else {
        teachBtn.insertBefore(hostedPrefix, teachBtn.firstChild);
      }
      this.teachHostedPrefix = hostedPrefix;
    }
    teachBtn.classList.add('is-hidden');
    teachBtn.onclick = () => void this.onTeachToggle();
    this.hudActionsRoot.appendChild(teachBtn);
    this.teachBtn = teachBtn;
    this.syncTeachBtn();
    this.aiOverlay = new BloodAiOverlay({
      client: this.client,
      world: this.world,
      root: teachRoot,
      anchorBtn: teachBtn,
      onClose: () => {
        if (this.teachEnabled) {
          this.teachEnabled = false;
          this.syncTeachBtn();
        }
      },
      onHostedChange: (enabled, reason) => {
        this.setTeachHosted(enabled, reason);
      },
    });

    const splitBtn = document.createElement('button');
    splitBtn.type = 'button';
    initHudActionButton(splitBtn, { label: '拆牌', icon: 'split', kind: 'split', title: '拆牌' });
    splitBtn.classList.add('is-hidden');
    this.hudActionsRoot.appendChild(splitBtn);
    this.splitBtn = splitBtn;
    this.splitOverlay = new BloodSplitOverlay({
      client: this.client,
      world: this.world,
      root: splitRoot,
      anchorBtn: splitBtn,
      onClose: () => {
        if (this.splitCloseBySystem) return;
        this.splitAutoDismissed = true;
      },
    });
    splitBtn.onclick = () => this.splitOverlay.setOpen(!this.splitOverlay.isOpen());

    const practiceQuickBtn = document.createElement('button');
    practiceQuickBtn.type = 'button';
    initHudActionButton(practiceQuickBtn, { label: '练习', icon: 'sparkles', kind: 'practice', title: '创建练习分支' });
    practiceQuickBtn.classList.add('is-hidden');
    practiceQuickBtn.onclick = () => void this.onCreatePracticeBranch();
    this.hudActionsRoot.appendChild(practiceQuickBtn);
    this.practiceQuickBtn = practiceQuickBtn;

    const replayPrevBtn = document.createElement('button');
    replayPrevBtn.type = 'button';
    initHudActionButton(replayPrevBtn, { label: '上一步', icon: 'arrowLeft', kind: 'replayPrev', title: '上一步' });
    replayPrevBtn.classList.add('is-hidden');
    replayPrevBtn.onclick = () => this.replayControls?.onPrev();
    this.hudActionsRoot.appendChild(replayPrevBtn);
    this.replayPrevBtn = replayPrevBtn;

    const replayNextBtn = document.createElement('button');
    replayNextBtn.type = 'button';
    initHudActionButton(replayNextBtn, { label: '下一步', icon: 'arrowRight', kind: 'replayNext', title: '下一步' });
    replayNextBtn.classList.add('is-hidden');
    replayNextBtn.onclick = () => this.replayControls?.onNext();
    this.hudActionsRoot.appendChild(replayNextBtn);
    this.replayNextBtn = replayNextBtn;

    const ledgerBtn = document.createElement('button');
    ledgerBtn.type = 'button';
    initHudActionButton(ledgerBtn, { label: '流水', icon: 'history', kind: 'ledger', title: '流水' });
    ledgerBtn.classList.add('is-hidden');
    ledgerBtn.setAttribute('aria-expanded', 'false');
    ledgerBtn.onclick = () => this.setLedgerOpen(!this.ledgerOpen);
    this.hudActionsRoot.appendChild(ledgerBtn);
    this.ledgerBtn = ledgerBtn;

    const backdrop = document.createElement('div');
    backdrop.className = 'ledger-backdrop hidden';
    backdrop.onclick = () => this.setLedgerOpen(false);
    ledgerRoot.appendChild(backdrop);
    this.ledgerBackdrop = backdrop;

    const panel = document.createElement('div');
    panel.className = 'ledger-panel hidden';
    panel.onclick = (e) => e.stopPropagation();
    ledgerRoot.appendChild(panel);
    this.ledgerPanel = panel;

    const title = document.createElement('div');
    title.className = 'ledger-title';
    panel.appendChild(title);
    this.ledgerTitle = title;

    const list = document.createElement('div');
    list.className = 'ledger-list';
    panel.appendChild(list);
    this.ledgerList = list;

    const footer = document.createElement('div');
    footer.className = 'ledger-footer';
    panel.appendChild(footer);
    this.ledgerFooter = footer;

    const actions = document.createElement('div');
    actions.className = 'ledger-actions';
    footer.appendChild(actions);

    const practiceCreateBtn = document.createElement('button');
    practiceCreateBtn.type = 'button';
    practiceCreateBtn.className = 'ledger-action-btn ghost';
    practiceCreateBtn.textContent = '创建练习分支';
    actions.appendChild(practiceCreateBtn);
    this.practiceCreateBtn = practiceCreateBtn;

    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'ledger-action-btn ghost';
    shareBtn.textContent = '生成分享链接';
    actions.appendChild(shareBtn);
    this.shareBtn = shareBtn;

    const shareOut = document.createElement('div');
    shareOut.className = 'ledger-share-out hidden';
    footer.appendChild(shareOut);
    this.shareOut = shareOut;

    const shareInput = document.createElement('input');
    shareInput.className = 'ledger-share-input';
    shareInput.readOnly = true;
    shareInput.value = '';
    shareOut.appendChild(shareInput);
    this.shareOutInput = shareInput;

    const shareCopy = document.createElement('button');
    shareCopy.type = 'button';
    shareCopy.className = 'ledger-copy-btn';
    shareCopy.textContent = '复制链接';
    shareCopy.onclick = async () => {
      const ok = await copyText(this.shareOutInput.value);
      shareCopy.textContent = ok ? '已复制' : '复制失败';
      window.setTimeout(() => (shareCopy.textContent = '复制链接'), 900);
    };
    shareOut.appendChild(shareCopy);
    this.shareOutCopyBtn = shareCopy;

    practiceCreateBtn.onclick = () => void this.onCreatePracticeBranch();
    shareBtn.onclick = () => void this.onCreateShare();

    const settlementRoot = document.createElement('div');
    settlementRoot.id = 'settlement-ui';
    main.appendChild(settlementRoot);
    this.settlementRoot = settlementRoot;

    const settleBtn = document.createElement('button');
    settleBtn.type = 'button';
    initHudActionButton(settleBtn, { label: '结算', icon: 'barChart3', kind: 'settlement', title: '结算' });
    settleBtn.classList.add('is-hidden');
    settleBtn.setAttribute('aria-expanded', 'false');
    settleBtn.onclick = () => this.setSettlementOpen(!this.settlementOpen);
    this.hudActionsRoot.appendChild(settleBtn);
    this.settlementBtn = settleBtn;

    const playAgainBtn = document.createElement('button');
    playAgainBtn.type = 'button';
    initHudActionButton(playAgainBtn, { label: '再战', icon: 'refreshCw', kind: 'playAgain', title: '再战' });
    playAgainBtn.classList.add('is-hidden');
    playAgainBtn.onclick = () => void this.onPlayAgain();
    this.hudActionsRoot.appendChild(playAgainBtn);
    this.playAgainBtn = playAgainBtn;

    const settleBackdrop = document.createElement('div');
    settleBackdrop.className = 'settle-backdrop hidden';
    settleBackdrop.onclick = () => this.setSettlementOpen(false);
    settlementRoot.appendChild(settleBackdrop);
    this.settlementBackdrop = settleBackdrop;

    const settlePanel = document.createElement('div');
    settlePanel.className = 'settle-panel hidden';
    settlePanel.onclick = (e) => e.stopPropagation();
    settlementRoot.appendChild(settlePanel);
    this.settlementPanel = settlePanel;

    const settleHeader = document.createElement('div');
    settleHeader.className = 'settle-header';
    settlePanel.appendChild(settleHeader);

    const settleTitle = document.createElement('div');
    settleTitle.className = 'settle-title';
    settleHeader.appendChild(settleTitle);
    this.settlementTitle = settleTitle;

    const settleActions = document.createElement('div');
    settleActions.className = 'settle-header-actions';
    settleHeader.appendChild(settleActions);

    const settlementReplayBtn = document.createElement('button');
    settlementReplayBtn.type = 'button';
    settlementReplayBtn.className = 'settle-head-btn settle-head-btn-primary';
    settlementReplayBtn.textContent = '查看本局牌谱';
    settlementReplayBtn.onclick = () => this.onOpenReplayDetail();
    settleActions.appendChild(settlementReplayBtn);
    this.settlementReplayBtn = settlementReplayBtn;

    const settlementPracticeBtn = document.createElement('button');
    settlementPracticeBtn.type = 'button';
    settlementPracticeBtn.className = 'settle-head-btn settle-head-btn-ghost';
    settlementPracticeBtn.textContent = '查看练习分支';
    settlementPracticeBtn.style.display = 'none';
    settlementPracticeBtn.onclick = () => void this.onOpenPracticeBranches();
    settleActions.appendChild(settlementPracticeBtn);
    this.settlementPracticeBtn = settlementPracticeBtn;

    const settleClose = document.createElement('button');
    settleClose.type = 'button';
    settleClose.className = 'settle-close';
    settleClose.textContent = '关闭';
    settleClose.onclick = () => this.setSettlementOpen(false);
    settleActions.appendChild(settleClose);
    this.settlementCloseBtn = settleClose;

    const settleBody = document.createElement('div');
    settleBody.className = 'settle-body';
    settlePanel.appendChild(settleBody);
    this.settlementBody = settleBody;

    const q = new URLSearchParams(window.location.search);
    this.debugFansEnabled = q.get('debugFans') === '1';
    if (this.debugFansEnabled) {
      const debugRoot = document.createElement('div');
      debugRoot.id = 'debug-fans-ui';
      main.appendChild(debugRoot);
      this.debugFansRoot = debugRoot;

      const debugBtn = document.createElement('button');
      debugBtn.type = 'button';
      initHudActionButton(debugBtn, { label: '测用例', icon: 'barChart3', kind: 'debugFans', title: '测用例' });
      debugBtn.classList.add('is-hidden');
      debugBtn.setAttribute('aria-expanded', 'false');
      debugBtn.onclick = () => this.setDebugFansOpen(!this.debugFansOpen);
      this.hudActionsRoot.appendChild(debugBtn);
      this.debugFansBtn = debugBtn;

      const debugBackdrop = document.createElement('div');
      debugBackdrop.className = 'debug-backdrop hidden';
      debugBackdrop.onclick = () => this.setDebugFansOpen(false);
      debugRoot.appendChild(debugBackdrop);
      this.debugFansBackdrop = debugBackdrop;

      const debugPanel = document.createElement('div');
      debugPanel.className = 'debug-panel hidden';
      debugPanel.onclick = (e) => e.stopPropagation();
      debugRoot.appendChild(debugPanel);
      this.debugFansPanel = debugPanel;

      const header = document.createElement('div');
      header.className = 'debug-header';
      debugPanel.appendChild(header);

      const titleEl = document.createElement('div');
      titleEl.className = 'debug-title';
      titleEl.textContent = `番型用例（${BLOOD_FAN_EXAMPLE_GROUPS.reduce((n, g) => n + g.items.length, 0)}）`;
      header.appendChild(titleEl);

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'debug-close';
      closeBtn.textContent = '关闭';
      closeBtn.onclick = () => this.setDebugFansOpen(false);
      header.appendChild(closeBtn);

      const status = document.createElement('div');
      status.className = 'debug-status';
      status.textContent = '仅 seat0 且非权威模式可用；点击用例将布置牌面并自动触发。';
      debugPanel.appendChild(status);
      this.debugFansStatus = status;

      const list = document.createElement('div');
      list.className = 'debug-list';
      debugPanel.appendChild(list);

      for (const group of BLOOD_FAN_EXAMPLE_GROUPS) {
        const g = document.createElement('div');
        g.className = 'debug-group';
        g.textContent = group.group;
        list.appendChild(g);

        for (const item of group.items) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'debug-case';
          const sub = (item.subtitle ?? '').trim();
          btn.innerHTML = sub
            ? `<div class="debug-case-title">${item.title}</div><div class="debug-case-sub">${sub}</div>`
            : `<div class="debug-case-title">${item.title}</div>`;
          btn.onclick = () => this.runDebugFanCase(item);
          list.appendChild(btn);
        }
      }
    }
  }

  setReplayControls(
    controls:
      | {
        canPrev: () => boolean;
        canNext: () => boolean;
        onPrev: () => void;
        onNext: () => void;
        canShare: boolean;
      }
      | null,
  ): void {
    this.replayControls = controls;
    if (!controls) {
      this.replayPrevBtn.disabled = true;
      this.replayNextBtn.disabled = true;
      return;
    }
    this.replayPrevBtn.disabled = !controls.canPrev();
    this.replayNextBtn.disabled = !controls.canNext();
  }

  setReplayAiContext(context: { gameId: string; shareId?: string | null; getEventIndex?: (() => number | null) | null } | null): void {
    this.aiOverlay.setReplayAiContext(
      context && typeof context.gameId === 'string' && context.gameId.trim()
        ? {
            gameId: context.gameId.trim(),
            shareId: context.shareId ? String(context.shareId).trim() || null : null,
            getEventIndex: typeof context.getEventIndex === 'function' ? context.getEventIndex : null,
          }
        : null
    );
  }

  private currentPracticeClientKey(): string | null {
    const blood = this.client.blood.get(0) as BloodState | null;
    const seat = this.world.seat;
    if (!blood || seat === null) return null;
    const me = blood.players?.[seat] ?? null;
    const scene: AiScene | 'snapshot' = (() => {
      if (!me || me.hu) return 'snapshot';
      if (blood.phase === 'swap3') {
        const swap3 = blood.swap3 ?? null;
        if (!swap3 || swap3.animatingSince !== null) return 'snapshot';
        const picked = swap3.selections?.[seat] ?? null;
        return picked === null ? 'swap3' : 'snapshot';
      }
      if (blood.phase === 'dingque') {
        return isDingqueCommitted(me) ? 'snapshot' : 'dingque';
      }
      if (blood.phase === 'playing') {
        const pending = blood.pending as any;
        if (pending && pending.kind === 'claim') {
          if (seat !== pending.fromSeat && pending.responses?.[seat] === null) {
            const opt = pending.options?.[seat] ?? null;
            if (opt && (opt.hu || opt.peng || opt.gang)) {
              return 'claim';
            }
          }
        }
        if (pending === null && blood.turnSeat === seat && blood.turnStep === 'discard' && me.dingque !== null) {
          return 'turn';
        }
      }
      return 'snapshot';
    })();
    if (scene !== 'snapshot') {
      const pendingId = typeof (blood.pending as any)?.id === 'number' ? Math.trunc((blood.pending as any).id) : null;
      const dingque = typeof me?.dingque === 'string' ? me.dingque : '';
      return [
        'mjlab.ai.snapshot.v1',
        `scene=${scene}`,
        `phase=${blood.phase}`,
        `turnSeat=${blood.turnSeat}`,
        `turnStep=${blood.turnStep}`,
        `pendingId=${pendingId}`,
        `swapSince=${(blood.swap3 as any)?.since ?? 'null'}`,
        `swapAnim=${(blood.swap3 as any)?.animatingSince ?? 'null'}`,
        `dingque=${dingque}`,
        `hu=${me?.hu ? 1 : 0}`,
        `wallIndex=${blood.wallIndex}`,
        `nextId=${blood.nextId}`,
      ].join('|');
    }
    const pendingId = typeof (blood.pending as any)?.id === 'number' ? Math.trunc((blood.pending as any).id) : 'none';
    const dingque = typeof me?.dingque === 'string' ? me.dingque : '';
    return [
      'mjlab.practice.snapshot.v1',
      'scene=snapshot',
      `phase=${blood.phase}`,
      `seat=${seat}`,
      `turnSeat=${blood.turnSeat}`,
      `turnStep=${blood.turnStep}`,
      `pendingId=${pendingId}`,
      `wallIndex=${blood.wallIndex}`,
      `nextId=${blood.nextId}`,
      `dingque=${dingque}`,
      `hu=${me?.hu ? 1 : 0}`,
    ].join('|');
  }

  private syncPracticeButtons(): void {
    const gameId = this.client.gameId();
    const blood = this.client.blood.get(0) as BloodState | null;
    const gb = this.client.gb.get(0) as GuobiaoState | null;
    const match = this.client.match.get(0) as any;
    const isGuobiaoGame = match?.conditions?.gameType === GameType.GUOBIAO;
    const roomType = String(match?.roomType ?? '').trim();
    const replayMode = !!this.replayControls;
    const key = this.currentPracticeClientKey();
    const localKey = gameId && key ? `${gameId}@@${key}` : null;
    const created = !!(key && (this.practiceKnownSnapshotKeys.has(key) || (!!localKey && this.practiceLocalCreatedKeys.has(localKey))));
    if (this.practiceQuickBtn) {
      this.practiceQuickBtn.disabled = replayMode || this.practiceBusy;
      const label = this.practiceQuickBtn.querySelector('.mj-hud-btn-label') as HTMLSpanElement | null;
      if (label) {
        label.textContent = replayMode ? '练习' : created ? '已创建' : (this.practiceBusy ? '创建中…' : '练习');
      }
    }
    if (this.practiceCreateBtn) {
      this.practiceCreateBtn.disabled = replayMode || this.practiceBusy;
      this.practiceCreateBtn.textContent = replayMode ? '创建练习分支' : created ? '当前节点已创建' : (this.practiceBusy ? '创建中…' : '创建练习分支');
    }
    if (this.settlementPracticeBtn) {
      const label =
        this.practiceBranchCount <= 0
          ? '查看练习分支'
          : this.practiceBranchCount === 1 && this.practiceEnterBranchId
            ? '进入练习分支'
            : `查看练习分支（${this.practiceBranchCount}）`;
      this.settlementPracticeBtn.textContent = label;
      this.settlementPracticeBtn.disabled = this.practiceBusy;
      this.settlementPracticeBtn.style.display = !isGuobiaoGame && this.practiceBranchCount > 0 ? '' : 'none';
    }
    if (this.settlementReplayBtn) {
      const paipuEnabledRoom = roomType === '' || roomType === 'newbie' || roomType === 'friend';
      const canOpen =
        !!gameId &&
        paipuEnabledRoom &&
        (isGuobiaoGame
          ? !!gb && (gb.phase === 'settling' || gb.phase === 'done')
          : !!blood && (blood.phase === 'settling' || blood.phase === 'done'));
      this.settlementReplayBtn.disabled = !canOpen;
      this.settlementReplayBtn.style.display = canOpen ? '' : 'none';
    }
  }

  private async refreshPracticeBranchSummary(): Promise<void> {
    const gameId = this.client.gameId();
    if (!gameId) {
      this.practiceBranchCount = 0;
      this.practiceEnterBranchId = null;
      this.practiceKnownSnapshotKeys.clear();
      this.syncPracticeButtons();
      return;
    }
    try {
      const out = await listPracticeBranches();
      const items = (Array.isArray(out?.items) ? out.items : []).filter((item) => item.sourceGameId === gameId);
      const currentKey = this.currentPracticeClientKey();
      this.practiceKnownSnapshotKeys = new Set(items.map((item) => item.snapshotKey));
      const currentLocalKey = currentKey ? `${gameId}@@${currentKey}` : null;
      if (currentKey && this.practiceKnownSnapshotKeys.has(currentKey) && currentLocalKey) {
        this.practiceLocalCreatedKeys.add(currentLocalKey);
      } else if (currentLocalKey) {
        this.practiceLocalCreatedKeys.delete(currentLocalKey);
      }
      this.practiceBranchCount = items.length;
      const enterable = items.filter((item) => item.status === 'ready' || item.status === 'active' || item.status === 'done');
      this.practiceEnterBranchId = enterable.length === 1 ? enterable[0]!.branchId : null;
      this.practiceNextSummaryRetryAt = 0;
      this.syncPracticeButtons();
    } catch {
      this.practiceLastSummaryGameId = null;
      this.practiceLastSummaryKey = null;
      this.practiceNextSummaryRetryAt = Date.now() + 1500;
    }
  }

  private requestPracticeBranchSummarySync(force: boolean = false): void {
    const gameId = this.client.gameId();
    const key = this.currentPracticeClientKey();
    if (!gameId) {
      this.practiceLastSummaryGameId = null;
      this.practiceLastSummaryKey = null;
      return;
    }
    if (!force && Date.now() < this.practiceNextSummaryRetryAt) return;
    if (!force && this.practiceSummaryLoading) return;
    if (!force && this.practiceLastSummaryGameId === gameId && this.practiceLastSummaryKey === key) {
      return;
    }
    this.practiceLastSummaryGameId = gameId;
    this.practiceLastSummaryKey = key;
    this.practiceSummaryLoading = true;
    void this.refreshPracticeBranchSummary().finally(() => {
      this.practiceSummaryLoading = false;
    });
  }

  private async onCreatePracticeBranch(): Promise<void> {
    if (this.practiceBusy) return;
    const gameId = this.client.gameId();
    if (!gameId) {
      this.ledgerTitle.textContent = '无法创建：未连接房间。';
      return;
    }
    const title = window.prompt('练习分支标题（可留空）', '');
    if (title === null) return;
    const note = window.prompt('练习分支备注（可留空）', '');
    if (note === null) return;
    this.practiceBusy = true;
    this.syncPracticeButtons();
    try {
      const out = await createPracticeBranch({ gameId, title, note });
      const key = this.currentPracticeClientKey();
      if (key) {
        this.practiceLocalCreatedKeys.add(`${gameId}@@${key}`);
      }
      this.ledgerTitle.textContent = out.created ? '练习分支已创建。' : '当前节点已创建练习分支。';
      await this.refreshPracticeBranchSummary();
    } catch (err: unknown) {
      this.ledgerTitle.textContent = `创建失败：${String((err as any)?.message ?? err)}`;
    } finally {
      this.practiceBusy = false;
      this.syncPracticeButtons();
    }
  }

  private async onOpenPracticeBranches(): Promise<void> {
    if (this.practiceBusy) return;
    this.practiceBusy = true;
    this.syncPracticeButtons();
    try {
      await this.refreshPracticeBranchSummary();
      if (this.practiceEnterBranchId) {
        const out = await enterPracticeBranch(this.practiceEnterBranchId);
        const basePath = getBasePath();
        window.location.href = `${basePath}hand/?gameId=${encodeURIComponent(out.gameId)}`;
        return;
      }
      const basePath = getBasePath();
      window.location.href = `${basePath}me/#practice`;
    } catch (err: unknown) {
      this.settlementTitle.textContent = `进入失败：${String((err as any)?.message ?? err)}`;
    } finally {
      this.practiceBusy = false;
      this.syncPracticeButtons();
    }
  }

  private onOpenReplayDetail(): void {
    const gameId = this.client.gameId();
    const blood = this.client.blood.get(0) as BloodState | null;
    const gb = this.client.gb.get(0) as GuobiaoState | null;
    const match = this.client.match.get(0) as any;
    const isGuobiaoGame = match?.conditions?.gameType === GameType.GUOBIAO;
    const roomType = String(match?.roomType ?? '').trim();
    const ended = isGuobiaoGame
      ? !!gb && (gb.phase === 'settling' || gb.phase === 'done')
      : !!blood && (blood.phase === 'settling' || blood.phase === 'done');
    if (!gameId || !ended) {
      this.settlementTitle.textContent = '当前牌局尚未结束，暂时无法查看牌谱。';
      return;
    }
    if (roomType !== '' && roomType !== 'newbie' && roomType !== 'friend') {
      this.settlementTitle.textContent = '当前房间暂不支持牌谱。';
      return;
    }
    const basePath = getBasePath();
    window.location.href = `${basePath}hand/?mode=paipu&gameId=${encodeURIComponent(gameId)}`;
  }

  private async onCreateShare(): Promise<void> {
    const gameId = this.client.gameId();
    const blood = this.client.blood.get(0) as BloodState | null;
    const gb = this.client.gb.get(0) as GuobiaoState | null;
    const match = this.client.match.get(0) as any;
    const isGuobiaoGame = match?.conditions?.gameType === GameType.GUOBIAO;
    const roomType = String(match?.roomType ?? '').trim();
    const replayMode = !!this.replayControls;
    if (!gameId) {
      this.ledgerTitle.textContent = '无法分享：未连接房间。';
      return;
    }
    if (roomType !== '' && roomType !== 'newbie' && roomType !== 'friend') {
      this.ledgerTitle.textContent = '当前房间暂不支持牌谱分享。';
      return;
    }
    if (this.replayControls && !this.replayControls.canShare) {
      this.ledgerTitle.textContent = '分享链接仅原牌谱拥有者可生成。';
      return;
    }
    const ended = isGuobiaoGame
      ? !!gb && (gb.phase === 'settling' || gb.phase === 'done')
      : !!blood && (blood.phase === 'settling' || blood.phase === 'done');
    if (!replayMode && !ended) {
      this.ledgerTitle.textContent = '牌局结束后才可分享牌谱。';
      return;
    }
    this.shareBtn.disabled = true;
    const prevText = this.shareBtn.textContent;
    this.shareBtn.textContent = '生成中…';
    try {
      const { shareId } = await createPaipuShare(gameId);
      const basePath = getBasePath();
      const sharePath = `${basePath}hand/?mode=paipu&share=${encodeURIComponent(shareId)}`;
      const shareUrl = new URL(sharePath, window.location.origin).toString();
      this.shareOutInput.value = shareUrl;
      this.shareOut.classList.remove('hidden');

      await copyText(shareUrl);
      this.shareBtn.textContent = '已复制';
    } catch (err: unknown) {
      const msg = String((err as any)?.message ?? err);
      this.shareBtn.textContent = '生成失败';
      this.ledgerTitle.textContent = `生成失败：${msg}`;
    } finally {
      window.setTimeout(() => (this.shareBtn.textContent = prevText), 900);
      this.shareBtn.disabled = false;
    }
  }

  private async onPlayAgain(): Promise<void> {
    if (this.playAgainBusy) return;
    const match = this.client.match.get(0) as any;
    if (String(match?.roomType ?? '') !== 'newbie') return;
    const isGuobiaoGame = match?.conditions?.gameType === GameType.GUOBIAO;

    this.playAgainBusy = true;
    this.playAgainBtn.disabled = true;
    const label = this.playAgainBtn.querySelector('.mj-hud-btn-label') as HTMLSpanElement | null;
    const prevText = label?.textContent ?? '再战';
    if (label) label.textContent = '创建中…';

    try {
      const { gameId } = isGuobiaoGame ? await guobiaoNewbieNew() : await newbieNew();
      const basePath = getBasePath();
      const variantParam = isGuobiaoGame ? '&variant=guobiao' : '';
      window.location.href = `${basePath}hand/?gameId=${encodeURIComponent(gameId)}&room=newbie${variantParam}`;
      return;
    } catch (err: unknown) {
      const msg = String((err as any)?.message ?? err);
      this.ledgerTitle.textContent = `再战失败：${msg}`;
    } finally {
      if (label) label.textContent = prevText;
      this.playAgainBtn.disabled = false;
      this.playAgainBusy = false;
    }
  }

  private collectSeatRailRects(
    seat: number,
    group: 'hand' | 'meld',
    viewport: { left: number; top: number; width: number; height: number },
    cameraOverride?: any,
  ): Array<RectPx> {
    const camera: any = cameraOverride ?? this.mainView.camera;
    const minX = viewport.left;
    const maxX = viewport.left + viewport.width;
    const minY = viewport.top;
    const maxY = viewport.top + viewport.height;

    const rects: Array<RectPx> = [];
    for (const slot of this.world.slots.values()) {
      if (slot.seat !== seat) continue;
      if (slot.group !== group) continue;
      // HUD 的“手牌轨道”不应被“摸入牌的 hand.extra”影响，否则会随 extra 出现/消失抖动。
      if (group === 'hand' && slot.name.startsWith('hand.extra')) continue;

      const place = slot.places[0];
      const hx = place.size.x * 0.5;
      const hy = place.size.y * 0.5;
      const hz = place.size.z * 0.5;
      const aabbMinX = place.position.x - hx;
      const aabbMaxX = place.position.x + hx;
      const aabbMinY = place.position.y - hy;
      const aabbMaxY = place.position.y + hy;
      const aabbMinZ = place.position.z - hz;
      const aabbMaxZ = place.position.z + hz;

      const ndc = projectAabbToNdc(aabbMinX, aabbMinY, aabbMinZ, aabbMaxX, aabbMaxY, aabbMaxZ, camera);
      if (!ndc) continue;

      let left = viewport.left + ((ndc.minX + 1) * 0.5) * viewport.width;
      let right = viewport.left + ((ndc.maxX + 1) * 0.5) * viewport.width;
      let top = viewport.top + ((1 - ndc.maxY) * 0.5) * viewport.height;
      let bottom = viewport.top + ((1 - ndc.minY) * 0.5) * viewport.height;

      if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
        continue;
      }
      if (left > right) [left, right] = [right, left];
      if (top > bottom) [top, bottom] = [bottom, top];

      // Clip to table viewport to avoid scissor-related false positives.
      left = Math.max(minX, Math.min(maxX, left));
      right = Math.max(minX, Math.min(maxX, right));
      top = Math.max(minY, Math.min(maxY, top));
      bottom = Math.max(minY, Math.min(maxY, bottom));
      if (right - left < 0.5 || bottom - top < 0.5) {
        continue;
      }

      rects.push({ left, top, right, bottom });
    }
    return rects;
  }

  private findRailX(
    tileRects: Array<RectPx>,
    bandTop: number,
    bandBottom: number,
    side: 'left' | 'right',
  ): number | null {
    const wantMin = side === 'left';
    let best = wantMin ? Infinity : -Infinity;
    let overlapped = false;

    for (const r of tileRects) {
      if (r.bottom <= bandTop || r.top >= bandBottom) continue;
      overlapped = true;
      best = wantMin ? Math.min(best, r.left) : Math.max(best, r.right);
    }
    if (overlapped && Number.isFinite(best)) {
      return best;
    }

    // 若该 y 段没有 tile，就用“最近的 tile（按 y 距离）”做 rail。
    const bandMid = (bandTop + bandBottom) * 0.5;
    let bestDist = Infinity;
    best = wantMin ? Infinity : -Infinity;
    for (const r of tileRects) {
      const mid = (r.top + r.bottom) * 0.5;
      const dist = Math.abs(mid - bandMid);
      if (dist >= bestDist) continue;
      bestDist = dist;
      best = wantMin ? r.left : r.right;
    }
    return Number.isFinite(best) ? best : null;
  }

  private computeHudOverlapShift(
    left: number,
    top: number,
    width: number,
    height: number,
    tileRects: Array<RectPx>,
    side: 'left' | 'right',
    boundsLeft: number,
    boundsRight: number,
  ): number {
    const right = left + width;
    const bottom = top + height;
    let needed = 0;

    for (const r of tileRects) {
      if (r.bottom <= top || r.top >= bottom) continue;
      if (r.right <= left || r.left >= right) continue;
      if (side === 'left') {
        needed = Math.max(needed, right - (r.left - HUD_OVERLAP_GAP_PX));
      } else {
        needed = Math.max(needed, (r.right + HUD_OVERLAP_GAP_PX) - left);
      }
    }
    if (needed <= 0) return 0;

    const maxShift =
      side === 'left'
        ? Math.min(HUD_OVERLAP_SHIFT_MAX_PX, left - boundsLeft)
        : Math.min(HUD_OVERLAP_SHIFT_MAX_PX, boundsRight - right);
    if (maxShift <= 0) return 0;

    const applied = Math.min(needed, maxShift);
    return side === 'left' ? -applied : applied;
  }

  private setRulesOpen(open: boolean): void {
    if (this.rulesOpen === open) {
      return;
    }
    this.rulesOpen = open;
    this.rulesBtn.classList.toggle('active', open);
    this.rulesBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.rulesLayer.classList.toggle('hidden', !open);

    if (open) {
      this.ensureRulesRenderedForCurrentGame();
      this.setSettingsOpen(false);
      this.setLedgerOpen(false);
      this.setSettlementOpen(false);
      this.setDebugFansOpen(false);
      if (this.teachEnabled) {
        this.teachEnabled = false;
        this.syncTeachBtn();
      }
      this.aiOverlay.setOpen(false);
    }
  }

  private setSettingsOpen(open: boolean): void {
    if (this.settingsOpen === open) {
      return;
    }
    this.settingsOpen = open;
    this.settingsBtn.classList.toggle('active', open);
    this.settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.settingsLayer.classList.toggle('hidden', !open);

    if (open) {
      this.syncSettingsPanel();
      this.setRulesOpen(false);
      this.setLedgerOpen(false);
      this.setSettlementOpen(false);
      this.setDebugFansOpen(false);
      if (this.teachEnabled) {
        this.teachEnabled = false;
        this.syncTeachBtn();
      }
      this.aiOverlay.setOpen(false);
    }
  }

  private guobiaoAutoBuhuaEnabled(): boolean {
    const seat = this.client.seat;
    const state = this.client.gb.get(0) as GuobiaoState | null;
    if (seat === null) {
      return readGuobiaoAutoBuhuaPreference();
    }
    if (!state) {
      const match = this.client.match.get(0) as any;
      const raw = match?.guobiaoConfig?.autoBuhuaBySeat ?? match?.gbConfig?.autoBuhuaBySeat ?? null;
      const fromMatch = raw?.[seat] ?? raw?.[String(seat)];
      if (typeof fromMatch === 'boolean') return fromMatch;
      return readGuobiaoAutoBuhuaPreference();
    }
    return state.autoBuhuaBySeat?.[seat] !== false;
  }

  private syncSettingsPanel(): void {
    const match = this.client.match.get(0) as any;
    const isGuobiaoGame = match?.conditions?.gameType === GameType.GUOBIAO;
    const enabled = this.guobiaoAutoBuhuaEnabled();
    this.autoBuhuaSwitch.classList.toggle('on', enabled);
    this.autoBuhuaSwitch.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    this.autoBuhuaSwitch.disabled = !isGuobiaoGame || this.client.seat === null;
    this.autoBuhuaStateText.textContent = enabled ? '开' : '关';
  }

  private toggleGuobiaoAutoBuhua(): void {
    const match = this.client.match.get(0) as any;
    if (match?.conditions?.gameType !== GameType.GUOBIAO || this.client.seat === null) {
      return;
    }
    const next = !this.guobiaoAutoBuhuaEnabled();
    writeGuobiaoAutoBuhuaPreference(next);
    const state = this.client.gb.get(0) as GuobiaoState | null;
    const gameId = this.client.gameId();
    if (state && state.phase === 'playing') {
      this.client.sendGbAction({ kind: 'setAutoBuhua', enabled: next });
    } else if (gameId) {
      this.client.setGuobiaoConfig({ gameId, config: { autoBuhua: next } });
    }
    this.autoBuhuaSwitch.disabled = true;
    window.setTimeout(() => this.syncSettingsPanel(), 220);
  }

  private currentRulesGameType(): GameType {
    const match = this.client.match.get(0) as any;
    return match?.conditions?.gameType === GameType.GUOBIAO ? GameType.GUOBIAO : GameType.BLOOD_BATTLE;
  }

  private ensureRulesRenderedForCurrentGame(): void {
    const gameType = this.currentRulesGameType();
    if (this.rulesRenderedGameType === gameType) {
      return;
    }

    this.rulesRenderedGameType = gameType;
    this.rulesFansRendered = false;
    this.rulesDisplayRendered = false;

    const isGuobiao = gameType === GameType.GUOBIAO;
    this.rulesTitle.textContent = isGuobiao ? '国标麻将规则' : '血战到底规则';
    this.rulesPanel.setAttribute('aria-label', isGuobiao ? '国标麻将规则' : '血战到底规则');

    const activeTab = this.rulesTabFansBtn.classList.contains('active')
      ? 'fans'
      : this.rulesTabDisplayBtn.classList.contains('active')
        ? 'display'
        : 'basic';
    this.renderRulesBasic();
    this.switchRulesTab(activeTab);
  }

  private switchRulesTab(tab: 'basic' | 'fans' | 'display'): void {
    const showBasic = tab === 'basic';
    const showFans = tab === 'fans';
    const showDisplay = tab === 'display';
    this.rulesTabBasicBtn.classList.toggle('active', showBasic);
    this.rulesTabFansBtn.classList.toggle('active', showFans);
    this.rulesTabDisplayBtn.classList.toggle('active', showDisplay);
    this.rulesBasicPane.classList.toggle('hidden', !showBasic);
    this.rulesFansPane.classList.toggle('hidden', !showFans);
    this.rulesDisplayPane.classList.toggle('hidden', !showDisplay);
    if (showFans && !this.rulesFansRendered) {
      this.renderRulesFans();
      this.rulesFansRendered = true;
    }
    if (showDisplay && !this.rulesDisplayRendered) {
      this.renderRulesDisplay();
      this.rulesDisplayRendered = true;
    }
  }

  private renderRulesBasic(): void {
    this.rulesBasicPane.innerHTML = '';
    const sections = this.currentRulesGameType() === GameType.GUOBIAO
      ? GUOBIAO_RULE_BASIC_SECTIONS
      : BLOOD_RULE_BASIC_SECTIONS;
    for (const section of sections) {
      const sec = document.createElement('section');
      sec.className = 'rules-basic-section';

      const title = document.createElement('h3');
      title.className = 'rules-basic-title';
      title.textContent = section.title;
      sec.appendChild(title);

      const list = document.createElement('ul');
      list.className = 'rules-basic-list';
      for (const line of section.lines) {
        const item = document.createElement('li');
        item.textContent = line;
        list.appendChild(item);
      }
      sec.appendChild(list);
      this.rulesBasicPane.appendChild(sec);
    }
  }

  private renderRulesFans(): void {
    this.rulesFansPane.innerHTML = '';
    const guides = this.currentRulesGameType() === GameType.GUOBIAO
      ? GUOBIAO_RULE_FAN_GUIDES
      : BLOOD_RULE_FAN_GUIDES;
    for (const guide of guides) {
      const card = document.createElement('section');
      card.className = 'rules-fan-card';

      const head = document.createElement('div');
      head.className = 'rules-fan-head';
      card.appendChild(head);

      const name = document.createElement('div');
      name.className = 'rules-fan-name';
      name.textContent = guide.name;
      const kind = document.createElement('span');
      kind.className = `rules-fan-kind rules-fan-kind-${guide.kind}`;
      const guideCode = 'code' in guide ? guide.code : '';
      kind.textContent = guide.kindLabel
        ? `（${guide.kindLabel}${guideCode ? ` ${guideCode}` : ''}）`
        : guide.kind === 'event'
          ? `（事件番${guide.code}）`
          : guide.kind === 'pattern'
            ? `（牌型番${guide.code}）`
            : '（加倍项）';
      name.appendChild(kind);
      head.appendChild(name);

      const mult = document.createElement('div');
      mult.className = 'rules-fan-mult';
      mult.textContent = guide.multiplier;
      head.appendChild(mult);

      const desc = document.createElement('div');
      desc.className = 'rules-fan-desc';
      desc.textContent = guide.desc;
      card.appendChild(desc);

      const tiles = document.createElement('div');
      tiles.className = 'rules-fan-tiles';
      for (const tile of guide.tiles) {
        const tileUrl = MAHJONG_TILE_URLS[tile];
        const img = document.createElement('img');
        img.className = 'rules-fan-tile';
        img.src = tileUrl;
        img.alt = tile;
        img.loading = 'lazy';
        img.decoding = 'async';
        tiles.appendChild(img);
      }
      card.appendChild(tiles);

      this.rulesFansPane.appendChild(card);
    }
  }

  private renderRulesDisplay(): void {
    this.rulesDisplayPane.innerHTML = '';
    const backRaw = Number.isFinite(this.world.conditions.back) ? Math.trunc(this.world.conditions.back) : 0;
    const back = backRaw === 1 ? 1 : 0;
    const sections = this.currentRulesGameType() === GameType.GUOBIAO
      ? GUOBIAO_RULE_DISPLAY_SECTIONS
      : BLOOD_RULE_DISPLAY_SECTIONS;
    for (const section of sections) {
      const sec = document.createElement('section');
      sec.className = 'rules-basic-section';

      const title = document.createElement('h3');
      title.className = 'rules-basic-title';
      title.textContent = section.title;
      sec.appendChild(title);

      const list = document.createElement('ul');
      list.className = 'rules-basic-list';
      for (const line of section.lines) {
        const item = document.createElement('li');
        item.textContent = line;
        list.appendChild(item);
      }
      sec.appendChild(list);

      const examples = document.createElement('div');
      examples.className = 'rules-display-examples';
      for (const ex of section.examples) {
        const row = document.createElement('div');
        row.className = 'rules-display-example';

        const label = document.createElement('div');
        label.className = 'rules-display-example-label';
        label.textContent = ex.label;
        row.appendChild(label);

        const tiles = document.createElement('div');
        tiles.className = 'rules-display-tiles';
        for (const t of ex.tiles) {
          const tileCode: MahjongTileCode = t.tile === 'back' ? (back === 1 ? 'back1' : 'back0') : t.tile;
          const tileUrl = MAHJONG_TILE_URLS[tileCode];
          const slot = document.createElement('div');
          slot.className = `rules-display-tile-slot${t.sideways ? ' is-sideways' : ''}`;
          const img = document.createElement('img');
          img.className = `rules-fan-tile${tileCode === 'back0' || tileCode === 'back1' ? ' is-back' : ''}`;
          img.src = tileUrl;
          img.alt = tileCode === 'back0' || tileCode === 'back1' ? '背面' : t.tile;
          img.loading = 'lazy';
          img.decoding = 'async';
          slot.appendChild(img);
          tiles.appendChild(slot);
        }
        row.appendChild(tiles);
        examples.appendChild(row);
      }
      sec.appendChild(examples);

      this.rulesDisplayPane.appendChild(sec);
    }
  }

  private setLedgerOpen(open: boolean): void {
    if (this.ledgerOpen === open) {
      return;
    }
    this.ledgerOpen = open;
    this.ledgerBtn.classList.toggle('active', open);
    this.ledgerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.ledgerBackdrop.classList.toggle('hidden', !open);
    this.ledgerPanel.classList.toggle('hidden', !open);
    if (open) {
      this.setRulesOpen(false);
      this.setSettingsOpen(false);
      this.setSettlementOpen(false);
      this.renderLedger();
    }
  }

  private renderLedger(): void {
    const viewerSeat = this.world.seat;
    const match = this.client.match.get(0) as any;
    const isGuobiaoGame = match?.conditions?.gameType === GameType.GUOBIAO;
    if (isGuobiaoGame) {
      this.renderGuobiaoLedger();
      return;
    }

    this.ledgerFooter.style.display = '';
    const blood = this.client.blood.get(0) as BloodState | null;
    if (viewerSeat === null || !blood) {
      this.ledgerTitle.textContent = '本局当前输赢豆：--';
      this.ledgerList.innerHTML = '';
      return;
    }

    const base = blood.endSummary?.base ?? blood.base ?? 400;
    const entries = (blood.ledger ?? []) as Array<BloodLedgerEntry>;
    const rows: Array<{ text: string; detail: string; mult: string; delta: number; opp: string }> = [];
    let net = 0;
    for (const entry of entries) {
      if (!entry || !Array.isArray(entry.transfers)) continue;
      const rawLabel = (entry.label ?? '').trim();
      const entryMult = Number.isFinite(entry.multiplier ?? NaN) ? Math.trunc(entry.multiplier as number) : 0;
      const huDetail = entry.kind === 'hu' ? formatFansBreakdown(entry) : '';
      const isHuZimo =
        entry.kind === 'hu' &&
        ((Array.isArray(entry.fans) && entry.fans.some((f) => String((f as any).id ?? '').trim() === 'zimo')) ||
          rawLabel.includes('自摸'));
      const huBaseVerb = entry.kind === 'hu' ? (isHuZimo ? '自摸' : '吃胡') : '';
      const kongBaseVerb = (() => {
        if (entry.kind !== 'kong') return '';
        if (rawLabel.includes('加杠')) return '加杠';
        if (rawLabel.includes('暗杠')) return '暗杠';
        if (rawLabel.includes('明杠')) return '明杠';
        if (entryMult === 1) return '加杠';
        if (entryMult === 2) {
          const trCount = entry.transfers.length;
          if (trCount === 1 && Number.isFinite(entry.seat ?? NaN)) return '暗杠';
          return trCount === 1 ? '明杠' : '暗杠';
        }
        if (rawLabel.includes('杠')) return '杠';
        return '杠';
      })();
      const fallbackLabel = rawLabel || (entry.kind === 'penalty' ? '惩罚/退税' : '流水');
      for (const tr of entry.transfers) {
        if (!tr) continue;
        const fromSeat = Math.trunc(tr.fromSeat as number);
        const toSeat = Math.trunc(tr.toSeat as number);
        const beans = Math.trunc(tr.beans as number);
        if (!Number.isFinite(fromSeat) || !Number.isFinite(toSeat) || !Number.isFinite(beans) || beans <= 0) continue;

        if (toSeat === viewerSeat) {
          const opp = relativeOpponentLabel(viewerSeat, fromSeat);
          const sign = '+';
          const mult = (() => {
            if (entry.kind === 'penalty') {
              if (entryMult > 0) return `${sign}${entryMult}倍`;
              if (base > 0 && beans % base === 0) return `${sign}${Math.trunc(beans / base)}倍`;
              return '';
            }
            if (entryMult > 0) return `${sign}${entryMult}倍`;
            return '';
          })();
          const action =
            entry.kind === 'hu' ? huBaseVerb :
            entry.kind === 'kong' ? kongBaseVerb :
            fallbackLabel;
          rows.push({ text: action, detail: entry.kind === 'hu' ? huDetail : '', mult, delta: beans, opp });
          net += beans;
        } else if (fromSeat === viewerSeat) {
          const opp = relativeOpponentLabel(viewerSeat, toSeat);
          const sign = '-';
          const mult = (() => {
            if (entry.kind === 'penalty') {
              if (entryMult > 0) return `${sign}${entryMult}倍`;
              if (base > 0 && beans % base === 0) return `${sign}${Math.trunc(beans / base)}倍`;
              return '';
            }
            if (entryMult > 0) return `${sign}${entryMult}倍`;
            return '';
          })();
          const action =
            entry.kind === 'hu' ? `被${huBaseVerb}` :
            entry.kind === 'kong' ? `被${kongBaseVerb}` :
            fallbackLabel;
          rows.push({ text: action, detail: entry.kind === 'hu' ? huDetail : '', mult, delta: -beans, opp });
          net -= beans;
        }
      }
    }

    this.ledgerTitle.textContent = `本局当前输赢豆：${formatSigned(net)}`;

    this.ledgerList.innerHTML = '';
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ledger-empty';
      empty.textContent = '暂无流水';
      this.ledgerList.appendChild(empty);
      return;
    }

    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'ledger-row';

      const desc = document.createElement('div');
      desc.className = 'ledger-desc';
      row.appendChild(desc);

      const descTitle = document.createElement('div');
      descTitle.className = 'ledger-desc-title';
      desc.appendChild(descTitle);

      const descMain = document.createElement('span');
      descMain.className = 'ledger-desc-title-main';
      descMain.textContent = r.text;
      descTitle.appendChild(descMain);

      if (r.detail) {
        const descDetail = document.createElement('span');
        descDetail.className = 'ledger-desc-title-detail';
        // Use WORD JOINER to avoid breaking between label and "（...）".
        descDetail.textContent = `\u2060${r.detail}`;
        descTitle.appendChild(descDetail);
      }

      const mult = document.createElement('div');
      mult.className = 'ledger-mult';
      mult.textContent = r.mult || '';
      row.appendChild(mult);

      const beans = document.createElement('div');
      beans.className = `ledger-beans ${r.delta >= 0 ? 'pos' : 'neg'}`;
      beans.textContent = formatSigned(r.delta);
      row.appendChild(beans);

      const opp = document.createElement('div');
      opp.className = 'ledger-opp';
      opp.textContent = r.opp;
      row.appendChild(opp);

      this.ledgerList.appendChild(row);
    }
  }

  private renderGuobiaoLedger(): void {
    this.ledgerFooter.style.display = 'none';
    const viewerSeat = this.world.seat;
    const gb = this.client.gb.get(0) as GuobiaoState | null;
    if (viewerSeat === null || !gb) {
      this.ledgerTitle.textContent = '本局当前输赢积分：--';
      this.ledgerList.innerHTML = '';
      return;
    }

    const entries = (gb.ledger ?? []) as Array<GuobiaoLedgerEntry>;
    const rows: Array<{ text: string; detail: string; mult: string; delta: number; opp: string }> = [];
    let net = 0;

    for (const entry of entries) {
      if (!entry || !Array.isArray(entry.transfers)) continue;
      const label = String(entry.label ?? '').trim();
      const detail =
        entry.kind === 'hu'
          ? formatGuobiaoFansBreakdown(entry)
          : entry.kind === 'wrongHu' && entry.note
            ? `（${entry.note}）`
            : '';

      for (const tr of entry.transfers) {
        if (!tr) continue;
        const fromSeat = Math.trunc(tr.fromSeat as number);
        const toSeat = Math.trunc(tr.toSeat as number);
        const ruleScore = Math.trunc(tr.ruleScore as number);
        const points = Math.trunc(tr.points as number);
        if (!Number.isFinite(fromSeat) || !Number.isFinite(toSeat) || !Number.isFinite(points) || points <= 0) continue;

        const delta = toSeat === viewerSeat ? points : fromSeat === viewerSeat ? -points : 0;
        if (delta === 0) continue;

        const oppSeat = toSeat === viewerSeat ? fromSeat : toSeat;
        const sign = delta >= 0 ? '+' : '-';
        const mult = Number.isFinite(ruleScore) && ruleScore > 0 ? `${sign}${ruleScore}分` : '';
        const text = (() => {
          if (entry.kind === 'wrongHu') {
            return delta >= 0 ? '获得错和赔付' : '错和处罚';
          }
          if (entry.kind === 'hu') {
            const huKind = label || (entry.fromSeat === null ? '自摸' : '点和');
            return delta >= 0 ? huKind : `被${huKind}`;
          }
          return label || '流水';
        })();

        rows.push({
          text,
          detail,
          mult,
          delta,
          opp: relativeOpponentLabel(viewerSeat, oppSeat),
        });
        net += delta;
      }
    }

    this.ledgerTitle.textContent = `本局当前输赢积分：${formatSigned(net)}`;
    this.ledgerList.innerHTML = '';
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ledger-empty';
      empty.textContent = entries.some((entry) => entry?.kind === 'draw') ? '荒牌无输赢' : '暂无流水';
      this.ledgerList.appendChild(empty);
      return;
    }

    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'ledger-row';

      const desc = document.createElement('div');
      desc.className = 'ledger-desc';
      row.appendChild(desc);

      const descTitle = document.createElement('div');
      descTitle.className = 'ledger-desc-title';
      desc.appendChild(descTitle);

      const descMain = document.createElement('span');
      descMain.className = 'ledger-desc-title-main';
      descMain.textContent = r.text;
      descTitle.appendChild(descMain);

      if (r.detail) {
        const descDetail = document.createElement('span');
        descDetail.className = 'ledger-desc-title-detail';
        descDetail.textContent = `\u2060${r.detail}`;
        descTitle.appendChild(descDetail);
      }

      const mult = document.createElement('div');
      mult.className = 'ledger-mult';
      mult.textContent = r.mult || '';
      row.appendChild(mult);

      const points = document.createElement('div');
      points.className = `ledger-beans ${r.delta >= 0 ? 'pos' : 'neg'}`;
      points.textContent = formatSigned(r.delta);
      row.appendChild(points);

      const opp = document.createElement('div');
      opp.className = 'ledger-opp';
      opp.textContent = r.opp;
      row.appendChild(opp);

      this.ledgerList.appendChild(row);
    }
  }

  private setSettlementOpen(open: boolean): void {
    if (this.settlementOpen === open) {
      return;
    }
    this.settlementOpen = open;
    this.settlementBtn.classList.toggle('active', open);
    this.settlementBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.settlementBackdrop.classList.toggle('hidden', !open);
    this.settlementPanel.classList.toggle('hidden', !open);
    if (open) {
      this.setRulesOpen(false);
      this.setSettingsOpen(false);
      this.setLedgerOpen(false);
      this.setSettlementExpandedSeat(null);
      this.renderSettlement();
      this.syncPracticeButtons();
      void this.refreshPracticeBranchSummary();
    }
  }

  private setSettlementExpandedSeat(seat: number | null): void {
    const next = seat === null ? null : Math.trunc(seat);
    if (next !== null && (next < 0 || next > 3)) return;
    const prev = this.settlementExpandedSeat;
    if (prev === next) return;
    this.settlementExpandedSeat = next;

    const collapse = (s: number): void => {
      const row = this.settlementOverviewRows.get(s) ?? null;
      const outer = this.settlementOverviewDetailOuters.get(s) ?? null;
      const btn = this.settlementOverviewDetailBtns.get(s) ?? null;
      if (row) row.classList.remove('expanded');
      if (btn) btn.textContent = '详情';

      if (outer) {
        const current = outer.offsetHeight;
        outer.style.height = `${Math.max(0, Math.round(current))}px`;
        // force reflow so transition can kick in
        void outer.offsetHeight;
        outer.classList.remove('expanded');
        outer.style.height = '0px';
      }
    };

    if (prev !== null) {
      collapse(prev);
    }

    if (next !== null) {
      const row = this.settlementOverviewRows.get(next) ?? null;
      const outer = this.settlementOverviewDetailOuters.get(next) ?? null;
      const inner = this.settlementOverviewDetailInners.get(next) ?? null;
      const btn = this.settlementOverviewDetailBtns.get(next) ?? null;
      if (btn) btn.textContent = '收起';
      if (row) row.classList.add('expanded');
      if (outer && inner) {
        // Ensure the element is ready for an opening animation.
        outer.classList.add('expanded');
        outer.style.height = '0px';
        this.renderSettlementDetailInto(next, inner);
        const target = Math.max(0, Math.round(inner.scrollHeight));
        const onEnd = (e: TransitionEvent): void => {
          if (e.propertyName !== 'height') return;
          outer.removeEventListener('transitionend', onEnd);
          if (this.settlementExpandedSeat === next && outer.classList.contains('expanded')) {
            outer.style.height = 'auto';
          }
        };
        outer.addEventListener('transitionend', onEnd);
        requestAnimationFrame(() => {
          outer.style.height = `${target}px`;
        });
        row?.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  private toggleSettlementExpandedSeat(seat: number): void {
    const s = Math.trunc(seat);
    if (s < 0 || s > 3) return;
    if (this.settlementExpandedSeat === s) {
      this.setSettlementExpandedSeat(null);
    } else {
      this.setSettlementExpandedSeat(s);
    }
  }

  private resolveInitialBeansBySeat(blood: BloodState): Record<number, number> {
    const legacy = Math.max(0, Math.trunc(blood.endSummary?.initialBeans ?? blood.initialBeans ?? 0));
    const out: Record<number, number> = {
      0: legacy,
      1: legacy,
      2: legacy,
      3: legacy,
    };
    const apply = (src: Record<number, number> | null | undefined): void => {
      if (!src || typeof src !== 'object') return;
      for (let seat = 0; seat < 4; seat++) {
        const raw = (src as any)[seat];
        if (!Number.isFinite(raw)) continue;
        out[seat] = Math.max(0, Math.trunc(raw));
      }
    };
    apply(blood.initialBeansBySeat ?? null);
    apply(blood.endSummary?.initialBeansBySeat ?? null);
    return out;
  }

  private buildSettlementRenderKey(blood: BloodState | null, gb?: GuobiaoState | null): string {
    if (gb) {
      const phase = String(gb.phase ?? '');
      const pointParts = [0, 1, 2, 3].map((s) => Math.trunc(gb.players?.[s]?.points ?? 0)).join(',');
      const initParts = [0, 1, 2, 3].map((s) => Math.trunc(gb.initialPointsBySeat?.[s] ?? 0)).join(',');
      const summary = gb.endSummary ?? null;
      const result = summary ? `${summary.kind}:${summary.winners.join(',')}:${summary.fromSeat ?? 'self'}:${summary.fanTotal}` : 'none';
      const ledger = (gb.ledger ?? []) as Array<GuobiaoLedgerEntry>;
      const tailAt = ledger.length > 0 ? Math.trunc((ledger[ledger.length - 1] as any)?.at ?? 0) : 0;
      return `gb|${phase}|i${initParts}|p${pointParts}|${result}|l${ledger.length}@${tailAt}`;
    }
    if (!blood) return 'no-blood';
    const initialBySeat = this.resolveInitialBeansBySeat(blood);
    const base = blood.endSummary?.base ?? blood.base ?? 400;
    const dealer = Math.trunc(blood.dealer ?? 0);
    const phase = String(blood.phase ?? '');
    const beanParts = [0, 1, 2, 3].map((s) => Math.trunc(blood.players?.[s]?.beans ?? 0)).join(',');
    const initParts = [0, 1, 2, 3].map((s) => initialBySeat[s] ?? 0).join(',');
    const ledger = (blood.ledger ?? []) as Array<BloodLedgerEntry>;
    const tailAt = ledger.length > 0 ? Math.trunc((ledger[ledger.length - 1] as any)?.at ?? 0) : 0;
    return `${phase}|d${dealer}|i${initParts}|b${Math.trunc(base)}|p${beanParts}|l${ledger.length}@${tailAt}`;
  }

  private settlementSeatDisplay(viewerSeat: number | null, seat: number): { name: string; avatar: string } {
    const playerId = this.client.seatPlayers[seat] ?? null;
    const nick = playerId ? (this.client.nicks.get(playerId) ?? null) : null;
    const avatarIndex = playerId ? (this.client.avatars.get(playerId) ?? null) : null;
    const avatar =
      avatarIndex !== null && Number.isInteger(avatarIndex)
        ? HUD_AVATARS[avatarIndex] ?? HUD_AVATARS[seat] ?? HUD_AVATARS[0]
        : HUD_AVATARS[seat] ?? HUD_AVATARS[0];
    const rel =
      viewerSeat !== null ? (seat === viewerSeat ? '自己' : relativeOpponentLabel(viewerSeat, seat)) : `玩家${seat + 1}`;
    const nameCore = (nick ?? '').trim() || `玩家${seat + 1}`;
    const name = viewerSeat !== null ? `${nameCore}（${rel}）` : nameCore;
    return { name, avatar };
  }

  private setDebugFansOpen(open: boolean): void {
    if (!this.debugFansEnabled || !this.debugFansBackdrop || !this.debugFansPanel) {
      return;
    }
    if (this.debugFansOpen === open) {
      return;
    }
    this.debugFansOpen = open;
    if (this.debugFansBtn) {
      this.debugFansBtn.classList.toggle('active', open);
      this.debugFansBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    this.debugFansBackdrop.classList.toggle('hidden', !open);
    this.debugFansPanel.classList.toggle('hidden', !open);
    if (open) {
      this.setRulesOpen(false);
      this.setSettingsOpen(false);
      this.setLedgerOpen(false);
      this.setSettlementOpen(false);
      this.setDebugFansStatus(null);
    }
  }

  private setDebugFansStatus(text: string | null): void {
    if (!this.debugFansStatus) {
      return;
    }
    const seat = this.world.seat;
    const modeHint = this.client.isAuthoritative() ? '（权威模式：不可用）' : seat !== 0 ? '（仅 seat0 可用）' : '';
    const base = '仅 seat0 且非权威模式可用；点击用例将布置牌面并自动触发。';
    this.debugFansStatus.textContent = text ? `${text} ${modeHint}`.trim() : `${base} ${modeHint}`.trim();
  }

  private runDebugFanCase(example: BloodFanExampleDef): void {
    if (!this.debugFansEnabled) {
      return;
    }
    if (this.client.isAuthoritative()) {
      this.setDebugFansStatus('无法运行：当前为服务端权威模式。');
      return;
    }
    const seat = this.world.seat;
    if (seat !== 0) {
      this.setDebugFansStatus('无法运行：仅 seat0 可操作对局状态。');
      return;
    }
    const blood = this.client.blood.get(0) as BloodState | null;
    if (!blood) {
      this.setDebugFansStatus('无法运行：未找到 blood 状态。');
      return;
    }

    let concealedAll: Array<number>;
    let melds: Array<{ kind: 'peng' | 'gang'; tileKey: number; gangType?: any }>;
    let script: BloodFanExampleDef['script'] | null = null;
    let scriptKongTileKey: number | null = null;
    let scriptWinTileKey: number | null = null;
    try {
      concealedAll = parseTilesNotation(example.concealed);
      melds = parseMeldsText(example.melds ?? '') as any;
      script = example.script ?? null;
      if (script) {
        const parseOne = (label: string, text: string): number => {
          const out = parseTilesNotation(text);
          if (out.length !== 1) {
            throw new Error(`${label} 必须是单张牌（例如 1m）`);
          }
          return out[0]!;
        };
        scriptKongTileKey = parseOne('杠牌', script.kongTile);
        scriptWinTileKey = parseOne('补张', script.winTile);
      }
    } catch (err: unknown) {
      const msg = String((err as any)?.message ?? err);
      this.setDebugFansStatus(`解析失败：${msg}`);
      return;
    }

    const meldCount = melds.length;
    const needTiles = (4 - meldCount) * 3 + 2;
    if (concealedAll.length !== needTiles) {
      this.setDebugFansStatus(`用例不合法：暗手张数=${concealedAll.length}，与 meldCount=${meldCount} 不匹配（需 ${needTiles}）。`);
      return;
    }

    const suitsUsed = new Set<BloodSuit>();
    for (const k of concealedAll) suitsUsed.add(suitOf(k));
    for (const m of melds) suitsUsed.add(suitOf(m.tileKey));
    const dingque = (['m', 'p', 's'] as const).find((s) => !suitsUsed.has(s)) ?? 'm';

    const huMethod = example.huMethod;
    const handTiles = concealedAll.slice(0, needTiles - 1);
    const winTileKey = concealedAll[needTiles - 1]!;

    const clearSlots = new Set<string>();
    for (let i = 0; i < 14; i++) {
      clearSlots.add(`hand.${i}@0`);
    }
    clearSlots.add('hand.extra@0');
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        clearSlots.add(`meld.${r}.${c}@0`);
      }
    }
    for (let i = 0; i < 16; i++) {
      clearSlots.add(`hu.taken.${i}`);
    }

    const occupiedSlotsAll = new Set<string>();
    for (const [, info] of this.client.things.entries()) {
      if (info) occupiedSlotsAll.add(info.slotName);
    }

    const tileSlotById = new Map<number, string>();
    const tileKeyById = new Map<number, number>();
    const slotToTileId = new Map<string, number>();
    const tileIdsByKey = new Map<number, Array<number>>();
    for (const t of this.world.things.values()) {
      if (t.type !== ThingType.TILE) continue;
      const info = this.client.things.get(t.index);
      if (!info) continue;
      const k = tileKeyFromTypeIndex(t.typeIndex);
      if (k === null) continue;
      tileSlotById.set(t.index, info.slotName);
      tileKeyById.set(t.index, k);
      slotToTileId.set(info.slotName, t.index);
      const arr = tileIdsByKey.get(k);
      if (arr) arr.push(t.index);
      else tileIdsByKey.set(k, [t.index]);
    }
    for (const [, arr] of tileIdsByKey.entries()) {
      arr.sort((a, b) => a - b);
    }

    const takeTileId = (tileKey: number): number => {
      const arr = tileIdsByKey.get(tileKey) ?? [];
      if (arr.length === 0) {
        throw new Error(`缺少牌：tileKey=${tileKey}`);
      }
      let idx = -1;
      for (let i = 0; i < arr.length; i++) {
        const id = arr[i]!;
        const slotName = tileSlotById.get(id) ?? '';
        if (!clearSlots.has(slotName)) {
          idx = i;
          break;
        }
      }
      if (idx < 0) idx = 0;
      const [id] = arr.splice(idx, 1);
      if (id === undefined) {
        throw new Error(`缺少牌：tileKey=${tileKey}`);
      }
      return id;
    };

    const desired: Array<{ tileId: number; slotName: string; rotationIndex: number; tileKey: number }> = [];
    const useHandSlots = handTiles.length;
    for (let i = 0; i < useHandSlots; i++) {
      const tileKey = handTiles[i]!;
      desired.push({ tileId: takeTileId(tileKey), tileKey, slotName: `hand.${i}@0`, rotationIndex: 0 });
    }

    let pendingTileId: number | null = null;
    const fromSeat = 1;
    if (huMethod === 'zimo') {
      pendingTileId = takeTileId(winTileKey);
      desired.push({ tileId: pendingTileId, tileKey: winTileKey, slotName: 'hand.extra@0', rotationIndex: 0 });
    } else {
      pendingTileId = takeTileId(winTileKey);
      desired.push({ tileId: pendingTileId, tileKey: winTileKey, slotName: `discard.0.0@${fromSeat}`, rotationIndex: 0 });
    }

    for (let row = 0; row < melds.length && row < 4; row++) {
      const m = melds[row]!;
      const n = m.kind === 'peng' ? 3 : 4;
      for (let c = 0; c < n; c++) {
        const tileId = takeTileId(m.tileKey);
        desired.push({ tileId, tileKey: m.tileKey, slotName: `meld.${row}.${c}@0`, rotationIndex: 0 });
      }
    }

    // debugFans 脚本：需要固定补张（放回牌墙并确保 wallOrder 首张为该牌）
    let scriptDrawTileId: number | null = null;
    if (script && script.kind === 'gangShangKaiHua' && scriptWinTileKey !== null) {
      const wallSlot = (() => {
        for (const [, info] of this.client.things.entries()) {
          if (!info) continue;
          if (info.slotName.startsWith('wall.')) return info.slotName;
        }
        return null;
      })();
      if (!wallSlot) {
        this.setDebugFansStatus('无法运行：未找到牌墙位置（wall.*）。');
        return;
      }
      try {
        scriptDrawTileId = takeTileId(scriptWinTileKey);
      } catch (err: unknown) {
        const msg = String((err as any)?.message ?? err);
        this.setDebugFansStatus(`无法运行：固定补张失败（${msg}）。`);
        return;
      }
      // 放到牌墙中（保持背面朝上），供后续“杠后补张”摸到
      desired.push({ tileId: scriptDrawTileId, tileKey: scriptWinTileKey, slotName: wallSlot, rotationIndex: 2 });
    }

    const targetSlots = new Set<string>(desired.map((d) => d.slotName));
    const desiredIds = new Set<number>(desired.map((d) => d.tileId));
    const desiredBySlot = new Map<string, number>();
    for (const d of desired) desiredBySlot.set(d.slotName, d.tileId);

    const slotsToVacate = new Set<string>(clearSlots);
    for (const s of targetSlots) slotsToVacate.add(s);

    const displaced: Array<number> = [];
    for (const slotName of slotsToVacate) {
      const occupant = slotToTileId.get(slotName);
      if (occupant === undefined) continue;
      const want = desiredBySlot.get(slotName) ?? null;
      if (want !== null && want === occupant) continue;
      if (desiredIds.has(occupant)) continue;
      displaced.push(occupant);
    }

    const availableSlots: Array<string> = [];
    for (const d of desired) {
      const cur = tileSlotById.get(d.tileId) ?? null;
      if (!cur) continue;
      if (slotsToVacate.has(cur)) continue;
      if (targetSlots.has(cur)) continue;
      if (availableSlots.includes(cur)) continue;
      availableSlots.push(cur);
    }
    for (const slot of this.world.slots.values()) {
      if (slot.type !== ThingType.TILE) continue;
      const name = slot.name;
      if (occupiedSlotsAll.has(name)) continue;
      if (slotsToVacate.has(name)) continue;
      if (targetSlots.has(name)) continue;
      availableSlots.push(name);
    }

    const availDedup: Array<string> = [];
    const availSeen = new Set<string>();
    for (const s of availableSlots) {
      if (availSeen.has(s)) continue;
      availSeen.add(s);
      availDedup.push(s);
    }

    if (availDedup.length < displaced.length) {
      this.setDebugFansStatus(`无法布置：可用空槽不足（需要 ${displaced.length}，仅 ${availDedup.length}）。`);
      return;
    }

    const thingUpdates = new Map<number, any>();
    for (let i = 0; i < displaced.length; i++) {
      const tileId = displaced[i]!;
      const info = this.client.things.get(tileId);
      if (!info) continue;
      thingUpdates.set(tileId, { ...info, slotName: availDedup[i]!, rotationIndex: 0, claimedBy: null, shiftSlotName: null });
    }
    for (const d of desired) {
      const info = this.client.things.get(d.tileId);
      if (!info) continue;
      thingUpdates.set(d.tileId, { ...info, slotName: d.slotName, rotationIndex: d.rotationIndex, claimedBy: null, shiftSlotName: null });
    }

    const startBeans = this.resolveInitialBeansBySeat(blood)[0] ?? 0;
    const nextPlayers = { ...blood.players };
    for (let s = 0; s < 4; s++) {
      const ps = nextPlayers[s];
      if (!ps) continue;
      nextPlayers[s] = {
        ...ps,
        beans: startBeans,
        kongGain: 0,
        hu: false,
        huTileKey: null,
        huSource: null,
        melds: [],
        dingque: ps.dingque ?? 'm',
      };
    }

    nextPlayers[0] = {
      ...nextPlayers[0],
      dingque,
      melds: melds.slice(0, 4).map((m, row) => ({
        kind: m.kind,
        tileKey: m.tileKey,
        fromSeat: null,
        gangType: m.gangType,
        row,
      })),
    };

    if (huMethod === 'zimo') {
      const desiredOpponents = typeof example.remainingOpponents === 'number' ? Math.trunc(example.remainingOpponents) : 3;
      const remainingOpponents = Math.max(1, Math.min(3, desiredOpponents));
      const needPreHu = 3 - remainingOpponents;
      const candidates = [3, 2, 1];
      for (let i = 0; i < needPreHu; i++) {
        const s = candidates[i];
        const ps = nextPlayers[s];
        if (!ps) continue;
        nextPlayers[s] = { ...ps, hu: true, huTileKey: null, huSource: null };
      }
    }

    const now = Date.now();
    const pending =
      huMethod === 'dianpao' && pendingTileId !== null
        ? {
          kind: 'claim' as const,
          id: Math.max(1, blood.nextId ?? 1),
          since: now,
          trigger: example.events?.qiangGangHu ? ('addKong' as const) : ('discard' as const),
          afterGang: Boolean(example.events?.gangShangPao),
          fromSeat,
          tileId: pendingTileId,
          tileKey: winTileKey,
          options: {
            0: { hu: true, peng: false, gang: false },
            1: { hu: false, peng: false, gang: false },
            2: { hu: false, peng: false, gang: false },
            3: { hu: false, peng: false, gang: false },
          },
          responses: { 0: 'hu' as const, 1: null, 2: null, 3: null },
        }
        : null;

    const nextId = pending ? pending.id + 1 : Math.max(1, blood.nextId ?? 1);
    const afterGangSeat = null;
    const buildWallOrder = (): Array<number> => {
      const wallTiles: Array<{ tileId: number; seat: number; col: number; stack: number }> = [];
      for (const [tileId, info] of this.client.things.entries()) {
        if (!info) continue;
        const m = /^wall\.(\d+)\.(\d+)@(\d)$/.exec(info.slotName);
        if (!m) continue;
        wallTiles.push({
          tileId,
          col: parseInt(m[1]!, 10),
          stack: parseInt(m[2]!, 10),
          seat: parseInt(m[3]!, 10),
        });
      }
      wallTiles.sort((a, b) => (a.seat - b.seat) || (a.col - b.col) || (b.stack - a.stack));
      return wallTiles.map((t) => t.tileId);
    };
    const wallOrderRaw = blood.wallOrder ?? [];
    let wallOrder = wallOrderRaw.length > 0 ? wallOrderRaw : buildWallOrder();
    let wallIndex = huMethod === 'zimo' && example.events?.haiDi ? wallOrder.length : Math.max(0, blood.wallIndex ?? 0);
    if (script && script.kind === 'gangShangKaiHua' && scriptDrawTileId !== null) {
      // 用例希望“补张固定摸到 winTile”：把该 tileId 放到 wallOrder 首位，并重置 wallIndex=0
      wallIndex = 0;
      wallOrder = [scriptDrawTileId, ...wallOrder.filter((x) => x !== scriptDrawTileId)];
    }

    const nextBlood: BloodState = {
      ...blood,
      phase: 'playing',
      swap3: null,
      revealAllHands: false,
      settlingSince: null,
      endSummary: undefined,
      ledger: [],
      players: nextPlayers,
      pending,
      afterGangSeat,
      wallOrder,
      wallIndex,
      turnSeat: huMethod === 'zimo' ? 0 : fromSeat,
      turnStep: huMethod === 'zimo' ? 'discard' : 'discard',
      nextId,
    };

    this.setDebugFansStatus(`运行中：${example.title}`);
    this.debugFansScript = null;
    this.debugFansAwaitHu = null;
    if (script && script.kind === 'gangShangKaiHua' && scriptKongTileKey !== null && scriptWinTileKey !== null) {
      this.debugFansScript = {
        kind: 'gangShangKaiHua',
        title: example.title,
        startedAt: now,
        step: 'kong',
        kong: { gangType: script.gangType, tileKey: scriptKongTileKey },
        winTileKey: scriptWinTileKey,
      };
    } else {
      this.debugFansAwaitHu = { since: now, title: example.title };
    }

    this.client.transaction(() => {
      for (const [tileId, info] of thingUpdates.entries()) {
        this.client.things.set(tileId, info);
      }
      this.client.blood.set(0, nextBlood);
      if (huMethod === 'zimo' && !this.debugFansScript) {
        this.client.sendBloodAction({ kind: 'hu', source: 'self' });
      }
    });
  }

  private renderSettlement(): void {
    const blood = this.client.blood.get(0) as BloodState | null;
    const gb = this.client.gb.get(0) as GuobiaoState | null;
    const match = this.client.match.get(0) as any;
    if (match?.conditions?.gameType === GameType.GUOBIAO && gb) {
      this.renderGuobiaoSettlement(gb);
      return;
    }
    const viewerSeat = this.world.seat;
    if (!blood) {
      this.settlementTitle.textContent = '结算明细';
      this.settlementBody.innerHTML = '<div class="settle-empty">暂无结算数据</div>';
      return;
    }

    const prevExpandedSeat = this.settlementExpandedSeat;
    this.settlementRenderKey = this.buildSettlementRenderKey(blood, null);
    const initialBySeat = this.resolveInitialBeansBySeat(blood);
    const base = blood.endSummary?.base ?? blood.base ?? 400;
    const endSeats = blood.endSummary?.seats ?? null;

    const windRank = (seat: number): number => (seat - Math.trunc(blood.dealer ?? 0) + 4) % 4;
    const ledger = (blood.ledger ?? []) as Array<BloodLedgerEntry>;
    const huEntries = ledger.filter((e) => e && e.kind === 'hu') as Array<BloodLedgerEntry>;
    const kongEntries = ledger.filter((e) => e && e.kind === 'kong') as Array<BloodLedgerEntry>;

    const winnerSeatOfHu = (e: BloodLedgerEntry): number | null => {
      if (typeof e.seat === 'number' && Number.isFinite(e.seat)) return Math.trunc(e.seat);
      const tr = e.transfers?.[0] ?? null;
      if (tr && typeof tr.toSeat === 'number' && Number.isFinite(tr.toSeat)) return Math.trunc(tr.toSeat);
      return null;
    };

    const huSorted = huEntries
      .map((e) => ({ entry: e, seat: winnerSeatOfHu(e) }))
      .filter((x) => x.seat !== null)
      .sort((a, b) => (Math.trunc(a.entry.at ?? 0) - Math.trunc(b.entry.at ?? 0)) || (a.seat! - b.seat!));

    const huInfoBySeat = new Map<number, { order: number; entry: BloodLedgerEntry }>();
    for (let i = 0; i < huSorted.length; i++) {
      const seat = huSorted[i]!.seat!;
      if (!huInfoBySeat.has(seat)) {
        huInfoBySeat.set(seat, { order: i + 1, entry: huSorted[i]!.entry });
      }
    }

    const kongNetBySeat: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (const entry of kongEntries) {
      for (const tr of entry.transfers ?? []) {
        if (!tr) continue;
        const from = Math.trunc(tr.fromSeat as number);
        const to = Math.trunc(tr.toSeat as number);
        const beans = Math.trunc(tr.beans as number);
        if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(beans) || beans <= 0) continue;
        if (kongNetBySeat[to] !== undefined) kongNetBySeat[to] += beans;
        if (kongNetBySeat[from] !== undefined) kongNetBySeat[from] -= beans;
      }
    }

    const summaryText = (seat: number): string => {
      const ps = blood.players?.[seat] ?? null;
      if (!ps) return '--';

      const huInfo = huInfoBySeat.get(seat) ?? null;
      if (huInfo) {
        const m = Math.trunc(huInfo.entry.multiplier ?? 0);
        const method = (huInfo.entry.label ?? '').trim() === '自摸' ? '自摸' : '吃胡';
        return `第${huInfo.order}胡 ${method}${m > 0 ? ` ×${m}倍` : ''}`.trim();
      }

      const kongNet = kongNetBySeat[seat] ?? 0;
      if (kongNet !== 0) {
        return `杠净额 ${formatSigned(kongNet)}`;
      }

      const summary = endSeats ? (endSeats as any)[seat] ?? null : null;
      if (summary?.isPig) return '未胡牌 · 花猪';
      if (summary?.ting) return '未胡牌 · 听牌';
      if (summary && !summary.isPig && !summary.ting) return '未胡牌 · 未听';
      return '未胡牌';
    };

    const seats = [0, 1, 2, 3].filter((s) => blood.players?.[s] != null);
    const deltaBySeat = new Map<number, number>();
    for (const seat of seats) {
      const ps = blood.players?.[seat] ?? null;
      const finalBeans = ps ? Math.trunc(ps.beans ?? 0) : 0;
      const startBeans = initialBySeat[seat] ?? 0;
      deltaBySeat.set(seat, finalBeans - startBeans);
    }

    const sortedSeats = seats.slice().sort((a, b) => {
      if (viewerSeat !== null) {
        if (a === viewerSeat) return -1;
        if (b === viewerSeat) return 1;
      }
      const da = deltaBySeat.get(a) ?? 0;
      const db = deltaBySeat.get(b) ?? 0;
      if (db !== da) return db - da;
      return windRank(a) - windRank(b);
    });

    this.settlementTitle.textContent = `本局结算（底分${base}）`;
    this.settlementBody.innerHTML = '';
    this.settlementOverviewRows.clear();
    this.settlementOverviewDetailOuters.clear();
    this.settlementOverviewDetailInners.clear();
    this.settlementOverviewDetailBtns.clear();

    const meta = document.createElement('div');
    meta.className = 'settle-meta';
    const initValues = [0, 1, 2, 3].map((s) => initialBySeat[s] ?? 0);
    const sameStart = initValues.every((v) => v === initValues[0]);
    const startText = sameStart ? `${initValues[0]}` : '按玩家对局积分';
    meta.textContent = `开局豆：${startText} · 庄家：${this.settlementSeatDisplay(viewerSeat, blood.dealer ?? 0).name} · 阶段：${blood.phase === 'settling' ? '亮牌' : blood.phase
      }`;
    this.settlementBody.appendChild(meta);

    const overview = document.createElement('div');
    overview.className = 'settle-overview';
    this.settlementBody.appendChild(overview);

    for (const seat of sortedSeats) {
      const ps = blood.players?.[seat] ?? null;
      if (!ps) continue;
      const { name, avatar } = this.settlementSeatDisplay(viewerSeat, seat);
      const delta = deltaBySeat.get(seat) ?? 0;

      const item = document.createElement('div');
      const isSelf = viewerSeat !== null && seat === viewerSeat;
      item.className = `settle-item${isSelf ? ' self' : ''}`;
      overview.appendChild(item);

      const row = document.createElement('div');
      row.className = `settle-row${isSelf ? ' self' : ''}`;
      item.appendChild(row);

      const left = document.createElement('div');
      left.className = 'settle-row-left';
      row.appendChild(left);

      const av = document.createElement('img');
      av.className = 'settle-avatar';
      av.alt = '';
      av.draggable = false;
      av.src = avatar;
      left.appendChild(av);

      const main = document.createElement('div');
      main.className = 'settle-row-main';
      left.appendChild(main);

      const title = document.createElement('div');
      title.className = 'settle-row-name';
      title.textContent = name;
      main.appendChild(title);

      const sub = document.createElement('div');
      sub.className = 'settle-row-sub';
      sub.textContent = summaryText(seat);
      main.appendChild(sub);

      const right = document.createElement('div');
      right.className = 'settle-row-right';
      row.appendChild(right);

      const score = document.createElement('div');
      score.className = `settle-row-score ${delta >= 0 ? 'pos' : 'neg'}`;
      score.textContent = formatSigned(delta);
      right.appendChild(score);

      const detail = document.createElement('button');
      detail.type = 'button';
      detail.className = 'settle-row-detail';
      detail.textContent = '详情';
      detail.onclick = () => this.toggleSettlementExpandedSeat(seat);
      right.appendChild(detail);

      const detailsOuter = document.createElement('div');
      detailsOuter.className = 'settle-row-details';
      detailsOuter.style.height = '0px';
      item.appendChild(detailsOuter);

      const detailsInner = document.createElement('div');
      detailsInner.className = 'settle-row-details-inner';
      detailsOuter.appendChild(detailsInner);

      this.settlementOverviewRows.set(seat, row);
      this.settlementOverviewDetailOuters.set(seat, detailsOuter);
      this.settlementOverviewDetailInners.set(seat, detailsInner);
      this.settlementOverviewDetailBtns.set(seat, detail);
    }

    if (prevExpandedSeat !== null) {
      // 由于 renderSettlement 会重建 DOM，这里强制重新应用展开状态。
      this.settlementExpandedSeat = null;
      this.setSettlementExpandedSeat(prevExpandedSeat);
    }
  }

  private renderGuobiaoSettlement(gb: GuobiaoState): void {
    const viewerSeat = this.world.seat;
    const prevExpandedSeat = this.settlementExpandedSeat;
    this.settlementRenderKey = this.buildSettlementRenderKey(null, gb);
    const summary = gb.endSummary ?? null;
    const base = Math.trunc(gb.baseRuleScore ?? 8);
    const scale = Math.trunc(gb.pointsScale ?? 100);

    const resultText = (() => {
      if (!summary) return gb.phase === 'settling' ? '亮牌中' : '已结束';
      if (summary.kind === 'draw') return '荒牌';
      return summary.fromSeat === null ? '自摸' : '点和';
    })();

    const seats = [0, 1, 2, 3].filter((s) => gb.players?.[s] != null);
    const deltaBySeat = new Map<number, number>();
    const ruleDeltaBySeat = new Map<number, number>();
    for (const seat of seats) {
      const ps = gb.players?.[seat] ?? null;
      const finalPoints = ps ? Math.trunc(ps.points ?? 0) : 0;
      const startPoints = Math.trunc(gb.initialPointsBySeat?.[seat] ?? 0);
      const summaryDelta = summary?.pointsDeltaBySeat?.[seat];
      const summaryRuleDelta = summary?.ruleScoreDeltaBySeat?.[seat];
      deltaBySeat.set(seat, Number.isFinite(summaryDelta) ? Math.trunc(summaryDelta as number) : finalPoints - startPoints);
      ruleDeltaBySeat.set(seat, Number.isFinite(summaryRuleDelta) ? Math.trunc(summaryRuleDelta as number) : Math.trunc(ps?.ruleScore ?? 0));
    }

    const summaryText = (seat: number): string => {
      const ps = gb.players?.[seat] ?? null;
      if (!ps) return '--';
      const ruleText = `规则分 ${formatSigned(ruleDeltaBySeat.get(seat) ?? 0)}`;
      if (ps.wrongHu) return `错和 · ${ruleText}`;
      if (summary?.kind === 'hu' && summary.winners.includes(seat)) {
        const fan = Math.trunc(summary.fanTotal ?? 0);
        const method = summary.fromSeat === null ? '自摸' : '点和';
        return `${method}${fan > 0 ? ` ${fan}番` : ''} · ${ruleText}`;
      }
      if (summary?.kind === 'draw') return `荒牌 · ${ruleText}`;
      const delta = deltaBySeat.get(seat) ?? 0;
      return `${delta === 0 ? '未胡牌' : '未胡牌 · 有结算'} · ${ruleText}`;
    };

    const sortedSeats = seats.slice().sort((a, b) => {
      if (viewerSeat !== null) {
        if (a === viewerSeat) return -1;
        if (b === viewerSeat) return 1;
      }
      const da = deltaBySeat.get(a) ?? 0;
      const db = deltaBySeat.get(b) ?? 0;
      if (db !== da) return db - da;
      return a - b;
    });

    this.settlementTitle.textContent = `国标结算（底分${base}）`;
    this.settlementBody.innerHTML = '';
    this.settlementOverviewRows.clear();
    this.settlementOverviewDetailOuters.clear();
    this.settlementOverviewDetailInners.clear();
    this.settlementOverviewDetailBtns.clear();

    const meta = document.createElement('div');
    meta.className = 'settle-meta';
    const initValues = [0, 1, 2, 3].map((s) => Math.trunc(gb.initialPointsBySeat?.[s] ?? 0));
    const sameStart = initValues.every((v) => v === initValues[0]);
    const startText = sameStart ? `${initValues[0]}` : '按玩家对局积分';
    meta.textContent = `开局积分：${startText} · 积分倍率：×${scale} · 结果：${resultText}`;
    this.settlementBody.appendChild(meta);

    const overview = document.createElement('div');
    overview.className = 'settle-overview';
    this.settlementBody.appendChild(overview);

    for (const seat of sortedSeats) {
      const ps = gb.players?.[seat] ?? null;
      if (!ps) continue;
      const { name, avatar } = this.settlementSeatDisplay(viewerSeat, seat);
      const delta = deltaBySeat.get(seat) ?? 0;
      const isSelf = viewerSeat !== null && seat === viewerSeat;

      const item = document.createElement('div');
      item.className = `settle-item${isSelf ? ' self' : ''}`;
      overview.appendChild(item);

      const row = document.createElement('div');
      row.className = `settle-row${isSelf ? ' self' : ''}`;
      item.appendChild(row);

      const left = document.createElement('div');
      left.className = 'settle-row-left';
      row.appendChild(left);

      const av = document.createElement('img');
      av.className = 'settle-avatar';
      av.alt = '';
      av.draggable = false;
      av.src = avatar;
      left.appendChild(av);

      const main = document.createElement('div');
      main.className = 'settle-row-main';
      left.appendChild(main);

      const title = document.createElement('div');
      title.className = 'settle-row-name';
      title.textContent = name;
      main.appendChild(title);

      const sub = document.createElement('div');
      sub.className = 'settle-row-sub';
      sub.textContent = summaryText(seat);
      main.appendChild(sub);

      const right = document.createElement('div');
      right.className = 'settle-row-right';
      row.appendChild(right);

      const score = document.createElement('div');
      score.className = `settle-row-score ${delta >= 0 ? 'pos' : 'neg'}`;
      score.textContent = formatSigned(delta);
      right.appendChild(score);

      const detail = document.createElement('button');
      detail.type = 'button';
      detail.className = 'settle-row-detail';
      detail.textContent = '详情';
      detail.onclick = () => this.toggleSettlementExpandedSeat(seat);
      right.appendChild(detail);

      const detailsOuter = document.createElement('div');
      detailsOuter.className = 'settle-row-details';
      detailsOuter.style.height = '0px';
      item.appendChild(detailsOuter);

      const detailsInner = document.createElement('div');
      detailsInner.className = 'settle-row-details-inner';
      detailsOuter.appendChild(detailsInner);

      this.settlementOverviewRows.set(seat, row);
      this.settlementOverviewDetailOuters.set(seat, detailsOuter);
      this.settlementOverviewDetailInners.set(seat, detailsInner);
      this.settlementOverviewDetailBtns.set(seat, detail);
    }

    if (prevExpandedSeat !== null) {
      this.settlementExpandedSeat = null;
      this.setSettlementExpandedSeat(prevExpandedSeat);
    }
  }

  private renderSettlementDetailInto(seat: number, root: HTMLDivElement): void {
    const viewerSeat = this.world.seat;
    const match = this.client.match.get(0) as any;
    const gb = this.client.gb.get(0) as GuobiaoState | null;
    if (match?.conditions?.gameType === GameType.GUOBIAO && gb) {
      this.renderGuobiaoSettlementDetailInto(gb, seat, root);
      return;
    }
    const blood = this.client.blood.get(0) as BloodState | null;
    if (!blood) {
      root.innerHTML = '<div class="settle-empty">暂无结算数据</div>';
      return;
    }

    const initialBeans = this.resolveInitialBeansBySeat(blood)[seat] ?? 0;
    const base = blood.endSummary?.base ?? blood.base ?? 400;
    const ps = blood.players?.[seat] ?? null;
    const finalBeans = ps ? Math.trunc(ps.beans ?? 0) : 0;
    const total = finalBeans - initialBeans;

    root.innerHTML = '';
    const meta = document.createElement('div');
    meta.className = 'settle-detail-meta';
    root.appendChild(meta);

    const metaLeft = document.createElement('div');
    metaLeft.className = 'settle-detail-meta-item';
    metaLeft.innerHTML = `<div class="settle-detail-meta-label">底分</div><div class="settle-detail-meta-value">${formatScore(
      base,
    )}</div>`;
    meta.appendChild(metaLeft);

    const metaRight = document.createElement('div');
    metaRight.className = 'settle-detail-meta-item';
    metaRight.innerHTML = `<div class="settle-detail-meta-label">总输赢</div><div class="settle-detail-meta-value ${total >= 0 ? 'pos' : 'neg'
      }">${formatSigned(total)}</div>`;
    meta.appendChild(metaRight);

    const list = document.createElement('div');
    list.className = 'settle-detail-list';
    root.appendChild(list);

    const ledger = (blood.ledger ?? []) as Array<BloodLedgerEntry>;
    const entries = ledger.slice().sort((a, b) => Math.trunc(a.at ?? 0) - Math.trunc(b.at ?? 0));

    const items: Array<{
      text: string;
      detail: string;
      mult: string;
      delta: number;
      opp: string;
    }> = [];

    for (const entry of entries) {
      if (!entry) continue;
      const label = (entry.label ?? '').trim();
      const entryMult = Number.isFinite(entry.multiplier ?? NaN) ? Math.trunc(entry.multiplier) : 0;
      const detail = entry.kind === 'hu' ? formatFansBreakdown(entry) : '';
      for (const tr of entry.transfers ?? []) {
        if (!tr) continue;
        const from = Math.trunc(tr.fromSeat as number);
        const to = Math.trunc(tr.toSeat as number);
        const beans = Math.trunc(tr.beans as number);
        if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(beans) || beans <= 0) continue;

        const delta = to === seat ? beans : from === seat ? -beans : 0;
        if (delta === 0) continue;
        const oppSeat = to === seat ? from : to;
        const opp = relativeOpponentLabel(viewerSeat ?? seat, oppSeat);

        const sign = delta >= 0 ? '+' : '-';
        const mult = (() => {
          if (entry.kind === 'penalty') {
            if (entryMult > 0) return `${sign}${entryMult}倍`;
            if (base > 0 && beans % base === 0) return `${sign}${Math.trunc(beans / base)}倍`;
            return '';
          }
          if (entryMult > 0) return `${sign}${entryMult}倍`;
          return '';
        })();

        const text = (() => {
          if (entry.kind === 'kong') {
            const raw = label;
            const kongKind = (() => {
              if (raw.includes('加杠')) return '加杠';
              if (raw.includes('暗杠')) return '暗杠';
              if (raw.includes('明杠')) return '明杠';
              if (entryMult === 1) return '加杠';
              if (entryMult === 2) {
                const trCount = (entry.transfers ?? []).length;
                if (trCount === 1 && Number.isFinite(entry.seat ?? NaN)) return '暗杠';
                return trCount === 1 ? '明杠' : '暗杠';
              }
              if (raw.includes('杠')) return '杠';
              return '杠';
            })();
            return delta >= 0 ? kongKind : `被${kongKind}`;
          }
          if (entry.kind === 'penalty') {
            return label || '惩罚/退税';
          }
          if (entry.kind === 'hu') {
            const raw = label;
            const isZimo =
              (Array.isArray(entry.fans) && entry.fans.some((f) => String((f as any).id ?? '').trim() === 'zimo')) ||
              raw.includes('自摸');
            const huKind = isZimo ? '自摸' : '吃胡';
            return delta >= 0 ? huKind : `被${huKind}`;
          }
          return label || '流水';
        })();

        items.push({ text, detail, mult, delta, opp });
      }
    }

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'settle-empty';
      empty.textContent = '暂无流水';
      list.appendChild(empty);
      return;
    }

    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'settle-detail-row';
      list.appendChild(row);

      const left = document.createElement('div');
      left.className = 'settle-detail-desc';
      row.appendChild(left);

      const descTitle = document.createElement('div');
      descTitle.className = 'settle-detail-desc-title';
      const descMain = document.createElement('span');
      descMain.className = 'settle-detail-desc-title-main';
      descMain.textContent = it.text;
      descTitle.appendChild(descMain);

      if (it.detail) {
        const descDetail = document.createElement('span');
        descDetail.className = 'settle-detail-desc-title-detail';
        // Use WORD JOINER to avoid breaking between label and "（...）".
        descDetail.textContent = `\u2060${it.detail}`;
        descTitle.appendChild(descDetail);
      }
      left.appendChild(descTitle);

      const mult = document.createElement('div');
      mult.className = 'settle-detail-mult';
      mult.textContent = it.mult || '';
      row.appendChild(mult);

      const score = document.createElement('div');
      score.className = `settle-detail-beans ${it.delta >= 0 ? 'pos' : 'neg'}`;
      score.textContent = formatSigned(it.delta);
      row.appendChild(score);

      const opp = document.createElement('div');
      opp.className = 'settle-detail-opp';
      opp.textContent = it.opp;
      row.appendChild(opp);
    }
  }

  private renderGuobiaoSettlementDetailInto(gb: GuobiaoState, seat: number, root: HTMLDivElement): void {
    const viewerSeat = this.world.seat;
    const initialPoints = Math.trunc(gb.initialPointsBySeat?.[seat] ?? 0);
    const ps = gb.players?.[seat] ?? null;
    const finalPoints = ps ? Math.trunc(ps.points ?? 0) : 0;
    const total = finalPoints - initialPoints;
    const summary = gb.endSummary ?? null;
    const ruleTotal = Math.trunc(summary?.ruleScoreDeltaBySeat?.[seat] ?? 0);

    root.innerHTML = '';
    const meta = document.createElement('div');
    meta.className = 'settle-detail-meta';
    root.appendChild(meta);

    const ruleItem = document.createElement('div');
    ruleItem.className = 'settle-detail-meta-item';
    const ruleLabel = document.createElement('div');
    ruleLabel.className = 'settle-detail-meta-label';
    ruleLabel.textContent = '规则分';
    const ruleValue = document.createElement('div');
    ruleValue.className = `settle-detail-meta-value ${ruleTotal >= 0 ? 'pos' : 'neg'}`;
    ruleValue.textContent = formatSigned(ruleTotal);
    ruleItem.appendChild(ruleLabel);
    ruleItem.appendChild(ruleValue);
    meta.appendChild(ruleItem);

    const totalItem = document.createElement('div');
    totalItem.className = 'settle-detail-meta-item';
    const totalLabel = document.createElement('div');
    totalLabel.className = 'settle-detail-meta-label';
    totalLabel.textContent = '总输赢';
    const totalValue = document.createElement('div');
    totalValue.className = `settle-detail-meta-value ${total >= 0 ? 'pos' : 'neg'}`;
    totalValue.textContent = formatSigned(total);
    totalItem.appendChild(totalLabel);
    totalItem.appendChild(totalValue);
    meta.appendChild(totalItem);

    const list = document.createElement('div');
    list.className = 'settle-detail-list';
    root.appendChild(list);

    const ledger = (gb.ledger ?? []) as Array<GuobiaoLedgerEntry>;
    const entries = ledger.slice().sort((a, b) => Math.trunc(a.at ?? 0) - Math.trunc(b.at ?? 0));

    const items: Array<{
      text: string;
      detail: string;
      mult: string;
      delta: number;
      opp: string;
    }> = [];

    for (const entry of entries) {
      if (!entry) continue;
      if (entry.kind === 'draw') continue;
      const label = String(entry.label ?? '').trim();
      const detail = entry.kind === 'hu'
        ? formatGuobiaoFansBreakdown(entry)
        : (entry.note ? `（${entry.note}）` : '');
      for (const tr of entry.transfers ?? []) {
        if (!tr) continue;
        const from = Math.trunc(tr.fromSeat as number);
        const to = Math.trunc(tr.toSeat as number);
        const points = Math.trunc(tr.points as number);
        const ruleScore = Math.trunc(tr.ruleScore as number);
        if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(points) || points <= 0) continue;

        const delta = to === seat ? points : from === seat ? -points : 0;
        if (delta === 0) continue;
        const oppSeat = to === seat ? from : to;
        const opp = relativeOpponentLabel(viewerSeat ?? seat, oppSeat);
        const sign = delta >= 0 ? '+' : '-';
        const mult = Number.isFinite(ruleScore) && ruleScore > 0 ? `${sign}${ruleScore}分` : '';
        const text = (() => {
          if (entry.kind === 'wrongHu') {
            return delta >= 0 ? '获得错和赔付' : '错和赔付';
          }
          if (entry.kind === 'hu') {
            const huKind = label || (entry.fromSeat === null ? '自摸' : '点和');
            return delta >= 0 ? huKind : `被${huKind}`;
          }
          return label || '流水';
        })();
        items.push({ text, detail, mult, delta, opp });
      }
    }

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'settle-empty';
      empty.textContent = summary?.kind === 'draw' ? '荒牌无输赢' : '暂无流水';
      list.appendChild(empty);
      return;
    }

    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'settle-detail-row';
      list.appendChild(row);

      const left = document.createElement('div');
      left.className = 'settle-detail-desc';
      row.appendChild(left);

      const descTitle = document.createElement('div');
      descTitle.className = 'settle-detail-desc-title';
      const descMain = document.createElement('span');
      descMain.className = 'settle-detail-desc-title-main';
      descMain.textContent = it.text;
      descTitle.appendChild(descMain);

      if (it.detail) {
        const descDetail = document.createElement('span');
        descDetail.className = 'settle-detail-desc-title-detail';
        descDetail.textContent = `\u2060${it.detail}`;
        descTitle.appendChild(descDetail);
      }
      left.appendChild(descTitle);

      const mult = document.createElement('div');
      mult.className = 'settle-detail-mult';
      mult.textContent = it.mult;
      row.appendChild(mult);

      const score = document.createElement('div');
      score.className = `settle-detail-beans ${it.delta >= 0 ? 'pos' : 'neg'}`;
      score.textContent = formatSigned(it.delta);
      row.appendChild(score);

      const opp = document.createElement('div');
      opp.className = 'settle-detail-opp';
      opp.textContent = it.opp;
      row.appendChild(opp);
    }
  }

  private syncTeachBtn(): void {
    const on = this.teachEnabled;
    this.teachBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.teachBtn.classList.toggle('active', on);
  }

  private setTeachHosted(enabled: boolean, reason?: string): void {
    const next = !!enabled;
    if (this.teachHosted === next) return;
    this.teachHosted = next;
    this.teachBtn.classList.toggle('hosted', next);
    if (!next && reason && reason !== '用户取消托管' && reason !== '新一局开始') {
      this.showTeachToast(`托管已退出：${reason}`);
    }
  }

  private showTeachToast(text: string): void {
    const msg = (text ?? '').trim();
    if (!msg) return;
    if (this.teachToastTimer !== null) {
      window.clearTimeout(this.teachToastTimer);
      this.teachToastTimer = null;
    }

    const rect = this.teachBtn.getBoundingClientRect();
    const x = Math.round(rect.right);
    const y = Math.round(rect.bottom + 8);
    this.teachToast.style.left = `${x}px`;
    this.teachToast.style.top = `${y}px`;
    this.teachToast.textContent = msg;
    this.teachToast.classList.add('show');
    this.teachToastTimer = window.setTimeout(() => {
      this.teachToast.classList.remove('show');
      this.teachToastTimer = null;
    }, 1800);
  }

  private async onTeachToggle(): Promise<void> {
    const next = !this.teachEnabled;
    if (!next) {
      this.teachEnabled = false;
      this.syncTeachBtn();
      this.aiOverlay.setOpen(false);
      return;
    }

    // 若当前被“听牌弹窗”强制遮挡：先关闭听牌弹窗，保证“荐牌”入口可用。
    if (this.mainEl.classList.contains('blood-tenpai-open')) {
      window.dispatchEvent(new CustomEvent('blood-tenpai-dismiss'));
    }
    this.setRulesOpen(false);
    this.setSettingsOpen(false);
    this.teachEnabled = true;
    this.syncTeachBtn();
    this.aiOverlay.setOpen(true);
  }

  update(): void {
    if (this.cards.length === 0) {
      return;
    }

    const tableVp = this.mainView.getTableViewport();
    const stageW = this.mainEl.clientWidth;
    const stageH = this.mainEl.clientHeight;
    const layoutVp = this.hudLayout === 'fixed'
      ? { left: 0, top: 0, width: stageW, height: stageH }
      : tableVp;
    const vpLeft = layoutVp.left;
    const vpRight = layoutVp.left + layoutVp.width;
    const vpTop = layoutVp.top;
    const vpBottom = layoutVp.top + layoutVp.height;

    const viewerSeat = this.world.seat;
    const match = this.client.match.get(0) as any;
    const isGuobiaoGame = match?.conditions?.gameType === GameType.GUOBIAO;
    const blood = isGuobiaoGame ? null : (this.client.blood.get(0) as BloodState | null);
    const gb = isGuobiaoGame ? (this.client.gb.get(0) as GuobiaoState | null) : null;
    const me = viewerSeat !== null && blood ? (blood.players?.[viewerSeat] ?? null) : null;
    const replayMode = !!this.replayControls;

    const phase: BloodPhase | null = blood?.phase ?? null;
    const guobiaoPhase = gb?.phase ?? null;
    const roomType = String(match?.roomType ?? '');
    const partialCase = match?.caseStudy?.partial === true;
    const hideTeach = partialCase || roomType === 'newbie' || roomType === 'friend';
    if (hideTeach && this.aiOverlay.isHosted()) {
      this.aiOverlay.setHosted(false, '新手房/好友房已隐藏荐牌');
    }
    // 新一局开始（发牌结束 → swap3）时：强制把“荐牌”开关重置为关。
    if (phase === 'swap3' && this.lastBloodPhase === 'dealing') {
      if (this.teachEnabled) {
        this.teachEnabled = false;
        this.syncTeachBtn();
      }
      this.aiOverlay.setHosted(false, '新一局开始');
      this.aiOverlay.setOpen(false);
      // 新一局进入换三张：关闭拆牌面板，避免残留上一局的快照/推荐信息。
      this.splitCloseBySystem = true;
      try {
        this.splitOverlay.setOpen(false);
      } finally {
        this.splitCloseBySystem = false;
      }
      this.splitAutoDismissed = false;
      this.lastShowSplit = false;
    }
    this.lastBloodPhase = phase;

    const started =
      viewerSeat !== null &&
      (isGuobiaoGame
        ? !!gb && guobiaoPhase !== null
        : !!blood && phase !== 'lobby' && phase !== 'dealing');
    const practiceEnabledRoom = roomType === 'newbie' || roomType === '' || roomType === 'friend';
    const practiceCreatablePhase = phase === 'swap3' || phase === 'dingque' || phase === 'playing';
    const showRules = !partialCase;
    const showSettings =
      !replayMode &&
      isGuobiaoGame &&
      this.client.seat !== null &&
      (guobiaoPhase === null || guobiaoPhase === 'playing');
    const showLedger = started && !partialCase;
    const showTeach = started && !isGuobiaoGame && !hideTeach;
    const showPracticeCreate = !replayMode && started && !isGuobiaoGame && this.client.isAuthoritative() && practiceEnabledRoom && practiceCreatablePhase;
    const showSplit =
      !partialCase &&
      started &&
      (roomType === 'newbie' || roomType === '' || roomType === 'friend' || roomType === 'practice-branch') &&
      !!blood &&
      blood.phase === 'playing' &&
      blood.pending === null &&
      viewerSeat !== null &&
      blood.turnSeat === viewerSeat &&
      blood.turnStep === 'discard' &&
      !!me &&
      !me.hu &&
      me.dingque !== null;
    // “拆牌”按钮常驻：从 swap3/dingque 开始就显示（房间类型仍限制新手/好友）。
    const showSplitBtn = !partialCase && !isGuobiaoGame && started && (roomType === 'newbie' || roomType === '' || roomType === 'friend' || roomType === 'practice-branch');
    const enteredDiscard = showSplit && !this.lastShowSplit;
    const showSettlement =
      !replayMode &&
      viewerSeat !== null &&
      (isGuobiaoGame
        ? !!gb && (guobiaoPhase === 'settling' || guobiaoPhase === 'done')
        : !!blood && (phase === 'settling' || phase === 'done'));
    const showPlayAgain = !replayMode && roomType === 'newbie' && (isGuobiaoGame ? guobiaoPhase === 'done' : phase === 'done');
    const showDebugFans = this.debugFansEnabled && viewerSeat === 0 && !!blood;

    if (!showRules && this.rulesOpen) {
      this.setRulesOpen(false);
    }
    if (!showSettings && this.settingsOpen) {
      this.setSettingsOpen(false);
    }
    if (!showLedger && this.ledgerOpen) {
      this.setLedgerOpen(false);
    }
    if (!showSettlement && this.settlementOpen) {
      this.setSettlementOpen(false);
    }
    if (!showDebugFans && this.debugFansOpen) {
      this.setDebugFansOpen(false);
    }
    if (!showTeach && this.teachEnabled) {
      this.teachEnabled = false;
      this.syncTeachBtn();
      this.aiOverlay.setOpen(false);
    }
    const aiScene: AiScene | null = (() => {
      if (viewerSeat === null || !blood) return null;
      const me = blood.players?.[viewerSeat] ?? null;
      if (!me || me.hu) return null;
      if (blood.phase === 'swap3') {
        const swap3 = blood.swap3 ?? null;
        if (!swap3 || swap3.animatingSince !== null) return null;
        const picked = swap3.selections?.[viewerSeat] ?? null;
        return picked === null ? 'swap3' : null;
      }
      if (blood.phase === 'dingque') {
        return isDingqueCommitted(me) ? null : 'dingque';
      }
      if (blood.phase === 'playing') {
        const pending = blood.pending;
        if (pending && pending.kind === 'claim') {
          if (viewerSeat === pending.fromSeat) return null;
          if (pending.responses?.[viewerSeat] !== null) return null;
          const opt = pending.options?.[viewerSeat] ?? null;
          if (!opt || (!opt.hu && !opt.peng && !opt.gang)) return null;
          return 'claim';
        }
        if (pending === null && blood.turnSeat === viewerSeat && blood.turnStep === 'discard' && me.dingque !== null) {
          return 'turn';
        }
      }
      return null;
    })();
    this.aiOverlay.setScene(aiScene);
    const showPracticeQuick = !partialCase && !isGuobiaoGame && (replayMode ? started : this.client.isAuthoritative() && practiceEnabledRoom && aiScene !== null);
    this.practiceCreateBtn.style.display = showPracticeCreate ? '' : 'none';
    this.shareBtn.style.display = !replayMode || this.replayControls?.canShare ? '' : 'none';
    if (replayMode && !(this.replayControls?.canShare)) {
      this.shareOut.classList.add('hidden');
      this.shareOutInput.value = '';
    }
    this.syncPracticeButtons();
    if (showPracticeCreate || (!isGuobiaoGame && showSettlement)) {
      this.requestPracticeBranchSummarySync();
    }
    if (replayMode) {
      this.teachBtn.disabled = aiScene === null;
      this.practiceQuickBtn.disabled = true;
      this.practiceCreateBtn.disabled = true;
      this.splitBtn.disabled = !showSplit;
      this.replayPrevBtn.disabled = !(this.replayControls?.canPrev() ?? false);
      this.replayNextBtn.disabled = !(this.replayControls?.canNext() ?? false);
    } else {
      this.teachBtn.disabled = false;
      this.splitBtn.disabled = false;
      this.replayPrevBtn.disabled = true;
      this.replayNextBtn.disabled = true;
    }
    if (replayMode && aiScene === null && this.teachEnabled) {
      this.teachEnabled = false;
      this.syncTeachBtn();
      this.aiOverlay.setOpen(false);
    }
    this.syncSettingsPanel();

    // === 右上角 HUD 操作按钮：固定顺序，全屏常驻 ===
    const btnRefH = stageH > 1 ? stageH : 720;
    const edgeY = Math.round(Math.max(20, Math.min(24, btnRefH * 0.03)));
    // 仅水平更靠右：不要影响 vertical offset（与 edgeY 分离）。
    const edgeX = Math.round(Math.max(8, Math.min(14, btnRefH * 0.02)));
    const btnHeight = Math.round(Math.max(44, Math.min(52, btnRefH * 0.067)));
    const btnWidth = Math.round(Math.max(128, Math.min(156, btnHeight * 2.8)));
    const gap = Math.round(Math.max(10, Math.min(12, btnHeight * 0.25)));
    this.hudActionsRoot.style.setProperty('--mj-hud-edge-y', `${edgeY}px`);
    this.hudActionsRoot.style.setProperty('--mj-hud-edge-x', `${edgeX}px`);
    this.hudActionsRoot.style.setProperty('--mj-hud-btn-w', `${btnWidth}px`);
    this.hudActionsRoot.style.setProperty('--mj-hud-btn-h', `${btnHeight}px`);
    this.hudActionsRoot.style.setProperty('--mj-hud-gap', `${gap}px`);

    const stack: Array<{ btn: HTMLButtonElement; show: boolean }> = [];
    if (this.fullscreenBtn) {
      stack.push({ btn: this.fullscreenBtn, show: true });
    }
    if (this.homeBtn) {
      stack.push({ btn: this.homeBtn, show: true });
    }
    stack.push({ btn: this.rulesBtn, show: showRules });
    stack.push({ btn: this.settingsBtn, show: showSettings });
    stack.push({ btn: this.ledgerBtn, show: showLedger });
    stack.push({ btn: this.teachBtn, show: showTeach });
    stack.push({ btn: this.splitBtn, show: showSplitBtn });
    stack.push({ btn: this.practiceQuickBtn, show: showPracticeQuick });
    stack.push({ btn: this.replayPrevBtn, show: !partialCase && replayMode && started });
    stack.push({ btn: this.replayNextBtn, show: !partialCase && replayMode && started });
    stack.push({ btn: this.settlementBtn, show: showSettlement });
    stack.push({ btn: this.playAgainBtn, show: showPlayAgain });
    if (this.debugFansBtn) {
      stack.push({ btn: this.debugFansBtn, show: showDebugFans });
    }

    let idx = 0;
    for (const it of stack) {
      it.btn.classList.toggle('is-hidden', !it.show);
      it.btn.setAttribute('aria-hidden', it.show ? 'false' : 'true');
      it.btn.tabIndex = it.show ? 0 : -1;
      if (it.show) {
        it.btn.style.setProperty('--mj-hud-i', String(idx));
        idx += 1;
      }
    }

    // The challenge first presents the hand itself. Its existing 拆牌 button
    // remains available after beginning, without opening hints over preparation.
    if (!replayMode && enteredDiscard && !this.client.match.get(0)?.challenge) {
      if (this.splitOverlay.isOpen()) {
        this.splitOverlay.syncAndOpenBestDetail();
      } else if (!this.splitAutoDismissed) {
        this.splitOverlay.setOpen(true);
      }
    }
    if (replayMode && !showSplit && this.splitOverlay.isOpen()) {
      this.splitCloseBySystem = true;
      try {
        this.splitOverlay.setOpen(false);
      } finally {
        this.splitCloseBySystem = false;
      }
    }
    this.lastShowSplit = showSplit;

    if (this.splitOverlay.isOpen()) {
      this.splitOverlay.layout();
      this.splitOverlay.syncActability();
    }

    const vSeat = viewerSeat ?? 0;
    const leftSeat = (vSeat + 3) % 4;
    const rightSeat = (vSeat + 1) % 4;
    const leftHandRail = this.collectSeatRailRects(leftSeat, 'hand', tableVp);
    const leftMeldRail = this.collectSeatRailRects(leftSeat, 'meld', tableVp);
    const rightHandRail = this.collectSeatRailRects(rightSeat, 'hand', tableVp);
    const rightMeldRail = this.collectSeatRailRects(rightSeat, 'meld', tableVp);
    const handRectsBySeat = this.hudLayout === 'fixed'
      ? Array.from({ length: 4 }, (_, seat) => {
          const handVp = this.mainView.getHandViewport();
          const useHand = viewerSeat !== null && seat === viewerSeat && !!handVp && !!this.mainView.handCamera;
          const vp = useHand ? handVp! : tableVp;
          const camera = useHand ? this.mainView.handCamera : this.mainView.camera;
          return this.collectSeatRailRects(seat, 'hand', vp, camera);
        })
      : null;
    const meldRectsBySeat = this.hudLayout === 'fixed'
      ? Array.from({ length: 4 }, (_, seat) => {
          const handVp = this.mainView.getHandViewport();
          const useHand = viewerSeat !== null && seat === viewerSeat && !!handVp && !!this.mainView.handCamera;
          const vp = useHand ? handVp! : tableVp;
          const camera = useHand ? this.mainView.handCamera : this.mainView.camera;
          return this.collectSeatRailRects(seat, 'meld', vp, camera);
        })
      : null;

    let ownRect: { left: number; top: number; width: number; height: number } | null = null;

    // HUD 跑光只在“真正轮到出牌”的阶段显示：playing + 无 pending + turnStep=discard。
    const turnHudSeat =
      isGuobiaoGame && gb && gb.phase === 'playing' && gb.pending === null && gb.turnStep === 'discard'
        ? gb.turnSeat
        : !isGuobiaoGame && blood && blood.phase === 'playing' && blood.pending === null && blood.turnStep === 'discard'
          ? blood.turnSeat
          : null;

    for (const card of this.cards) {
      const rel = relSeat(viewerSeat, card.seat);
      const boxMap = this.hudLayout === 'fixed' ? HUD_BOX_BY_REL_SEAT_FIXED : HUD_BOX_BY_REL_SEAT_RAIL;
      const box = boxMap[rel];
      if (!box) {
        card.el.classList.remove('hud-turn');
        card.el.style.display = 'none';
        continue;
      }
      card.el.style.display = 'block';
      card.el.classList.toggle('hud-turn', turnHudSeat !== null && card.seat === turnHudSeat);

      const width = layoutVp.width * box.w;
      const baseHeight = layoutVp.height * box.h;
      const nicknameHeight = Math.max(16, baseHeight * 0.22);
      const height = baseHeight + nicknameHeight;
      const side: 'left' | 'right' = rel === 0 || rel === 3 ? 'left' : 'right';
      // baseTop/baseHeight 来自采样图；固定布局直接使用 box，轨道布局再做 rail 对齐。
      let top = layoutVp.top + layoutVp.height * box.y;
      let left = layoutVp.left + layoutVp.width * box.x;
      top = Math.max(vpTop, Math.min(vpBottom - height, top));

      if (this.hudLayout !== 'fixed') {
        // 需求：不同位置的 HUD 贴不同“固定轨道”，避免因牌面变化抖动：
        // - 左下(rel=0) / 右上(rel=2)：贴 meld 轨道（即使当前还没副露，也以“副露轨道”作为固定参考，避免出现副露时跳动）
        // - 左上(rel=3) / 右下(rel=1)：贴 hand（不跟副露出现与否切换）
        const preferMeldRail = rel === 0 || rel === 2;
        const railTiles =
          side === 'left'
            ? (preferMeldRail ? leftMeldRail : leftHandRail)
            : (preferMeldRail ? rightMeldRail : rightHandRail);

        const fallbackX = left;
        const computeLeftAtTop = (t: number): number => {
          const railX = this.findRailX(railTiles, t, t + height, side);
          if (railX === null) return fallbackX;
          return side === 'left' ? railX - HUD_RAIL_GAP_PX - width : railX + HUD_RAIL_GAP_PX;
        };

        left = computeLeftAtTop(top);

        // 先保证与 rail 的 3px 间隙；若因此超出 tableViewport 左/右边界，则沿该侧向上移动。
        if (side === 'left') {
          const maxUp = Math.max(0, top - vpTop);
          const maxSteps = Math.ceil(maxUp / HUD_UPWARD_STEP_PX);
          for (let i = 0; i < maxSteps && left < vpLeft; i++) {
            top = Math.max(vpTop, top - HUD_UPWARD_STEP_PX);
            left = computeLeftAtTop(top);
          }
          // 兜底 A：顶到顶还是越界 -> 向内 clamp，保证完整可见。
          if (left < vpLeft) {
            left = vpLeft;
          }
        } else {
          const maxUp = Math.max(0, top - vpTop);
          const maxSteps = Math.ceil(maxUp / HUD_UPWARD_STEP_PX);
          for (let i = 0; i < maxSteps && left + width > vpRight; i++) {
            top = Math.max(vpTop, top - HUD_UPWARD_STEP_PX);
            left = computeLeftAtTop(top);
          }
          // 兜底 A：顶到顶还是越界 -> 向内 clamp，保证完整可见。
          if (left + width > vpRight) {
            left = vpRight - width;
          }
        }
      }

      if (this.hudLayout === 'fixed' && handRectsBySeat && meldRectsBySeat) {
        const seatRects = [...handRectsBySeat[card.seat], ...meldRectsBySeat[card.seat]];
        if (seatRects.length > 0) {
          const shift = this.computeHudOverlapShift(
            left,
            top,
            width,
            height,
            seatRects,
            side,
            vpLeft,
            vpRight,
          );
          left += shift;
        }
      }

      // 保证卡片完全在 tableViewport 内（用于兜底场景）。
      top = Math.max(vpTop, Math.min(vpBottom - height, top));
      left = Math.max(vpLeft, Math.min(vpRight - width, left));

      card.el.style.left = `${left}px`;
      card.el.style.top = `${top}px`;
      card.el.style.width = `${width}px`;
      card.el.style.height = `${height}px`;
      card.el.style.setProperty('--hud-h', `${baseHeight}px`);
      card.el.style.setProperty('--hud-nickname-h', `${nicknameHeight}px`);

      if (viewerSeat !== null && card.seat === viewerSeat) {
        ownRect = { left, top, width, height };
      }

      const playerId = this.client.seatPlayers[card.seat];
      const nick = playerId ? (this.client.nicks.get(playerId) ?? null) : null;
      const avatarIndex = playerId ? (this.client.avatars.get(playerId) ?? null) : null;
      const avatar =
        avatarIndex !== null && Number.isInteger(avatarIndex)
          ? HUD_AVATARS[avatarIndex] ?? HUD_AVATARS[card.seat] ?? HUD_AVATARS[0]
          : HUD_AVATARS[card.seat] ?? HUD_AVATARS[0];
      if (card.lastAvatarSrc !== avatar) {
        card.avatarImg.src = avatar;
        card.lastAvatarSrc = avatar;
      }
      const displayName = nick?.trim() || `玩家${card.seat + 1}`;
      card.avatarImg.alt = displayName;
      card.nicknameText.textContent = displayName;
      card.nicknameText.title = displayName;

      const bloodPlayer = blood?.players?.[card.seat] ?? null;
      const scoreValue = isGuobiaoGame
        ? gb?.players?.[card.seat]?.points
        : bloodPlayer?.beans;
      const scoreKey = formatScore(scoreValue);
      card.scoreInner.textContent = scoreKey;
      if (card.lastScoreKey !== scoreKey || card.lastScoreW !== width || card.lastScoreH !== baseHeight) {
        fitHudScoreText(card.scoreText, card.scoreInner, baseHeight);
        card.lastScoreKey = scoreKey;
        card.lastScoreW = width;
        card.lastScoreH = baseHeight;
      }

      const inSwap3 = blood?.phase === 'swap3';
      const inDingque = blood?.phase === 'dingque';
      const isSelfCard = viewerSeat !== null && card.seat === viewerSeat;
      // A historical frame must not inherit the local choice cached while
      // viewing a later frame (or another seat) when seeking back to dingque.
      const selfLocalDingque = isSelfCard && !this.client.match.get(0)?.sourceReplay ? this.client.localDingqueSuit() : null;
      const dingqueSuit = (isSelfCard ? (bloodPlayer?.dingque ?? selfLocalDingque) : bloodPlayer?.dingque) ?? null;
      const selfCommitted = isSelfCard && (isDingqueCommitted(bloodPlayer) || selfLocalDingque !== null);
      let badgeStrip = false;
      const badge = (() => {
        if (inSwap3) {
          badgeStrip = true;
          const swap3 = blood?.swap3 ?? null;
          if (swap3?.animatingSince !== null) return '换牌中';
          const picked = (swap3?.selections?.[card.seat] ?? null) !== null;
          return picked ? '已确定' : '选牌中';
        }
        if (inDingque) {
          if (selfCommitted) {
            return suitToLabel(dingqueSuit) ?? '已定缺';
          }
          badgeStrip = true;
          return isDingqueCommitted(bloodPlayer) ? '已定缺' : '定缺中';
        }
        return suitToLabel(dingqueSuit);
      })();
      // 只在 /hand/ 启用“按花色区分定缺角标背景色”；教练模式不改。
      if (!badgeStrip && this.dingqueBadgeBySuit) {
        const bg = suitToDingqueBadgeBg(dingqueSuit);
        if (bg) card.badgeText.style.backgroundColor = bg;
        else card.badgeText.style.removeProperty('background-color');
      } else {
        // swap3 条幅/或未启用：让 CSS 完全接管背景（避免残留上一次的 inline 颜色）
        card.badgeText.style.removeProperty('background-color');
      }
      if (badge) {
        card.badgeText.textContent = badge;
        card.badgeText.classList.remove('hidden');
      } else {
        card.badgeText.textContent = '';
        card.badgeText.classList.add('hidden');
      }

      // 状态类条幅覆盖头像上半部分；花色角标使用圆形样式。
      card.badgeText.classList.toggle('swap3', badgeStrip);
      card.badgeText.classList.toggle('dingquezhong', badge === '定缺中');
      card.badgeText.classList.toggle('dingque-wan', badge === '万');
      card.badgeText.classList.toggle('dingque-tong', badge === '筒');
      card.badgeText.classList.toggle('dingque-tiao', badge === '条');
    }

    if (this.teachEnabled) {
      this.aiOverlay.layout();
    }

    if (this.ledgerOpen) {
      this.renderLedger();
    }
    if (this.settlementOpen) {
      const key = this.buildSettlementRenderKey(blood, isGuobiaoGame ? gb : null);
      if (key !== this.settlementRenderKey) {
        this.renderSettlement();
      }
    }

    // === debugFans 脚本用例：用真实动作推进（例如：先杠→补张→自摸） ===
    if (!isGuobiaoGame && this.debugFansScript && viewerSeat === 0) {
      const script = this.debugFansScript;
      const state = this.client.blood.get(0) as BloodState | null;
      const elapsed = Date.now() - script.startedAt;
      const timeoutMs = 5000;

      const findExtraTileKey = (): number | null => {
        const extraSlot = 'hand.extra@0';
        for (const t of this.world.things.values()) {
          if (t.type !== ThingType.TILE) continue;
          if (t.slot.group !== 'hand' || t.slot.seat !== 0) continue;
          if (t.slot.name !== extraSlot) continue;
          return tileKeyFromTypeIndex(t.typeIndex);
        }
        return null;
      };

      const countHandTileKey = (tileKey: number): number => {
        let n = 0;
        for (const t of this.world.things.values()) {
          if (t.type !== ThingType.TILE) continue;
          if (t.slot.group !== 'hand' || t.slot.seat !== 0) continue;
          const k = tileKeyFromTypeIndex(t.typeIndex);
          if (k === tileKey) n += 1;
        }
        return n;
      };

      if (!state || elapsed > timeoutMs) {
        this.setDebugFansStatus('脚本用例超时：请重试（可能是同步延迟导致动作未生效）。');
        this.debugFansAwaitHu = null;
        this.debugFansScript = null;
      } else if (script.kind === 'gangShangKaiHua') {
        const canAct =
          state.phase === 'playing' &&
          state.pending === null &&
          state.turnSeat === 0;

        if (script.step === 'kong') {
          const need = script.kong.gangType === 'an' ? 4 : 1;
          const have = countHandTileKey(script.kong.tileKey);
          if (canAct && state.turnStep === 'discard' && have >= need) {
            this.setDebugFansStatus('运行中：执行杠牌…');
            this.client.sendBloodAction({ kind: 'kong', gangType: script.kong.gangType, tileKey: script.kong.tileKey });
            this.debugFansScript = { ...script, step: 'waitDraw' };
          }
        } else if (script.step === 'waitDraw') {
          const extraKey = findExtraTileKey();
          const isAfterGang = (state.afterGangSeat ?? null) === 0;
          if (canAct && state.turnStep === 'discard' && isAfterGang && extraKey === script.winTileKey) {
            this.setDebugFansStatus('运行中：补张自摸胡…');
            this.debugFansAwaitHu = { since: Date.now(), title: script.title };
            this.client.sendBloodAction({ kind: 'hu', source: 'self' });
            this.debugFansScript = null;
          } else if (elapsed > 2500 && extraKey !== null && extraKey !== script.winTileKey) {
            this.setDebugFansStatus(`脚本用例失败：补张不是预期牌（摸到 ${tileLabel(extraKey)}，期望 ${tileLabel(script.winTileKey)}）。`);
            this.debugFansAwaitHu = null;
            this.debugFansScript = null;
          }
        }
      }
    }

    if (this.debugFansAwaitHu && this.debugFansStatus) {
      const since = this.debugFansAwaitHu.since;
      const title = this.debugFansAwaitHu.title;
      const state = this.client.blood.get(0) as BloodState | null;
      let entry: BloodLedgerEntry | null = null;
      const ledger = (state?.ledger ?? []) as Array<BloodLedgerEntry>;
      for (let i = ledger.length - 1; i >= 0; i--) {
        const e = ledger[i];
        if (e && e.kind === 'hu' && e.seat === 0) {
          entry = e;
          break;
        }
      }
      if (entry && typeof entry.at === 'number' && entry.at >= since - 50) {
        const capped = Math.trunc(entry.multiplier);
        const raw = typeof entry.multiplierRaw === 'number' ? Math.trunc(entry.multiplierRaw) : capped;
        const cap = typeof entry.cap === 'number' ? Math.trunc(entry.cap) : null;
        const capNote = cap !== null && raw > capped ? `（封顶${cap}）` : '';
        const multText = raw !== capped ? `${raw}→${capped}` : `${capped}`;
        const fanText = (entry.fans ?? [])
          .map((f) => `${f.name}×${Math.trunc(f.multiplier)}`)
          .join('、');
        this.setDebugFansStatus(`完成：${title} · 倍数 ${multText}${capNote}${fanText ? ` · ${fanText}` : ''}`);
        this.debugFansAwaitHu = null;
      } else if (Date.now() - since > 4500) {
        this.setDebugFansStatus(`未检测到胡牌结果：${title}（请检查是否定缺/牌面不满足）。`);
        this.debugFansAwaitHu = null;
      }
    }
  }

  destroy(): void {
    this.root.remove();
    this.ledgerRoot.remove();
    this.settlementRoot.remove();
    if (this.debugFansRoot) {
      this.debugFansRoot.remove();
      this.debugFansRoot = null;
    }
    this.cards = [];
  }
}

async function copyText(text: string): Promise<boolean> {
  const value = (text ?? '').trim();
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // fallback
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
