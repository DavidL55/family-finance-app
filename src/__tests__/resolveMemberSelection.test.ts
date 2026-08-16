import { describe, expect, it } from 'vitest';
import { resolveMemberSelectionNames, resolveEcosystemKey, resolveMemberSelectionIds } from '../utils/resolveMemberSelection';
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
