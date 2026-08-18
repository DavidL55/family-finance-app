// Stage 7 T2 — the adversarial rules matrix for `forecast_assumptions`, plus D21(d)'s
// `period`/`ownerId` immutability on `transaction_lines`.
//
// ── HOW THIS MATRIX WAS BUILT ────────────────────────────────────────────────────────────────
//
// The expectations below were RE-DERIVED from the rules' logic and written down BEFORE the suite
// was run, not read off a passing run. Six session types × the new collection × five operations,
// plus one case per `scopeKind`, plus the two D21(d) cases.
//
// THE ONE THAT MATTERS MOST IS `full-matrix member cannot write another member's assumption`.
// A matrix member holding `forecast: family` on every module is the strongest non-privileged
// session this app can produce, and if the write gate were the ordinary owned-module pattern
// (`level == 'family'` ⇒ any document) that session could author a document attributed to a
// PARENT, carrying free-text `reasonHe` that renders on the parent's own screen — member-authored
// content injected into a higher-privilege view, and a prompt-injection vector the day Stage 9
// puts forecast facts in the AI context. The write gate is therefore anti-spoof-bound
// (`ownerId == memberId()`), the same binding `audit_log` and `permissions` already use, and the
// two cases below are what show the gate is ROLE-driven and not MATRIX-driven.
//
// THE SECOND IS THE D21(d) PAIR, ASSERTED AS A PARENT. `allow update` on `transaction_lines` is
// `… && (isSuperAdmin() || isParent() || <post-image checks>)` — the whole post-image branch is a
// parent bypass, and T0 measured TWO OF THIS FAMILY'S THREE MEMBERS AS הורה. A matrix that only
// exercises a 'member' session cannot see whether the immutability check binds the people most
// likely to be editing rows. And the paired half — an update to a row with NO `period` must still
// SUCCEED — is the one that proves the app is usable between T2 and T3: `.get(field, null)` rather
// than a bare `resource.data.period`, because no row has the field yet, a missing map key is an
// ERROR in Rules, and an error in an `&&` chain DENIES.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

// ── Fixture identities ──────────────────────────────────────────────────────────────────────
const DAVID = { uid: 'uid-david', memberId: 'david-levy', role: 'super-admin' as const };
const LILIT = { uid: 'uid-lilit', memberId: 'lilit-levy', role: 'parent' as const };
/** ZERO-PERMISSION CHILD — no `resolvedPermissions` field at all. The fail-closed default. */
const OMER = { uid: 'uid-omer', memberId: 'omer-levy', role: 'member' as const };
/** FULL-MATRIX MEMBER — every module family/family, including `forecast`. */
const MAYA = { uid: 'uid-maya', memberId: 'maya-levy', role: 'member' as const };
/** forecast: family, expenses: family — and loans/insurances/recurring NONE. D25(c)'s attacker. */
const NOA = { uid: 'uid-noa', memberId: 'noa-levy', role: 'member' as const };
/** expenses own/own, for the matrix-governed half of the D21(d) pair. Name matches the rows below. */
const RAZ = { uid: 'uid-raz', memberId: 'raz-levy', role: 'member' as const };

const ctxFor = (m: { uid: string; memberId: string; role: string }) =>
  testEnv.authenticatedContext(m.uid, { role: m.role, memberId: m.memberId });
/** Signed in with NO custom claims — an Auth user created but never provisioned. */
const claimlessCtx = () => testEnv.authenticatedContext('uid-claimless', {});
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

