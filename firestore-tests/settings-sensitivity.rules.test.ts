// Firestore Security Rules test suite — settings/{docId} sensitivity split (security fix).
//
// Confirmed vulnerability (emulator probe, not theory): the old `match /settings/{docId}`
// block gated ALL settings docs on `hasRole()` alone, which checks only that role is one of
// super-admin/parent/member — it never consults `resolvedPermissions`. Because `settings/ecosystem`
// and `settings/budgetConfig` are single blobs holding EVERY member's full net-worth figures
// (liquid, investments, pensions, crypto, real estate, mortgage) with no per-member slice a rule
// can carve out, a zero-permission child token could read a parent's entire net-worth document
// server-side. This contradicts spec §4 scenario 6 ("a child asking about a parent's finances is
// refused").
//
// Fix: `settings/ecosystem` and `settings/budgetConfig` reads are now restricted to
// isSuperAdmin() || isParent() — fail-closed, no matrix exception, since these docs have no
// module for resolvedPermissions to gate. Every other settings doc (categories, syncState, …)
// stays on hasRole() — e.g. the category list is needed by every role for the filter UI.
//
// Companion to permissions.rules.test.ts / finance-modules.rules.test.ts — split into its own
// file because this fixture set (a zero-permission member and a full-family-matrix member) is
// specific to proving the settings docId split is role-gated, not matrix-gated.
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, setDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

// ── Fixture identities ──────────────────────────────────────────────────────────
const DAVID = { uid: 'uid-david', memberId: 'david-levy', role: 'super-admin' as const };
const LILIT = { uid: 'uid-lilit', memberId: 'lilit-levy', role: 'parent' as const };
// ZERO_PERM: a provisioned child with NO resolvedPermissions field at all — the exact shape
// the emulator probe used to prove the exposure.
const ZERO_PERM = { uid: 'uid-zero', memberId: 'zero-levy', role: 'member' as const };
// FULL_MATRIX: a member granted 'family'-level view+edit on EVERY module that exists. If the
// settings/ecosystem|budgetConfig gate were (wrongly) matrix-driven instead of role-driven, this
// fixture would pass — proving it's still denied confirms the gate is isSuperAdmin()||isParent(),
// not "any sufficiently-permissioned member".
const FULL_MATRIX = { uid: 'uid-full', memberId: 'full-levy', role: 'member' as const };

const ctxFor = (m: { uid: string; memberId: string; role: string }) =>
  testEnv.authenticatedContext(m.uid, { role: m.role, memberId: m.memberId });

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-familyfinance-settings-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, 'members', 'david-levy'), {
      id: 'david-levy', name: 'דויד', role: 'הורה', color: '#1F4E78', groups: [], uid: DAVID.uid,
      createdAt: 'x', updatedAt: 'x',
    });
    await setDoc(doc(db, 'members', 'lilit-levy'), {
      id: 'lilit-levy', name: 'לילית', role: 'הורה', color: '#17C3B2', groups: [], uid: LILIT.uid,
      createdAt: 'x', updatedAt: 'x',
    });
    await setDoc(doc(db, 'members', 'zero-levy'), {
      id: 'zero-levy', name: 'אפס', role: 'ילד', color: '#E07A5F', groups: [], uid: ZERO_PERM.uid,
      createdAt: 'x', updatedAt: 'x',
      // deliberately NO resolvedPermissions field — the probe's exact fixture shape.
    });
    await setDoc(doc(db, 'members', 'full-levy'), {
      id: 'full-levy', name: 'מלא', role: 'ילד', color: '#663399', groups: [], uid: FULL_MATRIX.uid,
      createdAt: 'x', updatedAt: 'x',
      resolvedPermissions: {
        expenses: { view: 'family', edit: 'family' },
        income: { view: 'family', edit: 'family' },
        investments: { view: 'family', edit: 'family' },
        goals: { view: 'family', edit: 'family' },
        accounts: { view: 'family', edit: 'family' },
        recurring: { view: 'family', edit: 'family' },
        loans: { view: 'family', edit: 'family' },
        insurances: { view: 'family', edit: 'family' },
      },
    });

    await setDoc(doc(db, 'settings', 'ecosystem'), {
      all: { liquid: 100000, investments: 50000, pensions: 200000, crypto: 1000, realEstate: 3000000, mortgage: 900000 },
    });
    await setDoc(doc(db, 'settings', 'budgetConfig'), {
      all: [{ name: 'שונות', budget: 1000 }],
    });
    await setDoc(doc(db, 'settings', 'categories'), { list: ['שונות', 'מזון'] });
  });
});

