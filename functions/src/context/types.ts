// D8 — the permission-scoped financial context builder's own types. Deliberately a separate
// file (project convention: every functions/src subdirectory — providers/, costGate/, handlers/
// — keeps its own types.ts) rather than inlined into buildFinancialContext.ts.

export interface FinancialFact {
  value: number;
  source: string;
  asOf: string | null;
}

/**
 * A chat-shaped 3-fact primitive — built for exactly what aiChat.ts's system prompt needs.
 * Stage 8's insight engine will need a materially richer context (per-category breakdowns, trend
 * data, goal progress) and will either extend this type or build its own alongside it (D8) —
 * noted here so Stage 8's planner doesn't rediscover the shape mismatch from scratch.
 */
export interface FinancialContext {
  scope: 'own' | 'family' | 'none';
  filterScope: AiFilterScope; // echoed back unchanged so aiChat.ts's system prompt can state the
                               // covered scope verbatim (D16)
  totalMonthlyExpense: FinancialFact | null; // recurring, EXPENSE-kind only — Stage 5 C2 lesson:
                                              // never blindly summed with income
  totalMonthlyIncome: FinancialFact | null;  // recurring, INCOME-kind, a SEPARATE figure
  netWorth: FinancialFact | null;            // null this stage — see buildFinancialContext.ts
}

/**
 * D16 — the resolved global מי/מתי (who/when) filter slice, threaded from the client's live
 * FilterContext state through AiChatRequest into buildFinancialContext.
 */
export interface AiFilterScope {
  memberIds: string[] | null; // resolved client-side (Task 6) via resolveMemberSelectionIds —
                               // null means "no filter" (mode 'all', or a selection resolving to
                               // zero ids), the SAME convention every owned-collection consumer
                               // already uses.
  period: { month: string; year: string }; // same shape Dashboard.tsx already reads off
                                            // filters.period — see D16 for why only this axis is
                                            // disclosed to the model, not applied to this stage's
                                            // recurring-based facts.
}
