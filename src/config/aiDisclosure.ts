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
// FINAL CLOSE REVIEW — WHAT THE RECIPIENT DOES WITH IT, WHICH IS A DIFFERENT FACT FROM WHERE IT
// GOES, AND THE ONE THE PRODUCT NEVER SAID.
//
// Everything below the provider labels discloses EGRESS: what leaves, and to whom. The verified
// vendor finding is a fact about what happens AFTER it arrives, and until now it lived in exactly
// one place — functions/.env.local.example, a developer file nobody in this family will ever
// open. The settings screen's Google row said data leaves. It did not say that on an unbilled
// project a human being may read it.
//
// That matters more here than for the other two vendors, because Gemini is the model tagged for
// DOCUMENT EXTRACTION: whole bank statements, on the unattended per-file whole-folder sync.
//
// HOW THE COPY IS SCOPED, and each of these is a requirement, not a style choice:
//   · CONDITIONAL, because the condition is the whole fact. A paid project is genuinely not
//     affected, and copy that ignored that would read as false to anyone who has paid — which is
//     how a true warning gets dismissed along with the rest of the notice.
//   · IT NAMES ITS OWN CHECK DATE. We read this off the vendor's page on a specific day.
//     .env.local.example frames its date as an EXPIRY, not a signature, and product copy must not
//     out-claim the file it was derived from.
//   · IT SAYS THERE IS NO SWITCH, because that is the actionable half: billing status IS the
//     setting, so "turn it off in settings" is advice that does not exist.
//
// ONE HOME, TWO SURFACES. This string is rendered beside the Google provider row on the settings
// screen (super-admin) AND appended to the per-surface notice when the selected model is Google
// (every role). The settings screen alone would have been F4's own shape a third time: the person
// who picks Gemini for a bank statement is usually not the person who configured the key, and
// they have a real action available — pick another model for this document.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Verified against https://ai.google.dev/gemini-api/terms; the check date is in the sentence, and
 * functions/.env.local.example carries the vendor's own wording and the same date. The two are
 * held together by src/__tests__/aiEgressDisclosure.payload.test.ts — the copy may not name a
 * date the developer file no longer claims.
 */
export const AI_GOOGLE_FREE_TIER_DATA_USE_HE =
  // CLOSE VERIFICATION, two copy corrections, both about PRECISION rather than wording:
  //
  //  · פרויקט, not חשבון. The billing unit is the Cloud PROJECT the key sits on — .env.local.example
  //    says so in the vendor's own terms ("putting the key on a billed Cloud project is what moves
  //    it to the paid terms") and the comment above this constant already said project while the
  //    copy said account. The difference is not pedantic: a family whose Google ACCOUNT is paid
  //    but whose API project is not would have read the old sentence as saying they are covered.
  //  · The no-switch fact is its OWN sentence. It used to sit inside the paid-account clause, so
  //    the antecedent of "זה" read as the paid case only — narrower than the global fact intended.
  //    Standing alone, it attaches to the free-tier use described before it, which is what it is
  //    about. Held structurally: the test requires this sentence not to mention billing at all.
  'בפרויקט Google Cloud שאינו בתשלום, גוגל משתמשת בתוכן שנשלח כדי לשפר את המוצרים שלה, ובודקים אנושיים עשויים לקרוא אותו. ' +
  'אין הגדרה נפרדת לכבות את השימוש הזה — מצב החיוב של הפרויקט הוא מה שקובע. ' +
  'בפרויקט בתשלום גוגל אומרת שזה לא קורה (נבדק בדף התנאים של גוגל באוגוסט 2026).';

/**
 * Keyed by provider so the surfaces stay dumb: each asks about the provider it just named and
 * renders whatever comes back. A second vendor growing a caveat needs no new JSX anywhere, and —
 * the reason it is a map rather than an `if` in the screen — there is nowhere for a second copy
 * of this sentence to appear.
 */
const PROVIDER_DATA_USE_HE: Record<string, string> = {
  google: AI_GOOGLE_FREE_TIER_DATA_USE_HE,
};

