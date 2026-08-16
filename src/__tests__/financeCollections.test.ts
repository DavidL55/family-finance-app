import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetDocs, mockGetDoc, mockBatchSet, mockBatchDelete, mockBatchCommit,
  mockTxGet, mockTxSet, mockTxDelete, mockRunTransaction,
} = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockGetDoc: vi.fn(),
  mockBatchSet: vi.fn(),
  mockBatchDelete: vi.fn(),
  mockBatchCommit: vi.fn(async () => undefined),
  mockTxGet: vi.fn(),
  mockTxSet: vi.fn(),
  mockTxDelete: vi.fn(),
  mockRunTransaction: vi.fn(),
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => ({ __col: name })),
  // Three real firebase/firestore `doc()` overloads used here: doc(db, name, id) (3 args) for a
  // known id, doc(collectionRef) (1 arg) for a fresh auto-id, and doc(collectionRef, id) (2 args,
  // used by auditLog.ts's writeAuditLog) — the collectionRef carries the collection name via its
  // mocked `__col` field, since the collection() mock never actually touches `db`.
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
  writeBatch: vi.fn(() => ({ set: mockBatchSet, delete: mockBatchDelete, commit: mockBatchCommit })),
  runTransaction: mockRunTransaction.mockImplementation(async (_db: unknown, updateFn: (tx: unknown) => unknown) => {
    const tx = { get: mockTxGet, set: mockTxSet, delete: mockTxDelete };
    return updateFn(tx);
  }),
}));

import { createOwnedCollectionRepo, type OwnedRecord } from '../services/financeCollections';
// Gap 3 (regression coverage, post-Stage-5 review): saveInsurance is a bare, unwrapped re-export
// of this same factory's save() (see InsurancesService.ts — no domain logic layered on top, unlike
// saveRecurring), so the real public entry point InsurancesScreen actually calls is exercised
// directly here, over the SAME mocked firebase/firestore module this file already sets up above —
// no separate/duplicate mock needed.
import { saveInsurance } from '../services/InsurancesService';

interface Widget extends OwnedRecord {
  name: string;
  amount: number;
  note?: string; // optional field, used to pin the save() undefined/null contract below
}

const { list, save, remove } = createOwnedCollectionRepo<Widget>('widgets', 'widget');

