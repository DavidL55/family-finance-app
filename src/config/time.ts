// src/config/time.ts — the client half of the ONE "which month is it" semantic (D32b).
//
// Stage 7 adds three new places where the app decides which month it is, and the word "timezone"
// appeared zero times in the plan that preceded it. The only pinned clock in the tree before this
// is the cost gate's, and it was added AFTER a rollover bug corrupted two months of counters:
// `functions/src/costGate/costGate.ts` formats its `monthKey` with `timeZone: 'Asia/Jerusalem'`
// precisely because a Functions container's local time is UTC and the plain `Date` getters roll the
// month boundary 2-3 hours off Israel's real one, in BOTH directions.
//
// ── WHY THIS IS A SECOND DECLARATION AND NOT AN IMPORT ─────────────────────────────────────────
//
// D32 says `APP_TIMEZONE` is "reused from the cost gate, not re-declared". IT CANNOT BE. There is
// no exported constant to reuse — the cost gate holds the literal inline inside its
// `Intl.DateTimeFormat` options — and `functions/src/shared/permissions.ts:11-14` forbids moving a
// second piece of logic across the deploy boundary in writing, instructing an esbuild/tsup
// predeploy step instead. So `src/` gets one declaration, and the SUBSTANCE of "not re-declared" —
// that there is exactly one value and it cannot drift — is enforced by `appTimezone.test.ts`,
// which reads the functions-side literal off disk and asserts no other `'Asia/Jerusalem'` exists
// anywhere in `src/`. That is the same mirroring convention `src/config/aiCeiling.ts` already
// documents for `MAX_MONTHLY_CEILING_ILS`: two layers, one value, each layer's tests holding it.
//
// NOTHING IN `src/utils/forecast.ts` MAY READ THIS. The forecast core takes `todayPeriod` as a
// parameter and reads no clock at all (D37) — this constant belongs to whoever computes that
// parameter, at the edge, once.

/**
 * The timezone every "which month is it" decision in this app is made in. Mirrors the literal in
 * `functions/src/costGate/costGate.ts`'s `monthKey`; `appTimezone.test.ts` holds the two together
 * and forbids a third copy in `src/`.
 */
export const APP_TIMEZONE = 'Asia/Jerusalem';
