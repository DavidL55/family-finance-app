// src/__tests__/monthLiteralGuard.test.ts — Stage 7 T6, D24/A39. THE NO-MONTH-LITERAL GUARD.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHAT v1'S VERSION DID, AND WHY THE FIX IS TWO SCOPES AND NOT ONE
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// v1's guard scanned ONE HARDCODED FILE and banned integer literals 1..12. D7's own seasonality
// shape used STRING keys `'01'..'12'`, which passed cleanly — so the guard was green over exactly
// the defect it was written for, on exactly the module that held it. A39 upheld the finding.
//
// The plan's fix reads: derived from the import graph; bans integers 1..12, the string forms and
// the twelve Hebrew month names, in logic modules only. **That is not buildable as one rule**, and
// the tree says so rather than an argument:
//
//   · `periodMath.ts` contains `month === 12`, `month === 1`, `month === 2`, `month < 1 ||
//     month > 12` and `month <= 2`. It is a CALENDAR module: knowing that December is 12 is its
//     job, and a guard that flags it is a guard someone deletes.
//   · `forecast.ts` contains `months < 1`, `monthsObserved < 1` and `monthsObserved >= 1`, beside
//     the named confidence and lookback constants `2`, `3`, `4`, `6` and `12` — integers in 1..12
//     THAT ARE NOT MONTHS. The T5 ledger flagged this to T6 by name: a guard banning integers 1..12
//     in that module is BORN RED on constants that have nothing to do with the calendar.
//
// Measured, not assumed: a positional refinement (only comparison operands, case clauses and array
// indices) still leaves `months < 1` and `monthsObserved >= 1` in `forecast.ts`, so narrowing the
// SHAPE does not rescue a whole-closure integer ban either. The scope has to narrow instead.
//
// ── SO: THREE BANS, TWO SCOPES, BOTH DERIVED FROM THE TREE ────────────────────────────────────
//
//   BAN A — the twelve HEBREW MONTH NAMES, as whole words in any string literal.
//   BAN B — the STRING FORMS `'01'`..`'12'`, matched as a whole literal.
//     Scope: THE WHOLE FORECAST CLOSURE, minus ONE derived exemption — the SAME one for both bans,
//     `config/hebrewMonths.ts`, the module that defines the calendar's names and §10's two named
//     month keys beside them. This is the half that can honestly claim codebase scope, because
//     neither form has any legitimate use anywhere else in the engine.
//
//   BAN C — INTEGER literals 1..12 in a MONTH-SHAPED POSITION (a comparison operand, a `case`, an
//     array index).
//     Scope: THE ENGINE'S SEASONALITY MODULES, derived as the INTERSECTION of two tree walks —
//     every module under `src/` that DECLARES a seasonally-named export, AND the forecast closure.
//     That is where a month integer can actually arise; `if (month === 9)` is the defect A39 names.
//     The intersection is a measurement rather than a nicety: the declaration half alone also
//     selects `utils/demoCorpusConditions.ts` (it declares `seasonalityAssumption`), which holds
//     eight integer comparisons in 1..12 that are counts of rows, members and observed months — so
//     scoped by declaration alone this ban is BORN RED, the same defect the T5 ledger warned about
//     for `forecast.ts`, one module over. Both halves are asserted to do real work.
//
// ── HOW THE EXEMPTIONS ARE DERIVED, AND THE SECOND THING THEY BUY ─────────────────────────────
//
// No exemption is a filename. Both bans exempt exactly the module that DECLARES
// `HEBREW_MONTH_NAMES`, which is why §10's `MONTH_KEY_SEPTEMBER`/`MONTH_KEY_APRIL` live beside the
// names rather than in the seasonality module. It is asserted to be EXACTLY ONE — so the day
// somebody writes a second copy of the month array, this guard fails. That is D29(c)'s F4
// duplicate-map rule, enforced by the guard that depends on it, and the same uniqueness is asserted
// for `isPeriod` on its own account.
//
// !! BAN B USED TO EXEMPT `isPeriod`'s MODULE TOO, AND THAT EXEMPTION WAS VACUOUS — deleting it
// survived the sweep, because `periodMath.ts` holds no month-key literal at all (`isPeriod` is a
// regex; `monthKeyOf` slices). The T6 review's F5 closed it rather than annotating it: an exemption
// that does nothing today is an exemption that silently absorbs the FIRST `monthKey === '12'`
// written into the calendar module — which is precisely where a December special case would be
// written, and precisely where this ban most needs to be looking. Both remaining exemption claims
// are now asserted to be doing work.
//
// ── THE BOUND, STATED ─────────────────────────────────────────────────────────────────────────
//
// BAN C follows seasonality logic wherever it moves, splits or is renamed, because the scope is
// derived from declaration NAMES rather than from a path. What it cannot see is month arithmetic
// written in a module with nothing seasonal in any of its declared names. That is why bans A and B
// are scoped to the whole closure instead of to the same narrow set: the two forms a hidden module
// would most likely reach for are covered everywhere, and the third is covered where it belongs.
// Accident-proof, not adversary-proof — the same bound `forecastPurity.test.ts` states for itself.
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import * as ts from 'typescript';
import { HEBREW_MONTH_NAMES, MONTH_KEY_APRIL, MONTH_KEY_SEPTEMBER } from '../config/hebrewMonths';
import { SRC_ROOT, parseSource } from './helpers/extractionSurfaces';
import {
  FORECAST_ENTRY_MODULES,
  declaredNamesIn,
  forecastClosure,
  forecastEntryPaths,
  modulesDeclaringNameMatching,
  readFromDisk,
  srcRelative,
} from './helpers/forecastModules';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the checkers — pure over (fileName, source), so each is proven to fire before it is aimed
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every string-literal and template chunk in a file, read off the AST.
 *
 * !! NO `stripComments`, AND THE MUTATION SWEEP IS WHY. The first draft called it here "so that a
 * month name discussed in prose cannot trip the guard" — and removing that call SURVIVED, twice.
 * The claim was not what was doing the work: COMMENT TEXT IS TRIVIA to the TypeScript parser and
 * never becomes a literal node at all, so a walk over literal nodes cannot reach it whether it was
 * stripped or not. `forecastCopy.test.ts` made exactly this correction one task earlier and wrote
 * the same sentence; a call selling a mechanism it is not providing is this stage's F5/F6 class,
 * now on its third instance. The negative tests below still pass — they now test the parser, which
 * is what was actually protecting them all along.
 */
