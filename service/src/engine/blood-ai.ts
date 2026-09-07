import crypto from 'node:crypto';
import type { Game } from './game';
import type { BloodEngine, BloodState } from './blood-engine';
import { canHuCounts } from './blood-engine';
import type { AiScene } from './protocol';


type Suit = 'm' | 'p' | 's';


export function determineAiScene(state: BloodState, seat: number): AiScene | null {
  if (!state || !Number.isFinite(seat) || seat < 0 || seat > 3) return null;
  const me = state.players?.[seat] ?? null;
  if (!me || me.hu) {
    // A hu'ed player has no interactive decisions in xuezhan.
    return null;
  }

  if (state.phase === 'swap3') {
    const swap3 = state.swap3 ?? null;
    if (!swap3 || swap3.animatingSince !== null) return null;
    const picked = (swap3.selections as any)?.[seat] ?? null;
    return picked === null ? 'swap3' : null;
  }

  if (state.phase === 'dingque') {
    const committed = me.dingqueReady === true || me.dingque !== null;
    return committed ? null : 'dingque';
  }

  if (state.phase === 'playing') {
    const pending = state.pending;
    if (pending && pending.kind === 'claim') {
      if (seat === pending.fromSeat) return null;
      if (pending.responses?.[seat] !== null) return null;
      const opt = pending.options?.[seat] ?? null;
      if (!opt || (!opt.hu && !opt.peng && !opt.gang)) return null;
      return 'claim';
    }
    if (pending === null && state.turnSeat === seat && state.turnStep === 'discard' && me.dingque !== null) {
      return 'turn';
    }
  }

  return null;
}


export function computeAiSnapshotKey(state: BloodState, seat: number, scene: AiScene): string {
  const me = state.players?.[seat] ?? null;
  const dingque = me?.dingque ?? null;
  const pendingId = (state as any)?.pending?.id ?? null;
  const swapSince = (state as any)?.swap3?.since ?? null;
  const swapAnimating = (state as any)?.swap3?.animatingSince ?? null;
  return [
    'mjlab.ai.snapshot.v1',
    `scene=${scene}`,
    `phase=${state.phase}`,
    `turnSeat=${state.turnSeat}`,
    `turnStep=${state.turnStep}`,
    `pendingId=${pendingId}`,
    `swapSince=${swapSince}`,
    `swapAnim=${swapAnimating}`,
    `dingque=${dingque ?? ''}`,
    `hu=${me?.hu ? 1 : 0}`,
    `wallIndex=${state.wallIndex}`,
    `nextId=${state.nextId}`,
  ].join('|');
}


export function snapshotIdForKey(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
}


export function computeAllowedActions(params: {
  game: Game;
  engine: BloodEngine;
  state: BloodState;
  seat: number;
  scene: AiScene;
}): Array<any> {
  const { engine, state, seat, scene } = params;
  const me = state.players?.[seat] ?? null;
  if (!me || me.hu) return [];

  // Followup / preview may run in non-interactive phases (e.g. settling/done).
  // In those cases, keep allowed_actions empty to avoid implying the user can still act.
  if (scene === 'swap3' && state.phase !== 'swap3') return [];
  if (scene === 'dingque' && state.phase !== 'dingque') return [];
  if (scene === 'claim' && state.phase !== 'playing') return [];
  if (scene === 'turn' && state.phase !== 'playing') return [];

  if (scene === 'swap3') {
    const tiles = listHandTiles(params.game, engine, seat);
    const bySuit: Record<Suit, Array<{ tileId: number; tileKey: number }>> = { m: [], p: [], s: [] };
    for (const t of tiles) {
      bySuit[suitOf(t.tileKey)].push(t);
    }
    const out: Array<any> = [];
    for (const suit of ['m', 'p', 's'] as Array<Suit>) {
      const items = bySuit[suit];
      for (let i = 0; i < items.length - 2; i++) {
        for (let j = i + 1; j < items.length - 1; j++) {
          for (let k = j + 1; k < items.length; k++) {
            const a = items[i]!;
            const b = items[j]!;
            const c = items[k]!;
            out.push({
              kind: 'swap3',
              tileIds: [a.tileId, b.tileId, c.tileId],
              tiles: [tileCode(a.tileKey), tileCode(b.tileKey), tileCode(c.tileKey)],
            });
          }
        }
      }
    }
    return out;
  }

  if (scene === 'dingque') {
    return [
      { kind: 'dingque', suit: 'm' },
      { kind: 'dingque', suit: 'p' },
      { kind: 'dingque', suit: 's' },
    ];
  }

  if (scene === 'claim') {
    const pending: any = state.pending;
    if (!pending || pending.kind !== 'claim') return [];
    const opt = pending.options?.[seat] ?? null;
    if (!opt) return [];
    const actions: Array<any> = [{ kind: 'claim', pendingId: pending.id, action: 'pass' }];
    if (opt.hu) actions.push({ kind: 'claim', pendingId: pending.id, action: 'hu' });
    if (opt.gang) actions.push({ kind: 'claim', pendingId: pending.id, action: 'gang' });
    if (opt.peng) actions.push({ kind: 'claim', pendingId: pending.id, action: 'peng' });
    return actions;
  }

  if (scene === 'turn') {
    const dingque: Suit | null = (me?.dingque as Suit | null) ?? null;
    const tiles = listHandTiles(params.game, engine, seat);
    const hasExtra = tiles.some((t) => t.isExtra);
    const counts = countsForTiles(tiles.map((t) => t.tileKey));
    const haveDingqueSuit = dingque ? hasSuit(counts, dingque) : false;
    const eligibleDiscards = tiles.filter((t) => (haveDingqueSuit && dingque ? suitOf(t.tileKey) === dingque : true));
    const discards = eligibleDiscards.map((t) => ({ kind: 'discard', tileId: t.tileId, tile: tileCode(t.tileKey) }));

    const kongs: Array<any> = [];
    // 暗杠/加杠只能在“摸牌后”的本回合进行；碰后进入弃牌回合时没有 hand.extra，不允许宣杠。
    if (dingque && hasExtra) {
      // an-gang: 4 in hand
      for (let tk = 0; tk < counts.length; tk++) {
        if (counts[tk] < 4) continue;
        if (suitOf(tk) === dingque) continue;
        kongs.push({ kind: 'kong', gangType: 'an', tileKey: tk, tile: tileCode(tk) });
      }
      // add-gang: has peng meld + 1 in hand
      const pengKeys = new Set<number>();
      if (Array.isArray(me.melds)) {
        for (const m of me.melds as any[]) {
          if (m?.kind !== 'peng') continue;
          const tk = Number(m?.tileKey);
          if (!Number.isFinite(tk)) continue;
          pengKeys.add(Math.trunc(tk));
        }
      }
      for (const tk of pengKeys) {
        if (counts[tk] < 1) continue;
        if (suitOf(tk) === dingque) continue;
        kongs.push({ kind: 'kong', gangType: 'add', tileKey: tk, tile: tileCode(tk) });
      }
    }

    const hu: Array<any> = [];
    if (dingque && state.phase === 'playing' && state.pending === null && state.turnSeat === seat && state.turnStep === 'discard') {
      if (hasExtra && !hasSuit(counts, dingque) && canHuCounts(counts, Array.isArray(me.melds) ? me.melds.length : 0)) {
        hu.push({ kind: 'hu', source: 'self' });
      }
    }

    return [...hu, ...kongs, ...discards];
  }

  return [];
}


