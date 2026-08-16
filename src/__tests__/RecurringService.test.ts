// RecurringService — CRUD half (thin wiring over createOwnedCollectionRepo, Task 2) plus the
// bespoke local-first catch-up posting engine (Task 5). See task-5-brief.md and
// docs/superpowers/plans/2026-08-15-stage3-data-model.md D1/D3/D7 for the design rationale this
// suite is verifying against.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockList, mockSave, mockRemove, mockListMembers, mockBatchSet, mockBatchCommit, mockWriteAuditLog, mockCreateOwnedCollectionRepo, mockGetDoc } =
  vi.hoisted(() => ({
    mockList: vi.fn(),
    mockSave: vi.fn(),
    mockRemove: vi.fn(),
    mockListMembers: vi.fn(),
    mockBatchSet: vi.fn(),
    mockBatchCommit: vi.fn(async () => undefined),
    mockWriteAuditLog: vi.fn(),
    mockCreateOwnedCollectionRepo: vi.fn(),
    mockGetDoc: vi.fn(),
  }));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, ...segments: string[]) => `doc:${segments.join('/')}`),
  getDoc: mockGetDoc,
  writeBatch: vi.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit })),
}));
vi.mock('../services/financeCollections', () => ({
  createOwnedCollectionRepo: mockCreateOwnedCollectionRepo.mockImplementation(() => ({
    list: mockList,
    save: mockSave,
    remove: mockRemove,
  })),
}));
vi.mock('../services/MembersService', () => ({ listMembers: mockListMembers }));
vi.mock('../utils/auditLog', () => ({ writeAuditLog: mockWriteAuditLog }));

import {
  listRecurring,
  saveRecurring,
  deleteRecurring,
  postDueRecurringTransactions,
} from '../services/RecurringService';

const activeExpenseItem = {
  id: 'rec-1', kind: 'expense' as const, description: 'ארנונה', amount: 500, category: 'דיור',
  chargeDay: 10, status: 'active' as const, startDate: '2026-06-01', ownerId: 'david-levy',
  createdAt: 'x', updatedAt: 'x',
};

describe('RecurringService — CRUD half (thin wiring over createOwnedCollectionRepo)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('listRecurring delegates straight to the factory list(), scope and viewer passed through unchanged', async () => {
    mockList.mockResolvedValueOnce([activeExpenseItem]);
    await expect(listRecurring('own', 'omer-levy')).resolves.toEqual([activeExpenseItem]);
    expect(mockList).toHaveBeenCalledWith('own', 'omer-levy');
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('saveRecurring on EDIT (input.id provided, doc already exists) passes input through to the factory unchanged — no backfill-guard seeding on an existing item', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true });
    mockSave.mockResolvedValueOnce(activeExpenseItem);
    const input = { id: 'rec-1', kind: 'expense' as const, description: 'x', amount: 1, chargeDay: 1, status: 'active' as const, startDate: '2026-01-01', ownerId: 'david-levy' };
    await expect(saveRecurring(input, 'david-levy')).resolves.toEqual(activeExpenseItem);
    expect(mockGetDoc).toHaveBeenCalledWith('doc:recurring/rec-1');
    expect(mockSave).toHaveBeenCalledWith(input, 'david-levy');
  });

  it('saveRecurring on CREATE (no id) seeds lastPostedPeriod to the period before today — unbounded-backfill guard, and never touches Firestore to decide (no id to look up)', async () => {
    mockSave.mockImplementationOnce(async (input) => ({ ...input, id: 'auto-1', createdAt: 'x', updatedAt: 'x' }));
    const input = { kind: 'expense' as const, description: 'שכירות', amount: 4000, chargeDay: 10, status: 'active' as const, startDate: '2021-01-01', ownerId: 'david-levy' };
    await saveRecurring(input, 'david-levy');
    expect(mockSave).toHaveBeenCalledWith({ ...input, lastPostedPeriod: '2026-07' }, 'david-levy');
    expect(mockGetDoc).not.toHaveBeenCalled();
  });

  it('saveRecurring on CREATE WITH a caller-supplied id and no explicit lastPostedPeriod also seeds — closes the create-with-id seeding bypass (factory treats id-with-no-existing-doc as create too, per financeCollections.ts save())', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false }); // no doc yet for this client-generated id
    mockSave.mockImplementationOnce(async (input) => ({ ...input, createdAt: 'x', updatedAt: 'x' }));
    const input = {
      id: 'client-generated-id', kind: 'expense' as const, description: 'שכירות', amount: 4000, chargeDay: 10,
      status: 'active' as const, startDate: '2021-01-01', ownerId: 'david-levy',
    };
    await saveRecurring(input, 'david-levy');
    expect(mockGetDoc).toHaveBeenCalledWith('doc:recurring/client-generated-id');
    expect(mockSave).toHaveBeenCalledWith({ ...input, lastPostedPeriod: '2026-07' }, 'david-levy');
  });

  it('saveRecurring does NOT override an explicitly-provided lastPostedPeriod, on CREATE or EDIT, WITH or WITHOUT an id — the explicit-backfill path, and skips the existence read entirely since it is decisive on its own', async () => {
    mockSave.mockImplementationOnce(async (input) => ({ ...input, id: 'auto-1', createdAt: 'x', updatedAt: 'x' }));
    const input = {
      kind: 'expense' as const, description: 'שכירות', amount: 4000, chargeDay: 10, status: 'active' as const,
      startDate: '2021-01-01', ownerId: 'david-levy', lastPostedPeriod: '2021-01',
    };
    await saveRecurring(input, 'david-levy');
    expect(mockSave).toHaveBeenCalledWith(input, 'david-levy'); // untouched — caller's explicit value wins
    expect(mockGetDoc).not.toHaveBeenCalled();

    mockSave.mockResolvedValueOnce(activeExpenseItem);
    const inputWithId = { ...input, id: 'client-generated-id' };
    await saveRecurring(inputWithId, 'david-levy');
    expect(mockSave).toHaveBeenCalledWith(inputWithId, 'david-levy');
    expect(mockGetDoc).not.toHaveBeenCalled(); // still never consulted — explicit value short-circuits before any id check
  });

  it('deleteRecurring delegates straight to the factory remove()', async () => {
    await deleteRecurring('rec-1', 'david-levy');
    expect(mockRemove).toHaveBeenCalledWith('rec-1', 'david-levy');
  });
});

