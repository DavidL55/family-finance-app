// D3 amendment (B1 blocking UX finding + P2 product ruling), Stage 5 Task 5.
//
// B1 — the plan's original mitigation gated on `assets.length === 0 && liabilities.length === 0`,
// which computeNetWorth() can never produce once both arrays exist (netWorth.ts pushes an
// 'accounts'/'loans' line item unconditionally) — for a family with real investments data, the
// explanatory state could never render at all. This component instead renders whenever the
// caller (useNetWorth's isIncomplete) says accounts OR loans is genuinely empty, on BOTH
// Dashboard's card and the dedicated NetWorthScreen (single source: useNetWorth).
//
// P2 — a one-click, explicit, HITL pre-fill affordance: "מצאנו ₪X ביתרת המזומן/המשכנתא הישנה —
// להוסיף?" navigates to Accounts/Loans with the create form already open and pre-filled from the
// legacy settings/ecosystem value (D11's navigation payload). Nothing is written until the
// household actually presses "שמור" on the pre-filled form — same as any other create, still no
// automatic/silent migration.
import React from 'react';
import { useNavigation } from '../contexts/NavigationContext';
import type { LegacyImportHint } from '../hooks/useNetWorth';

export interface NetWorthIncompleteNoticeProps {
  legacyCashHint: LegacyImportHint | null;
  legacyMortgageHint: LegacyImportHint | null;
}

export function NetWorthIncompleteNotice({
  legacyCashHint,
  legacyMortgageHint,
}: NetWorthIncompleteNoticeProps): React.JSX.Element {
  const { navigateTo } = useNavigation();

  if (!legacyCashHint && !legacyMortgageHint) {
    // Still incomplete, but nothing legacy to pre-fill from — the caller (Dashboard/NetWorthScreen)
    // renders its own plain "still no accounts/loans entered" copy alongside this; this component
    // only ever owns the pre-fill affordance itself, per its one job.
    return <></>;
  }

  return (
    <div
      className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2 text-sm"
      dir="rtl"
      data-tour-id="netWorth.incompleteNotice"
    >
      <p className="text-amber-800 font-medium">
        השווי הנקי המוצג נמוך מהצפוי — עדיין לא הוזנו{' '}
        {legacyCashHint && !legacyMortgageHint
          ? 'חשבונות'
          : legacyMortgageHint && !legacyCashHint
          ? 'הלוואות'
          : 'חשבונות או הלוואות'}{' '}
        במסכים החדשים.
      </p>
      {legacyCashHint && (
        <p className="flex items-center gap-2 flex-wrap">
          <span>מצאנו ₪{legacyCashHint.value.toLocaleString()} ביתרת המזומן הישנה —</span>
          <button
            type="button"
            onClick={() =>
              navigateTo('accounts', {
                prefillCreate: { name: 'מזומן (מיובא)', type: 'cash', balance: legacyCashHint.value },
              })
            }
            className="text-blue-700 underline font-medium min-h-[44px]"
          >
            להוסיף כחשבון?
          </button>
        </p>
      )}
      {legacyMortgageHint && (
        <p className="flex items-center gap-2 flex-wrap">
          <span>מצאנו ₪{legacyMortgageHint.value.toLocaleString()} ביתרת המשכנתא הישנה —</span>
          <button
            type="button"
            onClick={() =>
              navigateTo('loans', {
                prefillCreate: {
                  name: 'משכנתא (מיובא)',
                  loanType: 'mortgage',
                  principal: legacyMortgageHint.value,
                  balance: legacyMortgageHint.value,
                },
              })
            }
            className="text-blue-700 underline font-medium min-h-[44px]"
          >
            להוסיף כהלוואה?
          </button>
        </p>
      )}
    </div>
  );
}
