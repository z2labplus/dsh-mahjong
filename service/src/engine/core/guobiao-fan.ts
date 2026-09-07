import {
  GUOBIAO_NON_FLOWER_TILE_COUNT,
  countGuobiaoTileKeys,
  guobiaoTileGroup,
  guobiaoTileRank,
  isGuobiaoFlower,
  isGuobiaoHonor,
  isGuobiaoNumberTile,
  isGuobiaoTileKey,
} from './guobiao-tiles';
import {
  GUOBIAO_FAN_DEFINITION_BY_ID,
  type GuobiaoFanId,
} from './guobiao-fan-definitions';

export {
  GUOBIAO_FAN_DEFINITIONS,
  GUOBIAO_FAN_DEFINITION_BY_ID,
  GUOBIAO_OFFICIAL_FAN_DEFINITIONS,
  GUOBIAO_TZIAKCHA_SUPPLEMENTAL_FAN_DEFINITIONS,
} from './guobiao-fan-definitions';
export type { GuobiaoFanDefinition, GuobiaoFanId } from './guobiao-fan-definitions';

export type GuobiaoClosedWinShapeKind =
  | 'standard'
  | 'sevenPairs'
  | 'thirteenOrphans'
  | 'nineGates'
  | 'sevenShiftedPairs'
  | 'greaterHonorsAndKnitted'
  | 'lesserHonorsAndKnitted'
  | 'knittedStraight';

export type GuobiaoFanApplied = {
  id: GuobiaoFanId;
  name: string;
  points: number;
  count?: number;
  countsTowardMinFan: boolean;
};

export type GuobiaoFanSuppressed = GuobiaoFanApplied & {
  by: Array<GuobiaoFanId>;
  ruleId: string;
  reason: string;
};

export type GuobiaoClosedWinShapeResult = {
  valid: boolean;
  kind: GuobiaoClosedWinShapeKind | null;
  nonFlowerTiles: Array<number>;
  flowerTiles: Array<number>;
};

export type GuobiaoFanMeldKind = 'chi' | 'peng' | 'mingGang' | 'anGang' | 'addGang';

export type GuobiaoFanMeld = {
  kind: GuobiaoFanMeldKind;
  tileKeys: ReadonlyArray<number>;
  concealed?: boolean;
  fromSeat?: number | null;
};

export type GuobiaoFanWaitKind = 'edge' | 'closed' | 'single';

export type GuobiaoWinContext = {
  isSelfDrawn?: boolean;
  isRobbingKong?: boolean;
  isKongDraw?: boolean;
  isLastTileDraw?: boolean;
  isLastTileClaim?: boolean;
  isLastTile?: boolean;
  isHeavenlyHand?: boolean;
  isEarthlyHand?: boolean;
  isHumanHandOne?: boolean;
  isHumanHandTwo?: boolean;
  winningTileKey?: number;
  seatWind?: number;
  roundWind?: number;
  prevalentWind?: number;
  waitKind?: GuobiaoFanWaitKind;
};

export type GuobiaoFanInput = {
  tiles?: ReadonlyArray<number>;
  handTiles?: ReadonlyArray<number>;
  melds?: ReadonlyArray<GuobiaoFanMeld>;
  flowerCount?: number;
  winContext?: GuobiaoWinContext;
  isSelfDrawn?: boolean;
  isRobbingKong?: boolean;
  isKongDraw?: boolean;
  isLastTileDraw?: boolean;
  isLastTileClaim?: boolean;
  isLastTile?: boolean;
  seatWind?: number;
  roundWind?: number;
};

export type GuobiaoFanResult = {
  valid: boolean;
  shape: GuobiaoClosedWinShapeResult;
  fans: Array<GuobiaoFanApplied>;
  candidateFans: Array<GuobiaoFanApplied>;
  suppressedFans: Array<GuobiaoFanSuppressed>;
  fanTotal: number;
  qualifyingFanTotal: number;
};

const THIRTEEN_ORPHANS_KEYS = Object.freeze([
  0, 8,
  9, 17,
  18, 26,
  27, 28, 29, 30,
  31, 32, 33,
]);

const KNITTED_RANK_GROUPS = Object.freeze([
  Object.freeze([1, 4, 7]),
  Object.freeze([2, 5, 8]),
  Object.freeze([3, 6, 9]),
]);

const KNITTED_PATTERNS: ReadonlyArray<ReadonlySet<number>> = Object.freeze([
  makeKnittedPattern([0, 1, 2]),
  makeKnittedPattern([0, 2, 1]),
  makeKnittedPattern([1, 0, 2]),
  makeKnittedPattern([1, 2, 0]),
  makeKnittedPattern([2, 0, 1]),
  makeKnittedPattern([2, 1, 0]),
]);

const GREEN_TILE_KEYS = new Set<number>([
  19, 20, 21, 23, 25, 32, // 2/3/4/6/8 条 + 发
]);

const REVERSIBLE_TILE_KEYS = new Set<number>([
  9, 10, 11, 12, 13, 16, 17, // 1/2/3/4/5/8/9 筒
  19, 21, 22, 23, 25, 26, // 2/4/5/6/8/9 条
  33, // 白
]);

const EVEN_PUNG_RANKS = new Set<number>([2, 4, 6, 8]);
const UPPER_TILE_RANKS = new Set<number>([7, 8, 9]);
const MIDDLE_TILE_RANKS = new Set<number>([4, 5, 6]);
const LOWER_TILE_RANKS = new Set<number>([1, 2, 3]);
const UPPER_FOUR_RANKS = new Set<number>([6, 7, 8, 9]);
const LOWER_FOUR_RANKS = new Set<number>([1, 2, 3, 4]);

type FanMeldUnitKind = 'chow' | 'pung' | 'kong';

type FanMeldUnit = {
  kind: FanMeldUnitKind;
  tileKeys: Array<number>;
  baseKey: number;
  concealed: boolean;
  source: 'hand' | 'meld';
  originalKind?: GuobiaoFanMeldKind;
};

type StandardDecomposition = {
  melds: Array<FanMeldUnit>;
  pairKey: number;
};

type NormalizedWinContext = {
  isSelfDrawn: boolean;
  isRobbingKong: boolean;
  isKongDraw: boolean;
  isLastTileDraw: boolean;
  isLastTileClaim: boolean;
  isLastTile: boolean;
  isHeavenlyHand: boolean;
  isEarthlyHand: boolean;
  isHumanHandOne: boolean;
  isHumanHandTwo: boolean;
  winningTileKey: number | null;
  seatWindKey: number | null;
  roundWindKey: number | null;
  waitKind: GuobiaoFanWaitKind | null;
};

type GuobiaoFanAnalysis = {
  shape: GuobiaoClosedWinShapeResult;
  handNonFlowerTiles: Array<number>;
  handFlowerTiles: Array<number>;
  fixedMelds: Array<FanMeldUnit>;
  decompositions: Array<StandardDecomposition>;
  allNonFlowerTiles: Array<number>;
  flowerCount: number;
  context: NormalizedWinContext;
};

type GuobiaoFanBranch = {
  candidateFans: Array<GuobiaoFanApplied>;
  applied: Set<GuobiaoFanId>;
};

type GuobiaoFanResolvedBranch = {
  candidateFans: Array<GuobiaoFanApplied>;
  fans: Array<GuobiaoFanApplied>;
  suppressedFans: Array<GuobiaoFanSuppressed>;
  fanTotal: number;
  qualifyingFanTotal: number;
};

type GuobiaoFanExclusionRule = {
  id: string;
  priority: number;
  whenAll: ReadonlyArray<GuobiaoFanId>;
  suppress: ReadonlyArray<GuobiaoFanId>;
  reason: string;
};

