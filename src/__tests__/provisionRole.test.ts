import { describe, expect, it } from 'vitest';
import { roleFor, SUPER_ADMIN_MEMBER_ID, PROVISIONING_EMAIL_DOMAIN } from '../utils/provisionRole';

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

describe('PROVISIONING_EMAIL_DOMAIN (D7 — local-only placeholder, not a real mailbox)', () => {
  it('is the fixed familyfinance.local domain', () => {
    expect(PROVISIONING_EMAIL_DOMAIN).toBe('familyfinance.local');
  });
});
