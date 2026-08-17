import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted runs before vi.mock factories — the only safe way to share
// a mock reference between the factory and individual test assertions.
//
// Task 7 — mockHttpsCallable/mockCallable replace mockGenerateContent (the old direct
// @google/genai/web mock): analyzeDocument no longer constructs a GoogleGenAI client at all, it
// calls httpsCallable(functions, 'aiExtractDocument') via src/services/aiClient.ts. mockCallable
// is the fn returned BY httpsCallable(...) — i.e. what gets invoked as call(req).
// mockGoogleGenAIConstructor stays as a regression guard: it must NEVER be called again.
const { mockHttpsCallable, mockCallable, mockGoogleGenAIConstructor } = vi.hoisted(() => ({
  mockHttpsCallable: vi.fn(),
  mockCallable: vi.fn(),
  mockGoogleGenAIConstructor: vi.fn(),
}));

// --- Module mocks ---

vi.mock('../services/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'col-ref'),
  query: vi.fn(() => 'query-ref'),
  where: vi.fn(() => 'where-clause'),
  getDocs: vi.fn(async () => ({ empty: true })),
  addDoc: vi.fn(async () => ({ id: 'doc-id' })),
  serverTimestamp: vi.fn(() => 'server-ts'),
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

// Regression guard only (Task 7) — nothing in FileProcessor.ts imports this any more; if it ever
// does again, mockGoogleGenAIConstructor.not.toHaveBeenCalled() below would still pass trivially
// unless the import comes back, which is exactly the point: the mock stays wired so a
// reintroduced `new GoogleGenAI(...)` call would show up here.
vi.mock('@google/genai/web', () => ({
  GoogleGenAI: mockGoogleGenAIConstructor,
}));

// --- Static imports (resolved after mock hoisting) ---
import type { DocumentAnalysis, ExtractedData, ExtractionDraft } from '../utils/FileProcessor';
import {
  CATEGORY_MAP,
  checkDuplicate,
  commitExtractionDraft,
  extractForReview,
  MAX_DOCUMENT_FILE_BYTES,
} from '../utils/FileProcessor';
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

  it('calls httpsCallable("aiExtractDocument") instead of constructing a GoogleGenAI client (Task 7)', async () => {
    extractionReturns(makeExtractedData());

    await extractForReview(makeFile(), vi.fn(), ['דויד'], 'mock-standard');

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'aiExtractDocument');
    expect(mockGoogleGenAIConstructor).not.toHaveBeenCalled();
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
      {}
    );

    expect(addDoc).toHaveBeenCalledTimes(1);
    expect(addDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ vendor: 'A' }));
    expect(result.savedCount).toBe(1);
  });

  it('writes to transaction_lines, not the legacy transactions collection', async () => {
    const itemA = makeExtractedData();
    await commitExtractionDraft(makeDraft([itemA]), [{ include: true, item: itemA }], {});

    const calls = (collection as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((args) => args[1] === 'transaction_lines')).toBe(true);
    expect(calls.some((args) => args[1] === 'transactions')).toBe(false);
  });

  it('a rejected (all-excluded) draft writes NOTHING to Firestore', async () => {
    const itemA = makeExtractedData();
    const result = await commitExtractionDraft(makeDraft([itemA]), [{ include: false, item: itemA }], {});

    expect(addDoc).not.toHaveBeenCalled();
    expect(result.savedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  it('still runs the existing checkDuplicate skip logic before writing (unchanged behavior, D7 does not touch it)', async () => {
    (getDocs as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ empty: false }); // duplicate exists
    const itemA = makeExtractedData();

    const result = await commitExtractionDraft(makeDraft([itemA]), [{ include: true, item: itemA }], {});

    expect(result.skippedCount).toBe(1);
    expect(result.savedCount).toBe(0);
    expect(addDoc).not.toHaveBeenCalled();
  });

  it('an item edited by the reviewer (e.g. corrected category) is saved with the EDITED values, not the original extraction', async () => {
    const original = makeExtractedData({ category: 'שונות' });
    const corrected = { ...original, category: 'בריאות' };

    await commitExtractionDraft(makeDraft([original]), [{ include: true, item: corrected }], {});

    expect(addDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ category: 'בריאות' }));
  });

  it('uploads to Drive at commit time (not before) when a token+file are supplied in opts', async () => {
    stubFetchUpload();
    const itemA = makeExtractedData();

    const result = await commitExtractionDraft(
      makeDraft([itemA]),
      [{ include: true, item: itemA }],
      { token: 'tok', file: makeFile() }
    );

    expect(fetch).toHaveBeenCalledOnce();
    expect(result.savedCount).toBe(1);
    expect(addDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ driveFileId: 'drive-file-id' }));
  });

  it('never touches Drive when no token is supplied — driveFileId stays null (processLocalFile-equivalent path)', async () => {
    stubFetchUpload();
    const itemA = makeExtractedData();

    await commitExtractionDraft(makeDraft([itemA]), [{ include: true, item: itemA }], {});

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

      await commitExtractionDraft(makeDraft([itemA], analysis), [{ include: true, item: itemA }], {});

      const calls = (collection as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some((args) => args[1] === 'documents')).toBe(true);
      expect(calls.some((args) => args[1] === 'transaction_lines')).toBe(true);
    });

    it('a duplicate document (same issuer/accountId/periodStart) blocks the whole commit', async () => {
      (getDocs as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ empty: false }); // documents dup check
      const itemA = makeExtractedData();

      const result = await commitExtractionDraft(makeDraft([itemA], analysis), [{ include: true, item: itemA }], {});

      expect(addDoc).not.toHaveBeenCalled();
      expect(result.savedCount).toBe(0);
    });
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

// getOrCreateFolder import kept alive for the Drive-upload-at-commit-time tests above —
// referenced here so an unused-import lint pass never flags it if those tests are skipped.
void getOrCreateFolder;
void CATEGORY_MAP;
