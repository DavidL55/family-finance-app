// Task 6 (Stage 6) — wraps aiClient.sendChatMessage; mirrors Dashboard's existing
// handleSendMessage shape (src/components/Dashboard.tsx, pre-migration lines 496-511) exactly, so
// the migration is a like-for-like swap: append the user message optimistically, then the reply.
//
// D3/Sun A2 — on every send(text), `history` is built from the CURRENT `messages` state (mapped
// to {role, text}, dropping the providerId/modelId badge fields the server doesn't need). This is
// the client half of the multi-turn fix: the server now genuinely uses this, not silently drops it.
//
// D16 (third-lens M3) — also on every send(text): reads useGlobalFilters()'s CURRENT `filters`
// (the SAME hook Dashboard.tsx already calls for every other filtered surface), resolves
// `filters.member` via the SAME resolveMemberSelectionIds every owned-collection screen already
// uses to build filterScope.memberIds, and reads filters.period.month/year straight through for
// filterScope.period — built fresh per call, not captured once at mount, so a filter change
// mid-conversation is honored starting with the NEXT message, matching every other filtered
// screen's own behavior when the global filter changes under it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { sendChatMessage, requestAiOverageApproval, type AiFilterScope } from '../services/aiClient';
import { useAiModels } from './useAiModels';
import { useGlobalFilters } from '../contexts/FilterContext';
import { resolveMemberSelectionIds } from '../utils/resolveMemberSelection';
import { refusalMessageHe } from '../config/aiRefusals';
import {
  readOverageRefusal, AI_OVERAGE_APPROVAL_FAILED_HE, type AiOverageRefusal,
} from '../config/aiOverage';

export interface AiChatMessage {
  role: 'user' | 'model';
  text: string;
  providerId?: string;
  modelId?: string;
}

const GENERIC_ERROR_HE = 'מצטער, חלה שגיאה בתקשורת. אנא נסה שוב.';

// Queued fix (Task 6 review, folded into Task 8) — aiChat.ts's HttpsError('resource-exhausted', ...)
// rethrow carries a STRUCTURED `reason` in `details` (D4's ApprovalRefusalReason: 'over-ceiling' |
// 'ceiling-unconfigured' | 'unknown-model'), specifically so a caller could tell these apart
// without parsing prose. The pre-fix code never read it — the two refusal reasons stayed
// distinguishable ONLY because ApprovalRequiredError's constructor happens to give them different
// Hebrew strings today. A future copy edit converging those two server strings would have
// silently re-collapsed a distinction two prior fixes exist to protect, with nothing to catch it.
// This canonical copy is now owned CLIENT-side and keyed off `reason`, independent of whatever
// `err.message` says.
//
// Review of 9ca9eea, F-H — that fix originally covered ONE reason. Task 8's F1 work then added a
// THIRD ('ceiling-invalid'), so 2 of the 3 cost-gate refusals were back to rendering server prose,
// and NO client-side test could fail if the server copy converged: the only test guarding the
// distinction lives in costGate.test.ts, and the client tests hand-wrote both server strings as
// fixtures — i.e. they asserted that two literals typed inside the test file differ, which proves
// nothing about the app.
//
// Closed by OWNING all three client-side rather than by adding another test, because a test over
// echoed server prose cannot bite: the client renders whatever arrives, so "these three render
// differently" is only enforceable where the strings actually live. With the map below,
// REFUSAL_MESSAGES_HE is the client's own source of truth, and the pairwise-distinctness test in
// useAiChat.test.ts fails the moment two of them converge. Nothing is lost by owning them — all
// three server strings are static (ApprovalRequiredError's constructor interpolates no figures),
// so there is no dynamic detail being dropped.
//
// Deliberately NOT in the map: 'unknown-model' — a registry/config bug rather than a spend
// decision, and one the server currently gives the over-ceiling copy to anyway. It still falls
// through to err.message, exactly as before.
//
// Batch 5 — THE MAP ITSELF MOVED to src/config/aiRefusals.ts, byte-identical (a move, not a
// rewrite). The extraction surface had the same brittleness one surface over, and closing it the
// same way meant a second consumer that cannot import this file: FileProcessor.ts is a plain util
// and this is a React hook pulling in useGlobalFilters/useAiModels/aiClient. Two copies of the
// map would be the F4 class again — one goes stale and the same server decision gets explained
// two different ways depending on which screen the user is on. Re-exported below so this hook's
// existing tests and consumers keep their import path.

