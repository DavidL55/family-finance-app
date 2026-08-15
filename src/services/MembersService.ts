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
