import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { listConfiguredModels } from '../providers/registry';
import type { ListAiModelsRequest, ListAiModelsResponse } from './types';

// D5 — thin, no cost gate, pure metadata; no known-role guard needed since nothing is spent by
// asking "what's available". The single source of truth Task 4's adapters and the client
// ModelPicker both read.
export const listAiModels = onCall<ListAiModelsRequest, ListAiModelsResponse>((request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'נדרשת התחברות');
  return { models: listConfiguredModels(request.data?.action) };
});
