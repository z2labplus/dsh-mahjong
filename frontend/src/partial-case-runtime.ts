import type { Client } from './client';
import type { BloodState, BloodPlayerState } from './blood';
import { DealType, GameType, type ThingInfo, type MatchInfo } from './types';

export interface PartialCaseFrame {
  schema: 'dsh-mahjong.partial-case.v1';
  gameId: string;
  eventIndex: number;
  partial: true;
  hand: string[];
  drawn: string | null;
  melds: { kind: 'peng' | 'gang'; tile: string; count: number }[];
  dingque: 'p';
  score: number;
  hu: boolean;
}

function tileKey(code: string): number {
  if (!/^[1-9][mps]$/.test(code)) throw new Error('案例牌面无效');
  return ({ m: 0, p: 9, s: 18 }[code[1]!] ?? 0) + Number(code[0]) - 1;
}

export function validatePartialCase(raw: any, gameId: string, eventIndex: number): PartialCaseFrame {
  if (raw?.schema !== 'dsh-mahjong.partial-case.v1' || raw.gameId !== gameId ||
      gameId !== 'case-tianfu-20260706-8-8' || raw.eventIndex !== eventIndex ||
      !Number.isInteger(eventIndex) || eventIndex < 0 || eventIndex > 2 || raw.partial !== true ||
      !Array.isArray(raw.hand) || raw.hand.length !== 7 || !Array.isArray(raw.melds) || raw.melds.length !== 2 ||
      raw.dingque !== 'p' || !Number.isFinite(raw.score) || typeof raw.hu !== 'boolean') {
    throw new Error('案例与步骤不匹配');
  }
  // This adapter accepts only the curated first case, not arbitrary game imports.
  if (JSON.stringify(raw.hand) !== JSON.stringify(['2s', '4s', '6s', '6s', '7s', '7s', '7s']) ||
      raw.drawn !== (eventIndex === 0 ? null : '3s') || raw.hu !== (eventIndex === 2) ||
      raw.score !== (eventIndex === 2 ? 32 : -16) ||
      raw.melds[0]?.kind !== 'gang' || raw.melds[0]?.tile !== '1s' || raw.melds[0]?.count !== 4 ||
      raw.melds[1]?.kind !== 'peng' || raw.melds[1]?.tile !== '8s' || raw.melds[1]?.count !== 3) {
    throw new Error('案例内容尚未核验');
  }
  return structuredClone(raw);
}

export function buildPartialCaseState(frame: PartialCaseFrame) {
  const things: [number, ThingInfo][] = [];
  const publicFaces: [number, number | null][] = [];
  const selfFaces: [number, number | null][] = [];
  let tileId = 0;
  const put = (code: string, slotName: string, exposed: boolean) => {
    const id = tileId++;
    things.push([id, { slotName, rotationIndex: 0, claimedBy: null, heldRotation: { x: 0, y: 0, z: 0, w: 1 }, shiftSlotName: null }]);
    publicFaces.push([id, exposed ? tileKey(code) : null]);
    selfFaces.push([id, exposed ? null : tileKey(code)]);
  };
  frame.hand.forEach((code, index) => put(code, `hand.${index}@0`, false));
  if (frame.drawn) put(frame.drawn, 'hand.extra@0', false);
  frame.melds.forEach((meld, row) => {
    for (let i = 0; i < meld.count; i++) put(meld.tile, `meld.${row}.${i}@0`, true);
  });
  const players: Record<number, BloodPlayerState> = {};
  for (let seat = 0; seat < 4; seat++) players[seat] = {
    seat, playerId: `case-seat-${seat}`, dingque: seat === 0 ? 'p' : null,
    dingqueReady: seat === 0, hu: seat === 0 && frame.hu,
    huTileKey: seat === 0 && frame.hu ? tileKey('3s') : null,
    huSource: seat === 0 && frame.hu ? 'self' : null,
    beans: seat === 0 ? frame.score : NaN, kongGain: seat === 0 ? 2 : 0,
    melds: seat === 0 ? frame.melds.map((meld, row) => ({
      kind: meld.kind, tileKey: tileKey(meld.tile), fromSeat: null,
      ...(meld.kind === 'gang' ? { gangType: 'ming' as const } : {}), row,
    })) : [],
  };
  const blood: BloodState = {
    version: 1, base: 1, phase: 'playing', dealer: 0, turnSeat: 0,
    turnStep: frame.hu ? 'drawOrKong' : 'discard',
    wallOrder: [], wallIndex: 0, nextId: 1, pending: null,
    swap3: null, ledger: [], players, revealAllHands: false,
  };
  const match: MatchInfo = {
    dealer: 0, honba: 0,
    conditions: { gameType: GameType.BLOOD_BATTLE, back: 0, fives: '000', points: '25', dealType: DealType.HANDS },
    bloodConfig: { waitMode: 'noTimeout', timeoutMs: null },
    caseStudy: { eventIndex: frame.eventIndex, partial: true },
  };
  return { things, publicFaces, selfFaces, blood, match };
}

export function applyPartialCase(client: Client, frame: PartialCaseFrame): void {
  const state = buildPartialCaseState(frame);
  client.setLocalGame({ gameId: frame.gameId, playerId: 'case-seat-0', authoritative: true });
  client.match.update([[0, state.match]]);
  client.seats.update([0, 1, 2, 3].map((seat) => [`case-seat-${seat}`, { seat, startBeans: seat === 0 ? -18 : NaN }]));
  client.nicks.update([0, 1, 2, 3].map((seat) => [`case-seat-${seat}`, seat === 0 ? 'LC · 教学视角' : '未还原']));
  client.things.update(state.things);
  client.tileFacePublic.update(state.publicFaces);
  client.tileFaceSelf.update(state.selfFaces);
  client.blood.update([[0, state.blood]]);
}

export function receivePartialCase(gameId: string, eventIndex: number, parentOrigin: string): Promise<PartialCaseFrame> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', onMessage); };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('案例加载超时，请从 Harness 案例入口重开')); }, 15_000);
    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.type !== 'dsh-mahjong:case-frame') return;
      try {
        const frame = validatePartialCase(event.data.frame, gameId, eventIndex);
        cleanup(); resolve(frame);
      } catch (error) { cleanup(); reject(error); }
    }
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'dsh-mahjong:case-request', gameId, eventIndex }, parentOrigin);
  });
}
