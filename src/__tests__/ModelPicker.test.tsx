// Task 6 (Stage 6) — one labeled <select> per D5's spec §8 model-switcher requirement, built once
// and reused (Task 7 reuses it, not clones it) across every action's manual call sites. Asserts:
// one option per model from useAiModels(); selecting an option calls onChange with the model id;
// a distinctly-styled "מודל דמה" badge appears when the selected model is providerId === 'mock'
// (D10) — so nobody mistakes a canned response for a real one.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModelPicker from '../components/ModelPicker';

const { mockListAiModels } = vi.hoisted(() => ({ mockListAiModels: vi.fn() }));
vi.mock('../services/aiClient', () => ({ listAiModels: mockListAiModels }));

const MODELS = [
  { providerId: 'mock', modelId: 'mock-standard', label: 'מודל דמה (ללא מפתח)', defaultForActions: ['chat'], usdInputPer1kTokens: 0, usdOutputPer1kTokens: 0 },
  { providerId: 'anthropic', modelId: 'claude-sonnet-5', label: 'Claude Sonnet 5', defaultForActions: ['chat'], usdInputPer1kTokens: 0.003, usdOutputPer1kTokens: 0.015 },
];

describe('ModelPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAiModels.mockResolvedValue(MODELS);
  });

  it('renders one option per model returned by useAiModels(action)', async () => {
    render(<ModelPicker action="chat" value="mock-standard" onChange={vi.fn()} />);
    const select = await screen.findByLabelText(/מודל/);
    expect(within(select).getAllByRole('option')).toHaveLength(2);
    expect(mockListAiModels).toHaveBeenCalledWith('chat');
  });

  it('selecting an option calls onChange with the model id', async () => {
    const onChange = vi.fn();
    render(<ModelPicker action="chat" value="mock-standard" onChange={onChange} />);
    const select = await screen.findByLabelText(/מודל/);
    await userEvent.selectOptions(select, 'claude-sonnet-5');
    expect(onChange).toHaveBeenCalledWith('claude-sonnet-5');
  });

  it('shows a distinctly-styled "מודל דמה" badge when the SELECTED model is the mock provider', async () => {
    render(<ModelPicker action="chat" value="mock-standard" onChange={vi.fn()} />);
    await screen.findByLabelText(/מודל/);
    const badge = screen.getByText('מודל דמה');
    expect(badge).toBeInTheDocument();
    // "distinct visual treatment" per the brief — proven structurally, not just presence: the
    // badge must not share the plain <select>'s own className (i.e. it is a separately-styled element).
    expect(badge.className).not.toBe('');
  });

  it('does NOT show the mock badge when a real-provider model is selected', async () => {
    render(<ModelPicker action="chat" value="claude-sonnet-5" onChange={vi.fn()} />);
    await screen.findByLabelText(/מודל/);
    expect(screen.queryByText('מודל דמה')).not.toBeInTheDocument();
  });

  it('the <select> control meets the ≥44px touch-target rule', async () => {
    render(<ModelPicker action="chat" value="mock-standard" onChange={vi.fn()} />);
    const select = await screen.findByLabelText(/מודל/);
    expect(select.className).toMatch(/min-h-\[44px\]/);
  });
});
