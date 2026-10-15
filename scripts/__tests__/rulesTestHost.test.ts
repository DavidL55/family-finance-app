// @vitest-environment node
// Lives in scripts/__tests__ (not src/__tests__): it imports from firestore-tests/ and reads
// process.env, and src/__tests__/clientAiPlumbing.test.ts pins both for everything under src/.
import { afterEach, describe, expect, it } from 'vitest';
import { testFirestoreHost, TEST_FIRESTORE_PORT } from '../../firestore-tests/tools/emulatorHost';

const ORIGINAL = process.env.FIRESTORE_EMULATOR_HOST;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
  else process.env.FIRESTORE_EMULATOR_HOST = ORIGINAL;
});

describe('testFirestoreHost — rules tests never touch live mode', () => {
  it('refuses when FIRESTORE_EMULATOR_HOST is unset (no silent 8080 fallback)', () => {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    expect(() => testFirestoreHost()).toThrow(/npm run test:rules/);
  });
  it('refuses port 8080 — that is LIVE mode', () => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    expect(() => testFirestoreHost()).toThrow(/LIVE/);
  });
  it('returns the dedicated test emulator', () => {
    process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${TEST_FIRESTORE_PORT}`;
    expect(testFirestoreHost()).toEqual({ host: '127.0.0.1', port: 8180 });
  });
});
