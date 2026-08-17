// D7 (Stage 6 Task 1) — the human review-and-approve gate itself. Renders one editable row per
// extracted item, lets the reviewer correct amount/category/vendor and uncheck rows to exclude
// them, and commits everything checked in ONE commitExtractionDraft call (spec §11's "אישור אחד
// נכנס" literally). Shared by every call site (FolderLogic, SyncButton, AssetCard,
// InvestmentsImportModal, SyncService) per D13's "one shared component, not four clones".
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ExtractionReviewModal, { type ExtractionReviewDecision } from '../components/ExtractionReviewModal';
import type { ExtractionDraft } from '../utils/FileProcessor';

function makeDraft(overrides: Partial<ExtractionDraft> = {}): ExtractionDraft {
  return {
    items: [
      { date: '2026-03-01', vendor: 'שופרסל', amount: 250, category: 'מזון וצריכה', owner: null, isCredit: false },
      { date: '2026-03-02', vendor: 'פנגו', amount: 32.5, category: 'שונות', owner: null, isCredit: false },
    ],
    documentMeta: null,
    fileName: 'statement.pdf',
    fileSize: 1024,
    ...overrides,
  };
}

describe('ExtractionReviewModal', () => {
  let onCommit: ReturnType<typeof vi.fn<(decisions: ExtractionReviewDecision[]) => Promise<void>>>;
  let onCancel: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    onCommit = vi.fn<(decisions: ExtractionReviewDecision[]) => Promise<void>>().mockResolvedValue(undefined);
    onCancel = vi.fn<() => void>();
  });

  it('renders one row per extracted item', () => {
    render(<ExtractionReviewModal draft={makeDraft()} onCommit={onCommit} onCancel={onCancel} />);

    expect(screen.getByDisplayValue('שופרסל')).toBeInTheDocument();
    expect(screen.getByDisplayValue('פנגו')).toBeInTheDocument();
  });

  it('an empty draft (zero extracted items) shows an explicit empty state, not a blank list', () => {
    render(<ExtractionReviewModal draft={makeDraft({ items: [] })} onCommit={onCommit} onCancel={onCancel} />);

    expect(screen.getByText(/לא נמצאו עסקאות/)).toBeInTheDocument();
  });

  it('every row starts checked (included) by default', () => {
    render(<ExtractionReviewModal draft={makeDraft()} onCommit={onCommit} onCancel={onCancel} />);

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    checkboxes.forEach((cb) => expect(cb).toBeChecked());
  });

  it('unchecking a row excludes it from the commit call', async () => {
    render(<ExtractionReviewModal draft={makeDraft()} onCommit={onCommit} onCancel={onCancel} />);

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // exclude פנגו

    fireEvent.click(screen.getByRole('button', { name: 'אישור וטעינה' }));

    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
    const decisions = onCommit.mock.calls[0][0];
    expect(decisions).toEqual([
      expect.objectContaining({ include: true, item: expect.objectContaining({ vendor: 'שופרסל' }) }),
      expect.objectContaining({ include: false, item: expect.objectContaining({ vendor: 'פנגו' }) }),
    ]);
  });

  it('a single "אישור וטעינה" button commits everything checked in ONE commitExtractionDraft-shaped call', async () => {
    render(<ExtractionReviewModal draft={makeDraft()} onCommit={onCommit} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'אישור וטעינה' }));

    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
    const decisions = onCommit.mock.calls[0][0];
    expect(decisions).toHaveLength(2);
    expect(decisions.every((d: { include: boolean }) => d.include)).toBe(true);
  });

  it('editing a row (amount/category/vendor) sends the EDITED values, not the original extraction', async () => {
    render(<ExtractionReviewModal draft={makeDraft()} onCommit={onCommit} onCancel={onCancel} />);

    const vendorInput = screen.getByDisplayValue('שופרסל');
    fireEvent.change(vendorInput, { target: { value: 'רמי לוי' } });

    const amountInput = screen.getByDisplayValue('250');
    fireEvent.change(amountInput, { target: { value: '300' } });

    fireEvent.click(screen.getByRole('button', { name: 'אישור וטעינה' }));

    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
    const decisions = onCommit.mock.calls[0][0];
    expect(decisions[0].item).toEqual(expect.objectContaining({ vendor: 'רמי לוי', amount: 300 }));
  });

  it('the per-line category select preserves the existing unknown-category picker behavior as a per-row inline select', () => {
    render(<ExtractionReviewModal draft={makeDraft()} onCommit={onCommit} onCancel={onCancel} />);

    const rows = screen.getAllByTestId(/extraction-review\.row\./);
    const secondRow = rows[1]; // פנגו — category: שונות
    const select = within(secondRow).getByRole('combobox');
    expect(select).toHaveValue('שונות');

    fireEvent.change(select, { target: { value: 'תחבורה ורכב' } });
    expect(select).toHaveValue('תחבורה ורכב');
  });

  it('cancel discards the draft with zero commit calls', () => {
    render(<ExtractionReviewModal draft={makeDraft()} onCommit={onCommit} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('rejecting the whole batch (unchecking every row) still allows commit with zero included items — never blocked, never a silent no-op', async () => {
    render(<ExtractionReviewModal draft={makeDraft()} onCommit={onCommit} onCancel={onCancel} />);

    screen.getAllByRole('checkbox').forEach((cb) => fireEvent.click(cb));
    fireEvent.click(screen.getByRole('button', { name: 'אישור וטעינה' }));

    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
    const decisions = onCommit.mock.calls[0][0];
    expect(decisions.every((d: { include: boolean }) => !d.include)).toBe(true);
  });

  it('shows a document-level summary header when documentMeta is present', () => {
    render(
      <ExtractionReviewModal
        draft={makeDraft({
          documentMeta: {
            documentType: 'credit_card',
            issuer: 'MAX',
            accountId: '2190',
            periodStart: '2026-02-01',
            periodEnd: '2026-02-28',
            owner: 'דויד',
            totalAmount: 282.5,
            currency: 'ILS',
            transactions: [],
          },
        })}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('MAX')).toBeInTheDocument();
    expect(screen.getByText(/2190/)).toBeInTheDocument();
  });

  it('carries data-tour-id on the key elements', () => {
    render(<ExtractionReviewModal draft={makeDraft()} onCommit={onCommit} onCancel={onCancel} />);

    expect(document.querySelector('[data-tour-id="extraction-review.commit"]')).toBeInTheDocument();
    expect(document.querySelector('[data-tour-id="extraction-review.cancel"]')).toBeInTheDocument();
  });

  it('shows a loading state while committing and disables the commit button', async () => {
    let resolveCommit: () => void = () => {};
    onCommit.mockImplementation(() => new Promise<void>((resolve) => { resolveCommit = resolve; }));

    render(<ExtractionReviewModal draft={makeDraft()} onCommit={onCommit} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'אישור וטעינה' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /טוען|שומר/ })).toBeDisabled());
    resolveCommit();
  });

  it('shows an explicit error state when onCommit rejects, never a silent failure', async () => {
    onCommit.mockRejectedValueOnce(new Error('boom'));
    render(<ExtractionReviewModal draft={makeDraft()} onCommit={onCommit} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'אישור וטעינה' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('rows are laid out RTL', () => {
    render(<ExtractionReviewModal draft={makeDraft()} onCommit={onCommit} onCancel={onCancel} />);
    expect(document.querySelector('[dir="rtl"]')).toBeInTheDocument();
  });

  it('touch targets meet the >=44px minimum (commit/cancel buttons)', () => {
    render(<ExtractionReviewModal draft={makeDraft()} onCommit={onCommit} onCancel={onCancel} />);
    const commitBtn = screen.getByRole('button', { name: 'אישור וטעינה' });
    const cancelBtn = screen.getByRole('button', { name: 'ביטול' });
    expect(commitBtn.className).toMatch(/min-h-\[44px\]/);
    expect(cancelBtn.className).toMatch(/min-h-\[44px\]/);
  });
});
