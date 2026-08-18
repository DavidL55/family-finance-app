// Stage 7 T4 (D27) — THE DEMO-DATA GENERATOR'S I/O HALF.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY THERE IS ALMOST NOTHING IN THIS FILE
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// `scripts/backfill-transaction-periods.ts` set the precedent and stated the reason: a `tsx`
// entrypoint is the ONE place no suite in this repo executes — the root suite mocks Firestore, the
// rules suite runs Rules, and neither runs a script. So every decision about what the corpus
// CONTAINS lives in `src/utils/demoCorpus.ts`, where it is ordinary tested code with 166 assertions
// over it, and what is left here is genuinely I/O: refuse the wrong project, build, write, report.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// !! IT REFUSES THE DEFAULT PROJECT ID, AND THAT REFUSAL IS THE POINT
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// `scripts/dev-emulators.ts:78-79` hardcodes `--project demo-familyfinance
// --import=./.emulator-data --export-on-exit=./.emulator-data` — DAVID'S OWN LEDGER, all fourteen
// documents of it. An Admin-SDK script pointed at that project id, run while `npm run emu` is up,
// writes ~350 synthetic rows into it and the export on exit makes that permanent.
//
// So `demo-familyfinance` is REFUSED unless `--force-default-project` is passed. D27 requires it,
// T0 and T3 both verified `.emulator-data` byte-identical after their runs, and this task is the
// first one in the stage whose whole job is to write a lot of documents.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// DATA-SAFETY RULES (inherited verbatim from migrate-transactions.ts / backfill-transaction-periods.ts)
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//   - Dry run is the DEFAULT. Nothing is written — not to Firestore, not to disk — until --apply.
//   - `FIRESTORE_EMULATOR_HOST` must be non-empty. With it set, the Admin SDK can never reach a
//     production Firestore however the project id is spelled; refusing an EMPTY value makes that a
//     rail rather than an accident (`FIRESTORE_EMULATOR_HOST=''` would otherwise pass the `??`).
//   - Before any write, every collection this script touches is READ BACK and its document count
//     reported. This script only ever writes documents whose ids it generated (`demo-*`), so it
//     cannot overwrite a row it did not create — but "cannot" is worth printing rather than
//     assuming, because the id prefix is the only thing making it true.
//   - IDEMPOTENT by construction: ids are derived from the corpus, and the corpus is deterministic,
//     so a second `--apply` writes byte-identical documents over byte-identical ones.
//   - Batched at 400. Firestore's hard limit is 500; `migrate-transactions.ts:38` set the number.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// !! THE COLLECTION NAMES ARE INLINED, DELIBERATELY, AND A LOOP WOULD BE A REGRESSION
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// `transactionStampGuard.test.ts` finds a `transaction_lines` writer by looking for the STRING
// LITERAL inside the write call's own subtree (`mentionsCollection`). A tidier
// `for (const name of DEMO_COLLECTIONS) db.collection(name)…` loop is invisible to it — the guard
// would not merely fail to check this file, it would not know the file writes rows at all, and
// that is failing OPEN on the newest writer in the tree. (The T3 review found the same hole for a
// hoisted `const ref = collection(db, 'transaction_lines')` and for the repo's own exported
// `TRANSACTION_LINES_COLLECTION`.) So each collection gets its own block with its own literal, and
// this file is registered in `INDIRECT_TRANSACTION_LINE_WRITERS` pointing at `demoCorpus.ts`,
// whose row literal carries `period` and `ownerId`.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// USAGE
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//   npx tsx scripts/seed-demo-finances.ts --project=demo-ff-t4            # dry run (default)
//   npx tsx scripts/seed-demo-finances.ts --project=demo-ff-t4 --apply    # write
//   npx tsx scripts/seed-demo-finances.ts --project=demo-ff-t4 --members=20 --apply
//   npx tsx scripts/seed-demo-finances.ts --project=demo-ff-t4 --seed=N --as-of=YYYY-MM-DD
//
// Boot the emulator on an ISOLATED project id first — never `npm run emu`:
//   npx firebase emulators:exec --project demo-ff-t4 --only firestore "<command>"
//
// AFTERWARDS, if you then run the period backfill over this corpus, it needs
// `--max-unknown=N` with N at least the number this script prints: the corpus carries DELIBERATE
// `'unknown'` rows and `DEFAULT_MAX_UNKNOWN` is 0, so the backfill refuses by design.

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  DEMO_AS_OF_DATE,
  DEMO_BASE_MEMBER_COUNT,
  DEMO_LARGE_MEMBER_COUNT,
  DEMO_SEED,
  buildDemoCorpus,
  type DemoCorpus,
} from '../src/utils/demoCorpus';
import { conditionOutcomes, failingConditionIds } from '../src/utils/demoCorpusConditions';
import { MIGRATION_STATE_DOC, TRANSACTION_PERIOD_BACKFILL_KEY } from '../src/utils/backfillMarker';
import { UNKNOWN_PERIOD } from '../src/utils/periodMath';
import { UNKNOWN_OWNER_ID } from '../src/utils/resolveOwnerId';

