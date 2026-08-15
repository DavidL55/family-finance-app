// Firestore Security Rules test suite for `firestore.rules` (Stage 2 Task 6).
//
// Runs against a real, ephemeral Firestore emulator instance via
// @firebase/rules-unit-testing. No Auth emulator is used — auth contexts are
// fabricated directly via testEnv.authenticatedContext(uid, { role, memberId }),
// which is sufficient because the rules read role/memberId exclusively from
// request.auth.token (custom claims), never from a real sign-in flow.
//
// Tests the COMMITTED firestore.rules file, not the Task 6 brief's reference
// version — the implementer deviated deliberately (see task-5-report.md,
// "Deviation 1"): reads on members/groups/settings/categories were tightened
// from isSignedIn() to hasRole() after a probe found a signed-in-but-claims-less
// token could still read data. This suite proves that fix and the other edge
// cases task-5-report.md and progress.md flag as required Task 6 coverage.
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { setDoc, doc, getDoc, getDocs, collection, updateDoc, deleteDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

// ── Fixture identities ──────────────────────────────────────────────────────────
const DAVID = { uid: 'uid-david', memberId: 'david-levy', role: 'super-admin' as const };
const LILIT = { uid: 'uid-lilit', memberId: 'lilit-levy', role: 'parent' as const };
// Omer: view-only 'own' on expenses/income. Used for the read-side own/family boundary.
const OMER = { uid: 'uid-omer', memberId: 'omer-levy', role: 'member' as const };
// A member with edit:'own' on expenses — used for the create/update ownership boundary,
// which Omer's view-only fixture can't exercise.
const EDITOR = { uid: 'uid-editor', memberId: 'editor-own', role: 'member' as const };

const ctxFor = (m: { uid: string; memberId: string; role: string }) =>
  testEnv.authenticatedContext(m.uid, { role: m.role, memberId: m.memberId });

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-familyfinance-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed baseline fixture data as Admin (bypasses rules) before each test.
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
      resolvedPermissions: {
        expenses: { view: 'own', edit: 'none' },
        income: { view: 'own', edit: 'none' },
      },
    });
    await setDoc(doc(db, 'members', 'editor-own'), {
      id: 'editor-own', name: 'עורך', role: 'ילד', color: '#663399', groups: [], uid: EDITOR.uid,
      createdAt: 'x', updatedAt: 'x',
      resolvedPermissions: {
        expenses: { view: 'own', edit: 'own' },
      },
    });

    await setDoc(doc(db, 'transaction_lines', 'tx-david'), {
      owner: 'דויד', amount: 100, date: '2026-08-01', category: 'שונות', description: 'x',
    });
    await setDoc(doc(db, 'transaction_lines', 'tx-lilit'), {
      owner: 'לילית', amount: 200, date: '2026-08-01', category: 'שונות', description: 'x',
    });
    await setDoc(doc(db, 'transaction_lines', 'tx-omer'), {
      owner: 'עומר', amount: 50, date: '2026-08-01', category: 'שונות', description: 'x',
    });
    await setDoc(doc(db, 'transaction_lines', 'tx-editor'), {
      owner: 'עורך', amount: 75, date: '2026-08-01', category: 'שונות', description: 'x',
    });
    // A row with no `owner` field at all — Task 5 report edge case #3.
    await setDoc(doc(db, 'transaction_lines', 'tx-no-owner'), {
      amount: 10, date: '2026-08-01', category: 'שונות', description: 'x',
    });

    await setDoc(doc(db, 'incomes', 'income-1'), { name: 'משכורת', amount: 10000, date: '2026-08-01' });
  });
});

// ────────────────────────────────────────────────────────────────────────────────
describe('identity — no-claims and unauthenticated tokens never fall through as guest', () => {
  it('a signed-in user with no custom claims at all is denied read on members', async () => {
    const noClaims = testEnv.authenticatedContext('uid-no-claims', {});
    await assertFails(getDocs(collection(noClaims.firestore(), 'members')));
  });

  it('a signed-in user with no custom claims is denied read on groups', async () => {
    const noClaims = testEnv.authenticatedContext('uid-no-claims', {});
    await assertFails(getDocs(collection(noClaims.firestore(), 'groups')));
  });

  it('a signed-in user with no custom claims is denied read on settings', async () => {
    const noClaims = testEnv.authenticatedContext('uid-no-claims', {});
    await assertFails(getDocs(collection(noClaims.firestore(), 'settings')));
  });

  it('a signed-in user with no custom claims is denied read on categories', async () => {
    const noClaims = testEnv.authenticatedContext('uid-no-claims', {});
    await assertFails(getDocs(collection(noClaims.firestore(), 'categories')));
  });

  it('an unauthenticated request is denied', async () => {
    const anon = testEnv.unauthenticatedContext();
    await assertFails(getDocs(collection(anon.firestore(), 'members')));
  });
});

