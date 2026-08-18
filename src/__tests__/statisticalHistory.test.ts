// Stage 7 T5 — the door, and the two mechanisms that live in code rather than in a test.
//
// The third (the AST guard) is `statisticalHistoryDoor.test.ts`. This file holds the compile-time
// brand's runtime half and the seal's refusal.
import { describe, expect, it } from 'vitest';
import {
  isGatedStatisticalHistory,
  refuseStatisticalHistory,
  sealStatisticalHistory,
} from '../utils/statisticalHistory';
import {
  BACKFILL_INCOMPLETE_REASON_HE,
  statisticalLayerGate,
  type TransactionPeriodBackfillMarker,
} from '../utils/backfillMarker';

const MARKER: TransactionPeriodBackfillMarker = {
  completedAt: '2026-08-18T09:00:00.000Z',
  sourceCommit: '1473b76',
  rowsStamped: 2182,
  rowsUnknown: 2,
  lastRunAt: '2026-08-18T09:00:00.000Z',
  lastRunCommit: '1473b76',
  transactionRows: 2184,
};

describe('!! sealStatisticalHistory — the ONLY way to mint gated history', () => {
  it('mints a ready handle from a complete marker, carrying the run that stamped the corpus', () => {
    const gated = sealStatisticalHistory(MARKER, [{ id: 'a', amount: 100 }]);
    expect(gated.status).toBe('ready');
    expect(gated.rows).toHaveLength(1);
    // Provenance travels WITH the history, so the screen can say which backfill the average rests
    // on without a second read of `settings/migrationState`.
    expect(gated.markerCompletedAt).toBe(MARKER.completedAt);
    expect(gated.markerSourceCommit).toBe(MARKER.sourceCommit);
  });

  it('THROWS on a null marker rather than returning a refusal the caller may ignore', () => {
    // periodMath's F-2 argument, verbatim: on this codebase a refusal a caller is free to ignore
    // is not a refusal. The root tsconfig is not strict, so a returned union would collapse for
    // every caller in `src/` and the wrong branch would compile clean.
    expect(() => sealStatisticalHistory(null, [{ id: 'a', amount: 100 }])).toThrow(
      /complete backfill marker/
    );
  });

  it('THROWS on an undefined marker too — the absent-document case', () => {
    expect(() => sealStatisticalHistory(undefined, [])).toThrow(/complete backfill marker/);
  });

  it('the throw names WHY, not just WHAT — the half-stamped average is the whole reason', () => {
    expect(() => sealStatisticalHistory(null, [])).toThrow(/half-stamped/);
  });

  it('an EMPTY row list with a good marker is sealed, not refused — D26 row 0 depends on it', () => {
    // "No rows" and "we may not read the rows" are opposite states. Conflating them would make the
    // empty corpus render the backfill refusal, which is a data problem nobody has.
    const gated = sealStatisticalHistory(MARKER, []);
    expect(gated.status).toBe('ready');
    expect(gated.rows).toEqual([]);
  });
});

describe('!! the seal`s gate check — a KNOWN EQUIVALENT MUTANT, pinned so it stops being one', () => {
  it('the gate refuses EXACTLY when the marker is absent — which is why `if (!marker)` survives', () => {
    // The sweep found `gate.status !== 'allowed' || !marker` → `!marker` SURVIVING, and it is
    // genuinely equivalent: no input distinguishes them today. The gate call is kept because the
    // GATE is the authority on whether the layer may run. This test is what makes the equivalence
    // a property rather than an accident — the day `statisticalLayerGate` grows a second refusal
    // reason, it fails here instead of silently making the bare null check wrong.
    expect(statisticalLayerGate(null).status).toBe('refused-backfill-incomplete');
    expect(statisticalLayerGate(undefined).status).toBe('refused-backfill-incomplete');
    expect(statisticalLayerGate(MARKER).status).toBe('allowed');
    // and there is no third outcome to be equivalent about
    expect(new Set([statisticalLayerGate(null).status, statisticalLayerGate(MARKER).status]).size).toBe(2);
  });
});

