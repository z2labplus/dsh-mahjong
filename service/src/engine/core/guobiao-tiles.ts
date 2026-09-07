export type GuobiaoTileGroup = 'm' | 'p' | 's' | 'wind' | 'dragon' | 'flower';

export type GuobiaoTileCode =
  | 'W1' | 'W2' | 'W3' | 'W4' | 'W5' | 'W6' | 'W7' | 'W8' | 'W9'
  | 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7' | 'B8' | 'B9'
  | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'T9'
  | 'F1' | 'F2' | 'F3' | 'F4'
  | 'J1' | 'J2' | 'J3'
  | 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6' | 'H7' | 'H8';

export type GuobiaoTileAssetCode =
  | '1m' | '2m' | '3m' | '4m' | '5m' | '6m' | '7m' | '8m' | '9m'
  | '1p' | '2p' | '3p' | '4p' | '5p' | '6p' | '7p' | '8p' | '9p'
  | '1s' | '2s' | '3s' | '4s' | '5s' | '6s' | '7s' | '8s' | '9s'
  | '1z' | '2z' | '3z' | '4z' | '5z' | '6z' | '7z'
  | 'chun' | 'xia' | 'qiu' | 'dong' | 'mei' | 'lan' | 'zu' | 'ju';

export const GUOBIAO_NON_FLOWER_TILE_COUNT = 34;
export const GUOBIAO_FLOWER_TILE_COUNT = 8;
export const GUOBIAO_TILE_KIND_COUNT = GUOBIAO_NON_FLOWER_TILE_COUNT + GUOBIAO_FLOWER_TILE_COUNT;
export const GUOBIAO_DECK_SIZE = 144;
export const GUOBIAO_FLOWER_TYPE_INDEX_BASE = 100;
export const GUOBIAO_FLOWER_ATLAS_INDEX_BASE = 37;

const TILE_CODES: ReadonlyArray<GuobiaoTileCode> = [
  'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9',
  'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9',
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9',
  'F1', 'F2', 'F3', 'F4',
  'J1', 'J2', 'J3',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8',
];

const TILE_ASSET_CODES: ReadonlyArray<GuobiaoTileAssetCode> = [
  '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m',
  '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p',
  '1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s',
  '1z', '2z', '3z', '4z',
  '7z', '6z', '5z',
  'chun', 'xia', 'qiu', 'dong', 'mei', 'lan', 'zu', 'ju',
];

const TILE_LABELS: ReadonlyArray<string> = [
  '1万', '2万', '3万', '4万', '5万', '6万', '7万', '8万', '9万',
  '1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒',
  '1条', '2条', '3条', '4条', '5条', '6条', '7条', '8条', '9条',
  '东', '南', '西', '北',
  '中', '发', '白',
  '春', '夏', '秋', '冬', '梅', '兰', '竹', '菊',
];

const CODE_TO_KEY = new Map<GuobiaoTileCode, number>(
  TILE_CODES.map((code, key) => [code, key]),
);

export function isGuobiaoTileKey(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < GUOBIAO_TILE_KIND_COUNT;
}

export function assertGuobiaoTileKey(tileKey: number): void {
  if (!isGuobiaoTileKey(tileKey)) {
    throw new Error(`invalid guobiao tile key: ${tileKey}`);
  }
}

export function isGuobiaoFlower(tileKey: number): boolean {
  assertGuobiaoTileKey(tileKey);
  return tileKey >= GUOBIAO_NON_FLOWER_TILE_COUNT;
}

export function isGuobiaoHonor(tileKey: number): boolean {
  assertGuobiaoTileKey(tileKey);
  return tileKey >= 27 && tileKey < GUOBIAO_NON_FLOWER_TILE_COUNT;
}

export function isGuobiaoNumberTile(tileKey: number): boolean {
  assertGuobiaoTileKey(tileKey);
  return tileKey >= 0 && tileKey < 27;
}

export function guobiaoTileGroup(tileKey: number): GuobiaoTileGroup {
  assertGuobiaoTileKey(tileKey);
  if (tileKey < 9) return 'm';
  if (tileKey < 18) return 'p';
  if (tileKey < 27) return 's';
  if (tileKey < 31) return 'wind';
  if (tileKey < GUOBIAO_NON_FLOWER_TILE_COUNT) return 'dragon';
  return 'flower';
}

export function guobiaoTileRank(tileKey: number): number | null {
  assertGuobiaoTileKey(tileKey);
  if (tileKey < 27) return (tileKey % 9) + 1;
  if (tileKey < 31) return tileKey - 26;
  if (tileKey < GUOBIAO_NON_FLOWER_TILE_COUNT) return tileKey - 30;
  return tileKey - 33;
}

