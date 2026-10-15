// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveTarget } from '../cloud/adminApp';

describe('resolveTarget — a cloud script can never be pointed at the wrong DB by accident', () => {
  it('no emulator env, no flag → cloud', () => { expect(resolveTarget([], {})).toEqual({ kind: 'cloud' }); });
  it('emulator env without --emulator → refuse (never silently write the emulator thinking it is prod, or vice versa)', () => {
    expect(() => resolveTarget([], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180' })).toThrow(/--emulator/);
  });
  it('--emulator on :8080 → refuse (live mode)', () => {
    expect(() => resolveTarget(['--emulator'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toThrow(/LIVE/);
  });
  it('--emulator needs a demo- project', () => {
    expect(() => resolveTarget(['--emulator', '--project', 'family-finance-app-c9aa4'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180' })).toThrow(/demo-/);
    expect(resolveTarget(['--emulator', '--project', 'demo-restore'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180' }))
      .toEqual({ kind: 'emulator', projectId: 'demo-restore' });
  });
});
