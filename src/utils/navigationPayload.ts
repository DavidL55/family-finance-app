// src/utils/navigationPayload.ts — Stage 7 T7b review, F5. THE ONE PAYLOAD SHAPE, IN ONE PLACE.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE FINDING: A DEEP LINK THAT LANDS ON AN EMPTY LIST IS NOT A DEEP LINK
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// `NavigationContext` has carried an optional payload since Stage 5 D11, and `AccountsScreen` and
// `LoansScreen` have both consumed one since then — `{ prefillCreate: … }`, sent by
// `NetWorthIncompleteNotice` to open a create form pre-populated from a legacy value. D26's forecast
// gap links and D36's drill were shipped as BARE TAB SWITCHES anyway, so the family clicks
// `יתרות חשבונות` inside a sentence explaining that they have no accounts, and arrives at a screen
// with no accounts on it. `forecastCopy.ts`'s own comment on `balanceGapHe` already claimed T7b
// "turns each named input into its create form"; it did not, and nothing held the claim.
//
// ── WHY A SECOND SHAPE RATHER THAN A SYNTHETIC `prefillCreate` ────────────────────────────────
//
// `prefillCreate` carries VALUES — a name, a type, an amount recovered from a legacy document. A
// forecast gap has none of those: the whole reason the link exists is that the collection is empty.
// Sending `{ name: '', type: 'bank', balance: 0 }` to satisfy the existing shape would put a `0` in
// a balance field nobody typed, which is the "₪0 is a statement about their money" defect (D26)
// arriving in a form control. So the destination is asked to OPEN ITS CREATE FORM, blank, and the
// two payload shapes stay honest about what they each know.
//
// ── WHY IT IS A MODULE AND NOT A LITERAL AT EACH CALL SITE ────────────────────────────────────
//
// There are two senders and two receivers. A `{ openCreate: true }` literal typed at four call
// sites is four chances to spell it `openCreated` and get a silent no-op, because an unrecognised
// payload is indistinguishable from no payload at all. One exported constant, one exported
// predicate, and `forecastDeepLinks.test.ts` derives the list of destinations that honour it FROM
// THE TREE rather than from a second hand-written list.
//
// PURE: no I/O, no React, no clock.

/**
 * The payload a screen reads as "open your create form, empty".
 *
 * `as const` so a caller cannot widen `openCreate` to `boolean` and send `false`, which the
 * predicate below would treat as absent — a distinction nobody should have to hold in their head.
 */
export const OPEN_CREATE_PAYLOAD = { openCreate: true } as const;

export interface OpenCreatePayload {
  openCreate?: boolean;
}

/**
 * Whether a navigation payload asks the destination to open its create form.
 *
 * Structural rather than an `instanceof` or a tag check, because the payload crosses
 * `history.pushState` — it is serialised and revived, so identity does not survive the trip and only
 * its shape does. Anything that is not an object with `openCreate === true` is "no", including
 * `undefined`, `null`, a string, and `{ openCreate: 'true' }`.
 */
export function readsOpenCreate(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  return (payload as OpenCreatePayload).openCreate === true;
}
