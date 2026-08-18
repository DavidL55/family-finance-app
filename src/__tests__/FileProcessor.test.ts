import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted runs before vi.mock factories — the only safe way to share
// a mock reference between the factory and individual test assertions.
//
// Task 7 — mockHttpsCallable/mockCallable replace mockGenerateContent (the old direct
// @google/genai/web mock): analyzeDocument no longer constructs a GoogleGenAI client at all, it
// calls httpsCallable(functions, 'aiExtractDocument') via src/services/aiClient.ts. mockCallable
// is the fn returned BY httpsCallable(...) — i.e. what gets invoked as call(req).
// Batch 9 (closing review M3) — the mockGoogleGenAIConstructor guard that used to sit here is
// GONE, replaced by something strictly stronger: @google/genai is no longer a root dependency at
// all, so a reintroduced client-side import cannot even resolve. See
// src/__tests__/clientAiPlumbing.test.ts, which asserts that absence directly.
const { mockHttpsCallable, mockCallable, mockBatch } = vi.hoisted(() => ({
  mockHttpsCallable: vi.fn(),
  mockCallable: vi.fn(),
  mockBatch: { set: vi.fn(), commit: vi.fn(async () => undefined) },
}));

// --- Module mocks ---

vi.mock('../services/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, name: string) => ({ __col: name })),
  query: vi.fn(() => 'query-ref'),
  where: vi.fn(() => 'where-clause'),
  getDocs: vi.fn(async () => ({ empty: true })),
  addDoc: vi.fn(async () => ({ id: 'doc-id' })),
  serverTimestamp: vi.fn(() => 'server-ts'),
  // Batch 9 (closing review I3) — commitExtractionDraft now writes an audit_log entry through the
  // SAME writeAuditLog() helper GroupsService/RecurringService/PermissionsService/
  // financeCollections all use, so the batch + doc primitives it needs are mocked here.
  doc: vi.fn((colOrDb: unknown, ...rest: unknown[]) => ({ id: String(rest[rest.length - 1] ?? 'auto'), __in: colOrDb })),
  writeBatch: vi.fn(() => mockBatch),
}));

vi.mock('../services/GoogleDriveService', () => ({
  getOrCreateFolder: vi.fn(async () => 'folder-id'),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => {
    mockHttpsCallable(...args);
    return mockCallable;
  },
}));

// --- Static imports (resolved after mock hoisting) ---
import type { DocumentAnalysis, ExtractedData, ExtractionDraft } from '../utils/FileProcessor';
import {
  CATEGORY_MAP,
  checkDuplicate,
  classifyError,
  commitExtractionDraft,
  extractForReview,
  MAX_DOCUMENT_FILE_BYTES,
  RATE_LIMIT_RETRY_DELAY_MS,
} from '../utils/FileProcessor';
// Batch 5 — the ONE canonical refusal map, plus useAiChat's export of it. Imported from BOTH
// places on purpose: the identity assertion below is what proves they are not two copies.
import { AI_REFUSAL_MESSAGES_HE } from '../config/aiRefusals';
import { AI_REFUSAL_MESSAGES_HE as AI_CHAT_REFUSAL_MESSAGES_HE } from '../hooks/useAiChat';
import { getOrCreateFolder } from '../services/GoogleDriveService';
import { collection, addDoc, getDocs } from 'firebase/firestore';

// --- Helpers ---

function makeExtractedData(overrides: Partial<ExtractedData> = {}): ExtractedData {
  return {
    date: '2026-03-01',
    vendor: 'Test Vendor',
    amount: 100,
    category: 'מגורים ובית',
    owner: null,
    ...overrides,
  };
}

// Batch 9 (closing review I3) — actorMemberId is REQUIRED, not optional: an import with no
// recorded approver is exactly the state I3 named, and an optional field is a rule a new call
// site can silently skip (the same reasoning getAdapterForModel's required `action` and
// toAiHttpsError's required `role` were settled on).
const COMMIT_OPTS = { actorMemberId: 'david-levy' } as const;

function makeFile(name = 'test.pdf', size?: number): File {
  const content = size ? new Uint8Array(size) : ['%PDF-1.4 test content'];
  return new File([content as never], name, { type: 'application/pdf' });
}

