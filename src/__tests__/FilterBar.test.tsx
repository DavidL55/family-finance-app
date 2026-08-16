import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FilterBar from '../components/FilterBar';
import { FilterProvider } from '../contexts/FilterContext';

const { mockListMembers } = vi.hoisted(() => ({ mockListMembers: vi.fn() }));

vi.mock('../services/MembersService', () => ({ listMembers: mockListMembers }));
vi.mock('../services/GroupsService', () => ({ listGroups: vi.fn(async () => []) }));
vi.mock('../services/CategoriesService', () => ({ getCategories: vi.fn(async () => ['מזון וצריכה', 'חינוך וחוגים']) }));

beforeEach(() => {
  sessionStorage.clear();
  mockListMembers.mockReset();
  mockListMembers.mockResolvedValue([
    { id: 'omer', name: 'עומר', color: '#1F4E78', role: 'ילד', groups: [], createdAt: 'x', updatedAt: 'x' },
  ]);
});

function renderBar(viewerAccess?: Parameters<typeof FilterProvider>[0]['viewerAccess']) {
  return render(<FilterProvider viewerAccess={viewerAccess}><FilterBar /></FilterProvider>);
}

describe('FilterBar', () => {
  it('renders מי/מתי/מה labels and, once loaded, the member chips and categories', async () => {
    renderBar();
    expect(screen.getByText('מי')).toBeInTheDocument();
    expect(screen.getByText('מתי')).toBeInTheDocument();
    expect(screen.getByText('מה')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('מזון וצריכה')).toBeInTheDocument());
  });

  it('clicking a category toggles it into the filter context', async () => {
    renderBar();
    await waitFor(() => screen.getByText('מזון וצריכה'));
    fireEvent.click(screen.getByText('מזון וצריכה'));
    const persisted = JSON.parse(sessionStorage.getItem('ff_global_filters')!);
    expect(persisted.category.categories).toEqual(['מזון וצריכה']);
  });

  it('the month arrows shift the period and wrap the year at a December/January boundary', async () => {
    renderBar();
    const label = () => screen.getByTestId('global-filter-bar').textContent;
    const before = label();
    fireEvent.click(screen.getByLabelText('חודש הבא'));
    expect(label()).not.toBe(before);
  });

  it('wraps the year forward at a December -> January boundary', async () => {
    // Force the period to December of the current year via a persisted value, then advance once.
    sessionStorage.setItem('ff_global_filters', JSON.stringify({
      member: { mode: 'all', memberIds: [], groupId: null },
      period: { mode: 'month', month: '12', year: '2026', quarter: null, startDate: null, endDate: null },
      category: { categories: [] },
    }));
    render(<FilterProvider><FilterBar /></FilterProvider>);
    await waitFor(() => screen.getByTestId('global-filter-bar'));
    fireEvent.click(screen.getByLabelText('חודש הבא'));
    expect(screen.getByTestId('global-filter-bar').textContent).toMatch(/ינואר/);
    expect(screen.getByTestId('global-filter-bar').textContent).toMatch(/2027/);
  });

  // Ofra ruling B2 — three always-expanded rows pinned under the header would eat the glance
  // on the one screen this stage exists to make glanceable. Collapsed-by-default on mobile:
  // a single summary line that expands on tap.
  it('starts with the מי/מתי/מה detail sections collapsed behind a tap-to-expand summary line', async () => {
    renderBar();
    await waitFor(() => screen.getByText('עומר'));
    expect(screen.getByTestId('filter-summary-line')).toBeInTheDocument();
    expect(screen.getByTestId('filter-detail-sections')).toHaveClass('hidden');
    fireEvent.click(screen.getByTestId('filter-summary-line'));
    expect(screen.getByTestId('filter-detail-sections')).not.toHaveClass('hidden');
  });

  // D12 — Stage 10's guided tour needs a stable selector for each section, independent of the
  // Hebrew label text (which can change / be edited).
  it('the מי/מתי/מה sections each carry their data-tour-id', async () => {
    renderBar();
    await waitFor(() => screen.getByText('עומר'));
    const root = screen.getByTestId('filter-detail-sections');
    expect(root.querySelector('[data-tour-id="filter.who"]')).toBeTruthy();
    expect(root.querySelector('[data-tour-id="filter.when"]')).toBeTruthy();
    expect(root.querySelector('[data-tour-id="filter.what"]')).toBeTruthy();
  });

  // Empty-vs-error, explicitly (this project's repeatedly-re-broken rule): a failed listMembers
  // read must render an explicit error state, never look like an empty/quiet family.
  it('renders an explicit error + retry when listMembers rejects, never a silent empty member row', async () => {
    mockListMembers.mockReset();
    mockListMembers.mockRejectedValue(new Error('emulator down'));
    renderBar();
    fireEvent.click(screen.getByTestId('filter-summary-line'));
    await waitFor(() => expect(screen.getByText(/שגיאה/)).toBeInTheDocument());
    expect(screen.getByText('נסה שוב')).toBeInTheDocument();
    expect(screen.queryByText('עומר')).not.toBeInTheDocument();
  });
});

// Controller ruling (Task 1 review fold-in) — MemberMultiSelect must not offer members the
// viewer has no grant to view (dead-end selections: the server denies the read regardless of
// what's picked, per the Sasha investigation in progress.md). Not a security fix — the real
// enforcement is firestore.rules — but the selector shouldn't invite a guaranteed-empty choice.
describe('FilterBar — dead-end avoidance in the מי selector (controller ruling)', () => {
  beforeEach(() => {
    mockListMembers.mockReset();
    mockListMembers.mockResolvedValue([
      { id: 'omer', name: 'עומר', color: '#1F4E78', role: 'ילד', groups: [], createdAt: 'x', updatedAt: 'x' },
      { id: 'david', name: 'דויד', color: '#17C3B2', role: 'הורה', groups: [], createdAt: 'x', updatedAt: 'x' },
    ]);
  });

  it('an "own"-level viewer only sees their own member chip in מי, not the rest of the family', async () => {
    renderBar({ role: 'member', memberId: 'omer', expensesView: 'own' });
    fireEvent.click(screen.getByTestId('filter-summary-line'));
    await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
    expect(screen.queryByText('דויד')).not.toBeInTheDocument();
  });

  it('a "family"-level viewer sees every family member in מי', async () => {
    renderBar({ role: 'member', memberId: 'omer', expensesView: 'family' });
    fireEvent.click(screen.getByTestId('filter-summary-line'));
    await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
    expect(screen.getByText('דויד')).toBeInTheDocument();
  });

  it('no viewerAccess supplied (unwired caller) defaults to unrestricted, matching pre-existing behavior', async () => {
    renderBar();
    fireEvent.click(screen.getByTestId('filter-summary-line'));
    await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
    expect(screen.getByText('דויד')).toBeInTheDocument();
  });
});