describe('identity — malformed token: role present, memberId absent (task-5-report edge case)', () => {
  it('hasRole()-gated collections (members) still grant read — hasRole() checks only role(), documenting current behavior', async () => {
    const db = testEnv.authenticatedContext('uid-role-only', { role: 'member' }).firestore();
    await assertSucceeds(getDocs(collection(db, 'members')));
  });

  it('matrix-governed collections (transaction_lines) deny — myMember() get() on an undefined memberId fails closed, not permissive', async () => {
    const db = testEnv.authenticatedContext('uid-role-only', { role: 'member' }).firestore();
    await assertFails(getDoc(doc(db, 'transaction_lines', 'tx-david')));
  });
});

describe('hard requirement — a child cannot read a parent\'s data; a parent can; super-admin bypasses everything', () => {
  it('Omer (own/view on expenses) CANNOT read a transaction owned by לילית', async () => {
    const db = ctxFor(OMER).firestore();
    await assertFails(getDoc(doc(db, 'transaction_lines', 'tx-lilit')));
  });

  it('Omer (own/view) CAN read his own transaction', async () => {
    const db = ctxFor(OMER).firestore();
    await assertSucceeds(getDoc(doc(db, 'transaction_lines', 'tx-omer')));
  });

  it('Omer (own/view) is DENIED on a row missing the owner field entirely', async () => {
    const db = ctxFor(OMER).firestore();
    await assertFails(getDoc(doc(db, 'transaction_lines', 'tx-no-owner')));
  });

  it('לילית (parent) CAN read every transaction, including Omer\'s and David\'s', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(getDoc(doc(db, 'transaction_lines', 'tx-omer')));
    await assertSucceeds(getDoc(doc(db, 'transaction_lines', 'tx-david')));
  });

  it('super-admin (David) CAN read every transaction', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(getDoc(doc(db, 'transaction_lines', 'tx-lilit')));
  });
});

describe('own-level edit on transaction_lines — create (request.resource) vs update (resource) boundary', () => {
  it('a member with edit:"own" CAN create a row owned by themselves', async () => {
    const db = ctxFor(EDITOR).firestore();
    await assertSucceeds(setDoc(doc(db, 'transaction_lines', 'tx-editor-new'), {
      owner: 'עורך', amount: 20, date: '2026-08-02', category: 'שונות', description: 'x',
    }));
  });

  it('a member with edit:"own" CANNOT create a row owned by someone else (request.resource.data.owner checked)', async () => {
    const db = ctxFor(EDITOR).firestore();
    await assertFails(setDoc(doc(db, 'transaction_lines', 'tx-editor-forge'), {
      owner: 'לילית', amount: 20, date: '2026-08-02', category: 'שונות', description: 'x',
    }));
  });

  it('a member with edit:"own" CAN update their own existing row', async () => {
    const db = ctxFor(EDITOR).firestore();
    await assertSucceeds(updateDoc(doc(db, 'transaction_lines', 'tx-editor'), { amount: 99 }));
  });

  it('a member with edit:"own" CANNOT update an existing row owned by someone else (resource.data.owner checked)', async () => {
    const db = ctxFor(EDITOR).firestore();
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tx-lilit'), { amount: 1 }));
  });

  it('a member with edit:"own" CANNOT delete an existing row owned by someone else', async () => {
    const db = ctxFor(EDITOR).firestore();
    await assertFails(deleteDoc(doc(db, 'transaction_lines', 'tx-lilit')));
  });

  // C1 (security review finding): update/delete originally authorized against resource.data
  // (pre-image) ONLY — an 'own'-level editor could update a row they own and reassign it to
  // someone else by changing `owner` in the same update, or write a garbage amount/date,
  // because none of the create-time shape checks re-ran on update. Fixed by requiring
  // request.resource.data.owner == resource.data.owner (owner immutable) plus amount/date
  // shape re-validation on update.
  it('C1 exploit: an own-level editor CANNOT reassign their own row to another member by changing owner on update', async () => {
    const db = ctxFor(EDITOR).firestore();
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tx-editor'), { owner: 'לילית' }));
  });

  it('C1 follow-on: an own-level editor CANNOT set a negative amount on update', async () => {
    const db = ctxFor(EDITOR).firestore();
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tx-editor'), { amount: -5 }));
  });

  it('C1 follow-on: an own-level editor CANNOT set a malformed date on update', async () => {
    // The rule only shape-checks date.size() == 10 (not real date-format validity), so the
    // probe string must have a different length to actually exercise the rejection path.
    const db = ctxFor(EDITOR).firestore();
    await assertFails(updateDoc(doc(db, 'transaction_lines', 'tx-editor'), { date: 'bad-date' }));
  });

  it('control: an own-level editor CAN still update their own row without touching owner/amount/date shape', async () => {
    const db = ctxFor(EDITOR).firestore();
    await assertSucceeds(updateDoc(doc(db, 'transaction_lines', 'tx-editor'), { description: 'updated' }));
  });
});

