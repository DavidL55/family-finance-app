import { db } from "../services/firebase";
import { collection, query, where, getDocs, addDoc, serverTimestamp } from "firebase/firestore";
import { getOrCreateFolder } from "../services/GoogleDriveService";
import { extractDocument } from "../services/aiClient";

// Hebrew Category Mapping — moved to its own Firebase-free module so non-Vite entrypoints
// (e.g. scripts/migrate-transactions.ts run via `npx tsx`) can import it without dragging in
// firebase.ts and its `import.meta.env` usage. Re-exported here for backward compatibility.
export { CATEGORY_MAP } from './categoryMap';
import { CATEGORY_MAP } from './categoryMap';

async function ensureFolderPath(token: string, category: string): Promise<string> {
  const date = new Date();
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  // category is already a Hebrew string from Gemini; fall back to 'שונות' only if unrecognised
  const hebrewCategory = category || CATEGORY_MAP.General_Misc;

  const rootId = await getOrCreateFolder(token, 'Family_Finance');
  const yearId = await getOrCreateFolder(token, year, rootId);
  const monthId = await getOrCreateFolder(token, month, yearId);
  const categoryId = await getOrCreateFolder(token, hebrewCategory, monthId);

  return categoryId;
}

export interface ExtractedData {
  date: string; // YYYY-MM-DD
  vendor: string;
  amount: number;
  vat?: number;
  category: string;
  owner: string | null;
  isQuarterlyReport?: boolean;
  quarterlyData?: {
    balance: number;
    contribution: number;
    yield: number;
  };
  // Multi-line extraction fields
  description?: string;
  paymentType?: PaymentType;
  installmentNumber?: number;
  totalInstallments?: number;
  isCredit?: boolean;
  expenseClassification?: 'Fixed' | 'Semi-Variable' | 'Variable';
}

export type PaymentType = 'one_time' | 'installment' | 'standing_order' | 'direct_debit' | 'transfer' | 'fee' | 'interest' | 'refund' | 'cancellation' | 'atm';

export type DocumentType = 'credit_card' | 'bank_statement' | 'invoice' | 'investment_report' | 'loan' | 'insurance' | 'other';

export interface TransactionLine {
  date: string;              // YYYY-MM-DD
  description: string;       // original Hebrew description from document
  vendor: string;            // cleaned business name
  amount: number;            // charge amount (always positive)
  creditAmount?: number;     // for bank statements: credit side
  debitAmount?: number;      // for bank statements: debit side
  runningBalance?: number;   // for bank statements
  category: string;          // Hebrew category string
  paymentType: PaymentType;
  installmentNumber?: number;
  totalInstallments?: number;
  isCredit: boolean;         // true = income/refund, false = expense
  expenseClassification?: 'Fixed' | 'Semi-Variable' | 'Variable';
  originalAmount?: number;   // foreign currency original amount
  originalCurrency?: string; // e.g. "USD", "EUR", "LKR"
  voucherNumber?: string;
}

export interface DocumentAnalysis {
  documentType: DocumentType;
  issuer: string;            // "אמריקן אקספרס", "MAX", "ישראכרט", "בנק הפועלים"
  accountId: string;         // last 4 digits of card OR full account number
  periodStart: string;       // YYYY-MM-DD
  periodEnd: string;         // YYYY-MM-DD
  chargeDate?: string;       // YYYY-MM-DD - for credit cards: the debit date
  owner: string | null;      // cardholder/account holder name
  totalAmount: number;       // total charge amount
  openingBalance?: number;   // bank statements
  closingBalance?: number;   // bank statements
  currency: string;          // "ILS"
  transactions: TransactionLine[];
}

export type ProcessErrorType = 'extraction_failed' | 'duplicate' | 'upload_failed' | 'network' | 'rate_limit' | 'unknown';

/**
 * Called when Gemini returns 'שונות' (unknown category).
 * Must return a Hebrew category string from CATEGORY_MAP values.
 * If not provided, the file is silently filed under 'שונות'.
 */
export type OnUnknownCategoryCallback = (data: ExtractedData) => Promise<string>;

