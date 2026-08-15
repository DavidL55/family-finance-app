// Pure helpers backing the Task-8 permission-matrix admin screen's D2 "never drifts" guarantee
// at the UI layer (see task-3-report.md "Action for Task 8"). No Firebase imports — kept pure so
// the union/aggregation logic that the Task-3 review flagged as having "no reference code" is
// independently unit-testable without mocking the service layer.

/**
 * Every member who needs `resolvedPermissions` recomputed after a group's membership changes —
 * the union of who was in the group before the edit and who is in it after. A member REMOVED from
 * a group needs recompute just as much as a member added (their resolvedPermissions must drop the
 * group's grants), so this is a union, not just `after`. De-duplicated; order is before-then-new.
 */
export function unionMemberIds(before: readonly string[], after: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of [...before, ...after]) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

export interface RecomputeOutcome {
  succeeded: string[];
  failed: { memberId: string; error: string }[];
}

/**
 * Calls `recompute(memberId)` for every id in `memberIds`, sequentially, WITHOUT letting one
 * member's failure stop the rest from being attempted (mirrors the guardrail placed on
 * `PermissionsService.recomputeAllResolvedPermissions` — a single bad member must not blank out
 * recompute for everyone else affected by the same save). Never throws itself; the caller decides
 * how to surface `failed` (e.g. the distinct "saved, but permissions may be stale" banner).
 */
export async function recomputeMemberIds(
  memberIds: readonly string[],
  recompute: (memberId: string) => Promise<void>
): Promise<RecomputeOutcome> {
  const succeeded: string[] = [];
  const failed: { memberId: string; error: string }[] = [];
  for (const memberId of memberIds) {
    try {
      await recompute(memberId);
      succeeded.push(memberId);
    } catch (err) {
      failed.push({ memberId, error: err instanceof Error ? err.message : 'שגיאה לא ידועה' });
    }
  }
  return { succeeded, failed };
}
