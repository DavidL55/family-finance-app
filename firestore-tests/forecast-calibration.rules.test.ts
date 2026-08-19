// Stage 7 T6 — the two Rules facts a mocked suite cannot see.
//
//  (1) **D28's `forecast_calibration` is CREATE-ONLY, for every role.** "Never overwritten" is a
//      statement about what the document MEANS — "the forecast made at the START of month M" — and
//      a helper the caller can skip is not where that belongs. Update and delete are denied to
//      super-admin as well, which is a deliberate departure from every other collection in this
//      file; the block says why in its own words.
//
//  (2) **D29(c)'s target source is UNREADABLE to a family member.** `settings/budgetConfig` is
//      parent-or-super-admin read, so a `'member'` session gets a permission denial where the
//      allowance line looks for its target — and D29(c) rules that unreadable, absent and empty are
//      one calm answer with NO fabricated target. The plan names this as the one step of T6 that
//      needs a live emulator, and this is it: the client-side half is `budgetConfigTargetILS`
//      returning `null`, and it is only the right behaviour if the read genuinely fails.
//
// The corpus also carries the fact T0 measured and D29(c) is built on: `settings/budgetConfig` is
// `{"members": []}` — ZERO targets of any kind — so the day-one state of this whole line is "no
// target", not "target zero".
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const DAVID = { uid: 'uid-david', memberId: 'david-levy', role: 'super-admin' as const };
const LILIT = { uid: 'uid-lilit', memberId: 'lilit-levy', role: 'parent' as const };
/** A full-matrix member — the strongest non-privileged session this app can produce. */
const MAYA = { uid: 'uid-maya', memberId: 'maya-levy', role: 'member' as const };
/** A zero-permission child: no `resolvedPermissions` at all. */
const OMER = { uid: 'uid-omer', memberId: 'omer-levy', role: 'member' as const };

const ctxFor = (m: { uid: string; memberId: string; role: string }) =>
  testEnv.authenticatedContext(m.uid, { role: m.role, memberId: m.memberId });
const anonCtx = () => testEnv.unauthenticatedContext();

const ALL_FAMILY = {
  expenses: { view: 'family', edit: 'family' },
  income: { view: 'family', edit: 'family' },
  investments: { view: 'family', edit: 'family' },
  goals: { view: 'family', edit: 'family' },
  accounts: { view: 'family', edit: 'family' },
  recurring: { view: 'family', edit: 'family' },
  loans: { view: 'family', edit: 'family' },
  insurances: { view: 'family', edit: 'family' },
  forecast: { view: 'family', edit: 'family' },
};

/** A valid snapshot. Every denial below differs from this by exactly one thing. */
const snapshot = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  period: '2026-09',
  computedAt: '2026-09-02T06:00:00.000Z',
  horizonMonths: 3,
  expenseILS: 8400,
  incomeILS: 9000,
  categories: [{ categoryId: 'דיור', layer: 'certain', amountILS: 6000 }],
  ...over,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-familyfinance-calibration-rules-test',
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
    const member = (id: string, name: string, role: string, uid: string, perms?: unknown) => ({
      id, name, role, color: '#1F4E78', groups: [], uid, createdAt: 'x', updatedAt: 'x',
      ...(perms === undefined ? {} : { resolvedPermissions: perms }),
    });
    await setDoc(doc(db, 'members', DAVID.memberId), member(DAVID.memberId, 'דויד', 'הורה', DAVID.uid));
    await setDoc(doc(db, 'members', LILIT.memberId), member(LILIT.memberId, 'לילית', 'הורה', LILIT.uid));
    await setDoc(doc(db, 'members', MAYA.memberId), member(MAYA.memberId, 'מאיה', 'ילד', MAYA.uid, ALL_FAMILY));
    await setDoc(doc(db, 'members', OMER.memberId), member(OMER.memberId, 'עומר', 'ילד', OMER.uid));

    // The document T0 measured, byte-for-byte: an EMPTY members array and no target of any kind.
    await setDoc(doc(db, 'settings', 'budgetConfig'), { members: [] });
    await setDoc(doc(db, 'forecast_calibration', '2026-08'), snapshot({ period: '2026-08' }));
  });
});

