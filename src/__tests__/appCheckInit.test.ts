import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('App Check init (spec C1 §6.1)', () => {
  const src = readFileSync('src/services/firebase.ts', 'utf8');
  it('initializes App Check with reCAPTCHA v3 before Firestore', () => {
    expect(src).toMatch(/initializeAppCheck\(app,\s*\{\s*provider:\s*new ReCaptchaV3Provider/);
    expect(src.indexOf('initializeAppCheck(')).toBeLessThan(src.indexOf('initializeFirestore('));
  });
  it('never against the emulator, never without a site key', () => {
    expect(src).toMatch(/if\s*\(\s*!usingEmulator\s*&&\s*recaptchaSiteKey\s*\)/);
  });
  it('has no debug-token path', () => {
    expect(src).not.toMatch(/DEBUG_TOKEN/);
  });
});
