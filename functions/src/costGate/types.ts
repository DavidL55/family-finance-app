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

/**
 * Batch 6 (closing review B1) — THE ONE READER OF A STORED ₪ AMOUNT, and the deliberate sibling
 * of resolveCeiling above.
 *
 * resolveCeiling exists because `Number(raw)` turned a corrupt ceiling into NaN and NaN into
 * "spend anything". The SAME coercion was left in place on every OTHER stored money field this
 * module reads — the monthly counters and the ledger amounts — and B1 is that defect relocated:
 * `Number('oops')` is NaN, `used + est > ceiling` is false when `used` is NaN, and the gate is
 * fully off. Batch 4 hand-wrote this guard inline at ONE of the counter readers and left the
 * other two; the standing lesson recorded from that is that a fix applied to one of N symmetric
 * readers is a fraction of a fix. So the coercion is now impossible to express: there is one
 * function, it takes `unknown`, and it cannot hand back a number for a value that is not one.
 *
 * THREE states, not two, for the same reason resolveCeiling has three: 'absent' (nobody spent on
 * this provider this month, or the field was never written) is a genuine, healthy zero, while
 * 'corrupt' is an unreadable value callers must NOT silently treat as zero — treating it as zero
 * is exactly what frees budget. Collapsing them into one `number` is the collapse F1/F3
 * documents. Every caller decides what 'corrupt' means for it explicitly, at the call site, and
 * none of them can decide by accident.
 */
export type StoredAmountILS =
  | { status: 'ok'; amountILS: number }
  | { status: 'absent'; amountILS: null }
  | { status: 'corrupt'; amountILS: null };

export function readStoredAmountILS(raw: unknown): StoredAmountILS {
  if (raw === undefined || raw === null) return { status: 'absent', amountILS: null };
  // Deliberately NOT `Number(raw)`: a string, a boolean, an array and an object must all be
  // rejected rather than coerced. `[]` coerces to 0 and `true` to 1 — both silently plausible
  // money, and 0 in particular is the value that hands budget back.
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { status: 'corrupt', amountILS: null };
  return { status: 'ok', amountILS: raw };
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
// 'counter-corrupt' added by batch 6 (closing review B1) — and deliberately NOT folded into
// 'ceiling-invalid'. Same shape of problem (a corrupt stored number blocks paid AI), completely
// different document and completely different operator action: 'ceiling-invalid' is fixed by a
// super-admin re-saving the ceiling on a screen that exists, while a corrupt month-to-date
// COUNTER is a Function-only document (`allow read, write: if false`) no screen can edit, so the
// only honest instruction is "the recorded spend is unreadable, it must be repaired server-side".
// Telling a super-admin to re-save the ceiling would be F1's exact lie — a message naming an
// action that cannot fix the thing that is wrong.
// 'quote-invalid' added by batch 6 (closing review M4, generalised). The free-call exemption's own
// comment contemplates "some future caller hand-builds a CostQuote instead of calling quote()",
// and it closes the `metered:false` spoof — but not a quote whose estimatedILS is not a usable
// number. NaN reproduces B1's arithmetic on the OTHER side of the comparison: `NaN <= 0` is false
// so the free path is skipped, `used + NaN > ceiling` is false so the ceiling passes, and NaN is
// written onto the ledger and (via FieldValue.increment) into the counter — manufacturing exactly
// the corrupt counter B1 is about. Its own reason because its own operator action is a code fix.
export type ApprovalRefusalReason =
  | 'over-ceiling' | 'ceiling-unconfigured' | 'ceiling-invalid' | 'unknown-model'
  | 'counter-corrupt' | 'quote-invalid';

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
  // Not a budget decision either, and says so: we do not know how much has been spent this month,
  // so no amount can be authorised. Names the actual repair, which is a server-side data fix.
  'counter-corrupt':
    'רישום ההוצאות של ה-AI לחודש זה פגום ולא ניתן לקריאה — לא ניתן לדעת כמה נוצל מהתקרה, ולכן כל קריאת AI בתשלום חסומה. אישור חריגה אינו פותר זאת; יש לתקן את נתוני השימוש בשרת',
  'quote-invalid':
    'הערכת העלות של הקריאה אינה מספר תקין, ולכן לא ניתן לבדוק אותה מול התקרה — תקלת קוד או תצורה שאישור סופר-אדמין אינו פותר; יש לדווח לתמיכה',
};

/**
 * Every refusal reason, DERIVED from the total message map rather than hand-listed a second time.
 *
 * The distinctness guard used to iterate a literal array of four, which is why 'unknown-model'
 * silently shared over-ceiling's copy for five batches — and a hand-maintained array is the exact
 * shape the Stage 6 mutation sweep's S4 survivor flagged. REFUSAL_MESSAGES_HE is a total
 * `Record<ApprovalRefusalReason, string>` in a strict package, so its keys ARE the union: a new
 * reason cannot reach this array without also having copy of its own, and cannot be omitted from
 * the guard at all.
 */
export const ALL_APPROVAL_REFUSAL_REASONS =
  Object.keys(REFUSAL_MESSAGES_HE) as ApprovalRefusalReason[];

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
