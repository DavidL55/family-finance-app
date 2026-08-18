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

/**
 * Resolves a `MemberSelection` to the `Set<string>` of member IDS the Stage 3 owned collections
 * (`accounts`/`loans`/`insurances`/`recurring`) actually key ownership by — D2/D6. Unlike
 * `resolveMemberSelectionNames` above (built for `transaction_lines.owner`'s display-name
 * convention), these four collections' `ownerId` field IS `Member.id` directly, so this resolver
 * is simpler: mode `'members'` already carries ids, no name lookup needed at all; mode `'group'`
 * resolves via `Group.memberIds` (already ids); mode `'all'` returns `null` ("no filter"), same
 * convention as `resolveMemberSelectionNames`.
 *
 * Returns `null` for "no filter" — mode `'all'`, a `'members'` selection resolving to zero ids, or
 * a `'group'` selection whose `groupId` doesn't match any known group (or resolves to an empty
 * group) — never a throw.
 */
export function resolveMemberSelectionIds(
  selection: MemberSelection,
  groups: Group[]
): Set<string> | null {
  if (selection.mode === 'all') return null;

  if (selection.mode === 'members') {
    return selection.memberIds.length > 0 ? new Set(selection.memberIds) : null;
  }

  // mode === 'group'
  const group = groups.find((g) => g.id === selection.groupId);
  if (!group) return null;
  return group.memberIds.length > 0 ? new Set(group.memberIds) : null;
}

/**
 * Whether a `transaction_lines` row belongs to the current מי selection (T3 review F5).
 *
 * ── WHY THIS IS NOT `selectedNames.has(row.owner)` ANY MORE ─────────────────────────────────
 *
 * D21(a) exists because `owner` is a DISPLAY NAME and a rename orphans every row already carrying
 * the old one. T3 stamped `ownerId` onto rows and widened the Rules read to accept either, so the
 * scoped query returns a renamed member's rows correctly — and then the Dashboard filtered those
 * same rows with `selectedMemberNames.has(data.owner)`, where the name set is built from members'
 * CURRENT names. After a rename the query returned the rows and the filter dropped them: D21(a)'s
 * stated failure relocated one layer up, onto the field that no longer survives.
 *
 * ── AND WHY IT IS NOT SIMPLY `selectedIds.has(row.ownerId)` EITHER ───────────────────────────
 *
 * A row the backfill has not reached has NO `ownerId`. Filtering on the id alone would drop every
 * such row from every מי selection until the backfill runs — on the FAMILY scan, which today is
 * the only path that reads unstamped rows at all. So: the id decides when the row carries one,
 * and the display name decides when it does not. That is strictly better than either alone, and
 * it stops mattering the moment the backfill completes.
 *
 * `ownerId: 'unknown'` (A6's orphan set) is excluded whenever a selection is active — it is a row
 * whose owner could not be resolved, and falling back to its display name would let `'unknown'`
 * silently resolve after all. A row with no attribution AT ALL is kept, which is what the previous
 * `data.owner &&` guard did.
 *
 * Both fields are read as `unknown`: they arrive off an untrusted Firestore document and nothing
 * in Rules types `owner` (T3 review F1).
 */
export function rowMatchesMemberSelection(
  row: { owner?: unknown; ownerId?: unknown },
  selectedIds: ReadonlySet<string> | null,
  selectedNames: ReadonlySet<string> | null
): boolean {
  const ownerId = typeof row.ownerId === 'string' && row.ownerId.length > 0 ? row.ownerId : null;
  if (ownerId !== null) return selectedIds === null || selectedIds.has(ownerId);

  const owner = typeof row.owner === 'string' && row.owner.length > 0 ? row.owner : null;
  if (owner !== null) return selectedNames === null || selectedNames.has(owner);

  return true;
}
