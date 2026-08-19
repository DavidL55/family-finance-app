// src/utils/periodMath.ts — Stage 7 (D22).
//
// Pure calendar arithmetic on `'YYYY-MM'` period strings and `'YYYY-MM-DD'` date strings. No I/O,
// no Firebase, no clock: nothing here reads `new Date()` or `Date.now()`, and nothing constructs a
// `Date` at all. That is not a style preference — `src/utils/forecast.ts`'s import closure is held
// to it by `forecastPurity.test.ts` (D37), and `recurringCatchup.ts`, whose primitives this module
// now owns, was written that way from the start so it could never observe a timezone or DST skip.
//
// ── WHAT MOVED AND WHAT IS NEW ──────────────────────────────────────────────────────────────────
//
// MOVED VERBATIM from `recurringCatchup.ts`, where three of these were module-private and only
// `clampDayToMonth` was exported: `comparePeriod`, `nextPeriod`, `periodsBetween`,
// `clampDayToMonth`. `recurringCatchup.ts` now imports them from here. Their behaviour is
// unchanged, and `recurringCatchup.test.ts` stays green across the move.
//
// WRITTEN, NOT MOVED: `periodOf`. Its predecessor, `periodOfDateString`, was
// `dateStr.slice(0, 7)` and had no failure mode whatsoever. `transaction_lines.date` holds TWO
// formats (ISO `YYYY-MM-DD` natively-written, legacy `DD/MM/YYYY` possibly unpadded from the
// migration), so on a legacy row the slice returned `"9/3/202"` — not a failure, a silently WRONG
// period. Nothing downstream could see it: a `where('period','in',[…])` query simply drops the row,
// the backfill's completion marker only says the backfill finished, and `unusableRowCount` counts
// `'unknown'`, which the slice never wrote.
//
// `parseTransactionDate` (`./transactionFilters`) exists for exactly this two-format problem,
// validates the month, and returns `null` on failure — and its own header FORBIDS callers from
// substituting a guess. `periodOf` is built on it and inherits that contract.
//
// ── WHY `periodOf` RETURNS `string | null` AND NOT `'unknown'` ─────────────────────────────────
//
// `'unknown'` is a decision about what to PERSIST, and it belongs to the caller, not to the reader.
// Every site that stamps a `period` onto a document uses `periodOrUnknown`; every site that merely
// wants to know which month a date falls in uses `periodOf` and handles `null` itself. A single
// function doing both would let a write site forget the decision and stamp a wrong-but-plausible
// string instead.
//
// NOTE on the root tsconfig: it is NOT strict, so `string | null` collapses to `string` for the
// compiler in `src/`. The `null` return is real at runtime and the compiler will not remind any
// caller to handle it — which is why the negative cases are pinned in tests rather than in types.
// ── T4 REVIEW F-2 — THE STEPPING FUNCTIONS ARE TOTAL, AND THE FIX IS HERE RATHER THAN AT A
//    SEVENTH CALLER ─────────────────────────────────────────────────────────────────────────────
//
// SIX instances of one shape were found across T1–T4, each fixed separately, each fix failing to
// generalise to the next:
//
//   1. `nextPeriod('')` -> `'0-NaN'`, a FIXED POINT — `computeDuePeriods` looped until the heap
//      died (T1). Closed with a `periodOf(...) === null` refusal in `recurringCatchup.ts`.
//   2. `previousPeriod('unknown')` -> `'NaN-NaN'` — closed with an `asOfDate` refusal in
//      `demoCorpus.ts` (T4).
//   3. `chunkPatches(p, 0)` looping on `i += 0` — closed with a size validation in
//      `backfillPlan.ts` (T3 fix batch). Not period arithmetic; the SAME shape.
//   4. `horizonPeriods('', 3)` — a real V8 OOM, exit 134 (T4 review). `horizonPeriods` validates
//      `months` exhaustively AND CITES THE `computeDuePeriods` HEAP DEATH BY NAME WHILE DOING IT,
//      then leaves `anchorPeriod` unvalidated.
//   5. `projectInsuranceForward(active, '', to)` — the same OOM, one function away.
//   6. `computeDuePeriods` with a malformed `lastPostedPeriod` — found by THIS fix (see below).
//
// The per-caller refusal has now failed to generalise six times, so the refusal moved to the one
// place all six pass through. A caller may no longer write a loop that never terminates: every
// function that produces a period a loop treats as PROGRESS refuses a malformed input, and
// `loopTermination.test.ts` holds that property mechanically rather than by inspection.
//
// ── WHY IT THROWS, AND NOT `null`, AND NOT A DISCRIMINATED RESULT ────────────────────────────────
//
// Both of those REPRODUCE THE BUG on this codebase, and the reason is the root tsconfig: it is NOT
// strict, so a `string | null` return collapses to `string` for every caller in `src/` and the
// compiler will never make one handle the failure. The unhandled value then reaches
// `comparePeriod`, which is total and maps a non-string to **0** — "equal, still inside the range"
// — which is the fixed point that killed the heap in the first place, arrived at by a different
// road. A refusal a caller is free to ignore is not a refusal. `periodMath.test.ts` demonstrates
// this rather than asserting it: it runs `periodsBetween`'s own loop over a hypothetical
// null-returning step and observes the cursor never advancing.
//
// `periodOf` keeps its `string | null` return and that is not an inconsistency: `periodOf` is a
// PARSER whose failure is an expected, frequent, data-driven outcome that every caller already
// branches on, and its result is not a loop cursor. `nextPeriod` is a STEP, and a step that fails
// is a bug in the caller, not a fact about the data.
//
// ── WHAT STAYS TOTAL ON PURPOSE ─────────────────────────────────────────────────────────────────
//
// `comparePeriod` does NOT refuse. `UNKNOWN_PERIOD` is a real stamped value that real rows carry
// and real code compares; making comparison throw would refuse the corpus this stage deliberately
// built. Comparison also cannot cause a runaway loop — only stepping can.
import { parseTransactionDate } from './transactionFilters';

