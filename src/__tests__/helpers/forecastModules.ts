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
  // T7c — THE TWO MODULES `forecast.ts` WAS SPLIT INTO, and both are named DESPITE both being
  // reachable today, which is measured rather than assumed:
  //
  //   · `forecastBasis.ts` is reached from `forecast.ts` itself, which imports its vocabulary.
  //   · `statisticalLayer.ts` is reached from `forecastView.ts` ALONE. `forecast.ts` does not import
  //     it — the certain layer and the composer need nothing the moving average produces — so the
  //     engine's largest arithmetic module hangs on three function imports in the RENDER MODEL. The
  //     day a chip or a band stops being drawn, it leaves the purity ban, the clock ban, the
  //     `Date`-parameter ban and the month-literal ban at once, silently, and every one of them
  //     keeps reporting green.
  //
  // A root is a definition, not a discovery — the same reason `forecastTargets.ts` was named here
  // before anything imported it at all. `forecastPurity.test.ts` asserts BOTH the membership and
  // the fact that the composer's own closure does not reach `statisticalLayer.ts`, so this
  // paragraph is held by a test rather than by its own confidence.
  'utils/forecastBasis.ts',
  'utils/statisticalLayer.ts',
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// STAGE 7 T7c — THE TWO LEXERS §12's NO-PROBABILITY-LANGUAGE GUARD NEEDS, AND WHY THEY ARE HERE
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `hebrewStringLiteralsIn` was declared and exported by `forecastCopy.test.ts`. §12 scopes tier 1
// to "every string literal in the forecast copy AND COMPONENT MODULES", which is a second suite —
// and importing one test file from another executes its `describe`s inside the importing one, the
// problem this helper family exists for. MOVED, byte-identical body and comments, not copied: a
// second copy of a lexer is how two guards start disagreeing about what they cover while both
// report green (this repo's own F4 class, counted four times).
//
// `exportedLabelRecordsIn` is new. Tier 2's corpus was three records named in a `const` — the
// enumeration-guard class, which passes forever on the fourth. It is derived now.

/** Any Hebrew letter. Enough to tell a sentence a person reads from an identifier or a period. */
const HEBREW = /[\u0590-\u05FF]/;

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

/** One exported label map: its name, and the string values a reader can be shown. */
export interface LabelRecord {
  name: string;
  values: string[];
}

/**
 * Every EXPORTED `Record<…, string>` in a module, with its values — §12's tier-2 corpus, derived.
 *
 * The shape is the definition: a `const` whose declared type is `Record<K, string>` is, in this
 * codebase, a map from a state to the word the screen says for it. That is exactly what A39's
 * defect is — a band whose three states are NAMED שמרן / צפוי / אופטימי — and it is what an author
 * reaches for when adding a fourth. Naming three records instead would pass forever on the fourth,
 * which is the enumeration class §12 rejects for every other guard in this stage.
 *
 * !! NESTED RECORDS ARE READ TOO. `SEASONALITY_REFUSAL_HE` is a `Record<…, Record<…, string>>`, and
 * a version of this that only understood a flat object would have skipped it silently — a label map
 * outside the corpus while the guard reported green.
 */
export function exportedLabelRecordsIn(fileName: string, source: string): LabelRecord[] {
  const sourceFile = parseSource(fileName, stripComments(source, fileName));
  const records: LabelRecord[] = [];
  const stringValuesOf = (node: ts.Node): string[] => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isObjectLiteralExpression(node)) {
      return node.properties.flatMap((property) =>
        ts.isPropertyAssignment(property) ? stringValuesOf(property.initializer) : []
      );
    }
    return [];
  };
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    const exported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
    if (!exported) return;
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const declaredType = declaration.type;
      if (declaredType === undefined || !ts.isTypeReferenceNode(declaredType)) continue;
      if (declaredType.typeName.getText(sourceFile) !== 'Record') continue;
      if (declaration.initializer === undefined) continue;
      const values = stringValuesOf(declaration.initializer);
      if (values.length > 0) records.push({ name: declaration.name.text, values });
    }
  });
  return records;
}
