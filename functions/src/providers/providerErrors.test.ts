import { describe, expect, it } from 'vitest';
import { classifyProviderError, toAiHttpsError } from './providerErrors';

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