/**
 * The period stamped on a row whose `date` cannot be read (D21c). It is a QUERIED VALUE — the
 * history read sends it as one of the `in` clause's values — so it is a wire format, not a label:
 * changing this string silently orphans every row already stamped with the old one.
 */
export const UNKNOWN_PERIOD = 'unknown';

/**
 * `'YYYY-MM'` for either date format the ledger holds, or `null` when the date cannot be read.
 *
 * The month is zero-padded even when the source was not (`"9/3/2026"` → `"2026-03"`), because the
 * whole value of a `'YYYY-MM'` period is that plain string comparison IS chronological order.
 */
export function periodOf(dateStr: string | undefined | null): string | null {
  const parsed = parseTransactionDate(dateStr);
  return parsed ? `${parsed.year}-${parsed.month}` : null;
}

/**
 * The ONE place `'unknown'` is chosen. Every caller that persists a `period` uses this; none
 * re-implements it, and none calls `periodOf` and invents its own fallback.
 */
export function periodOrUnknown(dateStr: string | undefined | null): string {
  return periodOf(dateStr) ?? UNKNOWN_PERIOD;
}

/**
 * A zero-padded `'YYYY-MM'` and nothing else. TOTAL on any input — `unknown`, not `string`,
 * because every value this stage validates arrives off a schemaless document through a non-strict
 * tsconfig, where a narrower declared type is a claim the compiler cannot keep.
 *
 * The month range is in the PATTERN, not in a follow-up numeric check: `'2026-00'` and `'2026-13'`
 * are the two shapes whose arithmetic produces a wrong-but-plausible neighbour rather than an
 * obvious failure, and a regex that already refuses them cannot be got past by a coercion.
 */
