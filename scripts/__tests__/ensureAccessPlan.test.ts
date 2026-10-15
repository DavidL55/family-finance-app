// @vitest-environment node
// Lives in scripts/__tests__ (not src/__tests__): it imports from scripts/, which
// src/__tests__/clientAiPlumbing.test.ts keeps out of everything under src/.
import { describe, expect, it } from 'vitest';
import { planAccessWrites } from '../live/ensureAccessPlan';

const david = { uid: 'u1', email: 'david-levy@familyfinance.local', role: 'super-admin', memberId: 'david-levy' };
const lilit = { uid: 'u2', email: 'lilit-levy@familyfinance.local', role: 'parent', memberId: 'lilit-levy' };

describe('planAccessWrites — idempotent mirror of emulator claims into access/{uid}', () => {
  it('writes a missing access doc', () => {
    expect(planAccessWrites([david], new Map([['u1', null]]))).toEqual([
      { uid: 'u1', email: david.email, role: 'super-admin', memberId: 'david-levy', reason: 'missing' },
    ]);
  });
  it('second run = 0 writes', () => {
    expect(planAccessWrites([david, lilit], new Map([
      ['u1', { role: 'super-admin', memberId: 'david-levy' }],
      ['u2', { role: 'parent', memberId: 'lilit-levy' }],
    ]))).toEqual([]);
  });
  it('re-asserts a doc whose role drifted from the claims', () => {
    expect(planAccessWrites([lilit], new Map([['u2', { role: 'member', memberId: 'lilit-levy' }]]))[0].reason).toBe('changed');
  });
  it('skips users without valid claims — never invents a role', () => {
    expect(planAccessWrites([{ uid: 'u9', email: 'x@y', role: 'god', memberId: 'x' }, { uid: 'u8', email: 'z@y', role: undefined, memberId: undefined }], new Map())).toEqual([]);
  });
});