// analyzeDocument() now calls httpsCallable('aiExtractDocument') and returns res.data.analysis —
// wrap the single-line ExtractedData fixtures the tests build into that DocumentAnalysis shape,
// same role geminiReturns() used to play for the direct-SDK mock.
function extractionReturns(data: ExtractedData, overrides: Partial<DocumentAnalysis> = {}) {
  const analysis: DocumentAnalysis = {
    documentType: 'invoice',
    issuer: data.vendor,
    accountId: '0000',
    periodStart: data.date,
    periodEnd: data.date,
    owner: data.owner,
    totalAmount: data.amount,
    currency: 'ILS',
    transactions: [
      {
        date: data.date,
        description: data.description ?? data.vendor,
        vendor: data.vendor,
        amount: data.amount,
        category: data.category,
        paymentType: data.paymentType ?? 'one_time',
        installmentNumber: data.installmentNumber,
        totalInstallments: data.totalInstallments,
        isCredit: data.isCredit ?? false,
        expenseClassification: data.expenseClassification,
      },
    ],
    ...overrides,
  };
  mockCallable.mockResolvedValueOnce({ data: { analysis, providerId: 'mock', modelId: 'mock-standard', costILS: 0 } });
}

function stubFetchUpload() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'drive-file-id' }),
    }))
  );
}

function makeDraft(items: ExtractedData[], documentMeta: DocumentAnalysis | null = null): ExtractionDraft {
  return { items, documentMeta, fileName: 'f.pdf', fileSize: 100 };
}

// --- Tests ---

describe('extractForReview (D7 — replaces the old auto-save processLocalFile/processAndUploadFile/processDocumentFile)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('does NOT write to Firestore — returns a draft only', async () => {
    extractionReturns(makeExtractedData());

    const draft = await extractForReview(makeFile(), vi.fn(), ['דויד'], 'mock-standard');

    expect(addDoc).not.toHaveBeenCalled();
    expect(draft.items.length).toBeGreaterThan(0);
  });

  it('calls httpsCallable("aiExtractDocument") — the extraction call is server-side (Task 7)', async () => {
    extractionReturns(makeExtractedData());

    await extractForReview(makeFile(), vi.fn(), ['דויד'], 'mock-standard');

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'aiExtractDocument');
  });

  it('passes the selected modelId straight through to the server call', async () => {
    extractionReturns(makeExtractedData());

    await extractForReview(makeFile(), vi.fn(), ['דויד'], 'claude-opus-5');

    expect(mockCallable).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'claude-opus-5' }));
  });

  it('maps the extracted transaction lines into ExtractedData items, same shape extractDataWithGemini produced', async () => {
    extractionReturns(makeExtractedData({ vendor: 'שופרסל', amount: 250, category: 'מזון וצריכה' }));

    const draft = await extractForReview(makeFile(), vi.fn(), [], 'mock-standard');

    expect(draft.items).toEqual([
      expect.objectContaining({ vendor: 'שופרסל', amount: 250, category: 'מזון וצריכה' }),
    ]);
  });

  it('documentMeta is null by default (the two simpler save paths — no documents-collection link)', async () => {
    extractionReturns(makeExtractedData());

    const draft = await extractForReview(makeFile(), vi.fn(), [], 'mock-standard');

    expect(draft.documentMeta).toBeNull();
  });

  it('documentMeta is populated when the caller asks to link a documents-collection record', async () => {
    extractionReturns(makeExtractedData());

    const draft = await extractForReview(makeFile(), vi.fn(), [], 'mock-standard', { linkDocument: true });

    expect(draft.documentMeta).not.toBeNull();
    expect(draft.documentMeta?.issuer).toBe('Test Vendor');
  });

  it('carries the source file name and size into the draft', async () => {
    extractionReturns(makeExtractedData());

    const draft = await extractForReview(makeFile('statement.pdf'), vi.fn(), [], 'mock-standard');

    expect(draft.fileName).toBe('statement.pdf');
    expect(draft.fileSize).toBeGreaterThan(0);
  });

  describe('pre-flight size guard (D17)', () => {
    it('rejects an oversized file with a Hebrew "המסמך גדול מדי" error, with ZERO network call to aiExtractDocument', async () => {
      const oversized = makeFile('huge.pdf', Math.ceil(MAX_DOCUMENT_FILE_BYTES) + 1);

      await expect(extractForReview(oversized, vi.fn(), [], 'mock-standard')).rejects.toThrow(/גדול מדי/);

      expect(mockHttpsCallable).not.toHaveBeenCalled();
      expect(mockCallable).not.toHaveBeenCalled();
    });

    it('accepts a file at or under the threshold', async () => {
      extractionReturns(makeExtractedData());
      const ok = makeFile('ok.pdf', 1000);

      await expect(extractForReview(ok, vi.fn(), [], 'mock-standard')).resolves.toBeDefined();
    });
  });
});

