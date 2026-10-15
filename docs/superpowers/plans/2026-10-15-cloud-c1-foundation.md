# Cloud C1 — Foundation (Spark, access/{uid}, invites, App Check, cloud→Mac backup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the system in a free (Spark) Firebase project where David, Lilit and anyone David invites sign in from any device, see and edit exactly what their permissions allow, and lose access the moment David revokes it — without breaking the local live mode that is the source of truth until C2.

**Architecture:** Identity moves from ID-token custom claims to a Firestore doc `access/{uid}` that the rules read on every request (`role()`/`memberId()` keep their names; only their source changes), so revocation is immediate and no Cloud Function is needed. Invites (`invites/{emailLower}`) are redeemed in the browser by one batch that the rules bind together with `getAfter`/`existsAfter`. Operator actions (owner bootstrap, invite, revoke, backup, restore) are Admin-SDK scripts run from David's Mac with ADC — no key file on disk. The emulator inherits the same rules, so live mode gets `access` docs written on every start before anything else touches it.

**Tech Stack:** Firestore Security Rules v2 · `@firebase/rules-unit-testing` 5 · React 19 + Vite 6 · vitest 4 + Testing Library · `firebase` 12 (auth, firestore, app-check) · `firebase-admin` 14 (scripts) · `tsx` · zsh (live scripts) · firebase-tools 15 CLI.

**Spec:** `docs/superpowers/specs/2026-10-15-cloud-c1-foundation-design.md` (approved 15.10 on the ₪0 condition). Read §4–§8 before starting any task.

## Global Constraints

- **₪0.** Spark plan only. No credit card, no billing account, no Cloud Functions deploy, no paid product (Identity Platform, PITR, managed backups, reCAPTCHA Enterprise). If any console/CLI step asks for billing — **stop and ask David**.
- **Prod commands need David's approval one by one.** Every command that reads or writes `family-finance-app-c9aa4` (or any real GCP project) is shown to David first and run only after an explicit yes for *that* command. Every prod CLI call carries an explicit `--project family-finance-app-c9aa4`; deploys always use `--only`.
- **Live mode is untouchable.** Port 8080 (+ 9099 auth, 4400 UI, 4399 hub, 9150 ws) may be the family's real data. Never stop it, never run rules tests / `clearFirestore` / restore against it. Rules tests run on a dedicated emulator (`firebase.rules-test.json`, Firestore **:8180**). Writes to live (only `bootstrap-live.ts --ensure-access`) need David's approval when run by hand.
- **Location:** Firestore `(default)` in **`me-west1`** — irreversible once created.
- **Identity source:** `access/{uid}` only. Claims stay set in the emulator (the emulator's AI Functions still read them) but no rule and no client code may read `request.auth.token.role`/`.memberId` after Task 3.
- **Attach a member only to a verified email** (`email_verified == true`; Google is always verified). Invite doc id = `email.toLowerCase()`.
- **AI features are off outside dev:** `AI_ENABLED = !import.meta.env.PROD`. No AI trigger renders and no callable is invoked in a production build.
- **No secrets in the bundle.** Only names in `CLIENT_ENV_READS` (`src/__tests__/helpers/clientEnvPin.ts`) may be read by client code.
- Hebrew UI copy, RTL. A failed read renders an **error**, never an empty state. No hook below an early return (regression 09.10.2026).
- Commit after every task; `npm run lint` (tsc) and `npm test` clean at every commit; `npm run test:rules` clean from Task 1 on.

## Review Focus

1. **Rules changing on disk while live mode runs.** The Firestore emulator hot-reloads its rules file; any merge/pull/checkout that changes `firestore.rules` mid-session would hit a DB with no `access` docs → the whole family sees "לא משויך". Expected: live mode runs on a rules *snapshot* taken at start, so a rules change reaches live only through a fresh start (which runs `--ensure-access`). *(Task 4: snapshot + pin test.)* The live session already running when this branch merges predates the snapshot, so that one merge keeps a precondition. *(Task 12 Step 3.)*
2. **Upper-case / mixed-case email in the token** (`Lilit.Levy@Gmail.com`). Expected: redemption of `invites/lilit.levy@gmail.com` still succeeds. *(Task 3 rules test + Task 6 service test.)*
3. **Stale token after email verification.** An email/password user verifies in another tab and clicks "יש לי הזמנה"; the cached ID token still says `email_verified: false` → rules deny. Expected: the client force-refreshes the token (`getIdToken(true)`) after `user.reload()` and before reading the invite. *(Task 6 test.)*
4. **A user who already has `access` "redeems" a second invite.** Expected: denied — otherwise the invite is burned without granting anything. *(Task 3 rules test.)*
5. **Cache-first `access` snapshot.** With `persistentLocalCache`, the first snapshot for a brand-new user can be a cached "doesn't exist" → a flash of "לא משויך" then ready; worse, a revoked user offline sees a cached `ready`. Expected: a `fromCache && !exists` snapshot keeps `loading`; revocation still flips on the next server snapshot. *(Task 5 test.)*

---

## Phase A — Code (worktree branch, no prod contact)

### Task 0: Stage 0 — verify the cloud project is free and reachable (HITL, read-only)

Runs in parallel with Phase A; Phase A does not depend on it except for `CLOUD_PROJECT_ID` (Task 10), which is a one-line constant.

**Files:** none (findings go into the Task 0 note in the handoff).

- [ ] **Step 1: David authenticates** (David runs these himself in a terminal — they open a browser):

```bash
npx firebase login --reauth
gcloud auth login
gcloud auth application-default login
gcloud auth application-default set-quota-project family-finance-app-c9aa4
```

- [ ] **Step 2: Read-only checks — show each to David, run only after his yes, one at a time:**

```bash
npx firebase projects:list
gcloud billing projects describe family-finance-app-c9aa4
npx firebase firestore:databases:list --project family-finance-app-c9aa4
npx firebase apps:list WEB --project family-finance-app-c9aa4
```

Expected for "go": the project is listed; `billingEnabled: false` (or no `billingAccountName`); no `(default)` database **or** a `(default)` in `me-west1`; one WEB app.

- [ ] **Step 3: Branch on the result.**
  - All "go" → nothing to change.
  - `(default)` exists in a location other than `me-west1`, or the project is missing / billing-linked → **stop; ask David**. If he chooses a new project: `npx firebase projects:create <new-id>` (approval) → `npx firebase apps:create WEB familyfinance --project <new-id>` (approval) → put the new cloud config in a new **`.env.production`** (loaded only by `vite build`) and keep `.env` unchanged, because live mode's dev server must keep `VITE_FIREBASE_PROJECT_ID=family-finance-app-c9aa4` (the emulator data is stored under that id). Update `.firebaserc` `default`, and `CLOUD_PROJECT_ID` in Task 10.
- [ ] **Step 4:** Record findings (project id, billing state, db location) in a short note for the handoff. No commit.

---

### Task 1: Rules tests run on a dedicated emulator, never on :8080

**Files:**
- Create: `firebase.rules-test.json`
- Create: `firestore-tests/tools/emulatorHost.ts`
- Create: `src/__tests__/rulesTestHost.test.ts`
- Modify: `package.json` (`test:rules` script)
- Modify: every `firestore-tests/*.test.ts` that hard-codes `host: '127.0.0.1', port: 8080` (ai-cost-config, ai-cost-gate, chat-sessions, documents, finance-modules, forecast-assumptions, forecast-calibration, permissions, settings-sensitivity, transaction-history) and the two that fall back to `'127.0.0.1:8080'` (bank-lines, demo-corpus)
- Modify: `firestore-tests/tools/differential-rules-matrix.ts:384`

**Interfaces:**
- Produces: `testFirestoreHost(): { host: string; port: number }` (throws when `FIRESTORE_EMULATOR_HOST` is unset or points at 8080); `LIVE_FIRESTORE_PORT = 8080`; `TEST_FIRESTORE_PORT = 8180`.

- [ ] **Step 1: Write the failing test** — `src/__tests__/rulesTestHost.test.ts`

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { testFirestoreHost, TEST_FIRESTORE_PORT } from '../../firestore-tests/tools/emulatorHost';

const ORIGINAL = process.env.FIRESTORE_EMULATOR_HOST;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
  else process.env.FIRESTORE_EMULATOR_HOST = ORIGINAL;
});

describe('testFirestoreHost — rules tests never touch live mode', () => {
  it('refuses when FIRESTORE_EMULATOR_HOST is unset (no silent 8080 fallback)', () => {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    expect(() => testFirestoreHost()).toThrow(/npm run test:rules/);
  });
  it('refuses port 8080 — that is LIVE mode', () => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    expect(() => testFirestoreHost()).toThrow(/LIVE/);
  });
  it('returns the dedicated test emulator', () => {
    process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${TEST_FIRESTORE_PORT}`;
    expect(testFirestoreHost()).toEqual({ host: '127.0.0.1', port: 8180 });
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run src/__tests__/rulesTestHost.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `firestore-tests/tools/emulatorHost.ts`

```ts
// The ONE place rules/emulator tests learn where Firestore is. `npm run test:rules` starts a
// dedicated emulator from firebase.rules-test.json (Firestore :8180) and exports
// FIRESTORE_EMULATOR_HOST; :8080 belongs to live mode (the family's real data, spec C1 §7) and a
// test run there would clearFirestore() it. So: no fallback, and 8080 is refused outright.
export const LIVE_FIRESTORE_PORT = 8080;
export const TEST_FIRESTORE_PORT = 8180;

export function testFirestoreHost(): { host: string; port: number } {
  const raw = process.env.FIRESTORE_EMULATOR_HOST;
  if (!raw) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set — run rules tests via `npm run test:rules` ' +
        `(dedicated emulator on :${TEST_FIRESTORE_PORT}), never against an emulator that is already running.`,
    );
  }
  const [host, portText] = raw.split(':');
  const port = Number(portText);
  if (port === LIVE_FIRESTORE_PORT) {
    throw new Error(`refusing to run against :${LIVE_FIRESTORE_PORT} — that port is LIVE mode (the family's real data).`);
  }
  return { host, port };
}
```

`firebase.rules-test.json` (every port differs from `firebase.json`, so this suite can run while live mode is up):

```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "emulators": {
    "firestore": { "port": 8180, "websocketPort": 9250 },
    "hub": { "port": 4410 },
    "logging": { "port": 4510 },
    "ui": { "enabled": false }
  }
}
```

`package.json`:

```json
"test:rules": "firebase --config firebase.rules-test.json emulators:exec --project demo-familyfinance --only firestore \"vitest run --config vitest.rules.config.ts\"",
```

In each test file listed above replace `{ rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 }` with `{ rules: readFileSync('firestore.rules', 'utf8'), ...testFirestoreHost() }` and add `import { testFirestoreHost } from './tools/emulatorHost';`. In `bank-lines.rules.test.ts:23` replace the `?? '127.0.0.1:8080'` split with `const { host: emuHost, port: emuPort } = testFirestoreHost();` (keep the variable names it already uses downstream; `emuPort` becomes a number — wrap with `String()` where a string was used). In `demo-corpus.emulator.test.ts` replace the 8080 fallback the same way. In `differential-rules-matrix.ts:384` use `...testFirestoreHost()` (import path `./emulatorHost`).

- [ ] **Step 4: Run** — `npx vitest run src/__tests__/rulesTestHost.test.ts` → PASS. Then `grep -rn "8080" firestore-tests` → only `emulatorHost.ts` and comments.

- [ ] **Step 5: First real rules run — with live mode protected.** Record `lsof -nP -iTCP:8080 -sTCP:LISTEN -t` before; run `npm run test:rules`; confirm the same PID (or still nothing) after. Expected: the suite runs on :8180. This is the first run since the 8080 hard-coding (handoff item 5) — if anything fails, record each failing test name and its error **before** changing anything; fix only failures caused by the port move; report the rest to the controller as pre-existing.

- [ ] **Step 6: Commit**

```bash
git add firebase.rules-test.json firestore-tests src/__tests__/rulesTestHost.test.ts package.json
git commit -m "test(rules): dedicated emulator on :8180 — rules tests can never clear live mode's :8080"
```

---

### Task 2: Every rules-test identity gets an `access` doc (green on the OLD rules)

Characterization first: seed `access/{uid}` for every fixture identity while the rules still read claims, so Task 3 changes exactly one variable.

**Files:**
- Create: `firestore-tests/tools/accessFixtures.ts`
- Modify: all 11 `firestore-tests/*.rules.test.ts`
- Modify: `firestore-tests/tools/differential-rules-matrix.ts` (seed access for `kind: 'auth'` sessions)

**Interfaces:**
- Produces: `FixtureIdentity = { uid: string; memberId: string; role: 'super-admin' | 'parent' | 'member' }`; `accessDocFor(id: FixtureIdentity): Record<string, unknown>`; `createAccessFixtures(getEnv: () => RulesTestEnvironment): { seed(ids: readonly FixtureIdentity[]): Promise<void>; ctx(uid: string, claims: Record<string, unknown>): RulesTestContext }`.

- [ ] **Step 1: Implement the helper** — `firestore-tests/tools/accessFixtures.ts`

```ts
// Spec C1 §5/§7: rules read role/memberId from access/{uid}. Every fixture identity that carries
// role+memberId claims must ALSO have an access doc, or its deny-assertions pass vacuously (no
// access → denied for the wrong reason). ctx() makes forgetting one a loud error, not a green.
import type { RulesTestEnvironment, RulesTestContext } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

export interface FixtureIdentity {
  uid: string;
  memberId: string;
  role: 'super-admin' | 'parent' | 'member';
}

export function accessDocFor(id: FixtureIdentity): Record<string, unknown> {
  return {
    uid: id.uid,
    memberId: id.memberId,
    role: id.role,
    email: `${id.uid}@fixture.test`,
    grantedAt: Timestamp.fromMillis(0),
    grantedVia: 'test-fixture',
  };
}

export function createAccessFixtures(getEnv: () => RulesTestEnvironment) {
  const seeded = new Set<string>();
  return {
    /** Call right after clearFirestore() in the file's top-level beforeEach. */
    async seed(ids: readonly FixtureIdentity[]): Promise<void> {
      seeded.clear();
      await getEnv().withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        for (const id of ids) await setDoc(doc(db, 'access', id.uid), accessDocFor(id));
      });
      for (const id of ids) seeded.add(id.uid);
    },
    ctx(uid: string, claims: Record<string, unknown>): RulesTestContext {
      if (typeof claims.role === 'string' && typeof claims.memberId === 'string' && !seeded.has(uid)) {
        throw new Error(
          `fixture ${uid} has role+memberId claims but no access/${uid} doc — add it to this file's ` +
            'ACCESS_IDENTITIES (a missing doc turns every deny-assertion for it into a vacuous pass).',
        );
      }
      return getEnv().authenticatedContext(uid, claims);
    },
  };
}
```

- [ ] **Step 2: Migrate each test file** with this exact recipe (shown for `permissions.rules.test.ts`; apply identically to the other 10):

```ts
import { createAccessFixtures, type FixtureIdentity } from './tools/accessFixtures';

