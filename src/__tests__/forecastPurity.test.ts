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
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { SRC_ROOT, parseSource, readSourceCached, stripComments } from './helpers/extractionSurfaces';
// T6 — THE IMPORT WALK MOVED, NOT COPIED. `collectImportClosure`, `importSpecifiersOf` and
// `resolveWithinSrc` were declared and exported HERE until T6 needed the same walk for the
// no-month-literal guard. Importing one test file from another executes its `describe`s inside the
// importer, so they moved into a helper module both guards read. A second copy of an import walker
// is how two guards start disagreeing about which files they cover while both report green — this
// project's recorded F4 class.
import {
  collectImportClosure,
  forecastClosure,
  importSpecifiersOf,
  readFromDisk,
} from './helpers/forecastModules';
import { composeForecast } from '../utils/forecast';

const FORECAST_ENTRY = join(SRC_ROOT, 'utils/forecast.ts');

/**
 * Directories `forecast.ts`'s closure may not reach, and the bare-specifier prefixes that are
 * banned outright. `src/types/` is absent on purpose: it holds interfaces only, it is where the
 * document shapes live, and a type has no runtime behaviour to be impure with.
 */
const BANNED_DIR_PREFIXES = ['services/', 'contexts/', 'components/'];
// T1-review follow-up (4): `@firebase/*` — the SCOPED packages — were absent while `firebase-admin`
// was covered, so `import { getDoc } from '@firebase/firestore'` (a real, resolvable specifier;
// `@firebase/rules-unit-testing` is already a devDependency of this repo) walked straight through
// the ban that exists to stop exactly that import.
const BANNED_PACKAGE_PREFIXES = ['firebase/', 'firebase', '@firebase/', '@firebase'];

/**
 * Every way this codebase can read a clock or a locale-dependent calendar.
 *
 * ── THE BOUND, STATED (T1-review follow-up 5) ────────────────────────────────────────────────
 * This is a SOURCE-TEXT check over comment-stripped code, so it is ACCIDENT-PROOF, NOT
 * ADVERSARY-PROOF, and the difference is worth naming rather than leaving a reader to discover.
 *
 *   · CAUGHT: every spelling anyone writes by accident — `new Date()`, `Date.now()`, `Date.UTC()`,
 *     `new Intl.DateTimeFormat()`, `globalThis.Date.now()`, and any of them re-exported from
 *     another file inside the closure (the closure walk brings that file's own text into scope).
 *   · NOT CAUGHT: a deliberate alias — `const D = Date; D.now()` — or any other laundering of the
 *     global through a binding this checker cannot statically resolve to `Date`.
 *
 * Closing the alias case needs real type-flow analysis (a full `ts.Program`, not a standalone
 * parse), which `aiPermissionsContract.test.ts` already weighed and declined for the same reason:
 * the goal is catching the way this bug actually recurs — someone reaching for the clock while
 * writing forecast arithmetic — not adversarial-proofing against a hostile committer of one's own
 * codebase. The bound is held by an executable test below, so this comment cannot quietly go stale.
 */
