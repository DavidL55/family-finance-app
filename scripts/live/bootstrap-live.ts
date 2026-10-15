// scripts/live/bootstrap-live.ts — first-run bootstrap for LIVE mode (real family data).
//
// Creates the five family members in an EMPTY live emulator: auth users with the same custom-claim
// shape the demo export carries ({role, memberId}), plus members/{id} and permissions/member__{id}
// docs mirroring the demo schema. Idempotent: a member that already exists is left alone, so
// running it against a populated live-db is a no-op, not a duplication.
//
// LIVE ONLY. Refuses to run unless both emulator hosts are reachable — this script must never be
// pointed at a real Firebase project, and the emulator hosts are how it can tell.
//
// Run: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//        npx tsx scripts/live/bootstrap-live.ts --apply
// Without --apply it prints what it would create and exits.
//
// Second mode (spec C1 §5): `--ensure-access` mirrors every auth user's role/memberId claims into
// access/{uid} — the doc the Firestore rules now read for identity. Idempotent (a second run
// writes 0) and run by start-live.sh on EVERY start. Same env vars; it writes (never deletes).
//        npx tsx scripts/live/bootstrap-live.ts --ensure-access

import { FAMILY, emailOf, memberDoc, permissionDoc } from './family';
import { blockingSkipped, planAccessWrites, type AuthUserClaims, type ExistingAccess } from './ensureAccessPlan';

const PROJECT_ID = 'family-finance-app-c9aa4';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
// Local-only bootstrap password; David logs in with it on this machine. Not a secret — the auth
// emulator is reachable only from localhost and holds no real credentials.
const PASSWORD = 'FamilyFinance2026!';

async function authFetch(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(json)}`);
  return json;
}

async function firestoreSet(docPath: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(
    `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ fields }),
    }
  );
  if (!res.ok) throw new Error(`firestore ${docPath}: ${await res.text()}`);
}

const s = (v: string) => ({ stringValue: v });

// Plain doc value (strings / nested maps) → Firestore REST `fields`. Enough for the family docs.
type RestValue = { stringValue: string } | { mapValue: { fields: Record<string, RestValue> } };
function toFields(obj: Record<string, unknown>): Record<string, RestValue> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      typeof v === 'string' ? s(v) : { mapValue: { fields: toFields(v as Record<string, unknown>) } },
    ])
  );
}

async function ensureEmulators(): Promise<void> {
  for (const [name, host] of [['auth', AUTH_HOST], ['firestore', FIRESTORE_HOST]] as const) {
    try {
      await fetch(`http://${host}/`, { signal: AbortSignal.timeout(3000) });
    } catch {
      throw new Error(`${name} emulator is not reachable at ${host} — refusing to run. This script is emulator-only.`);
    }
  }
}

async function existingEmails(): Promise<Set<string>> {
  const res = await authFetch(`projects/${PROJECT_ID}/accounts:query`, {});
  const users = (res.userInfo as Array<{ email?: string }> | undefined) ?? [];
  return new Set(users.map((u) => u.email).filter((e): e is string => typeof e === 'string'));
}

async function firestoreGet(docPath: string): Promise<Record<string, { stringValue?: string }> | null> {
  const res = await fetch(
    `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`,
    { headers: { Authorization: 'Bearer owner' } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`firestore get ${docPath}: ${await res.text()}`);
  return ((await res.json()) as { fields?: Record<string, { stringValue?: string }> }).fields ?? {};
}

const FAMILY_EMAILS: ReadonlySet<string> = new Set(FAMILY.map((m) => emailOf(m).toLowerCase()));

async function ensureAccess(): Promise<void> {
  await ensureEmulators();
  const res = await authFetch(`projects/${PROJECT_ID}/accounts:query`, {});
  const raw = (res.userInfo as Array<{ localId: string; email?: string; customAttributes?: string }> | undefined) ?? [];
  const users: AuthUserClaims[] = raw.map((u) => {
    let claims: Record<string, unknown> = {};
    let claimsError: string | undefined;
    try { claims = u.customAttributes ? (JSON.parse(u.customAttributes) as Record<string, unknown>) : {}; } catch (e) { claimsError = e instanceof Error ? e.message : 'invalid JSON'; }
    return { uid: u.localId, email: u.email ?? '', role: claims.role, memberId: claims.memberId, claimsError };
  });
  const existing = new Map<string, ExistingAccess | null>();
  for (const u of users) {
    const f = await firestoreGet(`access/${u.uid}`);
    existing.set(u.uid, f ? { role: f.role?.stringValue ?? '', memberId: f.memberId?.stringValue ?? '' } : null);
  }
  const { writes, skipped } = planAccessWrites(users, existing);
  const now = new Date().toISOString();
  for (const w of writes) {
    await firestoreSet(`access/${w.uid}`, {
      uid: s(w.uid), memberId: s(w.memberId), role: s(w.role), email: s(w.email),
      grantedAt: { timestampValue: now }, grantedVia: s('bootstrap'),
    });
    console.log(`  access  ${w.email}  role=${w.role}  (${w.reason})`);
  }
  for (const u of skipped.filter((x) => x.hasAccess)) console.log(`  info    ${u.email || u.uid}: ${u.reason} — keeps existing access doc`);
  const plan = { writes, skipped };
  const blocking = blockingSkipped(plan, FAMILY_EMAILS);
  for (const u of blocking) console.error(`  SKIPPED ${u.email || u.uid}: ${u.reason} — no access doc, this member will see "לא משויך"`);
  for (const u of skipped.filter((x) => !x.hasAccess && !blocking.includes(x))) console.log(`  info    ${u.email || u.uid}: ${u.reason} — not a family address, left without access`);
  console.log(`ensure-access: ${writes.length} write(s), ${users.length} user(s), ${blocking.length} blocked.`);
  if (blocking.length > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  if (process.argv.includes('--ensure-access')) return ensureAccess();
  const apply = process.argv.includes('--apply');
  await ensureEmulators();
  const existing = await existingEmails();
  const now = new Date().toISOString();

  for (const m of FAMILY) {
    const email = emailOf(m);
    if (existing.has(email)) {
      console.log(`  skip  ${email} (exists)`);
      continue;
    }
    if (!apply) {
      console.log(`  would create  ${email}  role=${m.role} memberId=${m.memberId}`);
      continue;
    }
    const created = await authFetch(`projects/${PROJECT_ID}/accounts`, {
      email,
      password: PASSWORD,
      displayName: m.nameHe,
    });
    // customAttributes on the CREATE endpoint is silently dropped by the auth emulator — measured
    // 29.08: the account came back with `customAttributes: None` and the app showed every user as
    // unprovisioned ("לא משויך לאף בן משפחה"). The claims must go through accounts:update, which
    // is also how the admin SDK's setCustomUserClaims reaches the emulator.
    await authFetch(`projects/${PROJECT_ID}/accounts:update`, {
      localId: created.localId,
      customAttributes: JSON.stringify({ role: m.role, memberId: m.memberId }),
    });
    await firestoreSet(`members/${m.memberId}`, toFields({ ...memberDoc(m, now) }));
    await firestoreSet(`permissions/member__${m.memberId}`, toFields({ ...permissionDoc(m, now) }));
    console.log(`  created  ${email}  (localId ${String(created.localId)})`);
  }
  console.log(apply ? 'bootstrap: done.' : 'bootstrap: dry run — re-run with --apply.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
