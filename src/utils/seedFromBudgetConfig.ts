// Pure transform: legacy `settings/budgetConfig.members` array -> first-class Member docs
// (Task 6, Stage 1). Kept dependency-free (no firebase imports) so it can be imported both
// from the Vite/vitest app (via MembersService.ts) and from a plain `npx tsx` Node script —
// exactly the split `migrateLegacyTransaction.ts` already established for the transactions
// migration: pure logic in src/utils/, Firestore I/O in the service/script that calls it.

export interface Member {
  id: string;
  name: string;
  role: 'הורה' | 'ילד';
  color: string; // stable per-member hex, spec §5.4 — assigned once at seed time and persisted
  groups: string[]; // group ids, spec §4 — empty for now, Stage 2 fills
  idNumber?: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

// Aniccai member palette — stable order, spec §5.4 (one fixed color per member everywhere).
// Sized for the spec's "up to 20 members" ceiling; index 0 always resolves to the same hex,
// so re-running the seed (only ever happens once, when the collection is empty) is deterministic.
export const MEMBER_COLORS = [
  '#1F4E78', '#17C3B2', '#E07A5F', '#8E7DBE', '#3D8361', '#C98A2B',
  '#5B7DB1', '#B5656F', '#4F9D9D', '#7A6C5D', '#9A4E8A', '#647D2F',
  '#2B6CB0', '#B7791F', '#553C9A', '#276749', '#97266D', '#2C7A7B',
  '#975A16', '#702459',
] as const;

// The app's existing seed defaults (currently duplicated inline in Dashboard.tsx's bootstrap
// effect — Part B should point Dashboard at this single copy instead of keeping its own).
export const DEFAULT_MEMBER_SEED: Array<{ id: string; name: string; role: Member['role'] }> = [
  { id: 'david-levy', name: 'דויד', role: 'הורה' },
  { id: 'lilit-levy', name: 'לילית', role: 'הורה' },
  { id: 'omer-levy', name: 'עומר', role: 'ילד' },
];

/**
 * Converts the legacy `settings/budgetConfig.members` shape into real Member docs.
 *
 * Never-lose-a-member rule: a member is only dropped when it has no recoverable name (there is
 * nothing to identify it by). A missing/malformed id gets a deterministic fallback; an invalid
 * role gets defaulted (with a console warning) rather than discarding the member. Malformed
 * top-level input (not an object, no `members` array) yields [] rather than throwing.
 */
export function seedFromBudgetConfig(raw: unknown): Member[] {
  if (!raw || typeof raw !== 'object') return [];
  const arr = (raw as { members?: unknown }).members;
  if (!Array.isArray(arr)) return [];

  const now = new Date().toISOString();
  const seenIds = new Set<string>();
  const result: Member[] = [];

  arr.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      console.warn(`[seedFromBudgetConfig] skipping non-object member entry at index ${index}`);
      return;
    }
    const { id, name, role, idNumber } = entry as Record<string, unknown>;

    if (typeof name !== 'string' || name.trim().length === 0) {
      console.warn(`[seedFromBudgetConfig] skipping member at index ${index}: no recoverable name`);
      return;
    }

    let resolvedId = typeof id === 'string' && id.length > 0 ? id : '';
    if (!resolvedId) {
      const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
      resolvedId = `member-${index}-${slug}`;
      console.warn(`[seedFromBudgetConfig] member "${name}" had no valid id; assigned fallback id "${resolvedId}"`);
    }
    if (seenIds.has(resolvedId)) {
      resolvedId = `${resolvedId}-${index}`;
    }
    seenIds.add(resolvedId);

    let resolvedRole: Member['role'];
    if (role === 'הורה' || role === 'ילד') {
      resolvedRole = role;
    } else {
      resolvedRole = 'הורה';
      console.warn(`[seedFromBudgetConfig] member "${name}" had invalid role ${JSON.stringify(role)}; defaulted to "הורה"`);
    }

    const member: Member = {
      id: resolvedId,
      name,
      role: resolvedRole,
      color: MEMBER_COLORS[result.length % MEMBER_COLORS.length],
      groups: [],
      createdAt: now,
      updatedAt: now,
    };
    if (typeof idNumber === 'string') member.idNumber = idNumber;

    result.push(member);
  });

  return result;
}
