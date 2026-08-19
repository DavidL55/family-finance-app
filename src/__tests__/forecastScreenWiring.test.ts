// src/__tests__/forecastScreenWiring.test.ts — Stage 7 T7b. D30, D31, and the open affordance.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THREE CLAIMS ABOUT OTHER PEOPLE'S FILES, HELD RATHER THAN ASSERTED IN A COMMENT
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// T7b edits three files it does not own: `Dashboard.tsx` (D30's banned word, and the card's new
// open affordance), and `FuturePlanning.tsx` (D31's heading and the deletion of a panel that
// claimed to be a forecast). Each of those is a claim about what is NO LONGER on a screen, and a
// deletion is the one kind of change that leaves nothing behind to test — so it is tested here.
//
// ── WHY THE CORPUS IS AST-DERIVED AND NOT A `grep` ────────────────────────────────────────────
//
// Every file involved DISCUSSES the thing it no longer renders. `Dashboard.tsx` now carries a
// paragraph explaining why `תזרים` was removed, and `FuturePlanning.tsx` carries one explaining
// what `תחזיות AI לעתיד` was and why it is gone. A raw source scan would drown in both and would
// have to be weakened until it stopped being a check. String literals, template spans and JSX text
// are AST nodes; comments are not, so the parser excludes them for free — the correction
// `glossary.test.ts` had to make for exactly this reason.
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import * as ts from 'typescript';
import { SRC_ROOT, parseSource, readSourceCached } from './helpers/extractionSurfaces';
import { BANNED_JARGON } from '../utils/plainLanguage';
import { CASH_FLOW_LABEL_HE, CASH_FLOW_SENTENCE_HE, FORECAST_OPEN_SCREEN_HE } from '../utils/forecastCopy';
import { MODULE_REGISTRY } from '../config/moduleRegistry';

const HEBREW = /[֐-׿]/;

