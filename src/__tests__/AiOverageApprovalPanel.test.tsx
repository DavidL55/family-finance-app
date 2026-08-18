// Batch 8 (closing review B4) — THE ROLE AXIS OF THE APPROVAL PATH.
//
// Spec §8 requires an overage to need explicit super-admin approval, and until this batch only the
// refusal shipped: hitting the ceiling was a wall for everyone, super-admin included.
//
// The brief for this fix names two failure modes explicitly, and both are role-shaped, so both are
// asserted per role rather than once on a "typical" session:
//   · a dead end — a refusal with nothing the reader can do about it, in either direction;
//   · a button that will fail for them — an approve control offered to a parent or a member, whose
//     verified role claim requestAiOverageApproval refuses server-side (D4).
//
// The panel is driven directly (a presentational component with a `role` prop) rather than through
// Dashboard: Dashboard's own suite already covers that it mounts, and driving the component here
// is what lets every role be exercised without three full dashboard renders.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AiOverageApprovalPanel from '../components/AiOverageApprovalPanel';
import type { AiOveragePending } from '../hooks/useAiChat';
import {
  AI_OVERAGE_APPROVE_BUTTON_HE,
  AI_OVERAGE_NON_APPROVER_HE,
  AI_OVERAGE_APPROVER_LEAD_HE,
  AI_OVERAGE_APPROVING_HE,
  AI_OVERAGE_RETRYING_HE,
} from '../config/aiOverage';
import { UNVERIFIED_PRICING_CAVEAT_HE } from '../config/aiCeiling';

const REFUSAL = {
  providerId: 'anthropic', modelId: 'claude-sonnet-5', estimatedILS: 4.25,
  usedThisMonthILS: 48, ceilingILS: 50,
  estimatedInputTokens: 5210, estimatedOutputTokens: 400,
};

const pending = (over: Partial<AiOveragePending> = {}): AiOveragePending => ({
  status: 'refused', refusal: REFUSAL, error: null, ...over,
});

function renderPanel(role: 'super-admin' | 'parent' | 'member', overage: AiOveragePending | null = pending()) {
  const onApprove = vi.fn();
  const onDismiss = vi.fn();
  render(<AiOverageApprovalPanel overage={overage} role={role} onApprove={onApprove} onDismiss={onDismiss} />);
  return { onApprove, onDismiss };
}

