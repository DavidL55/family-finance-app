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

const PROJECT_ID = 'family-finance-app-c9aa4';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
// Local-only bootstrap password; David logs in with it on this machine. Not a secret — the auth
// emulator is reachable only from localhost and holds no real credentials.
const PASSWORD = 'FamilyFinance2026!';

interface FamilyMember {
  memberId: string;
  first: string;
  nameHe: string;
  role: 'super-admin' | 'parent' | 'member';
  memberRoleHe: 'הורה' | 'ילד';
  color: string;
}

// The five members David approved (29.08.2026). Colors follow the demo palette family.
const FAMILY: FamilyMember[] = [
  { memberId: 'david-levy', first: 'david', nameHe: 'דויד', role: 'super-admin', memberRoleHe: 'הורה', color: '#1F4E78' },
  { memberId: 'lilit-levy', first: 'lilit', nameHe: 'לילית', role: 'parent', memberRoleHe: 'הורה', color: '#8E44AD' },
  { memberId: 'omer-levy', first: 'omer', nameHe: 'עומר', role: 'member', memberRoleHe: 'ילד', color: '#16A085' },
  { memberId: 'shaked-levy', first: 'shaked', nameHe: 'שקד', role: 'member', memberRoleHe: 'ילד', color: '#D35400' },
  { memberId: 'lior-levy', first: 'lior', nameHe: 'ליאור', role: 'member', memberRoleHe: 'ילד', color: '#2C7FB8' },
];

const MODULES = ['expenses', 'income', 'investments', 'goals'] as const;

function emailOf(m: FamilyMember): string {
  return `${m.first}-levy@familyfinance.local`;
}

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

async function main(): Promise<void> {
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
    await firestoreSet(`members/${m.memberId}`, {
      id: s(m.memberId),
      name: s(m.nameHe),
      role: s(m.memberRoleHe),
      color: s(m.color),
      createdAt: s(now),
      updatedAt: s(now),
    });
    // Children get view-only family scope, the demo's member__omer-levy shape; parents get edit.
    const level = m.role === 'member' ? 'none' : 'family';
    await firestoreSet(`permissions/member__${m.memberId}`, {
      id: s(`member__${m.memberId}`),
      scope: s('member'),
      targetId: s(m.memberId),
      updatedAt: s(now),
      updatedBy: s('david-levy'),
      modules: {
        mapValue: {
          fields: Object.fromEntries(
            MODULES.map((mod) => [
              mod,
              { mapValue: { fields: { view: s('family'), edit: s(level) } } },
            ])
          ),
        },
      },
    });
    console.log(`  created  ${email}  (localId ${String(created.localId)})`);
  }
  console.log(apply ? 'bootstrap: done.' : 'bootstrap: dry run — re-run with --apply.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
