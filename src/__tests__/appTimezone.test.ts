// Stage 7 T1 — APP_TIMEZONE (D32b).
//
// D32 asks for `APP_TIMEZONE` to be "reused from the cost gate, not re-declared". It cannot be
// reused: no such constant exists anywhere in the tree — the cost gate holds the literal inline in
// its `Intl.DateTimeFormat` options — and `functions/src/shared/permissions.ts:11-14` forbids
// hand-copying a second piece of logic across the deploy boundary.
//
// So the substance of the ruling is enforced here instead of by an import: ONE value, and it cannot
// drift. Both assertions below can go red — the first if either side's literal changes, the second
// the moment a second `'Asia/Jerusalem'` appears anywhere in `src/`, which is the actual failure
// D32 is trying to prevent.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, SRC_ROOT, stripComments } from './helpers/extractionSurfaces';
import { APP_TIMEZONE } from '../config/time';

const COST_GATE = join(REPO_ROOT, 'functions/src/costGate/costGate.ts');
/** Assembled at runtime so this test file is not itself a second copy of the literal. */
const THE_LITERAL = ['Asia', 'Jerusalem'].join('/');

function sourceFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      found.push(...sourceFilesUnder(full));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

describe('APP_TIMEZONE — one value across the deploy boundary (D32b)', () => {
  it('matches the timezone the cost gate pins its monthKey to', () => {
    // Read off disk, not remembered. The cost gate's is the value that was chosen after a real
    // rollover bug corrupted two months of counters; the client half must not quietly differ.
    const costGate = stripComments(readFileSync(COST_GATE, 'utf8'), COST_GATE);
    const match = /timeZone:\s*'([^']+)'/.exec(costGate);
    expect(match, 'costGate.ts no longer pins a timeZone — D32b has lost its anchor').not.toBeNull();
    expect(APP_TIMEZONE).toBe(match?.[1]);
  });

  it('is the ONLY place the literal appears in src/ — the second copy is what drifts', () => {
    // Comments are stripped first: this file's own header, and `config/time.ts`'s, both discuss the
    // value at length, and a guard that counts prose is a guard that fires on documentation.
    //
    // The raw `includes` PREFILTER before `stripComments` is not premature optimisation. This repo
    // already carries several tree-walk guards that TypeScript-parse every file under `src/`, and
    // they sit close enough to vitest's 5s default that adding one more full parse of the tree made
    // three of them time out intermittently under the parallel pool. The prefilter is exact — a
    // file that does not contain the bytes at all cannot contain them outside a comment either — so
    // it changes no answer, and it takes the parse from ~200 files to the handful that match.
    const offenders = sourceFilesUnder(SRC_ROOT)
      .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
      .filter(({ file, source }) => source.includes(THE_LITERAL) && stripComments(source, file).includes(THE_LITERAL))
      .map(({ file }) => relative(SRC_ROOT, file));
    expect(offenders).toEqual(['config/time.ts']);
  });

  it('the scan can actually see a literal — non-vacuity', () => {
    // If `stripComments` or the walker were broken, the assertion above would pass by finding
    // nothing at all. This proves the corpus is non-empty and the matcher works on it.
    const declaring = join(SRC_ROOT, 'config/time.ts');
    expect(stripComments(readFileSync(declaring, 'utf8'), declaring)).toContain(THE_LITERAL);
    expect(sourceFilesUnder(SRC_ROOT).length).toBeGreaterThan(20);
  });
});
