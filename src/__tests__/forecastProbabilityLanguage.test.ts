// src/__tests__/forecastProbabilityLanguage.test.ts — Stage 7 T7c. A39's TWO-TIER BAN, WIDENED.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE DEFECT IS A BAND NAMED שמרן / צפוי / אופטימי. THE WORD "EXPECTED" IS NOT THE DEFECT.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// v1 ran one substring denylist over three words. v2.1/B5 measured what that costs and split it,
// because a single substring list must fail THIS PLAN'S OWN HEADLINE COPY: D38's card label
// `צפוי להישאר בסוף …`, D38's negative verdict `צפוי חוסר`, D38's `'own'` prefix `צפוי לצאת`,
// D17's gap sentence `לא ניתן להציג יתרה צפויה`, and D29(a)'s refusal. **A guard that must fire
// wrongly is the mirror of the defect A39 exists to fix.**
//
//   · TIER 1 — `שמרן`, `אופטימי`: SUBSTRING, everywhere. Neither has any legitimate use in this
//     product's copy; both are the outer thirds of the forbidden band, and a label containing
//     either IS that band whatever else it says.
//   · TIER 2 — `צפוי` and its inflections: EXACT MATCH against `PROBABILITY_LABEL_FORMS`, over
//     LABEL CONSTANTS. `צפוי` is ordinary Hebrew for "expected"; a substring rule over it would ban
//     the word from the product.
//
// ── WHAT MOVED HERE, AND WHY IT IS A MOVE ─────────────────────────────────────────────────────
//
// `forecastCopy.test.ts` held both tiers over `EVERY_LABEL` — the copy module's own labels, and
// nothing else. §12 scopes tier 1 to "every string literal in the forecast copy AND COMPONENT
// modules" and tier 2 to the label constants. Those are two different corpora, both wider than one
// module. The assertions are MOVED rather than copied: two guards over one claim, with the narrow
// one surviving, is this repo's counted F4 shape.
//
// ── BOTH CORPORA ARE DERIVED, AND BOTH HAVE A CANARY ──────────────────────────────────────────
//
// The tier-1 corpus is the forecast engine's import closure UNION every module that imports the
// copy module — so a component added tomorrow is in it without anyone editing a list. The tier-2
// corpus is every EXPORTED `Record<…, string>` in that corpus, read off the AST.
//
// !! THAT IS WIDER THAN §12, DELIBERATELY, AND IT IS DECLARED. §12 scopes tier 2 to "the band,
// scenario and confidence label constants". Naming three constants is the enumeration-guard class
// this stage rejects everywhere else: it passes forever on the fourth. The shape — an exported
// `Record<K, string>` — IS the definition of a label map in this codebase, and it is what an author
// reaches for when adding a band. Widening is safe in the only direction that matters: no
// legitimate label's ENTIRE trimmed value is a bare probability word, which is why the exact-match
// rule can be pointed at all of them and stay quiet. `BALANCE_VERDICT_LABEL_HE.negative` is the
// proof — `'צפוי חוסר'` is inside the widened corpus, is not an exact banned form, and passes.
import { describe, expect, it } from 'vitest';
import { join, relative } from 'node:path';
import { SRC_ROOT, listSourceFiles, readSourceCached, stripComments } from './helpers/extractionSurfaces';
import {
  exportedLabelRecordsIn,
  forecastClosure,
  hebrewStringLiteralsIn,
  importSpecifiersOf,
  resolveWithinSrc,
  secondPersonFormsIn,
  srcRelative,
} from './helpers/forecastModules';
import {
  BALANCE_VERDICT_LABEL_HE,
  BAND_BASIS_LABEL_HE,
  BAND_LABEL_HE,
  FORECAST_OWN_OUTGOING_LABEL_HE,
  MONTH_CONFIDENCE_LABEL_HE,
  PROBABILITY_LABEL_FORMS,
  SCENARIO_NAME_FRAGMENTS,
  allowanceUnreachableHe,
  balanceGapHe,
  forecastBalanceLabelHe,
  forecastShortfallHe,
} from '../utils/forecastCopy';
import { ADVICE_BOUNDARY_NOTICE_HE } from '../config/adviceBoundary';