/** Exported for the test that pins the three refusals to genuinely different copy (F-H). */
export { AI_REFUSAL_MESSAGES_HE } from '../config/aiRefusals';

// Any thrown httpsCallable failure (Firebase's FunctionsError shape: `code` starting with
// "functions/", plus a `message`) already carries actionable Hebrew copy produced server-side —
// the cost-gate refusal (D4), a provider failure (D14's toAiHttpsError — rate-limited/timeout/
// context-overflow/etc., each its own Hebrew copy), or the chat-history-too-long rejection (Task 5
// follow-up's HISTORY_TOO_LONG_MESSAGE_HE). All of these must render VERBATIM, never replaced by
// one generic message — only a genuine non-callable failure (network drop before the callable
// even resolves to a FunctionsError, a raw JS Error) falls back to the existing generic copy.
function errorMessageFor(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown; details?: { reason?: unknown } } | null | undefined;
  if (e && typeof e.code === 'string' && e.code.startsWith('functions/')) {
    if (e.code === 'functions/resource-exhausted') {
      const owned = refusalMessageHe(e.details?.reason);
      if (owned !== null) return owned;
    }
    if (typeof e.message === 'string' && e.message) return e.message;
  }
  return GENERIC_ERROR_HE;
}

/**
 * Batch 8 (closing review B4) — the same rule as errorMessageFor, for the APPROVAL call.
 *
 * requestAiOverageApproval's failures already carry actionable server-authored Hebrew (the
 * super-admin-only refusal, and the "this pair cannot be priced" refusal), so they render
 * verbatim. Only a genuine non-callable failure — a network drop before the callable resolves to
 * a FunctionsError — falls back to the client's own copy, rather than showing a raw JS message.
 */
function approvalErrorMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  if (e && typeof e.code === 'string' && e.code.startsWith('functions/')
    && typeof e.message === 'string' && e.message) return e.message;
  return AI_OVERAGE_APPROVAL_FAILED_HE;
}

/**
 * Batch 8 (closing review B4) — the pending overage, if the last call was refused with a reason an
 * approval can actually fix.
 *
 * A STRING discriminant on `status`, matching this codebase's LoadState/ResolvedPermissionsState
 * convention and AiExtractionEgressNoticeSource's own note: the root tsconfig is not strict, so a
 * boolean would not narrow.
 *
 * `error` is populated only in 'failed'. It carries the server's own Hebrew message when the
 * failure was a callable refusal (a parent who somehow reached the approve call gets
 * "רק סופר-אדמין…" verbatim), and the client's own copy otherwise.
 */
export interface AiOveragePending {
  status: 'refused' | 'approving' | 'retrying' | 'failed';
  refusal: AiOverageRefusal;
  error: string | null;
}

/**
 * The exact call that was refused, kept so the retry is BYTE-IDENTICAL to it.
 *
 * This is not tidiness. The server re-quotes the retry from its own assembled prompt, and the
 * approval token is bound to an amount ceiling (`<=`, bd97326). Resending with one extra history
 * turn — the refusal bubble, say — raises estIn, pushes the re-quote above the approved amount,
 * and consumeApproval refuses the redemption AFTER burning the single-use token. So the payload is
 * captured at refusal time rather than rebuilt from state that has moved on since.
 */
interface RefusedChatCall {
  message: string;
  modelId: string;
  history: { role: 'user' | 'model'; text: string }[];
  filterScope: AiFilterScope;
  sessionId: string;
}

