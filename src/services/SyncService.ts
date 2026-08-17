import {
  fetchFilesFromFolder,
  downloadFileBuffer,
  inferMonthFromFileName,
  getOrCreateFolder,
} from './GoogleDriveService';
import {
  extractForReview,
  CATEGORY_MAP,
  ExtractedData,
  ExtractionDraft,
} from '../utils/FileProcessor';
import { db } from './firebase';
import { listMembers } from './MembersService';
import { listAiModels } from './aiClient';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
} from 'firebase/firestore';

interface SyncProgressStatus {
  message: string;
  processed: number;
  total: number;
}

export interface SyncSummary {
  // D7 — "processed" now means "successfully extracted and queued for human review", NOT
  // "saved". Nothing in this file writes to transaction_lines any more; the caller must show
  // `pendingReview` to the user via ExtractionReviewModal and call commitExtractionDraft itself
  // after approval — an automatically-detected/batch-synced file is never auto-committed (D7).
  processed: number;
  duplicates: number; // files skipped because the same Drive file was already synced before
  errors: number;
  skipped: number;
  failed: Array<{ fileName: string; error: string }>;
  // One entry per successfully-extracted file, in the order files were processed. The Drive
  // upload/organize step (a Drive-only side effect, not a primary Firestore collection) has
  // ALREADY happened by the time a draft lands here — `driveFileId` is the resulting organized
  // copy's id, ready to pass straight into commitExtractionDraft's opts with no further upload.
  pendingReview: Array<{
    draft: ExtractionDraft;
    driveFileId: string;
    sourceDriveFileId: string;
    syncFolderId: string;
  }>;
}

// Helper: Create a File object from ArrayBuffer
async function arrayBufferToFile(
  buffer: ArrayBuffer,
  fileName: string,
  mimeType: string
): Promise<File> {
  const blob = new Blob([buffer], { type: mimeType });
  return new File([blob], fileName, { type: mimeType });
}

// Helper: Create folder structure for a specific month
async function ensureFolderPathForMonth(
  token: string,
  category: string,
  monthTarget: { year: string; month: string }
): Promise<string> {
  // category is already a Hebrew string from Gemini; fall back to 'שונות' only if unrecognised
  const hebrewCategory = Object.values(CATEGORY_MAP).includes(category)
    ? category
    : CATEGORY_MAP.General_Misc;

  const rootId = await getOrCreateFolder(token, 'Family_Finance');
  const yearId = await getOrCreateFolder(token, monthTarget.year, rootId);
  const monthId = await getOrCreateFolder(token, monthTarget.month, yearId);
  const categoryId = await getOrCreateFolder(token, hebrewCategory, monthId);

  return categoryId;
}

/**
 * Main sync function to import files from Google Drive.
 *
 * D7 (Stage 6 Task 1) — this used to extract with Gemini AND save straight into transaction_lines
 * in the same pass, an automatically-detected-file (not itself the human-initiated trigger — a
 * button click starts the batch, but no human reviews each individual file's extracted lines
 * before they land in the ledger) writing directly to a primary collection with no review step.
 * It now only EXTRACTS and organizes files into Drive's monthly folder structure (a Drive-only
 * side effect, not a primary Firestore write); every extracted file is returned via
 * `pendingReview` instead of being saved, and the caller MUST show each draft to a human via
 * ExtractionReviewModal and call commitExtractionDraft itself after approval. The old
 * `onDuplicate`/`onUnknownCategory` callbacks are gone — per-item duplicate skipping is unchanged
 * behavior, just now runs inside commitExtractionDraft at commit time (silent skip, same as
 * before), and unknown-category resolution is the review modal's own per-row inline select.
 */
