// D14/M6 — a soft confirm above a configurable amount threshold, not a hard validation rule. A
// fat-fingered extra zero on a balance/premium/payment gets one chance to be caught before it
// silently corrupts the net-worth headline D3 (docs/superpowers/plans/2026-08-16-stage5-financial-
// modules.md) exists to make trustworthy — but a real mortgage or portfolio can legitimately
// exceed this, so it must never hard-block the save, only ask.
export const LARGE_AMOUNT_CONFIRM_THRESHOLD = 500_000; // ₪ — a soft confirm, not a hard rule (M6);
                                                          // a real mortgage can legitimately exceed it.

/**
 * Returns `true` (proceed) without prompting when `value` is below `threshold`. At or above it,
 * pops a native `window.confirm` and returns the user's own choice — never silently vetoes a
 * legitimately large figure, and never silently accepts a possibly-mistyped one without asking.
 */
export function confirmLargeAmount(value: number, threshold: number = LARGE_AMOUNT_CONFIRM_THRESHOLD): boolean {
  if (value < threshold) return true;
  return window.confirm(`הסכום שהזנת (₪${value.toLocaleString()}) גבוה במיוחד. לאשר שזה נכון?`);
}
