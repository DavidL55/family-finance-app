// src/__tests__/seasonality.test.ts — Stage 7 T6, D24.
//
// Seasonality is an ASSUMPTION. The whole of this file is about three things the plan is explicit
// about and which are easy to ship as their own opposites:
//
//   1. AN OBSERVED FACTOR NEEDS n ≥ 2 OBSERVATIONS OF THE SAME CALENDAR MONTH. A multiplier from a
//      single observation is fabrication with a decimal point, and the failure is silent: one
//      expensive September divided by a five-month average is a "1.8" that looks exactly like a
//      real seasonal index.
//   2. TWO ROWS IN THE SAME PERIOD ARE ONE OBSERVATION. `n` counts DISTINCT periods; counting rows
//      would make any category with two September receipts "seasonal".
//   3. A DERIVED FACTOR IS BOUNDED BY THE SAME NUMBERS RULES BOUND A STORED ONE BY. D24 puts the
//      bound in Rules because that is where a stored value is enforced — but the derivation half
//      has no Rules, and an unbounded derived multiplier is Stage 6's F1 with a division in it.
import { describe, expect, it } from 'vitest';
import {
  SEASONALITY_MIN_OBSERVATIONS,
  SEASONALITY_OFFERS,
  SEASONALITY_SCOPE_SEPARATOR,
  observedSeasonalFactor,
  offeredSeasonalityAssumptions,
  parseSeasonalityScopeId,
  seasonalFactorFor,
  seasonalityScopeId,
  seasonalPercentOf,
  seasonalRefusalKindOf,
  userSeasonalFactor,
  type ObservedSeasonalResult,
  type SeasonalObservation,
  type SeasonalRefusalKind,
} from '../utils/seasonality';
import { SEASONALITY_REFUSAL_HE } from '../utils/forecastCopy';
import { LOOKBACK_MONTHS_MAX } from '../utils/forecast';
import { SEASONAL_FACTOR_MAX, SEASONAL_FACTOR_MIN, type ForecastAssumption } from '../types/finance';
import { HEBREW_MONTH_NAMES } from '../config/hebrewMonths';

const CATEGORY = 'חינוך וחוגים';
const OTHER_CATEGORY = 'מזון וצריכה';

const observation = (period: string, totalILS: number, categoryId = CATEGORY): SeasonalObservation => ({
  categoryId,
  period,
  totalILS,
});

