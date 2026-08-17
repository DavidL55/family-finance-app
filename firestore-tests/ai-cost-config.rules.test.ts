// Firestore Security Rules test — settings/aiCostConfig write gap (D4/Sasha B3, Stage 6 Task 8).
//
// D4 always asserted `settings/aiCostConfig` is super-admin-only write (spec §4's literal role
// table: "סופר-אדמין: ... ומפתחות AI"), but until this task the generic `settings/{docId}` rule
// was `isSuperAdmin() || isParent()` for every doc — so a parent could `setDoc` the monthly AI
// ceiling directly via the client SDK. `setAiCostCeiling`'s own role check is irrelevant here:
// the Admin SDK bypasses Rules entirely, so the ONLY real boundary is this file.
//
// Companion to settings-sensitivity.rules.test.ts (same `settings/{docId}` match block, a
// DIFFERENT docId split — ecosystem/budgetConfig are read-restricted, aiCostConfig is
// write-restricted) and ai-cost-gate.rules.test.ts (the three Function-only cost-gate
// collections this doc's ceiling protects).
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

// Task 8 review F1 — mirrors MAX_MONTHLY_CEILING_ILS in functions/src/costGate/types.ts and
// firestore.rules's own literal. Three copies of one bound is the cost of Rules having no import
// mechanism; the boundary test below is what keeps them honest.
const MAX_MONTHLY_CEILING_ILS = 1_000_000;

let testEnv: RulesTestEnvironment;

const DAVID = { uid: 'uid-david', memberId: 'david-levy', role: 'super-admin' as const };
const LILIT = { uid: 'uid-lilit', memberId: 'lilit-levy', role: 'parent' as const };

const ctxFor = (m: { uid: string; memberId: string; role: string }) =>
  testEnv.authenticatedContext(m.uid, { role: m.role, memberId: m.memberId });

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-familyfinance-ai-cost-config-rules-test',
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
    await setDoc(doc(db, 'settings', 'aiCostConfig'), { monthlyCeilingILS: 50 });
    await setDoc(doc(db, 'settings', 'categories'), { list: ['שונות', 'מזון'] });
  });
});