describe('commitExtractionDraft (D7) — the ONLY function allowed to write extracted data to Firestore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('writes ONLY the items marked include:true', async () => {
    const itemA = makeExtractedData({ vendor: 'A' });
    const itemB = makeExtractedData({ vendor: 'B' });
    const draft = makeDraft([itemA, itemB]);

    const result = await commitExtractionDraft(
      draft,
      [
        { include: true, item: itemA },
        { include: false, item: itemB },
      ],
      COMMIT_OPTS
    );

    expect(addDoc).toHaveBeenCalledTimes(1);
    expect(addDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ vendor: 'A' }));
    expect(result.savedCount).toBe(1);
  });

  it('writes to transaction_lines, not the legacy transactions collection', async () => {
    const itemA = makeExtractedData();
    await commitExtractionDraft(makeDraft([itemA]), [{ include: true, item: itemA }], COMMIT_OPTS);

    const calls = (collection as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((args) => args[1] === 'transaction_lines')).toBe(true);
    expect(calls.some((args) => args[1] === 'transactions')).toBe(false);
  });

  it('a rejected (all-excluded) draft writes NOTHING to Firestore', async () => {
    const itemA = makeExtractedData();
    const result = await commitExtractionDraft(makeDraft([itemA]), [{ include: false, item: itemA }], COMMIT_OPTS);

    expect(addDoc).not.toHaveBeenCalled();
    expect(result.savedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  it('still runs the existing checkDuplicate skip logic before writing (unchanged behavior, D7 does not touch it)', async () => {
    (getDocs as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ empty: false }); // duplicate exists
    const itemA = makeExtractedData();

    const result = await commitExtractionDraft(makeDraft([itemA]), [{ include: true, item: itemA }], COMMIT_OPTS);

    expect(result.skippedCount).toBe(1);
    expect(result.savedCount).toBe(0);
    expect(addDoc).not.toHaveBeenCalled();
  });

  it('an item edited by the reviewer (e.g. corrected category) is saved with the EDITED values, not the original extraction', async () => {
    const original = makeExtractedData({ category: 'שונות' });
    const corrected = { ...original, category: 'בריאות' };

    await commitExtractionDraft(makeDraft([original]), [{ include: true, item: corrected }], COMMIT_OPTS);

    expect(addDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ category: 'בריאות' }));
  });

  it('uploads to Drive at commit time (not before) when a token+file are supplied in opts', async () => {
    stubFetchUpload();
    const itemA = makeExtractedData();

    const result = await commitExtractionDraft(
      makeDraft([itemA]),
      [{ include: true, item: itemA }],
      { ...COMMIT_OPTS, token: 'tok', file: makeFile() }
    );

    expect(fetch).toHaveBeenCalledOnce();
    expect(result.savedCount).toBe(1);
    expect(addDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ driveFileId: 'drive-file-id' }));
  });

  it('never touches Drive when no token is supplied — driveFileId stays null (processLocalFile-equivalent path)', async () => {
    stubFetchUpload();
    const itemA = makeExtractedData();

    await commitExtractionDraft(makeDraft([itemA]), [{ include: true, item: itemA }], COMMIT_OPTS);

    expect(fetch).not.toHaveBeenCalled();
    expect(addDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ driveFileId: null }));
  });

  describe('documentMeta present — the documents-collection linking path (processDocumentFile equivalent)', () => {
    const analysis: DocumentAnalysis = {
      documentType: 'credit_card',
      issuer: 'MAX',
      accountId: '2190',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      owner: 'דויד',
      totalAmount: 100,
      currency: 'ILS',
      transactions: [],
    };

    it('creates a documents record AND its transaction_lines, linked by documentId', async () => {
      (addDoc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'doc-123' }).mockResolvedValueOnce({ id: 'line-1' });
      const itemA = makeExtractedData();

      await commitExtractionDraft(makeDraft([itemA], analysis), [{ include: true, item: itemA }], COMMIT_OPTS);

      const calls = (collection as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some((args) => args[1] === 'documents')).toBe(true);
      expect(calls.some((args) => args[1] === 'transaction_lines')).toBe(true);
    });

    it('a duplicate document (same issuer/accountId/periodStart) blocks the whole commit', async () => {
      (getDocs as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ empty: false }); // documents dup check
      const itemA = makeExtractedData();

      const result = await commitExtractionDraft(makeDraft([itemA], analysis), [{ include: true, item: itemA }], COMMIT_OPTS);

      expect(addDoc).not.toHaveBeenCalled();
      expect(result.savedCount).toBe(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BATCH 9 (closing review I3) — THE IMPORT COMMIT WAS THE ONLY WRITE PATH IN THE APP WITH NO
// AUDIT TRAIL.
//
// GroupsService, PermissionsService, RecurringService and financeCollections' owned-collection
// factory all write an audit_log entry alongside the mutation they perform (spec §11/§14.5).
// commitExtractionDraft addDoc'd into `documents` and `transaction_lines` and wrote nothing —
// and `audit_log` appears ZERO times in the entire Stage 6 ledger, because Stage 6 rebuilt this
// exact path in Task 1 and dropped the audit write on the way.
//
// It is the write that matters most: it is the ONE place a human's approval turns model output
// into ledger data, so "who approved this, and what exactly did they approve" is the question
// the trail exists to answer. The entry therefore records the outcome, not merely the attempt.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('commitExtractionDraft writes an audit_log entry (closing review I3)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  const auditEntries = () =>
    mockBatch.set.mock.calls
      .map((args) => args[1] as Record<string, unknown>)
      .filter((data) => typeof data?.action === 'string' && String(data.action).startsWith('extraction.'));

  it('records the approving member, the action and the file — through the shared writeAuditLog shape', async () => {
    const itemA = makeExtractedData({ vendor: 'A', amount: 100 });
    await commitExtractionDraft(makeDraft([itemA]), [{ include: true, item: itemA }], COMMIT_OPTS);

    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    const [entry] = auditEntries();
    expect(entry).toMatchObject({ actorMemberId: 'david-levy', action: 'extraction.commit' });
    // The same four required fields firestore.rules' isValidAuditEntry validates.
    expect(entry.target).toEqual(expect.any(String));
    expect(entry.at).toEqual(expect.any(String));
  });

  it('captures enough to reconstruct WHAT A PERSON APPROVED — counts, money, and the row ids', async () => {
    (addDoc as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'line-1' })
      .mockResolvedValueOnce({ id: 'line-2' });
    const kept1 = makeExtractedData({ vendor: 'A', amount: 100 });
    const kept2 = makeExtractedData({ vendor: 'B', amount: 40.5 });
    const dropped = makeExtractedData({ vendor: 'C', amount: 999 });

    await commitExtractionDraft(
      makeDraft([kept1, kept2, dropped]),
      [{ include: true, item: kept1 }, { include: true, item: kept2 }, { include: false, item: dropped }],
      COMMIT_OPTS
    );

    const details = auditEntries()[0].details as Record<string, unknown>;
    expect(details).toMatchObject({
      fileName: 'f.pdf',
      reviewedCount: 3,   // rows the human was shown
      approvedCount: 2,   // rows the human kept
      savedCount: 2,      // rows that actually landed
      skippedCount: 1,
      approvedTotalAmount: 140.5, // the money the approval let through
    });
    // The ids make the entry a pointer to the exact rows, not just a tally of them.
    expect(details.transactionLineIds).toEqual(['line-1', 'line-2']);
  });

  it('distinguishes a duplicate SKIP from an approval — savedCount tells the truth, not approvedCount', async () => {
    (getDocs as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ empty: false }); // duplicate
    const itemA = makeExtractedData();
    await commitExtractionDraft(makeDraft([itemA]), [{ include: true, item: itemA }], COMMIT_OPTS);

    const details = auditEntries()[0].details as Record<string, unknown>;
    expect(details).toMatchObject({ approvedCount: 1, savedCount: 0, skippedCount: 1 });
  });

  it('on the documents path the target names the document it created, so the trail is followable', async () => {
    const analysis: DocumentAnalysis = {
      documentType: 'credit_card', issuer: 'MAX', accountId: '2190',
      periodStart: '2026-02-01', periodEnd: '2026-02-28', owner: 'דויד',
      totalAmount: 100, currency: 'ILS', transactions: [],
    };
    (addDoc as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'doc-123' })
      .mockResolvedValueOnce({ id: 'line-1' });
    const itemA = makeExtractedData();

    await commitExtractionDraft(makeDraft([itemA], analysis), [{ include: true, item: itemA }], COMMIT_OPTS);

    const entry = auditEntries()[0];
    expect(entry.target).toBe('documents/doc-123');
    expect(entry.details).toMatchObject({ documentId: 'doc-123', issuer: 'MAX', accountId: '2190' });
  });

  it('a fully-rejected draft writes NO audit entry — nothing happened, so nothing is recorded', async () => {
    // Not merely tidiness: an entry for a commit that wrote nothing would make the trail claim a
    // person approved data into the ledger when they did the opposite (this is the same
    // savedCount===0 case the watermark chain settled as REJECTED, kept consistent here).
    const itemA = makeExtractedData();
    await commitExtractionDraft(makeDraft([itemA]), [{ include: false, item: itemA }], COMMIT_OPTS);
    expect(auditEntries()).toEqual([]);
    expect(mockBatch.commit).not.toHaveBeenCalled();
  });

  it('a duplicate DOCUMENT blocks the commit and writes no audit entry either', async () => {
    const analysis: DocumentAnalysis = {
      documentType: 'credit_card', issuer: 'MAX', accountId: '2190',
      periodStart: '2026-02-01', periodEnd: '2026-02-28', owner: 'דויד',
      totalAmount: 100, currency: 'ILS', transactions: [],
    };
    (getDocs as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ empty: false });
    const itemA = makeExtractedData();
    await commitExtractionDraft(makeDraft([itemA], analysis), [{ include: true, item: itemA }], COMMIT_OPTS);
    expect(auditEntries()).toEqual([]);
  });

  it('REFUSES to write anything at all when it cannot name who approved it', async () => {
    // Fails BEFORE the first addDoc, not after: an unattributable import is the state I3 named,
    // and firestore.rules would reject the audit entry anyway (actorMemberId.size() > 0), which
    // after the fact would leave the ledger rows written and the trail missing.
    const itemA = makeExtractedData();
    await expect(
      commitExtractionDraft(makeDraft([itemA]), [{ include: true, item: itemA }], { actorMemberId: '  ' })
    ).rejects.toThrow(/מזהה/);
    expect(addDoc).not.toHaveBeenCalled();
    expect(mockBatch.commit).not.toHaveBeenCalled();
  });
});