const access = createAccessFixtures(() => testEnv);

// Every identity this file signs in with role+memberId claims — including the ones built inline
// inside describe blocks (hoist each inline literal to a named const and list it here).
const ACCESS_IDENTITIES: FixtureIdentity[] = [DAVID, LILIT, OMER, EDITOR, /* …all others… */];

const ctxFor = (m: { uid: string; memberId: string; role: string }) =>
  access.ctx(m.uid, { role: m.role, memberId: m.memberId });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await access.seed(ACCESS_IDENTITIES);
  // …existing seeding unchanged…
});
```

Then replace every remaining `testEnv.authenticatedContext(` that passes **both** `role` and `memberId` with `access.ctx(`. Leave the deliberately claim-less / role-only ones (`'uid-claimless'`, `'uid-no-claims'`, `'uid-role-only'`) on `testEnv.authenticatedContext` — they have no access doc on purpose.

Identities per file (from `grep "uid: '"` — the inline ones in `finance-modules` are `uid-family`, `uid-family-d1`, `uid-noperm`, `uid-noview`, `uid-oldshape`, `uid-poster`, `uid-restricted`; in `permissions`: `uid-fv`, `uid-goal-family`, `uid-goal-own`, `uid-goal-own2`, `uid-inv-family`, `uid-inv-own`, `uid-inv-own2`, `uid-noperm`, `uid-someone-else`, `uid-editor`): use the `memberId`/`role` each one already passes as claims.

In `differential-rules-matrix.ts`, inside `seed()` (line ~364), also write `access/{s.uid}` (`accessDocFor({ uid: s.uid!, memberId: s.memberId!, role: s.role! })`) for every `SESSIONS` entry with `kind: 'auth'`.

- [ ] **Step 3: Run** — `npm run test:rules`. Expected: same pass/fail set as Task 1 Step 5 (the old rules ignore `access`). A thrown "has role+memberId claims but no access" error means an identity is missing from that file's list — add it.

- [ ] **Step 4: Commit**

```bash
git add firestore-tests
git commit -m "test(rules): seed access/{uid} for every fixture identity; missing one is a loud error"
```

---

### Task 3: Rules — identity from `access/{uid}`, `invites` and `access` collections

**Files:**
- Modify: `firestore.rules:5-13` (identity helpers), add validators + two `match` blocks
- Create: `firestore-tests/identity-access.rules.test.ts`

**Interfaces:**
- Consumes: `createAccessFixtures`, `testFirestoreHost` (Tasks 1–2).
- Produces (data contract every later task relies on):
  - `invites/{emailLower}`: `{ email: string (== doc id), memberId: string, role: 'super-admin'|'parent'|'member', createdBy: string, createdAt: Timestamp, expiresAt: Timestamp, usedBy?: string, usedAt?: Timestamp }`
  - `access/{uid}`: `{ uid: string (== doc id), memberId: string, role, email: string, grantedAt: Timestamp, grantedVia: string }` — exactly these keys.
  - Redemption = one batch: `update invites/{emailLower} {usedBy: uid, usedAt: serverTimestamp()}` + `set access/{uid} {uid, memberId, role, email: emailLower, grantedAt: serverTimestamp(), grantedVia: emailLower}`.

- [ ] **Step 1: Write the failing tests** — `firestore-tests/identity-access.rules.test.ts`

```ts
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { deleteDoc, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { testFirestoreHost } from './tools/emulatorHost';
import { accessDocFor, createAccessFixtures, type FixtureIdentity } from './tools/accessFixtures';

let testEnv: RulesTestEnvironment;
const access = createAccessFixtures(() => testEnv);

const DAVID: FixtureIdentity = { uid: 'uid-david', memberId: 'david-levy', role: 'super-admin' };
const LILIT: FixtureIdentity = { uid: 'uid-lilit', memberId: 'lilit-levy', role: 'parent' };
const OMER: FixtureIdentity = { uid: 'uid-omer', memberId: 'omer-levy', role: 'member' };
const GUEST_UID = 'uid-guest';
const GUEST_EMAIL = 'guest.person@gmail.com';
const DAY = 24 * 60 * 60 * 1000;

const asUser = (id: FixtureIdentity) => access.ctx(id.uid, { role: id.role, memberId: id.memberId }).firestore();
const asGuest = (claims: Record<string, unknown> = { email: GUEST_EMAIL, email_verified: true }, uid = GUEST_UID) =>
  testEnv.authenticatedContext(uid, claims).firestore();

const invite = (over: Record<string, unknown> = {}) => ({
  email: GUEST_EMAIL, memberId: 'omer-levy', role: 'member', createdBy: 'david-levy',
  createdAt: Timestamp.fromMillis(Date.now() - DAY), expiresAt: Timestamp.fromMillis(Date.now() + 14 * DAY), ...over,
});

const redeem = (db: Firestore, uid = GUEST_UID, email = GUEST_EMAIL, accessOver: Record<string, unknown> = {}) => {
  const b = writeBatch(db);
  b.update(doc(db, 'invites', email), { usedBy: uid, usedAt: serverTimestamp() });
  b.set(doc(db, 'access', uid), {
    uid, memberId: 'omer-levy', role: 'member', email, grantedAt: serverTimestamp(), grantedVia: email, ...accessOver,
  });
  return b.commit();
};

const seedAdmin = (fn: (db: Firestore) => Promise<unknown>) =>
  testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore() as unknown as Firestore); });

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-familyfinance-identity-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), ...testFirestoreHost() },
  });
});
afterAll(async () => { await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await access.seed([DAVID, LILIT, OMER]);
  await seedAdmin(async (db) => {
    for (const [id, name] of [['david-levy', 'דויד'], ['lilit-levy', 'לילית'], ['omer-levy', 'עומר']]) {
      await setDoc(doc(db, 'members', id), { id, name, role: 'הורה', color: '#000000', groups: [], createdAt: 'x', updatedAt: 'x' });
    }
    await setDoc(doc(db, 'invites', GUEST_EMAIL), invite());
  });
});

describe('identity comes from access/{uid}, not from claims', () => {
  it('a signed-in user with no access doc is denied', async () => {
    await assertFails(getDoc(doc(asGuest(), 'members', 'omer-levy')));
  });
  it('claims alone no longer grant anything', async () => {
    const db = testEnv.authenticatedContext('uid-claims-only', { role: 'super-admin', memberId: 'david-levy' }).firestore();
    await assertFails(getDoc(doc(db, 'members', 'david-levy')));
    await assertFails(getDocs(collection(db, 'access')));
  });
  it('an access doc grants its role', async () => {
    await assertSucceeds(getDoc(doc(asUser(LILIT), 'members', 'omer-levy')));
  });
  it('a user reads their own access doc, not someone else’s', async () => {
    await assertSucceeds(getDoc(doc(asUser(OMER), 'access', OMER.uid)));
    await assertFails(getDoc(doc(asUser(OMER), 'access', LILIT.uid)));
  });
  it('a member cannot write access — not their own role, not a new doc', async () => {
    await assertFails(updateDoc(doc(asUser(OMER), 'access', OMER.uid), { role: 'super-admin' }));
    await assertFails(setDoc(doc(asUser(OMER), 'access', 'uid-x'), accessDocFor({ uid: 'uid-x', memberId: 'omer-levy', role: 'member' })));
  });
  it('a parent cannot list access or invites; super-admin can', async () => {
    await assertFails(getDocs(collection(asUser(LILIT), 'access')));
    await assertFails(getDocs(collection(asUser(LILIT), 'invites')));
    await assertSucceeds(getDocs(collection(asUser(DAVID), 'access')));
    await assertSucceeds(getDocs(collection(asUser(DAVID), 'invites')));
  });
  it('super-admin creates a valid invite only for an existing member', async () => {
    const db = asUser(DAVID);
    await assertSucceeds(setDoc(doc(db, 'invites', 'new@gmail.com'), invite({ email: 'new@gmail.com' })));
    await assertFails(setDoc(doc(db, 'invites', 'ghost@gmail.com'), invite({ email: 'ghost@gmail.com', memberId: 'nobody' })));
    await assertFails(setDoc(doc(db, 'invites', 'Mixed@gmail.com'), invite({ email: 'Mixed@gmail.com' })));
  });
  it('the heaviest read path stays under the 10-lookup limit (access + member + doc)', async () => {
    await seedAdmin(async (db) => {
      await setDoc(doc(db, 'members', 'omer-levy'), {
        id: 'omer-levy', name: 'עומר', role: 'ילד', color: '#000000', groups: [], createdAt: 'x', updatedAt: 'x',
        resolvedPermissions: { expenses: { view: 'own', edit: 'none' } },
      });
      await setDoc(doc(db, 'transaction_lines', 'tx-omer'), { ownerId: 'omer-levy', owner: 'עומר', amount: 1 });
    });
    await assertSucceeds(getDoc(doc(asUser(OMER), 'transaction_lines', 'tx-omer')));
  });
});

describe('revocation is immediate', () => {
  it('after access/{uid} is deleted the next request is denied', async () => {
    const db = asUser(LILIT);
    await assertSucceeds(getDoc(doc(db, 'members', 'omer-levy')));
    await assertSucceeds(deleteDoc(doc(asUser(DAVID), 'access', LILIT.uid)));
    await assertFails(getDoc(doc(db, 'members', 'omer-levy')));
  });
  it('only super-admin deletes access', async () => {
    await assertFails(deleteDoc(doc(asUser(LILIT), 'access', OMER.uid)));
  });
});

describe('invite redemption (spec §4.3) — one batch, bound by the rules', () => {
  it('succeeds for the verified invitee', async () => {
    await assertSucceeds(redeem(asGuest()));
  });
  it('the invitee may read their own invite; nobody else may', async () => {
    await assertSucceeds(getDoc(doc(asGuest(), 'invites', GUEST_EMAIL)));
    await assertFails(getDoc(doc(asGuest({ email: 'other@gmail.com', email_verified: true }, 'uid-other'), 'invites', GUEST_EMAIL)));
  });
  it('works when the token email is mixed-case (doc id is lower-case)', async () => {
    await assertSucceeds(redeem(asGuest({ email: 'Guest.Person@Gmail.com', email_verified: true })));
  });
  it('denies an unverified email', async () => {
    await assertFails(redeem(asGuest({ email: GUEST_EMAIL, email_verified: false })));
  });
  it('denies a different email', async () => {
    await assertFails(redeem(asGuest({ email: 'other@gmail.com', email_verified: true }, 'uid-other')));
  });
  it('denies an expired invite', async () => {
    await seedAdmin((db) => setDoc(doc(db, 'invites', GUEST_EMAIL), invite({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) })));
    await assertFails(redeem(asGuest()));
  });
  it('denies an already-used invite', async () => {
    await seedAdmin((db) => setDoc(doc(db, 'invites', GUEST_EMAIL), invite({ usedBy: 'uid-first', usedAt: Timestamp.now() })));
    await assertFails(redeem(asGuest()));
  });
  it('denies an access doc with a higher role than the invite', async () => {
    await assertFails(redeem(asGuest(), GUEST_UID, GUEST_EMAIL, { role: 'super-admin' }));
  });
  it('denies an access doc for a different member than the invite', async () => {
    await assertFails(redeem(asGuest(), GUEST_UID, GUEST_EMAIL, { memberId: 'lilit-levy' }));
  });
  it('denies access created without marking the invite used in the same batch', async () => {
    const db = asGuest();
    await assertFails(setDoc(doc(db, 'access', GUEST_UID), {
      uid: GUEST_UID, memberId: 'omer-levy', role: 'member', email: GUEST_EMAIL, grantedAt: serverTimestamp(), grantedVia: GUEST_EMAIL,
    }));
  });
  it('denies marking the invite used without creating access', async () => {
    await assertFails(updateDoc(doc(asGuest(), 'invites', GUEST_EMAIL), { usedBy: GUEST_UID, usedAt: serverTimestamp() }));
  });
  it('denies creating access for another uid', async () => {
    const db = asGuest();
    const b = writeBatch(db);
    b.update(doc(db, 'invites', GUEST_EMAIL), { usedBy: 'uid-victim', usedAt: serverTimestamp() });
    b.set(doc(db, 'access', 'uid-victim'), { uid: 'uid-victim', memberId: 'omer-levy', role: 'member', email: GUEST_EMAIL, grantedAt: serverTimestamp(), grantedVia: GUEST_EMAIL });
    await assertFails(b.commit());
  });
  it('a user who already has access cannot burn an invite', async () => {
    await seedAdmin((db) => setDoc(doc(db, 'access', GUEST_UID), accessDocFor({ uid: GUEST_UID, memberId: 'lilit-levy', role: 'parent' })));
    await assertFails(updateDoc(doc(asGuest(), 'invites', GUEST_EMAIL), { usedBy: GUEST_UID, usedAt: serverTimestamp() }));
  });
});
```

- [ ] **Step 2: Run** — `npm run test:rules` → the new file FAILS (no `access`/`invites` matches; claims still grant). Existing files still pass.

- [ ] **Step 3: Implement** — replace `firestore.rules:5-13` with:

```
    // ── Identity helpers ──────────────────────────────────────────────────────────────
    // Spec C1 §5: role and memberId come from access/{uid}, read on EVERY request — so deleting
    // the doc revokes on the next request, with no Cloud Function and no token refresh. ID-token
    // claims are no longer consulted anywhere in this file (the emulator's AI Functions still
    // read them; rules do not). get()/exists() on the same path are cached per request.
    function isSignedIn() { return request.auth != null; }
    function accessPath(uid) { return /databases/$(database)/documents/access/$(uid); }
    function hasAccess() { return isSignedIn() && exists(accessPath(request.auth.uid)); }
    function myAccess() { return get(accessPath(request.auth.uid)).data; }
    function role() { return myAccess().role; }
    function memberId() { return myAccess().memberId; }
    function isSuperAdmin() { return hasAccess() && role() == 'super-admin'; }
    function isParent() { return hasAccess() && role() == 'parent'; }
    // A signed-in user with no access doc is denied everywhere — never a guest fall-through.
    function hasRole() { return hasAccess() && role() in ['super-admin', 'parent', 'member']; }

    // Verified email of the caller, lower-cased — the invite doc id (spec §4.1: attach a member
    // ONLY to a verified email; Google sign-in is always verified).
    function verifiedEmail() {
      return request.auth.token.email_verified == true ? request.auth.token.email.lower() : null;
    }