/** A valid assumption body. Every denial below differs from this by exactly one thing. */
const assumption = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'fa-x',
  ownerId: MAYA.memberId,
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
  scopeKind: 'category',
  scopeId: 'מסעדות',
  fromPeriod: '2026-09',
  amountILS: 1200,
  reasonHe: 'החלטנו לצמצם',
  source: 'user',
  status: 'active',
  ...over,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-familyfinance-forecast-rules-test',
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
    // No resolvedPermissions AT ALL — the zero-permission child.
    await setDoc(doc(db, 'members', OMER.memberId), member(OMER.memberId, 'עומר', 'ילד', OMER.uid));
    await setDoc(doc(db, 'members', MAYA.memberId), member(MAYA.memberId, 'מאיה', 'ילד', MAYA.uid, ALL_FAMILY));
    await setDoc(
      doc(db, 'members', NOA.memberId),
      member(NOA.memberId, 'נועה', 'ילד', NOA.uid, {
        expenses: { view: 'family', edit: 'family' },
        forecast: { view: 'family', edit: 'family' },
        loans: { view: 'none', edit: 'none' },
        insurances: { view: 'none', edit: 'none' },
        recurring: { view: 'none', edit: 'none' },
      })
    );
    await setDoc(
      doc(db, 'members', RAZ.memberId),
      member(RAZ.memberId, 'רז', 'ילד', RAZ.uid, { expenses: { view: 'own', edit: 'own' } })
    );

    // ── forecast_assumptions fixtures ──────────────────────────────────────────────────────
    await setDoc(doc(db, 'forecast_assumptions', 'fa-maya'), assumption({ id: 'fa-maya' }));
    await setDoc(
      doc(db, 'forecast_assumptions', 'fa-lilit'),
      assumption({ id: 'fa-lilit', ownerId: LILIT.memberId, reasonHe: 'שכר הדירה עולה' })
    );
    await setDoc(
      doc(db, 'forecast_assumptions', 'fa-omer-target'),
      assumption({
        id: 'fa-omer-target',
        ownerId: OMER.memberId,
        scopeKind: 'personalTarget',
        scopeId: OMER.memberId,
        amountILS: 500,
        reasonHe: 'היעד שלי לחודש',
      })
    );

    // ── transaction_lines fixtures for D21(d) ─────────────────────────────────────────────
    // NO `period` and NO `ownerId` — the state of EVERY row on the real tree at T2 time.
    await setDoc(doc(db, 'transaction_lines', 'tl-no-period'), {
      id: 'tl-no-period', owner: 'רז', amount: 250, date: '2026-03-09',
      description: 'סופר', category: 'מזון', createdAt: 'x', updatedAt: 'x',
    });
    await setDoc(doc(db, 'transaction_lines', 'tl-no-period-lilit'), {
      id: 'tl-no-period-lilit', owner: 'לילית', amount: 900, date: '2026-03-11',
      description: 'דלק', category: 'תחבורה', createdAt: 'x', updatedAt: 'x',
    });
    // …and one that HAS both, i.e. the state after T3's backfill.
    await setDoc(doc(db, 'transaction_lines', 'tl-stamped'), {
      id: 'tl-stamped', owner: 'לילית', amount: 900, date: '2026-03-11', period: '2026-03',
      ownerId: LILIT.memberId, description: 'דלק', category: 'תחבורה', createdAt: 'x', updatedAt: 'x',
    });
  });
});

const faDoc = (db: ReturnType<ReturnType<typeof ctxFor>['firestore']>, id: string) =>
  doc(db, 'forecast_assumptions', id);

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 1. THE SESSION × OPERATION MATRIX
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('forecast_assumptions — read', () => {
  it('super-admin and parent read every assumption', async () => {
    for (const who of [DAVID, LILIT]) {
      const db = ctxFor(who).firestore();
      for (const id of ['fa-maya', 'fa-lilit', 'fa-omer-target']) {
        await assertSucceeds(getDoc(faDoc(db, id)));
      }
    }
  });

  it("a member with forecast: 'family' reads every assumption", async () => {
    const db = ctxFor(MAYA).firestore();
    for (const id of ['fa-maya', 'fa-lilit', 'fa-omer-target']) {
      await assertSucceeds(getDoc(faDoc(db, id)));
    }
  });

  it('a ZERO-PERMISSION child reads NOTHING — except the personalTarget they own (A30)', async () => {
    const db = ctxFor(OMER).firestore();
    await assertFails(getDoc(faDoc(db, 'fa-maya')));
    await assertFails(getDoc(faDoc(db, 'fa-lilit')));
    await assertSucceeds(getDoc(faDoc(db, 'fa-omer-target')));
  });

  it('unauthenticated and claimless sessions read nothing at all', async () => {
    for (const db of [anonCtx().firestore(), claimlessCtx().firestore()]) {
      for (const id of ['fa-maya', 'fa-lilit', 'fa-omer-target']) {
        await assertFails(getDoc(faDoc(db, id)));
      }
    }
  });
});

