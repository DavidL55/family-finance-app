import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted runs before vi.mock factories — the only safe way to share
// mock references between the factory and individual test assertions.
// (Same pattern as FileProcessor.test.ts.)
const { mockGetDocs, mockGetDoc, mockBatchSet, mockBatchDelete, mockBatchCommit } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockGetDoc: vi.fn(),
  mockBatchSet: vi.fn(),
  mockBatchDelete: vi.fn(),
  mockBatchCommit: vi.fn(async () => undefined),
}));

vi.mock('../services/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => `col:${name}`),
  doc: vi.fn((_db, ...segments: string[]) => `doc:${segments.join('/')}`),
  getDocs: mockGetDocs,
  getDoc: mockGetDoc,
  writeBatch: vi.fn(() => ({ set: mockBatchSet, delete: mockBatchDelete, commit: mockBatchCommit })),
}));

import {
  DEFAULT_MEMBER_SEED,
  MEMBER_COLORS,
  StaleMembersError,
  ensureSeeded,
  getMember,
  listMembers,
  saveMembers,
  seedFromBudgetConfig,
} from '../services/MembersService';

describe('seedFromBudgetConfig', () => {
  it('converts the legacy array to Member docs with defaults', () => {
    const members = seedFromBudgetConfig({
      members: [
        { id: 'm1', name: 'דויד', role: 'הורה' },
        { id: 'm2', name: 'עומר', role: 'ילד', idNumber: '123' },
      ],
    });
    expect(members).toHaveLength(2);
    expect(members[0]).toMatchObject({ id: 'm1', name: 'דויד', role: 'הורה', groups: [] });
    expect(members[0].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(members[1].idNumber).toBe('123');
    expect(members[0].createdAt).toBeTypeOf('string');
    expect(members[0].updatedAt).toBeTypeOf('string');
    expect(members[0].uid).toBeUndefined();
    expect(members[0].resolvedPermissions).toBeUndefined();
  });

  it('assigns distinct colors to distinct members', () => {
    const members = seedFromBudgetConfig({
      members: [
        { id: 'a', name: 'א', role: 'הורה' },
        { id: 'b', name: 'ב', role: 'ילד' },
      ],
    });
    expect(members[0].color).not.toBe(members[1].color);
  });

  it('returns [] for malformed input instead of throwing', () => {
    expect(seedFromBudgetConfig(null)).toEqual([]);
    expect(seedFromBudgetConfig({})).toEqual([]);
    expect(seedFromBudgetConfig(undefined)).toEqual([]);
    expect(seedFromBudgetConfig('nope')).toEqual([]);
    expect(seedFromBudgetConfig({ members: 'not-an-array' })).toEqual([]);
  });

  it('never drops a member for a missing/invalid id — assigns a deterministic fallback instead', () => {
    const members = seedFromBudgetConfig({
      members: [
        { name: 'דויד', role: 'הורה' }, // no id at all
        { id: 42, name: 'עומר', role: 'ילד' }, // id wrong type
      ],
    });
    expect(members).toHaveLength(2);
    expect(members[0].id).toBeTypeOf('string');
    expect(members[0].id.length).toBeGreaterThan(0);
    expect(members[1].id).toBeTypeOf('string');
    expect(members[0].id).not.toBe(members[1].id);
  });

  it('never drops a member for an invalid role — defaults it instead of discarding the member', () => {
    const members = seedFromBudgetConfig({
      members: [{ id: 'x1', name: 'משהו', role: 'invalid-role' }],
    });
    expect(members).toHaveLength(1);
    expect(['הורה', 'ילד']).toContain(members[0].role);
  });

  it('drops only entries with no recoverable name (the one truly unrecoverable case)', () => {
    const members = seedFromBudgetConfig({
      members: [
        { id: 'ok', name: 'תקין', role: 'הורה' },
        { id: 'bad' }, // no name — nothing to identify this member by
        null,
        'not-an-object',
        42,
      ],
    });
    expect(members).toHaveLength(1);
    expect(members[0].id).toBe('ok');
  });

  it('is deterministic: same input yields same ids, names, roles and colors', () => {
    const input = {
      members: [
        { id: 'm1', name: 'דויד', role: 'הורה' },
        { id: 'm2', name: 'לילית', role: 'הורה' },
        { id: 'm3', name: 'עומר', role: 'ילד' },
      ],
    };
    const first = seedFromBudgetConfig(input);
    const second = seedFromBudgetConfig(input);
    const strip = (m: ReturnType<typeof seedFromBudgetConfig>[number]) => {
      const { createdAt: _c, updatedAt: _u, ...rest } = m;
      return rest;
    };
    expect(first.map(strip)).toEqual(second.map(strip));
  });

  it('supports up to 20 members with 20 distinct stable-palette colors', () => {
    const members = seedFromBudgetConfig({
      members: Array.from({ length: 20 }, (_, i) => ({
        id: `m${i}`,
        name: `member-${i}`,
        role: i % 2 === 0 ? 'הורה' : 'ילד',
      })),
    });
    expect(members).toHaveLength(20);
    const colors = new Set(members.map((m) => m.color));
    expect(colors.size).toBe(20);
    expect(MEMBER_COLORS).toHaveLength(20);
  });

  it('seeds the exact legacy defaults (דויד/לילית/עומר) when given the app default shape', () => {
    const members = seedFromBudgetConfig({ members: DEFAULT_MEMBER_SEED });
    expect(members.map((m) => m.name)).toEqual(['דויד', 'לילית', 'עומר']);
    expect(members.map((m) => m.id)).toEqual(['david-levy', 'lilit-levy', 'omer-levy']);
  });
});

describe('listMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the members collection and returns the documents', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [
        { data: () => ({ id: 'm1', name: 'דויד', role: 'הורה', color: '#111111', groups: [], createdAt: 'x', updatedAt: 'x' }) },
      ],
    });
    const members = await listMembers();
    expect(members).toHaveLength(1);
    expect(members[0].name).toBe('דויד');
  });

  it('propagates a query failure as a rejection — never swallows it into an empty array', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('emulator down'));
    await expect(listMembers()).rejects.toThrow('emulator down');
  });
});

