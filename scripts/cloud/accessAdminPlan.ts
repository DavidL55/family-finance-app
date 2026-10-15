import { FAMILY } from '../live/family';

const ROLES = ['super-admin', 'parent', 'member'] as const;
type Role = (typeof ROLES)[number];
const DAY_MS = 24 * 60 * 60 * 1000;

export function planOwnerBootstrap(input: { superAdminCount: number; existingMemberIds: string[] }):
  { ok: true; membersToCreate: string[] } | { ok: false; reason: string } {
  if (input.superAdminCount > 0) return { ok: false, reason: 'a super-admin already exists — bootstrap runs once.' };
  const have = new Set(input.existingMemberIds);
  return { ok: true, membersToCreate: FAMILY.map((m) => m.memberId).filter((id) => !have.has(id)) };
}

export interface InviteDraft { email: string; memberId: string; role: Role; createdBy: string; createdAtMs: number; expiresAtMs: number }

export function buildInvite(input: {
  email: string; memberId: string; role: string; days: number; createdBy: string; now: Date;
  memberExists: boolean; existing: { usedBy?: string; expiresAtMs: number } | null;
}): { ok: true; id: string; doc: InviteDraft } | { ok: false; reason: string } {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: `invalid email "${input.email}"` };
  if (!(ROLES as readonly string[]).includes(input.role)) return { ok: false, reason: `unknown role "${input.role}"` };
  if (!input.memberExists) return { ok: false, reason: `members/${input.memberId} does not exist` };
  if (!Number.isInteger(input.days) || input.days < 1) return { ok: false, reason: `--days must be a positive whole number, got "${input.days}"` };
  const now = input.now.getTime();
  if (input.existing && !input.existing.usedBy && input.existing.expiresAtMs > now) {
    return { ok: false, reason: `an unused invite for ${email} is still valid — revoke/delete it first` };
  }
  return { ok: true, id: email, doc: {
    email, memberId: input.memberId, role: input.role as Role, createdBy: input.createdBy,
    createdAtMs: now, expiresAtMs: now + input.days * DAY_MS,
  } };
}

export function planRevoke(uid: string, all: Array<{ uid: string; role: string }>): { ok: true } | { ok: false; reason: string } {
  const target = all.find((a) => a.uid === uid);
  if (!target) return { ok: false, reason: `access/${uid} does not exist` };
  if (target.role === 'super-admin' && all.filter((a) => a.role === 'super-admin').length === 1) {
    return { ok: false, reason: 'refusing to revoke the last super-admin' };
  }
  return { ok: true };
}
