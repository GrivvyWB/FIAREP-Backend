import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inferInstallationPersona,
  isModeAllowedForPersona,
  type InstallationPersona,
} from '../../artifacts/fiarep-mobile/lib/installation-persona';

const staffModes = ['administrator', 'management', 'worker', 'inspector', 'emergency'];
const allModes = ['resident', 'vendor', ...staffModes, 'procurement'];

test('a fresh installation has no inferred persona', () => {
  assert.equal(inferInstallationPersona(null, null), null);
});

test('existing resident and vendor installations retain their narrow persona', () => {
  assert.equal(inferInstallationPersona('resident', null), 'resident');
  assert.equal(inferInstallationPersona(null, 'resident'), 'resident');
  assert.equal(inferInstallationPersona('vendor', null), 'vendor');
  assert.equal(inferInstallationPersona(null, 'vendor'), 'vendor');
});

test('existing non-public roles migrate to staff', () => {
  for (const mode of staffModes) {
    assert.equal(inferInstallationPersona(mode, null), 'staff');
    assert.equal(inferInstallationPersona(null, mode), 'staff');
  }
});

test('resident, vendor, and staff permissions never overlap', () => {
  const expected: Record<InstallationPersona, string[]> = {
    resident: ['resident'],
    vendor: ['vendor'],
    staff: staffModes,
  };

  for (const persona of Object.keys(expected) as InstallationPersona[]) {
    assert.deepEqual(
      allModes.filter((mode) => isModeAllowedForPersona(persona, mode)),
      expected[persona],
    );
  }
});

test('a conflicting restored session is rejected for every persona', () => {
  assert.equal(isModeAllowedForPersona('resident', 'management'), false);
  assert.equal(isModeAllowedForPersona('vendor', 'resident'), false);
  assert.equal(isModeAllowedForPersona('staff', 'vendor'), false);
});