import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same module-boundary-mock convention as aiChat.test.ts. A WriteBatch is mocked, not a
// runTransaction — this write needs no read-then-decide step (unlike costGate.spend()'s TOCTOU
// concern), just an atomic "both docs land together or neither does," which is exactly
// PermissionsService.saveModulePermissions's same-batch-audit precedent this handler mirrors.
const { mockBatchSet, mockBatchCommit, mockDocRef, mockAuditDocRef, FakeHttpsError } = vi.hoisted(() => {
  class FakeHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    mockBatchSet: vi.fn(),
    mockBatchCommit: vi.fn(async () => undefined),
    mockDocRef: vi.fn(),
    mockAuditDocRef: vi.fn(),
    FakeHttpsError,
  };
});

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (fn: unknown) => fn,
  HttpsError: FakeHttpsError,
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => {
      mockDocRef(path);
      return { __path: path };
    },
    collection: (name: string) => ({
      doc: () => {
        mockAuditDocRef(name);
        return { __path: `${name}/auto-id` };
      },
    }),
    batch: () => ({ set: mockBatchSet, commit: mockBatchCommit }),
  }),
  FieldValue: { serverTimestamp: () => '__serverTimestamp__' },
}));

import { setAiCostCeiling } from './setAiCostCeiling';
import { MAX_MONTHLY_CEILING_ILS, resolveCeiling } from '../costGate/types';

type FakeRequest = { auth: { token: Record<string, unknown> } | null; data: Record<string, unknown> };
const handler = setAiCostCeiling as unknown as (req: FakeRequest) => Promise<{ ok: true }>;

function makeRequest(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    auth: { token: { role: 'super-admin', memberId: 'david-levy' } },
    data: { monthlyCeilingILS: 50 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBatchCommit.mockResolvedValue(undefined);
});

