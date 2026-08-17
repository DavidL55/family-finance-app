import type { AiFilterScope } from '../context/types';
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
}

export interface AiExtractDocumentResponse {
  analysis: DocumentAnalysis;
  providerId: string;
  modelId: string;
  costILS: number;
}
