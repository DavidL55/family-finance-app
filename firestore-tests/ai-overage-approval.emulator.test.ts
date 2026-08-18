// ─────────────────────────────────────────────────────────────────────────────────────────────
// BATCH 8 (closing review B4) — SPEC §8's DONE CRITERION, PROVEN AGAINST A REAL FIRESTORE.
//
// The criterion is one sentence: "a subsequent aiChat call carrying that token succeeds exactly
// once." Until this batch it was unsatisfiable — nothing outside costGate.ts had ever heard of
// `approvalToken` — and the half of it that says EXACTLY ONCE cannot be proven where the rest of
// costGate is tested.
//
// WHY THIS FILE EXISTS AND WHY IT IS NOT IN functions/src/costGate/costGate.test.ts.
//
// That suite's `firebase-admin/firestore` mock is an in-memory store with NO conflict detection:
// its runTransaction just invokes the callback against shared state. Two concurrent
// consumeApproval calls there BOTH read `used: false` at their `await tx.get` and BOTH return
// true — a mock artifact, not a defect, and a "concurrency test" written against it would either
// fail for the wrong reason or be rewritten until it passed for the wrong reason. Single-use
// redemption is a property of Firestore's optimistic concurrency, so it has to be measured on
// Firestore. This is the same reason the closing review found B1/M1/M2 by booting the emulator
// and the unit suite did not.
//
// WHY firestore-tests/ AND NOT A NEW SUITE. `npm run test:rules` already boots an ephemeral
// Firestore emulator via `firebase emulators:exec` and runs vitest.rules.config.ts (node env, no
// jsdom, no src/__tests__/setup.ts) over this directory. Adding a fourth emulator boot to
// test:all to run one file would double the stage's slowest step for no additional coverage.
// This file uses the ADMIN SDK rather than @firebase/rules-unit-testing because costGate.ts does
// — it is the production code path being measured, not a rules assertion — and it runs under its
// own projectId so it shares no documents with any rules test in this directory.
//
// The two adapter modules are mocked only because @anthropic-ai/sdk and openai are functions/
// dependencies and are not installed at the repo root, so importing the real registry from here
// fails to RESOLVE. Nothing else is mocked: the registry, its real prices, quote(), spend(),
// requestOverageApproval and consumeApproval all run for real, against a real Firestore.
// ─────────────────────────────────────────────────────────────────────────────────────────────
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../functions/src/providers/anthropicAdapter', () => ({
  anthropicAdapter: {
    id: 'anthropic',
    isConfigured: () => false,
    generateText: async () => { throw new Error('not used'); },
    generateJson: async () => { throw new Error('not used'); },
  },
}));
vi.mock('../functions/src/providers/openaiAdapter', () => ({
  openaiAdapter: {
    id: 'openai',
    isConfigured: () => false,
    generateText: async () => { throw new Error('not used'); },
    generateJson: async () => { throw new Error('not used'); },
  },
}));

import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  quote, spend, requestOverageApproval, monthKey, ApprovalRequiredError, AI_USAGE_COUNTERS,
} from '../functions/src/costGate/costGate';

// A real, priced pair from the real registry — the arithmetic below is the shipping arithmetic,
// not a fixture's idea of it.
const PROVIDER = 'anthropic';
const MODEL = 'claude-sonnet-5';
const APPROVER = 'david-levy';
const SPENDER = 'david-levy';

let app: App;
let db: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set — this file must run inside `firebase emulators:exec` ' +
      '(npm run test:rules). Failing loudly rather than silently skipping: a concurrency proof ' +
      'that quietly does not run is worse than no proof at all.'
    );
  }
  // The DEFAULT app, deliberately: costGate.ts calls the bare `getFirestore()`, so a named app
  // would be invisible to the code under test. vitest.rules.config.ts dedupes firebase-admin for
  // the same reason — one SDK instance, one app registry, shared with functions/src.
  //
  // Its own projectId, so nothing here can collide with a rules test's data in the same emulator
  // (every rules test in this directory runs under a distinct `demo-familyfinance-*` project).
  app = initializeApp({ projectId: 'demo-ff-overage-approval' });
  db = getFirestore();
});

afterAll(async () => {
  await deleteApp(app);
});

/** Every collection this file writes, cleared between cases — the emulator is shared. */
async function wipe(): Promise<void> {
  for (const col of ['ai_usage', AI_USAGE_COUNTERS, 'ai_overage_approvals']) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await db.doc('settings/aiCostConfig').delete();
}

beforeEach(async () => {
  await wipe();
});

/** A quote big enough that no plausible ceiling admits it without an approval. */
function expensiveQuote() {
  return quote(PROVIDER, MODEL, 200_000, 50_000);
}

async function counterTotal(): Promise<number | undefined> {
  const snap = await db.doc(`${AI_USAGE_COUNTERS}/${PROVIDER}_${monthKey()}`).get();
  const v = snap.data()?.totalILS;
  return typeof v === 'number' ? v : undefined;
}

