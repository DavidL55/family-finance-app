import { describe, expect, it } from 'vitest';
import { resolveMemberSelectionNames, resolveEcosystemKey, resolveMemberSelectionIds, rowMatchesMemberSelection } from '../utils/resolveMemberSelection';
import type { MemberSelection } from '../types/filters';

const members = [
  { id: 'david', name: 'דויד' }, { id: 'lilit', name: 'לילית' }, { id: 'omer', name: 'עומר' },
] as any[];
const groups = [{ id: 'kids', name: 'הילדים', memberIds: ['omer'], createdAt: 'x', updatedAt: 'x' }];

describe('resolveMemberSelectionNames', () => {
  it('mode "all" resolves to null (no filter)', () => {
    expect(resolveMemberSelectionNames({ mode: 'all', memberIds: [], groupId: null }, members, groups)).toBeNull();
  });
  it('mode "members" resolves to a Set of the matching display names', () => {
    const sel: MemberSelection = { mode: 'members', memberIds: ['david', 'omer'], groupId: null };
    expect(resolveMemberSelectionNames(sel, members, groups)).toEqual(new Set(['דויד', 'עומר']));
  });
  it('mode "members" with an unknown id silently drops it, not the whole selection', () => {
    const sel: MemberSelection = { mode: 'members', memberIds: ['david', 'ghost'], groupId: null };
    expect(resolveMemberSelectionNames(sel, members, groups)).toEqual(new Set(['דויד']));
  });
  it('mode "members" with an empty array resolves to null', () => {
    expect(resolveMemberSelectionNames({ mode: 'members', memberIds: [], groupId: null }, members, groups)).toBeNull();
  });
  it('mode "group" resolves to the names of that group\'s members', () => {
    const sel: MemberSelection = { mode: 'group', memberIds: [], groupId: 'kids' };
    expect(resolveMemberSelectionNames(sel, members, groups)).toEqual(new Set(['עומר']));
  });
  it('mode "group" with an unknown groupId resolves to null, not a throw', () => {
    const sel: MemberSelection = { mode: 'group', memberIds: [], groupId: 'ghost' };
    expect(resolveMemberSelectionNames(sel, members, groups)).toBeNull();
  });
  // Task 1 review fold-in (iii): a group containing a mix of a resolvable and a stale/unknown
  // member id — the stale id must be dropped individually, same as the direct 'members'-mode case
  // above, not invalidate the whole group's resolution.
  it('mode "group" containing a stale/unknown member id alongside a valid one drops only the stale id', () => {
    const groupsWithStaleMember = [
      { id: 'mixed', name: 'קבוצה מעורבת', memberIds: ['omer', 'deleted-member'], createdAt: 'x', updatedAt: 'x' },
    ];
    const sel: MemberSelection = { mode: 'group', memberIds: [], groupId: 'mixed' };
    expect(resolveMemberSelectionNames(sel, members, groupsWithStaleMember)).toEqual(new Set(['עומר']));
  });
});

describe('resolveEcosystemKey (D8)', () => {
  it('returns "all" for mode "all"', () => {
    expect(resolveEcosystemKey({ mode: 'all', memberIds: [], groupId: null })).toBe('all');
  });
  it('returns the single member id when exactly one member is selected', () => {
    expect(resolveEcosystemKey({ mode: 'members', memberIds: ['omer'], groupId: null })).toBe('omer');
  });
  it('returns "all" for 2+ selected members (no multi-member summing this stage)', () => {
    expect(resolveEcosystemKey({ mode: 'members', memberIds: ['omer', 'david'], groupId: null })).toBe('all');
  });
  it('returns "all" for a group selection', () => {
    expect(resolveEcosystemKey({ mode: 'group', memberIds: [], groupId: 'kids' })).toBe('all');
  });
  // Task 1 review fold-in (iii): mode 'members' with an empty memberIds array was untested for
  // resolveEcosystemKey specifically (the resolveMemberSelectionNames suite above covers the same
  // shape, but for the other function).
  it('returns "all" for mode "members" with an empty memberIds array', () => {
    expect(resolveEcosystemKey({ mode: 'members', memberIds: [], groupId: null })).toBe('all');
  });
});

