# FamilyFinance v2 — Stage 5: Financial Module Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give David real, usable screens for the data model Stage 3 built and nobody can see yet — list/create/edit/delete for accounts, loans, insurances, and recurring items, each honoring the permission matrix's `'own'` vs `'family'` split — plus a dedicated Net Worth screen that finally wires `computeNetWorth()` (built and tested since Stage 3, zero call sites since) into something real, and the spec §5.1 drill-down that turns Dashboard's headline numbers into buttons instead of dead ends.

**Architecture:** Stage 3 shipped four Firestore collections (`accounts`, `loans`, `insurances`, `recurring`), their Rules, and thin CRUD services (`AccountsService`/`LoansService`/`InsurancesService`/`RecurringService`, all built on the shared `createOwnedCollectionRepo` factory) — but zero UI. Stage 4 shipped the shell those screens will live inside (`FilterContext`, `MODULE_REGISTRY`, the glossary/`<Explain>` layer, `MemberMultiSelect`/`ComparisonTable`) and rewired exactly one screen (`Dashboard`) onto it. This stage:

1. **Closes a load-bearing gap discovered during this plan's own research, before any screen can safely ship:** `createOwnedCollectionRepo.list()` issues a bare, unconstrained `getDocs(collection(db, name))` with no `where()` clause. Under `firestore.rules`' `ownedModuleAllowed()` (`level=='family' || (level=='own' && data.ownerId==memberId())`), Firestore denies an *unconstrained* list query wholesale for any `'own'`-level viewer — it cannot statically prove every possible document in the collection satisfies a `resource.data`-dependent condition. This is the exact same failure class the Stage 4 security investigation already found and fixed for `transaction_lines`/`incomes` (`!!! SECURITY: UX finding I6 CONFIRMED LIVE`), now latent in all four Stage 3 collections and in the already-shipped recurring catch-up engine (`postDueRecurringTransactions`, which assumed "Rules do the owner-scoping" for a bare `listRecurring()` call — see that file's own header comment). It has never been exercised outside mocked unit tests until this stage's screens call it from a live browser. Task 1 fixes it before Task 2 builds the first screen on top of it.
2. Builds **four CRUD screens** — `AccountsScreen`, `LoansScreen`, `InsurancesScreen`, `RecurringScreen` — sharing one pattern (list with loading/empty/error/permission-denied states, a create/edit form, delete-with-confirm, `ownerId` defaulted to the acting session with a family-level-only override, a local total wired to its own glossary entry, `data-tour-id`s, mounted on the global `FilterBar`).
3. **Resolves the flagged `computeNetWorth()` dead code** (Stage 4 Task 5 review: *"Stage 5 must either wire it as the real net-worth source or explicitly decide the ecosystem sum stays authoritative. Do not let it rot unwired."*) — wires it as the sole net-worth calculation app-wide, retires Dashboard's parallel `settings/ecosystem`-arithmetic net-worth card and its five-tile asset panel, and ships a dedicated **Net Worth screen** on the same shared hook (D3).
4. Builds the **spec §5.1 drill-down** — Dashboard's KPI, net-worth, and settlement cards become `navigateTo(...)` buttons that open the screen behind the number, a requirement the Stage 4 four-lens review found homeless and assigned here by name in the roadmap.
5. Flips `usesGlobalFilters` to `true` for all five new registry entries in the same commit each screen is built (D7 from Stage 4 — never a screen with both a local selector and the global one).

**Tech Stack additions:** none. No new npm packages.

**Spec:** `docs/superpowers/specs/2026-08-14-family-finance-v2-design.md` §5 (UX — 5.1 drill-down, 5.3 global filters), §6 (module map — חשבונות ויתרות, הלוואות וחובות, ביטוחים, שווי נקי; recurring falls under קליטה/הוצאות automation), §7 (data model — `accounts`/`loans`/`insurances`/`recurring`).

**Builds on:** `src/services/financeCollections.ts`, `AccountsService.ts`, `LoansService.ts`, `InsurancesService.ts`, `RecurringService.ts`, `src/types/finance.ts`, `src/utils/netWorth.ts`, `src/contexts/FilterContext.tsx`, `src/contexts/NavigationContext.tsx`, `src/config/moduleRegistry.ts`, `src/config/glossary.ts`, `src/components/Explain.tsx`, `MemberMultiSelect.tsx`, `ComparisonTable.tsx`, `FilterBar.tsx`, `Dashboard.tsx`, `src/App.tsx`, `src/utils/memberVisibility.ts`, `src/hooks/useRecurringCatchup.ts`, `src/hooks/useFamilyMembers.ts`/`useGroups.ts`, `src/utils/resolveMemberSelection.ts`. Does **not** touch `ExpensesBreakdown.tsx`, `AnnualReport.tsx`, `CentralExpenseReport.tsx`, `InvestmentsPortfolio.tsx`, `FuturePlanning.tsx`, `FolderLogic.tsx`, `FamilyManagerModal.tsx`, `SyncButton.tsx`, `InvestmentsImportModal.tsx`, `AssetCard.tsx`, or `firestore.rules` (Task 1's fix is a client-side query-shape correction against an already-correct rule — see Task 1's own note on why no Rules change is needed) — see "Carry-forwards" below for why each stays untouched.

## Design decisions (resolved, not deferred)

- **D1 — `createOwnedCollectionRepo.list()` becomes scope-aware: `list(scope: 'own' | 'family', viewerMemberId: string)`.** `'family'` keeps today's bare collection scan (also covers the super-admin/parent Rules bypass, which never depends on `resource.data`). `'own'` adds `where('ownerId', '==', viewerMemberId)` — a query Firestore CAN statically verify against the rule's `data.ownerId == memberId()` branch, because every possible result document is now provably constrained to satisfy it. This is not a new capability being added to the Rules (`firestore.rules` is unchanged — the rule already technically permits `'own'`-level per-document access; the bug was purely that the CLIENT never issued a query shape Firestore could verify). `AccountsService`/`LoansService`/`InsurancesService`/`RecurringService`'s `list*` re-exports take the same two params — a breaking, deliberate signature change caught by every existing call site failing to compile, not a silent behavior change. `postDueRecurringTransactions` (Stage 3, already shipped) is fixed in the same task since its own `listRecurring()` call has the identical bug — a `'member'`-role session with only `'own'` access to `recurring` would have their own catch-up posting silently fail-list every single run, never posting anything, with the failure surfacing only as an opaque `(all)` entry in `PostingOutcome.failed`.
- **D2 — FilterBar's dead-end avoidance generalizes from one hardcoded module to a per-active-screen module.** Stage 4 built `ViewerAccess.expensesView`/`filterViewableMembers()` around the fact that `'dashboard'` was the only screen using the global מי control, and its data was `'expenses'`-gated. Stage 5 adds four more owned modules with independently grantable levels — offering a chip for a member the viewer has no grant to see on the *currently active* screen is exactly the dead-end UX bug Stage 4 fixed once already, now reachable through five new screens if left as-is. `ModuleRegistryEntry` gains `filterModuleId: ModuleId | null` (which module's `view` level should drive dead-end filtering while this entry is active). `ViewerAccess.expensesView: PermissionLevel` becomes `ViewerAccess.levelsByModule: Partial<Record<ModuleId, PermissionLevel>>`, computed once in `App.tsx` for every matrix-governed module `FilterBar` might ever need (unchanged super-admin/parent bypass to `'family'`). `filterViewableMembers` takes the active entry's `filterModuleId` as a new required parameter. The one entry this can't cleanly serve is `'net-worth'` (spans `accounts`+`investments`+`loans`, each independently gradable) — rather than inventing a composite rule, `filterModuleId: null` there means "offer everyone," matching pre-Stage-4 behavior; a selection that turns out inaccessible on a given line surfaces that line's own permission-denied state (same disclosed-not-fixed shape as Stage 4's D8 ecosystem-fallback note).
- **D3 — `computeNetWorth()` is wired as the sole, authoritative net-worth calculation app-wide.** Both the new Net Worth screen and Dashboard's net-worth card call one shared loader (`useNetWorth`, Task 6) — never two independent call sites computing the same number, per spec §5.5's "one calculation source per metric." Its real inputs: `accounts` via the new scope-aware `listAccounts` (D1, `status: 'active'` filtered by the caller — `netWorth.ts`'s own header comment leaves this to "the screen decides," and an archived account should not count toward net worth, the entire point of archiving one), `investments` via the pre-existing, unmodified `investments` collection (real data, already rendered on `InvestmentsPortfolio` — not the hand-typed `settings/ecosystem.investments` shadow), `loans` via scope-aware `listLoans`, and `realEstateValue`/`realEstateAsOf` still read from legacy `settings/ecosystem` (per `netWorth.ts`'s own D5 comment — real estate has no dedicated collection yet; building one is out of this stage's scope). Dashboard's local `totalAssets`/`totalLiabilities`/`netWorth` arithmetic and its five-tile "התגלגלות נכסים" panel (`liquid`/`investments`/`pensions`/`crypto`/`realEstate`, all fed by `settings/ecosystem`) are **retired**, replaced by rendering `computeNetWorth()`'s own `assets`/`liabilities` line items directly. **Consequence, disclosed, not silently absorbed:** with `accounts`/`loans` freshly empty — this is the first stage either collection gets a UI at all — net worth will show a *lower*, honest number than the old ecosystem sum until David re-enters his real liquid cash and mortgage as `Account`/`Loan` records through the very screens this stage builds. The Net Worth screen's empty-state (Task 6) says so directly and links to Accounts/Loans creation — the same one-time data-entry cost every other collection in this stage already requires, turned into an onboarding nudge instead of a silent regression. No automatic/silent migration script is built (scope discipline). `settings/ecosystem`'s `liquid`/`investments`/`pensions`/`crypto`/`mortgage` fields become orphaned, unread data — not deleted (no delete tooling exists in this project for a settings doc; disclosed as a Risk) — its `realEstate` field is the only one still read, and **only when reachable**: it is still gated `super-admin`/`parent`-only by commit `60d1c32`, so a `'member'`-role viewer's net worth simply omits real estate (treated as `0`, not a hard failure of the whole calculation — see Task 6's `useNetWorth`). One genuine, positive side effect worth naming: this closes most of Stage 4's D8 Risk ("`resolveEcosystemKey`'s 2+-member fallback to `'all'` is a real, disclosed limitation") for net worth specifically — `accounts`/`loans` support real per-`ownerId` filtering, so a drilled-into single member's net worth is now an actual computed slice, not a crude family-wide fallback.
- **D4 — glossary rewritten to match D3.** `dashboard.netWorth` is rewritten to describe `computeNetWorth()`'s real behavior (own/family-scoped; assets = accounts + investments + real estate, liabilities = loans). The five `dashboard.ecosystem.*` entries are **deleted** — their triggers no longer exist — replaced by four entries keyed to `NetWorthLineItem.source` (`netWorth.assets.accounts`, `netWorth.assets.investments`, `netWorth.assets.realEstate`, `netWorth.liabilities.loans`), looked up dynamically as `<Explain id={netWorthGlossaryId(item)} />`. The old real-estate entry's mortgage-double-counting caveat (`dashboard.ecosystem.realEstate`, tested by `glossary.test.ts`'s `/פעמיים|כפול/` assertion) is **not carried forward as a caveat** — D3 closes that specific risk, it doesn't just disclose it: `settings/ecosystem.mortgage` no longer feeds net worth at all, so a mortgage counted as a real `Loan` can no longer double up against it. The test moves to asserting `netWorth.assets.realEstate`'s copy says real estate has no dedicated freshness date the way accounts/loans do (a real, still-true limitation) instead.
- **D5 — the five new screens mount the shared `FilterBar` (`usesGlobalFilters: true`) rather than inventing local owner selectors.** `useGlobalFilters()` already exposes the shared members/groups fetch (Stage 4 M2) independent of whether `FilterBar` itself renders, and mounting it means a מי selection made anywhere — including via drill-down (D8) — carries over automatically with zero extra plumbing, serving spec §5.3's "משפיע על הכל" literally instead of reinventing a scoped-down control. Each screen documents which `FilterContext` dimensions it actually reads: accounts/loans/insurances/net-worth read `filters.member` only (a balance has no month or expense category); `recurring` additionally reads `filters.category` (`RecurringItem.category` is real and drawn from the same `settings/categories` taxonomy `FilterBar`'s מה control already offers). מתי (period) is read by none of the five — an intentional, disclosed non-use of one dimension, not a placeholder control: `FilterBar`'s מתי section already has a real consumer elsewhere (Dashboard), so this is "this screen doesn't need every dimension," the same partial-consumption pattern Dashboard's own ecosystem tiles exhibited pre-Stage-4-M1, not the M1 violation itself (nothing rendered with *zero* consumers anywhere).
- **D6 — a new `resolveMemberSelectionIds` resolver, separate from `resolveMemberSelectionNames`.** These four collections key ownership by `ownerId` (`Member.id`) directly — Stage 3 D1's whole point was moving away from `transaction_lines.owner`'s display-name convention. Reusing `resolveMemberSelectionNames` (which resolves to display names, and needs the full `members` array to map ids→names) would be solving a problem these collections don't have. `resolveMemberSelectionIds(selection: MemberSelection, groups: Group[]): Set<string> | null` is simpler: mode `'members'` already carries ids directly (no name lookup at all), mode `'group'` resolves via `Group.memberIds` (already ids), mode `'all'` returns `null`. Doesn't even need the `members` array as a parameter.
- **D7 (binding, Stage 3 ledger) — every create form defaults `ownerId` to the acting session's `memberId`, not editable by default; an override control appears only when the viewer's own resolved `edit` level for that specific module is `'family'`.** Matches `ownedModuleAllowed()`'s own rule precisely — only a `'family'`-level editor can create cross-owner (`ownedModuleAllowed` = `level=='family' || (level=='own' && data.ownerId==memberId())`); showing an override to an `'own'`-level editor would offer a choice the server silently rejects on submit. A shared `<OwnerPicker>` component (Task 2) implements this once, reused by all four create/edit forms — not reinvented per screen.
- **D8 — spec §5.1 drill-down is plain `navigateTo(id)` calls, no sessionStorage bridge.** Unlike `AnnualReport`'s pre-existing `onNavigateToExpenses` bridge (needed because `ExpensesBreakdown` doesn't consume global filters), every Stage 5 destination screen already shares `FilterContext.filters.member` with its origin card (D5) — clicking "חשבונות ומזומן" on the Net Worth screen or Dashboard just calls `navigateTo('accounts')`; the מי selection is already correct because it's the same global state, no bridge required. A card whose underlying screen is **not** rewired onto global filters this stage (`'expenses'`, driven by `transaction_lines` totals on Dashboard) still navigates, but doesn't auto-scope beyond whatever that screen's own pre-existing local controls do — disclosed as a smaller win than the fully-wired cards, not silently pretended equivalent; closing that gap is that screen's own future D7 flip (named follow-up below), out of this stage's explicit scope (owned-collection screens + net worth + drill-down only).
- **D9 (carry-forward, corrected) — the `loadBudget`/`loadSettlement` full-collection `transaction_lines` scan is named a Stage 5 carry-forward in the roadmap, but this stage's own research found the straightforward fix would be a correctness regression, not a perf win, and it is explicitly NOT implemented here.** `transaction_lines` holds both natively-written rows (`YYYY-MM-DD`) and migrated legacy rows that "kept their original date/category formatting verbatim" (Stage 1 ledger, Task 5) — meaning the collection has **no single sortable date format** today. A naive `where('date', '>=', isoBound)` range query would silently exclude any legacy row whose `date` field isn't a lexicographically-comparable ISO string (a `DD/MM/YYYY` string compares incorrectly against an ISO bound) — turning a documented perf carry-forward into an undetected data-loss bug in the budget/settlement totals. **Disposition: deferred, with a sharper, corrected reason** than the roadmap's original framing — normalizing `transaction_lines.date` to one sortable format (a real migration script, precedented by `scripts/migrate-transactions.ts`) is the actual prerequisite, itself a real, disclosed, out-of-scope piece of work (candidate: Stage 11, or a dedicated data-hygiene pass). Not attempted here.

**Carry-forwards from the Stage 1/2/3/4 ledgers reviewed and their disposition:**
- Date-range `where()` query for `loadBudget`/`loadSettlement` — **deferred, reason corrected** (D9 above): the real blocker is `transaction_lines.date`'s mixed legacy formatting, not merely "nobody wrote the where clause yet."
- `transaction_lines.owner` display-name vs `ownerId` inconsistency (Stage 3 D1) — **unaffected by this stage.** None of the four owned collections write `transaction_lines` directly except `RecurringService`'s existing posting bridge (`ownerId → display name via a fresh listMembers() call`, already correct, untouched here). Migration of `transaction_lines.owner` itself to `ownerId` stays a Stage 11 candidate, as the Stage 3 ledger already ruled.
- `FamilyManagerModal`'s optimistic success toast before `onSave` resolves (Stage 1 Task 6b) — **deferred, not touched.** No task in this plan edits `FamilyManagerModal.tsx`. Stays a Stage 11 (or "whenever this file is next opened") item, per Stage 4's identical disposition.
- Drive storage-key constants migration for `SyncButton`/`InvestmentsImportModal`/`AssetCard` (Stage 2 Task 7 review) — **deferred, not touched.** None of the three files are edited by this plan.
- Label/glossary synonym drift — **surfaced to David explicitly, not silently resolved.** Two pairs exist: (1) "עו״ש וחסכון" (Dashboard's old tile label) vs "כסף מזומן" (its glossary title) — this pair becomes **moot** under D3/D4: both the tile and its glossary entry are retired together as a unit, not reconciled. (2) "יתרה חודשית" (Dashboard's hardcoded `monthlyBalance` KPI label) vs "מאזן חודשי" (`dashboard.monthlyBalance`'s glossary title) — **untouched by any task in this plan** (`monthlyBalance` = income − expenses, unrelated to net worth). Per the Stage 4 closing-fix precedent for the exact same kind of call ("Surface both to David with the stage summary; his call"), this pair is named as a Done Criteria item (below), not silently picked one way or the other.
- Stage 4 Risk — `resolveEcosystemKey`'s 2+-member/group fallback to `'all'` — **narrowed, not fully closed**, by D3 (see D3's note above): net worth itself no longer has this problem once `accounts`/`loans` are populated; the underlying `settings/ecosystem` doc and its D8 fallback still exist for whatever legacy consumers remain (none, after this stage — `dashboard.ecosystem.*` tiles are retired). The `resolveEcosystemKey`/D8 machinery in `resolveMemberSelection.ts` itself is **left in place, unused by Dashboard after this stage** — not deleted, since deleting a still-exported, still-tested utility function on spec is unrelated cleanup outside this stage's scope; flagged for a future dead-code sweep if nothing else claims it.

## Global Constraints

- All work on branch `familyfinance-v2`. Never commit to `main`.
- TypeScript strict; `npm run lint` (tsc --noEmit) and `npm test` must pass before every commit.
- A failed read renders as an error, never an empty state, for every new hook/component in this plan. A `permission-denied` refusal is a DIFFERENT state again (S2 ruling, carried forward): a calm access message, never the red error/retry copy, never a silent empty list or ₪0 — apply this to every one of the four screens' list loads, `useNetWorth`, and the drill-down destinations. This rule has been re-broken in every prior stage; each task below carries it as an explicit checklist item, not a global aspiration.
- Scope discipline: **screens + drill-down + net-worth resolution only.** No task in this plan touches the AI layer (Stage 6) or the forecast engine (Stage 7). No task edits `ExpensesBreakdown`/`AnnualReport`/`CentralExpenseReport`/`InvestmentsPortfolio`/`FuturePlanning`/`FolderLogic`/`FamilyManagerModal`.
- Every screen ships all four states — loading / empty / error / permission-denied — as its own checklist item per task, per the S2 ruling.
- `ownerId` defaults to the acting session's `memberId` on every new create form (D7); never silently left blank, never silently assigned to someone else.
- `data-tour-id` on every new screen's list container, create button, and per-row action (D12 convention: `nav.<moduleId>` already covered by Task 1's registry entries; new: `screen.<moduleId>.list`, `screen.<moduleId>.create`, `screen.<moduleId>.row.<action>`).
- Hebrew UI strings for everything user-facing; dates DD/MM/YYYY where user-facing; amounts ₪-labeled where rendered; no hardcoded values beyond named constants documented as intentional.
- Frequent commits; each task ends with an independently testable, green deliverable; the app is usable after every single task.

