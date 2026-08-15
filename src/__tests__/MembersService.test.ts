import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted runs before vi.mock factories — the only safe way to share
// mock references between the factory and individual test assertions.
// (Same pattern as FileProcessor.test.ts.)
const { mockGetDocs, mockGetDoc, mockBatchSet, mockBatchCommit } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockGetDoc: vi.fn(),
  mockBatchSet: vi.fn(),
  mockBatchCommit: vi.fn(async () => undefined),
}));

vi.mock('../services/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => `col:${name}`),
  doc: vi.fn((_db, ...segments: string[]) => `doc:${segments.join('/')}`),
  getDocs: mockGetDocs,
  getDoc: mockGetDoc,
  writeBatch: vi.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit })),
}));

import {
  DEFAULT_MEMBER_SEED,
  MEMBER_COLORS,
  ensureSeeded,
  listMembers,
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
