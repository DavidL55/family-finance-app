// third-lens M5 — one shared, explicit rate + date, so drift is VISIBLE rather than silently
// baked into N illustrative per-model ILS numbers.
export interface ExchangeRateInfo {
  usdToILSRate: number;
  rateAsOf: string; // ISO date 'YYYY-MM-DD' — the day this rate was last checked/updated by hand
}

// Hand-maintained until a real FX feed is worth the integration cost (no task here adds one —
// named as a deferral, not silently assumed automated). Whoever provisions the first real
// provider key (D10) must also refresh this value and its date.
export const EXCHANGE_RATE: ExchangeRateInfo = { usdToILSRate: 3.75, rateAsOf: '2026-08-17' };
