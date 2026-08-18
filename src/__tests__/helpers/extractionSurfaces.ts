// Stage 6 batch 9 — the tree-walk that batch 7 had to duplicate, extracted at last.
//
// Batch 7 rewrote three guards (mutation-sweep survivors S1–S4) to DERIVE the extraction-surface
// list by walking src/ instead of iterating a hardcoded array, because the hardcoded arrays sat
// under comments promising "this fails the day a FIFTH extraction surface is added without the
// notice" and could not. The rewrite left the ~70 lines of walker and comment-stripper copied
// verbatim into two test files, and recorded WHY the obvious fix was unavailable:
//
//   importing AiExtractionEgressNotice.surfaces.test.tsx from
//   AiExtractionSurfaces.contrast.test.ts would execute forty render cases and every vi.mock
//   registration in the other file, inside this suite.
//
// A helper MODULE has neither problem: it registers no mocks, renders nothing, and is not itself
// a test file, so vitest never collects it. Both guards keep reading the tree — the property that
// actually protects them — and now read it through one implementation.
//
// It lives under __tests__/ so the walkers below, which skip any directory named __tests__, can
// never scan themselves. That is not incidental: AiExtractionEgressNotice.tsx's own header
// comment contains the literal `<ModelPicker action="extraction">`, which is exactly why
// stripComments has to run before any of this matching (batch 7 caught that the naive version of
// this fix misclassifies the notice component as a surface and then fails looking for a notice
// inside the notice).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';

export const REPO_ROOT = resolve(__dirname, '../../..');
export const SRC_ROOT = resolve(__dirname, '../..');

/** Removes `//` and block comments, respecting string and template literals. */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Every non-test .ts/.tsx file under `dir`, recursively. */
export function listSourceFiles(dir: string): string[] {
  let files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'fixtures') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files = files.concat(listSourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full);
  }
  return files;
}

/** Brace-depth aware, so a `>` inside a JSX expression cannot terminate the tag early. */
export function jsxOpeningTags(source: string, name: string): string[] {
  const tags: string[] = [];
  const re = new RegExp(`<${name}\\b`, 'g');
  for (let m = re.exec(source); m; m = re.exec(source)) {
    let depth = 0;
    for (let i = m.index; i < source.length; i++) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) {
        tags.push(source.slice(m.index, i + 1));
        break;
      }
    }
  }
  return tags;
}

