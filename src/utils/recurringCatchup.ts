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

// ── STAGE 7 T1 (D22) — THE PERIOD PRIMITIVES MOVED OUT, AND ONE OF THEM WAS REWRITTEN ──────────
//
// `comparePeriod`, `nextPeriod`, `periodsBetween` and `clampDayToMonth` now live in
// `./periodMath` — a MOVE, byte-for-byte, because Stage 7's forecast engine needs the same
// arithmetic and a second copy is how two halves of the app start disagreeing about which month a
// charge falls in. `clampDayToMonth` is RE-EXPORTED below so `RecurringService`'s existing import
// from this module keeps working unchanged.
//
// `periodOfDateString` did NOT move — it is deleted and replaced by `periodOf`. It was
// `dateStr.slice(0, 7)` and had no failure mode at all, which made three malformed-date inputs
// silently wrong here rather than refused:
//
//   startDate ''           -> '' -> nextPeriod('') is '0-NaN', which is a FIXED POINT that always
//                             compares less than the range end: `periodsBetween` never terminated.
//                             This was an unbounded loop, not a wrong answer.
//   startDate '1/6/2026'   -> '1/6/202', which sorts before every real period, so the walk emitted
//                             exactly ['1/6/202'] and the item's real June/July/August charges were
//                             never posted.
//   endDate   'nonsense'   -> 'nonsens', which sorts after every real period, so the end bound was
//                             silently dropped and the item posted as if it never ended.
//
// `periodOf` returns `null` for all three, and a `null` period is folded into the malformed-range
// refusal this function already had. Refusing is the conservative direction for an engine that
// WRITES money: an item whose dates cannot be read is an item whose charges cannot be bounded.
import { clampDayToMonth, comparePeriod, nextPeriod, periodOf, periodsBetween } from './periodMath';

export { clampDayToMonth };

function periodOfDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export interface RecurringCatchupInput {
  status: 'active' | 'paused' | 'ended';
  chargeDay: number;
  startDate: string;
  endDate?: string;
  lastPostedPeriod?: string;
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
  const startPeriod = periodOf(item.startDate);
  const endPeriod = item.endDate ? periodOf(item.endDate) : null;

  // An unreadable date is a malformed range — the same refusal the explicit end-before-start case
  // gets below (D22). Note the root tsconfig is NOT strict, so `string | null` collapses for the
  // compiler and these two checks are the only thing standing between a garbage date and a posted
  // transaction; `recurringCatchup.test.ts`'s "malformed dates" block holds them.
  if (startPeriod === null) return [];
  if (item.endDate && endPeriod === null) return [];

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
