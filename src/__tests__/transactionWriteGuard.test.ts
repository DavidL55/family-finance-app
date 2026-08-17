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
// Known, disclosed limitation (same class the mirroring guard already accepts): this is a
// textual heuristic, not a type-aware analysis. It matches the literal call names
// addDoc/updateDoc/setDoc/batch.set with a quoted target-collection literal on the same (or the
// next couple of) line — exactly per the brief. It would NOT catch a write reached through
// indirection (e.g. a collection name held in a variable, or a Firestore Transaction's `tx.set`,
// which is a different call name entirely and is what financeCollections.ts's D10 CRUD factory
// uses for accounts/loans/insurances/recurring — none of which are in the target-collection set,
// so this is disclosed as a gap, not silently missed: if a future stage adds a transaction-based
// write path to transaction_lines/documents/investments, THIS guard will not see it). Flagged for
// Tasks 3-8 in task-1-fixes-report.md.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const TARGET_COLLECTIONS = ['transaction_lines', 'documents', 'investments'] as const;
const WRITE_CALL = /\b(addDoc|updateDoc|setDoc|batch\.set)\s*\(/;

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
    const lines = readFileSync(filePath, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!WRITE_CALL.test(lines[i])) continue;
      // Look at the matched line plus a small trailing window, in case the collection literal
      // sits on a following line (e.g. a write call whose args are spread across lines).
      const window = lines.slice(i, i + 3).join('\n');
      const targetsGuardedCollection = TARGET_COLLECTIONS.some((c) => window.includes(`'${c}'`));
      if (!targetsGuardedCollection) continue;
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
