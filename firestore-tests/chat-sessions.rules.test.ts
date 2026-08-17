// Firestore Security Rules regression test for `chat_sessions/{memberId}/sessions/{sessionId}`
// (Stage 6 Task 5, Sun W9): Function-only — `allow read, write: if false` for every client, no
// exception, not even super-admin. Only aiChat.ts (Admin SDK) ever writes here, keyed by the
// caller's VERIFIED memberId in the document PATH, not a bare client-supplied field — the whole
// point of the fix this collection exists to prove. Same conventions as
// ai-cost-gate.rules.test.ts: a real, ephemeral Firestore emulator instance via
// @firebase/rules-unit-testing, auth contexts fabricated via
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
// super-admin is denied (including for their OWN session under their OWN memberId), every weaker
// role is denied too; no need to also fixture parent/member.
const DAVID = { uid: 'uid-david', memberId: 'david-levy', role: 'super-admin' as const };

const ctxFor = (m: { uid: string; memberId: string; role: string }) =>
  testEnv.authenticatedContext(m.uid, { role: m.role, memberId: m.memberId });

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-familyfinance-chat-sessions-rules-test',
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
    await setDoc(doc(db, 'chat_sessions', 'david-levy', 'sessions', 'existing-session'), {
      memberId: 'david-levy', messages: [],
    });
  });
});

describe('chat_sessions/{memberId}/sessions/{sessionId} — Function-only, no client access at any role (Sun W9)', () => {
  it('super-admin CANNOT read their OWN chat session', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(getDoc(doc(db, 'chat_sessions', 'david-levy', 'sessions', 'existing-session')));
  });

  it('super-admin CANNOT write to their OWN chat session', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'chat_sessions', 'david-levy', 'sessions', 'existing-session'), {
      memberId: 'david-levy', messages: [{ role: 'user', text: 'spoofed' }],
    }));
  });

  it('super-admin CANNOT write a NEW session under their own memberId either', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'chat_sessions', 'david-levy', 'sessions', 'new-session'), {
      memberId: 'david-levy', messages: [],
    }));
  });

  it("super-admin CANNOT read or write ANOTHER member's chat session either", async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(getDoc(doc(db, 'chat_sessions', 'omer-levy', 'sessions', 'someone-elses-session')));
    await assertFails(setDoc(doc(db, 'chat_sessions', 'omer-levy', 'sessions', 'someone-elses-session'), {
      memberId: 'omer-levy', messages: [],
    }));
  });
});
