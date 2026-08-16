import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemberMultiSelect } from '../components/MemberMultiSelect';
import { LARGE_FAMILY_MEMBERS, LARGE_FAMILY_GROUPS } from './fixtures/largeFamily';

const members = [{ id: 'omer', name: 'עומר', color: '#1F4E78' }, { id: 'david', name: 'דויד', color: '#17C3B2' }] as any[];
const groups = [{ id: 'kids', name: 'הילדים', memberIds: ['omer'], createdAt: 'x', updatedAt: 'x' }];

describe('MemberMultiSelect', () => {
  it('clicking a member with mode "all" switches to mode "members" with just that id', () => {
    const onChange = vi.fn();
    render(<MemberMultiSelect members={members} groups={groups} value={{ mode: 'all', memberIds: [], groupId: null }} onChange={onChange} />);
    fireEvent.click(screen.getByText('עומר'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'members', memberIds: ['omer'], groupId: null });
  });
  it('clicking a second member while one is already selected ADDS to the selection', () => {
    const onChange = vi.fn();
    render(<MemberMultiSelect members={members} groups={groups} value={{ mode: 'members', memberIds: ['omer'], groupId: null }} onChange={onChange} />);
    fireEvent.click(screen.getByText('דויד'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'members', memberIds: ['omer', 'david'], groupId: null });
  });
  it('deselecting the last selected member falls back to mode "all"', () => {
    const onChange = vi.fn();
    render(<MemberMultiSelect members={members} groups={groups} value={{ mode: 'members', memberIds: ['omer'], groupId: null }} onChange={onChange} />);
    fireEvent.click(screen.getByText('עומר'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'all', memberIds: [], groupId: null });
  });
  it('clicking a group chip switches to mode "group"; clicking it again returns to "all"', () => {
    const onChange = vi.fn();
    const { rerender } = render(<MemberMultiSelect members={members} groups={groups} value={{ mode: 'all', memberIds: [], groupId: null }} onChange={onChange} />);
    fireEvent.click(screen.getByText('הילדים'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'group', memberIds: [], groupId: 'kids' });
    rerender(<MemberMultiSelect members={members} groups={groups} value={{ mode: 'group', memberIds: [], groupId: 'kids' }} onChange={onChange} />);
    fireEvent.click(screen.getByText('הילדים'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'all', memberIds: [], groupId: null });
  });
  it('with a small family (<= 8 members), no search/collapse chrome is shown at all', () => {
    render(<MemberMultiSelect members={members} groups={groups} value={{ mode: 'all', memberIds: [], groupId: null }} onChange={vi.fn()} />);
    expect(screen.queryByPlaceholderText('חיפוש לפי שם...')).not.toBeInTheDocument();
  });
});

// Ofra ruling I3: MemberMultiSelect is the LIVE, daily-use control — it must get the same
// search/collapse treatment ComparisonTable (unwired) already had, not the other way around.
// Reuses the LARGE_FAMILY fixture (Lola finding 2) so this is the same 20-member/multi-group
// shape spec §3 names as the success metric, not a hand-picked small array.
describe('MemberMultiSelect — large-family search/collapse (Ofra I3 / Lola 20-member metric)', () => {
  it('renders a search input and collapses to top N members with a "show all" control when the family is large', () => {
    const onChange = vi.fn();
    render(<MemberMultiSelect members={LARGE_FAMILY_MEMBERS} groups={LARGE_FAMILY_GROUPS} value={{ mode: 'all', memberIds: [], groupId: null }} onChange={onChange} />);
    expect(screen.getByPlaceholderText('חיפוש לפי שם...')).toBeInTheDocument();
    expect(screen.queryByText('בן משפחה 19')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/הצג את כל/));
    expect(screen.getByText('בן משפחה 19')).toBeInTheDocument();
  });
  it('a search query narrows the member list and bypasses the collapse — no overflow', () => {
    render(<MemberMultiSelect members={LARGE_FAMILY_MEMBERS} groups={LARGE_FAMILY_GROUPS} value={{ mode: 'all', memberIds: [], groupId: null }} onChange={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('חיפוש לפי שם...'), { target: { value: 'בן משפחה 19' } });
    expect(screen.getByText('בן משפחה 19')).toBeInTheDocument();
    expect(screen.queryByText('בן משפחה 0')).not.toBeInTheDocument();
  });
  it('both group chips render without overflow alongside the collapsed member list', () => {
    render(<MemberMultiSelect members={LARGE_FAMILY_MEMBERS} groups={LARGE_FAMILY_GROUPS} value={{ mode: 'all', memberIds: [], groupId: null }} onChange={vi.fn()} />);
    expect(screen.getByText('קבוצה א')).toBeInTheDocument();
    expect(screen.getByText('קבוצה ב')).toBeInTheDocument();
  });
});
