import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROVIDER_REGISTRY, listConfiguredModels, getAdapterForModel, findModelEntry, listProviderIds } from './registry';
import type { AiActionId } from './types';

describe('provider registry (D3)', () => {
  it('mock is always configured, with no env var required', () => {
    expect(PROVIDER_REGISTRY.mock.adapter.isConfigured()).toBe(true);
  });
  it('listConfiguredModels never includes a provider whose adapter reports unconfigured', () => {
    const models = listConfiguredModels();
    for (const m of models) {
      expect(PROVIDER_REGISTRY[m.providerId].adapter.isConfigured()).toBe(true);
    }
  });
  it('filters by action — insight is a valid catalog action even with no UI trigger yet (D5)', () => {
    const insightModels = listConfiguredModels('insight');
    expect(Array.isArray(insightModels)).toBe(true);
  });
  it('getAdapterForModel refuses an unknown modelId (fail-closed, not a throw)', () => {
    const res = getAdapterForModel('made-up-model-9000', 'chat');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe('unknown-model');
  });
  it('getAdapterForModel resolves a real mock model to the mock adapter', () => {
    const res = getAdapterForModel('mock-standard', 'extraction');
    expect(res.ok).toBe(true);
    expect(res.ok === true && res.adapter.id).toBe('mock');
  });
});

