// Task 6 (Stage 1, Part A) proof/bootstrap: seeds the `members` collection from
// `settings/budgetConfig.members`, or from the app's historical default (דויד/לילית/עומר) when
// budgetConfig has no members array yet.
//
// Connection: this script runs under `npx tsx` (plain Node, not Vite), so — same reasoning as
// scripts/migrate-transactions.ts — it deliberately does NOT import `src/services/firebase.ts`
// (which reads `import.meta.env`, only defined under Vite) or `src/services/MembersService.ts`
// (which imports firebase.ts). It only imports the pure, dependency-free
// `seedFromBudgetConfig`/`DEFAULT_MEMBER_SEED` from `src/utils/seedFromBudgetConfig.ts` and
// wires up its own minimal Firebase JS (client) SDK app pointed at the emulator, exactly like
// migrate-transactions.ts does. No `firebase-admin` dependency needed (it isn't installed).
//
// firestore.rules requires `request.auth != null` on `members` (and `settings`) — the client
// SDK does not bypass security rules against the emulator, so this script signs in anonymously
// against the Auth emulator first.
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

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  getDocs,
  getDoc,
  doc,
  writeBatch,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { DEFAULT_MEMBER_SEED, seedFromBudgetConfig } from '../src/utils/seedFromBudgetConfig';

const PROJECT_ID = 'demo-familyfinance';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8080;
const AUTH_EMULATOR_URL = 'http://127.0.0.1:9099';

const apply = process.argv.includes('--apply');

const app = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-key' });
const db = getFirestore(app);
connectFirestoreEmulator(db, FIRESTORE_HOST, FIRESTORE_PORT);
const auth = getAuth(app);
connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true });

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
  await signInAnonymously(auth);

  const existingSnap = await getDocs(collection(db, 'members'));
  console.log(`existing 'members' docs: ${existingSnap.size}`);
  if (!existingSnap.empty) {
    console.log(
      "members collection is already seeded — ensureSeeded()'s idempotency check makes this a no-op. Nothing to do."
    );
    existingSnap.docs.forEach((d) => console.log(`  ${d.id}: ${JSON.stringify(d.data())}`));
    return;
  }

  const cfgSnap = await getDoc(doc(db, 'settings', 'budgetConfig'));
  const cfgData = cfgSnap.exists() ? (cfgSnap.data() as { members?: unknown }) : null;
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

  const batch = writeBatch(db);
  members.forEach((m) => batch.set(doc(db, 'members', m.id), m));
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
