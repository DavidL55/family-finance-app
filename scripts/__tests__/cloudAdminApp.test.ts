// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAuth, resolveTarget } from '../cloud/adminApp';

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

describe('resolveTarget — cloud mode never accepts a foreign --project (I3)', () => {
  it('cloud + --project demo-x (no --emulator) → refuse instead of writing prod', () => {
    expect(() => resolveTarget(['--project', 'demo-c1-smoke'], {})).toThrow(/--emulator/);
    expect(() => resolveTarget(['--project=demo-c1-smoke'], {})).toThrow(/demo-c1-smoke/);
  });
  it('cloud + --project <the prod id> → ok', () => {
    expect(resolveTarget(['--project', 'family-finance-app-c9aa4'], {})).toEqual({ kind: 'cloud' });
    expect(resolveTarget(['--project=family-finance-app-c9aa4'], {})).toEqual({ kind: 'cloud' });
  });
});

describe('resolveTarget — the Auth half of the target is guarded too', () => {
  it('cloud run with a stray FIREBASE_AUTH_EMULATOR_HOST → refuse (would bind an emulator uid in prod)', () => {
    expect(() => resolveTarget([], { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })).toThrow(/FIREBASE_AUTH_EMULATOR_HOST/);
    expect(() => resolveTarget([], { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9199' })).toThrow(/--emulator/);
  });
  it('--emulator with the live auth port :9099 → refuse', () => {
    expect(() => resolveTarget(['--emulator'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })).toThrow(/LIVE/);
  });
  it('--emulator with the test auth port :9199 is accepted, and Firestore-only runs need no auth host', () => {
    const want = { kind: 'emulator', projectId: 'demo-restore' };
    expect(resolveTarget(['--emulator', '--project', 'demo-restore'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9199' })).toEqual(want);
    expect(resolveTarget(['--emulator', '--project', 'demo-restore'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180' })).toEqual(want);
  });
});

describe('openAuth — an emulator target never falls through to the real Auth service', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('throws before touching the Admin SDK when FIREBASE_AUTH_EMULATOR_HOST is unset', () => {
    vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '');
    expect(() => openAuth({ kind: 'emulator', projectId: 'demo-restore' })).toThrow(/FIREBASE_AUTH_EMULATOR_HOST/);
  });
});
