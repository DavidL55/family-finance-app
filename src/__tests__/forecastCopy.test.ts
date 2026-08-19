// Stage 7 T5 review, F6 + F8 — THE COPY MODULE, AND THE SEAM THAT KEEPS IT ONE.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS FILE HOLDS THAT NOTHING HELD BEFORE
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
//   1. D3's ban on probability language, moved here from `statisticalLayer.test.ts` with the labels
//      it guards. It used to spell the seven banned `צפוי` forms INLINE, beside a `forecast.ts`
//      comment claiming `PROBABILITY_LABEL_FORMS` already held them. The constant did not exist —
//      T5-review F6, a forward reference to T7c written as though it were a fact. It exists now,
//      the inline list is gone, and the comment's claim is the assertion below.
//
//   2. THE SEAM ITSELF (F8). A split nothing checks is a split that lasts until the next feature:
//      T7 adds three screens' worth of Hebrew, and the shortest path for every one of them is the
//      file the number is computed in. So `forecast.ts` is walked for Hebrew STRING LITERALS, and
//      the only ones allowed are the three CATEGORY_* bucket keys — which are not copy, and whose
//      exemption is stated in the copy module's own header rather than assumed here.
//
// Every checker is a pure function over (fileName, source) and is proven against SYNTHETIC sources
// before it is pointed at the real tree, because on today's tree `forecast.ts` passes — so an
// unproven checker is a checker that says nothing.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { SRC_ROOT, parseSource, readSourceCached, stripComments } from './helpers/extractionSurfaces';
import {
  ADVICE_BOUNDARY_NOTICE_HE,
  ALLOWANCE_FAMILY_GOAL_NOTE_HE,
  ALLOWANCE_NO_TARGET_HE,
  ALLOWANCE_OTHER_LEVERS_HE,
  ALLOWANCE_RANK_WORDS_HE,
  ALLOWANCE_TARGET_MET_HE,
  BAND_BASIS_LABEL_HE,
  BAND_LABEL_HE,
  CALIBRATION_NOT_ENOUGH_TIME_HE,
  CERTAIN_LAYER_EMPTY_HE,
  FORECAST_INPUT_LABEL_HE,
  MONTH_CONFIDENCE_LABEL_HE,
  PROBABILITY_LABEL_FORMS,
  SCENARIO_NAME_FRAGMENTS,
  SEASONALITY_REFUSAL_HE,
  STATISTICAL_GAP_REASON_HE,
  allowanceLeadHe,
  allowanceUnreachableHe,
  goalsExcludedHe,
  historyCeilingReasonHe,
  seasonalFactorObservedHe,
  seasonalFactorUserHe,
} from '../utils/forecastCopy';
import { CATEGORY_INSURANCE, CATEGORY_LOAN_REPAYMENT, CATEGORY_OTHER } from '../utils/forecast';

/** Any Hebrew letter. Enough to tell a sentence a person reads from an identifier or a period. */
const HEBREW = /[֐-׿]/;

/**
 * Every string a reader could see, out of one file: string literals AND every fixed chunk of a
 * template literal.
 *
 * Template pieces are included deliberately. `historyCeilingReasonHe` is a template, so a checker
 * that only understood `StringLiteral` would have declared `forecast.ts` copy-free while D33's
 * whole sentence still sat in it — the exact shape of failure this guard exists to catch.
 */
export function hebrewStringLiteralsIn(fileName: string, source: string): string[] {
  // !! NO `stripComments` HERE, AND THE MUTATION SWEEP IS WHY. The first draft stripped comments
  // first, "so Hebrew prose cannot trip the guard" — and removing that call SURVIVED every test in
  // the suite, twice. The claim was not what was doing the work: comment text is TRIVIA to the
  // TypeScript parser and never becomes a `StringLiteral` node at all, so a walk over literal nodes
  // cannot reach it whether it was stripped or not. Belt-and-braces wearing a mechanism's name is
  // the same defect F5 and F6 were about, so the call is gone and the real reason is written down.
  const sourceFile = parseSource(fileName, source);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const isLiteralText =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node);
    if (isLiteralText && HEBREW.test(node.text)) found.push(node.text);
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return found;
}

const FORECAST = join(SRC_ROOT, 'utils/forecast.ts');
const FORECAST_COPY = join(SRC_ROOT, 'utils/forecastCopy.ts');