const GUOBIAO_FAN_EXCLUSION_RULES = [
  {
    id: 'guobiao.heavenlyHand.noFullyConcealedHand',
    priority: 950,
    whenAll: ['heavenlyHand'],
    suppress: ['fullyConcealedHand'],
    reason: '天和不计不求人',
  },
  {
    id: 'guobiao.heavenlyHand.noSelfDrawn',
    priority: 950,
    whenAll: ['heavenlyHand'],
    suppress: ['selfDrawn'],
    reason: '天和不计自摸',
  },
  {
    id: 'guobiao.earthlyHand.noConcealedHand',
    priority: 950,
    whenAll: ['earthlyHand'],
    suppress: ['concealedHand'],
    reason: '地和不计门前清',
  },
  {
    id: 'guobiao.humanHandOne.noConcealedHand',
    priority: 950,
    whenAll: ['humanHandOne'],
    suppress: ['concealedHand'],
    reason: '人和不计门前清',
  },
  {
    id: 'guobiao.humanHandTwo.noFullyConcealedHand',
    priority: 950,
    whenAll: ['humanHandTwo'],
    suppress: ['fullyConcealedHand'],
    reason: '人和不计不求人',
  },
  {
    id: 'guobiao.humanHandTwo.noSelfDrawn',
    priority: 950,
    whenAll: ['humanHandTwo'],
    suppress: ['selfDrawn'],
    reason: '人和不计自摸',
  },
  {
    id: 'guobiao.bigFourWinds.noAllPungs',
    priority: 1000,
    whenAll: ['bigFourWinds'],
    suppress: ['allPungs'],
    reason: '大四喜不计碰碰和',
  },
  {
    id: 'guobiao.bigFourWinds.noBigThreeWinds',
    priority: 1000,
    whenAll: ['bigFourWinds'],
    suppress: ['bigThreeWinds'],
    reason: '大四喜不计三风刻',
  },
  {
    id: 'guobiao.bigFourWinds.noPrevalentWind',
    priority: 1000,
    whenAll: ['bigFourWinds'],
    suppress: ['prevalentWind'],
    reason: '大四喜不计圈风刻',
  },
  {
    id: 'guobiao.bigFourWinds.noSeatWind',
    priority: 1000,
    whenAll: ['bigFourWinds'],
    suppress: ['seatWind'],
    reason: '大四喜不计门风刻',
  },
  {
    id: 'guobiao.bigFourWinds.noPungOfTerminalsOrHonors',
    priority: 1000,
    whenAll: ['bigFourWinds'],
    suppress: ['pungOfTerminalsOrHonors'],
    reason: '大四喜不计幺九刻',
  },
  {
    id: 'guobiao.allGreen.noHalfFlush',
    priority: 1000,
    whenAll: ['allGreen'],
    suppress: ['halfFlush'],
    reason: '绿一色有发时不计混一色',
  },
  {
    id: 'guobiao.middleTiles.noNoHonors',
    priority: 950,
    whenAll: ['middleTiles'],
    suppress: ['noHonors'],
    reason: '全中不计无字',
  },
  {
    id: 'guobiao.allSimples.noNoHonors',
    priority: 850,
    whenAll: ['allSimples'],
    suppress: ['noHonors'],
    reason: '断幺不计无字',
  },
  {
    id: 'guobiao.fourKongs.noAllPungs',
    priority: 1000,
    whenAll: ['fourKongs'],
    suppress: ['allPungs'],
    reason: '四杠不计碰碰和',
  },
  {
    id: 'guobiao.fourKongs.noSingleWait',
    priority: 1000,
    whenAll: ['fourKongs'],
    suppress: ['singleWait'],
    reason: '四杠不计单钓将',
  },
  {
    id: 'guobiao.bigThreeDragons.noTwoDragonPungs',
    priority: 1000,
    whenAll: ['bigThreeDragons'],
    suppress: ['twoDragonPungs'],
    reason: '大三元不计双箭刻',
  },
  {
    id: 'guobiao.bigThreeDragons.noDragonPung',
    priority: 1000,
    whenAll: ['bigThreeDragons'],
    suppress: ['dragonPung'],
    reason: '大三元不计箭刻',
  },
  {
    id: 'guobiao.littleThreeDragons.noTwoDragonPungs',
    priority: 1000,
    whenAll: ['littleThreeDragons'],
    suppress: ['twoDragonPungs'],
    reason: '小三元不计双箭刻',
  },
  {
    id: 'guobiao.littleThreeDragons.noDragonPung',
    priority: 1000,
    whenAll: ['littleThreeDragons'],
    suppress: ['dragonPung'],
    reason: '小三元不计箭刻',
  },
  {
    id: 'guobiao.twoDragonPungs.noDragonPung',
    priority: 800,
    whenAll: ['twoDragonPungs'],
    suppress: ['dragonPung'],
    reason: '双箭刻不计箭刻',
  },
  {
    id: 'guobiao.fullFlush.noNoHonors',
    priority: 900,
    whenAll: ['fullFlush'],
    suppress: ['noHonors'],
    reason: '清一色不计无字',
  },
  {
    id: 'guobiao.allHonors.noAllPungs',
    priority: 900,
    whenAll: ['allHonors'],
    suppress: ['allPungs'],
    reason: '字一色不计碰碰和',
  },
  {
    id: 'guobiao.allHonors.noAllTerminalsAndHonors',
    priority: 900,
    whenAll: ['allHonors'],
    suppress: ['allTerminalsAndHonors'],
    reason: '字一色不计混幺九',
  },
  {
    id: 'guobiao.allTerminals.noAllPungs',
    priority: 900,
    whenAll: ['allTerminals'],
    suppress: ['allPungs'],
    reason: '清幺九不计碰碰和',
  },
  {
    id: 'guobiao.allTerminals.noNoHonors',
    priority: 900,
    whenAll: ['allTerminals'],
    suppress: ['noHonors'],
    reason: '清幺九不计无字',
  },
  {
    id: 'guobiao.allTerminals.noAllTerminalsAndHonors',
    priority: 900,
    whenAll: ['allTerminals'],
    suppress: ['allTerminalsAndHonors'],
    reason: '清幺九不计混幺九',
  },
  {
    id: 'guobiao.allTerminals.noDoublePungs',
    priority: 900,
    whenAll: ['allTerminals'],
    suppress: ['doublePungs'],
    reason: '清幺九不计双同刻',
  },
  {
    id: 'guobiao.allTerminalsAndHonors.noAllPungs',
    priority: 900,
    whenAll: ['allTerminalsAndHonors'],
    suppress: ['allPungs'],
    reason: '混幺九不计碰碰和',
  },
  {
    id: 'guobiao.nineGates.noFullFlush',
    priority: 1000,
    whenAll: ['nineGates'],
    suppress: ['fullFlush'],
    reason: '九莲宝灯不计清一色',
  },
  {
    id: 'guobiao.nineGates.noNoHonors',
    priority: 1000,
    whenAll: ['nineGates'],
    suppress: ['noHonors'],
    reason: '九莲宝灯不计无字',
  },
  {
    id: 'guobiao.nineGates.noConcealedHand',
    priority: 1000,
    whenAll: ['nineGates'],
    suppress: ['concealedHand'],
    reason: '九莲宝灯点和不计门前清',
  },
  {
    id: 'guobiao.nineGates.noFullyConcealedHand',
    priority: 1000,
    whenAll: ['nineGates'],
    suppress: ['fullyConcealedHand'],
    reason: '九莲宝灯自摸不计不求人',
  },
  {
    id: 'guobiao.sevenShiftedPairs.noSevenPairs',
    priority: 1000,
    whenAll: ['sevenShiftedPairs'],
    suppress: ['sevenPairs'],
    reason: '连七对不计七对',
  },
  {
    id: 'guobiao.sevenShiftedPairs.noFullFlush',
    priority: 1000,
    whenAll: ['sevenShiftedPairs'],
    suppress: ['fullFlush'],
    reason: '连七对不计清一色',
  },
  {
    id: 'guobiao.sevenShiftedPairs.noNoHonors',
    priority: 1000,
    whenAll: ['sevenShiftedPairs'],
    suppress: ['noHonors'],
    reason: '连七对不计无字',
  },
  {
    id: 'guobiao.sevenShiftedPairs.noSingleWait',
    priority: 1000,
    whenAll: ['sevenShiftedPairs'],
    suppress: ['singleWait'],
    reason: '连七对不计单钓将',
  },
  {
    id: 'guobiao.sevenShiftedPairs.noConcealedHand',
    priority: 1000,
    whenAll: ['sevenShiftedPairs'],
    suppress: ['concealedHand'],
    reason: '连七对点和不计门前清',
  },
  {
    id: 'guobiao.sevenShiftedPairs.noFullyConcealedHand',
    priority: 1000,
    whenAll: ['sevenShiftedPairs'],
    suppress: ['fullyConcealedHand'],
    reason: '连七对自摸不计不求人',
  },
  {
    id: 'guobiao.thirteenOrphans.noAllTerminalsAndHonors',
    priority: 1000,
    whenAll: ['thirteenOrphans'],
    suppress: ['allTerminalsAndHonors'],
    reason: '十三幺不计混幺九',
  },
  {
    id: 'guobiao.thirteenOrphans.noAllTypes',
    priority: 1000,
    whenAll: ['thirteenOrphans'],
    suppress: ['allTypes'],
    reason: '十三幺不计五门齐',
  },
  {
    id: 'guobiao.thirteenOrphans.noConcealedHand',
    priority: 1000,
    whenAll: ['thirteenOrphans'],
    suppress: ['concealedHand'],
    reason: '十三幺点和不计门前清',
  },
  {
    id: 'guobiao.thirteenOrphans.noFullyConcealedHand',
    priority: 1000,
    whenAll: ['thirteenOrphans'],
    suppress: ['fullyConcealedHand'],
    reason: '十三幺自摸不计不求人',
  },
  {
    id: 'guobiao.sevenPairs.noSingleWait',
    priority: 900,
    whenAll: ['sevenPairs'],
    suppress: ['singleWait'],
    reason: '七对不计单钓将',
  },
  {
    id: 'guobiao.sevenPairs.noConcealedHand',
    priority: 900,
    whenAll: ['sevenPairs'],
    suppress: ['concealedHand'],
    reason: '七对点和不计门前清',
  },
  {
    id: 'guobiao.sevenPairs.noFullyConcealedHand',
    priority: 900,
    whenAll: ['sevenPairs'],
    suppress: ['fullyConcealedHand'],
    reason: '七对自摸不计不求人',
  },
  {
    id: 'guobiao.greaterHonorsAndKnitted.noLesserHonorsAndKnitted',
    priority: 1000,
    whenAll: ['greaterHonorsAndKnitted'],
    suppress: ['lesserHonorsAndKnitted'],
    reason: '七星不靠不计全不靠',
  },
  {
    id: 'guobiao.greaterHonorsAndKnitted.noAllTypes',
    priority: 1000,
    whenAll: ['greaterHonorsAndKnitted'],
    suppress: ['allTypes'],
    reason: '七星不靠不计五门齐',
  },
  {
    id: 'guobiao.greaterHonorsAndKnitted.noConcealedHand',
    priority: 1000,
    whenAll: ['greaterHonorsAndKnitted'],
    suppress: ['concealedHand'],
    reason: '七星不靠点和不计门前清',
  },
  {
    id: 'guobiao.greaterHonorsAndKnitted.noFullyConcealedHand',
    priority: 1000,
    whenAll: ['greaterHonorsAndKnitted'],
    suppress: ['fullyConcealedHand'],
    reason: '七星不靠自摸不计不求人',
  },
  {
    id: 'guobiao.allEvenPungs.noAllPungs',
    priority: 950,
    whenAll: ['allEvenPungs'],
    suppress: ['allPungs'],
    reason: '全双刻不计碰碰和',
  },
  {
    id: 'guobiao.allEvenPungs.noAllSimples',
    priority: 950,
    whenAll: ['allEvenPungs'],
    suppress: ['allSimples'],
    reason: '全双刻不计断幺',
  },
  {
    id: 'guobiao.allEvenPungs.noNoHonors',
    priority: 950,
    whenAll: ['allEvenPungs'],
    suppress: ['noHonors'],
    reason: '全双刻不计无字',
  },
  {
    id: 'guobiao.upperTiles.noUpperFour',
    priority: 950,
    whenAll: ['upperTiles'],
    suppress: ['upperFour'],
    reason: '全大不计大于五',
  },
  {
    id: 'guobiao.upperTiles.noNoHonors',
    priority: 950,
    whenAll: ['upperTiles'],
    suppress: ['noHonors'],
    reason: '全大不计无字',
  },
  {
    id: 'guobiao.lowerTiles.noLowerFour',
    priority: 950,
    whenAll: ['lowerTiles'],
    suppress: ['lowerFour'],
    reason: '全小不计小于五',
  },
  {
    id: 'guobiao.lowerTiles.noNoHonors',
    priority: 950,
    whenAll: ['lowerTiles'],
    suppress: ['noHonors'],
    reason: '全小不计无字',
  },
  {
    id: 'guobiao.middleTiles.noAllSimples',
    priority: 950,
    whenAll: ['middleTiles'],
    suppress: ['allSimples'],
    reason: '全中不计断幺',
  },
  {
    id: 'guobiao.upperFour.noNoHonors',
    priority: 850,
    whenAll: ['upperFour'],
    suppress: ['noHonors'],
    reason: '大于五不计无字',
  },
  {
    id: 'guobiao.lowerFour.noNoHonors',
    priority: 850,
    whenAll: ['lowerFour'],
    suppress: ['noHonors'],
    reason: '小于五不计无字',
  },
  {
    id: 'guobiao.quadrupleChow.noPureTripleChows',
    priority: 900,
    whenAll: ['quadrupleChow'],
    suppress: ['pureTripleChows'],
    reason: '一色四同顺不计一色三同顺',
  },
  {
    id: 'guobiao.quadrupleChow.noPureShiftedPungs',
    priority: 900,
    whenAll: ['quadrupleChow'],
    suppress: ['pureShiftedPungs'],
    reason: '一色四同顺不计一色三节高',
  },
  {
    id: 'guobiao.quadrupleChow.noSevenPairs',
    priority: 900,
    whenAll: ['quadrupleChow'],
    suppress: ['sevenPairs'],
    reason: '一色四同顺不计七对',
  },
  {
    id: 'guobiao.quadrupleChow.noPureDoubleChows',
    priority: 900,
    whenAll: ['quadrupleChow'],
    suppress: ['pureDoubleChows'],
    reason: '一色四同顺不计一般高',
  },
  {
    id: 'guobiao.quadrupleChow.noTileHog',
    priority: 900,
    whenAll: ['quadrupleChow'],
    suppress: ['tileHog'],
    reason: '一色四同顺不计四归一',
  },
  {
    id: 'guobiao.pureTripleChows.noPureDoubleChows',
    priority: 850,
    whenAll: ['pureTripleChows'],
    suppress: ['pureDoubleChows'],
    reason: '一色三同顺不计一般高',
  },
  {
    id: 'guobiao.pureTripleChows.noPureShiftedPungs',
    priority: 850,
    whenAll: ['pureTripleChows'],
    suppress: ['pureShiftedPungs'],
    reason: '一色三同顺不计一色三节高',
  },
  {
    id: 'guobiao.mixedTripleChows.noMixedDoubleChows',
    priority: 850,
    whenAll: ['mixedTripleChows'],
    suppress: ['mixedDoubleChows'],
    reason: '三色三同顺不计喜相逢',
  },
  {
    id: 'guobiao.fourPureShiftedChows.noPureShiftedChows',
    priority: 900,
    whenAll: ['fourPureShiftedChows'],
    suppress: ['pureShiftedChows'],
    reason: '一色四步高不计一色三步高',
  },
  {
    id: 'guobiao.fourPureLinkedChows.noPureLinkedChows',
    priority: 900,
    whenAll: ['fourPureLinkedChows'],
    suppress: ['pureLinkedChows'],
    reason: '一色四连环不计一色三连环',
  },
  {
    id: 'guobiao.fourPureLinkedChows.noTwoTerminalChows',
    priority: 850,
    whenAll: ['fourPureLinkedChows'],
    suppress: ['twoTerminalChows'],
    reason: '一色四连环不计老少副',
  },
  {
    id: 'guobiao.pureShiftedChows.noPureLinkedChows',
    priority: 860,
    whenAll: ['pureShiftedChows'],
    suppress: ['pureLinkedChows'],
    reason: '一色三步高与一色三连环同分时优先计一色三步高',
  },
  {
    id: 'guobiao.fourPureShiftedChows.noShortStraight',
    priority: 850,
    whenAll: ['fourPureShiftedChows'],
    suppress: ['shortStraight'],
    reason: '一色四步高不计连六',
  },
  {
    id: 'guobiao.fourPureShiftedChows.noTwoTerminalChows',
    priority: 850,
    whenAll: ['fourPureShiftedChows'],
    suppress: ['twoTerminalChows'],
    reason: '一色四步高不计老少副',
  },
  {
    id: 'guobiao.pureStraight.noShortStraight',
    priority: 850,
    whenAll: ['pureStraight'],
    suppress: ['shortStraight'],
    reason: '清龙不计连六',
  },
  {
    id: 'guobiao.pureStraight.noTwoTerminalChows',
    priority: 850,
    whenAll: ['pureStraight'],
    suppress: ['twoTerminalChows'],
    reason: '清龙不计老少副',
  },
  {
    id: 'guobiao.pureTerminalChows.noSevenPairs',
    priority: 1000,
    whenAll: ['pureTerminalChows'],
    suppress: ['sevenPairs'],
    reason: '一色双龙会不计七对',
  },
  {
    id: 'guobiao.pureTerminalChows.noFullFlush',
    priority: 1000,
    whenAll: ['pureTerminalChows'],
    suppress: ['fullFlush'],
    reason: '一色双龙会不计清一色',
  },
  {
    id: 'guobiao.pureTerminalChows.noNoHonors',
    priority: 1000,
    whenAll: ['pureTerminalChows'],
    suppress: ['noHonors'],
    reason: '一色双龙会不计无字',
  },
  {
    id: 'guobiao.pureTerminalChows.noAllChows',
    priority: 1000,
    whenAll: ['pureTerminalChows'],
    suppress: ['allChows'],
    reason: '一色双龙会不计平和',
  },
  {
    id: 'guobiao.pureTerminalChows.noPureDoubleChows',
    priority: 1000,
    whenAll: ['pureTerminalChows'],
    suppress: ['pureDoubleChows'],
    reason: '一色双龙会不计一般高',
  },
  {
    id: 'guobiao.pureTerminalChows.noTwoTerminalChows',
    priority: 1000,
    whenAll: ['pureTerminalChows'],
    suppress: ['twoTerminalChows'],
    reason: '一色双龙会不计老少副',
  },
  {
    id: 'guobiao.threeSuitedTerminalChows.noAllChows',
    priority: 900,
    whenAll: ['threeSuitedTerminalChows'],
    suppress: ['allChows'],
    reason: '三色双龙会不计平和',
  },
  {
    id: 'guobiao.threeSuitedTerminalChows.noNoHonors',
    priority: 900,
    whenAll: ['threeSuitedTerminalChows'],
    suppress: ['noHonors'],
    reason: '三色双龙会不计无字',
  },
  {
    id: 'guobiao.threeSuitedTerminalChows.noMixedDoubleChows',
    priority: 900,
    whenAll: ['threeSuitedTerminalChows'],
    suppress: ['mixedDoubleChows'],
    reason: '三色双龙会不计喜相逢',
  },
  {
    id: 'guobiao.threeSuitedTerminalChows.noTwoTerminalChows',
    priority: 900,
    whenAll: ['threeSuitedTerminalChows'],
    suppress: ['twoTerminalChows'],
    reason: '三色双龙会不计老少副',
  },
  {
    id: 'guobiao.allFives.noAllSimples',
    priority: 850,
    whenAll: ['allFives'],
    suppress: ['allSimples'],
    reason: '全带五不计断幺',
  },
  {
    id: 'guobiao.allFives.noNoHonors',
    priority: 850,
    whenAll: ['allFives'],
    suppress: ['noHonors'],
    reason: '全带五不计无字',
  },
  {
    id: 'guobiao.allHonors.noOutsideHand',
    priority: 850,
    whenAll: ['allHonors'],
    suppress: ['outsideHand'],
    reason: '字一色不计全带幺',
  },
  {
    id: 'guobiao.allHonors.noPungOfTerminalsOrHonors',
    priority: 850,
    whenAll: ['allHonors'],
    suppress: ['pungOfTerminalsOrHonors'],
    reason: '字一色不计幺九刻',
  },
  {
    id: 'guobiao.allTerminals.noOutsideHand',
    priority: 850,
    whenAll: ['allTerminals'],
    suppress: ['outsideHand'],
    reason: '清幺九不计全带幺',
  },
  {
    id: 'guobiao.allTerminals.noPungOfTerminalsOrHonors',
    priority: 850,
    whenAll: ['allTerminals'],
    suppress: ['pungOfTerminalsOrHonors'],
    reason: '清幺九不计幺九刻',
  },
  {
    id: 'guobiao.allTerminalsAndHonors.noOutsideHand',
    priority: 850,
    whenAll: ['allTerminalsAndHonors'],
    suppress: ['outsideHand'],
    reason: '混幺九不计全带幺',
  },
  {
    id: 'guobiao.allTerminalsAndHonors.noPungOfTerminalsOrHonors',
    priority: 850,
    whenAll: ['allTerminalsAndHonors'],
    suppress: ['pungOfTerminalsOrHonors'],
    reason: '混幺九不计幺九刻',
  },
  {
    id: 'guobiao.reversibleTiles.noOneVoidedSuit',
    priority: 850,
    whenAll: ['reversibleTiles'],
    suppress: ['oneVoidedSuit'],
    reason: '推不倒不计缺一门',
  },
  {
    id: 'guobiao.fourPureShiftedPungs.noPureShiftedPungs',
    priority: 900,
    whenAll: ['fourPureShiftedPungs'],
    suppress: ['pureShiftedPungs'],
    reason: '一色四节高不计一色三节高',
  },
  {
    id: 'guobiao.fourPureShiftedPungs.noPureTripleChows',
    priority: 900,
    whenAll: ['fourPureShiftedPungs'],
    suppress: ['pureTripleChows'],
    reason: '一色四节高不计一色三同顺',
  },
  {
    id: 'guobiao.fourPureShiftedPungs.noAllPungs',
    priority: 900,
    whenAll: ['fourPureShiftedPungs'],
    suppress: ['allPungs'],
    reason: '一色四节高不计碰碰和',
  },
  {
    id: 'guobiao.triplePung.noDoublePungs',
    priority: 900,
    whenAll: ['triplePung'],
    suppress: ['doublePungs'],
    reason: '三同刻不计双同刻',
  },
  {
    id: 'guobiao.fourConcealedPungs.noAllPungs',
    priority: 1000,
    whenAll: ['fourConcealedPungs'],
    suppress: ['allPungs'],
    reason: '四暗刻不计碰碰和',
  },
  {
    id: 'guobiao.fourConcealedPungs.noThreeConcealedPungs',
    priority: 1000,
    whenAll: ['fourConcealedPungs'],
    suppress: ['threeConcealedPungs'],
    reason: '四暗刻不计三暗刻',
  },
  {
    id: 'guobiao.fourConcealedPungs.noTwoConcealedPungs',
    priority: 1000,
    whenAll: ['fourConcealedPungs'],
    suppress: ['twoConcealedPungs'],
    reason: '四暗刻不计双暗刻',
  },
  {
    id: 'guobiao.fourConcealedPungs.noConcealedHand',
    priority: 1000,
    whenAll: ['fourConcealedPungs'],
    suppress: ['concealedHand'],
    reason: '四暗刻不计门前清',
  },
  {
    id: 'guobiao.fourConcealedPungs.noFullyConcealedHand',
    priority: 1000,
    whenAll: ['fourConcealedPungs'],
    suppress: ['fullyConcealedHand'],
    reason: '四暗刻不计不求人',
  },
  {
    id: 'guobiao.threeConcealedPungs.noTwoConcealedPungs',
    priority: 900,
    whenAll: ['threeConcealedPungs'],
    suppress: ['twoConcealedPungs'],
    reason: '三暗刻不计双暗刻',
  },
  {
    id: 'guobiao.twoConcealedKongs.noTwoConcealedPungs',
    priority: 900,
    whenAll: ['twoConcealedKongs'],
    suppress: ['twoConcealedPungs'],
    reason: '双暗杠不计双暗刻',
  },
  {
    id: 'guobiao.fullyConcealedHand.noSelfDrawn',
    priority: 850,
    whenAll: ['fullyConcealedHand'],
    suppress: ['selfDrawn'],
    reason: '不求人不计自摸',
  },
  {
    id: 'guobiao.fullyConcealedHand.noConcealedHand',
    priority: 850,
    whenAll: ['fullyConcealedHand'],
    suppress: ['concealedHand'],
    reason: '不求人不计门前清',
  },
  {
    id: 'guobiao.meldedHand.noSingleWait',
    priority: 850,
    whenAll: ['meldedHand'],
    suppress: ['singleWait'],
    reason: '全求人不计单钓将',
  },
  {
    id: 'guobiao.lastTileDraw.noSelfDrawn',
    priority: 900,
    whenAll: ['lastTileDraw'],
    suppress: ['selfDrawn'],
    reason: '妙手回春不计自摸',
  },
  {
    id: 'guobiao.outWithReplacementTile.noSelfDrawn',
    priority: 900,
    whenAll: ['outWithReplacementTile'],
    suppress: ['selfDrawn'],
    reason: '杠上开花不计自摸',
  },
  {
    id: 'guobiao.robbingTheKong.noLastTile',
    priority: 900,
    whenAll: ['robbingTheKong'],
    suppress: ['lastTile'],
    reason: '抢杠和不计和绝张',
  },
  {
    id: 'guobiao.allChows.noNoHonors',
    priority: 850,
    whenAll: ['allChows'],
    suppress: ['noHonors'],
    reason: '平和不计无字',
  },
  {
    id: 'guobiao.allChows.noEdgeWait',
    priority: 850,
    whenAll: ['allChows'],
    suppress: ['edgeWait'],
    reason: '平和不计边张',
  },
  {
    id: 'guobiao.allChows.noClosedWait',
    priority: 850,
    whenAll: ['allChows'],
    suppress: ['closedWait'],
    reason: '平和不计坎张',
  },
  {
    id: 'guobiao.allChows.noSingleWait',
    priority: 850,
    whenAll: ['allChows'],
    suppress: ['singleWait'],
    reason: '平和不计单钓将',
  },
] as const satisfies ReadonlyArray<GuobiaoFanExclusionRule>;

