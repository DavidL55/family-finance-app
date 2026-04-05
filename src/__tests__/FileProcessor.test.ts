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

vi.mock('@google/genai', () => ({
  // GoogleGenAI is used as `new GoogleGenAI(...)` — must be a class.
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

// --- Static imports (resolved after mock hoisting) ---
import type { ExtractedData } from '../utils/FileProcessor';
import { CATEGORY_MAP, processAndUploadFile } from '../utils/FileProcessor';
import { getOrCreateFolder } from '../services/GoogleDriveService';
import { getDocs } from 'firebase/firestore';

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

function geminiReturns(data: ExtractedData) {
  mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(data) });
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
    const callback = vi.fn(async () => CATEGORY_MAP.Housing_Utilities);

    const result = await processAndUploadFile(makeFile(), 'token', vi.fn(), [], callback);

    expect(result.success).toBe(true);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ category: 'שונות' }));
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
