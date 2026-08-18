// Batch 8 (closing review B4) — THE CLIENT HALF OF SPEC §8's OVERAGE APPROVAL.
//
// §8's "חריגה דורשת אישור מפורש" shipped its REFUSAL half only. `grep -rn approvalToken
// functions/src` outside costGate.ts returned zero: neither request type carried the field,
// neither handler passed one, aiClient wrapped five callables with requestAiOverageApproval not
// among them, and no UI existed. So once the monthly ceiling was hit, paid AI was blocked
// permanently — with no path forward even for a super-admin standing right there.
//
// Dependency-free on purpose, the same reason src/config/aiRefusals.ts, aiDisclosure.ts and
// aiCeiling.ts are: the consumers' test suites mock ../services/aiClient (and therefore
// firebase/functions) wholesale, so anything that has to be SHARED with those tests cannot sit
// behind that import or it would have to be re-typed as a literal inside a mock factory — i.e.
// not actually shared. That applies to readOverageRefusal below in particular: it is pure
// error-shape narrowing, and a version of it stubbed out inside a vi.mock factory would be
// testing the stub.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO: decide whether an approval is valid. That lives
// entirely in costGate.consumeApproval (single-use, 120s TTL, bound to providerId + modelId + an
// amount ceiling — bd97326). Nothing here may become a second, weaker copy of that decision.
//
// ── NOT BUILT, AND WHY: an approve-and-retry control on the DOCUMENT-EXTRACTION surfaces ──────
//
// aiExtractDocument accepts an approvalToken exactly as aiChat does (both handlers spend, so both
// are redeemable — "a fix applied to one of two symmetric callers is half a fix"). What the
// extraction SURFACES do not get is a button, and that is a decision rather than an omission:
//
//   · The highest-volume extraction trigger is SyncService's unattended whole-folder import, which
//     calls the handler once per file. An approval token is single-use, 120 seconds long and bound
//     to ONE call's amount, so "approve the sync" would mean minting and redeeming N tokens under
//     a human's finger, mid-run, with the sync stalled between each. That is not an approval; it
//     is a ceiling being dismantled one click at a time. Raising the monthly ceiling is the honest
//     control for that situation, and the refusal copy in aiRefusals.ts names it.
//   · The four picker-driven surfaces (FolderLogic, SyncButton, AssetCard, InvestmentsImportModal)
//     are structurally forbidden from mentioning a role at all — a guard in
//     AiExtractionEgressNotice.surfaces.test.tsx greps them for `super-admin`/`useAuthSession`,
//     because F4 was a role gate silently swallowing a disclosure. Introducing a role-aware
//     control into those files would either trip that guard or be routed around it, and routing
//     around a guard to add a role concept to a disclosure surface is precisely the move the guard
//     exists to stop.
//
// So on those surfaces the refusal is not a dead end but a signpost: it says what happened and
// names both routes forward. If a per-document approval is wanted later, the honest shape is the
// same panel this module serves, mounted on the single-document upload surfaces only, with the
// unattended sync path left to the ceiling.

import { formatILS } from './aiCeiling';

/**
 * A cost-gate refusal the user can actually DO something about, narrowed out of a thrown callable
 * error. Every field is required here precisely because the wire shape is not: see
 * readOverageRefusal for why a partial payload produces null rather than a half-filled object.
 */
export interface AiOverageRefusal {
  providerId: string;
  modelId: string;
  /** The ₪ figure the SERVER quoted for the refused call. Never computed on the client. */
  estimatedILS: number;
  usedThisMonthILS: number;
  ceilingILS: number;
  /**
   * The server's own pre-call token estimate for this exact call, echoed back to
   * requestAiOverageApproval so the approval is minted for the amount the retry will re-quote.
   *
   * The client cannot recompute these: for chat the input estimate covers the system prompt and
   * the server-assembled financial context, and for extraction it covers the base64 payload. A
   * client-side guess would mint a token for less than the retry costs, and consumeApproval's
   * `<=` amount ceiling would refuse the redemption AFTER burning the single-use token.
   */
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}

