// Task 6, Part B: verifies Dashboard distinguishes "the members read failed" (explicit error
// state, never a default/empty-looking member list) from "the members collection is genuinely
// empty" (an honest, non-error empty state) — the non-negotiable rule this rewire had to satisfy.
//
// Heavy dependencies (recharts, the Gemini-backed ai service, Firestore) are stubbed so this
// stays a focused unit test of the members-loading effect and its render branch, not an
// integration test of the whole Dashboard.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider } from '../contexts/NotificationContext';

// jsdom doesn't implement scrollIntoView; Dashboard calls it on its chat auto-scroll effect.
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

const { mockListMembers, mockSaveMembers } = vi.hoisted(() => ({
  mockListMembers: vi.fn(),
  mockSaveMembers: vi.fn(),
}));

vi.mock('../services/MembersService', () => ({
  listMembers: mockListMembers,
  saveMembers: mockSaveMembers,
}));

vi.mock('../services/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'col'),
  query: vi.fn(() => 'query'),
  where: vi.fn(() => 'where'),
  doc: vi.fn(() => 'doc'),
  onSnapshot: vi.fn((_q: unknown, onNext: (snap: { docs: unknown[] }) => void) => {
    onNext({ docs: [] });
    return () => {};
  }),
  getDocs: vi.fn(async () => ({ docs: [] })),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
  addDoc: vi.fn(async () => ({ id: 'new' })),
  deleteDoc: vi.fn(async () => undefined),
  setDoc: vi.fn(async () => undefined),
  serverTimestamp: vi.fn(() => 'ts'),
}));

vi.mock('../services/ai', () => ({
  generateFinancialInsights: vi.fn(async () => []),
  getFinancialChatSession: vi.fn(() => ({ sendMessage: vi.fn(async () => ({ text: '' })) })),
}));

vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Stub, Bar: Stub, XAxis: Stub, YAxis: Stub, CartesianGrid: Stub, Tooltip: Stub,
    Legend: Stub, ResponsiveContainer: Stub, PieChart: Stub, Pie: Stub, Cell: Stub,
  };
});

import Dashboard from '../components/Dashboard';

function renderDashboard() {
  return render(
    <NotificationProvider>
      <Dashboard />
    </NotificationProvider>
  );
}

describe('Dashboard — family members load: error vs. genuinely-empty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the explicit error banner on a failed read, and does not fall back to any default/fake member list', async () => {
    mockListMembers.mockRejectedValueOnce(new Error('permission-denied'));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('טעינת בני המשפחה נכשלה. בדוק את החיבור ונסה שוב.')).toBeInTheDocument();
    });

    // No fabricated default members (e.g. the old דויד/לילית/עומר fallback) ever appear —
    // only the always-present "כל המשפחה" (all) option.
    expect(screen.queryByText('דויד')).not.toBeInTheDocument();
    expect(screen.queryByText('לילית')).not.toBeInTheDocument();
    expect(screen.queryByText('עומר')).not.toBeInTheDocument();
    expect(screen.getByText('כל המשפחה')).toBeInTheDocument();
  });

  it('renders normally (no error banner) with an honestly empty member list when the collection genuinely has zero docs', async () => {
    mockListMembers.mockResolvedValueOnce([]);
    renderDashboard();

    await waitFor(() => {
      expect(mockListMembers).toHaveBeenCalled();
    });

    expect(screen.queryByText('טעינת בני המשפחה נכשלה. בדוק את החיבור ונסה שוב.')).not.toBeInTheDocument();
    expect(screen.getByText('כל המשפחה')).toBeInTheDocument();
  });

  it('renders members returned by a successful read', async () => {
    mockListMembers.mockResolvedValueOnce([
      { id: 'david-levy', name: 'דויד', role: 'הורה', color: '#1F4E78', groups: [], createdAt: 'x', updatedAt: 'x' },
    ]);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('דויד')).toBeInTheDocument();
    });
    expect(screen.queryByText('טעינת בני המשפחה נכשלה. בדוק את החיבור ונסה שוב.')).not.toBeInTheDocument();
  });
});

describe('Dashboard — FamilyManagerModal onSave: an edit must never be silently lost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const seedMember = {
    id: 'david-levy', name: 'דויד', role: 'הורה' as const, color: '#1F4E78',
    groups: [], createdAt: 'x', updatedAt: 'x',
  };

  it('surfaces an error notification and re-syncs from the collection when saveMembers() rejects', async () => {
    const user = userEvent.setup();
    mockListMembers.mockResolvedValueOnce([seedMember]); // initial load
    mockSaveMembers.mockRejectedValueOnce(new Error('permission-denied'));
    mockListMembers.mockResolvedValueOnce([seedMember]); // post-failure re-sync — nothing actually changed

    renderDashboard();
    await waitFor(() => expect(screen.getByText('דויד')).toBeInTheDocument());

    await user.click(screen.getByTitle('ניהול בני משפחה'));
    await waitFor(() => expect(screen.getByText('בני משפחה קיימים')).toBeInTheDocument());

    await user.click(screen.getByTitle('מחק'));

    // The save failed: the user must be told (never a silent drop of their edit).
    await waitFor(() => {
      expect(screen.getByText('שמירת בני המשפחה נכשלה. בדוק את החיבור ונסה שוב.')).toBeInTheDocument();
    });
    expect(mockSaveMembers).toHaveBeenCalledTimes(1);
    // And local state was re-synced from the collection (called a second time) rather than
    // left showing the optimistic-but-never-persisted deletion.
    await waitFor(() => expect(mockListMembers).toHaveBeenCalledTimes(2));
  });

  it('calls saveMembers with the updated list on a successful edit', async () => {
    const user = userEvent.setup();
    mockListMembers.mockResolvedValueOnce([seedMember]);
    mockSaveMembers.mockResolvedValueOnce(undefined);

    renderDashboard();
    await waitFor(() => expect(screen.getByText('דויד')).toBeInTheDocument());

    await user.click(screen.getByTitle('ניהול בני משפחה'));
    await waitFor(() => expect(screen.getByText('בני משפחה קיימים')).toBeInTheDocument());

    await user.click(screen.getByTitle('מחק'));

    await waitFor(() => expect(mockSaveMembers).toHaveBeenCalledTimes(1));
    expect(mockSaveMembers).toHaveBeenCalledWith([]); // the one seeded member was removed
    expect(screen.queryByText('שמירת בני המשפחה נכשלה. בדוק את החיבור ונסה שוב.')).not.toBeInTheDocument();
  });
});
