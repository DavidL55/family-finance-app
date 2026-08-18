// ─────────────────────────────────────────────────────────────────────────────────────────────
// STAGE 7 T4 — THE GENERATOR AGAINST A REAL FIRESTORE.
//
// T4's plan entry says "Live-emulator: REQUIRED (it writes)", and this is what that buys that a
// mocked suite cannot:
//
//   · THE REFUSAL IS REAL. `scripts/seed-demo-finances.ts` must refuse the project id
//     `scripts/dev-emulators.ts` imports David's own `.emulator-data` into. A unit test can assert
//     the branch; only running the entrypoint proves the process actually exits non-zero before
//     `initializeApp` ever connects.
//   · DRY RUN IS REALLY DRY. The default mode's contract is "nothing is written". The only way to
//     know is to run it and then look at Firestore.
//   · DETERMINISM SURVIVES THE ROUND TRIP. `demoCorpus.test.ts` compares two in-process builds.
//     This compares two full `--apply` runs by reading every document back out of Firestore — so
//     it also proves IDEMPOTENCE, which is a property of the ids, not of the builder.
//
// It runs the script AS A SUBPROCESS rather than importing it, because the script's entrypoint —
// argument parsing, the refusal, the exit codes — is the thing under test, and importing a module
// whose top level calls `main()` would run it as a side effect of the import.
//
// PROJECT ID: its own, so it shares no documents with any rules test in this directory
// (`ai-overage-approval.emulator.test.ts` set that precedent). Nothing here imports
// `.emulator-data`; `firebase emulators:exec` boots an empty, ephemeral instance.
// ─────────────────────────────────────────────────────────────────────────────────────────────
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = 'scripts/seed-demo-finances.ts';
const PROJECT_ID = 'demo-ff-t4-demo-corpus';
const SCALE_PROJECT_ID = 'demo-ff-t4-demo-corpus-20';

const COLLECTIONS = [
  'members',
  'accounts',
  'recurring',
  'loans',
  'insurances',
  'incomes',
  'transaction_lines',
  'forecast_assumptions',
] as const;

interface RunResult {
  status: number;
  output: string;
}

/** Runs the entrypoint and returns its exit status and combined output — never throws on failure. */
function runScript(args: string[], envOverride: Record<string, string> = {}): RunResult {
  try {
    const output = execFileSync('npx', ['tsx', SCRIPT, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...envOverride },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${String(e.stdout ?? '')}${String(e.stderr ?? '')}` };
  }
}

/**
 * A canonical serialisation with keys sorted AT EVERY DEPTH.
 *
 * `JSON.stringify(value, Object.keys(value).sort())` — the obvious shortcut — filters keys at every
 * level by the TOP-LEVEL key list, so an `Insurance`'s `coverages[].label` would vanish and two
 * genuinely different corpora could hash the same. A fingerprint that drops fields is a
 * fingerprint that proves less than it appears to.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(',')}}`;
}

let app: App;
let db: Firestore;
let scaleApp: App;
let scaleDb: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set — run this through `npm run test:rules`.');
  }
  app = initializeApp({ projectId: PROJECT_ID }, 't4-demo-corpus');
  db = getFirestore(app);
  scaleApp = initializeApp({ projectId: SCALE_PROJECT_ID }, 't4-demo-corpus-scale');
  scaleDb = getFirestore(scaleApp);
});

afterAll(async () => {
  await deleteApp(app);
  await deleteApp(scaleApp);
});

/** Every document in every collection this script writes, canonically ordered, as one hash. */
async function fingerprint(target: Firestore): Promise<{ hash: string; counts: Record<string, number> }> {
  const counts: Record<string, number> = {};
  const lines: string[] = [];
  for (const collection of COLLECTIONS) {
    const snap = await target.collection(collection).get();
    counts[collection] = snap.size;
    const docs = snap.docs.map((doc) => `${collection}/${doc.id}\t${canonical(doc.data())}`).sort();
    lines.push(...docs);
  }
  const marker = await target.collection('settings').doc('migrationState').get();
  counts.settings = marker.exists ? 1 : 0;
  lines.push(`settings/migrationState\t${canonical(marker.data() ?? null)}`);
  return { hash: createHash('sha256').update(lines.join('\n')).digest('hex'), counts };
}

