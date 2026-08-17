// Stage 6 Task 1 fixes — review-driven fix #1 (watermark completeness bug).
//
// SyncButton used to call saveLastSyncTime immediately after syncFilesFromDrive resolved — i.e.
// right after extraction, before a human ever saw the review queue. That writes
// settings/syncState, and the NEXT incremental sync's Drive query starts from that watermark
// (GoogleDriveService.fetchFilesFromFolder's modifiedTime>='{startDate}' filter). So if the
// reviewer rejected the batch, rejected individual rows, or just closed the app mid-review, the
// file sat behind the watermark forever: never re-offered by an incremental sync, and no
// transaction_lines record exists for it either. Real transactions silently never imported, no
// error, no warning — a ledger-COMPLETENESS regression (not corruption; nothing fabricated goes
// in, real data just never arrives).
//
// This module is the pure state machine the fix is built on: a "batch" is every pendingReview
// entry produced by one syncFilesFromDrive call. The watermark for that batch's folder may only
// advance once every entry has been resolved (approved via commit, or rejected via cancel) AND —
// this is the chosen rule, see the "partially-approved batch" tests below — every single entry
// was approved. One rejected entry anywhere in the batch withholds the advance for the WHOLE
// batch, because settings/syncState stores a single scalar cutoff per folder, not a per-file
// ledger; there is no safe way to advance a single scalar past a file the human explicitly said
// not to import while also promising it stays re-offered. The cost of that choice is bounded and
// cheap: already-approved files in a not-fully-approved batch get harmlessly re-skipped next
// sync via isDriveFileAlreadySynced (a transaction_lines lookup) before any Gemini call happens.
import { describe, expect, it } from 'vitest';
import {
  createWatermarkBatch,
  resolveWatermarkEntry,
  isBatchDrained,
  shouldAdvanceWatermark,
} from '../utils/syncWatermark';

describe('syncWatermark — the watermark-batch state machine', () => {
  it('a fresh batch is not drained and must not advance', () => {
    const batch = createWatermarkBatch('folder1', 3);
    expect(isBatchDrained(batch)).toBe(false);
    expect(shouldAdvanceWatermark(batch)).toBe(false);
  });

  it('approving every entry in the batch drains it and allows the watermark to advance', () => {
    let batch = createWatermarkBatch('folder1', 2);
    batch = resolveWatermarkEntry(batch, 'approved');
    expect(isBatchDrained(batch)).toBe(false); // only 1 of 2 resolved
    expect(shouldAdvanceWatermark(batch)).toBe(false);

    batch = resolveWatermarkEntry(batch, 'approved');
    expect(isBatchDrained(batch)).toBe(true);
    expect(shouldAdvanceWatermark(batch)).toBe(true);
  });

  it('rejecting even a single entry drains the batch but blocks the watermark advance permanently', () => {
    let batch = createWatermarkBatch('folder1', 2);
    batch = resolveWatermarkEntry(batch, 'rejected');
    batch = resolveWatermarkEntry(batch, 'approved');
    expect(isBatchDrained(batch)).toBe(true);
    expect(shouldAdvanceWatermark(batch)).toBe(false);
  });

  it('a batch fully rejected drains but never advances', () => {
    let batch = createWatermarkBatch('folder1', 2);
    batch = resolveWatermarkEntry(batch, 'rejected');
    batch = resolveWatermarkEntry(batch, 'rejected');
    expect(isBatchDrained(batch)).toBe(true);
    expect(shouldAdvanceWatermark(batch)).toBe(false);
  });

  it('an abandoned batch (never fully resolved) never drains and never advances, no matter how much was approved', () => {
    let batch = createWatermarkBatch('folder1', 5);
    batch = resolveWatermarkEntry(batch, 'approved');
    batch = resolveWatermarkEntry(batch, 'approved');
    // Stops here — user closed the app mid-review. 3 of 5 entries never resolve.
    expect(isBatchDrained(batch)).toBe(false);
    expect(shouldAdvanceWatermark(batch)).toBe(false);
  });

  it('a zero-entry batch (nothing extracted) is a degenerate case the caller must special-case — this module treats total=0 as never-advance, not vacuously-true', () => {
    // Rationale: shouldAdvanceWatermark answering true for total===0 would make an EMPTY batch
    // (e.g. constructed via a bug) silently advance the watermark. The real "nothing extracted"
    // fast path is handled by the CALLER (SyncButton) advancing immediately without ever
    // constructing a batch — see SyncButton.watermark.test.tsx.
    const batch = createWatermarkBatch('folder1', 0);
    expect(isBatchDrained(batch)).toBe(true); // 0 >= 0
    expect(shouldAdvanceWatermark(batch)).toBe(false);
  });

  it('resolveWatermarkEntry does not mutate its input (pure state transitions)', () => {
    const batch = createWatermarkBatch('folder1', 2);
    const next = resolveWatermarkEntry(batch, 'approved');
    expect(batch.resolved).toBe(0);
    expect(next.resolved).toBe(1);
    expect(next).not.toBe(batch);
  });

  it('carries the folderId through unchanged, for the caller to pass to saveLastSyncTimeToFirestore', () => {
    let batch = createWatermarkBatch('folder-xyz', 1);
    batch = resolveWatermarkEntry(batch, 'approved');
    expect(batch.folderId).toBe('folder-xyz');
  });
});
