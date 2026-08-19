// src/config/time.ts — the client half of the ONE "which month is it" semantic (D32b).
//
// Stage 7 adds three new places where the app decides which month it is, and the word "timezone"
// appeared zero times in the plan that preceded it. The only pinned clock in the tree before this
// is the cost gate's, and it was added AFTER a rollover bug corrupted two months of counters:
// `functions/src/costGate/costGate.ts` formats its `monthKey` with `timeZone: 'Asia/Jerusalem'`
// precisely because a Functions container's local time is UTC and the plain `Date` getters roll the
// month boundary 2-3 hours off Israel's real one, in BOTH directions.
//
// ── WHY THIS IS A SECOND DECLARATION AND NOT AN IMPORT ─────────────────────────────────────────
//
// D32 says `APP_TIMEZONE` is "reused from the cost gate, not re-declared". IT CANNOT BE. There is
// no exported constant to reuse — the cost gate holds the literal inline inside its
// `Intl.DateTimeFormat` options — and `functions/src/shared/permissions.ts:11-14` forbids moving a
// second piece of logic across the deploy boundary in writing, instructing an esbuild/tsup
// predeploy step instead. So `src/` gets one declaration, and the SUBSTANCE of "not re-declared" —
// that there is exactly one value and it cannot drift — is enforced by `appTimezone.test.ts`,
// which reads the functions-side literal off disk and asserts no other `'Asia/Jerusalem'` exists
// anywhere in `src/`. That is the same mirroring convention `src/config/aiCeiling.ts` already
// documents for `MAX_MONTHLY_CEILING_ILS`: two layers, one value, each layer's tests holding it.
//
// NOTHING IN THE FORECAST ENGINE'S IMPORT CLOSURE MAY READ THIS — which is `src/utils/forecast.ts`,
// `forecastBasis.ts`, `statisticalLayer.ts` and everything they reach, not one file. The forecast
// core takes `todayPeriod` as a parameter and reads no clock at all (D37); this constant belongs to
// whoever computes that parameter, at the edge, once. `forecastPurity.test.ts` is what holds it,
// over the whole closure, so the ban does not depend on this sentence naming every module.

/**
 * The timezone every "which month is it" decision in this app is made in. Mirrors the literal in
 * `functions/src/costGate/costGate.ts`'s `monthKey`; `appTimezone.test.ts` holds the two together
 * and forbids a third copy in `src/`.
 */
export const APP_TIMEZONE = 'Asia/Jerusalem';

/**
 * The `'YYYY-MM'` period a moment falls in, IN A NAMED TIMEZONE.
 *
 * ── WHY THE CLOCK READ LIVES HERE AND NOT IN THE FORECAST ─────────────────────────────────────
 *
 * D37 constrains `src/utils/forecast.ts` and its whole transitive closure to construct no `Date`
 * and call no `Date.now()`, and `forecastPurity.test.ts` walks that closure and fails on either.
 * `todayPeriod` is therefore computed HERE, at the edge, ONCE, and passed in as a string — which is
 * also what makes every forecast test deterministic without faking a global clock.
 *
 * `Intl.DateTimeFormat`, not `getFullYear()`/`getMonth()`. Those read the HOST's zone: a browser in
 * London on the 1st of a month at 00:30 Israel time is still on the 31st, so the app would forecast
 * from the wrong anchor and the family would see last month's forecast for two and a half hours.
 * That is the same rollover the cost gate's `monthKey` was fixed for, in the same direction.
 *
 * `'en-CA'` is chosen for its OUTPUT SHAPE — it is the locale whose numeric date format is ISO
 * `YYYY-MM-DD` — and not for any linguistic reason; the string is sliced, never shown.
 *
 * REFUSES an unformattable moment rather than returning a plausible period. A forecast anchored on
 * a wrong month is wrong in every figure it draws, silently, and `Invalid Date` formats to a string
 * that is not a period at all.
 */
export function periodInTimeZone(moment: Date, timeZone: string): string {
  // THROWS ON ITS OWN for an invalid `Date` — `Intl.DateTimeFormat.format` raises
  // `RangeError: Invalid time value`. That refusal is not re-implemented below; the check below is
  // about a different failure, and saying which is which is the point of splitting them.
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(moment);
  return periodFromIsoDateText(formatted, timeZone);
}

/** `'YYYY-MM'`. Named so the slice offset is not mistaken for a month. */
const PERIOD_LENGTH = 7;

/**
 * The `'YYYY-MM'` prefix of an ISO date TEXT, or a refusal.
 *
 * ── WHY THIS IS A SEPARATE, EXPORTED FUNCTION AND NOT AN `if` INSIDE THE ONE ABOVE ────────────
 *
 * Because otherwise the check could never fail, and this repo counts guards that cannot fail. An
 * invalid `Date` is already refused by `Intl` one line earlier, so with a `Date` input there is no
 * value that reaches a shape check and fails it — the `if` would be belt-and-braces wearing a
 * mechanism's name, which is the T5 `stripComments` defect verbatim.
 *
 * The failure this really guards is a DIFFERENT one: `'en-CA'` is relied on for its output SHAPE
 * (it is the locale whose numeric format is ISO `YYYY-MM-DD`), and that is an assumption about the
 * host's ICU data, not about the caller's input. If a runtime ever formats it `31/08/2026`, slicing
 * seven characters yields `'31/08/2'` and every figure on the screen is anchored on a month that
 * does not exist. Split out, that assumption is testable on a synthetic string — and it is tested.
 */
export function periodFromIsoDateText(formatted: string, timeZone: string): string {
  const period = formatted.slice(0, PERIOD_LENGTH);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error(
      `periodFromIsoDateText: could not read a 'YYYY-MM' period out of "${formatted}" in ${timeZone}. ` +
        'A forecast anchored on the wrong month is wrong in every figure it draws.'
    );
  }
  return period;
}

/**
 * Which month it is, for this app, everywhere.
 *
 * The default argument is the ONLY clock read on the forecast's whole call path, and it is here so
 * a test can pass a moment instead of freezing time globally.
 */
export function currentAppPeriod(moment: Date = new Date()): string {
  return periodInTimeZone(moment, APP_TIMEZONE);
}

/**
 * The `'YYYY-MM-DD'` calendar date a moment falls on, in `APP_TIMEZONE`.
 *
 * D16's `openingBalance.staleness` is measured in DAYS between `balanceUpdatedAt` and "today", so
 * the forecast needs day precision as well as month precision — and it needs it in the same zone,
 * or a balance updated last night reads as a day older or newer depending on where the browser is.
 */
export function currentAppDate(moment: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(moment);
}
