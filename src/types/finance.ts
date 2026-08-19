// Stage 3 — full data model. Doc shapes for the four collections newly wired to the
// permission matrix (see src/types/permissions.ts MODULE_IDS). All four are OWNED from
// day one (D2) via `ownerId: Member.id` (D1) — not a display name, unlike Stage 2's
// `transaction_lines.owner` (see docs/superpowers/plans/2026-08-15-stage3-data-model.md D1).

export interface OwnedRecord {
  id: string;
  ownerId: string;   // Member.id — D1
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export type AccountType = 'bank' | 'cash' | 'credit';

export interface Account extends OwnedRecord {
  name: string;
  type: AccountType;
  balance: number;
  balanceUpdatedAt: string;
  status: 'active' | 'archived';
}

export type RecurringKind = 'income' | 'expense';
export type RecurringStatus = 'active' | 'paused' | 'ended';

export interface RecurringItem extends OwnedRecord {
  kind: RecurringKind;
  description: string;
  amount: number;
  category?: string;
  chargeDay: number; // 1-31
  status: RecurringStatus;
  startDate: string;  // ISO date 'YYYY-MM-DD'
  endDate?: string;   // ISO date
  lastPostedPeriod?: string; // 'YYYY-MM'
}

export type LoanType = 'mortgage' | 'personal' | 'creditLine' | 'other';
export type LoanStatus = 'active' | 'paid-off';

export interface Loan extends OwnedRecord {
  name: string;
  loanType: LoanType;
  principal: number;
  balance: number;
  interestRate: number; // annual %
  monthlyPayment: number;
  startDate: string; // ISO date
  endDate: string;   // ISO date — expected payoff
  status: LoanStatus;
}

export type InsuranceType = 'life' | 'health' | 'car' | 'home' | 'other';
export type InsuranceStatus = 'active' | 'lapsed' | 'cancelled';
export type PremiumFrequency = 'monthly' | 'yearly';

export interface Coverage {
  label: string;   // Hebrew description of what's covered
  amount?: number; // ₪ coverage cap, optional
}

export interface Insurance extends OwnedRecord {
  type: InsuranceType;
  provider: string;
  insuredMemberId: string; // who the policy covers — may differ from ownerId (parent owns, child insured)
  premium: number;
  premiumFrequency: PremiumFrequency;
  coverages: Coverage[];
  renewalDate: string; // ISO date
  documentId?: string; // links to `documents` collection
  status: InsuranceStatus;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Stage 7 — `forecast_assumptions` (D25). A user's stated correction to the forecast.
//
// ITS OWN COLLECTION because §9 states corrected assumptions affect both future insights AND the
// forecast — state shared by two engines. State shared by two owners cannot live inside either
// without one becoming the other's dependency.
//
// The union lives HERE rather than in utils/forecast.ts because it is part of the DOCUMENT shape
// and Rules validate it; utils/forecast.ts imports it (types/finance.ts imports nothing, so there
// is no cycle and the forecast core's purity guard is untouched — `types/` is deliberately absent
// from its banned-directory list, since an interface has no runtime behaviour to be impure with).
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The scopes an assumption can be attached to.
 *
 * `'personalTarget'` is Stage 7 T2 (A30, as AMENDED by the controller after v2): one enum value
 * gives a child a target of their own, which `goals` — ownerless, with a Hebrew month-name date —
 * cannot express, and D29's allowance machinery computes the rest. It is authorized by
 * SELF-OWNERSHIP in Rules, not by a `forecast` grant, because a member's default `forecast` level
 * is `'none'` and A30 as originally ruled would have left the child it exists to serve unable to
 * author anything.
 *
 * `'seasonality'` (D24) LANDED IN T6, closing the deliberate gap T2 left: Rules had accepted the
 * kind since T2 so the `factor` bound they enforce was not a bound on nothing, and
 * `forecastAssumptions.test.ts` pinned the gap at exactly one name in BOTH directions — so adding
 * it here turned that pin red, which is what a pin is for. The two lists are now equal and the same
 * test asserts THAT, in both directions, so the next divergence is also loud.
 *
 * A seasonality assumption carries `factor` and no `amountILS`: it SCALES an estimate rather than
 * replacing one. That is why `resolveCategoryOfScope` maps it to `null` — see the note there.
 *
 * Adding a member here breaks `resolveCategoryOfScope`'s exhaustive switch AT BUILD TIME. That is
 * the point: a scope kind with no category mapping is an assumption that can never override
 * anything, and the failure mode of getting that wrong is a silent no-op rather than an error.
 */
export const ASSUMPTION_SCOPE_KINDS = [
  'recurring',
  'loan',
  'insurance',
  'category',
  'seasonality',
  'personalTarget',
] as const;
export type AssumptionScopeKind = (typeof ASSUMPTION_SCOPE_KINDS)[number];

/**
 * D24's bounds on a seasonal multiplier, enforced in `firestore.rules` — which is where the F1
 * lesson says a value bound belongs. Stage 6's F1 was a super-admin writing
 * `monthlyCeilingILS: 'not a number'` through a rule that validated WHO and never WHAT; a
 * `factor: 1e9` on a document whose value silently scales a displayed number is the same shape.
 *
 * Rules have no import mechanism, so these numbers exist twice; `forecastAssumptions.test.ts`
 * reads the literals back out of `firestore.rules` and asserts they match these, rather than a
 * comment promising they do.
 */
export const SEASONAL_FACTOR_MIN = 0.1;
export const SEASONAL_FACTOR_MAX = 5;

export interface ForecastAssumption extends OwnedRecord {
  scopeKind: AssumptionScopeKind;
  /** For `'personalTarget'`, the member the target belongs to; otherwise the scoped record's id. */
  scopeId: string;
  fromPeriod: string;            // 'YYYY-MM'
  toPeriod?: string;             // 'YYYY-MM'
  /** Unused for `'seasonality'` (T6), which carries `factor` instead. Always non-negative. */
  amountILS: number;
  /** `'seasonality'` only (T6, D24) — bounded by SEASONAL_FACTOR_MIN/MAX in Rules. */
  factor?: number;
  /** `'category'` only — D29's escape hatch, so a family need not classify every category up front. */
  flexible?: boolean;
  /**
   * Required, non-empty; hover shows it VERBATIM. D25(c) rules this FAMILY-VISIBLE FREE TEXT
   * authored by one member and rendered on another's (possibly higher-privilege) screen, and
   * therefore EXCLUDED FROM ANY EGRESS PAYLOAD. The mechanism — `FORECAST_FIELDS_NEVER_IN_EGRESS`
   * in `src/__tests__/helpers/promptEgress.ts`, together with the assertion that consumes it —
   * lands in T8 where the egress suite runs; a constant without its assertion is the
   * guard-that-cannot-fail this stage exists to delete. The RULING is here.
   */
  reasonHe: string;
  /**
   * THE STAGE 8 SEAM. `firestore.rules` requires `'user'` in Stage 7 — the seam is ENFORCED at the
   * boundary, not scanned in source (D25b, Stage 6's B4 one layer down). Stage 8 widens the rule in
   * the same commit that ships the insight writer. The `'insight'` renderer is CUT, not stubbed;
   * this field stays so the widening is a rule change rather than a schema migration.
   */
  source: 'user' | 'insight';
  insightId?: string;
  status: 'active' | 'retired';
}
