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

export interface SpendResult {
  spent: boolean;
  amountILS: number;
  ceilingILS: number;
  usedThisMonthILS: number;    // AFTER this spend
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
export type ApprovalRefusalReason = 'over-ceiling' | 'ceiling-unconfigured' | 'unknown-model';

// A plain domain Error, deliberately — NOT an HttpsError. onCall handlers that call spend() MUST
// catch this and rethrow as HttpsError('resource-exhausted', ...); a bare Error thrown from an
// onCall handler is redacted to a generic 'internal' by Cloud Functions' default error handling
// (D4 fix for Sasha's I4 — the exact swallowed-error class already fixed once for cost refusals,
// and the same class Task 4's providerErrors.ts closes for adapter failures).
export class ApprovalRequiredError extends Error {
  constructor(
    public quote: CostQuote,
    public usedThisMonthILS: number,
    public ceilingILS: number,
    public reason: ApprovalRefusalReason = 'over-ceiling'
  ) {
    super(
      reason === 'ceiling-unconfigured'
        ? 'תקרת ה-AI החודשית טרם הוגדרה במערכת — יש להגדיר אותה לפני ביצוע קריאות AI בתשלום (לא ניתן לאשר חריגה מתקרה שלא קיימת)'
        : 'חריגה מתקרת ה-AI החודשית — נדרש אישור מפורש של סופר-אדמין'
    );
    this.name = 'ApprovalRequiredError';
  }
}
