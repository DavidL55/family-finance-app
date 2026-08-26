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
import {
  APP_TIMEZONE,
  currentAppPeriod,
  formatAppDateHe,
  formatDateInTimeZone,
  periodFromIsoDateText,
  periodInTimeZone,
} from '../config/time';

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

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T7a — the one clock read on the forecast's call path
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('periodInTimeZone / currentAppPeriod — D32(b) at the edge (T7a)', () => {
  it('reads the period in the NAMED zone, not the host`s', () => {
    // 2026-08-31T22:30:00Z is already 2026-09-01 01:30 in Israel (UTC+3 in summer). A host-local
    // `getMonth()` in UTC or in London answers August; this must answer September.
    const moment = new Date('2026-08-31T22:30:00.000Z');
    expect(periodInTimeZone(moment, APP_TIMEZONE)).toBe('2026-09');
    expect(periodInTimeZone(moment, 'UTC')).toBe('2026-08');
  });

  it('!! the two answers really do differ across the boundary — otherwise the test above is vacuous', () => {
    const before = new Date('2026-08-31T20:00:00.000Z');
    expect(periodInTimeZone(before, APP_TIMEZONE)).toBe('2026-08');
    expect(periodInTimeZone(before, 'UTC')).toBe('2026-08');
  });

  it('handles the WINTER offset too — UTC+2, so the boundary moves', () => {
    // 2026-01-31T22:30Z is 00:30 on 2026-02-01 in Israel in winter (UTC+2).
    expect(periodInTimeZone(new Date('2026-01-31T22:30:00.000Z'), APP_TIMEZONE)).toBe('2026-02');
    expect(periodInTimeZone(new Date('2026-01-31T21:30:00.000Z'), APP_TIMEZONE)).toBe('2026-01');
  });

  it('an unreadable moment is refused by `Intl` itself — named, not re-implemented', () => {
    // The refusal is real and loud; what it is NOT is this module's own shape check, and the two
    // are kept apart so neither is credited with the other's work.
    expect(() => periodInTimeZone(new Date('not a date'), APP_TIMEZONE)).toThrow(/Invalid time value/);
  });

  it('!! the SHAPE check fires — proven on a synthetic format, because no `Date` can reach it', () => {
    // `'en-CA'` is relied on for its ISO output shape. If a host's ICU ever formatted it
    // `31/08/2026`, a seven-character slice would yield `'31/08/2'` and anchor every figure on a
    // month that does not exist. That assumption is about the RUNTIME, not the caller, so it is
    // driven from a string.
    expect(() => periodFromIsoDateText('31/08/2026', APP_TIMEZONE)).toThrow(/YYYY-MM/);
    expect(() => periodFromIsoDateText('2026-13-01', APP_TIMEZONE)).toThrow(/YYYY-MM/);
    expect(() => periodFromIsoDateText('', APP_TIMEZONE)).toThrow(/YYYY-MM/);
    // …and the shape it is there to accept is accepted, so the guard is not merely refusing.
    expect(periodFromIsoDateText('2026-08-31', APP_TIMEZONE)).toBe('2026-08');
  });

  it('`currentAppPeriod` takes the moment as a parameter, so no test needs to freeze a global clock', () => {
    expect(currentAppPeriod(new Date('2026-08-31T22:30:00.000Z'))).toBe('2026-09');
    // …and its default really is the wall clock, checked by SHAPE rather than by value.
    expect(currentAppPeriod()).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// D16 — THE DATE THE OPENING-BALANCE LINE SHOWS, AND THE ZONE THAT DECIDES WHICH DAY IT IS
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('!! `formatAppDateHe` — a stored moment as a date, in APP_TIMEZONE', () => {
  // !! THE FIRST VERSION OF THIS TEST DID NOT HOLD THE ZONE, AND THE SWEEP SAID SO. It asserted
  // `formatAppDateHe('2026-08-13T22:00:00.000Z') === '14.8.2026'` — correct, and USELESS here:
  // deleting `timeZone` falls back to the HOST's zone, and this machine runs on `Asia/Jerusalem`,
  // so the mutant survived the very test written to catch it. A zone assertion that names only one
  // zone is a guard whose result the host supplies.
  //
  // Two NAMED zones, compared against each other, cannot be fooled by the third one the process
  // happens to be in.
  it('!! the ZONE is load-bearing — two named zones disagree about which day it is', () => {
    // 22:00Z on the 13th is 01:00 on the 14th in Israel. This is the moment that separates them.
    const lateEvening = '2026-08-13T22:00:00.000Z';
    expect(formatDateInTimeZone(lateEvening, 'UTC')).toBe('13.8.2026');
    expect(formatDateInTimeZone(lateEvening, APP_TIMEZONE)).toBe('14.8.2026');
    // …so a formatter that ignored its argument would make these two equal. THIS is the assertion
    // the deleted-`timeZone` mutant dies on, wherever the suite runs.
    expect(formatDateInTimeZone(lateEvening, 'UTC')).not.toBe(
      formatDateInTimeZone(lateEvening, APP_TIMEZONE)
    );
    // …and the app-facing wrapper really passes APP_TIMEZONE rather than any other zone.
    expect(formatAppDateHe(lateEvening)).toBe(formatDateInTimeZone(lateEvening, APP_TIMEZONE));
    expect(formatAppDateHe(lateEvening)).toBe('14.8.2026');
  });

  it('!! REFUSES an unreadable timestamp rather than inventing a plausible date', () => {
    // `formatILS`'s `₪—` precedent. `computeOpeningBalance` grades an unreadable `balanceUpdatedAt`
    // `'very-stale'` — "we do not know how old this is" — and it is rendered on the SAME LINE, so a
    // formatter that answered with a date would contradict the grade beside it.
    expect(formatAppDateHe('not-a-date')).toBe('—');
    expect(formatAppDateHe('')).toBe('—');
  });

  it('reads as a Hebrew numeric date, not as a storage timestamp', () => {
    // The defect this was written for: `openingBalance.asOf` reached the screen verbatim.
    const formatted = formatAppDateHe('2026-08-13T09:00:00.000Z');
    expect(formatted).not.toContain('T');
    expect(formatted).not.toContain('Z');
    expect(formatted).toMatch(/^\d{1,2}\.\d{1,2}\.\d{4}$/);
  });
});
