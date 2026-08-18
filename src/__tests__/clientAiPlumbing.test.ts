// Stage 6 batch 9 (closing review M3) — THE DEAD CLIENT-SIDE AI PLUMBING STAYS DEAD.
//
// M3 was explicit that this is NOT a key leak: the closing reviewer grepped the built dist/ for
// the literal key value, for GEMINI_API_KEY and for GoogleGenAI, and found all three absent, so
// Task 7's claim held. What it found was stale CONFIG — four things still wired up for a
// client-side Gemini call that has not existed since Task 7:
//
//   · vite.config.ts inlined `process.env.GEMINI_API_KEY` into the bundle via `define`
//   · optimizeDeps pre-bundled '@google/genai/web'
//   · @google/genai was still a ROOT dependency
//   · the Hosting CSP named generativelanguage.googleapis.com (see hostingCsp.test.ts)
//
// None of it did anything. All of it made a reintroduction cheap and invisible: an author who
// imports GoogleGenAI in a component today gets a resolution error; before this batch they got a
// working client with a real key already inlined for them.
//
// FileProcessor.test.ts used to carry the regression guard for this as a `vi.mock` of
// '@google/genai/web' plus `expect(constructor).not.toHaveBeenCalled()`. That guard could only
// ever observe a call it was already mocking — it proved the current call path, not the absence
// of the package. This file asserts the absence directly, which is the stronger claim and the one
// that actually forecloses the reintroduction.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CLIENT_ENV_READS } from './helpers/clientEnvPin';
import { REPO_ROOT, parseSource, readSourceCached, stripComments } from './helpers/extractionSurfaces';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(rel: string): PackageJson {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, rel), 'utf8')) as PackageJson;
}

/** Every non-test source file under a directory, recursively. Includes __tests__ deliberately —
 *  a client-side provider SDK smuggled in behind a test helper would be just as reintroduced. */
