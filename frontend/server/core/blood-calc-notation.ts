import type { BloodGangType, BloodSuit } from './blood-types';
import { rankOf, suitOf, tileCode } from './blood-tiles';

export type CalcMeldKind = 'peng' | 'gang';

export interface CalcMeld {
  kind: CalcMeldKind;
  tileKey: number;
  gangType?: BloodGangType;
}

const SUIT_ALIASES: Record<string, BloodSuit> = {
  m: 'm',
  p: 'p',
  s: 's',
  '万': 'm',
  '筒': 'p',
  '条': 's',
  '索': 's',
};

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function normalizeSuit(ch: string): BloodSuit | null {
  const key = ch.toLowerCase();
  return SUIT_ALIASES[key] ?? null;
}

export function parseTilesNotation(text: string): Array<number> {
  const tiles: Array<number> = [];
  let digits = '';

  const pushDigits = (suit: BloodSuit) => {
    if (digits.length === 0) {
      throw new Error('缺少数字（例如 123m 或 2s3m4p）');
    }
    for (const d of digits) {
      const rank = Number(d);
      if (!Number.isInteger(rank) || rank < 1 || rank > 9) {
        throw new Error(`非法点数: ${d}（仅支持 1-9）`);
      }
      const base = suit === 'm' ? 0 : suit === 'p' ? 9 : 18;
      tiles.push(base + (rank - 1));
    }
    digits = '';
  };

  const src = text.trim();
  for (const raw of src) {
    if (raw === ' ' || raw === '\t' || raw === '\n' || raw === '\r') continue;
    if (raw === ',' || raw === '，' || raw === '、' || raw === '|' || raw === '/' || raw === ';' || raw === '；') continue;
    if (isDigit(raw)) {
      digits += raw;
      continue;
    }
    const suit = normalizeSuit(raw);
    if (suit) {
      pushDigits(suit);
      continue;
    }
    throw new Error(`无法识别的字符: "${raw}"`);
  }
  if (digits.length > 0) {
    throw new Error('末尾缺少花色（例如 123m 或 2s3m4p）');
  }
  return tiles;
}

export function formatTilesNotation(tiles: ReadonlyArray<number>): string {
  const sorted = [...tiles].sort((a, b) => a - b);
  const digitsBySuit: Record<BloodSuit, string> = { m: '', p: '', s: '' };
  for (const k of sorted) {
    digitsBySuit[suitOf(k)] += String(rankOf(k));
  }
  let out = '';
  for (const suit of ['m', 'p', 's'] as const) {
    if (digitsBySuit[suit].length > 0) {
      out += `${digitsBySuit[suit]}${suit}`;
    }
  }
  return out;
}

export function parseMeldsText(text: string): Array<CalcMeld> {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const melds: Array<CalcMeld> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    try {
      melds.push(parseMeldLine(line));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`副露第 ${i + 1} 行：${msg}`);
    }
  }
  return melds;
}

function parseMeldLine(line: string): CalcMeld {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    throw new Error('为空');
  }

  const { kind, gangType, rest } = splitMeldPrefix(trimmed);
  const rawTiles = parseTilesNotation(rest);

  const allSame = (arr: Array<number>): boolean => arr.every((x) => x === arr[0]);

  const wantKind = kind;
  if (wantKind) {
    const expected = wantKind === 'peng' ? 3 : 4;
    let tiles = rawTiles;
    if (tiles.length === 1) {
      tiles = Array.from({ length: expected }, () => tiles[0]!);
    }
    if (tiles.length !== expected || !allSame(tiles)) {
      throw new Error(`${wantKind === 'peng' ? '碰' : '杠'}必须是${expected}张相同的牌`);
    }
    return { kind: wantKind, tileKey: tiles[0]!, gangType };
  }

  // 无前缀：根据张数推断
  if (rawTiles.length === 3 && allSame(rawTiles)) {
    return { kind: 'peng', tileKey: rawTiles[0]! };
  }
  if (rawTiles.length === 4 && allSame(rawTiles)) {
    return { kind: 'gang', tileKey: rawTiles[0]! };
  }

  throw new Error('请写成“碰 3m / 暗杠 5p”，或直接写“333m / 5555p”');
}

function splitMeldPrefix(line: string): { kind: CalcMeldKind | null; gangType?: BloodGangType; rest: string } {
  // 空格分隔优先：例如 "暗杠 5p" / "peng 3m"
  const spaced = line.match(/^(\S+)\s+(.+)$/);
  if (spaced) {
    const token = spaced[1]!;
    const rest = spaced[2]!.trim();
    const parsed = parseMeldToken(token);
    if (parsed) return { ...parsed, rest };
    return { kind: null, rest: line };
  }

  // 无空格：支持 "碰3m" / "暗杠5p" / "杠5p"
  const prefixes: Array<{ prefix: string; kind: CalcMeldKind; gangType?: BloodGangType }> = [
    { prefix: '暗杠', kind: 'gang', gangType: 'an' },
    { prefix: '明杠', kind: 'gang', gangType: 'ming' },
    { prefix: '加杠', kind: 'gang', gangType: 'add' },
    { prefix: '补杠', kind: 'gang', gangType: 'add' },
    { prefix: '杠', kind: 'gang' },
    { prefix: '碰', kind: 'peng' },
  ];
  for (const p of prefixes) {
    if (line.startsWith(p.prefix)) {
      return { kind: p.kind, gangType: p.gangType, rest: line.slice(p.prefix.length).trim() };
    }
  }

  return { kind: null, rest: line };
}

function parseMeldToken(token: string): { kind: CalcMeldKind; gangType?: BloodGangType } | null {
  const t = token.toLowerCase();
  if (t === '碰' || t === 'peng' || t === 'pong') return { kind: 'peng' };
  if (t === 'p') return { kind: 'peng' };
  if (t === '杠' || t === 'gang' || t === 'g') return { kind: 'gang' };
  if (t === '暗杠' || t === 'an' || t === 'an-gang') return { kind: 'gang', gangType: 'an' };
  if (t === '明杠' || t === 'ming' || t === 'ming-gang') return { kind: 'gang', gangType: 'ming' };
  if (t === '加杠' || t === '补杠' || t === 'add' || t === 'add-gang') return { kind: 'gang', gangType: 'add' };
  return null;
}

export function formatMeldsText(melds: ReadonlyArray<CalcMeld>): string {
  const lines: Array<string> = [];
  for (const m of melds) {
    if (m.kind === 'peng') {
      lines.push(`碰 ${tileCode(m.tileKey)}`);
    } else {
      const label = m.gangType === 'an' ? '暗杠' : m.gangType === 'ming' ? '明杠' : m.gangType === 'add' ? '加杠' : '杠';
      lines.push(`${label} ${tileCode(m.tileKey)}`);
    }
  }
  return lines.join('\n');
}
