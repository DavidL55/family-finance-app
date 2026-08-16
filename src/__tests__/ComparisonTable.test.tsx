import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComparisonTable } from '../components/ComparisonTable';
import { LARGE_FAMILY_MEMBERS } from './fixtures/largeFamily';

const manyRows = Array.from({ length: 8 }, (_, i) => ({ memberId: `m${i}`, name: `אדם ${i}`, color: '#000', value: 100 - i }));

describe('ComparisonTable', () => {
  it('renders an explicit empty state for zero rows, not a bare empty table', () => {
    render(<ComparisonTable rows={[]} valueLabel="הוצאות" />);
    expect(screen.getByText('אין נתונים להשוואה.')).toBeInTheDocument();
  });
  it('sorts rows by value descending', () => {
    const rows = [{ memberId: 'a', name: 'א', color: '#000', value: 10 }, { memberId: 'b', name: 'ב', color: '#000', value: 50 }];
    render(<ComparisonTable rows={rows} valueLabel="הוצאות" />);
    const cells = screen.getAllByText(/^₪/);
    expect(cells[0]).toHaveTextContent('₪50');
  });
  it('collapses to top N with a "show all" control when rows exceed topN', () => {
    render(<ComparisonTable rows={manyRows} valueLabel="הוצאות" topN={5} />);
    expect(screen.queryByText('אדם 7')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/הצג את כל/));
    expect(screen.getByText('אדם 7')).toBeInTheDocument();
  });
  it('a search query filters by name and bypasses the topN collapse', () => {
    render(<ComparisonTable rows={manyRows} valueLabel="הוצאות" topN={5} />);
    fireEvent.change(screen.getByPlaceholderText('חיפוש לפי שם...'), { target: { value: 'אדם 7' } });
    expect(screen.getByText('אדם 7')).toBeInTheDocument();
    expect(screen.queryByText('אדם 0')).not.toBeInTheDocument();
  });
  it('handles the 20-member fixture without overflow (spec §3 "usable with 20 members")', () => {
    const rows = LARGE_FAMILY_MEMBERS.map((m: any, i: number) => ({ memberId: m.id, name: m.name, color: m.color, value: 20 - i }));
    render(<ComparisonTable rows={rows} valueLabel="הוצאות" topN={5} />);
    expect(screen.queryByText('בן משפחה 19')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('חיפוש לפי שם...'), { target: { value: 'בן משפחה 19' } });
    expect(screen.getByText('בן משפחה 19')).toBeInTheDocument();
  });
});
