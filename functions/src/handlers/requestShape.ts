// ACCEPTANCE RE-MEASURE — THE LAST PLACE THE SWALLOWED-ERROR PATTERN SURVIVED.
//
// Three callables destructured `request.data` and then read fields off it with no check at all:
// aiChat (`history.reduce`), aiExtractDocument (`fileBase64.length`) and
// requestAiOverageApproval (four fields straight into `quote()`). A malformed payload threw a raw
// TypeError out of the handler, and the Functions runtime redacts an unhandled throw to a generic
// INTERNAL — precisely the class D4/Sasha I4 closed everywhere else, where a plain Error thrown
// from an onCall handler silently swallowed the Hebrew refusal the client is required to see.
//
// None of the three is reachable from the UI: every client call site sends every field. That is
// not an input contract. These are PUBLIC HTTPS endpoints, and two of the gaps did something
// strictly worse than crash:
//
//   · aiExtractDocument — `.length` on a NUMBER is `undefined`, and `undefined > MAX` is FALSE,
//     so a non-string payload walked straight PAST D17's size guard, made estIn NaN, and reached
//     spend(). The guard whose entire purpose is that an oversized document never costs anything
//     was bypassed by sending the wrong TYPE instead of too many bytes.
//   · requestAiOverageApproval — a non-numeric token count prices a KNOWN model pair, so the
//     `q.unknown` refusal ("you cannot mint an approval for an amount nobody can state", bd97326)
//     does not fire; the arithmetic yields estimatedILS: NaN and a real single-use token is minted
//     bound to NaN. `amount <= NaN` is false, so it is granted-looking, unredeemable, and burned
//     on first use — the exact state that refusal exists to make unreachable, reached by a
//     different door.
//
// ONE MODULE RATHER THAN THREE COPIES, for this project's own stated reason: "a fix applied to one
// of two symmetric callers is half a fix" (aiOverage.ts's header). Three hand-rolled type ladders
// would drift, and the drift would be invisible — each handler's tests would still pass.
//
// Every reader THROWS rather than returning a null the caller might forget to check. That is the
// opposite of the client-side readOverageRefusal convention on purpose: there, a partial payload
// must degrade to "no affordance"; here, the only correct response to a malformed request is to
// refuse it, and a reader that can be ignored is a guard that can be forgotten.
import { HttpsError } from 'firebase-functions/v2/https';

/**
 * One message for every shape refusal, deliberately.
 *
 * It does NOT name the offending field: the field name goes in `details` for the developer, while
 * the human-readable half stays a single actionable sentence. A per-field Hebrew string would be
 * copy nobody can act on differently ("filterScope.period.month is not a string" helps no family
 * member), and it would be one more set of literals to keep honest.
 *
 * Distinct from HISTORY_TOO_LONG_MESSAGE_HE and OVERSIZED_DOCUMENT_MESSAGE_HE, and the handler
 * tests assert that distinctness: "you sent the wrong shape", "this conversation outgrew the
 * window" and "this file is too big" are three different problems with three different fixes, and
 * collapsing them would re-create the ceiling-unset/ceiling-invalid conflation F1 had to undo.
 */
export const BAD_REQUEST_SHAPE_MESSAGE_HE =
  'הבקשה שנשלחה לשרת אינה תקינה — רענן את הדף ונסה שוב.';

/** `reason` matches the discriminant convention the other refusals already use in `details`. */
export function badShape(field: string): HttpsError {
  return new HttpsError('invalid-argument', BAD_REQUEST_SHAPE_MESSAGE_HE, {
    reason: 'bad-request-shape',
    field,
  });
}

/**
 * The payload itself. Arrays are refused as well as null/primitives: `[]` is an object to
 * `typeof`, and every field read off it would then be `undefined` — a shape that would pass an
 * `typeof === 'object'` check and fail one field at a time afterwards.
 */
export function readPayload(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw badShape('data');
  return data as Record<string, unknown>;
}

export function readNestedObject(o: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = o[key];
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw badShape(key);
  return v as Record<string, unknown>;
}

/** A string, possibly empty — for fields where '' is a legitimate value (a base64 no-op, say). */
export function readString(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== 'string') throw badShape(key);
  return v;
}

/**
 * For identifiers. Whitespace-only is refused, not just '': a sessionId of '   ' is a Firestore
 * document path segment, and a modelId of '   ' is a registry lookup that can only ever miss.
 */
export function readNonEmptyString(o: Record<string, unknown>, key: string): string {
  const v = readString(o, key);
  if (v.trim() === '') throw badShape(key);
  return v;
}

/** Absent is fine; present-but-wrong-type is not. `null` is NOT absent — it is a wrong type. */
export function readOptionalString(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw badShape(key);
  return v;
}

export function readArray(o: Record<string, unknown>, key: string): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) throw badShape(key);
  return v;
}

/**
 * An array whose every element is a non-null, non-array object.
 *
 * Exists so a caller can validate the FIELDS of each element inside a `.map()` callback whose
 * parameter is the element itself. That shape is load-bearing for aiChat's history reader, not a
 * style preference: the D2/D8 regression guard in src/__tests__/aiPermissionsContract.test.ts
 * refuses any `.role` read in functions/src that is not on a verified token, and its one
 * structural carve-out is a `.role` read on the direct parameter of a `.map()` callback over a
 * receiver named messages/history — the conversation-turn shape, which has nothing to do with
 * PermissionRole. Returning pre-narrowed objects lets that reader keep the access ON the callback
 * parameter, so the guard can SEE it and allow it on its own terms, instead of the read being
 * laundered through a helper the guard cannot follow.
 */
export function readObjectArray(o: Record<string, unknown>, key: string): Record<string, unknown>[] {
  return readArray(o, key).map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw badShape(key);
    return item as Record<string, unknown>;
  });
}

/** `.map` rather than a loop-then-cast, so the string[] is PROVEN rather than asserted. */
export function readStringArray(o: Record<string, unknown>, key: string): string[] {
  return readArray(o, key).map((item) => {
    if (typeof item !== 'string') throw badShape(key);
    return item;
  });
}

export function readOptionalStringArray(o: Record<string, unknown>, key: string): string[] | undefined {
  if (o[key] === undefined) return undefined;
  return readStringArray(o, key);
}

/**
 * A token estimate. Finite and >= 0, both load-bearing rather than defensive padding:
 *   · NaN/Infinity multiply through quote()'s per-1k arithmetic into an estimatedILS nobody can
 *     state, which is the amount bd97326 refuses to mint an approval for;
 *   · a NEGATIVE count prices to a negative ₪ figure, and consumeApproval's `amount <= ceiling`
 *     check against a negative ceiling refuses every redemption — the same unredeemable-token
 *     outcome, arrived at without ever producing a NaN.
 * Zero is accepted: a genuinely free call is a real estimate, not a malformed one.
 */
export function readTokenCount(o: Record<string, unknown>, key: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw badShape(key);
  return v;
}
