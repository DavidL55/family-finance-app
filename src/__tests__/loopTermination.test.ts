// src/__tests__/loopTermination.test.ts — Stage 7, T4 + fix-batch review F-2.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE GUARD THAT WOULD HAVE CAUGHT ALL SIX
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Six instances of ONE shape were found across T1–T4, each one found by a different person, each
// fixed at its own caller, each fix failing to generalise to the next:
//
//   1. `nextPeriod('')` -> `'0-NaN'`, a fixed point; `computeDuePeriods` looped until the heap died
//   2. `previousPeriod('unknown')` -> `'NaN-NaN'`; the demo generator's `asOfDate` refusal
//   3. `chunkPatches(p, 0)` looping on `i += 0`; a real V8 OOM in the fix batch's own sweep
//   4. `horizonPeriods('', 3)`; a real V8 OOM, exit 134
//   5. `projectInsuranceForward(active, '', to)`; the same OOM one function away
//   6. `computeDuePeriods` with a malformed `lastPostedPeriod` — found by the source fix itself,
//      and the clearest evidence for the ruling: it had been terminating BY LEXICOGRAPHIC ACCIDENT
//      (`'N' > '2'`) for four tasks, so it looked exactly like a guarded call site.
//
// Every one of them reduces to the same sentence: **A LOOP'S STEP FUNCTION RETURNED A VALUE THAT
// DID NOT COMPARE AS PROGRESS.** So that is what this file tests — not the six call sites, which
// is what has been done six times, but the property itself, mechanically, over every stepping
// function in the tree and over the malformed inputs this stage has actually observed.
//
// Three assertions, in decreasing generality:
//
//   (A) THE PROGRESS PROPERTY. Every step function either REFUSES its input or returns a value
//       that strictly advances in its declared direction. There is no third outcome, and a fixed
//       point is not a value — it is a hang.
//   (B) THE STRUCTURAL HALF. Period arithmetic exists in exactly one module. Instance 2 was a
//       private copy of `nextPeriod`'s inverse living in `demoCorpus.ts`, inheriting a bug the
//       shared module had already had fixed; nothing could have caught that except a rule about
//       where the arithmetic is allowed to live.
//   (C) THE SIX, BY NAME. Each original input, re-run against the shipped code. These are
//       regressions, not the guard: if only these existed, instance 7 would be found by instance
//       7's own OOM, which is precisely the process this file replaces.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  UNKNOWN_PERIOD,
  comparePeriod,
  isPeriod,
  nextPeriod,
  periodsBetween,
  previousPeriod,
} from '../utils/periodMath';
import { computeDuePeriods } from '../utils/recurringCatchup';
import { chunkPatches, FIRESTORE_BATCH_LIMIT, type PlannedPatch } from '../utils/backfillPlan';
import {
  horizonPeriods,
  projectInsuranceForward,
  projectInstalmentsForward,
  projectLoanForward,
  projectRecurringForward,
  composeForecast,
} from '../utils/forecast';
import { REPO_ROOT, listSourceFiles, stripComments } from './helpers/extractionSurfaces';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (A) THE PROGRESS PROPERTY
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every malformed period this stage has actually observed. `'0-NaN'` and `'NaN-NaN'` are not
 * invented: they are `nextPeriod`'s and `previousPeriod`'s OWN OUTPUTS on `''` and `'unknown'`,
 * which is what made them fixed points and what a corpus of hand-written garbage would have
 * missed. `UNKNOWN_PERIOD` is in the list because it is a REAL value on REAL rows (D21c).
 */
const MALFORMED: string[] = [
  '',
  UNKNOWN_PERIOD,
  '0-NaN',
  'NaN-NaN',
  '1/6/202',
  'nonsens',
  '9999-99',
  '2026-00',
  '2026-13',
  '2026-1',
  '2026',
  '2026-08-01',
  ' 2026-08',
];

const WELL_FORMED: string[] = ['2026-01', '2026-07', '2026-12', '2025-12', '1999-01', '2100-12'];

