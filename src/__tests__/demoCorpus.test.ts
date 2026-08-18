// Stage 7 T4 — the generator itself: determinism, the ten-and-more named conditions against the
// REAL output, and one test per path that was unreachable before this task existed.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS FILE IS FOR, AND WHAT IT DELIBERATELY DOES NOT DO
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// The predicates themselves are proven in `demoCorpusConditions.test.ts`, against corpora built by
// hand, in both directions. This file pairs them with the generator — and that pairing is only
// worth anything BECAUSE the other file exists. A condition asserted only here would go green the
// day the generator and its detector broke together.
//
// The section below the conditions is the one T4 exists for. R8, as corrected by T0, names FOUR
// paths with an empty input class on the real corpus — `period: 'unknown'`, `ownerId: 'unknown'`,
// D10's instalment-`null` branch and D33's row ceiling — and §12 names three more guards whose
// corpus D27 originally did not generate. Each gets a test that runs the SHIPPED code over the
// generated corpus and asserts the behaviour, not the presence of a row.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEMO_ANCHOR_PERIOD,
  DEMO_AS_OF_DATE,
  DEMO_BASE_MEMBER_COUNT,
  DEMO_CATEGORY_EDUCATION,
  DEMO_CATEGORY_GROCERIES,
  DEMO_CATEGORY_HOUSING,
  DEMO_LARGE_MEMBER_COUNT,
  DEMO_RULES_BLOCKED_LEGACY_DATE,
  DEMO_SEASONALITY_SCOPE_KIND,
  DEMO_SEED,
  DEMO_UNPARSEABLE_DATES,
  DEMO_WINDOW_MONTHS,
  attributableMembers,
  buildDemoCorpus,
  largeFamilyMemberName,
  type DemoCorpus,
} from '../utils/demoCorpus';
import {
  DEMO_CORPUS_CONDITIONS,
  conditionOutcomes,
  failingConditionIds,
  RULES_DATE_SIZE,
  categoriesInPeriod,
  monthsObservedByCategory,
  windowRows,
} from '../utils/demoCorpusConditions';
import {
  CATEGORY_LOAN_REPAYMENT,
  HISTORY_ROW_CEILING,
  computeOpeningBalance,
  projectInstalmentsForward,
  projectLoanForward,
  resolveLayerPrecedence,
  type ForecastLineItem,
} from '../utils/forecast';
import { isExpenseListRow, isExpenseRow } from '../utils/transactionFilters';
import { UNKNOWN_PERIOD, periodOf } from '../utils/periodMath';
import { UNKNOWN_OWNER_ID, resolveOwnerId } from '../utils/resolveOwnerId';
import { ASSUMPTION_SCOPE_KINDS } from '../types/finance';
import { LARGE_FAMILY_MEMBERS } from './fixtures/largeFamily';
import { REPO_ROOT, readSourceCached, stripComments } from './helpers/extractionSurfaces';

const base = buildDemoCorpus();
const scale = buildDemoCorpus({ memberCount: DEMO_LARGE_MEMBER_COUNT });