describe('settings/aiCostConfig — super-admin ONLY write (D4), not parent (the one place this stage diverges from the ecosystem/budgetConfig precedent)', () => {
  it('a parent CANNOT write settings/aiCostConfig directly via the client SDK', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertFails(setDoc(doc(db, 'settings', 'aiCostConfig'), { monthlyCeilingILS: 999999 }));
  });

  it('super-admin CAN write settings/aiCostConfig', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(setDoc(doc(db, 'settings', 'aiCostConfig'), { monthlyCeilingILS: 100 }));
  });

  it('a parent CAN still read settings/aiCostConfig (only the write branch narrows)', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(getDoc(doc(db, 'settings', 'aiCostConfig')));
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Task 8 review F1 — the write branch above validated WHO writes and never WHAT. A super-admin
// client-SDK setDoc of `monthlyCeilingILS: 'not a number'` SUCCEEDED, and costGate then computed
// `ceiling = NaN`, where `NaN <= 0` and `used + est > NaN` are BOTH false — so the gate admitted
// a ₪12.50 charge on top of ₪999,999 already spent, with the settings screen simultaneously
// reporting that no ceiling had been set. Schema validation here is one of the two independent
// layers that close it (costGate's own read-side resolveCeiling is the other; neither is
// sufficient alone — Rules cannot police the Admin SDK, and costGate cannot stop the doc being
// corrupted in the first place).
//
// Follows the isValidMember/isValidGroup/isValidPermissionDoc precedent already in the file, and
// deliberately does NOT split the single `match /settings/{docId}` block: Firestore ORs across
// every matching rule, so a second block for aiCostConfig would re-open the 60d1c32 exposure.
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('settings/aiCostConfig — schema validation on the WRITE, not just the writer (Task 8 review F1)', () => {
  it("the reviewer's probe: a super-admin setDoc of a STRING ceiling is now REFUSED", async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'settings', 'aiCostConfig'), { monthlyCeilingILS: 'not a number' }));
  });

  it('rejects every non-number shape a client could put there (bool, null, array, map, missing)', async () => {
    const db = ctxFor(DAVID).firestore();
    for (const bad of [true, null, [1, 2], { amount: 5 }] as unknown[]) {
      await assertFails(setDoc(doc(db, 'settings', 'aiCostConfig'), { monthlyCeilingILS: bad }));
    }
    await assertFails(setDoc(doc(db, 'settings', 'aiCostConfig'), { updatedBy: 'david-levy' }));
  });

  it('rejects a negative ceiling', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'settings', 'aiCostConfig'), { monthlyCeilingILS: -1 }));
  });

  it('accepts exactly the maximum and rejects one above it (the SAME bound the callable and costGate enforce)', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(setDoc(doc(db, 'settings', 'aiCostConfig'), { monthlyCeilingILS: MAX_MONTHLY_CEILING_ILS }));
    await assertFails(setDoc(doc(db, 'settings', 'aiCostConfig'), { monthlyCeilingILS: MAX_MONTHLY_CEILING_ILS + 1 }));
  });

  it('accepts a ceiling of exactly 0 — a valid, maximally-restrictive configured state (Task 8 review F3)', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(setDoc(doc(db, 'settings', 'aiCostConfig'), { monthlyCeilingILS: 0 }));
  });

  it('accepts a normal ceiling alongside the audit fields the callable writes', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(setDoc(doc(db, 'settings', 'aiCostConfig'), {
      monthlyCeilingILS: 120, updatedBy: 'david-levy',
    }));
  });

  it('an UPDATE that corrupts the ceiling is refused too, not just a full setDoc', async () => {
    // request.resource.data on an update is the MERGED result, so the validator sees the field
    // even when the patch is a single key — worth proving rather than assuming.
    const db = ctxFor(DAVID).firestore();
    await assertFails(updateDoc(doc(db, 'settings', 'aiCostConfig'), { monthlyCeilingILS: 'nope' }));
    await assertSucceeds(updateDoc(doc(db, 'settings', 'aiCostConfig'), { monthlyCeilingILS: 33 }));
  });

  it('DELETE rights are UNCHANGED by the create/update split — super-admin still can, a parent still cannot', async () => {
    // The `write` rule was split into `create, update` + `delete` only because a delete has no
    // `request.resource.data` for the validator to inspect. That split must not quietly change
    // who may delete: the Task 8 review verified this matrix cell adversarially, and deleting the
    // doc is harmless anyway (it produces the 'unset' state, on which the gate fails CLOSED).
    await assertFails(deleteDoc(doc(ctxFor(LILIT).firestore(), 'settings', 'aiCostConfig')));
    await assertSucceeds(deleteDoc(doc(ctxFor(DAVID).firestore(), 'settings', 'aiCostConfig')));
  });

  it('a parent still cannot write a perfectly VALID ceiling — schema validation did not replace the role check', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertFails(setDoc(doc(db, 'settings', 'aiCostConfig'), { monthlyCeilingILS: 100 }));
  });
});

describe('settings/categories — regression guard, unaffected by the aiCostConfig write narrowing', () => {
  it('a parent CAN still write settings/categories (the narrower aiCostConfig branch did not accidentally tighten every other settings doc)', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(setDoc(doc(db, 'settings', 'categories'), { list: ['עודכן'] }));
  });

  it('a parent CAN still DELETE settings/categories — splitting `write` into create/update + delete (Task 8 review F1) did not remove anyone\'s delete rights outside aiCostConfig', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(deleteDoc(doc(db, 'settings', 'categories')));
  });

  it('settings/categories takes an arbitrary shape — isValidAiCostConfig applies ONLY to aiCostConfig', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(setDoc(doc(db, 'settings', 'categories'), { monthlyCeilingILS: 'not a number' }));
  });
});
