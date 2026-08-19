// src/utils/forecastTargets.ts — Stage 7 T6, D29. "מה צריך לקרות".
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE FIRST THING THIS APP SHIPS THAT TELLS A FAMILY WHAT TO DO WITH MONEY
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Everything else in Stage 7 answers "what is likely to happen". This module answers "what would
// have to change" — and the difference is that a wrong answer here is ACTED ON. Three rulings shape
// every function below, and each of them is a place the obvious implementation is worse than
// useless:
//
//  1. **THE SHAVE POOL IS DISCRETIONARY SPEND ONLY (D29).** Spreading a shortfall across every
//     category tells a family to reduce their mortgage by 4%, and a family that reads that once
//     stops reading the line. Only the STATISTICAL categories are shaved, and a `'category'`
//     assumption carrying `flexible: false` takes one out — which is the escape hatch that avoids
//     making the family classify every category before the first useful answer (a setup tax the
//     plan rejects by name).
//
//  2. **THE REFUSAL IS THE IMPORTANT HALF (D8, upheld verbatim in D29).** If the shortfall exceeds
//     the entire flexible projection there is no allowance to compute, and the answer is a stated
//     unreachability with the gap size — NEVER A NEGATIVE ALLOWANCE. "Spend −₪400 on groceries" is
//     arithmetically derived and semantically empty. There is deliberately NO earlier refusal (no
//     "the pool is empty" branch, no "nothing projected" branch) above the one comparison that owns
//     this, because an earlier refusal is how the real one gets shadowed — nineteen shadowed guards
//     have been found in this stage, and one was found to be doubly shadowed.
//
//  3. **RANK BY SHEKELS, LEAD WITH NAMES (A28).** "Reduce every flexible category by 12%" computes
//     correctly and advises uselessly; it is not a thing a family executes. The rows are ordered by
//     absolute shekel size and the top one to three are named. The proportional table stays,
//     underneath, unchanged.
//
// ── AND THE COPY DECISION, WHICH IS NOT A COPY DECISION ───────────────────────────────────────
//
// The row is phrased **"כדאי לבדוק"** and not as an instruction, and `ADVICE_BOUNDARY_NOTICE_HE`
// ships beside it (D29e). §9 pins that notice to the Stage 8 insights screen; this is the surface
// that needs it first. Both live in `forecastCopy.ts` with the argument written out there.
//
// ── PURITY ────────────────────────────────────────────────────────────────────────────────────
//
// Pure over its inputs: no I/O, no Firebase, no clock. The caller does the reading — including the
// `settings/budgetConfig` read that a family member is NOT PERMITTED to make, which is why
// `budgetConfigTargetILS` treats "unreadable", "absent" and "present but empty" as one answer.
import { comparePeriod, isPeriod, laterPeriod } from './periodMath';
import { monthKeyOfHebrewName } from '../config/hebrewMonths';
import type { ForecastAssumption } from '../types/finance';

/** Agorot. The same rounding rule every producer of money in this stage follows. */
const AGOROT = 100;
function roundILS(amount: number): number {
  return Math.round(amount * AGOROT) / AGOROT;
}

const PERCENT = 100;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// goals — ownerless, with a Hebrew month-name date
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A `goals` document as it actually arrives. Every field is `unknown` because none of them is
 * validated by Rules beyond existence, the collection predates this stage, and root `tsconfig` is
 * NOT strict — so a declared `string` here would be a claim the compiler cannot keep.
 */
export interface GoalRecord {
  firestoreId?: string;
  name?: unknown;
  target?: unknown;
  current?: unknown;
  date?: unknown;
}

export interface GoalTarget {
  name: string;
  duePeriod: string;
  /** `target − current`, floored at zero. A goal that is over-funded contributes nothing, not a credit. */
  remainingILS: number;
}

export interface ResolvedGoals {
  targets: GoalTarget[];
  /** D29(c) — goals whose date or amount could not be read. VISIBLE, never silently dropped. */
  excludedCount: number;
  /** Readable, but due after this horizon. A different thing from unreadable, and not a defect. */
  beyondHorizonCount: number;
}

