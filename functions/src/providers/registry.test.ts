import { describe, expect, it } from 'vitest';
import { PROVIDER_REGISTRY, listConfiguredModels, getAdapterForModel, findModelEntry, listProviderIds } from './registry';

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
    expect(listProviderIds()).toEqual(Object.keys(PROVIDER_REGISTRY));
  });

  it('TRIPWIRE: matches the ids costGate.test.ts hardcodes in its registry mock', () => {
    // If this fails you have added or removed a provider. That is fine and expected — but update
    // `listProviderIds` in functions/src/costGate/costGate.test.ts's vi.mock factory (and the
    // provider loop in its "EVERY provider counter is read inside the SAME transaction" test) in
    // the same change, or the global-ceiling tests will quietly keep gating on the old set.
    expect(listProviderIds().slice().sort()).toEqual(['anthropic', 'google', 'mock', 'openai']);
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
