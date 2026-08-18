// Stage 7 T3 (D21e / A8) — THE STRUCTURAL ASSERTION: every writer of `transaction_lines`, in
// `src/` AND in `scripts/`, produces `period` AND `ownerId`.
//
// ── WHY THIS GUARD EXISTS AND WHAT THE OLD ONE COULD NOT SEE ─────────────────────────────────
//
// `transactionWriteGuard.test.ts` answers "WHICH FILES may write to `transaction_lines`". It
// cannot answer "does the row they write carry the two fields the read path queries on", and that
// is the question this task turns on: a row without `period` is invisible to
// `where('period','in',[…])`, absent from the `'own'` query, and PAST THE REACH OF THE ONE-SHOT
// COMPLETION MARKER — the marker says the backfill finished, and says nothing at all about rows
// written afterwards. The plan's v2 stamped only inside `migrateLegacyTransaction`, calling it
// "the one place that already constructs a row"; it is the LEGACY converter with a single non-test
// caller, and every row the app wrote after that would have been born unstamped.
//
// ── AND WHY IT COVERS `scripts/` AS WELL AS `src/` ───────────────────────────────────────────
//
// A8: `transactionWriteGuard`'s `SRC_ROOT` never scans `scripts/`, so `migrate-transactions.ts` —
// a real `transaction_lines` writer using the Admin SDK — has always been invisible to it, and
// `scripts/backfill-transaction-periods.ts` is now a second one. That blind spot is about FILE
// MEMBERSHIP and this guard does NOT remove it (it adds a field check, not an allow-list); it is
// recorded in that file's own header. What scoping this guard to `scripts/` ALONE would do is
// guard the directory the bug is not in — v2.1's own words — since the defect that actually
// happened was in `src/`. It covers both trees.
//
// ── WHAT COUNTS AS A WRITER, AND THE TWO ESCAPE HATCHES ──────────────────────────────────────
//
// A write call whose payload RESOLVES to an object literal — inline, or through a single binding
// in the same file — is checked directly: both keys must be present at the literal's top level. A
// payload that cannot be resolved is an INDIRECT write (the row was built somewhere else); a call
// whose COLLECTION cannot be resolved is a DYNAMIC write (no walk can say which collection it
// writes at all). Neither is waved through: each must be listed below WITH THE FILE THAT
// CONSTRUCTS ITS ROW, and the guard then checks that file's own object literal. The escape hatches
// redirect the check; they do not remove it — and a listed file the guard never reaches is itself
// a failure, which is how the dead `backfill-transaction-periods.ts` entry came to light.
//
// ── AND HOW IT DECIDES A CALL IS EVEN ABOUT THIS COLLECTION (T3 review F2) ────────────────────
//
// Through `collectionAliases`/`referencesCollection` in the shared helper, not by looking for the
// literal `'transaction_lines'` in the call's own subtree. The literal-only version walked past a
// hoisted `const ref = collection(db, 'transaction_lines')` and past this repo's OWN exported
// `TRANSACTION_LINES_COLLECTION`, and a guard that reports zero offenders because it could not see
// the writes is indistinguishable from a clean tree. The technique is shared because
// `forecastAssumptions.test.ts` had the identical hole on `audit_log` and had already grown a
// hand-written text check to work around it.
//
// AST-derived and `stripComments`-based, through the SHARED helper — this repo has hand-rolled a
// lexer for this three times and had a real bypass reopened by the third (see
// `helpers/extractionSurfaces.ts`'s own header). No fourth.
//
// !! ONE HONEST QUALIFICATION, from T3's own mutation sweep. Removing the `stripComments` call
// SURVIVES here, and that is not a hole: the required fields are read off the AST as PROPERTY
// NAMES, and a comment is TRIVIA to the TypeScript parser — it never becomes a property whether it
// was blanked or not. So for this guard the strip is belt-and-braces (it also keeps the cheap text
// prefilter below from waking on a file that merely MENTIONS `transaction_lines` in prose), not
// the load-bearing defence it is for the text-matching guards in this family. Said plainly,
// because "comments are stripped, therefore comment-satisfiability is closed" would be an unheld
// claim — and the probe below documents the property without being what proves it.
import { describe, expect, it } from 'vitest';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
import {
  REPO_ROOT,
  SRC_ROOT,
  collectionAliases,
  listSourceFiles,
  parseSource,
  readSourceCached,
  referencesCollection,
  resolveObjectLiteral,
  stringConstantBindings,
  stripComments,
} from './helpers/extractionSurfaces';
import { TRANSACTION_LINES_COLLECTION } from '../services/TransactionHistoryService';

