// Spec C1 §4.4 — C1's invite/revoke UI is this script (C4 builds the screen).
//   npx tsx scripts/cloud/access-admin.ts list
//   npx tsx scripts/cloud/access-admin.ts invite --email x@gmail.com --member omer-levy --role member [--days 14] [--apply]
//   npx tsx scripts/cloud/access-admin.ts revoke --uid <uid> [--apply]
import { Timestamp } from 'firebase-admin/firestore';
import { flagValue, openFirestore, resolveTarget } from './adminApp';
import { buildInvite, planRevoke } from './accessAdminPlan';

async function main(): Promise<void> {
  const [cmd, ...argv] = process.argv.slice(2);
  const db = openFirestore(resolveTarget(argv, process.env));
  const apply = argv.includes('--apply');

  if (cmd === 'list') {
    for (const d of (await db.collection('access').get()).docs) console.log(`access  ${d.id}  ${d.get('role')}  ${d.get('memberId')}  ${d.get('email')}`);
    for (const d of (await db.collection('invites').get()).docs) console.log(`invite  ${d.id}  ${d.get('role')}  ${d.get('memberId')}  used=${d.get('usedBy') ?? '-'}  expires=${d.get('expiresAt').toDate().toISOString()}`);
    return;
  }
  if (cmd === 'invite') {
    const email = flagValue(argv, '--email') ?? '';
    const memberId = flagValue(argv, '--member') ?? '';
    const existingSnap = await db.doc(`invites/${email.trim().toLowerCase()}`).get();
    const r = buildInvite({
      email, memberId, role: flagValue(argv, '--role') ?? '', days: Number(flagValue(argv, '--days') ?? 14),
      createdBy: 'david-levy', now: new Date(), memberExists: (await db.doc(`members/${memberId}`).get()).exists,
      existing: existingSnap.exists ? { usedBy: existingSnap.get('usedBy'), expiresAtMs: existingSnap.get('expiresAt').toMillis() } : null,
    });
    if (r.ok === false) throw new Error(r.reason);
    console.log(`invite ${r.id} → ${r.doc.memberId} as ${r.doc.role}, expires ${new Date(r.doc.expiresAtMs).toISOString()}`);
    if (!apply) { console.log('dry run — re-run with --apply.'); return; }
    const batch = db.batch();
    batch.set(db.doc(`invites/${r.id}`), {
      email: r.doc.email, memberId: r.doc.memberId, role: r.doc.role, createdBy: r.doc.createdBy,
      createdAt: Timestamp.fromMillis(r.doc.createdAtMs), expiresAt: Timestamp.fromMillis(r.doc.expiresAtMs),
    });
    batch.set(db.collection('audit_log').doc(), { actorMemberId: 'david-levy', action: 'invite.create', target: `invites/${r.id}`, at: new Date().toISOString() });
    await batch.commit();
    console.log('invite: done.');
    return;
  }
  if (cmd === 'revoke') {
    const uid = flagValue(argv, '--uid') ?? '';
    const all = (await db.collection('access').get()).docs.map((d) => ({ uid: d.id, role: String(d.get('role')) }));
    const r = planRevoke(uid, all);
    if (r.ok === false) throw new Error(r.reason);
    console.log(`revoke access/${uid}`);
    if (!apply) { console.log('dry run — re-run with --apply.'); return; }
    const batch = db.batch();
    batch.delete(db.doc(`access/${uid}`));
    batch.set(db.collection('audit_log').doc(), { actorMemberId: 'david-levy', action: 'access.revoke', target: `access/${uid}`, at: new Date().toISOString() });
    await batch.commit();
    console.log('revoke: done.');
    return;
  }
  throw new Error('usage: access-admin.ts list | invite --email E --member M --role R [--days N] [--apply] | revoke --uid U [--apply]');
}

main().catch((err: unknown) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