// Task 5 (carried forward) — transaction_lines is the single canonical Firestore collection.
describe('checkDuplicate — transaction_lines is the single canonical collection', () => {
  afterEach(() => vi.clearAllMocks());

  it('reads from transaction_lines, not the legacy transactions collection', async () => {
    await checkDuplicate(makeExtractedData());

    const calls = (collection as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((args) => args[1] === 'transaction_lines')).toBe(true);
    expect(calls.some((args) => args[1] === 'transactions')).toBe(false);
  });
});

// Regression guard: the legacy auto-save functions are gone. If anyone reintroduces
// processLocalFile/processAndUploadFile/processDocumentFile (the pre-D7 auto-save path),
// this fails the build outright rather than silently reopening the ledger-corruption gap.
//
// This guard alone only catches those three EXACT names being reintroduced — it would miss a new
// function under a different name doing the same auto-save loop, a direct addDoc/updateDoc/
// setDoc/batch.set dropped into a component, or a rename-and-re-export. That structural gap is
// closed separately in src/__tests__/transactionWriteGuard.test.ts (Stage 6 Task 1 fixes,
// review-driven fix #2), which scans src/ for writes to transaction_lines/documents/investments
// against an explicit allow-list rather than trusting a function-name blocklist.
describe('D7 regression guard — the old auto-save functions no longer exist', () => {
  it('the FileProcessor module has no processLocalFile/processAndUploadFile/processDocumentFile export', async () => {
    const mod = await import('../utils/FileProcessor');
    expect((mod as Record<string, unknown>).processLocalFile).toBeUndefined();
    expect((mod as Record<string, unknown>).processAndUploadFile).toBeUndefined();
    expect((mod as Record<string, unknown>).processDocumentFile).toBeUndefined();
  });
});

