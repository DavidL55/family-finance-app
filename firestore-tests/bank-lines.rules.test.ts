// Rules suite for `bank_lines` (Stage 9 S1). Same harness as finance-modules.rules.test.ts:
// identities are fabricated via testEnv.authenticatedContext(uid, { role, memberId }).
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { testFirestoreHost } from './tools/emulatorHost';
import { createAccessFixtures, type FixtureIdentity } from './tools/accessFixtures';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, deleteDoc, where } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;
const DAVID = { uid: 'uid-david', memberId: 'david-levy', role: 'super-admin' as const };
const LILIT = { uid: 'uid-lilit', memberId: 'lilit-levy', role: 'parent' as const };
const OMER  = { uid: 'uid-omer',  memberId: 'omer-levy',  role: 'member' as const };   // accounts view:'own'
const LIOR  = { uid: 'uid-lior',  memberId: 'lior-levy',  role: 'member' as const };   // accounts view:'none'

const line = (id: string, ownerId: string, accountId: string) => ({
  id, ownerId, accountId, accountNumber: '12-559-305397', date: '2026-10-05', period: '2026-10',
  action: 'העברה-נייד', debit: null, credit: 7000, balance: 7042.04, kind: 'transfer-internal',
  counterpartAccountId: 'acc-poalim-david', source: 'test', verified: true,
  createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z',
});

// The host/port come from `firebase emulators:exec` (FIRESTORE_EMULATOR_HOST) via testFirestoreHost(),
// which refuses an unset variable and the live-mode port.
const { host: emuHost, port: emuPort } = testFirestoreHost();

const access = createAccessFixtures(() => testEnv);

// Every identity this file signs in with role+memberId claims (spec C1 §7) — including the ones
// built inline inside describe blocks, hoisted to named consts below. Claim-less / role-only
// identities are deliberately absent: they have no access doc on purpose.
const ACCESS_IDENTITIES: FixtureIdentity[] = [DAVID, LILIT, OMER, LIOR];

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-familyfinance-bank-lines-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: emuHost, port: emuPort },
  });
});
afterAll(async () => { await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await access.seed(ACCESS_IDENTITIES);
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Rules read a member's level from members/{memberId}.resolvedPermissions (firestore.rules
    // myLevel → myMember()), NOT from permissions/* — same fixture shape as finance-modules.rules.test.ts.
    const member = (m: { uid: string; memberId: string }, resolvedPermissions?: object) => setDoc(doc(db, 'members', m.memberId), {
      id: m.memberId, name: m.memberId, role: 'x', color: '#000000', groups: [], uid: m.uid,
      createdAt: 'x', updatedAt: 'x', ...(resolvedPermissions ? { resolvedPermissions } : {}),
    });
    await member(DAVID); await member(LILIT);
    await member(OMER, { accounts: { view: 'own', edit: 'none' } });
    await member(LIOR, { accounts: { view: 'none', edit: 'none' } });
    await setDoc(doc(db, 'bank_lines', 'bl-joint-1'), line('bl-joint-1', 'david-levy', 'acc-poalim-joint'));
    await setDoc(doc(db, 'bank_lines', 'bl-omer-1'),  line('bl-omer-1',  'omer-levy',  'acc-omer'));
  });
});

const as = (m: { uid: string; role: string; memberId: string }) =>
  access.ctx(m.uid, { role: m.role, memberId: m.memberId }).firestore();

describe('bank_lines — read', () => {
  it('a parent reads every line (joint account included)', async () => {
    await assertSucceeds(getDocs(collection(as(LILIT), 'bank_lines')));
  });
  it('a member with accounts.view=own reads only lines he owns', async () => {
    await assertSucceeds(getDoc(doc(as(OMER), 'bank_lines', 'bl-omer-1')));
    await assertFails(getDoc(doc(as(OMER), 'bank_lines', 'bl-joint-1')));
    await assertSucceeds(getDocs(query(collection(as(OMER), 'bank_lines'), where('ownerId', '==', 'omer-levy'))));
    await assertFails(getDocs(collection(as(OMER), 'bank_lines')));
  });
  it('a member with accounts.view=none reads nothing, not even his own', async () => {
    await assertFails(getDoc(doc(as(LIOR), 'bank_lines', 'bl-omer-1')));
  });
});

describe('bank_lines — every client write is denied, super-admin included', () => {
  it('create', async () => {
    await assertFails(setDoc(doc(as(DAVID), 'bank_lines', 'bl-new'), line('bl-new', 'david-levy', 'acc-poalim-joint')));
  });
  it('update', async () => {
    await assertFails(updateDoc(doc(as(DAVID), 'bank_lines', 'bl-joint-1'), { balance: 1 }));
  });
  it('delete', async () => {
    await assertFails(deleteDoc(doc(as(LILIT), 'bank_lines', 'bl-joint-1')));
  });
});
