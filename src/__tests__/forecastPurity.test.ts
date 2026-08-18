// Stage 7 T1 — D37, mirrorability restated as something a guard can CHECK.
//
// v1's version of this constraint said "constrain `forecast.ts` to `netWorth.ts`'s contract
// exactly". That was not satisfiable and nobody could have noticed by reading it: `netWorth.ts`
// itself calls `new Date()` at :69, and v1's own next task said to reuse `computeDuePeriods`, which
// TAKES A `Date` PARAMETER. A constraint whose reference implementation violates it is a comment,
// not a rule.
//
// The adjudication's stated reason for striking it was ALSO wrong, and that is on the record in the
// plan: it said `computeDuePeriods` "does `Date` arithmetic". It does not — `recurringCatchup.ts`
// deliberately operates on strings and integers, and its header says so. The real reasons are the
// two above. This guard bans the `Date` PARAMETER and the clock read, not phantom arithmetic.
//
// ── WHAT THIS GUARD CAN ACTUALLY FAIL ON ───────────────────────────────────────────────────────
//
//   · a `firebase/*`, `src/services/*`, `src/contexts/*` or `src/components/*` import appearing
//     anywhere in `forecast.ts`'s TRANSITIVE closure — not just in `forecast.ts` itself, which is
//     the hole a single-file scan would leave;
//   · a clock read — `new Date`, `Date.now`, `Date.UTC`, `Intl.DateTimeFormat` — anywhere in that
//     closure;
//   · `composeForecast` ceasing to take the current period as a parameter.
//
// The checkers are pure functions over source text and are exercised against SYNTHETIC sources
// first, so each one is proven to fire before it is pointed at the real tree. On today's tree the
// closure is clean by construction, which means every check here is shadowed unless it is proven
// against inputs that were built to break it. That is the twelve-shadowed-guards lesson, applied to
// the guard rather than to the feature.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { SRC_ROOT, stripComments } from './helpers/extractionSurfaces';
import { composeForecast } from '../utils/forecast';

const FORECAST_ENTRY = join(SRC_ROOT, 'utils/forecast.ts');

/**
 * Directories `forecast.ts`'s closure may not reach, and the bare-specifier prefixes that are
 * banned outright. `src/types/` is absent on purpose: it holds interfaces only, it is where the
 * document shapes live, and a type has no runtime behaviour to be impure with.
 */
const BANNED_DIR_PREFIXES = ['services/', 'contexts/', 'components/'];
const BANNED_PACKAGE_PREFIXES = ['firebase/', 'firebase'];

/** Every way this codebase can read a clock or a locale-dependent calendar. */
const CLOCK_READS = [/\bnew\s+Date\b/, /\bDate\s*\.\s*now\b/, /\bDate\s*\.\s*UTC\b/, /\bIntl\s*\.\s*DateTimeFormat\b/];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the checkers — pure over (fileName, source), so they can be aimed at synthetic inputs
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Every module specifier the file imports or re-exports, including type-only and dynamic ones. */
export function importSpecifiersOf(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = node.arguments;
      if (arg && ts.isStringLiteral(arg)) specifiers.push(arg.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      specifiers.push(node.argument.literal.text);
    }
    node.forEachChild(visit);
  };
  // TYPE-ONLY IMPORTS ARE FOLLOWED AND CHECKED TOO. They vanish at runtime, so following them can
  // only over-approximate the closure — and over-approximating fails CLOSED, which is the only
  // direction a purity guard is allowed to be wrong in.
  visit(sourceFile);
  return specifiers;
}

/** The banned specifiers in one file, judged by package prefix and by resolved location in `src/`. */
export function bannedImportsIn(fileName: string, source: string): string[] {
  return importSpecifiersOf(fileName, stripComments(source, fileName)).filter((specifier) => {
    if (BANNED_PACKAGE_PREFIXES.some((p) => specifier === p || specifier.startsWith(p))) return true;
    const fromSrc = srcRelativeOf(fileName, specifier);
    if (fromSrc === null) return false;
    return BANNED_DIR_PREFIXES.some((p) => fromSrc.startsWith(p));
  });
}

/**
 * Where a specifier POINTS, relative to `src/` — without asking whether the file exists.
 *
 * Deliberately separate from `resolveWithinSrc`: the ban is about the layer being reached, and a
 * banned import must be flagged whether or not the target resolves on disk today. Tying the ban to
 * existence would let a typo'd or not-yet-created `../services/…` import pass the guard, which is
 * the guard failing OPEN on exactly the change it exists to catch.
 */
function srcRelativeOf(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else if (specifier.startsWith('@/')) base = resolve(SRC_ROOT, specifier.slice(2));
  else return null;
  const fromSrc = relative(SRC_ROOT, base).split('\\').join('/');
  return fromSrc.startsWith('..') ? null : fromSrc;
}

