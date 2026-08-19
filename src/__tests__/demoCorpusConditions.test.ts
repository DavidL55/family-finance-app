// Stage 7 T4 — the condition predicates, against SYNTHETIC corpora built by hand.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS SEPARATELY FROM `demoCorpus.test.ts`, AND WHY IT IS THE IMPORTANT ONE
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// `demoCorpus.test.ts` runs the predicates against the GENERATOR'S OUTPUT. On its own that pairing
// is circular: if the generator stopped emitting the refund row on the same day the predicate
// stopped detecting one, both would go green together and the guard downstream would lose its
// corpus in silence. That is precisely the shadowing class this project has now found fifteen
// times.
//
// So every predicate is proven here against a corpus assembled BY HAND, in both directions:
//
//   · a MINIMAL corpus containing exactly the thing → the predicate must be `true`;
//   · the same corpus with exactly that thing removed or weakened → it must be `false`.
//
// The negative half is the half that matters. A predicate that returns `true` unconditionally
// passes every positive test in this file.
//
// Written STUB-FIRST: every function in `demoCorpusConditions.ts` returned `false` (and every
// derivation returned an empty collection) when this file was first run, and the run was RED.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, stripComments } from './helpers/extractionSurfaces';
import { resolveTarget } from '../utils/forecastTargets';
import { HEBREW_MONTH_NAMES } from '../config/hebrewMonths';
import {
  DEMO_CORPUS_CONDITIONS,
  allFourColdStartBands,
  allThreeStalenessBands,
  assumptionOverridesCertainItem,
  bothPremiumFrequenciesAsDocuments,
  bothRecurringKindsAndAnInactiveItem,
  categoriesInPeriod,
  certainLineItems,
  collidingAssumptions,
  collidingInstalmentPlans,
  crossesHistoryRowCeiling,
  duplicateDisplayName,
  emptyCertainMonth,
  evaluateDemoCorpusConditions,
  everyAssumptionIsSourceUser,
  instalmentNullRow,
  loansEndingInsideAndOutsideHorizon,
  malformedIncomePeriod,
  monthsObservedByCategory,
  personalTargetAssumption,
  recurringAndManualRowsShareACategoryMonth,
  refundCreditRowSplitsThePredicates,
  rulesBlockedLegacyDateRowParses,
  seasonalityAssumption,
  twentyMembersWithMoney,
  unknownOwnerRowsFromBothCauses,
  unknownPeriodRowsInRulesPassingForms,
  conditionOutcomes,
  failingConditionIds,
  weakestCategoryMonth,
  windowRows,
  zeroAmountSingleObservationCategory,
} from '../utils/demoCorpusConditions';
import {
  DEMO_LARGE_MEMBER_COUNT,
  DEMO_RULES_BLOCKED_LEGACY_DATE,
  DEMO_UNPARSEABLE_DATES,
  type DemoCorpus,
  type DemoForecastAssumption,
  type DemoIncome,
  type DemoMember,
  type DemoTransactionLine,
} from '../utils/demoCorpus';
import { HISTORY_ROW_CEILING } from '../utils/statisticalLayer';
import { UNKNOWN_PERIOD } from '../utils/periodMath';

import { UNKNOWN_OWNER_ID } from '../utils/resolveOwnerId';
import type { Account, Insurance, Loan, RecurringItem } from '../types/finance';

/** `firestore.rules`' `date.size() == 10`, restated in the test so the length check has a peer. */
const RULES_DATE_SIZE_FOR_TEST = 10;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Hand-built corpus fragments. Nothing below calls `buildDemoCorpus`.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const HISTORY = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const WINDOW = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const HORIZON = ['2026-08', '2026-09', '2026-10'];
const AS_OF = '2026-08-18';

function corpus(over: Partial<DemoCorpus> = {}): DemoCorpus {
  return {
    seed: 1,
    asOfDate: AS_OF,
    anchorPeriod: '2026-08',
    historyPeriods: HISTORY,
    windowPeriods: WINDOW,
    horizonPeriods: HORIZON,
    emptyCertainPeriod: '2026-09',
    members: [],
    accounts: [],
    recurring: [],
    loans: [],
    insurances: [],
    incomes: [],
    transactionLines: [],
    forecastAssumptions: [],
    backfillMarker: {
      completedAt: `${AS_OF}T06:00:00.000Z`,
      rowsStamped: 0,
      rowsUnknown: 0,
      sourceCommit: 'test',
      // T5 — `parseBackfillMarker` requires all seven fields; four parse as `null` and refuse.
      lastRunAt: `${AS_OF}T06:00:00.000Z`,
      lastRunCommit: 'test',
      transactionRows: 0,
    },
    ...over,
  };
}

function member(id: string, name: string): DemoMember {
  return { id, name, role: 'ילד', color: '#000000', createdAt: '2025-01-01T09:00:00.000Z', updatedAt: '2025-01-01T09:00:00.000Z' };
}

function row(over: Partial<DemoTransactionLine> = {}): DemoTransactionLine {
  return {
    id: 'r',
    date: '2026-07-05',
    description: 'שורה',
    vendor: 'ספק',
    amount: 100,
    category: 'מזון וצריכה',
    paymentType: 'one_time',
    installmentNumber: null,
    totalInstallments: null,
    isCredit: false,
    expenseClassification: 'Variable',
    owner: 'דויד',
    ownerId: 'm1',
    period: '2026-07',
    recurringId: null,
    recurringPeriod: null,
    ...over,
  };
}

function account(id: string, balanceUpdatedAt: string, balance = 1000): Account {
  return {
    id,
    ownerId: 'm1',
    name: id,
    type: 'bank',
    balance,
    balanceUpdatedAt,
    status: 'active',
    createdAt: '2025-01-01T09:00:00.000Z',
    updatedAt: '2025-01-01T09:00:00.000Z',
  };
}

function recurringItem(over: Partial<RecurringItem> = {}): RecurringItem {
  return {
    id: 'rec',
    ownerId: 'm1',
    kind: 'expense',
    description: 'פריט',
    amount: 100,
    category: 'בריאות',
    chargeDay: 5,
    status: 'active',
    startDate: '2025-01-01',
    createdAt: '2025-01-01T09:00:00.000Z',
    updatedAt: '2025-01-01T09:00:00.000Z',
    ...over,
  };
}

function loan(over: Partial<Loan> = {}): Loan {
  return {
    id: 'loan',
    ownerId: 'm1',
    name: 'הלוואה',
    loanType: 'personal',
    principal: 10000,
    balance: 5000,
    interestRate: 5,
    monthlyPayment: 500,
    startDate: '2025-01-01',
    endDate: '2026-08-31',
    status: 'active',
    createdAt: '2025-01-01T09:00:00.000Z',
    updatedAt: '2025-01-01T09:00:00.000Z',
    ...over,
  };
}

function insurance(over: Partial<Insurance> = {}): Insurance {
  return {
    id: 'ins',
    ownerId: 'm1',
    type: 'health',
    provider: 'הראל',
    insuredMemberId: 'm1',
    premium: 300,
    premiumFrequency: 'monthly',
    coverages: [],
    renewalDate: '2027-01-01',
    status: 'lapsed',
    createdAt: '2025-01-01T09:00:00.000Z',
    updatedAt: '2025-01-01T09:00:00.000Z',
    ...over,
  };
}

function assumption(over: Partial<DemoForecastAssumption> = {}): DemoForecastAssumption {
  return {
    id: 'fa',
    ownerId: 'm1',
    scopeKind: 'category',
    scopeId: 'מזון וצריכה',
    fromPeriod: '2026-08',
    amountILS: 1000,
    reasonHe: 'סיבה',
    source: 'user',
    status: 'active',
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    ...over,
  };
}

function income(over: Partial<DemoIncome> = {}): DemoIncome {
  return { id: 'inc', name: 'משכורת', amount: 100, date: '2026-07-01', month: '07', year: '2026', period: '2026-07', ...over };
}

