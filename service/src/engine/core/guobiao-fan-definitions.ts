export type GuobiaoFanCategory =
  | 'honor'
  | 'number'
  | 'pung'
  | 'kong'
  | 'suit'
  | 'terminal'
  | 'knitted'
  | 'winMethod'
  | 'wait'
  | 'special'
  | 'flower';

export type GuobiaoFanDefinition = {
  id: string;
  name: string;
  points: number;
  category: GuobiaoFanCategory;
  officialIndex?: number;
  official: boolean;
  countsTowardMinFan: boolean;
};

export const GUOBIAO_OFFICIAL_FAN_DEFINITIONS = [
  { id: 'bigFourWinds', name: '大四喜', points: 88, category: 'honor', officialIndex: 1, official: true, countsTowardMinFan: true },
  { id: 'bigThreeDragons', name: '大三元', points: 88, category: 'honor', officialIndex: 2, official: true, countsTowardMinFan: true },
  { id: 'allGreen', name: '绿一色', points: 88, category: 'suit', officialIndex: 3, official: true, countsTowardMinFan: true },
  { id: 'nineGates', name: '九莲宝灯', points: 88, category: 'special', officialIndex: 4, official: true, countsTowardMinFan: true },
  { id: 'fourKongs', name: '四杠', points: 88, category: 'kong', officialIndex: 5, official: true, countsTowardMinFan: true },
  { id: 'sevenShiftedPairs', name: '连七对', points: 88, category: 'special', officialIndex: 6, official: true, countsTowardMinFan: true },
  { id: 'thirteenOrphans', name: '十三幺', points: 88, category: 'special', officialIndex: 7, official: true, countsTowardMinFan: true },

  { id: 'allTerminals', name: '清幺九', points: 64, category: 'terminal', officialIndex: 8, official: true, countsTowardMinFan: true },
  { id: 'littleFourWinds', name: '小四喜', points: 64, category: 'honor', officialIndex: 9, official: true, countsTowardMinFan: true },
  { id: 'littleThreeDragons', name: '小三元', points: 64, category: 'honor', officialIndex: 10, official: true, countsTowardMinFan: true },
  { id: 'allHonors', name: '字一色', points: 64, category: 'honor', officialIndex: 11, official: true, countsTowardMinFan: true },
  { id: 'fourConcealedPungs', name: '四暗刻', points: 64, category: 'pung', officialIndex: 12, official: true, countsTowardMinFan: true },
  { id: 'pureTerminalChows', name: '一色双龙会', points: 64, category: 'number', officialIndex: 13, official: true, countsTowardMinFan: true },

  { id: 'quadrupleChow', name: '一色四同顺', points: 48, category: 'number', officialIndex: 14, official: true, countsTowardMinFan: true },
  { id: 'fourPureShiftedPungs', name: '一色四节高', points: 48, category: 'pung', officialIndex: 15, official: true, countsTowardMinFan: true },

  { id: 'fourPureShiftedChows', name: '一色四步高', points: 32, category: 'number', officialIndex: 16, official: true, countsTowardMinFan: true },
  { id: 'threeKongs', name: '三杠', points: 32, category: 'kong', officialIndex: 17, official: true, countsTowardMinFan: true },
  { id: 'allTerminalsAndHonors', name: '混幺九', points: 32, category: 'terminal', officialIndex: 18, official: true, countsTowardMinFan: true },

  { id: 'sevenPairs', name: '七对', points: 24, category: 'special', officialIndex: 19, official: true, countsTowardMinFan: true },
  { id: 'greaterHonorsAndKnitted', name: '七星不靠', points: 24, category: 'knitted', officialIndex: 20, official: true, countsTowardMinFan: true },
  { id: 'allEvenPungs', name: '全双刻', points: 24, category: 'pung', officialIndex: 21, official: true, countsTowardMinFan: true },
  { id: 'fullFlush', name: '清一色', points: 24, category: 'suit', officialIndex: 22, official: true, countsTowardMinFan: true },
  { id: 'pureTripleChows', name: '一色三同顺', points: 24, category: 'number', officialIndex: 23, official: true, countsTowardMinFan: true },
  { id: 'pureShiftedPungs', name: '一色三节高', points: 24, category: 'pung', officialIndex: 24, official: true, countsTowardMinFan: true },
  { id: 'upperTiles', name: '全大', points: 24, category: 'number', officialIndex: 25, official: true, countsTowardMinFan: true },
  { id: 'middleTiles', name: '全中', points: 24, category: 'number', officialIndex: 26, official: true, countsTowardMinFan: true },
  { id: 'lowerTiles', name: '全小', points: 24, category: 'number', officialIndex: 27, official: true, countsTowardMinFan: true },

  { id: 'pureStraight', name: '清龙', points: 16, category: 'number', officialIndex: 28, official: true, countsTowardMinFan: true },
  { id: 'threeSuitedTerminalChows', name: '三色双龙会', points: 16, category: 'number', officialIndex: 29, official: true, countsTowardMinFan: true },
  { id: 'pureShiftedChows', name: '一色三步高', points: 16, category: 'number', officialIndex: 30, official: true, countsTowardMinFan: true },
  { id: 'allFives', name: '全带五', points: 16, category: 'number', officialIndex: 31, official: true, countsTowardMinFan: true },
  { id: 'triplePung', name: '三同刻', points: 16, category: 'pung', officialIndex: 32, official: true, countsTowardMinFan: true },
  { id: 'threeConcealedPungs', name: '三暗刻', points: 16, category: 'pung', officialIndex: 33, official: true, countsTowardMinFan: true },

  { id: 'lesserHonorsAndKnitted', name: '全不靠', points: 12, category: 'knitted', officialIndex: 34, official: true, countsTowardMinFan: true },
  { id: 'knittedStraight', name: '组合龙', points: 12, category: 'knitted', officialIndex: 35, official: true, countsTowardMinFan: true },
  { id: 'upperFour', name: '大于五', points: 12, category: 'number', officialIndex: 36, official: true, countsTowardMinFan: true },
  { id: 'lowerFour', name: '小于五', points: 12, category: 'number', officialIndex: 37, official: true, countsTowardMinFan: true },
  { id: 'bigThreeWinds', name: '三风刻', points: 12, category: 'honor', officialIndex: 38, official: true, countsTowardMinFan: true },

  { id: 'mixedStraight', name: '花龙', points: 8, category: 'number', officialIndex: 39, official: true, countsTowardMinFan: true },
  { id: 'reversibleTiles', name: '推不倒', points: 8, category: 'suit', officialIndex: 40, official: true, countsTowardMinFan: true },
  { id: 'mixedTripleChows', name: '三色三同顺', points: 8, category: 'number', officialIndex: 41, official: true, countsTowardMinFan: true },
  { id: 'mixedShiftedPungs', name: '三色三节高', points: 8, category: 'pung', officialIndex: 42, official: true, countsTowardMinFan: true },
  { id: 'chickenHand', name: '无番和', points: 8, category: 'special', officialIndex: 43, official: true, countsTowardMinFan: true },
  { id: 'lastTileDraw', name: '妙手回春', points: 8, category: 'winMethod', officialIndex: 44, official: true, countsTowardMinFan: true },
  { id: 'lastTileClaim', name: '海底捞月', points: 8, category: 'winMethod', officialIndex: 45, official: true, countsTowardMinFan: true },
  { id: 'outWithReplacementTile', name: '杠上开花', points: 8, category: 'winMethod', officialIndex: 46, official: true, countsTowardMinFan: true },
  { id: 'robbingTheKong', name: '抢杠和', points: 8, category: 'winMethod', officialIndex: 47, official: true, countsTowardMinFan: true },

  { id: 'allPungs', name: '碰碰和', points: 6, category: 'pung', officialIndex: 48, official: true, countsTowardMinFan: true },
  { id: 'halfFlush', name: '混一色', points: 6, category: 'suit', officialIndex: 49, official: true, countsTowardMinFan: true },
  { id: 'mixedShiftedChows', name: '三色三步高', points: 6, category: 'number', officialIndex: 50, official: true, countsTowardMinFan: true },
  { id: 'allTypes', name: '五门齐', points: 6, category: 'suit', officialIndex: 51, official: true, countsTowardMinFan: true },
  { id: 'meldedHand', name: '全求人', points: 6, category: 'winMethod', officialIndex: 52, official: true, countsTowardMinFan: true },
  { id: 'twoDragonPungs', name: '双箭刻', points: 6, category: 'honor', officialIndex: 53, official: true, countsTowardMinFan: true },
  { id: 'twoConcealedKongs', name: '双暗杠', points: 6, category: 'kong', officialIndex: 54, official: true, countsTowardMinFan: true },

  { id: 'outsideHand', name: '全带幺', points: 4, category: 'terminal', officialIndex: 55, official: true, countsTowardMinFan: true },
  { id: 'fullyConcealedHand', name: '不求人', points: 4, category: 'winMethod', officialIndex: 56, official: true, countsTowardMinFan: true },
  { id: 'twoMeldedKongs', name: '双明杠', points: 4, category: 'kong', officialIndex: 57, official: true, countsTowardMinFan: true },
  { id: 'lastTile', name: '和绝张', points: 4, category: 'winMethod', officialIndex: 58, official: true, countsTowardMinFan: true },

  { id: 'dragonPung', name: '箭刻', points: 2, category: 'honor', officialIndex: 59, official: true, countsTowardMinFan: true },
  { id: 'prevalentWind', name: '圈风刻', points: 2, category: 'honor', officialIndex: 60, official: true, countsTowardMinFan: true },
  { id: 'seatWind', name: '门风刻', points: 2, category: 'honor', officialIndex: 61, official: true, countsTowardMinFan: true },
  { id: 'concealedHand', name: '门前清', points: 2, category: 'winMethod', officialIndex: 62, official: true, countsTowardMinFan: true },
  { id: 'allChows', name: '平和', points: 2, category: 'number', officialIndex: 63, official: true, countsTowardMinFan: true },
  { id: 'tileHog', name: '四归一', points: 2, category: 'special', officialIndex: 64, official: true, countsTowardMinFan: true },
  { id: 'doublePungs', name: '双同刻', points: 2, category: 'pung', officialIndex: 65, official: true, countsTowardMinFan: true },
  { id: 'twoConcealedPungs', name: '双暗刻', points: 2, category: 'pung', officialIndex: 66, official: true, countsTowardMinFan: true },
  { id: 'concealedKong', name: '暗杠', points: 2, category: 'kong', officialIndex: 67, official: true, countsTowardMinFan: true },
  { id: 'allSimples', name: '断幺', points: 2, category: 'number', officialIndex: 68, official: true, countsTowardMinFan: true },

  { id: 'pureDoubleChows', name: '一般高', points: 1, category: 'number', officialIndex: 69, official: true, countsTowardMinFan: true },
  { id: 'mixedDoubleChows', name: '喜相逢', points: 1, category: 'number', officialIndex: 70, official: true, countsTowardMinFan: true },
  { id: 'shortStraight', name: '连六', points: 1, category: 'number', officialIndex: 71, official: true, countsTowardMinFan: true },
  { id: 'twoTerminalChows', name: '老少副', points: 1, category: 'number', officialIndex: 72, official: true, countsTowardMinFan: true },
  { id: 'pungOfTerminalsOrHonors', name: '幺九刻', points: 1, category: 'pung', officialIndex: 73, official: true, countsTowardMinFan: true },
  { id: 'meldedKong', name: '明杠', points: 1, category: 'kong', officialIndex: 74, official: true, countsTowardMinFan: true },
  { id: 'oneVoidedSuit', name: '缺一门', points: 1, category: 'suit', officialIndex: 75, official: true, countsTowardMinFan: true },
  { id: 'noHonors', name: '无字', points: 1, category: 'suit', officialIndex: 76, official: true, countsTowardMinFan: true },
  { id: 'edgeWait', name: '边张', points: 1, category: 'wait', officialIndex: 77, official: true, countsTowardMinFan: true },
  { id: 'closedWait', name: '坎张', points: 1, category: 'wait', officialIndex: 78, official: true, countsTowardMinFan: true },
  { id: 'singleWait', name: '单钓将', points: 1, category: 'wait', officialIndex: 79, official: true, countsTowardMinFan: true },
  { id: 'selfDrawn', name: '自摸', points: 1, category: 'winMethod', officialIndex: 80, official: true, countsTowardMinFan: true },
  { id: 'flowerTile', name: '花牌', points: 1, category: 'flower', officialIndex: 81, official: true, countsTowardMinFan: false },
] as const satisfies ReadonlyArray<GuobiaoFanDefinition>;