describe('AiOverageApprovalPanel', () => {
  it('renders nothing at all when there is no pending overage', () => {
    renderPanel('super-admin', null);
    expect(screen.queryByTestId('ai-overage-approval-panel')).toBeNull();
  });

  it.each(['super-admin', 'parent', 'member'] as const)(
    'a %s is told the ₪ amount that was refused, before any control is offered',
    (role) => {
      // "Explicit approval" is meaningless if the approver does not know what they are approving,
      // and a parent asking a super-admin for one needs the same figure to ask WITH. The number is
      // the SERVER's quote for the refused call, rendered through the one shared money formatter.
      renderPanel(role);
      expect(screen.getByTestId('ai-overage-approval-panel')).toHaveTextContent('₪4.25');
    }
  );

  it('a super-admin gets an approve-and-retry control, and pressing it approves exactly once per press', () => {
    const { onApprove } = renderPanel('super-admin');
    const button = screen.getByText(AI_OVERAGE_APPROVE_BUTTON_HE);
    fireEvent.click(button);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('a super-admin is told the approval covers this ONE call and does not move the ceiling', () => {
    // Without that sentence "approve" reads as "turn the budget off", which is the opposite of what
    // the token does: single-use, 120s, bound to this provider, model and amount (bd97326).
    renderPanel('super-admin');
    expect(screen.getByTestId('ai-overage-approval-panel')).toHaveTextContent(AI_OVERAGE_APPROVER_LEAD_HE);
  });

  it.each(['parent', 'member'] as const)(
    'a %s gets NO approve control — the server would refuse it — and is told who can approve instead',
    (role) => {
      renderPanel(role);
      // Not merely absent from the accessibility tree: absent entirely. A disabled control reads as
      // a permission that might arrive, and this one never will for these roles.
      expect(screen.queryByText(AI_OVERAGE_APPROVE_BUTTON_HE)).toBeNull();
      expect(screen.getByTestId('ai-overage-approval-panel')).toHaveTextContent(AI_OVERAGE_NON_APPROVER_HE);
      // Never a dead end: the copy names both routes out — ask a super-admin, or raise the ceiling.
      expect(screen.getByTestId('ai-overage-approval-panel')).toHaveTextContent(/סופר-אדמין/);
      expect(screen.getByTestId('ai-overage-approval-panel')).toHaveTextContent(/תקרה/);
    }
  );

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // CLOSING REVIEW (Ofra) — THE PANEL APPEARED SILENTLY TO A SCREEN READER.
  //
  // It is mounted in RESPONSE TO A REFUSAL the user did not ask for, while focus is in the chat
  // input somewhere else on the page. With no live region, a screen-reader user's message simply
  // fails and nothing announces why — and the thing not announced is the ₪ figure and who can
  // authorise it. `role="region"` alone does not announce; it only makes the panel findable once
  // you already know to look for it.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  it.each(['super-admin', 'parent', 'member'] as const)(
    'announces itself to a %s screen-reader session when it appears, rather than arriving in silence',
    (role) => {
      renderPanel(role);
      const panel = screen.getByTestId('ai-overage-approval-panel');
      // polite, not assertive: the refusal has already happened and there is nothing to interrupt.
      expect(panel).toHaveAttribute('aria-live', 'polite');
      // atomic, so the ₪ amount and the "who can approve this" line are announced as ONE fact —
      // a changed fragment (the button label flipping to "מבקש אישור") would read as a non sequitur.
      expect(panel).toHaveAttribute('aria-atomic', 'true');
    }
  );

  it('the announced text really contains the amount and the approver copy, not just an empty region', () => {
    // Without this, the attributes above are satisfiable by a live region that announces nothing.
    renderPanel('member');
    const panel = screen.getByTestId('ai-overage-approval-panel');
    expect(panel).toHaveTextContent('₪4.25');
    expect(panel).toHaveTextContent(AI_OVERAGE_NON_APPROVER_HE);
  });

  it.each(['parent', 'member'] as const)('a %s is never shown the approver-only lead copy', (role) => {
    // The two role branches must not both render: a member reading "אתה יכול לאשר" would be told
    // they can do something the server refuses.
    renderPanel(role);
    expect(screen.getByTestId('ai-overage-approval-panel')).not.toHaveTextContent(AI_OVERAGE_APPROVER_LEAD_HE);
  });

  it.each([
    ['approving', AI_OVERAGE_APPROVING_HE],
    ['retrying', AI_OVERAGE_RETRYING_HE],
  ] as const)('while %s the control is disabled and says so, so a second press cannot double-approve', (status, label) => {
    const { onApprove } = renderPanel('super-admin', pending({ status }));
    const button = screen.getByText(label);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('the two in-flight labels are genuinely different — "asking for approval" is not "sending again"', () => {
    // Two states, two different things happening to the family's money: one mints an authorisation,
    // the other spends against it. A shared spinner label would hide which one failed.
    expect(AI_OVERAGE_APPROVING_HE).not.toBe(AI_OVERAGE_RETRYING_HE);
  });

  it('a failed approval shows the server\'s own reason verbatim, and leaves the control usable again', () => {
    const { onApprove } = renderPanel('super-admin', pending({
      status: 'failed', error: 'רק סופר-אדמין יכול לאשר חריגה מהתקרה',
    }));
    expect(screen.getByTestId('ai-overage-approval-error')).toHaveTextContent('רק סופר-אדמין יכול לאשר חריגה מהתקרה');
    fireEvent.click(screen.getByText(AI_OVERAGE_APPROVE_BUTTON_HE));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('no error line is rendered when nothing has failed', () => {
    renderPanel('super-admin');
    expect(screen.queryByTestId('ai-overage-approval-error')).toBeNull();
  });

  it.each(['super-admin', 'parent', 'member'] as const)(
    'a %s can dismiss — the panel is never something a reader cannot leave',
    (role) => {
      const { onDismiss } = renderPanel(role);
      fireEvent.click(screen.getByText('סגור'));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // ACCEPTANCE RE-MEASURE — THE NINTH ₪ FIGURE, AND THE ONLY ONE OUTSIDE THE CAVEAT'S REACH.
  //
  // Eight ₪ figures live on AiSettingsScreen, which is super-admin-only and carries the
  // unverified-pricing caveat. This one renders on the DASHBOARD, for EVERY role, and carried
  // nothing. "המשוערת" was the whole of its honesty, and that word does not say what is actually
  // wrong: the rate card behind the number was never checked against the vendors. "Estimated"
  // reads as rounding. It is not rounding.
  //
  // Asserted against the SHARED constant, imported here rather than hand-written: a fixture
  // spelling out the sentence would pass while the panel rendered a second, drifting variant of
  // it — the F4 class this project has already paid for twice (formatILS, the egress copy).
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('the unverified-pricing caveat travels with the ₪ figure (acceptance re-measure)', () => {
    it.each(['super-admin', 'parent', 'member'] as const)(
      'a %s reading the ₪ amount is told the prices behind it were never verified',
      (role) => {
        renderPanel(role);
        expect(screen.getByTestId('ai-overage-approval-caveat'))
          .toHaveTextContent(UNVERIFIED_PRICING_CAVEAT_HE);
      }
    );

    it('the caveat sits directly under the amount it qualifies, and ahead of the approve control', () => {
      // The same relationship the settings screen holds the caveat in: attached BENEATH the number
      // it qualifies, and read BEFORE the thing the reader is about to act on. A caveat that comes
      // after the button has already been described is a caveat nobody reads in time.
      renderPanel('super-admin');
      const caveat = screen.getByTestId('ai-overage-approval-caveat');
      const amount = screen.getByTestId('ai-overage-approval-amount');
      // Node.DOCUMENT_POSITION_FOLLOWING === 4.
      expect(amount.compareDocumentPosition(caveat) & 4).toBeTruthy();
      expect(caveat.compareDocumentPosition(screen.getByText(AI_OVERAGE_APPROVER_LEAD_HE)) & 4).toBeTruthy();
      expect(caveat.compareDocumentPosition(screen.getByText(AI_OVERAGE_APPROVE_BUTTON_HE)) & 4).toBeTruthy();
    });

    it('it is the ONE shared sentence, not a panel-local paraphrase — the same string the settings screen renders', () => {
      // The assertion that actually stops a variant: the rendered text must be the module constant
      // AiSettingsScreen imports from the same place, character for character.
      renderPanel('member');
      expect(screen.getByTestId('ai-overage-approval-caveat').textContent).toBe(UNVERIFIED_PRICING_CAVEAT_HE);
    });

    it('the caveat is unconditional — it does not depend on the amount, the role or the panel state', () => {
      renderPanel('parent', pending({ status: 'approving' }));
      expect(screen.getByTestId('ai-overage-approval-caveat')).toBeInTheDocument();
    });
  });
});
