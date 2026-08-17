// Task 8 (Stage 6) — AiSettingsScreen: provider status, cost ceiling, usage-by-model dashboard,
// egress disclosure (D13/spec §14.6), exchange-rate disclosure (D15).
//
// Role gating: mirrors PermissionsManager's own precedent (src/__tests__/PermissionsManager.test.tsx)
// EXACTLY — super-admin only, both a 'parent' AND a 'member' render nothing. Spec §4's role table
// groups "מפתחות AI" in the SAME super-admin-exclusive bullet as "ניהול הרשאות" (permissions
// management, PermissionsManager's own domain) — not the ecosystem/budgetConfig
// parent-or-super-admin precedent. See this task's report for the full reasoning; a 'parent'
// read-only mode was considered and deliberately NOT built.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AiSettingsScreen from '../components/AiSettingsScreen';
// The REAL shared bound (src/config/aiCeiling.ts is dependency-free precisely so this import
// needs no Firebase mock) — not a literal re-typed into the mock factory below.
import { MAX_MONTHLY_CEILING_ILS } from '../config/aiCeiling';

const { mockGetAiUsageSummary, mockSetAiCostCeiling, mockListAiModels } = vi.hoisted(() => ({
  mockGetAiUsageSummary: vi.fn(),
  mockSetAiCostCeiling: vi.fn(),
  mockListAiModels: vi.fn(),
}));

vi.mock('../services/aiClient', () => ({
  getAiUsageSummary: mockGetAiUsageSummary,
  setAiCostCeiling: mockSetAiCostCeiling,
  listAiModels: mockListAiModels,
}));

const EGRESS_LINE_HE =
  'קריאות ה-AI (צ\'אט וחילוץ מסמכים) נשלחות לספק המודל שנבחר ועוזבות את המחשב שלך — ' +
  'שאר הנתונים הפיננסיים נשארים מקומיים.';

const STALE_RATE_WARNING_HE =
  'שער החליפין לא עודכן זמן רב — ייתכן שהתקרה אינה משקפת עלות אמיתית';

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const BASE_SUMMARY = {
  ceilingILS: 50,
  // Task 8 review F1/F3 — the server now says WHICH of the three ceiling states this is, instead
  // of collapsing "deliberate ₪0", "never set" and "corrupt value" into the number 0.
  ceilingStatus: 'configured' as const,
  // Task 8 review F2 — the family-wide total the ONE ceiling is enforced against.
  totalUsedThisMonthILS: 12.5,
  byProvider: [
    { providerId: 'mock', usedThisMonthILS: 0, callCount: 3 },
    { providerId: 'anthropic', usedThisMonthILS: 12.5, callCount: 5 },
    { providerId: 'openai', usedThisMonthILS: 0, callCount: 0 },
    { providerId: 'google', usedThisMonthILS: 0, callCount: 0 },
  ],
  byModel: [
    { modelId: 'claude-sonnet-5', providerId: 'anthropic', usedThisMonthILS: 12.5, callCount: 5 },
  ],
  exchangeRate: { usdToILSRate: 3.75, rateAsOf: daysAgoISO(10) },
};

const CONFIGURED_MODELS = [
  { providerId: 'mock', modelId: 'mock-standard', label: 'מודל דמה', defaultForActions: ['chat', 'insight', 'extraction'], usdInputPer1kTokens: 0, usdOutputPer1kTokens: 0 },
  { providerId: 'anthropic', modelId: 'claude-sonnet-5', label: 'Claude Sonnet 5', defaultForActions: ['chat'], usdInputPer1kTokens: 0.003, usdOutputPer1kTokens: 0.015 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAiUsageSummary.mockResolvedValue(BASE_SUMMARY);
  mockListAiModels.mockResolvedValue(CONFIGURED_MODELS);
  mockSetAiCostCeiling.mockResolvedValue(undefined);
});

describe('AiSettingsScreen — role gating', () => {
  it('renders nothing for a parent role (super-admin exclusive, matching PermissionsManager\'s own precedent)', () => {
    render(<AiSettingsScreen actorMemberId="lilit-levy" role="parent" />);
    expect(screen.queryByText('הגדרות AI')).not.toBeInTheDocument();
    expect(mockGetAiUsageSummary).not.toHaveBeenCalled();
  });

  it('renders nothing for a member role', () => {
    render(<AiSettingsScreen actorMemberId="omer-levy" role="member" />);
    expect(screen.queryByText('הגדרות AI')).not.toBeInTheDocument();
    expect(mockGetAiUsageSummary).not.toHaveBeenCalled();
  });

  it('renders for super-admin', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());
  });
});

describe('AiSettingsScreen — loading/error/ready states', () => {
  it('shows a loading state before data resolves', () => {
    mockGetAiUsageSummary.mockReturnValue(new Promise(() => {}));
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    expect(screen.getByText(/טוען/)).toBeInTheDocument();
  });

  it('a failed load renders an explicit error, never a blank/zero screen', async () => {
    mockGetAiUsageSummary.mockRejectedValueOnce(new Error('נפילה'));
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText(/טעינת נתוני ה-AI נכשלה/)).toBeInTheDocument());
  });

  it('the egress disclosure banner renders even during loading (persistent, regardless of state)', () => {
    mockGetAiUsageSummary.mockReturnValue(new Promise(() => {}));
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    expect(screen.getByText(EGRESS_LINE_HE)).toBeInTheDocument();
  });
});

