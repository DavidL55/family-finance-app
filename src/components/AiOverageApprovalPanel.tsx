// Batch 8 (closing review B4) — THE WAY FORWARD WHEN THE AI CEILING IS HIT.
//
// Spec §8 requires an overage to need explicit super-admin approval. Until this batch only the
// REFUSAL half shipped, so hitting the ceiling was a wall: the chat said "נדרש אישור מפורש של
// סופר-אדמין" and there was no way, anywhere in the app, for a super-admin to give one.
//
// TWO AUDIENCES, ONE COMPONENT, AND NEITHER GETS A DEAD END.
//
//  · super-admin  — an explicit, deliberate approve-and-retry control. Deliberate because the ₪
//    amount is STATED above the button, and because pressing it approves exactly this one call:
//    the token costGate mints is single-use, expires in 120 seconds and is bound to this provider,
//    this model and this amount (bd97326). It does not raise the monthly ceiling, and the copy
//    says so — otherwise "approve" reads as "turn the budget off".
//  · parent / member — the same figures, and copy naming WHO can approve and WHAT to ask for.
//    No button, on purpose: requestAiOverageApproval refuses any caller whose verified role claim
//    is not super-admin (D4), so a button here would be a control guaranteed to fail. Showing a
//    disabled one would be worse — it looks like a permission that might arrive.
//
// This component reads `role` as a PROP, from the session App.tsx already resolved, rather than
// calling useAuthSession itself. Not decoration: the four document-extraction surfaces and the
// egress notice are structurally forbidden from mentioning a role at all (a guard in
// AiExtractionEgressNotice.surfaces.test.tsx greps them for exactly that), because F4 was a role
// gate silently swallowing a disclosure. Keeping the role concept in ONE new, explicitly
// role-aware component — and out of every disclosure surface — is what keeps that guard honest
// rather than routed around.
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { PermissionRole } from '../types/permissions';
import type { AiOveragePending } from '../hooks/useAiChat';
import {
  aiOverageAmountLineHe,
  AI_OVERAGE_APPROVER_LEAD_HE,
  AI_OVERAGE_APPROVE_BUTTON_HE,
  AI_OVERAGE_NON_APPROVER_HE,
  AI_OVERAGE_APPROVING_HE,
  AI_OVERAGE_RETRYING_HE,
  AI_OVERAGE_DISMISS_HE,
} from '../config/aiOverage';
// ACCEPTANCE RE-MEASURE — THE NINTH ₪ FIGURE. The other eight live on AiSettingsScreen, which is
// super-admin-only and carries this caveat; this one renders on the DASHBOARD, for every role,
// and had nothing but the word "המשוערת" in the sentence above it.
//
// THE FORM CHOSEN, AND WHY. The shared sentence VERBATIM, as its own subordinate line directly
// beneath the amount — not a shortened panel-local variant, and not folded into
// aiOverageAmountLineHe's returned string:
//   · Not a shorter variant. The caveat is this stage's most load-bearing honesty statement, and
//     the one thing worse than repeating it is having two versions of it that can drift apart —
//     formatILS and the egress copy both taught this project that lesson at cost. Measured
//     against the copy already on this panel it is not even the heavy line: it is under half the
//     length of AI_OVERAGE_APPROVER_LEAD_HE, which sits right under it.
//   · Not folded into the amount sentence. That line is the semibold lead and has to stay
//     scannable; a third clause would make the one line a reader must parse the longest one. A
//     separate element also keeps it visually SUBORDINATE, which is the correct hierarchy — the
//     actionable facts are "you are over the ceiling" and "here is who can approve it", and the
//     caveat qualifies the number without competing with either. And it gives the guard a real
//     DOM node to assert on instead of a substring of a longer string.
//   · Placed between the amount and the approver lead on purpose: the same relationship the
//     settings screen holds it in — attached beneath the number it qualifies, and read before the
//     control the reader is about to press.
import { UNVERIFIED_PRICING_CAVEAT_HE } from '../config/aiCeiling';

export interface AiOverageApprovalPanelProps {
  /** null when the last call was not refused at the ceiling — the panel renders nothing. */
  overage: AiOveragePending | null;
  /** The VERIFIED role claim, threaded down from useAuthSession via App.tsx. Never re-derived. */
  role: PermissionRole;
  onApprove: () => void;
  onDismiss: () => void;
}