export function analyzeGuobiaoClosedWinShape(tileKeys: ReadonlyArray<number>): GuobiaoClosedWinShapeResult {
  const nonFlowerTiles: Array<number> = [];
  const flowerTiles: Array<number> = [];

  for (const raw of tileKeys) {
    if (!isGuobiaoTileKey(raw)) {
      throw new Error(`invalid guobiao tile key: ${raw}`);
    }
    if (isGuobiaoFlower(raw)) {
      flowerTiles.push(raw);
    } else {
      nonFlowerTiles.push(raw);
    }
  }

  if (nonFlowerTiles.length !== 14) {
    return { valid: false, kind: null, nonFlowerTiles, flowerTiles };
  }

  const counts = countGuobiaoTileKeys(nonFlowerTiles);
  if (isThirteenOrphansCounts(counts)) {
    return { valid: true, kind: 'thirteenOrphans', nonFlowerTiles, flowerTiles };
  }
  if (isNineGatesCounts(counts)) {
    return { valid: true, kind: 'nineGates', nonFlowerTiles, flowerTiles };
  }
  if (isSevenShiftedPairsCounts(counts)) {
    return { valid: true, kind: 'sevenShiftedPairs', nonFlowerTiles, flowerTiles };
  }
  if (isSevenPairsCounts(counts)) {
    return { valid: true, kind: 'sevenPairs', nonFlowerTiles, flowerTiles };
  }
  if (isGreaterHonorsAndKnittedCounts(counts)) {
    return { valid: true, kind: 'greaterHonorsAndKnitted', nonFlowerTiles, flowerTiles };
  }
  if (isLesserHonorsAndKnittedCounts(counts)) {
    return { valid: true, kind: 'lesserHonorsAndKnitted', nonFlowerTiles, flowerTiles };
  }
  if (isKnittedStraightCounts(counts)) {
    return { valid: true, kind: 'knittedStraight', nonFlowerTiles, flowerTiles };
  }
  if (canFormStandardHand(counts)) {
    return { valid: true, kind: 'standard', nonFlowerTiles, flowerTiles };
  }
  return { valid: false, kind: null, nonFlowerTiles, flowerTiles };
}