const SCRIPTS_ROOT = join(REPO_ROOT, 'scripts');
const TARGET_COLLECTION = 'transaction_lines';

/**
 * D23(b)'s half. `incomes` gets a `period` too, and it MUST come from the `month`/`year` pair —
 * `Dashboard.handleSaveIncomes` writes those two from the UI's SELECTED FILTER while `date` is
 * free text, and `CentralExpenseReport` already queries on them, so a `periodOf(date)` stamp would
 * silently move rows between months on a screen somebody is looking at.
 *
 * This is checked STRUCTURALLY because it cannot be checked any other way: `incomes` has no
 * service layer, no schema, no screen of its own and no validator in Rules beyond
 * `amount is number`, and T0 measured the collection as ABSENT — 0 documents — so there is no data
 * that could exercise the difference and no seam to unit-test the Dashboard's writer through. What
 * IS checkable is that the initializer names the right function.
 */
const INCOMES_COLLECTION = 'incomes';
const INCOMES_PERIOD_SOURCE = 'periodOrUnknownFromMonthYear';

/** The two fields D21 adds. Both, in the same literal — either alone leaves the row half-blind. */
const REQUIRED_FIELDS = ['period', 'ownerId'] as const;

/**
 * The last name segment of a Firestore write call, client SDK or Admin SDK. `set`/`update` alone
 * covers `batch.set`, `batch.update`, `tx.set`, `docRef.set` and `docRef.update` — deliberately
 * broad, because a guard that enumerates receiver names is a guard an alias walks past, which is
 * the exact hole `transactionWriteGuard` had reopened on it once already.
 */
const WRITE_CALL_NAMES = new Set(['addDoc', 'setDoc', 'updateDoc', 'set', 'update']);

/**
 * INDIRECT WRITERS — a write call whose payload is a variable, plus the file that builds it.
 *
 * Every entry is a redirection, not an exemption: the named constructor is then checked for the
 * same two fields. An entry naming a file that does not stamp them fails just as loudly as an
 * unstamped inline literal.
 */
const INDIRECT_TRANSACTION_LINE_WRITERS: Record<string, string> = {
  // `batch.set(ref, line)` where `line` came from the pure legacy converter, which stamps both.
  'scripts/migrate-transactions.ts': 'src/utils/migrateLegacyTransaction.ts',
  // Stage 7 T4 — `batch.set(db.collection('transaction_lines').doc(row.id), row)`, where `row` is
  // built by the pure generator. The redirect is what makes the generator's row literal subject to
  // this guard, and the generator stamps both fields THROUGH `periodOrUnknown`/`ownerIdOrUnknown`
  // rather than as literals — so a corpus that stopped exercising the `'unknown'` paths would fail
  // its own condition tests rather than quietly satisfy this one.
  'scripts/seed-demo-finances.ts': 'src/utils/demoCorpus.ts',
};

/**
 * WRITERS WHOSE COLLECTION IS COMPUTED, and the file that builds their row.
 *
 * !! THIS TABLE EXISTS BECAUSE THE ENTRY IT REPLACES HAD NEVER FIRED (T3 review F2).
 * `scripts/backfill-transaction-periods.ts` was listed as an INDIRECT writer redirecting at
 * itself — and its write is `batch.update(db.collection(write.collection).doc(write.id),
 * write.patch)`, whose collection comes off `PlannedPatch.collection`, a three-way union. There is
 * no string literal in that call, so the guard never matched it, so the entry never redirected
 * anything, so nothing about the backfill's own patches was ever checked. A dead entry in an
 * allow-list reads exactly like a live one.
 *
 * `'dynamic'` is now a classification of its own rather than a silence: the write is reported, the
 * file must appear here, and the constructor it names is checked for both fields — which for the
 * backfill is `src/utils/backfillPlan.ts`, where `patch: { period, ownerId }` actually lives and
 * where it is unit-tested. The `noDeadEntries` assertion below is what stops this table rotting
 * the same way.
 */
const DYNAMIC_COLLECTION_WRITERS: Record<string, string> = {
  'scripts/backfill-transaction-periods.ts': 'src/utils/backfillPlan.ts',
};

interface RowWrite {
  file: string;
  line: number;
  /**
   * `'inline'`   — the row is readable at (or from) the call site;
   * `'indirect'` — the payload was built somewhere this file cannot show;
   * `'dynamic'`  — the COLLECTION itself is computed, so no walk can say which one it writes.
   */
  kind: 'inline' | 'indirect' | 'dynamic';
  missing: string[];
}