export function useAiChat(): {
  messages: AiChatMessage[];
  send: (text: string) => Promise<void>;
  isTyping: boolean;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  /** Batch 8 (closing review B4) — null unless the last call hit the ceiling. */
  overage: AiOveragePending | null;
  /** Mints a single-use approval for the refused call and resends it, once. Super-admin only server-side. */
  approveOverageAndRetry: () => Promise<void>;
  dismissOverage: () => void;
  // Carry-forward (chat-history hard caps): the server rejects an over-cap request with a Hebrew
  // message telling the user to start a new conversation (Task 5 follow-up's
  // HISTORY_TOO_LONG_MESSAGE_HE) — rendered verbatim by errorMessageFor above. This hook exposes
  // an explicit, always-available way to act on that instruction so the user is never left at a
  // wall with no way forward: a fresh session id and an empty transcript.
  resetConversation: () => void;
} {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState('');
  const sessionIdRef = useRef(crypto.randomUUID());

  const modelsState = useAiModels('chat');
  const { filters, groups } = useGlobalFilters();

  // Defaults to the FIRST model useAiModels('chat') returns, once, on load — a later reload of
  // the model list (or the user's own picker choice) never overrides an already-made selection.
  useEffect(() => {
    if (modelsState.status === 'ready' && modelsState.models.length > 0 && !selectedModelId) {
      setSelectedModelId(modelsState.models[0].modelId);
    }
  }, [modelsState.status, modelsState.models, selectedModelId]);

  const [overage, setOverage] = useState<AiOveragePending | null>(null);
  /**
   * The refused call and the server's refusal figures, held together so approveOverageAndRetry
   * reads ONE ref and therefore needs neither in its dependency list — a state read there would
   * be the stale-closure version of the same thing.
   */
  const pendingRef = useRef<{ call: RefusedChatCall; refusal: AiOverageRefusal } | null>(null);
  /**
   * Batch 8 (closing review B4) — EXACTLY ONCE, CLIENT SIDE.
   *
   * The server guarantees a token is REDEEMABLE once (consumeApproval, proven under real
   * concurrency in firestore-tests/ai-overage-approval.emulator.test.ts). This guards the other
   * half: a double-click must not MINT two approvals, because the second is a second genuine
   * authorisation of the same spend that nobody consciously granted — and if the first retry then
   * fails, the second token is left live for 120 seconds with no UI attached to it.
   *
   * A ref, not the `overage.status` state, and deliberately the ONLY guard here: two synchronous
   * calls in the same tick both read the same stale state value, so a status check would be a
   * guard shadowed by nothing at all — it would simply not work — while adding a second one on top
   * of this ref would be a guard nothing can test.
   */
  const approvalBusyRef = useRef(false);

  /**
   * The one place a chat turn is actually sent, shared by send() and by the approve-and-retry
   * path. Factored out rather than duplicated precisely so the retry cannot drift from the
   * original: it must resend the SAME message, history, model and filter scope, or the server
   * re-quotes a different amount and the approval token's `<=` ceiling refuses the redemption
   * after consuming it.
   */
  const dispatch = useCallback(async (call: RefusedChatCall, approvalToken?: string) => {
    setIsTyping(true);
    try {
      const res = await sendChatMessage({
        sessionId: call.sessionId,
        message: call.message,
        modelId: call.modelId,
        history: call.history,
        filterScope: call.filterScope,
        // Spread rather than `approvalToken` — an explicit `undefined` key would still serialise
        // into the callable payload, and "the field is absent" is what an ordinary call means.
        ...(approvalToken ? { approvalToken } : {}),
      });
      // Queued fix — a resetConversation() during the await above means this reply belongs to an
      // abandoned conversation; appending it (or touching isTyping, in the `finally` below) would
      // splice a stale answer into the fresh one the user already started.
      if (sessionIdRef.current !== call.sessionId) return;
      setMessages((prev) => [...prev, { role: 'model', text: res.text, providerId: res.providerId, modelId: res.modelId }]);
      pendingRef.current = null;
      setOverage(null);
    } catch (err) {
      if (sessionIdRef.current !== call.sessionId) return;
      console.error('useAiChat: sendChatMessage failed', err);
      // Batch 8 — the refusal still lands in the transcript (the conversation should record what
      // happened), and SEPARATELY, only for the one refusal reason an approval can actually fix,
      // a way forward is offered. readOverageRefusal is what decides that; see its own note for
      // why a provider 429 and the three unapprovable ceiling states are excluded.
      const refusal = readOverageRefusal(err);
      pendingRef.current = refusal ? { call, refusal } : null;
      setOverage(refusal ? { status: 'refused', refusal, error: null } : null);
      setMessages((prev) => [...prev, { role: 'model', text: errorMessageFor(err) }]);
    } finally {
      if (sessionIdRef.current === call.sessionId) setIsTyping(false);
    }
  }, []);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !selectedModelId) return;

    // Queued fix (Task 6 review, folded into Task 8) — captured BEFORE any `await`, so a
    // resetConversation() call that fires WHILE this request is in flight (it can only interleave
    // at the `await sendChatMessage(...)` point below, never synchronously mid-call) is detectable
    // once this call's own response lands: if sessionIdRef.current has since changed, this
    // response belongs to a conversation the user already abandoned.
    const sessionAtSend = sessionIdRef.current;

    // D3/Sun A2 — the CURRENT messages state, BEFORE this turn's optimistic user message is
    // appended, mapped down to exactly what the server needs (role/text only).
    const history = messages.map((m) => ({ role: m.role, text: m.text }));

    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    // Batch 8 — asking something NEW abandons the previous refusal: that approval path belonged to
    // a call the user has moved on from, and leaving its panel up would offer to spend money on a
    // question that is no longer on screen.
    pendingRef.current = null;
    setOverage(null);

    // D16 — resolved fresh from the CURRENT filters on THIS call, via the same resolver every
    // owned-collection screen already uses (src/hooks/useOwnedCollectionScreen.ts's own
    // `resolveMemberSelectionIds(filters.member, groups...)` call is the precedent this mirrors).
    const selectedIds = resolveMemberSelectionIds(filters.member, groups.status === 'ready' ? groups.groups : []);
    const filterScope: AiFilterScope = {
      memberIds: selectedIds ? Array.from(selectedIds) : null,
      period: { month: filters.period.month, year: filters.period.year },
    };

    await dispatch({ sessionId: sessionAtSend, message: trimmed, modelId: selectedModelId, history, filterScope });
  }, [messages, selectedModelId, filters, groups, dispatch]);

  /**
   * Batch 8 (closing review B4) — spec §8's redemption half, from the user's side.
   *
   * Mints a single-use approval for exactly the refused call, then resends that call carrying it.
   * The approval request sends the SERVER's own token estimates back — never a ₪ amount and never
   * a client-side re-estimate — so the token is minted for what the retry will actually re-quote.
   *
   * Nothing here decides whether the caller may approve: requestAiOverageApproval refuses any
   * caller whose VERIFIED role claim is not super-admin (D4). The UI only offers the control to a
   * super-admin so nobody is handed a button that will fail; the server is the boundary, and its
   * refusal is surfaced verbatim if it is ever reached anyway.
   */
  const approveOverageAndRetry = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending || approvalBusyRef.current) return;
    approvalBusyRef.current = true;
    setOverage({ status: 'approving', refusal: pending.refusal, error: null });
    try {
      const { token } = await requestAiOverageApproval({
        providerId: pending.refusal.providerId,
        modelId: pending.refusal.modelId,
        estimatedInputTokens: pending.refusal.estimatedInputTokens,
        estimatedOutputTokens: pending.refusal.estimatedOutputTokens,
      });
      if (sessionIdRef.current !== pending.call.sessionId) return;
      setOverage({ status: 'retrying', refusal: pending.refusal, error: null });
      // dispatch owns the outcome from here: it clears the overage on success, and replaces it
      // with a fresh 'refused' if the retry is refused again (a re-quote above the approved
      // amount, or the ceiling moving underneath) rather than stacking a second pending approval.
      await dispatch(pending.call, token);
    } catch (err) {
      if (sessionIdRef.current !== pending.call.sessionId) return;
      console.error('useAiChat: requestAiOverageApproval failed', err);
      setOverage({ status: 'failed', refusal: pending.refusal, error: approvalErrorMessage(err) });
    } finally {
      approvalBusyRef.current = false;
    }
  }, [dispatch]);

  const dismissOverage = useCallback(() => {
    pendingRef.current = null;
    setOverage(null);
  }, []);

  const resetConversation = useCallback(() => {
    sessionIdRef.current = crypto.randomUUID();
    setMessages([]);
    // Batch 8 — a pending overage belongs to a call in the conversation just abandoned. Carrying
    // it into the fresh one would offer to authorise money for a question no longer on screen.
    pendingRef.current = null;
    setOverage(null);
    // Queued fix — abandon whatever request is in flight IMMEDIATELY rather than leaving the input
    // disabled until that stale request happens to settle; send()'s own session-mismatch guard
    // above ensures the stale response, once it does resolve, no-ops instead of flipping this back.
    setIsTyping(false);
  }, []);

  return {
    messages, send, isTyping, selectedModelId, setSelectedModelId,
    overage, approveOverageAndRetry, dismissOverage, resetConversation,
  };
}
