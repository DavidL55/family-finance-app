// src/__tests__/forecastInputs.test.ts — Stage 7 T7a.
//
// The three pure pieces `useForecast` needed and nobody had built: the assumption→line-item joint
// (which is what finally gives `resolveCategoryOfScope` and `resolveLayerPrecedence`'s assumption
// branch a production caller), D17's suppression rule, and D38's verdict threshold.
//
// Each is written STUB-FIRST and proven red before the implementation was restored — the standing
// rule of this stage after twenty-plus shadowed guards, and the reason each assertion below names
// what it would catch rather than describing what the code does.
import { describe, expect, it } from 'vitest';
import {
  BALANCE_CONTRIBUTING_INPUTS,
  OUTFLOW_CONTRIBUTING_INPUTS,
  observedInstalmentRowsOf,
  projectInstalmentsForward,
  CATEGORY_INSURANCE,
  CATEGORY_LOAN_REPAYMENT,
  NEAR_ZERO_ILS,
  assumptionLineItems,
  balanceVerdictOf,
  layerOf,
  resolveLayerPrecedence,
  resolveProjectedBalanceILS,
  suppressedBalanceInputs,
  suppressedOutflowInputs,
  type ForecastInputStateKey,
  type ForecastInputStatus,
  type ForecastLineItem,
} from '../utils/forecast';
import {
  refuseStatisticalHistory,
  sealStatisticalHistory,
  type GatedStatisticalHistory,
  type StatisticalHistoryRow,
} from '../utils/statisticalHistory';
import type { TransactionPeriodBackfillMarker } from '../utils/backfillMarker';
import type { ForecastAssumption } from '../types/finance';

/** A complete marker, so the seal below mints a REAL handle rather than a shape that looks like one. */
const MARKER: TransactionPeriodBackfillMarker = {
  completedAt: '2026-08-18T09:00:00.000Z',
  sourceCommit: '4527980',
  rowsStamped: 10,
  rowsUnknown: 0,
  lastRunAt: '2026-08-18T09:00:00.000Z',
  lastRunCommit: '4527980',
  transactionRows: 10,
};

/** Rows as they reach the instalment narrowing: THROUGH THE DOOR, never beside it (T7a-review F1). */
const gated = (rows: StatisticalHistoryRow[]): GatedStatisticalHistory =>
  sealStatisticalHistory(MARKER, rows);

const HORIZON = ['2026-09', '2026-10', '2026-11'];

function assumption(overrides: Partial<ForecastAssumption> = {}): ForecastAssumption {
  return {
    id: 'fa-1',
    ownerId: 'david',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    scopeKind: 'category',
    scopeId: 'מסעדות',
    fromPeriod: '2026-09',
    amountILS: 1200,
    reasonHe: 'המחיר עולה',
    source: 'user',
    status: 'active',
    ...overrides,
  };
}