export function calculateGuobiaoFans(input: GuobiaoFanInput): GuobiaoFanResult {
  const analysis = analyzeGuobiaoFanInput(input);
  const shape = analysis.shape;
  if (!shape.valid) {
    return {
      valid: false,
      shape,
      fans: [],
      candidateFans: [],
      suppressedFans: [],
      fanTotal: 0,
      qualifyingFanTotal: 0,
    };
  }

  const resolved = chooseBestFanBranch(buildGuobiaoFanBranches(analysis));
  return {
    valid: true,
    shape,
    fans: resolved.fans,
    candidateFans: resolved.candidateFans,
    suppressedFans: resolved.suppressedFans,
    fanTotal: resolved.fanTotal,
    qualifyingFanTotal: resolved.qualifyingFanTotal,
  };
}

function buildGuobiaoFanBranches(analysis: GuobiaoFanAnalysis): Array<GuobiaoFanBranch> {
  const shape = analysis.shape;
  if (!shape.valid) return [];

  const branches: Array<GuobiaoFanBranch> = [];

  const pushBranch = (build: (branch: GuobiaoFanBranch) => void): void => {
    const branch = makeFanBranch();
    build(branch);
    applyContextFans(analysis.context, branch.candidateFans, branch.applied);
    applyConcealedSourceFans(analysis.fixedMelds, analysis.context, branch.candidateFans, branch.applied);
    applyKongFans(analysis.fixedMelds, branch.candidateFans, branch.applied);
    applyFlowerFans(analysis.flowerCount, branch.candidateFans, branch.applied);
    branches.push(branch);
  };

  if (shape.kind === 'thirteenOrphans') {
    pushBranch((branch) => {
      applyFan(branch.candidateFans, branch.applied, 'thirteenOrphans');
      applyTileCompositionFans(analysis, branch.candidateFans, branch.applied);
    });
  } else if (shape.kind === 'nineGates') {
    const decompositions = analysis.decompositions.length > 0 ? analysis.decompositions : [null];
    for (const decomposition of decompositions) {
      pushBranch((branch) => {
        applyFan(branch.candidateFans, branch.applied, 'nineGates');
        applyTileCompositionFans(analysis, branch.candidateFans, branch.applied);
        if (decomposition !== null) {
          applyStandardDecompositionFans([decomposition], analysis.context, branch.candidateFans, branch.applied);
        }
      });
    }
  } else if (shape.kind === 'sevenShiftedPairs') {
    pushBranch((branch) => {
      applyFan(branch.candidateFans, branch.applied, 'sevenShiftedPairs');
      applyFan(branch.candidateFans, branch.applied, 'sevenPairs');
      applyTileCompositionFans(analysis, branch.candidateFans, branch.applied);
    });
  } else if (shape.kind === 'sevenPairs') {
    for (const decomposition of analysis.decompositions.filter(hasPureTerminalChows)) {
      pushBranch((branch) => {
        applyFan(branch.candidateFans, branch.applied, 'sevenPairs');
        applyTileCompositionFans(analysis, branch.candidateFans, branch.applied);
        applyStandardDecompositionFans([decomposition], analysis.context, branch.candidateFans, branch.applied);
      });
    }
    pushBranch((branch) => {
      applyFan(branch.candidateFans, branch.applied, 'sevenPairs');
      applyTileCompositionFans(analysis, branch.candidateFans, branch.applied);
    });
  } else if (shape.kind === 'greaterHonorsAndKnitted') {
    pushBranch((branch) => {
      applyFan(branch.candidateFans, branch.applied, 'greaterHonorsAndKnitted');
      applyFan(branch.candidateFans, branch.applied, 'lesserHonorsAndKnitted');
    });
  } else if (shape.kind === 'lesserHonorsAndKnitted') {
    pushBranch((branch) => {
      applyFan(branch.candidateFans, branch.applied, 'lesserHonorsAndKnitted');
    });
  } else if (shape.kind === 'knittedStraight') {
    pushBranch((branch) => {
      applyFan(branch.candidateFans, branch.applied, 'knittedStraight');
      applyTileCompositionFans(analysis, branch.candidateFans, branch.applied);
    });
  } else {
    for (const decomposition of analysis.decompositions) {
      pushBranch((branch) => {
        applyTileCompositionFans(analysis, branch.candidateFans, branch.applied);
        applyStandardDecompositionFans([decomposition], analysis.context, branch.candidateFans, branch.applied);
      });
    }
  }

  return branches.length > 0 ? branches : [makeFanBranch()];
}

function makeFanBranch(): GuobiaoFanBranch {
  return {
    candidateFans: [],
    applied: new Set<GuobiaoFanId>(),
  };
}

function resolveFanBranch(branch: GuobiaoFanBranch): GuobiaoFanResolvedBranch {
  const { fans, suppressedFans } = applyFanExclusions(branch.candidateFans);
  const candidateFans = [...branch.candidateFans];
  const resolvedFans = [...fans];
  const qualifyingBeforeChicken = resolvedFans.reduce((sum, fan) => (
    sum + (fan.countsTowardMinFan ? fan.points : 0)
  ), 0);

  if (qualifyingBeforeChicken === 0) {
    const applied = new Set(branch.applied);
    applyFan(candidateFans, applied, 'chickenHand');
    const chickenHand = candidateFans[candidateFans.length - 1];
    if (chickenHand) resolvedFans.push(chickenHand);
  }

  const fanTotal = resolvedFans.reduce((sum, fan) => sum + fan.points, 0);
  const qualifyingFanTotal = resolvedFans.reduce((sum, fan) => sum + (fan.countsTowardMinFan ? fan.points : 0), 0);
  return {
    candidateFans,
    fans: resolvedFans,
    suppressedFans,
    fanTotal,
    qualifyingFanTotal,
  };
}

function chooseBestFanBranch(branches: ReadonlyArray<GuobiaoFanBranch>): GuobiaoFanResolvedBranch {
  const resolved = branches.map(resolveFanBranch);
  resolved.sort(compareResolvedFanBranches);
  return resolved[0] ?? {
    candidateFans: [],
    fans: [],
    suppressedFans: [],
    fanTotal: 0,
    qualifyingFanTotal: 0,
  };
}

function compareResolvedFanBranches(a: GuobiaoFanResolvedBranch, b: GuobiaoFanResolvedBranch): number {
  if (a.qualifyingFanTotal !== b.qualifyingFanTotal) return b.qualifyingFanTotal - a.qualifyingFanTotal;
  if (a.fanTotal !== b.fanTotal) return b.fanTotal - a.fanTotal;
  if (a.fans.length !== b.fans.length) return a.fans.length - b.fans.length;
  return fanIdTieBreakKey(a.fans).localeCompare(fanIdTieBreakKey(b.fans));
}

function fanIdTieBreakKey(fans: ReadonlyArray<GuobiaoFanApplied>): string {
  return fans.map((fan) => fan.id).sort((a, b) => a.localeCompare(b)).join('|');
}

function analyzeGuobiaoFanInput(input: GuobiaoFanInput): GuobiaoFanAnalysis {
  const rawHandTiles = input.handTiles ?? input.tiles ?? [];
  const handNonFlowerTiles: Array<number> = [];
  const handFlowerTiles: Array<number> = [];
  for (const raw of rawHandTiles) {
    if (!isGuobiaoTileKey(raw)) {
      throw new Error(`invalid guobiao tile key: ${raw}`);
    }
    if (isGuobiaoFlower(raw)) {
      handFlowerTiles.push(raw);
    } else {
      handNonFlowerTiles.push(raw);
    }
  }

  const fixedMelds = (input.melds ?? []).map(normalizeFanMeld);
  const explicitFlowerCount =
    typeof input.flowerCount === 'number' && Number.isFinite(input.flowerCount)
      ? Math.max(0, Math.trunc(input.flowerCount))
      : null;
  const flowerCount = explicitFlowerCount ?? handFlowerTiles.length;
  const context = normalizeWinContext(input);

  if (fixedMelds.length === 0) {
    const shape = analyzeGuobiaoClosedWinShape(rawHandTiles);
    const decompositions = shape.valid && (shape.kind === 'standard' || shape.kind === 'nineGates' || shape.kind === 'sevenPairs')
      ? decomposeStandardCounts(countGuobiaoTileKeys(shape.nonFlowerTiles), 4).map((d) => ({
        melds: d.melds,
        pairKey: d.pairKey,
      }))
      : [];
    return {
      shape,
      handNonFlowerTiles,
      handFlowerTiles,
      fixedMelds,
      decompositions,
      allNonFlowerTiles: [...handNonFlowerTiles],
      flowerCount,
      context,
    };
  }

  const meldCount = fixedMelds.length;
  const setsNeeded = 4 - meldCount;
  const expectedHandTiles = setsNeeded >= 0 ? 2 + setsNeeded * 3 : -1;
  if (setsNeeded < 0 || handNonFlowerTiles.length !== expectedHandTiles) {
    return {
      shape: { valid: false, kind: null, nonFlowerTiles: handNonFlowerTiles, flowerTiles: handFlowerTiles },
      handNonFlowerTiles,
      handFlowerTiles,
      fixedMelds,
      decompositions: [],
      allNonFlowerTiles: [...handNonFlowerTiles, ...fixedMelds.flatMap((m) => m.tileKeys)],
      flowerCount,
      context,
    };
  }

  const openDecompositions = decomposeStandardCounts(countGuobiaoTileKeys(handNonFlowerTiles), setsNeeded)
    .map((d) => ({
      melds: [...fixedMelds, ...d.melds],
      pairKey: d.pairKey,
    }));
  const valid = openDecompositions.length > 0;
  return {
    shape: { valid, kind: valid ? 'standard' : null, nonFlowerTiles: handNonFlowerTiles, flowerTiles: handFlowerTiles },
    handNonFlowerTiles,
    handFlowerTiles,
    fixedMelds,
    decompositions: openDecompositions,
    allNonFlowerTiles: [...handNonFlowerTiles, ...fixedMelds.flatMap((m) => m.tileKeys)],
    flowerCount,
    context,
  };
}