/**
 * `'ספטמבר 2026'` → `'2026-09'`, and `null` for anything else.
 *
 * `goals.date` is assembled by the goal form as `` `${month} ${year}` `` from the twelve names in
 * `HEBREW_MONTH_NAMES` — the array this module and that form now SHARE (D29c: moved, not
 * duplicated, because two copies agree until one is renamed and then every goal in that month
 * becomes "unparseable" rather than "mismatched").
 *
 * !! IT REFUSES RATHER THAN GUESSING, and the count of refusals is rendered. A parser that fell
 * back to "this month" would place an unread goal on the calendar at a date nobody chose, and the
 * allowance beneath it would be wrong with no symptom at all.
 */
export function parseHebrewGoalPeriod(date: unknown): string | null {
  if (typeof date !== 'string') return null;
  const parts = date.trim().split(/\s+/);
  if (parts.length !== GOAL_DATE_PARTS) return null;
  const [monthName, year] = parts;
  const monthKey = monthKeyOfHebrewName(monthName);
  if (monthKey === null) return null;
  // !! `isPeriod` IS THE YEAR CHECK, and the first draft's separate `/^\d{4}$/.test(year)` was a
  // MUTATION SURVIVOR — removing it changed nothing, twice, because `isPeriod`'s own pattern is
  // `^\d{4}-(0[1-9]|1[0-2])$` and every year this could reject makes a period `isPeriod` rejects
  // anyway (`'26'` → `'26-09'`, `'20261'` → `'20261-09'`, `'2e3'` → `'2e3-09'`). A check that sells
  // a guarantee another line is already providing is the F5/F6 class this stage has now hit three
  // times, so it is gone and the mechanism is written down instead.
  //
  // `isPeriod` is also the RIGHT place for it: it is this codebase's one definition of a period,
  // and a caller of `comparePeriod` must never be handed anything else.
  const period = `${year}-${monthKey}`;
  return isPeriod(period) ? period : null;
}

/** `'<month name>'` and `'<year>'` — the two tokens the goal form writes, and nothing else. */
const GOAL_DATE_PARTS = 2;

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The goals that bear on this horizon, and a count of the ones that could not be read.
 *
 * A goal due BEFORE the horizon is in scope: it is overdue, not irrelevant, and dropping it would
 * quietly reduce the family's target on the day it slipped. A goal due AFTER the horizon is
 * counted separately — it is a real goal that this period is simply not responsible for, and
 * folding it into `excludedCount` would report a data defect where there is none.
 */
