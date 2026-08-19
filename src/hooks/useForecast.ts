// src/hooks/useForecast.ts — Stage 7 T7a. THE FIRST PRODUCTION CONSUMER OF THE FORECAST ENGINE.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS HOOK IS, AND THE ONE RULING IT EXISTS TO ENFORCE
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// D18: the forecast composes ten independently-graded inputs, and `useScopedRead` exposes ONE
// scalar `status`. So this hook returns a PER-INPUT `Record<key, {scope, state, count}>`, and
// D17's rule runs off that record:
//
//     if ANY balance-contributing input is not 'ok', `projectedBalance` is null and a named gap
//     renders in its place.
//
// **ENFORCED HERE, NEVER IN A COMPONENT.** A component-level guard is a rule a second component
// can skip, and the second component is T7b's full screen. `suppressedBalanceInputs` is a pure
// function in `forecast.ts` so a test can hold the rule without rendering anything, and this hook
// is the only thing that decides whether a balance exists.
//
// ── WHY IT IS NOT `useScopedRead`, AND WHERE IT REUSES IT ─────────────────────────────────────
//
// v2 dropped v1's claim that the forecast "tests whether the `useScopedRead` shape generalizes".
// It does not: `useScopedRead` is typed `<T extends OwnedRecord>` and `transaction_lines` rows are
// not `OwnedRecord`, so they cannot pass through it at all — `useNetWorth` already needed a
// side-channel for ONE ownerless input, and this screen has four. Every read here goes through one
// injected reader interface instead, which is also what keeps the hook mountable in a bare
// `renderHook()` with no Firebase and no providers. Each bypass is named below with its reason.
//
// ── !! THE LONG DOOR IS WALKED HERE, FOR THE FIRST TIME ───────────────────────────────────────
//
// `loadStatisticalHistory` had ZERO non-test call sites until this file. `listTransactionHistory`
// is ONE IMPORT SHORTER and reads no completion marker, and a moving average over a half-stamped
// corpus renders IDENTICALLY to one over all of it. This module imports the long door and nothing
// else from that service; `statisticalHistoryDoor.test.ts` asserts over the AST that no module
// imports both the short door and a statistical-layer export, and that conjunction becomes LIVE
// with this file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { listAccounts } from '../services/AccountsService';
import { listRecurring } from '../services/RecurringService';
import { listLoans } from '../services/LoansService';
import { listInsurances } from '../services/InsurancesService';
import { listForecastAssumptions } from '../services/ForecastAssumptionsService';
import { loadStatisticalHistory, type StatisticalHistoryResult } from '../services/TransactionHistoryService';
// The REFUSAL half of the handle, which is deliberately unbranded and constructible: forging a
// refusal fails closed (it suppresses a figure), so only the permissive half is guarded.
import { refuseStatisticalHistory } from '../utils/statisticalHistory';
import {
  BALANCE_CONTRIBUTING_INPUTS,
  LOOKBACK_MONTHS_MAX,
  assumptionLineItems,
  buildStatisticalLayer,
  composeForecast,
  computeOpeningBalance,
  forecastHorizonOf,
  lookbackWindowPeriods,
  observedInstalmentRowsOf,
  projectInstalmentsForward,
  projectInsuranceForward,
  projectLoanForward,
  projectRecurringForward,
  projectedBalanceByPeriod,
  resolveProjectedBalanceILS,
  suppressedBalanceInputs,
  suppressedOutflowInputs,
  unknownPeriodRowCount,
  type ForecastInputStateKey,
  type ForecastInputStatus,
  type ForecastLineItem,
  type ForecastResult,
  type OpeningBalance,
  type StatisticalLayerResult,
} from '../utils/forecast';
import { resolveTarget, type GoalRecord, type TargetResolution } from '../utils/forecastTargets';
import { resolveOwnedModuleScope, resolveOwnerlessModuleScope } from '../utils/ownedModuleScope';
import type { Account, ForecastAssumption, Insurance, Loan, RecurringItem } from '../types/finance';
import type { ModuleId, PermissionLevel, PermissionRole } from '../types/permissions';
import type { MemberSelection } from '../types/filters';

export type ForecastScope = 'own' | 'family' | 'none';
export type ForecastScopes = Record<ForecastInputStateKey, ForecastScope>;

/**
 * Which permission module each forecast input is read under.
 *
 * Stated as a map rather than a chain of `if`s because it is the one place the forecast's ten
 * inputs meet the nine-member `ModuleId` union, and `tsc` checks both ends of it. `history` reads
 * `transaction_lines` under `expenses` — A40's finding, and the reason T3 gave Dashboard an
 * `expensesViewLevel` prop at all.
 */
