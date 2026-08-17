// Firestore Security Rules regression test for the three AI cost-gate collections
// (D4, Stage 6 Task 3): `ai_usage`, `ai_usage_counters`, `ai_overage_approvals` are Function-only
// — `allow read, write: if false` for every client, no exception, not even super-admin. The
// Admin SDK (costGate.ts) bypasses Rules entirely and is the only writer; Task 8's
// getAiUsageSummary callable computes and returns the numbers a settings screen needs instead of
// letting the client read a cost-sensitive collection straight from Firestore.
//
// This proves the Function-only design is actually ENFORCED, not just documented — same
// conventions as documents.rules.test.ts / finance-modules.rules.test.ts: a real, ephemeral
// Firestore emulator instance via @firebase/rules-unit-testing, auth contexts fabricated via
// testEnv.authenticatedContext(uid, { role, memberId }).
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, setDoc, getDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

// Deliberately the super-admin identity — the STRONGEST client role in this app. If even
// super-admin is denied, every weaker role is denied too; no need to also fixture parent/member.
const DAVID = { uid: 'uid-david', memberId: 'david-levy', role: 'super-admin' as const };

const ctxFor = (m: { uid: string; memberId: string; role: string }) =>
  testEnv.authenticatedContext(m.uid, { role: m.role, memberId: m.memberId });

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-familyfinance-ai-cost-gate-rules-test',
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
    await setDoc(doc(db, 'ai_usage', 'existing-entry'), {
      providerId: 'anthropic', modelId: 'claude-sonnet-5', amountILS: 1, month: '2026-08',
    });
    await setDoc(doc(db, 'ai_usage_counters', 'anthropic_2026-08'), {
      providerId: 'anthropic', month: '2026-08', totalILS: 1,
    });
    await setDoc(doc(db, 'ai_overage_approvals', 'existing-token'), {
      providerId: 'anthropic', used: false, expiresAt: Date.now() + 120_000,
    });
  });
});

describe('ai_usage/{docId} — Function-only, no client access at any role (D4)', () => {
  it('super-admin CANNOT read a ledger entry', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(getDoc(doc(db, 'ai_usage', 'existing-entry')));
  });
  it('super-admin CANNOT write a ledger entry', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'ai_usage', 'new-entry'), { providerId: 'mock', amountILS: 0 }));
  });
});

describe('ai_usage_counters/{docId} — Function-only, no client access at any role (D4)', () => {
  it('super-admin CANNOT read a monthly counter', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(getDoc(doc(db, 'ai_usage_counters', 'anthropic_2026-08')));
  });
  it('super-admin CANNOT write a monthly counter', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'ai_usage_counters', 'anthropic_2026-08'), { totalILS: 999 }));
  });
});

describe('ai_overage_approvals/{docId} — Function-only, no client access at any role (D4)', () => {
  it('super-admin CANNOT read an approval token', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(getDoc(doc(db, 'ai_overage_approvals', 'existing-token')));
  });
  it('super-admin CANNOT write (self-mint) an approval token', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'ai_overage_approvals', 'self-minted'), { providerId: 'anthropic', used: false }));
  });
});
