// Spec C1 §6.2 — restore a backup file. Dry run by default (prints per-collection counts).
//   npx tsx scripts/cloud/restore-prod.ts --from <file> [--emulator --project demo-…] [--apply]
// Cloud --apply additionally requires --i-understand-this-overwrites-prod.
import { readFileSync } from 'node:fs';
import { flagValue, openFirestore, resolveTarget } from './adminApp';
import { MAX_RESTORE_DOCS } from './backupPlan';
import { applySnapshot, type Snapshot } from './snapshot';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const from = flagValue(argv, '--from');
  if (!from) throw new Error('--from <backup file> is required');
  const target = resolveTarget(argv, process.env);
  const snap = JSON.parse(readFileSync(from, 'utf8')) as Snapshot;
  if (snap.docs.length > MAX_RESTORE_DOCS) throw new Error(`${snap.docs.length} docs > ${MAX_RESTORE_DOCS} (Spark daily writes) — split the restore.`);
  const apply = argv.includes('--apply');
  if (apply && target.kind === 'cloud' && !argv.includes('--i-understand-this-overwrites-prod')) {
    throw new Error('cloud restore needs --i-understand-this-overwrites-prod (and David\'s approval).');
  }
  const report = await applySnapshot(openFirestore(target), snap, { apply });
  console.log(JSON.stringify({ target, from, apply, ...report }, null, 2));
  if (!apply) console.log('dry run — nothing written.');
}

main().catch((err: unknown) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
