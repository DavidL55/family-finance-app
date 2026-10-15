// Task 8 (C1) — AI features are off in production builds. A production build IS the cloud deploy
// (live mode runs the dev server), so the switch is the build mode itself.
//
// The gate tests below drive the REAL `assertAiEnabled` through `vi.stubEnv('PROD', true)` and a
// fresh module graph. They deliberately do not mock `../config/aiAvailability`: a mock of the
// module under test cannot fail (Ruling F3).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('firebase/functions');
  vi.doUnmock('../services/firebase');
  vi.resetModules();
});

async function importAiClientWithSpy() {
  vi.resetModules();
  const httpsCallable = vi.fn(() => vi.fn(async () => ({ data: {} })));
  vi.doMock('firebase/functions', () => ({ httpsCallable }));
  vi.doMock('../services/firebase', () => ({ functions: {} }));
  const ai = await import('../services/aiClient');
  return { ai, httpsCallable };
}

describe('AI availability (spec C1 §1 — AI off in the cloud)', () => {
  it('is derived from the build mode, not from an env knob', () => {
    const src = readFileSync('src/config/aiAvailability.ts', 'utf8');
    expect(src).toMatch(/AI_ENABLED\s*(:\s*boolean)?\s*=\s*!import\.meta\.env\.PROD/);
  });

  it('a production build disables AI and assertAiEnabled throws the Hebrew notice', async () => {
    vi.stubEnv('PROD', true);
    vi.resetModules();
    const m = await import('../config/aiAvailability');
    expect(m.AI_ENABLED).toBe(false);
    expect(() => m.assertAiEnabled()).toThrow(m.AI_UNAVAILABLE_MESSAGE);
    expect(m.AI_UNAVAILABLE_MESSAGE).toMatch(/AI/);
  });

  it('a non-production build leaves AI enabled and assertAiEnabled silent', async () => {
    vi.stubEnv('PROD', false);
    vi.resetModules();
    const m = await import('../config/aiAvailability');
    expect(m.AI_ENABLED).toBe(true);
    expect(() => m.assertAiEnabled()).not.toThrow();
  });

  it('every exported callable in aiClient refuses before touching the network in a production build', async () => {
    vi.stubEnv('PROD', true);
    const { ai, httpsCallable } = await importAiClientWithSpy();
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['listAiModels', () => ai.listAiModels()],
      ['getAiUsageSummary', () => ai.getAiUsageSummary()],
      ['setAiCostCeiling', () => ai.setAiCostCeiling(1)],
      ['sendChatMessage', () => ai.sendChatMessage({} as never)],
      ['extractDocument', () => ai.extractDocument({} as never)],
      ['requestAiOverageApproval', () => ai.requestAiOverageApproval({} as never)],
    ];
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toThrow(/AI/);
    }
    expect(httpsCallable).not.toHaveBeenCalled();
  });

  it('the pinned list above is the COMPLETE set of aiClient callables (a seventh one cannot slip past ungated)', () => {
    const src = readFileSync('src/services/aiClient.ts', 'utf8');
    const exported = [...src.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]).sort();
    expect(exported).toEqual([
      'extractDocument', 'getAiUsageSummary', 'listAiModels',
      'requestAiOverageApproval', 'sendChatMessage', 'setAiCostCeiling',
    ]);
  });

  it('outside a production build the callables still reach httpsCallable (the gate does not block dev)', async () => {
    vi.stubEnv('PROD', false);
    const { ai, httpsCallable } = await importAiClientWithSpy();
    await ai.listAiModels();
    expect(httpsCallable).toHaveBeenCalledTimes(1);
  });

  it('source pin: every AI entry point is gated on AI_ENABLED', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(/isSuperAdmin\s*&&\s*AI_ENABLED\s*\?\s*\[\{\s*id:\s*'ai-settings'/);
    expect(app).toMatch(/AI_ENABLED\s*&&\s*<SyncButton/);
    expect(app).toMatch(/case 'folder':\s*return AI_ENABLED\s*\?/);
    // InvestmentsPortfolio has no render suite (pre-flight L2): pin both the trigger and the modal.
    const inv = readFileSync('src/components/InvestmentsPortfolio.tsx', 'utf8');
    expect(inv).toMatch(/\{AI_ENABLED\s*&&\s*\(\s*<button[^>]*onClick=\{\(\) => setShowImportModal\(true\)\}/);
    expect(inv).toMatch(/\{AI_ENABLED\s*&&\s*\(\s*<InvestmentsImportModal/);
    expect(readFileSync('src/components/AssetCard.tsx', 'utf8')).toMatch(/\)\s*:\s*AI_ENABLED\s*\?\s*\(\s*<>/);
    expect(readFileSync('src/components/Dashboard.tsx', 'utf8')).toMatch(/\{AI_ENABLED\s*\?\s*\(/);
  });
});
