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
  costILS: number;
}

// Task 5 — listAiModels.

export interface ListAiModelsRequest {
  action?: AiActionId;
}

export interface ListAiModelsResponse {
  models: AiModelInfo[];
}