const rel = (full: string): string => relative(REPO_ROOT, full).replace(/\\/g, '/');

/** Top-level property names of an object literal, spreads excluded — a spread hides nothing here on purpose. */
function propertyNames(literal: ts.ObjectLiteralExpression, sourceFile: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const prop of literal.properties) {
    if (ts.isSpreadAssignment(prop)) continue;
    const name = prop.name;
    if (name === undefined) continue;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) names.push(name.text);
    else names.push(name.getText(sourceFile));
  }
  return names;
}

function calleeLastName(node: ts.CallExpression, sourceFile: ts.SourceFile): string | null {
  const expr = node.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.getText(sourceFile);
  return null;
}

/**
 * The ONLY keys a Firestore write's options bag can carry. Everything else an object literal in a
 * write call can hold is a ROW.
 *
 * !! THIS REPLACES A ROW-SHAPED-KEY ALLOW-LIST, AND THE DIRECTION IS THE WHOLE POINT (T3 review
 * F2). The previous version selected the first literal carrying one of
 * `date`/`amount`/`period`/`month`/`year` — so a row literal carrying NONE of them
 * (`{ description, category }`) matched nothing, was not even classified `indirect`, and was
 * skipped entirely. An allow-list of what a row looks like fails OPEN on every row that does not
 * look like the list; a deny-list of what an options bag looks like cannot, because `merge` and
 * `mergeFields` are the entire vocabulary the SDK defines.
 *
 * The case that produced the old list is still held: `setDoc(ref, data, { merge: true })` — the
 * shape `Dashboard.handleSaveIncomes` uses — must read `data`, not `{ merge: true }`, and it does,
 * because `{ merge: true }` is recognised as the options bag rather than as "not row-shaped".
 */
const OPTIONS_BAG_KEYS = ['merge', 'mergeFields'];

function isOptionsBag(literal: ts.ObjectLiteralExpression, sourceFile: ts.SourceFile): boolean {
  const names = propertyNames(literal, sourceFile);
  return names.length > 0 && names.every((n) => OPTIONS_BAG_KEYS.includes(n));
}

/**
 * The payload literal of a write call: the first argument that resolves to an object literal and
 * is not the options bag.
 *
 * `resolveObjectLiteral` is what makes a variable payload readable when the row was built in the
 * same file — `const line = {…}; addDoc(ref, line)` used to be an unreadable INDIRECT write. When
 * it genuinely cannot be resolved the answer is `null`, never a guess, and the caller turns that
 * into an INDIRECT classification that must be declared.
 */
function payloadLiteral(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile
): { literal: ts.ObjectLiteralExpression; names: string[] } | null {
  for (const arg of node.arguments) {
    const literal = resolveObjectLiteral(arg, sourceFile);
    if (literal === null) continue;
    if (isOptionsBag(literal, sourceFile)) continue;
    return { literal, names: propertyNames(literal, sourceFile) };
  }
  return null;
}

/** Call names that build a Firestore reference — what tells a real write from `Map.prototype.set`. */
const REFERENCE_CALL_NAMES = new Set(['doc', 'collection']);

/** True when this expression builds a Firestore reference at all (rather than being any old value). */
function buildsFirestoreReference(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const name = calleeLastName(n, sourceFile);
      if (name !== null && REFERENCE_CALL_NAMES.has(name)) {
        found = true;
        return;
      }
    }
    n.forEachChild(visit);
  };
  visit(node);
  return found;
}

/**
 * A Firestore write whose COLLECTION is computed rather than named — `db.collection(x).doc(y)`.
 *
 * No static walk can tell which collection such a call writes, so it is neither matched nor
 * dismissed: it is reported, and the file must declare it. There is exactly one in this tree
 * (`scripts/backfill-transaction-periods.ts`, whose collection comes off `PlannedPatch.collection`,
 * a three-way union) and it was SILENTLY INVISIBLE before — its entry in the indirect table below
 * had never once fired.
 */
function hasDynamicCollectionTarget(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  aliases: ReadonlySet<string>,
  stringConstants: ReadonlyMap<string, string>
): boolean {
  const target = node.arguments[0];
  if (target === undefined) return false;
  if (!buildsFirestoreReference(target, sourceFile)) return false;
  if (referencesCollection(target, TARGET_COLLECTION, aliases)) return false;
  // A target naming SOME collection is RESOLVED — just not ours. Both spellings count: a literal,
  // and a name bound to one (`doc(db, RECURRING_COLLECTION, id)` is `recurring`, not a mystery).
  let resolved = false;
  const visit = (n: ts.Node): void => {
    if (resolved) return;
    if (ts.isStringLiteralLike(n) || (ts.isIdentifier(n) && stringConstants.has(n.text))) {
      resolved = true;
      return;
    }
    n.forEachChild(visit);
  };
  visit(target);
  return !resolved;
}

