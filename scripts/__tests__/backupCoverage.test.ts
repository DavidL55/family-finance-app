// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { NESTED_COLLECTION_GROUPS } from '../cloud/snapshot';

describe('backup covers every nested collection the rules know about', () => {
  it('each `match /a/{x}/b/{y}` in firestore.rules has b in NESTED_COLLECTION_GROUPS', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    const nested = [...rules.matchAll(/match \/[a-z_]+\/\{[^}]+\}\/([a-z_]+)\/\{/g)].map((m) => m[1]);
    expect(nested.length).toBeGreaterThan(0);
    for (const name of nested) expect(NESTED_COLLECTION_GROUPS).toContain(name);
  });
});
