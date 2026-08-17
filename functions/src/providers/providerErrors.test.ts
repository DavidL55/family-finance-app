import { describe, expect, it } from 'vitest';
import { classifyProviderError, toAiHttpsError } from './providerErrors';
import {
  APIConnectionTimeoutError as AnthropicTimeoutError,
  AuthenticationError as AnthropicAuthenticationError,
  PermissionDeniedError as AnthropicPermissionDeniedError,
} from '@anthropic-ai/sdk';
import {
  APIConnectionTimeoutError as OpenAITimeoutError,
  AuthenticationError as OpenAIAuthenticationError,
  PermissionDeniedError as OpenAIPermissionDeniedError,
} from 'openai';
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BATCH 6 — A PROVIDER AUTH FAILURE WAS UNCLASSIFIED, AND IT IS THE MOST LIKELY FAILURE THE DAY
// THE FIRST REAL KEY IS PROVISIONED.
//
// Same technique the timeout block above uses, for the same reason: the vendors' own installed
// error classes are constructed here, with no API key and no network call, so these assertions
// are facts about what the SDKs in functions/node_modules actually throw rather than guesses about
// their wording. All THREE vendors are covered, not only the one the reviewer probed.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('classifyProviderError — a bad/expired/missing provider key (batch 6)', () => {
  const headers = new Headers();

  it("documents the finding: Anthropic's AuthenticationError has name 'Error', so no substring check could ever have caught it", () => {
    const err = new AnthropicAuthenticationError(401, { error: { message: 'invalid x-api-key' } }, 'invalid x-api-key', headers);
    expect(err.name).toBe('Error'); // Stainless-generated, exactly like the timeout class above
    expect(err.status).toBe(401);
  });

  it('classifies a real Anthropic AuthenticationError as auth-failed (it used to fall through to "unknown")', () => {
    const err = new AnthropicAuthenticationError(401, { error: { message: 'invalid x-api-key' } }, 'invalid x-api-key', headers);
    expect(classifyProviderError(err)).toBe('auth-failed');
  });

  it('classifies a real OpenAI AuthenticationError as auth-failed', () => {
    const err = new OpenAIAuthenticationError(401, { error: { message: 'Incorrect API key provided' } }, 'Incorrect API key provided', headers);
    expect(err.name).toBe('Error');
    expect(classifyProviderError(err)).toBe('auth-failed');
  });

  it("classifies both vendors' PermissionDeniedError (403) too — a key that exists but is not entitled is the same operator problem", () => {
    expect(classifyProviderError(new AnthropicPermissionDeniedError(403, {}, 'permission denied', headers))).toBe('auth-failed');
    expect(classifyProviderError(new OpenAIPermissionDeniedError(403, {}, 'permission denied', headers))).toBe('auth-failed');
  });

  it('classifies Google, which exports NO auth class — its bad-key failure is an ApiError whose status is 400, not 401', () => {
    // The documented Gemini response for a malformed key. Status alone cannot classify it, which
    // is why the message gate exists — and why a bare 400 must NOT be treated as auth.
    const badKey = new GoogleApiError({ message: 'API key not valid. Please pass a valid API key.', status: 400 });
    expect(badKey.status).toBe(400);
    expect(classifyProviderError(badKey)).toBe('auth-failed');
    expect(classifyProviderError(new GoogleApiError({ message: 'API key expired. Please renew the API key.', status: 400 }))).toBe('auth-failed');
    expect(classifyProviderError(new GoogleApiError({ message: 'permission denied', status: 403 }))).toBe('auth-failed');
  });

  it("classifies the adapters' OWN pre-flight 'X_API_KEY not configured' throw — reachable, because getAdapterForModel resolves by model id and never consults isConfigured()", () => {
    expect(classifyProviderError(new Error('ANTHROPIC_API_KEY not configured'))).toBe('auth-failed');
    expect(classifyProviderError(new Error('OPENAI_API_KEY not configured'))).toBe('auth-failed');
    expect(classifyProviderError(new Error('GEMINI_API_KEY not configured'))).toBe('auth-failed');
  });

  it('does NOT swallow neighbouring failure classes — a bare 400, a 429 and a context overflow keep their own classification', () => {
    expect(classifyProviderError(new GoogleApiError({ message: 'Invalid JSON payload received.', status: 400 }))).not.toBe('auth-failed');
    expect(classifyProviderError({ status: 429, message: 'rate limit' })).toBe('rate-limited');
    expect(classifyProviderError({ status: 400, message: 'maximum context length is 200000 tokens' })).toBe('context-overflow');
    // "invalid"/"expired" WITHOUT an api-key mention must not be captured either.
    expect(classifyProviderError({ status: 400, message: 'invalid request body' })).not.toBe('auth-failed');
  });
});

