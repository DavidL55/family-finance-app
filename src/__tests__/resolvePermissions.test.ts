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
});
