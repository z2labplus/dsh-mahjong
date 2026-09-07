import { ServiceError, verifyAccess, type Access } from './auth';
export function sessionRole(url: URL): string {
  if (url.searchParams.getAll('seat').length > 1 || url.searchParams.getAll('view').length > 1) throw new ServiceError('INVALID_SESSION');
  const seat = url.searchParams.get('seat');
  if (seat !== null) {
    if (!/^[0-3]$/.test(seat) || url.searchParams.has('view')) throw new ServiceError('INVALID_SESSION');
    return `seat-${seat}`;
  }
  if (url.searchParams.get('view') !== '1') throw new ServiceError('INVALID_SESSION');
  return 'viewer';
}
function cookieName(url: URL, gameId: string): string {
  return `${url.protocol === 'https:' ? '__Secure-' : ''}dsh-${gameId}-${sessionRole(url)}`;
}
export function checkSessionAccess(url: URL, access: Access): void {
  const role = sessionRole(url);
  if ((role === 'viewer' && access.kind !== 'viewer') ||
    (role !== 'viewer' && (access.kind !== 'human' || role !== `seat-${access.seat}`))) throw new ServiceError('FORBIDDEN', 403);
}
export function sessionCookie(url: URL, gameId: string, token: string, access: Access): string {
  checkSessionAccess(url, access);
  const secure = url.protocol === 'https:';
  return `${cookieName(url, gameId)}=${token}; Path=/v1/tables/${gameId}; HttpOnly; Max-Age=${Math.max(0, Math.floor((access.exp - Date.now()) / 1000))}; ${secure ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax'}`;
}
export async function readSession(request: Request, gameId: string, secret: string): Promise<Access> {
  const url = new URL(request.url);
  const name = cookieName(url, gameId);
  const value = (request.headers.get('Cookie') ?? '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);
  const access = await verifyAccess(secret, value);
  if (access.gameId !== gameId) throw new ServiceError('FORBIDDEN', 403);
  checkSessionAccess(url, access);
  return access;
}