export const GUOBIAO_TZIAKCHA_SUPPLEMENTAL_FAN_DEFINITIONS = [
  { id: 'fourPureLinkedChows', name: '一色四连环', points: 32, category: 'number', official: false, countsTowardMinFan: true },
  { id: 'pureLinkedChows', name: '一色三连环', points: 16, category: 'number', official: false, countsTowardMinFan: true },
  { id: 'meldedAndConcealedKongs', name: '明暗杠', points: 5, category: 'kong', official: false, countsTowardMinFan: true },
  { id: 'heavenlyHand', name: '天和', points: 8, category: 'winMethod', official: false, countsTowardMinFan: true },
  { id: 'earthlyHand', name: '地和', points: 8, category: 'winMethod', official: false, countsTowardMinFan: true },
  { id: 'humanHandOne', name: '人和Ⅰ', points: 8, category: 'winMethod', official: false, countsTowardMinFan: true },
  { id: 'humanHandTwo', name: '人和Ⅱ', points: 8, category: 'winMethod', official: false, countsTowardMinFan: true },
] as const satisfies ReadonlyArray<GuobiaoFanDefinition>;

export const GUOBIAO_FAN_DEFINITIONS = [
  ...GUOBIAO_OFFICIAL_FAN_DEFINITIONS,
  ...GUOBIAO_TZIAKCHA_SUPPLEMENTAL_FAN_DEFINITIONS,
] as const satisfies ReadonlyArray<GuobiaoFanDefinition>;

export type GuobiaoFanId = (typeof GUOBIAO_FAN_DEFINITIONS)[number]['id'];

export const GUOBIAO_FAN_DEFINITION_BY_ID: ReadonlyMap<GuobiaoFanId, GuobiaoFanDefinition> =
  new Map(GUOBIAO_FAN_DEFINITIONS.map((def) => [def.id, def]));