function literalChunks(fileName: string, source: string): string[] {
  const sourceFile = parseSource(fileName, source);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * BAN A. The Hebrew month names appearing as WHOLE HEBREW WORDS inside any string literal.
 *
 * !! WHOLE WORDS, NOT SUBSTRINGS, and the reason is one specific name: `'מאי'` (May) is a substring
 * of ordinary Hebrew words — `'מאיה'` is a member's name in this repo's own fixtures, `'מאיפה'` is a
 * question word. A substring rule would flag a sentence about a person and send whoever inherits
 * this guard to delete it. JavaScript's `\b` does not apply to Hebrew letters, so the literal is
 * tokenised on everything that is NOT a Hebrew letter and the tokens are compared exactly.
 */
function hebrewMonthNamesIn(fileName: string, source: string): string[] {
  const names = new Set(HEBREW_MONTH_NAMES);
  const hits: string[] = [];
  for (const chunk of literalChunks(fileName, source)) {
    for (const token of chunk.split(/[^֐-׿]+/)) {
      if (token.length > 0 && names.has(token)) hits.push(token);
    }
  }
  return hits;
}

/**
 * BAN B. String literals whose whole trimmed value is a month key — `'01'` through `'12'`.
 *
 * Matched as a WHOLE LITERAL rather than as a substring, because `` `${year}-01` `` is a template
 * chunk whose text is `'-01'` and is period ASSEMBLY, not a month literal. The defect A39 names is
 * `monthKey === '09'` — a comparison against a specific month — and that is always a whole literal.
 */
function monthKeyLiteralsIn(fileName: string, source: string): string[] {
  return literalChunks(fileName, source).filter((chunk) => /^(0[1-9]|1[0-2])$/.test(chunk.trim()));
}

const COMPARISON_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);