const assumption = (over: Partial<ForecastAssumption> = {}): ForecastAssumption =>
  ({
    id: 'fa-1',
    ownerId: 'david',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scopeKind: 'seasonality',
    scopeId: `${CATEGORY}${SEASONALITY_SCOPE_SEPARATOR}09`,
    fromPeriod: '2026-01',
    amountILS: 0,
    factor: 1.3,
    reasonHe: 'ספטמבר יקר',
    source: 'user',
    status: 'active',
    ...over,
  }) as ForecastAssumption;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the scope id — D24's `${categoryId}:${monthKey}`
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('the seasonality scope id round-trips, and refuses everything else', () => {
  it('formats and parses back to the same pair', () => {
    const id = seasonalityScopeId(CATEGORY, '09');
    expect(id).toBe(`${CATEGORY}${SEASONALITY_SCOPE_SEPARATOR}09`);
    expect(parseSeasonalityScopeId(id)).toEqual({ categoryId: CATEGORY, monthKey: '09' });
  });

  it('refuses a month key that is not zero-padded 01..12', () => {
    // These are the four shapes that make a plausible-looking bucket: an unpadded month, a
    // thirteenth month, a zeroth month, and an empty one. Each would group a factor under a key no
    // period can ever produce, so the assumption would be stored, listed, and never applied.
    expect(parseSeasonalityScopeId(`${CATEGORY}:9`)).toBeNull();
    expect(parseSeasonalityScopeId(`${CATEGORY}:13`)).toBeNull();
    expect(parseSeasonalityScopeId(`${CATEGORY}:00`)).toBeNull();
    expect(parseSeasonalityScopeId(`${CATEGORY}:`)).toBeNull();
  });

  it('refuses an empty category, a missing separator, and a non-string', () => {
    expect(parseSeasonalityScopeId(':09')).toBeNull();
    expect(parseSeasonalityScopeId(`${CATEGORY}09`)).toBeNull();
    expect(parseSeasonalityScopeId(undefined)).toBeNull();
    expect(parseSeasonalityScopeId(42)).toBeNull();
  });

  it('keeps a category that itself contains the separator, by splitting at the LAST one', () => {
    // A category id is free text stamped by the extractor. Splitting at the first separator would
    // truncate `'ספורט: חוגים'` to `'ספורט'` and then read `' חוגים'` as a month key — a factor
    // filed under a category that does not exist, silently never applied.
    const id = seasonalityScopeId('ספורט: חוגים', '04');
    expect(parseSeasonalityScopeId(id)).toEqual({ categoryId: 'ספורט: חוגים', monthKey: '04' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the OBSERVED half — n ≥ 2 same-calendar-months
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('an observed seasonal factor needs two observations of the same calendar month', () => {
  it('refuses at n = 1 and names the n', () => {
    const result = observedSeasonalFactor(CATEGORY, '09', [
      observation('2025-09', 1800),
      observation('2025-08', 1000),
      observation('2025-07', 1000),
      observation('2025-06', 1000),
    ]);
    expect(result).toEqual({ status: 'insufficient-observations', n: 1 });
  });

  it('derives the factor at n = 2 — the month mean over the OTHER months mean', () => {
    // Septembers 1800 and 1200 → mean 1500. The other four months → mean 1000. Factor 1.5.
    //
    // The baseline is the mean of the OTHER calendar months and NOT the whole-category mean, and
    // that is the difference between a number that means what the hover says it means and one that
    // does not. D24's own sentence is "ספטמבר היה יקר ב-30%" — more expensive THAN A NORMAL MONTH.
    // Dividing by a mean that INCLUDES September answers a different question and is bounded from
    // above by the ratio of period counts, so a genuinely extreme month can never cross the
    // implausibility ceiling below.
    const result = observedSeasonalFactor(CATEGORY, '09', [
      observation('2025-09', 1800),
      observation('2026-09', 1200),
      observation('2025-08', 1000),
      observation('2025-07', 1000),
      observation('2026-08', 1000),
      observation('2026-07', 1000),
    ]);
    expect(result).toEqual({ status: 'factor', factor: { factor: 1.5, source: 'observed', n: 2 } });
  });

  it('counts DISTINCT periods, not rows — two receipts in one September are one observation', () => {
    const result = observedSeasonalFactor(CATEGORY, '09', [
      observation('2025-09', 900),
      observation('2025-09', 900),
      observation('2025-08', 1000),
      observation('2025-07', 1000),
    ]);
    expect(result).toEqual({ status: 'insufficient-observations', n: 1 });
  });

  it('reads only its own category — another category cannot lend it observations', () => {
    const result = observedSeasonalFactor(CATEGORY, '09', [
      observation('2025-09', 1800),
      observation('2026-09', 1200, OTHER_CATEGORY),
      observation('2025-08', 1000),
    ]);
    expect(result).toEqual({ status: 'insufficient-observations', n: 1 });
  });

  it('ignores a malformed period rather than bucketing it', () => {
    // `period: 'unknown'` is a REAL stamped value (D21c) and `''` is what an unstamped row looks
    // like. Neither is a calendar month, and `monthKeyOf` refuses both — so the derivation must
    // skip them rather than let the refusal escape into a caller that is averaging.
    const result = observedSeasonalFactor(CATEGORY, '09', [
      observation('2025-09', 1800),
      observation('unknown', 1200),
      observation('', 1200),
      observation('2025-08', 1000),
    ]);
    expect(result).toEqual({ status: 'insufficient-observations', n: 1 });
  });

  it('refuses when the whole-category baseline is zero — the factor would be infinite', () => {
    const result = observedSeasonalFactor(CATEGORY, '09', [
      observation('2025-09', 0),
      observation('2026-09', 0),
    ]);
    expect(result).toEqual({ status: 'no-baseline' });
  });

  it('refuses a derived factor outside the bounds Rules enforce on a stored one', () => {
    // Septembers of ₪100,000 against ordinary months of ₪1: factor 100,000. A busy September is
    // 1.3; this shape is a corrupt amount or a category that changed meaning, and a five-figure
    // multiplier on a displayed number is Stage 6's F1 with a division in it. Rules bound a STORED
    // factor; nothing bounds a DERIVED one except this.
    const result = observedSeasonalFactor(CATEGORY, '09', [
      observation('2025-09', 100000),
      observation('2026-09', 100000),
      observation('2025-08', 1),
      observation('2025-07', 1),
      observation('2025-06', 1),
      observation('2025-05', 1),
    ]);
    expect(result.status).toBe('implausible-factor');
    if (result.status === 'implausible-factor') expect(result.factor).toBeGreaterThan(SEASONAL_FACTOR_MAX);
  });

  it('refuses a derived factor below the floor for the same reason', () => {
    const result = observedSeasonalFactor(CATEGORY, '09', [
      observation('2025-09', 1),
      observation('2026-09', 1),
      observation('2025-08', 100000),
      observation('2025-07', 100000),
    ]);
    expect(result.status).toBe('implausible-factor');
    if (result.status === 'implausible-factor') expect(result.factor).toBeLessThan(SEASONAL_FACTOR_MIN);
  });

  it('is UNREACHABLE from the statistical layer today, and the arithmetic says why', () => {
    // !! THIS IS THE HONEST HALF OF D24/A31. Two observations of the same calendar month are twelve
    // periods apart, and the layer reads a window of `LOOKBACK_MONTHS_MAX` periods. So the observed
    // derivation cannot fire from the layer until the window widens past a year — which is the
    // plan's own "roughly 14 months of history, so that half is dead code for a long time".
    //
    // It is asserted rather than written in a comment because it is also what makes D26's
    // `seasonalityAllowed` floor consistent instead of contradictory: the observed half can only
    // ever fire in a row where seasonality is already allowed, so no extra check is needed and no
    // extra check can shadow one.
    expect(LOOKBACK_MONTHS_MAX).toBeLessThan(SEASONALITY_MIN_OBSERVATIONS * HEBREW_MONTH_NAMES.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the USER half — first-class, and the one that works on day one
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('a user-authored factor applies to its own category and its own calendar month', () => {
  it('applies in September and not in October', () => {
    expect(userSeasonalFactor(CATEGORY, '2026-09', [assumption()])).toEqual({
      factor: 1.3,
      source: 'user',
      n: 0,
    });
    expect(userSeasonalFactor(CATEGORY, '2026-10', [assumption()])).toBeNull();
  });

  it('applies in EVERY September, not only the one the assumption was written in', () => {
    // The scope key is (category, month-of-year). An assumption written in 2026 is a statement
    // about Septembers, and reading it as a statement about 2026-09 alone would make it expire
    // silently after one year.
    expect(userSeasonalFactor(CATEGORY, '2027-09', [assumption()])).not.toBeNull();
  });

  it('does not leak into another category', () => {
    expect(userSeasonalFactor(OTHER_CATEGORY, '2026-09', [assumption()])).toBeNull();
  });

  it('ignores retired assumptions, other scope kinds, and windows that have closed', () => {
    expect(userSeasonalFactor(CATEGORY, '2026-09', [assumption({ status: 'retired' })])).toBeNull();
    expect(userSeasonalFactor(CATEGORY, '2026-09', [assumption({ scopeKind: 'category' })])).toBeNull();
    expect(userSeasonalFactor(CATEGORY, '2026-09', [assumption({ fromPeriod: '2027-01' })])).toBeNull();
    expect(userSeasonalFactor(CATEGORY, '2026-09', [assumption({ toPeriod: '2026-08' })])).toBeNull();
    // and the inclusive edges, which is where an off-by-one lives
    expect(userSeasonalFactor(CATEGORY, '2026-09', [assumption({ fromPeriod: '2026-09' })])).not.toBeNull();
    expect(userSeasonalFactor(CATEGORY, '2026-09', [assumption({ toPeriod: '2026-09' })])).not.toBeNull();
  });

  it('ignores a stored factor outside the bounds — Rules block it, the Admin SDK does not', () => {
    // `firestore.rules` bounds `factor` for a client write. Every seeder and migration in this repo
    // runs on the Admin SDK, which bypasses Rules entirely, so the client cannot treat the bound as
    // already enforced. A `factor: 1e9` multiplying a displayed number is Stage 6's F1 verbatim.
    expect(userSeasonalFactor(CATEGORY, '2026-09', [assumption({ factor: 1e9 })])).toBeNull();
    expect(userSeasonalFactor(CATEGORY, '2026-09', [assumption({ factor: 0 })])).toBeNull();
    expect(userSeasonalFactor(CATEGORY, '2026-09', [assumption({ factor: Number.NaN })])).toBeNull();
    expect(userSeasonalFactor(CATEGORY, '2026-09', [assumption({ factor: undefined })])).toBeNull();
  });

  it('ignores a scope id that does not parse', () => {
    expect(userSeasonalFactor(CATEGORY, '2026-09', [assumption({ scopeId: CATEGORY })])).toBeNull();
    expect(userSeasonalFactor(CATEGORY, '2026-09', [assumption({ scopeId: `${CATEGORY}:9` })])).toBeNull();
  });

  it('resolves two colliding assumptions by D20s tail — newest updatedAt, then id ascending', () => {
    const older = assumption({ id: 'fa-a', factor: 1.1, updatedAt: '2026-02-01T00:00:00.000Z' });
    const newer = assumption({ id: 'fa-b', factor: 1.9, updatedAt: '2026-03-01T00:00:00.000Z' });
    expect(userSeasonalFactor(CATEGORY, '2026-09', [older, newer])?.factor).toBe(1.9);
    // and shuffling the input must not change the answer — D20's own property
    expect(userSeasonalFactor(CATEGORY, '2026-09', [newer, older])?.factor).toBe(1.9);
    const sameInstant = assumption({ id: 'fa-c', factor: 1.4, updatedAt: newer.updatedAt });
    expect(userSeasonalFactor(CATEGORY, '2026-09', [newer, sameInstant])?.factor).toBe(1.9);
    expect(userSeasonalFactor(CATEGORY, '2026-09', [sameInstant, newer])?.factor).toBe(1.9);
  });

  it('!! an out-of-range factor does not WIN the tiebreak and then vanish (sweep survivor M16)', () => {
    // Dropping the bound from the FILTER survived: a lone bad factor is refused by the check on the
    // winner either way. It stops being equivalent with a collision — the out-of-range document has
    // the newer `updatedAt`, so it would win and then be refused, and a perfectly good factor the
    // family authored would silently disappear because somebody else's document is corrupt.
    const good = assumption({ id: 'fa-good', factor: 1.3, updatedAt: '2026-02-01T00:00:00.000Z' });
    const corrupt = assumption({ id: 'fa-corrupt', factor: 1e9, updatedAt: '2026-03-01T00:00:00.000Z' });
    expect(userSeasonalFactor(CATEGORY, '2026-09', [good, corrupt])?.factor).toBe(1.3);
    expect(userSeasonalFactor(CATEGORY, '2026-09', [corrupt, good])?.factor).toBe(1.3);
  });

  it('refuses a malformed period rather than answering for it', () => {
    expect(() => userSeasonalFactor(CATEGORY, '', [assumption()])).toThrow(/monthKeyOf/);
    expect(() => userSeasonalFactor(CATEGORY, 'unknown', [assumption()])).toThrow(/monthKeyOf/);
  });
});

describe('seasonalFactorFor — the user half wins, because an assumption beats the statistics', () => {
  const septembers: SeasonalObservation[] = [
    observation('2025-09', 1800),
    observation('2026-09', 1200),
    observation('2025-08', 1000),
    observation('2025-07', 1000),
    observation('2026-08', 1000),
    observation('2026-07', 1000),
  ];

  it('prefers the user factor over an observed one that would otherwise apply', () => {
    expect(seasonalFactorFor(CATEGORY, '2026-09', [assumption()], septembers)).toEqual({
      factor: 1.3,
      source: 'user',
      n: 0,
    });
  });

  it('falls back to the observed factor when there is no user assumption', () => {
    expect(seasonalFactorFor(CATEGORY, '2026-09', [], septembers)).toEqual({
      factor: 1.5,
      source: 'observed',
      n: 2,
    });
  });

  it('is null when neither half has anything to say', () => {
    expect(seasonalFactorFor(CATEGORY, '2026-09', [], [observation('2025-09', 1800)])).toBeNull();
  });

  it('is null when the observed half refuses — a refusal is not a factor of 1', () => {
    // A factor of 1 and "no factor" render differently: 1 says "we looked and this month is
    // ordinary", null says "we have nothing to say". D26's whole no-₪0 argument, one type over.
    expect(seasonalFactorFor(CATEGORY, '2026-09', [], [observation('2025-09', 0), observation('2026-09', 0)])).toBeNull();
  });
});

describe('D24s floor is stated, not silent — every refusal has its own sentence', () => {
  it('every non-factor status maps to a refusal kind, and every kind has a sentence', () => {
    // D24: below n = 2 "no factor is applied AND THE LINE SAYS WHY". A state with no sentence is
    // the half of that ruling that gets dropped, so the mapping is a TOTAL switch — a fourth
    // refusal added to the union fails to compile in `seasonalRefusalKindOf` rather than reaching
    // the screen with nothing to say.
    const results: ObservedSeasonalResult[] = [
      { status: 'insufficient-observations', n: 1 },
      { status: 'no-baseline' },
      { status: 'implausible-factor', factor: 99 },
    ];
    // !! EACH RESULT MAPS TO ITS OWN KIND, and the first draft of this assertion did not say so —
    // it checked only that the kind was non-null and that a sentence existed for it, so a mapping
    // that collapsed all three refusals onto one SURVIVED the sweep. Three genuinely different
    // reasons rendering one sentence is the "one shrug for all three" D26 rejects, and the
    // assertion that was supposed to prevent it could not see it.
    for (const result of results) {
      const kind = seasonalRefusalKindOf(result);
      expect(kind).toBe(result.status);
      expect(SEASONALITY_REFUSAL_HE[kind as SeasonalRefusalKind]).toBeTruthy();
    }
    expect(seasonalRefusalKindOf({ status: 'factor', factor: { factor: 1.3, source: 'user', n: 0 } })).toBeNull();
  });

  it('the copy module`s key union and the refusal union are the same set', () => {
    // `forecastCopy.ts` imports nothing by assertion, so its key union is SPELLED there rather than
    // imported. That is exactly how two unions drift, so they are held against each other here.
    const kinds = (['insufficient-observations', 'no-baseline', 'implausible-factor'] as SeasonalRefusalKind[]).sort();
    expect(Object.keys(SEASONALITY_REFUSAL_HE).sort()).toEqual(kinds);
  });

  it('a factor is reported as a signed whole percentage', () => {
    expect(seasonalPercentOf({ factor: 1.3, source: 'user', n: 0 })).toBe(30);
    expect(seasonalPercentOf({ factor: 0.8, source: 'observed', n: 2 })).toBe(-20);
    expect(seasonalPercentOf({ factor: 1, source: 'user', n: 0 })).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A31 — the September/April offers ship OFFERED, PRE-FILLED, ATTRIBUTED and EDITABLE
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('the offered factors are §10s own two months, and they are complete documents', () => {
  it('offers exactly September and April, the two months the spec names', () => {
    expect(SEASONALITY_OFFERS.map((o) => o.monthKey).sort()).toEqual(['04', '09']);
  });

  it('every offer is pre-filled: an in-range factor and a non-empty reason', () => {
    expect(SEASONALITY_OFFERS.length).toBeGreaterThan(0);
    for (const offer of SEASONALITY_OFFERS) {
      expect(offer.factor).toBeGreaterThanOrEqual(SEASONAL_FACTOR_MIN);
      expect(offer.factor).toBeLessThanOrEqual(SEASONAL_FACTOR_MAX);
      expect(offer.reasonHe.trim().length).toBeGreaterThan(0);
      expect(offer.categoryId.trim().length).toBeGreaterThan(0);
    }
  });

  it('no offer spells a month name — the name comes from the one array that holds them', () => {
    // The month-literal guard governs this module's SOURCE; this assertion governs the VALUES,
    // which is the half a source guard cannot see once a string is built by concatenation.
    for (const offer of SEASONALITY_OFFERS) {
      for (const name of HEBREW_MONTH_NAMES) expect(offer.reasonHe).not.toContain(name);
    }
  });

  it('an offer becomes a writable assumption attributed to the member who accepts it', () => {
    const drafts = offeredSeasonalityAssumptions({
      offers: SEASONALITY_OFFERS,
      existing: [],
      ownerId: 'lilit',
      fromPeriod: '2026-08',
    });
    expect(drafts).toHaveLength(SEASONALITY_OFFERS.length);
    for (const draft of drafts) {
      expect(draft.ownerId).toBe('lilit');
      expect(draft.scopeKind).toBe('seasonality');
      expect(draft.source).toBe('user');
      expect(draft.status).toBe('active');
      expect(draft.fromPeriod).toBe('2026-08');
      expect(draft.amountILS).toBe(0);
      expect(parseSeasonalityScopeId(draft.scopeId)).not.toBeNull();
    }
  });

  it('stops offering what the family already has — one click, not a growing pile', () => {
    const first = offeredSeasonalityAssumptions({
      offers: SEASONALITY_OFFERS,
      existing: [],
      ownerId: 'lilit',
      fromPeriod: '2026-08',
    });
    const accepted = assumption({ id: 'fa-accepted', scopeId: first[0].scopeId, ownerId: 'david' });
    const remaining = offeredSeasonalityAssumptions({
      offers: SEASONALITY_OFFERS,
      existing: [accepted],
      ownerId: 'lilit',
      fromPeriod: '2026-08',
    });
    expect(remaining).toHaveLength(first.length - 1);
    expect(remaining.map((d) => d.scopeId)).not.toContain(first[0].scopeId);
  });

  it('keeps offering one the family RETIRED — a retired assumption is a decision, not a hole', () => {
    // A retired assumption still occupies its scope: re-offering it would put the same suggestion
    // back in front of someone who has already said no to it. `status` is checked, so "retired"
    // suppresses the offer exactly as "active" does.
    const first = offeredSeasonalityAssumptions({
      offers: SEASONALITY_OFFERS,
      existing: [],
      ownerId: 'lilit',
      fromPeriod: '2026-08',
    });
    const retired = assumption({ id: 'fa-retired', scopeId: first[0].scopeId, status: 'retired' });
    const remaining = offeredSeasonalityAssumptions({
      offers: SEASONALITY_OFFERS,
      existing: [retired],
      ownerId: 'lilit',
      fromPeriod: '2026-08',
    });
    expect(remaining.map((d) => d.scopeId)).not.toContain(first[0].scopeId);
  });

  it('is editable by construction — the draft is a plain document, not a frozen preset', () => {
    const drafts = offeredSeasonalityAssumptions({
      offers: SEASONALITY_OFFERS,
      existing: [],
      ownerId: 'lilit',
      fromPeriod: '2026-08',
    });
    const septemberDraft = drafts.find((d) => parseSeasonalityScopeId(d.scopeId)?.monthKey === '09');
    expect(septemberDraft).toBeDefined();
    const edited = { ...(septemberDraft as ForecastAssumption), factor: 1.15, reasonHe: 'אצלנו זה פחות' };
    const scope = parseSeasonalityScopeId(edited.scopeId);
    expect(userSeasonalFactor(scope?.categoryId ?? '', '2026-09', [edited])).toEqual({
      factor: 1.15,
      source: 'user',
      n: 0,
    });
  });
});