---

### Task 1: Scope-aware owned-collection queries + module-aware FilterBar dead-end filtering

**Files:**
- Modify: `src/services/financeCollections.ts`, `src/services/AccountsService.ts`, `src/services/LoansService.ts`, `src/services/InsurancesService.ts`, `src/services/RecurringService.ts`, `src/hooks/useRecurringCatchup.ts`, `src/App.tsx`, `src/utils/memberVisibility.ts`, `src/utils/resolveMemberSelection.ts`
- Create: `src/utils/ownedModuleScope.ts`
- Test: `src/__tests__/financeCollections.test.ts` (extend), `src/__tests__/AccountsService.test.ts`/`LoansService.test.ts`/`InsurancesService.test.ts`/`RecurringService.test.ts` (extend), `src/__tests__/useRecurringCatchup.test.ts` (extend), `src/__tests__/memberVisibility.test.ts` (extend), `src/__tests__/resolveMemberSelection.test.ts` (extend), `src/__tests__/ownedModuleScope.test.ts` (new), `firestore-tests/finance-modules.rules.test.ts` (extend — proves the list-query gap for real against the live emulator, not just mocks)

**Interfaces:**
```ts
// src/utils/ownedModuleScope.ts
import type { PermissionLevel, PermissionRole } from '../types/permissions';

/** Super-admin/parent always resolve to 'family' regardless of any stored level, matching the
 * Rules layer's own unconditional bypass. A 'member' role resolves whatever level was granted,
 * defaulting an absent/'none' level to 'none' — fail-closed, matching sanitizeLevel's precedent. */
export function resolveOwnedModuleScope(
  role: PermissionRole,
  level: PermissionLevel | undefined
): 'own' | 'family' | 'none';
```
```ts
// src/services/financeCollections.ts — breaking signature change
export interface OwnedCollectionRepo<T extends OwnedRecord> {
  list(scope: 'own' | 'family', viewerMemberId: string): Promise<T[]>;
  save(input: OwnedRecordInput<T>, actorMemberId: string): Promise<T>;
  remove(id: string, actorMemberId: string): Promise<void>;
}
```
```ts
// src/services/AccountsService.ts (LoansService/InsurancesService/RecurringService identical shape)
export const listAccounts: (scope: 'own' | 'family', viewerMemberId: string) => Promise<Account[]>;
```
```ts
// src/services/RecurringService.ts
export async function postDueRecurringTransactions(
  actorMemberId: string,
  scope: 'own' | 'family',
  today?: Date
): Promise<PostingOutcome>;
```
```ts
// src/hooks/useRecurringCatchup.ts
import type { PermissionLevel, PermissionRole } from '../types/permissions';
export function useRecurringCatchup(
  session: Pick<AuthSession, 'status' | 'memberId' | 'role'>,
  recurringViewLevel: PermissionLevel | undefined // resolvedPermissions?.recurring?.view — App.tsx already has this
): void;
```
```ts
// src/utils/memberVisibility.ts
import type { ModuleId, PermissionLevel, PermissionRole } from '../types/permissions';

export interface ViewerAccess {
  role: PermissionRole;
  memberId: string;
  levelsByModule: Partial<Record<ModuleId, PermissionLevel>>;
}

export function filterViewableMembers(
  members: Member[],
  groups: Group[],
  viewerAccess: ViewerAccess | null,
  filterModuleId: ModuleId | null
): ViewableMembers;
```
```ts
// src/config/moduleRegistry.ts — extend the existing interface, no new file
export interface ModuleRegistryEntry {
  id: ModuleRegistryId;
  label: string;
  icon: LucideIcon;
  permissionModuleId: ModuleId | null;
  usesGlobalFilters: boolean;
  filterModuleId: ModuleId | null; // D2 — new field, required on every entry
}
```
```ts
// src/utils/resolveMemberSelection.ts — new export alongside the existing two
export function resolveMemberSelectionIds(
  selection: MemberSelection,
  groups: Group[]
): Set<string> | null;
```

- [ ] **Step 1: Write the failing tests**

`src/__tests__/ownedModuleScope.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { resolveOwnedModuleScope } from '../utils/ownedModuleScope';

describe('resolveOwnedModuleScope', () => {
  it('super-admin always resolves to family, regardless of level', () => {
    expect(resolveOwnedModuleScope('super-admin', 'none')).toBe('family');
    expect(resolveOwnedModuleScope('super-admin', undefined)).toBe('family');
  });
  it('parent always resolves to family, regardless of level', () => {
    expect(resolveOwnedModuleScope('parent', 'own')).toBe('family');
  });
  it('member resolves to the granted level', () => {
    expect(resolveOwnedModuleScope('member', 'family')).toBe('family');
    expect(resolveOwnedModuleScope('member', 'own')).toBe('own');
  });
  it('member with no/undefined/none level fails closed to none', () => {
    expect(resolveOwnedModuleScope('member', undefined)).toBe('none');
    expect(resolveOwnedModuleScope('member', 'none')).toBe('none');
  });
});
```

