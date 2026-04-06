import {
  fetchFilesFromFolder,
  downloadFileBuffer,
  inferMonthFromFileName,
  getOrCreateFolder,
} from './GoogleDriveService';
import {
  extractDataWithGemini,
  checkDuplicate,
  CATEGORY_MAP,
  ExtractedData,
  OnUnknownCategoryCallback,
} from '../utils/FileProcessor';
import { db } from './firebase';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
} from 'firebase/firestore';

interface SyncProgressStatus {
  message: string;
  processed: number;
  total: number;
}

export interface SyncSummary {
  processed: number;
  duplicates: number;
  errors: number;
  skipped: number;
  failed: Array<{ fileName: string; error: string }>;
}

interface DuplicateHandlerResponse {
  action: 'skip' | 'overwrite' | 'cancel';
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
 * Main sync function to import files from Google Drive
 * Fetches files, processes them with Gemini AI, and organizes into monthly folders
 */
export const syncFilesFromDrive = async (
  accessToken: string,
  selectedFolderId: string,
  dateRange: { startDate: Date; endDate: Date } | undefined,
  onProgress: (status: SyncProgressStatus) => void,
  onDuplicate: (
    fileName: string,
    duplicate: ExtractedData
  ) => Promise<DuplicateHandlerResponse>,
  onUnknownCategory?: OnUnknownCategoryCallback
): Promise<SyncSummary> => {
  const summary: SyncSummary = {
    processed: 0,
    duplicates: 0,
    errors: 0,
    skipped: 0,
    failed: [],
  };

  try {
    // Fetch family members once for owner attribution (IndexedDB hit via persistentLocalCache)
    const budgetSnap = await getDoc(doc(db, 'settings', 'budgetConfig'));
    const familyMembers: string[] = ((budgetSnap.data()?.members ?? []) as { name: string }[]).map(
      (m) => m.name
    );

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

        // Extract data with Gemini
        onProgress({
          message: `מנתח ${file.name} באמצעות AI...`,
          processed: i,
          total: total,
        });

        const extractedItems = await extractDataWithGemini(fileObj, familyMembers);

        // Check for duplicates per item
        onProgress({
          message: `בודק כפילויות...`,
          processed: i,
          total: total,
        });

        const nonDuplicates: ExtractedData[] = [];
        for (const item of extractedItems) {
          const isDup = await checkDuplicate(item);
          if (!isDup) nonDuplicates.push(item);
        }

        const allDuplicates = nonDuplicates.length === 0 && extractedItems.length > 0;
        if (allDuplicates) {
          summary.duplicates++;

          // Call duplicate handler to ask user (pass first item for context)
          const response = await onDuplicate(file.name, extractedItems[0]);

          if (response.action === 'cancel') {
            onProgress({
              message: 'בוטל סנכרון',
              processed: i + 1,
              total: total,
            });
            return summary;
          } else if (response.action === 'skip') {
            summary.skipped += extractedItems.length;
            onProgress({
              message: `דילוג על קובץ כפול: ${file.name}`,
              processed: i + 1,
              total: total,
            });
            continue;
          }
          // 'overwrite' — push all items back so they get saved
          nonDuplicates.push(...extractedItems);
        }

        if (nonDuplicates.length === 0) {
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

        // Resolve unknown categories per item
        for (const item of nonDuplicates) {
          if (
            item.category === CATEGORY_MAP.General_Misc ||
            !Object.values(CATEGORY_MAP).includes(item.category)
          ) {
            if (onUnknownCategory) {
              onProgress({ message: `ממתין לבחירת קטגוריה עבור ${file.name}...`, processed: i, total });
              item.category = await onUnknownCategory(item);
            }
          }
        }

        // Pick primary category: first non-credit item, fallback to first item
        const primaryItem = nonDuplicates.find(it => !it.isCredit) ?? nonDuplicates[0];

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

        // Upload file to Drive ONCE
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

        // Save N Firestore records with same driveFileId
        onProgress({
          message: `שומר ${nonDuplicates.length} עסקאות...`,
          processed: i,
          total: total,
        });
        for (const item of nonDuplicates) {
          await addDoc(collection(db, 'transactions'), {
            ...item,
            created_at: serverTimestamp(),
            driveFileId: uploadedFile.id,
            syncFolderId: selectedFolderId,
          });
        }

        summary.processed += nonDuplicates.length;

        onProgress({
          message: `הושלם: ${file.name} (${nonDuplicates.length} עסקאות)`,
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

    // Final status message
    const successMessage = `סיום סנכרון: ${summary.processed} קבצים טוענו בהצלחה${summary.duplicates > 0 ? `, ${summary.duplicates} דילוגו כפילויות` : ''}`;
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
 * Get sync history from Firestore
 * Returns last sync timestamp for the selected folder
 */
export const getLastSyncTime = async (folderId: string): Promise<Date | null> => {
  try {
    const transactionsRef = collection(db, 'transactions');
    const q = query(transactionsRef, where('syncFolderId', '==', folderId));
    const snapshot = await getDocs(q);

    if (snapshot.empty) return null;

    // Get the most recent transaction
    let latestTime = new Date(0);
    snapshot.forEach((doc) => {
      if (doc.data().timestamp) {
        const docTime = doc.data().timestamp.toDate();
        if (docTime > latestTime) {
          latestTime = docTime;
        }
      }
    });

    return latestTime.getTime() === 0 ? null : latestTime;
  } catch (error) {
    console.error('Error getting sync history:', error);
    return null;
  }
};