describe('!! isGatedStatisticalHistory — the half that survives an `as` cast', () => {
  it('accepts a handle that came through the seal', () => {
    expect(isGatedStatisticalHistory(sealStatisticalHistory(MARKER, []))).toBe(true);
  });

  it('REJECTS a hand-built object with every visible field right', () => {
    // This is the forgery the compiler cannot stop: the brand is a private symbol, so an `as
    // GatedStatisticalHistory` assertion is legal — the two shapes overlap. The runtime check is
    // what makes the cast fail one frame later instead of averaging an unstamped corpus.
    const forged = {
      status: 'ready',
      rows: [{ id: 'a', amount: 100 }],
      markerCompletedAt: MARKER.completedAt,
      markerSourceCommit: MARKER.sourceCommit,
    };
    expect(isGatedStatisticalHistory(forged)).toBe(false);
  });

  it('rejects a forgery carrying a same-DESCRIPTION symbol — `Symbol()` is not interned', () => {
    // `Symbol('statisticalHistory.gated')` written in another module is a DIFFERENT symbol.
    // `Symbol.for` would have been interned across the whole realm and this test would fail —
    // which is why the brand is `Symbol`, not `Symbol.for`.
    const impostor = Symbol('statisticalHistory.gated');
    expect(isGatedStatisticalHistory({ [impostor]: 'loadStatisticalHistory', status: 'ready' })).toBe(false);
  });

  it('rejects the refusal handle, `null`, a string and an array', () => {
    expect(isGatedStatisticalHistory(refuseStatisticalHistory('x'))).toBe(false);
    expect(isGatedStatisticalHistory(null)).toBe(false);
    expect(isGatedStatisticalHistory(undefined)).toBe(false);
    expect(isGatedStatisticalHistory('ready')).toBe(false);
    expect(isGatedStatisticalHistory([])).toBe(false);
  });
});

