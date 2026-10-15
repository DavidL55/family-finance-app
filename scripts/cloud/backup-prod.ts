// Spec C1 §6.2 — reads the whole cloud DB (Admin SDK + ADC) into
// family-data/backups/cloud-YYYYMMDD.json. At most once a day (Spark: 50K reads/day); keeps 30.
//   npx tsx scripts/cloud/backup-prod.ts [--out-dir <dir>] [--emulator --project demo-…]
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CLOUD_PROJECT_ID, flagValue, openFirestore, resolveTarget } from './adminApp';
import { backupFileName, filesToPrune, shouldSkipToday } from './backupPlan';
import { collectSnapshot } from './snapshot';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const target = resolveTarget(argv, process.env);
  const dir = resolve(flagValue(argv, '--out-dir') ?? join(process.cwd(), 'family-data', 'backups'));
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  if (shouldSkipToday(readdirSync(dir), now)) { console.log(`backup: ${backupFileName(now)} already exists — skipping (once a day).`); return; }
  const source = target.kind === 'cloud' ? CLOUD_PROJECT_ID : target.projectId;
  const snap = await collectSnapshot(openFirestore(target), source);
  const file = join(dir, backupFileName(now));
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(snap));
  renameSync(tmp, file); // atomic: a crash never leaves a half file under today's name
  for (const old of filesToPrune(readdirSync(dir))) rmSync(join(dir, old));
  console.log(`backup: ${snap.docs.length} docs → ${file}`);
}

main().catch((err: unknown) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
