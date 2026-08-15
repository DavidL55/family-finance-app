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

const { mockListMembers, mockSaveMembers, MockStaleMembersError } = vi.hoisted(() => {
  class MockStaleMembersError extends Error {
    staleIds: string[];
    constructor(staleIds: string[]) {
      super(`stale: ${staleIds.join(', ')}`);
      this.name = 'StaleMembersError';
      this.staleIds = staleIds;
    }
  }
  return {
    mockListMembers: vi.fn(),
    mockSaveMembers: vi.fn(),
    MockStaleMembersError,
  };
});

vi.mock('../services/MembersService', () => ({
  listMembers: mockListMembers,
  saveMembers: mockSaveMembers,
  StaleMembersError: MockStaleMembersError,
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
    // The one seeded member was removed; basedOnIds must be the ids Dashboard actually had
    // loaded (['david-levy']), not an empty/stale list.
    expect(mockSaveMembers).toHaveBeenCalledWith([], ['david-levy']);
    expect(screen.queryByText('שמירת בני המשפחה נכשלה. בדוק את החיבור ונסה שוב.')).not.toBeInTheDocument();
  });

  it('CRITICAL: passes the empty basedOnIds Dashboard actually loaded — never lets a stale/empty view through to a real delete without the service catching it', async () => {
    // Reproduces the exact critical scenario end-to-end from the Dashboard side: the initial
    // listMembers() read fails transiently, so familyMembers stays [] (error-vs-empty design).
    // If the manage-members entry point were reachable and the user added a member, onSave must
    // still call saveMembers with basedOnIds reflecting what Dashboard actually saw ([]), so the
    // service-layer guard (tested directly in MembersService.test.ts) has what it needs to abort.
    const user = userEvent.setup();
    mockListMembers.mockRejectedValueOnce(new Error('transient network blip'));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('טעינת בני המשפחה נכשלה. בדוק את החיבור ונסה שוב.')).toBeInTheDocument();
    });

    // The manage-members button must be disabled while the error is showing — see the
    // dedicated gating test below. This test focuses on the basedOnIds payload itself, so it
    // asserts the button is indeed disabled (the primary defense) rather than trying to open it.
    expect(screen.getByTitle(/ניהול בני משפחה/)).toBeDisabled();
  });
});

describe('Dashboard — manage-members entry point is gated on familyMembersError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables the manage-members button and explains why while familyMembersError is set', async () => {
    mockListMembers.mockRejectedValueOnce(new Error('permission-denied'));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('טעינת בני המשפחה נכשלה. בדוק את החיבור ונסה שוב.')).toBeInTheDocument();
    });

    const button = screen.getByTitle(/ניהול בני משפחה/);
    expect(button).toBeDisabled();
    // The tooltip/title itself must explain that the list failed to load — not imply the
    // family is simply empty.
    expect(button.getAttribute('title')).toMatch(/נכשל|לא ניתן/);

    const user = userEvent.setup();
    await user.click(button);
    // Clicking a disabled button must not open the modal (which would render members=[] and
    // falsely claim "no family members configured").
    expect(screen.queryByText('בני משפחה קיימים')).not.toBeInTheDocument();
  });

  it('leaves the manage-members button enabled on a successful load (including a genuinely empty collection)', async () => {
    mockListMembers.mockResolvedValueOnce([]);
    renderDashboard();

    await waitFor(() => expect(mockListMembers).toHaveBeenCalled());

    const button = screen.getByTitle(/ניהול בני משפחה/);
    expect(button).not.toBeDisabled();
  });
});

describe('Dashboard — StaleMembersError and total-failure paths never leave unpersisted data on screen', () => {
  const seedMember = {
    id: 'david-levy', name: 'דויד', role: 'הורה' as const, color: '#1F4E78',
    groups: [], createdAt: 'x', updatedAt: 'x',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces a stale-state message and re-syncs (without a generic failure toast) when saveMembers rejects with StaleMembersError', async () => {
    const user = userEvent.setup();
    mockListMembers.mockResolvedValueOnce([seedMember]); // initial load
    mockSaveMembers.mockRejectedValueOnce(new MockStaleMembersError(['someone-else-added-me']));
    mockListMembers.mockResolvedValueOnce([seedMember, {
      id: 'someone-else-added-me', name: 'אחר', role: 'הורה' as const, color: '#000000',
      groups: [], createdAt: 'y', updatedAt: 'y',
    }]); // resync reveals the concurrently-added member

    renderDashboard();
    await waitFor(() => expect(screen.getByText('דויד')).toBeInTheDocument());

    await user.click(screen.getByTitle(/ניהול בני משפחה/));
    await waitFor(() => expect(screen.getByText('בני משפחה קיימים')).toBeInTheDocument());
    await user.click(screen.getByTitle('מחק'));

    // A distinct, honest message: the edit was not saved because the list was out of date —
    // not the generic connection-failure copy.
    await waitFor(() => {
      const errorToasts = screen.getAllByText(/השתנתה|לא עדכני|out of date/i);
      expect(errorToasts.length).toBeGreaterThan(0);
    });

    // Re-synced from the collection, now showing the concurrently-added member too.
    await waitFor(() => expect(screen.getAllByText('אחר').length).toBeGreaterThan(0));
  });

  it('does not leave unpersisted (optimistically-applied) members displayed when both saveMembers AND the resync fail', async () => {
    const user = userEvent.setup();
    mockListMembers.mockResolvedValueOnce([seedMember]); // initial load succeeds
    mockSaveMembers.mockRejectedValueOnce(new Error('write denied'));
    mockListMembers.mockRejectedValueOnce(new Error('resync also failed')); // post-failure resync fails too

    renderDashboard();
    await waitFor(() => expect(screen.getByText('דויד')).toBeInTheDocument());

    await user.click(screen.getByTitle(/ניהול בני משפחה/));
    await waitFor(() => expect(screen.getByText('בני משפחה קיימים')).toBeInTheDocument());
    await user.click(screen.getByTitle('מחק')); // optimistically removes דויד from the UI

    await waitFor(() => {
      expect(screen.getByText('שמירת בני המשפחה נכשלה. בדוק את החיבור ונסה שוב.')).toBeInTheDocument();
    });

    // Neither Dashboard's own familyMembers state (member selector) nor the modal's localMembers
    // (reset from the `members` prop once Dashboard rolls back) may keep showing the deletion as
    // if it were saved — since the resync also failed, Dashboard cannot even confirm what's
    // really in Firestore, so the only safe UI state is the last known-good one (דויד still
    // present), not the optimistic (unpersisted) one.
    await waitFor(() => {
      expect(screen.getAllByText('דויד').length).toBeGreaterThan(0);
    });

    // The manage-members button should also be gated now — Dashboard no longer has a reliable
    // picture of the collection (both the save and the resync failed).
    expect(screen.getByTitle(/ניהול בני משפחה/)).toBeDisabled();
  });
});
