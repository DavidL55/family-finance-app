// Stage 7 T5 — THE DOOR, HELD STRUCTURALLY.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE SENTENCE THIS FILE EXISTS TO MAKE UNTRUE
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// T3's ledger, addressed to T5: *"history must be taken through `loadStatisticalHistory`, not
// `listTransactionHistory` — the refusal lives in the former, and NOTHING STRUCTURALLY FORCES THAT
// CHOICE YET."*
//
// The type brand in `statisticalHistory.ts` closes the accident and the runtime brand check closes
// the cast. Neither closes the third shape, which is the one that actually ships: a NEW module that
// reads history the short way and does its own arithmetic on the rows, never touching the branded
// type at all. That is not a type error and it is not a runtime error — it is a design decision
// made by whoever was in a hurry, and only a guard over the import graph can see it.
//
// ── WHAT EACH CHECK CAN ACTUALLY FAIL ON ──────────────────────────────────────────────────────
//
//   1. `sealStatisticalHistory` gaining a SECOND call site, or its one call site moving out of
//      `loadStatisticalHistory` — e.g. up into a caller, on the far side of the marker check.
//   2. Any module outside the allow-list ASSERTING to `GatedStatisticalHistory`, which is the one
//      hole the compiler leaves open (the shapes overlap, so `as` is legal).
//   3. Any module importing BOTH `listTransactionHistory` and a statistical-layer export — the
//      wrong door and the room it opens onto, in one file.
//   4. `buildStatisticalLayer` being widened to take an array of rows again.
//   5. A `limit()` appearing on the history read path (D33), which would truncate a window and
//      render the truncated average identically to the whole one.
//
// Every checker is a pure function over (fileName, source) and is proven against SYNTHETIC sources
// first, because on today's tree the real files pass — so an unproven checker is a checker that
// says nothing.
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { SRC_ROOT, listSourceFiles, parseSource, readSourceCached, stripComments } from './helpers/extractionSurfaces';

const SEAL = 'sealStatisticalHistory';
const BRANDED_TYPE = 'GatedStatisticalHistory';
const SHORT_DOOR = 'listTransactionHistory';
const LONG_DOOR = 'loadStatisticalHistory';

/** The statistical-layer exports whose presence beside `listTransactionHistory` is the defect. */
const STATISTICAL_LAYER_EXPORTS = [
  'buildStatisticalLayer',
  'statisticalEstimateOf',
  'observedBandOf',
  'countsTowardMovingAverage',
];

/** Where the seal is allowed to be called, and where the branded type may be asserted to. */
const DOOR_MODULE = 'services/TransactionHistoryService.ts';
const BRAND_MODULE = 'utils/statisticalHistory.ts';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the checkers — pure over (fileName, source)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The name of the function each call to `fn` sits inside, one entry per call. `''` at top level. */
export function enclosingFunctionsOfCalls(fileName: string, source: string, fn: string): string[] {
  const sourceFile = parseSource(fileName, stripComments(source, fileName));
  const found: string[] = [];
  const visit = (node: ts.Node, enclosing: string): void => {
    let nextEnclosing = enclosing;
    if (ts.isFunctionDeclaration(node) && node.name) nextEnclosing = node.name.text;
    else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
      ts.isIdentifier(node.name)
    ) {
      nextEnclosing = node.name.text;
    } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) nextEnclosing = node.name.text;

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === fn) {
      found.push(enclosing);
    }
    node.forEachChild((child) => visit(child, nextEnclosing));
  };
  visit(sourceFile, '');
  return found;
}

/** Every `as T` / `<T>x` / `satisfies T` naming `typeName` in one file. */
export function assertionsToType(fileName: string, source: string, typeName: string): string[] {
  const sourceFile = parseSource(fileName, stripComments(source, fileName));
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const named = (typeNode: ts.TypeNode | undefined): boolean => {
      if (!typeNode) return false;
      let hit = false;
      const walk = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && n.text === typeName) hit = true;
        n.forEachChild(walk);
      };
      walk(typeNode);
      return hit;
    };
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && named(node.type)) {
      found.push(node.getText());
    } else if (ts.isSatisfiesExpression(node) && named(node.type)) {
      found.push(node.getText());
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return found;
}

/** Every imported binding name in one file, across value, type-only and namespace imports. */
export function importedNames(fileName: string, source: string): string[] {
  const sourceFile = parseSource(fileName, stripComments(source, fileName));
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
      if (clause.name) names.push(clause.name.text);
      if (clause.namedBindings) {
        if (ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            names.push((element.propertyName ?? element.name).text);
          }
        } else names.push(clause.namedBindings.name.text);
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return names;
}

