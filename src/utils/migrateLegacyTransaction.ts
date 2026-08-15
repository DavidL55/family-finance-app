import { CATEGORY_MAP } from './categoryMap';

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
 * - Deterministic given (legacy, id): same input always produces the same legacyId/category,
 *   which is what lets the caller derive a stable Firestore doc id (`migrated-<id>`) for idempotency.
 */
export function migrateLegacyTransaction(
  legacy: Record<string, unknown>,
  id: string
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
    line: { ...legacy, category, legacyId: id, migratedAt: new Date().toISOString() },
    warnings,
  };
}
