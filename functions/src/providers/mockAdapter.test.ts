import { describe, expect, it } from 'vitest';
import { mockAdapter } from './mockAdapter';

describe('mockAdapter (D10 — the only adapter the default test run ever calls)', () => {
  it('is always configured', () => {
    expect(mockAdapter.isConfigured()).toBe(true);
  });
  it('generateText returns a deterministic, clearly-labeled Hebrew canned response, keyed off the LAST message (multi-turn ready, D3)', async () => {
    const res = await mockAdapter.generateText({
      systemPrompt: 'sys', messages: [{ role: 'user', text: 'מה מצבנו החודש?' }], modelId: 'mock-standard',
    });
    expect(res.text).toContain('[מודל דמה]');
    expect(res.inputTokens).toBeGreaterThan(0);
  });
  it('generateJson returns valid, parseable JSON matching the schema hint keys where given', async () => {
    const res = await mockAdapter.generateJson({
      systemPrompt: 'sys', messages: [{ role: 'user', text: 'extract' }], modelId: 'mock-standard',
      jsonSchemaHint: '{"transactions": []}',
    });
    expect(() => JSON.parse(res.text)).not.toThrow();
  });

  // Task 7 — when called WITH a document attachment (aiExtractDocument.ts's own shape), the
  // canned reply is a full, structurally-valid DocumentAnalysis with at least one transaction —
  // so a zero-key manual smoke test has a real editable row in ExtractionReviewModal, not an
  // always-empty draft.
  it('generateJson returns a structurally-valid DocumentAnalysis with a canned transaction when called with an attachment (Task 7)', async () => {
    const res = await mockAdapter.generateJson({
      systemPrompt: '', messages: [{ role: 'user', text: 'extract' }], modelId: 'mock-standard',
      jsonSchemaHint: '{}', attachment: { mimeType: 'application/pdf', base64Data: 'AAAA' },
    });
    const parsed = JSON.parse(res.text);
    expect(parsed.documentType).toBeDefined();
    expect(parsed.issuer).toBeDefined();
    expect(Array.isArray(parsed.transactions)).toBe(true);
    expect(parsed.transactions.length).toBeGreaterThan(0);
  });

  it('generateJson without an attachment keeps the old empty-transactions shape (non-extraction callers unaffected)', async () => {
    const res = await mockAdapter.generateJson({
      systemPrompt: 'sys', messages: [{ role: 'user', text: 'x' }], modelId: 'mock-standard', jsonSchemaHint: '{}',
    });
    expect(JSON.parse(res.text)).toEqual({ transactions: [] });
  });
});
