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

export function roleFor(memberId: string, memberRole: Member['role']): PermissionRole {
  if (memberId === SUPER_ADMIN_MEMBER_ID) return 'super-admin';
  return memberRole === 'הורה' ? 'parent' : 'member';
}