describe('forecast_assumptions — create', () => {
  it('super-admin, parent and a forecast-granted member each create their own', async () => {
    for (const who of [DAVID, LILIT, MAYA, NOA]) {
      const db = ctxFor(who).firestore();
      await assertSucceeds(
        setDoc(faDoc(db, `new-${who.memberId}`), assumption({ id: `new-${who.memberId}`, ownerId: who.memberId }))
      );
    }
  });

  it('!! A FULL-MATRIX MEMBER CANNOT CREATE AN ASSUMPTION OWNED BY SOMEBODY ELSE', async () => {
    // maya-levy holds view+edit 'family' on EVERY module including forecast — the strongest
    // non-privileged session this app can produce. The gate is role-driven, not matrix-driven.
    const db = ctxFor(MAYA).firestore();
    await assertFails(
      setDoc(faDoc(db, 'spoofed-parent'), assumption({ id: 'spoofed-parent', ownerId: LILIT.memberId }))
    );
    await assertFails(
      setDoc(faDoc(db, 'spoofed-child'), assumption({ id: 'spoofed-child', ownerId: OMER.memberId }))
    );
    // …and the same session writing as ITSELF is allowed, so the denial is about attribution and
    // not about the session being unable to write at all.
    await assertSucceeds(setDoc(faDoc(db, 'own-one'), assumption({ id: 'own-one' })));
  });

  it('a parent MAY create an assumption owned by another member — the bypass is deliberate', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(
      setDoc(faDoc(db, 'parent-for-child'), assumption({ id: 'parent-for-child', ownerId: OMER.memberId }))
    );
  });

  it('a ZERO-PERMISSION child creates ONLY a self-owned personalTarget (A30, as amended)', async () => {
    const db = ctxFor(OMER).firestore();
    const target = (over: Record<string, unknown>) =>
      assumption({ ownerId: OMER.memberId, scopeKind: 'personalTarget', scopeId: OMER.memberId, ...over });

    await assertSucceeds(setDoc(faDoc(db, 'omer-new-target'), target({ id: 'omer-new-target' })));
    // Any other scopeKind needs a forecast grant, which a member's default level does not give.
    await assertFails(setDoc(faDoc(db, 'omer-category'), assumption({ id: 'omer-category', ownerId: OMER.memberId })));
    // …and a personalTarget owned by SOMEBODY ELSE is not "their own target".
    await assertFails(
      setDoc(faDoc(db, 'omer-other-target'), target({ id: 'omer-other-target', ownerId: MAYA.memberId }))
    );
  });

  it('!! forecast: none STILL CANNOT AUTHOR, even when the SCOPE check would pass', async () => {
    // FOUND BY THE MUTATION SWEEP, NOT BY DESIGN. Neutering the `forecast.edit != 'none'` gate
    // left the whole 186-test rules suite green, because every session that was being denied was
    // being denied by the AUTHORSHIP check first — the zero-permission child fails
    // `myLevel('expenses','view') != 'none'` before the forecast level is ever consulted. A guard
    // shadowed by another guard that refuses first is the exact shape D29's own note warns about,
    // and the only way to see it is a session where the cheap check PASSES.
    //
    // raz-levy holds expenses own/own — so the scope check passes — and NO forecast grant at all.
    const db = ctxFor(RAZ).firestore();
    await assertFails(
      setDoc(faDoc(db, 'raz-category'), assumption({ id: 'raz-category', ownerId: RAZ.memberId }))
    );
    // …and the one thing a member may always do without a grant still works (A30).
    await assertSucceeds(
      setDoc(
        faDoc(db, 'raz-target'),
        assumption({ id: 'raz-target', ownerId: RAZ.memberId, scopeKind: 'personalTarget', scopeId: RAZ.memberId })
      )
    );
  });

  it('unauthenticated and claimless sessions create nothing', async () => {
    for (const db of [anonCtx().firestore(), claimlessCtx().firestore()]) {
      await assertFails(setDoc(faDoc(db, 'anon-one'), assumption({ id: 'anon-one' })));
    }
  });
});

