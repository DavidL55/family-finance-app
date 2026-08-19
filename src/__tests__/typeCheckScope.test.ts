// src/__tests__/typeCheckScope.test.ts — Stage 7 T6 review, F1. THE GREEN GATE ITSELF.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// `npm run lint` HAS TO MEAN THE SAME THING ON A FRESH CLONE AS IT DOES ON A DEV MACHINE
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// The T6 review reproduced this four ways: `tsc --noEmit` EXITED 2 in a worktree with no `dist/`,
// EXITED 0 the moment a built `dist/` was copied in, and exited 0 in the main repo — which has one.
// The mechanism is `allowJs: true` plus NO `include`: `tsc`'s default file set is "everything under
// the tsconfig's directory", so the built `dist/assets/index-*.js` JOINED THE PROGRAM. `dist/` is
// gitignored, so the file that was suppressing the error existed on every machine that had run a
// build and on none that had not.
//
// The consequence is the reason this file exists rather than a one-line annotation: every "lint
// clean" claim made since T5 was unverifiable on a fresh clone or in CI, and no test could see it.
//
// ── WHAT IS ASSERTED, AND WHAT EACH ASSERTION CAN ACTUALLY FAIL ON ────────────────────────────
//
//   1. The build output directory is EXCLUDED in `tsconfig.json`. Derived from `vite.config.ts`
//      (`build.outDir`, falling back to Vite's documented default) rather than typed here, so
//      renaming the output directory fails this instead of quietly re-opening the hole.
//   2. NO FILE INSIDE IT IS IN THE PROGRAM — read off the TypeScript API's own file resolution,
//      which is the mechanism `tsc` uses, not a re-implementation of it. This is the assertion that
//      would have caught the original defect on the machine where it was invisible.
//   3. The checker in (2) is proven to FIRE on a synthetic file list first, because on a tree that
//      has never been built there is nothing under the output directory and (2) is vacuously true
//      exactly where the defect cannot occur.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';
import { REPO_ROOT } from './helpers/extractionSurfaces';

const TSCONFIG = join(REPO_ROOT, 'tsconfig.json');
const VITE_CONFIG = join(REPO_ROOT, 'vite.config.ts');

/**
 * Vite's build output directory, read out of `vite.config.ts` — or its documented default.
 *
 * Derived rather than typed, for the same reason every other scope in this stage is derived: a
 * guard that names `'dist'` keeps passing on the day somebody sets `outDir: 'build'`, and the hole
 * it was written to close reopens under a different name with the guard still green.
 */
function buildOutputDirName(): string {
  const source = readFileSync(VITE_CONFIG, 'utf8');
  const sourceFile = ts.createSourceFile(VITE_CONFIG, source, ts.ScriptTarget.Latest, true);
  let declared: string | null = null;
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'outDir' &&
      ts.isStringLiteral(node.initializer)
    ) {
      declared = node.initializer.text;
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  // Vite's default when `build.outDir` is not declared. Named here because it is the value the
  // project is actually running on today, and the assertion below is about that value.
  return declared ?? 'dist';
}

/** The `tsconfig.json` as `tsc` reads it — JSONC, through TypeScript's own parser. */
function tsconfigJson(): { exclude?: string[]; include?: string[]; compilerOptions?: Record<string, unknown> } {
  const parsed = ts.parseConfigFileTextToJson(TSCONFIG, readFileSync(TSCONFIG, 'utf8'));
  expect(parsed.error, 'tsconfig.json must parse').toBeUndefined();
  return parsed.config;
}

/**
 * Which of these files sit inside the build output directory.
 *
 * PURE over its inputs, so it is proven to fire on a synthetic list before it is aimed at the real
 * program. That matters more here than usual: on a tree that has never been built there is nothing
 * under `dist/` to find, so the real-tree assertion is silent in exactly the situation where the
 * defect cannot happen — and a checker that could never fire would look identical.
 */
function insideBuildOutput(fileNames: string[], outDirName: string): string[] {
  const outDir = resolve(REPO_ROOT, outDirName);
  return fileNames.filter((file) => {
    const rel = relative(outDir, resolve(file));
    return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep) && !resolve(file).startsWith('..');
  });
}

describe('!! F1 — the type-check program never contains the build output', () => {
  it('the checker FIRES on a synthetic file list — proven before it is aimed at the tree', () => {
    const out = buildOutputDirName();
    expect(insideBuildOutput([join(REPO_ROOT, out, 'assets/index-abc.js')], out)).toHaveLength(1);
    expect(insideBuildOutput([join(REPO_ROOT, 'src/utils/forecast.ts')], out)).toEqual([]);
    // Not a prefix match on the string: a sibling directory whose name STARTS with the output
    // directory's name is not inside it.
    expect(insideBuildOutput([join(REPO_ROOT, `${out}-notes`, 'x.ts')], out)).toEqual([]);
  });

  it('`tsconfig.json` EXCLUDES the build output directory, derived from the vite config', () => {
    const out = buildOutputDirName();
    const config = tsconfigJson();
    expect(config.exclude ?? [], `tsconfig must exclude the build output '${out}'`).toContain(out);
  });

  it('!! and the PROGRAM proves it — no file `tsc` would read lives under the build output', () => {
    // The mechanism, not a re-implementation of it: `parseJsonConfigFileContent` is the same file
    // resolution `tsc --noEmit` performs. On a machine that has run `npm run build` this is the
    // assertion that fails when the exclusion is removed; on a fresh clone there is nothing to
    // find, which is why the synthetic proof above is not optional.
    const out = buildOutputDirName();
    const parsed = ts.parseJsonConfigFileContent(tsconfigJson(), ts.sys, REPO_ROOT);
    expect(parsed.errors.filter((e) => e.category === ts.DiagnosticCategory.Error)).toEqual([]);
    expect(parsed.fileNames.length).toBeGreaterThan(0);
    expect(insideBuildOutput(parsed.fileNames, out).map((f) => relative(REPO_ROOT, f))).toEqual([]);
  });

  it('and the exclusion is LOAD-BEARING here and now — removing it puts the build output back in', () => {
    // Vacuity is the whole risk with the assertion above. This re-resolves the program with the
    // exclusion taken out and asserts the difference is non-empty, so the guard is proven to be
    // guarding on this machine. It is skipped by an explicit assertion — never silently — when the
    // tree has never been built, because there is then nothing for `tsc` to have picked up.
    const out = buildOutputDirName();
    if (!existsSync(join(REPO_ROOT, out))) {
      expect(existsSync(join(REPO_ROOT, out)), 'no build output on disk: nothing to re-include').toBe(false);
      return;
    }
    const config = tsconfigJson();
    const without = { ...config, exclude: (config.exclude ?? []).filter((entry) => entry !== out) };
    const parsed = ts.parseJsonConfigFileContent(without, ts.sys, REPO_ROOT);
    expect(insideBuildOutput(parsed.fileNames, out).length).toBeGreaterThan(0);
  });
});
