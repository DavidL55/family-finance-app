// Stage 7 T2 — `forecast_assumptions`: the document shape, the scope→category mapping, and the
// single-writer property the D20 tiebreak rests on.
//
// EVERY PREDICATE HERE IS SHADOWED BY CONSTRUCTION. `forecast_assumptions` does not exist on the
// real corpus — the whole ledger is 14 documents and this collection is not among them — so no
// data could ever have failed any of these. Written stub-first against modules returning empty,
// run red, and the inputs below are adversarial rather than illustrative, because they are the
// only thing standing behind these guards until T4's generator exists.
//
// The Rules half of T2 lives in firestore-tests/forecast-assumptions.rules.test.ts, on the
// emulator, because a permission claim asserted against a mock is a claim about the mock.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { REPO_ROOT, SRC_ROOT, parseSource, stringLiterals, stripComments } from './helpers/extractionSurfaces';
import {
  FORECAST_ASSUMPTIONS_COLLECTION,
  forecastAssumptionRepo,
} from '../services/ForecastAssumptionsService';
import {
  ASSUMPTION_SCOPE_KINDS,
  SEASONAL_FACTOR_MAX,
  SEASONAL_FACTOR_MIN,
} from '../types/finance';
import type { AssumptionScopeKind, ForecastAssumption } from '../types/finance';
import { CATEGORY_INSURANCE, CATEGORY_LOAN_REPAYMENT, resolveCategoryOfScope } from '../utils/forecast';
import type { ForecastLineItem } from '../utils/forecast';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the union
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('AssumptionScopeKind — the union T2 ships, and the one member it deliberately does not', () => {
  it('carries exactly the five kinds T2 authorises, in a runtime array the type checks against', () => {
    expect([...ASSUMPTION_SCOPE_KINDS].sort()).toEqual(
      ['category', 'insurance', 'loan', 'personalTarget', 'recurring'].sort()
    );
    // The array and the union cannot drift: this assignment fails `tsc --noEmit` the day a member
    // is added to one and not the other.
    const everyKind: AssumptionScopeKind[] = [...ASSUMPTION_SCOPE_KINDS];
    expect(everyKind).toHaveLength(5);
  });

  it("does NOT yet carry 'seasonality' — D24 lands it in T6, and Rules already accept it", () => {
    // Named rather than left implicit. Rules validate the SIX kinds D25's document contract
    // declares (so T2's `factor` bound test is not vacuous); the client type carries five until T6
    // writes the seasonality half. The gap is asserted in both directions below, in
    // `the Rules scopeKind list and the client union agree, except where T6 is named`.
    expect((ASSUMPTION_SCOPE_KINDS as readonly string[]).includes('seasonality')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the scope → category mapping
// ─────────────────────────────────────────────────────────────────────────────────────────────

const certainItem = (over: Partial<ForecastLineItem>): ForecastLineItem => ({
  period: '2026-09',
  categoryId: 'דיור',
  direction: 'expense',
  amountILS: 6000,
  basis: { kind: 'recurring', recurringId: 'rec-rent', description: 'שכר דירה', chargeDay: 1 },
  ...over,
});

describe('resolveCategoryOfScope covers personalTarget (T2 adds the union member AND its mapping)', () => {
  it('the four T1 kinds are unchanged', () => {
    const items = [certainItem({})];
    expect(resolveCategoryOfScope('recurring', 'rec-rent', items)).toBe('דיור');
    expect(resolveCategoryOfScope('loan', 'loan-1', items)).toBe(CATEGORY_LOAN_REPAYMENT);
    expect(resolveCategoryOfScope('insurance', 'ins-1', items)).toBe(CATEGORY_INSURANCE);
    expect(resolveCategoryOfScope('category', 'מסעדות', items)).toBe('מסעדות');
  });

  it('a personalTarget maps to NO category — it is a target, not an override', () => {
    // The mapping is `null` and that is a decision, not an omission. D29(c)/(d): a personalTarget
    // is what the ALLOWANCE is computed against ("כמה נשאר לי להוציא"), not a line item competing
    // for a (period, category) bucket. Mapping it to a spend category would make a child's ₪500
    // target DISPLACE the family's ₪6,000 rent line in precedence — an assumption beating a
    // certain item, which D19 permits and which would be catastrophically wrong here.
    expect(resolveCategoryOfScope('personalTarget', 'omer-levy', [certainItem({})])).toBeNull();
    // …and it is null for every scopeId, not just an unmatched one.
    expect(resolveCategoryOfScope('personalTarget', 'דיור', [certainItem({})])).toBeNull();
    expect(resolveCategoryOfScope('personalTarget', '', [])).toBeNull();
  });

  it('every member of the union has a branch — no kind falls through to the throw', () => {
    // The exhaustive `never` in the default branch is a BUILD-time check; this is the runtime half.
    // Without it, a member added to the union with no `case` throws at render on real data.
    for (const kind of ASSUMPTION_SCOPE_KINDS) {
      expect(() => resolveCategoryOfScope(kind, 'x', [certainItem({})])).not.toThrow();
    }
  });

  it('still throws loudly on a kind that is not in the union at all', () => {
    expect(() => resolveCategoryOfScope('seasonality' as AssumptionScopeKind, 'x', [])).toThrow(
      /unrecognised scope kind/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the typed service
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('the service is createOwnedCollectionRepo, so audit entries ride in the same transaction', () => {
  it('names the collection Rules govern, and exposes list/save/remove', () => {
    expect(FORECAST_ASSUMPTIONS_COLLECTION).toBe('forecast_assumptions');
    expect(typeof forecastAssumptionRepo.list).toBe('function');
    expect(typeof forecastAssumptionRepo.save).toBe('function');
    expect(typeof forecastAssumptionRepo.remove).toBe('function');
  });

  it('the record shape extends OwnedRecord, so `id` is in the document body — D20 needs it', () => {
    // finding 1.2.8: `createOwnedCollectionRepo.list` returns `d.data()` WITHOUT `d.id`, so the
    // final tiebreak of D20's total order reads `id` off the body. `save()` stamps it
    // (financeCollections.ts's `merged.id = id`); a writer that is not this repo would not, and the
    // tiebreak would silently degenerate to "whichever Firestore returned first". Hence the
    // only-writer assertion below.
    const record: ForecastAssumption = {
      id: 'fa-1',
      ownerId: 'omer-levy',
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
      scopeKind: 'category',
      scopeId: 'מסעדות',
      fromPeriod: '2026-09',
      amountILS: 1200,
      reasonHe: 'החלטנו לצמצם',
      source: 'user',
      status: 'active',
    };
    expect(record.id).toBe('fa-1');
    expect(record.source).toBe('user');
  });

  it('bounds seasonality factors by the SAME constants Rules enforce (D24, the F1 lesson)', () => {
    expect(SEASONAL_FACTOR_MIN).toBe(0.1);
    expect(SEASONAL_FACTOR_MAX).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE ONLY-WRITER GUARD (finding 1.2.8) — structural, over src/ AND scripts/
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Every non-test .ts/.tsx file under `dir`, recursively — INCLUDING __tests__-free scripts/. */
function everySourceFile(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) everySourceFile(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Files that name the collection in a comment-stripped STRING LITERAL, read off the AST.
 *
 * String-literal-based rather than a text grep, for the reason batch 10 recorded three times: a
 * grep over raw text is satisfiable by a comment and desynchronisable by a regex literal. Comments
 * are blanked first AND the literals come off the parser, so both halves are covered.
 */
function filesNamingTheCollection(): string[] {
  const roots = [SRC_ROOT, join(REPO_ROOT, 'scripts')];
  return roots
    .flatMap((root) => everySourceFile(root))
    .filter((full) =>
      stringLiterals(stripComments(readFileSync(full, 'utf8'), full), full).includes(
        FORECAST_ASSUMPTIONS_COLLECTION
      )
    )
    .map((full) => relative(REPO_ROOT, full).split('\\').join('/'))
    .sort();
}

describe('exactly one module writes forecast_assumptions (finding 1.2.8)', () => {
  it('only ForecastAssumptionsService.ts names the collection, anywhere in src/ or scripts/', () => {
    // scripts/ is in scope deliberately: `transactionWriteGuard`'s SRC_ROOT never scanned it, and
    // that blind spot is exactly how a third `transaction_lines` writer went unnoticed until v2.1
    // (D21e). The same mistake is not being repeated on a collection that is one day old.
    expect(filesNamingTheCollection()).toEqual(['src/services/ForecastAssumptionsService.ts']);
  });

  it('and it reaches Firestore ONLY through createOwnedCollectionRepo — no bare doc()/setDoc()', () => {
    const file = join(SRC_ROOT, 'services/ForecastAssumptionsService.ts');
    const source = stripComments(readFileSync(file, 'utf8'), file);
    expect(source).toContain('createOwnedCollectionRepo');
    for (const escape of ['setDoc(', 'addDoc(', 'updateDoc(', 'deleteDoc(', 'writeBatch(', 'runTransaction(']) {
      expect(source).not.toContain(escape);
    }
  });

  it('the guard is non-vacuous — it can see a second writer', () => {
    // Proven on a synthetic module rather than trusted: the predicate is `stringLiterals` over
    // stripped source, so both halves are exercised here on inputs built to defeat them.
    const named = (src: string): boolean =>
      stringLiterals(stripComments(src, '/x/synthetic.ts'), '/x/synthetic.ts').includes(
        FORECAST_ASSUMPTIONS_COLLECTION
      );
    expect(named("await setDoc(doc(db, 'forecast_assumptions', id), record);")).toBe(true);
    expect(named('const c = "forecast_assumptions";')).toBe(true);
    // …and a mention in a COMMENT is not a writer, which is the half a grep gets wrong.
    expect(named("// writes to 'forecast_assumptions' happen in the service\nconst x = 1;")).toBe(false);
    // …nor is a near-miss name.
    expect(named("const c = 'forecast_assumptions_v2';")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE RULES ↔ CLIENT AGREEMENT — read off firestore.rules, not asserted about it
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('the Rules scopeKind list and the client union agree, except where T6 is named', () => {
  const rules = readFileSync(join(REPO_ROOT, 'firestore.rules'), 'utf8');

  /** The `data.scopeKind in [...]` list, read out of firestore.rules itself. */
  const rulesScopeKinds = (): string[] => {
    const match = /data\.scopeKind in \[([^\]]*)\]/.exec(rules);
    expect(match, 'firestore.rules must contain a `data.scopeKind in [...]` list').not.toBeNull();
    return [...(match as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  };

  it('Rules accept every kind the client can author', () => {
    const inRules = rulesScopeKinds();
    for (const kind of ASSUMPTION_SCOPE_KINDS) expect(inRules).toContain(kind);
  });

  it("Rules carry exactly ONE kind the client does not, and it is 'seasonality' (T6)", () => {
    // The gap is pinned by name and by size. When T6 adds 'seasonality' to the client union this
    // test goes RED and sends whoever is holding it to delete this assertion — which is the only
    // way a stated, temporary divergence does not quietly become permanent.
    const extra = rulesScopeKinds().filter((k) => !(ASSUMPTION_SCOPE_KINDS as readonly string[]).includes(k));
    expect(extra).toEqual(['seasonality']);
  });

  it('the seasonality factor bounds in Rules are the same numbers the client exports', () => {
    // Rules have no import mechanism (firestore.rules says so itself about MAX_MONTHLY_CEILING_ILS),
    // so the two copies are held together here rather than by a comment promising they match.
    expect(rules).toContain(`data.factor >= ${SEASONAL_FACTOR_MIN}`);
    expect(rules).toContain(`data.factor <= ${SEASONAL_FACTOR_MAX}`);
  });

  it("the Stage 8 seam is in Rules, not in a source scan (D25b)", () => {
    expect(stripRulesComments(rules)).toContain("data.source == 'user'");
  });
});

/** firestore.rules is not TypeScript; its comments are `//` only and it has no regex literals. */
function stripRulesComments(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// INHERITED CLOSURE — no audit_log writer anywhere emits a non-string `at`
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The `at` value written alongside every `audit_log` document in one file, read off the AST.
 *
 * AST rather than a regex over the file, and the difference is not stylistic: costGate.ts writes
 * `at: FieldValue.serverTimestamp()` onto the `ai_usage` LEDGER two hundred lines away from its
 * audit_log write, and that one is legitimate — `ai_usage` is Function-only, no rule validates it,
 * and nothing declares its `at` a string. A file-level regex flags it and the guard gets deleted by
 * whoever hits the false positive. This walks `<writer>.set(<ref>, <object>)` where `<ref>` names
 * `audit_log`, and reads `at` off THAT object.
 */
function auditAtExpressions(fileName: string, source: string): string[] {
  const sourceFile = parseSource(fileName, stripComments(source, fileName));
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'set' &&
      node.arguments.length >= 2 &&
      node.arguments[0].getText(sourceFile).includes('audit_log') &&
      ts.isObjectLiteralExpression(node.arguments[1])
    ) {
      for (const prop of node.arguments[1].properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
          prop.name.text === 'at'
        ) {
          found.push(prop.initializer.getText(sourceFile));
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return found;
}

describe('audit_log.at is a string in EVERY writer, client and server (Stage 7 T2 closure)', () => {
  it('every audit_log write in src/, scripts/ AND functions/src pairs `at` with an ISO string', () => {
    // functions/src is where BOTH offenders were, and no src/-rooted guard in this repo has ever
    // scanned it — the same directory-scoping blind spot that hid a third `transaction_lines`
    // writer until v2.1 (D21e).
    const roots = [SRC_ROOT, join(REPO_ROOT, 'scripts'), join(REPO_ROOT, 'functions', 'src')];
    const writes = roots
      .flatMap((root) => everySourceFile(root))
      .flatMap((full) =>
        auditAtExpressions(full, readFileSync(full, 'utf8')).map((expr) => ({
          file: relative(REPO_ROOT, full).split('\\').join('/'),
          expr,
        }))
      );
    // Non-vacuity FIRST: if the walker found nothing, everything below passes on an empty set.
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(writes.filter((w) => /serverTimestamp/.test(w.expr))).toEqual([]);
    for (const write of writes) expect(write.expr).toBe('new Date().toISOString()');
  });

  it('the walker is non-vacuous — it sees both spellings, ignores a comment, and ignores ai_usage', () => {
    const at = (src: string): string[] => auditAtExpressions('/x/synthetic.ts', src);
    expect(at("batch.set(db.collection('audit_log').doc(), { actorMemberId, at: FieldValue.serverTimestamp() });"))
      .toEqual(['FieldValue.serverTimestamp()']);
    expect(at("batch.set(doc(db, 'audit_log', id), { at: serverTimestamp() });")).toEqual(['serverTimestamp()']);
    expect(at("writer.set(doc(collection(db, 'audit_log'), id), { at: new Date().toISOString() });"))
      .toEqual(['new Date().toISOString()']);
    // A comment naming the defect is not the defect.
    expect(at("// batch.set(db.collection('audit_log').doc(), { at: serverTimestamp() });\nconst x = 1;")).toEqual([]);
    // The FALSE POSITIVE a file-level regex produces: ai_usage's own `at`, in a file that also
    // writes audit_log. This is the case that made the first version of this guard wrong.
    expect(
      at(
        "tx.set(ledgerRef, { providerId, at: FieldValue.serverTimestamp() });\n" +
        "batch.set(db.collection('audit_log').doc(), { at: new Date().toISOString() });"
      )
    ).toEqual(['new Date().toISOString()']);
  });

  it('the one client writer emits an ISO string', () => {
    const file = join(SRC_ROOT, 'utils/auditLog.ts');
    const source = stripComments(readFileSync(file, 'utf8'), file);
    expect(source).toContain('at: new Date().toISOString()');
  });
});