function normalizeFanMeld(meld: GuobiaoFanMeld): FanMeldUnit {
  const tileKeys = meld.tileKeys.map((raw) => {
    if (!isGuobiaoTileKey(raw) || isGuobiaoFlower(raw)) {
      throw new Error(`invalid guobiao meld tile key: ${raw}`);
    }
    return raw;
  });

  if (meld.kind === 'chi') {
    if (tileKeys.length !== 3) throw new Error('invalid guobiao chi meld size');
    const sorted = [...tileKeys].sort((a, b) => a - b);
    const [a, b, c] = sorted;
    if (
      a === undefined ||
      b === undefined ||
      c === undefined ||
      !canStartSequence(a) ||
      b !== a + 1 ||
      c !== a + 2 ||
      guobiaoTileGroup(a) !== guobiaoTileGroup(b) ||
      guobiaoTileGroup(a) !== guobiaoTileGroup(c)
    ) {
      throw new Error('invalid guobiao chi meld sequence');
    }
    return { kind: 'chow', tileKeys: sorted, baseKey: a, concealed: false, source: 'meld', originalKind: meld.kind };
  }

  const requiredSize = meld.kind === 'peng' ? 3 : 4;
  if (tileKeys.length !== requiredSize) {
    throw new Error(`invalid guobiao ${meld.kind} meld size`);
  }
  const baseKey = tileKeys[0]!;
  if (!tileKeys.every((key) => key === baseKey)) {
    throw new Error(`invalid guobiao ${meld.kind} meld tiles`);
  }
  return {
    kind: meld.kind === 'peng' ? 'pung' : 'kong',
    tileKeys,
    baseKey,
    concealed: meld.kind === 'anGang' || meld.concealed === true,
    source: 'meld',
    originalKind: meld.kind,
  };
}

function normalizeWinContext(input: GuobiaoFanInput): NormalizedWinContext {
  const context = input.winContext ?? {};
  return {
    isSelfDrawn: context.isSelfDrawn === true || input.isSelfDrawn === true,
    isRobbingKong: context.isRobbingKong === true || input.isRobbingKong === true,
    isKongDraw: context.isKongDraw === true || input.isKongDraw === true,
    isLastTileDraw: context.isLastTileDraw === true || input.isLastTileDraw === true,
    isLastTileClaim: context.isLastTileClaim === true || input.isLastTileClaim === true,
    isLastTile: context.isLastTile === true || input.isLastTile === true,
    isHeavenlyHand: context.isHeavenlyHand === true,
    isEarthlyHand: context.isEarthlyHand === true,
    isHumanHandOne: context.isHumanHandOne === true,
    isHumanHandTwo: context.isHumanHandTwo === true,
    winningTileKey: normalizeWinningTileKey(context.winningTileKey),
    seatWindKey: normalizeWindKey(context.seatWind ?? input.seatWind),
    roundWindKey: normalizeWindKey(context.prevalentWind ?? context.roundWind ?? input.roundWind),
    waitKind: context.waitKind ?? null,
  };
}

function normalizeWinningTileKey(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!isGuobiaoTileKey(value) || isGuobiaoFlower(value)) {
    throw new Error(`invalid guobiao winning tile key: ${value}`);
  }
  return value;
}

function normalizeWindKey(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  if (n >= 27 && n <= 30) return n;
  if (n >= 0 && n <= 3) return 27 + n;
  return null;
}

function applyTileCompositionFans(
  analysis: GuobiaoFanAnalysis,
  fans: Array<GuobiaoFanApplied>,
  applied: Set<GuobiaoFanId>,
): void {
  const tiles = analysis.allNonFlowerTiles;
  if (tiles.length === 0) return;

  const suits = new Set<number>();
  let hasHonor = false;
  let hasWind = false;
  let hasDragon = false;
  for (const tileKey of tiles) {
    const suit = numberSuitIndex(tileKey);
    if (suit !== null) suits.add(suit);
    if (isGuobiaoHonor(tileKey)) {
      hasHonor = true;
      if (guobiaoTileGroup(tileKey) === 'wind') hasWind = true;
      if (guobiaoTileGroup(tileKey) === 'dragon') hasDragon = true;
    }
  }

  const allHonors = tiles.every(isGuobiaoHonor);
  const allTerminals = tiles.every(isTerminal);
  const allTerminalsAndHonors = tiles.every(isTerminalOrHonor) && !allTerminals && !allHonors;
  const fullFlush = suits.size === 1 && !hasHonor;
  const halfFlush = suits.size === 1 && hasHonor;
  const allSimples = tiles.every(isSimple);

  if (tiles.every((tileKey) => GREEN_TILE_KEYS.has(tileKey))) {
    applyFan(fans, applied, 'allGreen');
  }

  if (allHonors) {
    applyFan(fans, applied, 'allHonors');
  } else if (allTerminals) {
    applyFan(fans, applied, 'allTerminals');
  } else if (allTerminalsAndHonors) {
    applyFan(fans, applied, 'allTerminalsAndHonors');
  }

  if (fullFlush) {
    applyFan(fans, applied, 'fullFlush');
  } else if (halfFlush) {
    applyFan(fans, applied, 'halfFlush');
  }

  if (allSimples) {
    applyFan(fans, applied, 'allSimples');
  } else if (!hasHonor) {
    applyFan(fans, applied, 'noHonors');
  }

  if (allNumberRanksIn(tiles, UPPER_TILE_RANKS)) {
    applyFan(fans, applied, 'upperTiles');
  } else if (allNumberRanksIn(tiles, MIDDLE_TILE_RANKS)) {
    applyFan(fans, applied, 'middleTiles');
  } else if (allNumberRanksIn(tiles, LOWER_TILE_RANKS)) {
    applyFan(fans, applied, 'lowerTiles');
  }

  if (allNumberRanksIn(tiles, UPPER_FOUR_RANKS)) {
    applyFan(fans, applied, 'upperFour');
  } else if (allNumberRanksIn(tiles, LOWER_FOUR_RANKS)) {
    applyFan(fans, applied, 'lowerFour');
  }

  if (tiles.every((tileKey) => REVERSIBLE_TILE_KEYS.has(tileKey))) {
    applyFan(fans, applied, 'reversibleTiles');
  }

  if (!fullFlush && !halfFlush && suits.size === 2) {
    applyFan(fans, applied, 'oneVoidedSuit');
  }

  if (suits.has(0) && suits.has(1) && suits.has(2) && hasWind && hasDragon) {
    applyFan(fans, applied, 'allTypes');
  }

  const tileHogCount = countTileHogs(analysis);
  if (tileHogCount > 0) {
    applyFan(fans, applied, 'tileHog', tileHogCount);
  }
}

function applyStandardDecompositionFans(
  decompositions: ReadonlyArray<StandardDecomposition>,
  context: NormalizedWinContext,
  fans: Array<GuobiaoFanApplied>,
  applied: Set<GuobiaoFanId>,
): void {
  if (decompositions.length === 0) return;

  if (decompositions.some(isAllPungsDecomposition)) {
    applyFan(fans, applied, 'allPungs');
  }

  applyConcealedPungFans(decompositions, context, fans, applied);
  applyInferredWaitFans(decompositions, context, fans, applied);

  if (decompositions.some((decomposition) => isMeldedHand(decomposition, context))) {
    applyFan(fans, applied, 'meldedHand');
  }

  if (decompositions.some(isAllEvenPungsDecomposition)) {
    applyFan(fans, applied, 'allEvenPungs');
  }

  if (decompositions.some(hasAllFives)) {
    applyFan(fans, applied, 'allFives');
  }

  if (decompositions.some(hasOutsideHand)) {
    applyFan(fans, applied, 'outsideHand');
  }

  if (decompositions.some(hasFourPureShiftedPungs)) {
    applyFan(fans, applied, 'fourPureShiftedPungs');
  }

  if (decompositions.some(hasPureShiftedPungs)) {
    applyFan(fans, applied, 'pureShiftedPungs');
  }

  if (decompositions.some(hasTriplePung)) {
    applyFan(fans, applied, 'triplePung');
  }

  if (decompositions.some(hasMixedShiftedPungs)) {
    applyFan(fans, applied, 'mixedShiftedPungs');
  }

  const doublePungsCount = Math.max(0, ...decompositions.map(countDoublePungs));
  if (doublePungsCount > 0) {
    applyFan(fans, applied, 'doublePungs', doublePungsCount);
  }

  const terminalPungCount = Math.max(0, ...decompositions.map((decomposition) => (
    countPungsOfTerminalsOrHonors(decomposition, context)
  )));
  if (terminalPungCount > 0) {
    applyFan(fans, applied, 'pungOfTerminalsOrHonors', terminalPungCount);
  }

  if (decompositions.some(isAllChowsDecomposition)) {
    applyFan(fans, applied, 'allChows');
  }

  if (decompositions.some(hasQuadrupleChow)) {
    applyFan(fans, applied, 'quadrupleChow');
  }

  if (decompositions.some(hasFourPureShiftedChows)) {
    applyFan(fans, applied, 'fourPureShiftedChows');
  }

  if (decompositions.some(hasFourPureLinkedChows)) {
    applyFan(fans, applied, 'fourPureLinkedChows');
  }

  if (decompositions.some(hasPureTerminalChows)) {
    applyFan(fans, applied, 'pureTerminalChows');
  }

  if (decompositions.some(hasThreeSuitedTerminalChows)) {
    applyFan(fans, applied, 'threeSuitedTerminalChows');
  }

  if (decompositions.some(hasPureTripleChows)) {
    applyFan(fans, applied, 'pureTripleChows');
  }

  if (decompositions.some(hasPureShiftedChows)) {
    applyFan(fans, applied, 'pureShiftedChows');
  }

  if (decompositions.some(hasPureLinkedChows)) {
    applyFan(fans, applied, 'pureLinkedChows');
  }

  if (decompositions.some(hasMixedTripleChows)) {
    applyFan(fans, applied, 'mixedTripleChows');
  }

  if (decompositions.some(hasMixedShiftedChows)) {
    applyFan(fans, applied, 'mixedShiftedChows');
  }

  if (decompositions.some(hasPureStraight)) {
    applyFan(fans, applied, 'pureStraight');
  }

  if (decompositions.some(hasMixedStraight)) {
    applyFan(fans, applied, 'mixedStraight');
  }

  const pureDoubleChowsCount = Math.max(0, ...decompositions.map(countPureDoubleChows));
  if (pureDoubleChowsCount > 0) {
    applyFan(fans, applied, 'pureDoubleChows', pureDoubleChowsCount);
  }

  const mixedDoubleChowsCount = Math.max(0, ...decompositions.map(countMixedDoubleChows));
  if (mixedDoubleChowsCount > 0) {
    applyFan(fans, applied, 'mixedDoubleChows', mixedDoubleChowsCount);
  }

  const shortStraightCount = Math.max(0, ...decompositions.map(countShortStraights));
  if (shortStraightCount > 0) {
    applyFan(fans, applied, 'shortStraight', shortStraightCount);
  }

  const twoTerminalChowsCount = Math.max(0, ...decompositions.map(countTwoTerminalChows));
  if (twoTerminalChowsCount > 0) {
    applyFan(fans, applied, 'twoTerminalChows', twoTerminalChowsCount);
  }

  applyHonorPungFans(decompositions, context, fans, applied);
}

