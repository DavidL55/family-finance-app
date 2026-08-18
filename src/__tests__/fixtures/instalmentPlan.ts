// Stage 7 T1 — instalment fixture (D10).
//
// ── THIS FIXTURE ENCODES AN ASSUMPTION THAT COULD NOT BE CHECKED. READ THIS BEFORE USING IT. ────
//
// T1's original checkbox said: "assert against a REAL extraction fixture that `amount` on an
// instalment row is the per-instalment charge; do not inherit the assumption." T0 then measured the
// corpus and proved that step unsatisfiable:
//
//   · `transaction_lines` holds 3 rows. `installmentNumber` is ABSENT on all three; `totalInstall-
//     ments` is absent on all three. There are ZERO instalment rows in the family's ledger.
//   · No fixture anywhere in `src/` or `functions/src/` sets `installmentNumber` to a number.
//
// So there is nothing real to assert against, and authoring a fixture encodes exactly the
// assumption the checkbox forbade inheriting. The amended instruction — and what this file does —
// is: author it, STATE the assumption, DERIVE it from the only contract in the tree that speaks to
// it, and MARK it for confirmation against real data.
//
// THE ASSUMPTION: `amount` on an instalment row is the PER-INSTALMENT CHARGE, not the plan total.
//
// THE DERIVATION: the extraction prompt's own worked example, at
// `functions/src/handlers/aiExtractDocument.ts:149-158`, is the provider contract that decides what
// the model puts in `amount`:
//
//     "description": "AIG רכב חובה תשלום 3 מתוך 6",
//     "amount": 284.00,
//     "installmentNumber": 3,
//     "totalInstallments": 6
//
// A ₪284 charge described as "payment 3 of 6" is a per-instalment figure — a ₪284 TOTAL split six
// ways would be ₪47.33 a month, and the description says the ₪284 IS payment number 3. That is the
// whole basis. It is a reading of prompt text, not a measurement of data.
//
// ⚠ UNCONFIRMED AGAINST REAL DATA ⚠
// If this is wrong, `projectInstalmentsForward` overstates every committed instalment plan by a
// factor of `totalInstallments`, in the certain layer, which carries no uncertainty band. Confirm
// against David's first real credit-card import and delete this banner when it is confirmed.
// Recorded in T8's report as the one thing Stage 7 assumes and cannot check.

import type { ObservedInstalmentRow } from '../../utils/forecast';

/**
 * The prompt's own example, transcribed. Payment 3 of 6, ₪284 each — so ₪284 × 6 = ₪1,704 for the
 * year of car insurance, and three further charges are owed after this row.
 */
export const AIG_CAR_INSURANCE_PLAN: ObservedInstalmentRow = {
  date: '2025-12-30',
  description: 'AIG רכב חובה תשלום 3 מתוך 6',
  vendor: 'AIG',
  amount: 284,
  category: 'ביטוח ופנסיה',
  installmentNumber: 3,
  totalInstallments: 6,
};

/**
 * The `null` case, pinned in its own fixture because it is a FOURTH shadowed path (T0 §6):
 * `FileProcessor.ts:561-562` writes `installmentNumber: item.installmentNumber ?? null` — `null`,
 * not absent — so a `!== undefined` check misreads it as present. The corpus contains no instance
 * of it, so nothing but this fixture can exercise the branch.
 */
export const TOTAL_WITHOUT_NUMBER_ROW: ObservedInstalmentRow = {
  date: '2026-01-05',
  description: 'תשלומים ללא מספר תשלום',
  vendor: 'חנות כלשהי',
  amount: 500,
  category: 'שונות',
  installmentNumber: null,
  totalInstallments: 10,
};

/**
 * Two plans from the same vendor, same length, same per-instalment amount, started a month apart.
 * `planKey` is derived from (vendor, totalInstallments, amount) because THERE IS NO PLAN ID IN THE
 * DATA — so these two collide into one plan and the projection is knowably wrong for them. This
 * fixture is a permanent record of that known-wrong output, not a case to be "fixed" (D10, R5).
 */
export const COLLIDING_PLANS: ObservedInstalmentRow[] = [
  {
    date: '2026-01-10',
    description: 'ריהוט תשלום 1 מתוך 4',
    vendor: 'איקאה',
    amount: 300,
    category: 'מגורים ובית',
    installmentNumber: 1,
    totalInstallments: 4,
  },
  {
    date: '2026-02-10',
    description: 'ריהוט נוסף תשלום 1 מתוך 4',
    vendor: 'איקאה',
    amount: 300,
    category: 'מגורים ובית',
    installmentNumber: 1,
    totalInstallments: 4,
  },
];