describe('ownerless modules — "own" grants NOTHING, only "family" does (D5 structural)', () => {
  it('a member with income.view = "own" is DENIED (own is meaningless without an owner field)', async () => {
    const db = ctxFor(OMER).firestore(); // seeded with income.view = 'own'
    await assertFails(getDoc(doc(db, 'incomes', 'income-1')));
  });

  it('a member with income.view = "family" is allowed', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'members', 'family-viewer'), {
        id: 'family-viewer', name: 'X', role: 'ילד', color: '#111111', groups: [], uid: 'uid-fv', createdAt: 'x', updatedAt: 'x',
        resolvedPermissions: { income: { view: 'family', edit: 'none' } },
      });
    });
    const db = testEnv.authenticatedContext('uid-fv', { role: 'member', memberId: 'family-viewer' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'incomes', 'income-1')));
  });

  it('the same "own" grants nothing on investments', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'investments', 'inv-1'), { name: 'x', amount: 1 });
      await setDoc(doc(ctx.firestore(), 'members', 'inv-own'), {
        id: 'inv-own', name: 'X', role: 'ילד', color: '#111111', groups: [], uid: 'uid-inv-own', createdAt: 'x', updatedAt: 'x',
        resolvedPermissions: { investments: { view: 'own', edit: 'none' } },
      });
    });
    const db = testEnv.authenticatedContext('uid-inv-own', { role: 'member', memberId: 'inv-own' }).firestore();
    await assertFails(getDoc(doc(db, 'investments', 'inv-1')));
  });

  it('the same "own" grants nothing on goals', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'goals', 'goal-1'), { name: 'x', target: 1 });
      await setDoc(doc(ctx.firestore(), 'members', 'goal-own'), {
        id: 'goal-own', name: 'X', role: 'ילד', color: '#111111', groups: [], uid: 'uid-goal-own', createdAt: 'x', updatedAt: 'x',
        resolvedPermissions: { goals: { view: 'own', edit: 'none' } },
      });
    });
    const db = testEnv.authenticatedContext('uid-goal-own', { role: 'member', memberId: 'goal-own' }).firestore();
    await assertFails(getDoc(doc(db, 'goals', 'goal-1')));
  });

  it('investments.view = "family" is allowed (never manually probed before Task 6)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'investments', 'inv-2'), { name: 'x', amount: 1 });
      await setDoc(doc(ctx.firestore(), 'members', 'inv-family'), {
        id: 'inv-family', name: 'X', role: 'ילד', color: '#111111', groups: [], uid: 'uid-inv-family', createdAt: 'x', updatedAt: 'x',
        resolvedPermissions: { investments: { view: 'family', edit: 'family' } },
      });
    });
    const db = testEnv.authenticatedContext('uid-inv-family', { role: 'member', memberId: 'inv-family' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'investments', 'inv-2')));
  });

  it('investments.edit = "family" allows write; investments.edit = "none" (default) denies write', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'members', 'inv-family'), {
        id: 'inv-family', name: 'X', role: 'ילד', color: '#111111', groups: [], uid: 'uid-inv-family', createdAt: 'x', updatedAt: 'x',
        resolvedPermissions: { investments: { view: 'family', edit: 'family' } },
      });
      await setDoc(doc(ctx.firestore(), 'members', 'inv-own'), {
        id: 'inv-own', name: 'Y', role: 'ילד', color: '#222222', groups: [], uid: 'uid-inv-own2', createdAt: 'x', updatedAt: 'x',
        resolvedPermissions: { investments: { view: 'own', edit: 'none' } },
      });
    });
    const familyDb = testEnv.authenticatedContext('uid-inv-family', { role: 'member', memberId: 'inv-family' }).firestore();
    await assertSucceeds(setDoc(doc(familyDb, 'investments', 'inv-3'), { name: 'x', amount: 5 }));

    const ownDb = testEnv.authenticatedContext('uid-inv-own2', { role: 'member', memberId: 'inv-own' }).firestore();
    await assertFails(setDoc(doc(ownDb, 'investments', 'inv-4'), { name: 'x', amount: 5 }));
  });

  it('goals.view = "family" is allowed (never manually probed before Task 6)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'goals', 'goal-2'), { name: 'x', target: 1 });
      await setDoc(doc(ctx.firestore(), 'members', 'goal-family'), {
        id: 'goal-family', name: 'X', role: 'ילד', color: '#111111', groups: [], uid: 'uid-goal-family', createdAt: 'x', updatedAt: 'x',
        resolvedPermissions: { goals: { view: 'family', edit: 'family' } },
      });
    });
    const db = testEnv.authenticatedContext('uid-goal-family', { role: 'member', memberId: 'goal-family' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'goals', 'goal-2')));
  });

  it('goals.edit = "family" allows write; goals.edit = "none" (default) denies write', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'members', 'goal-family'), {
        id: 'goal-family', name: 'X', role: 'ילד', color: '#111111', groups: [], uid: 'uid-goal-family', createdAt: 'x', updatedAt: 'x',
        resolvedPermissions: { goals: { view: 'family', edit: 'family' } },
      });
      await setDoc(doc(ctx.firestore(), 'members', 'goal-own'), {
        id: 'goal-own', name: 'Y', role: 'ילד', color: '#222222', groups: [], uid: 'uid-goal-own2', createdAt: 'x', updatedAt: 'x',
        resolvedPermissions: { goals: { view: 'own', edit: 'none' } },
      });
    });
    const familyDb = testEnv.authenticatedContext('uid-goal-family', { role: 'member', memberId: 'goal-family' }).firestore();
    await assertSucceeds(setDoc(doc(familyDb, 'goals', 'goal-3'), { name: 'x', target: 5 }));

    const ownDb = testEnv.authenticatedContext('uid-goal-own2', { role: 'member', memberId: 'goal-own' }).firestore();
    await assertFails(setDoc(doc(ownDb, 'goals', 'goal-4'), { name: 'x', target: 5 }));
  });
});

