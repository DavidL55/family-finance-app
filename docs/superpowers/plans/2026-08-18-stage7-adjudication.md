# Stage 7 plan gate — controller adjudication

**Plan reviewed:** `2026-08-18-stage7-forecast.md` (v1) at HEAD `032d169`.
**Lenses:** Ofra (UX), Sun (architecture), Lola (product), what-did-we-miss.
**Verdict: v1 is not salvageable by patching. Rewrite as v2.** Four findings change the *data shape*, three change the *hook contract*, one changes what the headline number even is, and one task is impossible as written. Patching a plan whose foundation moved produces a plan that reads consistent and is not.

**All four lenses were right about something no other lens saw.** That is the gate paying for itself. Rulings below are binding on v2.

---

## The three findings that invalidate v1's foundation

### A1 — `projectedBalance` has no source. (what-did-we-miss #1) **UPHELD, and this is the stage's real hole.**
The plan asserts the headline number six times and never says what balance it projects. The word "accounts" appears zero times in v1; `netWorth.ts`'s own header already records that `accounts` feeds "§10 forecast layer-1 inputs", and `accounts` is an **owned** module — so v1's D5 table is wrong in the other direction too: an `'own'` viewer *can* read their own accounts.

**Ruling — new D16, and it must be written before anything else:**
- `projectedBalance = openingBalance + Σ(projected income) − Σ(projected expense)`, where `openingBalance` is the sum of readable `accounts.balance`.
- **The opening balance is the least certain input in the whole computation and must not sit inside a solid "certain" figure.** It carries its own `asOf` provenance from `balanceUpdatedAt`, and a staleness state parallel to D3's `bandBasis`. A balance last touched in March, projected three months forward, is wrong by the whole intervening period.
- If `accounts` is empty or unreadable, `projectedBalance` is `null` — same rule as A2.
- A "net flow" figure labelled `יתרה צפויה` is **forbidden**. If we cannot compute a balance we say so; we do not relabel a delta.

### A2 — the balance-suppression rule is driven by the wrong predicate. (Lola CRITICAL 1) **UPHELD.**
v1's D5 suppresses the balance when income is unreadable *by permission*. The emulator corpus has **`incomes: 0` documents** — income is zero *by absence*, for everyone, in family scope, on the Dashboard, at `text-4xl`.

**Ruling:** suppression is driven by **input presence**, not scope. Any balance-contributing input that is unreadable **or empty** ⇒ `projectedBalance: null` + a named gap. Enforced at the hook, mutation-tested. This subsumes D5, which stays as the permission case of a more general rule.

### A3 — the corpus is empty, so v1 ships a screen with no numbers. (Lola CRITICAL 2, what-did-we-miss #2) **UPHELD.**
Counted: `transaction_lines: 3` (all March 2026), `recurring: 0`, `loans: 0`, `insurances: 0`, `incomes: 0`, `goals: 0`, `accounts: 0`, no category budgets. v1's D14 zero-history row presumes "certain layer only" — but the certain layer's three sources are all empty, so **v1's best case is unreachable and its actual day-one state is not in the table.**

**Rulings:**
- D14 gains a **row 0: every layer empty** — the day-one state, and it is an **onboarding state, not three empty bars**.
- **The empty state is a path, not an apology.** Every gap message names the missing input and deep-links to its create form, reusing Stage 5 D11's pre-filled navigation payload. This is the highest-value addition in the stage.
- **A demo-data generator is its own task**, built before the statistical layer, because it is also the only way that layer gets a non-synthetic test. No generator exists today; `seed-members.ts` seeds 3 members and no financial data, and `largeFamily.ts` is 20 members with no money.
- **The glance position always holds a number, never a caveat.** A caveat you can close is information; a caveat you can only read is noise.

---

## Data shape — settled before any migration runs

### A4 — the `in` limit was checked on the wrong axis. (Sun C1) **UPHELD.**
Firestore caps **disjunctions after DNF expansion**, not values per clause. `owner in [N]` × `period in [6]` = 6N; **N ≥ 6 members is a hard `invalid-argument`** — with the stage's own 20-member acceptance dataset. Server-enforced, so a green emulator run may not fire it.
**Ruling:** the history query carries **exactly one `in`** (`period`). מי is a client-side filter over returned rows. Pinned by a test asserting one disjunctive clause.

### A5 — `unusableRowCount` is unobtainable from the read path that renders it. (Sun C2) **UPHELD.**
A `where('period','in',…)` query cannot return rows lacking `period`. v1 promises the count in D6, R8, T7 and a glossary entry.
**Ruling:** the backfill stamps `period: 'unknown'` on unparseable rows. The query sends 7 values. The hole becomes queryable, self-maintaining, and derived from the same fetch — no second read, no denied scan.