export const FORECAST_INPUT_MODULES: Record<ForecastInputStateKey, ModuleId> = {
  accounts: 'accounts',
  incomes: 'income',
  recurring: 'recurring',
  loans: 'loans',
  insurances: 'insurances',
  history: 'expenses',
  assumptions: 'forecast',
  goals: 'goals',
};

/** The inputs whose collections have no owner field — Stage 2 D5. `'own'` grants nothing on these. */
const OWNERLESS_INPUTS: readonly ForecastInputStateKey[] = ['incomes', 'goals'];

/**
 * Resolves every input's read scope from the viewer's role and stored levels.
 *
 * PURE, and separate from the hook for `useNetWorth`'s stated reason: that hook "does no permission
 * resolution of its own, only fetch + compute", and scope resolution is a one-line pure function
 * with its own test suite rather than the stateful machinery a hook exists to hold. Eight scopes is
 * more than a caller should assemble by hand, so the assembling is testable here instead of
 * duplicated at every call site.
 */
export function resolveForecastScopes(input: {
  role: PermissionRole;
  levels: Partial<Record<ModuleId, PermissionLevel | undefined>>;
}): ForecastScopes {
  const scopes = {} as ForecastScopes;
  for (const key of Object.keys(FORECAST_INPUT_MODULES) as ForecastInputStateKey[]) {
    const level = input.levels[FORECAST_INPUT_MODULES[key]];
    scopes[key] = OWNERLESS_INPUTS.includes(key)
      ? resolveOwnerlessModuleScope(input.role, level)
      : resolveOwnedModuleScope(input.role, level);
  }
  return scopes;
}

/**
 * Which of D38's two cards this viewer gets.
 *
 * `'family'` ONLY when every balance-contributing input is family-scoped, because that is the exact
 * condition under which a balance can ever be drawn — a viewer who is structurally unable to reach
 * one would otherwise be shown a card whose whole shape is a figure it can never render. `'own'`
 * gets D29(d)'s reframed card instead: not "will the family be OK", but what this member's own
 * outgoings are.
 *
 * Derived rather than passed, so the two cards cannot both render and cannot both be absent.
 */
export function forecastCardScopeOf(scopes: ForecastScopes): 'own' | 'family' {
  return BALANCE_CONTRIBUTING_INPUTS.every((key) => scopes[key] === 'family') ? 'family' : 'own';
}

/**
 * !! THE מי DECISION — T7b, and it is a departure from D21(b) rather than an implementation of it.
 *
 * ── WHAT D21(b) SAID, AND WHY IT CANNOT BE BUILT ──────────────────────────────────────────────
 *
 * D21(b) rules that מי is applied CLIENT-SIDE, by caching the fetched window and RE-SLICING it when
 * the selection changes. That is not constructible against this stage's own door.
 * `buildStatisticalLayer` accepts a SEALED handle and refuses anything else by identity, so a
 * re-sliced row array is an ungated corpus that only `loadStatisticalHistory` could re-seal — and
 * T7a's review removed the ungated sibling array from this hook's return precisely because
 * re-slicing IT was easy, obvious and silently wrong: a forged instalment row reached `certainILS`,
 * the bucket D38 renders as `מזה כבר סגור`, in every horizon month.
 *
 * ── THE TWO OPTIONS THE LEDGER NAMED, AND WHICH ONE THIS IS ───────────────────────────────────
 *
 * The choice was "a re-seal inside the door" or "מי re-resolving scope the way net worth does".
 * **This is the second, and the first is deliberately not attempted.** A re-seal entry point is a
 * second way to mint a gated handle, and the door's whole value is that there is exactly one — the
 * property the T5 review spent itself establishing after three separate forgeries.
 *
 * So מי does what it already does for net worth one card up (`Dashboard.tsx`'s
 * `netWorthSingleSelected`): a single selected member becomes the TARGET of every read, and every
 * scope collapses to `'own'`. Each read then re-runs its own Rules gate against that member — no
 * array is re-sliced, no handle is re-sealed, and nothing ungated is ever constructed.
 *
 * ── WHAT IT COSTS, STATED ─────────────────────────────────────────────────────────────────────
 *
 * A REFETCH when מי changes. D33's window cache still pays for every other filter change (מה, the
 * horizon, a re-render), which is what it was actually spent on; מי is the one dimension that now
 * costs a read. That is the honest price of not owning a second minting path.
 *
 * ── THE ONE RULE THAT MAKES IT SAFE ───────────────────────────────────────────────────────────
 *
 * `'none'` STAYS `'none'`. A resolved refusal is not a scope to be narrowed, and mapping it to
 * `'own'` would make a filter control attempt a read the viewer was already refused, on every
 * render. Held by its own assertion.
 *
 * Dead-end selections are handled one layer up and not here: the registry entry's
 * `filterModuleId: 'expenses'` means `filterViewableMembers` only offers מי chips for members whose
 * expenses this viewer can read at all.
 */
