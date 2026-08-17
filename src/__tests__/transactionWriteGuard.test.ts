// Stage 6 Task 1 fixes — review-driven fix #2 (regression guard was weaker than it claimed).
//
// FileProcessor.test.ts's existing "D7 regression guard" (see the `describe` block right below
// this file's own reference in that file) only asserts that three specific OLD function names
// (processLocalFile/processAndUploadFile/processDocumentFile) are absent from FileProcessor's
// exports. That would not catch:
//   - a NEW function under any other name doing the same auto-save loop,
//   - a direct addDoc/updateDoc/setDoc/batch.set dropped straight into a component,
//   - a rename-and-re-export of one of the old functions.
//
// This is a STRUCTURAL guard instead: it scans every non-test .ts/.tsx file under src/ for a
// write call (addDoc | updateDoc | setDoc | batch.set) that targets one of the three collections
// an AI-extraction bypass could corrupt or silently duplicate into — transaction_lines,
// documents, investments — and fails if that write's file isn't on the explicit allow-list below.
// Same technique the project already uses for the Functions-mirroring constraint (see
// aiPermissionsContract.test.ts's "no committed handler/context file accesses `.role`..." guard).
//
// Reopened-hole fix (task-1-fixes-report.md, "Reopened-hole fix" / Fix 2) — a reviewer confirmed
// empirically that this guard, as originally written, was itself bypassable: it matched only the
// literal call names addDoc/updateDoc/setDoc/batch.set, so
//   import { addDoc as sneakyAdd } from 'firebase/firestore';
//   sneakyAdd(collection(db, 'transaction_lines'), data);
// evaded it entirely. Two closes went in in the same pass, both cheap:
//   1. Aliased-import detection (the reported bypass): per file, find every
//      `import { addDoc as X, ... } from 'firebase/firestore'` and treat calls through X exactly
//      like calls to addDoc/updateDoc/setDoc. See findGuardedAliases below.
//   2. Collection-name-in-a-variable detection (one of the two gaps this file already disclosed):
//      `const t = 'transaction_lines'; addDoc(collection(db, t), data)` now resolves `t` back to
//      its guarded literal via a file-local `const/let/var NAME = '...'` scan. See
//      findCollectionVariableBindings below.
//
// Still-disclosed, NOT closed in this pass: a Firestore Transaction's `tx.set` (or whatever the
// runTransaction callback names its parameter) is a different call name entirely from
// addDoc/updateDoc/setDoc/batch.set — closing it means tracking which identifier is bound as the
// callback parameter of a `runTransaction(db, async (X) => { ... X.set(...) ... })` call and
// scoping that alias to the callback body, which is a materially different (block-scoped,
// call-shaped) analysis from "this identifier is a Firestore write function," not a small addition
// to either close above. financeCollections.ts's D10 CRUD factory uses `tx.set` for
// accounts/loans/insurances/recurring — none of which are in TARGET_COLLECTIONS today, so this
// guard still won't see a future transaction-based write path into
// transaction_lines/documents/investments. Flagged for Tasks 3-8 in task-1-fixes-report.md.
//
// Remaining textual-heuristic caveat (same class the Functions-mirroring guard in
// aiPermissionsContract.test.ts accepts): this is still not a type-aware analysis. It matches call
// names (literal or aliased) with a quoted/resolved target-collection on the same (or the next
// couple of) line.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join, relative } from 'path';
import { tmpdir } from 'os';