export interface ProcessResult {
  success: boolean;
  duplicate?: boolean;
  data?: ExtractedData;        // first item (backward compat)
  results?: ExtractedData[];   // all extracted items
  savedCount?: number;
  skippedCount?: number;
  errorType?: ProcessErrorType;
  errorMessage?: string;
  retryable?: boolean;
  retryAfterMs?: number;
}

// ── Task 7 (Stage 6) — extraction call migrated server-side ─────────────────────────────
//
// analyzeDocument/extractDataWithGemini used to construct a GoogleGenAI client directly, reading
// the Gemini provider key straight out of the Vite env (import.meta.env) with a process.env
// fallback — the last client-side provider key reference in the app (Task 6 already removed
// ai.ts's own). See task-7-brief.md's own grep check: no client-side provider-key env var name
// may appear anywhere under src/ after this task, comments included. Both are now thin
// wrappers over aiClient.extractDocument (httpsCallable('aiExtractDocument')); the extraction
// PROMPT (the Hebrew category rules/document-type taxonomy) moved VERBATIM to
// functions/src/handlers/aiExtractDocument.ts — this file no longer builds it at all.
//
// The old daily-quota localStorage counter (GEMINI_DAILY_LIMIT) and the in-process 429 retry loop
// are GONE, not merely unused: both encoded the direct Gemini SDK's own error shapes
// ("RESOURCE_EXHAUSTED", a `"retryDelay":"Ns"` JSON fragment) that can never appear once this
// file only ever sees a translated Hebrew HttpsError from aiExtractDocument.ts's own
// toAiHttpsError (D14/functions/src/providers/providerErrors.ts) — keeping them would have been
// dead, misleading code pretending to guard against a failure mode that no longer reaches here.
// The real limiter now is server-side (functions/src/costGate/costGate.ts's monthly ceiling,
// D4) — genuinely enforced, unlike the old client-only counter any user could clear.
// extractRetryDelay below is still used by classifyError()'s own rate-limit branch (unchanged by
// this task) as its retry-countdown default; harmless now that the `"retryDelay"` pattern it used
// to parse out of Gemini's raw error text will never match a translated Hebrew message — it
// simply always falls through to the 65s default. isDailyQuotaError (only ever called from the
// removed retry loop above) is genuinely dead and removed, not kept.

export async function extractDataWithGemini(file: File, familyMembers: string[], modelId: string): Promise<ExtractedData[]> {
  const analysis = await analyzeDocument(file, familyMembers, modelId);
  return analysis.transactions.map(line => ({
    date: line.date,
    vendor: line.vendor,
    amount: line.amount,
    category: line.category,
    owner: analysis.owner,
    description: line.description,
    paymentType: line.paymentType,
    installmentNumber: line.installmentNumber,
    totalInstallments: line.totalInstallments,
    isCredit: line.isCredit,
    expenseClassification: line.expenseClassification,
    isQuarterlyReport: false,
  }));
}

export async function analyzeDocument(file: File, familyMembers: string[], modelId: string): Promise<DocumentAnalysis> {
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = () => reject(reader.error ?? new Error('קריאת הקובץ נכשלה'));
    reader.readAsDataURL(file);
  });

  const res = await extractDocument({
    fileBase64: base64Data,
    mimeType: file.type || 'application/pdf',
    familyMembers,
    modelId,
  });

  return res.analysis;
}

function extractRetryDelay(error: unknown): number {
  try {
    const msg = error instanceof Error ? error.message : String(error);
    const match = msg.match(/"retryDelay"\s*:\s*"(\d+)s"/);
    if (match) return parseInt(match[1], 10) * 1000;
  } catch { /* ignore */ }
  return 65000; // default: 65s ensures a full new minute window
}

export async function checkDuplicate(data: ExtractedData): Promise<boolean> {
  try {
    const recordsRef = collection(db, 'transaction_lines');
    const q = query(
      recordsRef,
      where("vendor", "==", data.vendor),
      where("amount", "==", data.amount),
      where("date", "==", data.date)
    );
    const querySnapshot = await getDocs(q);
    return !querySnapshot.empty;
  } catch {
    // If Firestore is offline, assume no duplicate and continue
    return false;
  }
}

