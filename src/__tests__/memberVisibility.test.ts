// Dead-end avoidance for FilterBar's מי selector (controller ruling on Task 1's review — a
// zero-permission/'own'-level member selecting another family member in the מי control cannot
// possibly see that member's data: firestore.rules' access rules deny the ENTIRE query unless
// it's scoped to the viewer's own records for an 'own' level, and this app doesn't build that
// where() clause for every module yet. Offering the chip anyway is a UX dead end, not a security
// hole (the server already denies it) — this util is what keeps MemberMultiSelect from offering
// selections that can only ever resolve to nothing.
//
// D2 (Stage 5 Task 2) — generalized from Stage 4's single hardcoded `expensesView` field to a
// per-module `levelsByModule` map, driven by whichever module is active on screen
// (`filterModuleId`, from `MODULE_REGISTRY`). `filterModuleId: null` (e.g. the future net-worth
// entry, which spans three independently-gradable modules) means "offer everyone," matching
// pre-Stage-4 behavior — the same as `viewerAccess === null`.
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
    expect(filterViewableMembers(members, groups, null, 'expenses')).toEqual({ members, groups });
  });

  it('offers everyone unrestricted for a "family"-level viewer on the active filterModuleId', () => {
    const viewerAccess: ViewerAccess = { role: 'member', memberId: 'lilit', levelsByModule: { expenses: 'family' } };
    expect(filterViewableMembers(members, groups, viewerAccess, 'expenses')).toEqual({ members, groups });
  });

  it('restricts an "own"-level viewer to just their own member chip, and drops all groups', () => {
    const viewerAccess: ViewerAccess = { role: 'member', memberId: 'omer', levelsByModule: { expenses: 'own' } };
    const result = filterViewableMembers(members, groups, viewerAccess, 'expenses');
    expect(result.members).toEqual([members[2]]);
    expect(result.groups).toEqual([]);
  });

  it('restricts a "none"-level (or missing) viewer the same way (own member only, no groups)', () => {
    const viewerAccess: ViewerAccess = { role: 'member', memberId: 'omer', levelsByModule: { expenses: 'none' } };
    const result = filterViewableMembers(members, groups, viewerAccess, 'expenses');
    expect(result.members).toEqual([members[2]]);
    expect(result.groups).toEqual([]);
  });

  it("an own-level viewer whose own member id isn't even in the list resolves to an empty list, not a throw", () => {
    const viewerAccess: ViewerAccess = { role: 'member', memberId: 'ghost', levelsByModule: { expenses: 'own' } };
    const result = filterViewableMembers(members, groups, viewerAccess, 'expenses');
    expect(result.members).toEqual([]);
    expect(result.groups).toEqual([]);
  });

  // D2 — the whole point of the generalization: reads the level for the ACTIVE screen's module,
  // not a field hardcoded to 'expenses'.
  it("reads levelsByModule.accounts (not .expenses) when filterModuleId is 'accounts'", () => {
    const viewerAccess: ViewerAccess = {
      role: 'member',
      memberId: 'omer',
      levelsByModule: { expenses: 'family', accounts: 'own' },
    };
    const result = filterViewableMembers(members, groups, viewerAccess, 'accounts');
    expect(result.members).toEqual([members[2]]);
  });

  it("a 'family'-level grant on a DIFFERENT module does not leak into the active module's restriction", () => {
    const viewerAccess: ViewerAccess = {
      role: 'member',
      memberId: 'omer',
      levelsByModule: { expenses: 'family', accounts: 'none' },
    };
    const result = filterViewableMembers(members, groups, viewerAccess, 'accounts');
    expect(result.members).toEqual([members[2]]);
    expect(result.groups).toEqual([]);
  });

  // D2 — filterModuleId: null (e.g. a future net-worth-style entry spanning several
  // independently-gradable modules) means "offer everyone," regardless of levelsByModule content.
  it('filterModuleId: null returns everyone unrestricted, regardless of levelsByModule', () => {
    const viewerAccess: ViewerAccess = {
      role: 'member',
      memberId: 'omer',
      levelsByModule: { expenses: 'none', accounts: 'none' },
    };
    expect(filterViewableMembers(members, groups, viewerAccess, null)).toEqual({ members, groups });
  });
});