```

Add after `isValidAuditEntry` (validators section):

```
    function isValidInvite(data, email) {
      return data.keys().hasOnly(['email', 'memberId', 'role', 'createdBy', 'createdAt', 'expiresAt'])
        && data.email == email && email == email.lower()
        && data.memberId is string && exists(/databases/$(database)/documents/members/$(data.memberId))
        && data.role in ['super-admin', 'parent', 'member']
        && data.createdBy is string
        && data.createdAt is timestamp && data.expiresAt is timestamp && data.expiresAt > data.createdAt;
    }

    function isValidAccess(data, uid) {
      return data.keys().hasOnly(['uid', 'memberId', 'role', 'email', 'grantedAt', 'grantedVia'])
        && data.uid == uid
        && data.memberId is string && exists(/databases/$(database)/documents/members/$(data.memberId))
        && data.role in ['super-admin', 'parent', 'member']
        && data.email is string && data.grantedAt is timestamp && data.grantedVia is string;
    }

    // Spec §4.3 — the two halves of ONE batch. Each half checks the other's after-state, so
    // neither can be written alone; a caller who already has access cannot burn an invite.
    function isInviteRedemption(email) {
      let before = resource.data;
      let after = request.resource.data;
      return isSignedIn() && verifiedEmail() == email
        && !('usedBy' in before) && before.expiresAt > request.time
        && after.diff(before).affectedKeys().hasOnly(['usedBy', 'usedAt'])
        && after.usedBy == request.auth.uid && after.usedAt == request.time
        && !exists(accessPath(request.auth.uid))
        && existsAfter(accessPath(request.auth.uid));
    }

    function isAccessRedemption(uid) {
      let email = verifiedEmail();
      let invitePath = /databases/$(database)/documents/invites/$(email);
      let inv = get(invitePath).data;
      let a = request.resource.data;
      return isSignedIn() && request.auth.uid == uid && email != null
        && exists(invitePath) && !('usedBy' in inv) && inv.expiresAt > request.time
        && getAfter(invitePath).data.get('usedBy', null) == uid
        && a.keys().hasOnly(['uid', 'memberId', 'role', 'email', 'grantedAt', 'grantedVia'])
        && a.uid == uid && a.memberId == inv.memberId && a.role == inv.role
        && a.email == email && a.grantedAt == request.time && a.grantedVia == email;
    }
```

Add before `match /members/{memberId}`:

```
    match /invites/{email} {
      allow get: if (isSignedIn() && verifiedEmail() == email) || isSuperAdmin();
      allow list: if isSuperAdmin();
      allow create: if isSuperAdmin() && isValidInvite(request.resource.data, email);
      allow update: if isInviteRedemption(email);
      allow delete: if isSuperAdmin();
    }

    match /access/{uid} {
      allow get: if (isSignedIn() && request.auth.uid == uid) || isSuperAdmin();
      allow list: if isSuperAdmin();
      allow create: if (isSuperAdmin() && isValidAccess(request.resource.data, uid)) || isAccessRedemption(uid);
      allow update: if isSuperAdmin() && isValidAccess(request.resource.data, uid);
      allow delete: if isSuperAdmin();
    }
```

No existing `match` body changes. (`audit_log` keeps `role() in [...]` — with no access doc `role()` errors, which denies.)

- [ ] **Step 4: Run** — `npm run test:rules` → all PASS (new file + every pre-existing file). If a pre-existing test now fails, the identity it uses is seeded with the wrong role/memberId in Task 2 — fix the fixture, not the rule.

- [ ] **Step 5: Differential matrix — prove nothing widened.**

```bash
SCR=/private/tmp/claude-501/c1-matrix; mkdir -p "$SCR"
git show main:firestore.rules > "$SCR/before.rules"
npx firebase --config firebase.rules-test.json emulators:exec --project demo-familyfinance --only firestore \
  "npx tsx firestore-tests/tools/differential-rules-matrix.ts $SCR/before.rules demo-matrix-before $SCR/before.json && npx tsx firestore-tests/tools/differential-rules-matrix.ts firestore.rules demo-matrix-after $SCR/after.json"
npx tsx firestore-tests/tools/differential-rules-matrix.ts --diff "$SCR/before.json" "$SCR/after.json"
```

Expected: **0 WIDENED, 0 NARROWED** (every `auth` session has a matching access doc; anon/claimless were denied before and after). Any WIDENED cell is a blocker.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules firestore-tests/identity-access.rules.test.ts
git commit -m "feat(rules): identity from access/{uid}; invites + rules-enforced redemption; immediate revoke"
```

---

### Task 4: Emulator continuity — live and demo get `access` docs

Must land in the same merge as Task 3 (spec §5): without it the family is locked out of live mode.

**Files:**
- Create: `scripts/live/family.ts` (the five members, moved out of `bootstrap-live.ts`)
- Create: `scripts/live/ensureAccessPlan.ts`
- Create: `src/__tests__/ensureAccessPlan.test.ts`
- Modify: `scripts/live/bootstrap-live.ts` (import `FAMILY`/`MODULES`/`emailOf` from `./family`; add `--ensure-access` mode)
- Modify: `scripts/live/start-live.sh` (pin a rules snapshot at start; run `--ensure-access` on every start)
- Modify: `.gitignore` (`.firebase-live.json`)
- Create: `src/__tests__/startLiveRulesPin.test.ts`
- Modify: `scripts/provision-auth-users.ts:127` (write `access` next to claims)

**Interfaces:**
- Produces: `FAMILY: FamilyMember[]`, `MODULES`, `emailOf(m)` from `scripts/live/family.ts` (Task 10 reuses them).
- Produces: `planAccessWrites(users: AuthUserClaims[], existing: ReadonlyMap<string, ExistingAccess | null>): AccessWrite[]` where `AuthUserClaims = { uid: string; email: string; role: unknown; memberId: unknown }`, `ExistingAccess = { role: string; memberId: string }`, `AccessWrite = { uid: string; email: string; role: 'super-admin' | 'parent' | 'member'; memberId: string; reason: 'missing' | 'changed' }`.

- [ ] **Step 1: Write the failing test** — `src/__tests__/ensureAccessPlan.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { planAccessWrites } from '../../scripts/live/ensureAccessPlan';

const david = { uid: 'u1', email: 'david-levy@familyfinance.local', role: 'super-admin', memberId: 'david-levy' };
const lilit = { uid: 'u2', email: 'lilit-levy@familyfinance.local', role: 'parent', memberId: 'lilit-levy' };

describe('planAccessWrites — idempotent mirror of emulator claims into access/{uid}', () => {
  it('writes a missing access doc', () => {
    expect(planAccessWrites([david], new Map([['u1', null]]))).toEqual([
      { uid: 'u1', email: david.email, role: 'super-admin', memberId: 'david-levy', reason: 'missing' },
    ]);
  });
  it('second run = 0 writes', () => {
    expect(planAccessWrites([david, lilit], new Map([
      ['u1', { role: 'super-admin', memberId: 'david-levy' }],
      ['u2', { role: 'parent', memberId: 'lilit-levy' }],
    ]))).toEqual([]);
  });
  it('re-asserts a doc whose role drifted from the claims', () => {
    expect(planAccessWrites([lilit], new Map([['u2', { role: 'member', memberId: 'lilit-levy' }]]))[0].reason).toBe('changed');
  });
  it('skips users without valid claims — never invents a role', () => {
    expect(planAccessWrites([{ uid: 'u9', email: 'x@y', role: 'god', memberId: 'x' }, { uid: 'u8', email: 'z@y', role: undefined, memberId: undefined }], new Map())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/__tests__/ensureAccessPlan.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

`scripts/live/ensureAccessPlan.ts`:

```ts
// Pure core of `bootstrap-live.ts --ensure-access` (spec C1 §5). The emulator's auth users carry
// role/memberId claims (set by bootstrap-live / provision-auth-users); the rules now read
// access/{uid} instead. This decides which access docs to write so that a second run writes 0.
export type AccessRole = 'super-admin' | 'parent' | 'member';
export interface AuthUserClaims { uid: string; email: string; role: unknown; memberId: unknown }
export interface ExistingAccess { role: string; memberId: string }
export interface AccessWrite { uid: string; email: string; role: AccessRole; memberId: string; reason: 'missing' | 'changed' }

const ROLES: readonly AccessRole[] = ['super-admin', 'parent', 'member'];
const isRole = (v: unknown): v is AccessRole => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

export function planAccessWrites(users: AuthUserClaims[], existing: ReadonlyMap<string, ExistingAccess | null>): AccessWrite[] {
  const writes: AccessWrite[] = [];
  for (const u of users) {
    if (!isRole(u.role) || typeof u.memberId !== 'string' || u.memberId.length === 0) continue;
    const have = existing.get(u.uid) ?? null;
    if (have && have.role === u.role && have.memberId === u.memberId) continue;
    writes.push({ uid: u.uid, email: u.email, role: u.role, memberId: u.memberId, reason: have ? 'changed' : 'missing' });
  }
  return writes;
}
```

`scripts/live/family.ts`: move `FamilyMember`, `FAMILY`, `MODULES`, `emailOf` verbatim from `bootstrap-live.ts:22-45` and `export` them; `bootstrap-live.ts` imports them.

`bootstrap-live.ts` — add (reusing its `authFetch`, `ensureEmulators`, `PROJECT_ID`, `FIRESTORE_HOST`):

```ts
import { planAccessWrites, type AuthUserClaims, type ExistingAccess } from './ensureAccessPlan';

async function firestoreGet(docPath: string): Promise<Record<string, { stringValue?: string }> | null> {
  const res = await fetch(
    `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`,
    { headers: { Authorization: 'Bearer owner' } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`firestore get ${docPath}: ${await res.text()}`);
  return ((await res.json()) as { fields?: Record<string, { stringValue?: string }> }).fields ?? {};
}

async function ensureAccess(): Promise<void> {
  await ensureEmulators();
  const res = await authFetch(`projects/${PROJECT_ID}/accounts:query`, {});
  const raw = (res.userInfo as Array<{ localId: string; email?: string; customAttributes?: string }> | undefined) ?? [];
  const users: AuthUserClaims[] = raw.map((u) => {
    let claims: Record<string, unknown> = {};
    try { claims = u.customAttributes ? (JSON.parse(u.customAttributes) as Record<string, unknown>) : {}; } catch { /* no claims */ }
    return { uid: u.localId, email: u.email ?? '', role: claims.role, memberId: claims.memberId };
  });
  const existing = new Map<string, ExistingAccess | null>();
  for (const u of users) {
    const f = await firestoreGet(`access/${u.uid}`);
    existing.set(u.uid, f ? { role: f.role?.stringValue ?? '', memberId: f.memberId?.stringValue ?? '' } : null);
  }
  const writes = planAccessWrites(users, existing);
  const now = new Date().toISOString();
  for (const w of writes) {
    await firestoreSet(`access/${w.uid}`, {
      uid: s(w.uid), memberId: s(w.memberId), role: s(w.role), email: s(w.email),
      grantedAt: { timestampValue: now }, grantedVia: s('bootstrap'),
    });
    console.log(`  access  ${w.email}  role=${w.role}  (${w.reason})`);
  }
  console.log(`ensure-access: ${writes.length} write(s), ${users.length} user(s).`);
}
```

and at the top of `main()`: `if (process.argv.includes('--ensure-access')) return ensureAccess();`. Update the header comment's "Run:" block with the new mode.

`start-live.sh` — right after the `if [ "$FIRST_RUN" = "1" ]; then … fi` block:

```zsh
# Spec C1 §5: rules read access/{uid}, not claims. Mirror claims → access on EVERY start
# (idempotent: a second run writes 0), before the browser opens. A failure leaves the family on
# "לא משויך" — loud, not silent.
say "מוודא הרשאות גישה לכל בני המשפחה…"
if ! FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
    npx tsx scripts/live/bootstrap-live.ts --ensure-access; then
  say "⚠️ לא הצלחתי לוודא הרשאות גישה — ייתכן שתראה 'לא משויך'. עיין בפלט למעלה."
fi
```

**Live mode pins its rules at start (Sun review — the choke point for Review Focus 1).** The Firestore emulator hot-reloads its rules file whenever it changes on disk, and *any* path can change `firestore.rules` in the main checkout while live runs: a merge, a `git pull`, a checkout, an editor, another session. Guarding one merge (Task 12) guards one caller. So live mode stops reading the tracked file: `start-live.sh` copies it to `family-data/logs/live.rules` and starts the emulator from a generated, git-ignored config that points there. A rules change on disk then reaches live only at the next start — the one place that also runs `--ensure-access`. In `start-live.sh`, immediately before the `npx firebase emulators:start` line:

```zsh
# Pin this session's rules (Sun, C1): the emulator hot-reloads its rules FILE, so a merge/pull that
# changes firestore.rules mid-session would hit live data that was never prepared for it (e.g. the
# access/{uid} switch). Live reads a snapshot; a new rules version arrives only via a fresh start,
# which also runs --ensure-access below.
cp "$APP_DIR/firestore.rules" "$LOG_DIR/live.rules"
node -e 'const c=require(process.argv[1]); c.firestore.rules=process.argv[2]; require("fs").writeFileSync(process.argv[3], JSON.stringify(c,null,2));' \
  "$APP_DIR/firebase.json" "family-data/logs/live.rules" "$APP_DIR/.firebase-live.json"
```

and add `--config .firebase-live.json` to that `npx firebase emulators:start` command (the config sits at the repo root, so `functions` and every other relative path resolve exactly as before). Add `.firebase-live.json` to `.gitignore`. Pin it with a test — `src/__tests__/startLiveRulesPin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('live mode reads a rules snapshot, never the tracked file (Sun, C1)', () => {
  const sh = readFileSync('scripts/live/start-live.sh', 'utf8');
  it('snapshots firestore.rules and starts the emulator from the generated config', () => {
    const snap = sh.indexOf('live.rules');
    const start = sh.indexOf('emulators:start');
    expect(snap).toBeGreaterThan(-1);
    expect(snap).toBeLessThan(start);
    expect(sh.slice(start, sh.indexOf('\n', start))).toContain('--config .firebase-live.json');
  });
  it('runs --ensure-access on every start, after the emulator is ready', () => {
    expect(sh.indexOf('--ensure-access')).toBeGreaterThan(sh.indexOf('All emulators ready'));
  });
  it('the generated config is git-ignored', () => {
    expect(readFileSync('.gitignore', 'utf8')).toMatch(/^\.firebase-live\.json$/m);
  });
});
```

`provision-auth-users.ts` — after `await auth.setCustomUserClaims(userRecord.uid, newClaims);` (line 127):

```ts
    // Spec C1 §5: rules read access/{uid}; claims stay for the emulator's AI Functions.
    await db.collection('access').doc(userRecord.uid).set({
      uid: userRecord.uid, memberId: newClaims.memberId, role: newClaims.role,
      email: userRecord.email ?? p.email, grantedAt: Timestamp.now(), grantedVia: 'bootstrap',
    });
```

(add `Timestamp` to the existing `firebase-admin/firestore` import). Note for David in the commit body: the demo ledger (`.emulator-data`) needs one `npm run provision:auth` after this merge.

- [ ] **Step 4: Run** — `npx vitest run src/__tests__/ensureAccessPlan.test.ts src/__tests__/startLiveRulesPin.test.ts` → PASS; `zsh -n scripts/live/start-live.sh` → no output; `npm run lint` → clean.

- [ ] **Step 5: Exercise `--ensure-access` against a throwaway emulator (never :8080).**

```bash
npx firebase --config firebase.rules-test.json emulators:exec --project family-finance-app-c9aa4 --only firestore,auth \
  "FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 npx tsx scripts/live/bootstrap-live.ts --apply && FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 npx tsx scripts/live/bootstrap-live.ts --ensure-access && FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 npx tsx scripts/live/bootstrap-live.ts --ensure-access"
```

Add `"auth": { "port": 9199 }` to `firebase.rules-test.json` emulators first, and prefix each command with `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199`. Expected output: first `--ensure-access` → `5 write(s)`; second → `0 write(s)`.

- [ ] **Step 6: Commit**

```bash
git add scripts/live src/__tests__/ensureAccessPlan.test.ts src/__tests__/startLiveRulesPin.test.ts scripts/provision-auth-users.ts firebase.rules-test.json .gitignore
git commit -m "feat(live): mirror emulator claims into access/{uid} on every start; provisioning writes access"
```

---

### Task 5: `useAuthSession` reads `access/{uid}` live

**Files:**
- Modify: `src/hooks/useAuthSession.ts`
- Modify: `src/__tests__/useAuthSession.test.ts`

**Interfaces:**
- Consumes: `access/{uid}` contract (Task 3).
- Produces: unchanged `AuthSession`/`AuthStatus` shape; new export `parseAccess(data: unknown): { role: PermissionRole; memberId: string } | null`.

- [ ] **Step 1: Rewrite the tests** — replace the claims-based cases in `src/__tests__/useAuthSession.test.ts`. New mocks and cases:

```ts
const { mockOnAuthStateChanged, mockSignOut, mockOnSnapshot, mockDoc } = vi.hoisted(() => ({
  mockOnAuthStateChanged: vi.fn(), mockSignOut: vi.fn(), mockOnSnapshot: vi.fn(), mockDoc: vi.fn((_db, ...path: string[]) => path.join('/')),
}));
vi.mock('../services/firebase', () => ({ auth: {}, db: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: mockOnAuthStateChanged, signOut: mockSignOut }));
vi.mock('firebase/firestore', () => ({ onSnapshot: mockOnSnapshot, doc: mockDoc }));

type SnapCb = (snap: { exists: () => boolean; data: () => unknown; metadata: { fromCache: boolean } }) => void;
const snap = (data: unknown, fromCache = false) => ({ exists: () => data != null, data: () => data, metadata: { fromCache } });
const signIn = (uid = 'u1') => mockOnAuthStateChanged.mockImplementation((_a, next) => { next({ uid }); return () => {}; });

it('ready when access/{uid} holds a valid role + memberId', async () => {
  signIn();
  mockOnSnapshot.mockImplementation((_ref, next: SnapCb) => { next(snap({ role: 'parent', memberId: 'lilit-levy' })); return () => {}; });
  const { result } = renderHook(() => useAuthSession());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.role).toBe('parent');
  expect(result.current.memberId).toBe('lilit-levy');
  expect(mockDoc).toHaveBeenCalledWith({}, 'access', 'u1');
});

