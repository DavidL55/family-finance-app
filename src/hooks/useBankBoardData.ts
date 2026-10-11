import { useCallback, useEffect, useState } from 'react';
import { listBankLines } from '../services/BankLinesService';
import { listAccounts } from '../services/AccountsService';
import type { BankLine } from '../types/bank';
import type { Account } from '../types/finance';
import type { PermissionLevel, PermissionRole } from '../types/permissions';

export interface BankBoardData {
  status: 'loading' | 'ready' | 'error' | 'permission-denied';
  lines: BankLine[]; accounts: Account[]; errorMessage: string | null; reload: () => void;
}
export const BANK_LOAD_ERROR = 'לא הצלחנו לטעון את תנועות הבנק. נסה שוב.';

/** Scope follows the accounts module exactly (spec §9): parents read family, a member reads own. */
export function useBankBoardData(session: { memberId: string; role: PermissionRole }, accountsViewLevel: PermissionLevel | undefined): BankBoardData {
  const bypass = session.role === 'super-admin' || session.role === 'parent';
  const denied = !bypass && (accountsViewLevel === undefined || accountsViewLevel === 'none');
  const scope: 'own' | 'family' = bypass || accountsViewLevel === 'family' ? 'family' : 'own';
  const [state, setState] = useState<Omit<BankBoardData, 'reload'>>({ status: denied ? 'permission-denied' : 'loading', lines: [], accounts: [], errorMessage: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (denied) return;
    let alive = true;
    setState((s) => ({ ...s, status: 'loading', errorMessage: null }));
    Promise.all([listAccounts(scope, session.memberId), listBankLines(scope, session.memberId)])
      .then(([accounts, lines]) => { if (alive) setState({ status: 'ready', accounts, lines, errorMessage: null }); })
      .catch(() => { if (alive) setState({ status: 'error', accounts: [], lines: [], errorMessage: BANK_LOAD_ERROR }); });
    return () => { alive = false; };
  }, [denied, scope, session.memberId, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
