// src/utils/recurringCatchup.ts
//
// Pure catch-up logic for the recurring-transactions engine (spec §11, §7 `recurring`). This is
// a LOCAL-first app with no Cloud Functions (spec §15) — there is no server-side scheduler to
// post a recurring transaction on its charge day while the app is closed. Instead: on every app
// open (RecurringService.postDueRecurringTransactions, Task 5), every active recurring item is
// checked against "today" and any period(s) it missed while the app was closed are posted in one
// catch-up pass. This module computes WHICH periods are due; it does no I/O.
//
// A period ('YYYY-MM') is due when:
//   - the item is 'active' (paused/ended items are never due)
//   - the period is >= the item's start period and <= its end period (if any)
//   - the period has not already been posted (> lastPostedPeriod, or from the start period if
//     nothing has ever been posted)
//   - AND, only for the CURRENT period specifically: today's day-of-month has reached chargeDay,
//     where chargeDay is first clamped to the current month's actual length (see below). Every
//     period strictly BEFORE the current one is always due once reached (a fully-elapsed past
//     month's charge is owed regardless of today's date) — only the in-progress current month is
//     gated by chargeDay, so a charge dated the 28th doesn't post on the 1st.
//
// Date-handling note: all comparisons/arithmetic operate on 'YYYY-MM'/'YYYY-MM-DD' strings and
// plain integers (never `new Date(dateString)` parsing, never adding days/months to a Date
// object) — that keeps this immune to timezone/DST skips or repeats. The one place a `Date` is
// read is `today`, via its local-time getters (`getFullYear`/`getMonth`/`getDate`), which is
// exactly the caller's wall-clock "today" — no arithmetic is performed on it.
//
// chargeDay short-month note (Feb, 30-day months) — CLAMPING, bank standing-order semantics:
// chargeDay is clamped to the current month's actual last day via `clampDayToMonth`. A chargeDay
// of 29/30/31 is due on the month's last real day when the month is too short to contain it (e.g.
// chargeDay 31 posts on Feb 28 in a non-leap year, on Feb 29 in a leap year, on the 30th in every
// 30-day month). This mirrors how a bank posts a standing order dated the 31st in a 30-day month:
// on the last day of that month, not deferred to the next. (Earlier revision of this module
// deferred instead — relying on the past-period rule to catch it up the following month — but
// that undermined same-month reporting/forecasting and could yield literal invalid date strings
// like "2026-02-31" at the caller. Reversed per Task 4 review ruling.)

function periodOfDateString(dateStr: string): string {
  return dateStr.slice(0, 7); // 'YYYY-MM-DD' -> 'YYYY-MM'
}

function periodOfDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function comparePeriod(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function nextPeriod(period: string): string {
  const [yearStr, monthStr] = period.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** Every period from `from` to `to` inclusive, ascending. Empty if `from` > `to`. */
function periodsBetween(from: string, to: string): string[] {
  const result: string[] = [];
  let cursor = from;
  while (comparePeriod(cursor, to) <= 0) {
    result.push(cursor);
    cursor = nextPeriod(cursor);
  }
  return result;
}

export interface RecurringCatchupInput {
  status: 'active' | 'paused' | 'ended';
  chargeDay: number;
  startDate: string;
  endDate?: string;
  lastPostedPeriod?: string;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Clamps `day` to the last valid day of `month` (1-12) in `year` — bank standing-order semantics:
 * a charge dated the 31st is due on the 30th in a 30-day month, the 28th (or 29th in a leap year)
 * in February. Pure integer arithmetic — no Date objects — so it can never observe a TZ/DST skip.
 * Exported for callers that stamp a posted transaction's date (e.g. RecurringService), so the
 * stamped date is never an invalid string like '2026-02-31'.
 */
export function clampDayToMonth(year: number, month: number, day: number): number {
  const daysInMonth = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return Math.min(day, daysInMonth);
}

/**
 * Lookback contract: unbounded — this function walks every period from the item's own start (or
 * `lastPostedPeriod + 1`, whichever is later) up to the current period, with no cap on how many
 * periods that spans. That's intentional: it's what makes a legitimate backfill/migration work
 * (e.g. importing a recurring item that's been running for years with no prior posting history).
 * Callers CREATING a new item must seed `lastPostedPeriod` themselves (see
 * `RecurringService.saveRecurring`) unless an unbounded backfill from `startDate` is genuinely
 * intended — this module will not guess at a reasonable lookback window on their behalf.
 */
export function computeDuePeriods(item: RecurringCatchupInput, today: Date): string[] {
  if (item.status !== 'active') return [];

  const currentPeriod = periodOfDate(today);
  const startPeriod = periodOfDateString(item.startDate);
  const endPeriod = item.endDate ? periodOfDateString(item.endDate) : null;

  if (endPeriod && comparePeriod(startPeriod, endPeriod) > 0) return []; // malformed range

  const fromPeriod = item.lastPostedPeriod
    ? (comparePeriod(nextPeriod(item.lastPostedPeriod), startPeriod) > 0 ? nextPeriod(item.lastPostedPeriod) : startPeriod)
    : startPeriod;

  const rangeEnd = endPeriod && comparePeriod(endPeriod, currentPeriod) < 0 ? endPeriod : currentPeriod;
  if (comparePeriod(fromPeriod, rangeEnd) > 0) return [];

  const candidates = periodsBetween(fromPeriod, rangeEnd);
  const todayDay = today.getDate();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth() + 1;

  return candidates.filter((period) => {
    if (comparePeriod(period, currentPeriod) < 0) return true; // fully-elapsed past month — always due
    // current month — gated by chargeDay, clamped to this month's actual length (bank semantics)
    return todayDay >= clampDayToMonth(todayYear, todayMonth, item.chargeDay);
  });
}
