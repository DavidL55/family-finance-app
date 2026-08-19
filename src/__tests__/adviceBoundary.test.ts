// src/__tests__/adviceBoundary.test.ts — T6 review, F10. THE BINDING THE NOTICE SHIPPED WITHOUT.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// A CONSTANT NOBODY IMPORTS IS NOT A BOUNDARY, IT IS A STRING
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// T6 brought §9's advice-boundary notice forward one stage, on the argument that the allowance row
// is the first surface in this app that tells a family what to do with money. The argument was
// right and the delivery was not: `ADVICE_BOUNDARY_NOTICE_HE` was imported by NOTHING, and nothing
// anywhere required it to appear on the same screen as an allowance row. Its own tests asserted
// what the sentence SAYS — which is the "checked beside the mechanism rather than through it" class
// this stage has now counted four times.
//
// ── WHAT THIS GUARD PINS ──────────────────────────────────────────────────────────────────────
//
// **Any module that reaches for the allowance lead must also reach for the boundary notice.**
// Derived over every source file under `src/`, on IDENTIFIERS read off the AST (so a mention in
// prose is not a reference), with the notice's module resolved from the tree rather than named.
//
// ── AND WHAT IT DOES NOT PIN, STATED RATHER THAN IMPLIED ──────────────────────────────────────
//
// This is SOURCE PRESENCE, not RENDER presence: it cannot tell a component that renders the notice
// from one that imports it and puts it behind a collapsed panel. T7c is the task converting the
// source-presence guards in this repo to render-presence ones, and this is on that list. It is
// written now anyway, because F10's actual finding is that there was NO guard at all — and a
// source-presence guard is the difference between "the notice cannot be forgotten" and "the notice
// was hoped for".
//
// ── THE VACUITY PROBLEM, AND HOW IT IS HANDLED ────────────────────────────────────────────────
//
// No screen renders an allowance row yet — T7b/T7c build it. So the real-tree half of this guard is
// TRUE ON AN EMPTY SET today, which is the shape of a guard that never fires and is never noticed.
// Two things stop that: the checker is proven to fire on synthetic sources both ways, and the
// current set of allowance-rendering modules is asserted EXACTLY, so the day T7c adds the first one
// the count assertion fails and points the author at the pairing rule instead of letting them
// discover it later.
import { describe, expect, it } from 'vitest';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
import { SRC_ROOT, listSourceFiles, parseSource, readSourceCached, stripComments } from './helpers/extractionSurfaces';
import { ADVICE_BOUNDARY_NOTICE_HE } from '../config/adviceBoundary';

/** The identifier a module must reach for to put an allowance row on a screen. */
const ALLOWANCE_LEAD = 'allowanceLeadHe';
/** The identifier that must appear with it. */
const BOUNDARY_NOTICE = 'ADVICE_BOUNDARY_NOTICE_HE';

/**
 * Every identifier the file actually REFERENCES, off the AST.
 *
 * Identifiers rather than a text search, for the reason `monthLiteralGuard` had to learn twice: a
 * name discussed in a comment is trivia to the parser and never becomes an `Identifier` node, so a
 * module explaining why it does not render the allowance is not flagged for saying so. `stripComments`
 * is NOT called here and does not need to be — that is the same correction, stated once more.
 */
function identifiersIn(fileName: string, source: string): Set<string> {
  const sourceFile = parseSource(fileName, source);
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return names;
}

/**
 * Whether the file DEFINES the allowance-lead builder, as opposed to importing or referencing it.
 *
 * A definition, not any declaration: an `import { allowanceLeadHe }` is a declaration too, and
 * excluding on that would exclude every consumer — which is every module this guard exists to look
 * at, and would have made the whole rule vacuous while reporting green.
 */
function declaresBuilder(fileName: string, source: string): boolean {
  const sourceFile = parseSource(fileName, source);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === ALLOWANCE_LEAD) found = true;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === ALLOWANCE_LEAD) found = true;
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Modules that REACH FOR the allowance lead — every referencing module except the one that DECLARES
 * it. Derived, not a filename: the declaring module is the definition of the sentence, not a screen
 * that renders one, and pairing a builder with a notice inside its own definition would be a rule
 * about nothing.
 */
function allowanceRenderers(files: Array<{ fileName: string; source: string }>): string[] {
  return files
    .filter(({ fileName, source }) => identifiersIn(fileName, source).has(ALLOWANCE_LEAD))
    .filter(({ fileName, source }) => !declaresBuilder(fileName, source))
    .map(({ fileName }) => fileName);
}

/** Files that reach for the allowance lead WITHOUT reaching for the boundary notice. */
function unpairedModules(files: Array<{ fileName: string; source: string }>): string[] {
  const byName = new Map(files.map((f) => [f.fileName, f] as const));
  return allowanceRenderers(files).filter((fileName) => {
    const entry = byName.get(fileName);
    return entry !== undefined && !identifiersIn(entry.fileName, entry.source).has(BOUNDARY_NOTICE);
  });
}