// ────────────────────────────────────────────────────────────────────────────────
describe('settings/ecosystem — parent/super-admin only (fail-closed, no matrix exception)', () => {
  it('a zero-permission member CANNOT read settings/ecosystem', async () => {
    const db = ctxFor(ZERO_PERM).firestore();
    await assertFails(getDoc(doc(db, 'settings', 'ecosystem')));
  });

  it('a member with a full family-level matrix on every module STILL CANNOT read settings/ecosystem (role-gated, not matrix-gated)', async () => {
    const db = ctxFor(FULL_MATRIX).firestore();
    await assertFails(getDoc(doc(db, 'settings', 'ecosystem')));
  });

  it('a parent CAN read settings/ecosystem', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(getDoc(doc(db, 'settings', 'ecosystem')));
  });

  it('super-admin CAN read settings/ecosystem', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(getDoc(doc(db, 'settings', 'ecosystem')));
  });

  it('a member (any role/matrix) CANNOT write settings/ecosystem', async () => {
    const zeroDb = ctxFor(ZERO_PERM).firestore();
    await assertFails(setDoc(doc(zeroDb, 'settings', 'ecosystem'), { all: {} }));
    const fullDb = ctxFor(FULL_MATRIX).firestore();
    await assertFails(setDoc(doc(fullDb, 'settings', 'ecosystem'), { all: {} }));
  });
});

describe('settings/budgetConfig — parent/super-admin only (fail-closed, no matrix exception)', () => {
  it('a zero-permission member CANNOT read settings/budgetConfig', async () => {
    const db = ctxFor(ZERO_PERM).firestore();
    await assertFails(getDoc(doc(db, 'settings', 'budgetConfig')));
  });

  it('a member with a full family-level matrix on every module STILL CANNOT read settings/budgetConfig (role-gated, not matrix-gated)', async () => {
    const db = ctxFor(FULL_MATRIX).firestore();
    await assertFails(getDoc(doc(db, 'settings', 'budgetConfig')));
  });

  it('a parent CAN read settings/budgetConfig', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(getDoc(doc(db, 'settings', 'budgetConfig')));
  });

  it('super-admin CAN read settings/budgetConfig', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(getDoc(doc(db, 'settings', 'budgetConfig')));
  });

  it('a member (any role/matrix) CANNOT write settings/budgetConfig', async () => {
    const zeroDb = ctxFor(ZERO_PERM).firestore();
    await assertFails(setDoc(doc(zeroDb, 'settings', 'budgetConfig'), { all: [] }));
    const fullDb = ctxFor(FULL_MATRIX).firestore();
    await assertFails(setDoc(doc(fullDb, 'settings', 'budgetConfig'), { all: [] }));
  });
});

describe('settings/categories — regression guard, stays readable by hasRole() (needed by every role for filter UI)', () => {
  it('a zero-permission member CAN still read settings/categories', async () => {
    const db = ctxFor(ZERO_PERM).firestore();
    await assertSucceeds(getDoc(doc(db, 'settings', 'categories')));
  });

  it('a member with a full family-level matrix CAN read settings/categories', async () => {
    const db = ctxFor(FULL_MATRIX).firestore();
    await assertSucceeds(getDoc(doc(db, 'settings', 'categories')));
  });

  it('a parent CAN read settings/categories', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(getDoc(doc(db, 'settings', 'categories')));
  });

  it('super-admin CAN read settings/categories', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(getDoc(doc(db, 'settings', 'categories')));
  });

  it('a member (any role/matrix) still CANNOT write settings/categories (write stays parent/super-admin only)', async () => {
    const zeroDb = ctxFor(ZERO_PERM).firestore();
    await assertFails(setDoc(doc(zeroDb, 'settings', 'categories'), { list: ['hacked'] }));
    const fullDb = ctxFor(FULL_MATRIX).firestore();
    await assertFails(setDoc(doc(fullDb, 'settings', 'categories'), { list: ['hacked'] }));
  });
});
