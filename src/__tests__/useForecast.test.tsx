// src/__tests__/useForecast.test.tsx — Stage 7 T7a.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS SUITE IS FOR, AND WHY IT NEEDS NO EMULATOR AND NO PROVIDERS
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Every read is INJECTED. That is T7a's own stated constraint and it buys two things: the hook
// mounts in a bare `renderHook()` with no Firebase, no FilterProvider and no session; and D17 —
// the one rule that decides whether the headline figure exists at all — is exercised over states
// no live corpus could produce on demand (a denial on one input, an error on another, an empty
// read on a third, all in the same render).
//
// !! AND THIS IS WHERE THE DOOR IS WALKED FOR THE FIRST TIME. `loadStatisticalHistory` had zero
// non-test call sites before this task; every attack surface T5's review found is met here by a
// real consumer rather than by a fixture, including the one that matters — a handle that did not
// come through the door.
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  DEFAULT_FORECAST_READERS,
  FORECAST_INPUT_MODULES,
  computeForecastFromReads,
  forecastCardScopeOf,
  forecastMemberScopeOf,
  narrowForecastScopesToMember,
  resolveForecastScopes,
  useForecast,
  type ForecastReaders,
  type ForecastScopes,
  type UseForecastConfig,
} from '../hooks/useForecast';
import { sealStatisticalHistory } from '../utils/statisticalHistory';
import { HISTORY_ROW_CEILING } from '../utils/forecast';
import type { TransactionPeriodBackfillMarker } from '../utils/backfillMarker';
import type { Account, ForecastAssumption, Insurance, Loan, RecurringItem } from '../types/finance';
import { ALL_MEMBERS_SELECTION, type MemberSelection } from '../types/filters';

const MARKER: TransactionPeriodBackfillMarker = {
  completedAt: '2026-08-18T09:00:00.000Z',
  sourceCommit: 'c3e49cc',
  rowsStamped: 10,
  rowsUnknown: 0,
  lastRunAt: '2026-08-18T09:00:00.000Z',
  lastRunCommit: 'c3e49cc',
  transactionRows: 10,
};

const TODAY_PERIOD = '2026-09';
const TODAY_DATE = '2026-09-01';

function account(over: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    ownerId: 'david',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    name: 'עובר ושב',
    type: 'bank',
    balance: 20000,
    balanceUpdatedAt: '2026-08-20',
    status: 'active',
    ...over,
  };
}

function recurring(over: Partial<RecurringItem> = {}): RecurringItem {
  return {
    id: 'rec-1',
    ownerId: 'david',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    description: 'שכר דירה',
    category: 'דיור',
    amount: 5000,
    chargeDay: 1,
    status: 'active',
    kind: 'expense',
    startDate: '2026-01-01',
    ...over,
  };
}

function salary(): RecurringItem {
  return recurring({ id: 'rec-salary', description: 'משכורת', kind: 'income', amount: 18000, category: 'הכנסה' });
}

function loan(): Loan {
  return {
    id: 'loan-1',
    ownerId: 'david',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    name: 'משכנתא',
    loanType: 'mortgage',
    principal: 800000,
    balance: 600000,
    interestRate: 3.5,
    monthlyPayment: 4200,
    startDate: '2026-01-01',
    endDate: '2030-01-01',
    status: 'active',
  };
}

function insurance(): Insurance {
  return {
    id: 'ins-1',
    ownerId: 'david',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    type: 'health',
    provider: 'הראל',
    insuredMemberId: 'david',
    premium: 300,
    premiumFrequency: 'monthly',
    coverages: [],
    renewalDate: '2027-01-01',
    status: 'active',
  };
}

function historyRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tl-1',
    period: '2026-08',
    category: 'מזון וצריכה',
    amount: 900,
    isCredit: false,
    paymentType: 'card',
    recurringId: null,
    date: '2026-08-11',
    ...over,
  };
}

/** Six periods of groceries, so the statistical layer has something real to average. */
function sixMonthsOfGroceries(): Array<Record<string, unknown>> {
  return ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'].map((period, index) =>
    historyRow({ id: `tl-${period}`, period, amount: 900 + index, date: `${period}-11` })
  );
}

const ALL_FAMILY: ForecastScopes = {
  accounts: 'family',
  incomes: 'family',
  recurring: 'family',
  loans: 'family',
  insurances: 'family',
  history: 'family',
  assumptions: 'family',
  goals: 'family',
};

interface ReaderOverrides {
  accounts?: Account[];
  recurring?: RecurringItem[];
  loans?: Loan[];
  insurances?: Insurance[];
  assumptions?: ForecastAssumption[];
  incomes?: Array<Record<string, unknown>>;
  goals?: Array<Record<string, unknown>>;
  historyRows?: Array<Record<string, unknown>>;
}