describe('forecast_assumptions — update, set-over-existing, and delete', () => {
  it('a member updates their own and is denied another member’s', async () => {
    const db = ctxFor(MAYA).firestore();
    await assertSucceeds(updateDoc(faDoc(db, 'fa-maya'), { amountILS: 900, updatedAt: 'y' }));
    await assertFails(updateDoc(faDoc(db, 'fa-lilit'), { amountILS: 900, updatedAt: 'y' }));
  });

  it('SET OVER AN EXISTING DOC is an update and is gated the same way — not a create', async () => {
    const db = ctxFor(MAYA).firestore();
    await assertSucceeds(setDoc(faDoc(db, 'fa-maya'), assumption({ id: 'fa-maya', amountILS: 1 })));
    await assertFails(
      setDoc(faDoc(db, 'fa-lilit'), assumption({ id: 'fa-lilit', ownerId: MAYA.memberId }))
    );
  });

  it('ownerId is immutable on update — for a member AND for a parent, with no bypass', async () => {
    const memberDb = ctxFor(MAYA).firestore();
    await assertFails(updateDoc(faDoc(memberDb, 'fa-maya'), { ownerId: LILIT.memberId, updatedAt: 'y' }));
    // The half the accounts/recurring/loans/insurances precedent would have let through: those
    // collections put the ownerId check behind `isSuperAdmin() || isParent()`. This one does not.
    const parentDb = ctxFor(LILIT).firestore();
    await assertFails(updateDoc(faDoc(parentDb, 'fa-maya'), { ownerId: OMER.memberId, updatedAt: 'y' }));
    await assertFails(updateDoc(faDoc(ctxFor(DAVID).firestore(), 'fa-maya'), { ownerId: OMER.memberId, updatedAt: 'y' }));
    // …and an ordinary parent edit that leaves ownerId alone still works.
    await assertSucceeds(updateDoc(faDoc(parentDb, 'fa-maya'), { amountILS: 42, updatedAt: 'y' }));
  });

  it('delete follows the same ownership gate, and the zero-permission child can delete their own target', async () => {
    await assertSucceeds(deleteDoc(faDoc(ctxFor(MAYA).firestore(), 'fa-maya')));
    await assertFails(deleteDoc(faDoc(ctxFor(MAYA).firestore(), 'fa-lilit')));
    await assertSucceeds(deleteDoc(faDoc(ctxFor(OMER).firestore(), 'fa-omer-target')));
    await assertFails(deleteDoc(faDoc(ctxFor(OMER).firestore(), 'fa-lilit')));
    await assertSucceeds(deleteDoc(faDoc(ctxFor(LILIT).firestore(), 'fa-lilit')));
    for (const db of [anonCtx().firestore(), claimlessCtx().firestore()]) {
      await assertFails(deleteDoc(faDoc(db, 'fa-maya')));
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 2. THE VALIDATOR — one case per field, and the Stage 8 seam
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('isValidForecastAssumption', () => {
  const asDavid = () => ctxFor(DAVID).firestore();

  it("REFUSES source: 'insight' — the Stage 8 seam is enforced, not scanned (D25b)", async () => {
    // Denied even for a SUPER-ADMIN, because the seam is about which writer exists, not who is
    // asking. Stage 8 widens this literal in the same commit that ships the insight writer.
    await assertFails(
      setDoc(faDoc(asDavid(), 'insight-one'), assumption({ id: 'insight-one', source: 'insight', insightId: 'i-1' }))
    );
    await assertFails(setDoc(faDoc(ctxFor(MAYA).firestore(), 'insight-two'), assumption({ id: 'insight-two', source: 'insight' })));
  });

  it('refuses a malformed period — a LENGTH check would have passed three of these', async () => {
    for (const fromPeriod of ['2026-13', '2026-00', '2026-9', '202609', 'unknown', '9999-99', '2026-9x', '']) {
      await assertFails(setDoc(faDoc(asDavid(), 'p'), assumption({ id: 'p', fromPeriod })));
    }
    await assertSucceeds(setDoc(faDoc(asDavid(), 'p-ok'), assumption({ id: 'p-ok', fromPeriod: '2026-12' })));
    await assertFails(setDoc(faDoc(asDavid(), 'p2'), assumption({ id: 'p2', toPeriod: '2026-13' })));
    await assertSucceeds(setDoc(faDoc(asDavid(), 'p2-ok'), assumption({ id: 'p2-ok', toPeriod: '2027-01' })));
  });

  it('refuses an empty or missing reasonHe, a negative amount, and a bogus status or scopeKind', async () => {
    await assertFails(setDoc(faDoc(asDavid(), 'r'), assumption({ id: 'r', reasonHe: '' })));
    await assertFails(setDoc(faDoc(asDavid(), 'r2'), { ...assumption({ id: 'r2' }), reasonHe: null }));
    await assertFails(setDoc(faDoc(asDavid(), 'a'), assumption({ id: 'a', amountILS: -1 })));
    await assertFails(setDoc(faDoc(asDavid(), 'a2'), assumption({ id: 'a2', amountILS: 'לא מספר' })));
    await assertFails(setDoc(faDoc(asDavid(), 's'), assumption({ id: 's', status: 'draft' })));
    await assertFails(setDoc(faDoc(asDavid(), 'k'), assumption({ id: 'k', scopeKind: 'whatever' })));
    await assertFails(setDoc(faDoc(asDavid(), 'o'), assumption({ id: 'o', ownerId: '' })));
    await assertFails(setDoc(faDoc(asDavid(), 'sc'), assumption({ id: 'sc', scopeId: '' })));
  });

  it('bounds a seasonality factor by SEASONAL_FACTOR_MIN/MAX — the F1 lesson, in Rules (D24)', async () => {
    const seasonal = (over: Record<string, unknown>) =>
      assumption({ scopeKind: 'seasonality', scopeId: 'מזון:09', ...over });
    await assertFails(setDoc(faDoc(asDavid(), 'f1'), seasonal({ id: 'f1', factor: 0.09 })));
    await assertFails(setDoc(faDoc(asDavid(), 'f2'), seasonal({ id: 'f2', factor: 5.01 })));
    await assertFails(setDoc(faDoc(asDavid(), 'f3'), seasonal({ id: 'f3', factor: 1e9 })));
    await assertFails(setDoc(faDoc(asDavid(), 'f4'), seasonal({ id: 'f4', factor: 'הרבה' })));
    await assertFails(setDoc(faDoc(asDavid(), 'f5'), seasonal({ id: 'f5' }))); // factor absent
    await assertSucceeds(setDoc(faDoc(asDavid(), 'f6'), seasonal({ id: 'f6', factor: 0.1 })));
    await assertSucceeds(setDoc(faDoc(asDavid(), 'f7'), seasonal({ id: 'f7', factor: 5 })));
    await assertSucceeds(setDoc(faDoc(asDavid(), 'f8'), seasonal({ id: 'f8', factor: 1.3 })));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 3. AUTHORSHIP — one case per scopeKind (D25c)
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('an author must be able to see the module their assumption scopes (D25c)', () => {
  const SCOPES: Array<[string, string]> = [
    ['recurring', 'rec-1'],
    ['loan', 'loan-1'],
    ['insurance', 'ins-1'],
    ['category', 'מסעדות'],
    ['seasonality', 'מזון:09'],
  ];

  it('the full-matrix member may author every scopeKind, for themselves', async () => {
    const db = ctxFor(MAYA).firestore();
    for (const [scopeKind, scopeId] of SCOPES) {
      const extra = scopeKind === 'seasonality' ? { factor: 1.3 } : {};
      await assertSucceeds(
        setDoc(faDoc(db, `maya-${scopeKind}`), assumption({ id: `maya-${scopeKind}`, scopeKind, scopeId, ...extra }))
      );
    }
    await assertSucceeds(
      setDoc(
        faDoc(db, 'maya-target'),
        assumption({ id: 'maya-target', scopeKind: 'personalTarget', scopeId: MAYA.memberId })
      )
    );
  });

  it('!! forecast: family + loans: none CANNOT author a loan-scoped assumption', async () => {
    // The injection vector D25(c) exists to close: an assumption over a loan the author cannot
    // read, with free-text reasonHe rendering on a parent's screen.
    const db = ctxFor(NOA).firestore();
    for (const scopeKind of ['loan', 'insurance', 'recurring']) {
      await assertFails(
        setDoc(faDoc(db, `noa-${scopeKind}`), assumption({ id: `noa-${scopeKind}`, ownerId: NOA.memberId, scopeKind, scopeId: 'x-1' }))
      );
    }
    // …and the scopes they CAN see are still authorable, so the check is not a blanket denial.
    await assertSucceeds(
      setDoc(faDoc(db, 'noa-category'), assumption({ id: 'noa-category', ownerId: NOA.memberId }))
    );
    await assertSucceeds(
      setDoc(
        faDoc(db, 'noa-seasonality'),
        assumption({ id: 'noa-seasonality', ownerId: NOA.memberId, scopeKind: 'seasonality', scopeId: 'מזון:09', factor: 1.3 })
      )
    );
  });

  it('a parent authors any scope regardless of their own matrix rows', async () => {
    const db = ctxFor(LILIT).firestore();
    for (const [scopeKind, scopeId] of SCOPES) {
      const extra = scopeKind === 'seasonality' ? { factor: 1.3 } : {};
      await assertSucceeds(
        setDoc(
          faDoc(db, `lilit-${scopeKind}`),
          assumption({ id: `lilit-${scopeKind}`, ownerId: LILIT.memberId, scopeKind, scopeId, ...extra })
        )
      );
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 4. D21(d) — period/ownerId immutability on transaction_lines, ASSERTED AS A PARENT
// ═════════════════════════════════════════════════════════════════════════════════════════════

const tlDoc = (db: ReturnType<ReturnType<typeof ctxFor>['firestore']>, id: string) =>
  doc(db, 'transaction_lines', id);

describe('D21(d) — period and ownerId are immutable, and a row with NEITHER is still editable', () => {
  it('!! A PARENT CAN STILL EDIT A ROW THAT HAS NO period — the app is usable between T2 and T3', async () => {
    // THE HALF A BARE `resource.data.period == request.resource.data.period` WOULD HAVE BROKEN.
    // No row on the real tree has `period` at T2 time; a missing map key is an ERROR in Rules and
    // an error in an `&&` chain DENIES, so the naive shape would have denied EVERY matrix-governed
    // edit to EVERY transaction until T3's backfill ran. Without this assertion the guard reads as
    // correct and denies everything.
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(updateDoc(tlDoc(db, 'tl-no-period-lilit'), { amount: 1000, updatedAt: 'y' }));
    await assertSucceeds(updateDoc(tlDoc(db, 'tl-no-period-lilit'), { description: 'דלק ותחזוקה' }));
    await assertSucceeds(updateDoc(tlDoc(db, 'tl-no-period-lilit'), { category: 'רכב' }));
  });

  it('!! THE SAME UPDATE WITH period CHANGED FAILS — as a PARENT, the bypass-eligible role', async () => {
    const db = ctxFor(LILIT).firestore();
    // Adding the field to a row that lacked it is denied too: `period` is stamped by the backfill
    // and by the constructors at create time, never by an edit.
    await assertFails(updateDoc(tlDoc(db, 'tl-no-period-lilit'), { amount: 1000, period: '2026-03' }));
    await assertFails(updateDoc(tlDoc(db, 'tl-no-period-lilit'), { ownerId: LILIT.memberId }));
    // …and on a row that HAS them, changing either is denied.
    await assertFails(updateDoc(tlDoc(db, 'tl-stamped'), { period: '2026-04', updatedAt: 'y' }));
    await assertFails(updateDoc(tlDoc(db, 'tl-stamped'), { ownerId: OMER.memberId, updatedAt: 'y' }));
    // …while an ordinary edit that leaves both alone still succeeds.
    await assertSucceeds(updateDoc(tlDoc(db, 'tl-stamped'), { amount: 950, updatedAt: 'y' }));
  });

  it('a set-over-existing that DROPS period is denied too — removal is a change', async () => {
    // `setDoc` without `period` is how the field would actually disappear: a screen that does not
    // know about it overwriting the whole document. Denied for a parent and for a super-admin.
    const body = {
      id: 'tl-stamped', owner: 'לילית', amount: 900, date: '2026-03-11',
      description: 'דלק', category: 'תחבורה', createdAt: 'x', updatedAt: 'y',
    };
    await assertFails(setDoc(tlDoc(ctxFor(LILIT).firestore(), 'tl-stamped'), body));
    await assertFails(setDoc(tlDoc(ctxFor(DAVID).firestore(), 'tl-stamped'), body));
    // …and the same set WITH both fields preserved succeeds.
    await assertSucceeds(
      setDoc(tlDoc(ctxFor(LILIT).firestore(), 'tl-stamped'), { ...body, period: '2026-03', ownerId: LILIT.memberId })
    );
  });

  it('a matrix-governed member sees the same rule — the check is not only on the parent path', async () => {
    // raz-levy holds expenses own/own and the row's `owner` is their display name, so they reach
    // the POST-IMAGE branch rather than the parent bypass. Both halves of the pair, on that branch.
    const db = ctxFor(RAZ).firestore();
    await assertSucceeds(updateDoc(tlDoc(db, 'tl-no-period'), { amount: 300, date: '2026-03-09' }));
    await assertFails(updateDoc(tlDoc(db, 'tl-no-period'), { amount: 300, date: '2026-03-09', period: '2026-03' }));
    await assertFails(updateDoc(tlDoc(db, 'tl-no-period'), { amount: 300, date: '2026-03-09', ownerId: RAZ.memberId }));
  });

  it('create is untouched — a row is still created without period, which is what T3 backfills', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(
      setDoc(tlDoc(db, 'tl-new'), {
        id: 'tl-new', owner: 'לילית', amount: 100, date: '2026-04-01',
        description: 'קפה', category: 'מזון', createdAt: 'x', updatedAt: 'x',
      })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 5. INHERITED CLOSURE — audit_log.at IS A STRING, IN EVERY WRITER
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('isValidAuditEntry’s `at is string` (Stage 7 T2 inherited closure)', () => {
  // The finding as inherited: "isValidAuditEntry requires `at is string` while both server writers
  // use serverTimestamp() — the rule can never have validated a server-written entry". Both halves
  // are true, and the second half is true of ANY Admin-SDK write, because the Admin SDK bypasses
  // Rules entirely. So the rule was never the thing that was broken.
  //
  // What WAS broken is real and worse: `audit_log.at` held TWO TYPES, a string from every client
  // writer and a Timestamp from costGate.ts and setAiCostCeiling.ts, on the collection whose whole
  // purpose is being readable after the fact. Both server writers now emit an ISO string (held by
  // their own unit tests). These two cases hold the CLIENT side of the same contract — and the
  // denial below is not academic: `writeAuditLog` rides in the same batch as the write it
  // describes, and Firestore batches are all-or-nothing, so a `serverTimestamp()` `at` would sink
  // the financial write beside it, which is D7's recorded failure mode exactly.
  it('accepts an ISO-string `at` from a client writer', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'audit_log', 'log-string-at'), {
        actorMemberId: LILIT.memberId, action: 'forecastAssumption.save',
        target: 'forecast_assumptions/fa-lilit', at: new Date().toISOString(),
      })
    );
  });

  it('DENIES a serverTimestamp() `at` — and would sink the whole batch it rides in', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertFails(
      setDoc(doc(db, 'audit_log', 'log-ts-at'), {
        actorMemberId: LILIT.memberId, action: 'forecastAssumption.save',
        target: 'forecast_assumptions/fa-lilit', at: serverTimestamp(),
      })
    );
  });
});
