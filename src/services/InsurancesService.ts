import { createOwnedCollectionRepo } from './financeCollections';
import type { Insurance } from '../types/finance';

const repo = createOwnedCollectionRepo<Insurance>('insurances', 'insurance');
export const listInsurances = repo.list;
export const saveInsurance = repo.save;
export const deleteInsurance = repo.remove;
