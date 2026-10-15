// Spec C1 §4.5 — run ONCE from the Mac after David's first Google sign-in to the cloud app:
//   npx tsx scripts/cloud/bootstrap-owner.ts --email <david's google email>            # dry run
//   npx tsx scripts/cloud/bootstrap-owner.ts --email <david's google email> --apply
// Creates access/{david's uid} (super-admin, david-levy) and the five family members (+ their
// permissions/member__* docs, same shape as live bootstrap) that are missing. Deviation from the
// spec's "members/david-levy only": the app's first-run ensureSeeded() seeds placeholder members
// into an EMPTY members collection, and DoD #2 needs omer-levy to exist — so all five, same ids as
// live mode, which C2 will overwrite with the live-db versions.
import { Timestamp } from 'firebase-admin/firestore';
import { flagValue, openAuth, openFirestore, resolveTarget } from './adminApp';
import { planOwnerBootstrap } from './accessAdminPlan';
import { FAMILY, memberDoc, permissionDoc } from '../live/family';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const email = flagValue(argv, '--email');
  if (!email) throw new Error('--email <david\'s google email> is required');
  const target = resolveTarget(argv, process.env);
  const db = openFirestore(target);
  const user = await openAuth(target).getUserByEmail(email);
  const providers = user.providerData.map((p) => p.providerId).join(', ') || '(none)';
  // Attach a member only to a verified email (global constraint): email/password self-signup exists,
  // so an unverified password account for David's address must never become the owner.
  if (!user.emailVerified) throw new Error(`refusing: ${email} is not email-verified in Auth (providers: ${providers}). Sign in with Google, or verify the email first.`);
  const supers = await db.collection('access').where('role', '==', 'super-admin').get();
  const members = await db.collection('members').get();
  const plan = planOwnerBootstrap({ superAdminCount: supers.size, existingMemberIds: members.docs.map((d) => d.id) });
  if (plan.ok === false) throw new Error(plan.reason);
  console.log(`target: ${target.kind}  uid: ${user.uid}  providers: ${providers}  verified: ${user.emailVerified}  members to create: ${plan.membersToCreate.join(', ') || '(none)'}`);
  if (!argv.includes('--apply')) { console.log('dry run — re-run with --apply.'); return; }
  const now = new Date().toISOString();
  const batch = db.batch();
  for (const m of FAMILY.filter((f) => plan.membersToCreate.includes(f.memberId))) {
    batch.set(db.doc(`members/${m.memberId}`), { ...memberDoc(m, now) });
    batch.set(db.doc(`permissions/member__${m.memberId}`), { ...permissionDoc(m, now) });
  }
  batch.set(db.doc(`access/${user.uid}`), {
    uid: user.uid, memberId: 'david-levy', role: 'super-admin', email: email.toLowerCase(),
    grantedAt: Timestamp.now(), grantedVia: 'bootstrap',
  });
  batch.set(db.collection('audit_log').doc(), { actorMemberId: 'david-levy', action: 'access.bootstrap', target: `access/${user.uid}`, at: new Date().toISOString() });
  await batch.commit();
  console.log('bootstrap-owner: done.');
}

main().catch((err: unknown) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
