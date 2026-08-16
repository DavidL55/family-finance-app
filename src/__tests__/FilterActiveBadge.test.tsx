// Ofra ruling I4 — D7's half-state (filters persist in sessionStorage but are only VISIBLE on
// Dashboard) made visible on EVERY screen: a small header badge whenever the global filter
// differs from default, with a one-tap clear.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterActiveBadge } from '../components/FilterActiveBadge';
import { FilterProvider, useGlobalFilters } from '../contexts/FilterContext';

vi.mock('../services/MembersService', () => ({ listMembers: vi.fn(async () => []) }));
vi.mock('../services/GroupsService', () => ({ listGroups: vi.fn(async () => []) }));

beforeEach(() => sessionStorage.clear());

function Harness() {
  const { setCategoryFilter } = useGlobalFilters();
  return (
    <>
      <button onClick={() => setCategoryFilter({ categories: ['מזון וצריכה'] })}>set</button>
      <FilterActiveBadge />
    </>
  );
}

describe('FilterActiveBadge', () => {
  it('renders nothing while filters are at their default', () => {
    render(<FilterProvider><FilterActiveBadge /></FilterProvider>);
    expect(screen.queryByText(/פילטר פעיל/)).not.toBeInTheDocument();
  });
  it('renders once a filter differs from default, and resetFilters clears it on click', () => {
    render(<FilterProvider><Harness /></FilterProvider>);
    fireEvent.click(screen.getByText('set'));
    expect(screen.getByText(/פילטר פעיל/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/נקה/));
    expect(screen.queryByText(/פילטר פעיל/)).not.toBeInTheDocument();
  });
});
