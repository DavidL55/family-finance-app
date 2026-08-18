# Stage 7 — T0: measurements of the real corpus

**Read-only.** No collection was modified. Method: `.emulator-data` copied to a scratch directory,
Firestore emulator booted from the **copy** on port 8080 with **no `--export-on-exit`**; every figure
below read back over the emulator REST API. `npm run emu` was never run. Rules probes ran under
`@firebase/rules-unit-testing` on the isolated project id `demo-familyfinance-t0-probe`, never against
the imported data. After shutdown `.emulator-data/.../output-0` is byte-identical
(`md5 43c70f313ae10d46a4c92445e532f2e1`, mtime unchanged).

Baseline: branch `familyfinance-v2`, HEAD `a432ee4`. Plan under measurement:
`2026-08-18-stage7-forecast-v2.md`. Rulings under test: **A4, A5, A6, A7, A8, A10**.

---

## 1. Corpus census — verified, not repeated

Root collections actually present (`:listCollectionIds`): `audit_log`, `chat_sessions`, `members`,
`permissions`, `settings`, `transaction_lines`, `transactions`. **Everything else is absent, not empty.**

| Collection | Docs |
|---|---|
| `transaction_lines` | **3** |
| `transactions` (legacy) | 3 |
| `members` | 3 |
| `permissions` | 1 |
| `settings` | 1 (`budgetConfig` only) |
| `audit_log` | 2 |
| `chat_sessions` (root docs) | 0 (1 doc at `chat_sessions/david-levy/sessions/probe-4`) |
| `incomes`, `recurring`, `loans`, `insurances`, `goals`, `accounts`, `investments`, `documents`, `groups` | **0 — collection does not exist** |

**14 documents in the entire ledger.** Plan §1.3 item 22 is confirmed exactly.

`settings/budgetConfig` = `{ "members": [] }` — the plan says "a `members` array, no per-category
budgets"; the array is also **empty**. D29 treats `budgetConfig` as a *target* source: there are
currently **zero targets of any kind** in the corpus.

`members`: `david-levy`/`דויד`/`הורה`, `lilit-levy`/`לילית`/`הורה`, `omer-levy`/`עומר`/`ילד`.
**Two of the three members are parents** — load-bearing for §7 below.

### `transaction_lines` — full contents

| id | date | amount | category | owner |
|---|---|---|---|---|
| `migrated-legacy-A` | `2026-03-15` | 250 | `מגורים ובית` | `דויד` |
| `migrated-legacy-B` | `2026-03-20` | 100 | `בריאות` | `לילית` |
| `migrated-legacy-C` | `2026-03-22` | 50 | `שונות` | `עומר` |

Field-key union: `date, amount, category, description, vendor, owner, isCredit, driveFileId,
legacyId, migratedAt`. **No `period` on any row. No `ownerId` on any row.**

**Date range: a single week — 2026-03-15 to 2026-03-22. One period, `2026-03`.**
**Category spread: 3 rows, 3 distinct categories, one row each.**

---

## 2. Date parse rate (A5)

`parseTransactionDate` (`src/utils/transactionFilters.ts`) run over all 3 rows:

- **parse OK: 3 / 3 (100%)**
- **parse FAIL: 0**
- **rows that would get `period: 'unknown'`: 0 (0.0%)**
- Formats present: `ISO YYYY-MM-DD` ×3. The legacy `DD/MM/YYYY` form appears **nowhere**, in
  `transaction_lines` or in the legacy `transactions` collection (also 3/3 ISO).

**Plan finding 1.2.2 is confirmed on the numbers.** `period: 'unknown'` and `unusableRowCount` have
**zero live instances**, and are shadowed until T4's generator emits unparseable rows.
**But the plan's stated *reason* is refuted — see §7.**

---

## 3. Owner resolution (A6)

- Distinct `owner` values: 3 — `דויד` ×1, `לילית` ×1, `עומר` ×1.
- **Resolve to a live `members/{id}.name`: 3 / 3. Unresolvable: 0.**

A6's orphan set is **empty today**. The migration's `ownerId: 'unknown'` branch is therefore a third
shadowed path alongside `period: 'unknown'` — it will be written by the backfill zero times on this
corpus, so T3 cannot use the real data to prove it works.

---

## 4. Rows per period and the query shape (A4)

**Rows per `YYYY-MM`: `{ "2026-03": 3 }`.** One period. Nothing else exists.

**A 6-month family-scope read today returns 3 documents** — `where('period','in',[6 periods +
'unknown'])` matches only `2026-03`; the other six values return nothing.

Projection at ~384 bytes of field JSON per row (measured: 442 / 355 / 354), ~350–450 B on the wire:

| Scenario | rows/month | 6-month read | ≈ payload | 12-month |
|---|---|---|---|---|
| today (real corpus) | 3 (one month only) | **3** | ~1 KB | 3 |
| 6 spenders × 25 rows/mo | 150 | 900 | ~0.3 MB | 1,800 |
| 20 members × 25 rows/mo | 500 | **3,000** | ~1.1 MB | 6,000 |
| 20 members × 40 rows/mo (statement-heavy) | 800 | **4,800** | ~1.7 MB | 9,600 |

**The number that sets the ceiling: a family of 20 with a realistic year of data returns 3,000–4,800
documents for a 6-month family-scope read.** Because מי is filtered **client-side** (A4's ruling),
narrowing to one member does **not** reduce the payload — the ceiling is set by family size × window,
regardless of what the viewer selected. With `limit()` forbidden, the screen must degrade explicitly
above a stated row count. Recommended threshold for T3/T7a: **2,000 returned rows**, at which the
screen names the count and offers a narrower window rather than truncating.

**DNF arithmetic, restated with A5's seventh value.** Firestore caps disjunctions after DNF expansion
at 30. D21(b) computes `owner in [N] × period in [6] = 6N`, so `N ≥ 6` fails. But D21(c) mandates the
query send **7** values (6 periods + `'unknown'`). The real product is **`7N`**, so **`N ≥ 5` fails**,
not `N ≥ 6`. A4's conclusion — exactly one `in` clause — is unchanged and correct; the threshold as
written in D21(b) is off by one member, and D21(b) says a structural test pins it.

---

## 5. The `incomes` shape (A10)

**`incomes` has 0 documents. The collection does not exist.** The month/year-vs-`date` divergence count
is **0 of 0 — unmeasurable on the real corpus.**

The *mechanism* is confirmed by reading the two writers:

- `Dashboard.tsx:437-455` — `handleSaveIncomes` writes `month: selectedMonth, year: selectedYear`
  **from the UI's currently selected filter**, while `date: e.date` is free text. Confirmed verbatim.
  (`handleAddIncome` defaults `date` to `01/${selectedMonth}/${selectedYear}`, so a *new* row agrees
  by construction; divergence appears the moment a user edits the date without changing the filter.)
- `RecurringService.ts:230-238` — writes `date`, `month` and `year` **all three derived from the same
  `period`**, so recurring-posted income rows are internally consistent by construction.
- `CentralExpenseReport.tsx` queries `where('month','==')` + `where('year','==')`.

**A correct `period` stamp for `incomes` must be derived from `month`/`year`, not from `date`** —
D23(b) is right. `month`/`year` are what an existing report already queries on, and for the only
programmatic writer they are derived from the period anyway. Deriving from `date` would move
Dashboard-authored rows out from under a live query.

**Consequence for T3:** its checkbox "with the divergence count from T0 recorded" resolves to **0 of 0**.
That is not evidence D23's deferral is a footnote — it is evidence the corpus cannot answer the
question. The number becomes measurable only after real income data exists.

---

## 6. Instalments (finding 1.2.7 / D10)

Across all 3 rows: `installmentNumber` **absent ×3** (present 0, null 0);
`totalInstallments` **absent ×3** (present 0, null 0).

Zero instalment rows exist. Moreover, **no fixture anywhere in `src/` or `functions/src/` sets
`installmentNumber` to a number** — the only numeric instalment values in the tree are inside the AI
prompt example at `functions/src/handlers/aiExtractDocument.ts:156-157`, which is prompt text, not a
fixture. `FileProcessor.ts:561-562`'s `?? null` is confirmed, but the `null` case it produces has **no
instance in the corpus**, so D10's null-vs-absent branch is a **fourth shadowed path**.

---

## 7. Where the data contradicts the plan

**(a) The refutation. `firestore.rules` does not block unparseable dates — it only blocks strings that
are not exactly 10 characters.** Plan finding 1.2.2, A5 and D21(c) all rest on: *"`firestore.rules:207`
requires `date.size() == 10` on create, so no client can ever write the unpadded legacy form;
unparseable dates can arrive only via the Admin-SDK migration or pre-Stage-1 data."* Seven assertions
on the live emulator, all passing:

| Probe | Result |
|---|---|
| A — parent CREATE `date: "2026/03/15"` (10 chars, `parseTransactionDate` → `null`) | **SUCCEEDS** |
| B — matrix-governed `'member'` CREATE `date: "9999-99-99"` (10 chars, month 99 → `null`) | **SUCCEEDS** |
| C — control: CREATE `date: "9/3/2026"` (8 chars) | fails, as the plan says |
| D — parent UPDATE `date` to the **number** `12345` | **SUCCEEDS** |
| E — parent UPDATE `date` without touching `period` (they diverge) | **SUCCEEDS** |
| F — parent UPDATE changes `owner` | **SUCCEEDS** |
| G — control: `'member'` UPDATE changes `owner` | fails, as the rules intend |

`date.size() == 10` is a **length** check, not a format check. Any 10-character string passes,
including `"2026/03/15"` and `"9999-99-99"`, both of which `parseTransactionDate` rejects. The plan's
narrow claim (the *unpadded* `9/3/2026` form is blocked) is true; the inference drawn from it —
`period: 'unknown'` is *"shadowed by construction"* and unparseable rows *"can arrive only via the
Admin SDK"* — is **false**. It is shadowed **by the current corpus's contents**, which is a fact with
an expiry date, not a structural guarantee. R8's mitigation (T4 must generate unparseable rows) is
still right, but it is now load-bearing for correctness rather than for test coverage: the `'unknown'`
path is reachable by the least-privileged role in the app, today.

**(b) D21(d)'s immutability guard would be born bypassed for two of this family's three members.**
`transaction_lines`'s `allow update` is
`canAccessExpenses('edit', resource.data) && (isSuperAdmin() || isParent() || (<post-image checks>))`.
Probes D/E/F show the entire post-image validation — `owner` immutability, `amount > 0`,
`date.size() == 10` — is skipped for a parent. D21(d) proposes adding `period`/`ownerId` immutability
*"on the matrix-governed branch (the shape the rules already use for `owner`)"*. That shape inherits
the bypass. In the real corpus `david-levy` and `lilit-levy` are both `הורה`, so the guard would bind
**one member out of three** — and not the two most likely to be editing rows. A7's stated hazard
("the two can diverge and every reader picks a different one") is reproduced live by probe E. **T2
should place `period`/`ownerId` immutability outside the parent bypass**, or state explicitly that
parents may desynchronise `period` from `date` and say what the forecast does about it.

**(c) T1's instalment checkbox cannot be satisfied as written.** T1 says *"**Assert against a real
extraction fixture** that `amount` on an instalment row is the per-instalment charge (D10). Do not
inherit the assumption."* Per §6, no such fixture exists and no instalment row exists. T1 can only
*author* a fixture, and authoring one encodes the assumption the checkbox forbids inheriting. The
question must be settled from the extraction prompt/provider contract, or the checkbox reworded.

**(d) The statistical layer has no corpus to be statistical about.** 3 rows, 1 period, 3 distinct
categories, one row per category. Any moving average over history — per category or in total — has a
sample size of **1 month and 1 row**. D26's cold-start path is not an edge case to be handled after the
happy path; on the real data it is the **only** state that renders. T4's generator is on the critical
path for seeing any forecast at all, not just for exercising guards.

**(e) `settings/migrationState` does not exist**, so D21(d)'s completion marker starts absent and the
statistical layer's refusal is the correct default from the first boot.

**(f) Four shadowed paths, not one.** R8 names `period: 'unknown'` / `unusableRowCount`. The corpus
also shadows `ownerId: 'unknown'` (§3), D10's instalment-`null` branch (§6), and the row-ceiling
degradation of §4. All four are reachable only through T4's generator.

---

## What this settles

**Decided.** **A5** is settled on the number that decides it: **0 rows would get `period: 'unknown'`**
(3/3 parse, all ISO) — the mechanism ships shadowed, and R8's requirement that T4 generate unparseable
rows is confirmed as necessary, though for a stronger reason than the plan gives, since §7(a) shows the
`'unknown'` path is client-reachable rather than blocked by Rules. **A6** is settled: **3/3 owners
resolve, orphan set empty**; the migration's `ownerId` stamp is safe to run and its `'unknown'` branch
is unexercised by real data. **A4** is settled concretely: a 6-month family read returns **3 documents
today** and **3,000–4,800 for a family of 20 with a year of data**, which sets the explicit-degradation
threshold (recommended: 2,000 rows) — with the correction that A5's seventh `in` value makes the DNF
product `7N`, so the two-`in` shape breaks at **N ≥ 5**, not N ≥ 6. **A10** is settled on mechanism if
not on magnitude: `period` for `incomes` must be derived from **`month`/`year`**, confirmed against both
writers; the divergence count is **0 of 0** because the collection is empty.

**Still open.** **A7** is *not* settled and has grown: §7(b) shows the immutability guard as specified
would be bypassed for parents, i.e. for two of this family's three members — T2 must place it outside
the parent bypass or rule explicitly that it does not bind them. **A8**'s `scripts/` blind spot is
unaffected by measurement and remains T3's to close. The **instalment `amount` semantics** behind D10
are unresolvable from this corpus (§7(c)) and need a source other than data. And every guard whose
input class is empty — `period: 'unknown'`, `ownerId: 'unknown'`, instalment-`null`, the row ceiling —
is now formally **blocked on T4**, which makes the demo-data generator a prerequisite for T3's and
T7c's evidence rather than a convenience.