describe('AiSettingsScreen — provider rows + byModel table', () => {
  it('renders all four provider rows (mock/anthropic/openai/google), configured vs not-configured from listAiModels presence', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());

    // mock + anthropic appear in CONFIGURED_MODELS -> "מוגדר"; openai + google do not -> "לא מוגדר".
    const rows = screen.getAllByTestId(/screen\.ai-settings\.provider-row/);
    expect(rows).toHaveLength(4);
    expect(screen.getAllByText('מוגדר')).toHaveLength(2);
    expect(screen.getAllByText('לא מוגדר')).toHaveLength(2);
  });

  it('renders this month\'s spend for the anthropic row', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());
    expect(screen.getByTestId('screen.ai-settings.provider-row.anthropic')).toHaveTextContent('12.5');
  });

  it('renders a byModel breakdown table with per-model spend and call count', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());
    expect(screen.getByTestId('screen.ai-settings.model-table')).toHaveTextContent('claude-sonnet-5');
    expect(screen.getByTestId('screen.ai-settings.model-table')).toHaveTextContent('12.5');
  });

  it('renders an explicit empty state for byModel when there is no usage yet — not a blank table', async () => {
    mockGetAiUsageSummary.mockResolvedValue({ ...BASE_SUMMARY, byModel: [] });
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText(/אין עדיין נתוני שימוש לפי מודל/)).toBeInTheDocument());
  });
});

describe('AiSettingsScreen — cost ceiling (super-admin editable, D4)', () => {
  it('an editable ceiling input is present, pre-filled with the current ceiling', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());
    const input = screen.getByLabelText('תקרת AI חודשית (₪)') as HTMLInputElement;
    expect(input.value).toBe('50');
    expect(input).not.toBeDisabled();
  });

  it('saving a new ceiling calls setAiCostCeiling and reloads the summary', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());

    const input = screen.getByLabelText('תקרת AI חודשית (₪)');
    fireEvent.change(input, { target: { value: '75' } });
    fireEvent.click(screen.getByText('שמור תקרה'));

    await waitFor(() => expect(mockSetAiCostCeiling).toHaveBeenCalledWith(75));
    await waitFor(() => expect(mockGetAiUsageSummary).toHaveBeenCalledTimes(2)); // initial + reload
  });

  it('a permission-denied save error (D4) renders the server\'s Hebrew refusal, not a generic error', async () => {
    mockSetAiCostCeiling.mockRejectedValueOnce({ code: 'functions/permission-denied', message: 'רק סופר-אדמין יכול לקבוע את תקרת ה-AI' });
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('תקרת AI חודשית (₪)'), { target: { value: '10' } });
    fireEvent.click(screen.getByText('שמור תקרה'));

    await waitFor(() => expect(screen.getByText('רק סופר-אדמין יכול לקבוע את תקרת ה-AI')).toBeInTheDocument());
  });

  it('rejects a negative ceiling client-side without calling the server', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('תקרת AI חודשית (₪)'), { target: { value: '-5' } });
    fireEvent.click(screen.getByText('שמור תקרה'));

    expect(mockSetAiCostCeiling).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/תקרה חייבת להיות מספר בין/)).toBeInTheDocument());
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Task 8 review F3 — clearing the field sent `Number('')` = 0 with no warning, and 0 was then
  // read as "unconfigured" by costGate and by this very screen. The operator who had just saved
  // it was told a ceiling had never been set, and every paid call failed.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  it('refuses to save an EMPTY field rather than silently sending 0', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('תקרת AI חודשית (₪)'), { target: { value: '' } });
    fireEvent.click(screen.getByText('שמור תקרה'));

    expect(mockSetAiCostCeiling).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/יש להזין תקרה/)).toBeInTheDocument());
  });

  it('refuses a whitespace-only field for the same reason', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('תקרת AI חודשית (₪)'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('שמור תקרה'));

    expect(mockSetAiCostCeiling).not.toHaveBeenCalled();
  });

  it('refuses a ceiling above the maximum (the SAME bound Rules, the callable and costGate enforce)', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('תקרת AI חודשית (₪)'), { target: { value: String(MAX_MONTHLY_CEILING_ILS + 1) } });
    fireEvent.click(screen.getByText('שמור תקרה'));

    expect(mockSetAiCostCeiling).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/תקרה חייבת להיות מספר בין/)).toBeInTheDocument());
  });

  it('DOES save an explicit 0 — a deliberate "no paid AI this month" is a valid configured ceiling, not an error', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('תקרת AI חודשית (₪)'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('שמור תקרה'));

    await waitFor(() => expect(mockSetAiCostCeiling).toHaveBeenCalledWith(0));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Task 8 review F2 — the ceiling is ONE family-wide number, but the screen rendered a per-provider
// "% מהתקרה" bar in each of four rows against that same number, reinforcing a cap that was
// silently 4x what it claimed.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('AiSettingsScreen — the ceiling is shown as ONE family-wide budget (Task 8 review F2)', () => {
  it('renders a single total-usage figure against the ceiling, summed across every provider', async () => {
    mockGetAiUsageSummary.mockResolvedValue({ ...BASE_SUMMARY, ceilingILS: 50, totalUsedThisMonthILS: 20 });
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());

    const total = screen.getByTestId('screen.ai-settings.total-usage');
    expect(total).toHaveTextContent('20');
    expect(total).toHaveTextContent('50');
    expect(total).toHaveTextContent('40%'); // 20 of 50, family-wide
  });

  it('NO provider row claims a percentage of the ceiling — the ceiling is not per-provider', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());

    for (const providerId of ['mock', 'anthropic', 'openai', 'google']) {
      expect(screen.getByTestId(`screen.ai-settings.provider-row.${providerId}`)).not.toHaveTextContent('מהתקרה');
    }
    // Exactly one "% of ceiling" statement exists on the screen, and it is the family-wide one.
    expect(screen.getAllByText(/מהתקרה/)).toHaveLength(1);
  });

  it('provider rows still show their own absolute spend — the breakdown survived, only the enforcement claim moved', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());
    expect(screen.getByTestId('screen.ai-settings.provider-row.anthropic')).toHaveTextContent('12.5');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Task 8 review F1/F3 — the screen's `ceiling > 0` test was false for a NaN ceiling, so it printed
