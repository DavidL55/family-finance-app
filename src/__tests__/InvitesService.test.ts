import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getDoc: vi.fn(), doc: vi.fn((_db, ...p: string[]) => p.join('/')), writeBatch: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TS'), update: vi.fn(), set: vi.fn(), commit: vi.fn(),
}));
vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  getDoc: m.getDoc, doc: m.doc, serverTimestamp: m.serverTimestamp,
  writeBatch: () => ({ update: m.update, set: m.set, commit: m.commit }),
}));

import { redeemMyInvite } from '../services/InvitesService';

const user = (over: Record<string, unknown> = {}) => ({
  uid: 'u-guest', email: 'Guest.Person@Gmail.com', emailVerified: true,
  reload: vi.fn().mockResolvedValue(undefined), getIdToken: vi.fn().mockResolvedValue('t'), ...over,
}) as never;
const inviteSnap = (data: Record<string, unknown> | null) => ({ exists: () => data != null, data: () => data });
const future = { toMillis: () => Date.now() + 1e9 };
const past = { toMillis: () => Date.now() - 1 };

beforeEach(() => { Object.values(m).forEach((f) => f.mockClear()); m.commit.mockResolvedValue(undefined); });

describe('redeemMyInvite', () => {
  it('refreshes the token before reading, then commits ONE batch keyed by the lower-cased email', async () => {
    const u = user();
    m.getDoc.mockResolvedValue(inviteSnap({ memberId: 'omer-levy', role: 'member', expiresAt: future }));
    expect(await redeemMyInvite(u)).toEqual({ ok: true });
    expect((u as { reload: ReturnType<typeof vi.fn> }).reload).toHaveBeenCalled();
    expect((u as { getIdToken: ReturnType<typeof vi.fn> }).getIdToken).toHaveBeenCalledWith(true);
    expect(m.doc).toHaveBeenCalledWith({}, 'invites', 'guest.person@gmail.com');
    expect(m.update).toHaveBeenCalledWith('invites/guest.person@gmail.com', { usedBy: 'u-guest', usedAt: 'SERVER_TS' });
    expect(m.set).toHaveBeenCalledWith('access/u-guest', {
      uid: 'u-guest', memberId: 'omer-levy', role: 'member', email: 'guest.person@gmail.com',
      grantedAt: 'SERVER_TS', grantedVia: 'guest.person@gmail.com',
    });
    expect(m.commit).toHaveBeenCalledTimes(1);
  });
  it('call order (Review Focus 3): reload() → getIdToken(true) → getDoc → batch commit', async () => {
    const u = user() as unknown as { reload: ReturnType<typeof vi.fn>; getIdToken: ReturnType<typeof vi.fn> };
    m.getDoc.mockResolvedValue(inviteSnap({ memberId: 'omer-levy', role: 'member', expiresAt: future }));
    await redeemMyInvite(u as never);
    const at = (f: ReturnType<typeof vi.fn>) => f.mock.invocationCallOrder[0];
    expect(at(u.reload)).toBeLessThan(at(u.getIdToken));
    expect(at(u.getIdToken)).toBeLessThan(at(m.getDoc));
    expect(at(m.getDoc)).toBeLessThan(at(m.commit));
  });
  it('not verified → no read, no write', async () => {
    expect(await redeemMyInvite(user({ emailVerified: false }))).toMatchObject({ ok: false, reason: 'not-verified' });
    expect(m.getDoc).not.toHaveBeenCalled();
  });
  it('no invite → no-invite', async () => {
    m.getDoc.mockResolvedValue(inviteSnap(null));
    expect(await redeemMyInvite(user())).toMatchObject({ ok: false, reason: 'no-invite' });
  });
  it('expired → expired, nothing written', async () => {
    m.getDoc.mockResolvedValue(inviteSnap({ memberId: 'omer-levy', role: 'member', expiresAt: past }));
    expect(await redeemMyInvite(user())).toMatchObject({ ok: false, reason: 'expired' });
    expect(m.commit).not.toHaveBeenCalled();
  });
  it('used → used', async () => {
    m.getDoc.mockResolvedValue(inviteSnap({ memberId: 'omer-levy', role: 'member', expiresAt: future, usedBy: 'someone' }));
    expect(await redeemMyInvite(user())).toMatchObject({ ok: false, reason: 'used' });
  });
  it('a rejected commit is "failed", never success', async () => {
    m.getDoc.mockResolvedValue(inviteSnap({ memberId: 'omer-levy', role: 'member', expiresAt: future }));
    m.commit.mockRejectedValue(new Error('permission-denied'));
    expect(await redeemMyInvite(user())).toMatchObject({ ok: false, reason: 'failed' });
  });
});
