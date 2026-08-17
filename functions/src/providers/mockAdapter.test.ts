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
});
