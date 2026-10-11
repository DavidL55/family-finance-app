// src/__tests__/BoardScreen.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderedExplainIds } from './helpers/renderPresence';

const mockLines = vi.fn();
const mockAccounts = vi.fn();
vi.mock('../services/BankLinesService', () => ({ listBankLines: (...a: unknown[]) => mockLines(...a) }));
vi.mock('../services/AccountsService', () => ({ listAccounts: (...a: unknown[]) => mockAccounts(...a), saveAccount: vi.fn(), deleteAccount: vi.fn() }));

import BoardScreen from '../components/BoardScreen';

const SESSION = { memberId: 'lilit-levy', role: 'parent' as const };
const JOINT = { id: 'acc-poalim-joint', ownerId: 'david-levy', name: 'עו"ש הפועלים משותף', type: 'bank', balance: 16.48, balanceUpdatedAt: '2026-08-29', status: 'active', createdAt: '', updatedAt: '' };
const DAVID = { ...JOINT, id: 'acc-poalim-david', name: 'עו"ש הפועלים דויד' };
const line = (p: object) => ({ id: 'bl-1', ownerId: 'david-levy', accountId: 'acc-poalim-joint', accountNumber: '12-559-305397', date: '2026-10-05', period: '2026-10',
  action: 'מכבי', debit: 249.35, credit: null, balance: 6992.14, kind: 'standing-order', counterpartAccountId: null, source: 't', verified: true, createdAt: '', updatedAt: '', ...p });

beforeEach(() => { vi.clearAllMocks(); });

describe('BoardScreen — bank board', () => {
  it('renders the joint account first with today\'s balance, and every figure has an Explain', async () => {
    mockAccounts.mockResolvedValue([DAVID, JOINT]);
    mockLines.mockResolvedValue([line({}), line({ id: 'bl-2', accountId: 'acc-poalim-david', balance: 16241.5, action: 'מכבי' })]);
    const { container } = render(<BoardScreen session={SESSION} accountsViewLevel={undefined} />);
    await waitFor(() => expect(screen.getByTestId('board.bank.joint.status')).toBeInTheDocument());
    const sections = [...container.querySelectorAll('[data-testid^="board.bank."][data-testid$=".status"]')].map((e) => e.getAttribute('data-testid'));
    expect(sections[0]).toBe('board.bank.joint.status');
    expect(screen.getByTestId('figure.bank.joint.balanceToday')).toHaveTextContent('6,992.14');
    const ids = renderedExplainIds(container);
    for (const id of ['bank.balanceToday', 'bank.monthOut', 'bank.monthIn']) expect(ids).toContain(id);
  });

  it('a failed read renders the error state, never an empty board', async () => {
    mockAccounts.mockResolvedValue([JOINT]);
    mockLines.mockRejectedValue(new Error('permission-denied'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<BoardScreen session={SESSION} accountsViewLevel={undefined} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('לא הצלחנו לטעון'));
    expect(screen.queryByTestId('board.bank.joint.status')).toBeNull();
    spy.mockRestore();
  });

  it('an account without lines shows the empty state while the others render', async () => {
    mockAccounts.mockResolvedValue([JOINT, DAVID]);
    mockLines.mockResolvedValue([line({ accountId: 'acc-poalim-david', balance: 16241.5 })]);
    render(<BoardScreen session={SESSION} accountsViewLevel={undefined} />);
    await waitFor(() => expect(screen.getByTestId('board.bank.david.status')).toBeInTheDocument());
    expect(screen.getByTestId('board.bank.joint.status')).toHaveTextContent('אין תנועות עדיין');
    expect(screen.getByTestId('figure.bank.david.balanceToday')).toHaveTextContent('16,241.5');
  });

  it('a member with accounts.view = none gets the permission-denied state and no fetch', async () => {
    render(<BoardScreen session={{ memberId: 'lior-levy', role: 'member' }} accountsViewLevel="none" />);
    expect(await screen.findByText('אין לך הרשאה לצפות בחשבונות')).toBeInTheDocument();
    expect(mockLines).not.toHaveBeenCalled();
  });

  it('loading → ready on the same instance does not change the hook order (09.10.2026 regression class)', async () => {
    let resolveLines!: (v: unknown) => void;
    mockAccounts.mockResolvedValue([JOINT]);
    mockLines.mockReturnValue(new Promise((r) => { resolveLines = r; }));
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a); });
    render(<BoardScreen session={SESSION} accountsViewLevel={undefined} />);
    expect(screen.getByText('טוען…')).toBeInTheDocument();
    resolveLines([line({})]);
    await waitFor(() => expect(screen.getByTestId('board.bank.joint.status')).toBeInTheDocument());
    expect(errors.map(String).join('\n')).not.toMatch(/Rendered more hooks|order of Hooks/);
    spy.mockRestore();
  });

  it('a section accordion toggles and its breakdown opens', async () => {
    mockAccounts.mockResolvedValue([JOINT]);
    mockLines.mockResolvedValue([line({})]);
    render(<BoardScreen session={SESSION} accountsViewLevel={undefined} />);
    await waitFor(() => expect(screen.getByTestId('board.bank.joint.balances')).toBeInTheDocument());
    const header = screen.getByRole('button', { name: /תנועות החודש/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('figure.bank.joint.monthNet')).toBeInTheDocument();
  });
  it('"today" is the Asia/Jerusalem date, not UTC: 01:30 on the 1st already shows the new month', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T22:30:00Z'));   // 2026-11-01 01:30 in Asia/Jerusalem
    try {
      mockAccounts.mockResolvedValue([JOINT]);
      mockLines.mockResolvedValue([line({ id: 'bl-nov', date: '2026-11-01', period: '2026-11', balance: 1234.5 })]);
      render(<BoardScreen session={SESSION} accountsViewLevel={undefined} />);
      await waitFor(() => expect(screen.getByTestId('figure.bank.joint.balanceToday')).toHaveTextContent('1,234.5'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('access lost after a successful load: stale data is dropped for the permission-denied state', async () => {
    mockAccounts.mockResolvedValue([JOINT]);
    mockLines.mockResolvedValue([line({})]);
    const { rerender } = render(<BoardScreen session={SESSION} accountsViewLevel={undefined} />);
    await waitFor(() => expect(screen.getByTestId('figure.bank.joint.balanceToday')).toBeInTheDocument());
    rerender(<BoardScreen session={{ memberId: 'lilit-levy', role: 'member' }} accountsViewLevel="none" />);
    expect(screen.getByText('אין לך הרשאה לצפות בחשבונות')).toBeInTheDocument();
    expect(screen.queryByTestId('figure.bank.joint.balanceToday')).toBeNull();
    expect(screen.queryByTestId('board.bank.joint.status')).toBeNull();
  });

  it('retry: after a failed read, "נסה שוב" reloads and the board renders', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockAccounts.mockResolvedValue([JOINT]);
      mockLines.mockRejectedValueOnce(new Error('network'));
      render(<BoardScreen session={SESSION} accountsViewLevel={undefined} />);
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('לא הצלחנו לטעון'));
      expect(spy).toHaveBeenCalledWith('[useBankBoardData] load failed', expect.any(Error));
      mockLines.mockResolvedValue([line({})]);
      fireEvent.click(screen.getByRole('button', { name: 'נסה שוב' }));
      await waitFor(() => expect(screen.getByTestId('board.bank.joint.status')).toBeInTheDocument());
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
