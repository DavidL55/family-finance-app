import type { ProviderAdapter, GenerateTextResult } from './types';

// Rough, deterministic, provider-agnostic token estimate — chars/4, same heuristic used to
// size the cost gate's illustrative estimates in Task 3. Never billed against; mock is free.
const estimateTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

function cannedText(lastUserText: string): string {
  if (lastUserText.includes('חילוץ') || lastUserText.includes('extract')) {
    return JSON.stringify({ transactions: [] });
  }
  return '[מודל דמה] זו תשובה לדוגמה — אין מפתח API מוגדר לספק אמיתי. ' +
    'הגדר מפתח ב-functions/.env.local כדי לקבל תשובות אמיתיות.';
}

export const mockAdapter: ProviderAdapter = {
  id: 'mock',
  isConfigured: () => true,
  async generateText(req): Promise<GenerateTextResult> {
    const last = req.messages[req.messages.length - 1]?.text ?? '';
    const text = cannedText(last);
    const allText = req.systemPrompt + req.messages.map(m => m.text).join('');
    return { text, inputTokens: estimateTokens(allText), outputTokens: estimateTokens(text) };
  },
  async generateJson(req): Promise<GenerateTextResult> {
    // Always valid JSON, unconditionally — generateJson's whole contract (unlike generateText) is
    // "the caller can JSON.parse the result no matter what the input says." Delegating to
    // generateText's keyword-sniffing cannedText() (as this used to) only produced JSON when the
    // input happened to contain 'חילוץ'/'extract' — every other prompt returned the free-text
    // canned Hebrew reply, silently violating the contract adapters.contract.test.ts (Task 4)
    // now checks against every registered adapter, mock included.
    //
    // Task 7 — when called WITH a document attachment (aiExtractDocument.ts's own shape, D17), the
    // canned reply is a full, structurally-valid DocumentAnalysis (one canned transaction) rather
    // than the empty-array placeholder — so ExtractionReviewModal has a real editable row to show
    // during a zero-key manual smoke test (D10's "mock-first genuinely usable" precedent), not an
    // always-empty draft. Non-extraction generateJson callers (none yet) keep the empty shape.
    const text = req.attachment
      ? JSON.stringify({
          documentType: 'credit_card', issuer: 'מודל דמה', accountId: '0000',
          periodStart: '2026-01-01', periodEnd: '2026-01-31', owner: null,
          totalAmount: 100, currency: 'ILS',
          transactions: [{
            date: '2026-01-15', description: 'עסקת דמה (אין מפתח API מוגדר)', vendor: 'ספק דמה',
            amount: 100, category: 'שונות', paymentType: 'one_time', isCredit: false,
          }],
        })
      : JSON.stringify({ transactions: [] });
    const allText = req.systemPrompt + req.messages.map((m) => m.text).join('');
    return { text, inputTokens: estimateTokens(allText), outputTokens: estimateTokens(text) };
  },
};
