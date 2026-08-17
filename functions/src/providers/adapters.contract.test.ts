import { describe, expect, it, vi } from 'vitest';
import { PROVIDER_REGISTRY } from './registry';
import { anthropicAdapter } from './anthropicAdapter';
import { openaiAdapter } from './openaiAdapter';
import { googleAdapter } from './googleAdapter';

// Real SDKs mocked at the module boundary — no live network call in this file, ever (D10). Each
// mock returns a fixed, SDK-shaped response so the ADAPTER's own mapping logic is what's under
// test, not the vendor's SDK.

// Dummy, non-real key values so each adapter's own `if (!apiKey) throw` guard doesn't fire before
// the (mocked) SDK is ever constructed — the SDK itself is mocked above, so no real credential is
// used for anything. The 'isConfigured reflects env var' tests below explicitly delete/restore
// these per-test to exercise the true/false boundary.
process.env.ANTHROPIC_API_KEY ||= 'test-key';
process.env.OPENAI_API_KEY ||= 'test-key';
process.env.GEMINI_API_KEY ||= 'test-key';

// mock.calls captured at module scope (Task 7's own attachment-wiring tests below need to inspect
// exactly what each mocked SDK received — not just what it returned).
const anthropicCreateMock = vi.fn(async (req: { messages: Array<{ role: string; content: unknown }> }) => {
  const last = req.messages[req.messages.length - 1]?.content;
  const lastText = typeof last === 'string' ? last : JSON.stringify(last);
  const wantsJson = /JSON/i.test(lastText);
  return {
    content: [{ type: 'text', text: wantsJson ? '{"ok":true}' : 'תשובת דמה מ-Anthropic' }],
    usage: { input_tokens: 12, output_tokens: 7 },
  };
});
vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = { create: (...args: unknown[]) => (anthropicCreateMock as (...a: unknown[]) => unknown)(...args) };
  }
  return { default: Anthropic };
});

const openaiCreateMock = vi.fn(async (req: { response_format?: { type: string } }) => ({
  choices: [{
    message: {
      content: req.response_format?.type === 'json_object' ? '{"ok":true}' : 'תשובת דמה מ-OpenAI',
    },
  }],
  usage: { prompt_tokens: 11, completion_tokens: 6 },
}));
vi.mock('openai', () => {
  class OpenAI {
    chat = { completions: { create: (...args: unknown[]) => (openaiCreateMock as (...a: unknown[]) => unknown)(...args) } };
  }
  return { default: OpenAI };
});

const googleGenerateContentMock = vi.fn(async (req: { config?: { responseMimeType?: string } }) => ({
  text: req.config?.responseMimeType === 'application/json' ? '{"ok":true}' : 'תשובת דמה מ-Google',
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
}));
vi.mock('@google/genai', () => {
  class GoogleGenAI {
    models = { generateContent: (...args: unknown[]) => (googleGenerateContentMock as (...a: unknown[]) => unknown)(...args) };
  }
  return { GoogleGenAI, Type: { STRING: 'STRING', ARRAY: 'ARRAY', OBJECT: 'OBJECT' } };
});

// Deduped by adapter id (unconfigured providers still point at mockAdapter as a placeholder-safety
// net) so this genuinely runs once per DISTINCT adapter implementation, never once per registry
// entry — the point of iterating the registry rather than a hand-maintained array (Sun's A1
// finding on the pre-review draft, which hardcoded the array and contradicted its own Done
// Criteria's "adding a provider touches exactly N files" claim).
const ADAPTERS = Array.from(new Map(Object.values(PROVIDER_REGISTRY).map((e) => [e.adapter.id, e.adapter])).values());

describe('provider registry actually contains the three real adapters plus mock (D3 additivity)', () => {
  it('has exactly four distinct adapters registered', () => {
    expect(ADAPTERS.map((a) => a.id).sort()).toEqual(['anthropic', 'google', 'mock', 'openai']);
  });
});

describe.each(ADAPTERS.map((a) => [a.id, a] as const))('%s adapter satisfies the shared ProviderAdapter contract', (_id, adapter) => {
  it('generateText returns a non-empty text and positive token counts', async () => {
    const res = await adapter.generateText({ systemPrompt: 'sys', messages: [{ role: 'user', text: 'שלום' }], modelId: 'x' });
    expect(res.text.length).toBeGreaterThan(0);
    expect(res.inputTokens).toBeGreaterThan(0);
    expect(res.outputTokens).toBeGreaterThan(0);
  });

  it('generateJson returns parseable JSON', async () => {
    const res = await adapter.generateJson({ systemPrompt: 'sys', messages: [{ role: 'user', text: 'x' }], modelId: 'x', jsonSchemaHint: '{}' });
    expect(() => JSON.parse(res.text)).not.toThrow();
  });

  it('handles a multi-turn messages array (D3 — multi-turn-ready interface)', async () => {
    const res = await adapter.generateText({
      systemPrompt: 'sys',
      messages: [
        { role: 'user', text: 'שלום' },
        { role: 'model', text: 'שלום, איך אפשר לעזור?' },
        { role: 'user', text: 'מה המצב הפיננסי שלנו?' },
      ],
      modelId: 'x',
    });
    expect(res.text.length).toBeGreaterThan(0);
  });
});