export function withActionIds(actions: Array<any>): Array<any> {
  const list = Array.isArray(actions) ? actions : [];
  const usedIds = new Set<string>();
  const out: Array<any> = [];
  for (let i = 0; i < list.length; i++) {
    const action = list[i];
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      out.push(action);
      continue;
    }
    const hashInput = JSON.stringify(action);
    const baseId = `act_${crypto.createHash('sha1').update(hashInput, 'utf8').digest('hex').slice(0, 12)}`;
    let id = baseId;
    let suffix = 1;
    while (usedIds.has(id)) {
      suffix += 1;
      id = `${baseId}_${suffix}`;
    }
    usedIds.add(id);
    out.push({
      ...action,
      action_id: id,
    });
  }
  return out;
}


function listHandTiles(
  game: Game,
  engine: BloodEngine,
  seat: number,
): Array<{ tileId: number; tileKey: number; isExtra: boolean }> {
  const tiles: Array<{ tileId: number; tileKey: number; isExtra: boolean; slotName: string }> = [];

  for (const [k, info] of game.entries('things')) {
    const tileId = typeof k === 'number' ? k : parseInt(String(k), 10);
    if (!Number.isFinite(tileId)) continue;
    const slotName = (info as any)?.slotName;
    if (typeof slotName !== 'string') continue;
    if (!slotName.startsWith('hand.') || !slotName.endsWith(`@${seat}`)) continue;
    const tileKey = engine.tileKeyForId(tileId);
    if (tileKey === null) continue;
    tiles.push({ tileId, tileKey, isExtra: slotName.startsWith('hand.extra'), slotName });
  }

  tiles.sort((a, b) => handSlotOrder(a.slotName) - handSlotOrder(b.slotName) || a.tileId - b.tileId);
  return tiles.map((t) => ({ tileId: t.tileId, tileKey: t.tileKey, isExtra: t.isExtra }));
}


function handSlotOrder(slotName: string): number {
  if (slotName.startsWith('hand.extra')) return 1000;
  const m = /^hand\.(\d+)@(\d)$/.exec(slotName);
  if (!m) return 2000;
  const idx = parseInt(m[1] ?? '', 10);
  return Number.isFinite(idx) ? idx : 2000;
}


function suitOf(tileKey: number): Suit {
  if (tileKey < 9) return 'm';
  if (tileKey < 18) return 'p';
  return 's';
}


function tileCode(tileKey: number): string {
  const rank = (tileKey % 9) + 1;
  return `${rank}${suitOf(tileKey)}`;
}


function countsForTiles(tileKeys: Array<number>): Array<number> {
  const counts = new Array<number>(27).fill(0);
  for (const k of tileKeys) {
    if (!Number.isFinite(k)) continue;
    const tk = Math.trunc(k);
    if (tk < 0 || tk >= 27) continue;
    counts[tk] = (counts[tk] ?? 0) + 1;
  }
  return counts;
}


function hasSuit(counts: ReadonlyArray<number>, suit: Suit): boolean {
  for (let i = 0; i < counts.length; i++) {
    if ((counts[i] ?? 0) > 0 && suitOf(i) === suit) return true;
  }
  return false;
}