// "טרם הוגדרה תקרה חודשית" at the exact moment the cost gate was fully disabled by that value.
// Three states, three distinct messages, none of them a lie.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('AiSettingsScreen — the three ceiling states are told apart (Task 8 review F1/F3)', () => {
  it('UNSET renders "no ceiling configured yet" and leaves the input empty', async () => {
    mockGetAiUsageSummary.mockResolvedValue({ ...BASE_SUMMARY, ceilingILS: null, ceilingStatus: 'unset' });
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText(/טרם הוגדרה תקרה חודשית/)).toBeInTheDocument());
    expect((screen.getByLabelText('תקרת AI חודשית (₪)') as HTMLInputElement).value).toBe('');
  });

  it('a deliberate ₪0 ceiling does NOT say "not configured" — it says paid calls are blocked', async () => {
    mockGetAiUsageSummary.mockResolvedValue({ ...BASE_SUMMARY, ceilingILS: 0, ceilingStatus: 'configured' });
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());

    expect(screen.queryByText(/טרם הוגדרה תקרה חודשית/)).not.toBeInTheDocument();
    expect(screen.getByText(/קריאות AI בתשלום חסומות/)).toBeInTheDocument();
    expect((screen.getByLabelText('תקרת AI חודשית (₪)') as HTMLInputElement).value).toBe('0');
  });

  it("INVALID renders an explicit corrupt-value warning — never the reviewer's probe result, a reassuring \"no ceiling set\" beside a disabled gate", async () => {
    mockGetAiUsageSummary.mockResolvedValue({ ...BASE_SUMMARY, ceilingILS: null, ceilingStatus: 'invalid' });
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByTestId('screen.ai-settings.ceiling-invalid')).toBeInTheDocument());

    expect(screen.queryByText(/טרם הוגדרה תקרה חודשית/)).not.toBeInTheDocument();
    expect(screen.getByTestId('screen.ai-settings.ceiling-invalid')).toHaveTextContent(/אינו תקין/);
  });

  it('neither UNSET nor INVALID renders a percentage bar there is no ceiling to compute one against', async () => {
    for (const status of ['unset', 'invalid'] as const) {
      mockGetAiUsageSummary.mockResolvedValue({ ...BASE_SUMMARY, ceilingILS: null, ceilingStatus: status });
      const { unmount } = render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());
      expect(screen.queryByText(/מהתקרה/)).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe('AiSettingsScreen — data-egress disclosure (D13, spec §14.6)', () => {
  it('renders the exact Hebrew egress-disclosure line', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText(EGRESS_LINE_HE)).toBeInTheDocument());
  });
});

describe('AiSettingsScreen — exchange-rate disclosure (D15, third-lens M5)', () => {
  it('renders the exchange-rate line with the rate and its as-of date', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText(`שער דולר-שקל: 3.75 (נכון ל-${BASE_SUMMARY.exchangeRate.rateAsOf})`)).toBeInTheDocument());
  });

  it('a rate more than 90 days old (120-day fixture) renders the staleness warning', async () => {
    mockGetAiUsageSummary.mockResolvedValue({ ...BASE_SUMMARY, exchangeRate: { usdToILSRate: 3.75, rateAsOf: daysAgoISO(120) } });
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText(STALE_RATE_WARNING_HE)).toBeInTheDocument());
  });

  it('a rate only 10 days old does NOT render the staleness warning', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());
    expect(screen.queryByText(STALE_RATE_WARNING_HE)).not.toBeInTheDocument();
  });
});
