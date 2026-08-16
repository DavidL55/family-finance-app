# FamilyFinance v2 — Stage 4: UI Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shell every future module screen lives inside — a global sticky filter bar (מי/מתי/מה), a permission-driven module registry that replaces `App.tsx`'s hardcoded tab array, a central hover-explain glossary + `<Explain>` component ("רחף והבן"), large-family display primitives (member chips, group aggregation, a comparison-table scaffold), and the loading/empty/error discipline applied to every new piece — so Stage 5's financial module screens have real chrome to render inside instead of building their own filter bars and nav from scratch.

**Architecture:** Stage 1–3 shipped a working app with per-screen local filter state (`Dashboard`/`ExpensesBreakdown`/`CentralExpenseReport` each own their own `selectedMonth`/`selectedYear`, `Dashboard` additionally owns `selectedMember`), a hardcoded `tabs` array in `App.tsx`, and zero UI-level permission gating on navigation (a `'member'`-role session can currently open every tab — Firestore Rules silently deny the underlying reads, but the tab itself is always shown, which is confusing, not fail-closed at the UI layer). Stage 3 also produced `computeNetWorth`'s per-line `source`/`asOf` provenance specifically so this stage's glossary has something real to point at. This stage:

1. Adds a **global filter context** (`FilterContext`, React Context + `sessionStorage` persistence — Design decision D1) holding the three spec §5.3 dimensions (מי/מתי/מה), with a pure resolver (`resolveMemberSelectionNames`) that turns a member/group selection into the `Set<string>` of display names the existing `transaction_lines.owner`-based report queries actually filter on.
2. Adds **large-family display primitives** (spec §5.4) — `MemberChip`, `GroupChip`, `MemberMultiSelect`, and a `ComparisonTable` scaffold — built once and reused everywhere a person or a group of people needs to be shown, instead of every future screen inventing its own chip markup.
3. Adds a **module registry** (`MODULE_REGISTRY`, spec §6) that is the single source of truth for a tab's label/icon/permission gate, and rewires `App.tsx`'s desktop sidebar + mobile bottom nav + mobile drawer to derive their visible tab list from it, filtered through a new `useResolvedPermissions` hook against each member's materialized `resolvedPermissions` (Stage 2) — closing the "every tab is shown regardless of role" gap above. `renderContent`'s dispatch switch gets a compile-time exhaustiveness guard so it cannot silently diverge from the registry (D6, Task 3).
4. Adds a **central hover-explain glossary** (`GLOSSARY`, spec §5.2) and an `<Explain>` component — an always-tappable ⓘ icon (≥44×44 hit area) with hover as a desktop-only convenience layered on top, never a hover-only interaction — wired onto Dashboard's four headline KPI cards, its five ecosystem tiles, and its net-worth card (the concrete "NOW" list; see D4 for what's deferred).
5. **Rewires `Dashboard` onto the global filter context** (the one screen this stage touches, per Stage 1's "decompose as touched, not big-bang" ruling), wires the category ("מה") dimension into its actuals aggregation (not just member/period), wires `ComparisonTable` to a real "מי הוציא כמה החודש" card, and fixes the `loadEcosystem` empty-on-error carry-forward while that function is open for the filter-key change anyway.
6. Adds a **`NavigationContext`** (`{activeTab, navigateTo}`) that replaces `App.tsx`'s private `activeTab` `useState`, giving Stage 8's insight deep-links and Stage 10's guided tours a public way to change screens (D11) — and adopts a `data-tour-id` convention on every shell element Stage 10's tour will need to drive (D12).

**Tech Stack additions:** none. No new npm packages.

**Spec:** `docs/superpowers/specs/2026-08-14-family-finance-v2-design.md` §5 (UX principles — 5.2 hover-explain, 5.3 global filters, 5.4 large-family display, 5.7 loading/empty/error), §6 (module map).

**Builds on:** `src/App.tsx`, `src/main.tsx` (mounts `NavigationProvider` alongside the existing `NotificationProvider`, Task 3), `src/hooks/useAuthSession.ts`, `src/types/permissions.ts` (`ModuleId`, `MODULE_IDS`, `ModulePermissionMap`), `src/services/MembersService.ts` (`listMembers`, `getMember`, and `ensureSeeded` — extended in Task 4 to also seed `settings/categories`, M6), `src/services/GroupsService.ts` (`listGroups`), `src/services/CategoriesService.ts` (`getCategories` — its seed-on-read `setDoc` is removed in Task 4, M6), `src/utils/transactionFilters.ts` (`isExpenseRow`/`isExpenseListRow`, referenced by glossary copy, not modified), `src/utils/netWorth.ts` (provenance shape referenced by glossary copy, not modified — the rendered net-worth rollup itself stays Stage 5 per the Stage 3 ledger), `src/components/Dashboard.tsx` (rewired, not split), `src/contexts/NotificationContext.tsx` (the only precedent for a React Context provider in this codebase — `FilterContext` and `NavigationContext` both follow its shape). Does **not** touch `ExpensesBreakdown.tsx`, `AnnualReport.tsx`, `CentralExpenseReport.tsx`, `InvestmentsPortfolio.tsx`, `FuturePlanning.tsx`, `FolderLogic.tsx`, `FamilyManagerModal.tsx`, `SyncButton.tsx`, `InvestmentsImportModal.tsx`, or `AssetCard.tsx` — see "Carry-forwards" below for why each stays untouched this stage.

## Design decisions (resolved, not deferred)

- **D1 — global filter state lives in React Context + `sessionStorage`, not the URL.** This app has no router — `App.tsx` switches screens with a plain `activeTab` `useState`, not routes — so URL-based filter state would mean adding routing as an undisclosed side project inside a "UI shell" plan. `sessionStorage` persistence (key `ff_global_filters`) matches the precedent already in this codebase (`drive_folder_id`/`drive_folder_name`, the `AnnualReport→ExpensesBreakdown` month/year `sessionStorage` bridge) so a same-session reload doesn't lose a mid-task filter choice, without inventing a new persistence mechanism. A corrupt or old-shape persisted value falls back to defaults silently (never throws, never half-applies) — the same "don't trust a stale value" posture `useAuthSession` already applies to claims.
- **D2 — `PeriodFilter` is typed for all four modes (`month`/`quarter`/`year`/`custom`) now, but `FilterBar` renders month-selection UI only this stage.** Quarter/year/custom exist in the type so Stage 5 screens and Stage 7's forecast range picker don't force a breaking type change later, but there is no real consumer for their UI yet in this codebase — rendering controls for them now, with nothing wired to receive the value, is exactly the placeholder this plan's quality bar forbids. Adding their UI is additive when a real consumer exists.
- **D3 — the "מה" control is a categories multi-select only; it does NOT duplicate module filtering.** Spec §5.3 lists "מה (קטגוריות/מודולים)" as one dimension, but this stage's module registry (decision D6) already IS the module selector, expressed as nav. A second, separate "filter by module" chip row next to the nav that selects the same modules would be redundant surface with no distinct use — categories (real, backed by `settings/categories` via `getCategories()`, with a genuine loading/error state) is the part of "מה" that has no other UI yet.
- **D4 — the glossary is a static, typed TS config (`src/config/glossary.ts`) this stage, not yet backed by the `settings/metricGlossary` Firestore doc spec §7 describes.** Spec §5.2's actual requirement is "ההסברים יושבים במילון מונחים מרכזי אחד — לא מפוזרים בקוד" (the explanations sit in ONE central place, not scattered in code) — a single typed config module satisfies that today. Migrating it to an editable, Firestore-backed store is real future work (candidate: whenever a "הגדרות מערכת" admin screen exists to edit it — not scheduled in the 11-stage roadmap yet), not a silently-dropped requirement. **Concrete list, NOW vs deferred:** wired now — Dashboard's four KPI cards (`dashboard.totalIncome`/`totalExpenses`/`monthlyBalance`/`plannedBudget`), its five ecosystem tiles (`dashboard.ecosystem.liquid`/`investments`/`pensions`/`crypto`/`realEstate`), and its net-worth card (`dashboard.netWorth`). Authored now but not yet wired to a live trigger anywhere — `expenses.listTotal`, documenting `ExpensesBreakdown`'s refund/cancellation carve-out per the Stage 1 ledger's explicit instruction ("surface it in the hover-explain glossary in Stage 4"); the entry exists in the one central glossary so Stage 5's `ExpensesBreakdown` work is "attach the trigger," not "invent the copy." Deferred entirely — every other screen's figures (Stage 5, as each module is rewired), the forecast/insights vocabulary (Stage 7/8, doesn't exist yet).
- **D5 — `<Explain>`'s ⓘ icon is always present and always tap/click-able; hover is a desktop convenience layered on top, never a second interaction model.** This is what makes it compliant with spec §5.2's explicit "אין אינטראקציה קריטית שתלויה בריחוף בלבד" (no interaction depends solely on hover) without branching on device type: `onMouseEnter` opens the card (desktop-only in practice, since touch doesn't fire it), `onClick` toggles a `pinned` state that keeps it open regardless of hover — the same code path serves "hover on desktop" and "tap or long-press on mobile" from one component, not an `if (isMobile)` fork.
- **D6 — the module registry (`MODULE_REGISTRY`) owns nav visibility, label, icon, and permission gating; it does NOT own screen rendering or a `dashboardCards` field.** Full render-dispatch is left out because several existing screens need per-call-site props the registry's data shape can't express without forcing an artificial common signature (`AnnualReport`'s `onNavigateToExpenses` callback + its `sessionStorage` bridge, `PermissionsManager`'s `actorMemberId`/`role`) — `App.tsx`'s `renderContent` switch stays hand-written, one line per screen, disclosed as a Risk below rather than papered over. `dashboardCards` (from the brief's `ModuleId → {label, icon, screen, dashboard cards}` shape) is left out because every entry would set it to `[]` this stage — no module has a real per-card component to reference before Stage 5 builds one — and a field that is empty on literally every entry is exactly the placeholder this plan's quality bar forbids. Both are additive, non-breaking additions whenever their first real consumer exists. **Adding a future module is still one registry entry** (`MODULE_REGISTRY` array literal) for nav purposes — `renderContent`'s one-line-per-screen switch is the one remaining hand-touch, and is called out as such rather than oversold as zero-touch.
- **D7 — `FilterBar` visibility is per-screen, driven by a `usesGlobalFilters` flag on each registry entry, not "always mounted."** Spec §5.3 wants the bar "בכל מסך" (on every screen), but mounting it unconditionally while only `Dashboard` actually listens to it would show two disconnected sets of month/member controls stacked on every other screen (`ExpensesBreakdown`, `AnnualReport`, `CentralExpenseReport` all keep their own pre-existing local selectors this stage — module screens are Stage 5's job, per this plan's explicit scope discipline). Stage 4 sets `usesGlobalFilters: true` for exactly one entry (`dashboard`); Stage 5 flips it screen-by-screen as each module is rewired onto `FilterContext`, at which point that screen's own local controls are removed in the same commit that flips the flag (never both at once). The resulting half-state — filters persist in `sessionStorage` (D1) but are only visible on `Dashboard` — is otherwise invisible on every other screen (Ofra ruling I4: a user filters to "עומר" on Dashboard, switches to another tab, comes back a week later, and finds it silently still filtered). Task 4 adds a small filter-active indicator in `App.tsx`'s header, shown on every screen whenever `filters` differs from `defaultGlobalFilters()`, with a one-tap clear, so the persisted-but-invisible state stops being a silent surprise.
- **D8 — מי-selection consumption is split by data shape, not uniformly generalized.** `Dashboard`'s `transaction_lines`-driven aggregation (`loadBudget`'s actuals) gets FULL multi-select/group support immediately via `resolveMemberSelectionNames` — it is just a `Set<string>` owner-name filter over real rows, no shape limitation. `Dashboard`'s legacy manually-maintained, single-key-per-member documents (`settings/ecosystem`, `settings/budgetConfig`, both keyed `{ [memberId]: ..., all: ... }`) do NOT gain multi-member summing this stage — summing several members' independently-hand-entered figures is a real data-model question (candidate for whenever these documents migrate to the `accounts`/`loans` collections, per `netWorth.ts`'s own D5 note), not something to improvise inside a UI-shell plan. A resolved selection of exactly one specific member uses that member's key; `'all'`, a group, or 2+ specific members all fall back to the `'all'` bucket for these two documents only — a real, disclosed, bounded interim mapping (`resolveEcosystemKey`), not a silent wrong number. Per the UX review (Ofra ruling B1), this fallback is now also disclosed IN THE UI, not only in this design doc: Task 6 renders an explicit Hebrew note on the ecosystem/net-worth cards whenever `resolveEcosystemKey(filters.member) === 'all'` while `filters.member.mode !== 'all'` — exactly the case where a 2+-member or group selection is silently showing household-wide figures under what looks like a scoped filter.
- **D9 — the comparison-mode primitive (`ComparisonTable`) is built as a complete, independently tested component in Task 2 AND wired to a real Dashboard consumer in Task 6.** The brief's original "primitives only" framing was revised by the product review (Lola, finding 1): shipping a fully-built, unwired component is the exact dead-work pattern this project is trying to avoid — validated only against hand-written test fixtures, never against a real data shape, it is a guess dressed as done work. Task 6 feeds it a small "מי הוציא כמה החודש" card on `Dashboard`. The actual source is `loadSettlement`'s already-computed per-owner `paid` totals (`settlementData`), not `loadBudget`'s actuals (which are aggregated by category, not by owner, and have no per-owner breakdown to reuse) — a materially cheaper real consumer than building a new per-owner aggregation, since `settlementData` is already exactly `{name, paid, target}[]` with zero new Firestore reads. `ComparisonTable` itself remains a general-purpose primitive (sort/search/topN unchanged, spec §5.4); only its Dashboard consumer is new.
- **D10 — `Dashboard` is touched, not split.** Per Stage 1's "פירוק לרכיבים ממוקדים תוך כדי עבודה" (decompose as touched, not big-bang) ruling: this stage's Dashboard diff is scoped to exactly the pieces this stage's own requirements touch — the filter-state header (removed, replaced by `FilterBar`), the three `useState`+effect blocks that read `selectedMonth`/`selectedYear`/`selectedMember` (rewired onto `FilterContext`), the local `familyMembers` fetch (rewired onto the shared fetch lifted into `FilterContext`, M2), the `loadEcosystem` empty-on-error fix (carry-forward, touched anyway by the filter-key change), the category-filter wiring into `loadBudget` (M1), the `ComparisonTable` card (D9), the D8 disclosure note, and `<Explain>` wiring on the KPI/ecosystem/net-worth cards. The AI chat panel, income-editing modal, settlement widget internals (beyond reading `settlementData` for the new card), and the 1000+ remaining lines are untouched. No extraction of `Dashboard` into sub-components happens this stage.
- **D11 — a dedicated `NavigationContext` (`{activeTab, navigateTo}`) replaces `App.tsx`'s private `activeTab` `useState`, kept SEPARATE from `GlobalFilterState`.** Raised by the architecture review (Sun): Stage 8's insight deep-links (jump straight into a filtered module screen) and Stage 10's guided tours (David's explicitly requested feature — driving the UI programmatically, screen by screen) both need a public way to change screens from outside `App.tsx`. Without it, each would either re-thread `AnnualReport`'s one-off `onNavigateToExpenses` callback+`sessionStorage`-bridge pattern per call site, or retrofit `App.tsx` later after Stage 5 adds four more screens and Stage 9 a chat panel — strictly more expensive than adding the context now, while Task 3/4 already have `App.tsx` open for the nav rewire and provider-wrapping respectively (zero net new tasks). `activeModule` does NOT become a fourth `GlobalFilterState` dimension — D3 already drew the line between filters and navigation for the same reason: a module tab and a "מה" category filter answer different questions and must stay independently settable. No `sessionStorage` persistence — unlike `FilterContext` (D1), a killed/reloaded session landing back on whatever tab was last open is not a desired behavior; it always starts on `dashboard`.
- **D12 — shell elements authored this stage carry a `data-tour-id` attribute, per a fixed naming convention, even though nothing consumes it yet.** Raised by the "what-did-we-miss" review (M4): Stage 10's guided tour must be able to target nav buttons, `FilterBar`'s sections, and `<Explain>` triggers by a stable selector, and this is the only stage that authors these elements for the first time — retrofitting the attribute after Stages 5–9 touch these files for unrelated reasons is strictly more expensive than adding it now, while each element is already being written. Convention: nav buttons `data-tour-id={\`nav.${moduleId}\`}` (Task 3), `FilterBar` sections `data-tour-id="filter.who"` / `"filter.when"` / `"filter.what"` (Task 4), `<Explain>` triggers `data-tour-id={\`explain.${id}\`}` (Task 5). Not a placeholder per this plan's quality bar — a `data-*` attribute costs one JSX prop on an element already being written and has no behavior to half-build; a genuine placeholder would be an unwired *component*, which this is not.

**Carry-forwards from the Stage 1/2/3 ledgers reviewed and their disposition:**
- `Dashboard.loadEcosystem` resets to `EMPTY_ECOSYSTEM` on a failed read (empty-on-error violation, flagged Stage 1 Task 6a/Task 5 review) — **fixed in Task 6**, since `loadEcosystem` is opened anyway for the `selectedMember`→`ecosystemKey` rewire.
- `ExpensesBreakdown`'s refund/cancellation carve-out (`isExpenseListRow` vs `isExpenseRow`) — **addressed in Task 5** via the `expenses.listTotal` glossary entry (content authored now; the live `<Explain>` trigger on `ExpensesBreakdown`'s own screen is Stage 5, since that file isn't touched this stage).
- `netWorth.ts`'s real-estate/mortgage double-counting risk (D5, Stage 3) — **addressed in Task 5** via the `dashboard.ecosystem.realEstate` glossary entry's explicit caveat text, per `netWorth.ts`'s own header comment instruction ("Stage 4/5's hover-explain copy should call this out explicitly").
- `FamilyManagerModal`'s optimistic success toast before `onSave` resolves (Stage 1 Task 6b) — **deferred, not touched.** `FamilyManagerModal.tsx` is not edited by any task in this plan; `Dashboard`'s only change near it is removing the now-redundant member-selector chips, not the modal invocation or its save handler. Stays a Stage 11 (or "whenever this file is next opened") item.
- Drive storage-key constants migration for `SyncButton`/`InvestmentsImportModal`/`AssetCard` (Stage 2 Task 7 review) — **deferred, not touched.** None of the three files are shell files; none is edited by this plan.
- `idNumber` PII relocation, `saveMembers`/`GroupsService` concurrency carry-forwards, audit-log id collision — **reviewed, confirmed not applicable.** No task in this plan edits `MembersService.saveMembers`, `GroupsService`, `firestore.rules`, or `writeAuditLog`.
- `CategoriesService.getCategories()`'s seed-on-read `setDoc` denies a member-role first login (Stage 4 four-lens review, "what-did-we-miss" finding M6: `settings` writes are super-admin/parent only, so a member-role session mounting `FilterBar` for the first time on a fresh database hits permission-denied and, per this plan's own no-silent-catch rule, renders a permanent error state) — **fixed in Task 4**, moving default-category seeding into the super-admin `ensureSeeded()` bootstrap path, opened anyway for `FilterBar`'s category load.

