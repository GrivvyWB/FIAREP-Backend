import assert from 'node:assert/strict';
import test from 'node:test';
import {
  choosePersona,
  evaluateAccess,
} from '../../artifacts/fiarep-web/src/lib/access-policy';

test('a new browser can open only the three-choice landing page', () => {
  assert.deepEqual(evaluateAccess(null, '/', false), {});
  assert.deepEqual(evaluateAccess(null, '/resident', false), { redirect: '/' });
  assert.deepEqual(evaluateAccess(null, '/vendor', false), { redirect: '/' });
  assert.deepEqual(evaluateAccess(null, '/dashboard', false), { redirect: '/' });
});

test('the first website persona choice cannot be overwritten', () => {
  assert.equal(choosePersona(null, 'resident'), 'resident');
  assert.equal(choosePersona('resident', 'staff'), 'resident');
  assert.equal(choosePersona('vendor', 'resident'), 'vendor');
  assert.equal(choosePersona('staff', 'vendor'), 'staff');
});

test('resident and vendor browsers cannot reach another portal', () => {
  assert.deepEqual(evaluateAccess('resident', '/vendor', false), { redirect: '/resident' });
  assert.deepEqual(evaluateAccess('resident', '/dashboard', false), { redirect: '/resident' });
  assert.deepEqual(evaluateAccess('vendor', '/resident', false), { redirect: '/vendor' });
  assert.deepEqual(evaluateAccess('vendor', '/login', false), { redirect: '/vendor' });
});

test('stale staff authentication is cleared from public browsers', () => {
  assert.deepEqual(evaluateAccess('resident', '/resident', true), { clearAuth: true });
  assert.deepEqual(evaluateAccess('vendor', '/vendor', true), { clearAuth: true });
});

test('staff browsers must authenticate before protected routes render', () => {
  assert.deepEqual(evaluateAccess('staff', '/', false), { redirect: '/login' });
  assert.deepEqual(evaluateAccess('staff', '/resident', false), { redirect: '/login' });
  assert.deepEqual(evaluateAccess('staff', '/vendor', false), { redirect: '/login' });
  assert.deepEqual(evaluateAccess('staff', '/dashboard', true), {});
});

test('existing authenticated staff migrate to the staff persona', () => {
  assert.deepEqual(evaluateAccess(null, '/', true), { setPersona: 'staff' });
});