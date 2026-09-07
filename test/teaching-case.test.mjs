import test from 'node:test';
import assert from 'node:assert/strict';
import { teachingCaseFrame, teachingCaseContext } from '../lib/teaching-case.js';

test('case facts are step-scoped; previous steps cannot see future result', () => {
  const before = teachingCaseFrame(0);
  assert.equal(before.drawn, null);
  assert.equal(JSON.stringify(before).includes('+50'), false);
  assert.equal(JSON.stringify(teachingCaseFrame(1)).includes('+50'), false);
  assert.equal(teachingCaseFrame(2).score, 32);
  assert.equal(teachingCaseFrame(2).facts.some(value => value.includes('+48')), true);
  assert.match(teachingCaseContext(before), /永远绑定/);
  before.hand[0] = '9m';
  assert.equal(teachingCaseFrame(0).hand[0], '2s');
  for (const invalid of [-1, 3, 1.5, '1', null]) assert.throws(() => teachingCaseFrame(invalid));
});
