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
import { dirname, join, relative, resolve } from 'node:path';
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

/** The modules the guard names, extensionless and relative to `src/` — see `resolveSpecifier`. */
const HISTORY_SERVICE = 'services/TransactionHistoryService';
const FORECAST = 'utils/forecast';
const STATISTICAL_HISTORY = 'utils/statisticalHistory';

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

/** Every `as T` / `<T>x` / `satisfies T` naming ANY of `typeNames` in one file. */
export function assertionsToType(
  fileName: string,
  source: string,
  typeNames: readonly string[]
): string[] {
  const wanted = new Set(typeNames);
  const sourceFile = parseSource(fileName, stripComments(source, fileName));
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const named = (typeNode: ts.TypeNode | undefined): boolean => {
      if (!typeNode) return false;
      let hit = false;
      const walk = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && wanted.has(n.text)) hit = true;
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T5-REVIEW F2 — THE IMPORT GRAPH, KEYED ON THE MODULE AND THE MEMBER RATHER THAN ON A BINDING
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `importedNames` records BINDING names. `import * as historyService from
// '../services/TransactionHistoryService'` records `historyService` — not `listTransactionHistory`
// — so the short door became invisible to the check below AND TO ITS OWN NON-VACUITY ASSERTION,
// which is the part that makes it dangerous rather than merely incomplete: the guard would have
// gone quiet and its canary would have gone quiet with it.
//
// The fix is to stop asking what a binding is CALLED and start asking what module it came from. A
// namespace import brings in EVERY member of the module it names, so it counts as importing all of
// them; a dynamic `import('…')` is treated the same way, because its members arrive at runtime by a
// route no static list can enumerate. Both over-approximate, and both over-approximate CLOSED.

/**
 * Where a specifier POINTS, relative to `src/`, without its extension. `null` when it is a bare
 * package or leaves `src/` — neither of which can be the modules this guard names.
 */
export function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else if (specifier.startsWith('@/')) base = resolve(SRC_ROOT, specifier.slice(2));
  else return null;
  const fromSrc = relative(SRC_ROOT, base).split('\\').join('/');
  if (fromSrc.startsWith('..')) return null;
  return fromSrc.replace(/\.(tsx?|jsx?)$/, '').replace(/\/index$/, '');
}

export interface ResolvedModuleImport {
  /** Extensionless, `src/`-relative. `null` for a bare package or a path that leaves `src/`. */
  resolved: string | null;
  /** Members named in the clause, by their EXPORTED name — `{ a as b }` records `a`. */
  members: string[];
  /** `import * as ns`, `import ns from`, or a dynamic import: every member arrives. */
  wholeModule: boolean;
  /** Local names bound to each exported member, including the alias in `{ a as b }`. */
  localsOf: Map<string, string[]>;
  /** Local names bound to the whole namespace, for `ns.Member` qualified references. */
  namespaceLocals: string[];
}

