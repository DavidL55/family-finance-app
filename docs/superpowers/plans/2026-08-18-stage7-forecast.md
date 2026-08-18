# FamilyFinance v2 — Stage 7: Forecast Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax.

> **Not yet reviewed.** This plan goes through the four-lens adversarial gate (UX/Ofra, Product/Lola, Architecture/Sun, What-Did-We-Miss) before Task 1 begins. It is written to be attacked: every decision names its rejected alternatives and the evidence behind the choice, so a reviewer can falsify a specific claim rather than disagree with a vibe.

**Baseline:** branch `familyfinance-v2`, HEAD `032d169`, `test:all` = 1901 (1316 root/80 files + 37 build/1 + 328 functions/13 + 220 rules/8). Stage 6 ledger: `.superpowers/sdd/2026-08-17-stage6-ai-provider-layer/progress.md`.

**Goal:** answer spec §10's question — *"מה צפוי לקרות בתקופה שבחרתי, ומה צריך לקרות כדי לעמוד ביעדים?"* — with three composed computation layers, per-number provenance visible on hover, an uncertainty representation that is honest rather than decorative, and an explicit cold-start behaviour for a family that does not yet have the history the statistical layer needs.

**The one sentence that governs this stage:** *this is the first thing in the app that states something about the future, and a forecast that looks authoritative and is wrong is worse than no forecast.* Every decision below is tested against that sentence, not against feature completeness.

---

## Verify-don't-assume findings (read against the tree at `032d169`)

These are load-bearing. Several invalidate the obvious implementation.

1. **`transaction_lines.date` has no single sortable format, so a date-range query is impossible today.** `src/utils/migrateLegacyTransaction.ts:33` spreads the legacy doc verbatim and never touches `date`. `src/utils/transactionFilters.ts:31-57` exists specifically because the collection holds both `YYYY-MM-DD` and `DD/MM/YYYY`, possibly unpadded (`"9/3/2026"`). Stage 5's D9 named normalization as the real prerequisite and explicitly did not do it. **The statistical layer cannot issue `where('date','>=',…)`.** Task 1.

2. **The only existing `transaction_lines` reader issues an unconstrained scan, denied wholesale for an `'own'`-level viewer.** `Dashboard.tsx:288` and `:365` both do `getDocs(collection(db,'transaction_lines'))`. `firestore.rules:26-30`'s `expensesAllowed` gates `'own'` on `data.owner == myMember().name`; Firestore cannot statically verify an unconstrained list against a `resource.data` condition, so it denies the whole query. Identical to the bug Stage 5's D1 fixed for the owned collections — still live on the expenses path.

3. **`transaction_lines.owner` is a display NAME; every Stage 3 collection uses `ownerId`.** `firestore.rules:26-30` vs `:40-42`. `RecurringService.ts:214-217` resolves `nameByMemberId` and throws when it cannot. The forecast joins across both conventions in one number.

4. **`incomes` and `goals` are OWNERLESS modules — `'own'` grants nothing.** `src/types/permissions.ts:21`, enforced by `firestore.rules:32-34`. A child with `income: 'own'` sees **zero** income rows. This makes D5 non-negotiable.

5. **`settings/budgetConfig` is super-admin/parent only** (`firestore.rules:296-298`). A `'member'` viewer cannot read the per-category budget, so "what needs to happen" has no target for them from that source.

6. **`goals.date` is a Hebrew month-name string.** `FuturePlanning.tsx:113` writes `` `${goalMonth} ${goalYear}` `` from a 12-element Hebrew array at `:24-27` — e.g. `"דצמבר 2026"`. Unsortable, unparseable without that array.

7. **The recurring engine posts INTO `transaction_lines`**, stamping `recurringId` and `recurringPeriod` (`RecurringService.ts:218-228`). A recurring item exists both as a future-facing definition (certain layer) and as historical rows (statistical input). `recurringId` is a reliable discriminator. **Loans and insurances have no such discriminator** — see R1.

8. **`transaction_lines` already carries `installmentNumber` / `totalInstallments`** (`FileProcessor.ts:560-561`), and `amount` is documented as "charge amount (always positive)" per line. **Assert this against a real fixture, do not assume** (T2 step 1).

9. **`'תזרים'` is on `BANNED_JARGON`** (`plainLanguage.ts:13`) — the exact word spec §10 uses for this stage's headline deliverable. See D13.

10. **There is no `firestore.indexes.json`, and `firebase.json` declares no `firestore.indexes` key.** Every composite query this stage introduces works on the emulator and fails on first cloud deploy with nothing in our code raising. See R3.

11. **No `forecasts` match block exists in `firestore.rules`** (spec §7 lists the collection). Firestore default-denies; there is no catch-all wildcard. Same class as Stage 5's `documents` finding.

12. **There is no `'forecast'` `ModuleId`** (`permissions.ts:9-16`) and no `MODULE_REGISTRY` entry. Additive work with real blast radius (matrix UI, `resolvePermissions`, rules tests).

13. **A screen labelled "תכנון עתידי" already exists** (`FuturePlanning.tsx`, registry id `'future'`, ungated) and is a savings-**goals** CRUD screen, not a forecast. See D15.

14. **`vitest.config.ts:32` still aliases `'@'` to the repo root**, while `vite.config.ts` and `tsconfig.json` were both repointed at `src/` in `0acd59b`. Named as a Stage 7 carry in the ledger. Closed in T1.

---

## Design decisions

### D1 — The forecast computes in a **pure client util** (`src/utils/forecast.ts`) consumed by a `useForecast` hook. Not a Cloud Function.

Chosen because it reproduces the pattern this project already proved: `netWorth.ts` is a pure function over arrays the caller already fetched (and which Rules therefore already filtered), returning line items carrying `source` and `asOf` — the provenance hover-explain needs — with `useNetWorth` owning I/O and `useScopedRead` owning the four-state machine.

**Rejected — a Cloud Function:** it would re-derive the viewer's permission scope server-side, precisely the defect both Stage 6 lenses rejected (a second, un-mirrored authorization path beside a mirrored leaf function). `functions/src/shared/permissions.ts` deliberately mirrors only pure stateless helpers. It also puts a round-trip on every filter change on the one screen §3 requires to answer in under 5 seconds, and has **no AI dependency** — Stage 6's architecture lens cleared this explicitly.

