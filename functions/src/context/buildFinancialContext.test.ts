import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── firebase-admin/firestore mock ──────────────────────────────────────────────
// Admin SDK shape (snap.exists is a boolean property, not a method), same convention as
// costGate.test.ts. `members/{id}` is a single doc; `recurring` is a queryable collection with
// chainable .where(...).where(...).get() — the SAME two-filter shape buildFinancialContext.ts
// actually issues (status==active, then either ownerId==memberId or ownerId in [...]).
const { state } = vi.hoisted(() => ({
  state: {
    member: undefined as Record<string, unknown> | undefined,
    memberThrowsOnRoleAccess: false,
    recurring: [] as Record<string, unknown>[],
  },
}));

function matchWhere(item: Record<string, unknown>, field: string, op: string, value: unknown): boolean {
  const v = item[field];
  if (op === '==') return v === value;
  if (op === 'in') return Array.isArray(value) && (value as unknown[]).includes(v);
  return true;
}

vi.mock('firebase-admin/firestore', () => {
  function makeQuery(filters: Array<[string, string, unknown]>) {
    return {
      where: (field: string, op: string, value: unknown) => makeQuery([...filters, [field, op, value]]),
      get: async () => {
        const rows = state.recurring.filter((item) => filters.every(([f, op, v]) => matchWhere(item, f, op, v)));
        return { forEach: (cb: (doc: { data: () => Record<string, unknown> }) => void) => rows.forEach((r) => cb({ data: () => r })) };
      },
    };
  }

  return {
    getFirestore: () => ({
      doc: (path: string) => ({
        get: async () => {
          if (!path.startsWith('members/')) return { exists: false, data: () => undefined };
          if (!state.member) return { exists: false, data: () => undefined };
          if (state.memberThrowsOnRoleAccess) {
            const proxied = new Proxy(state.member, {
              get(target, prop, receiver) {
                if (prop === 'role') throw new Error('REGRESSION: buildFinancialContext read `.role` off the member document');
                return Reflect.get(target, prop, receiver);
              },
            });
            return { exists: true, data: () => proxied };
          }
          return { exists: true, data: () => state.member };
        },
      }),
      collection: (name: string) => {
        if (name !== 'recurring') return makeQuery([]);
        return makeQuery([]);
      },
    }),
  };
});

import { buildFinancialContext } from './buildFinancialContext';

function mockMemberDoc(data: Record<string, unknown>) {
  state.member = data;
  state.memberThrowsOnRoleAccess = false;
}
function mockMemberDocThrowsOnRoleAccess(data: Record<string, unknown>) {
  state.member = data;
  state.memberThrowsOnRoleAccess = true;
}
function mockRecurring(items: Record<string, unknown>[]) {
  state.recurring = items;
}

const NO_FILTER = { memberIds: null, period: { month: '08', year: '2026' } };

beforeEach(() => {
  state.member = undefined;
  state.memberThrowsOnRoleAccess = false;
  state.recurring = [];
});