describe('the seed script refuses the project id that holds the real ledger', () => {
  it('!! REFUSES `demo-familyfinance` — the id `dev-emulators.ts` imports `.emulator-data` into', () => {
    // No `--project`, so the default applies. This is the accident the refusal exists to stop:
    // running the seeder while `npm run emu` is up would put ~350 synthetic rows into the family's
    // fourteen-document ledger, and `--export-on-exit` would make that permanent.
    const result = runScript(['--apply']);
    expect(result.status).toBe(2);
    expect(result.output).toContain('.emulator-data');
    expect(result.output).toContain('--force-default-project');
  });

  it('and it refuses BEFORE writing anything — the protected project is still empty', async () => {
    const protectedApp = initializeApp({ projectId: 'demo-familyfinance' }, 't4-protected-probe');
    try {
      const snap = await getFirestore(protectedApp).collection('transaction_lines').get();
      // Other rules tests in this directory use their own suffixed project ids, so this namespace
      // is untouched by them too. If the refusal ever regressed, this is where it would show.
      expect(snap.docs.filter((doc) => doc.id.startsWith('demo-'))).toHaveLength(0);
    } finally {
      await deleteApp(protectedApp);
    }
  });

  it('refuses when FIRESTORE_EMULATOR_HOST is EMPTIED — the `??` only re-defaults an UNSET one', () => {
    // `process.env.X = process.env.X ?? '127.0.0.1:8080'` leaves an EMPTY string exactly as it
    // found it, and an empty host points a rules-bypassing Admin SDK at the real Firestore. The
    // backfill script's own rail, inherited and proven here rather than assumed.
    const result = runScript([`--project=${PROJECT_ID}`, '--apply'], { FIRESTORE_EMULATOR_HOST: '' });
    expect(result.status).toBe(2);
    expect(result.output).toContain('refusing');
  }, 60_000);
});

describe('dry run is really dry', () => {
  it('reports what it would write, writes nothing, and reports every D27 condition', async () => {
    const result = runScript([`--project=${PROJECT_ID}`]);
    expect(result.status).toBe(0);
    expect(result.output).toContain('MODE: dry run');
    expect(result.output).toContain('D27 conditions');
    expect(result.output).not.toContain('FAIL');
    expect(result.output).toContain('would be written');

    const before = await fingerprint(db);
    expect(before.counts.transaction_lines).toBe(0);
    expect(before.counts.settings).toBe(0);
  }, 60_000);
});

describe('--apply writes the corpus, and writing it twice changes nothing', () => {
  let first: { hash: string; counts: Record<string, number> };

  it('the first run writes every collection and the completion marker', async () => {
    const result = runScript([`--project=${PROJECT_ID}`, '--apply']);
    expect(result.status).toBe(0);
    expect(result.output).toContain('applied:');

    first = await fingerprint(db);
    expect(first.counts.members).toBe(4);
    expect(first.counts.accounts).toBe(3);
    expect(first.counts.recurring).toBe(6);
    expect(first.counts.loans).toBe(2);
    expect(first.counts.insurances).toBe(2);
    expect(first.counts.incomes).toBe(7);
    expect(first.counts.forecast_assumptions).toBe(5);
    expect(first.counts.transaction_lines).toBeGreaterThan(300);
    expect(first.counts.settings).toBe(1);
  }, 60_000);

  it('!! A SECOND --apply LEAVES FIRESTORE BYTE-FOR-BYTE AS IT WAS', async () => {
    // Determinism proven THROUGH a real Firestore, not just in one process: the ids come from the
    // data, the data comes from the seed, and the seed is a parameter. Every test built on this
    // corpus therefore rests on something that cannot move between runs.
    const result = runScript([`--project=${PROJECT_ID}`, '--apply']);
    expect(result.status).toBe(0);

    const second = await fingerprint(db);
    expect(second.hash).toBe(first.hash);
    expect(second.counts).toEqual(first.counts);
  }, 60_000);

  it('!! NON-VACUOUS: a different --seed produces a DIFFERENT fingerprint', async () => {
    // Without this, the equality above would also pass for a script that wrote nothing at all the
    // second time, or for a generator that ignored its seed.
    const result = runScript([`--project=${PROJECT_ID}`, '--apply', '--seed=99']);
    expect(result.status).toBe(0);
    const reseeded = await fingerprint(db);
    expect(reseeded.hash).not.toBe(first.hash);
    // Same document ids, different amounts — so it is the DATA that moved, not the row set.
    expect(reseeded.counts).toEqual(first.counts);

    // Restore the default-seed corpus, because the assertions below name its rows.
    expect(runScript([`--project=${PROJECT_ID}`, '--apply']).status).toBe(0);
    expect((await fingerprint(db)).hash).toBe(first.hash);
  }, 120_000);
});