function recurringItem(overrides: Partial<ForecastLineItem> = {}): ForecastLineItem {
  return {
    period: '2026-09',
    categoryId: 'דיור',
    direction: 'expense',
    amountILS: 5000,
    basis: { kind: 'recurring', recurringId: 'rec-rent', description: 'שכר דירה', chargeDay: 1 },
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// assumptionLineItems — THE JOINT THAT DID NOT EXIST
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! assumptionLineItems — the missing producer for D19`s override mechanism', () => {
  it('emits one item per covered horizon month, in the assumption`s own category', () => {
    const items = assumptionLineItems({
      assumptions: [assumption()],
      certainItems: [],
      horizon: HORIZON,
    });
    expect(items.map((i) => i.period)).toEqual(HORIZON);
    expect(items.every((i) => i.categoryId === 'מסעדות')).toBe(true);
    expect(items.every((i) => i.amountILS === 1200)).toBe(true);
    expect(items.every((i) => layerOf(i.basis) === 'assumption')).toBe(true);
  });

  it('honours a BOUNDED window — months outside it get no item', () => {
    const items = assumptionLineItems({
      assumptions: [assumption({ fromPeriod: '2026-10', toPeriod: '2026-10' })],
      certainItems: [],
      horizon: HORIZON,
    });
    expect(items.map((i) => i.period)).toEqual(['2026-10']);
  });

  it('!! a `loan` scope lands in the loan bucket and can therefore OVERRIDE a certain item', () => {
    // THE ASSERTION A13 IS ABOUT. `resolveCategoryOfScope` maps the scope onto the (period,
    // category) bucket precedence resolves in; without this producer that mapping had no caller and
    // D19's most valuable disclosure could not fire on real data while its own test passed on a
    // hand-built fixture. Driven END TO END through `resolveLayerPrecedence`, not asserted on the
    // mapping alone.
    const loanCertain: ForecastLineItem = {
      period: '2026-09',
      categoryId: CATEGORY_LOAN_REPAYMENT,
      direction: 'expense',
      amountILS: 4200,
      basis: { kind: 'loan', loanId: 'loan-1', name: 'משכנתא' },
    };
    const items = assumptionLineItems({
      assumptions: [assumption({ scopeKind: 'loan', scopeId: 'loan-1', amountILS: 4600 })],
      certainItems: [loanCertain],
      horizon: ['2026-09'],
    });
    expect(items).toHaveLength(1);

    const resolved = resolveLayerPrecedence([loanCertain, ...items]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].amountILS).toBe(4600);
    expect(resolved[0].basis.kind).toBe('assumption');
    // …and the displaced certain item is CARRIED, not deleted — D19's ordered stack.
    const basis = resolved[0].basis;
    expect(basis.kind === 'assumption' && basis.overrides.map((o) => o.kind)).toEqual(['loan']);
  });

  it('an `insurance` scope lands in the insurance bucket', () => {
    const items = assumptionLineItems({
      assumptions: [assumption({ scopeKind: 'insurance', scopeId: 'ins-1' })],
      certainItems: [],
      horizon: ['2026-09'],
    });
    expect(items.map((i) => i.categoryId)).toEqual([CATEGORY_INSURANCE]);
  });

  it('a `recurring` scope takes the CATEGORY OF THE ITEM IT NAMES, and vanishes when that item is gone', () => {
    const covered = assumptionLineItems({
      assumptions: [assumption({ scopeKind: 'recurring', scopeId: 'rec-rent' })],
      certainItems: [recurringItem()],
      horizon: ['2026-09'],
    });
    expect(covered.map((i) => i.categoryId)).toEqual(['דיור']);

    // An assumption pointed at a DELETED recurring item must disappear, not land in 'שונות'.
    const orphaned = assumptionLineItems({
      assumptions: [assumption({ scopeKind: 'recurring', scopeId: 'rec-deleted' })],
      certainItems: [recurringItem()],
      horizon: ['2026-09'],
    });
    expect(orphaned).toEqual([]);
  });

  it('!! `seasonality` produces NO line item — a ₪0 bucket entry would ERASE the estimate it scales', () => {
    // `resolveCategoryOfScope` returns null for this scope and writes out why: every writer stamps
    // a seasonality assumption's unused `amountILS` as 0, and D19 lets an assumption beat a
    // statistical item — so a bucket entry would replace the groceries estimate WITH ₪0 in exactly
    // the month the family said was expensive. Held here, at the producer, because this is the
    // function that would have made it happen.
    const items = assumptionLineItems({
      assumptions: [assumption({ scopeKind: 'seasonality', scopeId: 'מזון:09', amountILS: 0, factor: 1.3 })],
      certainItems: [],
      horizon: HORIZON,
    });
    expect(items).toEqual([]);
  });

  it('!! `personalTarget` produces NO line item — a child`s ₪500 target must not displace the rent', () => {
    const items = assumptionLineItems({
      assumptions: [assumption({ scopeKind: 'personalTarget', scopeId: 'child-1', amountILS: 500 })],
      certainItems: [recurringItem()],
      horizon: HORIZON,
    });
    expect(items).toEqual([]);
  });

  it('a RETIRED assumption produces nothing', () => {
    expect(
      assumptionLineItems({ assumptions: [assumption({ status: 'retired' })], certainItems: [], horizon: HORIZON })
    ).toEqual([]);
  });

  it('!! an `insight`-sourced assumption produces nothing — D25(b)`s cut renderer, from the client side', () => {
    // Rules require `source == 'user'` in Stage 7, so this branch is dead BY RULE. It is refused
    // here too because a client that drew one anyway would defeat the boundary from the one side
    // Rules cannot see, and Stage 8 widens the rule in the commit that ships the writer.
    expect(
      assumptionLineItems({ assumptions: [assumption({ source: 'insight' })], certainItems: [], horizon: HORIZON })
    ).toEqual([]);
  });

  it('an UNREADABLE amount is skipped rather than thrown — it came off a document', () => {
    // The module's own register: `parseHebrewGoalPeriod` refuses a document value by returning
    // null; `horizonPeriods` throws on a caller contract. One bad row must not take the card down.
    for (const amountILS of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(
        assumptionLineItems({ assumptions: [assumption({ amountILS })], certainItems: [], horizon: HORIZON }),
        String(amountILS)
      ).toEqual([]);
    }
    // …and ₪0 IS a readable amount and IS projected: "this category costs nothing next month" is a
    // statement a family is allowed to make about a category they control.
    expect(
      assumptionLineItems({ assumptions: [assumption({ amountILS: 0 })], certainItems: [], horizon: ['2026-09'] })
    ).toHaveLength(1);
  });

  it('an assumption whose window MISSES the horizon entirely produces nothing', () => {
    expect(
      assumptionLineItems({
        assumptions: [assumption({ fromPeriod: '2026-01', toPeriod: '2026-08' })],
        certainItems: [],
        horizon: HORIZON,
      })
    ).toEqual([]);
  });

  it('every emitted basis starts with an EMPTY override stack — precedence is the only filler', () => {
    const items = assumptionLineItems({ assumptions: [assumption()], certainItems: [], horizon: ['2026-09'] });
    const basis = items[0].basis;
    expect(basis.kind === 'assumption' && basis.overrides).toEqual([]);
  });

  it('rounds the stored amount, so float dust never reaches a bucket total', () => {
    const items = assumptionLineItems({
      assumptions: [assumption({ amountILS: 1200.005 })],
      certainItems: [],
      horizon: ['2026-09'],
    });
    expect(items[0].amountILS).toBe(1200.01);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D17 — suppression by input PRESENCE
// ═════════════════════════════════════════════════════════════════════════════════════════════

const ALL_KEYS: ForecastInputStateKey[] = [
  'accounts',
  'incomes',
  'recurring',
  'loans',
  'insurances',
  'history',
  'assumptions',
  'goals',
];

function inputs(
  overrides: Partial<Record<ForecastInputStateKey, ForecastInputStatus>> = {}
): Record<ForecastInputStateKey, ForecastInputStatus> {
  const base = {} as Record<ForecastInputStateKey, ForecastInputStatus>;
  for (const key of ALL_KEYS) base[key] = { scope: 'family', state: 'ok', count: 1 };
  return { ...base, ...overrides };
}

describe('!! D17 — `projectedBalance` is suppressed by input PRESENCE, not by scope', () => {
  it('suppresses nothing when every balance-contributing input is `ok`', () => {
    expect(suppressedBalanceInputs(inputs())).toEqual([]);
  });

  it('!! an EMPTY read suppresses — this is A2, and it is the case a permission-keyed rule misses', () => {
    // The measured corpus has `incomes: 0` documents. Income is zero BY ABSENCE, for everyone, in
    // family scope, on the Dashboard, at glance scale. v1's rule keyed on permission and would not
    // have fired; a plunging negative balance would have rendered, authoritative and false.
    expect(suppressedBalanceInputs(inputs({ incomes: { scope: 'family', state: 'empty', count: 0 } }))).toEqual([
      'incomes',
    ]);
  });

  it('a DENIED read suppresses — the permission case, now a special case of the general rule', () => {
    expect(suppressedBalanceInputs(inputs({ accounts: { scope: 'none', state: 'denied', count: 0 } }))).toEqual([
      'accounts',
    ]);
  });

  it('an ERRORED read suppresses — a failed read must never render as a number', () => {
    expect(suppressedBalanceInputs(inputs({ loans: { scope: 'family', state: 'error', count: 0 } }))).toEqual([
      'loans',
    ]);
  });

  it('!! `assumptions` and `goals` NEVER suppress the balance, however they failed', () => {
    // They are read, and neither adds nor removes money from the balance: one modifies amounts, the
    // other names a target. A rule that let them suppress would blank the headline figure because a
    // family has not set a savings goal.
    expect(
      suppressedBalanceInputs(
        inputs({
          assumptions: { scope: 'none', state: 'denied', count: 0 },
          goals: { scope: 'none', state: 'error', count: 0 },
        })
      )
    ).toEqual([]);
  });

  it('names EVERY failing input, in the fixed onboarding order — the count and the list cannot disagree', () => {
    const suppressed = suppressedBalanceInputs(
      inputs({
        history: { scope: 'family', state: 'empty', count: 0 },
        accounts: { scope: 'family', state: 'empty', count: 0 },
        recurring: { scope: 'family', state: 'error', count: 0 },
      })
    );
    // Order is `BALANCE_CONTRIBUTING_INPUTS`', not the caller's insertion order.
    expect(suppressed).toEqual(['accounts', 'recurring', 'history']);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // !! ONE NUMBER, FOUR ITERATIONS — AND THE FIX IS TO NAME THE CORPUS (T7b-review F6)
  // ───────────────────────────────────────────────────────────────────────────────────────────
  //
  // D26's own text illustrates with **3**. That travelled into a test TITLE, then into the ledger,
  // was corrected to **5** by T7a-review F7 — and 5 turns out to be conditional on a migration
  // nobody recorded running. The single fixture below was doing the conditioning silently: it
  // handed `history: { state: 'ok', count: 3 }`, which is the state AFTER the T3 backfill.
  //
  // A number that changes every time somebody looks at it is a number describing an UNNAMED corpus.
  // So there are now two tests and each says which ledger it is about, rather than one test whose
  // answer depends on a field in its own fixture that nothing draws attention to.

  it('!! T0`s MEASURED ledger — no backfill marker — suppresses SIX, and `history` is the sixth', () => {
    // T0 measured no `settings/migrationState`. `loadStatisticalHistory` refuses without a complete
    // marker (`statisticalHistory.ts`'s door), a refused handle has NO CORPUS IN MEMORY, and
    // `gradeHistoryInput` therefore grades the input `'error'` because the layer is not `'ready'` —
    // this suite already states the same fact one describe over: "the refusal is the live day-one
    // state: no completion marker, no query issued, no rows in memory".
    //
    // So the figure the glance position renders on the ledger that was actually measured is SIX.
    const measuredDayOne = inputs({
      accounts: { scope: 'family', state: 'empty', count: 0 },
      incomes: { scope: 'family', state: 'empty', count: 0 },
      recurring: { scope: 'family', state: 'empty', count: 0 },
      loans: { scope: 'family', state: 'empty', count: 0 },
      insurances: { scope: 'family', state: 'empty', count: 0 },
      history: { scope: 'family', state: 'error', count: 0 },
    });
    expect(suppressedBalanceInputs(measuredDayOne)).toEqual([
      'accounts',
      'incomes',
      'recurring',
      'loans',
      'insurances',
      'history',
    ]);
    expect(suppressedBalanceInputs(measuredDayOne)).toHaveLength(6);
  });

  it('!! the SAME ledger AFTER the backfill suppresses FIVE — history is the only input that moved', () => {
    // !! T7a-REVIEW F7 — THE TITLE SAID **THREE** AND THE ASSERTION HAS ALWAYS EXPECTED **FIVE**,
    // and the ledger repeated the title's number. `ForecastGap` renders `suppressed.length`, so the
    // wrong number was one a reader could carry into a design conversation about a screen they had
    // not run.
    //
    // T0 measured THREE collections as not existing — `accounts`, `incomes`, `recurring` — which is
    // where the three came from. `loans` and `insurances` are empty on day one too, and an empty
    // read suppresses (A2). Five, ONCE THE BACKFILL HAS RUN AND ITS MARKER IS COMPLETE — which is
    // the condition the previous single fixture asserted without saying so.
    const afterBackfill = inputs({
      accounts: { scope: 'family', state: 'empty', count: 0 },
      incomes: { scope: 'family', state: 'empty', count: 0 },
      recurring: { scope: 'family', state: 'empty', count: 0 },
      loans: { scope: 'family', state: 'empty', count: 0 },
      insurances: { scope: 'family', state: 'empty', count: 0 },
      history: { scope: 'family', state: 'ok', count: 3 },
    });
    expect(suppressedBalanceInputs(afterBackfill)).toEqual([
      'accounts',
      'incomes',
      'recurring',
      'loans',
      'insurances',
    ]);
    expect(suppressedBalanceInputs(afterBackfill)).toHaveLength(5);
  });

  it('BALANCE_CONTRIBUTING_INPUTS is exactly D17`s six, pinned as a value', () => {
    // Pinned rather than described. A mutation dropping one member would otherwise let the balance
    // render with that input missing, and every suppression test above would still pass.
    expect([...BALANCE_CONTRIBUTING_INPUTS]).toEqual([
      'accounts',
      'incomes',
      'recurring',
      'loans',
      'insurances',
      'history',
    ]);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T7a-REVIEW F3 — THE SIBLING SET HAD NO PIN, AND THREE MUTANTS LIVED IN THE GAP
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('!! F3 — OUTFLOW_CONTRIBUTING_INPUTS is pinned as a value, the way its sibling already was', () => {
    // THE FINDING, EXACTLY: dropping `history`, `loans` or `insurances` from this array left all
    // 2422 tests green, and the array had ZERO references anywhere in `src/__tests__`. The control
    // the review ran is the reason this fix is one line: dropping `history` from
    // `BALANCE_CONTRIBUTING_INPUTS` — which HAS the pin eight lines above — killed five tests.
    //
    // What the missing pin admitted is the failure the function's own header describes, in the
    // LIVE DAY-ONE STATE: with the statistical layer refused, the `'own'` card renders `צפוי לצאת`
    // built from contractual items only, missing every variable shekel a family spends. A sum over
    // missing inputs does not go wrong, it goes SMALL — the same lie told quietly.
    expect([...OUTFLOW_CONTRIBUTING_INPUTS]).toEqual(['recurring', 'loans', 'insurances', 'history']);
  });

  it('!! F3 — and each of the four really does suppress, so the pin is not the only thing holding them', () => {
    // A value pin alone would be satisfied by an array nothing reads. Each member is exercised
    // through `suppressedOutflowInputs`, which is the function the `'own'` glance figure hangs on.
    for (const key of ['recurring', 'loans', 'insurances', 'history'] as const) {
      expect(
        suppressedOutflowInputs(inputs({ [key]: { scope: 'family', state: 'empty', count: 0 } })),
        key
      ).toEqual([key]);
    }
    // …and the two that are NOT on the set stay off it, which is the other direction of the rule:
    // an empty accounts collection must not blank a card that never draws a balance.
    expect(
      suppressedOutflowInputs(
        inputs({
          accounts: { scope: 'family', state: 'empty', count: 0 },
          incomes: { scope: 'none', state: 'denied', count: 0 },
        })
      )
    ).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T7a-REVIEW F6 — THE SUPPRESSION RULE AND THE BALANCE-EXISTENCE RULE MAY NOT DISAGREE
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// THE CAPTURED DEFECT: with every account archived, `accounts` graded `'ok'` (the collection has
// documents) so nothing was suppressed — while the opening balance was `null`, because every
// account was filtered out before it was computed. The card then took its GAP branch with an
// EMPTY gap list and rendered a glance `"0"` above the sentence `לא ניתן להציג יתרה צפויה — חסרים
// 0 נתונים: ` — a trailing colon and nothing after it.
//
// Two rules, both individually correct, disagreeing about whether a balance exists. The grading
// fix in `useForecast` removes the reachable instance; this function is what refuses the
// disagreement itself, so a future one is a loud failure instead of a card that renders a zero.

describe('!! F6 — resolveProjectedBalanceILS refuses a disagreement rather than rendering one', () => {
  const point = (period: string, projectedBalanceILS: number) => ({ period, projectedBalanceILS });

  it('returns the LAST projected point when nothing is suppressed', () => {
    expect(resolveProjectedBalanceILS([], [point('2026-09', 1000), point('2026-10', 1400)])).toBe(1400);
  });

  it('returns null — never a number — when any input is suppressed, whatever the points say', () => {
    expect(resolveProjectedBalanceILS(['accounts'], [point('2026-09', 1000)])).toBeNull();
    // …including the case where the suppression and the empty projection AGREE, which is the
    // ordinary day-one path and must stay quiet.
    expect(resolveProjectedBalanceILS(['accounts'], [])).toBeNull();
  });

  it('!! THROWS when the two rules disagree — no gap named, and no balance to draw', () => {
    // This is the state that rendered `חסרים 0 נתונים: `. It is not a data outcome: it means the
    // grading that decides which inputs are missing and the arithmetic that decides whether a
    // balance exists have come apart, which is this app's own logic being wrong. The hook's own
    // catch turns it into the error card — "something somebody has to go and fix" — rather than a
    // glance-scale `0` the family would read as a statement about their money.
    expect(() => resolveProjectedBalanceILS([], [])).toThrow(/no balance and no named gap/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D38 — the verdict state
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('D38 — the verdict, including the designed negative state', () => {
  it('is positive well above the neutral band and negative well below it', () => {
    expect(balanceVerdictOf(12400)).toBe('positive');
    expect(balanceVerdictOf(-3100)).toBe('negative');
  });

  it('is `near-zero` inside the band, on BOTH sides of zero', () => {
    expect(balanceVerdictOf(0)).toBe('near-zero');
    expect(balanceVerdictOf(99.99)).toBe('near-zero');
    expect(balanceVerdictOf(-99.99)).toBe('near-zero');
  });

  it('!! the band is HALF-OPEN at `NEAR_ZERO_ILS` itself — the boundary, pinned on both sides', () => {
    // The mutant this kills is `<` → `<=`, which would colour exactly ₪100 neutral and exactly
    // -₪100 neutral. One assertion on each side, because a one-sided test lets the other move.
    expect(balanceVerdictOf(NEAR_ZERO_ILS)).toBe('positive');
    expect(balanceVerdictOf(-NEAR_ZERO_ILS)).toBe('negative');
    expect(NEAR_ZERO_ILS).toBe(100);
  });

  it('!! REFUSES a non-finite balance rather than colouring it by whichever branch is last', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => balanceVerdictOf(bad), String(bad)).toThrow(/finite/);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// observedInstalmentRowsOf — THE NARROWING BETWEEN A SCHEMALESS DOCUMENT AND D10's PROJECTOR
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// !! THIS WHOLE BLOCK EXISTS BECAUSE THE MUTATION SWEEP FOUND IT MISSING. Three mutants survived
// the first sweep — a non-string `date` accepted, an unreadable `amount` defaulted to `0`, and
// `numberOrNull` losing its `Number.isFinite` check — and all three survived for the same reason:
// the corpus contains ZERO instalment rows (T0 §6), so nothing in the suite exercised the
// narrowing at all. A function with no test is not made safe by the comment above it.
//
// The inputs below are not invented shapes. T0's live probes put a `date` of the NUMBER `12345`
// into `transaction_lines` from a parent's own account, and `FileProcessor` writes
// `installmentNumber: null` on every manual row.
//
// !! T7a-REVIEW F1 — EVERY CASE BELOW NOW ARRIVES THROUGH THE SEALED HANDLE, because that is the
// only shape this function accepts. It used to take a bare row array, and `useForecast` handed it
// `read.rows` — the raw sibling of the gated corpus, travelling beside the door rather than
// through it. The review's exploit paired a REAL sealed handle over three ₪100 grocery rows with
// a result whose `rows` was one ungated `{amount: 9999, installmentNumber: 1, totalInstallments:
// 12}`, and got `basis.kind: 'installment'`, `₪9,999`, in every horizon month — inside
// `certainILS`, the highest-confidence bucket, the one D38 renders as `מזה כבר סגור`.
//
// The gate is what makes that unbuildable rather than merely unwired: a forged handle throws, a
// refusal yields nothing, and there is no exported entry point that takes rows.

describe('!! observedInstalmentRowsOf — narrowing a schemaless row (found by the sweep)', () => {
  // `& Record<string, unknown>` because the instalment fields are NOT members of
  // `StatisticalHistoryRow` — that type names what the STATISTICAL layer consults, and a schemaless
  // document carries more than that. The intersection is the shape a real row has.
  const plan = (over: Record<string, unknown> = {}): StatisticalHistoryRow & Record<string, unknown> => ({
    id: 'tl-1',
    date: '2026-08-11',
    amount: 250,
    vendor: 'חשמל ומחשבים',
    description: 'מקרר',
    category: 'ריהוט',
    installmentNumber: 3,
    totalInstallments: 12,
    ...over,
  });

  it('carries every field D10`s projector reads', () => {
    expect(observedInstalmentRowsOf(gated([plan()]))).toEqual([
      {
        date: '2026-08-11',
        amount: 250,
        vendor: 'חשמל ומחשבים',
        description: 'מקרר',
        category: 'ריהוט',
        installmentNumber: 3,
        totalInstallments: 12,
      },
    ]);
  });

  it('!! DROPS a row whose `date` is not a string — T0 proved a parent can write the NUMBER 12345', () => {
    expect(observedInstalmentRowsOf(gated([plan({ date: 12345 })]))).toEqual([]);
    expect(observedInstalmentRowsOf(gated([plan({ date: undefined })]))).toEqual([]);
    expect(observedInstalmentRowsOf(gated([plan({ date: null })]))).toEqual([]);
  });

  it('!! DROPS a row whose `amount` is unreadable — never defaults it to ₪0', () => {
    // A defaulted amount does not merely lose a row: `planKeyOf` is derived from the amount, so a
    // ₪0 default silently JOINS a plan the row does not belong to, and D10 then projects the
    // remaining instalments of that plan at the wrong price.
    for (const amount of [undefined, null, 'abc', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(observedInstalmentRowsOf(gated([plan({ amount })])), String(amount)).toEqual([]);
    }
  });

  it('!! a NON-FINITE instalment number becomes `null`, which is D10`s "unprojectable"', () => {
    // `numberOrNull` without its finite check would hand `projectInstalmentsForward` a `NaN`
    // instalment number, and `NaN > max` is false — so the plan would silently project NOTHING,
    // which on a forecast screen is indistinguishable from "this plan has finished paying".
    const [row] = observedInstalmentRowsOf(gated([plan({ installmentNumber: Number.NaN })]));
    expect(row.installmentNumber).toBeNull();
    const [row2] = observedInstalmentRowsOf(gated([plan({ totalInstallments: Number.POSITIVE_INFINITY })]));
    expect(row2.totalInstallments).toBeNull();
  });

  it('PRESERVES a real `null` — `FileProcessor` writes it, and D10`s `== null` check needs it', () => {
    const [row] = observedInstalmentRowsOf(gated([plan({ installmentNumber: null })]));
    expect(row.installmentNumber).toBeNull();
    expect(row.totalInstallments).toBe(12);
  });

  it('a non-string `vendor` reads as absent, never as a coerced key fragment', () => {
    const [row] = observedInstalmentRowsOf(gated([plan({ vendor: 42 })]));
    expect(row.vendor).toBeNull();
  });

  it('!! and the narrowed rows really do project — the two halves wired together', () => {
    // The end of the chain, so the narrowing is held against the thing it feeds rather than only
    // against its own shape. A row at 3 of 12 implies nine further ₪250 charges, capped at the
    // horizon.
    const projected = projectInstalmentsForward(
      observedInstalmentRowsOf(gated([plan()])),
      '2026-09',
      '2026-11'
    );
    expect(projected.map((item) => item.period)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(projected.every((item) => item.amountILS === 250)).toBe(true);
    expect(projected.every((item) => item.basis.kind === 'installment')).toBe(true);
    // …and a row the narrowing DROPPED projects nothing, which is the property the three surviving
    // mutants were all about.
    expect(
      projectInstalmentsForward(observedInstalmentRowsOf(gated([plan({ amount: 'abc' })])), '2026-09', '2026-11')
    ).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T7a-REVIEW F1 — THE GATE, which is the whole reason this function no longer takes rows
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('!! F1 — a REFUSED handle yields no instalments, so a half-stamped corpus commits nothing', () => {
    // The refusal is the live day-one state: no completion marker, no query issued, no rows in
    // memory. Before the fix the hook still had `read.rows` beside the handle and could have
    // projected from it; there is now no rows-shaped entry point at all.
    expect(observedInstalmentRowsOf(refuseStatisticalHistory('הגיבוי לא הושלם'))).toEqual([]);
  });

  it('!! F1 — A FORGED HANDLE THROWS, by the same identity check the statistical layer uses', () => {
    // The review's exploit, reduced to its mechanism: a spread copy carries a genuine brand and a
    // corpus of the forger's choosing, and it is NOT the sealed object. `SEALED_HANDLES` is keyed
    // by identity, so the heir is refused however much of its parent it reproduces.
    const real = gated([plan()]);
    const forged = { ...real, rows: [plan({ amount: 9999, installmentNumber: 1, totalInstallments: 12 })] };
    expect(() => observedInstalmentRowsOf(forged)).toThrow(/did not come through `loadStatisticalHistory`/);
    // …and the real handle beside it still works, so the assertion above is about provenance and
    // not about the shape being unreadable.
    expect(observedInstalmentRowsOf(real)).toHaveLength(1);
  });

  it('!! F1 — THE REVIEW`S EXPLOIT, END TO END: the forged ₪9,999 plan reaches NO horizon month', () => {
    // Verbatim from the finding: a real sealed handle over three ₪100 grocery rows, paired with an
    // ungated `{vendor: 'FORGED', amount: 9999, installmentNumber: 1, totalInstallments: 12}`. It
    // used to produce `basis.kind: 'installment'`, `amountILS: 9999`, in EVERY horizon month —
    // inside `certainILS`, which D38 renders as `מזה כבר סגור`, the highest-confidence bucket on
    // the card. The ungated row can no longer be handed in at all: the only argument this function
    // takes is the handle, and the handle's corpus is the sealed one.
    const groceries = ['2026-06', '2026-07', '2026-08'].map((period) => ({
      id: `tl-${period}`,
      period,
      date: `${period}-11`,
      amount: 100,
      category: 'מזון וצריכה',
    }));
    const sealed = gated(groceries);
    const projected = projectInstalmentsForward(observedInstalmentRowsOf(sealed), '2026-09', '2026-11');
    expect(projected).toEqual([]);
    expect(projected.map((item) => item.amountILS)).not.toContain(9999);
    // The sealed corpus is FROZEN and COPIED, so the forger cannot reach it through the handle
    // either — `handle.rows.push(...)` is `TS2339` and the array is frozen at runtime besides.
    expect(Object.isFrozen(sealed.rows)).toBe(true);
  });
});
