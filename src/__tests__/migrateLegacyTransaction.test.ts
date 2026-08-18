import { describe, expect, it } from 'vitest';
import { migrateLegacyTransaction } from '../utils/migrateLegacyTransaction';

// Stage 7 T3 (D21e) — the member list is now a REQUIRED third argument rather than something the
// converter fetches, because its only non-test caller is an Admin-SDK script running under plain
// Node where `src/services/firebase.ts` cannot even be imported. Required, not optional: an
// optional list would let a caller that forgot it stamp every row `ownerId: 'unknown'` and stay
// green, which is precisely the silent-default class this task exists to close. T0's three real
// members, by their real display names.
const MEMBERS = [
  { id: 'david-levy', name: 'דויד' },
  { id: 'lilit-levy', name: 'לילית' },
  { id: 'omer-levy', name: 'עומר' },
];

describe('migrateLegacyTransaction', () => {
  it('converts an English category to its Hebrew canonical value', () => {
    const { line, warnings } = migrateLegacyTransaction(
      { date: '2026-03-15', amount: 250, category: 'Housing_Utilities', description: 'חשמל', owner: 'דויד' },
      'legacy-1', MEMBERS
    );
    expect(line.category).toBe('מגורים ובית');
    expect(line.legacyId).toBe('legacy-1');
    expect(line.migratedAt).toBeTypeOf('string');
    expect(warnings).toEqual([]);
  });

  it('keeps an already-Hebrew category as-is', () => {
    const { line, warnings } = migrateLegacyTransaction(
      { date: '2026-03-15', amount: 100, category: 'בריאות', description: 'קופת חולים', owner: 'לילית' },
      'legacy-2', MEMBERS
    );
    expect(line.category).toBe('בריאות');
    expect(warnings).toEqual([]);
  });

  it('maps an unknown category to שונות with a warning, never drops the row', () => {
    const { line, warnings } = migrateLegacyTransaction(
      { date: '2026-03-15', amount: 50, category: 'Mystery_Key', description: '?', owner: 'דויד' },
      'legacy-3', MEMBERS
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
    const { line } = migrateLegacyTransaction(legacy, 'legacy-4', MEMBERS);
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
    const { line } = migrateLegacyTransaction(legacy, 'legacy-5', MEMBERS);
    expect(line.isCredit).toBe(false);
    expect(line.paymentType).toBe('one_time');
    expect(line.driveFileId).toBe('drive-abc');
    expect(line.sourceDriveFileId).toBe('drive-src-abc');
    expect(line.syncFolderId).toBe('folder-1');
  });

  it('is idempotent: the same legacy id always produces the same legacyId-derived shape', () => {
    const legacy = { date: '2026-01-02', amount: 10, category: 'Health', description: 'x', owner: 'a' };
    const first = migrateLegacyTransaction(legacy, 'legacy-6', MEMBERS);
    const second = migrateLegacyTransaction(legacy, 'legacy-6', MEMBERS);
    expect(first.line.legacyId).toBe(second.line.legacyId);
    expect(first.line.category).toBe(second.line.category);
  });

  it('handles a missing category by falling back to שונות with a warning', () => {
    const { line, warnings } = migrateLegacyTransaction(
      { date: '2026-03-15', amount: 20, description: 'no category', owner: 'דויד' },
      'legacy-7', MEMBERS
    );
    expect(line.category).toBe('שונות');
    expect(warnings).toHaveLength(1);
  });

  it('treats a prototype-chain property name ("constructor") as an unknown category, never mangling the row', () => {
    const { line, warnings } = migrateLegacyTransaction(
      { date: '2026-03-15', amount: 30, category: 'constructor', description: 'evil', owner: 'דויד' },
      'legacy-8', MEMBERS
    );
    expect(line.category).toBe('שונות');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('constructor');
  });

  // ── Stage 7 T3 (D21e) — the fourth write site ────────────────────────────────────────────
  //
  // v2 called this "the one place that already constructs a row" and stamped ONLY here. It is
  // not: its single non-test caller is `scripts/migrate-transactions.ts`, and it converts the
  // LEGACY collection. The three live constructors do not pass through it, so stamping only here
  // would have left every row the app writes after this task with neither field — invisible to
  // `listTransactionHistory`, absent from the `'own'` query, and past the reach of a one-shot
  // completion marker. The other three sites have their own tests; this one is the fourth, not
  // the only.
  it('stamps period from the row date and ownerId from the owner name', () => {
    const { line } = migrateLegacyTransaction(
      { date: '2026-03-15', amount: 250, category: 'בריאות', owner: 'לילית' },
      'legacy-p1', MEMBERS
    );
    expect(line.period).toBe('2026-03');
    expect(line.ownerId).toBe('lilit-levy');
  });

  it('!! reads the LEGACY DD/MM/YYYY form correctly — the case a slice got silently wrong', () => {
    // `periodOfDateString` was `dateStr.slice(0, 7)`, which turns `"9/3/2026"` into `"9/3/202"` —
    // not a failure, a WRONG period, dropped by the `in` query and invisible to both the marker
    // and `unusableRowCount`. The legacy collection is exactly where that form lives.
    const { line } = migrateLegacyTransaction(
      { date: '9/3/2026', amount: 40, category: 'שונות', owner: 'עומר' },
      'legacy-p2', MEMBERS
    );
    expect(line.period).toBe('2026-03');
    expect(line.period).not.toBe('9/3/202');
  });

  it("stamps 'unknown' for an unreadable date and for an unresolvable owner, and still emits the row", () => {
    const { line } = migrateLegacyTransaction(
      { date: 'לא תאריך', amount: 10, category: 'שונות', owner: 'מישהו אחר' },
      'legacy-p3', MEMBERS
    );
    expect(line.period).toBe('unknown');
    expect(line.ownerId).toBe('unknown');
    // Never drops a row — the converter's own oldest contract.
    expect(line.amount).toBe(10);
  });

  it('!! the stamped fields WIN over anything the legacy row already carried', () => {
    // `line` is built `{ ...legacy, … }`, and a legacy document is free to carry any key. A stale
    // `period` surviving the spread would let a pre-Stage-7 row decide its own month.
    const { line } = migrateLegacyTransaction(
      { date: '2026-03-15', amount: 250, category: 'בריאות', owner: 'לילית', period: '1999-01', ownerId: 'nobody' },
      'legacy-p4', MEMBERS
    );
    expect(line.period).toBe('2026-03');
    expect(line.ownerId).toBe('lilit-levy');
  });

  it('stays deterministic in the two stamped fields — the property the caller derives doc ids from', () => {
    const legacy = { date: '2026-03-15', amount: 250, category: 'בריאות', owner: 'לילית' };
    const a = migrateLegacyTransaction(legacy, 'legacy-p5', MEMBERS).line;
    const b = migrateLegacyTransaction(legacy, 'legacy-p5', MEMBERS).line;
    expect(a.period).toBe(b.period);
    expect(a.ownerId).toBe(b.ownerId);
  });

  it('an empty member list stamps unknown rather than throwing — the script may run before members exist', () => {
    const { line } = migrateLegacyTransaction(
      { date: '2026-03-15', amount: 250, category: 'בריאות', owner: 'לילית' },
      'legacy-p6', []
    );
    expect(line.ownerId).toBe('unknown');
    expect(line.period).toBe('2026-03');
  });

  it('treats another prototype-chain property name ("toString") as an unknown category, never mangling the row', () => {
    const { line, warnings } = migrateLegacyTransaction(
      { date: '2026-03-15', amount: 30, category: 'toString', description: 'evil', owner: 'דויד' },
      'legacy-9', MEMBERS
    );
    expect(line.category).toBe('שונות');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('toString');
  });
});
