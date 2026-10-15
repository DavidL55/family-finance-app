// Spec C1 §6.2 — reads the whole cloud DB (Admin SDK + ADC) into
// family-data/backups/cloud-YYYYMMDD.json. At most once a day (Spark: 50K reads/day); keeps 30.
//   npx tsx scripts/cloud/backup-prod.ts [--out-dir <dir>] [--emulator --project demo-…]
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CLOUD_PROJECT_ID, flagValue, openFirestore, resolveTarget } from './adminApp';
import { backupFileName, filesToPrune, isSuspiciousShrink, newestBackup, shouldSkipToday } from './backupPlan';
import { collectSnapshot } from './snapshot';

// Doc count of the newest kept backup. An unreadable/corrupt file counts as "unknown" (null) — said
// out loud in the log — rather than crashing the backup that would replace it.
function previousDocCount(dir: string): number | null {
  const name = newestBackup(readdirSync(dir));
  if (name === null) return null;
  try {
    const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { docs?: unknown };
    if (Array.isArray(parsed.docs)) return parsed.docs.length;
    throw new Error('no docs array');
  } catch (err) {
    console.log(`backup: could not read previous backup ${name} (${err instanceof Error ? err.message : String(err)}) — shrink check skipped, only the empty check applies.`);
    return null;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const target = resolveTarget(argv, process.env);
  const dir = resolve(flagValue(argv, '--out-dir') ?? join(process.cwd(), 'family-data', 'backups'));
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  if (shouldSkipToday(readdirSync(dir), now)) { console.log(`backup: ${backupFileName(now)} already exists — skipping (once a day).`); return; }
  const source = target.kind === 'cloud' ? CLOUD_PROJECT_ID : target.projectId;
  const snap = await collectSnapshot(openFirestore(target), source);
  const previous = previousDocCount(dir);
  if (isSuspiciousShrink(snap.docs.length, previous)) {
    // Exit before the write and the prune: a bad read must never displace a good copy.
    throw new Error(`backup: REFUSED — ${snap.docs.length} docs vs ${previous ?? 'no previous backup'} in the newest kept backup (empty, or under half). Nothing written, nothing pruned. Check ADC / rules / outage, then re-run.`);
  }
  const file = join(dir, backupFileName(now));
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(snap));
  renameSync(tmp, file); // atomic: a crash never leaves a half file under today's name
  for (const old of filesToPrune(readdirSync(dir))) rmSync(join(dir, old));
  console.log(`backup: ${snap.docs.length} docs → ${file}`);
}

main().catch((err: unknown) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