// Exported (D7) — extractForReview no longer swallows errors into a ProcessResult the way the
// old processLocalFile/processAndUploadFile/processDocumentFile did; callers now call
// extractForReview directly and need this same classification to render the right Hebrew
// message / decide whether to auto-retry a rate limit, unchanged from before.
export function classifyError(error: unknown): { errorType: ProcessErrorType; errorMessage: string; retryable: boolean; retryAfterMs?: number } {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return { errorType: 'network', errorMessage: 'בעיית רשת — בדוק את החיבור ונסה שוב', retryable: true };
  }
  if (error instanceof SyntaxError) {
    return { errorType: 'extraction_failed', errorMessage: 'לא ניתן לנתח את המסמך — נסה PDF או תמונה ברורה יותר', retryable: false };
  }
  if (error instanceof Error && (error.message.includes('429') || error.message.includes('Quota') || error.message.includes('quota'))) {
    const msg = error.message;
    const isDaily = msg.includes('Day') || msg.includes('PerDay');
    if (isDaily) {
      return { errorType: 'rate_limit', errorMessage: 'מגבלת יומית של Gemini מוצתה — נסה מחר או הוסף חיוב ב-Google AI Studio', retryable: false };
    }
    const retryAfterMs = extractRetryDelay(error);
    return { errorType: 'rate_limit', errorMessage: `מגבלת Gemini — ממתין ${Math.round(retryAfterMs / 1000)} שניות`, retryable: true, retryAfterMs };
  }
  if (error instanceof Error && error.message.includes('Upload')) {
    return { errorType: 'upload_failed', errorMessage: 'העלאה נכשלה — נסה שוב בעוד מספר שניות', retryable: true };
  }
  const message = error instanceof Error ? error.message : 'שגיאה לא ידועה';
  return { errorType: 'unknown', errorMessage: message, retryable: true };
}

// ── D7 (Stage 6 Task 1) — human review gate ────────────────────────────────────────
//
// The three functions this section replaces (processLocalFile, processAndUploadFile,
// processDocumentFile — removed) each extracted data with Gemini and immediately addDoc'd it
// into transaction_lines/documents with no human review step, despite spec §8's explicit HITL
// rule. That was a live, shipping vulnerability: a crafted or hallucinated document could inject
// fabricated transactions straight into the family ledger. extractForReview/commitExtractionDraft
// split "extract" from "save" — nothing reaches Firestore until a human has seen the draft and
// explicitly approved it via ExtractionReviewModal.
//
// (Stage 6 Task 7) — extractDataWithGemini/analyzeDocument now call the server (D7's own note
// above is now historical: they no longer share a GoogleGenAI client or the dead-env-var bug —
// both are gone, see the Task 7 comment right above analyzeDocument's definition). This task's
// own change here is additive to D7's gate, not a change to it: extractForReview gains a
// REQUIRED modelId param (threaded straight through to analyzeDocument, unchanged otherwise) and
// a client-side pre-flight size guard (D17) — the draft-not-save HITL contract itself is
// untouched.

// D17 (Stage 6 Task 7) — mirrors functions/src/handlers/aiExtractDocument.ts's own
// MAX_DOCUMENT_BASE64_BYTES BY HAND (same value, kept in sync manually) rather than importing it:
// that file pulls in firebase-functions/v2/https, a Node-only SDK that would break the Vite
// client bundle if imported here. base64 inflates a source file's size ~33% (D7's own note) —
// dividing (not multiplying) converts the SERVER's base64 ceiling back into a raw, pre-base64
// file-size ceiling so this check can run on `file.size` directly, before the file is ever read
// into memory or uploaded anywhere. This client-side check is a faster failure for the common
// case ONLY — the server-side guard in aiExtractDocument.ts remains the authoritative one; a
// request that somehow bypassed this check is still caught there.
const SERVER_MAX_DOCUMENT_BASE64_BYTES = 7 * 1024 * 1024;
export const MAX_DOCUMENT_FILE_BYTES = SERVER_MAX_DOCUMENT_BASE64_BYTES / 1.34;

export const OVERSIZED_DOCUMENT_MESSAGE_HE =
  'המסמך גדול מדי לעיבוד — פצל אותו למספר קבצים קטנים יותר או העלה עמודים בודדים.';

