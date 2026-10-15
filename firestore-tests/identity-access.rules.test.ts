// Spec C1 §4–§5, §7 (Task 3): rules read role/memberId from access/{uid}, never from token claims;
// invites/{emailLower} + access/{uid} with browser-side redemption bound by the rules (one batch,
// getAfter/existsAfter). Ruling F11 adds the table at the bottom: a signed-in user with no access
// doc — with or without role claims — is denied in EVERY collection matched in firestore.rules.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  testEnv.authenticatedContext(uid, claims).firestore() as unknown as Firestore;

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

// ── Ruling F11 / spec §7: no access doc → denied in EVERY collection ──────────────────────────
// The path list is DERIVED from firestore.rules, so a new `match` is covered the moment it is
// written — it cannot silently escape this table. Two guards keep the derivation honest: the
// parser must account for every `match` keyword in the file, and a few known paths must be in it.

/** Every document path matched in `rules`, with nested `match` blocks joined to their parents. */
function matchedDocumentPaths(rules: string): { paths: string[]; matchKeywords: number } {
  const pathSegment = String.raw`\/(?:[^\s{}]|\{[^{}\s]*\})*`;
  const token = new RegExp(
    String.raw`\/\/[^\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\bmatch\s+(${pathSegment})\s*\{|\{|\}`,
    'g',
  );
  const stack: (string | null)[] = [];
  const paths: string[] = [];
  let matchKeywords = 0;
  for (const t of rules.matchAll(token)) {
    if (t[0].startsWith('//') || t[0].startsWith("'") || t[0].startsWith('"')) continue;
    if (t[1] !== undefined) {
      matchKeywords += 1;
      stack.push(t[1]);
      const full = stack.filter((p): p is string => p !== null).join('');
      const rel = full.replace(/^\/databases\/\{database\}\/documents/, '');
      if (rel !== '') paths.push(rel.replace(/^\//, ''));
    } else if (t[0] === '{') {
      stack.push(null);
    } else {
      stack.pop();
    }
  }
  return { paths, matchKeywords };
}

const RULES_SOURCE = readFileSync('firestore.rules', 'utf8');
const { paths: MATCHED_PATHS, matchKeywords: MATCH_KEYWORDS } = matchedDocumentPaths(RULES_SOURCE);
const PROBE_ID = 'deny-probe';
const concrete = (path: string) => path.replace(/\{[^}]*\}/g, PROBE_ID);

describe('the derived list of matched paths is complete', () => {
  it('accounts for every `match` keyword in firestore.rules (root included)', () => {
    const outsideComments = RULES_SOURCE.replace(/\/\/[^\n]*/g, '');
    expect((outsideComments.match(/\bmatch\s+\//g) ?? []).length).toBe(MATCH_KEYWORDS);
    expect(MATCHED_PATHS.length).toBe(MATCH_KEYWORDS - 1);
  });
  it('contains known top-level and nested paths', () => {
    expect(MATCHED_PATHS).toEqual(expect.arrayContaining([
      'members/{memberId}', 'access/{uid}', 'invites/{email}', 'transaction_lines/{docId}',
      'settings/{docId}', 'chat_sessions/{memberId}/sessions/{sessionId}',
    ]));
  });
  it('joins nested match blocks to their parents', () => {
    const { paths } = matchedDocumentPaths(
      "match /databases/{database}/documents { match /a/{x} { allow read: if 'a{' != '}'; // }\n match /b/{y} { allow read: if false; } } }",
    );
    expect(paths).toEqual(['a/{x}', 'a/{x}/b/{y}']);
  });
});

describe.each([
  ['a signed-in, verified user with no access doc', () =>
    testEnv.authenticatedContext('uid-stranger', { email: 'stranger@gmail.com', email_verified: true }).firestore()],
  ['a token carrying super-admin claims but no access doc', () =>
    testEnv.authenticatedContext('uid-claims-only', {
      role: 'super-admin', memberId: 'david-levy', email: 'claims.only@gmail.com', email_verified: true,
    }).firestore()],
])('%s is denied in every matched collection', (_label, dbFor) => {
  it.each(MATCHED_PATHS)('%s — get, list, create, update, delete', async (path) => {
    const docPath = concrete(path);
    const collectionPath = docPath.slice(0, docPath.lastIndexOf('/'));
    // The probe doc EXISTS, so a get/update/delete denial is the rules saying no, not "not found".
    await seedAdmin((db) => setDoc(doc(db, docPath), { probe: true }));
    const db = dbFor();
    await assertFails(getDoc(doc(db, docPath)));
    await assertFails(getDocs(collection(db, collectionPath)));
    await assertFails(setDoc(doc(db, `${collectionPath}/${PROBE_ID}-new`), { probe: true }));
    await assertFails(updateDoc(doc(db, docPath), { probe: false }));
    await assertFails(deleteDoc(doc(db, docPath)));
  });
});

describe('fixture guard — claims must agree with the seeded access doc', () => {
  it('throws when a seeded identity is signed in with a different role or memberId', () => {
    expect(() => access.ctx(LILIT.uid, { role: 'super-admin', memberId: LILIT.memberId })).toThrow(/rules use the doc/);
    expect(() => access.ctx(LILIT.uid, { role: LILIT.role, memberId: 'david-levy' })).toThrow(/rules use the doc/);
    expect(() => access.ctx(LILIT.uid, { role: LILIT.role, memberId: LILIT.memberId })).not.toThrow();
  });
});
