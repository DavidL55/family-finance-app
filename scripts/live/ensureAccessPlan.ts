// Pure core of `bootstrap-live.ts --ensure-access` (spec C1 §5). The emulator's auth users carry
// role/memberId claims (set by bootstrap-live / provision-auth-users); the rules now read
// access/{uid} instead. This decides which access docs to write so that a second run writes 0.
//
// ADDITIVE ONLY: ensure-access never deletes an access doc. Removing a user's claims (or the user)
// therefore does NOT revoke live access, and deleting access/{uid} alone does not either — the
// claims remain, so the next start writes the doc straight back. Live revocation = remove the
// user's claims AND delete the access doc.
export type AccessRole = 'super-admin' | 'parent' | 'member';
// claimsError is set by the caller when customAttributes was present but not parseable JSON.
export interface AuthUserClaims { uid: string; email: string; role: unknown; memberId: unknown; claimsError?: string }
export interface ExistingAccess { role: string; memberId: string }
export interface AccessWrite { uid: string; email: string; role: AccessRole; memberId: string; reason: 'missing' | 'changed' }

const ROLES: readonly AccessRole[] = ['super-admin', 'parent', 'member'];
const isRole = (v: unknown): v is AccessRole => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

// A user the plan could not write for. `hasAccess` = an access doc already exists, so the member
// still gets in; without one they will see "לא משויך". `partialClaims` = some role/memberId claim is
// present but unusable (or customAttributes is unparseable) — a provisioning fault, not a stray sign-up.
export interface SkippedUser { uid: string; email: string; reason: string; hasAccess: boolean; partialClaims: boolean }
export interface AccessPlan { writes: AccessWrite[]; skipped: SkippedUser[] }

// Fully claimless users (no role, no memberId, readable attributes) are not provisioned family
// members; partial = anything else that failed skipReason.
const hasPartialClaims = (u: AuthUserClaims): boolean =>
  u.claimsError !== undefined || u.role !== undefined || u.memberId !== undefined;

function skipReason(u: AuthUserClaims): string | null {
  if (u.claimsError) return `customAttributes unreadable (${u.claimsError})`;
  if (!isRole(u.role)) return `no valid role claim (${JSON.stringify(u.role) ?? 'missing'})`;
  if (typeof u.memberId !== 'string' || u.memberId.length === 0) return 'no memberId claim';
  return null;
}

export function planAccessWrites(users: AuthUserClaims[], existing: ReadonlyMap<string, ExistingAccess | null>): AccessPlan {
  const writes: AccessWrite[] = [];
  const skipped: SkippedUser[] = [];
  for (const u of users) {
    const have = existing.get(u.uid) ?? null;
    const reason = skipReason(u);
    if (reason !== null) { skipped.push({ uid: u.uid, email: u.email, reason, hasAccess: have !== null, partialClaims: hasPartialClaims(u) }); continue; }
    if (!isRole(u.role) || typeof u.memberId !== 'string') continue; // narrowing only; skipReason covered it
    if (have && have.role === u.role && have.memberId === u.memberId) continue;
    writes.push({ uid: u.uid, email: u.email, role: u.role, memberId: u.memberId, reason: have ? 'changed' : 'missing' });
  }
  return { writes, skipped };
}

// A skipped user with no access doc is BLOCKING only when it is a real provisioning fault: one of the
// FAMILY addresses (lower-case set from family.ts) or a user with partial/invalid claims. Any other
// claimless user (a stray sign-up through the login screen in live mode) is info only — otherwise one
// stray account would make every later desktop press warn forever.
export const blockingSkipped = (plan: AccessPlan, familyEmails: ReadonlySet<string>): SkippedUser[] =>
  plan.skipped.filter((u) => !u.hasAccess && (u.partialClaims || familyEmails.has(u.email.toLowerCase())));