**Rejected — persisting a materialized forecast:** see D9.

**Revisit trigger, recorded now:** the day Stage 8's scheduled insight engine needs the same computation server-side. To make that a *move* rather than a rewrite, `forecast.ts` is constrained to `netWorth.ts`'s contract exactly — **no Firebase imports, no permission logic, no `Date` arithmetic on parsed strings, every input passed in already-fetched.** A reviewer should check T2 against that constraint literally.

### D2 — Layer composition is a per-(month × category) **precedence resolution**; provenance is a discriminated union, never free text.

```ts
export type ForecastBasis =
  | { kind: 'recurring'; recurringId: string; description: string; chargeDay: number }
  | { kind: 'loan'; loanId: string; name: string }
  | { kind: 'insurance'; insuranceId: string; provider: string }
  | { kind: 'installment'; planKey: string; observedNumber: number; totalInstallments: number }
  | { kind: 'movingAverage'; monthsObserved: number; periods: string[]; seasonalFactor: number | null }
  | { kind: 'assumption'; assumptionId: string; source: 'user' | 'insight'; overrides: ForecastBasis | null };

export type ForecastLayer = 'certain' | 'statistical' | 'assumption';

export interface ForecastLineItem {
  period: string;            // 'YYYY-MM'
  categoryId: string;
  direction: 'income' | 'expense';
  amountILS: number;
  layer: ForecastLayer;
  basis: ForecastBasis;      // layer is derivable from basis.kind — asserted by a test, not a comment
}
```

**Precedence: `assumption` > `certain` > `statistical`**, resolved per (period, category) by a named exported predicate `resolveLayerPrecedence`, written **stub-first with synthetic inputs before the first green run** — on today's tree the assumptions collection is empty, so any predicate over it is *shadowed by construction*.

**A ruling the spec is silent on:** an assumption **may override a certain item**, not only a statistical one. §10.3 says assumptions beat statistics; §9 says a corrected assumption affects the forecast, and the canonical §4.4 scenario is correcting a *known* fact. A user who knows rent rises to ₪6,000 in October is the most valuable assumption in the system. **But it is disclosed differently:** the overridden basis is retained in `basis.overrides`, and the hover reads "אתה שינית סכום שכבר סגור" with both numbers. Overriding a statistical item gets the quieter "אתה קבעת את הסכום הזה במקום ההערכה".

`layer` is derivable from `basis.kind`. It is stored anyway *and pinned by a test that fails if the two disagree* — redundancy is only legitimate when a test holds it.

### D3 — The uncertainty band is the **observed monthly range of the family's own history**, not a symmetric multiplier. Most of it is theatre if built the obvious way — said out loud.

**"Conservative / expected / optimistic" as commonly built is theatre.** Three lines from ×0.85 / ×1.0 / ×1.15 encode no information: the multiplier is invented, the width is constant regardless of that category's actual volatility, and the fan visually implies a probability interval nothing supports. **This plan does not build that, and a reviewer should reject any implementation that quietly does.**

- **The certain layer has no band.** A loan repayment, an insurance premium and a committed instalment are contractual. Single solid value. Widening them manufactures uncertainty that does not exist.
- **The band belongs only to the statistical layer**, width derived from that category's **own observed dispersion**: `min` / `median` / `max` of monthly totals across the lookback window. `conservative = Σ max`, `expected = Σ median`, `optimistic = Σ min`. Computable from rows the moving average already reads, and it **degenerates visibly** when history is thin — which is the point.
- **Band basis is carried and rendered:** `bandBasis: 'observed-range' | 'insufficient-history' | 'assumption-fixed'`. Below `monthsObserved = 3` the band is **not drawn**, and the screen says so in words. An assumption-set amount gets no band — the user asserted a number; we do not add error bars to their assertion.
- **No probability language, ever.** Copy is "הכי יקר שהיה" / "הכי זול שהיה" / "האמצע", never "80% ביטחון". A guard asserts no forecast string contains confidence-percentage phrasing or `סביר ש` / `הסתברות`.
- **The primary uncertainty display is not the band — it is the certain/estimated split.** Every month renders `certainILS` and `estimatedILS` as two separately-labelled components of one bar (solid vs. hatched), so the reader sees at a glance how much of the number is actually known. A month that is 90% estimated and one that is 90% committed must not look alike.
- **Uncertainty must grow with distance.** Month 3 is strictly more estimated than month 1; the hatched proportion and band width are per-month, never horizon-wide. Pinned by a fixture where month 1 is fully certain and month 3 fully statistical.

**Rejected:** symmetric multipliers (theatre); sample standard deviation (`mean ± 1σ` is defensible at n≥12 and meaningless at n=3–6, which is the entire range §10 specifies — a statistic outside its validity window is the same lie in respectable clothing); Monte Carlo (no distributional model to sample, and unexplainable on hover, violating §5.2 outright).

### D4 — Assumptions live in a new **`forecast_assumptions`** collection, owned by `ownerId`, with a `source` discriminant that is the Stage 8 seam.

```ts
export interface ForecastAssumption extends OwnedRecord {
  scopeKind: 'category' | 'recurring' | 'loan' | 'insurance';
  scopeId: string;
  fromPeriod: string;               // 'YYYY-MM'
  toPeriod?: string;
  amountILS: number;
  reasonHe: string;                 // required, non-empty — hover shows it verbatim
  source: 'user' | 'insight';       // ← THE STAGE 8 SEAM
  insightId?: string;
  status: 'active' | 'retired';
}
```

**Its own collection because** §9 states corrected assumptions affect both future insights **and the forecast** — shared state between two engines. State shared by two owners cannot live inside either without one becoming the other's dependency. Storing it in `forecasts` would also make it die with each snapshot (D9).

