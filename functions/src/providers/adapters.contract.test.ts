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

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = {
      create: vi.fn(async (req: { messages: Array<{ role: string; content: string }> }) => {
        const lastText = req.messages[req.messages.length - 1]?.content ?? '';
        const wantsJson = /JSON/i.test(lastText);
        return {
          content: [{ type: 'text', text: wantsJson ? '{"ok":true}' : 'תשובת דמה מ-Anthropic' }],
          usage: { input_tokens: 12, output_tokens: 7 },
        };
      }),
    };
  }
  return { default: Anthropic };
});

vi.mock('openai', () => {
  class OpenAI {
    chat = {
      completions: {
        create: vi.fn(async (req: { response_format?: { type: string } }) => ({
          choices: [{
            message: {
              content: req.response_format?.type === 'json_object' ? '{"ok":true}' : 'תשובת דמה מ-OpenAI',
            },
          }],
          usage: { prompt_tokens: 11, completion_tokens: 6 },
        })),
      },
    };
  }
  return { default: OpenAI };
});

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    models = {
      generateContent: vi.fn(async (req: { config?: { responseMimeType?: string } }) => ({
        text: req.config?.responseMimeType === 'application/json' ? '{"ok":true}' : 'תשובת דמה מ-Google',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      })),
    };
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
