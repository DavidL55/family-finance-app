import { describe, expect, it } from 'vitest';
import { anthropicAdapter } from './anthropicAdapter';
import { openaiAdapter } from './openaiAdapter';
import { googleAdapter } from './googleAdapter';

// D10 — the ONLY key-requiring piece of this stage. Excluded from `npm test`/`test:all` by
// functions/package.json's own `--exclude '**/liveSmoke.manual.test.ts'`; run explicitly via
// `npm run test:ai-live` from the repo root, only after functions/.env.local has real values.
// Each block is skipped, not failed, when its key is absent — so `npx vitest run` (without the
// package.json exclude, e.g. run by hand) still exits green with zero keys configured.

describe.skipIf(!process.env.ANTHROPIC_API_KEY)('anthropic — LIVE', () => {
  it('answers a real prompt', async () => {
    const res = await anthropicAdapter.generateText({
      systemPrompt: 'ענה במילה אחת.',
      messages: [{ role: 'user', text: 'שלום' }],
      modelId: 'claude-sonnet-5',
    });
    expect(res.text.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!process.env.OPENAI_API_KEY)('openai — LIVE', () => {
  it('answers a real prompt', async () => {
    const res = await openaiAdapter.generateText({
      systemPrompt: 'ענה במילה אחת.',
      messages: [{ role: 'user', text: 'שלום' }],
      modelId: 'gpt-5.1',
    });
    expect(res.text.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!process.env.GEMINI_API_KEY)('google — LIVE', () => {
  it('answers a real prompt', async () => {
    const res = await googleAdapter.generateText({
      systemPrompt: 'ענה במילה אחת.',
      messages: [{ role: 'user', text: 'שלום' }],
      modelId: 'gemini-3-flash-preview',
    });
    expect(res.text.length).toBeGreaterThan(0);
  });
});