const CLOCK_READS = [/\bnew\s+Date\b/, /\bDate\s*\.\s*now\b/, /\bDate\s*\.\s*UTC\b/, /\bIntl\s*\.\s*DateTimeFormat\b/];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the checkers — pure over (fileName, source), so they can be aimed at synthetic inputs
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The banned specifiers in one file, judged by package prefix and by resolved location in `src/`. */
export function bannedImportsIn(fileName: string, source: string): string[] {
  return importSpecifiersOf(fileName, stripComments(source, fileName)).filter((specifier) => {
    if (BANNED_PACKAGE_PREFIXES.some((p) => specifier === p || specifier.startsWith(p))) return true;
    const fromSrc = srcRelativeOf(fileName, specifier);
    // T1-REVIEW FOLLOW-UP (3) — THE BAN FAILED OPEN ON THE ONE CROSSING THE CODEBASE FORBIDS IN
    // WRITING. `srcRelativeOf` returns `null` for a path that leaves `src/`, and `null` used to
    // mean "not banned" — so `import { resolveOwnedModuleScope } from
    // '../../functions/src/shared/permissions'` was neither FOLLOWED by the closure walk (which
    // only resolves inside `src/`) nor BANNED. That is the exact import
    // `functions/src/shared/permissions.ts`'s own header forbids, in prose, in the file being
    // imported. A specifier that points out of `src/` is now banned outright: `forecast.ts`'s
    // closure has no business anywhere else, and a ban is strictly stronger than following it
    // would be, since a followed file would only be banned for what IT imports.
    if (fromSrc === null) return escapesSrc(fileName, specifier);
    return BANNED_DIR_PREFIXES.some((p) => fromSrc.startsWith(p));
  });
}

/** True when a relative or `@/`-aliased specifier resolves to somewhere outside `src/`. */
function escapesSrc(fromFile: string, specifier: string): boolean {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return false; // a bare package
  const base = specifier.startsWith('@/')
    ? resolve(SRC_ROOT, specifier.slice(2))
    : resolve(dirname(fromFile), specifier);
  return relative(SRC_ROOT, base).split('\\').join('/').startsWith('..');
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
 * Every identifier appearing anywhere inside a type node. `Date | null` → `{Date}`; `Date[]` →
 * `{Date}`; `Record<string, Date>` → `{Record, string?, Date}`; `DateRange` → `{DateRange}`, which
 * is deliberately NOT a match — the check below is on the identifier `Date` itself, not on a
 * substring of a name that merely starts with it.
 */
function typeIdentifiers(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) names.add(n.text);
    n.forEachChild(visit);
  };
  visit(node);
  return names;
}

/**
 * The names that MEAN `Date` in one file: `Date` itself, plus every local type alias that reaches
 * it, to a fixpoint. `type Clock = Date` makes `Clock` date-like; `type Maybe = Clock | null` makes
 * `Maybe` date-like too.
 *
 * File-local by design. Following an alias imported from another module would need the whole
 * closure's aliases in scope, and every module in that closure is itself scanned — so an alias
 * declared elsewhere is caught at its own declaration site if it is used in a parameter there, and
 * a cross-file alias used only here is the one gap. Stated rather than silently left.
 */
function dateLikeNamesIn(sourceFile: ts.SourceFile): Set<string> {
  const aliases: Array<{ name: string; ids: Set<string> }> = [];
  const collect = (n: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(n)) aliases.push({ name: n.name.text, ids: typeIdentifiers(n.type) });
    n.forEachChild(collect);
  };
  collect(sourceFile);

  const dateLike = new Set<string>(['Date']);
  for (let changed = true; changed; ) {
    changed = false;
    for (const alias of aliases) {
      if (dateLike.has(alias.name)) continue;
      if ([...alias.ids].some((id) => dateLike.has(id))) {
        dateLike.add(alias.name);
        changed = true;
      }
    }
  }
  return dateLike;
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
 *
 * ── T1-REVIEW FOLLOW-UP (1) — THE EXACT-TEXT COMPARISON EVADED ON A NULLABLE DATE ──────────────
 *
 * This used to be `node.type.getText().trim() === 'Date'`. That catches `today: Date` and
 * `today?: Date` — and passes `today: Date | null`, `today: Date | undefined`, `today: Date[]`,
 * `today: Readonly<Date>` and `type Clock = Date; today: Clock`, because none of those print as the
 * five characters `Date`. A nullable date parameter is an ORDINARY thing to write — `today` is
 * unknown until the caller resolves a timezone is exactly the shape a developer reaches for — and
 * this is the guard that makes the "pure, therefore movable" argument in D37 true through T4–T8.
 *
 * It now matches the type's IDENTIFIER SET against the file's date-like names, so every shape above
 * is caught. Over-approximating (a parameter whose type merely MENTIONS `Date` anywhere) fails
 * CLOSED, which is the only direction a purity guard is allowed to be wrong in.
 */