const FORECAST_COPY = join(SRC_ROOT, 'utils/forecastCopy.ts');

/**
 * §12's tier-1 corpus: the forecast copy and the modules that render it.
 *
 * DERIVED in both halves. The closure walks the engine's entry modules (so the copy module, the
 * month names and the seasonality sentences are in it); the importer scan adds the COMPONENTS,
 * which nothing in the engine's import direction reaches. A component added tomorrow that imports
 * one label is in this corpus on the day it is written.
 *
 * It does NOT reach `config/adviceBoundary.ts` — asserted below, with the sentence checked there
 * rather than assumed covered.
 */
function tierOneCorpus(): string[] {
  const importers = listSourceFiles(SRC_ROOT).filter((file) =>
    importSpecifiersOf(file, stripComments(readSourceCached(file), file)).some(
      (specifier) => resolveWithinSrc(file, specifier) === FORECAST_COPY
    )
  );
  return [...new Set([FORECAST_COPY, ...importers, ...forecastClosure()])].sort();
}

/** Every exported label map in that corpus, with the module it lives in. */
function labelRecords(): Array<{ file: string; name: string; values: string[] }> {
  return tierOneCorpus().flatMap((file) =>
    exportedLabelRecordsIn(file, readSourceCached(file)).map((record) => ({ file, ...record }))
  );
}

const containsScenarioName = (text: string): string[] =>
  SCENARIO_NAME_FRAGMENTS.filter((fragment) => text.toLowerCase().includes(fragment.toLowerCase()));

