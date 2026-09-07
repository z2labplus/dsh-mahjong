// 血战到底（万/筒/条）最小可玩版本的胡牌判定：
// - 支持标准形（顺子/刻子 + 将）
// - 支持七对（仅限无副露）

export function canHuCounts(counts: ReadonlyArray<number>, meldCount: number): boolean {
  const concealed = counts.reduce((a, b) => a + b, 0);
  const setsNeeded = 4 - meldCount;
  const needTiles = setsNeeded * 3 + 2;
  if (concealed !== needTiles) {
    return false;
  }

  if (meldCount === 0 && isSevenPairs(counts)) {
    return true;
  }

  // 复制可变数组
  const buf = counts.slice();
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] >= 2) {
      buf[i] -= 2;
      if (canMakeSets(buf, setsNeeded, new Map())) {
        return true;
      }
      buf[i] += 2;
    }
  }
  return false;
}

function isSevenPairs(counts: ReadonlyArray<number>): boolean {
  let pairs = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i];
    if (c === 0) continue;
    if (c === 2) {
      pairs += 1;
    } else if (c === 4) {
      // 四张算两对（根的计分在计番阶段处理）
      pairs += 2;
    } else {
      return false;
    }
  }
  return pairs === 7;
}

function canMakeSets(counts: number[], setsNeeded: number, memo: Map<string, boolean>): boolean {
  if (setsNeeded === 0) {
    return counts.every((c) => c === 0);
  }

  const key = `${setsNeeded}:${counts.join(',')}`;
  const cached = memo.get(key);
  if (cached !== undefined) {
    return cached;
  }

  let i = 0;
  while (i < counts.length && counts[i] === 0) i++;
  if (i >= counts.length) {
    memo.set(key, false);
    return false;
  }

  // 刻子
  if (counts[i] >= 3) {
    counts[i] -= 3;
    if (canMakeSets(counts, setsNeeded - 1, memo)) {
      counts[i] += 3;
      memo.set(key, true);
      return true;
    }
    counts[i] += 3;
  }

  // 顺子（同花色，且点数 <=7）
  const r = i % 9;
  if (r <= 6) {
    const i1 = i + 1;
    const i2 = i + 2;
    if (counts[i1] > 0 && counts[i2] > 0) {
      counts[i] -= 1;
      counts[i1] -= 1;
      counts[i2] -= 1;
      if (canMakeSets(counts, setsNeeded - 1, memo)) {
        counts[i] += 1;
        counts[i1] += 1;
        counts[i2] += 1;
        memo.set(key, true);
        return true;
      }
      counts[i] += 1;
      counts[i1] += 1;
      counts[i2] += 1;
    }
  }

  memo.set(key, false);
  return false;
}
