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
  ALLOWANCE_FAMILY_GOAL_NOTE_HE,
  ALLOWANCE_NO_TARGET_HE,
  ALLOWANCE_OTHER_LEVERS_HE,
  ALLOWANCE_RANK_WORDS_HE,
  ALLOWANCE_TARGET_MET_HE,
  BALANCE_VERDICT_LABEL_HE,
  BAND_BASIS_LABEL_HE,
  BAND_LABEL_HE,
  CALIBRATION_NOT_ENOUGH_TIME_HE,
  CERTAIN_LAYER_EMPTY_HE,
  FORECAST_ANCHOR_CLAMPED_HE,
  FORECAST_INCOMES_EDITED_HERE_HE,
  FORECAST_INPUT_LABEL_HE,
  FORECAST_OWN_NO_INCOME_HE,
  FORECAST_OWN_OUTGOING_LABEL_HE,
  MONTH_CONFIDENCE_LABEL_HE,
  PROBABILITY_LABEL_FORMS,
  SCENARIO_NAME_FRAGMENTS,
  SEASONALITY_REFUSAL_HE,
  STATISTICAL_GAP_REASON_HE,
  allowanceLeadHe,
  CASH_FLOW_LABEL_HE,
  CASH_FLOW_SENTENCE_HE,
  CERTAIN_BASIS_LABEL_HE,
  FORECAST_ALLOWANCE_TITLE_HE,
  FORECAST_ASSUMPTIONS_TITLE_HE,
  FORECAST_CALIBRATION_TITLE_HE,
  FORECAST_CERTAIN_TITLE_HE,
  FORECAST_DRILL_LABEL_HE,
  FORECAST_ESTIMATED_TITLE_HE,
  FORECAST_HORIZON_CONTROL_LABEL_HE,
  FORECAST_MONTHS_TITLE_HE,
  FORECAST_NO_ASSUMPTIONS_HE,
  FORECAST_ONBOARDING_SENTENCE_HE,
  FORECAST_ONBOARDING_TITLE_HE,
  FORECAST_OPEN_SCREEN_HE,
  FORECAST_CATEGORY_FILTER_NOTE_HE,
  FORECAST_FAMILY_SCOPE_NOTE_HE,
  FORECAST_NO_VARIABLE_SPEND_HE,
  FORECAST_SCREEN_SUBTITLE_HE,
  FORECAST_SCREEN_TITLE_HE,
  INSTALMENT_DOUBLE_COUNT_HE,
  INSTALMENT_PLAN_KEY_CAVEAT_HE,
  LOAN_INSURANCE_DOUBLE_COUNT_HE,
  SEASONALITY_OFFERS_NONE_HE,
  SEASONALITY_OFFERS_TITLE_HE,
  SEASONALITY_OFFER_ACCEPT_HE,
  assumptionOverrideCertainHe,
  assumptionOverrideStatisticalHe,
  forecastAxisMaxHe,
  forecastMemberScopeNoteHe,
  forecastMonthAccessibleNameHe,
  forecastMonthGapAccessibleNameHe,
  historyDepthChipHe,
  seasonalityOfferInertHe,
  seasonalityOfferLiveHe,
  unusableRowsHe,
  allowanceUnreachableHe,
  balanceGapHe,
  forecastBalanceLabelHe,
  forecastCommittedHe,
  forecastHorizonHe,
  forecastIncomeReferenceHe,
  forecastOwnTargetHe,
  forecastShortfallHe,
  goalsExcludedHe,
  historyCeilingReasonHe,
  missingInputsCountHe,
  seasonalFactorObservedHe,
  seasonalFactorUserHe,
} from '../utils/forecastCopy';
import { CATEGORY_INSURANCE, CATEGORY_LOAN_REPAYMENT, CATEGORY_OTHER } from '../utils/forecast';
// §9's boundary notice MOVED to its own product-wide module in the T6 review (F10). It is still
// asserted from here, because this is the file that argues about the D29 advice block — but it is
// no longer one of this module's own literals, so it is NOT on `EVERY_LABEL`.
import { ADVICE_BOUNDARY_NOTICE_HE } from '../config/adviceBoundary';

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
  ALLOWANCE_OTHER_LEVERS_HE,
  ALLOWANCE_NO_TARGET_HE,
  ALLOWANCE_TARGET_MET_HE,
  ALLOWANCE_FAMILY_GOAL_NOTE_HE,
  ...ALLOWANCE_RANK_WORDS_HE,
  CALIBRATION_NOT_ENOUGH_TIME_HE,
  // T7a — D38's card. The verdict words are the half of the conditional colour rule that survives a
  // printout and a colour-blind reader, so they are on the list every ban above runs over.
  ...Object.values(BALANCE_VERDICT_LABEL_HE),
  FORECAST_ANCHOR_CLAMPED_HE,
  FORECAST_OWN_OUTGOING_LABEL_HE,
  FORECAST_OWN_NO_INCOME_HE,
  FORECAST_INCOMES_EDITED_HERE_HE,
  // T7b — the full screen. Everything the screen renders as a fixed string, so the tier-1
  // probability ban, the percentage ban and D34's second-person ban all run over it.
  CASH_FLOW_LABEL_HE,
  CASH_FLOW_SENTENCE_HE,
  FORECAST_SCREEN_TITLE_HE,
  FORECAST_SCREEN_SUBTITLE_HE,
  FORECAST_ONBOARDING_TITLE_HE,
  FORECAST_ONBOARDING_SENTENCE_HE,
  FORECAST_HORIZON_CONTROL_LABEL_HE,
  FORECAST_DRILL_LABEL_HE,
  LOAN_INSURANCE_DOUBLE_COUNT_HE,
  INSTALMENT_DOUBLE_COUNT_HE,
  INSTALMENT_PLAN_KEY_CAVEAT_HE,
  FORECAST_NO_ASSUMPTIONS_HE,
  SEASONALITY_OFFERS_TITLE_HE,
  SEASONALITY_OFFER_ACCEPT_HE,
  SEASONALITY_OFFERS_NONE_HE,
  FORECAST_MONTHS_TITLE_HE,
  FORECAST_CERTAIN_TITLE_HE,
  FORECAST_ESTIMATED_TITLE_HE,
  FORECAST_ASSUMPTIONS_TITLE_HE,
  FORECAST_ALLOWANCE_TITLE_HE,
  FORECAST_CALIBRATION_TITLE_HE,
  FORECAST_OPEN_SCREEN_HE,
  ...Object.values(CERTAIN_BASIS_LABEL_HE),
  // T7b review — F3's family-scope disclosure, F4's מה note and F8's word-where-a-zero-was. All
  // three are sentences a reader sees, so every ban above runs over them like any other label.
  FORECAST_FAMILY_SCOPE_NOTE_HE,
  FORECAST_CATEGORY_FILTER_NOTE_HE,
  FORECAST_NO_VARIABLE_SPEND_HE,
];

