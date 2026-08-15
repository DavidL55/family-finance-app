// Migration: legacy `transactions` collection -> canonical `transaction_lines` collection.
//
// Connection: this script runs under `npx tsx` (plain Node, not Vite), so it deliberately does
// NOT import `src/services/firebase.ts` — that module reads `import.meta.env`, which only exists
// under Vite. Instead it initializes its own minimal Firebase JS (client) SDK app and points it
// at the emulator with `connectFirestoreEmulator`/`connectAuthEmulator`, wired up by hand for a
// Node entrypoint. No `firebase-admin` dependency needed (it isn't installed in this project).
//
// firestore.rules requires `request.auth != null` on both `transactions` and `transaction_lines`
// — the client SDK does NOT bypass security rules just because it's talking to the emulator (only
// firebase-admin gets that super-user treatment). So this script signs in anonymously against the
// Auth emulator before touching Firestore, exactly satisfying the rule.
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

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  getDocs,
  doc,
  writeBatch,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { migrateLegacyTransaction } from '../src/utils/migrateLegacyTransaction';

const PROJECT_ID = 'demo-familyfinance';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8080;
const AUTH_EMULATOR_URL = 'http://127.0.0.1:9099';
const BATCH_SIZE = 400; // Firestore batch write hard limit is 500; stay well under it.

const apply = process.argv.includes('--apply');

const app = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-key' });
const db = getFirestore(app);
connectFirestoreEmulator(db, FIRESTORE_HOST, FIRESTORE_PORT);
const auth = getAuth(app);
connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true });

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
  await signInAnonymously(auth);

  const legacySnap = await getDocs(collection(db, 'transactions'));
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
    const { line, warnings } = migrateLegacyTransaction(legacyDoc.data(), legacyDoc.id);
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

  let batch = writeBatch(db);
  let inBatch = 0;
  for (const { legacyId, line } of migratedLines) {
    batch.set(doc(db, 'transaction_lines', `migrated-${legacyId}`), line);
    if (++inBatch === BATCH_SIZE) {
      await batch.commit();
      batch = writeBatch(db);
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();

  console.log(`migrated: ${migratedLines.length}, warnings: ${allWarnings.length}`);
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