Extend `src/__tests__/financeCollections.test.ts` (add `query`/`where` to the `firebase/firestore` mock factory, update every existing `list()` call to `list('family', 'x')`, add new cases):
```ts
// inside the vi.mock('firebase/firestore', ...) factory, add:
  query: vi.fn((colRef, ...clauses) => ({ __col: colRef.__col, __clauses: clauses })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),

// replace every `await list()` with `await list('family', 'viewer-x')`, then add:
  it("list('own', viewerId) adds a where('ownerId','==',viewerId) clause", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    await list('own', 'omer-levy');
    const [queryArg] = mockGetDocs.mock.calls[0];
    expect(queryArg.__clauses).toEqual([{ field: 'ownerId', op: '==', value: 'omer-levy' }]);
  });
  it("list('family', viewerId) issues a bare, unfiltered collection scan (no where clause)", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    await list('family', 'omer-levy');
    const [arg] = mockGetDocs.mock.calls[0];
    expect(arg.__clauses).toBeUndefined(); // a bare CollectionReference, not a query() result
  });
```

Extend each of `AccountsService.test.ts`/`LoansService.test.ts`/`InsurancesService.test.ts`/`RecurringService.test.ts`: update every `listX()` call site to `listX('family', 'viewer-x')`, add one `listX('own', 'omer-levy')` case per file asserting the mocked `where` was called with `('ownerId', '==', 'omer-levy')`.

Extend `src/__tests__/RecurringService.test.ts` for `postDueRecurringTransactions`'s new `scope` param — update every existing call site (`postDueRecurringTransactions('david-levy')` → `postDueRecurringTransactions('david-levy', 'family')`), add:
```ts
  it("passes the caller's scope through to listRecurring, not always 'family'", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] }); // listRecurring
    mockGetDocs.mockResolvedValueOnce({ docs: [] }); // listMembers
    await postDueRecurringTransactions('omer-levy', 'own');
    const [queryArg] = mockGetDocs.mock.calls[0];
    expect(queryArg.__clauses).toEqual([{ field: 'ownerId', op: '==', value: 'omer-levy' }]);
  });
```

Extend `src/__tests__/useRecurringCatchup.test.ts` (mock `resolveOwnedModuleScope` indirectly via role/level params): add a case asserting a `'member'` session with `recurringViewLevel: 'own'` calls `postDueRecurringTransactions(memberId, 'own')`, and a `'member'` with `recurringViewLevel: undefined` (fail-closed to `'none'`) does NOT call `postDueRecurringTransactions` at all (nothing to post, not an error — no wasted read, no false failure notification).

Extend `src/__tests__/memberVisibility.test.ts`: replace every `{ role, memberId, expensesView }` fixture with `{ role, memberId, levelsByModule: { expenses: ... } }`; add a case with `filterModuleId: 'accounts'` proving it reads `levelsByModule.accounts`, not `.expenses`, and a case with `filterModuleId: null` proving it returns everyone unrestricted regardless of `levelsByModule`'s contents.

Extend `src/__tests__/resolveMemberSelection.test.ts`:
```ts
describe('resolveMemberSelectionIds', () => {
  const groups = [{ id: 'kids', name: 'הילדים', memberIds: ['omer-levy'], createdAt: 'x', updatedAt: 'x' }];
  it('mode "all" resolves to null', () => {
    expect(resolveMemberSelectionIds({ mode: 'all', memberIds: [], groupId: null }, groups)).toBeNull();
  });
  it('mode "members" returns the ids directly, no name lookup needed', () => {
    expect(resolveMemberSelectionIds({ mode: 'members', memberIds: ['omer-levy', 'lilit-levy'], groupId: null }, groups))
      .toEqual(new Set(['omer-levy', 'lilit-levy']));
  });
  it('mode "group" resolves via Group.memberIds', () => {
    expect(resolveMemberSelectionIds({ mode: 'group', memberIds: [], groupId: 'kids' }, groups))
      .toEqual(new Set(['omer-levy']));
  });
  it('mode "group" with an unknown groupId resolves to null, not a throw', () => {
    expect(resolveMemberSelectionIds({ mode: 'group', memberIds: [], groupId: 'ghost' }, groups)).toBeNull();
  });
});
```

Extend `firestore-tests/finance-modules.rules.test.ts` (proves the actual gap against the live emulator, using the existing OMER/RESTRICTED fixtures already seeded in `beforeEach`):
```ts
import { collection, query, getDocs, where } from 'firebase/firestore';
// ...
describe("accounts — list-query own-level gap (D1)", () => {
  it("Omer (own-level) CANNOT list accounts with a bare, unconstrained query", async () => {
    await assertFails(getDocs(collection(ctxFor(OMER).firestore(), 'accounts')));
  });
  it("Omer (own-level) CAN list accounts scoped with where('ownerId','==',his own id)", async () => {
    const snap = await assertSucceeds(
      getDocs(query(collection(ctxFor(OMER).firestore(), 'accounts'), where('ownerId', '==', 'omer-levy')))
    );
    expect(snap.docs.map((d) => d.id)).toEqual(['acc-omer']); // never sees acc-lilit
  });
  it("David (super-admin) CAN list accounts with a bare, unconstrained query", async () => {
    const snap = await assertSucceeds(getDocs(collection(ctxFor(DAVID).firestore(), 'accounts')));
    expect(snap.docs.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/ownedModuleScope.test.ts src/__tests__/financeCollections.test.ts src/__tests__/AccountsService.test.ts src/__tests__/LoansService.test.ts src/__tests__/InsurancesService.test.ts src/__tests__/RecurringService.test.ts src/__tests__/useRecurringCatchup.test.ts src/__tests__/memberVisibility.test.ts src/__tests__/resolveMemberSelection.test.ts`
Expected: FAIL — new module missing, existing call sites now type-error/behave differently.

- [ ] **Step 3: Implement**

`src/utils/ownedModuleScope.ts` — as specified in Interfaces; a 4-line pure function, no I/O.

`src/services/financeCollections.ts` — change `list`:
```ts
import { collection, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';
// ...
async function list(scope: 'own' | 'family', viewerMemberId: string): Promise<T[]> {
  const target = scope === 'own'
    ? query(collection(db, collectionName), where('ownerId', '==', viewerMemberId))
    : collection(db, collectionName);
  const snap = await getDocs(target);
  return snap.docs.map((d) => d.data() as T);
}
```
Update the module doc comment to explain the scope split and point at this task.

`AccountsService.ts`/`LoansService.ts`/`InsurancesService.ts` — no code change needed beyond the type flowing through (`export const listAccounts = repo.list;` already has the new signature once `financeCollections.ts` changes).

`RecurringService.ts` — thread `scope` through `postDueRecurringTransactions`, replacing its internal `listRecurring()` call:
```ts
export async function postDueRecurringTransactions(
  actorMemberId: string,
  scope: 'own' | 'family',
  today: Date = new Date()
): Promise<PostingOutcome> {
  // ...
  const [itemList, members] = await Promise.all([listRecurring(scope, actorMemberId), listMembers()]);
  // ...
```
Update the module's own header comment (it currently asserts "Rules, not app code, do the owner-scoping" for the bare list — that assumption is exactly what this task corrects).

`src/hooks/useRecurringCatchup.ts` — take the extra param, resolve scope, skip the call entirely (not an error, nothing due) when scope is `'none'`:
```ts
import { resolveOwnedModuleScope } from '../utils/ownedModuleScope';
// ...
export function useRecurringCatchup(
  session: Pick<AuthSession, 'status' | 'memberId' | 'role'>,
  recurringViewLevel: PermissionLevel | undefined
): void {
  // ... existing guard clauses unchanged ...
  const scope = resolveOwnedModuleScope(session.role!, recurringViewLevel);
  if (scope === 'none') return; // nothing this session could ever see is due — not a failure
  postDueRecurringTransactions(session.memberId, scope)
    // ... unchanged .then/.catch ...
```

`src/App.tsx` — call site update: `useRecurringCatchup(session, permState.resolvedPermissions?.recurring?.view)`.

`src/utils/memberVisibility.ts` — replace `expensesView` with `levelsByModule`, add the `filterModuleId` parameter:
```ts
export function filterViewableMembers(
  members: Member[], groups: Group[],
  viewerAccess: ViewerAccess | null, filterModuleId: ModuleId | null
): ViewableMembers {
  if (!viewerAccess || filterModuleId === null) return { members, groups };
  const level = viewerAccess.levelsByModule[filterModuleId] ?? 'none';
  if (level === 'family') return { members, groups };
  return { members: members.filter((m) => m.id === viewerAccess.memberId), groups: [] };
}
```

`src/App.tsx` — replace the single-field `viewerAccess` construction:
```ts
const RELEVANT_MODULES: readonly ModuleId[] = ['expenses', 'accounts', 'loans', 'insurances', 'recurring'];
const levelsByModule: Partial<Record<ModuleId, PermissionLevel>> = Object.fromEntries(
  RELEVANT_MODULES.map((m) => [
    m,
    isSuperAdmin || session.role === 'parent' ? 'family' : (permState.resolvedPermissions?.[m]?.view ?? 'none'),
  ])
) as Partial<Record<ModuleId, PermissionLevel>>;
const viewerAccess: ViewerAccess = { role: session.role!, memberId: session.memberId!, levelsByModule };
```

`src/components/FilterBar.tsx` — read the active screen's `filterModuleId` and pass it through:
```ts
import { useNavigation } from '../contexts/NavigationContext';
import { MODULE_REGISTRY } from '../config/moduleRegistry';
// ...
const { activeTab } = useNavigation();
const filterModuleId = MODULE_REGISTRY.find((e) => e.id === activeTab)?.filterModuleId ?? null;
// ...
const { members: viewableMembers, groups: viewableGroups } = useMemo(
  () => filterViewableMembers(familyMembers.members, groups.groups, viewerAccess, filterModuleId),
  [familyMembers.members, groups.groups, viewerAccess, filterModuleId]
);
```

`src/config/moduleRegistry.ts` — add `filterModuleId` to every existing entry (`dashboard: 'expenses'`, `expenses: 'expenses'`, `central-expenses: 'expenses'`, `investments: 'investments'`, `future: null`, `annual: 'expenses'`, `folder: null`); the five new entries are added by their own tasks below, each already carrying a correct `filterModuleId`.

`src/utils/resolveMemberSelection.ts` — add `resolveMemberSelectionIds` as specified.

- [ ] **Step 4: Run to verify pass**

Run: `npm run lint && npx vitest run src/__tests__/ownedModuleScope.test.ts src/__tests__/financeCollections.test.ts src/__tests__/AccountsService.test.ts src/__tests__/LoansService.test.ts src/__tests__/InsurancesService.test.ts src/__tests__/RecurringService.test.ts src/__tests__/useRecurringCatchup.test.ts src/__tests__/memberVisibility.test.ts src/__tests__/resolveMemberSelection.test.ts src/__tests__/moduleRegistry.test.ts`
Expected: ALL PASS. `moduleRegistry.test.ts` needs its existing entries' assertions extended with `filterModuleId` too (fold into this step).

- [ ] **Step 5: Rules test — verify the D1 gap is real, then verify the fix**

Run: `npm run test:rules` (or the project's emulator-backed script — matches `scripts/test:rules` convention from Stage 2/3). Before trusting the new "Omer CANNOT list" test, confirm it actually reproduces the gap: temporarily point it at a `where`-scoped query instead and confirm it flips to `assertSucceeds` — i.e., prove the bare-query test fails for the RIGHT reason (Firestore's list-verification, not a fixture typo), per this project's verification-before-completion discipline.

- [ ] **Step 6: Full verification**

Run: `npm run lint && npm test && npm run test:rules`
Expected: ALL PASS (unit count grows from 474; rules count stays 157 — no `firestore.rules` change, only new tests against the existing rule).

- [ ] **Step 7: Commit**

```bash
git add src/utils/ownedModuleScope.ts src/services/financeCollections.ts src/services/AccountsService.ts src/services/LoansService.ts src/services/InsurancesService.ts src/services/RecurringService.ts src/hooks/useRecurringCatchup.ts src/App.tsx src/utils/memberVisibility.ts src/utils/resolveMemberSelection.ts src/config/moduleRegistry.ts src/components/FilterBar.tsx src/__tests__/ownedModuleScope.test.ts src/__tests__/financeCollections.test.ts src/__tests__/AccountsService.test.ts src/__tests__/LoansService.test.ts src/__tests__/InsurancesService.test.ts src/__tests__/RecurringService.test.ts src/__tests__/useRecurringCatchup.test.ts src/__tests__/memberVisibility.test.ts src/__tests__/resolveMemberSelection.test.ts src/__tests__/moduleRegistry.test.ts firestore-tests/finance-modules.rules.test.ts
git commit -m "fix: scope-aware owned-collection list queries + module-aware FilterBar dead-end filtering

Own-level list() issued an unconstrained getDocs() Firestore denies wholesale under
ownedModuleAllowed()'s resource.data-dependent rule — the same failure class Stage 4 found for
transaction_lines/incomes, latent here since Stage 3 and never exercised outside mocks. Fixes the
four owned-collection services and the already-shipped recurring catch-up engine before Stage 5's
screens call any of them from a live browser. Also generalizes FilterBar's dead-end avoidance from
one hardcoded module to the active screen's own module.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Accounts screen — list/create/edit/delete, `OwnerPicker`, states, glossary, registry

**Files:**
- Create: `src/components/OwnerPicker.tsx`, `src/components/AccountsScreen.tsx`
- Modify: `src/config/moduleRegistry.ts`, `src/config/glossary.ts`, `src/App.tsx`
- Test: `src/__tests__/OwnerPicker.test.tsx`, `src/__tests__/AccountsScreen.test.tsx`, `src/__tests__/glossary.test.ts` (extend), `src/__tests__/moduleRegistry.test.ts` (extend)

**Interfaces:**
```ts
// src/components/OwnerPicker.tsx — D7, shared by all four create/edit forms
export interface OwnerPickerProps {
  members: Member[];
  value: string;               // current ownerId
  onChange: (ownerId: string) => void;
  editLevel: 'own' | 'family' | 'none'; // resolveOwnedModuleScope's own output, reused directly
  actingMemberId: string;
}
export function OwnerPicker(props: OwnerPickerProps): React.JSX.Element;
```
```ts
// src/components/AccountsScreen.tsx
export default function AccountsScreen(props: {
  session: { memberId: string; role: PermissionRole };
  accountsViewLevel: PermissionLevel | undefined;
  accountsEditLevel: PermissionLevel | undefined;
}): React.JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

