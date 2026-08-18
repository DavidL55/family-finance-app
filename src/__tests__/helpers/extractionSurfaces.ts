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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// STAGE 7 T2 — THE TREE-WALK FAMILY'S COST, FIXED AT ITS SOURCE RATHER THAN PER CALL SITE.
//
// Measured on this tree at HEAD f2eae0c, three consecutive root runs: this guard family is
// 31.2% / 33.5% / 33.1% of the whole root suite's per-file time (7.2s / 8.1s / 7.9s of ~23s),
// the worst single assertion is 1248–1678 ms, and AiExtractionEgressNotice.surfaces alone is
// 3785–4239 ms. The T1 ledger recorded the consequence: THREE OF THESE GUARDS TIMED OUT
// INTERMITTENTLY when T1 added one more full-src parse, and a vitest timeout inside an `it()`
// presents AS AN ASSERTION FAILURE WITH A DIFFERENT SET EACH RUN — so the cost is not the
// seconds, it is the debugging hours spent on a false trail by someone who does not have that
// ledger in front of them. (It also retro-explains the Stage 6 "AiSettingsScreen flake" recorded
// three times as machine load: load was the trigger, the budget was already spent.)
//
// Two structural causes, both fixed here:
//   1. vitest.config.ts declared NO `testTimeout`, so every guard sat on the 5000 ms default BY
//      ACCIDENT rather than by decision. Now set explicitly, with the measurement beside it.
//   2. every helper below called `ts.createSourceFile` FRESH on every invocation and
//      `readFileSync` fresh beside it, so cost was O(guards × files) and T4–T8 add guards.
//      `findExtractionSurfaces()` alone re-reads and re-parses the whole of src/ on EVERY call,
//      and the 3.8s file calls it once per render case.
//
// ── WHY THE KEY IS (path, mtime, size) FOR READS AND (fileName, exact source) FOR PARSES ──────
//
// The brief said "memoise the parsed source by (path, mtime)". Reads are keyed exactly that way
// (plus size, which is free and catches a same-millisecond rewrite). PARSES CANNOT BE, and the
// reason is specific rather than theoretical: `stripComments`/`stringLiterals`/`jsxOpeningTags`
// take SOURCE TEXT plus a fileName, and their callers legitimately pass text that did not come
// from that path — `forecastPurity.test.ts` drives every one of its non-vacuity cases through a
// fabricated `src/utils/synthetic.ts`, and every guard here parses BOTH the raw file and its
// comment-stripped form under the same real path. A (path, mtime) parse key would hand the raw
// tree back to a caller asking about synthetic text, i.e. would change answers — which is the
// one thing this change is not allowed to do.
//
// So the parse cache verifies the FULL SOURCE STRING on every hit. That makes "same key ⇒ same
// parse ⇒ same output" true by construction rather than by argument, and it is still O(1) in
// practice: `readSourceCached` and `stripComments` both hand back a STABLE STRING INSTANCE, so
// the `===` on the way in takes V8's pointer fast path and never walks the bytes. A few slots
// per file, because each file is parsed both raw and stripped.
//
// Safe to share one `ts.SourceFile` across callers: every consumer below only reads
// (forEachChild / getChildren / getText). Nothing mutates a node.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** How many distinct source texts are remembered per file name. Raw + stripped + headroom. */
const PARSE_CACHE_SLOTS_PER_FILE = 4;

const fileTextCache = new Map<string, { mtimeMs: number; size: number; text: string }>();
const parseCache = new Map<string, Array<{ source: string; sourceFile: ts.SourceFile }>>();
const stripCache = new Map<string, Array<{ source: string; stripped: string }>>();

/**
 * `readFileSync(path,'utf8')` memoised by (path, mtime, size), returning the SAME string instance
 * for repeat reads of an unchanged file — which is what makes the parse cache's identity check
 * free. A file edited mid-run (a watch-mode rerun, a test that writes a fixture) re-reads.
 */
export function readSourceCached(path: string): string {
  const stat = statSync(path);
  const hit = fileTextCache.get(path);
  if (hit !== undefined && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.text;
  const text = readFileSync(path, 'utf8');
  fileTextCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, text });
  return text;
}

