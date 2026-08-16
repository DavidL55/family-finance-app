// Gap 2 (regression coverage, post-Stage-5 review): `lastPostedPeriod` preservation across
// RecurringScreen's edit form AND both status quick-actions ("השהה"/"הפעל מחדש").
//
// RecurringScreen.test.tsx already pins, at the SCREEN layer, that saveRecurring is called with no
// `lastPostedPeriod` key in the payload for all three paths (edit-save, pause, resume) — but that
// file mocks '../services/RecurringService' entirely, so it can only prove what the screen SENDS,
// never what actually reaches the stored document. financeCollections.test.ts separately pins, at
// the FACTORY layer, that an `undefined`/absent key on `save()`'s input leaves the stored value
// untouched — but with a generic `Widget` fixture, never through the real RecurringService.
// RecurringService.test.ts (not touched here) separately pins saveRecurring's own
// unbounded-backfill guard in isolation, mocking the factory's `repo.save` directly.
//
// Three separate mock layers, three separate tests — none of them exercises the REAL, un-mocked
// chain the app actually runs at click time: RecurringScreen -> saveRecurring (RecurringService.ts,
// its own create-vs-edit `getDoc` check) -> repo.save (financeCollections.ts's fetch-then-merge
// runTransaction). This file stitches that real chain together, mocking ONLY 'firebase/firestore'
// itself (same low-level mock shape financeCollections.test.ts uses) plus this screen's usual
// non-Firestore collaborators (CategoriesService, FilterContext, NavigationContext) — never
// '../services/RecurringService' and never '../services/financeCollections'.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RecurringScreen from '../components/RecurringScreen';

const {
  mockGetDocs, mockGetDoc, mockTxGet, mockTxSet, mockRunTransaction, mockWriteBatch,
} = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockGetDoc: vi.fn(),
  mockTxGet: vi.fn(),
  mockTxSet: vi.fn(),
  mockRunTransaction: vi.fn(),
  mockWriteBatch: vi.fn(() => ({ set: vi.fn(), delete: vi.fn(), commit: vi.fn(async () => undefined) })),
}));

vi.mock('../services/firebase', () => ({ db: {} }));
// Same mock shape as financeCollections.test.ts (collection()/doc() carrying the collection name
// via a synthetic `__col` field), extended with `getDoc` and `writeBatch` — the two additional
// firebase/firestore exports RecurringService.ts itself imports directly (getDoc for its own
// create-vs-edit check; writeBatch only used by postDueRecurringTransactions, never called by this
// screen, but the module-level import still needs a stub to resolve).
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => ({ __col: name })),
  doc: vi.fn((...args: unknown[]) => {
    if (args.length === 1) return { id: 'auto-id-1' };
    const [first, ...rest] = args as [unknown, ...string[]];
    const segments =
      typeof first === 'object' && first !== null && '__col' in first
        ? [(first as { __col: string }).__col, ...rest]
        : rest;
    return `doc:${segments.join('/')}`;
  }),
  query: vi.fn((colRef: { __col: string }, ...clauses: unknown[]) => ({ __col: colRef.__col, __clauses: clauses })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  getDocs: mockGetDocs,
  getDoc: mockGetDoc,
  writeBatch: mockWriteBatch,
  runTransaction: mockRunTransaction.mockImplementation(async (_db: unknown, updateFn: (tx: unknown) => unknown) => {
    const tx = { get: mockTxGet, set: mockTxSet, delete: vi.fn() };
    return updateFn(tx);
  }),
}));

// RecurringService.ts imports listMembers (MembersService) at module scope for
// postDueRecurringTransactions — never invoked by anything this file exercises (only save/edit
// paths), but the import must still resolve.
vi.mock('../services/MembersService', () => ({ listMembers: vi.fn(async () => []) }));

const { mockGetCategories } = vi.hoisted(() => ({ mockGetCategories: vi.fn() }));
vi.mock('../services/CategoriesService', () => ({ getCategories: mockGetCategories }));

const { mockSetLeaveGuard } = vi.hoisted(() => ({ mockSetLeaveGuard: vi.fn() }));
vi.mock('../contexts/NavigationContext', () => ({
  useNavigation: () => ({
    navigationPayload: null,
    consumePayload: vi.fn(),
    setLeaveGuard: mockSetLeaveGuard,
  }),
}));

const FAMILY_MEMBERS = [
  { id: 'david-levy', name: 'דויד', color: '#111', role: 'הורה', groups: [], createdAt: 'x', updatedAt: 'x' },
] as any[];