### A6 — add `ownerId` in the same pass. (Sun H18) **UPHELD.**
v1 applies "additive beats destructive" once and then builds the entire `'own'` path on `owner`, a **display name**: a rename silently denies the query and orphans that member's history, and what-did-we-miss #7 shows D14 then renders that as the reassuring "not enough history yet".
**Ruling:** stamp `ownerId` in the same migration. Widen `expensesAllowed` to `data.ownerId == memberId() || data.owner == myMember().name` — strictly additive, removes no access. Query on `ownerId`; index `(ownerId, period)`. This retires a convention instead of entrenching it, at near-zero marginal cost.

### A7 — `period` must be immutable, and the backfill needs a completion marker. (Sun M14, what-did-we-miss #12) **UPHELD.**
`allow update` re-validates `date.size() == 10` and says nothing about `period`; the two can diverge and every reader picks a different one. And a **half-done backfill** produces a moving average over a fraction of the corpus that renders with full confidence — `unusableRowCount` counts unparseable rows, not unstamped ones, so the instrument cannot see it.
**Rulings:** `period` and `ownerId` immutable on update (the shape the rules already use for `owner`). A durable completion marker the forecast reads; **the statistical layer refuses to compute until it is set.** Batch at 400 (the existing `migrate-transactions.ts` precedent).

### A8 — there is a third and fourth writer, and the guard cannot see either. (Sun H8, what-did-we-miss #6) **UPHELD.**
`scripts/migrate-transactions.ts` writes via the Admin SDK from outside `src/`, so `transactionWriteGuard`'s `SRC_ROOT` never scans it; T1's backfill would be the fourth. And v1's "assert the allow-list is still exactly 4" is **tautological** — both write paths are already on it, so the count cannot move.
**Rulings:** stamp `period`/`ownerId` inside the pure `migrateLegacyTransaction`. Add a `scripts/`-scoped assertion that any file writing `transaction_lines` produces both fields in the same object literal. Delete the tautological assertion and say plainly that the guard has a `scripts/` blind spot. Re-run the HITL, watermark and `extraction.commit` audit suites **by name**, not just the write guard.

---

## Computation — three corrections

### A9 — `computeDuePeriods` cannot project forward. (what-did-we-miss #3) **UPHELD. This is the quietest killer in the review.**
`rangeEnd` is hard-capped at the current period; for any future month it returns `[]`. A literal reading of v1's "reuse, do not reimplement" ships **a certain layer that is empty in every forecast month** — and the tests pass, because the line items are simply absent.
**Ruling:** extract the pure primitives (`periodsBetween`, `nextPeriod`, `clampDayToMonth`, the charge-day clamp) and write a genuinely new forward projector. Say so explicitly so nobody "reuses" the catch-up function. `clampDayToMonth` **is** reusable; `computeDuePeriods` is not.

### A10 — recurring **income** posts into `incomes`, not `transaction_lines`. (what-did-we-miss #4, Sun H10) **UPHELD.**
v1's finding 7 is half-right. `RecurringService` branches on `kind` and writes income rows into `incomes` with `recurringId` — so the income side has D11's double count too, with a discriminator that makes it cheaply fixable. And `incomes` has **no service layer, no `period`, no owner field, and a third date convention** (`month`/`year` as strings).
**Rulings:** D11 covers both collections. The T1 backfill extends to `incomes` with the same `periodOf`. If that is refused, v2 must rule explicitly that there is **no income statistical layer** and say so on screen — silently having six months of expense history and none of income makes `projectedBalance` optimistic in one direction.

### A11 — the statistical layer is silent on credits and income rows. (Sun H9) **UPHELD.**
`isExpenseRow` excludes income-category rows and all credits; `isExpenseListRow` has a documented refund carve-out. A moving average over raw rows counts refunds as spend.
**Ruling:** name `isExpenseRow` in D11 with the reason, and mutation-test its removal alongside the `recurringId` exclusion.

### A12 — no tiebreak *inside* the assumption layer. (Sun C5) **UPHELD.**
`list('family')` returns every member's assumptions; two can collide on the same (period, category). The winner is then Firestore's iteration order — **non-deterministic money on the headline number.**
**Ruling:** total order — `source:'user'` beats `'insight'`, then latest `updatedAt`, then `id`. `resolveLayerPrecedence` takes an array, with a test asserting **shuffling the input does not change the output**. That test outranks the `layer`↔`basis.kind` one v1 called canonical.