const EVERY_LABEL = [
  ...Object.values(BAND_LABEL_HE),
  ...Object.values(BAND_BASIS_LABEL_HE),
  ...Object.values(MONTH_CONFIDENCE_LABEL_HE),
  ...Object.values(STATISTICAL_GAP_REASON_HE),
  ...Object.values(FORECAST_INPUT_LABEL_HE),
  CERTAIN_LAYER_EMPTY_HE,
  // T6 — D24's refusals and D29's whole "מה צריך לקרות" block. The list below is ENUMERATED, and
  // the assertion `every Hebrew string this module exports is on this list` is what stops it from
  // being an enumeration guard: adding a constant without adding it here fails.
  ...Object.values(SEASONALITY_REFUSAL_HE),
  ADVICE_BOUNDARY_NOTICE_HE,
  ALLOWANCE_OTHER_LEVERS_HE,
  ALLOWANCE_NO_TARGET_HE,
  ALLOWANCE_TARGET_MET_HE,
  ALLOWANCE_FAMILY_GOAL_NOTE_HE,
  ...ALLOWANCE_RANK_WORDS_HE,
  CALIBRATION_NOT_ENOUGH_TIME_HE,
];

/**
 * The sentences the three template builders produce, so the derivation below can tell a template
 * FRAGMENT from a label somebody forgot to put on `EVERY_LABEL`. Built by CALLING them, so a
 * rewritten template cannot leave a stale fragment list behind.
 */
const TEMPLATE_SENTENCES = [
  historyCeilingReasonHe(2184, 5),
  goalsExcludedHe(2),
  allowanceUnreachableHe({ targetText: 'A', months: 3, flexibleTotalText: 'B', gapText: 'C' }),
  allowanceLeadHe({ categoryId: 'X', projectedText: 'Y', rankWord: 'Z', isLargest: true }),
  allowanceLeadHe({ categoryId: 'X', projectedText: 'Y', rankWord: 'Z', isLargest: false }),
  seasonalFactorObservedHe({ monthName: 'M', percent: 30, n: 2 }),
  seasonalFactorObservedHe({ monthName: 'M', percent: -30, n: 2 }),
  seasonalFactorUserHe({ monthName: 'M', percent: 30, authorName: 'A' }),
  seasonalFactorUserHe({ monthName: 'M', percent: -30, authorName: 'A' }),
];

