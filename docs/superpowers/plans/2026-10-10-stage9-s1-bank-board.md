# Stage 9 S1 — Bank Board (bank_lines → joint account: status · balances · trends) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the family's bank-account transactions into the app (`bank_lines`) and ship the first of the six boards — the bank board — with the joint account's status, balances and 12-month trend, every figure explaining itself (hover) and breaking down (click).

**Architecture:** A new owned collection `bank_lines` is written ONLY by the Python sync pipeline (`family-data/tools/statements/ingest_bank.py`, emulator owner token); the client reads it through the existing `createOwnedCollectionRepo` and Rules deny every client write. A declarative board registry (`src/config/boards.ts`) describes the bank board's sections; a pure resolver (`src/lib/boards/resolveBank.ts`) turns `BankLine[]` into `ResolvedSection[]` (value + breakdown items + source); one renderer (`src/components/BoardScreen.tsx`) draws any board from the registry using the existing `Explain` + `FigureBreakdown`. No business logic in components.

**Tech Stack:** React 18 + TypeScript (Vite), Firestore emulator (`@firebase/rules-unit-testing` for rules), vitest + @testing-library/react, Python 3 (stdlib only) for the pipeline, lucide-react icons, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-10-six-boards-design.md` (§4.1 bank_lines, §5 registry/renderer, §8 tests, §9 security, §10 stage 1).

## Global Constraints

- A failed read renders an **error**, never an empty state (project rule; `createOwnedCollectionRepo.list` rejects, it does not return `[]`).
- Every rendered figure is wrapped in `<Explain id>` with an entry in `GLOSSARY` and carries a `source` (spec §3 rule 4).
- Every `FigureBreakdown` with items: `Σ items.amountILS === value ± 0.01`.
- No hook may sit below an early return in any component (regression of 09.10.2026).
- Client code never writes `bank_lines`; the pipeline is the only writer (Rules: `allow write: if false`).
- Hebrew UI copy, RTL; no hover-only critical information (Explain renders an ⓘ trigger on touch).
- Emulator project id everywhere: `family-finance-app-c9aa4`; pipeline writes with `Authorization: Bearer owner`.
- Commit after every task; `npm run lint` (tsc) must be clean at every commit.

## Review Focus

Inputs the spec implies but no feature test exercises by default — each gets its test in the owning task:

1. **Unverified ledger rows** (`verified: false`, debit and credit both `null`) must not change any balance or sum — Task 4 (`resolveBank`) test `ignores unverified rows`.
2. **Internal transfers** (`kind: 'transfer-internal'`) must count in neither "in" nor "out" of the month — Task 4 test `internal transfers are neutral`.
3. **An account with zero lines** renders the empty state ("אין תנועות עדיין"), not an error and not ₪0 as if true — Task 6 test `account without lines → empty, other accounts still render`.
4. **A line dated after today** (an export printed with tomorrow's date, seen 09.10.2026) must not become "today's balance" — Task 4 test `balance today ignores future-dated rows`.
5. **Overdraft (negative balance)** renders with its sign and its breakdown still reconciles — Task 4 test `negative balance reconciles`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/types/bank.ts` (create) | `BankLine`, `BankLineKind` — the client's view of a ledger row |
| `src/services/BankLinesService.ts` (create) | `listBankLines = createOwnedCollectionRepo<BankLine>('bank_lines','bankLine').list` |
| `firestore.rules` (modify, after `match /accounts`) | `match /bank_lines`: read via `canAccessOwnedModule('accounts','view')`, write denied |
| `firestore-tests/bank-lines.rules.test.ts` (create) | rules: parent reads all, member reads own, child without view reads nothing, every client write fails |
| `family-data/tools/statements/ingest_bank.py` (modify) | step 5: `bank_lines` docs (deterministic ids, `kind`, `counterpartAccountId`), `accounts.accountNumber`; `--self-test` |
| `src/config/boards.ts` (create) | `BoardDef`/`BoardSection`/`SectionQuery` types + `BOARDS` (only `bank` in S1) |
| `src/config/glossary.ts` (modify) | `bank.*` entries |
| `src/lib/boards/types.ts` (create) | `ResolvedFigure`, `ResolvedSection`, `FigureSource` |
| `src/lib/boards/resolveBank.ts` (create) | pure: `resolveBankBoard(lines, accounts, today) → ResolvedSection[]` |
| `src/lib/boards/monthSeries.ts` (create) | pure: month-end balances and monthly nets for 12 months |
| `src/components/Sparkline.tsx` (create) | 12-point inline SVG, no library |
| `src/components/BoardScreen.tsx` (create) | board selector + sections accordion + figures; the ONE renderer |
| `src/hooks/useBankBoardData.ts` (create) | reads accounts + bank_lines for the session scope; `{status, lines, accounts, error}` |
| `src/config/moduleRegistry.ts` (modify) | entry `boards` (group `daily`, gated by `accounts`) |
| `src/App.tsx` (modify, renderContent switch) | `case 'boards'` |
| `src/__tests__/boards.registry.test.ts` (create) | registry guard: explainIds exist, ids unique |
| `src/__tests__/resolveBank.test.ts` (create) | resolver math + Review Focus 1/2/4/5 |
| `src/__tests__/BoardScreen.test.tsx` (create) | loading/error/empty/ok, Explain presence, hook order on loading→ready |

---

### Task 1: `BankLine` type + `BankLinesService`

**Files:**
- Create: `src/types/bank.ts`
- Create: `src/services/BankLinesService.ts`
- Test: `src/__tests__/BankLinesService.test.ts`

**Interfaces:**
- Produces: `BankLine`, `BankLineKind`, `BANK_LINE_KINDS`, `listBankLines(scope: 'own'|'family', viewerMemberId: string): Promise<BankLine[]>`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/BankLinesService.test.ts
import { describe, it, expect, vi } from 'vitest';

const mockList = vi.fn(async () => []);
vi.mock('../services/financeCollections', () => ({
  createOwnedCollectionRepo: vi.fn(() => ({ list: mockList, save: vi.fn(), remove: vi.fn() })),
}));

