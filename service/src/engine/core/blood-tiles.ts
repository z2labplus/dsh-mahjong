import type { BloodSuit } from './blood-types';

// 将 Thing.typeIndex（包含 back 偏移/红五）归一化为血战的牌键：
// 0-8=万1-9，9-17=筒1-9，18-26=条1-9；其余返回 null。
export function tileKeyFromTypeIndex(typeIndex: number): number | null {
  const base = ((typeIndex % 37) + 37) % 37;

  // 红五映射回普通 5
  let idx = base;
  if (idx === 34) idx = 4;
  if (idx === 35) idx = 13;
  if (idx === 36) idx = 22;

  if (idx < 0 || idx >= 27) {
    return null;
  }
  return idx;
}

export function suitOf(tileKey: number): BloodSuit {
  if (tileKey < 9) return 'm';
  if (tileKey < 18) return 'p';
  return 's';
}

export function rankOf(tileKey: number): number {
  return (tileKey % 9) + 1;
}

// 牌谱/导出用：3m/5p/9s
export function tileCode(tileKey: number): string {
  return `${rankOf(tileKey)}${suitOf(tileKey)}`;
}

export function tileLabel(tileKey: number): string {
  const r = rankOf(tileKey);
  const s = suitOf(tileKey);
  const suitText = s === 'm' ? '万' : s === 'p' ? '筒' : '条';
  return `${r}${suitText}`;
}
