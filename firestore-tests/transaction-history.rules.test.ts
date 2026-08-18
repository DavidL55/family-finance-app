// Stage 7 T3 — the scope-aware history read path, and THE PROOF THAT THE BACKFILL CANNOT RUN
// THROUGH A CLIENT SESSION.
//
// ── 1. THE REPRODUCTION, KEPT (method table: "reproduce before fixing; keep the reproduction") ──
//
// An `expenses: 'own'` viewer issuing `getDocs(collection(db,'transaction_lines'))` is DENIED, and
// the mocked root suite cannot see it — `src/__tests__/setup.ts` mocks `firebase/firestore`, so
// every query shape there succeeds by construction. This is the same class of defect Stage 3's D1
// regression found on `accounts`/`recurring`/`loans`/`insurances` (finance-modules.rules.test.ts,
// "D1 regression"): the rule always permitted per-document 'own' access, and the client simply
// never issued a query shape Firestore's list-time verification could accept, so it denied the
// whole list wholesale. `transaction_lines` is the LAST collection still in that state, and it is
// the one the forecast's statistical layer reads.
//
// ── 2. WHY `ownerId` AND NOT `owner` (D21a) ──────────────────────────────────────────────────
//
// `transaction_lines.owner` is a DISPLAY NAME. `expensesAllowed`'s 'own' branch compared it to
// `myMember().name`, so the only client-side query that could satisfy it was
// `where('owner','==','לילית')` — a query keyed on a mutable label. Renaming a member silently
// denies their own history and D26 then renders that as the reassuring "not enough history yet".
// D21(a) widens the rule to `data.ownerId == memberId() || data.owner == myMember().name`:
// STRICTLY ADDITIVE — it removes no access, which the "row with `owner` and no `ownerId` is still
// readable by name" case below is what actually proves.
//
// ── 3. !! THE ADMIN-SDK NECESSITY — THE THING THAT STOPS THE BACKFILL BEFORE IT STARTS ────────
//
// D21(d) (shipped in T2) makes `period`/`ownerId` immutable as CONJUNCTS OF `allow update` ITSELF,
// outside the `isSuperAdmin() || isParent() || (…)` alternation. Its `.get(field, null)` shape
// denies ADDING the field to a row that lacked it — deliberately, because that is the only thing
// that stops `period` ever diverging from `date`. Nothing in the app performs a live
// `transaction_lines` update, so nothing breaks.
//
// THE BACKFILL IS EXACTLY SUCH AN UPDATE. It exists to add `period`/`ownerId` to every existing
// row. Run through any client session — INCLUDING THE SUPER-ADMIN'S, the strongest session this
// app can produce — it denies itself on its first write. Nothing in the plan, the adjudication or
// T0 says this out loud; the T2 review found it by reading the rule it had just shipped.
//
// The pair below is the executable form of that: the backfill's exact operation is DENIED to a
// super-admin client, and SUCCEEDS through a rules-bypassing context — which is what
// `firebase-admin` gives `scripts/backfill-transaction-periods.ts`, exactly as
// `scripts/migrate-transactions.ts`'s own header already records for the same trust boundary.
// If a future change makes the client write succeed, THIS TEST GOES RED — and it should, because
// a client-writable `period` is a `period` that can diverge from `date`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const DAVID = { uid: 'uid-david', memberId: 'david-levy', role: 'super-admin' as const };
const LILIT = { uid: 'uid-lilit', memberId: 'lilit-levy', role: 'parent' as const };
/** expenses own/own — the viewer the whole read path exists for. */
const OMER = { uid: 'uid-omer', memberId: 'omer-levy', role: 'member' as const };
/** expenses family/family, matrix-governed — the unconstrained scan must work for them. */
const MAYA = { uid: 'uid-maya', memberId: 'maya-levy', role: 'member' as const };

const ctxFor = (m: { uid: string; memberId: string; role: string }) =>
  testEnv.authenticatedContext(m.uid, { role: m.role, memberId: m.memberId });

/**
 * The seven values D21(b)/(c) mandate: six periods plus `'unknown'`. Written out here rather than
 * imported so the rules suite stays free of `src/` imports (it runs under the node environment
 * with no Vite), and so the SHAPE the emulator is asked to verify is visible at the call site.
 */