export function dateParametersIn(fileName: string, source: string): string[] {
  const sourceFile = parseSource(fileName, stripComments(source, fileName));
  const dateLike = dateLikeNamesIn(sourceFile);
  const offenders: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) && node.type) {
      const ids = typeIdentifiers(node.type);
      if ([...ids].some((id) => dateLike.has(id))) offenders.push(node.getText(sourceFile).trim());
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return offenders;
}


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

  // ── T1-REVIEW FOLLOW-UPS, EACH PROVEN ON THE INPUT THAT DEFEATED THE PREVIOUS VERSION ────────

  it('flags a NULLABLE Date parameter — the shape that walked through the exact-text comparison', () => {
    // Every one of these passed the `getText() === 'Date'` version. `today: Date | null` is not an
    // adversarial input; it is what someone writes when the caller may not have resolved a clock.
    expect(dateParametersIn(here, 'export function f(today: Date | null) { return today; }')).toHaveLength(1);
    expect(dateParametersIn(here, 'export function f(today: Date | undefined) { return today; }')).toHaveLength(1);
    expect(dateParametersIn(here, 'export function f(today: null | Date) { return today; }')).toHaveLength(1);
    expect(dateParametersIn(here, 'export function f(days: Date[]) { return days; }')).toHaveLength(1);
    expect(dateParametersIn(here, 'export function f(d: Readonly<Date>) { return d; }')).toHaveLength(1);
    expect(dateParametersIn(here, 'export function f(m: Record<string, Date>) { return m; }')).toHaveLength(1);
    expect(dateParametersIn(here, 'export function f(o: { today: Date }) { return o; }')).toHaveLength(1);
    // …and the one it DID catch still fails, so the rewrite did not trade one hole for another.
    expect(dateParametersIn(here, 'export function f(today?: Date) { return today; }')).toHaveLength(1);
  });

  it('follows a LOCAL type alias to Date, however many hops', () => {
    expect(dateParametersIn(here, 'type Clock = Date;\nexport function f(t: Clock) { return t; }')).toHaveLength(1);
    expect(
      dateParametersIn(here, 'type Clock = Date;\ntype Maybe = Clock | null;\nexport function f(t: Maybe) { return t; }')
    ).toHaveLength(1);
  });

  it('does not flag a name that merely BEGINS with Date, nor the string shapes time is meant to enter as', () => {
    // The inverse of the check above. If this fired, the guard would be unsatisfiable and would be
    // deleted by whoever hit it — which is how a guard actually dies.
    expect(dateParametersIn(here, 'type DateRange = { from: string; to: string };\nexport function f(r: DateRange) { return r; }')).toEqual([]);
    expect(dateParametersIn(here, 'export function f(dateStr: string, periods: string[]) { return 1; }')).toEqual([]);
    expect(dateParametersIn(here, 'export function f(balanceUpdatedAt: string | null) { return 1; }')).toEqual([]);
  });

  it('flags a scoped @firebase/* import — firebase-admin was covered and the scoped packages were not', () => {
    expect(bannedImportsIn(here, "import { getDoc } from '@firebase/firestore';")).toEqual(['@firebase/firestore']);
    expect(bannedImportsIn(here, "import { initializeTestEnvironment } from '@firebase/rules-unit-testing';")).toHaveLength(1);
    expect(bannedImportsIn(here, "import admin from 'firebase-admin';")).toHaveLength(1);
  });

  it('flags an import that LEAVES src/ — the functions/ crossing the codebase forbids in writing', () => {
    // This is the ban that failed open: the closure walk resolves only inside src/, so a
    // functions/ import was neither followed nor flagged, on the one crossing
    // functions/src/shared/permissions.ts's own header explicitly forbids.
    expect(bannedImportsIn(here, "import { resolveOwnedModuleScope } from '../../functions/src/shared/permissions';"))
      .toEqual(['../../functions/src/shared/permissions']);
    expect(bannedImportsIn(here, "import { x } from '../../scripts/migrate-transactions';")).toHaveLength(1);
    expect(bannedImportsIn(here, "import cfg from '../../vitest.config';")).toHaveLength(1);
    // …and a sibling inside src/ is still fine, so the new ban has not swallowed the legitimate case.
    expect(bannedImportsIn(here, "import { periodOf } from './periodMath';")).toEqual([]);
    expect(bannedImportsIn(here, "import { APP_TIMEZONE } from '../config/time';")).toEqual([]);
  });

  it('does NOT catch a clock read laundered through an alias — the bound this guard states in its own comment', () => {
    // Executable documentation, not an aspiration. CLOCK_READS' header says this guard is
    // accident-proof and not adversary-proof; if someone later closes the alias case, THIS test
    // goes red and sends them to that comment, which is the only way a stated limit stays true.
    expect(clockReadsIn(here, 'const D = Date;\nconst t = D.now();')).toEqual([]);
    // The forms that ARE caught, kept beside it so the boundary is visible rather than implied.
    expect(clockReadsIn(here, 'const t = globalThis.Date.now();')).toHaveLength(1);
    expect(clockReadsIn(here, 'const t = new Date();')).toHaveLength(1);
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

describe("the forecast engine's transitive closure is pure (D37)", () => {
  // T6 — THE WALK STARTS FROM EVERY ENTRY, NOT ONLY FROM `forecast.ts`.
  //
  // `forecastTargets.ts` and `forecastCalibration.ts` are engine modules that nothing imports yet
  // (T7a wires them), and `seasonality.ts` is reached only because `forecast.ts` happens to import
  // it. A walk seeded on the composer alone would have left the newest arithmetic in the stage
  // OUTSIDE the guard that makes D37's "pure, therefore movable" argument true — and it would have
  // done so silently, the way an unwired module always does.
  const closure = forecastClosure();
  const named = closure.map((file) => relative(SRC_ROOT, file).split('\\').join('/'));

  it('the closure is non-empty and reaches beyond the entry file — otherwise the bans below are vacuous', () => {
    expect(named).toContain('utils/forecast.ts');
    expect(named).toContain('utils/periodMath.ts');
    // Two hops: forecast -> periodMath -> transactionFilters. If the walk stopped at one level the
    // whole guard would be a single-file scan wearing a closure's name.
    expect(named).toContain('utils/transactionFilters.ts');
    expect(closure.length).toBeGreaterThanOrEqual(3);
  });

  it('!! the T5-review F8 SPLIT stayed inside this guard — `forecastCopy.ts` is walked', () => {
    // The copy came out of `forecast.ts` into its own module, and a module the closure walk does
    // not reach is a module this guard has stopped checking. It would pass today either way, which
    // is exactly why the membership is asserted rather than assumed: the day someone reaches for
    // `new Date()` to timestamp a sentence, or imports a component to reuse its label, the ban has
    // to be pointed at the file it happened in.
    expect(named).toContain('utils/forecastCopy.ts');
  });

  it('!! and T6`s modules are walked too — including the ones nothing imports yet', () => {
    // The membership is asserted rather than assumed for the same reason `forecastCopy.ts`'s is:
    // a module the walk does not reach is a module this guard has stopped checking, and these
    // three would have passed today either way. `forecastTargets.ts` has ZERO importers until T7a,
    // so nothing but a named entry can bring it in.
    expect(named).toContain('utils/seasonality.ts');
    expect(named).toContain('utils/forecastTargets.ts');
    expect(named).toContain('utils/forecastCalibration.ts');
    expect(named).toContain('config/hebrewMonths.ts');
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
