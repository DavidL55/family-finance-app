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
// Task 8 review F4 — the egress copy now has ONE home (src/config/aiDisclosure.ts, dependency-free
// for the same reason aiCeiling.ts is), so the settings banner and the chat line cannot drift.
import { AI_EGRESS_DISCLOSURE_HEADLINE_HE } from '../config/aiDisclosure';

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

const EGRESS_LINE_HE = AI_EGRESS_DISCLOSURE_HEADLINE_HE;

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
  // Batch 6 (closing review B1) — the USAGE half of ceilingStatus, in the base fixture on purpose:
  // a fixture that omits a field the server always sends leaves the corresponding branch untested
  // while every other test keeps passing, which is the vacuity this stage keeps rediscovering.
  usageStatus: 'ok' as 'ok' | 'corrupt',
  // Task 8 review F2 — the family-wide total the ONE ceiling is enforced against.
  totalUsedThisMonthILS: 12.5 as number | null,
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BATCH 6, CLOSING REVIEW B1 — THE SCREEN HALF OF "THE GATE IS OFF AND THE SCREEN IS REASSURING".
//
// A corrupt monthly counter used to reach getAiUsageSummary as a NaN. `formatILS` rendered ₪—
// (correct by accident), but the PERCENTAGE had no such guard: `Math.round(NaN / ceiling * 100)`
// rendered the literal string "NaN% מהתקרה" under a bar drawn at width "NaN%". Meanwhile
// costGate.spend() was fully open on the same state; it now fails closed, and the screen must say
// the recorded spend is unreadable rather than show a figure at all.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('AiSettingsScreen — an UNREADABLE month-to-date spend (batch 6, closing review B1)', () => {
  const corruptSummary = {
    ...BASE_SUMMARY,
    usageStatus: 'corrupt' as const,
    totalUsedThisMonthILS: null,
    byProvider: [
      { providerId: 'mock', usedThisMonthILS: 0, callCount: 3 },
      { providerId: 'anthropic', usedThisMonthILS: null, callCount: 5 },
      { providerId: 'openai', usedThisMonthILS: 0, callCount: 0 },
      { providerId: 'google', usedThisMonthILS: 0, callCount: 0 },
    ],
  };

  it('says the spend record is unreadable and that paid calls are blocked — never a reassuring ₪0.00', async () => {
    mockGetAiUsageSummary.mockResolvedValue(corruptSummary);
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByTestId('screen.ai-settings.usage-corrupt')).toBeInTheDocument());

    const notice = screen.getByTestId('screen.ai-settings.usage-corrupt');
    expect(notice).toHaveTextContent(/פגום|לא ניתן לקריאה/);
    expect(notice).toHaveTextContent(/חסומ/); // the gate really is closed, and it says so
  });

  it('renders NO percentage — the literal "NaN%" the pre-batch code produced can no longer appear', async () => {
    mockGetAiUsageSummary.mockResolvedValue(corruptSummary);
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());

    expect(screen.queryByText(/מהתקרה/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('the headline total renders ₪— rather than a number, and the unreadable provider row does too', async () => {
    mockGetAiUsageSummary.mockResolvedValue(corruptSummary);
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());

    expect(screen.getByTestId('screen.ai-settings.total-usage')).toHaveTextContent('₪—');
    expect(screen.getByTestId('screen.ai-settings.provider-row.anthropic')).toHaveTextContent('₪—');
    // ...while a provider whose counter IS readable still shows its real figure, so "₪—" means
    // unreadable rather than "the screen gave up".
    expect(screen.getByTestId('screen.ai-settings.provider-row.openai')).toHaveTextContent('₪0.00');
  });

  it('a HEALTHY summary shows the percentage and no corrupt notice — the branch must be able to not fire', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());

    expect(screen.queryByTestId('screen.ai-settings.usage-corrupt')).not.toBeInTheDocument();
    expect(screen.getByText(/מהתקרה/)).toBeInTheDocument();
  });

  it('the corrupt-usage notice takes precedence over the ceiling-state lines — with no readable numerator there is nothing to measure against any ceiling', async () => {
    mockGetAiUsageSummary.mockResolvedValue({ ...corruptSummary, ceilingILS: null, ceilingStatus: 'invalid' as const });
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByTestId('screen.ai-settings.usage-corrupt')).toBeInTheDocument());
    expect(screen.queryByText(/מהתקרה/)).not.toBeInTheDocument();
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

  it('a rate well past the threshold (120-day fixture) renders the staleness warning', async () => {
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Task 8 review F9 — isRateStale returned FALSE for any rateAsOf it could not parse, so a corrupt
// date SILENTLY SUPPRESSED the warning. That is fail-open on the stage's only honesty mechanism,
// the same class as F1's corrupt ceiling. A date we cannot read is not evidence of freshness.
//
// The threshold also tightens 90 -> 30 days: this is a hand-maintained USD/ILS rate that
// multiplies into every ₪ figure on the screen, and 90 days of unchecked FX drift is far more
// movement than the numbers it produces can absorb quietly.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('AiSettingsScreen — the staleness warning fails CLOSED (Task 8 review F9)', () => {
  it.each(['unknown', '', 'לא ידוע', '2026-13-45', '17/08/2026'])(
    'a malformed rateAsOf (%s) warns explicitly instead of falling silent',
    async (rateAsOf) => {
      mockGetAiUsageSummary.mockResolvedValue({ ...BASE_SUMMARY, exchangeRate: { usdToILSRate: 3.75, rateAsOf } });
      const { unmount } = render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByTestId('screen.ai-settings.exchange-rate-unreadable')).toBeInTheDocument());
      unmount();
    }
  );

  it('the unreadable-date warning is its OWN message, not the "rate is old" one — the operator action differs', async () => {
    mockGetAiUsageSummary.mockResolvedValue({ ...BASE_SUMMARY, exchangeRate: { usdToILSRate: 3.75, rateAsOf: 'unknown' } });
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByTestId('screen.ai-settings.exchange-rate-unreadable')).toBeInTheDocument());
    expect(screen.queryByText(STALE_RATE_WARNING_HE)).not.toBeInTheDocument();
  });

  it('31 days is stale under the tightened 30-day threshold (it was silent at 90)', async () => {
    mockGetAiUsageSummary.mockResolvedValue({ ...BASE_SUMMARY, exchangeRate: { usdToILSRate: 3.75, rateAsOf: daysAgoISO(31) } });
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText(STALE_RATE_WARNING_HE)).toBeInTheDocument());
  });

  it('29 days is still fresh — the boundary is tested on both sides', async () => {
    mockGetAiUsageSummary.mockResolvedValue({ ...BASE_SUMMARY, exchangeRate: { usdToILSRate: 3.75, rateAsOf: daysAgoISO(29) } });
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());
    expect(screen.queryByText(STALE_RATE_WARNING_HE)).not.toBeInTheDocument();
    expect(screen.queryByTestId('screen.ai-settings.exchange-rate-unreadable')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Task 8 review F5 — the screen presented UNVERIFIED pricing as fact. registry.ts carries a
// 20-line banner recording that the vendor pricing pages were blocked or ambiguous and every
// per-token price is a placeholder. The FX rate (half the ₪ conversion) was disclosed honestly;
// the per-token prices — the other half, and the more-wrong half — carried no caveat at all.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('AiSettingsScreen — unverified pricing is disclosed (Task 8 review F5)', () => {
  it('renders an unverified-pricing caveat beside the ₪ figures it produces', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByTestId('screen.ai-settings.unverified-pricing')).toBeInTheDocument());
    expect(screen.getByTestId('screen.ai-settings.unverified-pricing')).toHaveTextContent(/לא אומתו/);
  });

  it('the caveat still precedes every provider row and the whole byModel table (batch 9)', async () => {
    // Batch 9 moved the usage section to the top of the screen, which put the headline ₪ figure
    // above this caveat for the first time. The closing review had verified "renders
    // unconditionally ABOVE every ₪ figure" as prose; the honest form of that claim is a test, so
    // here it is in the form that is now true — the caveat sits immediately beneath the headline
    // number it qualifies, and ahead of every other ₪ figure on the screen.
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByTestId('screen.ai-settings.unverified-pricing')).toBeInTheDocument());
    const caveat = screen.getByTestId('screen.ai-settings.unverified-pricing');
    for (const id of ['screen.ai-settings.provider-row.anthropic', 'screen.ai-settings.model-table']) {
      expect(caveat.compareDocumentPosition(screen.getByTestId(id)) & 4).toBeTruthy();
    }
  });

  it('the caveat is unconditional — it does not disappear when the FX rate happens to be fresh', async () => {
    mockGetAiUsageSummary.mockResolvedValue({ ...BASE_SUMMARY, exchangeRate: { usdToILSRate: 3.75, rateAsOf: daysAgoISO(1) } });
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByTestId('screen.ai-settings.unverified-pricing')).toBeInTheDocument());
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Task 8 review F8 (Ofra) — one table simultaneously rendered ₪0 (for a real ₪0.0004 charge — a
// genuine cost displayed as nothing), ₪0.038 and ₪1,234.568: no fraction-digit control, ragged
// decimals, no tabular-nums anywhere (while AnnualReport.tsx, this project's own money-table
// precedent, uses it on every numeric cell), and toLocaleString() with no locale (while
// ComparisonTable.tsx already pins 'he-IL').
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('AiSettingsScreen — money legibility in the byModel table (Task 8 review F8)', () => {
  const RAGGED_SUMMARY = {
    ...BASE_SUMMARY,
    totalUsedThisMonthILS: 1234.6064,
    byModel: [
      { modelId: 'dust', providerId: 'anthropic', usedThisMonthILS: 0.0004, callCount: 1 },
      { modelId: 'small', providerId: 'openai', usedThisMonthILS: 0.038, callCount: 2 },
      { modelId: 'large', providerId: 'google', usedThisMonthILS: 1234.568, callCount: 300 },
    ],
  };

  it('a genuine sub-agora charge is NOT rendered as a bare ₪0 — it says it is below the smallest displayable amount', async () => {
    mockGetAiUsageSummary.mockResolvedValue(RAGGED_SUMMARY);
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByTestId('screen.ai-settings.model-cost.dust')).toBeInTheDocument());

    const cell = screen.getByTestId('screen.ai-settings.model-cost.dust');
    expect(cell).toHaveTextContent('פחות מ-₪0.01');
    expect(cell.textContent).not.toBe('₪0');
    expect(cell.textContent).not.toBe('₪0.00');
  });

  it('every money figure carries exactly two fraction digits and he-IL grouping', async () => {
    mockGetAiUsageSummary.mockResolvedValue(RAGGED_SUMMARY);
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByTestId('screen.ai-settings.model-cost.large')).toBeInTheDocument());

    expect(screen.getByTestId('screen.ai-settings.model-cost.small')).toHaveTextContent('₪0.04');
    expect(screen.getByTestId('screen.ai-settings.model-cost.large')).toHaveTextContent('₪1,234.57');
    // A true zero stays a plain zero — "less than an agora" is reserved for money that is really there.
    expect(screen.getByTestId('screen.ai-settings.provider-row.openai')).toHaveTextContent('₪0.00');
  });

  it('numeric cells use tabular-nums, following AnnualReport.tsx\'s own money-table precedent', async () => {
    mockGetAiUsageSummary.mockResolvedValue(RAGGED_SUMMARY);
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByTestId('screen.ai-settings.model-cost.large')).toBeInTheDocument());

    for (const modelId of ['dust', 'small', 'large']) {
      expect(screen.getByTestId(`screen.ai-settings.model-cost.${modelId}`).className).toMatch(/tabular-nums/);
      expect(screen.getByTestId(`screen.ai-settings.model-calls.${modelId}`).className).toMatch(/tabular-nums/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BATCH 9 — THE 5-SECOND GLANCE. The stage's own product-metric acceptance check FAILED here, and
// the demo agent gave four pieces of evidence, all still true at HEAD:
//   · the progress bar was bg-blue-600 UNCONDITIONALLY, so 5% and 98% looked identical;
//   · the percentage was text-xs text-slate-500 — the faintest text in the section;
//   · two static amber blocks sat ABOVE it, so attention was allocated inversely to what changes;
//   · Math.min(100, …) capped the DISPLAYED number, so 500%-of-ceiling rendered exactly like
//     100% — reachable by lowering the ceiling after spending.
//
// Colour alone is not the fix (WCAG 1.4.1, and a third of the readers of a budget screen are on a
// phone in sunlight): the state is also stated in words, and the number itself is uncapped.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('AiSettingsScreen — the ceiling is legible at a glance (batch 9)', () => {
  const at = (used: number, ceiling = 50) => ({ ...BASE_SUMMARY, ceilingILS: ceiling, totalUsedThisMonthILS: used });

  async function renderAt(used: number, ceiling = 50) {
    mockGetAiUsageSummary.mockResolvedValue(at(used, ceiling));
    const utils = render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByTestId('screen.ai-settings.usage-bar')).toBeInTheDocument());
    return utils;
  }

  it('the bar colour CHANGES with the state — 5% and 98% must not look identical', async () => {
    const { unmount } = await renderAt(2.5); // 5%
    const low = screen.getByTestId('screen.ai-settings.usage-bar').className;
    unmount();
    await renderAt(49); // 98%
    const high = screen.getByTestId('screen.ai-settings.usage-bar').className;
    expect(low).not.toEqual(high);
  });

  it('renders three distinct states — comfortable, close to the ceiling, over it', async () => {
    const seen = new Set<string>();
    for (const used of [2.5, 45, 75]) {
      const { unmount } = await renderAt(used);
      seen.add(screen.getByTestId('screen.ai-settings.usage-bar').className);
      seen.add(screen.getByTestId('screen.ai-settings.usage-pct').className);
      unmount();
    }
    expect(seen.size).toBe(6); // three bar classes AND three text classes, all different
  });

  it('states the level IN WORDS too — colour is never the only signal (WCAG 1.4.1)', async () => {
    for (const [used, word] of [[2.5, 'בטווח'], [45, 'מתקרב'], [75, 'חריגה']] as const) {
      mockGetAiUsageSummary.mockResolvedValue(at(used));
      const { unmount } = render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByTestId('screen.ai-settings.usage-pct')).toBeInTheDocument());
      expect(screen.getByTestId('screen.ai-settings.usage-pct')).toHaveTextContent(word);
      unmount();
    }
  });

  it('the REAL percentage is shown past 100% — the Math.min cap hid a genuine overrun', async () => {
    // Reachable exactly as the demo agent described: spend, then lower the ceiling.
    await renderAt(250, 50);
    expect(screen.getByTestId('screen.ai-settings.usage-pct')).toHaveTextContent('500%');
  });

  it('…while the BAR still stops at its track — a 500%-wide div is not a wider bar, just a broken one', async () => {
    await renderAt(250, 50);
    expect(screen.getByTestId('screen.ai-settings.usage-bar').getAttribute('style')).toContain('width: 100%');
  });

  it('the percentage is no longer the faintest text in the section', async () => {
    // slate-500 was the token; it is also the token the byModel table\'s own muted cells use, so
    // the number that changes was styled exactly like the furniture that does not.
    await renderAt(45);
    const cls = screen.getByTestId('screen.ai-settings.usage-pct').className;
    expect(cls).not.toMatch(/text-slate-500/);
    expect(cls).toMatch(/font-semibold/);
    expect(cls).not.toMatch(/\btext-xs\b/);
  });

  it('the number that changes comes BEFORE the static disclosure blocks in the document', async () => {
    await renderAt(45);
    const usage = screen.getByTestId('screen.ai-settings.total-usage');
    const banner = screen.getByTestId('screen.ai-settings.egress-banner');
    // Node.DOCUMENT_POSITION_FOLLOWING === 4 — the banner comes after the usage section.
    expect(usage.compareDocumentPosition(banner) & 4).toBeTruthy();
  });

  it('still exactly ONE "% of the ceiling" claim on the screen (the F2 guard, unweakened)', async () => {
    await renderAt(45);
    expect(screen.getAllByText(/מהתקרה/)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BATCH 9 — THE GLOSSARY TERM COLLISION, fixed at the source rather than only in the prose.
// "ספק" already means the MERCHANT on a transaction (ExtractionReviewModal, CentralExpenseReport)
// and the INSURER (InsurancesScreen). This screen's own column header was a bare "ספק".
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('AiSettingsScreen — "ספק" is never left bare where it could mean a merchant (batch 9)', () => {
  it('the byModel table\'s provider column is headed "ספק AI", not a bare "ספק"', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByTestId('screen.ai-settings.model-table')).toBeInTheDocument());
    const headers = [...screen.getByTestId('screen.ai-settings.model-table').querySelectorAll('th')]
      .map((th) => th.textContent?.trim());
    expect(headers).toContain('ספק AI');
    expect(headers).not.toContain('ספק');
  });

  it('no heading on the screen is the bare word "ספק" or "ספקים"', async () => {
    render(<AiSettingsScreen actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('הגדרות AI')).toBeInTheDocument());
    expect(screen.queryByText('ספק')).not.toBeInTheDocument();
    expect(screen.queryByText('ספקים')).not.toBeInTheDocument();
  });
});
