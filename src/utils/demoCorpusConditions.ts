// src/utils/demoCorpusConditions.ts — Stage 7 T4 (D27). THE NAMED PRESENCE CHECKS.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY EACH CONDITION IS ITS OWN PREDICATE AND NOT A LINE IN ONE BIG ASSERTION
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// D27: "a single 'the corpus is non-empty' check is the tautology class this stage exists to
// delete." A generator that quietly stops emitting the refund row, or the colliding assumption
// pair, or the ₪0 single observation, must turn a NAMED test red — because the guards downstream
// depend on those rows for their own non-vacuity, and a guard whose corpus went missing goes
// GREEN. That is the same failure as a guard nothing exercises, arriving one layer earlier.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// EVERY PREDICATE ASKS THE SHIPPED CODE, NOT ITS OWN RESTATEMENT
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// `refundCreditRowSplitsThePredicates` calls `isExpenseRow` and `isExpenseListRow` and asserts
// they DISAGREE; it does not re-check `isCredit && paymentType === 'refund'`. `emptyCertainMonth`
// runs the real `projectRecurringForward`/`projectLoanForward`/`projectInsuranceForward`/
// `projectInstalmentsForward`. `assumptionOverridesCertainItem` runs the real
// `resolveCategoryOfScope`. `allThreeStalenessBands` runs the real `computeOpeningBalance`.
//
// The difference matters: a restatement passes after somebody breaks the thing it describes. A
// call fails. This is the same reason `demoCorpus.ts` stamps `period`/`ownerId` through
// `periodOrUnknown`/`ownerIdOrUnknown` rather than writing the literal `'unknown'`.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE VARIANT FIELD IS NOT A LOOPHOLE
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Two conditions are properties of SCALE and cannot hold on a four-member corpus: crossing
// `HISTORY_ROW_CEILING`, and §3's twenty-member metric. They are declared `variant: 'scale'` and
// asserted against the `--members=20` corpus. Everything else is declared `variant: 'base'` and
// asserted against the default one. Nothing is declared "not applicable".
import {
  HISTORY_ROW_CEILING,
  computeOpeningBalance,
  layerOf,
  projectInsuranceForward,
  projectInstalmentsForward,
  projectLoanForward,
  projectRecurringForward,
  resolveCategoryOfScope,
  type BalanceStaleness,
  type ForecastLineItem,
} from './forecast';
import { isExpenseRow, isExpenseListRow } from './transactionFilters';
import { comparePeriod, periodOf, periodOfMonthYear, UNKNOWN_PERIOD } from './periodMath';
import { UNKNOWN_OWNER_ID, resolveOwnerId } from './resolveOwnerId';
import {
  DEMO_LARGE_MEMBER_COUNT,
  DEMO_RULES_BLOCKED_LEGACY_DATE,
  DEMO_SEASONALITY_SCOPE_KIND,
  DEMO_WINDOW_MONTHS,
  attributableMembers,
  type DemoCorpus,
  type DemoTransactionLine,
} from './demoCorpus';
import { SEASONAL_FACTOR_MAX, SEASONAL_FACTOR_MIN, type AssumptionScopeKind } from '../types/finance';

/**
 * `firestore.rules`' own `date.size() == 10`, restated so the two `'unknown'` forms this corpus
 * emits can be held to being the ones a client can actually WRITE.
 *
 * T0's correction, and it is the reason the number is here at all: that clause is a LENGTH check,
 * not a format check. A matrix-governed `'member'` — the least-privileged role in the app — can
 * create `date: "9999-99-99"` today, which is why `period: 'unknown'` is a LIVE path rather than a
 * defensive one, and why a generator emitting only Admin-SDK-writable forms would prove less than
 * it appears to. `demoCorpus.test.ts` reads this literal back out of `firestore.rules` rather than
 * trusting this comment.
 */
export const RULES_DATE_SIZE = 10;

export type DemoConditionVariant = 'base' | 'scale';

