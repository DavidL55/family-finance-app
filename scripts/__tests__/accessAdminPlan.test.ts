// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildInvite, planOwnerBootstrap, planRevoke } from '../cloud/accessAdminPlan';

const now = new Date('2026-10-20T10:00:00Z');
const base = { email: 'Guest@Gmail.com', memberId: 'omer-levy', role: 'member', days: 14, createdBy: 'david-levy', now, memberExists: true, existing: null };

describe('planOwnerBootstrap', () => {
  it('refuses when a super-admin already exists', () => {
    expect(planOwnerBootstrap({ superAdminCount: 1, existingMemberIds: [] })).toMatchObject({ ok: false });
  });
  it('creates only the family members that are missing', () => {
    expect(planOwnerBootstrap({ superAdminCount: 0, existingMemberIds: ['david-levy'] }))
      .toEqual({ ok: true, membersToCreate: ['lilit-levy', 'omer-levy', 'shaked-levy', 'lior-levy'] });
  });
});

describe('buildInvite', () => {
  it('lower-cases the id and email, 14-day expiry', () => {
    const r = buildInvite(base);
    expect(r).toMatchObject({ ok: true, id: 'guest@gmail.com', doc: { email: 'guest@gmail.com', role: 'member', expiresAtMs: now.getTime() + 14 * 864e5 } });
  });
  it('refuses an unknown member, an unknown role, a live unused invite', () => {
    expect(buildInvite({ ...base, memberExists: false })).toMatchObject({ ok: false });
    expect(buildInvite({ ...base, role: 'owner' })).toMatchObject({ ok: false });
    expect(buildInvite({ ...base, existing: { expiresAtMs: now.getTime() + 1 } })).toMatchObject({ ok: false });
  });
  it('refuses a non-positive or non-numeric --days (NaN would write a garbage expiresAt)', () => {
    for (const days of [NaN, 0, -3, 1.5]) expect(buildInvite({ ...base, days })).toMatchObject({ ok: false });
  });
  it('allows re-inviting after the old invite expired or was used', () => {
    expect(buildInvite({ ...base, existing: { expiresAtMs: now.getTime() - 1 } })).toMatchObject({ ok: true });
    expect(buildInvite({ ...base, existing: { usedBy: 'u', expiresAtMs: now.getTime() + 1 } })).toMatchObject({ ok: true });
  });
});

describe('planRevoke', () => {
  it('refuses to revoke the last super-admin', () => {
    expect(planRevoke('u1', [{ uid: 'u1', role: 'super-admin' }, { uid: 'u2', role: 'parent' }])).toMatchObject({ ok: false });
  });
  it('refuses an unknown uid', () => { expect(planRevoke('nope', [{ uid: 'u1', role: 'super-admin' }])).toMatchObject({ ok: false }); });
  it('allows revoking a member', () => { expect(planRevoke('u2', [{ uid: 'u1', role: 'super-admin' }, { uid: 'u2', role: 'member' }])).toEqual({ ok: true }); });
});
