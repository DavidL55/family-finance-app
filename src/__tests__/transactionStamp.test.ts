// Stage 7 T3 — the two pure decisions every `transaction_lines`/`incomes` writer now makes:
// WHICH PERIOD a row belongs to, and WHICH MEMBER owns it.
//
// Both are shadowed by the corpus and can only be held by synthetic input. T0 measured the real
// ledger at 3 rows: date parse 3/3, owner resolution 3/3, `period: 'unknown'` written ZERO times,
// `ownerId: 'unknown'` written ZERO times. So the two failure branches these functions exist for
// have no live instance today — and T0 §7(a) proved they are nonetheless REACHABLE, because
// `firestore.rules`' `date.size() == 10` is a LENGTH check and a matrix-governed member can write
// `date: "9999-99-99"` right now. Everything below is therefore adversarial by construction.
import { describe, expect, it } from 'vitest';
import { ownerIdOrUnknown, resolveOwnerId, UNKNOWN_OWNER_ID } from '../utils/resolveOwnerId';
import {
  UNKNOWN_PERIOD,
  periodOf,
  periodOfMonthYear,
  periodOrUnknown,
  periodOrUnknownFromMonthYear,
} from '../utils/periodMath';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// resolveOwnerId — extracted from RecurringService's `nameByMemberId` lookup, INVERTED
// ─────────────────────────────────────────────────────────────────────────────────────────────

const MEMBERS = [
  { id: 'david-levy', name: 'דויד' },
  { id: 'lilit-levy', name: 'לילית' },
  { id: 'omer-levy', name: 'עומר' },
];

