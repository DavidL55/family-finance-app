// src/__tests__/forecastTargets.test.ts — Stage 7 T6, D29. "מה צריך לקרות".
//
// This is the first thing this app ships that tells a family what to do with money, so the tests
// below are weighted toward the two places it can be confidently wrong rather than absent:
//
//   · THE REFUSAL. If the shortfall exceeds everything the family could possibly stop spending,
//     there is no allowance — and the arithmetic must SAY SO rather than produce a negative one.
//     A negative allowance is derived correctly and means nothing, and "spend −₪400 on groceries"
//     is the sort of output that ends a user's trust in a screen permanently. Tested at the
//     boundary in both directions, and mutated CHEAP-FOR-EXPENSIVE so a check that refuses earlier
//     cannot shadow it.
//   · THE SHAVE POOL. Telling a family to reduce their mortgage by 4% makes the whole line
//     unusable. Only STATISTICAL categories are shaved, and `flexible: false` takes one out.
import { describe, expect, it } from 'vitest';
import {
  ALLOWANCE_LEAD_MAX,
  budgetConfigTargetILS,
  computeAllowance,
  flexibleCategoryIds,
  parseHebrewGoalPeriod,
  resolveGoalTargets,
  resolveTarget,
  type AllowanceCategory,
  type GoalRecord,
} from '../utils/forecastTargets';
import { HEBREW_MONTH_NAMES } from '../config/hebrewMonths';
import type { ForecastAssumption } from '../types/finance';

const HORIZON = ['2026-09', '2026-10', '2026-11'];

const goal = (over: Partial<GoalRecord> = {}): GoalRecord => ({
  firestoreId: 'g1',
  name: 'חופשה משפחתית',
  target: 15000,
  current: 3000,
  date: 'אוקטובר 2026',
  ...over,
});

const assumption = (over: Partial<ForecastAssumption> = {}): ForecastAssumption =>
  ({
    id: 'fa-1',
    ownerId: 'omer',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    scopeKind: 'personalTarget',
    scopeId: 'omer',
    fromPeriod: '2026-09',
    amountILS: 500,
    reasonHe: 'אופניים',
    source: 'user',
    status: 'active',
    ...over,
  }) as ForecastAssumption;

