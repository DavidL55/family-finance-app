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
//   - AND, only for the CURRENT period specifically: today's day-of-month has reached chargeDay.
//     Every period strictly BEFORE the current one is always due once reached (a fully-elapsed
//     past month's charge is owed regardless of today's date) — only the in-progress current
//     month is gated by chargeDay, so a charge dated the 28th doesn't post on the 1st.
//
// Date-handling note: all comparisons/arithmetic operate on 'YYYY-MM'/'YYYY-MM-DD' strings and
// plain integers (never `new Date(dateString)` parsing, never adding days/months to a Date
// object) — that keeps this immune to timezone/DST skips or repeats. The one place a `Date` is
// read is `today`, via its local-time getters (`getFullYear`/`getMonth`/`getDate`), which is
// exactly the caller's wall-clock "today" — no arithmetic is performed on it.
//
// chargeDay short-month note (Feb, 30-day months): chargeDay is never clamped to a month's actual
// length. A chargeDay of 29/30/31 simply never reaches `todayDay >= chargeDay` within a month
// that doesn't have that many days, so the current period isn't gated open that month. This
// self-heals via the past-period rule above: once the next month begins, the short month is now
// strictly before the current period and becomes unconditionally due — no special-casing needed.

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

  return candidates.filter((period) => {
    if (comparePeriod(period, currentPeriod) < 0) return true; // fully-elapsed past month — always due
    return todayDay >= item.chargeDay; // current month — gated by chargeDay
  });
}