describe('the overage approval path, end to end on a real Firestore (closing review B4)', () => {
  it('THE DONE CRITERION: refused at the ceiling, then the SAME call carrying a fresh token succeeds', async () => {
    await db.doc('settings/aiCostConfig').set({ monthlyCeilingILS: 1 });
    const q = expensiveQuote();
    expect(q.estimatedILS).toBeGreaterThan(1); // otherwise the ceiling would admit it and this proves nothing

    const refusal = await spend(SPENDER, 'chat', q).catch((e) => e);
    expect(refusal).toBeInstanceOf(ApprovalRequiredError);
    expect((refusal as ApprovalRequiredError).reason).toBe('over-ceiling');
    // Nothing was spent by the refusal itself.
    expect(await counterTotal()).toBeUndefined();

    const { token } = await requestOverageApproval(APPROVER, 'super-admin', PROVIDER, q);
    const result = await spend(SPENDER, 'chat', q, token);
    expect(result.spent).toBe(true);
    expect(result.amountILS).toBeCloseTo(q.estimatedILS, 4);
    expect(await counterTotal()).toBeCloseTo(q.estimatedILS, 4);

    // …and the ledger entry records that an approval was used, so the overage is auditable rather
    // than indistinguishable from an ordinary under-ceiling call.
    const ledger = await db.doc(`ai_usage/${result.ledgerId}`).get();
    expect(ledger.data()?.approvalUsed).toBe(true);
  });

  it('SEQUENTIALLY single-use: the same token cannot be redeemed a second time', async () => {
    await db.doc('settings/aiCostConfig').set({ monthlyCeilingILS: 1 });
    const q = expensiveQuote();
    const { token } = await requestOverageApproval(APPROVER, 'super-admin', PROVIDER, q);

    await expect(spend(SPENDER, 'chat', q, token)).resolves.toMatchObject({ spent: true });
    await expect(spend(SPENDER, 'chat', q, token)).rejects.toBeInstanceOf(ApprovalRequiredError);
    // Exactly one charge landed on the counter, not two.
    expect(await counterTotal()).toBeCloseTo(q.estimatedILS, 4);
  });

  it('EXACTLY ONCE UNDER CONCURRENCY: eight simultaneous redemptions of one token admit exactly one', async () => {
    // This is the assertion the in-memory suite cannot make. consumeApproval reads the token
    // document and writes `used: true` inside one runTransaction; Firestore's conflict detection
    // on that read is what serialises eight racers into one winner. Eight, not two, so a lucky
    // interleaving cannot be mistaken for the guarantee.
    await db.doc('settings/aiCostConfig').set({ monthlyCeilingILS: 1 });
    const q = expensiveQuote();
    const { token } = await requestOverageApproval(APPROVER, 'super-admin', PROVIDER, q);

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => spend(SPENDER, 'chat', q, token).then(
        (r) => ({ ok: true as const, r }),
        (e: unknown) => ({ ok: false as const, e })
      ))
    );

    const admitted = outcomes.filter((o) => o.ok);
    const refused = outcomes.filter((o) => !o.ok);
    expect(admitted).toHaveLength(1);
    expect(refused).toHaveLength(7);
    // Every refusal is the ordinary cost-gate refusal — no crashes, no transaction aborts leaking
    // out as some other error class.
    for (const o of refused) {
      expect((o as { e: unknown }).e).toBeInstanceOf(ApprovalRequiredError);
    }
    // The money moved exactly once. A second redemption would show up here as 2x, which is the
    // failure this test exists to make impossible to ship.
    expect(await counterTotal()).toBeCloseTo(q.estimatedILS, 4);
    const ledger = await db.collection('ai_usage').get();
    expect(ledger.size).toBe(1);
  }, 30_000);

  it('a token is bound to its provider, model and amount — bd97326\'s binding holds on real data', async () => {
    // Re-measured here rather than trusted from the unit suite, because these three checks are
    // what stop a ₪1 approval from authorising an unbounded spend, and the unit suite reads them
    // through its own mock's idea of a stored document.
    await db.doc('settings/aiCostConfig').set({ monthlyCeilingILS: 1 });
    const cheap = quote(PROVIDER, MODEL, 1000, 100);
    const dear = expensiveQuote();
    expect(dear.estimatedILS).toBeGreaterThan(cheap.estimatedILS);

    const { token } = await requestOverageApproval(APPROVER, 'super-admin', PROVIDER, cheap);
    // Approved for the cheap call; redeemed against the expensive one.
    await expect(spend(SPENDER, 'chat', dear, token)).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(await counterTotal()).toBeUndefined();

    const other = await requestOverageApproval(APPROVER, 'super-admin', PROVIDER, quote(PROVIDER, 'claude-opus-5', 200_000, 50_000));
    // Approved for claude-opus-5; redeemed on claude-sonnet-5, same provider.
    await expect(spend(SPENDER, 'chat', dear, other.token)).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(await counterTotal()).toBeUndefined();
  });

  it('an overage token still cannot override a corrupt counter (bd97326) — an unreadable balance is not authorisable', async () => {
    // Preserved deliberately: approving "₪5 over the ceiling" presupposes knowing what has been
    // spent, and when a counter is unreadable nobody — including the approver — knows that.
    await db.doc('settings/aiCostConfig').set({ monthlyCeilingILS: 1000 });
    await db.doc(`${AI_USAGE_COUNTERS}/${PROVIDER}_${monthKey()}`).set({
      providerId: PROVIDER, month: monthKey(), totalILS: 'oops',
    });
    const q = expensiveQuote();
    const { token } = await requestOverageApproval(APPROVER, 'super-admin', PROVIDER, q);

    const err = await spend(SPENDER, 'chat', q, token).catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalRequiredError);
    expect((err as ApprovalRequiredError).reason).toBe('counter-corrupt');
    expect(await db.collection('ai_usage').get().then((s) => s.size)).toBe(0);
  });

  it('an expired token is refused, and the spend is not charged', async () => {
    await db.doc('settings/aiCostConfig').set({ monthlyCeilingILS: 1 });
    const q = expensiveQuote();
    const { token } = await requestOverageApproval(APPROVER, 'super-admin', PROVIDER, q);
    // Reach into the stored record rather than waiting 120 real seconds. The TTL itself is
    // costGate's; what is measured here is that the stored expiry is what gates redemption.
    await db.doc(`ai_overage_approvals/${token}`).update({ expiresAt: Date.now() - 1 });

    await expect(spend(SPENDER, 'chat', q, token)).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(await counterTotal()).toBeUndefined();
  });
});