function applyHonorPungFans(
  decompositions: ReadonlyArray<StandardDecomposition>,
  context: NormalizedWinContext,
  fans: Array<GuobiaoFanApplied>,
  applied: Set<GuobiaoFanId>,
): void {
  let maxDragonPungs = 0;
  let hasLittleThreeDragons = false;
  let hasBigFourWinds = false;
  let hasLittleFourWinds = false;
  let hasBigThreeWinds = false;
  let hasSeatWind = false;
  let hasRoundWind = false;

  for (const decomposition of decompositions) {
    const pungKeys = decomposition.melds
      .filter((m) => m.kind === 'pung' || m.kind === 'kong')
      .map((m) => m.baseKey);
    const dragonPungs = pungKeys.filter((key) => guobiaoTileGroup(key) === 'dragon').length;
    maxDragonPungs = Math.max(maxDragonPungs, dragonPungs);
    if (dragonPungs === 2 && guobiaoTileGroup(decomposition.pairKey) === 'dragon') {
      hasLittleThreeDragons = true;
    }

    const windPungs = new Set(pungKeys.filter((key) => guobiaoTileGroup(key) === 'wind'));
    if (windPungs.size === 4) {
      hasBigFourWinds = true;
    } else if (windPungs.size === 3 && guobiaoTileGroup(decomposition.pairKey) === 'wind') {
      hasLittleFourWinds = true;
    } else if (windPungs.size === 3) {
      hasBigThreeWinds = true;
    }

    if (context.seatWindKey !== null && windPungs.has(context.seatWindKey)) hasSeatWind = true;
    if (context.roundWindKey !== null && windPungs.has(context.roundWindKey)) hasRoundWind = true;
  }

  if (maxDragonPungs >= 3) {
    applyFan(fans, applied, 'bigThreeDragons');
    applyFan(fans, applied, 'twoDragonPungs');
    applyFan(fans, applied, 'dragonPung');
  } else if (hasLittleThreeDragons) {
    applyFan(fans, applied, 'littleThreeDragons');
    applyFan(fans, applied, 'twoDragonPungs');
    applyFan(fans, applied, 'dragonPung');
  } else if (maxDragonPungs === 2) {
    applyFan(fans, applied, 'twoDragonPungs');
    applyFan(fans, applied, 'dragonPung');
  } else if (maxDragonPungs === 1) {
    applyFan(fans, applied, 'dragonPung');
  }

  if (hasBigFourWinds) {
    applyFan(fans, applied, 'bigFourWinds');
  } else if (hasLittleFourWinds) {
    applyFan(fans, applied, 'littleFourWinds');
  } else if (hasBigThreeWinds) {
    applyFan(fans, applied, 'bigThreeWinds');
  }

  if (!hasLittleFourWinds) {
    if (hasRoundWind) applyFan(fans, applied, 'prevalentWind');
    if (hasSeatWind) applyFan(fans, applied, 'seatWind');
  }
}

function applyContextFans(
  context: NormalizedWinContext,
  fans: Array<GuobiaoFanApplied>,
  applied: Set<GuobiaoFanId>,
): void {
  if (context.isHeavenlyHand) applyFan(fans, applied, 'heavenlyHand');
  if (context.isEarthlyHand) applyFan(fans, applied, 'earthlyHand');
  if (context.isHumanHandOne) applyFan(fans, applied, 'humanHandOne');
  if (context.isHumanHandTwo) applyFan(fans, applied, 'humanHandTwo');
  if (context.isLastTileDraw) applyFan(fans, applied, 'lastTileDraw');
  if (context.isLastTileClaim) applyFan(fans, applied, 'lastTileClaim');
  if (context.isKongDraw) applyFan(fans, applied, 'outWithReplacementTile');
  if (context.isRobbingKong) applyFan(fans, applied, 'robbingTheKong');
  if (context.isLastTile) applyFan(fans, applied, 'lastTile');
  if (context.isSelfDrawn) applyFan(fans, applied, 'selfDrawn');
  if (context.waitKind === 'edge') applyFan(fans, applied, 'edgeWait');
  if (context.waitKind === 'closed') applyFan(fans, applied, 'closedWait');
  if (context.waitKind === 'single') applyFan(fans, applied, 'singleWait');
}

function applyConcealedSourceFans(
  fixedMelds: ReadonlyArray<FanMeldUnit>,
  context: NormalizedWinContext,
  fans: Array<GuobiaoFanApplied>,
  applied: Set<GuobiaoFanId>,
): void {
  if (hasOpenMeld(fixedMelds)) return;
  if (context.isSelfDrawn) {
    applyFan(fans, applied, 'fullyConcealedHand');
  } else if (context.winningTileKey !== null) {
    applyFan(fans, applied, 'concealedHand');
  }
}

function applyKongFans(
  fixedMelds: ReadonlyArray<FanMeldUnit>,
  fans: Array<GuobiaoFanApplied>,
  applied: Set<GuobiaoFanId>,
): void {
  const kongs = fixedMelds.filter((m) => m.kind === 'kong');
  if (kongs.length === 0) return;
  const concealed = kongs.filter((m) => m.concealed).length;
  const melded = kongs.length - concealed;

  if (kongs.length >= 4) {
    applyFan(fans, applied, 'fourKongs');
    return;
  }
  if (kongs.length === 3) {
    applyFan(fans, applied, 'threeKongs');
    return;
  }
  if (concealed >= 2 && melded === 0) {
    applyFan(fans, applied, 'twoConcealedKongs');
    return;
  }
  if (melded >= 2 && concealed === 0) {
    applyFan(fans, applied, 'twoMeldedKongs');
    return;
  }
  if (concealed >= 1 && melded >= 1) {
    // Standard MCR combines the two official kong patterns (2 + 1).
    applyFan(fans, applied, 'concealedKong');
    applyFan(fans, applied, 'meldedKong');
    return;
  }
  if (concealed === 1) {
    applyFan(fans, applied, 'concealedKong');
  } else if (melded === 1) {
    applyFan(fans, applied, 'meldedKong');
  }
}

function applyFlowerFans(
  flowerCount: number,
  fans: Array<GuobiaoFanApplied>,
  applied: Set<GuobiaoFanId>,
): void {
  if (flowerCount <= 0) return;
  applyFan(fans, applied, 'flowerTile', flowerCount);
}

function applyFan(
  fans: Array<GuobiaoFanApplied>,
  applied: Set<GuobiaoFanId>,
  id: GuobiaoFanId,
  count: number = 1,
): void {
  const normalizedCount = Math.max(1, Math.trunc(count));
  if (applied.has(id)) return;
  const definition = GUOBIAO_FAN_DEFINITION_BY_ID.get(id);
  if (!definition) throw new Error(`unknown guobiao fan id: ${id}`);
  // Standard MCR exposes only the 81 official patterns.
  if (!definition.official) return;
  applied.add(id);
  fans.push({
    id,
    name: definition.name,
    points: definition.points * normalizedCount,
    count: normalizedCount > 1 ? normalizedCount : undefined,
    countsTowardMinFan: definition.countsTowardMinFan,
  });
}

function applyFanExclusions(candidateFans: ReadonlyArray<GuobiaoFanApplied>): {
  fans: Array<GuobiaoFanApplied>;
  suppressedFans: Array<GuobiaoFanSuppressed>;
} {
  const candidateById = new Map<GuobiaoFanId, GuobiaoFanApplied>();
  for (const fan of candidateFans) {
    candidateById.set(fan.id, fan);
  }

  const suppressedById = new Map<GuobiaoFanId, GuobiaoFanSuppressed>();
  const rules = [...GUOBIAO_FAN_EXCLUSION_RULES].sort((a, b) => b.priority - a.priority);
  for (const rule of rules) {
    if (!rule.whenAll.every((id) => candidateById.has(id) && !suppressedById.has(id))) continue;

    for (const id of rule.suppress) {
      if (suppressedById.has(id)) continue;
      const fan = candidateById.get(id);
      if (!fan) continue;
      suppressedById.set(id, {
        ...fan,
        by: [...rule.whenAll],
        ruleId: rule.id,
        reason: rule.reason,
      });
    }
  }

  return {
    fans: candidateFans.filter((fan) => !suppressedById.has(fan.id)),
    suppressedFans: [...suppressedById.values()],
  };
}

function isSevenPairsCounts(counts: ReadonlyArray<number>): boolean {
  let pairs = 0;
  for (let key = 0; key < GUOBIAO_NON_FLOWER_TILE_COUNT; key++) {
    const n = counts[key] ?? 0;
    if (n === 0) continue;
    if (n !== 2) return false;
    pairs += 1;
  }
  return pairs === 7;
}

function isSevenShiftedPairsCounts(counts: ReadonlyArray<number>): boolean {
  const pairKeys: Array<number> = [];
  for (let key = 0; key < GUOBIAO_NON_FLOWER_TILE_COUNT; key++) {
    const n = counts[key] ?? 0;
    if (n === 0) continue;
    if (n !== 2 || !isGuobiaoNumberTile(key)) return false;
    pairKeys.push(key);
  }
  if (pairKeys.length !== 7) return false;

  const suit = numberSuitIndex(pairKeys[0]!);
  if (suit === null || !pairKeys.every((key) => numberSuitIndex(key) === suit)) return false;

  const ranks = pairKeys
    .map((key) => guobiaoTileRank(key))
    .filter((rank): rank is number => rank !== null)
    .sort((a, b) => a - b);
  return ranks.length === 7 && ranks.every((rank, index) => rank === ranks[0]! + index);
}

function isThirteenOrphansCounts(counts: ReadonlyArray<number>): boolean {
  let duplicate = false;
  for (let key = 0; key < GUOBIAO_NON_FLOWER_TILE_COUNT; key++) {
    const n = counts[key] ?? 0;
    const required = THIRTEEN_ORPHANS_KEYS.includes(key);
    if (!required && n !== 0) return false;
    if (required) {
      if (n <= 0 || n > 2) return false;
      if (n === 2) {
        if (duplicate) return false;
        duplicate = true;
      }
    }
  }
  return duplicate;
}

function isNineGatesCounts(counts: ReadonlyArray<number>): boolean {
  let suit: number | null = null;
  for (let key = 0; key < GUOBIAO_NON_FLOWER_TILE_COUNT; key++) {
    const n = counts[key] ?? 0;
    if (n === 0) continue;
    if (!isGuobiaoNumberTile(key)) return false;
    const tileSuit = numberSuitIndex(key);
    if (tileSuit === null) return false;
    if (suit === null) {
      suit = tileSuit;
    } else if (suit !== tileSuit) {
      return false;
    }
  }
  if (suit === null) return false;

  const suitBase = suit * 9;
  const required = [3, 1, 1, 1, 1, 1, 1, 1, 3];
  let extraCount = 0;
  for (let offset = 0; offset < 9; offset++) {
    const actual = counts[suitBase + offset] ?? 0;
    const base = required[offset]!;
    if (actual < base) return false;
    extraCount += actual - base;
  }
  return extraCount === 1;
}

function isGreaterHonorsAndKnittedCounts(counts: ReadonlyArray<number>): boolean {
  return honorsAndKnittedInfo(counts)?.hasAllHonors === true;
}

function isLesserHonorsAndKnittedCounts(counts: ReadonlyArray<number>): boolean {
  return honorsAndKnittedInfo(counts) !== null;
}

function honorsAndKnittedInfo(counts: ReadonlyArray<number>): { hasAllHonors: boolean } | null {
  if (!counts.every((n) => n === 0 || n === 1)) return null;

  let honorCount = 0;
  for (let key = 27; key < GUOBIAO_NON_FLOWER_TILE_COUNT; key++) {
    if ((counts[key] ?? 0) === 1) honorCount += 1;
  }
  if (honorCount === 0) return null;

  const suitedKeys: Array<number> = [];
  for (let key = 0; key < 27; key++) {
    if ((counts[key] ?? 0) === 1) suitedKeys.push(key);
  }
  if (suitedKeys.length + honorCount !== 14) return null;

  const fitsKnittedPattern = KNITTED_PATTERNS.some((pattern) => suitedKeys.every((key) => pattern.has(key)));
  if (!fitsKnittedPattern) return null;

  return { hasAllHonors: honorCount === 7 };
}

function isKnittedStraightCounts(counts: ReadonlyArray<number>): boolean {
  for (const pattern of KNITTED_PATTERNS) {
    if (![...pattern].every((key) => (counts[key] ?? 0) >= 1)) continue;

    const remaining = counts.slice();
    for (const key of pattern) {
      remaining[key] -= 1;
    }
    if (remaining.some((n) => n < 0)) continue;
    if (remaining.reduce((sum, n) => sum + n, 0) !== 5) continue;
    if (decomposeStandardCounts(remaining, 1).length > 0) return true;
  }
  return false;
}

