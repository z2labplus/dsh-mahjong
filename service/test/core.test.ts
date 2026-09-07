import assert from 'node:assert/strict';
import test from 'node:test';
import { issueAccess, verifyAccess, ServiceError, type Access } from '../src/auth';
import { normalizeTable, TableCore, type Seat } from '../src/table-core';

const now = 1800000000000;
const gameId = '55d1f198-2d88-4c61-ae49-51cfc73501c9';
const owner: Access = { v: 1, kind: 'owner', tenant: 'test', owner: 'alice', exp: now + 100000 };
const seats = (humans = 0): Seat[] => [0, 1, 2, 3].map(seat => seat < humans ? { seat, kind: 'human', owner: seat === 0 } : { seat, kind: 'ai', modelId: 'test-model', modelLabel: 'test-model' });
function table(humans = 0) {
  const core = new TableCore(normalizeTable({ seats: seats(humans) }, owner, gameId, now));
  for (let seat = 0; seat < 4; seat++) core.join(seat, now);
  return core;
}
function action(core: TableCore, seat: number, actionId = crypto.randomUUID()) {
  const decision = core.decision(seat)!;
  return { type: 'ACTION', gameId, actionId, action: { kind: 'aiDecision', decisionId: decision.decisionId, legalActionId: decision.legalActions[0]!.legalActionId } };
}

test('deployment keys, tenants, expiry and signature are enforced', async () => {
  const secret = 's'.repeat(64);
  const token = await issueAccess(secret, owner);
  assert.deepEqual(await verifyAccess(secret, token, now), owner);
  await assert.rejects(verifyAccess('b'.repeat(64), token, now), { code: 'UNAUTHORIZED' });
  await assert.rejects(verifyAccess(secret, token, owner.exp), { code: 'UNAUTHORIZED' });
  await assert.rejects(verifyAccess(secret, token.replace('dsh1.', 'dsh2.'), now), { code: 'UNAUTHORIZED' });
  const core = table();
  assert.throws(() => core.authorize({ ...owner, tenant: 'another' }), { code: 'FORBIDDEN' });
  assert.throws(() => core.authorize({ ...owner, owner: 'bob' }), { code: 'FORBIDDEN' });
  assert.throws(() => core.authorize({ ...owner, kind: 'ai', seat: 0, gameId: crypto.randomUUID() }), { code: 'FORBIDDEN' });
});

test('strict roster, timeout and ruleset validation; no silent guobiao fallback', () => {
  for (const timeoutSeconds of [9, 121, 10.5, '38']) assert.throws(() => normalizeTable({ seats: seats(), timeoutSeconds }, owner, gameId, now));
  assert.throws(() => normalizeTable({ seats: seats(), ruleset: 'guangdong' }, owner, gameId, now), { code: 'RULESET_NOT_READY' });
  assert.throws(() => normalizeTable({ seats: seats(), tenant: 'someone-else' }, owner, gameId, now));
  assert.throws(() => normalizeTable({ seats: [seats()[0], seats()[0], seats()[2], seats()[3]] }, owner, gameId, now));
  assert.throws(() => normalizeTable({ seats: seats(1).map(s => ({ ...s, owner: false })) }, owner, gameId, now));
  assert.equal(normalizeTable({ seats: seats() }, owner, gameId, now).timeoutMs, 38000);
});

test('checkpoint restores concealed tiles, deadlines and replay sequence; joins are idempotent', () => {
  const core = table();
  const copy = new TableCore(core.checkpoint());
  assert.deepEqual(copy.checkpoint(), core.checkpoint());
  copy.join(0, now + 30000);
  copy.progress(now + 30000);
  for (let seat = 0; seat < 4; seat++) assert.deepEqual(copy.decision(seat), core.decision(seat));
  assert.equal(copy.nextAlarm(), now + 38000);
  assert.ok(Buffer.byteLength(JSON.stringify(copy.checkpoint())) < 128 * 1024);
});

test('AI envelopes contain only own concealed tiles; even all-AI viewer cannot see the wall', () => {
  const core = table();
  const allFaces = core.engine.exportSecretState().tileKeyById;
  const viewFaces = core.view(null, true).entries.filter(([kind]) => kind === 'tileFaceSelf');
  assert.equal(allFaces.length, 108);
  assert.equal(viewFaces.length, 53);
  const wall = core.view(null, true).entries.find(([kind]) => kind === 'blood')![2].wallOrder;
  assert.ok(wall.every((id: unknown) => id === null));
  for (let seat = 0; seat < 4; seat++) {
    const decision = core.decision(seat)!;
    assert.equal(decision.handState.concealedTiles.length, seat === 0 ? 14 : 13);
    assert.doesNotMatch(JSON.stringify(decision), /tileKeyById|privateBySeat|wallOrder|tileFaceSelf|tileId/);
    const ownFaces = core.view(seat).entries.filter(([kind]) => kind === 'tileFaceSelf');
    assert.equal(ownFaces.length, seat === 0 ? 14 : 13);
  }
  assert.throws(() => table(1).view(null, true), { code: 'FORBIDDEN' });
});