**Stage 7 builds:** the collection, Rules, a typed service on `createOwnedCollectionRepo`, the read path, and a minimal user-authored create/edit/retire UI. **Stage 8 fills:** `source: 'insight'` writes. Stage 7 ships the `'insight'` branch in the *type and renderer* only, and a test asserts Stage 7 code never writes it. This is deliberately the opposite of Stage 6's B4 defect — the unexposed half is a **read/render** path with no user-facing promise attached, and no glossary entry claims a capability that does not exist.

**A new `'forecast'` `ModuleId` is added.** Cost stated: `MODULE_IDS` grows, `PermissionsManager` gains a row, `resolvePermissions`/`permissionSync` see a new key, Rules gain `isValidForecastAssumption` + a match block, the rules suite grows. **Rejected:** reusing `'expenses'` (a forecast is not an expense record, and gating it that way makes §4 scenario 6 inexpressible); leaving it ungated like `'net-worth'` (net worth is ungated because every input carries its own gate and it has no collection — `forecast_assumptions` **is** a collection and needs a write gate).

**Pre-empting the obvious attack — "what does `forecast: family` mean for someone with `expenses: own`?"** They may open the screen and author family-scoped assumptions; it does **not** widen what data reaches the computation. Content is always exactly the intersection of what the viewer may already read — `netWorth.ts`'s D4 precedent verbatim. The screen names which inputs were unreadable rather than silently omitting them. Pinned by an emulator test proving the query shape, not by reading code.

### D5 — What a forecast means for an `'own'`-scope viewer: **no projected balance line, ever. Stated on screen, in words.**

| Input | Reachable for `'own'`? | Why |
|---|---|---|
| `recurring`, `loans`, `insurances` | ✅ | owned |
| `transaction_lines` | ✅ after T1 | `where('owner','==',myName)` |
| **`incomes`** | ❌ structurally | ownerless; `'own'` grants nothing |
| **`goals`** | ❌ structurally | ownerless |
| **`settings/budgetConfig`** | ❌ | parent/super-admin only |

Recurring *income* items are owned and visible — but `incomes`, which holds salaries, is not. An `'own'` viewer's income picture is partial in a way they cannot detect.

**Ruling: `projectedBalance` is `null` and is not rendered.** The screen shows committed outgoings, projected variable spend, the band, and one plain sentence: *"התחזית הזו מראה רק את ההוצאות שלך. אין לך הרשאה לראות את ההכנסות המשפחתיות, ולכן אי אפשר להראות כאן יתרה צפויה."*

**Rejected — render the balance with income treated as 0:** a plunging negative balance that is authoritative-looking and false — the exact failure class this stage exists to avoid, and the "gate off, screen reassuring" pairing Stage 6 named twice. **Rejected — compute family balance server-side and return the aggregate:** leaks a family-level fact to a member who may not see it; Stage 6's B1 closed this class. **Rejected — hide the screen:** §4 scenario 6 wants a child to see *their* picture, and §5.7 says a refusal is a calm explanatory state, never an absence.

**Consequence for §3's "always shown":** the Dashboard card is always present, but for `'own'` its glance number is **projected committed outgoings**, visually distinct so the two can never be confused.

### D6 — History access: add a derived `period: 'YYYY-MM'` field to `transaction_lines`, backfill it, query on it. Do **not** normalize `date`.

Queries become `where('period','in',[…≤6 periods])`, plus `where('owner','==',name)` for `'own'` viewers — a shape Firestore *can* statically verify against `expensesAllowed`, which is the entire fix for finding 2 and the same reasoning as Stage 5's D1.

**Rejected — normalize `date` in place:** destructive, touches the field every existing reader depends on; Stage 5 D9 assigned that work elsewhere. Additive beats destructive on the family's only ledger. **Rejected — full scan + client filter:** denied for `'own'` viewers, and unbounded — a 3-month forecast would read the entire financial history on every horizon change. **Rejected — a rolled-up `monthly_totals` collection:** a second source of truth a late import silently falsifies; Stage 6's F2 ruling applies verbatim.

**Costs, stated rather than discovered later:** two write paths change (`commitExtractionDraft`, `RecurringService.postDueRecurringTransactions`), **both covered by `transactionWriteGuard.test.ts`'s allow-list of exactly 4 files — the allow-list must not grow**, asserted in T1 with the guard's own hostile-write mutation re-run. Rows whose `date` parses to `null` get no `period`; they are counted, reported, and **surfaced in the UI** as `unusableRowCount` with its own glossary entry — a hole nobody can see is a wrong average that looks right. A composite index (`owner` + `period`) is needed for cloud (R3).

### D7 — Seasonality is **data**, never month numbers in logic. Observed factors need n ≥ 2; the spec's September/April examples ship as seed content, not code.

A `settings/seasonality` document holds `Record<categoryId, Record<'01'..'12', { factor: number; source: 'observed' | 'user'; n: number }>`, **shipped empty**, plus a derivation computing `source: 'observed'` factors from the family's own history when **at least 2 observations of the same calendar month** exist. Below n=2, **no factor is applied and the line says so** — a multiplier from a single observation is fabrication with a decimal point.

`seasonalFactor` rides in `ForecastBasis.movingAverage` so hover can say *"ספטמבר היה יקר ב-30% בשנתיים האחרונות"* (observed) or *"אתה קבעת שספטמבר יקר ב-30%"* (user). Never an untraceable number.

**A structural guard, mutation-tested:** no integer literal in 1..12 and no Hebrew month name in `seasonality.ts`'s logic — AST-derived, comments stripped via the existing `stripComments` helper (rewritten on the TS parser in `5bf44a4`; **do not hand-roll a fourth lexer** — that mistake has been made three times in this repo). Written stub-first with synthetic month lists, because the real corpus is empty.

The spec's two examples become **seed content offered in the demo script and the assumptions UI** as a one-click "רוצה לקבוע שספטמבר יקר יותר?" — user-authored, attributed, editable.

### D8 — "מה צריך לקרות": shave **only discretionary (statistical) categories**, and refuse rather than emit a negative allowance.

`categoryAllowance(c) = statisticalProjection(c) − (shortfall × share(c))`, `share` over total *statistical* spend.