/**
 * Every function in the tree whose result a loop treats as PROGRESS. `direction` is what "progress"
 * means for it — a step that returns something not strictly beyond its input in that direction is
 * a hang, whatever else it might be.
 *
 * A NEW STEPPING FUNCTION MUST BE ADDED HERE. (B) is what makes that enforceable rather than
 * aspirational: a private one written somewhere else fails the structural assertion instead.
 */
const PERIOD_STEPS: Array<{ name: string; step: (period: string) => string; direction: 'forward' | 'backward' }> = [
  { name: 'nextPeriod', step: nextPeriod, direction: 'forward' },
  { name: 'previousPeriod', step: previousPeriod, direction: 'backward' },
];

describe('(A) THE PROGRESS PROPERTY — a step either refuses, or strictly advances. There is no third outcome', () => {
  for (const { name, step, direction } of PERIOD_STEPS) {
    it(`${name} strictly advances ${direction} on every well-formed period`, () => {
      for (const period of WELL_FORMED) {
        const stepped = step(period);
        const moved = direction === 'forward' ? comparePeriod(stepped, period) : comparePeriod(period, stepped);
        expect(moved, `${name}(${period}) = ${stepped} did not advance ${direction}`).toBe(1);
        expect(isPeriod(stepped), `${name}(${period}) = ${stepped} is not itself a period`).toBe(true);
      }
    });

    it(`${name} REFUSES every malformed period — it never returns a non-advancing value`, () => {
      for (const period of MALFORMED) {
        let outcome: 'refused' | string;
        try {
          outcome = step(period);
        } catch {
          outcome = 'refused';
        }
        expect(outcome, `${name}(${JSON.stringify(period)}) returned a value instead of refusing`).toBe('refused');
      }
    });

    it(`${name} is a fixed point for NOTHING — the property instance 1 violated`, () => {
      // `nextPeriod('')` was `'0-NaN'` and `nextPeriod('0-NaN')` was `'0-NaN'` again. A step whose
      // output equals its input is the entire bug, expressed in one comparison.
      for (const period of [...WELL_FORMED, ...MALFORMED]) {
        let stepped: string | null = null;
        try {
          stepped = step(period);
        } catch {
          continue; // refused — the other acceptable outcome
        }
        expect(stepped, `${name}(${JSON.stringify(period)}) is a FIXED POINT`).not.toBe(period);
      }
    });
  }

  it('periodsBetween cannot be made to walk forever, from either end', () => {
    // The consumer of the step, held to the same property. Both bounds, because `from` after `to`
    // returns [] without stepping at all — so an unvalidated `to` produces an EMPTY window, which
    // renders identically to a window with nothing in it.
    for (const period of MALFORMED) {
      expect(() => periodsBetween(period, '2026-12'), `from = ${JSON.stringify(period)}`).toThrow();
      expect(() => periodsBetween('2026-01', period), `to = ${JSON.stringify(period)}`).toThrow();
    }
  });

  it('chunkPatches makes strict progress or refuses — instance 3, as the same property', () => {
    // Not period arithmetic, and that is the point: the shape is about STEPS, not about calendars.
    // A zero or negative `size` means `i += size` never advances and the loop pushes until the
    // heap dies, which is exactly what it did in the fix batch's own mutation sweep.
    const patches: PlannedPatch[] = [1, 2, 3, 4, 5].map((n) => ({
      collection: 'transaction_lines',
      id: `r${String(n)}`,
      patch: { period: '2026-08' },
      why: 'a chunking fixture',
    }));
    for (const size of [0, -1, -400, 0.5, Number.NaN, Number.POSITIVE_INFINITY, FIRESTORE_BATCH_LIMIT + 1]) {
      expect(() => chunkPatches(patches, size), `size ${String(size)}`).toThrow();
    }
    for (const size of [1, 2, 5, 400, FIRESTORE_BATCH_LIMIT]) {
      const chunks = chunkPatches(patches, size);
      expect(chunks.flat()).toHaveLength(patches.length);
      expect(chunks.length * size, `size ${String(size)} did not cover the input`).toBeGreaterThanOrEqual(patches.length);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (B) THE STRUCTURAL HALF — period arithmetic lives in exactly one module
// ─────────────────────────────────────────────────────────────────────────────────────────────

const PERIOD_MATH_MODULE = 'src/utils/periodMath.ts';

/**
 * THE MONTH ROLLOVER — the one line every copy of period arithmetic has to contain, in either
 * direction: `month === 12 ?` to roll December into January, `month === 1 ?` to roll back.
 *
 * Chosen over the more obvious `split('-')` + `padStart(2, '0')` pair after that pair produced a
 * FALSE POSITIVE on `RecurringService.ts`'s posted-date builder, which assembles a `YYYY-MM-DD`
 * date and is not period arithmetic at all. An over-approximating structural guard that fails on
 * innocent code is not a safe direction, it is a guard people delete — the same correction the fix
 * batch's F2 had to make to its first alias rule.
 *
 * Comment-stripped, because the prose in `periodMath.ts` and in this file discusses the rollover
 * at length and a guard that flags its own documentation is useless.
 */
function filesRollingTheMonthOver(): string[] {
  const roots = [join(REPO_ROOT, 'src'), join(REPO_ROOT, 'scripts')];
  const hits: string[] = [];
  for (const root of roots) {
    for (const file of listSourceFiles(root)) {
      const rel = relative(REPO_ROOT, file);
      if (rel.includes('__tests__')) continue;
      const source = stripComments(readFileSync(file, 'utf8'), rel);
      if (/month === 1 \?|month === 12 \?/.test(source)) hits.push(rel);
    }
  }
  return hits.sort();
}

/**
 * The CLAMP idiom — `comparePeriod(a, b) >= 0 ? a : b` and its three siblings. `comparePeriod` is
 * deliberately total, so a hand-written clamp is total too: on a malformed operand it does not
 * fail, IT QUIETLY PICKS ONE. The T4 review described instance 4's reachability in exactly those
 * words — "the clamp does not fire" — so the clamp is its own class and gets its own rule.
 */
function filesClampingByHand(): string[] {
  const roots = [join(REPO_ROOT, 'src'), join(REPO_ROOT, 'scripts')];
  const hits: string[] = [];
  for (const root of roots) {
    for (const file of listSourceFiles(root)) {
      const rel = relative(REPO_ROOT, file);
      if (rel.includes('__tests__')) continue;
      const source = stripComments(readFileSync(file, 'utf8'), rel);
      if (/comparePeriod\([^;]*\)\s*[<>]=?\s*0\s*\?/.test(source)) hits.push(rel);
    }
  }
  return hits.sort();
}

describe('(B) THE STRUCTURAL HALF — instance 2 was a PRIVATE COPY, and nothing else could have seen it', () => {
  it('the month rollover exists in exactly one module', () => {
    // `demoCorpus.ts` carried its own `previousPeriod` for a whole task — "`periodMath` exports
    // only `nextPeriod`; this is its inverse" — and it inherited the identical `'NaN-NaN'` defect
    // the shared module had already been reviewed for.
    //
    // !! AND WRITING THIS ASSERTION FOUND A THIRD COPY NOBODY HAD NAMED:
    // `RecurringService.periodBeforeToday`, whose own comment justified the duplicate — "kept
    // local to this module rather than imported from `recurringCatchup.ts`, which does not export
    // a 'previous period' helper". True when written, false ever since `periodMath` gained one,
    // and nothing in the tree could notice the difference. It now delegates.
    expect(filesRollingTheMonthOver()).toEqual([PERIOD_MATH_MODULE]);
  });

  it('the clamp is written in exactly one module too — the second class, and the quieter one', () => {
    // `comparePeriod(a, b) >= 0 ? a : b` is TOTAL, because `comparePeriod` is. On a malformed
    // operand it silently picks a side: `boundedWindow` discarded the caller's `fromPeriod` and
    // projected from the item's own start — silently WIDENING the window its own header promises
    // never to widen — and `composeForecast`'s D32(a) clamp "did not fire", which is the sentence
    // the T4 review used to prove the horizon hang was reachable.
    expect(filesClampingByHand()).toEqual([PERIOD_MATH_MODULE]);
  });

  it('!! NEITHER GUARD IS VACUOUS — both find the real thing they are looking for', () => {
    // The failure mode of every structural guard in this repo: passing because it matched nothing.
    expect(filesRollingTheMonthOver()).toContain(PERIOD_MATH_MODULE);
    expect(filesClampingByHand()).toContain(PERIOD_MATH_MODULE);
  });

  it('they would have caught instances 2 and 4 — both deleted bodies, reconstructed verbatim', () => {
    // A guard is only as good as the thing it is shown to catch, so it is shown catching them.
    const deletedCopy = "  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;";
    expect(/month === 1 \?|month === 12 \?/.test(deletedCopy)).toBe(true);
    const deletedClamp = 'const windowStart = comparePeriod(fromPeriod, start) >= 0 ? fromPeriod : start;';
    expect(/comparePeriod\([^;]*\)\s*[<>]=?\s*0\s*\?/.test(deletedClamp)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (C) THE SIX, BY NAME — each original input, re-run against the shipped code
// ─────────────────────────────────────────────────────────────────────────────────────────────

const ACTIVE_INSURANCE = { id: 'i1', provider: 'p', premium: 100, premiumFrequency: 'monthly' as const, status: 'active' as const };
const ACTIVE_RECURRING = {
  id: 'r1', description: 'd', category: 'c', amount: 100, chargeDay: 5,
  status: 'active' as const, kind: 'expense' as const, startDate: '2026-01-01', endDate: undefined,
};
const ACTIVE_LOAN = { id: 'l1', name: 'l', monthlyPayment: 100, startDate: '2026-01-01', endDate: '2030-01-01', status: 'active' as const };

describe('(C) THE SIX INSTANCES, BY NAME — every one of them refuses now', () => {
  it('1. computeDuePeriods with an empty startDate — the T1 heap death', () => {
    expect(computeDuePeriods({ status: 'active', chargeDay: 1, startDate: '' }, new Date(2026, 7, 15))).toEqual([]);
  });

  it("2. previousPeriod('unknown') — the T4 asOfDate refusal, now closed at the source", () => {
    expect(() => previousPeriod(UNKNOWN_PERIOD)).toThrow(/previousPeriod/);
  });

  it('3. chunkPatches(p, 0) — the fix batch, i += 0', () => {
    expect(() => chunkPatches([], 0)).toThrow();
  });

  it("4. horizonPeriods('', 3) — a real V8 OOM, exit 134, and NO NEW REFUSAL WAS ADDED HERE", () => {
    // `horizonPeriods` validates `months` exhaustively and cites the `computeDuePeriods` heap
    // death by name while doing it, then leaves `anchorPeriod` unvalidated. It STILL does — the
    // refusal below comes from `nextPeriod`, one frame down. That is the ruling: the seventh
    // per-caller guard was not written.
    expect(() => horizonPeriods('', 3)).toThrow(/nextPeriod|periodsBetween/);
    expect(() => horizonPeriods(UNKNOWN_PERIOD, 3)).toThrow();
    expect(horizonPeriods('2026-08', 3)).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it("5. projectInsuranceForward(active, '', to) — the same OOM, one function away", () => {
    expect(() => projectInsuranceForward(ACTIVE_INSURANCE, '', '2026-10')).toThrow(/periodsBetween/);
  });

  it('6. computeDuePeriods with a malformed lastPostedPeriod — the one that terminated by accident', () => {
    expect(
      computeDuePeriods({ status: 'active', chargeDay: 1, startDate: '2026-01-01', lastPostedPeriod: 'rubbish' }, new Date(2026, 7, 15))
    ).toEqual([]);
  });

  it('!! composeForecast — the reachable path, with BOTH anchor and today malformed', () => {
    // The review's proof that instance 4 was live and not theoretical: `composeForecast` validates
    // neither `anchorPeriod` nor `todayPeriod`, so if both arrive `''` the forward clamp does not
    // fire (`comparePeriod('','')` is 0) and the horizon walks forever. ON T5'S PATH THIS HANGS A
    // BROWSER TAB, NOT A TEST WORKER.
    expect(comparePeriod('', '')).toBe(0); // the clamp does not fire — the precondition of the hang
    expect(() => composeForecast({ anchorPeriod: '', todayPeriod: '', lineItems: [] })).toThrow();
    expect(() => composeForecast({ anchorPeriod: UNKNOWN_PERIOD, todayPeriod: UNKNOWN_PERIOD, lineItems: [] })).toThrow();
  });

  it('!! THE CLAMP CASES THE MUTATION SWEEP CAUGHT — a malformed operand SILENTLY WINS OR LOSES', () => {
    // Both of these survived the first sweep, and both are real: the hand-written
    // `comparePeriod(a, b) ? a : b` never fails on a malformed operand, it picks a side by
    // accident, and the accident goes the OTHER WAY for `''` than for `'unknown'`.
    //
    // (a) `composeForecast` with a malformed anchor and a VALID today. The old clamp computed
    //     `comparePeriod('', '2026-08') < 0` => true, so it replaced the anchor with today and
    //     reported `anchorClamped: true` — a garbage month rendered as "we moved your selection
    //     forward". Nothing threw, nothing was logged, and the screen showed a confident forecast.
    expect(comparePeriod('', '2026-08')).toBe(-1); // the accident that made it silent
    expect(() => composeForecast({ anchorPeriod: '', todayPeriod: '2026-08', lineItems: [] })).toThrow(/laterPeriod: a /);
    expect(() => composeForecast({ anchorPeriod: '2026-08', todayPeriod: UNKNOWN_PERIOD, lineItems: [] })).toThrow(/laterPeriod: b /);

    // (b) `projectRecurringForward` on a BOUNDED item with a malformed `toPeriod`. The old clamp
    //     computed `comparePeriod('2026-05', 'unknown') < 0` => true, kept the item's own end date
    //     as the window end, and returned FIVE PLAUSIBLE LINE ITEMS for a window nobody asked for.
    //     The unbounded case threw one frame later, which is exactly why this survived: the guard
    //     had evidence, just not on the path that could hide it.
    expect(comparePeriod('2026-05', UNKNOWN_PERIOD)).toBe(-1); // the accident, the other way round
    const bounded = { ...ACTIVE_RECURRING, endDate: '2026-05-31' };
    expect(() => projectRecurringForward(bounded, '2026-01', UNKNOWN_PERIOD)).toThrow(/earlierPeriod: b /);
    expect(projectRecurringForward(bounded, '2026-01', '2026-10').map((i) => i.period)).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
    ]);
  });

  it('!! ALL FOUR FORWARD PROJECTORS ANSWER A MALFORMED WINDOW THE SAME WAY — none returns a plausible empty list', () => {
    // Three of the four inherit the refusal through `periodsBetween`. `projectInstalmentsForward`
    // does not walk a window at all (its loop is bounded by `totalInstallments`), so it could not
    // hang — it returned `[]`, which on a forecast screen is indistinguishable from "this plan has
    // finished paying". Same input, same answer, across the whole layer.
    const rows = [{ date: '2026-01-15', amount: 500, installmentNumber: 1, totalInstallments: 6 }];
    for (const bad of ['', UNKNOWN_PERIOD, '2026-13']) {
      expect(() => projectRecurringForward(ACTIVE_RECURRING, bad, '2026-10'), `recurring, ${bad}`).toThrow();
      expect(() => projectLoanForward(ACTIVE_LOAN, bad, '2026-10'), `loan, ${bad}`).toThrow();
      expect(() => projectInsuranceForward(ACTIVE_INSURANCE, bad, '2026-10'), `insurance, ${bad}`).toThrow();
      expect(() => projectInstalmentsForward(rows, bad, '2026-10'), `instalments, ${bad}`).toThrow();
      expect(() => projectInstalmentsForward(rows, '2026-02', bad), `instalments to, ${bad}`).toThrow();
    }
  });
});