### A13 — `basis.overrides` is likely unreachable, and `layer` must not be stored. (what-did-we-miss #8, Sun M12) **UPHELD.**
Precedence resolves per (period, categoryId) but assumptions are keyed by `scopeKind` + `scopeId`; a category-scoped assumption and a loan-scoped certain item never share a key unless the resolver maps every certain item's `scopeId` to a category — which v1 never states. So D2's most-valuable disclosure never fires while its test passes on a hand-built fixture.
**Rulings:** v2 states the scopeId→category mapping explicitly, or the override case is cut. `overrides` becomes an ordered `ForecastBasis[]` stack (insight-over-user-over-certain is three deep). **`layer` is derived at render via `layerOf(basis)`, not stored** — a stored `layer` breaks in snapshots where the pinning test does not look.

---

## Contract and permissions

### A14 — the scope contract does not exist, and the four-state hook cannot carry ten inputs. (Sun C3, C4) **UPHELD.**
The forecast composes ten independently-graded inputs. `useScopedRead` exposes one scalar `status` and is typed `<T extends OwnedRecord>` — `transaction_lines` rows are not `OwnedRecord` and cannot pass through it at all. `useNetWorth` already needed a side-channel for **one** ownerless input.
**Rulings:** `useForecast` returns a **per-input** `Record<InputKey, {scope, status}>`. `projectedBalance` is `null` unless **every** balance-contributing input resolved at `'family'` — a rule, not a scalar. D5's sentence is **generated from the denied set**, which also delivers the "names which inputs were unreadable" v1 promised and never implemented. **Any failed input suppresses every figure it contributes to, named.** v2 drops the claim that this "tests whether the shape generalizes" — it does not; the forecast is the case that breaks it, and saying so is the finding.

