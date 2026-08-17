// Stage 6 Task 1 fixes — review-driven fix #1.
//
// The bug: SyncButton used to call saveLastSyncTimeToFirestore immediately after
// syncFilesFromDrive resolved — i.e. right after extraction, before a human ever saw the review
// queue (ExtractionReviewModal). settings/syncState is the watermark the NEXT incremental sync's
// Drive query starts from (GoogleDriveService.fetchFilesFromFolder's modifiedTime>='{startDate}'
// filter). So a rejected/abandoned review left the file behind the watermark forever — never
// re-offered, and no transaction_lines record either. Real transactions silently never imported.
//
// The fix: the watermark for a folder may only advance once every pendingReview entry from that
// sync ("the batch") has been resolved by a human, AND every single one was approved. See
// src/__tests__/syncWatermark.test.ts for the full rationale, in particular why a single rejected
// entry withholds the advance for the WHOLE batch rather than just skipping that one file:
// settings/syncState stores one scalar cutoff per folder, not a per-file ledger, so there is no
// safe way to advance it past a file the human explicitly declined while also promising that file
// stays re-offered on the next sync.
//
// This module is deliberately a pure, side-effect-free state machine — no Firestore, no React —
// so the actual decision logic is unit-testable without mocking a service or a component tree.
// SyncButton owns the only side effects: constructing a batch when pendingReview.length > 0,
// resolving one entry per handleReviewCommit/handleReviewCancel call, and calling
// saveLastSyncTimeToFirestore exactly when shouldAdvanceWatermark flips to true.

export type WatermarkEntryDecision = 'approved' | 'rejected';

export interface WatermarkBatch {
  readonly folderId: string;
  readonly total: number;
  readonly resolved: number;
  readonly allApproved: boolean;
}

/** One batch = every pendingReview entry produced by a single syncFilesFromDrive call. */
export function createWatermarkBatch(folderId: string, total: number): WatermarkBatch {
  return { folderId, total, resolved: 0, allApproved: true };
}

/** Called once per queue entry, when the human commits (approved) or cancels (rejected) it. */
export function resolveWatermarkEntry(
  batch: WatermarkBatch,
  decision: WatermarkEntryDecision
): WatermarkBatch {
  return {
    ...batch,
    resolved: batch.resolved + 1,
    allApproved: batch.allApproved && decision === 'approved',
  };
}

/** True once every entry in the batch has been resolved (approved or rejected), win or lose. */
export function isBatchDrained(batch: WatermarkBatch): boolean {
  return batch.resolved >= batch.total;
}

/**
 * True exactly when it is safe to call saveLastSyncTimeToFirestore for this batch's folderId:
 * the batch is fully drained AND every entry was approved. `total === 0` deliberately never
 * advances here — the "nothing extracted" fast path is the CALLER's responsibility (advance
 * immediately without ever constructing a batch), so this module never has to guess whether an
 * empty batch means "nothing to review" or "a bug produced an empty batch".
 */
export function shouldAdvanceWatermark(batch: WatermarkBatch): boolean {
  return batch.total > 0 && isBatchDrained(batch) && batch.allApproved;
}