// Task 7 review, Important 2 — SILENT UX REGRESSION FROM TASK 7'S DELETIONS.
//
// classifyError used to detect a rate limit by string-matching error.message for '429'/'Quota'/
// 'quota' — shapes the direct Gemini SDK produced. Since Task 7 moved extraction server-side,
// extraction failures arrive as Firebase FunctionsErrors with HEBREW messages (translated by
// functions/src/providers/providerErrors.ts's toAiHttpsError), so those English substrings can
// never appear again. The rate-limit branch became unreachable dead code and FolderLogic's
// "auto-retry once on rate limit with a countdown" UX silently stopped firing, with nothing
// reporting it. Nothing exercised this path — which is the actual root cause, and why these tests
// exist.
//
// The repair keys off the STRUCTURED error code, the same fix shape Task 8 applied to
// useAiChat.ts's errorMessageFor: a fact about what the server decided, not a guess about what its
// prose happens to say this week.
describe('classifyError — server-translated HttpsErrors (Task 7 review, Important 2)', () => {
  // Shape of a Firebase JS SDK FunctionsError as it reaches the client: an Error whose `code` is
  // namespaced ("functions/<grpc-code>"), plus the server's `message` and optional `details`.
  function functionsError(code: string, message: string, details?: unknown): Error & { code: string; details?: unknown } {
    const e = new Error(message) as Error & { code: string; details?: unknown };
    e.code = `functions/${code}`;
    if (details !== undefined) e.details = details;
    return e;
  }

  it('classifies a provider rate-limit (resource-exhausted, no structured refusal reason) as a RETRYABLE rate limit', () => {
    // The exact Hebrew copy providerErrors.ts's COPY_HE['rate-limited'] produces today.
    const err = functionsError('resource-exhausted', 'ספק ה-AI עמוס כרגע — נסה שוב בעוד רגע.');
    const res = classifyError(err);
    expect(res.errorType).toBe('rate_limit');
    expect(res.retryable).toBe(true);
    expect(res.retryAfterMs).toBe(RATE_LIMIT_RETRY_DELAY_MS);
    // The server's own actionable Hebrew copy survives verbatim — never replaced by a
    // client-authored, now-wrong "מגבלת Gemini" string (the provider is model-dependent now).
    expect(res.errorMessage).toBe('ספק ה-AI עמוס כרגע — נסה שוב בעוד רגע.');
  });

  it('does NOT auto-retry a cost-gate refusal, which shares the resource-exhausted code but carries a structured reason', () => {
    // aiExtractDocument rethrows ApprovalRequiredError as resource-exhausted WITH details.reason
    // (D4/Task 3). Retrying a budget refusal changes nothing — it would just burn a 65s countdown
    // and fail again. The structured field, not the prose, is what tells the two apart.
    //
    // Batch 5 — 'ceiling-invalid' ADDED. The loop used to omit it, so the one reason Task 8's F1
    // work introduced was the one reason nothing here exercised.
    for (const reason of ['over-ceiling', 'ceiling-unconfigured', 'ceiling-invalid', 'unknown-model']) {
      const err = functionsError('resource-exhausted', 'נדרש אישור לחריגה מהתקרה', { reason });
      const res = classifyError(err);
      expect(res.retryable).toBe(false);
      expect(res.retryAfterMs).toBeUndefined();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // BATCH 5 — THE SAME BRITTLENESS useAiChat's F-H FIX CLOSED, ONE SURFACE OVER.
  //
  // classifyError used the structured `reason` for the RETRY decision (correctly) but still
  // rendered the SERVER's prose for the message, and the loop above hardcoded one server string
  // as a fixture. That is the shape F-H diagnosed on the chat surface and proved worthless: a
  // client test that hand-writes the server's copy is asserting that two literals in the test
  // file differ, which can never detect the server's three refusal messages converging.
  //
  // Fixed the same way — by OWNING the copy client-side, not by adding another test — and from
  // the SAME map useAiChat reads, so the two surfaces cannot drift into telling a user two
  // different things about one server decision.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  it.each([
    ['ceiling-unconfigured'],
    ['ceiling-invalid'],
    ['over-ceiling'],
  ])('reason "%s" renders the CLIENT-OWNED canonical message, ignoring a divergent err.message', (reason) => {
    const err = functionsError('resource-exhausted', 'טקסט שרת שונה לגמרי, לא אמור להיות מוצג', { reason });
    const res = classifyError(err);
    expect(res.errorMessage).toBe(AI_REFUSAL_MESSAGES_HE[reason]);
    expect(res.errorMessage).not.toBe('טקסט שרת שונה לגמרי, לא אמור להיות מוצג');
  });

  it('the three cost-gate refusals render three PAIRWISE-DISTINCT messages on the extraction surface too', () => {
    // ONE identical server string for all three — the "server copy converged" world. If this
    // surface were still echoing err.message, all three would come back the same and this fails.
    const rendered = ['ceiling-unconfigured', 'ceiling-invalid', 'over-ceiling'].map(
      (reason) => classifyError(functionsError('resource-exhausted', 'תקרה', { reason })).errorMessage
    );
    expect(new Set(rendered).size).toBe(3);
    for (const text of rendered) expect(text).not.toBe('תקרה');
  });

  it('the extraction surface and the chat surface read ONE map — neither owns a private copy', () => {
    // The point of the shared config module. Two independently-maintained maps would be the F4
    // class again: one goes stale, and the same server decision is explained two different ways
    // depending on which screen the user happened to be on.
    expect(AI_REFUSAL_MESSAGES_HE).toBe(AI_CHAT_REFUSAL_MESSAGES_HE);
  });

  it('unknown-model still falls through to the server message — a config bug, not a spend decision', () => {
    // Deliberately NOT client-owned, matching useAiChat exactly: this reason means the registry
    // and the request disagree, which is an operator/config fact only the server knows the
    // specifics of. Batch 5 gives it its own actionable server copy (it used to share
    // over-ceiling's string); rendering that verbatim is what makes the new copy reach anyone.
    const err = functionsError('resource-exhausted', 'הודעת שרת ייחודית ל-unknown-model', { reason: 'unknown-model' });
    expect(classifyError(err).errorMessage).toBe('הודעת שרת ייחודית ל-unknown-model');
  });

  it('renders any other server-translated failure verbatim rather than inventing copy', () => {
    const err = functionsError('deadline-exceeded', 'הבקשה לספק ה-AI ארכה זמן רב מדי — נסה שוב.');
    expect(classifyError(err).errorMessage).toBe('הבקשה לספק ה-AI ארכה זמן רב מדי — נסה שוב.');
  });

  it('no longer sniffs message text for "429"/"quota" — an English quota mention on a raw Error is not a server rate-limit decision', () => {
    const raw = new Error('429 quota exceeded');
    expect(classifyError(raw).errorType).toBe('unknown');
  });

  it('still classifies a genuine client-side network failure, which never becomes a FunctionsError', () => {
    const res = classifyError(new TypeError('Failed to fetch'));
    expect(res.errorType).toBe('network');
    expect(res.retryable).toBe(true);
  });
});

// getOrCreateFolder import kept alive for the Drive-upload-at-commit-time tests above —
// referenced here so an unused-import lint pass never flags it if those tests are skipped.
void getOrCreateFolder;
void CATEGORY_MAP;