**Rejected — proportional shave across everything:** tells a family to reduce their mortgage by 4%. **Rejected — asking users to classify every category up front:** a setup tax before the first useful answer; instead `flexible: false` is expressible as an **assumption**, so the default works immediately and the escape hatch exists.

**The refusal rule, and it is the important half:** if `shortfall > Σ statisticalProjection` the line **must not** render negative allowances. It renders *"היעד הזה לא ניתן להשגה בתקופה שנבחרה, גם בלי שום הוצאה משתנה"* plus the gap. A negative allowance is arithmetically derived and semantically meaningless. **Stub-first, mutation-tested, and tested in the cheap-for-expensive direction so it is not shadowed by another check that refuses first.**

**Targets, both messy, both explicit:** `settings/budgetConfig` (unreadable for members → no target, no line, calm state, **never a fabricated target**); `goals` via a pure `parseHebrewGoalPeriod` using a Hebrew month array **moved** into shared config from `FuturePlanning.tsx:24-27` (moved, not duplicated — duplicating a map is this project's recorded F4 class). Unparseable goals **excluded with a visible count**. Goals are ownerless, so a per-member line states a **family** goal and the copy must say so.

### D9 — `forecasts` is a **user-triggered snapshot**, not a cache.

**Rejected — persist every computation:** a write on every filter change, and a stored result whose assumptions have since changed is a lie with a timestamp. **Rejected — don't build it:** Stage 8's refine loop needs a prior state to say "the forecast changed because you corrected X". **Chosen:** one explicit "שמור תחזית" control freezing range, resolved assumptions, result and `computedAt`. Restoring renders **read-only, labelled historical**, never live. Rules block + `isValidForecast` in the `isValidAiCostConfig` shape. Audit entry on write (`forecast.snapshot`) — Stage 6's I3 found the one path that lacked one and it cost a fix batch.

### D10 — Committed instalments: project forward from observed plan progress, with a stated-fragile plan key and a visible unusable count.

A row `(installmentNumber: 3, totalInstallments: 12, amount: 250)` implies 9 further ₪250 charges, capped at the horizon.

**Traps handled:** **double counting on re-import** — project only `number > max(observed)` for that plan, plans identified by a derived `planKey = f(vendor, totalInstallments, amount)`; **there is no plan id in the data** and this heuristic will mis-group two identical-looking plans from the same vendor, stated in the guard comment *and* the hover copy, counted in R5. **Amount semantics** — T2 step 1 asserts against a real fixture that `amount` is per-instalment; do not copy the assumption from this plan (three agents on this project have caught an inherited fixture that was wrong). **`totalInstallments` present, `installmentNumber` absent** → unprojectable, excluded, counted, shown.

### D11 — The statistical layer excludes rows carrying `recurringId`. The loan/insurance double count is disclosed, not fixed.

Auto-posted recurring rows are structurally identifiable and excluded from the moving average, or the certain layer counts them twice.

**Loans and insurances have no discriminator.** A ₪4,200 mortgage debit imported into `transaction_lines` plus a `Loan` record saying `monthlyPayment: 4200` counts ₪8,400. **This plan does not fix that** — matching a bank row to a loan is fuzzy matching, genuinely Stage 8's duplicate-detection insight (§9 lists "כפילויות").

**Mitigation shipped here, because an undisclosed double count is the stage's own failure mode:** the certain layer renders **itemised by name** ("משכנתא — ₪4,200"), not as an opaque subtotal, so a human can see the duplicate — plus one line: *"אם תשלום כזה מופיע גם בדף הבנק, ייתכן שהוא נספר פעמיים."* R1, owned by T3, carried to Stage 8 by name.

### D12 — The forecast honours **מי** and **מה**; **מתי** is the *anchor*, not the range. The horizon is forecast-local.

**מי** and **מה** apply fully. **מתי** — the forecast starts from the month after the selected period ends; the horizon (3/6/12/custom, default 3) is a **forecast-local** control, not added to `GlobalFilterState`.

**Rejected — ignore מתי:** breaks §5.3's literal "משפיע על הכל, כולל התחזית"; Stage 6's M3 already had to retrofit exactly this for the chat. **Rejected — horizon in `GlobalFilterState`:** a dimension only one screen reads, persisted into every other screen's sticky state.

### D13 — The word **תזרים is never surfaced**, and the spec/code conflict is reported rather than papered over.

**Rejected — remove it from `BANNED_JARGON`:** weakening the floor so copy can pass it is backwards; `plainLanguage.ts` has survived every stage unmodified. **Rejected — use it in headings but not glossary entries:** the guard's corpus is glossary entries, so this passes technically while defeating the rule — the enumeration-guard class, 4 instances counted. **Chosen:** the screen says **"כמה כסף נכנס ויוצא בכל חודש"**. Reported to David as a spec-vs-code conflict for his call — his word, his product.

### D14 — Cold start is a **per-category** property, surfaced at the month level; ₪0 never means "unknown".

| `monthsObserved` | Behaviour |
|---|---|
| 0 | **No statistical layer.** Certain layer only. Variable spend renders as an explicit **gap**, *"עוד אין מספיק היסטוריה כדי להעריך הוצאות משתנות"* — **never ₪0**. |
| 1–2 | Average shown, labelled with the real n. **No band.** No seasonality. |
| 3–6 | Full statistical layer, band from observed range, seasonality if n≥2 same-months. |
| >6 | Window capped at 6 (§10's stated range). |

**A month's displayed confidence inherits the WEAKEST `monthsObserved` among contributing categories** — never the average, which hides a one-month-old category behind five mature ones. Pinned with a mixed n=6 / n=1 fixture asserting the month reports 1. **₪0 and "we don't know" are different messages** — §5.7's own rule, applied to missing history. A guard asserts the zero-history renderer emits no `₪0`.

### D15 — A new `'forecast'` registry entry; the existing `'future'` tab is **renamed** to "יעדי חיסכון".

Two tabs both promising the future is a §5 information-architecture defect the moment this stage ships. The rename is a one-line `MODULE_REGISTRY` label change; **the component stays on Stage 5's untouched list.** New entry: `{ id: 'forecast', label: 'תחזית', permissionModuleId: 'forecast', usesGlobalFilters: true, filterModuleId: 'expenses' }` — `'expenses'` because the מי control's dead-end filtering should follow the module dominating the forecast's data volume; `null` (net-worth's precedent) rejected because unlike net worth, the forecast's *history* half is single-module.

---

## Method — which standing rule binds where

| Standing rule (Stage 6) | Where it binds in Stage 7 |
|---|---|
| **Reproduce before fixing; keep the reproduction** | T1: reproduce the `'own'`-viewer `getDocs` denial **on the live emulator** before adding `period` — the mocked suite cannot see it. Becomes a permanent `firestore-tests/` case. |
| **Mutation-test every guard** | T2 `resolveLayerPrecedence`; T3 band-basis selector + `monthsObserved` floor + `recurringId` exclusion; T5 no-month-literal guard + n≥2 floor; T6 unreachable-target refusal; T7 render-presence Explain coverage. Each mutation reverted and re-run green before the next. |
| **Predicates stub-first with synthetic inputs, before first green** | **All of the above, no exceptions.** On today's tree `forecast_assumptions` is empty, `settings/seasonality` is empty, and no forecast surface exists — every predicate has a **clean corpus and is shadowed by construction**, the exact condition under which this project shipped twelve shadowed guards, four inside the fix for the previous one. |
| **Derive guards from the tree, never enumerate** | T7's "every rendered ₪ figure has an `<Explain>`" guard **derives the figure set from the rendered DOM** with a canary; the surface list comes from the module registry + a call graph. A hardcoded testid list is the 4-instance enumeration class and will be rejected. |
| **A green mocked suite cannot see Firestore-contract bugs** | Live-emulator proof required in **T1**, **T4**, **T8**. T2/T3/T5/T6 are pure and need none — say so rather than booting it for show. |
| **Adversarial mutation sweep is an end-of-stage gate** | T8. Minimum: a new forecast surface with an un-`<Explain>`'d ₪ figure; a month literal in seasonality logic; the `recurringId` exclusion removed; the negative-allowance refusal removed; the `'own'`-scope balance suppression removed. **Every one must fail a test.** |
| **A comment asserting a property is a defect unless a test holds it** | Every provenance claim in `forecast.ts` gets a test. The `layer`/`basis.kind` correspondence is canonical. |
| **Reviewers must not mutate the working tree** | Every review dispatch uses an isolated worktree; the emulator is isolated **by project id**, not port (`firestore-tests/` hardcodes 8080). |
| **`test:all` is the only name for "the tests"** | The root suite needs `.env`/`.env.local` or 5 files fail to *collect* while vitest prints a plausible count. Every count re-run, never quoted. |
| **Egress copy is a human sign-off gate** | Stage 7 **does not touch** `aiDisclosure.ts` or `buildFinancialContext`'s payload. |

---

## Global constraints

- Branch `familyfinance-v2`. Frequent, well-scoped commits; the app usable after every task.
- `npm run lint` and `npm run test:all` green before every commit. Counts **re-run, never quoted**.
- **TDD, failing test first.** A test that passes on the first run against unwritten code is a defect.
- **Root `tsconfig.json` is NOT strict** — boolean-discriminant narrowing does not work in `src/`. Use string discriminants. `functions/` is strict; the asymmetry is the trap.
- Four states on every new hook and surface: loading / error / permission-refused / empty. A failed read renders as an **error**, never as empty.
- No hardcoded values beyond named constants. **Specifically banned:** month numbers in seasonality logic, band multipliers, an unnamed lookback window, any ₪ threshold not read from config.
- **One money formatter.** `formatILS` moves from `src/config/aiCeiling.ts` to a neutral `src/config/money.ts` (byte-identical move, re-exported so existing imports keep working). `tabular-nums` on every numeric cell; `he-IL`; 2 fraction digits.
- Hebrew UI, RTL, dates DD/MM/YYYY. `data-tour-id` on every new surface, control and row: `screen.forecast.*`.
- `<ScopeBadge scope="own">` on the forecast screen whenever the resolved scope is `'own'`, **in addition to** D5's sentence — the badge says "restricted", the sentence says *what is missing*.
- **Untouched:** `aiDisclosure.ts`, `buildFinancialContext.ts`, all four AI extraction surfaces, `plainLanguage.ts`, `ExpensesBreakdown`/`AnnualReport`/`CentralExpenseReport`/`InvestmentsPortfolio`/`FolderLogic`/`FamilyManagerModal`, and `FuturePlanning.tsx` (its registry **label** changes; the component does not).

---

## Task breakdown

### Task 1 — History access: `period` field, backfill, scope-aware reads, index declaration, inherited closures
- [ ] **Live-emulator reproduction first:** a `'member'` session with `expenses: 'own'` issues `getDocs(collection(db,'transaction_lines'))` and is denied. Keep as a permanent test.
- [ ] `periodOf(dateStr): string | null` on the existing `parseTransactionDate` (both formats; `null` on unparseable — never a guess).
- [ ] Both write paths stamp `period`. **Assert `transactionWriteGuard.test.ts`'s allow-list is still exactly 4 files**; re-run its hostile-write mutation.
- [ ] `listTransactionHistory(scope, viewerMemberId, viewerName, periods)`: `'family'` → `where('period','in',periods)`; `'own'` → `+ where('owner','==',viewerName)`. Prove **on the emulator** the `'own'` shape is accepted where the unconstrained one is denied.
- [ ] Backfill script: dry-run default, verified backup before `--apply`, idempotent, **reports the unparseable count**, exits non-zero above a named threshold.
- [ ] `firestore.indexes.json` declaring `(owner ASC, period ASC)`; wire `firestore.indexes` into `firebase.json`.
- [ ] **Inherited closures:** `vitest.config.ts:32` alias → `src/`; `.gitignore` `node_modules/` → `node_modules` and align `functions/.gitignore`.

**Live-emulator: REQUIRED. Mutation sweep: on the write guard.**

### Task 2 — Pure forecast core: certain layer, provenance union, precedence resolver
- [ ] **Assert against a real extraction fixture** that `amount` on an instalment row is the per-instalment charge.
- [ ] `ForecastBasis` / `ForecastLineItem` / `ForecastResult`; test pinning `layer` ↔ `basis.kind`.
- [ ] Certain layer: `recurring` (**reuse** `computeDuePeriods`/`clampDayToMonth`, do not reimplement bank standing-order semantics), `loans.monthlyPayment` bounded by `endDate`, `insurances.premium` normalized by frequency (the ledger's glossary item 18: the same policy already renders as two different numbers on one screen — pick one and say which), instalments per D10.
- [ ] `resolveLayerPrecedence` — **stub-first, synthetic inputs, before first green.**
- [ ] **Inherited closure:** `readMoneyAmount(raw: unknown)` — three states (`ok`/`absent`/`corrupt`), the sibling of `functions/`'s `readStoredAmountILS`. Closes the ledger's open item at `buildFinancialContext.ts:57-58`: a corrupt `recurring.amount` makes `totalMonthlyExpense.value` `NaN`, which `JSON.stringify` sends **to the model as `null`**. **This is the one line Stage 7 touches in `functions/` — a value read, not a payload field.** Verify by running the egress suite.
- [ ] No Firebase imports, no permission logic, no `Date` arithmetic (D1's mirrorability constraint) — pinned by a test.

**Live-emulator: NOT required (pure) — say so. Mutation sweep: REQUIRED.**

### Task 3 — Statistical layer, cold start, uncertainty band
- [ ] Moving average per category over named `LOOKBACK_MONTHS_MAX = 6` / `_MIN = 3`.
- [ ] **Exclude rows carrying `recurringId`** — mutation-tested; removing it must fail a test that names the double count.
- [ ] `monthsObserved` per category; D14's four-band table; month confidence = **weakest** contributing category.
- [ ] Band: `min`/`median`/`max`; `bandBasis` discriminant; **no band below n=3**.
- [ ] Guard: zero-history path emits **no `₪0`**. Guard: no probability language anywhere.

**Live-emulator: NOT required. Mutation sweep: REQUIRED.**

### Task 4 — `forecast_assumptions`: collection, Rules, service, `'forecast'` ModuleId, Stage 8 seam
- [ ] `'forecast'` added to `ModuleId`/`MODULE_IDS`; matrix row; `resolvePermissions`/`permissionSync` updated.
- [ ] `isValidForecastAssumption` in the `isValidAiCostConfig` shape (`create, update` + `delete` split so the validator has `request.resource.data`) — **one `match` block with conditionals, never a second block**: Firestore ORs across matching rules and a naive split re-opens the `60d1c32` exposure.
- [ ] Service on the shared factory ⇒ audit entries ride in the same transaction.
- [ ] Test asserting **no Stage 7 code path writes `source: 'insight'`**.
- [ ] **Inherited closure:** `isValidAuditEntry` requires `at is string` while both server writers use `serverTimestamp()` — **the rule can never have validated a server-written entry.**

**Done:** adversarial rules matrix (≥4 session types × the new doc × 5 ops, plus unauthenticated and claimless) **written independently by the reviewer, not reasoned from reading**; a full-matrix `'member'` still cannot write another member's assumption. **Live-emulator: REQUIRED.**

### Task 5 — Seasonality as data + observed derivation
- [ ] `settings/seasonality` shape; ships **empty**.
- [ ] Observed derivation, **n ≥ 2 same-calendar-months required**; below that no factor and a stated reason.
- [ ] `seasonalFactor` + `source`/`n` carried into `ForecastBasis`.
- [ ] Structural guard: no 1..12 literal, no Hebrew month name in the logic module — AST-derived, **comments stripped via the existing `stripComments`**. Do not hand-roll a lexer.
- [ ] Every predicate stub-first with synthetic inputs.

**Mutation sweep: REQUIRED** (reintroduce a month literal; drop the n≥2 floor; apply a factor with no provenance; blank the predicate).

### Task 6 — "מה צריך לקרות": targets, allowances, refusal
- [ ] `parseHebrewGoalPeriod`; unparseable goals **excluded with a visible count**.
- [ ] `budgetConfig` unreadable → **no target, no line, calm state** — never fabricated. Proven for a `'member'` session.
- [ ] Allowance shaved across statistical categories only; `flexible: false` honoured from assumptions.
- [ ] **The refusal:** `shortfall > Σ statistical` ⇒ explicit unreachable message with the gap; **never a negative allowance.** Stub-first, mutation-tested **in the cheap-for-expensive direction** so it is not shadowed by a check that refuses first.
- [ ] Goals are family-level; copy must not imply a member owns one.

**Mutation sweep: REQUIRED.**

### Task 7 — `useForecast`, Dashboard card, full screen, glossary, states
- [ ] `useForecast` on `useScopedRead`; the **same four-state contract** as `useNetWorth` — the real test of whether the shape generalizes.
- [ ] All four states on both surfaces. A partial-input failure degrades **explicitly and namedly**, never silently — louder than `useNetWorth`'s precedent, because here the missing input changes the headline number.
- [ ] **D5 enforced at the hook**, not the component: `scope === 'own'` ⇒ `projectedBalance: null`. A component-level guard is a rule a second component can skip.
- [ ] Dashboard card: **one glance-scale number** at `text-3xl md:text-4xl font-bold`, matching `Dashboard.tsx:607` (Ofra's Stage 6 finding: *scale is what makes a glance*). Family scope ⇒ projected end-of-period balance; `'own'` ⇒ projected committed outgoings, visually distinct.
- [ ] Certain layer rendered **itemised by name** (D11's mitigation).
- [ ] Certain/estimated split as the primary uncertainty signal, per-month, growing with distance; pinned by a month-1-certain / month-3-statistical fixture.
- [ ] `<Explain>` on **every** rendered figure. **Coverage guard derives the figure set from the rendered DOM with a canary.**
- [ ] **Inherited closure:** convert the extraction-notice guard from **source-presence to render-presence** — `{SHOW_NOTICE ? <Notice/> : null}` on a fifth surface currently passes green. Stage 7 adds no extraction surface, which is exactly why this is the right stage to close it: no pressure to weaken it to fit new code.
- [ ] `formatILS` moved to `src/config/money.ts`; `tabular-nums`; contrast measured from the installed Tailwind theme via `helpers/tailwindContrast.ts`, **never hardcoded ratios**.
- [ ] Registry: add `'forecast'`; rename `'future'`'s label to "יעדי חיסכון".

**Mutation sweep: REQUIRED** on the coverage and render-presence guards.

### Task 8 — `forecasts` snapshot, demo script, acceptance re-measure, end-of-stage sweep
- [ ] Snapshot write + `isValidForecast` + audit entry; restore renders **read-only and labelled historical**.
- [ ] Glossary dump re-run; **recount against `src/config/glossary.ts` at HEAD** rather than trusting any earlier number (the count moved 22→25 mid-review once already).
- [ ] Demo script **written by running things**: emulator on an **isolated project id** (never `npm run emu`, which hardcodes `--import ./.emulator-data` — David's own data), exercising all four cold-start states, both scopes, an assumption override, an unreachable target.
- [ ] **Acceptance measures re-run against HEAD**, never carried forward — review findings age the moment a fix lands.
- [ ] **Adversarial mutation sweep.** Every survivor fixed or recorded as genuinely equivalent **with the argument stated**.

**Live-emulator: REQUIRED.**

---

## Risks

| # | Risk | Mitigation | Owner |
|---|---|---|---|
| **R1** | **Loan/insurance double count** — a mortgage debit in `transaction_lines` plus `Loan.monthlyPayment`; **no discriminator exists**, unlike `recurringId`. | `recurringId` exclusion closes the recurring half; certain layer rendered **itemised by name** plus an explicit caveat. Fuzzy matching deferred to Stage 8 **by name**. | T3 / Stage 8 |
| **R2** | The `period` write-path change touches files guarded by `transactionWriteGuard`; a widened allow-list silently re-opens the HITL guard Stage 6 spent Task 1 and three fix batches closing. | Allow-list count asserted at exactly 4; the guard's own hostile-write mutation re-run. | T1 |
| **R3** | **No `firestore.indexes.json` exists.** Every new composite query works on the emulator and fails on first cloud deploy, invisible locally — the same class as Stage 6's CSP finding. | Index file created and wired in T1; verification an explicit Stage 11 cutover step. | T1 / Stage 11 |
| **R4** | An `'own'`-scope forecast read as a whole-family picture — the most dangerous misread in the stage. | D5: no balance line ever; `<ScopeBadge>`; a sentence naming what is missing; enforced at the hook and mutation-tested. | T7 |
| **R5** | The instalment `planKey` heuristic mis-groups two same-vendor plans — there is no plan id in the data. | Limitation stated in the guard comment **and** the hover copy; unusable rows counted and shown; a colliding-plans fixture is a permanent test documenting the known-wrong output. | T2 |
| **R6** | `settings/seasonality` ships empty, so §10's September example is **not demonstrable on day one**. | Demo offers the seed as a live user action; the doc states plainly what cannot be shown. | T5 / T8 |
| **R7** | Hebrew goal-date parsing silently drops goals ⇒ a quietly wrong target line. | Unparseable goals **counted and displayed**; parser has its own suite with malformed fixtures. | T6 |
| **R8** | Backfill leaves a hole in the corpus ⇒ a moving average over incomplete data that looks complete. | `unusableRowCount` surfaced with its own glossary entry; script exits non-zero above a named threshold. | T1 / T7 |
| **R9** | New guards are **shadowed by construction** — empty corpora make every predicate vacuous, exactly as happened twelve times in Stage 6. | Stub-first with synthetic inputs before the first green run, no exceptions; each neutered in the sweep. | every task |
| **R10** | `'forecast'` ModuleId expands the permission surface; a fail-open default would be silent. | Fail-closed default asserted; the rules matrix includes a full-matrix `'member'` proving the gate is role-driven, not matrix-driven. | T4 |

---

## Stage-7 done criteria

**Functional**
- [ ] Three layers compose with correct precedence; every number's layer and basis visible on hover.
- [ ] Month-by-month projection over any range, default 3, responding to מי/מה, anchored by מתי, horizon locally controlled.
- [ ] All four cold-start states reachable and correct; **zero history renders a stated gap, never ₪0**.
- [ ] "מה צריך לקרות" produces per-category allowances and **refuses** rather than emitting negatives.
- [ ] `'own'`-scope forecast renders no balance and names what is missing.
- [ ] Forecast always on the Dashboard; opens to a full screen; both driven by **one** computation source.
- [ ] `forecast_assumptions` CRUD works and overrides both statistical and certain items with distinct disclosures.
- [ ] A saved snapshot restores read-only and labelled.

**Glossary — 17 entries owed**, each passing `violatesPlainLanguage` and wired to a live `<Explain>`:
`forecast.projectedBalance` · `forecast.certainTotal` · `forecast.estimatedTotal` · `forecast.band` · `forecast.monthIncome` · `forecast.monthExpense` · `forecast.historyDepth` · `forecast.seasonalAdjustment` · `forecast.installmentsCommitted` · `forecast.loanRepayments` · `forecast.insurancePremiums` · `forecast.categoryAllowance` · `forecast.shortfall` · `forecast.targetSource` · `forecast.assumptionOverride` · `forecast.unusableRows` · `forecast.savedSnapshot`
- [ ] Count re-verified against `glossary.ts` at HEAD (expected 25 → 42), dump re-run and published to David **numbered**, no entry containing `תזרים` or probability language.

**Product-metric acceptance — acceptance criteria, not unit tests**
- [ ] **Cold-reader glossary check** against the running app. **FAIL is a legitimate outcome that blocks the stage**, as it did in Stage 6.
- [ ] **5-second glance:** answers "are we going to be OK?" in under 5 seconds, checked against all four Stage 6 glance defects **and the fifth — a glance-scale number**, the item that redesign missed twice.
- [ ] **Honesty:** every ₪ figure is either certain or visibly marked estimated; enumerated by the reviewer from the rendered DOM.
- [ ] **20-member readability**, verified with 20-member demo data.
- [ ] **Recorded, not hidden:** the glance is a visual judgment and there is **no browser verification in this project**. Flagged for David's eyes in the words Stage 6 used: *"I can conclude what the code instructs the browser to draw; I cannot conclude the hierarchy works on a phone in Hebrew."*

**Method gates**
- [ ] `test:all` green, counts **re-run**, `.env`/`.env.local` present.
- [ ] Adversarial mutation sweep complete; survivors fixed or argued.
- [ ] Every new predicate provably unshadowed.
- [ ] Emulator proof recorded for T1/T4/T8; explicitly stated where it was **not** needed and why.
- [ ] Demo walked by running, isolated project id, David's `.emulator-data` untouched.

---

## What this stage explicitly does NOT do

| Deferred | Owner | Reason |
|---|---|---|
| Insight generation, refine loop, insight→assumption writes | **Stage 8** | Stage 7 builds the assumption *input* seam only. |
| Fuzzy matching a bank row to a loan/insurance (R1's double count) | **Stage 8** | A duplicate-detection insight (§9), not forecast arithmetic. Disclosed on screen here. |
| Forecast facts reaching the AI chat context | **Stage 9** | `buildFinancialContext` is pinned by five egress-guard layers plus a human sign-off gate. |
| Normalizing `transaction_lines.date` | **Stage 11** | Stage 5 D9 assigned it; T1's additive `period` is the minimal unblock. |
| Deleting `settings/ecosystem`'s orphaned fields | **Stage 11** | Already a roadmap done-criteria line. |
| Server-side / scheduled forecast computation | **Stage 8, if needed** | D1's revisit trigger, mirrorability pre-satisfied by T2. |
| A tour script for the forecast | **Stage 10** | `data-tour-id`s ship here so Stage 10 writes a script, not markup. |
| Real-estate freshness, `investments` per-doc `asOf` | **Stage 11** | Pre-existing glossary items flagged to David. |
| A quick manual-entry screen (§11) | **Stage 11** | Already assigned by name. |

---

## Stage 6 inheritance — disposition by name

**Closed by this stage:** (1) `vitest.config.ts` `'@'` → repo root — T1. (2) `.gitignore` trailing-slash + `functions/.gitignore` disagreement — T1; a worktree agent's `git add -A` would commit a symlink into the main repo. (3) `buildFinancialContext.ts:57-58` money coercion — T2 via shared `readMoneyAmount`; Stage 7 owns recurring-amount arithmetic, so this is its correct home one stage earlier than the ledger assumed. (4) No shared money formatter — T7. (5) The extraction-notice guard is source-presence not render-presence — T7, closed here *because* Stage 7 adds no extraction surface. (6) `isValidAuditEntry` requires `at is string` while server writers use `serverTimestamp()` — T4. (7) The untracked `glossary-review-2026-08-17.md` — T8 decides its home.

**Knowingly carried:** (1) R-3(b) parent/child prop seam — full closure needs real inter-component dataflow; **carried not because it is small but because a half-attempt produces a guard whose comment over-claims.** (2) The stored model preference vs. the notice — a product decision first; no Stage 7 task opens those files. (3) `claude-opus-5` unreachable — **carried to Stage 8 by name**, the stage that requests `'insight'`. (4) Extraction compare-two-models unsatisfiable — chat-only, unaffected. (5) `useAiModels('extraction')` duplicated across four surfaces — Stage 7 opens none of them. (6) Icon contrast at 2.40:1 — Stage 11. (7) Pricing UNVERIFIED; rotate the Gemini key; set a ceiling before the first import — **David actions**, restated in T8's demo. (8) `aiDisclosure.ts` human sign-off gate — standing; Stage 7 does not touch it. (9) The intermittent `AiSettingsScreen` failure — diagnosed three times as machine load; **no action, and no one should "fix" it.** (10) The irreducible semantic residual — applies to this stage's 17 new entries, which is why the cold-reader check is an acceptance criterion.

---

## Underspecified or internally inconsistent in the spec (reported, not worked around)

1. §10's own word for the deliverable, `תזרים`, is banned by the app's plain-language floor. D13 resolves; David's call.
2. §10 names "שמרן / צפוי / אופטימי" without defining any of the three — no method, no confidence semantics, no data source. The most under-specified line, and the one most likely to be built as theatre. D3 is a call, not a reading.
3. §10's seasonality examples are hardcoded factual claims about one family. D7 turns them into seed data; defaults are David's decision.
4. §7's `forecasts` has no stated trigger — computed-and-cached vs. user-saved have opposite correctness properties. D9 chooses.
5. §10.3 says assumptions override "the statistics"; §9 says they affect "the forecast". Silent on overriding a *certain* item — the most valuable case. D2 rules yes, with a louder disclosure.
6. §10 says the forecast responds "פר-בן-משפחה או משפחתית" but never says what a per-member forecast means when income and goals are ownerless by §7. Built literally, this produces a plunging false negative balance. D5.
7. §10's "יעד" is undefined — `budgetConfig` and `goals` are different things with different owners, different gates, and in one case an unparseable date. D8 handles both and says which is which.
8. §5.3 says מתי affects everything "כולל התחזית", but a forecast is forward-looking; a *past* month selection is undefined. D12.
9. §6 lists "תחזית" as a module while a screen labelled "תכנון עתידי" already exists, with no stated relationship. D15.
10. §3's "always shown" collides with §5.7's "a failed read is never shown as no data" when the viewer cannot read the inputs. D5 reconciles by changing *what* is always shown.
11. §7 says `recurring` feeds the forecast, but the recurring engine also posts into `transaction_lines`, which the statistical layer reads — the double count is never addressed, and the loan/insurance case has no discriminator at all. D11, R1.
12. `goals` is ownerless and its `date` is a Hebrew month string, yet the spec assumes goals are usable as targets. A data-model gap masquerading as a requirement.

---

## Open questions: none blocking

Two need David at the point they arise: whether `תזרים` may be used in the UI (item 1), and whether the September/April seasonality claims ship as accepted defaults or stay opt-in (item 3 / R6).
