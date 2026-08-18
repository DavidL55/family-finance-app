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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BATCH 9 (closing review I1) — THE BANNER MADE A CLAIM THE CODE CONTRADICTED.
//
// The sentence this block replaces ended "— שאר הנתונים הפיננסיים נשארים מקומיים" ("the rest of
// your financial data stays local"). It never was true: aiChat.ts JSON.stringifies the whole
// FinancialContext into its system prompt on EVERY turn, so two real money figures and the
// resolved screen filter leave the house with every question; and aiExtractDocument.ts
// interpolates the family's real member NAMES into the extraction prompt, which no notice
// mentioned at all. Until batch 8 the sentence was false about a path nothing travelled, because
// listConfiguredModels()[0] was always the mock. Batch 8's tier ordering made real egress the
// DEFAULT, so the false sentence became a live one.
//
// The copy below was written by READING the payload, not by softening the old claim: every line
// names something buildFinancialContext.ts actually returns or buildExtractionPrompt.ts actually
// interpolates. The negative line at the end is the honest replacement for "stays local" — it is
// scoped to chat, because in extraction the individual transactions DO leave (they are in the
// file), and it lists only things FinancialContext genuinely has no field for.
//
// AND IT IS PINNED TO THE PAYLOAD, which is as much the deliverable as the wording:
// EGRESS_DISCLOSURE below maps every field of FinancialContext (and every interpolation in the
// extraction prompt) to the phrase that discloses it, and
// src/__tests__/aiEgressDisclosure.payload.test.ts reads BOTH out of functions/src at test time.
// Adding a field to FinancialContext now fails a test instead of silently widening what leaves
// while this file goes quietly stale — which is exactly how the old sentence survived a whole
// stage of reviews.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The settings-screen banner's opening sentence — the fact, before the detail.
 *
 * It stays on the settings screen deliberately: that screen is where a super-admin turns a
 * provider ON, which is the moment the fact is actionable for them, and it names BOTH egress
 * paths (chat and document extraction) rather than only the one the chat line covers.
 */
export const AI_EGRESS_DISCLOSURE_HEADLINE_HE =
  'קריאות ה-AI (צ\'אט וחילוץ מסמכים) עוזבות את המחשב שלך ונשלחות לספק המודל שנבחר.';

/**
 * What actually travels, one short fact per line — a list rather than a paragraph because a
 * person has to be able to find the line that concerns them, and because each sentence then
 * stays inside src/utils/plainLanguage.ts's readability bar on its own.
 */
export const AI_EGRESS_DISCLOSURE_DETAILS_HE: readonly string[] = [
  'בצ\'אט נשלחים: השאלה שלך והתשובות הקודמות באותה שיחה.',
  'בצ\'אט נשלח גם סיכום חודשי: סך ההוצאות הקבועות וסך ההכנסות הקבועות.',
  'בצ\'אט נשלחים גם החודש שנבחר במסך ומי מבני המשפחה סומן בסינון.',
  'בצ\'אט נשלח גם אם התשובה מבוססת על נתוני כל המשפחה או רק על שלך.',
  'בחילוץ מסמכים נשלח המסמך עצמו על כל שורותיו, ויחד איתו שמות בני המשפחה.',
  'בצ\'אט לא נשלח פירוט של עסקאות בודדות, ולא יתרות חשבונות, הלוואות והשקעות.',
];

/**
 * The whole banner as one string. This is the corpus the payload guard searches, so a phrase
 * counts as disclosed only if it is on a line the screen genuinely renders.
 */
export const AI_EGRESS_DISCLOSURE_ALL_HE = [
  AI_EGRESS_DISCLOSURE_HEADLINE_HE,
  ...AI_EGRESS_DISCLOSURE_DETAILS_HE,
].join(' ');

/** Shown before a model has resolved — says the true thing without naming a provider it can't yet know. */
export const AI_CHAT_EGRESS_UNKNOWN_PROVIDER_HE =
  'השאלות שלך נשלחות לספק המודל שנבחר ועוזבות את המחשב שלך. ' +
  'נשלחים איתן סך ההוצאות וההכנסות הקבועות החודשיות, והסינון שבחרת במסך.';

/**
 * The mock adapter runs inside our own Cloud Function. Telling a family that a mock question is
 * "sent to מודל דמה (ללא מפתח)" would be a disclosure that states a falsehood — the same class of
 * defect F4 itself is. It gets its own honest line, mirroring the D10 mock badge's intent.
 */
export const AI_CHAT_NO_EGRESS_MOCK_HE =
  'המודל הנבחר הוא מודל דמה — השאלות שלך והנתונים הפיננסיים שלך לא נשלחים לספק AI חיצוני.';

/**
 * One quiet line for the chat surface, naming the provider the CURRENTLY SELECTED model belongs
 * to, so the disclosure and the model switcher tell one coherent story: change the model, the
 * named recipient changes with it.
 *
 * Batch 9 — the second sentence is new, and it is the point: this line used to say only that the
 * user's QUESTIONS were sent, while the handler was also shipping two money totals and the
 * resolved screen filter with every turn. A family member reading it was told strictly less than
 * what left.
 */