export function narrowForecastScopesToMember(scopes: ForecastScopes): ForecastScopes {
  const narrowed = {} as ForecastScopes;
  for (const key of Object.keys(scopes) as ForecastInputStateKey[]) {
    narrowed[key] = scopes[key] === 'none' ? 'none' : 'own';
  }
  return narrowed;
}

/**
 * !! WHAT A מי SELECTION ACTUALLY DOES TO THE FORECAST — ALL THREE ANSWERS, NAMED (T7b-review F3).
 *
 * `narrowForecastScopesToMember` is the answer for ONE selected member. The other two answers were
 * a single `?:` in `ForecastScreen.tsx` that produced `null` for both of them, so the screen could
 * not tell "nobody selected anything" from "two people are selected and this forecast is not
 * theirs" — and rendered nothing in either case while the filter bar above said `2 נבחרו`.
 *
 * Three outcomes, three names, instead of a nullable id:
 *
 *   · `'single'`          — one member; the whole computation re-targets to them and says so.
 *   · `'family-fallback'` — A SELECTION IS ACTIVE AND IT DID NOT NARROW. The screen must disclose
 *                           this: it is the one state a reader can be wrong about while being told
 *                           nothing at all.
 *   · `'family'`          — no selection. Nothing to disclose, because nothing was asked for.
 *
 * WHY `'family-fallback'` DISCLOSES RATHER THAN NARROWS: `useForecast` takes ONE `viewerMemberId`,
 * so a SET of members has no representation in the read path at all. Giving it one means a second
 * way to assemble a readable corpus, which is exactly what the T5 door exists to prevent — and it
 * would buy a filter combination that yields the same figures anyway wherever every member is
 * readable. `NetWorthScreen` has the identical fall-through and documents it in a comment; a
 * comment is not something the reader of a screen can see.
 *
 * An EMPTY `'members'` selection and a `'group'` with no group id are `'family'`, not fallbacks:
 * nothing is selected in either, so there is no expectation to correct. Both are asserted.
 */
export type ForecastMemberScope =
  | { kind: 'single'; memberId: string }
  | { kind: 'family-fallback' }
  | { kind: 'family' };

export function forecastMemberScopeOf(selection: MemberSelection): ForecastMemberScope {
  switch (selection.mode) {
    case 'members':
      if (selection.memberIds.length === 1) return { kind: 'single', memberId: selection.memberIds[0] };
      return selection.memberIds.length > 1 ? { kind: 'family-fallback' } : { kind: 'family' };
    case 'group':
      return selection.groupId === null ? { kind: 'family' } : { kind: 'family-fallback' };
    case 'all':
      return { kind: 'family' };
    default: {
      // A total switch rather than a trailing `return`: `MemberSelectionMode` gaining a fourth
      // member should fail `tsc --noEmit` here, not fall through to the family computation with
      // nothing on screen to say which branch a reader is looking at.
      const exhaustive: never = selection.mode;
      void exhaustive;
      return { kind: 'family' };
    }
  }
}

/**
 * Every read the forecast makes, as an interface.
 *
 * INJECTED so the hook is mountable in a bare `renderHook()` — T7a's own stated constraint, and the
 * reason this task does not need a live emulator. The four owned collections keep their real
 * service functions; the four bypasses each carry the reason they are a bypass.
 */
export interface ForecastReaders {
  accounts: (scope: 'own' | 'family', viewerMemberId: string) => Promise<Account[]>;
  recurring: (scope: 'own' | 'family', viewerMemberId: string) => Promise<RecurringItem[]>;
  loans: (scope: 'own' | 'family', viewerMemberId: string) => Promise<Loan[]>;
  insurances: (scope: 'own' | 'family', viewerMemberId: string) => Promise<Insurance[]>;
  assumptions: (scope: 'own' | 'family', viewerMemberId: string) => Promise<ForecastAssumption[]>;
  /** BYPASS — `incomes` has no service layer, no owner field and no screen (finding 1.3.11). */
  incomes: () => Promise<Array<Record<string, unknown>>>;
  /** BYPASS — `goals` is ownerless and predates the repo abstraction; `FuturePlanning.tsx` reads it raw. */
  goals: () => Promise<GoalRecord[]>;
  /**
   * BYPASS, AND THE IMPORTANT ONE — `transaction_lines` rows are not `OwnedRecord`, so
   * `useScopedRead` cannot type them, and the completion-marker refusal lives in this function and
   * nowhere else. It is `loadStatisticalHistory`, never `listTransactionHistory`.
   */
  history: (
    scope: 'own' | 'family',
    viewerMemberId: string,
    periods: string[]
  ) => Promise<StatisticalHistoryResult>;
}