describe("buildFinancialContext (D8 — role is a verified parameter, never read from Member.role)", () => {
  it("role:'member' with recurring:{view:'none'} gets scope 'none' and no financial facts", async () => {
    // NOTE: the mocked member doc carries NO `role` field at all — proving the function cannot
    // be reading it even by accident.
    mockMemberDoc({ resolvedPermissions: { recurring: { view: 'none', edit: 'none' } } });
    const ctx = await buildFinancialContext('omer-levy', 'member', NO_FILTER);
    expect(ctx.scope).toBe('none');
    expect(ctx.totalMonthlyExpense).toBeNull();
    expect(ctx.totalMonthlyIncome).toBeNull();
  });

  it("role:'super-admin' (the caller's VERIFIED token role) always resolves to 'family' scope, even if a stale/hostile member doc claims a family relationship of 'ילד'", async () => {
    mockMemberDoc({ resolvedPermissions: {}, role: 'ילד' /* deliberately WRONG on purpose — must never be consulted */ });
    const ctx = await buildFinancialContext('david-levy', 'super-admin', NO_FILTER);
    expect(ctx.scope).toBe('family');
  });

  it('totalMonthlyExpense and totalMonthlyIncome are NEVER summed into one figure (D8 — the Stage 5 C2 lesson)', async () => {
    mockMemberDoc({ resolvedPermissions: {} });
    mockRecurring([
      { kind: 'expense', amount: 1200, status: 'active', ownerId: 'david-levy' },
      { kind: 'income', amount: 18000, status: 'active', ownerId: 'david-levy' },
    ]);
    const ctx = await buildFinancialContext('david-levy', 'super-admin', NO_FILTER);
    expect(ctx.totalMonthlyExpense?.value).toBe(1200);
    expect(ctx.totalMonthlyIncome?.value).toBe(18000);
  });

  it('every fact carries a source and an asOf (or explicit null, never omitted) for the citation rule (D6/D8)', async () => {
    mockMemberDoc({ resolvedPermissions: {} });
    const ctx = await buildFinancialContext('david-levy', 'super-admin', NO_FILTER);
    expect(ctx.netWorth === null || 'source' in ctx.netWorth).toBe(true);
    expect(ctx.totalMonthlyExpense === null || ('source' in ctx.totalMonthlyExpense && 'asOf' in ctx.totalMonthlyExpense)).toBe(true);
  });

  it('REGRESSION: never reads `.role` off the fetched member document for any purpose (proves the fixed bug cannot silently return)', async () => {
    mockMemberDocThrowsOnRoleAccess({ resolvedPermissions: {} });
    await expect(buildFinancialContext('david-levy', 'super-admin', NO_FILTER)).resolves.toBeDefined();
  });

  it('inactive/paused recurring items are excluded from the totals', async () => {
    mockMemberDoc({ resolvedPermissions: {} });
    mockRecurring([
      { kind: 'expense', amount: 1200, status: 'active', ownerId: 'david-levy' },
      { kind: 'expense', amount: 9999, status: 'paused', ownerId: 'david-levy' },
      { kind: 'expense', amount: 9999, status: 'ended', ownerId: 'david-levy' },
    ]);
    const ctx = await buildFinancialContext('david-levy', 'super-admin', NO_FILTER);
    expect(ctx.totalMonthlyExpense?.value).toBe(1200);
  });
});

describe("buildFinancialContext — AiFilterScope (D16, third-lens M3: spec §5.3's global filter must reach the chat)", () => {
  it("member axis: a family-scope caller filtered to ['omer-levy'] gets ONLY omer's recurring totals, not the whole family's", async () => {
    mockMemberDoc({ resolvedPermissions: {} });
    mockRecurring([
      { kind: 'expense', amount: 1200, status: 'active', ownerId: 'david-levy' },
      { kind: 'expense', amount: 300, status: 'active', ownerId: 'omer-levy' },
    ]);
    const ctx = await buildFinancialContext('david-levy', 'super-admin', { memberIds: ['omer-levy'], period: { month: '08', year: '2026' } });
    expect(ctx.totalMonthlyExpense?.value).toBe(300);
  });

  it('memberIds: null (no filter) still returns the whole family total for a family-scope caller — unchanged default behavior', async () => {
    mockMemberDoc({ resolvedPermissions: {} });
    mockRecurring([
      { kind: 'expense', amount: 1200, status: 'active', ownerId: 'david-levy' },
      { kind: 'expense', amount: 300, status: 'active', ownerId: 'omer-levy' },
    ]);
    const ctx = await buildFinancialContext('david-levy', 'super-admin', NO_FILTER);
    expect(ctx.totalMonthlyExpense?.value).toBe(1500);
  });

  it("an 'own'-scope caller's query is unaffected by filterScope.memberIds — own scope is already narrower than any member filter could make it", async () => {
    mockMemberDoc({ resolvedPermissions: { recurring: { view: 'own', edit: 'own' } } });
    mockRecurring([
      { kind: 'expense', amount: 300, status: 'active', ownerId: 'omer-levy' },
      { kind: 'expense', amount: 999, status: 'active', ownerId: 'david-levy' },
    ]);
    const ctx = await buildFinancialContext('omer-levy', 'member', { memberIds: ['david-levy'], period: { month: '08', year: '2026' } });
    expect(ctx.totalMonthlyExpense?.value).toBe(300); // still omer's own, filterScope ignored for 'own' scope
  });

  it('echoes filterScope back on the returned context, unchanged, for aiChat.ts to disclose in its system prompt', async () => {
    mockMemberDoc({ resolvedPermissions: {} });
    const filterScope = { memberIds: ['david-levy'], period: { month: '03', year: '2026' } };
    const ctx = await buildFinancialContext('david-levy', 'super-admin', filterScope);
    expect(ctx.filterScope).toEqual(filterScope);
  });
});
