// D7 (Stage 6 Task 1) — the human review-and-approve gate for AI-extracted documents.
//
// Nothing reaches transaction_lines/documents until a human sees this modal and clicks
// "אישור וטעינה" (spec §11's "מסך אישור עם סיווגים → אישור אחד נכנס", literally). Every extracted
// line is rendered as an editable, checkable row — the reviewer can correct amount/vendor/category
// per row, uncheck a row to exclude it, or uncheck everything to reject the whole batch. A single
// commit sends every row's current (possibly-edited) state in ONE array to the caller's onCommit,
// which is expected to call commitExtractionDraft (or, for the AssetCard/InvestmentsImportModal
// callers that don't write transaction_lines directly, apply the approved value some other way) —
// this component itself never touches Firestore.
//
// Shared by every call site (FolderLogic, SyncButton, AssetCard, InvestmentsImportModal,
// SyncService's sync-from-Drive flow) — one component, not four clones, per Stage 5 D13's
// precedent. Money fields use inputMode="decimal" and dates stay native <input type="date">,
// matching the CRUD screens' own conventions (InsurancesScreen etc.) since this is also a
// money-entry surface.
import React, { useState } from 'react';
import type { ExtractedData, ExtractionDraft } from '../utils/FileProcessor';

const ALLOWED_CATEGORIES = [
  'מגורים ובית', 'ביטוח ופנסיה', 'תחבורה ורכב', 'מזון וצריכה',
  'בריאות', 'חינוך וחוגים', 'פנאי ובילוי', 'הכנסות והשקעות', 'שונות',
];

const COMMIT_ERROR_MESSAGE = 'השמירה נכשלה. בדוק את החיבור ונסה שוב.';

export interface ExtractionReviewDecision {
  include: boolean;
  item: ExtractedData;
}

export interface ExtractionReviewModalProps {
  draft: ExtractionDraft;
  onCommit: (decisions: ExtractionReviewDecision[]) => Promise<void> | void;
  onCancel: () => void;
}

interface RowState {
  include: boolean;
  item: ExtractedData;
}

export default function ExtractionReviewModal({
  draft,
  onCommit,
  onCancel,
}: ExtractionReviewModalProps): React.JSX.Element {
  const [rows, setRows] = useState<RowState[]>(
    draft.items.map((item) => ({ include: true, item: { ...item } }))
  );
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateRow<K extends keyof ExtractedData>(idx: number, key: K, value: ExtractedData[K]): void {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, item: { ...r.item, [key]: value } } : r)));
  }

  function toggleRow(idx: number): void {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, include: !r.include } : r)));
  }

  async function handleCommit(): Promise<void> {
    setError(null);
    setIsCommitting(true);
    try {
      const decisions: ExtractionReviewDecision[] = rows.map((r) => ({ include: r.include, item: r.item }));
      await onCommit(decisions);
    } catch (err) {
      setError(err instanceof Error ? `${COMMIT_ERROR_MESSAGE} (${err.message})` : COMMIT_ERROR_MESSAGE);
    } finally {
      setIsCommitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      dir="rtl"
      data-tour-id="extraction-review.modal"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 bg-slate-50 shrink-0">
          <h3 className="font-bold text-slate-800">בדיקת נתונים שחולצו</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            עברו על השורות, תקנו במידת הצורך, ובטלו סימון לשורה שלא רוצים לטעון
          </p>
          {draft.documentMeta && (
            <div className="mt-2 bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-sm space-y-0.5">
              <p>
                <span className="font-semibold">מנפיק: </span>
                {draft.documentMeta.issuer}
              </p>
              <p>
                <span className="font-semibold">מספר חשבון: </span>
                {draft.documentMeta.accountId}
              </p>
              <p>
                <span className="font-semibold">תקופה: </span>
                {draft.documentMeta.periodStart} — {draft.documentMeta.periodEnd}
              </p>
            </div>
          )}
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {rows.length === 0 ? (
            <p className="text-slate-400 text-center py-8">לא נמצאו עסקאות במסמך</p>
          ) : (
            rows.map((row, idx) => (
              <div
                key={idx}
                data-testid={`extraction-review.row.${idx}`}
                className={`border rounded-xl p-3 space-y-2 transition-colors ${
                  row.include ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={row.include}
                    onChange={() => toggleRow(idx)}
                    aria-label={`כלול שורה ${idx + 1}`}
                    className="w-5 h-5 min-w-[44px] min-h-[44px] shrink-0"
                  />
                  <label className="flex-1 text-sm">
                    <span className="text-slate-500 block text-xs mb-0.5">ספק</span>
                    <input
                      aria-label="ספק"
                      value={row.item.vendor}
                      onChange={(e) => updateRow(idx, 'vendor', e.target.value)}
                      disabled={!row.include}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-sm">
                    <span className="text-slate-500 block text-xs mb-0.5">סכום</span>
                    <input
                      aria-label="סכום"
                      type="number"
                      inputMode="decimal"
                      value={row.item.amount}
                      onChange={(e) => updateRow(idx, 'amount', Number(e.target.value))}
                      disabled={!row.include}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="text-slate-500 block text-xs mb-0.5">תאריך</span>
                    <input
                      aria-label="תאריך"
                      type="date"
                      value={row.item.date}
                      onChange={(e) => updateRow(idx, 'date', e.target.value)}
                      disabled={!row.include}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="text-slate-500 block text-xs mb-0.5">קטגוריה</span>
                    {/* Per-row inline category select — replaces the old modal-within-a-modal
                        onUnknownCategory callback; the reviewer fixes an unrecognised category
                        right here, in the same pass as everything else. */}
                    <select
                      aria-label="קטגוריה"
                      value={row.item.category}
                      onChange={(e) => updateRow(idx, 'category', e.target.value)}
                      disabled={!row.include}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
                    >
                      {ALLOWED_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0 space-y-3">
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              data-tour-id="extraction-review.cancel"
              onClick={onCancel}
              disabled={isCommitting}
              className="text-sm text-slate-500 min-h-[44px] px-4 disabled:opacity-40"
            >
              ביטול
            </button>
            <button
              type="button"
              data-tour-id="extraction-review.commit"
              onClick={() => void handleCommit()}
              disabled={isCommitting}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-xl px-5 min-h-[44px] text-sm transition-colors"
            >
              {isCommitting ? 'טוען...' : 'אישור וטעינה'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
