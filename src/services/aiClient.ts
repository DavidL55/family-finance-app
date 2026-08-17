// Task 6 (Stage 6) — thin httpsCallable wrapper over the two Task 5 callables (listAiModels,
// aiChat). Deliberately carries NO provider key of any kind, no fetch/HTTP logic of its own, and
// no business logic — every rule (cost gate, permission scope, provider selection, prompt-
// injection defense) lives server-side (D1/D8/D4/D6). This file exists only so the rest of the
// client never imports `firebase/functions` directly, matching this project's existing
// one-service-module-per-concern convention (MembersService.ts, AccountsService.ts, ...).
//
// `AiModelInfo` is imported TYPE-ONLY across the deploy boundary from functions/src — D2's mirror
// contract test is what actually guards behavioral drift; a type-only import has no runtime cost
// and no deploy risk (it's erased by the TypeScript compiler).
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import type { AiModelInfo } from '../../functions/src/providers/types';
import type { DocumentAnalysis } from '../utils/FileProcessor';

// D16 — mirrors functions/src/context/types.ts's AiFilterScope, the same type-only cross-boundary
// convention as AiModelInfo above. `memberIds` is resolved client-side (useAiChat, via the SAME
// resolveMemberSelectionIds every owned-collection screen already uses) — never a raw,
// unresolved MemberSelection sent over the wire.
export interface AiFilterScope {
  memberIds: string[] | null;
  period: { month: string; year: string };
}

export async function listAiModels(action?: 'chat' | 'insight' | 'extraction'): Promise<AiModelInfo[]> {
  const call = httpsCallable(functions, 'listAiModels');
  const res = await call({ action });
  return (res.data as { models: AiModelInfo[] }).models;
}

export async function sendChatMessage(req: {
  sessionId: string;
  message: string;
  modelId: string;
  history: { role: 'user' | 'model'; text: string }[];
  filterScope: AiFilterScope;
}): Promise<{ text: string; providerId: string; modelId: string; costILS: number }> {
  const call = httpsCallable(functions, 'aiChat');
  const res = await call(req);
  return res.data as { text: string; providerId: string; modelId: string; costILS: number };
}

// Task 7 — document extraction's own AI call, migrated server-side (aiExtractDocument.ts). The
// LAST client-side provider key reference (src/utils/FileProcessor.ts's old direct Gemini-key
// read) is gone once FileProcessor.ts calls through here instead of constructing a GoogleGenAI
// client directly — same "no provider key of any kind in this file" contract this module's own
// header already states for chat.
export async function extractDocument(req: {
  fileBase64: string;
  mimeType: string;
  familyMembers: string[];
  modelId: string;
}): Promise<{ analysis: DocumentAnalysis; providerId: string; modelId: string; costILS: number }> {
  const call = httpsCallable(functions, 'aiExtractDocument');
  const res = await call(req);
  return res.data as { analysis: DocumentAnalysis; providerId: string; modelId: string; costILS: number };
}

// Task 8 — mirrors functions/src/handlers/types.ts's AiUsageSummary, the same type-only
// cross-boundary convention as AiModelInfo/AiFilterScope above.
export interface AiUsageSummary {
  ceilingILS: number;
  byProvider: { providerId: string; usedThisMonthILS: number; callCount: number }[];
  byModel: { modelId: string; providerId: string; usedThisMonthILS: number; callCount: number }[];
  exchangeRate: { usdToILSRate: number; rateAsOf: string };
}

// Super-admin only server-side (D4) — a parent/member caller gets a permission-denied HttpsError,
// surfaced verbatim by AiSettingsScreen's own error state, same as every other callable here.
export async function getAiUsageSummary(): Promise<AiUsageSummary> {
  const call = httpsCallable(functions, 'getAiUsageSummary');
  const res = await call();
  return res.data as AiUsageSummary;
}

export async function setAiCostCeiling(monthlyCeilingILS: number): Promise<void> {
  const call = httpsCallable(functions, 'setAiCostCeiling');
  await call({ monthlyCeilingILS });
}
