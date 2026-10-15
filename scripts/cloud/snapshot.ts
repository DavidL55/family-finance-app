// Spec C1 §6.2. Top-level collections are discovered (listCollections), so a new collection is
// backed up without a code change. Nested collections are read by collection group; the list is
// pinned to the rules file by backupCoverage.test.ts.
import type { Firestore } from 'firebase-admin/firestore';
import { decodeValue, encodeValue } from './backupCodec';

export const NESTED_COLLECTION_GROUPS: readonly string[] = ['sessions'];

export interface Snapshot { version: 1; source: string; takenAt: string; docs: Array<{ path: string; data: Record<string, unknown> }> }

export async function collectSnapshot(db: Firestore, source: string): Promise<Snapshot> {
  const docs = new Map<string, Record<string, unknown>>();
  for (const col of await db.listCollections()) {
    for (const d of (await col.get()).docs) docs.set(d.ref.path, encodeValue(d.data()) as Record<string, unknown>);
  }
  for (const group of NESTED_COLLECTION_GROUPS) {
    for (const d of (await db.collectionGroup(group).get()).docs) docs.set(d.ref.path, encodeValue(d.data()) as Record<string, unknown>);
  }
  return { version: 1, source, takenAt: new Date().toISOString(),
    docs: [...docs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, data]) => ({ path, data })) };
}

export async function applySnapshot(db: Firestore, snap: Snapshot, opts: { apply: boolean }) {
  if (snap.version !== 1) throw new Error(`unknown snapshot version ${String(snap.version)}`);
  const byCollection: Record<string, number> = {};
  for (const d of snap.docs) { const top = d.path.split('/')[0]; byCollection[top] = (byCollection[top] ?? 0) + 1; }
  if (opts.apply) {
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = db.batch();
      for (const d of snap.docs.slice(i, i + 400)) batch.set(db.doc(d.path), decodeValue(d.data, db) as Record<string, unknown>);
      await batch.commit();
    }
  }
  return { docs: snap.docs.length, byCollection };
}
