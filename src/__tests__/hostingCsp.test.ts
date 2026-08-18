import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Regression guard for Stage 6 Task 2's third-lens M1 fix: the Hosting CSP's `connect-src` must
// list the Cloud Functions invocation domains, or `httpsCallable` silently gets blocked by the
// browser's own CSP on the very first real `firebase deploy` (chat + document import both break
// at once, with nothing in our own code to catch it — no thrown exception, no HttpsError, no
// Rules denial, just a CSP violation in the browser console).
//
// This was believed "invisible locally" — the plan, the Task 2 brief, and the implementer's own
// ledger all said the Hosting CSP could only be checked by reading `firebase.json` carefully,
// because this project's `emulators` block has no explicit `hosting` entry. That premise is
// FALSE: firebase-tools auto-starts the Hosting emulator for any product with a top-level
// `firebase.json` key even with no `emulators.hosting` port configured (it just falls back to a
// free port — 5002 was observed), and it serves the real CSP header, byte for byte, including
// this fix. A reviewer confirmed this with `npm run emu` + `curl -I http://127.0.0.1:5002/`.
//
// This test takes the cheaper of the two ways to make that verifiable in CI without booting an
// emulator: read and parse firebase.json directly and assert the `connect-src` directive contains
// the Functions domains. (An emulator-based check — booting the Hosting emulator and curling it —
// would additionally prove firebase-tools actually serves what's configured, but that's
// firebase-tools' own behavior, not this repo's; parsing the config we own is enough to catch a
// regression where someone edits `connect-src` and drops the Functions entries.)

interface FirebaseHostingHeader {
  key: string;
  value: string;
}

interface FirebaseHostingHeaderRule {
  source: string;
  headers: FirebaseHostingHeader[];
}

interface FirebaseJson {
  hosting?: {
    headers?: FirebaseHostingHeaderRule[];
  };
}

function readConnectSrc(): string[] {
  const raw = readFileSync(join(process.cwd(), 'firebase.json'), 'utf8');
  const config = JSON.parse(raw) as FirebaseJson;

  const headerRules = config.hosting?.headers ?? [];
  const catchAllRule = headerRules.find((rule) => rule.source === '/**') ?? headerRules[0];
  expect(catchAllRule, 'firebase.json hosting.headers has no rule to read a CSP from').toBeTruthy();

  const cspHeader = catchAllRule.headers.find((h) => h.key === 'Content-Security-Policy');
  expect(cspHeader, 'firebase.json hosting.headers has no Content-Security-Policy entry').toBeTruthy();

  const directives = cspHeader!.value.split(';').map((d) => d.trim());
  const connectSrcDirective = directives.find((d) => d.startsWith('connect-src'));
  expect(connectSrcDirective, 'CSP has no connect-src directive').toBeTruthy();

  return connectSrcDirective!.split(/\s+/).slice(1); // drop the "connect-src" token itself
}

describe('Hosting CSP connect-src includes the Cloud Functions invocation domains (Stage 6 Task 2, third-lens M1)', () => {
  it('lists the cloudfunctions.net REST domain', () => {
    const sources = readConnectSrc();
    expect(sources).toContain('https://*.cloudfunctions.net');
  });

  it('lists the *.a.run.app domain 2nd-gen Functions actually resolves to', () => {
    const sources = readConnectSrc();
    expect(sources).toContain('https://*.a.run.app');
  });

  it('is not just those two entries — the pre-existing Firebase/Google origins are still present', () => {
    const sources = readConnectSrc();
    expect(sources).toContain('https://firestore.googleapis.com');
    expect(sources).toContain('https://accounts.google.com');
  });

  // Batch 9 (closing review M3) — the client has not spoken to a model provider since Task 7 put
  // every provider call behind a Cloud Function, so the named Gemini origin was stale config.
  //
  // Removing it is TIDYING, NOT TIGHTENING, and saying so matters: the broad
  // `https://*.googleapis.com` entry directly above it already matches
  // generativelanguage.googleapis.com, and it has to stay — Firestore, Drive and the token
  // endpoints all live under it. So this asserts the named entry is gone, and does NOT pretend
  // the browser is now blocked from reaching Gemini. (Narrowing that wildcard is a real piece of
  // work with a real blast radius, and belongs to Stage 11 hardening, not to this batch.)
  it('no longer names a model-provider origin the client never calls', () => {
    expect(readConnectSrc()).not.toContain('https://generativelanguage.googleapis.com');
  });
});
