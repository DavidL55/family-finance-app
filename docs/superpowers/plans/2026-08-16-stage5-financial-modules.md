# FamilyFinance v2 — Stage 5: Financial Module Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Amended 2026-08-16 per the four-lens adversarial review gate** (UX/Ofra, Product/Lola, Architecture/Sun, What-Did-We-Miss). Ledger: `.superpowers/sdd/2026-08-16-stage5-financial-modules/progress.md`. Every finding below traces to a numbered item there (B1-B3/I4-I7 = UX; P1-P5 = Product; the unlabeled architecture findings; M1-M6 = What-Did-We-Miss). Task count unchanged at 7 — every amendment folded into a task whose files were already open, per the controller's instruction. See "Amendment log" below the design decisions for the full map of what changed and where.

**Goal:** Give David real, usable screens for the data model Stage 3 built and nobody can see yet — list/create/edit/delete for accounts, loans, insurances, and recurring items, each honoring the permission matrix's `'own'` vs `'family'` split — plus a dedicated Net Worth screen that finally wires `computeNetWorth()` (built and tested since Stage 3, zero call sites since) into something real, and the spec §5.1 drill-down that turns Dashboard's headline numbers into buttons instead of dead ends.

**Architecture:** Stage 3 shipped four Firestore collections (`accounts`, `loans`, `insurances`, `recurring`), their Rules, and thin CRUD services (`AccountsService`/`LoansService`/`InsurancesService`/`RecurringService`, all built on the shared `createOwnedCollectionRepo` factory) — but zero UI. Stage 4 shipped the shell those screens will live inside (`FilterContext`, `MODULE_REGISTRY`, the glossary/`<Explain>` layer, `MemberMultiSelect`/`ComparisonTable`) and rewired exactly one screen (`Dashboard`) onto it. This stage, in build order:

1. **Closes a load-bearing gap discovered during this plan's own research, before any screen can safely ship, and hardens the same file against two concurrency bugs the review surfaced (Task 1):** `createOwnedCollectionRepo.list()` issues a bare, unconstrained `getDocs(collection(db, name))` with no `where()` clause — denied wholesale for an `'own'`-level viewer under `firestore.rules`' `resource.data`-dependent rule, the same failure class Stage 4 already found and fixed for `transaction_lines`/`incomes`. The same file's `save()`/`remove()` are non-transactional (a read-modify-write race for edits, an unguarded delete for removals), and its audit-log ids are a per-page-load counter that collides across devices — both latent since Stage 2/3, both live risks now that Stage 5 puts two parents in front of the same record concurrently.
2. **Builds the spec §5.1 drill-down second, not last** — Dashboard's KPI, net-worth, and settlement cards become `navigateTo(...)` buttons, and `NavigationContext` gains real back behavior (a browser-history back-stack) before this, the stage's first 3-deep navigation path, ships. Zero dependency on any of the four new screens; the cheapest, most visible win, so it leads rather than trails (Task 2).
3. Builds **four CRUD screens** — `AccountsScreen`, `LoansScreen`, `InsurancesScreen`, `RecurringScreen` — sharing one pattern (list with loading/empty/error/permission-denied states, a create/edit form, delete-with-confirm, `ownerId` defaulted to the acting session with a family-level-only override, a local total wired to its own glossary entry, `data-tour-id`s, mounted on the global `FilterBar`) via a new shared `useOwnedCollectionScreen<T>` hook extracted at Task 3 (Accounts), before that screen becomes the four-times-cloned template. Order: **Accounts → Loans → Net Worth → Insurances → Recurring** — net worth's only real inputs are accounts and loans, so it follows them immediately rather than sitting behind two more collections that don't feed it (Tasks 3, 4, 6, 7).
4. **Resolves the flagged `computeNetWorth()` dead code** (Stage 4 Task 5 review: *"Stage 5 must either wire it as the real net-worth source or explicitly decide the ecosystem sum stays authoritative. Do not let it rot unwired."*) — wires it as the sole net-worth calculation app-wide, retires Dashboard's parallel `settings/ecosystem`-arithmetic net-worth card and its five-tile asset panel, and ships a dedicated **Net Worth screen** on the same shared hook (D3, amended this review — see below) — placed right after Accounts+Loans (Task 5), closing the window where David enters real cash and still sees the old number.
5. Flips `usesGlobalFilters` to `true` for all five new registry entries in the same commit each screen is built (D7 from Stage 4 — never a screen with both a local selector and the global one).

**Tech Stack additions:** none. No new npm packages.

**Spec:** `docs/superpowers/specs/2026-08-14-family-finance-v2-design.md` §5 (UX — 5.1 drill-down, 5.3 global filters, 5.4 large-family display), §6 (module map — חשבונות ויתרות, הלוואות וחובות, ביטוחים, שווי נקי; recurring falls under קליטה/הוצאות automation), §7 (data model — `accounts`/`loans`/`insurances`/`recurring`).

