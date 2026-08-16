import { describe, expect, it } from 'vitest';
import { resolveOwnedModuleScope } from '../utils/ownedModuleScope';

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
