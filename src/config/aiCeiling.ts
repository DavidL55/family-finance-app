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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Batch 8 (closing review B4) — formatILS MOVED HERE from AiSettingsScreen.tsx, byte-identical.
// A move, not a rewrite.
//
// It was a private helper on the settings screen. Batch 8 adds a second surface rendering a ₪
// figure from the same cost gate — the overage-approval panel, which states the amount a
// super-admin is about to authorise — and a second formatter beside the first is how this
// project's own F4 class starts: one copy goes stale and the same ₪0.0004 charge reads as "₪0.00"
// on one screen and "פחות מ-₪0.01" on the other. The reasoning below is Task 8 review F8's,
// unchanged; only its home moved, into the dependency-free config module the AI money semantics
// already live in (see this file's header for why that module must stay import-free).
// ─────────────────────────────────────────────────────────────────────────────────────────────

// Task 8 review F8 (Ofra) — one money formatter. Before this, the same table rendered ₪0 (for a
// real ₪0.0004 charge — a genuine cost displayed as nothing), ₪0.038 and ₪1,234.568 side by side:
// no fraction-digit control and `toLocaleString()` with no locale, so grouping followed each
// device. ComparisonTable.tsx already pins 'he-IL'; this follows it.
const MIN_DISPLAYED_ILS = 0.01;

/**
 * Batch 6 (closing review B1) — `number | null`. The server says "unreadable" explicitly instead
 * of leaking a NaN that only rendered as ₪— by accident of Number.isFinite; the guard stays for a
 * NaN arriving some other way, but null is the typed, intended path.
 */
export function formatILS(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return '₪—';
  // A charge that is real but smaller than an agora must not round away to "₪0.00", which reads
  // as free. Chosen over adding more decimal places (₪0.0004 is noise a reader cannot use, and it
  // would wreck column alignment for the ₪1,234.57 beside it) and over "₪0.01" (that would round
  // UP, overstating a real number on a screen this batch exists to make honest). "Less than an
  // agora" is the only form that is both readable and true.
  if (amount > 0 && amount < MIN_DISPLAYED_ILS) return `פחות מ-₪${MIN_DISPLAYED_ILS.toFixed(2)}`;
  return `₪${amount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Mirrors CeilingStatus in functions/src/costGate/types.ts:
 *   'configured' — a real number in [0, MAX]. **0 is configured**, meaning "no paid AI this
 *                  month" — NOT a synonym for unset, which is the contradiction F3 names.
 *   'unset'      — nobody has ever set one.
 *   'invalid'    — a corrupt value is stored; the cost gate refuses every paid call until it is
 *                  re-saved. Must never be rendered as "no ceiling has been set".
 */
export type CeilingStatus = 'configured' | 'unset' | 'invalid';

/**
 * Batch 6 (closing review B1) — mirrors AiUsageStatus in functions/src/handlers/types.ts. It is
 * the USAGE half of the CeilingStatus semantic above, and it exists for the same reason.
 *
 * 'corrupt' means at least one stored ₪ figure for this month — a monthly counter or a ledger
 * entry's amount — is not a readable number. costGate.spend() refuses EVERY paid call in that
 * state, so it must never be rendered as "₪0.00 spent": that is F1's "gate off, screen
 * reassuring" pairing with the sign flipped. Before this batch the corrupt total reached the
 * progress bar as a NaN and rendered literally as "NaN% מהתקרה".
 */
export type AiUsageStatus = 'ok' | 'corrupt';

// Deliberately does NOT contain the phrase "מהתקרה": that string belongs to the percentage line
// this notice REPLACES, and the F2 guard asserts it appears exactly once on the screen. Reusing it
// here would make "the percentage is gone" untestable by text — a small thing, but it is the same
// class as a guard a comment can satisfy.
export const USAGE_CORRUPT_MESSAGE_HE =
  'רישום ההוצאות של ה-AI לחודש זה פגום ולא ניתן לקריאה — לא ניתן להציג את סך ההוצאות החודשי, וכל קריאת AI בתשלום חסומה עד שהנתונים יתוקנו בשרת';

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
