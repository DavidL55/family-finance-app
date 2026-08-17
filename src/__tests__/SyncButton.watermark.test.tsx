// Stage 6 Task 1 fixes — review-driven fix #1 (watermark completeness bug).
//
// See src/utils/syncWatermark.ts and syncWatermark.test.ts for the pure state-machine rationale.
// This file proves SyncButton itself is actually wired to that state machine correctly — i.e.
// that the real regression (saveLastSyncTimeToFirestore fired immediately after
// syncFilesFromDrive resolved, before any human reviewed anything) is closed at the exact call
// site the reviewer found it in (handleStartSync, ~line 631 pre-fix).
//
// All Drive/Firestore/Gemini dependencies are mocked; ExtractionReviewModal is replaced with a
// minimal stand-in exposing "approve" / "reject" buttons per queued entry (it already has its own
// dedicated, thorough test suite — ExtractionReviewModal.test.tsx — so re-testing its internals
// here would be redundant; only the onCommit/onCancel contract matters for this test).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SyncButton from '../components/SyncButton';
import type { ExtractedData, ExtractionDraft } from '../utils/FileProcessor';

vi.mock('@react-oauth/google', () => ({
  useGoogleLogin: () => vi.fn(),
}));

const fetchFolderContents = vi.fn();
vi.mock('../services/GoogleDriveService', () => ({
  fetchFolderContents: (...args: unknown[]) => fetchFolderContents(...args),
  fetchFolderById: vi.fn(),
  downloadFileBuffer: vi.fn(),
  fetchFilesByYearAndCategory: vi.fn(),
}));

const syncFilesFromDrive = vi.fn();
const getLastSyncTimeFromFirestore = vi.fn();
const saveLastSyncTimeToFirestore = vi.fn();
vi.mock('../services/SyncService', () => ({
  syncFilesFromDrive: (...args: unknown[]) => syncFilesFromDrive(...args),
  getLastSyncTimeFromFirestore: (...args: unknown[]) => getLastSyncTimeFromFirestore(...args),
  saveLastSyncTimeToFirestore: (...args: unknown[]) => saveLastSyncTimeToFirestore(...args),
}));

const commitExtractionDraft = vi.fn();
vi.mock('../utils/FileProcessor', () => ({
  extractForReview: vi.fn(),
  commitExtractionDraft: (...args: unknown[]) => commitExtractionDraft(...args),
  classifyError: vi.fn(),
  CATEGORY_MAP: { General_Misc: 'שונות' },
}));

// Minimal stand-in for the real review modal — exposes onCommit/onCancel as two buttons so this
// test can drive the review queue deterministically without depending on the modal's own DOM.
vi.mock('../components/ExtractionReviewModal', () => ({
  default: ({
    draft,
    onCommit,
    onCancel,
  }: {
    draft: ExtractionDraft;
    onCommit: (decisions: { include: boolean; item: ExtractedData }[]) => void;
    onCancel: () => void;
  }) => (
    <div>
      <button onClick={() => onCommit(draft.items.map((item) => ({ include: true, item })))}>
        approve-entry
      </button>
      <button onClick={() => onCancel()}>reject-entry</button>
    </div>
  ),
}));

vi.mock('../services/MembersService', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/CategoriesService', () => ({
  getCategories: vi.fn().mockResolvedValue([]),
  addCategory: vi.fn(),
}));

function makeDraft(vendor: string): ExtractionDraft {
  return {
    items: [
      { date: '2026-03-01', vendor, amount: 100, category: 'שונות', owner: null, isCredit: false } as ExtractedData,
    ],
    documentMeta: null,
    fileName: `${vendor}.pdf`,
    fileSize: 10,
  };
}

/** Drives the component from "connected" to the incremental-sync trigger (handleStartSync). */
async function startIncrementalSync() {
  render(<SyncButton />);

  // Connected state — selectedFolder comes from localStorage, set in beforeEach.
  fireEvent.click(await screen.findByText('מחובר לדרייב'));

  // loadMonthStructure resolves with no year/month subfolders → "sync whole folder" branch.
  fireEvent.click(await screen.findByText('סנכרן את כל התיקייה'));

  // Sync Mode Modal → incremental.
  fireEvent.click(await screen.findByText('סנכרן חדש בלבד'));
}

