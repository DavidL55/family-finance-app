// Provisions real per-member Auth-emulator accounts and the server-verified permission role
// (Design decisions D1/D6/D7). Uses the Admin SDK, which BYPASSES Firestore Security Rules —
// this is the one place in the app allowed to write `members/{id}.uid` and set custom claims,
// because there is no other trusted actor before the first super-admin exists (D6). Run by
// whoever has shell access to David's machine, the same trust boundary
// scripts/seed-members.ts and scripts/migrate-transactions.ts already operate at.
//
// The Member.role -> PermissionRole mapping (D1) lives in the pure, unit-tested
// src/utils/provisionRole.ts, not inline here — see src/__tests__/provisionRole.test.ts.
//
// Usage:
//   npx tsx scripts/provision-auth-users.ts            # dry run — prints the plan, writes nothing
//   npx tsx scripts/provision-auth-users.ts --apply     # creates/links for real
//
// Idempotent: re-running --apply skips any member whose `uid` is already linked (it does not
// create a duplicate Auth user or re-seed the D8 default matrix for it), but always
// re-asserts custom claims for an already-existing Auth user found by email, so a claims
// change (e.g. a fixed SUPER_ADMIN_MEMBER_ID typo) can be re-applied by re-running the script.
//
// Requires the Auth + Firestore emulators running (npm run emu) and hard-targets them via the
// env vars below — this script structurally cannot reach a real cloud project, since it never
// reads real project credentials and only ever calls admin.initializeApp({ projectId }).

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { roleFor, SUPER_ADMIN_MEMBER_ID, PROVISIONING_EMAIL_DOMAIN } from '../src/utils/provisionRole';
import type { Member } from '../src/utils/seedFromBudgetConfig';
import type { ModulePermissionMap } from '../src/types/permissions';

const PROJECT_ID = 'demo-familyfinance';
const DEV_PASSWORD = 'FamilyFinance2026!'; // emulator-only; never used against a real project

const apply = process.argv.includes('--apply');

initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

// D8 — permissive-by-default matrix seeded for every existing 'ילד' member on first
// provisioning, so Stage 2's rollout does not regress today's working Dashboard access.
const D8_DEFAULT_CHILD_MODULES: ModulePermissionMap = {
  expenses: { view: 'family', edit: 'none' },
  income: { view: 'family', edit: 'none' },
  investments: { view: 'family', edit: 'none' },
  goals: { view: 'family', edit: 'none' },
};

interface ProvisionPlanEntry {
  id: string;
  name: string;
  email: string;
  role: ReturnType<typeof roleFor>;
  alreadyLinked: boolean;
}

async function main() {
  const membersSnap = await db.collection('members').get();
  if (membersSnap.empty) {
    console.log('No members found — run scripts/seed-members.ts first.');
    return;
  }

  const plan: ProvisionPlanEntry[] = membersSnap.docs.map((d) => {
    const m = d.data() as Member;
    return {
      id: d.id,
      name: m.name,
      email: `${d.id}@${PROVISIONING_EMAIL_DOMAIN}`,
      role: roleFor(d.id, m.role),
      alreadyLinked: Boolean(m.uid),
    };
  });

  console.log('Provisioning plan:');
  plan.forEach((p) =>
    console.log(`  ${p.id} (${p.name}) -> ${p.email} role=${p.role} ${p.alreadyLinked ? '[already linked]' : ''}`)
  );

  if (!apply) {
    console.log('\nDRY RUN: no users created, no claims set, no writes. Re-run with --apply.');
    return;
  }

  for (const p of plan) {
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(p.email);
    } catch {
      userRecord = await auth.createUser({ email: p.email, password: DEV_PASSWORD, displayName: p.name });
      console.log(`created auth user ${p.email} (uid=${userRecord.uid})`);
    }

    // Claims are re-asserted every run (not skipped when alreadyLinked) so a corrected mapping
    // (e.g. SUPER_ADMIN_MEMBER_ID) can be re-applied without deleting/recreating the Auth user.
    await auth.setCustomUserClaims(userRecord.uid, { role: p.role, memberId: p.id });
    await db.collection('members').doc(p.id).set({ uid: userRecord.uid }, { merge: true });
    console.log(`linked ${p.id} -> uid=${userRecord.uid}, role=${p.role}`);

    if (p.alreadyLinked) {
      console.log(`skip D8 seeding for ${p.id}: already linked (matrix only seeded once, on first link)`);
      continue;
    }

    // D8 — seed a permissive default exception for existing 'ילד' members so Stage 2's rollout
    // does not regress today's working Dashboard access. super-admin/parent need no matrix entry
    // (Rules bypass the matrix for them entirely).
    if (p.role === 'member') {
      const now = new Date().toISOString();
      await db.collection('permissions').doc(`member__${p.id}`).set({
        id: `member__${p.id}`,
        scope: 'member',
        targetId: p.id,
        modules: D8_DEFAULT_CHILD_MODULES,
        updatedAt: now,
        updatedBy: SUPER_ADMIN_MEMBER_ID,
      });
      await db.collection('members').doc(p.id).set(
        { resolvedPermissions: D8_DEFAULT_CHILD_MODULES },
        { merge: true }
      );
      console.log(`  seeded default D8 permissive-view matrix for ${p.id}`);
    }
  }

  console.log(`\nDone. Sign in at the app with any of the emails above and password: ${DEV_PASSWORD}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
