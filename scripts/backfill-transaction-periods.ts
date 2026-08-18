// Stage 7 T3 — the `period` / `ownerId` backfill. THE ONE TASK IN THIS STAGE THAT WRITES TO THE
// FAMILY'S ONLY LEDGER.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// !! WHY THIS RUNS ON THE ADMIN SDK, AND WHY IT COULD NOT RUN ANY OTHER WAY
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// D21(d) — shipped in T2 — makes `period` and `ownerId` IMMUTABLE on `transaction_lines`, as
// conjuncts of `allow update` itself, deliberately OUTSIDE the `isSuperAdmin() || isParent() ||
// (…)` alternation. Its `.get(field, null)` shape denies ADDING either field to a row that lacked
// it. That is not an oversight — it is the whole mechanism that stops `period` ever drifting away
// from `date`, and nothing in the app performs a live `transaction_lines` update, so nothing
// breaks.
//
// THE BACKFILL IS EXACTLY SUCH AN UPDATE. Its entire job is to add those two fields to every
// existing row. Run through ANY client session — including the super-admin's, the strongest this
// app can produce — IT DENIES ITSELF ON ITS FIRST WRITE. Neither the plan, the adjudication nor T0
// says this out loud; the T2 review found it by reading the rule it had just shipped.
//
// The Admin SDK bypasses Security Rules entirely, which is why this script can do what no session
// in the app can. That is the same trust boundary `scripts/migrate-transactions.ts`,
// `scripts/seed-members.ts` and `scripts/provision-auth-users.ts` already operate at, and its own
// header states the reasoning: a local-machine-only script, run by whoever has shell access to
// David's machine, never shipped to the client bundle.
//
// The claim is not asserted here, it is EXECUTABLE:
// `firestore-tests/transaction-history.rules.test.ts` proves on a live emulator that a super-admin
// client is DENIED this exact write and that a rules-bypassing context is ALLOWED it. If a future
// change makes the client write succeed, that test goes red — and it should, because a
// client-writable `period` is a `period` that can diverge from `date`.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// DATA-SAFETY RULES (non-negotiable, inherited verbatim from migrate-transactions.ts)
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//   - Dry run is the DEFAULT. Nothing is written — not to Firestore, not to disk — until --apply.
//   - Before any Firestore write, every collection this script touches is backed up to
//     backups/*.json and the backup is VERIFIED by reading it back and comparing record counts.
//     A backup that cannot be read back is not a backup.
//   - No row is ever dropped, skipped or emptied. Every row gets a `period`; a row whose `date`
//     cannot be read gets `'unknown'`, which is a QUERIED value the read path returns, not a
//     tombstone.
//   - IDEMPOTENT. A row already carrying the exact values this run would write is not written
//     again, so a second `--apply` commits nothing and reports zero.
//   - Batched at 400. Firestore's hard limit is 500; `migrate-transactions.ts:38` set the
//     precedent and D21(d) names the number.
//   - The completion marker is written LAST, after every batch has committed. If any batch fails,
//     the marker is absent, and the statistical layer's refusal — which is the default from the
//     first boot, since T0 confirmed `settings/migrationState` does not exist — simply stays on.
//     A half-done backfill therefore fails CLOSED, which is the property that matters most here:
//     an untouched row has no `period` at all, so `where('period','in',[…])` cannot return it and
//     no downstream instrument can see that the corpus is incomplete.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// USAGE
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//   npx tsx scripts/backfill-transaction-periods.ts                    # dry run (default)
//   npx tsx scripts/backfill-transaction-periods.ts --apply            # backup, then write
//   npx tsx scripts/backfill-transaction-periods.ts --project=<id>     # target another project
//   npx tsx scripts/backfill-transaction-periods.ts --max-unknown=N    # raise the failure floor
//
// Runs under `npx tsx` (plain Node, not Vite), so it deliberately does NOT import
// `src/services/firebase.ts` — that module reads `import.meta.env`, which only exists under Vite.
// The three helpers it does import (`periodOrUnknown`, `periodOrUnknownFromMonthYear`,
// `resolveOwnerId`) are pure and Firebase-free precisely so this file can share them rather than
// re-implement the two decisions that decide which month a row lands in and whose it is.

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import {
  DEFAULT_MAX_UNKNOWN,
  backfillThresholdCheck,
  planBackfill,
  type RawDoc,
} from '../src/utils/backfillPlan';
import {
  MIGRATION_STATE_DOC,
  TRANSACTION_PERIOD_BACKFILL_KEY,
} from '../src/utils/backfillMarker';

