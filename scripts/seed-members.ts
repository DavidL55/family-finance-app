// Task 6 (Stage 1, Part A) proof/bootstrap: seeds the `members` collection from
// `settings/budgetConfig.members`, or from the app's historical default (דויד/לילית/עומר) when
// budgetConfig has no members array yet.
//
// Connection: this script runs under `npx tsx` (plain Node, not Vite), so — same reasoning as
// scripts/migrate-transactions.ts — it deliberately does NOT import `src/services/firebase.ts`
// (which reads `import.meta.env`, only defined under Vite) or `src/services/MembersService.ts`
// (which imports firebase.ts). It only imports the pure, dependency-free
// `seedFromBudgetConfig`/`DEFAULT_MEMBER_SEED` from `src/utils/seedFromBudgetConfig.ts`.
//
// Auth (Stage 2 update): this script now uses the Firebase Admin SDK, which BYPASSES Firestore
// Security Rules entirely — the same trust boundary scripts/provision-auth-users.ts and
// scripts/migrate-transactions.ts operate at, and the same reasoning as those two: there is no
// other trusted actor before the first super-admin exists, and this is a local-machine-only
// script run by whoever has shell access, never shipped to the client bundle. It previously
// signed in anonymously against the Auth emulator to satisfy the old permissive
// `request.auth != null` rule; the new Stage 2 rules key off custom claims an anonymous user
// will never have, so anonymous sign-in no longer works here and has been removed entirely in
// favor of the Admin SDK's unconditional bypass.
//
// Usage:
//   npx tsx scripts/seed-members.ts            # dry run (default) — no writes, no backup file
//   npx tsx scripts/seed-members.ts --apply     # writes backup + seeds for real
//
// Data-safety rules (non-negotiable, mirrored from migrate-transactions.ts):
//   - Dry-run is the default. Nothing is written — not to Firestore, not to disk — until --apply.
//   - Before any Firestore write, the pre-write state of the `members` collection (empty, by
//     construction — see below) is backed up to backups/*.json and verified by reading it back,
//     same as the transactions migration, even though this path is purely additive.
//   - Never lose a member: this script only ever runs when the `members` collection is empty
//     (ensureSeeded()'s own idempotency check, reproduced here), so there is nothing existing to
//     overwrite or drop. If members already exist, the script reports that and does nothing.
//   - Idempotent: member doc ids come from seedFromBudgetConfig (stable per the legacy id, or a
//     deterministic fallback), so re-running --apply is safe.

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { DEFAULT_MEMBER_SEED, seedFromBudgetConfig } from '../src/utils/seedFromBudgetConfig';

const PROJECT_ID = 'demo-familyfinance';

const apply = process.argv.includes('--apply');

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

function backupPreState(docsData: unknown[]): string {
  mkdirSync('backups', { recursive: true });
  const backupPath = `backups/members-preseed-${new Date().toISOString().replace(/:/g, '-')}.json`;
  writeFileSync(backupPath, JSON.stringify(docsData, null, 2));

  // Verify: read the backup back and confirm the record count round-trips before touching
  // Firestore. A backup that can't be read back is not a backup.
  const readBack = JSON.parse(readFileSync(backupPath, 'utf-8')) as unknown[];
  if (readBack.length !== docsData.length) {
    throw new Error(
      `Backup verification failed: wrote ${docsData.length} records but read back ${readBack.length} from ${backupPath}. Aborting before any Firestore write.`
    );
  }

  return backupPath;
}

async function main() {
  const existingSnap = await db.collection('members').get();
  console.log(`existing 'members' docs: ${existingSnap.size}`);
  if (!existingSnap.empty) {
    console.log(
      "members collection is already seeded — ensureSeeded()'s idempotency check makes this a no-op. Nothing to do."
    );
    existingSnap.docs.forEach((d) => console.log(`  ${d.id}: ${JSON.stringify(d.data())}`));
    return;
  }

  const cfgSnap = await db.collection('settings').doc('budgetConfig').get();
  const cfgData = cfgSnap.exists ? (cfgSnap.data() as { members?: unknown }) : null;
  const hasLegacyMembers = Array.isArray(cfgData?.members) && (cfgData!.members as unknown[]).length > 0;
  const source: unknown = hasLegacyMembers ? cfgData : { members: DEFAULT_MEMBER_SEED };

  console.log(
    hasLegacyMembers
      ? `seeding from settings/budgetConfig.members (${(cfgData!.members as unknown[]).length} legacy entries)`
      : "settings/budgetConfig has no members array — falling back to the default seed (דויד/לילית/עומר)"
  );

  const members = seedFromBudgetConfig(source);
  console.log(`\ncomputed ${members.length} member doc(s):`);
  members.forEach((m) => console.log(`  ${m.id}  ${m.name}  ${m.role}  color=${m.color}  groups=${JSON.stringify(m.groups)}`));

  if (members.length === 0) {
    console.log('\nnothing recoverable to seed.');
    return;
  }

  if (!apply) {
    console.log(
      `\nDRY RUN: no backup file written, no Firestore writes performed. ${members.length} member doc(s) would be created in 'members'. Re-run with --apply to write.`
    );
    return;
  }

  // archive-before-overwrite, mirrored from migrate-transactions.ts. This path is purely
  // additive (members was empty), so the "pre-state" backup is the empty baseline itself —
  // kept uniform with the migration script's safety habit rather than special-cased away.
  const backupPath = backupPreState([]);
  console.log(`\nbackup written and verified: ${backupPath} (0 pre-existing records)`);

  const batch = db.batch();
  members.forEach((m) => batch.set(db.collection('members').doc(m.id), m));
  await batch.commit();

  console.log(`\nseeded ${members.length} member doc(s) into 'members'.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
