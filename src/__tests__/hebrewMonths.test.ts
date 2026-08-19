// src/__tests__/hebrewMonths.test.ts — Stage 7 T6, D29(c). THE MOVED MAP.
//
// `monthsList` lived in `FuturePlanning.tsx` and is what `goals.date` is built from. T6 needs to
// PARSE that field, and the plan requires the array MOVED rather than copied — duplicating a map is
// this project's recorded F4 class, and the failure mode is silent: a parser with its own copy
// agrees with the writer until a rename, after which every goal in that month is COUNTED as
// unparseable instead of reported as a mismatch.
//
// Two things are held here that no other test can hold: that the move actually happened (the
// component reads the shared array rather than one of its own), and that the two conversions are
// inverses — an off-by-one in the index convention moves every goal one month with no error.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HEBREW_MONTH_NAMES,
  MONTH_KEY_APRIL,
  MONTH_KEY_PATTERN,
  MONTH_KEY_SEPTEMBER,
  hebrewNameOfMonthKey,
  monthKeyOfHebrewName,
} from '../config/hebrewMonths';
import { SRC_ROOT, stripComments } from './helpers/extractionSurfaces';
import { monthKeyOf } from '../utils/periodMath';

describe('the twelve names, and the two conversions that must be inverses', () => {
  it('holds twelve names, January first', () => {
    expect(HEBREW_MONTH_NAMES).toHaveLength(12);
    expect(HEBREW_MONTH_NAMES[0]).toBe('ינואר');
    expect(HEBREW_MONTH_NAMES[HEBREW_MONTH_NAMES.length - 1]).toBe('דצמבר');
  });

  it('round-trips every name through its key and back', () => {
    for (const name of HEBREW_MONTH_NAMES) {
      const key = monthKeyOfHebrewName(name);
      expect(key, name).not.toBeNull();
      expect(MONTH_KEY_PATTERN.test(key as string)).toBe(true);
      expect(hebrewNameOfMonthKey(key)).toBe(name);
    }
  });

  it('agrees with `monthKeyOf` on a real period — one calendar, not two', () => {
    // The off-by-one this catches is invisible otherwise: `HEBREW_MONTH_NAMES` is 0-indexed and a
    // month key is 1-based, so a goal due in December would quietly become a November deadline in
    // the allowance arithmetic with every assertion about the array still true.
    HEBREW_MONTH_NAMES.forEach((name, index) => {
      const period = `2026-${String(index + 1).padStart(2, '0')}`;
      expect(monthKeyOfHebrewName(name)).toBe(monthKeyOf(period));
    });
  });

  it('refuses anything that is not one of the twelve, and anything that is not a key', () => {
    expect(monthKeyOfHebrewName('Sept')).toBeNull();
    expect(monthKeyOfHebrewName('ספטמברים')).toBeNull();
    expect(monthKeyOfHebrewName('')).toBeNull();
    expect(monthKeyOfHebrewName(9)).toBeNull();
    expect(hebrewNameOfMonthKey('9')).toBeNull();
    expect(hebrewNameOfMonthKey('13')).toBeNull();
    expect(hebrewNameOfMonthKey('00')).toBeNull();
    expect(hebrewNameOfMonthKey(9)).toBeNull();
  });

  it('names §10s two seasonal months, and they are the months §10 names', () => {
    expect(hebrewNameOfMonthKey(MONTH_KEY_SEPTEMBER)).toBe('ספטמבר');
    expect(hebrewNameOfMonthKey(MONTH_KEY_APRIL)).toBe('אפריל');
  });
});

describe('!! the array was MOVED — the goal form no longer holds its own copy', () => {
  const source = (() => {
    const path = join(SRC_ROOT, 'components/FuturePlanning.tsx');
    return stripComments(readFileSync(path, 'utf8'), path);
  })();

  it('FuturePlanning imports the shared array', () => {
    expect(source).toMatch(/import\s*\{[^}]*HEBREW_MONTH_NAMES[^}]*\}\s*from\s*'\.\.\/config\/hebrewMonths'/);
  });

  it('and spells none of the twelve names itself', () => {
    // The half that makes the import meaningful. An import beside a surviving literal array is not
    // a move, and this is the assertion the ledger's F4 entries were missing each time.
    for (const name of HEBREW_MONTH_NAMES) expect(source).not.toContain(name);
  });
});