/** The subset T7c's tier-2 exact-match check is scoped to: band, scenario and confidence names. */
const BAND_AND_CHIP_LABELS = [
  ...Object.values(BAND_LABEL_HE),
  ...Object.values(BAND_BASIS_LABEL_HE),
  ...Object.values(MONTH_CONFIDENCE_LABEL_HE),
];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D3 / A39 — the ban on probability language, against a constant that now exists
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! F6 — `PROBABILITY_LABEL_FORMS` exists, and it is what the comment always claimed', () => {
  it('holds D41/§12`s seven forms of `צפוי`, and nothing else', () => {
    expect([...PROBABILITY_LABEL_FORMS]).toEqual([
      'צפוי',
      'הצפוי',
      'צפויה',
      'הצפויה',
      'תרחיש צפוי',
      'התרחיש הצפוי',
      'מצב צפוי',
    ]);
  });

  it('!! is matched EXACTLY, never as a substring — `צפוי` is ordinary Hebrew for "expected"', () => {
    // The distinction the whole ruling rests on. A39's defect is a three-way band NAMED
    // שמרן/צפוי/אופטימי; an ordinary sentence containing the word "expected" is not that defect,
    // and a substring rule would ban it from the product.
    const sentence = 'הסכום הצפוי לחודש הבא מבוסס על מה שהיה';
    expect(sentence).toMatch(/צפוי/); // a substring rule WOULD have fired here
    expect(PROBABILITY_LABEL_FORMS).not.toContain(sentence.trim()); // the exact rule does not
  });

  it('!! NO band or chip label is an exact banned form — tier 2, over the labels it is scoped to', () => {
    for (const label of BAND_AND_CHIP_LABELS) {
      expect(PROBABILITY_LABEL_FORMS).not.toContain(label.trim());
    }
  });

  it('THE CHECK FIRES — a label that IS a banned form is caught', () => {
    // Non-vacuity: today every label passes, so without this the assertion above proves only that
    // the list and the labels are two sets of strings.
    const forbidden: Record<'low' | 'mid' | 'high', string> = {
      low: 'שמרן',
      mid: 'צפוי',
      high: 'אופטימי',
    };
    expect(PROBABILITY_LABEL_FORMS).toContain(forbidden.mid.trim());
    expect(SCENARIO_NAME_FRAGMENTS.some((f) => forbidden.low.includes(f))).toBe(true);
    expect(SCENARIO_NAME_FRAGMENTS.some((f) => forbidden.high.includes(f))).toBe(true);
  });

  it('no label contains `שמרן` or `אופטימי` — tier 1, a SUBSTRING ban over every label', () => {
    for (const label of EVERY_LABEL) {
      for (const fragment of SCENARIO_NAME_FRAGMENTS) expect(label).not.toContain(fragment);
    }
  });

  it('contains no percentage and no probability figure', () => {
    for (const label of EVERY_LABEL) expect(label).not.toMatch(/%|ביטחון|סבירות|הסתברות/);
  });

  it('contains no second person (D34) — the explicit forms', () => {
    for (const label of EVERY_LABEL) {
      expect(label).not.toMatch(/\bאתה\b|\bאת\b|שלך|תבדוק|תראה/);
    }
  });

  it('!! the band labels are the THREE THINGS THAT HAPPENED, in D3`s own words', () => {
    expect(BAND_LABEL_HE.high).toBe('הכי יקר שהיה');
    expect(BAND_LABEL_HE.mid).toBe('האמצע');
    expect(BAND_LABEL_HE.low).toBe('הכי זול שהיה');
  });

  it('!! the chip labels are D41`s three states', () => {
    expect(MONTH_CONFIDENCE_LABEL_HE['well-based']).toBe('מבוסס היטב');
    expect(MONTH_CONFIDENCE_LABEL_HE.estimate).toBe('הערכה');
    expect(MONTH_CONFIDENCE_LABEL_HE['rough-estimate']).toBe('הערכה גסה');
  });

  it('D33`s sentence carries BOTH numbers — the count read and the window offered', () => {
    const reason = historyCeilingReasonHe(2184, 5);
    expect(reason).toContain('2184');
    expect(reason).toContain('5');
    expect(reason).not.toMatch(/₪/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T6 — D24's refusals and D29's "מה צריך לקרות"
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe("!! D29(e) — the advice boundary ships WITH the allowance, not one stage later", () => {
  it('is §9`s own sentence, both halves', () => {
    // §9 pins this to the insights screen (Stage 8). The allowance row is the first thing this app
    // ships that tells a family what to do with money, and it does it with a number in it — a
    // boundary notice that arrives one stage after the surface that needs it is late by exactly the
    // amount that mattered.
    expect(ADVICE_BOUNDARY_NOTICE_HE).toContain('לבדיקה');
    expect(ADVICE_BOUNDARY_NOTICE_HE).toContain('לא הוראת פעולה');
    expect(ADVICE_BOUNDARY_NOTICE_HE).toContain('אינה יועץ');
  });

  it('the allowance ROW is phrased as "כדאי לבדוק", never as an instruction', () => {
    // The arithmetic behind the row is a proportional share of a shortfall against a moving
    // average. That is a reasonable place to LOOK, not a budget the family agreed to, and phrasing
    // it as an instruction states a certainty the computation does not have.
    const row = allowanceLeadHe({
      categoryId: 'מסעדות',
      projectedText: '₪2,400.00',
      rankWord: ALLOWANCE_RANK_WORDS_HE[0],
      isLargest: true,
    });
    expect(row).toContain('כדאי לבדוק');
    expect(row).toContain('מסעדות');
    expect(row).toContain('₪2,400.00');
    // and it does NOT tell anybody to do anything
    expect(row).not.toMatch(/צמצמו|הפחיתו|חסכו|הורידו/);
  });

  it('names the OTHER levers, so the copy does not imply cutting is the only path', () => {
    expect(ALLOWANCE_OTHER_LEVERS_HE).toContain('דחיית');
    expect(ALLOWANCE_OTHER_LEVERS_HE).toContain('הגדלת הכנסה');
  });

  it('the refusal states ARITHMETIC — all three numbers, and no verdict', () => {
    const sentence = allowanceUnreachableHe({
      targetText: '₪12,000.00',
      months: 3,
      flexibleTotalText: '₪7,400.00',
      gapText: '₪4,600.00',
    });
    expect(sentence).toContain('₪12,000.00');
    expect(sentence).toContain('₪7,400.00');
    expect(sentence).toContain('₪4,600.00');
    expect(sentence).toContain('3');
    // v1's copy delivered a judgement the family would hear as a judgement about themselves.
    expect(sentence).not.toMatch(/לא ריאלי|בלתי אפשרי|נכשל|אין סיכוי/);
  });

  it('the family-goal note says the target is a FAMILY one — `goals` is ownerless', () => {
    expect(ALLOWANCE_FAMILY_GOAL_NOTE_HE).toContain('משפחתי');
  });

  it('the excluded-goal count is VISIBLE and carries the number', () => {
    expect(goalsExcludedHe(2)).toContain('2');
  });

  it('D24`s hover sentences take the month NAME as a parameter and pick their word from the sign', () => {
    // A factor below 1 is an ordinary thing to assert about a quiet month, and "יקר ב--20%" is what
    // a single hardcoded word produces. The month name arrives from `HEBREW_MONTH_NAMES`, which is
    // what keeps the twelve names in one array and lets the month-literal guard mean something.
    expect(seasonalFactorObservedHe({ monthName: 'ספטמבר', percent: 30, n: 2 })).toContain('יקר');
    expect(seasonalFactorObservedHe({ monthName: 'ספטמבר', percent: -20, n: 2 })).toContain('זול');
    // The prefix `ב-` already carries a hyphen, so the thing a raw negative would produce is a
    // DOUBLE one — `ב--20%`. That is what the sign handling actually prevents, and asserting the
    // single hyphen would have failed on correct output.
    expect(seasonalFactorObservedHe({ monthName: 'ספטמבר', percent: -20, n: 2 })).not.toContain('ב--');
    expect(seasonalFactorUserHe({ monthName: 'אפריל', percent: -20, authorName: 'לילית' })).not.toContain('ב--');
    expect(seasonalFactorUserHe({ monthName: 'אפריל', percent: 30, authorName: 'לילית' })).toContain('לילית');
  });

  it('every refusal reason has its OWN sentence, and none of them carries a number', () => {
    const reasons = Object.values(SEASONALITY_REFUSAL_HE);
    expect(new Set(reasons).size).toBe(reasons.length);
    for (const reason of reasons) expect(reason).not.toMatch(/₪|\d/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// F8 — the seam, walked
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! F8 — `forecast.ts` holds no UI copy, and the guard can tell copy from a bucket key', () => {
  /**
   * The three Hebrew strings `forecast.ts` is allowed to contain, IMPORTED rather than spelled
   * here — so a fourth one cannot be waved through by editing a string in a test.
   *
   * They are not copy. They are bucket keys that must stay byte-identical to what
   * `RecurringService` stamps on every autoposted row; rephrasing one lands a recurring item's
   * forward projection and its own posted rows in different buckets, with green tests.
   */
  const BUCKET_KEYS = [CATEGORY_OTHER, CATEGORY_INSURANCE, CATEGORY_LOAN_REPAYMENT];

  it('every Hebrew literal left in `forecast.ts` is one of the three bucket keys', () => {
    const literals = hebrewStringLiteralsIn(FORECAST, readSourceCached(FORECAST));
    expect([...new Set(literals)].sort()).toEqual([...BUCKET_KEYS].sort());
  });

  it('!! EVERY_LABEL is not an enumeration — every Hebrew string this module exports is on it', () => {
    // T6 added nine copy blocks, and `EVERY_LABEL` is a hand-written list: the tier-1 ban, the
    // percentage ban and the second-person ban above all run off it, so a constant added without
    // being added there is a constant nobody checks. That is the enumeration-guard class this
    // stage counts. This closes it by DERIVING the module's own Hebrew literals and requiring each
    // one to be either a label on the list or a fragment of a template function — and the
    // template functions are exercised by name in the T6 block above.
    const literals = new Set(hebrewStringLiteralsIn(FORECAST_COPY, readSourceCached(FORECAST_COPY)));
    // The two DENYLISTS are Hebrew literals in this module and are the one thing that must NOT be
    // on `EVERY_LABEL`: they are the words the bans forbid, so putting them on the list the bans
    // run over would fail every one of them by construction. Named here rather than filtered by
    // shape, so the exclusion is a decision and not an accident.
    const covered = new Set([...EVERY_LABEL, ...PROBABILITY_LABEL_FORMS, ...SCENARIO_NAME_FRAGMENTS]);
    // Fragments of the three template builders, which are assembled at call time rather than
    // stored — named here so the assertion is about what is MISSING, not about what is expected.
    const templateFragments = [...literals].filter((l) =>
      TEMPLATE_SENTENCES.some((sentence) => sentence.includes(l))
    );
    for (const fragment of templateFragments) covered.add(fragment);
    const uncovered = [...literals].filter((l) => !covered.has(l));
    expect(uncovered).toEqual([]);
  });

  it('!! and the copy module really does hold the copy — otherwise the check above is vacuous', () => {
    // If the strings had been deleted rather than moved, `forecast.ts` would pass the check above
    // for the worst possible reason.
    const copyLiterals = hebrewStringLiteralsIn(FORECAST_COPY, readSourceCached(FORECAST_COPY));
    expect(copyLiterals.length).toBeGreaterThanOrEqual(EVERY_LABEL.length);
    for (const label of EVERY_LABEL) expect(copyLiterals).toContain(label);
  });

  it('!! THE CHECKER FIRES — a Hebrew sentence added back to a computation module is seen', () => {
    const relapse = `
      export function summaryHe(n: number): string {
        if (n === 0) return 'אין תשלומים קבועים ידועים בחודש הזה';
        return '';
      }
    `;
    expect(hebrewStringLiteralsIn('probe.ts', relapse)).toEqual([
      'אין תשלומים קבועים ידועים בחודש הזה',
    ]);
  });

  it('!! THE CHECKER SEES TEMPLATE LITERALS — head, middle and tail', () => {
    // D33's sentence is a template. A `StringLiteral`-only checker would have called `forecast.ts`
    // copy-free with that whole sentence still sitting in it.
    const template = 'const s = `טווח של ${months} חודשים מחזיר ${rows} שורות, יותר מדי`;';
    const found = hebrewStringLiteralsIn('probe.ts', template);
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(found.join('')).toContain('טווח של');
    expect(found.join('')).toContain('שורות');
  });

  it('and it does NOT fire on Hebrew in a COMMENT — including a QUOTED string inside one', () => {
    // `forecast.ts` still explains מתי and 'שונות' in prose, and it should: the ban is on the
    // product's sentences, not on the module's own argument for itself. The mechanism is the
    // PARSER, not a stripping pass — comment text is trivia and never becomes a literal node, which
    // is why the second case below (a string literal spelled out inside a comment) is also silent.
    const commented = `
      // מתי is a month stepper — see D32a
      /** the bucket 'שונות' would fall into */
      // const relapse = 'אין תשלומים קבועים ידועים בחודש הזה';
      export const n = 1;
    `;
    expect(hebrewStringLiteralsIn('probe.ts', commented)).toEqual([]);
  });

  it('and it does NOT fire on a Latin string — the guard is about copy, not about strings', () => {
    expect(hebrewStringLiteralsIn('probe.ts', "const k = 'movingAverage';")).toEqual([]);
  });

  it('the copy module imports NOTHING — the split is one-directional, not a cycle', () => {
    // A copy module that imports back from `forecast.ts` is a cycle wearing a split's name, and it
    // would put `forecast.ts` back inside its own closure walk by another road.
    const sourceFile = parseSource(FORECAST_COPY, stripComments(readSourceCached(FORECAST_COPY), FORECAST_COPY));
    const specifiers: string[] = [];
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        specifiers.push(node.moduleSpecifier.getText());
      }
      node.forEachChild(visit);
    };
    visit(sourceFile);
    expect(specifiers).toEqual([]);
  });

  it('`forecast.ts` re-exports the key TYPES and none of the STRINGS', () => {
    // The asymmetry is the split: `BandBasis` is a discriminant inside `ForecastBasis` and has to
    // be nameable from the same module, while a re-exported label would make `forecast.ts` a second
    // address for every string in the product — and T7c's exact-match guard would then be pointing
    // at a module that is not the only way to reach what it guards.
    const stripped = stripComments(readSourceCached(FORECAST), FORECAST);
    expect(stripped).toMatch(/export type \{[^}]*BandBasis[^}]*\} from '\.\/forecastCopy'/);
    for (const constant of ['BAND_LABEL_HE', 'MONTH_CONFIDENCE_LABEL_HE', 'STATISTICAL_GAP_REASON_HE']) {
      expect(stripped).not.toMatch(new RegExp(`export \\{[^}]*${constant}`));
    }
  });
});