### A15 — the ModuleId is doing two jobs and the screen gate contradicts §3. (Sun H6) **UPHELD.**
`isModuleVisible` hides any tab whose `permissionModuleId` is `'none'` — so a viewer with `expenses: family` and no forecast grant loses the tab while the Dashboard card stays always-shown and drills into a hidden module.
**Ruling:** `permissionModuleId: null` (net-worth's precedent). Keep `'forecast'` in `ModuleId` purely to authorize `forecast_assumptions` writes; gate the CRUD controls on `forecast.edit`. Blast radius shrinks to `MODULE_IDS`, `MODULE_LABELS`, Rules.
**Also upheld (Sun H6 second half):** nothing stops a member with `forecast: family` and `loans: none` authoring an assumption over a loan they cannot read, with free-text `reasonHe` rendering on a **parent's** screen — member-authored content injected into a higher-privilege view, and a prompt-injection vector the day Stage 9 puts forecast facts in the AI context. v2 must either validate authorship against the scope's own module, or rule that assumptions are family-visible free text **and name them as excluded from any egress payload.**

### A16 — the Stage 8 seam is unenforced at the boundary. (Sun H7) **UPHELD — this is B4 one layer down.**
v1's protection is a source scan. This project's doctrine is that **Rules are the enforced boundary**.
**Rulings:** `isValidForecastAssumption` requires `source == 'user'` in Stage 7; Stage 8 widens it in the same commit that ships the writer. The renderer branch is dead **by rule, not convention**. **Cut the `'insight'` renderer** (Lola 12) — keep the type field. And T8 asserts explicitly that **no glossary entry describes insight-sourced assumptions** — B4 was caught from the glossary direction, not the code direction.

### A17 — delete `settings/seasonality`; a user-authored factor **is** an assumption. (Sun M13, seconded by what-did-we-miss #5) **UPHELD — best structural suggestion of the gate.**
That document falls in the `settings/{docId}` block: **write is super-admin/parent only**, so v1's "user-authored, one-click" seasonality is permission-denied for exactly the member holding the `forecast: family` grant D4 invented for it. And the block has **no value validator** — a parent could write `factor: 1e9` and the client would multiply, which is Stage 6's F1 verbatim on a doc whose corrupt value silently scales a displayed number.
**Ruling:** `scopeKind: 'seasonality'` on `forecast_assumptions`. One union member removes a document, a rules branch, a write path, a validator and a task's worth of permission ambiguity. Observed factors stay pure derivation and need no document at all.

---

## What the screen actually draws — settled on paper, because we cannot verify it in a browser

v1's four drawn decisions were hand-waves. **There is no screenshot tooling in this project**, so these are settled here or discovered in code.

### A18 — a past anchor back-projects months that already happened. (Ofra B1) **UPHELD.**
מתי is a month stepper with unbounded prev arrows; v1's D12 rules on which dimensions apply and never on a past anchor.
**Ruling:** clamp the anchor to `max(selectedPeriod, currentMonth)` and **say so on the card**. Silent back-projection is the only unacceptable option.

### A19 — the card displays a figure and does not answer the question. (Ofra B2, B3) **UPHELD.**
**Rulings — the card carries all five:** the figure; a **reference** (`מתוך ₪X` — Stage 6's own fix, "a spend with no denominator is the '% of what?' problem"); a **verdict state with a conditional colour rule**, including a designed negative state (the most important thing it can ever render, and v1 never mentions it); the certain/estimated split; and the **horizon** ("3 חודשים קדימה, מ-ספטמבר").
**Scale parity is rejected:** `Dashboard.tsx:607` is already `text-3xl md:text-4xl font-bold`. Two co-equal glance numbers is not a hierarchy. One must be subordinate, or the forecast card wins by position/panel treatment instead.
**The `'own'` card must not reuse the family slot** — opposite sign semantics in the same place. Different label position, different panel, explicit prefix (`צפוי לצאת:`), label part of the glance rather than a caption.

### A20 — "uncertainty grows with distance" is false of the data. (Ofra B4) **UPHELD.**
Recurring, loans and insurances repeat identically month over month; the band is `min/median/max` of history, identical for every projected month. The property v1 calls a requirement will not appear on screen, and only a synthetic fixture satisfies it.
**Ruling:** encode distance **explicitly** — a per-month confidence chip driven by `monthsObserved` plus committed share. Drop the claim that the split carries it.

### A21 — "an explicit gap" is a hand-wave and all three obvious renderings are wrong. (Ofra B5) **UPHELD.**
Dashed-outline and omit both read as zero; full-height grey reads as a huge expense — and the specified guard (`no ₪0`) passes for all three because **it tests the string, not the picture.**
**Ruling:** the bar renders only its certain portion at true height; the estimated portion is replaced by a marker visibly **not on the value scale** (terminating ragged edge + `?` chip, axis max unaffected). Drawn and agreed, not asserted.

### A22 — hatch is the wrong primary carrier. (Ofra H1) **UPHELD.**
It survives colour-blindness and print, and fails at mobile bar sizes, has undecided RTL direction, and has no accessible name.
**Ruling:** one stacked bar, same hue, **two luminance steps**, boundary carrying a value label ("₪4,200 מזה כבר סגור"). Quantity lands on position, the strongest visual variable; the reader gets a sentence instead of a texture. v2 must also state **how the band and the split compose** — two visual languages on one bar — and give `bandBasis: 'insufficient-history'` a per-bar marker rather than a paragraph under the chart.

### A23 — the first time-series chart in the app has no RTL decision. (Ofra H6) **UPHELD.**
The existing precedent wraps recharts in `dir="ltr"`, which is fine for category bars and wrong for a time axis: the nearest month lands at the far left, opposite where a Hebrew reader starts.
**Ruling:** decide axis direction and the mirroring rule in the plan, before the chart exists.

---

## Copy and glossary

### A24 — `תזרים` is already on screen. (Ofra H3) **UPHELD, and the meta-finding is bigger.**
`Dashboard.tsx:648` renders it in a heading today. v1's D13 declares the word "never surfaced". The reason nobody knew: **`violatesPlainLanguage`'s corpus is glossary entries only — the ban has never seen a single rendered string in the app.**
**Rulings:** fix line 648 (Dashboard is edited by this stage anyway), keep the ban, and record the corpus gap as a finding in its own right. **The question to David changes** from "may we use it" to "the app already says it — drop the ban, or fix the screen?" Recommendation: fix the screen.

### A25 — glossary is under-counted and contains three duplicates. (Ofra H5) **UPHELD.**
`forecast.loanRepayments` vs `loans.rowMonthlyPayment`, `forecast.insurancePremiums` vs `insurances.rowPremium` — either reuse the ids or make the *difference* the entire content of the new entry. Missing: `forecast.horizon`, `forecast.monthConfidence`, the `'own'` suppression itself, `forecast.unreachableTarget`, and ids for D11's double-count and D10's `planKey` caveats — both promised as hover copy, and in this app **hover copy is a glossary entry** (`Explain` renders nothing for an unknown id).
**Ruling: 17 is a floor, not a target.** Real number ~23. Split `forecast.band` into its three phrases. Authoring note: `violatesPlainLanguage` does not split on a Hebrew colon.

### A26 — every line of Hebrew in the plan is masculine-singular second person. (Ofra M2) **UPHELD.**
A family product with up to 20 members, women and girls among them, and nobody has decided this. Stage 7 is the largest copy drop in the project.
**Ruling: avoid second person entirely.** "הסכום הזה נקבע ידנית", not "אתה קבעת". Not Stage 7's job to retrofit the tree; it is Stage 7's job not to add 23 more. **Flagged to David.**
**Also upheld (Ofra M3):** D5's sentence reads as a rebuke to a child — reframe as a data statement. D8's refusal is bureaucratic and delivers a verdict the family will hear as a verdict about themselves — state the arithmetic and let them conclude. D13's replacement copy is good but is a *description*, not a name: v2 needs both a short label and the sentence under it.

---

## Product shape

### A27 — cut `forecasts`. (Lola 4, Sun D9) **UPHELD — both lenses independently.**
Its only named consumer is Stage 8, which is the stage that knows what shape it needs. Building a collection, rules block, validator, audit action and restore mode for a consumer that does not exist is the bet B4 lost. And v1's restore has an unseen dereference hazard: freezing assumption *ids* means a hard-deleted assumption leaves the provenance hover with nothing to show.
**Rulings:** cut D9 and its glossary entry. If snapshots return, they return in Stage 8, storing resolved `ForecastBasis` objects **by value**. **One exception worth keeping in scope as a measurement, not a feature:** an automatic month-close snapshot whose only purpose is calibration (A29).

### A28 — "מה צריך לקרות" computes correctly and advises uselessly. (Lola 6) **UPHELD.**
"Reduce every flexible category by 12%" is not a thing a family executes. The refusal rule is right and untouched.
**Ruling:** rank by absolute shekel contribution and **lead with the top two or three by name**, proportional table below. Also state that shaving is not the only lever — deferring past the horizon and increasing income exist, and copy implying cutting is the only path is wrong even if those are out of scope.

### A29 — no acceptance measure asks whether the forecast was right. (Lola 8) **UPHELD.**
**Rulings:** add **calibration** — `|projected − actual| / actual` per category and total, per elapsed month, and show it *in the app*: a forecast that publishes its own track record is the strongest trust-builder in this product. Plus: count of assumptions David authored (zero means the refine loop failed), and whether the full screen was ever opened. **20-member readability is near-vacuous here** (this screen is month × category) — keep it as a cheap regression, do not read it as a Stage 7 signal.

### A30 — scenario 6 is unbuildable and unowned. (Lola 7) **UPHELD.**
§4 scenario 6 promises a child sees "ההוצאות שלו, **היעדים שלו**"; `goals` is ownerless so a per-member goal does not exist. v1 names the data gap and never connects it to the scenario, and it is absent from the deferral table.
**Ruling:** `scopeKind: 'personalTarget'` on `forecast_assumptions` — one enum value gives the child an owned target and D8's machinery computes the rest. That turns the `'own'` screen from a refusal into an answer. **Seconded by Ofra M1:** reframe the whole `'own'` screen around the question a member actually owns — "כמה נשאר לי להוציא" — not "will the family be OK". And decide whether owned recurring income appears at all: rendering it beside outgoings with no balance line invites the reader to do the subtraction in their head, and get it wrong for exactly the reason D5 refuses to draw it.

### A31 — T5 is built back-to-front. (Lola 5) **UPHELD.**
Observed factors need n ≥ 2 same-calendar-months — roughly 14 months of history. That half is dead code until late 2027; the user-authored half works on day one and v1 demotes it to demo-script seed content.
**Rulings:** user-authored seasonality is first-class (as an assumption, per A17). Ship the September/April factors **offered, pre-filled, one-click-accept, attributed, editable**. R6 closes. **And the plan decides this rather than deferring it to David** (Lola 11): they are his own sentences about his own family; asking him to re-approve his own spec is deference theatre.

### A32 — drill-down and comparison mode. (Lola 9, what-did-we-miss #14) **UPHELD.**
`<Explain>` is hover-explain; §5.1's every-number-is-a-button is a different promise and v1 delivers one. §5.4's comparison mode is "לכל מסך" and this is the sixth screen to skip it.
**Ruling:** build the one natural drill (October's estimated variable spend → the rows behind that average). **Name comparison mode in the deferral table** rather than dropping it silently.

### A33 — §9's advice-boundary notice is homeless. (what-did-we-miss #9) **UPHELD.**
The spec pins the permanent "worth checking, not advice" notice to the insights screen — Stage 8. D8's allowance line is the **first thing this app ships that tells a family what to do with money**, and it is phrased as an instruction with a number.
**Ruling:** the notice ships here, with the allowance. One line, plus a decision on whether the row is phrased as an instruction or as "כדאי לבדוק".

---

## Correctness gaps v1 was silent on

### A34 — nothing recomputes when an assumption changes. (what-did-we-miss #10) **UPHELD.**
`useScopedRead` is a one-shot fetch. §3's measurable metric is *"the system recalculates following the correction"* — David's own standing demand. T4 builds the CRUD, T7 builds the hook, neither names the wiring.
**Ruling:** explicit `reload()` on assumption create/edit/retire, with a test.

### A35 — timezone is named zero times. (what-did-we-miss #13) **UPHELD.**
Stage 7 adds three new places where "which month is it" is decided. The only pinned clock in the tree is the cost gate's `Asia/Jerusalem`, added *after* a rollover bug corrupted two months of counters. Stage 3 already had tests fail under `TZ=America/LA`.
**Ruling:** one named constant, one stated rule, `'YYYY-MM'` string arithmetic throughout (the `recurringCatchup.ts` convention), and `todayPeriod`/`anchorPeriod` passed in rather than read from a clock.

### A36 — offline. (what-did-we-miss #11) **UPHELD as a named risk.**
Multi-tab persistence is enabled and the word "offline" appears in no ledger, Stages 2–6. `runTransaction` cannot execute against the offline cache, so assumption CRUD hangs rather than queueing; and the cache **can** serve a period query from a partially-cached ledger, producing a silently incomplete average — R8's failure mode by a route R8 does not cover.

### A37 — performance has never been measured in this project. (Sun M14, what-did-we-miss #15) **UPHELD.**
**Rulings:** state a row ceiling above which the screen degrades explicitly (the same shape D14 uses for thin history) — `limit()` is forbidden, because silently truncating an average is the lie the stage exists to avoid. Cache the fetched window and re-slice on filter change rather than refetching. **Record one measured number in T8** so this project finally has one.

### A38 — the mirrorability constraint is not satisfiable as stated. (Sun M11) **UPHELD.**
`netWorth.ts` branches on `scope` and calls `new Date()`; `computeDuePeriods` does `Date` arithmetic, so T2's "reuse it" contradicts the constraint two decisions earlier. And `functions/src/shared/permissions.ts` **already forbids the move** in its own header, instructing a build step instead. Stage 8's scheduled engine has no user session, so it is a *different function with different inputs*, not a file that moves.
**Ruling:** restate the constraint as something an **import-graph guard can check** — `forecast.ts` imports nothing from `firebase/*`, `src/services/*`, `src/contexts/*`, and takes `anchorPeriod`/`todayPeriod` explicitly. Record the revisit trigger as "build the tsup/esbuild share step per that file's own instruction", not "move the file".

### A39 — four guards will be born shadowed. (what-did-we-miss #8) **UPHELD, all four.**
- The **no-probability-language** denylist runs over a corpus the same agent authors — the `BANNED_JARGON` shape, already counted 4 times. And it misses the real defect: **§10's own "שמרן / צפוי / אופטימי" is probability language to a lay reader.** Add those three words to the denylist or the guard is decorative.
- The **no-month-literal** guard scans one hardcoded file (the enumeration class, and the tree-derivation technique already exists in `helpers/extractionSurfaces.ts`), and D7's own shape uses **string** keys `'01'..'12'` — a guard banning integer literals passes `'09'` cleanly. Moot for the document (A17) but not for the logic.
- The **`no ₪0`** guard is scoped to a branch that emits no symbols; the months that *will* render a misleading ₪0 are the n=1 month whose single observation was ₪0, and the empty certain layer from A9. Cheap-for-expensive violated.
- The **allow-list-is-4** assertion is tautological (A8).

### A40 — Dashboard becomes internally inconsistent, and two v1 closures are wrong. (Sun M15, M16) **UPHELD.**
`.gitignore` and `functions/.gitignore` **both already read `node_modules` with no trailing slash** — Stage 6 inheritance item (2) is already closed. v1 committed the exact "findings age the moment a fix lands" error *inside the plan that warns about it*. The `vitest.config.ts` alias is real but zero non-test files import `@/…`.
And nothing in T1–T8 converts `Dashboard.tsx:288`/`:365` onto the new read path, so after Stage 7 an `'own'` viewer sees a working forecast card beside a budget card saying they have no access to the same data.
**Rulings:** drop the closed item, deprioritise the alias, and either convert both Dashboard reads in T1 or record the incoherence with the stage that closes it.

### A41 — small but blocking-on-contact. (what-did-we-miss #16, Sun)
`ModuleRegistryEntry` requires `icon: LucideIcon`; D15's literal omits it and is quoted as drop-in. `MODULE_LABELS` is a total `Record<ModuleId,string>`, so adding the id **fails the build loudly** — which is good, and is why permission work must land early. There is **no `incomes` tab** in the registry at all: the collection the income half depends on has no screen, no service and no owner — name it in the deferral table so it is not discovered inside a task.

---

## Task order — re-ruled

v1's order was T1 first. Two lenses disagreed with each other; adjudicating between them:

**Sun** wanted T4 early (the ModuleId change breaks the build loudly, so land it before two tasks of forecast code). **What-did-we-miss** wanted T2 first (pure, no I/O, and it surfaces A9 — the empty-certain-layer killer — *before* a migration writes every row). **Both are right, and they compose.**

**Ruling — v2 order:**
1. **T0 — measure.** Read-only: run `periodOf` over the real export, report parse-failure rate and rows-per-period, settle the migration's shape. The standing rule is "reproduce before fixing"; the migration equivalent is **measure before migrating**.
2. **T1 — pure forecast core** (v1's T2), which surfaces A9 before anything is written.
3. **T2 — permissions + `forecast_assumptions`** (v1's T4) — lands the compile-breaking ModuleId change early.
4. **T3 — migration** (v1's T1), now informed by T0 and T1.
5. **T4 — demo-data generator** (new) — before the statistical layer, because it is the only way that layer gets a non-synthetic test.
6. **T5 — statistical layer, cold start, band.**
7. **T6 — seasonality-as-assumption + targets/allowances.**
8. **T7a hook + card / T7b screen + glossary / T7c guards + formatter** — v1's T7 was not one task; it cannot be reviewed as a unit and is where "the app usable after it" is least likely to hold.
9. **T8 — demo, acceptance, sweep.**

**Also ruled:** move the `readMoneyAmount`/`buildFinancialContext` closure to T8, where the egress suite is already being run — v1 put a `functions/` edit inside a task labelled "live-emulator NOT required".

---

## Two questions that go to David, and one that does not

**To David:**
1. **`תזרים`** — the app already says it on the Dashboard. Drop the ban, or fix the screen? (Recommendation: fix the screen.)
2. **Second person in Hebrew copy** — every string in the plan and much of the tree is masculine-singular. The cheap rule is to avoid second person entirely. Confirm.

**Not to David — the plan decides it (A31):** whether the September/April seasonality factors ship as offered defaults. They are his own sentences about his own family; asking him to re-approve his own spec is deference theatre. Ship them offered and one-click-editable.

**And one to ask before T3 runs:** *will the certain-layer inputs (recurring, loans, insurances, incomes, accounts) be entered before the demo?* The stage's entire day-one value is in that data, and no amount of statistical honesty substitutes for it.

---

## Controller amendments after v2 (accepted from the planner, which pushed back — correctly)

**A38 — my reason was wrong, the conclusion stands.** I wrote that `computeDuePeriods` does `Date` arithmetic. It does not: `recurringCatchup.ts` deliberately uses strings and integers only. The real reasons the mirrorability constraint is unsatisfiable as v1 stated it are that `netWorth.ts:69` calls `new Date()`, and that `computeDuePeriods` *takes* a `Date` parameter. The import-graph guard ruling is unaffected.

**A29 — calibration cannot be a Stage 7 acceptance measure, and I made the exact error I had just ruled against.** No month in Stage 7 has both a projection and an actual, so listing calibration as a done criterion would promise a number the stage cannot compute — the `unusableRowCount` defect (A5) reproduced inside the adjudication that rejected it. **Amended:** Stage 7 ships the plumbing and the empty state; the number is a Stage 8 readout.

**A30 — `personalTarget` does not land as ruled.** A member's default `forecast` grant is `'none'`, so the child the ruling exists to serve still could not author their own target. **Amended:** a self-owned `personalTarget` is authorized by the owned-module pattern, not by a `forecast` grant.

**Minor, accepted:** A19's five card elements fight A3's number-in-the-glance rule (resolved by moving the split onto the bar); A21 and A22 describe different months and are only coherent once the line is drawn at `monthsObserved === 0`.

## Tree findings from v2 that contradict BOTH documents — recorded, owned in v2

- **`FuturePlanning.tsx:264-278` renders a panel headed `תחזיות AI לעתיד`** — two hardcoded tips, no computation, on an ungated tab, about the exact capability this stage ships. Neither v1 nor this adjudication mentions it. And `:187` already reads `יעדי חיסכון` — the label v1 proposed for the renamed tab.
- **`period: 'unknown'` (A5) is shadowed on the real corpus.** All 3 rows are ISO and parse, and `firestore.rules:207`'s `date.size() == 10` blocks the unpadded legacy form from ever being client-written. Zero live instances unless the generator makes them.
- **A5 + A7 still cannot see a half-done backfill** — an untouched row has no `period` at all, so the query never returns it and `'unknown'` never counts it. The completion marker is therefore a **hard refusal**, not a caveat.
- **`incomes.month`/`year` come from the UI's selected filter, not from `date`**, while a report queries on them — so A10's `periodOf(date)` backfill would silently move rows between months. Stamp from `month`/`year` instead.
- **`ModuleId` is duplicated in `functions/src/shared/permissions.ts:17` with no test holding the unions in sync** — adding `'forecast'` breaks the build client-side (good) and drifts silently server-side.
- `FileProcessor.ts` writes `installmentNumber: null`, not absent; `createOwnedCollectionRepo.list` drops `d.id`, so the A12 tiebreak degenerates for any non-repo writer.

---

## Controller amendments after T0 (measured, not argued)

T0 was added by the gate on the principle that this project's "reproduce before fixing" rule has a migration equivalent: **measure before migrating.** It paid for itself immediately — it refuted an inference both v2 and this adjudication had drawn, and it did so with live emulator probes rather than reading.

**A5 and A7 AMENDED — `firestore.rules` does NOT block unparseable dates.** `date.size() == 10` is a **length** check, not a format check. Proven with 7 assertions on an isolated emulator: a parent can create `date: "2026/03/15"`, and a **matrix-governed `'member'` — the least-privileged role — can create `date: "9999-99-99"`.** Both are 10 characters and both make `parseTransactionDate` return `null`.
The narrow claim (the unpadded `9/3/2026` form is blocked) is true. The **inference** built on it — that `period: 'unknown'` is "shadowed by construction" and unparseable rows "can arrive only via the Admin SDK" — is **false**. It is shadowed by the corpus's *current contents*, which is a fact with an expiry date. `period: 'unknown'` is a live path, not a defensive one.

**A7 GROWN — the immutability guard would be born bypassed for most of the family.** `allow update` is `… && (isSuperAdmin() || isParent() || <post-image checks>)`. Probes confirm a parent can set `date` to the **number** `12345`, can change `date` without touching `period` (reproducing A7's divergence hazard live), and can change `owner`. Putting `period`/`ownerId` immutability on the matrix-governed branch — "the shape the rules already use for `owner`" — inherits that bypass. **Two of the three members are `הורה`**, so the guard would bind one member out of three, and not the two most likely to edit rows. **A7 is not settled; v2's D21(d) must place the check where parents cannot route around it.**

**A4 CORRECTED — the two-`in` shape breaks at N ≥ 5, not N ≥ 6.** A5's seventh `in` value (`'unknown'`) makes the DNF product `7N`, not `6N`. v2's D21(b) states 6N and pins the wrong number in a test.

**R8 CORRECTED — four shadowed paths, not one:** `period:'unknown'`, `ownerId:'unknown'`, D10's instalment-`null` branch, and the row ceiling. All four are reachable only via the demo generator, which makes it a **prerequisite for the statistical layer's and the guard task's evidence**, not a convenience.

**T1's instalment checkbox is unsatisfiable as written.** It says to assert against "a real extraction fixture" and not to inherit the assumption — but there are **zero instalment rows** and no fixture anywhere sets `installmentNumber` to a number. T1 can only author a fixture, which encodes the very assumption the checkbox forbids inheriting. Rewrite it as: author the fixture, state the assumption it encodes, and mark it for confirmation against David's first real credit-card import.

### Measured facts that set the stage's real starting conditions
- **The entire ledger is 14 documents.** `transaction_lines` 3, legacy `transactions` 3, `members` 3, `permissions` 1, `settings/budgetConfig` 1, `audit_log` 2, one chat session. `incomes`, `recurring`, `loans`, `insurances`, `goals`, `accounts`, `investments`, `documents`, `groups` **do not exist as collections**.
- **`settings/budgetConfig` is `{"members": []}`** — an *empty* array. There are **zero targets of any kind**, so the "what needs to happen" line has no target source with data in it on day one.
- Date parse **3/3**; rows that would get `period: 'unknown'` today: **0**. Owner resolution **3/3**; A6's orphan set is empty.
- A 6-month family-scope read returns **3 documents today**; **3,000–4,800** for 20 members with a realistic year (~1.1–1.7 MB at a measured ~384 B/row). מי is filtered client-side, so narrowing to one member does **not** shrink the payload. **Recommended explicit-degradation threshold: 2,000 rows.**
- A10 is **unmeasurable** (`incomes` is empty), but the mechanism is confirmed by reading both writers: `period` must be derived from `month`/`year`, never from `date`.
- **With 3 rows in 1 month, the statistical layer's cold-start state is not an edge case — it is the only state that renders on real data.**