export interface DemoCondition {
  /** Stable id — this is the name the failing assertion reports, so it never changes casually. */
  id: string;
  /** What the condition exists to make reachable, in one line. */
  why: string;
  variant: DemoConditionVariant;
  holds(corpus: DemoCorpus): boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Shared derivations
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `monthsObserved` per category — the count of DISTINCT history periods in which the category has
 * at least one expense row, over the whole `historyPeriods` span rather than the capped window.
 *
 * Over the whole span on purpose: D26's top band is `> 6`, and a window six months wide can never
 * produce a number above six. The cap is a DISPLAY rule applied to this number, so a corpus that
 * only ever computed the capped value could not tell the `>6` row from the `3–6` one.
 *
 * Categories reached only through the CERTAIN layer (a recurring item with no posted rows) count
 * as `0` rather than being absent. That is D26's row 0 per category, and it is the only way a
 * category the screen draws can have no history at all.
 *
 * `isExpenseRow` decides what an observation IS — the aggregate/report rule, which excludes every
 * credit and every income-category row. Restating it here would let this derivation keep agreeing
 * with a description of the predicate after the predicate changed.
 */
export function monthsObservedByCategory(corpus: DemoCorpus): Map<string, number> {
  const history = new Set(corpus.historyPeriods);
  const periodsByCategory = new Map<string, Set<string>>();

  // Certain-layer-only categories start at zero rather than being absent — D26's row 0.
  for (const item of corpus.recurring) {
    if (item.category === undefined) continue;
    if (!periodsByCategory.has(item.category)) periodsByCategory.set(item.category, new Set());
  }

  for (const line of corpus.transactionLines) {
    if (!history.has(line.period)) continue;
    if (!isExpenseRow(line)) continue;
    const seen = periodsByCategory.get(line.category) ?? new Set<string>();
    seen.add(line.period);
    periodsByCategory.set(line.category, seen);
  }

  const observed = new Map<string, number>();
  for (const [category, periods] of periodsByCategory) observed.set(category, periods.size);
  return observed;
}

/** The categories with at least one expense row in `period`, whatever their `monthsObserved`. */
export function categoriesInPeriod(corpus: DemoCorpus, period: string): string[] {
  const categories = new Set<string>();
  for (const line of corpus.transactionLines) {
    if (line.period !== period) continue;
    if (!isExpenseRow(line)) continue;
    categories.add(line.category);
  }
  return [...categories].sort();
}

/**
 * Every certain-layer line item the corpus projects across its own horizon, through the four real
 * projectors. Nothing here re-derives what a charge is.
 */
export function certainLineItems(corpus: DemoCorpus): ForecastLineItem[] {
  const from = corpus.horizonPeriods[0];
  const to = corpus.horizonPeriods[corpus.horizonPeriods.length - 1];
  if (from === undefined || to === undefined) return [];

  const items: ForecastLineItem[] = [
    ...corpus.recurring.flatMap((item) => projectRecurringForward(item, from, to)),
    ...corpus.loans.flatMap((item) => projectLoanForward(item, from, to)),
    ...corpus.insurances.flatMap((item) => projectInsuranceForward(item, from, to)),
    ...projectInstalmentsForward(corpus.transactionLines, from, to),
  ];
  // !! HONEST NOTE, from this task's own mutation sweep: DELETING THIS FILTER SURVIVES, and that
  // makes it belt-and-braces rather than a property under guard. All four projectors return
  // `'recurring'`/`'loan'`/`'insurance'`/`'installment'` bases by construction, so `layerOf` can
  // never remove an item here and no test can tell the two versions apart. It is kept because
  // `layerOf`'s own `never` branch is what would make a NEW projector kind a build error rather
  // than a silent "certain" — but that is a property of `layerOf`, not of this line, and saying
  // otherwise would be an unheld claim in a comment.
  return items.filter((item) => layerOf(item.basis) === 'certain');
}

/** The rows one `DEMO_WINDOW_MONTHS`-wide family read would return — D33's payload. */
export function windowRows(corpus: DemoCorpus): DemoTransactionLine[] {
  const window = new Set(corpus.windowPeriods);
  return corpus.transactionLines.filter((line) => window.has(line.period));
}

/** The distinct `monthsObserved` band a count falls into, per D26's table. */
function coldStartBand(monthsObserved: number): 'none' | 'thin' | 'full' | 'capped' {
  if (monthsObserved === 0) return 'none';
  if (monthsObserved <= 2) return 'thin';
  if (monthsObserved <= DEMO_WINDOW_MONTHS) return 'full';
  return 'capped';
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The predicates
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** D16/D27 — one account in each of `'current'`, `'stale'` and `'very-stale'`. */
export function allThreeStalenessBands(corpus: DemoCorpus): boolean {
  const bands = new Set<BalanceStaleness>();
  for (const account of corpus.accounts) {
    // ONE account per call, deliberately. `computeOpeningBalance` grades on
    // `max(balanceUpdatedAt)` across the list it is handed, so passing all three at once could
    // only ever produce one answer, and the corpus would satisfy this check with three accounts
    // that all sit in the same band.
    const balance = computeOpeningBalance([account], corpus.asOfDate);
    if (balance !== null) bands.add(balance.staleness);
  }
  return bands.has('current') && bands.has('stale') && bands.has('very-stale');
}

/** D26 — `monthsObserved` 0, 1–2, 3–6 and >6 all present, per category, in one corpus. */
export function allFourColdStartBands(corpus: DemoCorpus): boolean {
  const bands = new Set<string>();
  for (const count of monthsObservedByCategory(corpus).values()) bands.add(coldStartBand(count));
  return bands.has('none') && bands.has('thin') && bands.has('full') && bands.has('capped');
}

/**
 * D26/D14 — a month whose contributing categories include one observed above the window cap AND
 * one observed exactly once, so the month's confidence must inherit the WEAKEST and report 1.
 */
export function weakestCategoryMonth(corpus: DemoCorpus): boolean {
  const observed = monthsObservedByCategory(corpus);
  return corpus.historyPeriods.some((period) => {
    const counts = categoriesInPeriod(corpus, period).map((category) => observed.get(category) ?? 0);
    if (counts.length < 2) return false;
    return Math.min(...counts) === 1 && Math.max(...counts) > DEMO_WINDOW_MONTHS;
  });
}

/**
 * R8 — `period: 'unknown'` reachable, in at least two DISTINCT 10-character date forms.
 * Ten characters is the point: `firestore.rules`' `date.size() == 10` is a LENGTH check (T0), so
 * these are the forms a matrix-governed `'member'` can write TODAY.
 */
export function unknownPeriodRowsInRulesPassingForms(corpus: DemoCorpus): boolean {
  const forms = new Set<string>();
  for (const line of corpus.transactionLines) {
    if (line.period !== UNKNOWN_PERIOD) continue;
    if (line.date.length !== RULES_DATE_SIZE) continue;
    // `periodOf` is asked, not the string inspected: the row must be `'unknown'` BECAUSE the date
    // cannot be read, not because somebody wrote the literal onto a readable one.
    if (periodOf(line.date) !== null) continue;
    forms.add(line.date);
  }
  return forms.size >= 2;
}

/**
 * The 8-character legacy form, present AND PARSING. D27 called it an "unparseable" form; it is
 * not — `parseTransactionDate` reads `DD/MM/YYYY` deliberately. This predicate holds the true
 * property, so the row cannot be quietly moved into the `'unknown'` set by a later reader who
 * trusts the plan's wording over the code.
 */
export function rulesBlockedLegacyDateRowParses(corpus: DemoCorpus): boolean {
  const parsed = periodOf(DEMO_RULES_BLOCKED_LEGACY_DATE);
  if (parsed === null) return false;
  if (DEMO_RULES_BLOCKED_LEGACY_DATE.length === RULES_DATE_SIZE) return false;
  return corpus.transactionLines.some(
    (line) => line.date === DEMO_RULES_BLOCKED_LEGACY_DATE && line.period === parsed
  );
}

/** D21(e)/T3 — two members share a display name, so `resolveOwnerId` refuses to guess. */
export function duplicateDisplayName(corpus: DemoCorpus): boolean {
  const members = corpus.members.map((m) => ({ id: m.id, name: m.name }));
  // !! HONEST NOTE: the `resolveOwnerId` conjunct is an EQUIVALENT MUTANT within this file —
  // replacing it with `true` changes no test here, because a name carried by two members always
  // resolves to `null` under the shipped resolver. It is not decoration: mutating `resolveOwnerId`
  // ITSELF to return the first match (the coin flip T3's loop exists not to be) fires EIGHT tests
  // across this task's suites. The coupling is real and is proven THERE; asking the resolver here
  // is what makes this predicate express the property rather than a count that implies it.
  return corpus.members.some(
    (member) =>
      corpus.members.filter((other) => other.name === member.name).length > 1 &&
      resolveOwnerId(member.name, members) === null
  );
}

/**
 * R8 — `ownerId: 'unknown'` reachable from BOTH of its causes: an ambiguous name (two members
 * carry it) and an orphaned one (no member does). They are different problems and T3's backfill
 * counts them separately; a corpus with only one leaves the other's branch shadowed.
 */
export function unknownOwnerRowsFromBothCauses(corpus: DemoCorpus): boolean {
  // !! THIS IS THE ONE PLACE THAT READS `owner` RATHER THAN `ownerId`, AND IT IS DIAGNOSIS, NOT
  // SCOPING. Every predicate that decides WHOSE a row is uses `ownerId`; the two causes of
  // `'unknown'` — a name two members carry and a name none does — are only distinguishable by
  // looking at the display name that failed to resolve. Scoping on `owner` is the rename hole
  // D21(a) closes; asking it why a resolution failed is not.
  const members = corpus.members.map((m) => ({ id: m.id, name: m.name }));
  const nameCount = (name: string): number => corpus.members.filter((m) => m.name === name).length;

  let ambiguous = false;
  let orphaned = false;
  for (const line of corpus.transactionLines) {
    if (line.ownerId !== UNKNOWN_OWNER_ID) continue;
    if (resolveOwnerId(line.owner, members) !== null) continue;
    if (nameCount(line.owner) > 1) ambiguous = true;
    else if (nameCount(line.owner) === 0) orphaned = true;
  }
  return ambiguous && orphaned;
}

/**
 * D10 — a row with `totalInstallments` set and `installmentNumber: null`, the shape
 * `FileProcessor.ts` actually writes, which a `!== undefined` check reads as present and then
 * projects from `NaN`. Zero instances on the real corpus (T0).
 */
export function instalmentNullRow(corpus: DemoCorpus): boolean {
  return corpus.transactionLines.some(
    (line) => line.totalInstallments !== null && line.installmentNumber === null
  );
}

/** R5 — two genuinely distinct plans that `planKeyOf` merges, documenting the known-wrong output. */
export function collidingInstalmentPlans(corpus: DemoCorpus): boolean {
  const plans = corpus.transactionLines.filter(
    (line) => line.installmentNumber !== null && line.totalInstallments !== null
  );
  // The key is `planKeyOf`'s, which is module-private — so the collision is measured by its
  // OBSERVABLE consequence instead: two rows whose (vendor, totalInstallments, amount) agree
  // while their instalment numbers do not, i.e. two purchases the projector cannot separate.
  return plans.some((a) =>
    plans.some(
      (b) =>
        a.id < b.id &&
        a.vendor === b.vendor &&
        a.totalInstallments === b.totalInstallments &&
        a.amount === b.amount &&
        a.installmentNumber !== b.installmentNumber
    )
  );
}

/** D23(b) — an `incomes` row whose `month`/`year` pair cannot be read, stamped `'unknown'`. */
export function malformedIncomePeriod(corpus: DemoCorpus): boolean {
  return corpus.incomes.some(
    (income) =>
      income.period === UNKNOWN_PERIOD && periodOfMonthYear(income.month, income.year) === null
  );
}

/**
 * D23(a)/§12 — a row on which `isExpenseRow` and `isExpenseListRow` DISAGREE, inside the window
 * and in a category the moving average reads. The only such shape is `isCredit: true` with
 * `paymentType: 'refund'` or `'cancellation'`; without one, swapping the predicates changes
 * nothing and §12's mutation is undetectable.
 */
export function refundCreditRowSplitsThePredicates(corpus: DemoCorpus): boolean {
  const observed = monthsObservedByCategory(corpus);
  const window = new Set(corpus.windowPeriods);
  return corpus.transactionLines.some(
    (line) =>
      window.has(line.period) &&
      (observed.get(line.category) ?? 0) > 0 &&
      isExpenseRow(line) !== isExpenseListRow(line)
  );
}

/**
 * D20 — two assumptions from DIFFERENT owners on the same `(fromPeriod, scopeKind, scopeId)` with
 * DIFFERENT `updatedAt` and DIFFERENT `amountILS`, so shuffle-invariance has a real corpus and the
 * winner is visible in a FIGURE rather than only in an ordering. `updatedAt` is the middle tier of
 * D20's total order; two equal values shadow it (v2.1a).
 */
export function collidingAssumptions(corpus: DemoCorpus): boolean {
  const all = corpus.forecastAssumptions;
  return all.some((a) =>
    all.some(
      (b) =>
        a.id < b.id &&
        a.fromPeriod === b.fromPeriod &&
        a.scopeKind === b.scopeKind &&
        a.scopeId === b.scopeId &&
        a.ownerId !== b.ownerId &&
        a.updatedAt !== b.updatedAt &&
        a.amountILS !== b.amountILS
    )
  );
}

/** D24 — a seasonality assumption, carrying a `factor` inside `SEASONAL_FACTOR_MIN/MAX`. */
export function seasonalityAssumption(corpus: DemoCorpus): boolean {
  return corpus.forecastAssumptions.some(
    (a) =>
      a.scopeKind === DEMO_SEASONALITY_SCOPE_KIND &&
      a.factor !== undefined &&
      a.factor >= SEASONAL_FACTOR_MIN &&
      a.factor <= SEASONAL_FACTOR_MAX
  );
}

/** A30 as amended — a SELF-OWNED `personalTarget`, authored by the member it is about. */
export function personalTargetAssumption(corpus: DemoCorpus): boolean {
  return corpus.forecastAssumptions.some(
    (a) => a.scopeKind === 'personalTarget' && a.scopeId === a.ownerId
  );
}

/**
 * D19 — an assumption whose scope resolves, through the real `resolveCategoryOfScope`, onto the
 * same `(period, categoryId)` bucket as a CERTAIN line item. This is the only way
 * `forecast.assumptionOverride` and the loan mapping are exercised on real data.
 */
export function assumptionOverridesCertainItem(corpus: DemoCorpus): boolean {
  const certain = certainLineItems(corpus);
  return corpus.forecastAssumptions.some((a) => {
    if (a.scopeKind === DEMO_SEASONALITY_SCOPE_KIND) return false;
    const category = resolveCategoryOfScope(a.scopeKind as AssumptionScopeKind, a.scopeId, certain);
    if (category === null) return false;
    return certain.some(
      (item) => item.categoryId === category && comparePeriod(item.period, a.fromPeriod) >= 0
    );
  });
}

/**
 * §12/A39 — a category with exactly ONE observation and that observation is `₪0`. The month it
 * lands in renders a misleading `₪0` if the no-`₪0` guard is scoped only to the zero-HISTORY
 * branch. An n=1 category with a ₪300 observation exercises nothing (D27).
 */
export function zeroAmountSingleObservationCategory(corpus: DemoCorpus): boolean {
  const observed = monthsObservedByCategory(corpus);
  for (const [category, months] of observed) {
    if (months !== 1) continue;
    const rows = corpus.transactionLines.filter((line) => line.category === category && isExpenseRow(line));
    if (rows.length === 1 && rows[0].amount === 0) return true;
  }
  return false;
}

/**
 * A9/D27 — a month INSIDE the horizon with no recurring, loan, insurance or instalment charge,
 * bracketed by months that have one. The bracketing is what distinguishes an empty certain layer
 * from a horizon that has simply run out.
 */
export function emptyCertainMonth(corpus: DemoCorpus): boolean {
  const items = certainLineItems(corpus);
  const index = corpus.horizonPeriods.indexOf(corpus.emptyCertainPeriod);
  // !! HONEST NOTE: widening this to `index < 0` SURVIVES the sweep, and it is equivalent rather
  // than a hole — `horizonPeriods[-1]` and `horizonPeriods[length]` are both `undefined`, and
  // `occupied.has(undefined)` is already `false`, so the bracketing check below rejects an end
  // month on its own. The explicit bound states the intent at the top instead of leaving it to an
  // out-of-range lookup, which is a readability choice and is claimed as nothing more.
  if (index <= 0 || index >= corpus.horizonPeriods.length - 1) return false;

  const occupied = new Set(items.map((item) => item.period));
  if (occupied.has(corpus.emptyCertainPeriod)) return false;
  return occupied.has(corpus.horizonPeriods[index - 1]) && occupied.has(corpus.horizonPeriods[index + 1]);
}

/**
 * D23(b) — a category and month carrying BOTH a recurring-posted row (`recurringId` set) and a
 * manual one, so removing the exclusion changes a NUMBER rather than a count.
 */
export function recurringAndManualRowsShareACategoryMonth(corpus: DemoCorpus): boolean {
  const posted = new Set<string>();
  const manual = new Set<string>();
  for (const line of corpus.transactionLines) {
    const bucket = `${line.period}|${line.category}`;
    if (line.recurringId !== null) posted.add(bucket);
    else manual.add(bucket);
  }
  return [...posted].some((bucket) => manual.has(bucket));
}

/** D27 — recurring items of both `kind`s, and at least one non-`'active'` status. */
export function bothRecurringKindsAndAnInactiveItem(corpus: DemoCorpus): boolean {
  return (
    corpus.recurring.some((item) => item.kind === 'income') &&
    corpus.recurring.some((item) => item.kind === 'expense') &&
    corpus.recurring.some((item) => item.status !== 'active')
  );
}

/** D27 — a loan ending INSIDE the horizon and one whose `endDate` lies beyond it. */
export function loansEndingInsideAndOutsideHorizon(corpus: DemoCorpus): boolean {
  const last = corpus.horizonPeriods[corpus.horizonPeriods.length - 1];
  if (last === undefined) return false;
  const endPeriodOf = (loan: { endDate: string }): string | null => periodOf(loan.endDate);
  return (
    corpus.loans.some((loan) => {
      const end = endPeriodOf(loan);
      return end !== null && comparePeriod(end, last) <= 0;
    }) &&
    corpus.loans.some((loan) => {
      const end = endPeriodOf(loan);
      return end !== null && comparePeriod(end, last) > 0;
    })
  );
}

/**
 * D27 — both `premiumFrequency` values present AS DOCUMENTS, and the name says "as documents"
 * because that is the whole of what it proves (T4 review F-7).
 *
 * !! NO PROJECTOR ON THIS CORPUS EVER READS THE FIELD. Both demo policies are inactive — one
 * `lapsed`, one `cancelled` — so `projectInsuranceForward`'s `status !== 'active'` early return
 * fires BEFORE the monthly/yearly branch. The frequency values are therefore Rules-visible and
 * reader-visible, and invisible to the certain layer.
 *
 * AND THAT IS NOT FIXABLE IN THIS CORPUS, WHICH IS WHY IT IS RENAMED RATHER THAN STRENGTHENED.
 * Making it prove its name means adding an ACTIVE policy of each frequency — and an active
 * insurance charges in EVERY horizon month, which destroys `emptyCertainMonth`, the A9
 * empty-certain-layer branch §12 exists for. The two conditions are mutually exclusive on one
 * corpus. `demoCorpusConditions.test.ts` holds that exclusivity with a test rather than with this
 * paragraph, and `projectInsuranceForward`'s ACTIVE branch keeps its T1 unit tests as its evidence
 * — which `demoCorpus.ts`'s own header already records as a stated cost.
 */
export function bothPremiumFrequenciesAsDocuments(corpus: DemoCorpus): boolean {
  return (
    corpus.insurances.some((policy) => policy.premiumFrequency === 'monthly') &&
    corpus.insurances.some((policy) => policy.premiumFrequency === 'yearly')
  );
}

/**
 * D25(b) — EVERY assumption is `source: 'user'`. `'insight'` is Rules-denied in Stage 7, so a
 * generator that wrote one would either fail against the live emulator or, worse, succeed — and
 * succeeding would mean the Stage 8 seam is not enforced at the boundary.
 *
 * Requires at least one assumption: `[].every(…)` is `true`, and a vacuous pass here would report
 * a corpus with no assumptions at all as compliant.
 */
export function everyAssumptionIsSourceUser(corpus: DemoCorpus): boolean {
  return (
    corpus.forecastAssumptions.length > 0 &&
    corpus.forecastAssumptions.every((a) => a.source === 'user')
  );
}

/** D33 — one `DEMO_WINDOW_MONTHS` family read returns MORE than `HISTORY_ROW_CEILING` rows. */
export function crossesHistoryRowCeiling(corpus: DemoCorpus): boolean {
  return windowRows(corpus).length > HISTORY_ROW_CEILING;
}

/**
 * §3/§5.4 — twenty members, and every attributable one owns real money. The only 20-member
 * artifact in the tree today is `largeFamily.ts`, which has no financial data at all, so the
 * aggregate-first requirement has never met a real render.
 *
 * ATTRIBUTABLE members only: a member sharing a display name with another cannot own a row at all
 * (`resolveOwnerId` refuses), so requiring money from them would make this condition unsatisfiable
 * in the same corpus that proves the duplicate-name refusal.
 */
export function twentyMembersWithMoney(corpus: DemoCorpus): boolean {
  if (corpus.members.length < DEMO_LARGE_MEMBER_COUNT) return false;
  const spendByOwner = new Map<string, number>();
  for (const line of corpus.transactionLines) {
    spendByOwner.set(line.ownerId, (spendByOwner.get(line.ownerId) ?? 0) + Math.abs(line.amount));
  }
  return attributableMembers(corpus.members).every((member) => (spendByOwner.get(member.id) ?? 0) > 0);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The registry
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const DEMO_CORPUS_CONDITIONS: ReadonlyArray<DemoCondition> = [
  { id: 'allThreeStalenessBands', why: 'D16 renders a staleness grade with the opening balance', variant: 'base', holds: allThreeStalenessBands },
  { id: 'allFourColdStartBands', why: "D26's cold-start table, including row 0", variant: 'base', holds: allFourColdStartBands },
  { id: 'weakestCategoryMonth', why: 'a month inherits the WEAKEST contributing category, never the average', variant: 'base', holds: weakestCategoryMonth },
  { id: 'unknownPeriodRowsInRulesPassingForms', why: "R8 — `period: 'unknown'` is a live path", variant: 'base', holds: unknownPeriodRowsInRulesPassingForms },
  { id: 'rulesBlockedLegacyDateRowParses', why: 'the 8-char legacy form is Rules-blocked but READABLE', variant: 'base', holds: rulesBlockedLegacyDateRowParses },
  { id: 'duplicateDisplayName', why: 'resolveOwnerId refuses a name two members carry', variant: 'base', holds: duplicateDisplayName },
  { id: 'unknownOwnerRowsFromBothCauses', why: "R8 — `ownerId: 'unknown'`, ambiguous AND orphaned", variant: 'base', holds: unknownOwnerRowsFromBothCauses },
  { id: 'instalmentNullRow', why: "D10's `installmentNumber: null` branch", variant: 'base', holds: instalmentNullRow },
  { id: 'collidingInstalmentPlans', why: "R5's known-wrong planKey merge, permanently documented", variant: 'base', holds: collidingInstalmentPlans },
  { id: 'malformedIncomePeriod', why: "D23(b) — incomes' month/year refuses rather than guessing", variant: 'base', holds: malformedIncomePeriod },
  { id: 'refundCreditRowSplitsThePredicates', why: 'the only shape where isExpenseRow and isExpenseListRow differ', variant: 'base', holds: refundCreditRowSplitsThePredicates },
  { id: 'collidingAssumptions', why: "D20's shuffle-invariance on a real corpus", variant: 'base', holds: collidingAssumptions },
  { id: 'seasonalityAssumption', why: "D24's factor, ahead of T6", variant: 'base', holds: seasonalityAssumption },
  { id: 'personalTargetAssumption', why: 'A30 as amended — a child authors their own target', variant: 'base', holds: personalTargetAssumption },
  { id: 'assumptionOverridesCertainItem', why: "D19's most valuable disclosure", variant: 'base', holds: assumptionOverridesCertainItem },
  { id: 'zeroAmountSingleObservationCategory', why: "§12's first no-₪0 branch", variant: 'base', holds: zeroAmountSingleObservationCategory },
  { id: 'emptyCertainMonth', why: "§12's other no-₪0 branch (A9)", variant: 'base', holds: emptyCertainMonth },
  { id: 'recurringAndManualRowsShareACategoryMonth', why: "D23's recurringId exclusion changes a NUMBER", variant: 'base', holds: recurringAndManualRowsShareACategoryMonth },
  { id: 'bothRecurringKindsAndAnInactiveItem', why: "D27 — both kinds, plus projectRecurringForward's early return", variant: 'base', holds: bothRecurringKindsAndAnInactiveItem },
  { id: 'loansEndingInsideAndOutsideHorizon', why: 'D27 — the horizon truncation and the open-ended case', variant: 'base', holds: loansEndingInsideAndOutsideHorizon },
  { id: 'bothPremiumFrequenciesAsDocuments', why: 'D27 — monthly and yearly premiums EXIST as documents; no projector on this corpus reads the field, because both policies are inactive', variant: 'base', holds: bothPremiumFrequenciesAsDocuments },
  { id: 'everyAssumptionIsSourceUser', why: "D25(b) — the Stage 8 seam is enforced, not scanned", variant: 'base', holds: everyAssumptionIsSourceUser },
  { id: 'crossesHistoryRowCeiling', why: "D33's degradation path is provable, not asserted", variant: 'scale', holds: crossesHistoryRowCeiling },
  { id: 'twentyMembersWithMoney', why: '§3/§5.4 — twenty members with actual money', variant: 'scale', holds: twentyMembersWithMoney },
];

export interface DemoConditionResult {
  id: string;
  variant: DemoConditionVariant;
  holds: boolean;
}

/** Every condition evaluated against one corpus. The caller decides which variant it handed in. */
export function evaluateDemoCorpusConditions(corpus: DemoCorpus): DemoConditionResult[] {
  return DEMO_CORPUS_CONDITIONS.map((condition) => ({
    id: condition.id,
    variant: condition.variant,
    holds: condition.holds(corpus),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T4 REVIEW F-5 — THE SEEDER'S REFUSAL, AS TESTED CODE RATHER THAN AS A SCRIPT BRANCH
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `scripts/seed-demo-finances.ts` claims — in its header and in its commit message — that it
// refuses to write a corpus on which any condition fails. It does. Nothing tested it: the emulator
// test asserted only the happy path, so THE SAFETY NET FOR THE WHOLE TASK WAS ITSELF SHADOWED.
//
// Two decisions lived in that script and neither was reachable by any suite:
//
//   · WHICH CONDITIONS APPLY. `'scale'` conditions are n/a below the large-family size — a real
//     rule, and it was written there as a BARE LITERAL `20` beside a module that already exports
//     `DEMO_LARGE_MEMBER_COUNT`. Two numbers free to drift, which is the class that produced this
//     stage's `HISTORY_ROW_CEILING` ruling.
//   · WHICH ONES FAILED, and therefore whether to refuse.
//
// Both move here, where they are ordinary tested code, and the script routes through them —
// `demoCorpus.test.ts` asserts structurally that it does and that it exits non-zero on a non-empty
// result.
//
// !! AND A FINDING WHILE WRITING IT: THE REFUSAL IS UNREACHABLE FROM THE SCRIPT'S OWN CLI. The
// corpus is deterministic and almost entirely hand-constructed — every condition holds for seeds
// 1..400, for eight `--as-of` dates, and for member counts from 4 to 400. So no end-to-end run can
// ever exercise the refusal branch, which is precisely why it had no test and why it never fired.
// What it protects against is a future edit to `demoCorpus.ts` or to a predicate here; the pure
// function below is the part a suite can hold, and the gap that remains is the `process.exit(1)`
// itself, covered structurally rather than behaviourally. Stated rather than papered over.

export interface DemoConditionOutcome extends DemoConditionResult {
  /**
   * `'scale'` conditions are properties of the `DEMO_LARGE_MEMBER_COUNT` variant. Below that size
   * they are NOT failures — reporting them as such would make every base-corpus run refuse.
   */
  applicable: boolean;
  why: string;
}

/** Every condition against one corpus, each carrying whether it even applies to that corpus. */
export function conditionOutcomes(corpus: DemoCorpus): DemoConditionOutcome[] {
  return DEMO_CORPUS_CONDITIONS.map((condition) => ({
    id: condition.id,
    variant: condition.variant,
    why: condition.why,
    applicable: condition.variant === 'base' || corpus.members.length >= DEMO_LARGE_MEMBER_COUNT,
    holds: condition.holds(corpus),
  }));
}

/**
 * The ids of every APPLICABLE condition that does not hold — the seeder's refusal, as a value.
 *
 * Non-empty means refuse. Ids, not a count: "3 conditions failed" sends an operator to read 24
 * predicates, and a corpus missing a condition silently un-shadows nothing and turns a downstream
 * guard green, so the one thing the message has to carry is WHICH.
 */
export function failingConditionIds(corpus: DemoCorpus): string[] {
  return conditionOutcomes(corpus)
    .filter((outcome) => outcome.applicable && !outcome.holds)
    .map((outcome) => outcome.id);
}