const TARGET_COLLECTIONS = ['transaction_lines', 'documents', 'investments'] as const;
const BASE_WRITE_CALL_NAMES = ['addDoc', 'updateDoc', 'setDoc', 'batch\\.set'];
const GUARDED_FIRESTORE_FUNCTIONS = ['addDoc', 'updateDoc', 'setDoc'] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Finds `import { addDoc as X, updateDoc, ... } from 'firebase/firestore'` specifiers and returns
// the local alias names bound to any of GUARDED_FIRESTORE_FUNCTIONS. Firestore writes in this
// codebase are always imported from 'firebase/firestore' directly, so that's the only source
// module this needs to watch.
const FIRESTORE_IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]firebase\/firestore['"]/g;

function findGuardedAliases(source: string): string[] {
  const aliases: string[] = [];
  FIRESTORE_IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FIRESTORE_IMPORT_RE.exec(source))) {
    for (const specifier of match[1].split(',')) {
      const aliasMatch = specifier.trim().match(/^(\w+)\s+as\s+(\w+)$/);
      if (aliasMatch && (GUARDED_FIRESTORE_FUNCTIONS as readonly string[]).includes(aliasMatch[1])) {
        aliases.push(aliasMatch[2]);
      }
    }
  }
  return aliases;
}

// Finds file-local `const/let/var NAME = 'literal'` bindings so a write call whose collection
// name was assigned to a variable first can still be resolved back to that literal.
const STRING_CONST_RE = /\b(?:const|let|var)\s+(\w+)\s*=\s*['"]([^'"]+)['"]/g;

function findCollectionVariableBindings(source: string): Map<string, string> {
  const bindings = new Map<string, string>();
  STRING_CONST_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STRING_CONST_RE.exec(source))) {
    bindings.set(match[1], match[2]);
  }
  return bindings;
}

// ── The allow-list. Adding a path here is a deliberate, reviewable act — every entry must name
// WHY the write is legitimate. Nothing else in src/ may write to these three collections. ──────
const ALLOWED_WRITE_FILES = new Set<string>([
  // The ONLY function allowed to write extracted (AI or manual-review) data into
  // transaction_lines/documents — always called after a human approves a draft in
  // ExtractionReviewModal (commitExtractionDraft's own doc comment states this contract).
  'src/utils/FileProcessor.ts',
  // RecurringService's deterministic autopost engine — computes due periods from a
  // human-configured recurring item (owner, amount, cadence) and posts them with a
  // collision-proof `${recurringId}__${period}` doc id; no AI/extraction involved.
  'src/services/RecurringService.ts',
  // InvestmentsImportModal.applyQuarterlyData — writes to `investments` ONLY from
  // handleReviewCommit, i.e. only after the human approves the draft in the same shared
  // ExtractionReviewModal (Task 1's HITL fix routed this AI-extraction path through it too).
  'src/components/InvestmentsImportModal.tsx',
  // InvestmentsPortfolio's manual "add asset" form (handleSave) and inline edit (handleUpdateAsset)
  // — direct human data entry, no AI/extraction anywhere in the path.
  'src/components/InvestmentsPortfolio.tsx',
]);

const SRC_ROOT = join(process.cwd(), 'src');

function listSourceFiles(dir: string): string[] {
  let files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'fixtures') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files = files.concat(listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      files.push(full);
    }
  }
  return files;
}

interface Violation {
  file: string;
  line: number;
  text: string;
}

function findTargetCollectionWrites(rootDir: string): Violation[] {
  const violations: Violation[] = [];
  for (const filePath of listSourceFiles(rootDir)) {
    const relPath = relative(process.cwd(), filePath).replace(/\\/g, '/');
    const source = readFileSync(filePath, 'utf8');
    const lines = source.split('\n');

    // Per-file: fold in any local aliases of addDoc/updateDoc/setDoc so a call through the alias
    // is matched exactly like a call to the guarded name itself.
    const aliases = findGuardedAliases(source).map(escapeRegExp);
    const writeCallRe = new RegExp(`\\b(${[...BASE_WRITE_CALL_NAMES, ...aliases].join('|')})\\s*\\(`);

    // Per-file: resolve `const NAME = 'transaction_lines'` style bindings back to their literal.
    const collectionVars = findCollectionVariableBindings(source);

    for (let i = 0; i < lines.length; i++) {
      if (!writeCallRe.test(lines[i])) continue;
      // Look at the matched line plus a small trailing window, in case the collection literal
      // sits on a following line (e.g. a write call whose args are spread across lines).
      const window = lines.slice(i, i + 3).join('\n');
      const targetsGuardedCollectionLiteral = TARGET_COLLECTIONS.some((c) => window.includes(`'${c}'`));
      const targetsGuardedCollectionViaVariable = Array.from(collectionVars.entries()).some(
        ([name, value]) =>
          (TARGET_COLLECTIONS as readonly string[]).includes(value) &&
          new RegExp(`collection\\([^,()]*,\\s*${escapeRegExp(name)}\\s*[),]`).test(window)
      );
      if (!targetsGuardedCollectionLiteral && !targetsGuardedCollectionViaVariable) continue;
      if (ALLOWED_WRITE_FILES.has(relPath)) continue;
      violations.push({ file: relPath, line: i + 1, text: lines[i].trim() });
    }
  }
  return violations;
}