describe('refuseStatisticalHistory', () => {
  it('carries the Hebrew the screen renders in place of the average', () => {
    const refused = refuseStatisticalHistory(BACKFILL_INCOMPLETE_REASON_HE);
    expect(refused.status).toBe('refused-backfill-incomplete');
    expect(refused.reasonHe).toBe(BACKFILL_INCOMPLETE_REASON_HE);
  });

  it('is deliberately NOT branded — forging a refusal fails CLOSED', () => {
    // Only the permissive value is guarded. A type that is hard to construct in the safe direction
    // is a type people route around.
    expect(isGatedStatisticalHistory(refuseStatisticalHistory('x'))).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// T5 REVIEW F1 — THE DOOR WAS OPEN, AND THE ROOT CAUSE IS ONE SENTENCE ABOUT JAVASCRIPT
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// A PRIVATE SYMBOL STOPS YOU **WRITING** THE KEY. IT DOES NOT STOP YOU **COPYING** IT.
//
// Object spread and `Object.assign` copy own ENUMERABLE SYMBOL properties, and `Object.create`
// reaches the key through the prototype chain. So every forgery below carried a real brand — the
// same symbol, the same value — and the old check, which read that value, said yes to all three.
// The review measured the consequence on the layer itself: three sealed ₪100 rows replaced by one
// ungated ₪9999 row came back `status: 'ready'`, `rowsRead: 1`, `estimateILS: 9999`. That is
// exactly "a moving average over a fraction of the corpus rendering identically to one over all of
// it", which is the sentence `statisticalHistory.ts` exists to make untrue.
//
// !! WHY IDENTITY IS THE RIGHT ANSWER AND A BETTER FIELD IS NOT. "This handle came through the
// seal" is a fact about PROVENANCE. Any encoding of it as DATA ON THE OBJECT — a field, a symbol
// key, a random nonce — is copyable, because copying data is precisely what those operations are
// for; a stronger secret only makes the copy harder to author by hand, never impossible. The one
// thing no copy operation can reproduce is OBJECT IDENTITY: `{ ...x } !== x` is a guarantee of the
// language, not a property of how the object was built. Recording provenance in a side table keyed
// by identity is therefore uncopyable BY CONSTRUCTION, and a forger has to obtain the real handle
// — at which point they already went through the door.
//
// Each test below asserts BOTH halves: that the OLD check would have accepted the forgery, and
// that the current one refuses it. Without the first half these would be passing on copies that
// never carried a brand at all, which would prove nothing about identity.

/** Walks own-then-prototype for a symbol key, without an `as` cast. */
function descriptorFor(value: object, key: symbol): PropertyDescriptor | undefined {
  let cursor: object | null = value;
  while (cursor !== null) {
    const own = Object.getOwnPropertyDescriptor(cursor, key);
    if (own) return own;
    cursor = Object.getPrototypeOf(cursor);
  }
  return undefined;
}

/**
 * `isGatedStatisticalHistory` EXACTLY AS IT WAS BEFORE THIS FIX — a symbol-VALUE read.
 *
 * Kept as an executable replica rather than described in prose, so the four bypasses below carry
 * their own proof that they really were bypasses and cannot quietly become vacuous.
 */
function theOldSymbolValueCheck(value: unknown, brand: symbol): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return descriptorFor(value, brand)?.value === 'loadStatisticalHistory';
}

describe('!! F1 — the four copy bypasses, all of which carried a REAL brand', () => {
  const gatedOf = () => sealStatisticalHistory(MARKER, [{ id: 'a', amount: 100 }]);
  const brandOf = (handle: object): symbol => {
    const [brand] = Object.getOwnPropertySymbols(handle);
    if (brand === undefined) throw new Error('the sealed handle must carry the brand symbol');
    return brand;
  };
  const FORGED_ROWS = [{ id: 'forged', amount: 9999 }];

  it('the premise: a sealed handle carries exactly ONE own symbol, and it holds the door`s name', () => {
    const gated = gatedOf();
    expect(Object.getOwnPropertySymbols(gated)).toHaveLength(1);
    expect(theOldSymbolValueCheck(gated, brandOf(gated))).toBe(true);
    expect(isGatedStatisticalHistory(gated)).toBe(true);
  });

  it('!! OBJECT SPREAD — the copy carries the brand key over, and is REFUSED anyway', () => {
    const gated = gatedOf();
    const brand = brandOf(gated);
    const spread = { ...gated, rows: FORGED_ROWS };
    // the copy really is branded — same symbol, same value
    expect(Object.getOwnPropertySymbols(spread)).toContain(brand);
    expect(theOldSymbolValueCheck(spread, brand)).toBe(true);
    // and it is a DIFFERENT object, which is the only thing that cannot be copied
    expect(spread).not.toBe(gated);
    expect(isGatedStatisticalHistory(spread)).toBe(false);
  });

  it('!! Object.assign — same story, same refusal', () => {
    const gated = gatedOf();
    const brand = brandOf(gated);
    const assigned = Object.assign({}, gated, { rows: FORGED_ROWS });
    expect(theOldSymbolValueCheck(assigned, brand)).toBe(true);
    expect(isGatedStatisticalHistory(assigned)).toBe(false);
  });

  it('!! Object.create — the brand arrives through the PROTOTYPE CHAIN, and is refused', () => {
    // `WeakSet.has` does not walk the prototype chain, and that is the property being relied on:
    // an heir is a different object however much of its parent it can read.
    const gated = gatedOf();
    const brand = brandOf(gated);
    const heir: object = Object.create(gated);
    expect(Object.getOwnPropertySymbols(heir)).toHaveLength(0); // nothing of its own …
    expect(theOldSymbolValueCheck(heir, brand)).toBe(true); // … but the old check still read it
    expect(isGatedStatisticalHistory(heir)).toBe(false);
    expect(isGatedStatisticalHistory(Object.getPrototypeOf(heir))).toBe(true); // the parent is real
  });

  it('structuredClone and JSON round-trips were ALREADY refused, and stay refused', () => {
    const gated = gatedOf();
    expect(isGatedStatisticalHistory(structuredClone(gated))).toBe(false);
    expect(isGatedStatisticalHistory(JSON.parse(JSON.stringify(gated)))).toBe(false);
  });
});

describe('!! F1 — the sealed corpus itself cannot be swapped out under the brand', () => {
  it('!! `handle.rows = otherRows` DOES NOT MOVE THE CORPUS — the headline bypass, closed', () => {
    // `readonly` is erased at runtime, so the type alone leaves F1's headline bypass live in any
    // path that skipped `tsc` — and the handle KEEPS ITS IDENTITY through that assignment, so the
    // WeakSet cannot see it either. The freeze is what closes this one, in the only layer left.
    //
    // !! TWO PROPERTIES, AND ONLY ONE OF THEM IS UNIVERSAL — measured, not assumed. Whether the
    // write THROWS depends on the mode the assigning code runs in: ES modules are strict, so it is
    // a `TypeError` here and in the app; in a sloppy-mode context the same write is SILENTLY
    // DISCARDED. What holds in both, and is the property that actually matters, is that the corpus
    // does not move. Both are asserted, in that order of importance.
    const gated = sealStatisticalHistory(MARKER, [{ id: 'a', amount: 100 }]);
    const widened = gated as unknown as { rows: Array<{ id: string; amount: number }> };
    let threw = false;
    try {
      widened.rows = [{ id: 'forged', amount: 9999 }];
    } catch {
      threw = true;
    }
    // the universal half
    expect(gated.rows).toHaveLength(1);
    expect(gated.rows[0].id).toBe('a');
    // and the strict-mode half, which is the mode this codebase actually ships in
    expect(threw).toBe(true);
    expect(() => {
      widened.rows = [{ id: 'forged', amount: 9999 }];
    }).toThrow(TypeError);
  });

  it('the row list itself is frozen — `push` on it throws rather than growing the corpus', () => {
    const gated = sealStatisticalHistory(MARKER, [{ id: 'a', amount: 100 }]);
    const widened = gated.rows as unknown as Array<{ id: string; amount: number }>;
    expect(() => widened.push({ id: 'forged', amount: 9999 })).toThrow(TypeError);
    expect(gated.rows).toHaveLength(1);
  });

  it('!! the seal COPIES the rows, so the caller`s array is no longer a handle onto the corpus', () => {
    // Without the copy the guarantee is only as good as the call site's discipline: whoever handed
    // the rows in still holds a live reference to the array the average will read.
    const source = [{ id: 'a', amount: 100 }];
    const gated = sealStatisticalHistory(MARKER, source);
    source.push({ id: 'forged', amount: 9999 });
    expect(source).toHaveLength(2);
    expect(gated.rows).toHaveLength(1);
  });
});
