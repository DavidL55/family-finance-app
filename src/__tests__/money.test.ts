// src/__tests__/money.test.ts — Stage 7 T7c. §7's "ONE MONEY FORMATTER", finished.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE APP'S ONE MONEY FORMATTER HAD NO SUITE OF ITS OWN
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// `formatILS` has been asserted THROUGH other things — an AI-settings screen rendering `₪—` for a
// corrupt counter, `forecastTargets.test.ts` proving `roundILS` normalises `-0` by reading what the
// formatter would print. Nothing held the formatter itself: not the locale, not the fraction
// digits, not the sub-agora sentence, not the `₪` prefix. §7 states all four as constraints and
// they were held by the fact that nobody had edited the function.
//
// ── AND THIS IS THE KIND OF GUARD THE SPLIT SAID TO WRITE ─────────────────────────────────────
//
// The `forecast.ts` split wrote down the general lesson: **a guard keyed on "does anyone import X
// from module M" goes quiet the moment X leaves M; a guard keyed on "what does M's X look like"
// goes red.** `formatILS` has moved house once already this stage — `aiCeiling.ts` → `money.ts`,
// with a re-export left behind — and an import-shaped guard would have gone silent through exactly
// that move. So the assertions below are about the OUTPUT: what the function produces, digit by
// digit, including the one character that proves the locale is `he-IL` and not the host's.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { SRC_ROOT, listSourceFiles, parseSource, readSourceCached, stripComments } from './helpers/extractionSurfaces';
import { forecastClosure, importSpecifiersOf, resolveWithinSrc, srcRelative } from './helpers/forecastModules';
import * as ts from 'typescript';
import { formatILS } from '../config/money';
import { formatILS as reExported } from '../config/aiCeiling';

const MONEY_MODULE = `${SRC_ROOT}/config/money.ts`;
const COPY_MODULE = `${SRC_ROOT}/utils/forecastCopy.ts`;

/** !! U+200E. `he-IL` puts a LEFT-TO-RIGHT MARK before the minus; `en-US`, `de-DE` and the host
 * default do not. It is the one observable difference between "this function names its locale" and
 * "this function follows whatever machine it is running on", and it is what makes §7's `he-IL`
 * requirement provable from the OUTPUT rather than from the source text. */
const LRM = '‎';

