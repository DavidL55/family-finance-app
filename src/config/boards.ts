import { Landmark, type LucideIcon } from 'lucide-react';
import type { PermissionLevel, PermissionRole } from '../types/permissions';
import type { SectionLayer } from '../lib/boards/types';

// Spec §5 — boards are DATA. One renderer (BoardScreen) draws any of them; adding a board is
// a declaration here plus a resolver, never a new screen. S1 ships the bank board only.
export type BoardId = 'bank';   // S1 — grows per spec §2 in later stages
export type BoardScope =
  | { kind: 'family' } | { kind: 'household' }
  | { kind: 'member'; memberId: string } | { kind: 'account'; accountId: string };
// explainIds is the registry's declaration of every figure the section will render — the guard
// test checks them against GLOSSARY; the resolver's explainIds must be a subset.
export interface BoardSection { id: string; layer: SectionLayer; titleHe: string; explainIds: string[]; defaultOpen?: boolean }
export interface BoardDef {
  id: BoardId; labelHe: string; icon: LucideIcon; scope: BoardScope; sections: BoardSection[];
  visibleFor: (role: PermissionRole, accountsView: PermissionLevel | undefined) => boolean;
}

const BANK_EXPLAIN = {
  status: ['bank.balanceToday', 'bank.monthOut', 'bank.monthIn'],
  balances: ['bank.monthNet', 'bank.internalMoved'],
  trends: ['bank.net12m'],
};

export const BOARDS: readonly BoardDef[] = [
  {
    id: 'bank', labelHe: 'חשבונות הבנק', icon: Landmark, scope: { kind: 'account', accountId: 'acc-poalim-joint' },
    // One registry section per layer; the resolver instantiates it per account (joint first).
    sections: [
      { id: 'bank.status',   layer: 'status',   titleHe: 'היום',          explainIds: BANK_EXPLAIN.status, defaultOpen: true },
      { id: 'bank.balances', layer: 'balances', titleHe: 'תנועות החודש',  explainIds: BANK_EXPLAIN.balances },
      { id: 'bank.trends',   layer: 'trends',   titleHe: '12 חודשים',     explainIds: BANK_EXPLAIN.trends },
    ],
    visibleFor: (role, accountsView) => role === 'super-admin' || role === 'parent' || (accountsView !== undefined && accountsView !== 'none'),
  },
];
