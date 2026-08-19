import { describe, expect, it } from 'vitest';
import { resolveOwnedModuleScope, resolveOwnerlessModuleScope } from '../utils/ownedModuleScope';

describe('resolveOwnedModuleScope', () => {
  it('super-admin always resolves to family, regardless of level', () => {
    expect(resolveOwnedModuleScope('super-admin', 'none')).toBe('family');
    expect(resolveOwnedModuleScope('super-admin', undefined)).toBe('family');
  });
  it('parent always resolves to family, regardless of level', () => {
    expect(resolveOwnedModuleScope('parent', 'own')).toBe('family');
  });
  it('member resolves to the granted level', () => {
    expect(resolveOwnedModuleScope('member', 'family')).toBe('family');
    expect(resolveOwnedModuleScope('member', 'own')).toBe('own');
  });
  it('member with no/undefined/none level fails closed to none', () => {
    expect(resolveOwnedModuleScope('member', undefined)).toBe('none');
    expect(resolveOwnedModuleScope('member', 'none')).toBe('none');
  });
});

describe('resolveOwnerlessModuleScope — `own` is not expressible without an owner field (T7a)', () => {
  it('super-admin and parent always read the family, as the Rules bypass does', () => {
    expect(resolveOwnerlessModuleScope('super-admin', undefined)).toBe('family');
    expect(resolveOwnerlessModuleScope('parent', 'none')).toBe('family');
  });

  it('a member with a `family` level reads the family', () => {
    expect(resolveOwnerlessModuleScope('member', 'family')).toBe('family');
  });

  it('!! a member with an `own` level gets NOTHING — the asymmetry D17`s table records', () => {
    // The owned-module helper answers `'own'` for the same inputs. On a collection with no owner
    // field that would be a family-wide read wearing a restricted scope's name.
    expect(resolveOwnedModuleScope('member', 'own')).toBe('own');
    expect(resolveOwnerlessModuleScope('member', 'own')).toBe('none');
  });

  it('an absent level fails closed', () => {
    expect(resolveOwnerlessModuleScope('member', undefined)).toBe('none');
    expect(resolveOwnerlessModuleScope('member', 'none')).toBe('none');
  });
});