/** Firestore's batch hard limit is 500. `migrate-transactions.ts:38`'s precedent, named by D21(d). */
const BATCH_SIZE = 400;

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const projectArg = argv.find((a) => a.startsWith('--project='));
const maxUnknownArg = argv.find((a) => a.startsWith('--max-unknown='));

const PROJECT_ID = projectArg ? projectArg.slice('--project='.length) : 'demo-familyfinance';
const MAX_UNKNOWN = maxUnknownArg ? Number(maxUnknownArg.slice('--max-unknown='.length)) : DEFAULT_MAX_UNKNOWN;

if (!Number.isFinite(MAX_UNKNOWN) || MAX_UNKNOWN < 0) {
  console.error(`--max-unknown must be a non-negative number; got "${maxUnknownArg}".`);
  process.exit(2);
}

// The emulator host is the real safety rail: with it set, the Admin SDK can never reach a
// production Firestore however the project id is spelled. Refusing an empty value makes that
// explicit rather than incidental — `process.env.FIRESTORE_EMULATOR_HOST=''` would otherwise pass
// the `??` above and point a rules-bypassing SDK at the real thing.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST is empty — refusing to run a rules-bypassing migration against a non-emulator target.');
  process.exit(2);
}

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

/** The commit the corpus was stamped by — recorded in the marker so a later reader can tell WHICH `periodOf` ran. */
function sourceCommit(): string {
  try {
    // `execFileSync` with an argument array, not `execSync` with a string: no shell is involved,
    // so nothing here can ever become a shell injection surface even if this grows an argument.
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

interface BackupSet {
  transaction_lines: Array<Record<string, unknown>>;
  incomes: Array<Record<string, unknown>>;
  audit_log: Array<Record<string, unknown>>;
}

/**
 * Archive-before-overwrite. Every collection this script can write is captured, then the file is
 * READ BACK and its record counts compared before a single Firestore write happens.
 *
 * `JSON.stringify` cannot represent a Firestore `Timestamp` faithfully, and `audit_log` is
 * precisely where the mixed-type `at` values live — so timestamps are serialised explicitly with
 * their ISO form AND their raw seconds/nanoseconds, and the backup records that it did so. A
 * backup that silently flattens the very values being migrated is not a backup of them.
 */
function serialiseForBackup(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return { __firestoreTimestamp: true, iso: value.toDate().toISOString(), seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (Array.isArray(value)) return value.map(serialiseForBackup);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = serialiseForBackup(v);
    return out;
  }
  return value;
}

function backupAndVerify(sets: BackupSet): string {
  mkdirSync('backups', { recursive: true });
  const path = `backups/backfill-period-${new Date().toISOString().replace(/:/g, '-')}.json`;
  writeFileSync(path, JSON.stringify(serialiseForBackup(sets), null, 2));

  const readBack = JSON.parse(readFileSync(path, 'utf-8')) as BackupSet;
  for (const key of ['transaction_lines', 'incomes', 'audit_log'] as const) {
    if ((readBack[key] ?? []).length !== sets[key].length) {
      throw new Error(
        `Backup verification failed for ${key}: wrote ${sets[key].length} records but read back ` +
          `${(readBack[key] ?? []).length} from ${path}. Aborting before any Firestore write.`
      );
    }
  }
  return path;
}

/**
 * EVERY DECISION THIS SCRIPT MAKES ABOUT THE LEDGER LIVES IN `src/utils/backfillPlan.ts`, and it is
 * imported rather than restated. A `tsx` entrypoint is the one place no suite in this repo
 * executes — the root suite mocks Firestore, the rules suite runs Rules, neither runs a script — so
 * anything decided HERE would be untested code deciding which month a family's money landed in.
 * What is left below is genuinely I/O: read, back up, verify the backup, commit in batches of 400,
 * write the marker last.
 */
async function main(): Promise<void> {
  console.log(`project: ${PROJECT_ID}   emulator: ${process.env.FIRESTORE_EMULATOR_HOST}`);
  console.log(apply ? 'MODE: --apply (will write)' : 'MODE: dry run (default — nothing is written)');

  const memberSnap = await db.collection('members').get();
  const members = memberSnap.docs.map((d) => ({ id: d.id, name: (d.data() as { name?: string }).name }));
  console.log(`members: ${members.length}`);

  const txSnap = await db.collection('transaction_lines').get();
  const incomeSnap = await db.collection('incomes').get();
  const auditSnap = await db.collection('audit_log').get();

  const toRaw = (snap: FirebaseFirestore.QuerySnapshot): RawDoc[] =>
    snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));

  const plan = planBackfill(toRaw(txSnap), toRaw(incomeSnap), toRaw(auditSnap), members);

  // ── report ────────────────────────────────────────────────────────────────────────────────
  console.log('\n--- backfill plan ---');
  console.log(
    `transaction_lines: ${plan.transactionRows} rows, ` +
      `${plan.transactionRows - plan.transactionAlreadyCorrect} to stamp, ` +
      `${plan.transactionAlreadyCorrect} already correct`
  );
  console.log(`  period 'unknown' (unparseable date): ${plan.rowsUnknownPeriod}`);
  plan.unknownPeriodRows.forEach((r) => console.log(`    · ${r.id} (date=${JSON.stringify(r.date)})`));
  console.log(`  ownerId 'unknown' (unresolvable owner): ${plan.rowsUnknownOwner}   << A6's orphan set`);
  plan.unknownOwnerNames.forEach((o) => console.log(`    · owner=${JSON.stringify(o.owner)} ×${o.count}`));
  console.log(
    `incomes: ${plan.incomeRows} rows, ${plan.incomeRows - plan.incomeAlreadyCorrect} to stamp, ` +
      `${plan.incomesUnknownPeriod} 'unknown'`
  );
  console.log(
    `audit_log: ${auditSnap.size} rows, ${plan.auditConverted} Timestamp->ISO, ${plan.auditAlreadyIso} already ISO`
  );
  plan.auditUnreadable.forEach((id) =>
    console.warn(`  ! audit_log/${id}: \`at\` is neither string nor Timestamp — left untouched, never guessed.`)
  );
  console.log(`total writes planned: ${plan.patches.length}`);
  console.log('---------------------\n');

  // THE THRESHOLD, CHECKED BEFORE THE MODE BRANCH so a dry run reports it too.
  const threshold = backfillThresholdCheck(plan, MAX_UNKNOWN);
  if (threshold.status === 'refused') {
    console.error(threshold.message);
    process.exit(1);
  }

  if (!apply) {
    console.log(
      `DRY RUN: no backup file written, no Firestore writes performed. ${plan.patches.length} document(s) ` +
        `would be updated and the completion marker would be set. Re-run with --apply to write.`
    );
    return;
  }

  const backupPath = backupAndVerify({
    transaction_lines: txSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    incomes: incomeSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    audit_log: auditSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  });
  console.log(`backup written and verified: ${backupPath}`);

  let batch = db.batch();
  let inBatch = 0;
  for (const write of plan.patches) {
    // `update`, not `set(…, {merge:true})`: an update FAILS on a document that no longer exists,
    // which is the honest outcome for a migration whose plan was computed a moment ago. A merging
    // set would silently RESURRECT a row deleted between the read and the write, carrying only the
    // fields this script knows about.
    batch.update(db.collection(write.collection).doc(write.id), write.patch);
    if (++inBatch === BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();

  // THE COMPLETION MARKER, LAST. Every batch above has committed by the time this runs; if any of
  // them threw, we never reach here, the marker stays absent, and the statistical layer keeps
  // refusing. Fail-closed is the only acceptable direction, because a partially stamped corpus is
  // invisible to every instrument downstream.
  await db.collection('settings').doc(MIGRATION_STATE_DOC).set(
    {
      [TRANSACTION_PERIOD_BACKFILL_KEY]: {
        completedAt: new Date().toISOString(),
        rowsStamped: plan.transactionRows,
        rowsUnknown: plan.rowsUnknownPeriod,
        sourceCommit: sourceCommit(),
      },
    },
    { merge: true }
  );

  console.log(`applied: ${plan.patches.length} document update(s).`);
  console.log(`completion marker set: settings/${MIGRATION_STATE_DOC}.${TRANSACTION_PERIOD_BACKFILL_KEY}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
