import { createOwnedCollectionRepo } from './financeCollections';
import type { Account } from '../types/finance';

const repo = createOwnedCollectionRepo<Account>('accounts', 'account');
export const listAccounts = repo.list;
export const saveAccount = repo.save;
export const deleteAccount = repo.remove;
