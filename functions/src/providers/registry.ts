import type { AiActionId, AiModelInfo, ProviderId, ProviderRegistryEntry } from './types';
import { mockAdapter } from './mockAdapter';
import { anthropicAdapter } from './anthropicAdapter';
import { openaiAdapter } from './openaiAdapter';
import { googleAdapter } from './googleAdapter';

const MOCK_MODELS: AiModelInfo[] = [{
  providerId: 'mock', modelId: 'mock-standard', label: 'מודל דמה (ללא מפתח)',
  defaultForActions: ['chat', 'insight', 'extraction'],
  usdInputPer1kTokens: 0, usdOutputPer1kTokens: 0,
}];

// UNVERIFIED / ILLUSTRATIVE PRICING (D15, D3, Sasha W12) — every usdInputPer1kTokens/
// usdOutputPer1kTokens value below is a placeholder, NOT confirmed against a live vendor pricing
// page. This implementer tried: Anthropic's pricing page 301-redirects to claude.com/pricing,
// which shows consumer/seat plans only, no per-token API rates; OpenAI's pricing page returned
// HTTP 403 to an automated fetch; Google's Gemini pricing page WAS fetched successfully but the
// exact model id used below (gemini-3-flash-preview) was not confidently distinguishable from
// several similarly-named current models (3.5/3.6/3.7 Flash) with materially different prices in
// the sources checked, and cross-checking via web search surfaced only third-party
// aggregator/SEO sites (cloudzero, morphllm, apidog, benchlm, aipricing.guru, pricepertoken,
// tokencost) that DISAGREED with each other on the same model's price. None of that clears the
// bar for "confidently verified" — presenting any of those numbers as confirmed would be passing
// off a guess as fact. costGate.quote() (Task 3) is the ONE place these numbers are multiplied
// into a ₪ figure; whoever provisions the first real provider key (D10) MUST re-check every price
// below directly on the vendor's own current API pricing page (not an aggregator) before the
// monthly ceiling is treated as protective for real money — re-verify usdToILSRate/rateAsOf in
// exchangeRate.ts at the same time (both halves of the ₪ conversion, not just one).
export const PROVIDER_REGISTRY: Record<ProviderId, ProviderRegistryEntry> = {
  mock: { adapter: mockAdapter, models: MOCK_MODELS },
  anthropic: {
    adapter: anthropicAdapter,
    models: [
      { providerId: 'anthropic', modelId: 'claude-opus-5', label: 'Claude Opus 5', defaultForActions: ['insight'],
        usdInputPer1kTokens: 0.015, usdOutputPer1kTokens: 0.075 }, // UNVERIFIED, see comment above
      { providerId: 'anthropic', modelId: 'claude-sonnet-5', label: 'Claude Sonnet 5', defaultForActions: ['chat'],
        usdInputPer1kTokens: 0.003, usdOutputPer1kTokens: 0.015 }, // UNVERIFIED, see comment above
    ],
  },
  openai: {
    adapter: openaiAdapter,
    models: [
      { providerId: 'openai', modelId: 'gpt-5.1', label: 'GPT-5.1', defaultForActions: ['chat'],
        usdInputPer1kTokens: 0.00125, usdOutputPer1kTokens: 0.01 }, // UNVERIFIED, see comment above
    ],
  },
  google: {
    adapter: googleAdapter,
    models: [
      // Same model string src/utils/FileProcessor.ts's client-side call uses today (that file
      // itself calls 'gemini-2.5-flash' — kept as 'gemini-3-flash-preview' per this plan's own
      // catalog choice; re-verify the model id is still live, not decommissioned, alongside price).
      { providerId: 'google', modelId: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', defaultForActions: ['extraction'],
        usdInputPer1kTokens: 0.0008, usdOutputPer1kTokens: 0.0032 }, // UNVERIFIED, see comment above
    ],
  },
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
