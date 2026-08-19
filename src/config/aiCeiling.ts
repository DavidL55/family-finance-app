// Task 8 review F1/F3 — the client half of the ONE monthly-ceiling semantic.
//
// Deliberately a standalone, dependency-free module rather than another export on aiClient.ts:
// aiClient.ts pulls in `firebase/functions`, so every test that wanted the shared bound would
// have had to mock Firebase to read a constant. Keeping it pure means AiSettingsScreen and its
// tests share the REAL value instead of a hand-copied literal in a mock factory.
//
// The server-side source of truth is functions/src/costGate/types.ts (MAX_MONTHLY_CEILING_ILS,
// resolveCeiling). This is the same deliberate mirroring convention the project already uses for
// AiModelInfo/AiUsageSummary across the deploy boundary — the two are kept honest by each layer's
// own tests asserting the SAME boundary values (0 accepted, MAX accepted, MAX+1 refused).

/** Mirrors MAX_MONTHLY_CEILING_ILS in functions/src/costGate/types.ts and firestore.rules. */
export const MAX_MONTHLY_CEILING_ILS = 1_000_000;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Stage 7 T7b (§7) — `formatILS` MOVED OUT, to `src/config/money.ts`, byte-identical.
//
// It arrived here in batch 8 because this was the dependency-free module the AI money semantics
// already lived in. Stage 7 gives the app ₪ figures that have nothing to do with the AI cost
// gate, and `import { formatILS } from './aiCeiling'` inside a forecast component states a
// dependency that is not real. The re-export below is what makes this a MOVE rather than a
// second formatter: `aiOverage.ts` and `AiSettingsScreen.tsx` import the same binding from the
// same name they always did, and there is still exactly one implementation.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export { formatILS } from './money';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE RE-MEASURE — UNVERIFIED_PRICING_CAVEAT_HE MOVED HERE from AiSettingsScreen.tsx,
// where it was a module-private const. A move, for the same reason formatILS moved here in
// batch 8, and now for a second reason on top of it.
//
// The re-measure counted NINE ₪ figures in the app, not eight. Eight are on AiSettingsScreen,
// which is super-admin-only and carries this caveat. The ninth is aiOverageAmountLineHe's, which
// renders on the DASHBOARD, for EVERY role, and carried nothing but the word "המשוערת" — and
// "estimated" reads as rounding. What is actually true is stronger and different: registry.ts's
// own 20-line banner records that every per-token price behind these figures is an UNVERIFIED
// placeholder, because the vendor pricing pages were blocked or ambiguous. A reader told
// "estimated" has been told about arithmetic. They have not been told the rate card was never
// checked.
//
// So the sentence now has two consumers on two different screens, which is exactly the condition
// under which this project has twice been bitten (formatILS; the egress copy's F4) — one copy
// goes stale and the same fact is stated two different ways to two different people. It lives in
// the dependency-free config module for the reason this file's header gives: the consumers' test
// suites mock ../services/aiClient wholesale, so shared copy behind that import would have to be
// re-typed inside a mock factory and would no longer be shared.
//
// Batch 9's ספק sweep changed every other occurrence of the bare noun to ספק AI / ספקי AI and
// MISSED THIS ONE, which still read "מול הספקים" — on a screen full of money, where ספק already
// means the merchant on a transaction and the insurer on a policy. Corrected in the same move,
// and now covered by a guard rather than by a sweep: see the term test in glossary.test.ts, whose
// corpus was the actual hole (it read glossary entries and the egress banner, and no component or
// config copy at all).
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The one unverified-pricing caveat, rendered verbatim beside every ₪ figure this app derives
 * from the placeholder rate card — on AiSettingsScreen and on the Dashboard's overage panel.
 *
 * Unconditional by design: it is a property of the rate card, not of any date or any amount, so
 * unlike the FX-staleness warnings above it there is no state in which it is correct to omit it.
 */
export const UNVERIFIED_PRICING_CAVEAT_HE =
  'מחירי המודלים לא אומתו מול ספקי ה-AI — כל סכום בשקלים כאן הוא הערכה.';

/**
 * Mirrors CeilingStatus in functions/src/costGate/types.ts:
 *   'configured' — a real number in [0, MAX]. **0 is configured**, meaning "no paid AI this
 *                  month" — NOT a synonym for unset, which is the contradiction F3 names.
 *   'unset'      — nobody has ever set one.
 *   'invalid'    — a corrupt value is stored; the cost gate refuses every paid call until it is
 *                  re-saved. Must never be rendered as "no ceiling has been set".
 */
export type CeilingStatus = 'configured' | 'unset' | 'invalid';

/**
 * Batch 6 (closing review B1) — mirrors AiUsageStatus in functions/src/handlers/types.ts. It is
 * the USAGE half of the CeilingStatus semantic above, and it exists for the same reason.
 *
 * 'corrupt' means at least one stored ₪ figure for this month — a monthly counter or a ledger
 * entry's amount — is not a readable number. costGate.spend() refuses EVERY paid call in that
 * state, so it must never be rendered as "₪0.00 spent": that is F1's "gate off, screen
 * reassuring" pairing with the sign flipped. Before this batch the corrupt total reached the
 * progress bar as a NaN and rendered literally as "NaN% מהתקרה".
 */
export type AiUsageStatus = 'ok' | 'corrupt';

// Deliberately does NOT contain the phrase "מהתקרה": that string belongs to the percentage line
// this notice REPLACES, and the F2 guard asserts it appears exactly once on the screen. Reusing it
// here would make "the percentage is gone" untestable by text — a small thing, but it is the same
// class as a guard a comment can satisfy.
export const USAGE_CORRUPT_MESSAGE_HE =
  'רישום ההוצאות של ה-AI לחודש זה פגום ולא ניתן לקריאה — לא ניתן להציג את סך ההוצאות החודשי, וכל קריאת AI בתשלום חסומה עד שהנתונים יתוקנו בשרת';

// A `status` string discriminant, not a boolean `ok`, matching this codebase's own
// LoadState/ResolvedPermissionsState convention — and it narrows correctly under the root
// tsconfig, which does not enable `strict`.
export type CeilingInputResult =
  | { status: 'ok'; value: number }
  | { status: 'error'; messageHe: string };

export const CEILING_EMPTY_MESSAGE_HE =
  'יש להזין תקרה חודשית — כדי לחסום קריאות AI בתשלום יש להזין 0 במפורש';
export const CEILING_RANGE_MESSAGE_HE =
  `תקרה חייבת להיות מספר בין 0 ל-${MAX_MONTHLY_CEILING_ILS.toLocaleString('he-IL')} (0 חוסם קריאות AI בתשלום)`;

/**
 * Parses what the operator typed into the ceiling field.
 *
 * The empty/whitespace case is the whole point: `Number('')` is 0, so clearing the field used to
 * SAVE a ceiling of 0 with no warning at all — and 0 was then read as "unconfigured" by both the
 * cost gate and this screen, so every paid call failed with "the ceiling has not been configured"
 * shown to the person who had just configured it. An empty field is now a refusal, and 0 is
 * something the operator has to type on purpose.
 */
export function parseCeilingInput(raw: string): CeilingInputResult {
  if (raw.trim() === '') return { status: 'error', messageHe: CEILING_EMPTY_MESSAGE_HE };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > MAX_MONTHLY_CEILING_ILS) {
    return { status: 'error', messageHe: CEILING_RANGE_MESSAGE_HE };
  }
  return { status: 'ok', value };
}
