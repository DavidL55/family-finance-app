// Stage 6 close — THE ONE PIN, NOW READ BY TWO GUARDS FROM TWO DIFFERENT DIRECTIONS.
//
// CLIENT_ENV_READS lived inside clientAiPlumbing.test.ts, where it answered one question: which
// environment-variable NAMES may be read by the sources that reach the client build. The closing
// review found the question was too narrow — Vite PLUGINS put values into the bundle without
// reading anything under src/ — so a second guard now asks the complementary question against the
// build output: which environment VALUES may appear in dist/.
//
// Those are the same set, and that is the point of moving the list here rather than writing a
// second one beside it:
//
//   · a value may legitimately sit in the bundle exactly when a pinned name put it there;
//   · one list means one place to add a name, with one written reason, seen by one reviewer;
//   · and the two refusals already attached to this list — no pinned name may BE or END WITH a
//     provider key name derived from functions/src/providers/*Adapter.ts, and none may be
//     secret-SHAPED — therefore protect the build-output guard too. Adding VITE_GEMINI_API_KEY
//     here to silence a dist/ failure fails those instead. There is no edit to this file that
//     buys silence.
//
// A helper MODULE, not an import between test files: importing one test file from another
// executes its cases inside the importing suite (see extractionSurfaces.ts's header for the time
// that mattered). Nothing here is a test, so vitest never collects it.

/** One pinned client-side environment variable, and the reason it is safe in a public bundle. */
export interface ClientEnvRead {
  name: string;
  whyPublic: string;
}

/**
 * Every environment variable the client build is allowed to read — and therefore every value the
 * shipped bundle is allowed to carry.
 *
 * Adding a line here is a deliberate act with a reviewer attached, which is the point. It is also
 * NOT sufficient on its own: a name matching a provider key or a secret shape is refused whatever
 * this list says (see clientAiPlumbing.test.ts).
 */
export const CLIENT_ENV_READS: ReadonlyArray<ClientEnvRead> = [
  { name: 'DEV', whyPublic: "Vite's own build-mode flag — a boolean, not a value of ours." },
  { name: 'NODE_ENV', whyPublic: 'the build mode again, via process.env in a dev-only console warning.' },
  { name: 'VITE_USE_EMULATOR', whyPublic: 'a local-development switch — "1" or absent.' },
  {
    name: 'VITE_FIREBASE_API_KEY',
    whyPublic:
      'the Firebase WEB API key, which is a public client identifier by design — it identifies ' +
      'the project to Google and authorises nothing on its own. Firestore Rules and App Check are ' +
      'the access boundary, and both assume every client holds this value. It is NOT a provider ' +
      'secret, which is why the provider-key rule is derived from the adapters rather than ' +
      'written as "anything called API_KEY". It IS in dist/assets/*.js today, deliberately.',
  },
  { name: 'VITE_FIREBASE_AUTH_DOMAIN', whyPublic: 'public Firebase project config.' },
  { name: 'VITE_FIREBASE_PROJECT_ID', whyPublic: 'public Firebase project config.' },
  { name: 'VITE_FIREBASE_STORAGE_BUCKET', whyPublic: 'public Firebase project config.' },
  { name: 'VITE_FIREBASE_MESSAGING_SENDER_ID', whyPublic: 'public Firebase project config.' },
  { name: 'VITE_FIREBASE_APP_ID', whyPublic: 'public Firebase project config.' },
  {
    name: 'VITE_GOOGLE_CLIENT_ID',
    whyPublic:
      'the OAuth CLIENT id — public by construction; it is half of a pair and the secret half ' +
      'never leaves the server.',
  },
];