describe('fail-closed default — missing matrix entry denies, does not allow', () => {
  it('a member with no resolvedPermissions field at all is denied view', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'members', 'no-perms'), {
        id: 'no-perms', name: 'X', role: 'ילד', color: '#111111', groups: [], uid: 'uid-noperm', createdAt: 'x', updatedAt: 'x',
        // no resolvedPermissions field at all
      });
    });
    const db = testEnv.authenticatedContext('uid-noperm', { role: 'member', memberId: 'no-perms' }).firestore();
    await assertFails(getDoc(doc(db, 'transaction_lines', 'tx-david')));
  });

  it('an unmatched collection path (no rule defined) denies everything, even for super-admin', async () => {
    // Firestore's implicit deny-all — no match block exists for this collection name at all.
    const db = ctxFor(DAVID).firestore();
    await assertFails(getDocs(collection(db, 'made_up_collection_that_has_no_rule')));
    await assertFails(setDoc(doc(db, 'made_up_collection_that_has_no_rule', 'x'), { a: 1 }));
  });
});

describe('permissions collection — super-admin only, read AND write (D9)', () => {
  it('super-admin CAN read the permissions collection', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'permissions', 'group__kids'), {
        id: 'group__kids', scope: 'group', targetId: 'kids', modules: {}, updatedAt: 'x', updatedBy: 'david-levy',
      });
    });
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(getDoc(doc(db, 'permissions', 'group__kids')));
  });

  it('super-admin CAN write a permissions doc', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(setDoc(doc(db, 'permissions', 'group__kids'), {
      id: 'group__kids', scope: 'group', targetId: 'kids', modules: {}, updatedAt: 'x', updatedBy: 'david-levy',
    }));
  });

  it('a parent CANNOT write a permissions doc', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertFails(setDoc(doc(db, 'permissions', 'group__kids'), {
      id: 'group__kids', scope: 'group', targetId: 'kids', modules: {}, updatedAt: 'x', updatedBy: 'lilit-levy',
    }));
  });

  it('a parent CANNOT read the permissions collection', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'permissions', 'group__kids'), {
        id: 'group__kids', scope: 'group', targetId: 'kids', modules: {}, updatedAt: 'x', updatedBy: 'david-levy',
      });
    });
    const db = ctxFor(LILIT).firestore();
    await assertFails(getDoc(doc(db, 'permissions', 'group__kids')));
    await assertFails(getDocs(collection(db, 'permissions')));
  });

  it('a member CANNOT read the permissions collection', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'permissions', 'group__kids'), {
        id: 'group__kids', scope: 'group', targetId: 'kids', modules: {}, updatedAt: 'x', updatedBy: 'david-levy',
      });
    });
    const db = ctxFor(OMER).firestore();
    await assertFails(getDoc(doc(db, 'permissions', 'group__kids')));
  });

  it('a permissions doc with scope outside [\'group\',\'member\'] is rejected (shape validation)', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'permissions', 'bad-scope'), {
      id: 'bad-scope', scope: 'family', targetId: 'kids', modules: {}, updatedAt: 'x', updatedBy: 'david-levy',
    }));
  });

  it('a permissions doc missing updatedBy is rejected (shape validation)', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'permissions', 'bad-missing-updatedby'), {
      id: 'bad-missing-updatedby', scope: 'group', targetId: 'kids', modules: {}, updatedAt: 'x',
    }));
  });

  // Security-review fast-follow: updatedBy must be bound to the actor's own memberId
  // (anti-spoof, matching the audit_log actorMemberId pattern) — even super-admin cannot
  // write a permissions doc claiming a different memberId made the change.
  it('super-admin CANNOT write a permissions doc whose updatedBy names a different memberId (anti-spoof)', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'permissions', 'spoofed-updatedby'), {
      id: 'spoofed-updatedby', scope: 'group', targetId: 'kids', modules: {}, updatedAt: 'x', updatedBy: 'lilit-levy',
    }));
  });

  it('super-admin CAN write a permissions doc whose updatedBy correctly names themselves', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(setDoc(doc(db, 'permissions', 'correctly-attributed'), {
      id: 'correctly-attributed', scope: 'group', targetId: 'kids', modules: {}, updatedAt: 'x', updatedBy: 'david-levy',
    }));
  });
});

