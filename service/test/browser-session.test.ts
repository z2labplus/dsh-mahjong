import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionCookie, readSession, sessionRole } from '../src/browser-session';
import { issueAccess, type Access } from '../src/auth';

test('browser cookies are scoped per game and seat and retain no script-readable credential', async () => {
  const secret = 'test-secret'.repeat(8);
  const gameId = crypto.randomUUID();
  const access: Access = { v: 1, kind: 'human', tenant: 'one', owner: 'alice', gameId, seat: 2, exp: Date.now() + 60000 };
  const token = await issueAccess(secret, access);
  const url = new URL(`https://hand.example/v1/tables/${gameId}/session?seat=2`);
  const cookie = sessionCookie(url, gameId, token, access);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=None', 'Partitioned', `Path=/v1/tables/${gameId}`]) assert.ok(cookie.includes(flag));
  const request = (value: URL) => new Request(value, { headers: { Cookie: cookie.split(';')[0]! } });
  assert.deepEqual(await readSession(request(url), gameId, secret), access);
  const wrongSeat = new URL(url); wrongSeat.search = '?seat=1';
  await assert.rejects(readSession(request(wrongSeat), gameId, secret));
  await assert.rejects(readSession(request(url), crypto.randomUUID(), secret));
  for (const query of ['seat=4', 'seat=1&seat=2', 'seat=2&view=1', 'view=0', 'view=1&view=1']) assert.throws(() => sessionRole(new URL(`https://hand.example/?${query}`)));
  assert.throws(() => sessionCookie(url, gameId, token, { ...access, kind: 'ai' }));
});
