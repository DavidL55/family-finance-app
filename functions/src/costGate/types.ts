// Cost gate types (Stage 6 Task 3, D4/D14/D15).
//
// CostQuote is the pre-call estimate costGate.quote() produces and spend() gates atomically on
// (D14 — a Firestore transaction cannot safely stay open across a multi-second provider call, so
// the ceiling admission decision is necessarily made on the best information available BEFORE the
// network call exists to provide better information). reconcileSpend() (costGate.ts) corrects the
// ledger + counter afterward, off the adapter's REAL token counts, in a separate transaction.

export interface CostQuote {
  providerId: string;
  modelId: string;
  metered: boolean;         // false only for the mock provider
  estimatedILS: number;
  unknown: boolean;         // true = provider/model not in the registry — default-deny (D4)
  exchangeRateAsOf: string; // third-lens M5 — echoed from EXCHANGE_RATE so a stale rate is
                             // visible on every quote, not just buried in the registry file
}

/**
 * Task 8 review F1/F3 — the single upper bound on a configured monthly ceiling, enforced at all
 * four layers that touch it (firestore.rules's isValidAiCostConfig, setAiCostCeiling's argument
 * check, costGate's read-side validation, and AiSettingsScreen's input check). ₪1,000,000 is far
 * beyond any plausible household AI budget while still rejecting the `1e308` the reviewer's probe
 * got accepted — a ceiling that large is indistinguishable from no ceiling at all.
 */
export const MAX_MONTHLY_CEILING_ILS = 1_000_000;

/**
 * Task 8 review F1/F3 — ONE semantic for the stored `settings/aiCostConfig.monthlyCeilingILS`,
 * shared by every layer instead of each re-deciding:
 *   'configured' — a finite number in [0, MAX]. **0 is a valid, maximally-restrictive ceiling**
 *                  ("no paid AI this month"), NOT a synonym for unset. That is the contradiction
 *                  F3 names: the callable's own tests documented 0 as configured while costGate
 *                  and the screen called it unconfigured, so the person who had just set it was
 *                  told it was never set.
 *   'unset'      — the field (or the doc) is absent. The ONLY unconfigured state.
 *   'invalid'    — present but not a usable number: a string, NaN, negative, or above MAX. Fails
 *                  CLOSED (refuse), never open. F1's probe admitted ₪12.50 on top of ₪999,999
 *                  because `NaN <= 0` and `used + est > NaN` are both false.
 */
export type CeilingStatus = 'configured' | 'unset' | 'invalid';

export type ResolvedCeiling =
  | { status: 'configured'; ceilingILS: number }
  | { status: 'unset' | 'invalid'; ceilingILS: null };

/**
 * The ONE reader of `settings/aiCostConfig.monthlyCeilingILS`. costGate.spend() (the enforcement
 * point) and getAiUsageSummary (the display point) both call this, so the gate and the screen can
 * never disagree about whether a ceiling exists — F1's worst symptom was precisely that
 * disagreement: the gate fully off while the screen said "no ceiling has been set yet".
 *
 * Takes `unknown` on purpose. `Number(x)` is what produced the NaN that failed open; nothing here
 * coerces, so a string, a boolean, an array and null are all rejected as INVALID rather than
 * silently becoming a number.
 */
export function resolveCeiling(raw: unknown): ResolvedCeiling {
  if (raw === undefined || raw === null) return { status: 'unset', ceilingILS: null };
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { status: 'invalid', ceilingILS: null };
  if (raw < 0 || raw > MAX_MONTHLY_CEILING_ILS) return { status: 'invalid', ceilingILS: null };
  return { status: 'configured', ceilingILS: raw }; // 0 lands here — configured, blocks paid calls
}

export interface SpendResult {
  spent: boolean;
  amountILS: number;
  ceilingILS: number;
  // Task 8 review F2 — the FAMILY-WIDE total across every provider AFTER this spend, which is
  // exactly what the ceiling is enforced against. It used to be this one provider's own counter,
  // while the ceiling doc was global: with four providers the real cap was 4x the number shown.
  usedThisMonthILS: number;
  requiresApproval?: boolean;  // true when refused solely for exceeding the ceiling
  ledgerId: string;            // third-lens M2 — the ai_usage doc id, returned so the caller
                                // (aiChat/aiExtractDocument) can pass it to reconcileSpend once
                                // the adapter returns REAL token counts
}