export interface ExtractionDraft {
  items: ExtractedData[];
  // Present only when the caller asked to link a `documents`-collection record (the old
  // processDocumentFile path) — null for the two simpler paths (the old processLocalFile /
  // processAndUploadFile paths), which save only to transaction_lines.
  documentMeta: DocumentAnalysis | null;
  fileName: string;
  fileSize: number;
}

export interface ExtractForReviewOptions {
  // true → the draft also carries documentMeta, so commitExtractionDraft additionally creates a
  // `documents` record and links each committed transaction_line to it via documentId (the old
  // processDocumentFile behavior). false/omitted → transaction_lines only.
  linkDocument?: boolean;
}

/**
 * Extraction only — never writes to Firestore. The single AI call (via analyzeDocument, now a
 * server-side httpsCallable — Task 7) is a strict superset of what extractDataWithGemini used to
 * compute for the simpler paths, so one call here serves all three old call sites; the caller
 * decides via `opts.linkDocument` whether the returned draft also carries the document-level
 * metadata needed to write a `documents` record at commit time.
 *
 * `modelId` (Task 7) is REQUIRED, not defaulted — this task touches every call site anyway (to
 * add the model picker), so a silent internal default would hide a decision a reviewer should see
 * made explicitly at the call site, matching spec §8's explicit-menu requirement.
 */
export async function extractForReview(
  file: File,
  onProgress: (status: string) => void,
  familyMembers: string[],
  modelId: string,
  opts: ExtractForReviewOptions = {}
): Promise<ExtractionDraft> {
  // D17 — checked BEFORE the file is ever read into memory (FileReader) or uploaded anywhere;
  // see the constant's own comment above for why this can't just import the server's constant.
  if (file.size > MAX_DOCUMENT_FILE_BYTES) {
    throw new Error(OVERSIZED_DOCUMENT_MESSAGE_HE);
  }

  onProgress('מנתח מסמך באמצעות AI...');
  const analysis = await analyzeDocument(file, familyMembers, modelId);

  const items: ExtractedData[] = analysis.transactions.map(line => ({
    date: line.date,
    vendor: line.vendor,
    amount: line.amount,
    category: line.category,
    owner: analysis.owner,
    description: line.description,
    paymentType: line.paymentType,
    installmentNumber: line.installmentNumber,
    totalInstallments: line.totalInstallments,
    isCredit: line.isCredit,
    expenseClassification: line.expenseClassification,
    isQuarterlyReport: false,
  }));

  onProgress(`נמצאו ${items.length} עסקאות — ממתין לאישור`);

  return {
    items,
    documentMeta: opts.linkDocument ? analysis : null,
    fileName: file.name,
    fileSize: file.size,
  };
}

