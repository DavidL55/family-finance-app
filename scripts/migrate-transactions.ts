// Migration: legacy `transactions` collection -> canonical `transaction_lines` collection.
//
// Connection: this script runs under `npx tsx` (plain Node, not Vite), so it deliberately does
// NOT import `src/services/firebase.ts` — that module reads `import.meta.env`, which only exists
// under Vite.
//
// Auth (Stage 2 update): this script now uses the Firebase Admin SDK, which BYPASSES Firestore
// Security Rules entirely — the same trust boundary scripts/provision-auth-users.ts and
// scripts/seed-members.ts operate at: there is no other trusted actor before the first
// super-admin exists, and this is a local-machine-only script run by whoever has shell access to
// David's machine, never shipped to the client bundle. It previously signed in anonymously
// against the Auth emulator to satisfy the old permissive `request.auth != null` rule on
// `transactions`/`transaction_lines`; the new Stage 2 rules key off custom claims an anonymous
// user will never have, so anonymous sign-in no longer works here and has been removed entirely
// in favor of the Admin SDK's unconditional bypass.
//
// Usage:
//   npx tsx scripts/migrate-transactions.ts            # dry run (default) — no writes, no backup file
//   npx tsx scripts/migrate-transactions.ts --apply     # writes backup + migrates for real
//
// Data-safety rules (non-negotiable):
//   - Dry-run is the default. Nothing is written — not to Firestore, not to disk — until --apply.
//   - Before any Firestore write, the legacy collection is backed up to backups/*.json, and the
//     backup is verified by reading it back and comparing record counts before proceeding.
//   - No row is ever dropped: migrateLegacyTransaction() maps unknown categories to שונות with a
//     warning instead of skipping the doc.
//   - Idempotent: the new doc id is derived from the legacy doc id (`migrated-<legacyId>`), so
//     re-running --apply overwrites the same docs rather than creating duplicates.

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { migrateLegacyTransaction } from '../src/utils/migrateLegacyTransaction';

const PROJECT_ID = 'demo-familyfinance';
const BATCH_SIZE = 400; // Firestore batch write hard limit is 500; stay well under it.

const apply = process.argv.includes('--apply');

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

function backupLegacyDocs(docsData: Array<{ id: string } & Record<string, unknown>>): string {
  mkdirSync('backups', { recursive: true });
  const backupPath = `backups/transactions-${new Date().toISOString().replace(/:/g, '-')}.json`;
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
  // Stage 7 T3 (D21e) — `migrateLegacyTransaction` now stamps `period` and `ownerId`, and takes
  // the member list as a REQUIRED argument so it can resolve `owner` (a display name) to a
  // `members.id`. Read once here rather than per row. An empty `members` collection is not fatal:
  // every row is stamped `ownerId: 'unknown'`, which is visible, counted below, and fixed by
  // running `scripts/backfill-transaction-periods.ts` afterwards — the same degradation the app's
  // own import path takes, for the same reason.
  const memberSnap = await db.collection('members').get();
  const members = memberSnap.docs.map((d) => ({ id: d.id, name: (d.data() as { name?: string }).name }));
  console.log(`members found for ownerId resolution: ${members.length}`);

  const legacySnap = await db.collection('transactions').get();
  const legacyDocsData = legacySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`legacy docs found: ${legacySnap.size}`);

  if (legacySnap.size === 0) {
    console.log('nothing to migrate.');
    return;
  }

  // Compute the migration in memory regardless of mode, so dry-run can report an accurate
  // preview (category breakdown + warnings) without writing anything anywhere.
  const allWarnings: string[] = [];
  const categoryCounts: Record<string, number> = {};
  const migratedLines: Array<{ legacyId: string; line: Record<string, unknown> }> = [];

  for (const legacyDoc of legacySnap.docs) {
    const { line, warnings } = migrateLegacyTransaction(legacyDoc.data(), legacyDoc.id, members);
    allWarnings.push(...warnings);
    const cat = String(line.category);
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    migratedLines.push({ legacyId: legacyDoc.id, line });
  }

  console.log('\n--- migration summary ---');
  console.log(`legacy docs: ${legacySnap.size}`);
  console.log(`warnings: ${allWarnings.length}`);
  allWarnings.forEach((w) => console.warn(`  ! ${w}`));
  console.log('category breakdown (post-migration):');
  Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => console.log(`  ${cat}: ${count}`));
  console.log('--------------------------\n');

  if (!apply) {
    console.log(
      `DRY RUN: no backup file written, no Firestore writes performed. ${legacySnap.size} doc(s) would be migrated to 'transaction_lines'. Re-run with --apply to write.`
    );
    return;
  }

  // archive-before-overwrite (Global Constraints / Boris flavor doc): back up the legacy
  // collection to disk and verify it before writing anything to Firestore.
  const backupPath = backupLegacyDocs(legacyDocsData);
  console.log(`backup written and verified: ${backupPath} (${legacyDocsData.length} records)`);

  let batch = db.batch();
  let inBatch = 0;
  for (const { legacyId, line } of migratedLines) {
    batch.set(db.collection('transaction_lines').doc(`migrated-${legacyId}`), line);
    if (++inBatch === BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();

  const unknownPeriods = migratedLines.filter(({ line }) => line.period === 'unknown').length;
  const unknownOwners = migratedLines.filter(({ line }) => line.ownerId === 'unknown').length;
  console.log(`migrated: ${migratedLines.length}, warnings: ${allWarnings.length}`);
  console.log(`period 'unknown': ${unknownPeriods}, ownerId 'unknown': ${unknownOwners}`);
  console.log(
    "legacy 'transactions' collection left in place; deleted only in Task 5 after dual-read removal ships."
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
