// Stage 5 Task 5 — D3: computeNetWorth() becomes the sole, authoritative net-worth calculation
// app-wide. Both Dashboard's net-worth card and the dedicated NetWorthScreen call THIS hook —
// never two independent call sites computing the same number (spec §5.5's "one calculation
// source per metric"). Retires Dashboard's parallel settings/ecosystem-arithmetic net worth.
//
// Builds on useScopedRead (Stage 5 Task 5's controller-mandated extraction, see that hook's own
// header comment) for its accounts/loans fetches — the identical scoped-read state machine
// useOwnedCollectionScreen's CRUD screens already use, not a hand-rolled duplicate. Real estate +
// the legacy liquid/mortgage import hints (settings/ecosystem) and investments (the pre-existing,
// unmodified `investments` collection — real data, not the hand-typed
// settings/ecosystem.investments shadow) are genuinely different data shapes with no owner field
// to scope by (D5's own ownerless-module asymmetry) — they are NOT OwnedCollectionRepo reads, so
// they are fetched directly here rather than forced through useScopedRead.
//
// `scope`/`targetMemberId` are ALREADY RESOLVED by the caller (Dashboard or NetWorthScreen) from
// filters.member + the viewer's own accounts/loans levels — this hook does no permission
// resolution of its own, only fetch + compute. `investmentsReadable` is independent: the
// `investments` collection is ownerless (Stage 2 D5) — only a 'family'-level view grants it,
// never 'own' — so it cannot be derived from scope/targetMemberId alone.
//
// D3 amendment (B1, blocking UX finding): the original mitigation gated the explanatory
// empty-state on `assets.length === 0 && liabilities.length === 0`, which can never fire once
// computeNetWorth's own accounts/loans line items exist unconditionally (netWorth.ts pushes both
// regardless of whether any account/loan exists). `isIncomplete` here is derived from the RAW
// fetched counts (`accountsCount`/`loansCount`), never from `result.assets.length`.
import { useCallback, useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { listAccounts } from '../services/AccountsService';
import { listLoans } from '../services/LoansService';
import { useScopedRead } from './useScopedRead';
import { computeNetWorth, type NetWorthResult, type NetWorthScope } from '../utils/netWorth';
import type { Account, Loan } from '../types/finance';

export interface LegacyImportHint {
  bucket: 'liquid' | 'mortgage';
  value: number;
}

export interface UseNetWorthResult {
  status: 'loading' | 'error' | 'permission-denied' | 'ready';
  result: NetWorthResult | null;
  error: string | null;
  accountsCount: number; // D3 amendment (B1) — raw fetched count, NOT result.assets.length
  loansCount: number;
  isIncomplete: boolean; // accountsCount === 0 || loansCount === 0 — the corrected D3 trigger
  legacyCashHint: LegacyImportHint | null; // settings/ecosystem.liquid, only when accountsCount === 0 and it's > 0
  legacyMortgageHint: LegacyImportHint | null; // settings/ecosystem.mortgage, only when loansCount === 0 and it's > 0
  reload: () => void;
}

const SIDE_BY_SOURCE: Record<string, 'assets' | 'liabilities'> = {
  accounts: 'assets',
  investments: 'assets',
  realEstate: 'assets',
  loans: 'liabilities',
};

// Maps a NetWorthLineItem's `source` + which side it's on to its D4 glossary id — exported so
// both NetWorthScreen and Dashboard look up the same id for the same line, never inventing their
// own mapping twice.
export function netWorthGlossaryId(side: 'assets' | 'liabilities', source: string): string {
  return `netWorth.${side}.${source}`;
}
export { SIDE_BY_SOURCE };

function isPermissionDenied(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'permission-denied';
}

const NET_WORTH_LOAD_ERROR = 'טעינת נתוני השווי הנקי נכשלה. בדוק את החיבור ונסה שוב.';

interface LegacyEcosystemData {
  realEstateValue: number;
  realEstateAsOf: string;
  liquid: number;
  mortgage: number;
}

const EMPTY_LEGACY: LegacyEcosystemData = { realEstateValue: 0, realEstateAsOf: '', liquid: 0, mortgage: 0 };

export function useNetWorth(
  scope: NetWorthScope,
  targetMemberId: string,
  investmentsReadable: boolean
): UseNetWorthResult {
  const accountsRead = useScopedRead<Account>({
    list: listAccounts,
    scope,
    viewerMemberId: targetMemberId,
    loadErrorMessage: NET_WORTH_LOAD_ERROR,
  });
  const loansRead = useScopedRead<Loan>({
    list: listLoans,
    scope,
    viewerMemberId: targetMemberId,
    loadErrorMessage: NET_WORTH_LOAD_ERROR,
  });

  // Real estate + the legacy liquid/mortgage import hints (settings/ecosystem) — optional, legacy
  // data. A permission-denied on this doc alone must NOT fail the whole net-worth calculation
  // (D3): a 'member'-role viewer with no grant on the legacy doc still gets a real, computed net
  // worth from accounts/loans/investments, just without real estate or an import hint.
  const [legacy, setLegacy] = useState<LegacyEcosystemData | null>(null);
  const [legacyErrored, setLegacyErrored] = useState(false);
  const [legacyLoading, setLegacyLoading] = useState(true);

  // investments — the pre-existing, unmodified `investments` collection (ownerless, Stage 2 D5).
  const [investments, setInvestments] = useState<Array<{ value: number }>>([]);
  const [investmentsErrored, setInvestmentsErrored] = useState(false);
  const [investmentsLoading, setInvestmentsLoading] = useState(true);

  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLegacyLoading(true);
    setLegacyErrored(false);
    getDoc(doc(db, 'settings', 'ecosystem'))
      .then((snap) => {
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data() as Record<string, { realEstate?: number; liquid?: number; mortgage?: number }>;
          const bucket = scope === 'own' ? (data[targetMemberId] ?? data.all) : data.all;
          setLegacy({
            realEstateValue: bucket?.realEstate ?? 0,
            realEstateAsOf: new Date().toISOString(),
            liquid: bucket?.liquid ?? 0,
            mortgage: bucket?.mortgage ?? 0,
          });
        } else {
          setLegacy({ ...EMPTY_LEGACY, realEstateAsOf: new Date().toISOString() });
        }
        setLegacyLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isPermissionDenied(err)) {
          // Unreachable legacy doc — no real estate, no import hint, NOT an error (D3).
          setLegacy({ ...EMPTY_LEGACY, realEstateAsOf: new Date().toISOString() });
          setLegacyLoading(false);
          return;
        }
        setLegacyErrored(true);
        setLegacyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, targetMemberId, reloadToken]);

  useEffect(() => {
    if (!investmentsReadable) {
      setInvestments([]);
      setInvestmentsLoading(false);
      setInvestmentsErrored(false);
      return;
    }
    let cancelled = false;
    setInvestmentsLoading(true);
    setInvestmentsErrored(false);
    getDocs(collection(db, 'investments'))
      .then((snap) => {
        if (cancelled) return;
        setInvestments(snap.docs.map((d) => ({ value: (d.data().value as number) ?? 0 })));
        setInvestmentsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isPermissionDenied(err)) {
          // investmentsReadable is caller-resolved from the viewer's actual grant — a denial here
          // shouldn't normally happen, but fails the same way the legacy doc does: swallowed, not
          // an error, no investments line.
          setInvestments([]);
          setInvestmentsLoading(false);
          return;
        }
        setInvestmentsErrored(true);
        setInvestmentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [investmentsReadable, reloadToken]);

  const status: UseNetWorthResult['status'] =
    accountsRead.status === 'permission-denied' || loansRead.status === 'permission-denied'
      ? 'permission-denied'
      : accountsRead.status === 'error' || loansRead.status === 'error' || legacyErrored || investmentsErrored
      ? 'error'
      : accountsRead.status === 'loading' || loansRead.status === 'loading' || legacyLoading || investmentsLoading
      ? 'loading'
      : 'ready';

  const result: NetWorthResult | null =
    status === 'ready' && legacy
      ? computeNetWorth({
          viewerMemberId: targetMemberId,
          scope,
          accounts: accountsRead.items.filter((a) => a.status === 'active'),
          investments,
          loans: loansRead.items,
          realEstateValue: legacy.realEstateValue,
          realEstateAsOf: legacy.realEstateAsOf,
        })
      : null;

  const accountsCount = accountsRead.items.length;
  const loansCount = loansRead.items.length;
  const isIncomplete = accountsCount === 0 || loansCount === 0;

  const legacyCashHint: LegacyImportHint | null =
    legacy && accountsCount === 0 && legacy.liquid > 0 ? { bucket: 'liquid', value: legacy.liquid } : null;
  const legacyMortgageHint: LegacyImportHint | null =
    legacy && loansCount === 0 && legacy.mortgage > 0 ? { bucket: 'mortgage', value: legacy.mortgage } : null;

  const reload = useCallback(() => {
    accountsRead.reload();
    loansRead.reload();
    setReloadToken((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountsRead.reload, loansRead.reload]);

  return {
    status,
    result,
    error: status === 'error' ? NET_WORTH_LOAD_ERROR : null,
    accountsCount,
    loansCount,
    isIncomplete,
    legacyCashHint,
    legacyMortgageHint,
    reload,
  };
}
