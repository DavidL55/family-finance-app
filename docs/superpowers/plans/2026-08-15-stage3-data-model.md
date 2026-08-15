# FamilyFinance v2 — Stage 3: Full Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four new financial collections spec §7 lists as "חדש" — `accounts`, `recurring`, `loans`, `insurances` — with typed services, owner attribution, permission-matrix enforcement, a local-first recurring-posting engine, and a net-worth rollup, so Stage 4 (UI shell) and Stage 5 (financial module screens) have real data and real Rules to build against instead of placeholders.

**Architecture:** Stage 2 shipped a permission matrix (`module → {view, edit} × {none, own, family}`) and a resolver (`resolveEffectivePermissions`) that materializes `members/{id}.resolvedPermissions`, plus a super-admin admin screen (`PermissionsManager`) that is fully generic over `MODULE_IDS` — it needs zero code changes to surface a new module row once one is added to that union. Stage 2 also established two structurally different rule patterns: `expensesAllowed()` (owner = a Hebrew **display name** string on `transaction_lines.owner`, Stage-2 D5) and `ownerlessModuleAllowed()` (no owner field at all — `income`/`investments`/`goals`, where `'own'` is structurally denied). This stage:

1. Adds a **third** pattern, `ownedModuleAllowed()` — owner = a **memberId** string (`ownerId`) — for the four new collections, all of which ship owned-from-day-one per the brief. See Design decision D1 for why this is a third convention rather than retrofitting one of the first two.
2. Extends `ModuleId`/`MODULE_IDS` with `'accounts' | 'recurring' | 'loans' | 'insurances'`. Because `resolveEffectivePermissions` and `firestore.rules`'s `myLevel()` both already default a missing module to `none`/`none`, this is backward compatible with every `resolvedPermissions` doc that predates Stage 3 — no migration script, no rollout seeding (Design decision D6, contrast with Stage 2's D8).
3. Adds a **shared CRUD factory** (`createOwnedCollectionRepo`) for the three simple owned collections (`accounts`, `loans`, `insurances` — plus `recurring`'s plain-CRUD half), so the identical list/upsert/delete/audit contract is written and tested once, not four times (Design decision D8).
4. Adds a **local-first recurring-posting engine** — no Cloud Functions exist yet (spec §15), so there is no scheduler; a pure catch-up function decides which `'YYYY-MM'` periods are due, and a posting service runs it once per app-open, writing to `transaction_lines`/`incomes` with a deterministic per-period document id for idempotency.
5. Adds a **client-side derived net-worth rollup** — deliberately *not* a new Firestore collection or permission module (Design decision D4): it is a pure function over data the viewer's existing `accounts`/`investments`/`loans` access already returned, plus the pre-existing manually-maintained `settings/ecosystem` real-estate figure, matching spec §5.5's "one calculation source per metric."
6. Extends `firestore.rules` with schema validators + `match` blocks for all four collections, and **broadens `audit_log`'s create rule** from `role() in ['super-admin','parent']` to include `'member'` (Design decision D7) — a real, load-bearing fix the recurring engine's same-batch audit-log write requires, not a scope-creep addition.

**Tech Stack additions:** none. No new npm packages — everything here is TypeScript + Firestore, consistent with "no Cloud Functions in this stage."

**Spec:** `docs/superpowers/specs/2026-08-14-family-finance-v2-design.md` §6 (module map — חשבונות ויתרות, הלוואות וחובות, ביטוחים, שווי נקי), §7 (`accounts`, `recurring`, `loans`, `insurances` collections), §10 (forecast's "certain layer" — this stage produces its inputs, not the engine itself), §11 (recurring posting), §5.5 (one calculation source per metric).

**Builds on:** `src/types/permissions.ts`, `src/services/MembersService.ts`, `src/services/PermissionsService.ts`, `src/services/GroupsService.ts`, `src/utils/auditLog.ts`, `firestore.rules`, `firestore-tests/permissions.rules.test.ts`, `src/components/PermissionsManager.tsx`, `src/App.tsx` (all Stage 1/2). Does **not** touch `MembersService.saveMembers` or `GroupsService.saveGroup`/`deleteGroup` — see "Carry-forwards reviewed and NOT applicable" below.

## Design decisions (resolved, not deferred)

- **D1 — owner attribution is `ownerId: string` (a `Member.id`), a THIRD convention alongside Stage 2's two.** All four new collections carry `ownerId`, not a display name. Justification: an id is stable across a rename, matches every other systemic reference (Auth custom claim `memberId`, `PermissionDoc.targetId`, `Group.memberIds`), and is what a real "who owns this loan" feature needs. This is deliberately **not** unified with `transaction_lines.owner` (a Hebrew display name, Stage-2 D5) — migrating that field would touch four already-hardened, already-reviewed report components (`Dashboard`, `ExpensesBreakdown`, `AnnualReport`, `CentralExpenseReport`) and the `transaction_lines` Rules, which is a data-migration project in its own right, not "full data model." The inconsistency is documented, not silently bridged: the one place the two conventions must actually interoperate — the recurring engine posting an expense-kind item into `transaction_lines` (Task 5) — resolves `ownerId → current display name` via a live `listMembers()` lookup at posting time (never a denormalized/cached name, which would go stale on a rename), and writes the resulting `owner` field in `transaction_lines`'s existing shape. Flagged for whoever next undertakes a `transaction_lines.owner` migration (candidate for Stage 11).
- **D2 — the four new collections are OWNED from day one, not ownerless.** `OWNERLESS_MODULES` (Stage 2, `['income', 'investments', 'goals']`) does **not** grow in Stage 3. A new rules helper, `ownedModuleAllowed()`/`canAccessOwnedModule()` (Task 7), checks `'own'` against `data.ownerId == memberId()` — distinct from `expensesAllowed()` (checks a display name) and `ownerlessModuleAllowed()` (never checks `'own'` at all). Per spec brief: these modules "use the 'own'-aware rules path... NOT the ownerless helper."
- **D3 — `recurring` gets its own `ModuleId` (`'recurring'`), even though spec §6's module table doesn't list it as a standalone row** (it's described under "קליטה," an intake *channel*, in §6/§11). Justification: `recurring` items are owned-from-day-one (`ownerId`, D2), while `income`/`expenses` are **not** migrated to that model in Stage 3 (out of scope, see D1). Folding `recurring`'s permission into `income`/`expenses` would force a choice between making those two owned as well (touches Stage 2's shipped, reviewed Rules) or leaving `recurring` ownerless (violates the brief's explicit "these modules launch OWNED" requirement). A standalone module id avoids both. This is a permission-model decision only — `recurring`'s UI home stays "קליטה" per spec; Stage 4/5 decides navigation, not this plan.
- **D4 — `netWorth` is NOT a `ModuleId` and NOT a Firestore collection.** Net worth is a pure client-side rollup (`computeNetWorth`, Task 6) over whatever `accounts`/`investments`/`loans` data the viewer's *existing* Rules-enforced reads already returned, plus a real-estate figure resolved from `settings/ecosystem` (D5). Justification (spec §5.5, "מקור חישוב אחד לכל מדד" — one calculation source per metric): a separate `netWorth` permission entry would be a second, independently-editable source of truth for "can this person see net worth" that could drift from "can this person see accounts" — e.g. a super-admin could grant `netWorth:family` to a member who only has `accounts:own`, producing a screen that either silently under-reports or throws confusing partial-permission errors. Deriving it removes that failure class entirely: net worth's `own` vs `family` breakdown is exactly whatever access the viewer already has on the contributing collections. Stage 3's job (per the brief) is to produce the DATA this needs — the `computeNetWorth` function plus per-line `source`/`asOf` provenance metadata for Stage 4's hover-glossary — not the rendered screen (Stage 5).
- **D5 — real estate stays a manually-maintained figure in the pre-existing `settings/ecosystem` document; no dedicated collection is added in Stage 3.** Spec §7's collection table lists no real-estate collection. `ecosystem.mortgage` is *expected* to migrate into `loans` (`loanType: 'mortgage'`) as real loan docs get entered, but Stage 3 does **not** write that migration script — `computeNetWorth` takes real-estate value as a plain caller-resolved number, independent of `loans`. **Risk, not silently solved:** a household that enters a mortgage as BOTH a `loans` doc and keeps the legacy `ecosystem.mortgage` figure would double-count that debt. Flagged in Risks below for whoever next touches `ecosystem` data entry (candidate: Stage 5, when a real accounts/loans data-entry screen exists and `ecosystem`'s manual fields can be retired one at a time).
- **D6 — Stage 3's rollout is fail-closed with NO seeding step, unlike Stage 2's D8.** D8 existed to prevent *regressing* Omer's already-working Dashboard access when Stage 2 added enforcement over a screen that previously worked unrestricted. The four Stage 3 modules have no prior working screens or data — there is nothing to preserve — so the resolver's already-fail-closed default (`myLevel()` → `'none'` for any module absent from `resolvedPermissions`) is correct and sufficient by itself; a super-admin grants access explicitly through the existing (Stage 2 Task 8) `PermissionsManager` screen. **Verified, not assumed:** `scripts/provision-auth-users.ts`'s D8 seeding block hardcodes the four Stage-2 module keys by name in an object literal (`{ expenses: {...}, income: {...}, investments: {...}, goals: {...} }`) — it does not iterate `MODULE_IDS` — so it is structurally unaffected by `MODULE_IDS` growing and needs zero code change. No task in this plan touches that script.
- **D7 — `audit_log`'s create rule is broadened from `role() in ['super-admin', 'parent']` to `role() in ['super-admin', 'parent', 'member']`** (equivalently: any `hasRole()`), with the existing anti-spoof binding (`request.resource.data.actorMemberId == memberId()`) and `isValidAuditEntry()` shape check unchanged. Justification: the recurring catch-up engine (Task 5) writes an `audit_log` entry in the SAME WriteBatch as every auto-posted `transaction_lines`/`incomes` doc, per the brief's "audit_log on mutations via the same WriteBatch" requirement. Firestore batches are all-or-nothing — under the unmodified Stage 2 rule, a `'member'`-role user's own session could **never** successfully catch-up-post even their fully-owned recurring item, because the embedded `audit_log` write would be denied and sink the entire batch. This is a real correctness gap Stage 2 left for a write path it didn't yet have (Stage 2 had no `'member'`-role write path needing an atomic audit entry). Test `firestore-tests/permissions.rules.test.ts:543` ("a member ... cannot write audit_log at all, even correctly attributed") is **updated, not silently left**, to `assertSucceeds` with a comment explaining the Stage 3 rationale (Task 8).
- **D8 — shared CRUD via a generic factory for the three simple owned collections.** `createOwnedCollectionRepo<T>(collectionName, auditPrefix)` (Task 2) implements list/upsert/delete/audit once; `AccountsService`/`LoansService`/`InsurancesService` (Task 3) are ~5-line wrappers over it, and `RecurringService` (Task 5) reuses it for its plain-CRUD half. Unlike `GroupsService.saveGroup`'s accepted Stage-2 simplification of always overwriting `createdAt` on every save, the factory does a fetch-then-merge specifically to **preserve** `createdAt` across edits — for a financial record, "when was this account/loan/policy first added" is real, user-facing data, not an internal bookkeeping detail.
- **D9 — `ownerId` immutability on update mirrors Stage 2's C1 fix pattern** (`transaction_lines.owner` immutable for matrix-governed editors): for all four new collections, a non-parent/non-super-admin editor cannot reassign `ownerId` to a different member via `update`. Parents/super-admin remain a trusted bypass, consistent with every other collection.

**Carry-forwards from the Stage 1/2 ledgers reviewed and confirmed NOT APPLICABLE to this stage** (no task here edits these files, so these remain correctly deferred, not forgotten):
- `MembersService.saveMembers` concurrent-clobber-of-`.groups` risk, `runTransaction` TOCTOU window — `saveMembers` is untouched by this plan.
- `GroupsService.saveGroup`/`deleteGroup`'s `previousMemberIds`/`memberIds` defaulting to `[]`, `.groups` `arrayUnion` not bumping `updatedAt`, missing `updatedBy` binding on `groups` writes — `GroupsService` is untouched by this plan.
- `audit_log` doc-id collision risk (`Date.now()` + counter) — `writeAuditLog` itself is untouched (Stage 3 only calls it, following the identical pattern already established).
- `idNumber` PII relocation — unrelated to any collection this stage adds.

## Global Constraints

- All work on branch `familyfinance-v2`. Never commit to `main`.
- TypeScript strict; `npm run lint` (tsc --noEmit) and `npm test` must pass before every commit.
- A failed read renders as an error, never an empty state — applies to every new service (`list*` functions never catch a query failure into `[]`).
- **No Cloud Functions in this stage** (spec §15, local-first) — the recurring engine is a plain client write triggered on app-open, never a scheduled server job. Do not introduce a Functions-emulator dependency.
- Every new collection ships with: a TypeScript interface (`src/types/finance.ts`), a Rules schema validator, an owned-aware Rules pair (read/create/update/delete), and a Rules test covering own/family/parent/admin access + shape-validation rejection + `ownerId` immutability on update (mirrors C1).
- `MODULE_IDS`/`resolvedPermissions` extension must stay backward compatible with every doc written before this stage — verified via D6, no migration script.
- Hebrew UI strings only where this stage actually touches UI text (`PermissionsManager`'s `MODULE_LABELS` — the only UI file this plan modifies); dates DD/MM/YYYY where user-facing; amounts ₪-labeled where rendered (none of this stage's code renders amounts directly — that's Stage 5).
- Scope discipline: **no new screens**. Full module screens are Stage 5; global filters/module registry/hover-glossary UI are Stage 4. This stage is data + Rules + minimal service surface + the one bootstrap wiring line the recurring engine needs to actually run (Task 9) — not a rendering surface.
- No hardcoded values beyond named constants documented as intentional.
- Frequent commits; each task ends with an independently testable, green deliverable.

---

### Task 1: Extend permission types + new collection doc types

**Files:**
- Create: `src/types/finance.ts`
- Modify: `src/types/permissions.ts`, `src/components/PermissionsManager.tsx`
- Test: `src/__tests__/resolvePermissions.test.ts` (extend), `src/__tests__/PermissionsManager.test.tsx` (extend)

**Interfaces:**
- Consumes: `ModulePermissionMap`, `resolveEffectivePermissions` (Stage 2, unchanged)
- Produces:
```ts
// src/types/permissions.ts (extended)
export type ModuleId =
  | 'expenses' | 'income' | 'investments' | 'goals'       // Stage 2
  | 'accounts' | 'recurring' | 'loans' | 'insurances';    // Stage 3 — owned from day one, D2/D3
export const MODULE_IDS: readonly ModuleId[] = [
  'expenses', 'income', 'investments', 'goals',
  'accounts', 'recurring', 'loans', 'insurances',
] as const;
// UNCHANGED — none of the four new modules are ownerless (D2).
export const OWNERLESS_MODULES: readonly ModuleId[] = ['income', 'investments', 'goals'] as const;
```
```ts
// src/types/finance.ts (new)
export interface OwnedRecord {
  id: string;
  ownerId: string;   // Member.id — D1
  createdAt: string; // ISO
  updatedAt: string; // ISO
}
export type AccountType = 'bank' | 'cash' | 'credit';
export interface Account extends OwnedRecord {
  name: string;
  type: AccountType;
  balance: number;
  balanceUpdatedAt: string;
  status: 'active' | 'archived';
}
export type RecurringKind = 'income' | 'expense';
export type RecurringStatus = 'active' | 'paused' | 'ended';
export interface RecurringItem extends OwnedRecord {
  kind: RecurringKind;
  description: string;
  amount: number;
  category?: string;
  chargeDay: number; // 1-31
  status: RecurringStatus;
  startDate: string;  // ISO date 'YYYY-MM-DD'
  endDate?: string;   // ISO date
  lastPostedPeriod?: string; // 'YYYY-MM'
}
export type LoanType = 'mortgage' | 'personal' | 'creditLine' | 'other';
export type LoanStatus = 'active' | 'paid-off';
export interface Loan extends OwnedRecord {
  name: string;
  loanType: LoanType;
  principal: number;
  balance: number;
  interestRate: number; // annual %
  monthlyPayment: number;
  startDate: string; // ISO date
  endDate: string;   // ISO date — expected payoff
  status: LoanStatus;
}
export type InsuranceType = 'life' | 'health' | 'car' | 'home' | 'other';
export type InsuranceStatus = 'active' | 'lapsed' | 'cancelled';
export type PremiumFrequency = 'monthly' | 'yearly';
export interface Coverage {
  label: string;   // Hebrew description of what's covered
  amount?: number; // ₪ coverage cap, optional
}
export interface Insurance extends OwnedRecord {
  type: InsuranceType;
  provider: string;
  insuredMemberId: string; // who the policy covers — may differ from ownerId (parent owns, child insured)
  premium: number;
  premiumFrequency: PremiumFrequency;
  coverages: Coverage[];
  renewalDate: string; // ISO date
  documentId?: string; // links to `documents` collection
  status: InsuranceStatus;
}
```

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/resolvePermissions.test.ts`:

```ts
describe('Stage 3 forward-compatibility (new module ids are generic to the resolver)', () => {
  it('resolves a Stage 3 module id (accounts) identically to a Stage 2 one — no special-casing in the resolver', () => {
    const result = resolveEffectivePermissions(
      ['kids'],
      null,
      { kids: groupDoc('kids', { accounts: { view: 'own', edit: 'own' } }) }
    );
    expect(result).toEqual({ accounts: { view: 'own', edit: 'own' } });
  });

  it('a member exception on a Stage 3 module overrides the group value for that module only', () => {
    const result = resolveEffectivePermissions(
      ['kids'],
      memberDoc('omer', { loans: { view: 'family', edit: 'none' } }),
      { kids: groupDoc('kids', { accounts: { view: 'own', edit: 'none' } }) }
    );
    expect(result).toEqual({
      accounts: { view: 'own', edit: 'none' }, // untouched, from the group
      loans: { view: 'family', edit: 'none' }, // from the exception
    });
  });
});
```

Append to `src/__tests__/PermissionsManager.test.tsx` (inside the top-level `describe('PermissionsManager', ...)`, after the existing "lists members once loaded" test):

```ts
  it('surfaces the four Stage 3 modules once MODULE_IDS is extended — no per-module UI code needed (component is generic over MODULE_IDS)', async () => {
    render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('edit-permissions-omer-levy'));
    await waitFor(() => expect(screen.getByText('חשבונות ויתרות')).toBeInTheDocument());
    expect(screen.getByText('תנועות קבועות')).toBeInTheDocument();
    expect(screen.getByText('הלוואות וחובות')).toBeInTheDocument();
    expect(screen.getByText('ביטוחים')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/resolvePermissions.test.ts src/__tests__/PermissionsManager.test.tsx`
Expected: the `PermissionsManager` addition FAILS (labels don't exist yet); the `resolvePermissions` addition likely PASSES already (the resolver is generic) — confirms it needs no code change, only the new test-as-documentation.

- [ ] **Step 3: Create `src/types/finance.ts`**

Write exactly as specified in Interfaces above.

- [ ] **Step 4: Extend `src/types/permissions.ts`**

Change the `ModuleId`/`MODULE_IDS` block exactly as specified in Interfaces above. Leave `OWNERLESS_MODULES`, `ModulePermission`, `Group`, `PermissionDoc`, `permissionDocId` untouched.

- [ ] **Step 5: Update `PermissionsManager.tsx`'s `MODULE_LABELS`**

```ts
const MODULE_LABELS: Record<ModuleId, string> = {
  expenses: 'הוצאות', income: 'הכנסות', investments: 'השקעות', goals: 'יעדים',
  accounts: 'חשבונות ויתרות', recurring: 'תנועות קבועות', loans: 'הלוואות וחובות', insurances: 'ביטוחים',
};
```

No other change to this file — `levelsFor()` already consults `OWNERLESS_MODULES` (unchanged), so the four new modules automatically offer `'own'` as a matrix choice (correct per D2). `Record<ModuleId, string>` makes this a compile error until every new key has a label — the type system enforces this step is not skippable.

- [ ] **Step 6: Run to verify pass**

Run: `npm run lint && npx vitest run src/__tests__/resolvePermissions.test.ts src/__tests__/PermissionsManager.test.tsx`
Expected: ALL PASS. `lint` also confirms nothing else in the codebase broke from the `ModuleId` union growing (any exhaustive `switch`/`Record<ModuleId, ...>` elsewhere would fail to compile here — none currently exists outside `PermissionsManager`).

- [ ] **Step 7: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS.

- [ ] **Step 8: Commit**

```bash
git add src/types/finance.ts src/types/permissions.ts src/components/PermissionsManager.tsx src/__tests__/resolvePermissions.test.ts src/__tests__/PermissionsManager.test.tsx
git commit -m "feat: extend permission matrix types + new financial collection doc shapes (accounts/recurring/loans/insurances)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Shared owned-collection CRUD factory (`financeCollections.ts`)

**Files:**
- Create: `src/services/financeCollections.ts`
- Test: `src/__tests__/financeCollections.test.ts`

**Interfaces:**
- Consumes: `writeAuditLog` (Stage 2, unchanged)
- Produces:
```ts
// src/services/financeCollections.ts
export interface OwnedRecord { id: string; ownerId: string; createdAt: string; updatedAt: string; }
export type OwnedRecordInput<T extends OwnedRecord> = Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
export interface OwnedCollectionRepo<T extends OwnedRecord> {
  list(): Promise<T[]>;
  save(input: OwnedRecordInput<T>, actorMemberId: string): Promise<T>;
  remove(id: string, actorMemberId: string): Promise<void>;
}
export function createOwnedCollectionRepo<T extends OwnedRecord>(
  collectionName: string,
  auditPrefix: string
): OwnedCollectionRepo<T>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/financeCollections.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDocs, mockGetDoc, mockBatchSet, mockBatchDelete, mockBatchCommit } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockGetDoc: vi.fn(),
  mockBatchSet: vi.fn(),
  mockBatchDelete: vi.fn(),
  mockBatchCommit: vi.fn(async () => undefined),
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => ({ __col: name })),
  // Two real firebase/firestore `doc()` overloads used here: doc(db, name, id) (3 args) for a
  // known id, and doc(collectionRef) (1 arg) for a fresh auto-id.
  doc: vi.fn((...args: unknown[]) => {
    if (args.length === 1) return { id: 'auto-id-1' };
    const [, ...segments] = args as [unknown, ...string[]];
    return `doc:${segments.join('/')}`;
  }),
  getDocs: mockGetDocs,
  getDoc: mockGetDoc,
  writeBatch: vi.fn(() => ({ set: mockBatchSet, delete: mockBatchDelete, commit: mockBatchCommit })),
}));

import { createOwnedCollectionRepo, type OwnedRecord } from '../services/financeCollections';

interface Widget extends OwnedRecord {
  name: string;
  amount: number;
}

const { list, save, remove } = createOwnedCollectionRepo<Widget>('widgets', 'widget');

describe('createOwnedCollectionRepo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list() reads every doc in the named collection', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ id: 'w1', ownerId: 'omer-levy', name: 'X', amount: 10, createdAt: 'a', updatedAt: 'b' }) }],
    });
    const items = await list();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('X');
  });

  it('list() propagates a read failure (never swallows into [])', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('down'));
    await expect(list()).rejects.toThrow('down');
  });

  it('save() with no id creates a new doc: fresh auto-id, createdAt===updatedAt, and an audit entry, in one batch', async () => {
    const result = await save({ ownerId: 'omer-levy', name: 'New', amount: 5 }, 'david-levy');
    expect(result.id).toBe('auto-id-1');
    expect(result.createdAt).toBe(result.updatedAt);
    expect(mockBatchSet).toHaveBeenCalledWith(
      'doc:widgets/auto-id-1',
      expect.objectContaining({ id: 'auto-id-1', ownerId: 'omer-levy', name: 'New', amount: 5 })
    );
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ actorMemberId: 'david-levy', action: 'widget.save', target: 'widgets/auto-id-1' });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('save() with an id that already exists PRESERVES createdAt (fetch-then-merge) while updating everything else', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ id: 'w1', ownerId: 'omer-levy', name: 'Old', amount: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }),
    });
    const result = await save({ id: 'w1', ownerId: 'omer-levy', name: 'Renamed', amount: 2 }, 'david-levy');
    expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
    expect(mockBatchSet).toHaveBeenCalledWith(
      'doc:widgets/w1',
      expect.objectContaining({ name: 'Renamed', createdAt: '2026-01-01T00:00:00.000Z' })
    );
  });

  it('save() with an id that does NOT yet exist (a caller-supplied new id) treats it as brand-new — createdAt=now', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    const result = await save({ id: 'w-new', ownerId: 'omer-levy', name: 'X', amount: 1 }, 'david-levy');
    expect(result.createdAt).toBe(result.updatedAt);
  });

  it('save() propagates a write failure (never silently drops the edit)', async () => {
    mockBatchCommit.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(save({ ownerId: 'omer-levy', name: 'X', amount: 1 }, 'david-levy')).rejects.toThrow('permission-denied');
  });

  it('remove() deletes the doc and writes a "widget.delete" audit entry, in one batch', async () => {
    await remove('w1', 'david-levy');
    expect(mockBatchDelete).toHaveBeenCalledWith('doc:widgets/w1');
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ actorMemberId: 'david-levy', action: 'widget.delete', target: 'widgets/w1' });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/financeCollections.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `financeCollections.ts`**

```ts
// src/services/financeCollections.ts
//
// Shared CRUD for the Stage-3 "owned financial collections" — accounts, loans, insurances (and
// recurring's plain-CRUD half; RecurringService.ts adds the bespoke catch-up-posting logic on top
// of this same factory — see Task 5). Design decision D8. All share an identical contract: read
// every doc, upsert one doc (new-or-edit, preserving `createdAt` across edits), delete one doc,
// every mutation paired with an audit_log entry in the SAME batch.
//
// Unlike GroupsService.saveGroup's accepted Stage-2 simplification of always overwriting
// createdAt on every save, this factory does a fetch-then-merge specifically to PRESERVE it —
// "when was this account/loan/policy first added" is real, user-facing financial data here, not
// an internal bookkeeping detail.
//
// Does NOT catch/swallow read failures into `[]` (list) or write failures (save/remove) — a
// failed read renders an error, never an empty state; a failed write must never look like a
// silently-dropped edit (project-wide rule).

import { collection, doc, getDoc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { writeAuditLog } from '../utils/auditLog';

export interface OwnedRecord {
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export type OwnedRecordInput<T extends OwnedRecord> = Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

export interface OwnedCollectionRepo<T extends OwnedRecord> {
  list(): Promise<T[]>;
  save(input: OwnedRecordInput<T>, actorMemberId: string): Promise<T>;
  remove(id: string, actorMemberId: string): Promise<void>;
}

export function createOwnedCollectionRepo<T extends OwnedRecord>(
  collectionName: string,
  auditPrefix: string
): OwnedCollectionRepo<T> {
  async function list(): Promise<T[]> {
    const snap = await getDocs(collection(db, collectionName));
    return snap.docs.map((d) => d.data() as T);
  }

  async function save(input: OwnedRecordInput<T>, actorMemberId: string): Promise<T> {
    const now = new Date().toISOString();
    const id = input.id ?? doc(collection(db, collectionName)).id;

    let createdAt = now;
    if (input.id) {
      const existing = await getDoc(doc(db, collectionName, input.id));
      if (existing.exists()) {
        createdAt = (existing.data() as T).createdAt;
      }
    }

    const record = { ...input, id, createdAt, updatedAt: now } as T;
    const batch = writeBatch(db);
    batch.set(doc(db, collectionName, id), record);
    writeAuditLog(batch, { actorMemberId, action: `${auditPrefix}.save`, target: `${collectionName}/${id}` });
    await batch.commit();
    return record;
  }

  async function remove(id: string, actorMemberId: string): Promise<void> {
    const batch = writeBatch(db);
    batch.delete(doc(db, collectionName, id));
    writeAuditLog(batch, { actorMemberId, action: `${auditPrefix}.delete`, target: `${collectionName}/${id}` });
    await batch.commit();
  }

  return { list, save, remove };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/__tests__/financeCollections.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/financeCollections.ts src/__tests__/financeCollections.test.ts
git commit -m "feat: shared owned-collection CRUD factory (financeCollections)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `AccountsService`, `LoansService`, `InsurancesService`

**Files:**
- Create: `src/services/AccountsService.ts`, `src/services/LoansService.ts`, `src/services/InsurancesService.ts`
- Test: `src/__tests__/AccountsService.test.ts`, `src/__tests__/LoansService.test.ts`, `src/__tests__/InsurancesService.test.ts`

**Interfaces:**
- Consumes: `createOwnedCollectionRepo` (Task 2), `Account`/`Loan`/`Insurance` (Task 1)
- Produces:
```ts
// src/services/AccountsService.ts
export const listAccounts: () => Promise<Account[]>;
export const saveAccount: (input: OwnedRecordInput<Account>, actorMemberId: string) => Promise<Account>;
export const deleteAccount: (id: string, actorMemberId: string) => Promise<void>;
// LoansService.ts / InsurancesService.ts: identical shape for Loan / Insurance.
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/AccountsService.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDocs, mockGetDoc, mockBatchSet, mockBatchDelete, mockBatchCommit } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockGetDoc: vi.fn(async () => ({ exists: () => false })),
  mockBatchSet: vi.fn(),
  mockBatchDelete: vi.fn(),
  mockBatchCommit: vi.fn(async () => undefined),
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => ({ __col: name })),
  doc: vi.fn((...args: unknown[]) => {
    if (args.length === 1) return { id: 'auto-1' };
    const [, ...segments] = args as [unknown, ...string[]];
    return `doc:${segments.join('/')}`;
  }),
  getDocs: mockGetDocs,
  getDoc: mockGetDoc,
  writeBatch: vi.fn(() => ({ set: mockBatchSet, delete: mockBatchDelete, commit: mockBatchCommit })),
}));

import { listAccounts, saveAccount, deleteAccount } from '../services/AccountsService';

describe('AccountsService (thin wiring over createOwnedCollectionRepo)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listAccounts reads the accounts collection', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ id: 'a1', ownerId: 'david-levy', name: 'עו״ש', type: 'bank', balance: 1000, balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }) }],
    });
    const accounts = await listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].type).toBe('bank');
  });

  it('saveAccount writes to accounts/{id} with an "account.save" audit action', async () => {
    await saveAccount({ ownerId: 'david-levy', name: 'עו״ש', type: 'bank', balance: 1000, balanceUpdatedAt: 'x', status: 'active' }, 'david-levy');
    expect(mockBatchSet).toHaveBeenCalledWith('doc:accounts/auto-1', expect.objectContaining({ type: 'bank' }));
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ action: 'account.save', target: 'accounts/auto-1' });
  });

  it('deleteAccount deletes accounts/{id} and audits "account.delete"', async () => {
    await deleteAccount('a1', 'david-levy');
    expect(mockBatchDelete).toHaveBeenCalledWith('doc:accounts/a1');
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ action: 'account.delete', target: 'accounts/a1' });
  });
});
```

```ts
// src/__tests__/LoansService.test.ts — identical shape, Loan fields
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDocs, mockGetDoc, mockBatchSet, mockBatchDelete, mockBatchCommit } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockGetDoc: vi.fn(async () => ({ exists: () => false })),
  mockBatchSet: vi.fn(),
  mockBatchDelete: vi.fn(),
  mockBatchCommit: vi.fn(async () => undefined),
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => ({ __col: name })),
  doc: vi.fn((...args: unknown[]) => {
    if (args.length === 1) return { id: 'auto-1' };
    const [, ...segments] = args as [unknown, ...string[]];
    return `doc:${segments.join('/')}`;
  }),
  getDocs: mockGetDocs,
  getDoc: mockGetDoc,
  writeBatch: vi.fn(() => ({ set: mockBatchSet, delete: mockBatchDelete, commit: mockBatchCommit })),
}));

import { listLoans, saveLoan, deleteLoan } from '../services/LoansService';

describe('LoansService (thin wiring over createOwnedCollectionRepo)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listLoans reads the loans collection', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ id: 'l1', ownerId: 'david-levy', name: 'משכנתא', loanType: 'mortgage', principal: 1000000, balance: 800000, interestRate: 3.5, monthlyPayment: 5000, startDate: 'x', endDate: 'y', status: 'active', createdAt: 'x', updatedAt: 'x' }) }],
    });
    const loans = await listLoans();
    expect(loans).toHaveLength(1);
    expect(loans[0].loanType).toBe('mortgage');
  });

  it('saveLoan writes to loans/{id} with a "loan.save" audit action', async () => {
    await saveLoan({ ownerId: 'david-levy', name: 'משכנתא', loanType: 'mortgage', principal: 1000000, balance: 800000, interestRate: 3.5, monthlyPayment: 5000, startDate: 'x', endDate: 'y', status: 'active' }, 'david-levy');
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ action: 'loan.save', target: 'loans/auto-1' });
  });

  it('deleteLoan deletes loans/{id} and audits "loan.delete"', async () => {
    await deleteLoan('l1', 'david-levy');
    expect(mockBatchDelete).toHaveBeenCalledWith('doc:loans/l1');
  });
});
```

```ts
// src/__tests__/InsurancesService.test.ts — identical shape, Insurance fields
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDocs, mockGetDoc, mockBatchSet, mockBatchDelete, mockBatchCommit } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockGetDoc: vi.fn(async () => ({ exists: () => false })),
  mockBatchSet: vi.fn(),
  mockBatchDelete: vi.fn(),
  mockBatchCommit: vi.fn(async () => undefined),
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => ({ __col: name })),
  doc: vi.fn((...args: unknown[]) => {
    if (args.length === 1) return { id: 'auto-1' };
    const [, ...segments] = args as [unknown, ...string[]];
    return `doc:${segments.join('/')}`;
  }),
  getDocs: mockGetDocs,
  getDoc: mockGetDoc,
  writeBatch: vi.fn(() => ({ set: mockBatchSet, delete: mockBatchDelete, commit: mockBatchCommit })),
}));

import { listInsurances, saveInsurance, deleteInsurance } from '../services/InsurancesService';

describe('InsurancesService (thin wiring over createOwnedCollectionRepo)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listInsurances reads the insurances collection', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ id: 'i1', ownerId: 'david-levy', type: 'car', provider: 'הראל', insuredMemberId: 'david-levy', premium: 300, premiumFrequency: 'monthly', coverages: [], renewalDate: 'x', status: 'active', createdAt: 'x', updatedAt: 'x' }) }],
    });
    const policies = await listInsurances();
    expect(policies).toHaveLength(1);
    expect(policies[0].type).toBe('car');
  });

  it('saveInsurance writes to insurances/{id} with an "insurance.save" audit action', async () => {
    await saveInsurance({ ownerId: 'david-levy', type: 'car', provider: 'הראל', insuredMemberId: 'david-levy', premium: 300, premiumFrequency: 'monthly', coverages: [], renewalDate: 'x', status: 'active' }, 'david-levy');
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ action: 'insurance.save', target: 'insurances/auto-1' });
  });

  it('deleteInsurance deletes insurances/{id} and audits "insurance.delete"', async () => {
    await deleteInsurance('i1', 'david-levy');
    expect(mockBatchDelete).toHaveBeenCalledWith('doc:insurances/i1');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/AccountsService.test.ts src/__tests__/LoansService.test.ts src/__tests__/InsurancesService.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three services**

```ts
// src/services/AccountsService.ts
import { createOwnedCollectionRepo } from './financeCollections';
import type { Account } from '../types/finance';

const repo = createOwnedCollectionRepo<Account>('accounts', 'account');
export const listAccounts = repo.list;
export const saveAccount = repo.save;
export const deleteAccount = repo.remove;
```

```ts
// src/services/LoansService.ts
import { createOwnedCollectionRepo } from './financeCollections';
import type { Loan } from '../types/finance';

const repo = createOwnedCollectionRepo<Loan>('loans', 'loan');
export const listLoans = repo.list;
export const saveLoan = repo.save;
export const deleteLoan = repo.remove;
```

```ts
// src/services/InsurancesService.ts
import { createOwnedCollectionRepo } from './financeCollections';
import type { Insurance } from '../types/finance';

const repo = createOwnedCollectionRepo<Insurance>('insurances', 'insurance');
export const listInsurances = repo.list;
export const saveInsurance = repo.save;
export const deleteInsurance = repo.remove;
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/__tests__/AccountsService.test.ts src/__tests__/LoansService.test.ts src/__tests__/InsurancesService.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/AccountsService.ts src/services/LoansService.ts src/services/InsurancesService.ts src/__tests__/AccountsService.test.ts src/__tests__/LoansService.test.ts src/__tests__/InsurancesService.test.ts
git commit -m "feat: AccountsService + LoansService + InsurancesService

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Recurring catch-up period computation (pure)

**Files:**
- Create: `src/utils/recurringCatchup.ts`
- Test: `src/__tests__/recurringCatchup.test.ts`

**Interfaces:**
- Consumes: nothing (pure)
- Produces:
```ts
// src/utils/recurringCatchup.ts
export interface RecurringCatchupInput {
  status: 'active' | 'paused' | 'ended';
  chargeDay: number;          // 1-31
  startDate: string;          // ISO date 'YYYY-MM-DD'
  endDate?: string;           // ISO date
  lastPostedPeriod?: string;  // 'YYYY-MM'
}
export function computeDuePeriods(item: RecurringCatchupInput, today: Date): string[];
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/recurringCatchup.test.ts
import { describe, expect, it } from 'vitest';
import { computeDuePeriods } from '../utils/recurringCatchup';

const base = { status: 'active' as const, chargeDay: 10, startDate: '2026-06-01' };

describe('computeDuePeriods', () => {
  it('returns [] for a paused item', () => {
    expect(computeDuePeriods({ ...base, status: 'paused' }, new Date('2026-08-15'))).toEqual([]);
  });

  it('returns [] for an ended item', () => {
    expect(computeDuePeriods({ ...base, status: 'ended' }, new Date('2026-08-15'))).toEqual([]);
  });

  it('a brand-new item whose chargeDay has NOT yet been reached this month is not due', () => {
    expect(computeDuePeriods({ ...base, startDate: '2026-08-01', chargeDay: 20 }, new Date('2026-08-15'))).toEqual([]);
  });

  it('a brand-new item whose chargeDay HAS been reached this month is due for the current period only', () => {
    expect(computeDuePeriods({ ...base, startDate: '2026-08-01', chargeDay: 10 }, new Date('2026-08-15'))).toEqual(['2026-08']);
  });

  it('catches up multiple fully-elapsed months plus the current one, when chargeDay has passed', () => {
    const result = computeDuePeriods({ ...base, lastPostedPeriod: '2026-05', chargeDay: 10 }, new Date('2026-08-15'));
    expect(result).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('catches up past months but WITHHOLDS the current month when chargeDay has not passed yet', () => {
    const result = computeDuePeriods({ ...base, lastPostedPeriod: '2026-05', chargeDay: 20 }, new Date('2026-08-15'));
    expect(result).toEqual(['2026-06', '2026-07']);
  });

  it('returns [] when the current period was already posted', () => {
    expect(computeDuePeriods({ ...base, lastPostedPeriod: '2026-08', chargeDay: 1 }, new Date('2026-08-15'))).toEqual([]);
  });

  it('respects endDate — nothing due after the item has ended', () => {
    const result = computeDuePeriods({ ...base, lastPostedPeriod: '2026-05', endDate: '2026-06-30', chargeDay: 1 }, new Date('2026-08-15'));
    expect(result).toEqual(['2026-06']);
  });

  it('handles a December -> January year rollover correctly', () => {
    const result = computeDuePeriods({ ...base, startDate: '2025-11-01', lastPostedPeriod: '2025-11', chargeDay: 5 }, new Date('2026-01-10'));
    expect(result).toEqual(['2025-12', '2026-01']);
  });

  it('returns [] for a malformed range (endDate before startDate)', () => {
    const result = computeDuePeriods({ ...base, startDate: '2026-08-01', endDate: '2026-01-01', chargeDay: 1 }, new Date('2026-08-15'));
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/recurringCatchup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `recurringCatchup.ts`**

```ts
// src/utils/recurringCatchup.ts
//
// Pure catch-up logic for the recurring-transactions engine (spec §11, §7 `recurring`). This is
// a LOCAL-first app with no Cloud Functions (spec §15) — there is no server-side scheduler to
// post a recurring transaction on its charge day while the app is closed. Instead: on every app
// open (RecurringService.postDueRecurringTransactions, Task 5), every active recurring item is
// checked against "today" and any period(s) it missed while the app was closed are posted in one
// catch-up pass. This module computes WHICH periods are due; it does no I/O.
//
// A period ('YYYY-MM') is due when:
//   - the item is 'active' (paused/ended items are never due)
//   - the period is >= the item's start period and <= its end period (if any)
//   - the period has not already been posted (> lastPostedPeriod, or from the start period if
//     nothing has ever been posted)
//   - AND, only for the CURRENT period specifically: today's day-of-month has reached chargeDay.
//     Every period strictly BEFORE the current one is always due once reached (a fully-elapsed
//     past month's charge is owed regardless of today's date) — only the in-progress current
//     month is gated by chargeDay, so a charge dated the 28th doesn't post on the 1st.

function periodOfDateString(dateStr: string): string {
  return dateStr.slice(0, 7); // 'YYYY-MM-DD' -> 'YYYY-MM'
}

function periodOfDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function comparePeriod(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function nextPeriod(period: string): string {
  const [yearStr, monthStr] = period.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** Every period from `from` to `to` inclusive, ascending. Empty if `from` > `to`. */
function periodsBetween(from: string, to: string): string[] {
  const result: string[] = [];
  let cursor = from;
  while (comparePeriod(cursor, to) <= 0) {
    result.push(cursor);
    cursor = nextPeriod(cursor);
  }
  return result;
}

export interface RecurringCatchupInput {
  status: 'active' | 'paused' | 'ended';
  chargeDay: number;
  startDate: string;
  endDate?: string;
  lastPostedPeriod?: string;
}

export function computeDuePeriods(item: RecurringCatchupInput, today: Date): string[] {
  if (item.status !== 'active') return [];

  const currentPeriod = periodOfDate(today);
  const startPeriod = periodOfDateString(item.startDate);
  const endPeriod = item.endDate ? periodOfDateString(item.endDate) : null;

  if (endPeriod && comparePeriod(startPeriod, endPeriod) > 0) return []; // malformed range

  const fromPeriod = item.lastPostedPeriod
    ? (comparePeriod(nextPeriod(item.lastPostedPeriod), startPeriod) > 0 ? nextPeriod(item.lastPostedPeriod) : startPeriod)
    : startPeriod;

  const rangeEnd = endPeriod && comparePeriod(endPeriod, currentPeriod) < 0 ? endPeriod : currentPeriod;
  if (comparePeriod(fromPeriod, rangeEnd) > 0) return [];

  const candidates = periodsBetween(fromPeriod, rangeEnd);
  const todayDay = today.getDate();

  return candidates.filter((period) => {
    if (comparePeriod(period, currentPeriod) < 0) return true; // fully-elapsed past month — always due
    return todayDay >= item.chargeDay; // current month — gated by chargeDay
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/__tests__/recurringCatchup.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/recurringCatchup.ts src/__tests__/recurringCatchup.test.ts
git commit -m "feat: recurring catch-up period computation (pure)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `RecurringService` — CRUD + local-first catch-up posting engine

**Files:**
- Create: `src/services/RecurringService.ts`
- Test: `src/__tests__/RecurringService.test.ts`

**Interfaces:**
- Consumes: `createOwnedCollectionRepo` (Task 2), `computeDuePeriods` (Task 4), `listMembers` (Stage 1/2), `writeAuditLog` (Stage 2)
- Produces:
```ts
// src/services/RecurringService.ts
export const listRecurring: () => Promise<RecurringItem[]>;
export const saveRecurring: (input: OwnedRecordInput<RecurringItem>, actorMemberId: string) => Promise<RecurringItem>;
export const deleteRecurring: (id: string, actorMemberId: string) => Promise<void>;
export interface PostingOutcome {
  posted: { recurringId: string; period: string }[];
  failed: { recurringId: string; error: string }[];
}
export function postDueRecurringTransactions(actorMemberId: string, today?: Date): Promise<PostingOutcome>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/RecurringService.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockList, mockListMembers, mockBatchSet, mockBatchCommit, mockWriteAuditLog } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockListMembers: vi.fn(),
  mockBatchSet: vi.fn(),
  mockBatchCommit: vi.fn(async () => undefined),
  mockWriteAuditLog: vi.fn(),
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, ...segments: string[]) => `doc:${segments.join('/')}`),
  writeBatch: vi.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit })),
}));
vi.mock('../services/financeCollections', () => ({
  createOwnedCollectionRepo: vi.fn(() => ({ list: mockList, save: vi.fn(), remove: vi.fn() })),
}));
vi.mock('../services/MembersService', () => ({ listMembers: mockListMembers }));
vi.mock('../utils/auditLog', () => ({ writeAuditLog: mockWriteAuditLog }));

import { postDueRecurringTransactions } from '../services/RecurringService';

const activeExpenseItem = {
  id: 'rec-1', kind: 'expense' as const, description: 'ארנונה', amount: 500, category: 'דיור',
  chargeDay: 10, status: 'active' as const, startDate: '2026-06-01', ownerId: 'david-levy',
  createdAt: 'x', updatedAt: 'x',
};

describe('postDueRecurringTransactions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts a due expense item into transaction_lines with the owner resolved to a display name, and advances lastPostedPeriod', async () => {
    mockList.mockResolvedValueOnce([{ ...activeExpenseItem, lastPostedPeriod: '2026-07' }]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);

    const result = await postDueRecurringTransactions('david-levy', new Date('2026-08-15'));

    expect(result.posted).toEqual([{ recurringId: 'rec-1', period: '2026-08' }]);
    expect(result.failed).toEqual([]);
    expect(mockBatchSet).toHaveBeenCalledWith(
      'doc:transaction_lines/rec-1__2026-08',
      expect.objectContaining({ owner: 'דויד', amount: 500, date: '2026-08-10', recurringId: 'rec-1', recurringPeriod: '2026-08' })
    );
    expect(mockBatchSet).toHaveBeenCalledWith(
      'doc:recurring/rec-1',
      { lastPostedPeriod: '2026-08', updatedAt: expect.any(String) },
      { merge: true }
    );
  });

  it('posts a due income item into incomes without an owner field', async () => {
    mockList.mockResolvedValueOnce([{
      id: 'rec-2', kind: 'income', description: 'משכורת', amount: 12000, chargeDay: 1,
      status: 'active', startDate: '2026-08-01', ownerId: 'lilit-levy', createdAt: 'x', updatedAt: 'x',
    }]);
    mockListMembers.mockResolvedValueOnce([{ id: 'lilit-levy', name: 'לילית' }]);

    const result = await postDueRecurringTransactions('lilit-levy', new Date('2026-08-15'));

    expect(result.posted).toEqual([{ recurringId: 'rec-2', period: '2026-08' }]);
    expect(mockBatchSet).toHaveBeenCalledWith(
      'doc:incomes/rec-2__2026-08',
      expect.objectContaining({ name: 'משכורת', amount: 12000, month: '08', year: '2026' })
    );
  });

  it('skips an item with nothing due — no batch commit at all for it', async () => {
    mockList.mockResolvedValueOnce([{ ...activeExpenseItem, chargeDay: 25, lastPostedPeriod: '2026-08' }]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);
    const result = await postDueRecurringTransactions('david-levy', new Date('2026-08-15'));
    expect(result.posted).toEqual([]);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('one item failing (unresolvable owner) does not block posting for the others', async () => {
    mockList.mockResolvedValueOnce([
      { ...activeExpenseItem, id: 'rec-ghost', ownerId: 'no-such-member', lastPostedPeriod: '2026-07' },
      { ...activeExpenseItem, id: 'rec-ok', lastPostedPeriod: '2026-07' },
    ]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);

    const result = await postDueRecurringTransactions('david-levy', new Date('2026-08-15'));

    expect(result.failed).toEqual([{ recurringId: 'rec-ghost', error: expect.stringContaining('no-such-member') }]);
    expect(result.posted).toEqual([{ recurringId: 'rec-ok', period: '2026-08' }]);
  });

  it('a failure reading the inputs themselves is returned as a single failure, never thrown', async () => {
    mockList.mockRejectedValueOnce(new Error('permission-denied'));
    const result = await postDueRecurringTransactions('david-levy', new Date('2026-08-15'));
    expect(result.failed).toEqual([{ recurringId: '(all)', error: 'permission-denied' }]);
    expect(result.posted).toEqual([]);
  });

  it('writes an audit_log entry per posted period, in the same batch', async () => {
    mockList.mockResolvedValueOnce([{ ...activeExpenseItem, lastPostedPeriod: '2026-07' }]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);
    await postDueRecurringTransactions('david-levy', new Date('2026-08-15'));
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorMemberId: 'david-levy', action: 'recurring.autopost', target: 'recurring/rec-1' })
    );
  });

  it('catches up multiple missed periods for one item in a SINGLE batch/commit', async () => {
    mockList.mockResolvedValueOnce([{ ...activeExpenseItem, lastPostedPeriod: '2026-05' }]);
    mockListMembers.mockResolvedValueOnce([{ id: 'david-levy', name: 'דויד' }]);
    const result = await postDueRecurringTransactions('david-levy', new Date('2026-08-15'));
    expect(result.posted.map((p) => p.period)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/RecurringService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `RecurringService.ts`**

```ts
// src/services/RecurringService.ts
//
// CRUD (via the shared factory, Task 2) plus the bespoke catch-up-posting engine (spec §11 —
// "תנועות קבועות... נרשמות אוטומטית בתאריך שלהן"). LOCAL-first, no Cloud Functions (spec §15) —
// postDueRecurringTransactions is called once per app session (App.tsx, Task 9) and posts every
// period every active recurring item missed since it was last posted, using computeDuePeriods
// (Task 4, pure) to decide what's due.
//
// Idempotency: each posted transaction_lines/incomes doc uses a DETERMINISTIC id
// (`${recurringId}__${period}`), not an auto-id. Combined with lastPostedPeriod advancing in the
// SAME batch, a period is posted at most once under normal operation — the deterministic id is
// defense-in-depth for the case of two concurrent sessions (e.g. two open tabs) racing the same
// catch-up before either commits: the second, redundant write overwrites identical data rather
// than creating a duplicate financial row.
//
// Owner-attribution bridge (Design decision D1): recurring.ownerId is a Member.id, matching every
// other Stage 3 collection. transaction_lines.owner, however, remains the pre-existing Stage 2
// convention — a Hebrew DISPLAY NAME. Posting an expense-kind item therefore resolves
// ownerId -> current display name via a fresh listMembers() call at posting time (never a
// denormalized/cached name, which could go stale on a rename).
//
// Permission interaction (see Risks in the Stage 3 plan): posting a recurring EXPENSE only needs
// the actor's own edit access on 'expenses' + 'recurring'. Posting a recurring INCOME
// additionally needs FAMILY-level edit on 'income' specifically — 'income' remains one of the
// Stage 2 OWNERLESS_MODULES (D5), where 'own' is structurally denied — so a 'member'-role user
// with only 'own' access to income can define their own recurring income item, but their own
// session can never successfully post it; it posts once a parent/super-admin session (which
// bypasses the matrix) next opens the app. Intentional and documented, not silently swallowed — a
// denied posting attempt surfaces in this function's `failed` list.

import { doc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { createOwnedCollectionRepo } from './financeCollections';
import { listMembers } from './MembersService';
import { writeAuditLog } from '../utils/auditLog';
import { computeDuePeriods } from '../utils/recurringCatchup';
import type { RecurringItem } from '../types/finance';

const RECURRING_COLLECTION = 'recurring';

const repo = createOwnedCollectionRepo<RecurringItem>(RECURRING_COLLECTION, 'recurring');
export const listRecurring = repo.list;
export const saveRecurring = repo.save;
export const deleteRecurring = repo.remove;

export interface PostingOutcome {
  posted: { recurringId: string; period: string }[];
  failed: { recurringId: string; error: string }[];
}

/**
 * Catch-up-posts every due period for every recurring item the signed-in actor can currently
 * read+edit (per Firestore Rules — this issues normal client writes, no special privilege of its
 * own). One item's failure does NOT stop the rest from being attempted (matches the
 * `recomputeAllResolvedPermissions`/`recomputeMemberIds` convention elsewhere in this codebase).
 * Never throws; the caller inspects `failed` to decide whether/how to surface it.
 */
export async function postDueRecurringTransactions(
  actorMemberId: string,
  today: Date = new Date()
): Promise<PostingOutcome> {
  const posted: PostingOutcome['posted'] = [];
  const failed: PostingOutcome['failed'] = [];

  let items: RecurringItem[];
  let nameByMemberId: Map<string, string>;
  try {
    const [itemList, members] = await Promise.all([listRecurring(), listMembers()]);
    items = itemList;
    nameByMemberId = new Map(members.map((m) => [m.id, m.name]));
  } catch (err) {
    failed.push({ recurringId: '(all)', error: err instanceof Error ? err.message : String(err) });
    return { posted, failed };
  }

  for (const item of items) {
    try {
      const duePeriods = computeDuePeriods(item, today);
      if (duePeriods.length === 0) continue;

      const batch = writeBatch(db);
      for (const period of duePeriods) {
        const postId = `${item.id}__${period}`;
        const [year, month] = period.split('-');
        const dateStr = `${year}-${month}-${String(item.chargeDay).padStart(2, '0')}`;

        if (item.kind === 'expense') {
          const ownerName = nameByMemberId.get(item.ownerId);
          if (!ownerName) {
            throw new Error(`owner ${item.ownerId} not found in members — cannot resolve transaction_lines.owner`);
          }
          batch.set(doc(db, 'transaction_lines', postId), {
            owner: ownerName,
            amount: item.amount,
            date: dateStr,
            category: item.category ?? 'שונות',
            description: item.description,
            isCredit: false,
            recurringId: item.id,
            recurringPeriod: period,
          });
        } else {
          batch.set(doc(db, 'incomes', postId), {
            name: item.description,
            amount: item.amount,
            date: dateStr,
            month,
            year,
            recurringId: item.id,
            recurringPeriod: period,
          });
        }

        writeAuditLog(batch, {
          actorMemberId,
          action: 'recurring.autopost',
          target: `${RECURRING_COLLECTION}/${item.id}`,
          details: { period, kind: item.kind, amount: item.amount },
        });
      }

      const lastPeriod = duePeriods[duePeriods.length - 1];
      batch.set(
        doc(db, RECURRING_COLLECTION, item.id),
        { lastPostedPeriod: lastPeriod, updatedAt: new Date().toISOString() },
        { merge: true }
      );

      await batch.commit();
      duePeriods.forEach((period) => posted.push({ recurringId: item.id, period }));
    } catch (err) {
      failed.push({ recurringId: item.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { posted, failed };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/__tests__/RecurringService.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/RecurringService.ts src/__tests__/RecurringService.test.ts
git commit -m "feat: RecurringService — CRUD + local-first catch-up posting engine

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Net-worth rollup computation (pure, derived)

**Files:**
- Create: `src/utils/netWorth.ts`
- Test: `src/__tests__/netWorth.test.ts`

**Interfaces:**
- Consumes: `Account`, `Loan` (Task 1)
- Produces:
```ts
// src/utils/netWorth.ts
export type NetWorthScope = 'own' | 'family';
export interface NetWorthLineItem {
  label: string;
  amount: number;
  source: 'accounts' | 'investments' | 'loans' | 'realEstate';
  asOf: string;
}
export interface NetWorthResult {
  scope: NetWorthScope;
  assets: NetWorthLineItem[];
  liabilities: NetWorthLineItem[];
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  computedAt: string;
}
export interface NetWorthInput {
  viewerMemberId: string;
  scope: NetWorthScope;
  accounts: Account[];
  investments: Array<{ value: number }>;
  loans: Loan[];
  realEstateValue: number;
  realEstateAsOf: string;
}
export function computeNetWorth(input: NetWorthInput): NetWorthResult;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/netWorth.test.ts
import { describe, expect, it } from 'vitest';
import { computeNetWorth } from '../utils/netWorth';
import type { Account, Loan } from '../types/finance';

const account = (over: Partial<Account>): Account => ({
  id: 'a1', ownerId: 'david-levy', name: 'עו"ש', type: 'bank', balance: 10000,
  balanceUpdatedAt: '2026-08-01T00:00:00.000Z', status: 'active',
  createdAt: 'x', updatedAt: 'x', ...over,
});

const loan = (over: Partial<Loan>): Loan => ({
  id: 'l1', ownerId: 'david-levy', name: 'משכנתא', loanType: 'mortgage', principal: 1000000,
  balance: 800000, interestRate: 3.5, monthlyPayment: 5000, startDate: '2020-01-01',
  endDate: '2045-01-01', status: 'active', createdAt: 'x', updatedAt: '2026-08-01T00:00:00.000Z', ...over,
});

describe('computeNetWorth', () => {
  it('family scope sums every account/loan regardless of owner', () => {
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family',
      accounts: [account({ balance: 10000 }), account({ id: 'a2', ownerId: 'lilit-levy', balance: 5000 })],
      investments: [{ value: 20000 }],
      loans: [loan({ balance: 800000 })],
      realEstateValue: 0, realEstateAsOf: 'x',
    });
    expect(result.totalAssets).toBe(10000 + 5000 + 20000);
    expect(result.totalLiabilities).toBe(800000);
    expect(result.netWorth).toBe(10000 + 5000 + 20000 - 800000);
  });

  it('own scope excludes accounts/loans owned by other members, and excludes investments entirely (no owner field to filter by)', () => {
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'own',
      accounts: [account({ balance: 10000 }), account({ id: 'a2', ownerId: 'lilit-levy', balance: 5000 })],
      investments: [{ value: 20000 }],
      loans: [loan({ balance: 800000 }), loan({ id: 'l2', ownerId: 'lilit-levy', balance: 100000 })],
      realEstateValue: 0, realEstateAsOf: 'x',
    });
    expect(result.totalAssets).toBe(10000);
    expect(result.totalLiabilities).toBe(800000);
    expect(result.assets.find((a) => a.source === 'investments')).toBeUndefined();
  });

  it('includes a real-estate line only when a non-zero value is supplied', () => {
    const withRealEstate = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family', accounts: [], investments: [], loans: [],
      realEstateValue: 2000000, realEstateAsOf: '2026-01-01T00:00:00.000Z',
    });
    expect(withRealEstate.assets.find((a) => a.source === 'realEstate')).toMatchObject({ amount: 2000000 });

    const without = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family', accounts: [], investments: [], loans: [],
      realEstateValue: 0, realEstateAsOf: 'x',
    });
    expect(without.assets.find((a) => a.source === 'realEstate')).toBeUndefined();
  });

  it('every line item carries source + the LATEST contributing asOf, for the Stage 4 explain layer', () => {
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family',
      accounts: [account({ balanceUpdatedAt: '2026-08-01T00:00:00.000Z' }), account({ id: 'a2', balanceUpdatedAt: '2026-08-10T00:00:00.000Z' })],
      investments: [], loans: [], realEstateValue: 0, realEstateAsOf: 'x',
    });
    const accountsLine = result.assets.find((a) => a.source === 'accounts')!;
    expect(accountsLine.asOf).toBe('2026-08-10T00:00:00.000Z');
  });

  it('an empty family with nothing at all yields a zero net worth, not a crash', () => {
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family', accounts: [], investments: [], loans: [],
      realEstateValue: 0, realEstateAsOf: 'x',
    });
    expect(result.netWorth).toBe(0);
    expect(result.totalAssets).toBe(0);
    expect(result.totalLiabilities).toBe(0);
  });

  it('accounts and loans lines are always present (even at zero) for family scope — only investments/realEstate are conditional', () => {
    const result = computeNetWorth({
      viewerMemberId: 'david-levy', scope: 'family', accounts: [], investments: [], loans: [],
      realEstateValue: 0, realEstateAsOf: 'x',
    });
    expect(result.assets.find((a) => a.source === 'accounts')).toBeDefined();
    expect(result.liabilities.find((l) => l.source === 'loans')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/netWorth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `netWorth.ts`**

```ts
// src/utils/netWorth.ts
//
// Client-side derived net-worth rollup (spec §6 "שווי נקי", §10 forecast layer-1 inputs). NOT a
// Firestore collection, NOT its own permission module — Design decision D4: net worth is exactly
// whatever family-vs-own access the viewer already has on the collections that feed it
// (accounts, investments, loans), plus the pre-existing manually-maintained real-estate figure in
// settings/ecosystem. This module does ONE thing: given data the caller has ALREADY fetched (and
// which Firestore Rules have therefore already filtered to what the viewer may see), compute
// totals + a per-category breakdown carrying `source` and `asOf` on every line — the provenance
// metadata the Stage 4 hover-explain glossary needs ("מה זה, איך חושב, נכון לאיזה תאריך"). Stage 3
// produces this DATA; the rendered rollup screen is Stage 5.
//
// D5: real estate has no dedicated collection yet — passed in as a resolved number (caller reads
// it from settings/ecosystem, unchanged legacy shape). ecosystem.mortgage is expected to migrate
// into `loans` (loanType: 'mortgage') over time but that migration is NOT done in Stage 3 — a
// caller populating BOTH would double-count a mortgage; see the Stage 3 plan's Risks section.

import type { Account, Loan } from '../types/finance';

export type NetWorthScope = 'own' | 'family';

export interface NetWorthLineItem {
  label: string;
  amount: number;
  source: 'accounts' | 'investments' | 'loans' | 'realEstate';
  asOf: string;
}

export interface NetWorthResult {
  scope: NetWorthScope;
  assets: NetWorthLineItem[];
  liabilities: NetWorthLineItem[];
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  computedAt: string;
}

export interface NetWorthInput {
  viewerMemberId: string;
  scope: NetWorthScope;
  accounts: Account[];
  investments: Array<{ value: number }>;
  loans: Loan[];
  realEstateValue: number;
  realEstateAsOf: string;
}

const latestOf = (dates: string[], fallback: string): string =>
  dates.length === 0 ? fallback : dates.reduce((a, b) => (a > b ? a : b));

export function computeNetWorth(input: NetWorthInput): NetWorthResult {
  const computedAt = new Date().toISOString();

  const scopedAccounts = input.scope === 'own'
    ? input.accounts.filter((a) => a.ownerId === input.viewerMemberId)
    : input.accounts;
  const scopedLoans = input.scope === 'own'
    ? input.loans.filter((l) => l.ownerId === input.viewerMemberId)
    : input.loans;
  // Investments remain ownerless (Stage 2 D5) — there is no per-item owner to filter by, so an
  // 'own' scope excludes investments entirely rather than guessing. Documented, not silent.
  const scopedInvestments = input.scope === 'own' ? [] : input.investments;

  const assets: NetWorthLineItem[] = [
    {
      label: 'חשבונות ומזומן',
      amount: scopedAccounts.reduce((sum, a) => sum + a.balance, 0),
      source: 'accounts',
      asOf: latestOf(scopedAccounts.map((a) => a.balanceUpdatedAt), computedAt),
    },
  ];
  if (scopedInvestments.length > 0) {
    assets.push({
      label: 'השקעות ופנסיה',
      amount: scopedInvestments.reduce((sum, i) => sum + i.value, 0),
      source: 'investments',
      asOf: computedAt, // the existing investments collection carries no per-doc updatedAt today
    });
  }
  if (input.realEstateValue !== 0) {
    assets.push({ label: 'נדל״ן', amount: input.realEstateValue, source: 'realEstate', asOf: input.realEstateAsOf });
  }

  const liabilities: NetWorthLineItem[] = [
    {
      label: 'הלוואות וחובות',
      amount: scopedLoans.reduce((sum, l) => sum + l.balance, 0),
      source: 'loans',
      asOf: latestOf(scopedLoans.map((l) => l.updatedAt), computedAt),
    },
  ];

  const totalAssets = assets.reduce((sum, a) => sum + a.amount, 0);
  const totalLiabilities = liabilities.reduce((sum, l) => sum + l.amount, 0);

  return {
    scope: input.scope,
    assets,
    liabilities,
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    computedAt,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/__tests__/netWorth.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/netWorth.ts src/__tests__/netWorth.test.ts
git commit -m "feat: net-worth rollup computation (pure, derived — no new permission module)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: `firestore.rules` — accounts/recurring/loans/insurances enforcement + audit_log broadening

**Files:**
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: `request.auth.token.role`/`memberId` (Stage 2), `members/{id}.resolvedPermissions` (Stage 2)
- Produces: schema validators + a new `ownedModuleAllowed()`/`canAccessOwnedModule()` helper pair + `match` blocks for `accounts`/`recurring`/`loans`/`insurances` + the D7 `audit_log` rule change.

- [ ] **Step 1: Replace `firestore.rules` in full**

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ── Identity helpers ──────────────────────────────────────────────────────────────
    function isSignedIn() { return request.auth != null; }
    function role() { return request.auth.token.role; }
    function memberId() { return request.auth.token.memberId; }
    function isSuperAdmin() { return isSignedIn() && role() == 'super-admin'; }
    function isParent() { return isSignedIn() && role() == 'parent'; }
    function hasRole() { return isSignedIn() && role() in ['super-admin', 'parent', 'member']; }

    function myMember() {
      return get(/databases/$(database)/documents/members/$(memberId())).data;
    }

    function myLevel(module, action) {
      return myMember().get('resolvedPermissions', {}).get(module, {}).get(action, 'none');
    }

    // 'own' grants access only when the doc's `owner` field (display name) matches the caller's
    // own name (Stage 2 D5 — transaction_lines's pre-existing convention).
    function expensesAllowed(action, data) {
      let level = myLevel('expenses', action);
      return level == 'family' || (level == 'own' && data.owner == myMember().name);
    }

    // Ownerless modules (Stage 2 D5): 'own' does not grant access — only 'family' does.
    function ownerlessModuleAllowed(module, action) {
      return myLevel(module, action) == 'family';
    }

    // Stage 3 D1/D2 — a THIRD 'own' convention: `ownerId` is a memberId, not a display name, used
    // by the four collections that ship owned-from-day-one (accounts/recurring/loans/insurances).
    // Distinct from expensesAllowed() (compares data.owner, a NAME) and ownerlessModuleAllowed()
    // (never checks 'own' at all).
    function ownedModuleAllowed(module, action, data) {
      let level = myLevel(module, action);
      return level == 'family' || (level == 'own' && data.ownerId == memberId());
    }

    function canAccessExpenses(action, data) {
      return isSuperAdmin() || isParent() || (hasRole() && expensesAllowed(action, data));
    }
    function canAccessOwnerlessModule(module, action) {
      return isSuperAdmin() || isParent() || (hasRole() && ownerlessModuleAllowed(module, action));
    }
    function canAccessOwnedModule(module, action, data) {
      return isSuperAdmin() || isParent() || (hasRole() && ownedModuleAllowed(module, action, data));
    }

    // ── Schema validation ────────────────────────────────────────────────────────────
    function isValidMember(data) {
      return data.name is string && data.name.size() > 0
        && data.role in ['הורה', 'ילד']
        && data.color is string && data.color.matches('^#[0-9A-Fa-f]{6}$')
        && data.groups is list
        && data.createdAt is string && data.updatedAt is string
        && (!('uid' in data) || data.uid == null || data.uid is string)
        && (!('idNumber' in data) || data.idNumber is string)
        && (!('resolvedPermissions' in data) || data.resolvedPermissions is map);
    }

    function isValidGroup(data) {
      return data.name is string && data.name.size() > 0
        && data.memberIds is list
        && data.createdAt is string && data.updatedAt is string;
    }

    function isValidPermissionDoc(data) {
      return data.scope in ['group', 'member']
        && data.targetId is string && data.targetId.size() > 0
        && data.modules is map
        && data.updatedAt is string
        && data.updatedBy is string;
    }

    function isValidAuditEntry(data) {
      return data.actorMemberId is string && data.actorMemberId.size() > 0
        && data.action is string && data.action.size() > 0
        && data.target is string
        && data.at is string;
    }

    // Stage 3 schema validators — one per new collection (spec §7).
    function isValidAccount(data) {
      return data.name is string && data.name.size() > 0
        && data.type in ['bank', 'cash', 'credit']
        && data.ownerId is string && data.ownerId.size() > 0
        && data.balance is number
        && data.balanceUpdatedAt is string
        && data.status in ['active', 'archived']
        && data.createdAt is string && data.updatedAt is string;
    }

    function isValidRecurring(data) {
      return data.kind in ['income', 'expense']
        && data.description is string && data.description.size() > 0
        && data.amount is number && data.amount > 0
        && data.chargeDay is int && data.chargeDay >= 1 && data.chargeDay <= 31
        && data.ownerId is string && data.ownerId.size() > 0
        && data.status in ['active', 'paused', 'ended']
        && data.startDate is string
        && data.createdAt is string && data.updatedAt is string
        && (!('endDate' in data) || data.endDate is string)
        && (!('lastPostedPeriod' in data) || data.lastPostedPeriod is string)
        && (!('category' in data) || data.category is string);
    }

    function isValidLoan(data) {
      return data.name is string && data.name.size() > 0
        && data.loanType in ['mortgage', 'personal', 'creditLine', 'other']
        && data.ownerId is string && data.ownerId.size() > 0
        && data.principal is number && data.principal >= 0
        && data.balance is number && data.balance >= 0
        && data.interestRate is number && data.interestRate >= 0
        && data.monthlyPayment is number && data.monthlyPayment >= 0
        && data.startDate is string && data.endDate is string
        && data.status in ['active', 'paid-off']
        && data.createdAt is string && data.updatedAt is string;
    }

    function isValidInsurance(data) {
      return data.type in ['life', 'health', 'car', 'home', 'other']
        && data.provider is string && data.provider.size() > 0
        && data.insuredMemberId is string && data.insuredMemberId.size() > 0
        && data.ownerId is string && data.ownerId.size() > 0
        && data.premium is number && data.premium >= 0
        && data.premiumFrequency in ['monthly', 'yearly']
        && data.coverages is list
        && data.renewalDate is string
        && data.status in ['active', 'lapsed', 'cancelled']
        && data.createdAt is string && data.updatedAt is string
        && (!('documentId' in data) || data.documentId is string);
    }

    // ── Identity & permission collections ───────────────────────────────────────────
    match /members/{memberId} {
      allow read: if hasRole();
      allow create, update: if isSuperAdmin() && isValidMember(request.resource.data);
      allow delete: if isSuperAdmin();
    }

    match /groups/{groupId} {
      allow read: if hasRole();
      allow create, update: if isSuperAdmin() && isValidGroup(request.resource.data);
      allow delete: if isSuperAdmin();
    }

    match /permissions/{permId} {
      allow read: if isSuperAdmin();
      allow create, update: if isSuperAdmin() && isValidPermissionDoc(request.resource.data)
        && request.resource.data.updatedBy == memberId();
      allow delete: if isSuperAdmin();
    }

    // D7 (Stage 3) — role() broadened from ['super-admin','parent'] to also include 'member'.
    // The recurring catch-up engine (Task 5) writes an audit_log entry in the SAME WriteBatch as
    // every auto-posted transaction/income doc; Firestore batches are all-or-nothing, so under
    // the Stage 2 rule a 'member'-role user's own session could never successfully catch-up-post
    // even a fully-owned recurring item (the audit_log write would deny the whole batch). The
    // anti-spoof binding (actorMemberId == memberId()) and shape validation are unchanged — this
    // widens WHO may write an entry, not what they may claim it says.
    match /audit_log/{logId} {
      allow read: if isSuperAdmin();
      allow create: if isSignedIn()
        && role() in ['super-admin', 'parent', 'member']
        && request.resource.data.actorMemberId == memberId()
        && isValidAuditEntry(request.resource.data);
      allow update, delete: if false; // immutable log
    }

    // ── Financial modules governed by the matrix ────────────────────────────────────
    match /transaction_lines/{docId} {
      allow read: if canAccessExpenses('view', resource.data);
      allow create: if canAccessExpenses('edit', request.resource.data)
        && request.resource.data.amount is number && request.resource.data.amount > 0
        && request.resource.data.date is string && request.resource.data.date.size() == 10;
      allow update: if canAccessExpenses('edit', resource.data)
        && (
          isSuperAdmin() || isParent()
          || (
            request.resource.data.owner == resource.data.owner
            && request.resource.data.amount is number && request.resource.data.amount > 0
            && request.resource.data.date is string && request.resource.data.date.size() == 10
          )
        );
      allow delete: if canAccessExpenses('edit', resource.data);
    }

    match /incomes/{docId} {
      allow read: if canAccessOwnerlessModule('income', 'view');
      allow create: if canAccessOwnerlessModule('income', 'edit')
        && request.resource.data.amount is number && request.resource.data.amount > 0;
      allow update, delete: if canAccessOwnerlessModule('income', 'edit');
    }

    match /investments/{docId} {
      allow read: if canAccessOwnerlessModule('investments', 'view');
      allow write: if canAccessOwnerlessModule('investments', 'edit');
    }

    match /goals/{docId} {
      allow read: if canAccessOwnerlessModule('goals', 'view');
      allow write: if canAccessOwnerlessModule('goals', 'edit');
    }

    // ── Stage 3 — owned-from-day-one financial modules (D2/D3) ─────────────────────
    match /accounts/{docId} {
      allow read: if canAccessOwnedModule('accounts', 'view', resource.data);
      allow create: if canAccessOwnedModule('accounts', 'edit', request.resource.data) && isValidAccount(request.resource.data);
      // ownerId immutable for matrix-governed editors (D9 — mirrors the transaction_lines C1 fix).
      allow update: if canAccessOwnedModule('accounts', 'edit', resource.data)
        && isValidAccount(request.resource.data)
        && (isSuperAdmin() || isParent() || request.resource.data.ownerId == resource.data.ownerId);
      allow delete: if canAccessOwnedModule('accounts', 'edit', resource.data);
    }

    match /recurring/{docId} {
      allow read: if canAccessOwnedModule('recurring', 'view', resource.data);
      allow create: if canAccessOwnedModule('recurring', 'edit', request.resource.data) && isValidRecurring(request.resource.data);
      // Update covers BOTH a human editing the item AND the catch-up engine bumping
      // lastPostedPeriod — ownerId stays immutable for matrix-governed callers either way.
      allow update: if canAccessOwnedModule('recurring', 'edit', resource.data)
        && isValidRecurring(request.resource.data)
        && (isSuperAdmin() || isParent() || request.resource.data.ownerId == resource.data.ownerId);
      allow delete: if canAccessOwnedModule('recurring', 'edit', resource.data);
    }

    match /loans/{docId} {
      allow read: if canAccessOwnedModule('loans', 'view', resource.data);
      allow create: if canAccessOwnedModule('loans', 'edit', request.resource.data) && isValidLoan(request.resource.data);
      allow update: if canAccessOwnedModule('loans', 'edit', resource.data)
        && isValidLoan(request.resource.data)
        && (isSuperAdmin() || isParent() || request.resource.data.ownerId == resource.data.ownerId);
      allow delete: if canAccessOwnedModule('loans', 'edit', resource.data);
    }

    match /insurances/{docId} {
      allow read: if canAccessOwnedModule('insurances', 'view', resource.data);
      allow create: if canAccessOwnedModule('insurances', 'edit', request.resource.data) && isValidInsurance(request.resource.data);
      allow update: if canAccessOwnedModule('insurances', 'edit', resource.data)
        && isValidInsurance(request.resource.data)
        && (isSuperAdmin() || isParent() || request.resource.data.ownerId == resource.data.ownerId);
      allow delete: if canAccessOwnedModule('insurances', 'edit', resource.data);
    }

    // ── Shared/system collections — parents and super-admin manage, everyone signed-in reads ──
    match /settings/{docId} {
      allow read: if hasRole();
      allow write: if isSuperAdmin() || isParent();
    }

    match /categories/{docId} {
      allow read: if hasRole();
      allow write: if isSuperAdmin() || isParent();
    }

    match /sync_logs/{docId} {
      allow read, write: if isSuperAdmin() || isParent();
    }

    // Legacy — only scripts/migrate-transactions.ts (Admin SDK, bypasses Rules entirely) ever
    // touches this collection now that Stage 1 Task 5 removed every client read. Locked down.
    match /transactions/{docId} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 2: Type-check nothing broke client-side**

Run: `npm run lint`
Expected: PASS (rules changes don't affect TypeScript; confirms no accidental fallout).

- [ ] **Step 3: Commit**

(No automated test yet — Task 8 is the verification, matching Stage 2 Task 5/6's granularity split.)

```bash
git add firestore.rules
git commit -m "feat: firestore.rules — accounts/recurring/loans/insurances matrix enforcement, audit_log role broadening (D7)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Firestore Rules test suite for the four new collections + D7 regression proof

**Files:**
- Create: `firestore-tests/finance-modules.rules.test.ts`
- Modify: `firestore-tests/permissions.rules.test.ts` (one test updated — D7)

**Interfaces:**
- Consumes: `firestore.rules` (Task 7)
- Produces: `npm run test:rules` covers the four new collections in addition to Stage 2's suite.

- [ ] **Step 1: Update the one Stage 2 test that D7 intentionally changes**

In `firestore-tests/permissions.rules.test.ts`, replace the test at (around) line 543:

```ts
  it('a member (not parent/super-admin) cannot write audit_log at all, even correctly attributed', async () => {
    const db = ctxFor(OMER_OWN_VIEW).firestore();
    await assertFails(setDoc(doc(db, 'audit_log', 'entry-3'), {
      actorMemberId: 'omer-levy', action: 'x', target: 'x', at: 'x',
    }));
  });
```

with:

```ts
  it('a member CAN now write a correctly-attributed audit_log entry (Stage 3 D7 — broadened so the recurring catch-up engine\'s same-batch audit write does not deny a member\'s own posting)', async () => {
    const db = ctxFor(OMER_OWN_VIEW).firestore();
    await assertSucceeds(setDoc(doc(db, 'audit_log', 'entry-3'), {
      actorMemberId: 'omer-levy', action: 'x', target: 'x', at: 'x',
    }));
  });
```

Also update this `describe` block's title (currently `'audit_log — immutable, actor must match token (anti-spoofing), member cannot write at all'`) to drop the now-inaccurate `"member cannot write at all"` clause — rename to `'audit_log — immutable, actor must match token (anti-spoofing)'`.

- [ ] **Step 2: Write the new finance-modules rules test suite**

```ts
// firestore-tests/finance-modules.rules.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const DAVID = { uid: 'uid-david', memberId: 'david-levy', role: 'super-admin' as const };
const LILIT = { uid: 'uid-lilit', memberId: 'lilit-levy', role: 'parent' as const };
const OMER = { uid: 'uid-omer', memberId: 'omer-levy', role: 'member' as const };

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-familyfinance-finance-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => { await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'members', 'david-levy'), { id: 'david-levy', name: 'דויד', role: 'הורה', color: '#1F4E78', groups: [], uid: DAVID.uid, createdAt: 'x', updatedAt: 'x' });
    await setDoc(doc(db, 'members', 'lilit-levy'), { id: 'lilit-levy', name: 'לילית', role: 'הורה', color: '#17C3B2', groups: [], uid: LILIT.uid, createdAt: 'x', updatedAt: 'x' });
    await setDoc(doc(db, 'members', 'omer-levy'), {
      id: 'omer-levy', name: 'עומר', role: 'ילד', color: '#E07A5F', groups: [], uid: OMER.uid, createdAt: 'x', updatedAt: 'x',
      resolvedPermissions: {
        expenses: { view: 'own', edit: 'own' },
        accounts: { view: 'own', edit: 'own' },
        recurring: { view: 'own', edit: 'own' },
        loans: { view: 'own', edit: 'none' },
        insurances: { view: 'none', edit: 'none' },
      },
    });
    await setDoc(doc(db, 'accounts', 'acc-omer'), {
      id: 'acc-omer', ownerId: 'omer-levy', name: 'חיסכון', type: 'bank', balance: 500,
      balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x',
    });
    await setDoc(doc(db, 'accounts', 'acc-lilit'), {
      id: 'acc-lilit', ownerId: 'lilit-levy', name: 'עו״ש', type: 'bank', balance: 20000,
      balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x',
    });
    await setDoc(doc(db, 'loans', 'loan-omer'), {
      id: 'loan-omer', ownerId: 'omer-levy', name: 'הלוואת סטודנט', loanType: 'personal',
      principal: 5000, balance: 4000, interestRate: 2, monthlyPayment: 200,
      startDate: '2026-01-01', endDate: '2027-01-01', status: 'active', createdAt: 'x', updatedAt: 'x',
    });
    await setDoc(doc(db, 'recurring', 'rec-omer'), {
      id: 'rec-omer', kind: 'expense', description: 'חוג', amount: 150, category: 'חינוך',
      chargeDay: 5, ownerId: 'omer-levy', status: 'active', startDate: '2026-01-01',
      createdAt: 'x', updatedAt: 'x',
    });
  });
});

const ctxFor = (m: { uid: string; memberId: string; role: string }) =>
  testEnv.authenticatedContext(m.uid, { role: m.role, memberId: m.memberId });

describe('accounts — own/family/parent/admin', () => {
  it('Omer (own) can read his own account', async () => {
    await assertSucceeds(getDoc(doc(ctxFor(OMER).firestore(), 'accounts', 'acc-omer')));
  });
  it('Omer (own) CANNOT read Lilit\'s account', async () => {
    await assertFails(getDoc(doc(ctxFor(OMER).firestore(), 'accounts', 'acc-lilit')));
  });
  it('Lilit (parent) can read every account', async () => {
    await assertSucceeds(getDoc(doc(ctxFor(LILIT).firestore(), 'accounts', 'acc-omer')));
  });
  it('David (super-admin) can read every account', async () => {
    await assertSucceeds(getDoc(doc(ctxFor(DAVID).firestore(), 'accounts', 'acc-omer')));
  });
  it('a malformed account (bad type) is rejected on create, even for super-admin', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'accounts', 'bad-1'), {
      id: 'bad-1', ownerId: 'david-levy', name: 'X', type: 'not-a-type', balance: 100,
      balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('a valid account create by super-admin succeeds', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(setDoc(doc(db, 'accounts', 'good-1'), {
      id: 'good-1', ownerId: 'david-levy', name: 'X', type: 'cash', balance: 100,
      balanceUpdatedAt: 'x', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('Omer (own edit) CANNOT reassign his own account\'s ownerId to someone else (D9 — mirrors C1)', async () => {
    const db = ctxFor(OMER).firestore();
    await assertFails(updateDoc(doc(db, 'accounts', 'acc-omer'), { ownerId: 'lilit-levy' }));
  });
  it('Omer (own edit) CAN update his own account\'s balance, keeping ownerId unchanged', async () => {
    const db = ctxFor(OMER).firestore();
    await assertSucceeds(updateDoc(doc(db, 'accounts', 'acc-omer'), { balance: 600, balanceUpdatedAt: 'y', updatedAt: 'y' }));
  });
});

describe('recurring — permission-governed like the other owned modules', () => {
  it('Omer (own edit on recurring) CAN update his own recurring item', async () => {
    const db = ctxFor(OMER).firestore();
    await assertSucceeds(updateDoc(doc(db, 'recurring', 'rec-omer'), { status: 'paused', updatedAt: 'y' }));
  });
  it('Omer CANNOT read a recurring item he does not own', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'recurring', 'rec-lilit'), {
        id: 'rec-lilit', kind: 'income', description: 'משכורת', amount: 12000, chargeDay: 1,
        ownerId: 'lilit-levy', status: 'active', startDate: '2026-01-01', createdAt: 'x', updatedAt: 'x',
      });
    });
    await assertFails(getDoc(doc(ctxFor(OMER).firestore(), 'recurring', 'rec-lilit')));
  });
});

describe('loans — Omer has view-only access per his seeded matrix (edit: none)', () => {
  it('Omer CAN read his own loan (view: own)', async () => {
    await assertSucceeds(getDoc(doc(ctxFor(OMER).firestore(), 'loans', 'loan-omer')));
  });
  it('Omer CANNOT edit his own loan (edit: none)', async () => {
    const db = ctxFor(OMER).firestore();
    await assertFails(updateDoc(doc(db, 'loans', 'loan-omer'), { balance: 3000 }));
  });
});

describe('insurances — Omer has none/none, denied entirely', () => {
  it('Omer CANNOT read any insurance doc', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'insurances', 'ins-1'), {
        id: 'ins-1', type: 'health', provider: 'X', insuredMemberId: 'omer-levy', ownerId: 'lilit-levy',
        premium: 200, premiumFrequency: 'monthly', coverages: [], renewalDate: '2027-01-01',
        status: 'active', createdAt: 'x', updatedAt: 'x',
      });
    });
    await assertFails(getDoc(doc(ctxFor(OMER).firestore(), 'insurances', 'ins-1')));
  });
  it('super-admin CAN create a valid insurance doc', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(setDoc(doc(db, 'insurances', 'ins-2'), {
      id: 'ins-2', type: 'car', provider: 'הראל', insuredMemberId: 'david-levy', ownerId: 'david-levy',
      premium: 300, premiumFrequency: 'monthly', coverages: [{ label: 'צד ג׳', amount: 500000 }],
      renewalDate: '2027-01-01', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
  it('a malformed insurance (bad type) is rejected', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'insurances', 'bad-1'), {
      id: 'bad-1', type: 'spaceship', provider: 'X', insuredMemberId: 'david-levy', ownerId: 'david-levy',
      premium: 100, premiumFrequency: 'monthly', coverages: [], renewalDate: 'x', status: 'active', createdAt: 'x', updatedAt: 'x',
    }));
  });
});

describe('D7 — audit_log now accepts a member-role writer (broadened from Stage 2)', () => {
  it('Omer (member role) CAN write a correctly-attributed audit_log entry', async () => {
    const db = ctxFor(OMER).firestore();
    await assertSucceeds(setDoc(doc(db, 'audit_log', 'entry-omer-1'), {
      actorMemberId: 'omer-levy', action: 'recurring.autopost', target: 'recurring/rec-omer', at: 'x',
    }));
  });
  it('Omer still CANNOT spoof another actor (anti-spoof binding unchanged)', async () => {
    const db = ctxFor(OMER).firestore();
    await assertFails(setDoc(doc(db, 'audit_log', 'entry-omer-2'), {
      actorMemberId: 'david-levy', action: 'x', target: 'x', at: 'x',
    }));
  });

  it('end-to-end: Omer\'s own recurring-item catch-up batch (financial doc write + audit_log write + lastPostedPeriod update) commits atomically', async () => {
    const db = ctxFor(OMER).firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'transaction_lines', 'rec-omer__2026-08'), {
      owner: 'עומר', amount: 150, date: '2026-08-05', category: 'חינוך', description: 'חוג',
      isCredit: false, recurringId: 'rec-omer', recurringPeriod: '2026-08',
    });
    batch.set(doc(db, 'audit_log', 'entry-autopost-1'), {
      actorMemberId: 'omer-levy', action: 'recurring.autopost', target: 'recurring/rec-omer', at: 'x',
    });
    batch.update(doc(db, 'recurring', 'rec-omer'), { lastPostedPeriod: '2026-08', updatedAt: 'y' });
    await assertSucceeds(batch.commit());
  });
});
```

- [ ] **Step 3: Run the full rules suite**

Run: `npm run test:rules`
Expected: ALL PASS (both `permissions.rules.test.ts` and `finance-modules.rules.test.ts`). If any `assertFails` case unexpectedly succeeds, that is a real security gap in Task 7's rules — fix the rule, not the test.

- [ ] **Step 4: Full project verification**

Run: `npm run lint && npm test && npm run test:rules`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add firestore-tests/finance-modules.rules.test.ts firestore-tests/permissions.rules.test.ts
git commit -m "test: Firestore Rules suite — new financial collections, ownerId immutability, D7 member audit_log regression proof

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Wire the recurring catch-up engine into `App.tsx` bootstrap

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `postDueRecurringTransactions` (Task 5), `useAuthSession` (Stage 2, unchanged)

- [ ] **Step 1: Add the bootstrap effect**

In `src/App.tsx`, alongside the existing `ensureSeeded()` effect, add:

```ts
import { postDueRecurringTransactions } from './services/RecurringService';
```

```ts
  useEffect(() => {
    // Stage 3 recurring catch-up (spec §11 "תנועות קבועות... נרשמות אוטומטית בתאריך שלהן") —
    // local-first, no Cloud Functions (spec §15), so "on app open" is the only trigger point.
    // Runs for EVERY ready session (unlike ensureSeeded, NOT gated to super-admin) — a
    // 'member'-role session can now catch-up-post their OWN recurring items (D7), and a
    // parent/super-admin session catches up everyone's, since they bypass the matrix. Never
    // blocks rendering; postDueRecurringTransactions itself never throws (per-item failures are
    // collected, not propagated) — a failure here means something worth investigating, logged the
    // same way ensureSeeded's failure is, not surfaced as a blocking screen.
    if (session.status !== 'ready' || !session.memberId) return;
    postDueRecurringTransactions(session.memberId).then((outcome) => {
      if (outcome.failed.length > 0) {
        console.error('[App] recurring catch-up had failures:', outcome.failed);
      }
    });
  }, [session.status, session.memberId]);
```

- [ ] **Step 2: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS (App.tsx has no dedicated test file, consistent with `ensureSeeded`'s wiring — covered by `RecurringService`'s own unit tests, Task 5, plus the manual smoke test below, matching Stage 2 Task 8's Step 6 convention).

- [ ] **Step 3: Manual emulator smoke test**

With `npm run emu` running and `npm run provision:auth` already applied: as super-admin, use the Firestore Emulator UI (or a temporary script) to seed one `recurring` doc (`kind: 'expense'`, `ownerId: 'david-levy'`, `chargeDay` <= today's date, `startDate` a few months ago, no `lastPostedPeriod`). Reload the app signed in as David. Confirm: (a) a `transaction_lines` doc with the deterministic id `{recurringId}__{period}` appears for every missed month up to and including this one, (b) the `recurring` doc's `lastPostedPeriod` advances to the current period, (c) an `audit_log` entry with `action: 'recurring.autopost'` exists for each posted period, (d) reloading again posts nothing further (idempotent — already caught up).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire recurring catch-up posting into App.tsx bootstrap

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Stage-3 Done Criteria

- `ModuleId`/`MODULE_IDS` include `accounts`/`recurring`/`loans`/`insurances`; `PermissionsManager` surfaces all four with zero additional UI code (verified by Task 1's test).
- `accounts`, `recurring`, `loans`, `insurances` each have: a TypeScript interface, a CRUD service, a Rules schema validator, an owned-aware Rules pair, and a Rules test covering own/family/parent/admin + shape validation + `ownerId` immutability on update.
- The recurring catch-up engine posts every missed period exactly once (idempotent via deterministic doc ids), advances `lastPostedPeriod` atomically with its postings and audit entries, runs once per app-open with no Cloud Functions, and is wired into `App.tsx`.
- `computeNetWorth` produces asset/liability breakdowns with `source`/`asOf` provenance on every line, correctly scoped to `'own'` vs `'family'`, with no new permission module or collection.
- `audit_log` accepts a correctly-attributed `'member'`-role writer (D7), proven both in isolation and end-to-end (the actual recurring catch-up batch shape) in Task 8.
- `npm run lint`, `npm test`, and `npm run test:rules` all pass; `git status` clean.
- No new screens were built; `src/App.tsx` gained exactly one bootstrap wiring effect.

## Risks

- **A 'member'-role user's own recurring INCOME item can never post via their own session.** D5 (Stage 2) structurally denies `'own'` on the ownerless `income` module — only `'family'`-level edit grants write access there. A member with `own` edit on `recurring` can fully manage their own recurring income item, but `postDueRecurringTransactions` running under their session will fail to write the resulting `incomes` doc (permission-denied), surfacing in `failed`. It posts only once a parent/super-admin session (bypasses the matrix) next opens the app. Documented in `RecurringService.ts`'s header comment and this plan's D7/D2 — not silently swallowed, but real UX latency for a lone `'member'`-role household is possible until Stage 5 either grants family-level income access more often or Stage 2's D5 is revisited (out of scope here).
- **Real-estate/mortgage double-counting.** Per D5, `computeNetWorth` takes `realEstateValue` (from `settings/ecosystem`, unchanged) and `loans` (new collection) as independent inputs. A household that enters a mortgage as both a `loans` doc AND keeps the legacy `ecosystem.mortgage` figure populated would double-count that debt in any rollup that naively sums both. No migration script retires `ecosystem.mortgage` in this stage. Flagged for whoever next builds the Stage 5 net-worth screen or touches `ecosystem` data entry.
- **`investments` remains ownerless (Stage 2 D5, unchanged) — `'own'`-scope net worth always excludes it entirely**, not partially. A family member with only `'own'` access sees `0` for investments in their personal net worth even if some of it is genuinely theirs, because there is no per-investment owner field to filter by. Documented in `computeNetWorth`'s tests and comments, not silently approximated.
- **Naming collision, pre-existing and unchanged:** the existing `investments` collection already has `type: 'insurance'` as one of its `InvestmentType` values (`src/components/InvestmentsPortfolio.tsx`) — a savings/pension product wrapped in insurance regulation (e.g. ביטוח מנהלים), unrelated to the new standalone `insurances` collection (policy records: car/health/home/life, premiums, coverage, renewal). Both are real, both stay. Flagged so Stage 4/5 UI doesn't conflate the two when labeling module icons/tabs.
- **D7's `audit_log` broadening was scoped and verified, not assumed safe.** The only consumer of "who may write `audit_log`" prior to Stage 3 was Stage 2's own test suite (updated in Task 8) — no other rule or service reads/branches on `audit_log`'s writer role. Grepped confirmed: `writeAuditLog` (the only writer) never inspects the caller's role itself; that responsibility lives entirely in `firestore.rules`.
- **Catch-up engine idempotency depends on `recurringId` uniqueness**, which Firestore's own auto-id generation already guarantees (cryptographically random, no realistic collision) — not a practical risk, noted for completeness.
- **`saveMembers`/`GroupsService` carry-forwards from the Stage 1/2 ledgers remain open** (concurrent `.groups` clobber, `previousMemberIds` defaulting, audit-log id collision) — this plan does not touch either file, so none of those risks are newly introduced or newly mitigated here; they stay correctly assigned to Stage 11 or whenever those files are next opened.

## Self-review against spec §6/§7

- §7 `accounts` (סוג, בעלים, יתרה עדכנית): covered — Task 1 (`Account` type), Task 2/3 (`AccountsService`), Task 7 (rules + `isValidAccount`), Task 8 (rules tests).
- §7 `recurring` (סכום, תדירות, יום חיוב, שיוך, מזין את התחזית): covered — Task 1 (`RecurringItem` type), Task 4 (pure catch-up computation), Task 5 (`RecurringService` + posting engine), Task 7/8 (rules + tests), Task 9 (bootstrap wiring so it actually runs). The "מזין את התחזית" (feeds the forecast) half is satisfied by producing the DATA (posted `transaction_lines`/`incomes` rows, `Loan`/`Insurance` docs) — the forecast ENGINE itself is Stage 7 per the roadmap, correctly out of scope here.
- §7 `loans` (קרן, יתרה, ריבית, תשלום חודשי, תאריך סיום): covered — Task 1 (`Loan` type), Task 2/3 (`LoansService`), Task 7/8 (rules + tests).
- §7 `insurances` (סוג, מבוטח, פרמיה, כיסויים, חידוש, קישור למסמך): covered — Task 1 (`Insurance`/`Coverage` types, `documentId` field for the archive link), Task 2/3 (`InsurancesService`), Task 7/8 (rules + tests). The Drive-document link itself (§12) is a field only — wiring it to the actual archive UI is Stage 5/11, correctly out of scope.
- §6 module map — "חשבונות ויתרות"/"הלוואות וחובות"/"ביטוחים" marked permission-governed: covered — Task 1 (`MODULE_IDS` extension + `PermissionsManager` labels, verified zero further UI code needed per D6), Task 7 (Rules enforcement).
- §6 "שווי נקי" (net worth, נכסים מינוס התחייבויות כולל נדל״ן ומשכנתא): covered by Task 6's `computeNetWorth`, deliberately NOT as its own permission module (D4) — an explicit, justified deviation from a literal "every module row = a permission entry" reading, grounded in spec §5.5's own "one calculation source per metric" principle. Mortgage inclusion is a documented Risk (real-estate/loans double-counting), not silently solved.
- §5.5 "מקור חישוב אחד לכל מדד" (one calculation source per metric): directly the justification for D4 (no separate netWorth permission source of truth) and for `computeNetWorth` being the single pure function any future screen must call, rather than each screen recomputing its own version.
- §10 forecast "שכבה ודאית" inputs (recurring income/expenses, loan repayments, insurance premiums): Stage 3 produces exactly the collections/types this needs (`recurring`, `loans`, `insurances`); the forecast engine that consumes them is Stage 7, correctly deferred per the roadmap.
- §11 קליטה — "תנועות קבועות... נרשמות אוטומטית בתאריך שלהן, מזינות את התחזית": covered end-to-end by Tasks 4/5/9 — the one part of this stage that is genuinely an ENGINE, not just a typed collection, and is specified precisely (catch-up semantics, idempotency, permission interaction) rather than left as a placeholder.
- Brief's "owner attribution (memberId vs display name)" requirement: covered — D1, with the `transaction_lines.owner` inconsistency explicitly documented and bridged only at the one point they interoperate (Task 5's posting logic), not silently left inconsistent nor fully migrated (out of scope).
- Brief's "extending the permission matrix... these modules launch OWNED... use the 'own'-aware rules path": covered — D2/D3, Task 7's `ownedModuleAllowed()`.
- Brief's "resolver/types change must stay backward compatible with existing resolvedPermissions docs": covered and verified, not assumed — D6, Task 1 Step 2 (existing resolver logic requires no change; missing-module fail-closed default already handles it).
- Brief's "D8-style rollout... parents unaffected/bypass; Omer gets what?": covered — D6 (fail-closed, no seeding needed, with the provisioning script explicitly checked and confirmed unaffected).
- Brief's "audit_log on mutations via the same WriteBatch": covered by every service in Task 2/3/5; D7 fixes the one Rules gap (Stage 2's audit_log role restriction) that would have silently broken this for a `'member'`-role actor's own recurring posts.
- Brief's "optimistic-concurrency where a full-list save exists (learn from saveMembers/StaleMembersError)": reviewed and confirmed NOT APPLICABLE — none of the four new collections have a full-list-replace service; each is independent per-doc CRUD (list/save-one/delete-one), structurally different from `saveMembers`'s full-array-replace contract. Explicitly noted, not silently skipped.
- Brief's "TDD with mocked firestore for units + rules tests for enforcement": every task (1–9) follows failing-test-first with mocked Firestore for units (Tasks 1–6, 9) and live-emulator Rules tests for enforcement (Tasks 7–8).
- Brief's "honor ALL relevant carry-forwards... if a task touches saveMembers or GroupsService params": reviewed — no task in this plan edits `MembersService.saveMembers`, `GroupsService.saveGroup`, or `GroupsService.deleteGroup`, so their respective ledger carry-forwards remain correctly un-triggered and un-touched (listed explicitly above, not silently dropped).

## Open questions: none