describe('members — shape validation and self-escalation resistance', () => {
  it('super-admin writing a member with an invalid role is rejected', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'members', 'bad-1'), {
      id: 'bad-1', name: 'X', role: 'not-a-role', color: '#111111', groups: [], createdAt: 'x', updatedAt: 'x',
    }));
  });

  it('super-admin writing a member with a malformed color is rejected', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'members', 'bad-2'), {
      id: 'bad-2', name: 'X', role: 'הורה', color: 'blue', groups: [], createdAt: 'x', updatedAt: 'x',
    }));
  });

  it('super-admin writing a member missing a name is rejected', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'members', 'bad-3'), {
      id: 'bad-3', role: 'הורה', color: '#111111', groups: [], createdAt: 'x', updatedAt: 'x',
    }));
  });

  it('a valid member doc written by super-admin is accepted', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(setDoc(doc(db, 'members', 'good-1'), {
      id: 'good-1', name: 'X', role: 'ילד', color: '#112233', groups: [], createdAt: 'x', updatedAt: 'x',
    }));
  });

  // Self-escalation: a member is not super-admin, and create/update on `members` is gated
  // on isSuperAdmin() with no exception for "editing my own doc" — so a member attempting to
  // write their own resolvedPermissions/uid must be denied by the same blanket gate.
  // If this unexpectedly SUCCEEDS, that is a Critical self-escalation hole — see report.
  it('a member CANNOT write their own resolvedPermissions (self-escalation must be impossible)', async () => {
    const db = ctxFor(OMER).firestore();
    await assertFails(updateDoc(doc(db, 'members', 'omer-levy'), {
      resolvedPermissions: { expenses: { view: 'family', edit: 'family' } },
    }));
  });

  it('a member CANNOT write their own uid field', async () => {
    const db = ctxFor(OMER).firestore();
    await assertFails(updateDoc(doc(db, 'members', 'omer-levy'), { uid: 'uid-someone-else' }));
  });

  it('a member CANNOT write another member\'s doc at all', async () => {
    const db = ctxFor(OMER).firestore();
    await assertFails(updateDoc(doc(db, 'members', 'lilit-levy'), { name: 'hacked' }));
  });

  it('a parent CANNOT write a member doc (super-admin only)', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertFails(updateDoc(doc(db, 'members', 'omer-levy'), { name: 'hacked' }));
  });

  // Controller ruling: cross-member reads of the members collection are product-intentional
  // (the member list is core UI — every provisioned member can see who else is in the family).
  // Do NOT "fix" this into a per-doc restriction; this test guards against that regression.
  it('a member-role token CAN read another member\'s doc (product-intentional, not a bug)', async () => {
    const db = ctxFor(OMER).firestore();
    await assertSucceeds(getDoc(doc(db, 'members', 'lilit-levy')));
  });
});