const isExactBannedForm = (text: string): boolean => PROBABILITY_LABEL_FORMS.includes(text.trim());

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE CORPORA ARE REAL — the canaries, before any ban is asserted
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! §12 — the two corpora are DERIVED and NON-VACUOUS', () => {
  it('the tier-1 corpus holds the copy module AND the components that render it', () => {
    // A superset check, not equality: the fifth forecast component must pass this line and be
    // COVERED by the bans, not fail here. Without it a broken derivation would turn every ban below
    // into a loop over nothing — the shadowing class this stage has counted ten times.
    const corpus = tierOneCorpus().map(srcRelative);
    expect(corpus).toEqual(
      expect.arrayContaining([
        'utils/forecastCopy.ts',
        'utils/forecast.ts',
        'utils/statisticalLayer.ts',
        'components/ForecastScreen.tsx',
        'components/ForecastCard.tsx',
        'components/ForecastChart.tsx',
        'components/Dashboard.tsx',
      ])
    );
  });

  it('!! and what it does NOT reach is named, not left to be discovered', () => {
    // `config/adviceBoundary.ts` is OUTSIDE this corpus and that is a fact about the derivation
    // rather than an oversight: it is neither the forecast copy module nor a module that imports it
    // — §9's boundary is product-wide, which is exactly why the T6 review moved it out of the
    // feature copy module. It is reached only from a component, in the import direction this
    // derivation does not walk.
    //
    // So the sentence is checked HERE, explicitly, instead of being assumed covered. A gap named
    // and closed in one assertion is a gap; a gap assumed to be somebody else's suite is a hole.
    expect(tierOneCorpus().map(srcRelative)).not.toContain('config/adviceBoundary.ts');
    expect(containsScenarioName(ADVICE_BOUNDARY_NOTICE_HE)).toEqual([]);
    expect(isExactBannedForm(ADVICE_BOUNDARY_NOTICE_HE)).toBe(false);
  });

  it('and it yields a real body of Hebrew — not an empty scan reporting green', () => {
    const literals = tierOneCorpus().flatMap((file) => hebrewStringLiteralsIn(file, readSourceCached(file)));
    expect(literals.length).toBeGreaterThan(200);
  });

  it('!! the tier-2 corpus is DERIVED from the AST, and it finds more than the three §12 names', () => {
    const found = labelRecords();
    const names = found.map((record) => record.name);
    // The three §12 names, as a canary rather than as the source…
    expect(names).toEqual(expect.arrayContaining(['BAND_LABEL_HE', 'BAND_BASIS_LABEL_HE', 'MONTH_CONFIDENCE_LABEL_HE']));
    // …and strictly more than three, which is the whole reason it is derived: an enumeration of the
    // three would pass forever on the fourth, and there are already several.
    expect(new Set(names).size).toBeGreaterThan(3);
    expect(found.flatMap((record) => record.values).length).toBeGreaterThan(20);
  });

  it('the derived record values really are the shipped ones, read off the module`s own exports', () => {
    // The AST reader and the runtime value must agree, or the ban runs over a set that is not what
    // the app renders.
    const band = labelRecords().find((record) => record.name === 'BAND_LABEL_HE');
    expect(band?.values.sort()).toEqual(Object.values(BAND_LABEL_HE).sort());
    // …including the NESTED case, which a flat-object reader would have skipped in silence.
    const refusal = labelRecords().find((record) => record.name === 'SEASONALITY_REFUSAL_HE');
    expect(refusal?.values.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// TIER 1 — substring, everywhere
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! A39 tier 1 — `שמרן` and `אופטימי` appear in NO string the forecast can render', () => {
  it('!! over every Hebrew literal in the copy AND the component modules', () => {
    const offenders: string[] = [];
    for (const file of tierOneCorpus()) {
      for (const literal of hebrewStringLiteralsIn(file, readSourceCached(file))) {
        // The denylist itself lives in the corpus and is the one thing that cannot be banned by it:
        // `SCENARIO_NAME_FRAGMENTS`' own two entries. Excluded by IDENTITY — the literal IS a
        // fragment — rather than by filename, so a third module holding the same word is still
        // caught.
        if (SCENARIO_NAME_FRAGMENTS.includes(literal.trim())) continue;
        for (const hit of containsScenarioName(literal)) {
          offenders.push(`${relative(SRC_ROOT, file)}: "${literal}" contains "${hit}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('THE TIER-1 CHECK FIRES — a canary literal in the corpus shape is caught', () => {
    // Non-vacuity. Today every literal passes, so without this the assertion above proves only that
    // two sets of strings do not intersect.
    const canary = 'const s = { high: `תרחיש אופטימי`, low: "תרחיש שמרן" };';
    const literals = hebrewStringLiteralsIn('src/components/Canary.tsx', canary);
    expect(literals.flatMap(containsScenarioName).sort()).toEqual(['אופטימי', 'שמרן']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// TIER 2 — exact match, over label constants
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! A39 tier 2 — `צפוי` is banned as a LABEL, never as a word', () => {
  it('holds §12`s seven forms, and nothing else', () => {
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

  it('!! NO exported label map in the forecast corpus has a value that IS a banned form', () => {
    const offenders = labelRecords()
      .flatMap((record) =>
        record.values
          .filter(isExactBannedForm)
          .map((value) => `${relative(SRC_ROOT, record.file)}:${record.name} = "${value}"`)
      )
      .sort();
    expect(offenders).toEqual([]);
  });

  it('THE TIER-2 CHECK FIRES — a label constant whose value IS `צפוי` is caught', () => {
    const canary = `
      export const SCENARIO_LABEL_HE: Record<'low' | 'mid' | 'high', string> = {
        low: 'שמרן',
        mid: 'צפוי',
        high: 'אופטימי',
      };
    `;
    const [record] = exportedLabelRecordsIn('src/utils/canary.ts', canary);
    expect(record.name).toBe('SCENARIO_LABEL_HE');
    expect(record.values.filter(isExactBannedForm)).toEqual(['צפוי']);
    // …and the two outer thirds are caught by tier 1 in the same fixture, which is A39's whole
    // defect assembled and refused by both halves of the guard at once.
    expect(record.values.flatMap(containsScenarioName).sort()).toEqual(['אופטימי', 'שמרן']);
  });

  it('!! and it does NOT fire on ordinary Hebrew — the distinction the ruling rests on', () => {
    const sentence = 'הסכום הצפוי לחודש הבא מבוסס על מה שהיה';
    expect(sentence).toMatch(/צפוי/); // a substring rule WOULD have fired here
    expect(isExactBannedForm(sentence)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// §12's OWN NON-VACUITY CLAUSE — the copy this guard governs, checked in as a fixture that PASSES
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! §12 — the strings the PLAN specifies must PASS both tiers, and they do', () => {
  // ── WHY THIS IS THE MOST IMPORTANT BLOCK IN THE FILE ─────────────────────────────────────────
  //
  // v2 shipped a guard that would have failed all five of these. The rule §12 wrote afterwards is
  // "a guard is not shipped until it is run against the copy it will govern" — so the copy is here,
  // BUILT BY CALLING THE SHIPPED BUILDERS rather than spelled out. A quoted string in a test drifts
  // from the app the first time the app is edited; a called builder cannot.
  const PLAN_COPY: Array<{ what: string; text: string }> = [
    { what: "D38's card label", text: forecastBalanceLabelHe('דצמבר') },
    { what: "D38's negative verdict", text: forecastShortfallHe('₪3,100.00') },
    { what: "D38's 'own' prefix", text: FORECAST_OWN_OUTGOING_LABEL_HE },
    { what: "D17's gap sentence", text: balanceGapHe(['יתרות חשבונות', 'הכנסות']) },
    {
      // !! THE SHIPPED WORDING, NOT THE PLAN'S. D29(a)'s sentence was changed in one word during
      // T6 and the change is substantive: the plan says `סך ההוצאות המשתנות הצפויות`, the number
      // the refusal compares against is the FLEXIBLE total, and it ships as
      // `סך ההוצאות המשתנות שניתן לצמצם`. Quoting the plan here would have checked a string the app
      // does not say.
      what: "D29(a)'s refusal",
      text: allowanceUnreachableHe({
        targetText: '₪16,000.00',
        months: 3,
        flexibleTotalText: '₪5,000.00',
        gapText: '₪11,000.00',
      }),
    },
  ];

  it('all five carry real copy — the fixture is not five empty strings', () => {
    for (const { what, text } of PLAN_COPY) expect(text.length, what).toBeGreaterThan(3);
    // Four of the five contain the tier-2 word, which is exactly why a substring ban was impossible.
    expect(PLAN_COPY.filter(({ text }) => text.includes('צפוי')).length).toBeGreaterThanOrEqual(4);
  });

  it('!! every one of them PASSES tier 1 and tier 2', () => {
    for (const { what, text } of PLAN_COPY) {
      expect(containsScenarioName(text), what).toEqual([]);
      expect(isExactBannedForm(text), what).toBe(false);
    }
  });

  it('!! `BALANCE_VERDICT_LABEL_HE.negative` is INSIDE the widened tier-2 corpus and passes', () => {
    // The comment above that constant says `צפוי חוסר` "is not an exact member of
    // `PROBABILITY_LABEL_FORMS` and is not meant to be". Until now that was a comment asserting a
    // property nothing held — and it is the single value the widening of tier 2 could plausibly have
    // broken, so it is the value the widening has to be measured on.
    const verdicts = labelRecords().find((record) => record.name === 'BALANCE_VERDICT_LABEL_HE');
    expect(verdicts?.values).toContain(BALANCE_VERDICT_LABEL_HE.negative);
    expect(BALANCE_VERDICT_LABEL_HE.negative).toContain('צפוי');
    expect(isExactBannedForm(BALANCE_VERDICT_LABEL_HE.negative)).toBe(false);
  });

  it('the band and chip labels — §12`s own tier-2 scope — carry no probability language', () => {
    for (const label of [
      ...Object.values(BAND_LABEL_HE),
      ...Object.values(BAND_BASIS_LABEL_HE),
      ...Object.values(MONTH_CONFIDENCE_LABEL_HE),
    ]) {
      expect(isExactBannedForm(label), label).toBe(false);
      expect(containsScenarioName(label), label).toEqual([]);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// !! T7c REVIEW F4 — D34 OVER THE SAME CORPUS, BECAUSE IT WAS COVERING ONE MODULE
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// `forecastCopy.test.ts` holds D34's second-person ban and runs it over `EVERY_LABEL` plus that
// module's own template sentences — the copy module, and nothing else. `config/adviceBoundary.ts`
// was explicitly outside it; `config/hebrewMonths.ts`, `utils/seasonality.ts` and the three forecast
// components were never in it at all, so two component strings escaped D34 entirely — latent rather
// than wrong, because neither is second person today.
//
// The corpus this needs already existed, six lines up: `tierOneCorpus()` is derived in both halves
// and is the same set the probability ban runs over. Pointing D34 at it is the whole fix; the
// checker moved into `helpers/forecastModules.ts` so both suites read one implementation, and the
// argument that trimmed its two lists stays in `forecastCopy.test.ts` beside its own canary.
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The ONE string in the tier-1 corpus that is second person, exempt BY IDENTITY and with its reason.
 *
 * `Dashboard.tsx` is in this corpus because it renders the forecast card, not because it is forecast
 * copy, and this literal is its PERMISSION REFUSAL — a sentence about what the reader may see, which
 * no forecast surface can render and which D34's ruling is not about. It predates Stage 7 entirely.
 *
 * Exempt by the literal's own text rather than by filename, which is the same choice
 * `SCENARIO_NAME_FRAGMENTS` is excluded by above: a SECOND second-person string in `Dashboard.tsx`
 * fails this ban, and so does this one moving to a module that really is forecast copy. The
 * staleness half is asserted too — an exemption for a string nobody renders any more is a hole with
 * a comment on it.
 */
const D34_EXEMPT_LITERALS_HE = ['אין לך הרשאה לצפות בנתון זה'];

describe('!! D34 tier 1 — the forecast does not address the reader, ANYWHERE it speaks', () => {
  it('!! no second person in ANY Hebrew literal of the copy, the engine OR the components', () => {
    const offenders: string[] = [];
    for (const file of tierOneCorpus()) {
      for (const literal of hebrewStringLiteralsIn(file, readSourceCached(file))) {
        if (D34_EXEMPT_LITERALS_HE.includes(literal.trim())) continue;
        const forms = secondPersonFormsIn(literal);
        if (forms.length > 0) {
          offenders.push(`${relative(SRC_ROOT, file)}: "${literal}" -> ${forms.join(', ')}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('!! the exemption is CURRENT — a pinned literal nobody renders is a hole with a comment on it', () => {
    const everyLiteral = tierOneCorpus().flatMap((file) =>
      hebrewStringLiteralsIn(file, readSourceCached(file)).map((literal) => literal.trim())
    );
    for (const exempt of D34_EXEMPT_LITERALS_HE) {
      expect(everyLiteral, exempt).toContain(exempt);
      // …and it is exempt because it IS second person; an exemption for a clean string is noise.
      expect(secondPersonFormsIn(exempt), exempt).not.toEqual([]);
    }
  });

  it('!! THE BAN FIRES over the corpus shape — a canary literal in a component is caught', () => {
    // Non-vacuity, the same way tier 1's probability ban proves itself: today every literal passes,
    // so without this the assertion above proves only that a list of tokens did not appear.
    const canary = 'התחזית שלך לחודש הבא';
    expect(secondPersonFormsIn(canary)).toEqual(['שלך']);
    expect(D34_EXEMPT_LITERALS_HE).not.toContain(canary);
  });

  it('!! and `config/adviceBoundary.ts` is checked HERE, since the derivation does not reach it', () => {
    // Exactly as the probability ban does for the same sentence, and for the same reason: the
    // boundary notice is reached only from a component, in the direction this walk does not go. A
    // gap named and closed in one assertion is a gap; a gap assumed to be somebody else's suite is
    // a hole — and D34's ban is the one that had it.
    expect(tierOneCorpus().map(srcRelative)).not.toContain('config/adviceBoundary.ts');
    expect(secondPersonFormsIn(ADVICE_BOUNDARY_NOTICE_HE)).toEqual([]);
  });
});
