# FamilyFinance v2 — Stage 7: Forecast Engine — Implementation Plan **v2**

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax.

**Baseline:** branch `familyfinance-v2`, HEAD `49f6d28`, `test:all` = 1901 at the time of writing (re-run, never quoted). Stage 6 ledger: `.superpowers/sdd/2026-08-17-stage6-ai-provider-layer/progress.md`.

**Status of v1.** `2026-08-18-stage7-forecast.md` went through the four-lens adversarial gate (Ofra/UX, Sun/architecture, Lola/product, what-did-we-miss) and was **rejected — rewrite, not patch**. The controller adjudication `2026-08-18-stage7-adjudication.md` issued **41 binding rulings, A1–A41**. v1 stays in place as the record. This document is the plan.

**Every ruling A1–A41 is honoured here, and §0 says where.** Where a ruling replaces a v1 decision, the replacement is numbered and the replacement is stated. Where a ruling adds something v1 lacked, it gets a decision **and** a task, not a mention.

**Goal:** answer spec §10 — *"מה צפוי לקרות בתקופה שבחרתי, ומה צריך לקרות כדי לעמוד ביעדים?"* — with three composed layers, per-number provenance on hover, honest uncertainty, and a cold start that is a path rather than an apology.

**The one sentence that governs this stage** (carried from v1, unchanged, and it survived the gate): *this is the first thing in the app that states something about the future, and a forecast that looks authoritative and is wrong is worse than no forecast.*

**The second sentence, added by the gate:** *for every guard and every displayed figure, name what makes it able to fail and where its data comes from.* v1 promised `unusableRowCount` from a query that filters those rows out, and an allow-list-is-4 assertion that could not move. §12 and §13 are that discipline written down.

---

## 0. Disposition of A1–A41 — the index

| Ruling | Landed as | Task |
|---|---|---|
| A1 `projectedBalance` has no source | **D16** (new) | T1, T7a |
| A2 suppression by presence, not scope | **D17** replaces D5 | T7a |
| A3 empty corpus / onboarding path / demo generator | **D26** amends D14, **D27** (new) | T4, T5, T7b |
| A4 one `in` clause only | **D21** replaces D6's query shape | T3 |
| A5 `period: 'unknown'` | **D21** | T0, T3 |
| A6 stamp `ownerId` in the same pass | **D21** | T3 |
| A7 `period`/`ownerId` immutable + completion marker | **D21** | T2, T3 |
| A8 third/fourth writer, tautological assertion | **D21**, §12 | T3 |
| A9 `computeDuePeriods` cannot project forward | **D22** (new) | T1 |
| A10 recurring income posts into `incomes` | **D23** amends D11 | T1, T3 |
| A11 `isExpenseRow` / credits | **D23** | T5 |
| A12 no tiebreak inside the assumption layer | **D20** amends D2 | T1 |
| A13 `overrides` stack, `layer` derived not stored | **D19** replaces D2's shape | T1 |
| A14 per-input hook contract | **D18** (new) | T7a |
| A15 ModuleId doing two jobs; assumption authorship | **D25** replaces D4 | T2 |
| A16 Stage 8 seam enforced in Rules | **D25** | T2, T8 |
| A17 delete `settings/seasonality` | **D24** replaces D7 | T6 |
| A18 past anchor | **D32** amends D12 | T1, T7b |
| A19 the card carries five things | **D38** (new) | T7a |
| A20 uncertainty does not grow with distance | **D41** (new), amends D3 | T5, T7b |
| A21 the gap rendering | **D40** (new) | T7b |
| A22 hatch is the wrong carrier | **D39** (new) | T7b |
| A23 time-axis RTL | **D42** (new) | T7b |
| A24 `תזרים` is already on screen | **D30** replaces D13 | T7b |
| A25 glossary floor 17, real ~23 | §11 | T7b, T8 |
| A26 second person in Hebrew | **D34** (new) | every task |
| A27 cut `forecasts` | **D28** replaces D9 | — (cut) |
| A28 rank and lead by name | **D29** amends D8 | T6 |
| A29 calibration | **D28**, §11 | T6, T8 |
| A30 `personalTarget`, the `'own'` question | **D25**, **D29** | T2, T6, T7a |
| A31 seasonality is first-class, decided here | **D24** | T6 |
| A32 drill-down; comparison deferred by name | **D36** (new) | T7b |
| A33 advice-boundary notice | **D29** | T6, T7b |
| A34 nothing recomputes | **D35** (new) | T7a |
| A35 timezone | **D32** | T1 |
| A36 offline | **R11** | risk |
| A37 performance | **D33** (new) | T3, T7a, T8 |
| A38 mirrorability not satisfiable as stated | **D37** amends D1 | T1 |
| A39 four guards born shadowed | §12 | T7c |
| A40 Dashboard incoherence; two v1 closures wrong | **D31**, §14 | T3, T7b |
| A41 icon, MODULE_LABELS, no `incomes` tab | **D25**, **D31**, §13 deferral table | T2 |

**Two rulings I am implementing differently, with the argument stated, and one I think is wrong** — see **§15, Disagreements with the adjudication**. A plan that silently implements a bad ruling is worse than one that argues.

---

## 1. Verify-don't-assume — re-read against the tree at HEAD `49f6d28`

v1 asserted four things about the tree that were false. Every claim below was re-verified by reading the file at HEAD; the file:line is the evidence, not a memory.

### 1.1 v1's false claims, corrected

| v1 said | Truth at `49f6d28` |
|---|---|
| `.gitignore` still has a trailing slash; align `functions/.gitignore` (v1 finding, T1, inheritance item 2) | **Both files already read `node_modules` with no slash**, each carrying a comment explaining the worktree-symlink hazard. Already closed. **Dropped** (A40). |
| "Reuse `computeDuePeriods`" for the certain layer (v1 T2) | `recurringCatchup.ts:112` caps `rangeEnd` at `currentPeriod`; for any future month it returns `[]`. **It cannot project forward.** (A9 → D22.) |
| Renaming the `'future'` tab is "a one-line `MODULE_REGISTRY` label change" (v1 D15) | **Three headings and a name collision** — see 1.2 finding 1. |
| `'תזרים'` is "never surfaced" (v1 D13) | `Dashboard.tsx:648` renders it in an `<h2>` today. (A24 → D30.) |

### 1.2 New findings — things neither v1 nor the adjudication records

1. **`FuturePlanning.tsx` already contains a panel headed `תחזיות AI לעתיד`** (`:264-278`) whose entire content is two hardcoded static tips and no computation of any kind. v1 called this screen "a savings-goals CRUD screen"; it is a goals CRUD screen **with a false forecast promise stapled to it**, on an ungated tab, about the exact capability Stage 7 ships. It is the strongest argument for D31 and neither document mentions it.
   The rename is also not one line: `moduleRegistry.ts:44` (label `תכנון עתידי`), `FuturePlanning.tsx:150` (`<h1>תכנון עתידי והשקעות</h1>`), `:187` (`<h2>יעדי חיסכון</h2>` — **the exact label v1 proposed for the tab already exists as a sub-heading inside it**), `:249` (`<h2>קרן חירום</h2>` — a third section the proposed label would misdescribe).

2. **`unusableRowCount` is shadowed on the real corpus, and A5 does not say so.** All three `transaction_lines` documents are `migrated-legacy-A/B/C` with ISO `YYYY-MM-DD` dates (`2026-03-15/20/22`) — **every one parses**. And `firestore.rules:207` requires `request.resource.data.date.size() == 10` on create, so no client can ever write the unpadded `"9/3/2026"` v1's finding 1 cites; unparseable dates can arrive only via the Admin-SDK migration or pre-Stage-1 data. `period: 'unknown'` will therefore have **zero live instances**, and its display, its glossary entry and its guard are shadowed by construction unless the demo generator (D27) deliberately emits them. It must, and T4 asserts it.

3. **A5 + A7 together still cannot see a half-done backfill from the read path.** A row that was never touched has **no `period` field at all**, so a `where('period','in',[…7 values])` query does not return it and `period: 'unknown'` never counts it. The completion marker is the *only* instrument that can see this. D21 therefore makes it a **hard refusal**, not a caveat.

4. **`incomes` is worse than "a third date convention".** `Dashboard.tsx:437-455` stamps `month`/`year` **from the UI's currently selected filter**, not from `date`; `date` itself is a free-text input whose placeholder is `DD/MM/YYYY` (`:1220-1224`). `RecurringService.ts:230-238` writes ISO `date` plus `month`/`year` split from the period. `CentralExpenseReport.tsx:80` queries `where('month','==',…)` `where('year','==',…)`. So a `periodOf(incomes.date)` backfill (A10) would produce a `period` that **disagrees with the `month`/`year` an existing screen already queries on**, for any row where the typist's date and the selected filter differ. A10's ruling would silently create that inconsistency. D23 handles it.

5. **`ModuleId` is duplicated into `functions/src/shared/permissions.ts:17` and no test holds the two unions in sync.** `aiPermissionsContract.test.ts` pins `resolveOwnedModuleScope`'s (role, level) behaviour and a `Member.role` regression guard — nothing else. A41 is right that `MODULE_LABELS` (`PermissionsManager.tsx:45`, a total `Record<ModuleId,string>`) fails the build loudly; the **functions-side mirror fails silently**. D25 closes it.

6. **`recurringCatchup.ts`'s reusable primitives are module-private.** `periodsBetween`, `nextPeriod`, `comparePeriod`, `periodOfDateString`, `periodOfDate` are all unexported; only `clampDayToMonth` is exported. A9's "extract the pure primitives" means moving five functions into a new shared module and re-pointing `recurringCatchup.ts` at it — not adding an `export` keyword. T1 owns that, and `recurringCatchup.test.ts` must stay green across the move.

7. **`FileProcessor.ts:561-562` writes `installmentNumber: item.installmentNumber ?? null`** — `null`, not absent. D10's "`totalInstallments` present, `installmentNumber` absent" case is a **`null`**, and a `!== undefined` check misreads it as present.

8. **`createOwnedCollectionRepo.list` returns `d.data()` without `d.id`** (`financeCollections.ts:135`), but `save` stamps `merged.id = id` (`:186`). So D20's `then id` tiebreak is implementable for anything written through the repo, and **silently degenerates for anything written another way**. T2 asserts the repo is the only writer.

### 1.3 Load-bearing facts confirmed (unchanged from v1, re-verified)

1. `transaction_lines.date` holds two formats; `transactionFilters.ts:31-77`'s `parseTransactionDate` exists for exactly that. `migrateLegacyTransaction.ts` spreads the legacy doc and never touches `date`. **No date-range query is possible today.**
2. `Dashboard.tsx:288` and `:365` both issue `getDocs(collection(db,'transaction_lines'))` — an unconstrained scan that `firestore.rules:26-30`'s `expensesAllowed` denies wholesale for an `'own'`-level viewer.
3. `transaction_lines.owner` is a display **name** (`firestore.rules:26-30`); every Stage 3 collection uses `ownerId` (`:40-42`). `RecurringService.ts:214-217` resolves `nameByMemberId` and throws when it cannot.
4. `incomes` / `goals` / `investments` are **ownerless** (`permissions.ts:21`, `firestore.rules:32-34`) — `'own'` grants nothing.
5. `settings/budgetConfig` and `settings/ecosystem` are **parent/super-admin read only** (`firestore.rules:296-298`), and the whole `settings/{docId}` block is **parent/super-admin write only** with a validator for `aiCostConfig` alone (`:312-317`).
6. `goals.date` is a Hebrew month-name string built from a 12-element array at `FuturePlanning.tsx:24-27`, written at `:113`.
7. `RecurringService.ts:213-238` branches on `kind`: expense → `transaction_lines` with `recurringId` + `recurringPeriod`; **income → `incomes` with the same two fields.** Loans and insurances have no such discriminator.
8. `transaction_lines` carries `installmentNumber` / `totalInstallments` (`FileProcessor.ts:561-562`). **Whether `amount` is the per-instalment charge is asserted against a real fixture in T1 — not assumed.**
9. **No `firestore.indexes.json` exists**; `firebase.json` declares no `firestore.indexes` key (`firebase.json:2-3`).
10. No `forecast_assumptions` match block exists; Firestore default-denies with no catch-all.
11. No `'forecast'` `ModuleId` (`permissions.ts:9-16`), no registry entry, and **no `incomes` tab at all** in `MODULE_REGISTRY` (`moduleRegistry.ts:37-76`).
12. `vitest.config.ts:32` aliases `'@'` to the repo root while `vite.config.ts`/`tsconfig.json` point at `src/`. **Zero non-test files import `@/…`** — deprioritised per A40, not closed here.
13. `accounts` is an **owned** module (`permissions.ts:9-16`, `firestore.rules:244-251`); `Account` carries `balance` and `balanceUpdatedAt` (`types/finance.ts:15-21`). `netWorth.ts`'s own header names `accounts` as a "§10 forecast layer-1 input".
14. `useScopedRead` exposes one scalar `status` and is typed `<T extends OwnedRecord>` (`useScopedRead.ts:35-48`); `transaction_lines` rows are not `OwnedRecord`. `useNetWorth` already needed a side-channel (`investmentsReadable`, `isIncomplete` from raw counts) for **one** ownerless input.
15. `transactionWriteGuard.test.ts:115` scopes its scan to `SRC_ROOT = join(cwd,'src')`, and its allow-list is **exactly the 4 files that already contain both `transaction_lines` write paths** (`:97-113`). `scripts/migrate-transactions.ts` is invisible to it; `BATCH_SIZE = 400` there (`:38`).
16. `glossary.ts` holds **exactly 25 entries** at HEAD. `Explain.tsx:47-53` renders **nothing** for an unknown id — so hover copy that has no glossary entry does not exist.
17. The recharts precedent wraps chart containers in `dir="ltr"` (`Dashboard.tsx:1105`, `:1150`; `InvestmentsPortfolio.tsx:215`). No time-series chart exists anywhere in the app.
18. `formatILS` lives in `src/config/aiCeiling.ts:40`, imported by `aiOverage.ts` and `AiSettingsScreen.tsx`.
19. `functions/src/shared/permissions.ts:11-14` **forbids moving a second piece of logic across the boundary** and instructs an esbuild/tsup predeploy step instead.
20. `functions/src/context/buildFinancialContext.ts:56-58` does `Number(d.amount ?? 0)` — a corrupt `recurring.amount` produces `NaN`, which `JSON.stringify` sends to the model as `null`.
21. `firestore-tests/*.ts` hardcode port `8080`; `scripts/dev-emulators.ts:78-79` hardcodes `--project demo-familyfinance --import=./.emulator-data` — **David's own data**.
22. **The corpus, counted from `.emulator-data` at HEAD:** `transaction_lines` 3 (all March 2026, all ISO), legacy `transactions` 3, `members` 3, `permissions` 1, `settings/budgetConfig` 1 (a `members` array, **no per-category budgets**), `audit_log` 2, one chat session. **`recurring` 0, `loans` 0, `insurances` 0, `incomes` 0, `goals` 0, `accounts` 0, `documents` 0, `groups` 0.** `seed-members.ts` seeds three members and no financial data; `src/__tests__/fixtures/largeFamily.ts` is 20 members and no money. **No demo-data generator exists.**

---