describe('createOwnedCollectionRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTxGet.mockResolvedValue({ exists: () => false });
  });

  // ── list() — D1 scope-aware query shape ──────────────────────────────────────
  it("list('own', viewerId) adds a where('ownerId','==',viewerId) clause", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    await list('own', 'omer-levy');
    const [queryArg] = mockGetDocs.mock.calls[0];
    expect(queryArg.__clauses).toEqual([{ field: 'ownerId', op: '==', value: 'omer-levy' }]);
  });

  it("list('family', viewerId) issues a bare, unfiltered collection scan (no where clause)", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    await list('family', 'omer-levy');
    const [arg] = mockGetDocs.mock.calls[0];
    expect(arg.__clauses).toBeUndefined(); // a bare CollectionReference, not a query() result
  });

  it('list() reads every doc in the named collection', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ id: 'w1', ownerId: 'omer-levy', name: 'X', amount: 10, createdAt: 'a', updatedAt: 'b' }) }],
    });
    const items = await list('family', 'viewer-x');
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('X');
  });

  it('list() propagates a read failure (never swallows into [])', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('down'));
    await expect(list('family', 'viewer-x')).rejects.toThrow('down');
  });

  // ── save() — D10 transactional rewrite ───────────────────────────────────────
  it('save() with no id creates a new doc inside runTransaction: fresh auto-id, createdAt===updatedAt, and an audit entry, atomically', async () => {
    const result = await save({ ownerId: 'omer-levy', name: 'New', amount: 5 }, 'david-levy');
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('auto-id-1');
    expect(result.createdAt).toBe(result.updatedAt);
    expect(mockTxSet).toHaveBeenCalledWith(
      'doc:widgets/auto-id-1',
      expect.objectContaining({ id: 'auto-id-1', ownerId: 'omer-levy', name: 'New', amount: 5 })
    );
    const auditCall = mockTxSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ actorMemberId: 'david-levy', action: 'widget.save', target: 'widgets/auto-id-1' });
    expect(mockTxSet).toHaveBeenCalledTimes(2); // the record + the audit entry, same transaction
    // No id given at all — brand new, no ambiguity to resolve — never reads inside the transaction.
    expect(mockTxGet).not.toHaveBeenCalled();
  });

  it('save() with an id that already exists PRESERVES createdAt (fetch-then-merge), reading the existing doc INSIDE the transaction, not before it', async () => {
    mockTxGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ id: 'w1', ownerId: 'omer-levy', name: 'Old', amount: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }),
    });
    const result = await save({ id: 'w1', ownerId: 'omer-levy', name: 'Renamed', amount: 2 }, 'david-levy');
    expect(mockTxGet).toHaveBeenCalledWith('doc:widgets/w1');
    expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
    expect(mockTxSet).toHaveBeenCalledWith(
      'doc:widgets/w1',
      expect.objectContaining({ name: 'Renamed', createdAt: '2026-01-01T00:00:00.000Z' })
    );
  });

  it('save() with an id that does NOT yet exist (a caller-supplied new id) treats it as brand-new — createdAt=now', async () => {
    mockTxGet.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    const result = await save({ id: 'w-new', ownerId: 'omer-levy', name: 'X', amount: 1 }, 'david-levy');
    expect(result.createdAt).toBe(result.updatedAt);
  });

  it('save() propagates a write failure (never silently drops the edit)', async () => {
    mockRunTransaction.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(save({ ownerId: 'omer-levy', name: 'X', amount: 1 }, 'david-levy')).rejects.toThrow('permission-denied');
  });

  // ── save() — ship-blocker fix: the undefined/null contract ───────────────────
  it('save() never writes an `undefined` value anywhere in the record — the original Firestore SDK crash this contract closes', async () => {
    // No `id` — a definite create, so save() never calls tx.get() (same optimization the no-id
    // create test above pins); no mockTxGet setup needed or consumed here.
    await save({ ownerId: 'omer-levy', name: 'New', amount: 5, note: undefined }, 'david-levy');
    const [, writtenRecord] = mockTxSet.mock.calls[0];
    expect(Object.values(writtenRecord as Record<string, unknown>)).not.toContain(undefined);
    expect(Object.prototype.hasOwnProperty.call(writtenRecord, 'note')).toBe(false);
  });

  it('save() strips an `undefined` optional field from the merged record — "not managed by this form", the existing stored value survives the edit', async () => {
    mockTxGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ id: 'w1', ownerId: 'omer-levy', name: 'Old', amount: 1, note: 'kept', createdAt: 'c', updatedAt: 'c' }),
    });
    const result = await save({ id: 'w1', ownerId: 'omer-levy', name: 'Renamed', amount: 2, note: undefined }, 'david-levy');
    expect(result.note).toBe('kept');
    expect(mockTxSet).toHaveBeenCalledWith('doc:widgets/w1', expect.objectContaining({ name: 'Renamed', note: 'kept' }));
  });

  it('save() with `null` on an optional field DELETES it from the merged record — "explicitly clear this field", never writes a literal `null`', async () => {
    mockTxGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ id: 'w1', ownerId: 'omer-levy', name: 'Old', amount: 1, note: 'kept', createdAt: 'c', updatedAt: 'c' }),
    });
    const result = await save({ id: 'w1', ownerId: 'omer-levy', name: 'Old', amount: 1, note: null }, 'david-levy');
    expect(result.note).toBeUndefined();
    const [, writtenRecord] = mockTxSet.mock.calls[0];
    expect(Object.prototype.hasOwnProperty.call(writtenRecord, 'note')).toBe(false);
    expect(Object.values(writtenRecord as Record<string, unknown>)).not.toContain(null);
  });

  // ── save() — Gap 1 (regression coverage, post-Stage-5 review): `null` on CREATE ──────────────
  // On a CREATE there is no stored document yet, so `delete merged[key]` for a `null` field is a
  // no-op on a key that was never there. Correct by inspection (the general "clear an existing
  // field" test above already pins the DELETE mechanics against a doc that has the field), but
  // this is the CREATE path specifically: no existing doc, so `mockTxGet` must never even be
  // consulted (asserted below) — this is the one case that pins tx.get is skipped entirely so a
  // CREATE-with-null can never accidentally depend on stale/absent mock data to "pass".
  it('save() on CREATE (no stored doc) with an optional field explicitly `null` succeeds: no crash, no literal `null`, and the field is simply absent from the written record', async () => {
    const result = await save({ ownerId: 'omer-levy', name: 'New', amount: 5, note: null }, 'david-levy');
    expect(mockTxGet).not.toHaveBeenCalled(); // no id at all — a definite create, never reads first
    expect(result.note).toBeUndefined();
    const [, writtenRecord] = mockTxSet.mock.calls[0];
    expect(Object.prototype.hasOwnProperty.call(writtenRecord, 'note')).toBe(false);
    expect(Object.values(writtenRecord as Record<string, unknown>)).not.toContain(null);
  });

  it('save() preserves a field stored on the doc but not declared on T (legacy/unknown data) across an edit that never mentions it', async () => {
    mockTxGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ id: 'w1', ownerId: 'omer-levy', name: 'Old', amount: 1, legacyField: 'from-an-older-screen', createdAt: 'c', updatedAt: 'c' }),
    });
    const result = await save({ id: 'w1', ownerId: 'omer-levy', name: 'Renamed', amount: 2 }, 'david-levy');
    expect((result as unknown as { legacyField: string }).legacyField).toBe('from-an-older-screen');
    expect(mockTxSet).toHaveBeenCalledWith('doc:widgets/w1', expect.objectContaining({ legacyField: 'from-an-older-screen' }));
  });

  // ── remove() — D10 transactional rewrite ─────────────────────────────────────
  it('remove() no-ops (no delete, no audit) if the doc is already gone inside the transaction', async () => {
    mockTxGet.mockResolvedValueOnce({ exists: () => false });
    await remove('ghost', 'david-levy');
    expect(mockTxDelete).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it('remove() deletes and writes a "widget.delete" audit entry atomically inside one transaction when the doc exists', async () => {
    mockTxGet.mockResolvedValueOnce({ exists: () => true, data: () => ({}) });
    await remove('w1', 'david-levy');
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxDelete).toHaveBeenCalledWith('doc:widgets/w1');
    expect(mockTxSet).toHaveBeenCalledTimes(1); // the audit entry
    const auditCall = mockTxSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ actorMemberId: 'david-levy', action: 'widget.delete', target: 'widgets/w1' });
  });

  it('remove() propagates a write failure (never silently drops the delete)', async () => {
    mockTxGet.mockResolvedValueOnce({ exists: () => true, data: () => ({}) });
    mockRunTransaction.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(remove('w1', 'david-levy')).rejects.toThrow('permission-denied');
  });
});