/**
 * The sentences the three template builders produce, so the derivation below can tell a template
 * FRAGMENT from a label somebody forgot to put on `EVERY_LABEL`. Built by CALLING them, so a
 * rewritten template cannot leave a stale fragment list behind.
 */
const TEMPLATE_SENTENCES = [
  historyCeilingReasonHe(2184, 5),
  goalsExcludedHe(2),
  // !! THE MONTH COUNT IS EXERCISED AT ALL THREE OF ITS FORMS — T6 review, F7. The singular and the
  // dual are separate Hebrew sentences, not substitutions into one, and `EVERY_LABEL is not an
  // enumeration` is precisely the assertion that turned red when they were added without being
  // exercised here. Adding a form to `monthsCountHe` and not to this list fails that check.
  allowanceUnreachableHe({ targetText: 'A', months: 1, flexibleTotalText: 'B', gapText: 'C' }),
  allowanceUnreachableHe({ targetText: 'A', months: 2, flexibleTotalText: 'B', gapText: 'C' }),
  allowanceUnreachableHe({ targetText: 'A', months: 3, flexibleTotalText: 'B', gapText: 'C' }),
  allowanceLeadHe({ categoryId: 'X', projectedText: 'Y', rankWord: 'Z', isLargest: true }),
  allowanceLeadHe({ categoryId: 'X', projectedText: 'Y', rankWord: 'Z', isLargest: false }),
  seasonalFactorObservedHe({ monthName: 'M', percent: 30, n: 1 }),
  seasonalFactorObservedHe({ monthName: 'M', percent: 30, n: 2 }),
  seasonalFactorObservedHe({ monthName: 'M', percent: 30, n: 4 }),
  seasonalFactorObservedHe({ monthName: 'M', percent: -30, n: 2 }),
  seasonalFactorUserHe({ monthName: 'M', percent: 30, authorName: 'A' }),
  seasonalFactorUserHe({ monthName: 'M', percent: -30, authorName: 'A' }),
  // T7a — D38's card builders, EXERCISED rather than listed. `inputsCountHe` gets all three of its
  // agreement forms for the same reason `monthsCountHe` does: the singular and the dual are
  // separate Hebrew sentences, and `EVERY_LABEL is not an enumeration` is the assertion that turns
  // red when a form is added without being exercised here.
  forecastBalanceLabelHe('M'),
  forecastIncomeReferenceHe('A'),
  forecastShortfallHe('A'),
  forecastHorizonHe({ months: 1, startMonthName: 'M' }),
  forecastHorizonHe({ months: 2, startMonthName: 'M' }),
  forecastHorizonHe({ months: 3, startMonthName: 'M' }),
  forecastCommittedHe('A'),
  balanceGapHe(['A']),
  balanceGapHe(['A', 'B']),
  balanceGapHe(['A', 'B', 'C']),
  forecastOwnTargetHe('A'),
  // The agreement forms, exercised individually as well as through the sentence that uses them.
  missingInputsCountHe(1),
  missingInputsCountHe(2),
  missingInputsCountHe(3),
  // T7b — the screen's own builders, EXERCISED. `historyDepthChipHe` gets all three agreement
  // forms because it wraps `monthsCountHe`, and `seasonalityOfferLiveHe` gets both signs because
  // the word it picks depends on one.
  forecastMonthAccessibleNameHe({ monthName: 'M', totalText: 'A', committedText: 'B' }),
  forecastMonthGapAccessibleNameHe({ monthName: 'M', committedText: 'B' }),
  historyDepthChipHe(1),
  historyDepthChipHe(2),
  historyDepthChipHe(4),
  unusableRowsHe(3),
  assumptionOverrideCertainHe({ categoryId: 'X', displacedName: 'A', assumedText: 'B' }),
  assumptionOverrideStatisticalHe({ categoryId: 'X', assumedText: 'B' }),
  seasonalityOfferInertHe({ monthName: 'M', categoryId: 'X' }),
  seasonalityOfferLiveHe({ monthName: 'M', categoryId: 'X', percent: 30 }),
  seasonalityOfferLiveHe({ monthName: 'M', categoryId: 'X', percent: -30 }),
  forecastMemberScopeNoteHe('N'),
  // T7b review — F7's labelled axis maximum. EXERCISED rather than listed, like every other
  // builder here, so a rewritten template cannot leave a stale fragment behind.
  forecastAxisMaxHe('A'),
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

  /**
   * !! D34's second-person check, RE-BUILT IN T7a BECAUSE THE REGEX FORM WAS SHADOWED.
   *
   * The T6 form was `/\bאתה\b|\bאת\b|שלך|תבדוק|תראה/`. In JavaScript `\b` is a boundary between
   * `\w` and non-`\w`, and Hebrew letters are NOT `\w` without `u` plus a Unicode property escape —
   * so `/\bאתה\b/.test('אתה תראה')` is **false**. Two of the five alternatives could never match
   * ANY Hebrew string, and the guard was passing on three substrings while advertising five forms.
   * Measured, not inferred: the assertion below fires on `'אתה'` under the new checker and the
   * canary underneath proves the old one did not.
   *
   * Tokenised, for the same reason F9's cut-verb register check is: Hebrew has no `\b` here, and
   * `'אתה'` inside a longer token is not second person. `שלך`/`שלכם` are SUFFIXED possessives that
   * legitimately appear inside a longer token, so they stay substring checks — a possessive suffix
   * is second person wherever it sits.
   *
   * !! AND THE BARE `'את'` IS DELIBERATELY NOT ON THE LIST, WHICH IS THE SECOND HALF OF THE SAME
   * FINDING. In written Hebrew a standalone `את` is overwhelmingly the ACCUSATIVE MARKER before a
   * definite direct object, not the second-person feminine pronoun. The first draft of this list
   * included it and was BORN RED on shipped, correct T6 copy — `ALLOWANCE_OTHER_LEVERS_HE`'s
   * "…משנות **את** התמונה גם הן", where the word is a particle and there is no addressee at all.
   * So the T6 regex's `\bאת\b` alternative was dead TWICE OVER: it could not match Hebrew, and had
   * it been able to it would have failed a sentence that is not second person. A guard nobody can
   * satisfy is a guard the next person deletes, which is the F9 argument one ban over.
   */
  const SECOND_PERSON_TOKENS_HE = ['אתה', 'אתם', 'אתן', 'תבדוק', 'תבדקי', 'תראה', 'תראי', 'לך', 'לכם'];
  const SECOND_PERSON_SUFFIXES_HE = ['שלך', 'שלכם', 'שלכן'];
  const hebrewWordsOf = (text: string): string[] => text.split(/[^\u0590-\u05FF]+/).filter((t) => t.length > 0);
  const secondPersonFormsIn = (text: string): string[] => [
    ...hebrewWordsOf(text).filter((token) => SECOND_PERSON_TOKENS_HE.includes(token)),
    ...SECOND_PERSON_SUFFIXES_HE.filter((suffix) => text.includes(suffix)),
  ];

  it('!! the second-person checker FIRES — and the T6 regex form could not', () => {
    for (const secondPerson of ['אתה תראה את זה', 'הכסף שלך', 'תבדוק את היעד', 'היעד שלכם', 'לך יש יעד']) {
      expect(secondPersonFormsIn(secondPerson), secondPerson).not.toEqual([]);
    }
    // THE CANARY. The old form matched neither `אתה` nor `את` in that same sentence, because `\b`
    // does not word-break Hebrew — this is the measurement that justified replacing it rather than
    // extending it.
    expect(/\bאתה\b|\bאת\b/.test('אתה תראה את זה')).toBe(false);
    // …and it does not fire on ordinary words that merely CONTAIN the letters, NOR on the
    // accusative particle, which is the false positive the list above is trimmed to avoid.
    for (const innocent of ['אתמול היה יקר יותר', 'הסכום מתחת ליעד', 'משנות את התמונה גם הן']) {
      expect(secondPersonFormsIn(innocent), innocent).toEqual([]);
    }
  });

  it('contains no second person (D34) — over every label AND every template sentence', () => {
    // Widened from `EVERY_LABEL` to the template sentences too: D34's ruling is about the surface,
    // and half of T7a's card copy is assembled at call time.
    for (const label of [...EVERY_LABEL, ...TEMPLATE_SENTENCES]) {
      expect(secondPersonFormsIn(label), label).toEqual([]);
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

  /**
   * !! F9 — WHAT "NO IMPERATIVE" USED TO MEAN, AND WHAT IT MEANS NOW.
   *
   * The T6 assertion was four MASCULINE PLURAL words (`צמצמו|הפחיתו|חסכו|הורידו`) matched as
   * SUBSTRINGS against ONE template's output, under the description "a test asserting no
   * imperative". Every other way of writing the same instruction walked past it: the singular
   * (`צמצם`), the feminine (`צמצמי`), and the impersonal (`יש לצמצם`) — which is the form a Hebrew
   * UI is MOST likely to reach for, because it is the register this app already uses elsewhere.
   *
   * Two things had to be fixed, not one.
   *
   *  1. **WHOLE WORDS, NOT SUBSTRINGS.** The first widened draft was BORN RED on the shipped
   *     refusal, and correctly so as a warning: `סך ההוצאות המשתנות שניתן לצמצם` contains `צמצם`
   *     inside the INFINITIVE `לצמצם` — and "the variable expenses that CAN BE REDUCED" is a noun
   *     phrase, not an instruction. Hebrew has no `\b` in JavaScript regex, so the sentences are
   *     tokenised on everything that is not a Hebrew letter and the tokens compared exactly. That is
   *     the same correction BAN A had to make for `'מאי'` inside `'מאיה'`.
   *  2. **AN INFINITIVE IS AN INSTRUCTION ONLY BEHIND A MODAL.** `לצמצם` alone is descriptive;
   *     `יש לצמצם` / `צריך לצמצם` / `כדאי לצמצם` are the impersonal instruction. So the infinitives
   *     are checked as an ADJACENT PAIR with a modal, which is what lets the guard catch
   *     `כדאי לצמצם` — the approved register aimed at the wrong verb — while leaving the shipped
   *     `כדאי לבדוק` alone. `לבדוק` is deliberately not a cut verb.
   *
   * This is a REGISTER check over an enumerated set of cut verbs, not a morphological parser, and
   * it says so. What it now covers is every inflection of each stem plus the impersonal forms, over
   * the WHOLE D29 advice block rather than over one sentence.
   */
  const CUT_IMPERATIVES_HE = [
    'צמצם', 'צמצמי', 'צמצמו',
    'הפחת', 'הפחיתי', 'הפחיתו',
    'חסוך', 'חסכי', 'חסכו',
    'הורד', 'הורידי', 'הורידו',
    'הימנע', 'הימנעי', 'הימנעו',
  ];
  const CUT_INFINITIVES_HE = ['לצמצם', 'להפחית', 'לחסוך', 'להוריד', 'להימנע'];
  const INSTRUCTION_MODALS_HE = ['יש', 'צריך', 'כדאי', 'מומלץ', 'חובה', 'עליך', 'עליכם'];

  /** Hebrew-letter tokens, in order. Everything else is a separator. */
  const hebrewTokens = (text: string): string[] => text.split(/[^֐-׿]+/).filter((t) => t.length > 0);

  /** Which instruction forms this sentence actually contains — imperatives, and modal+infinitive. */
  const instructionFormsIn = (text: string): string[] => {
    const tokens = hebrewTokens(text);
    const hits = tokens.filter((token) => CUT_IMPERATIVES_HE.includes(token));
    for (let i = 0; i < tokens.length - 1; i++) {
      if (INSTRUCTION_MODALS_HE.includes(tokens[i]) && CUT_INFINITIVES_HE.includes(tokens[i + 1])) {
        hits.push(`${tokens[i]} ${tokens[i + 1]}`);
      }
    }
    return hits;
  };

  /** Every sentence D29's advice block can put on the screen, from the shipped builders. */
  const everyAdviceSentence = (): string[] => [
    ADVICE_BOUNDARY_NOTICE_HE,
    ALLOWANCE_OTHER_LEVERS_HE,
    ALLOWANCE_NO_TARGET_HE,
    ALLOWANCE_TARGET_MET_HE,
    ALLOWANCE_FAMILY_GOAL_NOTE_HE,
    goalsExcludedHe(2),
    allowanceUnreachableHe({ targetText: '₪12,000.00', months: 3, flexibleTotalText: '₪7,400.00', gapText: '₪4,600.00' }),
    ...ALLOWANCE_RANK_WORDS_HE.flatMap((rankWord) =>
      [true, false].map((isLargest) =>
        allowanceLeadHe({ categoryId: 'מסעדות', projectedText: '₪2,400.00', rankWord, isLargest })
      )
    ),
  ];

  it('!! F9 — the checker FIRES on every form that used to walk past, and on none that should not', () => {
    for (const walkedPast of [
      'צמצם ₪600 במסעדות',
      'צמצמי ₪600 במסעדות',
      'יש לצמצם ₪600 במסעדות',
      'צריך להפחית את ההוצאה',
      'כדאי לצמצם את המסעדות',
      'הימנעו מרכישות גדולות',
    ]) {
      expect(instructionFormsIn(walkedPast), walkedPast).not.toEqual([]);
    }
    // …and the T6 version's own four still fire, so widening did not lose what it had.
    for (const original of ['צמצמו ₪600', 'הפחיתו ₪600', 'חסכו ₪600', 'הורידו ₪600']) {
      expect(instructionFormsIn(original), original).toHaveLength(1);
    }
    // The register the ruling ASKS FOR is untouched, and so is the bare infinitive used as a noun
    // phrase — which is what the shipped refusal actually says.
    expect(instructionFormsIn('כדאי לבדוק אותה ראשונה')).toEqual([]);
    expect(instructionFormsIn('סך ההוצאות המשתנות שניתן לצמצם בתקופה')).toEqual([]);
  });

  it('!! F9 — NO sentence in D29`s advice block is an instruction, in any inflection', () => {
    // The arithmetic behind the row is a proportional share of a shortfall against a moving
    // average. That is a reasonable place to LOOK, not a budget the family agreed to, and phrasing
    // it as an instruction states a certainty the computation does not have. Scoped to the WHOLE
    // block, because the ruling is about the surface and not about one template.
    const sentences = everyAdviceSentence();
    expect(sentences.length).toBeGreaterThan(ALLOWANCE_RANK_WORDS_HE.length);
    for (const sentence of sentences) {
      expect(instructionFormsIn(sentence), sentence).toEqual([]);
    }
  });

  it('the allowance ROW leads with the category, the shekels and the recommendation register', () => {
    const row = allowanceLeadHe({
      categoryId: 'מסעדות',
      projectedText: '₪2,400.00',
      rankWord: ALLOWANCE_RANK_WORDS_HE[0],
      isLargest: true,
    });
    expect(row).toContain('כדאי לבדוק');
    expect(row).toContain('מסעדות');
    expect(row).toContain('₪2,400.00');
  });

  it('names the OTHER levers, so the copy does not imply cutting is the only path', () => {
    expect(ALLOWANCE_OTHER_LEVERS_HE).toContain('דחיית');
    expect(ALLOWANCE_OTHER_LEVERS_HE).toContain('הגדלת הכנסה');
  });

  it('!! F7 — the horizon phrase AGREES IN NUMBER at 1 and 2 months, both of which are reachable', () => {
    // `MAX_HORIZON_MONTHS` is 12 and the floor is 1, so `בתקופה של 1 חודשים` and `2 חודשים` both
    // ship today and both are wrong Hebrew. Only 3 was tested. Hebrew has a DUAL, and a family
    // reading "1 חודשים" on the one screen that tells them what to do with money reads a machine.
    const one = allowanceUnreachableHe({ targetText: '₪1', months: 1, flexibleTotalText: '₪1', gapText: '₪1' });
    expect(one).toContain('חודש אחד');
    expect(one).not.toMatch(/1 חודשים/);

    const two = allowanceUnreachableHe({ targetText: '₪1', months: 2, flexibleTotalText: '₪1', gapText: '₪1' });
    expect(two).toContain('חודשיים');
    expect(two).not.toMatch(/2 חודשים/);

    // …and the plural is untouched from 3 up, across the whole reachable range.
    for (const months of [3, 4, 6, 11, 12]) {
      const many = allowanceUnreachableHe({ targetText: '₪1', months, flexibleTotalText: '₪1', gapText: '₪1' });
      expect(many, `months=${months}`).toContain(`${months} חודשים`);
    }
  });

  it('!! F7 — and the same construct in the seasonality hover, where n = 2 is the MINIMUM', () => {
    // `SEASONALITY_MIN_OBSERVATIONS` is 2, so `לפי 2 חודשים כאלה` is not an edge case of that
    // sentence — it is the first one a family could ever see. One shared helper, both sentences.
    expect(seasonalFactorObservedHe({ monthName: 'ספטמבר', percent: 30, n: 2 })).toContain('חודשיים כאלה');
    expect(seasonalFactorObservedHe({ monthName: 'ספטמבר', percent: 30, n: 2 })).not.toMatch(/2 חודשים/);
    expect(seasonalFactorObservedHe({ monthName: 'ספטמבר', percent: 30, n: 4 })).toContain('4 חודשים כאלה');
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
