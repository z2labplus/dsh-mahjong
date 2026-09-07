import { isGuobiaoFlower } from './guobiao-tiles';

export type GuobiaoContextTile = {
  tileKey: number;
};

export function isGuobiaoLastTileSelfDraw(
  winningTileKey: number | null | undefined,
  publicTileFaces: Iterable<readonly [unknown, unknown]>,
  handTiles: ReadonlyArray<GuobiaoContextTile>,
): boolean {
  if (winningTileKey === null || winningTileKey === undefined || isGuobiaoFlower(winningTileKey)) return false;
  let count = 0;
  for (const [, rawKey] of publicTileFaces) {
    const tileKey = Math.trunc(Number(rawKey));
    if (Number.isFinite(tileKey) && tileKey === winningTileKey) count += 1;
  }
  for (const tile of handTiles) {
    if (tile.tileKey === winningTileKey) count += 1;
  }
  return count >= 4;
}