/** The clock reads in one file. */
export function clockReadsIn(fileName: string, source: string): string[] {
  const stripped = stripComments(source, fileName);
  return CLOCK_READS.filter((pattern) => pattern.test(stripped)).map((pattern) => pattern.source);
}

/**
 * Every function in the file that TAKES A `Date`.
 *
 * This is D37's real reason, spelled out. The adjudication struck v1's mirrorability constraint on
 * the grounds that `computeDuePeriods` "does `Date` arithmetic" — it does not, and the plan says so
 * on the record. What actually makes it unusable here is its SIGNATURE: `computeDuePeriods(item,
 * today: Date)`. A module in this closure that accepts a `Date` has handed its month boundary to
 * whatever timezone the caller's `Date` was built in, which is exactly the class of bug that
 * corrupted two months of cost-gate counters before `Asia/Jerusalem` was pinned. Periods enter this
 * closure as `'YYYY-MM'` strings or not at all.
 */
export function dateParametersIn(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    stripComments(source, fileName),
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const offenders: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) && node.type && node.type.getText(sourceFile).trim() === 'Date') {
      offenders.push(node.getText(sourceFile).trim());
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return offenders;
}

/** Resolves a relative or `@/`-aliased specifier to a real file under `src/`, or `null`. */
function resolveWithinSrc(fromFile: string, specifier: string): string | null {
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

const readFromDisk = (file: string): string => readFileSync(file, 'utf8');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// non-vacuity FIRST — every checker proven to fire on a synthetic input built to break it
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('the checkers can fail — proven on synthetic sources before they are aimed at the tree', () => {
  const here = join(SRC_ROOT, 'utils/synthetic.ts');

  it('flags a firebase import', () => {
    expect(bannedImportsIn(here, "import { getDocs } from 'firebase/firestore';")).toEqual(['firebase/firestore']);
  });

  it('flags a services import through a relative path', () => {
    expect(bannedImportsIn(here, "import { x } from '../services/RecurringService';")).toEqual(['../services/RecurringService']);
  });

  it('flags a components import through the @/ alias', () => {
    expect(bannedImportsIn(here, "import X from '@/components/Explain';")).toEqual(['@/components/Explain']);
  });

  it('flags a contexts import', () => {
    expect(bannedImportsIn(here, "import { useFilters } from '../contexts/FilterContext';")).toEqual(['../contexts/FilterContext']);
  });

  it('flags a banned import even when it is TYPE-ONLY — over-approximating fails closed', () => {
    expect(bannedImportsIn(here, "import type { Firestore } from 'firebase/firestore';")).toHaveLength(1);
  });

  it('flags a banned import hidden in a re-export or a dynamic import', () => {
    expect(bannedImportsIn(here, "export { db } from '../services/db';")).toHaveLength(1);
    expect(bannedImportsIn(here, "const m = await import('firebase/app');")).toHaveLength(1);
  });

  it('does NOT flag the pure utils and types the forecast legitimately uses', () => {
    expect(bannedImportsIn(here, "import { periodOf } from './periodMath';")).toEqual([]);
    expect(bannedImportsIn(here, "import type { Account } from '../types/finance';")).toEqual([]);
  });

  it('flags all four clock reads', () => {
    expect(clockReadsIn(here, 'const t = new Date();')).toHaveLength(1);
    expect(clockReadsIn(here, "const t = new Date('2026-01-01');")).toHaveLength(1);
    expect(clockReadsIn(here, 'const t = Date.now();')).toHaveLength(1);
    expect(clockReadsIn(here, 'const t = Date.UTC(2026, 0, 1);')).toHaveLength(1);
    expect(clockReadsIn(here, "new Intl.DateTimeFormat('en-CA', {});")).toHaveLength(1);
  });

  it('does not flag a clock read that only appears in a COMMENT — the stripper is load-bearing', () => {
    // The inverse matters more than it looks: a broken stripper that DELETES real code would make
    // every negative assertion below pass by not seeing the code at all.
    expect(clockReadsIn(here, '// nothing here may call new Date()\nconst x = 1;')).toEqual([]);
    expect(clockReadsIn(here, '/* Date.now() is banned */\nconst x = 1;')).toEqual([]);
  });

  it('does not flag an unrelated identifier that merely contains the word', () => {
    expect(clockReadsIn(here, 'const updatedAt = row.balanceUpdatedAt;')).toEqual([]);
    expect(clockReadsIn(here, 'const dateStr = item.date;')).toEqual([]);
  });

  it('flags a `Date` PARAMETER — the actual reason computeDuePeriods is unusable here', () => {
    expect(dateParametersIn(here, 'export function f(item: X, today: Date): string[] { return []; }'))
      .toEqual(['today: Date']);
    expect(dateParametersIn(here, 'const g = (d: Date) => d;')).toHaveLength(1);
  });

  it('does not flag a `Date` parameter that only appears in a comment or a string', () => {
    expect(dateParametersIn(here, '// f(today: Date) is banned\nconst x = 1;')).toEqual([]);
  });

  it("does not flag a period STRING parameter, which is how time is supposed to enter", () => {
    expect(dateParametersIn(here, 'export function f(anchorPeriod: string, todayPeriod: string) { return 1; }'))
      .toEqual([]);
    expect(dateParametersIn(here, "export function f(dateStr: string | undefined | null) { return 1; }"))
      .toEqual([]);
  });

  it('the closure walk is genuinely TRANSITIVE — a three-hop synthetic chain', () => {
    // The hole a one-level scan leaves: `forecast.ts` stays clean and imports a helper that imports
    // firebase. Driven from an injected reader, so this proves the WALK rather than the tree.
    const a = join(SRC_ROOT, 'utils/a.ts');
    const b = join(SRC_ROOT, 'utils/b.ts');
    const sources: Record<string, string> = {
      [a]: "import { x } from './periodMath';\nimport { y } from './transactionFilters';",
      [b]: '',
    };
    const closure = collectImportClosure(a, (file) => sources[file] ?? readFromDisk(file));
    expect(closure).toContain(join(SRC_ROOT, 'utils/periodMath.ts'));
    // periodMath imports transactionFilters, so a two-hop walk reaches it from a even though `a`
    // named it directly too — the third hop is what proves transitivity:
    expect(collectImportClosure(join(SRC_ROOT, 'utils/periodMath.ts'), readFromDisk))
      .toContain(join(SRC_ROOT, 'utils/transactionFilters.ts'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the real tree
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("forecast.ts's transitive closure is pure (D37)", () => {
  const closure = collectImportClosure(FORECAST_ENTRY, readFromDisk);
  const named = closure.map((file) => relative(SRC_ROOT, file).split('\\').join('/'));

  it('the closure is non-empty and reaches beyond the entry file — otherwise the bans below are vacuous', () => {
    expect(named).toContain('utils/forecast.ts');
    expect(named).toContain('utils/periodMath.ts');
    // Two hops: forecast -> periodMath -> transactionFilters. If the walk stopped at one level the
    // whole guard would be a single-file scan wearing a closure's name.
    expect(named).toContain('utils/transactionFilters.ts');
    expect(closure.length).toBeGreaterThanOrEqual(3);
  });

  it('imports nothing from firebase, services, contexts or components — anywhere in the closure', () => {
    const offenders = closure.flatMap((file) =>
      bannedImportsIn(file, readFromDisk(file)).map((s) => `${relative(SRC_ROOT, file)} -> ${s}`)
    );
    expect(offenders).toEqual([]);
  });

  it('reads no clock — anywhere in the closure', () => {
    const offenders = closure.flatMap((file) =>
      clockReadsIn(file, readFromDisk(file)).map((p) => `${relative(SRC_ROOT, file)} -> ${p}`)
    );
    expect(offenders).toEqual([]);
  });

  it('no function in the closure TAKES a Date — periods enter as strings or not at all', () => {
    const offenders = closure.flatMap((file) =>
      dateParametersIn(file, readFromDisk(file)).map((p) => `${relative(SRC_ROOT, file)} -> ${p}`)
    );
    expect(offenders).toEqual([]);
  });

  it('does NOT import computeDuePeriods — it cannot project forward, and reuse is banned by name (D22/A9)', () => {
    const source = stripComments(readFromDisk(FORECAST_ENTRY), FORECAST_ENTRY);
    const importedFromCatchup = importSpecifiersOf(FORECAST_ENTRY, source).some((s) => s.includes('recurringCatchup'));
    expect(importedFromCatchup).toBe(false);
    expect(source).not.toContain('computeDuePeriods');
  });

  it('takes the current period as a PARAMETER — proven by behaviour, not by reading the signature', () => {
    // The source-level ban above proves time cannot enter through a clock. This proves it DOES
    // enter through the parameter: same anchor, two different "todays", two different answers. A
    // module that ignored `todayPeriod` and read a clock internally would pass one check and fail
    // this one, and vice versa — the pair is what makes D37's third clause checkable.
    const args = { anchorPeriod: '2026-03', horizonMonths: 1, lineItems: [] };
    expect(composeForecast({ ...args, todayPeriod: '2026-08' }).anchorPeriod).toBe('2026-08');
    expect(composeForecast({ ...args, todayPeriod: '2027-01' }).anchorPeriod).toBe('2027-01');
  });
});