describe('setAiCostCeiling onCall handler', () => {
  it('rejects an unauthenticated request', async () => {
    await expect(handler(makeRequest({ auth: null }))).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('rejects a non-super-admin caller (parent)', async () => {
    await expect(handler(makeRequest({ auth: { token: { role: 'parent', memberId: 'lilit-levy' } } })))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('rejects a negative ceiling', async () => {
    await expect(handler(makeRequest({ data: { monthlyCeilingILS: -1 } })))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric ceiling', async () => {
    await expect(handler(makeRequest({ data: { monthlyCeilingILS: 'lots' } })))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('accepts a ceiling of exactly 0 (D4 — a maximally-restrictive but valid configured state)', async () => {
    const res = await handler(makeRequest({ data: { monthlyCeilingILS: 0 } }));
    expect(res).toEqual({ ok: true });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Task 8 review F3 — the handler used `Number(...)`, which COERCES. `null`, `''`, `'   '`,
  // `[]` and `false` all became 0, and 0 was then read as "unconfigured" everywhere else, so
  // clearing the input silently disabled paid AI and told the person who did it that no ceiling
  // had ever been set. Now 0 means "block paid calls" and nothing coerces INTO it.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  describe('Task 8 review F3 — nothing coerces to a number', () => {
    const coercedToZero: [string, unknown][] = [
      ['null', null], ['empty string', ''], ['whitespace string', '   '],
      ['empty array', []], ['false', false],
    ];
    for (const [label, value] of coercedToZero) {
      it(`rejects ${label} instead of silently writing a ceiling of 0`, async () => {
        await expect(handler(makeRequest({ data: { monthlyCeilingILS: value } })))
          .rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockBatchCommit).not.toHaveBeenCalled();
      });
    }

    it('rejects the numeric STRING "50" — a stored string is exactly what made the cost gate fail open (F1)', async () => {
      await expect(handler(makeRequest({ data: { monthlyCeilingILS: '50' } })))
        .rejects.toMatchObject({ code: 'invalid-argument' });
      expect(mockBatchCommit).not.toHaveBeenCalled();
    });

    it('rejects a missing field, and a missing data payload entirely', async () => {
      await expect(handler(makeRequest({ data: {} }))).rejects.toMatchObject({ code: 'invalid-argument' });
      await expect(handler({ auth: { token: { role: 'super-admin', memberId: 'david-levy' } }, data: undefined as unknown as Record<string, unknown> }))
        .rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('rejects Infinity and NaN', async () => {
      await expect(handler(makeRequest({ data: { monthlyCeilingILS: Infinity } })))
        .rejects.toMatchObject({ code: 'invalid-argument' });
      await expect(handler(makeRequest({ data: { monthlyCeilingILS: NaN } })))
        .rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('rejects 1e308 — the reviewer\'s probe accepted it; a ceiling that large is no ceiling at all', async () => {
      await expect(handler(makeRequest({ data: { monthlyCeilingILS: 1e308 } })))
        .rejects.toMatchObject({ code: 'invalid-argument' });
      expect(mockBatchCommit).not.toHaveBeenCalled();
    });

    it('accepts exactly the maximum, and rejects one above it (the SAME bound Rules and costGate use)', async () => {
      await expect(handler(makeRequest({ data: { monthlyCeilingILS: MAX_MONTHLY_CEILING_ILS } }))).resolves.toEqual({ ok: true });
      await expect(handler(makeRequest({ data: { monthlyCeilingILS: MAX_MONTHLY_CEILING_ILS + 1 } })))
        .rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('the write that DOES land stores a real number, so costGate.resolveCeiling sees `configured`', async () => {
      await handler(makeRequest({ data: { monthlyCeilingILS: 0 } }));
      const ceilingCall = mockBatchSet.mock.calls.find(([ref]) => (ref as { __path: string }).__path === 'settings/aiCostConfig');
      const written = (ceilingCall?.[1] as { monthlyCeilingILS: unknown }).monthlyCeilingILS;
      expect(typeof written).toBe('number');
      expect(resolveCeiling(written)).toEqual({ status: 'configured', ceilingILS: 0 });
    });
  });

  it('writes settings/aiCostConfig.monthlyCeilingILS AND an audit_log entry in the SAME batch', async () => {
    await handler(makeRequest({ data: { monthlyCeilingILS: 75 } }));

    expect(mockDocRef).toHaveBeenCalledWith('settings/aiCostConfig');
    expect(mockAuditDocRef).toHaveBeenCalledWith('audit_log');

    const ceilingCall = mockBatchSet.mock.calls.find(([ref]) => (ref as { __path: string }).__path === 'settings/aiCostConfig');
    expect(ceilingCall?.[1]).toEqual(expect.objectContaining({ monthlyCeilingILS: 75, updatedBy: 'david-levy' }));

    const auditCall = mockBatchSet.mock.calls.find(([ref]) => (ref as { __path: string }).__path.startsWith('audit_log/'));
    expect(auditCall?.[1]).toEqual(expect.objectContaining({
      actorMemberId: 'david-levy', action: 'aiCostConfig.setCeiling', target: 'settings/aiCostConfig',
    }));

    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('sources actorMemberId from the VERIFIED token, never from request.data (no spoofing a different actor)', async () => {
    await handler(makeRequest({
      auth: { token: { role: 'super-admin', memberId: 'real-super-admin' } },
      data: { monthlyCeilingILS: 10, actorMemberId: 'spoofed-someone-else' },
    }));
    const ceilingCall = mockBatchSet.mock.calls.find(([ref]) => (ref as { __path: string }).__path === 'settings/aiCostConfig');
    expect(ceilingCall?.[1]).toEqual(expect.objectContaining({ updatedBy: 'real-super-admin' }));
    const auditCall = mockBatchSet.mock.calls.find(([ref]) => (ref as { __path: string }).__path.startsWith('audit_log/'));
    expect(auditCall?.[1]).toEqual(expect.objectContaining({ actorMemberId: 'real-super-admin' }));
  });
});
