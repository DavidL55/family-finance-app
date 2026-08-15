import { describe, expect, it, vi, afterEach } from 'vitest';
import { roleFor, SUPER_ADMIN_MEMBER_ID, PROVISIONING_EMAIL_DOMAIN } from '../utils/provisionRole';
import type { Member } from '../utils/seedFromBudgetConfig';

describe('roleFor (Design decision D1 — Member.role -> PermissionRole claim mapping)', () => {
  it('maps a הורה member to the parent claim', () => {
    expect(roleFor('lilit-levy', 'הורה')).toBe('parent');
  });

  it('maps a ילד member to the member claim', () => {
    expect(roleFor('omer-levy', 'ילד')).toBe('member');
  });

  it('maps SUPER_ADMIN_MEMBER_ID to super-admin regardless of Member.role', () => {
    expect(roleFor(SUPER_ADMIN_MEMBER_ID, 'הורה')).toBe('super-admin');
  });

  it('id match for super-admin takes priority even if the member doc says ילד', () => {
    // Defensive: role is server-verified by id, never trusts a client-editable document field.
    expect(roleFor(SUPER_ADMIN_MEMBER_ID, 'ילד')).toBe('super-admin');
  });

  it('a non-super-admin parent-role member with a different id is never promoted to super-admin', () => {
    expect(roleFor('some-other-parent', 'הורה')).toBe('parent');
  });
});

describe('roleFor hardening: malformed Member.role values', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('coerces a garbage role string to "member" and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 'admin' is not in the 'הורה' | 'ילד' union — simulates a hand-edited/corrupt Firestore doc.
    // Cast narrowly at this input boundary; that's the point of the runtime guard under test.
    const result = roleFor('some-other-member', 'admin' as unknown as Member['role']);
    expect(result).toBe('member');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('coerces an undefined/missing role to "member" and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = roleFor('some-other-member', undefined as unknown as Member['role']);
    expect(result).toBe('member');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT warn for the legitimate הורה value', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    roleFor('some-other-member', 'הורה');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does NOT warn for the legitimate ילד value', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    roleFor('some-other-member', 'ילד');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does NOT warn for the super-admin-id case, even with a malformed role', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = roleFor(SUPER_ADMIN_MEMBER_ID, 'garbage' as unknown as Member['role']);
    expect(result).toBe('super-admin');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('PROVISIONING_EMAIL_DOMAIN (D7 — local-only placeholder, not a real mailbox)', () => {
  it('is the fixed familyfinance.local domain', () => {
    expect(PROVISIONING_EMAIL_DOMAIN).toBe('familyfinance.local');
  });
});