// D2/D6 — the Stage 3 owned collections (accounts/loans/insurances/recurring) key ownership by
// `ownerId` (Member.id) directly, unlike transaction_lines.owner's display-name convention — so
// this resolver is simpler than resolveMemberSelectionNames above: mode 'members' already carries
// ids directly (no member-list lookup needed at all), mode 'group' resolves via Group.memberIds
// (already ids).
describe('resolveMemberSelectionIds (D2/D6)', () => {
  const idGroups = [{ id: 'kids', name: 'הילדים', memberIds: ['omer-levy'], createdAt: 'x', updatedAt: 'x' }];

  it('mode "all" resolves to null', () => {
    expect(resolveMemberSelectionIds({ mode: 'all', memberIds: [], groupId: null }, idGroups)).toBeNull();
  });
  it('mode "members" returns the ids directly, no name lookup needed', () => {
    expect(resolveMemberSelectionIds({ mode: 'members', memberIds: ['omer-levy', 'lilit-levy'], groupId: null }, idGroups))
      .toEqual(new Set(['omer-levy', 'lilit-levy']));
  });
  it('mode "members" with an empty array resolves to null', () => {
    expect(resolveMemberSelectionIds({ mode: 'members', memberIds: [], groupId: null }, idGroups)).toBeNull();
  });
  it('mode "group" resolves via Group.memberIds', () => {
    expect(resolveMemberSelectionIds({ mode: 'group', memberIds: [], groupId: 'kids' }, idGroups))
      .toEqual(new Set(['omer-levy']));
  });
  it('mode "group" with an unknown groupId resolves to null, not a throw', () => {
    expect(resolveMemberSelectionIds({ mode: 'group', memberIds: [], groupId: 'ghost' }, idGroups)).toBeNull();
  });
  it('mode "group" resolving to zero members resolves to null', () => {
    const emptyGroup = [{ id: 'empty', name: 'ריק', memberIds: [], createdAt: 'x', updatedAt: 'x' }];
    expect(resolveMemberSelectionIds({ mode: 'group', memberIds: [], groupId: 'empty' }, emptyGroup)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T3 REVIEW F5 — THE מי FILTER RE-OPENED THE RENAME HOLE ONE LINE AFTER THE QUERY CLOSED IT
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// D21(a) exists because `transaction_lines.owner` is a DISPLAY NAME and a rename orphans every
// row carrying the old one. T3 added `ownerId` and widened the Rules read to accept either, so the
// scoped query returns a renamed member's rows correctly.
//
// The Dashboard then filtered those same rows with `selectedMemberNames.has(data.owner)`, where
// `resolveMemberSelectionNames` maps ids to CURRENT names — so after a rename the query returned
// the rows and the in-memory filter dropped them. D21(a)'s stated failure, relocated one layer up
// onto the field that no longer survives.
//
// The fix is not simply "filter on ownerId": a row the backfill has not reached has NO `ownerId`,
// and filtering those out would blank the family scan for every מי selection until the backfill
// runs. `ownerId` when the row carries one, the display name when it does not — strictly better
// than either alone, and it degrades in the right direction.
describe('rowMatchesMemberSelection — the מי filter survives a rename (T3 review F5)', () => {
  const ids = (...v: string[]) => new Set(v);
  const names = (...v: string[]) => new Set(v);

  it('no selection matches every row', () => {
    expect(rowMatchesMemberSelection({ owner: 'דויד', ownerId: 'david-levy' }, null, null)).toBe(true);
    expect(rowMatchesMemberSelection({}, null, null)).toBe(true);
  });

  it('!! A RENAMED MEMBER KEEPS THEIR ROWS — the stale display name is not consulted', () => {
    // The row was written when David was called 'דויד'; he is now 'דוד'. `selectedNames` holds the
    // CURRENT name, which is precisely why matching on it drops the row.
    const row = { owner: 'דויד', ownerId: 'david-levy' };
    expect(rowMatchesMemberSelection(row, ids('david-levy'), names('דוד'))).toBe(true);
  });

  it('a stamped row belonging to somebody else is still excluded', () => {
    const row = { owner: 'עומר', ownerId: 'omer-levy' };
    expect(rowMatchesMemberSelection(row, ids('david-levy'), names('דויד'))).toBe(false);
  });

  it('an UNSTAMPED row falls back to the display name — the pre-backfill family scan still filters', () => {
    expect(rowMatchesMemberSelection({ owner: 'דויד' }, ids('david-levy'), names('דויד'))).toBe(true);
    expect(rowMatchesMemberSelection({ owner: 'עומר' }, ids('david-levy'), names('דויד'))).toBe(false);
  });

  it("a row stamped ownerId:'unknown' is excluded whenever a selection is active, and never guessed at", () => {
    // A6's orphan set. It cannot be attributed, so it cannot be claimed for anyone's total — but
    // its display name must NOT be used as a second chance, or 'unknown' would silently resolve.
    const row = { owner: 'דויד', ownerId: 'unknown' };
    expect(rowMatchesMemberSelection(row, ids('david-levy'), names('דויד'))).toBe(false);
    expect(rowMatchesMemberSelection(row, null, null)).toBe(true);
  });

  it('a row with no attribution at all is kept, exactly as before this change', () => {
    expect(rowMatchesMemberSelection({}, ids('david-levy'), names('דויד'))).toBe(true);
    expect(rowMatchesMemberSelection({ owner: '' }, ids('david-levy'), names('דויד'))).toBe(true);
  });

  it('a non-string owner/ownerId is treated as absent rather than thrown on', () => {
    // Same untrusted-Firestore-data class as F1: these fields arrive off a document.
    expect(rowMatchesMemberSelection({ ownerId: 12345 }, ids('david-levy'), names('דויד'))).toBe(true);
    expect(rowMatchesMemberSelection({ owner: ['דויד'] }, ids('david-levy'), names('דויד'))).toBe(true);
    expect(rowMatchesMemberSelection({ ownerId: 12345, owner: 'דויד' }, ids('david-levy'), names('דויד'))).toBe(true);
    expect(rowMatchesMemberSelection({ ownerId: 12345, owner: 'עומר' }, ids('david-levy'), names('דויד'))).toBe(false);
  });

  it('an id selection with no resolvable names still filters on ids', () => {
    // `resolveMemberSelectionNames` drops ids it cannot resolve and returns null when none remain;
    // `resolveMemberSelectionIds` keeps them. A stamped row must still be filtered.
    expect(rowMatchesMemberSelection({ ownerId: 'ghost-levy' }, ids('ghost-levy'), null)).toBe(true);
    expect(rowMatchesMemberSelection({ ownerId: 'david-levy' }, ids('ghost-levy'), null)).toBe(false);
  });
});
