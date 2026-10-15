// @vitest-environment node
// Lives in scripts/__tests__ (not src/__tests__): it imports from scripts/, which
// src/__tests__/clientAiPlumbing.test.ts keeps out of everything under src/.
import { describe, expect, it } from 'vitest';
import { blockingSkipped, planAccessWrites } from '../live/ensureAccessPlan';

const david = { uid: 'u1', email: 'david-levy@familyfinance.local', role: 'super-admin', memberId: 'david-levy' };
const lilit = { uid: 'u2', email: 'lilit-levy@familyfinance.local', role: 'parent', memberId: 'lilit-levy' };

describe('planAccessWrites — idempotent mirror of emulator claims into access/{uid}', () => {
  it('writes a missing access doc', () => {
    expect(planAccessWrites([david], new Map([['u1', null]])).writes).toEqual([
      { uid: 'u1', email: david.email, role: 'super-admin', memberId: 'david-levy', reason: 'missing' },
    ]);
  });
  it('second run = 0 writes', () => {
    expect(planAccessWrites([david, lilit], new Map([
      ['u1', { role: 'super-admin', memberId: 'david-levy' }],
      ['u2', { role: 'parent', memberId: 'lilit-levy' }],
    ])).writes).toEqual([]);
  });
  it('re-asserts a doc whose role drifted from the claims', () => {
    expect(planAccessWrites([lilit], new Map([['u2', { role: 'member', memberId: 'lilit-levy' }]])).writes[0].reason).toBe('changed');
  });
  it('skips users without valid claims — never invents a role — and REPORTS them', () => {
    const plan = planAccessWrites([{ uid: 'u9', email: 'x@y', role: 'god', memberId: 'x' }, { uid: 'u8', email: 'z@y', role: undefined, memberId: undefined }], new Map());
    expect(plan.writes).toEqual([]);
    expect(plan.skipped.map((u) => u.uid)).toEqual(['u9', 'u8']);
    expect(plan.skipped.every((u) => u.reason.length > 0 && !u.hasAccess)).toBe(true);
  });
  it('reports a user whose customAttributes JSON was unreadable, with that reason', () => {
    const plan = planAccessWrites([{ uid: 'u7', email: 'bad@y', role: undefined, memberId: undefined, claimsError: 'Unexpected token' }], new Map([['u7', null]]));
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].reason).toContain('unreadable');
    expect(blockingSkipped(plan)).toHaveLength(1);
  });
  it('an invalid-claims user who already has an access doc is skipped but NOT blocking', () => {
    const plan = planAccessWrites([{ uid: 'u5', email: 'old@y', role: undefined, memberId: undefined }], new Map([['u5', { role: 'parent', memberId: 'old' }]]));
    expect(plan.skipped).toEqual([{ uid: 'u5', email: 'old@y', reason: expect.any(String), hasAccess: true }]);
    expect(blockingSkipped(plan)).toEqual([]);
  });
  it('blocking = only the skipped users without an access doc', () => {
    const plan = planAccessWrites(
      [{ uid: 'a', email: 'a@y', role: undefined, memberId: undefined }, { uid: 'b', email: 'b@y', role: undefined, memberId: undefined }, david],
      new Map([['a', { role: 'member', memberId: 'a' }]]),
    );
    expect(blockingSkipped(plan).map((u) => u.uid)).toEqual(['b']);
    expect(plan.writes).toHaveLength(1);
  });
});
