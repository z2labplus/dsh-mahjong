import type { DshHandBootstrap } from './dsh-hand-bootstrap';

let bootstrap: DshHandBootstrap | null = null;
export function standaloneBootstrap(): DshHandBootstrap | null { return bootstrap; }

// Exchange URL capabilities for a scoped HttpOnly cookie before loading the game.
// Reload and reconnect therefore need neither a MJAI login nor browser storage.
export async function prepareStandaloneSession(): Promise<void> {
  bootstrap = null;
  const url = new URL(window.location.href);
  if (['case','history','archive'].includes(url.searchParams.get('mode') ?? '')) { bootstrap = { mode: 'standard' }; return; }
  const gameId = url.searchParams.get('gameId') ?? '';
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(gameId)) throw new Error('牌局链接无效，请从 DeepSeek Harness 打开。');
  const fragment = new URLSearchParams(url.hash.slice(1));
  const all = (key: string) => [...url.searchParams.getAll(key), ...fragment.getAll(key)];
  if (['humanInviteTicket', 'spectatorEmbedTicket', 'seat'].some(key => all(key).length > 1)) throw new Error('牌桌访问参数重复。');
  const human = all('humanInviteTicket')[0];
  const viewer = all('spectatorEmbedTicket')[0];
  if (human && viewer) throw new Error('真人邀请与旁观票据不能同时使用。');
  const seat = all('seat')[0];
  if (human && !/^[0-3]$/.test(seat ?? '')) throw new Error('邀请缺少有效座位。');
  const role = human ? `seat=${seat}` : viewer ? 'view=1' : /^[0-3]$/.test(url.searchParams.get('seat') ?? '') ? `seat=${url.searchParams.get('seat')}` : 'view=1';
  const endpoint = `/v1/tables/${gameId}/session?${role}`;
  let response = await fetch(endpoint, {
    method: human || viewer ? 'POST' : 'GET', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...(human || viewer ? { body: JSON.stringify({ credential: human ?? viewer }) } : {}),
  });
  if (response.status === 409 && (await response.clone().json()).errorCode === 'INVITATION_ALREADY_USED') response = await fetch(endpoint, {credentials:'include',cache:'no-store'});
  if (!response.ok) throw new Error('牌桌邀请无效或已过期，请回到 DeepSeek Harness 重新打开。');
  const access = await response.json();
  if (access.kind === 'human' && Number.isInteger(access.seat) && access.seat >= 0 && access.seat <= 3) {
    bootstrap = { mode: 'human-invite', seat: access.seat, humanInviteTicket: '' };
    url.searchParams.set('seat', String(access.seat));
    url.searchParams.delete('view');
  } else if (access.kind === 'viewer') {
    bootstrap = { mode: 'spectator', spectatorEmbedTicket: '' };
    url.searchParams.set('view', '1');
    url.searchParams.delete('seat');
  } else throw new Error('牌桌访问身份不匹配。');
  for (const key of ['humanInviteTicket', 'spectatorEmbedTicket']) url.searchParams.delete(key);
  url.hash = '';
  window.history.replaceState(null, '', `${url.pathname}${url.search}`);
}
