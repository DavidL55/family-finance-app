import { describe, expect, it } from 'vitest';
import { resolveEffectivePermissions } from '../utils/resolvePermissions';
import type { PermissionDoc } from '../types/permissions';

const groupDoc = (targetId: string, modules: PermissionDoc['modules']): PermissionDoc => ({
  id: `group__${targetId}`,
  scope: 'group',
  targetId,
  modules,
  updatedAt: '2026-08-15T00:00:00.000Z',
  updatedBy: 'david-levy',
});

const memberDoc = (targetId: string, modules: PermissionDoc['modules']): PermissionDoc => ({
  id: `member__${targetId}`,
  scope: 'member',
  targetId,
  modules,
  updatedAt: '2026-08-15T00:00:00.000Z',
  updatedBy: 'david-levy',
});

describe('resolveEffectivePermissions', () => {
  it('returns {} when the member is in no groups and has no exception', () => {
    expect(resolveEffectivePermissions([], null, {})).toEqual({});
  });

  it('returns the single group grant when the member is in one group', () => {
    const result = resolveEffectivePermissions(
      ['kids'],
      null,
      { kids: groupDoc('kids', { expenses: { view: 'own', edit: 'none' } }) }
    );
    expect(result).toEqual({ expenses: { view: 'own', edit: 'none' } });
  });

  it('combines two groups by taking the most permissive level PER ACTION independently', () => {
    const result = resolveEffectivePermissions(
      ['kids', 'teens'],
      null,
      {
        kids: groupDoc('kids', { expenses: { view: 'own', edit: 'none' } }),
        teens: groupDoc('teens', { expenses: { view: 'family', edit: 'own' } }),
      }
    );
    // view: family beats own; edit: own beats none — independently, not "pick one group's whole entry"
    expect(result).toEqual({ expenses: { view: 'family', edit: 'own' } });
  });

  it('is order-independent — the result does not depend on which group is listed first', () => {
    const docs = {
      kids: groupDoc('kids', { goals: { view: 'family', edit: 'none' } }),
      teens: groupDoc('teens', { goals: { view: 'own', edit: 'family' } }),
    };
    const a = resolveEffectivePermissions(['kids', 'teens'], null, docs);
    const b = resolveEffectivePermissions(['teens', 'kids'], null, docs);
    expect(a).toEqual(b);
    expect(a).toEqual({ goals: { view: 'family', edit: 'family' } });
  });

  it('ignores a groupId with no matching permission doc (group has no matrix entry yet)', () => {
    const result = resolveEffectivePermissions(['no-doc-group'], null, {});
    expect(result).toEqual({});
  });

  it('a per-member exception overrides the group value for the modules it mentions', () => {
    const result = resolveEffectivePermissions(
      ['kids'],
      memberDoc('omer', { expenses: { view: 'family', edit: 'family' } }),
      { kids: groupDoc('kids', { expenses: { view: 'own', edit: 'none' } }) }
    );
    expect(result).toEqual({ expenses: { view: 'family', edit: 'family' } });
  });

  it('a per-member exception leaves modules it does NOT mention at the group-derived value', () => {
    const result = resolveEffectivePermissions(
      ['kids'],
      memberDoc('omer', { goals: { view: 'family', edit: 'family' } }), // only mentions goals
      { kids: groupDoc('kids', { expenses: { view: 'own', edit: 'none' } }) } // group only mentions expenses
    );
    expect(result).toEqual({
      expenses: { view: 'own', edit: 'none' },   // untouched, from the group
      goals: { view: 'family', edit: 'family' }, // from the exception
    });
  });

  it('an exception with no groups at all still applies on its own', () => {
    const result = resolveEffectivePermissions(
      [],
      memberDoc('solo', { investments: { view: 'family', edit: 'none' } }),
      {}
    );
    expect(result).toEqual({ investments: { view: 'family', edit: 'none' } });
  });

  it('"none" beats nothing but loses to "own" and "family" when combining groups', () => {
    const result = resolveEffectivePermissions(
      ['a', 'b'],
      null,
      {
        a: groupDoc('a', { income: { view: 'none', edit: 'none' } }),
        b: groupDoc('b', { income: { view: 'own', edit: 'none' } }),
      }
    );
    expect(result.income).toEqual({ view: 'own', edit: 'none' });
  });

  describe('hardening: out-of-union level values', () => {
    it('coerces an out-of-union level (e.g. "admin" from a malformed doc) to "none"', () => {
      const result = resolveEffectivePermissions(
        ['tampered'],
        null,
        {
          // 'admin' is not a valid PermissionLevel — simulates a hand-edited/corrupt Firestore doc.
          // Cast narrowly at this input boundary; that's the point of the runtime guard under test.
          tampered: groupDoc('tampered', {
            expenses: { view: 'admin' as unknown as PermissionDoc['modules']['expenses']['view'], edit: 'none' },
          }),
        }
      );
      // Should never be inserted into the union unchanged; must be coerced to 'none'.
      expect(result.expenses?.view).toBe('none');
    });

    it('an out-of-union level never wins over a legitimate grant when combining groups', () => {
      const result = resolveEffectivePermissions(
        ['tampered', 'legit'],
        null,
        {
          // 'admin' is not in the PermissionLevel union — simulates a hand-edited/corrupt doc.
          tampered: groupDoc('tampered', {
            expenses: { view: 'admin' as unknown as PermissionDoc['modules']['expenses']['view'], edit: 'none' },
          }),
          legit: groupDoc('legit', { expenses: { view: 'own', edit: 'none' } }),
        }
      );
      // 'admin' must be coerced to 'none' and therefore lose to 'own' from the legit group.
      expect(result.expenses).toEqual({ view: 'own', edit: 'none' });
    });

    it('coerces an out-of-union level found only in a member exception doc', () => {
      const result = resolveEffectivePermissions(
        [],
        memberDoc('omer', {
          goals: { view: 'family', edit: 'super-admin' as unknown as PermissionDoc['modules']['goals']['edit'] },
        }),
        {}
      );
      expect(result.goals).toEqual({ view: 'family', edit: 'none' });
    });
  });

  describe('hardening: malformed modules field', () => {
    it('a group doc with modules: undefined contributes nothing instead of throwing', () => {
      const brokenGroupDoc = groupDoc('kids', undefined as unknown as PermissionDoc['modules']);
      expect(() =>
        resolveEffectivePermissions(['kids'], null, { kids: brokenGroupDoc })
      ).not.toThrow();
      expect(resolveEffectivePermissions(['kids'], null, { kids: brokenGroupDoc })).toEqual({});
    });

    it('a group doc with modules: null contributes nothing instead of throwing', () => {
      const brokenGroupDoc = groupDoc('kids', null as unknown as PermissionDoc['modules']);
      expect(() =>
        resolveEffectivePermissions(['kids'], null, { kids: brokenGroupDoc })
      ).not.toThrow();
      expect(resolveEffectivePermissions(['kids'], null, { kids: brokenGroupDoc })).toEqual({});
    });

    it('a well-formed group is still applied when a sibling group has modules: undefined', () => {
      const result = resolveEffectivePermissions(
        ['broken', 'kids'],
        null,
        {
          broken: groupDoc('broken', undefined as unknown as PermissionDoc['modules']),
          kids: groupDoc('kids', { expenses: { view: 'own', edit: 'none' } }),
        }
      );
      expect(result).toEqual({ expenses: { view: 'own', edit: 'none' } });
    });

    it('a member-exception doc with modules: undefined contributes nothing instead of throwing', () => {
      const brokenMemberDoc = memberDoc('omer', undefined as unknown as PermissionDoc['modules']);
      expect(() =>
        resolveEffectivePermissions(['kids'], brokenMemberDoc, {
          kids: groupDoc('kids', { expenses: { view: 'own', edit: 'none' } }),
        })
      ).not.toThrow();
      const result = resolveEffectivePermissions(['kids'], brokenMemberDoc, {
        kids: groupDoc('kids', { expenses: { view: 'own', edit: 'none' } }),
      });
      // Group-derived value must survive untouched — the broken exception contributes nothing.
      expect(result).toEqual({ expenses: { view: 'own', edit: 'none' } });
    });

    it('a member-exception doc with modules: null contributes nothing instead of throwing', () => {
      const brokenMemberDoc = memberDoc('omer', null as unknown as PermissionDoc['modules']);
      expect(() =>
        resolveEffectivePermissions([], brokenMemberDoc, {})
      ).not.toThrow();
      expect(resolveEffectivePermissions([], brokenMemberDoc, {})).toEqual({});
    });
  });

  describe('Stage 3 backward compatibility: pre-Stage-3 resolvedPermissions docs (zero data migration)', () => {
    it('an old-shape group doc (only the four Stage 2 module keys) yields no entry for any Stage 3 module — callers must fail-closed to none/none', () => {
      const result = resolveEffectivePermissions(
        ['kids'],
        null,
        {
          // Simulates a resolvedPermissions doc written before Stage 3 shipped — it has never
          // heard of accounts/recurring/loans/insurances and never will unless re-saved.
          kids: groupDoc('kids', { expenses: { view: 'family', edit: 'own' } }),
        }
      );
      expect(result).toEqual({ expenses: { view: 'family', edit: 'own' } });
      for (const moduleId of ['accounts', 'recurring', 'loans', 'insurances'] as const) {
        expect(result[moduleId]).toBeUndefined();
      }
    });

    it('an old-shape member exception doc likewise leaves every Stage 3 module absent (undefined), not defaulted to any granted level', () => {
      const result = resolveEffectivePermissions(
        [],
        memberDoc('omer', { goals: { view: 'family', edit: 'family' } }),
        {}
      );
      expect(result.goals).toEqual({ view: 'family', edit: 'family' });
      for (const moduleId of ['accounts', 'recurring', 'loans', 'insurances'] as const) {
        expect(result[moduleId]).toBeUndefined();
      }
    });
  });

  describe('Stage 3 forward-compatibility (new module ids are generic to the resolver)', () => {
    it('resolves a Stage 3 module id (accounts) identically to a Stage 2 one — no special-casing in the resolver', () => {
      const result = resolveEffectivePermissions(
        ['kids'],
        null,
        { kids: groupDoc('kids', { accounts: { view: 'own', edit: 'own' } }) }
      );
      expect(result).toEqual({ accounts: { view: 'own', edit: 'own' } });
    });

    it('a member exception on a Stage 3 module overrides the group value for that module only', () => {
      const result = resolveEffectivePermissions(
        ['kids'],
        memberDoc('omer', { loans: { view: 'family', edit: 'none' } }),
        { kids: groupDoc('kids', { accounts: { view: 'own', edit: 'none' } }) }
      );
      expect(result).toEqual({
        accounts: { view: 'own', edit: 'none' }, // untouched, from the group
        loans: { view: 'family', edit: 'none' }, // from the exception
      });
    });
  });
});