export const syncFilesFromDrive = async (
  accessToken: string,
  selectedFolderId: string,
  dateRange: { startDate: Date; endDate: Date } | undefined,
  onProgress: (status: SyncProgressStatus) => void
): Promise<SyncSummary> => {
  const summary: SyncSummary = {
    processed: 0,
    duplicates: 0,
    errors: 0,
    skipped: 0,
    failed: [],
    pendingReview: [],
  };

  try {
    // Fetch family members once for owner attribution (Task 6: from the `members` collection)
    const familyMembers: string[] = (await listMembers()).map((m) => m.name);

    // Task 7 — an automatically-detected file has no human present to pick a model (task-7-brief
    // Step 5's own note), so this unattended trigger always uses the registry's own default
    // 'extraction' model — no picker makes sense here. Fetched once per sync run, same
    // once-per-run precedent familyMembers above already sets. If NO extraction model is
    // configured at all (should never happen — the mock model is always registered, D10), the
    // sync fails loudly here rather than calling extractForReview with an empty modelId.
    const extractionModels = await listAiModels('extraction');
    const modelId = extractionModels[0]?.modelId;
    if (!modelId) {
      throw new Error('לא נמצא מודל AI זמין לחילוץ מסמכים');
    }

    // Step 1: Fetch files from Drive folder
    onProgress({
      message: 'מוריד קבצים מ-Google Drive...',
      processed: 0,
      total: 0,
    });

    const fileResponse = await fetchFilesFromFolder(
      accessToken,
      selectedFolderId,
      dateRange,
      100
    );

    const files = fileResponse.files || [];
    const total = files.length;

    if (total === 0) {
      onProgress({
        message: 'לא נמצאו קבצים בתאריך שנבחר',
        processed: 0,
        total: 0,
      });
      return summary;
    }

    // Paid tier Gemini Flash: 2000 RPM — 1s buffer is conservative but safe
    const GEMINI_DELAY_MS = 1000;

    // Step 2: Process each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Rate-limit: wait between Gemini calls (skip delay for first file)
      if (i > 0) {
        onProgress({ message: `ממתין לפני עיבוד הבא... (${i}/${total})`, processed: i, total });
        await new Promise((r) => setTimeout(r, GEMINI_DELAY_MS));
      }

      try {
        onProgress({
          message: `מעבד קובץ: ${file.name}`,
          processed: i,
          total: total,
        });

        // Download file
        const fileBuffer = await downloadFileBuffer(accessToken, file.id);

        // Convert to File object for Gemini extraction
        const fileObj = await arrayBufferToFile(
          fileBuffer,
          file.name,
          file.mimeType
        );

        // Quick duplicate check by Drive file ID — skip Gemini entirely if already synced
        const alreadySynced = await isDriveFileAlreadySynced(file.id);
        if (alreadySynced) {
          summary.duplicates++;
          summary.skipped++;
          onProgress({
            message: `דילוג — קובץ כבר סונכרן: ${file.name}`,
            processed: i + 1,
            total: total,
          });
          continue;
        }

        // Extract data with Gemini (D7 — extraction only, no Firestore write happens here or
        // anywhere below; extractForReview never touches Firestore)
        onProgress({
          message: `מנתח ${file.name} באמצעות AI...`,
          processed: i,
          total: total,
        });

        const draft = await extractForReview(fileObj, () => {}, familyMembers, modelId);

        if (draft.items.length === 0) {
          summary.skipped++;
          continue;
        }

        // Infer month from filename or use created time
        let monthTarget = inferMonthFromFileName(file.name);
        if (!monthTarget) {
          const now = new Date(file.createdTime);
          monthTarget = {
            year: now.getFullYear().toString(),
            month: String(now.getMonth() + 1).padStart(2, '0'),
          };
        }

        // Pick primary category: first non-credit item, fallback to first item — used only to
        // choose the Drive folder, same as before.
        const primaryItem = draft.items.find(it => !it.isCredit) ?? draft.items[0];

        // Create folder structure for this month
        onProgress({
          message: `מארגן תיקיות ב-Drive...`,
          processed: i,
          total: total,
        });

        const folderId = await ensureFolderPathForMonth(
          accessToken,
          primaryItem.category,
          monthTarget
        );

        // Upload file to Drive ONCE. D7's "upload moves to commit time" rule applies to the
        // FOUR direct FileProcessor.ts call sites, whose files aren't in Drive at all until
        // approved; here the file is ALREADY in the source Drive folder being synced FROM — this
        // step only copies it into the organized Family_Finance structure, a Drive-only side
        // effect with no primary-collection write, so doing it during the sync pass (rather than
        // deferring N separate uploads to a later commit step) is an accepted, disclosed scoping
        // choice for this call site — see task-1-report.md.
        onProgress({
          message: `מעלה קובץ...`,
          processed: i,
          total: total,
        });

        const ext = file.name.split('.').pop();
        const fileName = `${primaryItem.date}_${primaryItem.vendor}_${primaryItem.amount}.${ext}`;

        const metadata = { name: fileName, parents: [folderId] };
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', fileObj);

        const uploadRes = await fetch(
          'https://upload.googleapis.com/upload/drive/v3/files?uploadType=multipart',
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
            body: form,
          }
        );

        if (!uploadRes.ok) {
          throw new Error('Upload to Drive failed');
        }

        const uploadedFile = await uploadRes.json();

        // Queue for human review — NOT saved. The caller must show this draft via
        // ExtractionReviewModal and call commitExtractionDraft after approval.
        summary.pendingReview.push({
          draft,
          driveFileId: uploadedFile.id,
          sourceDriveFileId: file.id, // original Drive file ID, for duplicate detection
          syncFolderId: selectedFolderId,
        });
        summary.processed += draft.items.length;

        onProgress({
          message: `חולץ: ${file.name} (${draft.items.length} עסקאות — ממתין לאישור)`,
          processed: i + 1,
          total: total,
        });
      } catch (error) {
        summary.errors++;
        console.error(`[Sync] Failed: ${file.name}`, error);
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        summary.failed.push({
          fileName: file.name,
          error: errorMessage,
        });

        onProgress({
          message: `שגיאה בקובץ ${file.name}: ${errorMessage}`,
          processed: i + 1,
          total: total,
        });
      }
    }

    // Final status message — D7: nothing is saved yet, only extracted and queued for review.
    const successMessage = `סיום חילוץ: ${summary.processed} עסקאות ממתינות לאישור${summary.duplicates > 0 ? `, ${summary.duplicates} קבצים דולגו (כבר סונכרנו)` : ''}`;
    onProgress({
      message: successMessage,
      processed: total,
      total: total,
    });

    return summary;
  } catch (error) {
    console.error('Sync error:', error);
    throw new Error(
      error instanceof Error ? error.message : 'Unknown sync error'
    );
  }
};

