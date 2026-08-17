import { initializeApp } from 'firebase-admin/app';
initializeApp();
// Handler exports land here starting Task 3 (requestAiOverageApproval), Task 5 (aiChat,
// listAiModels), Task 7 (aiExtractDocument), Task 8 (getAiUsageSummary, setAiCostCeiling).

export { requestAiOverageApproval } from './handlers/requestAiOverageApproval';
export { aiChat } from './handlers/aiChat';
export { listAiModels } from './handlers/listAiModels';
export { aiExtractDocument } from './handlers/aiExtractDocument';