/** What the named provider does with the data once it has it, or null when there is nothing to add. */
export function providerDataUseCaveatHe(providerId: string | null | undefined): string | null {
  if (!providerId) return null;
  return PROVIDER_DATA_USE_HE[providerId] ?? null;
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
  // CLOSING REVIEW B-i — every phrase below now has to appear on the PER-SURFACE notice too, not
  // only here. This banner is super-admin-only; see EGRESS_PHRASES_MUST_APPEAR_ON_BOTH below.
  'בצ\'אט נשלחות השאלות שלך והתשובות הקודמות באותה שיחה.',
  'בצ\'אט נשלח גם סיכום חודשי: סך ההוצאות הקבועות וסך ההכנסות הקבועות.',
  'בצ\'אט נשלחים גם החודש שנבחר במסך ומי מבני המשפחה סומן בסינון.',
  'בצ\'אט נשלח גם אם אתה רואה נתונים של כל המשפחה, רק שלך, או שאין לך הרשאה.',
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

/**
 * CLOSING REVIEW B-i — THE HONESTY ASYMMETRY, CLOSED.
 *
 * The banner listed FOUR chat facts; this line named three, omitting the model's PRIOR ANSWERS and
 * the family-vs-own SCOPE FLAG. The banner is super-admin-only, so the people not told were
 * exactly the people who cannot see the other copy — F4's own shape, at smaller scale, inside the
 * fix for F4.
 *
 * The tail below is shared by both provider variants and is now the single place the chat facts
 * are written. Every phrase in it is required, by test, to appear on the banner as well — in BOTH
 * directions, so neither surface can be widened or narrowed alone again.
 */
const CHAT_EGRESS_FACTS_HE =
  'נשלחים איתן סך ההוצאות הקבועות וסך ההכנסות הקבועות, החודש שנבחר במסך ומי מבני המשפחה סומן בסינון. ' +
  'נשלח גם אם אתה רואה נתונים של כל המשפחה, רק שלך, או שאין לך הרשאה.';

/** Shown before a model has resolved — says the true thing without naming a provider it can't yet know. */
export const AI_CHAT_EGRESS_UNKNOWN_PROVIDER_HE =
  'השאלות שלך והתשובות הקודמות באותה שיחה נשלחות לספק המודל שנבחר ועוזבות את המחשב שלך. ' +
  CHAT_EGRESS_FACTS_HE;

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
 *
 * Closing review B-i — and it was STILL less: the prior answers and the scope flag were on the
 * super-admin banner only. Both are now here, in CHAT_EGRESS_FACTS_HE, held to the banner by test.
 */
export function aiChatEgressNoticeHe(providerId: string | null | undefined): string {
  if (providerId === 'mock') return AI_CHAT_NO_EGRESS_MOCK_HE;
  const label = providerLabelHe(providerId);
  // The unknown-provider line names no recipient, so there is no recipient to state a data-use
  // fact about — and providerDataUseCaveatHe returns null for a null id anyway.
  if (label === null) return AI_CHAT_EGRESS_UNKNOWN_PROVIDER_HE;
  const dataUse = providerDataUseCaveatHe(providerId);
  return (
    `השאלות שלך והתשובות הקודמות באותה שיחה נשלחות ל-${label} ועוזבות את המחשב שלך. ` +
    CHAT_EGRESS_FACTS_HE +
    (dataUse === null ? '' : ` ${dataUse}`)
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
  // THE PATH THIS SENTENCE EXISTS FOR. Gemini is the default extraction model, and what travels
  // here is the whole bank statement, once per file, on a sync nobody is watching.
  const dataUse = providerDataUseCaveatHe(providerId);
  return (
    `המסמך עצמו נשלח ל-${label} לצורך החילוץ ועוזב את המחשב שלך. ` +
    EXTRACTION_MEMBER_NAMES_SENTENCE_HE +
    (dataUse === null ? '' : ` ${dataUse}`)
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE PIN. Copy is only true on the day it is written; this is what keeps it true afterwards.
//
// Every LEAF of functions/src/context/types.ts's FinancialContext — the object aiChat.ts
// JSON.stringifies wholesale into its system prompt — and every dynamic value that reaches either
// adapter call has to be accounted for below. The guard in
// src/__tests__/aiEgressDisclosure.payload.test.ts reads all of it out of functions/src at test
// time and fails on ANY difference in either direction: a value with no entry here, an entry
// naming something that no longer leaves, or a 'sent' entry whose phrase is missing from a
// rendered line.
//
// A STRING status, not a boolean flag or an optional phrase: the root tsconfig does not enable
// `strict`, so boolean-discriminated unions do not narrow in src/ (recorded trap), and an
// optional field would let a future author silently add a payload field with no disclosure and no
// stated reason. Every entry must say something.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CLOSING REVIEW B-i — THE PIN WAS A WHITELIST OVER ONE OBJECT'S TOP LEVEL AND ONE TEMPLATE'S
// SPANS, AND FOUR THINGS WALKED PAST IT WITH ALL 1620 TESTS GREEN.
//
// The copy itself was true and complete. This is a MECHANISM failure — but Stage 8's insight
// engine is the change that exercises these gaps first, so it is fixed now rather than inherited:
//
//   1. NESTED TYPES. `filterScope` had ONE entry, so a `categoryIds` added to AiFilterScope rode
//      inside the same JSON.stringify(ctx) undisclosed. The keys below are now LEAF PATHS, walked
//      transitively — every one names something that carries a value.
//   2. CONCATENATION. The extraction map was keyed on `${}` spans, under a test title claiming it
//      accounted for EVERY interpolation, so a `+ JSON.stringify([account numbers])` was invisible.
//      The payload is now derived from the WHOLE expression that reaches the adapter.
//   3. A SECOND SERVER READ. `wrapExternalData(JSON.stringify(ctx)) + '\nיתרות חשבונות: ' + …`
//      passed — sending the exact thing the negative line below promises does not leave. The
//      decomposition walks `+` and records both sides.
//   4. BANNER-ONLY DISCLOSURE. A phrase on the super-admin banner alone satisfied the guard, so a
//      new field could be disclosed to the one role that already knows. Every 'sent' phrase must
//      now appear on the banner AND on the per-surface notice for its own surface.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** One reason, three leaves — netWorth ships as a whole null, so all of it is unpopulated together. */
const NET_WORTH_NEVER_POPULATED_HE =
  'buildFinancialContext מחזיר netWorth: null בשלב הזה — אין חישוב שווי נקי בצד השרת, ולכן ' +
  'שום נתון על יתרות, הלוואות או השקעות לא נשלח בצ\'אט.';

export type EgressFieldDisclosure =
  /**
   * Its value reaches the provider, and these phrases say so — on the banner AND on the
   * per-surface notice. Both, since closing review B-i: the banner is super-admin-only, so a
   * phrase that appears only there is a disclosure the affected people never read.
   */
  | { status: 'sent'; phrasesHe: readonly string[] }
  /**
   * The field exists in the type but is never given a value, so nothing about it leaves.
   *
   * FINAL CLOSE REVIEW B-1 — `whyHe` was never the floor, and the floor that existed checked the
   * wrong thing. The guard searched the whole builder for `<field>: null`, and
   * buildFinancialContext has TWO returns: the reviewer populated the field in the one that runs
   * and wrote the null in the `scope === 'none'` early exit. Green, with a real bank account
   * number on the wire.
   *
   * Worth stating plainly, because it is the reason this hatch outlived the one beside it: the
   * excuse was LITERALLY TRUE OF ONE RETURN PATH. `not-family-data` needed a knowingly false
   * Hebrew reason; this one an honest author can walk into. Now: the key set is pinned per map,
   * EVERY return of the producer must assign a literal null, and the field name may not appear
   * anywhere in the producer or in aiChat.ts as a value.
   */
  | { status: 'never-populated'; whyHe: string }
  /**
   * Reaches the provider but says nothing about this family — our own static text, or a routing
   * parameter. Disclosing it would be noise, and noise in a disclosure is how the real facts get
   * skipped.
   */
  | { status: 'not-family-data'; whyHe: string }
  /**
   * Closing review B-i — an expression built ENTIRELY out of other entries in these same maps,
   * each disclosed on its own. `wrapExternalData(JSON.stringify(ctx))` is the whole
   * FinancialContext; `buildSystemPrompt(baseSystem)` is the assembled system prompt.
   *
   * This is the one status that does not carry a phrase, so it is the one a future author could
   * reach for to wave something through. It is therefore not taken on trust: the guard requires
   * the set of `composed` keys at each call site to be EXACTLY the bridge it expects, so pointing
   * the adapter at some other composed expression fails rather than inheriting this excuse.
   */
  | { status: 'composed'; ofHe: string };

/**
 * The context map's entries — the four statuses MINUS `composed`, and the subtraction is the point
 * (FINAL VERIFICATION — the sixth un-floored status).
 *
 * This alias used to be a bare `= EgressFieldDisclosure`, so `composed` was legal on
 * FINANCIAL_CONTEXT_EGRESS — and it was the ONE status nothing pinned there. `composed` was pinned
 * at each BRIDGE assertion, i.e. on the two request maps; the coverage test read the context map's
 * composed keys OFF THE CONTEXT MAP, which covers itself. Every other rule short-circuits on
 * `status !== 'sent'`, so a new composed context key was held by nothing but a non-empty `ofHe`.
 * Reproduced: a `recurringLines` string carrying per-line owner ids, amounts, labels and account
 * numbers, disclosed as composed with a sentence that is a lie — 1260 root + 328 functions green.
 *
 * There is nothing for the excuse to be true OF here, which is the same shape as the subtraction
 * below. A key in THIS map is a LEAF of FinancialContext — a value buildFinancialContext went and
 * computed about this household. `composed` means "an expression assembled out of other entries in
 * these same maps, each disclosed on its own"; a leaf is not assembled out of anything, it is the
 * thing the assembling is done TO. The runtime half is the per-map pin in
 * aiEgressDisclosure.payload.test.ts, which asserts the set is empty — a type error is not a
 * failing test, and this project's floors are tests.
 */
export type ContextFieldDisclosure = Exclude<EgressFieldDisclosure, { status: 'composed' }>;

/**
 * The request maps' entries — the same four MINUS `never-populated`, and the subtraction is the
 * point (final close review B-1, proof 2).
 *
 * The producer check only ever ran over FINANCIAL_CONTEXT_EGRESS, so on these two maps
 * `never-populated` was verified by nothing but a non-empty `whyHe`. The reviewer re-ran an
 * earlier bypass verbatim — a new `accounts` read appended to `baseSystem`, sending the exact
 * thing the negative disclosure line promises does not leave — labelled it `never-populated`,
 * and got 1197 green with the account name and number in the system prompt.
 *
 * There was never anything for the excuse to be true OF here. A key in these maps is a DYNAMIC
 * contributor that promptEgress.ts's stringContributors found reaching the adapter call; static
 * text and literals are dropped before a key is ever minted. "This value is never given a value"
 * is not a claim that can be made about one. The runtime half of this is the per-map pin in
 * aiEgressDisclosure.payload.test.ts, which asserts the set is empty — a type error is not a
 * failing test, and this project's floors are tests.
 */
export type RequestFieldDisclosure = Exclude<EgressFieldDisclosure, { status: 'never-populated' }>;

/**
 * FinancialContext (functions/src/context/types.ts), LEAF BY LEAF — dotted paths, walked through
 * every nested interface and inline type literal. Phrases are matched as substrings of the
 * rendered copy, so they must be copied from the lines above rather than paraphrased.
 */
export const FINANCIAL_CONTEXT_EGRESS: Record<string, ContextFieldDisclosure> = {
  scope: {
    status: 'sent',
    phrasesHe: ['אם אתה רואה נתונים של כל המשפחה, רק שלך, או שאין לך הרשאה'],
  },
  // Two axes, two facts, and now two ENTRIES: the members selected and the period. One entry for
  // the whole `filterScope` object is what let bypass 1's `categoryIds` in.
  'filterScope.memberIds': { status: 'sent', phrasesHe: ['מי מבני המשפחה סומן בסינון'] },
  'filterScope.period.month': { status: 'sent', phrasesHe: ['החודש שנבחר במסך'] },
  'filterScope.period.year': { status: 'sent', phrasesHe: ['החודש שנבחר במסך'] },

  'totalMonthlyExpense.value': { status: 'sent', phrasesHe: ['סך ההוצאות הקבועות'] },
  'totalMonthlyIncome.value': { status: 'sent', phrasesHe: ['סך ההכנסות הקבועות'] },
  // FinancialFact's two provenance fields. Fixed strings our own code writes ('recurring (סוג
  // הוצאה, פעיל)') and the date of the read — they qualify the figure, they are not a second
  // figure. Listed rather than folded into `.value` so that a FinancialFact growing a third field
  // fails this guard.
  'totalMonthlyExpense.source': {
    status: 'not-family-data',
    whyHe: 'תווית קבועה שהקוד שלנו כותב כדי לציין מאיפה הסכום חושב — לא נתון של המשפחה.',
  },
  'totalMonthlyIncome.source': {
    status: 'not-family-data',
    whyHe: 'תווית קבועה שהקוד שלנו כותב כדי לציין מאיפה הסכום חושב — לא נתון של המשפחה.',
  },
  'totalMonthlyExpense.asOf': {
    status: 'not-family-data',
    whyHe: 'התאריך שבו הסכום חושב — מידע על הקריאה עצמה, לא על המשפחה.',
  },
  'totalMonthlyIncome.asOf': {
    status: 'not-family-data',
    whyHe: 'התאריך שבו הסכום חושב — מידע על הקריאה עצמה, לא על המשפחה.',
  },

  'netWorth.value': { status: 'never-populated', whyHe: NET_WORTH_NEVER_POPULATED_HE },
  'netWorth.source': { status: 'never-populated', whyHe: NET_WORTH_NEVER_POPULATED_HE },
  'netWorth.asOf': { status: 'never-populated', whyHe: NET_WORTH_NEVER_POPULATED_HE },
};

/**
 * Everything dynamic that reaches `generateText` on the chat path: the contributors of the system
 * prompt aiChat.ts assembles, plus the contributors of the request object itself.
 *
 * Keys are the expressions as they appear in the handler, so a widening shows up here as a key
 * nobody added rather than as silence.
 */
export const CHAT_REQUEST_EGRESS: Record<string, RequestFieldDisclosure> = {
  // The prose scope line the handler writes above the JSON. A conditional's CONDITION is recorded
  // even when both branches are static Hebrew, because which branch was taken is itself the fact.
  "ctx.scope === 'none'": {
    status: 'sent',
    phrasesHe: ['אם אתה רואה נתונים של כל המשפחה, רק שלך, או שאין לך הרשאה'],
  },
  "ctx.scope === 'family'": {
    status: 'sent',
    phrasesHe: ['אם אתה רואה נתונים של כל המשפחה, רק שלך, או שאין לך הרשאה'],
  },
  'ctx.filterScope.memberIds === null': { status: 'sent', phrasesHe: ['מי מבני המשפחה סומן בסינון'] },
  'ctx.filterScope.memberIds.length': { status: 'sent', phrasesHe: ['מי מבני המשפחה סומן בסינון'] },
  'ctx.filterScope.period.month': { status: 'sent', phrasesHe: ['החודש שנבחר במסך'] },
  'ctx.filterScope.period.year': { status: 'sent', phrasesHe: ['החודש שנבחר במסך'] },

  'wrapExternalData(JSON.stringify(ctx))': {
    status: 'composed',
    ofHe: 'כל אובייקט FinancialContext — כל שדה שלו מפורט ב-FINANCIAL_CONTEXT_EGRESS.',
  },
  'buildSystemPrompt(baseSystem)': {
    status: 'composed',
    ofHe: 'הוראות המערכת שלנו סביב baseSystem — וכל מה ש-baseSystem מרכיב מפורט כאן למעלה.',
  },

  history: { status: 'sent', phrasesHe: ['התשובות הקודמות באותה שיחה'] },
  message: { status: 'sent', phrasesHe: ['השאלות שלך'] },
  modelId: {
    status: 'not-family-data',
    whyHe: 'מזהה המודל שנבחר — פרמטר ניתוב לספק AI, לא נתון של המשפחה.',
  },
};

/**
 * Everything dynamic that reaches `generateJson` on the extraction path: the contributors of
 * buildExtractionPrompt's returned text, plus the contributors of the request object — which is
 * where the document itself lives.
 */
export const EXTRACTION_REQUEST_EGRESS: Record<string, RequestFieldDisclosure> = {
  'JSON.stringify(familyMembers)': { status: 'sent', phrasesHe: ['שמות בני המשפחה'] },
  "ALLOWED_CATEGORIES.join(', ')": {
    status: 'not-family-data',
    whyHe: 'רשימת הקטגוריות הקבועה של האפליקציה — טקסט שלנו, לא נתון של המשפחה.',
  },
  // KEYED BY PRINTED SOURCE TEXT, not by a name chosen here. aiEgressDisclosure.payload.test.ts
  // derives this whole key set from functions/src/handlers/aiExtractDocument.ts's AST, so a
  // semantic edit to the expression that builds the prompt renames this key and fails that test
  // until this line moves with it. That is the coupling working, not a defect — but it is why
  // this entry cannot be renamed for readability. (Batch 10: the key lost a dead `?? []` here.)
  'buildExtractionPrompt(familyMembers)': {
    status: 'composed',
    ofHe: 'טקסט ההוראות שלנו יחד עם שמות בני המשפחה — שני החלקים מפורטים כאן.',
  },
  // The document. `mimeType` is grouped with it rather than excused as metadata: it describes the
  // file that is already disclosed as leaving, and the conservative reading costs nothing.
  fileBase64: { status: 'sent', phrasesHe: ['המסמך עצמו'] },
  mimeType: { status: 'sent', phrasesHe: ['המסמך עצמו'] },
  modelId: {
    status: 'not-family-data',
    whyHe: 'מזהה המודל שנבחר — פרמטר ניתוב לספק AI, לא נתון של המשפחה.',
  },
};
