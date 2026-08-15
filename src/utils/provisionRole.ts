// Pure mapping: Stage 1's Member.role (family-relationship/display field) -> the server-verified
// PermissionRole that scripts/provision-auth-users.ts sets as a Firebase Auth custom claim.
// Kept dependency-free (no Admin SDK import) so it can be unit-tested directly and imported
// from a plain `npx tsx` Node script, exactly the split seedFromBudgetConfig.ts/
// migrateLegacyTransaction.ts already established: pure logic in src/utils/, Firestore/Auth I/O
// in the script that calls it.
//
// Design decision D1: Member.role MUST NOT be used for any authorization decision by itself —
// only this mapping's *output* (delivered as a custom claim) is ever consulted by Firestore
// Rules or the client's authorization checks. Design decision D6: the super-admin id is an
// explicit constant, never inferred from data — checked BEFORE the הורה/ילד mapping so a
// tampered or stale Member.role document can never demote or promote the one hardcoded
// super-admin account.

import type { Member } from './seedFromBudgetConfig';
import type { PermissionRole } from '../types/permissions';

// D6 — the very first super-admin is an explicit constant, never inferred from data.
export const SUPER_ADMIN_MEMBER_ID = 'david-levy';

// D7 — local-only placeholder email domain for Auth-emulator accounts, not a real mailbox.
export const PROVISIONING_EMAIL_DOMAIN = 'familyfinance.local';

const VALID_MEMBER_ROLES = new Set<Member['role']>(['הורה', 'ילד']);

export function roleFor(memberId: string, memberRole: Member['role']): PermissionRole {
  if (memberId === SUPER_ADMIN_MEMBER_ID) return 'super-admin';
  // D1 hardening, matching sanitizeLevel's style in resolvePermissions.ts: the type says
  // memberRole is always 'הורה' | 'ילד', but the value crosses the Firestore boundary as
  // `d.data() as Member` — a hand-edited or corrupt doc can carry anything at runtime. The
  // fallback to 'member' is already fail-closed (least privilege); this only makes a silent
  // coercion visible instead of hiding a data-quality problem.
  if (!VALID_MEMBER_ROLES.has(memberRole)) {
    console.warn(
      `[provisionRole] coerced out-of-union role "${String(memberRole)}" to "member" (member ${memberId})`
    );
    return 'member';
  }
  return memberRole === 'הורה' ? 'parent' : 'member';
}
