// Stage 7 T3 — `firestore.indexes.json`, and the reason it is a test rather than a file.
//
// ── THE FAILURE MODE THIS EXISTS FOR ─────────────────────────────────────────────────────────
//
// NEITHER `firestore.indexes.json` NOR the `firestore.indexes` key IN `firebase.json` EXISTED
// BEFORE THIS TASK. That is not a gap with a warning attached — it is a gap with a REVERSED
// signal: the Firestore emulator serves every composite query without an index, so a query that
// needs one is green locally, green in `npm run test:rules`, green in CI, and raises
// `failed-precondition` the first time it runs against real Cloud Firestore. Nothing in our code
// raises, because there is nothing wrong with our code.
//
// T3 is the task that introduces the first composite query this project has ever had —
// `where('ownerId','==',me) + where('period','in',[…])`, the `'own'`-scope history read — so it is
// the task that has to notice.
//
// ── WHY THE INDEX IS DERIVED FROM THE QUERY BUILDER AND NOT TYPED OUT ────────────────────────
//
// A hand-written expectation here would be a second copy of the query shape, free to drift from
// the first. The fields are read off `buildHistoryClauses` — the one function that decides what
// the read path sends — so changing the query without changing the index turns THIS test red
// rather than a cloud deploy.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHistoryClauses, TRANSACTION_LINES_COLLECTION } from '../services/TransactionHistoryService';

interface IndexField {
  fieldPath: string;
  order?: string;
  arrayConfig?: string;
}

interface CompositeIndex {
  collectionGroup: string;
  queryScope: string;
  fields: IndexField[];
}

const repoRoot = join(__dirname, '../..');
const readJson = <T>(name: string): T => JSON.parse(readFileSync(join(repoRoot, name), 'utf8')) as T;

describe('firestore.indexes.json — the composite index the scoped history read needs', () => {
  it('exists and is wired into firebase.json, or it is never deployed', () => {
    // A file nobody references is a file that ships nothing. `firebase deploy --only firestore`
    // reads this key; without it the index definition is decoration.
    const firebaseJson = readJson<{ firestore?: { rules?: string; indexes?: string } }>('firebase.json');
    expect(firebaseJson.firestore?.indexes).toBe('firestore.indexes.json');
    expect(firebaseJson.firestore?.rules).toBe('firestore.rules');
    expect(() => readJson('firestore.indexes.json')).not.toThrow();
  });

  it("declares (ownerId ASC, period ASC) on transaction_lines — derived from the query, not retyped", () => {
    const clauses = buildHistoryClauses('own', 'omer-levy', ['2026-03']);
    // Firestore's composite-index field order is equality fields first, then the range/`in` field.
    const expectedFields = clauses.map((c) => c.field);

    const { indexes } = readJson<{ indexes: CompositeIndex[] }>('firestore.indexes.json');
    const match = indexes.find(
      (idx) =>
        idx.collectionGroup === TRANSACTION_LINES_COLLECTION &&
        idx.fields.map((f) => f.fieldPath).join(',') === expectedFields.join(',')
    );

    expect(
      match,
      `no index matching the built query shape [${expectedFields.join(', ')}]. ` +
        'The emulator will run this query anyway and Cloud Firestore will refuse it with ' +
        'failed-precondition on the first deploy.'
    ).toBeDefined();
    expect(match!.fields.every((f) => f.order === 'ASCENDING')).toBe(true);
    expect(match!.queryScope).toBe('COLLECTION');
  });

  it("the family-scope read needs NO composite index — one clause, single-field, automatic", () => {
    // Stated as a test so the index file cannot grow an entry nobody needs, and so the asymmetry
    // between the two scopes is recorded rather than inferred.
    const clauses = buildHistoryClauses('family', 'omer-levy', ['2026-03']);
    expect(clauses).toHaveLength(1);
    expect(clauses[0].field).toBe('period');
  });

  it('every declared index is a real object with fields — a malformed file deploys nothing', () => {
    const { indexes } = readJson<{ indexes: CompositeIndex[] }>('firestore.indexes.json');
    expect(indexes.length).toBeGreaterThan(0);
    for (const idx of indexes) {
      expect(typeof idx.collectionGroup).toBe('string');
      expect(idx.fields.length).toBeGreaterThanOrEqual(2);
    }
  });
});