function canFormStandardHand(counts: ReadonlyArray<number>): boolean {
  return decomposeStandardCounts(counts, 4).length > 0;
}

function decomposeStandardCounts(counts: ReadonlyArray<number>, setsNeeded: number): Array<StandardDecomposition> {
  const results: Array<StandardDecomposition> = [];
  if (setsNeeded < 0) return results;
  for (let pairKey = 0; pairKey < GUOBIAO_NON_FLOWER_TILE_COUNT; pairKey++) {
    if ((counts[pairKey] ?? 0) < 2) continue;
    const next = counts.slice();
    next[pairKey] -= 2;
    collectMeldDecompositions(next, setsNeeded, [], pairKey, results);
  }
  return results;
}

function collectMeldDecompositions(
  counts: Array<number>,
  setsNeeded: number,
  melds: Array<FanMeldUnit>,
  pairKey: number,
  results: Array<StandardDecomposition>,
): void {
  if (setsNeeded === 0) {
    if (counts.every((n) => n === 0)) {
      results.push({ melds: [...melds], pairKey });
    }
    return;
  }

  const first = counts.findIndex((n) => n > 0);
  if (first < 0) return;

  if ((counts[first] ?? 0) >= 3) {
    counts[first] -= 3;
    melds.push({ kind: 'pung', tileKeys: [first, first, first], baseKey: first, concealed: true, source: 'hand' });
    collectMeldDecompositions(counts, setsNeeded - 1, melds, pairKey, results);
    melds.pop();
    counts[first] += 3;
  }

  if (canStartSequence(first)) {
    const second = first + 1;
    const third = first + 2;
    if ((counts[second] ?? 0) > 0 && (counts[third] ?? 0) > 0) {
      counts[first] -= 1;
      counts[second] -= 1;
      counts[third] -= 1;
      melds.push({ kind: 'chow', tileKeys: [first, second, third], baseKey: first, concealed: true, source: 'hand' });
      collectMeldDecompositions(counts, setsNeeded - 1, melds, pairKey, results);
      melds.pop();
      counts[first] += 1;
      counts[second] += 1;
      counts[third] += 1;
    }
  }
}

function canStartSequence(tileKey: number): boolean {
  const group = guobiaoTileGroup(tileKey);
  if (group !== 'm' && group !== 'p' && group !== 's') return false;
  const rank = guobiaoTileRank(tileKey);
  return rank !== null && rank <= 7;
}

function makeKnittedPattern(groupBySuit: ReadonlyArray<number>): ReadonlySet<number> {
  const keys = new Set<number>();
  for (let suit = 0; suit < 3; suit++) {
    const groupIndex = groupBySuit[suit]!;
    for (const rank of KNITTED_RANK_GROUPS[groupIndex]!) {
      keys.add(suit * 9 + rank - 1);
    }
  }
  return keys;
}

function numberSuitIndex(tileKey: number): number | null {
  if (!isGuobiaoNumberTile(tileKey)) return null;
  return Math.floor(tileKey / 9);
}

function isTerminal(tileKey: number): boolean {
  if (!isGuobiaoNumberTile(tileKey)) return false;
  const rank = guobiaoTileRank(tileKey);
  return rank === 1 || rank === 9;
}

function isTerminalOrHonor(tileKey: number): boolean {
  return isTerminal(tileKey) || isGuobiaoHonor(tileKey);
}

function isSimple(tileKey: number): boolean {
  if (!isGuobiaoNumberTile(tileKey)) return false;
  const rank = guobiaoTileRank(tileKey);
  return rank !== null && rank >= 2 && rank <= 8;
}

function allNumberRanksIn(tileKeys: ReadonlyArray<number>, ranks: ReadonlySet<number>): boolean {
  return tileKeys.every((tileKey) => {
    if (!isGuobiaoNumberTile(tileKey)) return false;
    const rank = guobiaoTileRank(tileKey);
    return rank !== null && ranks.has(rank);
  });
}

function countTileHogs(analysis: GuobiaoFanAnalysis): number {
  const kongKeys = new Set(analysis.fixedMelds.filter((m) => m.kind === 'kong').map((m) => m.baseKey));
  const counts = countGuobiaoTileKeys(analysis.allNonFlowerTiles);
  let total = 0;
  for (let key = 0; key < GUOBIAO_NON_FLOWER_TILE_COUNT; key++) {
    if ((counts[key] ?? 0) === 4 && !kongKeys.has(key)) total += 1;
  }
  return total;
}

function isAllPungsDecomposition(decomposition: StandardDecomposition): boolean {
  return decomposition.melds.every((m) => m.kind !== 'chow');
}

function applyConcealedPungFans(
  decompositions: ReadonlyArray<StandardDecomposition>,
  context: NormalizedWinContext,
  fans: Array<GuobiaoFanApplied>,
  applied: Set<GuobiaoFanId>,
): void {
  if (!context.isSelfDrawn && context.winningTileKey === null) return;

  const maxConcealedPungs = Math.max(0, ...decompositions.map((decomposition) => countConcealedPungs(decomposition, context)));
  if (maxConcealedPungs >= 4) {
    applyFan(fans, applied, 'fourConcealedPungs');
    applyFan(fans, applied, 'threeConcealedPungs');
    applyFan(fans, applied, 'twoConcealedPungs');
  } else if (maxConcealedPungs >= 3) {
    applyFan(fans, applied, 'threeConcealedPungs');
    applyFan(fans, applied, 'twoConcealedPungs');
  } else if (maxConcealedPungs >= 2) {
    applyFan(fans, applied, 'twoConcealedPungs');
  }
}

function countConcealedPungs(decomposition: StandardDecomposition, context: NormalizedWinContext): number {
  return decomposition.melds.filter((meld) => isConcealedPungForSource(meld, context)).length;
}

function isConcealedPungForSource(meld: FanMeldUnit, context: NormalizedWinContext): boolean {
  if (meld.kind !== 'pung' && meld.kind !== 'kong') return false;
  if (!meld.concealed) return false;
  if (!context.isSelfDrawn && context.winningTileKey !== null && meld.source === 'hand' && meld.baseKey === context.winningTileKey) {
    return false;
  }
  return true;
}

function isMeldedHand(decomposition: StandardDecomposition, context: NormalizedWinContext): boolean {
  if (context.isSelfDrawn || context.winningTileKey === null) return false;
  if (decomposition.pairKey !== context.winningTileKey) return false;
  return decomposition.melds.length === 4 && decomposition.melds.every(isOpenMeld);
}

function applyInferredWaitFans(
  decompositions: ReadonlyArray<StandardDecomposition>,
  context: NormalizedWinContext,
  fans: Array<GuobiaoFanApplied>,
  applied: Set<GuobiaoFanId>,
): void {
  if (context.waitKind !== null || context.winningTileKey === null) return;
  if (isFormalMultiWait(decompositions, context.winningTileKey)) return;
  for (const decomposition of decompositions) {
    const waitKind = inferWaitKind(decomposition, context.winningTileKey);
    if (waitKind === 'single') {
      applyFan(fans, applied, 'singleWait');
      return;
    }
    if (waitKind === 'closed') {
      applyFan(fans, applied, 'closedWait');
      return;
    }
    if (waitKind === 'edge') {
      applyFan(fans, applied, 'edgeWait');
      return;
    }
  }
}

function isFormalMultiWait(decompositions: ReadonlyArray<StandardDecomposition>, winningTileKey: number): boolean {
  for (const decomposition of decompositions) {
    const completeTiles = standardDecompositionTileKeys(decomposition);
    const winningIndex = completeTiles.indexOf(winningTileKey);
    if (winningIndex < 0) continue;
    const waitingTiles = [
      ...completeTiles.slice(0, winningIndex),
      ...completeTiles.slice(winningIndex + 1),
    ];
    let waitCount = 0;
    for (let tileKey = 0; tileKey < GUOBIAO_NON_FLOWER_TILE_COUNT; tileKey++) {
      const shape = analyzeGuobiaoClosedWinShape([...waitingTiles, tileKey]);
      if (!shape.valid) continue;
      waitCount += 1;
      if (waitCount >= 2) return true;
    }
  }
  return false;
}

function standardDecompositionTileKeys(decomposition: StandardDecomposition): Array<number> {
  return [
    ...decomposition.melds.flatMap((meld) => meld.tileKeys),
    decomposition.pairKey,
    decomposition.pairKey,
  ];
}

function inferWaitKind(decomposition: StandardDecomposition, winningTileKey: number): GuobiaoFanWaitKind | null {
  if (decomposition.pairKey === winningTileKey) return 'single';

  let hasEdge = false;
  for (const meld of decomposition.melds) {
    if (meld.kind !== 'chow' || !meld.tileKeys.includes(winningTileKey)) continue;
    const startRank = guobiaoTileRank(meld.baseKey);
    const winningRank = guobiaoTileRank(winningTileKey);
    if (startRank === null || winningRank === null) continue;
    if (winningRank === startRank + 1) return 'closed';
    if ((startRank === 1 && winningRank === 3) || (startRank === 7 && winningRank === 7)) {
      hasEdge = true;
    }
  }
  return hasEdge ? 'edge' : null;
}

function hasOpenMeld(melds: ReadonlyArray<FanMeldUnit>): boolean {
  return melds.some(isOpenMeld);
}

function isOpenMeld(meld: FanMeldUnit): boolean {
  return meld.source === 'meld' && !meld.concealed;
}

function isAllEvenPungsDecomposition(decomposition: StandardDecomposition): boolean {
  if (!isAllPungsDecomposition(decomposition)) return false;
  if (!isEvenNumberTile(decomposition.pairKey)) return false;
  return decomposition.melds.every((m) => isEvenNumberTile(m.baseKey));
}

function isEvenNumberTile(tileKey: number): boolean {
  if (!isGuobiaoNumberTile(tileKey)) return false;
  const rank = guobiaoTileRank(tileKey);
  return rank !== null && EVEN_PUNG_RANKS.has(rank);
}

function hasAllFives(decomposition: StandardDecomposition): boolean {
  if (!isTileRankFive(decomposition.pairKey)) return false;
  return decomposition.melds.every((meld) => meldContainsRank(meld, 5));
}

function hasOutsideHand(decomposition: StandardDecomposition): boolean {
  if (!isTerminalOrHonor(decomposition.pairKey)) return false;
  return decomposition.melds.every(meldContainsTerminalOrHonor);
}

function hasFourPureShiftedPungs(decomposition: StandardDecomposition): boolean {
  const pungs = pungSignatures(decomposition);
  for (let suit = 0; suit < 3; suit++) {
    const ranks = pungs
      .filter((pung) => pung.suit === suit)
      .map((pung) => pung.rank)
      .sort((a, b) => a - b);
    if (hasShiftedSequence(ranks, 4, 1)) return true;
  }
  return false;
}

function hasPureShiftedPungs(decomposition: StandardDecomposition): boolean {
  const pungs = pungSignatures(decomposition);
  for (let suit = 0; suit < 3; suit++) {
    const ranks = pungs
      .filter((pung) => pung.suit === suit)
      .map((pung) => pung.rank)
      .sort((a, b) => a - b);
    if (hasShiftedSequence(ranks, 3, 1)) return true;
  }
  return false;
}

function hasMixedShiftedPungs(decomposition: StandardDecomposition): boolean {
  const pungs = pungSignatures(decomposition);
  for (let i = 0; i < pungs.length; i++) {
    for (let j = i + 1; j < pungs.length; j++) {
      for (let k = j + 1; k < pungs.length; k++) {
        const group = [pungs[i]!, pungs[j]!, pungs[k]!];
        if (new Set(group.map((pung) => pung.suit)).size !== 3) continue;
        const ranks = group.map((pung) => pung.rank).sort((a, b) => a - b);
        if (ranks[1] === ranks[0]! + 1 && ranks[2] === ranks[1]! + 1) return true;
      }
    }
  }
  return false;
}