function remember<T>(
  cache: Map<string, Array<{ source: string } & T>>,
  fileName: string,
  source: string,
  build: () => T
): T {
  const slots = cache.get(fileName);
  if (slots !== undefined) {
    for (const slot of slots) if (slot.source === source) return slot;
  }
  const built = build();
  const entry = { source, ...built };
  if (slots === undefined) cache.set(fileName, [entry]);
  else {
    slots.push(entry);
    if (slots.length > PARSE_CACHE_SLOTS_PER_FILE) slots.shift();
  }
  return entry;
}

/**
 * `ts.createSourceFile` memoised on (fileName, exact source text). `fileName` selects the parse
 * mode — TSX unless the name ends `.ts`, the same rule every call site below used before this
 * cache existed, stated once here instead of four times.
 */
export function parseSource(fileName: string, source: string): ts.SourceFile {
  return remember(parseCache, fileName, source, () => ({
    sourceFile: ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    ),
  })).sourceFile;
}

/**
 * The whole-tree derivations below (`findExtractionPickerSurfaces`, `findExtractionCallerFiles`)
 * are memoised on a FINGERPRINT of the file set — every scanned path with its mtime and size.
 * Same freshness contract as `readSourceCached`, one level up: parsing is now cheap, but the call
 * graph's fixpoint is not, and `AiExtractionEgressNotice.surfaces.test.tsx` re-derives the whole
 * thing six times. Deliberately NOT applied to the parameterised `extractionCallerFilesIn` — that
 * one is aimed at fixture trees by tests that are about the walk itself.
 */
const derivedCache = new Map<string, { fingerprint: string; value: string[] }>();

function fingerprintOf(files: string[]): string {
  return files
    .map((f) => {
      const s = statSync(f);
      return `${f}:${s.mtimeMs}:${s.size}`;
    })
    .join('\n');
}

function derived(key: string, files: string[], build: () => string[]): string[] {
  const fingerprint = fingerprintOf(files);
  const hit = derivedCache.get(key);
  if (hit !== undefined && hit.fingerprint === fingerprint) return [...hit.value];
  const value = build();
  derivedCache.set(key, { fingerprint, value });
  return [...value];
}

/**
 * Test-only seam onto the derived-list cache, so its (path, mtime, size) fingerprint can be proven
 * to be consulted WITHOUT writing a probe file into `src/`. That matters: vitest runs test files in
 * parallel, and a file appearing under `src/components/` mid-run would change what every other
 * tree-walk guard sees — manufacturing exactly the intermittent, different-set-each-run failure
 * this whole change exists to remove.
 */
export function __derivedForTest(key: string, files: string[], build: () => string[]): string[] {
  return derived(key, files, build);
}