/**
 * Narrows a thrown callable error into an over-ceiling refusal, or null for anything else.
 *
 * `reason === 'over-ceiling'` SPECIFICALLY, not any 'resource-exhausted' error, and this is the
 * load-bearing part of the function rather than a detail:
 *   · a provider 429 (D14's toAiHttpsError) shares the same grpc code and is transient — an
 *     approval would not help and the retry is the right move on its own;
 *   · 'ceiling-unconfigured' and 'ceiling-invalid' cannot be authorised at all — you cannot
 *     approve an overage of a ceiling that does not exist or cannot be read;
 *   · 'counter-corrupt' deliberately cannot be overridden by a token (bd97326): approving an
 *     amount presupposes knowing what has been spent.
 * Offering an approve control for any of those would be a button guaranteed to fail, which the
 * brief for this fix names as its own defect.
 *
 * Returns null rather than a boolean-guarded cast because the root tsconfig is NOT strict: an
 * `in` check followed by an index access would not narrow away undefined, and a caller could ship
 * one straight into a ₪ figure — the same reasoning refusalMessageHe is written with.
 */
export function readOverageRefusal(err: unknown): AiOverageRefusal | null {
  const e = err as { code?: unknown; details?: Record<string, unknown> } | null | undefined;
  if (!e || e.code !== 'functions/resource-exhausted') return null;
  const d = e.details;
  if (!d || d.reason !== 'over-ceiling') return null;
  const q = d.quote as Record<string, unknown> | undefined;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

  const providerId = str(q?.providerId);
  const modelId = str(q?.modelId);
  const estimatedILS = num(q?.estimatedILS);
  const estimatedInputTokens = num(d.estimatedInputTokens);
  const estimatedOutputTokens = num(d.estimatedOutputTokens);
  // All five are required to mint an approval for THIS call. A partial payload — an older deployed
  // Function, a details object that lost a field — must produce NO approve affordance rather than
  // one that mints a token for the wrong amount and is then burned by the `<=` check on redemption.
  if (providerId === null || modelId === null || estimatedILS === null
    || estimatedInputTokens === null || estimatedOutputTokens === null) return null;

  return {
    providerId, modelId, estimatedILS, estimatedInputTokens, estimatedOutputTokens,
    usedThisMonthILS: num(d.usedThisMonthILS) ?? 0,
    ceilingILS: num(d.ceilingILS) ?? 0,
  };
}

// ── THE COPY ─────────────────────────────────────────────────────────────────────────────────
//
// Owned client-side for the same reason AI_REFUSAL_MESSAGES_HE is (the F-H fix): a client that
// echoes server prose cannot be tested for its messages staying distinct, because any such test
// has to hand-write the server's copy as a fixture and so only asserts that two literals inside
// the test file differ.

/** States the amount before any button is pressed — "explicit" approval means approving a figure. */
export function aiOverageAmountLineHe(estimatedILS: number): string {
  return `הקריאה הזו חורגת מתקרת ה-AI החודשית. העלות המשוערת שלה היא ${formatILS(estimatedILS)}.`;
}

/**
 * The super-admin's line. Says what the approval covers BEFORE it is granted, because the whole
 * point of the token's binding (one provider, one model, one amount, 120 seconds, one use) is
 * that the person approving knows they are not opening the budget generally.
 */
export const AI_OVERAGE_APPROVER_LEAD_HE =
  'אתה יכול לאשר את החריגה הזו ולשלוח שוב. האישור תקף לקריאה הזו בלבד, לפעם אחת בלבד, והוא אינו משנה את התקרה החודשית.';

export const AI_OVERAGE_APPROVE_BUTTON_HE = 'אשר את החריגה ושלח שוב';

/**
 * The parent/member line. Names WHO can approve and WHAT to ask for — never a dead end, and never
 * a button that would fail for them: this role does not get one, because requestAiOverageApproval
 * refuses any caller whose verified role claim is not super-admin.
 */
export const AI_OVERAGE_NON_APPROVER_HE =
  'רק סופר-אדמין יכול לאשר חריגה מהתקרה. בקש מסופר-אדמין של המשפחה לאשר את הקריאה הזו, או להעלות את התקרה החודשית במסך הגדרות ה-AI.';

export const AI_OVERAGE_APPROVING_HE = 'מבקש אישור…';
export const AI_OVERAGE_RETRYING_HE = 'שולח שוב עם האישור…';
export const AI_OVERAGE_DISMISS_HE = 'סגור';

/** Generic fallback only — a callable failure carries its own Hebrew copy and is rendered verbatim. */
export const AI_OVERAGE_APPROVAL_FAILED_HE = 'האישור לא הושלם. נסה שוב.';
