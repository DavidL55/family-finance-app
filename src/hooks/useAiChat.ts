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
import { sendChatMessage, type AiFilterScope } from '../services/aiClient';
import { useAiModels } from './useAiModels';
import { useGlobalFilters } from '../contexts/FilterContext';
import { resolveMemberSelectionIds } from '../utils/resolveMemberSelection';

export interface AiChatMessage {
  role: 'user' | 'model';
  text: string;
  providerId?: string;
  modelId?: string;
}

const GENERIC_ERROR_HE = 'מצטער, חלה שגיאה בתקשורת. אנא נסה שוב.';

// Any thrown httpsCallable failure (Firebase's FunctionsError shape: `code` starting with
// "functions/", plus a `message`) already carries actionable Hebrew copy produced server-side —
// the cost-gate refusal (D4, with its distinguishable `reason` — "no ceiling configured yet" vs.
// "over budget" are DIFFERENT message strings already, never collapsed here), a provider failure
// (D14's toAiHttpsError — rate-limited/timeout/context-overflow/etc., each its own Hebrew copy),
// or the chat-history-too-long rejection (Task 5 follow-up's HISTORY_TOO_LONG_MESSAGE_HE). All of
// these must render VERBATIM, never replaced by one generic message (per this task's own carry-
// forwards) — only a genuine non-callable failure (network drop before the callable even
// resolves to a FunctionsError, a raw JS Error) falls back to the existing generic copy that
// already matched today's handleSendMessage catch branch.
function errorMessageFor(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  if (e && typeof e.code === 'string' && e.code.startsWith('functions/') && typeof e.message === 'string' && e.message) {
    return e.message;
  }
  return GENERIC_ERROR_HE;
}

export function useAiChat(): {
  messages: AiChatMessage[];
  send: (text: string) => Promise<void>;
  isTyping: boolean;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
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

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !selectedModelId) return;

    // D3/Sun A2 — the CURRENT messages state, BEFORE this turn's optimistic user message is
    // appended, mapped down to exactly what the server needs (role/text only).
    const history = messages.map((m) => ({ role: m.role, text: m.text }));

    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setIsTyping(true);

    // D16 — resolved fresh from the CURRENT filters on THIS call, via the same resolver every
    // owned-collection screen already uses (src/hooks/useOwnedCollectionScreen.ts's own
    // `resolveMemberSelectionIds(filters.member, groups...)` call is the precedent this mirrors).
    const selectedIds = resolveMemberSelectionIds(filters.member, groups.status === 'ready' ? groups.groups : []);
    const filterScope: AiFilterScope = {
      memberIds: selectedIds ? Array.from(selectedIds) : null,
      period: { month: filters.period.month, year: filters.period.year },
    };

    try {
      const res = await sendChatMessage({
        sessionId: sessionIdRef.current,
        message: trimmed,
        modelId: selectedModelId,
        history,
        filterScope,
      });
      setMessages((prev) => [...prev, { role: 'model', text: res.text, providerId: res.providerId, modelId: res.modelId }]);
    } catch (err) {
      console.error('useAiChat: sendChatMessage failed', err);
      setMessages((prev) => [...prev, { role: 'model', text: errorMessageFor(err) }]);
    } finally {
      setIsTyping(false);
    }
  }, [messages, selectedModelId, filters, groups]);

  const resetConversation = useCallback(() => {
    sessionIdRef.current = crypto.randomUUID();
    setMessages([]);
  }, []);

  return { messages, send, isTyping, selectedModelId, setSelectedModelId, resetConversation };
}
