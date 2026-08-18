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
