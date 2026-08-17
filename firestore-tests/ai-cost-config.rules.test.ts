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
import { doc, getDoc, setDoc } from 'firebase/firestore';

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

describe('settings/categories — regression guard, unaffected by the aiCostConfig write narrowing', () => {
  it('a parent CAN still write settings/categories (the narrower aiCostConfig branch did not accidentally tighten every other settings doc)', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(setDoc(doc(db, 'settings', 'categories'), { list: ['עודכן'] }));
  });
});
