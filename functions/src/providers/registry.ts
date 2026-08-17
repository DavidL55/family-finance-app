import type { AiActionId, AiModelInfo, ProviderAdapter, ProviderId, ProviderRegistryEntry } from './types';
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

/**
 * Every provider id in the catalog, configured or not — deliberately NOT filtered by
 * `isConfigured()` (unlike listConfiguredModels below). costGate.spend() uses this to sum the
 * whole family's month-to-date spend for the ONE global ceiling (Task 8 review F2), and a
 * provider whose key was removed after it had already spent this month must still count toward
 * that total, or removing a key would silently free up budget.
 */
export function listProviderIds(): string[] {
  return Object.keys(PROVIDER_REGISTRY);
}

export function listConfiguredModels(action?: AiActionId): AiModelInfo[] {
  const out: AiModelInfo[] = [];
  for (const entry of Object.values(PROVIDER_REGISTRY)) {
    if (!entry.adapter.isConfigured()) continue;
    for (const m of entry.models) {
      // The `mock` clause is the ONE place this offer-side filter can diverge from
      // getAdapterForModel's server-side enforcement (Task 7 review, Important 1): every mock model
      // today is tagged for all three actions, so the two agree exactly, and registry.test.ts's
      // "agrees with listConfiguredModels(action)" test fails the moment a new mock model breaks
      // that. If it ever does, tag the mock model rather than widening the enforcement.
      if (!action || m.defaultForActions.includes(action) || entry.adapter.id === 'mock') out.push(m);
    }
  }
  return out;
}

export interface ModelEntry {
  adapter: ProviderAdapter;
  model: AiModelInfo;
}

/**
 * The action-BLIND catalog lookup: "does this modelId exist anywhere in the registry, and at what
 * price". Deliberately says nothing about whether the model may serve a given action, because its
 * one caller — costGate.quote() — is pricing a model, not choosing an adapter to call, and pricing
 * genuinely has no action axis.
 *
 * MUST NOT be used to pick an adapter to actually invoke. Use getAdapterForModel(modelId, action)
 * for that; it is the function whose name a handler reaches for, and its required `action`
 * argument is what makes the tag check impossible to forget.
 */
export function findModelEntry(modelId: string): ModelEntry | null {
  for (const entry of Object.values(PROVIDER_REGISTRY)) {
    const model = entry.models.find(m => m.modelId === modelId);
    if (model) return { adapter: entry.adapter, model };
  }
  return null;
}

export type ModelResolutionFailureReason = 'unknown-model' | 'action-not-allowed';

export type ModelResolution =
  | ({ ok: true } & ModelEntry)
  | { ok: false; reason: ModelResolutionFailureReason; messageHe: string };

// Hebrew action names for the refusal copy below, so the message says WHICH kind of request the
// chosen model isn't meant for rather than a generic "wrong model". 'insight' has no UI trigger
// yet (D5) but is a real catalog action, so it gets a real label rather than a placeholder.
const ACTION_LABEL_HE: Record<AiActionId, string> = {
  chat: 'צ׳אט',
  insight: 'תובנות',
  extraction: 'ניתוח מסמכים',
};

/**
 * Task 7 review, Important 1 — SERVER-SIDE ACTION-TAG ENFORCEMENT.
 *
 * This used to be a plain `getAdapterForModel(modelId)` that matched by modelId across the WHOLE
 * registry and ignored `defaultForActions` entirely. The action tag was enforced ONLY client-side,
 * in ModelPicker's `listConfiguredModels(action)` — so a direct callable invocation (bypassing the
 * UI, or a buggy caller) could hand a chat-only model id such as `gpt-5.1` to aiExtractDocument.
 * For a PDF, the OpenAI adapter sends only its disclosed-gap text note, so no real document ever
 * reaches the model — yet `spend()` still ran and real money was consumed for an answer with
 * nothing behind it. (Proven before this fix: quote() and spend('...','extraction',...) both ran.)
 *
 * The check lives HERE, not duplicated in each handler, for one reason that outweighs the extra
 * indirection: `action` is a REQUIRED parameter, so a Stage 8/9 handler that forgets the check
 * does not compile. A per-handler check — or an optional parameter here — would have been a rule
 * a new handler could silently skip, which is precisely how this gap was inherited by two handlers
 * in the first place. The refusal COPY travels with the resolution for the same reason: the third
 * handler inherits an actionable Hebrew message without re-authoring one.
 *
 * `defaultForActions` stays the single source of truth for "may this model serve this action" —
 * the same field ModelPicker filters on — so client and server can never disagree about a model
 * without the tag itself changing (guarded by a registry test that compares the two directly).
 */
export function getAdapterForModel(modelId: string, action: AiActionId): ModelResolution {
  const found = findModelEntry(modelId);
  if (!found) return { ok: false, reason: 'unknown-model', messageHe: 'מודל לא מוכר' };
  if (!found.model.defaultForActions.includes(action)) {
    return {
      ok: false,
      reason: 'action-not-allowed',
      messageHe: `המודל שנבחר אינו מיועד ל${ACTION_LABEL_HE[action]} — בחר מודל אחר בבורר.`,
    };
  }
  return { ok: true, ...found };
}
