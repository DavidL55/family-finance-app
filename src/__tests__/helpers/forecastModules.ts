// src/__tests__/helpers/forecastModules.ts — Stage 7 T6.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHERE THE FORECAST ENGINE'S FILE LISTS COME FROM — DERIVED, NEVER ENUMERATED
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// T1 wrote the transitive-import walk inside `forecastPurity.test.ts` and exported it from there.
// T6 needs the same walk for the no-month-literal guard, and importing one test file from another
// executes its `describe`s inside the importing suite — the exact problem the `extractionSurfaces`
// helper's own header records. So the walk is MOVED HERE, not copied: duplicating a derivation is
// this project's recorded F4 class, and a second copy of an import walker is how two guards start
// disagreeing about which files they cover while both report green.
//
// ── WHY THIS FILE EXISTS AT ALL, RATHER THAN A LIST ───────────────────────────────────────────
//
// §12's rule for every guard in this stage is "what makes it able to fail, and where its data comes
// from". An enumeration guard that names four files and claims codebase scope is a counted defect
// class here: it passes forever on the fifth file, and its comment says otherwise. Every list below
// is computed from the tree — the closure from the imports, the exemptions from the declarations —
// so a module added, moved or renamed changes what the guards see without anyone editing a guard.
//
// ── THE ONE THING THAT IS STATED RATHER THAN DERIVED, AND WHY THAT IS SAFE ────────────────────
//
// The ENTRY POINTS are named (`FORECAST_ENTRY_MODULES`). That follows `EXTRACTION_ROOTS`'s
// precedent in `extractionSurfaces.ts`: a root is a definition, not a discovery. It is safe because
// it is VERIFIED — `forecastModules.test`-side assertions require every named entry to exist and
// the derived closure to be non-empty, so a rename cannot leave a guard seeded on nothing and
// passing vacuously.
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import * as ts from 'typescript';
import { SRC_ROOT, listSourceFiles, parseSource, readSourceCached, stripComments } from './extractionSurfaces';

/**
 * The forecast engine's public entry modules. A root is a definition rather than a discovery — see
 * the header — and each is asserted to exist by the guards that consume this.
 *
 * `forecast.ts` is the projector and the composer; `seasonality.ts` and `forecastTargets.ts` are
 * T6's two additions and are NOT reachable from `forecast.ts` in the import direction
 * (`forecast.ts` imports `seasonality.ts`, and nothing imports `forecastTargets.ts` yet — T7a wires
 * it), so naming them here is what stops the newest module in the stage from being outside every
 * guard until somebody notices.
 */
export const FORECAST_ENTRY_MODULES: readonly string[] = [
  'utils/forecast.ts',
  'utils/seasonality.ts',
  'utils/forecastTargets.ts',
  'utils/forecastCalibration.ts',
  // T7b — the render model. Named here for the SAME reason `forecastTargets.ts` was: nothing in
  // `forecast.ts`'s import direction reaches it (it imports `forecast.ts`, not the other way
  // round), so without this line the newest module in the stage would sit outside the purity ban,
  // the clock ban and the month-literal ban while every one of them reported green.
  'utils/forecastView.ts',
];

/** Every module specifier the file imports or re-exports, including type-only and dynamic ones. */
export function importSpecifiersOf(fileName: string, source: string): string[] {
  const sourceFile = parseSource(fileName, source);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = node.arguments;
      if (arg && ts.isStringLiteral(arg)) specifiers.push(arg.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      specifiers.push(node.argument.literal.text);
    }
    node.forEachChild(visit);
  };
  // TYPE-ONLY IMPORTS ARE FOLLOWED TOO. They vanish at runtime, so following them can only
  // over-approximate the closure — and over-approximating fails CLOSED, which is the only direction
  // a guard of this family is allowed to be wrong in.
  visit(sourceFile);
  return specifiers;
}

/** Resolves a relative or `@/`-aliased specifier to a real file under `src/`, or `null`. */
export function resolveWithinSrc(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else if (specifier.startsWith('@/')) base = resolve(SRC_ROOT, specifier.slice(2));
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

/**
 * The transitive import closure of `entry`, following only what resolves inside `src/`. `readSource`
 * is injected so the walk itself can be driven from synthetic modules with no files on disk.
 */
export function collectImportClosure(entry: string, readSource: (file: string) => string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importSpecifiersOf(file, stripComments(readSource(file), file))) {
      const resolved = resolveWithinSrc(file, specifier);
      if (resolved !== null && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return [...seen].sort();
}

export const readFromDisk = (file: string): string => readSourceCached(file);

/** Absolute paths of the entry modules, so a caller can assert they exist before trusting a walk. */
export function forecastEntryPaths(): string[] {
  return FORECAST_ENTRY_MODULES.map((rel) => join(SRC_ROOT, rel));
}

/**
 * Every module the forecast engine reaches, from every entry, as absolute paths.
 *
 * Union of closures rather than one closure, because the three T6 modules are not all downstream of
 * `forecast.ts` — and a guard that walked only from the composer would have covered none of what
 * T6 wrote on the day it was written.
 */
export function forecastClosure(): string[] {
  const seen = new Set<string>();
  for (const entry of forecastEntryPaths()) {
    for (const file of collectImportClosure(entry, readFromDisk)) seen.add(file);
  }
  return [...seen].sort();
}

/** Repo-src-relative, POSIX-separated, for readable assertion messages. */
export function srcRelative(file: string): string {
  return relative(SRC_ROOT, file).split('\\').join('/');
}

/**
 * The TOP-LEVEL declaration names a module introduces — functions, classes, interfaces, type
 * aliases, enums and `const`/`let` bindings.
 *
 * !! A RE-EXPORT IS NOT A DECLARATION, and that distinction is what makes the seasonality scope
 * below work. `export type { SeasonalFactor } from './seasonality'` republishes a name without
 * declaring it, so `forecast.ts` — which holds `months < 1` and `monthsObserved >= 1`, integer
 * literals in 1..12 that are not months — stays OUT of the integer ban while still exposing the
 * type under its historic name.
 */
export function declaredNamesIn(fileName: string, source: string): string[] {
  const sourceFile = parseSource(fileName, stripComments(source, fileName));
  const names: string[] = [];
  sourceFile.forEachChild((node) => {
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) names.push(d.name.text);
      return;
    }
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      if (node.name) names.push(node.name.text);
    }
  });
  return names;
}

/**
 * Every module under `src/` that DECLARES a name matching `pattern`.
 *
 * This is the derivation the month-literal guard's narrow scope is built on, and the reason it is a
 * derivation: the seasonality logic is wherever the seasonality logic is. Move it to a new file,
 * split it in two, rename the file — the guard follows. What it cannot see is seasonality logic
 * written under a name with nothing seasonal in it; that bound is stated in the guard itself and is
 * why the OTHER two bans are scoped to the whole closure instead.
 */
export function modulesDeclaringNameMatching(pattern: RegExp): string[] {
  return listSourceFiles(SRC_ROOT)
    .filter((file) => declaredNamesIn(file, readFromDisk(file)).some((name) => pattern.test(name)))
    .sort();
}
