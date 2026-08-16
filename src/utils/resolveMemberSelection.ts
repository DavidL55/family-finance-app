// Pure resolvers that turn a `MemberSelection` (the UI-facing מי choice — a specific member set,
// a group, or "everyone") into the two different shapes this codebase's existing consumers
// actually need. Kept dependency-free (no firebase/service imports) — same split as
// `seedFromBudgetConfig.ts` and `migrateLegacyTransaction.ts`: pure logic here, I/O in the caller.

import type { Member } from './seedFromBudgetConfig';
import type { Group } from '../types/permissions';
import type { MemberSelection } from '../types/filters';

/**
 * Resolves a `MemberSelection` to the `Set<string>` of display NAMES the existing
 * `transaction_lines.owner`-based report queries filter on.
 *
 * Returns `null` to mean "no filter" — mode `'all'`, or a `'members'`/`'group'` selection that
 * resolves to zero matching members (an empty `memberIds` array, or a `groupId` that doesn't
 * match any known group). An unknown member id within an otherwise-valid `'members'` array is
 * silently dropped rather than invalidating the whole selection — a stale/deleted id shouldn't
 * make the remaining valid ids disappear too.
 */
export function resolveMemberSelectionNames(
  selection: MemberSelection,
  members: Member[],
  groups: Group[]
): Set<string> | null {
  if (selection.mode === 'all') return null;

  if (selection.mode === 'members') {
    const names = selection.memberIds
      .map((id) => members.find((m) => m.id === id)?.name)
      .filter((name): name is string => typeof name === 'string');
    return names.length > 0 ? new Set(names) : null;
  }

  // mode === 'group'
  const group = groups.find((g) => g.id === selection.groupId);
  if (!group) return null;
  const names = group.memberIds
    .map((id) => members.find((m) => m.id === id)?.name)
    .filter((name): name is string => typeof name === 'string');
  return names.length > 0 ? new Set(names) : null;
}

/**
 * Resolves a `MemberSelection` to the key legacy single-key-per-member documents
 * (`settings/ecosystem`, `settings/budgetConfig`, both keyed `{ [memberId]: ..., all: ... }`) are
 * indexed by — D8. These documents do NOT support multi-member summing this stage, so anything
 * other than exactly one specific member (mode `'all'`, a group, or 2+ selected members) falls
 * back to the `'all'` bucket.
 */
export function resolveEcosystemKey(selection: MemberSelection): string {
  if (selection.mode === 'members' && selection.memberIds.length === 1) {
    return selection.memberIds[0];
  }
  return 'all';
}