// Task 7 review, Important 1 — the action tag was enforced ONLY client-side (ModelPicker's
// listConfiguredModels(action)). getAdapterForModel matched by modelId across the WHOLE registry
// and ignored defaultForActions entirely, so a direct callable invocation could hand a chat-only
// model id to aiExtractDocument, reach the adapter's disclosed-gap path (no real document ever
// reaches the model) and still burn real money through spend(). The action is now a REQUIRED
// argument of the one lookup handlers use to choose an adapter to CALL.
describe('getAdapterForModel — server-side action-tag enforcement (Task 7 review, Important 1)', () => {
  it('refuses a chat-only model for extraction', () => {
    // gpt-5.1 is tagged defaultForActions: ['chat'] only.
    const res = getAdapterForModel('gpt-5.1', 'extraction');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe('action-not-allowed');
  });
  it('refuses an extraction-only model for chat', () => {
    // gemini-3-flash-preview is tagged defaultForActions: ['extraction'] only.
    const res = getAdapterForModel('gemini-3-flash-preview', 'chat');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe('action-not-allowed');
  });
  it('allows a model for an action it is genuinely tagged for', () => {
    expect(getAdapterForModel('gpt-5.1', 'chat').ok).toBe(true);
    expect(getAdapterForModel('gemini-3-flash-preview', 'extraction').ok).toBe(true);
    expect(getAdapterForModel('claude-opus-5', 'insight').ok).toBe(true);
  });
  it('carries actionable Hebrew copy that names the action, distinct from the unknown-model copy', () => {
    const mismatch = getAdapterForModel('gpt-5.1', 'extraction');
    const unknown = getAdapterForModel('made-up-model-9000', 'extraction');
    expect(mismatch.ok === false && mismatch.messageHe).toMatch(/ניתוח מסמכים/);
    expect(mismatch.ok === false && mismatch.messageHe).not.toBe(unknown.ok === false && unknown.messageHe);
  });
  // The single source of truth for "may this model serve this action" must stay the registry's own
  // defaultForActions tag — the same field ModelPicker filters on client-side — so the two halves
  // can never disagree about a model without the tag itself changing.
  it('agrees with listConfiguredModels(action) for every model in the catalog', () => {
    const actions = ['chat', 'insight', 'extraction'] as const;
    for (const action of actions) {
      const listed = new Set(listConfiguredModels(action).map((m) => m.modelId));
      for (const entry of Object.values(PROVIDER_REGISTRY)) {
        if (!entry.adapter.isConfigured()) continue;
        for (const m of entry.models) {
          expect(getAdapterForModel(m.modelId, action).ok).toBe(listed.has(m.modelId));
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Review of 9ca9eea, F-D — costGate's global ceiling (F2) is enforced against the SUM of every
// provider's counter, and the provider list comes from listProviderIds(). Production reads it
// straight off the registry, so a fifth provider is picked up automatically — but
// costGate.test.ts HARDCODES the four ids in its `vi.mock('../providers/registry')` factory, and
// nothing pinned that copy to the real thing. A fifth provider would therefore ship with every
// F2 test still gating on four counters and still passing, i.e. the gate's own test suite would
// stop testing the gate that ships. This file is the right home for the check precisely because
// it does NOT mock the registry.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('listProviderIds — the provider list the global cost ceiling is summed over (Review of 9ca9eea, F-D)', () => {
  it('is derived from the registry itself, never a second hand-maintained list', () => {
    // The equality below is necessary but NOT sufficient, and the mutation sweep proved it: a
    // hand-maintained `return ['mock', 'anthropic', 'openai', 'google']` written in insertion
    // order satisfies it exactly, so the test's own title was a claim it did not establish.
    expect(listProviderIds()).toEqual(Object.keys(PROVIDER_REGISTRY));

    // What makes it sufficient: a provider that exists in the registry ONLY at call time. No
    // literal written into the function's body can contain it, so this passes if and only if the
    // ids are read off PROVIDER_REGISTRY when listProviderIds runs. defineProperty/deleteProperty
    // rather than an index assignment because the registry is keyed by the ProviderId union and a
    // probe id is deliberately not a member of it — no cast, no `any`.
    const PROBE = 'zzz-probe-provider';
    Object.defineProperty(PROVIDER_REGISTRY, PROBE, {
      value: { adapter: PROVIDER_REGISTRY.mock.adapter, models: [] },
      configurable: true,
      enumerable: true,
      writable: true,
    });
    try {
      expect(listProviderIds()).toContain(PROBE);
    } finally {
      Reflect.deleteProperty(PROVIDER_REGISTRY, PROBE);
    }
    // Restored, so the tripwire below and every other suite still see the real four.
    expect(listProviderIds()).not.toContain(PROBE);
  });

  it('TRIPWIRE: matches the ids costGate.test.ts hardcodes in its registry mock', () => {
    // If this fails you have added or removed a provider. That is fine and expected — but update
    // `listProviderIds` in functions/src/costGate/costGate.test.ts's vi.mock factory (and the
    // provider loop in its "EVERY provider counter is read inside the SAME transaction" test) in
    // the same change, or the global-ceiling tests will quietly keep gating on the old set.
    expect(listProviderIds().slice().sort()).toEqual(['anthropic', 'google', 'mock', 'openai']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BATCH 8 (closing review B5) — THE HEAD OF THIS LIST IS THE APP'S DEFAULT MODEL, AND IT WAS THE
// MOCK IN EVERY ENVIRONMENT.
//
// `listConfiguredModels(action)[0]` is not merely "the first row of a catalog". SIX call sites
// read exactly that index and treat it as the default: SyncService.syncFilesFromDrive's UNATTENDED
// whole-folder/incremental/custom-range/month-board import (the app's highest-volume egress path,
// where no human is present to pick), the four extraction surfaces' auto-selected picker value,
// useAiChat's auto-selected chat model, and AiExtractionEgressNotice's `source="default"` branch,
// which names the recipient of the documents on that basis.
//
// 'mock' was the first key of PROVIDER_REGISTRY and mockAdapter.isConfigured() returns true
// unconditionally, so index 0 resolved to mock-standard for chat, insight AND extraction — with
// every provider key set. Verified by EXECUTING the registry, not read off the source: whole-folder
// sync always called the mock and queued its canned 'עסקת דמה / ₪100' row into the review modal,
// and a real provider was reachable only by a deliberate per-session picker switch that resets on
// every mount.
//
// The ordering is decided HERE and nowhere else, because the client cannot decide it: every client
// call site receives this list over the wire from listAiModels and has no registry to consult. One
// seam, and the notice's `source="default"` correspondence with SyncService stays exactly the same
// expression over exactly the same list.
//
// The rule is one bit — mock exists so the app runs with zero keys, not so it silently intercepts
// real work — and it is carried by a REQUIRED `tier` field on the registry entry rather than by an
// `id === 'mock'` test in the sort, for the reason getAdapterForModel's required `action` argument
// exists: a fifth provider must not be able to inherit a default-ordering decision nobody made.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('listConfiguredModels — a real configured provider wins the default (closing review B5)', () => {
  const KEY_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Explicit, not inherited: the shell (or a stray functions/.env.local) may hold a real key,
    // and a test whose fixture depends on the ambient environment proves nothing about either
    // branch. Every case below sets exactly the keys it means to.
    for (const v of KEY_VARS) { saved[v] = process.env[v]; delete process.env[v]; }
  });

  afterEach(() => {
    for (const v of KEY_VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  const ACTIONS: AiActionId[] = ['chat', 'insight', 'extraction'];

  it('ZERO-KEY OPERATION: with no provider key at all, the mock IS the default for every action', () => {
    for (const action of ACTIONS) {
      const models = listConfiguredModels(action);
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].providerId).toBe('mock');
    }
    // …and it is the ONLY thing offered, which is what makes the zero-key path genuinely usable
    // rather than an empty picker.
    expect(listConfiguredModels().every((m) => m.providerId === 'mock')).toBe(true);
  });

  it.each(ACTIONS)(
    'with every provider key set, the default for %s is a REAL provider, never the mock',
    (action) => {
      for (const v of KEY_VARS) process.env[v] = 'test-key';
      const models = listConfiguredModels(action);
      expect(models.length).toBeGreaterThan(1); // otherwise the assertion below is vacuous
      expect(models[0].providerId).not.toBe('mock');
      // Every real model sorts ahead of the mock — the mock is the tail, not merely not-the-head.
      const mockIndex = models.findIndex((m) => m.providerId === 'mock');
      expect(mockIndex).toBe(models.length - 1);
    }
  );

  it('the mock is still OFFERED when real providers are configured — demoted, never removed', () => {
    // Demotion, not filtering. A super-admin must still be able to choose the mock deliberately
    // (a zero-cost smoke test against a live key set), and D10's mock badge plus the "no egress"
    // disclosure line both exist for exactly that selection.
    for (const v of KEY_VARS) process.env[v] = 'test-key';
    for (const action of ACTIONS) {
      expect(listConfiguredModels(action).some((m) => m.providerId === 'mock')).toBe(true);
    }
  });

  it('ONE configured real provider is enough to displace the mock — the rule is per-action', () => {
    // extraction has exactly one real model in the catalog (google's). With only the Anthropic key
    // set, extraction has no real option and correctly falls back to the mock, while chat and
    // insight do not — so this is not "any key anywhere demotes the mock everywhere".
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect(listConfiguredModels('chat')[0].providerId).toBe('anthropic');
    expect(listConfiguredModels('insight')[0].providerId).toBe('anthropic');
    expect(listConfiguredModels('extraction')[0].providerId).toBe('mock');

    delete process.env.ANTHROPIC_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';
    expect(listConfiguredModels('extraction')[0].providerId).toBe('google');
    expect(listConfiguredModels('chat')[0].providerId).toBe('mock');
  });

  it('every registry entry declares a tier — a new provider cannot inherit the ordering by accident', () => {
    // The `tier` field is REQUIRED by the type, so this cannot fail at runtime without the type
    // failing first; it is here so the INTENT is asserted rather than only compiled, and so the
    // one fallback entry is pinned as the only one.
    const fallbacks = Object.entries(PROVIDER_REGISTRY)
      .filter(([, entry]) => entry.tier === 'fallback')
      .map(([id]) => id);
    expect(fallbacks).toEqual(['mock']);
    for (const entry of Object.values(PROVIDER_REGISTRY)) {
      expect(['real', 'fallback']).toContain(entry.tier);
    }
  });

  it('ordering is stable within a tier — registry order still decides between two real providers', () => {
    for (const v of KEY_VARS) process.env[v] = 'test-key';
    const chat = listConfiguredModels('chat').filter((m) => m.providerId !== 'mock');
    // anthropic precedes openai in PROVIDER_REGISTRY, and nothing in the tier sort reorders them.
    expect(chat.map((m) => m.providerId)).toEqual(['anthropic', 'openai']);
  });
});

describe('findModelEntry — the action-blind catalog/pricing lookup', () => {
  it('resolves a model regardless of which action it is tagged for (pricing has no action axis)', () => {
    expect(findModelEntry('gpt-5.1')?.model.providerId).toBe('openai');
    expect(findModelEntry('gemini-3-flash-preview')?.model.providerId).toBe('google');
  });
  it('returns null for an unknown modelId', () => {
    expect(findModelEntry('made-up-model-9000')).toBeNull();
  });
});