/** Test-only: empties every cache so a cache-correctness test can measure a cold run. */
export function __resetSourceCaches(): void {
  fileTextCache.clear();
  parseCache.clear();
  stripCache.clear();
  derivedCache.clear();
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BATCH 10 — THE STRIPPER WAS THE HOLE, NOT THE GUARDS.
//
// stripComments used to be a hand-rolled character scanner. It knew about `//`, `/* */`, and the
// three quote characters — and NOTHING about regex literals. So the first `/…"…/` in a file put it
// into a bogus string state, after which it desynchronised permanently and EVERY COMMENT FROM
// THERE TO EOF SURVIVED THE STRIP.
//
// That reopened comment-satisfiability — the original HIGH bypass this whole family of guards
// exists to close — through the helper rather than through any guard. Proven on the real tree
// before this fix, with two lines added to AiExtractionEgressNotice.tsx:
//
//     const TIDY = /["']/g;                                    // step 1: desynchronise
//     // …the literal the guard greps for: useAiModels('extraction')   step 2: satisfy by comment
//     const { models } = useAiModels('chat');                  // step 3: the actual defect
//
// The extraction disclosure then resolved its provider off the CHAT model list — the "a disclosure
// that states a falsehood" defect the notice's own header warns about — and ALL 1174 TESTS PASSED.
// Deleting only step 1 failed the guard. The regex literal was the entire exploit.
//
// WHY THE COMPILER AND NOT A BETTER SCANNER.
//
// Getting this right by hand means distinguishing a regex literal from division — which is not a
// lexical question at all. `a /b/ g` is two divisions or one regex depending on whether `a` is a
// value or an operator, so a correct scanner needs the parser's context. On top of that it must
// carry escapes, character classes (`/[/]/` does not end at that slash), nested template
// substitutions (`` `${ `${x}` }` ``), and JSX text (where `//` is prose, not a comment). Every one
// of those is a fresh chance to reopen exactly the hole above.
//
// The TypeScript parser already resolves all of it, is already a dependency, and is already used
// by these helpers (see buildModuleGraph below, and helpers/promptEgress.ts). Comments are trivia,
// and trivia belongs to the token that follows it — so parsing and then reading the comment ranges
// in front of each token yields every comment in the file and nothing that merely looks like one.
// (Reading them takes BOTH range accessors and one exclusion for JSX text; see below for why.)
//
// THE COMMENTS ARE BLANKED, NOT DELETED, and that is a second fix rather than a stylistic choice:
//
//   · Offsets are preserved, so a guard matching across a window (`[\s\S]{0,400}?`) or reporting a
//     position sees the same geometry it would on the raw file.
//   · The old version DELETED, which joins the tokens either side: `foo/*c*/bar` became the single
//     identifier `foobar`, a match that exists in neither the source nor the stripped source.
//     Blanking gives `foo     bar`.
//
// Newlines are kept so line numbers survive too.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Replaces every comment with equivalent whitespace, leaving all other characters — and every byte
 * offset and line number — exactly where they were.
 *
 * `fileName` selects the parse mode and defaults to TSX, which is the only safe default: parsing a
 * .tsx file as .ts reads `<div>` as a type assertion and mangles the whole tree. Pass the real path
 * — every caller has one — so a .ts file using angle-bracket type assertions cannot misparse.
 */
export function stripComments(source: string, fileName = 'source.tsx'): string {
  return remember(stripCache, fileName, source, () => ({ stripped: stripCommentsUncached(source, fileName) })).stripped;
}

function stripCommentsUncached(source: string, fileName: string): string {
  const sourceFile = parseSource(fileName, source);

  const blanked = [...source];
  const visited = new Set<number>();

  // JSX TEXT IS CONTENT, NOT TRIVIA, and excluding the JsxText node itself is not enough to
  // protect it: the comment scan also runs at the full start of the SyntaxList holding the
  // element's children, which is the same position. So the rendered spans are collected up front
  // and any range overlapping one is left alone. A `// 50 km per hour` sitting on its own line
  // between <p> and </p> is RENDERED COPY, and a guard reading a component's markup must not have
  // it deleted from under them. (A real comment cannot fall inside a JsxText span, so this
  // exclusion can never swallow one.)
  const jsxTextSpans: Array<[number, number]> = [];
  const collectJsxText = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.JsxText) jsxTextSpans.push([node.getFullStart(), node.getEnd()]);
    node.forEachChild(collectJsxText);
  };
  collectJsxText(sourceFile);
  const insideJsxText = (start: number, end: number): boolean =>
    jsxTextSpans.some(([from, to]) => start < to && end > from);

  const blankTriviaBefore = (pos: number): void => {
    // Several nodes share a full start (a node and its first token), so the ranges would be
    // collected repeatedly; the work is idempotent but the set keeps it linear.
    if (visited.has(pos)) return;
    visited.add(pos);
    // BOTH kinds, and that is not belt-and-braces — it is the whole gap.
    //
    // TypeScript splits the trivia in front of a token at its first newline: getTrailingComment-
    // Ranges returns only what precedes that newline (a `// …` parked at the end of the previous
    // line of code), and getLeadingCommentRanges returns only what follows it. Using leading
    // alone — the obvious reading of "comments are leading trivia" — silently keeps every
    // end-of-line comment in the file, which is most of them. Caught by this helper's own tests
    // before it shipped; the union covers the gap exactly.
    const ranges = [
      ...(ts.getTrailingCommentRanges(source, pos) ?? []),
      ...(ts.getLeadingCommentRanges(source, pos) ?? []),
    ];
    for (const range of ranges) {
      if (insideJsxText(range.pos, range.end)) continue;
      for (let i = range.pos; i < range.end; i++) {
        if (blanked[i] !== '\n' && blanked[i] !== '\r') blanked[i] = ' ';
      }
    }
  };

  const walk = (node: ts.Node): void => {
    blankTriviaBefore(node.getFullStart());
    for (const child of node.getChildren(sourceFile)) walk(child);
  };
  walk(sourceFile);

  return blanked.join('');
}