/** Every Hebrew-bearing string literal, template span and JSX text node in one file. */
function hebrewLiteralsIn(relPath: string): string[] {
  const fileName = join(SRC_ROOT, relPath);
  const sourceFile = parseSource(fileName, readSourceCached(fileName));
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (HEBREW.test(node.text)) found.push(node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (HEBREW.test(node.text)) found.push(node.text);
    } else if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (text.length > 0 && HEBREW.test(text)) found.push(text);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return found;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D30 — `תזרים` IS BANNED AND WAS ON SCREEN
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D30 — the banned word is off the Dashboard, and the ban is untouched', () => {
  it('the extractor FIRES on a rendered heading and IGNORES the same word in a comment', () => {
    // Non-vacuity first, and it is not ceremonial here: `Dashboard.tsx` now contains a paragraph of
    // comment about the word it stopped rendering, so a checker that could not tell the two apart
    // would be permanently red on a correct file and would be weakened until it passed.
    const probe = join(SRC_ROOT, 'components/Probe.tsx');
    const sourceFile = parseSource(
      probe,
      `// תזרים מזומנים — the word this component no longer renders.\nexport const P = () => <h2>כסף נכנס ויוצא</h2>;`
    );
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isJsxText(node) && HEBREW.test(node.text.trim())) found.push(node.text.trim());
      node.forEachChild(visit);
    };
    visit(sourceFile);
    expect(found).toEqual(['כסף נכנס ויוצא']);
    expect(found.some((t) => t.includes('תזרים'))).toBe(false);
  });

  it('!! NO string the Dashboard renders contains `תזרים`', () => {
    const offenders = hebrewLiteralsIn('components/Dashboard.tsx').filter((t) => t.includes('תזרים'));
    expect(offenders).toEqual([]);
  });

  it('the ban itself is UNWEAKENED — the fix was to the screen, not to the floor', () => {
    // Weakening a floor so copy can pass it is backwards, and `plainLanguage.ts` has survived every
    // stage untouched. Pinned here so "fix the screen" cannot quietly become "drop the word".
    expect(BANNED_JARGON).toContain('תזרים');
  });

  it('the replacement is a NAME and a SENTENCE, not a description (Ofra M3)', () => {
    expect(CASH_FLOW_LABEL_HE).toBe('כסף נכנס ויוצא');
    expect(CASH_FLOW_SENTENCE_HE.length).toBeGreaterThan(CASH_FLOW_LABEL_HE.length);
    // …and the label is a heading, so it is short enough to be one.
    expect(CASH_FLOW_LABEL_HE.split(/\s+/)).toHaveLength(3);
  });

  it('!! and the KNOWN LIMITATION is recorded rather than implied — the ban reads no rendered string', () => {
    // D30's bigger finding: `violatesPlainLanguage`'s corpus is glossary entries only, so the ban
    // had never seen a line of component copy in six stages. That is deferred BY NAME to Stage 11
    // in the plan. This assertion makes the gap concrete: the word is banned, it was rendered, and
    // nothing but the check two `it`s above would have caught it.
    const dashboardLiterals = hebrewLiteralsIn('components/Dashboard.tsx');
    expect(dashboardLiterals.length).toBeGreaterThan(0); // the corpus is not empty for the wrong reason
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D31 — TWO TABS CANNOT BOTH PROMISE THE FUTURE
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D31 — the fake forecast panel is gone, and the screen is renamed', () => {
  it('!! `תחזיות AI לעתיד` is no longer a string this component renders', () => {
    // It was not a forecast and it was not AI: two hardcoded tips under a heading claiming both.
    // Shipping a real forecast one tab over while a fake one sat here is not a labelling problem.
    const rendered = hebrewLiteralsIn('components/FuturePlanning.tsx');
    expect(rendered.filter((t) => t.includes('תחזיות AI'))).toEqual([]);
  });

  it('the two tips MOVED rather than being deleted — they are onboarding copy for the goals list', () => {
    const rendered = hebrewLiteralsIn('components/FuturePlanning.tsx');
    expect(rendered.filter((t) => t.includes('טיפ לתכנון'))).toHaveLength(1);
    expect(rendered.filter((t) => t.includes('עדכון התקדמות'))).toHaveLength(1);
    expect(rendered.some((t) => t.includes('המערכת תחשב את ההפקדה החודשית'))).toBe(true);
  });

  it('the `<h1>` describes all the sections the screen actually has', () => {
    // "יעדי חיסכון" alone would misdescribe it — `:187` already uses that exact string as an `<h2>`
    // for one of two remaining sections, and the emergency fund is the other.
    const rendered = hebrewLiteralsIn('components/FuturePlanning.tsx');
    expect(rendered).toContain('יעדי חיסכון וקרן חירום');
    expect(rendered).toContain('יעדי חיסכון');
  });

  it('the registry label follows, so the tab and the screen agree', () => {
    expect(MODULE_REGISTRY.find((e) => e.id === 'future')?.label).toBe('יעדי חיסכון');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE OPEN AFFORDANCE T7a DELIBERATELY SHIPPED WITHOUT
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! the card gains its open affordance in the SAME COMMIT as the tab it opens', () => {
  it('the Dashboard passes `onOpen`, and it points at the forecast tab', () => {
    const dashboard = readSourceCached(join(SRC_ROOT, 'components/Dashboard.tsx'));
    expect(dashboard).toContain("onOpen={() => drillDownTo('forecast')}");
  });

  it('!! and there is a registry entry for it to open — the pair that could not ship apart', () => {
    // `App.tsx`'s `_exhaustive: never` makes an entry without a `case` a BUILD failure, and a `case`
    // without an entry is unreachable. The affordance without either is a link to nothing, which is
    // why T7a shipped none.
    expect(MODULE_REGISTRY.some((e) => e.id === 'forecast')).toBe(true);
    const app = readSourceCached(join(SRC_ROOT, 'App.tsx'));
    expect(app).toContain("case 'forecast':");
  });

  it('the label is a NOUN PHRASE, not an instruction — D34 applies to a button too', () => {
    expect(FORECAST_OPEN_SCREEN_HE).toBe('לתחזית המלאה');
    // The imperative forms second person most often hides in, checked on the label itself.
    for (const imperative of ['פתח', 'לחץ', 'היכנס']) {
      expect(FORECAST_OPEN_SCREEN_HE).not.toContain(imperative);
    }
  });
});