export const EXTRACTION_ACTION =
  /\baction\s*=\s*(?:"extraction"|'extraction'|\{\s*['"]extraction['"]\s*\})/;

/** Repo-relative, POSIX-separated paths of every file under src/ that mounts an extraction ModelPicker. */
export function findExtractionPickerSurfaces(): string[] {
  return listSourceFiles(SRC_ROOT)
    .filter((full) =>
      jsxOpeningTags(stripComments(readFileSync(full, 'utf8')), 'ModelPicker')
        .some((tag) => EXTRACTION_ACTION.test(tag))
    )
    .map((full) => relative(REPO_ROOT, full).replace(/\\/g, '/'))
    .sort();
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CLOSING REVIEW B-ii — THE PICKER WAS NEVER THE PREDICATE.
//
// findExtractionPickerSurfaces above derives its list from `<ModelPicker action="extraction">`,
// and every guard in this batch's two files ran off it. The closing review built a second hostile
// surface that mounts NO picker: it calls useAiModels('extraction'), takes models[0]?.modelId
// itself and calls extractDocument. All 1106 tests passed with it in the tree, undisclosed,
// role-gated and styled in AA-failing slate-400.
//
// That is not a near-miss shape. It is EXACTLY SyncButton's — the app's highest-volume egress
// path, whose three picker-less triggers batch 5 had to find and hand-fix — so the guard written
// immediately afterwards did not cover the case that motivated it. A picker is a CONVENIENCE the
// surface may or may not mount; what actually sends the document is the call.
//
// THE PREDICATE IS NOW THE UNION OF TWO, and it is a union rather than a replacement on purpose:
//
//   · mounts an extraction ModelPicker — the surface is CLAIMING to govern an extraction, so a
//     reader is entitled to the notice even if the call itself is made by a child component;
//   · reaches extractDocument / extractForReview — the surface PERFORMS one.
//
// Either alone is bypassable by the other's blind spot. The union is strictly stronger than the
// list batch 7 derived, so every surface that guard covered is still covered.
//
// The second half is a real (small) call graph over src/, not a grep: a grep for the two names
// would miss SyncButton's whole-folder triggers, which reach the extractor through
// SyncService.syncFilesFromDrive and never mention extractForReview at all — and those are
// precisely the three triggers batch 5 had to fix by hand. It is USE-based rather than
// import-based because import-based reachability is useless here: App.tsx imports SyncButton, so
// every import-transitive definition makes App.tsx an extraction surface and the guard becomes
// noise. App.tsx never USES anything tainted, so it is correctly not one.
//
// RE-REVIEW R-3 — "use" was originally read as "call", and that was two holes wide. A one-line
// re-export barrel was not an edge at all, and a function PASSED AS A PROP was not either. Both
// are closed below (see ModuleGraphNode.reexports and referencedNames), and the import-based
// noise the paragraph above rejects is held off by one specific exclusion: a JSX TAG NAME is not
// a reference. Rendering <SyncButton /> is not holding the extractor. The derived surface list is
// still exactly the four components it was before, and Renderer.tsx in the fixture tree pins it.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Where document egress begins. Stated rather than derived — this pair IS the definition of "an
 * extraction leaves the house" — but VERIFIED to still exist below, so a rename cannot leave the
 * whole call graph silently seeded on nothing and every guard passing vacuously.
 */
export const EXTRACTION_ROOTS: ReadonlyArray<{ file: string; exportName: string }> = [
  { file: 'src/services/aiClient.ts', exportName: 'extractDocument' },
  { file: 'src/utils/FileProcessor.ts', exportName: 'extractForReview' },
];

/** `path#declName`, the key the taint set is built on. */
type DeclKey = string;

const declKey = (file: string, name: string): DeclKey => `${file}#${name}`;

/** Calls made at module top level, outside any declaration, belong to this pseudo-declaration. */
const MODULE_SCOPE = '*module*';

function resolveRelativeImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null; // node_modules / bare specifier — never our code
  const base = resolve(fromFile, '..', specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not this candidate
    }
  }
  return null;
}

interface ModuleGraphNode {
  sourceFile: ts.SourceFile;
  /** local binding name → the declaration it refers to in another module. */
  imports: Map<string, DeclKey>;
  /** `import * as ns` bindings → the module they point at, so `ns.foo()` resolves. */
  namespaces: Map<string, string>;
  /** top-level declaration name → its node, for the reference scan. */
  decls: Map<string, ts.Node>;
  /**
   * RE-REVIEW R-3(a) — `export { extractDocument } from './aiClient'`.
   *
   * The name this module publishes → the declaration in the OTHER module it actually is. A
   * one-line barrel declares nothing and calls nothing, so it had no node in this graph at all:
   * an importer of the barrel resolved to `barrel#extractDocument`, which was never tainted,
   * and the whole chain downstream of it went dark. Proven — a barrel plus a component that
   * imports through it sent a real PDF and the family's names with all 1133 tests green.
   */
  reexports: Map<string, DeclKey>;
  /** `export * from './m'` — every name that module publishes, republished under this one. */
  starReexports: string[];
}

function declaredName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? 'default';
  if (ts.isClassDeclaration(node)) return node.name?.text ?? 'default';
  if (ts.isVariableStatement(node)) return null; // handled per-declaration by the caller
  return null;
}

function buildModuleGraph(files: string[]): Map<string, ModuleGraphNode> {
  const graph = new Map<string, ModuleGraphNode>();
  for (const full of files) {
    const sourceFile = ts.createSourceFile(
      full,
      readFileSync(full, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      full.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const imports = new Map<string, DeclKey>();
    const namespaces = new Map<string, string>();
    const decls = new Map<string, ts.Node>();
    const reexports = new Map<string, DeclKey>();
    const starReexports: string[] = [];

    sourceFile.forEachChild((node) => {
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        // `export type { … } from` re-publishes nothing that exists at runtime.
        if (node.isTypeOnly) return;
        const target = resolveRelativeImport(full, node.moduleSpecifier.text);
        if (target === null) return;
        const clause = node.exportClause;
        if (clause === undefined) {
          starReexports.push(target); // export * from './m'
        } else if (ts.isNamedExports(clause)) {
          for (const spec of clause.elements) {
            if (spec.isTypeOnly) continue;
            // `export { a as b } from` — b is what this module publishes, a is what it resolves to.
            reexports.set(spec.name.text, declKey(target, (spec.propertyName ?? spec.name).text));
          }
        } else if (ts.isNamespaceExport(clause)) {
          // `export * as ns from './m'` — reached as `ns.foo`, so it behaves like a namespace
          // IMPORT for anyone importing `ns` from here. Recorded as a star re-export under the
          // namespace name is not expressible in this flat graph, so it is recorded as a star:
          // over-approximating (every name of the target becomes reachable) fails CLOSED.
          starReexports.push(target);
        }
        return;
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        // Type-only imports cannot call anything at runtime, so they are not edges in a CALL graph.
        if (node.importClause?.isTypeOnly) return;
        const target = resolveRelativeImport(full, node.moduleSpecifier.text);
        if (target === null) return;
        const clause = node.importClause;
        if (!clause) return;
        if (clause.name) imports.set(clause.name.text, declKey(target, 'default'));
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          namespaces.set(bindings.name.text, target);
        } else if (bindings && ts.isNamedImports(bindings)) {
          for (const spec of bindings.elements) {
            if (spec.isTypeOnly) continue;
            imports.set(spec.name.text, declKey(target, (spec.propertyName ?? spec.name).text));
          }
        }
        return;
      }
      if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) decls.set(d.name.text, d);
        }
        return;
      }
      const name = declaredName(node);
      if (name !== null) {
        decls.set(name, node);
        // `export default function Foo()` is reachable under BOTH names.
        const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
        if (mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) decls.set('default', node);
      }
    });

    graph.set(full, { sourceFile, imports, namespaces, decls, reexports, starReexports });
  }
  return graph;
}

