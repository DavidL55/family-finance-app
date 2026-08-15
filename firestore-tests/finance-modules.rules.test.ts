// Firestore Security Rules test suite for the four Stage 3 owned-from-day-one collections
// (accounts/recurring/loans/insurances) — `firestore.rules` Task 7 (D1/D2/D3/D9).
//
// Companion to `permissions.rules.test.ts` (Stage 2's suite, extended for D7 in this same
// task). Split into its own file because the fixture shape (resolvedPermissions with the four
// new module keys, ownerId-bearing docs) is materially different from Stage 2's expenses/income
// fixtures — mixing them into one beforeEach would make every Stage 2 test carry unused Stage 3
// seed data. Runs against a real, ephemeral Firestore emulator instance via
// @firebase/rules-unit-testing, same conventions as the companion suite: auth contexts are
// fabricated directly via testEnv.authenticatedContext(uid, { role, memberId }); rules read
// role/memberId exclusively from request.auth.token custom claims.
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

// ── Fixture identities ──────────────────────────────────────────────────────────
const DAVID = { uid: 'uid-david', memberId: 'david-levy', role: 'super-admin' as const };
const LILIT = { uid: 'uid-lilit', memberId: 'lilit-levy', role: 'parent' as const };
// OMER: 'own' view+edit on ALL FOUR new collections — the general-purpose fixture for
// own-vs-other read boundaries, create-ownership, and update ownerId-reassignment-denied.
const OMER = { uid: 'uid-omer', memberId: 'omer-levy', role: 'member' as const };
// RESTRICTED: view:'own'/edit:'none' on loans, view:'none'/edit:'none' on the other three —
// exercises the "view-only, edit denied" and "denied entirely" shapes the matrix allows,
// which OMER's uniformly-own fixture can't.
const RESTRICTED = { uid: 'uid-restricted', memberId: 'restricted-levy', role: 'member' as const };