function hasTriplePung(decomposition: StandardDecomposition): boolean {
  return pungSuitsByRank(decomposition).some((suits) => suits.size === 3);
}

function countDoublePungs(decomposition: StandardDecomposition): number {
  return pungSuitsByRank(decomposition)
    .reduce((sum, suits) => sum + (suits.size >= 2 ? combinationsOfTwo(suits.size) : 0), 0);
}

function countPungsOfTerminalsOrHonors(decomposition: StandardDecomposition, context: NormalizedWinContext): number {
  const pungKeys = decomposition.melds
    .filter((m) => m.kind === 'pung' || m.kind === 'kong')
    .map((m) => m.baseKey);
  const windPungs = new Set(pungKeys.filter((key) => guobiaoTileGroup(key) === 'wind'));

  let count = 0;
  for (const key of pungKeys) {
    if (isTerminal(key)) {
      count += 1;
      continue;
    }
    if (!isGuobiaoHonor(key)) continue;

    const group = guobiaoTileGroup(key);
    if (group === 'dragon') {
      continue;
    }
    if (group === 'wind') {
      if (windPungs.size >= 3) continue;
      if (context.seatWindKey !== null && key === context.seatWindKey) continue;
      if (context.roundWindKey !== null && key === context.roundWindKey) continue;
      count += 1;
    }
  }
  return count;
}

function pungSuitsByRank(decomposition: StandardDecomposition): Array<Set<number>> {
  const byRank = new Map<number, Set<number>>();
  for (const pung of pungSignatures(decomposition)) {
    const suits = byRank.get(pung.rank) ?? new Set<number>();
    suits.add(pung.suit);
    byRank.set(pung.rank, suits);
  }
  return [...byRank.values()];
}

function combinationsOfTwo(n: number): number {
  return n * (n - 1) / 2;
}

function pungSignatures(decomposition: StandardDecomposition): Array<{ suit: number; rank: number }> {
  return decomposition.melds
    .filter((m) => m.kind === 'pung' || m.kind === 'kong')
    .map((m) => {
      if (!isGuobiaoNumberTile(m.baseKey)) return null;
      const suit = numberSuitIndex(m.baseKey);
      const rank = guobiaoTileRank(m.baseKey);
      return suit !== null && rank !== null ? { suit, rank } : null;
    })
    .filter((x): x is { suit: number; rank: number } => x !== null);
}

function isAllChowsDecomposition(decomposition: StandardDecomposition): boolean {
  return decomposition.melds.every((m) => m.kind === 'chow') && isGuobiaoNumberTile(decomposition.pairKey);
}

function hasQuadrupleChow(decomposition: StandardDecomposition): boolean {
  return maxSameChowCount(decomposition) >= 4;
}

function hasPureTripleChows(decomposition: StandardDecomposition): boolean {
  return maxSameChowCount(decomposition) >= 3;
}

function maxSameChowCount(decomposition: StandardDecomposition): number {
  const counts = new Map<string, number>();
  for (const chow of chowSignatures(decomposition)) {
    const key = `${chow.suit}:${chow.startRank}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

function hasFourPureShiftedChows(decomposition: StandardDecomposition): boolean {
  const chows = chowSignatures(decomposition);
  if (chows.length < 4) return false;

  for (let suit = 0; suit < 3; suit++) {
    const starts = chows
      .filter((chow) => chow.suit === suit)
      .map((chow) => chow.startRank)
      .sort((a, b) => a - b);
    if (starts.length < 4) continue;
    if (hasShiftedSequence(starts, 4, 1)) return true;
  }
  return false;
}

function hasFourPureLinkedChows(decomposition: StandardDecomposition): boolean {
  const chows = chowSignatures(decomposition);
  if (chows.length < 4) return false;

  for (let suit = 0; suit < 3; suit++) {
    const starts = chows
      .filter((chow) => chow.suit === suit)
      .map((chow) => chow.startRank)
      .sort((a, b) => a - b);
    if (starts.length < 4) continue;
    if (hasShiftedSequence(starts, 4, 2)) return true;
  }
  return false;
}

function hasPureTerminalChows(decomposition: StandardDecomposition): boolean {
  const pairSuit = numberSuitIndex(decomposition.pairKey);
  const pairRank = guobiaoTileRank(decomposition.pairKey);
  if (pairSuit === null || pairRank !== 5) return false;

  const startCounts = chowStartCountsBySuit(decomposition);
  const starts = startCounts.get(pairSuit);
  return (starts?.get(1) ?? 0) >= 2 && (starts?.get(7) ?? 0) >= 2;
}

function hasThreeSuitedTerminalChows(decomposition: StandardDecomposition): boolean {
  const pairSuit = numberSuitIndex(decomposition.pairKey);
  const pairRank = guobiaoTileRank(decomposition.pairKey);
  if (pairSuit === null || pairRank !== 5) return false;

  const startCounts = chowStartCountsBySuit(decomposition);
  for (let suit = 0; suit < 3; suit++) {
    if (suit === pairSuit) continue;
    const starts = startCounts.get(suit);
    if ((starts?.get(1) ?? 0) < 1 || (starts?.get(7) ?? 0) < 1) return false;
  }
  return true;
}

function hasPureShiftedChows(decomposition: StandardDecomposition): boolean {
  const chows = chowSignatures(decomposition);
  for (let suit = 0; suit < 3; suit++) {
    const starts = chows
      .filter((chow) => chow.suit === suit)
      .map((chow) => chow.startRank)
      .sort((a, b) => a - b);
    if (hasShiftedSequence(starts, 3, 1)) return true;
  }
  return false;
}

function hasPureLinkedChows(decomposition: StandardDecomposition): boolean {
  const chows = chowSignatures(decomposition);
  for (let suit = 0; suit < 3; suit++) {
    const starts = chows
      .filter((chow) => chow.suit === suit)
      .map((chow) => chow.startRank)
      .sort((a, b) => a - b);
    if (hasShiftedSequence(starts, 3, 2)) return true;
  }
  return false;
}

function hasMixedTripleChows(decomposition: StandardDecomposition): boolean {
  const chows = chowSignatures(decomposition);
  for (let startRank = 1; startRank <= 7; startRank++) {
    const suits = new Set(chows.filter((chow) => chow.startRank === startRank).map((chow) => chow.suit));
    if (suits.size === 3) return true;
  }
  return false;
}

function hasMixedShiftedChows(decomposition: StandardDecomposition): boolean {
  const chows = chowSignatures(decomposition);
  for (let i = 0; i < chows.length; i++) {
    for (let j = i + 1; j < chows.length; j++) {
      for (let k = j + 1; k < chows.length; k++) {
        const group = [chows[i]!, chows[j]!, chows[k]!];
        if (new Set(group.map((chow) => chow.suit)).size !== 3) continue;
        const starts = group.map((chow) => chow.startRank).sort((a, b) => a - b);
        if (starts[1] === starts[0]! + 1 && starts[2] === starts[1]! + 1) return true;
      }
    }
  }
  return false;
}

function hasShiftedSequence(sortedStarts: ReadonlyArray<number>, length: number, step: number): boolean {
  for (let i = 0; i <= sortedStarts.length - length; i++) {
    let ok = true;
    const first = sortedStarts[i]!;
    for (let offset = 1; offset < length; offset++) {
      if (sortedStarts[i + offset] !== first + offset * step) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function hasPureStraight(decomposition: StandardDecomposition): boolean {
  const bySuit = new Map<number, Set<number>>();
  for (const meld of decomposition.melds) {
    const signature = chowSignature(meld);
    if (!signature) continue;
    const starts = bySuit.get(signature.suit) ?? new Set<number>();
    starts.add(signature.startRank);
    bySuit.set(signature.suit, starts);
  }
  for (const starts of bySuit.values()) {
    if (starts.has(1) && starts.has(4) && starts.has(7)) return true;
  }
  return false;
}

function hasMixedStraight(decomposition: StandardDecomposition): boolean {
  const chows = chowSignatures(decomposition);
  const starts = [1, 4, 7];
  for (const a of chows.filter((x) => x.startRank === starts[0])) {
    for (const b of chows.filter((x) => x.startRank === starts[1])) {
      for (const c of chows.filter((x) => x.startRank === starts[2])) {
        if (new Set([a.suit, b.suit, c.suit]).size === 3) return true;
      }
    }
  }
  return false;
}

function countPureDoubleChows(decomposition: StandardDecomposition): number {
  const counts = new Map<string, number>();
  for (const chow of chowSignatures(decomposition)) {
    const key = `${chow.suit}:${chow.startRank}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].reduce((sum, count) => sum + combinationsOfTwo(count), 0);
}

function countMixedDoubleChows(decomposition: StandardDecomposition): number {
  const counts = new Map<number, Map<number, number>>();
  for (const chow of chowSignatures(decomposition)) {
    const suitCounts = counts.get(chow.startRank) ?? new Map<number, number>();
    suitCounts.set(chow.suit, (suitCounts.get(chow.suit) ?? 0) + 1);
    counts.set(chow.startRank, suitCounts);
  }

  let total = 0;
  for (const suitCounts of counts.values()) {
    const suits = [...suitCounts.keys()];
    for (let i = 0; i < suits.length; i++) {
      for (let j = i + 1; j < suits.length; j++) {
        total += (suitCounts.get(suits[i]!) ?? 0) * (suitCounts.get(suits[j]!) ?? 0);
      }
    }
  }
  return total;
}

function countShortStraights(decomposition: StandardDecomposition): number {
  const startCounts = chowStartCountsBySuit(decomposition);
  let total = 0;
  for (const starts of startCounts.values()) {
    for (let start = 1; start <= 4; start++) {
      total += (starts.get(start) ?? 0) * (starts.get(start + 3) ?? 0);
    }
  }
  return total;
}

function countTwoTerminalChows(decomposition: StandardDecomposition): number {
  const startCounts = chowStartCountsBySuit(decomposition);
  let total = 0;
  for (const starts of startCounts.values()) {
    total += (starts.get(1) ?? 0) * (starts.get(7) ?? 0);
  }
  return total;
}

function chowStartCountsBySuit(decomposition: StandardDecomposition): Map<number, Map<number, number>> {
  const bySuit = new Map<number, Map<number, number>>();
  for (const chow of chowSignatures(decomposition)) {
    const starts = bySuit.get(chow.suit) ?? new Map<number, number>();
    starts.set(chow.startRank, (starts.get(chow.startRank) ?? 0) + 1);
    bySuit.set(chow.suit, starts);
  }
  return bySuit;
}

function chowSignatures(decomposition: StandardDecomposition): Array<{ suit: number; startRank: number }> {
  return decomposition.melds.map(chowSignature).filter((x): x is { suit: number; startRank: number } => x !== null);
}

function chowSignature(meld: FanMeldUnit): { suit: number; startRank: number } | null {
  if (meld.kind !== 'chow') return null;
  const suit = numberSuitIndex(meld.baseKey);
  const rank = guobiaoTileRank(meld.baseKey);
  if (suit === null || rank === null) return null;
  return { suit, startRank: rank };
}

function meldContainsRank(meld: FanMeldUnit, rank: number): boolean {
  return meld.tileKeys.some((tileKey) => guobiaoTileRank(tileKey) === rank);
}

function meldContainsTerminalOrHonor(meld: FanMeldUnit): boolean {
  if (meld.kind === 'chow') {
    const signature = chowSignature(meld);
    return signature?.startRank === 1 || signature?.startRank === 7;
  }
  return isTerminalOrHonor(meld.baseKey);
}

function isTileRankFive(tileKey: number): boolean {
  return isGuobiaoNumberTile(tileKey) && guobiaoTileRank(tileKey) === 5;
}