test('illegal, late, wrong-seat and duplicate submissions cannot advance game state', () => {
  const core = table();
  const message = action(core, 0);
  const before = core.checkpoint();
  assert.throws(() => core.submit(1, message, now + 1), { code: 'AI_DECISION_STALE' });
  assert.throws(() => core.submit(0, { ...message, action: { ...message.action, legalActionId: 'invented' } }, now + 1), { code: 'AI_ACTION_NOT_LEGAL' });
  assert.throws(() => core.submit(0, message, now + 38000), { code: 'AI_DECISION_EXPIRED' });
  assert.deepEqual(core.checkpoint(), before);
  const ack = core.submit(0, message, now + 1);
  const after = core.checkpoint();
  assert.deepEqual(new TableCore(after).submit(0, message, now + 2), ack);
  assert.deepEqual(core.checkpoint(), after);
  assert.throws(() => core.submit(0, { ...message, action: { ...message.action, legalActionId: 'changed' } }, now + 2), { code: 'ACTION_ID_CONFLICT' });
});

test('alarm executes original Top1 once and preserves other expired windows', () => {
  const core = table();
  const before = core.checkpoint();
  core.alarm(now + 38000);
  assert.notDeepEqual(core.checkpoint(), before);
  assert.equal(core.windows[0], undefined);
  assert.equal(core.windows[1]!.deadlineAtMs, now + 38000);
  const after = core.checkpoint();
  new TableCore(after).alarm(now + 38000);
  assert.ok(core.events.some(e => e.type === 'ai_decision' && e.public?.source === 'timeout_top1'));
});

for (let humans = 0; humans <= 4; humans++) {
  test(`complete blood game with ${humans} human seats, restoring from storage after every move`, { timeout: 60000 }, () => {
    let core = table(humans);
    let time = now;
    let moves = 0;
    const eventSequences: number[] = [...core.events.map(e => e.seq)];
    for (let step = 0; step < 1200 && core.state?.phase !== 'done'; step++) {
      core = new TableCore(core.checkpoint());
      const decisionSeat = [0, 1, 2, 3].find(seat => core.decision(seat));
      if (decisionSeat !== undefined) {
        time += 1;
        const result = decisionSeat < humans
          ? core.submitHuman(decisionSeat, { type: 'ACTION', gameId, actionId: crypto.randomUUID(), decisionId: core.decision(decisionSeat)!.decisionId, action: [...core.catalog(decisionSeat)!.rawByActionId.values()][0] }, time)
          : core.submit(decisionSeat, action(core, decisionSeat), time);
        assert.equal(result.ok, true);
        moves++;
      } else {
        const deadline = core.nextAlarm();
        assert.notEqual(deadline, null, `stuck in ${core.state?.phase}`);
        time = deadline!;
        core.alarm(time);
      }
      eventSequences.push(...core.events.map(e => e.seq));
    }
    assert.equal(core.state?.phase, 'done');
    assert.ok(moves > 50);
    assert.equal(new Set(eventSequences).size, eventSequences.length);
    assert.equal(Object.values(core.state!.players as Record<number, { beans: number }>).reduce((sum, p) => sum + p.beans, 0), 0);
  });
}


test('original hand actions are authoritative, replay-safe and bound to the human decision', () => {
  const core = table(1);
  const raw = [...core.catalog(0)!.rawByActionId.values()][0]!;
  const message = { type: 'ACTION', gameId, actionId: crypto.randomUUID(), decisionId: core.decision(0)!.decisionId, action: raw };
  const before = core.checkpoint();
  assert.throws(() => core.submitHuman(1, message, now), { code: 'FORBIDDEN' });
  assert.throws(() => core.submitHuman(0, { ...message, decisionId: 'stale' }, now), { code: 'AI_DECISION_STALE' });
  assert.throws(() => core.submitHuman(0, { ...message, action: { ...raw, cheat: true } }, now), { code: 'AI_ACTION_NOT_LEGAL' });
  assert.throws(() => core.submitHuman(0, message, now + 38000), { code: 'AI_DECISION_EXPIRED' });
  assert.deepEqual(core.checkpoint(), before);
  const ack = core.submitHuman(0, message, now + 1);
  const after = core.checkpoint();
  assert.deepEqual(new TableCore(after).submitHuman(0, message, now + 2), ack);
  assert.deepEqual(core.checkpoint(), after);
  assert.throws(() => core.submitHuman(0, { ...message, action: { kind: 'pass' } }, now + 2), { code: 'ACTION_ID_CONFLICT' });
});


test('mutating a restored table does not mutate its before-image used for UI deltas', () => {
  const original = table();
  const saved = original.checkpoint();
  const before = structuredClone(saved);
  const current = new TableCore(saved);
  current.submit(0, action(current, 0), now + 1);
  assert.deepEqual(saved, before);
  assert.notDeepEqual(current.view(0), new TableCore(saved).view(0));
  assert.deepEqual(current.view(0).entries.find(([kind]) => kind === 'match')![2].friendConfig, { waitMode: 'timeoutAuto', timeoutMs: 38000 });
});
