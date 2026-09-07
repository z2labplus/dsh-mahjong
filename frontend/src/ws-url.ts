export function getBasePath(): string { return '/'; }
export function getWsUrl(): string {
  const page = new URL(window.location.href);
  // Curated offline cases reuse the renderer without a live connection.
  if (['case','history','archive'].includes(page.searchParams.get('mode') ?? '')) return '';
  const gameId = page.searchParams.get('gameId') ?? '';
  if (!/^[a-f0-9-]{36}$/.test(gameId)) throw new Error('Invalid game id');
  const url = new URL(`/v1/tables/${gameId}/ws`, page.origin);
  url.protocol = page.protocol === 'https:' ? 'wss:' : 'ws:';
  const seat = page.searchParams.get('seat');
  if (seat !== null && /^[0-3]$/.test(seat)) url.searchParams.set('seat', seat);
  else if (page.searchParams.get('view') === '1') url.searchParams.set('view', '1');
  return url.toString();
}
