import { createOwnedCollectionRepo } from './financeCollections';
import type { Loan } from '../types/finance';

const repo = createOwnedCollectionRepo<Loan>('loans', 'loan');
export const listLoans = repo.list;
export const saveLoan = repo.save;
export const deleteLoan = repo.remove;
