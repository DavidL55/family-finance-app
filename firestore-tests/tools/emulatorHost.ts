// The ONE place rules/emulator tests learn where Firestore is. `npm run test:rules` starts a
// dedicated emulator from firebase.rules-test.json (Firestore :8180) and exports
// FIRESTORE_EMULATOR_HOST; :8080 belongs to live mode (the family's real data, spec C1 §7) and a
// test run there would clearFirestore() it. So: no fallback, and 8080 is refused outright.
export const LIVE_FIRESTORE_PORT = 8080;
export const TEST_FIRESTORE_PORT = 8180;

export function testFirestoreHost(): { host: string; port: number } {
  const raw = process.env.FIRESTORE_EMULATOR_HOST;
  if (!raw) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set — run rules tests via `npm run test:rules` ' +
        `(dedicated emulator on :${TEST_FIRESTORE_PORT}), never against an emulator that is already running.`,
    );
  }
  const [host, portText] = raw.split(':');
  const port = Number(portText);
  if (port === LIVE_FIRESTORE_PORT) {
    throw new Error(`refusing to run against :${LIVE_FIRESTORE_PORT} — that port is LIVE mode (the family's real data).`);
  }
  return { host, port };
}
