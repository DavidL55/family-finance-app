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