`src/__tests__/OwnerPicker.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OwnerPicker } from '../components/OwnerPicker';

const members = [
  { id: 'david-levy', name: 'דויד', color: '#111', role: 'הורה', groups: [], createdAt: 'x', updatedAt: 'x' },
  { id: 'omer-levy', name: 'עומר', color: '#222', role: 'ילד', groups: [], createdAt: 'x', updatedAt: 'x' },
] as any[];

describe('OwnerPicker (D7)', () => {
  it("editLevel 'own': renders a fixed, non-editable label naming the acting member — no select", () => {
    render(<OwnerPicker members={members} value="omer-levy" onChange={vi.fn()} editLevel="own" actingMemberId="omer-levy" />);
    expect(screen.getByText(/עומר/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
  it("editLevel 'family': renders a select offering every member, defaulting to the current value", () => {
    render(<OwnerPicker members={members} value="omer-levy" onChange={vi.fn()} editLevel="family" actingMemberId="david-levy" />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('omer-levy');
  });
  it("editLevel 'family': changing the select calls onChange with the new ownerId", () => {
    const onChange = vi.fn();
    render(<OwnerPicker members={members} value="omer-levy" onChange={onChange} editLevel="family" actingMemberId="david-levy" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'david-levy' } });
    expect(onChange).toHaveBeenCalledWith('david-levy');
  });
  it("editLevel 'none': renders the label but no select (matches 'own' — read-only either way)", () => {
    render(<OwnerPicker members={members} value="omer-levy" onChange={vi.fn()} editLevel="none" actingMemberId="omer-levy" />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
```