describe('ensureSeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op when the members collection is already non-empty', async () => {
    mockGetDocs.mockResolvedValueOnce({ empty: false, docs: [] });
    await ensureSeeded();
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('seeds from settings/budgetConfig.members when the collection is empty and legacy data exists', async () => {
    mockGetDocs.mockResolvedValueOnce({ empty: true, docs: [] });
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ members: [{ id: 'm1', name: 'דויד', role: 'הורה' }] }),
    });
    await ensureSeeded();
    expect(mockBatchSet).toHaveBeenCalledTimes(1);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('falls back to the default דויד/לילית/עומר seed when settings/budgetConfig has no members', async () => {
    mockGetDocs.mockResolvedValueOnce({ empty: true, docs: [] });
    mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    await ensureSeeded();
    expect(mockBatchSet).toHaveBeenCalledTimes(3);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});

describe('getMember', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the member doc when it exists', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ id: 'm1', name: 'דויד', role: 'הורה', color: '#111111', groups: [], uid: 'auth-uid-1', createdAt: 'x', updatedAt: 'x' }),
    });
    const member = await getMember('m1');
    expect(member).toMatchObject({ id: 'm1', uid: 'auth-uid-1' });
  });

  it('returns null when the member does not exist (not an error)', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    const member = await getMember('missing');
    expect(member).toBeNull();
  });

  it('propagates a read failure as a rejection', async () => {
    mockGetDoc.mockRejectedValueOnce(new Error('emulator down'));
    await expect(getMember('m1')).rejects.toThrow('emulator down');
  });
});

