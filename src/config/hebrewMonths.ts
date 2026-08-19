// src/config/hebrewMonths.ts — Stage 7 T6. THE ONE PLACE THE TWELVE HEBREW MONTH NAMES ARE WRITTEN.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// MOVED, NOT DUPLICATED — D29(c), and the F4 class it names
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// This array lived as `monthsList` inside `FuturePlanning.tsx`, where it does two jobs: it fills
// the goal form's month `<select>`, and it is what `goals.date` is BUILT from (`date: `${month}
// ${year}``). T6 needs to PARSE that field, and the plan is explicit that the array is MOVED
// rather than copied: duplicating a map is this project's recorded F4 defect class, and the
// failure mode here is specific and silent — a parser holding its own copy of the twelve names
// agrees with the writer until someone renames a month in one of them, after which every goal in
// that month stops parsing and is COUNTED AS UNPARSEABLE rather than reported as a mismatch.
//
// So `FuturePlanning.tsx` imports from here, and the month-literal guard (`monthLiteralGuard.
// test.ts`) treats THIS MODULE as the single exemption from its Hebrew-month-name ban — an
// exemption it DERIVES by finding the one module in the forecast closure that declares
// `HEBREW_MONTH_NAMES`. If a second module ever declares it, the guard's "exactly one" assertion
// fails, which is the duplicate-map check the F4 class asks for, for free.
//
// ── WHY `src/config/` AND NOT `src/utils/` ────────────────────────────────────────────────────
//
// `forecastPurity.test.ts` walks `forecast.ts`'s transitive closure and bans `services/`,
// `contexts/` and `components/`. This module is reached from that closure (through
// `forecastTargets.ts`), it has NO IMPORTS AT ALL, and it is data plus two total lookups — the
// same shape as every other `src/config/` module.

/**
 * The twelve month names, **January at index 0**, exactly as `FuturePlanning.tsx` has written them
 * into `goals.date` since the goal form shipped.
 *
 * The index-0 convention is stated because it is the half that goes wrong: `monthKeyOf` has to add
 * one to reach `'01'..'12'`, and an off-by-one here moves every goal one month earlier with no
 * error anywhere — a goal due in December quietly becomes a November deadline in the allowance
 * arithmetic. `hebrewMonthsRoundTrip` in the tests holds the two conversions against each other.
 */
export const HEBREW_MONTH_NAMES: readonly string[] = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
];

/**
 * `'ספטמבר'` → `'09'`; anything else → `null`.
 *
 * Zero-padded two-character month KEYS rather than integers, because that is what
 * `seasonality.ts` scopes a factor by and what a period's own tail is — and because D24's own
 * shape used string keys while v1's guard banned integers, which is how a guard ships green over
 * the exact defect it was written for.
 *
 * `null` rather than a fallback: a name this array does not hold is a goal this app cannot place
 * on a calendar, and D29(c) requires those to be EXCLUDED WITH A VISIBLE COUNT rather than
 * defaulted into some month.
 */
export function monthKeyOfHebrewName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const index = HEBREW_MONTH_NAMES.indexOf(name.trim());
  if (index < 0) return null;
  return String(index + 1).padStart(MONTH_KEY_WIDTH, '0');
}

/** `'09'` → `'ספטמבר'`; anything that is not a `'01'..'12'` key → `null`. */
export function hebrewNameOfMonthKey(monthKey: unknown): string | null {
  if (typeof monthKey !== 'string' || !MONTH_KEY_PATTERN.test(monthKey)) return null;
  return HEBREW_MONTH_NAMES[Number(monthKey) - 1] ?? null;
}

/**
 * The shape of a month key, in one place. `'01'`–`'12'` and nothing else — not `'1'`, not `'13'`,
 * not `'00'`. Exported because `seasonality.ts` validates a scope id against it and Rules cannot
 * import, so the two are held together by a test rather than by a comment.
 */
export const MONTH_KEY_PATTERN = /^(0[1-9]|1[0-2])$/;

/** The width `monthKeyOfHebrewName` pads to. Named so the padding is not a bare literal. */
const MONTH_KEY_WIDTH = 2;

/**
 * §10's two seasonal months, NAMED — `'ספטמבר=חוגים, אפריל=חגים'`.
 *
 * They live here rather than in `seasonality.ts` for the same reason the twelve names do: this is
 * the module that DEFINES the calendar, and the no-month-literal guard's whole point is that no
 * other module writes a month down. Its remedy for a bare literal is "name the constant"; these are
 * the constants. `hebrewMonths.test.ts` asserts each one round-trips to the month §10 names, so a
 * typo here is a failure rather than a silently mis-scoped seasonal factor.
 */
export const MONTH_KEY_SEPTEMBER = '09';
export const MONTH_KEY_APRIL = '04';
