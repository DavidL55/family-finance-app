import type { AiActionId, AiModelInfo, ProviderId, ProviderRegistryEntry } from './types';
import { mockAdapter } from './mockAdapter';
// Task 4 adds: import { anthropicAdapter } from './anthropicAdapter'; etc.

const MOCK_MODELS: AiModelInfo[] = [{
  providerId: 'mock', modelId: 'mock-standard', label: 'מודל דמה (ללא מפתח)',
  defaultForActions: ['chat', 'insight', 'extraction'],
  usdInputPer1kTokens: 0, usdOutputPer1kTokens: 0,
}];

// Task 4 fills in real entries for anthropic/openai/google with their own adapters + catalogs.
// Adding a sixth provider later = one more entry here + one more adapter file (D3) — this
// object is the only file a new provider touches; Task 4's contract test iterates this object
// directly, so no test file needs a change too (fixes the pre-review draft's own contradiction
// of this exact claim).
export const PROVIDER_REGISTRY: Record<ProviderId, ProviderRegistryEntry> = {
  mock: { adapter: mockAdapter, models: MOCK_MODELS },
  anthropic: { adapter: mockAdapter, models: [] }, // placeholder until Task 4
  openai: { adapter: mockAdapter, models: [] },
  google: { adapter: mockAdapter, models: [] },
};

export function listConfiguredModels(action?: AiActionId): AiModelInfo[] {
  const out: AiModelInfo[] = [];
  for (const entry of Object.values(PROVIDER_REGISTRY)) {
    if (!entry.adapter.isConfigured()) continue;
    for (const m of entry.models) {
      if (!action || m.defaultForActions.includes(action) || entry.adapter.id === 'mock') out.push(m);
    }
  }
  return out;
}

export function getAdapterForModel(modelId: string) {
  for (const entry of Object.values(PROVIDER_REGISTRY)) {
    const model = entry.models.find(m => m.modelId === modelId);
    if (model) return { adapter: entry.adapter, model };
  }
  return null;
}
