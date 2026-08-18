// Stage 7 T1 — src/utils/forecast.ts, the pure forecast core.
//
// THE TEST THAT MATTERS MOST IS `resolveLayerPrecedence` SHUFFLE-INVARIANCE (D20). Two members can
// hold assumptions colliding on the same (period, category). Without a total order the winner is
// whatever order Firestore happened to return — non-deterministic money on the headline number,
// which no reader could ever reproduce or dispute. That test outranks the layer↔basis
// correspondence one, which D19 deleted the need for by deriving `layer` instead of storing it.
//
// THE SECOND MOST IMPORTANT IS THE A9 REGRESSION. `computeDuePeriods` hard-caps its range at the
// CURRENT period, so for any future month it returns `[]`. A literal reading of "reuse it" ships a
// certain layer that is EMPTY IN EVERY FORECAST MONTH, with green tests, because the line items are
// absent rather than wrong. `projectRecurringForward` is a genuinely new function, and the
// regression test asserts it is non-empty exactly where `computeDuePeriods` is empty.
//
// Every predicate below was written STUB-FIRST — the module returned empty for every export and
// this file was run red before a line of the implementation existed. On today's tree
// `forecast_assumptions` is empty, `transaction_lines` holds 3 rows in 1 month, and no forecast
// surface exists, so EVERY predicate here is shadowed by construction: there is no corpus that
// could have failed it. Synthetic inputs are the only thing standing behind these guards, which is
// why they are built to be adversarial rather than illustrative.
import { describe, expect, it } from 'vitest';
import { CATEGORY_MAP } from '../utils/categoryMap';
import {
  CATEGORY_INSURANCE,
  CATEGORY_LOAN_REPAYMENT,
  CATEGORY_OTHER,
  DEFAULT_HORIZON_MONTHS,
  MAX_HORIZON_MONTHS,
  STALENESS_CURRENT_MAX_DAYS,
  STALENESS_STALE_MAX_DAYS,
  composeForecast,
  computeOpeningBalance,
  horizonPeriods,
  layerOf,
  projectInstalmentsForward,
  projectInsuranceForward,
  projectLoanForward,
  projectRecurringForward,
  resolveCategoryOfScope,
  projectedBalanceByPeriod,
  resolveLayerPrecedence,
  readObservedAmount,
  totalObservedILS,
} from '../utils/forecast';
import type { ForecastBasis, ForecastLineItem } from '../utils/forecast';
import { computeDuePeriods } from '../utils/recurringCatchup';
import {
  AIG_CAR_INSURANCE_PLAN,
  COLLIDING_PLANS,
  TOTAL_WITHOUT_NUMBER_ROW,
} from './fixtures/instalmentPlan';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────────────────────

const RENT = {
  id: 'rec-rent',
  description: 'שכר דירה',
  category: 'מגורים ובית',
  amount: 5000,
  chargeDay: 10,
  status: 'active' as const,
  kind: 'expense' as const,
  startDate: '2025-01-01',
};

/** A deterministic shuffle, so a failure is reproducible rather than "it went red on CI once". */
function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function assumption(
  over: Partial<{ id: string; source: 'user' | 'insight'; updatedAt: string; amount: number }>
): ForecastLineItem {
  return {
    period: '2026-10',
    categoryId: 'מזון וצריכה',
    direction: 'expense',
    amountILS: over.amount ?? 1000,
    basis: {
      kind: 'assumption',
      assumptionId: over.id ?? 'a1',
      source: over.source ?? 'user',
      updatedAt: over.updatedAt ?? '2026-08-01T00:00:00.000Z',
      overrides: [],
    },
  };
}