/**
 * Every string-literal and template-literal chunk in a file, read off the AST.
 *
 * BATCH 10 — THE SECOND HAND-ROLLED LEXER, FOUND WHILE PROVING THE FIRST ONE FIXED.
 *
 * AiSettingsScreen.contrast.test.ts derived its (foreground, background) pairs by running
 * `/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g` over the comment-stripped source. That regex has the
 * SAME blind spot the stripper had: it cannot tell a quote character inside a regex literal from
 * a quote that opens a string, so one `/"/` anywhere above shifts the pairing for the whole file
 * and every class list after it is swallowed into one oversized pseudo-string. Split on
 * whitespace, that blob yields `text-slate-400';` — which the `^text-…$` anchor rejects — so the
 * class list contributes NO pair and is silently never measured.
 *
 * Proven: an AA-failing `'mt-1 text-xs text-slate-400'` planted on the settings screen behind a
 * `const Q = /"/;` was not flagged, with a fully correct comment stripper in place. Fixing the
 * stripper alone would have left that guard exploitable, so the lexer goes too.
 *
 * JSX text is deliberately NOT included: a Tailwind class list is never rendered copy, and
 * pulling prose in here would only add strings that contribute no colour pair.
 */
export function stringLiterals(source: string, fileName = 'source.tsx'): string[] {
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

/**
 * The printed source text of every `<name …>` / `<name … />` opening element in `source`, read off
 * the AST.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * CLOSE VERIFICATION F2 — THE THIRD HAND-ROLLED LEXER, AND ITS COMMENT SOLD THE MECHANISM WHILE
 * HIDING THE INVERSE.
 *
 * This used to be a brace-depth scanner over raw text, under the line "brace-depth aware, so a
 * `>` inside a JSX expression cannot terminate the tag early". True — and the same counter knows
 * nothing about strings, so a `{` or `}` INSIDE A STRING LITERAL in the opening tag desynchronises
 * the depth, no `>` is ever seen at depth 0, and THE TAG IS DROPPED ENTIRELY. Dropping a tag fails
 * OPEN: findExtractionPickerSurfaces stops classifying that file as a surface, and every guard
 * built on the list silently stops examining it.
 *
 * Demonstrated on this tree before the rewrite, with the depth counter intact:
 *
 *     <ModelPicker action="extraction" value={modelId.replace('}', '')} … />
 *
 * returned `[]`; removing only the `'}'` returned the tag. Same class as the two lexers batch 10
 * replaced, third instance, same answer: the TypeScript parser is already imported in this file,
 * already resolves strings, regex literals, template substitutions, character classes and JSX
 * text, and cannot be desynchronised by any of them.
 *
 * `fileName` selects the parse mode, and it matters more here than for stripComments: parsed as
 * .ts, `<ModelPicker …>` is read as a type assertion and yields NO JSX node at all — which is
 * again a silent drop. Every caller has a real path; pass it.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
export function jsxOpeningTags(source: string, name: string, fileName = 'source.tsx'): string[] {
  const sourceFile = parseSource(fileName, source);
  const tags: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sourceFile) === name
    ) {
      tags.push(node.getText(sourceFile));
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return tags;
}

export const EXTRACTION_ACTION =
  /\baction\s*=\s*(?:"extraction"|'extraction'|\{\s*['"]extraction['"]\s*\})/;

/** Repo-relative, POSIX-separated paths of every file under src/ that mounts an extraction ModelPicker. */
export function findExtractionPickerSurfaces(): string[] {
  const files = listSourceFiles(SRC_ROOT);
  return derived('pickerSurfaces', files, () => findExtractionPickerSurfacesUncached(files));
}

function findExtractionPickerSurfacesUncached(files: string[]): string[] {
  return files
    .filter((full) =>
      // stripComments still runs first, and it is now belt-and-braces rather than the only
      // defence: a commented-out tag is trivia to the parser and produces no JSX node either way.
      // It is kept because blanking preserves offsets and costs nothing, and because removing it
      // would make this file the one place in the batch that trusts a single mechanism.
      jsxOpeningTags(stripComments(readSourceCached(full), full), 'ModelPicker', full)
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
    const sourceFile = parseSource(full, readSourceCached(full));
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
 * So a bare reference is an edge now: holding the extractor IS reaching it.
 *
 * BATCH 10 — and the CHILD is tainted now too. This edge lands on the parent, which left
 * PropCallee (the component with the button, and with whatever prose and role check a hostile
 * author would put there) unexamined by the styling and role guards. See jsxPropHandoffs, which
 * follows the hand-off itself — and which states what it still does not reach.
 *
 * The four exclusions below are what keep the reference edge from tainting the whole tree, and
 * each is load-bearing:
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
 * The JSX prop hand-offs in `node`: for each element, its tag name and the names its attribute
 * VALUES reference.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * BATCH 10 — R-3(b) LANDED ON THE PARENT AND STOPPED THERE.
 *
 * R-3(b) made holding the extractor an edge, so `<Child onExtract={extractDocument} />` taints the
 * PARENT. The child stayed clean: it has no import, only a parameter. So the parent is flagged and
 * must carry the disclosure, while the child — where the button, the prose and any role check
 * actually live — was never examined by the styling or role guards at all. A hostile author could
 * put the UI in the child and only the wiring in the parent.
 *
 * The hand-off itself is visible, so it is now an edge: passing a tainted value INTO a component
 * taints that component. It stays narrow deliberately — a tainted ATTRIBUTE VALUE is required, so
 * a bare `<SyncButton />` still taints nobody and the anti-over-taint property R-3 bought
 * (Renderer.tsx, and App.tsx behind it) is untouched.
 *
 * WHAT THIS DOES NOT CLOSE, stated because the next author will otherwise read the edge as
 * general. Only a DIRECT JSX attribute is followed. A tainted value that reaches a child through
 * React context, a hook's return value, component state, a render prop or `children`, or a
 * higher-order component, is still invisible here — the child is not named at the hand-off site,
 * and finding it needs real interprocedural dataflow rather than an AST walk of this size. The
 * key pin and the disclosure guard on the PARENT remain the backstop for those shapes.
 */
function jsxPropHandoffs(node: ts.Node): Array<{ tag: string; values: Array<{ name: string; namespace: string | null }> }> {
  const out: Array<{ tag: string; values: Array<{ name: string; namespace: string | null }> }> = [];
  const visit = (n: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
      // A lowercase tag is a DOM element, not one of our components — there is no declaration to
      // taint, and `<div data-x={tainted} />` hands the value to nobody.
      const tagName = n.tagName;
      if (ts.isIdentifier(tagName) && /^[A-Z]/.test(tagName.text)) {
        const values = n.attributes.properties.flatMap((prop) => {
          if (ts.isJsxSpreadAttribute(prop)) return referencedNames(prop.expression);
          if (ts.isJsxAttribute(prop) && prop.initializer) return referencedNames(prop.initializer);
          return [];
        });
        if (values.length > 0) out.push({ tag: tagName.text, values });
      }
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
  return derived('callerFiles', listSourceFiles(SRC_ROOT), () =>
    extractionCallerFilesIn(SRC_ROOT, EXTRACTION_ROOTS, REPO_ROOT)
  );
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
      // BATCH 10 — the prop HAND-OFF edge. A tainted value passed into a child component taints
      // that child, so the guards that examine a surface's own markup (styling, role checks)
      // reach the component the UI is actually in and not only the one holding the import.
      // Scoped to a tainted attribute VALUE, so rendering a component taints nothing; see
      // jsxPropHandoffs for what this deliberately does not reach.
      for (const decl of node.decls.values()) {
        for (const { tag, values } of jsxPropHandoffs(decl)) {
          const handsTaint = values.some(({ name, namespace }) => {
            if (namespace !== null) {
              const target = node.namespaces.get(namespace);
              return target !== undefined && tainted.has(declKey(target, name));
            }
            const imported = node.imports.get(name);
            if (imported !== undefined) return tainted.has(imported);
            return tainted.has(declKey(full, name));
          });
          if (!handsTaint) continue;
          const child = node.imports.get(tag);
          const childKey = child ?? (node.decls.has(tag) ? declKey(full, tag) : null);
          if (childKey !== null && !tainted.has(childKey)) {
            tainted.add(childKey);
            changed = true;
          }
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T3 REVIEW F2 — "IS THIS CALL MY COLLECTION?" AND "WHAT ROW DOES IT WRITE?", STATED ONCE
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Three guards in this repo hand-rolled these two decisions and all three got them wrong in the
// same direction — they only saw a call that spelled the collection as a STRING LITERAL inside its
// own argument subtree and carried its row as an INLINE object literal. Every other spelling was
// invisible, and invisible means the guard reports zero offenders, which is exactly what a clean
// tree looks like:
//
//   · `transactionStampGuard` missed `const ref = collection(db, 'transaction_lines')` hoisted one
//     line up, and missed this repo's OWN exported `TRANSACTION_LINES_COLLECTION`;
//   · `forecastAssumptions`' `auditAtExpressions` missed `auditLog.ts:45` on BOTH counts at once
//     (`writer.set(doc(collection(db, AUDIT_LOG_COLLECTION), id), fullEntry)`), which is why a
//     hand-written text check had to sit beside it doing the job it could not.
//
// Same family as the comment-satisfiability bypass this module already exists to close, and the
// same fix: one implementation, tested against synthetic source in `commentStripper.test.ts`,
// which is where the shared technique's own tests live.
//
// TWO KINDS OF BINDING COUNT, AND ONLY TWO. A name holding the collection's NAME
// (`const C = 'transaction_lines'`, or the same constant imported), and a name holding a Firestore
// REFERENCE built from one (`collection(db, C)`, `db.collection(C)`, `doc(ref, id)`, `ref.doc(id)`).
// Nothing else — deliberately. The first draft counted any binding whose initializer MENTIONED the
// literal anywhere, on the argument that over-approximating is the safe direction for a guard, and
// it immediately mis-flagged `scripts/backfill-transaction-periods.ts`' completion-marker write:
// the marker's initializer contains
// `plan.patches.filter((w) => w.collection === 'transaction_lines')`, so `marker` "was" the
// collection and writing it to `settings/migrationState` read as an unstamped row write. An
// over-approximation that produces a false failure on the real tree is not a safe direction, it is
// a guard people delete.

/** A `const`/`let` declaration's initializer, by declared name, plus the names reassigned later. */
interface BindingsInFile {
  initializers: Map<string, ts.Node[]>;
  reassigned: Set<string>;
}

function bindingsIn(sourceFile: ts.SourceFile): BindingsInFile {
  const initializers = new Map<string, ts.Node[]>();
  const reassigned = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      const list = initializers.get(node.name.text);
      if (list === undefined) initializers.set(node.name.text, [node.initializer]);
      else list.push(node.initializer);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      reassigned.add(node.left.text);
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return { initializers, reassigned };
}

/** Exported `const NAME = '<literal>'` bindings of one module, by name. One hop, no re-exports. */
function exportedStringConstants(filePath: string): Map<string, string> {
  const out = new Map<string, string>();
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = parseSource(filePath, stripComments(readSourceCached(filePath), filePath));
  } catch {
    return out;
  }
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      if (decl.initializer !== undefined && ts.isStringLiteralLike(decl.initializer)) {
        out.set(decl.name.text, decl.initializer.text);
      }
    }
  }
  return out;
}

/**
 * Every identifier in `sourceFile` that DENOTES `collection` — a string constant holding its name
 * (declared here or imported over a relative path), or a Firestore reference built from one.
 *
 * Computed to a FIXPOINT rather than in one pass, so declaration order cannot hide a chain:
 * `const rowRef = doc(ref, id)` above `const ref = collection(db, NAME)` above
 * `const NAME = '…'` resolves the same as the reverse.
 */
export function stringConstantBindings(
  sourceFile: ts.SourceFile,
  filePath: string
): Map<string, string> {
  const bound = new Map<string, string>();

  // Imported constants — `TRANSACTION_LINES_COLLECTION` is exported by
  // `TransactionHistoryService.ts`, `AUDIT_LOG_COLLECTION` by `auditLog.ts` and
  // `RECURRING_COLLECTION` by `financeCollections.ts`, so this is not a hypothetical spelling, it
  // is how this repo already writes collection names.
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const target = resolveRelativeImport(filePath, statement.moduleSpecifier.text);
    if (target === null) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    const exported = exportedStringConstants(target);
    for (const element of bindings.elements) {
      const value = exported.get((element.propertyName ?? element.name).text);
      if (value !== undefined) bound.set(element.name.text, value);
    }
  }

  for (const [name, inits] of bindingsIn(sourceFile).initializers) {
    if (inits.length !== 1) continue;
    const init = unwrap(inits[0]);
    if (ts.isStringLiteralLike(init)) bound.set(name, init.text);
  }
  return bound;
}

export function collectionAliases(
  sourceFile: ts.SourceFile,
  filePath: string,
  collection: string
): Set<string> {
  const aliases = new Set<string>();
  for (const [name, value] of stringConstantBindings(sourceFile, filePath)) {
    if (value === collection) aliases.add(name);
  }

  const { initializers } = bindingsIn(sourceFile);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, inits] of initializers) {
      if (aliases.has(name)) continue;
      if (inits.some((init) => denotesCollection(init, sourceFile, collection, aliases))) {
        aliases.add(name);
        changed = true;
      }
    }
  }
  return aliases;
}