export const DEFAULT_FORECAST_READERS: ForecastReaders = {
  accounts: (scope, viewerMemberId) => listAccounts(scope, viewerMemberId),
  recurring: (scope, viewerMemberId) => listRecurring(scope, viewerMemberId),
  loans: (scope, viewerMemberId) => listLoans(scope, viewerMemberId),
  insurances: (scope, viewerMemberId) => listInsurances(scope, viewerMemberId),
  assumptions: (scope, viewerMemberId) => listForecastAssumptions(scope, viewerMemberId),
  // NO `limit()`, on any of these. D33 forbids it on the history path and
  // `statisticalHistoryDoor.test.ts` now names THIS FILE in that path — a truncated read renders
  // identically to a whole one, and "is this collection empty" is a question a truncated read
  // answers wrongly in exactly the direction D17 cares about.
  incomes: async () => (await getDocs(collection(db, 'incomes'))).docs.map((d) => d.data()),
  goals: async () =>
    (await getDocs(collection(db, 'goals'))).docs.map((d) => ({ firestoreId: d.id, ...d.data() })),
  // !! THE LONG DOOR. Called by identifier, from here, so the AST guard can see the call site.
  history: (scope, viewerMemberId, periods) => loadStatisticalHistory(scope, viewerMemberId, periods),
};

export interface UseForecastConfig {
  viewerMemberId: string;
  scopes: ForecastScopes;
  /** The month מתי selected. May be in the past; D32(a) clamps it forward and reports that it did. */
  anchorPeriod: string;
  /** Which month it is, computed ONCE at the edge in `APP_TIMEZONE` (D32b). Never read from a clock here. */
  todayPeriod: string;
  /** `'YYYY-MM-DD'` in `APP_TIMEZONE` — D16's staleness is measured in days, not months. */
  todayDate: string;
  horizonMonths?: number;
  readers?: ForecastReaders;
}

export interface UseForecastResult {
  inputs: Record<ForecastInputStateKey, ForecastInputStatus>;
  result: ForecastResult | null;
  statisticalLayer: StatisticalLayerResult | null;
  openingBalance: OpeningBalance | null;
  /** `null` unless EVERY balance-contributing input is `'ok'` — D17, and it is decided here. */
  projectedBalanceILS: number | null;
  /** Σ projected income over the horizon. `null` when nothing projects income — never `0`. */
  projectedIncomeILS: number | null;
  /**
   * Σ projected outflow over the horizon — the `'own'` card's glance figure.
   *
   * `null` when any outflow-contributing input is not `'ok'`, for the reason
   * `suppressedOutflowInputs` states: a sum over missing inputs does not go wrong, it goes small,
   * and a small figure under `צפוי לצאת` is the same lie told quietly. `0` with every input present
   * is a real value and renders.
   */
  projectedExpenseILS: number | null;
  /** The part of the outflow that is contractual — D38's one-line committed summary. */
  committedILS: number;
  /** The named gap set behind `projectedBalanceILS`. D17's sentence is GENERATED from this. */
  suppressed: ReturnType<typeof suppressedBalanceInputs>;
  /** The named gap set behind `projectedExpenseILS` — the `'own'` card's own version of the above. */
  suppressedOutflow: ReturnType<typeof suppressedOutflowInputs>;
  /** D29(d) — the `'own'` card names its target; it does not subtract it. */
  target: TargetResolution | null;
  /** The completion-marker refusal, verbatim, when the long door refused to read history. */
  historyRefusalHe: string | null;
  /** §13 — LEDGER-WIDE count of rows whose date could not be read. See `unknownPeriodRowCount`. */
  unusableRowCount: number;
  /**
   * The family's own assumptions, as read.
   *
   * !! EXPOSED FOR D29's `flexibleCategoryIds`, WHICH IS OTHERWISE UNBUILDABLE AT THE SCREEN.
   * That helper narrows the allowance pool using the family's `flexible: false` assumptions, and it
   * takes the assumption documents. Passing it `[]` because the hook did not expose them would have
   * been a call that compiles, runs, and silently offers a category the family has already marked
   * as fixed — a guard with an empty corpus, wearing the name of one that works.
   */
  assumptions: ForecastAssumption[];
  status: 'loading' | 'ready' | 'error' | 'permission-denied';
  reload: () => void;
}

function isPermissionDenied(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'permission-denied';
}

interface ReadOutcome<T> {
  items: T[];
  status: ForecastInputStatus;
}