function isMonthInteger(node: ts.Node): boolean {
  if (!ts.isNumericLiteral(node)) return false;
  if (!/^\d+$/.test(node.text)) return false; // no floats, no hex, no separators
  const value = Number(node.text);
  return value >= 1 && value <= HEBREW_MONTH_NAMES.length;
}

/**
 * BAN C. Integer literals 1..12 in a MONTH-SHAPED POSITION.
 *
 * Position, not mere presence, and the three positions are the three ways a month special-case is
 * written: compared against (`month === 9`), switched on (`case 9:`), or used as an index into a
 * twelve-element array (`names[8]`). A DECLARATION initializer is deliberately not one of them —
 * `const SEASONALITY_MIN_OBSERVATIONS = 2` is a named constant, which is what this codebase asks
 * for everywhere else, and banning it would make the guard an argument against its own house style.
 *
 * It OVER-APPROXIMATES in one direction on purpose: a bare `if (n >= 2)` in a seasonality module is
 * flagged even though 2 is a count and not a month. The remedy is to name the constant, which is
 * the rule anyway, and failing closed is the only direction a guard of this family may be wrong in.
 */
function monthIntegersIn(fileName: string, source: string): string[] {
  // Same as `literalChunks`: no `stripComments`. A numeric literal inside a comment is trivia and
  // produces no `NumericLiteral` node, so the parser is the mechanism here too.
  const sourceFile = parseSource(fileName, source);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && COMPARISON_OPERATORS.has(node.operatorToken.kind)) {
      for (const side of [node.left, node.right]) {
        if (isMonthInteger(side)) hits.push(node.getText(sourceFile).trim());
      }
    }
    if (ts.isCaseClause(node) && isMonthInteger(node.expression)) {
      hits.push(`case ${node.expression.getText(sourceFile)}`);
    }
    if (ts.isElementAccessExpression(node) && isMonthInteger(node.argumentExpression)) {
      hits.push(node.getText(sourceFile).trim());
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return hits;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// non-vacuity FIRST — every checker fires on a synthetic source built to break it
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('the checkers can fail — proven on synthetic sources before they are aimed at the tree', () => {
  const here = join(SRC_ROOT, 'utils/synthetic.ts');

  it('flags a Hebrew month name in a string, in a template, and inside a sentence', () => {
    expect(hebrewMonthNamesIn(here, "const m = 'ספטמבר';")).toEqual(['ספטמבר']);
    expect(hebrewMonthNamesIn(here, 'const m = `חודש אפריל יקר`;')).toEqual(['אפריל']);
    expect(hebrewMonthNamesIn(here, "const m = 'ההוצאות של דצמבר, לפי מאי';")).toEqual(['דצמבר', 'מאי']);
  });

  it('does NOT flag a month name that only appears in a COMMENT — the PARSER is the mechanism', () => {
    // !! THE TITLE AND THIS COMMENT USED TO SAY "the stripper is load-bearing", three sections below
    // the block above `literalChunks` explaining that `stripComments` had been REMOVED as dead —
    // in the file that documents that class. T6 review, F8. There is no stripper on this path and
    // there never needed to be: comment text is TRIVIA to the TypeScript parser and never becomes a
    // literal node, so a walk over literal nodes cannot reach it.
    expect(hebrewMonthNamesIn(here, "// ספטמבר is banned as a literal\nconst x = 1;")).toEqual([]);
    // …and the inverse, which is what makes the pair mean something rather than the single case:
    // the SAME TEXT AS CODE fires. Without it, a checker that had simply stopped seeing Hebrew at
    // all would pass the line above and make every ban below vacuous.
    expect(hebrewMonthNamesIn(here, "const x = 'ספטמבר';")).toEqual(['ספטמבר']);
  });

  it('does NOT flag a month name that is a SUBSTRING of another Hebrew word', () => {
    // `'מאי'` is May and is also the first three letters of `'מאיה'`, a member name in this repo's
    // own fixtures. A substring rule would flag a sentence about a person.
    expect(hebrewMonthNamesIn(here, "const n = 'מאיה';")).toEqual([]);
    expect(hebrewMonthNamesIn(here, "const q = 'מאיפה זה הגיע';")).toEqual([]);
    expect(hebrewMonthNamesIn(here, "const n = 'ספטמברים';")).toEqual([]);
  });

  it('flags a month KEY string, exactly', () => {
    expect(monthKeyLiteralsIn(here, "if (key === '09') return 1;")).toEqual(['09']);
    expect(monthKeyLiteralsIn(here, "const k = '12';")).toEqual(['12']);
  });

  it('does NOT flag a month key that is part of a longer literal, or out of range', () => {
    // Period ASSEMBLY is not a month literal: `${year}-01` is a template chunk of `'-01'`.
    expect(monthKeyLiteralsIn(here, 'const p = `${year}-01`;')).toEqual([]);
    expect(monthKeyLiteralsIn(here, "const p = '2026-09';")).toEqual([]);
    expect(monthKeyLiteralsIn(here, "const p = '00';")).toEqual([]);
    expect(monthKeyLiteralsIn(here, "const p = '13';")).toEqual([]);
    expect(monthKeyLiteralsIn(here, "const p = '9';")).toEqual([]);
  });

  it('flags a month INTEGER in each of the three shapes a special-case is written in', () => {
    expect(monthIntegersIn(here, 'if (month === 9) return 1;')).toHaveLength(1);
    expect(monthIntegersIn(here, 'if (12 !== month) return 1;')).toHaveLength(1);
    expect(monthIntegersIn(here, 'switch (m) { case 4: return 1; }')).toHaveLength(1);
    expect(monthIntegersIn(here, 'const n = names[8];')).toHaveLength(1);
    expect(monthIntegersIn(here, 'if (month <= 2) return 1;')).toHaveLength(1);
  });

  it('does NOT flag an integer outside 1..12, a float, or a named constant', () => {
    expect(monthIntegersIn(here, 'if (n === 0) return 1;')).toEqual([]);
    expect(monthIntegersIn(here, 'if (n === 13) return 1;')).toEqual([]);
    expect(monthIntegersIn(here, 'if (n === 1.5) return 1;')).toEqual([]);
    expect(monthIntegersIn(here, 'if (n >= MIN_OBSERVATIONS) return 1;')).toEqual([]);
    // A declaration initializer is not a month-shaped position — naming the constant is the fix
    // this guard asks for, so flagging the named constant would be circular.
    expect(monthIntegersIn(here, 'const MIN = 2;')).toEqual([]);
    expect(monthIntegersIn(here, 'const n = arr[i];')).toEqual([]);
  });

  it('does NOT flag a month integer that only appears in a comment or a string', () => {
    expect(monthIntegersIn(here, '// month === 9 is banned\nconst x = 1;')).toEqual([]);
    expect(monthIntegersIn(here, "const s = 'month === 9';")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the scopes — derived, and asserted to be neither empty nor a claim about one file
// ─────────────────────────────────────────────────────────────────────────────────────────────

const closure = forecastClosure();
const closureSet = new Set(closure);

/**
 * BAN C's scope: every module that DECLARES a seasonally-named export **and** is inside the forecast
 * engine's own closure.
 *
 * !! THE INTERSECTION IS NOT TIDINESS, IT IS A MEASUREMENT. The declaration half alone also selects
 * `utils/demoCorpusConditions.ts`, which declares `seasonalityAssumption` — a CORPUS CONDITION, not
 * seasonality arithmetic — and which holds eight integer comparisons in 1..12 that are counts of
 * rows, members and observed months (`counts.length < 2`, `rows.length === 1`, `nameCount(...) > 1`).
 * Scoped by declaration alone, this ban is BORN RED on that module, which is the same defect the T5
 * ledger warned about for `forecast.ts`, one module over. The intersection with the closure is what
 * makes the scope "the engine's seasonality logic" rather than "everything with the word in it",
 * and the test below asserts both halves of that so neither can quietly stop doing its job.
 */
function seasonalityModules(): string[] {
  return modulesDeclaringNameMatching(/seasonal/i).filter((file) => closureSet.has(file));
}

/** The single module declaring a name, or a failure if there is not exactly one. */
function soleModuleDeclaring(name: string, files: string[]): string {
  const found = files.filter((file) => declaredNamesIn(file, readFromDisk(file)).includes(name));
  expect(found.map(srcRelative), `exactly one module may declare \`${name}\``).toHaveLength(1);
  return found[0];
}

describe('the scopes come from the tree, not from a list typed here', () => {
  it('every named entry module exists — a root that does not resolve seeds an empty walk', () => {
    for (const path of forecastEntryPaths()) {
      expect(() => readFromDisk(path), `missing forecast entry ${srcRelative(path)}`).not.toThrow();
    }
    expect(FORECAST_ENTRY_MODULES.length).toBeGreaterThan(0);
  });

  it('the closure is real, reaches past the entries, and contains every one of them', () => {
    for (const path of forecastEntryPaths()) expect(closure).toContain(path);
    // Strictly more than the entries: the walk followed imports. If this ever equalled the entry
    // count the walk would have stopped at the roots and every ban below would cover four files.
    expect(closure.length).toBeGreaterThan(FORECAST_ENTRY_MODULES.length);
    // And it reaches the modules the bans exist for.
    expect(closure.map(srcRelative)).toEqual(
      expect.arrayContaining(['utils/periodMath.ts', 'utils/forecastCopy.ts', 'config/hebrewMonths.ts'])
    );
  });

  it('EXACTLY ONE module declares the twelve month names — the F4 duplicate-map rule, enforced', () => {
    // Not a filename check. A second copy of the array anywhere under `src/` fails here, which is
    // what D29(c)'s "moved, not duplicated" needs in order to stay true after this task.
    const holder = soleModuleDeclaring('HEBREW_MONTH_NAMES', closure);
    expect(srcRelative(holder)).toBe('config/hebrewMonths.ts');
  });

  it('EXACTLY ONE module declares `isPeriod` — one calendar authority, derived the same way', () => {
    // This is NO LONGER a ban exemption (F5 closed BAN B's second one as vacuous). It stays because
    // the property it states is worth holding on its own: two definitions of "what a period is" is
    // how two halves of one screen start disagreeing about which months exist, and every caller of
    // `comparePeriod` in this stage depends on there being one answer.
    const holder = soleModuleDeclaring('isPeriod', closure);
    expect(srcRelative(holder)).toBe('utils/periodMath.ts');
  });

  it('the seasonality scope is derived by DECLARATION ∩ CLOSURE, and is not empty', () => {
    const modules = seasonalityModules();
    expect(modules.length).toBeGreaterThan(0);
    expect(modules.map(srcRelative)).toContain('utils/seasonality.ts');
    // !! AND `forecast.ts` IS DELIBERATELY NOT IN IT. It RE-EXPORTS `SeasonalFactor` rather than
    // declaring it, precisely so that its `months < 1` and `monthsObserved >= 1` — integer literals
    // in 1..12 that are not months, flagged to T6 by name in the T5 ledger — stay outside BAN C.
    // Move the interface's declaration back and this assertion fails before the ban does.
    expect(modules.map(srcRelative)).not.toContain('utils/forecast.ts');
  });

  it('!! BOTH halves of the intersection do real work — measured, not asserted by comment', () => {
    const declared = modulesDeclaringNameMatching(/seasonal/i).map(srcRelative);
    // The declaration half reaches OUTSIDE the engine…
    expect(declared).toContain('utils/demoCorpusConditions.ts');
    // …and that module is not engine code, so the closure half removes it.
    expect(seasonalityModules().map(srcRelative)).not.toContain('utils/demoCorpusConditions.ts');
    // The reason it must be removed, stated as a number rather than as an opinion: it holds
    // integer comparisons in 1..12 that are counts of rows and members, not months. Scoped by
    // declaration alone this ban would be born red on them.
    const conditions = join(SRC_ROOT, 'utils/demoCorpusConditions.ts');
    expect(monthIntegersIn(conditions, readFromDisk(conditions)).length).toBeGreaterThan(0);
    // And the closure half alone would be far too wide — it is the scope of bans A and B, and it
    // contains the two modules BAN C must never cover.
    expect(closure.map(srcRelative)).toEqual(
      expect.arrayContaining(['utils/periodMath.ts', 'utils/forecast.ts'])
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the bans, over the real tree
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('BAN A — no Hebrew month name is written anywhere in the forecast engine', () => {
  it('holds across the whole closure, except the module that defines the names', () => {
    const exempt = soleModuleDeclaring('HEBREW_MONTH_NAMES', closure);
    const offenders = closure
      .filter((file) => file !== exempt)
      .flatMap((file) => hebrewMonthNamesIn(file, readFromDisk(file)).map((n) => `${srcRelative(file)} -> ${n}`));
    expect(offenders).toEqual([]);
  });

  it('and the exemption is not a hole: the exempt module is the one that holds all twelve', () => {
    // Without this the exemption could be pointing at an empty module while the names live
    // somewhere else and are simply not being looked for.
    const exempt = soleModuleDeclaring('HEBREW_MONTH_NAMES', closure);
    expect(new Set(hebrewMonthNamesIn(exempt, readFromDisk(exempt))).size).toBe(HEBREW_MONTH_NAMES.length);
  });
});

describe("BAN B — no `'01'`..`'12'` string literal outside the module that names the months", () => {
  /**
   * !! ONE exemption, and it used to be two. T6 review, F5.
   *
   * The second was the module declaring `isPeriod` — `periodMath.ts` — and the sweep proved it
   * VACUOUS: deleting it survived, because `periodMath.ts` contains no `'01'`..`'12'` literal at
   * all. `isPeriod` is a REGEX (`^\d{4}-(0[1-9]|1[0-2])$`), and `monthKeyOf` slices a period rather
   * than comparing against a spelled-out key, so the module never needed the licence it held.
   *
   * A vacuous exemption is not harmless here, and that is why it is closed rather than annotated:
   * it would have SILENTLY ABSORBED the first `monthKey === '12'` written into `periodMath.ts` —
   * the module where a December special case is exactly what somebody would reach for, and the one
   * place BAN B most needs to be looking. The guard's own comment meanwhile asserted that both
   * exemptions did work, which is the "a comment asserting a property is a defect unless a test
   * holds it" class this stage counts.
   *
   * What survives is the one exemption that DOES work and is asserted to: `config/hebrewMonths.ts`
   * holds §10's `MONTH_KEY_SEPTEMBER` / `MONTH_KEY_APRIL` beside the names they correspond to,
   * which is this guard's own remedy ("name the constant") applied to itself rather than an
   * exception to it.
   */
  const banBExempt = (): string => soleModuleDeclaring('HEBREW_MONTH_NAMES', closure);

  it('holds across the whole closure', () => {
    const exempt = banBExempt();
    const offenders = closure
      .filter((file) => file !== exempt)
      .flatMap((file) => monthKeyLiteralsIn(file, readFromDisk(file)).map((k) => `${srcRelative(file)} -> '${k}'`));
    expect(offenders).toEqual([]);
  });

  it('!! the remaining exemption is NOT a hole — the module it names really does hold month keys', () => {
    // The mirror of BAN A's own non-hole assertion. An exemption pointing at a module with no month
    // keys in it is a licence granted to nobody while the keys live somewhere else unexamined.
    const exempt = banBExempt();
    expect(srcRelative(exempt)).toBe('config/hebrewMonths.ts');
    expect(new Set(monthKeyLiteralsIn(exempt, readFromDisk(exempt)))).toEqual(
      new Set([MONTH_KEY_SEPTEMBER, MONTH_KEY_APRIL])
    );
  });

  it('!! and the calendar module is now IN SCOPE, clean, and would FIRE — F5 closed, not annotated', () => {
    // The three assertions the closed exemption needs, in the order that makes each one mean
    // something. (1) `periodMath.ts` is inside the ban's scope at all. (2) It is clean today, so
    // closing the exemption costs nothing. (3) The literal the exemption would have absorbed — a
    // December special case, written the way somebody would actually write it — is now caught.
    const periodMath = join(SRC_ROOT, 'utils/periodMath.ts');
    expect(closure).toContain(periodMath);
    expect(periodMath).not.toBe(banBExempt());
    const real = readFromDisk(periodMath);
    expect(monthKeyLiteralsIn(periodMath, real)).toEqual([]);
    expect(
      monthKeyLiteralsIn(periodMath, `${real}\nexport const isDecember = (k: string) => k === '12';\n`)
    ).toEqual(['12']);
  });
});

describe('BAN C — no month integer in the seasonality logic', () => {
  it('holds across every ENGINE module that declares seasonality', () => {
    const offenders = seasonalityModules().flatMap((file) =>
      monthIntegersIn(file, readFromDisk(file)).map((hit) => `${srcRelative(file)} -> ${hit}`)
    );
    expect(offenders).toEqual([]);
  });

  it('!! and the ban is NOT vacuous on the real module — planting one in it would fire', () => {
    // The scope is derived and could in principle resolve to a set of modules none of which this
    // checker would ever look inside. This drives the REAL source of the seasonality module through
    // the checker with one line appended, so the ban is proven to be able to fail WHERE IT IS
    // POINTED rather than only on a synthetic path.
    const seasonality = join(SRC_ROOT, 'utils/seasonality.ts');
    const real = readFromDisk(seasonality);
    expect(monthIntegersIn(seasonality, real)).toEqual([]);
    expect(monthIntegersIn(seasonality, `${real}\nexport const bad = (m: number) => m === 9;\n`)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// !! THE MEASUREMENT THAT SETS THE SCOPE — written as assertions, not as prose
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('why BAN C is not scoped to the whole closure', () => {
  it('the calendar module genuinely contains month integers, and must', () => {
    // `periodMath.ts` rolls December into January and knows February is short. A guard that flagged
    // that is a guard whose first reader deletes it.
    const periodMath = join(SRC_ROOT, 'utils/periodMath.ts');
    expect(monthIntegersIn(periodMath, readFromDisk(periodMath)).length).toBeGreaterThan(0);
  });

  it("the composer contains integers in 1..12 that are NOT months — the T5 ledger's warning, measured", () => {
    // "forecast.ts now holds integer literals 2, 3, 4, 6 as named confidence/lookback constants
    // beside the 3 and 12 it already had — THE MONTH-LITERAL GUARD MUST NOT BAN INTEGERS 1..12 IN
    // THIS MODULE or it is born red on constants that are not months."
    //
    // The positional refinement above narrows that to `months < 1`, `monthsObserved < 1` and
    // `monthsObserved >= 1` — still non-empty, so narrowing the SHAPE does not rescue a
    // whole-closure integer ban and only narrowing the SCOPE does. Asserted so the reasoning cannot
    // silently go stale if those comparisons are one day rewritten.
    const forecast = join(SRC_ROOT, 'utils/forecast.ts');
    expect(monthIntegersIn(forecast, readFromDisk(forecast)).length).toBeGreaterThan(0);
  });
});
