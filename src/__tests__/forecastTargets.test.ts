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
  computeAllowance,
  flexibleCategoryIds,
  parseHebrewGoalPeriod,
  resolveGoalTargets,
  resolveTarget,
  type AllowanceCategory,
  type GoalRecord,
} from '../utils/forecastTargets';
import { HEBREW_MONTH_NAMES } from '../config/hebrewMonths';
import { formatILS } from '../config/aiCeiling';
import { join, relative } from 'node:path';
import { SRC_ROOT, listSourceFiles, readSourceCached, stripComments } from './helpers/extractionSurfaces';
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

// ═════════════════════════════════════════════════════════════════════════════════════════════
// !! F6 — `periodTargetILS` WAS AN INVENTED FIELD, AND THE DOCUMENT IT WAS INVENTED ON MEANS
//         THE OPPOSITE THING. The whole source is gone; these are the guards that keep it gone.
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! F6 — there is no `budgetConfig` target source, and no invented field behind one', () => {
  // `stripComments` IS LOAD-BEARING HERE, unlike in the copy guards where the parser was the
  // mechanism all along: this is a raw text scan, and the remaining mentions of the name in the tree
  // are PROSE in `forecastTargets.ts`'s own header explaining why the field is gone. A ban on code
  // must not read the argument for the ban. The name is ASSEMBLED rather than written so that this
  // file could be added to the scanned set without the guard going red on itself — `listSourceFiles`
  // skips `__tests__` today, and that is a property of the helper rather than a decision of this
  // guard's.
  const INVENTED_FIELD = ['period', 'Target', 'ILS'].join('');

  it('the invented budgetConfig field appears in NO CODE under `src/` — no writer, no reader', () => {
    // It had two occurrences in the whole repo and both were T6's own code: nothing writes it, no
    // validator declares it, `settings/budgetConfig`'s real shape does not contain it, and the plan
    // never names it. A field a stage invents for itself is a contract with nobody.
    const offenders = listSourceFiles(SRC_ROOT)
      .filter((file) => stripComments(readSourceCached(file), file).includes(INVENTED_FIELD))
      .map((file) => relative(SRC_ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('!! and the PAIR that proves the scan works — prose is skipped, the same text as CODE is not', () => {
    // Without this pair the assertion above passes just as happily on a broken file walk or on a
    // stripper that ate everything. One half proves the walk reaches real files and finds a real
    // name; the other proves the comment-skipping is skipping comments rather than deleting code.
    const files = listSourceFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);
    expect(
      files.filter((file) => stripComments(readSourceCached(file), file).includes('resolveTarget')).length
    ).toBeGreaterThan(0);
    const probe = join(SRC_ROOT, 'utils/probe.ts');
    expect(stripComments(`// ${INVENTED_FIELD} is gone\nconst x = 1;`, probe)).not.toContain(INVENTED_FIELD);
    expect(stripComments(`const doc = { ${INVENTED_FIELD}: 1 };`, probe)).toContain(INVENTED_FIELD);
  });

  it('!! the MEASUREMENT that removed it: the real document holds per-category SPEND CAPS', () => {
    // `Dashboard.tsx` is the only code in this repo that reads `settings/budgetConfig`'s numbers,
    // and what it reads is `{ name, budget }` entries per member key — a per-CATEGORY monthly
    // BUDGET, rendered as budget-vs-actual. That is a SPEND CAP.
    //
    // Every other target in D29 is SAVINGS-SHAPED: `goals` carries `target − current`, an amount to
    // reach, and a `personalTarget` assumption carries the same. `computeAllowance` computes
    // `shortfall = target − projected` and then SHAVES variable spend by the shortfall, which is
    // only meaningful when the target is an amount to reach. Feeding a spend cap into it inverts
    // the meaning: a ₪12,000 cap against ₪2,000 of projected saving would tell a family to cut
    // ₪10,000 of variable spend, and the met-target copy ("התקופה מסתיימת מעל היעד") would deliver
    // being OVER a cap as good news.
    //
    // Asserted against the real source rather than described, so the day `settings/budgetConfig`
    // gains a genuine savings-shaped target this test is what fails and asks for the decision.
    const dashboard = readSourceCached(join(SRC_ROOT, 'components/Dashboard.tsx'));
    expect(dashboard).toContain("getDoc(doc(db, 'settings', 'budgetConfig'))");
    expect(dashboard).toMatch(/\{\s*name:\s*string;\s*budget:\s*number\s*\}\[\]/);
  });

  it('a target source that cannot be read is simply NOT ONE — `resolveTarget` takes two sources', () => {
    // D29 ordered three sources. Two of them exist. The third is recorded in the module header as
    // a decision T7a/Stage 8 must make with a writer in hand, not as a `null` branch that looks
    // implemented.
    const resolved = resolveTarget({ memberId: null, horizon: HORIZON, assumptions: [], goals: [] });
    expect(resolved.status).toBe('none');
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
    });
    expect(resolved.status).toBe('none');
  });

  it("uses a member's own personalTarget on the 'own' screen", () => {
    const resolved = resolveTarget({
      memberId: 'omer',
      horizon: HORIZON,
      assumptions: [assumption()],
      goals: [goal()],
    });
    expect(resolved).toMatchObject({ status: 'target', source: 'personalTarget', amountILS: 500, isFamilyScoped: false });
  });

  it("does not lend one member's personalTarget to another member", () => {
    const resolved = resolveTarget({
      memberId: 'lilit',
      horizon: HORIZON,
      assumptions: [assumption()],
      goals: [],
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
    });
    expect(resolved).toMatchObject({ status: 'target', source: 'goal', amountILS: 12000, isFamilyScoped: true });
  });

  it('sums every goal that falls in the horizon', () => {
    const resolved = resolveTarget({
      memberId: null,
      horizon: HORIZON,
      assumptions: [],
      goals: [goal(), goal({ firestoreId: 'g2', target: 3000, current: 0, date: 'נובמבר 2026' })],
    });
    expect(resolved).toMatchObject({ status: 'target', amountILS: 15000 });
  });

  it('carries the excluded count through even when it ends with no target at all', () => {
    const resolved = resolveTarget({
      memberId: null,
      horizon: HORIZON,
      assumptions: [],
      goals: [goal({ date: 'בקרוב' })],
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

  it('!! F3 — a target met by less than one AGORA reports ₪0.00, never "₪-0.00"', () => {
    // The T6 sweep found the boundary at EXACT INTEGER equality and closed it there. This is the
    // case one float below it, and it is the ORDINARY way to reach an exactly-met target rather
    // than an exotic one: `projectedILS` is a sum of agorot-rounded line items, so a hair-under
    // result is what summing produces. `roundILS(projected - target)` on it is `Math.round(-1e-10)`
    // = `-0`, `/100` = `-0`.
    //
    // And the mechanism the first comment named was wrong twice: `JSON.stringify(-0)` and
    // `String(-0)` both give `"0"`. The renderer that PRESERVES the sign is `toLocaleString` —
    // which is exactly what this app's one money formatter uses. So the test asserts through
    // `formatILS`, the thing a family would actually read.
    const met = computeAllowance({
      targetILS: 6000,
      projectedILS: 5999.999999999999,
      categories,
      flexibleIds: allFlexible,
    });
    if (met.status !== 'target-met') throw new Error(`expected target-met, got ${met.status}`);
    expect(Object.is(met.surplusILS, -0)).toBe(false);
    expect(met.surplusILS).toBe(0);
    expect(formatILS(met.surplusILS)).toBe(formatILS(0));
    expect(formatILS(met.surplusILS)).not.toContain('-');
  });

  it('!! F3 — and the NEGATIVE CONTROL: the formatter really does preserve the sign of -0', () => {
    // Without this the assertion above would pass on a formatter that could not render "-0" in the
    // first place, and would keep passing after the fix was reverted.
    expect(formatILS(-0)).toContain('-');
    expect(formatILS(-0)).not.toBe(formatILS(0));
  });

  it('!! F3 — the fix is in the ROUNDING RULE, so every sub-agora overshoot lands on +0', () => {
    // `roundILS` is this module's ONE rounding rule and every figure it produces goes through it,
    // so the fix belongs there rather than at the single call site the integer boundary test
    // happened to reach. Four different float residues, all of which `Math.round` sends to `-0`.
    for (const projected of [5999.999999999999, 5999.9999999, 5999.999, 5999.996]) {
      const met = computeAllowance({ targetILS: 6000, projectedILS: projected, categories, flexibleIds: allFlexible });
      if (met.status !== 'target-met') throw new Error(`expected target-met at ${projected}, got ${met.status}`);
      expect(Object.is(met.surplusILS, -0), `-0 at ${projected}`).toBe(false);
      expect(formatILS(met.surplusILS)).not.toContain('-');
    }
    // …and the residue really does reach `-0` without the rule: this is the arithmetic the guard
    // is standing in front of, asserted rather than described.
    expect(Object.is(Math.round((5999.999999999999 - 6000) * 100) / 100, -0)).toBe(true);
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

// ═════════════════════════════════════════════════════════════════════════════════════════════
// !! F2 — computeAllowance is the one exported function in this module with no input validation
// ═════════════════════════════════════════════════════════════════════════════════════════════


describe('!! F2 — computeAllowance REFUSES a non-finite input instead of falling through', () => {
  const categories = [category('מסעדות', 2400), category('מזון וצריכה', 3000), category('פנאי ובילוי', 600)];
  const allFlexible = categories.map((c) => c.categoryId);

  it('the WHOLE REASON: NaN walks past BOTH of the refusal`s guards', () => {
    // `NaN > x` is false AND `NaN <= 0` is false, so a NaN shortfall satisfies neither branch and
    // arrives at the allowance table — which then renders convincing percentages beside `₪—`,
    // because `sharePct` is finite (each category's share of the flexible total) while every
    // shekel figure is NaN. That is the most expensive shape of wrong on this screen: a number
    // that is missing next to a number that looks derived.
    expect(Number.NaN > 0).toBe(false);
    expect(Number.NaN <= 0).toBe(false);
  });

  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    it(`refuses a projection of ${String(bad)}`, () => {
      expect(() =>
        computeAllowance({ targetILS: 6000, projectedILS: bad, categories, flexibleIds: allFlexible })
      ).toThrow(/computeAllowance/);
    });

    it(`refuses a target of ${String(bad)}`, () => {
      expect(() =>
        computeAllowance({ targetILS: bad, projectedILS: 6000, categories, flexibleIds: allFlexible })
      ).toThrow(/computeAllowance/);
    });

    it(`refuses a category projection of ${String(bad)}`, () => {
      // T7a sums line items to build these. One unreadable amount that reached this far poisons the
      // flexible total, and a poisoned total is what makes every share look computed.
      expect(() =>
        computeAllowance({
          targetILS: 6000,
          projectedILS: 1000,
          categories: [...categories, category('שונות', bad)],
          flexibleIds: [...allFlexible, 'שונות'],
        })
      ).toThrow(/computeAllowance/);
    });
  }

  it('`null` is still the CALM state and not a refusal — the two must not collapse', () => {
    // The refusal above must not swallow D29(c)'s no-target answer. `null` means "no target could
    // be read", which is a state a family is genuinely in today (T0 measured zero targets).
    expect(
      computeAllowance({ targetILS: null, projectedILS: 1000, categories, flexibleIds: allFlexible })
    ).toEqual({ status: 'no-target' });
  });

  it('and a legitimate ZERO projection still computes — the guard is about finiteness only', () => {
    // `projectedILS: 0` is a real answer (a horizon with nothing projected), and refusing it would
    // be the over-approximation that makes a guard get deleted.
    const result = computeAllowance({ targetILS: 100, projectedILS: 0, categories, flexibleIds: allFlexible });
    expect(result.status).toBe('allowances');
  });
});
