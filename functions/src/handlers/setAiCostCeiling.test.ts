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