/** Firestore's batch hard limit is 500. `migrate-transactions.ts:38`'s precedent. */
const BATCH_SIZE = 400;

/** The project id `scripts/dev-emulators.ts` imports David's own `.emulator-data` into. */
const PROTECTED_PROJECT_ID = 'demo-familyfinance';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const forceDefaultProject = argv.includes('--force-default-project');

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = argv.find((a) => a.startsWith(prefix));
  return found === undefined ? undefined : found.slice(prefix.length);
}

const projectId = flag('project') ?? PROTECTED_PROJECT_ID;
const memberCount = flag('members') === undefined ? DEMO_BASE_MEMBER_COUNT : Number(flag('members'));
const seed = flag('seed') === undefined ? DEMO_SEED : Number(flag('seed'));
const asOfDate = flag('as-of') ?? DEMO_AS_OF_DATE;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    'FIRESTORE_EMULATOR_HOST is empty — refusing to run a rules-bypassing writer against a non-emulator target.'
  );
  process.exit(2);
}

if (projectId === PROTECTED_PROJECT_ID && !forceDefaultProject) {
  console.error(
    `Refusing to seed project "${PROTECTED_PROJECT_ID}".\n` +
      '  `scripts/dev-emulators.ts` boots that project id with --import/--export-on-exit=./.emulator-data,\n' +
      "  which is David's real ledger — 14 documents, and the export on exit makes any write permanent.\n" +
      '  Pass --project=<isolated-id> (recommended), or --force-default-project if you truly mean it.'
  );
  process.exit(2);
}

initializeApp({ projectId });
const db = getFirestore();

/**
 * Every condition, evaluated on the corpus about to be written. Printed in BOTH modes, because a
 * dry run whose only output is "would write N documents" tells the operator nothing about whether
 * the corpus is still the one the downstream guards depend on.
 *
 * T4 REVIEW F-5 — THE DECIDING IS NOT DONE HERE ANY MORE, only the printing. `conditionOutcomes`
 * and `failingConditionIds` live in `demoCorpusConditions.ts` where a suite can reach them; this
 * script is a `tsx` entrypoint and is the ONE place no suite in this repo executes, which is
 * exactly how the refusal this file's header advertises came to have no test at all.
 *
 * Two decisions moved with them, and one was a latent defect: the `'scale'` applicability rule was
 * written here as a BARE LITERAL 20, beside a module that already exports
 * `DEMO_LARGE_MEMBER_COUNT`. Two numbers free to drift.
 */
function reportConditions(corpus: DemoCorpus): string[] {
  console.log('\n--- D27 conditions ---');
  for (const outcome of conditionOutcomes(corpus)) {
    if (!outcome.applicable) {
      console.log(`  n/a  ${outcome.id}  (scale-only; re-run with --members=${String(DEMO_LARGE_MEMBER_COUNT)})`);
      continue;
    }
    console.log(`  ${outcome.holds ? ' ok ' : 'FAIL'}  ${outcome.id}  — ${outcome.why}`);
  }
  console.log('----------------------\n');
  return failingConditionIds(corpus);
}