describe('saveMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const existingDoc = (id: string, overrides: Partial<Record<string, unknown>> = {}) => ({
    id,
    data: () => ({
      id,
      name: 'existing',
      role: 'הורה',
      color: '#1F4E78',
      groups: [],
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      ...overrides,
    }),
  });

  it('persists a brand-new member with the first unused palette color, groups: [] and fresh timestamps', async () => {
    mockGetDocs.mockResolvedValueOnce({ empty: true, docs: [] });
    await saveMembers([{ id: 'new-1', name: 'חדש', role: 'ילד' }], []);

    expect(mockBatchSet).toHaveBeenCalledTimes(1);
    const written = mockBatchSet.mock.calls[0][1];
    expect(written).toMatchObject({ id: 'new-1', name: 'חדש', role: 'ילד', groups: [] });
    expect(written.color).toBe(MEMBER_COLORS[0]);
    expect(written.createdAt).toBeTypeOf('string');
    expect(written.updatedAt).toBeTypeOf('string');
    expect(mockBatchDelete).not.toHaveBeenCalled();
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('never reassigns an existing member color, groups or createdAt on edit — only name/role/idNumber/updatedAt change', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [existingDoc('m1', { name: 'ישן', color: '#17C3B2', groups: ['g1'] })],
    });

    await saveMembers([{ id: 'm1', name: 'שם חדש', role: 'ילד' }], ['m1']);

    const written = mockBatchSet.mock.calls[0][1];
    expect(written.color).toBe('#17C3B2'); // untouched
    expect(written.groups).toEqual(['g1']); // untouched
    expect(written.createdAt).toBe('2020-01-01T00:00:00.000Z'); // untouched
    expect(written.name).toBe('שם חדש'); // changed
    expect(written.role).toBe('ילד'); // changed
    expect(written.updatedAt).not.toBe('2020-01-01T00:00:00.000Z'); // bumped
  });

  it('picks a new member a color no existing member already has', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [existingDoc('m1', { color: MEMBER_COLORS[0] })],
    });

    await saveMembers(
      [
        { id: 'm1', name: 'existing', role: 'הורה' },
        { id: 'm2', name: 'new', role: 'ילד' },
      ],
      ['m1']
    );

    const newMemberWrite = mockBatchSet.mock.calls.find((call) => call[1].id === 'm2')![1];
    expect(newMemberWrite.color).not.toBe(MEMBER_COLORS[0]);
    expect(newMemberWrite.color).toBe(MEMBER_COLORS[1]);
  });

  it('deletes a member present in Firestore but absent from the incoming full list (mirrors the UI delete flow — no new destructive behavior)', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [existingDoc('keep'), existingDoc('remove')],
    });

    await saveMembers([{ id: 'keep', name: 'existing', role: 'הורה' }], ['keep', 'remove']);

    expect(mockBatchDelete).toHaveBeenCalledTimes(1);
    expect(mockBatchDelete).toHaveBeenCalledWith('doc:members/remove');
    expect(mockBatchSet).toHaveBeenCalledTimes(1);
  });

  it('falls back deterministically and warns instead of silently wrapping once the 20-color palette is exhausted', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const twentyExisting = MEMBER_COLORS.map((c, i) => existingDoc(`m${i}`, { color: c }));
    mockGetDocs.mockResolvedValueOnce({ empty: false, docs: twentyExisting });

    const edits = [
      ...twentyExisting.map((d) => ({ id: d.id, name: 'existing', role: 'הורה' as const })),
      { id: 'member-21', name: 'עודף', role: 'ילד' as const },
    ];
    await saveMembers(
      edits,
      twentyExisting.map((d) => d.id)
    );

    const overflowWrite = mockBatchSet.mock.calls.find((call) => call[1].id === 'member-21')![1];
    expect(MEMBER_COLORS).toContain(overflowWrite.color); // reused, not a novel/undefined value
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('palette exhausted'));
    warnSpy.mockRestore();
  });

  it('propagates a write failure as a rejection — never swallows a failed save into silence', async () => {
    mockGetDocs.mockResolvedValueOnce({ empty: true, docs: [] });
    mockBatchCommit.mockRejectedValueOnce(new Error('write denied'));

    await expect(saveMembers([{ id: 'x', name: 'x', role: 'הורה' }], [])).rejects.toThrow('write denied');
  });

  it('propagates a read failure (fetching existing members) as a rejection', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('emulator down'));
    await expect(saveMembers([{ id: 'x', name: 'x', role: 'הורה' }], [])).rejects.toThrow('emulator down');
  });

  // ── Optimistic concurrency: basedOnIds guards against a stale caller overwriting/deleting
  // members it never actually saw (the Critical data-loss defect this fix addresses). ────────

  it('CRITICAL: aborts and writes nothing when the callers basedOnIds is empty/stale but Firestore holds real members', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [existingDoc('m1'), existingDoc('m2'), existingDoc('m3')],
    });

    // Caller believed the collection was empty (e.g. a transient listMembers() failure that
    // left local state at []) and submits one new member against that stale/empty picture.
    await expect(
      saveMembers([{ id: 'new-1', name: 'חדש', role: 'ילד' }], [])
    ).rejects.toThrow(StaleMembersError);

    expect(mockBatchSet).not.toHaveBeenCalled();
    expect(mockBatchDelete).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('aborts and writes nothing when Firestore has a member the caller never saw (concurrent modification)', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [existingDoc('a'), existingDoc('b'), existingDoc('c')],
    });

    // Caller only ever saw a and b (c was added by someone else after the caller's last read).
    await expect(
      saveMembers(
        [
          { id: 'a', name: 'existing', role: 'הורה' },
          { id: 'b', name: 'existing', role: 'הורה' },
        ],
        ['a', 'b']
      )
    ).rejects.toThrow(StaleMembersError);

    expect(mockBatchSet).not.toHaveBeenCalled();
    expect(mockBatchDelete).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('a legitimate delete still succeeds: caller saw [a,b,c], submits [a,b] — c is deleted', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [existingDoc('a'), existingDoc('b'), existingDoc('c')],
    });

    await saveMembers(
      [
        { id: 'a', name: 'existing', role: 'הורה' },
        { id: 'b', name: 'existing', role: 'הורה' },
      ],
      ['a', 'b', 'c']
    );

    expect(mockBatchDelete).toHaveBeenCalledTimes(1);
    expect(mockBatchDelete).toHaveBeenCalledWith('doc:members/c');
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('a legitimate add still succeeds and gets the first unused color', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [existingDoc('a', { color: MEMBER_COLORS[0] })],
    });

    await saveMembers(
      [
        { id: 'a', name: 'existing', role: 'הורה' },
        { id: 'new-1', name: 'חדש', role: 'ילד' },
      ],
      ['a']
    );

    const newWrite = mockBatchSet.mock.calls.find((call) => call[1].id === 'new-1')![1];
    expect(newWrite.color).toBe(MEMBER_COLORS[1]);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('StaleMembersError carries the offending ids and a distinguishable name for callers to branch on', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [existingDoc('m1'), existingDoc('m2')],
    });

    try {
      await saveMembers([], []);
      throw new Error('expected saveMembers to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(StaleMembersError);
      expect((err as StaleMembersError).name).toBe('StaleMembersError');
      expect((err as StaleMembersError).staleIds.sort()).toEqual(['m1', 'm2']);
    }
  });
});