export function aiChatEgressNoticeHe(providerId: string | null | undefined): string {
  if (providerId === 'mock') return AI_CHAT_NO_EGRESS_MOCK_HE;
  const label = providerLabelHe(providerId);
  if (label === null) return AI_CHAT_EGRESS_UNKNOWN_PROVIDER_HE;
  return (
    `השאלות שלך נשלחות ל-${label} ועוזבות את המחשב שלך. ` +
    'נשלחים איתן סך ההוצאות וההכנסות הקבועות החודשיות, והסינון שבחרת במסך.'
  );
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

/**
 * Batch 9 — the second sentence is new. buildExtractionPrompt interpolates the family's real
 * member NAMES into the prompt (so the model can match a cardholder name to a person), and no
 * notice on any surface said so. It is a smaller fact than the document itself, but it is a fact
 * about people, and the whole point of this disclosure is that it lists what leaves.
 */
const EXTRACTION_MEMBER_NAMES_SENTENCE_HE = 'נשלחים איתו גם שמות בני המשפחה.';

/** Shown before a model has resolved — true without naming a provider it can't yet know. */
export const AI_EXTRACTION_EGRESS_UNKNOWN_PROVIDER_HE =
  'המסמך עצמו נשלח לספק המודל שנבחר לצורך החילוץ ועוזב את המחשב שלך. ' +
  EXTRACTION_MEMBER_NAMES_SENTENCE_HE;

/**
 * Same trap as the chat line's, and it matters MORE here: the mock adapter runs inside our own
 * Cloud Function, so telling a family their bank statement was "sent to מודל דמה (ללא מפתח)"
 * would be a disclosure that states a falsehood — the exact defect class this disclosure exists
 * to fix. Mock gets its own honest line claiming no egress at all.
 */
export const AI_EXTRACTION_NO_EGRESS_MOCK_HE =
  'המודל הנבחר הוא מודל דמה — המסמך ושמות בני המשפחה לא נשלחים לספק AI חיצוני.';

/**
 * One quiet line for the document-upload surfaces, naming the provider the CURRENTLY SELECTED
 * extraction model belongs to, so the disclosure and the model switcher tell one coherent story:
 * change the model, the named recipient changes with it.
 */
export function aiExtractionEgressNoticeHe(providerId: string | null | undefined): string {
  if (providerId === 'mock') return AI_EXTRACTION_NO_EGRESS_MOCK_HE;
  const label = providerLabelHe(providerId);
  if (label === null) return AI_EXTRACTION_EGRESS_UNKNOWN_PROVIDER_HE;
  return (
    `המסמך עצמו נשלח ל-${label} לצורך החילוץ ועוזב את המחשב שלך. ` +
    EXTRACTION_MEMBER_NAMES_SENTENCE_HE
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE PIN. Copy is only true on the day it is written; this is what keeps it true afterwards.
//
// Every field of functions/src/context/types.ts's FinancialContext — the object aiChat.ts
// JSON.stringifies wholesale into its system prompt — and every `${…}` interpolation in
// aiExtractDocument.ts's buildExtractionPrompt has to be accounted for below. The guard in
// src/__tests__/aiEgressDisclosure.payload.test.ts reads both out of functions/src at test time
// and fails on ANY difference in either direction: a field with no entry here, an entry naming a
// field that no longer exists, or a 'sent' entry whose phrase is not actually on a rendered line.
//
// A STRING status, not a boolean flag or an optional phrase: the root tsconfig does not enable
// `strict`, so boolean-discriminated unions do not narrow in src/ (recorded trap), and an
// optional field would let a future author silently add a payload field with no disclosure and no
// stated reason. Every entry must say something.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type EgressFieldDisclosure =
  /** Its value reaches the provider, and these phrases in the rendered copy say so. */
  | { status: 'sent'; phrasesHe: readonly string[] }
  /**
   * The field exists in the type but is never given a value, so nothing about it leaves.
   * `whyHe` is not decoration — the guard also checks the producer really does assign a literal
   * null, so this status cannot be used to wave a live field through.
   */
  | { status: 'never-populated'; whyHe: string }
  /**
   * Reaches the provider but says nothing about this family — our own static instructions.
   * Disclosing it would be noise, and noise in a disclosure is how the real facts get skipped.
   */
  | { status: 'not-family-data'; whyHe: string };

/**
 * FinancialContext (functions/src/context/types.ts), field by field. Phrases are matched as
 * substrings of AI_EGRESS_DISCLOSURE_ALL_HE, so they must be copied from the lines above rather
 * than paraphrased.
 */
export const FINANCIAL_CONTEXT_EGRESS: Record<string, EgressFieldDisclosure> = {
  scope: {
    status: 'sent',
    phrasesHe: ['התשובה מבוססת על נתוני כל המשפחה'],
  },
  filterScope: {
    // Two axes, two facts: the period the screen is filtered to, and which members were selected.
    status: 'sent',
    phrasesHe: ['החודש שנבחר במסך', 'מי מבני המשפחה סומן בסינון'],
  },
  totalMonthlyExpense: { status: 'sent', phrasesHe: ['סך ההוצאות הקבועות'] },
  totalMonthlyIncome: { status: 'sent', phrasesHe: ['סך ההכנסות הקבועות'] },
  netWorth: {
    status: 'never-populated',
    whyHe:
      'buildFinancialContext מחזיר netWorth: null בשלב הזה — אין חישוב שווי נקי בצד השרת, ולכן ' +
      'שום נתון על יתרות, הלוואות או השקעות לא נשלח בצ\'אט.',
  },
};

/**
 * The `${…}` expressions inside buildExtractionPrompt's template literal — i.e. everything that
 * gets interpolated into the text that travels with the document.
 */
export const EXTRACTION_PROMPT_EGRESS: Record<string, EgressFieldDisclosure> = {
  membersJson: { status: 'sent', phrasesHe: ['שמות בני המשפחה'] },
  "ALLOWED_CATEGORIES.join(', ')": {
    status: 'not-family-data',
    whyHe: 'רשימת הקטגוריות הקבועה של האפליקציה — טקסט שלנו, לא נתון של המשפחה.',
  },
};