const ctxFor = (m: { uid: string; memberId: string; role: string }) =>
  testEnv.authenticatedContext(m.uid, { role: m.role, memberId: m.memberId });

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-familyfinance-finance-rules-test',
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
      resolvedPermissions: {
        accounts: { view: 'own', edit: 'own' },
        recurring: { view: 'own', edit: 'own' },
        loans: { view: 'own', edit: 'own' },
        insurances: { view: 'own', edit: 'own' },
      },
    });
    await setDoc(doc(db, 'members', 'restricted-levy'), {
      id: 'restricted-levy', name: 'מוגבל', role: 'ילד', color: '#663399', groups: [], uid: RESTRICTED.uid,
      createdAt: 'x', updatedAt: 'x',
      resolvedPermissions: {
        accounts: { view: 'none', edit: 'none' },
        recurring: { view: 'none', edit: 'none' },
        loans: { view: 'own', edit: 'none' },
        insurances: { view: 'none', edit: 'none' },
      },
    });

    // accounts
    await setDoc(doc(db, 'accounts', 'acc-omer'), {
      id: 'acc-omer', ownerId: 'omer-levy', name: 'חיסכון', type: 'bank', balance: 500,
      balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x',
    });
    await setDoc(doc(db, 'accounts', 'acc-lilit'), {
      id: 'acc-lilit', ownerId: 'lilit-levy', name: 'עו״ש', type: 'bank', balance: 20000,
      balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x',
    });

    // recurring
    await setDoc(doc(db, 'recurring', 'rec-omer'), {
      id: 'rec-omer', kind: 'expense', description: 'חוג', amount: 150, category: 'חינוך',
      chargeDay: 5, ownerId: 'omer-levy', status: 'active', startDate: '2026-01-01',
      createdAt: 'x', updatedAt: 'x',
    });
    await setDoc(doc(db, 'recurring', 'rec-lilit'), {
      id: 'rec-lilit', kind: 'income', description: 'משכורת', amount: 12000, chargeDay: 1,
      ownerId: 'lilit-levy', status: 'active', startDate: '2026-01-01',
      createdAt: 'x', updatedAt: 'x',
    });

    // loans
    await setDoc(doc(db, 'loans', 'loan-omer'), {
      id: 'loan-omer', ownerId: 'omer-levy', name: 'הלוואת סטודנט', loanType: 'personal',
      principal: 5000, balance: 4000, interestRate: 2, monthlyPayment: 200,
      startDate: '2026-01-01', endDate: '2027-01-01', status: 'active', createdAt: 'x', updatedAt: 'x',
    });
    await setDoc(doc(db, 'loans', 'loan-restricted'), {
      id: 'loan-restricted', ownerId: 'restricted-levy', name: 'הלוואת רכב', loanType: 'other',
      principal: 8000, balance: 6000, interestRate: 3, monthlyPayment: 300,
      startDate: '2026-01-01', endDate: '2028-01-01', status: 'active', createdAt: 'x', updatedAt: 'x',
    });

    // insurances
    await setDoc(doc(db, 'insurances', 'ins-omer'), {
      id: 'ins-omer', type: 'health', provider: 'הראל', insuredMemberId: 'omer-levy', ownerId: 'omer-levy',
      premium: 100, premiumFrequency: 'monthly', coverages: [], renewalDate: '2027-01-01',
      status: 'active', createdAt: 'x', updatedAt: 'x',
    });
    await setDoc(doc(db, 'insurances', 'ins-lilit'), {
      id: 'ins-lilit', type: 'car', provider: 'מגדל', insuredMemberId: 'lilit-levy', ownerId: 'lilit-levy',
      premium: 300, premiumFrequency: 'monthly', coverages: [{ label: 'צד ג׳', amount: 500000 }],
      renewalDate: '2027-01-01', status: 'active', createdAt: 'x', updatedAt: 'x',
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// 'own' view/edit — read own vs denied-other, create-ownership, update ownerId-reassignment
// ────────────────────────────────────────────────────────────────────────────────
describe('accounts — own-level read/create/update-reassignment boundary', () => {
  it('Omer (own) CAN read his own account', async () => {
    await assertSucceeds(getDoc(doc(ctxFor(OMER).firestore(), 'accounts', 'acc-omer')));
  });
  it('Omer (own) CANNOT read another member\'s account', async () => {
    await assertFails(getDoc(doc(ctxFor(OMER).firestore(), 'accounts', 'acc-lilit')));
  });
  it('Omer (own edit) CAN create an account owned by himself', async () => {
    await assertSucceeds(setDoc(doc(ctxFor(OMER).firestore(), 'accounts', 'acc-omer-new'), {
      id: 'acc-omer-new', ownerId: 'omer-levy', name: 'מזומן', type: 'cash', balance: 50,
      balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('Omer (own edit) CANNOT create an account owned by someone else (request.resource.data.ownerId checked, same as expensesAllowed\'s owner check)', async () => {
    await assertFails(setDoc(doc(ctxFor(OMER).firestore(), 'accounts', 'acc-forged'), {
      id: 'acc-forged', ownerId: 'lilit-levy', name: 'X', type: 'cash', balance: 50,
      balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('Omer (own edit) CANNOT reassign his own account\'s ownerId on update (D9 — mirrors C1)', async () => {
    await assertFails(updateDoc(doc(ctxFor(OMER).firestore(), 'accounts', 'acc-omer'), { ownerId: 'lilit-levy' }));
  });
  it('Lilit (parent) CAN reassign an account\'s ownerId on update (trusted bypass, D9/C1 mirror)', async () => {
    await assertSucceeds(updateDoc(doc(ctxFor(LILIT).firestore(), 'accounts', 'acc-omer'), { ownerId: 'lilit-levy' }));
  });
  it('David (super-admin) CAN reassign an account\'s ownerId on update', async () => {
    await assertSucceeds(updateDoc(doc(ctxFor(DAVID).firestore(), 'accounts', 'acc-omer'), { ownerId: 'lilit-levy' }));
  });
  it('Omer (own edit) CAN update his own account without touching ownerId', async () => {
    await assertSucceeds(updateDoc(doc(ctxFor(OMER).firestore(), 'accounts', 'acc-omer'), { balance: 600, balanceUpdatedAt: 'y', updatedAt: 'y' }));
  });
  it('Omer (own edit) CANNOT update another member\'s account at all', async () => {
    await assertFails(updateDoc(doc(ctxFor(OMER).firestore(), 'accounts', 'acc-lilit'), { balance: 1 }));
  });
  it('Omer (own edit) CAN delete his own account', async () => {
    await assertSucceeds(deleteDoc(doc(ctxFor(OMER).firestore(), 'accounts', 'acc-omer')));
  });
  it('Omer (own edit) CANNOT delete another member\'s account', async () => {
    await assertFails(deleteDoc(doc(ctxFor(OMER).firestore(), 'accounts', 'acc-lilit')));
  });
});

describe('recurring — own-level read/create/update-reassignment boundary', () => {
  it('Omer (own) CAN read his own recurring item', async () => {
    await assertSucceeds(getDoc(doc(ctxFor(OMER).firestore(), 'recurring', 'rec-omer')));
  });
  it('Omer (own) CANNOT read another member\'s recurring item', async () => {
    await assertFails(getDoc(doc(ctxFor(OMER).firestore(), 'recurring', 'rec-lilit')));
  });
  it('Omer (own edit) CAN create a recurring item owned by himself', async () => {
    await assertSucceeds(setDoc(doc(ctxFor(OMER).firestore(), 'recurring', 'rec-omer-new'), {
      id: 'rec-omer-new', kind: 'expense', description: 'מנוי', amount: 30, chargeDay: 10,
      ownerId: 'omer-levy', status: 'active', startDate: '2026-01-01', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('Omer (own edit) CANNOT create a recurring item owned by someone else', async () => {
    await assertFails(setDoc(doc(ctxFor(OMER).firestore(), 'recurring', 'rec-forged'), {
      id: 'rec-forged', kind: 'expense', description: 'X', amount: 30, chargeDay: 10,
      ownerId: 'lilit-levy', status: 'active', startDate: '2026-01-01', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('Omer (own edit) CANNOT reassign his own recurring item\'s ownerId on update', async () => {
    await assertFails(updateDoc(doc(ctxFor(OMER).firestore(), 'recurring', 'rec-omer'), { ownerId: 'lilit-levy' }));
  });
  it('Lilit (parent) CAN reassign a recurring item\'s ownerId on update', async () => {
    await assertSucceeds(updateDoc(doc(ctxFor(LILIT).firestore(), 'recurring', 'rec-omer'), { ownerId: 'lilit-levy' }));
  });
  it('Omer (own edit) CAN update his own recurring item\'s status without touching ownerId', async () => {
    await assertSucceeds(updateDoc(doc(ctxFor(OMER).firestore(), 'recurring', 'rec-omer'), { status: 'paused', updatedAt: 'y' }));
  });
});

describe('loans — Omer has own/own; Restricted has view:own/edit:none (the differentiated shape)', () => {
  it('Omer (own) CAN read his own loan', async () => {
    await assertSucceeds(getDoc(doc(ctxFor(OMER).firestore(), 'loans', 'loan-omer')));
  });
  it('Omer (own) CANNOT read another member\'s loan', async () => {
    await assertFails(getDoc(doc(ctxFor(OMER).firestore(), 'loans', 'loan-restricted')));
  });
  it('Omer (own edit) CAN create a loan owned by himself', async () => {
    await assertSucceeds(setDoc(doc(ctxFor(OMER).firestore(), 'loans', 'loan-omer-new'), {
      id: 'loan-omer-new', ownerId: 'omer-levy', name: 'X', loanType: 'other', principal: 100,
      balance: 100, interestRate: 1, monthlyPayment: 10, startDate: '2026-01-01', endDate: '2027-01-01',
      status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('Omer (own edit) CANNOT create a loan owned by someone else', async () => {
    await assertFails(setDoc(doc(ctxFor(OMER).firestore(), 'loans', 'loan-forged'), {
      id: 'loan-forged', ownerId: 'lilit-levy', name: 'X', loanType: 'other', principal: 100,
      balance: 100, interestRate: 1, monthlyPayment: 10, startDate: '2026-01-01', endDate: '2027-01-01',
      status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('Omer (own edit) CANNOT reassign his own loan\'s ownerId on update', async () => {
    await assertFails(updateDoc(doc(ctxFor(OMER).firestore(), 'loans', 'loan-omer'), { ownerId: 'lilit-levy' }));
  });
  it('Lilit (parent) CAN reassign a loan\'s ownerId on update', async () => {
    await assertSucceeds(updateDoc(doc(ctxFor(LILIT).firestore(), 'loans', 'loan-omer'), { ownerId: 'lilit-levy' }));
  });
  it('Restricted (view:own on loans) CAN read her own loan', async () => {
    await assertSucceeds(getDoc(doc(ctxFor(RESTRICTED).firestore(), 'loans', 'loan-restricted')));
  });
  it('Restricted (view:own) CANNOT read another member\'s loan', async () => {
    await assertFails(getDoc(doc(ctxFor(RESTRICTED).firestore(), 'loans', 'loan-omer')));
  });
  it('Restricted (edit:none on loans) CANNOT update her own loan despite view:own', async () => {
    await assertFails(updateDoc(doc(ctxFor(RESTRICTED).firestore(), 'loans', 'loan-restricted'), { balance: 3000 }));
  });
  it('Restricted (edit:none on loans) CANNOT create a loan even owned by herself', async () => {
    await assertFails(setDoc(doc(ctxFor(RESTRICTED).firestore(), 'loans', 'loan-restricted-new'), {
      id: 'loan-restricted-new', ownerId: 'restricted-levy', name: 'X', loanType: 'other', principal: 100,
      balance: 100, interestRate: 1, monthlyPayment: 10, startDate: '2026-01-01', endDate: '2027-01-01',
      status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
});

describe('insurances — Omer has own/own; Restricted has none/none (denied entirely)', () => {
  it('Omer (own) CAN read his own insurance doc', async () => {
    await assertSucceeds(getDoc(doc(ctxFor(OMER).firestore(), 'insurances', 'ins-omer')));
  });
  it('Omer (own) CANNOT read another member\'s insurance doc', async () => {
    await assertFails(getDoc(doc(ctxFor(OMER).firestore(), 'insurances', 'ins-lilit')));
  });
  it('Omer (own edit) CAN create an insurance doc owned by himself', async () => {
    await assertSucceeds(setDoc(doc(ctxFor(OMER).firestore(), 'insurances', 'ins-omer-new'), {
      id: 'ins-omer-new', type: 'life', provider: 'X', insuredMemberId: 'omer-levy', ownerId: 'omer-levy',
      premium: 50, premiumFrequency: 'yearly', coverages: [], renewalDate: '2027-01-01',
      status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('Omer (own edit) CANNOT create an insurance doc owned by someone else', async () => {
    await assertFails(setDoc(doc(ctxFor(OMER).firestore(), 'insurances', 'ins-forged'), {
      id: 'ins-forged', type: 'life', provider: 'X', insuredMemberId: 'lilit-levy', ownerId: 'lilit-levy',
      premium: 50, premiumFrequency: 'yearly', coverages: [], renewalDate: '2027-01-01',
      status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('Omer (own edit) CANNOT reassign his own insurance doc\'s ownerId on update', async () => {
    await assertFails(updateDoc(doc(ctxFor(OMER).firestore(), 'insurances', 'ins-omer'), { ownerId: 'lilit-levy' }));
  });
  it('Lilit (parent) CAN reassign an insurance doc\'s ownerId on update', async () => {
    await assertSucceeds(updateDoc(doc(ctxFor(LILIT).firestore(), 'insurances', 'ins-omer'), { ownerId: 'lilit-levy' }));
  });
  it('Restricted (none/none on insurances) CANNOT read even a doc she would otherwise have no relation to', async () => {
    await assertFails(getDoc(doc(ctxFor(RESTRICTED).firestore(), 'insurances', 'ins-lilit')));
  });
  it('Restricted (none/none on insurances) CANNOT create an insurance doc even owned by herself', async () => {
    await assertFails(setDoc(doc(ctxFor(RESTRICTED).firestore(), 'insurances', 'ins-restricted-new'), {
      id: 'ins-restricted-new', type: 'health', provider: 'X', insuredMemberId: 'restricted-levy', ownerId: 'restricted-levy',
      premium: 50, premiumFrequency: 'monthly', coverages: [], renewalDate: '2027-01-01',
      status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// Shape validation — missing required field / wrong type / bad enum, per collection
// ────────────────────────────────────────────────────────────────────────────────
describe('accounts — shape validation (isValidAccount)', () => {
  it('rejects create missing ownerId', async () => {
    await assertFails(setDoc(doc(ctxFor(DAVID).firestore(), 'accounts', 'bad-no-owner'), {
      id: 'bad-no-owner', name: 'X', type: 'cash', balance: 100, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('rejects create with balance as wrong type (string, not number)', async () => {
    await assertFails(setDoc(doc(ctxFor(DAVID).firestore(), 'accounts', 'bad-type'), {
      id: 'bad-type', ownerId: 'david-levy', name: 'X', type: 'cash', balance: '100', balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('rejects create with a bad status enum value', async () => {
    await assertFails(setDoc(doc(ctxFor(DAVID).firestore(), 'accounts', 'bad-status'), {
      id: 'bad-status', ownerId: 'david-levy', name: 'X', type: 'cash', balance: 100, balanceUpdatedAt: 'x', status: 'deleted', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('a fully valid account create succeeds (control)', async () => {
    await assertSucceeds(setDoc(doc(ctxFor(DAVID).firestore(), 'accounts', 'good-1'), {
      id: 'good-1', ownerId: 'david-levy', name: 'X', type: 'cash', balance: 100, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('an update that flips status to an invalid enum value is rejected even though pre-image authorization passes', async () => {
    await assertFails(updateDoc(doc(ctxFor(DAVID).firestore(), 'accounts', 'acc-omer'), { status: 'not-a-status' }));
  });
});

describe('recurring — shape validation (isValidRecurring)', () => {
  it('rejects create missing ownerId', async () => {
    await assertFails(setDoc(doc(ctxFor(DAVID).firestore(), 'recurring', 'bad-no-owner'), {
      id: 'bad-no-owner', kind: 'expense', description: 'X', amount: 10, chargeDay: 5, status: 'active', startDate: '2026-01-01', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('rejects create with amount as wrong type (string, not number)', async () => {
    await assertFails(setDoc(doc(ctxFor(DAVID).firestore(), 'recurring', 'bad-type'), {
      id: 'bad-type', kind: 'expense', description: 'X', amount: '10', chargeDay: 5, ownerId: 'david-levy', status: 'active', startDate: '2026-01-01', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('rejects create with a bad status enum value', async () => {
    await assertFails(setDoc(doc(ctxFor(DAVID).firestore(), 'recurring', 'bad-status'), {
      id: 'bad-status', kind: 'expense', description: 'X', amount: 10, chargeDay: 5, ownerId: 'david-levy', status: 'cancelled', startDate: '2026-01-01', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('rejects create with non-positive amount', async () => {
    await assertFails(setDoc(doc(ctxFor(DAVID).firestore(), 'recurring', 'bad-amount'), {
      id: 'bad-amount', kind: 'expense', description: 'X', amount: 0, chargeDay: 5, ownerId: 'david-levy', status: 'active', startDate: '2026-01-01', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('an update that flips status to an invalid enum value is rejected even though pre-image authorization passes', async () => {
    await assertFails(updateDoc(doc(ctxFor(DAVID).firestore(), 'recurring', 'rec-omer'), { status: 'cancelled' }));
  });
});

describe('loans — shape validation (isValidLoan)', () => {
  it('rejects create missing ownerId', async () => {
    await assertFails(setDoc(doc(ctxFor(DAVID).firestore(), 'loans', 'bad-no-owner'), {
      id: 'bad-no-owner', name: 'X', loanType: 'personal', principal: 100, balance: 100, interestRate: 1, monthlyPayment: 10, startDate: '2026-01-01', endDate: '2027-01-01', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('rejects create with principal as wrong type (string, not number)', async () => {
    await assertFails(setDoc(doc(ctxFor(DAVID).firestore(), 'loans', 'bad-type'), {
      id: 'bad-type', ownerId: 'david-levy', name: 'X', loanType: 'personal', principal: '100', balance: 100, interestRate: 1, monthlyPayment: 10, startDate: '2026-01-01', endDate: '2027-01-01', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('rejects create with a bad status enum value', async () => {
    await assertFails(setDoc(doc(ctxFor(DAVID).firestore(), 'loans', 'bad-status'), {
      id: 'bad-status', ownerId: 'david-levy', name: 'X', loanType: 'personal', principal: 100, balance: 100, interestRate: 1, monthlyPayment: 10, startDate: '2026-01-01', endDate: '2027-01-01', status: 'defaulted', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('rejects create with a bad loanType enum value', async () => {
    await assertFails(setDoc(doc(ctxFor(DAVID).firestore(), 'loans', 'bad-loantype'), {
      id: 'bad-loantype', ownerId: 'david-levy', name: 'X', loanType: 'friendly', principal: 100, balance: 100, interestRate: 1, monthlyPayment: 10, startDate: '2026-01-01', endDate: '2027-01-01', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('an update that flips status to an invalid enum value is rejected even though pre-image authorization passes', async () => {
    await assertFails(updateDoc(doc(ctxFor(DAVID).firestore(), 'loans', 'loan-omer'), { status: 'defaulted' }));
  });
});

describe('insurances — shape validation (isValidInsurance)', () => {
  it('rejects create missing ownerId', async () => {
    await assertFails(setDoc(doc(ctxFor(DAVID).firestore(), 'insurances', 'bad-no-owner'), {
      id: 'bad-no-owner', type: 'health', provider: 'X', insuredMemberId: 'david-levy', premium: 100, premiumFrequency: 'monthly', coverages: [], renewalDate: '2027-01-01', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('rejects create with premium as wrong type (string, not number)', async () => {
    await assertFails(setDoc(doc(ctxFor(DAVID).firestore(), 'insurances', 'bad-type'), {
      id: 'bad-type', type: 'health', provider: 'X', insuredMemberId: 'david-levy', ownerId: 'david-levy', premium: '100', premiumFrequency: 'monthly', coverages: [], renewalDate: '2027-01-01', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('rejects create with a bad status enum value', async () => {
    await assertFails(setDoc(doc(ctxFor(DAVID).firestore(), 'insurances', 'bad-status'), {
      id: 'bad-status', type: 'health', provider: 'X', insuredMemberId: 'david-levy', ownerId: 'david-levy', premium: 100, premiumFrequency: 'monthly', coverages: [], renewalDate: '2027-01-01', status: 'expired', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('rejects create with a bad type enum value', async () => {
    await assertFails(setDoc(doc(ctxFor(DAVID).firestore(), 'insurances', 'bad-insurance-type'), {
      id: 'bad-insurance-type', type: 'spaceship', provider: 'X', insuredMemberId: 'david-levy', ownerId: 'david-levy', premium: 100, premiumFrequency: 'monthly', coverages: [], renewalDate: '2027-01-01', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('an update that flips status to an invalid enum value is rejected even though pre-image authorization passes', async () => {
    await assertFails(updateDoc(doc(ctxFor(DAVID).firestore(), 'insurances', 'ins-omer'), { status: 'expired' }));
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// 'family' level — grants cross-member access on every one of the four collections
// ────────────────────────────────────────────────────────────────────────────────
describe('family-level access — "family" grants cross-member read+write on all four collections', () => {
  const seedFamilyMember = async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'members', 'family-levy'), {
        id: 'family-levy', name: 'משפחה', role: 'ילד', color: '#112233', groups: [], uid: 'uid-family', createdAt: 'x', updatedAt: 'x',
        resolvedPermissions: {
          accounts: { view: 'family', edit: 'family' },
          recurring: { view: 'family', edit: 'family' },
          loans: { view: 'family', edit: 'family' },
          insurances: { view: 'family', edit: 'family' },
        },
      });
    });
    return testEnv.authenticatedContext('uid-family', { role: 'member', memberId: 'family-levy' }).firestore();
  };

  it('family-level member CAN read an account owned by someone else', async () => {
    const db = await seedFamilyMember();
    await assertSucceeds(getDoc(doc(db, 'accounts', 'acc-lilit')));
  });
  // Task 8 review Missing (1): the existing coverage above only proved read + update
  // cross-owner; the parent-bypass create test (line ~519) exercises isSuperAdmin()/isParent(),
  // a DIFFERENT code path from a 'family'-level MEMBER token going through ownedModuleAllowed().
  // Per D2/D9 (confirmed by the Task 7 attack review: "'family' CAN create cross-owner — by
  // design, e.g. managing an account for a child with no login"), a 'family' edit level must
  // let a member-role token create a doc whose ownerId is a DIFFERENT member. One collection
  // (accounts) suffices — the ownedModuleAllowed()/canAccessOwnedModule() helper this exercises
  // is shared verbatim across all four owned collections (accounts/recurring/loans/insurances).
  it('family-level member CAN create an account whose ownerId is a DIFFERENT member (D2/D9 cross-owner create, member-role token, not parent)', async () => {
    const db = await seedFamilyMember();
    await assertSucceeds(setDoc(doc(db, 'accounts', 'acc-by-family-member'), {
      id: 'acc-by-family-member', ownerId: 'omer-levy', name: 'לעומר', type: 'cash', balance: 1,
      balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('family-level member CAN update an account owned by someone else (not just read)', async () => {
    const db = await seedFamilyMember();
    await assertSucceeds(updateDoc(doc(db, 'accounts', 'acc-lilit'), { balance: 1, balanceUpdatedAt: 'y', updatedAt: 'y' }));
  });
  it('family-level member CAN read a recurring item owned by someone else', async () => {
    const db = await seedFamilyMember();
    await assertSucceeds(getDoc(doc(db, 'recurring', 'rec-omer')));
  });
  it('family-level member CAN read a loan owned by someone else', async () => {
    const db = await seedFamilyMember();
    await assertSucceeds(getDoc(doc(db, 'loans', 'loan-omer')));
  });
  it('family-level member CAN read an insurance doc owned by someone else', async () => {
    const db = await seedFamilyMember();
    await assertSucceeds(getDoc(doc(db, 'insurances', 'ins-lilit')));
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// No permissions at all / pre-Stage-3 shape — fail-closed default, no migration required
// ────────────────────────────────────────────────────────────────────────────────
describe('no-permissions member — denied everything on all four collections (fail-closed default)', () => {
  const seedNoPerms = async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'members', 'noperm-levy'), {
        id: 'noperm-levy', name: 'ללא', role: 'ילד', color: '#445566', groups: [], uid: 'uid-noperm', createdAt: 'x', updatedAt: 'x',
        // no resolvedPermissions field at all
      });
    });
    return testEnv.authenticatedContext('uid-noperm', { role: 'member', memberId: 'noperm-levy' }).firestore();
  };

  it('denied read on accounts', async () => {
    const db = await seedNoPerms();
    await assertFails(getDoc(doc(db, 'accounts', 'acc-omer')));
  });
  it('denied create on accounts, even for a doc it would own', async () => {
    const db = await seedNoPerms();
    await assertFails(setDoc(doc(db, 'accounts', 'noperm-new'), {
      id: 'noperm-new', ownerId: 'noperm-levy', name: 'X', type: 'cash', balance: 1, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('denied read on recurring', async () => {
    const db = await seedNoPerms();
    await assertFails(getDoc(doc(db, 'recurring', 'rec-omer')));
  });
  it('denied read on loans', async () => {
    const db = await seedNoPerms();
    await assertFails(getDoc(doc(db, 'loans', 'loan-omer')));
  });
  it('denied read on insurances', async () => {
    const db = await seedNoPerms();
    await assertFails(getDoc(doc(db, 'insurances', 'ins-omer')));
  });
});

describe('old-shape resolvedPermissions (pre-Stage-3, no accounts/recurring/loans/insurances keys) — denied on all four, no migration needed', () => {
  const seedOldShape = async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'members', 'oldshape-levy'), {
        id: 'oldshape-levy', name: 'ישן', role: 'ילד', color: '#778899', groups: [], uid: 'uid-oldshape', createdAt: 'x', updatedAt: 'x',
        // Stage 2-shaped resolvedPermissions — predates the four new module keys entirely.
        resolvedPermissions: {
          expenses: { view: 'family', edit: 'family' },
          income: { view: 'family', edit: 'family' },
        },
      });
    });
    return testEnv.authenticatedContext('uid-oldshape', { role: 'member', memberId: 'oldshape-levy' }).firestore();
  };

  it('denied read on accounts despite family-level access on the old expenses/income modules', async () => {
    const db = await seedOldShape();
    await assertFails(getDoc(doc(db, 'accounts', 'acc-omer')));
  });
  it('denied read on recurring', async () => {
    const db = await seedOldShape();
    await assertFails(getDoc(doc(db, 'recurring', 'rec-omer')));
  });
  it('denied read on loans', async () => {
    const db = await seedOldShape();
    await assertFails(getDoc(doc(db, 'loans', 'loan-omer')));
  });
  it('denied read on insurances', async () => {
    const db = await seedOldShape();
    await assertFails(getDoc(doc(db, 'insurances', 'ins-omer')));
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// Parent + super-admin bypass — proven directly on every one of the four collections
// ────────────────────────────────────────────────────────────────────────────────
describe('parent and super-admin bypass the matrix entirely, on all four collections', () => {
  it('Lilit (parent) CAN read every account regardless of resolvedPermissions', async () => {
    await assertSucceeds(getDoc(doc(ctxFor(LILIT).firestore(), 'accounts', 'acc-omer')));
  });
  it('David (super-admin) CAN read every account regardless of resolvedPermissions', async () => {
    await assertSucceeds(getDoc(doc(ctxFor(DAVID).firestore(), 'accounts', 'acc-omer')));
  });
  it('Lilit (parent) CAN create an account owned by someone else (trusted bypass, unlike an "own" editor)', async () => {
    await assertSucceeds(setDoc(doc(ctxFor(LILIT).firestore(), 'accounts', 'acc-by-parent'), {
      id: 'acc-by-parent', ownerId: 'omer-levy', name: 'X', type: 'cash', balance: 1, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('David (super-admin) CAN read every recurring item regardless of resolvedPermissions', async () => {
    await assertSucceeds(getDoc(doc(ctxFor(DAVID).firestore(), 'recurring', 'rec-omer')));
  });
  it('Lilit (parent) CAN read every loan regardless of resolvedPermissions', async () => {
    await assertSucceeds(getDoc(doc(ctxFor(LILIT).firestore(), 'loans', 'loan-omer')));
  });
  it('David (super-admin) CAN read every insurance doc regardless of resolvedPermissions', async () => {
    await assertSucceeds(getDoc(doc(ctxFor(DAVID).firestore(), 'insurances', 'ins-omer')));
  });
  it('Lilit (parent) CAN write (delete) an insurance doc she does not own', async () => {
    await assertSucceeds(deleteDoc(doc(ctxFor(LILIT).firestore(), 'insurances', 'ins-omer')));
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// D7 atomic writeBatch — the literal scenario D7 exists for (Task 8 review Missing (2)).
//
// D7 broadened audit_log create from ['super-admin','parent'] to also allow 'member', because
// RecurringService's catch-up engine (src/services/RecurringService.ts, postDuePeriods) writes
// a financial doc (transaction_lines/incomes) + an audit_log entry + a lastPostedPeriod update
// to the recurring item, ALL in ONE writeBatch, and Firestore batches are all-or-nothing.
// Before D7, a member-role session could never successfully self-post even a fully-owned
// recurring item — the audit_log write inside the batch would deny the whole thing. This is
// that end-to-end batch, proven directly (not just the single-doc audit_log probe in
// permissions.rules.test.ts).
// ────────────────────────────────────────────────────────────────────────────────
describe('D7 atomic writeBatch — member-role recurring catch-up posting (financial doc + audit_log + lastPostedPeriod, one batch)', () => {
  const seedPoster = async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'members', 'poster-levy'), {
        id: 'poster-levy', name: 'פוסטר', role: 'ילד', color: '#334455', groups: [], uid: 'uid-poster',
        createdAt: 'x', updatedAt: 'x',
        resolvedPermissions: {
          recurring: { view: 'own', edit: 'own' },
          expenses: { view: 'own', edit: 'own' },
        },
      });
      await setDoc(doc(db, 'recurring', 'rec-poster'), {
        id: 'rec-poster', kind: 'expense', description: 'מנוי', amount: 50, category: 'שונות',
        chargeDay: 5, ownerId: 'poster-levy', status: 'active', startDate: '2026-01-01',
        createdAt: 'x', updatedAt: 'x',
      });
    });
    return testEnv.authenticatedContext('uid-poster', { role: 'member', memberId: 'poster-levy' }).firestore();
  };

  it('CAN commit the full atomic batch as a member-role token: transaction_lines create + audit_log create + recurring lastPostedPeriod update', async () => {
    const db = await seedPoster();
    const batch = writeBatch(db);
    // (a) transaction_lines create owned by this member — note expensesAllowed() compares
    // data.owner (the member DOC's `name` field), not ownerId/memberId, unlike the four
    // ownedModuleAllowed() collections above.
    batch.set(doc(db, 'transaction_lines', 'rec-poster__2026-02'), {
      owner: 'פוסטר', amount: 50, date: '2026-02-05', category: 'שונות', description: 'מנוי',
      isCredit: false, expenseClassification: 'Fixed', recurringId: 'rec-poster', recurringPeriod: '2026-02',
    });
    // (b) audit_log create, correctly attributed to the acting member (anti-spoof binding).
    batch.set(doc(db, 'audit_log', 'log-poster-1'), {
      actorMemberId: 'poster-levy', action: 'recurring.autopost', target: 'recurring/rec-poster', at: 'x',
    });
    // (c) update to the member's own recurring doc, advancing lastPostedPeriod.
    batch.update(doc(db, 'recurring', 'rec-poster'), { lastPostedPeriod: '2026-02', updatedAt: 'y' });
    await assertSucceeds(batch.commit());
  });

  it('the WHOLE batch fails when the audit_log entry spoofs a different actorMemberId (anti-spoof binding holds even inside an otherwise-legitimate batch)', async () => {
    const db = await seedPoster();
    const batch = writeBatch(db);
    batch.set(doc(db, 'transaction_lines', 'rec-poster__2026-02'), {
      owner: 'פוסטר', amount: 50, date: '2026-02-05', category: 'שונות', description: 'מנוי',
      isCredit: false, expenseClassification: 'Fixed', recurringId: 'rec-poster', recurringPeriod: '2026-02',
    });
    batch.set(doc(db, 'audit_log', 'log-poster-2'), {
      actorMemberId: 'lilit-levy', action: 'recurring.autopost', target: 'recurring/rec-poster', at: 'x', // spoofed
    });
    batch.update(doc(db, 'recurring', 'rec-poster'), { lastPostedPeriod: '2026-02', updatedAt: 'y' });
    await assertFails(batch.commit());
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// Task 8 review Minor — role-without-memberId is only proven generically on transaction_lines
// in permissions.rules.test.ts; one collection-specific probe on a new Stage 3 collection closes
// the gap (same code path — myMember() get() on an undefined memberId — but not yet re-proven
// here).
// ────────────────────────────────────────────────────────────────────────────────
describe('identity — malformed token (role present, memberId absent) on a new Stage 3 collection', () => {
  it('accounts read is denied — myMember() get() on an undefined memberId fails closed, not permissive', async () => {
    const db = testEnv.authenticatedContext('uid-role-only', { role: 'member' }).firestore();
    await assertFails(getDoc(doc(db, 'accounts', 'acc-omer')));
  });
});
