import { describe, expect, it } from 'vitest';
import { migrateLegacyTransaction } from '../utils/migrateLegacyTransaction';

describe('migrateLegacyTransaction', () => {
  it('converts an English category to its Hebrew canonical value', () => {
    const { line, warnings } = migrateLegacyTransaction(
      { date: '2026-03-15', amount: 250, category: 'Housing_Utilities', description: 'חשמל', owner: 'דויד' },
      'legacy-1'
    );
    expect(line.category).toBe('מגורים ובית');
    expect(line.legacyId).toBe('legacy-1');
    expect(line.migratedAt).toBeTypeOf('string');
    expect(warnings).toEqual([]);
  });

  it('keeps an already-Hebrew category as-is', () => {
    const { line, warnings } = migrateLegacyTransaction(
      { date: '2026-03-15', amount: 100, category: 'בריאות', description: 'קופת חולים', owner: 'לילית' },
      'legacy-2'
    );
    expect(line.category).toBe('בריאות');
    expect(warnings).toEqual([]);
  });

  it('maps an unknown category to שונות with a warning, never drops the row', () => {
    const { line, warnings } = migrateLegacyTransaction(
      { date: '2026-03-15', amount: 50, category: 'Mystery_Key', description: '?', owner: 'דויד' },
      'legacy-3'
    );
    expect(line.category).toBe('שונות');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Mystery_Key');
  });

  it('preserves amount, date, owner, description and vendor verbatim', () => {
    const legacy = {
      date: '2026-01-02',
      amount: 99.9,
      category: 'General_Misc',
      description: 'בדיקה',
      owner: 'עומר',
      vendor: 'שופרסל',
    };
    const { line } = migrateLegacyTransaction(legacy, 'legacy-4');
    expect(line.amount).toBe(99.9);
    expect(line.date).toBe('2026-01-02');
    expect(line.owner).toBe('עומר');
    expect(line.description).toBe('בדיקה');
    expect(line.vendor).toBe('שופרסל');
  });

  it('preserves additional legacy-only fields verbatim (driveFileId, sourceDriveFileId, isCredit, paymentType)', () => {
    const legacy = {
      date: '2026-02-01',
      amount: 500,
      category: 'Transportation',
      description: 'דלק',
      owner: 'דויד',
      vendor: 'פז',
      isCredit: false,
      paymentType: 'one_time',
      driveFileId: 'drive-abc',
      sourceDriveFileId: 'drive-src-abc',
      syncFolderId: 'folder-1',
    };
    const { line } = migrateLegacyTransaction(legacy, 'legacy-5');
    expect(line.isCredit).toBe(false);
    expect(line.paymentType).toBe('one_time');
    expect(line.driveFileId).toBe('drive-abc');
    expect(line.sourceDriveFileId).toBe('drive-src-abc');
    expect(line.syncFolderId).toBe('folder-1');
  });

  it('is idempotent: the same legacy id always produces the same legacyId-derived shape', () => {
    const legacy = { date: '2026-01-02', amount: 10, category: 'Health', description: 'x', owner: 'a' };
    const first = migrateLegacyTransaction(legacy, 'legacy-6');
    const second = migrateLegacyTransaction(legacy, 'legacy-6');
    expect(first.line.legacyId).toBe(second.line.legacyId);
    expect(first.line.category).toBe(second.line.category);
  });

  it('handles a missing category by falling back to שונות with a warning', () => {
    const { line, warnings } = migrateLegacyTransaction(
      { date: '2026-03-15', amount: 20, description: 'no category', owner: 'דויד' },
      'legacy-7'
    );
    expect(line.category).toBe('שונות');
    expect(warnings).toHaveLength(1);
  });
});
