// Rules tests run against a real (ephemeral) Firestore emulator instance via
// @firebase/rules-unit-testing — they need Node, not jsdom, and must NOT load the app's
// src/__tests__/setup.ts (which mocks firebase/firestore for unit tests).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['firestore-tests/**/*.test.ts'],
    testTimeout: 20000, // rules-unit-testing spins up a real emulator connection per test file
  },
  resolve: {
    // Batch 8 — ai-overage-approval.emulator.test.ts drives the REAL costGate (functions/src) with
    // the Admin SDK. firebase-admin is installed in BOTH node_modules trees, and without this the
    // test file resolves the ROOT copy while costGate.ts (living under functions/) resolves
    // functions/node_modules — two module instances with two separate default-app registries, so
    // the app the test initialises is invisible to the code under test ("The default Firebase app
    // does not exist"). Deduping to one copy is what makes them the same SDK.
    dedupe: ['firebase-admin'],
  },
});
