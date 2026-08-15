// Task 6 (Stage 1, Part A): `members` as a first-class Firestore collection.
//
// Today family members live as an array inside `settings/budgetConfig`. Stage 2 attaches auth
// users and permissions to members, so they must be real documents with stable ids. This module
// owns the read/seed path; Part B rewires the consumer components (Dashboard, sync, import,
// etc. — see task-6-report.md Step 1 inventory) to call `listMembers()` instead of reading the
// legacy array directly, and to call `ensureSeeded()` once at app bootstrap.
//
// The pure transform lives in `../utils/seedFromBudgetConfig` (no firebase import) so it can
// also be imported from a plain `npx tsx` script — see scripts/seed-members.ts and the same
// split already used for `migrateLegacyTransaction`.

import { collection, doc, getDoc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import {
  DEFAULT_MEMBER_SEED,
  MEMBER_COLORS,
  seedFromBudgetConfig,
  type Member,
} from '../utils/seedFromBudgetConfig';

// An edit coming from the UI (FamilyManagerModal) only ever carries the fields a human can
// type in — it never has color/groups/createdAt, and it may be a brand-new member (no doc yet).
export type MemberEdit = Pick<Member, 'id' | 'name' | 'role'> & Partial<Pick<Member, 'idNumber'>>;

export type { Member };
export { DEFAULT_MEMBER_SEED, MEMBER_COLORS, seedFromBudgetConfig };

const MEMBERS_COLLECTION = 'members';
const BUDGET_CONFIG_DOC = ['settings', 'budgetConfig'] as const;

/**
 * Reads every document in the `members` collection.
 *
 * Deliberately does NOT catch/swallow a query failure into `[]` — a failed read must surface as
 * a rejected promise so callers can render an explicit error state. An empty array and "we
 * couldn't check" look identical to a user but mean opposite things; only an empty snapshot
 * (no error, zero docs) should ever produce `[]`.
 */
export async function listMembers(): Promise<Member[]> {
  const snap = await getDocs(collection(db, MEMBERS_COLLECTION));
  return snap.docs.map((d) => d.data() as Member);
}

/**
 * Idempotent bootstrap: if the `members` collection already has documents, this is a no-op.
 * Otherwise it seeds from `settings/budgetConfig.members` when present, or from the app's
 * historical default (דויד/לילית/עומר) when budgetConfig has no members array yet — so a
 * completely fresh database still ends up with a non-empty members collection.
 */
export async function ensureSeeded(): Promise<void> {
  const existing = await getDocs(collection(db, MEMBERS_COLLECTION));
  if (!existing.empty) return;

  const cfgSnap = await getDoc(doc(db, ...BUDGET_CONFIG_DOC));
  const cfgData = cfgSnap.exists() ? (cfgSnap.data() as { members?: unknown }) : null;
  const hasLegacyMembers = Array.isArray(cfgData?.members) && (cfgData!.members as unknown[]).length > 0;
  const source: unknown = hasLegacyMembers ? cfgData : { members: DEFAULT_MEMBER_SEED };

  const members = seedFromBudgetConfig(source);
  if (members.length === 0) return; // nothing recoverable to seed — never happens given the default fallback above

  const batch = writeBatch(db);
  members.forEach((m) => batch.set(doc(db, MEMBERS_COLLECTION, m.id), m));
  await batch.commit();
}

/**
 * Persists an edited member list (add/rename/re-role/delete) from `FamilyManagerModal` to the
 * `members` collection — the ongoing-edit counterpart to `ensureSeeded()`, which only handles
 * first-run seeding.
 *
 * `edits` is the *full* resulting member list the modal already computed (its `localMembers`
 * after the add/edit/delete), not a delta — same contract the old `settings/budgetConfig.members`
 * write had. For each entry:
 *   - an id that already has a document is updated in place, preserving its `color`, `groups`
 *     and original `createdAt` (only name/role/idNumber/updatedAt change) — a member's color must
 *     stay stable across edits per spec §5.4, not get reassigned on every save.
 *   - an id with no existing document is a brand-new member: it gets the next unused palette
 *     color (falling back to a round-robin pick once the 20-color palette is exhausted),
 *     `groups: []`, and fresh `createdAt`/`updatedAt`.
 *
 * Deletion: a document that exists in the collection but is absent from `edits` is deleted. This
 * mirrors exactly what the UI already did before this rewire — `FamilyManagerModal.handleDelete`
 * removes the member from `localMembers` and calls `onSave` with the shortened list, so "missing
 * from the incoming full list" has only ever meant "the user pressed delete on this member",
 * never a partial/interrupted list. No new destructive behavior is introduced here.
 *
 * Like `listMembers`, this does not catch/swallow: a rejected read or write propagates as a
 * rejected promise so the caller can surface it (never silently drop an edit).
 */
export async function saveMembers(edits: MemberEdit[]): Promise<void> {
  const existingSnap = await getDocs(collection(db, MEMBERS_COLLECTION));
  const existingById = new Map<string, Member>();
  existingSnap.docs.forEach((d) => existingById.set(d.id, d.data() as Member));

  // Pick the first palette color not already claimed by an existing member. Position-based
  // assignment (as seedFromBudgetConfig uses for the one-shot initial seed) is wrong here: on an
  // edit, reusing "index among today's members" would either hand the new member a color someone
  // else already has, or reshuffle everyone's color when a member is removed. Color must stay
  // stable for the life of a member (spec §5.4), so it is only ever assigned once, at first-write
  // time, from whatever the palette has left.
  const usedColors = new Set(Array.from(existingById.values()).map((m) => m.color));
  let deterministicFallbackIndex = 0;
  const nextColor = (): string => {
    const free = MEMBER_COLORS.find((c) => !usedColors.has(c));
    if (free) {
      usedColors.add(free);
      return free;
    }
    // Palette exhausted (>20 members — beyond the documented ceiling). Do not silently wrap
    // to a color someone else already has; fall back deterministically (by insertion order
    // among this save's new members) and warn, matching how seedFromBudgetConfig warns on
    // other repaired-not-dropped input.
    const chosen = MEMBER_COLORS[deterministicFallbackIndex % MEMBER_COLORS.length];
    console.warn(
      `[MembersService.saveMembers] palette exhausted (>${MEMBER_COLORS.length} members); reusing color ${chosen} — colors are no longer guaranteed unique beyond the documented ${MEMBER_COLORS.length}-member ceiling.`
    );
    deterministicFallbackIndex += 1;
    return chosen;
  };

  const now = new Date().toISOString();
  const incomingIds = new Set(edits.map((m) => m.id));

  const batch = writeBatch(db);

  edits.forEach((edit) => {
    const existing = existingById.get(edit.id);
    const merged: Member = {
      id: edit.id,
      name: edit.name,
      role: edit.role,
      color: existing?.color ?? nextColor(),
      groups: existing?.groups ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(edit.idNumber ? { idNumber: edit.idNumber } : {}),
    };
    batch.set(doc(db, MEMBERS_COLLECTION, edit.id), merged);
  });

  existingById.forEach((_member, id) => {
    if (!incomingIds.has(id)) {
      batch.delete(doc(db, MEMBERS_COLLECTION, id));
    }
  });

  await batch.commit();
}