vi.mock('../contexts/FilterContext', () => ({
  useGlobalFilters: () => ({
    filters: { member: { mode: 'all', memberIds: [], groupId: null }, category: { categories: [] } },
    groups: { status: 'ready', groups: [] },
    familyMembers: { status: 'ready', members: FAMILY_MEMBERS, error: null, reload: vi.fn() },
  }),
}));

// Stored doc shape — the raw record `getDocs`/`tx.get` hand back, exactly as
// financeCollections.ts's save() sees it (RAW stored doc, not narrowed to RecurringItem).
const STORED_RECORD = {
  id: 'r1',
  ownerId: 'david-levy',
  kind: 'expense',
  description: 'ארנונה',
  amount: 800,
  category: 'דיור',
  chargeDay: 10,
  status: 'active',
  startDate: '2025-01-01',
  lastPostedPeriod: '2026-07',
  createdAt: 'c',
  updatedAt: 'c',
};

function writtenRecurringRecord(): Record<string, unknown> {
  const call = mockTxSet.mock.calls.find(([ref]) => String(ref).startsWith('doc:recurring/'));
  if (!call) throw new Error('tx.set was never called for the recurring/ doc — save() did not run as expected');
  return call[1] as Record<string, unknown>;
}

describe('RecurringScreen -> saveRecurring -> financeCollections.save() (Gap 2, real chain, only firebase/firestore mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCategories.mockResolvedValue(['דיור']);
    // saveRecurring's own create-vs-edit probe (a plain getDoc, not tx.get) — the item already
    // exists in every scenario below (an edit/quick-action on an existing item, never a create).
    mockGetDoc.mockResolvedValue({ exists: () => true });
    // financeCollections.save()'s fetch-then-merge read, INSIDE the transaction — the actual
    // stored doc that must survive the merge.
    mockTxGet.mockResolvedValue({ exists: () => true, data: () => ({ ...STORED_RECORD }) });
  });

  it('editing the item (amount change only) writes a record whose lastPostedPeriod still matches the stored value, through the real saveRecurring + factory merge', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [{ data: () => ({ ...STORED_RECORD }) }] });
    render(
      <RecurringScreen
        session={{ memberId: 'david-levy', role: 'super-admin' }}
        recurringViewLevel="family"
        recurringEditLevel="family"
        lastCatchupOutcome={null}
      />
    );
    await waitFor(() => screen.getByText('ארנונה'));
    fireEvent.click(screen.getByText('עריכה'));
    fireEvent.change(screen.getByLabelText('סכום'), { target: { value: '850' } });
    fireEvent.click(screen.getByText('שמור'));

    await waitFor(() => expect(mockTxSet).toHaveBeenCalled());
    const written = writtenRecurringRecord();
    expect(written.lastPostedPeriod).toBe('2026-07'); // survived the edit, untouched
    expect(written.amount).toBe(850); // the edit itself really landed — not a no-op save
  });

  it('the "השהה" (pause) quick-action writes a record whose lastPostedPeriod still matches the stored value', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [{ data: () => ({ ...STORED_RECORD }) }] });
    render(
      <RecurringScreen
        session={{ memberId: 'david-levy', role: 'super-admin' }}
        recurringViewLevel="family"
        recurringEditLevel="family"
        lastCatchupOutcome={null}
      />
    );
    await waitFor(() => screen.getByText('ארנונה'));
    fireEvent.click(screen.getByText('השהה'));

    await waitFor(() => expect(mockTxSet).toHaveBeenCalled());
    const written = writtenRecurringRecord();
    expect(written.lastPostedPeriod).toBe('2026-07');
    expect(written.status).toBe('paused'); // the quick-action itself really landed
  });

  it('the "הפעל מחדש" (resume) quick-action writes a record whose lastPostedPeriod still matches the stored value', async () => {
    const pausedStored = { ...STORED_RECORD, status: 'paused' };
    mockGetDocs.mockResolvedValueOnce({ docs: [{ data: () => ({ ...pausedStored }) }] });
    mockTxGet.mockResolvedValue({ exists: () => true, data: () => ({ ...pausedStored }) });
    render(
      <RecurringScreen
        session={{ memberId: 'david-levy', role: 'super-admin' }}
        recurringViewLevel="family"
        recurringEditLevel="family"
        lastCatchupOutcome={null}
      />
    );
    await waitFor(() => screen.getByText('ארנונה'));
    fireEvent.click(screen.getByText('הפעל מחדש'));

    await waitFor(() => expect(mockTxSet).toHaveBeenCalled());
    const written = writtenRecurringRecord();
    expect(written.lastPostedPeriod).toBe('2026-07');
    expect(written.status).toBe('active');
  });
});