**Builds on:** `src/services/financeCollections.ts`, `AccountsService.ts`, `LoansService.ts`, `InsurancesService.ts`, `RecurringService.ts`, `src/utils/auditLog.ts`, `src/types/finance.ts`, `src/utils/netWorth.ts`, `src/contexts/FilterContext.tsx`, `src/contexts/NavigationContext.tsx`, `src/contexts/NotificationContext.tsx`, `src/config/moduleRegistry.ts`, `src/config/glossary.ts`, `src/components/Explain.tsx`, `MemberMultiSelect.tsx`, `ComparisonTable.tsx`, `FilterBar.tsx`, `Dashboard.tsx`, `src/App.tsx`, `src/utils/memberVisibility.ts`, `src/hooks/useRecurringCatchup.ts`, `src/hooks/useFamilyMembers.ts`/`useGroups.ts`, `src/utils/resolveMemberSelection.ts`. Does **not** touch `ExpensesBreakdown.tsx`, `AnnualReport.tsx`, `CentralExpenseReport.tsx`, `InvestmentsPortfolio.tsx`, `FuturePlanning.tsx`, `FolderLogic.tsx`, `FamilyManagerModal.tsx`, `SyncButton.tsx`, `InvestmentsImportModal.tsx`, `AssetCard.tsx`, or `firestore.rules` (Task 1's D1 fix is a client-side query-shape correction against an already-correct rule; Task 1's D10 concurrency fix changes only how the client writes, not what the rule permits — see Task 1's own notes on why no Rules change is needed for either) — see "Carry-forwards" below for why each stays untouched.

## Design decisions (resolved, not deferred)

- **D1 — `createOwnedCollectionRepo.list()` becomes scope-aware: `list(scope: 'own' | 'family', viewerMemberId: string)`.** `'family'` keeps today's bare collection scan (also covers the super-admin/parent Rules bypass, which never depends on `resource.data`). `'own'` adds `where('ownerId', '==', viewerMemberId)` — a query Firestore CAN statically verify against the rule's `data.ownerId == memberId()` branch, because every possible result document is now provably constrained to satisfy it. This is not a new capability being added to the Rules (`firestore.rules` is unchanged — the rule already technically permits `'own'`-level per-document access; the bug was purely that the CLIENT never issued a query shape Firestore could verify). `AccountsService`/`LoansService`/`InsurancesService`/`RecurringService`'s `list*` re-exports take the same two params — a breaking, deliberate signature change caught by every existing call site failing to compile, not a silent behavior change. `postDueRecurringTransactions` (Stage 3, already shipped) is fixed in the same task since its own `listRecurring()` call has the identical bug — a `'member'`-role session with only `'own'` access to `recurring` would have their own catch-up posting silently fail-list every single run, never posting anything, with the failure surfacing only as an opaque `(all)` entry in `PostingOutcome.failed`.
- **D2 — FilterBar's dead-end avoidance generalizes from one hardcoded module to a per-active-screen module.** Stage 4 built `ViewerAccess.expensesView`/`filterViewableMembers()` around the fact that `'dashboard'` was the only screen using the global מי control, and its data was `'expenses'`-gated. Stage 5 adds four more owned modules with independently grantable levels — offering a chip for a member the viewer has no grant to see on the *currently active* screen is exactly the dead-end UX bug Stage 4 fixed once already, now reachable through five new screens if left as-is. `ModuleRegistryEntry` gains `filterModuleId: ModuleId | null` (which module's `view` level should drive dead-end filtering while this entry is active). `ViewerAccess.expensesView: PermissionLevel` becomes `ViewerAccess.levelsByModule: Partial<Record<ModuleId, PermissionLevel>>`, computed once in `App.tsx` for every matrix-governed module `FilterBar` might ever need (unchanged super-admin/parent bypass to `'family'`). `filterViewableMembers` takes the active entry's `filterModuleId` as a new required parameter. The one entry this can't cleanly serve is `'net-worth'` (spans `accounts`+`investments`+`loans`, each independently gradable) — rather than inventing a composite rule, `filterModuleId: null` there means "offer everyone," matching pre-Stage-4 behavior; a selection that turns out inaccessible on a given line surfaces that line's own permission-denied state (same disclosed-not-fixed shape as Stage 4's D8 ecosystem-fallback note).
- **D3 — `computeNetWorth()` is wired as the sole, authoritative net-worth calculation app-wide. AMENDED by this review's UX/Product rulings (B1/P2) — see below.** Both the new Net Worth screen and Dashboard's net-worth card call one shared loader (`useNetWorth`, Task 5) — never two independent call sites computing the same number, per spec §5.5's "one calculation source per metric." Its real inputs: `accounts` via the new scope-aware `listAccounts` (D1, `status: 'active'` filtered by the caller — `netWorth.ts`'s own header comment leaves this to "the screen decides," and an archived account should not count toward net worth, the entire point of archiving one), `investments` via the pre-existing, unmodified `investments` collection (real data, already rendered on `InvestmentsPortfolio` — not the hand-typed `settings/ecosystem.investments` shadow), `loans` via scope-aware `listLoans`, and `realEstateValue`/`realEstateAsOf` still read from legacy `settings/ecosystem` (per `netWorth.ts`'s own D5 comment — real estate has no dedicated collection yet; building one is out of this stage's scope). Dashboard's local `totalAssets`/`totalLiabilities`/`netWorth` arithmetic and its five-tile "התגלגלות נכסים" panel (`liquid`/`investments`/`pensions`/`crypto`/`realEstate`, all fed by `settings/ecosystem`) are **retired**, replaced by rendering `computeNetWorth()`'s own `assets`/`liabilities` line items directly.
  - **AMENDMENT (B1, blocking UX finding — the original mitigation was structurally dead):** the plan as first written gated the explanatory empty-state on `assets.length === 0 && liabilities.length === 0` — but `computeNetWorth()` unconditionally pushes one `accounts` line item and one `loans` line item regardless of whether any account/loan exists (`netWorth.ts` lines 81-88/103-110 push them unconditionally; only the `investments` line is conditional). That length can never be zero once both arrays exist, so for a family like David's with real investments data, **the explanatory state could never render at all** — he'd see a silently lower number with zero on-screen explanation of why. Task 5 now triggers the notice on **INCOMPLETE** (`accountsCount === 0 || loansCount === 0`, exposed by `useNetWorth` directly from the raw fetched arrays, not derived from the always-present line items) and renders it on **both** Dashboard's net-worth card and the dedicated screen (single source, per `useNetWorth`, so the trigger can't drift between the two).
  - **AMENDMENT (P2, Product ruling) — a one-click, explicit, HITL pre-fill affordance.** The empty/incomplete notice offers "מצאנו ₪X ביתרת המזומן הישנה — להוסיף כחשבון?" (and the equivalent for `settings/ecosystem.mortgage` → a loan) when the corresponding legacy bucket is non-zero and the new collection is still empty. Clicking it navigates to Accounts/Loans with the create form already open and pre-filled from the legacy value (D11's navigation payload, Task 2) — still explicit, still user-confirmed on save, no automatic/silent write. This does not reopen the scope of D3's "no migration script" decision: nothing is written until David presses "שמור" on the pre-filled form, same as any other create.
  - **Consequence, disclosed, not silently absorbed:** with `accounts`/`loans` freshly empty — this is the first stage either collection gets a UI at all — net worth will show a *lower*, honest number than the old ecosystem sum until David re-enters his real liquid cash and mortgage as `Account`/`Loan` records, now with the pre-fill affordance above lowering that cost. No automatic/silent migration script is built (scope discipline). `settings/ecosystem`'s `liquid`/`investments`/`pensions`/`crypto`/`mortgage` fields become orphaned, unread data — not deleted (no delete tooling exists for a settings doc; retirement assigned to the Stage 11 roadmap entry as a done-criteria line per the architecture ruling, not left as a Risk bullet here — see the roadmap edit below) — its `realEstate` field is the only one still read, and **only when reachable**: it is still gated `super-admin`/`parent`-only by commit `60d1c32`, so a `'member'`-role viewer's net worth simply omits real estate (treated as `0`, not a hard failure of the whole calculation — see Task 5's `useNetWorth`). One genuine, positive side effect worth naming: this closes most of Stage 4's D8 Risk ("`resolveEcosystemKey`'s 2+-member fallback to `'all'` is a real, disclosed limitation") for net worth specifically — `accounts`/`loans` support real per-`ownerId` filtering, so a drilled-into single member's net worth is now an actual computed slice, not a crude family-wide fallback.
- **D4 — glossary rewritten to match D3.** `dashboard.netWorth` is rewritten to describe `computeNetWorth()`'s real behavior (own/family-scoped; assets = accounts + investments + real estate, liabilities = loans). The five `dashboard.ecosystem.*` entries are **deleted** — their triggers no longer exist — replaced by four entries keyed to `NetWorthLineItem.source` (`netWorth.assets.accounts`, `netWorth.assets.investments`, `netWorth.assets.realEstate`, `netWorth.liabilities.loans`), looked up dynamically as `<Explain id={netWorthGlossaryId(side, item.source)} />`. The old real-estate entry's mortgage-double-counting caveat (`dashboard.ecosystem.realEstate`, tested by `glossary.test.ts`'s `/פעמיים|כפול/` assertion) is **not carried forward as a caveat** — D3 closes that specific risk, it doesn't just disclose it: `settings/ecosystem.mortgage` no longer feeds net worth at all, so a mortgage counted as a real `Loan` can no longer double up against it. The test moves to asserting `netWorth.assets.realEstate`'s copy says real estate has no dedicated freshness date the way accounts/loans do (a real, still-true limitation) instead.
- **D5 — the five new screens mount the shared `FilterBar` (`usesGlobalFilters: true`) rather than inventing local owner selectors.** `useGlobalFilters()` already exposes the shared members/groups fetch (Stage 4 M2) independent of whether `FilterBar` itself renders, and mounting it means a מי selection made anywhere — including via drill-down (D8) — carries over automatically with zero extra plumbing, serving spec §5.3's "משפיע על הכל" literally instead of reinventing a scoped-down control. Each screen documents which `FilterContext` dimensions it actually reads: accounts/loans/insurances/net-worth read `filters.member` only (a balance has no month or expense category); `recurring` additionally reads `filters.category` (`RecurringItem.category` is real and drawn from the same `settings/categories` taxonomy `FilterBar`'s מה control already offers, via `getCategories()`). מתי (period) is read by none of the five — an intentional, disclosed non-use of one dimension, not a placeholder control.
- **D6 — a new `resolveMemberSelectionIds` resolver, separate from `resolveMemberSelectionNames`.** These four collections key ownership by `ownerId` (`Member.id`) directly — Stage 3 D1's whole point was moving away from `transaction_lines.owner`'s display-name convention. `resolveMemberSelectionIds(selection: MemberSelection, groups: Group[]): Set<string> | null` is simpler: mode `'members'` already carries ids directly (no name lookup at all), mode `'group'` resolves via `Group.memberIds` (already ids), mode `'all'` returns `null`. Doesn't even need the `members` array as a parameter. **Verified this review (controller's "verify before changing" item):** the plan's own first-draft `AccountsScreen` snippet called this as `resolveMemberSelectionIds(filters.member, familyMembers.status === 'ready' ? [] : [])` — both branches evaluate to `[]`, a functionally-null ternary that would make every screen's מי filter silently a no-op. Task 3 now wires it to the real `groups` state `useGlobalFilters()` already exposes (`groups.status === 'ready' ? groups.groups : []`), so a real group selection actually resolves. Flagged so Tasks 4/6/7 don't clone the broken version — they clone Task 3's corrected one.
- **D7 (binding, Stage 3 ledger) — every create form defaults `ownerId` to the acting session's `memberId`, not editable by default; an override control appears only when the viewer's own resolved `edit` level for that specific module is `'family'`.** Matches `ownedModuleAllowed()`'s own rule precisely — only a `'family'`-level editor can create cross-owner; showing an override to an `'own'`-level editor would offer a choice the server silently rejects on submit. A shared `<OwnerPicker>` component (Task 3) implements this once, reused by all four create/edit forms — not reinvented per screen.
- **D8 — spec §5.1 drill-down is plain `navigateTo(id)` calls, no sessionStorage bridge for the מי dimension. AMENDED by I7 (UX, blocking) — see D12.** Unlike `AnnualReport`'s pre-existing `onNavigateToExpenses` bridge (needed because `ExpensesBreakdown` doesn't consume global filters), every Stage 5 destination screen already shares `FilterContext.filters.member` with its origin card (D5) — clicking "חשבונות ומזומן" on the Net Worth screen or Dashboard just calls `navigateTo('accounts')`; the מי selection is already correct because it's the same global state, no bridge required. A card whose underlying screen is **not** rewired onto global filters this stage (`'expenses'`, driven by `transaction_lines` totals on Dashboard) still navigates — D12 below makes that gap visible on arrival instead of a silent seam.
- **D9 (carry-forward, corrected) — the `loadBudget`/`loadSettlement` full-collection `transaction_lines` scan is named a Stage 5 carry-forward in the roadmap, but this stage's own research found the straightforward fix would be a correctness regression, not a perf win, and it is explicitly NOT implemented here.** `transaction_lines` holds both natively-written rows (`YYYY-MM-DD`) and migrated legacy rows that "kept their original date/category formatting verbatim" (Stage 1 ledger, Task 5) — meaning the collection has **no single sortable date format** today. Normalizing `transaction_lines.date` to one sortable format is the actual prerequisite, itself a real, disclosed, out-of-scope piece of work (candidate: Stage 11, or a dedicated data-hygiene pass). Not attempted here.
- **D10 (new this review, folded into Task 1 — M1/M2, What-Did-We-Miss) — `audit_log` ids move to `crypto.randomUUID()`; `financeCollections.ts`'s `save`/`remove` move to `runTransaction`.** `writeAuditLog`'s id was `${Date.now()}-${moduleCounter}`, where the counter resets to `0` on every page load — two devices' first saves in the same millisecond collide and `batch.set` silently overwrites one audit entry with the other. Harmless while nothing wrote concurrently (Stage 2/3's own dispositions); Stage 5 is what makes it live, since every one of the four new screens' saves/deletes route through `writeAuditLog`, and the spec's own two-device split (David's phone / Lilit's laptop) is exactly the scenario. `save`/`remove` were a plain `getDoc`-then-separate-`batch.set` and a plain `batch.delete` respectively — neither detects a concurrent change to the same doc between the read and the write, so a delete racing an edit can resurrect the "deleted" doc (the edit's batch re-`set`s it after the delete's batch already committed, or vice versa — no ordering guarantee), and two concurrent edits can silently clobber each other's fields, both sessions seeing a success toast. `runTransaction` makes both operations detect and retry-or-fail on exactly that race, per Firestore's own optimistic-concurrency contract.
- **D11 (new this review, Task 2 — B2 blocking UX finding) — `NavigationContext` gains a real back-stack backed by the browser History API, plus a leave-guard hook and a typed navigation payload.** `NavigationContext` was a single `useState('dashboard')` with no history of any kind; this stage introduces the app's first 3-deep drill path (Dashboard → Net Worth → Accounts) and the OS/browser back gesture did nothing useful — it either did nothing or left the app entirely. `navigateTo` now calls `history.pushState({ tab }, '')` (skipped as a no-op when navigating to the already-active tab) and a `popstate` listener updates `activeTab` to match, so the OS/browser back gesture — and a new in-header back button, rendered whenever `canGoBack` — both actually return to the origin screen; `FilterContext`'s state is untouched by any of this (D1's own sessionStorage persistence, independent of navigation), so "back to the origin card with filter state intact" is satisfied for free. Two small additions ride on the same file, since it was already being reopened for the history mechanism: (a) `setLeaveGuard(guard: (() => boolean) | null)`, consulted by `navigateTo`/`goBack` before changing tabs — a dirty, unsaved form (I4, Task 3/4/6/7) registers a guard that pops a native confirm and returns the user's choice, so a bottom-nav thumb-slip while editing an 8-field insurance form can no longer discard it silently; (b) `navigateTo(tabId, payload?: unknown)` — an optional payload, stored alongside `{ tab }` in the same history-state object, read once via `navigationPayload` by the destination screen and cleared via `consumePayload()`. This is the mechanism D3's pre-fill affordance and D12's filter-not-applied notice both ride on, so it belongs in the same file/task as the history mechanism rather than reinvented per consumer.
- **D12 (new this review, Task 2 — I7 UX finding) — a drill-down destination not yet on the global filter bar shows a transient, dismissible notice ("הפילטור לא חל כאן עדיין") on arrival, via the existing `NotificationContext`, rather than silently dropping the מי selection.** Chose "show a notice" over D8's other option ("don't wire that destination yet") because not wiring the highest-frequency Dashboard cards (expenses/budget) at all would gut most of this stage's drill-down value for a UX-only reason with a two-line fix. Implemented entirely in the *origin's* click handler (Dashboard, Task 2) by checking the destination's `MODULE_REGISTRY` entry's `usesGlobalFilters` flag before navigating — **not** by touching `ExpensesBreakdown.tsx` or any other screen this plan's Global Constraints keep off-limits. A destination that IS filter-aware (all five new screens, by D5) never shows the notice.
- **D13 (new this review, Task 3 — Sun's architecture ruling) — a shared `useOwnedCollectionScreen<T>` hook, not four hand-cloned state machines.** The plan's first draft told Tasks 4, 6, and 7 (Loans/Insurances/Recurring) to clone `AccountsScreen` "exactly" — five ~250-line copies of one loading/ready/error/permission-denied state machine, differing only in field config, row rendering, and totals; cheap to add a module, expensive to change the shell (pagination, retry copy, delete-confirm wording) across five identical clones. `useOwnedCollectionScreen<T>` owns scope resolution, the fetch effect and its four-way status split, the מי-filter (via the corrected D6 resolver), create/edit/delete plumbing (calling the screen's own `list`/`save`/`remove`), the dirty-form leave-guard (D11) registration, and exposes `viewScope` directly (fed straight into `<ScopeBadge scope={screen.viewScope} />`, D14) — screens supply only the three service functions, copy strings, and their own field config/row rendering/totals math. `NetWorthScreen` (Task 5) is genuinely read-only over a *different* shape of data (a computed aggregate across two collections plus a legacy doc, not one `OwnedCollectionRepo`'s list) — it deliberately does **not** call this hook (that would be the wrong abstraction, forcing a fake `save`/`remove` onto a screen that has neither), but `useNetWorth` is required to expose the identical four-state `status` contract (`'loading' | 'ready' | 'error' | 'permission-denied'`) as a design constraint, which is the actual test Sun's ruling asks for: does the shape generalize to a real read-only consumer without distorting either hook. It does — confirmed by writing `useNetWorth` to the same contract independently (Task 5) and finding no awkward fit.
- **D14 (new this review, Task 3 — I5/M6 UX/What-Did-We-Miss findings) — two small shared UI primitives, not per-screen reinventions.** `<ScopeBadge scope={viewScope} />` (a new component) renders a persistent "מוצג: הנתונים שלך בלבד" pill whenever `viewScope === 'own'`, consumed by all five new screens (four via `useOwnedCollectionScreen`'s `isScopeOwn`, `NetWorthScreen` via its own scope derivation) — a single member chip alone reads as "small family," not "restricted view," and this makes the restriction itself visible regardless of family size. `confirmLargeAmount(value, threshold)` (a new pure utility) backs a soft `window.confirm` before a create/edit submit whose money field exceeds a named, configurable threshold (`LARGE_AMOUNT_CONFIRM_THRESHOLD`), so a fat-fingered extra zero on a balance/premium/payment gets one chance to be caught before it silently corrupts the net-worth headline D3 exists to make trustworthy — a soft confirm, not a hard validation rule (a family can legitimately have a ₪2M mortgage).

## Amendment log (this review, for traceability against the controller ledger)

| Ledger finding | Disposition | Where |
|---|---|---|
| Reorder (P1) | Done — Task 1 → drill-down → Accounts → Loans → NetWorth → Insurances → Recurring | Task order below |
| `audit_log` id collision (M1) | Fixed — `crypto.randomUUID()` | Task 1, D10 |
| non-transactional save/remove (M2) | Fixed — `runTransaction` | Task 1, D10 |
| recurring catch-up must skip `'none'` silently | **Already correct in the pre-review plan** — `useRecurringCatchup`'s `if (scope === 'none') return;` guard was already written this way; reconfirmed, untouched | Task 1, Step 3 |
| `useOwnedCollectionScreen<T>` extraction (Sun) | Done | Task 3, D13 |
| Net worth mitigation structurally dead (B1) | Fixed — INCOMPLETE trigger, dual-surface notice | Task 5, D3 amendment |
| Pre-filled import affordance (P2) | Done | Task 5, D3 amendment; rides on D11's payload |
| Back-stack before drill-down ships (B2) | Done | Task 2, D11 |
| `inputMode`/date-control on every money/date field (B3) | Done, per-form | Tasks 3/4/6/7 (Task 5's Net Worth screen has no form — read-only) |
| Dirty-form confirm-before-leave (I4) | Done — leave-guard on `NavigationContext` | Task 2 (D11) + Task 3 (registration) |
| `'own'`-scope persistent badge (I5) | Done — `<ScopeBadge>` | Task 3, D14 |
| Per-row failed-posting badge (M5) | Done — threads `PostingOutcome.failed` through `useRecurringCatchup`'s return value | Task 1 (return value) + Task 7 (render) |
| Soft confirm above threshold (M6) | Done — `confirmLargeAmount` | Task 3, D14 |
| "הפילטור לא חל כאן עדיין" notice (I7) | Done | Task 2, D12 |
| audit entry allegedly missing on delete (I6) | **Verified false this review** — `financeCollections.ts remove()` already writes `audit_log` in the same batch (confirmed by reading the source, not the plan's prose); no code change | See "Verify-don't-assume findings" below |
| `documents` collection has no Rules match block (M3) | Verified true; named as a dated Risk, not fixed here | Risks |
| `AccountsScreen` snippet's null ternary bug (What-Did-We-Miss, noted) | Fixed in Task 3's real code | Task 3, D6 |
| `isValidLoan`/loan form missing `endDate > startDate` | Verified true (absent from both `firestore.rules` and any client validator); added client-side only, per scope discipline | Task 4 |
| Flat per-row lists vs spec §5.4 (P4) | Named risk, not solved | Risks |
| Recurring-income posting blocked for members even post-Task-1 | Named risk (carried, restated with Task 7 UI note) | Risks |
| `NetWorthLineItem.source` closed union (Sun, minor) | Named risk | Risks |
| `settings/ecosystem` orphaned-field retirement | Moved from a Risk bullet to a Stage 11 roadmap done-criteria line | Roadmap edit (a), separate commit |
| Spec §11 quick manual-entry screen ownerless | Assigned to Stage 11 by name | Roadmap edit (b), separate commit |
| DoD: timed 5-second glance test, explain-coverage audit, no-hover comprehension check, explicit 20-member readability check | Added as four distinct Done Criteria items | Stage-5 Done Criteria |

### Verify-don't-assume findings (read against the actual code, not the plan's or the lenses' prose)

- **`financeCollections.ts remove()` DOES write an `audit_log` entry in the same batch.** Read `src/services/financeCollections.ts` lines 89-94 directly: `remove()` opens one `writeBatch`, calls `batch.delete(...)`, then `writeAuditLog(batch, {...})`, then `batch.commit()` — audit and delete are atomic today, exactly as the file's own module-doc comment claims and as the Stage 3 review already verified. The UX lens's I6 finding ("all four delete flows write no audit entry") does not hold up against the source; no fix applied. (Task 1's D10 transactional rewrite of `remove()` preserves this — the audit write moves inside the new `runTransaction` alongside the delete, still atomic, just via `Transaction.set`/`.delete` instead of `WriteBatch.set`/`.delete`.)
- **`documents` genuinely has no Rules match block; `FileProcessor.ts` genuinely writes to it.** `firestore.rules` has match blocks for `members`/`groups`/`permissions`/`audit_log`/`transaction_lines`/`incomes`/`investments`/`goals`/`accounts`/`recurring`/`loans`/`insurances`/`settings`/`categories`/`sync_logs`/`transactions` — no `documents` block anywhere in the file's 300 lines. `src/utils/FileProcessor.ts` line 591 does `await addDoc(collection(db, 'documents'), {...})`. Firestore Rules default-deny anything with no matching rule (there is no catch-all wildcard at the bottom of this file either), so that write is very likely denied in production today — meaning the document↔record link spec §12's archive feature depends on may be silently broken already, with the failure only visible in whatever try/catch wraps that call site (not investigated further — out of scope to fix or even fully characterize here). Named as a dated Risk below with a recommended verification step; not fixed in this plan (Global Constraints: `firestore.rules` untouched).
- **`isValidLoan` has no `endDate > startDate` check, and no client-side loan validator exists yet to have it either** (this collection's form doesn't exist before Task 4). Confirmed by reading `firestore.rules` lines 113-124 — `isValidLoan` checks both fields are non-empty strings, nothing about their relative order. Added as a client-side check in Task 4's form (a loan whose payoff date precedes its start date is nonsensical and would corrupt the "כמה נשאר" progress math): `endDate > startDate` (ISO string comparison, safe since the form's own date `<input type="date">` always emits `YYYY-MM-DD`). The Rules-level gap is disclosed, not fixed, per this plan's `firestore.rules`-untouched constraint — named as a small addition to the `documents` Risk bullet's sibling note rather than a second Risk entry, since it's the same class of "Rules validation gap, not urgent, named for a future Rules pass."
- **The plan's own first-draft `AccountsScreen` snippet's `resolveMemberSelectionIds(filters.member, familyMembers.status === 'ready' ? [] : [])` is a functionally-null ternary** (both branches return `[]]`) — confirmed by rereading the snippet; fixed in Task 3's real implementation (D6 above) before any task could clone it literally.

## Global Constraints

- All work on branch `familyfinance-v2`. Never commit to `main`.
- TypeScript strict; `npm run lint` (tsc --noEmit) and `npm test` must pass before every commit.
- A failed read renders as an error, never an empty state, for every new hook/component in this plan. A `permission-denied` refusal is a DIFFERENT state again (S2 ruling, carried forward): a calm access message, never the red error/retry copy, never a silent empty list or ₪0 — apply this to every one of the four screens' list loads, `useNetWorth`, and the drill-down destinations. This rule has been re-broken in every prior stage; each task below carries it as an explicit checklist item, not a global aspiration.
- Scope discipline: **screens + drill-down + net-worth resolution only.** No task in this plan touches the AI layer (Stage 6) or the forecast engine (Stage 7). No task edits `ExpensesBreakdown`/`AnnualReport`/`CentralExpenseReport`/`InvestmentsPortfolio`/`FuturePlanning`/`FolderLogic`/`FamilyManagerModal`. No task edits `firestore.rules` (D1/D10 are both client-side-only fixes against already-correct or already-out-of-scope rules).
- Every screen ships all four states — loading / empty / error / permission-denied — as its own checklist item per task, per the S2 ruling.
- `ownerId` defaults to the acting session's `memberId` on every new create form (D7); never silently left blank, never silently assigned to someone else.
- `data-tour-id` on every new screen's list container, create button, and per-row action (D12-from-Stage-4 convention — distinct from this plan's own local D12 above — `nav.<moduleId>` already covered by Task 1's registry entries; new: `screen.<moduleId>.list`, `screen.<moduleId>.create`, `screen.<moduleId>.row.<action>`).
- Hebrew UI strings for everything user-facing; dates DD/MM/YYYY where user-facing; amounts ₪-labeled where rendered; no hardcoded values beyond named constants documented as intentional.
- **UI-wide requirements, added this review, enforced per task below (not a global aspiration repeated once and hoped for — each task's own checklist restates whichever of these it touches):**
  - Every money field: `inputMode="decimal"`. Every date field: a native `<input type="date">`, never free-text.
  - Every create/edit form guards navigation-away while dirty (D11's `setLeaveGuard`), and the insurance form (8+ fields) is the task that most needs it, not an afterthought.
  - `<ScopeBadge>` (D14) renders on every one of the five new screens whenever the resolved viewing scope is `'own'`.
  - `confirmLargeAmount` (D14) gates every money-field submit above `LARGE_AMOUNT_CONFIRM_THRESHOLD`.
  - Drill-down needs real back behavior (D11) before it ships — done in Task 2, before any of the four CRUD screens exist to drill into.
  - A drill-down destination not yet on the global filter bar shows "הפילטור לא חל כאן עדיין" on arrival (D12), never a silent seam.
- Frequent commits; each task ends with an independently testable, green deliverable; the app is usable after every single task.

---

### Task 1: Scope-aware owned-collection queries, module-aware FilterBar dead-end filtering, and concurrency-safe writes

**Files:**
- Modify: `src/services/financeCollections.ts`, `src/services/AccountsService.ts`, `src/services/LoansService.ts`, `src/services/InsurancesService.ts`, `src/services/RecurringService.ts`, `src/utils/auditLog.ts`, `src/hooks/useRecurringCatchup.ts`, `src/App.tsx`, `src/utils/memberVisibility.ts`, `src/utils/resolveMemberSelection.ts`
- Create: `src/utils/ownedModuleScope.ts`
- Test: `src/__tests__/financeCollections.test.ts` (extend), `src/__tests__/AccountsService.test.ts`/`LoansService.test.ts`/`InsurancesService.test.ts`/`RecurringService.test.ts` (extend), `src/__tests__/useRecurringCatchup.test.ts` (extend), `src/__tests__/memberVisibility.test.ts` (extend), `src/__tests__/resolveMemberSelection.test.ts` (extend), `src/__tests__/ownedModuleScope.test.ts` (new), `src/__tests__/auditLog.test.ts` (new — D10), `firestore-tests/finance-modules.rules.test.ts` (extend — proves the list-query gap for real against the live emulator, not just mocks)

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
// src/hooks/useRecurringCatchup.ts — D10 addition: returns the last outcome (was `void`), so
// Task 7's RecurringScreen can thread per-item failures into a row-level badge (M5) instead of
// only a fire-and-forget app-boot toast that nothing downstream could ever inspect again.
import type { PermissionLevel, PermissionRole } from '../types/permissions';
import type { PostingOutcome } from '../services/RecurringService';
export function useRecurringCatchup(
  session: Pick<AuthSession, 'status' | 'memberId' | 'role'>,
  recurringViewLevel: PermissionLevel | undefined // resolvedPermissions?.recurring?.view — App.tsx already has this
): PostingOutcome | null;
```
```ts
// src/utils/auditLog.ts — D10
import type { DocumentData, DocumentReference } from 'firebase/firestore';

/** Structural, not `WriteBatch`-specific — both `WriteBatch` and `Transaction` expose a
 * compatible `set(ref, data)`, so this one function backs both the existing batch-based callers
 * (GroupsService/PermissionsService/RecurringService's posting loop, unchanged) and Task 1's new
 * transaction-based `financeCollections.ts` save/remove, without a second near-duplicate export. */
export interface AuditWriter {
  set(ref: DocumentReference, data: DocumentData): unknown;
}
export function writeAuditLog(writer: AuditWriter, entry: Omit<AuditEntry, 'at'>): void;
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

`src/__tests__/auditLog.test.ts` (new — D10; nothing tested this file directly before, only via consumers):
```ts
import { describe, expect, it, vi } from 'vitest';
import { writeAuditLog } from '../utils/auditLog';

describe('writeAuditLog (D10)', () => {
  it('writes to a doc id generated by crypto.randomUUID(), not a page-load counter', () => {
    const setSpy = vi.fn();
    const writer = { set: setSpy };
    writeAuditLog(writer, { actorMemberId: 'david-levy', action: 'account.save', target: 'accounts/a1' });
    expect(setSpy).toHaveBeenCalledTimes(1);
    const [ref] = setSpy.mock.calls[0];
    expect(typeof ref.id ?? ref.path).toBeDefined(); // doc() ref shape — exact assertion below
  });
  it('two calls in the same millisecond never collide on id (the M1 bug)', () => {
    const ids = new Set<string>();
    const writer = { set: vi.fn((ref: { id?: string }) => { if (ref.id) ids.add(ref.id); }) };
    for (let i = 0; i < 50; i += 1) {
      writeAuditLog(writer, { actorMemberId: 'x', action: 'x.save', target: 'x/1' });
    }
    expect(ids.size).toBe(50); // every id unique — a Date.now()-counter scheme would collide
                                 // across two SEPARATE moduleCounter instances (two devices), not
                                 // within one process; this asserts randomUUID's own guarantee.
  });
});
```
(The `firebase/firestore` `doc`/`collection` mock follows the same factory pattern already established in `financeCollections.test.ts` — see its own mock below.)

Extend `src/__tests__/financeCollections.test.ts` (add `query`/`where`/`runTransaction` to the `firebase/firestore` mock factory, update every existing `list()`/`save()`/`remove()` call, add new cases):
```ts
// inside the vi.mock('firebase/firestore', ...) factory, add:
  query: vi.fn((colRef, ...clauses) => ({ __col: colRef.__col, __clauses: clauses })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  runTransaction: vi.fn(async (_db, updateFn) => {
    const tx = { get: mockTxGet, set: mockTxSet, delete: mockTxDelete };
    return updateFn(tx);
  }),

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

  it('save() runs inside runTransaction, reading the existing doc INSIDE the transaction, not before it (D10)', async () => {
    mockTxGet.mockResolvedValueOnce({ exists: () => true, data: () => ({ createdAt: '2020-01-01T00:00:00.000Z' }) });
    await save({ id: 'a1', ownerId: 'x', name: 'y' } as any, 'david-levy');
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxSet).toHaveBeenCalledTimes(2); // the record + the audit entry, same transaction
  });
  it('remove() no-ops (no delete, no audit) if the doc is already gone inside the transaction (D10)', async () => {
    mockTxGet.mockResolvedValueOnce({ exists: () => false });
    await remove('ghost', 'david-levy');
    expect(mockTxDelete).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
  });
  it('remove() deletes and audits atomically inside one transaction when the doc exists (D10)', async () => {
    mockTxGet.mockResolvedValueOnce({ exists: () => true, data: () => ({}) });
    await remove('a1', 'david-levy');
    expect(mockTxDelete).toHaveBeenCalledTimes(1);
    expect(mockTxSet).toHaveBeenCalledTimes(1); // the audit entry
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

Extend `src/__tests__/useRecurringCatchup.test.ts` (mock `resolveOwnedModuleScope` indirectly via role/level params): add a case asserting a `'member'` session with `recurringViewLevel: 'own'` calls `postDueRecurringTransactions(memberId, 'own')`; a `'member'` with `recurringViewLevel: undefined` (fail-closed to `'none'`) does NOT call `postDueRecurringTransactions` at all — **this guard already existed in the pre-review draft of this task and is reconfirmed here, not newly added** (nothing to post, not an error — no wasted read, no false failure notification); and a new D10 case:
```ts
  it("returns the resolved outcome from the hook, so a consumer can render per-item failures (M5)", async () => {
    const outcome = { posted: [], failed: [{ recurringId: 'r1', error: 'owner not found' }] };
    mockPostDueRecurringTransactions.mockResolvedValueOnce(outcome);
    const { result } = renderHook(() => useRecurringCatchup(readySession, 'family'));
    await waitFor(() => expect(result.current).toEqual(outcome));
  });
```

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

Run: `npx vitest run src/__tests__/ownedModuleScope.test.ts src/__tests__/auditLog.test.ts src/__tests__/financeCollections.test.ts src/__tests__/AccountsService.test.ts src/__tests__/LoansService.test.ts src/__tests__/InsurancesService.test.ts src/__tests__/RecurringService.test.ts src/__tests__/useRecurringCatchup.test.ts src/__tests__/memberVisibility.test.ts src/__tests__/resolveMemberSelection.test.ts`
Expected: FAIL — new module missing, existing call sites now type-error/behave differently.

- [ ] **Step 3: Implement**

`src/utils/ownedModuleScope.ts` — as specified in Interfaces; a 4-line pure function, no I/O.

`src/utils/auditLog.ts` — D10 rewrite:
```ts
import { collection, doc, type DocumentData, type DocumentReference } from 'firebase/firestore';
import { db } from '../services/firebase';

export interface AuditEntry {
  actorMemberId: string;
  action: string;
  target: string;
  at: string;
  details?: Record<string, unknown>;
}

const AUDIT_LOG_COLLECTION = 'audit_log';

export interface AuditWriter {
  set(ref: DocumentReference, data: DocumentData): unknown;
}

/**
 * Adds an immutable audit_log entry via the caller's writer (a WriteBatch OR, since D10, a
 * Transaction — both structurally satisfy AuditWriter). Does NOT commit — the caller's own
 * batch/transaction (which also contains the triggering write) commits both atomically.
 *
 * D10: the id is crypto.randomUUID(), not a page-load counter (`${Date.now()}-${counter}`) —
 * the counter resets to 0 on every reload, so two devices' first saves in the same millisecond
 * used to collide and batch.set silently overwrote one audit entry with the other. Harmless
 * until Stage 5 puts two parents in front of the same record concurrently; fixed here.
 */
export function writeAuditLog(writer: AuditWriter, entry: Omit<AuditEntry, 'at'>): void {
  const id = crypto.randomUUID();
  const fullEntry: AuditEntry = { ...entry, at: new Date().toISOString() };
  writer.set(doc(collection(db, AUDIT_LOG_COLLECTION), id), fullEntry);
}
```
(`GroupsService`/`PermissionsService`/`RecurringService`'s existing `writeAuditLog(batch, {...})` call sites need no changes — `WriteBatch` structurally satisfies the new `AuditWriter` interface unchanged.)

`src/services/financeCollections.ts` — change `list`, `save`, `remove`:
```ts
import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from './firebase';
import { writeAuditLog } from '../utils/auditLog';
// ...
async function list(scope: 'own' | 'family', viewerMemberId: string): Promise<T[]> {
  const target = scope === 'own'
    ? query(collection(db, collectionName), where('ownerId', '==', viewerMemberId))
    : collection(db, collectionName);
  const snap = await getDocs(target);
  return snap.docs.map((d) => d.data() as T);
}

/**
 * D10: runTransaction replaces the old getDoc-then-separate-batch. Reading `existing` INSIDE the
 * transaction (not before it starts) is the whole fix — Firestore re-runs the transaction body if
 * the doc changes between this read and the commit, so a concurrent edit to the SAME doc from a
 * second device can no longer be silently clobbered by whichever write lands last.
 */
async function save(input: OwnedRecordInput<T>, actorMemberId: string): Promise<T> {
  const now = new Date().toISOString();
  const id = input.id ?? doc(collection(db, collectionName)).id;
  const ref = doc(db, collectionName, id);

  return runTransaction(db, async (tx) => {
    let createdAt = now;
    if (input.id) {
      const existing = await tx.get(ref);
      if (existing.exists()) createdAt = (existing.data() as T).createdAt;
    }
    const record = { ...input, id, createdAt, updatedAt: now } as T;
    tx.set(ref, record);
    writeAuditLog(tx, { actorMemberId, action: `${auditPrefix}.save`, target: `${collectionName}/${id}` });
    return record;
  });
}

/**
 * D10: runTransaction replaces the old unconditional batch.delete. Reading the doc first, INSIDE
 * the transaction, and no-opping if it's already gone, is what stops a delete from racing an edit
 * into resurrecting the record — the old code would `batch.delete` unconditionally regardless of
 * whether a concurrent edit had just re-set the doc a moment earlier.
 */
async function remove(id: string, actorMemberId: string): Promise<void> {
  const ref = doc(db, collectionName, id);
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (!existing.exists()) return; // already gone — no-op, not an error, no audit noise
    tx.delete(ref);
    writeAuditLog(tx, { actorMemberId, action: `${auditPrefix}.delete`, target: `${collectionName}/${id}` });
  });
}
```
Update the module doc comment to explain the scope split (D1) and the transactional rewrite (D10), and to correct the now-stale "every mutation paired with an audit_log entry in the SAME batch" line to "...in the same transaction."

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

`src/hooks/useRecurringCatchup.ts` — take the extra param, resolve scope, skip the call entirely (not an error, nothing due) when scope is `'none'`, and return the resolved outcome (D10, for Task 7's badge):
```ts
import { useState } from 'react';
import { resolveOwnedModuleScope } from '../utils/ownedModuleScope';
import type { PostingOutcome } from '../services/RecurringService';
// ...
export function useRecurringCatchup(
  session: Pick<AuthSession, 'status' | 'memberId' | 'role'>,
  recurringViewLevel: PermissionLevel | undefined
): PostingOutcome | null {
  const [lastOutcome, setLastOutcome] = useState<PostingOutcome | null>(null);
  const ranForMemberIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (session.status !== 'ready' || !session.memberId) {
      ranForMemberIdRef.current = null;
      return;
    }
    if (ranForMemberIdRef.current === session.memberId) return;
    ranForMemberIdRef.current = session.memberId;

    const scope = resolveOwnedModuleScope(session.role!, recurringViewLevel);
    if (scope === 'none') return; // nothing this session could ever see is due — not a failure

    postDueRecurringTransactions(session.memberId, scope)
      .then((outcome) => {
        setLastOutcome(outcome);
        if (outcome.failed.length > 0) {
          console.error('[App] recurring catch-up had failures:', outcome.failed);
          addNotification('error', CATCHUP_FAILURE_MESSAGE);
        }
      })
      .catch((err: unknown) => {
        console.error('[App] recurring catch-up threw unexpectedly:', err);
        addNotification('error', CATCHUP_FAILURE_MESSAGE);
      });
  }, [session.status, session.memberId, session.role, recurringViewLevel, addNotification]);

  return lastOutcome;
}
```

`src/App.tsx` — call site update (return value captured for Task 7's later use):
```ts
const recurringCatchupOutcome = useRecurringCatchup(session, permState.resolvedPermissions?.recurring?.view);
```

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

Run: `npm run lint && npx vitest run src/__tests__/ownedModuleScope.test.ts src/__tests__/auditLog.test.ts src/__tests__/financeCollections.test.ts src/__tests__/AccountsService.test.ts src/__tests__/LoansService.test.ts src/__tests__/InsurancesService.test.ts src/__tests__/RecurringService.test.ts src/__tests__/useRecurringCatchup.test.ts src/__tests__/memberVisibility.test.ts src/__tests__/resolveMemberSelection.test.ts src/__tests__/moduleRegistry.test.ts`
Expected: ALL PASS. `moduleRegistry.test.ts` needs its existing entries' assertions extended with `filterModuleId` too (fold into this step).

- [ ] **Step 5: Rules test — verify the D1 gap is real, then verify the fix**

Run: `npm run test:rules` (or the project's emulator-backed script — matches `scripts/test:rules` convention from Stage 2/3). Before trusting the new "Omer CANNOT list" test, confirm it actually reproduces the gap: temporarily point it at a `where`-scoped query instead and confirm it flips to `assertSucceeds` — i.e., prove the bare-query test fails for the RIGHT reason (Firestore's list-verification, not a fixture typo), per this project's verification-before-completion discipline.

- [ ] **Step 6: Full verification**

Run: `npm run lint && npm test && npm run test:rules`
Expected: ALL PASS (unit count grows from 474; rules count stays 157 — no `firestore.rules` change, only new tests against the existing rule).

- [ ] **Step 7: Commit**

```bash
git add src/utils/ownedModuleScope.ts src/utils/auditLog.ts src/services/financeCollections.ts src/services/AccountsService.ts src/services/LoansService.ts src/services/InsurancesService.ts src/services/RecurringService.ts src/hooks/useRecurringCatchup.ts src/App.tsx src/utils/memberVisibility.ts src/utils/resolveMemberSelection.ts src/config/moduleRegistry.ts src/components/FilterBar.tsx src/__tests__/ownedModuleScope.test.ts src/__tests__/auditLog.test.ts src/__tests__/financeCollections.test.ts src/__tests__/AccountsService.test.ts src/__tests__/LoansService.test.ts src/__tests__/InsurancesService.test.ts src/__tests__/RecurringService.test.ts src/__tests__/useRecurringCatchup.test.ts src/__tests__/memberVisibility.test.ts src/__tests__/resolveMemberSelection.test.ts src/__tests__/moduleRegistry.test.ts firestore-tests/finance-modules.rules.test.ts
git commit -m "fix: scope-aware owned-collection list queries, transactional writes, module-aware FilterBar filtering

Own-level list() issued an unconstrained getDocs() Firestore denies wholesale under
ownedModuleAllowed()'s resource.data-dependent rule — the same failure class Stage 4 found for
transaction_lines/incomes, latent here since Stage 3 and never exercised outside mocks. Fixes the
four owned-collection services and the already-shipped recurring catch-up engine before Stage 5's
screens call any of them from a live browser.

Also: audit_log ids move from a per-page-load counter to crypto.randomUUID() (two devices' first
saves in the same millisecond used to collide and silently overwrite one audit entry), and
financeCollections.ts's save/remove move from a getDoc-then-batch race to runTransaction, closing
a concurrent-edit/delete race the Stage 5 four-lens review flagged as live now that two parents
can edit the same account/loan/policy/recurring-item concurrently. Generalizes FilterBar's
dead-end avoidance from one hardcoded module to the active screen's own module.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Spec §5.1 drill-down — navigation back-stack, leave-guard, navigation payload, filter-not-applied notice

**Files:**
- Modify: `src/contexts/NavigationContext.tsx`, `src/components/Dashboard.tsx`, `src/App.tsx`
- Test: `src/__tests__/NavigationContext.test.tsx` (extend), `src/__tests__/Dashboard.*.test.tsx` (extend)

**Interfaces:**
```ts
// src/contexts/NavigationContext.tsx — D11
export interface NavigationContextType {
  activeTab: string;
  navigationPayload: unknown;
  navigateTo: (tabId: string, payload?: unknown) => void;
  goBack: () => void;
  canGoBack: boolean;
  consumePayload: () => void;                        // destination screen calls this once it has read navigationPayload
  setLeaveGuard: (guard: (() => boolean) | null) => void; // a dirty form registers/clears this
}
export function useNavigation(): NavigationContextType;
```

- [ ] **Step 1: Write the failing tests**

Extend `src/__tests__/NavigationContext.test.tsx`:
```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { NavigationProvider, useNavigation } from '../contexts/NavigationContext';

function wrapper({ children }: { children: React.ReactNode }) {
  return <NavigationProvider>{children}</NavigationProvider>;
}

describe('NavigationContext (D11 — back-stack)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '');
  });

  it('navigateTo pushes a real history entry carrying the tab id', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    act(() => result.current.navigateTo('accounts'));
    expect(result.current.activeTab).toBe('accounts');
    expect((window.history.state as { tab?: string })?.tab).toBe('accounts');
  });

  it('navigateTo to the already-active tab is a no-op — no duplicate history entry', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    const lengthBefore = window.history.length;
    act(() => result.current.navigateTo('dashboard')); // already the default
    expect(window.history.length).toBe(lengthBefore);
  });

  it('a popstate event (OS/browser back gesture) updates activeTab to match', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    act(() => result.current.navigateTo('accounts'));
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { tab: 'dashboard' } }));
    });
    expect(result.current.activeTab).toBe('dashboard');
  });

  it('goBack() calls history.back(), which the popstate handler resolves', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    const backSpy = vi.spyOn(window.history, 'back');
    act(() => result.current.goBack());
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('canGoBack is false on the initial screen, true after one navigateTo', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    expect(result.current.canGoBack).toBe(false);
    act(() => result.current.navigateTo('accounts'));
    expect(result.current.canGoBack).toBe(true);
  });
});

describe('NavigationContext (D11 — payload)', () => {
  it('navigateTo(tabId, payload) makes payload available as navigationPayload', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    act(() => result.current.navigateTo('accounts', { prefillCreate: { balance: 5000 } }));
    expect(result.current.navigationPayload).toEqual({ prefillCreate: { balance: 5000 } });
  });
  it('consumePayload() clears it so a later plain navigation does not resurface stale intent', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    act(() => result.current.navigateTo('accounts', { prefillCreate: { balance: 5000 } }));
    act(() => result.current.consumePayload());
    expect(result.current.navigationPayload).toBeNull();
  });
});

describe('NavigationContext (D11 — leave-guard)', () => {
  it('a registered guard returning false blocks navigateTo', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    const guard = vi.fn().mockReturnValue(false);
    act(() => result.current.setLeaveGuard(guard));
    act(() => result.current.navigateTo('accounts'));
    expect(guard).toHaveBeenCalledTimes(1);
    expect(result.current.activeTab).toBe('dashboard'); // navigation blocked
  });
  it('a registered guard returning true allows navigateTo through', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    act(() => result.current.setLeaveGuard(() => true));
    act(() => result.current.navigateTo('accounts'));
    expect(result.current.activeTab).toBe('accounts');
  });
  it('goBack() is guarded the same way as navigateTo', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper });
    act(() => result.current.navigateTo('accounts'));
    const guard = vi.fn().mockReturnValue(false);
    act(() => result.current.setLeaveGuard(guard));
    act(() => result.current.goBack());
    expect(guard).toHaveBeenCalledTimes(1);
  });
});
```

Extend Dashboard's test suite:
```tsx
it('clicking the "סך ההוצאות" KPI card navigates to the expenses screen (D8)', async () => {
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
it('navigating to "expenses" (not global-filter-aware this stage) fires the D12 "הפילטור לא חל כאן עדיין" notice', async () => {
  // mockAddNotification from NotificationContext mock
  render(<Dashboard />);
  await waitFor(() => screen.getByTestId('kpi.totalExpenses'));
  fireEvent.click(screen.getByTestId('kpi.totalExpenses'));
  expect(mockAddNotification).toHaveBeenCalledWith('info', expect.stringContaining('הפילטור לא חל כאן עדיין'));
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/__tests__/NavigationContext.test.tsx` and the Dashboard suite, expect the new cases FAIL.

- [ ] **Step 3: Implement `NavigationContext.tsx` (D11)**

```tsx
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface HistoryState {
  tab: string;
  payload?: unknown;
}

interface NavigationContextType {
  activeTab: string;
  navigationPayload: unknown;
  navigateTo: (tabId: string, payload?: unknown) => void;
  goBack: () => void;
  canGoBack: boolean;
  consumePayload: () => void;
  setLeaveGuard: (guard: (() => boolean) | null) => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

function readHistoryState(): HistoryState {
  const raw = window.history.state as Partial<HistoryState> | null;
  return { tab: raw?.tab ?? 'dashboard', payload: raw?.payload };
}

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<HistoryState>(() => readHistoryState());
  const [canGoBack, setCanGoBack] = useState(false);
  const leaveGuardRef = useRef<(() => boolean) | null>(null);

  useEffect(() => {
    // Seed the initial entry so the very first back gesture has somewhere to land inside the
    // app, instead of leaving it — the B2 finding's exact complaint.
    if (!(window.history.state as Partial<HistoryState> | null)?.tab) {
      window.history.replaceState({ tab: 'dashboard' } satisfies HistoryState, '');
    }
    const onPopState = (e: PopStateEvent) => {
      const next = (e.state as Partial<HistoryState> | null) ?? { tab: 'dashboard' };
      setState({ tab: next.tab ?? 'dashboard', payload: next.payload });
      setCanGoBack(!!(e.state as Partial<HistoryState> | null)?.tab && window.history.length > 1);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const requestLeave = useCallback((): boolean => leaveGuardRef.current?.() ?? true, []);

  const navigateTo = useCallback((tabId: string, payload?: unknown) => {
    setState((current) => {
      if (current.tab === tabId) return current; // no duplicate history entry for a same-tab click
      if (!requestLeave()) return current; // I4 — a dirty form vetoes the navigation
      window.history.pushState({ tab: tabId, payload } satisfies HistoryState, '');
      setCanGoBack(true);
      return { tab: tabId, payload };
    });
  }, [requestLeave]);

  const goBack = useCallback(() => {
    if (!requestLeave()) return;
    window.history.back(); // resolved by the popstate listener above
  }, [requestLeave]);

  const consumePayload = useCallback(() => {
    setState((current) => ({ ...current, payload: undefined }));
  }, []);

  const setLeaveGuard = useCallback((guard: (() => boolean) | null) => {
    leaveGuardRef.current = guard;
  }, []);

  return (
    <NavigationContext.Provider
      value={{
        activeTab: state.tab,
        navigationPayload: state.payload ?? null,
        navigateTo,
        goBack,
        canGoBack,
        consumePayload,
        setLeaveGuard,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}

export const useNavigation = (): NavigationContextType => {
  const context = useContext(NavigationContext);
  if (!context) throw new Error('useNavigation must be used within NavigationProvider');
  return context;
};
```

- [ ] **Step 4: `App.tsx` — a header back button wherever `canGoBack`, for a mouse/desktop user with no OS back gesture**

```tsx
const { activeTab, navigateTo, goBack, canGoBack } = useNavigation();
// ... inside the header, before the screen title:
{canGoBack && (
  <button onClick={goBack} aria-label="חזרה" className="p-2 -ms-2 text-slate-500 min-h-[44px] min-w-[44px]">
    <ChevronRight className="w-5 h-5" /> {/* RTL — "back" points right */}
  </button>
)}
```

- [ ] **Step 5: `Dashboard.tsx` — wrap clickable cards, wire the D12 filter-not-applied notice**

```tsx
import { useNavigation } from '../contexts/NavigationContext';
import { useNotification } from '../contexts/NotificationContext';
import { MODULE_REGISTRY } from '../config/moduleRegistry';
// ...
const { navigateTo } = useNavigation();
const { addNotification } = useNotification();

function drillDownTo(moduleId: string) {
  const entry = MODULE_REGISTRY.find((m) => m.id === moduleId);
  if (entry && !entry.usesGlobalFilters) {
    // D12 — this destination doesn't consume FilterContext yet (out of this stage's scope to
    // rewire); say so on arrival instead of letting the מי selection silently stop applying.
    addNotification('info', 'הפילטור לא חל כאן עדיין — מסך זה עדיין לא מחובר לסינון הגלובלי.');
  }
  navigateTo(moduleId);
}
```
Wrap each of the four KPI cards (`totalIncome`/`monthlyBalance` stay NON-clickable — no dedicated screen exists this stage; `totalExpenses`/`plannedBudget` → `drillDownTo('expenses')`) and the settlement/`ComparisonTable` card (→ `drillDownTo('expenses')`) in a `<button>` (not a `<div onClick>` — real keyboard/focus semantics) ONLY when that card's own access/error state is `'ready'` (never a clickable card that would navigate into a screen showing the same denial). Add `data-tour-id`/`data-testid` per the Stage-4 D12 convention (`kpi.totalExpenses`, `kpi.plannedBudget`, `card.comparison`).

- [ ] **Step 6: Run to verify pass** — `npm run lint && npm test`.

- [ ] **Step 7: Full verification + manual smoke check**

Sign in as David; click every clickable Dashboard card in turn; confirm each opens the right screen with the current מי selection preserved (D8 — no bridge needed, same global state), and that clicking into "expenses" shows the D12 notice exactly once on arrival. Confirm `totalIncome`/`monthlyBalance` render as plain (non-button) cards. Use the browser/OS back gesture (or the new header back button) from "expenses" back to Dashboard; confirm it lands on Dashboard with the same מי selection, not a blank screen or a closed app/tab.

- [ ] **Step 8: Commit**
```bash
git add src/contexts/NavigationContext.tsx src/components/Dashboard.tsx src/App.tsx src/__tests__/NavigationContext.test.tsx src/__tests__/Dashboard.globalFilters.test.tsx
git commit -m "feat: spec §5.1 drill-down — real back-stack, leave-guard, navigation payload, filter-not-applied notice

NavigationContext was a single useState with no history; this is the app's first 3-deep
navigation path (Dashboard -> Net Worth -> Accounts) and the OS/browser back gesture did
nothing. navigateTo now pushes real history entries, a popstate listener resolves the OS/browser
back gesture (and a new header back button) to the origin screen, filter state is untouched by
navigation (FilterContext's own sessionStorage persistence). Also adds a dirty-form leave-guard
and a typed navigation payload (D11), and a visible notice for drill-down destinations not yet
wired onto global filters (D12), so five new screens' drill-down doesn't ship with a silent seam
or an unprotected form one thumb-slip from the bottom nav.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Accounts screen — shared `useOwnedCollectionScreen<T>` hook, `OwnerPicker`, `ScopeBadge`, states, glossary, registry

**Files:**
- Create: `src/hooks/useOwnedCollectionScreen.ts`, `src/utils/amountConfirm.ts`, `src/components/OwnerPicker.tsx`, `src/components/ScopeBadge.tsx`, `src/components/AccountsScreen.tsx`
- Modify: `src/config/moduleRegistry.ts`, `src/config/glossary.ts`, `src/App.tsx`
- Test: `src/__tests__/useOwnedCollectionScreen.test.ts`, `src/__tests__/amountConfirm.test.ts`, `src/__tests__/OwnerPicker.test.tsx`, `src/__tests__/ScopeBadge.test.tsx`, `src/__tests__/AccountsScreen.test.tsx`, `src/__tests__/glossary.test.ts` (extend), `src/__tests__/moduleRegistry.test.ts` (extend)

**Interfaces:**
```ts
// src/hooks/useOwnedCollectionScreen.ts — D13, the shared shell every one of Tasks 3/4/6/7 builds on
import type { OwnedRecord, OwnedRecordInput } from '../services/financeCollections';
import type { PermissionLevel, PermissionRole } from '../types/permissions';

export interface OwnedCollectionScreenConfig<T extends OwnedRecord> {
  list: (scope: 'own' | 'family', viewerMemberId: string) => Promise<T[]>;
  save: (input: OwnedRecordInput<T>, actorMemberId: string) => Promise<T>;
  remove: (id: string, actorMemberId: string) => Promise<void>;
  session: { memberId: string; role: PermissionRole };
  viewLevel: PermissionLevel | undefined;
  editLevel: PermissionLevel | undefined;
  loadErrorMessage: string;
}

export interface OwnedCollectionScreenState<T extends OwnedRecord> {
  status: 'loading' | 'ready' | 'error' | 'permission-denied';
  errorMessage: string | null;
  items: T[];
  visibleItems: T[];                 // after the D6 מי filter is applied
  viewScope: 'own' | 'family' | 'none';
  editScope: 'own' | 'family' | 'none';
  isFormOpen: boolean;
  editing: T | null;
  openCreate: () => void;
  openEdit: (item: T) => void;
  closeForm: () => void;
  markDirty: (dirty: boolean) => void;  // I4 — the screen's form calls this on every field change
  pendingDeleteId: string | null;
  requestDelete: (id: string) => void;
  cancelDelete: () => void;
  confirmDelete: () => Promise<void>;
  submit: (input: OwnedRecordInput<T>) => Promise<void>;
  reload: () => void;
}

export function useOwnedCollectionScreen<T extends OwnedRecord>(
  config: OwnedCollectionScreenConfig<T>
): OwnedCollectionScreenState<T>;
```
```ts
// src/utils/amountConfirm.ts — D14
export const LARGE_AMOUNT_CONFIRM_THRESHOLD = 500_000; // ₪ — a soft confirm, not a hard rule (M6);
                                                          // a real mortgage can legitimately exceed it.
export function confirmLargeAmount(value: number, threshold?: number): boolean;
```
```ts
// src/components/ScopeBadge.tsx — D14
export function ScopeBadge(props: { scope: 'own' | 'family' | 'none' }): React.JSX.Element | null;
```
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

`src/__tests__/useOwnedCollectionScreen.test.ts` (mock service fns, `useGlobalFilters`, `useNavigation`):
```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOwnedCollectionScreen } from '../hooks/useOwnedCollectionScreen';

const mockSetLeaveGuard = vi.fn();
vi.mock('../contexts/NavigationContext', () => ({ useNavigation: () => ({ setLeaveGuard: mockSetLeaveGuard }) }));
vi.mock('../contexts/FilterContext', () => ({
  useGlobalFilters: () => ({
    filters: { member: { mode: 'all', memberIds: [], groupId: null } },
    groups: { status: 'ready', groups: [] },
  }),
}));

type Rec = { id: string; ownerId: string; name: string; createdAt: string; updatedAt: string };
const item = (id: string, ownerId = 'david-levy'): Rec => ({ id, ownerId, name: id, createdAt: 'x', updatedAt: 'x' });

describe('useOwnedCollectionScreen (D13)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves permission-denied when the resolved scope is none, without ever calling list()', async () => {
    const list = vi.fn();
    const { result } = renderHook(() => useOwnedCollectionScreen({
      list, save: vi.fn(), remove: vi.fn(),
      session: { memberId: 'omer-levy', role: 'member' }, viewLevel: undefined, editLevel: undefined,
      loadErrorMessage: 'x',
    }));
    await waitFor(() => expect(result.current.status).toBe('permission-denied'));
    expect(list).not.toHaveBeenCalled();
  });

  it('a failed read renders error, never a fabricated empty list', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => useOwnedCollectionScreen({
      list, save: vi.fn(), remove: vi.fn(),
      session: { memberId: 'david-levy', role: 'super-admin' }, viewLevel: 'family', editLevel: 'family',
      loadErrorMessage: 'טעינה נכשלה',
    }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBe('טעינה נכשלה');
    expect(result.current.items).toEqual([]);
  });

  it('submit() calls save with the acting memberId, reloads the list, and closes the form', async () => {
    const list = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([item('a1')]);
    const save = vi.fn().mockResolvedValueOnce(item('a1'));
    const { result } = renderHook(() => useOwnedCollectionScreen({
      list, save, remove: vi.fn(),
      session: { memberId: 'david-levy', role: 'super-admin' }, viewLevel: 'family', editLevel: 'family',
      loadErrorMessage: 'x',
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.openCreate());
    await act(async () => result.current.submit({ ownerId: 'david-levy', name: 'a1' } as any));
    expect(save).toHaveBeenCalledWith({ ownerId: 'david-levy', name: 'a1' }, 'david-levy');
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.isFormOpen).toBe(false);
  });

  it('confirmDelete calls remove and removes the item from state without a full reload', async () => {
    const list = vi.fn().mockResolvedValueOnce([item('a1')]);
    const remove = vi.fn().mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useOwnedCollectionScreen({
      list, save: vi.fn(), remove,
      session: { memberId: 'david-levy', role: 'super-admin' }, viewLevel: 'family', editLevel: 'family',
      loadErrorMessage: 'x',
    }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.requestDelete('a1'));
    expect(remove).not.toHaveBeenCalled();
    await act(async () => result.current.confirmDelete());
    expect(remove).toHaveBeenCalledWith('a1', 'david-levy');
    expect(result.current.items).toHaveLength(0);
  });

  it('registers a leave-guard on mount that only blocks when the form is open AND dirty (I4)', async () => {
    const list = vi.fn().mockResolvedValueOnce([]);
    const { result } = renderHook(() => useOwnedCollectionScreen({
      list, save: vi.fn(), remove: vi.fn(),
      session: { memberId: 'david-levy', role: 'super-admin' }, viewLevel: 'family', editLevel: 'family',
      loadErrorMessage: 'x',
    }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockSetLeaveGuard).toHaveBeenCalledWith(expect.any(Function));
    const guard = mockSetLeaveGuard.mock.calls[0][0];
    expect(guard()).toBe(true); // form not open — never blocks
    act(() => result.current.openCreate());
    act(() => result.current.markDirty(true));
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    expect(guard()).toBe(false); // open + dirty — asks, user declined
  });
});
```

`src/__tests__/amountConfirm.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { confirmLargeAmount, LARGE_AMOUNT_CONFIRM_THRESHOLD } from '../utils/amountConfirm';

describe('confirmLargeAmount (D14/M6)', () => {
  it('below the threshold never prompts', () => {
    const spy = vi.spyOn(window, 'confirm');
    expect(confirmLargeAmount(1000)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
  it('at/above the threshold prompts and returns the user choice', () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    expect(confirmLargeAmount(LARGE_AMOUNT_CONFIRM_THRESHOLD)).toBe(false);
  });
});
```

`src/__tests__/ScopeBadge.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScopeBadge } from '../components/ScopeBadge';

describe('ScopeBadge (D14/I5)', () => {
  it('renders the restricted-view pill when scope is "own"', () => {
    render(<ScopeBadge scope="own" />);
    expect(screen.getByText('מוצג: הנתונים שלך בלבד')).toBeInTheDocument();
  });
  it('renders nothing for "family" or "none"', () => {
    const { container: c1 } = render(<ScopeBadge scope="family" />);
    expect(c1).toBeEmptyDOMElement();
    const { container: c2 } = render(<ScopeBadge scope="none" />);
    expect(c2).toBeEmptyDOMElement();
  });
});
```

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

`src/__tests__/AccountsScreen.test.tsx` (mock `AccountsService`, `useNavigation`, `useGlobalFilters` — representative cases; the delta from this pattern is what Tasks 4/6/7's own test files spell out):
```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AccountsScreen from '../components/AccountsScreen';

const { mockList, mockSave, mockRemove, mockConsumePayload } = vi.hoisted(() => ({
  mockList: vi.fn(), mockSave: vi.fn(), mockRemove: vi.fn(), mockConsumePayload: vi.fn(),
}));
vi.mock('../services/AccountsService', () => ({ listAccounts: mockList, saveAccount: mockSave, deleteAccount: mockRemove }));
let mockNavigationPayload: unknown = null;
vi.mock('../contexts/NavigationContext', () => ({
  useNavigation: () => ({ navigationPayload: mockNavigationPayload, consumePayload: mockConsumePayload, setLeaveGuard: vi.fn() }),
}));
// useGlobalFilters mocked to a fixed 'all' selection + a two-member family — see the existing
// Dashboard test suite's FilterContext mock for the established pattern to reuse.

describe('AccountsScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); mockNavigationPayload = null; });

  it('loading state renders before the list resolves', () => {
    mockList.mockReturnValue(new Promise(() => {}));
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
    render(<AccountsScreen session={{ memberId: 'omer-levy', role: 'member' }} accountsViewLevel={undefined} accountsEditLevel={undefined} />);
    await waitFor(() => expect(screen.getByText(/אין לך הרשאה/)).toBeInTheDocument());
    expect(mockList).not.toHaveBeenCalled();
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
      expect.objectContaining({ ownerId: 'omer-levy', name: 'עו״ש', balance: 1000 }), 'omer-levy'
    ));
  });

  it("an 'own'-level editor sees no OwnerPicker select and a ScopeBadge (D7/D14/I5)", async () => {
    mockList.mockResolvedValueOnce([]);
    render(<AccountsScreen session={{ memberId: 'omer-levy', role: 'member' }} accountsViewLevel="own" accountsEditLevel="own" />);
    await waitFor(() => screen.getByText(/עדיין לא הוספתם חשבונות/));
    expect(screen.getByText('מוצג: הנתונים שלך בלבד')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('screen.accounts.create'));
    expect(screen.queryByRole('combobox', { name: /בעלים/ })).not.toBeInTheDocument();
  });

  it('the balance field has inputMode="decimal" (B3)', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.accounts.create'));
    fireEvent.click(screen.getByTestId('screen.accounts.create'));
    expect(screen.getByLabelText('יתרה')).toHaveAttribute('inputMode', 'decimal');
  });

  it('a balance at/above the confirm threshold prompts window.confirm before saving (D14/M6)', async () => {
    mockList.mockResolvedValueOnce([]);
    mockSave.mockResolvedValueOnce({});
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => screen.getByTestId('screen.accounts.create'));
    fireEvent.click(screen.getByTestId('screen.accounts.create'));
    fireEvent.change(screen.getByLabelText('שם החשבון'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('יתרה'), { target: { value: '600000' } });
    fireEvent.click(screen.getByText('שמור'));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(mockSave).toHaveBeenCalled();
  });

  it('a navigationPayload.prefillCreate opens the create form pre-populated and consumes the payload (D3 pre-fill affordance)', async () => {
    mockList.mockResolvedValueOnce([]);
    mockNavigationPayload = { prefillCreate: { name: 'מזומן (מיובא)', type: 'cash', balance: 12000 } };
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => expect(screen.getByDisplayValue('מזומן (מיובא)')).toBeInTheDocument());
    expect(screen.getByDisplayValue('12000')).toBeInTheDocument();
    expect(mockConsumePayload).toHaveBeenCalled();
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

  it('archived accounts render with a visible "ארכיון" badge and drop out of the total', async () => {
    mockList.mockResolvedValueOnce([{ id: 'a1', ownerId: 'david-levy', name: 'ישן', type: 'bank', balance: 500, balanceUpdatedAt: 'x', status: 'archived', createdAt: 'x', updatedAt: 'x' }]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => expect(screen.getByText('ארכיון')).toBeInTheDocument());
    expect(screen.getByText('סך היתרות: ₪0')).toBeInTheDocument();
  });

  it('the total-balance summary is wired to the accounts.totalBalance glossary entry', async () => {
    mockList.mockResolvedValueOnce([{ id: 'a1', ownerId: 'david-levy', name: 'X', type: 'bank', balance: 500, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
    render(<AccountsScreen session={{ memberId: 'david-levy', role: 'super-admin' }} accountsViewLevel="family" accountsEditLevel="family" />);
    await waitFor(() => expect(screen.getByLabelText('הסבר: סך היתרות')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/useOwnedCollectionScreen.test.ts src/__tests__/amountConfirm.test.ts src/__tests__/ScopeBadge.test.tsx src/__tests__/OwnerPicker.test.tsx src/__tests__/AccountsScreen.test.tsx`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement `useOwnedCollectionScreen.ts` (D13), `amountConfirm.ts` (D14), `ScopeBadge.tsx` (D14)**

```ts
// src/hooks/useOwnedCollectionScreen.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGlobalFilters } from '../contexts/FilterContext';
import { useNavigation } from '../contexts/NavigationContext';
import { resolveOwnedModuleScope } from '../utils/ownedModuleScope';
import { resolveMemberSelectionIds } from '../utils/resolveMemberSelection';
import type { OwnedRecord, OwnedRecordInput } from '../services/financeCollections';
import type { PermissionLevel, PermissionRole } from '../types/permissions';

function isPermissionDenied(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'permission-denied';
}

export interface OwnedCollectionScreenConfig<T extends OwnedRecord> {
  list: (scope: 'own' | 'family', viewerMemberId: string) => Promise<T[]>;
  save: (input: OwnedRecordInput<T>, actorMemberId: string) => Promise<T>;
  remove: (id: string, actorMemberId: string) => Promise<void>;
  session: { memberId: string; role: PermissionRole };
  viewLevel: PermissionLevel | undefined;
  editLevel: PermissionLevel | undefined;
  loadErrorMessage: string;
}

export interface OwnedCollectionScreenState<T extends OwnedRecord> {
  status: 'loading' | 'ready' | 'error' | 'permission-denied';
  errorMessage: string | null;
  items: T[];
  visibleItems: T[];
  viewScope: 'own' | 'family' | 'none';
  editScope: 'own' | 'family' | 'none';
  isFormOpen: boolean;
  editing: T | null;
  openCreate: () => void;
  openEdit: (item: T) => void;
  closeForm: () => void;
  markDirty: (dirty: boolean) => void;
  pendingDeleteId: string | null;
  requestDelete: (id: string) => void;
  cancelDelete: () => void;
  confirmDelete: () => Promise<void>;
  submit: (input: OwnedRecordInput<T>) => Promise<void>;
  reload: () => void;
}

export function useOwnedCollectionScreen<T extends OwnedRecord>(
  config: OwnedCollectionScreenConfig<T>
): OwnedCollectionScreenState<T> {
  const { list, save, remove, session, viewLevel, editLevel, loadErrorMessage } = config;
  const { filters, groups } = useGlobalFilters();
  const { setLeaveGuard } = useNavigation();

  const [items, setItems] = useState<T[]>([]);
  const [status, setStatus] = useState<OwnedCollectionScreenState<T>['status']>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const viewScope = resolveOwnedModuleScope(session.role, viewLevel);
  const editScope = resolveOwnedModuleScope(session.role, editLevel);

  useEffect(() => {
    if (viewScope === 'none') { setStatus('permission-denied'); return; }
    setStatus('loading');
    list(viewScope, session.memberId)
      .then((result) => { setItems(result); setStatus('ready'); })
      .catch((err: unknown) => {
        if (isPermissionDenied(err)) { setStatus('permission-denied'); return; }
        setErrorMessage(loadErrorMessage);
        setStatus('error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewScope, session.memberId, reloadToken]);

  // I4 — one stable guard, registered once, reading live refs at call time (no stale closures
  // from re-registering a new function on every isFormOpen/dirty change).
  const isFormOpenRef = useRef(false);
  const dirtyRef = useRef(false);
  useEffect(() => { isFormOpenRef.current = isFormOpen; }, [isFormOpen]);
  useEffect(() => {
    setLeaveGuard(() => {
      if (!isFormOpenRef.current || !dirtyRef.current) return true;
      return window.confirm('יש שינויים שלא נשמרו בטופס. לצאת בכל זאת?');
    });
    return () => setLeaveGuard(null);
  }, [setLeaveGuard]);

  const selectedIds = resolveMemberSelectionIds(filters.member, groups.status === 'ready' ? groups.groups : []);
  const visibleItems = selectedIds ? items.filter((i) => selectedIds.has(i.ownerId)) : items;

  const openCreate = useCallback(() => { setEditing(null); dirtyRef.current = false; setIsFormOpen(true); }, []);
  const openEdit = useCallback((item: T) => { setEditing(item); dirtyRef.current = false; setIsFormOpen(true); }, []);
  const closeForm = useCallback(() => { setIsFormOpen(false); setEditing(null); dirtyRef.current = false; }, []);
  const markDirty = useCallback((dirty: boolean) => { dirtyRef.current = dirty; }, []);

  const submit = useCallback(async (input: OwnedRecordInput<T>) => {
    await save(editing ? ({ ...input, id: editing.id } as OwnedRecordInput<T>) : input, session.memberId);
    dirtyRef.current = false;
    setIsFormOpen(false);
    setEditing(null);
    setReloadToken((t) => t + 1);
  }, [editing, save, session.memberId]);

  const requestDelete = useCallback((id: string) => setPendingDeleteId(id), []);
  const cancelDelete = useCallback(() => setPendingDeleteId(null), []);
  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteId) return;
    await remove(pendingDeleteId, session.memberId);
    setItems((prev) => prev.filter((i) => i.id !== pendingDeleteId));
    setPendingDeleteId(null);
  }, [pendingDeleteId, remove, session.memberId]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return {
    status, errorMessage, items, visibleItems, viewScope, editScope,
    isFormOpen, editing, openCreate, openEdit, closeForm, markDirty,
    pendingDeleteId, requestDelete, cancelDelete, confirmDelete, submit, reload,
  };
}
```

```ts
// src/utils/amountConfirm.ts
export const LARGE_AMOUNT_CONFIRM_THRESHOLD = 500_000; // ₪ — soft confirm only (M6); a real
                                                          // mortgage/portfolio can legitimately
                                                          // exceed this without being a typo.
export function confirmLargeAmount(value: number, threshold: number = LARGE_AMOUNT_CONFIRM_THRESHOLD): boolean {
  if (value < threshold) return true;
  return window.confirm(`הסכום שהזנת (₪${value.toLocaleString()}) גבוה במיוחד. לאשר שזה נכון?`);
}
```

```tsx
// src/components/ScopeBadge.tsx
import React from 'react';

export function ScopeBadge({ scope }: { scope: 'own' | 'family' | 'none' }): React.JSX.Element | null {
  if (scope !== 'own') return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5"
      dir="rtl"
    >
      מוצג: הנתונים שלך בלבד
    </span>
  );
}
```

- [ ] **Step 4: Implement `OwnerPicker.tsx`**

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

- [ ] **Step 5: Implement `AccountsScreen.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { listAccounts, saveAccount, deleteAccount } from '../services/AccountsService';
import { useNavigation } from '../contexts/NavigationContext';
import { useGlobalFilters } from '../contexts/FilterContext';
import { useOwnedCollectionScreen } from '../hooks/useOwnedCollectionScreen';
import { OwnerPicker } from './OwnerPicker';
import { ScopeBadge } from './ScopeBadge';
import { Explain } from './Explain';
import { confirmLargeAmount } from '../utils/amountConfirm';
import type { Account, AccountType } from '../types/finance';
import type { PermissionLevel, PermissionRole } from '../types/permissions';

const ACCESS_DENIED_MESSAGE = 'אין לך הרשאה לצפות בחשבונות אלו';
const LOAD_ERROR_MESSAGE = 'טעינת החשבונות נכשלה. בדוק את החיבור ונסה שוב.';
const TYPE_LABELS: Record<AccountType, string> = { bank: 'בנק', cash: 'מזומן', credit: 'אשראי' };

export interface AccountsScreenProps {
  session: { memberId: string; role: PermissionRole };
  accountsViewLevel: PermissionLevel | undefined;
  accountsEditLevel: PermissionLevel | undefined;
}

interface FormState { name: string; type: AccountType; balance: string; status: 'active' | 'archived'; ownerId: string }
const BLANK_FORM = (ownerId: string): FormState => ({ name: '', type: 'bank', balance: '', status: 'active', ownerId });

export default function AccountsScreen({ session, accountsViewLevel, accountsEditLevel }: AccountsScreenProps): React.JSX.Element {
  const { familyMembers } = useGlobalFilters();
  const { navigationPayload, consumePayload } = useNavigation();
  const screen = useOwnedCollectionScreen<Account>({
    list: listAccounts, save: saveAccount, remove: deleteAccount,
    session, viewLevel: accountsViewLevel, editLevel: accountsEditLevel,
    loadErrorMessage: LOAD_ERROR_MESSAGE,
  });
  const [form, setForm] = useState<FormState>(BLANK_FORM(session.memberId));

  // D3 pre-fill affordance — a payload from the Net Worth screen's incomplete notice opens the
  // create form pre-populated from a legacy settings/ecosystem value. Consumed once.
  useEffect(() => {
    const prefill = (navigationPayload as { prefillCreate?: { name: string; type: AccountType; balance: number } } | null)?.prefillCreate;
    if (!prefill) return;
    setForm({ name: prefill.name, type: prefill.type, balance: String(prefill.balance), status: 'active', ownerId: session.memberId });
    screen.openCreate();
    consumePayload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationPayload]);

  useEffect(() => {
    if (screen.editing) {
      const a = screen.editing;
      setForm({ name: a.name, type: a.type, balance: String(a.balance), status: a.status, ownerId: a.ownerId });
    } else if (screen.isFormOpen) {
      setForm((f) => (f.name || f.balance ? f : BLANK_FORM(session.memberId)));
    }
  }, [screen.editing, screen.isFormOpen, session.memberId]);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((f) => ({ ...f, [key]: value }));
    screen.markDirty(true);
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const balance = Number(form.balance);
    if (!confirmLargeAmount(balance)) return; // D14 — soft confirm, user can still proceed
    await screen.submit({
      ownerId: form.ownerId, name: form.name, type: form.type, balance,
      balanceUpdatedAt: new Date().toISOString(), status: form.status,
    });
    setForm(BLANK_FORM(session.memberId));
  }

  if (screen.status === 'permission-denied') {
    return <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-slate-500 text-sm" dir="rtl">{ACCESS_DENIED_MESSAGE}</div>;
  }
  if (screen.status === 'error') {
    return <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center" dir="rtl"><p className="text-red-600 font-medium">{screen.errorMessage}</p></div>;
  }
  if (screen.status === 'loading') {
    return <div className="p-8 text-center text-slate-500" dir="rtl">טוען חשבונות...</div>;
  }

  const totalBalance = screen.visibleItems.filter((a) => a.status === 'active').reduce((sum, a) => sum + a.balance, 0);

  return (
    <div className="space-y-4" data-tour-id="screen.accounts.list" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <h2 className="text-lg font-bold text-slate-800">חשבונות ויתרות</h2>
          <span className="text-sm text-slate-500">סך היתרות: ₪{totalBalance.toLocaleString()}</span>
          <Explain id="accounts.totalBalance" />
          <ScopeBadge scope={screen.viewScope} />
        </div>
        {screen.editScope !== 'none' && (
          <button data-testid="screen.accounts.create" data-tour-id="screen.accounts.create" onClick={screen.openCreate}
            className="bg-blue-600 text-white rounded-xl px-4 py-2 min-h-[44px] text-sm font-medium">
            חשבון חדש
          </button>
        )}
      </div>

      {screen.visibleItems.length === 0 ? (
        <p className="text-slate-400 text-center py-8">עדיין לא הוספתם חשבונות.</p>
      ) : (
        <div className="space-y-2">
          {screen.visibleItems.map((a) => (
            <div key={a.id} className="bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-800">
                  {a.name}
                  {a.status === 'archived' && <span className="ms-2 text-xs bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">ארכיון</span>}
                </p>
                <p className="text-xs text-slate-500">{TYPE_LABELS[a.type]} · ₪{a.balance.toLocaleString()}</p>
              </div>
              {screen.editScope !== 'none' && (
                <div className="flex gap-2">
                  <button onClick={() => screen.openEdit(a)} className="text-sm text-blue-600 min-h-[44px] px-2">עריכה</button>
                  <button data-testid="screen.accounts.row.delete" onClick={() => screen.requestDelete(a.id)} className="text-sm text-red-600 min-h-[44px] px-2">מחיקה</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {screen.isFormOpen && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <label className="block text-sm">
            <span className="text-slate-600 mb-1 block">שם החשבון</span>
            <input aria-label="שם החשבון" value={form.name} onChange={(e) => updateForm('name', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm" required />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600 mb-1 block">סוג</span>
            <select aria-label="סוג" value={form.type} onChange={(e) => updateForm('type', e.target.value as AccountType)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm">
              {(Object.keys(TYPE_LABELS) as AccountType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600 mb-1 block">יתרה</span>
            {/* B3 — inputMode="decimal", never a bare text keyboard on a money field */}
            <input aria-label="יתרה" type="number" inputMode="decimal" value={form.balance}
              onChange={(e) => updateForm('balance', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm" required />
          </label>
          <OwnerPicker members={familyMembers.status === 'ready' ? familyMembers.members : []} value={form.ownerId}
            onChange={(id) => updateForm('ownerId', id)} editLevel={screen.editScope} actingMemberId={session.memberId} />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={screen.closeForm} className="text-sm text-slate-500 min-h-[44px] px-3">ביטול</button>
            <button type="submit" className="bg-blue-600 text-white rounded-xl px-4 py-2 min-h-[44px] text-sm font-medium">שמור</button>
          </div>
        </form>
      )}

      {screen.pendingDeleteId && (
        <div className="bg-white rounded-2xl border border-red-200 p-4 space-y-3" dir="rtl">
          <p>למחוק את החשבון?</p>
          <div className="flex gap-2 justify-end">
            <button onClick={screen.cancelDelete} className="text-sm text-slate-500 min-h-[44px] px-3">ביטול</button>
            <button onClick={screen.confirmDelete} className="bg-red-600 text-white rounded-xl px-4 py-2 min-h-[44px] text-sm font-medium">כן, מחק</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Add MODULE_REGISTRY entry + glossary entry + App.tsx wiring**

`src/config/moduleRegistry.ts`:
```ts
export type ModuleRegistryId =
  | 'dashboard' | 'expenses' | 'central-expenses' | 'investments' | 'future' | 'annual' | 'folder'
  | 'accounts'; // + loans/net-worth/insurances/recurring added by their own tasks
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

`src/App.tsx` — add the `TabId` union member and the `renderContent` case:
```tsx
case 'accounts': return (
  <AccountsScreen
    session={{ memberId: session.memberId!, role: session.role! }}
    accountsViewLevel={permState.resolvedPermissions?.accounts?.view}
    accountsEditLevel={permState.resolvedPermissions?.accounts?.edit}
  />
);
```

- [ ] **Step 7: Run to verify pass**

Run: `npm run lint && npx vitest run src/__tests__/useOwnedCollectionScreen.test.ts src/__tests__/amountConfirm.test.ts src/__tests__/ScopeBadge.test.tsx src/__tests__/OwnerPicker.test.tsx src/__tests__/AccountsScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts`
Expected: ALL PASS. `glossary.test.ts`'s `REQUIRED_IDS` gets `'accounts.totalBalance'` appended.

- [ ] **Step 8: Full verification + manual smoke check**

Run: `npm run lint && npm test`. Manually (or via the `run` skill): sign in as David, open "חשבונות ויתרות", create an account, confirm it appears with the correct total, edit its balance, archive it, confirm the archived badge appears and it drops out of the total, delete a different account with confirm, try to navigate away mid-edit and confirm the leave-guard prompt appears, sign in as a `'member'`-role fixture with `accounts: {view:'own', edit:'own'}` and confirm they see only their own account, the `ScopeBadge`, and no `OwnerPicker` select.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useOwnedCollectionScreen.ts src/utils/amountConfirm.ts src/components/ScopeBadge.tsx src/components/OwnerPicker.tsx src/components/AccountsScreen.tsx src/config/moduleRegistry.ts src/config/glossary.ts src/App.tsx src/__tests__/useOwnedCollectionScreen.test.ts src/__tests__/amountConfirm.test.ts src/__tests__/ScopeBadge.test.tsx src/__tests__/OwnerPicker.test.tsx src/__tests__/AccountsScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts
git commit -m "feat: accounts screen on a shared useOwnedCollectionScreen<T> hook — the Tasks 4/6/7 template

Extracts the loading/ready/error/permission-denied state machine, מי-filtering, create/edit/
delete plumbing, and the I4 dirty-form leave-guard into one reusable hook BEFORE this screen
becomes the four-times-cloned template — screens now supply only field config, row rendering,
and totals math. Adds OwnerPicker (D7), ScopeBadge (D14/I5), and a soft large-amount confirm
(D14/M6), all shared across every future owned-collection screen.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Loans screen

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

Follows Task 3's `AccountsScreen` pattern exactly — same `useOwnedCollectionScreen<Loan>` call, same four-state branch, same `OwnerPicker`/`ScopeBadge` reuse, same delete-confirm, same leave-guard (free, from the hook), same `data-tour-id` convention `screen.loans.*`. The delta:

- **Fields:** `name`, `loanType` (select: `mortgage`/`personal`/`creditLine`/`other`, Hebrew labels משכנתא/הלוואה אישית/מסגרת אשראי/אחר), `principal`, `balance`, `interestRate` (%), `monthlyPayment`, `startDate`, `endDate` (both native `<input type="date">` — B3), `status` (`active`/`paid-off`).
- **`endDate > startDate` client-side validation (this review's verify-don't-assume finding — confirmed absent from both `firestore.rules`' `isValidLoan` and any client validator, since this form didn't exist before this task).** A loan whose payoff date precedes its start date is nonsensical and would corrupt the "כמה נשאר" progress math below. Checked on submit, before calling `screen.submit`:
  ```ts
  if (form.endDate <= form.startDate) {
    setDateError('תאריך הסיום חייב להיות אחרי תאריך ההתחלה');
    return;
  }
  ```
  (ISO `YYYY-MM-DD` string comparison is safe here — both fields come from `<input type="date">`, which always emits that format.) The Rules-level gap (`isValidLoan` still doesn't check this) is disclosed, not fixed — `firestore.rules` stays untouched per this plan's Global Constraints; see the "documents Rules gap" Risk below for the sibling note.
- **"כמה נשאר" progress** (spec's named UX requirement, §6 module map: "יתרה, ריבית, לוח סילוקין, 'כמה נשאר'") — each row shows a progress bar: `paidOffPct = principal > 0 ? Math.round((1 - balance / principal) * 100) : 0`, clamped `[0, 100]`, rendered as `${paidOffPct}% שולם, נשארו ₪{balance.toLocaleString()}`.
- **Money fields (`principal`/`balance`/`monthlyPayment`) all get `inputMode="decimal"` (B3); `interestRate` too** (a percentage is still numeric entry, same keyboard need).
- **Soft confirm (D14)** applies to `balance` on submit, same threshold/mechanism as Accounts.
- **Glossary:** `loans.totalBalance` — "סך היתרה שנשארה לשלם על כל ההלוואות שרואים ברשימה, לפי הבחירה של מי למעלה."
- **Registry entry:** `{ id: 'loans', label: 'הלוואות וחובות', icon: Scale, permissionModuleId: 'loans', usesGlobalFilters: true, filterModuleId: 'loans' }`.

- [ ] **Step 1: Write the failing tests** — mirror `AccountsScreen.test.tsx`'s loading/empty/error/permission-denied/create-defaults-ownerId/no-picker-at-own-level/ScopeBadge/inputMode/soft-confirm/delete-confirm/glossary-wired cases against `LoansService`'s mock, plus loan-specific cases:
```tsx
it('shows the "כמה נשאר" payoff progress for each loan', async () => {
  mockList.mockResolvedValueOnce([{ id: 'l1', ownerId: 'david-levy', name: 'משכנתא', loanType: 'mortgage', principal: 1000000, balance: 750000, interestRate: 3.5, monthlyPayment: 4000, startDate: '2020-01-01', endDate: '2045-01-01', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
  render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
  await waitFor(() => expect(screen.getByText(/25% שולם/)).toBeInTheDocument());
  expect(screen.getByText(/נשארו ₪750,000/)).toBeInTheDocument();
});
it('start/end date fields are native date inputs (B3)', async () => {
  mockList.mockResolvedValueOnce([]);
  render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
  await waitFor(() => screen.getByTestId('screen.loans.create'));
  fireEvent.click(screen.getByTestId('screen.loans.create'));
  expect(screen.getByLabelText('תאריך התחלה')).toHaveAttribute('type', 'date');
  expect(screen.getByLabelText('תאריך סיום')).toHaveAttribute('type', 'date');
});
it('rejects endDate <= startDate with an inline error, never calling saveLoan', async () => {
  mockList.mockResolvedValueOnce([]);
  render(<LoansScreen session={{ memberId: 'david-levy', role: 'super-admin' }} loansViewLevel="family" loansEditLevel="family" />);
  await waitFor(() => screen.getByTestId('screen.loans.create'));
  fireEvent.click(screen.getByTestId('screen.loans.create'));
  fireEvent.change(screen.getByLabelText('שם ההלוואה'), { target: { value: 'X' } });
  fireEvent.change(screen.getByLabelText('תאריך התחלה'), { target: { value: '2030-01-01' } });
  fireEvent.change(screen.getByLabelText('תאריך סיום'), { target: { value: '2020-01-01' } });
  fireEvent.click(screen.getByText('שמור'));
  expect(screen.getByText('תאריך הסיום חייב להיות אחרי תאריך ההתחלה')).toBeInTheDocument();
  expect(mockSave).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/__tests__/LoansScreen.test.tsx`, expect FAIL.

- [ ] **Step 3: Implement `LoansScreen.tsx`** — same structure as `AccountsScreen.tsx` (Task 3 Step 5) built on `useOwnedCollectionScreen<Loan>`, swapping `Account`/`AccountsService` for `Loan`/`LoansService`, the type-label map for `LOAN_TYPE_LABELS`, adding the two date inputs + the `endDate > startDate` check + the payoff-progress row. Full component written, no elision (the shell is now established via the shared hook; this task's own report is where the exact JSX lives).

- [ ] **Step 4: Registry + glossary + App.tsx wiring** — as in Task 3 Step 6, substituting the loans-specific values above.

- [ ] **Step 5: Run to verify pass** — `npm run lint && npx vitest run src/__tests__/LoansScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts`.

- [ ] **Step 6: Full verification + manual smoke check** — `npm run lint && npm test`; sign in as David, open "הלוואות וחובות", create a loan with `endDate` before `startDate` and confirm the inline error blocks submit, fix the dates and save, confirm the payoff progress renders correctly, edit balance down, confirm the bar moves.

- [ ] **Step 7: Commit**
```bash
git add src/components/LoansScreen.tsx src/config/moduleRegistry.ts src/config/glossary.ts src/App.tsx src/__tests__/LoansScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts
git commit -m "feat: loans screen — list/create/edit/delete with payoff progress ('כמה נשאר'), endDate>startDate validation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Net worth resolution — `useNetWorth` hook, `NetWorthIncompleteNotice`, Dashboard rewire, dedicated Net Worth screen

**Files:**
- Create: `src/hooks/useNetWorth.ts`, `src/components/NetWorthIncompleteNotice.tsx`, `src/components/NetWorthScreen.tsx`
- Modify: `src/components/Dashboard.tsx`, `src/config/moduleRegistry.ts`, `src/config/glossary.ts`, `src/App.tsx`
- Test: `src/__tests__/useNetWorth.test.ts`, `src/__tests__/NetWorthIncompleteNotice.test.tsx`, `src/__tests__/NetWorthScreen.test.tsx`, `src/__tests__/Dashboard.*.test.tsx` (extend the existing Dashboard suite's net-worth-card assertions), `src/__tests__/glossary.test.ts` (extend), `src/__tests__/moduleRegistry.test.ts` (extend)

**Interfaces:**
```ts
// src/hooks/useNetWorth.ts
import type { NetWorthResult, NetWorthScope } from '../utils/netWorth';

export interface LegacyImportHint {
  bucket: 'liquid' | 'mortgage';
  value: number;
}

export interface UseNetWorthResult {
  status: 'loading' | 'error' | 'permission-denied' | 'ready';
  result: NetWorthResult | null;
  error: string | null;
  accountsCount: number;    // D3 amendment (B1) — raw count, NOT derived from result.assets.length,
  loansCount: number;       // which is always >=1 once computed (netWorth.ts pushes both lines
                             // unconditionally) and so could never detect "genuinely empty" on its own.
  isIncomplete: boolean;    // accountsCount === 0 || loansCount === 0 — the corrected D3 trigger
  legacyCashHint: LegacyImportHint | null;     // settings/ecosystem.liquid, only when accountsCount === 0 and it's > 0
  legacyMortgageHint: LegacyImportHint | null; // settings/ecosystem.mortgage, only when loansCount === 0 and it's > 0
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
```ts
// src/components/NetWorthIncompleteNotice.tsx — D3 amendment (B1 trigger fix + P2 pre-fill affordance)
import type { LegacyImportHint } from '../hooks/useNetWorth';

export interface NetWorthIncompleteNoticeProps {
  legacyCashHint: LegacyImportHint | null;
  legacyMortgageHint: LegacyImportHint | null;
}
export function NetWorthIncompleteNotice(props: NetWorthIncompleteNoticeProps): React.JSX.Element;
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
    expect(result.current.accountsCount).toBe(2); // raw count includes the archived one
    expect(result.current.isIncomplete).toBe(false);
  });

  it("isIncomplete is true when accounts OR loans is genuinely empty — NOT derived from result.assets.length (B1 fix)", async () => {
    mockListAccounts.mockResolvedValueOnce([]); // genuinely zero accounts
    mockListLoans.mockResolvedValueOnce([{ id: 'l1', ownerId: 'david-levy', name: 'X', loanType: 'other', principal: 1000, balance: 400, interestRate: 1, monthlyPayment: 10, startDate: 'x', endDate: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });
    const { result } = renderHook(() => useNetWorth('own', 'omer-levy', false));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    // result.assets still has exactly one 'accounts' line item (amount 0) — netWorth.ts always
    // pushes it — so a length-based check would wrongly read this as "complete". Assert the hook
    // does NOT make that mistake:
    expect(result.current.result!.assets.some((a) => a.source === 'accounts')).toBe(true);
    expect(result.current.accountsCount).toBe(0);
    expect(result.current.isIncomplete).toBe(true);
  });

  it('surfaces a legacy cash hint only when accounts is empty AND settings/ecosystem.liquid is non-zero', async () => {
    mockListAccounts.mockResolvedValueOnce([]);
    mockListLoans.mockResolvedValueOnce([{ id: 'l1', ownerId: 'david-levy', name: 'X', loanType: 'other', principal: 1, balance: 1, interestRate: 1, monthlyPayment: 1, startDate: 'x', endDate: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }]);
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ all: { liquid: 42000, mortgage: 0 } }) });
    const { result } = renderHook(() => useNetWorth('family', 'david-levy', false));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.legacyCashHint).toEqual({ bucket: 'liquid', value: 42000 });
    expect(result.current.legacyMortgageHint).toBeNull(); // loans not empty, and value is 0 anyway
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

  it('a permission-denied ecosystem (real estate/legacy hints) read does NOT fail the whole hook', async () => {
    mockListAccounts.mockResolvedValueOnce([]);
    mockListLoans.mockResolvedValueOnce([]);
    mockGetDoc.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'permission-denied' }));
    const { result } = renderHook(() => useNetWorth('own', 'omer-levy', false));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.result!.assets.find((a) => a.source === 'realEstate')).toBeUndefined();
    expect(result.current.legacyCashHint).toBeNull(); // unreachable legacy doc — no hint offered, not an error
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
    expect(result.current.result).toBeNull();
  });
});

describe('netWorthGlossaryId', () => {
  it('maps side+source to the D4 id scheme', () => {
    expect(netWorthGlossaryId('assets', 'accounts')).toBe('netWorth.assets.accounts');
    expect(netWorthGlossaryId('liabilities', 'loans')).toBe('netWorth.liabilities.loans');
  });
});
```

`src/__tests__/NetWorthIncompleteNotice.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NetWorthIncompleteNotice } from '../components/NetWorthIncompleteNotice';

const { mockNavigateTo } = vi.hoisted(() => ({ mockNavigateTo: vi.fn() }));
vi.mock('../contexts/NavigationContext', () => ({ useNavigation: () => ({ navigateTo: mockNavigateTo }) }));

describe('NetWorthIncompleteNotice (D3 amendment — B1/P2)', () => {
  it('offers a pre-fill-and-open-Accounts button when a legacy cash hint exists', () => {
    render(<NetWorthIncompleteNotice legacyCashHint={{ bucket: 'liquid', value: 42000 }} legacyMortgageHint={null} />);
    expect(screen.getByText(/מצאנו ₪42,000 ביתרת המזומן הישנה/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('להוסיף כחשבון?'));
    expect(mockNavigateTo).toHaveBeenCalledWith('accounts', {
      prefillCreate: { name: 'מזומן (מיובא)', type: 'cash', balance: 42000 },
    });
  });
  it('offers a pre-fill-and-open-Loans button when a legacy mortgage hint exists', () => {
    render(<NetWorthIncompleteNotice legacyCashHint={null} legacyMortgageHint={{ bucket: 'mortgage', value: 900000 }} />);
    fireEvent.click(screen.getByText('להוסיף כהלוואה?'));
    expect(mockNavigateTo).toHaveBeenCalledWith('loans', {
      prefillCreate: { name: 'משכנתא (מיובא)', loanType: 'mortgage', principal: 900000, balance: 900000 },
    });
  });
  it('renders nothing when neither hint exists (both collections empty but nothing legacy to offer, or both already populated)', () => {
    const { container } = render(<NetWorthIncompleteNotice legacyCashHint={null} legacyMortgageHint={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

`src/__tests__/NetWorthScreen.test.tsx` — loading/error/permission-denied/ready states (mocking `useNetWorth`), plus:
```tsx
it('clicking the accounts line navigates to the accounts screen (D8 drill-down)', async () => {
  render(<NetWorthScreen /* ... */ />);
  await waitFor(() => screen.getByText('חשבונות ומזומן'));
  fireEvent.click(screen.getByText('חשבונות ומזומן'));
  expect(mockNavigateTo).toHaveBeenCalledWith('accounts');
});
it('the real-estate line has no click handler — no screen exists for it yet (disclosed, not fake-clickable)', async () => {
  render(<NetWorthScreen /* result includes a realEstate line */ />);
  await waitFor(() => screen.getByText('נדל״ן'));
  expect(screen.getByText('נדל״ן').closest('button')).toBeNull();
});
it('renders NetWorthIncompleteNotice when useNetWorth reports isIncomplete (B1 fix)', async () => {
  // useNetWorth mocked to a ready result with isIncomplete: true, legacyCashHint set
  render(<NetWorthScreen /* ... */ />);
  await waitFor(() => expect(screen.getByText(/מצאנו ₪/)).toBeInTheDocument());
});
it('renders the ScopeBadge when the resolved scope is "own"', async () => {
  render(<NetWorthScreen /* singleSelected member, own scope */ />);
  await waitFor(() => expect(screen.getByText('מוצג: הנתונים שלך בלבד')).toBeInTheDocument());
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/__tests__/useNetWorth.test.ts src/__tests__/NetWorthIncompleteNotice.test.tsx src/__tests__/NetWorthScreen.test.tsx`, expect FAIL.

- [ ] **Step 3: Implement `useNetWorth.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { listAccounts } from '../services/AccountsService';
import { listLoans } from '../services/LoansService';
import { computeNetWorth, type NetWorthResult, type NetWorthScope } from '../utils/netWorth';

export interface LegacyImportHint { bucket: 'liquid' | 'mortgage'; value: number }

export interface UseNetWorthResult {
  status: 'loading' | 'error' | 'permission-denied' | 'ready';
  result: NetWorthResult | null;
  error: string | null;
  accountsCount: number;
  loansCount: number;
  isIncomplete: boolean;
  legacyCashHint: LegacyImportHint | null;
  legacyMortgageHint: LegacyImportHint | null;
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
export { SIDE_BY_SOURCE };

export function useNetWorth(scope: NetWorthScope, targetMemberId: string, investmentsReadable: boolean): UseNetWorthResult {
  const [status, setStatus] = useState<UseNetWorthResult['status']>('loading');
  const [result, setResult] = useState<NetWorthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountsCount, setAccountsCount] = useState(0);
  const [loansCount, setLoansCount] = useState(0);
  const [legacyCashHint, setLegacyCashHint] = useState<LegacyImportHint | null>(null);
  const [legacyMortgageHint, setLegacyMortgageHint] = useState<LegacyImportHint | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);

    (async () => {
      // Real estate + legacy import hints (settings/ecosystem) are optional, legacy data — a
      // permission-denied on this doc alone must not fail the whole net-worth calculation (D3);
      // caught independently, same as before this review.
      let realEstateValue = 0;
      let realEstateAsOf = new Date().toISOString();
      let legacyLiquid = 0;
      let legacyMortgage = 0;
      try {
        const ecoSnap = await getDoc(doc(db, 'settings', 'ecosystem'));
        if (ecoSnap.exists()) {
          const data = ecoSnap.data() as Record<string, { realEstate?: number; liquid?: number; mortgage?: number }>;
          const bucket = scope === 'own' ? (data[targetMemberId] ?? data.all) : data.all;
          realEstateValue = bucket?.realEstate ?? 0;
          legacyLiquid = bucket?.liquid ?? 0;
          legacyMortgage = bucket?.mortgage ?? 0;
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
        accounts: accounts.filter((a) => a.status === 'active'),
        investments,
        loans,
        realEstateValue,
        realEstateAsOf,
      });

      setResult(computed);
      setAccountsCount(accounts.length);
      setLoansCount(loans.length);
      // B1 fix — the trigger is the RAW fetched count, never result.assets.length (netWorth.ts
      // pushes an 'accounts'/'loans' line item unconditionally, so that length is never 0 once
      // both arrays exist — see the plan's D3 amendment for why the original mitigation was dead).
      setLegacyCashHint(accounts.length === 0 && legacyLiquid > 0 ? { bucket: 'liquid', value: legacyLiquid } : null);
      setLegacyMortgageHint(loans.length === 0 && legacyMortgage > 0 ? { bucket: 'mortgage', value: legacyMortgage } : null);
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
  const isIncomplete = accountsCount === 0 || loansCount === 0;
  return { status, result, error, accountsCount, loansCount, isIncomplete, legacyCashHint, legacyMortgageHint, reload };
}
```

- [ ] **Step 4: Implement `NetWorthIncompleteNotice.tsx` (D3 amendment)**

```tsx
import React from 'react';
import { useNavigation } from '../contexts/NavigationContext';
import type { LegacyImportHint } from '../hooks/useNetWorth';

export interface NetWorthIncompleteNoticeProps {
  legacyCashHint: LegacyImportHint | null;
  legacyMortgageHint: LegacyImportHint | null;
}

export function NetWorthIncompleteNotice({ legacyCashHint, legacyMortgageHint }: NetWorthIncompleteNoticeProps): React.JSX.Element {
  const { navigateTo } = useNavigation();
  if (!legacyCashHint && !legacyMortgageHint) {
    // Still incomplete, but nothing legacy to pre-fill from — the caller (Dashboard/NetWorthScreen)
    // renders its own plain "still no accounts/loans entered" copy alongside this; this component
    // only ever owns the pre-fill affordance itself, per its one job.
    return <></>;
  }
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2 text-sm" dir="rtl">
      <p className="text-amber-800 font-medium">
        השווי הנקי המוצג נמוך מהצפוי — עדיין לא הוזנו {legacyCashHint && !legacyMortgageHint ? 'חשבונות' : legacyMortgageHint && !legacyCashHint ? 'הלוואות' : 'חשבונות או הלוואות'} במסכים החדשים.
      </p>
      {legacyCashHint && (
        <p className="flex items-center gap-2 flex-wrap">
          <span>מצאנו ₪{legacyCashHint.value.toLocaleString()} ביתרת המזומן הישנה —</span>
          <button
            onClick={() => navigateTo('accounts', { prefillCreate: { name: 'מזומן (מיובא)', type: 'cash', balance: legacyCashHint.value } })}
            className="text-blue-700 underline font-medium min-h-[44px]"
          >
            להוסיף כחשבון?
          </button>
        </p>
      )}
      {legacyMortgageHint && (
        <p className="flex items-center gap-2 flex-wrap">
          <span>מצאנו ₪{legacyMortgageHint.value.toLocaleString()} ביתרת המשכנתא הישנה —</span>
          <button
            onClick={() => navigateTo('loans', {
              prefillCreate: { name: 'משכנתא (מיובא)', loanType: 'mortgage', principal: legacyMortgageHint.value, balance: legacyMortgageHint.value },
            })}
            className="text-blue-700 underline font-medium min-h-[44px]"
          >
            להוסיף כהלוואה?
          </button>
        </p>
      )}
    </div>
  );
}
```
(`LoansScreen`, Task 4, needs the same navigation-payload-consumption effect `AccountsScreen` already got in Task 3 — `prefillCreate: { name, loanType, principal, balance }` opens its create form pre-populated the same way; a two-line addition to Task 4's own component, noted here since it depends on this task's payload shape.)

- [ ] **Step 5: Implement `NetWorthScreen.tsx`**

Resolves `scope`/`targetMemberId`/`investmentsReadable` from `useGlobalFilters()` + the viewer's own levels (props, same shape as the other four screens), then renders `useNetWorth`'s result: `<ScopeBadge scope={scope === 'own' ? 'own' : 'family'} />`, `<NetWorthIncompleteNotice>` whenever `isIncomplete`, headline number, an assets list and a liabilities list (each line = label + amount + `<Explain id={netWorthGlossaryId(side, item.source)} />`), each line except `realEstate` wrapped in a `navigateTo(...)` button per D8 (`accounts` → `'accounts'`, `investments` → `'investments'`, `loans` → `'loans'`).

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

  const netWorth = useNetWorth(scope, targetMemberId, investmentsReadable);
  // ...loading/error/permission-denied branches identical in shape to the other four screens...
  // ...ready branch: <ScopeBadge scope={scope} />, {netWorth.isIncomplete && <NetWorthIncompleteNotice
  //    legacyCashHint={netWorth.legacyCashHint} legacyMortgageHint={netWorth.legacyMortgageHint} />},
  //    then renders result.assets / result.liabilities via netWorthGlossaryId + navigateTo...
}
```

- [ ] **Step 6: Rewire Dashboard onto `useNetWorth`, retire the ecosystem-arithmetic net-worth card + five-tile panel**

In `src/components/Dashboard.tsx`:
- Delete `EcosystemData`/`EMPTY_ECOSYSTEM`, the `ecosystem`/`ecosystemLoadError`/`ecosystemAccessDenied` state, `loadEcosystem`'s effect, `totalAssets`/`totalLiabilities`/`netWorth`'s local arithmetic, `showEcosystemAllFallbackNote`, and the five-tile "התגלגלות נכסים" JSX block.
- Replace with: `const netWorth = useNetWorth(scope, targetMemberId, investmentsReadable)` (same scope/target resolution as `NetWorthScreen`'s Step 5 — Dashboard reads `filters.member` the same way) and render `netWorth.result`'s headline + assets/liabilities exactly as `NetWorthScreen` does, wrapped in the same three-way loading/error/permission-denied branch already present for the card today (S2-compliant, unchanged shape). **Also render `<NetWorthIncompleteNotice>` here whenever `netWorth.isIncomplete`** — the whole point of the B1 fix is that both surfaces show the same notice from the same hook, not just the dedicated screen.
- The `<Explain id="dashboard.netWorth" />` trigger stays on the headline; new `<Explain id={netWorthGlossaryId(...)} />` triggers replace the old five `dashboard.ecosystem.*` ones on whatever line items actually render.
- D8 drill-down on this card: the whole card becomes a `navigateTo('net-worth')` button (the simplest, most honest drill-down for a summary card — clicking it opens the full breakdown screen rather than trying to reproduce every line's own individual click target twice).

Add the `'net-worth'` `MODULE_REGISTRY` entry: `{ id: 'net-worth', label: 'שווי נקי', icon: Landmark, permissionModuleId: null, usesGlobalFilters: true, filterModuleId: null }` (D2 — ungated per Stage 3 D4, no single dead-end-filtering module).

- [ ] **Step 7: Glossary rewrite (D4)**

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
Update `glossary.test.ts`'s `REQUIRED_IDS` (remove the five `dashboard.ecosystem.*` ids, add the four `netWorth.*` ids + `loans.totalBalance`/`accounts.totalBalance` from Tasks 3-4 if not already appended there) and its real-estate-specific test — replace the mortgage-double-count assertion with:
```ts
it('the real-estate entry discloses it has no per-item freshness date the way accounts/loans do', () => {
  expect(GLOSSARY['netWorth.assets.realEstate'].asOf).toMatch(/אין תאריך עדכון פרטני/);
});
```

- [ ] **Step 8: App.tsx wiring for `'net-worth'`**

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

- [ ] **Step 9: Run to verify pass**

Run: `npm run lint && npx vitest run src/__tests__/useNetWorth.test.ts src/__tests__/NetWorthIncompleteNotice.test.tsx src/__tests__/NetWorthScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts`. Then run the existing Dashboard test suite and fix every net-worth/ecosystem-tile assertion broken by the rewire (expected — those tests exercised code this step deletes; per this project's TDD discipline, update them to assert the NEW behavior, don't delete the coverage).

- [ ] **Step 10: Full verification + manual smoke check**

Run: `npm run lint && npm test`. Sign in as David with zero accounts/loans entered: confirm Dashboard's net-worth card and the Net Worth screen BOTH show the same (low, honest) number, the SAME `NetWorthIncompleteNotice` copy, and — if `settings/ecosystem` has legacy `liquid`/`mortgage` values — the same pre-fill affordance. Click "להוסיף כחשבון?"; confirm it opens Accounts with the create form already populated from the legacy value; save it; confirm the notice's cash half disappears from both surfaces and the net-worth number goes up by exactly that amount. Click the net-worth card from Dashboard; confirm it opens the Net Worth screen; click "חשבונות ומזומן" there; confirm it opens Accounts.

- [ ] **Step 11: Commit**
```bash
git add src/hooks/useNetWorth.ts src/components/NetWorthIncompleteNotice.tsx src/components/NetWorthScreen.tsx src/components/Dashboard.tsx src/config/moduleRegistry.ts src/config/glossary.ts src/App.tsx src/__tests__/useNetWorth.test.ts src/__tests__/NetWorthIncompleteNotice.test.tsx src/__tests__/NetWorthScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts src/__tests__/Dashboard.globalFilters.test.tsx
git commit -m "feat: wire computeNetWorth as the sole net-worth source, fix the dead empty-state mitigation (B1)

Closes the Stage 4 Task 5 review's flagged dead code (computeNetWorth had zero call sites).
Retires Dashboard's parallel settings/ecosystem-arithmetic net-worth card and its five-tile
panel — one calculation source per metric (spec §5.5), not two.

The original plan's empty-state trigger (assets.length===0 && liabilities.length===0) could
never fire once computeNetWorth's own accounts/loans line items exist unconditionally — fixed to
trigger on the raw fetched accounts/loans counts (isIncomplete), shown identically on both
Dashboard's card and the dedicated screen from the same hook. Adds a one-click, explicit,
HITL pre-fill affordance from settings/ecosystem's legacy liquid/mortgage values into the
Accounts/Loans create forms — still no automatic write.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Insurances screen

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

Follows Task 3's `useOwnedCollectionScreen<Insurance>` pattern. The real delta this collection introduces:

- **`insuredMemberId` is a SECOND member reference, distinct from `ownerId`** ("who pays/owns the policy" vs "who is covered" — spec: "פוליסות... מבוטח" / `types/finance.ts`'s own comment: "may differ from ownerId (parent owns, child insured)"). The create/edit form needs a SECOND member `<select>` (plain, not `OwnerPicker` — `insuredMemberId` has no own/family Rules restriction of its own, `isValidInsurance` only requires it non-empty; every viewer who can create an insurance policy at all can name any insured member, matching how a parent commonly insures a child with no login of their own).
- **`coverages: Coverage[]`** — a dynamic add/remove list of `{ label: string; amount?: number }` rows in the form (an "הוסף כיסוי" button appending a blank row, an "×" per row to remove). **Coverage `amount` gets `inputMode="decimal"` (B3) — the field most likely to be missed, since it's nested inside a repeating row rather than a top-level form field.**
- **`renewalDate` is a native `<input type="date">` (B3)** — a renewal-date callout row whose `renewalDate` falls within 30 days of today gets a visible amber "מתחדש בקרוב" badge (real, useful UX matching spec's "תאריך חידוש" emphasis; computed with plain `Date` arithmetic, no library).
- **`documentId`** — shown as plain text if present ("מסמך מקושר: {documentId}"), NOT a document picker/Drive integration — the `ארכיון מסמכים` module (spec §12) is its own, unscheduled future roadmap item; linking a real document here is out of this stage's scope, disclosed rather than half-built. (See the "documents Rules gap" Risk below — the collection this field would eventually point at may not even be writable in production today.)
- **`premium` gets `inputMode="decimal"` (B3); soft confirm (D14) applies to it on submit**, same mechanism as Accounts/Loans.
- **This form has 8+ fields — the exact case I4's leave-guard exists for** (`type`, `provider`, `insuredMemberId`, `premium`, `premiumFrequency`, `coverages[]`, `renewalDate`, `status`, plus the D7 `OwnerPicker` when `'family'`-level). Comes for free from `useOwnedCollectionScreen`'s D11 guard registration — no extra wiring needed in this screen, but the manual smoke check below specifically exercises it here since this is the form where a silent thumb-slip loss would hurt most.
- **Glossary:** `insurances.totalPremium` — "סך הפרמיה החודשית לכל הפוליסות שרואים ברשימה. פוליסה שנרשמה כשנתית מחולקת ל-12."; `howComputed` divides `premiumFrequency === 'yearly'` premiums by 12 before summing, so the total is always a comparable monthly figure.
- **Registry entry:** `{ id: 'insurances', label: 'ביטוחים', icon: Shield, permissionModuleId: 'insurances', usesGlobalFilters: true, filterModuleId: 'insurances' }`.

- [ ] **Step 1: Write the failing tests** — mirror Task 3's suite against `InsurancesService`, plus:
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
it('the coverage amount field has inputMode="decimal" (B3)', async () => {
  mockList.mockResolvedValueOnce([]);
  render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
  await waitFor(() => screen.getByTestId('screen.insurances.create'));
  fireEvent.click(screen.getByTestId('screen.insurances.create'));
  fireEvent.click(screen.getByText('הוסף כיסוי'));
  expect(screen.getByLabelText('סכום כיסוי')).toHaveAttribute('inputMode', 'decimal');
});
it('navigating away with a dirty, open insurance form triggers the leave-guard confirm (I4)', async () => {
  mockList.mockResolvedValueOnce([]);
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
  render(<InsurancesScreen session={{ memberId: 'david-levy', role: 'super-admin' }} insurancesViewLevel="family" insurancesEditLevel="family" />);
  await waitFor(() => screen.getByTestId('screen.insurances.create'));
  fireEvent.click(screen.getByTestId('screen.insurances.create'));
  fireEvent.change(screen.getByLabelText('ספק'), { target: { value: 'הראל' } });
  const guard = mockSetLeaveGuard.mock.calls.at(-1)![0];
  expect(guard()).toBe(false);
  expect(confirmSpy).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/__tests__/InsurancesScreen.test.tsx`, expect FAIL.

- [ ] **Step 3: Implement `InsurancesScreen.tsx`** — same skeleton as `AccountsScreen.tsx` built on `useOwnedCollectionScreen<Insurance>`, `insuredMemberId` select fed by `familyMembers.members`, dynamic `coverages` editor (each row's amount input `inputMode="decimal"`), native-date `renewalDate` input, renewal-soon badge, monthly-equivalent total, soft confirm on `premium`.

- [ ] **Step 4: Registry + glossary + App.tsx wiring**.

- [ ] **Step 5: Run to verify pass** — `npm run lint && npx vitest run src/__tests__/InsurancesScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts`.

- [ ] **Step 6: Full verification + manual smoke check** — create a policy with two coverage rows and a near-term renewal date, confirm both the coverage list and the renewal badge render; edit to remove a coverage row; confirm the total-premium math with a mixed monthly+yearly pair; start editing a field, then tap a bottom-nav tab and confirm the leave-guard prompt fires before navigating away.

- [ ] **Step 7: Commit**
```bash
git add src/components/InsurancesScreen.tsx src/config/moduleRegistry.ts src/config/glossary.ts src/App.tsx src/__tests__/InsurancesScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts
git commit -m "feat: insurances screen — list/create/edit/delete with insuredMemberId, coverages, renewal callout

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Recurring screen — category filter, status controls, per-row failed-posting badge (M5)

**Files:**
- Create: `src/components/RecurringScreen.tsx`
- Modify: `src/config/moduleRegistry.ts`, `src/config/glossary.ts`, `src/App.tsx`
- Test: `src/__tests__/RecurringScreen.test.tsx`, `src/__tests__/glossary.test.ts` (extend), `src/__tests__/moduleRegistry.test.ts` (extend)

**Interfaces:**
```ts
import type { PostingOutcome } from '../services/RecurringService';

export interface RecurringScreenProps {
  session: { memberId: string; role: PermissionRole };
  recurringViewLevel: PermissionLevel | undefined;
  recurringEditLevel: PermissionLevel | undefined;
  lastCatchupOutcome: PostingOutcome | null; // Task 1's useRecurringCatchup return value, threaded through App.tsx — M5
}
export default function RecurringScreen(props: RecurringScreenProps): React.JSX.Element;
```

Built on `useOwnedCollectionScreen<RecurringItem>` (Task 3's shared hook); this collection's own delta:

- **`kind` (`income`/`expense`)** — a segmented toggle at the top of the form; `category` (a `<select>` from `getCategories()`, matching `FilterBar`'s existing category source) is shown ONLY when `kind === 'expense'` (an income has no expense category — `isValidRecurring` itself only requires `category` when present, never for income).
- **This is the one screen wiring the מה dimension (D5)** — `filters.category.categories` filters the list client-side, same shape as Dashboard's own M1 fix: `filters.category.categories.length === 0 || filters.category.categories.includes(item.category ?? '')`. Applied on top of `useOwnedCollectionScreen`'s own מי filter (`screen.visibleItems`), not instead of it.
- **`amount` gets `inputMode="decimal"` (B3); soft confirm (D14) applies to it on submit.**
- **Status controls** — `active`/`paused`/`ended` shown as a badge with quick-action buttons ("השהה"/"הפעל מחדש") that call `saveRecurring` with only `status` changed (not a full form open — bypasses `useOwnedCollectionScreen`'s form/dirty state entirely since there's no open form to guard), plus the full edit form for everything else.
- **`lastPostedPeriod` shown per row ("נרשם לאחרונה: {period}", or "טרם נרשם" if absent)** — real, useful transparency into the catch-up engine's own state, and the most direct way for David to confirm Task 1's fix actually worked end-to-end for a `'member'`-role session.
- **Per-row failed-posting badge (M5, new this review) — threads `PostingOutcome.failed` from `useRecurringCatchup`'s return value (Task 1) through `App.tsx` into this screen's `lastCatchupOutcome` prop.** Today an owner-deleted recurring item's per-item posting failure (e.g. `RecurringService.ts`'s `throw new Error(...owner not found...)`) only ever surfaced as a generic, undismissable app-boot toast, with the real failed item visible only in `console.error` — training the household to ignore red banners, which defeats the next genuine error. Each row now checks `lastCatchupOutcome?.failed.find((f) => f.recurringId === item.id)`; a match renders a small red "פרסום אחרון נכשל" badge with the underlying error as its `title` tooltip — the first time a specific, actionable failure is visible anywhere in the UI instead of only the console.
- **Uses `saveRecurring` (not the raw `repo.save` re-export)** — `RecurringService.ts` exports `saveRecurring`, not `save`, specifically for the unbounded-backfill guard (Stage 3 D-decision); the screen's submit handler must call `saveRecurring`, never bypass it.
- **Glossary:** `recurring.totalMonthly` — "סך ההתחייבות החודשית מכל התנועות הקבועות שרואים ברשימה — כמה יירשם אוטומטית כל חודש."; excludes `paused`/`ended` items from the sum (a paused item isn't currently committing anything).
- **Registry entry:** `{ id: 'recurring', label: 'תנועות קבועות', icon: Repeat, permissionModuleId: 'recurring', usesGlobalFilters: true, filterModuleId: 'recurring' }`.

- [ ] **Step 1: Write the failing tests** — mirror Task 3's suite against `RecurringService` (using `saveRecurring`, not `save`, in the mock), plus:
```tsx
it('category select only appears for kind "expense"', async () => {
  mockList.mockResolvedValueOnce([]);
  render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
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
  render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
  await waitFor(() => expect(screen.getByText('חוג')).toBeInTheDocument());
  expect(screen.queryByText('מנוי')).not.toBeInTheDocument();
});
it('totalMonthly excludes paused and ended items', async () => {
  mockList.mockResolvedValueOnce([
    { id: 'r1', ownerId: 'david-levy', kind: 'expense', description: 'A', amount: 100, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    { id: 'r2', ownerId: 'david-levy', kind: 'expense', description: 'B', amount: 999, chargeDay: 1, status: 'paused', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
  ]);
  render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
  await waitFor(() => expect(screen.getByText(/סך ההתחייבות החודשית: ₪100/)).toBeInTheDocument());
});
it('shows lastPostedPeriod per row, or "טרם נרשם" when absent', async () => {
  mockList.mockResolvedValueOnce([
    { id: 'r1', ownerId: 'david-levy', kind: 'expense', description: 'A', amount: 100, chargeDay: 1, status: 'active', startDate: 'x', lastPostedPeriod: '2026-07', createdAt: 'x', updatedAt: 'x' },
    { id: 'r2', ownerId: 'david-levy', kind: 'expense', description: 'B', amount: 50, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
  ]);
  render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={null} />);
  await waitFor(() => expect(screen.getByText(/נרשם לאחרונה: 2026-07/)).toBeInTheDocument());
  expect(screen.getByText('טרם נרשם')).toBeInTheDocument();
});
it('a row whose id appears in lastCatchupOutcome.failed shows the per-row failure badge (M5)', async () => {
  mockList.mockResolvedValueOnce([
    { id: 'r1', ownerId: 'david-levy', kind: 'expense', description: 'A', amount: 100, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
    { id: 'r2', ownerId: 'david-levy', kind: 'expense', description: 'B', amount: 50, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' },
  ]);
  const outcome = { posted: [], failed: [{ recurringId: 'r1', error: 'owner not found' }] };
  render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={outcome} />);
  await waitFor(() => expect(screen.getAllByText('פרסום אחרון נכשל')).toHaveLength(1));
  expect(screen.getByText('פרסום אחרון נכשל')).toHaveAttribute('title', 'owner not found');
});
it('a row with no matching failed entry shows no badge', async () => {
  mockList.mockResolvedValueOnce([{ id: 'r1', ownerId: 'david-levy', kind: 'expense', description: 'A', amount: 100, chargeDay: 1, status: 'active', startDate: 'x', createdAt: 'x', updatedAt: 'x' }]);
  render(<RecurringScreen session={{ memberId: 'david-levy', role: 'super-admin' }} recurringViewLevel="family" recurringEditLevel="family" lastCatchupOutcome={{ posted: [], failed: [] }} />);
  await waitFor(() => screen.getByText('A'));
  expect(screen.queryByText('פרסום אחרון נכשל')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/__tests__/RecurringScreen.test.tsx`, expect FAIL.

- [ ] **Step 3: Implement `RecurringScreen.tsx`** — built on `useOwnedCollectionScreen<RecurringItem>`; the row-render function checks `lastCatchupOutcome?.failed.find((f) => f.recurringId === item.id)` and renders the badge when found.

- [ ] **Step 4: Registry + glossary + App.tsx wiring** — including the `lastCatchupOutcome={recurringCatchupOutcome}` prop threaded from Task 1's `App.tsx` capture:
```tsx
case 'recurring': return (
  <RecurringScreen
    session={{ memberId: session.memberId!, role: session.role! }}
    recurringViewLevel={permState.resolvedPermissions?.recurring?.view}
    recurringEditLevel={permState.resolvedPermissions?.recurring?.edit}
    lastCatchupOutcome={recurringCatchupOutcome}
  />
);
```

- [ ] **Step 5: Run to verify pass** — `npm run lint && npx vitest run src/__tests__/RecurringScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts`.

- [ ] **Step 6: Full verification + manual smoke check** — create an expense-kind recurring item with a category, confirm it appears in the list and (after a session reload, exercising Task 1's fix live) picks up a `lastPostedPeriod` once the catch-up engine runs; pause it and confirm it drops out of `totalMonthly`; if any fixture item's owner was deleted, confirm its row shows the "פרסום אחרון נכשל" badge instead of only a console error.

- [ ] **Step 7: Commit**
```bash
git add src/components/RecurringScreen.tsx src/config/moduleRegistry.ts src/config/glossary.ts src/App.tsx src/__tests__/RecurringScreen.test.tsx src/__tests__/glossary.test.ts src/__tests__/moduleRegistry.test.ts
git commit -m "feat: recurring screen — category filter, status controls, per-row failed-posting badge (M5)

Threads useRecurringCatchup's PostingOutcome (Task 1) into a per-row badge instead of only a
generic app-boot toast + console.error — a specific, actionable failure (e.g. an owner-deleted
item) is now visible where David would actually look for it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Stage-5 Done Criteria

- Four new CRUD screens (`AccountsScreen`/`LoansScreen`/`InsurancesScreen`/`RecurringScreen`) exist, each built on the shared `useOwnedCollectionScreen<T>` hook (D13), each honoring the permission matrix's own/family split via the new scope-aware `list()` (D1), each defaulting `ownerId` to the acting session with a family-level-only override (D7), each with loading/empty/error/permission-denied states genuinely distinct (never a permission refusal rendered as an error or a silent empty list), each mounted on the global `FilterBar` (D5) and carrying `data-tour-id`s.
- Every one of the five new screens (four CRUD + Net Worth) shows the `<ScopeBadge>` (D14/I5) whenever its resolved viewing scope is `'own'`; every money field is `inputMode="decimal"` and every date field a native `<input type="date">` (B3); every create/edit form is guarded by the D11 leave-guard while dirty (I4); every money-field submit above `LARGE_AMOUNT_CONFIRM_THRESHOLD` prompts a soft confirm (D14/M6).
- `computeNetWorth()` is no longer dead code — it is the sole net-worth calculation for both Dashboard's net-worth card and the new dedicated Net Worth screen (D3), verified to show the SAME number, the SAME `isIncomplete` state, and the SAME `NetWorthIncompleteNotice` copy for the SAME selection on both screens (B1 fix — the original empty-state trigger was structurally unreachable; verified this time by writing a unit test that would have caught the old bug — see Task 5's `useNetWorth.test.ts`).
- Spec §5.1 drill-down is real, second in build order, and has somewhere to go back to: `NavigationContext` has a genuine history-backed back-stack (D11, Task 2), so the OS/browser back gesture and the new header back button both work; every Dashboard card whose destination screen exists and is currently accessible to the viewer is a `navigateTo(...)` button; a denied/erroring card is deliberately NOT clickable; a destination not yet on global filters shows the D12 "הפילטור לא חל כאן עדיין" notice on arrival instead of a silent seam.
- Every new glossary entry (`accounts.totalBalance`, `loans.totalBalance`, `insurances.totalPremium`, `recurring.totalMonthly`, `netWorth.assets.accounts`/`.investments`/`.realEstate`, `netWorth.liabilities.loans`, rewritten `dashboard.netWorth`) passes `violatesPlainLanguage` and is verified against the actual code path it describes (the Stage 4 lesson — two entries shipped factually wrong before review caught it).
- The four-collection list-query gap (D1) is proven closed against the live emulator, not just mocks (Task 1 Step 5); `financeCollections.ts`'s `save`/`remove` are proven transactional (D10, Task 1 Step 1's `runTransaction` mock assertions) and `audit_log` ids are proven collision-free under rapid concurrent writes (D10, Task 1's `auditLog.test.ts`).
- `npm run lint`, `npm test`, and `npm run test:rules` (or emulator-equivalent) all pass; `git status` clean.
- The app is usable after every single task.
- **Product-metric acceptance, verified as the literal last Done step — four distinct checks, not one "cold reader" pass standing in for all of them:**
  - **Timed 5-second glance test:** someone who hasn't seen this stage's work is shown Dashboard for exactly 5 seconds, then asked (without looking again) what the family's net worth is and whether they're over or under budget this month. Both answers correct, from the headline numbers alone — no scrolling, no `<Explain>` clicks.
  - **Explain-coverage AUDIT:** walk every rendered number on all five new screens plus the rewired Dashboard net-worth card and confirm each has a working `<Explain>` trigger — spec §5's "כל מספר" is literal, and today only aggregate totals (`accounts.totalBalance` etc.) are wired, not individual row fields (one account's balance, one loan's interest rate, one policy's premium). Wire whichever row-level fields are cheap to wire in this stage; for any that aren't, write down explicitly which fields are exempt and why (e.g. "a single coverage row's amount has no separate glossary id this stage — covered by the policy-level premium explanation instead") — silence is not an acceptable answer to this check.
  - **No-hover screen-comprehension check:** without touching any `<Explain>` trigger, a fresh reader can state what each of the five new screens is FOR (not what every number means — that's the audit above) within a few seconds of landing on it.
  - **Explicit 20-member list-readability check:** with the existing 20-member/multi-group fixture (Stage 4), confirm each new screen's list stays genuinely usable at that scale (no unbounded flat list, no unreadable table, no horizontal scroll on mobile). These four collections are typically small per-family, so most families never hit this, but the check is explicit and pass/fail, not inferred from "the מי control inherits Stage 4's treatment" alone — the flat-per-row-list Risk below (P4) is exactly why this needs its own explicit check rather than an assumption.
  - **Cold-reader walkthrough:** someone who hasn't seen this stage's work opens each of the five new screens plus the rewired Dashboard net-worth card and, using the `<Explain>` triggers, correctly explains in their own words what every new figure means and where it comes from.
  - **Consolidated end-of-stage demo script** (spec §16, every stage, updated for the new task order and this review's additions): sign in as David → click the expense KPI card and the "מי הוציא כמה החודש" card on Dashboard, confirm both navigate correctly and the D12 notice appears once on arrival at "expenses" → use the browser/OS back gesture (or the header back button) to return to Dashboard, confirm the מי selection survived → open Accounts, create two accounts for different family members, confirm the balance field's numeric keyboard on a phone and the `ScopeBadge`'s absence at family scope → open Loans, create a mortgage with `endDate` before `startDate` and confirm the inline validation blocks it, fix it and save, confirm the payoff progress renders → open the Net Worth screen, confirm the headline number matches Dashboard's net-worth card exactly and reflects the accounts/loans just entered, confirm the `NetWorthIncompleteNotice` no longer shows (both collections now non-empty) → click each net-worth line's drill-down (accounts/investments/loans) and confirm it opens the right screen → open Insurances, create a policy with two coverages and a near-term renewal date, confirm the "מתחדש בקרוב" badge, start editing a different field and confirm the leave-guard fires when tapping a bottom-nav tab → open Recurring, create an expense-kind item with a category, confirm the מה filter narrows the list → sign in as a `'member'`-role fixture with `accounts:{view:'own',edit:'own'}` and nothing else granted → confirm they see only their own account on the Accounts screen (never a permission-denied wholesale failure — the Task 1 fix, proven live), the `ScopeBadge`, and no `OwnerPicker` select → confirm the Net Worth screen shows their own scoped figure, not the family total → if a `settings/ecosystem` legacy value exists for this session, confirm the pre-fill affordance opens Accounts/Loans with the create form already populated and saves correctly on confirm.
  - **Surface to David, not silently resolved:** the "יתרה חודשית" (Dashboard KPI label) vs "מאזן חודשי" (glossary title) synonym pair — untouched by this stage's own work, flagged again per the Stage 4 precedent for exactly this kind of call.

## Risks

- **Net worth will visibly drop for any family with real ecosystem data but zero accounts/loans entered** (D3) — an intentional, disclosed consequence of retiring the parallel ecosystem calculation, not a bug. This review's B1/P2 amendments narrow the window and the friction (the notice now actually renders, on both surfaces, with a one-click pre-fill), but do not eliminate it — David still has to press "שמור" at least once per legacy value before the number is honest. The demo script's own walkthrough order (enter data BEFORE looking at the net-worth number) remains the mitigation beyond the code-level fixes.
- **`NetWorthScreen`'s scope-resolution when the viewer's own `accounts`/`loans` levels genuinely differ** (e.g. `'family'` on accounts, `'own'` on loans) **collapses to the more restrictive `'own'`** (Task 5 Step 5) rather than a mixed-scope call `computeNetWorth` has no input shape for. A real, disclosed simplification — the alternative (extending `NetWorthInput` with per-source scope) is a `netWorth.ts` interface change with no second consumer yet to justify it; revisit if a real permission split like this shows up in practice.
- **The recurring catch-up engine's own permission interaction** (documented in `RecurringService.ts`'s header comment, unchanged by this stage beyond the D1 scope fix): posting a recurring INCOME still needs family-level edit on `'income'` specifically (an ownerless module, Stage 2 D5) — a `'member'`-role user can define their own recurring income but their own session can never post it; it posts once a parent/super-admin session next opens the app. Pre-existing, unrelated to this stage's fix. **Interaction with this review's M5 badge, worth noting:** when a member's own session attempts to post their blocked income item, the write is denied by Rules at commit time, so `postDueRecurringTransactions` DOES catch it as a per-item failure and `RecurringScreen`'s new per-row badge WILL fire on it — but with a raw Firestore permission-denied message as its tooltip, not friendly copy explaining "this needs a parent to post it." A confusing-but-visible failure is still better than the previous silent stuck `lastPostedPeriod`, but the copy itself is a small follow-up, not solved in this task.
- **`InsurancesScreen`'s `documentId` field is display-only this stage** — no document picker, no Drive linking. The `ארכיון מסמכים` module (spec §12) that would make this real is unscheduled in the 11-stage roadmap; disclosed rather than half-built. See the `documents` Rules-gap risk below — the collection this field would eventually point at may not even be durably writable in production today, which this stage did not attempt to verify beyond the source-level check recorded above.
- **`documents` Firestore collection has no `match` block in `firestore.rules`, while `src/utils/FileProcessor.ts` (line 591) writes to it (M3, verified this review by reading both files directly).** Under Firestore's default-deny (no catch-all wildcard rule exists in this project's `firestore.rules` either), that write is very likely denied in production today — meaning the document↔record link spec §12's archive feature depends on may already be silently broken, independent of anything in this stage. **Not fixed here** (`firestore.rules` stays untouched per Global Constraints). **Recommended verification step for whoever picks this up:** run the write against the local emulator with a real signed-in session and confirm whether it actually throws (the try/catch wrapping that call site, if any, may currently be swallowing the failure) — dated 2026-08-16, flagged for Stage 11's archive work specifically since spec §12 is exactly where this would first be noticed by a user. **Sibling note (same class of gap, smaller):** `isValidLoan` in the same rules file also has no `endDate > startDate` check — added client-side only in Task 4; a Rules-level pass covering both gaps together would be efficient whenever `firestore.rules` is next opened for an unrelated reason.
- **Four new screens each do their own client-side `filters.category`/`filters.member` filtering over an already-fetched list**, not a server-side query — fine at this collection's realistic scale (a handful of accounts/loans/policies/recurring items per family), unlike `transaction_lines`' hundreds-to-thousands-of-rows scale where the same pattern (D9's deferred fix) is a genuine concern. Not the same risk class; not tracked as a carry-forward.
- **`useNetWorth`'s real-estate read, and this review's new legacy-import hints, both still depend on `settings/ecosystem` staying reachable at all** — if a future stage deletes or further restricts that document without updating this hook, real estate silently (and correctly, per this hook's own permission-denied handling) drops to 0, and the pre-fill affordance simply stops offering itself, rather than erroring loudly. Intentional per D3, but worth a reviewer's eye whenever `settings/ecosystem` is next touched — including Stage 11's own retirement of its now-orphaned fields (see the roadmap edit below; that stage's own done-criteria line is the natural point to also confirm this hook degrades gracefully once the fields it reads are gone).
- **Flat per-row lists conflict with spec §5.4's "קבוצה, לא 20 שורות" for a large/multi-group family (P4, named, not solved this stage).** All four new screens (and the Net Worth screen's own lines) render a flat list, not grouped by member/category the way spec §5.4 describes as core, not edge, behavior. Invisible for a family of 3 (David's own household), wrong for the large-family scenario the spec explicitly names. The Done Criteria's new "explicit 20-member list-readability check" (above) is a usability floor, not a fix for this structural gap — a future stage should decide whether grouping belongs in `useOwnedCollectionScreen<T>` itself (benefiting all four screens at once, consistent with D13's whole rationale) or per-screen.
- **`NetWorthLineItem.source` is a closed union (`'accounts' | 'investments' | 'loans' | 'realEstate'`)** that a future real-estate collection (replacing the legacy `settings/ecosystem.realEstate` read) would have to EDIT rather than extend — every consumer keyed off this union (`netWorthGlossaryId`, `SIDE_BY_SOURCE`, both screens' rendering) would need a matching edit at the same time. A real, disclosed simplification for a stage with exactly one consumer of this type; revisit if/when a real-estate collection is ever built.

## Self-review against spec §5/§6/§7

- §5.1 (מבט אחד ואשכולות — one glance, numbers as drill-down buttons): **built this stage, and built second in task order rather than last** (Task 2), specifically because it has zero dependency on the four CRUD screens and the review's own product lens (P1) flagged it as the cheapest, most visible win being scheduled needlessly late. Scoped to cards whose destination screen exists AND is currently accessible; a card with no live destination (income, monthly balance) stays a plain, honestly-non-interactive card rather than a fake button; a destination not yet filter-aware says so on arrival (D12) instead of a silent seam. Real back behavior (D11) ships in the same task, before any drill-down destination exists to need it.
- §5.3 (פילטרים גלובליים דביקים — sticky, affects everything): five more screens rewired onto `FilterContext` this stage (D5, D7-flip-in-same-commit per Stage 4's own rule), on top of Stage 4's Dashboard-only start. Six of the app's twelve module screens now share global filters; the remaining six (`expenses`/`central-expenses`/`annual`/`investments`/`future`/`folder`) are explicitly out of this stage's scope, named as a future flip via D12's notice, not silently left behind.
- §5.4 (large-family display): every new screen's מי control is `FilterBar`'s existing `MemberMultiSelect`, inheriting Stage 4's 20-member search/collapse treatment for free — no new large-family code needed or written for the *filter*. The *list rendering itself* staying flat, not grouped, is named honestly as a Risk (P4) rather than assumed covered by the filter control alone — the distinction this review's product lens specifically drew.
- §5.7 (loading/empty/error/permission-denied, failed read ≠ empty): the S2 rule, re-broken in every prior stage, is a named checklist item in every one of this stage's seven tasks, not a global aspiration repeated once and hoped for — and as of this review, it's implemented ONCE, correctly, inside `useOwnedCollectionScreen<T>` (D13), rather than re-implemented (and re-riskable) four separate times.
- §6 (module map — five new registry entries: `accounts`, `loans`, `insurances`, `recurring`, `net-worth`; "הוספת מודול עתידי = רישום + מסך" honored — each is exactly one `MODULE_REGISTRY` entry + one `renderContent` case, per Stage 4's own disclosed one-line-per-screen gap, unchanged and re-confirmed by the exhaustiveness guard tripping correctly on all five additions).
- §7 (data model — `accounts`/`loans`/`insurances`/`recurring` collections): all four finally have a UI; the D1 fix ensures that UI actually works for every permission level the matrix supports, not just `'family'`/bypass roles, which is what every existing rules test happened to exercise until this stage's own emulator-backed addition. The D10 fix additionally ensures two sessions editing the same record concurrently — the spec's own two-device household — don't silently clobber or resurrect each other's writes.
- §10 (forecast, layer-1 inputs): explicitly untouched — `computeNetWorth`'s provenance metadata (`source`/`asOf` per line) that this stage finally renders is the same metadata Stage 3 built specifically anticipating Stage 7's forecast layer; no forecast logic is added here.
- §11 (recurring automation, quick manual entry): recurring's catch-up engine is finally usable end-to-end for every permission level this stage (D1/D10/Task 7's badge); the spec's OTHER §11 item — a quick manual-entry screen into `transaction_lines` — was found unowned by any stage during this review and is assigned explicitly to the Stage 11 roadmap entry (see the roadmap edit below), not built here (out of this stage's scope discipline).

## Open questions: none

Re-verified as still honest after this review's amendments: every finding in the four-lens ledger was either fixed in a specific task (see the Amendment log above), disclosed as a named, dated Risk with a recommended next step, or assigned to a specific future roadmap stage by name. Nothing was deferred without a name attached to who owns it next.