describe('groups — super-admin only, per the ניהול משפחה והרשאות module', () => {
  it('a parent CANNOT write a group doc', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertFails(setDoc(doc(db, 'groups', 'kids'), {
      id: 'kids', name: 'הילדים', memberIds: [], createdAt: 'x', updatedAt: 'x',
    }));
  });

  it('super-admin CAN write a valid group doc', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(setDoc(doc(db, 'groups', 'kids'), {
      id: 'kids', name: 'הילדים', memberIds: [], createdAt: 'x', updatedAt: 'x',
    }));
  });
});

describe('audit_log — immutable, actor must match token (anti-spoofing), member cannot write at all', () => {
  it('even super-admin cannot update an audit_log entry', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'audit_log', 'entry-1'), {
        actorMemberId: 'david-levy', action: 'x', target: 'x', at: 'x',
      });
    });
    const db = ctxFor(DAVID).firestore();
    await assertFails(updateDoc(doc(db, 'audit_log', 'entry-1'), { action: 'tampered' }));
  });

  it('even super-admin cannot delete an audit_log entry', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'audit_log', 'entry-1'), {
        actorMemberId: 'david-levy', action: 'x', target: 'x', at: 'x',
      });
    });
    const db = ctxFor(DAVID).firestore();
    await assertFails(deleteDoc(doc(db, 'audit_log', 'entry-1')));
  });

  it('a parent cannot forge an audit entry claiming to be someone else (spoofing denied)', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertFails(setDoc(doc(db, 'audit_log', 'entry-2'), {
      actorMemberId: 'david-levy', action: 'x', target: 'x', at: 'x', // impersonating David
    }));
  });

  it('super-admin cannot forge an audit entry claiming to be someone else either', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'audit_log', 'entry-2b'), {
      actorMemberId: 'lilit-levy', action: 'x', target: 'x', at: 'x', // impersonating Lilit
    }));
  });

  it('a member (not parent/super-admin) cannot write audit_log at all, even correctly attributed', async () => {
    const db = ctxFor(OMER).firestore();
    await assertFails(setDoc(doc(db, 'audit_log', 'entry-3'), {
      actorMemberId: 'omer-levy', action: 'x', target: 'x', at: 'x',
    }));
  });

  it('a parent CAN write a correctly-attributed audit entry', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(setDoc(doc(db, 'audit_log', 'entry-4'), {
      actorMemberId: 'lilit-levy', action: 'x', target: 'x', at: 'x',
    }));
  });

  it('super-admin CANNOT read audit_log (D9-style: read is super-admin-only, parent excluded)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'audit_log', 'entry-5'), {
        actorMemberId: 'lilit-levy', action: 'x', target: 'x', at: 'x',
      });
    });
    const parentDb = ctxFor(LILIT).firestore();
    await assertFails(getDoc(doc(parentDb, 'audit_log', 'entry-5')));
    const adminDb = ctxFor(DAVID).firestore();
    await assertSucceeds(getDoc(doc(adminDb, 'audit_log', 'entry-5')));
  });
});

describe('legacy transactions collection is fully locked down (Admin SDK only)', () => {
  it('even super-admin cannot read the legacy transactions collection via the client', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'transactions', 'legacy-1'), { amount: 1, date: '2026-01-01' });
    });
    const db = ctxFor(DAVID).firestore();
    await assertFails(getDoc(doc(db, 'transactions', 'legacy-1')));
  });

  it('even super-admin cannot write the legacy transactions collection via the client', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'transactions', 'legacy-2'), { amount: 1, date: '2026-01-01' }));
  });
});
