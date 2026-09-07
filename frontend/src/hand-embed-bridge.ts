const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isHttpOrigin(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function isOriginOnly(url: URL): boolean {
  return url.username === '' &&
    url.password === '' &&
    (url.pathname === '' || url.pathname === '/') &&
    url.search === '' &&
    url.hash === '';
}

/**
 * Resolve the only parent origin that `/hand/` may notify.
 *
 * Production stays same-origin. Local M0 development also permits a loopback
 * Harness origin on another port, while rejecting arbitrary remote embedders.
 */
export function resolveHandParentOrigin(
  pageOrigin: string,
  requestedOrigin: string | null | undefined,
): string {
  const page = new URL(pageOrigin);
  const raw = requestedOrigin?.trim() ?? '';
  if (raw === '') return page.origin;

  let parent: URL;
  try {
    parent = new URL(raw);
  } catch {
    return page.origin;
  }

  if (!isHttpOrigin(parent) || !isOriginOnly(parent)) return page.origin;
  if (parent.origin === page.origin) return page.origin;

  const pageIsLoopback = LOOPBACK_HOSTNAMES.has(page.hostname);
  const parentIsLoopback = LOOPBACK_HOSTNAMES.has(parent.hostname);
  return (pageIsLoopback || page.protocol === 'https:') && parentIsLoopback ? parent.origin : page.origin;
}

export function shouldReplyToHandReadyRequest(options: {
  eventOrigin: string;
  expectedParentOrigin: string;
  isParentSource: boolean;
  embeddedGameId: string;
  data: unknown;
  isReady: boolean;
}): boolean {
  if (!options.isReady || !options.isParentSource) return false;
  if (options.eventOrigin !== options.expectedParentOrigin) return false;
  if (options.embeddedGameId === '') return false;
  if (!options.data || typeof options.data !== 'object') return false;

  const message = options.data as { type?: unknown; gameId?: unknown };
  return message.type === 'mjlabai:hand-ready-request' &&
    message.gameId === options.embeddedGameId;
}