/** Call names that BUILD a Firestore reference, either SDK: `collection(…)`, `db.collection(…)`, `doc(…)`, `ref.doc(…)`. */
const REFERENCE_BUILDERS = new Set(['collection', 'doc']);

function unwrap(node: ts.Node): ts.Node {
  let current = node;
  for (;;) {
    if (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) current = current.expression;
    else if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
    else return current;
  }
}

/** Whether an initializer expression IS the collection's name, or a reference built from it. */
function denotesCollection(
  init: ts.Node,
  sourceFile: ts.SourceFile,
  collection: string,
  aliases: ReadonlySet<string>
): boolean {
  const node = unwrap(init);
  if (ts.isStringLiteralLike(node)) return node.text === collection;
  if (ts.isIdentifier(node)) return aliases.has(node.text);
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.getText(sourceFile)
        : null;
    if (name === null || !REFERENCE_BUILDERS.has(name)) return false;
    return referencesCollection(node, collection, aliases);
  }
  return false;
}

/**
 * True when `node`'s subtree names `collection` — as a string literal, or through any identifier
 * `collectionAliases` resolved to it.
 */
export function referencesCollection(
  node: ts.Node,
  collection: string,
  aliases: ReadonlySet<string>
): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isStringLiteralLike(n) && n.text === collection) {
      found = true;
      return;
    }
    if (ts.isIdentifier(n) && aliases.has(n.text)) {
      found = true;
      return;
    }
    n.forEachChild(visit);
  };
  visit(node);
  return found;
}

/** How far `resolveObjectLiteral` will follow `const a = b; const b = {…}`. */
const OBJECT_ALIAS_DEPTH = 4;

/**
 * The object literal an expression denotes: the literal itself, or the single initializer of a
 * binding in the SAME file that holds one.
 *
 * `null` — never a guess — when the value came from a call, a property access, an import, or a
 * binding assigned more than once. The consumers turn `null` into an INDIRECT classification,
 * which is a declaration they then check; it is not a pass.
 */
export function resolveObjectLiteral(
  expr: ts.Node,
  sourceFile: ts.SourceFile
): ts.ObjectLiteralExpression | null {
  const { initializers, reassigned } = bindingsIn(sourceFile);
  const seen = new Set<string>();
  let current: ts.Node = expr;

  for (let hop = 0; hop <= OBJECT_ALIAS_DEPTH; hop += 1) {
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
    }
    if (ts.isObjectLiteralExpression(current)) return current;
    if (!ts.isIdentifier(current)) return null;
    const name = current.text;
    if (seen.has(name) || reassigned.has(name)) return null;
    seen.add(name);
    const inits = initializers.get(name);
    if (inits === undefined || inits.length !== 1) return null;
    current = inits[0];
  }
  return null;
}