/**
 * One read, graded.
 *
 * A `'none'` scope NEVER ISSUES THE QUERY — `useScopedRead`'s own rule, and its reason holds here
 * too: "don't query at all" is not the same as "query and expect empty", and a permission state
 * derived from a query result depends on the query having been attempted.
 *
 * `'empty'` is a SUCCESSFUL read of nothing, and it is the state A2 is about. A permission-keyed
 * rule would not fire on it and a balance built on absent income would render at glance scale.
 */
async function gradedRead<T>(
  scope: ForecastScope,
  read: (scope: 'own' | 'family') => Promise<T[]>
): Promise<ReadOutcome<T>> {
  if (scope === 'none') return { items: [], status: { scope, state: 'denied', count: 0 } };
  try {
    const items = await read(scope);
    return {
      items,
      status: { scope, state: items.length === 0 ? 'empty' : 'ok', count: items.length },
    };
  } catch (err: unknown) {
    return {
      items: [],
      status: { scope, state: isPermissionDenied(err) ? 'denied' : 'error', count: 0 },
    };
  }
}

interface ForecastComputation {
  inputs: Record<ForecastInputStateKey, ForecastInputStatus>;
  result: ForecastResult | null;
  statisticalLayer: StatisticalLayerResult | null;
  openingBalance: OpeningBalance | null;
  projectedBalanceILS: number | null;
  projectedIncomeILS: number | null;
  projectedExpenseILS: number | null;
  committedILS: number;
  suppressed: ReturnType<typeof suppressedBalanceInputs>;
  suppressedOutflow: ReturnType<typeof suppressedOutflowInputs>;
  target: TargetResolution | null;
  historyRefusalHe: string | null;
  unusableRowCount: number;
  assumptions: ForecastAssumption[];
}

/**
 * What an input reports before its read has answered — T7a-review F9.
 *
 * !! IT USED TO BE `{state: 'error'}`, WHICH MEANT THAT DURING LOADING ALL EIGHT INPUTS CLAIMED A
 * FAULT. It was inert in `ForecastCard` only because that component branches on the scalar
 * `status` before it ever reads this record, so the finding was really a trap set for T7b: the
 * next screen has to remember the same ordering or render eight false error states, and "remember
 * to branch on status first" is not a property anything held.
 *
 * `'unresolved'` is the honest name and it removes the trap rather than documenting it. It is
 * reported in exactly two shells — `'loading'`, before the reads settle, and `'error'`, when the
 * computation itself refused and there is no graded read to report — and it never appears in a
 * completed computation, where every input carries a real grade. Like every non-`'ok'` state it
 * suppresses, because an input that has not answered is not a present one.
 */
const UNRESOLVED_STATUS: ForecastInputStatus = { scope: 'none', state: 'unresolved', count: 0 };

function unresolvedInputs(): Record<ForecastInputStateKey, ForecastInputStatus> {
  const inputs = {} as Record<ForecastInputStateKey, ForecastInputStatus>;
  for (const key of Object.keys(FORECAST_INPUT_MODULES) as ForecastInputStateKey[]) {
    inputs[key] = UNRESOLVED_STATUS;
  }
  return inputs;
}

/**
 * Everything between the reads and the screen, as ONE pure function over already-fetched data.
 *
 * Exported because it is where D17 is enforced and where the certain, statistical and assumption
 * layers are finally composed — and a rule that only a mounted component can exercise is a rule the
 * mutation sweep cannot reach.
 */
