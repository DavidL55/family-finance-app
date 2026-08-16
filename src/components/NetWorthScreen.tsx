// Stage 5 Task 5 — the dedicated Net Worth screen (D3). Read-only over a computed aggregate
// across two owned collections (accounts/loans) plus investments/legacy real-estate — a
// genuinely different shape of data from one OwnedCollectionRepo's list, so this screen
// deliberately does NOT build on useOwnedCollectionScreen<T> (see that hook's own header comment,
// D13). It DOES build on useNetWorth, which itself reuses useScopedRead — the same read state
// machine the CRUD screens share — for its own accounts/loans fetches.
import React from 'react';
import { useGlobalFilters } from '../contexts/FilterContext';
import { useNavigation } from '../contexts/NavigationContext';
import { useNetWorth, netWorthGlossaryId } from '../hooks/useNetWorth';
import { resolveOwnedModuleScope } from '../utils/ownedModuleScope';
import { ScopeBadge } from './ScopeBadge';
import { Explain } from './Explain';
import { DrillAffordance } from './DrillAffordance';
import { NetWorthIncompleteNotice } from './NetWorthIncompleteNotice';
import type { NetWorthLineItem, NetWorthScope } from '../utils/netWorth';
import type { PermissionLevel, PermissionRole } from '../types/permissions';

const ACCESS_DENIED_MESSAGE = 'אין לך הרשאה לצפות בנתוני השווי הנקי';
const LOAD_ERROR_MESSAGE_FALLBACK = 'טעינת נתוני השווי הנקי נכשלה. בדוק את החיבור ונסה שוב.';

export interface NetWorthScreenProps {
  session: { memberId: string; role: PermissionRole };
  accountsViewLevel: PermissionLevel | undefined;
  loansViewLevel: PermissionLevel | undefined;
  investmentsViewLevel: PermissionLevel | undefined;
}

// Maps a NetWorthLineItem's source to the screen it drills into (D8). 'realEstate' has NO entry
// here — there is no dedicated real-estate screen (no dedicated collection either, per
// netWorth.ts's own D5 comment) — its row renders as plain, disclosed, non-clickable text rather
// than a fake drill target.
const DRILL_TARGET: Partial<Record<NetWorthLineItem['source'], string>> = {
  accounts: 'accounts',
  investments: 'investments',
  loans: 'loans',
};

function NetWorthLine({
  line,
  side,
  onNavigate,
}: {
  line: NetWorthLineItem;
  side: 'assets' | 'liabilities';
  onNavigate: (target: string) => void;
}): React.JSX.Element {
  const target = DRILL_TARGET[line.source];
  return (
    <div
      className="flex items-center justify-between gap-2"
      data-tour-id={`netWorth.line.${line.source}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {target ? (
          <button
            type="button"
            onClick={() => onNavigate(target)}
            className="text-slate-700 hover:text-blue-600 transition-colors inline-flex items-center gap-1 min-h-[44px] text-right"
          >
            {line.label}
            <DrillAffordance />
          </button>
        ) : (
          <span className="text-slate-700">{line.label}</span>
        )}
        <Explain id={netWorthGlossaryId(side, line.source)} />
      </div>
      <span className="font-medium text-slate-800 shrink-0">₪{line.amount.toLocaleString()}</span>
    </div>
  );
}

export default function NetWorthScreen({
  session,
  accountsViewLevel,
  loansViewLevel,
  investmentsViewLevel,
}: NetWorthScreenProps): React.JSX.Element {
  const { filters } = useGlobalFilters();
  const { navigateTo } = useNavigation();

  // D3 — a single specific member selected drills into THAT member's own accounts+loans; every
  // other selection (all/multi/group) falls back to the viewer's own default scope (family only
  // when BOTH accounts and loans are family-level for this viewer, own otherwise — fails closed).
  const singleSelected =
    filters.member.mode === 'members' && filters.member.memberIds.length === 1
      ? filters.member.memberIds[0]
      : null;
  const accountsScope = resolveOwnedModuleScope(session.role, accountsViewLevel);
  const loansScope = resolveOwnedModuleScope(session.role, loansViewLevel);
  const scope: NetWorthScope = singleSelected
    ? 'own'
    : accountsScope === 'family' && loansScope === 'family'
    ? 'family'
    : 'own';
  const targetMemberId = singleSelected ?? session.memberId;
  // investments is ownerless (Stage 2 D5) — only a 'family'-level view grants it, never 'own'.
  const investmentsReadable = session.role !== 'member' || investmentsViewLevel === 'family';

  const netWorth = useNetWorth(scope, targetMemberId, investmentsReadable);

  if (netWorth.status === 'permission-denied') {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-slate-500 text-sm" dir="rtl">
        {ACCESS_DENIED_MESSAGE}
      </div>
    );
  }
  if (netWorth.status === 'error') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center" dir="rtl">
        <p className="text-red-600 font-medium">{netWorth.error ?? LOAD_ERROR_MESSAGE_FALLBACK}</p>
      </div>
    );
  }
  if (netWorth.status === 'loading' || !netWorth.result) {
    return (
      <div className="p-8 text-center text-slate-500" dir="rtl">
        טוען נתוני שווי נקי...
      </div>
    );
  }

  const result = netWorth.result;

  return (
    <div className="space-y-4" data-tour-id="screen.net-worth.list" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <h2 className="text-lg font-bold text-slate-800">שווי נקי</h2>
          <Explain id="dashboard.netWorth" />
          <ScopeBadge scope={scope} />
        </div>
      </div>

      {netWorth.isIncomplete && (
        <NetWorthIncompleteNotice legacyCashHint={netWorth.legacyCashHint} legacyMortgageHint={netWorth.legacyMortgageHint} />
      )}

      <div className="bg-gradient-to-br from-indigo-600 to-blue-700 p-5 md:p-6 rounded-2xl shadow-md text-white">
        <p className="text-3xl md:text-4xl font-bold mb-1">₪{result.netWorth.toLocaleString()}</p>
        <div className="flex flex-wrap items-center gap-2 text-[10px] md:text-sm text-indigo-100">
          <span className="bg-white/20 px-2 py-0.5 rounded-md">נכסים: ₪{result.totalAssets.toLocaleString()}</span>
          <span className="bg-black/10 px-2 py-0.5 rounded-md">חובות: ₪{result.totalLiabilities.toLocaleString()}</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">נכסים</h3>
        {result.assets.map((line) => (
          <NetWorthLine key={line.source} line={line} side="assets" onNavigate={navigateTo} />
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">חובות</h3>
        {result.liabilities.map((line) => (
          <NetWorthLine key={line.source} line={line} side="liabilities" onNavigate={navigateTo} />
        ))}
      </div>
    </div>
  );
}