/**
 * Every name `node` REACHES — called as `f()` / `ns.f()`, or simply HELD as a value.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * RE-REVIEW R-3(b) — A CALL WAS NEVER THE ONLY WAY TO REACH THE EXTRACTOR, AND THE OTHER WAY IS
 * ORDINARY REACT.
 *
 * This function used to require a CallExpression. So a parent that imports `extractDocument` and
 * writes `<Child onExtract={extractDocument} />` was untainted (it never calls it) and the child
 * was untainted too (it has no import edge, only a prop) — a real PDF and the family's real names
 * left the house with all 1133 tests green. That is not a contrived refactor; passing a function
 * down as a prop is how React is written.
 *
 * So a bare reference is an edge now: holding the extractor IS reaching it. The four exclusions
 * below are what keep that from tainting the whole tree, and each is load-bearing:
 *
 *   · A JSX TAG NAME is "render this component", not "hold this function". Without this
 *     exclusion App.tsx's `<SyncButton />` makes App.tsx an extraction surface, then Dashboard,
 *     then everything — the exact import-transitive noise the header argues against.
 *   · A MEMBER NAME after a dot (`obj.extractDocument`) is not a free binding; the object is what
 *     resolves, and it does, through the namespace map.
 *   · A TYPE POSITION cannot call or hold anything at runtime.
 *   · THE NAME OF A DECLARATION (`function extractDocument`, a parameter, a property key) is the
 *     thing being defined, not a use of something else.
 *
 * Everything else counts, which keeps this fail-closed: a shape not enumerated here is recorded
 * as a reference, never silently dropped.
 */
function referencedNames(node: ts.Node): Array<{ name: string; namespace: string | null }> {
  const out: Array<{ name: string; namespace: string | null }> = [];
  const record = (name: string, namespace: string | null): void => {
    out.push({ name, namespace });
  };

  const visit = (n: ts.Node): void => {
    if (ts.isTypeNode(n) || ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) return;
    // Import and export clauses ARE the module edges and are resolved by the graph; counting the
    // specifier identifiers here would taint every file that merely names the import.
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isImportEqualsDeclaration(n)) return;

    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isIdentifier(callee)) record(callee.text, null);
      else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
        record(callee.name.text, callee.expression.text);
      } else {
        visit(callee);
      }
      for (const argument of n.arguments) visit(argument);
      return;
    }
    if (ts.isPropertyAccessExpression(n)) {
      if (ts.isIdentifier(n.expression)) record(n.name.text, n.expression.text);
      else visit(n.expression);
      return;
    }
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
      visit(n.attributes);
      return;
    }
    if (ts.isJsxClosingElement(n)) return;
    if (ts.isPropertyAssignment(n)) {
      if (ts.isComputedPropertyName(n.name)) visit(n.name);
      visit(n.initializer);
      return;
    }
    if (ts.isShorthandPropertyAssignment(n)) {
      record(n.name.text, null); // `{ extractDocument }` really is a reference to the binding
      return;
    }
    if (ts.isIdentifier(n)) {
      const parent = n.parent as (ts.Node & { name?: ts.Node }) | undefined;
      if (parent && parent.name === n) return;
      record(n.text, null);
      return;
    }
    n.forEachChild(visit);
  };
  visit(node);
  return out;
}

/**
 * Every file under src/ holding a declaration that transitively calls one of EXTRACTION_ROOTS.
 * Returns repo-relative POSIX paths — INCLUDING the plumbing (aiClient, FileProcessor,
 * SyncService), which the surface filter below strips.
 */
export function findExtractionCallerFiles(): string[] {
  return extractionCallerFilesIn(SRC_ROOT, EXTRACTION_ROOTS, REPO_ROOT);
}