async function uploadFileToDrive(token: string, file: File, folderCategory: string, fileName: string): Promise<string> {
  const folderId = await ensureFolderPath(token, folderCategory);
  const metadata = { name: fileName, parents: [folderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const uploadRes = await fetch('https://upload.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!uploadRes.ok) throw new Error('Upload failed');
  const uploadedFile = await uploadRes.json() as { id: string };
  return uploadedFile.id;
}

export interface CommitExtractionDraftOptions {
  // A pre-existing Drive file id — used verbatim when the file is already filed in Drive (e.g.
  // the sync-from-Drive batch path, which already uploaded/organized the file during extraction —
  // no primary-collection write happened, just a Drive copy, so re-uploading at commit time would
  // be wasted work). Ignored if `token` + `file` are also given.
  driveFileId?: string | null;
  // Presence of BOTH token and file triggers a Drive upload at commit time (D7 — "upload happens
  // at commit time, after approval, not before, so an abandoned/rejected extraction never uploads
  // a file to Drive for nothing").
  token?: string;
  file?: File;
  sourceDriveFileId?: string; // carried onto transaction_lines for dedupe (sync-from-Drive path)
  syncFolderId?: string;      // carried onto transaction_lines for dedupe (sync-from-Drive path)
}

/**
 * The ONLY function allowed to write extracted data into transaction_lines/documents. Called
 * exclusively after a human has reviewed the draft in ExtractionReviewModal and approved
 * (possibly after editing) some or all of the rows — `decisions` reflects that reviewed,
 * corrected state, not the raw extraction.
 */
export async function commitExtractionDraft(
  draft: ExtractionDraft,
  decisions: { include: boolean; item: ExtractedData }[],
  opts: CommitExtractionDraftOptions = {}
): Promise<{ savedCount: number; skippedCount: number }> {
  const included = decisions.filter(d => d.include).map(d => d.item);

  if (included.length === 0) {
    return { savedCount: 0, skippedCount: decisions.length };
  }

  // ── documents-collection linking path (old processDocumentFile) ──────────────────────
  if (draft.documentMeta) {
    const analysis = draft.documentMeta;

    const docsRef = collection(db, 'documents');
    const dupQ = query(
      docsRef,
      where('issuer', '==', analysis.issuer),
      where('accountId', '==', analysis.accountId),
      where('periodStart', '==', analysis.periodStart)
    );
    const dupSnap = await getDocs(dupQ);
    if (!dupSnap.empty) {
      return { savedCount: 0, skippedCount: decisions.length };
    }

    let driveFileId = opts.driveFileId ?? null;
    if (opts.token && opts.file) {
      const ext = draft.fileName.split('.').pop();
      const fileName = `${analysis.periodStart}_${analysis.issuer}_${analysis.accountId}.${ext}`;
      const category = analysis.documentType === 'bank_statement' ? 'הכנסות והשקעות' : (included[0]?.category || CATEGORY_MAP.General_Misc);
      driveFileId = await uploadFileToDrive(opts.token, opts.file, category, fileName);
    }

    const docRef = await addDoc(collection(db, 'documents'), {
      documentType: analysis.documentType,
      issuer: analysis.issuer,
      accountId: analysis.accountId,
      periodStart: analysis.periodStart,
      periodEnd: analysis.periodEnd,
      chargeDate: analysis.chargeDate ?? null,
      owner: analysis.owner,
      totalAmount: analysis.totalAmount,
      openingBalance: analysis.openingBalance ?? null,
      closingBalance: analysis.closingBalance ?? null,
      currency: analysis.currency || 'ILS',
      fileName: draft.fileName,
      driveFileId,
      transactionCount: included.length,
      created_at: serverTimestamp(),
    });

    for (const item of included) {
      await addDoc(collection(db, 'transaction_lines'), {
        documentId: docRef.id,
        date: item.date,
        description: item.description ?? '',
        vendor: item.vendor,
        amount: item.amount,
        category: item.category,
        paymentType: item.paymentType,
        installmentNumber: item.installmentNumber ?? null,
        totalInstallments: item.totalInstallments ?? null,
        isCredit: item.isCredit ?? false,
        expenseClassification: item.expenseClassification ?? null,
        owner: item.owner ?? analysis.owner,
        issuer: analysis.issuer,
        accountId: analysis.accountId,
        created_at: serverTimestamp(),
      });
    }

    return { savedCount: included.length, skippedCount: decisions.length - included.length };
  }

  // ── simple transaction_lines-only path (old processLocalFile / processAndUploadFile) ──
  let driveFileId = opts.driveFileId ?? null;
  const driveSynced = !!(opts.token && opts.file) || driveFileId != null;

  if (opts.token && opts.file) {
    const primaryItem = included.find(i => !i.isCredit) ?? included[0];
    const ext = draft.fileName.split('.').pop();
    const fileName = `${primaryItem.date}_${primaryItem.vendor}_${primaryItem.amount}.${ext}`;
    driveFileId = await uploadFileToDrive(opts.token, opts.file, primaryItem.category, fileName);
  }

  let savedCount = 0;
  let duplicateCount = 0;
  for (const item of included) {
    const isDup = await checkDuplicate(item);
    if (isDup) { duplicateCount++; continue; }

    await addDoc(collection(db, 'transaction_lines'), {
      ...item,
      fileName: draft.fileName,
      fileSize: draft.fileSize,
      created_at: serverTimestamp(),
      driveFileId,
      driveSynced,
      ...(opts.sourceDriveFileId ? { sourceDriveFileId: opts.sourceDriveFileId } : {}),
      ...(opts.syncFolderId ? { syncFolderId: opts.syncFolderId } : {}),
    });
    savedCount++;
  }

  return { savedCount, skippedCount: duplicateCount + (decisions.length - included.length) };
}
