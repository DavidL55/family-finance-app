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
// ── WHAT COUNTS AS A WRITER, AND THE ONE ESCAPE HATCH ────────────────────────────────────────
//
// A write call whose payload is an INLINE OBJECT LITERAL is checked directly: both keys must be
// present at the literal's top level. A write call whose payload is a variable is an INDIRECT
// write — the row was built somewhere else — and cannot be read at the call site. Those are not
// waved through: each must be listed below WITH THE FILE THAT CONSTRUCTS ITS ROW, and the guard
// then checks that file's own object literal. The escape hatch redirects the check; it does not
// remove it.
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
  listSourceFiles,
  parseSource,
  readSourceCached,
  stripComments,
} from './helpers/extractionSurfaces';

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
  // `batch.update(write.ref, write.patch)` — the patch is the pair itself, built in this same
  // file, so the file is its own constructor.
  'scripts/backfill-transaction-periods.ts': 'scripts/backfill-transaction-periods.ts',
  // Stage 7 T4 — `batch.set(db.collection('transaction_lines').doc(row.id), row)`, where `row` is
  // built by the pure generator. The redirect is what makes the generator's row literal subject to
  // this guard, and the generator stamps both fields THROUGH `periodOrUnknown`/`ownerIdOrUnknown`
  // rather than as literals — so a corpus that stopped exercising the `'unknown'` paths would fail
  // its own condition tests rather than quietly satisfy this one.
  'scripts/seed-demo-finances.ts': 'src/utils/demoCorpus.ts',
};

interface RowWrite {
  file: string;
  line: number;
  kind: 'inline' | 'indirect';
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

/** True when `collection` appears as a STRING LITERAL anywhere inside `node`'s subtree. */
function mentionsCollection(node: ts.Node, collection: string): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isStringLiteralLike(n) && n.text === collection) {
      found = true;
      return;
    }
    n.forEachChild(visit);
  };
  visit(node);
  return found;
}

const mentionsTargetCollection = (node: ts.Node): boolean => mentionsCollection(node, TARGET_COLLECTION);

/**
 * The keys that make an object literal a ROW rather than an options bag or a doc path.
 *
 * !! FOUND BY THIS FILE'S OWN NON-VACUITY TEST, which is the only reason it is here. The first
 * version took the LAST object-literal argument, and `setDoc(ref, data, { merge: true })` — the
 * shape `Dashboard.handleSaveIncomes` uses for its edit path — hands back `{ merge: true }`. The
 * write was then classified as "not a row" and silently skipped: a guard failing OPEN on the exact
 * call shape it exists to check. The count assertion is what turned it red; without it the suite
 * would have been green and one of the three live income writers unguarded.
 */
const ROW_SHAPED_KEYS = ['date', 'amount', 'period', 'month', 'year'];

/** The payload literal of a write call: the first object-literal argument that looks like a row. */
function payloadLiteral(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile
): { literal: ts.ObjectLiteralExpression; names: string[] } | null {
  for (const arg of node.arguments) {
    if (!ts.isObjectLiteralExpression(arg)) continue;
    const names = propertyNames(arg, sourceFile);
    if (names.some((n) => ROW_SHAPED_KEYS.includes(n))) return { literal: arg, names };
  }
  return null;
}

/** True when the call carries an object literal that is plainly NOT a row (an options bag, a doc path). */
function hasOnlyNonRowLiterals(node: ts.CallExpression, sourceFile: ts.SourceFile): boolean {
  const literals = node.arguments.filter(ts.isObjectLiteralExpression);
  return literals.length > 0 && payloadLiteral(node, sourceFile) === null;
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
  const writes: IncomeWrite[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeLastName(node, sourceFile);
      if (name !== null && WRITE_CALL_NAMES.has(name) && mentionsCollection(node, INCOMES_COLLECTION)) {
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
  const writes: RowWrite[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeLastName(node, sourceFile);
      if (name !== null && WRITE_CALL_NAMES.has(name) && mentionsTargetCollection(node)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        // The PAYLOAD is the last object-literal argument; a write whose arguments carry none is
        // an indirect write, and the row it writes was constructed elsewhere.
        const payload = payloadLiteral(node, sourceFile);
        if (payload !== null) {
          writes.push({
            file: fileName,
            line,
            kind: 'inline',
            missing: REQUIRED_FIELDS.filter((f) => !payload.names.includes(f)),
          });
        } else if (!hasOnlyNonRowLiterals(node, sourceFile)) {
          // No object literal at all — the row was built elsewhere and cannot be read here.
          writes.push({ file: fileName, line, kind: 'indirect', missing: [] });
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

function withProbe(contents: string, fn: (path: string) => void): void {
  // A temp directory, NEVER a probe file written into `src/`: vitest runs test files in parallel,
  // and a file appearing under src/ mid-run changes what every other tree-walk guard sees —
  // manufacturing exactly the intermittent, different-set-each-run failure T2 removed.
  const dir = mkdtempSync(join(tmpdir(), 'stamp-guard-'));
  try {
    const path = join(dir, 'probe.ts');
    writeFileSync(path, contents, 'utf8');
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
