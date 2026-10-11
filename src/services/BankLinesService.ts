import { createOwnedCollectionRepo } from './financeCollections';
import type { BankLine } from '../types/bank';

// Read-only on purpose: the sync pipeline is the single writer (spec §4.1, §9). Exposing
// save/remove here would invite a client write path the Rules deny anyway.
const repo = createOwnedCollectionRepo<BankLine>('bank_lines', 'bankLine');
export const listBankLines = repo.list;