export interface IncomeWrite {
  file: string;
  line: number;
  /** `'missing'`, `'wrong-source'`, or `''` when correct. */
  problem: string;
}

/**
 * Every `incomes` row write in one file, with whether it stamps `period` and whether it does so
 * from `month`/`year`. Reads the initializer's TEXT rather than its value — a structural guard
 * cannot evaluate, and naming the wrong function is exactly the mistake being guarded against.
 */
export function findIncomeWrites(filePath: string): IncomeWrite[] {
  const fileName = rel(filePath);
  const stripped = stripComments(readSourceCached(filePath), fileName);
  if (!stripped.includes(INCOMES_COLLECTION)) return [];

  const sourceFile = parseSource(fileName, stripped);
  const aliases = collectionAliases(sourceFile, filePath, INCOMES_COLLECTION);
  const writes: IncomeWrite[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeLastName(node, sourceFile);
      if (name !== null && WRITE_CALL_NAMES.has(name) && referencesCollection(node, INCOMES_COLLECTION, aliases)) {
        const payload = payloadLiteral(node, sourceFile);
        if (payload !== null) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          const periodProp = payload.literal.properties.find(
            (prop) => prop.name !== undefined && prop.name.getText(sourceFile) === 'period'
          );
          let problem = '';
          if (periodProp === undefined) problem = 'missing';
          else if (!periodProp.getText(sourceFile).includes(INCOMES_PERIOD_SOURCE)) problem = 'wrong-source';
          writes.push({ file: fileName, line, problem });
        }
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return writes;
}

/**
 * Every `transaction_lines` row write in one file, with which of the two required fields is
 * missing. Reads only the comment-STRIPPED source, so a commented-out `period:` cannot satisfy it
 * — the comment-satisfiability bypass this whole guard family exists to close.
 */
export function findRowWrites(filePath: string): RowWrite[] {
  const fileName = rel(filePath);
  const stripped = stripComments(readSourceCached(filePath), fileName);
  if (!stripped.includes(TARGET_COLLECTION)) return [];

  const sourceFile = parseSource(fileName, stripped);
  // T3 review F2 — the collection is whatever DENOTES it, not only the literal spelling of it.
  // `const ref = collection(db, 'transaction_lines')` one line above the write, and this repo's
  // own exported `TRANSACTION_LINES_COLLECTION`, were both invisible before.
  const aliases = collectionAliases(sourceFile, filePath, TARGET_COLLECTION);
  const stringConstants = stringConstantBindings(sourceFile, filePath);
  const writes: RowWrite[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeLastName(node, sourceFile);
      if (name !== null && WRITE_CALL_NAMES.has(name)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        if (referencesCollection(node, TARGET_COLLECTION, aliases)) {
          // THE PAYLOAD is the first argument that resolves to an object literal and is not the
          // options bag — see `payloadLiteral`. A write whose payload cannot be resolved at all is
          // an INDIRECT write: the row was built somewhere this file cannot show, and the escape
          // hatch below redirects the check at the file that built it rather than removing it.
          const payload = payloadLiteral(node, sourceFile);
          if (payload !== null) {
            writes.push({
              file: fileName,
              line,
              kind: 'inline',
              missing: REQUIRED_FIELDS.filter((f) => !payload.names.includes(f)),
            });
          } else {
            writes.push({ file: fileName, line, kind: 'indirect', missing: [] });
          }
        } else if (hasDynamicCollectionTarget(node, sourceFile, aliases, stringConstants)) {
          writes.push({ file: fileName, line, kind: 'dynamic', missing: [] });
        }
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return writes;
}

/** Whether a constructor file contains ONE object literal carrying BOTH required fields. */
export function constructsStampedRow(filePath: string): boolean {
  const fileName = rel(filePath);
  const stripped = stripComments(readSourceCached(filePath), fileName);
  const sourceFile = parseSource(fileName, stripped);

  let ok = false;
  const visit = (node: ts.Node): void => {
    if (ok) return;
    if (ts.isObjectLiteralExpression(node)) {
      const names = propertyNames(node, sourceFile);
      if (REQUIRED_FIELDS.every((f) => names.includes(f))) {
        ok = true;
        return;
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return ok;
}

function allGuardedFiles(): string[] {
  return [...listSourceFiles(SRC_ROOT), ...listSourceFiles(SCRIPTS_ROOT)];
}

describe('D21(e) — every transaction_lines writer stamps period AND ownerId (src/ AND scripts/)', () => {
  it('every INLINE row write carries both fields', () => {
    const offenders = allGuardedFiles()
      .flatMap(findRowWrites)
      .filter((w) => w.kind === 'inline' && w.missing.length > 0);

    expect(
      offenders,
      offenders.map((o) => `${o.file}:${o.line} — missing ${o.missing.join(' + ')}`).join('\n') ||
        'no offenders'
    ).toEqual([]);
  });

  it('every INDIRECT row write is declared, and the file it names actually stamps both fields', () => {
    const indirect = allGuardedFiles().flatMap(findRowWrites).filter((w) => w.kind === 'indirect');

    for (const write of indirect) {
      const constructor = INDIRECT_TRANSACTION_LINE_WRITERS[write.file];
      expect(
        constructor,
        `${write.file}:${write.line} writes transaction_lines from a variable, so the row cannot be ` +
          'read at the call site. Add it to INDIRECT_TRANSACTION_LINE_WRITERS naming the file that ' +
          'constructs its row — the entry redirects the check, it does not remove it.'
      ).toBeTypeOf('string');
      expect(constructsStampedRow(join(REPO_ROOT, constructor)), `${constructor} must build a row carrying both fields`).toBe(true);
    }
  });

  it('!! every DYNAMIC-COLLECTION write is declared too — the class whose entry had never fired', () => {
    const dynamic = allGuardedFiles().flatMap(findRowWrites).filter((w) => w.kind === 'dynamic');

    for (const write of dynamic) {
      const constructor = DYNAMIC_COLLECTION_WRITERS[write.file];
      expect(
        constructor,
        `${write.file}:${write.line} writes to a COMPUTED collection, so no walk can say whether ` +
          'it writes transaction_lines. Add it to DYNAMIC_COLLECTION_WRITERS naming the file that ' +
          'builds its patch.'
      ).toBeTypeOf('string');
      expect(constructsStampedRow(join(REPO_ROOT, constructor)), `${constructor} must build a row carrying both fields`).toBe(true);
    }
  });

  it('!! NO DEAD ENTRIES — a redirect nothing reaches is a check nobody is doing', () => {
    // The assertion that would have caught F2's own instance: `backfill-transaction-periods.ts`
    // sat in the indirect table for a whole task redirecting a write the guard never matched.
    const writes = allGuardedFiles().flatMap(findRowWrites);
    const filesWith = (kind: string) => new Set(writes.filter((w) => w.kind === kind).map((w) => w.file));
    expect([...Object.keys(INDIRECT_TRANSACTION_LINE_WRITERS)].filter((f) => !filesWith('indirect').has(f))).toEqual([]);
    expect([...Object.keys(DYNAMIC_COLLECTION_WRITERS)].filter((f) => !filesWith('dynamic').has(f))).toEqual([]);
  });

  it('!! IT ACTUALLY SEES THE FOUR LIVE WRITE SITES — the assertions above are not vacuous', () => {
    // The failure mode of every guard in this family: passing because it found nothing to check.
    // v2.1 named the four sites explicitly, so the guard is held to finding all four.
    const inline = allGuardedFiles().flatMap(findRowWrites).filter((w) => w.kind === 'inline');
    const byFile = new Map<string, number>();
    for (const w of inline) byFile.set(w.file, (byFile.get(w.file) ?? 0) + 1);

    expect(byFile.get('src/utils/FileProcessor.ts')).toBe(2);
    expect(byFile.get('src/services/RecurringService.ts')).toBe(1);
    expect(inline.length).toBeGreaterThanOrEqual(3);
  });

  it('migrateLegacyTransaction — the fourth site — stamps both, and it is reached through the redirect', () => {
    expect(constructsStampedRow(join(REPO_ROOT, 'src/utils/migrateLegacyTransaction.ts'))).toBe(true);
    expect(INDIRECT_TRANSACTION_LINE_WRITERS['scripts/migrate-transactions.ts']).toBe(
      'src/utils/migrateLegacyTransaction.ts'
    );
  });

  it('the scripts/ half is not empty — A8s blind spot is a directory this guard actually walks', () => {
    const scriptFiles = listSourceFiles(SCRIPTS_ROOT).map(rel);
    expect(scriptFiles).toContain('scripts/migrate-transactions.ts');
    expect(scriptFiles).toContain('scripts/backfill-transaction-periods.ts');
  });
});

describe("D23(b) — every incomes writer stamps period, and from month/year rather than from date", () => {
  it('every income row write carries a period derived from the month/year pair', () => {
    const offenders = allGuardedFiles()
      .flatMap(findIncomeWrites)
      .filter((w) => w.problem !== '');

    expect(
      offenders,
      offenders
        .map((o) =>
          o.problem === 'missing'
            ? `${o.file}:${o.line} — no \`period\``
            : `${o.file}:${o.line} — \`period\` is not derived from ${INCOMES_PERIOD_SOURCE}; deriving ` +
              'it from `date` moves rows between months on a screen that queries month/year'
        )
        .join('\n') || 'no offenders'
    ).toEqual([]);
  });

  it('!! IT SEES THE TWO LIVE INCOME WRITERS — the assertion above is not vacuous', () => {
    // `Dashboard.handleSaveIncomes` writes twice (the edit path and the add path) and
    // `RecurringService`'s income branch once. If a refactor moves them behind a helper this test
    // goes red, which is the correct outcome: the guard would otherwise silently stop looking.
    const writes = allGuardedFiles().flatMap(findIncomeWrites);
    const byFile = new Map<string, number>();
    for (const w of writes) byFile.set(w.file, (byFile.get(w.file) ?? 0) + 1);
    expect(byFile.get('src/components/Dashboard.tsx')).toBe(2);
    expect(byFile.get('src/services/RecurringService.ts')).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// NON-VACUITY — each branch fires against synthetic source, so the green run above is a fact
// about the tree rather than about the detector. Written stub-first, before the guard was.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

function withProbe(contents: string, fn: (path: string) => void, sibling?: string): void {
  // A temp directory, NEVER a probe file written into `src/`: vitest runs test files in parallel,
  // and a file appearing under src/ mid-run changes what every other tree-walk guard sees —
  // manufacturing exactly the intermittent, different-set-each-run failure T2 removed.
  const dir = mkdtempSync(join(tmpdir(), 'stamp-guard-'));
  try {
    const path = join(dir, 'probe.ts');
    if (sibling !== undefined) writeFileSync(path, `${sibling}\n${contents}`, 'utf8');
    else writeFileSync(path, contents, 'utf8');
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the guard fires — synthetic probes', () => {
  it('catches an inline write missing ownerId', () => {
    withProbe(
      [
        "import { addDoc, collection } from 'firebase/firestore';",
        "await addDoc(collection(db, 'transaction_lines'), { date: d, amount: 1, period: p });",
      ].join('\n'),
      (path) => {
        const [write] = findRowWrites(path);
        expect(write.kind).toBe('inline');
        expect(write.missing).toEqual(['ownerId']);
      }
    );
  });

  it('catches an inline write missing period', () => {
    withProbe(
      [
        "import { addDoc, collection } from 'firebase/firestore';",
        "await addDoc(collection(db, 'transaction_lines'), { date: d, amount: 1, ownerId: o });",
      ].join('\n'),
      (path) => {
        expect(findRowWrites(path)[0].missing).toEqual(['period']);
      }
    );
  });

  it('accepts an inline write carrying both', () => {
    withProbe(
      [
        "import { addDoc, collection } from 'firebase/firestore';",
        "await addDoc(collection(db, 'transaction_lines'), { date: d, amount: 1, period: p, ownerId: o });",
      ].join('\n'),
      (path) => {
        expect(findRowWrites(path)[0].missing).toEqual([]);
      }
    );
  });

  it('a commented-out field does not satisfy it', () => {
    // TRUE, and worth pinning — but see this file's header: it holds because a comment is trivia
    // to the parser and never becomes a property, NOT because `stripComments` ran. The sweep
    // confirmed removing the strip changes nothing here.
    withProbe(
      [
        "import { addDoc, collection } from 'firebase/firestore';",
        "await addDoc(collection(db, 'transaction_lines'), {",
        '  date: d,',
        '  amount: 1,',
        '  // period: p,',
        '  ownerId: o,',
        '});',
      ].join('\n'),
      (path) => {
        expect(findRowWrites(path)[0].missing).toEqual(['period']);
      }
    );
  });

  it('!! A FIELD NAME INSIDE A STRING LITERAL DOES NOT SATISFY IT EITHER', () => {
    // The other half of "the guard reads structure, not text". A text-matching implementation
    // would accept this row; reading property names off the AST cannot.
    withProbe(
      [
        "import { addDoc, collection } from 'firebase/firestore';",
        "await addDoc(collection(db, 'transaction_lines'), { date: d, amount: 1, description: 'period: p, ownerId: o' });",
      ].join('\n'),
      (path) => {
        expect(findRowWrites(path)[0].missing).toEqual(['period', 'ownerId']);
      }
    );
  });

  it('sees the Admin SDK shape too — batch.set(db.collection(…).doc(…), {…})', () => {
    withProbe(
      ["batch.set(db.collection('transaction_lines').doc(id), { date: d, amount: 1 });"].join('\n'),
      (path) => {
        expect(findRowWrites(path)[0].missing).toEqual(['period', 'ownerId']);
      }
    );
  });

  it('sees the client batch shape — batch.set(doc(db, "transaction_lines", id), {…})', () => {
    withProbe(
      ["batch.set(doc(db, 'transaction_lines', postId), { date: d, amount: 1, period: p });"].join('\n'),
      (path) => {
        expect(findRowWrites(path)[0].missing).toEqual(['ownerId']);
      }
    );
  });

  it('!! READS THE PAYLOAD, NOT THE OPTIONS BAG — setDoc(ref, data, { merge: true })', () => {
    // The regression probe for the detector bug this file's own count assertion found. Taking the
    // LAST object literal hands back `{ merge: true }`, which has no row-shaped key, so the write
    // is classified as "not a row" and skipped — a guard failing OPEN on a call shape the tree
    // actually uses.
    withProbe(
      [
        "import { setDoc, doc } from 'firebase/firestore';",
        "await setDoc(doc(db, 'transaction_lines', id), { date: d, amount: 1 }, { merge: true });",
      ].join('\n'),
      (path) => {
        const [write] = findRowWrites(path);
        expect(write.kind).toBe('inline');
        expect(write.missing).toEqual(['period', 'ownerId']);
      }
    );
  });

  it('classifies a variable payload as INDIRECT rather than passing it silently', () => {
    withProbe(
      ["batch.set(db.collection('transaction_lines').doc(id), line);"].join('\n'),
      (path) => {
        const [write] = findRowWrites(path);
        expect(write.kind).toBe('indirect');
      }
    );
  });

  it('!! A SPREAD DOES NOT COUNT AS THE FIELDS — the exact FileProcessor:616 trap', () => {
    // `{ ...item }` may or may not carry `period` at runtime and the guard cannot know, so it
    // refuses to accept a spread as evidence. That is what forces the two lines to be written
    // explicitly AFTER the spread, which is also the only order that makes them win.
    withProbe(
      ["await addDoc(collection(db, 'transaction_lines'), { ...item, date: d, amount: 1 });"].join('\n'),
      (path) => {
        expect(findRowWrites(path)[0].missing).toEqual(['period', 'ownerId']);
      }
    );
  });

  it('does not flag a write to a DIFFERENT collection', () => {
    withProbe(
      ["await addDoc(collection(db, 'incomes'), { date: d, amount: 1 });"].join('\n'),
      (path) => {
        expect(findRowWrites(path)).toEqual([]);
      }
    );
  });

  it('does not flag a READ of transaction_lines', () => {
    withProbe(
      [
        "import { getDocs, collection } from 'firebase/firestore';",
        "const snap = await getDocs(collection(db, 'transaction_lines'));",
      ].join('\n'),
      (path) => {
        expect(findRowWrites(path)).toEqual([]);
      }
    );
  });

  it('catches an incomes write with no period at all', () => {
    withProbe(
      ["await addDoc(collection(db, 'incomes'), { name: n, amount: 1, month: m, year: y });"].join('\n'),
      (path) => {
        expect(findIncomeWrites(path)[0].problem).toBe('missing');
      }
    );
  });

  it('!! catches an incomes period derived from `date` — D23(b)s exact failure', () => {
    withProbe(
      ["await addDoc(collection(db, 'incomes'), { amount: 1, month: m, year: y, period: periodOrUnknown(e.date) });"].join('\n'),
      (path) => {
        expect(findIncomeWrites(path)[0].problem).toBe('wrong-source');
      }
    );
  });

  it('accepts an incomes period derived from month/year', () => {
    withProbe(
      ["await addDoc(collection(db, 'incomes'), { amount: 1, month: m, year: y, period: periodOrUnknownFromMonthYear(m, y) });"].join('\n'),
      (path) => {
        expect(findIncomeWrites(path)[0].problem).toBe('');
      }
    );
  });

  it('constructsStampedRow refuses a file whose two fields sit in DIFFERENT literals', () => {
    // "In the SAME object literal" is the whole assertion — `period` on one row shape and
    // `ownerId` on another is not a stamped row, it is two half-stamped ones.
    withProbe(
      ['const a = { date: d, period: p };', 'const b = { date: d, ownerId: o };'].join('\n'),
      (path) => {
        expect(constructsStampedRow(path)).toBe(false);
      }
    );
  });

  it('constructsStampedRow accepts a file with one literal carrying both', () => {
    withProbe(['const a = { date: d, period: p, ownerId: o };'].join('\n'), (path) => {
      expect(constructsStampedRow(path)).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T3 REVIEW F2 — THE THREE SPELLINGS THIS GUARD USED TO BE BLIND TO
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// The 50th mutation of T3's sweep. `mentionsCollection` required the literal `'transaction_lines'`
// inside the call expression's OWN subtree and the row inside an INLINE object literal carrying a
// row-shaped key, so three ordinary ways of writing the same write were invisible — and invisible
// here means the guard reports zero offenders, which is indistinguishable from a clean tree.
//
// The precedent that this bites is not hypothetical: `auditLog.ts:45` writes
// `writer.set(doc(collection(db, AUDIT_LOG_COLLECTION), id), fullEntry)` and was invisible to
// `forecastAssumptions.test.ts` on BOTH of its argument-position assumptions — which is why a
// separate hand-written text check had to sit beside it. Same class, already worked around rather
// than fixed. Fixed here at the level both guards ask the question: see
// `helpers/extractionSurfaces.ts`' `collectionAliases`/`referencesCollection`/`resolveObjectLiteral`
// and their own tests in `commentStripper.test.ts`.
describe('the guard sees the spellings it used to walk past (T3 review F2)', () => {
  it('!! A HOISTED COLLECTION REFERENCE', () => {
    withProbe(
      [
        "import { addDoc, collection } from 'firebase/firestore';",
        "const linesRef = collection(db, 'transaction_lines');",
        'await addDoc(linesRef, { date: d, amount: 1 });',
      ].join('\n'),
      (path) => {
        const [write] = findRowWrites(path);
        expect(write.kind).toBe('inline');
        expect(write.missing).toEqual(['period', 'ownerId']);
      }
    );
  });

  it("!! THE REPO'S OWN EXPORTED CONSTANT", () => {
    withProbe(
      [
        "import { TRANSACTION_LINES_COLLECTION } from '../services/TransactionHistoryService';",
        "import { addDoc, collection } from 'firebase/firestore';",
        'await addDoc(collection(db, TRANSACTION_LINES_COLLECTION), { date: d, amount: 1 });',
      ].join('\n'),
      (path) => {
        // The import cannot resolve from a temp directory, so this probe pins the LOCAL half; the
        // cross-file half is held by `commentStripper.test.ts`'s own tree fixture, and the live
        // half by the constant genuinely existing (asserted below).
        expect(findRowWrites(path)).not.toEqual([]);
      },
      "const TRANSACTION_LINES_COLLECTION = 'transaction_lines';"
    );
  });

  it('!! A ROW LITERAL CARRYING NONE OF THE ROW-SHAPED KEYS — skipped entirely before, not even indirect', () => {
    withProbe(
      [
        "import { addDoc, collection } from 'firebase/firestore';",
        "await addDoc(collection(db, 'transaction_lines'), { description: 'x', category: 'y' });",
      ].join('\n'),
      (path) => {
        const [write] = findRowWrites(path);
        expect(write, 'a write with no row-shaped key was silently skipped').toBeDefined();
        expect(write.kind).toBe('inline');
        expect(write.missing).toEqual(['period', 'ownerId']);
      }
    );
  });

  it('a variable payload built in the same file is read, not waved through', () => {
    withProbe(
      [
        "import { addDoc, collection } from 'firebase/firestore';",
        'const line = { date: d, amount: 1, period: p };',
        "await addDoc(collection(db, 'transaction_lines'), line);",
      ].join('\n'),
      (path) => {
        const [write] = findRowWrites(path);
        expect(write.kind).toBe('inline');
        expect(write.missing).toEqual(['ownerId']);
      }
    );
  });

  it('and the options bag is still not the payload — the regression probe still holds', () => {
    withProbe(
      [
        "import { setDoc, doc } from 'firebase/firestore';",
        "const linesRef = collection(db, 'transaction_lines');",
        'await setDoc(doc(linesRef, id), { date: d, amount: 1 }, { merge: true });',
      ].join('\n'),
      (path) => {
        expect(findRowWrites(path)[0].missing).toEqual(['period', 'ownerId']);
      }
    );
  });

  it('the exported constant this guard now resolves genuinely exists and holds the collection name', () => {
    expect(TRANSACTION_LINES_COLLECTION).toBe(TARGET_COLLECTION);
  });
});
