import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from '../index.js';
import { createServiceControl, normalizeServiceUrl } from '../lib/service-control.js';

const gameId = '0a1c3c82-a008-4cd7-849d-ed7e4ba86eb9';
test('service origin requires HTTPS remotely and no embedded credential or query', () => {
  assert.equal(normalizeServiceUrl('https://mahjong.example/'), 'https://mahjong.example');
  assert.equal(normalizeServiceUrl('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  for (const input of ['http://mahjong.example', 'https://a:b@example.com', 'https://example.com/path', 'https://example.com/?token=secret', 'file:///tmp/test']) {
    assert.throws(() => normalizeServiceUrl(input), { code: 'INVALID_CONFIG' });
  }
});
test('control uses a configurable origin and only sends game metadata and seat capabilities', async () => {
  const calls = [];
  const control = createServiceControl({ url: 'https://self-host.example', requestIdFactory: () => gameId, fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    return Response.json({ ok: true, gameId, seats: [] });
  } });
  await control.createTable({ ownerApiToken: 'owner-token', tableName: 'test', timeoutSeconds: 38, seats: [
    { seat: 0, kind: 'ai', provider: 'local-provider', model: 'test', modelLabel: 'Test', initialPoints: 50000, apiKey: 'must-stay-local' },
    { seat: 1, kind: 'human', owner: true, initialPoints: 0 },
  ] });
  assert.equal(calls[0].url, `https://self-host.example/v1/tables/${gameId}`);
  assert.equal(calls[0].redirect, 'error');
  assert.equal(calls[0].headers.Authorization, 'Bearer owner-token');
  assert.doesNotMatch(calls[0].body, /apiKey|provider|must-stay-local|owner-token/);
  assert.deepEqual(JSON.parse(calls[0].body).seats.map(s => s.initialPoints), [50000, 0]);
  assert.equal(control.wsUrlForGame(gameId), `wss://self-host.example/v1/tables/${gameId}/ws`);
  await control.resumeTable({ gameId, ownerApiToken: 'owner-token' });
  assert.equal(calls[1].method, 'GET');
});
test('service errors do not expose the token or remote response body', async () => {
  const control = createServiceControl({ url: 'https://example.com', fetchImpl: async () => Response.json({ ok: false, errorCode: 'SECRET', error: 'private upstream detail' }, { status: 401 }) });
  await assert.rejects(control.resumeTable({ gameId, ownerApiToken: 'SECRET' }), error => error.code === 'SERVICE_REQUEST_FAILED' && !/SECRET|private/.test(error.message));
});
test('plugin accepts explicit standalone config without MJAI config, and rejects ambiguous backends', () => {
  const effects = [];
  const ctx = { effect(fn, label) { effects.push(label); } };
  const service = { url: 'https://example.com', handUrlBase: 'https://example.com/hand/' };
  apply(ctx, { service }, { environment: { DSH_MAHJONG_SERVICE_TOKEN: 'test-token' } });
  assert.ok(effects.includes('dsh-mahjong: dynamic game controller'));
  assert.throws(() => apply(ctx, { service, mjai: {} }, { environment: {} }), { code: 'INVALID_CONFIG' });
  assert.doesNotThrow(() => apply(ctx, { service: { url: 'https://example.com' } }, { environment: {} }));
});