function movingAverage(amount: number, period = '2026-10', categoryId = 'מזון וצריכה'): ForecastLineItem {
  return {
    period,
    categoryId,
    direction: 'expense',
    amountILS: amount,
    basis: {
      kind: 'movingAverage',
      monthsObserved: 6,
      periods: ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'],
      seasonalFactor: null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D19 — the provenance union: `layer` is DERIVED, never stored
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('layerOf — derived at render, never a field (D19)', () => {
  it('maps the four contractual bases to the certain layer', () => {
    expect(layerOf({ kind: 'recurring', recurringId: 'r', description: 'd', chargeDay: 1 })).toBe('certain');
    expect(layerOf({ kind: 'loan', loanId: 'l', name: 'משכנתא' })).toBe('certain');
    expect(layerOf({ kind: 'insurance', insuranceId: 'i', provider: 'AIG' })).toBe('certain');
    expect(layerOf({ kind: 'installment', planKey: 'p', observedNumber: 3, totalInstallments: 6 })).toBe('certain');
  });

  it('maps a moving average to the statistical layer', () => {
    expect(layerOf(movingAverage(100).basis)).toBe('statistical');
  });

  it('maps an assumption to the assumption layer', () => {
    expect(layerOf(assumption({}).basis)).toBe('assumption');
  });

  it('THROWS on an unrecognised basis kind rather than defaulting to a layer', () => {
    // The mutation this exists for: replacing the exhaustive switch with
    // `basis.kind === 'assumption' ? 'assumption' : 'certain'`. That compiles, passes every test
    // above, and silently relabels a NEW basis kind added in T5/T6 as CERTAIN — i.e. renders an
    // estimate as a contractual fact, with no band, in the layer this stage says has no band.
    // The compiler's `never` check catches it at build time; this catches it at runtime, and the
    // two together are what make adding a union member impossible to do quietly.
    expect(() => layerOf({ kind: 'לא קיים' } as unknown as ForecastBasis)).toThrow(/basis kind/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D19 — the scopeId -> category mapping, without which `overrides` is unreachable
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('resolveCategoryOfScope — the mapping that makes an override reachable at all (D19)', () => {
  const certainItems: ForecastLineItem[] = [
    {
      period: '2026-10',
      categoryId: 'מגורים ובית',
      direction: 'expense',
      amountILS: 5000,
      basis: { kind: 'recurring', recurringId: 'rec-rent', description: 'שכר דירה', chargeDay: 10 },
    },
    {
      period: '2026-10',
      categoryId: CATEGORY_OTHER,
      direction: 'expense',
      amountILS: 90,
      basis: { kind: 'recurring', recurringId: 'rec-uncat', description: 'משהו', chargeDay: 3 },
    },
  ];

  it("maps a recurring scope to that item's own category", () => {
    expect(resolveCategoryOfScope('recurring', 'rec-rent', certainItems)).toBe('מגורים ובית');
  });

  it('maps an uncategorised recurring item to CATEGORY_OTHER', () => {
    expect(resolveCategoryOfScope('recurring', 'rec-uncat', certainItems)).toBe(CATEGORY_OTHER);
  });

  it('maps a loan scope to the named loan-repayment category', () => {
    expect(resolveCategoryOfScope('loan', 'loan-1', certainItems)).toBe(CATEGORY_LOAN_REPAYMENT);
  });

  it('maps an insurance scope to the named insurance category', () => {
    expect(resolveCategoryOfScope('insurance', 'ins-1', certainItems)).toBe(CATEGORY_INSURANCE);
  });

  it('maps a category scope to itself', () => {
    expect(resolveCategoryOfScope('category', 'בריאות', certainItems)).toBe('בריאות');
  });

  it('returns null for a recurring scope with no matching certain item — never a guessed category', () => {
    expect(resolveCategoryOfScope('recurring', 'no-such-item', certainItems)).toBeNull();
  });

  it('THE OVERRIDE IS REACHABLE: a loan-scoped assumption lands in the same bucket as the loan\'s own certain item', () => {
    // This is the test D19 exists for. Assumptions are keyed by (scopeKind, scopeId); precedence
    // resolves by (period, category). Without the mapping the two NEVER share a key, so an
    // assumption can never override a certain item — and D2's most valuable disclosure would never
    // fire while a test on a hand-built fixture passed. Asserting the mapping in isolation is not
    // enough; this drives it end to end, from the projector's own output through the resolver.
    const loanLine = projectLoanForward(
      { id: 'loan-1', name: 'משכנתא', monthlyPayment: 4200, startDate: '2020-01-01', endDate: '2030-01-31', status: 'active' },
      '2026-10',
      '2026-10'
    )[0];

    const mappedCategory = resolveCategoryOfScope('loan', 'loan-1', [loanLine]);
    expect(mappedCategory).toBe(loanLine.categoryId);

    const loanAssumption: ForecastLineItem = {
      period: loanLine.period,
      categoryId: mappedCategory as string,
      direction: 'expense',
      amountILS: 4500, // the family knows the rate resets in October
      basis: { kind: 'assumption', assumptionId: 'a-loan', source: 'user', updatedAt: '2026-08-01T00:00:00.000Z', overrides: [] },
    };

    const resolved = resolveLayerPrecedence([loanLine, loanAssumption]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].amountILS).toBe(4500);
    // …and the loan is recorded underneath, by name, so the card can show both numbers.
    const basis = resolved[0].basis;
    expect(basis.kind === 'assumption' && basis.overrides).toEqual([
      { kind: 'loan', loanId: 'loan-1', name: 'משכנתא' },
    ]);
  });

  it('CATEGORY_OTHER is byte-identical to the default RecurringService already writes', () => {
    // RecurringService.ts stamps `category: item.category ?? 'שונות'` on every autoposted row. If
    // this constant drifts from that literal, a recurring item with no category produces a certain
    // line in one bucket and its own posted rows in another, and the double-count disclosure D23
    // promises silently stops lining up.
    expect(CATEGORY_OTHER).toBe(CATEGORY_MAP.General_Misc);
  });

  it('CATEGORY_INSURANCE is a real category from the extraction taxonomy, not a new string', () => {
    expect(CATEGORY_INSURANCE).toBe(CATEGORY_MAP.Insurance_Pension);
  });

  it('CATEGORY_LOAN_REPAYMENT is deliberately NOT in the extraction taxonomy', () => {
    // Stated as a property so it cannot be "tidied" into CATEGORY_MAP by a later task without a
    // test going red. There is no loan category in the extraction taxonomy because a bank
    // statement's loan debit lands in whatever category the extractor picked — which is exactly why
    // D23 discloses the loan double-count instead of fixing it. Merging the two buckets would hide
    // the duplicate this stage promises to show.
    expect(Object.values(CATEGORY_MAP)).not.toContain(CATEGORY_LOAN_REPAYMENT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D22 — the forward projector. THE A9 REGRESSION.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('projectRecurringForward — a NEW function, because computeDuePeriods cannot project forward (D22, A9)', () => {
  it('THE A9 REGRESSION: non-empty for a future month where computeDuePeriods returns []', () => {
    // `recurringCatchup.ts` caps its range end at the CURRENT period. Reusing it for the certain
    // layer ships a forecast whose certain layer is empty in every forecast month — and the tests
    // pass, because the line items are simply absent rather than wrong. This is the single
    // assertion that makes that impossible to ship.
    const today = new Date(2026, 7, 15); // 2026-08
    const catchup = computeDuePeriods({ ...RENT, lastPostedPeriod: '2026-08' }, today);
    expect(catchup).toEqual([]);

    const projected = projectRecurringForward(RENT, '2026-09', '2026-11');
    expect(projected.map((i) => i.period)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(projected.every((i) => i.amountILS === 5000)).toBe(true);
  });

  it('ignores lastPostedPeriod entirely — that is a catch-up concept, not a forecast one', () => {
    // Whether September's charge has been posted yet says nothing about whether October's is
    // coming. `lastPostedPeriod` is not even in `RecurringProjectionInput`, and a real
    // `RecurringItem` carrying one must project identically.
    const carriesHistory = { ...RENT, lastPostedPeriod: '2027-12' };
    const withHistory = projectRecurringForward(carriesHistory, '2026-09', '2026-10');
    const without = projectRecurringForward(RENT, '2026-09', '2026-10');
    expect(withHistory).toEqual(without);
  });

  it('projects nothing for a paused or ended item', () => {
    expect(projectRecurringForward({ ...RENT, status: 'paused' }, '2026-09', '2026-11')).toEqual([]);
    expect(projectRecurringForward({ ...RENT, status: 'ended' }, '2026-09', '2026-11')).toEqual([]);
  });

  it('does not project before the item starts', () => {
    const projected = projectRecurringForward({ ...RENT, startDate: '2026-10-01' }, '2026-09', '2026-11');
    expect(projected.map((i) => i.period)).toEqual(['2026-10', '2026-11']);
  });

  it('does not project after the item ends, inclusive of the end month', () => {
    const projected = projectRecurringForward({ ...RENT, endDate: '2026-10-31' }, '2026-09', '2026-12');
    expect(projected.map((i) => i.period)).toEqual(['2026-09', '2026-10']);
  });

  it('projects nothing when the dates cannot be read — never a guessed range', () => {
    expect(projectRecurringForward({ ...RENT, startDate: 'nonsense' }, '2026-09', '2026-11')).toEqual([]);
    expect(projectRecurringForward({ ...RENT, endDate: '2026/10/31' }, '2026-09', '2026-11')).toEqual([]);
  });

  it('clamps chargeDay into each projected month separately — bank standing-order semantics', () => {
    const projected = projectRecurringForward({ ...RENT, chargeDay: 31 }, '2027-01', '2027-04');
    const days = projected.map((i) => (i.basis.kind === 'recurring' ? i.basis.chargeDay : -1));
    expect(days).toEqual([31, 28, 31, 30]); // Jan, Feb (2027 non-leap), Mar, Apr
  });

  it('clamps into a LEAP February', () => {
    const projected = projectRecurringForward({ ...RENT, chargeDay: 31 }, '2028-02', '2028-02');
    expect(projected[0].basis.kind === 'recurring' && projected[0].basis.chargeDay).toBe(29);
  });

  it("carries the item's own category, falling back to CATEGORY_OTHER", () => {
    expect(projectRecurringForward(RENT, '2026-09', '2026-09')[0].categoryId).toBe('מגורים ובית');
    const uncategorised = { ...RENT, category: undefined };
    expect(projectRecurringForward(uncategorised, '2026-09', '2026-09')[0].categoryId).toBe(CATEGORY_OTHER);
  });

  it('carries direction from `kind` — a recurring INCOME item is income, not a negative expense', () => {
    // D23/A10: recurring income posts into `incomes`, not `transaction_lines`. It is still a
    // certain forward-projected line, and getting its direction wrong would flip the sign of the
    // headline balance rather than change a label.
    const salary = { ...RENT, id: 'rec-salary', kind: 'income' as const, amount: 18000 };
    const projected = projectRecurringForward(salary, '2026-09', '2026-09');
    expect(projected[0].direction).toBe('income');
    expect(projected[0].amountILS).toBe(18000); // positive; `direction` carries the sign, not the number
  });

  it('returns [] when the window itself is inverted', () => {
    expect(projectRecurringForward(RENT, '2026-11', '2026-09')).toEqual([]);
  });
});

describe('projectLoanForward (D22)', () => {
  const MORTGAGE = {
    id: 'loan-1',
    name: 'משכנתא',
    monthlyPayment: 4200,
    startDate: '2020-01-01',
    endDate: '2026-11-30',
    status: 'active' as const,
  };

  it('projects the monthly payment through the payoff month, inclusive', () => {
    const projected = projectLoanForward(MORTGAGE, '2026-09', '2027-02');
    expect(projected.map((i) => i.period)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(projected.every((i) => i.amountILS === 4200)).toBe(true);
    expect(projected.every((i) => i.categoryId === CATEGORY_LOAN_REPAYMENT)).toBe(true);
    expect(projected.every((i) => i.direction === 'expense')).toBe(true);
  });

  it('projects nothing for a paid-off loan', () => {
    expect(projectLoanForward({ ...MORTGAGE, status: 'paid-off' }, '2026-09', '2026-10')).toEqual([]);
  });

  it('does not project before the loan starts', () => {
    expect(projectLoanForward({ ...MORTGAGE, startDate: '2026-10-01' }, '2026-09', '2026-11').map((i) => i.period))
      .toEqual(['2026-10', '2026-11']);
  });

  it('projects nothing when either date cannot be read', () => {
    expect(projectLoanForward({ ...MORTGAGE, endDate: '' }, '2026-09', '2026-10')).toEqual([]);
  });

  it('carries the loan NAME on the basis — D23 renders the certain layer itemised by name so a human can spot the double count', () => {
    const projected = projectLoanForward(MORTGAGE, '2026-09', '2026-09');
    expect(projected[0].basis).toEqual({ kind: 'loan', loanId: 'loan-1', name: 'משכנתא' });
  });
});

describe('projectInsuranceForward — monthly-equivalent, and the choice is stated (D22)', () => {
  const YEARLY = {
    id: 'ins-1',
    provider: 'AIG',
    premium: 1704,
    premiumFrequency: 'yearly' as const,
    status: 'active' as const,
  };

  it('divides a yearly premium by 12 rather than charging it once', () => {
    // The Stage 6 ledger's glossary item 18: the same policy already renders as two different
    // numbers on one screen. The forecast picks monthly-equivalent and says so; charging ₪1,704 in
    // one month would put a spike in the certain layer that the family will never see on a
    // statement.
    const projected = projectInsuranceForward(YEARLY, '2026-09', '2026-11');
    expect(projected.map((i) => i.period)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(projected.every((i) => i.amountILS === 142)).toBe(true);
  });

  it('passes a monthly premium through unchanged', () => {
    const projected = projectInsuranceForward({ ...YEARLY, premium: 142, premiumFrequency: 'monthly' }, '2026-09', '2026-09');
    expect(projected[0].amountILS).toBe(142);
  });

  it('projects nothing for a lapsed or cancelled policy', () => {
    expect(projectInsuranceForward({ ...YEARLY, status: 'lapsed' }, '2026-09', '2026-10')).toEqual([]);
    expect(projectInsuranceForward({ ...YEARLY, status: 'cancelled' }, '2026-09', '2026-10')).toEqual([]);
  });

  it('lands in the named insurance category and carries the provider', () => {
    const projected = projectInsuranceForward(YEARLY, '2026-09', '2026-09');
    expect(projected[0].categoryId).toBe(CATEGORY_INSURANCE);
    expect(projected[0].basis).toEqual({ kind: 'insurance', insuranceId: 'ins-1', provider: 'AIG' });
  });
});

describe('projectInstalmentsForward (D10)', () => {
  it('projects only the instalments after the highest observed number, capped at the horizon', () => {
    // Payment 3 of 6 observed in 2025-12 implies payments 4, 5 and 6 in 2026-01..03.
    const projected = projectInstalmentsForward([AIG_CAR_INSURANCE_PLAN], '2026-01', '2026-12');
    expect(projected.map((i) => i.period)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(projected.every((i) => i.amountILS === 284)).toBe(true);
    expect(projected.map((i) => (i.basis.kind === 'installment' ? i.basis.observedNumber : -1))).toEqual([3, 3, 3]);
  });

  it('does not double-count on re-import — a second observation of the same plan advances the floor', () => {
    const laterRow = { ...AIG_CAR_INSURANCE_PLAN, date: '2026-01-30', installmentNumber: 4 };
    const projected = projectInstalmentsForward([AIG_CAR_INSURANCE_PLAN, laterRow], '2026-01', '2026-12');
    expect(projected.map((i) => i.period)).toEqual(['2026-02', '2026-03']);
  });

  it('is unaffected by the order the observed rows arrive in', () => {
    const laterRow = { ...AIG_CAR_INSURANCE_PLAN, date: '2026-01-30', installmentNumber: 4 };
    const a = projectInstalmentsForward([AIG_CAR_INSURANCE_PLAN, laterRow], '2026-01', '2026-12');
    const b = projectInstalmentsForward([laterRow, AIG_CAR_INSURANCE_PLAN], '2026-01', '2026-12');
    expect(b).toEqual(a);
  });

  it('projects NOTHING for a row whose installmentNumber is null — the fourth shadowed path', () => {
    // FileProcessor writes `installmentNumber: item.installmentNumber ?? null`. A `!== undefined`
    // check reads that `null` as PRESENT and then projects from `NaN`. There is no instance of this
    // shape anywhere in the corpus, so this fixture is the only thing that can exercise it.
    expect(projectInstalmentsForward([TOTAL_WITHOUT_NUMBER_ROW], '2026-01', '2026-12')).toEqual([]);
  });

  it('projects nothing once the plan is complete', () => {
    const done = { ...AIG_CAR_INSURANCE_PLAN, installmentNumber: 6 };
    expect(projectInstalmentsForward([done], '2026-01', '2026-12')).toEqual([]);
  });

  it('projects nothing when the observed row\'s own date cannot be read', () => {
    const unreadable = { ...AIG_CAR_INSURANCE_PLAN, date: '2025/12/30' };
    expect(projectInstalmentsForward([unreadable], '2026-01', '2026-12')).toEqual([]);
  });

  it('KNOWN WRONG, DOCUMENTED: two identical-looking plans from one vendor collide into one', () => {
    // There is no plan id in the data, so planKey = f(vendor, totalInstallments, amount). These two
    // real, separate ₪300×4 IKEA plans a month apart are indistinguishable under that key: the
    // later observation (number 1, in February) is taken as the floor for BOTH, so the January
    // plan's remaining payments are silently dropped and the family is under-projected by ₪900.
    // This assertion documents the wrong output on purpose — it is R5's evidence, and it goes red
    // the day someone changes the heuristic, which is when the hover copy must change too.
    const projected = projectInstalmentsForward(COLLIDING_PLANS, '2026-01', '2026-12');
    const keys = new Set(projected.map((i) => (i.basis.kind === 'installment' ? i.basis.planKey : '')));
    expect(keys.size).toBe(1); // two plans, one key
    expect(projected.map((i) => i.period)).toEqual(['2026-03', '2026-04', '2026-05']); // 3 charges, not 6
  });

  it('keeps two plans separate when ANY ONE of vendor / length / amount differs', () => {
    // All three components of the key are exercised independently. Varying only `vendor` — which
    // is what this test did before the mutation sweep — leaves `totalInstallments` and `amount`
    // unheld: dropping either from `planKeyOf` passed every test in this file. That survivor is
    // money: two ₪300×4 and ₪1,200×4 plans from one vendor would merge, and the smaller plan's
    // remaining charges would be projected at the larger one's amount.
    const base = COLLIDING_PLANS[0];
    const variants = [
      { ...base, vendor: 'ביתילי' },
      { ...base, totalInstallments: 6 },
      { ...base, amount: 1200 },
    ];
    for (const variant of variants) {
      const projected = projectInstalmentsForward([base, variant], '2026-01', '2026-12');
      const keys = new Set(projected.map((i) => (i.basis.kind === 'installment' ? i.basis.planKey : '')));
      expect(keys.size, `variant did not produce a distinct planKey: ${JSON.stringify(variant)}`).toBe(2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D20 — THE CANONICAL TEST
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('resolveLayerPrecedence — a TOTAL order, so shuffling the input cannot change the money (D20)', () => {
  it('CANONICAL: shuffling the input does not change the output, over 24 seeds', () => {
    const items: ForecastLineItem[] = [
      assumption({ id: 'a-user-old', source: 'user', updatedAt: '2026-07-01T00:00:00.000Z', amount: 1100 }),
      assumption({ id: 'a-user-new', source: 'user', updatedAt: '2026-08-01T00:00:00.000Z', amount: 2200 }),
      assumption({ id: 'a-insight', source: 'insight', updatedAt: '2026-08-09T00:00:00.000Z', amount: 3300 }),
      movingAverage(950),
      movingAverage(410, '2026-11'),
      {
        period: '2026-10',
        categoryId: 'מגורים ובית',
        direction: 'expense',
        amountILS: 5000,
        basis: { kind: 'recurring', recurringId: 'rec-rent', description: 'שכר דירה', chargeDay: 10 },
      },
    ];
    const expected = resolveLayerPrecedence(items);
    for (let seed = 1; seed <= 24; seed++) {
      expect(resolveLayerPrecedence(shuffle(items, seed))).toEqual(expected);
    }
  });

  it('the shuffle actually reorders the input — otherwise the test above proves nothing', () => {
    // Non-vacuity for the canonical test: if `shuffle` were the identity, shuffle-invariance would
    // hold for ANY implementation, including the broken one that returns Firestore's order.
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const permutations = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) permutations.add(shuffle(input, seed).join(','));
    expect(permutations.size).toBeGreaterThan(4);
    expect(permutations).not.toEqual(new Set([input.join(',')]));
  });

  it('`user` beats `insight` even when the insight is newer — the amount, not just the order, changes', () => {
    // Held on the FIGURE, not on array position. A precedence bug that only shows up as ordering is
    // invisible; one that picks a different number is money.
    const winner = resolveLayerPrecedence([
      assumption({ id: 'a1', source: 'insight', updatedAt: '2026-08-09T00:00:00.000Z', amount: 3300 }),
      assumption({ id: 'a2', source: 'user', updatedAt: '2026-07-01T00:00:00.000Z', amount: 1100 }),
    ]);
    expect(winner).toHaveLength(1);
    expect(winner[0].amountILS).toBe(1100);
  });

  it('among same-source assumptions the LATEST updatedAt wins', () => {
    const winner = resolveLayerPrecedence([
      assumption({ id: 'a1', source: 'user', updatedAt: '2026-07-01T00:00:00.000Z', amount: 1100 }),
      assumption({ id: 'a2', source: 'user', updatedAt: '2026-08-01T00:00:00.000Z', amount: 2200 }),
    ]);
    expect(winner[0].amountILS).toBe(2200);
  });

  it('falls back to id ascending when source AND updatedAt tie — the case two members actually hit', () => {
    // Two parents editing the same category in the same minute is not exotic; without this final
    // tiebreak the winner is Firestore's iteration order and the headline number is not reproducible.
    const winner = resolveLayerPrecedence([
      assumption({ id: 'zz', source: 'user', updatedAt: '2026-08-01T00:00:00.000Z', amount: 999 }),
      assumption({ id: 'aa', source: 'user', updatedAt: '2026-08-01T00:00:00.000Z', amount: 111 }),
    ]);
    expect(winner[0].amountILS).toBe(111);
  });

  it('an assumption overrides a statistical item in the same bucket and RECORDS what it displaced', () => {
    const resolved = resolveLayerPrecedence([movingAverage(950), assumption({ amount: 1200 })]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].amountILS).toBe(1200);
    const basis = resolved[0].basis;
    expect(basis.kind).toBe('assumption');
    expect(basis.kind === 'assumption' && basis.overrides.map((b) => b.kind)).toEqual(['movingAverage']);
  });

  it('an assumption MAY override a CERTAIN item — the §4.4 scenario, and the disclosure is the stack', () => {
    // "A user who knows rent rises to ₪6,000 in October is the most valuable assumption in the
    // system." The certain item is not deleted, it is recorded underneath, so the card can show
    // both numbers and name what was overridden.
    const rentCertain: ForecastLineItem = {
      period: '2026-10',
      categoryId: 'מגורים ובית',
      direction: 'expense',
      amountILS: 5000,
      basis: { kind: 'recurring', recurringId: 'rec-rent', description: 'שכר דירה', chargeDay: 10 },
    };
    const rentAssumption: ForecastLineItem = {
      ...assumption({ id: 'a-rent', amount: 6000 }),
      categoryId: 'מגורים ובית',
    };
    const resolved = resolveLayerPrecedence([rentCertain, rentAssumption]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].amountILS).toBe(6000);
    const basis = resolved[0].basis;
    expect(basis.kind === 'assumption' && basis.overrides).toEqual([rentCertain.basis]);
  });

  it('the overrides stack is ordered NEAREST-OVERRIDDEN FIRST and goes three deep', () => {
    const resolved = resolveLayerPrecedence([
      movingAverage(950),
      assumption({ id: 'a-user', source: 'user', updatedAt: '2026-08-01T00:00:00.000Z', amount: 1200 }),
      assumption({ id: 'a-insight', source: 'insight', updatedAt: '2026-08-09T00:00:00.000Z', amount: 3300 }),
    ]);
    const basis = resolved[0].basis;
    expect(resolved[0].amountILS).toBe(1200);
    expect(basis.kind === 'assumption' && basis.overrides.map((b) => b.kind)).toEqual(['assumption', 'movingAverage']);
  });

  it('does NOT collapse two certain items that legitimately share a bucket', () => {
    // Two recurring charges in one category in one month are two real payments. Collapsing them
    // would delete money — precedence is about which SOURCE speaks for a bucket when they disagree,
    // not about deduplicating facts that do not disagree.
    const a: ForecastLineItem = {
      period: '2026-10', categoryId: CATEGORY_OTHER, direction: 'expense', amountILS: 90,
      basis: { kind: 'recurring', recurringId: 'rec-a', description: 'א', chargeDay: 3 },
    };
    const b: ForecastLineItem = { ...a, amountILS: 40, basis: { kind: 'recurring', recurringId: 'rec-b', description: 'ב', chargeDay: 4 } };
    const resolved = resolveLayerPrecedence([a, b]);
    expect(resolved).toHaveLength(2);
    expect(resolved.reduce((s, i) => s + i.amountILS, 0)).toBe(130);
  });

  it('never nets an income line against an expense line in the same period and category', () => {
    // The bucket key carries `direction` as well as (period, categoryId). Without it, an assumption
    // about a category's SPEND would swallow an income line sitting in the same category and the
    // money would vanish rather than be overridden.
    const income: ForecastLineItem = { ...movingAverage(4000), direction: 'income' };
    const expense = movingAverage(950);
    const withAssumption = resolveLayerPrecedence([income, expense, assumption({ amount: 1200 })]);
    expect(withAssumption).toHaveLength(2);
    expect(withAssumption.find((i) => i.direction === 'income')?.amountILS).toBe(4000);
  });

  it('leaves distinct periods and categories untouched', () => {
    const resolved = resolveLayerPrecedence([movingAverage(100, '2026-09'), movingAverage(200, '2026-10')]);
    expect(resolved).toHaveLength(2);
  });

  it('returns [] for []', () => {
    expect(resolveLayerPrecedence([])).toEqual([]);
  });

  it('does not mutate the array it was given', () => {
    const items = [movingAverage(950), assumption({ amount: 1200 })];
    const snapshot = JSON.parse(JSON.stringify(items));
    resolveLayerPrecedence(items);
    expect(items).toEqual(snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D16 — the opening balance, and why its staleness is not allowed to hide
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('computeOpeningBalance — the least certain input in the whole computation (D16)', () => {
  const accounts = [
    { balance: 12000, balanceUpdatedAt: '2026-08-01T09:00:00.000Z' },
    { balance: 3000, balanceUpdatedAt: '2026-06-20T09:00:00.000Z' },
  ];

  it('sums the balances, counts the accounts, and reports the LATEST asOf', () => {
    const opening = computeOpeningBalance(accounts, '2026-08-18');
    expect(opening?.amountILS).toBe(15000);
    expect(opening?.accountsCounted).toBe(2);
    expect(opening?.asOf).toBe('2026-08-01T09:00:00.000Z');
  });

  it('returns null — not 0 — when there are no accounts', () => {
    // A ₪0 opening balance and an unknown opening balance are opposite statements, and a forecast
    // built on the first while meaning the second is wrong by the family's entire savings.
    expect(computeOpeningBalance([], '2026-08-18')).toBeNull();
  });

  it('grades staleness against NAMED day thresholds, at the boundary', () => {
    const at = (days: number) => {
      const opening = computeOpeningBalance(
        [{ balance: 1, balanceUpdatedAt: '2026-01-01' }],
        addDays('2026-01-01', days)
      );
      return opening?.staleness;
    };
    expect(at(0)).toBe('current');
    expect(at(STALENESS_CURRENT_MAX_DAYS)).toBe('current');
    expect(at(STALENESS_CURRENT_MAX_DAYS + 1)).toBe('stale');
    expect(at(STALENESS_STALE_MAX_DAYS)).toBe('stale');
    expect(at(STALENESS_STALE_MAX_DAYS + 1)).toBe('very-stale');
  });

  it('the thresholds are the ones D16 states', () => {
    expect(STALENESS_CURRENT_MAX_DAYS).toBe(31);
    expect(STALENESS_STALE_MAX_DAYS).toBe(92);
  });

  it("grades a balance whose asOf cannot be read as 'very-stale', never as 'current'", () => {
    // Fail toward disclosure. An unreadable timestamp means we do not know how old the number is,
    // and the only honest rendering of "we do not know" on a staleness axis is the worst one.
    const opening = computeOpeningBalance([{ balance: 1, balanceUpdatedAt: 'nonsense' }], '2026-08-18');
    expect(opening?.staleness).toBe('very-stale');
  });

  it('treats a future-dated balance as current rather than reporting negative staleness', () => {
    const opening = computeOpeningBalance([{ balance: 1, balanceUpdatedAt: '2026-09-01' }], '2026-08-18');
    expect(opening?.staleness).toBe('current');
  });
});

/** Local helper for the boundary test — same integer civil-day arithmetic, spelled out. */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  let year = y;
  let month = m;
  let day = d + days;
  const lengthOf = (yy: number, mm: number) =>
    mm === 2 ? ((yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0 ? 29 : 28)
      : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1];
  while (day > lengthOf(year, month)) {
    day -= lengthOf(year, month);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D32 — the anchor is clamped FORWARD, and one clock, passed in
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('horizonPeriods and the forward anchor clamp (D32a, A18)', () => {
  it('runs from the anchor for the requested number of months, inclusive', () => {
    expect(horizonPeriods('2026-09', 3)).toEqual(['2026-09', '2026-10', '2026-11']);
  });

  it('crosses a year boundary', () => {
    expect(horizonPeriods('2026-11', 3)).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('the default horizon is 3 months', () => {
    expect(DEFAULT_HORIZON_MONTHS).toBe(3);
  });

  it('CLAMPS a past anchor forward to today and SAYS it did', () => {
    // "מתי" is a month stepper with unbounded prev arrows. Silently back-projecting a month that
    // already happened is the only unacceptable option — but so is silently ignoring the control,
    // so the clamp is reported, not just applied.
    const result = composeForecast({
      anchorPeriod: '2026-03',
      todayPeriod: '2026-08',
      horizonMonths: 3,
      lineItems: [],
    });
    expect(result.anchorPeriod).toBe('2026-08');
    expect(result.anchorClamped).toBe(true);
    expect(result.horizon).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('does not report a clamp when the anchor is already forward of today', () => {
    const result = composeForecast({
      anchorPeriod: '2026-10', todayPeriod: '2026-08', horizonMonths: 3, lineItems: [],
    });
    expect(result.anchorPeriod).toBe('2026-10');
    expect(result.anchorClamped).toBe(false);
  });

  it('does not report a clamp when the anchor IS the current period', () => {
    const result = composeForecast({
      anchorPeriod: '2026-08', todayPeriod: '2026-08', horizonMonths: 3, lineItems: [],
    });
    expect(result.anchorClamped).toBe(false);
  });

  it('drops line items outside the horizon rather than totalling them invisibly', () => {
    const result = composeForecast({
      anchorPeriod: '2026-09',
      todayPeriod: '2026-08',
      horizonMonths: 2,
      lineItems: [movingAverage(100, '2026-09'), movingAverage(200, '2026-10'), movingAverage(400, '2026-12')],
    });
    expect(result.horizon).toEqual(['2026-09', '2026-10']);
    expect(result.lineItems.map((i) => i.amountILS)).toEqual([100, 200]);
  });

  it('totals each month by layer AND by direction, with a row for every horizon month', () => {
    const result = composeForecast({
      anchorPeriod: '2026-09',
      todayPeriod: '2026-08',
      horizonMonths: 3,
      lineItems: [
        ...projectRecurringForward(RENT, '2026-09', '2026-09'),
        movingAverage(950, '2026-09'),
        { ...movingAverage(18000, '2026-09'), direction: 'income', categoryId: 'הכנסות והשקעות' },
      ],
    });
    expect(result.byPeriod.map((p) => p.period)).toEqual(['2026-09', '2026-10', '2026-11']);
    const september = result.byPeriod[0];
    expect(september.certainILS).toBe(5000);
    expect(september.statisticalILS).toBe(950);
    expect(september.expenseILS).toBe(5950);
    expect(september.incomeILS).toBe(18000);
    // A month with no line items is a ZERO ROW, not a missing row — the chart must draw it, and
    // A9's failure mode was precisely a month that was absent rather than visibly empty.
    expect(result.byPeriod[2]).toEqual({
      period: '2026-11', certainILS: 0, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 0,
    });
  });

  it('applies precedence — the composed totals use the resolved items, not the raw ones', () => {
    const result = composeForecast({
      anchorPeriod: '2026-10',
      todayPeriod: '2026-08',
      horizonMonths: 1,
      lineItems: [movingAverage(950), assumption({ amount: 1200 })],
    });
    expect(result.byPeriod[0].expenseILS).toBe(1200); // not 2150
    expect(result.byPeriod[0].statisticalILS).toBe(0);
    expect(result.byPeriod[0].assumptionILS).toBe(1200);
  });

  it('the three layer totals are OUTFLOW ONLY, and they add up to the month\'s expense total', () => {
    // Stated as an invariant rather than a comment: `certainILS`/`statisticalILS`/`assumptionILS`
    // are the split of what LEAVES in a month (D39's stacked bar), and income is carried
    // separately. Without this, a certain salary line would be counted into `certainILS` and the
    // bar would show an inflow as though it were spend.
    const result = composeForecast({
      anchorPeriod: '2026-09',
      todayPeriod: '2026-08',
      horizonMonths: 2,
      lineItems: [
        ...projectRecurringForward(RENT, '2026-09', '2026-10'),
        movingAverage(950, '2026-09'),
        assumption({ amount: 1200 }),
        { ...movingAverage(18000, '2026-09'), direction: 'income', categoryId: 'הכנסות והשקעות' },
        { ...movingAverage(18000, '2026-10'), direction: 'income', categoryId: 'הכנסות והשקעות' },
      ],
    });
    for (const month of result.byPeriod) {
      expect(month.certainILS + month.statisticalILS + month.assumptionILS).toBe(month.expenseILS);
    }
    expect(result.byPeriod[0].incomeILS).toBe(18000);
    expect(result.byPeriod[0].certainILS).toBe(5000);
  });

  it('is itself shuffle-invariant end to end', () => {
    const lineItems = [
      movingAverage(950),
      assumption({ id: 'a1', source: 'user', updatedAt: '2026-08-01T00:00:00.000Z', amount: 1200 }),
      assumption({ id: 'a2', source: 'insight', updatedAt: '2026-08-09T00:00:00.000Z', amount: 3300 }),
      ...projectRecurringForward(RENT, '2026-09', '2026-11'),
    ];
    const base = composeForecast({ anchorPeriod: '2026-09', todayPeriod: '2026-08', horizonMonths: 3, lineItems });
    for (let seed = 1; seed <= 12; seed++) {
      expect(composeForecast({
        anchorPeriod: '2026-09', todayPeriod: '2026-08', horizonMonths: 3, lineItems: shuffle(lineItems, seed),
      })).toEqual(base);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D16 — the headline number's arithmetic, in the util rather than in a hook
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('projectedBalanceByPeriod — D16\'s formula, and where it is allowed to be null', () => {
  const byPeriod = [
    { period: '2026-09', certainILS: 5000, statisticalILS: 950, assumptionILS: 0, incomeILS: 18000, expenseILS: 5950 },
    { period: '2026-10', certainILS: 5000, statisticalILS: 0, assumptionILS: 1200, incomeILS: 18000, expenseILS: 6200 },
  ];

  it('accumulates opening + Σincome − Σexpense, month by month', () => {
    expect(projectedBalanceByPeriod(15000, byPeriod)).toEqual([
      { period: '2026-09', projectedBalanceILS: 27050 },
      { period: '2026-10', projectedBalanceILS: 38850 },
    ]);
  });

  it('returns a NEGATIVE balance rather than clamping at zero', () => {
    const overspent = [{ period: '2026-09', certainILS: 0, statisticalILS: 0, assumptionILS: 0, incomeILS: 0, expenseILS: 3100 }];
    expect(projectedBalanceByPeriod(0, overspent)[0].projectedBalanceILS).toBe(-3100);
  });

  it('returns [] when the opening balance is null — a null opening balance is not a zero one', () => {
    // D16/D17: if `accounts` is empty or unreadable the balance is `null` and a NAMED GAP renders
    // in its place. Substituting 0 here would print a confident "יתרה צפויה" built on a number
    // nobody has — the exact defect this stage exists to prevent.
    expect(projectedBalanceByPeriod(null, byPeriod)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T1-REVIEW FOLLOW-UP (2) — roundILS WAS ASSERTED BY COMMENT AND HELD BY NO TEST.
//
// `roundILS`'s own header said "money is rounded to agorot at the point it is produced, so float
// dust never reaches a total". Replacing its body with the identity left ALL 1449 TESTS GREEN.
// That is precisely the class this project's standing rules define as a defect: a comment
// asserting a property that nothing holds.
//
// It is not cosmetic. `premium / 12` is the single most float-dusty expression in the module, and
// the numbers below are real: three yearly policies over a three-month horizon compose to
// 11671.692500000001 unrounded and 11671.71 rounded — a visible tail of digits AND an agora out,
// in the figure D38 puts at text-4xl on the Dashboard.
//
// Every assertion here names an EXACT number rather than a tolerance. A `toBeCloseTo` would pass
// under the identity and is how this hole stayed open.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('roundILS is the reason the headline is a number and not a float', () => {
  const YEARLY = (id: string, premium: number) => ({
    id,
    provider: `ספק ${id}`,
    premium,
    premiumFrequency: 'yearly' as const,
    status: 'active' as const,
  });

  it('rounds a yearly premium at the point it becomes a monthly line item', () => {
    // 12000.10 / 12 = 1000.0083333333333 — the identity would put that on the line item.
    const [item] = projectInsuranceForward(YEARLY('a', 12000.1), '2026-09', '2026-09');
    expect(item.amountILS).toBe(1000.01);
    // 8999.99 / 12 = 749.9991666666666, which rounds UP across a shekel boundary.
    expect(projectInsuranceForward(YEARLY('b', 8999.99), '2026-09', '2026-09')[0].amountILS).toBe(750);
  });

  it('three yearly policies over three months compose to an exact agorot figure, not 11671.692500000001', () => {
    const policies = [YEARLY('a', 1007.77), YEARLY('b', 12345.67), YEARLY('c', 33333.33)];
    const lineItems = policies.flatMap((p) => projectInsuranceForward(p, '2026-09', '2026-11'));
    expect(lineItems).toHaveLength(9);

    const result = composeForecast({
      anchorPeriod: '2026-09',
      todayPeriod: '2026-09',
      horizonMonths: 3,
      lineItems,
    });

    // Per month: 83.98 + 1028.81 + 2777.78. Unrounded it is 3890.5641666666665.
    for (const month of result.byPeriod) expect(month.expenseILS).toBe(3890.57);

    // The cumulative figure, taken through the module's OWN accumulator rather than a bare `+`
    // in this test — three 3890.57s added with plain float arithmetic are 11671.710000000001, which
    // is the same defect one layer up and would make this assertion a liar about its own subject.
    const [, , last] = projectedBalanceByPeriod(0, result.byPeriod);
    expect(last.projectedBalanceILS).toBe(-11671.71);
    expect(last.projectedBalanceILS).not.toBe(-11671.6925);
  });

  it('the projected balance carries no float tail either — it is the figure D16 defines', () => {
    const lineItems = [
      { id: 'a', provider: 'ס', premium: 1007.77, premiumFrequency: 'yearly' as const, status: 'active' as const },
      { id: 'b', provider: 'ס', premium: 12345.67, premiumFrequency: 'yearly' as const, status: 'active' as const },
      { id: 'c', provider: 'ס', premium: 33333.33, premiumFrequency: 'yearly' as const, status: 'active' as const },
    ].flatMap((p) => projectInsuranceForward(p, '2026-09', '2026-11'));
    const { byPeriod } = composeForecast({
      anchorPeriod: '2026-09', todayPeriod: '2026-09', horizonMonths: 3, lineItems,
    });
    expect(projectedBalanceByPeriod(50000.01, byPeriod).map((p) => p.projectedBalanceILS))
      .toEqual([46109.44, 42218.87, 38328.3]);
  });

  it('every amount and every total a composed forecast produces equals its own agorot rounding', () => {
    // The general property, so a future producer that forgets roundILS fails here even if it is
    // not an insurance premium. Non-vacuous: the input is deliberately dusty.
    const lineItems = [1007.77, 12345.67, 33333.33, 99999.99, 7.77].flatMap((premium, i) =>
      projectInsuranceForward(
        { id: `p${i}`, provider: 'ס', premium, premiumFrequency: 'yearly', status: 'active' },
        '2026-09',
        '2026-11'
      )
    );
    const { byPeriod, lineItems: resolved } = composeForecast({
      anchorPeriod: '2026-09', todayPeriod: '2026-09', horizonMonths: 3, lineItems,
    });
    const agorot = (n: number): boolean => Math.round(n * 100) / 100 === n;
    expect(resolved.length).toBeGreaterThan(0);
    for (const item of resolved) expect(agorot(item.amountILS)).toBe(true);
    for (const month of byPeriod) {
      for (const value of [month.certainILS, month.statisticalILS, month.assumptionILS, month.incomeILS, month.expenseILS]) {
        expect(agorot(value)).toBe(true);
      }
    }
    for (const point of projectedBalanceByPeriod(12345.67, byPeriod)) {
      expect(agorot(point.projectedBalanceILS)).toBe(true);
    }
  });
});

describe('the horizon length is validated, not silently emptied (T1-review follow-up 2)', () => {
  it('refuses every non-positive, non-integer and over-long length', () => {
    for (const bad of [0, -1, -12, 2.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_HORIZON_MONTHS + 1, 600]) {
      expect(() => horizonPeriods('2026-09', bad)).toThrow(/months must be an integer/);
    }
  });

  it('accepts the three lengths D32 offers, and the boundary', () => {
    expect(horizonPeriods('2026-09', 1)).toEqual(['2026-09']);
    expect(horizonPeriods('2026-09', DEFAULT_HORIZON_MONTHS)).toHaveLength(3);
    expect(horizonPeriods('2026-09', 6)).toHaveLength(6);
    expect(horizonPeriods('2026-09', MAX_HORIZON_MONTHS)).toHaveLength(12);
  });

  it('composeForecast inherits the refusal rather than returning an empty, plausible-looking result', () => {
    // The defect this closes: `{ horizonMonths: 0 }` returned a well-formed ForecastResult with an
    // empty horizon — indistinguishable from a horizon whose months are genuinely all empty, which
    // is a REAL state (A9). Two different things must not render the same way.
    expect(() =>
      composeForecast({ anchorPeriod: '2026-09', todayPeriod: '2026-09', horizonMonths: 0, lineItems: [] })
    ).toThrow(/months must be an integer/);
    expect(() =>
      composeForecast({ anchorPeriod: '2026-09', todayPeriod: '2026-09', horizonMonths: 240, lineItems: [] })
    ).toThrow(/months must be an integer/);
    // …and the default path still works, so the refusal has not swallowed the ordinary case.
    expect(
      composeForecast({ anchorPeriod: '2026-09', todayPeriod: '2026-09', lineItems: [] }).horizon
    ).toHaveLength(DEFAULT_HORIZON_MONTHS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T4 REVIEW F-1, SECOND HALF — THE STATISTICAL LAYER REFUSES AN UNREADABLE AMOUNT
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// A parent could strip `date`, `owner` and `amount` off a row with one `updateDoc`, leaving
// `{ownerId, period, category}`. Rules now denies it — but a rule can be relaxed later, the
// pre-backfill corpus is full of rows nobody has validated, and `incomes`/`transaction_lines` are
// schemaless collections read through a NON-STRICT tsconfig, so `row.amount as number` compiles
// and a string arrives. `NaN` on the headline projected balance is the failure this whole stage
// exists to prevent, and it costs one such row.
//
// So the statistical layer is given ONE reader of a row's amount, and an aggregate that REFUSES
// rather than summing. Refusing, not skipping: a moving average silently computed over four of six
// rows renders identically to one computed over all six — R6's failure mode, arriving by a
// different route. The caller gets the ids and decides, exactly as D17 decides for the balance.

describe('readObservedAmount — the one place the statistical layer decides an amount is readable', () => {
  it('reads an ordinary number, positive, negative or zero', () => {
    expect(readObservedAmount({ amount: 250 })).toEqual({ status: 'readable', amountILS: 250 });
    expect(readObservedAmount({ amount: -40 })).toEqual({ status: 'readable', amountILS: -40 });
    expect(readObservedAmount({ amount: 0 })).toEqual({ status: 'readable', amountILS: 0 });
  });

  it('!! REFUSES AN ABSENT AMOUNT — the exact row the live probe left behind', () => {
    // `{ownerId, period, category}` — no date, no owner, no amount. It passes `isExpenseRow`,
    // which reads `category` and `isCredit` and never looks at `amount`.
    expect(readObservedAmount({})).toEqual({ status: 'unreadable', reason: 'absent' });
    expect(readObservedAmount({ amount: undefined })).toEqual({ status: 'unreadable', reason: 'absent' });
    expect(readObservedAmount({ amount: null })).toEqual({ status: 'unreadable', reason: 'absent' });
  });

  it('refuses a NON-NUMBER rather than coercing it — `Number("300")` is the defect, not the fix', () => {
    // Coercion is the near-match guess `resolveOwnerId`'s header refuses, and it is worse here:
    // `Number('')` is 0 and `Number([300])` is 300, so a coercing reader turns two different kinds
    // of broken row into confident money.
    expect(readObservedAmount({ amount: '300' })).toEqual({ status: 'unreadable', reason: 'not-a-number' });
    expect(readObservedAmount({ amount: '' })).toEqual({ status: 'unreadable', reason: 'not-a-number' });
    expect(readObservedAmount({ amount: [300] })).toEqual({ status: 'unreadable', reason: 'not-a-number' });
    expect(readObservedAmount({ amount: true })).toEqual({ status: 'unreadable', reason: 'not-a-number' });
    expect(readObservedAmount({ amount: { ils: 300 } })).toEqual({ status: 'unreadable', reason: 'not-a-number' });
  });

  it('refuses NaN and Infinity, which ARE numbers and are the ones that propagate', () => {
    // `typeof NaN === 'number'`. A type check alone lets through the one value whose whole
    // behaviour is to contaminate every sum it touches.
    expect(readObservedAmount({ amount: Number.NaN })).toEqual({ status: 'unreadable', reason: 'not-finite' });
    expect(readObservedAmount({ amount: Number.POSITIVE_INFINITY })).toEqual({ status: 'unreadable', reason: 'not-finite' });
    expect(readObservedAmount({ amount: Number.NEGATIVE_INFINITY })).toEqual({ status: 'unreadable', reason: 'not-finite' });
  });
});

describe('totalObservedILS — REFUSES the total rather than summing an unreadable row', () => {
  it('sums a clean set and reports how many rows it counted', () => {
    const total = totalObservedILS([
      { id: 'a', amount: 100 },
      { id: 'b', amount: 250.5 },
      { id: 'c', amount: -30 },
    ]);
    expect(total).toEqual({ status: 'ok', totalILS: 320.5, rowsCounted: 3 });
  });

  it('an empty set totals ZERO and is not a refusal — ₪0 over no rows is a real answer', () => {
    expect(totalObservedILS([])).toEqual({ status: 'ok', totalILS: 0, rowsCounted: 0 });
  });

  it('!! ONE UNREADABLE ROW REFUSES THE WHOLE TOTAL, and names it', () => {
    const total = totalObservedILS([
      { id: 'good-1', amount: 100 },
      { id: 'stripped' }, // the live probe's row: ownerId, period and category only
      { id: 'good-2', amount: 200 },
    ]);
    expect(total.status).toBe('refused');
    if (total.status !== 'refused') throw new Error('unreachable');
    expect(total.unreadable).toEqual([{ id: 'stripped', reason: 'absent' }]);
  });

  it('reports EVERY unreadable row, not the first — one trip to fix the data, not four', () => {
    const total = totalObservedILS([
      { id: 'r1', amount: 100 },
      { id: 'r2', amount: '300' },
      { id: 'r3' },
      { id: 'r4', amount: Number.NaN },
    ]);
    if (total.status !== 'refused') throw new Error('expected a refusal');
    expect(total.unreadable).toEqual([
      { id: 'r2', reason: 'not-a-number' },
      { id: 'r3', reason: 'absent' },
      { id: 'r4', reason: 'not-finite' },
    ]);
  });

  it('a row with no id is still named — `(no id)`, because the alternative is an unactionable refusal', () => {
    const total = totalObservedILS([{ amount: 'x' }]);
    if (total.status !== 'refused') throw new Error('expected a refusal');
    expect(total.unreadable).toEqual([{ id: '(no id)', reason: 'not-a-number' }]);
  });

  it('!! THE PROOF THAT REFUSING IS NOT COSMETIC — the naive sum over the same rows is NaN', () => {
    // What T5 would have shipped without this: one stripped row and the headline is `NaN`.
    const rows: Array<{ id: string; amount?: unknown }> = [
      { id: 'good-1', amount: 100 },
      { id: 'stripped' },
      { id: 'good-2', amount: 200 },
    ];
    const naive = rows.reduce((sum, row) => sum + (row.amount as number), 0);
    expect(Number.isNaN(naive)).toBe(true);
    expect(totalObservedILS(rows).status).toBe('refused');
  });

  it('rounds to the shekel precision the rest of the module uses, so the total cannot drift from the parts', () => {
    const total = totalObservedILS([{ id: 'a', amount: 0.1 }, { id: 'b', amount: 0.2 }]);
    expect(total).toEqual({ status: 'ok', totalILS: 0.3, rowsCounted: 2 });
  });
});