describe('BankLinesService', () => {
  it('is a read-only repo over the bank_lines collection', async () => {
    const { createOwnedCollectionRepo } = await import('../services/financeCollections');
    const svc = await import('../services/BankLinesService');
    expect(createOwnedCollectionRepo).toHaveBeenCalledWith('bank_lines', 'bankLine');
    await svc.listBankLines('own', 'david-levy');
    expect(mockList).toHaveBeenCalledWith('own', 'david-levy');
    // the pipeline is the only writer — the service must not export save/remove
    expect('saveBankLine' in svc).toBe(false);
    expect('deleteBankLine' in svc).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/BankLinesService.test.ts`
Expected: FAIL — `Cannot find module '../services/BankLinesService'`

- [ ] **Step 3: Write the type and the service**

```ts
// src/types/bank.ts
import type { OwnedRecord } from './finance';

/** Spec §4.1 — classification assigned by the sync pipeline, never by the client. */
export const BANK_LINE_KINDS = [
  'card-charge', 'standing-order', 'transfer-internal', 'transfer-in',
  'cash', 'fee', 'income', 'other',
] as const;
export type BankLineKind = (typeof BANK_LINE_KINDS)[number];

/**
 * One bank-account transaction (Hapoalim ledger row). ownerId = the account's owner
 * ('david-levy' for the joint account; parents read everything through the Rules bypass).
 * Written only by family-data/tools/statements/ingest_bank.py.
 */
export interface BankLine extends OwnedRecord {
  accountId: string;            // 'acc-poalim-joint' | 'acc-poalim-david' | 'acc-poalim-lilit'
  accountNumber: string;        // '12-559-305397'
  date: string;                 // ISO yyyy-mm-dd
  period: string;               // 'YYYY-MM'
  action: string;               // the bank's own text
  debit: number | null;
  credit: number | null;
  balance: number;              // running balance AFTER this line
  kind: BankLineKind;
  counterpartAccountId: string | null;
  source: string;               // file the row came from
  verified: boolean;            // direction proven by the balance chain / explicit columns
}
```

```ts
// src/services/BankLinesService.ts
import { createOwnedCollectionRepo } from './financeCollections';
import type { BankLine } from '../types/bank';

// Read-only on purpose: the sync pipeline is the single writer (spec §4.1, §9). Exposing
// save/remove here would invite a client write path the Rules deny anyway.
const repo = createOwnedCollectionRepo<BankLine>('bank_lines', 'bankLine');
export const listBankLines = repo.list;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/BankLinesService.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/types/bank.ts src/services/BankLinesService.ts src/__tests__/BankLinesService.test.ts
git commit -m "feat(bank): BankLine type and read-only BankLinesService (Stage 9 S1 T1)"
```

---

### Task 2: Firestore Rules for `bank_lines` + rules tests

**Files:**
- Modify: `firestore.rules` (insert right after the `match /accounts/{docId} { … }` block, ~line 478–490)
- Create: `firestore-tests/bank-lines.rules.test.ts`

**Interfaces:**
- Consumes: existing helpers `canAccessOwnedModule(module, action, data)`, `isSuperAdmin()`, `isParent()`; the fixture conventions of `firestore-tests/finance-modules.rules.test.ts` (custom claims `{ role, memberId }`; a member's level lives on `members/{memberId}.resolvedPermissions` — `myLevel()` reads it from there).

- [ ] **Step 1: Write the failing rules tests**

```ts
// firestore-tests/bank-lines.rules.test.ts
// Rules suite for `bank_lines` (Stage 9 S1). Same harness as finance-modules.rules.test.ts:
// identities are fabricated via testEnv.authenticatedContext(uid, { role, memberId }).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, deleteDoc, where } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;
const DAVID = { uid: 'uid-david', memberId: 'david-levy', role: 'super-admin' as const };
const LILIT = { uid: 'uid-lilit', memberId: 'lilit-levy', role: 'parent' as const };
const OMER  = { uid: 'uid-omer',  memberId: 'omer-levy',  role: 'member' as const };   // accounts view:'own'
const LIOR  = { uid: 'uid-lior',  memberId: 'lior-levy',  role: 'member' as const };   // accounts view:'none'

const line = (id: string, ownerId: string, accountId: string) => ({
  id, ownerId, accountId, accountNumber: '12-559-305397', date: '2026-10-05', period: '2026-10',
  action: 'העברה-נייד', debit: null, credit: 7000, balance: 7042.04, kind: 'transfer-internal',
  counterpartAccountId: 'acc-poalim-david', source: 'test', verified: true,
  createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z',
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-familyfinance',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Rules read a member's level from members/{memberId}.resolvedPermissions (firestore.rules
    // myLevel → myMember()), NOT from permissions/* — same fixture shape as finance-modules.rules.test.ts.
    const member = (m: { uid: string; memberId: string }, resolvedPermissions?: object) => setDoc(doc(db, 'members', m.memberId), {
      id: m.memberId, name: m.memberId, role: 'x', color: '#000000', groups: [], uid: m.uid,
      createdAt: 'x', updatedAt: 'x', ...(resolvedPermissions ? { resolvedPermissions } : {}),
    });
    await member(DAVID); await member(LILIT);
    await member(OMER, { accounts: { view: 'own', edit: 'none' } });
    await member(LIOR, { accounts: { view: 'none', edit: 'none' } });
    await setDoc(doc(db, 'bank_lines', 'bl-joint-1'), line('bl-joint-1', 'david-levy', 'acc-poalim-joint'));
    await setDoc(doc(db, 'bank_lines', 'bl-omer-1'),  line('bl-omer-1',  'omer-levy',  'acc-omer'));
  });
});

const as = (m: { uid: string; role: string; memberId: string }) =>
  testEnv.authenticatedContext(m.uid, { role: m.role, memberId: m.memberId }).firestore();

describe('bank_lines — read', () => {
  it('a parent reads every line (joint account included)', async () => {
    await assertSucceeds(getDocs(collection(as(LILIT), 'bank_lines')));
  });
  it('a member with accounts.view=own reads only lines he owns', async () => {
    await assertSucceeds(getDoc(doc(as(OMER), 'bank_lines', 'bl-omer-1')));
    await assertFails(getDoc(doc(as(OMER), 'bank_lines', 'bl-joint-1')));
    await assertSucceeds(getDocs(query(collection(as(OMER), 'bank_lines'), where('ownerId', '==', 'omer-levy'))));
    await assertFails(getDocs(collection(as(OMER), 'bank_lines')));
  });
  it('a member with accounts.view=none reads nothing, not even his own', async () => {
    await assertFails(getDoc(doc(as(LIOR), 'bank_lines', 'bl-omer-1')));
  });
});

describe('bank_lines — every client write is denied, super-admin included', () => {
  it('create', async () => {
    await assertFails(setDoc(doc(as(DAVID), 'bank_lines', 'bl-new'), line('bl-new', 'david-levy', 'acc-poalim-joint')));
  });
  it('update', async () => {
    await assertFails(updateDoc(doc(as(DAVID), 'bank_lines', 'bl-joint-1'), { balance: 1 }));
  });
  it('delete', async () => {
    await assertFails(deleteDoc(doc(as(LILIT), 'bank_lines', 'bl-joint-1')));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `firebase emulators:exec --project demo-familyfinance --only firestore "vitest run --config vitest.rules.config.ts firestore-tests/bank-lines.rules.test.ts"`
Expected: FAIL — reads by LILIT fail (no `match /bank_lines`, default deny). Writes already fail (default deny) — that is expected to pass already.

- [ ] **Step 3: Add the rules block**

Insert after the closing `}` of `match /accounts/{docId} { … }`:

```
    // ── Stage 9 S1 — bank_lines: the bank ledger, written ONLY by the sync pipeline ──────
    // Read follows the `accounts` module permission (spec §9): parents/super-admin bypass,
    // a member needs accounts.view != 'none' and must own the line (ownerId = account owner).
    // There is no client write path at all: every row is produced by family-data's
    // ingest_bank.py against the emulator with the owner token. A client write here would
    // be a forged bank statement, so create/update/delete are denied for everyone.
    match /bank_lines/{docId} {
      allow read: if canAccessOwnedModule('accounts', 'view', resource.data);
      allow create, update, delete: if false;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: same command as Step 2.
Expected: PASS (6 tests). Then run the whole rules suite once: `npm run test:rules` — expected: all green (no other block touched).

- [ ] **Step 5: Commit**

```bash
git add firestore.rules firestore-tests/bank-lines.rules.test.ts
git commit -m "feat(rules): bank_lines — read via accounts permission, no client writes (Stage 9 S1 T2)"
```

---

### Task 3: Pipeline writes `bank_lines` (+ `accounts.accountNumber`)

**Files:**
- Modify: `family-data/tools/statements/ingest_bank.py` (gitignored — personal data; still commit nothing, but keep the file's docstring current)
- Test: `python3 family-data/tools/statements/ingest_bank.py --self-test` (pure functions, no emulator) and an emulator idempotency run.

**Interfaces:**
- Consumes: `extracted/bank-ledgers.json` rows `{account, date, action, debit, credit, balance, verified, source}` produced by `merge_ledgers.py`; the existing `patch()`/`fs_value()`/`get_coll()` helpers and `ACCOUNT_DOC` map in `ingest_bank.py`.
- Produces: Firestore docs `bank_lines/{id}` in the `BankLine` shape of Task 1; `accounts/{id}.accountNumber`.

- [ ] **Step 1: Add the pure functions with a self-test (write the test first — it runs against the functions below)**

Append to `ingest_bank.py` (above `main()`):

```python
import hashlib
from datetime import datetime, timezone

OWNER_OF = {"acc-poalim-david": "david-levy", "acc-poalim-joint": "david-levy", "acc-poalim-lilit": "lilit-levy"}

# Spec §4.1 — kind from the bank's action text. Order matters: first match wins. Internal
# transfers are decided by pairing (counterpart), not by text, so they are not in this table.
BANK_KIND_RULES = [
    ("כרטיסי אשראי ל", "card-charge"), ("מקס איט", "card-charge"), ("מסטרקרד", "card-charge"),
    ("ישראכרט", "card-charge"), ("כאל", "card-charge"),
    ("משיכה מבנקט", "cash"), ("משיכת מזומן", "cash"),
    ("ע.מפעולות", "fee"), ("עמ'", "fee"), ("עמלת", "fee"), ("ריבית", "fee"), ("רבית", "fee"),
    ("יעל תוכנה", "income"), ("זיכוי מלאומי", "income"), ("ביטוח לאומי", "income"), ("קצבת ילדים", "income"),
    ("זיכוי מדיסקונט", "income"), ("פייבוקס", "income"),
    ("מכבי", "standing-order"), ("כלל השתלמות", "standing-order"), ("הראל", "standing-order"),
    ("ארנונה", "standing-order"), ("חשמל", "standing-order"), ("מים", "standing-order"),
    ("סלקום", "standing-order"), ("פרטנר", "standing-order"), ("הוט", "standing-order"),
]

def classify_kind(action: str, credit, counterpart_id) -> str:
    if counterpart_id:
        return "transfer-internal"
    for needle, kind in BANK_KIND_RULES:
        if needle in action:
            return kind
    if credit:
        return "transfer-in"
    return "other"

def bank_line_id(acct: str, r: dict) -> str:
    """Same identity as merge_ledgers.key(): (account, date, balance, signed amount)."""
    signed = round((r.get("debit") or 0) - (r.get("credit") or 0), 2)
    return "bl-" + hashlib.sha1(f"{acct}|{r['date']}|{round(r['balance'], 2)}|{signed}".encode()).hexdigest()[:20]

def bank_line_doc(acct: str, r: dict, counterpart_id, now_iso: str) -> tuple[str, dict]:
    doc_id = bank_line_id(acct, r)
    account_id = ACCOUNT_DOC[acct]
    return doc_id, {
        "id": doc_id, "ownerId": OWNER_OF[account_id], "accountId": account_id, "accountNumber": acct,
        "date": r["date"], "period": r["date"][:7], "action": r["action"],
        "debit": r.get("debit"), "credit": r.get("credit"), "balance": float(r["balance"]),
        "kind": classify_kind(r["action"], r.get("credit"), counterpart_id),
        "counterpartAccountId": counterpart_id, "source": r.get("source", ""),
        "verified": bool(r.get("verified")), "createdAt": now_iso, "updatedAt": now_iso,
    }

def self_test() -> None:
    r = {"date": "2026-10-05", "action": "מכבי", "debit": 249.35, "credit": None, "balance": 16241.5, "verified": True, "source": "x"}
    a, b = bank_line_id("12-559-305370", r), bank_line_id("12-559-305370", dict(r))
    assert a == b and a.startswith("bl-") and len(a) == 23, "id must be deterministic"
    assert classify_kind("מכבי", None, None) == "standing-order"
    assert classify_kind("העברה-נייד", 7000.0, "acc-poalim-david") == "transfer-internal"
    assert classify_kind("העברה-נייד", 7000.0, None) == "transfer-in"
    assert classify_kind("כרטיסי אשראי ל", None, None) == "card-charge"
    assert classify_kind("משהו לא מוכר", None, None) == "other"
    _, d = bank_line_doc("12-559-305397", r, None, "2026-10-10T00:00:00+00:00")
    assert d["ownerId"] == "david-levy" and d["accountId"] == "acc-poalim-joint" and d["period"] == "2026-10"
    print("self-test ok")
```

And at the top of `main()`: `if "--self-test" in sys.argv: self_test(); return`.

- [ ] **Step 2: Run the self-test**

Run: `python3 family-data/tools/statements/ingest_bank.py --self-test`
Expected: `self-test ok`

- [ ] **Step 3: Write bank_lines + accountNumber in `main()`**

Replace the block that builds `internal` (keep its pairing loop) so it records the counterpart, then add step 5 before the final `print(... account updates ...)`:

```python
    # 2. internal transfers: credit here == debit there (±2 days) → record the counterpart
    counterpart = {}   # id(row) -> counterpart accountId
    for r in rows:
        if not r.get("credit"):
            continue
        for q in debits:
            if q["account"] != r["account"] and abs(q["debit"] - r["credit"]) < 0.005 \
                    and abs((d(q["date"]) - d(r["date"])).days) <= 2:
                counterpart[id(r)] = ACCOUNT_DOC[q["account"]]
                counterpart[id(q)] = ACCOUNT_DOC[r["account"]]
                break
    internal = set(counterpart)

    # 5. bank_lines — every verified ledger row becomes a doc (deterministic id = merge key)
    now_iso = datetime.now(timezone.utc).isoformat()
    existing_bl = {x["_id"] for x in get_coll("bank_lines")}
    bl_docs = []
    for acct, led in by_acct.items():
        for r in led:
            doc_id, fields = bank_line_doc(acct, r, counterpart.get(id(r)), now_iso)
            if doc_id not in existing_bl:
                bl_docs.append((doc_id, fields))
    print(f"\n== bank_lines: {len(existing_bl)} in DB, {len(bl_docs)} new ==")
    acct_number_patches = [(ACCOUNT_DOC[a], {"accountNumber": a}) for a in by_acct
                           if accounts[ACCOUNT_DOC[a]].get("accountNumber") != a]
```

and in the `if apply:` block:

```python
        for doc_id, fields in bl_docs:
            patch("bank_lines", doc_id, fields)
        for doc_id, fields in acct_number_patches:
            patch("accounts", doc_id, fields)
```

(`patch()` is a PATCH with an updateMask of every field → creates the doc when missing; the owner token bypasses the `allow write: if false` rule — that is the point of the rule.) Update the counters line to include `{len(bl_docs)} bank_lines`.

- [ ] **Step 4: Idempotency run against the live emulator**

Start live mode (desktop button or `zsh scripts/live/sync-and-start.sh`), then:

Run: `python3 family-data/tools/statements/ingest_bank.py` → expected `== bank_lines: 0 in DB, 573 new ==` (count = verified rows in `extracted/bank-ledgers.json`).
Run: `python3 family-data/tools/statements/ingest_bank.py --apply` → `applied.`
Run: `python3 family-data/tools/statements/ingest_bank.py` again → expected `== bank_lines: 573 in DB, 0 new ==` and `0 account updates`.

- [ ] **Step 5: Record in ROUTINE.md and commit the docstring change (the tool itself is gitignored)**

Append to `family-data/ROUTINE.md` under "סנכרון 10.2026": `bank_lines נכתב ע"י ingest_bank (שלב 5); 573 שורות @10.10.`
```bash
git status --short   # nothing to commit from family-data; confirm
```

---

### Task 4: Pure resolver — `monthSeries` + `resolveBankBoard`

**Files:**
- Create: `src/lib/boards/types.ts`
- Create: `src/lib/boards/monthSeries.ts`
- Create: `src/lib/boards/resolveBank.ts`
- Test: `src/__tests__/resolveBank.test.ts`

**Interfaces:**
- Consumes: `BankLine` (Task 1), `Account` (`src/types/finance.ts`: `id, name, balance, balanceUpdatedAt, ownerId, type, status`).
- Produces:
  ```ts
  interface FigureSource { collection: string; filter: string; asOf: string | null }
  interface ResolvedFigure { id: string; explainId: string; labelHe: string; value: number | null; items: BreakdownItem[]; source: FigureSource; state: 'ok' | 'empty' }
  interface ResolvedSection { sectionId: string; layer: 'status'|'balances'|'trends'; titleHe: string; figures: ResolvedFigure[]; state: 'ok' | 'empty'; series?: MonthPoint[] }
  interface MonthPoint { period: string; endBalance: number | null; net: number }
  function monthSeries(lines: BankLine[], accountId: string, today: string, months?: number): MonthPoint[]
  function resolveBankBoard(lines: BankLine[], accounts: Account[], today: string): ResolvedSection[]
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/resolveBank.test.ts
import { describe, it, expect } from 'vitest';
import { resolveBankBoard } from '../lib/boards/resolveBank';
import { monthSeries } from '../lib/boards/monthSeries';
import type { BankLine } from '../types/bank';
import type { Account } from '../types/finance';

const acc = (id: string, ownerId: string, name: string): Account => ({
  id, ownerId, name, type: 'bank', balance: 0, balanceUpdatedAt: '2026-08-29', status: 'active',
  createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-29T00:00:00Z',
});
const JOINT = acc('acc-poalim-joint', 'david-levy', 'משותף');
const DAVID = acc('acc-poalim-david', 'david-levy', 'דויד');

let n = 0;
const bl = (p: Partial<BankLine>): BankLine => ({
  id: `bl-${++n}`, ownerId: 'david-levy', accountId: 'acc-poalim-joint', accountNumber: '12-559-305397',
  date: '2026-10-01', period: '2026-10', action: 'x', debit: null, credit: null, balance: 0,
  kind: 'other', counterpartAccountId: null, source: 't', verified: true,
  createdAt: '', updatedAt: '', ...p,
});

const TODAY = '2026-10-10';

describe('resolveBankBoard — status', () => {
  it('today\'s balance is the latest verified line on or before today, with month in/out', () => {
    const lines = [
      bl({ date: '2026-09-28', balance: 42.04, debit: 10 }),
      bl({ date: '2026-10-05', balance: 7042.04, credit: 7000, kind: 'transfer-internal', counterpartAccountId: 'acc-poalim-david' }),
      bl({ date: '2026-10-05', balance: 6992.14, debit: 49.9, kind: 'card-charge' }),
    ];
    const status = resolveBankBoard(lines, [JOINT], TODAY).find((s) => s.sectionId === 'bank.joint.status')!;
    const f = Object.fromEntries(status.figures.map((x) => [x.id, x]));
    expect(f['bank.joint.balanceToday'].value).toBe(6992.14);
    expect(f['bank.joint.monthOut'].value).toBe(49.9);
    expect(f['bank.joint.monthIn'].value).toBe(0);            // internal transfers are neutral
    expect(f['bank.joint.balanceToday'].source.collection).toBe('bank_lines');
    expect(f['bank.joint.balanceToday'].source.asOf).toBe('2026-10-05');
  });

  it('balance today ignores future-dated rows', () => {
    const lines = [bl({ date: '2026-10-05', balance: 100 }), bl({ date: '2026-10-11', balance: 999 })];
    const status = resolveBankBoard(lines, [JOINT], TODAY).find((s) => s.sectionId === 'bank.joint.status')!;
    expect(status.figures.find((x) => x.id === 'bank.joint.balanceToday')!.value).toBe(100);
  });

  it('ignores unverified rows everywhere', () => {
    const lines = [bl({ date: '2026-10-05', balance: 100, debit: 5 }), bl({ date: '2026-10-06', balance: 50, debit: 50, verified: false })];
    const status = resolveBankBoard(lines, [JOINT], TODAY).find((s) => s.sectionId === 'bank.joint.status')!;
    expect(status.figures.find((x) => x.id === 'bank.joint.balanceToday')!.value).toBe(100);
    expect(status.figures.find((x) => x.id === 'bank.joint.monthOut')!.value).toBe(5);
  });

  it('internal transfers are neutral: not in, not out', () => {
    const lines = [
      bl({ date: '2026-10-05', balance: 7000, credit: 7000, kind: 'transfer-internal', counterpartAccountId: 'acc-poalim-david' }),
      bl({ accountId: 'acc-poalim-david', date: '2026-10-05', balance: 1000, debit: 7000, kind: 'transfer-internal', counterpartAccountId: 'acc-poalim-joint' }),
    ];
    const secs = resolveBankBoard(lines, [JOINT, DAVID], TODAY);
    const j = secs.find((s) => s.sectionId === 'bank.joint.status')!.figures;
    const d = secs.find((s) => s.sectionId === 'bank.david.status')!.figures;
    expect(j.find((x) => x.id === 'bank.joint.monthIn')!.value).toBe(0);
    expect(d.find((x) => x.id === 'bank.david.monthOut')!.value).toBe(0);
  });

  it('negative balance reconciles: breakdown of the month\'s movements sums to the net', () => {
    const lines = [
      bl({ date: '2026-10-01', balance: -453.84, debit: 1738.16, kind: 'card-charge' }),
      bl({ date: '2026-10-02', balance: 6546.16, credit: 7000, kind: 'transfer-in' }),
    ];
    const bal = resolveBankBoard(lines, [JOINT], TODAY).find((s) => s.sectionId === 'bank.joint.balances')!;
    const fig = bal.figures.find((x) => x.id === 'bank.joint.monthNet')!;
    expect(fig.value).toBeCloseTo(7000 - 1738.16, 2);
    expect(fig.items.reduce((s, i) => s + i.amountILS, 0)).toBeCloseTo(fig.value!, 2);
  });
});

describe('monthSeries', () => {
  it('month-end balance per period over 12 months, null when a month has no line, net per month', () => {
    const lines = [
      bl({ date: '2026-08-27', balance: 500, credit: 500, kind: 'transfer-in' }),
      bl({ date: '2026-10-05', balance: 7042.04, credit: 7000, kind: 'transfer-in' }),
      bl({ date: '2026-10-05', balance: 6992.14, debit: 49.9, kind: 'card-charge' }),
    ];
    const s = monthSeries(lines, 'acc-poalim-joint', TODAY, 12);
    expect(s).toHaveLength(12);
    expect(s[11]).toEqual({ period: '2026-10', endBalance: 6992.14, net: 6950.1 });
    expect(s[10]).toEqual({ period: '2026-09', endBalance: null, net: 0 });
    expect(s[9].period).toBe('2026-08');
    expect(s[9].endBalance).toBe(500);
  });
});

describe('resolveBankBoard — empty and ordering', () => {
  it('an account with no lines yields empty sections, the others resolve; joint comes first', () => {
    const lines = [bl({ accountId: 'acc-poalim-david', date: '2026-10-01', balance: 10 })];
    const secs = resolveBankBoard(lines, [DAVID, JOINT], TODAY);
    expect(secs[0].sectionId).toBe('bank.joint.status');
    expect(secs.find((s) => s.sectionId === 'bank.joint.status')!.state).toBe('empty');
    expect(secs.find((s) => s.sectionId === 'bank.david.status')!.state).toBe('ok');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/resolveBank.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement types, monthSeries, resolveBank**

```ts
// src/lib/boards/types.ts
import type { BreakdownItem } from '../../components/FigureBreakdown';

export type SectionLayer = 'status' | 'balances' | 'trends' | 'future' | 'advice';
export interface FigureSource { collection: string; filter: string; asOf: string | null }
export interface ResolvedFigure {
  id: string; explainId: string; labelHe: string;
  value: number | null; items: BreakdownItem[]; source: FigureSource; state: 'ok' | 'empty';
}
export interface MonthPoint { period: string; endBalance: number | null; net: number }
export interface ResolvedSection {
  sectionId: string; layer: SectionLayer; titleHe: string;
  figures: ResolvedFigure[]; state: 'ok' | 'empty'; series?: MonthPoint[];
}
```

```ts
// src/lib/boards/monthSeries.ts
import type { BankLine } from '../../types/bank';
import type { MonthPoint } from './types';

/** 'YYYY-MM' of `today` minus k months (k=0 → today's month). Pure, no Date timezone games. */
export function periodMinus(today: string, k: number): string {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const idx = y * 12 + (m - 1) - k;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Month-end balance (last verified line of the month, by date then by insertion order) and the month's net. */
export function monthSeries(lines: BankLine[], accountId: string, today: string, months = 12): MonthPoint[] {
  const own = lines.filter((l) => l.accountId === accountId && l.verified && l.date <= today);
  return Array.from({ length: months }, (_, i) => periodMinus(today, months - 1 - i)).map((period) => {
    const inMonth = own.filter((l) => l.period === period);
    const last = inMonth.reduce<BankLine | null>((acc, l) => (acc === null || l.date >= acc.date ? l : acc), null);
    const net = inMonth.reduce((s, l) => s + (l.credit ?? 0) - (l.debit ?? 0), 0);
    return { period, endBalance: last ? last.balance : null, net: Math.round(net * 100) / 100 };
  });
}
```

```ts
// src/lib/boards/resolveBank.ts
import type { BankLine, BankLineKind } from '../../types/bank';
import type { Account } from '../../types/finance';
import type { ResolvedFigure, ResolvedSection, FigureSource } from './types';
import { monthSeries } from './monthSeries';

const KIND_HE: Record<BankLineKind, string> = {
  'card-charge': 'חיובי כרטיסי אשראי', 'standing-order': 'הוראות קבע', 'transfer-internal': 'העברות פנימיות',
  'transfer-in': 'העברות נכנסות', cash: 'משיכות מזומן', fee: 'עמלות וריבית', income: 'הכנסות', other: 'אחר',
};
/** Order on the board: the joint account first (spec §2 — "המשותף הכי חשוב"), then by name. */
const ACCOUNT_ORDER = ['acc-poalim-joint', 'acc-poalim-david', 'acc-poalim-lilit'];
const shortId = (accountId: string) => accountId.replace('acc-poalim-', '');   // 'joint' | 'david' | 'lilit'

const round2 = (n: number) => Math.round(n * 100) / 100;
const src = (accountId: string, filter: string, asOf: string | null): FigureSource =>
  ({ collection: 'bank_lines', filter: `accountId = ${accountId}; ${filter}`, asOf });

function byKind(lines: BankLine[], sign: 'debit' | 'credit') {
  const sums = new Map<BankLineKind, number>();
  for (const l of lines) { const v = l[sign]; if (v) sums.set(l.kind, (sums.get(l.kind) ?? 0) + v); }
  return [...sums.entries()].map(([k, v]) => ({ label: KIND_HE[k], amountILS: round2(v) }));
}

export function resolveBankBoard(lines: BankLine[], accounts: Account[], today: string): ResolvedSection[] {
  const period = today.slice(0, 7);
  const ordered = [...accounts].sort((a, b) =>
    (ACCOUNT_ORDER.indexOf(a.id) + 1 || 99) - (ACCOUNT_ORDER.indexOf(b.id) + 1 || 99) || a.name.localeCompare(b.name, 'he'));
  const out: ResolvedSection[] = [];
  for (const acct of ordered) {
    const s = shortId(acct.id);
    const own = lines.filter((l) => l.accountId === acct.id && l.verified && l.date <= today);
    const latest = own.reduce<BankLine | null>((acc, l) => (acc === null || l.date >= acc.date ? l : acc), null);
    const month = own.filter((l) => l.period === period);
    const external = month.filter((l) => l.kind !== 'transfer-internal');
    const monthOut = round2(external.reduce((t, l) => t + (l.debit ?? 0), 0));
    const monthIn = round2(external.reduce((t, l) => t + (l.credit ?? 0), 0));
    const empty = own.length === 0;
    const fig = (id: string, labelHe: string, value: number | null, items: ResolvedFigure['items'], filter: string, asOf: string | null): ResolvedFigure =>
      ({ id: `bank.${s}.${id}`, explainId: `bank.${id}`, labelHe, value, items, source: src(acct.id, filter, asOf), state: empty ? 'empty' : 'ok' });

    out.push({
      sectionId: `bank.${s}.status`, layer: 'status', titleHe: `${acct.name} — היום`, state: empty ? 'empty' : 'ok',
      figures: [
        fig('balanceToday', 'יתרה היום', latest ? latest.balance : null, [], 'latest verified line ≤ today', latest?.date ?? null),
        fig('monthOut', 'יצא החודש', monthOut, byKind(external, 'debit'), `period = ${period}; debit; kind ≠ transfer-internal`, latest?.date ?? null),
        fig('monthIn', 'נכנס החודש', monthIn, byKind(external, 'credit'), `period = ${period}; credit; kind ≠ transfer-internal`, latest?.date ?? null),
      ],
    });
    const net = round2(monthIn - monthOut);
    out.push({
      sectionId: `bank.${s}.balances`, layer: 'balances', titleHe: `${acct.name} — תנועות החודש`, state: empty ? 'empty' : 'ok',
      figures: [
        fig('monthNet', 'שינוי נטו החודש', net,
          [...byKind(external, 'credit'), ...byKind(external, 'debit').map((i) => ({ ...i, amountILS: -i.amountILS }))],
          `period = ${period}; credit − debit; kind ≠ transfer-internal`, latest?.date ?? null),
        fig('internalMoved', 'הועבר בין החשבונות שלנו', round2(month.filter((l) => l.kind === 'transfer-internal').reduce((t, l) => t + (l.credit ?? 0) + (l.debit ?? 0), 0)),
          month.filter((l) => l.kind === 'transfer-internal').map((l) => ({ label: `${l.date} ${l.credit ? 'נכנס' : 'יצא'}`, amountILS: (l.credit ?? 0) + (l.debit ?? 0) })),
          `period = ${period}; kind = transfer-internal`, latest?.date ?? null),
      ],
    });
    const series = monthSeries(lines, acct.id, today, 12);
    const net12 = round2(series.reduce((t, p) => t + p.net, 0));
    out.push({
      sectionId: `bank.${s}.trends`, layer: 'trends', titleHe: `${acct.name} — 12 חודשים`, state: empty ? 'empty' : 'ok', series,
      figures: [fig('net12m', 'שינוי נטו ב-12 חודשים', net12, series.map((p) => ({ label: p.period, amountILS: p.net })), '12 periods ending today; Σ(credit − debit) per period', latest?.date ?? null)],
    });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/resolveBank.test.ts`
Expected: PASS (7 tests). If `monthNet` reconciliation fails by rounding, round each item in `byKind` (already `round2`) — do not loosen the ±0.01.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/lib/boards src/__tests__/resolveBank.test.ts
git commit -m "feat(boards): pure bank resolver — status, month movements, 12-month series (Stage 9 S1 T4)"
```

---

### Task 5: Board registry + glossary entries + registry guard test

**Files:**
- Create: `src/config/boards.ts`
- Modify: `src/config/glossary.ts` (add `bank.*` entries inside `GLOSSARY`)
- Test: `src/__tests__/boards.registry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type BoardId = 'bank';   // S1 — grows per spec §2 in later stages
  type BoardScope = { kind: 'family' } | { kind: 'household' } | { kind: 'member'; memberId: string } | { kind: 'account'; accountId: string };
  interface BoardSection { id: string; layer: SectionLayer; titleHe: string; explainIds: string[]; defaultOpen?: boolean }
  interface BoardDef { id: BoardId; labelHe: string; icon: LucideIcon; scope: BoardScope; sections: BoardSection[]; visibleFor: (role: PermissionRole, accountsView: PermissionLevel | undefined) => boolean }
  const BOARDS: readonly BoardDef[]
  ```
  (`explainIds` is the registry's declaration of every figure the section will render — the guard test checks them against `GLOSSARY`; the resolver's `explainId`s must be a subset.)

- [ ] **Step 1: Write the failing guard test**

```ts
// src/__tests__/boards.registry.test.ts
import { describe, it, expect } from 'vitest';
import { BOARDS } from '../config/boards';
import { GLOSSARY } from '../config/glossary';
import { resolveBankBoard } from '../lib/boards/resolveBank';

describe('BOARDS registry — the structural guard of spec §8', () => {
  it('every declared explainId has a GLOSSARY entry with all five fields', () => {
    for (const b of BOARDS) for (const s of b.sections) for (const id of s.explainIds) {
      const e = GLOSSARY[id];
      expect(e, `${b.id}/${s.id}: missing glossary entry ${id}`).toBeTruthy();
      for (const k of ['title', 'explanation', 'howComputed', 'source'] as const) expect(e[k].length, `${id}.${k}`).toBeGreaterThan(0);
    }
  });
  it('section ids are unique across boards', () => {
    const ids = BOARDS.flatMap((b) => b.sections.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('the bank resolver never emits an explainId the registry did not declare', () => {
    const declared = new Set(BOARDS.find((b) => b.id === 'bank')!.sections.flatMap((s) => s.explainIds));
    const acct = { id: 'acc-poalim-joint', ownerId: 'david-levy', name: 'משותף', type: 'bank' as const, balance: 0, balanceUpdatedAt: '', status: 'active' as const, createdAt: '', updatedAt: '' };
    for (const sec of resolveBankBoard([], [acct], '2026-10-10')) for (const f of sec.figures) expect(declared.has(f.explainId), f.explainId).toBe(true);
  });
  it('visibleFor: parents always, a member only with accounts.view ≠ none', () => {
    const bank = BOARDS.find((b) => b.id === 'bank')!;
    expect(bank.visibleFor('parent', undefined)).toBe(true);
    expect(bank.visibleFor('member', 'own')).toBe(true);
    expect(bank.visibleFor('member', 'none')).toBe(false);
    expect(bank.visibleFor('member', undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/boards.registry.test.ts`
Expected: FAIL — `../config/boards` not found.

- [ ] **Step 3: Write the registry and the glossary entries**

```ts
// src/config/boards.ts
import { Landmark, type LucideIcon } from 'lucide-react';
import type { PermissionLevel, PermissionRole } from '../types/permissions';
import type { SectionLayer } from '../lib/boards/types';

// Spec §5 — boards are DATA. One renderer (BoardScreen) draws any of them; adding a board is
// a declaration here plus a resolver, never a new screen. S1 ships the bank board only.
export type BoardId = 'bank';
export type BoardScope =
  | { kind: 'family' } | { kind: 'household' }
  | { kind: 'member'; memberId: string } | { kind: 'account'; accountId: string };
export interface BoardSection { id: string; layer: SectionLayer; titleHe: string; explainIds: string[]; defaultOpen?: boolean }
export interface BoardDef {
  id: BoardId; labelHe: string; icon: LucideIcon; scope: BoardScope; sections: BoardSection[];
  visibleFor: (role: PermissionRole, accountsView: PermissionLevel | undefined) => boolean;
}

const BANK_EXPLAIN = {
  status: ['bank.balanceToday', 'bank.monthOut', 'bank.monthIn'],
  balances: ['bank.monthNet', 'bank.internalMoved'],
  trends: ['bank.net12m'],
};

export const BOARDS: readonly BoardDef[] = [
  {
    id: 'bank', labelHe: 'חשבונות הבנק', icon: Landmark, scope: { kind: 'account', accountId: 'acc-poalim-joint' },
    // One registry section per layer; the resolver instantiates it per account (joint first).
    sections: [
      { id: 'bank.status',   layer: 'status',   titleHe: 'היום',          explainIds: BANK_EXPLAIN.status, defaultOpen: true },
      { id: 'bank.balances', layer: 'balances', titleHe: 'תנועות החודש',  explainIds: BANK_EXPLAIN.balances },
      { id: 'bank.trends',   layer: 'trends',   titleHe: '12 חודשים',     explainIds: BANK_EXPLAIN.trends },
    ],
    visibleFor: (role, accountsView) => role === 'super-admin' || role === 'parent' || (accountsView !== undefined && accountsView !== 'none'),
  },
];
```

Glossary — add inside `GLOSSARY` (same shape as `accounts.totalBalance`):

```ts
  'bank.balanceToday': {
    id: 'bank.balanceToday', title: 'יתרה היום',
    explanation: 'היתרה בחשבון לפי התנועה האחרונה שנקלטה מהבנק — לא הערכה ולא תחזית.',
    howComputed: 'השורה המאומתת האחרונה של החשבון שתאריכה עד היום; היתרה המודפסת בה היא המספר. שורות שלא אומתו או שתאריכן עתידי לא נחשבות.',
    source: 'bank_lines — תנועות העו"ש שנקלטו בסנכרון (xlsx/PDF של הפועלים)', asOf: 'תאריך השורה האחרונה — מוצג ליד המספר',
  },
  'bank.monthOut': {
    id: 'bank.monthOut', title: 'יצא החודש',
    explanation: 'כל מה שירד מהחשבון בחודש הנוכחי, לפי סוג: כרטיסים, הוראות קבע, מזומן, עמלות.',
    howComputed: 'סכום עמודת החובה של כל שורה מאומתת בחודש הנוכחי, למעט העברות בין החשבונות שלנו — הן לא הוצאה.',
    source: 'bank_lines (debit, period = החודש, kind ≠ transfer-internal)', asOf: 'תאריך השורה האחרונה',
  },
  'bank.monthIn': {
    id: 'bank.monthIn', title: 'נכנס החודש',
    explanation: 'כל מה שנכנס לחשבון בחודש הנוכחי מבחוץ: משכורת, קצבאות, העברות ממשפחה.',
    howComputed: 'סכום עמודת הזכות של כל שורה מאומתת בחודש הנוכחי, למעט העברות בין החשבונות שלנו.',
    source: 'bank_lines (credit, period = החודש, kind ≠ transfer-internal)', asOf: 'תאריך השורה האחרונה',
  },
  'bank.monthNet': {
    id: 'bank.monthNet', title: 'שינוי נטו החודש',
    explanation: 'כמה החשבון עלה או ירד החודש מכסף שבא מבחוץ או יצא החוצה.',
    howComputed: 'נכנס החודש פחות יצא החודש. הפירוק מראה כל סוג בסימן שלו, וסכום הפירוק שווה למספר.',
    source: 'bank_lines (החודש הנוכחי, ללא העברות פנימיות)', asOf: 'תאריך השורה האחרונה',
  },
  'bank.internalMoved': {
    id: 'bank.internalMoved', title: 'הועבר בין החשבונות שלנו',
    explanation: 'כסף שזז בין שלושת החשבונות של המשפחה החודש. הוא לא הכנסה ולא הוצאה — רק מיקום.',
    howComputed: 'זוג תנועות באותו סכום, חובה בחשבון אחד וזכות באחר, בהפרש של עד יומיים — מזוהה בסנכרון ומסומן transfer-internal.',
    source: 'bank_lines (kind = transfer-internal, החודש הנוכחי)', asOf: 'תאריך השורה האחרונה',
  },
  'bank.net12m': {
    id: 'bank.net12m', title: 'שינוי נטו ב-12 חודשים',
    explanation: 'המגמה: כמה החשבון עלה או ירד בשנה האחרונה, חודש אחר חודש.',
    howComputed: 'לכל אחד מ-12 החודשים האחרונים: זכות פחות חובה של השורות המאומתות; הקו מראה את יתרת סוף כל חודש, והמספר הוא סכום 12 החודשים. חודש בלי תנועות שנקלטו מופיע כפער, לא כאפס.',
    source: 'bank_lines (12 תקופות אחרונות)', asOf: 'תאריך השורה האחרונה',
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/boards.registry.test.ts src/__tests__/resolveBank.test.ts`
Expected: PASS (11 tests). Also `npx vitest run src/__tests__/glossary*.test.ts` if a glossary consistency test exists — it must still pass (entries keep the exact `GlossaryEntry` shape).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/config/boards.ts src/config/glossary.ts src/__tests__/boards.registry.test.ts
git commit -m "feat(boards): board registry with the bank board, glossary entries, structural guard (Stage 9 S1 T5)"
```

---

### Task 6: `useBankBoardData` hook + `Sparkline` + `BoardScreen`

**Files:**
- Create: `src/hooks/useBankBoardData.ts`
- Create: `src/components/Sparkline.tsx`
- Create: `src/components/BoardScreen.tsx`
- Test: `src/__tests__/BoardScreen.test.tsx`

**Interfaces:**
- Consumes: `listBankLines` (T1), `listAccounts` (`src/services/AccountsService`), `resolveBankBoard` (T4), `BOARDS` (T5), `Explain` (renders `data-tour-id="explain.<id>"`, which `renderedExplainIds` scans), `FigureBreakdown`, `formatILS` (`src/config/money.ts`). Periods in breakdown labels are shown as the raw `YYYY-MM` in S1.
- Produces: `BoardScreen({ session: { memberId: string; role: PermissionRole }, accountsViewLevel: PermissionLevel | undefined })` default export; `useBankBoardData(session, accountsViewLevel) → { status: 'loading'|'ready'|'error'|'permission-denied'; lines: BankLine[]; accounts: Account[]; errorMessage: string | null; reload: () => void }`.

- [ ] **Step 1: Write the failing screen tests**

```tsx
// src/__tests__/BoardScreen.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderedExplainIds } from './helpers/renderPresence';

const mockLines = vi.fn();
const mockAccounts = vi.fn();
vi.mock('../services/BankLinesService', () => ({ listBankLines: (...a: unknown[]) => mockLines(...a) }));
vi.mock('../services/AccountsService', () => ({ listAccounts: (...a: unknown[]) => mockAccounts(...a), saveAccount: vi.fn(), deleteAccount: vi.fn() }));

import BoardScreen from '../components/BoardScreen';

const SESSION = { memberId: 'lilit-levy', role: 'parent' as const };
const JOINT = { id: 'acc-poalim-joint', ownerId: 'david-levy', name: 'עו"ש הפועלים משותף', type: 'bank', balance: 16.48, balanceUpdatedAt: '2026-08-29', status: 'active', createdAt: '', updatedAt: '' };
const DAVID = { ...JOINT, id: 'acc-poalim-david', name: 'עו"ש הפועלים דויד' };
const line = (p: object) => ({ id: 'bl-1', ownerId: 'david-levy', accountId: 'acc-poalim-joint', accountNumber: '12-559-305397', date: '2026-10-05', period: '2026-10',
  action: 'מכבי', debit: 249.35, credit: null, balance: 6992.14, kind: 'standing-order', counterpartAccountId: null, source: 't', verified: true, createdAt: '', updatedAt: '', ...p });

beforeEach(() => { vi.clearAllMocks(); });

describe('BoardScreen — bank board', () => {
  it('renders the joint account first with today\'s balance, and every figure has an Explain', async () => {
    mockAccounts.mockResolvedValue([DAVID, JOINT]);
    mockLines.mockResolvedValue([line({}), line({ id: 'bl-2', accountId: 'acc-poalim-david', balance: 16241.5, action: 'מכבי' })]);
    const { container } = render(<BoardScreen session={SESSION} accountsViewLevel={undefined} />);
    await waitFor(() => expect(screen.getByTestId('board.bank.joint.status')).toBeInTheDocument());
    const sections = [...container.querySelectorAll('[data-testid^="board.bank."][data-testid$=".status"]')].map((e) => e.getAttribute('data-testid'));
    expect(sections[0]).toBe('board.bank.joint.status');
    expect(screen.getByTestId('figure.bank.joint.balanceToday')).toHaveTextContent('6,992.14');
    const ids = renderedExplainIds(container);
    for (const id of ['bank.balanceToday', 'bank.monthOut', 'bank.monthIn']) expect(ids).toContain(id);
  });

  it('a failed read renders the error state, never an empty board', async () => {
    mockAccounts.mockResolvedValue([JOINT]);
    mockLines.mockRejectedValue(new Error('permission-denied'));
    render(<BoardScreen session={SESSION} accountsViewLevel={undefined} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('לא הצלחנו לטעון'));
    expect(screen.queryByTestId('board.bank.joint.status')).toBeNull();
  });

  it('an account without lines shows the empty state while the others render', async () => {
    mockAccounts.mockResolvedValue([JOINT, DAVID]);
    mockLines.mockResolvedValue([line({ accountId: 'acc-poalim-david', balance: 16241.5 })]);
    render(<BoardScreen session={SESSION} accountsViewLevel={undefined} />);
    await waitFor(() => expect(screen.getByTestId('board.bank.david.status')).toBeInTheDocument());
    expect(screen.getByTestId('board.bank.joint.status')).toHaveTextContent('אין תנועות עדיין');
    expect(screen.getByTestId('figure.bank.david.balanceToday')).toHaveTextContent('16,241.5');
  });

  it('a member with accounts.view = none gets the permission-denied state and no fetch', async () => {
    render(<BoardScreen session={{ memberId: 'lior-levy', role: 'member' }} accountsViewLevel="none" />);
    expect(await screen.findByText('אין לך הרשאה לצפות בחשבונות')).toBeInTheDocument();
    expect(mockLines).not.toHaveBeenCalled();
  });

  it('loading → ready on the same instance does not change the hook order (09.10.2026 regression class)', async () => {
    let resolveLines!: (v: unknown) => void;
    mockAccounts.mockResolvedValue([JOINT]);
    mockLines.mockReturnValue(new Promise((r) => { resolveLines = r; }));
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a); });
    render(<BoardScreen session={SESSION} accountsViewLevel={undefined} />);
    expect(screen.getByText('טוען…')).toBeInTheDocument();
    resolveLines([line({})]);
    await waitFor(() => expect(screen.getByTestId('board.bank.joint.status')).toBeInTheDocument());
    expect(errors.map(String).join('\n')).not.toMatch(/Rendered more hooks|order of Hooks/);
    spy.mockRestore();
  });

  it('a section accordion toggles and its breakdown opens', async () => {
    mockAccounts.mockResolvedValue([JOINT]);
    mockLines.mockResolvedValue([line({})]);
    render(<BoardScreen session={SESSION} accountsViewLevel={undefined} />);
    await waitFor(() => expect(screen.getByTestId('board.bank.joint.balances')).toBeInTheDocument());
    const header = screen.getByRole('button', { name: /תנועות החודש/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('figure.bank.joint.monthNet')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/BoardScreen.test.tsx`
Expected: FAIL — `../components/BoardScreen` not found.

- [ ] **Step 3: Implement the hook, the sparkline and the screen**

```ts
// src/hooks/useBankBoardData.ts
import { useCallback, useEffect, useState } from 'react';
import { listBankLines } from '../services/BankLinesService';
import { listAccounts } from '../services/AccountsService';
import type { BankLine } from '../types/bank';
import type { Account } from '../types/finance';
import type { PermissionLevel, PermissionRole } from '../types/permissions';

export interface BankBoardData {
  status: 'loading' | 'ready' | 'error' | 'permission-denied';
  lines: BankLine[]; accounts: Account[]; errorMessage: string | null; reload: () => void;
}
export const BANK_LOAD_ERROR = 'לא הצלחנו לטעון את תנועות הבנק. נסה שוב.';

/** Scope follows the accounts module exactly (spec §9): parents read family, a member reads own. */
export function useBankBoardData(session: { memberId: string; role: PermissionRole }, accountsViewLevel: PermissionLevel | undefined): BankBoardData {
  const bypass = session.role === 'super-admin' || session.role === 'parent';
  const denied = !bypass && (accountsViewLevel === undefined || accountsViewLevel === 'none');
  const scope: 'own' | 'family' = bypass || accountsViewLevel === 'family' ? 'family' : 'own';
  const [state, setState] = useState<Omit<BankBoardData, 'reload'>>({ status: denied ? 'permission-denied' : 'loading', lines: [], accounts: [], errorMessage: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (denied) return;
    let alive = true;
    setState((s) => ({ ...s, status: 'loading', errorMessage: null }));
    Promise.all([listAccounts(scope, session.memberId), listBankLines(scope, session.memberId)])
      .then(([accounts, lines]) => { if (alive) setState({ status: 'ready', accounts, lines, errorMessage: null }); })
      .catch(() => { if (alive) setState({ status: 'error', accounts: [], lines: [], errorMessage: BANK_LOAD_ERROR }); });
    return () => { alive = false; };
  }, [denied, scope, session.memberId, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
```

```tsx
// src/components/Sparkline.tsx
import React from 'react';
import type { MonthPoint } from '../lib/boards/types';

/** 12 month-end balances as one polyline; a null month breaks the line (a gap, not a zero). */
export function Sparkline({ series, id }: { series: MonthPoint[]; id: string }): React.JSX.Element {
  const vals = series.map((p) => p.endBalance).filter((v): v is number => v !== null);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals), span = max - min || 1;
  const W = 240, H = 48, step = W / Math.max(1, series.length - 1);
  const y = (v: number) => H - ((v - min) / span) * (H - 4) - 2;
  const segments: string[] = []; let cur: string[] = [];
  series.forEach((p, i) => {
    if (p.endBalance === null) { if (cur.length) segments.push(cur.join(' ')); cur = []; return; }
    cur.push(`${(i * step).toFixed(1)},${y(p.endBalance).toFixed(1)}`);
  });
  if (cur.length) segments.push(cur.join(' '));
  return (
    <svg data-testid={`sparkline.${id}`} viewBox={`0 0 ${W} ${H}`} className="w-full h-12" role="img" aria-label="יתרת סוף חודש, 12 חודשים">
      <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity="0.15" />
      {segments.map((pts, i) => <polyline key={i} points={pts} fill="none" stroke="currentColor" strokeWidth="2" />)}
    </svg>
  );
}
```

```tsx
// src/components/BoardScreen.tsx
import React, { useMemo, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { BOARDS, type BoardId } from '../config/boards';
import { useBankBoardData } from '../hooks/useBankBoardData';
import { resolveBankBoard } from '../lib/boards/resolveBank';
import type { ResolvedFigure, ResolvedSection } from '../lib/boards/types';
import { Explain } from './Explain';
import { FigureBreakdown } from './FigureBreakdown';
import { Sparkline } from './Sparkline';
import { formatILS } from '../config/money';
import type { PermissionLevel, PermissionRole } from '../types/permissions';

interface BoardScreenProps { session: { memberId: string; role: PermissionRole }; accountsViewLevel: PermissionLevel | undefined }

const todayIso = () => new Date().toISOString().slice(0, 10);

function Figure({ f }: { f: ResolvedFigure }): React.JSX.Element {
  const value = f.value === null ? '—' : formatILS(f.value);
  const figure = (
    <span className="flex flex-col">
      <span className="text-sm text-slate-500 flex items-center gap-1">{f.labelHe}<Explain id={f.explainId} /></span>
      <span className={`text-2xl font-bold ${f.value !== null && f.value < 0 ? 'text-red-600' : 'text-slate-800'}`}>{value}</span>
      <span className="text-xs text-slate-400">{f.source.asOf ? `נכון ל-${f.source.asOf}` : 'אין נתונים'}</span>
    </span>
  );
  return <div data-testid={`figure.${f.id}`}><FigureBreakdown id={f.id} figure={figure} items={f.items} /></div>;
}

function Section({ s, open, onToggle }: { s: ResolvedSection; open: boolean; onToggle: () => void }): React.JSX.Element {
  const panelId = `panel.${s.sectionId}`;
  return (
    <div data-testid={`board.${s.sectionId}`} className="bg-white rounded-2xl shadow-sm border border-slate-100">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-right">
        <span className="font-semibold text-slate-800">{s.titleHe}</span>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id={panelId} className="px-4 pb-4 space-y-3">
          {s.state === 'empty' ? (
            <p className="text-sm text-slate-500">אין תנועות עדיין — החשבון יתמלא בסנכרון הבא.</p>
          ) : (
            <>
              {s.series && <Sparkline series={s.series} id={s.sectionId} />}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{s.figures.map((f) => <Figure key={f.id} f={f} />)}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function BoardScreen({ session, accountsViewLevel }: BoardScreenProps): React.JSX.Element {
  // Every hook sits above the early returns below (09.10.2026 rule).
  const [boardId] = useState<BoardId>('bank');                       // S1: one board; the selector arrives with the second board
  const data = useBankBoardData(session, accountsViewLevel);
  const today = useMemo(todayIso, []);
  const sections = useMemo(() => (data.status === 'ready' ? resolveBankBoard(data.lines, data.accounts, today) : []), [data.status, data.lines, data.accounts, today]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const board = BOARDS.find((b) => b.id === boardId)!;
  const isOpen = (s: ResolvedSection) => open[s.sectionId] ?? s.layer === 'status';   // mobile-first: only status open

  if (data.status === 'permission-denied') {
    return <div className="p-8 text-center text-slate-600" dir="rtl">אין לך הרשאה לצפות בחשבונות</div>;
  }
  if (data.status === 'loading') {
    return <div className="p-8 flex items-center justify-center gap-2 text-slate-500" dir="rtl"><Loader2 className="w-5 h-5 animate-spin" />טוען…</div>;
  }
  if (data.status === 'error') {
    return (
      <div role="alert" className="m-4 p-4 rounded-xl border border-red-200 bg-red-50 text-red-700" dir="rtl">
        {data.errorMessage}
        <button type="button" onClick={data.reload} className="mr-3 underline">נסה שוב</button>
      </div>
    );
  }
  return (
    <div className="p-4 space-y-3" dir="rtl" data-testid={`board.${board.id}`}>
      <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2"><board.icon className="w-5 h-5" />{board.labelHe}</h1>
      {sections.map((s) => <Section key={s.sectionId} s={s} open={isOpen(s)} onToggle={() => setOpen((o) => ({ ...o, [s.sectionId]: !isOpen(s) }))} />)}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/BoardScreen.test.tsx`
Expected: PASS (6 tests). If `renderedExplainIds` reports nothing, the `<Explain id>` is not mounted — it must sit inside the `figure` node passed to `FigureBreakdown` (it scans `[data-tour-id^="explain."]`).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/hooks/useBankBoardData.ts src/components/Sparkline.tsx src/components/BoardScreen.tsx src/__tests__/BoardScreen.test.tsx
git commit -m "feat(boards): BoardScreen — one renderer, bank board with status/balances/trends (Stage 9 S1 T6)"
```

---

### Task 7: Wire the screen into the nav (registry entry + App switch) + App tests

**Files:**
- Modify: `src/config/moduleRegistry.ts` (add an entry next to `accounts`)
- Modify: `src/App.tsx` (renderContent switch, next to `case 'accounts'`)
- Modify: `src/__tests__/App.test.tsx` (mock + two assertions)

**Interfaces:**
- Consumes: `BoardScreen` default export (T6); `ModuleRegistryEntry` shape `{ id, group, label, icon, permissionModuleId, usesGlobalFilters, filterModuleId }`.

- [ ] **Step 1: Write the failing App tests** (append to `src/__tests__/App.test.tsx`; add the mock line next to the other screen mocks at the top of the file)

```tsx
vi.mock('../components/BoardScreen', () => ({ default: () => <div data-testid="boards-screen" /> }));
```

```tsx
describe('App — boards tab (Stage 9 S1)', () => {
  beforeEach(() => { vi.clearAllMocks(); window.history.replaceState(null, ''); });
  it('a parent sees the "לוחות" nav button and it mounts BoardScreen', async () => {
    mockUseAuthSession.mockReturnValue(readySession({ role: 'parent', memberId: 'lilit-levy' }));
    mockUseResolvedPermissions.mockReturnValue(permState());
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /לוחות/ }));
    expect(await screen.findByTestId('boards-screen')).toBeInTheDocument();
  });
  it('a member without accounts.view has no "לוחות" button', async () => {
    mockUseAuthSession.mockReturnValue(readySession({ role: 'member', memberId: 'lior-levy' }));
    mockUseResolvedPermissions.mockReturnValue(permState({ resolvedPermissions: { accounts: { view: 'none', edit: 'none' } } }));
    renderApp();
    await screen.findByTestId('dashboard-screen');
    expect(screen.queryByRole('button', { name: /לוחות/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/App.test.tsx -t "boards tab"`
Expected: FAIL — no button named לוחות.

- [ ] **Step 3: Add the registry entry and the switch case**

`src/config/moduleRegistry.ts` — after the `accounts` entry:
```ts
  // Stage 9 S1 — the boards screen (bank board first). Gated like accounts: its data IS the
  // bank ledger, so a member who may not view accounts may not view boards.
  { id: 'boards', group: 'daily', label: 'לוחות', icon: LayoutGrid, permissionModuleId: 'accounts', usesGlobalFilters: false, filterModuleId: null },
```
(add `LayoutGrid` to the lucide-react import.)

`src/App.tsx` — in `renderContent`, next to `case 'accounts'`:
```tsx
      case 'boards': return (
        <BoardScreen session={{ memberId: session.memberId!, role: session.role! }} accountsViewLevel={permState.resolvedPermissions?.accounts?.view} />
      );
```
(import `BoardScreen from './components/BoardScreen'`.) `TabId` derives from the registry — no change needed.

- [ ] **Step 4: Run the App tests and the whole suite**

Run: `npx vitest run src/__tests__/App.test.tsx` → PASS (15 tests).
Run: `npx vitest run` → expected: everything green except the pre-existing `Dashboard.globalFilters › budget-vs-actual` failure (documented 09.10.2026, unrelated). If any registry-driven test enumerates MODULE_REGISTRY (e.g. a nav-groups test counting entries per group), update its expected count by one for `daily`.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/config/moduleRegistry.ts src/App.tsx src/__tests__/App.test.tsx
git commit -m "feat(nav): לוחות tab — mounts BoardScreen, gated by accounts.view (Stage 9 S1 T7)"
```

---

### Task 8: Live verification + docs

**Files:**
- Modify: `family-data/ROUTINE.md` (gitignored), `docs/HANDOFF-2026-10-09.md` (addendum)

- [ ] **Step 1: Inject real data and open the board**

Run live mode (`zsh scripts/live/sync-and-start.sh` from the project root, or the desktop button). Then `python3 family-data/tools/statements/ingest_bank.py --apply` (writes bank_lines if Task 3's run was not against this emulator instance; expected `0 new` otherwise). Open `http://localhost:3000`, log in (David types the password), click **לוחות**.

- [ ] **Step 2: Verify against the bank, in the browser pane with text tools (no screenshots)**

Expected on the joint account section: יתרה היום = the latest `bank_lines` balance for 305397 (after the joint-account export lands — until then the 25.08 value with "נכון ל-2026-08-25"); for 305370: ₪16,241.50 נכון ל-2026-10-05; for 305362: ₪9,443.85 נכון ל-2026-10-07. Every figure shows an Explain trigger; clicking a figure opens its breakdown; the 12-month sparkline renders; the console shows no React errors (`read_console_messages onlyErrors`).

- [ ] **Step 3: Close live mode with Ctrl+C in its Terminal tab** (export-on-exit saves bank_lines into live-db). Confirm `family-data/live-db/firestore_export/firestore_export.overall_export_metadata` has a fresh mtime.

- [ ] **Step 4: Document and commit**

Append to `docs/HANDOFF-2026-10-09.md`: "Stage 9 S1 shipped: bank_lines (N rows), לוחות tab, bank board (joint first). Next: S2 — card_cycles + accountProjection + R1/R3/R5." Append the same, plus the ingest step, to `family-data/ROUTINE.md`.
```bash
git add docs/HANDOFF-2026-10-09.md
git commit -m "docs: Stage 9 S1 shipped — bank_lines, לוחות tab, bank board"
```

---

## Self-review (done while writing)

- **Spec coverage (§10 stage 1):** bank_lines (T1–T3) ✓ · accounts.accountNumber (T3) ✓ · rules (T2) ✓ · ingest writes (T3) ✓ · bank board status/balances/trends, joint first (T4–T7) ✓ · every figure Explain + source (T5 guard, T6 test) ✓ · double injection = 0 (T3 step 4) ✓ · spec §5 registry + one renderer (T5–T6) ✓ · §3 rule 4 "source on every figure" (T4 `FigureSource`, T6 shows asOf) ✓. Out of S1 by design: card_cycles, projection, advice, other boards (S2+).
- **Placeholders:** none; every code step is complete.
- **Type consistency:** `BankLine` fields used in T3's Python doc, T4's resolver and T6's tests match T1; `ResolvedFigure.explainId` values (`bank.<id>`) match T5's `BANK_EXPLAIN` and glossary keys; `ACCOUNT_DOC`/`OWNER_OF` ids match the three account docs in the live DB.
- **Review Focus:** 1 → T4 `ignores unverified rows`; 2 → T4 `internal transfers are neutral`; 3 → T6 `account without lines`; 4 → T4 `balance today ignores future-dated rows`; 5 → T4 `negative balance reconciles`. ✓
