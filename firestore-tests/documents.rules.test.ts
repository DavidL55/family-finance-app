// Firestore Security Rules test suite for the `documents` collection (D9, Stage 6 Task 1).
//
// Confirmed vulnerability (Stage 5 ledger finding M3, read directly from firestore.rules, not
// assumed): the `documents` collection had NO `match` block at all. Under Firestore's
// default-deny, every write FileProcessor.ts made into it (see FileProcessor.test.ts / D7) was
// very likely being silently denied in production already — a separate, long-flagged gap this
// task closes because Task 1 reopens the exact write path (processDocumentFile's replacement,
// commitExtractionDraft, is the only place that still writes here).
//
// Fix: `allow read, write: if isSuperAdmin() || isParent()` — fail-closed to super-admin/parent,
// same reasoning as the settings/ecosystem precedent (financial-document metadata has no
// per-member slice a rule can carve out cleanly yet; no `documents` permission module exists in
// the matrix) and matching spec §4 scenario 2, which names document ingestion as a
// parent-at-the-computer action, never a 'member'-role scenario.
//
// Companion to settings-sensitivity.rules.test.ts / finance-modules.rules.test.ts — same
// conventions: a real, ephemeral Firestore emulator instance via @firebase/rules-unit-testing,
// auth contexts fabricated via testEnv.authenticatedContext(uid, { role, memberId }).
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, setDoc, getDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

// ── Fixture identities ──────────────────────────────────────────────────────────
const DAVID = { uid: 'uid-david', memberId: 'david-levy', role: 'super-admin' as const };
const LILIT = { uid: 'uid-lilit', memberId: 'lilit-levy', role: 'parent' as const };
// OMER: a provisioned 'member'-role child — proves the fail-closed gate is role-based, not
// matrix-based (documents has no matrix module at all, so even a full-family-permissions member
// must still be denied).
const OMER = { uid: 'uid-omer', memberId: 'omer-levy', role: 'member' as const };

const ctxFor = (m: { uid: string; memberId: string; role: string }) =>
  testEnv.authenticatedContext(m.uid, { role: m.role, memberId: m.memberId });

const SAMPLE_DOCUMENT = {
  documentType: 'credit_card',
  issuer: 'MAX',
  accountId: '2190',
  periodStart: '2026-02-01',
  periodEnd: '2026-02-28',
  owner: 'דויד',
  totalAmount: 100,
  currency: 'ILS',
  fileName: 'statement.pdf',
  driveFileId: null,
  transactionCount: 1,
  created_at: 'x',
};

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-familyfinance-documents-rules-test',
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
    await setDoc(doc(db, 'members', 'omer-levy'), {
      id: 'omer-levy', name: 'עומר', role: 'ילד', color: '#E07A5F', groups: [], uid: OMER.uid,
      createdAt: 'x', updatedAt: 'x',
      // Even a full family-level matrix (were one to exist for `documents`, which it doesn't)
      // must not grant access — the gate is role-only, mirroring settings/ecosystem.
      resolvedPermissions: {
        expenses: { view: 'family', edit: 'family' },
        income: { view: 'family', edit: 'family' },
      },
    });

    await setDoc(doc(db, 'documents', 'doc-existing'), SAMPLE_DOCUMENT);
  });
});

describe('documents/{docId} — parent/super-admin only (D9, fail-closed, no matrix exception)', () => {
  it('super-admin CAN write a document record', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(setDoc(doc(db, 'documents', 'doc-new-1'), SAMPLE_DOCUMENT));
  });

  it('a parent CAN write a document record', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(setDoc(doc(db, 'documents', 'doc-new-2'), SAMPLE_DOCUMENT));
  });

  it('a member-role user CANNOT write a document record', async () => {
    const db = ctxFor(OMER).firestore();
    await assertFails(setDoc(doc(db, 'documents', 'doc-new-3'), SAMPLE_DOCUMENT));
  });

  it('an unauthenticated write CANNOT write a document record', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'documents', 'doc-new-4'), SAMPLE_DOCUMENT));
  });

  it('super-admin CAN read a document record', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(getDoc(doc(db, 'documents', 'doc-existing')));
  });

  it('a parent CAN read a document record', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(getDoc(doc(db, 'documents', 'doc-existing')));
  });

  it('a member-role user CANNOT read a document record', async () => {
    const db = ctxFor(OMER).firestore();
    await assertFails(getDoc(doc(db, 'documents', 'doc-existing')));
  });

  it('an unauthenticated read CANNOT read a document record', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'documents', 'doc-existing')));
  });
});