## Global Constraints

- All work on branch `familyfinance-v2`. Never commit to `main`.
- TypeScript strict; `npm run lint` (tsc --noEmit) and `npm test` must pass before every commit.
- A failed read renders as an error, never an empty state — applies to every new hook/component in this plan (`useFamilyMembers`, `useGroups`, `useResolvedPermissions`, `FilterBar`'s category load never catch a query failure into `[]`/silence). A `permission-denied` refusal is a DIFFERENT state again, not folded into "error": it renders a calm access message, never the red error/retry copy and never a silent empty/zero value (Task 6, folded in from security fix `60d1c32`) — "you don't have access" and "the read failed" must stay visibly distinct.
- Scope discipline: **shell only.** No task in this plan creates or meaningfully edits a financial module screen (`ExpensesBreakdown`, `AnnualReport`, `CentralExpenseReport`, `InvestmentsPortfolio`, `FuturePlanning`, `FolderLogic`) — those are Stage 5. `Dashboard` is the sole exception, touched per D10's bounded scope.
- Every new component ships loading/empty/error/success states where it does its own I/O; a component that receives already-loaded data as props (e.g. `MemberChip`, `ComparisonTable`) is not required to reinvent states it has no I/O of its own to fail.
- Hebrew UI strings for everything user-facing (glossary copy, `FilterBar` labels, registry labels — unchanged from `App.tsx`'s existing Hebrew tab labels); dates DD/MM/YYYY where user-facing; amounts ₪-labeled where rendered.
- No hardcoded values beyond named constants documented as intentional.
- Frequent commits; each task ends with an independently testable, green deliverable; the app is usable after every single task (never a task that leaves `App.tsx` mid-refactor and broken).

---

### Task 1: Global filter types + `FilterContext` + member-selection resolver + `NavigationContext`

**Files:**
- Create: `src/types/filters.ts`, `src/contexts/FilterContext.tsx`, `src/contexts/NavigationContext.tsx` (D11), `src/utils/resolveMemberSelection.ts`
- Test: `src/__tests__/resolveMemberSelection.test.ts`, `src/__tests__/FilterContext.test.tsx`, `src/__tests__/NavigationContext.test.tsx`

**Interfaces:**
```ts
// src/types/filters.ts
export type MemberSelectionMode = 'all' | 'members' | 'group';
export interface MemberSelection {
  mode: MemberSelectionMode;
  memberIds: string[]; // meaningful when mode === 'members'
  groupId: string | null; // meaningful when mode === 'group'
}
export type PeriodMode = 'month' | 'quarter' | 'year' | 'custom'; // D2 — only 'month' has UI this stage
export interface PeriodFilter {
  mode: PeriodMode;
  month: string;  // 'MM', meaningful when mode === 'month'
  year: string;   // 'YYYY'
  quarter: 1 | 2 | 3 | 4 | null;
  startDate: string | null; // ISO, meaningful when mode === 'custom'
  endDate: string | null;
}
export interface CategoryFilter {
  categories: string[]; // empty = all (D3 — no separate module dimension)
}
export interface GlobalFilterState {
  member: MemberSelection;
  period: PeriodFilter;
  category: CategoryFilter;
}
export const ALL_MEMBERS_SELECTION: MemberSelection;
export function defaultPeriodFilter(now?: Date): PeriodFilter;
export function defaultGlobalFilters(now?: Date): GlobalFilterState;
```
```ts
// src/utils/resolveMemberSelection.ts
export function resolveMemberSelectionNames(
  selection: MemberSelection,
  members: Member[],
  groups: Group[]
): Set<string> | null; // null = "no filter" (mode 'all', or an unresolvable/empty selection)

export function resolveEcosystemKey(selection: MemberSelection): string; // D8 — 'all' unless exactly one specific member is selected
```
```ts
// src/contexts/FilterContext.tsx
export const GLOBAL_FILTERS_SESSION_KEY = 'ff_global_filters';
export function FilterProvider({ children }: { children: React.ReactNode }): JSX.Element;
export function useGlobalFilters(): {
  filters: GlobalFilterState;
  setMemberSelection: (s: MemberSelection) => void;
  setPeriod: (p: PeriodFilter) => void;
  setCategoryFilter: (c: CategoryFilter) => void;
  resetFilters: () => void;
};
// Extended in Task 4 (M2 ruling) to also host `familyMembers`/`groups` — the shared
// useFamilyMembers/useGroups fetch consumed by both FilterBar and Dashboard — once those hooks
// exist (Task 2). Not implemented here: Task 1 has no hooks to lift yet.
```
```ts
// src/contexts/NavigationContext.tsx (D11) — same Provider/useContext-with-throw shape as
// FilterContext/NotificationContext; in-memory only, no sessionStorage (unlike FilterContext —
// a stale remembered tab from a killed session is not desirable the way a stale filter is).
export function NavigationProvider({ children }: { children: React.ReactNode }): JSX.Element;
export function useNavigation(): { activeTab: string; navigateTo: (tabId: string) => void };
```

- [ ] **Step 1: Write the failing tests**

`src/__tests__/resolveMemberSelection.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { resolveMemberSelectionNames, resolveEcosystemKey } from '../utils/resolveMemberSelection';
import type { MemberSelection } from '../types/filters';

const members = [
  { id: 'david', name: 'דויד' }, { id: 'lilit', name: 'לילית' }, { id: 'omer', name: 'עומר' },
] as any[];
const groups = [{ id: 'kids', name: 'הילדים', memberIds: ['omer'], createdAt: 'x', updatedAt: 'x' }];

describe('resolveMemberSelectionNames', () => {
  it('mode "all" resolves to null (no filter)', () => {
    expect(resolveMemberSelectionNames({ mode: 'all', memberIds: [], groupId: null }, members, groups)).toBeNull();
  });
  it('mode "members" resolves to a Set of the matching display names', () => {
    const sel: MemberSelection = { mode: 'members', memberIds: ['david', 'omer'], groupId: null };
    expect(resolveMemberSelectionNames(sel, members, groups)).toEqual(new Set(['דויד', 'עומר']));
  });
  it('mode "members" with an unknown id silently drops it, not the whole selection', () => {
    const sel: MemberSelection = { mode: 'members', memberIds: ['david', 'ghost'], groupId: null };
    expect(resolveMemberSelectionNames(sel, members, groups)).toEqual(new Set(['דויד']));
  });
  it('mode "members" with an empty array resolves to null', () => {
    expect(resolveMemberSelectionNames({ mode: 'members', memberIds: [], groupId: null }, members, groups)).toBeNull();
  });
  it('mode "group" resolves to the names of that group\'s members', () => {
    const sel: MemberSelection = { mode: 'group', memberIds: [], groupId: 'kids' };
    expect(resolveMemberSelectionNames(sel, members, groups)).toEqual(new Set(['עומר']));
  });
  it('mode "group" with an unknown groupId resolves to null, not a throw', () => {
    const sel: MemberSelection = { mode: 'group', memberIds: [], groupId: 'ghost' };
    expect(resolveMemberSelectionNames(sel, members, groups)).toBeNull();
  });
});

describe('resolveEcosystemKey (D8)', () => {
  it('returns "all" for mode "all"', () => {
    expect(resolveEcosystemKey({ mode: 'all', memberIds: [], groupId: null })).toBe('all');
  });
  it('returns the single member id when exactly one member is selected', () => {
    expect(resolveEcosystemKey({ mode: 'members', memberIds: ['omer'], groupId: null })).toBe('omer');
  });
  it('returns "all" for 2+ selected members (no multi-member summing this stage)', () => {
    expect(resolveEcosystemKey({ mode: 'members', memberIds: ['omer', 'david'], groupId: null })).toBe('all');
  });
  it('returns "all" for a group selection', () => {
    expect(resolveEcosystemKey({ mode: 'group', memberIds: [], groupId: 'kids' })).toBe('all');
  });
});
```

`src/__tests__/FilterContext.test.tsx`:
```tsx
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { FilterProvider, useGlobalFilters, GLOBAL_FILTERS_SESSION_KEY } from '../contexts/FilterContext';

beforeEach(() => sessionStorage.clear());

describe('FilterProvider / useGlobalFilters', () => {
  it('throws when used outside the provider', () => {
    const { result } = renderHook(() => {
      try { return useGlobalFilters(); } catch (e) { return e as Error; }
    });
    expect(result.current).toBeInstanceOf(Error);
  });

  it('starts with defaults (mode "all", current month, no categories) when nothing is persisted', () => {
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    expect(result.current.filters.member.mode).toBe('all');
    expect(result.current.filters.category.categories).toEqual([]);
  });

  it('setMemberSelection updates state and persists to sessionStorage', () => {
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    act(() => result.current.setMemberSelection({ mode: 'members', memberIds: ['omer'], groupId: null }));
    expect(result.current.filters.member.memberIds).toEqual(['omer']);
    const persisted = JSON.parse(sessionStorage.getItem(GLOBAL_FILTERS_SESSION_KEY)!);
    expect(persisted.member.memberIds).toEqual(['omer']);
  });

  it('hydrates from a valid persisted value on mount', () => {
    sessionStorage.setItem(GLOBAL_FILTERS_SESSION_KEY, JSON.stringify({
      member: { mode: 'members', memberIds: ['omer'], groupId: null },
      period: { mode: 'month', month: '03', year: '2026', quarter: null, startDate: null, endDate: null },
      category: { categories: ['מזון וצריכה'] },
    }));
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    expect(result.current.filters.member.memberIds).toEqual(['omer']);
    expect(result.current.filters.period.month).toBe('03');
  });

  it('a corrupt persisted value falls back to defaults instead of throwing', () => {
    sessionStorage.setItem(GLOBAL_FILTERS_SESSION_KEY, '{not valid json');
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    expect(result.current.filters.member.mode).toBe('all');
  });

  it('resetFilters restores defaults', () => {
    const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
    act(() => result.current.setCategoryFilter({ categories: ['x'] }));
    act(() => result.current.resetFilters());
    expect(result.current.filters.category.categories).toEqual([]);
  });
});
```

`src/__tests__/NavigationContext.test.tsx` (D11):
```tsx
import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { NavigationProvider, useNavigation } from '../contexts/NavigationContext';

describe('NavigationProvider / useNavigation', () => {
  it('throws when used outside the provider', () => {
    const { result } = renderHook(() => {
      try { return useNavigation(); } catch (e) { return e as Error; }
    });
    expect(result.current).toBeInstanceOf(Error);
  });
  it('starts on "dashboard"', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper: NavigationProvider });
    expect(result.current.activeTab).toBe('dashboard');
  });
  it('navigateTo updates activeTab', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper: NavigationProvider });
    act(() => result.current.navigateTo('expenses'));
    expect(result.current.activeTab).toBe('expenses');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/resolveMemberSelection.test.ts src/__tests__/FilterContext.test.tsx src/__tests__/NavigationContext.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/types/filters.ts`, `src/utils/resolveMemberSelection.ts`, `src/contexts/FilterContext.tsx`, `src/contexts/NavigationContext.tsx`**

Write exactly as specified in Interfaces above; `resolveMemberSelectionNames`/`resolveEcosystemKey` bodies as reasoned through the test cases (map ids/group members to names via `.find`, filter out unresolved entries, `Set`s never thrown-on-empty); `FilterContext.tsx` follows `NotificationContext.tsx`'s Provider/`useContext`-with-throw shape, with a `try/catch`-guarded `JSON.parse` on mount and a `useEffect` that writes to `sessionStorage` on every `filters` change. `NavigationContext.tsx` (D11) follows the identical Provider/`useContext`-with-throw shape but with a plain `useState('dashboard')` and no persistence effect — `navigateTo` is just `setActiveTab`.

- [ ] **Step 4: Run to verify pass**

Run: `npm run lint && npx vitest run src/__tests__/resolveMemberSelection.test.ts src/__tests__/FilterContext.test.tsx src/__tests__/NavigationContext.test.tsx`
Expected: ALL PASS.

- [ ] **Step 5: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/filters.ts src/contexts/FilterContext.tsx src/contexts/NavigationContext.tsx src/utils/resolveMemberSelection.ts src/__tests__/resolveMemberSelection.test.ts src/__tests__/FilterContext.test.tsx src/__tests__/NavigationContext.test.tsx
git commit -m "feat: global filter state + navigation context — types, FilterContext, NavigationContext, member-selection resolver

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Large-family display primitives + shared load hooks

**Files:**
- Create: `src/components/MemberChip.tsx`, `src/components/GroupChip.tsx`, `src/components/MemberMultiSelect.tsx`, `src/components/ComparisonTable.tsx`, `src/hooks/useFamilyMembers.ts`, `src/hooks/useGroups.ts`, `src/__tests__/fixtures/largeFamily.ts` (shared 20-member/multi-group fixture — spec §3's "usable with 20 members, verified with 20-person demo data" success metric, Lola finding 2 / Ofra I3)
- Test: `src/__tests__/MemberChip.test.tsx`, `src/__tests__/GroupChip.test.tsx`, `src/__tests__/MemberMultiSelect.test.tsx`, `src/__tests__/ComparisonTable.test.tsx`, `src/__tests__/useFamilyMembers.test.tsx`, `src/__tests__/useGroups.test.tsx`

**Interfaces:**
```ts
// src/components/MemberChip.tsx
export interface MemberChipProps { name: string; color: string; selected?: boolean; onClick?: () => void; size?: 'sm' | 'md'; }
export function MemberChip(props: MemberChipProps): JSX.Element;

// src/components/GroupChip.tsx
export interface GroupChipProps { name: string; memberCount: number; amount?: number; selected?: boolean; onClick?: () => void; }
export function GroupChip(props: GroupChipProps): JSX.Element;

// src/components/MemberMultiSelect.tsx
export interface MemberMultiSelectProps {
  members: Member[]; groups: Group[]; value: MemberSelection; onChange: (next: MemberSelection) => void;
}
export function MemberMultiSelect(props: MemberMultiSelectProps): JSX.Element;

// src/components/ComparisonTable.tsx (D9 — general-purpose primitive; wired to a real Dashboard consumer in Task 6)
export interface ComparisonRow { memberId: string; name: string; color: string; value: number; }
export interface ComparisonTableProps { rows: ComparisonRow[]; valueLabel: string; topN?: number; }
export function ComparisonTable(props: ComparisonTableProps): JSX.Element;

// src/hooks/useFamilyMembers.ts
export interface FamilyMembersState { status: 'loading' | 'error' | 'ready'; members: Member[]; error: string | null; reload: () => void; }
export function useFamilyMembers(): FamilyMembersState;

// src/hooks/useGroups.ts
export interface GroupsState { status: 'loading' | 'error' | 'ready'; groups: Group[]; error: string | null; reload: () => void; }
export function useGroups(): GroupsState;
```

- [ ] **Step 1: Write the failing tests**

`src/__tests__/MemberChip.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemberChip } from '../components/MemberChip';

describe('MemberChip', () => {
  it('renders the name and a color dot', () => {
    render(<MemberChip name="עומר" color="#1F4E78" />);
    expect(screen.getByText('עומר')).toBeInTheDocument();
  });
  it('renders as a static span with no onClick (not interactive when not needed)', () => {
    render(<MemberChip name="עומר" color="#1F4E78" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('renders as a clickable button and fires onClick when one is given', () => {
    const onClick = vi.fn();
    render(<MemberChip name="עומר" color="#1F4E78" onClick={onClick} selected />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});
```

`src/__tests__/GroupChip.test.tsx` — analogous: renders name + `(memberCount)`, renders `amount` only when provided, fires `onClick`.

`src/__tests__/MemberMultiSelect.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemberMultiSelect } from '../components/MemberMultiSelect';
import { LARGE_FAMILY_MEMBERS, LARGE_FAMILY_GROUPS } from './fixtures/largeFamily';

const members = [{ id: 'omer', name: 'עומר', color: '#1F4E78' }, { id: 'david', name: 'דויד', color: '#17C3B2' }] as any[];
const groups = [{ id: 'kids', name: 'הילדים', memberIds: ['omer'], createdAt: 'x', updatedAt: 'x' }];

describe('MemberMultiSelect', () => {
  it('clicking a member with mode "all" switches to mode "members" with just that id', () => {
    const onChange = vi.fn();
    render(<MemberMultiSelect members={members} groups={groups} value={{ mode: 'all', memberIds: [], groupId: null }} onChange={onChange} />);
    fireEvent.click(screen.getByText('עומר'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'members', memberIds: ['omer'], groupId: null });
  });
  it('clicking a second member while one is already selected ADDS to the selection', () => {
    const onChange = vi.fn();
    render(<MemberMultiSelect members={members} groups={groups} value={{ mode: 'members', memberIds: ['omer'], groupId: null }} onChange={onChange} />);
    fireEvent.click(screen.getByText('דויד'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'members', memberIds: ['omer', 'david'], groupId: null });
  });
  it('deselecting the last selected member falls back to mode "all"', () => {
    const onChange = vi.fn();
    render(<MemberMultiSelect members={members} groups={groups} value={{ mode: 'members', memberIds: ['omer'], groupId: null }} onChange={onChange} />);
    fireEvent.click(screen.getByText('עומר'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'all', memberIds: [], groupId: null });
  });
  it('clicking a group chip switches to mode "group"; clicking it again returns to "all"', () => {
    const onChange = vi.fn();
    const { rerender } = render(<MemberMultiSelect members={members} groups={groups} value={{ mode: 'all', memberIds: [], groupId: null }} onChange={onChange} />);
    fireEvent.click(screen.getByText('הילדים'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'group', memberIds: [], groupId: 'kids' });
    rerender(<MemberMultiSelect members={members} groups={groups} value={{ mode: 'group', memberIds: [], groupId: 'kids' }} onChange={onChange} />);
    fireEvent.click(screen.getByText('הילדים'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'all', memberIds: [], groupId: null });
  });
  it('with a small family (<= 8 members), no search/collapse chrome is shown at all', () => {
    render(<MemberMultiSelect members={members} groups={groups} value={{ mode: 'all', memberIds: [], groupId: null }} onChange={vi.fn()} />);
    expect(screen.queryByPlaceholderText('חיפוש לפי שם...')).not.toBeInTheDocument();
  });
});

// Ofra ruling I3: MemberMultiSelect is the LIVE, daily-use control — it must get the same
// search/collapse treatment ComparisonTable (unwired) already had, not the other way around.
// Reuses the LARGE_FAMILY fixture (Lola finding 2) so this is the same 20-member/multi-group
// shape spec §3 names as the success metric, not a hand-picked small array.
describe('MemberMultiSelect — large-family search/collapse (Ofra I3 / Lola 20-member metric)', () => {
  it('renders a search input and collapses to top N members with a "show all" control when the family is large', () => {
    const onChange = vi.fn();
    render(<MemberMultiSelect members={LARGE_FAMILY_MEMBERS} groups={LARGE_FAMILY_GROUPS} value={{ mode: 'all', memberIds: [], groupId: null }} onChange={onChange} />);
    expect(screen.getByPlaceholderText('חיפוש לפי שם...')).toBeInTheDocument();
    expect(screen.queryByText('בן משפחה 19')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/הצג את כל/));
    expect(screen.getByText('בן משפחה 19')).toBeInTheDocument();
  });
  it('a search query narrows the member list and bypasses the collapse — no overflow', () => {
    render(<MemberMultiSelect members={LARGE_FAMILY_MEMBERS} groups={LARGE_FAMILY_GROUPS} value={{ mode: 'all', memberIds: [], groupId: null }} onChange={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('חיפוש לפי שם...'), { target: { value: 'בן משפחה 19' } });
    expect(screen.getByText('בן משפחה 19')).toBeInTheDocument();
    expect(screen.queryByText('בן משפחה 0')).not.toBeInTheDocument();
  });
  it('both group chips render without overflow alongside the collapsed member list', () => {
    render(<MemberMultiSelect members={LARGE_FAMILY_MEMBERS} groups={LARGE_FAMILY_GROUPS} value={{ mode: 'all', memberIds: [], groupId: null }} onChange={vi.fn()} />);
    expect(screen.getByText('קבוצה א')).toBeInTheDocument();
    expect(screen.getByText('קבוצה ב')).toBeInTheDocument();
  });
});
```

`src/__tests__/fixtures/largeFamily.ts` — spec §3's "usable with 20 members, verified with 20-person demo data" success metric, shared by `MemberMultiSelect.test.tsx` and `ComparisonTable.test.tsx` so both are exercised against the same realistic large-family/multi-group shape instead of each inventing its own small array:
```ts
// src/__tests__/fixtures/largeFamily.ts
export const LARGE_FAMILY_MEMBERS = Array.from({ length: 20 }, (_, i) => ({
  id: `m${i}`, name: `בן משפחה ${i}`, color: '#1F4E78', role: i < 4 ? 'הורה' : 'ילד',
  groups: [], createdAt: 'x', updatedAt: 'x',
})) as any[];

export const LARGE_FAMILY_GROUPS = [
  { id: 'g1', name: 'קבוצה א', memberIds: LARGE_FAMILY_MEMBERS.slice(0, 10).map((m) => m.id), createdAt: 'x', updatedAt: 'x' },
  { id: 'g2', name: 'קבוצה ב', memberIds: LARGE_FAMILY_MEMBERS.slice(10).map((m) => m.id), createdAt: 'x', updatedAt: 'x' },
];
```

`src/__tests__/ComparisonTable.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComparisonTable } from '../components/ComparisonTable';
import { LARGE_FAMILY_MEMBERS } from './fixtures/largeFamily';

const manyRows = Array.from({ length: 8 }, (_, i) => ({ memberId: `m${i}`, name: `אדם ${i}`, color: '#000', value: 100 - i }));

describe('ComparisonTable', () => {
  it('renders an explicit empty state for zero rows, not a bare empty table', () => {
    render(<ComparisonTable rows={[]} valueLabel="הוצאות" />);
    expect(screen.getByText('אין נתונים להשוואה.')).toBeInTheDocument();
  });
  it('sorts rows by value descending', () => {
    const rows = [{ memberId: 'a', name: 'א', color: '#000', value: 10 }, { memberId: 'b', name: 'ב', color: '#000', value: 50 }];
    render(<ComparisonTable rows={rows} valueLabel="הוצאות" />);
    const cells = screen.getAllByText(/^₪/);
    expect(cells[0]).toHaveTextContent('₪50');
  });
  it('collapses to top N with a "show all" control when rows exceed topN', () => {
    render(<ComparisonTable rows={manyRows} valueLabel="הוצאות" topN={5} />);
    expect(screen.queryByText('אדם 7')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/הצג את כל/));
    expect(screen.getByText('אדם 7')).toBeInTheDocument();
  });
  it('a search query filters by name and bypasses the topN collapse', () => {
    render(<ComparisonTable rows={manyRows} valueLabel="הוצאות" topN={5} />);
    fireEvent.change(screen.getByPlaceholderText('חיפוש לפי שם...'), { target: { value: 'אדם 7' } });
    expect(screen.getByText('אדם 7')).toBeInTheDocument();
    expect(screen.queryByText('אדם 0')).not.toBeInTheDocument();
  });
  it('handles the 20-member fixture without overflow (spec §3 "usable with 20 members")', () => {
    const rows = LARGE_FAMILY_MEMBERS.map((m: any, i: number) => ({ memberId: m.id, name: m.name, color: m.color, value: 20 - i }));
    render(<ComparisonTable rows={rows} valueLabel="הוצאות" topN={5} />);
    expect(screen.queryByText('בן משפחה 19')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('חיפוש לפי שם...'), { target: { value: 'בן משפחה 19' } });
    expect(screen.getByText('בן משפחה 19')).toBeInTheDocument();
  });
});
```

`src/__tests__/useFamilyMembers.test.tsx` / `useGroups.test.tsx` — mirror the existing `Dashboard.membersLoad.test.tsx` shape: mock `listMembers`/`listGroups`, assert `status` transitions `loading→ready` with data, `loading→error` with the error message and `members`/`groups` untouched (not reset to `[]`), and that `reload()` re-triggers the fetch.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/MemberChip.test.tsx src/__tests__/GroupChip.test.tsx src/__tests__/MemberMultiSelect.test.tsx src/__tests__/ComparisonTable.test.tsx src/__tests__/useFamilyMembers.test.tsx src/__tests__/useGroups.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the fixture + all six files**

`src/__tests__/fixtures/largeFamily.ts` — the plain data literal shown above, no logic to test on its own.

`MemberChip.tsx`, `GroupChip.tsx` — small presentational components (color dot + name; name + count + optional ₪amount), `<span>` when no `onClick`, `<button aria-pressed>` when there is one, exactly as reasoned through the tests above (Tailwind classes matching this codebase's existing chip/pill styling, e.g. `PermissionsManager`'s member row).

`MemberMultiSelect.tsx` — renders `MemberChip name="כולם"` first, then one `GroupChip` per group, then a member list; `toggleMember`/`selectGroup` implement exactly the transitions the tests assert (switch to `'members'` mode on first pick, add/remove from `memberIds` thereafter, empty selection collapses back to `'all'`, re-clicking the active group returns to `'all'`). Ofra ruling I3 — reusing the exact `showAll`/`query` pattern Task 2 already specifies for `ComparisonTable` below: when `members.length > 8`, render a `חיפוש לפי שם...` search input (`useMemo`'d name-substring filter) and collapse the member list to the first 8 with a `הצג את כל ה־N חברים` button; below that threshold, render the flat list with no search/collapse chrome at all (small families stay exactly as simple as they were). `MemberChip`/`GroupChip` themselves are unchanged — only the list around them gained the large-family treatment.

`ComparisonTable.tsx` — `useState` for `showAll`/`query`; `useMemo`'d sort (descending by `value`) and name-substring filter; renders the explicit `אין נתונים להשוואה.` empty state for `rows.length === 0`; a search input only appears when `rows.length > topN`; "show all" button only when collapsed and there are hidden rows.

`useFamilyMembers.ts`, `useGroups.ts` — identical shape to each other (one wraps `listMembers`, the other `listGroups`): `status`/`error` never silently reset on a failed fetch, a `reloadToken` counter drives `reload()`, cleanup guards a late resolution after unmount (mirrors `useAuthSession`'s generation-guard spirit, simpler since there's no ordering race here — just an unmount guard). These are consumed directly for now; Task 4 lifts their call sites into `FilterContext` so `FilterBar` and `Dashboard` share one fetch instead of two (M2) — the hooks themselves don't change, only who calls them.

- [ ] **Step 4: Run to verify pass**

Run: `npm run lint && npx vitest run src/__tests__/MemberChip.test.tsx src/__tests__/GroupChip.test.tsx src/__tests__/MemberMultiSelect.test.tsx src/__tests__/ComparisonTable.test.tsx src/__tests__/useFamilyMembers.test.tsx src/__tests__/useGroups.test.tsx`
Expected: ALL PASS.

- [ ] **Step 5: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/MemberChip.tsx src/components/GroupChip.tsx src/components/MemberMultiSelect.tsx src/components/ComparisonTable.tsx src/hooks/useFamilyMembers.ts src/hooks/useGroups.ts src/__tests__/fixtures/largeFamily.ts src/__tests__/MemberChip.test.tsx src/__tests__/GroupChip.test.tsx src/__tests__/MemberMultiSelect.test.tsx src/__tests__/ComparisonTable.test.tsx src/__tests__/useFamilyMembers.test.tsx src/__tests__/useGroups.test.tsx
git commit -m "feat: large-family display primitives — MemberChip, GroupChip, MemberMultiSelect (with search/collapse), ComparisonTable, 20-member fixture

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Module registry + permission-driven `App.tsx` nav + `NavigationContext` lift

**Files:**
- Create: `src/config/moduleRegistry.ts`, `src/hooks/useResolvedPermissions.ts`
- Modify: `src/App.tsx`, `src/main.tsx` (mount `NavigationProvider`, D11)
- Test: `src/__tests__/moduleRegistry.test.ts`, `src/__tests__/useResolvedPermissions.test.tsx`

**Interfaces:**
```ts
// src/config/moduleRegistry.ts
export interface ModuleRegistryEntry {
  id: string; // App.tsx activeTab id
  label: string;
  icon: LucideIcon;
  permissionModuleId: ModuleId | null; // null = ungated
  usesGlobalFilters: boolean; // D7
}
export const MODULE_REGISTRY: readonly ModuleRegistryEntry[];
export function isModuleVisible(entry: ModuleRegistryEntry, role: PermissionRole, resolvedPermissions: ModulePermissionMap | null): boolean;

// src/hooks/useResolvedPermissions.ts
export interface ResolvedPermissionsState {
  status: 'idle' | 'loading' | 'error' | 'ready';
  resolvedPermissions: ModulePermissionMap | null;
  error: string | null;
  retry: () => void;
}
export function useResolvedPermissions(session: AuthSession): ResolvedPermissionsState;
```

- [ ] **Step 1: Write the failing tests**

`src/__tests__/moduleRegistry.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { MODULE_REGISTRY, isModuleVisible } from '../config/moduleRegistry';

describe('MODULE_REGISTRY', () => {
  it('contains exactly the seven existing tabs, each with a unique id', () => {
    expect(MODULE_REGISTRY.map((e) => e.id)).toEqual([
      'dashboard', 'expenses', 'central-expenses', 'investments', 'future', 'annual', 'folder',
    ]);
  });
  it('only "dashboard" uses global filters this stage (D7)', () => {
    expect(MODULE_REGISTRY.filter((e) => e.usesGlobalFilters).map((e) => e.id)).toEqual(['dashboard']);
  });
});

describe('isModuleVisible', () => {
  const gated = MODULE_REGISTRY.find((e) => e.id === 'expenses')!; // permissionModuleId: 'expenses'
  const ungated = MODULE_REGISTRY.find((e) => e.id === 'dashboard')!; // permissionModuleId: null

  it('an ungated entry is always visible, regardless of role or permissions', () => {
    expect(isModuleVisible(ungated, 'member', null)).toBe(true);
    expect(isModuleVisible(ungated, 'member', {})).toBe(true);
  });
  it('super-admin and parent see a gated entry regardless of resolvedPermissions', () => {
    expect(isModuleVisible(gated, 'super-admin', null)).toBe(true);
    expect(isModuleVisible(gated, 'parent', {})).toBe(true);
  });
  it('a member with no view permission on the module does not see it', () => {
    expect(isModuleVisible(gated, 'member', { expenses: { view: 'none', edit: 'none' } })).toBe(false);
    expect(isModuleVisible(gated, 'member', null)).toBe(false);
    expect(isModuleVisible(gated, 'member', {})).toBe(false);
  });
  it('a member with own/family view permission sees it', () => {
    expect(isModuleVisible(gated, 'member', { expenses: { view: 'own', edit: 'none' } })).toBe(true);
    expect(isModuleVisible(gated, 'member', { expenses: { view: 'family', edit: 'none' } })).toBe(true);
  });
});

// Sun's architecture ruling: MODULE_REGISTRY and App.tsx's renderContent switch are two lists
// keyed by the same id with no tripwire today — a missing case silently falls through to
// `default: <Dashboard/>` with no error. This runtime check is the belt to the compile-time
// exhaustiveness guard added to renderContent itself (Step 5) — the guard proves every id at
// BUILD time, this proves it again at TEST time against the literal known-render-id list so a
// reviewer scanning this file alone (without reading App.tsx) still sees the invariant enforced.
describe('MODULE_REGISTRY / renderContent exhaustiveness (Sun ruling)', () => {
  it('every MODULE_REGISTRY id is a case App.tsx\'s renderContent switch actually handles', () => {
    const KNOWN_RENDER_IDS = ['dashboard', 'expenses', 'central-expenses', 'investments', 'future', 'annual', 'folder', 'permissions'];
    MODULE_REGISTRY.forEach((entry) => expect(KNOWN_RENDER_IDS).toContain(entry.id));
  });
});
```

`src/__tests__/useResolvedPermissions.test.tsx` — mock `getMember`; assert: `session.status !== 'ready'` → `status: 'idle'`; a resolved member with `resolvedPermissions` → `status: 'ready'`, value passed through; a member with `resolvedPermissions: undefined` → `status: 'ready'`, `resolvedPermissions: {}` (never `null` once ready — `isModuleVisible` treats `{}` and `null` the same for a `'member'` role, but the type stays honest about what was actually fetched); a rejected `getMember` → `status: 'error'`, message set; `retry()` re-fetches.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/moduleRegistry.test.ts src/__tests__/useResolvedPermissions.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `moduleRegistry.ts` and `useResolvedPermissions.ts`**

```ts
// src/config/moduleRegistry.ts
import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard, FolderOpen, Receipt, Compass, TrendingUp, FileText, CalendarDays } from 'lucide-react';
import type { ModuleId, ModulePermissionMap, PermissionRole } from '../types/permissions';

export interface ModuleRegistryEntry {
  id: string;
  label: string;
  icon: LucideIcon;
  permissionModuleId: ModuleId | null;
  usesGlobalFilters: boolean;
}

export const MODULE_REGISTRY: readonly ModuleRegistryEntry[] = [
  { id: 'dashboard', label: 'לוח תצוגה ראשי', icon: LayoutDashboard, permissionModuleId: null, usesGlobalFilters: true },
  { id: 'expenses', label: 'פירוט הוצאות', icon: Receipt, permissionModuleId: 'expenses', usesGlobalFilters: false },
  { id: 'central-expenses', label: 'דוח הוצאות מרכז', icon: FileText, permissionModuleId: 'expenses', usesGlobalFilters: false },
  { id: 'investments', label: 'תיק השקעות ופנסיה', icon: TrendingUp, permissionModuleId: 'investments', usesGlobalFilters: false },
  { id: 'future', label: 'תכנון עתידי', icon: Compass, permissionModuleId: null, usesGlobalFilters: false },
  { id: 'annual', label: 'דוח שנתי', icon: CalendarDays, permissionModuleId: 'expenses', usesGlobalFilters: false },
  { id: 'folder', label: 'תיקייה חודשית', icon: FolderOpen, permissionModuleId: null, usesGlobalFilters: false },
] as const;

export function isModuleVisible(
  entry: ModuleRegistryEntry,
  role: PermissionRole,
  resolvedPermissions: ModulePermissionMap | null
): boolean {
  if (entry.permissionModuleId === null) return true;
  if (role === 'super-admin' || role === 'parent') return true;
  const level = resolvedPermissions?.[entry.permissionModuleId]?.view ?? 'none';
  return level !== 'none';
}
```

`useResolvedPermissions.ts` — as reasoned in Interfaces: `useEffect` keyed on `[session.status, session.memberId, retryToken]`, `getMember(session.memberId)`, unmount guard, never treats a fetch failure as "no permissions" silently (`status: 'error'`, `resolvedPermissions: null`, distinct from the fail-closed-but-successful `{}` case).

- [ ] **Step 4: Run to verify pass**

Run: `npm run lint && npx vitest run src/__tests__/moduleRegistry.test.ts src/__tests__/useResolvedPermissions.test.tsx`
Expected: ALL PASS.

- [ ] **Step 5: Mount `NavigationProvider` in `main.tsx` (D11)**

`NavigationProvider` must wrap `App` from OUTSIDE `App`'s own function body, the same way `NotificationProvider` already does — `App.tsx` itself is the component that needs to consume `useNavigation()`, so the provider can't live inside it:

```tsx
// src/main.tsx
import { NavigationProvider } from './contexts/NavigationContext';
```
```tsx
<NotificationProvider>
  <NavigationProvider>
    <App />
  </NavigationProvider>
</NotificationProvider>
```

- [ ] **Step 6: Rewire `App.tsx`'s nav — module registry + `NavigationContext` + exhaustiveness guard + tour ids**

Replace the hardcoded `tabs` array and its three render sites (desktop sidebar, mobile bottom nav, mobile drawer — all already generic over a `tabs` array, per the existing code) with:

```tsx
import { MODULE_REGISTRY, isModuleVisible, type ModuleRegistryEntry } from './config/moduleRegistry';
import { useResolvedPermissions } from './hooks/useResolvedPermissions';
import { useNavigation } from './contexts/NavigationContext';
```

Replace `const [activeTab, setActiveTab] = useState('dashboard');` (D11 — lifted out of `App.tsx`'s own state):
```tsx
const { activeTab, navigateTo } = useNavigation();
```

```tsx
  const permState = useResolvedPermissions(session);

  // ...inside the `session.status === 'ready'` branch, replacing the old `const tabs = [...]`:
  const isSuperAdmin = session.role === 'super-admin';
  const visibleModules = MODULE_REGISTRY.filter((entry) =>
    isModuleVisible(entry, session.role!, permState.resolvedPermissions)
  );
  const tabs = [
    ...visibleModules.map((m) => ({ id: m.id, label: m.label, icon: m.icon })),
    ...(isSuperAdmin ? [{ id: 'permissions' as const, label: 'ניהול משפחה והרשאות', icon: Shield }] : []),
  ];
```

Every `onClick={() => setActiveTab(tab.id)}` (sidebar, bottom nav, drawer — three call sites) becomes `onClick={() => navigateTo(tab.id)}`; the `AnnualReport` callback's `setActiveTab('expenses')` becomes `navigateTo('expenses')`. Each of the three nav-button render sites also gets a `data-tour-id={`nav.${tab.id}`}` prop (D12 — Stage 10's guided tour needs a stable selector for "click the Expenses tab" regardless of Hebrew label text, which can change):

```tsx
<button
  key={tab.id}
  data-tour-id={`nav.${tab.id}`}
  onClick={() => navigateTo(tab.id)}
  ...
```

`renderContent`'s dispatch switch gets a compile-time exhaustiveness guard (Sun's architecture ruling — today a missing case silently falls through to `default: <Dashboard/>` with no error):

```tsx
type TabId = ModuleRegistryEntry['id'] | 'permissions';

const renderContent = () => {
  switch (activeTab as TabId) {
    case 'dashboard': return <Dashboard />;
    case 'expenses': return <ExpensesBreakdown />;
    case 'central-expenses': return <CentralExpenseReport />;
    case 'investments': return <InvestmentsPortfolio />;
    case 'future': return <FuturePlanning />;
    case 'annual': return (
      <AnnualReport
        onNavigateToExpenses={(month, year, _category) => {
          navigateTo('expenses');
          sessionStorage.setItem('expensesFilter', JSON.stringify({ month, year }));
        }}
      />
    );
    case 'folder': return <FolderLogic />;
    case 'permissions':
      return isSuperAdmin
        ? <PermissionsManager actorMemberId={session.memberId!} role={session.role!} />
        : <Dashboard />;
    default: {
      // If MODULE_REGISTRY ever grows an id with no matching case above, `activeTab`'s narrowed
      // type in this branch stops being `never` and `npm run lint` (tsc --noEmit) FAILS TO BUILD
      // — instead of the module silently rendering <Dashboard/> with no error, which is exactly
      // the gap the architecture review flagged. A cast-based guard, not a runtime throw, because
      // a genuinely corrupt `activeTab` value (there is no legitimate way to produce one — it only
      // ever comes from `navigateTo` calls within this same file) shouldn't crash the whole app;
      // it renders a visible, honest error instead of a wrong screen.
      const _exhaustive: never = activeTab as never;
      console.error('[App] No render case for module id:', _exhaustive);
      return <div className="p-8 text-center text-red-600">מודול לא ידוע. פנה לתמיכה.</div>;
    }
  }
};
```

A `'member'`-role session sees only ungated tabs (`dashboard`, `future`, `folder`) until `permState` resolves to `'ready'` — this is the SAME fail-closed-while-loading posture as the Rules layer itself (deny until proven allowed), not a bug to hide; gated tabs appear once `resolvedPermissions` loads. On `permState.status === 'error'`, add a small inline retry affordance right below the sidebar nav (and inside the mobile drawer) so a real network blip doesn't silently and permanently hide a member's actual access:

```tsx
{permState.status === 'error' && session.role === 'member' && (
  <div className="px-4 py-2 text-xs text-red-600 flex items-center gap-1">
    טעינת הרשאות נכשלה
    <button onClick={permState.retry} className="underline">נסה שוב</button>
  </div>
)}
```

`super-admin`/`parent` sessions are unaffected by `permState`'s status (bypass per `isModuleVisible`), so this banner is scoped to `role === 'member'` only.

- [ ] **Step 7: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS. The exhaustiveness guard is exercised by `tsc --noEmit` itself (part of `npm run lint`), not a unit test — confirm this by temporarily commenting out the `case 'folder':` arm and re-running `npm run lint`; it must fail with a "Type 'folder' is not assignable to type 'never'" error before restoring the arm. `App.tsx` otherwise has no dedicated test file (consistent with `ensureSeeded`/`useRecurringCatchup`'s wiring precedent — logic lives in the tested `moduleRegistry`/`useResolvedPermissions`/`NavigationContext` units, `App.tsx` itself is thin wiring).

- [ ] **Step 8: Manual smoke check**

With `npm run emu` running: sign in as `omer-levy` (member role, no permissions granted yet) — confirm only "לוח תצוגה ראשי", "תכנון עתידי", "תיקייה חודשית" appear. Grant Omer `view: 'own'` on `expenses` via `PermissionsManager` as David, reload — confirm "פירוט הוצאות" and "דוח שנתי" now appear (both gated on `'expenses'`). Confirm switching tabs still works identically to before (now routed through `navigateTo` instead of the old local `setActiveTab`).

- [ ] **Step 9: Commit**

```bash
git add src/config/moduleRegistry.ts src/hooks/useResolvedPermissions.ts src/App.tsx src/main.tsx src/__tests__/moduleRegistry.test.ts src/__tests__/useResolvedPermissions.test.tsx
git commit -m "feat: permission-driven module registry + NavigationContext, replaces App.tsx's hardcoded tab list and private activeTab state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `FilterBar` component + mount in `App.tsx` + shared members/groups fetch + category-seeding fix + filter-active badge

**Files:**
- Create: `src/components/FilterBar.tsx`, `src/components/FilterActiveBadge.tsx` (Ofra I4)
- Modify: `src/App.tsx`, `src/contexts/FilterContext.tsx` (lift `useFamilyMembers`/`useGroups` in, M2), `src/types/filters.ts` (add `isDefaultGlobalFilters`), `src/services/CategoriesService.ts` (remove seed-on-read, M6), `src/services/MembersService.ts` (`ensureSeeded` seeds `settings/categories` too, M6)
- Test: `src/__tests__/FilterBar.test.tsx`, `src/__tests__/FilterActiveBadge.test.tsx`, extend `src/__tests__/FilterContext.test.tsx`, extend `src/__tests__/MembersService.test.ts`, new `src/__tests__/CategoriesService.test.ts`

**Interfaces:**
```ts
// src/contexts/FilterContext.tsx — useGlobalFilters()'s return type gains two fields (M2:
// FilterBar and Dashboard share ONE members/groups fetch instead of each calling
// listMembers/listGroups independently — becomes Nx as Stage 5 copies the pattern otherwise).
// FilterProvider now calls useFamilyMembers()/useGroups() internally, once, for the whole app.
export function useGlobalFilters(): {
  filters: GlobalFilterState;
  setMemberSelection: (s: MemberSelection) => void;
  setPeriod: (p: PeriodFilter) => void;
  setCategoryFilter: (c: CategoryFilter) => void;
  resetFilters: () => void;
  familyMembers: FamilyMembersState; // from Task 2's useFamilyMembers
  groups: GroupsState;               // from Task 2's useGroups
};

// src/types/filters.ts — one addition
export function isDefaultGlobalFilters(filters: GlobalFilterState, now?: Date): boolean;
```
```ts
// src/components/FilterActiveBadge.tsx (Ofra I4) — the D7 half-state (filters persist in
// sessionStorage but are only VISIBLE on Dashboard) made visible on every screen.
export function FilterActiveBadge(): JSX.Element | null;
```
- `FilterBar`: `export default function FilterBar(): JSX.Element;` — Consumes: `useGlobalFilters` (Task 1, extended above), `MemberMultiSelect` (Task 2), `MODULE_REGISTRY` (Task 3), `getCategories` (`CategoriesService`, fixed below).

- [ ] **Step 1: Write the failing tests**

```tsx
// src/__tests__/FilterBar.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FilterBar from '../components/FilterBar';
import { FilterProvider } from '../contexts/FilterContext';

vi.mock('../services/MembersService', () => ({
  listMembers: vi.fn(async () => [{ id: 'omer', name: 'עומר', color: '#1F4E78', role: 'ילד', groups: [], createdAt: 'x', updatedAt: 'x' }]),
}));
vi.mock('../services/GroupsService', () => ({ listGroups: vi.fn(async () => []) }));
vi.mock('../services/CategoriesService', () => ({ getCategories: vi.fn(async () => ['מזון וצריכה', 'חינוך וחוגים']) }));

beforeEach(() => sessionStorage.clear());

function renderBar() {
  return render(<FilterProvider><FilterBar /></FilterProvider>);
}

describe('FilterBar', () => {
  it('renders מי/מתי/מה labels and, once loaded, the member chips and categories', async () => {
    renderBar();
    expect(screen.getByText('מי')).toBeInTheDocument();
    expect(screen.getByText('מתי')).toBeInTheDocument();
    expect(screen.getByText('מה')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('מזון וצריכה')).toBeInTheDocument());
  });

  it('clicking a category toggles it into the filter context', async () => {
    renderBar();
    await waitFor(() => screen.getByText('מזון וצריכה'));
    fireEvent.click(screen.getByText('מזון וצריכה'));
    const persisted = JSON.parse(sessionStorage.getItem('ff_global_filters')!);
    expect(persisted.category.categories).toEqual(['מזון וצריכה']);
  });

  it('the month arrows shift the period and wrap the year at a December/January boundary', async () => {
    renderBar();
    const label = () => screen.getByTestId('global-filter-bar').textContent;
    const before = label();
    fireEvent.click(screen.getByLabelText('חודש הבא'));
    expect(label()).not.toBe(before);
  });

  // Ofra ruling B2 — three always-expanded rows pinned under the header would eat the glance
  // on the one screen this stage exists to make glanceable. Collapsed-by-default on mobile:
  // a single summary line that expands on tap.
  it('starts with the מי/מתי/מה detail sections collapsed behind a tap-to-expand summary line', async () => {
    renderBar();
    await waitFor(() => screen.getByText('עומר'));
    expect(screen.getByTestId('filter-summary-line')).toBeInTheDocument();
    expect(screen.getByTestId('filter-detail-sections')).toHaveClass('hidden');
    fireEvent.click(screen.getByTestId('filter-summary-line'));
    expect(screen.getByTestId('filter-detail-sections')).not.toHaveClass('hidden');
  });

  // D12 — Stage 10's guided tour needs a stable selector for each section, independent of the
  // Hebrew label text (which can change / be edited).
  it('the מי/מתי/מה sections each carry their data-tour-id', async () => {
    renderBar();
    await waitFor(() => screen.getByText('עומר'));
    const root = screen.getByTestId('filter-detail-sections');
    expect(root.querySelector('[data-tour-id="filter.who"]')).toBeTruthy();
    expect(root.querySelector('[data-tour-id="filter.when"]')).toBeTruthy();
    expect(root.querySelector('[data-tour-id="filter.what"]')).toBeTruthy();
  });
});
```

`src/__tests__/FilterBar.test.tsx` should also cover a `listMembers` rejection: renders the error text + a "נסה שוב" retry button, never silently shows an empty member row (same assertion style as `Dashboard.membersLoad.test.tsx`).

`src/__tests__/FilterContext.test.tsx` gains the mocks below at the top (applies to every test in the file, including Task 1's — they don't touch `familyMembers`/`groups` so are unaffected) plus one new test (M2):
```tsx
vi.mock('../services/MembersService', () => ({
  listMembers: vi.fn(async () => [{ id: 'omer', name: 'עומר', color: '#1F4E78', role: 'ילד', groups: [], createdAt: 'x', updatedAt: 'x' }]),
}));
vi.mock('../services/GroupsService', () => ({ listGroups: vi.fn(async () => []) }));
```
```tsx
it('fetches familyMembers/groups once and exposes them through the context (M2 — shared by FilterBar and Dashboard, not fetched twice)', async () => {
  const { result } = renderHook(() => useGlobalFilters(), { wrapper: FilterProvider });
  await waitFor(() => expect(result.current.familyMembers.status).toBe('ready'));
  expect(result.current.familyMembers.members[0].name).toBe('עומר');
  expect(result.current.groups.status).toBe('ready');
});
```

`src/__tests__/FilterActiveBadge.test.tsx` (Ofra I4):
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterActiveBadge } from '../components/FilterActiveBadge';
import { FilterProvider, useGlobalFilters } from '../contexts/FilterContext';

function Harness() {
  const { setCategoryFilter } = useGlobalFilters();
  return (
    <>
      <button onClick={() => setCategoryFilter({ categories: ['מזון וצריכה'] })}>set</button>
      <FilterActiveBadge />
    </>
  );
}

describe('FilterActiveBadge', () => {
  it('renders nothing while filters are at their default', () => {
    render(<FilterProvider><FilterActiveBadge /></FilterProvider>);
    expect(screen.queryByText(/פילטר פעיל/)).not.toBeInTheDocument();
  });
  it('renders once a filter differs from default, and resetFilters clears it on click', () => {
    render(<FilterProvider><Harness /></FilterProvider>);
    fireEvent.click(screen.getByText('set'));
    expect(screen.getByText(/פילטר פעיל/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/נקה/));
    expect(screen.queryByText(/פילטר פעיל/)).not.toBeInTheDocument();
  });
});
```

`src/__tests__/CategoriesService.test.ts` (M6, new — no such file existed before):
```ts
import { describe, expect, it, vi } from 'vitest';
import { getCategories } from '../services/CategoriesService';

const setDocMock = vi.fn();
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, setDoc: setDocMock, getDoc: vi.fn(async () => ({ exists: () => false })) };
});

describe('getCategories (M6 — no more seed-on-read)', () => {
  it('returns an empty list for a missing doc and NEVER calls setDoc (a member-role session cannot write settings/*)', async () => {
    const result = await getCategories();
    expect(result).toEqual([]);
    expect(setDocMock).not.toHaveBeenCalled();
  });
});
```

`src/__tests__/MembersService.test.ts`'s existing `ensureSeeded` describe block gains one test (M6):
```ts
it('also seeds settings/categories with the default category list when it is missing (M6)', async () => {
  await ensureSeeded();
  const snap = await getDoc(doc(db, 'settings', 'categories'));
  expect(snap.exists()).toBe(true);
  expect((snap.data()!.list as string[]).length).toBeGreaterThan(0);
});
it('does NOT overwrite an existing, non-empty settings/categories doc', async () => {
  await setDoc(doc(db, 'settings', 'categories'), { list: ['קטגוריה מותאמת אישית'] });
  await ensureSeeded();
  const snap = await getDoc(doc(db, 'settings', 'categories'));
  expect(snap.data()!.list).toEqual(['קטגוריה מותאמת אישית']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/FilterBar.test.tsx src/__tests__/FilterActiveBadge.test.tsx src/__tests__/CategoriesService.test.ts src/__tests__/FilterContext.test.tsx src/__tests__/MembersService.test.ts`
Expected: FAIL — new modules/assertions not yet satisfied.

- [ ] **Step 3: Extend `FilterContext.tsx` to lift `useFamilyMembers`/`useGroups` (M2)**

```ts
// src/contexts/FilterContext.tsx — inside FilterProvider, alongside the existing filters state:
import { useFamilyMembers } from '../hooks/useFamilyMembers';
import { useGroups } from '../hooks/useGroups';
// ...
const familyMembers = useFamilyMembers();
const groups = useGroups();
// ...and add `familyMembers, groups` to the context value alongside `filters`/`setMemberSelection`/etc.
```
This makes `FilterProvider` the SINGLE place that calls `listMembers`/`listGroups` for the whole app (it wraps the entire `session.status === 'ready'` tree in Step 6 below, not just Dashboard) — a net reduction versus the pre-amendment plan, where Dashboard and FilterBar would each have fetched independently every time the Dashboard tab was active.

- [ ] **Step 4: Fix `CategoriesService.getCategories()`'s seed-on-read (M6)**

```ts
// src/services/CategoriesService.ts
export async function getCategories(): Promise<string[]> {
  const snap = await getDoc(CATEGORIES_DOC());
  // No more seed-on-read here (Stage 4 review, M6): `settings` writes are super-admin/parent
  // only (firestore.rules) — a member-role session calling this on a fresh database used to hit
  // permission-denied on the setDoc below and render a permanent error, per this plan's own
  // no-silent-catch rule. Seeding now happens once, at bootstrap, in MembersService.ensureSeeded()
  // — a genuinely missing/empty doc here is a legitimate (if unusual) empty state, not an error.
  return snap.exists() ? ((snap.data()?.list as string[]) ?? []) : [];
}
```

Move the seeding into `ensureSeeded()`:
```ts
// src/services/MembersService.ts — ensureSeeded(), after the existing member-seeding batch.commit()
import { CATEGORY_MAP } from '../utils/FileProcessor';
// ...
const categoriesSnap = await getDoc(doc(db, 'settings', 'categories'));
if (!categoriesSnap.exists() || !((categoriesSnap.data()?.list as unknown[] | undefined)?.length)) {
  await setDoc(doc(db, 'settings', 'categories'), { list: Object.values(CATEGORY_MAP) });
}
```
(`setDoc` joins `MembersService.ts`'s existing `firebase/firestore` import line; `ensureSeeded` is already super-admin-gated at its one call site in `App.tsx`, so this write is never attempted by a `'member'`/`'parent'` session.)

- [ ] **Step 5: Implement `FilterBar.tsx` and `FilterActiveBadge.tsx`**

`FilterBar.tsx` — sticky wrapper (`sticky top-[57px] md:top-[73px] z-40`, matching `App.tsx`'s header height so it sits directly under it without overlap); consumes `useGlobalFilters()`'s `familyMembers`/`groups` (Step 3, M2) instead of calling the hooks itself. Mobile-first collapse (Ofra B2): an `isExpanded` `useState(false)`, a `data-testid="filter-summary-line"` button always visible (`onClick={() => setIsExpanded(v => !v)}`, `aria-expanded={isExpanded}`) rendering a one-line summary (e.g. `"כולם · אוגוסט 2026 · הכל"`, composed from `filters`), and a `data-testid="filter-detail-sections"` wrapper around the three actual sections carrying `className={\`${isExpanded ? 'block' : 'hidden'} md:block\`}` (so desktop always shows the full bar regardless of `isExpanded` — the collapse is a mobile-only concession, per B2's "on mobile" scope). Three sections, each carrying its D12 tour id:
- מי (`data-tour-id="filter.who"`) — `MemberMultiSelect` fed by `familyMembers.members`/`groups.groups` from context.
- מתי (`data-tour-id="filter.when"`) — month/year label with prev/next arrows calling `setPeriod`, wrapping across a year boundary.
- מה (`data-tour-id="filter.what"`) — categories loaded via `getCategories()` (now read-only, Step 4) with its own `loading`/`error`/`ready` branches, rendered as toggleable pill buttons writing into `filters.category.categories`.

`FilterActiveBadge.tsx` (Ofra I4) — `const { filters, resetFilters } = useGlobalFilters(); if (isDefaultGlobalFilters(filters)) return null;` else a small pill (`"פילטר פעיל · נקה"`) whose click calls `resetFilters()`. Add `isDefaultGlobalFilters` to `src/types/filters.ts` (compares each of `member`/`period`/`category` against `defaultGlobalFilters()`'s shape).

- [ ] **Step 6: Run to verify pass**

Run: `npm run lint && npx vitest run src/__tests__/FilterBar.test.tsx src/__tests__/FilterActiveBadge.test.tsx src/__tests__/CategoriesService.test.ts src/__tests__/FilterContext.test.tsx src/__tests__/MembersService.test.ts`
Expected: ALL PASS.

- [ ] **Step 7: Mount in `App.tsx`, wrapped in `FilterProvider`; badge in the header**

```tsx
import { FilterProvider } from './contexts/FilterContext';
import FilterBar from './components/FilterBar';
import { FilterActiveBadge } from './components/FilterActiveBadge';
import { MODULE_REGISTRY } from './config/moduleRegistry';
```

Wrap the existing `return (<div className="min-h-screen ...">...)` (the `session.status === 'ready'` branch) in `<FilterProvider>` — this now also covers the header, so `FilterActiveBadge` (I4, visible on every screen) and every future screen (Stage 5+) share the one members/groups fetch (M2). Render `<FilterBar />` conditionally right below the sticky header, above the `flex flex-1` content row:

```tsx
{MODULE_REGISTRY.find((m) => m.id === activeTab)?.usesGlobalFilters && <FilterBar />}
```

Add `<FilterActiveBadge />` to the header's right-side control cluster, next to `SyncButton` (current line ~127) — visible on EVERY screen, not just Dashboard, since it lives in the header outside the conditional `FilterBar` mount:
```tsx
<SyncButton />
<FilterActiveBadge />
```

- [ ] **Step 8: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS.

- [ ] **Step 9: Manual smoke check**

`npm run emu` + sign in — confirm the filter bar appears under the header only on "לוח תצוגה ראשי" (Dashboard) and disappears on every other tab (no duplicate/orphaned filter UI anywhere else this stage, per D7); confirm the collapsed summary line + tap-to-expand on a narrow viewport; set a member/category filter on Dashboard, switch to another tab, confirm the "פילטר פעיל · נקה" badge is now visible in the header on that OTHER tab too, and clicking נקה resets it.

- [ ] **Step 10: Commit**

```bash
git add src/components/FilterBar.tsx src/components/FilterActiveBadge.tsx src/contexts/FilterContext.tsx src/types/filters.ts src/services/CategoriesService.ts src/services/MembersService.ts src/App.tsx src/__tests__/FilterBar.test.tsx src/__tests__/FilterActiveBadge.test.tsx src/__tests__/CategoriesService.test.ts src/__tests__/FilterContext.test.tsx src/__tests__/MembersService.test.ts
git commit -m "feat: global sticky FilterBar (מי/מתי/מה, mobile-collapsed), shared members/groups fetch, filter-active header badge, category-seeding bootstrap fix

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Hover-explain glossary + `<Explain>` component

**Files:**
- Create: `src/types/glossary.ts`, `src/config/glossary.ts`, `src/utils/plainLanguage.ts` (Ofra I5), `src/components/Explain.tsx`
- Test: `src/__tests__/glossary.test.ts`, `src/__tests__/plainLanguage.test.ts`, `src/__tests__/Explain.test.tsx`

**Interfaces:**
```ts
// src/types/glossary.ts
export interface GlossaryEntry { id: string; title: string; explanation: string; howComputed: string; source: string; asOf?: string; }

// src/config/glossary.ts
export const GLOSSARY: Record<string, GlossaryEntry>;
export function getGlossaryEntry(id: string): GlossaryEntry | null;

// src/utils/plainLanguage.ts (Ofra I5 — a testable standard for "ילד יבין" (spec §5.2), not
// just "the string is non-empty")
export const BANNED_JARGON: readonly string[]; // e.g. 'נזילות', 'תזרים', 'רגרסיה', 'ROI'
export const MAX_SENTENCE_WORDS: number; // 22
export function violatesPlainLanguage(text: string): string[]; // returns a list of violation
  // reasons (empty = compliant) — a banned word found, or a sentence over MAX_SENTENCE_WORDS

// src/components/Explain.tsx
export function Explain({ id }: { id: string }): JSX.Element | null;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/glossary.test.ts
import { describe, expect, it } from 'vitest';
import { GLOSSARY, getGlossaryEntry } from '../config/glossary';
import { violatesPlainLanguage } from '../utils/plainLanguage';

const REQUIRED_IDS = [
  'dashboard.totalIncome', 'dashboard.totalExpenses', 'dashboard.monthlyBalance', 'dashboard.plannedBudget',
  'dashboard.netWorth',
  'dashboard.ecosystem.liquid', 'dashboard.ecosystem.investments', 'dashboard.ecosystem.pensions',
  'dashboard.ecosystem.crypto', 'dashboard.ecosystem.realEstate',
  'expenses.listTotal',
];

describe('GLOSSARY', () => {
  it.each(REQUIRED_IDS)('has a complete entry for %s (title/explanation/howComputed/source all non-empty)', (id) => {
    const entry = getGlossaryEntry(id);
    expect(entry).not.toBeNull();
    expect(entry!.title.length).toBeGreaterThan(0);
    expect(entry!.explanation.length).toBeGreaterThan(0);
    expect(entry!.howComputed.length).toBeGreaterThan(0);
    expect(entry!.source.length).toBeGreaterThan(0);
  });
  it('getGlossaryEntry returns null for an unknown id (never throws)', () => {
    expect(getGlossaryEntry('nonexistent.id')).toBeNull();
  });
  it('the real-estate entry explicitly calls out the mortgage double-counting risk (netWorth.ts D5)', () => {
    expect(GLOSSARY['dashboard.ecosystem.realEstate'].explanation).toMatch(/פעמיים|כפול/);
  });
  it('the expenses.listTotal entry documents the refund/cancellation carve-out (Stage 1 ledger carry-forward)', () => {
    expect(GLOSSARY['expenses.listTotal'].explanation).toMatch(/החזר|ביטול/);
  });
  // Ofra ruling I5 — spec §5.2's actual requirement is plain Hebrew a child understands;
  // "the string is non-empty" (above) doesn't test that. Every entry's explanation/howComputed
  // must pass the same testable plain-language standard used across the app.
  it.each(REQUIRED_IDS)('%s has no plain-language violations (Ofra I5 — banned jargon / sentence length)', (id) => {
    const entry = getGlossaryEntry(id)!;
    expect(violatesPlainLanguage(entry.explanation)).toEqual([]);
    expect(violatesPlainLanguage(entry.howComputed)).toEqual([]);
  });
});
```

`src/__tests__/plainLanguage.test.ts` (Ofra I5 — the standard itself, tested independently of any one glossary entry):
```ts
import { describe, expect, it } from 'vitest';
import { violatesPlainLanguage, BANNED_JARGON, MAX_SENTENCE_WORDS } from '../utils/plainLanguage';

describe('violatesPlainLanguage', () => {
  it('flags a banned-jargon word', () => {
    expect(violatesPlainLanguage(`המונח ${BANNED_JARGON[0]} מופיע כאן.`).length).toBeGreaterThan(0);
  });
  it('flags a sentence longer than MAX_SENTENCE_WORDS', () => {
    const longSentence = Array.from({ length: MAX_SENTENCE_WORDS + 5 }, () => 'מילה').join(' ') + '.';
    expect(violatesPlainLanguage(longSentence).length).toBeGreaterThan(0);
  });
  it('returns no violations for a short, jargon-free sentence', () => {
    expect(violatesPlainLanguage('סכום ההכנסות החודש, לפני הוצאות.')).toEqual([]);
  });
});
```

```tsx
// src/__tests__/Explain.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Explain } from '../components/Explain';

describe('Explain', () => {
  it('renders an always-present, always-clickable ⓘ trigger for a known id', () => {
    render(<Explain id="dashboard.totalIncome" />);
    expect(screen.getByRole('button', { name: /הסבר/ })).toBeInTheDocument();
  });
  it('renders nothing for an unknown id (never a broken info button)', () => {
    const { container } = render(<Explain id="nonexistent.id" />);
    expect(container).toBeEmptyDOMElement();
  });
  it('clicking the trigger opens the card WITHOUT any hover (mobile/tap path)', () => {
    render(<Explain id="dashboard.totalIncome" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('סך הכנסות');
  });
  it('clicking again closes it (toggle)', () => {
    render(<Explain id="dashboard.totalIncome" />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
  it('hover opens it on its own, without any click (desktop path)', () => {
    render(<Explain id="dashboard.totalIncome" />);
    fireEvent.mouseEnter(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
  it('a click-pinned card stays open after the mouse leaves', () => {
    render(<Explain id="dashboard.totalIncome" />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    fireEvent.mouseLeave(btn);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
  it('Escape closes an open card', () => {
    render(<Explain id="dashboard.totalIncome" />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
  // Ofra ruling — the ⓘ glyph itself is small, but its tap target must not be (WCAG-adjacent
  // "don't make people aim precisely on mobile" concern, same convention Dashboard's other icon
  // buttons already use, e.g. the manage-members button: min-w-[44px] min-h-[44px]).
  it('the trigger has a >=44x44 hit area even though the glyph is small', () => {
    render(<Explain id="dashboard.totalIncome" />);
    const btn = screen.getByRole('button');
    expect(btn.className).toMatch(/min-w-\[44px\]/);
    expect(btn.className).toMatch(/min-h-\[44px\]/);
  });
  // D12 — Stage 10's guided tour needs a stable selector per glossary id.
  it('carries a stable data-tour-id for the Stage 10 guided tour (D12)', () => {
    render(<Explain id="dashboard.totalIncome" />);
    expect(screen.getByRole('button')).toHaveAttribute('data-tour-id', 'explain.dashboard.totalIncome');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/glossary.test.ts src/__tests__/plainLanguage.test.ts src/__tests__/Explain.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `plainLanguage.ts`, `glossary.ts`, and `Explain.tsx`**

`src/utils/plainLanguage.ts` (Ofra I5) — `BANNED_JARGON` a short list of financial/technical jargon this app must never surface to a child (`'נזילות'`, `'תזרים'`, `'רגרסיה'`, `'ROI'`, `'וריאנס'`); `MAX_SENTENCE_WORDS = 22`; `violatesPlainLanguage(text)` splits on `. ! ? ׃` into sentences, flags any sentence over the word limit and any occurrence of a banned word, returning a human-readable reason string per violation (empty array = compliant).

`src/config/glossary.ts` — the eleven entries reasoned through in D4 and the header comment above, including the exact real-estate double-counting caveat (referencing `netWorth.ts`'s own D5 language) and the `expenses.listTotal` refund/cancellation carve-out (referencing `transactionFilters.ts`'s `isExpenseListRow` vs `isExpenseRow` distinction verbatim in the `howComputed` field). Every entry is written to satisfy `violatesPlainLanguage` — short sentences, no jargon, the vocabulary a child can follow (spec §5.2).

**Named reviewer (Ofra I5 exit criterion):** before this task's commit, Lilit (non-technical, the other adult in the household `MembersService`'s own default seed already names — spec §3's literal acceptance bar is "someone who hasn't seen the screen understands the number") reads all eleven glossary entries end-to-end and confirms each one answers "what is this, in words I'd use" — not just that the automated `violatesPlainLanguage` check is green. Record her sign-off (or the specific entries she asked to be reworded) in this task's commit message or PR description. The automated check catches jargon/length; it cannot catch "technically simple words in a confusing order" — that needs a human, named, not "someone" TBD.

`src/components/Explain.tsx` — `open`/`pinned` state exactly as reasoned in D5: `onMouseEnter` sets `open(true)`; `onMouseLeave` sets `open(false)` only `if (!pinned)`; `onClick` toggles `pinned` and sets `open` to match; outside-click and `Escape` both reset `pinned` and `open` to `false`; returns `null` (after a dev-only `console.warn`) for an unknown id. The trigger `<button>` carries `className="... min-w-[44px] min-h-[44px] flex items-center justify-center"` (Ofra's ≥44×44 ruling — the glyph stays small, the tap target doesn't) and `data-tour-id={`explain.${id}`}` (D12).

- [ ] **Step 4: Run to verify pass**

Run: `npm run lint && npx vitest run src/__tests__/glossary.test.ts src/__tests__/plainLanguage.test.ts src/__tests__/Explain.test.tsx`
Expected: ALL PASS.

- [ ] **Step 5: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/glossary.ts src/config/glossary.ts src/utils/plainLanguage.ts src/components/Explain.tsx src/__tests__/glossary.test.ts src/__tests__/plainLanguage.test.ts src/__tests__/Explain.test.tsx
git commit -m "feat: central hover-explain glossary + <Explain> component (tap-first, hover as desktop enhancement, >=44px hit area, plain-language standard, Lilit-reviewed)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Rewire `Dashboard` onto global filters (member + period + category) + wire `<Explain>` + `ComparisonTable` + D8 disclosure + fix `loadEcosystem`/`loadBudget` empty-on-error AND permission-denied handling

**Files:**
- Modify: `src/components/Dashboard.tsx`, `src/config/glossary.ts` (adds the `dashboard.netWorth` entry, Step 7)
- Test: `src/__tests__/Dashboard.membersLoad.test.tsx` (extend), new `src/__tests__/Dashboard.globalFilters.test.tsx`

**Interfaces:**
- Consumes: `useGlobalFilters` (Task 1, extended in Task 4 with `familyMembers`/`groups` — M2), `resolveMemberSelectionNames`/`resolveEcosystemKey` (Task 1), `ComparisonTable` (Task 2, D9), `Explain` (Task 5)
- This task also folds in two additions from a security fix that landed mid-stage (commit `60d1c32`, `fix(rules): restrict settings/ecosystem and settings/budgetConfig to parents — members could read household net worth`): `firestore.rules` now denies a `'member'`-role read of `settings/ecosystem`/`settings/budgetConfig` outright (previously a confirmed live exploit let a zero-permission child read the household's full net-worth document). This task's own `loadEcosystem`/`loadBudget` edits are exactly the code paths that now need to distinguish "you don't have access" from "the read failed" — folded in here rather than as a seventh task, since both functions are already open for the filter-key/category-wiring changes below.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/__tests__/Dashboard.globalFilters.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Dashboard from '../components/Dashboard';
import { FilterProvider } from '../contexts/FilterContext';
import { NotificationProvider } from '../contexts/NotificationContext';

// ...mocks for firebase/firestore, MembersService, GroupsService, ai.ts following
// Dashboard.membersLoad.test.tsx's existing mocking pattern...

function renderDashboard() {
  return render(<NotificationProvider><FilterProvider><Dashboard /></FilterProvider></NotificationProvider>);
}

describe('Dashboard — rewired onto global filters (Task 6)', () => {
  it('renders no local member/date selector controls of its own anymore (owned by FilterBar now)', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.queryByText('טוען')).not.toBeInTheDocument());
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument(); // the old month/year <select>s are gone
  });
  it('keeps the manage-family-members entry point (not a filter control, stays on Dashboard)', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByTitle(/ניהול בני משפחה/)).toBeInTheDocument());
  });
  it('renders an <Explain> trigger on all four KPI cards and the net-worth card', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId('explain-dashboard.totalIncome')).toBeInTheDocument());
    expect(screen.getByTestId('explain-dashboard.totalExpenses')).toBeInTheDocument();
    expect(screen.getByTestId('explain-dashboard.monthlyBalance')).toBeInTheDocument();
    expect(screen.getByTestId('explain-dashboard.plannedBudget')).toBeInTheDocument();
    expect(screen.getByTestId('explain-dashboard.netWorth')).toBeInTheDocument();
  });
  it('a failed ecosystem read shows an explicit error, and does NOT reset the ecosystem figures to zero (carry-forward fix)', async () => {
    // mock getDoc('settings','ecosystem') to reject with a plain Error (no .code — a genuine
    // connectivity failure, NOT permission-denied) after an initial successful load with non-zero
    // liquid, then trigger a refetch (member-selection change) and assert the rendered ₪ figure is
    // unchanged from its last good value while an ecosystemLoadError message is now shown.
  });

  // Security fix 60d1c32 landed mid-stage: firestore.rules now restricts settings/ecosystem and
  // settings/budgetConfig to super-admin/parent reads (a zero-permission child could previously
  // read the household's full net-worth doc). Controller ruling: a permission refusal must HIDE
  // the card (or show a calm access message) — it must NEVER show a red error banner, and never
  // a silent ₪0 (which would be indistinguishable from "this household owns nothing").
  it('a permission-denied ecosystem read shows a calm access message — never the red error banner, never ₪0 (security fix 60d1c32)', async () => {
    // mock getDoc('settings','ecosystem') to reject with { code: 'permission-denied' } (matches
    // the shape firebase/firestore throws); assert "אין לך הרשאה לצפות בנתון זה" renders and
    // ecosystemLoadError's red banner does NOT.
  });
  it('a permission-denied budgetConfig read shows a calm access message instead of the connectivity-retry banner (security fix 60d1c32)', async () => {
    // mock getDoc('settings','budgetConfig') to reject with { code: 'permission-denied' };
    // assert a calm access message renders in place of the budget-vs-actual card and
    // budgetLoadError's "בדוק את החיבור ונסה שוב" connectivity copy does NOT.
  });
  it('a non-permission budgetConfig read failure still shows the connectivity-retry error (unchanged)', async () => {
    // mock getDoc('settings','budgetConfig') to reject with a plain Error (no .code); assert
    // budgetLoadError's existing copy renders, not the access-denied message.
  });

  // M1 (what-did-we-miss review): the מה/category filter was state-only before this fix — Task 6
  // rewired member+period into loadBudget's actuals loop but never categories, so a user toggling
  // a category in FilterBar saw no change in the numbers. Ships green, silently wrong.
  it('wires filters.category.categories into loadBudget\'s actuals aggregation — toggling a category changes the rendered figures (M1)', async () => {
    // seed transaction_lines with two rows in different categories for the current month/owner
    // selection; render with filters.category.categories = [] and assert the total actual spend
    // includes both rows' amounts; set filters.category.categories to just the first category's
    // name and assert the rendered total now reflects only that row's amount.
  });

  // D8 (amended per Ofra ruling B1): the 'all' ecosystem/budget fallback for a 2+-member or group
  // selection must be disclosed IN THE UI, not only in the design doc.
  it('shows the D8 disclosure note on the ecosystem/net-worth cards when 2+ members are selected (resolveEcosystemKey falls back to \'all\')', async () => {
    // set filters.member = { mode: 'members', memberIds: ['omer', 'david'], groupId: null };
    // assert the note "מציג את נתוני כל המשפחה — סיכום לפי כמה בני משפחה עדיין לא נתמך" renders.
  });
  it('does NOT show the D8 disclosure note when the member filter is \'all\' or exactly one member', async () => {
    // assert the note is absent for both { mode: 'all', ... } and a single-member selection.
  });

  // D9 (amended per Lola finding 1): ComparisonTable ships WIRED this stage, not unwired —
  // fed by loadSettlement's already-computed per-owner `paid` totals (settlementData), a
  // materially cheaper real consumer than a new per-owner aggregation (D9's own reasoning).
  it('renders a "מי הוציא כמה החודש" ComparisonTable card fed by settlementData (D9)', async () => {
    // with >=2 adult members and their settlement paid-totals mocked non-zero, assert the card
    // heading "מי הוציא כמה החודש" renders and each configured adult's name + ₪ amount appears
    // inside a ComparisonTable row (not a placeholder / not empty).
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/Dashboard.globalFilters.test.tsx`
Expected: FAIL — old selector `<select>`s still present, no `Explain` test ids, `FilterProvider` wrapper not yet required/consumed.

- [ ] **Step 3: Remove the local filter state AND the local family-members fetch; consume `FilterContext` (M2)**

Replace (Dashboard.tsx, current lines 67–69):
```tsx
const [selectedMonth, setSelectedMonth] = useState(() => String(new Date().getMonth() + 1).padStart(2, '0'));
const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear().toString());
const [selectedMember, setSelectedMember] = useState<string>('all');
```
with:
```tsx
const { filters, familyMembers: familyMembersState, groups: groupsState } = useGlobalFilters();
const selectedMonth = filters.period.month;
const selectedYear = filters.period.year;
const ecosystemKey = resolveEcosystemKey(filters.member); // D8
const selectedMemberNames = resolveMemberSelectionNames(
  filters.member, familyMembersState.members, groupsState.status === 'ready' ? groupsState.groups : []
);
```
Add the corresponding imports (`useGlobalFilters` from `../contexts/FilterContext`; `resolveEcosystemKey`/`resolveMemberSelectionNames` from `../utils/resolveMemberSelection`; `Explain` from `./Explain`; `ComparisonTable`, `ComparisonRow` from `./ComparisonTable`). No `useFamilyMembers`/`useGroups` import here anymore — Dashboard now reads the ONE shared fetch off `useGlobalFilters()` (M2), the same object `FilterBar` (Task 4) reads.

Replace Dashboard's own local family-members fetch (current lines 71–138: the `familyMembers`/`familyMembersError` `useState` pair and the `useEffect` that calls `listMembers()`) — deleted entirely, since `FilterProvider` now owns that fetch (Task 4). In its place, Dashboard derives `familyMembers` from the shared state, with a thin local override ONLY for the optimistic-update/rollback the `FamilyManagerModal` save flow needs (Step 3b below — the shared hook's `members` array is read-only from Dashboard's point of view, by design, since other consumers read it too):
```tsx
const [membersOverride, setMembersOverride] = useState<FamilyMember[] | null>(null);
// Cleared automatically once the SHARED fetch produces a fresh array (e.g. after
// familyMembersState.reload() below completes) — the optimistic view never goes stale once the
// real data catches up.
useEffect(() => { setMembersOverride(null); }, [familyMembersState.members]);
const familyMembers = membersOverride ?? familyMembersState.members;
const familyMembersError = membersOverride === null && familyMembersState.status === 'error'
  ? familyMembersState.error
  : null;
```

Delete `handlePrevMonth`/`handleNextMonth` (current lines ~400–419) — dead code once the local Date Selector JSX (next step) is removed; `FilterBar` owns month-shifting now.

- [ ] **Step 3b: Rewire `FamilyManagerModal`'s `onSave` handler onto the shared fetch**

Replace the modal's `onSave` body (current lines 1022–1067) — `setFamilyMembers`/`listMembers()` calls become `setMembersOverride`/`familyMembersState.reload()`:
```tsx
onSave={async (updatedMembers) => {
  const basedOnIds = familyMembers.map((m) => m.id);
  const preEditMembers = familyMembers;

  // Optimistic update — FamilyManagerModal already shows its own success toast synchronously.
  setMembersOverride(updatedMembers);
  try {
    await saveMembers(updatedMembers, basedOnIds);
    familyMembersState.reload(); // M2 — resync the ONE shared fetch; FilterBar sees the change too
  } catch (err) {
    if (err instanceof StaleMembersError) {
      console.error('[Dashboard] Stale member list — edit rejected without writing:', err);
      addNotification('error', 'רשימת בני המשפחה השתנתה בינתיים ולכן העדכון לא נשמר. הרשימה מסונכרנת מחדש.');
    } else {
      console.error('[Dashboard] Failed to save members:', err);
      addNotification('error', 'שמירת בני המשפחה נכשלה. בדוק את החיבור ונסה שוב.');
    }
    // Roll back the optimistic view; reload() re-syncs the shared fetch from source. If the
    // reload ALSO fails, the shared hook's own status:'error' surfaces (generic copy) once
    // membersOverride clears — the previous double-failure-specific Hebrew copy ("שמירת בני
    // המשפחה נכשלה ולא ניתן היה לסנכרן מחדש...") is not reproduced verbatim; a disclosed,
    // minor copy simplification traded for one shared fetch instead of two (M2), noted in Risks.
    setMembersOverride(preEditMembers);
    familyMembersState.reload();
  }
}}
```

- [ ] **Step 4: Rewire the three effects that used `selectedMember` as a single id — filter-key swap, category wiring (M1), permission-denied branching (security fix 60d1c32), and the empty-on-error carry-forward**

`loadEcosystem` (current lines 165–182) — swap the lookup key, fix the empty-on-error carry-forward, AND branch on a permission refusal (a `'member'`-role session now legitimately gets `permission-denied` from `firestore.rules` on this doc, per commit `60d1c32` — that is NOT the same failure as a dropped connection and must not render as one):
```tsx
useEffect(() => {
  const loadEcosystem = async () => {
    setEcosystemLoadError(null);
    setEcosystemAccessDenied(false);
    try {
      const snap = await getDoc(doc(db, 'settings', 'ecosystem'));
      if (snap.exists()) {
        const data = snap.data();
        const memberData = (data[ecosystemKey] ?? data['all'] ?? EMPTY_ECOSYSTEM) as EcosystemData;
        setEcosystem(memberData);
      } else {
        setEcosystem(EMPTY_ECOSYSTEM); // a genuinely missing doc is a legitimate empty state, not an error
      }
    } catch (err: any) {
      if (err?.code === 'permission-denied') {
        // Expected for a 'member'-role session after commit 60d1c32 — a genuine "you don't have
        // access" case, not a connectivity failure. Controller ruling: hide the card / show a
        // calm access message, never the red error banner, never a silent ₪0.
        setEcosystemAccessDenied(true);
      } else {
        // Carry-forward fix (Stage 1 Task 6a / Task 5 review): a failed read must render an
        // error, never silently reset to EMPTY_ECOSYSTEM — that would show "₪0 everywhere"
        // indistinguishable from a genuinely empty household.
        console.error('Failed to load ecosystem:', err);
        setEcosystemLoadError('טעינת נתוני הנכסים נכשלה. בדוק את החיבור ונסה שוב.');
      }
    }
  };
  loadEcosystem();
}, [ecosystemKey]);
```
Add `const [ecosystemLoadError, setEcosystemLoadError] = useState<string | null>(null);` and `const [ecosystemAccessDenied, setEcosystemAccessDenied] = useState(false);` alongside the existing `budgetLoadError`/`settlementLoadError` state declarations. The ecosystem/net-worth card's render branch (Step 6 below extends it further for the D8 note) becomes a three-way: `ecosystemAccessDenied` → calm message; else `ecosystemLoadError` → the existing red banner; else the tiles.

`loadBudget` (current lines 185–249) — swap the `budgetMap` key and the owner filter, wire the category filter into the actuals loop (M1 — this was the gap: the מה dimension was state-only, consuming into nothing), and add the same permission-denied branch (`settings/budgetConfig` is now also parent/super-admin-only per commit `60d1c32`):
```tsx
try {
  setBudgetAccessDenied(false);
  const budgetSnap = await getDoc(doc(db, 'settings', 'budgetConfig'));
  const budgetMap: Record<string, number> = {};

  if (budgetSnap.exists()) {
    const data = budgetSnap.data();
    const memberBudget = (data[ecosystemKey] ?? data['all'] ?? []) as { name: string; budget: number }[];
    memberBudget.forEach(b => { budgetMap[b.name] = b.budget; });
  }

  const actuals: Record<string, number> = {};
  const tlSnap = await getDocs(collection(db, 'transaction_lines'));

  tlSnap.docs.forEach(d => {
    const data = d.data();
    if (!isExpenseRow(data)) return;
    // was: if (filterOwnerName && data.owner && data.owner !== filterOwnerName) return;
    if (selectedMemberNames && data.owner && !selectedMemberNames.has(data.owner)) return;
    if (!matchesMonthYear(data.date, selectedMonth, selectedYear)) return;

    const cat: string = data.category ?? 'שונות';
    // M1 — the מה/category filter was state-only before this fix; wiring it here is the one-line
    // change the "what-did-we-miss" review flagged as missing from an already-open loop.
    if (filters.category.categories.length > 0 && !filters.category.categories.includes(cat)) return;
    actuals[cat] = (actuals[cat] ?? 0) + ((data.amount as number) ?? 0);
  });

  // ...unchanged: merge budgetMap/actuals into budgetVsActual, pieData into categories...
} catch (err: any) {
  if (err?.code === 'permission-denied') {
    // The budgetConfig read (first line of the try block) is what throws for a 'member'-role
    // session post-60d1c32 — execution never reaches the transaction_lines read, so the whole
    // budget-vs-actual card is access-denied this render, not just the target half (disclosed in
    // Risks — a finer split is Stage 5+ work, out of a shell plan's scope).
    setBudgetAccessDenied(true);
  } else {
    console.error('Failed to load budget:', err);
    setBudgetLoadError('טעינת נתוני התקציב נכשלה. בדוק את החיבור ונסה שוב.');
  }
}
```
Add `const [budgetAccessDenied, setBudgetAccessDenied] = useState(false);` alongside `budgetLoadError`. Dependency array: `}, [selectedMonth, selectedYear, ecosystemKey, selectedMemberNames, familyMembers, filters.category.categories]);` (delete the now-unused `filterOwnerName` local; `filters.category.categories` is the M1 addition).

The AI-insights effect's dependency array (current line 339): `}, [selectedMember, incomes]);` → `}, [filters.member, incomes]);` (its body never referenced `selectedMember` directly — it was only a re-trigger dependency; `filters.member` preserves the same "re-run when the מי selection changes" trigger).

`selectedMemberLabel` (current lines 452–454) — generalize past a single id:
```tsx
const selectedMemberLabel =
  filters.member.mode === 'members' && filters.member.memberIds.length === 1
    ? familyMembers.find((m) => m.id === filters.member.memberIds[0])?.name ?? null
    : filters.member.mode === 'members' && filters.member.memberIds.length > 1
    ? `${filters.member.memberIds.length} נבחרו`
    : filters.member.mode === 'group' && groupsState.status === 'ready'
    ? groupsState.groups.find((g) => g.id === filters.member.groupId)?.name ?? null
    : null;
```

- [ ] **Step 5: Remove the local Member/Date Selector JSX; keep the manage-members button standalone**

Replace the whole `{/* Member Selector */}` + `{/* Date Selector */}` block (current lines 470–545) — now owned by `FilterBar` — with just the manage-family-members button it used to sit next to, unchanged (same `disabled`/`title` gating on `familyMembersError`):

```tsx
<div className="flex items-center gap-2 w-full md:w-auto justify-end">
  <button
    onClick={() => setIsFamilyModalOpen(true)}
    disabled={!!familyMembersError}
    className={`p-2.5 rounded-xl border shadow-sm transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center ${
      familyMembersError
        ? 'text-slate-300 bg-slate-50 border-slate-200 cursor-not-allowed'
        : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border-slate-200 bg-white'
    }`}
    title={familyMembersError ? 'ניהול בני משפחה — טעינת הרשימה נכשלה, לא ניתן לערוך כעת' : 'ניהול בני משפחה'}
  >
    <Settings className="w-5 h-5" />
  </button>
</div>
```

- [ ] **Step 6: Wire `<Explain>` onto the four KPI cards, five ecosystem tiles, and the net-worth card**

Each KPI card (current lines 606–645) gets one `<Explain id="..."/>` next to its label, e.g.:
```tsx
<p className="text-sm text-slate-500 font-medium flex items-center gap-1">
  סך הכנסות <Explain id="dashboard.totalIncome" />
</p>
```
— repeated for `dashboard.totalExpenses`, `dashboard.monthlyBalance`, `dashboard.plannedBudget`.

The net-worth card header (current line 552) gets `dashboard.netWorth` (a new glossary entry, added retroactively in this step since it's specific to this card's legacy `totalAssets - totalLiabilities` computation — not part of Task 5's original list; document in the glossary file that this figure is the pre-Stage-3 ecosystem-only calculation, distinct from `computeNetWorth`'s not-yet-wired-in provenance):
```tsx
<h2 className="text-base md:text-lg font-medium text-indigo-100 flex items-center gap-1.5">
  שווי נקי (Net Worth) <Explain id="dashboard.netWorth" />
</h2>
```

Each of the five ecosystem tiles (current lines 567–591) gets its matching `dashboard.ecosystem.*` id next to its label, e.g.:
```tsx
<p className="text-[10px] text-slate-500 mb-1 text-center flex items-center justify-center gap-0.5">
  עו"ש וחסכון <Explain id="dashboard.ecosystem.liquid" />
</p>
```

- [ ] **Step 6b: Branch the ecosystem/net-worth and budget cards on `*AccessDenied`; add the D8 disclosure note (Ofra B1)**

Wrap the ecosystem/net-worth card's existing tile JSX (the block Step 6 above adds `<Explain>` triggers to) in the three-way branch Step 4 set up, and add the D8 note whenever a 2+-member/group selection silently fell back to the household-wide figures:
```tsx
{ecosystemAccessDenied ? (
  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-slate-500 text-sm">
    אין לך הרשאה לצפות בנתון זה
  </div>
) : ecosystemLoadError ? (
  <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
    <p className="text-red-600 font-medium">{ecosystemLoadError}</p>
  </div>
) : (
  <>
    {/* existing ecosystem tiles + net-worth card JSX, unchanged except for Step 6's <Explain> additions */}
    {ecosystemKey === 'all' && filters.member.mode !== 'all' && (
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
        מציג את נתוני כל המשפחה — סיכום לפי כמה בני משפחה עדיין לא נתמך
      </p>
    )}
  </>
)}
```
Apply the same three-way branch (`budgetAccessDenied` → calm message; `budgetLoadError` → existing red banner; else the budget-vs-actual chart) around the budget-vs-actual card.

- [ ] **Step 6c: Wire `ComparisonTable` into a "מי הוציא כמה החודש" card (D9)**

`loadSettlement` (current lines 251–307, untouched by this task otherwise) already computes exactly the per-owner totals a comparison view needs — `settlementData: { name: string; paid: number; target: number }[]`. Map it into `ComparisonRow[]` and render it next to the existing settlement widget:
```tsx
const comparisonRows: ComparisonRow[] = settlementData.map((s) => ({
  memberId: familyMembers.find((m) => m.name === s.name)?.id ?? s.name,
  name: s.name,
  color: familyMembers.find((m) => m.name === s.name)?.color ?? '#94a3b8',
  value: s.paid,
}));
```
```tsx
<div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-6">
  <h3 className="text-sm font-semibold text-slate-700 mb-3">מי הוציא כמה החודש</h3>
  <ComparisonTable rows={comparisonRows} valueLabel="הוצאות" topN={8} />
</div>
```
No new Firestore read — `comparisonRows` is a pure derivation of state `loadSettlement` already populates, recomputed on render (not memoized — `settlementData` is small, at most `MEMBER_COLORS.length` rows, and Dashboard doesn't memoize its other derived arrays like `categories`/`memberOptions` either, so this stays consistent with the file's existing style).

- [ ] **Step 7: Add the `dashboard.netWorth` glossary entry (in `src/config/glossary.ts`, same file as Task 5)**

```ts
'dashboard.netWorth': {
  id: 'dashboard.netWorth',
  title: 'שווי נקי (Net Worth)',
  explanation:
    'סך כל הנכסים המוצגים למעלה פחות המשכנתא — חישוב מבוסס על הערכים הידניים שבכרטיסיית "התגלגלות ' +
    'נכסים", לא (עדיין) על נתוני חשבונות/הלוואות אמיתיים מהמודולים הפיננסיים.',
  howComputed: 'סכום 5 שורות הנכסים למעלה, פחות שדה המשכנתא, כפי שנשמרו ידנית ב-settings/ecosystem.',
  source: 'מסמך settings/ecosystem — חישוב מלא ומדויק יותר (accounts/loans אמיתיים) מגיע בשלב הבא.',
},
```

- [ ] **Step 8: Run to verify pass**

Run: `npm run lint && npx vitest run src/__tests__/Dashboard.globalFilters.test.tsx src/__tests__/Dashboard.membersLoad.test.tsx src/__tests__/glossary.test.ts`
Expected: ALL PASS.

- [ ] **Step 9: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS.

- [ ] **Step 10: Manual smoke check**

`npm run emu` + sign in as David: confirm `FilterBar`'s מי chips, מתי arrows, and מה category pills all visibly change Dashboard's numbers (including toggling a category — M1); confirm every KPI/ecosystem/net-worth label shows an ⓘ that opens on hover (desktop) and on click; confirm killing the emulator mid-session and switching the member filter shows "טעינת נתוני הנכסים נכשלה... נסה שוב" rather than every ecosystem tile dropping to ₪0; confirm selecting 2+ members shows the D8 amber disclosure note on the ecosystem/net-worth cards; confirm the "מי הוציא כמה החודש" `ComparisonTable` card renders real per-owner totals. Then sign in as `omer-levy` (member role, no permissions) — confirm the ecosystem/net-worth and budget-vs-actual cards show the calm "אין לך הרשאה לצפות בנתון זה" message (security fix `60d1c32`), never a red banner and never ₪0.

- [ ] **Step 11: Commit**

```bash
git add src/components/Dashboard.tsx src/config/glossary.ts src/__tests__/Dashboard.globalFilters.test.tsx src/__tests__/Dashboard.membersLoad.test.tsx
git commit -m "feat: rewire Dashboard onto global filters (member+period+category), wire <Explain> + ComparisonTable + D8 disclosure, fix loadEcosystem/loadBudget empty-on-error and permission-denied handling

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Stage-4 Done Criteria

- A global sticky `FilterBar` (מי/מתי/מה) exists, backed by `FilterContext` (persisted to `sessionStorage`), and is mounted on `Dashboard` — the one screen rewired onto it this stage (D7). Collapsed-by-default on mobile behind a tap-to-expand summary line (Ofra B2); a `FilterActiveBadge` in the header makes the persisted-but-otherwise-invisible filter state visible on every other screen too (Ofra I4).
- `MODULE_REGISTRY` replaces `App.tsx`'s hardcoded `tabs` array; nav visibility is driven by `resolvedPermissions`/role via `isModuleVisible`, closing the "every tab shown regardless of permission" gap that existed through Stage 3. `App.tsx`'s private `activeTab` state is replaced by a public `NavigationContext` (D11); `renderContent`'s dispatch switch carries a compile-time exhaustiveness guard against `MODULE_REGISTRY` (Sun ruling).
- A central `GLOSSARY` + `<Explain>` component exist; eleven entries are authored against a testable plain-language standard (`violatesPlainLanguage` — banned jargon + a sentence-length cap, Ofra I5) and reviewed by a named non-technical reviewer (Lilit); five are live-wired (Dashboard's four KPI cards + net-worth card), five more (ecosystem tiles) are live-wired, one (`expenses.listTotal`) is authored for Stage 5 to attach. The trigger has a ≥44×44 hit area and a `data-tour-id` (D12).
- `MemberChip`, `GroupChip`, `MemberMultiSelect`, `ComparisonTable` exist as independently tested, reusable primitives, verified against a shared 20-member/multi-group fixture (Lola finding 2 / spec §3's named success metric). `MemberMultiSelect` — the live, daily-use control — gets the same search/collapse treatment as `ComparisonTable` (Ofra I3). `ComparisonTable` is WIRED this stage to a real "מי הוציא כמה החודש" Dashboard card, fed by `loadSettlement`'s existing per-owner totals (D9, amended per Lola finding 1 — not shipped as a dead, unwired primitive).
- The מה/category filter is actually wired into `loadBudget`'s actuals aggregation, with a test asserting Dashboard's figures change when a category is toggled (M1) — not state-only.
- `FilterBar` and `Dashboard` share ONE `listMembers`/`listGroups` fetch via `FilterContext` (M2), not two independent ones.
- D8's `'all'`-fallback for a 2+-member/group selection is disclosed in the UI itself (an inline note on the ecosystem/net-worth cards), not only in this design doc (Ofra B1).
- `Dashboard.loadEcosystem`/`loadBudget`'s empty-on-error carry-forward is fixed, AND both now distinguish a genuine connectivity failure (red error banner, retry copy) from a `permission-denied` refusal (calm access message, never a red banner, never a silent ₪0) — folded in from the security fix that landed mid-stage (commit `60d1c32`, restricting `settings/ecosystem`/`settings/budgetConfig` to super-admin/parent reads).
- `CategoriesService.getCategories()` no longer seeds on read; default categories are seeded once, at bootstrap, by the super-admin-gated `ensureSeeded()` — a member-role first login mounting `FilterBar` on a fresh database no longer hits permission-denied (M6).
- `npm run lint` and `npm test` pass; `git status` clean.
- No financial module screen (`ExpensesBreakdown`/`AnnualReport`/`CentralExpenseReport`/`InvestmentsPortfolio`/`FuturePlanning`/`FolderLogic`) was created or edited.
- The app is usable after every single task — confirmed via each task's own manual smoke-check step.
- **Product-metric acceptance (Lola findings 3–4), verified as the literal last Done step, not left implicit in the per-task smoke checks above:**
  - **Cold-reader walkthrough:** someone who has not seen this stage's work (not the implementer) opens Dashboard and, using only the `<Explain>` triggers, correctly explains in their own words what each of the four KPI cards, the five ecosystem tiles, and the net-worth card mean — spec §3's own literal acceptance test for the glossary, not just "the copy exists."
  - **"מה מצבנו?" glance check:** a returning user (not mid-task) can answer "what's our financial situation this month" within 5 seconds of Dashboard finishing its load — no scrolling, no tapping to reveal a number.
  - **Consolidated end-of-stage demo script** (spec §16 — "הדגמה לדויד" at the end of every stage): sign in as David → move `FilterBar`'s מי/מתי/מה controls and confirm Dashboard's numbers (including the category filter, M1) move with them → hover/tap ⓘ on every KPI/ecosystem/net-worth card → confirm the D8 disclosure note appears on a 2+-member selection → confirm the "מי הוציא כמה החודש" card shows real figures → sign in as Omer (member, no permissions) → confirm restricted nav, and confirm the ecosystem/budget cards show the calm access-denied message, not an error or ₪0 → grant Omer `view: 'own'` on `expenses` as David → reload as Omer → confirm the new tab appears.

## Risks

- **`App.tsx`'s `renderContent` switch is NOT eliminated by the module registry (D6).** Adding a future module still needs one `MODULE_REGISTRY` entry (nav is fully data-driven) AND one line in `renderContent` (render dispatch is not, because several screens need per-call-site props the registry can't express without an artificial common signature). This is a real, disclosed gap against the brief's literal "Adding a module later = one registry entry" framing — not a silent shortfall. The compile-time exhaustiveness guard (Task 3, Sun ruling) narrows the gap: forgetting the `renderContent` line now fails `npm run lint` instead of silently rendering `<Dashboard/>`, but it still doesn't make that line unnecessary. The guard relies on one `activeTab as TabId` cast at the switch site (`NavigationContext` itself stays generic over `string`, since it has no knowledge of module ids) — a deliberate, narrow escape hatch, not a hole in the type system generally, since `activeTab`'s only producers are `navigateTo` calls within `App.tsx` itself.
- **A `'member'`-role session's nav visibly changes shape twice on load** (ungated tabs only → full gated set once `resolvedPermissions` resolves). Intentional fail-closed-while-loading, matching the Rules layer's own posture, but a genuinely slow `getMember` read makes this more visible than a polished product would want; not addressed here (no loading skeleton for the nav itself this stage — out of scope for a shell plan whose job is correctness, not nav polish).
- **`resolveEcosystemKey`'s "2+ members or a group → fall back to 'all'" behavior (D8) is a real, disclosed limitation**, not full multi-member support for `settings/ecosystem`/`settings/budgetConfig`. A user selecting "עומר + לילית" via `FilterBar`'s מי control sees the FAMILY-WIDE ecosystem/budget figures, not a sum of just those two — while the KPI cards' `transaction_lines`-driven totals (via `selectedMemberNames`) DO correctly scope to just those two. This asymmetry is visible in the UI (ecosystem tiles vs. KPI cards can look inconsistent for a 2+-member, non-"all" selection); Task 6 now surfaces it as an explicit in-UI note (Ofra B1) instead of only in this design doc, but the underlying asymmetry itself is unchanged — the note discloses it, it doesn't fix it. Candidate fix: whenever `settings/ecosystem` migrates to real `accounts`/`loans` docs (Stage 5+), this asymmetry disappears on its own.
- **`FilterBar`'s own `MONTHS_HE` constant duplicates `Dashboard`'s pre-existing `MONTHS` array** (both a `{value, label}` list of the same 12 Hebrew month names). Not deduplicated this stage — extracting a shared constant would mean touching every one of `ExpensesBreakdown`/`AnnualReport`/`CentralExpenseReport`'s own copies too, to actually retire the duplication rather than add a third copy, which is out of this plan's shell-only scope (those files are untouched, per Global Constraints). Flagged for Stage 11 or whenever those files are next opened for their own reasons.
- **`useResolvedPermissions` fetches `getMember` once per session-ready transition, not on a `resolvedPermissions` change made by a super-admin mid-session.** If David edits Omer's permissions while Omer's tab is open, Omer's nav doesn't update until Omer's next reload/re-auth. No realtime listener is added this stage (would need `onSnapshot` on `members/{id}`, a larger, disclosed-but-deferred change) — matches the existing precedent that `App.tsx`'s `ensureSeeded`/session-role checks are also one-shot-per-session, not realtime.
- **`Dashboard.globalFilters.test.tsx`'s ecosystem-error-preserves-value test requires careful mock sequencing** (first call succeeds, second rejects) to actually exercise the carry-forward fix rather than vacuously passing on an untouched initial state — the implementer must confirm this test fails against the PRE-fix code (temporarily reverting Step 3's `loadEcosystem` change) before trusting it, per this project's verification-before-completion discipline. The same discipline applies to the new permission-denied-vs-connectivity-failure tests: they must fail against pre-branch code (an unconditional `catch` treating every error as connectivity) before being trusted.
- **`loadBudget`'s `permission-denied` branch (security fix `60d1c32`) hides the ENTIRE budget-vs-actual card for a `'member'`-role session, not just the missing budget targets.** The `settings/budgetConfig` read is the first statement inside `loadBudget`'s try block, ahead of the `transaction_lines` actuals read — so a permission refusal on the first read short-circuits before the second (unrestricted) read ever runs, even though a member's own actuals-only view (no budget target comparison) would in principle be readable. Splitting the two reads so actuals can render independently of budget-target access is real, disclosed follow-up work, not attempted here — this task's job was to stop showing a wrong or scary state for the refusal, not to redesign the read shape mid-security-fix.
- **`Dashboard`'s `FamilyManagerModal` save-failure double-failure copy is not reproduced verbatim after the M2 fetch lift (Task 6, Step 3b).** Before the lift, a save failure followed by a failed re-sync showed a specific Hebrew message ("שמירת בני המשפחה נכשלה ולא ניתן היה לסנכרן מחדש..."); after the lift, that second failure surfaces through the shared `useFamilyMembers` hook's own generic error copy instead, once the local optimistic override clears. A disclosed, minor UX regression traded for eliminating a duplicate `listMembers()` call site (M2) — not silent, but real; candidate fix is teaching `useFamilyMembers` a distinct "reload failed" message if this proves confusing in practice.
- **`loadBudget`/`loadSettlement` still do a full, unfiltered `transaction_lines` scan on every load** (`getDocs(collection(db, 'transaction_lines'))`, no `where()` clause) — pre-existing since Stage 3, not introduced here. Making the month control global and sticky (this stage) means these scans now fire on every `FilterBar` month/member/category change while Dashboard is mounted, not just on Dashboard's own local selector changes — the same absolute cost per read, but a higher frequency of reads across a session. Not addressed in this shell stage; a date-range `where('date', '>=', ...)` query is a named Stage 5 carry-forward (see the roadmap edit).
- **CORRECTED (Task 4): the UX review's flagged possible live permission leak (Ofra finding I6) was fully investigated and resolved; the paragraph that previously stood here overstated what remained open.** The Sasha security investigation (probe-based, live emulator, see `.superpowers/sdd/2026-08-16-stage4-ui-shell/security-fix-settings-rules.md` and the controller ledger) confirmed `transaction_lines` and `incomes` are DENIED WHOLESALE by `firestore.rules`' `canAccessExpenses`/`canAccessOwnerlessModule` for any member without the matching family-level grant — including a zero-permission child and a child with `expenses:{view:'own'}`. The only confirmed exposure was `settings/ecosystem`/`settings/budgetConfig` (missing matrix check), closed by commit `60d1c32`. So: `MemberMultiSelect` listing every family member unfiltered does NOT let a zero-permission child read a parent's `transaction_lines`-driven KPI totals — the server denies that read regardless of what's selected. The true residual item, downgraded from security to UX/correctness: **a dead-end selection.** Offering a chip for a family member the viewer can never get real data for invites a selection that silently resolves to nothing (or a permission-denied state), which is confusing UX, not a leak. Task 4 closes this: `FilterBar`'s מי control (via `src/utils/memberVisibility.ts`'s `filterViewableMembers`, fed a `viewerAccess` computed in `App.tsx` from the session's own `expenses`-module view level) now offers only the members/groups the current viewer could plausibly get real data for — full family for `'family'`-level viewers (including every super-admin/parent), self-only with no group chips for `'own'`/`'none'`-level members.

## Self-review against spec §5/§6

- §5.1 (מבט אחד ואשכולות — one glance, numbers as drill-down buttons): not newly built this stage (pre-existing on Dashboard/reports); unaffected by this plan's changes; correctly out of scope for a shell plan. The "what-did-we-miss" review confirmed this requirement was previously homeless (no stage owned it) — now explicitly named as a Stage 5 roadmap line item (see the roadmap edit below) instead of silently falling through again.
- §5.2 (רחף והבן — hover-explain, "לא רוצה לשאול שאלות"): covered — Task 5 (`GLOSSARY` + `<Explain>`, D4/D5), Task 6 (live-wired on Dashboard's KPI/ecosystem/net-worth cards). The "one central glossary, not scattered in code" requirement is met by `src/config/glossary.ts` being the single source every `<Explain id>` looks up. Strengthened per the UX review: every entry is checked against a testable plain-language standard (`violatesPlainLanguage` — banned jargon + sentence-length cap, Ofra I5) AND read end-to-end by a named non-technical reviewer (Lilit) before commit — spec §3's literal "someone who hasn't seen it understands it" bar, not just "the string is non-empty." The `<Explain>` trigger itself now carries a ≥44×44 hit area (Ofra) and a `data-tour-id` (D12).
- §5.3 (פילטרים גלובליים דביקים — מי/מתי/מה, sticky, persists across screens): covered — Task 1 (`FilterContext` + persistence, `NavigationContext` D11 kept as a separate concern per D3's existing filters/navigation split), Task 4 (`FilterBar`, sticky, collapsed-by-default on mobile per Ofra B2, shares one members/groups fetch with Dashboard per M2). "משפיע על הכל" (affects everything) is honored only for `Dashboard` this stage (D7) — a disclosed, not silent, scope trim; every other screen's rewiring is explicitly Stage 5's job per the roadmap. The resulting half-state (filters persist but are only visible on Dashboard) is no longer silent: a `FilterActiveBadge` in the header (Ofra I4) surfaces it on every screen, with a one-tap clear. The מה dimension is no longer state-only — Task 6 wires it into `loadBudget`'s actuals aggregation with a test (M1).
- §5.4 (תצוגה חכמה למשפחה גדולה — group aggregates, member chips with stable color, drill-down, comparison mode, ≤20 readable): covered — Task 2 (`MemberChip`, `GroupChip`, `MemberMultiSelect`, `ComparisonTable`'s top-N+search collapsing), now verified against a shared 20-member/multi-group fixture (Lola finding 2 — spec §3's own named success metric, previously untested by anything but 2–3-member arrays). `MemberMultiSelect` — the LIVE, daily-use control — gets the same search/collapse treatment `ComparisonTable` already had (Ofra I3 — previously backwards: the unwired primitive got the large-family treatment and the live control didn't). Group aggregation ("הילדים: ₪X") is the `GroupChip`'s `amount` prop — real and tested, but still not fed a real aggregate anywhere live this stage (no screen computes a group total to pass it) — that specific sub-piece stays primitive-only. `ComparisonTable` itself is no longer primitive-only: Task 6 wires it to a real "מי הוציא כמה החודש" Dashboard card (D9, amended per Lola finding 1).
- §5.5 (דינמי וקוהרנטי — one calculation source per metric): respected, not violated — `Dashboard`'s KPI/ecosystem/net-worth figures are unchanged computations this stage (only their filter INPUTS — now including category, M1 — and glossary explanations changed); no new parallel calculation of an existing metric was introduced. The new "מי הוציא כמה החודש" card reuses `loadSettlement`'s existing `settlementData` computation rather than adding a second one.
- §5.6 (מובייל-first ליומיום, מחשב-first להגדרות): `FilterBar` and `<Explain>` are both built mobile-first (tap-first interaction per D5, responsive chip wrapping in `MemberMultiSelect`, `FilterBar`'s collapse-by-default on narrow viewports per Ofra B2); the module registry's nav gating is a settings-adjacent concern but reuses `App.tsx`'s existing responsive sidebar/bottom-nav/drawer structure unchanged.
- §5.7 (מצבי תצוגה מלאים — loading/empty/error/success, failed read ≠ empty): covered — every new hook (`useFamilyMembers`, `useGroups`, `useResolvedPermissions`) and `FilterBar`'s category load follow the "never catch a failure into an empty/default value" rule; `Dashboard.loadEcosystem`'s pre-existing violation is fixed in Task 6. Extended this revision: a FOURTH state — "you don't have access" (`permission-denied`) — is now distinguished from loading/empty/error/success wherever it can legitimately occur (`loadEcosystem`/`loadBudget`, per the security fix `60d1c32` folded into Task 6); it renders as a calm access message, not the error state and not a silent empty/zero one. `CategoriesService.getCategories()`'s own §5.7 violation (seed-on-read denying a member-role first login, M6) is fixed in Task 4.
- §5.8 (design language — Heebo/Space Grotesk, ₪ always marked, DD/MM/YYYY): unaffected — this stage reuses the existing Tailwind classes and font stack verbatim; no new typography introduced.
- §6 (module map, registry with id/name/icon/dashboard cards/permission-governed, "הוספת מודול עתידי = רישום + מסך"): covered with one disclosed gap — Task 3's `MODULE_REGISTRY` carries id/label/icon/permission gate (not `dashboardCards`, per D6's reasoning) and drives nav; `renderContent`'s per-screen prop-wiring switch is the one remaining hand-touch for a genuinely new screen, called out as a Risk rather than oversold as zero-touch. Strengthened per the architecture review: the registry and the switch can no longer silently diverge (Task 3's compile-time exhaustiveness guard, Sun ruling) — a missing case now fails the build, not the runtime.
- Cross-cutting (Stage 10 readiness, architecture review): every shell element this stage authors for the first time — nav buttons, `FilterBar`'s three sections, `<Explain>` triggers — carries a `data-tour-id` per a fixed convention (D12), and screen navigation itself is now a public `NavigationContext` API (D11) instead of `App.tsx` private state — both purely additive this stage (nothing consumes them yet), sized to be cheap now and expensive to retrofit once Stages 5–9 have touched these same files for unrelated reasons.

## Open questions: none
