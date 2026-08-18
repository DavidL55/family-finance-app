import { CATEGORY_MAP } from './categoryMap';
// Stage 7 T3 (D21e). Both helpers are pure and Firebase-free, which this module must stay: its
// only non-test caller runs under `npx tsx` in plain Node, where `src/services/firebase.ts`
// cannot be imported at all.
import { periodOrUnknown } from './periodMath';
import { ownerIdOrUnknown, type NamedMember } from './resolveOwnerId';

const HEBREW_CATEGORIES = Object.values(CATEGORY_MAP);
const FALLBACK_CATEGORY = CATEGORY_MAP.General_Misc; // 'שונות'

/**
 * Pure converter: legacy `transactions` doc shape -> canonical `transaction_lines` doc shape.
 *
 * Rules (data-safety, Task 4):
 * - Never drops a row: an unmappable/missing category becomes FALLBACK_CATEGORY plus a warning.
 * - Every legacy field survives verbatim (spread first, then override) — including fields not
 *   explicitly known here (driveFileId, sourceDriveFileId, syncFolderId, isCredit, paymentType,
 *   installmentNumber, totalInstallments, expenseClassification, vat, isQuarterlyReport,
 *   quarterlyData, fileName, fileSize, driveSynced, created_at, vendor, ...).
 * - Deterministic given (legacy, id, members): same input always produces the same
 *   legacyId/category/period/ownerId, which is what lets the caller derive a stable Firestore doc
 *   id (`migrated-<id>`) for idempotency.
 *
 * Stage 7 T3 (D21e) — `members` is REQUIRED, not optional. An optional list would let a caller
 * that forgot it stamp every row `ownerId: 'unknown'` and stay green; a required one makes that a
 * build error. And this is only ONE of the four write sites: v2 called it "the one place that
 * already constructs a row", which it is not — its single non-test caller is
 * `scripts/migrate-transactions.ts` and it converts the LEGACY collection, while the app's three
 * live constructors (`FileProcessor` ×2, `RecurringService`) never pass through it.
 */
export function migrateLegacyTransaction(
  legacy: Record<string, unknown>,
  id: string,
  members: ReadonlyArray<NamedMember>
): { line: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];
  const raw = String(legacy.category ?? '');
  let category: string;
  if (raw && HEBREW_CATEGORIES.includes(raw)) {
    category = raw;
  } else if (raw && Object.prototype.hasOwnProperty.call(CATEGORY_MAP, raw)) {
    category = CATEGORY_MAP[raw as keyof typeof CATEGORY_MAP];
  } else {
    category = FALLBACK_CATEGORY;
    warnings.push(`unknown category "${raw}" on legacy doc ${id} → ${FALLBACK_CATEGORY}`);
  }
  return {
    line: {
      ...legacy,
      category,
      // D21(e) — AFTER the spread, deliberately. A legacy document is free to carry any key,
      // including a `period` of its own; placed before the spread these two would be silently
      // overwritten and a pre-Stage-7 row would decide its own month.
      //
      // `periodOrUnknown`, not `date.slice(0, 7)`: the legacy collection is exactly where the
      // unpadded `DD/MM/YYYY` form lives, and the slice turned `"9/3/2026"` into `"9/3/202"` — not
      // a failure but a silently WRONG period, which the `where('period','in',…)` query drops and
      // which neither the completion marker nor `unusableRowCount` can see.
      period: periodOrUnknown(legacy.date as string | undefined),
      // `'unknown'` rather than a throw: this converter's oldest contract is that it never drops a
      // row, and a rename must not be able to abort a migration.
      ownerId: ownerIdOrUnknown(legacy.owner as string | undefined, members),
      legacyId: id,
      migratedAt: new Date().toISOString(),
    },
    warnings,
  };
}
