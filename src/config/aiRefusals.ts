// Stage 6 review fixes batch 5 — THE COST-GATE REFUSAL COPY, in ONE place.
//
// This map was introduced by the F-H fix (batch 4) inside src/hooks/useAiChat.ts, and the
// reasoning it was introduced with is worth restating because it is what makes the map exist at
// all rather than just echoing the server:
//
//   The server's D4 refusal (functions/src/costGate/types.ts's ApprovalRequiredError) rethrows as
//   'resource-exhausted' with a STRUCTURED `reason` in `details`. Before F-H the client rendered
//   `err.message`, so the three refusals stayed distinguishable ONLY because the server happens
//   to give them different Hebrew strings today. Every client test guarding that distinction
//   hand-wrote the server's copy as a fixture — i.e. asserted that two literals typed inside the
//   test file differ, which cannot detect the server's copy converging. Owning the copy on the
//   client is what makes a distinctness assertion able to fail at all.
//
// WHY IT MOVED HERE. batch 4 closed this on the CHAT surface only. The EXTRACTION surface
// (src/utils/FileProcessor.ts's classifyError) had the identical shape — structured `reason` used
// correctly for the retry decision, server prose rendered for the message — and bringing it in
// line meant a second consumer. FileProcessor cannot import useAiChat: that is a React hook
// pulling in useGlobalFilters, useAiModels and aiClient, and FileProcessor is a plain util
// imported by components, services and scripts alike.
//
// Copying the map into FileProcessor was the other option and it is the wrong one — "duplicating
// that map is how the F4 class starts" is this project's own recorded lesson, and the failure
// mode is concrete here: one copy goes stale and the SAME server decision gets explained two
// different ways depending on whether the user was uploading a document or asking a question.
//
// Dependency-free, the same reason src/config/aiDisclosure.ts and src/config/aiCeiling.ts are:
// consumers' test suites mock ../services/aiClient (and therefore firebase/functions) wholesale,
// so any constant that must be SHARED with those tests cannot sit behind that import.

/**
 * The client's own canonical copy for each cost-gate refusal reason, keyed off D4's structured
 * `ApprovalRefusalReason` rather than the server's prose.
 *
 * All three server strings are static (ApprovalRequiredError's constructor interpolates no
 * figures), so nothing dynamic is dropped by owning them here.
 *
 * DELIBERATELY ABSENT: 'unknown-model'. It is a registry/config bug rather than a spend decision,
 * and the specifics live server-side, so both consumers let it fall through to `err.message`.
 * Batch 5 gave it its own actionable server copy — it used to share over-ceiling's string — and
 * rendering that verbatim is precisely what carries the new message to the user. Adding it here
 * would swallow it again.
 */
export const AI_REFUSAL_MESSAGES_HE: Record<string, string> = {
  'ceiling-unconfigured':
    'תקרת ה-AI החודשית טרם הוגדרה במערכת — יש להגדיר אותה לפני ביצוע קריאות AI בתשלום (לא ניתן לאשר חריגה מתקרה שלא קיימת)',
  'ceiling-invalid':
    'הערך השמור של תקרת ה-AI החודשית אינו תקין — קריאות AI בתשלום חסומות עד שסופר-אדמין ישמור תקרה תקינה מחדש במסך הגדרות ה-AI',
  'over-ceiling':
    'חריגה מתקרת ה-AI החודשית — נדרש אישור מפורש של סופר-אדמין',
};

/**
 * Resolves the client-owned copy for a refusal, or null when the reason is one this map
 * deliberately does not own (or is not a refusal at all) and the caller should fall back to the
 * server's own message.
 *
 * Returns null rather than a boolean-guarded lookup because the root tsconfig is NOT strict: an
 * `in` check followed by an index would not narrow away undefined, and a caller could ship an
 * `undefined` straight into a user-facing string.
 */
export function refusalMessageHe(reason: unknown): string | null {
  if (typeof reason !== 'string') return null;
  return AI_REFUSAL_MESSAGES_HE[reason] ?? null;
}