export function isPeriod(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/**
 * A period's CALENDAR MONTH, as the two-character key `'01'..'12'` — `'2026-09'` → `'09'`.
 *
 * ── WHY THIS LIVES HERE AND NOT IN `seasonality.ts` (T6) ──────────────────────────────────────
 *
 * Extracting the month out of a period is period arithmetic, and this module is where period
 * arithmetic is allowed to live — `loopTermination.test.ts`(B) is a rule about exactly that, and
 * the reason is instance 2: a private copy of `previousPeriod` in `demoCorpus.ts` inheriting a bug
 * the shared module had already fixed.
 *
 * There is a second, T6-specific reason. `seasonality.ts` is the module the no-month-literal guard
 * bans integer month literals in; the obvious inline spelling of this function is
 * `period.slice(5, 7)`, and a slice offset is not a month even though `5` reads like one. Putting
 * the offsets HERE keeps the seasonality module free of every integer the guard has to reason
 * about, instead of forcing the guard to distinguish an offset from a month — which is the exact
 * distinction v1's version got wrong in the other direction.
 *
 * REFUSES rather than returning `null`, matching this module's stepping functions: a caller that
 * groups observations by month key would silently pool every malformed period into one bucket and
 * average across it, which is a wrong number rather than a missing one.
 */
export function monthKeyOf(period: string): string {
  if (!isPeriod(period)) refusePeriod('monthKeyOf', 'period', period);
  return period.slice(MONTH_KEY_START, MONTH_KEY_END);
}

/** The `'YYYY-MM'` offsets `monthKeyOf` slices between. Named so neither reads as a month. */
const MONTH_KEY_START = 5;
const MONTH_KEY_END = 7;

/**
 * The refusal every stepping function shares. `Error`, not a `null` return and not a discriminated
 * result — see this module's header for why those two REPRODUCE the bug rather than fix it.
 */
function refusePeriod(fn: string, argument: string, value: unknown): never {
  throw new Error(
    `${fn}: ${argument} must be a zero-padded 'YYYY-MM' period, got ${JSON.stringify(value)}. ` +
      'Stepping a malformed period returns a value that does not compare as progress, which is an ' +
      'unbounded loop in the caller, not a wrong answer.'
  );
}

/**
 * −1 / 0 / 1, chronological. Moved verbatim from `recurringCatchup.ts`.
 *
 * !! THIS FUNCTION IS THE REASON THE BUG CLASS HID. It is TOTAL and it never throws, so it maps
 * every non-period to SOME answer: `'NaN-NaN'` sorts after every real period (`'N' > '2'`) and the
 * walk stops by accident, while `'0-NaN'` sorts before every real period and the walk never stops.
 * A non-string maps to 0, which is "equal, still inside the range" — the fixed point again.
 * Comparison stays total on purpose (it is used on `UNKNOWN_PERIOD`, a real stamped value, and on
 * period fields read straight off documents); the STEPPING functions below are where the refusal
 * belongs, because stepping is the only operation whose result a loop treats as progress.
 */
export function comparePeriod(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The period after `period`, rolling December into the next January. */
export function nextPeriod(period: string): string {
  if (!isPeriod(period)) refusePeriod('nextPeriod', 'period', period);
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * The period before `period`, rolling January back into the previous December.
 *
 * MOVED HERE from `demoCorpus.ts` (T4 review F-2), where it was a module-private inverse of
 * `nextPeriod` carrying the identical defect: `previousPeriod('unknown')` was `'NaN-NaN'`. A second
 * copy of period arithmetic is how two halves of the app start disagreeing about which month a
 * charge falls in — and, as this one proved, how one half inherits a bug the other half has
 * already fixed.
 */
export function previousPeriod(period: string): string {
  if (!isPeriod(period)) refusePeriod('previousPeriod', 'period', period);
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

/**
 * The LATER of two periods, and the EARLIER — the clamp, with the same refusal the steps have.
 *
 * ── WHY THESE EXIST, AND WHY THE CLAMP IS ITS OWN CLASS ────────────────────────────────────────
 *
 * `comparePeriod` is total and never throws (see above), so the hand-written idiom
 * `comparePeriod(a, b) >= 0 ? a : b` is total too — and on a malformed operand it does not fail,
 * it QUIETLY PICKS ONE. That is a second failure class hiding behind the same accident as the
 * first, and the T4 review described instance 4's reachability in exactly those words:
 * "`composeForecast` validates neither `anchorPeriod` nor `todayPeriod`, so if both arrive `''`
 * THE CLAMP DOES NOT FIRE and the horizon loops forever." The clamp not firing is the sentence;
 * this is the function that makes it impossible.
 *
 * Every clamp in the tree goes through these two, and `loopTermination.test.ts` asserts
 * structurally that no `comparePeriod(...) ? … : …` ternary survives anywhere else.
 */
export function laterPeriod(a: string, b: string): string {
  if (!isPeriod(a)) refusePeriod('laterPeriod', 'a', a);
  if (!isPeriod(b)) refusePeriod('laterPeriod', 'b', b);
  return comparePeriod(a, b) >= 0 ? a : b;
}

/** The earlier of two periods. See `laterPeriod` for why the clamp refuses. */
export function earlierPeriod(a: string, b: string): string {
  if (!isPeriod(a)) refusePeriod('earlierPeriod', 'a', a);
  if (!isPeriod(b)) refusePeriod('earlierPeriod', 'b', b);
  return comparePeriod(a, b) <= 0 ? a : b;
}

/**
 * Every period from `from` to `to` inclusive, ascending. Empty if `from` > `to`.
 *
 * BOTH ends are validated, including the one no step ever reads: `from` after `to` returns `[]`
 * without a single call to `nextPeriod`, so a malformed `to` alone would produce an EMPTY forecast
 * — which renders exactly like a forecast with nothing in it — rather than a refusal.
 */
export function periodsBetween(from: string, to: string): string[] {
  if (!isPeriod(from)) refusePeriod('periodsBetween', 'from', from);
  if (!isPeriod(to)) refusePeriod('periodsBetween', 'to', to);
  const result: string[] = [];
  let cursor = from;
  while (comparePeriod(cursor, to) <= 0) {
    result.push(cursor);
    cursor = nextPeriod(cursor);
  }
  return result;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Clamps `day` to the last valid day of `month` (1-12) in `year` — bank standing-order semantics:
 * a charge dated the 31st is due on the 30th in a 30-day month, the 28th (or 29th in a leap year)
 * in February. Pure integer arithmetic — no Date objects — so it can never observe a TZ/DST skip.
 * Moved verbatim from `recurringCatchup.ts`, which still re-exports it for its existing callers.
 */
export function clampDayToMonth(year: number, month: number, day: number): number {
  const daysInMonth = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return Math.min(day, daysInMonth);
}

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/**
 * Strict ISO `YYYY-MM-DD` (a trailing time component is tolerated and ignored, because
 * `Account.balanceUpdatedAt` is written with `toISOString()`). Deliberately does NOT accept the
 * legacy `DD/MM/YYYY` form: this is used for DAY-level arithmetic, and the legacy form's day field
 * is the one part `parseTransactionDate` explicitly does not validate.
 */
function parseIsoCivilDate(value: string | undefined | null): CivilDate | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > clampDayToMonth(year, month, 31)) return null;
  return { year, month, day };
}

/**
 * Days since a fixed epoch, by integer arithmetic over the proleptic Gregorian calendar
 * (Howard Hinnant's `days_from_civil`). The epoch is arbitrary and never leaves this module — only
 * DIFFERENCES of two of these are exposed.
 */
function daysFromCivil({ year, month, day }: CivilDate): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra;
}

/**
 * Whole days from `fromIso` to `toIso` — negative when `to` precedes `from` — or `null` when
 * either side cannot be read.
 *
 * `null`, never `0`, on an unreadable input: D16 grades the opening balance's staleness in days,
 * and a `0` here would render a balance last touched three months ago as `'current'`, which is the
 * class of silent-wrongness this stage exists to prevent. The caller decides what an unreadable
 * timestamp means.
 */
export function daysBetweenDates(
  fromIso: string | undefined | null,
  toIso: string | undefined | null
): number | null {
  const from = parseIsoCivilDate(fromIso);
  const to = parseIsoCivilDate(toIso);
  if (from === null || to === null) return null;
  return daysFromCivil(to) - daysFromCivil(from);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE `incomes` HALF (D23b) — AND IT IS NOT `periodOf(date)`
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `incomes` has a THIRD date convention: `month` and `year`, stored as strings, beside a `date`
// that does not have to agree with them. T0 §5 confirmed the mechanism by reading both writers:
//
//   · `Dashboard.handleSaveIncomes` writes `month: selectedMonth, year: selectedYear` FROM THE
//     UI'S CURRENTLY SELECTED FILTER, while `date` is free text the user may edit independently.
//   · `RecurringService`'s income branch derives `date`, `month` and `year` all three from the
//     same period, so ITS rows agree by construction — which is why the divergence is invisible
//     until a human edits one.
//   · `CentralExpenseReport` queries `where('month','==') + where('year','==')`.
//
// So `month`/`year` are what this collection's existing readers already agree on, and a
// `periodOf(date)` backfill would stamp a period disagreeing with a field a live screen queries —
// silently moving rows between months on the Dashboard. Deriving from `month`/`year` cannot do
// that: at worst it reproduces a divergence that is already there and already visible.
//
// The `date`-vs-`month`/`year` divergence itself is NOT fixed here. It is recorded and deferred
// to Stage 11 by name, alongside `transaction_lines.date` normalization (D23b).

/**
 * `'YYYY-MM'` from an `incomes` row's `month`/`year` pair, or `null` when either cannot be read.
 *
 * Accepts numbers as well as strings: `incomes` has no schema, no service layer and no validator
 * in Rules beyond `amount is number`, so a row's `month` may be either. The month is zero-padded
 * on the way out for the same reason `periodOf` pads — a `'YYYY-MM'` period is only useful
 * because plain string comparison IS chronological order.
 *
 * The parameters are `unknown` rather than `string | number | undefined | null`, and that is the
 * honest signature (T3 review F9): the values come off a document in a collection with no schema,
 * and the root tsconfig is not strict, so a narrower declared type would have been a claim the
 * compiler could not keep. The two accepted types are enforced BELOW, at runtime, where the data
 * actually is.
 */
export function periodOfMonthYear(month: unknown, year: unknown): string | null {
  // T3 review F9 — the TYPE gate comes first, and it is the half the regex could not cover.
  // `String(value)` is total: `String([3])` is `'3'`, so an ARRAY `month: [3]` sailed through the
  // `^\d{1,2}$` test and became `'2026-03'` — while this function's own rationale for using a
  // regex rather than a numeric coercion is that a regex REFUSES the shapes a coercion quietly
  // accepts. `Array.prototype.toString` is exactly such a shape. `incomes` has no schema, no
  // service layer and no validator in Rules beyond `amount is number`, so the two types this
  // collection can legitimately hold are named here rather than inferred from what stringifies
  // plausibly.
  if (typeof month !== 'string' && typeof month !== 'number') return null;
  if (typeof year !== 'string' && typeof year !== 'number') return null;
  if (month === '') return null;
  if (year === '') return null;

  const monthStr = String(month).trim();
  const yearStr = String(year).trim();
  // A 4-digit year and a 1-or-2-digit month, and nothing else. `Number('')` is 0 and
  // `Number(' 3 ')` is 3, so a regex rather than a numeric coercion is what refuses `'3.0'`,
  // `'+3'` and `'\u0663'` — the shapes a coercion would quietly accept.
  if (!/^\d{4}$/.test(yearStr)) return null;
  if (!/^\d{1,2}$/.test(monthStr)) return null;

  const monthNum = Number(monthStr);
  if (monthNum < 1 || monthNum > 12) return null;
  return `${yearStr}-${monthStr.padStart(2, '0')}`;
}

/**
 * The `incomes` counterpart of `periodOrUnknown`. Same contract: `'unknown'` is the CALLER's
 * decision, chosen in exactly one place, never invented by the reader.
 */
export function periodOrUnknownFromMonthYear(month: unknown, year: unknown): string {
  return periodOfMonthYear(month, year) ?? UNKNOWN_PERIOD;
}