/**
 * Get last sync timestamp from Firestore (settings/syncState).
 * Falls back to localStorage for backward compatibility.
 */
export const getLastSyncTimeFromFirestore = async (folderId: string): Promise<Date | null> => {
  try {
    const snap = await getDoc(doc(db, 'settings', 'syncState'));
    const lastSync = snap.data()?.[`lastSync_${folderId}`];
    if (lastSync) return new Date(lastSync);
  } catch {
    // Firestore offline — fall through to localStorage
  }
  // Backward compat: check localStorage
  const stored = localStorage.getItem(`last_sync_${folderId}`);
  return stored ? new Date(stored) : null;
};

/**
 * Save last sync timestamp to Firestore (settings/syncState).
 */
export const saveLastSyncTimeToFirestore = async (folderId: string): Promise<void> => {
  const now = new Date().toISOString();
  try {
    await setDoc(doc(db, 'settings', 'syncState'), {
      [`lastSync_${folderId}`]: now,
      lastSyncGlobal: now,
    }, { merge: true });
  } catch {
    // Firestore offline — save to localStorage as fallback
    localStorage.setItem(`last_sync_${folderId}`, now);
  }
};

/**
 * Check if a specific Drive file was already synced (by source or uploaded driveFileId).
 */
export const isDriveFileAlreadySynced = async (sourceFileId: string): Promise<boolean> => {
  try {
    // Check the source file ID first (new field)
    const q1 = query(
      collection(db, 'transaction_lines'),
      where('sourceDriveFileId', '==', sourceFileId)
    );
    const snap1 = await getDocs(q1);
    if (!snap1.empty) return true;

    // Fallback: check driveFileId (older records may use this)
    const q2 = query(
      collection(db, 'transaction_lines'),
      where('driveFileId', '==', sourceFileId)
    );
    const snap2 = await getDocs(q2);
    return !snap2.empty;
  } catch {
    return false;
  }
};
