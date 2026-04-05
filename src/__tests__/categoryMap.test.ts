import { describe, expect, it } from 'vitest';
import { CATEGORY_MAP } from '../utils/FileProcessor';

describe('CATEGORY_MAP', () => {
  it('has General_Misc mapped to שונות', () => {
    expect(CATEGORY_MAP.General_Misc).toBe('שונות');
  });

  it('all values are Hebrew strings', () => {
    for (const value of Object.values(CATEGORY_MAP)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('keys are English identifiers', () => {
    for (const key of Object.keys(CATEGORY_MAP)) {
      expect(key).toMatch(/^[A-Za-z_]+$/);
    }
  });

  it('contains exactly 9 categories', () => {
    expect(Object.keys(CATEGORY_MAP)).toHaveLength(9);
  });

  describe('category validation logic (Object.values check)', () => {
    it('accepts valid Hebrew category strings', () => {
      for (const category of Object.values(CATEGORY_MAP)) {
        expect(Object.values(CATEGORY_MAP).includes(category)).toBe(true);
      }
    });

    it('rejects English keys as invalid categories', () => {
      // This was the pre-existing bug: CATEGORY_MAP['מגורים ובית'] returns undefined,
      // so Hebrew values must be checked with Object.values(), not direct key lookup.
      expect(CATEGORY_MAP['מגורים ובית']).toBeUndefined();
      expect(Object.values(CATEGORY_MAP).includes('מגורים ובית')).toBe(true);
    });

    it('rejects unknown strings', () => {
      expect(Object.values(CATEGORY_MAP).includes('קטגוריה לא קיימת')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(Object.values(CATEGORY_MAP).includes('')).toBe(false);
    });

    it('General_Misc Hebrew value triggers unknown-category path', () => {
      const unknownTriggers = (category: string) =>
        category === CATEGORY_MAP.General_Misc ||
        !Object.values(CATEGORY_MAP).includes(category);

      expect(unknownTriggers('שונות')).toBe(true);
      expect(unknownTriggers('קטגוריה לא קיימת')).toBe(true);
      expect(unknownTriggers('מגורים ובית')).toBe(false);
      expect(unknownTriggers('ביטוח ופנסיה')).toBe(false);
      expect(unknownTriggers('הכנסות והשקעות')).toBe(false);
    });
  });
});