export default function AiOverageApprovalPanel({
  overage, role, onApprove, onDismiss,
}: AiOverageApprovalPanelProps): React.JSX.Element | null {
  if (!overage) return null;

  const canApprove = role === 'super-admin';
  const busy = overage.status === 'approving' || overage.status === 'retrying';
  // One label, driven by the state machine, so "מבקש אישור" and "שולח שוב" are never both plausible
  // and the user is never told the app is doing something it has finished doing.
  const buttonLabel =
    overage.status === 'approving' ? AI_OVERAGE_APPROVING_HE
      : overage.status === 'retrying' ? AI_OVERAGE_RETRYING_HE
        : AI_OVERAGE_APPROVE_BUTTON_HE;

  return (
    <div
      data-testid="ai-overage-approval-panel"
      data-tour-id="ai-overage-approval-panel"
      role="region"
      aria-label="אישור חריגה מתקרת ה-AI"
      // CLOSING REVIEW (Ofra) — aria-live, because this panel APPEARS. It is mounted in response
      // to a refusal the user did not ask for, in a region they are not focused on (the chat input
      // is), so without a live region a screen-reader user's message simply fails and nothing says
      // why. 'polite' rather than 'assertive': the refusal has already happened, there is nothing
      // to interrupt. aria-atomic so the whole panel is announced as ONE statement — the ₪ figure
      // and the "who can approve this" line are one fact, and announcing a changed fragment of it
      // (the button label flipping to "מבקש אישור") would read as a non sequitur.
      aria-live="polite"
      aria-atomic="true"
      // amber, matching the extraction egress notice's family: this is the app telling the user
      // something about money leaving, not an error it failed at.
      //
      // CLOSING REVIEW (cheap item) — the sentence that stood here claimed amber-800 on amber-50
      // was "the pairing AiExtractionSurfaces.contrast.test.ts already measured". IT WAS NOT: that
      // file measures against white, slate-50 and slate-100, and derives its file list from
      // extraction pickers, which this component is not. The tokens are in fact fine — but a
      // comment claiming a measurement nobody took is this stage's signature defect, found in
      // three separate places already. The claim is now TRUE:
      // src/__tests__/AiSettingsScreen.contrast.test.ts reads this file and measures amber-50 as a
      // background in its own right.
      className="shrink-0 mb-2 rounded-xl border border-amber-300 bg-amber-50 p-3"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-800" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p
            data-testid="ai-overage-approval-amount"
            className="text-xs leading-snug text-amber-800 font-semibold"
          >
            {aiOverageAmountLineHe(overage.refusal.estimatedILS)}
          </p>
          {/* Unconditional, exactly as on the settings screen: it is a property of the rate card,
              not of the amount, the role or the panel's state. amber-800 rather than the
              settings screen's amber-700 because the background differs (amber-50 here, white
              there) — the pairing measured by AiSettingsScreen.contrast.test.ts, which reads this
              file. Not semibold: subordinate to the amount it qualifies. */}
          <p
            data-testid="ai-overage-approval-caveat"
            data-tour-id="ai-overage-approval-caveat"
            className="mt-1 text-xs leading-snug text-amber-800"
          >
            {UNVERIFIED_PRICING_CAVEAT_HE}
          </p>
          <p className="mt-1 text-xs leading-snug text-amber-800">
            {canApprove ? AI_OVERAGE_APPROVER_LEAD_HE : AI_OVERAGE_NON_APPROVER_HE}
          </p>
          {overage.status === 'failed' && overage.error && (
            // The server's own Hebrew, verbatim — the same rule useAiChat's errorMessageFor
            // follows. red-800 rather than amber, because this one IS a failure.
            <p data-testid="ai-overage-approval-error" className="mt-1 text-xs leading-snug text-red-800">
              {overage.error}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            {canApprove && (
              <button
                type="button"
                onClick={onApprove}
                disabled={busy}
                // min-h-[44px]: the same touch target every form control in this project uses.
                className="min-h-[44px] rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-amber-800 disabled:bg-amber-300 disabled:text-amber-900"
              >
                {buttonLabel}
              </button>
            )}
            <button
              type="button"
              onClick={onDismiss}
              disabled={busy}
              className="min-h-[44px] rounded-lg px-3 py-2 text-xs font-semibold text-amber-800 underline disabled:text-amber-600 disabled:no-underline"
            >
              {AI_OVERAGE_DISMISS_HE}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