const category = (categoryId: string, projectedILS: number): AllowanceCategory => ({
  categoryId,
  projectedILS,
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// parseHebrewGoalPeriod — `goals.date` is a Hebrew month NAME plus a year
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('parseHebrewGoalPeriod reads what the goal form actually writes', () => {
  it('parses every one of the twelve names the form offers', () => {
    // Driven off the SHARED array rather than a list typed here. If the two ever diverge this test
    // cannot notice — which is exactly why the array is MOVED and not copied (D29c, the F4 class).
    HEBREW_MONTH_NAMES.forEach((name, index) => {
      const expected = `2026-${String(index + 1).padStart(2, '0')}`;
      expect(parseHebrewGoalPeriod(`${name} 2026`)).toBe(expected);
    });
  });

  it('tolerates the whitespace a hand-edited document carries', () => {
    expect(parseHebrewGoalPeriod('  ספטמבר   2026 ')).toBe('2026-09');
  });

  it('refuses everything that is not that shape, rather than guessing a month', () => {
    expect(parseHebrewGoalPeriod('2026-09')).toBeNull();
    expect(parseHebrewGoalPeriod('ספטמבר')).toBeNull();
    expect(parseHebrewGoalPeriod('2026')).toBeNull();
    expect(parseHebrewGoalPeriod('Sept 2026')).toBeNull();
    expect(parseHebrewGoalPeriod('ספטמבר 26')).toBeNull();
    expect(parseHebrewGoalPeriod('ספטמבר 2026 15')).toBeNull();
    expect(parseHebrewGoalPeriod('')).toBeNull();
    expect(parseHebrewGoalPeriod(undefined)).toBeNull();
    expect(parseHebrewGoalPeriod(2026)).toBeNull();
  });

  it('refuses a year that would not make a valid period', () => {
    expect(parseHebrewGoalPeriod('ספטמבר 026')).toBeNull();
    expect(parseHebrewGoalPeriod('ספטמבר 20261')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D29(c) — unparseable goals are EXCLUDED WITH A VISIBLE COUNT
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('resolveGoalTargets counts what it cannot read instead of dropping it', () => {
  it('keeps a goal due inside the horizon, with what is still missing on it', () => {
    const resolved = resolveGoalTargets([goal()], HORIZON);
    expect(resolved.targets).toEqual([
      { name: 'חופשה משפחתית', duePeriod: '2026-10', remainingILS: 12000 },
    ]);
    expect(resolved.excludedCount).toBe(0);
    expect(resolved.beyondHorizonCount).toBe(0);
  });

  it('COUNTS an unreadable date rather than discarding it silently', () => {
    const resolved = resolveGoalTargets([goal(), goal({ firestoreId: 'g2', date: 'בקרוב' })], HORIZON);
    expect(resolved.targets).toHaveLength(1);
    expect(resolved.excludedCount).toBe(1);
  });

  it('counts an unreadable AMOUNT too — a goal with no number is not a target', () => {
    const resolved = resolveGoalTargets([goal({ target: 'הרבה' })], HORIZON);
    expect(resolved.targets).toHaveLength(0);
    expect(resolved.excludedCount).toBe(1);
  });

  it('separates "due later" from "unreadable" — a 2030 goal is not a defect', () => {
    const resolved = resolveGoalTargets([goal({ date: 'דצמבר 2030' })], HORIZON);
    expect(resolved.targets).toHaveLength(0);
    expect(resolved.excludedCount).toBe(0);
    expect(resolved.beyondHorizonCount).toBe(1);
  });

  it('drops a goal already fully funded to ZERO remaining, not to a negative one', () => {
    const resolved = resolveGoalTargets([goal({ current: 20000 })], HORIZON);
    expect(resolved.targets).toHaveLength(0);
    expect(resolved.excludedCount).toBe(0);
  });

  it('treats a goal due BEFORE the horizon as in scope — it is overdue, not irrelevant', () => {
    // A goal whose date has passed still needs funding, and dropping it would quietly reduce the
    // target the day it slipped.
    const resolved = resolveGoalTargets([goal({ date: 'ינואר 2026' })], HORIZON);
    expect(resolved.targets).toHaveLength(1);
    expect(resolved.beyondHorizonCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D29(c) — `settings/budgetConfig`: unreadable, absent and empty are the SAME calm answer
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('budgetConfigTargetILS never fabricates a target', () => {
  it('returns null for the document the real corpus actually holds', () => {
    // T0 measured `settings/budgetConfig` as `{"members": []}` — an EMPTY array. There are zero
    // targets of any kind in this family's data, so day one has no target source with data in it,
    // and the correct output is "no line" rather than "₪0 target".
    expect(budgetConfigTargetILS({ members: [] })).toBeNull();
  });

  it('returns null for unreadable and for absent, which are the same answer to the reader', () => {
    // `settings/{docId}` is parent-or-super-admin READ, so a 'member' session gets a
    // permission-denied here. The caller passes `null` for both that and a missing document
    // because there is nothing a family member can do differently about either.
    expect(budgetConfigTargetILS(null)).toBeNull();
    expect(budgetConfigTargetILS(undefined)).toBeNull();
  });

  it('reads a real period target when one is there', () => {
    expect(budgetConfigTargetILS({ members: [], periodTargetILS: 12000 })).toBe(12000);
  });

  it('refuses a non-number, a negative, and a zero', () => {
    expect(budgetConfigTargetILS({ periodTargetILS: '12000' })).toBeNull();
    expect(budgetConfigTargetILS({ periodTargetILS: -5 })).toBeNull();
    expect(budgetConfigTargetILS({ periodTargetILS: 0 })).toBeNull();
    expect(budgetConfigTargetILS({ periodTargetILS: Number.NaN })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// which target the screen is looking at
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('resolveTarget — the personal one first, the family one named as such', () => {
  it('has NO target, calmly, when nothing readable exists — the real day-one state', () => {
    const resolved = resolveTarget({
      memberId: null,
      horizon: HORIZON,
      assumptions: [],
      goals: [],
      budgetConfigDoc: { members: [] },
    });
    expect(resolved.status).toBe('none');
  });

  it("uses a member's own personalTarget on the 'own' screen", () => {
    const resolved = resolveTarget({
      memberId: 'omer',
      horizon: HORIZON,
      assumptions: [assumption()],
      goals: [goal()],
      budgetConfigDoc: null,
    });
    expect(resolved).toMatchObject({ status: 'target', source: 'personalTarget', amountILS: 500, isFamilyScoped: false });
  });

  it("does not lend one member's personalTarget to another member", () => {
    const resolved = resolveTarget({
      memberId: 'lilit',
      horizon: HORIZON,
      assumptions: [assumption()],
      goals: [],
      budgetConfigDoc: null,
    });
    expect(resolved.status).toBe('none');
  });

  it('ignores a personalTarget whose window does not cover the horizon, or that is retired', () => {
    for (const over of [{ fromPeriod: '2027-01' }, { toPeriod: '2026-08' }, { status: 'retired' as const }]) {
      const resolved = resolveTarget({
        memberId: 'omer',
        horizon: HORIZON,
        assumptions: [assumption(over)],
        goals: [],
        budgetConfigDoc: null,
      });
      expect(resolved.status).toBe('none');
    }
  });

  it('!! ignores a personalTarget ATTRIBUTED TO SOMEONE ELSE (sweep survivor M27)', () => {
    // Rules bind `ownerId == memberId()` on every write, so a client cannot author this. The Admin
    // SDK bypasses Rules and every seeder and migration in this repo runs on it — so a document
    // scoped to Omer but owned by David is reachable, and reading it would put another member's
    // stated target on Omer's screen as his own.
    const spoofed = assumption({ ownerId: 'david', scopeId: 'omer' });
    const resolved = resolveTarget({
      memberId: 'omer',
      horizon: HORIZON,
      assumptions: [spoofed],
      goals: [],
      budgetConfigDoc: null,
    });
    expect(resolved.status).toBe('none');
  });

  it("!! ignores a personalTarget the member OWNS but that is ABOUT someone else (sweep survivor M28)", () => {
    // The mirror of the case above, and the one every fixture missed because `scopeId === ownerId`
    // in all of them. Omer owning a target scoped at Maya is Maya's target, not his.
    const misScoped = assumption({ ownerId: 'omer', scopeId: 'maya' });
    const resolved = resolveTarget({
      memberId: 'omer',
      horizon: HORIZON,
      assumptions: [misScoped],
      goals: [],
      budgetConfigDoc: null,
    });
    expect(resolved.status).toBe('none');
  });

  it('falls back to the FAMILY goal for a member with no personal target, and says it is family', () => {
    // `goals` is ownerless, so a target read from one is a statement about the family. A per-member
    // line that shows it without saying so invites the member to read it as their own.
    const resolved = resolveTarget({
      memberId: 'lilit',
      horizon: HORIZON,
      assumptions: [],
      goals: [goal()],
      budgetConfigDoc: null,
    });
    expect(resolved).toMatchObject({ status: 'target', source: 'goal', amountILS: 12000, isFamilyScoped: true });
  });

  it('prefers budgetConfig over goals when it is readable and carries a number', () => {
    const resolved = resolveTarget({
      memberId: null,
      horizon: HORIZON,
      assumptions: [],
      goals: [goal()],
      budgetConfigDoc: { periodTargetILS: 9000 },
    });
    expect(resolved).toMatchObject({ status: 'target', source: 'budgetConfig', amountILS: 9000 });
  });

  it('sums every goal that falls in the horizon', () => {
    const resolved = resolveTarget({
      memberId: null,
      horizon: HORIZON,
      assumptions: [],
      goals: [goal(), goal({ firestoreId: 'g2', target: 3000, current: 0, date: 'נובמבר 2026' })],
      budgetConfigDoc: null,
    });
    expect(resolved).toMatchObject({ status: 'target', amountILS: 15000 });
  });

  it('carries the excluded count through even when it ends with no target at all', () => {
    const resolved = resolveTarget({
      memberId: null,
      horizon: HORIZON,
      assumptions: [],
      goals: [goal({ date: 'בקרוב' })],
      budgetConfigDoc: null,
    });
    expect(resolved.status).toBe('none');
    expect(resolved.goalsExcludedCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the shave pool — statistical only, and `flexible: false` honoured
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('flexibleCategoryIds — only what a family can actually choose not to spend', () => {
  const categories = [category('מסעדות', 2400), category('מזון וצריכה', 3000), category('בריאות', 900)];

  it('treats every statistical category as flexible until an assumption says otherwise', () => {
    expect(flexibleCategoryIds({ categories, assumptions: [], horizon: HORIZON }).sort()).toEqual(
      ['בריאות', 'מזון וצריכה', 'מסעדות'].sort()
    );
  });

  it('honours `flexible: false` on a category assumption', () => {
    const fixed = assumption({ scopeKind: 'category', scopeId: 'בריאות', flexible: false, amountILS: 900 });
    expect(flexibleCategoryIds({ categories, assumptions: [fixed], horizon: HORIZON })).not.toContain('בריאות');
  });

  it('ignores `flexible: false` on a RETIRED assumption, and on one outside the horizon', () => {
    const retired = assumption({ scopeKind: 'category', scopeId: 'בריאות', flexible: false, status: 'retired' });
    const past = assumption({ scopeKind: 'category', scopeId: 'בריאות', flexible: false, toPeriod: '2026-08' });
    expect(flexibleCategoryIds({ categories, assumptions: [retired], horizon: HORIZON })).toContain('בריאות');
    expect(flexibleCategoryIds({ categories, assumptions: [past], horizon: HORIZON })).toContain('בריאות');
  });

  it('ignores `flexible: false` on a scope kind that is not a category', () => {
    // A loan is not shaveable and is not in the statistical set to begin with; a `flexible` flag on
    // one is meaningless and must not be able to remove a same-named spend category.
    const loan = assumption({ scopeKind: 'loan', scopeId: 'בריאות', flexible: false });
    expect(flexibleCategoryIds({ categories, assumptions: [loan], horizon: HORIZON })).toContain('בריאות');
  });

  it('never invents a category the statistical layer did not produce', () => {
    const stray = assumption({ scopeKind: 'category', scopeId: 'משכנתא', flexible: true });
    expect(flexibleCategoryIds({ categories, assumptions: [stray], horizon: HORIZON })).not.toContain('משכנתא');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// !! THE ALLOWANCE, AND THE REFUSAL
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('computeAllowance', () => {
  const categories = [category('מסעדות', 2400), category('מזון וצריכה', 3000), category('פנאי ובילוי', 600)];
  const allFlexible = categories.map((c) => c.categoryId);

  it('has no line at all without a target — never a fabricated one', () => {
    expect(
      computeAllowance({ targetILS: null, projectedILS: 1000, categories, flexibleIds: allFlexible })
    ).toEqual({ status: 'no-target' });
  });

  it('says the target is already met rather than shaving nothing', () => {
    const result = computeAllowance({
      targetILS: 1000,
      projectedILS: 2500,
      categories,
      flexibleIds: allFlexible,
    });
    expect(result).toEqual({ status: 'target-met', surplusILS: 1500 });
  });

  it('!! a target met TO THE AGORA is met, not a shortfall of nothing (sweep survivor M39)', () => {
    // The exact boundary. With `< 0` instead of `<= 0` this falls through to the allowance branch
    // and produces a table of rows every one of which says "reduce by ₪0" — arithmetically correct
    // and, on the one screen that tells a family what to do, noise where a plain answer belongs.
    const exact = computeAllowance({
      targetILS: 2500,
      projectedILS: 2500,
      categories,
      flexibleIds: allFlexible,
    });
    expect(exact).toEqual({ status: 'target-met', surplusILS: 0 });
  });

  it('shaves proportionally, and every allowance is BELOW its own projection', () => {
    // shortfall 600 over a flexible total of 6000 → each category keeps 90% of its projection.
    const result = computeAllowance({
      targetILS: 1600,
      projectedILS: 1000,
      categories,
      flexibleIds: allFlexible,
    });
    if (result.status !== 'allowances') throw new Error(`expected allowances, got ${result.status}`);
    expect(result.shortfallILS).toBe(600);
    expect(result.rows).toEqual([
      { categoryId: 'מזון וצריכה', projectedILS: 3000, allowanceILS: 2700, reductionILS: 300, sharePct: 50 },
      { categoryId: 'מסעדות', projectedILS: 2400, allowanceILS: 2160, reductionILS: 240, sharePct: 40 },
      { categoryId: 'פנאי ובילוי', projectedILS: 600, allowanceILS: 540, reductionILS: 60, sharePct: 10 },
    ]);
  });

  it('RANKS BY SHEKELS and leads with the top few BY NAME — not with a percentage', () => {
    // A28: "reduce every flexible category by 12%" computes correctly and advises uselessly. The
    // rows are ordered by absolute shekel size, largest first, and the lead is one to three names.
    const result = computeAllowance({
      targetILS: 1600,
      projectedILS: 1000,
      categories,
      flexibleIds: allFlexible,
    });
    if (result.status !== 'allowances') throw new Error('expected allowances');
    expect(result.rows.map((r) => r.categoryId)).toEqual(['מזון וצריכה', 'מסעדות', 'פנאי ובילוי']);
    expect(result.leadCategoryIds).toEqual(['מזון וצריכה', 'מסעדות', 'פנאי ובילוי']);
  });

  it('leads with at most three, however many flexible categories there are', () => {
    const many = Array.from({ length: 9 }, (_, i) => category(`c${i}`, (i + 1) * 100));
    const result = computeAllowance({
      targetILS: 100,
      projectedILS: 0,
      categories: many,
      flexibleIds: many.map((c) => c.categoryId),
    });
    if (result.status !== 'allowances') throw new Error('expected allowances');
    expect(result.leadCategoryIds).toHaveLength(ALLOWANCE_LEAD_MAX);
    expect(result.leadCategoryIds).toEqual(['c8', 'c7', 'c6']);
  });

  it('breaks a shekel tie by category name, so the order is stable across renders', () => {
    const tied = [category('ב', 1000), category('א', 1000)];
    const result = computeAllowance({
      targetILS: 100,
      projectedILS: 0,
      categories: tied,
      flexibleIds: ['א', 'ב'],
    });
    if (result.status !== 'allowances') throw new Error('expected allowances');
    expect(result.rows.map((r) => r.categoryId)).toEqual(['א', 'ב']);
  });

  it('shaves ONLY the flexible categories, and leaves the rest at their projection', () => {
    // D29: telling a family to reduce their mortgage by 4% makes the whole line unusable.
    const withFixed = [...categories, category('משכנתא', 6000)];
    const result = computeAllowance({
      targetILS: 1600,
      projectedILS: 1000,
      categories: withFixed,
      flexibleIds: allFlexible,
    });
    if (result.status !== 'allowances') throw new Error('expected allowances');
    expect(result.rows.map((r) => r.categoryId)).not.toContain('משכנתא');
    // and the shave is computed over the FLEXIBLE total, not over everything: 600/6000 = 10%,
    // not 600/12000 = 5%. Including the fixed spend in the denominator understates every cut and
    // the period still misses the target.
    expect(result.rows[0].reductionILS).toBe(300);
  });

  // ── THE REFUSAL ────────────────────────────────────────────────────────────────────────────

  it('!! REFUSES when the shortfall exceeds everything that could be cut, and states the gap', () => {
    const result = computeAllowance({
      targetILS: 12000,
      projectedILS: 0,
      categories,
      flexibleIds: allFlexible,
    });
    expect(result).toEqual({
      status: 'unreachable',
      shortfallILS: 12000,
      flexibleTotalILS: 6000,
      gapILS: 6000,
    });
  });

  it('!! NEVER returns a negative allowance, at any shortfall', () => {
    // The property, not the instance. A negative allowance is arithmetically derived and
    // semantically meaningless, and it is what the refusal exists to prevent.
    for (const targetILS of [1, 100, 5999, 6000, 6001, 12000, 1e6]) {
      const result = computeAllowance({ targetILS, projectedILS: 0, categories, flexibleIds: allFlexible });
      if (result.status !== 'allowances') continue;
      for (const row of result.rows) {
        expect(row.allowanceILS).toBeGreaterThanOrEqual(0);
        expect(row.reductionILS).toBeLessThanOrEqual(row.projectedILS);
      }
    }
  });

  it('!! the boundary is EXACT: shortfall == flexible total allows, one agora more refuses', () => {
    // This is the pair that kills `>=` and `>` mutants of the refusal in opposite directions, and
    // it is written CHEAP-FOR-EXPENSIVE — the allowing case sits one agora BELOW the refusing one,
    // so a check that refused earlier (an empty pool, a non-positive projection, a zero total)
    // would have to refuse the allowing case too, and this test would fail on that side first.
    const exact = computeAllowance({ targetILS: 6000, projectedILS: 0, categories, flexibleIds: allFlexible });
    expect(exact.status).toBe('allowances');
    if (exact.status === 'allowances') {
      expect(exact.rows.every((r) => r.allowanceILS === 0)).toBe(true);
    }
    const overByAnAgora = computeAllowance({
      targetILS: 6000.01,
      projectedILS: 0,
      categories,
      flexibleIds: allFlexible,
    });
    expect(overByAnAgora.status).toBe('unreachable');
    if (overByAnAgora.status === 'unreachable') expect(overByAnAgora.gapILS).toBe(0.01);
  });

  it('!! refuses through its OWN condition when nothing is flexible — not through an empty-pool check', () => {
    // With no flexible categories the flexible total is 0 and any positive shortfall exceeds it, so
    // the refusal fires from the one comparison that owns it. There is deliberately no separate
    // "pool is empty" branch above it: a second refusal placed earlier is how the first one gets
    // shadowed, which is the defect class this stage has counted nineteen times.
    const result = computeAllowance({ targetILS: 500, projectedILS: 0, categories, flexibleIds: [] });
    expect(result).toEqual({
      status: 'unreachable',
      shortfallILS: 500,
      flexibleTotalILS: 0,
      gapILS: 500,
    });
  });

  it('a flexible id naming a category with no projection contributes nothing and breaks nothing', () => {
    const result = computeAllowance({
      targetILS: 600,
      projectedILS: 0,
      categories: [category('מסעדות', 2400), category('ריק', 0)],
      flexibleIds: ['מסעדות', 'ריק'],
    });
    if (result.status !== 'allowances') throw new Error('expected allowances');
    expect(result.rows.map((r) => r.categoryId)).toEqual(['מסעדות']);
  });

  it('rounds every displayed figure to agorot rather than leaking a float', () => {
    const result = computeAllowance({
      targetILS: 1000,
      projectedILS: 0,
      categories: [category('א', 333.33), category('ב', 666.67)],
      flexibleIds: ['א', 'ב'],
    });
    if (result.status !== 'allowances') throw new Error('expected allowances');
    for (const row of result.rows) {
      expect(row.allowanceILS).toBe(Math.round(row.allowanceILS * 100) / 100);
      expect(row.reductionILS).toBe(Math.round(row.reductionILS * 100) / 100);
    }
  });
});