describe('forecast_calibration — create-only, and the doc id IS the month', () => {
  it('a full-matrix member may create the current month, once', async () => {
    const db = ctxFor(MAYA).firestore();
    await assertSucceeds(setDoc(doc(db, 'forecast_calibration', '2026-09'), snapshot()));
  });

  it('a zero-permission child may create one too — the app writes it, not the user', async () => {
    // D28: no UI, no user control. The write fires from the first forecast computation of a month,
    // whoever happens to open the app. Gating it on a matrix level would mean the family's
    // calibration record depends on which member opened the app first that month.
    const db = ctxFor(OMER).firestore();
    await assertSucceeds(setDoc(doc(db, 'forecast_calibration', '2026-09'), snapshot()));
  });

  it('an unauthenticated caller may not', async () => {
    const db = anonCtx().firestore();
    await assertFails(setDoc(doc(db, 'forecast_calibration', '2026-09'), snapshot()));
  });

  it('!! OVERWRITING AN EXISTING MONTH IS DENIED — to a member, a parent AND a super-admin', async () => {
    // The one that matters. `setDoc` over an existing document is an UPDATE, and a late-month
    // projection silently replacing an opening one leaves a document that still claims to be an
    // opening projection. Asserted for every role, because "create-only" here departs from every
    // other collection's super-admin bypass and a reader is entitled to see that it is deliberate.
    for (const session of [MAYA, LILIT, DAVID]) {
      const db = ctxFor(session).firestore();
      await assertFails(setDoc(doc(db, 'forecast_calibration', '2026-08'), snapshot({ period: '2026-08', expenseILS: 1 })));
      await assertFails(updateDoc(doc(db, 'forecast_calibration', '2026-08'), { expenseILS: 1 }));
      await assertFails(deleteDoc(doc(db, 'forecast_calibration', '2026-08')));
    }
  });

  it('a snapshot filed under a month it is not about is denied', async () => {
    const db = ctxFor(MAYA).firestore();
    await assertFails(setDoc(doc(db, 'forecast_calibration', '2026-09'), snapshot({ period: '2026-10' })));
  });

  it('a malformed period is denied — the id is a length check away from being anything', async () => {
    // T0 proved `transaction_lines`' `date.size() == 10` is a LENGTH check and that a member can
    // write `9999-99-99` through it. A period gets a real pattern, here as everywhere in this file.
    const db = ctxFor(MAYA).firestore();
    // `''` is deliberately NOT in this list: an empty document id is rejected by the CLIENT SDK
    // before a request is made ("Document references must have an even number of segments"), so
    // asserting a rules denial for it would be asserting something Rules never saw.
    for (const period of ['2026-9', '2026-13', '2026-00', 'unknown']) {
      await assertFails(setDoc(doc(db, 'forecast_calibration', period), snapshot({ period })));
    }
  });

  it('refuses a snapshot missing the fields that make it interpretable', async () => {
    const db = ctxFor(MAYA).firestore();
    // `computedAt` and `horizonMonths` are what tell Stage 8 an early-month projection from a
    // late-month one. Without them the stored number is a figure with no units.
    await assertFails(setDoc(doc(db, 'forecast_calibration', '2026-09'), snapshot({ computedAt: '' })));
    await assertFails(setDoc(doc(db, 'forecast_calibration', '2026-09'), snapshot({ horizonMonths: 0 })));
    await assertFails(setDoc(doc(db, 'forecast_calibration', '2026-09'), snapshot({ horizonMonths: '3' })));
    await assertFails(setDoc(doc(db, 'forecast_calibration', '2026-09'), snapshot({ expenseILS: -1 })));
    await assertFails(setDoc(doc(db, 'forecast_calibration', '2026-09'), snapshot({ categories: 'none' })));
  });

  it('every role with a role may READ it — it is a family fact, not a per-member one', async () => {
    for (const session of [DAVID, LILIT, MAYA, OMER]) {
      const db = ctxFor(session).firestore();
      await assertSucceeds(getDoc(doc(db, 'forecast_calibration', '2026-08')));
    }
    await assertFails(getDoc(doc(anonCtx().firestore(), 'forecast_calibration', '2026-08')));
  });
});

describe('!! D29(c) — the budgetConfig target source, proven UNREADABLE for a member', () => {
  it('a full-matrix member CANNOT read settings/budgetConfig', async () => {
    // The strongest non-privileged session in the app, holding `family` on every module including
    // `forecast`, still cannot read the document the allowance line would look for its target in.
    // No grant in the matrix is a substitute for the role here — `budgetConfig` holds every
    // member's net-worth figures in one blob with no per-member slice a rule can carve out.
    const db = ctxFor(MAYA).firestore();
    await assertFails(getDoc(doc(db, 'settings', 'budgetConfig')));
  });

  it('a zero-permission child cannot either', async () => {
    await assertFails(getDoc(doc(ctxFor(OMER).firestore(), 'settings', 'budgetConfig')));
  });

  it('a parent and a super-admin can — so the denial above is about the ROLE, not about the doc', async () => {
    // The pair that stops the two assertions above from passing for the wrong reason. Without it a
    // typo in the collection name, or a rule denying this document to everyone, would read as proof.
    for (const session of [LILIT, DAVID]) {
      await assertSucceeds(getDoc(doc(ctxFor(session).firestore(), 'settings', 'budgetConfig')));
    }
  });

  it('and what a parent reads is `{members: []}` — ZERO targets, which is the day-one state', async () => {
    // T0's measurement, re-asserted against a live emulator rather than quoted. This is why
    // `budgetConfigTargetILS` returning `null` is the LIVE path and not the defensive one, and why
    // D29(c) requires a calm "no target" line rather than a ₪0 target.
    const snap = await getDoc(doc(ctxFor(LILIT).firestore(), 'settings', 'budgetConfig'));
    expect(snap.exists()).toBe(true);
    expect(snap.data()).toEqual({ members: [] });
  });
});
