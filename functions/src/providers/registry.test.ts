import { describe, expect, it } from 'vitest';
import { PROVIDER_REGISTRY, listConfiguredModels, getAdapterForModel } from './registry';

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
  it('getAdapterForModel returns null for an unknown modelId (fail-closed, not a throw)', () => {
    expect(getAdapterForModel('made-up-model-9000')).toBeNull();
  });
  it('getAdapterForModel resolves a real mock model to the mock adapter', () => {
    const found = getAdapterForModel('mock-standard');
    expect(found?.adapter.id).toBe('mock');
  });
});