// ── Gap 3 (regression coverage, post-Stage-5 review): documentId survives an insurance edit ────
// Proven live against a Firestore emulator, but never pinned as a permanent test. InsurancesScreen
// (see its own module header comment) deliberately never sends `documentId` in its submit payload
// — not even `null` — specifically so an edit through this screen can never wipe a documentId some
// other path (FileProcessor.ts) may have set. Closed HERE, at the factory level, through the real
// `saveInsurance` (not a generic Widget stand-in) rather than a rules/emulator suite: saveInsurance
// is a bare, unwrapped re-export of createOwnedCollectionRepo's save() (InsurancesService.ts has
// zero logic of its own layered on top — unlike saveRecurring, which is why Gap 2 below needs a
// stitched integration test and this one doesn't), so a factory-level test that calls saveInsurance
// directly already exercises the exact function InsurancesScreen calls in production, with no
// intermediate layer that could diverge from what's tested. An emulator/rules-suite test would
// prove the same mechanism through strictly more moving parts (real network, real Rules
// evaluation) without pinning anything this test doesn't already pin deterministically and fast.
describe('saveInsurance — Gap 3: an undeclared/unsent stored field survives an edit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // mockReset (not just clearAllMocks, which only clears call history) — the last test in the
    // describe block above intentionally rejects runTransaction before its updateFn ever runs,
    // which leaves an UNCONSUMED mockTxGet.mockResolvedValueOnce() queued from that test; without
    // a full reset here that stale queued value would silently answer THIS describe's first tx.get
    // call instead of the one set below, corrupting exactly the merge-base data this test depends
    // on (caught by running this file: the test failed with `documentId` undefined before this
    // line was added).
    mockTxGet.mockReset();
    mockTxGet.mockResolvedValue({ exists: () => false });
  });

  it('saveInsurance preserves a stored `documentId` across an edit whose payload never mentions it (the form legitimately never sends it)', async () => {
    mockTxGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        id: 'ins1',
        ownerId: 'david-levy',
        type: 'car',
        provider: 'הראל',
        insuredMemberId: 'david-levy',
        premium: 300,
        premiumFrequency: 'monthly',
        coverages: [],
        renewalDate: '2026-01-01',
        status: 'active',
        documentId: 'doc-abc',
        createdAt: 'c',
        updatedAt: 'c',
      }),
    });
    const result = await saveInsurance(
      {
        id: 'ins1',
        ownerId: 'david-levy',
        type: 'car',
        provider: 'הראל החדשה', // the edit itself — proves this is a real edit, not a no-op save
        insuredMemberId: 'david-levy',
        premium: 350,
        premiumFrequency: 'monthly',
        coverages: [],
        renewalDate: '2026-01-01',
        status: 'active',
        // documentId deliberately absent — exactly what InsurancesScreen's real submit payload does.
      },
      'david-levy'
    );
    expect(result.documentId).toBe('doc-abc');
    expect(result.provider).toBe('הראל החדשה'); // the edit itself did land
    const [ref, writtenRecord] = mockTxSet.mock.calls.find(([r]) => String(r).startsWith('doc:insurances/'))!;
    expect(ref).toBe('doc:insurances/ins1');
    expect((writtenRecord as { documentId?: string }).documentId).toBe('doc-abc');
  });
});