it('unprovisioned when the server says there is no access doc', async () => {
  signIn();
  mockOnSnapshot.mockImplementation((_ref, next: SnapCb) => { next(snap(null)); return () => {}; });
  const { result } = renderHook(() => useAuthSession());
  await waitFor(() => expect(result.current.status).toBe('unprovisioned'));
});

it('a cache-only "missing" snapshot keeps loading (no flash of לא משויך)', async () => {
  signIn();
  mockOnSnapshot.mockImplementation((_ref, next: SnapCb) => { next(snap(null, true)); return () => {}; });
  const { result } = renderHook(() => useAuthSession());
  await act(async () => {});
  expect(result.current.status).toBe('loading');
});

it('revocation: ready → unprovisioned when the doc disappears', async () => {
  signIn();
  let push: SnapCb = () => {};
  mockOnSnapshot.mockImplementation((_ref, next: SnapCb) => { push = next; next(snap({ role: 'member', memberId: 'omer-levy' })); return () => {}; });
  const { result } = renderHook(() => useAuthSession());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  act(() => push(snap(null)));
  expect(result.current.status).toBe('unprovisioned');
});

it('a corrupt access doc (unknown role) is unprovisioned, never a guessed role', async () => {
  signIn();
  mockOnSnapshot.mockImplementation((_ref, next: SnapCb) => { next(snap({ role: 'god', memberId: 'x' })); return () => {}; });
  const { result } = renderHook(() => useAuthSession());
  await waitFor(() => expect(result.current.status).toBe('unprovisioned'));
});

it('a listener error is "error", not an empty session', async () => {
  signIn();
  mockOnSnapshot.mockImplementation((_ref, _next, onErr: (e: Error) => void) => { onErr(new Error('boom')); return () => {}; });
  const { result } = renderHook(() => useAuthSession());
  await waitFor(() => expect(result.current.status).toBe('error'));
});

it('signing out unsubscribes the access listener', async () => {
  const unsubAccess = vi.fn();
  let authNext: (u: unknown) => void = () => {};
  mockOnAuthStateChanged.mockImplementation((_a, next) => { authNext = next; next({ uid: 'u1' }); return () => {}; });
  mockOnSnapshot.mockImplementation((_ref, next: SnapCb) => { next(snap({ role: 'member', memberId: 'omer-levy' })); return unsubAccess; });
  const { result } = renderHook(() => useAuthSession());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  act(() => authNext(null));
  expect(unsubAccess).toHaveBeenCalled();
  expect(result.current.status).toBe('signed-out');
});
```

Keep the existing "starts in loading", "signed-out", and `signOutCurrentUser` Drive-key tests.

- [ ] **Step 2: Run** — `npx vitest run src/__tests__/useAuthSession.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `useAuthSession.ts`: replace the header comment's claims paragraphs with a 4-line note ("Spec C1 §4: role/memberId come from access/{uid} via a live listener, so a revoke reaches an open tab immediately; claims are not read"). Imports: add `import { doc, onSnapshot } from 'firebase/firestore';` and `db` from `../services/firebase`. Then:

```ts
export function parseAccess(data: unknown): { role: PermissionRole; memberId: string } | null {
  if (!data || typeof data !== 'object') return null;
  const { role, memberId } = data as { role?: unknown; memberId?: unknown };
  if (!isPermissionRole(role) || typeof memberId !== 'string' || memberId.length === 0) return null;
  return { role, memberId };
}

export function useAuthSession(): AuthSession {
  const [session, setSession] = useState<AuthSession>(INITIAL);
  const generationRef = useRef(0);

  useEffect(() => {
    let stopAccess: (() => void) | null = null;
    const detachAccess = () => { stopAccess?.(); stopAccess = null; };

    const unsubscribe = onAuthStateChanged(auth, (user: User | null) => {
      const generation = ++generationRef.current;
      detachAccess();
      if (!user) {
        setSession({ status: 'signed-out', user: null, role: null, memberId: null, error: null });
        return;
      }
      setSession({ ...INITIAL, user });
      stopAccess = onSnapshot(
        doc(db, 'access', user.uid),
        (snap) => {
          if (generationRef.current !== generation) return;
          // Cache says "missing" before the server answered: stay loading (Review Focus 5).
          if (!snap.exists() && snap.metadata.fromCache) return;
          const parsed = parseAccess(snap.exists() ? snap.data() : null);
          setSession(parsed
            ? { status: 'ready', user, role: parsed.role, memberId: parsed.memberId, error: null }
            : { status: 'unprovisioned', user, role: null, memberId: null, error: UNPROVISIONED_MESSAGE });
        },
        (err: unknown) => {
          if (generationRef.current !== generation) return;
          setSession({ status: 'error', user, role: null, memberId: null,
            error: err instanceof Error ? err.message : 'שגיאה בטעינת הרשאות המשתמש' });
        },
      );
    });

    return () => {
      generationRef.current += 1;
      detachAccess();
      unsubscribe();
    };
  }, []);

  return session;
}
```

Change `UNPROVISIONED_MESSAGE` to: `'החשבון שלך מחובר אך עדיין לא משויך לבן משפחה במערכת. אם קיבלת הזמנה — לחץ "יש לי הזמנה".'`

Update the stale comments in `App.tsx:154` and `App.tsx:183` ("Firebase Auth custom claims" → "access/{uid}, read by useAuthSession").

- [ ] **Step 4: Run** — `npx vitest run src/__tests__/useAuthSession.test.ts` → PASS; `npm test` → PASS (App tests mock the hook).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAuthSession.ts src/__tests__/useAuthSession.test.ts src/App.tsx
git commit -m "feat(auth): session role from a live access/{uid} listener — revoke reaches open tabs"
```

---

### Task 6: Invite redemption — service + "לא משויך" screen

**Files:**
- Create: `src/services/InvitesService.ts`
- Create: `src/components/UnassignedScreen.tsx`
- Create: `src/__tests__/InvitesService.test.ts`
- Create: `src/__tests__/UnassignedScreen.test.tsx`
- Modify: `src/App.tsx:136-150` (render `UnassignedScreen` for `unprovisioned`; keep the existing card for `error`)

**Interfaces:**
- Consumes: invite/access contract (Task 3); `useAuthSession` listener (Task 5) flips to `ready` by itself after a successful redeem.
- Produces: `redeemMyInvite(user: User): Promise<RedeemOutcome>`; `type RedeemOutcome = { ok: true } | { ok: false; reason: 'no-email' | 'not-verified' | 'no-invite' | 'expired' | 'used' | 'failed'; message: string }`; `REDEEM_MESSAGES: Record<Exclude<RedeemOutcome, {ok: true}>['reason'], string>`; `<UnassignedScreen user={User} message={string | null} />`.

- [ ] **Step 1: Write the failing service test** — `src/__tests__/InvitesService.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getDoc: vi.fn(), doc: vi.fn((_db, ...p: string[]) => p.join('/')), writeBatch: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TS'), update: vi.fn(), set: vi.fn(), commit: vi.fn(),
}));
vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  getDoc: m.getDoc, doc: m.doc, serverTimestamp: m.serverTimestamp,
  writeBatch: () => ({ update: m.update, set: m.set, commit: m.commit }),
}));

import { redeemMyInvite } from '../services/InvitesService';

const user = (over: Record<string, unknown> = {}) => ({
  uid: 'u-guest', email: 'Guest.Person@Gmail.com', emailVerified: true,
  reload: vi.fn().mockResolvedValue(undefined), getIdToken: vi.fn().mockResolvedValue('t'), ...over,
}) as never;
const inviteSnap = (data: Record<string, unknown> | null) => ({ exists: () => data != null, data: () => data });
const future = { toMillis: () => Date.now() + 1e9 };
const past = { toMillis: () => Date.now() - 1 };

beforeEach(() => { Object.values(m).forEach((f) => f.mockClear()); m.commit.mockResolvedValue(undefined); });

describe('redeemMyInvite', () => {
  it('refreshes the token before reading, then commits ONE batch keyed by the lower-cased email', async () => {
    const u = user();
    m.getDoc.mockResolvedValue(inviteSnap({ memberId: 'omer-levy', role: 'member', expiresAt: future }));
    expect(await redeemMyInvite(u)).toEqual({ ok: true });
    expect((u as { reload: ReturnType<typeof vi.fn> }).reload).toHaveBeenCalled();
    expect((u as { getIdToken: ReturnType<typeof vi.fn> }).getIdToken).toHaveBeenCalledWith(true);
    expect(m.doc).toHaveBeenCalledWith({}, 'invites', 'guest.person@gmail.com');
    expect(m.update).toHaveBeenCalledWith('invites/guest.person@gmail.com', { usedBy: 'u-guest', usedAt: 'SERVER_TS' });
    expect(m.set).toHaveBeenCalledWith('access/u-guest', {
      uid: 'u-guest', memberId: 'omer-levy', role: 'member', email: 'guest.person@gmail.com',
      grantedAt: 'SERVER_TS', grantedVia: 'guest.person@gmail.com',
    });
    expect(m.commit).toHaveBeenCalledTimes(1);
  });
  it('not verified → no read, no write', async () => {
    expect(await redeemMyInvite(user({ emailVerified: false }))).toMatchObject({ ok: false, reason: 'not-verified' });
    expect(m.getDoc).not.toHaveBeenCalled();
  });
  it('no invite → no-invite', async () => {
    m.getDoc.mockResolvedValue(inviteSnap(null));
    expect(await redeemMyInvite(user())).toMatchObject({ ok: false, reason: 'no-invite' });
  });
  it('expired → expired, nothing written', async () => {
    m.getDoc.mockResolvedValue(inviteSnap({ memberId: 'omer-levy', role: 'member', expiresAt: past }));
    expect(await redeemMyInvite(user())).toMatchObject({ ok: false, reason: 'expired' });
    expect(m.commit).not.toHaveBeenCalled();
  });
  it('used → used', async () => {
    m.getDoc.mockResolvedValue(inviteSnap({ memberId: 'omer-levy', role: 'member', expiresAt: future, usedBy: 'someone' }));
    expect(await redeemMyInvite(user())).toMatchObject({ ok: false, reason: 'used' });
  });
  it('a rejected commit is "failed", never success', async () => {
    m.getDoc.mockResolvedValue(inviteSnap({ memberId: 'omer-levy', role: 'member', expiresAt: future }));
    m.commit.mockRejectedValue(new Error('permission-denied'));
    expect(await redeemMyInvite(user())).toMatchObject({ ok: false, reason: 'failed' });
  });
});
```

- [ ] **Step 2: Run** — FAIL (module missing).

- [ ] **Step 3: Implement** — `src/services/InvitesService.ts`

```ts
// Spec C1 §4.3 — invite redemption in the browser. The rules are the boundary (they bind the two
// writes together and check email/expiry/role); this service only gives the user a clear Hebrew
// reason before trying, and refreshes the token first so a just-verified email is visible to them.
import { doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';

export type RedeemFailure = 'no-email' | 'not-verified' | 'no-invite' | 'expired' | 'used' | 'failed';
export type RedeemOutcome = { ok: true } | { ok: false; reason: RedeemFailure; message: string };

export const REDEEM_MESSAGES: Record<RedeemFailure, string> = {
  'no-email': 'לחשבון הזה אין כתובת אימייל, ולכן אי אפשר לשייך אותו להזמנה.',
  'not-verified': 'צריך קודם לאמת את כתובת האימייל — בדוק את תיבת הדואר ולחץ על הקישור.',
  'no-invite': 'לא נמצאה הזמנה לכתובת הזו. בקש מדויד לשלוח הזמנה לאימייל שאיתו נכנסת.',
  expired: 'ההזמנה פגה. בקש מדויד הזמנה חדשה.',
  used: 'ההזמנה כבר נוצלה. אם זה לא אתה — פנה לדויד.',
  failed: 'הפעולה נכשלה. נסה שוב, ואם זה חוזר — פנה לדויד.',
};

const fail = (reason: RedeemFailure): RedeemOutcome => ({ ok: false, reason, message: REDEEM_MESSAGES[reason] });

export async function redeemMyInvite(user: User): Promise<RedeemOutcome> {
  try {
    await user.reload();
    if (!user.email) return fail('no-email');
    if (!user.emailVerified) return fail('not-verified');
    await user.getIdToken(true); // the rules read email_verified from the token (Review Focus 3)
    const email = user.email.toLowerCase();
    const inviteRef = doc(db, 'invites', email);
    const snap = await getDoc(inviteRef);
    if (!snap.exists()) return fail('no-invite');
    const inv = snap.data() as { memberId: string; role: string; expiresAt: { toMillis(): number }; usedBy?: string };
    if (inv.usedBy) return fail('used');
    if (inv.expiresAt.toMillis() <= Date.now()) return fail('expired');
    const batch = writeBatch(db);
    batch.update(inviteRef, { usedBy: user.uid, usedAt: serverTimestamp() });
    batch.set(doc(db, 'access', user.uid), {
      uid: user.uid, memberId: inv.memberId, role: inv.role, email,
      grantedAt: serverTimestamp(), grantedVia: email,
    });
    await batch.commit();
    return { ok: true };
  } catch (err) {
    console.error('[InvitesService] redeem failed:', err);
    return fail('failed');
  }
}
```

(The `no-invite` read: for the verified invitee the `get` rule passes on a missing doc, so it returns `exists() === false` rather than permission-denied.)

**Audit for redemption (spec §6.1) — deviation, on purpose:** no `audit_log` write in the redemption batch. `audit_log` create requires `actorMemberId == memberId()`, and `memberId()` reads `access/{uid}` in its *pre-batch* state, where it does not exist yet — so an audit write would deny the whole batch. The redeemed invite itself is the record: `usedBy` + `usedAt` (server time) are written once and can never change again (the update rule requires `!('usedBy' in before)`). Invite creation and revocation are audited by the Task 10 scripts.

- [ ] **Step 4: Write the failing screen test** — `src/__tests__/UnassignedScreen.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ redeem: vi.fn(), sendVerification: vi.fn(), signOut: vi.fn() }));
vi.mock('../services/InvitesService', async (orig) => ({ ...(await orig<object>()), redeemMyInvite: m.redeem }));
vi.mock('firebase/auth', () => ({ sendEmailVerification: m.sendVerification }));
vi.mock('../hooks/useAuthSession', () => ({ signOutCurrentUser: m.signOut }));