describe('the rows the downstream guards need actually reached Firestore', () => {
  it("`period: 'unknown'` rows are queryable — the value the read path sends as an `in` member", async () => {
    const snap = await db.collection('transaction_lines').where('period', '==', 'unknown').get();
    expect(snap.size).toBeGreaterThanOrEqual(2);
    for (const doc of snap.docs) {
      expect(typeof (doc.data() as { date: unknown }).date).toBe('string');
    }
  }, 60_000);

  it("`ownerId: 'unknown'` rows are queryable, and from both causes", async () => {
    const snap = await db.collection('transaction_lines').where('ownerId', '==', 'unknown').get();
    expect(snap.size).toBeGreaterThanOrEqual(2);
    const owners = snap.docs.map((doc) => (doc.data() as { owner: string }).owner);
    expect(new Set(owners).size).toBe(2);
  }, 60_000);

  it('the refund row round-trips with BOTH fields that make the two predicates disagree', async () => {
    const snap = await db.collection('transaction_lines').where('paymentType', '==', 'refund').get();
    expect(snap.size).toBe(1);
    expect((snap.docs[0].data() as { isCredit: boolean }).isCredit).toBe(true);
  }, 60_000);

  it('the colliding assumption pair round-trips with two owners and two amounts', async () => {
    const snap = await db.collection('forecast_assumptions').where('scopeKind', '==', 'category').get();
    expect(snap.size).toBe(2);
    const docs = snap.docs.map((doc) => doc.data() as { ownerId: string; amountILS: number; updatedAt: string; source: string });
    expect(new Set(docs.map((d) => d.ownerId)).size).toBe(2);
    expect(new Set(docs.map((d) => d.amountILS)).size).toBe(2);
    expect(new Set(docs.map((d) => d.updatedAt)).size).toBe(2);
    expect(docs.every((d) => d.source === 'user')).toBe(true);
  }, 60_000);

  it('every assumption is `source: user` — Rules deny `insight` in Stage 7 (D25b)', async () => {
    const snap = await db.collection('forecast_assumptions').get();
    expect(snap.size).toBe(5);
    expect(snap.docs.every((doc) => (doc.data() as { source: string }).source === 'user')).toBe(true);
  }, 60_000);

  it('the completion marker is present, so `loadStatisticalHistory` will not refuse this corpus', async () => {
    const marker = await db.collection('settings').doc('migrationState').get();
    const data = marker.data() as { transactionPeriodBackfill?: { rowsStamped: number; rowsUnknown: number } };
    expect(data.transactionPeriodBackfill?.rowsStamped).toBeGreaterThan(300);
    expect(data.transactionPeriodBackfill?.rowsUnknown).toBeGreaterThanOrEqual(2);
  }, 60_000);
});

describe('the --members=20 variant, which is the first 20-member corpus with money in it', () => {
  it('writes twenty members and a window read that crosses the row ceiling', async () => {
    const result = runScript([`--project=${SCALE_PROJECT_ID}`, '--members=20', '--apply']);
    expect(result.status).toBe(0);

    const members = await scaleDb.collection('members').get();
    expect(members.size).toBe(20);

    // The read the ceiling is set against: `where('period','in',[…])` with the six window months,
    // family scope. D33's number is 2000; T0 measured 3 documents for the same read on the real
    // corpus.
    const windowMonths = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
    const rows = await scaleDb.collection('transaction_lines').where('period', 'in', windowMonths).get();
    expect(rows.size).toBeGreaterThan(2000);
  }, 180_000);
});
