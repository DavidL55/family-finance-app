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

/** −1 / 0 / 1, chronological. Moved verbatim from `recurringCatchup.ts`. */
export function comparePeriod(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The period after `period`, rolling December into the next January. Moved verbatim. */
export function nextPeriod(period: string): string {
  const [yearStr, monthStr] = period.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** Every period from `from` to `to` inclusive, ascending. Empty if `from` > `to`. Moved verbatim. */
export function periodsBetween(from: string, to: string): string[] {
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
 */
export function periodOfMonthYear(
  month: string | number | undefined | null,
  year: string | number | undefined | null
): string | null {
  if (month === undefined || month === null || month === '') return null;
  if (year === undefined || year === null || year === '') return null;

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
export function periodOrUnknownFromMonthYear(
  month: string | number | undefined | null,
  year: string | number | undefined | null
): string {
  return periodOfMonthYear(month, year) ?? UNKNOWN_PERIOD;
}