describe('!! §7 — `formatILS` is `he-IL`, two fraction digits, and a ₪ in front', () => {
  it('groups in thousands and always shows exactly two fraction digits', () => {
    expect(formatILS(1234567.891)).toBe('₪1,234,567.89');
    expect(formatILS(1000)).toBe('₪1,000.00');
    // A whole number still gets its agorot, so a column of figures aligns on the point. This is the
    // half of the "one formatter" rule that a hand-rolled `toLocaleString()` loses first — the
    // Task-8 finding that put the formatter in a module at all was ₪0, ₪0.038 and ₪1,234.568 in one
    // table.
    expect(formatILS(42)).toBe('₪42.00');
    expect(formatILS(0.125)).toBe('₪0.13');
  });

  it('!! the locale is NAMED, not inherited — proven by a character only `he-IL` emits', () => {
    // Without this the whole "he-IL" clause of §7 is held by reading the source. `toLocaleString()`
    // with no locale follows the device, which is how the same table rendered differently on two
    // phones; the LRM is the observable that separates the two implementations.
    const negative = formatILS(-1234.5);
    expect(negative).toContain(LRM);
    expect(negative).toBe(`₪${LRM}-1,234.50`);
    // The control: the host default here is NOT he-IL, so the mark cannot have arrived by accident.
    expect((-1234.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })).not.toContain(LRM);
  });

  it('an unreadable amount is a WORD, not a zero — `null` and `NaN` both', () => {
    // Boris's standing rule at the render boundary: a failed read is an error state, never an empty
    // one. `₪0.00` for "we could not read this" is the same lie as an empty list for a denied query.
    expect(formatILS(null)).toBe('₪—');
    expect(formatILS(Number.NaN)).toBe('₪—');
    expect(formatILS(Number.POSITIVE_INFINITY)).toBe('₪—');
  });

  it('a real charge smaller than an agora says so rather than rounding away to nothing', () => {
    // A genuine ₪0.0004 AI charge displayed as `₪0.00` reads as FREE. Rounding UP to `₪0.01` would
    // overstate a real number. "Less than an agora" is the only form that is both readable and true.
    expect(formatILS(0.0004)).toBe('פחות מ-₪0.01');
    expect(formatILS(0.009)).toBe('פחות מ-₪0.01');
    // …and the boundary belongs to the ordinary path: one agora is displayable.
    expect(formatILS(0.01)).toBe('₪0.01');
  });

  it('!! the sub-agora rule is ONE-SIDED, and that is a decision with a reachability argument', () => {
    // `amount > 0 && amount < 0.01`. A sub-agora NEGATIVE renders `₪-0.00` instead, and it stays
    // that way for two reasons rather than by omission:
    //
    //  1. The two sides mean different things. `₪0.00` for a real positive charge reads as FREE,
    //     which is the lie the sentence exists to prevent. `₪-0.00` does not read as free — the
    //     minus is visible and truthful, and the magnitude genuinely is under an agora.
    //  2. Inventing a second Hebrew sentence for the negative side inside a GUARDS task would be
    //     product copy written without a copy review, on a screen whose every other string went
    //     through one.
    //
    // Reachable? Every forecast figure passes `roundILS`, which sends any residue in (-0.005, 0] to
    // `+0` — so the forecast cannot produce one. The AI-cost figures are estimated spend and are
    // never negative. Asserted here so the claim is a measurement rather than this paragraph.
    expect(formatILS(-0.004)).toBe(`₪${LRM}-0.00`);
    expect(formatILS(0.004)).toBe('פחות מ-₪0.01');
  });

  it('!! `-0` keeps its sign, and that is load-bearing for a test in another file', () => {
    // `forecastTargets.test.ts`'s F3 negative control asserts exactly this, because the fix for "a
    // minus sign on a met target" lives in `roundILS` and not here — and a control that cannot fail
    // proves nothing about the rule it is controlling for. Normalising `-0` in the formatter would
    // silently delete that control while leaving it green.
    expect(formatILS(-0)).toContain('-');
    expect(formatILS(-0)).not.toBe(formatILS(0));
    expect(formatILS(0)).toBe('₪0.00');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ONE FORMATTER — the structural half
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** The modules that DECLARE a function named `formatILS`, derived rather than named. */
function declaringModules(): string[] {
  return listSourceFiles(SRC_ROOT)
    .filter((file) => {
      const sourceFile = parseSource(file, stripComments(readSourceCached(file), file));
      let found = false;
      sourceFile.forEachChild((node) => {
        if (ts.isFunctionDeclaration(node) && node.name?.text === 'formatILS') found = true;
        if (ts.isVariableStatement(node)) {
          for (const d of node.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.name.text === 'formatILS') found = true;
          }
        }
      });
      return found;
    })
    .map(srcRelative)
    .sort();
}

/**
 * The modules that draw the forecast's money: the engine's whole import closure, plus every
 * component that imports BOTH the forecast copy and the formatter.
 *
 * The conjunction is the definition, not a convenience. `Dashboard.tsx` imports the copy module (it
 * renders the card's label vocabulary) and does NOT import the formatter — its own `toLocaleString`
 * figures are net worth and cash flow, which are §7's "untouched" territory and not this stage's
 * money. A module that has the one formatter in scope and formats by hand anyway is the case worth
 * banning, and it is exactly what "imports both" selects.
 */
function forecastMoneyModules(): string[] {
  const components = listSourceFiles(SRC_ROOT).filter((file) => {
    const specifiers = importSpecifiersOf(file, stripComments(readSourceCached(file), file));
    const resolved = specifiers.map((s) => resolveWithinSrc(file, s));
    return resolved.includes(MONEY_MODULE) && resolved.includes(COPY_MODULE);
  });
  return [...new Set([...components, ...forecastClosure()])].sort();
}

/** Every `toLocaleString` call site in a file, after comments are removed. */
function localeStringCallsIn(file: string): string[] {
  const source = stripComments(readSourceCached(file), file);
  const sourceFile = parseSource(file, source);
  const calls: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'toLocaleString'
    ) {
      calls.push(node.getText(sourceFile).replace(/\s+/g, ' '));
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return calls;
}

describe('!! §7 — ONE money formatter, and the modules that draw money have no second one', () => {
  it('!! `formatILS` is DECLARED in exactly one module, and `aiCeiling` only re-exports it', () => {
    // The move it already made is the reason this is asserted on the DECLARATION rather than on who
    // imports what: `aiCeiling.ts` still publishes the name, and the whole point of the move was
    // that there is still exactly one implementation behind both addresses.
    expect(declaringModules()).toEqual(['config/money.ts']);
    expect(reExported).toBe(formatILS);
    const ceiling = stripComments(readFileSync(`${SRC_ROOT}/config/aiCeiling.ts`, 'utf8'), 'aiCeiling.ts');
    expect(ceiling).toMatch(/export\s*\{\s*formatILS\s*\}\s*from\s*'\.\/money'/);
  });

  it('the derived module set is NON-VACUOUS and covers the surfaces that draw ₪', () => {
    const modules = forecastMoneyModules().map(srcRelative);
    expect(modules).toEqual(
      expect.arrayContaining([
        'components/ForecastScreen.tsx',
        'components/ForecastChart.tsx',
        'components/ForecastCard.tsx',
        'utils/forecast.ts',
        'utils/forecastCopy.ts',
      ])
    );
    // …and the exclusion is deliberate and asserted, not an accident of the query.
    expect(modules).not.toContain('components/Dashboard.tsx');
  });

  it('!! no forecast module formats a number by hand — `toLocaleString` appears in none of them', () => {
    const offenders = forecastMoneyModules().flatMap((file) =>
      localeStringCallsIn(file).map((call) => `${relative(SRC_ROOT, file)}: ${call}`)
    );
    expect(offenders).toEqual([]);
  });

  it('!! THE CHECK FIRES — a hand-rolled figure is seen, and a COMMENT about one is not', () => {
    // Both halves, because `forecastTargets.ts` discusses `toLocaleString` in a comment three lines
    // above the rounding rule, and a text-level version of this ban would be permanently red on the
    // file that explains why the ban exists.
    const relapse = `export const line = (n: number) => \`₪\${n.toLocaleString('he-IL')}\`;`;
    expect(localeStringCallsIn.length).toBeGreaterThan(0); // the function exists, not a stub
    const sourceFile = parseSource('src/utils/probe.ts', relapse);
    let calls = 0;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'toLocaleString'
      ) {
        calls += 1;
      }
      node.forEachChild(visit);
    };
    visit(sourceFile);
    expect(calls).toBe(1);
    // The comment case, measured on the real file the ban would otherwise be red on.
    const targets = `${SRC_ROOT}/utils/forecastTargets.ts`;
    expect(readSourceCached(targets)).toContain('toLocaleString');
    expect(localeStringCallsIn(targets)).toEqual([]);
  });
});