describe('isConfigured reflects the presence of the relevant env var', () => {
  const ORIGINAL_ENV = { ...process.env };

  it('anthropicAdapter.isConfigured() is false without ANTHROPIC_API_KEY, true with it', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(anthropicAdapter.isConfigured()).toBe(false);
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect(anthropicAdapter.isConfigured()).toBe(true);
    process.env = { ...ORIGINAL_ENV };
  });

  it('openaiAdapter.isConfigured() is false without OPENAI_API_KEY, true with it', () => {
    delete process.env.OPENAI_API_KEY;
    expect(openaiAdapter.isConfigured()).toBe(false);
    process.env.OPENAI_API_KEY = 'test-key';
    expect(openaiAdapter.isConfigured()).toBe(true);
    process.env = { ...ORIGINAL_ENV };
  });

  it('googleAdapter.isConfigured() is false without GEMINI_API_KEY, true with it', () => {
    delete process.env.GEMINI_API_KEY;
    expect(googleAdapter.isConfigured()).toBe(false);
    process.env.GEMINI_API_KEY = 'test-key';
    expect(googleAdapter.isConfigured()).toBe(true);
    process.env = { ...ORIGINAL_ENV };
  });
});

// Task 7 — the real, non-brief-listed change this task's document extraction genuinely needed:
// ProviderAdapter's generateJson gained an optional `attachment` (mimeType + base64Data) so a
// document's binary content can reach a real vision-capable model at all — the brief's own
// Interfaces block never named this (it only showed `messages: [{ role: 'user', text: prompt }]`,
// with nowhere for fileBase64 to go), so this deviation gets its own real test coverage, not just
// a type-check, per each adapter's own concrete SDK shape.
describe('generateJson attachment wiring (Task 7 — document extraction)', () => {
  it('googleAdapter sends the attachment as inlineData alongside the prompt text, in the SAME turn', async () => {
    await googleAdapter.generateJson({
      systemPrompt: 'sys', messages: [{ role: 'user', text: 'extract this' }], modelId: 'gemini-3-flash-preview',
      jsonSchemaHint: '{}', attachment: { mimeType: 'application/pdf', base64Data: 'ZmFrZQ==' },
    });
    const call = googleGenerateContentMock.mock.calls.at(-1)?.[0] as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
    const lastTurnParts = call.contents.at(-1)!.parts;
    expect(lastTurnParts.some((p) => 'inlineData' in p && (p.inlineData as { mimeType: string; data: string }).mimeType === 'application/pdf' && (p.inlineData as { data: string }).data === 'ZmFrZQ==')).toBe(true);
    expect(lastTurnParts.some((p) => 'text' in p)).toBe(true);
  });

  it('googleAdapter with NO attachment sends only text parts (chat/insight callers unaffected)', async () => {
    await googleAdapter.generateJson({
      systemPrompt: 'sys', messages: [{ role: 'user', text: 'no doc here' }], modelId: 'x', jsonSchemaHint: '{}',
    });
    const call = googleGenerateContentMock.mock.calls.at(-1)?.[0] as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
    expect(call.contents.at(-1)!.parts.some((p) => 'inlineData' in p)).toBe(false);
  });

  it('anthropicAdapter sends an image content block for an image mimeType', async () => {
    await anthropicAdapter.generateJson({
      systemPrompt: 'sys', messages: [{ role: 'user', text: 'extract this' }], modelId: 'claude-opus-5',
      jsonSchemaHint: '{}', attachment: { mimeType: 'image/png', base64Data: 'ZmFrZQ==' },
    });
    const call = anthropicCreateMock.mock.calls.at(-1)?.[0] as { messages: Array<{ content: unknown }> };
    const lastContent = call.messages.at(-1)!.content as Array<Record<string, unknown>>;
    expect(lastContent.some((b) => b.type === 'image' && (b.source as { media_type: string }).media_type === 'image/png')).toBe(true);
  });

  it('anthropicAdapter sends a document content block for application/pdf', async () => {
    await anthropicAdapter.generateJson({
      systemPrompt: 'sys', messages: [{ role: 'user', text: 'extract this' }], modelId: 'claude-opus-5',
      jsonSchemaHint: '{}', attachment: { mimeType: 'application/pdf', base64Data: 'ZmFrZQ==' },
    });
    const call = anthropicCreateMock.mock.calls.at(-1)?.[0] as { messages: Array<{ content: unknown }> };
    const lastContent = call.messages.at(-1)!.content as Array<Record<string, unknown>>;
    expect(lastContent.some((b) => b.type === 'document')).toBe(true);
  });

  it('openaiAdapter sends an image_url content block for an image mimeType, as a data URI', async () => {
    await openaiAdapter.generateJson({
      systemPrompt: 'sys', messages: [{ role: 'user', text: 'extract this' }], modelId: 'gpt-5.1',
      jsonSchemaHint: '{}', attachment: { mimeType: 'image/png', base64Data: 'ZmFrZQ==' },
    });
    const call = openaiCreateMock.mock.calls.at(-1)?.[0] as { messages: Array<{ content: unknown }> };
    const lastContent = call.messages.at(-1)!.content as Array<Record<string, unknown>>;
    const imageBlock = lastContent.find((b) => b.type === 'image_url') as { image_url: { url: string } } | undefined;
    expect(imageBlock?.image_url.url).toBe('data:image/png;base64,ZmFrZQ==');
  });

  it('openaiAdapter discloses (rather than silently drops) a PDF attachment it cannot send natively', async () => {
    await openaiAdapter.generateJson({
      systemPrompt: 'sys', messages: [{ role: 'user', text: 'extract this' }], modelId: 'gpt-5.1',
      jsonSchemaHint: '{}', attachment: { mimeType: 'application/pdf', base64Data: 'ZmFrZQ==' },
    });
    const call = openaiCreateMock.mock.calls.at(-1)?.[0] as { messages: Array<{ content: unknown }> };
    const lastContent = call.messages.at(-1)!.content as Array<Record<string, unknown>>;
    expect(lastContent.some((b) => b.type === 'image_url')).toBe(false);
    const textBlock = lastContent.find((b) => b.type === 'text') as { text: string } | undefined;
    expect(textBlock?.text).toMatch(/PDF/);
  });
});