describe('toAiHttpsError — an auth failure tells a super-admin what to fix and does not dead-end anyone else (batch 6)', () => {
  const badKey = () => new AnthropicAuthenticationError(401, {}, 'invalid x-api-key', new Headers());

  it("is no longer the generic 'unexpected failure, contact support' the closing review found", () => {
    const generic = toAiHttpsError(new Error('totally unexpected'), 'chat', 'super-admin') as { message: string };
    const auth = toAiHttpsError(badKey(), 'chat', 'super-admin') as { code: string; message: string };
    expect(auth.message).not.toBe(generic.message);
    expect(auth.message).not.toMatch(/מסיבה לא צפויה/);
    // 'failed-precondition', not 'permission-denied' (the CALLER's permissions are fine, and
    // saying otherwise sends them looking in the wrong place) and not 'internal' (which is what
    // onCall's redaction produces — the thing this module exists to prevent).
    expect(auth.code).toBe('failed-precondition');
  });

  it('the super-admin copy names the key, the env vars and the redeploy — the actions only he can take', () => {
    const msg = (toAiHttpsError(badKey(), 'chat', 'super-admin') as { message: string }).message;
    expect(msg).toMatch(/מפתח/);
    expect(msg).toMatch(/ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY/);
    expect(msg).toMatch(/פרוס מחדש|סביבת הפונקציות/);
  });

  it('a parent and a member are told it is not their request and who can fix it — never "contact support", who is the super-admin himself', () => {
    for (const role of ['parent', 'member'] as const) {
      const msg = (toAiHttpsError(badKey(), 'chat', role) as { message: string }).message;
      expect(msg).toMatch(/סופר-אדמין/);
      expect(msg).not.toMatch(/פנה לתמיכה/);
      // And no instruction a non-super-admin could not carry out.
      expect(msg).not.toMatch(/פרוס מחדש|ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY/);
    }
  });

  it('the two audiences genuinely get different copy — the role parameter is load-bearing, not decorative', () => {
    const admin = (toAiHttpsError(badKey(), 'chat', 'super-admin') as { message: string }).message;
    const member = (toAiHttpsError(badKey(), 'chat', 'member') as { message: string }).message;
    expect(admin).not.toBe(member);
  });

  it('an unknown/absent role still gets real Hebrew copy — never undefined, never the generic unknown-failure string', () => {
    const msg = (toAiHttpsError(badKey(), 'chat', undefined) as { message: string }).message;
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).toMatch(/מפתח/);
    expect(msg).not.toMatch(/מסיבה לא צפויה/);
  });

  it('role affects ONLY the auth copy — every other failure class stays one shared message', () => {
    const asAdmin = (toAiHttpsError({ status: 429 }, 'chat', 'super-admin') as { message: string }).message;
    const asMember = (toAiHttpsError({ status: 429 }, 'chat', 'member') as { message: string }).message;
    expect(asAdmin).toBe(asMember);
  });
});

describe('toAiHttpsError — never a plain Error, always Hebrew, actionable copy per failure class', () => {
  it('maps rate-limited to resource-exhausted with retry-later Hebrew copy', () => {
    const httpsErr = toAiHttpsError({ status: 429 }, 'chat', 'member') as { code: string; message: string };
    expect(httpsErr.code).toBe('resource-exhausted');
    expect(httpsErr.message).toMatch(/עומס|נסה שוב/);
  });
  it('maps timeout to deadline-exceeded', () => {
    const httpsErr = toAiHttpsError({ name: 'AbortError' }, 'extraction', 'member') as { code: string };
    expect(httpsErr.code).toBe('deadline-exceeded');
  });
  it('maps context-overflow to invalid-argument, mentioning the document/conversation is too large', () => {
    const httpsErr = toAiHttpsError({ status: 400, message: 'maximum context length' }, 'extraction', 'member') as { code: string; message: string };
    expect(httpsErr.code).toBe('invalid-argument');
    expect(httpsErr.message).toMatch(/גדול מדי|ארוך מדי/);
  });
  it('maps a decommissioned/unknown model to invalid-argument with copy distinguishable from context-overflow', () => {
    const httpsErr = toAiHttpsError({ status: 404, message: 'model not found' }, 'chat', 'member') as { code: string; message: string };
    expect(httpsErr.code).toBe('invalid-argument');
    expect(httpsErr.message).not.toMatch(/גדול מדי|ארוך מדי/);
  });
  it('maps a non-JSON generateJson response to invalid-argument with clear Hebrew copy, distinguishable from context-overflow', () => {
    const httpsErr = toAiHttpsError(new SyntaxError('Unexpected token in JSON'), 'extraction', 'member') as { code: string; message: string };
    expect(httpsErr.code).toBe('invalid-argument');
    expect(httpsErr.message).not.toMatch(/גדול מדי|ארוך מדי/);
  });
  it('never lets an unrecognized error escape as a plain Error — always returns an HttpsError-shaped object with a code', () => {
    const httpsErr = toAiHttpsError(new Error('totally unexpected'), 'chat', 'member') as { code: string };
    expect(typeof httpsErr.code).toBe('string');
    expect(httpsErr.code).toBe('internal');
  });
  it('is a real HttpsError instance, not a plain object duck-typed to look like one', async () => {
    const { HttpsError } = await import('firebase-functions/v2/https');
    expect(toAiHttpsError(new Error('x'), 'chat', 'member')).toBeInstanceOf(HttpsError);
  });
});