export async function computeForecastFromReads(
  config: UseForecastConfig
): Promise<ForecastComputation> {
  const readers = config.readers ?? DEFAULT_FORECAST_READERS;
  const { anchorPeriod, horizon } = forecastHorizonOf(config);
  const fromPeriod = horizon[0];
  const toPeriod = horizon[horizon.length - 1];
  const windowPeriods = lookbackWindowPeriods(anchorPeriod, LOOKBACK_MONTHS_MAX);

  const [accounts, recurring, loans, insurances, assumptions, incomes, goals, history] =
    await Promise.all([
      gradedRead<Account>(config.scopes.accounts, (s) => readers.accounts(s, config.viewerMemberId)),
      gradedRead<RecurringItem>(config.scopes.recurring, (s) => readers.recurring(s, config.viewerMemberId)),
      gradedRead<Loan>(config.scopes.loans, (s) => readers.loans(s, config.viewerMemberId)),
      gradedRead<Insurance>(config.scopes.insurances, (s) => readers.insurances(s, config.viewerMemberId)),
      gradedRead<ForecastAssumption>(config.scopes.assumptions, (s) =>
        readers.assumptions(s, config.viewerMemberId)
      ),
      gradedRead<Record<string, unknown>>(config.scopes.incomes, () => readers.incomes()),
      gradedRead<GoalRecord>(config.scopes.goals, () => readers.goals()),
      gradedHistoryRead(config, readers, windowPeriods),
    ]);

  // ── the certain layer (D22) ────────────────────────────────────────────────────────────────
  const certainItems: ForecastLineItem[] = [
    // NO `status === 'active'` FILTER HERE. `projectRecurringForward` already refuses an inactive
    // item and `projectLoanForward`/`projectInsuranceForward` refuse theirs; a second copy of the
    // same check at the call site is a guard that can never fail, which is the class this stage has
    // now counted twenty-odd times.
    ...recurring.items.flatMap((item) => projectRecurringForward(item, fromPeriod, toPeriod)),
    ...loans.items.flatMap((loan) => projectLoanForward(loan, fromPeriod, toPeriod)),
    ...insurances.items.flatMap((insurance) => projectInsuranceForward(insurance, fromPeriod, toPeriod)),
    // D10's committed instalments, off the SAME CORPUS the statistical layer reads — and, since
    // T7a-review F1, off the SAME HANDLE. This line used to pass `history.rows`, the UNGATED
    // sibling array that rides along on `StatisticalHistoryResult`; both come out of one
    // `loadStatisticalHistory` call, so it read as safe, and what it meant was that the door gated
    // the average while the rows building CERTAIN line items walked past it. The review's exploit
    // put a forged ₪9,999 instalment into `מזה כבר סגור` in every horizon month.
    //
    // The instalment double count (a plan's own past rows are also inside the moving average) is
    // DISCLOSED, not excluded — the same treatment D23 gives the loan and insurance double counts,
    // and T7b owns the disclosure copy.
    ...projectInstalmentsForward(observedInstalmentRowsOf(history.handle), fromPeriod, toPeriod),
  ];

  // ── the statistical layer (D3/D23), through the door and nowhere else ──────────────────────
  const statisticalLayer = buildStatisticalLayer({
    history: history.handle,
    windowPeriods,
    horizon,
    assumptions: assumptions.items,
  });

  const assumedItems = assumptionLineItems({
    assumptions: assumptions.items,
    certainItems,
    horizon,
  });

  const result = composeForecast({
    anchorPeriod: config.anchorPeriod,
    todayPeriod: config.todayPeriod,
    horizonMonths: config.horizonMonths,
    lineItems: [...certainItems, ...statisticalLayer.lineItems, ...assumedItems],
  });

  const projectedIncomeILS = result.byPeriod.reduce((sum, month) => sum + month.incomeILS, 0);
  const projectedExpenseILS = result.byPeriod.reduce((sum, month) => sum + month.expenseILS, 0);
  const committedILS = result.byPeriod.reduce((sum, month) => sum + month.certainILS, 0);
  const hasProjectedIncome = result.lineItems.some((item) => item.direction === 'income');

  // !! THE OPENING BALANCE IS COMPUTED FROM ACTIVE ACCOUNTS ONLY, AND `accounts` IS GRADED ON THE
  // SAME SET — T7a-review F5/F6, and the second half is the one that had no test.
  //
  // F5: deleting this filter left all 2422 tests green, so an ARCHIVED account's stale balance
  // summed into the headline figure at glance scale. The filter is the caller's data selection,
  // which is `computeOpeningBalance`'s stated convention (it reflects exactly what it was passed,
  // as `netWorth.ts` does for the same collection) — so the selection has to be held HERE.
  //
  // F6: the filter and the GRADE were taken over different sets, and the review rendered what that
  // produces. With every account archived, `accounts` graded `'ok'` — the collection has documents
  // — so nothing was suppressed, while the opening balance was `null`; the card fell into its gap
  // branch with an EMPTY gap list and rendered a glance `"0"` above `חסרים 0 נתונים: `, trailing
  // colon and nothing after it. One array feeds both rules now, so they cannot disagree, and
  // `resolveProjectedBalanceILS` refuses the disagreement if a later change reopens it.
  const activeAccounts = accounts.items.filter((account) => account.status === 'active');

  const inputs: Record<ForecastInputStateKey, ForecastInputStatus> = {
    // `'empty'` when every account is ARCHIVED, exactly as for a collection with no documents:
    // "we hold no current balance for this family" is one fact, however it came about, and D17
    // names it rather than projecting from a figure nobody is maintaining.
    accounts:
      accounts.status.state === 'ok' && activeAccounts.length === 0
        ? { ...accounts.status, state: 'empty', count: 0 }
        : accounts.status,
    recurring: recurring.status,
    loans: loans.status,
    insurances: insurances.status,
    assumptions: assumptions.status,
    goals: goals.status,
    history: gradeHistoryInput(history, statisticalLayer),
    // !! `incomes` IS GRADED ON TWO THINGS, AND A10 IS WHY.
    //
    // `RecurringService` writes recurring income into `incomes`, and THERE IS NO INCOME
    // STATISTICAL LAYER — T5 built the expense half only, and A10's ruling says that if the income
    // half is not built the screen must SAY SO rather than quietly project ₪0 of income. A family
    // whose income lives entirely in the `incomes` ledger would otherwise get a balance built on
    // no income at all, rendering a plunging figure that is wrong by their entire salary.
    //
    // So income counts as present only when the collection has documents AND the projection
    // actually produced an income line item. Either half missing suppresses the balance and names
    // `incomes` — which is A10's "say so on screen", delivered as a refusal rather than a caveat.
    incomes:
      incomes.status.state === 'ok' && !hasProjectedIncome
        ? { ...incomes.status, state: 'empty', count: 0 }
        : incomes.status,
  };

  const suppressed = suppressedBalanceInputs(inputs);
  const suppressedOutflow = suppressedOutflowInputs(inputs);

  const openingBalance = computeOpeningBalance(activeAccounts, config.todayDate);
  const balancePoints = projectedBalanceByPeriod(openingBalance?.amountILS ?? null, result.byPeriod);
  // D17, and this is the ONE line that decides whether a balance exists anywhere in the app. It is
  // a named function in `forecast.ts` rather than a ternary here for F6's reason: the rule it
  // encodes is that D17's suppression and the balance's existence must AGREE, and a rule stated as
  // an expression inside a hook is one no pure test can hold.
  const projectedBalanceILS = resolveProjectedBalanceILS(suppressed, balancePoints);

  // D29(d)/A30 as amended — a self-owned `personalTarget` is authorized by the owned-module
  // pattern, not by a `forecast` grant, so a member who cannot read family assumptions still has
  // their own. `budgetConfigDoc` is NOT a parameter: the T6 review measured that document to hold
  // per-category SPEND CAPS while every target here is savings-shaped, and removed it.
  const target = resolveTarget({
    memberId: config.viewerMemberId || null,
    horizon,
    assumptions: assumptions.items,
    goals: goals.items,
  });

  return {
    inputs,
    result,
    statisticalLayer,
    openingBalance,
    projectedBalanceILS,
    projectedIncomeILS: hasProjectedIncome ? projectedIncomeILS : null,
    projectedExpenseILS: suppressedOutflow.length > 0 ? null : projectedExpenseILS,
    committedILS,
    suppressed,
    suppressedOutflow,
    target,
    historyRefusalHe: history.refusalHe,
    unusableRowCount: unknownPeriodRowCount(history.handle),
    assumptions: assumptions.items,
  };
}