## 2. The three decisions that must exist before anything else

### D16 — `projectedBalance`: what it is, where it comes from, and why its least certain input is not allowed to hide. *(A1 — new; v1 asserted the headline number six times and never defined it.)*

```
projectedBalance(p) = openingBalance
                    + Σ_{m ≤ p} projectedIncome(m)
                    − Σ_{m ≤ p} projectedExpense(m)
```

`openingBalance = Σ readable accounts.balance`. `accounts` is an owned module, so an `'own'` viewer **can** read their own accounts — v1's D5 table was wrong in that direction too.

**The opening balance is the least certain input in the whole computation and must not sit inside a solid "certain" figure.** It carries its own provenance:

```ts
export interface OpeningBalance {
  amountILS: number;
  asOf: string;                 // max(accounts.balanceUpdatedAt) — netWorth.ts's latestOf precedent
  accountsCounted: number;
  staleness: 'current' | 'stale' | 'very-stale';   // ≤31d / 32–92d / >92d, from named constants
}
```

`staleness` is a state parallel to D3's `bandBasis`, rendered, and carrying its own glossary entry. A balance last touched in March, projected three months forward, is wrong by the whole intervening period, and the screen says the date in words: *"היתרה עודכנה לאחרונה ב-15/03/2026 — לפני 5 חודשים."*

**If `accounts` is empty or unreadable, `projectedBalance` is `null`** — the same rule as D17, of which this is one case.

**A "net flow" figure labelled `יתרה צפויה` is forbidden.** If a balance cannot be computed we say so; we do not relabel a delta. A guard asserts the string `יתרה צפויה` never renders when `projectedBalance === null` (§12 names what makes it able to fail).

### D17 — Suppression is driven by **input presence**, not by scope. **Replaces v1's D5.** *(A2)*

v1's D5 suppressed the balance when income was unreadable *by permission*. The corpus has **`incomes: 0`** — income is zero *by absence*, for everyone, in family scope, on the Dashboard, at `text-4xl`. The permission case is a special case of a more general rule, and v1 shipped only the special case.

**Rule.** Every balance-contributing input is graded `'ok' | 'denied' | 'empty' | 'error'`. **If any is not `'ok'`, `projectedBalance` is `null` and a named gap renders in its place.** Enforced in the hook (D18), never in a component — a component-level guard is a rule a second component can skip. Mutation-tested: removing the rule must fail a test that names the false balance.

v1's D5 table stays, corrected and re-scoped:

| Balance-contributing input | `'family'` | `'own'` | Note |
|---|---|---|---|
| `accounts` | ✅ owned | ✅ owned | **v1 had this wrong.** Feeds `openingBalance`. |
| `recurring` | ✅ | ✅ | owned; both `kind`s |
| `loans`, `insurances` | ✅ | ✅ | owned |
| `transaction_lines` | ✅ | ✅ after T3 | `where('ownerId','==',me)` |
| `incomes` | ✅ | ❌ structurally | ownerless — `'own'` grants nothing |
| `goals` | ✅ | ❌ structurally | ownerless (see D29 for what replaces it) |
| `settings/budgetConfig` | parent only | ❌ | not balance-contributing; a *target* source (D29) |

**Copy is a data statement, never a rebuke** (A26/Ofra M3). Not *"אין לך הרשאה"* — that reads as a rebuke to a child. Instead the gap names the missing inputs and, per D26, **deep-links to their create forms**:

> **לא ניתן להציג יתרה צפויה** — חסרים שני נתונים: יתרות חשבון והכנסות משפחתיות.
> [הוספת חשבון] · [ההכנסות מנוהלות ברמת המשפחה]

**Rejected — render with income treated as 0:** a plunging negative balance that looks authoritative and is false; the exact failure class this stage exists to avoid. **Rejected — compute family balance server-side and return the aggregate:** leaks a family-level fact to a member who may not see it; Stage 6's B1 closed this class. **Rejected — hide the screen:** §4 scenario 6 wants a child to see *their* picture, and §5.7 says a refusal is a calm explanatory state, never an absence.

### D18 — `useForecast` returns a **per-input** scope/status record. The four-state hook cannot carry ten inputs, and this is the case that breaks it. *(A14 — new)*

```ts
export type InputKey =
  | 'accounts' | 'recurring' | 'loans' | 'insurances'
  | 'incomes' | 'transactionHistory' | 'assumptions' | 'goals' | 'budgetConfig';

export type InputState = 'ok' | 'denied' | 'empty' | 'error';

export interface UseForecastResult {
  inputs: Record<InputKey, { scope: 'own' | 'family' | 'none'; state: InputState; count: number }>;
  result: ForecastResult | null;
  projectedBalance: number | null;         // null unless EVERY balance-contributing input is 'ok'
  suppressed: InputKey[];                  // the named gap set — D17's sentence is GENERATED from this
  status: 'loading' | 'ready' | 'error' | 'permission-denied';  // the roll-up, for the shell only
  reload: () => void;                      // D35
}
```

`useScopedRead` is typed `<T extends OwnedRecord>` and `transaction_lines` rows are not `OwnedRecord` — they cannot pass through it at all. `useNetWorth` already needed a side-channel for **one** ownerless input.

**v2 drops v1's claim that this "tests whether the `useScopedRead` shape generalizes."** It does not. The forecast is the case that breaks it, and saying so is the finding. `useScopedRead` is reused where it fits (the four owned collections) and bypassed where it does not (`transaction_lines`, `incomes`, `goals`, `budgetConfig`), each bypass named in a comment with the reason.

**Any failed input suppresses every figure it contributes to, named.** D17's sentence is *generated from `suppressed`*, which is also how v1's unimplemented promise to "name which inputs were unreadable" finally gets delivered.

---

## 3. Data shape and history access

### D19 — Provenance union v2: `overrides` is an **ordered stack**, `layer` is **derived not stored**, and the scopeId→category mapping is stated. **Replaces v1's D2 shape.** *(A13)*

```ts
export type ForecastBasis =
  | { kind: 'recurring';     recurringId: string; description: string; chargeDay: number }
  | { kind: 'loan';          loanId: string; name: string }
  | { kind: 'insurance';     insuranceId: string; provider: string }
  | { kind: 'installment';   planKey: string; observedNumber: number; totalInstallments: number }
  | { kind: 'movingAverage'; monthsObserved: number; periods: string[]; seasonalFactor: SeasonalFactor | null }
  | { kind: 'assumption';    assumptionId: string; source: 'user' | 'insight';
                             overrides: ForecastBasis[] };   // ORDERED STACK, nearest-overridden first

export type ForecastLayer = 'certain' | 'statistical' | 'assumption';
export function layerOf(basis: ForecastBasis): ForecastLayer;   // derived at render — NEVER stored

export interface ForecastLineItem {
  period: string;            // 'YYYY-MM'
  categoryId: string;
  direction: 'income' | 'expense';
  amountILS: number;
  basis: ForecastBasis;      // `layer` is NOT a field
}
```

**Two changes from v1, both from A13.**

**(a) `layer` is not stored.** v1 stored it "and pinned it with a test". A stored `layer` breaks in snapshots and fixtures where the pinning test does not look. `layerOf(basis)` is a total function over the union; the compiler enforces exhaustiveness. Redundancy is only legitimate when a test holds it — and here the redundancy is simply unnecessary.

**(b) `overrides` is a stack, and the case is only reachable if we build the mapping.** Precedence resolves per **(period, categoryId)**, but assumptions are keyed by `scopeKind` + `scopeId`. A category-scoped assumption and a loan-scoped certain item never share a key unless the resolver maps every certain item's `scopeId` to a category. **v2 states the mapping** — without it, D2's most valuable disclosure never fires while its test passes on a hand-built fixture:

| Certain item | `scopeKind` | `scopeId` | Maps to category |
|---|---|---|---|
| `RecurringItem` | `'recurring'` | `item.id` | `item.category ?? CATEGORY_OTHER` (`RecurringService.ts:222`'s own `?? 'שונות'` default) |
| `Loan` | `'loan'` | `loan.id` | named constant `CATEGORY_LOAN_REPAYMENT` |
| `Insurance` | `'insurance'` | `insurance.id` | named constant `CATEGORY_INSURANCE` |
| instalment plan | `'category'` | — | the row's own `category` |

`resolveCategoryOfScope(scopeKind, scopeId, certainItems)` is exported and separately tested; a test asserts that a loan-scoped assumption **and** the loan's own certain item land in the same (period, category) bucket. Insight-over-user-over-certain is three deep, so `overrides` is an array, not a single value.

**The override ruling itself survives v1 verbatim, with its reasoning:** an assumption **may** override a certain item, not only a statistical one. §10.3 says assumptions beat statistics; §9 says a corrected assumption affects the forecast; the canonical §4.4 scenario is correcting a *known* fact. A user who knows rent rises to ₪6,000 in October is the most valuable assumption in the system. It is disclosed differently — overriding a certain item shows both numbers and names what was overridden; overriding a statistical item gets the quieter line.

### D20 — Precedence is a **total order**, and shuffling the input must not change the output. **Amends D2.** *(A12)*

`list('family')` returns every member's assumptions; two can collide on the same (period, categoryId). Without a tiebreak the winner is Firestore's iteration order — **non-deterministic money on the headline number.**

**Total order:** `source: 'user'` beats `'insight'` → then latest `updatedAt` → then `id` ascending.

`resolveLayerPrecedence(items: ForecastLineItem[]): ForecastLineItem[]` takes an **array**, and its canonical test **shuffles the input and asserts the output is identical**. That test outranks the `layer`↔`basis.kind` correspondence v1 called canonical — which D19 has now deleted the need for anyway.

`id` is available because `createOwnedCollectionRepo.save` stamps `merged.id = id` into the document body (`financeCollections.ts:186`). Note the fragility (finding 1.2.8): `list` returns `d.data()` without `d.id`, so an assumption written outside the repo would have **no `id` in the body** and the final tiebreak would silently degenerate. T2 asserts the repo is the only writer.

Written **stub-first with synthetic inputs before the first green run** — the assumptions collection is empty on today's tree, so any predicate over it is shadowed by construction.

### D21 — History access v2: `period` + `ownerId`, `'unknown'` for unparseable, **one `in` clause**, immutability, and a completion marker that **refuses**. **Replaces v1's D6 mechanics; keeps D6's argument.** *(A4, A5, A6, A7, A8)*

**D6's argument survives and is not re-litigated:** add a derived field, do not normalize `date` in place. Destructive normalization touches the field every existing reader depends on; Stage 5 D9 assigned that work elsewhere. **Additive beats destructive on the family's only ledger.** *(Rejected then and now: full scan + client filter — denied for `'own'` viewers and unbounded; a rolled-up `monthly_totals` collection — a second source of truth a late import silently falsifies, Stage 6's F2 verbatim.)*

Five corrections to how it is done.

**(a) `ownerId` in the same pass. (A6)** v1 applied "additive beats destructive" once and then built the entire `'own'` path on `owner`, a **display name** — a rename silently denies the query and orphans that member's history, and D26 would then render that as the reassuring "not enough history yet". Stamp `ownerId` in the same migration. Widen the rule to `data.ownerId == memberId() || data.owner == myMember().name` — **strictly additive, removes no access.** Query on `ownerId`; index `(ownerId, period)`. This retires a convention instead of entrenching it, at near-zero marginal cost.

**(b) Exactly one `in` clause. (A4)** Firestore caps **disjunctions after DNF expansion at 30**, not values per clause. `owner in [N]` × `period in [6]` = 6N, so **N ≥ 6 members is a hard `invalid-argument`** — with this stage's own 20-member acceptance dataset. The history query therefore carries **exactly one `in`** (`period`); the מי filter is applied client-side over returned rows. Pinned by a **structural** test asserting the built query has one disjunctive clause — not by hoping the emulator raises.

**(c) `period: 'unknown'` for unparseable rows. (A5)** v1 promised `unusableRowCount` in D6, R8, T7 and a glossary entry, from a `where('period','in',…)` query that **cannot return rows lacking `period`**. The backfill stamps `'unknown'`; the query sends 7 values (6 periods + `'unknown'`); the hole becomes queryable, self-maintaining, and derived from the same fetch — no second read, no denied scan. **But see finding 1.2.2: this has zero live instances, so T4's generator must emit unparseable rows or the whole mechanism is shadowed.**

**(d) `period` and `ownerId` immutable, and the completion marker **refuses**. (A7)** `allow update` today re-validates `date.size() == 10` and says nothing about `period` — the two can diverge and every reader picks a different one. Rules gain `request.resource.data.period == resource.data.period && request.resource.data.ownerId == resource.data.ownerId` on the matrix-governed branch (the shape the rules already use for `owner`, `firestore.rules:213-220`).
A **half-done backfill** produces a moving average over a fraction of the corpus rendered at full confidence, and `'unknown'` cannot see it: an untouched row has no `period` field at all and the query simply does not return it (finding 1.2.3). So: a durable completion marker (`settings/migrationState.transactionPeriodBackfill`) recording `{ completedAt, rowsStamped, rowsUnknown, sourceCommit }`, and **the statistical layer refuses to compute until it is set.** A refusal, not a caveat — a caveat under a wrong average is the defect, not the fix. Batch at 400 (`migrate-transactions.ts:38`'s own precedent).

**(e) The write-guard truth, stated plainly. (A8)** There is a **third** writer — `scripts/migrate-transactions.ts` uses the Admin SDK from outside `src/`, so `transactionWriteGuard`'s `SRC_ROOT` never scans it — and T3's backfill would be the fourth. And v1's "assert the allow-list is still exactly 4" is **tautological**: both `src/` write paths are already on it, so the count cannot move. Therefore:
- Stamp `period`/`ownerId` inside the pure `migrateLegacyTransaction`, so the one place that already constructs a row does it.
- Add a **`scripts/`-scoped** assertion: any file under `scripts/` writing `transaction_lines` must produce both `period` and `ownerId` in the same object literal. AST-derived, `stripComments`-based (`__tests__/helpers/extractionSurfaces.ts:84` — **do not hand-roll a fourth lexer**; that mistake has been made three times here).
- **Delete the tautological assertion** and record in the guard's own header that it has a `scripts/` blind spot.
- Re-run the **HITL**, **watermark** and **`extraction.commit` audit** suites **by name**, not just the write guard.

### D22 — The certain layer is a **genuinely new forward projector**. `computeDuePeriods` is not reusable and nobody may "reuse" it. *(A9 — new; this is the quietest killer in the review)*

`recurringCatchup.ts:112` sets `rangeEnd` to the current period. A literal reading of v1's "reuse, do not reimplement" ships **a certain layer that is empty in every forecast month** — and the tests pass, because the line items are simply absent.

**Ruling.** Move the pure primitives into `src/utils/periodMath.ts` — `periodOf(dateStr)`, `nextPeriod`, `comparePeriod`, `periodsBetween`, `clampDayToMonth` — and re-point `recurringCatchup.ts` at them (finding 1.2.6: five of these are currently module-private; this is a move, not an `export` keyword). Then write `projectRecurringForward(item, fromPeriod, toPeriod)`, a new function with its own tests.

`clampDayToMonth` **is** reusable and is reused. `computeDuePeriods` **is not**, and `forecast.ts` importing it is a lint-level ban with a named comment.

The forward projector's own semantics, stated so they are not re-derived: an item is projected into period `p` when `status === 'active'`, `p >= periodOf(startDate)`, and `p <= periodOf(endDate)` if `endDate` exists. `lastPostedPeriod` is **irrelevant** to a forward projection — it is a catch-up concept. The charge date within `p` uses `clampDayToMonth`. A test asserts `projectRecurringForward` returns a non-empty list for a future month where `computeDuePeriods` returns `[]` — the direct regression for A9.

Loans: `loans.monthlyPayment` projected while `p <= periodOf(endDate)` and `status === 'active'`. Insurances: `insurances.premium` normalized by `premiumFrequency` — and the Stage 6 ledger's glossary item 18 applies (the same policy already renders as two different numbers on one screen). **v2 picks one and says which: monthly-equivalent for the forecast (`yearly ⇒ premium / 12`), stated in the hover copy, with the annual figure shown alongside.** Instalments per D10.

### D23 — What the statistical layer counts, and the income half. **Amends D11.** *(A10, A11)*

**D11's core survives verbatim and is not re-litigated:** auto-posted recurring rows carry `recurringId` and are **excluded** from the moving average, or the certain layer counts them twice; **loans and insurances have no discriminator**, so their double count is **disclosed, not fixed** — the certain layer renders **itemised by name** ("משכנתא — ₪4,200") so a human can see the duplicate, plus one line: *"אם תשלום כזה מופיע גם בדף הבנק, ייתכן שהוא נספר פעמיים."* Fuzzy matching a bank row to a loan is genuinely Stage 8's duplicate-detection insight (§9's "כפילויות"). The gate upheld this ruling explicitly.

**Two additions.**

**(a) `isExpenseRow` is named, with the reason. (A11)** A moving average over raw rows counts refunds as spend. `transactionFilters.ts:114-118`'s `isExpenseRow` excludes income-category rows **and all credits**; `isExpenseListRow` (`:128-132`) has a documented refund carve-out and is the **wrong** predicate here. The statistical layer uses `isExpenseRow`, named in the code with a comment pointing at the divergence, and **mutation-tested alongside the `recurringId` exclusion**: removing either must fail a test that names what it double-counts.

**(b) The income half — and A10's ruling is amended, because it would create an inconsistency. (A10, finding 1.2.4)** `RecurringService.ts:230-238` writes income rows into `incomes` with `recurringId`, so **the income side has D11's double count too**, with a cheap discriminator. But `incomes.month`/`year` are stamped **from the UI's selected filter, not from `date`** (`Dashboard.tsx:437-455`), and `CentralExpenseReport.tsx:80` already queries on them. A `periodOf(incomes.date)` backfill would produce a `period` disagreeing with a field an existing screen reads.

**Ruling:** T3's backfill extends to `incomes`, stamping `period` **from the existing `month`/`year` pair, not from `date`** — `period = ${year}-${month}` — because that pair is what the collection's only two readers already agree on, and re-deriving from `date` would silently move rows between months on the Dashboard. Rows whose `month`/`year` are missing or malformed get `period: 'unknown'`, same as expenses. The `date`-vs-`month`/`year` divergence is **recorded as a finding and deferred to Stage 11 by name** alongside `transaction_lines.date` normalization; Stage 7 does not fix it and does not pretend to.

The recurring-income exclusion (`recurringId` present ⇒ excluded from the income moving average) is the exact mirror of the expense rule and is mutation-tested the same way.

`incomes` has no service layer, no owner field and no screen of its own (`MODULE_REGISTRY` has no `incomes` tab at all — finding 1.3.11). That is named in the deferral table (§13) so it is not discovered inside a task.

### D24 — Seasonality is an **assumption**, not a settings document. User-authored factors ship **offered and pre-filled**. **Replaces v1's D7.** *(A17, A31)*

`settings/seasonality` falls inside the `settings/{docId}` block, whose **write is super-admin/parent only** (`firestore.rules:312-317`) — so v1's "user-authored, one-click" seasonality is permission-denied for exactly the member holding the `forecast: family` grant v1's D4 invented for it. And that block has **no value validator** for any doc but `aiCostConfig` — a parent could write `factor: 1e9` and the client would multiply, which is Stage 6's F1 verbatim on a document whose corrupt value silently scales a displayed number.

**Ruling: `scopeKind: 'seasonality'` on `forecast_assumptions`.** One union member removes a document, a rules branch, a write path, a validator and a task's worth of permission ambiguity. Observed factors stay pure derivation and need no stored document at all.

**Shape.** A seasonality assumption's `scopeId` is `${categoryId}:${monthKey}` where `monthKey ∈ '01'..'12'`, `amountILS` is unused and `factor: number` carries the multiplier, bounded by named constants `SEASONAL_FACTOR_MIN = 0.1` / `MAX = 5` in `isValidForecastAssumption` — the F1 lesson, applied in Rules where it is enforced.

**Observed derivation** requires **n ≥ 2 observations of the same calendar month**. Below n=2 no factor is applied and the line says why — a multiplier from a single observation is fabrication with a decimal point.

**A31, and the plan decides it rather than deferring to David.** Observed factors need roughly 14 months of history; that half is dead code until late 2027. The user-authored half works on day one and v1 demoted it to demo-script seed content. **The September/April factors ship offered, pre-filled, one-click-accept, attributed and editable** — they are David's own sentences about his own family in §10, and asking him to re-approve his own spec is deference theatre. **v1's R6 closes.**

`seasonalFactor` rides in `ForecastBasis.movingAverage` as `{ factor, source: 'observed' | 'user', n }` so hover can say *"ספטמבר היה יקר ב-30% בשנתיים האחרונות"* or *"ספטמבר סומן ידנית כחודש יקר ב-30%"* — never an untraceable number.

**The no-month-literal guard survives but is fixed. (A39)** v1's version scanned one hardcoded file and banned integer literals 1..12 — while D7's own shape used **string** keys `'01'..'12'`, which pass cleanly. The guard is **derived from the module graph** (the `extractionSurfaces.ts` technique), bans **both** integer literals 1..12 and the string forms `'01'`..`'12'` and the twelve Hebrew month names, in the *logic* modules (not the copy modules, which must contain month names), comments stripped via the existing `stripComments`. §12 states what makes it able to fail.

---

## 4. Contract, permissions, and the Stage 8 seam

### D25 — `forecast_assumptions` v2: the union, the ModuleId's single job, the Rules-enforced seam, and authorship. **Replaces v1's D4.** *(A15, A16, A17, A30, A41)*

```ts
export interface ForecastAssumption extends OwnedRecord {
  scopeKind: 'category' | 'recurring' | 'loan' | 'insurance' | 'seasonality' | 'personalTarget';
  scopeId: string;
  fromPeriod: string;               // 'YYYY-MM'
  toPeriod?: string;
  amountILS: number;                // unused for 'seasonality'
  factor?: number;                  // 'seasonality' only, bounded in Rules (D24)
  flexible?: boolean;               // 'category' only — D29's escape hatch
  reasonHe: string;                 // required, non-empty — hover shows it verbatim
  source: 'user' | 'insight';       // ← THE STAGE 8 SEAM
  insightId?: string;
  status: 'active' | 'retired';
}
```

Two union members are new and each buys a whole decision: `'seasonality'` (D24) and `'personalTarget'` (A30 — one enum value gives a child an owned target, and D29's machinery computes the rest).

**Its own collection because** §9 states corrected assumptions affect both future insights **and** the forecast — state shared by two engines. State shared by two owners cannot live inside either without one becoming the other's dependency.

**(a) The ModuleId does one job. (A15)** `isModuleVisible` (`moduleRegistry.ts:86-95`) hides any tab whose `permissionModuleId` is not `null` and not granted — so a viewer with `expenses: family` and no forecast grant would lose the tab while the Dashboard card stays always-shown and drills into a hidden module. **Ruling: `permissionModuleId: null`** (net-worth's precedent, `moduleRegistry.ts:64`). `'forecast'` stays in `ModuleId` **purely to authorize `forecast_assumptions` writes**; the CRUD controls are gated on `forecast.edit`. Blast radius shrinks to `MODULE_IDS`, `MODULE_LABELS`, Rules — **plus the silent one v1 and the adjudication both missed:** `functions/src/shared/permissions.ts:17` duplicates the `ModuleId` union and **no test holds them in sync** (finding 1.2.5). T2 adds `'forecast'` there too and adds the missing contract assertion — *the two unions are equal* — so the next stage's addition fails loudly.

**(b) The Stage 8 seam is enforced in Rules, not by a source scan. (A16)** v1's protection was a source scan. **This project's doctrine is that Rules are the enforced boundary** — this is Stage 6's B4 one layer down. `isValidForecastAssumption` requires `data.source == 'user'` in Stage 7; Stage 8 widens it **in the same commit that ships the writer**. The `'insight'` renderer branch is dead **by rule, not by convention** — so **the renderer is cut** (Lola 12); the type field stays. And T8 asserts explicitly that **no glossary entry describes insight-sourced assumptions** — B4 was caught from the glossary direction, not the code direction.

**(c) Authorship, and the injection vector. (A15 second half)** Nothing stops a member with `forecast: family` and `loans: none` authoring an assumption over a loan they cannot read, with free-text `reasonHe` rendering on a **parent's** screen — member-authored content injected into a higher-privilege view, and a prompt-injection vector the day Stage 9 puts forecast facts in the AI context.

**Ruling — both halves, because either alone leaves a hole:**
- **Validate authorship against the scope's own module** in Rules: writing an assumption with `scopeKind: 'loan'` requires the author to hold a non-`'none'` `loans` view level. Expressible with the existing `myLevel()` helper; a `scopeKind → ModuleId` map in Rules, and a rules-matrix case per `scopeKind`.
- **And** rule that `reasonHe` is family-visible free text, **named as excluded from any egress payload**. `EXCLUDED_FROM_EGRESS` gains `forecast_assumptions.reasonHe` with the reason, and the existing egress suite is re-run by name in T8. Stage 7 does not touch `buildFinancialContext`'s payload; this is a pre-registration so Stage 9 cannot add it by accident.

**(d) Registry mechanics that block on contact. (A41)** `ModuleRegistryEntry` requires `icon: LucideIcon` (`moduleRegistry.ts:23-30`) — v1's D15 literal omitted it and was quoted as drop-in. `MODULE_LABELS` is a total `Record<ModuleId,string>` (`PermissionsManager.tsx:45`), so adding the id **fails the build loudly** — which is good, and is exactly why the permission work lands early (T2).

**Rejected — reusing `'expenses'`:** a forecast is not an expense record, and gating it that way makes §4 scenario 6 inexpressible. **Rejected — no ModuleId at all:** net worth is ungated because every input carries its own gate and it has no collection; `forecast_assumptions` **is** a collection and needs a write gate.

**Pre-empting the obvious attack — "what does `forecast: family` mean for someone with `expenses: own`?"** They may open the screen and author family-scoped assumptions; it does **not** widen what data reaches the computation. Content is always exactly the intersection of what the viewer may already read — `netWorth.ts`'s D4 precedent verbatim. Pinned by an emulator test proving the query shape, not by reading code.

### D26 — Cold start gains a **row 0**, and the empty state is a **path, not an apology**. **Amends v1's D14.** *(A3)*

**D14's core survives and is upheld:** a month's displayed confidence inherits the **weakest** `monthsObserved` among contributing categories — never the average, which hides a one-month-old category behind five mature ones. Pinned with a mixed n=6 / n=1 fixture asserting the month reports 1. **₪0 and "we don't know" are different messages** (§5.7's own rule, applied to missing history).

v1's table presumed a "certain layer only" best case. **The certain layer's sources are all empty too** (`recurring` 0, `loans` 0, `insurances` 0, `accounts` 0) — so v1's best case is unreachable and its actual day-one state is not in the table.

| `monthsObserved` | Behaviour |
|---|---|
| **row 0 — every layer empty** | **The day-one state.** Not three empty bars: an **onboarding state**. Named missing inputs, each deep-linking to its create form. |
| 0 (certain layer present) | No statistical layer. Variable spend renders as an explicit **gap** per D40, *"עוד אין מספיק היסטוריה להערכת הוצאות משתנות"* — **never ₪0**. |
| 1–2 | Average shown, labelled with the real n. **No band.** No seasonality. |
| 3–6 | Full statistical layer, band from observed range, seasonality if n ≥ 2 same-months. |
| >6 | Window capped at 6 (§10's stated range). |

**The empty state is a path.** Every gap message names the missing input and **deep-links to its create form**, reusing Stage 5 D11's pre-filled navigation payload. This is the highest-value addition in the stage.

**The glance position always holds a number, never a caveat.** A caveat you can close is information; a caveat you can only read is noise. In row 0 the glance position holds the **count of inputs still needed** ("3 נתונים חסרים") as the number, and the three links below it — a number and a path, not an apology.

### D27 — A **demo-data generator** is its own task, and it runs before the statistical layer. *(A3 — new)*

No generator exists: `seed-members.ts` seeds three members and no financial data; `largeFamily.ts` is 20 members with no money. Without one, **the statistical layer's only test is synthetic** and every cold-start state above row 0 is unreachable in the app.

`scripts/seed-demo-finances.ts` — Admin SDK, dry-run by default, `--apply`, **isolated project id required** (it refuses to run against `demo-familyfinance` unless `--force-default-project` is passed, because `scripts/dev-emulators.ts:78-79` imports David's own `.emulator-data`). It generates, from a seeded PRNG so runs are reproducible:

- `accounts` for each of 3 members, with `balanceUpdatedAt` spread so **all three D16 staleness states occur**;
- `recurring` items of both `kind`s, `loans` with an `endDate` inside and one outside the horizon, `insurances` of both `premiumFrequency` values;
- `incomes` rows with `month`/`year` present, and **at least one with a malformed pair** (D23);
- `transaction_lines` across 8 periods so the window cap, n=1, n=2, n=3 and n=6 categories **all coexist in one corpus** (D26 rows must be reachable simultaneously — the weakest-category rule cannot be tested otherwise);
- **at least one row with an unparseable `date`**, so `period: 'unknown'` and `unusableRowCount` are **not shadowed** (finding 1.2.2);
- **at least one row with `totalInstallments` set and `installmentNumber: null`** (finding 1.2.7), and two same-vendor plans that collide under D10's `planKey`;
- a 20-member variant (`--members=20`) reusing `largeFamily.ts`'s shape, for the readability regression.

**It is a fixture generator, not a guard**, so it gets **no mutation sweep** — but it does get one assertion: a test that runs the generator into an in-memory corpus and asserts each of the six conditions above is present. If the generator stops producing an unparseable row, the guard that depends on it must not go quietly green.

### D28 — **`forecasts` is cut.** One month-close snapshot survives, as a measurement. **Replaces v1's D9.** *(A27, A29)*

Its only named consumer was Stage 8 — the stage that knows what shape it needs. Building a collection, rules block, validator, audit action and restore mode for a consumer that does not exist is the bet B4 lost. And v1's restore had an unseen dereference hazard: freezing assumption **ids** means a hard-deleted assumption leaves the provenance hover with nothing to show.

**Cut:** D9, its `forecasts` rules block, `isValidForecast`, the `forecast.snapshot` audit action, the restore mode, the "שמור תחזית" control, and the `forecast.savedSnapshot` glossary entry. If snapshots return, they return in Stage 8 storing resolved `ForecastBasis` objects **by value**.

**The one exception, kept as a measurement rather than a feature (A29):** an **automatic month-close snapshot** — on the first forecast computation of a new month, if none exists for the month just ended, write `forecast_calibration/{period}` holding the projected per-category and total figures for that period. No UI, no restore, no user control. Its only purpose is calibration.

**And the honest limitation, stated here rather than discovered in T8:** `|projected − actual| / actual` needs a projection for a month that has since **elapsed**. The first snapshot is written at the first month-close after this stage ships, and the first calibration number exists a month after that. **Calibration is therefore not a Stage 7 acceptance measure and cannot be one** — Stage 7 ships the plumbing and the empty-state screen ("עוד אין מספיק זמן כדי לבדוק את דיוק התחזית — המדידה הראשונה תופיע בסוף החודש הבא"), and the number becomes readable in Stage 8. Listing a Stage 7 acceptance number nobody can produce would repeat exactly the `unusableRowCount` defect the gate rejected. See §15.

### D29 — "מה צריך לקרות": lead with names, keep the refusal, add a personal target, and ship the advice-boundary notice. **Amends v1's D8.** *(A28, A30, A33)*

`categoryAllowance(c) = statisticalProjection(c) − (shortfall × share(c))`, `share` over total *statistical* spend.

**D8's refusal rule survives verbatim and was explicitly upheld:** if `shortfall > Σ statisticalProjection`, the line **must not** render negative allowances. A negative allowance is arithmetically derived and semantically meaningless. **Stub-first, mutation-tested, and tested in the cheap-for-expensive direction** so it is not shadowed by another check that refuses first. *(Rejected then and now: proportional shave across everything — tells a family to reduce their mortgage by 4%; asking users to classify every category up front — a setup tax before the first useful answer, so `flexible: false` is expressible as an assumption instead.)*

**Three amendments.**

**(a) The refusal states arithmetic, not a verdict. (A26/Ofra M3)** v1's copy delivered a judgement the family will hear as a judgement about themselves. Replace with the numbers and let them conclude:

> היעד דורש ₪12,000 בשלושה חודשים. סך ההוצאות המשתנות הצפויות בתקופה הוא ₪7,400 — גם ללא שום הוצאה משתנה, הפער נשאר ₪4,600.

**(b) Rank by shekels and lead with names. (A28)** "Reduce every flexible category by 12%" computes correctly and advises uselessly — it is not a thing a family executes. **Rank by absolute shekel contribution and lead with the top two or three by name**; the proportional table sits below, unchanged. And state that shaving is not the only lever: **deferring a commitment past the horizon and increasing income exist**, and copy implying cutting is the only path is wrong even though those levers are out of scope here.

**(c) Targets — three sources, all messy, all explicit.**
- `settings/budgetConfig` — unreadable for members (`firestore.rules:296-298`), and **empty of per-category budgets in the real corpus anyway** (finding 1.3.22). No target ⇒ **no line, calm state, never a fabricated target.**
- `goals` — ownerless, with a Hebrew month-name `date`. Parsed by a pure `parseHebrewGoalPeriod` using a Hebrew month array **moved** into shared config from `FuturePlanning.tsx:24-27` (moved, not duplicated — duplicating a map is this project's recorded F4 class). Unparseable goals **excluded with a visible count**. A per-member line stating a family goal must say so.
- **`scopeKind: 'personalTarget'` (A30) — new, and it is what turns the `'own'` screen from a refusal into an answer.** §4 scenario 6 promises a child sees "ההוצאות שלו, **היעדים שלו**", and `goals` is ownerless so a per-member goal does not exist. A `personalTarget` assumption is owned by `ownerId`, so a child has a target of their own and D29's machinery computes the rest.

**(d) The `'own'` screen is reframed around the question a member owns. (A30, seconded by Ofra M1)** Not "will the family be OK" — **"כמה נשאר לי להוציא"**. The `'own'` glance number is the remaining personal allowance against a `personalTarget` where one exists, and projected committed outgoings where none does. **Owned recurring income is not rendered on the `'own'` screen**: showing it beside outgoings with no balance line invites the reader to do the subtraction in their head and get it wrong for exactly the reason D17 refuses to draw it. One line says so.

**(e) The advice-boundary notice ships here. (A33)** §9 pins the permanent "worth checking, not advice" notice to the insights screen — Stage 8. But the allowance row is **the first thing this app ships that tells a family what to do with money**, and it is phrased as an instruction with a number in it. The notice ships with the allowance:

> זו תמונת מצב לבדיקה, לא הוראת פעולה. המערכת אינה יועץ פיננסי מורשה.

And the row itself is phrased as **"כדאי לבדוק"**, not as an instruction: *"קטגוריית 'מסעדות' היא הגדולה מבין המשתנות — ₪2,400 בתקופה. כדאי לבדוק אותה ראשונה."*

### D10 — Committed instalments. **Survives v1 unchanged, with one correction.**

A row `(installmentNumber: 3, totalInstallments: 12, amount: 250)` implies 9 further ₪250 charges, capped at the horizon. Double counting on re-import is prevented by projecting only `number > max(observed)` for that plan; plans are identified by a derived `planKey = f(vendor, totalInstallments, amount)`. **There is no plan id in the data** and this heuristic will mis-group two identical-looking plans from the same vendor — stated in the guard comment **and** the hover copy, counted in R5, and a colliding-plans fixture is a permanent test documenting the known-wrong output.

**Correction (finding 1.2.7):** the "`totalInstallments` present, `installmentNumber` absent" case is a **`null`**, not `undefined` (`FileProcessor.ts:561-562`). The unprojectable check is `installmentNumber == null`, and a fixture pins the `null` form specifically.

**Amount semantics:** T1 step 1 asserts against a **real extraction fixture** that `amount` is the per-instalment charge. Do not copy the assumption from this plan — three agents on this project have caught an inherited fixture that was wrong.

### D3 — The uncertainty band. **Survives v1 verbatim, and was explicitly praised. Not re-litigated.**

**"Conservative / expected / optimistic" as commonly built is theatre.** Three lines from ×0.85 / ×1.0 / ×1.15 encode no information: the multiplier is invented, the width is constant regardless of that category's actual volatility, and the fan visually implies a probability interval nothing supports. **This plan does not build that, and a reviewer must reject any implementation that quietly does.**

- **The certain layer has no band.** A loan repayment, an insurance premium and a committed instalment are contractual. Single solid value. Widening them manufactures uncertainty that does not exist.
- **The band belongs only to the statistical layer**, width derived from that category's **own observed dispersion**: `min` / `median` / `max` of monthly totals across the lookback window. Computable from rows the moving average already reads, and it **degenerates visibly** when history is thin — which is the point.
- **`bandBasis: 'observed-range' | 'insufficient-history' | 'assumption-fixed'`** is carried and rendered. **Below `monthsObserved = 3` the band is not drawn**, and the screen says so. An assumption-set amount gets no band — the user asserted a number; we do not add error bars to their assertion.
- **No probability language, ever.** Copy is "הכי יקר שהיה" / "הכי זול שהיה" / "האמצע", never "80% ביטחון".

**Rejected:** symmetric multipliers (theatre); sample standard deviation (`mean ± 1σ` is defensible at n≥12 and meaningless at n=3–6, which is the entire range §10 specifies — a statistic outside its validity window is the same lie in respectable clothing); Monte Carlo (no distributional model to sample, and unexplainable on hover, violating §5.2 outright).

**One clause of v1's D3 is struck** — "uncertainty must grow with distance" — see D41.

### D30 — `תזרים`: **fix the screen.** **Replaces v1's D13.** *(A24)*

`Dashboard.tsx:648` renders `תזרים מזומנים חודשי` in an `<h2>` today. v1's D13 declared the word "never surfaced" — false. **The reason nobody knew is the bigger finding: `violatesPlainLanguage`'s corpus is glossary entries only. The ban has never seen a single rendered string in the app.**

**Rulings.** Keep the ban and keep `plainLanguage.ts` unmodified — weakening the floor so copy can pass it is backwards, and that file has survived every stage untouched. **Fix line 648** (Dashboard is edited by this stage anyway). And record the corpus gap as a finding in its own right, deferred by name to Stage 11 — a `plainLanguage` corpus that never reads rendered strings is a guard scoped to a branch that emits nothing, which is the §12 class.

**The question to David changes** from "may we use it" to *"the app already says it — drop the ban, or fix the screen?"* Recommendation: **fix the screen**.

**The replacement is a name and a sentence, not a description (Ofra M3).** v1 gave only the description. Short label: **"כסף נכנס ויוצא"**. Sentence beneath it: *"כמה כסף צפוי להיכנס ולצאת בכל חודש בטווח שנבחר."*

### D31 — Registry: `permissionModuleId: null`, and the `'future'` screen is a bigger problem than a label. **Replaces v1's D15.** *(A15 + finding 1.2.1)*

```ts
{ id: 'forecast', label: 'תחזית', icon: LineChart, permissionModuleId: null,
  usesGlobalFilters: true, filterModuleId: 'expenses' }
```

`icon` is required (`moduleRegistry.ts:23-30`) — v1 omitted it and quoted the literal as drop-in. `permissionModuleId: null` per D25(a). `filterModuleId: 'expenses'` because the מי control's dead-end filtering should follow the module dominating the forecast's data volume.

**The `'future'` screen.** Two tabs both promising the future is a §5 information-architecture defect the moment this stage ships — and it is worse than v1 said. `FuturePlanning.tsx:264-278` renders a panel headed **`תחזיות AI לעתיד`** containing two hardcoded static tips and no computation (finding 1.2.1). Shipping a real forecast beside a fake one is not a labelling problem.

**Ruling, and it is deliberately the smallest thing that is honest:**
- Registry label `'future'` → **`יעדי חיסכון`**.
- `FuturePlanning.tsx:150`'s `<h1>` → `יעדי חיסכון וקרן חירום` (the screen has three sections: goals, emergency fund, and the tips panel — "יעדי חיסכון" alone misdescribes it, and `:187` already uses that exact string as an `<h2>`).
- **Delete the `תחזיות AI לעתיד` panel** (`:264-278`). It is not a forecast, it is not AI, and the two tips it contains are onboarding copy that belongs beside the goals list. Move both `<li>` strings verbatim into the goals section as helper text.
- **Everything else in `FuturePlanning.tsx` stays untouched.**

This makes v1's "the component stays on Stage 5's untouched list" **false**, and v2 says so rather than carrying the claim forward.

### D32 — Time: one clock, string arithmetic, and the anchor is clamped forward. **Amends v1's D12.** *(A18, A35)*

**D12's core survives and was upheld:** **מי** and **מה** apply fully; **מתי** is the **anchor**, not the range; the horizon (3/6/12/custom, default 3) is a **forecast-local** control, **not** added to `GlobalFilterState`. *(Rejected: ignoring מתי — breaks §5.3's literal "משפיע על הכל, כולל התחזית", which Stage 6's M3 already had to retrofit for the chat; horizon in `GlobalFilterState` — a dimension only one screen reads, persisted into every other screen's sticky state.)*

**(a) The anchor is clamped forward, and the card says so. (A18)** מתי is a month stepper with unbounded prev arrows, and v1 never ruled on a past anchor. `anchorPeriod = max(selectedPeriod, todayPeriod)`. When the clamp fires, the card says: *"התחזית מתחילה מהחודש הנוכחי. חודש שכבר עבר אינו נחזה אחורה."* **Silent back-projection is the only unacceptable option.**

**(b) Timezone. (A35)** The word appears **zero times** in v1, and Stage 7 adds three new places where "which month is it" is decided. The only pinned clock in the tree is the cost gate's `Asia/Jerusalem`, added *after* a rollover bug corrupted two months of counters; Stage 3 already had tests fail under `TZ=America/LA`.

**Rulings:** one named constant `APP_TIMEZONE = 'Asia/Jerusalem'` reused from the cost gate, not re-declared; **`'YYYY-MM'` string arithmetic throughout** (`recurringCatchup.ts`'s own convention, moved to `periodMath.ts` by D22); and `todayPeriod` / `anchorPeriod` are **passed into** `forecast.ts`, never read from a clock inside it. `forecast.ts` calling `new Date()` fails a test (D37).

### D33 — Performance: a stated ceiling, no `limit()`, and **one measured number**. *(A37 — new)*

Performance has never been measured in this project — not once, in six stages.

- **A stated row ceiling** above which the screen degrades **explicitly** — the same shape D26 uses for thin history: above `HISTORY_ROW_CEILING` the screen says the window was too large to read and offers a shorter one.
- **`limit()` is forbidden.** Silently truncating an average is precisely the lie this stage exists to avoid.
- **Cache the fetched window and re-slice on filter change** rather than refetching — which is also what pays for D21(b)'s client-side מי filter over a family-wide fetch.
- **T8 records one measured number**: rows fetched, and wall-clock time from mount to first painted figure, on the 20-member demo corpus, on this machine, with the machine named. Not a benchmark — a first data point, so this project finally has one.

### D34 — Hebrew copy: **no second person, anywhere.** *(A26 — new)*

Every line of Hebrew in v1 was masculine-singular second person. This is a family product with up to 20 members, women and girls among them, and nobody has decided this. **Stage 7 is the largest copy drop in the project.**

**Rule: avoid second person entirely.** "הסכום הזה נקבע ידנית", not "אתה קבעת". "כדאי לבדוק", not "תבדוק". It is not Stage 7's job to retrofit the tree; it **is** Stage 7's job not to add ~27 more. A guard over the new glossary entries and the forecast copy module rejects `אתה`/`את`/`שלך`/`תבדוק`-shaped second-person forms — with the honest caveat in §12 about what that guard can and cannot see. **Flagged to David (§16).**

### D35 — The forecast recomputes when an assumption changes. *(A34 — new)*

`useScopedRead` is a one-shot fetch (`useScopedRead.ts:57-95`). §3's measurable success metric is *"כל המלצה ... והמערכת מחשבת מחדש בעקבות התיקון"* — David's own standing demand. v1's T4 built the CRUD and T7 built the hook, and neither named the wiring.

**Ruling:** assumption create / edit / retire calls `useForecast`'s `reload()` explicitly, with a test that asserts the rendered figure changes after a mutation — not that `reload` was called.

### D36 — One drill-down, built. Comparison mode, deferred **by name**. *(A32 — new)*

`<Explain>` is hover-explain; §5.1's "כל מספר הוא לחצן" is a different promise and v1 delivered only the first. **Build the one natural drill:** October's estimated variable spend → the historical rows behind that average, in the existing drill affordance's shape (`Dashboard.tsx:603-611`'s `drillDownTo` + `DrillAffordance`).

§5.4's comparison mode is specified "לכל מסך" and this would be the sixth screen to skip it. **Named in the deferral table (§13)** rather than dropped silently.

### D37 — Mirrorability restated as something a guard can **check**. **Amends v1's D1.** *(A38)*

**D1's core survives and was explicitly cleared by the gate:** the forecast computes in a **pure client util** (`src/utils/forecast.ts`) consumed by `useForecast`. **Rejected — a Cloud Function:** it would re-derive the viewer's permission scope server-side, precisely the defect both Stage 6 lenses rejected — **a second, un-mirrored authorization path** beside a mirrored leaf function. It also puts a round-trip on every filter change on the one screen §3 requires to answer in under 5 seconds, and it has no AI dependency. **Rejected — persisting a materialized forecast:** see D28.

**v1's revisit trigger was not satisfiable as stated.** It said "constrain `forecast.ts` to `netWorth.ts`'s contract exactly" — but `netWorth.ts` branches on `scope` and calls `new Date()` at `:69`, and v1's own T2 said to reuse `computeDuePeriods`, which takes a `Date`. And `functions/src/shared/permissions.ts:11-14` **already forbids the move**, instructing an esbuild/tsup predeploy step instead. Stage 8's scheduled engine has no user session, so it is a *different function with different inputs*, not a file that moves.

**Ruling — a constraint an import-graph guard can check:**

```
forecast.ts (and every module it imports transitively, inside src/utils/)
  MUST NOT import from: firebase/*, src/services/*, src/contexts/*, src/components/*
  MUST NOT call: new Date(), Date.now()
  MUST take: anchorPeriod and todayPeriod as explicit parameters
```

AST-derived over the transitive import closure, `stripComments`-based. **The revisit trigger is recorded as "build the tsup/esbuild share step per `functions/src/shared/permissions.ts`'s own instruction", not "move the file"** — because that file forbids the second hand-copy in writing.

---

## 5. What the screen draws — settled here, on paper

**There is no browser verification in this project and no screenshot tooling.** These are settled in the plan or they are discovered in code, and a hand-wave here is the same defect the gate rejected. Each of the five below is a decision a reviewer can disagree with in words.

### D38 — The card carries the figure, a reference, a verdict, and the horizon — and it loses the scale contest deliberately. *(A19)*

v1's card displayed a figure and did not answer the question.

**The card carries, in this order:**
1. **The label** — `צפוי להישאר בסוף דצמבר` (label is part of the glance, not a caption).
2. **The figure** — `₪12,400`, or the D17 gap when `projectedBalance` is `null`.
3. **A reference** — `מתוך ₪48,000 שנכנסים`. Stage 6's own fix: *a spend with no denominator is the "% of what?" problem.*
4. **A verdict state with a conditional colour rule**, including a **designed negative state** — the most important thing this card can ever render, and v1 never mentions it. Positive: brand teal, no icon. Near-zero (`|balance| < NEAR_ZERO_ILS`): neutral slate, `כמעט מאוזן`. **Negative: a designed state, not red-as-alarm** — amber ground, the figure with an explicit minus, and the words `צפוי חוסר של ₪3,100`. Contrast measured from the installed Tailwind theme via `__tests__/helpers/tailwindContrast.ts`, **never hardcoded ratios**.
5. **The horizon** — `3 חודשים קדימה, מספטמבר`, plus D32(a)'s clamp sentence when it fires.

**Scale parity is rejected.** `Dashboard.tsx:607` is already `text-3xl md:text-4xl font-bold`. Two co-equal glance numbers is not a hierarchy. **The forecast card takes `text-2xl md:text-3xl` and wins by panel treatment and position instead** — full-width, directly beneath the net-worth row, its own ground. Net worth stays the largest number on the Dashboard.

**Where I depart from A19, and why (see §15):** A19 lists the certain/estimated split as a fifth card element. Five text elements at subordinate scale on a phone is not a glance, and it fights A3's "the glance position always holds a number". **The split is carried by the bar itself (D39), not by a fifth line of card text.** The card gets a single-line, four-word summary — `₪8,900 מזה כבר סגור` — which is one element, not a breakdown.

**The `'own'` card does not reuse the family slot.** Opposite sign semantics in the same place is the most dangerous misread in the stage. Different panel, different position (below the family row, not in it), and an **explicit prefix in the glance line itself**: `צפוי לצאת: ₪3,200`, or per D29(d) `נשאר להוציא: ₪1,800` where a `personalTarget` exists. `<ScopeBadge scope="own">` in addition — the badge says "restricted", the sentence says *what is missing*.

### D39 — One stacked bar, two luminance steps, and the boundary carries a **value label**. Hatch is rejected. *(A22)*

Hatch survives colour-blindness and print, and **fails at mobile bar sizes, has undecided RTL direction, and has no accessible name**. v1 chose it anyway.

**Ruling:** one bar per month, **same hue, two luminance steps** — the committed segment darker, the estimated segment lighter — stacked, with the **boundary carrying a value label**: `₪4,200 מזה כבר סגור`. Quantity lands on **position**, the strongest visual variable, and the reader gets a sentence instead of a texture. Accessible name on the bar group: `אוקטובר: ₪7,100 סך הכל, מזה ₪4,200 כבר סגור`.

**How the band and the split compose — the question A22 asks and v1 never answered.** Two visual languages on one bar, and they must not overlap:
- **The split is inside the bar** (length/position).
- **The band is a single vertical whisker on the estimated segment only**, drawn from `Σmin` to `Σmax` of the statistical portion, **anchored where the certain segment ends.** It never spans the certain portion, which has no band by D3 — so the whisker's baseline is itself the visual assertion "everything below this is not in question".
- **Below n=3 there is no whisker at all**, and `bandBasis: 'insufficient-history'` gets a **per-bar marker** — a small `n=2` chip on the bar, not a paragraph under the chart. (A22's explicit requirement; v1 put it in a paragraph.)

### D40 — The gap is a marker **visibly not on the value scale**. All three obvious renderings are wrong. *(A21)*

v1 said "an explicit gap" and left it there. Dashed-outline and omit both read as **zero**; full-height grey reads as a **huge expense**. And v1's specified guard (`no ₪0`) passes for all three, because **it tests the string, not the picture.**

**Ruling.** For a month whose statistical layer is absent (`monthsObserved === 0`):
- The bar renders **only its certain portion, at its true height.**
- The estimated portion is replaced by a **terminating ragged edge plus a `?` chip** sitting immediately above the certain segment — a mark that is **not on the value scale** and cannot be read as a quantity.
- **The axis maximum is computed from certain values only** for such months, so the ragged edge never implies a magnitude.
- Accessible name: `אוקטובר: ₪4,200 סגור. הוצאות משתנות — אין עדיין היסטוריה להערכה.`

**Scope, which neither document states:** **D40 governs `monthsObserved === 0`; D39 governs `monthsObserved >= 1`.** A21 and A22 describe different months and are only compatible if that line is drawn. It is drawn here.

### D41 — Distance is encoded **explicitly**, because "uncertainty grows with distance" is false of this data. *(A20 — strikes a clause of v1's D3)*

Recurring items, loans and insurances repeat identically month over month; the band is `min/median/max` of history, **identical for every projected month**. So v1's requirement — "month 3 is strictly more estimated than month 1" — **will not appear on screen**, and only a synthetic fixture satisfies it. v1's pinning fixture (month 1 fully certain, month 3 fully statistical) was that synthetic fixture.

**Rulings:** strike the clause from D3. **Encode distance explicitly** as a **per-month confidence chip** on each bar, driven by two real inputs: `monthsObserved` (the weakest contributing category, per D26) **and** the committed share (`certainILS / totalILS`). Three states, named constants, no percentages on screen: `מבוסס היטב` / `הערכה` / `הערכה גסה`. It is `null` — chip absent — for row 0.

The fixture that pins it is a **real** one from D27's generator, not a hand-built one: a corpus where month 1 and month 3 have the *same* committed share and *different* `monthsObserved`, asserting the chips differ; and one where both are equal, asserting they are the same. The second assertion is the one that would have caught v1's false claim.

### D42 — The time axis runs **right to left**, and the container does not flip. *(A23)*

This is the first time-series chart in the app; there is no precedent to inherit. The existing precedent wraps recharts in `dir="ltr"` (`Dashboard.tsx:1105`, `:1150`; `InvestmentsPortfolio.tsx:215`), which is **fine for category bars and wrong for a time axis** — the nearest month lands at the far left, opposite where a Hebrew reader starts.

**Ruling, and it is deliberately narrow:**
- **Keep the container `dir="ltr"`.** Recharts' internal layout math (label placement, tooltip anchoring, `ResponsiveContainer` measurement) assumes LTR, and flipping the container is what makes labels drift. The existing precedent is right about *why* it exists.
- **Flip the axis, not the box:** `<XAxis reversed />` so the nearest month is at the **right** edge, where a Hebrew reader starts, and time runs right→left. `<YAxis orientation="right" />` so the value scale sits on the same side as the reading origin.
- Tooltip content renders in its own `dir="rtl"` wrapper.
- **The existing category-bar charts are not touched.** `dir="ltr"` remains correct for them — a category axis has no reading-direction semantics.
- Pinned by a test asserting `reversed` is set on the time axis and that the first data point in DOM order is the nearest month.

---

## 6. Method — which standing rule binds where

| Standing rule (Stage 6) | Where it binds in Stage 7 |
|---|---|
| **Reproduce before fixing; keep the reproduction** | **T0's whole existence** — measure before migrating. Plus T3: reproduce the `'own'`-viewer `getDocs` denial **on the live emulator** before adding `period`; the mocked suite cannot see it. Becomes a permanent `firestore-tests/` case. |
| **Mutation-test every guard** | T1 (`resolveLayerPrecedence` shuffle-invariance; the forward-projector horizon; `layerOf` exhaustiveness); T2 (the `source == 'user'` Rules floor; authorship-by-module; fail-closed default); T3 (both-fields `scripts/` assertion; `period`/`ownerId` immutability; the completion-marker refusal); T5 (`isExpenseRow` + `recurringId` exclusions; band-basis selector; `monthsObserved` floor); T6 (unreachable-target refusal, **cheap-for-expensive**; seasonality n≥2 floor; month-literal guard); T7a (presence-driven suppression); T7b (Explain coverage, render-presence); T7c (all four A39 guards). Each mutation reverted and re-run green before the next. |
| **Predicates stub-first with synthetic inputs, before first green** | **All of the above, no exceptions.** `forecast_assumptions` is empty, `transaction_lines` holds 3 rows, and no forecast surface exists — **every predicate has a clean corpus and is shadowed by construction**, the exact condition under which this project shipped twelve shadowed guards, four inside the fix for the previous one. |
| **Derive guards from the tree, never enumerate** | T7c's Explain-coverage guard **derives the figure set from the rendered DOM** with a canary; the surface list comes from the module registry plus a call graph. The month-literal guard derives its module set from the import graph. A hardcoded testid list is the 4-instance enumeration class and will be rejected. |
| **A green mocked suite cannot see Firestore-contract bugs** | Live-emulator proof required in **T0, T2, T3, T4, T8**, and for exactly **one step** of T6. **T1, T5, T7a, T7b, T7c need none** — stated per task, not booted for show. |
| **Adversarial mutation sweep is an end-of-stage gate** | T8. **Every one must fail a test:** a new forecast surface with an un-`<Explain>`'d ₪ figure; a month literal (integer **and** `'09'` string form) in seasonality logic; the `recurringId` exclusion removed; `isExpenseRow` swapped for `isExpenseListRow`; the negative-allowance refusal removed; the presence-driven balance suppression removed; a `new Date()` added to `forecast.ts`; `source: 'insight'` written from client code; a `scripts/` writer omitting `ownerId`; the completion-marker refusal removed. |
| **A comment asserting a property is a defect unless a test holds it** | Every provenance claim in `forecast.ts` gets a test. The canonical one is now **D20's shuffle-invariance**, not v1's `layer`↔`basis.kind` correspondence — which D19 deleted the need for. |
| **Reviewers must not mutate the working tree** | Every review dispatch uses an isolated worktree; the emulator is isolated **by project id** (`firestore-tests/` hardcodes port 8080, so port isolation is not available). |
| **`test:all` is the only name for "the tests"** | The root suite needs `.env`/`.env.local` or 5 files fail to *collect* while vitest prints a plausible count. Every count **re-run, never quoted.** |
| **Egress copy is a human sign-off gate** | Stage 7 **does not touch** `aiDisclosure.ts` or `buildFinancialContext`'s payload. D25(c)'s `reasonHe` exclusion is a **pre-registration** in the exclusion list, verified by re-running the egress suite by name — not a payload change. |

---

## 7. Global constraints

- Branch `familyfinance-v2`. Frequent, well-scoped commits; **the app usable after every task.**
- `npm run lint` and `npm run test:all` green before every commit. Counts **re-run, never quoted.**
- **TDD, failing test first.** A test that passes on the first run against unwritten code is a defect.
- **Root `tsconfig.json` is NOT strict** — boolean-discriminant narrowing does not work in `src/`. Use string discriminants. `functions/` is strict; the asymmetry is the trap.
- Four states on every new hook and surface, **plus D18's per-input grading**. A failed read renders as an **error**, never as empty.
- No hardcoded values beyond named constants. **Specifically banned:** month numbers **and month-key strings** in seasonality logic; band multipliers; an unnamed lookback window; any ₪ threshold not read from config; any contrast ratio.
- **One money formatter.** `formatILS` moves from `src/config/aiCeiling.ts:40` to a neutral `src/config/money.ts` (byte-identical move, re-exported so `aiOverage.ts` and `AiSettingsScreen.tsx` keep working). `tabular-nums` on every numeric cell; `he-IL`; 2 fraction digits.
- Hebrew UI, RTL, dates DD/MM/YYYY. **D34: no second person.** `data-tour-id` on every new surface, control and row: `screen.forecast.*`.
- **Untouched:** `aiDisclosure.ts`, `buildFinancialContext.ts`'s payload shape, all four AI extraction surfaces, **`plainLanguage.ts`**, `ExpensesBreakdown` / `AnnualReport` / `CentralExpenseReport` / `InvestmentsPortfolio` / `FolderLogic` / `FamilyManagerModal`.
- **Touched, contrary to v1:** `FuturePlanning.tsx` (D31 — heading plus the deletion of the fake forecast panel), `Dashboard.tsx` (D30's line 648, D38's card, and D31/A40's two read paths).

---

## 8. Task breakdown — the re-ruled order

The order is the adjudication's, and the reasoning is worth keeping: **Sun** wanted the permission change early (it breaks the build loudly, so land it before two tasks of forecast code); **what-did-we-miss** wanted the pure core first (no I/O, and it surfaces A9 — the empty-certain-layer killer — *before* a migration writes every row). Both are right and they compose. T0 is prepended because the standing rule is "reproduce before fixing", and the migration equivalent is **measure before migrating**.

### T0 — Measure. Read-only.
- [ ] Copy `.emulator-data` to a scratch directory and boot the emulator on an **isolated project id**. Never `npm run emu` — it hardcodes `--import=./.emulator-data`, David's own data (`scripts/dev-emulators.ts:78-79`).
- [ ] Run `periodOf` over every `transaction_lines` row. **Report: total rows, parse-failure count and rate, rows per period, distinct `owner` values, and how many `owner` values resolve to a live `members.name`.** The last one sizes A6's orphan risk.
- [ ] Same for `incomes`, on the `month`/`year` pair per D23 — **and separately on `date`**, reporting how many rows disagree between the two. That number decides whether D23's deferral is a footnote or a Stage 11 blocker.
- [ ] Report `installmentNumber`/`totalInstallments` presence, and how many are `null` vs absent (finding 1.2.7).
- [ ] **Settle the migration's shape from these numbers**, and write them into the task report. If parse-failure is 0 — which finding 1.2.2 predicts — **say so, and record that `period: 'unknown'` and `unusableRowCount` are therefore shadowed until T4 generates rows for them.**

**Live-emulator: REQUIRED** (it reads real data). **Mutation sweep: NOT applicable — T0 builds no guard.** Said plainly rather than booting one for show.

### T1 — Pure forecast core: `periodMath`, the forward projector, the provenance union, the precedence resolver
- [ ] **Assert against a real extraction fixture** that `amount` on an instalment row is the per-instalment charge (D10). Do not inherit the assumption.
- [ ] `src/utils/periodMath.ts` — **move** `periodOf`, `nextPeriod`, `comparePeriod`, `periodsBetween`, `clampDayToMonth` out of `recurringCatchup.ts` (five of them currently module-private); re-point `recurringCatchup.ts`; `recurringCatchup.test.ts` stays green across the move.
- [ ] **`projectRecurringForward`** (D22) — a genuinely new function. **A test asserts it returns a non-empty list for a future month where `computeDuePeriods` returns `[]`.** That test is the A9 regression and must be written first.
- [ ] Loans, insurances (monthly-equivalent, both frequencies), instalments per D10 including the `null` case.
- [ ] `ForecastBasis` / `ForecastLineItem` / `ForecastResult`; **`layerOf(basis)` derived, `layer` not stored** (D19); `resolveCategoryOfScope` with its mapping table and the loan-override test.
- [ ] `resolveLayerPrecedence(items[])` — **stub-first, synthetic inputs, before first green**; canonical test is **shuffle-invariance** (D20).
- [ ] `openingBalance` + `staleness` (D16), from passed-in `Account[]`.
- [ ] **D37's import-graph guard**: `forecast.ts`'s transitive closure imports nothing from `firebase/*`, `src/services/*`, `src/contexts/*`, `src/components/*`, and calls no `new Date()`/`Date.now()`; `anchorPeriod`/`todayPeriod` are parameters. `APP_TIMEZONE` reused, not re-declared (D32).

**Live-emulator: NOT required — this task is pure, has no I/O, and booting one would prove nothing.** **Mutation sweep: REQUIRED.**

### T2 — Permissions, `forecast_assumptions`, Rules, the Stage 8 seam
- [ ] `'forecast'` added to `ModuleId`/`MODULE_IDS`; `MODULE_LABELS` row (fails the build until added — good); matrix row; `resolvePermissions`/`permissionSync`.
- [ ] **`functions/src/shared/permissions.ts:17` gets `'forecast'` too**, and `aiPermissionsContract.test.ts` gains the **missing assertion that the two `ModuleId` unions are equal** (finding 1.2.5). Today nothing holds them in sync.
- [ ] Registry entry with **`icon`** and **`permissionModuleId: null`** (D25a, D31).
- [ ] `isValidForecastAssumption` in the `isValidAiCostConfig` shape (`create, update` + `delete` split so the validator has `request.resource.data`) — **one `match` block with conditionals, never a second block**: Firestore ORs across matching rules and a naive split re-opens the `60d1c32` exposure.
- [ ] **`source == 'user'` required in Rules** (D25b) — the seam is enforced, not scanned. The `'insight'` **renderer is cut**; the type field stays.
- [ ] **Authorship validated against the scope's own module** (D25c), plus the `scopeKind → ModuleId` map. `factor` bounded by `SEASONAL_FACTOR_MIN/MAX` for `scopeKind: 'seasonality'` (D24) — the F1 lesson, in Rules.
- [ ] `period`/`ownerId` immutability added to the `transaction_lines` update rule (D21d) — landed here with the rest of the Rules work, ahead of T3's writes.
- [ ] Typed service on `createOwnedCollectionRepo` ⇒ audit entries ride in the same transaction. **A test asserts it is the only writer** (finding 1.2.8 — the `id` tiebreak degenerates otherwise).
- [ ] `reasonHe` added to `EXCLUDED_FROM_EGRESS` with its reason (D25c).
- [ ] **Inherited closure:** `isValidAuditEntry` requires `at is string` while both server writers use `serverTimestamp()` — **the rule can never have validated a server-written entry** (`firestore.rules:98-103`).

**Done:** adversarial rules matrix (≥4 session types × the new doc × 5 ops, plus unauthenticated and claimless, plus one case per `scopeKind`) **written independently by the reviewer, not reasoned from reading**; a full-matrix `'member'` still cannot write another member's assumption, nor an assumption over a module they cannot read.
**Live-emulator: REQUIRED.** **Mutation sweep: REQUIRED** (the `source` floor, the authorship check, the `factor` bounds, the fail-closed default).

### T3 — Migration: `period` + `ownerId`, scope-aware reads, index, Dashboard conversion
- [ ] **Live-emulator reproduction first:** a `'member'` session with `expenses: 'own'` issues `getDocs(collection(db,'transaction_lines'))` and is denied. Keep as a permanent `firestore-tests/` case.
- [ ] `periodOf` (from `periodMath.ts`) applied inside the **pure `migrateLegacyTransaction`** — the one place that already constructs a row (D21e).
- [ ] Backfill script: dry-run default, verified backup before `--apply`, idempotent, batch **400**, stamps `period` (`'unknown'` when unparseable) **and `ownerId`** (resolved from `owner` via `members`; `'unknown'` when unresolvable, **counted separately** — that count is A6's orphan set).
- [ ] Same pass over `incomes`, stamping `period` **from `month`/`year`, not from `date`** (D23b), with the divergence count from T0 recorded.
- [ ] **Completion marker** `settings/migrationState.transactionPeriodBackfill`; **the statistical layer refuses to compute until it is set** (D21d).
- [ ] Rules widened to `data.ownerId == memberId() || data.owner == myMember().name` — **strictly additive** (D21a).
- [ ] `listTransactionHistory(scope, viewerMemberId, periods)` — **exactly one `in`** (`period`, 7 values); `'own'` adds `where('ownerId','==',me)`. **A structural test asserts one disjunctive clause** (D21b). Prove on the emulator that the `'own'` shape is accepted where the unconstrained one is denied.
- [ ] `firestore.indexes.json` declaring `(ownerId ASC, period ASC)`; wire `firestore.indexes` into `firebase.json` (neither exists today).
- [ ] **`scripts/`-scoped assertion** (D21e): any file under `scripts/` writing `transaction_lines` produces both `period` and `ownerId` in the same object literal. **Delete the tautological allow-list-is-4 assertion** and record the guard's `scripts/` blind spot in its own header.
- [ ] Re-run the **HITL**, **watermark** and **`extraction.commit` audit** suites **by name**.
- [ ] **A40's Dashboard incoherence:** convert `Dashboard.tsx:288` and `:365` onto the new scoped read path. Without this, after Stage 7 an `'own'` viewer sees a working forecast card beside a budget card claiming they have no access to the same data.

**Live-emulator: REQUIRED.** **Mutation sweep: REQUIRED.**

### T4 — Demo-data generator *(new — D27)*
- [ ] `scripts/seed-demo-finances.ts` per D27, seeded PRNG, dry-run default, refuses the default project id without `--force-default-project`.
- [ ] The six-condition assertion: the generated corpus contains all three staleness states, coexisting n=1/2/3/6 categories, ≥1 unparseable date, ≥1 `installmentNumber: null` with `totalInstallments` set, two colliding same-vendor plans, and ≥1 malformed `incomes` `month`/`year`.
- [ ] `--members=20` variant on `largeFamily.ts`'s shape.

**Live-emulator: REQUIRED** (it writes). **Mutation sweep: NOT applicable — this is a fixture generator, not a guard.** Its one assertion above is a *presence* check, and it exists precisely so the guards downstream are not shadowed.

### T5 — Statistical layer, cold start, band
- [ ] **Refuses to compute unless the T3 completion marker is set** (D21d) — written first, tested first.
- [ ] Moving average per category over named `LOOKBACK_MONTHS_MAX = 6` / `_MIN = 3`.
- [ ] **`isExpenseRow`, named with its reason** (D23a) — and mutation-tested against `isExpenseListRow` being swapped in.
- [ ] **Exclude rows carrying `recurringId`**, both collections (D23b) — removing it must fail a test that names the double count.
- [ ] `monthsObserved` per category; **D26's table including row 0**; month confidence = **weakest** contributing category.
- [ ] Band: `min`/`median`/`max`; `bandBasis` discriminant; **no band below n=3** (D3).
- [ ] **D41's per-month confidence chip** — `monthsObserved` **and** committed share, and the fixture pair that would have caught v1's false "grows with distance" claim.
- [ ] `HISTORY_ROW_CEILING` degradation state; **no `limit()`** (D33).

**Live-emulator: NOT required — the layer is a pure function over arrays the caller fetched, and T4 supplies the corpus. Said plainly.** **Mutation sweep: REQUIRED.**

### T6 — Seasonality as assumption; targets, allowances, refusal, advice notice
- [ ] `scopeKind: 'seasonality'` derivation and application (D24); observed factors **n ≥ 2 same-calendar-months**, below that no factor and a stated reason.
- [ ] **September/April factors offered, pre-filled, one-click-accept, attributed, editable** (D24/A31). **v1's R6 closes.**
- [ ] **Month-literal guard, fixed** (D24/A39): derived from the import graph, bans integers 1..12 **and** the string forms `'01'`..`'12'` **and** the twelve Hebrew month names, in logic modules only, `stripComments`-based. **Do not hand-roll a lexer** — three times is enough.
- [ ] `parseHebrewGoalPeriod`, with the Hebrew month array **moved** from `FuturePlanning.tsx:24-27` into shared config (moved, not duplicated — the F4 class). Unparseable goals **excluded with a visible count**.
- [ ] `budgetConfig` unreadable ⇒ **no target, no line, calm state** — never fabricated. **Proven for a `'member'` session on the emulator** (this one step needs it; the rest of T6 does not).
- [ ] `scopeKind: 'personalTarget'` (D29c) — the `'own'` screen's answer.
- [ ] Allowance shaved across statistical categories only; `flexible: false` honoured from assumptions.
- [ ] **The refusal** (D8, unchanged): `shortfall > Σ statistical` ⇒ explicit unreachable state **stating the arithmetic** (D29a); **never a negative allowance.** Stub-first, mutation-tested **in the cheap-for-expensive direction** so it is not shadowed by a check that refuses first.
- [ ] **Rank by shekels; lead with the top two or three by name** (D29b); state that deferring and increasing income are also levers.
- [ ] **The advice-boundary notice** ships with the allowance (D29e).
- [ ] **D28's month-close calibration snapshot** — write path only, plus the "not enough time yet" empty state.

**Live-emulator: REQUIRED for exactly one step** (the `budgetConfig`-unreadable proof — a Rules fact a mocked suite cannot see). **Not required for the rest.** **Mutation sweep: REQUIRED.**

### T7a — `useForecast` + Dashboard card
- [ ] `useForecast` returning **`Record<InputKey, {scope, state, count}>`** (D18); `useScopedRead` reused where it fits and **bypassed where it cannot fit, each bypass commented with the reason**.
- [ ] **D17 enforced at the hook**: `projectedBalance` is `null` unless **every** balance-contributing input is `'ok'`; `suppressed` populated; **D17's sentence generated from it.** Mutation-tested.
- [ ] **D35**: `reload()` on assumption create/edit/retire, with a test asserting the **rendered figure** changes.
- [ ] **D38's card** — label, figure, reference, verdict state (including the designed negative), horizon, one-line committed summary. `text-2xl md:text-3xl`; net worth keeps the largest number. Contrast from `tailwindContrast.ts`.
- [ ] **The `'own'` card in its own panel and position**, explicit prefix, `<ScopeBadge scope="own">`, no owned recurring income (D29d).
- [ ] **D33's window cache** — fetch once, re-slice on filter change.

**Live-emulator: NOT required — the hook is tested with injected `list` functions, which is also what keeps it mountable in a bare `renderHook()`.** **Mutation sweep: REQUIRED.**

### T7b — Full screen, chart, glossary, copy
- [ ] The full screen; **D26 row 0 as an onboarding path with deep links** (Stage 5 D11's pre-filled navigation payload).
- [ ] **D39** stacked bar, two luminance steps, boundary value label, accessible name; band as a whisker on the estimated segment only; per-bar `insufficient-history` chip.
- [ ] **D40** gap marker for `monthsObserved === 0`, axis max from certain values only.
- [ ] **D41** confidence chip. **D42** `<XAxis reversed />`, `<YAxis orientation="right" />`, container stays `dir="ltr"`, existing category charts untouched.
- [ ] Certain layer rendered **itemised by name** (D23's disclosure).
- [ ] **D36's one drill**: October's estimated variable spend → the rows behind the average.
- [ ] **D30**: fix `Dashboard.tsx:648`; the label `כסף נכנס ויוצא` plus its sentence.
- [ ] **D31**: registry label; `FuturePlanning.tsx:150`'s `<h1>`; **delete the `תחזיות AI לעתיד` panel** (`:264-278`) and move its two tips into the goals section.
- [ ] `formatILS` → `src/config/money.ts` (byte-identical move, re-exported); `tabular-nums` everywhere.
- [ ] **Glossary entries per §11** — every one passing `violatesPlainLanguage`, every one wired to a live `<Explain>` (`Explain.tsx:47-53` renders nothing for an unknown id, so an unwired entry is invisible and an unentried hover is absent).
- [ ] **D34**: no second person in any new string.

**Live-emulator: NOT required — component tests render against fixtures from T4's generator.** **Mutation sweep: REQUIRED** (Explain coverage; render-presence).

### T7c — Guards and the formatter's teeth
- [ ] **`<Explain>` coverage guard** — derives the figure set **from the rendered DOM** with a canary. A hardcoded testid list is rejected.
- [ ] **Inherited closure:** convert the extraction-notice guard from **source-presence to render-presence** — `{SHOW_NOTICE ? <Notice/> : null}` on a fifth surface currently passes green. Stage 7 adds no extraction surface, which is exactly why this is the right stage to close it: **no pressure to weaken it to fit new code.**
- [ ] **The four A39 guards, un-shadowed** — see §12 for what makes each able to fail:
  - no-probability-language, **with `שמרן` / `צפוי` / `אופטימי` added to the denylist** and the corpus widened beyond glossary entries;
  - month-literal (built in T6, verified here against both literal forms);
  - **no `₪0`, re-scoped** to the branches that can actually emit one;
  - the tautological allow-list assertion **deleted** (T3), replaced by the `scripts/` assertion.
- [ ] **D34's second-person guard** over the new copy modules, with its stated limitation.
- [ ] **D37's import-graph guard** re-run over the finished `forecast.ts` closure.

**Live-emulator: NOT required — every guard here is static or DOM-level.** **Mutation sweep: REQUIRED — this task IS the sweep's home ground.**

### T8 — Demo, acceptance, close
- [ ] **Inherited closure, moved here from v1's T2:** `readMoneyAmount(raw: unknown)` — three states (`ok`/`absent`/`corrupt`), the sibling of `functions/`'s `readStoredAmountILS`. Closes `buildFinancialContext.ts:56-58`: a corrupt `recurring.amount` makes `totalMonthlyExpense.value` `NaN`, which `JSON.stringify` sends **to the model as `null`**. **This is the one line Stage 7 touches in `functions/`** — a value read, not a payload field. **It lands here because the egress suite is already being run in this task** (v1 put a `functions/` edit inside a task labelled "live-emulator NOT required").
- [ ] Egress suite re-run **by name**, including the `reasonHe` exclusion (D25c).
- [ ] **Glossary dump re-run and recounted against `src/config/glossary.ts` at HEAD** — never trusting an earlier number. It was 25 at plan time; the count moved 22→25 mid-review once already.
- [ ] **T8 asserts no glossary entry describes insight-sourced assumptions** (D25b/A16) — B4 was caught from the glossary direction, not the code direction.
- [ ] **Demo script written by running things**: emulator on an **isolated project id** (never `npm run emu`), corpus from T4's generator, exercising **all five D26 states**, both scopes, an assumption overriding a certain item, a seasonality accept, a `personalTarget`, and an unreachable target.
- [ ] **D33's one measured number** recorded, with the machine named.
- [ ] **Acceptance measures re-run against HEAD**, never carried forward — findings age the moment a fix lands.
- [ ] **Adversarial mutation sweep** per §6. Every survivor fixed, or recorded as genuinely equivalent **with the argument stated**.

**Live-emulator: REQUIRED.** **Mutation sweep: REQUIRED — this is the gate.**

---

## 9. Risks

| # | Risk | Mitigation | Owner |
|---|---|---|---|
| **R1** | **Loan/insurance double count** — a mortgage debit in `transaction_lines` plus `Loan.monthlyPayment`; **no discriminator exists**, unlike `recurringId`. | `recurringId` exclusion closes the recurring half (both collections); certain layer rendered **itemised by name** plus an explicit caveat with its own glossary entry. Fuzzy matching deferred to Stage 8 **by name**. | T5 / Stage 8 |
| **R2** | The `period`/`ownerId` write-path change touches guarded files, and **the guard has a `scripts/` blind spot** it cannot see past. | The tautological count assertion is **deleted**; a `scripts/`-scoped both-fields assertion replaces it; the blind spot is recorded in the guard's own header; HITL/watermark/audit suites re-run by name. | T3 |
| **R3** | **No `firestore.indexes.json` exists.** Every new composite query works on the emulator and fails on first cloud deploy, invisible locally — the Stage 6 CSP class. | Index file created and wired in T3; verification an explicit Stage 11 cutover step. | T3 / Stage 11 |
| **R4** | A forecast read as a whole-family picture when inputs are missing — the most dangerous misread in the stage. | **D17 at the hook, presence-driven**, mutation-tested; `<ScopeBadge>`; a sentence naming what is missing; the `'own'` card in its own panel with an explicit prefix. | T7a |
| **R5** | The instalment `planKey` heuristic mis-groups two same-vendor plans — there is no plan id in the data. | Limitation in the guard comment **and** the hover copy (a glossary entry, since `Explain` renders nothing without one); a colliding-plans fixture in T4's generator is a permanent test documenting the known-wrong output. | T1 / T4 |
| **R6** | **A half-done backfill** produces a moving average over a fraction of the corpus rendered at full confidence — and **neither `'unknown'` nor `unusableRowCount` can see it**, because an untouched row has no `period` field and the query never returns it. | The completion marker is a **hard refusal**, not a caveat (D21d). Mutation-tested: removing the refusal must fail a test naming the partial average. | T3 / T5 |
| **R7** | Hebrew goal-date parsing silently drops goals ⇒ a quietly wrong target line. | Unparseable goals **counted and displayed**; parser has its own suite with malformed fixtures. | T6 |
| **R8** | **`period: 'unknown'` and `unusableRowCount` are shadowed by construction** — the real corpus has zero unparseable rows and Rules make new ones nearly impossible (finding 1.2.2). A guard over an empty class is decorative. | T4's generator **must** emit unparseable rows, asserted by a presence test; T0 records the real rate so the shadowing is a stated fact rather than a surprise. | T0 / T4 |
| **R9** | New predicates are **shadowed by construction** — empty corpora make them vacuous, exactly as happened twelve times in Stage 6. | Stub-first with synthetic inputs before the first green run, no exceptions; T4's real corpus behind that; each neutered in T8's sweep. | every task |
| **R10** | `'forecast'` ModuleId expands the permission surface; a fail-open default would be silent. **And the `functions/` mirror drifts silently today.** | Fail-closed default asserted; rules matrix includes a full-matrix `'member'` proving the gate is role-driven; **the missing `ModuleId`-equality contract assertion is added** (finding 1.2.5). | T2 |
| **R11** | **Offline.** Multi-tab persistence is enabled and the word "offline" appears in no ledger, Stages 2–6. `runTransaction` cannot execute against the offline cache, so assumption CRUD **hangs rather than queueing** (`financeCollections.ts:165`); and the cache **can** serve a period query from a partially-cached ledger, producing a silently incomplete average — R6's failure mode by a route R6 does not cover. | **Named as a risk, not closed.** Assumption CRUD gets an explicit timeout with a "אין חיבור — השינוי לא נשמר" state rather than an indefinite spinner. The partially-cached-query hazard is **recorded and deferred to Stage 11 by name**; Stage 7 does not have a defensible fix, and inventing one would be worse than naming it. | T7a / Stage 11 |
| **R12** | **Copy person.** ~27 new strings, and the whole tree is masculine-singular second person. Getting it wrong at this volume sets the convention. | D34: avoid second person entirely; a guard over the new copy modules with a stated limitation (§12); **flagged to David** before the copy is written, not after. | every task |

---

## 10. Stage-7 done criteria — functional

- [ ] Three layers compose with correct precedence; every number's layer and basis visible on hover; **`layer` derived, never stored**.
- [ ] **`projectedBalance` is defined, sourced from `accounts`, and carries its own staleness state** (D16).
- [ ] **`projectedBalance` is `null` whenever any balance-contributing input is not `'ok'`**, with the gap named and deep-linked (D17, D26).
- [ ] Month-by-month projection over any range, default 3, responding to מי/מה, anchored by מתי with the **forward clamp stated on the card**, horizon locally controlled.
- [ ] **The certain layer is non-empty in future months** — the direct A9 regression.
- [ ] All five cold-start states reachable and correct against T4's corpus; **zero history renders D40's off-scale marker, never ₪0**.
- [ ] "מה צריך לקרות" **leads with named categories**, **refuses** rather than emitting negatives, and ships **with the advice-boundary notice**.
- [ ] A `personalTarget` gives an `'own'` viewer an answer rather than a refusal.
- [ ] Seasonality is an assumption; the September/April factors are **offered and one-click editable** on day one.
- [ ] Forecast always on the Dashboard; opens to a full screen; both driven by **one** computation source; **the fake `תחזיות AI לעתיד` panel is gone**.
- [ ] `forecast_assumptions` CRUD works, overrides both statistical and certain items with distinct disclosures, is **Rules-gated to `source: 'user'`**, validates authorship against the scope's module, and **triggers a recompute** (D35).

## 11. Stage-7 done criteria — glossary

**A25 rules that 17 is a floor, not a target.** The real number is larger, and this plan names **27**. Two of v1's seventeen are **cut** as duplicates rather than reworded: `forecast.loanRepayments` reuses `loans.rowMonthlyPayment` and `forecast.insurancePremiums` reuses `insurances.rowPremium` — **either reuse the ids or make the difference the entire content of a new entry**, and there is no difference worth an entry. `forecast.savedSnapshot` is cut with D28.

`forecast.projectedBalance` · `forecast.openingBalance` · `forecast.balanceAsOf` · `forecast.certainTotal` · `forecast.estimatedTotal` · `forecast.bandHigh` · `forecast.bandMid` · `forecast.bandLow` · `forecast.monthIncome` · `forecast.monthExpense` · `forecast.historyDepth` · `forecast.monthConfidence` · `forecast.horizon` · `forecast.anchorClamp` · `forecast.seasonalAdjustment` · `forecast.installmentsCommitted` · `forecast.installmentPlanKey` · `forecast.doubleCountCaveat` · `forecast.categoryAllowance` · `forecast.shortfall` · `forecast.unreachableTarget` · `forecast.targetSource` · `forecast.personalTarget` · `forecast.assumptionOverride` · `forecast.balanceSuppressed` · `forecast.unusableRows` · `forecast.gapNoHistory`

- [ ] **`forecast.band` is split into its three phrases** (A25) — one entry cannot define "הכי יקר שהיה", "האמצע" and "הכי זול שהיה".
- [ ] `forecast.installmentPlanKey` and `forecast.doubleCountCaveat` exist **because D10 and D23 promise hover copy, and in this app hover copy IS a glossary entry** — `Explain` renders nothing for an unknown id.
- [ ] `forecast.assumptionOverride` ships **only if D19's `resolveCategoryOfScope` mapping is built**; if the override case is cut, the entry is cut with it. An entry describing an unreachable capability is B4.
- [ ] `forecast.adviceBoundary` is **not** a glossary entry — it is permanent on-screen text per §9, not hover copy. Stated so nobody adds a 28th by reflex.
- [ ] Every entry passes `violatesPlainLanguage`. **Authoring note: it does not split on a Hebrew colon (`׃` is handled, `:` is not)** — a two-clause sentence joined by `:` counts as one and can blow the 22-word cap.
- [ ] **No entry contains `תזרים` or probability language**, including `שמרן`/`צפוי`/`אופטימי` as bare labels.
- [ ] **No entry describes insight-sourced assumptions** (A16).
- [ ] **Count re-derived against `glossary.ts` at HEAD in T8** — 25 at plan time, expected 52. **The number is re-run, never quoted**, and this list is the minimum.

## 12. Guards — what makes each able to fail, and where its data comes from

v1 shipped an assertion that could not move and promised a figure its own query filtered out. Every guard below states its failure mode and its corpus. **A guard whose "able to fail" column is empty is deleted, not shipped.**

| Guard | What makes it able to fail | Corpus |
|---|---|---|
| **Shuffle-invariance** (D20) | Two assumptions colliding on one (period, category) with different `updatedAt` — synthetic in T1, **real in T4's generator** (two members, same category, same month). | T1 synthetic + T4 corpus |
| **Forward projector ≠ catch-up** (D22) | A recurring item whose `startDate` is in the past and horizon in the future. `computeDuePeriods` returns `[]` there; the test asserts the projector does not. | T1 fixture |
| **`recurringId` exclusion** (D23) | T4 emits recurring-posted rows **and** manual rows in the same category and month, so removing the exclusion changes a number rather than a count. | T4 corpus |
| **`isExpenseRow` not `isExpenseListRow`** (D23a) | T4 emits a `paymentType: 'refund'` credit row — the **only** row where the two predicates differ. Without it the mutation is undetectable. | T4 corpus |
| **Completion-marker refusal** (D21d) | A corpus with the marker absent and rows present. Distinct from "no rows", which is D26 row 0. | T4 corpus, marker deleted |
| **`scripts/` both-fields assertion** (D21e) | Adding a `scripts/` file that writes `transaction_lines` with `period` only. **This can move**, unlike v1's count assertion, which could not. | AST over `scripts/` |
| **`period`/`ownerId` immutability** | An emulator update mutating `period` on an existing row. Rules-level, so a mocked suite cannot see it. | T3 emulator |
| **`source == 'user'` Rules floor** (D25b) | An emulator write with `source: 'insight'` from a client token. | T2 emulator |
| **Authorship-by-module** (D25c) | A session with `forecast: family` and `loans: none` writing a `scopeKind: 'loan'` assumption. | T2 emulator |
| **No-probability-language** (A39) | **v1's version ran over a corpus the same agent authors — the `BANNED_JARGON` shape, counted 4 times in this repo.** Fixed two ways: the corpus is widened from glossary entries to **every string literal in the forecast copy and component modules** (AST-derived, `stripComments`), and **`שמרן` / `צפוי` / `אופטימי` are added to the denylist** — §10's own words, which are probability language to a lay reader. Without both, the guard is decorative. | forecast copy + components |
| **No-month-literal** (A39) | **v1's version scanned one hardcoded file and banned integer literals — while D7's own shape used string keys `'01'..'12'`, which passed cleanly.** Fixed: derived from the import graph; bans integers 1..12, the string forms, and the Hebrew month names, in logic modules only. | import graph |
| **No `₪0`** (A39) | **v1 scoped it to a branch that emits no symbols — it could not fail.** Re-scoped to the two branches that *will* render a misleading ₪0: an n=1 category whose single observation was ₪0, and the empty certain layer from A9. T4 generates both. Cheap-for-expensive: the test asserts the *specific* renderer emits no `₪0`, not that the page contains none. | T4 corpus |
| **~~Allow-list-is-4~~** | **Deleted.** Both write paths are already on the list, so the count cannot move (A8). Replaced by the `scripts/` assertion above. | — |
| **Explain coverage** | A new ₪ figure added to a forecast surface with no `<Explain>`. Derived **from the rendered DOM with a canary**, so a figure added tomorrow is covered. A hardcoded testid list would not fail. | rendered DOM |
| **Render-presence, not source-presence** | `{SHOW_NOTICE ? <Notice/> : null}` — source-presence passes, render-presence does not. | rendered DOM |
| **Import-graph purity** (D37) | Adding `new Date()` or a `firebase/*` import to `forecast.ts` or anything in its closure. | transitive closure |
| **Second person** (D34) | **Honest limitation, stated:** it catches the explicit forms (`אתה`, `שלך`, imperative `תבדוק`-shaped verbs) and **cannot** catch a masculine-singular verb form with no pronoun. It is a floor, like `plainLanguage.ts`, not the whole standard — the cold-reader check is the rest. | new copy modules |

## 13. Displayed figures — source and null-ability

Every figure the screen renders, where it comes from, and whether it can be absent. **A figure with no source column does not ship.**

| Figure | Source | `null` when | What would make it wrong |
|---|---|---|---|
| `projectedBalance` | `openingBalance + Σincome − Σexpense` (D16) | **any** balance input not `'ok'` (D17) | a stale `openingBalance` — hence D16's `staleness`, rendered |
| `openingBalance` | `Σ accounts.balance` | `accounts` empty or unreadable | last update date; shown in words |
| `certainILS` per month | forward projector (D22) | never — `0` is a real value here | the loan/insurance double count (R1), disclosed itemised |
| `estimatedILS` per month | moving average over `isExpenseRow` non-`recurringId` rows | `monthsObserved === 0` ⇒ **D40 marker, not a number** | a half-done backfill (R6) — hence the refusal |
| band high/mid/low | `max`/`median`/`min` of monthly totals | `monthsObserved < 3` (D3) | fewer than 3 months; not drawn |
| `monthConfidence` | weakest `monthsObserved` **+** committed share (D41) | row 0 | — |
| `unusableRowCount` | `period == 'unknown'` rows **returned by the same fetch** (D21c) | never; `0` is real and expected | **it cannot see unstamped rows** (R6) — the marker covers that, not this |
| orphaned-owner count | rows stamped `ownerId: 'unknown'` in T3 | never | a member renamed after the backfill; D21a's additive rule keeps them readable |
| `categoryAllowance` | `statisticalProjection − shortfall × share` | no readable target (D29c) | unparseable goals — counted and shown |
| `shortfall` | target − projected | no target | which target source; named |
| calibration error | `|projected − actual| / actual` from `forecast_calibration` | **always, in Stage 7** (D28) | nothing — it is structurally unavailable until a month has elapsed, and the screen says so |

## 14. Stage-7 done criteria — product-metric acceptance and method gates

**Product-metric acceptance — acceptance criteria, not unit tests**
- [ ] **Cold-reader glossary check** against the running app. **FAIL is a legitimate outcome that blocks the stage**, as it was in Stage 6.
- [ ] **5-second glance:** answers "are we going to be OK?" in under 5 seconds, checked against all four Stage 6 glance defects **and the fifth — a glance-scale number** — with D38's deliberate subordination to net worth stated as the intended hierarchy, not an oversight.
- [ ] **Honesty:** every ₪ figure is either certain or visibly marked estimated; enumerated by the reviewer **from the rendered DOM**.
- [ ] **Assumptions authored by David: count.** **Zero means the refine loop failed** (A29) — it is the metric, not a nice-to-have.
- [ ] **Was the full screen ever opened** during the demo walkthrough. A Dashboard card nobody drills into is a card, not a forecast.
- [ ] **20-member readability**, verified with T4's `--members=20` corpus. **Kept as a cheap regression and explicitly NOT read as a Stage 7 signal** (A29) — this screen is month × category, so the metric is near-vacuous here. Said out loud rather than reported as a pass.
- [ ] **Calibration is NOT a Stage 7 acceptance measure** (D28) — the plumbing ships, the number cannot exist yet, and the screen says so. See §15.
- [ ] **Recorded, not hidden:** the glance is a visual judgment and there is **no browser verification in this project**. Flagged for David in the words Stage 6 used: *"I can conclude what the code instructs the browser to draw; I cannot conclude the hierarchy works on a phone in Hebrew."* §5's five decisions exist so that gap is narrowed on paper rather than deferred to a screenshot nobody can take.

**Method gates**
- [ ] `test:all` green, counts **re-run**, `.env`/`.env.local` present (5 files fail to *collect* without them while vitest prints a plausible number).
- [ ] Adversarial mutation sweep complete; survivors fixed or argued.
- [ ] **Every new predicate provably unshadowed** — including the four A39 guards and, specifically, the `period: 'unknown'` path, which is shadowed on the real corpus (R8).
- [ ] Emulator proof recorded for **T0, T2, T3, T4, T8** and T6's one step; **explicitly stated where it was NOT needed and why** — T1, T5, T7a, T7b, T7c.
- [ ] Demo walked by running, isolated project id, **David's `.emulator-data` untouched**.
- [ ] **One measured performance number recorded** (D33).

## 15. Where I disagree with the adjudication

The rulings are binding and all 41 are implemented. Three deserve an argument on the record, because a plan that silently implements a bad ruling is worse than one that argues.

**1. A38's stated reason is factually wrong about `computeDuePeriods`.** A38 says "`computeDuePeriods` does `Date` arithmetic, so T2's 'reuse it' contradicts the constraint". It does not. `recurringCatchup.ts`'s header states, and the code confirms, that **all comparisons and arithmetic operate on `'YYYY-MM'` strings and plain integers — never `new Date(dateString)`, never adding to a Date object**; the single `Date` it touches is `today`, read via local getters. The *conclusion* — restate mirrorability as an import-graph guard — is right and is implemented as D37. But the reason is wrong, and the real reasons are different and worth stating correctly: `netWorth.ts:69` calls `new Date()`, and `computeDuePeriods` **takes a `Date` parameter**. D37 bans the parameter, not phantom arithmetic. Implementing A38 with its stated reason would have produced a guard hunting for something that is not there.

**2. A29's calibration cannot be a Stage 7 acceptance measure, and listing it as one repeats the defect the gate rejected.** `|projected − actual| / actual` "per elapsed month" requires a stored projection for a month that has since elapsed. A27 cuts `forecasts`; A29 keeps a month-close snapshot. Fine — but the first snapshot is written at the first month-close *after this stage ships*, and the first error figure exists a month after that. **There is no month in Stage 7 for which both a projection and an actual exist.** A Stage 7 done-criterion reading "calibration error is displayed" would be a promised number the screen cannot compute — precisely the `unusableRowCount` defect. **D28 therefore ships the write path and a designed empty state, and §14 states explicitly that calibration is not a Stage 7 signal.** The other two A29 measures (assumptions authored, full screen opened) are real Stage 7 signals and are kept as such.

**3. A30's `personalTarget` does not land unless the default `forecast` grant is decided, and neither document decides it.** A15 rules `permissionModuleId: null`, so every member sees the tab. CRUD is gated on `forecast.edit`. But a `member` role's default `forecast` level is `'none'` (`resolveOwnedModuleScope`'s fail-closed default) — so **the child A30 exists to serve can see the screen and cannot author their own target**, and the `'own'` screen reverts to exactly the refusal A30 set out to remove. **Ruling, stated here because it has to be somewhere:** a `personalTarget` assumption whose `ownerId` is the author's own memberId is authorized by the **existing owned-module pattern**, not by a `forecast` grant — `allow create: if request.resource.data.scopeKind == 'personalTarget' && request.resource.data.ownerId == memberId()`, in the same block, as a conditional. A member can always set a target for themselves. Every other `scopeKind` needs `forecast.edit` plus D25(c)'s authorship check. Without this, A30 is an enum value that changes nothing.

**Two smaller notes, implemented as ruled but worth flagging.** A19's five card elements fight A3's "the glance position always holds a number"; D38 keeps all five *pieces of information* but carries the certain/estimated split on the bar rather than as a fifth line of card text, and says so. And A21 and A22 describe **different months** — A21 the zero-history bar, A22 the normal one — which is only coherent once someone draws the line; D39/D40 draw it at `monthsObserved === 0`.

## 16. What this stage explicitly does NOT do

| Deferred | Owner | Reason |
|---|---|---|
| Insight generation, refine loop, `source: 'insight'` writes | **Stage 8** | Stage 7 builds the assumption *input* seam and **enforces it in Rules** (D25b). The renderer is cut, not stubbed. |
| Saved forecast snapshots, restore, `forecasts` collection | **Stage 8** | D28/A27 — its only consumer is the stage that knows what shape it needs. Returns **by value**, not by id. |
| **Reading the calibration number** | **Stage 8** | D28 — structurally unavailable until a month has elapsed. Plumbing and empty state ship here. |
| Fuzzy matching a bank row to a loan/insurance (R1's double count) | **Stage 8** | A duplicate-detection insight (§9), not forecast arithmetic. **Disclosed on screen here.** |
| Forecast facts reaching the AI chat context | **Stage 9** | `buildFinancialContext` is pinned by five egress-guard layers plus a human sign-off gate. `reasonHe` is **pre-registered as excluded** (D25c). |
| **`incomes` has no service layer, no owner field, no `MODULE_REGISTRY` tab, and no screen** | **Stage 11** | Named here (A41) so it is not discovered inside a task. The income half of the forecast reads it directly, as the Dashboard already does. |
| **`incomes.date` disagreeing with `incomes.month`/`year`** | **Stage 11** | Finding 1.2.4. D23 sidesteps it by stamping `period` from `month`/`year`; the underlying divergence is real and is not Stage 7's to fix. |
| Normalizing `transaction_lines.date` | **Stage 11** | Stage 5 D9 assigned it; T3's additive `period` is the minimal unblock. |
| **`violatesPlainLanguage`'s corpus never reading rendered strings** | **Stage 11** | D30/A24's meta-finding. Stage 7 widens it for the *forecast* modules only (§12) and does not retrofit the tree. |
| **Comparison mode (§5.4, "לכל מסך")** | **Stage 11** | A32 — this would be the sixth screen to skip it. **Named rather than dropped silently.** |
| **Offline: partially-cached period queries** | **Stage 11** | R11 — Stage 7 has no defensible fix, and inventing one would be worse than naming it. The CRUD-hang half **is** handled here. |
| Retrofitting second-person Hebrew across the existing tree | **Stage 11** | D34 — Stage 7's job is not to add ~27 more, not to fix what is there. |
| `vitest.config.ts:32`'s `'@'` alias | **Stage 11** | A40 — real, but **zero non-test files import `@/…`**. Deprioritised, not closed. |
| Deleting `settings/ecosystem`'s orphaned fields | **Stage 11** | Already a roadmap done-criteria line. |
| Server-side / scheduled forecast computation | **Stage 8, if needed** | D37's revisit trigger: **build the tsup/esbuild share step**, per `functions/src/shared/permissions.ts`'s own written instruction. Not a file move. |
| A tour script for the forecast | **Stage 10** | `data-tour-id`s ship here so Stage 10 writes a script, not markup. |
| Real-estate freshness, `investments` per-doc `asOf` | **Stage 11** | Pre-existing glossary items flagged to David. |
| A quick manual-entry screen (§11) | **Stage 11** | Already assigned by name. |

## 17. Stage 6 inheritance — disposition by name

**Closed by this stage:**
1. `buildFinancialContext.ts:56-58` money coercion — **T8** via shared `readMoneyAmount` (moved from v1's T2, where a `functions/` edit sat inside a task labelled "live-emulator NOT required").
2. No shared money formatter — **T7b**, `formatILS` → `src/config/money.ts`.
3. The extraction-notice guard is source-presence not render-presence — **T7c**, closed here *because* Stage 7 adds no extraction surface: no pressure to weaken it to fit new code.
4. `isValidAuditEntry` requires `at is string` while both server writers use `serverTimestamp()` — **T2**.
5. The untracked `docs/superpowers/glossary-review-2026-08-17.md` — **T8** decides its home.

**Dropped — already closed (A40):** ~~`.gitignore` trailing-slash + `functions/.gitignore` disagreement~~. **Both files already read `node_modules` with no slash at HEAD**, each carrying a comment explaining the worktree-symlink hazard. v1 committed the exact "findings age the moment a fix lands" error **inside the plan that warns about it**, and v2 does not repeat it.

**Deprioritised (A40):** `vitest.config.ts:32`'s `'@'` alias — real, but zero non-test files import `@/…`. Stage 11.

**Knowingly carried:**
1. R-3(b) parent/child prop seam — full closure needs real inter-component dataflow; **carried not because it is small but because a half-attempt produces a guard whose comment over-claims.**
2. The stored model preference vs. the notice — a product decision first; no Stage 7 task opens those files.
3. `claude-opus-5` unreachable — **carried to Stage 8 by name**, the stage that requests `'insight'`.
4. Extraction compare-two-models unsatisfiable — chat-only, unaffected.
5. `useAiModels('extraction')` duplicated across four surfaces — Stage 7 opens none of them.
6. Icon contrast at 2.40:1 — Stage 11.
7. Pricing UNVERIFIED; rotate the Gemini key; set a ceiling before the first import — **David actions**, restated in T8's demo.
8. `aiDisclosure.ts` human sign-off gate — standing; Stage 7 does not touch it.
9. The intermittent `AiSettingsScreen` failure — diagnosed three times as machine load; **no action, and no one should "fix" it.**
10. The irreducible semantic residual — applies to this stage's 27 new entries, which is why the cold-reader check is an acceptance criterion.

## 18. Underspecified or internally inconsistent in the spec — reported, not worked around

1. §10's own word for the deliverable, `תזרים`, is banned by the app's plain-language floor — **and the app already says it on the Dashboard.** D30; David's call.
2. §10 names "שמרן / צפוי / אופטימי" without defining any of the three. **These three words are themselves probability language to a lay reader** and go on the denylist (A39). D3 is a call, not a reading.
3. §10's seasonality examples are hardcoded factual claims about one family. D24 turns them into offered, editable assumptions — **and the plan decides that rather than asking David to re-approve his own sentences.**
4. §7's `forecasts` has no stated trigger. **D28 cuts it**; the shape belongs to its only consumer, Stage 8.
5. §10.3 says assumptions override "the statistics"; §9 says they affect "the forecast". Silent on overriding a *certain* item — the most valuable case. D19 rules yes, with a louder disclosure **and the scopeId→category mapping that makes it reachable**.
6. §10 says the forecast responds "פר-בן-משפחה או משפחתית" but never says what a per-member forecast means when income and goals are ownerless by §7. D17 + D29(c)(d).
7. §10's "יעד" is undefined — `budgetConfig` and `goals` are different things with different owners, different gates, and in one case an unparseable date. **And neither gives a member a target of their own** — D29's `personalTarget` is the third source the spec needs and does not name.
8. §5.3 says מתי affects everything "כולל התחזית", but a *past* month selection is undefined for a forward-looking screen. D32(a).
9. §6 lists "תחזית" as a module while a screen labelled "תכנון עתידי" already exists — **and that screen already renders a panel headed `תחזיות AI לעתיד` containing no forecast at all.** D31.
10. §3's "always shown" collides with §5.7's "a failed read is never shown as no data". D17 reconciles by changing *what* is always shown, and D26 makes the empty case a path.
11. §7 says `recurring` feeds the forecast, but the recurring engine posts into **both** `transaction_lines` and `incomes`, which the statistical layer reads. The double count is never addressed, and the loan/insurance case has no discriminator at all. D23, R1.
12. `goals` is ownerless and its `date` is a Hebrew month string, yet the spec assumes goals are usable as targets. **A data-model gap masquerading as a requirement.** D29(c).
13. §4 scenario 6 promises a child sees "היעדים שלו" — **which §7's ownerless `goals` makes impossible.** D29(c)'s `personalTarget` is the fix, and §15(3) rules how it is authorized.
14. §9 pins the advice-boundary notice to the insights screen, but **this stage ships the first thing that tells a family what to do with money.** D29(e) brings the notice forward.
15. §5.2 requires plain language, and `violatesPlainLanguage` has **never read a rendered string in the app** — only glossary entries. The floor has been measuring the wrong surface for six stages. D30's meta-finding.

## 19. Questions for David

**Two that need him:**
1. **`תזרים`** — the app already says it at `Dashboard.tsx:648`. Drop the ban, or fix the screen? **Recommendation: fix the screen** (D30). The ban has held `plainLanguage.ts` unmodified through six stages, and weakening a floor so new copy can pass it is backwards.
2. **Second person in Hebrew copy** — every string in v1 and much of the tree is masculine-singular second person, in a product for up to 20 people including women and girls. **The cheap rule is to avoid second person entirely** (D34), and Stage 7 is the largest copy drop in the project, so the convention gets set here either way. Confirm before the ~27 strings are written, not after.

**One that goes to him as information, not a decision — and it is the one that determines whether this stage is worth anything on day one:**
3. **Will the certain-layer inputs — `recurring`, `loans`, `insurances`, `incomes`, `accounts` — be entered before the demo?** All five are **empty** at HEAD, and `transaction_lines` holds **3 rows, all March 2026**. D26's row 0 and D27's generator mean the screen is honest and demonstrable regardless. But **no amount of statistical honesty substitutes for the data**, and the stage's entire day-one value is in it.

**One the plan decides, and does not ask (A31):** whether the September/April seasonality factors ship as offered defaults. **They do** — offered, pre-filled, one-click-accept, attributed and editable. They are David's own sentences about his own family in §10; asking him to re-approve his own spec is deference theatre.
