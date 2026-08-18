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
import type { CeilingStatus, AiUsageStatus } from '../config/aiCeiling';
import type { DocumentAnalysis } from '../utils/FileProcessor';

// D16 — mirrors functions/src/context/types.ts's AiFilterScope, the same type-only cross-boundary
// convention as AiModelInfo above. `memberIds` is resolved client-side (useAiChat, via the SAME
// resolveMemberSelectionIds every owned-collection screen already uses) — never a raw,
// unresolved MemberSelection sent over the wire.
export interface AiFilterScope {
  memberIds: string[] | null;
  period: { month: string; year: string };
}

/**
 * Batch 8 (closing review B5) — THE FIRST ENTRY OF THIS ARRAY IS THE APP'S DEFAULT MODEL.
 *
 * The order is decided SERVER-SIDE, by functions/src/providers/registry.ts's listConfiguredModels:
 * a configured real provider always precedes the always-available mock, so `models[0]` is a real
 * provider whenever one has a key and the mock only when none does. Every caller that auto-selects
 * (useAiChat, the four extraction pickers, AiExtractionEgressNotice's `source="default"` branch,
 * and SyncService's unattended import) depends on that.
 *
 * DO NOT re-sort, reverse or filter this list on the client. AiExtractionEgressNotice names the
 * provider that will receive a document by reading index 0 of the very same list SyncService reads,
 * and a client-side reorder makes that disclosure state a falsehood — a correspondence pinned
 * behaviourally in AiExtractionEgressNotice.surfaces.test.tsx precisely because nothing in the type
 * system ties the two files together.
 */
export async function listAiModels(action?: 'chat' | 'insight' | 'extraction'): Promise<AiModelInfo[]> {
  const call = httpsCallable(functions, 'listAiModels');
  const res = await call({ action });
  return (res.data as { models: AiModelInfo[] }).models;
}

/**
 * Batch 8 (closing review B4) — THE SIXTH CALLABLE, and the one that was missing.
 *
 * Spec §8's "חריגה דורשת אישור מפורש" shipped its refusal half only: this module wrapped five
 * callables and requestAiOverageApproval was not among them, so once the monthly ceiling was hit
 * there was no path forward at all — not for a super-admin standing right there.
 *
 * Super-admin only, enforced SERVER-side off the verified role claim (D4 — an automated caller can
 * never self-approve). The arguments are token COUNTS, taken from the refusal the server itself
 * produced, never a ₪ amount: quote() re-derives the money here, so the client cannot widen what an
 * approval is worth. The returned token is single-use, expires in 120s, and is bound to this
 * provider, this model and this amount (bd97326).
 */
export async function requestAiOverageApproval(req: {
  providerId: string;
  modelId: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}): Promise<{ token: string; expiresAt: number; approvedAmountILS: number }> {
  const call = httpsCallable(functions, 'requestAiOverageApproval');
  const res = await call(req);
  return res.data as { token: string; expiresAt: number; approvedAmountILS: number };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// `costILS`: NOT SURFACED IN THE UI, AND WHY — batch 9, closing the demo script's open item.
//
// Both spending callables return costILS and nothing renders it, so per-call cost transparency
// reaches only the super-admin, via the settings screen's monthly totals. That was an unexamined
// silence rather than a decision, which is what the demo script objected to. The decision, taken
// deliberately, is NOT to render it — for three reasons, in order of weight:
//
//  1. IT WOULD PUT THE LEAST-VERIFIED NUMBER IN THE APP ON THE MOST-SEEN SURFACE. Every ₪ figure
//     here derives from registry.ts's per-token prices, which that file's own banner records as
//     UNVERIFIED placeholders (vendor pricing pages blocked or ambiguous — Task 4). The settings
//     screen is allowed to show them ONLY because an unconditional caveat renders beside them
//     (Task 8 review F5). A badge under a chat answer has nowhere to put that caveat, so it would
//     present a guess with the authority of a receipt — F5's defect, relocated to a busier screen.
//  2. IT WOULD BE A CONSTANT, NOT INFORMATION. A real chat turn costs well under an agora, and
//     formatILS renders anything below ₪0.01 as "פחות מ-₪0.01" (Task 8 review F8). Every answer
//     would carry the identical string. A number that never changes teaches nobody anything, and
//     trains people to stop reading the line it sits on — next to which the egress notice lives.
//  3. THE COST FACT A NON-SUPER-ADMIN CAN ACT ON ALREADY REACHES THEM, at the only moment it is
//     actionable: when the family-wide ceiling refuses a call, the Hebrew refusal names the state
//     and the overage-approval panel shows the ₪ figure being authorised (batch 8, B4). That is
//     cost transparency where a decision exists; a per-answer badge is cost trivia where none does.
//
// WHAT WOULD CHANGE THIS: verified pricing. Once the vendor pages have been re-checked and
// registry.ts's UNVERIFIED banner comes down, reason 1 disappears and a per-answer or per-import
// cost becomes an honest thing to show. Recorded here, attached to the field, rather than only in
// a report — the next person to notice the unused return value should find the reasoning, not
// re-derive it.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export async function sendChatMessage(req: {
  sessionId: string;
  message: string;
  modelId: string;
  history: { role: 'user' | 'model'; text: string }[];
  filterScope: AiFilterScope;
  /**
   * Batch 8 (closing review B4) — a single-use overage approval from requestAiOverageApproval,
   * present only on a RETRY of a call the cost gate already refused with 'over-ceiling'. Passed
   * straight through; the server is the only thing that decides whether it is valid.
   */
  approvalToken?: string;
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
  /** Batch 8 (closing review B4) — see sendChatMessage's own note; identical contract. */
  approvalToken?: string;
}): Promise<{ analysis: DocumentAnalysis; providerId: string; modelId: string; costILS: number }> {
  const call = httpsCallable(functions, 'aiExtractDocument');
  const res = await call(req);
  return res.data as { analysis: DocumentAnalysis; providerId: string; modelId: string; costILS: number };
}

// Task 8 — mirrors functions/src/handlers/types.ts's AiUsageSummary, the same type-only
// cross-boundary convention as AiModelInfo/AiFilterScope above.
export interface AiUsageSummary {
  // Task 8 review F1/F3 — null when there is no usable ceiling; `ceilingStatus` says whether that
  // is because none was ever set or because the stored value is corrupt (which BLOCKS every paid
  // call, and must never be rendered as "no ceiling has been set").
  ceilingILS: number | null;
  ceilingStatus: CeilingStatus;
  // Task 8 review F2 — the family-wide month-to-date total. The ceiling is one global number, so
  // this is the figure to show it against; byProvider stays a breakdown, not four separate caps.
  // Batch 6 (closing review B1) — `number | null` for the same reason ceilingILS is. null means
  // the recorded spend is UNREADABLE, which is the state in which costGate.spend() refuses every
  // paid call; `usageStatus` names it, so the screen can say so instead of rendering a plausible
  // ₪0.00 (or, before this batch, the NaN that reached the progress bar as "NaN% מהתקרה").
  totalUsedThisMonthILS: number | null;
  usageStatus: AiUsageStatus;
  byProvider: { providerId: string; usedThisMonthILS: number | null; callCount: number }[];
  byModel: { modelId: string; providerId: string; usedThisMonthILS: number | null; callCount: number }[];
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