describe('resolveOwnerId — display name to memberId', () => {
  it('resolves each of the three real members by name', () => {
    // The exact corpus T0 measured: three members, three distinct owner names, 3/3 resolvable.
    expect(resolveOwnerId('דויד', MEMBERS)).toBe('david-levy');
    expect(resolveOwnerId('לילית', MEMBERS)).toBe('lilit-levy');
    expect(resolveOwnerId('עומר', MEMBERS)).toBe('omer-levy');
  });

  it('returns null — never a guess — for a name no member carries', () => {
    // A6's orphan set. Empty on the real corpus today, which is exactly why it is only ever
    // exercised here. `null` and not `''`: the caller decides what an unresolvable owner means,
    // the same contract `periodOf` has for an unreadable date.
    expect(resolveOwnerId('מישהו אחר', MEMBERS)).toBeNull();
    expect(resolveOwnerId('דוד', MEMBERS)).toBeNull(); // one letter off — no fuzzy matching
  });

  it('returns null for an absent, empty or whitespace name rather than matching a member', () => {
    expect(resolveOwnerId(undefined, MEMBERS)).toBeNull();
    expect(resolveOwnerId(null, MEMBERS)).toBeNull();
    expect(resolveOwnerId('', MEMBERS)).toBeNull();
    expect(resolveOwnerId('   ', MEMBERS)).toBeNull();
  });

  it('trims surrounding whitespace, because an extraction-supplied owner name carries it', () => {
    expect(resolveOwnerId('  לילית  ', MEMBERS)).toBe('lilit-levy');
  });

  it('is case- and diacritic-literal: it matches the stored name exactly, not approximately', () => {
    // Deliberate. `owner` is a display name a human typed; a near-match resolver would silently
    // attribute one member's spending to another, which is worse than an honest `'unknown'`.
    expect(resolveOwnerId('LILIT', [{ id: 'x', name: 'lilit' }])).toBeNull();
  });

  it('returns null against an empty member list instead of throwing', () => {
    expect(resolveOwnerId('דויד', [])).toBeNull();
  });

  it('!! a DUPLICATE display name resolves to NOBODY, not to the first match', () => {
    // Two members may legitimately share a display name — `isValidMember` requires a non-empty
    // name and nothing more, and `MembersService` does not enforce uniqueness. Picking the first
    // would attribute every row with that name to one of them at random and the family would
    // never see it. `'unknown'` is visible; a wrong attribution is not.
    const twins = [
      { id: 'a-levy', name: 'עומר' },
      { id: 'b-levy', name: 'עומר' },
    ];
    expect(resolveOwnerId('עומר', twins)).toBeNull();
  });

  it('ignores members with an empty name so a blank owner cannot resolve to one', () => {
    const withBlank = [{ id: 'ghost', name: '' }, ...MEMBERS];
    expect(resolveOwnerId('', withBlank)).toBeNull();
    expect(resolveOwnerId('דויד', withBlank)).toBe('david-levy');
  });

  it("UNKNOWN_OWNER_ID is the literal 'unknown' — a queried value, not a label", () => {
    // Stamped into documents and compared against by `where('ownerId','==',…)`, so changing this
    // string orphans every row already carrying it. Same contract as UNKNOWN_PERIOD.
    expect(UNKNOWN_OWNER_ID).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// periodOfMonthYear — the `incomes` half (D23b). NEVER derived from `date`.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("periodOfMonthYear — `incomes` stamps from month/year, never from `date`", () => {
  it('builds YYYY-MM from the month/year pair, zero-padding the month', () => {
    expect(periodOfMonthYear('03', '2026')).toBe('2026-03');
    expect(periodOfMonthYear('3', '2026')).toBe('2026-03');
    expect(periodOfMonthYear('12', '2026')).toBe('2026-12');
  });

  it('accepts the numeric shape too — `incomes` has no schema and no service layer', () => {
    expect(periodOfMonthYear(3, 2026)).toBe('2026-03');
    expect(periodOfMonthYear(11, 2026)).toBe('2026-11');
  });

  it('returns null for a month outside 1..12, an unreadable year, or a missing half', () => {
    expect(periodOfMonthYear('00', '2026')).toBeNull();
    expect(periodOfMonthYear('13', '2026')).toBeNull();
    expect(periodOfMonthYear('-1', '2026')).toBeNull();
    expect(periodOfMonthYear('אוגוסט', '2026')).toBeNull();
    expect(periodOfMonthYear('03', '26')).toBeNull();
    expect(periodOfMonthYear('03', 'שנה')).toBeNull();
    expect(periodOfMonthYear('03', undefined)).toBeNull();
    expect(periodOfMonthYear(undefined, '2026')).toBeNull();
    expect(periodOfMonthYear('', '')).toBeNull();
  });

  it('!! IT MUST NOT BE periodOf(date) — the two disagree on a real Dashboard-authored row', () => {
    // THE WHOLE POINT OF D23(b), reproduced as an executable claim. `Dashboard.handleSaveIncomes`
    // writes `month`/`year` FROM THE UI'S SELECTED FILTER while `date` is free text, and
    // `CentralExpenseReport` queries `where('month','==') + where('year','==')`. So a row edited
    // in the August view but dated in July has month/year = August and date = July. A
    // `periodOf(date)` backfill would stamp `2026-07` and silently move that row out from under
    // the live query that already reads it.
    const row = { date: '2026-07-31', month: '08', year: '2026' };
    expect(periodOf(row.date)).toBe('2026-07');
    expect(periodOfMonthYear(row.month, row.year)).toBe('2026-08');
    expect(periodOfMonthYear(row.month, row.year)).not.toBe(periodOf(row.date));
  });

  it("periodOrUnknownFromMonthYear stamps 'unknown' on the malformed pair, and only there", () => {
    expect(periodOrUnknownFromMonthYear('03', '2026')).toBe('2026-03');
    expect(periodOrUnknownFromMonthYear('13', '2026')).toBe(UNKNOWN_PERIOD);
    expect(periodOrUnknownFromMonthYear(undefined, undefined)).toBe(UNKNOWN_PERIOD);
  });

  it('agrees with periodOrUnknown on the RecurringService-written rows, which derive both from one period', () => {
    // `RecurringService` writes `date`, `month` and `year` all three from the same period, so its
    // income rows are internally consistent by construction (T0 §5, confirmed by reading the
    // writer). The two derivations must therefore agree on exactly those rows — which is what
    // makes the divergence above a property of the Dashboard writer and not of the functions.
    for (const period of ['2026-01', '2026-09', '2026-12']) {
      const [year, month] = period.split('-');
      expect(periodOrUnknownFromMonthYear(month, year)).toBe(periodOrUnknown(`${year}-${month}-05`));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T3 REVIEW F1 — `owner` IS UNTRUSTED FIRESTORE DATA AND THIS RESOLVER IS THE FIRST THING TO
// TOUCH IT
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Not only reached through the backfill, which now hands it a checked string: `FileProcessor`'s
// two constructors call `ownerIdOrUnknown(item.owner ?? analysis.owner, …)` with a value that came
// out of an AI extraction, and `firestore.rules` had NO type check on `owner` at create at all
// (closed in this same task, but the resolver may not depend on that — the rule is one deploy away
// from being edited and this module is imported by an Admin-SDK script that bypasses Rules
// entirely). `12345`, `['דויד']` and `{name:'דויד'}` are all TRUTHY and none of them has `.trim`.
//
// Held here rather than only through `planBackfill`, and that distinction is the point: the
// mutation sweep found the guard SHADOWED when the only coverage went through the backfill, whose
// own `readableString` had already made the value a string.
describe('resolveOwnerId is total on a value that is not a string (T3 review F1)', () => {
  for (const [label, value] of [
    ['a number', 12345],
    ['a boolean', true],
    ['an array', ['דויד']],
    ['an object', { name: 'דויד' }],
    ['a Timestamp-like', { toDate: () => new Date() }],
  ] as Array<[string, unknown]>) {
    it(`refuses ${label} rather than throwing`, () => {
      expect(() => resolveOwnerId(value as never, MEMBERS)).not.toThrow();
      expect(resolveOwnerId(value as never, MEMBERS)).toBeNull();
      expect(ownerIdOrUnknown(value as never, MEMBERS)).toBe(UNKNOWN_OWNER_ID);
    });
  }

  it('!! AND IT NEVER STRINGIFIES ONE INTO A LOOKUP', () => {
    // A member genuinely named '12345' must not be reachable from the NUMBER 12345 — that would
    // be the near-match guess this resolver's own header exists to refuse, arrived at by coercion.
    const members = [...MEMBERS, { id: 'odd-levy', name: '12345' }];
    expect(resolveOwnerId(12345 as never, members)).toBeNull();
    expect(resolveOwnerId('12345', members)).toBe('odd-levy');
  });
});