describe('structural write guard — only the allow-listed files may write to transaction_lines/documents/investments', () => {
  it('no addDoc/updateDoc/setDoc/batch.set targeting a guarded collection exists outside the allow-list', () => {
    const violations = findTargetCollectionWrites(SRC_ROOT);
    expect(
      violations,
      violations
        .map((v) => `${v.file}:${v.line} — ${v.text}`)
        .join('\n') || 'no violations'
    ).toEqual([]);
  });

  it('every allow-listed file still actually exists and is still under src/ (allow-list cannot silently rot into stale, unverifiable entries)', () => {
    for (const relPath of ALLOWED_WRITE_FILES) {
      expect(() => statSync(join(process.cwd(), relPath))).not.toThrow();
    }
  });
});

// Reopened-hole fix (Fix 2) — regression coverage for the two closes above, exercised in an
// isolated fixture directory (not the real src/ tree) so these assert the detection logic itself,
// independent of whatever happens to live under src/ at any given time.
describe('structural write guard — reopened-hole fix regression coverage (aliased imports, variable-held collection names)', () => {
  function withFixture(contents: string, fn: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'write-guard-fixture-'));
    try {
      writeFileSync(join(dir, 'probe.ts'), contents, 'utf8');
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('catches a write reached through an aliased import of a guarded Firestore function', () => {
    withFixture(
      [
        "import { addDoc as sneakyAdd, collection } from 'firebase/firestore';",
        "sneakyAdd(collection(db, 'transaction_lines'), data);",
      ].join('\n'),
      (dir) => {
        const violations = findTargetCollectionWrites(dir);
        expect(violations).toHaveLength(1);
        expect(violations[0].line).toBe(2);
      }
    );
  });

  it('catches a write whose collection name is held in a local variable instead of a literal', () => {
    withFixture(
      [
        "import { addDoc, collection } from 'firebase/firestore';",
        "const targetCollection = 'transaction_lines';",
        'addDoc(collection(db, targetCollection), data);',
      ].join('\n'),
      (dir) => {
        const violations = findTargetCollectionWrites(dir);
        expect(violations).toHaveLength(1);
        expect(violations[0].line).toBe(3);
      }
    );
  });

  it('does not flag an aliased import of an unguarded Firestore function, or a variable bound to an unrelated string', () => {
    withFixture(
      [
        "import { getDoc as sneakyGet, doc, collection } from 'firebase/firestore';",
        "const label = 'not_a_guarded_collection';",
        'void sneakyGet(doc(db, label));',
      ].join('\n'),
      (dir) => {
        expect(findTargetCollectionWrites(dir)).toEqual([]);
      }
    );
  });

  it('still discloses, and does not catch, a Firestore Transaction tx.set into a guarded collection', () => {
    withFixture(
      [
        "import { runTransaction, collection } from 'firebase/firestore';",
        'await runTransaction(db, async (tx) => {',
        "  tx.set(collection(db, 'transaction_lines'), data);",
        '});',
      ].join('\n'),
      (dir) => {
        // Documents the still-open gap described in this file's header comment — this MUST stay
        // empty until tx.set-in-runTransaction detection is deliberately added. If this starts
        // failing, either the gap was closed (great — update the header comment and this test) or
        // the guard regressed in some unrelated way.
        expect(findTargetCollectionWrites(dir)).toEqual([]);
      }
    );
  });
});
