import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('App Check init — a missing site key is visible in a production build (T9)', () => {
  const load = async () => {
    vi.resetModules();
    const initializeAppCheck = vi.fn();
    vi.doMock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
    vi.doMock('firebase/app-check', () => ({ initializeAppCheck, ReCaptchaV3Provider: vi.fn() }));
    vi.doMock('firebase/firestore', () => ({
      initializeFirestore: vi.fn(() => ({})), persistentLocalCache: vi.fn(), persistentMultipleTabManager: vi.fn(), connectFirestoreEmulator: vi.fn(),
    }));
    vi.doMock('firebase/auth', () => ({ getAuth: vi.fn(() => ({})), connectAuthEmulator: vi.fn() }));
    vi.doMock('firebase/functions', () => ({ getFunctions: vi.fn(() => ({})), connectFunctionsEmulator: vi.fn() }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('../services/firebase');
    return { initializeAppCheck, warn };
  };
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); });

  it('PROD build, no site key → console.warn about App Check, no initialisation', async () => {
    vi.stubEnv('PROD', true); vi.stubEnv('DEV', false); vi.stubEnv('VITE_USE_EMULATOR', ''); vi.stubEnv('VITE_RECAPTCHA_SITE_KEY', '');
    const { initializeAppCheck, warn } = await load();
    expect(initializeAppCheck).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/App Check/);
  });
  it('PROD build with a site key → initialises, no warning', async () => {
    vi.stubEnv('PROD', true); vi.stubEnv('DEV', false); vi.stubEnv('VITE_USE_EMULATOR', ''); vi.stubEnv('VITE_RECAPTCHA_SITE_KEY', 'site-key');
    const { initializeAppCheck, warn } = await load();
    expect(initializeAppCheck).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });
  it('dev build / emulator, no site key → quiet', async () => {
    vi.stubEnv('PROD', false); vi.stubEnv('DEV', true); vi.stubEnv('VITE_USE_EMULATOR', '1'); vi.stubEnv('VITE_RECAPTCHA_SITE_KEY', '');
    const { initializeAppCheck, warn } = await load();
    expect(initializeAppCheck).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
