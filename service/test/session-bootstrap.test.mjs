import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareStandaloneSession } from '../../frontend/src/standalone-session';
import { getDshHandBootstrap } from '../../frontend/src/dsh-hand-bootstrap';
import { getStoredPlayerId } from '../../frontend/src/player-id';

test('browser roles require the service session, and URL capabilities are exchanged only once', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalFetch = globalThis.fetch;
  const requests = [];
  const gameId = '0a1c3c82-a008-4cd7-849d-ed7e4ba86eb9';
  let page = `https://mahjong.example/hand/?gameId=${gameId}#seat=2&humanInviteTicket=current-service-ticket`;
  Object.defineProperty(globalThis, 'window', {configurable: true, value: {
    location: {get href() {return page;}},
    history: {replaceState(_state, _title, url) {page = new URL(url, page).href;}},
  }});
  globalThis.fetch = async (url, init) => {
    requests.push({url: String(url), init});
    return Response.json({ok: true, kind: 'human', seat: 2});
  };
  try {
    assert.equal(getDshHandBootstrap().mode, 'invalid', 'a ticket alone does not establish a role');
    await prepareStandaloneSession();
    assert.deepEqual(getDshHandBootstrap(), {mode: 'human-invite', seat: 2, humanInviteTicket: ''});
    assert.equal(requests[0].url, `/v1/tables/${gameId}/session?seat=2`);
    assert.equal(requests[0].init?.credentials, 'include');
    assert.equal(requests[0].init?.method, 'POST');
    assert.doesNotMatch(page, /Ticket|current-service-ticket|#/);
    await prepareStandaloneSession();
    assert.equal(requests[1].init?.method, 'GET', 'refresh uses the scoped cookie');
    assert.equal(requests[1].init?.body, undefined);
    globalThis.fetch = async () => new Response(null, {status: 401});
    await assert.rejects(prepareStandaloneSession(), /邀请无效或已过期/);
    assert.equal(getDshHandBootstrap().mode, 'invalid', 'failed verification must clear any earlier role');
    page = `https://mahjong.example/hand/?gameId=${gameId}#seat=2&seat=3&humanInviteTicket=x`;
    await assert.rejects(prepareStandaloneSession(), /参数重复/);
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('browser identity never migrates an old autotable identity', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const keys = [];
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
    getItem(key) {keys.push(key); return key === 'autotable.playerId' ? 'legacy-identity' : null;},
  }});
  try {
    assert.equal(getStoredPlayerId(), null);
    assert.deepEqual(keys, ['mjlab.playerId']);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