const SIX_PERIODS_PLUS_UNKNOWN = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', 'unknown'];

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-familyfinance-history-rules-test',
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
      resolvedPermissions: { expenses: { view: 'own', edit: 'own' } },
    });
    await setDoc(doc(db, 'members', 'maya-levy'), {
      id: 'maya-levy', name: 'מאיה', role: 'ילד', color: '#663399', groups: [], uid: MAYA.uid,
      createdAt: 'x', updatedAt: 'x',
      resolvedPermissions: { expenses: { view: 'family', edit: 'family' } },
    });

    // STAMPED rows — the post-backfill state.
    await setDoc(doc(db, 'transaction_lines', 'tl-omer-march'), {
      owner: 'עומר', ownerId: 'omer-levy', amount: 50, date: '2026-03-22', period: '2026-03',
      category: 'שונות',
    });
    await setDoc(doc(db, 'transaction_lines', 'tl-omer-april'), {
      owner: 'עומר', ownerId: 'omer-levy', amount: 70, date: '2026-04-02', period: '2026-04',
      category: 'שונות',
    });
    // `period: 'unknown'` is a LIVE path, not a defensive one: T0 proved on this emulator that
    // `date.size() == 10` is a LENGTH check and that a matrix-governed member can create
    // `date: "9999-99-99"`. This row is what the seventh `in` value exists to return.
    await setDoc(doc(db, 'transaction_lines', 'tl-omer-unparseable'), {
      owner: 'עומר', ownerId: 'omer-levy', amount: 12, date: '9999-99-99', period: 'unknown',
      category: 'שונות',
    });
    await setDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), {
      owner: 'לילית', ownerId: 'lilit-levy', amount: 100, date: '2026-03-20', period: '2026-03',
      category: 'בריאות',
    });
    // UNSTAMPED — the state of every row on the real corpus before the backfill runs. It is what
    // the D21(a) additivity case reads, and what the Admin-SDK case tries to stamp.
    await setDoc(doc(db, 'transaction_lines', 'tl-omer-unstamped'), {
      owner: 'עומר', amount: 33, date: '2026-02-11', category: 'שונות',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. THE REPRODUCTION — unconstrained scan denied, scoped shape accepted
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("T3 reproduction — transaction_lines: the 'own' viewer's unconstrained read is denied", () => {
  it('!! THE BUG: an expenses:own viewer issuing a bare getDocs(collection(db,"transaction_lines")) is DENIED', async () => {
    await assertFails(getDocs(collection(ctxFor(OMER).firestore(), 'transaction_lines')));
  });

  it("THE FIX: the same viewer's where(ownerId==me) + where(period in […]) SUCCEEDS and returns only their rows", async () => {
    const snap = await assertSucceeds(
      getDocs(
        query(
          collection(ctxFor(OMER).firestore(), 'transaction_lines'),
          where('ownerId', '==', 'omer-levy'),
          where('period', 'in', SIX_PERIODS_PLUS_UNKNOWN)
        )
      )
    );
    // March + April + the `'unknown'` row. Lilit's March row is excluded by the ownerId
    // constraint, and the UNSTAMPED row is absent because a query on `period` cannot return a
    // document that has no `period` — which is finding 1.2.3, and the whole reason the completion
    // marker has to be a refusal rather than a caveat.
    expect(snap.docs.map((d) => d.id).sort()).toEqual([
      'tl-omer-april', 'tl-omer-march', 'tl-omer-unparseable',
    ]);
  });

  it("the seventh `in` value earns its place: dropping 'unknown' loses the unparseable-date row", async () => {
    const snap = await assertSucceeds(
      getDocs(
        query(
          collection(ctxFor(OMER).firestore(), 'transaction_lines'),
          where('ownerId', '==', 'omer-levy'),
          where('period', 'in', SIX_PERIODS_PLUS_UNKNOWN.filter((p) => p !== 'unknown'))
        )
      )
    );
    expect(snap.docs.map((d) => d.id).sort()).toEqual(['tl-omer-april', 'tl-omer-march']);
  });

  it("an 'own' viewer constraining ownerId to SOMEONE ELSE is denied — the constraint is not a filter", async () => {
    await assertFails(
      getDocs(
        query(
          collection(ctxFor(OMER).firestore(), 'transaction_lines'),
          where('ownerId', '==', 'lilit-levy'),
          where('period', 'in', SIX_PERIODS_PLUS_UNKNOWN)
        )
      )
    );
  });

  it("an 'own' viewer with ONLY the period clause and no owner constraint is denied", async () => {
    // The period clause alone proves nothing about ownership, so list-time verification cannot
    // accept it. This is what makes `where('ownerId','==',me)` load-bearing rather than cosmetic.
    await assertFails(
      getDocs(
        query(
          collection(ctxFor(OMER).firestore(), 'transaction_lines'),
          where('period', 'in', SIX_PERIODS_PLUS_UNKNOWN)
        )
      )
    );
  });

  it("a matrix-governed expenses:family viewer's period-only query SUCCEEDS across owners", async () => {
    const snap = await assertSucceeds(
      getDocs(
        query(
          collection(ctxFor(MAYA).firestore(), 'transaction_lines'),
          where('period', 'in', SIX_PERIODS_PLUS_UNKNOWN)
        )
      )
    );
    expect(snap.docs.map((d) => d.id).sort()).toEqual([
      'tl-lilit-march', 'tl-omer-april', 'tl-omer-march', 'tl-omer-unparseable',
    ]);
  });

  it('a parent — the Rules bypass — reads the whole collection unconstrained, as before', async () => {
    const snap = await assertSucceeds(getDocs(collection(ctxFor(LILIT).firestore(), 'transaction_lines')));
    expect(snap.size).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. D21(a) IS STRICTLY ADDITIVE
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('D21(a) — widening expensesAllowed to ownerId removes no access', () => {
  it('a row carrying only the DISPLAY NAME and no ownerId is still readable by its owner', async () => {
    // The half that proves "strictly additive" rather than "replaced". Every row on the real
    // corpus is in exactly this state until the backfill runs, and an 'own' viewer must not lose
    // sight of their own history in the window between this task's rules deploy and its backfill.
    const snap = await assertSucceeds(
      getDoc(doc(ctxFor(OMER).firestore(), 'transaction_lines', 'tl-omer-unstamped'))
    );
    expect(snap.data()?.amount).toBe(33);
  });

  it("a row belonging to someone else is still denied by name, with no ownerId anywhere in play", async () => {
    await assertFails(getDoc(doc(ctxFor(OMER).firestore(), 'transaction_lines', 'tl-lilit-march')));
  });

  it('the new branch grants on ownerId ALONE — a row whose display name does NOT match is readable', async () => {
    // The non-vacuity half: without D21(a)'s new disjunct this read is denied, because `owner`
    // holds a stale display name. This is the rename case the whole change exists for.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'transaction_lines', 'tl-renamed'), {
        owner: 'עומר הישן', ownerId: 'omer-levy', amount: 15, date: '2026-05-01', period: '2026-05',
      });
    });
    const snap = await assertSucceeds(
      getDoc(doc(ctxFor(OMER).firestore(), 'transaction_lines', 'tl-renamed'))
    );
    expect(snap.data()?.amount).toBe(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. THE ADMIN-SDK NECESSITY
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('!! the backfill must bypass Rules — D21(d) denies the write the backfill exists to make', () => {
  it("a SUPER-ADMIN client session cannot add `period` to an existing row — the strongest session there is", async () => {
    // Not a parent (T2 already asserts that case) — the SUPER-ADMIN, because "run the backfill as
    // David" is the obvious thing to reach for and it is the thing that does not work. The two
    // `.get(field,null)` conjuncts sit OUTSIDE the `isSuperAdmin() || isParent() || (…)`
    // alternation, so the bypass does not reach them.
    const db = ctxFor(DAVID).firestore();
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tl-omer-unstamped'), { period: '2026-02' }));
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tl-omer-unstamped'), { ownerId: 'omer-levy' }));
    await assertFails(
      updateDoc(doc(db, 'transaction_lines', 'tl-omer-unstamped'), {
        period: '2026-02', ownerId: 'omer-levy',
      })
    );
  });

  it('a set-over-existing carrying both fields is denied too — the other shape a backfill might use', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(
      setDoc(doc(db, 'transaction_lines', 'tl-omer-unstamped'), {
        owner: 'עומר', amount: 33, date: '2026-02-11', category: 'שונות',
        period: '2026-02', ownerId: 'omer-levy',
      })
    );
  });

  it('the SAME write through a rules-bypassing context SUCCEEDS — which is what firebase-admin gives the script', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await assertSucceeds(
        updateDoc(doc(ctx.firestore(), 'transaction_lines', 'tl-omer-unstamped'), {
          period: '2026-02', ownerId: 'omer-levy',
        })
      );
    });
    // And the stamped row is then readable through the scoped 'own' shape — the backfill's whole
    // point: a row invisible to the query before it ran is returned after.
    const snap = await assertSucceeds(
      getDocs(
        query(
          collection(ctxFor(OMER).firestore(), 'transaction_lines'),
          where('ownerId', '==', 'omer-levy'),
          where('period', 'in', SIX_PERIODS_PLUS_UNKNOWN)
        )
      )
    );
    expect(snap.docs.map((d) => d.id)).toContain('tl-omer-unstamped');
  });

  it('an ordinary edit that touches NEITHER field is still allowed — the backfill is denied, the app is not', async () => {
    // The paired half. Without it, "the backfill must bypass Rules" would be indistinguishable
    // from "the rule denies every update", which is the failure mode `.get(field, null)` exists to
    // avoid and which no assertion of the denial alone can rule out.
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(updateDoc(doc(db, 'transaction_lines', 'tl-omer-unstamped'), { amount: 34 }));
    await assertSucceeds(updateDoc(doc(db, 'transaction_lines', 'tl-omer-march'), { amount: 51 }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. T3 REVIEW F1 — THE STATE THE BACKFILL USED TO CRASH ON IS NO LONGER CLIENT-REACHABLE
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `backfillPlan` is now total on a non-string `date`/`owner` (that is the fix, and it is where the
// contract lives). These rules are the OTHER half: the app-side fix makes the bad state readable,
// this makes it unwritable. Both halves matter because the app-side guard protects one reader and
// the rule protects every reader that has not been written yet — T5's statistical layer reads the
// same two fields off the same rows.
//
// Both vectors were PROVEN LIVE by the T3 review before being closed, and both are asserted here
// as the sessions that could actually reach them: a SUPER-ADMIN create (`owner` had no type check
// at all) and a PARENT update (the `isSuperAdmin() || isParent()` alternation bypasses the
// `date is string` re-validation).
describe('T3 review F1 — a non-string date/owner is refused at the rule, not only at the reader', () => {
  it('!! A SUPER-ADMIN CANNOT CREATE owner: 12345 — the exact create the review reproduced', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(
      setDoc(doc(db, 'transaction_lines', 'tl-numeric-owner'), {
        owner: 12345, ownerId: 'david-levy', amount: 10, date: '2026-03-01', category: 'שונות',
      })
    );
  });

  it('…and a matrix-governed member cannot either', async () => {
    const db = ctxFor(MAYA).firestore();
    await assertFails(
      setDoc(doc(db, 'transaction_lines', 'tl-numeric-owner-maya'), {
        owner: ['מאיה'], ownerId: 'maya-levy', amount: 10, date: '2026-03-01', category: 'שונות',
      })
    );
  });

  it('!! A PARENT CANNOT UPDATE date TO 12345 — T0 proved they could, through the parent bypass', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), { date: 12345 }));
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), { owner: 12345 }));
  });

  it('a super-admin cannot either — nobody bypasses the TYPE check, same footing as D21(d)', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), { date: { seconds: 1 } }));
  });

  it('!! AND THE NEGATIVE THAT MAKES THE SHAPE PROVABLE — an ordinary edit is still allowed', async () => {
    // Without this half, "the rule refuses a non-string date" is indistinguishable from "the rule
    // refuses every update", which is the failure `.get(field, default)` exists to avoid and which
    // the assertion above alone cannot rule out.
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(updateDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), { amount: 111 }));
    await assertSucceeds(updateDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), { owner: 'לילית לוי' }));
    await assertSucceeds(updateDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), { date: '2026-03-21' }));
  });

  it('a row that has NO owner at all is still editable — the defaulted accessor, not a bare one', async () => {
    // The D21(d) lesson applied to the new conjuncts: a bare `request.resource.data.owner is
    // string` on a row lacking the field is an ERROR, and an error in an `&&` chain DENIES.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'transaction_lines', 'tl-ownerless'), {
        amount: 5, date: '2026-03-05', category: 'שונות',
      });
    });
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(updateDoc(doc(db, 'transaction_lines', 'tl-ownerless'), { amount: 6 }));
  });

  it('a create with a string owner is still allowed for every session that could create before', async () => {
    await assertSucceeds(
      setDoc(doc(ctxFor(DAVID).firestore(), 'transaction_lines', 'tl-ok-david'), {
        owner: 'דויד', ownerId: 'david-levy', amount: 10, date: '2026-03-01', category: 'שונות',
      })
    );
    await assertSucceeds(
      setDoc(doc(ctxFor(MAYA).firestore(), 'transaction_lines', 'tl-ok-maya'), {
        owner: 'מאיה', ownerId: 'maya-levy', amount: 10, date: '2026-03-01', category: 'שונות',
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4b. T4 REVIEW F-1 — `.get(field, '')` IS SATISFIED BY ABSENCE, SO DELETION PASSED
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// The fix batch closed the TYPE half of this rule and wrote, in the rules file itself: "what they
// may no longer do is leave a field holding something no reader of this collection can read." That
// sentence was defeated by `deleteField()`. `request.resource.data.get('date', '')` defaults an
// ABSENT field to `''`, and `''` is a string — so stripping the field passes a check written to
// stop the field being unreadable. The T4 review's live probe left a row at
// `{ownerId, period, category}`: no date, no owner, no amount, with `period` intact because
// D21(d)'s `.get(f, null) == .get(f, null)` shape already denies deleting THAT.
//
// The verified consequence is the reason it is blocking rather than cosmetic: such a row PASSES
// `isExpenseRow` — which reads `category` and `isCredit` and never looks at `amount` — and so it
// reaches T5's moving average, where `sum + undefined` is `NaN` and the headline projected balance
// renders as `NaN`. That is the exact failure the whole stage exists to prevent, and this is one
// `updateDoc` from any parent.
//
// THE SHAPE: presence is preserved, not required. `resource.data.get(f, null) == null ||
// request.resource.data.get(f, null) != null` — a row that never had the field may stay without it
// (the unstamped rows the backfill has not reached still have to be editable, which is the exact
// lesson D21(d) records), and a row that HAS it may not have it taken away.
describe('T4 review F-1 — a parent cannot STRIP date, owner or amount off a row', () => {
  it('!! THE PROBE, VERBATIM: a parent deleting date, owner and amount in one update is DENIED', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertFails(
      updateDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), {
        date: deleteField(), owner: deleteField(), amount: deleteField(),
      })
    );
    // And it is not one composite check that happens to catch the trio — each field on its own.
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), { date: deleteField() }));
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), { owner: deleteField() }));
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), { amount: deleteField() }));
  });

  it('a SUPER-ADMIN cannot either — nobody bypasses this, same footing as D21(d)', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), { amount: deleteField() }));
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tl-omer-march'), { date: deleteField() }));
  });

  it('nor a matrix-governed member on their own row — the branch re-validation is not the thing holding this', async () => {
    const db = ctxFor(OMER).firestore();
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tl-omer-march'), { owner: deleteField() }));
  });

  it('!! THE NEGATIVE THAT MAKES THE SHAPE PROVABLE — a row that NEVER HAD the field stays editable', async () => {
    // Presence-PRESERVING, not presence-REQUIRING. `tl-ownerless` has no `owner` and no `ownerId`;
    // the unstamped corpus is full of rows like it, and a `keys().hasAll([...])` rule would have
    // denied every edit to every one of them — D21(d)'s own recorded mistake, one field over.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'transaction_lines', 'tl-ownerless'), {
        amount: 5, date: '2026-03-05', category: 'שונות',
      });
    });
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(updateDoc(doc(db, 'transaction_lines', 'tl-ownerless'), { amount: 6 }));
    await assertSucceeds(updateDoc(doc(db, 'transaction_lines', 'tl-ownerless'), { category: 'בריאות' }));
  });

  it('an ordinary edit that CHANGES the three fields is still allowed — the trust decision is not re-opened', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), {
        date: '2026-03-21', owner: 'לילית לוי', amount: 222,
      })
    );
  });

  it('!! AND THE OTHER HALF OF THE NaN — a non-numeric `amount` is refused, by a parent too', async () => {
    // `amount` was the ONE payload field with no type conjunct outside the alternation: create had
    // `amount is number`, and the fix batch added `date`/`owner` type checks to update but not
    // `amount`. A parent setting `amount: 'שלוש מאות'` poisons the same average by the same
    // arithmetic as deleting it, so closing presence without closing type would have left the
    // identical NaN one keystroke away.
    const db = ctxFor(LILIT).firestore();
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), { amount: 'שלוש מאות' }));
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), { amount: null }));
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), { amount: ['300'] }));
    await assertFails(updateDoc(doc(ctxFor(DAVID).firestore(), 'transaction_lines', 'tl-lilit-march'), { amount: '300' }));
    // A NEGATIVE amount is still allowed for a parent: this is a TYPE constraint and nothing more.
    // `amount > 0` lives on the create rule and on the matrix-governed branch, and moving it here
    // would re-open a pre-existing trust decision this stage has twice said it is not re-opening.
    await assertSucceeds(updateDoc(doc(db, 'transaction_lines', 'tl-lilit-march'), { amount: -40 }));
  });

  it('a row with NO amount at all is still editable — the defaulted accessor again', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'transaction_lines', 'tl-amountless'), {
        owner: 'לילית', ownerId: 'lilit-levy', date: '2026-03-05', category: 'שונות',
      });
    });
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(updateDoc(doc(db, 'transaction_lines', 'tl-amountless'), { category: 'בריאות' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 5. T3 REVIEW F3 — THE COMPLETION MARKER IS NOT FORGEABLE FROM A CLIENT SESSION
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// T5's entire correctness rests on this one document. `parseBackfillMarker` was hardened against a
// HALF-written record, which stops an aborted run opening the gate — but a well-formed forgery
// passed the parse, and `settings/{docId}` let any parent write one. That opens the statistical
// layer over an unstamped corpus, and R6 is why that is not recoverable by a caveat: an untouched
// row has no `period`, so the query that would average it cannot return it and no downstream
// number can see that the corpus is incomplete.
describe('T3 review F3 — settings/migrationState is Admin-SDK-only', () => {
  const forged = {
    transactionPeriodBackfill: {
      completedAt: '2026-08-18T09:00:00.000Z', rowsStamped: 3, rowsUnknown: 0,
      sourceCommit: 'a86c4e9', lastRunAt: '2026-08-18T09:00:00.000Z', lastRunCommit: 'a86c4e9',
      transactionRows: 3,
    },
  };

  it('!! A PARENT CANNOT FORGE THE MARKER — a WELL-FORMED one, which is the case the parse cannot catch', async () => {
    await assertFails(setDoc(doc(ctxFor(LILIT).firestore(), 'settings', 'migrationState'), forged));
  });

  it('a super-admin cannot either — the marker is not a privilege, it is a record of a run', async () => {
    await assertFails(setDoc(doc(ctxFor(DAVID).firestore(), 'settings', 'migrationState'), forged));
  });

  it('nor update an existing one, nor delete it', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'settings', 'migrationState'), forged);
    });
    await assertFails(
      updateDoc(doc(ctxFor(LILIT).firestore(), 'settings', 'migrationState'), { 'transactionPeriodBackfill.rowsStamped': 99 })
    );
    await assertFails(deleteDoc(doc(ctxFor(DAVID).firestore(), 'settings', 'migrationState')));
  });

  it('!! BUT EVERY SIGNED-IN ROLE STILL READS IT — the Dashboard consults it on every render', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'settings', 'migrationState'), forged);
    });
    for (const who of [DAVID, LILIT, OMER, MAYA]) {
      await assertSucceeds(getDoc(doc(ctxFor(who).firestore(), 'settings', 'migrationState')));
    }
  });

  it('and the Admin SDK — the only thing that ever wrote it — still can', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await assertSucceeds(setDoc(doc(ctx.firestore(), 'settings', 'migrationState'), forged));
    });
  });

  it('!! AND NO OTHER settings DOC IS NARROWED BY THIS — the conditional is per-docId', async () => {
    // The change must not become "parents lost settings". `syncState` is the ordinary case.
    await assertSucceeds(setDoc(doc(ctxFor(LILIT).firestore(), 'settings', 'syncState'), { v: 1 }));
    await assertSucceeds(deleteDoc(doc(ctxFor(LILIT).firestore(), 'settings', 'syncState')));
  });
});
