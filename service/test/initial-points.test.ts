import test from 'node:test';
import assert from 'node:assert/strict';
import { TableCore, normalizeTable, DEFAULT_INITIAL_POINTS } from '../src/table-core';

const now = 1800000000000;
const owner = { v: 1 as const, kind: 'owner' as const, tenant: 'test', owner: 'points', exp: now + 60000 };
const starts = [0, 25000, 50000, 1000000];
const seats = () => starts.map((initialPoints, seat) => ({ seat, kind: 'human', owner: seat === 0, initialPoints }));

test('the authoritative service validates initial points for human and AI seats', () => {
  const defaults = normalizeTable({ seats: seats().map(({ initialPoints, ...seat }) => seat) }, owner, crypto.randomUUID(), now);
  assert.deepEqual(defaults.seats.map(s => s.initialPoints), Array(4).fill(DEFAULT_INITIAL_POINTS));
  for (const kind of ['human', 'ai']) {
    for (const value of [-1, 1.5, 1000001, Infinity, NaN, null, '10000', true]) {
      const roster: any[] = seats();
      roster[1] = { seat: 1, kind, initialPoints: value, ...(kind === 'ai' ? { modelId: 'test' } : {}) };
      assert.throws(() => normalizeTable({ seats: roster }, owner, crypto.randomUUID(), now), { code: 'INVALID_INITIAL_POINTS' });
    }
  }
});

for (const ruleset of ['blood', 'guobiao'] as const) {
  const balance = ruleset === 'blood' ? 'beans' : 'points';
  const baseline = ruleset === 'blood' ? 'initialBeansBySeat' : 'initialPointsBySeat';
  test(`${ruleset}: individual initial points survive partial joins, recovery and repeated joins`, () => {
    let core = new TableCore(normalizeTable({ ruleset, seats: seats().reverse() }, owner, crypto.randomUUID(), now));
    core.join(2, now);
    core = new TableCore(core.checkpoint());
    for (const seat of [3, 0, 1]) core.join(seat, now);
    assert.deepEqual([0, 1, 2, 3].map(s => core.state.players[s][balance]), starts);
    assert.deepEqual(core.state[baseline], Object.fromEntries(starts.map((v, s) => [s, v])));
    const saved = core.checkpoint();
    core = new TableCore(saved);
    for (const seat of [0, 1, 2, 3]) core.join(seat, now + 1);
    assert.deepEqual(core.checkpoint(), saved);
    const displayed = core.view(0).entries.find(([kind]) => kind === (ruleset === 'blood' ? 'blood' : 'gb'))![2];
    assert.deepEqual([0, 1, 2, 3].map(s => displayed.players[s][balance]), starts);
  });

  test(`${ruleset}: old zero-point games resume without applying the new default`, () => {
    const metadata = normalizeTable({ ruleset, seats: seats() }, owner, crypto.randomUUID(), now);
    for (const seat of metadata.seats) delete seat.initialPoints;
    let core = new TableCore(metadata);
    core.join(0, now);
    core = new TableCore(core.checkpoint());
    for (const seat of [1, 2, 3]) core.join(seat, now);
    assert.deepEqual([0, 1, 2, 3].map(s => core.state.players[s][balance]), [0, 0, 0, 0]);
    const saved = core.checkpoint();
    assert.deepEqual(new TableCore(saved).checkpoint(), saved);
  });
}