/**
 * !! THERE IS NO `rows` MEMBER HERE, AND T7a-REVIEW F1 IS WHY.
 *
 * It used to carry `rows: read.rows` — `StatisticalHistoryResult`'s raw array, the ungated sibling
 * of the sealed corpus — and that array went straight into `observedInstalmentRowsOf` and out the
 * other side as CERTAIN line items. The handle is now the only corpus this hook can reach, so the
 * question "did these rows come through the door?" has one answer rather than two.
 *
 * The row COUNT comes off the handle too. Reading it from `read.rows` would leave a second, quieter
 * dependency on the ungated array, and the count is what decides whether the history input grades
 * `'empty'` — the onboarding state — or `'ok'`.
 */
interface HistoryOutcome {
  handle: StatisticalHistoryResult['history'];
  status: ForecastInputStatus;
  refusalHe: string | null;
}

/** The rows the DOOR cleared, counted. A refusal has no corpus in memory at all, so it is `0`. */
function gatedRowCountOf(handle: StatisticalHistoryResult['history']): number {
  return handle.status === 'ready' ? handle.rows.length : 0;
}

/**
 * The history read, which is graded differently from the other seven because it has a refusal of
 * its own before it has a result.
 *
 * A `'none'` scope produces a REFUSAL HANDLE rather than a sealed one, which is the only shape the
 * statistical layer will accept from anywhere but the door. There is deliberately no way to
 * fabricate the permissive half here.
 */
async function gradedHistoryRead(
  config: UseForecastConfig,
  readers: ForecastReaders,
  windowPeriods: string[]
): Promise<HistoryOutcome> {
  const scope = config.scopes.history;
  const denied: HistoryOutcome = {
    handle: refuseStatisticalHistory(''),
    status: { scope, state: 'denied', count: 0 },
    refusalHe: null,
  };
  if (scope === 'none') return denied;
  try {
    const read = await readers.history(scope, config.viewerMemberId, windowPeriods);
    return {
      handle: read.history,
      status: { scope, state: 'ok', count: gatedRowCountOf(read.history) },
      refusalHe: read.status === 'refused-backfill-incomplete' ? read.reasonHe : null,
    };
  } catch (err: unknown) {
    return {
      ...denied,
      status: { scope, state: isPermissionDenied(err) ? 'denied' : 'error', count: 0 },
    };
  }
}

