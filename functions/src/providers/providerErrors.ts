import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';

// Third-lens M2/D14 — every adapter call (aiChat.ts, aiExtractDocument.ts) is wrapped in a
// try/catch that runs the caught error through this mapper before it can reach onCall's default
// handler, which redacts anything that isn't already an HttpsError to a generic 'internal' — the
// same swallowed-error class D4/Sasha I4 already fixed once for cost-gate refusals.

export type ProviderFailureKind =
  | 'rate-limited' | 'timeout' | 'context-overflow' | 'unknown-model' | 'invalid-response' | 'unknown';

export function classifyProviderError(err: unknown): ProviderFailureKind {
  const e = err as { status?: number; code?: string; name?: string; message?: string } | undefined;
  const msg = (e?.message ?? '').toLowerCase();
  if (e?.status === 429) return 'rate-limited';
  if (e?.name === 'AbortError' || e?.code === 'ETIMEDOUT' || msg.includes('timeout')) return 'timeout';
  if (msg.includes('context length') || msg.includes('too many tokens') || msg.includes('maximum context')) return 'context-overflow';
  if (e?.status === 404 || msg.includes('model not found') || msg.includes('decommissioned')) return 'unknown-model';
  if (err instanceof SyntaxError || msg.includes('json')) return 'invalid-response';
  return 'unknown';
}

const COPY_HE: Record<ProviderFailureKind, { code: FunctionsErrorCode; message: string }> = {
  'rate-limited': { code: 'resource-exhausted', message: 'ספק ה-AI עמוס כרגע — נסה שוב בעוד רגע.' },
  'timeout': { code: 'deadline-exceeded', message: 'הבקשה לספק ה-AI ארכה זמן רב מדי — נסה שוב.' },
  'context-overflow': { code: 'invalid-argument', message: 'התוכן שנשלח למודל גדול מדי או ארוך מדי עבור המודל שנבחר — נסה מודל אחר או קצר את הבקשה.' },
  'unknown-model': { code: 'invalid-argument', message: 'המודל שנבחר אינו זמין יותר אצל הספק — בחר מודל אחר בבורר.' },
  'invalid-response': { code: 'invalid-argument', message: 'התקבלה תשובה לא תקינה מהספק — נסה שוב או בחר מודל אחר.' },
  'unknown': { code: 'internal', message: 'קריאה ל-AI נכשלה מסיבה לא צפויה — נסה שוב, ואם זה חוזר על עצמו פנה לתמיכה.' },
};

/** Never throws a plain Error — every adapter-call failure becomes a real HttpsError with
 *  actionable Hebrew copy, so it survives onCall's default redaction of anything else to
 *  'internal' (the same swallowed-error class D4/Sasha I4 already fixed for cost refusals).
 *  `context` is accepted for future per-context copy variance; both callers today share copy. */
export function toAiHttpsError(err: unknown, _context: 'chat' | 'extraction'): HttpsError {
  const kind = classifyProviderError(err);
  const { code, message } = COPY_HE[kind];
  return new HttpsError(code, message);
}