export function resolveGoalTargets(goals: GoalRecord[], horizon: string[]): ResolvedGoals {
  // `laterPeriod`, NOT `comparePeriod(a, b) >= 0 ? a : b`. The hand-written clamp is TOTAL because
  // `comparePeriod` is, so on a malformed horizon entry it does not fail — it quietly picks a side,
  // and the accident goes the OPPOSITE way for `''` than for `'unknown'`. `loopTermination.test.ts`
  // bans the idiom structurally across the tree; this is one of the places it would have been
  // written by hand.
  const lastPeriod = horizon.length === 0 ? null : horizon.reduce(laterPeriod);
  const targets: GoalTarget[] = [];
  let excludedCount = 0;
  let beyondHorizonCount = 0;

  for (const goal of goals) {
    const duePeriod = parseHebrewGoalPeriod(goal.date);
    const target = finiteNumber(goal.target);
    if (duePeriod === null || target === null) {
      excludedCount += 1;
      continue;
    }
    if (lastPeriod !== null && comparePeriod(duePeriod, lastPeriod) > 0) {
      beyondHorizonCount += 1;
      continue;
    }
    const current = finiteNumber(goal.current) ?? 0;
    // NOT `Math.max(…, 0)`. That was the second equivalent survivor in this function: the `<= 0`
    // below already drops an over-funded goal, so flooring first changed no output ever. One
    // mechanism, stated once — an over-funded goal contributes NOTHING, not a credit against the
    // other goals, which is what a surviving negative remaining would have become when they are
    // summed in `resolveTarget`.
    const remainingILS = roundILS(target - current);
    if (remainingILS <= 0) continue;
    targets.push({
      name: typeof goal.name === 'string' ? goal.name : '',
      duePeriod,
      remainingILS,
    });
  }
  return { targets, excludedCount, beyondHorizonCount };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// `settings/budgetConfig` — the target source with no data in it
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The period target held in `settings/budgetConfig`, or `null`.
 *
 * !! UNREADABLE, ABSENT AND EMPTY ARE THE SAME ANSWER, and that is D29(c)'s ruling rather than a
 * simplification. `settings/{docId}` is parent-or-super-admin READ, so a `'member'` session gets a
 * permission denial here — proven on the emulator in `forecast-calibration.rules.test.ts`, because
 * it is a Rules fact a mocked suite cannot see. There is nothing a member can do differently about
 * a denial, an absent document or an empty one, so all three produce NO TARGET, NO LINE, and a calm
 * state. **Never a fabricated target, and never ₪0** — ₪0 is a target a family has met by doing
 * nothing, which is the opposite of what "we could not read one" means.
 *
 * T0 measured this document as `{"members": []}`: there are ZERO targets of any kind in the real
 * corpus today, so `null` is not the defensive branch, it is the live one.
 */
export function budgetConfigTargetILS(doc: unknown): number | null {
  if (doc === null || typeof doc !== 'object') return null;
  const value = (doc as { periodTargetILS?: unknown }).periodTargetILS;
  const amount = finiteNumber(value);
  if (amount === null || amount <= 0) return null;
  return roundILS(amount);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// which target this screen is looking at
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type TargetSource = 'personalTarget' | 'budgetConfig' | 'goal';

export type TargetResolution =
  | { status: 'none'; goalsExcludedCount: number; beyondHorizonCount: number }
  | {
      status: 'target';
      source: TargetSource;
      amountILS: number;
      /**
       * D29(c) — `goals` and `budgetConfig` are OWNERLESS, so a target from either is a statement
       * about the FAMILY even when it appears on one member's screen. The copy must say so
       * (`ALLOWANCE_FAMILY_GOAL_NOTE_HE`), or the member reads the allowance beneath it as theirs.
       */
      isFamilyScoped: boolean;
      goalsExcludedCount: number;
      beyondHorizonCount: number;
    };

/** Whether an assumption's `[fromPeriod, toPeriod]` window covers any period in the horizon. */
function coversHorizon(assumption: ForecastAssumption, horizon: string[]): boolean {
  if (!isPeriod(assumption.fromPeriod)) return false;
  return horizon.some((period) => {
    if (!isPeriod(period)) return false;
    if (comparePeriod(period, assumption.fromPeriod) < 0) return false;
    if (assumption.toPeriod === undefined) return true;
    if (!isPeriod(assumption.toPeriod)) return false;
    return comparePeriod(period, assumption.toPeriod) <= 0;
  });
}

/**
 * The target, in the order D29 gives them.
 *
 *   1. **The member's own `personalTarget`** (A30 as amended) — the answer that turns the `'own'`
 *      screen from a refusal into "כמה נשאר לי להוציא". It is owned, so it is genuinely personal.
 *   2. **`settings/budgetConfig`**, when it is readable and carries a number. Family-scoped.
 *   3. **`goals`**, summed over the ones due within the horizon. Family-scoped, and the copy says so.
 *
 * A member with no personal target still sees the family target — with `isFamilyScoped: true`, so
 * the line can state what it is. Falling through to "no target" instead would hide the family's own
 * goal from the family.
 */
export function resolveTarget(input: {
  memberId: string | null;
  horizon: string[];
  assumptions: ForecastAssumption[];
  goals: GoalRecord[];
  budgetConfigDoc: unknown;
}): TargetResolution {
  const goals = resolveGoalTargets(input.goals, input.horizon);
  const counts = {
    goalsExcludedCount: goals.excludedCount,
    beyondHorizonCount: goals.beyondHorizonCount,
  };

  if (input.memberId !== null) {
    const personal = input.assumptions.filter(
      (a) =>
        a.scopeKind === 'personalTarget' &&
        a.status === 'active' &&
        a.scopeId === input.memberId &&
        a.ownerId === input.memberId &&
        (finiteNumber(a.amountILS) ?? 0) > 0 &&
        coversHorizon(a, input.horizon)
    );
    if (personal.length > 0) {
      // D20's tail, for the same reason `seasonality.ts` applies it: newest wins, id breaks the tie,
      // so two targets cannot make the figure depend on Firestore's return order.
      const winner = personal.reduce((best, candidate) => {
        const byInstant = String(candidate.updatedAt).localeCompare(String(best.updatedAt));
        if (byInstant !== 0) return byInstant > 0 ? candidate : best;
        return String(candidate.id).localeCompare(String(best.id)) < 0 ? candidate : best;
      });
      return {
        status: 'target',
        source: 'personalTarget',
        amountILS: roundILS(winner.amountILS),
        isFamilyScoped: false,
        ...counts,
      };
    }
  }

  const budget = budgetConfigTargetILS(input.budgetConfigDoc);
  if (budget !== null) {
    return { status: 'target', source: 'budgetConfig', amountILS: budget, isFamilyScoped: true, ...counts };
  }

  const goalTotal = roundILS(goals.targets.reduce((sum, goal) => sum + goal.remainingILS, 0));
  if (goalTotal > 0) {
    return { status: 'target', source: 'goal', amountILS: goalTotal, isFamilyScoped: true, ...counts };
  }
  return { status: 'none', ...counts };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the allowance
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** One statistical category's projected spend over the WHOLE period, not per month. */
export interface AllowanceCategory {
  categoryId: string;
  projectedILS: number;
}

export interface AllowanceRow {
  categoryId: string;
  projectedILS: number;
  allowanceILS: number;
  reductionILS: number;
  sharePct: number;
}

export type AllowanceResult =
  | { status: 'no-target' }
  | { status: 'target-met'; surplusILS: number }
  | { status: 'unreachable'; shortfallILS: number; flexibleTotalILS: number; gapILS: number }
  | { status: 'allowances'; shortfallILS: number; rows: AllowanceRow[]; leadCategoryIds: string[] };

/**
 * A28 — one to three named moves. A family executes "look at restaurants first"; nobody executes a
 * table of nine percentages, which is why the table is BELOW the names and not instead of them.
 */
export const ALLOWANCE_LEAD_MAX = 3;

/**
 * Which of the statistical categories the family could actually choose not to spend.
 *
 * Everything the statistical layer estimated is flexible BY DEFAULT, and a `'category'` assumption
 * carrying `flexible: false` takes one out. That default is the ruling: asking a family to classify
 * every category before the first useful answer is a setup tax, so `flexible: false` is expressible
 * as an assumption instead — the same document, the same audit trail, the same hover reason.
 *
 * The flag is read ONLY from a `'category'` assumption whose window covers the horizon. A
 * `flexible: false` on a `'loan'` scope is meaningless (a loan is not in the statistical set at
 * all), and honouring it here would let an unrelated scope id silently remove a same-named spend
 * category from the pool.
 */
export function flexibleCategoryIds(input: {
  categories: AllowanceCategory[];
  assumptions: ForecastAssumption[];
  horizon: string[];
}): string[] {
  const fixed = new Set(
    input.assumptions
      .filter(
        (a) =>
          a.scopeKind === 'category' &&
          a.status === 'active' &&
          a.flexible === false &&
          coversHorizon(a, input.horizon)
      )
      .map((a) => a.scopeId)
  );
  return input.categories.map((c) => c.categoryId).filter((id) => !fixed.has(id));
}

/**
 * D29's allowance, its two calm states, and its refusal.
 *
 * `categoryAllowance(c) = projection(c) − shortfall × share(c)`, `share` over the FLEXIBLE total.
 * Sharing over the total of everything would understate every cut and leave the period still
 * missing the target, while looking like arithmetic.
 *
 * ── THE ORDER OF THE FOUR BRANCHES IS THE RULING ──────────────────────────────────────────────
 *
 *   1. no target                 — D29(c): no line, calm, never fabricated.
 *   2. shortfall ≤ 0             — the target is already covered; there is nothing to shave.
 *   3. **shortfall > flexible total ⇒ UNREACHABLE.** The one comparison that owns the refusal.
 *   4. otherwise, allowances.
 *
 * There is NO branch above (3) for "the pool is empty" or "nothing is projected", and their absence
 * is deliberate. An empty pool has a flexible total of 0, so any positive shortfall exceeds it and
 * (3) fires on its own condition; adding an earlier check would make (3) unreachable in exactly the
 * case a reviewer would test first, and it would be a survivor in every sweep. That is this stage's
 * most-counted defect — nineteen shadowed guards, one of them doubly shadowed by a conjunction
 * satisfied by an empty second half.
 */
export function computeAllowance(input: {
  targetILS: number | null;
  projectedILS: number;
  categories: AllowanceCategory[];
  flexibleIds: string[];
}): AllowanceResult {
  if (input.targetILS === null) return { status: 'no-target' };

  const shortfallILS = roundILS(input.targetILS - input.projectedILS);
  // `<= 0`, INCLUSIVE, and the sweep found the boundary untested: at exactly zero a `< 0` mutant
  // fell through to the allowance branch and produced a table of rows every one of which says
  // "reduce by ₪0". A target met to the agora is met; it is not a shortfall of nothing.
  //
  // The surplus is computed FORWARD rather than as `-shortfallILS`: negating an exact zero yields
  // `-0`, which is a distinct value in JavaScript, survives `JSON.stringify` as `-0` and renders as
  // "-0" — a minus sign on a met target. Found by the boundary test this survivor asked for.
  if (shortfallILS <= 0) return { status: 'target-met', surplusILS: roundILS(input.projectedILS - input.targetILS) };

  const flexible = new Set(input.flexibleIds);
  const pool = input.categories.filter((c) => flexible.has(c.categoryId) && c.projectedILS > 0);
  const flexibleTotalILS = roundILS(pool.reduce((sum, c) => sum + c.projectedILS, 0));

  if (shortfallILS > flexibleTotalILS) {
    return {
      status: 'unreachable',
      shortfallILS,
      flexibleTotalILS,
      gapILS: roundILS(shortfallILS - flexibleTotalILS),
    };
  }

  const rows: AllowanceRow[] = pool
    .map((c) => {
      const share = c.projectedILS / flexibleTotalILS;
      const reductionILS = roundILS(shortfallILS * share);
      return {
        categoryId: c.categoryId,
        projectedILS: roundILS(c.projectedILS),
        // Floored at zero as well as bounded by the refusal above. The refusal makes a negative
        // impossible for the pool as a whole; the floor makes it impossible for a single row under
        // any future rounding, and a floor that can never fire is cheaper than a defect that can.
        allowanceILS: roundILS(Math.max(c.projectedILS - reductionILS, 0)),
        reductionILS,
        sharePct: roundILS(share * PERCENT),
      };
    })
    // A28 — BY ABSOLUTE SHEKELS, largest first. The tie-break on the id is what keeps the order
    // stable between renders when two categories cost the same, so the "top three" cannot shuffle.
    .sort((a, b) => b.projectedILS - a.projectedILS || a.categoryId.localeCompare(b.categoryId));

  return {
    status: 'allowances',
    shortfallILS,
    rows,
    leadCategoryIds: rows.slice(0, ALLOWANCE_LEAD_MAX).map((r) => r.categoryId),
  };
}
