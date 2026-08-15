import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted runs before vi.mock factories — the only safe way to share
// a mock reference between the factory and individual test assertions.
const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

// --- Module mocks ---

vi.mock('../services/firebase', () => ({ db: {} }));

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

vi.mock('@google/genai/web', () => ({
  // GoogleGenAI is used as `new GoogleGenAI(...)` — must be a class.
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

// --- Static imports (resolved after mock hoisting) ---
import type { DocumentAnalysis, ExtractedData } from '../utils/FileProcessor';
import { CATEGORY_MAP, checkDuplicate, processAndUploadFile, processLocalFile } from '../utils/FileProcessor';
import { getOrCreateFolder } from '../services/GoogleDriveService';
import { collection, getDocs } from 'firebase/firestore';

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

function makeFile(name = 'test.pdf'): File {
  return new File(['%PDF-1.4 test content'], name, { type: 'application/pdf' });
}

// analyzeDocument() parses Gemini's response into a DocumentAnalysis (one
// document, many transaction lines) — see FileProcessor.ts. Wrap the
// single-line ExtractedData fixtures the tests build into that shape so the
// mocked response matches what extractDataWithGemini() actually expects.
function geminiReturns(data: ExtractedData) {
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
  };
  mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(analysis) });
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

// --- Tests ---

describe('processAndUploadFile — onUnknownCategory callback', () => {
  beforeEach(() => {
    stubFetchUpload();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('calls onUnknownCategory when Gemini returns שונות', async () => {
    geminiReturns(makeExtractedData({ category: CATEGORY_MAP.General_Misc }));
    // processAndUploadFile mutates the same item object in place
    // (`item.category = await onUnknownCategory(item)`) right after invoking
    // the callback, so asserting on the mock's recorded call args after the
    // fact would see the post-mutation value, not what was actually passed.
    // Capture the category synchronously inside the callback instead.
    let receivedCategory: string | undefined;
    const callback = vi.fn(async (item) => {
      receivedCategory = item.category;
      return CATEGORY_MAP.Housing_Utilities;
    });

    const result = await processAndUploadFile(makeFile(), 'token', vi.fn(), [], callback);

    expect(result.success).toBe(true);
    expect(callback).toHaveBeenCalledOnce();
    expect(receivedCategory).toBe('שונות');
  });

  it('calls onUnknownCategory when Gemini returns an unrecognised category', async () => {
    geminiReturns(makeExtractedData({ category: 'לא ידוע' }));
    const callback = vi.fn(async () => CATEGORY_MAP.Health);

    await processAndUploadFile(makeFile(), 'token', vi.fn(), [], callback);

    expect(callback).toHaveBeenCalledOnce();
  });

  it('does NOT call onUnknownCategory when Gemini returns a known category', async () => {
    geminiReturns(makeExtractedData({ category: 'מגורים ובית' }));
    const callback = vi.fn(async () => CATEGORY_MAP.General_Misc);

    await processAndUploadFile(makeFile(), 'token', vi.fn(), [], callback);

    expect(callback).not.toHaveBeenCalled();
  });

  it('silently uses שונות when no callback is provided and category is unknown', async () => {
    geminiReturns(makeExtractedData({ category: 'שונות' }));

    const result = await processAndUploadFile(makeFile(), 'token', vi.fn(), []);

    expect(result.success).toBe(true);
    const calls = (getOrCreateFolder as ReturnType<typeof vi.fn>).mock.calls;
    const categoryCall = calls.find((args) => args[1] === 'שונות');
    expect(categoryCall).toBeDefined();
  });

  it('uses the user-selected category — not the original — for Drive folder path', async () => {
    geminiReturns(makeExtractedData({ category: 'שונות' }));
    const callback = vi.fn(async () => CATEGORY_MAP.Health);

    await processAndUploadFile(makeFile(), 'token', vi.fn(), [], callback);

    const calls = (getOrCreateFolder as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.find((args) => args[1] === CATEGORY_MAP.Health)).toBeDefined();
    expect(calls.find((args) => args[1] === 'שונות')).toBeUndefined();
  });

  it('returns duplicate: true without calling callback when duplicate exists', async () => {
    (getDocs as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ empty: false });
    geminiReturns(makeExtractedData({ category: 'שונות' }));
    const callback = vi.fn(async () => CATEGORY_MAP.Health);

    const result = await processAndUploadFile(makeFile(), 'token', vi.fn(), [], callback);

    expect(result.duplicate).toBe(true);
    expect(callback).not.toHaveBeenCalled();
  });
});

// Task 5: `transaction_lines` is now the single canonical Firestore collection for
// transactions. These guard against a re-introduced legacy `'transactions'` read/write —
// every collection() call FileProcessor.ts makes for transaction data must target
// 'transaction_lines', never the legacy name (in either single- or double-quoted form).
describe('Task 5 — transaction_lines is the single canonical collection', () => {
  beforeEach(() => {
    stubFetchUpload();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('checkDuplicate reads from transaction_lines, not the legacy transactions collection', async () => {
    await checkDuplicate(makeExtractedData());

    const calls = (collection as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((args) => args[1] === 'transaction_lines')).toBe(true);
    expect(calls.some((args) => args[1] === 'transactions')).toBe(false);
  });

  it('processLocalFile saves to transaction_lines, not the legacy transactions collection', async () => {
    geminiReturns(makeExtractedData({ category: 'מגורים ובית' }));

    const result = await processLocalFile(makeFile(), vi.fn(), []);

    expect(result.success).toBe(true);
    const calls = (collection as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((args) => args[1] === 'transaction_lines')).toBe(true);
    expect(calls.some((args) => args[1] === 'transactions')).toBe(false);
  });

  it('processAndUploadFile saves to transaction_lines, not the legacy transactions collection', async () => {
    geminiReturns(makeExtractedData({ category: 'מגורים ובית' }));

    const result = await processAndUploadFile(makeFile(), 'token', vi.fn(), []);

    expect(result.success).toBe(true);
    const calls = (collection as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((args) => args[1] === 'transaction_lines')).toBe(true);
    expect(calls.some((args) => args[1] === 'transactions')).toBe(false);
  });
});