// Review fix 2 — distinguishes WHY spend() refused, so a future onCall wrapper/UI can tell a
// user stuck on an unconfigured ceiling (nothing they can do but wait for Task 8's settings
// screen, or ask a super-admin to configure it) apart from a real over-ceiling refusal (ask a
// super-admin for a token) or an unknown-model refusal (a code/config bug, not a spend decision
// at all). 'over-ceiling' stays the default so existing call sites that don't pass a reason keep
// today's generic behavior.
// 'ceiling-invalid' added by Task 8 review F1 — deliberately NOT folded into
// 'ceiling-unconfigured': the operator action differs. "Not configured" means set one;
// "invalid" means the stored value is garbage and must be re-saved. Telling an operator the
// ceiling is unset while a corrupt value sits in the doc is the exact lie F1 describes on the
// settings screen.
export type ApprovalRefusalReason = 'over-ceiling' | 'ceiling-unconfigured' | 'ceiling-invalid' | 'unknown-model';

// A plain domain Error, deliberately — NOT an HttpsError. onCall handlers that call spend() MUST
// catch this and rethrow as HttpsError('resource-exhausted', ...); a bare Error thrown from an
// onCall handler is redacted to a generic 'internal' by Cloud Functions' default error handling
// (D4 fix for Sasha's I4 — the exact swallowed-error class already fixed once for cost refusals,
// and the same class Task 4's providerErrors.ts closes for adapter failures).
// Batch 5 — A MAP, NOT A TERNARY CHAIN, AND 'unknown-model' FINALLY HAS ITS OWN COPY.
//
// The ternary this replaces had three branches for four reasons, so 'unknown-model' silently fell
// through to over-ceiling's string: an operator whose registry and request disagree was told to
// go get a super-admin to approve a budget overage — an action that cannot fix a config bug, and
// that would not have fixed it even if performed. That is F1's exact defect ("a message naming
// the wrong operator action") in the one place the earlier fixes never reached, and it survived
// because the distinctness test compared only two of the four.
//
// Typed as a total Record over ApprovalRefusalReason so this cannot recur: functions/ IS strict,
// so adding a fifth reason to the union fails to compile until it is given copy of its own.
// A ternary chain can only ever fail SILENTLY, by inheriting a neighbour's string.
const REFUSAL_MESSAGES_HE: Record<ApprovalRefusalReason, string> = {
  'ceiling-unconfigured':
    'תקרת ה-AI החודשית טרם הוגדרה במערכת — יש להגדיר אותה לפני ביצוע קריאות AI בתשלום (לא ניתן לאשר חריגה מתקרה שלא קיימת)',
  'ceiling-invalid':
    'הערך השמור של תקרת ה-AI החודשית אינו תקין — קריאות AI בתשלום חסומות עד שסופר-אדמין ישמור תקרה תקינה מחדש במסך הגדרות ה-AI',
  'over-ceiling':
    'חריגה מתקרת ה-AI החודשית — נדרש אישור מפורש של סופר-אדמין',
  // Not a spend decision at all, and deliberately says so: an overage approval is the WRONG
  // action here and would change nothing. The fix is in the model registry, not the budget.
  'unknown-model':
    'המודל המבוקש אינו קיים במרשם המודלים, או שאינו משויך לספק שנשלח יחד איתו — תקלת תצורה שאישור סופר-אדמין אינו פותר; יש לתקן את הגדרת המודל במרשם',
};

export class ApprovalRequiredError extends Error {
  constructor(
    public quote: CostQuote,
    public usedThisMonthILS: number,
    public ceilingILS: number,
    public reason: ApprovalRefusalReason = 'over-ceiling'
  ) {
    super(REFUSAL_MESSAGES_HE[reason]);
    this.name = 'ApprovalRequiredError';
  }
}