`src/__tests__/AccountsScreen.test.tsx` (mock `AccountsService`; representative cases — the delta from this pattern is what the following three tasks' own test files spell out):
```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AccountsScreen from '../components/AccountsScreen';

const { mockList, mockSave, mockRemove } = vi.hoisted(() => ({
  mockList: vi.fn(), mockSave: vi.fn(), mockRemove: vi.fn(),
}));
vi.mock('../services/AccountsService', () => ({ listAccounts: mockList, saveAccount: mockSave, deleteAccount: mockRemove }));
// FilterProvider/useGlobalFilters mocked to a fixed 'all' selection + a two-member family — see
// the existing Dashboard test suite's FilterContext mock for the established pattern to reuse.

describe('AccountsScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loading state renders before the list resolves', () => {
    mockList.mockReturnValue(new Promise(() => {})); // never resolves
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    expect(screen.getByText(/טוען/)).toBeInTheDocument();
  });

  it('empty state (zero accounts, successful read) renders an explicit "no accounts yet" message, not a blank list', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => expect(screen.getByText(/עדיין לא הוספתם חשבונות/)).toBeInTheDocument());
  });

  it('a failed read renders an explicit error, never an empty list (Global Constraints)', async () => {
    mockList.mockRejectedValueOnce(Object.assign(new Error('down'), { code: 'unavailable' }));
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => expect(screen.getByText(/טעינת החשבונות נכשלה/)).toBeInTheDocument());
    expect(screen.queryByText(/עדיין לא הוספתם חשבונות/)).not.toBeInTheDocument();
  });

  it('a permission-denied read renders the calm access message, never the red error banner (S2)', async () => {
    mockList.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'permission-denied' }));
    render(<AccountsScreen session={{ memberId: 'omer-levy', role: 'member' }} accountsViewLevel={undefined} accountsEditLevel={undefined} />);
    await waitFor(() => expect(screen.getByText(/אין לך הרשאה/)).toBeInTheDocument());
    expect(screen.queryByText(/נכשלה/)).not.toBeInTheDocument();
  });

  it("create form defaults ownerId to the acting session's memberId (D7)", async () => {
    mockList.mockResolvedValueOnce([]);
    mockSave.mockResolvedValueOnce({});
    render(<AccountsScreen session={{ memberId: 'omer-levy', role: 'member' }} accountsViewLevel="own" accountsEditLevel="own" />);
    await waitFor(() => screen.getByText(/עדיין לא הוספתם חשבונות/));
    fireEvent.click(screen.getByTestId('screen.accounts.create'));
    fireEvent.change(screen.getByLabelText('שם החשבון'), { target: { value: 'עו״ש' } });
    fireEvent.change(screen.getByLabelText('יתרה'), { target: { value: '1000' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'omer-levy', name: 'עו״ש', balance: 1000 }),
      'omer-levy'
    ));
  });

  it("an 'own'-level editor sees no OwnerPicker select — cannot choose someone else (D7 + Rules would deny it anyway)", async () => {
    mockList.mockResolvedValueOnce([]);
    render(<AccountsScreen session={{ memberId: 'omer-levy', role: 'member' }} accountsViewLevel="own" accountsEditLevel="own" />);
    await waitFor(() => screen.getByText(/עדיין לא הוספתם חשבונות/));
    fireEvent.click(screen.getByTestId('screen.accounts.create'));
    expect(screen.queryByRole('combobox', { name: /בעלים/ })).not.toBeInTheDocument();
  });

  it('delete asks for confirmation before calling deleteAccount', async () => {
    mockList.mockResolvedValueOnce([{ id: 'a1', ownerId: 'david-levy', name: 'עו״ש', type: 'bank', balance: 1000, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => screen.getByText('עו״ש'));
    fireEvent.click(screen.getByTestId('screen.accounts.row.delete'));
    expect(screen.getByText(/למחוק את החשבון/)).toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('כן, מחק'));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('a1', 'david-levy'));
  });

  it('archived accounts render with a visible "ארכיון" badge and can be reactivated', async () => {
    mockList.mockResolvedValueOnce([{ id: 'a1', ownerId: 'david-levy', name: 'ישן', type: 'bank', balance: 0, balanceUpdatedAt: 'x', status: 'archived', createdAt: 'x', updatedAt: 'x' }]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => expect(screen.getByText('ארכיון')).toBeInTheDocument());
  });

  it('the total-balance summary is wired to the accounts.totalBalance glossary entry', async () => {
    mockList.mockResolvedValueOnce([{ id: 'a1', ownerId: 'david-levy', name: 'X', type: 'bank', balance: 500, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => expect(screen.getByLabelText('הסבר: סך היתרות')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/OwnerPicker.test.tsx src/__tests__/AccountsScreen.test.tsx`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement `OwnerPicker.tsx`**

```tsx
import React from 'react';
import type { Member } from '../utils/seedFromBudgetConfig';

export interface OwnerPickerProps {
  members: Member[];
  value: string;
  onChange: (ownerId: string) => void;
  editLevel: 'own' | 'family' | 'none';
  actingMemberId: string;
}

export function OwnerPicker({ members, value, onChange, editLevel, actingMemberId }: OwnerPickerProps): React.JSX.Element {
  const actingName = members.find((m) => m.id === actingMemberId)?.name ?? '';
  if (editLevel !== 'family') {
    // D7 — an 'own'/'none'-level editor can only ever create for themselves; Rules would deny
    // any other ownerId on write, so no select is offered at all (never a control that lies
    // about what submitting it will do).
    return <p className="text-sm text-slate-600" dir="rtl">עבור: <span className="font-medium">{actingName}</span></p>;
  }
  return (
    <label className="block text-sm" dir="rtl">
      <span className="text-slate-600 mb-1 block">בעלים</span>
      <select
        aria-label="בעלים"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm"
      >
        {members.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 4: Implement `AccountsScreen.tsx`**

Structure (loading/empty/error/permission-denied branch first, matching Dashboard's established three/four-way branch idiom; `isPermissionDenied` helper duplicated locally per Dashboard's own precedent of a small per-file helper rather than a shared import — same rationale: catch variables aren't typed `unknown` project-wide):

```tsx
import React, { useEffect, useState } from 'react';
import { listAccounts, saveAccount, deleteAccount } from '../services/AccountsService';
import { useGlobalFilters } from '../contexts/FilterContext';
import { resolveMemberSelectionIds } from '../utils/resolveMemberSelection';
import { resolveOwnedModuleScope } from '../utils/ownedModuleScope';
import { OwnerPicker } from './OwnerPicker';
import { Explain } from './Explain';
import type { Account, AccountType } from '../types/finance';
import type { PermissionLevel, PermissionRole } from '../types/permissions';

const ACCESS_DENIED_MESSAGE = 'אין לך הרשאה לצפות בחשבונות אלו';
const TYPE_LABELS: Record<AccountType, string> = { bank: 'בנק', cash: 'מזומן', credit: 'אשראי' };

function isPermissionDenied(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'permission-denied';
}

export interface AccountsScreenProps {
  session: { memberId: string; role: PermissionRole };
  accountsViewLevel: PermissionLevel | undefined;
  accountsEditLevel: PermissionLevel | undefined;
}

export default function AccountsScreen({ session, accountsViewLevel, accountsEditLevel }: AccountsScreenProps): React.JSX.Element {
  const { filters, familyMembers } = useGlobalFilters();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'permission-denied'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const viewScope = resolveOwnedModuleScope(session.role, accountsViewLevel);
  const editScope = resolveOwnedModuleScope(session.role, accountsEditLevel);

  useEffect(() => {
    if (viewScope === 'none') { setStatus('permission-denied'); return; }
    setStatus('loading');
    listAccounts(viewScope, session.memberId)
      .then((result) => { setAccounts(result); setStatus('ready'); })
      .catch((err: unknown) => {
        if (isPermissionDenied(err)) { setStatus('permission-denied'); return; }
        setErrorMessage('טעינת החשבונות נכשלה. בדוק את החיבור ונסה שוב.');
        setStatus('error');
      });
  }, [viewScope, session.memberId]);

  const selectedIds = resolveMemberSelectionIds(filters.member, familyMembers.status === 'ready' ? [] : []); // groups come from useGlobalFilters().groups.groups when 'ready' — wired below
  const visibleAccounts = selectedIds ? accounts.filter((a) => selectedIds.has(a.ownerId)) : accounts;
  const totalBalance = visibleAccounts.filter((a) => a.status === 'active').reduce((sum, a) => sum + a.balance, 0);

  const openCreate = () => { setEditing(null); setIsFormOpen(true); };

  const handleSubmit = async (input: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>) => {
    await saveAccount(editing ? { ...input, id: editing.id } : input, session.memberId);
    setIsFormOpen(false);
    setStatus('loading');
    const result = await listAccounts(viewScope, session.memberId);
    setAccounts(result);
    setStatus('ready');
  };

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    await deleteAccount(pendingDeleteId, session.memberId);
    setPendingDeleteId(null);
    setAccounts((prev) => prev.filter((a) => a.id !== pendingDeleteId));
  };

  if (status === 'permission-denied') {
    return <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-slate-500 text-sm" dir="rtl">{ACCESS_DENIED_MESSAGE}</div>;
  }
  if (status === 'error') {
    return <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center" dir="rtl"><p className="text-red-600 font-medium">{errorMessage}</p></div>;
  }
  if (status === 'loading') {
    return <div className="p-8 text-center text-slate-500" dir="rtl">טוען חשבונות...</div>;
  }

  return (
    <div className="space-y-4" data-tour-id="screen.accounts.list" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <h2 className="text-lg font-bold text-slate-800">חשבונות ויתרות</h2>
          <span className="text-sm text-slate-500">סך היתרות: ₪{totalBalance.toLocaleString()}</span>
          <Explain id="accounts.totalBalance" />
        </div>
        {editScope !== 'none' && (
          <button data-testid="screen.accounts.create" data-tour-id="screen.accounts.create" onClick={openCreate}
            className="bg-blue-600 text-white rounded-xl px-4 py-2 min-h-[44px] text-sm font-medium">
            חשבון חדש
          </button>
        )}
      </div>

      {visibleAccounts.length === 0 ? (
        <p className="text-slate-400 text-center py-8">עדיין לא הוספתם חשבונות.</p>
      ) : (
        <div className="space-y-2">
          {visibleAccounts.map((a) => (
            <div key={a.id} className="bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-800">
                  {a.name}
                  {a.status === 'archived' && <span className="ms-2 text-xs bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">ארכיון</span>}
                </p>
                <p className="text-xs text-slate-500">{TYPE_LABELS[a.type]} · ₪{a.balance.toLocaleString()}</p>
              </div>
              {editScope !== 'none' && (
                <div className="flex gap-2">
                  <button onClick={() => { setEditing(a); setIsFormOpen(true); }} className="text-sm text-blue-600 min-h-[44px] px-2">עריכה</button>
                  <button data-testid="screen.accounts.row.delete" onClick={() => setPendingDeleteId(a.id)} className="text-sm text-red-600 min-h-[44px] px-2">מחיקה</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create/edit form and delete-confirm dialog: standard controlled form over Account's
          fields (name/type/balance/status) + <OwnerPicker> for ownerId, defaulting to
          session.memberId on create; delete-confirm is a plain two-button inline dialog matching
          the "כן, מחק" copy asserted by the test above — omitted here for length, follows the
          exact controlled-input pattern already established by FamilyManagerModal's own
          edit-list UI in Dashboard.tsx. */}
    </div>
  );
}
```

The elided form/dialog block is written out in full during implementation (no placeholder ships) — the comment above documents the *pattern* it follows, which is already fully specified by the test file's assertions (field labels, `ownerId` defaulting, confirm-before-delete copy) and by `isValidAccount`'s Rules-level required fields (`name`, `type`, `balance`, `status`; `balanceUpdatedAt` set to `new Date().toISOString()` by the submit handler whenever `balance` changes).

- [ ] **Step 5: Add MODULE_REGISTRY entry + glossary entry + App.tsx wiring**

`src/config/moduleRegistry.ts`:
```ts
export type ModuleRegistryId =
  | 'dashboard' | 'expenses' | 'central-expenses' | 'investments' | 'future' | 'annual' | 'folder'
  | 'accounts'; // + loans/insurances/recurring/net-worth added by their own tasks
// ...
{ id: 'accounts', label: 'חשבונות ויתרות', icon: Landmark, permissionModuleId: 'accounts', usesGlobalFilters: true, filterModuleId: 'accounts' },
```

`src/config/glossary.ts` — add:
```ts
'accounts.totalBalance': {
  id: 'accounts.totalBalance',
  title: 'סך היתרות',
  explanation: 'זה סכום כל היתרות בחשבונות הפעילים שרואים ברשימה, לפי הבחירה של מי למעלה.',
  howComputed: 'מחברים את היתרה העדכנית של כל חשבון פעיל. חשבון בארכיון לא נכלל בסכום.',
  source: 'החשבונות שהוזנו במסך הזה',
  asOf: 'מתעדכן בכל פעם שנכנסים למסך',
},
```

`src/App.tsx` — add the `TabId` union member, the `renderContent` case (props threaded the same way `PermissionsManager` already gets `actorMemberId`/`role`), and the `visibleModules`/exhaustiveness guard picks it up automatically since both are driven by `MODULE_REGISTRY`:
```tsx
case 'accounts': return (
  <AccountsScreen
    session={{ memberId: session.memberId!, role: session.role! }}
    accountsViewLevel={permState.resolvedPermissions?.accounts?.view}
    accountsEditLevel={permState.resolvedPermissions?.accounts?.edit}
  />
);
```

- [ ] **Step 6: Run to verify pass**

Run: `npm run lint && npx vitest run src/__tests__/OwnerPicker.test.tsx src/__tests__/AccountsScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts`
Expected: ALL PASS. `glossary.test.ts`'s `REQUIRED_IDS` gets `'accounts.totalBalance'` appended.

- [ ] **Step 7: Full verification + manual smoke check**

Run: `npm run lint && npm test`. Manually (or via the `run` skill): sign in as David, open "חשבונות ויתרות", create an account, confirm it appears with the correct total, edit its balance, archive it, confirm the archived badge appears and it drops out of the total, delete a different account with confirm, sign in as a `'member'`-role fixture with `accounts: {view:'own', edit:'own'}` and confirm they see only their own account and no `OwnerPicker` select.

- [ ] **Step 8: Commit**

```bash
git add src/components/OwnerPicker.tsx src/components/AccountsScreen.tsx src/config/moduleRegistry.ts src/config/glossary.ts src/App.tsx src/__tests__/OwnerPicker.test.tsx src/__tests__/AccountsScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts
git commit -m "feat: accounts screen — list/create/edit/delete, OwnerPicker, permission-aware states

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Loans screen

**Files:**
- Create: `src/components/LoansScreen.tsx`
- Modify: `src/config/moduleRegistry.ts`, `src/config/glossary.ts`, `src/App.tsx`
- Test: `src/__tests__/LoansScreen.test.tsx`, `src/__tests__/glossary.test.ts` (extend), `src/__tests__/moduleRegistry.test.ts` (extend)

**Interfaces:**
```ts
export interface LoansScreenProps {
  session: { memberId: string; role: PermissionRole };
  loansViewLevel: PermissionLevel | undefined;
  loansEditLevel: PermissionLevel | undefined;
}
export default function LoansScreen(props: LoansScreenProps): React.JSX.Element;
```

Follows Task 2's `AccountsScreen` pattern exactly (same `viewScope`/`editScope` resolution, same four-state branch, same `OwnerPicker` reuse, same delete-confirm, same `data-tour-id` convention `screen.loans.*`). The delta:

- **Fields:** `name`, `loanType` (select: `mortgage`/`personal`/`creditLine`/`other`, Hebrew labels משכנתא/הלוואה אישית/מסגרת אשראי/אחר), `principal`, `balance`, `interestRate` (%), `monthlyPayment`, `startDate`, `endDate`, `status` (`active`/`paid-off`).
- **"כמה נשאר" progress** (spec's named UX requirement, §6 module map: "יתרה, ריבית, לוח סילוקין, 'כמה נשאר'") — each row shows a progress bar: `paidOffPct = principal > 0 ? Math.round((1 - balance / principal) * 100) : 0`, clamped `[0, 100]`, rendered as `${paidOffPct}% שולם, נשארו ₪{balance.toLocaleString()}`.
- **Glossary:** `loans.totalBalance` — "סך היתרה שנשארה לשלם על כל ההלוואות שרואים ברשימה, לפי הבחירה של מי למעלה."
- **Registry entry:** `{ id: 'loans', label: 'הלוואות וחובות', icon: Scale, permissionModuleId: 'loans', usesGlobalFilters: true, filterModuleId: 'loans' }`.

- [ ] **Step 1: Write the failing tests** — mirror `AccountsScreen.test.tsx`'s loading/empty/error/permission-denied/create-defaults-ownerId/no-picker-at-own-level/delete-confirm/glossary-wired cases against `LoansService`'s mock, plus one loan-specific case:
```tsx
it('shows the "כמה נשאר" payoff progress for each loan', async () => {
  mockList.mockResolvedValueOnce([{ id: 'l1', ownerId: 'david-levy', name: 'משכנתא', loanType: 'mortgage', principal: 1000000, balance: 750000, interestRate: 3.5, monthlyPayment: 4000, startDate: '2020-01-01', endDate: '2045-01-01', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
  render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
  await waitFor(() => expect(screen.getByText(/25% שולם/)).toBeInTheDocument());
  expect(screen.getByText(/נשארו ₪750,000/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/__tests__/LoansScreen.test.tsx`, expect FAIL.

- [ ] **Step 3: Implement `LoansScreen.tsx`** — same structure as `AccountsScreen.tsx` (Task 2 Step 4), swapping `Account`/`AccountsService` for `Loan`/`LoansService`, the type-label map for `LOAN_TYPE_LABELS`, and adding the payoff-progress row. Full component written, no elision this time (the pattern is now established; this task's own report is where the exact JSX lives).

- [ ] **Step 4: Registry + glossary + App.tsx wiring** — as in Task 2 Step 5, substituting the loans-specific values above.

- [ ] **Step 5: Run to verify pass** — `npm run lint && npx vitest run src/__tests__/LoansScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts`.

- [ ] **Step 6: Full verification + manual smoke check** — `npm run lint && npm test`; sign in as David, open "הלוואות וחובות", create a loan, confirm the payoff progress renders correctly, edit balance down, confirm the bar moves.

- [ ] **Step 7: Commit**
```bash
git add src/components/LoansScreen.tsx src/config/moduleRegistry.ts src/config/glossary.ts src/App.tsx src/__tests__/LoansScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts
git commit -m "feat: loans screen — list/create/edit/delete with payoff progress ('כמה נשאר')

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Insurances screen

**Files:**
- Create: `src/components/InsurancesScreen.tsx`
- Modify: `src/config/moduleRegistry.ts`, `src/config/glossary.ts`, `src/App.tsx`
- Test: `src/__tests__/InsurancesScreen.test.tsx`, `src/__tests__/glossary.test.ts` (extend), `src/__tests__/moduleRegistry.test.ts` (extend)

**Interfaces:**
```ts
export interface InsurancesScreenProps {
  session: { memberId: string; role: PermissionRole };
  insurancesViewLevel: PermissionLevel | undefined;
  insurancesEditLevel: PermissionLevel | undefined;
}
export default function InsurancesScreen(props: InsurancesScreenProps): React.JSX.Element;
```

Follows the same pattern. The real delta this collection introduces:

- **`insuredMemberId` is a SECOND member reference, distinct from `ownerId`** ("who pays/owns the policy" vs "who is covered" — spec: "פוליסות... מבוטח" / `types/finance.ts`'s own comment: "may differ from ownerId (parent owns, child insured)"). The create/edit form needs a SECOND member `<select>` (plain, not `OwnerPicker` — `insuredMemberId` has no own/family Rules restriction of its own, `isValidInsurance` only requires it non-empty; every viewer who can create an insurance policy at all can name any insured member, matching how a parent commonly insures a child with no login of their own).
- **`coverages: Coverage[]`** — a dynamic add/remove list of `{ label: string; amount?: number }` rows in the form (an "הוסף כיסוי" button appending a blank row, an "×" per row to remove).
- **Renewal-date callout** — a row whose `renewalDate` falls within 30 days of today gets a visible amber "מתחדש בקרוב" badge (real, useful UX matching spec's "תאריך חידוש" emphasis; computed with plain `Date` arithmetic, no library).
- **`documentId`** — shown as plain text if present ("מסמך מקושר: {documentId}"), NOT a document picker/Drive integration — the `ארכיון מסמכים` module (spec §12) is its own, unscheduled future roadmap item; linking a real document here is out of this stage's scope, disclosed rather than half-built.
- **Glossary:** `insurances.totalPremium` — "סך הפרמיה החודשית לכל הפוליסות שרואים ברשימה. פוליסה שנרשמה כשנתית מחולקת ל-12."; `howComputed` divides `premiumFrequency === 'yearly'` premiums by 12 before summing, so the total is always a comparable monthly figure.
- **Registry entry:** `{ id: 'insurances', label: 'ביטוחים', icon: Shield, permissionModuleId: 'insurances', usesGlobalFilters: true, filterModuleId: 'insurances' }`.

- [ ] **Step 1: Write the failing tests** — mirror Task 2's suite against `InsurancesService`, plus:
```tsx
it('renders a coverage row for each entry in coverages', async () => {
  mockList.mockResolvedValueOnce([{ id: 'i1', ownerId: 'david-levy', insuredMemberId: 'omer-levy', type: 'health', provider: 'הראל', premium: 200, premiumFrequency: 'monthly', coverages: [{ label: 'אשפוז', amount: 1000000 }], renewalDate: '2099-01-01', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
  render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
  await waitFor(() => expect(screen.getByText('אשפוז')).toBeInTheDocument());
});
it('a renewal date within 30 days shows the "מתחדש בקרוב" badge; one far away does not', async () => {
  const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  mockList.mockResolvedValueOnce([
    { id: 'i1', ownerId: 'david-levy', insuredMemberId: 'david-levy', type: 'car', provider: 'X', premium: 100, premiumFrequency: 'monthly', coverages: [], renewalDate: soon, status: 'active', createdAt: 'x', updatedAt: 'x' },
    { id: 'i2', ownerId: 'david-levy', insuredMemberId: 'david-levy', type: 'home', provider: 'Y', premium: 100, premiumFrequency: 'monthly', coverages: [], renewalDate: '2099-01-01', status: 'active', createdAt: 'x', updatedAt: 'x' },
  ]);
  render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
  await waitFor(() => expect(screen.getAllByText('מתחדש בקרוב')).toHaveLength(1));
});
it('totalPremium divides a yearly premium by 12 before summing with monthly ones', async () => {
  mockList.mockResolvedValueOnce([
    { id: 'i1', ownerId: 'david-levy', insuredMemberId: 'david-levy', type: 'car', provider: 'X', premium: 100, premiumFrequency: 'monthly', coverages: [], renewalDate: '2099-01-01', status: 'active', createdAt: 'x', updatedAt: 'x' },
    { id: 'i2', ownerId: 'david-levy', insuredMemberId: 'david-levy', type: 'life', provider: 'Y', premium: 1200, premiumFrequency: 'yearly', coverages: [], renewalDate: '2099-01-01', status: 'active', createdAt: 'x', updatedAt: 'x' },
  ]);
  render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
  await waitFor(() => expect(screen.getByText(/סך הפרמיה החודשית: ₪200/)).toBeInTheDocument()); // 100 + (1200/12)
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/__tests__/InsurancesScreen.test.tsx`, expect FAIL.

- [ ] **Step 3: Implement `InsurancesScreen.tsx`** — same skeleton as `AccountsScreen.tsx`, `insuredMemberId` select fed by `familyMembers.members`, dynamic `coverages` editor, renewal-soon badge, monthly-equivalent total.

- [ ] **Step 4: Registry + glossary + App.tsx wiring**.

- [ ] **Step 5: Run to verify pass** — `npm run lint && npx vitest run src/__tests__/InsurancesScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts`.

- [ ] **Step 6: Full verification + manual smoke check** — create a policy with two coverage rows and a near-term renewal date, confirm both the coverage list and the renewal badge render; edit to remove a coverage row; confirm the total-premium math with a mixed monthly+yearly pair.

- [ ] **Step 7: Commit**
```bash
git add src/components/InsurancesScreen.tsx src/config/moduleRegistry.ts src/config/glossary.ts src/App.tsx src/__tests__/InsurancesScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts
git commit -m "feat: insurances screen — list/create/edit/delete with insuredMemberId, coverages, renewal callout

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Recurring screen

**Files:**
- Create: `src/components/RecurringScreen.tsx`
- Modify: `src/config/moduleRegistry.ts`, `src/config/glossary.ts`, `src/App.tsx`
- Test: `src/__tests__/RecurringScreen.test.tsx`, `src/__tests__/glossary.test.ts` (extend), `src/__tests__/moduleRegistry.test.ts` (extend)

**Interfaces:**
```ts
export interface RecurringScreenProps {
  session: { memberId: string; role: PermissionRole };
  recurringViewLevel: PermissionLevel | undefined;
  recurringEditLevel: PermissionLevel | undefined;
}
export default function RecurringScreen(props: RecurringScreenProps): React.JSX.Element;
```

Same pattern; this collection's own delta:

- **`kind` (`income`/`expense`)** — a segmented toggle at the top of the form; `category` (a `<select>` from `getCategories()`, matching `FilterBar`'s existing category source) is shown ONLY when `kind === 'expense'` (an income has no expense category — `isValidRecurring` itself only requires `category` when present, never for income).
- **This is the one screen wiring the מה dimension (D5)** — `filters.category.categories` filters the list client-side, same shape as Dashboard's own M1 fix: `filters.category.categories.length === 0 || filters.category.categories.includes(item.category ?? '')`.
- **Status controls** — `active`/`paused`/`ended` shown as a badge with quick-action buttons ("השהה"/"הפעל מחדש") that call `saveRecurring` with only `status` changed (not a full form open), plus the full edit form for everything else.
- **`lastPostedPeriod`** shown per row ("נרשם לאחרונה: {period}", or "טרם נרשם" if absent) — real, useful transparency into the catch-up engine's own state, and the most direct way for David to confirm Task 1's fix actually worked end-to-end for a `'member'`-role session.
- **Uses `saveRecurring` (not the raw `repo.save` re-export)** — `RecurringService.ts` exports `saveRecurring`, not `save`, specifically for the unbounded-backfill guard (Stage 3 D-decision); the screen's submit handler must call `saveRecurring`, never bypass it.
- **Glossary:** `recurring.totalMonthly` — "סך ההתחייבות החודשית מכל התנועות הקבועות שרואים ברשימה — כמה יירשם אוטומטית כל חודש."; excludes `paused`/`ended` items from the sum (a paused item isn't currently committing anything).
- **Registry entry:** `{ id: 'recurring', label: 'תנועות קבועות', icon: Repeat, permissionModuleId: 'recurring', usesGlobalFilters: true, filterModuleId: 'recurring' }`.

- [ ] **Step 1: Write the failing tests** — mirror Task 2's suite against `RecurringService` (using `saveRecurring`, not `save`, in the mock), plus:
```tsx
it('category select only appears for kind "expense"', async () => {
  mockList.mockResolvedValueOnce([]);
  render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" />);
  await waitFor(() => screen.getByTestId('screen.recurring.create'));
  fireEvent.click(screen.getByTestId('screen.recurring.create'));
  fireEvent.click(screen.getByLabelText('הכנסה')); // kind=income
  expect(screen.queryByLabelText('קטגוריה')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('הוצאה')); // kind=expense
  expect(screen.getByLabelText('קטגוריה')).toBeInTheDocument();
});
it('the מה category filter narrows the visible list (D5)', async () => {
  mockList.mockResolvedValueOnce([
    { id: 'r1', ownerId: 'david-levy', kind: 'expense', description: 'חוג', amount: 100, category: 'חינוך', chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    { id: 'r2', ownerId: 'david-levy', kind: 'expense', description: 'מנוי', amount: 50, category: 'בידור', chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
  ]);
  // filters.category.categories = ['חינוך'] via the FilterContext mock
  render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" />);
  await waitFor(() => expect(screen.getByText('חוג')).toBeInTheDocument());
  expect(screen.queryByText('מנוי')).not.toBeInTheDocument();
});
it('totalMonthly excludes paused and ended items', async () => {
  mockList.mockResolvedValueOnce([
    { id: 'r1', ownerId: 'david-levy', kind: 'expense', description: 'A', amount: 100, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    { id: 'r2', ownerId: 'david-levy', kind: 'expense', description: 'B', amount: 999, chargeDay: 1, status: 'paused', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
  ]);
  render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" />);
  await waitFor(() => expect(screen.getByText(/סך ההתחייבות החודשית: ₪100/)).toBeInTheDocument());
});
it('shows lastPostedPeriod per row, or "טרם נרשם" when absent', async () => {
  mockList.mockResolvedValueOnce([
    { id: 'r1', ownerId: 'david-levy', kind: 'expense', description: 'A', amount: 100, chargeDay: 1, status: 'active', startDate: 'x', lastPostedPeriod: '2026-07', createdAt: 'x', updatedAt: 'x' },
    { id: 'r2', ownerId: 'david-levy', kind: 'expense', description: 'B', amount: 50, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
  ]);
  render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" />);
  await waitFor(() => expect(screen.getByText(/נרשם לאחרונה: 2026-07/)).toBeInTheDocument());
  expect(screen.getByText('טרם נרשם')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/__tests__/RecurringScreen.test.tsx`, expect FAIL.

- [ ] **Step 3: Implement `RecurringScreen.tsx`**.

- [ ] **Step 4: Registry + glossary + App.tsx wiring**.

- [ ] **Step 5: Run to verify pass** — `npm run lint && npx vitest run src/__tests__/RecurringScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts`.

- [ ] **Step 6: Full verification + manual smoke check** — create an expense-kind recurring item with a category, confirm it appears in the list and (after a session reload, exercising Task 1's fix live) picks up a `lastPostedPeriod` once the catch-up engine runs; pause it and confirm it drops out of `totalMonthly`.

- [ ] **Step 7: Commit**
```bash
git add src/components/RecurringScreen.tsx src/config/moduleRegistry.ts src/config/glossary.ts src/App.tsx src/__tests__/RecurringScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts
git commit -m "feat: recurring screen — list/create/edit/delete, category filter, status controls

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Net worth resolution — `useNetWorth` hook, Dashboard rewire, dedicated Net Worth screen

**Files:**
- Create: `src/hooks/useNetWorth.ts`, `src/components/NetWorthScreen.tsx`
- Modify: `src/components/Dashboard.tsx`, `src/config/moduleRegistry.ts`, `src/config/glossary.ts`, `src/App.tsx`
- Test: `src/__tests__/useNetWorth.test.ts`, `src/__tests__/NetWorthScreen.test.tsx`, `src/__tests__/Dashboard.*.test.tsx` (extend the existing Dashboard suite's net-worth-card assertions), `src/__tests__/glossary.test.ts` (extend), `src/__tests__/moduleRegistry.test.ts` (extend)

**Interfaces:**
```ts
// src/hooks/useNetWorth.ts
import type { NetWorthResult, NetWorthScope } from '../utils/netWorth';

export interface UseNetWorthResult {
  status: 'loading' | 'error' | 'permission-denied' | 'ready';
  result: NetWorthResult | null;
  error: string | null;
  reload: () => void;
}

/**
 * scope/targetMemberId are ALREADY RESOLVED by the caller (Dashboard or NetWorthScreen) from
 * filters.member + the viewer's own accounts/loans levels — this hook does no permission
 * resolution of its own, only fetch + compute (D3). investmentsReadable is independent: the
 * `investments` collection is ownerless (Stage 2 D5) — only a 'family'-level view grants it,
 * never 'own' — so it cannot be derived from scope/targetMemberId alone.
 */
export function useNetWorth(
  scope: NetWorthScope,
  targetMemberId: string,
  investmentsReadable: boolean
): UseNetWorthResult;

// Maps a NetWorthLineItem's `source` + which side it's on to its glossary id (D4) — exported so
// both NetWorthScreen and Dashboard look up the same id for the same line, never inventing their
// own mapping twice.
export function netWorthGlossaryId(side: 'assets' | 'liabilities', source: string): string;
```

- [ ] **Step 1: Write the failing tests**

`src/__tests__/useNetWorth.test.ts` (mock `AccountsService`/`LoansService`, `firebase/firestore`'s `getDocs`/`getDoc` for `investments`/`settings/ecosystem`):
```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useNetWorth, netWorthGlossaryId } from '../hooks/useNetWorth';

const { mockListAccounts, mockListLoans, mockGetDocs, mockGetDoc } = vi.hoisted(() => ({
  mockListAccounts: vi.fn(), mockListLoans: vi.fn(), mockGetDocs: vi.fn(), mockGetDoc: vi.fn(),
}));
vi.mock('../services/AccountsService', () => ({ listAccounts: mockListAccounts }));
vi.mock('../services/LoansService', () => ({ listLoans: mockListLoans }));
vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => ({ __col: name })),
  doc: vi.fn((_db, ...segs: string[]) => ({ __doc: segs.join('/') })),
  getDocs: mockGetDocs,
  getDoc: mockGetDoc,
}));

describe('useNetWorth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('computes assets minus liabilities from real accounts/loans/investments, archived accounts excluded', async () => {
    mockListAccounts.mockResolvedValueOnce([
      { id: 'a1', ownerId: 'david-levy', name: 'X', type: 'bank', balance: 1000, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' },
      { id: 'a2', ownerId: 'david-levy', name: 'Old', type: 'bank', balance: 5000, balanceUpdatedAt: 'x', status: 'archived', createdAt: 'x', updatedAt: 'x' },
    ]);
    mockListLoans.mockResolvedValueOnce([{ id: 'l1', ownerId: 'david-levy', name: 'X', loanType: 'other', principal: 1000, balance: 400, interestRate: 1, monthlyPayment: 10, startDate: 'x', endDate: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
    mockGetDocs.mockResolvedValueOnce({ docs: [{ data: () => ({ value: 2000 }) }] }); // investments
    mockGetDoc.mockResolvedValueOnce({ exists: () => false }); // settings/ecosystem
    const { result } = renderHook(() => useNetWorth('family', 'david-levy', true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.result!.totalAssets).toBe(3000); // 1000 (archived excluded) + 2000
    expect(result.current.result!.totalLiabilities).toBe(400);
    expect(result.current.result!.netWorth).toBe(2600);
  });

  it('investmentsReadable=false excludes investments without a getDocs call', async () => {
    mockListAccounts.mockResolvedValueOnce([]);
    mockListLoans.mockResolvedValueOnce([]);
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });
    const { result } = renderHook(() => useNetWorth('own', 'omer-levy', false));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(result.current.result!.assets.find((a) => a.source === 'investments')).toBeUndefined();
  });

  it('a permission-denied ecosystem (real estate) read does NOT fail the whole hook — real estate just reads as 0', async () => {
    mockListAccounts.mockResolvedValueOnce([]);
    mockListLoans.mockResolvedValueOnce([]);
    mockGetDoc.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'permission-denied' }));
    const { result } = renderHook(() => useNetWorth('own', 'omer-levy', false));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.result!.assets.find((a) => a.source === 'realEstate')).toBeUndefined();
  });

  it('accounts/loans permission-denied DOES set the whole hook to permission-denied (a central failure, not optional data)', async () => {
    mockListAccounts.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'permission-denied' }));
    const { result } = renderHook(() => useNetWorth('own', 'omer-levy', false));
    await waitFor(() => expect(result.current.status).toBe('permission-denied'));
  });

  it('a genuine connectivity failure on accounts renders error, never resets to an empty/zero result', async () => {
    mockListAccounts.mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => useNetWorth('own', 'omer-levy', false));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.result).toBeNull(); // never a fabricated zeroed NetWorthResult
  });
});

describe('netWorthGlossaryId', () => {
  it('maps side+source to the D4 id scheme', () => {
    expect(netWorthGlossaryId('assets', 'accounts')).toBe('netWorth.assets.accounts');
    expect(netWorthGlossaryId('liabilities', 'loans')).toBe('netWorth.liabilities.loans');
  });
});
```

`src/__tests__/NetWorthScreen.test.tsx` — loading/error/permission-denied/ready states (mocking `useNetWorth`), plus:
```tsx
it('clicking the accounts line navigates to the accounts screen (D8 drill-down)', async () => {
  const navigateTo = vi.fn();
  // useNavigation mocked to { activeTab: 'net-worth', navigateTo }
  render(<NetWorthScreen /* ... */ />);
  await waitFor(() => screen.getByText('חשבונות ומזומן'));
  fireEvent.click(screen.getByText('חשבונות ומזומן'));
  expect(navigateTo).toHaveBeenCalledWith('accounts');
});
it('the real-estate line has no click handler — no screen exists for it yet (disclosed, not fake-clickable)', async () => {
  render(<NetWorthScreen /* result includes a realEstate line */ />);
  await waitFor(() => screen.getByText('נדל״ן'));
  expect(screen.getByText('נדל״ן').closest('button')).toBeNull();
});
it("empty state (accounts/loans genuinely empty) explains why the number is low and links to Accounts", async () => {
  // useNetWorth mocked to a ready result with zero line items
  render(<NetWorthScreen /* ... */ />);
  expect(screen.getByText(/עדיין לא הוזנו חשבונות או הלוואות/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/__tests__/useNetWorth.test.ts src/__tests__/NetWorthScreen.test.tsx`, expect FAIL.

- [ ] **Step 3: Implement `useNetWorth.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { listAccounts } from '../services/AccountsService';
import { listLoans } from '../services/LoansService';
import { computeNetWorth, type NetWorthResult, type NetWorthScope } from '../utils/netWorth';

export interface UseNetWorthResult {
  status: 'loading' | 'error' | 'permission-denied' | 'ready';
  result: NetWorthResult | null;
  error: string | null;
  reload: () => void;
}

function isPermissionDenied(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'permission-denied';
}

const SIDE_BY_SOURCE: Record<string, 'assets' | 'liabilities'> = {
  accounts: 'assets', investments: 'assets', realEstate: 'assets', loans: 'liabilities',
};
export function netWorthGlossaryId(side: 'assets' | 'liabilities', source: string): string {
  return `netWorth.${side}.${source}`;
}
export { SIDE_BY_SOURCE }; // consumed by NetWorthScreen to pick side without re-deriving it

export function useNetWorth(scope: NetWorthScope, targetMemberId: string, investmentsReadable: boolean): UseNetWorthResult {
  const [status, setStatus] = useState<UseNetWorthResult['status']>('loading');
  const [result, setResult] = useState<NetWorthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);

    (async () => {
      // Real estate (settings/ecosystem) is optional, legacy data — a permission-denied on it
      // alone must not fail the whole net-worth calculation (D3); caught independently.
      let realEstateValue = 0;
      let realEstateAsOf = new Date().toISOString();
      try {
        const ecoSnap = await getDoc(doc(db, 'settings', 'ecosystem'));
        if (ecoSnap.exists()) {
          const data = ecoSnap.data() as Record<string, { realEstate?: number }>;
          const bucket = scope === 'own' ? (data[targetMemberId] ?? data.all) : data.all;
          realEstateValue = bucket?.realEstate ?? 0;
        }
      } catch (err: unknown) {
        if (!isPermissionDenied(err)) throw err; // a genuine connectivity failure here still fails the hook
      }

      const [accounts, loans, investmentDocs] = await Promise.all([
        listAccounts(scope, targetMemberId),
        listLoans(scope, targetMemberId),
        investmentsReadable ? getDocs(collection(db, 'investments')) : Promise.resolve(null),
      ]);

      if (cancelled) return;
      const investments = investmentDocs ? investmentDocs.docs.map((d) => ({ value: (d.data().value as number) ?? 0 })) : [];
      const computed = computeNetWorth({
        viewerMemberId: targetMemberId,
        scope,
        accounts: accounts.filter((a) => a.status === 'active'), // D3 — archived accounts excluded
        investments,
        loans,
        realEstateValue,
        realEstateAsOf,
      });
      setResult(computed);
      setStatus('ready');
    })().catch((err: unknown) => {
      if (cancelled) return;
      if (isPermissionDenied(err)) { setStatus('permission-denied'); return; }
      setError('טעינת נתוני השווי הנקי נכשלה. בדוק את החיבור ונסה שוב.');
      setStatus('error');
    });

    return () => { cancelled = true; };
  }, [scope, targetMemberId, investmentsReadable, reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);
  return { status, result, error, reload };
}
```

- [ ] **Step 4: Implement `NetWorthScreen.tsx`**

Resolves `scope`/`targetMemberId`/`investmentsReadable` from `useGlobalFilters()` + the viewer's own levels (props, same shape as the other four screens), then renders `useNetWorth`'s result: headline number, an assets list and a liabilities list (each line = label + amount + `<Explain id={netWorthGlossaryId(side, item.source)} />`), each line except `realEstate` wrapped in a `navigateTo(...)` button per D8 (`accounts` → `'accounts'`, `investments` → `'investments'`, `loans` → `'loans'`). Empty state fires when `result.assets.length === 0 && result.liabilities.length === 0` (or effectively zero-value defaults), with the copy asserted by the test above and a `navigateTo('accounts')` call-to-action button.

```tsx
export interface NetWorthScreenProps {
  session: { memberId: string; role: PermissionRole };
  accountsViewLevel: PermissionLevel | undefined;
  loansViewLevel: PermissionLevel | undefined;
  investmentsViewLevel: PermissionLevel | undefined;
}
export default function NetWorthScreen({ session, accountsViewLevel, loansViewLevel, investmentsViewLevel }: NetWorthScreenProps) {
  const { filters } = useGlobalFilters();
  const { navigateTo } = useNavigation();

  // D3 — a single specific member selected drills into THAT member's own accounts+loans; every
  // other selection (all/multi/group) falls back to the viewer's own default scope.
  const singleSelected = filters.member.mode === 'members' && filters.member.memberIds.length === 1
    ? filters.member.memberIds[0] : null;
  const accountsScope = resolveOwnedModuleScope(session.role, accountsViewLevel);
  const loansScope = resolveOwnedModuleScope(session.role, loansViewLevel);
  const scope: NetWorthScope = singleSelected ? 'own' : (accountsScope === 'family' && loansScope === 'family' ? 'family' : 'own');
  const targetMemberId = singleSelected ?? session.memberId;
  const investmentsReadable = session.role !== 'member' || investmentsViewLevel === 'family';

  const { status, result, error } = useNetWorth(scope, targetMemberId, investmentsReadable);
  // ...loading/error/permission-denied branches identical in shape to the other four screens...
  // ...ready branch renders result.assets / result.liabilities via netWorthGlossaryId + navigateTo...
}
```

- [ ] **Step 5: Rewire Dashboard onto `useNetWorth`, retire the ecosystem-arithmetic net-worth card + five-tile panel**

In `src/components/Dashboard.tsx`:
- Delete `EcosystemData`/`EMPTY_ECOSYSTEM`, the `ecosystem`/`ecosystemLoadError`/`ecosystemAccessDenied` state, `loadEcosystem`'s effect, `totalAssets`/`totalLiabilities`/`netWorth`'s local arithmetic, `showEcosystemAllFallbackNote`, and the five-tile "התגלגלות נכסים" JSX block.
- Replace with: `const netWorth = useNetWorth(scope, targetMemberId, investmentsReadable)` (same scope/target resolution as `NetWorthScreen`'s Step 4 — Dashboard reads `filters.member` the same way) and render `netWorth.result`'s headline + assets/liabilities exactly as `NetWorthScreen` does, wrapped in the same three-way loading/error/permission-denied branch already present for the card today (S2-compliant, unchanged shape).
- The `<Explain id="dashboard.netWorth" />` trigger stays on the headline; new `<Explain id={netWorthGlossaryId(...)} />` triggers replace the old five `dashboard.ecosystem.*` ones on whatever line items actually render.
- D8 drill-down on this card: the whole card becomes a `navigateTo('net-worth')` button (the simplest, most honest drill-down for a summary card — clicking it opens the full breakdown screen rather than trying to reproduce every line's own individual click target twice).

Add the `'net-worth'` `MODULE_REGISTRY` entry: `{ id: 'net-worth', label: 'שווי נקי', icon: Landmark, permissionModuleId: null, usesGlobalFilters: true, filterModuleId: null }` (D2 — ungated per Stage 3 D4, no single dead-end-filtering module).

- [ ] **Step 6: Glossary rewrite (D4)**

In `src/config/glossary.ts`, remove `dashboard.ecosystem.liquid`/`.investments`/`.pensions`/`.crypto`/`.realEstate`; rewrite `dashboard.netWorth`; add `netWorth.assets.accounts`/`netWorth.assets.investments`/`netWorth.assets.realEstate`/`netWorth.liabilities.loans`:
```ts
'dashboard.netWorth': {
  id: 'dashboard.netWorth', title: 'שווי נקי',
  explanation: 'זה כל מה ששווה למשפחה (או לך, לפי הבחירה למעלה) פחות כל מה שחייבים.',
  howComputed: 'מחברים את כל החשבונות, ההשקעות והנדל״ן, ומחסירים מהסכום את יתרת ההלוואות.',
  source: 'החשבונות וההלוואות שהוזנו במסכים המתאימים, ההשקעות שהוזנו במערכת, והנדל״ן שהוזן בעבר.',
  asOf: 'נכון לרגע העדכון האחרון של כל אחד מהמרכיבים בנפרד',
},
'netWorth.assets.accounts': {
  id: 'netWorth.assets.accounts', title: 'חשבונות ומזומן',
  explanation: 'זה סך היתרות בכל החשבונות הפעילים.',
  howComputed: 'מחברים את היתרה העדכנית של כל חשבון פעיל. חשבון בארכיון לא נכלל.',
  source: 'מסך החשבונות', asOf: 'מתעדכן בכל עריכת יתרה',
},
'netWorth.assets.investments': {
  id: 'netWorth.assets.investments', title: 'השקעות ופנסיה',
  explanation: 'זה השווי הכולל של תיקי ההשקעות והפנסיה.',
  howComputed: 'מחברים את השווי העדכני שדווח עבור כל תיק שהוזן.',
  source: 'מסך תיק ההשקעות', asOf: 'אין תאריך עדכון פרטני לכל השקעה עדיין',
},
'netWorth.assets.realEstate': {
  id: 'netWorth.assets.realEstate', title: 'נדל״ן',
  explanation: 'זה השווי המוערך של נדל״ן שבבעלות המשפחה.',
  howComputed: 'לוקחים את השווי שהוזן בעבר עבור הנדל״ן.',
  source: 'ערך שהוזן ידנית בעבר במערכת הישנה', asOf: 'אין תאריך עדכון פרטני לנדל״ן עדיין, בשונה מחשבונות והלוואות',
},
'netWorth.liabilities.loans': {
  id: 'netWorth.liabilities.loans', title: 'הלוואות וחובות',
  explanation: 'זה סך היתרה שנשארה לשלם על כל ההלוואות, כולל משכנתא אם נרשמה כהלוואה.',
  howComputed: 'מחברים את היתרה שנשארה לשלם על כל הלוואה פעילה.',
  source: 'מסך ההלוואות', asOf: 'מתעדכן בכל עריכת יתרה',
},
```
Update `glossary.test.ts`'s `REQUIRED_IDS` (remove the five `dashboard.ecosystem.*` ids, add the four `netWorth.*` ids + `loans.totalBalance`/`accounts.totalBalance`/`insurances.totalPremium`/`recurring.totalMonthly` from Tasks 2–5 if not already appended there) and its real-estate-specific test — replace the mortgage-double-count assertion with:
```ts
it('the real-estate entry discloses it has no per-item freshness date the way accounts/loans do', () => {
  expect(GLOSSARY['netWorth.assets.realEstate'].asOf).toMatch(/אין תאריך עדכון פרטני/);
});
```

- [ ] **Step 7: App.tsx wiring for `'net-worth'`**

```tsx
case 'net-worth': return (
  <NetWorthScreen
    session={{ memberId: session.memberId!, role: session.role! }}
    accountsViewLevel={permState.resolvedPermissions?.accounts?.view}
    loansViewLevel={permState.resolvedPermissions?.loans?.view}
    investmentsViewLevel={permState.resolvedPermissions?.investments?.view}
  />
);
```

- [ ] **Step 8: Run to verify pass**

Run: `npm run lint && npx vitest run src/__tests__/useNetWorth.test.ts src/__tests__/NetWorthScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts`. Then run the existing Dashboard test suite and fix every net-worth/ecosystem-tile assertion broken by the rewire (expected — those tests exercised code this step deletes; per this project's TDD discipline, update them to assert the NEW behavior, don't delete the coverage).

- [ ] **Step 9: Full verification + manual smoke check**

Run: `npm run lint && npm test`. Sign in as David with zero accounts/loans entered: confirm Dashboard's net-worth card and the Net Worth screen BOTH show the same (low, honest) number and the same empty-state guidance — never two different figures for the same concept. Add an account and a loan; confirm both screens update to the same new number. Click the net-worth card from Dashboard; confirm it opens the Net Worth screen; click "חשבונות ומזומן" there; confirm it opens Accounts.

- [ ] **Step 10: Commit**
```bash
git add src/hooks/useNetWorth.ts src/components/NetWorthScreen.tsx src/components/Dashboard.tsx src/config/moduleRegistry.ts src/config/glossary.ts src/App.tsx src/__tests__/useNetWorth.test.ts src/__tests__/NetWorthScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts src/__tests__/Dashboard.globalFilters.test.tsx
git commit -m "feat: wire computeNetWorth as the sole net-worth source — Dashboard rewire + dedicated Net Worth screen

Closes the Stage 4 Task 5 review's flagged dead code (computeNetWorth had zero call sites).
Retires Dashboard's parallel settings/ecosystem-arithmetic net-worth card and its five-tile
panel — one calculation source per metric (spec §5.5), not two.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Spec §5.1 drill-down on Dashboard's remaining cards

**Files:**
- Modify: `src/components/Dashboard.tsx`
- Test: `src/__tests__/Dashboard.*.test.tsx` (extend)

**Interfaces:** no new exports — this task adds `onClick`/`navigateTo` wiring to existing JSX only. `useNavigation()` (already imported by `App.tsx`; Dashboard gains its own `const { navigateTo } = useNavigation();`).

- [ ] **Step 1: Write the failing tests**

Extend Dashboard's test suite:
```tsx
it('clicking the "סך ההוצאות" KPI card navigates to the expenses screen (D8)', async () => {
  // navigateTo mocked via useNavigation
  render(<Dashboard />);
  await waitFor(() => screen.getByTestId('kpi.totalExpenses'));
  fireEvent.click(screen.getByTestId('kpi.totalExpenses'));
  expect(mockNavigateTo).toHaveBeenCalledWith('expenses');
});
it('clicking the "מי הוציא כמה החודש" comparison card navigates to the expenses screen', async () => {
  render(<Dashboard />);
  await waitFor(() => screen.getByTestId('card.comparison'));
  fireEvent.click(screen.getByTestId('card.comparison'));
  expect(mockNavigateTo).toHaveBeenCalledWith('expenses');
});
it('a permission-denied KPI card is NOT clickable — navigating to a screen the viewer cannot see is worse than a dead card', async () => {
  // budgetAccessDenied=true fixture
  render(<Dashboard />);
  await waitFor(() => screen.getByTestId('kpi.totalExpenses'));
  expect(screen.getByTestId('kpi.totalExpenses').tagName).not.toBe('BUTTON');
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run` against the Dashboard suite, expect the three new cases FAIL.

- [ ] **Step 3: Implement**

Wrap each of the four KPI cards (`dashboard.totalIncome`→`'expenses'` is wrong, income has no dedicated screen this stage — totalIncome and monthlyBalance stay NON-clickable, disclosed below; `totalExpenses`/`plannedBudget`→`navigateTo('expenses')`) and the settlement/`ComparisonTable` card (→`navigateTo('expenses')`) in a `<button>` (not a `<div onClick>` — real keyboard/focus semantics) ONLY when that card's own access/error state is `'ready'` (never a clickable card that would navigate into a screen showing the same denial). Add `data-tour-id`/`data-testid` per D12's convention (`kpi.totalExpenses`, `kpi.plannedBudget`, `card.comparison`).

- [ ] **Step 4: Run to verify pass** — `npm run lint && npm test`.

- [ ] **Step 5: Full verification + manual smoke check**

Sign in as David; click every clickable Dashboard card in turn; confirm each opens the right screen with the current מי selection preserved (D8 — no bridge needed, same global state). Confirm `totalIncome`/`monthlyBalance` render as plain (non-button) cards, and that this is visually unsurprising (no ghost hover state implying they're clickable when they aren't).

- [ ] **Step 6: Commit**
```bash
git add src/components/Dashboard.tsx src/__tests__/Dashboard.globalFilters.test.tsx
git commit -m "feat: spec §5.1 drill-down — Dashboard's expense/budget/comparison cards become navigation buttons

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Stage-5 Done Criteria

- Four new CRUD screens (`AccountsScreen`/`LoansScreen`/`InsurancesScreen`/`RecurringScreen`) exist, each honoring the permission matrix's own/family split via the new scope-aware `list()` (D1), each defaulting `ownerId` to the acting session with a family-level-only override (D7), each with loading/empty/error/permission-denied states genuinely distinct (never a permission refusal rendered as an error or a silent empty list), each mounted on the global `FilterBar` (D5) and carrying `data-tour-id`s.
- `computeNetWorth()` is no longer dead code — it is the sole net-worth calculation for both Dashboard's net-worth card and the new dedicated Net Worth screen (D3), verified to show the SAME number for the SAME selection on both screens.
- Spec §5.1 drill-down is real: every Dashboard card whose destination screen exists and is currently accessible to the viewer is a `navigateTo(...)` button; a denied/erroring card is deliberately NOT clickable.
- Every new glossary entry (`accounts.totalBalance`, `loans.totalBalance`, `insurances.totalPremium`, `recurring.totalMonthly`, `netWorth.assets.accounts`/`.investments`/`.realEstate`, `netWorth.liabilities.loans`, rewritten `dashboard.netWorth`) passes `violatesPlainLanguage` and is verified against the actual code path it describes (the Stage 4 lesson — two entries shipped factually wrong before review caught it).
- The four-collection list-query gap (D1) is proven closed against the live emulator, not just mocks (Task 1 Step 5).
- `npm run lint`, `npm test`, and `npm run test:rules` (or emulator-equivalent) all pass; `git status` clean.
- The app is usable after every single task.
- **Product-metric acceptance, verified as the literal last Done step:**
  - **Cold-reader walkthrough:** someone who hasn't seen this stage's work opens each of the five new screens plus the rewired Dashboard net-worth card and, using only the `<Explain>` triggers, correctly explains in their own words what every new figure means and where it comes from.
  - **20-member usability spot-check:** with the existing 20-member/multi-group fixture (Stage 4), confirm each new screen's list stays usable (no unbounded flat list, no unreadable table) — these four collections are typically small per-family (a handful of accounts/loans/policies), so this is a lighter check than Stage 4's `MemberMultiSelect`/`ComparisonTable` fixture test, but the FilterBar מי control mounted on every new screen inherits Stage 4's large-family treatment automatically (D5 — shared component, not reinvented).
  - **Consolidated end-of-stage demo script** (spec §16, every stage): sign in as David → open Accounts, create two accounts for different family members → open Loans, create a mortgage and confirm the payoff progress renders → open Insurances, create a policy with two coverages and a near-term renewal date, confirm the "מתחדש בקרוב" badge → open Recurring, create an expense-kind item with a category → open the Net Worth screen, confirm the headline number matches Dashboard's net-worth card exactly, and that it reflects the accounts/loans just entered → click each net-worth line's drill-down (accounts/investments/loans) and confirm it opens the right screen → back on Dashboard, click the expense KPI card and the "מי הוציא כמה החודש" card, confirm both navigate correctly → sign in as a `'member'`-role fixture with `accounts:{view:'own',edit:'own'}` and nothing else granted → confirm they see only their own account on the Accounts screen (never a permission-denied wholesale failure — the Task 1 fix, proven live) → confirm the Net Worth screen shows their own scoped figure, not the family total → confirm they cannot see an `OwnerPicker` select on any create form.
  - **Surface to David, not silently resolved:** the "יתרה חודשית" (Dashboard KPI label) vs "מאזן חודשי" (glossary title) synonym pair — untouched by this stage's own work, flagged again per the Stage 4 precedent for exactly this kind of call.

## Risks

- **`settings/ecosystem`'s `liquid`/`investments`/`pensions`/`crypto`/`mortgage` fields become orphaned, unread data after this stage** (D3) — not deleted (no delete tooling exists for a settings doc in this project). A small, harmless dead weight, not a rot risk (one document, not per-row bloat); flagged for a future "הגדרות מערכת" cleanup screen, unscheduled.
- **Net worth will visibly drop for any family with real ecosystem data but zero accounts/loans entered** (D3) — an intentional, disclosed consequence of retiring the parallel ecosystem calculation, not a bug, but the single most likely thing to make David think something broke on first look. The Net Worth screen's empty-state copy and the demo script's own walkthrough order (enter data BEFORE looking at the net-worth number) are the mitigation; there is no code-level safety net beyond that.
- **`NetWorthScreen`'s scope-resolution when the viewer's own `accounts`/`loans` levels genuinely differ** (e.g. `'family'` on accounts, `'own'` on loans) **collapses to the more restrictive `'own'`** (Task 6 Step 4) rather than a mixed-scope call `computeNetWorth` has no input shape for. A real, disclosed simplification — the alternative (extending `NetWorthInput` with per-source scope) is a `netWorth.ts` interface change with no second consumer yet to justify it; revisit if a real permission split like this shows up in practice.
- **The recurring catch-up engine's own permission interaction** (documented in `RecurringService.ts`'s header comment, unchanged by this stage beyond the D1 scope fix): posting a recurring INCOME still needs family-level edit on `'income'` specifically (an ownerless module, Stage 2 D5) — a `'member'`-role user can define their own recurring income but their own session can never post it; it posts once a parent/super-admin session next opens the app. Pre-existing, unrelated to this stage's fix, restated here because `RecurringScreen` (Task 5) is the first UI surface where a member might notice their income item never shows a `lastPostedPeriod`.
- **`InsurancesScreen`'s `documentId` field is display-only this stage** — no document picker, no Drive linking. The `ארכיון מסמכים` module (spec §12) that would make this real is unscheduled in the 11-stage roadmap; disclosed rather than half-built.
- **Four new screens each do their own client-side `filters.category`/`filters.member` filtering over an already-fetched list**, not a server-side query — fine at this collection's realistic scale (a handful of accounts/loans/policies/recurring items per family), unlike `transaction_lines`' hundreds-to-thousands-of-rows scale where the same pattern (D9's deferred fix) is a genuine concern. Not the same risk class; not tracked as a carry-forward.
- **`useNetWorth`'s real-estate read still depends on `settings/ecosystem` staying reachable at all** — if a future stage deletes or further restricts that document without updating this hook, real estate silently (and correctly, per this hook's own permission-denied handling) drops to 0 rather than erroring loudly. Intentional per D3, but worth a reviewer's eye whenever `settings/ecosystem` is next touched.

## Self-review against spec §5/§6/§7

- §5.1 (מבט אחד ואשכולות — one glance, numbers as drill-down buttons): **built this stage** (Task 7 + Task 6's net-worth-line drill-down) — the item the Stage 4 four-lens review found homeless and the roadmap named to this stage explicitly. Scoped to cards whose destination screen exists AND is currently accessible; a card with no live destination (income, monthly balance) stays a plain, honestly-non-interactive card rather than a fake button.
- §5.3 (פילטרים גלובליים דביקים — sticky, affects everything): five more screens rewired onto `FilterContext` this stage (D5, D7-flip-in-same-commit per Stage 4's own rule), on top of Stage 4's Dashboard-only start. Six of the app's twelve module screens now share global filters; the remaining six (`expenses`/`central-expenses`/`annual`/`investments`/`future`/`folder`) are explicitly out of this stage's scope, named as a future flip, not silently left behind.
- §5.4 (large-family display): every new screen's מי control is `FilterBar`'s existing `MemberMultiSelect`, inheriting Stage 4's 20-member search/collapse treatment for free — no new large-family code needed or written.
- §5.7 (loading/empty/error/permission-denied, failed read ≠ empty): the S2 rule, re-broken in every prior stage, is a named checklist item in every one of this stage's seven tasks, not a global aspiration repeated once and hoped for.
- §6 (module map — five new registry entries: `accounts`, `loans`, `insurances`, `recurring`, `net-worth`; "הוספת מודול עתידי = רישום + מסך" honored — each is exactly one `MODULE_REGISTRY` entry + one `renderContent` case, per Stage 4's own disclosed one-line-per-screen gap, unchanged and re-confirmed by the exhaustiveness guard tripping correctly on all five additions).
- §7 (data model — `accounts`/`loans`/`insurances`/`recurring` collections): all four finally have a UI; the D1 fix ensures that UI actually works for every permission level the matrix supports, not just `'family'`/bypass roles, which is what every existing rules test happened to exercise until this stage's own emulator-backed addition.
- §10 (forecast, layer-1 inputs): explicitly untouched — `computeNetWorth`'s provenance metadata (`source`/`asOf` per line) that this stage finally renders is the same metadata Stage 3 built specifically anticipating Stage 7's forecast layer; no forecast logic is added here.

## Open questions: none