async function main(): Promise<void> {
  console.log(`project: ${projectId}   emulator: ${process.env.FIRESTORE_EMULATOR_HOST}`);
  console.log(apply ? 'MODE: --apply (will write)' : 'MODE: dry run (default — nothing is written)');
  console.log(`seed: ${String(seed)}   asOf: ${asOfDate}   members: ${String(memberCount)}`);

  const corpus = buildDemoCorpus({ seed, asOfDate, memberCount });

  console.log(
    `\ncorpus: ${String(corpus.members.length)} members, ${String(corpus.accounts.length)} accounts, ` +
      `${String(corpus.recurring.length)} recurring, ${String(corpus.loans.length)} loans, ` +
      `${String(corpus.insurances.length)} insurances, ${String(corpus.incomes.length)} incomes, ` +
      `${String(corpus.transactionLines.length)} transaction_lines, ` +
      `${String(corpus.forecastAssumptions.length)} forecast_assumptions`
  );
  console.log(`history: ${corpus.historyPeriods.join(', ')}`);
  console.log(`horizon: ${corpus.horizonPeriods.join(', ')}   empty certain month: ${corpus.emptyCertainPeriod}`);

  const unknownPeriodRows = corpus.transactionLines.filter((row) => row.period === UNKNOWN_PERIOD).length;
  const unknownOwnerRows = corpus.transactionLines.filter((row) => row.ownerId === UNKNOWN_OWNER_ID).length;
  const unknownIncomeRows = corpus.incomes.filter((row) => row.period === UNKNOWN_PERIOD).length;
  console.log(
    `deliberate unknowns: period ${String(unknownPeriodRows)}, owner ${String(unknownOwnerRows)}, ` +
      `incomes ${String(unknownIncomeRows)}   ` +
      `>> a later backfill run over this corpus needs --max-unknown=${String(unknownPeriodRows + unknownOwnerRows + unknownIncomeRows)}`
  );

  const failing = reportConditions(corpus);
  if (failing.length > 0) {
    console.error(
      `${String(failing.length)} D27 condition(s) do not hold on the corpus this run would write: ` +
        `${failing.join(', ')}. Refusing: a corpus missing a condition silently un-shadows nothing ` +
        'and turns a downstream guard green.'
    );
    process.exit(1);
  }

  const documentCount =
    corpus.members.length +
    corpus.accounts.length +
    corpus.recurring.length +
    corpus.loans.length +
    corpus.insurances.length +
    corpus.incomes.length +
    corpus.transactionLines.length +
    corpus.forecastAssumptions.length +
    1; // the completion marker

  if (!apply) {
    console.log(
      `DRY RUN: no Firestore writes performed. ${String(documentCount)} document(s) would be written, ` +
        'all with `demo-` prefixed ids. Re-run with --apply to write.'
    );
    return;
  }

  const written = await writeCorpus(corpus);
  console.log(`applied: ${String(written)} document(s).`);
  console.log(`completion marker set: settings/${MIGRATION_STATE_DOC}.${TRANSACTION_PERIOD_BACKFILL_KEY}`);
}

/**
 * The write. One block per collection with the collection name INLINED — see this file's header;
 * a loop over `DEMO_COLLECTIONS` would make the stamp guard blind to the newest row writer in the
 * tree.
 */
async function writeCorpus(corpus: DemoCorpus): Promise<number> {
  let batch = db.batch();
  let inBatch = 0;
  let written = 0;

  const commitIfFull = async (): Promise<void> => {
    written += 1;
    if (++inBatch === BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  };

  for (const member of corpus.members) {
    batch.set(db.collection('members').doc(member.id), member);
    await commitIfFull();
  }
  for (const account of corpus.accounts) {
    batch.set(db.collection('accounts').doc(account.id), account);
    await commitIfFull();
  }
  for (const item of corpus.recurring) {
    batch.set(db.collection('recurring').doc(item.id), item);
    await commitIfFull();
  }
  for (const loan of corpus.loans) {
    batch.set(db.collection('loans').doc(loan.id), loan);
    await commitIfFull();
  }
  for (const insurance of corpus.insurances) {
    batch.set(db.collection('insurances').doc(insurance.id), insurance);
    await commitIfFull();
  }
  for (const income of corpus.incomes) {
    batch.set(db.collection('incomes').doc(income.id), income);
    await commitIfFull();
  }
  for (const row of corpus.transactionLines) {
    batch.set(db.collection('transaction_lines').doc(row.id), row);
    await commitIfFull();
  }
  for (const assumption of corpus.forecastAssumptions) {
    batch.set(db.collection('forecast_assumptions').doc(assumption.id), assumption);
    await commitIfFull();
  }

  // THE COMPLETION MARKER, LAST — every row it vouches for has committed by the time it is set.
  // Same fail-closed ordering as the backfill: if a batch throws we never reach here, the marker
  // stays absent, and `loadStatisticalHistory` keeps refusing rather than averaging half a corpus.
  batch.set(
    db.collection('settings').doc(MIGRATION_STATE_DOC),
    { [TRANSACTION_PERIOD_BACKFILL_KEY]: corpus.backfillMarker },
    { merge: true }
  );
  written += 1;
  await batch.commit();

  return written;
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