describe('SyncButton — watermark advance is gated on the review queue draining (regression fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('drive_folder_id', 'folder1');
    localStorage.setItem('drive_folder_name', 'Family_Finance');
    sessionStorage.setItem('drive_token', 'tok');
    fetchFolderContents.mockResolvedValue({ folders: [], files: [] });
    getLastSyncTimeFromFirestore.mockResolvedValue(null);
    saveLastSyncTimeToFirestore.mockResolvedValue(undefined);
    commitExtractionDraft.mockResolvedValue({ savedCount: 1, skippedCount: 0 });
  });

  it('does NOT advance the watermark the instant extraction resolves — only once review decisions are in', async () => {
    syncFilesFromDrive.mockResolvedValue({
      processed: 1,
      duplicates: 0,
      errors: 0,
      skipped: 0,
      failed: [],
      pendingReview: [
        { draft: makeDraft('שופרסל'), driveFileId: 'd1', sourceDriveFileId: 's1', syncFolderId: 'folder1' },
      ],
    });

    await startIncrementalSync();
    await waitFor(() => expect(syncFilesFromDrive).toHaveBeenCalled());

    // The review modal stand-in must be showing (the queue populated) — and crucially, the
    // watermark must NOT have been written yet, since no human decision has been made.
    await screen.findByText('approve-entry');
    expect(saveLastSyncTimeToFirestore).not.toHaveBeenCalled();
  });

  it('approving every entry in the batch advances the watermark', async () => {
    syncFilesFromDrive.mockResolvedValue({
      processed: 1,
      duplicates: 0,
      errors: 0,
      skipped: 0,
      failed: [],
      pendingReview: [
        { draft: makeDraft('שופרסל'), driveFileId: 'd1', sourceDriveFileId: 's1', syncFolderId: 'folder1' },
      ],
    });

    await startIncrementalSync();
    fireEvent.click(await screen.findByText('approve-entry'));

    await waitFor(() => expect(saveLastSyncTimeToFirestore).toHaveBeenCalledTimes(1));
    expect(saveLastSyncTimeToFirestore).toHaveBeenCalledWith('folder1');
  });

  it('rejecting the (only) entry does NOT advance the watermark — the file must be re-offered', async () => {
    syncFilesFromDrive.mockResolvedValue({
      processed: 1,
      duplicates: 0,
      errors: 0,
      skipped: 0,
      failed: [],
      pendingReview: [
        { draft: makeDraft('שופרסל'), driveFileId: 'd1', sourceDriveFileId: 's1', syncFolderId: 'folder1' },
      ],
    });

    await startIncrementalSync();
    fireEvent.click(await screen.findByText('reject-entry'));

    // Give any (incorrect, pre-fix) async advance a chance to happen before asserting it didn't.
    await waitFor(() => expect(screen.queryByText('reject-entry')).not.toBeInTheDocument());
    expect(saveLastSyncTimeToFirestore).not.toHaveBeenCalled();
  });

  it('closing/abandoning mid-review (never resolving the queued entry) does NOT advance the watermark', async () => {
    syncFilesFromDrive.mockResolvedValue({
      processed: 1,
      duplicates: 0,
      errors: 0,
      skipped: 0,
      failed: [],
      pendingReview: [
        { draft: makeDraft('שופרסל'), driveFileId: 'd1', sourceDriveFileId: 's1', syncFolderId: 'folder1' },
      ],
    });

    await startIncrementalSync();
    await screen.findByText('approve-entry'); // queue populated, human never acts on it

    expect(saveLastSyncTimeToFirestore).not.toHaveBeenCalled();
  });

  it('a partially-approved batch (one approved, one rejected) does NOT advance the watermark — the whole batch is withheld', async () => {
    syncFilesFromDrive.mockResolvedValue({
      processed: 2,
      duplicates: 0,
      errors: 0,
      skipped: 0,
      failed: [],
      pendingReview: [
        { draft: makeDraft('שופרסל'), driveFileId: 'd1', sourceDriveFileId: 's1', syncFolderId: 'folder1' },
        { draft: makeDraft('פנגו'), driveFileId: 'd2', sourceDriveFileId: 's2', syncFolderId: 'folder1' },
      ],
    });

    await startIncrementalSync();

    // First queued entry: approve it.
    fireEvent.click(await screen.findByText('approve-entry'));
    // Second queued entry (queue advances to the next one): reject it.
    fireEvent.click(await screen.findByText('reject-entry'));

    await waitFor(() => expect(screen.queryByText('reject-entry')).not.toBeInTheDocument());
    expect(saveLastSyncTimeToFirestore).not.toHaveBeenCalled();
  });

  it('a sync that extracts nothing (empty pendingReview) advances the watermark immediately — no review to wait for', async () => {
    syncFilesFromDrive.mockResolvedValue({
      processed: 0,
      duplicates: 2,
      errors: 0,
      skipped: 2,
      failed: [],
      pendingReview: [],
    });

    await startIncrementalSync();

    await waitFor(() => expect(saveLastSyncTimeToFirestore).toHaveBeenCalledTimes(1));
    expect(saveLastSyncTimeToFirestore).toHaveBeenCalledWith('folder1');
  });
});