/**
 * The history input's final grade, which is taken from THE LAYER and not from the read.
 *
 * A read that returned two thousand rows and a layer that refused them are the same thing to the
 * balance: no expense estimate, so a projected balance would be too optimistic by every variable
 * shekel the family spends. The three refusals D33 and D21(d) define are therefore `'error'` —
 * something somebody has to go and fix (run the backfill; shorten the window) — while a successful
 * read of nothing stays `'empty'`, which is the onboarding state and not a fault.
 */
function gradeHistoryInput(
  history: HistoryOutcome,
  layer: StatisticalLayerResult
): ForecastInputStatus {
  if (history.status.state !== 'ok') return history.status;
  if (layer.status !== 'ready') return { ...history.status, state: 'error' };
  if (history.status.count === 0) return { ...history.status, state: 'empty' };
  return history.status;
}

/**
 * D18's hook.
 *
 * ── D33's WINDOW CACHE, AND WHAT IT ACTUALLY BUYS ─────────────────────────────────────────────
 *
 * The effect depends on the scopes, the viewer, the anchor and the horizon — and on NOTHING ELSE.
 * A change to the מי selection or to the category filter re-renders the Dashboard and does not
 * refetch a single row, which is D33's "cache the fetched window and re-slice on filter change" for
 * every filter this card reads.
 *
 * !! AND THE HALF IT CANNOT BUY, RECORDED RATHER THAN IMPLIED. D21(b) applies the מי filter
 * CLIENT-SIDE over returned rows, because the two-`in` query shape breaks at five members. That is
 * not constructible here: `buildStatisticalLayer` takes a SEALED handle, and re-slicing the row
 * array produces an ungated array that only `loadStatisticalHistory` could re-seal. So this card is
 * scope-level (family or own) and מי does not narrow it BY RE-SLICING.
 *
 * !! DECIDED IN T7b, AND THE DECISION IS THE SECOND OPTION: מי re-resolves the SCOPE the way net
 * worth already does. See `narrowForecastScopesToMember` above for the full argument and its cost.
 * The re-seal option was deliberately not taken — a second way to mint a gated handle is the one
 * thing the door exists to prevent.
 */
export function useForecast(config: UseForecastConfig): UseForecastResult {
  const [computation, setComputation] = useState<ForecastComputation | null>(null);
  const [status, setStatus] = useState<UseForecastResult['status']>('loading');
  const [reloadToken, setReloadToken] = useState(0);
  const configRef = useRef(config);
  configRef.current = config;

  const { viewerMemberId, anchorPeriod, todayPeriod, todayDate, horizonMonths } = config;
  const scopeKey = useMemo(() => JSON.stringify(config.scopes), [config.scopes]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    computeForecastFromReads(configRef.current)
      .then((next) => {
        if (cancelled) return;
        setComputation(next);
        // The roll-up, FOR THE SHELL ONLY (D18). Every figure's own fate is decided per input; this
        // scalar exists so the card can tell "still loading" from "there is something to draw", and
        // it must never be the thing a number is suppressed by.
        const states = Object.values(next.inputs).map((input) => input.state);
        setStatus(states.every((state) => state === 'denied') ? 'permission-denied' : 'ready');
      })
      .catch(() => {
        if (cancelled) return;
        // A throw here is this app's own arithmetic having failed — `horizonPeriods` on a malformed
        // anchor, `balanceVerdictOf` on a non-finite figure. It renders an error state; it does not
        // render a number.
        setComputation(null);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [scopeKey, viewerMemberId, anchorPeriod, todayPeriod, todayDate, horizonMonths, reloadToken]);

  // D35 — assumption create/edit/retire calls this, and the test that holds it asserts the RENDERED
  // FIGURE changes rather than asserting `reload` was called.
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return {
    inputs: computation?.inputs ?? unresolvedInputs(),
    result: computation?.result ?? null,
    statisticalLayer: computation?.statisticalLayer ?? null,
    openingBalance: computation?.openingBalance ?? null,
    projectedBalanceILS: computation?.projectedBalanceILS ?? null,
    projectedIncomeILS: computation?.projectedIncomeILS ?? null,
    projectedExpenseILS: computation?.projectedExpenseILS ?? null,
    committedILS: computation?.committedILS ?? 0,
    suppressed: computation?.suppressed ?? [],
    suppressedOutflow: computation?.suppressedOutflow ?? [],
    target: computation?.target ?? null,
    historyRefusalHe: computation?.historyRefusalHe ?? null,
    unusableRowCount: computation?.unusableRowCount ?? 0,
    assumptions: computation?.assumptions ?? [],
    status,
    reload,
  };
}
