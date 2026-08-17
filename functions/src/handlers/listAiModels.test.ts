import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListConfiguredModels, FakeHttpsError } = vi.hoisted(() => {
  class FakeHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { mockListConfiguredModels: vi.fn(), FakeHttpsError };
});

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (fn: unknown) => fn,
  HttpsError: FakeHttpsError,
}));

vi.mock('../providers/registry', () => ({
  listConfiguredModels: mockListConfiguredModels,
}));

import { listAiModels } from './listAiModels';

type FakeRequest = { auth: { token: Record<string, unknown> } | null; data?: Record<string, unknown> };
const handler = listAiModels as unknown as (req: FakeRequest) => { models: unknown[] };

beforeEach(() => {
  vi.clearAllMocks();
  mockListConfiguredModels.mockReturnValue([{ providerId: 'mock', modelId: 'mock-standard' }]);
});

describe('listAiModels onCall handler', () => {
  it('rejects an unauthenticated request', () => {
    expect(() => handler({ auth: null })).toThrow(expect.objectContaining({ code: 'unauthenticated' }));
  });

  it('returns the registry filtered by the requested action', () => {
    const res = handler({ auth: { token: { role: 'member', memberId: 'x' } }, data: { action: 'chat' } });
    expect(mockListConfiguredModels).toHaveBeenCalledWith('chat');
    expect(res).toEqual({ models: [{ providerId: 'mock', modelId: 'mock-standard' }] });
  });

  it('returns the full catalog when no action is given', () => {
    handler({ auth: { token: { role: 'member', memberId: 'x' } }, data: {} });
    expect(mockListConfiguredModels).toHaveBeenCalledWith(undefined);
  });

  it('does not require a known role claim — pure metadata, nothing is spent (D5)', () => {
    expect(() => handler({ auth: { token: {} }, data: {} })).not.toThrow();
  });
});
