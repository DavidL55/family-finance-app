// Pure core of `bootstrap-live.ts --ensure-access` (spec C1 §5). The emulator's auth users carry
// role/memberId claims (set by bootstrap-live / provision-auth-users); the rules now read
// access/{uid} instead. This decides which access docs to write so that a second run writes 0.
export type AccessRole = 'super-admin' | 'parent' | 'member';
export interface AuthUserClaims { uid: string; email: string; role: unknown; memberId: unknown }
export interface ExistingAccess { role: string; memberId: string }
export interface AccessWrite { uid: string; email: string; role: AccessRole; memberId: string; reason: 'missing' | 'changed' }

const ROLES: readonly AccessRole[] = ['super-admin', 'parent', 'member'];
const isRole = (v: unknown): v is AccessRole => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

export function planAccessWrites(users: AuthUserClaims[], existing: ReadonlyMap<string, ExistingAccess | null>): AccessWrite[] {
  const writes: AccessWrite[] = [];
  for (const u of users) {
    if (!isRole(u.role) || typeof u.memberId !== 'string' || u.memberId.length === 0) continue;
    const have = existing.get(u.uid) ?? null;
    if (have && have.role === u.role && have.memberId === u.memberId) continue;
    writes.push({ uid: u.uid, email: u.email, role: u.role, memberId: u.memberId, reason: have ? 'changed' : 'missing' });
  }
  return writes;
}