const corpusFor = (variant: 'base' | 'scale'): DemoCorpus => (variant === 'base' ? base : scale);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D27's named conditions — ONE ASSERTION EACH, reported by id
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("D27's conditions, checked individually — \"the generator ran\" is not evidence", () => {
  for (const condition of DEMO_CORPUS_CONDITIONS) {
    it(`${condition.id} — ${condition.why}`, () => {
      expect(condition.holds(corpusFor(condition.variant)), `${condition.id} does not hold on the ${condition.variant} corpus`).toBe(true);
    });
  }

  it('!! T4 REVIEW F-5 — `failingConditionIds` IS EMPTY ON BOTH REAL VARIANTS, so the seeder writes', () => {
    // The other side of the seeder's refusal, on the generator's actual output. The synthetic half
    // (`demoCorpusConditions.test.ts`) proves the function NAMES failures; this proves it does not
    // invent them, which is the half that would otherwise make the whole task unrunnable.
    expect(failingConditionIds(base)).toEqual([]);
    expect(failingConditionIds(scale)).toEqual([]);
    expect(conditionOutcomes(scale).every((o) => o.applicable)).toBe(true);
    expect(conditionOutcomes(base).filter((o) => !o.applicable).map((o) => o.id)).toEqual([
      'crossesHistoryRowCeiling',
      'twentyMembersWithMoney',
    ]);
  });

  it('the registry covers every condition the plan names, and the count is pinned', () => {
    // A pinned count is what stops a condition being deleted along with the row it guards. v2.1's
    // T4 checkbox names ten; this corpus carries twenty-four, because D27's prose bullets
    // (staleness, both recurring kinds, both loan shapes, both premium frequencies, the
    // source-floor) are conditions too and were previously checked by nothing at all.
    expect(DEMO_CORPUS_CONDITIONS).toHaveLength(24);
    expect(DEMO_CORPUS_CONDITIONS.filter((c) => c.variant === 'scale').map((c) => c.id)).toEqual([
      'crossesHistoryRowCeiling',
      'twentyMembersWithMoney',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// DETERMINISM
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('determinism — the property every test downstream of T4 rests on', () => {
  it('two runs with the same options produce BYTE-IDENTICAL output', () => {
    expect(JSON.stringify(buildDemoCorpus())).toBe(JSON.stringify(buildDemoCorpus()));
  });

  it('the 20-member corpus is byte-identical across runs too — 2,900 rows, not four', () => {
    const a = JSON.stringify(buildDemoCorpus({ memberCount: DEMO_LARGE_MEMBER_COUNT }));
    const b = JSON.stringify(buildDemoCorpus({ memberCount: DEMO_LARGE_MEMBER_COUNT }));
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(100_000);
  });

  it('!! NON-VACUOUS: a different seed produces different DATA, not just a different `seed` field', () => {
    // Without a non-vacuity check, "two runs are identical" would also pass for a generator that
    // ignored its seed and emitted a constant — deterministic and useless.
    //
    // !! AND THE OBVIOUS FORM OF THIS CHECK IS ITSELF VACUOUS, found by this task's own mutation
    // sweep: comparing the whole serialised corpus passes even when the PRNG is hardcoded, because
    // `corpus.seed` is a FIELD and differs on its own. So the comparison is over the amounts the
    // PRNG actually decides.
    const amountsFor = (seed: number): string =>
      buildDemoCorpus({ seed }).transactionLines.map((row) => row.amount).join(',');
    expect(amountsFor(DEMO_SEED + 1)).not.toBe(amountsFor(DEMO_SEED));
    expect(amountsFor(DEMO_SEED)).toBe(amountsFor(DEMO_SEED));
  });

  it('!! NON-VACUOUS: a different asOfDate moves every period', () => {
    const shifted = buildDemoCorpus({ asOfDate: '2026-09-18' });
    expect(shifted.anchorPeriod).toBe('2026-09');
    expect(shifted.historyPeriods).not.toEqual(base.historyPeriods);
  });

  it('the default anchor is derived from the default asOfDate, not written twice', () => {
    expect(periodOf(DEMO_AS_OF_DATE)).toBe(DEMO_ANCHOR_PERIOD);
    expect(base.anchorPeriod).toBe(DEMO_ANCHOR_PERIOD);
  });

  it('!! THE SOURCE READS NO CLOCK AND NO UNSEEDED RANDOM — checked on the file, not promised', () => {
    // The determinism tests above compare two runs in ONE process, milliseconds apart. A
    // `new Date()` in a `createdAt` would very likely produce the same string in both and the
    // comparison would pass — so the property is also held structurally, over comment-STRIPPED
    // source, so a mention inside a comment cannot satisfy or violate it.
    const path = join(REPO_ROOT, 'src/utils/demoCorpus.ts');
    const stripped = stripComments(readSourceCached(path), 'src/utils/demoCorpus.ts');
    for (const forbidden of ['new Date(', 'Date.now(', 'Math.random(', 'Date.UTC(']) {
      expect(stripped.includes(forbidden), `demoCorpus.ts must not contain \`${forbidden}\``).toBe(false);
    }
  });

  it('!! AND THE CHECK ABOVE CAN FAIL — the same probe over a file that DOES read the clock', () => {
    // Non-vacuity for the check above: `netWorth.ts:69` is the tree's known `new Date()` caller,
    // named as such by D37's purity guard. If this assertion ever goes red the probe has stopped
    // detecting anything and the check above became decoration.
    const path = join(REPO_ROOT, 'src/utils/netWorth.ts');
    const stripped = stripComments(readSourceCached(path), 'src/utils/netWorth.ts');
    expect(stripped.includes('new Date(')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE FOUR PATHS T0 MEASURED AS SHADOWED (R8)
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("R8 path 1 — `period: 'unknown'`, which had ZERO live instances (T0: 3/3 parse)", () => {
  const unknownRows = base.transactionLines.filter((row) => row.period === UNKNOWN_PERIOD);

  it('the corpus contains rows stamped `unknown`, and `periodOf` refuses each of their dates', () => {
    expect(unknownRows.length).toBeGreaterThanOrEqual(2);
    for (const row of unknownRows) expect(periodOf(row.date)).toBeNull();
  });

  it('both forms are TEN characters — the length Rules accept, so a `member` can write them today', () => {
    // T0's correction to A5/A7, executable. `date.size() == 10` is a LENGTH check, so these are
    // client-reachable by the least-privileged role, not Admin-SDK-only.
    for (const row of unknownRows) expect(row.date).toHaveLength(RULES_DATE_SIZE);
    expect(new Set(unknownRows.map((row) => row.date))).toEqual(new Set(DEMO_UNPARSEABLE_DATES));
  });

  it("the literal `10` is `firestore.rules`' own, read off disk rather than restated in a comment", () => {
    const rules = readFileSync(join(REPO_ROOT, 'firestore.rules'), 'utf8');
    expect(rules).toContain(`date.size() == ${String(RULES_DATE_SIZE)}`);
  });

  it('!! AND THE 8-CHARACTER FORM IS NOT ONE OF THEM — D27 says it is, and D27 is wrong', () => {
    // `parseTransactionDate` reads DD/MM/YYYY deliberately (`periodMath.ts`'s header records
    // "9/3/2026" → "2026-03" as a REQUIREMENT). The row is in the corpus because Rules BLOCK it on
    // create and it is therefore Admin-SDK-only — a different fact from being unreadable.
    expect(DEMO_RULES_BLOCKED_LEGACY_DATE).toHaveLength(8);
    expect(periodOf(DEMO_RULES_BLOCKED_LEGACY_DATE)).toBe('2026-03');
    const legacy = base.transactionLines.find((row) => row.date === DEMO_RULES_BLOCKED_LEGACY_DATE);
    expect(legacy?.period).toBe('2026-03');
  });

  it('`unusableRowCount` is non-zero on this corpus — the number A5 could not obtain', () => {
    expect(base.backfillMarker.rowsUnknown).toBe(unknownRows.length);
    expect(base.backfillMarker.rowsUnknown).toBeGreaterThan(0);
  });
});

describe("R8 path 2 — `ownerId: 'unknown'`, which had ZERO live instances (T0: 3/3 resolve)", () => {
  const members = base.members.map((m) => ({ id: m.id, name: m.name }));
  const unknownOwnerRows = base.transactionLines.filter((row) => row.ownerId === UNKNOWN_OWNER_ID);

  it('two members share a display name and `resolveOwnerId` returns null for it', () => {
    const duplicated = base.members.filter(
      (m) => base.members.filter((other) => other.name === m.name).length > 1
    );
    expect(duplicated.length).toBe(2);
    expect(duplicated[0].id).not.toBe(duplicated[1].id);
    expect(resolveOwnerId(duplicated[0].name, members)).toBeNull();
  });

  it('!! IT IS THE DUPLICATE, NOT THE FIRST MATCH — the coin flip T3 wrote that loop not to have', () => {
    // The property nothing in the tree proved: `resolveOwnerId` could have returned the first
    // match and every existing test would still pass, because the real corpus has three distinct
    // names. Here a member with that exact name EXISTS and the answer is still `null`.
    const ambiguous = base.members.find(
      (m) => base.members.filter((other) => other.name === m.name).length > 1
    );
    expect(ambiguous).toBeDefined();
    expect(members.some((m) => m.name === ambiguous?.name)).toBe(true);
    expect(resolveOwnerId(ambiguous?.name, members)).toBeNull();
  });

  it('both causes are present and they are DIFFERENT problems — ambiguous and orphaned', () => {
    const causes = new Map<string, number>();
    for (const row of unknownOwnerRows) {
      causes.set(row.owner, (causes.get(row.owner) ?? 0) + 1);
    }
    const names = [...causes.keys()];
    expect(names.filter((name) => base.members.some((m) => m.name === name))).toHaveLength(1);
    expect(names.filter((name) => !base.members.some((m) => m.name === name))).toHaveLength(1);
  });

  it('routine spending is still attributable — `unknown` is the exception, not the norm', () => {
    // A corpus where half the ledger is unattributable would make D26 render the `unknown` state
    // as the normal one. Under 2% here.
    expect(unknownOwnerRows.length / base.transactionLines.length).toBeLessThan(0.02);
  });
});

describe("R8 path 3 — D10's instalment-`null` branch, which had ZERO rows in the tree (T0)", () => {
  const nullRow = base.transactionLines.find(
    (row) => row.totalInstallments !== null && row.installmentNumber === null
  );

  it('the row exists in exactly the shape `FileProcessor.ts` writes — `?? null`, not absent', () => {
    expect(nullRow).toBeDefined();
    expect(nullRow?.installmentNumber).toBeNull();
    expect(nullRow?.totalInstallments).toBe(6);
  });

  it('!! THE PROJECTOR SKIPS IT — no line item anywhere carries its plan', () => {
    const projected = projectInstalmentsForward(base.transactionLines, base.horizonPeriods[0], base.horizonPeriods[2]);
    const keys = projected.map((item) => (item.basis.kind === 'installment' ? item.basis.planKey : ''));
    expect(keys.some((key) => key.includes(String(nullRow?.vendor)))).toBe(false);
    // …and it is not skipped because there is nothing to project: the OTHER plan does project.
    expect(projected.length).toBeGreaterThan(0);
  });

  it("R5's colliding plans merge, and the merge is the known-wrong output the fixture documents", () => {
    const projected = projectInstalmentsForward(base.transactionLines, base.horizonPeriods[0], base.horizonPeriods[2]);
    const colliding = base.transactionLines.filter((row) => row.vendor === 'אייס');
    expect(colliding).toHaveLength(2);
    expect(colliding[0].installmentNumber).not.toBe(colliding[1].installmentNumber);

    // Two purchases owing 1 and 2 further payments respectively — three charges in truth. The key
    // cannot separate them, so the higher observed number anchors and ONE charge is projected.
    const forThisVendor = projected.filter(
      (item) => item.basis.kind === 'installment' && item.basis.planKey.startsWith('אייס|')
    );
    expect(forThisVendor).toHaveLength(1);
    expect(forThisVendor[0].amountILS).toBe(300);
  });
});

describe("R8 path 4 — D33's row ceiling, which 3 documents could never reach", () => {
  it('one window read over the 20-member corpus returns MORE than the ceiling', () => {
    expect(windowRows(scale).length).toBeGreaterThan(HISTORY_ROW_CEILING);
  });

  it('and the four-member corpus stays well under it — the ceiling is a scale property', () => {
    expect(windowRows(base).length).toBeLessThan(HISTORY_ROW_CEILING);
  });

  it('the window is exactly `DEMO_WINDOW_MONTHS` months and every returned row is inside it', () => {
    expect(base.windowPeriods).toHaveLength(DEMO_WINDOW_MONTHS);
    expect(windowRows(scale).every((row) => scale.windowPeriods.includes(row.period))).toBe(true);
  });

  it('T0 measured 3 documents for the same read on the real corpus — this is the contrast', () => {
    expect(windowRows(scale).length).toBeGreaterThan(3 * 100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE THREE §12 GUARDS D27 ORIGINALLY LEFT WITHOUT A CORPUS
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§12 — `isExpenseRow` is not `isExpenseListRow`, and only one row shape shows it', () => {
  const refund = base.transactionLines.find((row) => row.isCredit && row.paymentType === 'refund');

  it('the row exists, and the two shipped predicates DISAGREE about it', () => {
    expect(refund).toBeDefined();
    expect(isExpenseRow(refund!)).toBe(false);
    expect(isExpenseListRow(refund!)).toBe(true);
  });

  it('it sits inside the window and in a category the moving average reads', () => {
    expect(base.windowPeriods).toContain(refund?.period);
    expect(monthsObservedByCategory(base).get(DEMO_CATEGORY_GROCERIES) ?? 0).toBeGreaterThan(2);
    expect(refund?.category).toBe(DEMO_CATEGORY_GROCERIES);
  });

  it('!! SWAPPING THE PREDICATES CHANGES A NUMBER, not a count — which is what makes the mutation visible', () => {
    const window = new Set(base.windowPeriods);
    const rows = base.transactionLines.filter((row) => window.has(row.period) && row.category === DEMO_CATEGORY_GROCERIES);
    const sumBy = (predicate: (row: typeof rows[number]) => boolean): number =>
      rows.filter(predicate).reduce((total, row) => total + row.amount, 0);
    expect(sumBy(isExpenseRow)).not.toBe(sumBy(isExpenseListRow));
    expect(sumBy(isExpenseListRow) - sumBy(isExpenseRow)).toBeCloseTo(refund!.amount, 2);
  });
});

describe("§12 — the no-`₪0` guard's FIRST branch: an n=1 category whose one observation was ₪0", () => {
  it('the category is observed exactly once, and that observation is zero', () => {
    expect(monthsObservedByCategory(base).get(DEMO_CATEGORY_HOUSING)).toBe(1);
    const rows = base.transactionLines.filter((row) => row.category === DEMO_CATEGORY_HOUSING);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(0);
  });

  it('!! IT IS NOT THE ZERO-HISTORY BRANCH — this category HAS history, and the history is ₪0', () => {
    // The distinction the guard must not collapse. A guard scoped to `monthsObserved === 0` never
    // sees this month, and the screen renders a confident `₪0` for a category nobody can forecast.
    expect(monthsObservedByCategory(base).get(DEMO_CATEGORY_HOUSING)).not.toBe(0);
    expect(monthsObservedByCategory(base).get(DEMO_CATEGORY_EDUCATION)).toBe(0);
  });
});

describe("§12 — the no-`₪0` guard's OTHER branch: A9's empty certain layer", () => {
  it('the named month is inside the horizon and is not the first or last of it', () => {
    expect(base.horizonPeriods).toContain(base.emptyCertainPeriod);
    expect(base.horizonPeriods.indexOf(base.emptyCertainPeriod)).toBe(1);
  });

  it('no recurring item, loan, insurance or instalment charges in it — and both neighbours do', () => {
    // Asserted through the real projectors by `emptyCertainMonth`; restated here at the level a
    // reader of this file cares about, with the neighbours named.
    const condition = DEMO_CORPUS_CONDITIONS.find((c) => c.id === 'emptyCertainMonth');
    expect(condition?.holds(base)).toBe(true);
  });

  it('!! AND THE REASON IT IS ARRANGEABLE AT ALL: every insurance is inactive', () => {
    // `projectInsuranceForward` has no end bound, so one ACTIVE policy would charge in every
    // horizon month and this condition could not exist. D27 asked for both — see `demoCorpus.ts`'s
    // header, defect (2). The cost is stated rather than hidden: the certain layer carries no
    // insurance line on this corpus.
    expect(base.insurances.every((policy) => policy.status !== 'active')).toBe(true);
    expect(base.insurances.map((policy) => policy.premiumFrequency).sort()).toEqual(['monthly', 'yearly']);
  });
});

describe("§12 — D20's shuffle-invariance, on a REAL colliding pair rather than a hand-built one", () => {
  const collidingItems = (): ForecastLineItem[] =>
    base.forecastAssumptions
      .filter((a) => a.scopeKind === 'category' && a.scopeId === DEMO_CATEGORY_GROCERIES)
      .map((a) => ({
        period: a.fromPeriod,
        categoryId: a.scopeId,
        direction: 'expense' as const,
        amountILS: a.amountILS,
        basis: {
          kind: 'assumption' as const,
          assumptionId: a.id,
          source: a.source,
          updatedAt: a.updatedAt,
          overrides: [],
        },
      }));

  it('two assumptions, two owners, one bucket, different amounts AND different updatedAt', () => {
    const items = collidingItems();
    expect(items).toHaveLength(2);
    expect(items[0].amountILS).not.toBe(items[1].amountILS);
    expect(new Set(base.forecastAssumptions.filter((a) => a.scopeId === DEMO_CATEGORY_GROCERIES).map((a) => a.ownerId)).size).toBe(2);
  });

  it('!! THE WINNER IS THE SAME IN BOTH INPUT ORDERS, and it is visible in a FIGURE', () => {
    const forwards = resolveLayerPrecedence(collidingItems());
    const backwards = resolveLayerPrecedence(collidingItems().reverse());
    expect(JSON.stringify(forwards)).toBe(JSON.stringify(backwards));
    expect(forwards).toHaveLength(1);

    // D20's middle tier: latest `updatedAt` wins. Both amounts are real numbers on real documents,
    // so a broken tiebreak changes the figure on the screen rather than only an ordering.
    const latest = base.forecastAssumptions
      .filter((a) => a.scopeId === DEMO_CATEGORY_GROCERIES)
      .reduce((newest, a) => (a.updatedAt > newest.updatedAt ? a : newest));
    expect(forwards[0].amountILS).toBe(latest.amountILS);
    expect(forwards[0].amountILS).not.toBe(
      base.forecastAssumptions.find((a) => a.scopeId === DEMO_CATEGORY_GROCERIES && a.id !== latest.id)?.amountILS
    );
  });
});

describe("D19 — an assumption overriding a CERTAIN item, on real documents", () => {
  it('the loan-scoped assumption and the loan itself land in the same bucket, and it wins', () => {
    const certainLoan = projectLoanForward(
      base.loans.find((loan) => loan.id === 'demo-loan-car')!,
      base.anchorPeriod,
      base.anchorPeriod
    );
    expect(certainLoan).toHaveLength(1);
    expect(certainLoan[0].categoryId).toBe(CATEGORY_LOAN_REPAYMENT);

    const assumption = base.forecastAssumptions.find((a) => a.scopeKind === 'loan');
    expect(assumption).toBeDefined();
    const resolved = resolveLayerPrecedence([
      ...certainLoan,
      {
        period: base.anchorPeriod,
        categoryId: CATEGORY_LOAN_REPAYMENT,
        direction: 'expense',
        amountILS: assumption!.amountILS,
        basis: { kind: 'assumption', assumptionId: assumption!.id, source: 'user', updatedAt: assumption!.updatedAt, overrides: [] },
      },
    ]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].amountILS).toBe(assumption!.amountILS);
    // The displaced certain item is RECORDED, not deleted — the card can show both numbers.
    expect(resolved[0].basis.kind).toBe('assumption');
    expect(resolved[0].basis.kind === 'assumption' && resolved[0].basis.overrides[0].kind).toBe('loan');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D26 — the cold-start table, and the WEAKEST rule
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("D26 — all four cold-start bands coexist, per category, in ONE corpus", () => {
  const observed = monthsObservedByCategory(base);

  it('a category with 0, one with 1, one with 2, one with 3, one with 6 and one with 8', () => {
    const counts = [...observed.values()].sort((a, b) => a - b);
    expect(counts).toContain(0);
    expect(counts).toContain(1);
    expect(counts).toContain(2);
    expect(counts).toContain(3);
    expect(counts).toContain(6);
    expect(counts).toContain(8);
  });

  it('the >6 band is REAL — one category is observed above the window cap', () => {
    expect(observed.get(DEMO_CATEGORY_GROCERIES)).toBeGreaterThan(DEMO_WINDOW_MONTHS);
  });

  it("the 0 band is a category the screen DRAWS, not one that is simply absent", () => {
    // D26 row 0 per category: `DEMO_CATEGORY_EDUCATION` has a recurring item charging into the
    // horizon and not one transaction row. That combination is what makes an explicit gap, rather
    // than a missing bucket, the correct rendering.
    expect(observed.get(DEMO_CATEGORY_EDUCATION)).toBe(0);
    expect(base.recurring.some((item) => item.category === DEMO_CATEGORY_EDUCATION)).toBe(true);
    expect(base.transactionLines.some((row) => row.category === DEMO_CATEGORY_EDUCATION)).toBe(false);
  });
});

describe("D26/D14 — a month's confidence inherits the WEAKEST category, never the average", () => {
  it('the last history month mixes a category observed 8 times with one observed once', () => {
    const observed = monthsObservedByCategory(base);
    const month = base.historyPeriods[base.historyPeriods.length - 1];
    const counts = categoriesInPeriod(base, month).map((category) => observed.get(category) ?? 0);

    expect(Math.max(...counts)).toBe(8);
    expect(Math.min(...counts)).toBe(1);
    // The number the month must report. The AVERAGE of these would be well above 3 and would hide
    // a one-month-old category behind five mature ones — D14's exact failure mode.
    const average = counts.reduce((sum, n) => sum + n, 0) / counts.length;
    expect(Math.min(...counts)).toBe(1);
    expect(average).toBeGreaterThan(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D16 — the three staleness bands
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('D16 — one account in each staleness band, graded by the shipped function', () => {
  it("'current', 'stale' and 'very-stale' all occur", () => {
    const bands = base.accounts.map((account) => computeOpeningBalance([account], base.asOfDate)?.staleness);
    expect(new Set(bands)).toEqual(new Set(['current', 'stale', 'very-stale']));
  });

  it('the opening balance over all three is a real number with a real `asOf`', () => {
    const opening = computeOpeningBalance(base.accounts, base.asOfDate);
    expect(opening).not.toBeNull();
    expect(opening?.accountsCounted).toBe(3);
    expect(periodOf(opening!.asOf)).toBe(base.anchorPeriod);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3/§5.4 — twenty members with money
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 — the 20-member corpus, which is the first one with money in it', () => {
  it('twenty members, and every attributable one owns rows worth more than ₪0', () => {
    expect(scale.members).toHaveLength(DEMO_LARGE_MEMBER_COUNT);
    const spend = new Map<string, number>();
    for (const row of scale.transactionLines) spend.set(row.ownerId, (spend.get(row.ownerId) ?? 0) + row.amount);
    for (const member of attributableMembers(scale.members)) {
      expect(spend.get(member.id) ?? 0, `${member.name} owns no money`).toBeGreaterThan(0);
    }
  });

  it("reuses `largeFamily.ts`'s name shape rather than importing a test fixture into `src/`", () => {
    // The coupling is pinned in both directions: if either formula changes, this goes red.
    const fixtureNames = LARGE_FAMILY_MEMBERS.map((m) => String(m.name));
    expect(fixtureNames[7]).toBe(largeFamilyMemberName(7));
    expect(scale.members.map((m) => m.name)).toContain(largeFamilyMemberName(DEMO_BASE_MEMBER_COUNT));
  });

  it('the base corpus is deliberately four members, and the fourth is the duplicate name', () => {
    expect(base.members).toHaveLength(DEMO_BASE_MEMBER_COUNT);
    expect(new Set(base.members.map((m) => m.name)).size).toBe(DEMO_BASE_MEMBER_COUNT - 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Refusals, and the one union gap this corpus depends on
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("T3 review F1 — every `date` and `owner` this corpus emits is a STRING", () => {
  // The backfill casts `doc.data.date as string` and calls `.includes` on it with no type guard,
  // so a NUMBER or a Timestamp date throws `TypeError: dateStr.includes is not a function` before
  // the backup and with no document id in the message. That is T3's defect to fix, not this task's
  // — but a generator that emitted `date: 12345` to "make an unparseable date" would hand the
  // backfill a corpus that crashes it, and the crash would look like this task's bug.
  //
  // Unreadability is therefore expressed the way the ledger actually holds it: as STRINGS that
  // `parseTransactionDate` refuses. Held here so the next person to add an "even more unreadable"
  // row cannot reach for a non-string.
  it('no row carries a non-string `date`, however unreadable that date is', () => {
    for (const row of base.transactionLines) {
      expect(typeof row.date, `${row.id} has a non-string date`).toBe('string');
    }
    expect(base.transactionLines.some((row) => periodOf(row.date) === null)).toBe(true);
  });

  it('no row carries a non-string `owner`, however unresolvable that owner is', () => {
    for (const row of base.transactionLines) {
      expect(typeof row.owner, `${row.id} has a non-string owner`).toBe('string');
      expect(row.owner.length).toBeGreaterThan(0);
    }
    expect(base.transactionLines.some((row) => row.ownerId === UNKNOWN_OWNER_ID)).toBe(true);
  });

  it("`incomes` month/year are strings too — `periodOfMonthYear` refuses '13', it does not throw", () => {
    for (const row of base.incomes) {
      expect(typeof row.month).toBe('string');
      expect(typeof row.year).toBe('string');
    }
    expect(base.incomes.some((row) => row.period === UNKNOWN_PERIOD)).toBe(true);
  });
});

describe('the generator refuses rather than degrading', () => {
  it('refuses a member count below the four the named conditions need', () => {
    expect(() => buildDemoCorpus({ memberCount: 3 })).toThrow(/memberCount/);
    expect(() => buildDemoCorpus({ memberCount: 4.5 })).toThrow(/memberCount/);
  });

  it('refuses an unreadable asOfDate instead of anchoring on `unknown`', () => {
    expect(() => buildDemoCorpus({ asOfDate: '9999-99-99' })).toThrow(/asOfDate/);
    expect(() => buildDemoCorpus({ asOfDate: '' })).toThrow(/asOfDate/);
  });

  it('refuses a non-integer seed — a float seed silently truncates inside the PRNG', () => {
    expect(() => buildDemoCorpus({ seed: 1.5 })).toThrow(/seed/);
  });
});

describe("the `'seasonality'` union gap, pinned at exactly one name", () => {
  it("`ASSUMPTION_SCOPE_KINDS` still omits it, so T6 adding it turns THIS test red", () => {
    // T2's note (b): Rules accept six scope kinds while the client union carries five, and the gap
    // is `'seasonality'`. This corpus emits one, through a demo-local widening of exactly that one
    // string. When T6 lands, the widening is redundant and this assertion says so.
    expect(ASSUMPTION_SCOPE_KINDS).not.toContain(DEMO_SEASONALITY_SCOPE_KIND);
    expect(DEMO_SEASONALITY_SCOPE_KIND).toBe('seasonality');
    const demoKinds = new Set(base.forecastAssumptions.map((a) => a.scopeKind));
    const extra = [...demoKinds].filter((kind) => !ASSUMPTION_SCOPE_KINDS.some((k) => k === kind));
    expect(extra).toEqual([DEMO_SEASONALITY_SCOPE_KIND]);
  });
});
