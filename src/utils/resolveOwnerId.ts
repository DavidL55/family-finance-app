// src/utils/resolveOwnerId.ts — Stage 7 T3 (D21a, D21e).
//
// `transaction_lines.owner` is a DISPLAY NAME and always has been (`RecurringService.ts`'s own
// header records the decision and its cost). Stage 7 adds `ownerId` beside it — a `members.id` —
// so the history query can be scoped on something a rename cannot move. This module is the one
// place a name becomes an id.
//
// ── WHY IT IS PURE, WHY THE MEMBER LIST IS PASSED IN, AND WHY IT IMPORTS NOTHING ─────────────
//
// Three call sites need it: `migrateLegacyTransaction` (which must stay pure — its only non-test
// caller is an Admin-SDK script running under plain Node, where `src/services/firebase.ts` cannot
// even be imported because it reads `import.meta.env`), and `FileProcessor`'s two constructors. A
// module that fetched `members` itself would drag Firestore into the first of those and re-fetch
// per row in the other two. The structural `NamedMember` below is declared here rather than
// imported from `seedFromBudgetConfig` for the same reason: `scripts/backfill-transaction-
// periods.ts` reads raw Firestore documents and has no `Member` objects to hand.
//
// ── WHY IT RETURNS `null` AND NEVER THROWS ───────────────────────────────────────────────────
//
// `RecurringService.ts:214-217` does this lookup in the other direction (id → name) and THROWS
// when it cannot resolve, which is right there: it is posting a row it just computed from a
// recurring item whose `ownerId` is a foreign key it controls. Here the input is a human-typed or
// AI-extracted display name, and D21(e) is explicit — the constructors stamp `'unknown'` on
// `null` rather than throwing, because AN IMPORT MUST NOT FAIL BECAUSE A DISPLAY NAME WAS
// RENAMED. `'unknown'` is visible, countable and fixable by a second backfill run; a rejected
// import is a family's statement gone missing.
//
// ── WHY MATCHING IS EXACT, AND WHY A DUPLICATE NAME RESOLVES TO NOBODY ───────────────────────
//
// No case folding, no normalization beyond trimming, no nearest match: `owner` decides whose
// money a row is, and a near-match resolver attributes one member's spending to another with no
// way for the family to see it happened. For the same reason a name carried by two members
// resolves to `null` — `isValidMember` requires a non-empty name and nothing more, so duplicates
// are possible, and picking the first would be a coin flip nobody is told about.

/**
 * The `ownerId` stamped on a row whose `owner` cannot be resolved to a member (D21e). Like
 * `UNKNOWN_PERIOD` this is a QUERIED VALUE — `where('ownerId','==',…)` compares against it — so
 * changing the string orphans every row already carrying it.
 */
export const UNKNOWN_OWNER_ID = 'unknown';

/** The two fields this resolver reads — structural, so a raw Firestore document satisfies it. */
export interface NamedMember {
  id: string;
  name?: string | null;
}

/**
 * `members.id` for the member whose display name is `name`, or `null` when no member carries that
 * name, more than one does, or the name is empty.
 */
export function resolveOwnerId(
  name: string | undefined | null,
  members: ReadonlyArray<NamedMember>
): string | null {
  // T3 review F1 — `owner` arrives off an untrusted Firestore document and has NO type check on
  // create in `firestore.rules` (a super-admin `create` with `owner: 12345` was proven live), so
  // truthiness is not enough: `12345`, `['דויד']` and `{name:'דויד'}` are all truthy and none has
  // `.trim`. An unresolvable owner is `'unknown'` — the caller's decision, already — and a
  // wrong-typed one is unresolvable. Deliberately NOT `String(name)`: stringifying `12345` into a
  // display name to look up would be the near-match guess this resolver exists not to make.
  if (typeof name !== 'string') return null;
  if (!name) return null;
  const needle = name.trim();
  if (needle.length === 0) return null;

  let found: string | null = null;
  for (const member of members) {
    const memberName = member.name;
    if (!memberName || memberName.trim().length === 0) continue;
    if (memberName.trim() !== needle) continue;
    // A second match makes the answer ambiguous, and an ambiguous owner is `'unknown'`, not a
    // guess. Returning on the first match is the bug this loop exists NOT to have.
    if (found !== null) return null;
    found = member.id;
  }
  return found;
}

/** The one place `'unknown'` is chosen for an owner. Mirrors `periodOrUnknown` exactly. */
export function ownerIdOrUnknown(
  name: string | undefined | null,
  members: ReadonlyArray<NamedMember>
): string {
  return resolveOwnerId(name, members) ?? UNKNOWN_OWNER_ID;
}