function allFiles(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(allFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('no vendor AI SDK can reach the browser bundle (closing review M3)', () => {
  it('@google/genai is not a root dependency — a client-side import would not even resolve', () => {
    const pkg = readPackageJson('package.json');
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(all)).not.toContain('@google/genai');
  });

  it('…but functions/ still depends on it, because that is where the real adapter lives', () => {
    // The complementary half, stated so "remove the dependency" can never be read as "remove the
    // Google provider". The Google adapter is the only one tagged for extraction today.
    const pkg = readPackageJson('functions/package.json');
    expect(Object.keys(pkg.dependencies ?? {})).toContain('@google/genai');
  });

  it('no file under src/ imports a vendor AI SDK', () => {
    // Matches the IMPORT FORMS specifically (`from '…'`, `import('…')`, `require('…')`) rather
    // than the bare package name: this guard's own assertions above contain the string
    // '@google/genai' as data, and a name-substring scan would report this file as its own
    // violation. A vi.mock of one of these paths counts too, deliberately — that is how the
    // previous, weaker version of this guard was written.
    const SDK = String.raw`@google/genai(?:/\w+)?|@anthropic-ai/sdk|openai`;
    const IMPORTS = new RegExp(String.raw`(?:from|import|require|vi\.mock)\s*\(?\s*['"](?:${SDK})['"]`);
    const offenders = allFiles(resolve(REPO_ROOT, 'src'))
      .filter((full) => IMPORTS.test(stripComments(readSourceCached(full), full)))
      .map((full) => relative(REPO_ROOT, full));
    expect(offenders).toEqual([]);
  });

  it('the Vite build no longer inlines a provider key into the bundle', () => {
    const config = stripComments(readSourceCached(resolve(REPO_ROOT, 'vite.config.ts')), 'vite.config.ts');
    // Comments are stripped first: this file's own explanation of what was removed names the very
    // string being searched for, which is precisely the comment-satisfiability trap batch 7's
    // mutation sweep found in two other guards.
    expect(config).not.toMatch(/GEMINI_API_KEY/);
    expect(config).not.toMatch(/@google\/genai/);
    // And no `define` block at all: it existed only to carry that key, so its return is the
    // signal worth catching, not merely that one particular key name came back.
    expect(config).not.toMatch(/\bdefine\s*:/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CLOSE VERIFICATION F3 — THE ROUTE NOTHING IN THIS FILE COVERED, AND THE ONE THAT NEEDS NO
// CONFIG CHANGE AT ALL.
//
// Everything above closes the routes a REINTRODUCED CLIENT-SIDE CALL would need: the vendor SDK,
// and the `define:` block that used to inline the key. Both require editing a config file. The
// route that requires editing NOTHING was never checked: the repo-root .env holds the live Gemini
// key under a `VITE_` prefix, and the `VITE_` prefix is precisely Vite's contract for "inline this
// into the client bundle". `import.meta.env.VITE_GEMINI_API_KEY` in any file under src/ is the
// whole exploit — no define:, no SDK, no dependency.
//
// PROVEN ON THIS TREE before this guard existed: two lines at the top of src/App.tsx,
// `npx vite build`, and the 41-character live key was sitting in dist/assets/index-*.js. All 1215
// tests green. vite.config.ts's own comment asserted the key "is now read only by functions/ and
// by scripts, never by the client build" — a property nothing checked, and one that was false the
// moment anybody wrote that line. (The comment is corrected in the same commit as this guard.)
//
// THE GUARD MUST NOT DEPEND ON WHAT THE .env HAPPENS TO CONTAIN. The root .env is David's file and
// holds his live secret; it is being renamed and rotated separately, and this guard has to stand
// whatever it ends up saying. So nothing below reads .env. Two properties instead:
//
//   1. THE PIN. The set of environment-variable names read anywhere under src/ is EXACT. Any new
//      one — whatever it is called — fails until somebody puts it in the list and says why. This
//      is the layer that does not care what the variable is named.
//   2. THE DERIVED PROVIDER-KEY RULE, which a pin edit CANNOT wave through. The AI provider key
//      names are read out of functions/src/providers/*Adapter.ts — the code that actually consumes
//      them — and no name src/ reads may BE or END WITH one of them. `VITE_GEMINI_API_KEY` ends
//      with `GEMINI_API_KEY` and is refused even if a future author adds it to the pin. A fourth
//      provider added to functions/ is covered on the day its adapter is written, with no edit
//      here — the same "derive it from the tree rather than restate it" move the egress maps use.
//
// Deliberately NOT a text scan: this file names `VITE_GEMINI_API_KEY` as data in its own tests,
// and a substring guard would report itself. The reads are taken off the AST, so a name in a
// string or a comment is not a read.
//
// WHAT THIS DOES NOT CLOSE, measured rather than guessed. Six attack shapes were replanted against
// the finished guard and all six fail it: the reproduced leak verbatim, renamed destructuring,
// bracket access, taking the whole env object and indexing it later, the same key under a NEW NAME,
// and a secret-shaped new name. Adding the key to the pin fails too, on the derived rule. The one
// shape that survives is a provider key renamed to something that names neither a provider nor a
// secret — `VITE_LLM_THING` — AND deliberately added to CLIENT_ENV_READS with a written reason
// that is false. That is not a hole a predicate can close: it is an author asserting in prose that
// a secret is public. It is held the same way the egress copy is — the pin edit is visible in the
// diff and gets human eyes.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** One environment-variable read: `import.meta.env.X`, `process.env.X`, or a destructuring of either. */
interface EnvRead {
  /** The variable name, or WHOLE_OBJECT when the code took the env object itself. */
  name: string;
  /** `import.meta.env` or `process.env` — which door it went through. */
  via: string;
}

/**
 * The sentinel for `const e = import.meta.env` — a read this scan cannot attribute to a name.
 * Recorded rather than ignored, because ignoring it is the one edit that defeats the pin: taking
 * the whole object and indexing it later reads every VITE_ variable there is.
 */
const WHOLE_ENV_OBJECT = '*the whole env object*';

/** Every environment-variable read in `source`, read off the AST. */
function envReadsIn(source: string, fileName: string): EnvRead[] {
  // Stage 7 T2 — the shared, mtime/content-keyed parse cache, not a fresh parse per call. Same
  // fileName-selects-ScriptKind rule this call site spelled out before; see extractionSurfaces.ts.
  const sourceFile = parseSource(fileName, source);
  const reads: EnvRead[] = [];

  /** Which env object `node` IS, if it is one. `config.env` is not one; `import.meta.url` is not one. */
  const envDoor = (node: ts.Node): string | null => {
    if (!ts.isPropertyAccessExpression(node) || node.name.text !== 'env') return null;
    const target = node.expression;
    if (ts.isMetaProperty(target) && target.keywordToken === ts.SyntaxKind.ImportKeyword) {
      return 'import.meta.env';
    }
    if (ts.isIdentifier(target) && target.text === 'process') return 'process.env';
    return null;
  };

  const visit = (node: ts.Node): void => {
    const via = envDoor(node);
    if (via === null) {
      node.forEachChild(visit);
      return;
    }
    // The env object itself. What happens to it IMMEDIATELY is what decides which name was read;
    // anything this scan cannot name is recorded as the whole object rather than dropped.
    const parent = node.parent;
    if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      reads.push({ name: parent.name.text, via });
    } else if (parent && ts.isElementAccessExpression(parent) && parent.expression === node) {
      const argument = parent.argumentExpression;
      reads.push(
        ts.isStringLiteralLike(argument)
          ? { name: argument.text, via }
          : { name: WHOLE_ENV_OBJECT, via } // a computed key reads whichever variable it evaluates to
      );
    } else if (
      parent && ts.isVariableDeclaration(parent) && parent.initializer === node &&
      ts.isObjectBindingPattern(parent.name)
    ) {
      for (const element of parent.name.elements) {
        if (element.dotDotDotToken) {
          reads.push({ name: WHOLE_ENV_OBJECT, via }); // `...rest` is every remaining variable
          continue;
        }
        const property = element.propertyName ?? element.name;
        reads.push(
          ts.isIdentifier(property) || ts.isStringLiteralLike(property)
            ? { name: property.text, via }
            : { name: WHOLE_ENV_OBJECT, via }
        );
      }
    } else {
      // Passed to a function, spread, parenthesised, returned — the object escapes with every
      // variable in it.
      reads.push({ name: WHOLE_ENV_OBJECT, via });
    }
  };
  sourceFile.forEachChild(visit);
  return reads;
}

/**
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * FINAL VERIFICATION — THE SCAN WALKED src/, BUT THE BUNDLE IS NOT src/.
 *
 * Everything above pins what src/ reads. `src/` was taken to BE the client build, and it is not:
 * three routes put a value in the shipped output without a single file under src/ changing, and all
 * three were reproduced on this tree with the F3 guard 27/27 GREEN.
 *
 *   A. `%VITE_*%` IN index.html. Vite performs HTML env replacement on its build inputs. One
 *      `<meta content="%VITE_GEMINI_API_KEY%">`, `npx vite build`, and the live 39-character value
 *      is sitting in dist/index.html. No import, no read, nothing for an AST scan of src/ to see.
 *   B. AN INLINE `<script type="module">` IN index.html. That is not markup, it is a module: Vite
 *      compiles it into the bundle like any other. `window.x = import.meta.env.VITE_GEMINI_API_KEY`
 *      in the HTML entry put the live key into dist/assets/index-*.js.
 *   C. A MODULE OUTSIDE src/. `resolve.alias` mapped `@` to the REPO ROOT, so `@/probeRootModule`
 *      resolved to a file the scan never walks. Two lines at the repo root, imported from
 *      src/main.tsx, live key in dist/assets/index-*.js, 1260 tests green, both tsc clean. This is
 *      the original F3 exploit relocated one directory up.
 *
 * And the one that turned out NOT to be a route, stated because guessing it either way is how this
 * gets re-litigated: public/ is copied VERBATIM. `%VITE_GEMINI_API_KEY%` in public/probe.html and
 * in public/manifest.json survived the build as the literal placeholder text — measured, not
 * assumed. So public/ cannot leak an ENV value; it can only ship a value somebody typed into it,
 * which is what the public/ rule below actually checks.
 *
 * THE FIX IS IN TWO PARTS, because a bigger corpus alone would still be a directory list:
 *   1. CONTAINMENT (route C, at the root). The alias points at src/ now, and no import in the
 *      corpus may resolve outside src/. That is what makes "walk src/" a COMPLETE scan of the
 *      module graph rather than a lucky one — the premise the pin above was already resting on.
 *   2. THE HTML CORPUS (routes A and B). Every HTML file in the repo is scanned: its `%NAME%`
 *      placeholders AND its inline script bodies feed the SAME pin, so a name arriving through the
 *      markup faces the identical provider-key and secret-shape rules a name in src/ does.
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 */

/** Build output and vendor trees — not sources, and walking them is minutes rather than millis. */
const NOT_SOURCE = new Set(['node_modules', 'dist', '.git', '.firebase', 'coverage', '.vite']);

/** Every file under `dir` whose name `keep` accepts, skipping build output and vendor trees. */
function walkRepo(dir: string, keep: (name: string) => boolean): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (NOT_SOURCE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walkRepo(full, keep));
    else if (keep(entry)) out.push(full);
  }
  return out;
}

/**
 * Every `%NAME%` placeholder in an HTML build input — route A.
 *
 * Vite substitutes these from the resolved env at build time. Written as a named predicate with
 * synthetic inputs below for the reason this stage has now recorded twelve times: index.html has no
 * placeholder today, so `return []` satisfies every assertion made about the real tree.
 */
const htmlEnvPlaceholders = (source: string): string[] =>
  [...new Set([...source.matchAll(/%([A-Za-z_][A-Za-z0-9_]*)%/g)].map((m) => m[1]))].sort();

/**
 * The body of every inline `<script>` in an HTML file — route B.
 *
 * Returned rather than scanned in place so the SAME envReadsIn that covers src/ can be pointed at
 * it: an inline module is a module, and it deserves the identical rule, not a weaker text match.
 */
const inlineScriptBodies = (source: string): string[] =>
  [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)]
    .map((m) => m[1].trim())
    .filter((body) => body.length > 0);

/** Every `src="..."` an HTML file points a script at — the entry edge of the module graph. */
const htmlScriptSources = (source: string): string[] =>
  [...source.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);

/** One import edge: the module specifier, and whether it is erased at build time. */
interface ImportEdge {
  specifier: string;
  /** `import type …` / `export type …` / an all-`type` named list. Erased — it ships NO code. */
  typeOnly: boolean;
}

/**
 * Every module specifier a source imports, off the AST — static imports, re-exports, dynamic
 * `import()` and `require()`.
 *
 * Off the AST for the same reason envReadsIn is: this file names '@/probeRootModule' as data in its
 * own synthetic tests, and a text scan would report itself. The AST is also the only place the
 * type-only distinction exists, and that distinction is load-bearing below: src/ imports three
 * types from functions/src across the deploy boundary, and a type is erased — it cannot carry an
 * env read, or any other code, into the bundle.
 */
function importSpecifiersIn(source: string, fileName: string): ImportEdge[] {
  // Stage 7 T2 — the shared, mtime/content-keyed parse cache, not a fresh parse per call. Same
  // fileName-selects-ScriptKind rule this call site spelled out before; see extractionSurfaces.ts.
  const sourceFile = parseSource(fileName, source);

  /** A bare `import 'm'` is a side effect, a default or namespace binding is a value; only a
   *  wholly-`type` clause is erased. A MIXED list still ships the value half. */
  const importIsTypeOnly = (clause: ts.ImportClause | undefined): boolean => {
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    if (clause.name) return false;
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      return bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly);
    }
    return false;
  };

  const found: ImportEdge[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      found.push({ specifier: node.moduleSpecifier.text, typeOnly: importIsTypeOnly(node.importClause) });
    } else if (
      ts.isExportDeclaration(node) && node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const bindings = node.exportClause;
      const allType = node.isTypeOnly || (
        bindings !== undefined && ts.isNamedExports(bindings) &&
        bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly)
      );
      found.push({ specifier: node.moduleSpecifier.text, typeOnly: allType });
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const first = node.arguments[0];
      // A dynamic import or a require is a runtime call — there is no type-only form of it.
      if ((isImport || isRequire) && first && ts.isStringLiteralLike(first)) {
        found.push({ specifier: first.text, typeOnly: false });
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return found;
}

/**
 * Where `@/*` points, given a tsconfig's `paths` — or null when there is NO `@/*` mapping at all.
 *
 * Pure, and separated from the file read for the reason everything else here is: today's tsconfig
 * has exactly one mapping, so a version of this that just returned src/ would satisfy every
 * assertion made about the real tree — including the one whose entire job is to notice the mapping
 * moving back to the repo root.
 *
 * CLOSING REVIEW — IT USED TO FABRICATE AN ANSWER, AND THE FABRICATED ONE WAS THE UNSAFE TARGET.
 * The fallback was `?? './'`, so DELETING the paths entry — an edit that removes a safety property
 * rather than changing one — silently produced the repo root, the exact target the reproduced
 * probe exploited. A test recorded that ("NO mapping falls back to the repo root … never to
 * src/"), which DOCUMENTED the behaviour without refusing it. There is no correct answer to "where
 * does `@/*` point" when nothing maps it, so this returns none: the caller decides, in the open,
 * and the rule below fails on the absence itself with a message that says so.
 */
const aliasTargetFrom = (
  paths: Record<string, string[]> | undefined,
  repoRoot: string
): string | null => {
  const mapping = paths?.['@/*']?.[0];
  return mapping === undefined ? null : resolve(repoRoot, mapping.replace(/\/\*$/, ''));
};

/**
 * Which of `specifiers` reaches a module OUTSIDE `srcRoot` — route C.
 *
 * Bare package specifiers ('react', '@google/genai') are not paths and are covered by the vendor-SDK
 * rule above; everything that IS a path must land inside src/. `/x` is repo-root-relative, which is
 * how Vite resolves it and how index.html points at /src/main.tsx.
 */
const specifiersEscaping = (
  specifiers: readonly string[],
  fromDir: string,
  srcRoot: string,
  repoRoot: string,
  aliasTarget: string
): string[] => {
  const inside = (full: string): boolean => full === srcRoot || full.startsWith(srcRoot + sep);
  return specifiers
    .filter((specifier) => {
      // A path, or a name? Bare specifiers resolve into node_modules and are the SDK rule's job.
      // '@google/genai' starts with '@' and is NOT the alias — '@/' is.
      const full =
        specifier.startsWith('@/') ? resolve(aliasTarget, specifier.slice(2))
        : specifier.startsWith('/') ? resolve(repoRoot, specifier.slice(1))
        : specifier.startsWith('.') ? resolve(fromDir, specifier)
        : null;
      return full !== null && !inside(full);
    })
    .sort();
};

/** Every `process.env.X` name the given files read — the provider key names, from the code that uses them. */
function serverKeyNames(files: string[]): string[] {
  const found = new Set<string>();
  for (const full of files) {
    for (const read of envReadsIn(readSourceCached(full), full)) {
      if (read.via === 'process.env') found.add(read.name);
    }
  }
  return [...found].sort();
}

/**
 * The pin itself now lives in helpers/clientEnvPin.ts, because a SECOND guard reads it.
 *
 * bundleEnvLeak.build.test.ts asserts the complementary property against the built artifact — that
 * no environment VALUE reaches dist/ unless a pinned name put it there — and those are the same
 * set. One list, one written reason, one reviewer. It is also what stops the obvious escape from
 * that guard: adding a provider key here to silence a dist/ failure fails the two rules below
 * instead.
 */
/**
 * Name shapes that can never be pinned, whatever provider they belong to. Matched on whole
 * underscore-delimited words, so VITE_TOKENIZER_MODE is not a token and VITE_ACCESS_TOKEN_V2 is.
 *
 * Deliberately does NOT include API_KEY: the Firebase WEB key legitimately carries that suffix and
 * is public by design, and an exemption list beside a blocklist is the arms race this stage keeps
 * refusing. Provider keys are caught by DERIVATION from the adapters instead — see below.
 */
const SECRET_SHAPED = /(^|_)(SECRET|TOKEN|PASSWORD|CREDENTIALS?|PRIVATE_KEY|BEARER)(_|$)/i;

/**
 * Which of `names` carries one of the server's provider key names.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * A NAMED FUNCTION, AND IT IS THE TENTH SHADOWING INSTANCE IN THIS STAGE — CAUGHT BY MUTATION IN
 * MY OWN NEW GUARD, BEFORE THE FIRST COMMIT THIS TIME.
 *
 * Both of the rules below run over CLIENT_ENV_READS, which is clean today. So the comparison inside
 * them never executed: neutering either one — `.filter(() => false)` — left ALL 21 TESTS GREEN. The
 * same defect the ledger records nine times, reproduced inside the fix for the ninth. Both
 * predicates are extracted and exercised on synthetic name lists, exactly as unpinnedPhraseSharing,
 * borrowedPhrases and keysNaming are.
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 */
const providerKeysAmong = (names: readonly string[], keys: readonly string[]): string[] =>
  names.filter((name) => keys.some((key) => name.includes(key))).sort();

/** Which of `names` is secret-shaped, whatever it belongs to. */
const secretShapedAmong = (names: readonly string[]): string[] =>
  names.filter((name) => SECRET_SHAPED.test(name)).sort();

describe('the env-var route into the browser bundle is closed (close verification F3)', () => {
  const PROVIDER_ADAPTERS = ['anthropicAdapter.ts', 'googleAdapter.ts', 'openaiAdapter.ts']
    .map((f) => resolve(REPO_ROOT, 'functions/src/providers', f));

  const providerKeyNames = (): string[] => serverKeyNames(PROVIDER_ADAPTERS);

  const SRC_ROOT = resolve(REPO_ROOT, 'src');
  const rel = (full: string): string => relative(REPO_ROOT, full).replace(/\\/g, '/');

  /** Every HTML file in the repo — Vite's build inputs, wherever a future author puts them. */
  const htmlFiles = (): string[] => walkRepo(REPO_ROOT, (name) => name.endsWith('.html'));

  /** Where `@/*` points, read out of tsconfig.json rather than assumed — null if nothing maps it. */
  const aliasTarget = (): string | null => {
    const tsconfig = JSON.parse(readFileSync(resolve(REPO_ROOT, 'tsconfig.json'), 'utf8')) as
      { compilerOptions?: { paths?: Record<string, string[]> } };
    return aliasTargetFrom(tsconfig.compilerOptions?.paths, REPO_ROOT);
  };

  /**
   * The target the CONTAINMENT scan resolves `@/…` against while a missing mapping is failing the
   * rule below.
   *
   * The refusal belongs in one place and it is the test below. The other rules still have to run,
   * and with nothing mapping `@/*` there is no target anyone can vouch for — so they resolve at the
   * repo root, which makes every `@/…` read as escaping. Fail closed, at one named call site,
   * rather than inside the pure function where it looked like an answer.
   */
  const aliasTargetOrRoot = (): string => aliasTarget() ?? REPO_ROOT;

  /**
   * EVERY environment variable that can reach the shipped output — the three sources, one pin.
   *
   * src/ is the module graph (containment below is what makes that true), and the HTML build inputs
   * contribute twice: their inline scripts are modules, and their `%NAME%` placeholders are a
   * substitution that needs no code at all. Unioned deliberately, so a name arriving through the
   * markup meets the SAME provider-key and secret-shape rules a name in src/ meets.
   */
  const clientEnvReads = (): Array<EnvRead & { file: string }> => [
    ...allFiles(SRC_ROOT).flatMap((full) =>
      envReadsIn(readSourceCached(full), full).map((read) => ({ ...read, file: rel(full) }))
    ),
    ...htmlFiles().flatMap((full) => {
      const source = readSourceCached(full);
      return [
        ...inlineScriptBodies(source).flatMap((body) =>
          envReadsIn(body, `${full}.inline.ts`).map((read) => ({ ...read, file: `${rel(full)} (inline script)` }))
        ),
        ...htmlEnvPlaceholders(source).map((name) => ({
          name,
          via: '%ENV% in HTML',
          file: `${rel(full)} (%…% placeholder)`,
        })),
      ];
    }),
  ];

  it('the provider key names are DERIVED from the adapters, and the derivation is not vacuous', () => {
    // Stated-then-verified, the same way EXTRACTION_ROOTS is: if the adapters stop reading their
    // keys off process.env, this rule would be checking src/ against an empty list and every
    // assertion built on it would pass vacuously.
    const names = providerKeyNames();
    expect(names, 'no adapter reads a key off process.env — the provider-key rule is seeded on nothing')
      .toEqual(['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY']);
  });

  it('EVERYTHING that reaches the bundle reads EXACTLY the pinned variables — src/ AND the HTML', () => {
    // The layer that does not care what the variable is called. Renaming the Gemini key to
    // VITE_LLM_THING and reading it here still fails: the name is not on this list.
    //
    // The corpus is no longer src/ alone. `%VITE_GEMINI_API_KEY%` in index.html and an inline
    // `<script type="module">` reading it were BOTH reproduced into the built output with this
    // file 27/27 green; each now lands in this set and fails here, then again on the provider-key
    // rule below, which is the layer a pin edit cannot wave through.
    const read = [...new Set(clientEnvReads().map((r) => r.name))].sort();
    expect(
      read,
      'a file under src/ reads an environment variable that is not pinned. Vite INLINES every ' +
      'VITE_* variable into the browser bundle, so this list is the complete set of values the ' +
      'public build is allowed to carry. If the new one is genuinely public, add it to ' +
      'CLIENT_ENV_READS with the reason. If it is a secret, it belongs in functions/.'
    ).toEqual(CLIENT_ENV_READS.map((e) => e.name).sort());
  });

  it('…and NO pinned name is a provider key — a pin edit cannot let one through (F3)', () => {
    // The layer a pin edit cannot defeat, and the whole finding: VITE_GEMINI_API_KEY ends with
    // GEMINI_API_KEY, so adding it to the list above fails HERE instead.
    expect(
      providerKeysAmong(CLIENT_ENV_READS.map((e) => e.name), providerKeyNames()),
      'a pinned client env var is an AI provider key. The VITE_ prefix is exactly what puts it in ' +
      'the browser bundle — there is no configuration that makes this safe.'
    ).toEqual([]);
  });

  it('…and no pinned name is secret-SHAPED either, whatever provider it belongs to', () => {
    expect(secretShapedAmong(CLIENT_ENV_READS.map((e) => e.name))).toEqual([]);
  });

  it('nothing that reaches the bundle takes the whole env object, which would defeat the name pin', () => {
    expect(clientEnvReads().filter((r) => r.name === WHOLE_ENV_OBJECT)).toEqual([]);
  });

  it('the corpus is non-vacuous — it really found the HTML entry and the files under src/', () => {
    // Stated-then-verified, the same way the adapter derivation is. If walkRepo stopped finding
    // index.html, every HTML rule above would pass over nothing and say so to nobody.
    expect(htmlFiles().map(rel), 'no HTML build input found — the HTML rules are seeded on nothing')
      .toContain('index.html');
    expect(allFiles(SRC_ROOT).length, 'src/ scan found no files').toBeGreaterThan(50);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // CONTAINMENT (route C) — WHAT MAKES "WALK src/" A COMPLETE SCAN OF THE MODULE GRAPH.
  //
  // The pin above rests on a premise nothing stated: that every module in the client graph lives
  // under src/. It did not. `resolve.alias` mapped `@` to the REPO ROOT, so `@/probeRootModule`
  // reached a file outside the scan — reproduced, live key in dist/assets/index-*.js, 1260 green.
  // The alias is narrowed to src/ in the same commit; these two rules are what keep it there and
  // close the relative-path version of the same move.
  //
  // AND THE LIMIT OF ALL OF IT, WHICH THE CLOSING REVIEW NAMED PRECISELY: CONTAINMENT OF THE
  // MODULE GRAPH IS NOT CONTAINMENT OF THE BUNDLE. A Vite plugin puts values into the output
  // without being in the graph — measured twice, at 1314/1314 green. Every rule in this file is a
  // scan of source text and every one of them has now been bypassed by relocating the source.
  // bundleEnvLeak.build.test.ts is the route-independent half: it builds and reads dist/.
  // ─────────────────────────────────────────────────────────────────────────────────────
  it('the `@` alias points INSIDE src/, in tsconfig.json AND in vite.config.ts', () => {
    const target = aliasTarget();
    expect(
      target,
      'tsconfig.json has no `@/*` mapping. Deleting it does not make `@/…` safe — it makes the ' +
      'target unstated, and the unstated one used to be assumed to be the repo root. Map it into ' +
      'src/ or stop using the alias.'
    ).not.toBeNull();
    expect(
      target !== null && (target === SRC_ROOT || target.startsWith(SRC_ROOT + sep)),
      `tsconfig.json maps @/* to ${rel(target ?? REPO_ROOT) || '.'} — anything outside src/ is a ` +
      'module the env scan never walks, which is exactly how the repo-root probe reached the bundle.'
    ).toBe(true);
    // vite.config.ts is what the BUILD reads; tsconfig only satisfies the compiler. The two must
    // agree or the guard is checking the half that does not ship.
    const config = stripComments(readSourceCached(resolve(REPO_ROOT, 'vite.config.ts')), 'vite.config.ts');
    expect(config).toMatch(/['"]@['"]\s*:\s*path\.resolve\(__dirname,\s*['"]src['"]\)/);
  });

  /**
   * The VALUE imports that cross out of src/, and why each is not in the client graph.
   *
   * A pin, not an "except tests" clause, for the reason every other excuse in this stage is pinned:
   * "tests are not bundled" is true, and it is also exactly the sentence a future author would use
   * about a file that is not a test. Three MORE cross-boundary imports exist and are absent from
   * this list because they are `import type` — erased, and therefore not this rule's business.
   */
  const CROSS_BOUNDARY_VALUE_IMPORTS: ReadonlyArray<{ entry: string; whyNotBundled: string }> = [
    {
      entry: 'src/__tests__/aiPermissionsContract.test.ts imports ../../functions/src/shared/permissions',
      whyNotBundled:
        'a TEST, and the client graph starts at index.html -> /src/main.tsx, which reaches no test ' +
        'file. It imports the real resolveOwnedModuleScope in order to assert that functions/ and ' +
        'src/ still agree (D2) — the mirror is the thing being checked, so the import is the point.',
    },
  ];

  it('no module the bundle can reach lives outside src/ — imports and HTML entries alike', () => {
    // VALUE edges only. src/ imports three TYPES out of functions/src across the deploy boundary
    // (AiModelInfo, AiActionId) and a type is erased at build: it ships no code, so it cannot carry
    // an env read or anything else into the bundle. Erasure is the reason, and it is read off the
    // AST rather than assumed from the path.
    const escaping = (edges: ImportEdge[], fromDir: string): string[] =>
      specifiersEscaping(
        edges.filter((e) => !e.typeOnly).map((e) => e.specifier),
        fromDir, SRC_ROOT, REPO_ROOT, aliasTargetOrRoot()
      );
    const offenders = [
      ...allFiles(SRC_ROOT).flatMap((full) =>
        escaping(importSpecifiersIn(readSourceCached(full), full), dirname(full))
          .map((spec) => `${rel(full)} imports ${spec}`)
      ),
      ...htmlFiles().flatMap((full) => {
        const source = readSourceCached(full);
        return [
          ...specifiersEscaping(htmlScriptSources(source), dirname(full), SRC_ROOT, REPO_ROOT, aliasTargetOrRoot())
            .map((spec) => `${rel(full)} loads ${spec}`),
          ...inlineScriptBodies(source).flatMap((body) =>
            escaping(importSpecifiersIn(body, `${full}.inline.ts`), dirname(full))
              .map((spec) => `${rel(full)} (inline script) imports ${spec}`)
          ),
        ];
      }),
    ].sort();
    const pinned = CROSS_BOUNDARY_VALUE_IMPORTS.map((e) => e.entry).sort();
    expect(
      offenders,
      'a module outside src/ is reachable from the client build. The environment-variable pin ' +
      'above only walks src/, so anything out here reads whatever it likes, unseen — which is ' +
      'how a two-line file at the repo root put the live provider key into dist/assets/. If the ' +
      'module really cannot be in the bundle, add it to CROSS_BOUNDARY_VALUE_IMPORTS with the reason.'
    ).toEqual(pinned);
  });

  it('…and the escape pin is not a standing permission — every entry states why, and still exists', () => {
    // A stale pin is a permission granted by nobody currently reading the file, which is the shape
    // PHRASE_SHARING_PINS is held to as well.
    for (const { entry, whyNotBundled } of CROSS_BOUNDARY_VALUE_IMPORTS) {
      expect(whyNotBundled.trim().length, `${entry} has no stated reason`).toBeGreaterThan(20);
      const [file] = entry.split(' imports ');
      expect(existsSync(resolve(REPO_ROOT, file)), `${file} no longer exists — drop the pin`).toBe(true);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // public/ — COPIED VERBATIM, WHICH IS THE MEASURED FACT AND NOT THE ASSUMED ONE.
  //
  // `%VITE_GEMINI_API_KEY%` in public/probe.html AND in public/manifest.json both survived
  // `npx vite build` as the literal placeholder text: Vite does NOT substitute env into public
  // assets. So public/ cannot leak an env VALUE — it can only ship a value somebody typed into a
  // file there, which then goes to every visitor with no import, no build step and no review.
  // Both halves are checked: a placeholder here is a silent no-op its author clearly expected to
  // work, and a provider-key or secret-shaped name here is the real thing.
  // ─────────────────────────────────────────────────────────────────────────────────────────
  describe('public/ ships verbatim to every visitor', () => {
    /** Text files under public/ — binary assets (the icons) are skipped by their NUL bytes. */
    const publicTextFiles = (): Array<{ file: string; text: string }> =>
      walkRepo(resolve(REPO_ROOT, 'public'), () => true)
        .map((full) => ({ full, buffer: readFileSync(full) }))
        .filter(({ buffer }) => !buffer.includes(0))
        .map(({ full, buffer }) => ({ file: rel(full), text: buffer.toString('utf8') }));

    it('the scan finds the files that are actually there', () => {
      expect(publicTextFiles().map((f) => f.file)).toContain('public/manifest.json');
    });

    it('carries no provider key and no secret-shaped name — it is served with no build step', () => {
      const keys = providerKeyNames();
      const offenders = publicTextFiles().flatMap(({ file, text }) => {
        const words = [...new Set([...text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].map((m) => m[0]))];
        return [...providerKeysAmong(words, keys), ...secretShapedAmong(words)]
          .map((name) => `${file} contains ${name}`);
      }).sort();
      expect(offenders, 'a file under public/ names a provider key or a secret. public/ is copied ' +
        'into dist/ untouched and served to everyone.').toEqual([]);
    });

    it('carries no %ENV% placeholder either — Vite does NOT substitute those here', () => {
      const offenders = publicTextFiles()
        .flatMap(({ file, text }) => htmlEnvPlaceholders(text).map((name) => `${file} has %${name}%`))
        .sort();
      expect(offenders, 'a file under public/ uses %NAME% substitution, which is silently a no-op ' +
        'in public/ — the placeholder ships literally. Move the file to an HTML build input if the ' +
        'substitution was meant to happen, and pin the variable.').toEqual([]);
    });
  });

  it('every pinned variable states why it is safe in a public bundle', () => {
    for (const entry of CLIENT_ENV_READS) {
      expect(entry.whyPublic.trim().length, `${entry.name} has no stated reason`).toBeGreaterThan(20);
    }
  });

  describe('the two name rules, on shapes they can fail against (the tenth shadowing instance)', () => {
    const KEYS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY'];

    it('F3 EXACTLY: a VITE_-prefixed provider key is flagged', () => {
      expect(providerKeysAmong(['VITE_GEMINI_API_KEY'], KEYS)).toEqual(['VITE_GEMINI_API_KEY']);
    });

    it('the bare server name is flagged too, and so is one with something appended', () => {
      // Substring, not endsWith: `VITE_GEMINI_API_KEY_2` is the same key with a suffix, and a
      // rule anchored at the end waves it through.
      expect(providerKeysAmong(['GEMINI_API_KEY', 'VITE_OPENAI_API_KEY_2'], KEYS))
        .toEqual(['GEMINI_API_KEY', 'VITE_OPENAI_API_KEY_2']);
    });

    it('THE PRECISION CASE: the Firebase web API key is NOT a provider key', () => {
      // This is the one that keeps the rule usable rather than something a future author bolts an
      // exemption onto. It carries API_KEY, it is public by design, and it must pass.
      expect(providerKeysAmong(['VITE_FIREBASE_API_KEY', 'VITE_USE_EMULATOR', 'DEV'], KEYS)).toEqual([]);
    });

    it('and the rule is DERIVED — a fourth provider is covered the day its adapter is written', () => {
      expect(providerKeysAmong(['VITE_MISTRAL_API_KEY'], [...KEYS, 'MISTRAL_API_KEY']))
        .toEqual(['VITE_MISTRAL_API_KEY']);
      // …and is not covered before that, which is what makes the derivation the load-bearing part.
      expect(providerKeysAmong(['VITE_MISTRAL_API_KEY'], KEYS)).toEqual([]);
    });

    it('secret-shaped names are flagged on whole words', () => {
      expect(secretShapedAmong([
        'VITE_PROVIDER_SECRET', 'VITE_ACCESS_TOKEN_V2', 'VITE_DB_PASSWORD', 'VITE_SERVICE_PRIVATE_KEY',
      ])).toEqual([
        'VITE_ACCESS_TOKEN_V2', 'VITE_DB_PASSWORD', 'VITE_PROVIDER_SECRET', 'VITE_SERVICE_PRIVATE_KEY',
      ]);
    });

    it('…and a name that merely CONTAINS one of those letters is not', () => {
      // Otherwise the rule becomes noise and gets an exemption bolted onto it — and the pinned
      // Firebase key, which really does carry API_KEY, has to keep passing.
      expect(secretShapedAmong(['VITE_TOKENIZER_MODE', 'VITE_FIREBASE_API_KEY', 'VITE_SECRETARIAT_URL']))
        .toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // THE THREE ROUTES OUT OF src/, ON SHAPES THEY CAN FAIL AGAINST.
  //
  // Every one of these predicates runs over a corpus that is CLEAN today — index.html has no
  // placeholder, no inline script and no escaping import — so `return []` satisfies every assertion
  // made about the real tree. Written as stubs with these tests first, which is the standing rule
  // this stage arrived at after eleven shadowed guards, three of them inside the fix for the
  // previous one.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  describe('htmlEnvPlaceholders, on the markup a key would actually arrive through (route A)', () => {
    it('A EXACTLY: the reproduced meta tag', () => {
      expect(htmlEnvPlaceholders('<meta name="x" content="%VITE_GEMINI_API_KEY%" />'))
        .toEqual(['VITE_GEMINI_API_KEY']);
    });

    it('finds every one, sorted and de-duplicated', () => {
      expect(htmlEnvPlaceholders('<a href="%VITE_B%">%VITE_A%</a><i>%VITE_B%</i>'))
        .toEqual(['VITE_A', 'VITE_B']);
    });

    it('a placeholder anywhere counts — an attribute is not the only place Vite substitutes', () => {
      expect(htmlEnvPlaceholders('<title>%VITE_TITLE%</title>')).toEqual(['VITE_TITLE']);
    });

    it('finds nothing in HTML that has none — the shape of the real index.html', () => {
      expect(htmlEnvPlaceholders('<meta charset="UTF-8" /><div id="root"></div>')).toEqual([]);
    });

    it('a PERCENTAGE is not a placeholder — otherwise the rule is noise and gets an exemption', () => {
      expect(htmlEnvPlaceholders('<div style="width:100%;height:50%">50% off</div>')).toEqual([]);
    });

    it('and neither is something that is not an identifier', () => {
      expect(htmlEnvPlaceholders('<p>%not a name% %9LEADING%</p>')).toEqual([]);
    });
  });

  describe('inlineScriptBodies, on the entry a key would actually arrive through (route B)', () => {
    it('B EXACTLY: the reproduced inline module', () => {
      expect(inlineScriptBodies(
        '<script type="module">window.x = import.meta.env.VITE_GEMINI_API_KEY;</script>'
      )).toEqual(['window.x = import.meta.env.VITE_GEMINI_API_KEY;']);
    });

    it('returns EVERY inline script, not the first', () => {
      expect(inlineScriptBodies('<script>a()</script><script type="module">b()</script>'))
        .toEqual(['a()', 'b()']);
    });

    it('a script with only a src has no body to scan — that edge is htmlScriptSources', () => {
      expect(inlineScriptBodies('<script type="module" src="/src/main.tsx"></script>')).toEqual([]);
    });

    it('is case-insensitive on the tag, because HTML is', () => {
      expect(inlineScriptBodies('<SCRIPT>a()</SCRIPT>')).toEqual(['a()']);
    });
  });

  describe('htmlScriptSources — the entry edge of the module graph', () => {
    it('finds the real entry', () => {
      expect(htmlScriptSources('<script type="module" src="/src/main.tsx"></script>'))
        .toEqual(['/src/main.tsx']);
    });

    it('finds one that points OUT of src/, which is the case it exists for', () => {
      expect(htmlScriptSources('<script type="module" src="/probeRootModule.ts"></script>'))
        .toEqual(['/probeRootModule.ts']);
    });

    it('an inline script contributes no src', () => {
      expect(htmlScriptSources('<script>a()</script>')).toEqual([]);
    });
  });

  describe('aliasTargetFrom, on the mappings `@` has actually had', () => {
    it('C EXACTLY: the mapping that made the repo-root probe reachable', () => {
      expect(aliasTargetFrom({ '@/*': ['./*'] }, '/repo')).toBe(resolve('/repo'));
    });

    it('the mapping it has now', () => {
      expect(aliasTargetFrom({ '@/*': ['./src/*'] }, '/repo')).toBe(resolve('/repo/src'));
    });

    it('a mapping deeper than src/ is still inside it', () => {
      expect(aliasTargetFrom({ '@/*': ['./src/lib/*'] }, '/repo')).toBe(resolve('/repo/src/lib'));
    });

    it('NO mapping is REFUSED, not defaulted — an edit that DELETES the alias cannot pick a target', () => {
      // This used to return the repo root and a test used to record that as correct. It is not: an
      // edit that merely removes the paths entry then silently restored the exact target the
      // reproduced probe exploited, and the rule above would have reported "maps @/* to ." as
      // though somebody had chosen it. Nothing maps it, so there is no answer to give.
      expect(aliasTargetFrom(undefined, '/repo')).toBeNull();
      expect(aliasTargetFrom({}, '/repo')).toBeNull();
      expect(aliasTargetFrom({ 'other/*': ['./x/*'] }, '/repo')).toBeNull();
      expect(aliasTargetFrom({ '@/*': [] }, '/repo')).toBeNull();
    });

    it('…and a mapping that IS there is still resolved — the refusal is not the whole answer', () => {
      // Otherwise `() => null` passes everything above and the alias rule never runs on anything.
      expect(aliasTargetFrom({ '@/*': ['./src/*'] }, '/repo')).not.toBeNull();
    });
  });

  describe('importSpecifiersIn, on the import forms a module can arrive through', () => {
    const of = (code: string): string[] =>
      importSpecifiersIn(code, 'probe.ts').map((e) => e.specifier).sort();
    /** Only the edges that survive to runtime — the ones that can carry a read into the bundle. */
    const valuesOf = (code: string): string[] =>
      importSpecifiersIn(code, 'probe.ts').filter((e) => !e.typeOnly).map((e) => e.specifier).sort();

    it('a static import', () => {
      expect(of("import { PROBE_A } from '@/probeRootModule';")).toEqual(['@/probeRootModule']);
    });

    it('a side-effect import, which binds no name and is the easiest one to miss', () => {
      expect(of("import '../../probeRootModule';")).toEqual(['../../probeRootModule']);
    });

    it('a re-export, which pulls the module in just as hard', () => {
      expect(of("export { x } from '@/probeRootModule';")).toEqual(['@/probeRootModule']);
    });

    it('a dynamic import', () => {
      expect(of("const m = await import('@/probeRootModule');")).toEqual(['@/probeRootModule']);
    });

    it('a require', () => {
      expect(of("const m = require('@/probeRootModule');")).toEqual(['@/probeRootModule']);
    });

    it('every one in a file, not the first', () => {
      expect(of("import 'a';\nimport 'b';\nexport * from 'c';")).toEqual(['a', 'b', 'c']);
    });

    it('a string that merely LOOKS like a specifier is not one', () => {
      expect(of("const label = '@/probeRootModule'; console.log(label);")).toEqual([]);
    });

    it('and neither is one in a comment', () => {
      expect(of("// import x from '@/probeRootModule';\nconst a = 1;")).toEqual([]);
    });

    // THE TYPE/VALUE SPLIT, which is what lets src/ keep importing three types out of functions/.
    it('an `import type` is erased — it ships no code and cannot carry a read', () => {
      expect(valuesOf("import type { AiModelInfo } from '../../functions/src/providers/types';"))
        .toEqual([]);
      expect(of("import type { AiModelInfo } from '../../functions/src/providers/types';"))
        .toEqual(['../../functions/src/providers/types']);
    });

    it('an all-`type` named list is erased too', () => {
      expect(valuesOf("import { type A, type B } from 'm';")).toEqual([]);
    });

    it('but a MIXED list is NOT — the value half still ships', () => {
      expect(valuesOf("import { type A, B } from 'm';")).toEqual(['m']);
    });

    it('and neither is a default binding, a namespace, or a bare side-effect import', () => {
      expect(valuesOf("import D from 'a';")).toEqual(['a']);
      expect(valuesOf("import * as N from 'b';")).toEqual(['b']);
      expect(valuesOf("import 'c';")).toEqual(['c']);
    });

    it('`export type { X } from` is erased; a plain re-export is not', () => {
      expect(valuesOf("export type { X } from 'a';\nexport { Y } from 'b';")).toEqual(['b']);
    });

    it('a dynamic import is always a runtime edge — there is no type-only form of it', () => {
      expect(valuesOf("const m = await import('@/probeRootModule');")).toEqual(['@/probeRootModule']);
    });
  });

  describe('specifiersEscaping, on the imports that leave src/ (route C)', () => {
    const SRC = resolve(REPO_ROOT, 'src');
    const FROM = resolve(REPO_ROOT, 'src/components');
    const ALIAS = resolve(REPO_ROOT, 'src');

    it('C EXACTLY: the reproduced alias import, with the alias pointing at the REPO ROOT', () => {
      expect(specifiersEscaping(['@/probeRootModule'], FROM, SRC, REPO_ROOT, REPO_ROOT))
        .toEqual(['@/probeRootModule']);
    });

    it('…and the same import is fine once the alias points at src/ — the fix, verified', () => {
      expect(specifiersEscaping(['@/services/aiClient'], FROM, SRC, REPO_ROOT, ALIAS)).toEqual([]);
    });

    it('a relative import that CLIMBS OUT of src/ escapes, whatever the alias says', () => {
      expect(specifiersEscaping(['../../probeRootModule', '../../functions/src/providers/googleAdapter'],
        FROM, SRC, REPO_ROOT, ALIAS))
        .toEqual(['../../functions/src/providers/googleAdapter', '../../probeRootModule']);
    });

    it('ordinary relative imports inside src/ do not — the rule has to stay usable', () => {
      expect(specifiersEscaping(['./Button', '../services/aiClient', '../../src/utils/x'],
        FROM, SRC, REPO_ROOT, ALIAS)).toEqual([]);
    });

    it('a repo-root-absolute specifier is resolved the way Vite resolves it', () => {
      expect(specifiersEscaping(['/src/main.tsx', '/probeRootModule'], FROM, SRC, REPO_ROOT, ALIAS))
        .toEqual(['/probeRootModule']);
    });

    it('a BARE package specifier is not a path — vendor packages are the SDK rule above', () => {
      expect(specifiersEscaping(['react', '@google/genai', 'node:fs'], FROM, SRC, REPO_ROOT, ALIAS))
        .toEqual([]);
    });

    it('a sibling directory that merely STARTS with the same letters is outside src/', () => {
      // resolve()-based prefix matching without the separator would call src-legacy/ "inside src/".
      expect(specifiersEscaping(['../../src-legacy/thing'], FROM, SRC, REPO_ROOT, ALIAS))
        .toEqual(['../../src-legacy/thing']);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // THE SCANNER, ON SHAPES IT CAN FAIL AGAINST.
  //
  // Written before the scanner had a body. On the real tree every read is a plain
  // `import.meta.env.NAME`, so `return []` satisfies every assertion above — the shadowing defect
  // this stage has now recorded nine times, and the reason the fix for F2 exists at all.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  describe('envReadsIn, on the shapes a key would actually arrive through', () => {
    const scan = (src: string): EnvRead[] => envReadsIn(src, 'probe.ts');
    const names = (src: string): string[] => scan(src).map((r) => r.name).sort();

    it('F3 EXACTLY: a plain `import.meta.env.VITE_*_API_KEY` member read', () => {
      expect(scan('const k = import.meta.env.VITE_GEMINI_API_KEY;'))
        .toEqual([{ name: 'VITE_GEMINI_API_KEY', via: 'import.meta.env' }]);
    });

    it('bracket access with a string literal is the same read', () => {
      expect(names("const k = import.meta.env['VITE_GEMINI_API_KEY'];")).toEqual(['VITE_GEMINI_API_KEY']);
    });

    it('destructuring is the same read, and a RENAMED binding still reports the variable', () => {
      expect(names('const { VITE_GEMINI_API_KEY: k, DEV } = import.meta.env;'))
        .toEqual(['DEV', 'VITE_GEMINI_API_KEY']);
    });

    it('taking the whole object is recorded, never ignored — it reads everything', () => {
      expect(names('const e = import.meta.env;\nconst k = e[pick];')).toEqual([WHOLE_ENV_OBJECT]);
    });

    it('a computed access whose key is not a literal is a whole-object read — fail closed', () => {
      expect(names('const k = import.meta.env[pick];')).toEqual([WHOLE_ENV_OBJECT]);
    });

    it('process.env is the other door and is reported as such', () => {
      expect(scan("if (process.env.NODE_ENV !== 'production') {}"))
        .toEqual([{ name: 'NODE_ENV', via: 'process.env' }]);
    });

    it('several reads in one file are all reported, including inside JSX', () => {
      const src = 'const El = () => <p x={import.meta.env.VITE_A} y={import.meta.env.VITE_B} />;';
      expect(envReadsIn(src, 'probe.tsx').map((r) => r.name).sort()).toEqual(['VITE_A', 'VITE_B']);
    });

    it('a name in a STRING or a COMMENT is not a read — which is why this file can name the key', () => {
      expect(names("const s = 'import.meta.env.VITE_GEMINI_API_KEY';")).toEqual([]);
      expect(names('// import.meta.env.VITE_GEMINI_API_KEY\nconst x = 1;')).toEqual([]);
    });

    it('an unrelated `.env` property on some other object is not an env read', () => {
      // Precision: without it the rule flags `config.env.mode` and gets deleted as noise.
      expect(names('const m = config.env.MODE;')).toEqual([]);
      expect(names('const m = somethingElse.env;')).toEqual([]);
    });

    it('`import.meta` used for something other than env is not an env read', () => {
      expect(names('const u = import.meta.url;')).toEqual([]);
    });
  });
});

describe("vite.config.ts's comment claims only what a test checks (F3)", () => {
  it('does not claim the key is unreachable from the client build without naming the guard', () => {
    // The comment used to assert the repo-root key "is now read only by functions/ and by
    // scripts, never by the client build". That was a property nothing checked, and it was
    // reachable in one line. The sentence is corrected; this pins the false version out.
    const config = readSourceCached(resolve(REPO_ROOT, 'vite.config.ts'));
    expect(config).not.toContain('never by the client build');
    // …and the corrected comment must point at the guard that makes the claim true, so the next
    // reader can check it rather than believe it.
    expect(config).toContain('import.meta.env');
    expect(config).toContain('clientAiPlumbing.test.ts');
  });

  it('…and does not claim CONTAINMENT covers the bundle, which is the claim that was false', () => {
    // The second over-claim in the same file, and the one the closing review found: containment of
    // src/ makes "walk src/" complete OVER THE MODULE GRAPH, and a Vite plugin reaches the output
    // without being in the graph. The corrected comment has to name the guard that reads the
    // ARTIFACT, or it is promising bundle coverage from a source scan all over again.
    const config = readSourceCached(resolve(REPO_ROOT, 'vite.config.ts'));
    expect(config).not.toContain('makes "walk src/" a complete scan rather than a lucky one');
    expect(config).toContain('bundleEnvLeak.build.test.ts');
    // The distinction itself has to be written down, not just the guard's name — the whole defect
    // was a sentence that did not know which of the two things it was talking about.
    expect(config).toMatch(/module graph/i);
  });
});