/** N rows in `period`, ids distinct, so a count assertion is about rows and not about identity. */
function rows(count: number, over: Partial<DemoTransactionLine> = {}): DemoTransactionLine[] {
  return Array.from({ length: count }, (_, i) => row({ ...over, id: `bulk-${String(i)}` }));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Shared derivations
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('monthsObservedByCategory', () => {
  it('counts DISTINCT history periods, not rows', () => {
    const observed = monthsObservedByCategory(
      corpus({
        transactionLines: [
          row({ id: 'a', period: '2026-06', category: 'מזון וצריכה' }),
          row({ id: 'b', period: '2026-06', category: 'מזון וצריכה' }),
          row({ id: 'c', period: '2026-07', category: 'מזון וצריכה' }),
        ],
      })
    );
    expect(observed.get('מזון וצריכה')).toBe(2);
  });

  it('counts the WHOLE history span, not the capped window — otherwise `>6` is unreachable', () => {
    const observed = monthsObservedByCategory(
      corpus({ transactionLines: HISTORY.map((p) => row({ id: p, period: p, category: 'מזון וצריכה' })) })
    );
    expect(observed.get('מזון וצריכה')).toBe(HISTORY.length);
    expect(HISTORY.length).toBeGreaterThan(WINDOW.length);
  });

  it('gives a category reached ONLY through a recurring item a count of 0 — D26 row 0', () => {
    const observed = monthsObservedByCategory(
      corpus({ recurring: [recurringItem({ category: 'חינוך וחוגים' })] })
    );
    expect(observed.get('חינוך וחוגים')).toBe(0);
  });

  it('ignores a row whose period is not a history period — an `unknown` row is not an observation', () => {
    const observed = monthsObservedByCategory(
      corpus({ transactionLines: [row({ period: UNKNOWN_PERIOD, category: 'שונות' })] })
    );
    expect(observed.get('שונות') ?? 0).toBe(0);
  });

  it('ignores rows `isExpenseRow` rejects — a credit is not an observation of spending', () => {
    const observed = monthsObservedByCategory(
      corpus({ transactionLines: [row({ period: '2026-07', category: 'מזון וצריכה', isCredit: true, paymentType: 'refund' })] })
    );
    expect(observed.get('מזון וצריכה') ?? 0).toBe(0);
  });
});

describe('categoriesInPeriod', () => {
  it('a category present ONLY as a credit is not "in" the month — `isExpenseRow` decides', () => {
    // Closes the mutation that deletes the `isExpenseRow` filter here. Without a credit-only
    // category the deletion changes nothing on any corpus this repo builds.
    const c = corpus({
      transactionLines: [
        row({ id: 'credit', period: '2026-07', category: 'החזרים', isCredit: true, paymentType: 'refund' }),
        row({ id: 'spend', period: '2026-07', category: 'מזון וצריכה' }),
      ],
    });
    expect(categoriesInPeriod(c, '2026-07')).toEqual(['מזון וצריכה']);
  });

  it('names the categories with an expense row in that month, and nothing else', () => {
    const c = corpus({
      transactionLines: [
        row({ id: 'a', period: '2026-07', category: 'מזון וצריכה' }),
        row({ id: 'b', period: '2026-06', category: 'תחבורה ורכב' }),
      ],
    });
    expect(categoriesInPeriod(c, '2026-07')).toEqual(['מזון וצריכה']);
    expect(categoriesInPeriod(c, '2026-06')).toEqual(['תחבורה ורכב']);
  });
});

describe('certainLineItems', () => {
  it('projects recurring, loans, insurances and instalments through the real projectors', () => {
    const items = certainLineItems(
      corpus({
        recurring: [recurringItem({ id: 'r1', endDate: '2026-08-31' })],
        loans: [loan({ id: 'l1', endDate: '2026-08-31' })],
      })
    );
    expect(items.filter((i) => i.basis.kind === 'recurring').length).toBeGreaterThan(0);
    expect(items.filter((i) => i.basis.kind === 'loan').length).toBeGreaterThan(0);
    expect(items.every((i) => HORIZON.includes(i.period))).toBe(true);
  });

  it('projects INSTALMENTS too — a plan owing further payments becomes a certain line', () => {
    // Closes the mutation that drops `projectInstalmentsForward` from this derivation: on the real
    // corpus every instalment charge shares a month with a recurring one, so the deletion is
    // invisible unless a corpus exists where instalments are the ONLY certain source.
    const items = certainLineItems(
      corpus({
        transactionLines: [
          row({ id: 'plan', period: '2026-07', date: '2026-07-05', vendor: 'אייס', amount: 300, installmentNumber: 3, totalInstallments: 4 }),
        ],
      })
    );
    expect(items.map((i) => i.basis.kind)).toEqual(['installment']);
    expect(items[0].period).toBe('2026-08');
  });

  it('an ACTIVE insurance charges in every horizon month — the fact D27 could not have known', () => {
    // Recorded as an executable statement rather than as prose in `demoCorpus.ts`'s header:
    // `projectInsuranceForward` has no end bound, so one active policy makes an
    // empty-certain-layer month unreachable. This is why the demo corpus's policies are inactive.
    const items = certainLineItems(corpus({ insurances: [insurance({ status: 'active' })] }));
    expect(items.map((i) => i.period).sort()).toEqual([...HORIZON].sort());
  });
});

describe('windowRows', () => {
  it('returns exactly the rows whose period is in the window', () => {
    const c = corpus({
      transactionLines: [
        row({ id: 'in', period: '2026-07' }),
        row({ id: 'out', period: '2025-12' }),
        row({ id: 'unknown', period: UNKNOWN_PERIOD }),
      ],
    });
    expect(windowRows(c).map((r) => r.id)).toEqual(['in']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The predicates — each in BOTH directions
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('allThreeStalenessBands', () => {
  it('holds when one account sits in each band', () => {
    expect(
      allThreeStalenessBands(
        corpus({
          accounts: [
            account('current', '2026-08-13T09:00:00.000Z'),
            account('stale', '2026-06-20T09:00:00.000Z'),
            account('very', '2026-03-21T09:00:00.000Z'),
          ],
        })
      )
    ).toBe(true);
  });

  it('does NOT hold when the very-stale account is missing', () => {
    expect(
      allThreeStalenessBands(
        corpus({ accounts: [account('current', '2026-08-13T09:00:00.000Z'), account('stale', '2026-06-20T09:00:00.000Z')] })
      )
    ).toBe(false);
  });

  it('does NOT hold for three accounts that all land in one band', () => {
    expect(
      allThreeStalenessBands(
        corpus({
          accounts: [
            account('a', '2026-08-13T09:00:00.000Z'),
            account('b', '2026-08-14T09:00:00.000Z'),
            account('c', '2026-08-15T09:00:00.000Z'),
          ],
        })
      )
    ).toBe(false);
  });
});

describe('allFourColdStartBands', () => {
  const banded = corpus({
    recurring: [recurringItem({ category: 'חינוך וחוגים' })], // 0
    transactionLines: [
      ...HISTORY.map((p) => row({ id: `g-${p}`, period: p, category: 'מזון וצריכה' })), // 8 → >6
      ...WINDOW.slice(0, 4).map((p) => row({ id: `t-${p}`, period: p, category: 'תחבורה ורכב' })), // 4 → 3–6
      row({ id: 'h', period: '2026-07', category: 'בריאות' }), // 1 → 1–2
    ],
  });

  it('holds when 0, 1–2, 3–6 and >6 all occur', () => {
    expect(allFourColdStartBands(banded)).toBe(true);
  });

  it('does NOT hold without the 0 band — a category with no history at all', () => {
    expect(allFourColdStartBands(corpus({ ...banded, recurring: [] }))).toBe(false);
  });

  it('!! THE 1-2 BOUNDARY IS PINNED: two observations band WITH one, three band with six', () => {
    // Closes the mutation that narrows the thin band to `<= 1`. With four categories at 0/1/2/8 the
    // narrowed band still reports all four (2 slides into `full`), so the boundary needs a corpus
    // where moving it EMPTIES a band: 0, 1, 2 and 8 with nothing at 3-6.
    const boundary = corpus({
      recurring: [recurringItem({ category: 'חינוך וחוגים' })],
      transactionLines: [
        ...HISTORY.map((p) => row({ id: `g-${p}`, period: p, category: 'מזון וצריכה' })),
        row({ id: 'one', period: '2026-07', category: 'בריאות' }),
        row({ id: 'two-a', period: '2026-06', category: 'פנאי ובילוי' }),
        row({ id: 'two-b', period: '2026-07', category: 'פנאי ובילוי' }),
      ],
    });
    const observed = monthsObservedByCategory(boundary);
    expect(observed.get('פנאי ובילוי')).toBe(2);
    expect([...observed.values()].some((n) => n >= 3 && n <= 6)).toBe(false);
    expect(allFourColdStartBands(boundary)).toBe(false);
  });

  it('does NOT hold without the >6 band — six observations are not seven', () => {
    const capped = corpus({
      ...banded,
      transactionLines: banded.transactionLines.filter((r) => !r.id.startsWith('g-') || WINDOW.includes(r.period)),
    });
    expect(monthsObservedByCategory(capped).get('מזון וצריכה')).toBe(6);
    expect(allFourColdStartBands(capped)).toBe(false);
  });
});

describe('weakestCategoryMonth', () => {
  const mixed = corpus({
    transactionLines: [
      ...HISTORY.map((p) => row({ id: `g-${p}`, period: p, category: 'מזון וצריכה' })),
      row({ id: 'one', period: '2026-07', category: 'בריאות' }),
    ],
  });

  it('holds for a month mixing a >6 category with a once-observed one', () => {
    expect(weakestCategoryMonth(mixed)).toBe(true);
  });

  it('does NOT hold when the mature category is not observed in the once-observed months month', () => {
    // The n=1 category sits in a month where NOTHING mature contributes, so the month has no
    // weakest-vs-strongest to resolve. Groceries is restricted to the seven other periods.
    expect(
      weakestCategoryMonth(
        corpus({
          transactionLines: [
            ...HISTORY.filter((p) => p !== '2026-07').map((p) => row({ id: `g-${p}`, period: p, category: 'מזון וצריכה' })),
            row({ id: 'one', period: '2026-07', category: 'בריאות' }),
          ],
        })
      )
    ).toBe(false);
  });

  it('does NOT hold when the weakest category has TWO observations rather than one', () => {
    // Closes `min === 1` → `min <= 2`. D14's rule is about the month reporting the real n, and a
    // month whose weakest category is n=2 is a different (also real) state, not this one.
    expect(
      weakestCategoryMonth(
        corpus({
          transactionLines: [
            ...HISTORY.map((p) => row({ id: `g-${p}`, period: p, category: 'מזון וצריכה' })),
            row({ id: 'two-a', period: '2026-06', category: 'בריאות' }),
            row({ id: 'two-b', period: '2026-07', category: 'בריאות' }),
          ],
        })
      )
    ).toBe(false);
  });

  it('does NOT hold when the strongest category is merely inside the window, not above the cap', () => {
    // Closes `> DEMO_WINDOW_MONTHS` → `>= 3`. The point of the mixed month is that a category the
    // window CAPS coexists with a once-observed one; two mid-band categories do not test the cap.
    expect(
      weakestCategoryMonth(
        corpus({
          transactionLines: [
            ...HISTORY.slice(-3).map((p) => row({ id: `g-${p}`, period: p, category: 'מזון וצריכה' })),
            row({ id: 'one', period: '2026-07', category: 'בריאות' }),
          ],
        })
      )
    ).toBe(false);
  });

  it('does NOT hold when every contributing category is mature', () => {
    expect(
      weakestCategoryMonth(
        corpus({
          transactionLines: [
            ...HISTORY.map((p) => row({ id: `g-${p}`, period: p, category: 'מזון וצריכה' })),
            ...HISTORY.map((p) => row({ id: `t-${p}`, period: p, category: 'תחבורה ורכב' })),
          ],
        })
      )
    ).toBe(false);
  });
});

describe('unknownPeriodRowsInRulesPassingForms', () => {
  it('holds for two DISTINCT 10-character forms that both stamp `unknown`', () => {
    expect(
      unknownPeriodRowsInRulesPassingForms(
        corpus({
          transactionLines: DEMO_UNPARSEABLE_DATES.map((d, i) =>
            row({ id: `u${String(i)}`, date: d, period: UNKNOWN_PERIOD })
          ),
        })
      )
    ).toBe(true);
  });

  it('does NOT hold for only one form', () => {
    expect(
      unknownPeriodRowsInRulesPassingForms(
        corpus({ transactionLines: [row({ date: DEMO_UNPARSEABLE_DATES[0], period: UNKNOWN_PERIOD })] })
      )
    ).toBe(false);
  });

  it('does NOT hold when the row is stamped `unknown` but its date is READABLE — a lie in the data', () => {
    expect(
      unknownPeriodRowsInRulesPassingForms(
        corpus({
          transactionLines: [
            row({ id: 'a', date: '2026-07-05', period: UNKNOWN_PERIOD }),
            row({ id: 'b', date: '2026-06-05', period: UNKNOWN_PERIOD }),
          ],
        })
      )
    ).toBe(false);
  });

  it('does NOT hold for unparseable forms that are not TEN characters — Rules would block them', () => {
    // Closes the mutation that drops the length check. `date.size() == 10` is what a client can
    // write; an unparseable date of any other length is Admin-SDK-only and proves a different
    // thing, so it must not satisfy this condition.
    expect('nope').not.toHaveLength(RULES_DATE_SIZE_FOR_TEST);
    expect(
      unknownPeriodRowsInRulesPassingForms(
        corpus({
          transactionLines: [
            row({ id: 'a', date: 'nope', period: UNKNOWN_PERIOD }),
            row({ id: 'b', date: 'nope-either', period: UNKNOWN_PERIOD }),
          ],
        })
      )
    ).toBe(false);
  });

  it('does NOT hold for the 8-character form, however many of them there are', () => {
    // The plan's own error, held as an executable fact: `"9/3/2026"` PARSES.
    expect(
      unknownPeriodRowsInRulesPassingForms(
        corpus({
          transactionLines: [
            row({ id: 'a', date: '9/3/2026', period: UNKNOWN_PERIOD }),
            row({ id: 'b', date: '1/4/2026', period: UNKNOWN_PERIOD }),
          ],
        })
      )
    ).toBe(false);
  });
});

describe('rulesBlockedLegacyDateRowParses', () => {
  it('holds when the 8-char row is present AND carries the month its date really names', () => {
    expect(
      rulesBlockedLegacyDateRowParses(
        corpus({ transactionLines: [row({ date: DEMO_RULES_BLOCKED_LEGACY_DATE, period: '2026-03' })] })
      )
    ).toBe(true);
  });

  it('does NOT hold when that row was stamped `unknown` instead', () => {
    expect(
      rulesBlockedLegacyDateRowParses(
        corpus({ transactionLines: [row({ date: DEMO_RULES_BLOCKED_LEGACY_DATE, period: UNKNOWN_PERIOD })] })
      )
    ).toBe(false);
  });

  it('does NOT hold when the row is absent', () => {
    expect(rulesBlockedLegacyDateRowParses(corpus({ transactionLines: [row()] }))).toBe(false);
  });
});

describe('duplicateDisplayName', () => {
  it('holds when two members share a name AND that name resolves to nobody', () => {
    const members = [member('a', 'עומר לוי'), member('b', 'עומר לוי'), member('c', 'דויד לוי')];
    expect(duplicateDisplayName(corpus({ members }))).toBe(true);
  });

  it('does NOT hold when every name is unique', () => {
    expect(duplicateDisplayName(corpus({ members: [member('a', 'עומר'), member('b', 'דויד')] }))).toBe(false);
  });
});

describe('unknownOwnerRowsFromBothCauses', () => {
  const members = [member('a', 'עומר לוי'), member('b', 'עומר לוי'), member('c', 'דויד לוי')];

  it('holds when one row is ambiguous and another is orphaned', () => {
    expect(
      unknownOwnerRowsFromBothCauses(
        corpus({
          members,
          transactionLines: [
            row({ id: 'dup', owner: 'עומר לוי', ownerId: UNKNOWN_OWNER_ID }),
            row({ id: 'orphan', owner: 'מישהו אחר', ownerId: UNKNOWN_OWNER_ID }),
          ],
        })
      )
    ).toBe(true);
  });

  it('does NOT hold with only the orphan cause', () => {
    expect(
      unknownOwnerRowsFromBothCauses(
        corpus({ members, transactionLines: [row({ id: 'orphan', owner: 'מישהו אחר', ownerId: UNKNOWN_OWNER_ID })] })
      )
    ).toBe(false);
  });

  it('does NOT hold with only the ambiguous cause', () => {
    expect(
      unknownOwnerRowsFromBothCauses(
        corpus({ members, transactionLines: [row({ id: 'dup', owner: 'עומר לוי', ownerId: UNKNOWN_OWNER_ID })] })
      )
    ).toBe(false);
  });

  it('does NOT hold when the rows carry `unknown` but the names actually resolve', () => {
    expect(
      unknownOwnerRowsFromBothCauses(
        corpus({
          members,
          transactionLines: [
            row({ id: 'a', owner: 'דויד לוי', ownerId: UNKNOWN_OWNER_ID }),
            row({ id: 'b', owner: 'דויד לוי', ownerId: UNKNOWN_OWNER_ID }),
          ],
        })
      )
    ).toBe(false);
  });
});

describe('instalmentNullRow', () => {
  it('holds for `totalInstallments` set with `installmentNumber: null`', () => {
    expect(instalmentNullRow(corpus({ transactionLines: [row({ totalInstallments: 6, installmentNumber: null })] }))).toBe(true);
  });

  it('does NOT hold when the number is present', () => {
    expect(instalmentNullRow(corpus({ transactionLines: [row({ totalInstallments: 6, installmentNumber: 2 })] }))).toBe(false);
  });

  it('does NOT hold when `totalInstallments` is absent too — that is an ordinary row', () => {
    expect(instalmentNullRow(corpus({ transactionLines: [row()] }))).toBe(false);
  });
});

describe('collidingInstalmentPlans', () => {
  const collide = [
    row({ id: 'p1', period: '2026-07', date: '2026-07-05', vendor: 'אייס', amount: 300, installmentNumber: 3, totalInstallments: 4, category: 'שונות' }),
    row({ id: 'p2', period: '2026-07', date: '2026-07-20', vendor: 'אייס', amount: 300, installmentNumber: 2, totalInstallments: 4, category: 'שונות' }),
  ];

  it('holds for two distinct plans the real `planKeyOf` merges into one projection', () => {
    expect(collidingInstalmentPlans(corpus({ transactionLines: collide }))).toBe(true);
  });

  it('does NOT hold when the amounts differ — the key separates them, which is the correct case', () => {
    expect(
      collidingInstalmentPlans(
        corpus({ transactionLines: [collide[0], { ...collide[1], amount: 900 }] })
      )
    ).toBe(false);
  });

  it('does NOT hold when the instalment numbers AGREE — that is a duplicate import, not two plans', () => {
    // Closes the mutation that drops the differing-number requirement. Two identical rows are one
    // purchase imported twice; R5's disclosure is about two DIFFERENT purchases being merged.
    expect(
      collidingInstalmentPlans(
        corpus({ transactionLines: [collide[0], { ...collide[1], installmentNumber: collide[0].installmentNumber }] })
      )
    ).toBe(false);
  });

  it('does NOT hold for a single plan', () => {
    expect(collidingInstalmentPlans(corpus({ transactionLines: [collide[0]] }))).toBe(false);
  });
});

describe('malformedIncomePeriod', () => {
  it('holds for a row whose month/year pair cannot be read', () => {
    expect(malformedIncomePeriod(corpus({ incomes: [income({ month: '13', period: UNKNOWN_PERIOD })] }))).toBe(true);
  });

  it('does NOT hold when every pair is readable', () => {
    expect(malformedIncomePeriod(corpus({ incomes: [income()] }))).toBe(false);
  });

  it('does NOT hold when the pair is readable but the stamp says `unknown` — that is a different bug', () => {
    expect(malformedIncomePeriod(corpus({ incomes: [income({ month: '07', year: '2026', period: UNKNOWN_PERIOD })] }))).toBe(false);
  });
});

describe('refundCreditRowSplitsThePredicates', () => {
  const refund = row({ id: 'refund', period: '2026-06', category: 'מזון וצריכה', isCredit: true, paymentType: 'refund' });
  const history = HISTORY.map((p) => row({ id: `g-${p}`, period: p, category: 'מזון וצריכה' }));

  it('holds for an `isCredit` + `refund` row in an observed category inside the window', () => {
    expect(refundCreditRowSplitsThePredicates(corpus({ transactionLines: [...history, refund] }))).toBe(true);
  });

  it('does NOT hold for a plain credit — both predicates reject it, so they agree', () => {
    expect(
      refundCreditRowSplitsThePredicates(
        corpus({ transactionLines: [...history, { ...refund, paymentType: 'transfer' }] })
      )
    ).toBe(false);
  });

  it('does NOT hold for a refund that is not a credit — both predicates accept it', () => {
    expect(
      refundCreditRowSplitsThePredicates(
        corpus({ transactionLines: [...history, { ...refund, isCredit: false }] })
      )
    ).toBe(false);
  });

  it('does NOT hold when the row sits OUTSIDE the window — the average never reads it', () => {
    expect(
      refundCreditRowSplitsThePredicates(
        corpus({ transactionLines: [...history, { ...refund, period: '2025-12' }] })
      )
    ).toBe(false);
  });

  it('does NOT hold when its category has no observations at all', () => {
    expect(refundCreditRowSplitsThePredicates(corpus({ transactionLines: [refund] }))).toBe(false);
  });
});

describe('collidingAssumptions', () => {
  const pair = [
    assumption({ id: 'a', ownerId: 'm1', amountILS: 4200, updatedAt: '2026-08-10T09:00:00.000Z' }),
    assumption({ id: 'b', ownerId: 'm2', amountILS: 3500, updatedAt: '2026-08-14T17:00:00.000Z' }),
  ];

  it('holds for two owners, one bucket, different updatedAt AND different amounts', () => {
    expect(collidingAssumptions(corpus({ forecastAssumptions: pair }))).toBe(true);
  });

  it('does NOT hold when both belong to the same owner', () => {
    expect(collidingAssumptions(corpus({ forecastAssumptions: [pair[0], { ...pair[1], ownerId: 'm1' }] }))).toBe(false);
  });

  it('does NOT hold when `updatedAt` is equal — D20s middle tier would be shadowed', () => {
    expect(
      collidingAssumptions(corpus({ forecastAssumptions: [pair[0], { ...pair[1], updatedAt: pair[0].updatedAt }] }))
    ).toBe(false);
  });

  it('does NOT hold when the amounts are equal — the winner would show only in an ordering', () => {
    expect(
      collidingAssumptions(corpus({ forecastAssumptions: [pair[0], { ...pair[1], amountILS: pair[0].amountILS }] }))
    ).toBe(false);
  });

  it('does NOT hold when they sit in different buckets', () => {
    expect(
      collidingAssumptions(corpus({ forecastAssumptions: [pair[0], { ...pair[1], scopeId: 'בריאות' }] }))
    ).toBe(false);
  });
});

describe('seasonalityAssumption', () => {
  it('holds for a seasonality scope carrying an in-range factor AND a scope id that parses', () => {
    expect(
      seasonalityAssumption(
        corpus({
          forecastAssumptions: [
            assumption({ scopeKind: 'seasonality', scopeId: 'תחבורה ורכב:09', factor: 1.8 }),
          ],
        })
      )
    ).toBe(true);
  });

  it("does NOT hold when the scope id does not parse — T6's inert-factor defect, as a condition", () => {
    // The T4 corpus carried a BARE CATEGORY here, so `parseSeasonalityScopeId` returned null and
    // the factor could never be applied to anything. Every assertion about the document was true.
    expect(
      seasonalityAssumption(
        corpus({ forecastAssumptions: [assumption({ scopeKind: 'seasonality', scopeId: 'תחבורה ורכב', factor: 1.8 })] })
      )
    ).toBe(false);
    expect(
      seasonalityAssumption(
        corpus({ forecastAssumptions: [assumption({ scopeKind: 'seasonality', scopeId: 'תחבורה ורכב:13', factor: 1.8 })] })
      )
    ).toBe(false);
  });

  it('does NOT hold without a factor — a seasonal scope with no multiplier scales nothing', () => {
    expect(
      seasonalityAssumption(
        corpus({ forecastAssumptions: [assumption({ scopeKind: 'seasonality', scopeId: 'תחבורה ורכב:09' })] })
      )
    ).toBe(false);
  });

  it('does NOT hold for a factor outside SEASONAL_FACTOR_MIN/MAX — Rules would deny it', () => {
    expect(
      seasonalityAssumption(
        corpus({
          forecastAssumptions: [assumption({ scopeKind: 'seasonality', scopeId: 'תחבורה ורכב:09', factor: 9 })],
        })
      )
    ).toBe(false);
  });

  it('does NOT hold for any other scope kind', () => {
    expect(seasonalityAssumption(corpus({ forecastAssumptions: [assumption({ factor: 1.8 })] }))).toBe(false);
  });
});

describe('personalTargetAssumption', () => {
  it('holds when the target is owned by the member it is about', () => {
    expect(
      personalTargetAssumption(
        corpus({ forecastAssumptions: [assumption({ scopeKind: 'personalTarget', ownerId: 'omer', scopeId: 'omer' })] })
      )
    ).toBe(true);
  });

  it('does NOT hold when it is a target ABOUT one member authored BY another — Rules deny that', () => {
    expect(
      personalTargetAssumption(
        corpus({ forecastAssumptions: [assumption({ scopeKind: 'personalTarget', ownerId: 'david', scopeId: 'omer' })] })
      )
    ).toBe(false);
  });

  it('does NOT hold when there is no personalTarget at all', () => {
    expect(personalTargetAssumption(corpus({ forecastAssumptions: [assumption()] }))).toBe(false);
  });

  // ── !! T6 review, F4 — the three fields the OLD condition could not see ──────────────────────
  //
  // It read `scopeKind` and `scopeId === ownerId` directly. Everything below was invisible to it,
  // and each of these was a way for the corpus's target to be present, well-formed and INERT.

  it('!! does NOT hold when `fromPeriod` is past the horizon — the reproduced surviving mutant', () => {
    // This is the exact mutation the review applied to the corpus: the document is still a
    // self-owned `personalTarget` with a positive amount, and it resolves to nothing.
    const past = corpus({
      forecastAssumptions: [
        assumption({ scopeKind: 'personalTarget', ownerId: 'omer', scopeId: 'omer', fromPeriod: '2030-01' }),
      ],
    });
    expect(personalTargetAssumption(past)).toBe(false);
  });

  it('!! does NOT hold when the target is RETIRED — an inactive target is not a target', () => {
    expect(
      personalTargetAssumption(
        corpus({
          forecastAssumptions: [
            assumption({ scopeKind: 'personalTarget', ownerId: 'omer', scopeId: 'omer', status: 'retired' }),
          ],
        })
      )
    ).toBe(false);
  });

  it('!! does NOT hold at ₪0 — a target of zero is one a family met by doing nothing', () => {
    expect(
      personalTargetAssumption(
        corpus({
          forecastAssumptions: [
            assumption({ scopeKind: 'personalTarget', ownerId: 'omer', scopeId: 'omer', amountILS: 0 }),
          ],
        })
      )
    ).toBe(false);
  });

  it('!! the AMOUNT check is load-bearing — an amount `roundILS` moves does not satisfy it', () => {
    // Sweep survivor: dropping `resolved.amountILS === a.amountILS` survived, because no corpus and
    // no fixture could make the two differ. They differ here. `resolveTarget` returns
    // `roundILS(winner.amountILS)`, so a target stored at sub-agora precision comes back as a
    // DIFFERENT number — and this condition is about the corpus's own document being the answer,
    // not about something having resolved. It also states a real requirement of the corpus: a
    // target amount has to be agorot-clean, like every other money figure this stage produces.
    const subAgora = corpus({
      forecastAssumptions: [
        assumption({ scopeKind: 'personalTarget', ownerId: 'omer', scopeId: 'omer', amountILS: 500.005 }),
      ],
    });
    expect(resolveTarget({ memberId: 'omer', horizon: HORIZON, assumptions: subAgora.forecastAssumptions, goals: [] }))
      .toMatchObject({ amountILS: 500.01 });
    expect(personalTargetAssumption(subAgora)).toBe(false);
  });

  it('!! the SOURCE check is SUBSUMED today, and the implication is pinned rather than the line', () => {
    // Sweep survivor, kept deliberately — the same treatment T5 gave `statisticalLayerGate` and T6
    // gave `known.includes(anchor)`. `isFamilyScoped === false` can only be produced by the
    // `personalTarget` source, because it is the only non-family source `resolveTarget` has left
    // (D29's `budgetConfig` source was removed by F6, and `goal` is family-scoped by definition).
    // The `source` check stays because it is the line that states WHICH answer this condition is
    // about; this pin is what fails, instead of the line quietly becoming load-bearing and
    // untested, on the day a second personal-scoped source is added.
    const personal = assumption({ scopeKind: 'personalTarget', ownerId: 'omer', scopeId: 'omer' });
    const resolvedPersonal = resolveTarget({ memberId: 'omer', horizon: HORIZON, assumptions: [personal], goals: [] });
    expect(resolvedPersonal).toMatchObject({ isFamilyScoped: false, source: 'personalTarget' });
    // …and the only other source there is, is family-scoped.
    const familyGoal = resolveTarget({
      memberId: 'omer',
      horizon: HORIZON,
      assumptions: [],
      goals: [{ firestoreId: 'g', name: 'x', target: 9000, current: 0, date: `${HEBREW_MONTH_NAMES[8]} 2026` }],
    });
    expect(familyGoal).toMatchObject({ isFamilyScoped: true, source: 'goal' });
  });

  it('!! and it goes THROUGH `resolveTarget` — the amount has to come back, not just a status', () => {
    // A condition that only asked "did something resolve" would pass on a resolver that returned
    // the family goal total instead. The document's OWN amount is what has to come back.
    const own = assumption({
      scopeKind: 'personalTarget',
      ownerId: 'omer',
      scopeId: 'omer',
      amountILS: 512.5,
    });
    expect(personalTargetAssumption(corpus({ forecastAssumptions: [own] }))).toBe(true);
    expect(
      resolveTarget({ memberId: 'omer', horizon: HORIZON, assumptions: [own], goals: [] })
    ).toMatchObject({ status: 'target', source: 'personalTarget', amountILS: 512.5, isFamilyScoped: false });
  });
});

describe('assumptionOverridesCertainItem', () => {
  const withLoan = {
    loans: [loan({ id: 'l1', endDate: '2026-08-31' })],
    forecastAssumptions: [assumption({ scopeKind: 'loan', scopeId: 'l1', fromPeriod: '2026-08', amountILS: 400 })],
  };

  it('holds when the assumption resolves onto a bucket a certain item already occupies', () => {
    expect(assumptionOverridesCertainItem(corpus(withLoan))).toBe(true);
  });

  it('does NOT hold when the certain item is absent', () => {
    expect(assumptionOverridesCertainItem(corpus({ ...withLoan, loans: [] }))).toBe(false);
  });

  it('does NOT hold for a personalTarget — `resolveCategoryOfScope` maps it to null deliberately', () => {
    expect(
      assumptionOverridesCertainItem(
        corpus({ ...withLoan, forecastAssumptions: [assumption({ scopeKind: 'personalTarget', scopeId: 'm1' })] })
      )
    ).toBe(false);
  });

  it('does NOT hold when the assumption starts after every certain charge', () => {
    expect(
      assumptionOverridesCertainItem(
        corpus({ ...withLoan, forecastAssumptions: [assumption({ scopeKind: 'loan', scopeId: 'l1', fromPeriod: '2026-10' })] })
      )
    ).toBe(false);
  });
});

describe('zeroAmountSingleObservationCategory', () => {
  it('holds for a category with exactly one observation, and it is ₪0', () => {
    expect(
      zeroAmountSingleObservationCategory(
        corpus({ transactionLines: [row({ category: 'מגורים ובית', period: '2026-07', amount: 0 })] })
      )
    ).toBe(true);
  });

  it('does NOT hold when the single observation is non-zero — D27 says so in as many words', () => {
    expect(
      zeroAmountSingleObservationCategory(
        corpus({ transactionLines: [row({ category: 'מגורים ובית', period: '2026-07', amount: 300 })] })
      )
    ).toBe(false);
  });

  it('does NOT hold for a ₪0 row whose category has NO observation at all — that is D26 row 0', () => {
    // Closes the mutation that drops the `monthsObserved === 1` check. A single ₪0 row stamped
    // `'unknown'` gives its category ZERO observations, and "no history" and "one observation of
    // ₪0" are the two branches §12 insists must not share a rendering.
    const c = corpus({
      recurring: [recurringItem({ category: 'מגורים ובית' })],
      transactionLines: [row({ category: 'מגורים ובית', period: UNKNOWN_PERIOD, amount: 0 })],
    });
    expect(monthsObservedByCategory(c).get('מגורים ובית')).toBe(0);
    expect(zeroAmountSingleObservationCategory(c)).toBe(false);
  });

  it('does NOT hold when a ₪0 row sits in a category with other observations', () => {
    expect(
      zeroAmountSingleObservationCategory(
        corpus({
          transactionLines: [
            row({ id: 'z', category: 'מגורים ובית', period: '2026-07', amount: 0 }),
            row({ id: 'o', category: 'מגורים ובית', period: '2026-06', amount: 900 }),
          ],
        })
      )
    ).toBe(false);
  });
});

describe('emptyCertainMonth', () => {
  const bracketed = {
    emptyCertainPeriod: '2026-09',
    recurring: [
      recurringItem({ id: 'a', endDate: '2026-08-31' }),
      recurringItem({ id: 'b', startDate: '2026-10-01' }),
    ],
    loans: [loan({ id: 'l', endDate: '2026-08-31' })],
    insurances: [insurance({ status: 'lapsed' })],
  };

  it('holds when the named month is empty and BOTH neighbours are not', () => {
    expect(emptyCertainMonth(corpus(bracketed))).toBe(true);
  });

  it('does NOT hold when an active insurance charges in every month', () => {
    expect(emptyCertainMonth(corpus({ ...bracketed, insurances: [insurance({ status: 'active' })] }))).toBe(false);
  });

  it('does NOT hold when a recurring item spans the gap', () => {
    expect(
      emptyCertainMonth(corpus({ ...bracketed, recurring: [recurringItem({ id: 'a' })] }))
    ).toBe(false);
  });

  it('does NOT hold when the whole horizon is empty — that is a corpus with no certain layer', () => {
    expect(emptyCertainMonth(corpus({ emptyCertainPeriod: '2026-09' }))).toBe(false);
  });
});

describe('recurringAndManualRowsShareACategoryMonth', () => {
  it('holds when one month and category carry a posted row and a manual one', () => {
    expect(
      recurringAndManualRowsShareACategoryMonth(
        corpus({
          transactionLines: [
            row({ id: 'posted', period: '2026-07', category: 'בריאות', recurringId: 'rec' }),
            row({ id: 'manual', period: '2026-07', category: 'בריאות' }),
          ],
        })
      )
    ).toBe(true);
  });

  it('does NOT hold when they sit in different months', () => {
    expect(
      recurringAndManualRowsShareACategoryMonth(
        corpus({
          transactionLines: [
            row({ id: 'posted', period: '2026-07', category: 'בריאות', recurringId: 'rec' }),
            row({ id: 'manual', period: '2026-06', category: 'בריאות' }),
          ],
        })
      )
    ).toBe(false);
  });

  it('does NOT hold when they share a MONTH but not a category — the double count is per bucket', () => {
    // Closes the mutation that buckets on period alone. D23's exclusion changes a number only where
    // the posted row and the manual row land in the SAME category total.
    expect(
      recurringAndManualRowsShareACategoryMonth(
        corpus({
          transactionLines: [
            row({ id: 'posted', period: '2026-07', category: 'בריאות', recurringId: 'rec' }),
            row({ id: 'manual', period: '2026-07', category: 'מזון וצריכה' }),
          ],
        })
      )
    ).toBe(false);
  });

  it('does NOT hold when no row carries a recurringId', () => {
    expect(
      recurringAndManualRowsShareACategoryMonth(
        corpus({ transactionLines: [row({ id: 'a', period: '2026-07' }), row({ id: 'b', period: '2026-07' })] })
      )
    ).toBe(false);
  });
});

describe('bothRecurringKindsAndAnInactiveItem', () => {
  it('holds for income + expense + a non-active item', () => {
    expect(
      bothRecurringKindsAndAnInactiveItem(
        corpus({
          recurring: [
            recurringItem({ id: 'i', kind: 'income' }),
            recurringItem({ id: 'e', kind: 'expense' }),
            recurringItem({ id: 'p', status: 'paused' }),
          ],
        })
      )
    ).toBe(true);
  });

  it('does NOT hold without an income item', () => {
    expect(
      bothRecurringKindsAndAnInactiveItem(
        corpus({ recurring: [recurringItem({ id: 'e' }), recurringItem({ id: 'p', status: 'paused' })] })
      )
    ).toBe(false);
  });

  it('does NOT hold when every item is active', () => {
    expect(
      bothRecurringKindsAndAnInactiveItem(
        corpus({ recurring: [recurringItem({ id: 'i', kind: 'income' }), recurringItem({ id: 'e' })] })
      )
    ).toBe(false);
  });
});

describe('loansEndingInsideAndOutsideHorizon', () => {
  it('holds for one loan ending inside the horizon and one beyond it', () => {
    expect(
      loansEndingInsideAndOutsideHorizon(
        corpus({ loans: [loan({ id: 'in', endDate: '2026-08-31' }), loan({ id: 'out', endDate: '2051-09-30' })] })
      )
    ).toBe(true);
  });

  it('does NOT hold when both end inside', () => {
    expect(
      loansEndingInsideAndOutsideHorizon(
        corpus({ loans: [loan({ id: 'a', endDate: '2026-08-31' }), loan({ id: 'b', endDate: '2026-09-30' })] })
      )
    ).toBe(false);
  });

  it('does NOT hold when both end outside', () => {
    expect(
      loansEndingInsideAndOutsideHorizon(
        corpus({ loans: [loan({ id: 'a', endDate: '2051-09-30' }), loan({ id: 'b', endDate: '2049-01-31' })] })
      )
    ).toBe(false);
  });
});

describe('bothPremiumFrequenciesAsDocuments', () => {
  it('holds for one monthly and one yearly policy', () => {
    expect(
      bothPremiumFrequenciesAsDocuments(
        corpus({ insurances: [insurance({ id: 'm' }), insurance({ id: 'y', premiumFrequency: 'yearly' })] })
      )
    ).toBe(true);
  });

  it('does NOT hold for two monthly policies', () => {
    expect(
      bothPremiumFrequenciesAsDocuments(corpus({ insurances: [insurance({ id: 'a' }), insurance({ id: 'b' })] }))
    ).toBe(false);
  });

  it('!! IT HOLDS FOR TWO INACTIVE POLICIES — which is what the demo corpus actually carries (F-7)', () => {
    // The renaming, made provable. Both demo policies are inactive, so
    // `projectInsuranceForward`'s `status !== 'active'` early return precedes the frequency
    // branch and NO PROJECTOR ON THIS CORPUS EVER READS `premiumFrequency`. The condition is
    // satisfied anyway — it is a statement about DOCUMENTS, and its id now says so.
    const lapsedMonthly = insurance({ id: 'm', status: 'lapsed' });
    const cancelledYearly = insurance({ id: 'y', premiumFrequency: 'yearly', status: 'cancelled' });
    expect(bothPremiumFrequenciesAsDocuments(corpus({ insurances: [lapsedMonthly, cancelledYearly] }))).toBe(true);
    expect(certainLineItems(corpus({ insurances: [lapsedMonthly, cancelledYearly] })).filter((i) => i.basis.kind === 'insurance')).toEqual([]);
  });

  it('!! AND MAKING IT PROVE ITS NAME IS MUTUALLY EXCLUSIVE WITH `emptyCertainMonth` — held, not asserted', () => {
    // Strengthening this condition to "both frequencies on ACTIVE policies" is not a small change,
    // it is a different corpus: an active insurance charges in EVERY horizon month, so the empty
    // certain month — §12's A9 branch, and one of the four paths only T4 can reach — stops
    // existing. That is why F-7 is closed by a rename and not by a stronger predicate.
    const bracketedHorizon = {
      emptyCertainPeriod: '2026-09',
      recurring: [recurringItem({ id: 'a', endDate: '2026-08-31' }), recurringItem({ id: 'b', startDate: '2026-10-01' })],
      loans: [loan({ id: 'l', endDate: '2026-08-31' })],
    };
    const inactive = [insurance({ id: 'm', status: 'lapsed' }), insurance({ id: 'y', premiumFrequency: 'yearly', status: 'cancelled' })];
    const active = [insurance({ id: 'm', status: 'active' }), insurance({ id: 'y', premiumFrequency: 'yearly', status: 'active' })];

    // As shipped: both frequencies present, empty certain month intact.
    expect(bothPremiumFrequenciesAsDocuments(corpus({ ...bracketedHorizon, insurances: inactive }))).toBe(true);
    expect(emptyCertainMonth(corpus({ ...bracketedHorizon, insurances: inactive }))).toBe(true);

    // Strengthened so a projector really reads the frequency: the empty certain month is gone.
    expect(bothPremiumFrequenciesAsDocuments(corpus({ ...bracketedHorizon, insurances: active }))).toBe(true);
    expect(emptyCertainMonth(corpus({ ...bracketedHorizon, insurances: active }))).toBe(false);
  });
});

describe('everyAssumptionIsSourceUser', () => {
  it('holds when every assumption is user-authored — and requires at least one to exist', () => {
    expect(everyAssumptionIsSourceUser(corpus({ forecastAssumptions: [assumption()] }))).toBe(true);
  });

  it('does NOT hold when one carries `insight` — Rules deny it in Stage 7', () => {
    expect(
      everyAssumptionIsSourceUser(
        corpus({ forecastAssumptions: [assumption({ id: 'a' }), assumption({ id: 'b', source: 'insight' })] })
      )
    ).toBe(false);
  });

  it('does NOT hold vacuously on an empty list', () => {
    expect(everyAssumptionIsSourceUser(corpus())).toBe(false);
  });
});

describe('crossesHistoryRowCeiling', () => {
  it('holds when one window read returns more than the ceiling', () => {
    expect(
      crossesHistoryRowCeiling(corpus({ transactionLines: rows(HISTORY_ROW_CEILING + 1, { period: '2026-07' }) }))
    ).toBe(true);
  });

  it('does NOT hold at exactly the ceiling — the degradation is ABOVE it', () => {
    expect(
      crossesHistoryRowCeiling(corpus({ transactionLines: rows(HISTORY_ROW_CEILING, { period: '2026-07' }) }))
    ).toBe(false);
  });

  it('does NOT hold when the volume sits OUTSIDE the window — the read never fetches it', () => {
    expect(
      crossesHistoryRowCeiling(corpus({ transactionLines: rows(HISTORY_ROW_CEILING + 1, { period: '2025-12' }) }))
    ).toBe(false);
  });
});

describe('twentyMembersWithMoney', () => {
  const twenty: DemoMember[] = Array.from({ length: 20 }, (_, i) => member(`m${String(i)}`, `בן משפחה ${String(i)}`));
  const moneyFor = (members: DemoMember[]): DemoTransactionLine[] =>
    members.map((m) => row({ id: `r-${m.id}`, ownerId: m.id, owner: m.name, amount: 100 }));

  it('holds for twenty attributable members who each own real money', () => {
    expect(twentyMembersWithMoney(corpus({ members: twenty, transactionLines: moneyFor(twenty) }))).toBe(true);
  });

  it('does NOT hold when one attributable member owns nothing', () => {
    expect(
      twentyMembersWithMoney(corpus({ members: twenty, transactionLines: moneyFor(twenty.slice(1)) }))
    ).toBe(false);
  });

  it('does NOT hold when a member owns only ₪0 rows — a member with no money is not "with money"', () => {
    const withZero = moneyFor(twenty).map((r) => (r.id === 'r-m3' ? { ...r, amount: 0 } : r));
    expect(twentyMembersWithMoney(corpus({ members: twenty, transactionLines: withZero }))).toBe(false);
  });

  it('does NOT hold below twenty members', () => {
    const nineteen = twenty.slice(0, 19);
    expect(twentyMembersWithMoney(corpus({ members: nineteen, transactionLines: moneyFor(nineteen) }))).toBe(false);
  });

  it('ignores members whose display name is ambiguous — no row can be attributed to them', () => {
    const withDuplicate = [...twenty, member('dup-a', 'תאום'), member('dup-b', 'תאום')];
    expect(
      twentyMembersWithMoney(corpus({ members: withDuplicate, transactionLines: moneyFor(twenty) }))
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The registry itself
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('the condition registry', () => {
  it('every id is unique — an id is what a failing assertion reports', () => {
    const ids = DEMO_CORPUS_CONDITIONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every condition declares a variant, and both variants are used', () => {
    expect(DEMO_CORPUS_CONDITIONS.every((c) => c.variant === 'base' || c.variant === 'scale')).toBe(true);
    expect(DEMO_CORPUS_CONDITIONS.some((c) => c.variant === 'scale')).toBe(true);
    expect(DEMO_CORPUS_CONDITIONS.some((c) => c.variant === 'base')).toBe(true);
  });

  it('every condition names why it exists — a nameless presence check is the tautology D27 deletes', () => {
    expect(DEMO_CORPUS_CONDITIONS.every((c) => c.why.trim().length > 0)).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T4 REVIEW F-4 — !! NO DEAD ENTRIES. THE REGISTRY CAN GROW A CONDITION NOTHING TESTS.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  //
  // The review proved it: a plausible 25th condition, with no dedicated test and the pinned count
  // bumped by one, left the WHOLE SUITE GREEN. Its entry would then be checked by exactly one
  // thing — `demoCorpus.test.ts`'s generated `it` per condition, which asserts it `holds` on the
  // generator's own output. That pairing is circular by construction, and this file's own header
  // says so in its first paragraph.
  //
  // It is precisely the class the fix batch closed for `INDIRECT_TRANSACTION_LINE_WRITERS`, where
  // a dead allow-list entry had been redirecting a write the guard never matched for a whole task.
  // The no-dead-entries assertion was added THERE and not to this table, which is newer, more
  // load-bearing (the seeder REFUSES to write a corpus on which any of these fails) and has 24
  // entries to that one's three.
  //
  // A DEDICATED BLOCK IS NOT ENOUGH — IT MUST CARRY A NEGATIVE CASE. A block containing only
  // positives is satisfied by a predicate that returns `true` unconditionally, which is the same
  // dead entry wearing a test.

  /** This file's own top-level `describe` blocks, keyed by title. */
  const testBlocks = (source: string): Map<string, string> => {
    const starts = [...source.matchAll(/^describe\('([^']+)'/gm)];
    const blocks = new Map<string, string>();
    starts.forEach((match, i) => {
      const from = match.index ?? 0;
      const to = i + 1 < starts.length ? (starts[i + 1].index ?? source.length) : source.length;
      blocks.set(match[1], source.slice(from, to));
    });
    return blocks;
  };

  /** The predicate, kept pure so a SYNTHETIC registry can prove it fires. */
  const conditionsWithoutADedicatedTest = (ids: string[], source: string): string[] => {
    const blocks = testBlocks(source);
    return ids.filter((id) => {
      const block = blocks.get(id);
      return block === undefined || !block.includes('does NOT hold');
    });
  };

  const thisFile = (): string =>
    readFileSync(join(REPO_ROOT, 'src/__tests__/demoCorpusConditions.test.ts'), 'utf8');

  it('!! NO DEAD ENTRIES — every registered condition has its own block here, WITH a negative case', () => {
    expect(conditionsWithoutADedicatedTest(DEMO_CORPUS_CONDITIONS.map((c) => c.id), thisFile())).toEqual([]);
  });

  it('!! AND THE GUARD FIRES — the review\'s own 25th condition, and a block with only positives', () => {
    // The failure mode of every structural guard in this repo: passing because it found nothing.
    // Both halves are shown catching something, on synthetic input, rather than asserted.
    expect(conditionsWithoutADedicatedTest(['aPlausibleTwentyFifthCondition'], thisFile()))
      .toEqual(['aPlausibleTwentyFifthCondition']);
    const positivesOnly = "describe('halfTestedCondition', () => {\n  it('holds for the good case', () => {});\n});\n";
    expect(conditionsWithoutADedicatedTest(['halfTestedCondition'], positivesOnly)).toEqual(['halfTestedCondition']);
    expect(
      conditionsWithoutADedicatedTest(
        ['halfTestedCondition'],
        `${positivesOnly.slice(0, -4)}  it('does NOT hold for the bad case', () => {});\n});\n`
      )
    ).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T4 REVIEW F-5 — THE SEEDER'S REFUSAL, AS A VALUE A TEST CAN HOLD
  // ───────────────────────────────────────────────────────────────────────────────────────────
  //
  // `scripts/seed-demo-finances.ts`'s header and its commit message both claim it refuses to write
  // a corpus on which any condition fails. It does — and NOTHING TESTED IT. The emulator test
  // asserted the happy path only, so the safety net for the whole task was itself shadowed. Both
  // decisions the script was making — which conditions APPLY, and which of them FAILED — now live
  // in `demoCorpusConditions.ts` and are exercised here.

  it('!! failingConditionIds NAMES every applicable condition that does not hold', () => {
    // The empty corpus is the strongest input: nothing holds on it, so every applicable condition
    // must appear. If this returned `[]` the seeder would happily write a corpus with nothing in
    // it — which is the state D27 exists to make impossible.
    const empty = corpus();
    const failing = failingConditionIds(empty);
    const base = DEMO_CORPUS_CONDITIONS.filter((c) => c.variant === 'base').map((c) => c.id);
    expect(failing).toEqual(base);
    expect(failing.length).toBeGreaterThan(0);
  });

  it("SCALE conditions are n/a below the large-family size — not failures, or every base run would refuse", () => {
    const empty = corpus();
    expect(empty.members.length).toBeLessThan(DEMO_LARGE_MEMBER_COUNT);
    const scaleIds = DEMO_CORPUS_CONDITIONS.filter((c) => c.variant === 'scale').map((c) => c.id);
    for (const id of scaleIds) expect(failingConditionIds(empty)).not.toContain(id);
    expect(conditionOutcomes(empty).filter((o) => !o.applicable).map((o) => o.id)).toEqual(scaleIds);
  });

  it('!! AND AT THE LARGE-FAMILY SIZE THEY BECOME FAILURES — the applicability rule is a real switch', () => {
    // Non-vacuity for the rule itself: if `applicable` were hard-wired to `false` for `'scale'`,
    // the two conditions that only the 20-member variant can prove would be permanently exempt and
    // nothing would notice.
    const twenty = corpus({
      members: Array.from({ length: DEMO_LARGE_MEMBER_COUNT }, (_, i) => member(`m${String(i)}`, `בן משפחה ${String(i)}`)),
    });
    expect(conditionOutcomes(twenty).every((o) => o.applicable)).toBe(true);
    expect(failingConditionIds(twenty)).toEqual(DEMO_CORPUS_CONDITIONS.map((c) => c.id));
  });

  it('the applicability threshold is DEMO_LARGE_MEMBER_COUNT, not a second literal 20', () => {
    // The script had it written as a bare `20` beside a module already exporting the constant —
    // two numbers free to drift, which is the class this stage's HISTORY_ROW_CEILING ruling names.
    // `scripts/` is where that literal lived, so `scripts/` is where the assertion looks.
    const stripped = stripComments(
      readFileSync(join(REPO_ROOT, 'scripts/seed-demo-finances.ts'), 'utf8'),
      'scripts/seed-demo-finances.ts'
    );
    expect(stripped).not.toMatch(/members\.length\s*>=\s*\d/);
    expect(stripped).toContain('failingConditionIds(corpus)');
    expect(stripped).toContain('conditionOutcomes(corpus)');
  });

  it('!! AND THE SCRIPT STILL REFUSES ON A NON-EMPTY RESULT — the branch, read out of its source', () => {
    // The gap this cannot close, stated rather than papered over: the refusal is UNREACHABLE from
    // the script's own CLI. Every condition holds for seeds 1..400, for eight `--as-of` dates and
    // for member counts 4..400, because the corpus is deterministic and almost entirely
    // hand-constructed — which is precisely why no end-to-end run ever exercised this branch and
    // why it had no test. What it protects is a FUTURE edit to the generator or to a predicate.
    // The decision above is held by a suite; the `process.exit(1)` is held structurally, here.
    const stripped = stripComments(
      readFileSync(join(REPO_ROOT, 'scripts/seed-demo-finances.ts'), 'utf8'),
      'scripts/seed-demo-finances.ts'
    );
    expect(stripped).toMatch(/if \(failing\.length > 0\) \{[\s\S]*?process\.exit\(1\);[\s\S]*?\}/);
    // …and it names them, because "3 conditions failed" sends an operator to read 24 predicates.
    expect(stripped).toContain("failing.join(', ')");
  });

  it('evaluates all of them and reports every one FALSE on an empty corpus', () => {
    // The single most important assertion in the file: on a corpus with nothing in it, NOTHING
    // holds. A condition that passes here is a condition that would pass on the real corpus too.
    const results = evaluateDemoCorpusConditions(corpus());
    expect(results).toHaveLength(DEMO_CORPUS_CONDITIONS.length);
    expect(results.filter((r) => r.holds).map((r) => r.id)).toEqual([]);
  });
});
