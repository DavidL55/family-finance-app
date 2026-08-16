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
//
// Critical review fix (Stage 5 Task 5 follow-up) — this component used to return an empty
// fragment whenever NEITHER legacy hint existed, on the theory that the caller (Dashboard /
// NetWorthScreen) would render its own plain "still incomplete" copy alongside it. That fallback
// copy was never written in either caller (verified by grep — both callers do exactly
// `{netWorth.isIncomplete && <NetWorthIncompleteNotice .../>}` and nothing else), so
// `isIncomplete` correctly detected the empty-accounts/empty-loans state and then nothing
// appeared on screen at all — the default state for any newly onboarded family (no legacy
// settings/ecosystem doc) or any member-scoped viewer with zero accounts/loans of their own. The
// fallback now lives HERE, as this component's own no-hint branch, so the copy exists in exactly
// one place instead of being duplicated (and drifting) across two callers.
//
// This component also states plainly that the figure never included settings/ecosystem's legacy
// hand-typed investments/pensions/crypto tiles (see src/config/glossary.ts's header for that
// retired dashboard.ecosystem.* set) — useNetWorth.ts's LegacyEcosystemData only ever reads
// realEstate/liquid/mortgage off that doc, so those three legacy fields are silently dropped with
// no hint and no import path this stage. The real `investments` collection (InvestmentsPortfolio,
// covering investment/pension/insurance/crypto types) DOES feed computeNetWorth's investments
// line — but only for whatever has been re-entered there since; anything still sitting only in
// the old ecosystem doc's investments/pensions/crypto fields does not count until re-entered.
// Getting this wrong would be worse than saying nothing, so this line was written only after
// reading useNetWorth.ts and netWorth.ts, not guessed.
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

  const hasLegacyHint = Boolean(legacyCashHint || legacyMortgageHint);

  return (
    <div
      className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2 text-sm"
      dir="rtl"
      data-tour-id="netWorth.incompleteNotice"
    >
      {hasLegacyHint ? (
        <p className="text-amber-800 font-medium">
          השווי הנקי המוצג נמוך מהצפוי — עדיין לא הוזנו{' '}
          {legacyCashHint && !legacyMortgageHint
            ? 'חשבונות'
            : legacyMortgageHint && !legacyCashHint
            ? 'הלוואות'
            : 'חשבונות או הלוואות'}{' '}
          במסכים החדשים.
        </p>
      ) : (
        <p className="text-amber-800 font-medium">
          השווי הנקי המוצג מבוסס רק על מה שכבר הוזן עד כה — עדיין לא הוזנו חשבונות או הלוואות
          במסכים החדשים. הוספת חשבונות והלוואות תשלים את התמונה.
        </p>
      )}
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
      <p className="text-amber-700 text-xs">
        לתשומת לבך: הסכום אינו כולל השקעות, פנסיה או קריפטו שהוזנו בעבר במסך הישן — אלה לא עברו
        אוטומטית. כדי שייכללו בחישוב יש להזין אותם מחדש במסך ההשקעות.
      </p>
    </div>
  );
}
