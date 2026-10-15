// C1 Task 8 — InvestmentsPortfolio had no render suite, so this is the first: just the AI gate.
// In a production build (AI off) the "ייבא מ-Drive" trigger and its modal are not rendered; in
// development they are. The AI-on twin makes the absence non-vacuous.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const aiFlag = vi.hoisted(() => ({ value: true }));
vi.mock('../config/aiAvailability', () => ({
  get AI_ENABLED() { return aiFlag.value; },
  AI_UNAVAILABLE_MESSAGE: 'x',
  assertAiEnabled: () => undefined,
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'col'),
  getDocs: vi.fn(async () => ({ empty: true, docs: [] })),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  doc: vi.fn(),
  serverTimestamp: vi.fn(),
}));
vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { PieChart: Stub, Pie: Stub, Cell: Stub, ResponsiveContainer: Stub, Tooltip: Stub, Legend: Stub };
});
vi.mock('../components/AssetCard', () => ({ default: () => <div data-testid="asset-card-stub" /> }));
vi.mock('../components/InvestmentsImportModal', () => ({ default: () => <div data-testid="import-modal-stub" /> }));

import InvestmentsPortfolio from '../components/InvestmentsPortfolio';

describe('InvestmentsPortfolio — Drive import is an AI surface (C1 Task 8)', () => {
  beforeEach(() => { aiFlag.value = true; });
  afterEach(() => { aiFlag.value = true; });

  it('AI on (dev build): the "ייבא מ-Drive" trigger and its modal render', async () => {
    render(<InvestmentsPortfolio />);
    await waitFor(() => expect(screen.getByText('ייבא מ-Drive')).toBeInTheDocument());
    expect(screen.getByTestId('import-modal-stub')).toBeInTheDocument();
  });

  it('AI off (prod build): neither the trigger nor the modal renders, and manual add still does', async () => {
    aiFlag.value = false;
    render(<InvestmentsPortfolio />);
    await waitFor(() => expect(screen.getByText('הוסף נכס חדש')).toBeInTheDocument());
    expect(screen.queryByText('ייבא מ-Drive')).toBeNull();
    expect(screen.queryByTestId('import-modal-stub')).toBeNull();
  });
});