export function guobiaoTileCode(tileKey: number): GuobiaoTileCode {
  assertGuobiaoTileKey(tileKey);
  return TILE_CODES[tileKey]!;
}

export function guobiaoTileAssetCode(tileKey: number): GuobiaoTileAssetCode {
  assertGuobiaoTileKey(tileKey);
  return TILE_ASSET_CODES[tileKey]!;
}

export function guobiaoTileLabel(tileKey: number): string {
  assertGuobiaoTileKey(tileKey);
  return TILE_LABELS[tileKey]!;
}

export function guobiaoTileKeyFromCode(code: string): number | null {
  const normalized = code.trim().toUpperCase() as GuobiaoTileCode;
  return CODE_TO_KEY.get(normalized) ?? null;
}

export function guobiaoTileTypeIndex(tileKey: number, back: number = 0): number {
  assertGuobiaoTileKey(tileKey);
  if (isGuobiaoFlower(tileKey)) {
    return GUOBIAO_FLOWER_TYPE_INDEX_BASE + (tileKey - GUOBIAO_NON_FLOWER_TILE_COUNT);
  }

  const normalizedBack = Number.isFinite(back) ? Math.max(0, Math.trunc(back)) : 0;
  // The legacy tile atlas orders dragons as 白/发/中, while Guobiao codes are 中/发/白.
  // Keep the rule-facing tile keys stable and translate only at render-index level.
  const atlasKey =
    tileKey === 31 ? 33 :
    tileKey === 33 ? 31 :
    tileKey;
  return atlasKey + 37 * normalizedBack;
}

export function guobiaoTileKeyFromTypeIndex(typeIndex: number): number | null {
  if (!Number.isFinite(typeIndex)) return null;
  const normalized = Math.trunc(typeIndex);
  if (normalized >= GUOBIAO_FLOWER_TYPE_INDEX_BASE && normalized < GUOBIAO_FLOWER_TYPE_INDEX_BASE + GUOBIAO_FLOWER_TILE_COUNT) {
    return GUOBIAO_NON_FLOWER_TILE_COUNT + (normalized - GUOBIAO_FLOWER_TYPE_INDEX_BASE);
  }
  const atlasKey = ((normalized % 37) + 37) % 37;
  if (atlasKey < 0 || atlasKey >= GUOBIAO_NON_FLOWER_TILE_COUNT) return null;
  if (atlasKey === 31) return 33;
  if (atlasKey === 33) return 31;
  return atlasKey;
}

export function guobiaoAtlasIndexFromTypeIndex(typeIndex: number): number {
  if (!Number.isFinite(typeIndex)) return 0;
  const normalized = Math.trunc(typeIndex);
  if (normalized >= GUOBIAO_FLOWER_TYPE_INDEX_BASE && normalized < GUOBIAO_FLOWER_TYPE_INDEX_BASE + GUOBIAO_FLOWER_TILE_COUNT) {
    return GUOBIAO_FLOWER_ATLAS_INDEX_BASE + (normalized - GUOBIAO_FLOWER_TYPE_INDEX_BASE);
  }
  return ((normalized % 37) + 37) % 37;
}

export function guobiaoTileSortKey(tileKey: number): number {
  assertGuobiaoTileKey(tileKey);
  return tileKey;
}

export function makeGuobiaoTileKeyDeck(): Array<number> {
  const deck: Array<number> = [];
  for (let tileKey = 0; tileKey < GUOBIAO_NON_FLOWER_TILE_COUNT; tileKey++) {
    deck.push(tileKey, tileKey, tileKey, tileKey);
  }
  for (let tileKey = GUOBIAO_NON_FLOWER_TILE_COUNT; tileKey < GUOBIAO_TILE_KIND_COUNT; tileKey++) {
    deck.push(tileKey);
  }
  if (deck.length !== GUOBIAO_DECK_SIZE) {
    throw new Error(`invalid guobiao deck size: ${deck.length}`);
  }
  return deck;
}

export function countGuobiaoTileKeys(tileKeys: ReadonlyArray<number>, includeFlowers: boolean = false): Array<number> {
  const size = includeFlowers ? GUOBIAO_TILE_KIND_COUNT : GUOBIAO_NON_FLOWER_TILE_COUNT;
  const counts = new Array<number>(size).fill(0);
  for (const raw of tileKeys) {
    assertGuobiaoTileKey(raw);
    if (!includeFlowers && isGuobiaoFlower(raw)) continue;
    counts[raw] = (counts[raw] ?? 0) + 1;
  }
  return counts;
}