/**
 * The same walk, over an ARBITRARY tree.
 *
 * Parameterised for one reason: the re-export and reference edges R-3 added cannot be tested
 * against src/ itself. A fixture that exercises them would have to BE an extraction surface in
 * the real tree — it would then need a real disclosure and would show up in every guard built on
 * this list. So the fixtures live under src/__tests__/fixtures/callGraph/ (which listSourceFiles
 * skips, twice over) and the tests point this function at them.
 *
 * That is not a convenience. The four known surfaces all reach the extractor by a plain import
 * and a plain call, so both new edges are INVISIBLE to every assertion made about src/ — a
 * `return` inserted at the top of either would leave the whole suite green. This project has
 * five recorded instances of exactly that shadowing; these fixtures are the unshadowed test.
 */
export function extractionCallerFilesIn(
  srcRoot: string,
  roots: ReadonlyArray<{ file: string; exportName: string }>,
  repoRoot: string
): string[] {
  const files = listSourceFiles(srcRoot);
  const graph = buildModuleGraph(files);

  const tainted = new Set<DeclKey>();
  for (const root of roots) {
    const full = resolve(repoRoot, root.file);
    const node = graph.get(full);
    if (!node || !node.decls.has(root.exportName)) {
      throw new Error(
        `the extraction roots name ${root.file}#${root.exportName}, which no longer exists. ` +
        'The extraction call graph would be seeded on nothing and every guard built on it would ' +
        'pass vacuously — re-point the root at wherever document egress now begins.'
      );
    }
    tainted.add(declKey(full, root.exportName));
  }

  // Fixpoint. Bounded by the number of declarations, so it always terminates.
  for (let changed = true; changed; ) {
    changed = false;
    for (const [full, node] of graph) {
      for (const [name, decl] of node.decls) {
        const key = declKey(full, name);
        if (tainted.has(key)) continue;
        const reaches = referencedNames(decl).some(({ name: called, namespace }) => {
          if (namespace !== null) {
            const target = node.namespaces.get(namespace);
            return target !== undefined && tainted.has(declKey(target, called));
          }
          const imported = node.imports.get(called);
          if (imported !== undefined) return tainted.has(imported);
          return tainted.has(declKey(full, called));
        });
        if (reaches) {
          tainted.add(key);
          changed = true;
        }
      }
      // R-3(a) — a name this module RE-PUBLISHES is that declaration, under this module's path.
      // `export { extractDocument } from './aiClient'` declares nothing and calls nothing, so
      // without this the barrel is a hole in the middle of the graph and everything downstream
      // of it resolves to a key that is never tainted.
      for (const [exported, target] of node.reexports) {
        const key = declKey(full, exported);
        if (!tainted.has(key) && tainted.has(target)) {
          tainted.add(key);
          changed = true;
        }
      }
      // `export * from './m'` republishes every name that module publishes — including the ones
      // IT re-published, which the fixpoint reaches on a later pass.
      for (const target of node.starReexports) {
        const source = graph.get(target);
        if (!source) continue;
        for (const exported of [...source.decls.keys(), ...source.reexports.keys()]) {
          const key = declKey(full, exported);
          if (!tainted.has(key) && tainted.has(declKey(target, exported))) {
            tainted.add(key);
            changed = true;
          }
        }
      }

      // References sitting at module top level, outside every declaration.
      const moduleKey = declKey(full, MODULE_SCOPE);
      if (!tainted.has(moduleKey)) {
        const topLevelCalls = node.sourceFile.statements
          .filter((s) => ts.isExpressionStatement(s))
          .flatMap((s) => referencedNames(s));
        if (topLevelCalls.some(({ name, namespace }) => {
          if (namespace !== null) {
            const target = node.namespaces.get(namespace);
            return target !== undefined && tainted.has(declKey(target, name));
          }
          const imported = node.imports.get(name);
          return imported !== undefined ? tainted.has(imported) : tainted.has(declKey(full, name));
        })) {
          tainted.add(moduleKey);
          changed = true;
        }
      }
    }
  }

  const hit = new Set<string>();
  for (const key of tainted) hit.add(key.slice(0, key.lastIndexOf('#')));
  return [...hit].map((full) => relative(repoRoot, full).replace(/\\/g, '/')).sort();
}

/**
 * THE DISCLOSURE SURFACES: every .tsx component file that either mounts an extraction ModelPicker
 * or reaches the extractor.
 *
 * `.tsx` is the honest filter for the second half, not a shortcut. aiClient.ts, FileProcessor.ts
 * and SyncService.ts all reach the extractor and all appear in findExtractionCallerFiles — but a
 * disclosure has to be RENDERED to a person, and only a component renders. Holding a plain service
 * module to "must mount <AiExtractionEgressNotice>" would be a guard nobody could satisfy, and a
 * guard nobody can satisfy gets deleted.
 */
export function findExtractionSurfaces(): string[] {
  const union = new Set([
    ...findExtractionPickerSurfaces(),
    ...findExtractionCallerFiles().filter((rel) => rel.endsWith('.tsx')),
  ]);
  return [...union].sort();
}
