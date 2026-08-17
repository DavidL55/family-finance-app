// Task 7 review, Important 2 — the auto-retry-once-on-rate-limit UX, which had NO test at all.
//
// That absence is the actual root cause of the finding: Task 7 moved extraction server-side and
// classifyError's rate-limit branch (which string-matched '429'/'Quota'/'quota' in error.message)
// became unreachable against the HEBREW HttpsErrors the server now returns. FolderLogic's
// countdown-and-retry silently stopped firing, and nothing failed. A unit test of classifyError
// alone would not have caught it either — the wiring between the two is where the feature lives,
// so this file drives the real component through a real classifyError.
//
// Everything below the FileProcessor seam is mocked (extraction is a network call); classifyError
// itself is deliberately NOT mocked — it is the code under test.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import FolderLogic from '../components/FolderLogic';
import type { ExtractionDraft } from '../utils/FileProcessor';
import { AI_REFUSAL_MESSAGES_HE } from '../config/aiRefusals';

const extractForReview = vi.fn();
const commitExtractionDraft = vi.fn();

vi.mock('../utils/FileProcessor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/FileProcessor')>();
  return {
    ...actual,
    // classifyError comes through from `actual` — it is what this file exists to exercise.
    extractForReview: (...args: unknown[]) => extractForReview(...args),
    commitExtractionDraft: (...args: unknown[]) => commitExtractionDraft(...args),
  };
});

vi.mock('../services/MembersService', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
}));

vi.mock('../hooks/useAiModels', () => ({
  useAiModels: () => ({
    status: 'ready',
    models: [{ providerId: 'mock', modelId: 'mock-standard', label: 'מודל דמה', defaultForActions: ['extraction'], usdInputPer1kTokens: 0, usdOutputPer1kTokens: 0 }],
    error: null,
  }),
}));

// framer-motion's AnimatePresence exit animations don't settle deterministically under fake
// timers; the modal's presence, not its animation, is what this test cares about.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy({}, {
    get: () => ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => {
      const { initial: _i, animate: _a, exit: _e, ...rest } = props;
      void _i; void _a; void _e;
      return <div {...rest}>{children}</div>;
    },
  }),
}));

vi.mock('../components/ExtractionReviewModal', () => ({
  default: () => <div data-testid="review-modal" />,
}));

/** The shape a Firebase FunctionsError has by the time it reaches a client caller. */
function functionsError(code: string, message: string, details?: unknown): Error & { code: string; details?: unknown } {
  const e = new Error(message) as Error & { code: string; details?: unknown };
  e.code = `functions/${code}`;
  if (details !== undefined) e.details = details;
  return e;
}

const DRAFT: ExtractionDraft = {
  items: [{ date: '2026-08-01', vendor: 'ספק', amount: 10, category: 'שונות', owner: null, description: 'תיאור', isCredit: false }],
} as unknown as ExtractionDraft;

async function openModalWithOneFile() {
  render(<FolderLogic />);
  fireEvent.click(screen.getByRole('button', { name: /העלאת מסמכים/ }));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['x'], 'statement.pdf', { type: 'application/pdf' });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText('statement.pdf')).toBeTruthy());
  return screen.getByRole('button', { name: /נתח ותייק/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  commitExtractionDraft.mockResolvedValue({ savedCount: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FolderLogic — auto-retry once on a server rate limit (Task 7 review, Important 2)', () => {
  it('retries the extraction once after a countdown when the server returns resource-exhausted with no structured refusal reason', async () => {
    extractForReview
      .mockRejectedValueOnce(functionsError('resource-exhausted', 'ספק ה-AI עמוס כרגע — נסה שוב בעוד רגע.'))
      .mockResolvedValueOnce(DRAFT);

    const start = await openModalWithOneFile();
    await act(async () => { fireEvent.click(start); });

    // The countdown is user-visible — the whole point of the feature is that the user is told
    // what is happening instead of watching a file sit there.
    await waitFor(() => expect(screen.getByText(/מנסה שוב בעוד/)).toBeTruthy());

    await act(async () => { await vi.advanceTimersByTimeAsync(70_000); });

    expect(extractForReview).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByTestId('review-modal')).toBeTruthy());
  });

  // Batch 5 — this test used to hand-write the SERVER's copy as a fixture and then assert that
  // same string appeared on screen, which is the F-H anti-pattern exactly: it passed whether or
  // not the client owned anything, and could never have detected the server's three refusal
  // strings converging. classifyError now renders the CLIENT-OWNED canonical copy, so the
  // fixture below is deliberately a string the client must IGNORE, and the assertion reads the
  // shared map — the same shape useAiChat.test.ts uses.
  it('does NOT retry a cost-gate refusal (same resource-exhausted code, but a structured reason) — it surfaces the client-owned refusal copy immediately', async () => {
    extractForReview.mockRejectedValue(
      functionsError('resource-exhausted', 'טקסט שרת שונה לגמרי, לא אמור להיות מוצג', { reason: 'over-ceiling' })
    );

    const start = await openModalWithOneFile();
    await act(async () => { fireEvent.click(start); });

    await waitFor(() => expect(screen.getByText(AI_REFUSAL_MESSAGES_HE['over-ceiling'])).toBeTruthy());
    expect(screen.queryByText('טקסט שרת שונה לגמרי, לא אמור להיות מוצג')).toBeNull();
    expect(extractForReview).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/מנסה שוב בעוד/)).toBeNull();
  });

  // The reason the map deliberately does NOT own — proving the fall-through reaches the user, so
  // batch 5's new server-side 'unknown-model' copy is not swallowed on the way out.
  it('renders the server message verbatim for unknown-model, which the client map does not own', async () => {
    extractForReview.mockRejectedValue(
      functionsError('resource-exhausted', 'הודעת שרת ייחודית ל-unknown-model', { reason: 'unknown-model' })
    );

    const start = await openModalWithOneFile();
    await act(async () => { fireEvent.click(start); });

    await waitFor(() => expect(screen.getByText('הודעת שרת ייחודית ל-unknown-model')).toBeTruthy());
    expect(screen.queryByText(/מנסה שוב בעוד/)).toBeNull();
  });

  it('does not retry a non-rate-limit failure, and shows the server-translated Hebrew message', async () => {
    extractForReview.mockRejectedValue(
      functionsError('invalid-argument', 'המסמך גדול מדי לעיבוד — פצל אותו למספר קבצים קטנים יותר או העלה עמודים בודדים.')
    );

    const start = await openModalWithOneFile();
    await act(async () => { fireEvent.click(start); });

    await waitFor(() => expect(screen.getByText(/המסמך גדול מדי לעיבוד/)).toBeTruthy());
    expect(extractForReview).toHaveBeenCalledTimes(1);
  });

  it('gives up after ONE retry — a second rate limit is surfaced, not retried again', async () => {
    extractForReview.mockRejectedValue(functionsError('resource-exhausted', 'ספק ה-AI עמוס כרגע — נסה שוב בעוד רגע.'));

    const start = await openModalWithOneFile();
    await act(async () => { fireEvent.click(start); });
    await act(async () => { await vi.advanceTimersByTimeAsync(70_000); });

    expect(extractForReview).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByText(/ספק ה-AI עמוס כרגע/)).toBeTruthy());
  });
});
