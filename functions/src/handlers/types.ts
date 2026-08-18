import type { AiFilterScope } from '../context/types';
import type { CeilingStatus } from '../costGate/types';
import type { AiActionId, AiModelInfo } from '../providers/types';

export interface RequestAiOverageApprovalRequest {
  providerId: string;
  modelId: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}

export interface RequestAiOverageApprovalResponse {
  token: string;
  expiresAt: number;
  /**
   * Batch 8 (closing review B4) — WHAT THIS TOKEN ACTUALLY AUTHORISES, in ₪.
   *
   * costGate.consumeApproval binds a token to an amount CEILING (`<=`, hardened in bd97326), and
   * that amount is re-derived server-side from the token estimates the caller echoes back — never
   * taken as a ₪ figure from the client. Returning it closes the loop: the approving super-admin's
   * screen can state the number that was actually minted rather than the number it happened to
   * show a moment earlier, so "explicit approval" means approval of a figure the server agrees to.
   */
  approvedAmountILS: number;
}

/**
 * Batch 8 (closing review B4) — the structured payload a cost-gate refusal carries in
 * HttpsError.details, shared by both handlers and mirrored client-side in src/services/aiClient.ts.
 *
 * `estimatedInputTokens`/`estimatedOutputTokens` are the SERVER's own pre-call estimate for the
 * refused call. They are here because the client cannot recompute them: the input estimate covers
 * the system prompt and the server-assembled financial context for chat, and the base64 payload
 * for extraction. Without them a client-side guess would mint an approval for a smaller amount
 * than the retry re-quotes, and consumeApproval's `<=` ceiling would refuse the redemption while
 * still burning the single-use token.
 */
export interface AiCostRefusalDetails {
  quote: { providerId: string; modelId: string; estimatedILS: number };
  usedThisMonthILS: number;
  ceilingILS: number;
  reason: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}

// Task 5 — aiChat.

export interface AiChatRequest {
  sessionId: string;      // client-generated crypto.randomUUID() on first message, same
                           // id-provenance precedent as Stage 5's audit_log id fix
  message: string;
  modelId: string;
  history: { role: 'user' | 'model'; text: string }[];
  filterScope: AiFilterScope; // D16 — the global מי/מתי filter, resolved client-side. Required,
                               // not optional: an omitted filter would be indistinguishable from
                               // "no filter" only if the type FORCES every caller to pass one.
  /**
   * Batch 8 (closing review B4) — spec §8's redemption half. A single-use token minted by the
   * requestAiOverageApproval callable, which only a super-admin can call. Optional because the
   * overwhelming majority of calls are under the ceiling and carry none; a token is meaningful
   * only on a RETRY of a call that was already refused with reason 'over-ceiling'.
   *
   * Client-supplied and safely so: the token is a server-minted randomUUID, single-use, expires in
   * 120s, and consumeApproval binds it to providerId, modelId and an amount ceiling (bd97326). A
   * caller who invents one gets `approved: false` and the ordinary refusal.
   */
  approvalToken?: string;
}

export interface AiChatResponse {
  text: string;
  providerId: string;
  modelId: string;
  // Fix 3 (review follow-up, Minor) — this is the RECONCILED real cost (reconcileSpend's
  // correctedAmountILS, computed from the adapter's ACTUAL token counts after the call
  // succeeded), never the pre-call quote()/spend() ESTIMATE. aiChat.ts only falls back to the
  // estimate (`q.estimatedILS`) in the one case reconcileSpend never ran — see D14 in
  // aiChat.ts's own comments. Read only this field's shape and you'd reasonably assume
  // estimate semantics; it isn't — say so here so a future implementer doesn't have to trace
  // aiChat.ts to learn it.
  costILS: number;
}

// Task 5 — listAiModels.

export interface ListAiModelsRequest {
  action?: AiActionId;
}

export interface ListAiModelsResponse {
  models: AiModelInfo[];
}

