import { describe, it, expect, vi } from 'vitest';

const mockList = vi.fn(async () => []);
vi.mock('../services/financeCollections', () => ({
  createOwnedCollectionRepo: vi.fn(() => ({ list: mockList, save: vi.fn(), remove: vi.fn() })),
}));

describe('BankLinesService', () => {
  it('is a read-only repo over the bank_lines collection', async () => {
    const { createOwnedCollectionRepo } = await import('../services/financeCollections');
    const svc = await import('../services/BankLinesService');
    expect(createOwnedCollectionRepo).toHaveBeenCalledWith('bank_lines', 'bankLine');
    await svc.listBankLines('own', 'david-levy');
    expect(mockList).toHaveBeenCalledWith('own', 'david-levy');
    // the pipeline is the only writer — the service must not export save/remove
    expect('saveBankLine' in svc).toBe(false);
    expect('deleteBankLine' in svc).toBe(false);
  });
});
