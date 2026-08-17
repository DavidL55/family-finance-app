// Task 8 review F1/F3 — the client half of the ONE monthly-ceiling semantic.
//
// Deliberately a standalone, dependency-free module rather than another export on aiClient.ts:
// aiClient.ts pulls in `firebase/functions`, so every test that wanted the shared bound would
// have had to mock Firebase to read a constant. Keeping it pure means AiSettingsScreen and its
// tests share the REAL value instead of a hand-copied literal in a mock factory.
//
// The server-side source of truth is functions/src/costGate/types.ts (MAX_MONTHLY_CEILING_ILS,
// resolveCeiling). This is the same deliberate mirroring convention the project already uses for
// AiModelInfo/AiUsageSummary across the deploy boundary — the two are kept honest by each layer's
// own tests asserting the SAME boundary values (0 accepted, MAX accepted, MAX+1 refused).

/** Mirrors MAX_MONTHLY_CEILING_ILS in functions/src/costGate/types.ts and firestore.rules. */
export const MAX_MONTHLY_CEILING_ILS = 1_000_000;

/**
 * Mirrors CeilingStatus in functions/src/costGate/types.ts:
 *   'configured' — a real number in [0, MAX]. **0 is configured**, meaning "no paid AI this
 *                  month" — NOT a synonym for unset, which is the contradiction F3 names.
 *   'unset'      — nobody has ever set one.
 *   'invalid'    — a corrupt value is stored; the cost gate refuses every paid call until it is
 *                  re-saved. Must never be rendered as "no ceiling has been set".
 */
export type CeilingStatus = 'configured' | 'unset' | 'invalid';

// A `status` string discriminant, not a boolean `ok`, matching this codebase's own
// LoadState/ResolvedPermissionsState convention — and it narrows correctly under the root
// tsconfig, which does not enable `strict`.
export type CeilingInputResult =
  | { status: 'ok'; value: number }
  | { status: 'error'; messageHe: string };

export const CEILING_EMPTY_MESSAGE_HE =
  'יש להזין תקרה חודשית — כדי לחסום קריאות AI בתשלום יש להזין 0 במפורש';
export const CEILING_RANGE_MESSAGE_HE =
  `תקרה חייבת להיות מספר בין 0 ל-${MAX_MONTHLY_CEILING_ILS.toLocaleString('he-IL')} (0 חוסם קריאות AI בתשלום)`;

/**
 * Parses what the operator typed into the ceiling field.
 *
 * The empty/whitespace case is the whole point: `Number('')` is 0, so clearing the field used to
 * SAVE a ceiling of 0 with no warning at all — and 0 was then read as "unconfigured" by both the
 * cost gate and this screen, so every paid call failed with "the ceiling has not been configured"
 * shown to the person who had just configured it. An empty field is now a refusal, and 0 is
 * something the operator has to type on purpose.
 */
export function parseCeilingInput(raw: string): CeilingInputResult {
  if (raw.trim() === '') return { status: 'error', messageHe: CEILING_EMPTY_MESSAGE_HE };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > MAX_MONTHLY_CEILING_ILS) {
    return { status: 'error', messageHe: CEILING_RANGE_MESSAGE_HE };
  }
  return { status: 'ok', value };
}