// Task 7 — aiExtractDocument.
//
// DocumentAnalysis/TransactionLine/PaymentType/DocumentType MIRROR src/utils/FileProcessor.ts's
// own shapes by hand — functions/'s rootDir is 'src' (functions/tsconfig.json), so this package
// cannot import across the deploy boundary the way the client imports functions/ types (aiClient.ts's
// type-only AiModelInfo import is the OTHER direction, and even that is erased at compile time).
// Unlike D2's PermissionRole mirror, this is a plain DATA shape (the JSON contract a vision model's
// response must satisfy), not authorization logic — D2's contract-test/AST-guard treatment exists
// specifically for role-derivation drift, which has no analogue here: a shape mismatch would
// surface immediately as a client-side type error on AiExtractDocumentResponse.analysis, not
// silently, so no separate guard test is added for this mirror.
export type PaymentType =
  | 'one_time' | 'installment' | 'standing_order' | 'direct_debit' | 'transfer'
  | 'fee' | 'interest' | 'refund' | 'cancellation' | 'atm';

export type DocumentType =
  | 'credit_card' | 'bank_statement' | 'invoice' | 'investment_report' | 'loan' | 'insurance' | 'other';

export interface TransactionLine {
  date: string;
  description: string;
  vendor: string;
  amount: number;
  creditAmount?: number;
  debitAmount?: number;
  runningBalance?: number;
  category: string;
  paymentType: PaymentType;
  installmentNumber?: number;
  totalInstallments?: number;
  isCredit: boolean;
  expenseClassification?: 'Fixed' | 'Semi-Variable' | 'Variable';
  originalAmount?: number;
  originalCurrency?: string;
  voucherNumber?: string;
}

export interface DocumentAnalysis {
  documentType: DocumentType;
  issuer: string;
  accountId: string;
  periodStart: string;
  periodEnd: string;
  chargeDate?: string;
  owner: string | null;
  totalAmount: number;
  openingBalance?: number;
  closingBalance?: number;
  currency: string;
  transactions: TransactionLine[];
}

export interface AiExtractDocumentRequest {
  fileBase64: string;
  mimeType: string;
  familyMembers: string[];
  modelId: string;
  /** Batch 8 (closing review B4) — see AiChatRequest.approvalToken; identical contract. */
  approvalToken?: string;
}

export interface AiExtractDocumentResponse {
  analysis: DocumentAnalysis;
  providerId: string;
  modelId: string;
  costILS: number;
}

// Task 8 — getAiUsageSummary / setAiCostCeiling.

/**
 * Batch 6 (closing review B1) — the usage half of `CeilingStatus`.
 *
 * 'corrupt' means at least one stored ₪ figure this month (a monthly counter or a ledger entry's
 * amount) is not a readable number. That is not a cosmetic display problem: costGate.spend()
 * refuses EVERY paid call in that state, so a screen that prints ₪0.00 beside a fully-closed gate
 * is F1's "gate off, screen reassuring" pairing with the sign flipped.
 */
export type AiUsageStatus = 'ok' | 'corrupt';

export interface AiUsageSummary {
  // Task 8 review F1/F3 — `number | null` plus an explicit status, because ONE number could not
  // distinguish the three states the screen must render differently: a deliberate ₪0 ceiling
  // (configured, blocks paid calls), no ceiling ever set (unset), and a corrupt stored value
  // (invalid — the gate refuses everything paid until it is re-saved).
  ceilingILS: number | null;
  ceilingStatus: CeilingStatus;
  // Task 8 review F2 — the family-wide month-to-date total. The ceiling is ONE global number, so
  // this is the figure to show it against; the per-provider rows below stay a breakdown.
  // Batch 6 (closing review B1) — `number | null`, for the SAME reason ceilingILS is: one number
  // cannot distinguish "nothing has been spent" from "the recorded spend is unreadable", and the
  // cost gate is in opposite postures in those two states. null means unreadable.
  totalUsedThisMonthILS: number | null;
  usageStatus: AiUsageStatus;
  byProvider: { providerId: string; usedThisMonthILS: number | null; callCount: number }[];
  // Sun's minor Task-5-review finding: without this, the settings screen could show total spend
  // but never WHICH model drove it — aggregated from the `month` field costGate.spend() writes on
  // every ai_usage ledger entry.
  byModel: { modelId: string; providerId: string; usedThisMonthILS: number | null; callCount: number }[];
  // D15/third-lens M5 — so the screen can show the date the ceiling's math was last checked,
  // matching D6's own citation-rule discipline applied to the number PROTECTING the model's cost.
  exchangeRate: { usdToILSRate: number; rateAsOf: string };
}

export interface SetAiCostCeilingRequest {
  monthlyCeilingILS: number;
}