function readers(over: ReaderOverrides = {}): ForecastReaders {
  const rows = over.historyRows ?? sixMonthsOfGroceries();
  return {
    accounts: async () => over.accounts ?? [account()],
    recurring: async () => over.recurring ?? [recurring(), salary()],
    loans: async () => over.loans ?? [loan()],
    insurances: async () => over.insurances ?? [insurance()],
    assumptions: async () => over.assumptions ?? [],
    incomes: async () => over.incomes ?? [{ name: 'משכורת', amount: 18000, month: '08', year: '2026' }],
    goals: async () => over.goals ?? [],
    history: async () => ({
      status: 'ready' as const,
      rows: rows as never,
      reasonHe: '',
      marker: MARKER,
      history: sealStatisticalHistory(MARKER, rows),
    }),
  };
}

function config(over: Partial<UseForecastConfig> = {}): UseForecastConfig {
  return {
    viewerMemberId: 'david',
    scopes: ALL_FAMILY,
    anchorPeriod: TODAY_PERIOD,
    todayPeriod: TODAY_PERIOD,
    todayDate: TODAY_DATE,
    readers: readers(),
    ...over,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// SCOPE RESOLUTION — pure, and separate from the fetch for `useNetWorth`'s stated reason
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('resolveForecastScopes / forecastCardScopeOf', () => {
  it('resolves every one of the eight inputs, and none is left undefined', () => {
    const scopes = resolveForecastScopes({ role: 'super-admin', levels: {} });
    for (const key of Object.keys(FORECAST_INPUT_MODULES)) {
      expect(scopes[key as keyof ForecastScopes], key).toBe('family');
    }
  });

  it('!! an `own`-level member gets `own` on the owned inputs and NOTHING on the ownerless ones', () => {
    // D17's table, executable. `incomes` and `goals` have no owner field, so `'own'` on them would
    // be a family-wide read wearing a restricted scope's name.
    const scopes = resolveForecastScopes({
      role: 'member',
      levels: {
        accounts: 'own',
        recurring: 'own',
        loans: 'own',
        insurances: 'own',
        expenses: 'own',
        income: 'own',
        goals: 'own',
        forecast: 'own',
      },
    });
    expect(scopes.accounts).toBe('own');
    expect(scopes.history).toBe('own');
    expect(scopes.incomes).toBe('none');
    expect(scopes.goals).toBe('none');
  });

  it('`history` is graded under the EXPENSES module — A40, and the reason T3 added that prop', () => {
    expect(FORECAST_INPUT_MODULES.history).toBe('expenses');
  });

  it('!! the family card is offered ONLY when every balance input is family-scoped', () => {
    expect(forecastCardScopeOf(ALL_FAMILY)).toBe('family');
    expect(forecastCardScopeOf({ ...ALL_FAMILY, incomes: 'none' })).toBe('own');
    expect(forecastCardScopeOf({ ...ALL_FAMILY, accounts: 'own' })).toBe('own');
    // …and a non-balance input has no say in it: a viewer with no `forecast` grant still gets the
    // family card, because assumptions are not part of the balance.
    expect(forecastCardScopeOf({ ...ALL_FAMILY, assumptions: 'none', goals: 'none' })).toBe('family');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T7b — THE מי DECISION. NAMED IN THE LEDGER BY T7a, DECIDED HERE.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// D21(b) specified that the fetched window is cached and RE-SLICED when מי changes. That is not
// constructible: `buildStatisticalLayer` takes a SEALED handle, and re-slicing the row array yields
// an ungated array only `loadStatisticalHistory` could re-seal. T7a's review went further — the
// ungated sibling that made the re-slice easy has been REMOVED from the hook's return, precisely
// because re-slicing it was both the obvious move and silently wrong (a forged instalment row
// landed ₪9,999 inside `מזה כבר סגור` in every horizon month).
//
// The ledger left T7b two options and told it to pick one out loud: RE-SEAL INSIDE THE DOOR, or
// have מי RE-RESOLVE SCOPE THE WAY NET WORTH DOES. **This is the second.**
//
// Why: `Dashboard.tsx` already narrows net worth to a single selected member by setting the scope
// to `'own'` and the target member to that person, and every read then re-runs its OWN permission
// gate. Nothing is re-sliced, nothing is re-sealed, and no ungated array is ever constructed — the
// door's invariant, which cost a whole review to establish, is not touched. The cost is a refetch
// when מי changes, which D33's cache is spent on every OTHER filter change instead.
describe('!! narrowForecastScopesToMember — the מי decision', () => {
  it('turns every readable scope into `own`, so the reads re-run against the selected member', () => {
    const narrowed = narrowForecastScopesToMember(ALL_FAMILY);
    for (const key of Object.keys(narrowed)) {
      expect(narrowed[key as keyof ForecastScopes], key).toBe('own');
    }
  });

  it('!! `none` STAYS `none` — selecting a member cannot grant a read the viewer never had', () => {
    // The half that makes this safe to do at all. `'none'` is a resolved refusal, and mapping it to
    // `'own'` would turn a filter control into a permission escalation attempt on every render.
    const narrowed = narrowForecastScopesToMember({ ...ALL_FAMILY, incomes: 'none', goals: 'none' });
    expect(narrowed.incomes).toBe('none');
    expect(narrowed.goals).toBe('none');
    expect(narrowed.accounts).toBe('own');
  });

  it('is idempotent — narrowing an already-narrow set changes nothing', () => {
    const once = narrowForecastScopesToMember(ALL_FAMILY);
    expect(narrowForecastScopesToMember(once)).toEqual(once);
  });

  it('!! the CARD SCOPE follows, so a narrowed screen cannot render the family card', () => {
    // The consequence that makes the decision visible rather than internal: a narrowed forecast is
    // one member's, so it gets D29(d)'s `'own'` panel — the dashed ground, the scope badge and the
    // explicit `צפוי לצאת:` prefix — instead of a family balance whose subject silently changed.
    expect(forecastCardScopeOf(narrowForecastScopesToMember(ALL_FAMILY))).toBe('own');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T7b REVIEW — F3. THE OTHER TWO ANSWERS, WHICH USED TO BE ONE `null`
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// `narrowForecastScopesToMember` answers for ONE selected member. The screen collapsed the other
// two cases into a single `null`, so it could not tell "nobody selected anything" from "two people
// are selected and this forecast is not theirs" — and said nothing in either case while the filter
// bar above it rendered `2 נבחרו`. A predicate, on synthetic inputs, before any of it renders.
describe('!! forecastMemberScopeOf — three outcomes, and the one that has to be DISCLOSED', () => {
  const selection = (over: Partial<MemberSelection> = {}): MemberSelection => ({
    mode: 'all',
    memberIds: [],
    groupId: null,
    ...over,
  });

  it('ONE member is `single`, and carries the id the whole computation re-targets to', () => {
    expect(forecastMemberScopeOf(selection({ mode: 'members', memberIds: ['omer'] }))).toEqual({
      kind: 'single',
      memberId: 'omer',
    });
  });

  it('!! TWO members is `family-fallback` — a selection that did NOT narrow', () => {
    expect(forecastMemberScopeOf(selection({ mode: 'members', memberIds: ['omer', 'david'] }))).toEqual({
      kind: 'family-fallback',
    });
  });

  it('!! a GROUP is `family-fallback` too — the same silence, through the other door', () => {
    expect(forecastMemberScopeOf(selection({ mode: 'group', groupId: 'parents' }))).toEqual({
      kind: 'family-fallback',
    });
  });

  it('!! an EMPTY `members` selection is `family`, NOT a fallback — nothing was asked for', () => {
    // The boundary that separates a disclosure from noise. Nothing is selected, so there is no
    // expectation to correct, and a note here would appear on a screen nobody has filtered.
    expect(forecastMemberScopeOf(selection({ mode: 'members', memberIds: [] }))).toEqual({ kind: 'family' });
  });

  it('!! a `group` mode with NO group id is `family` for the same reason', () => {
    expect(forecastMemberScopeOf(selection({ mode: 'group', groupId: null }))).toEqual({ kind: 'family' });
  });

  it('`all` is `family`', () => {
    expect(forecastMemberScopeOf(ALL_MEMBERS_SELECTION)).toEqual({ kind: 'family' });
  });

  it('!! `single` is the ONLY kind that narrows — the pairing, stated as an assertion', () => {
    // What ties this predicate to the screen: the id it yields is exactly the input to
    // `narrowForecastScopesToMember`, and the other two kinds must leave the scopes alone.
    const single = forecastMemberScopeOf(selection({ mode: 'members', memberIds: ['omer'] }));
    const fallback = forecastMemberScopeOf(selection({ mode: 'members', memberIds: ['omer', 'david'] }));
    expect(single.kind === 'single' ? narrowForecastScopesToMember(ALL_FAMILY).accounts : null).toBe('own');
    expect(fallback.kind === 'single').toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D17 — ENFORCED AT THE HOOK, over real reads
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! D17 — `projectedBalance` is null unless EVERY balance input is `ok`', () => {
  it('computes the balance when all six are present', async () => {
    const computed = await computeForecastFromReads(config());
    expect(computed.suppressed).toEqual([]);
    expect(computed.projectedBalanceILS).not.toBeNull();
    // opening ₪20,000 + 3 × ₪18,000 income − 3 × (rent 5,000 + loan 4,200 + insurance 300 + est.)
    expect(computed.openingBalance?.amountILS).toBe(20000);
    expect(computed.projectedIncomeILS).toBe(54000);
  });

  it('!! an EMPTY accounts collection makes the balance null and NAMES it — A2, and the day-one case', () => {
    // T0 measured `accounts` as a collection that DOES NOT EXIST. This is the state David's own
    // data is in, and the balance being null on it is correct rather than a bug to work around.
    return computeForecastFromReads(config({ readers: readers({ accounts: [] }) })).then((computed) => {
      expect(computed.inputs.accounts.state).toBe('empty');
      expect(computed.suppressed).toContain('accounts');
      expect(computed.projectedBalanceILS).toBeNull();
      expect(computed.openingBalance).toBeNull();
    });
  });

  it('a DENIED input makes the balance null — the permission case, still covered', async () => {
    const computed = await computeForecastFromReads(
      config({ scopes: { ...ALL_FAMILY, loans: 'none' } })
    );
    expect(computed.inputs.loans.state).toBe('denied');
    expect(computed.inputs.loans.count).toBe(0);
    expect(computed.suppressed).toContain('loans');
    expect(computed.projectedBalanceILS).toBeNull();
  });

  it('!! a `none` scope NEVER ISSUES THE QUERY — a denial is not derived from a failed read', async () => {
    const spy = vi.fn(async () => [loan()]);
    await computeForecastFromReads(
      config({ scopes: { ...ALL_FAMILY, loans: 'none' }, readers: { ...readers(), loans: spy } })
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('a FAILED read is an error, and a permission-denied error is a denial', async () => {
    const failing: ForecastReaders = {
      ...readers(),
      insurances: async () => {
        throw new Error('network');
      },
    };
    const errored = await computeForecastFromReads(config({ readers: failing }));
    expect(errored.inputs.insurances.state).toBe('error');
    expect(errored.projectedBalanceILS).toBeNull();

    const deniedReader: ForecastReaders = {
      ...readers(),
      insurances: async () => {
        throw Object.assign(new Error('denied'), { code: 'permission-denied' });
      },
    };
    const denied = await computeForecastFromReads(config({ readers: deniedReader }));
    expect(denied.inputs.insurances.state).toBe('denied');
  });

  it('!! `assumptions` and `goals` failing does NOT blank the headline figure', async () => {
    const computed = await computeForecastFromReads(
      config({ scopes: { ...ALL_FAMILY, assumptions: 'none', goals: 'none' } })
    );
    expect(computed.inputs.assumptions.state).toBe('denied');
    expect(computed.suppressed).toEqual([]);
    expect(computed.projectedBalanceILS).not.toBeNull();
  });

  it('!! A10 — income present in the LEDGER but not PROJECTED still suppresses, and names `incomes`', async () => {
    // There is no income statistical layer. A family whose income lives only in `incomes` — which
    // is where `RecurringService` posts recurring income — would otherwise get a balance built on
    // ₪0 of income, wrong by their entire salary, rendered at glance scale with full confidence.
    const noSalary = await computeForecastFromReads(
      config({ readers: readers({ recurring: [recurring()] }) })
    );
    expect(noSalary.inputs.incomes.count).toBe(0);
    expect(noSalary.inputs.incomes.state).toBe('empty');
    expect(noSalary.suppressed).toContain('incomes');
    expect(noSalary.projectedBalanceILS).toBeNull();
    // …and the REFERENCE figure is absent rather than ₪0, because ₪0 income is not a denominator.
    expect(noSalary.projectedIncomeILS).toBeNull();
  });

  it('an EMPTY `incomes` collection suppresses even when a salary IS projected — both halves', async () => {
    const computed = await computeForecastFromReads(config({ readers: readers({ incomes: [] }) }));
    expect(computed.suppressed).toContain('incomes');
    expect(computed.projectedBalanceILS).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T7a-REVIEW F5/F6 — ARCHIVED ACCOUNTS, AND THE TWO RULES THAT COULD DISAGREE ABOUT THEM
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('!! F5 — AN ARCHIVED ACCOUNT`S STALE BALANCE DOES NOT SUM INTO THE HEADLINE FIGURE', () => {
    // THE FINDING: deleting the `status === 'active'` filter left all 2422 tests green, so an
    // archived account — one the family has explicitly stopped maintaining — contributed its last
    // known balance to a glance-scale projection. `computeOpeningBalance` reflects exactly what it
    // is passed, by its own stated convention (`netWorth.ts`'s, for the same collection), so the
    // selection is the caller's job and this is the caller.
    const archived = account({ id: 'acc-old', balance: 999999, status: 'archived' });
    return computeForecastFromReads(
      config({ readers: readers({ accounts: [account(), archived] }) })
    ).then((computed) => {
      expect(computed.openingBalance?.amountILS).toBe(20000);
      expect(computed.openingBalance?.accountsCounted).toBe(1);
      // …and the ₪999,999 is nowhere in the projected figure either, which is the number a family
      // would actually read.
      expect(computed.projectedBalanceILS).toBeLessThan(999999);
    });
  });

  it('!! F6 — WITH EVERY ACCOUNT ARCHIVED, `accounts` IS NAMED AS A GAP rather than graded `ok`', async () => {
    // THE DEGENERATE CARD, RENDERED AND CAPTURED BY THE REVIEW. `accounts` graded `'ok'` because the
    // COLLECTION has documents, so nothing was suppressed — while the opening balance was `null`,
    // because every account was filtered out before it was computed. The card fell into its gap
    // branch with an EMPTY gap list and rendered a glance `"0"` above the sentence
    // `לא ניתן להציג יתרה צפויה — חסרים 0 נתונים: ` — trailing colon, nothing after it, and a `0` in
    // the position D26 row 0 reserves for a COUNT of what is missing.
    //
    // The grade and the opening balance are now taken over ONE array, so they cannot disagree.
    const computed = await computeForecastFromReads(
      config({
        readers: readers({
          accounts: [account({ status: 'archived' }), account({ id: 'acc-2', status: 'archived' })],
        }),
      })
    );
    expect(computed.openingBalance).toBeNull();
    expect(computed.inputs.accounts.state).toBe('empty');
    expect(computed.inputs.accounts.count).toBe(0);
    expect(computed.suppressed).toContain('accounts');
    expect(computed.projectedBalanceILS).toBeNull();
    // THE PROPERTY THE CARD DEPENDS ON, stated directly: there is never a gap branch with an empty
    // gap list, because a null balance always has at least one input to name.
    expect(computed.suppressed.length).toBeGreaterThan(0);
  });

  it('!! F6 — the general invariant: a null balance ALWAYS names at least one input', async () => {
    // Held over every shape this suite can reach rather than only over the archived one, because
    // the defect was a DISAGREEMENT between two rules and the next disagreement will not be about
    // accounts. `resolveProjectedBalanceILS` throws on the disagreement itself; this is the
    // behavioural half, over real reads.
    const cases: Array<[string, UseForecastConfig]> = [
      ['no accounts at all', config({ readers: readers({ accounts: [] }) })],
      ['every account archived', config({ readers: readers({ accounts: [account({ status: 'archived' })] })})],
      ['history denied', config({ scopes: { ...ALL_FAMILY, history: 'none' } })],
      ['no history rows', config({ readers: readers({ historyRows: [] }) })],
      ['no income in the ledger', config({ readers: readers({ incomes: [] }) })],
      ['everything present', config()],
    ];
    for (const [name, cfg] of cases) {
      const computed = await computeForecastFromReads(cfg);
      if (computed.projectedBalanceILS === null) {
        expect(computed.suppressed.length, name).toBeGreaterThan(0);
      } else {
        expect(computed.suppressed, name).toEqual([]);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// !! THE DOOR, MET BY ITS FIRST REAL CONSUMER
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('!! the long door — the completion-marker refusal reaches production', () => {
  it('the history reader is handed the SIX-MONTH LOOKBACK WINDOW, strictly before the anchor', async () => {
    const spy = vi.fn(readers().history);
    await computeForecastFromReads(config({ readers: { ...readers(), history: spy } }));
    expect(spy).toHaveBeenCalledWith('family', 'david', [
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ]);
  });

  it('!! a REFUSED backfill marker makes history an error, carries the reason, and kills the balance', async () => {
    const refusing: ForecastReaders = {
      ...readers(),
      history: async () => ({
        status: 'refused-backfill-incomplete' as const,
        rows: [],
        reasonHe: 'הגיבוי לא הושלם',
        marker: null,
        history: { status: 'refused-backfill-incomplete' as const, reasonHe: 'הגיבוי לא הושלם' },
      }),
    };
    const computed = await computeForecastFromReads(config({ readers: refusing }));
    expect(computed.statisticalLayer?.status).toBe('refused-backfill-incomplete');
    expect(computed.historyRefusalHe).toBe('הגיבוי לא הושלם');
    expect(computed.inputs.history.state).toBe('error');
    expect(computed.suppressed).toContain('history');
    expect(computed.projectedBalanceILS).toBeNull();
  });

  it('!! A FORGED HANDLE IS REFUSED IN PRODUCTION — the runtime brand check, from the real caller', async () => {
    // T5's review closed four bypasses on a handle whose provenance was DATA. The fix keyed on
    // IDENTITY, and this is the first time a production call path has ever exercised it: a spread
    // copy carries a genuine brand and is not the sealed object, so `buildStatisticalLayer` throws
    // and this hook renders an error rather than an average over rows nobody gated.
    const rows = sixMonthsOfGroceries();
    const real = sealStatisticalHistory(MARKER, rows);
    const forged = { ...real, rows: [historyRow({ amount: 9999 })] };
    const forging: ForecastReaders = {
      ...readers(),
      history: async () => ({
        status: 'ready' as const,
        rows: rows as never,
        reasonHe: '',
        marker: MARKER,
        history: forged as unknown as ReturnType<typeof sealStatisticalHistory>,
      }),
    };
    await expect(computeForecastFromReads(config({ readers: forging }))).rejects.toThrow(
      /did not come through `loadStatisticalHistory`/
    );
  });

  it('!! D33 — a window over the ceiling degrades EXPLICITLY and does not render a truncated average', async () => {
    const tooMany = Array.from({ length: HISTORY_ROW_CEILING + 1 }, (_, index) =>
      historyRow({ id: `tl-${index}`, period: '2026-08' })
    );
    const computed = await computeForecastFromReads(config({ readers: readers({ historyRows: tooMany }) }));
    expect(computed.statisticalLayer?.status).toBe('refused-too-many-rows');
    expect(computed.inputs.history.state).toBe('error');
    expect(computed.projectedBalanceILS).toBeNull();
  });

  it('a SUCCESSFUL read of no rows is `empty`, not `error` — onboarding is not a fault', async () => {
    const computed = await computeForecastFromReads(config({ readers: readers({ historyRows: [] }) }));
    expect(computed.statisticalLayer?.status).toBe('ready');
    expect(computed.inputs.history.state).toBe('empty');
    expect(computed.suppressed).toContain('history');
  });

  it('!! F1 — THE UNGATED `rows` SIBLING IS NO LONGER READ, so the review`s exploit is dead', async () => {
    // THE EXPLOIT, IN THE SHAPE THE REVIEW RAN IT. `StatisticalHistoryResult` carries BOTH a sealed
    // `history` handle and a raw `rows` array. `gradedHistoryRead` used to return `rows: read.rows`
    // and that array went straight into `observedInstalmentRowsOf` → `projectInstalmentsForward` →
    // `certainItems`: a REAL sealed handle over three ₪100 grocery rows, paired with one ungated
    // `{vendor: 'FORGED', amount: 9999, installmentNumber: 1, totalInstallments: 12}`, produced
    // `basis.kind: 'installment'`, `amountILS: 9999`, IN EVERY HORIZON MONTH — inside `certainILS`,
    // the highest-confidence bucket, the one D38 renders as `מזה כבר סגור`.
    //
    // The handle and the sibling disagree here ON PURPOSE. If anything downstream still read the
    // sibling, this test would see the forged plan; the assertions say it sees the sealed corpus
    // and nothing else.
    const sealedRows = sixMonthsOfGroceries();
    const forgedRow = {
      id: 'tl-forged',
      period: '2026-08',
      date: '2026-08-11',
      vendor: 'FORGED',
      amount: 9999,
      installmentNumber: 1,
      totalInstallments: 12,
    };
    const divergent: ForecastReaders = {
      ...readers(),
      history: async () => ({
        status: 'ready' as const,
        // THE UNGATED SIBLING, carrying the forgery…
        rows: [forgedRow] as never,
        reasonHe: '',
        marker: MARKER,
        // …and the REAL handle beside it, carrying the groceries.
        history: sealStatisticalHistory(MARKER, sealedRows),
      }),
    };
    const computed = await computeForecastFromReads(config({ readers: divergent }));

    // NOT ONE instalment item, in any month — the forged plan never entered the certain layer.
    expect(computed.result?.lineItems.filter((item) => item.basis.kind === 'installment')).toEqual([]);
    expect(computed.result?.lineItems.some((item) => item.amountILS === 9999)).toBe(false);

    // …and the row COUNT that grades the history input comes off the handle too, so the sibling
    // cannot quietly decide whether this input reads `'empty'` or `'ok'` either.
    expect(computed.inputs.history.count).toBe(sealedRows.length);

    // THE CONTROL, so the assertions above are about the GATE and not about the projector being
    // broken: the same forged plan INSIDE the sealed handle does project, in every horizon month.
    const throughTheDoor: ForecastReaders = {
      ...readers(),
      history: async () => ({
        status: 'ready' as const,
        rows: [] as never,
        reasonHe: '',
        marker: MARKER,
        history: sealStatisticalHistory(MARKER, [forgedRow]),
      }),
    };
    const control = await computeForecastFromReads(config({ readers: throughTheDoor }));
    const controlInstalments = control.result?.lineItems.filter((item) => item.basis.kind === 'installment');
    expect(controlInstalments).toHaveLength(3);
    expect(controlInstalments?.every((item) => item.amountILS === 9999)).toBe(true);
  });

  it('the DEFAULT reader set names the long door, never the short one', () => {
    // A structural assertion sits in `statisticalHistoryDoor.test.ts`; this is the behavioural
    // half — the shipped default really is wired, rather than the hook merely being wireable.
    expect(typeof DEFAULT_FORECAST_READERS.history).toBe('function');
    expect(Object.keys(DEFAULT_FORECAST_READERS).sort()).toEqual([
      'accounts',
      'assumptions',
      'goals',
      'history',
      'incomes',
      'insurances',
      'loans',
      'recurring',
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D32(a) — the anchor is clamped FORWARD, and the result says that it was
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('D32(a) — a past anchor is clamped forward', () => {
  it('clamps and reports it', async () => {
    const computed = await computeForecastFromReads(config({ anchorPeriod: '2026-05' }));
    expect(computed.result?.anchorPeriod).toBe(TODAY_PERIOD);
    expect(computed.result?.anchorClamped).toBe(true);
    expect(computed.result?.horizon).toEqual(['2026-09', '2026-10', '2026-11']);
  });

  it('does NOT report a clamp when the anchor is already forward', async () => {
    const computed = await computeForecastFromReads(config({ anchorPeriod: '2026-11' }));
    expect(computed.result?.anchorClamped).toBe(false);
    expect(computed.result?.horizon[0]).toBe('2026-11');
  });

  it('!! a MALFORMED anchor refuses loudly rather than producing an empty forecast', async () => {
    await expect(computeForecastFromReads(config({ anchorPeriod: 'unknown' }))).rejects.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// The certain layer, the assumption layer, and the `'own'` outflow rule
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('the composed forecast', () => {
  it('projects recurring, loans and insurances forward into EVERY horizon month', async () => {
    const computed = await computeForecastFromReads(config());
    const kinds = new Set(computed.result?.lineItems.map((item) => item.basis.kind));
    expect(kinds.has('recurring')).toBe(true);
    expect(kinds.has('loan')).toBe(true);
    expect(kinds.has('insurance')).toBe(true);
    expect(kinds.has('movingAverage')).toBe(true);
    // The committed part is the three contractual items × three months, income excluded.
    expect(computed.committedILS).toBe((5000 + 4200 + 300) * 3);
  });

  it('!! an ASSUMPTION overrides a certain item end to end — D19`s mechanism, on fetched data', async () => {
    const raise: ForecastAssumption = {
      id: 'fa-rent',
      ownerId: 'david',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      scopeKind: 'recurring',
      scopeId: 'rec-1',
      fromPeriod: '2026-09',
      amountILS: 6000,
      reasonHe: 'שכר הדירה עולה',
      source: 'user',
      status: 'active',
    };
    const before = await computeForecastFromReads(config());
    const after = await computeForecastFromReads(config({ readers: readers({ assumptions: [raise] }) }));
    // §4.4's canonical scenario: the rent rises to ₪6,000, and the outflow moves by exactly the
    // difference in every horizon month.
    expect((after.projectedExpenseILS ?? 0) - (before.projectedExpenseILS ?? 0)).toBe(3000);
    // !! AND THE OVERRIDDEN RENT LEAVES THE "ALREADY CLOSED" FIGURE, which is correct and worth
    // pinning rather than discovering. `layerOf` puts an assumption in the `assumption` layer, so
    // the ₪5,000 contractual line stops counting toward `certainILS` — a user-asserted amount is
    // not a contract, and D38's `מזה כבר סגור` must not claim it is. The card therefore reports
    // LESS as committed after an override, by the whole displaced amount.
    expect(after.committedILS - before.committedILS).toBe(-5000 * 3);
    const overridden = after.result?.lineItems.find((item) => item.basis.kind === 'assumption');
    expect(overridden?.amountILS).toBe(6000);
    expect(overridden?.basis.kind === 'assumption' && overridden.basis.overrides.map((o) => o.kind)).toEqual([
      'recurring',
    ]);
  });

  it('!! the `own` outflow figure is suppressed the same way — a small figure is a lie told quietly', async () => {
    const computed = await computeForecastFromReads(
      config({ scopes: { ...ALL_FAMILY, recurring: 'none' } })
    );
    expect(computed.suppressedOutflow).toContain('recurring');
    expect(computed.projectedExpenseILS).toBeNull();
    // …and `accounts` is NOT on the outflow set, so an empty accounts collection leaves it alone.
    const noAccounts = await computeForecastFromReads(config({ readers: readers({ accounts: [] }) }));
    expect(noAccounts.suppressedOutflow).toEqual([]);
    expect(noAccounts.projectedExpenseILS).not.toBeNull();
  });

  it('resolves a personal target WITHOUT a `budgetConfig` read — the T6 review removed that source', async () => {
    const personal: ForecastAssumption = {
      id: 'fa-target',
      ownerId: 'david',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      scopeKind: 'personalTarget',
      scopeId: 'david',
      fromPeriod: '2026-09',
      amountILS: 3000,
      reasonHe: 'יעד אישי',
      source: 'user',
      status: 'active',
    };
    const computed = await computeForecastFromReads(config({ readers: readers({ assumptions: [personal] }) }));
    expect(computed.target?.status).toBe('target');
    expect(computed.target?.status === 'target' && computed.target.source).toBe('personalTarget');
    expect(computed.target?.status === 'target' && computed.target.amountILS).toBe(3000);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// The hook itself — the four-state roll-up, and D35's reload
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('useForecast — the hook', () => {
  it('mounts in a bare renderHook with no providers and settles on `ready`', async () => {
    const { result } = renderHook(() => useForecast(config()));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.projectedBalanceILS).not.toBeNull();
  });

  it('rolls up to `permission-denied` ONLY when every input was denied', async () => {
    const nothing: ForecastScopes = {
      accounts: 'none',
      incomes: 'none',
      recurring: 'none',
      loans: 'none',
      insurances: 'none',
      history: 'none',
      assumptions: 'none',
      goals: 'none',
    };
    const { result } = renderHook(() => useForecast(config({ scopes: nothing })));
    await waitFor(() => expect(result.current.status).toBe('permission-denied'));

    // …and ONE readable input is enough to stop it being a blanket denial, which is the direction
    // that matters: a viewer who can see their own loans has something to be shown.
    const { result: partial } = renderHook(() =>
      useForecast(config({ scopes: { ...nothing, loans: 'family' } }))
    );
    await waitFor(() => expect(partial.current.status).toBe('ready'));
  });

  it('renders `error` — never a number — when the computation itself refuses', async () => {
    const { result } = renderHook(() => useForecast(config({ anchorPeriod: 'unknown' })));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.projectedBalanceILS).toBeNull();
    expect(result.current.result).toBeNull();
  });

  it('!! F9 — DURING LOADING EVERY INPUT READS `unresolved`, NOT `error`', async () => {
    // THE FINDING: the placeholder was `{state: 'error'}`, so before the reads settled all eight
    // inputs claimed a fault. It was inert in `ForecastCard` only because that component branches
    // on the scalar `status` first and never reaches this record — which made it a TRAP FOR T7b
    // rather than a live bug: the next screen has to remember the same ordering or render eight
    // false error states, and "remember to branch on status first" is not a property anything held.
    //
    // Named for what it is instead, so the trap is gone rather than documented.
    const { result } = renderHook(() => useForecast(config()));
    expect(result.current.status).toBe('loading');
    const loadingStates = Object.values(result.current.inputs).map((input) => input.state);
    expect(loadingStates).toHaveLength(8);
    expect(new Set(loadingStates)).toEqual(new Set(['unresolved']));
    expect(loadingStates).not.toContain('error');

    // …and once the reads settle, no input is `'unresolved'` any more: it is a shell state, never
    // a grade a completed computation produces.
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(Object.values(result.current.inputs).map((i) => i.state)).not.toContain('unresolved');
  });

  it('!! F9 — and a REFUSED computation reports `unresolved` too, because there is no graded read', async () => {
    // The second shell that reaches the placeholder. `'error'` here would be defensible — the
    // computation really did fail — but it would be an error attributed to eight INPUTS, none of
    // which failed; the fault belongs to the shell, and `status` already carries it.
    const { result } = renderHook(() => useForecast(config({ anchorPeriod: 'unknown' })));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(new Set(Object.values(result.current.inputs).map((i) => i.state))).toEqual(
      new Set(['unresolved'])
    );
  });

  it('!! D35 — `reload()` changes the FIGURE, not merely the call count', async () => {
    // The ruling names this exactly: "a test that asserts the rendered figure changes after a
    // mutation — not that `reload` was called". The assumption store answers differently on the
    // second read, which is what a create/edit/retire does.
    let assumptions: ForecastAssumption[] = [];
    const mutable: ForecastReaders = { ...readers(), assumptions: async () => assumptions };
    const { result } = renderHook(() => useForecast(config({ readers: mutable })));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const before = result.current.projectedBalanceILS;

    assumptions = [
      {
        id: 'fa-rent',
        ownerId: 'david',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        scopeKind: 'recurring',
        scopeId: 'rec-1',
        fromPeriod: '2026-09',
        amountILS: 6000,
        reasonHe: 'שכר הדירה עולה',
        source: 'user',
        status: 'active',
      },
    ];
    result.current.reload();
    await waitFor(() => expect(result.current.projectedBalanceILS).not.toBe(before));
    expect(result.current.projectedBalanceILS).toBe((before ?? 0) - 3000);
  });

  it('!! D33`s window cache — an unrelated re-render does NOT refetch', async () => {
    // "Cache the fetched window and re-slice on filter change." The effect depends on the scopes,
    // the viewer, the anchor and the horizon and on nothing else, so a מי or a category change —
    // both of which re-render the Dashboard — costs no reads at all.
    const spy = vi.fn(readers().history);
    const stable = config({ readers: { ...readers(), history: spy } });
    const { result, rerender } = renderHook(() => useForecast(stable));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(spy).toHaveBeenCalledTimes(1);
    rerender();
    rerender();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('refetches when the ANCHOR moves, because a different anchor is a different window', async () => {
    const spy = vi.fn(readers().history);
    let anchor = '2026-09';
    const { result, rerender } = renderHook(() =>
      useForecast(config({ anchorPeriod: anchor, readers: { ...readers(), history: spy } }))
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    anchor = '2026-12';
    rerender();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1][2]).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  });
});
