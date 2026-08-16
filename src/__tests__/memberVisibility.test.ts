// Dead-end avoidance for FilterBar's מי selector (controller ruling on Task 1's review — a
// zero-permission/'own'-level member selecting another family member in the מי control cannot
// possibly see that member's data: firestore.rules' canAccessExpenses denies the ENTIRE
// transaction_lines query unless it's scoped to `data.owner == myMember().name` for an 'own'
// level, and this app doesn't build that where() clause yet. Offering the chip anyway is a UX
// dead end, not a security hole (the server already denies it) — this util is what keeps
// MemberMultiSelect from offering selections that can only ever resolve to nothing.
import { describe, expect, it } from 'vitest';
import { filterViewableMembers } from '../utils/memberVisibility';
import type { ViewerAccess } from '../utils/memberVisibility';

const members = [
  { id: 'david', name: 'דויד' },
  { id: 'lilit', name: 'לילית' },
  { id: 'omer', name: 'עומר' },
] as any[];
const groups = [{ id: 'kids', name: 'הילדים', memberIds: ['omer'], createdAt: 'x', updatedAt: 'x' }];

describe('filterViewableMembers', () => {
  it('offers everyone unrestricted when viewerAccess is null (unknown / not yet wired)', () => {
    expect(filterViewableMembers(members, groups, null)).toEqual({ members, groups });
  });

  it('offers everyone unrestricted for a "family"-level viewer', () => {
    const viewerAccess: ViewerAccess = { role: 'member', memberId: 'lilit', expensesView: 'family' };
    expect(filterViewableMembers(members, groups, viewerAccess)).toEqual({ members, groups });
  });

  it('restricts an "own"-level viewer to just their own member chip, and drops all groups', () => {
    const viewerAccess: ViewerAccess = { role: 'member', memberId: 'omer', expensesView: 'own' };
    const result = filterViewableMembers(members, groups, viewerAccess);
    expect(result.members).toEqual([members[2]]);
    expect(result.groups).toEqual([]);
  });

  it('restricts a "none"-level viewer the same way (own member only, no groups)', () => {
    const viewerAccess: ViewerAccess = { role: 'member', memberId: 'omer', expensesView: 'none' };
    const result = filterViewableMembers(members, groups, viewerAccess);
    expect(result.members).toEqual([members[2]]);
    expect(result.groups).toEqual([]);
  });

  it("an own-level viewer whose own member id isn't even in the list resolves to an empty list, not a throw", () => {
    const viewerAccess: ViewerAccess = { role: 'member', memberId: 'ghost', expensesView: 'own' };
    const result = filterViewableMembers(members, groups, viewerAccess);
    expect(result.members).toEqual([]);
    expect(result.groups).toEqual([]);
  });
});
