// Stage 6 Task 8 review F4 — THE DATA-EGRESS DISCLOSURE, in ONE place.
//
// Spec §14 item 6 requires the family be told that AI calls leave for the chosen model provider.
// The copy was accurate and plain — but it lived in exactly one file, AiSettingsScreen.tsx, which
// is super-admin-only. Parents and children use the Dashboard chat, their financial questions
// egress to a third party, and nobody ever told them. The disclosure now lives here, next to the
// provider labels it names, and is rendered where the egress actually happens (the chat surface,
// for every role) as well as on the settings screen.
//
// Dependency-free on purpose — the same reason src/config/aiCeiling.ts is: AiSettingsScreen's and
// Dashboard's test suites both mock ../services/aiClient (and therefore firebase/functions)
// wholesale, so any constant that has to be SHARED with those tests cannot sit behind that import
// or it would have to be re-typed as a literal inside a mock factory, i.e. not actually shared.

/**
 * Human-readable provider names. The user picks a MODEL in the switcher; the disclosure has to
 * name the COMPANY the question is sent to, which is a different string.
 */
export const AI_PROVIDER_LABELS_HE: Record<string, string> = {
  mock: 'מודל דמה (ללא מפתח)',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
};

/** Falls back to the raw id rather than hiding an unlabelled provider behind a blank. */
export function providerLabelHe(providerId: string | null | undefined): string | null {
  if (!providerId) return null;
  return AI_PROVIDER_LABELS_HE[providerId] ?? providerId;
}

/**
 * The settings-screen banner. Wording unchanged from the original Task 8 copy — this is a move,
 * not a rewrite, so the two surfaces cannot drift apart with one of them going quietly stale.
 * It stays on the settings screen deliberately: that screen is where a super-admin turns a
 * provider ON, which is the moment the fact is actionable for them, and it names BOTH egress
 * paths (chat and document extraction) rather than only the one the chat line covers.
 */
export const AI_EGRESS_DISCLOSURE_HE =
  'קריאות ה-AI (צ\'אט וחילוץ מסמכים) נשלחות לספק המודל שנבחר ועוזבות את המחשב שלך — ' +
  'שאר הנתונים הפיננסיים נשארים מקומיים.';

/** Shown before a model has resolved — says the true thing without naming a provider it can't yet know. */
export const AI_CHAT_EGRESS_UNKNOWN_PROVIDER_HE =
  'השאלות שלך נשלחות לספק המודל שנבחר ועוזבות את המחשב שלך.';

/**
 * The mock adapter runs inside our own Cloud Function. Telling a family that a mock question is
 * "sent to מודל דמה (ללא מפתח)" would be a disclosure that states a falsehood — the same class of
 * defect F4 itself is. It gets its own honest line, mirroring the D10 mock badge's intent.
 */
export const AI_CHAT_NO_EGRESS_MOCK_HE =
  'המודל הנבחר הוא מודל דמה — השאלות שלך לא נשלחות לספק AI חיצוני.';

/**
 * One quiet line for the chat surface, naming the provider the CURRENTLY SELECTED model belongs
 * to, so the disclosure and the model switcher tell one coherent story: change the model, the
 * named recipient changes with it.
 */
export function aiChatEgressNoticeHe(providerId: string | null | undefined): string {
  if (providerId === 'mock') return AI_CHAT_NO_EGRESS_MOCK_HE;
  const label = providerLabelHe(providerId);
  if (label === null) return AI_CHAT_EGRESS_UNKNOWN_PROVIDER_HE;
  return `השאלות שלך נשלחות ל-${label} ועוזבות את המחשב שלך.`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Batch 3 — THE SAME HOLE ON THE DOCUMENT-EXTRACTION SURFACES, where the exposure is larger.
//
// FolderLogic, SyncButton, AssetCard and InvestmentsImportModal each mount a ModelPicker and send
// real bank statements, credit-card files and PDFs to a third-party provider. Batch 2 closed the
// chat surface and left these four open at every role.
//
// The extraction copy is a SIBLING of the chat copy, not a reuse of it, for one substantive
// reason: on chat, what egresses is a QUESTION the user typed. Here what egresses is THE DOCUMENT
// ITSELF — the whole file, every line of the statement, not a summary or a question about it.
// That is the fact a family needs at the moment they pick the file, and it is the reason a shared
// generic "AI calls are sent to the provider" line would under-state what actually happens.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Shown before a model has resolved — true without naming a provider it can't yet know. */
export const AI_EXTRACTION_EGRESS_UNKNOWN_PROVIDER_HE =
  'המסמך עצמו נשלח לספק המודל שנבחר לצורך החילוץ ועוזב את המחשב שלך.';

/**
 * Same trap as the chat line's, and it matters MORE here: the mock adapter runs inside our own
 * Cloud Function, so telling a family their bank statement was "sent to מודל דמה (ללא מפתח)"
 * would be a disclosure that states a falsehood — the exact defect class this disclosure exists
 * to fix. Mock gets its own honest line claiming no egress at all.
 */
export const AI_EXTRACTION_NO_EGRESS_MOCK_HE =
  'המודל הנבחר הוא מודל דמה — המסמך לא נשלח לספק AI חיצוני.';

/**
 * One quiet line for the document-upload surfaces, naming the provider the CURRENTLY SELECTED
 * extraction model belongs to, so the disclosure and the model switcher tell one coherent story:
 * change the model, the named recipient changes with it.
 */
export function aiExtractionEgressNoticeHe(providerId: string | null | undefined): string {
  if (providerId === 'mock') return AI_EXTRACTION_NO_EGRESS_MOCK_HE;
  const label = providerLabelHe(providerId);
  if (label === null) return AI_EXTRACTION_EGRESS_UNKNOWN_PROVIDER_HE;
  return `המסמך עצמו נשלח ל-${label} לצורך החילוץ ועוזב את המחשב שלך.`;
}
