export class ServiceError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export type Access = {
  v: 1; kind: 'owner' | 'ai' | 'human' | 'viewer'; tenant: string; owner: string;
  exp: number; gameId?: string; seat?: number; admin?: boolean; epoch?: number; seatEpoch?: number; purpose?: 'invite' | 'session' | 'join'; jti?: string;
};
const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
function decode(text: string) {
  return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
async function key(secret: string) {
  if (!secret || secret.length < 32 || secret.startsWith('replace-')) throw new ServiceError('SERVICE_NOT_CONFIGURED', 503);
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function issueAccess(secret: string, access: Access): Promise<string> {
  const payload = b64(encoder.encode(JSON.stringify(access)));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(`dsh1.${payload}`));
  return `dsh1.${payload}.${b64(new Uint8Array(sig))}`;
}
export async function verifyAccess(secret: string, token: unknown, now = Date.now()): Promise<Access> {
  const signingKey = await key(secret);
  try {
    if (typeof token !== 'string' || token.length > 2048) throw new Error();
    const [prefix, payload, signature, extra] = token.split('.');
    if (prefix !== 'dsh1' || !payload || !signature || extra !== undefined) throw new Error();
    if (!await crypto.subtle.verify('HMAC', signingKey, decode(signature), encoder.encode(`${prefix}.${payload}`))) throw new Error();
    const value = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (value.v !== 1 || !['owner', 'ai', 'human', 'viewer'].includes(value.kind) ||
      (typeof value.tenant !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.tenant)) || (typeof value.owner !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.owner)) ||
      !Number.isSafeInteger(value.exp) || value.exp <= now) throw new Error();
    if ((value.admin !== undefined && (value.admin !== true || value.kind !== 'owner')) || (value.epoch !== undefined && (!Number.isSafeInteger(value.epoch) || value.epoch < 0)) || (value.seatEpoch !== undefined && (!Number.isSafeInteger(value.seatEpoch) || value.seatEpoch < 0)) || (value.purpose !== undefined && !['invite','session','join'].includes(value.purpose)) || (value.jti !== undefined && !validGameId(value.jti))) throw new Error();
    if (value.kind !== 'owner' && !validGameId(value.gameId)) throw new Error();
    if (['ai', 'human'].includes(value.kind) && (!Number.isInteger(value.seat) || value.seat < 0 || value.seat > 3)) throw new Error();
    return value;
  } catch { throw new ServiceError('UNAUTHORIZED', 401); }
}
export const validGameId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export function bearer(request: Request): string {
  const value = request.headers.get('Authorization') ?? '';
  if (!value.startsWith('Bearer ')) throw new ServiceError('UNAUTHORIZED', 401);
  return value.slice(7);
}
export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export function errorResponse(error: unknown): Response {
  const known = error instanceof ServiceError;
  return json({ ok: false, errorCode: known ? error.code : 'INTERNAL_ERROR' }, known ? error.status : 500);
}
export async function readJson(request: Request, limit = 16384): Promise<any> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new ServiceError('JSON_REQUIRED', 415);
  if (Number(request.headers.get('Content-Length') ?? 0) > limit) throw new ServiceError('PAYLOAD_TOO_LARGE', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceError('INVALID_JSON');
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new ServiceError('PAYLOAD_TOO_LARGE', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ServiceError('INVALID_JSON'); }
}
