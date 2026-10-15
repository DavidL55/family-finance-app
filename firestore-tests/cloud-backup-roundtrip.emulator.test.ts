import { afterAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { testFirestoreHost } from './tools/emulatorHost';
import { applySnapshot, collectSnapshot } from '../scripts/cloud/snapshot';

testFirestoreHost(); // refuses :8080 / unset before anything connects
const src: App = initializeApp({ projectId: 'demo-c1-backup-src' }, 'c1-backup-src');
const dst: App = initializeApp({ projectId: 'demo-c1-backup-dst' }, 'c1-backup-dst');
afterAll(async () => { await deleteApp(src); await deleteApp(dst); });

// Firestore stores timestamps at microsecond precision, so the fixture uses whole microseconds (nanos 5 would be truncated by the
// store itself, before the backup ever sees it); the codec's own nanosecond fidelity is pinned in backupCodec.test.ts.
describe('backup → restore round trip (spec §6.2, DoD #4)', () => {
  it('restores every doc, nested ones included, value-for-value', async () => {
    const a = getFirestore(src);
    await a.doc('members/omer-levy').set({ name: 'עומר', at: new Timestamp(1760000000, 123000), geo: new GeoPoint(1, 2) });
    await a.doc('transaction_lines/t1').set({ amount: 12.34, ref: a.doc('members/omer-levy'), nested: { list: [1, { x: null }] } });
    await a.doc('chat_sessions/omer-levy/sessions/s1').set({ text: 'שלום' });
    const snap = await collectSnapshot(a, 'demo-c1-backup-src');
    const restored = JSON.parse(JSON.stringify(snap));
    const dry = await applySnapshot(getFirestore(dst), restored, { apply: false });
    expect((await getFirestore(dst).listCollections()).length).toBe(0); // dry run wrote nothing
    expect(dry.docs).toBe(3);
    await applySnapshot(getFirestore(dst), restored, { apply: true });
    const b = getFirestore(dst);
    const t1 = (await b.doc('transaction_lines/t1').get()).data()!;
    expect(t1.amount).toBe(12.34);
    expect(t1.ref.path).toBe('members/omer-levy');
    expect(t1.nested).toEqual({ list: [1, { x: null }] });
    const om = (await b.doc('members/omer-levy').get()).data()!;
    expect((om.at as Timestamp).isEqual(new Timestamp(1760000000, 123000))).toBe(true);
    expect((await b.doc('chat_sessions/omer-levy/sessions/s1').get()).get('text')).toBe('שלום');
  });
});