/** The identifiers appearing in the declared type of one parameter of one function. */
export function parameterTypeIdentifiers(
  fileName: string,
  source: string,
  fn: string,
  parameterIndex: number
): string[] {
  const sourceFile = parseSource(fileName, stripComments(source, fileName));
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.name.text === fn) {
      const parameter = node.parameters[parameterIndex];
      if (parameter && parameter.type) {
        const walk = (n: ts.Node): void => {
          if (ts.isIdentifier(n)) names.push(n.text);
          n.forEachChild(walk);
        };
        walk(parameter.type);
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return names;
}

/** Whether the file calls or imports Firestore's `limit`. D33 forbids it on this path. */
export function firestoreLimitUses(fileName: string, source: string): string[] {
  const stripped = stripComments(source, fileName);
  const uses: string[] = [];
  if (importedNames(fileName, source).includes('limit')) uses.push('import limit');
  const sourceFile = parseSource(fileName, stripped);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === 'limit') uses.push(node.getText());
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'limit') uses.push(node.getText());
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return uses;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the tree
// ─────────────────────────────────────────────────────────────────────────────────────────────

const SOURCE_FILES = listSourceFiles(SRC_ROOT);
const relOf = (file: string): string => relative(SRC_ROOT, file).split('\\').join('/');

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 1 — the seal has exactly one call site, and it is inside the marker check
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe(`!! ${SEAL} has exactly ONE call site in the tree`, () => {
  const callSites = SOURCE_FILES.flatMap((file) =>
    enclosingFunctionsOfCalls(file, readSourceCached(file), SEAL).map((enclosing) => ({
      file: relOf(file),
      enclosing,
    }))
  );

  it('is called from exactly one non-test module', () => {
    expect(callSites.map((c) => c.file)).toEqual([DOOR_MODULE]);
  });

  it(`!! and that call is INSIDE \`${LONG_DOOR}\`, not in a caller above the marker check`, () => {
    // Moving the seal one function up would put it on the far side of the gate — history minted
    // before anything decided whether the backfill had finished, which is the whole hole.
    expect(callSites[0].enclosing).toBe(LONG_DOOR);
  });

  it('THE CHECKER FIRES — proven on synthetic sources, since the real tree passes', () => {
    const twoSites = `
      function loadStatisticalHistory() { return sealStatisticalHistory(m, rows); }
      function somewhereElse() { return sealStatisticalHistory(null, rows); }
    `;
    expect(enclosingFunctionsOfCalls('probe.ts', twoSites, SEAL)).toEqual([
      'loadStatisticalHistory',
      'somewhereElse',
    ]);

    const movedUp = `
      const loadHistoryForScreen = async () => sealStatisticalHistory(m, await listTransactionHistory());
    `;
    expect(enclosingFunctionsOfCalls('probe.ts', movedUp, SEAL)).toEqual(['loadHistoryForScreen']);

    // and it does NOT count a mention inside a comment or a string
    const mentions = `
      // sealStatisticalHistory(m, rows)
      const doc = 'call sealStatisticalHistory(m, rows)';
    `;
    expect(enclosingFunctionsOfCalls('probe.ts', mentions, SEAL)).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 2 — nobody asserts to the branded type
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe(`!! nothing outside ${BRAND_MODULE} asserts to \`${BRANDED_TYPE}\``, () => {
  it('finds no assertion anywhere in `src/`', () => {
    const offenders = SOURCE_FILES.filter(
      (file) => assertionsToType(file, readSourceCached(file), BRANDED_TYPE).length > 0
    ).map(relOf);
    expect(offenders).toEqual([]);
  });

  it('THE CHECKER FIRES — `as`, `<T>` and `satisfies` are all caught', () => {
    expect(
      assertionsToType('probe.ts', 'const h = { status: "ready" } as GatedStatisticalHistory;', BRANDED_TYPE)
    ).toHaveLength(1);
    expect(
      assertionsToType('probe.ts', 'const h = raw as unknown as GatedStatisticalHistory;', BRANDED_TYPE)
    ).toHaveLength(1);
    expect(
      assertionsToType('probe.ts', 'const h = { s: 1 } satisfies GatedStatisticalHistory;', BRANDED_TYPE)
    ).toHaveLength(1);
    // an ordinary type ANNOTATION is not an assertion and must not be flagged — over-approximating
    // here would ban the consumer from naming the type it consumes
    expect(
      assertionsToType('probe.ts', 'function f(h: GatedStatisticalHistory) { return h; }', BRANDED_TYPE)
    ).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 3 — the wrong door and the room it opens onto, never in one file
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! no module imports BOTH the short door and a statistical-layer export', () => {
  it('holds across `src/`', () => {
    const offenders = SOURCE_FILES.filter((file) => {
      const names = importedNames(file, readSourceCached(file));
      if (!names.includes(SHORT_DOOR)) return false;
      return STATISTICAL_LAYER_EXPORTS.some((exported) => names.includes(exported));
    }).map(relOf);
    expect(offenders).toEqual([]);
  });

  it('the short door is imported by a SMALL, named set, and the list is not empty', () => {
    // Non-vacuity: if this ever returns `[]` the check above is passing because nothing imports the
    // short door at all, which would make it meaningless rather than satisfied.
    const importers = SOURCE_FILES.filter((file) =>
      importedNames(file, readSourceCached(file)).includes(SHORT_DOOR)
    ).map(relOf);
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.sort()).toEqual(['components/Dashboard.tsx']);
  });

  it('THE CHECKER FIRES — a synthetic module holding both is flagged', () => {
    const both = `
      import { listTransactionHistory } from '../services/TransactionHistoryService';
      import { buildStatisticalLayer } from '../utils/forecast';
    `;
    const names = importedNames('probe.ts', both);
    expect(names).toContain(SHORT_DOOR);
    expect(STATISTICAL_LAYER_EXPORTS.some((e) => names.includes(e))).toBe(true);
  });

  it('THE CHECKER SEES type-only and renamed imports too', () => {
    const sneaky = `
      import { listTransactionHistory as readRows } from '../services/TransactionHistoryService';
      import type { buildStatisticalLayer } from '../utils/forecast';
    `;
    expect(importedNames('probe.ts', sneaky)).toContain(SHORT_DOOR);
    expect(importedNames('probe.ts', sneaky)).toContain('buildStatisticalLayer');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 4 — the signature itself
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! buildStatisticalLayer takes the HANDLE, never an array of rows', () => {
  const forecastSource = readSourceCached(join(SRC_ROOT, 'utils/forecast.ts'));

  it('its input type names `StatisticalLayerInput`, whose `history` is the handle', () => {
    expect(parameterTypeIdentifiers(join(SRC_ROOT, 'utils/forecast.ts'), forecastSource, 'buildStatisticalLayer', 0)).toEqual([
      'StatisticalLayerInput',
    ]);
    // and the field really is the union, not the row array
    expect(stripComments(forecastSource, 'forecast.ts')).toMatch(/history:\s*StatisticalHistoryHandle/);
  });

  it('THE CHECKER FIRES — a widened signature is visible', () => {
    const widened = 'export function buildStatisticalLayer(rows: StatisticalHistoryRow[]): void {}';
    expect(parameterTypeIdentifiers('probe.ts', widened, 'buildStatisticalLayer', 0)).toEqual([
      'StatisticalHistoryRow',
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 5 — D33's `no limit()`
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D33 — no `limit()` anywhere on the history read path', () => {
  const HISTORY_PATH = ['services/TransactionHistoryService.ts', 'utils/forecast.ts', 'utils/statisticalHistory.ts'];

  it.each(HISTORY_PATH)('%s neither imports nor calls `limit`', (rel) => {
    const file = join(SRC_ROOT, rel);
    expect(firestoreLimitUses(file, readSourceCached(file))).toEqual([]);
  });

  it('THE CHECKER FIRES — both the import and the call are caught', () => {
    const withLimit = `
      import { collection, limit, query } from 'firebase/firestore';
      const q = query(collection(db, 'transaction_lines'), limit(2000));
    `;
    expect(firestoreLimitUses('probe.ts', withLimit)).toContain('import limit');
    expect(firestoreLimitUses('probe.ts', withLimit).some((u) => u.includes('limit(2000)'))).toBe(true);
  });

  it('THE CHECKER FIRES on the builder form too — `.limit(n)` on a query object', () => {
    expect(firestoreLimitUses('probe.ts', 'const q = ref.limit(2000);').length).toBeGreaterThan(0);
  });

  it('and it does NOT fire on the word appearing in a comment or an identifier', () => {
    expect(firestoreLimitUses('probe.ts', '// no limit() here\nconst limitless = 1;')).toEqual([]);
  });
});
