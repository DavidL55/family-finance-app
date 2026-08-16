import { describe, expect, it, vi, beforeEach } from 'vitest';
import { confirmLargeAmount, LARGE_AMOUNT_CONFIRM_THRESHOLD } from '../utils/amountConfirm';

describe('confirmLargeAmount (D14/M6)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('below the threshold never prompts', () => {
    const spy = vi.spyOn(window, 'confirm');
    expect(confirmLargeAmount(1000)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
  it('at/above the threshold prompts and returns the user choice (accept)', () => {
    const spy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    expect(confirmLargeAmount(LARGE_AMOUNT_CONFIRM_THRESHOLD)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('at/above the threshold prompts and returns the user choice (decline)', () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    expect(confirmLargeAmount(LARGE_AMOUNT_CONFIRM_THRESHOLD)).toBe(false);
  });
  it('a custom threshold overrides the default', () => {
    const spy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    expect(confirmLargeAmount(50, 10)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
