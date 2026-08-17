import { describe, expect, it } from 'vitest';
import { classifyProviderError, toAiHttpsError } from './providerErrors';
import { APIConnectionTimeoutError as AnthropicTimeoutError } from '@anthropic-ai/sdk';
import { APIConnectionTimeoutError as OpenAITimeoutError } from 'openai';
import { ApiError as GoogleApiError } from '@google/genai';

// Third-lens M2/D14 — the mapper both aiChat.ts and aiExtractDocument.ts wrap every adapter call
// with, so a provider failure reaches the client as an actionable Hebrew HttpsError instead of
// onCall's generic 'internal' redaction (the same swallowed-error class D4/Sasha I4 already fixed
// for cost-gate refusals).

describe('classifyProviderError', () => {
  it('classifies a 429/rate-limit shaped error', () => {
    expect(classifyProviderError({ status: 429 })).toBe('rate-limited');
  });
  it('classifies a timeout/abort shaped error', () => {
    expect(classifyProviderError({ name: 'AbortError' })).toBe('timeout');
    expect(classifyProviderError({ code: 'ETIMEDOUT' })).toBe('timeout');
  });
  it('classifies a context-window/too-many-tokens shaped error', () => {
    expect(classifyProviderError({ status: 400, message: 'maximum context length is 200000 tokens' })).toBe('context-overflow');
  });
  it('classifies a decommissioned/unknown model shaped error', () => {
    expect(classifyProviderError({ status: 404, message: 'model not found' })).toBe('unknown-model');
  });
  it('classifies a non-JSON generateJson response as invalid-response', () => {
    expect(classifyProviderError(new SyntaxError('Unexpected token in JSON'))).toBe('invalid-response');
  });
  it('falls back to unknown for an unrecognized shape rather than throwing', () => {
    expect(classifyProviderError(new Error('something else entirely'))).toBe('unknown');
  });
});

// A reviewer instantiated the real, installed vendor SDK error classes (no API key or network
// call needed — these are plain constructors) and found that a genuine client-side timeout from
// any of the three real SDKs does NOT contain the substring "timeout" anywhere the old
// message.includes('timeout') check could see it, so it fell through to the generic 'unknown'
// classification instead of 'timeout' — a real user-facing regression (wrong Hebrew copy, wrong
// HttpsError code) for the single most common failure mode of a slow LLM call. These tests
// reproduce the reviewer's finding directly against the packages actually installed in
// functions/node_modules, not a hand-rolled stand-in for them.
describe('classifyProviderError — real vendor SDK timeout error classes (no API key required)', () => {
  it('a real Anthropic APIConnectionTimeoutError does not contain "timeout" in its message or name', () => {
    // Documents the reviewer's finding as an assertion, not just a claim: this is exactly the
    // gap that made the substring check miss it.
    const err = new AnthropicTimeoutError();
    expect(err.name).toBe('Error');
    expect(err.message).toBe('Request timed out.');
    expect(err.message.toLowerCase().includes('timeout')).toBe(false);
  });
  it('classifies a real Anthropic APIConnectionTimeoutError as timeout', () => {
    expect(classifyProviderError(new AnthropicTimeoutError())).toBe('timeout');
  });
  it('classifies a real OpenAI APIConnectionTimeoutError as timeout (same Stainless-generated shape as Anthropic)', () => {
    const err = new OpenAITimeoutError();
    expect(err.message.toLowerCase().includes('timeout')).toBe(false);
    expect(classifyProviderError(err)).toBe('timeout');
  });
  it('classifies a real Google GenAI ApiError carrying a 408/504 timeout status as timeout', () => {
    expect(classifyProviderError(new GoogleApiError({ message: 'Deadline exceeded', status: 504 }))).toBe('timeout');
    expect(classifyProviderError(new GoogleApiError({ message: 'Request Timeout', status: 408 }))).toBe('timeout');
  });
  it('still classifies a message-based "timed out" phrasing as timeout (broadened fallback, not just the class check)', () => {
    expect(classifyProviderError({ message: 'the upstream request timed out after 30s' })).toBe('timeout');
  });
});

// The 'json' substring in the invalid-response check is broad enough to catch any vendor error
// that merely mentions the word "json" for an unrelated reason — e.g. OpenAI's own validation
// error when response_format: json_object is requested but the prompt doesn't contain the word
// "json". That's a 400 invalid-argument-shaped request error, not a malformed-response error, and
// giving it the invalid-response Hebrew copy ("received an invalid response from the provider")
// is actively misleading about what actually went wrong.
describe('classifyProviderError — "json" substring is not enough on its own for invalid-response', () => {
  it('does not misclassify a real OpenAI json_object-mode prompt-validation error as invalid-response', () => {
    const err = {
      status: 400,
      message: "'messages' must contain the word 'json' in some form, to use 'response_format' of type 'json_object'.",
    };
    expect(classifyProviderError(err)).not.toBe('invalid-response');
  });
  it('still classifies genuine malformed-JSON response wording as invalid-response', () => {
    expect(classifyProviderError({ message: 'Unexpected token } in JSON at position 42' })).toBe('invalid-response');
    expect(classifyProviderError({ message: 'response is not valid json' })).toBe('invalid-response');
  });
});

describe('toAiHttpsError — never a plain Error, always Hebrew, actionable copy per failure class', () => {
  it('maps rate-limited to resource-exhausted with retry-later Hebrew copy', () => {
    const httpsErr = toAiHttpsError({ status: 429 }, 'chat') as { code: string; message: string };
    expect(httpsErr.code).toBe('resource-exhausted');
    expect(httpsErr.message).toMatch(/עומס|נסה שוב/);
  });
  it('maps timeout to deadline-exceeded', () => {
    const httpsErr = toAiHttpsError({ name: 'AbortError' }, 'extraction') as { code: string };
    expect(httpsErr.code).toBe('deadline-exceeded');
  });
  it('maps context-overflow to invalid-argument, mentioning the document/conversation is too large', () => {
    const httpsErr = toAiHttpsError({ status: 400, message: 'maximum context length' }, 'extraction') as { code: string; message: string };
    expect(httpsErr.code).toBe('invalid-argument');
    expect(httpsErr.message).toMatch(/גדול מדי|ארוך מדי/);
  });
  it('maps a decommissioned/unknown model to invalid-argument with copy distinguishable from context-overflow', () => {
    const httpsErr = toAiHttpsError({ status: 404, message: 'model not found' }, 'chat') as { code: string; message: string };
    expect(httpsErr.code).toBe('invalid-argument');
    expect(httpsErr.message).not.toMatch(/גדול מדי|ארוך מדי/);
  });
  it('maps a non-JSON generateJson response to invalid-argument with clear Hebrew copy, distinguishable from context-overflow', () => {
    const httpsErr = toAiHttpsError(new SyntaxError('Unexpected token in JSON'), 'extraction') as { code: string; message: string };
    expect(httpsErr.code).toBe('invalid-argument');
    expect(httpsErr.message).not.toMatch(/גדול מדי|ארוך מדי/);
  });
  it('never lets an unrecognized error escape as a plain Error — always returns an HttpsError-shaped object with a code', () => {
    const httpsErr = toAiHttpsError(new Error('totally unexpected'), 'chat') as { code: string };
    expect(typeof httpsErr.code).toBe('string');
    expect(httpsErr.code).toBe('internal');
  });
  it('is a real HttpsError instance, not a plain object duck-typed to look like one', async () => {
    const { HttpsError } = await import('firebase-functions/v2/https');
    expect(toAiHttpsError(new Error('x'), 'chat')).toBeInstanceOf(HttpsError);
  });
});
