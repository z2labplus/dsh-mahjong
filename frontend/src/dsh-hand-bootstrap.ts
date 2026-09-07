import { standaloneBootstrap } from './standalone-session';
export type DshHandBootstrap =
  | { mode: 'standard' }
  | { mode: 'human-invite'; seat: number; humanInviteTicket: string }
  | { mode: 'spectator'; spectatorEmbedTicket: string }
  | { mode: 'invalid'; error: string };

/** Live roles are established only by the standalone service's scoped session. */
export function getDshHandBootstrap(): DshHandBootstrap {
  return standaloneBootstrap() ?? { mode: 'invalid', error: '牌桌会话尚未验证，请从 DeepSeek Harness 重新打开。' };
}

export function removeDshCapabilitiesFromUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.searchParams.delete('humanInviteTicket');
  url.searchParams.delete('spectatorEmbedTicket');
  // Keep the non-secret seat selector for the scoped session cookie.
  const rawFragment = url.hash.replace(/^#/, '');
  if (rawFragment.includes('=')) {
    const fragment = new URLSearchParams(rawFragment);
    fragment.delete('humanInviteTicket');
    fragment.delete('spectatorEmbedTicket');
    fragment.delete('seat');
    url.hash = fragment.toString();
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