/** Every module one file pulls from, with the members it pulled and how. */
export function resolvedImportsOf(fileName: string, source: string): ResolvedModuleImport[] {
  const sourceFile = parseSource(fileName, stripComments(source, fileName));
  const found: ResolvedModuleImport[] = [];
  const record = (specifier: string): ResolvedModuleImport => {
    const entry: ResolvedModuleImport = {
      resolved: resolveSpecifier(fileName, specifier),
      members: [],
      wholeModule: false,
      localsOf: new Map(),
      namespaceLocals: [],
    };
    found.push(entry);
    return entry;
  };
  const addMember = (entry: ResolvedModuleImport, exported: string, local: string): void => {
    entry.members.push(exported);
    entry.localsOf.set(exported, [...(entry.localsOf.get(exported) ?? []), local]);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const entry = record(node.moduleSpecifier.text);
      const clause = node.importClause;
      if (clause) {
        // a DEFAULT import binds one member, but this codebase has no default exports on these
        // modules — treated as a whole-module arrival so it can never fail open
        if (clause.name) {
          entry.wholeModule = true;
          entry.namespaceLocals.push(clause.name.text);
        }
        if (clause.namedBindings) {
          if (ts.isNamedImports(clause.namedBindings)) {
            for (const element of clause.namedBindings.elements) {
              addMember(entry, (element.propertyName ?? element.name).text, element.name.text);
            }
          } else {
            entry.wholeModule = true;
            entry.namespaceLocals.push(clause.namedBindings.name.text);
          }
        }
      } else {
        // `import '…'` for side effects only — no members, and nothing to hide behind
        entry.wholeModule = false;
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const entry = record(node.moduleSpecifier.text);
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          addMember(entry, (element.propertyName ?? element.name).text, element.name.text);
        }
      } else {
        entry.wholeModule = true; // `export * from '…'`
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      record(node.arguments[0].text).wholeModule = true;
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return found;
}

/** Whether `fileName` can reach `member` of `moduleRel`, by any import shape. */
export function importsMemberFrom(
  fileName: string,
  source: string,
  moduleRel: string,
  member: string
): boolean {
  return resolvedImportsOf(fileName, source).some(
    (entry) => entry.resolved === moduleRel && (entry.wholeModule || entry.members.includes(member))
  );
}

/**
 * Every LOCAL name in one file that denotes `member` of `moduleRel`.
 *
 * F2's cheaper half: the assertion ban matched the identifier TEXT `GatedStatisticalHistory`, so
 * `import type { GatedStatisticalHistory as Gated }` — or a plain `type Gated =
 * GatedStatisticalHistory` — walked past it. Aliases are followed to a fixpoint, so a chain of them
 * is no better a hiding place than one.
 *
 * The member's own name is always included: `ns.GatedStatisticalHistory` reaches the guard as an
 * identifier inside a qualified name, and a file that declares the type refers to it directly.
 */
export function localTypeNamesFor(
  fileName: string,
  source: string,
  moduleRel: string,
  member: string
): string[] {
  const names = new Set<string>([member]);
  for (const entry of resolvedImportsOf(fileName, source)) {
    if (entry.resolved !== moduleRel) continue;
    for (const local of entry.localsOf.get(member) ?? []) names.add(local);
  }

  const sourceFile = parseSource(fileName, stripComments(source, fileName));
  const aliases: Array<{ name: string; refers: string[] }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node)) {
      const refers: string[] = [];
      const walk = (n: ts.Node): void => {
        if (ts.isIdentifier(n)) refers.push(n.text);
        n.forEachChild(walk);
      };
      walk(node.type);
      aliases.push({ name: node.name.text, refers });
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);

  // fixpoint: `type A = Gated; type B = A;` has to reach B
  let grew = true;
  while (grew) {
    grew = false;
    for (const alias of aliases) {
      if (names.has(alias.name)) continue;
      if (alias.refers.some((r) => names.has(r))) {
        names.add(alias.name);
        grew = true;
      }
    }
  }
  return [...names].sort();
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
/** A synthetic file that RESOLVES like a real one — the checkers below key on where a specifier points. */
const PROBE = join(SRC_ROOT, 'utils/probe.ts');
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
  /** The local names that denote the branded type IN THAT FILE — see `localTypeNamesFor`. */
  const namesIn = (file: string): string[] =>
    localTypeNamesFor(file, readSourceCached(file), STATISTICAL_HISTORY, BRANDED_TYPE);

  it('finds no assertion anywhere in `src/`, under any name the type goes by locally', () => {
    const offenders = SOURCE_FILES.filter(
      (file) => assertionsToType(file, readSourceCached(file), namesIn(file)).length > 0
    ).map(relOf);
    expect(offenders).toEqual([]);
  });

  it('THE CHECKER FIRES — `as`, `<T>` and `satisfies` are all caught', () => {
    expect(
      assertionsToType('probe.ts', 'const h = { status: "ready" } as GatedStatisticalHistory;', [BRANDED_TYPE])
    ).toHaveLength(1);
    expect(
      assertionsToType('probe.ts', 'const h = raw as unknown as GatedStatisticalHistory;', [BRANDED_TYPE])
    ).toHaveLength(1);
    expect(
      assertionsToType('probe.ts', 'const h = { s: 1 } satisfies GatedStatisticalHistory;', [BRANDED_TYPE])
    ).toHaveLength(1);
    // an ordinary type ANNOTATION is not an assertion and must not be flagged — over-approximating
    // here would ban the consumer from naming the type it consumes
    expect(
      assertionsToType('probe.ts', 'function f(h: GatedStatisticalHistory) { return h; }', [BRANDED_TYPE])
    ).toEqual([]);
  });

  it('!! F2 — A RENAMED TYPE IMPORT NO LONGER EVADES IT', () => {
    // The identifier-text match saw `GatedStatisticalHistory` and nothing else, so this file — a
    // legal, ordinary-looking module — asserted straight to the branded type in silence.
    const renamed = `
      import type { GatedStatisticalHistory as Gated } from '../utils/statisticalHistory';
      const h = raw as unknown as Gated;
    `;
    const names = localTypeNamesFor(PROBE, renamed, STATISTICAL_HISTORY, BRANDED_TYPE);
    expect(names).toContain('Gated');
    expect(assertionsToType(PROBE, renamed, names)).toHaveLength(1);
    // and the OLD form of the check, keyed on the identifier text alone, saw nothing at all
    expect(assertionsToType(PROBE, renamed, [BRANDED_TYPE])).toEqual([]);
  });

  it('!! F2 — a LOCAL TYPE ALIAS does not evade it either, however long the chain', () => {
    const aliased = `
      import type { GatedStatisticalHistory } from '../utils/statisticalHistory';
      type Handle = GatedStatisticalHistory;
      type Inner = Handle;
      const h = raw as Inner;
    `;
    const names = localTypeNamesFor(PROBE, aliased, STATISTICAL_HISTORY, BRANDED_TYPE);
    expect(names).toEqual(['GatedStatisticalHistory', 'Handle', 'Inner']);
    expect(assertionsToType(PROBE, aliased, names)).toHaveLength(1);
  });

  it('!! F2 — a NAMESPACE import reaches the type, and the alias set knows it', () => {
    const viaNamespace = `
      import * as door from '../utils/statisticalHistory';
      const h = raw as door.GatedStatisticalHistory;
    `;
    const names = localTypeNamesFor(PROBE, viaNamespace, STATISTICAL_HISTORY, BRANDED_TYPE);
    expect(assertionsToType(PROBE, viaNamespace, names)).toHaveLength(1);
  });

  it('and an alias of an UNRELATED type is not swept up — the ban stays narrow', () => {
    // Over-approximating here would ban assertions to types that have nothing to do with the door,
    // and a guard that cries wolf gets an allow-list bolted onto it within a month.
    const unrelated = `
      import type { StatisticalHistoryRow } from '../utils/statisticalHistory';
      type Row = StatisticalHistoryRow;
      const r = raw as Row;
    `;
    const names = localTypeNamesFor(PROBE, unrelated, STATISTICAL_HISTORY, BRANDED_TYPE);
    expect(names).toEqual([BRANDED_TYPE]);
    expect(assertionsToType(PROBE, unrelated, names)).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 3 — the wrong door and the room it opens onto, never in one file
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! no module imports BOTH the short door and a statistical-layer export', () => {
  /** Keyed on the RESOLVED MODULE plus the member — never on what a binding happens to be called. */
  const reachesShortDoor = (file: string): boolean =>
    importsMemberFrom(file, readSourceCached(file), HISTORY_SERVICE, SHORT_DOOR);
  const reachesLayer = (file: string): boolean =>
    STATISTICAL_LAYER_EXPORTS.some((exported) =>
      importsMemberFrom(file, readSourceCached(file), FORECAST, exported)
    );

  it('holds across `src/`', () => {
    const offenders = SOURCE_FILES.filter((file) => reachesShortDoor(file) && reachesLayer(file)).map(relOf);
    expect(offenders).toEqual([]);
  });

  it('the short door is imported by a SMALL, named set, and the list is not empty', () => {
    // Non-vacuity: if this ever returns `[]` the check above is passing because nothing imports the
    // short door at all, which would make it meaningless rather than satisfied.
    //
    // !! THIS IS THE ASSERTION F2 DEFEATED ALONG WITH THE GUARD. Keyed on binding names, a
    // namespace import of the service module took the importer OUT of this list as well — so the
    // canary went quiet at exactly the moment the guard did, and nothing was left to notice.
    const importers = SOURCE_FILES.filter(reachesShortDoor).map(relOf);
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.sort()).toEqual(['components/Dashboard.tsx']);
  });

  it('!! T7a — the OTHER half of the conjunction is NO LONGER EMPTY, and the guard is live at last', () => {
    // THE PIN THIS REPLACES SAID THE OPPOSITE, and it was right when it was written. T5's review
    // found the conjunction `A && B` satisfied by an EMPTY `B` — nothing in `src/` imported a
    // statistical-layer export at all, so the guard could not fire whatever anyone wrote on the
    // `listTransactionHistory` side. Doubly shadowed, not singly. The absence was pinned as a fact
    // about that day precisely so that this line would have to be edited on the day it stopped
    // being true, and it did.
    //
    // Both halves are now non-empty over the real tree: `components/Dashboard.tsx` reaches the
    // short door, `hooks/useForecast.ts` reaches the layer, and they are DIFFERENT FILES — which is
    // the property, actually held, for the first time.
    const importers = SOURCE_FILES.filter(reachesLayer).map(relOf);
    expect(importers.sort()).toEqual(['hooks/useForecast.ts']);
  });

  it('!! and the live conjunction FIRES on a real file — checked against a deliberate violation', () => {
    // T5's review left this instruction to T7a in as many words: the three-way conjunction "has
    // never once had the chance to fail on a real file", so check it against a deliberate violation
    // when it goes live. This is that check, run over the SHIPPED source of the module that now
    // reaches the layer, with one import added — not over a hand-written probe, because a probe
    // proves the checker and this proves the SCOPE the checker is pointed at.
    const useForecast = join(SRC_ROOT, 'hooks/useForecast.ts');
    const violating =
      "import { listTransactionHistory } from '../services/TransactionHistoryService';\n" +
      readSourceCached(useForecast);
    expect(importsMemberFrom(useForecast, violating, HISTORY_SERVICE, SHORT_DOOR)).toBe(true);
    expect(
      STATISTICAL_LAYER_EXPORTS.some((exported) =>
        importsMemberFrom(useForecast, violating, FORECAST, exported)
      )
    ).toBe(true);
    // …and the file AS SHIPPED reaches only one of the two, so the assertion above is about the
    // added line rather than about the file.
    expect(reachesShortDoor(useForecast)).toBe(false);
    expect(reachesLayer(useForecast)).toBe(true);
  });

  it('THE CHECKER FIRES — a synthetic module holding both is flagged', () => {
    const both = `
      import { listTransactionHistory } from '../services/TransactionHistoryService';
      import { buildStatisticalLayer } from '../utils/forecast';
    `;
    expect(importsMemberFrom(PROBE, both, HISTORY_SERVICE, SHORT_DOOR)).toBe(true);
    expect(importsMemberFrom(PROBE, both, FORECAST, 'buildStatisticalLayer')).toBe(true);
  });

  it('THE CHECKER SEES type-only and renamed imports too', () => {
    const sneaky = `
      import { listTransactionHistory as readRows } from '../services/TransactionHistoryService';
      import type { buildStatisticalLayer } from '../utils/forecast';
    `;
    expect(importsMemberFrom(PROBE, sneaky, HISTORY_SERVICE, SHORT_DOOR)).toBe(true);
    expect(importsMemberFrom(PROBE, sneaky, FORECAST, 'buildStatisticalLayer')).toBe(true);
  });

  it('!! F2 — A NAMESPACE IMPORT NO LONGER WALKS PAST IT', () => {
    // The finding, executable. `importedNames` recorded `historyService`, so neither the guard nor
    // its non-vacuity assertion could see `listTransactionHistory` — and the call sitting beside
    // `buildStatisticalLayer` was invisible to both.
    const namespaced = `
      import * as historyService from '../services/TransactionHistoryService';
      import { buildStatisticalLayer } from '../utils/forecast';
      export async function screen() {
        const rows = await historyService.listTransactionHistory('family', 'x', []);
        return buildStatisticalLayer({ history: rows, windowPeriods: [], horizon: [] });
      }
    `;
    // the OLD key — the binding name — saw nothing
    expect(importedNames(PROBE, namespaced)).not.toContain(SHORT_DOOR);
    // the NEW key — module plus member — sees it
    expect(importsMemberFrom(PROBE, namespaced, HISTORY_SERVICE, SHORT_DOOR)).toBe(true);
    expect(importsMemberFrom(PROBE, namespaced, FORECAST, 'buildStatisticalLayer')).toBe(true);
  });

  it('!! F2 — a DYNAMIC import is treated as bringing the whole module, and fails CLOSED', () => {
    const dynamic = `
      const { listTransactionHistory } = await import('../services/TransactionHistoryService');
    `;
    expect(importsMemberFrom(PROBE, dynamic, HISTORY_SERVICE, SHORT_DOOR)).toBe(true);
  });

  it('!! and it is keyed on the MODULE, so a same-named export elsewhere is NOT flagged', () => {
    // The other direction of correctness. A `listTransactionHistory` on some unrelated module is
    // not the short door, and a guard that flagged it would be a name ban rather than a graph
    // check — the first false positive would get the whole thing an allow-list.
    const impostor = `
      import { listTransactionHistory } from '../utils/periodMath';
      import { buildStatisticalLayer } from '../utils/forecast';
    `;
    expect(importsMemberFrom(PROBE, impostor, HISTORY_SERVICE, SHORT_DOOR)).toBe(false);
  });

  it('the resolver survives the spellings this repo actually uses', () => {
    const componentProbe = join(SRC_ROOT, 'components/probe.tsx');
    expect(resolveSpecifier(PROBE, '../services/TransactionHistoryService')).toBe(HISTORY_SERVICE);
    expect(resolveSpecifier(PROBE, '@/services/TransactionHistoryService')).toBe(HISTORY_SERVICE);
    expect(resolveSpecifier(PROBE, '../services/TransactionHistoryService.ts')).toBe(HISTORY_SERVICE);
    // a bare package and a path out of `src/` are neither of the modules this guard names
    expect(resolveSpecifier(PROBE, 'firebase/firestore')).toBeNull();
    expect(resolveSpecifier(PROBE, '../../functions/src/shared/permissions')).toBeNull();
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
  // T7a ADDED THE FOURTH ENTRY. The hook is now on the read path — it is the module that calls the
  // long door and hands the handle to the layer — so a `limit()` there truncates the same window
  // this ban exists to keep whole. It also reads `incomes` and `goals` unbounded, deliberately, for
  // the same reason: "is this collection empty" is D17's question, and a truncated read answers it
  // wrongly in exactly the direction that lets a false balance render.
  const HISTORY_PATH = [
    'services/TransactionHistoryService.ts',
    'utils/forecast.ts',
    'utils/statisticalHistory.ts',
    'hooks/useForecast.ts',
  ];

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

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T5-REVIEW F3 — THE DOOR HAS NEVER BEEN WALKED, RECORDED AS AN EXECUTABLE INHERITANCE
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// `loadStatisticalHistory` has ZERO non-test call sites. The only production history read in the
// app is `Dashboard.tsx` → `listTransactionHistory`. So every mechanism above holds in the ONLY
// DIRECTION IT CAN CURRENTLY BE TESTED, and every attack surface F1 and F2 found will be met for
// the first time when T7a wires `useForecast`.
//
// ── THE DECISION, AND WHY ─────────────────────────────────────────────────────────────────────
//
// The two options offered were: assert the long door HAS a consumer (red until T7a lands), or
// record it as a named inheritance. THIS FILE TAKES THE SECOND, IN THE FORM OF AN ASSERTION RATHER
// THAN A COMMENT, and the reasoning is:
//
//   · A test that is red on `familyfinance-v2` until an unwritten task lands is a test that
//     teaches the next person to read red as normal. The value of a failing test is that it is
//     unusual; a permanently failing one spends that and buys a reminder, which is what a ledger
//     entry is for and cheaper there.
//
//   · But a ledger entry is EXACTLY WHAT ALREADY FAILED HERE. T3's ledger said, in as many words,
//     *"history must be taken through `loadStatisticalHistory` … NOTHING STRUCTURALLY FORCES THAT
//     CHOICE YET"*, and that sentence survived two whole tasks as a convention nobody was obliged
//     to keep. Writing "T7a must wire the long door" in prose is the same bet, placed again.
//
//   · So the absence is pinned as a FACT ABOUT TODAY, asserted EXACTLY. It is green now — the tree
//     really does look like this — and it turns RED the moment the tree stops looking like this,
//     which is the only moment anybody can act on it. It cannot go stale in either direction:
//     wiring the layer WITHOUT the long door raises the layer-importer count while the call-site
//     count stays at zero, and the failure names that case specifically.
//
// ── WHAT T7a MUST DO WHEN IT LANDS ────────────────────────────────────────────────────────────
//
//   1. `useForecast` calls `loadStatisticalHistory` and passes the handle to `buildStatisticalLayer`.
//   2. THE THREE ASSERTIONS BELOW FLIP: the call sites become `['hooks/useForecast.ts']`, the layer
//      importers become non-empty, and the empty-conjunction pin above is deleted.
//   3. The three-way conjunction in `no module imports BOTH the short door and a statistical-layer
//      export` becomes live for the first time — CHECK IT AGAINST A DELIBERATE VIOLATION THEN,
//      because it has never once had the chance to fail on a real file.

describe('!! T7a — THE LONG DOOR HAS BEEN WALKED, and this is where that is recorded', () => {
  const nonTestCallSites = SOURCE_FILES.flatMap((file) =>
    enclosingFunctionsOfCalls(file, readSourceCached(file), LONG_DOOR).map(() => relOf(file))
  );

  it('!! `loadStatisticalHistory` is CALLED, from exactly one non-test module — `useForecast`', () => {
    // T5's review pinned this as `[]` and said, in the block above, that T7a is what changes it.
    // T7a changed it. The pin was written as an ASSERTION rather than a ledger sentence for exactly
    // this reason: T3's prose version of the same instruction ("nothing structurally forces that
    // choice yet") survived two whole tasks as a convention nobody was obliged to keep.
    //
    // ONE call site, and it is the hook. A second entry here is not automatically wrong, but it is
    // a second place the marker refusal has to be honoured, and it should be argued for rather than
    // arrived at.
    expect(nonTestCallSites).toEqual(['hooks/useForecast.ts']);
  });

  it('!! T7a-REVIEW F2 — THE SET OF `src/` FILES THAT *IMPORT* THE LONG DOOR, PINNED', () => {
    // ── THE FIFTH TRAP, AND THE ONE THE CALL-SITE PIN ABOVE CANNOT SEE ─────────────────────────
    //
    // `enclosingFunctionsOfCalls` requires `ts.isIdentifier(node.expression)`: it finds CALLS. T7a
    // recorded that blind spot and closed it for THIS file, by making the default reader call the
    // door rather than alias it — and that fix does nothing for a file that does not exist yet.
    //
    // The review demonstrated it. It added `src/hooks/useForecastPanel.ts` containing exactly
    //
    //     export const PANEL_READERS = { history: loadStatisticalHistory };
    //
    // and got THE DOOR SUITE 32/32 AND THE FULL ROOT SUITE 2422/2422 GREEN. A second production
    // module wiring the long door by property reference moved no assertion anywhere in the tree.
    //
    // The asymmetry is what makes it a defect rather than a gap: the SHORT door has had an importer
    // pin since T5 (`the short door is imported by a SMALL, named set`), and the long door — the
    // one carrying D21(d)'s completion-marker refusal, the one R6 is about — had none. This is that
    // assertion, in the same form, for the other door.
    //
    // A SECOND ENTRY HERE IS NOT AUTOMATICALLY WRONG. It is a second place the refusal has to be
    // honoured and a second consumer of the sealed handle, and it should be argued for in a ledger
    // rather than arrived at by autocomplete.
    const importers = SOURCE_FILES.filter((file) =>
      importsMemberFrom(file, readSourceCached(file), HISTORY_SERVICE, LONG_DOOR)
    ).map(relOf);
    expect(importers.sort()).toEqual(['hooks/useForecast.ts']);
  });

  it('!! F2 — THE CHECKER FIRES on the review`s own probe, which the call-site pin could not see', () => {
    // The exploit module, verbatim, as a synthetic source. Both checks run side by side so the
    // finding is executable rather than described: the CALL pin sees nothing, the IMPORT pin sees it.
    const panel = join(SRC_ROOT, 'hooks/useForecastPanel.ts');
    const source =
      "import { loadStatisticalHistory } from '../services/TransactionHistoryService';\n" +
      'export const PANEL_READERS = { history: loadStatisticalHistory };\n';
    expect(enclosingFunctionsOfCalls(panel, source, LONG_DOOR)).toEqual([]);
    expect(importsMemberFrom(panel, source, HISTORY_SERVICE, LONG_DOOR)).toBe(true);
  });

  it('!! F2 — and it survives the shapes the short door`s pin had to learn: namespace, dynamic, renamed', () => {
    // `importsMemberFrom` is keyed on the RESOLVED MODULE plus the member, which is what T5-review
    // F2 bought after a namespace import walked past a binding-name check AND past its own
    // non-vacuity canary. The long door inherits that for free, and the inheritance is asserted
    // rather than assumed — an inherited property nobody exercised is how the first one was lost.
    const shapes = [
      ['namespace', "import * as historyService from '../services/TransactionHistoryService';"],
      ['dynamic', "const { loadStatisticalHistory } = await import('../services/TransactionHistoryService');"],
      ['renamed', "import { loadStatisticalHistory as readHistory } from '../services/TransactionHistoryService';"],
    ] as const;
    for (const [name, source] of shapes) {
      expect(importsMemberFrom(PROBE, source, HISTORY_SERVICE, LONG_DOOR), name).toBe(true);
    }
    // …and a `loadStatisticalHistory` on some OTHER module is not this door, so the pin stays a
    // graph check rather than becoming a name ban.
    expect(
      importsMemberFrom(
        PROBE,
        "import { loadStatisticalHistory } from '../utils/periodMath';",
        HISTORY_SERVICE,
        LONG_DOOR
      )
    ).toBe(false);
  });

  it('!! the call is by IDENTIFIER, which is the only form the AST check above can see', () => {
    // The trap T7a walked into and out of. `history: loadStatisticalHistory` as a bare property
    // reference wires the door perfectly at runtime and is INVISIBLE to `enclosingFunctionsOfCalls`,
    // which requires `ts.isIdentifier(node.expression)` — so the pin above would have stayed green
    // while the door was walked, and the whole three-layer mechanism would have gone on being
    // untested. The default reader therefore CALLS it rather than aliasing it, and this assertion
    // is why that is not a stylistic choice.
    const hook = join(SRC_ROOT, 'hooks/useForecast.ts');
    expect(enclosingFunctionsOfCalls(hook, readSourceCached(hook), LONG_DOOR).length).toBe(1);
    // THE CHECKER'S BLIND SPOT, STATED: a property-reference wiring is not seen.
    const aliased = "import { loadStatisticalHistory } from '../services/TransactionHistoryService';\n" +
      'export const readers = { history: loadStatisticalHistory };';
    expect(enclosingFunctionsOfCalls(PROBE, aliased, LONG_DOOR)).toEqual([]);
  });

  it('and it EXISTS and is exported, so the check above is about absence of USE, not of the door', () => {
    // Without this, deleting `loadStatisticalHistory` outright would make the pin above pass.
    const doorSource = stripComments(readSourceCached(join(SRC_ROOT, DOOR_MODULE)), DOOR_MODULE);
    expect(doorSource).toMatch(new RegExp(`export async function ${LONG_DOOR}\\b`));
  });

  it('!! the ONLY production history read is the SHORT door, in `Dashboard.tsx`', () => {
    // The finding stated as the fact it is. When this list grows a second entry, the guard above
    // — "no module imports both" — becomes the thing standing between that entry and R6.
    const shortDoorReaders = SOURCE_FILES.filter((file) =>
      importsMemberFrom(file, readSourceCached(file), HISTORY_SERVICE, SHORT_DOOR)
    ).map(relOf);
    expect(shortDoorReaders).toEqual(['components/Dashboard.tsx']);
  });
});
