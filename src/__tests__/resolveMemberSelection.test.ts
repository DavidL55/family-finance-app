import { describe, expect, it } from 'vitest';
import { resolveMemberSelectionNames, resolveEcosystemKey } from '../utils/resolveMemberSelection';
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
});