describe('saveRecurring + postDueRecurringTransactions integration — the backfill guard actually prevents a multi-decade catch-up', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('creating an item with a years-old startDate (2021) then running catch-up posts only the current period, not dozens of missed ones', async () => {
    mockSave.mockImplementationOnce(async (input) => ({ ...input, id: 'rec-old-rent', createdAt: 'x', updatedAt: 'x' }));
    const created = await saveRecurring(
      { kind: 'expense', description: 'שכירות', amount: 4000, chargeDay: 10, status: 'active', startDate: '2021-01-01', ownerId: 'david-levy' },
      'david-levy'
    );
    expect(created.lastPostedPeriod).toBe('2026-07'); // seeded, not undefined

    mockList.mockResolvedValueOnce([created]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);

    const result = await postDueRecurringTransactions('david-levy', 'family', new Date('2026-08-15'));

    expect(result.posted).toEqual([{ recurringId: 'rec-old-rent', period: '2026-08' }]);
    expect(result.failed).toEqual([]);
  });
});

describe('postDueRecurringTransactions', () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the caller's scope through to listRecurring, not always 'family' (D1 — the fix for the live member-role catch-up gap)", async () => {
    mockList.mockResolvedValueOnce([]); // listRecurring
    mockListMembers.mockResolvedValueOnce([]); // listMembers
    await postDueRecurringTransactions('omer-levy', 'own', new Date('2026-08-15'));
    expect(mockList).toHaveBeenCalledWith('own', 'omer-levy');
  });

  it('posts a due expense item into transaction_lines with the owner resolved to a display name, and advances lastPostedPeriod', async () => {
    mockList.mockResolvedValueOnce([{ ...activeExpenseItem, lastPostedPeriod: '2026-07' }]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);

    const result = await postDueRecurringTransactions('david-levy', 'family', new Date('2026-08-15'));

    expect(result.posted).toEqual([{ recurringId: 'rec-1', period: '2026-08' }]);
    expect(result.failed).toEqual([]);
    expect(mockBatchSet).toHaveBeenCalledWith(
      'doc:transaction_lines/rec-1__2026-08',
      expect.objectContaining({
        owner: 'דויד', amount: 500, date: '2026-08-10', recurringId: 'rec-1', recurringPeriod: '2026-08',
        isCredit: false, category: 'דיור', expenseClassification: 'Fixed',
      })
    );
    expect(mockBatchSet).toHaveBeenCalledWith(
      'doc:recurring/rec-1',
      { lastPostedPeriod: '2026-08', updatedAt: expect.any(String) },
      { merge: true }
    );
  });

  it('posts a due income item into incomes without an owner field', async () => {
    mockList.mockResolvedValueOnce([{
      id: 'rec-2', kind: 'income', description: 'משכורת', amount: 12000, chargeDay: 1,
      status: 'active', startDate: '2026-08-01', ownerId: 'lilit-levy', createdAt: 'x', updatedAt: 'x',
    }]);
    mockListMembers.mockResolvedValueOnce([{ id: 'lilit-levy', name: 'לילית' }]);

    const result = await postDueRecurringTransactions('lilit-levy', 'family', new Date('2026-08-15'));

    expect(result.posted).toEqual([{ recurringId: 'rec-2', period: '2026-08' }]);
    expect(mockBatchSet).toHaveBeenCalledWith(
      'doc:incomes/rec-2__2026-08',
      expect.objectContaining({ name: 'משכורת', amount: 12000, month: '08', year: '2026' })
    );
    const incomeCall = mockBatchSet.mock.calls.find((c) => c[0] === 'doc:incomes/rec-2__2026-08');
    expect(incomeCall![1]).not.toHaveProperty('owner');
  });

  it('skips an item with nothing due — no batch commit at all for it', async () => {
    mockList.mockResolvedValueOnce([{ ...activeExpenseItem, chargeDay: 25, lastPostedPeriod: '2026-08' }]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);
    const result = await postDueRecurringTransactions('david-levy', 'family', new Date('2026-08-15'));
    expect(result.posted).toEqual([]);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('one item failing (unresolvable owner) does not block posting for the others', async () => {
    mockList.mockResolvedValueOnce([
      { ...activeExpenseItem, id: 'rec-ghost', ownerId: 'no-such-member', lastPostedPeriod: '2026-07' },
      { ...activeExpenseItem, id: 'rec-ok', lastPostedPeriod: '2026-07' },
    ]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);

    const result = await postDueRecurringTransactions('david-levy', 'family', new Date('2026-08-15'));

    expect(result.failed).toEqual([{ recurringId: 'rec-ghost', error: expect.stringContaining('no-such-member') }]);
    expect(result.posted).toEqual([{ recurringId: 'rec-ok', period: '2026-08' }]);
  });

  it('a failure reading the inputs themselves is returned as a single failure, never thrown', async () => {
    mockList.mockRejectedValueOnce(new Error('permission-denied'));
    const result = await postDueRecurringTransactions('david-levy', 'family', new Date('2026-08-15'));
    expect(result.failed).toEqual([{ recurringId: '(all)', error: 'permission-denied' }]);
    expect(result.posted).toEqual([]);
  });

  it('a failed listMembers() call also surfaces as a single "(all)" failure, never thrown, never a partial state', async () => {
    mockList.mockResolvedValueOnce([{ ...activeExpenseItem, lastPostedPeriod: '2026-07' }]);
    mockListMembers.mockRejectedValueOnce(new Error('members-read-down'));
    const result = await postDueRecurringTransactions('david-levy', 'family', new Date('2026-08-15'));
    expect(result.failed).toEqual([{ recurringId: '(all)', error: 'members-read-down' }]);
    expect(result.posted).toEqual([]);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('a batch.commit() failure for one item is isolated to that item — no partial posted/failed mismatch, others still post', async () => {
    mockList.mockResolvedValueOnce([
      { ...activeExpenseItem, id: 'rec-fails', lastPostedPeriod: '2026-07' },
      { ...activeExpenseItem, id: 'rec-ok', lastPostedPeriod: '2026-07' },
    ]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);
    mockBatchCommit.mockRejectedValueOnce(new Error('commit-failed'));

    const result = await postDueRecurringTransactions('david-levy', 'family', new Date('2026-08-15'));

    expect(result.failed).toEqual([{ recurringId: 'rec-fails', error: 'commit-failed' }]);
    expect(result.posted).toEqual([{ recurringId: 'rec-ok', period: '2026-08' }]);
  });

  it('writes an audit_log entry per posted period, in the same batch', async () => {
    mockList.mockResolvedValueOnce([{ ...activeExpenseItem, lastPostedPeriod: '2026-07' }]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);
    await postDueRecurringTransactions('david-levy', 'family', new Date('2026-08-15'));
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorMemberId: 'david-levy', action: 'recurring.autopost', target: 'recurring/rec-1' })
    );
  });

  it('catches up multiple missed periods for one item in a SINGLE batch/commit', async () => {
    mockList.mockResolvedValueOnce([{ ...activeExpenseItem, lastPostedPeriod: '2026-05' }]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);
    const result = await postDueRecurringTransactions('david-levy', 'family', new Date('2026-08-15'));
    expect(result.posted.map((p) => p.period)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    // exactly one audit_log entry per posted period, all in the same batch
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(3);
  });

  it('two items each with due periods commit two separate batches, one per item, and both fully post', async () => {
    mockList.mockResolvedValueOnce([
      { ...activeExpenseItem, id: 'rec-a', lastPostedPeriod: '2026-07' },
      { ...activeExpenseItem, id: 'rec-b', lastPostedPeriod: '2026-07' },
    ]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);
    const result = await postDueRecurringTransactions('david-levy', 'family', new Date('2026-08-15'));
    expect(result.posted).toEqual([
      { recurringId: 'rec-a', period: '2026-08' },
      { recurringId: 'rec-b', period: '2026-08' },
    ]);
    expect(mockBatchCommit).toHaveBeenCalledTimes(2);
  });

  it('chargeDay 31 posted into February clamps the stamped date to the month\'s actual last day (bank standing-order semantics, Task 4 review ruling) — never an invalid "2026-02-31"', async () => {
    // 2026 is not a leap year, so February's last real day is the 28th. This period is
    // fully-elapsed (today is in March), so it's due unconditionally regardless of chargeDay —
    // exercising clamping on the "past period" branch, not just the current-period gate.
    mockList.mockResolvedValueOnce([{
      ...activeExpenseItem, id: 'rec-feb31', chargeDay: 31,
      startDate: '2026-01-01', lastPostedPeriod: '2026-01',
    }]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);

    const result = await postDueRecurringTransactions('david-levy', 'family', new Date('2026-03-05'));

    expect(result.posted).toEqual([{ recurringId: 'rec-feb31', period: '2026-02' }]);
    expect(mockBatchSet).toHaveBeenCalledWith(
      'doc:transaction_lines/rec-feb31__2026-02',
      expect.objectContaining({ date: '2026-02-28' })
    );
  });

  it('a paused item never contributes a batch, even if list() also returns due items', async () => {
    mockList.mockResolvedValueOnce([
      { ...activeExpenseItem, id: 'rec-paused', status: 'paused', lastPostedPeriod: '2026-07' },
      { ...activeExpenseItem, id: 'rec-ok', lastPostedPeriod: '2026-07' },
    ]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);
    const result = await postDueRecurringTransactions('david-levy', 'family', new Date('2026-08-15'));
    expect(result.posted).toEqual([{ recurringId: 'rec-ok', period: '2026-08' }]);
    expect(result.failed).toEqual([]);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});

describe('double-post regression (closes "double-post proven only indirectly" review gap — the class of bug the lastPostedPeriod bump + deterministic id together are meant to prevent)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a second catch-up run is a no-op once lastPostedPeriod has advanced to exactly where the first run\'s batch would have left it — no double-post', async () => {
    // First run: one period behind, gets posted.
    mockList.mockResolvedValueOnce([{ ...activeExpenseItem, lastPostedPeriod: '2026-07' }]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);
    const first = await postDueRecurringTransactions('david-levy', 'family', new Date('2026-08-15'));
    expect(first.posted).toEqual([{ recurringId: 'rec-1', period: '2026-08' }]);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);

    // Second run: lastPostedPeriod now reads '2026-08', exactly as the first run's SAME-batch bump
    // would have left it in real Firestore (this is what "same batch" in the module doc comment is
    // for) — nothing should be due, and no new batch should even be opened for this item.
    mockList.mockResolvedValueOnce([{ ...activeExpenseItem, lastPostedPeriod: '2026-08' }]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);
    const second = await postDueRecurringTransactions('david-levy', 'family', new Date('2026-08-15'));
    expect(second.posted).toEqual([]);
    expect(second.failed).toEqual([]);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1); // unchanged from the first run — no second commit
  });

  it('re-running catch-up against a lastPostedPeriod that did NOT advance (simulating a re-run of the same prior state) posts to the IDENTICAL deterministic doc id both times, so the second write overwrites rather than duplicating the financial row', async () => {
    mockList.mockResolvedValueOnce([{ ...activeExpenseItem, lastPostedPeriod: '2026-07' }]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);
    await postDueRecurringTransactions('david-levy', 'family', new Date('2026-08-15'));
    const firstRunDocIds = mockBatchSet.mock.calls
      .map((c) => c[0])
      .filter((id) => typeof id === 'string' && id.startsWith('doc:transaction_lines/'));
    expect(firstRunDocIds).toEqual(['doc:transaction_lines/rec-1__2026-08']);

    mockBatchSet.mockClear();

    // Same lastPostedPeriod as BEFORE the first run — i.e. the state didn't advance. This can't
    // happen mid-batch (WriteBatch.commit() is all-or-nothing, per the module doc comment), but it
    // is exactly what a second session's stale read would see if it ran concurrently with the
    // first, before the first's commit landed.
    mockList.mockResolvedValueOnce([{ ...activeExpenseItem, lastPostedPeriod: '2026-07' }]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);
    await postDueRecurringTransactions('david-levy', 'family', new Date('2026-08-15'));
    const secondRunDocIds = mockBatchSet.mock.calls
      .map((c) => c[0])
      .filter((id) => typeof id === 'string' && id.startsWith('doc:transaction_lines/'));
    expect(secondRunDocIds).toEqual(firstRunDocIds); // identical id -> Firestore overwrite, never a duplicate row
  });
});