import UnassignedScreen from '../components/UnassignedScreen';

const user = (over = {}) => ({ uid: 'u', email: 'g@gmail.com', emailVerified: true, reload: vi.fn().mockResolvedValue(undefined), ...over }) as never;

describe('UnassignedScreen', () => {
  it('verified user: "יש לי הזמנה" redeems and shows a failure reason in Hebrew', async () => {
    m.redeem.mockResolvedValue({ ok: false, reason: 'expired', message: 'ההזמנה פגה. בקש מדויד הזמנה חדשה.' });
    render(<UnassignedScreen user={user()} message="לא משויך" />);
    await userEvent.click(screen.getByRole('button', { name: 'יש לי הזמנה' }));
    expect(await screen.findByText('ההזמנה פגה. בקש מדויד הזמנה חדשה.')).toBeInTheDocument();
  });
  it('unverified user: offers resend + "אימתתי", no redeem button', async () => {
    render(<UnassignedScreen user={user({ emailVerified: false })} message="לא משויך" />);
    expect(screen.queryByRole('button', { name: 'יש לי הזמנה' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'שלח שוב מייל אימות' }));
    expect(m.sendVerification).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'אימתתי' })).toBeInTheDocument();
  });
  it('always offers sign-out', () => {
    render(<UnassignedScreen user={user()} message={null} />);
    expect(screen.getByRole('button', { name: 'התנתק' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Implement** — `src/components/UnassignedScreen.tsx`

```tsx
// Spec C1 §4.3 — a signed-in user with no access/{uid}. Verified → "יש לי הזמנה" (redeem);
// unverified → resend + "אימתתי" (reload). On success nothing navigates: useAuthSession's access
// listener sees the new doc and App re-renders past this screen.
import { useState } from 'react';
import { sendEmailVerification, type User } from 'firebase/auth';
import { Loader2 } from 'lucide-react';
import { redeemMyInvite } from '../services/InvitesService';
import { signOutCurrentUser } from '../hooks/useAuthSession';

export default function UnassignedScreen({ user, message }: { user: User; message: string | null }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setTick] = useState(0); // user.reload() mutates `user` in place — re-render to read it

  const redeem = async () => {
    setBusy(true); setNotice(null);
    const outcome = await redeemMyInvite(user);
    if (!outcome.ok) setNotice(outcome.message);
    setBusy(false);
  };
  const resend = async () => {
    setBusy(true);
    try { await sendEmailVerification(user); setNotice(`שלחנו מייל אימות ל-${user.email}.`); }
    catch { setNotice('שליחת המייל נכשלה. נסה שוב בעוד דקה.'); }
    setBusy(false);
  };
  const recheck = async () => { setBusy(true); await user.reload(); setTick((t) => t + 1); setBusy(false); };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 w-full max-w-sm text-center space-y-4">
        <p className="text-slate-700">{message}</p>
        <p className="text-xs text-slate-500" dir="ltr">{user.email}</p>
        {user.emailVerified ? (
          <button onClick={redeem} disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 font-medium disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'יש לי הזמנה'}
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-amber-700">כדי לקבל גישה צריך לאמת את כתובת האימייל.</p>
            <button onClick={resend} disabled={busy} className="w-full border border-slate-300 rounded-xl py-2 text-sm">שלח שוב מייל אימות</button>
            <button onClick={recheck} disabled={busy} className="w-full bg-blue-600 text-white rounded-xl py-2 text-sm">אימתתי</button>
          </div>
        )}
        {notice && <p className="text-sm text-red-600" role="status">{notice}</p>}
        <button onClick={() => signOutCurrentUser()} className="text-sm text-slate-500 underline hover:text-slate-700">התנתק</button>
      </div>
    </div>
  );
}
```

In `App.tsx` split the early return: `if (session.status === 'unprovisioned') return <UnassignedScreen user={session.user!} message={session.error} />;` and keep the existing red card for `session.status === 'error'`. Update `src/__tests__/App.test.tsx` if it asserts on the old unprovisioned card text (assert the new screen's `יש לי הזמנה` button instead).

- [ ] **Step 6: Run** — `npx vitest run src/__tests__/InvitesService.test.ts src/__tests__/UnassignedScreen.test.tsx src/__tests__/App.test.tsx` → PASS; `npm test`, `npm run lint` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/services/InvitesService.ts src/components/UnassignedScreen.tsx src/App.tsx src/__tests__
git commit -m "feat(auth): 'לא משויך' screen with email verification and in-browser invite redemption"
```

---

### Task 7: Login — Google + self-signup with email verification

**Files:**
- Create: `src/utils/signupValidation.ts`
- Create: `src/__tests__/signupValidation.test.ts`
- Modify: `src/components/LoginScreen.tsx`
- Modify: `src/__tests__/LoginScreen.test.tsx`

**Interfaces:**
- Produces: `validateSignup(email: string, password: string, confirm: string): string | null` (Hebrew error or null); `MIN_PASSWORD_LENGTH = 10`.

- [ ] **Step 1: Failing tests**

`src/__tests__/signupValidation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateSignup, MIN_PASSWORD_LENGTH } from '../utils/signupValidation';

describe('validateSignup (spec §4.1 — ≥10 chars enforced in the form, Identity Platform is paid)', () => {
  it('rejects a short password', () => { expect(validateSignup('a@b.co', '123456789', '123456789')).toMatch(/10/); });
  it('rejects a mismatch', () => { expect(validateSignup('a@b.co', '1234567890', '1234567899')).toMatch(/אינן תואמות/); });
  it('rejects an email without @', () => { expect(validateSignup('ab.co', '1234567890', '1234567890')).toMatch(/אימייל/); });
  it('accepts a valid form', () => { expect(validateSignup(' a@b.co ', 'x'.repeat(MIN_PASSWORD_LENGTH), 'x'.repeat(MIN_PASSWORD_LENGTH))).toBeNull(); });
});
```

Add to `src/__tests__/LoginScreen.test.tsx` (extend its existing `firebase/auth` mock with `signInWithPopup`, `GoogleAuthProvider: vi.fn()`, `createUserWithEmailAndPassword`, `sendEmailVerification`):

```tsx
it('"כניסה עם Google" calls signInWithPopup', async () => {
  render(<LoginScreen />);
  await userEvent.click(screen.getByRole('button', { name: 'כניסה עם Google' }));
  expect(mockSignInWithPopup).toHaveBeenCalled();
});
it('signup creates the account and sends a verification email', async () => {
  mockCreateUser.mockResolvedValue({ user: { uid: 'u' } });
  render(<LoginScreen />);
  await userEvent.click(screen.getByRole('button', { name: 'אין לך חשבון? הרשמה' }));
  await userEvent.type(screen.getByLabelText('אימייל'), 'g@gmail.com');
  await userEvent.type(screen.getByLabelText('סיסמה'), '1234567890');
  await userEvent.type(screen.getByLabelText('אימות סיסמה'), '1234567890');
  await userEvent.click(screen.getByRole('button', { name: 'הרשמה' }));
  expect(mockCreateUser).toHaveBeenCalledWith(expect.anything(), 'g@gmail.com', '1234567890');
  expect(mockSendVerification).toHaveBeenCalledWith({ uid: 'u' });
});
it('signup with a 9-char password never calls Firebase', async () => {
  render(<LoginScreen />);
  await userEvent.click(screen.getByRole('button', { name: 'אין לך חשבון? הרשמה' }));
  await userEvent.type(screen.getByLabelText('אימייל'), 'g@gmail.com');
  await userEvent.type(screen.getByLabelText('סיסמה'), '123456789');
  await userEvent.type(screen.getByLabelText('אימות סיסמה'), '123456789');
  await userEvent.click(screen.getByRole('button', { name: 'הרשמה' }));
  expect(mockCreateUser).not.toHaveBeenCalled();
});
```

(If the existing inputs are not labelled `אימייל` / `סיסמה`, keep their labels and use them in the new tests.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`src/utils/signupValidation.ts`:

```ts
export const MIN_PASSWORD_LENGTH = 10;

export function validateSignup(email: string, password: string, confirm: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'כתובת האימייל אינה תקינה.';
  if (password.length < MIN_PASSWORD_LENGTH) return `הסיסמה צריכה להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`;
  if (password !== confirm) return 'הסיסמאות אינן תואמות.';
  return null;
}
```

`LoginScreen.tsx`: add `mode: 'signin' | 'signup'` state and `confirm` state. Above the form fields add the Google button; below the submit add the mode toggle. Handlers:

```tsx
import { createUserWithEmailAndPassword, GoogleAuthProvider, sendEmailVerification, signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { validateSignup } from '../utils/signupValidation';

const ERROR_MESSAGES additions:
  'auth/email-already-in-use': 'כבר קיים חשבון עם האימייל הזה — היכנס במקום להירשם.',
  'auth/popup-closed-by-user': 'חלון ההתחברות נסגר לפני שהסתיים.',
  'auth/popup-blocked': 'הדפדפן חסם את חלון ההתחברות. אפשר חלונות קופצים ונסה שוב.',

const handleGoogle = async () => {
  if (isSubmitting) return;
  setIsSubmitting(true); setError(null);
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (err) { setError(ERROR_MESSAGES[(err as { code?: string })?.code ?? ''] ?? GENERIC_ERROR); }
  finally { setIsSubmitting(false); }
};

// inside handleSubmit, before the sign-in call:
if (mode === 'signup') {
  const invalid = validateSignup(email, password, confirm);
  if (invalid) { setError(invalid); setIsSubmitting(false); return; }
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await sendEmailVerification(cred.user);
  return; // App shows UnassignedScreen (unverified branch) via useAuthSession
}
```

Google button: `<button type="button" onClick={handleGoogle}>כניסה עם Google</button>` styled as a secondary full-width button; toggle text `אין לך חשבון? הרשמה` / `כבר יש לך חשבון? כניסה`; submit label `התחבר` / `הרשמה`; in signup mode show a third `<input type="password" aria-label="אימות סיסמה">`. The early-return in `handleSubmit` must still reach `finally { setIsSubmitting(false) }` — put the signup branch inside the existing `try`.

- [ ] **Step 4: Run** — `npx vitest run src/__tests__/signupValidation.test.ts src/__tests__/LoginScreen.test.tsx` → PASS; `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/signupValidation.ts src/components/LoginScreen.tsx src/__tests__
git commit -m "feat(auth): Google sign-in and invited self-signup with email verification (≥10-char password)"
```

---

### Task 8: AI features off in production builds

Deviation from spec §1 wording, on purpose: the spec names a `VITE_AI_ENABLED` env flag; this plan derives it from `!import.meta.env.PROD` instead — a production build *is* the cloud (live mode runs the dev server), so there is no knob to forget and no new env name to pin.

**Files:**
- Create: `src/config/aiAvailability.ts`
- Create: `src/__tests__/aiAvailability.test.tsx`
- Modify: `src/services/aiClient.ts` (guard each of the 6 exported callables)
- Modify: `src/App.tsx:206` (`ai-settings` tab), `src/App.tsx:287` (`folder` case), `src/App.tsx:389` (`<SyncButton />`)
- Modify: `src/components/InvestmentsPortfolio.tsx:141-147` ("ייבא מ-Drive" button)
- Modify: `src/components/AssetCard.tsx` (the extraction trigger that calls `extractForReview`)
- Modify: `src/components/Dashboard.tsx` (the AI chat panel — the block containing `<ModelPicker action="chat"` ~line 1189 through the chat input)

**Interfaces:**
- Produces: `AI_ENABLED: boolean`; `AI_UNAVAILABLE_MESSAGE: string`; `assertAiEnabled(): void` (throws `Error(AI_UNAVAILABLE_MESSAGE)`).

- [ ] **Step 1: Failing tests** — `src/__tests__/aiAvailability.test.tsx`

```tsx
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

describe('AI availability (spec C1 §1 — AI off in the cloud)', () => {
  it('is derived from the build mode, not from an env knob', () => {
    const src = readFileSync('src/config/aiAvailability.ts', 'utf8');
    expect(src).toMatch(/AI_ENABLED\s*(:\s*boolean)?\s*=\s*!import\.meta\.env\.PROD/);
  });

  it('every exported callable in aiClient refuses before touching the network when disabled', async () => {
    vi.resetModules();
    vi.doMock('../config/aiAvailability', async (orig) => ({ ...(await orig<object>()), AI_ENABLED: false }));
    const httpsCallable = vi.fn();
    vi.doMock('firebase/functions', () => ({ httpsCallable }));
    vi.doMock('../services/firebase', () => ({ functions: {} }));
    const ai = await import('../services/aiClient');
    for (const call of [
      () => ai.listAiModels(), () => ai.getAiUsageSummary(), () => ai.setAiCostCeiling(1),
      () => ai.sendChatMessage({} as never), () => ai.extractDocument({} as never), () => ai.requestAiOverageApproval({} as never),
    ]) {
      await expect(call()).rejects.toThrow(/AI/);
    }
    expect(httpsCallable).not.toHaveBeenCalled();
    vi.doUnmock('../config/aiAvailability');
  });

  it('source pin: every AI entry point is gated on AI_ENABLED', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(/AI_ENABLED[^\n]*'ai-settings'|'ai-settings'[^\n]*AI_ENABLED/);
    expect(app).toMatch(/AI_ENABLED\s*&&\s*<SyncButton/);
    expect(readFileSync('src/components/InvestmentsPortfolio.tsx', 'utf8')).toMatch(/AI_ENABLED\s*&&/);
    expect(readFileSync('src/components/AssetCard.tsx', 'utf8')).toMatch(/AI_ENABLED/);
    expect(readFileSync('src/components/Dashboard.tsx', 'utf8')).toMatch(/AI_ENABLED\s*\?|AI_ENABLED\s*&&/);
  });
});
```

Add one render test per gated component file that already has a test suite (`InvestmentsPortfolio`, `Dashboard`, `App`): with `vi.mock('../config/aiAvailability', () => ({ AI_ENABLED: false, AI_UNAVAILABLE_MESSAGE: 'x', assertAiEnabled: () => { throw new Error('x'); } }))`, assert the trigger is absent — e.g. `expect(screen.queryByText('ייבא מ-Drive')).toBeNull()`; in App, `expect(screen.queryByText('הגדרות AI')).toBeNull()` for a super-admin session; in Dashboard, `expect(document.querySelector('[data-tour-id="ai-chat-reset"]')).toBeNull()`. Put each in a new file `src/__tests__/<Component>.aiOff.test.tsx` so the module mock does not leak into the existing suites.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`src/config/aiAvailability.ts`:

```ts
// Spec C1 §1 (David, 15.10 — option "א"): AI features need the Cloud Functions that only the local
// emulator runs; the cloud is Spark (no Functions). A production build IS the cloud deploy — live
// mode runs the dev server — so the switch is the build mode itself. Turning AI back on in the
// cloud is a new cost decision, not a flag flip.
export const AI_ENABLED: boolean = !import.meta.env.PROD;

export const AI_UNAVAILABLE_MESSAGE = 'תכונות ה-AI זמינות רק במחשב של דויד (מצב מקומי), לא בגרסת הענן.';

export function assertAiEnabled(): void {
  if (!AI_ENABLED) throw new Error(AI_UNAVAILABLE_MESSAGE);
}
```

`aiClient.ts`: first line inside each of `listAiModels`, `requestAiOverageApproval`, `sendChatMessage`, `extractDocument`, `getAiUsageSummary`, `setAiCostCeiling`: `assertAiEnabled();` (import from `../config/aiAvailability`). The hooks that call these on mount (`useAiModels`, `useAiChat`) already turn a rejection into an error state — with the UI hidden, that state is never shown.

UI gates (import `AI_ENABLED`):
- `App.tsx:206` → `...(isSuperAdmin && AI_ENABLED ? [{ id: 'ai-settings' as const, … }] : [])`
- `App.tsx:287` → `case 'folder': return AI_ENABLED ? <FolderLogic /> : <AiUnavailableNotice />;` where `AiUnavailableNotice` is a 5-line local component rendering `AI_UNAVAILABLE_MESSAGE` in a slate card.
- `App.tsx:389` → `{AI_ENABLED && <SyncButton />}`
- `InvestmentsPortfolio.tsx` → wrap the "ייבא מ-Drive" `<button>` in `{AI_ENABLED && (…)}`; also render `<InvestmentsImportModal>` only when `AI_ENABLED`.
- `AssetCard.tsx` → wrap the control that starts extraction (the element whose handler calls `extractForReview`) in `{AI_ENABLED && (…)}`; also skip `useAiModels('extraction')`'s effect body when `!AI_ENABLED` (do **not** make the hook call conditional — hooks rule).
- `Dashboard.tsx` → render the chat panel container (from the `ModelPicker action="chat"` header through the chat input form) as `{AI_ENABLED ? (<…existing panel…>) : null}`. `useAiChat()` stays called unconditionally at the top.

- [ ] **Step 4: Run** — `npm test` → PASS; `npm run lint` → clean. If existing AI-surface source-grep tests (`AiExtractionSurfaces.*`, `clientAiPlumbing*`) now fail because a regex expected the old JSX shape, update the regex to tolerate the `AI_ENABLED &&` wrapper — never delete the assertion.

- [ ] **Step 5: Commit**

```bash
git add src/config/aiAvailability.ts src/services/aiClient.ts src/App.tsx src/components src/__tests__
git commit -m "feat(cloud): AI features off in production builds — no trigger rendered, no callable invoked"
```

---

### Task 9: App Check + CSP for the cloud

Deviation from spec §6.1, on purpose: no App Check **debug token** in the client. Dev runs against the emulator (App Check is not initialized there), and a debug-token env name would fail the secret-shape guard in `clientAiPlumbing.test.ts`. If dev-against-prod is ever needed, that is a new decision.

**Files:**
- Modify: `src/services/firebase.ts`
- Modify: `src/__tests__/helpers/clientEnvPin.ts` (pin `VITE_RECAPTCHA_SITE_KEY`)
- Modify: `firebase.json` (CSP)
- Modify: `src/__tests__/hostingCsp.test.ts`
- Create: `src/__tests__/appCheckInit.test.ts`

**Interfaces:**
- Produces: App Check initialized iff `!usingEmulator && VITE_RECAPTCHA_SITE_KEY` is non-empty; `export const APP_CHECK_ACTIVE: boolean` from `firebase.ts`.

- [ ] **Step 1: Failing tests**

`src/__tests__/hostingCsp.test.ts` — add a `readDirective(name)` helper generalizing `readConnectSrc`, then:

```ts
describe('CSP allows Google sign-in and App Check reCAPTCHA (spec C1 §4.1, §6.1)', () => {
  const firebaserc = JSON.parse(readFileSync(join(process.cwd(), '.firebaserc'), 'utf8')) as { projects: { default: string } };
  it('script-src: gapi (auth popup) + reCAPTCHA', () => {
    const s = readDirective('script-src');
    for (const o of ['https://apis.google.com', 'https://www.google.com', 'https://www.gstatic.com']) expect(s).toContain(o);
  });
  it('frame-src: the project authDomain + reCAPTCHA, kept in sync with .firebaserc', () => {
    const f = readDirective('frame-src');
    expect(f).toContain(`https://${firebaserc.projects.default}.firebaseapp.com`);
    expect(f).toContain('https://www.google.com');
    expect(f).toContain('https://recaptcha.google.com');
  });
  it('connect-src still covers App Check token exchange (*.googleapis.com)', () => {
    expect(readDirective('connect-src')).toContain('https://*.googleapis.com');
  });
});
```

`src/__tests__/appCheckInit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('App Check init (spec C1 §6.1)', () => {
  const src = readFileSync('src/services/firebase.ts', 'utf8');
  it('initializes App Check with reCAPTCHA v3 before Firestore', () => {
    expect(src).toMatch(/initializeAppCheck\(app,\s*\{\s*provider:\s*new ReCaptchaV3Provider/);
    expect(src.indexOf('initializeAppCheck(')).toBeLessThan(src.indexOf('initializeFirestore('));
  });
  it('never against the emulator, never without a site key', () => {
    expect(src).toMatch(/if\s*\(\s*!usingEmulator\s*&&\s*recaptchaSiteKey\s*\)/);
  });
  it('has no debug-token path', () => {
    expect(src).not.toMatch(/DEBUG_TOKEN/);
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`firebase.ts` (after `const app = initializeApp(firebaseConfig);`, before `initializeFirestore`):

```ts
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

const usingEmulator = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === '1';
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

// Spec C1 §6.1 — App Check (reCAPTCHA v3, free) gates Firestore in the cloud. Not on the emulator
// (nothing to attest, and the emulator does not enforce). No site key = no App Check, visibly:
// enforcement in the console is switched on only after Task 15 shows verified requests.
if (!usingEmulator && recaptchaSiteKey) {
  initializeAppCheck(app, { provider: new ReCaptchaV3Provider(recaptchaSiteKey), isTokenAutoRefreshEnabled: true });
}
export const APP_CHECK_ACTIVE = !usingEmulator && Boolean(recaptchaSiteKey);
```

and change the emulator `if` to `if (usingEmulator) { … }`.

`clientEnvPin.ts` — add:

```ts
  {
    name: 'VITE_RECAPTCHA_SITE_KEY',
    whyPublic:
      'a reCAPTCHA v3 SITE key — embedded in every page that uses reCAPTCHA by design; the matching ' +
      'secret lives only in the Firebase App Check console, never in this repo or bundle.',
  },
```

`firebase.json` CSP value:

```
default-src 'self'; script-src 'self' https://apis.google.com https://www.google.com https://www.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://firestore.googleapis.com https://upload.googleapis.com https://accounts.google.com https://*.cloudfunctions.net https://*.a.run.app; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; frame-src https://accounts.google.com https://family-finance-app-c9aa4.firebaseapp.com https://www.google.com https://recaptcha.google.com;
```

- [ ] **Step 4: Run** — `npm test` → PASS (incl. `hostingCsp`, `clientAiPlumbing`, env-pin tests); `npm run test:build` → PASS (`bundleEnvLeak`).

- [ ] **Step 5: `VITE_GEMINI_API_KEY` leaves `.env` (spec §6.1).** `.env` is David's local, git-ignored file in the main checkout — **ask David first**, then:

```bash
grep -c '^VITE_GEMINI_API_KEY=' /Users/aniccaidavid/Documents/Family-Finance-App/.env
sed -i '' '/^VITE_GEMINI_API_KEY=/d' /Users/aniccaidavid/Documents/Family-Finance-App/.env
```

Expected: `1` then no output; `grep -rn VITE_GEMINI_API_KEY src` → no hits (already true today; the Functions read their key from the emulator env, not `.env`).

- [ ] **Step 6: Commit**

```bash
git add src/services/firebase.ts src/__tests__ firebase.json
git commit -m "feat(cloud): App Check (reCAPTCHA v3) outside the emulator; CSP for Google sign-in + reCAPTCHA"
```

---

### Task 10: Cloud operator scripts — owner bootstrap, invite, revoke

**Files:**
- Create: `scripts/cloud/adminApp.ts`
- Create: `scripts/cloud/accessAdminPlan.ts`
- Create: `scripts/cloud/bootstrap-owner.ts`
- Create: `scripts/cloud/access-admin.ts`
- Create: `src/__tests__/cloudAdminApp.test.ts`
- Create: `src/__tests__/accessAdminPlan.test.ts`

**Interfaces:**
- Consumes: `FAMILY`, `MODULES` (`scripts/live/family.ts`, Task 4); invite/access contract (Task 3).
- Produces:
  - `CLOUD_PROJECT_ID = 'family-finance-app-c9aa4'`
  - `type Target = { kind: 'cloud' } | { kind: 'emulator'; projectId: string }`
  - `resolveTarget(argv: string[], env: Record<string, string | undefined>): Target`
  - `openFirestore(target: Target): Firestore`, `openAuth(target: Target): Auth`
  - `flagValue(argv: string[], name: string): string | undefined`
  - `planOwnerBootstrap(input: { superAdminCount: number; existingMemberIds: string[] }): { ok: true; membersToCreate: string[] } | { ok: false; reason: string }`
  - `buildInvite(input: { email: string; memberId: string; role: string; days: number; createdBy: string; now: Date; memberExists: boolean; existing: { usedBy?: string; expiresAtMs: number } | null }): { ok: true; id: string; doc: InviteDraft } | { ok: false; reason: string }` where `InviteDraft = { email: string; memberId: string; role: 'super-admin'|'parent'|'member'; createdBy: string; createdAtMs: number; expiresAtMs: number }`
  - `planRevoke(uid: string, all: Array<{ uid: string; role: string }>): { ok: true } | { ok: false; reason: string }`

- [ ] **Step 1: Failing tests**

`src/__tests__/cloudAdminApp.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveTarget } from '../../scripts/cloud/adminApp';

describe('resolveTarget — a cloud script can never be pointed at the wrong DB by accident', () => {
  it('no emulator env, no flag → cloud', () => { expect(resolveTarget([], {})).toEqual({ kind: 'cloud' }); });
  it('emulator env without --emulator → refuse (never silently write the emulator thinking it is prod, or vice versa)', () => {
    expect(() => resolveTarget([], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180' })).toThrow(/--emulator/);
  });
  it('--emulator on :8080 → refuse (live mode)', () => {
    expect(() => resolveTarget(['--emulator'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toThrow(/LIVE/);
  });
  it('--emulator needs a demo- project', () => {
    expect(() => resolveTarget(['--emulator', '--project', 'family-finance-app-c9aa4'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180' })).toThrow(/demo-/);
    expect(resolveTarget(['--emulator', '--project', 'demo-restore'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180' }))
      .toEqual({ kind: 'emulator', projectId: 'demo-restore' });
  });
});
```

`src/__tests__/accessAdminPlan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildInvite, planOwnerBootstrap, planRevoke } from '../../scripts/cloud/accessAdminPlan';

const now = new Date('2026-10-20T10:00:00Z');
const base = { email: 'Guest@Gmail.com', memberId: 'omer-levy', role: 'member', days: 14, createdBy: 'david-levy', now, memberExists: true, existing: null };

describe('planOwnerBootstrap', () => {
  it('refuses when a super-admin already exists', () => {
    expect(planOwnerBootstrap({ superAdminCount: 1, existingMemberIds: [] })).toMatchObject({ ok: false });
  });
  it('creates only the family members that are missing', () => {
    expect(planOwnerBootstrap({ superAdminCount: 0, existingMemberIds: ['david-levy'] }))
      .toEqual({ ok: true, membersToCreate: ['lilit-levy', 'omer-levy', 'shaked-levy', 'lior-levy'] });
  });
});

describe('buildInvite', () => {
  it('lower-cases the id and email, 14-day expiry', () => {
    const r = buildInvite(base);
    expect(r).toMatchObject({ ok: true, id: 'guest@gmail.com', doc: { email: 'guest@gmail.com', role: 'member', expiresAtMs: now.getTime() + 14 * 864e5 } });
  });
  it('refuses an unknown member, an unknown role, a live unused invite', () => {
    expect(buildInvite({ ...base, memberExists: false })).toMatchObject({ ok: false });
    expect(buildInvite({ ...base, role: 'owner' })).toMatchObject({ ok: false });
    expect(buildInvite({ ...base, existing: { expiresAtMs: now.getTime() + 1 } })).toMatchObject({ ok: false });
  });
  it('allows re-inviting after the old invite expired or was used', () => {
    expect(buildInvite({ ...base, existing: { expiresAtMs: now.getTime() - 1 } })).toMatchObject({ ok: true });
    expect(buildInvite({ ...base, existing: { usedBy: 'u', expiresAtMs: now.getTime() + 1 } })).toMatchObject({ ok: true });
  });
});

describe('planRevoke', () => {
  it('refuses to revoke the last super-admin', () => {
    expect(planRevoke('u1', [{ uid: 'u1', role: 'super-admin' }, { uid: 'u2', role: 'parent' }])).toMatchObject({ ok: false });
  });
  it('refuses an unknown uid', () => { expect(planRevoke('nope', [{ uid: 'u1', role: 'super-admin' }])).toMatchObject({ ok: false }); });
  it('allows revoking a member', () => { expect(planRevoke('u2', [{ uid: 'u1', role: 'super-admin' }, { uid: 'u2', role: 'member' }])).toEqual({ ok: true }); });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`scripts/cloud/adminApp.ts`:

```ts
// Spec C1 §4.5/§6.2 — the one way an operator script opens Firestore/Auth. Cloud = Admin SDK with
// David's ADC (`gcloud auth application-default login`; no key file on disk). Emulator only with
// an explicit --emulator AND a demo- project, and never live mode's :8080.
import { applicationDefault, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

export const CLOUD_PROJECT_ID = 'family-finance-app-c9aa4';
export type Target = { kind: 'cloud' } | { kind: 'emulator'; projectId: string };

export function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function resolveTarget(argv: string[], env: Record<string, string | undefined>): Target {
  const emu = env.FIRESTORE_EMULATOR_HOST;
  if (!argv.includes('--emulator')) {
    if (emu) throw new Error('FIRESTORE_EMULATOR_HOST is set but --emulator was not given — refusing. Unset it for a cloud run.');
    return { kind: 'cloud' };
  }
  if (!emu) throw new Error('--emulator given but FIRESTORE_EMULATOR_HOST is not set.');
  if (emu.endsWith(':8080')) throw new Error('refusing: :8080 is LIVE mode (the family\'s real data). Use the test emulator (:8180).');
  const projectId = flagValue(argv, '--project') ?? 'demo-familyfinance-restore';
  if (!projectId.startsWith('demo-')) throw new Error(`--emulator needs a demo- project id, got "${projectId}".`);
  return { kind: 'emulator', projectId };
}

let app: App | null = null;
function adminApp(target: Target): App {
  app ??= target.kind === 'cloud'
    ? initializeApp({ credential: applicationDefault(), projectId: CLOUD_PROJECT_ID }, 'c1-cloud')
    : initializeApp({ projectId: target.projectId }, 'c1-emulator');
  return app;
}
export const openFirestore = (t: Target): Firestore => getFirestore(adminApp(t));
export const openAuth = (t: Target): Auth => getAuth(adminApp(t));
```

`scripts/cloud/accessAdminPlan.ts`:

```ts
import { FAMILY } from '../live/family';

const ROLES = ['super-admin', 'parent', 'member'] as const;
type Role = (typeof ROLES)[number];
const DAY_MS = 24 * 60 * 60 * 1000;

export function planOwnerBootstrap(input: { superAdminCount: number; existingMemberIds: string[] }):
  { ok: true; membersToCreate: string[] } | { ok: false; reason: string } {
  if (input.superAdminCount > 0) return { ok: false, reason: 'a super-admin already exists — bootstrap runs once.' };
  const have = new Set(input.existingMemberIds);
  return { ok: true, membersToCreate: FAMILY.map((m) => m.memberId).filter((id) => !have.has(id)) };
}

export interface InviteDraft { email: string; memberId: string; role: Role; createdBy: string; createdAtMs: number; expiresAtMs: number }

export function buildInvite(input: {
  email: string; memberId: string; role: string; days: number; createdBy: string; now: Date;
  memberExists: boolean; existing: { usedBy?: string; expiresAtMs: number } | null;
}): { ok: true; id: string; doc: InviteDraft } | { ok: false; reason: string } {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: `invalid email "${input.email}"` };
  if (!(ROLES as readonly string[]).includes(input.role)) return { ok: false, reason: `unknown role "${input.role}"` };
  if (!input.memberExists) return { ok: false, reason: `members/${input.memberId} does not exist` };
  const now = input.now.getTime();
  if (input.existing && !input.existing.usedBy && input.existing.expiresAtMs > now) {
    return { ok: false, reason: `an unused invite for ${email} is still valid — revoke/delete it first` };
  }
  return { ok: true, id: email, doc: {
    email, memberId: input.memberId, role: input.role as Role, createdBy: input.createdBy,
    createdAtMs: now, expiresAtMs: now + input.days * DAY_MS,
  } };
}

export function planRevoke(uid: string, all: Array<{ uid: string; role: string }>): { ok: true } | { ok: false; reason: string } {
  const target = all.find((a) => a.uid === uid);
  if (!target) return { ok: false, reason: `access/${uid} does not exist` };
  if (target.role === 'super-admin' && all.filter((a) => a.role === 'super-admin').length === 1) {
    return { ok: false, reason: 'refusing to revoke the last super-admin' };
  }
  return { ok: true };
}
```

`scripts/cloud/bootstrap-owner.ts` (dry run by default; `--apply` writes):

```ts
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
import { FAMILY, MODULES } from '../live/family';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const email = flagValue(argv, '--email');
  if (!email) throw new Error('--email <david\'s google email> is required');
  const target = resolveTarget(argv, process.env);
  const db = openFirestore(target);
  const user = await openAuth(target).getUserByEmail(email);
  const supers = await db.collection('access').where('role', '==', 'super-admin').get();
  const members = await db.collection('members').get();
  const plan = planOwnerBootstrap({ superAdminCount: supers.size, existingMemberIds: members.docs.map((d) => d.id) });
  if (!plan.ok) throw new Error(plan.reason);
  console.log(`target: ${target.kind}  uid: ${user.uid}  members to create: ${plan.membersToCreate.join(', ') || '(none)'}`);
  if (!argv.includes('--apply')) { console.log('dry run — re-run with --apply.'); return; }
  const now = new Date().toISOString();
  const batch = db.batch();
  for (const m of FAMILY.filter((f) => plan.membersToCreate.includes(f.memberId))) {
    batch.set(db.doc(`members/${m.memberId}`), { id: m.memberId, name: m.nameHe, role: m.memberRoleHe, color: m.color, createdAt: now, updatedAt: now });
    const level = m.role === 'member' ? 'none' : 'family';
    batch.set(db.doc(`permissions/member__${m.memberId}`), {
      id: `member__${m.memberId}`, scope: 'member', targetId: m.memberId, updatedAt: now, updatedBy: 'david-levy',
      modules: Object.fromEntries(MODULES.map((mod) => [mod, { view: 'family', edit: level }])),
    });
  }
  batch.set(db.doc(`access/${user.uid}`), {
    uid: user.uid, memberId: 'david-levy', role: 'super-admin', email: email.toLowerCase(),
    grantedAt: Timestamp.now(), grantedVia: 'bootstrap',
  });
  batch.set(db.collection('audit_log').doc(), { actorMemberId: 'david-levy', action: 'access.bootstrap', target: `access/${user.uid}`, at: now });
  await batch.commit();
  console.log('bootstrap-owner: done.');
}

main().catch((err: unknown) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
```

`scripts/cloud/access-admin.ts` — subcommands `list`, `invite --email E --member M --role R [--days 14]`, `revoke --uid U`; writes only with `--apply`; every write batch also adds an `audit_log` doc `{ actorMemberId: 'david-levy', action: 'invite.create' | 'access.revoke', target: 'invites/<id>' | 'access/<uid>', at: ISO }`:

```ts
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
  const at = new Date().toISOString();

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
    if (!r.ok) throw new Error(r.reason);
    console.log(`invite ${r.id} → ${r.doc.memberId} as ${r.doc.role}, expires ${new Date(r.doc.expiresAtMs).toISOString()}`);
    if (!apply) { console.log('dry run — re-run with --apply.'); return; }
    const batch = db.batch();
    batch.set(db.doc(`invites/${r.id}`), {
      email: r.doc.email, memberId: r.doc.memberId, role: r.doc.role, createdBy: r.doc.createdBy,
      createdAt: Timestamp.fromMillis(r.doc.createdAtMs), expiresAt: Timestamp.fromMillis(r.doc.expiresAtMs),
    });
    batch.set(db.collection('audit_log').doc(), { actorMemberId: 'david-levy', action: 'invite.create', target: `invites/${r.id}`, at });
    await batch.commit();
    console.log('invite: done.');
    return;
  }
  if (cmd === 'revoke') {
    const uid = flagValue(argv, '--uid') ?? '';
    const all = (await db.collection('access').get()).docs.map((d) => ({ uid: d.id, role: String(d.get('role')) }));
    const r = planRevoke(uid, all);
    if (!r.ok) throw new Error(r.reason);
    console.log(`revoke access/${uid}`);
    if (!apply) { console.log('dry run — re-run with --apply.'); return; }
    const batch = db.batch();
    batch.delete(db.doc(`access/${uid}`));
    batch.set(db.collection('audit_log').doc(), { actorMemberId: 'david-levy', action: 'access.revoke', target: `access/${uid}`, at });
    await batch.commit();
    console.log('revoke: done.');
    return;
  }
  throw new Error('usage: access-admin.ts list | invite --email E --member M --role R [--days N] [--apply] | revoke --uid U [--apply]');
}

main().catch((err: unknown) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
```

- [ ] **Step 4: Run** — `npx vitest run src/__tests__/cloudAdminApp.test.ts src/__tests__/accessAdminPlan.test.ts` → PASS; `npm run lint` → clean.

- [ ] **Step 5: Smoke against the test emulator (never cloud, never :8080):**

```bash
npx firebase --config firebase.rules-test.json emulators:exec --project demo-c1-smoke --only firestore,auth \
  "FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199 npx tsx scripts/cloud/smoke-access-admin.ts"
```

where `scripts/cloud/smoke-access-admin.ts` (create it, commit it) creates an auth user `owner@test.local` via `openAuth({kind:'emulator', projectId:'demo-c1-smoke'}).createUser(...)`, then spawns (via `execFileSync('npx', ['tsx', …])`, env inherited, args `--emulator --project demo-c1-smoke`): `bootstrap-owner --email owner@test.local --apply` (expect exit 0), the same again (expect non-zero: "already exists"), `access-admin invite --email G@x.co --member omer-levy --role member --apply` (exit 0), `access-admin list` (output contains `invite  g@x.co`), `access-admin revoke --uid <owner uid> --apply` (non-zero: "last super-admin"). It throws on any mismatch and prints `smoke: ok`.

- [ ] **Step 6: Commit**

```bash
git add scripts/cloud src/__tests__/cloudAdminApp.test.ts src/__tests__/accessAdminPlan.test.ts
git commit -m "feat(cloud): operator scripts — owner bootstrap, invite, revoke (ADC, dry-run by default, audited)"
```

---

### Task 11: Cloud → Mac backup and restore

**Files:**
- Create: `scripts/cloud/backupCodec.ts`, `scripts/cloud/backupPlan.ts`, `scripts/cloud/snapshot.ts`
- Create: `scripts/cloud/backup-prod.ts`, `scripts/cloud/restore-prod.ts`
- Create: `src/__tests__/backupCodec.test.ts`, `src/__tests__/backupPlan.test.ts`, `src/__tests__/backupCoverage.test.ts`
- Create: `firestore-tests/cloud-backup-roundtrip.emulator.test.ts`
- Modify: `scripts/live/sync-and-start.sh` (step 0b)

**Interfaces:**
- Consumes: `resolveTarget`, `openFirestore`, `flagValue` (Task 10).
- Produces:
  - `encodeValue(v: unknown): unknown` / `decodeValue(v: unknown): unknown` — lossless for `Timestamp`, `GeoPoint`, `DocumentReference` (by path), `Buffer`/bytes, nested maps/arrays.
  - `interface Snapshot { version: 1; source: string; takenAt: string; docs: Array<{ path: string; data: Record<string, unknown> }> }`
  - `NESTED_COLLECTION_GROUPS: readonly string[] = ['sessions']`
  - `collectSnapshot(db: Firestore, source: string): Promise<Snapshot>`
  - `applySnapshot(db: Firestore, snap: Snapshot, opts: { apply: boolean }): Promise<{ docs: number; byCollection: Record<string, number> }>`
  - `backupFileName(d: Date): string` → `cloud-YYYYMMDD.json` (local date); `shouldSkipToday(files: string[], d: Date): boolean`; `filesToPrune(files: string[], keep = 30): string[]`; `MAX_RESTORE_DOCS = 18000`.

- [ ] **Step 1: Failing unit tests**

`src/__tests__/backupPlan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { backupFileName, filesToPrune, shouldSkipToday } from '../../scripts/cloud/backupPlan';

const d = new Date(2026, 9, 15, 9, 0); // local time
describe('backup plan (spec §6.2 — at most once a day, keep 30)', () => {
  it('names the file by local date', () => { expect(backupFileName(d)).toBe('cloud-20261015.json'); });
  it('skips when today\'s file exists', () => {
    expect(shouldSkipToday(['cloud-20261014.json', 'cloud-20261015.json'], d)).toBe(true);
    expect(shouldSkipToday(['cloud-20261014.json', 'live-db-20261015-090000'], d)).toBe(false);
  });
  it('prunes the oldest beyond 30, ignoring non-cloud files', () => {
    const files = Array.from({ length: 32 }, (_, i) => `cloud-202609${String(i + 1).padStart(2, '0')}.json`).concat(['live-db-x']);
    expect(filesToPrune(files)).toEqual(['cloud-20260901.json', 'cloud-20260902.json']);
  });
});
```

`src/__tests__/backupCodec.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { decodeValue, encodeValue } from '../../scripts/cloud/backupCodec';

describe('backup codec — JSON round trip is lossless', () => {
  it('Timestamp keeps nanoseconds', () => {
    const t = new Timestamp(1760000000, 123456789);
    const back = decodeValue(JSON.parse(JSON.stringify(encodeValue({ t })))) as { t: Timestamp };
    expect(back.t).toBeInstanceOf(Timestamp);
    expect(back.t.isEqual(t)).toBe(true);
  });
  it('GeoPoint, bytes, nested maps and arrays', () => {
    const v = { g: new GeoPoint(32.1, 34.8), b: Buffer.from([1, 2, 255]), n: { a: [1, 'x', null, { deep: true }] }, s: '₪' };
    const back = decodeValue(JSON.parse(JSON.stringify(encodeValue(v)))) as typeof v;
    expect(back.g.isEqual(v.g)).toBe(true);
    expect(Buffer.compare(back.b, v.b)).toBe(0);
    expect(back.n).toEqual(v.n);
    expect(back.s).toBe('₪');
  });
  it('a user map that happens to have a __type key survives', () => {
    const v = { m: { __type: 'timestamp', note: 'user data' } };
    expect(decodeValue(JSON.parse(JSON.stringify(encodeValue(v))))).toEqual(v);
  });
});
```

(`DocumentReference` encoding is covered by the emulator round trip in Step 4, which needs a live `Firestore` to rebuild refs.)

`src/__tests__/backupCoverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { NESTED_COLLECTION_GROUPS } from '../../scripts/cloud/snapshot';

describe('backup covers every nested collection the rules know about', () => {
  it('each `match /a/{x}/b/{y}` in firestore.rules has b in NESTED_COLLECTION_GROUPS', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    const nested = [...rules.matchAll(/match \/[a-z_]+\/\{[^}]+\}\/([a-z_]+)\/\{/g)].map((m) => m[1]);
    expect(nested.length).toBeGreaterThan(0);
    for (const name of nested) expect(NESTED_COLLECTION_GROUPS).toContain(name);
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`scripts/cloud/backupCodec.ts`:

```ts
// Lossless JSON for Firestore values. Every non-JSON value becomes { "__ff": <kind>, ... }, and a
// USER map is wrapped as { "__ff": "map", v: {...} } only when it already has an "__ff" key — so
// user data can never be mistaken for an encoded value.
import { DocumentReference, GeoPoint, Timestamp, type Firestore } from 'firebase-admin/firestore';

const TAG = '__ff';

export function encodeValue(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Timestamp) return { [TAG]: 'ts', s: v.seconds, n: v.nanoseconds };
  if (v instanceof GeoPoint) return { [TAG]: 'geo', lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return { [TAG]: 'ref', path: v.path };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { [TAG]: 'bytes', b64: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(encodeValue);
  const out = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, encodeValue(x)]));
  return TAG in out ? { [TAG]: 'map', v: out } : out;
}

export function decodeValue(v: unknown, db?: Firestore): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, db));
  const o = v as Record<string, unknown>;
  switch (o[TAG]) {
    case 'ts': return new Timestamp(o.s as number, o.n as number);
    case 'geo': return new GeoPoint(o.lat as number, o.lng as number);
    case 'bytes': return Buffer.from(o.b64 as string, 'base64');
    case 'ref':
      if (!db) throw new Error(`decoding a reference (${String(o.path)}) needs a Firestore instance`);
      return db.doc(o.path as string);
    case 'map': return Object.fromEntries(Object.entries(o.v as Record<string, unknown>).map(([k, x]) => [k, decodeValue(x, db)]));
    default: return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decodeValue(x, db)]));
  }
}
```

`scripts/cloud/backupPlan.ts`:

```ts
export const KEEP_BACKUPS = 30;
export const MAX_RESTORE_DOCS = 18000; // Spark: 20K writes/day — leave headroom for the app itself

const pad = (n: number) => String(n).padStart(2, '0');
export const backupFileName = (d: Date): string => `cloud-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
export const shouldSkipToday = (files: string[], d: Date): boolean => files.includes(backupFileName(d));
export function filesToPrune(files: string[], keep = KEEP_BACKUPS): string[] {
  const cloud = files.filter((f) => /^cloud-\d{8}\.json$/.test(f)).sort();
  return cloud.slice(0, Math.max(0, cloud.length - keep));
}
```

`scripts/cloud/snapshot.ts`:

```ts
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
```

`scripts/cloud/backup-prod.ts`:

```ts
// Spec C1 §6.2 — reads the whole cloud DB (Admin SDK + ADC) into
// family-data/backups/cloud-YYYYMMDD.json. At most once a day (Spark: 50K reads/day); keeps 30.
//   npx tsx scripts/cloud/backup-prod.ts [--out-dir <dir>] [--emulator --project demo-…]
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  writeFileSync(`${file}.tmp`, JSON.stringify(snap));
  rmSync(file, { force: true });
  writeFileSync(file, JSON.stringify(snap)); // write-then-name: a crash never leaves a half file under today's name
  rmSync(`${file}.tmp`, { force: true });
  for (const old of filesToPrune(readdirSync(dir))) rmSync(join(dir, old));
  console.log(`backup: ${snap.docs.length} docs → ${file}`);
}

main().catch((err: unknown) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
```

`scripts/cloud/restore-prod.ts`:

```ts
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
```

- [ ] **Step 4: Emulator round-trip test** — `firestore-tests/cloud-backup-roundtrip.emulator.test.ts` (runs under `npm run test:rules`, i.e. on :8180):

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { testFirestoreHost } from './tools/emulatorHost';
import { applySnapshot, collectSnapshot } from '../scripts/cloud/snapshot';

testFirestoreHost(); // refuses :8080 / unset before anything connects
const src: App = initializeApp({ projectId: 'demo-c1-backup-src' }, 'c1-backup-src');
const dst: App = initializeApp({ projectId: 'demo-c1-backup-dst' }, 'c1-backup-dst');
afterAll(async () => { await deleteApp(src); await deleteApp(dst); });

describe('backup → restore round trip (spec §6.2, DoD #4)', () => {
  it('restores every doc, nested ones included, value-for-value', async () => {
    const a = getFirestore(src);
    await a.doc('members/omer-levy').set({ name: 'עומר', at: new Timestamp(1760000000, 5), geo: new GeoPoint(1, 2) });
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
    expect((om.at as Timestamp).isEqual(new Timestamp(1760000000, 5))).toBe(true);
    expect((await b.doc('chat_sessions/omer-levy/sessions/s1').get()).get('text')).toBe('שלום');
  });
});
```

- [ ] **Step 5: Run** — `npx vitest run src/__tests__/backupCodec.test.ts src/__tests__/backupPlan.test.ts src/__tests__/backupCoverage.test.ts` → PASS; `npm run test:rules` → PASS (incl. round trip).

- [ ] **Step 6: Desktop button step 0b** — in `scripts/live/sync-and-start.sh`, right after the step-0 fast-forward block (the one ending near line 51's `say "עודכן לגרסה האחרונה…"`):

```zsh
# ── 0b. Cloud → Mac backup (spec C1 §6.2). Once a day; skipped until ADC exists. Never blocks
#        live mode — but a failure is said out loud, not swallowed.
ADC_FILE="$HOME/.config/gcloud/application_default_credentials.json"
if [ -f "$ADC_FILE" ]; then
  mkdir -p "$APP_DIR/family-data/logs"
  if ! (cd "$APP_DIR" && npx tsx scripts/cloud/backup-prod.ts >> "$APP_DIR/family-data/logs/cloud-backup.log" 2>&1); then
    say "⚠️ גיבוי הענן נכשל — פרטים ב-family-data/logs/cloud-backup.log. המערכת המקומית נפתחת כרגיל."
  fi
fi
```

Check with `zsh -n scripts/live/sync-and-start.sh` → no output.

- [ ] **Step 7: Commit**

```bash
git add scripts/cloud scripts/live/sync-and-start.sh src/__tests__ firestore-tests/cloud-backup-roundtrip.emulator.test.ts
git commit -m "feat(cloud): lossless cloud→Mac backup (daily, keep 30) and dry-run-first restore; desktop button step 0b"
```

---

### Task 12: Branch review and merge to `main` — without locking out live mode

**Files:** none new.

- [ ] **Step 1: Full verification** — `npm run lint && npm test && npm run test:build && npm run test:rules` → all green. Paste the summary lines.
- [ ] **Step 2: Adversarial review (Yuri) of the rules diff + `start-live.sh` + `sync-and-start.sh`**, focused on: fail-open paths in the redemption rules, the ensure-access failure path, and the backup failure path. Fix findings before Step 3.
- [ ] **Step 3: Live-mode precondition (Review Focus 1) — needed for THIS merge only.** A live session started before this merge watches the tracked `firestore.rules` directly (the Task 4 snapshot applies from the next start on).

```bash
ls /Users/aniccaidavid/Documents/Family-Finance-App/family-data/logs/live.mode 2>/dev/null && echo LIVE-RUNNING || echo live-stopped
```

If `LIVE-RUNNING`: **do not merge.** Ask David to close live mode (Ctrl+C in its terminal — it exports on exit), **or** to approve running, against live, exactly:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npx tsx scripts/live/bootstrap-live.ts --ensure-access
```

(from the worktree — the script is additive and idempotent; it writes only `access/*`).

- [ ] **Step 4: Merge** via `superpowers:finishing-a-development-branch` (Nami's lens: fast-forward `main`, push only with David's yes).
- [ ] **Step 5: DoD #6 — live mode still works.** David presses the desktop icon (fast-forward → backup step 0b skips without ADC → start-live → ensure-access → browser). Read-only check, after he confirms it is up:

```bash
curl -s -H 'Authorization: Bearer owner' 'http://127.0.0.1:8080/v1/projects/family-finance-app-c9aa4/databases/(default)/documents/access?pageSize=50' | grep -c '"name"'
```

Expected: `5`. David logs in as himself and sees his data. Remind David: the demo ledger needs `npm run provision:auth` once.

---

## Phase B — Prod (HITL: David approves every single command)

### Task 13: One-time cloud setup (console + CLI, all free)

- [ ] **Step 1: Create the database** (only if Task 0 found none) — show, get yes, run:

```bash
npx firebase firestore:databases:create "(default)" --location me-west1 --project family-finance-app-c9aa4
```

- [ ] **Step 2: David, in the Firebase console** (`Authentication → Sign-in method`): enable **Google** and **Email/Password**; `Authentication → Settings → User actions`: **Email enumeration protection** on. Authorized domains already include `family-finance-app-c9aa4.web.app` / `.firebaseapp.com`.
- [ ] **Step 3: App Check key.** David creates a **reCAPTCHA v3** key (domains `family-finance-app-c9aa4.web.app`, `family-finance-app-c9aa4.firebaseapp.com`) and registers the web app in `App Check → Apps → reCAPTCHA` with its secret. **If any screen asks for billing or a Cloud project with billing → stop and ask David** (fallback: ship without App Check; rules + auth remain the boundary; record it). Do **not** enforce yet.
- [ ] **Step 4:** David adds `VITE_RECAPTCHA_SITE_KEY=<site key>` to `.env` in the main checkout.
- [ ] **Step 5: Drive OAuth origin — not needed in C1.** Every Drive surface (`SyncButton`, `InvestmentsImportModal`, `AssetCard`) is an AI-extraction surface and is hidden in the cloud (Task 8). Tell David this item from spec §9 drops out of C1.

### Task 14: Deploy rules, indexes, hosting

From the **main checkout** (it has `.env`), after Task 12's merge. Each command shown to David, run only on his yes, in this order:

- [ ] **Step 1: Build** — `npm run build`; then `grep -rl "localhost:8080\|127.0.0.1:8080" dist/assets | head` → no output (emulator wiring is dev-only); `npm run test:build` → PASS. Spec §6.1 key check on the exact bundle that will ship:

```bash
grep -rhoE 'AIza[0-9A-Za-z_-]{35}' dist | sort -u            # expect exactly one line …
grep '^VITE_FIREBASE_API_KEY=' .env | cut -d= -f2             # … equal to this public web key
grep -rlE 'sk-[A-Za-z0-9_-]{20,}' dist                        # expect no output
grep -rl 'ai-chat-reset' dist/assets                         # informational: dead-code elimination of the chat panel
```

Any extra `AIza…` value or any `sk-…` hit is a blocker — do not deploy. A hit on the last line is *not* a blocker (the Task 8 render tests are the guard; this only shows whether Rollup dropped the dead JSX) — note it in the handoff.
- [ ] **Step 2:** `npx firebase deploy --only firestore:rules --project family-finance-app-c9aa4`
- [ ] **Step 3:** `npx firebase deploy --only firestore:indexes --project family-finance-app-c9aa4`
- [ ] **Step 4:** `npx firebase deploy --only hosting --project family-finance-app-c9aa4`
- [ ] **Step 5: Tag** — `git tag deploy/c1-$(date +%Y%m%d) && git push origin deploy/c1-$(date +%Y%m%d)` (push on David's yes).

Rollback: Hosting → previous release in the console; Rules → previous ruleset in the console.

### Task 15: Bootstrap the owner and verify "done" (spec §8)

- [ ] **Step 1: DoD #1.** David opens `https://family-finance-app-c9aa4.web.app` on his phone, signs in with Google → sees "לא משויך" (expected: no access yet). Then (approval each):

```bash
npx tsx scripts/cloud/bootstrap-owner.ts --email <david's google email>
npx tsx scripts/cloud/bootstrap-owner.ts --email <david's google email> --apply
```

David reloads → the system, empty, as super-admin (the "הגדרות AI" tab is absent).
- [ ] **Step 2: DoD #4 — backup before any real data.** (approval) `npx tsx scripts/cloud/backup-prod.ts` → `family-data/backups/cloud-YYYYMMDD.json`. Restore it into the **test** emulator, never :8080:

```bash
npx firebase --config firebase.rules-test.json emulators:exec --project demo-c1-restore --only firestore \
  "npx tsx scripts/cloud/restore-prod.ts --from family-data/backups/cloud-$(date +%Y%m%d).json --emulator --project demo-c1-restore --apply && npx tsx scripts/cloud/backup-prod.ts --emulator --project demo-c1-restore --out-dir /private/tmp/claude-501/c1-restore-check"
```

Then compare: `diff <(jq -S '.docs' family-data/backups/cloud-$(date +%Y%m%d).json) <(jq -S '.docs' /private/tmp/claude-501/c1-restore-check/cloud-$(date +%Y%m%d).json)` → no output.
- [ ] **Step 3: DoD #2.** David gives the second Google account's email. (approval) `npx tsx scripts/cloud/access-admin.ts invite --email <second> --member omer-levy --role member --apply`. David sets Omer's permissions in "ניהול משפחה והרשאות" (e.g. expenses view `own`). The second account signs in → "יש לי הזמנה" → sees only what is allowed.
- [ ] **Step 4: DoD #3.** (approval) `npx tsx scripts/cloud/access-admin.ts list` → take the second account's uid → `… revoke --uid <uid> --apply`. The second account's open tab flips to "לא משויך" without a reload.
- [ ] **Step 5: DoD #5.** In the built-in browser on the deployed site: `read_console_messages` → 0 CSP violations; App Check console → requests "verified". Only then, with David's yes: **enforce App Check for Firestore** in the console, reload, confirm the app still loads.
- [ ] **Step 6: DoD #7.** (approval) `gcloud billing projects describe family-finance-app-c9aa4` → billing disabled; console shows **Spark**.
- [ ] **Step 7:** Write the handoff (`/האנדאובר`): what is live, the DoD evidence, and that C2 (live-db → cloud) is next.
