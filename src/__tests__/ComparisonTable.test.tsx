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
  it('handles the 20-member fixture: collapses by default, search finds a hidden entry', () => {
    const rows = LARGE_FAMILY_MEMBERS.map((m: any, i: number) => ({ memberId: m.id, name: m.name, color: m.color, value: 20 - i }));
    render(<ComparisonTable rows={rows} valueLabel="הוצאות" topN={5} />);
    expect(screen.queryByText('בן משפחה 19')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('חיפוש לפי שם...'), { target: { value: 'בן משפחה 19' } });
    expect(screen.getByText('בן משפחה 19')).toBeInTheDocument();
  });
  it('each row name sits in a min-w-0/truncate wrapper (the actual overflow guard for long names)', () => {
    const rows = LARGE_FAMILY_MEMBERS.map((m: any, i: number) => ({ memberId: m.id, name: m.name, color: m.color, value: 20 - i }));
    render(<ComparisonTable rows={rows} valueLabel="הוצאות" topN={5} />);
    const nameEl = screen.getByText('בן משפחה 0');
    expect(nameEl.className).toContain('truncate');
    expect(nameEl.parentElement?.className).toContain('min-w-0');
  });

  describe('currency formatting (sign before the ₪ symbol)', () => {
    it('formats a negative value with the minus sign BEFORE the ₪ symbol, not trapped after it', () => {
      const rows = [{ memberId: 'a', name: 'א', color: '#000', value: -50 }];
      render(<ComparisonTable rows={rows} valueLabel="הוצאות" />);
      expect(screen.getByText('-₪50')).toBeInTheDocument();
      expect(screen.queryByText('₪-50')).not.toBeInTheDocument();
    });
    it('formats zero without any sign prefix', () => {
      const rows = [{ memberId: 'a', name: 'א', color: '#000', value: 0 }];
      render(<ComparisonTable rows={rows} valueLabel="הוצאות" />);
      expect(screen.getByText('₪0')).toBeInTheDocument();
    });
    it('formats a positive value with no leading "+" (a spend comparison, not a balance delta)', () => {
      const rows = [{ memberId: 'a', name: 'א', color: '#000', value: 120 }];
      render(<ComparisonTable rows={rows} valueLabel="הוצאות" />);
      expect(screen.getByText('₪120')).toBeInTheDocument();
      expect(screen.queryByText('+₪120')).not.toBeInTheDocument();
    });
    it('renders a mixed set of positive, negative and zero values each with correct sign placement', () => {
      const rows = [
        { memberId: 'a', name: 'חיובי', color: '#000', value: 200 },
        { memberId: 'b', name: 'שלילי', color: '#000', value: -75 },
        { memberId: 'c', name: 'אפס', color: '#000', value: 0 },
      ];
      render(<ComparisonTable rows={rows} valueLabel="הוצאות" />);
      expect(screen.getByText('₪200')).toBeInTheDocument();
      expect(screen.getByText('-₪75')).toBeInTheDocument();
      expect(screen.getByText('₪0')).toBeInTheDocument();
    });
  });
});