/**
 * Every SHIPPED source file under `src/`. `listSourceFiles` skips `__tests__` and `*.test.*`, which
 * is the right scope and not an omission: the rule is about what reaches a family's screen, and a
 * test that exercises the builder is not a screen. It is also what keeps this guard from being
 * permanently red on itself.
 */
function tree(): Array<{ fileName: string; source: string }> {
  return listSourceFiles(SRC_ROOT).map((file) => ({ fileName: file, source: readSourceCached(file) }));
}

describe('!! F10 — the advice-boundary notice has a binding, not just a sentence', () => {
  it('the checker FIRES — a module rendering the lead without the notice is flagged', () => {
    const probe = join(SRC_ROOT, 'components/Probe.tsx');
    const withoutNotice = `
      import { ${ALLOWANCE_LEAD} } from '../utils/forecastCopy';
      export const Row = () => <p>{${ALLOWANCE_LEAD}({ categoryId: 'x', projectedText: 'y', rankWord: 'z', isLargest: true })}</p>;
    `;
    expect(unpairedModules([{ fileName: probe, source: withoutNotice }])).toEqual([probe]);
  });

  it('and it does NOT fire once the notice is there — the pair, not a one-way ban', () => {
    const probe = join(SRC_ROOT, 'components/Probe.tsx');
    const withNotice = `
      import { ${ALLOWANCE_LEAD} } from '../utils/forecastCopy';
      import { ${BOUNDARY_NOTICE} } from '../config/adviceBoundary';
      export const Row = () => (
        <div>
          <p>{${ALLOWANCE_LEAD}({ categoryId: 'x', projectedText: 'y', rankWord: 'z', isLargest: true })}</p>
          <small>{${BOUNDARY_NOTICE}}</small>
        </div>
      );
    `;
    expect(unpairedModules([{ fileName: probe, source: withNotice }])).toEqual([]);
    // …and a module that mentions the lead only in PROSE is not a renderer of it.
    const prose = `// ${ALLOWANCE_LEAD} is deliberately not used here.\nexport const n = 1;`;
    expect(unpairedModules([{ fileName: join(SRC_ROOT, 'utils/probe.ts'), source: prose }])).toEqual([]);
  });

  it('!! holds over the real tree', () => {
    expect(unpairedModules(tree()).map((f) => relative(SRC_ROOT, f))).toEqual([]);
  });

  it('!! and the EXACT current set is pinned — T7b IS the first module to fail the old empty pin', () => {
    // ── WHAT HAPPENED HERE, AND WHY THE PIN WORKED ────────────────────────────────────────────
    //
    // Until Stage 7 T7b this list was EXACTLY EMPTY, and its own comment said so: no screen
    // rendered an allowance row, so the pairing rule above was true on an empty set — the shape of
    // a guard nobody notices is dead. The pin existed precisely so the first module to render one
    // would turn this line red and be handed the rule rather than discovering it in review.
    //
    // It did exactly that. `ForecastScreen.tsx` renders D29's lead rows, this assertion failed on
    // the first run of the new screen, and the notice is now rendered UNCONDITIONALLY inside that
    // section — not beside one branch of it — because the pairing is about the surface.
    //
    // The pin stays a pin. It is still an EXACT set, so the SECOND screen to render an allowance
    // row (Stage 8's insights screen is the obvious candidate) gets the same red line and the same
    // hand-off.
    const renderers = allowanceRenderers(tree()).map((f) => relative(SRC_ROOT, f)).sort();
    expect(renderers).toEqual(['components/ForecastScreen.tsx']);
    // …and the module that DECLARES the builder is excluded by declaration, not by name.
    expect(
      tree()
        .filter(({ fileName, source }) => declaresBuilder(fileName, source))
        .map(({ fileName }) => relative(SRC_ROOT, fileName))
    ).toEqual(['utils/forecastCopy.ts']);
  });

  it('the notice lives in ONE module, and it is not a feature module', () => {
    // §9's boundary is product-wide: Stage 8's insights screen needs the same sentence, and a
    // second copy of it is the duplicate-map class — two copies agree until one is edited, and then
    // the app makes two different licensing statements. Derived, so a second copy anywhere under
    // `src/` fails here rather than being noticed in review.
    const holders = listSourceFiles(SRC_ROOT)
      .filter((file) => stripComments(readSourceCached(file), file).includes(ADVICE_BOUNDARY_NOTICE_HE))
      .map((file) => relative(SRC_ROOT, file))
      .sort();
    expect(holders).toEqual(['config/adviceBoundary.ts']);
  });

  it('it is still §9`s own sentence, both halves', () => {
    expect(ADVICE_BOUNDARY_NOTICE_HE).toContain('לבדיקה');
    expect(ADVICE_BOUNDARY_NOTICE_HE).toContain('לא הוראת פעולה');
    expect(ADVICE_BOUNDARY_NOTICE_HE).toContain('אינה יועץ');
  });
});
