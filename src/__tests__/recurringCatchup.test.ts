// src/__tests__/recurringCatchup.test.ts
import { describe, expect, it } from 'vitest';
import { computeDuePeriods } from '../utils/recurringCatchup';

const base = { status: 'active' as const, chargeDay: 10, startDate: '2026-06-01' };

describe('computeDuePeriods', () => {
  it('returns [] for a paused item', () => {
    expect(computeDuePeriods({ ...base, status: 'paused' }, new Date('2026-08-15'))).toEqual([]);
  });

  it('returns [] for an ended item', () => {
    expect(computeDuePeriods({ ...base, status: 'ended' }, new Date('2026-08-15'))).toEqual([]);
  });

  it('a brand-new item whose chargeDay has NOT yet been reached this month is not due', () => {
    expect(computeDuePeriods({ ...base, startDate: '2026-08-01', chargeDay: 20 }, new Date('2026-08-15'))).toEqual([]);
  });

  it('a brand-new item whose chargeDay HAS been reached this month is due for the current period only', () => {
    expect(computeDuePeriods({ ...base, startDate: '2026-08-01', chargeDay: 10 }, new Date('2026-08-15'))).toEqual(['2026-08']);
  });

  it('catches up multiple fully-elapsed months plus the current one, when chargeDay has passed', () => {
    const result = computeDuePeriods({ ...base, lastPostedPeriod: '2026-05', chargeDay: 10 }, new Date('2026-08-15'));
    expect(result).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('catches up past months but WITHHOLDS the current month when chargeDay has not passed yet', () => {
    const result = computeDuePeriods({ ...base, lastPostedPeriod: '2026-05', chargeDay: 20 }, new Date('2026-08-15'));
    expect(result).toEqual(['2026-06', '2026-07']);
  });

  it('returns [] when the current period was already posted', () => {
    expect(computeDuePeriods({ ...base, lastPostedPeriod: '2026-08', chargeDay: 1 }, new Date('2026-08-15'))).toEqual([]);
  });

  it('respects endDate — nothing due after the item has ended', () => {
    const result = computeDuePeriods({ ...base, lastPostedPeriod: '2026-05', endDate: '2026-06-30', chargeDay: 1 }, new Date('2026-08-15'));
    expect(result).toEqual(['2026-06']);
  });

  it('handles a December -> January year rollover correctly', () => {
    const result = computeDuePeriods({ ...base, startDate: '2025-11-01', lastPostedPeriod: '2025-11', chargeDay: 5 }, new Date('2026-01-10'));
    expect(result).toEqual(['2025-12', '2026-01']);
  });

  it('returns [] for a malformed range (endDate before startDate)', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-08-01', endDate: '2026-01-01', chargeDay: 1 }, new Date('2026-08-15'));
    expect(result).toEqual([]);
  });

  // --- Additional edge cases beyond the brief ---

  it('chargeDay 31 never literally occurs in a 30-day month (April) — stays not-due even on April 30, the month\'s last real day', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-04-01', chargeDay: 31 }, new Date('2026-04-30'));
    expect(result).toEqual([]);
  });

  it('...but that deferred April charge is swept up automatically once May begins, since April is now a fully-elapsed past period (no clamping needed — the past-period rule self-heals it)', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-04-01', chargeDay: 31 }, new Date('2026-05-01'));
    expect(result).toEqual(['2026-04']);
  });

  it('chargeDay 31 in February (28-day month, non-leap) never fires within February itself', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-02-01', chargeDay: 31 }, new Date('2026-02-28'));
    expect(result).toEqual([]);
  });

  it('chargeDay 29 in February of a non-leap year (2026) never fires within February itself — deferred to the March catch-up as a past period', () => {
    expect(computeDuePeriods({ ...base, startDate: '2026-02-01', chargeDay: 29 }, new Date('2026-02-28'))).toEqual([]);
    // March 5th: February (elapsed) is swept up; March itself isn't due yet since day 5 < chargeDay 29.
    expect(computeDuePeriods({ ...base, startDate: '2026-02-01', chargeDay: 29 }, new Date('2026-03-05'))).toEqual(['2026-02']);
  });

  it('chargeDay 29 in February of a leap year posts exactly on the 29th, not before', () => {
    expect(computeDuePeriods({ ...base, startDate: '2024-02-01', chargeDay: 29 }, new Date('2024-02-28'))).toEqual([]);
    expect(computeDuePeriods({ ...base, startDate: '2024-02-01', chargeDay: 29 }, new Date('2024-02-29'))).toEqual(['2024-02']);
  });

  it('an item starting mid-month AFTER its chargeDay already passed this month is still due this period (start gates the floor, not chargeDay)', () => {
    // Item starts on the 15th with chargeDay 10 (already "passed" on start date) — first period is still due once reached.
    const result = computeDuePeriods({ ...base, startDate: '2026-08-15', chargeDay: 10 }, new Date('2026-08-20'));
    expect(result).toEqual(['2026-08']);
  });

  it('an item whose startDate is in the future relative to today produces no due periods', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-09-01', chargeDay: 1 }, new Date('2026-08-15'));
    expect(result).toEqual([]);
  });

  it('lastPostedPeriod in the future relative to today (clock skew / bad data) yields no negative range, just []', () => {
    const result = computeDuePeriods({ ...base, lastPostedPeriod: '2026-12', chargeDay: 1 }, new Date('2026-08-15'));
    expect(result).toEqual([]);
  });

  it('lastPostedPeriod equal to the current period with chargeDay still unmet yields []', () => {
    const result = computeDuePeriods({ ...base, lastPostedPeriod: '2026-08', chargeDay: 25 }, new Date('2026-08-15'));
    expect(result).toEqual([]);
  });

  it('lastPostedPeriod before startDate (bad data) does not resurrect periods before the item started', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-06-01', lastPostedPeriod: '2025-01', chargeDay: 1 }, new Date('2026-08-15'));
    expect(result).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('endDate falling exactly in the current period still allows the current period once chargeDay is met', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-08-01', endDate: '2026-08-31', chargeDay: 10 }, new Date('2026-08-15'));
    expect(result).toEqual(['2026-08']);
  });

  it('endDate in the past relative to today, with nothing ever posted, catches up only through the end period', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-01-01', endDate: '2026-03-15', chargeDay: 1 }, new Date('2026-08-15'));
    expect(result).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('is idempotent: calling again with lastPostedPeriod advanced to the prior result\'s last period returns []', () => {
    const first = computeDuePeriods({ ...base, lastPostedPeriod: '2026-05', chargeDay: 10 }, new Date('2026-08-15'));
    expect(first).toEqual(['2026-06', '2026-07', '2026-08']);
    const second = computeDuePeriods({ ...base, lastPostedPeriod: first[first.length - 1], chargeDay: 10 }, new Date('2026-08-15'));
    expect(second).toEqual([]);
  });
});
