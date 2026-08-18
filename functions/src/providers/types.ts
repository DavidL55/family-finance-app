export type ProviderId = 'mock' | 'anthropic' | 'openai' | 'google';
export type AiActionId = 'chat' | 'insight' | 'extraction';

export interface AiModelInfo {
  providerId: ProviderId;
  modelId: string;              // e.g. 'claude-sonnet-5'
  label: string;                // e.g. 'Claude Sonnet 5'
  defaultForActions: AiActionId[];
  /**
   * USD, as providers actually bill (third-lens M5) — illustrative, verify against the
   * provider's live pricing page before Task 4 Step 6. Converted to ILS by costGate.quote()
   * (Task 3) via the registry's own EXCHANGE_RATE, never hardcoded per-model in ILS — a single
   * shared rate that can go stale VISIBLY (rateAsOf surfaced in CostQuote and Task 8's usage
   * screen) instead of N per-model ILS numbers silently drifting from the real USD/ILS rate
   * independently of each other.
   */
  usdInputPer1kTokens: number;
  usdOutputPer1kTokens: number;
}

export interface ChatMessage { role: 'user' | 'model'; text: string; }

// Carries a full messages array (oldest-first), not a single system/user pair — fixed here, at
// the point this interface is first written, so multi-turn chat (Task 5) and any future streaming
// are additive, not a breaking change to ProviderAdapter later (Sun's A2 finding on the pre-review
// draft, whose aiChat destructured `history` and never used it).
export interface GenerateTextRequest {
  systemPrompt: string;
  messages: ChatMessage[];      // single-turn callers (extraction) pass exactly one 'user' message
  modelId: string;
}
export interface GenerateTextResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}
export interface GenerateJsonRequest extends GenerateTextRequest {
  jsonSchemaHint: string;       // provider-specific schema/response-format instructions, prompt-embedded
  /**
   * Task 7 — document extraction's own addition, additive-only (Sun's D3 "multi-turn-ready, not a
   * breaking change later" precedent applied again here): the ONLY caller today (aiExtractDocument.ts)
   * sends a document's binary content alongside the extraction prompt; chat/insight's generateJson
   * callers (none yet) simply never set this field. Optional so every existing generateJson call
   * site (mock/contract tests, a future non-document JSON caller) keeps compiling unchanged.
   * base64Data is the SAME base64 string aiExtractDocument.ts already validated against
   * MAX_DOCUMENT_BASE64_BYTES before this request is ever built.
   */
  attachment?: { mimeType: string; base64Data: string };
}

export interface ProviderAdapter {
  id: ProviderId;
  isConfigured(): boolean;      // true for mock always; true for real providers iff their key env var is set
  generateText(req: GenerateTextRequest): Promise<GenerateTextResult>;
  generateJson(req: GenerateJsonRequest): Promise<GenerateTextResult>;
}

/**
 * Batch 8 (closing review B5) — WHETHER THIS PROVIDER MAY BE THE APP'S DEFAULT.
 *
 * 'real'     a provider that talks to a vendor. Eligible to be the default whenever its key is set.
 * 'fallback' a provider that exists only so the app runs with NO keys at all. It is always
 *            `isConfigured()`, so without this distinction it wins every default by simply being
 *            listed first — which is exactly what B5 found: the mock intercepted the unattended
 *            whole-folder import in every environment, keys or no keys.
 *
 * REQUIRED, not optional, and deliberately so: an optional flag defaulting to 'real' would let a
 * fifth provider inherit a default-ordering decision nobody made, which is the same hazard
 * getAdapterForModel's required `action` argument exists to prevent. A `tier` also keeps the rule
 * off `adapter.id === 'mock'` — a magic id in a sort is a second place the fact lives.
 */
export type ProviderTier = 'real' | 'fallback';

export interface ProviderRegistryEntry {
  adapter: ProviderAdapter;
  models: AiModelInfo[];
  tier: ProviderTier;
}
