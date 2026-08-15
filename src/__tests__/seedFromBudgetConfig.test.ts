import { describe, expect, it, vi, afterEach } from 'vitest';
import { MEMBER_COLORS, seedFromBudgetConfig } from '../utils/seedFromBudgetConfig';

describe('seedFromBudgetConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('duplicate literal id dedup (data-loss guard)', () => {
    it('does not collapse two members sharing the same literal id into one', () => {
      const result = seedFromBudgetConfig({
        members: [
          { id: 'dup', name: 'ראשון', role: 'הורה' },
          { id: 'dup', name: 'שני', role: 'הורה' },
        ],
      });

      // If the seenIds dedup at lines 71-74 were removed, both entries would carry the id
      // "dup" and the second batch.set() in ensureSeeded() would overwrite the first —
      // one of the two members would silently vanish from Firestore. This test fails if
      // that guard is removed, by asserting on both the count and the id uniqueness.
      expect(result).toHaveLength(2);
      const ids = result.map((m) => m.id);
      expect(new Set(ids).size).toBe(2);
      expect(ids).toContain('dup');
      // The colliding second entry gets a suffixed id so it lands in its own Firestore doc.
      expect(ids.some((id) => id !== 'dup' && id.startsWith('dup'))).toBe(true);
      // Both names must survive — dedup must repair the id, not drop the member.
      expect(result.map((m) => m.name).sort()).toEqual(['ראשון', 'שני']);
    });
  });

  describe('color palette wraparound past 20 members', () => {
    it('warns when a member past the palette ceiling reuses a color, matching the file\'s other repair-path warnings', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const members = Array.from({ length: MEMBER_COLORS.length + 1 }, (_, i) => ({
        id: `m${i}`,
        name: `Member ${i}`,
        role: 'הורה' as const,
      }));

      const result = seedFromBudgetConfig({ members });

      expect(result).toHaveLength(MEMBER_COLORS.length + 1);
      // Member 21 (index 20) silently wraps to the same color as member 1 (index 0) —
      // that's the wraparound itself, still expected — but it must not be silent.
      expect(result[MEMBER_COLORS.length].color).toBe(result[0].color);

      const wraparoundWarnings = warnSpy.mock.calls.filter((call) =>
        String(call[0]).includes('palette exhausted')
      );
      expect(wraparoundWarnings.length).toBeGreaterThan(0);
    });

    it('does not warn about palette exhaustion for exactly 20 members', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const members = Array.from({ length: MEMBER_COLORS.length }, (_, i) => ({
        id: `m${i}`,
        name: `Member ${i}`,
        role: 'הורה' as const,
      }));

      seedFromBudgetConfig({ members });

      const wraparoundWarnings = warnSpy.mock.calls.filter((call) =>
        String(call[0]).includes('palette exhausted')
      );
      expect(wraparoundWarnings.length).toBe(0);
    });

    it('assigns every member within the palette ceiling a unique color', () => {
      const members = Array.from({ length: MEMBER_COLORS.length }, (_, i) => ({
        id: `m${i}`,
        name: `Member ${i}`,
        role: 'הורה' as const,
      }));

      const result = seedFromBudgetConfig({ members });
      const colors = result.map((m) => m.color);
      expect(new Set(colors).size).toBe(MEMBER_COLORS.length);
    });
  });
});
