# FamilyFinance v2 — Stage 2: Identity & Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace anonymous-only auth with real per-member accounts, establish role as a server-verified fact (Firebase custom claims — never a client-editable document), build the per-member/per-group permission matrix (module → level × action) with per-person exceptions, and enforce all of it in Firestore Security Rules with a rules test suite — so that bypassing the UI cannot read or write anything a member wasn't granted.

**Architecture:** Stage 1 left `members` as a real collection but with no auth attached and no shape validation, and `firestore.rules` gating everything on `request.auth != null` only (any signed-in — including anonymous — user can read/write almost anything). This stage:
1. Introduces a **role** that lives only in Firebase Auth custom claims (`{ role, memberId }`), set by a trusted local Admin-SDK script — never derived from a Firestore document a client can edit.
2. Introduces **groups** (`groups` collection) and a **permission matrix** (`permissions` collection: per-group or per-member, module → `{view, edit}` level).
3. Because Firestore Security Rules cannot loop over an array (a member's `groups` list) to combine multiple group grants, the matrix is **resolved in tested TypeScript** (`resolveEffectivePermissions`) and the flattened result is materialized onto `members/{id}.resolvedPermissions` by `PermissionsService`, in the same batch as any write to `groups`/`permissions`. Firestore Rules then do a single cheap lookup — no loops, no cross-collection combination logic in the rules language. This is the load-bearing architectural decision of this stage; see "Design decisions" below.
4. Rewrites `firestore.rules` to enforce the matrix per-collection, add document-shape validation (closing the Stage 1 ledger item: `members` had none), and lock down collections nothing in the app reads anymore.
5. Adds a `@firebase/rules-unit-testing` suite that runs against the real rules file with fabricated auth tokens — no need to actually sign in through the Auth emulator for these tests.
6. Fixes `scripts/migrate-transactions.ts` and `scripts/seed-members.ts`, which currently sign in **anonymously** to satisfy the old permissive rules — the new rules key off custom claims an anonymous user will never have, so both scripts move to the Firebase **Admin SDK** (which bypasses Security Rules entirely, same trust level these scripts already operate at).
7. Ships a real login screen (email+password against the Auth emulator) and a minimal super-admin-only screen to manage groups and the permission matrix, so the feature is usable end-to-end, not just enforced at the data layer.

**Tech Stack additions:** `firebase-admin` (devDependency — local Admin SDK scripts only, never imported by client code), `@firebase/rules-unit-testing` (devDependency — rules test suite).

**Spec:** `docs/superpowers/specs/2026-08-14-family-finance-v2-design.md` §4 (roles, groups, 20 members), §7 (`members`, `groups`, `permissions`, `audit_log`), §14 (security layers 1–2).

**Builds on:** `src/services/MembersService.ts`, `src/utils/seedFromBudgetConfig.ts`, `firestore.rules`, `src/services/firebase.ts`, `src/App.tsx` (all Stage 1). `Member.role` (`'הורה' | 'ילד'`) is a Stage-1 **display/family-relationship** field — see Design decision D1 for why it is explicitly NOT the permission role.

## Design decisions (resolved, not deferred)

- **D1 — two different "role" concepts stay separate.** `Member.role: 'הורה' | 'ילד'` (Stage 1) is a family-relationship/display label, read from a Firestore document, and MUST NOT be used for any authorization decision. The **permission role** is a new, independent value — `'super-admin' | 'parent' | 'member'` — that exists ONLY as a Firebase Auth custom claim (`request.auth.token.role` in Rules, `tokenResult.claims.role` in the client). A parent member (`Member.role === 'הורה'`) is provisioned with custom claim `role: 'parent'`; a child member (`Member.role === 'ילד'`) is provisioned with `role: 'member'`; exactly one member (David) additionally gets `role: 'super-admin'`. The two fields are allowed to diverge later (e.g., an adult child could be re-provisioned as `'parent'` without changing `Member.role`) — that divergence is intentional, per spec §14.1: "תפקיד המשתמש נקבע ב-Custom Claims בצד השרת — לא במסמך שהמשתמש יכול לערוך."
- **D2 — cross-group combination happens in TypeScript, not in Rules.** Firestore Rules have no loop construct, so "take the most permissive level across all of a member's groups" cannot be expressed rule-side for an arbitrary-length `groups` array. `resolveEffectivePermissions` (pure, unit-tested) computes the combined result; `PermissionsService` writes it to `members/{id}.resolvedPermissions` in the same batch as the triggering `groups`/`permissions` write, so it can never drift from an app-driven change. Rules read only that one flattened field.
- **D3 — multi-group combination rule: most permissive wins per action.** If a member is in two groups with different levels for the same module+action, the higher level wins (`none < own < family`), independently for `view` and `edit`. Rationale: group membership is admin-curated and additive by nature (spec: groups exist partly *to* grant access in bulk); a member being in two groups should never be more restricted than being in either alone.
- **D4 — per-person exception overrides per module, not globally.** A member's own `permissions` doc (`scope: 'member'`) only overrides the modules it explicitly lists; any module it does not mention falls back to the group-derived value. This matches spec §4 "חריג פר-אדם גובר על קבוצה" literally — an exception, not a wholesale replacement.
- **D5 — `'own'` is meaningless (and denied) on collections with no owner field.** Today only `transaction_lines` carries an `owner` field (existing convention, string = the member's Hebrew display name, set by the import/entry pipeline). `incomes`, `investments`, `goals` have no per-person attribution yet (Stage 3 adds `accounts`/`loans`/`insurances` with owner fields from day one). For these three ownerless collections in Stage 2, a `'own'` grant is treated as insufficient — only `'family'` grants access. Silently treating `'own'` as `'family'` on an ownerless collection would be a privilege escalation; treating it as denied is the fail-closed choice.
- **D6 — bootstrap: the very first super-admin is established by a trusted local script, not the app.** There is no chicken-and-egg problem because provisioning never goes through Firestore Rules at all: `scripts/provision-auth-users.ts` uses the Admin SDK (which bypasses Rules) run directly against the local Auth+Firestore emulators by whoever has shell access to David's machine — the same trust boundary Stage 1's `migrate-transactions.ts`/`seed-members.ts` already operate at. The super-admin member id is an explicit constant (`SUPER_ADMIN_MEMBER_ID = 'david-levy'`, matching `DEFAULT_MEMBER_SEED`), not inferred from any data.
- **D7 — linking a member to an auth user is admin-driven, not self-service, in Stage 2.** `provision-auth-users.ts` creates one Auth-emulator user per `members` doc (email `{memberId}@familyfinance.local`, a printed local dev password) and writes `members/{id}.uid` directly via the Admin SDK. A self-service "claim your account" flow is out of scope here (email/Google sign-in and self-linking are cloud-stage polish, not blocking local identity/permissions).
- **D8 — default matrix on rollout is permissive-by-default for existing members, deny-by-default for new ones.** `resolveEffectivePermissions` itself defaults an unmentioned module to `none`/`none` (fail-closed — tested explicitly). But `provision-auth-users.ts`, when it first provisions today's three real members, additionally seeds every existing `'ילד'` member (Omer) with an explicit `permissions` exception doc granting `family`/`view`, `none`/`edit` on all four Stage-2 modules — so Stage 2's rollout does not regress Omer's already-working Dashboard access on day one. Tightening it is one edit in the new matrix screen (Task 8). This is a provisioning-time choice, not a change to the rule engine's fail-closed default.
- **D9 — `permissions` collection is super-admin-only for both read and write.** Nothing else needs to read raw matrix docs: Rules consult `members/{id}.resolvedPermissions`, and a member reading their own resolved permissions is just reading their own (already broadly-readable) `members` doc. Restricting `permissions` itself avoids exposing the whole family's matrix to every signed-in user.

## Global Constraints

- All work on branch `familyfinance-v2`. Never commit to `main`.
- UI language Hebrew, RTL; dates DD/MM/YYYY; amounts always ₪-labeled.
- TypeScript strict; `npm run lint` (tsc --noEmit) and `npm test` must pass before every commit.
- A failed read renders as an error, never as an empty state — this now also applies to auth/claims resolution: a signed-in user with no claims must render an explicit "not provisioned" screen, never a silent anonymous/guest fallback.
- No hardcoded values beyond named constants documented as intentional (`SUPER_ADMIN_MEMBER_ID`, module id lists, emulator ports already established in Stage 1).
- Emulator project id remains exactly `demo-familyfinance`.
- `firebase-admin` and any script importing it must never be imported from `src/` (client bundle) — Admin SDK credentials/behavior are for local Node scripts only. Enforced by convention + `grep` check in Task 4.
- Rules tests (Task 6) require the Firestore emulator; they use `@firebase/rules-unit-testing`, not the app's Firebase client SDK, and do not require the Auth emulator (custom claims are fabricated directly via `authenticatedContext`).
- Frequent commits; each task ends with an independently testable, green deliverable.

---

### Task 1: Shared permission types + pure effective-permissions resolver

The foundation every later task consumes. Pure TypeScript, no Firebase — the cross-group combination logic (Design decision D2/D3/D4) lives and is fully tested here, so Firestore Rules never need to.

**Files:**
- Create: `src/types/permissions.ts`, `src/utils/resolvePermissions.ts`
- Test: `src/__tests__/resolvePermissions.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
```ts
// src/types/permissions.ts
export type PermissionRole = 'super-admin' | 'parent' | 'member';
export type PermissionLevel = 'none' | 'own' | 'family';
export type PermissionAction = 'view' | 'edit';

// Modules with a real Firestore collection wired to the matrix as of Stage 2.
// Stage 3 extends this union when accounts/loans/insurances collections land.
export type ModuleId = 'expenses' | 'income' | 'investments' | 'goals';
export const MODULE_IDS: readonly ModuleId[] = ['expenses', 'income', 'investments', 'goals'] as const;

// Modules with NO per-person owner field yet (Design decision D5) — 'own' cannot be
// enforced on these; only 'family' grants access until Stage 3 adds ownership.
export const OWNERLESS_MODULES: readonly ModuleId[] = ['income', 'investments', 'goals'] as const;

export interface ModulePermission {
  view: PermissionLevel;
  edit: PermissionLevel;
}
export type ModulePermissionMap = Partial<Record<ModuleId, ModulePermission>>;

export interface Group {
  id: string;
  name: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type PermissionScope = 'group' | 'member';

export interface PermissionDoc {
  id: string;            // `group__${targetId}` | `member__${targetId}`
  scope: PermissionScope;
  targetId: string;      // groupId or memberId
  modules: ModulePermissionMap;
  updatedAt: string;
  updatedBy: string;     // memberId of the super-admin who wrote it
}

export const permissionDocId = (scope: PermissionScope, targetId: string): string =>
  `${scope}__${targetId}`;
```
```ts
// src/utils/resolvePermissions.ts
export function resolveEffectivePermissions(
  memberGroupIds: string[],
  memberExceptionDoc: PermissionDoc | null,
  groupPermissionDocsById: Record<string, PermissionDoc | undefined>
): ModulePermissionMap;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/resolvePermissions.test.ts
import { describe, expect, it } from 'vitest';
import { resolveEffectivePermissions } from '../utils/resolvePermissions';
import type { PermissionDoc } from '../types/permissions';

const groupDoc = (targetId: string, modules: PermissionDoc['modules']): PermissionDoc => ({
  id: `group__${targetId}`,
  scope: 'group',
  targetId,
  modules,
  updatedAt: '2026-08-15T00:00:00.000Z',
  updatedBy: 'david-levy',
});

const memberDoc = (targetId: string, modules: PermissionDoc['modules']): PermissionDoc => ({
  id: `member__${targetId}`,
  scope: 'member',
  targetId,
  modules,
  updatedAt: '2026-08-15T00:00:00.000Z',
  updatedBy: 'david-levy',
});

describe('resolveEffectivePermissions', () => {
  it('returns {} when the member is in no groups and has no exception', () => {
    expect(resolveEffectivePermissions([], null, {})).toEqual({});
  });

  it('returns the single group grant when the member is in one group', () => {
    const result = resolveEffectivePermissions(
      ['kids'],
      null,
      { kids: groupDoc('kids', { expenses: { view: 'own', edit: 'none' } }) }
    );
    expect(result).toEqual({ expenses: { view: 'own', edit: 'none' } });
  });

  it('combines two groups by taking the most permissive level PER ACTION independently', () => {
    const result = resolveEffectivePermissions(
      ['kids', 'teens'],
      null,
      {
        kids: groupDoc('kids', { expenses: { view: 'own', edit: 'none' } }),
        teens: groupDoc('teens', { expenses: { view: 'family', edit: 'own' } }),
      }
    );
    // view: family beats own; edit: own beats none — independently, not "pick one group's whole entry"
    expect(result).toEqual({ expenses: { view: 'family', edit: 'own' } });
  });

  it('is order-independent — the result does not depend on which group is listed first', () => {
    const docs = {
      kids: groupDoc('kids', { goals: { view: 'family', edit: 'none' } }),
      teens: groupDoc('teens', { goals: { view: 'own', edit: 'family' } }),
    };
    const a = resolveEffectivePermissions(['kids', 'teens'], null, docs);
    const b = resolveEffectivePermissions(['teens', 'kids'], null, docs);
    expect(a).toEqual(b);
    expect(a).toEqual({ goals: { view: 'family', edit: 'family' } });
  });

  it('ignores a groupId with no matching permission doc (group has no matrix entry yet)', () => {
    const result = resolveEffectivePermissions(['no-doc-group'], null, {});
    expect(result).toEqual({});
  });

  it('a per-member exception overrides the group value for the modules it mentions', () => {
    const result = resolveEffectivePermissions(
      ['kids'],
      memberDoc('omer', { expenses: { view: 'family', edit: 'family' } }),
      { kids: groupDoc('kids', { expenses: { view: 'own', edit: 'none' } }) }
    );
    expect(result).toEqual({ expenses: { view: 'family', edit: 'family' } });
  });

  it('a per-member exception leaves modules it does NOT mention at the group-derived value', () => {
    const result = resolveEffectivePermissions(
      ['kids'],
      memberDoc('omer', { goals: { view: 'family', edit: 'family' } }), // only mentions goals
      { kids: groupDoc('kids', { expenses: { view: 'own', edit: 'none' } }) } // group only mentions expenses
    );
    expect(result).toEqual({
      expenses: { view: 'own', edit: 'none' },   // untouched, from the group
      goals: { view: 'family', edit: 'family' }, // from the exception
    });
  });

  it('an exception with no groups at all still applies on its own', () => {
    const result = resolveEffectivePermissions(
      [],
      memberDoc('solo', { investments: { view: 'family', edit: 'none' } }),
      {}
    );
    expect(result).toEqual({ investments: { view: 'family', edit: 'none' } });
  });

  it('"none" beats nothing but loses to "own" and "family" when combining groups', () => {
    const result = resolveEffectivePermissions(
      ['a', 'b'],
      null,
      {
        a: groupDoc('a', { income: { view: 'none', edit: 'none' } }),
        b: groupDoc('b', { income: { view: 'own', edit: 'none' } }),
      }
    );
    expect(result.income).toEqual({ view: 'own', edit: 'none' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/resolvePermissions.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the types file**

Write `src/types/permissions.ts` exactly as specified in Interfaces above (drop the `never`-branch guard comment if TypeScript flags it as unused complexity — replace `ModulePermission.edit` with a plain `PermissionLevel` field; the guard was illustrative, the real field is simply `edit: PermissionLevel`).

```ts
// src/types/permissions.ts
export type PermissionRole = 'super-admin' | 'parent' | 'member';
export type PermissionLevel = 'none' | 'own' | 'family';
export type PermissionAction = 'view' | 'edit';

export type ModuleId = 'expenses' | 'income' | 'investments' | 'goals';
export const MODULE_IDS: readonly ModuleId[] = ['expenses', 'income', 'investments', 'goals'] as const;
export const OWNERLESS_MODULES: readonly ModuleId[] = ['income', 'investments', 'goals'] as const;

export interface ModulePermission {
  view: PermissionLevel;
  edit: PermissionLevel;
}
export type ModulePermissionMap = Partial<Record<ModuleId, ModulePermission>>;

export interface Group {
  id: string;
  name: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type PermissionScope = 'group' | 'member';

export interface PermissionDoc {
  id: string;
  scope: PermissionScope;
  targetId: string;
  modules: ModulePermissionMap;
  updatedAt: string;
  updatedBy: string;
}

export const permissionDocId = (scope: PermissionScope, targetId: string): string =>
  `${scope}__${targetId}`;
```

- [ ] **Step 4: Implement the resolver**

```ts
// src/utils/resolvePermissions.ts
import type { ModulePermissionMap, PermissionDoc, PermissionLevel } from '../types/permissions';

const LEVEL_RANK: Record<PermissionLevel, number> = { none: 0, own: 1, family: 2 };
const higherLevel = (a: PermissionLevel, b: PermissionLevel): PermissionLevel =>
  LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;

export function resolveEffectivePermissions(
  memberGroupIds: string[],
  memberExceptionDoc: PermissionDoc | null,
  groupPermissionDocsById: Record<string, PermissionDoc | undefined>
): ModulePermissionMap {
  const combined: ModulePermissionMap = {};

  // Combine every group the member belongs to — most permissive per action wins (D3).
  for (const groupId of memberGroupIds) {
    const groupDoc = groupPermissionDocsById[groupId];
    if (!groupDoc) continue;
    for (const [moduleId, perm] of Object.entries(groupDoc.modules)) {
      if (!perm) continue;
      const existing = combined[moduleId as keyof ModulePermissionMap];
      combined[moduleId as keyof ModulePermissionMap] = existing
        ? { view: higherLevel(existing.view, perm.view), edit: higherLevel(existing.edit, perm.edit) }
        : { view: perm.view, edit: perm.edit };
    }
  }

  // Per-member exception overrides only the modules it mentions (D4) — never a wholesale replace.
  if (memberExceptionDoc) {
    for (const [moduleId, perm] of Object.entries(memberExceptionDoc.modules)) {
      if (!perm) continue;
      combined[moduleId as keyof ModulePermissionMap] = { view: perm.view, edit: perm.edit };
    }
  }

  return combined;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run` (full suite)
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/permissions.ts src/utils/resolvePermissions.ts src/__tests__/resolvePermissions.test.ts
git commit -m "feat: permission types + pure effective-permissions resolver (multi-group combine, per-person exception)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Extend `Member` with `uid` + `resolvedPermissions`; `getMember(id)`

**Files:**
- Modify: `src/utils/seedFromBudgetConfig.ts`, `src/services/MembersService.ts`
- Modify (tests): `src/__tests__/MembersService.test.ts`

**Interfaces:**
- Consumes: `ModulePermissionMap` from Task 1
- Produces:
```ts
export interface Member {
  id: string;
  name: string;
  role: 'הורה' | 'ילד';
  color: string;
  groups: string[];
  idNumber?: string;
  uid?: string;                             // NEW — Auth uid once linked (Design decision D7)
  resolvedPermissions?: ModulePermissionMap; // NEW — materialized by PermissionsService (D2)
  createdAt: string;
  updatedAt: string;
}
export async function getMember(id: string): Promise<Member | null>; // NEW
```

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/MembersService.test.ts` (new `describe` block; the existing `vi.mock('firebase/firestore', ...)` factory needs a `getDoc`-backed single-doc read — `mockGetDoc` already exists in the file for `ensureSeeded`, reuse it):

```ts
describe('getMember', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the member doc when it exists', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ id: 'm1', name: 'דויד', role: 'הורה', color: '#111111', groups: [], uid: 'auth-uid-1', createdAt: 'x', updatedAt: 'x' }),
    });
    const member = await getMember('m1');
    expect(member).toMatchObject({ id: 'm1', uid: 'auth-uid-1' });
  });

  it('returns null when the member does not exist (not an error)', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    const member = await getMember('missing');
    expect(member).toBeNull();
  });

  it('propagates a read failure as a rejection', async () => {
    mockGetDoc.mockRejectedValueOnce(new Error('emulator down'));
    await expect(getMember('m1')).rejects.toThrow('emulator down');
  });
});
```

Also extend the existing `seedFromBudgetConfig` "converts the legacy array" test's `toMatchObject` assertion is unaffected (uid/resolvedPermissions are optional, absent by default) — no change needed there; add one new assertion to the existing first test:

```ts
    expect(members[0].uid).toBeUndefined();
    expect(members[0].resolvedPermissions).toBeUndefined();
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/MembersService.test.ts`
Expected: FAIL — `getMember` not exported.

- [ ] **Step 3: Extend the Member type**

In `src/utils/seedFromBudgetConfig.ts`, add the two optional fields to the `Member` interface:

```ts
export interface Member {
  id: string;
  name: string;
  role: 'הורה' | 'ילד';
  color: string;
  groups: string[];
  idNumber?: string;
  uid?: string;
  resolvedPermissions?: ModulePermissionMap;
  createdAt: string;
  updatedAt: string;
}
```

Add `import type { ModulePermissionMap } from '../types/permissions';` at the top. `seedFromBudgetConfig` itself needs no logic change — it never sets `uid`/`resolvedPermissions`, which is correct (a freshly seeded member has neither yet).

- [ ] **Step 4: Implement `getMember`**

In `src/services/MembersService.ts`, add:

```ts
/**
 * Reads a single member document by id. Returns `null` when the doc does not exist (a normal,
 * expected outcome — not an error). Like `listMembers`, does not catch/swallow a query failure.
 */
export async function getMember(id: string): Promise<Member | null> {
  const snap = await getDoc(doc(db, MEMBERS_COLLECTION, id));
  return snap.exists() ? (snap.data() as Member) : null;
}
```

- [ ] **Step 5: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/seedFromBudgetConfig.ts src/services/MembersService.ts src/__tests__/MembersService.test.ts
git commit -m "feat: Member.uid + Member.resolvedPermissions fields, MembersService.getMember

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `GroupsService` + `PermissionsService` — matrix CRUD, resolution, audit log

**Files:**
- Create: `src/services/GroupsService.ts`, `src/services/PermissionsService.ts`, `src/utils/auditLog.ts`
- Test: `src/__tests__/GroupsService.test.ts`, `src/__tests__/PermissionsService.test.ts`

**Interfaces:**
- Consumes: `resolveEffectivePermissions` (Task 1), `Member`/`getMember`/`MEMBERS_COLLECTION`-equivalent access (Task 2)
- Produces:
```ts
// src/utils/auditLog.ts
export interface AuditEntry {
  actorMemberId: string;
  action: string;       // e.g. 'permissions.update', 'group.create', 'member.delete'
  target: string;        // e.g. 'permissions/member__omer-levy'
  at: string;             // ISO
  details?: Record<string, unknown>;
}
export function writeAuditLog(batch: WriteBatch, entry: Omit<AuditEntry, 'at'>): void; // adds to an existing batch, does not commit

// src/services/GroupsService.ts
export async function listGroups(): Promise<Group[]>;
export async function saveGroup(group: Pick<Group, 'id' | 'name' | 'memberIds'>, actorMemberId: string): Promise<void>;
export async function deleteGroup(groupId: string, actorMemberId: string): Promise<void>;

// src/services/PermissionsService.ts
export async function listPermissionDocs(): Promise<PermissionDoc[]>;
export async function saveModulePermissions(
  scope: PermissionScope, targetId: string, modules: ModulePermissionMap, actorMemberId: string
): Promise<void>;
export async function recomputeResolvedPermissions(memberId: string): Promise<void>;
export async function recomputeAllResolvedPermissions(): Promise<void>; // repair/drift-recovery utility, Risks section
```

- [ ] **Step 1: Write the failing test for `writeAuditLog` + `GroupsService`**

```ts
// src/__tests__/GroupsService.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDocs, mockBatchSet, mockBatchDelete, mockBatchCommit } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockBatchSet: vi.fn(),
  mockBatchDelete: vi.fn(),
  mockBatchCommit: vi.fn(async () => undefined),
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => `col:${name}`),
  doc: vi.fn((_db, ...segments: string[]) => `doc:${segments.join('/')}`),
  getDocs: mockGetDocs,
  writeBatch: vi.fn(() => ({ set: mockBatchSet, delete: mockBatchDelete, commit: mockBatchCommit })),
}));

import { deleteGroup, listGroups, saveGroup } from '../services/GroupsService';

describe('GroupsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listGroups reads the groups collection', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ id: 'kids', name: 'הילדים', memberIds: ['omer-levy'], createdAt: 'x', updatedAt: 'x' }) }],
    });
    const groups = await listGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('הילדים');
  });

  it('listGroups propagates a read failure', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('down'));
    await expect(listGroups()).rejects.toThrow('down');
  });

  it('saveGroup writes the group doc AND an audit log entry in the same batch', async () => {
    await saveGroup({ id: 'kids', name: 'הילדים', memberIds: ['omer-levy'] }, 'david-levy');
    expect(mockBatchSet).toHaveBeenCalledWith('doc:groups/kids', expect.objectContaining({ id: 'kids', name: 'הילדים' }));
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toMatchObject({ actorMemberId: 'david-levy', action: 'group.save', target: 'groups/kids' });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('deleteGroup deletes the group AND writes an audit entry, in one batch', async () => {
    await deleteGroup('kids', 'david-levy');
    expect(mockBatchDelete).toHaveBeenCalledWith('doc:groups/kids');
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ actorMemberId: 'david-levy', action: 'group.delete', target: 'groups/kids' });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement `auditLog.ts` and `GroupsService.ts`**

```ts
// src/utils/auditLog.ts
import { doc, type WriteBatch } from 'firebase/firestore';
import { db } from '../services/firebase';

export interface AuditEntry {
  actorMemberId: string;
  action: string;
  target: string;
  at: string;
  details?: Record<string, unknown>;
}

let auditIdCounter = 0;

/** Adds an immutable audit_log entry to an already-open batch. Caller commits the batch. */
export function writeAuditLog(batch: WriteBatch, entry: Omit<AuditEntry, 'at'>): void {
  auditIdCounter += 1;
  const id = `${Date.now()}-${auditIdCounter}`;
  batch.set(doc(db, 'audit_log', id), { ...entry, at: new Date().toISOString() });
}
```

```ts
// src/services/GroupsService.ts
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import type { Group } from '../types/permissions';
import { writeAuditLog } from '../utils/auditLog';

const GROUPS_COLLECTION = 'groups';

export async function listGroups(): Promise<Group[]> {
  const snap = await getDocs(collection(db, GROUPS_COLLECTION));
  return snap.docs.map((d) => d.data() as Group);
}

export async function saveGroup(
  group: Pick<Group, 'id' | 'name' | 'memberIds'>,
  actorMemberId: string
): Promise<void> {
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  batch.set(doc(db, GROUPS_COLLECTION, group.id), {
    id: group.id,
    name: group.name,
    memberIds: group.memberIds,
    createdAt: now, // acceptable simplification for Stage 2: overwritten on every save; Stage 4 UI
                     // can add a fetch-then-merge if createdAt stability becomes user-visible.
    updatedAt: now,
  });
  writeAuditLog(batch, { actorMemberId, action: 'group.save', target: `groups/${group.id}` });
  await batch.commit();
}

export async function deleteGroup(groupId: string, actorMemberId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, GROUPS_COLLECTION, groupId));
  writeAuditLog(batch, { actorMemberId, action: 'group.delete', target: `groups/${groupId}` });
  await batch.commit();
}
```

Run: `npx vitest run src/__tests__/GroupsService.test.ts` → PASS.

- [ ] **Step 3: Write the failing test for `PermissionsService`**

```ts
// src/__tests__/PermissionsService.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDocs, mockGetDoc, mockBatchSet, mockBatchCommit } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockGetDoc: vi.fn(),
  mockBatchSet: vi.fn(),
  mockBatchCommit: vi.fn(async () => undefined),
}));

vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name: string) => `col:${name}`),
  doc: vi.fn((_db, ...segments: string[]) => `doc:${segments.join('/')}`),
  getDocs: mockGetDocs,
  getDoc: mockGetDoc,
  writeBatch: vi.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit })),
}));

import {
  listPermissionDocs,
  recomputeResolvedPermissions,
  saveModulePermissions,
} from '../services/PermissionsService';

describe('PermissionsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listPermissionDocs reads the permissions collection', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ id: 'group__kids', scope: 'group', targetId: 'kids', modules: {}, updatedAt: 'x', updatedBy: 'david-levy' }) }],
    });
    const docs = await listPermissionDocs();
    expect(docs).toHaveLength(1);
  });

  it('saveModulePermissions writes the matrix doc with a deterministic id and an audit entry', async () => {
    await saveModulePermissions('group', 'kids', { expenses: { view: 'own', edit: 'none' } }, 'david-levy');
    expect(mockBatchSet).toHaveBeenCalledWith(
      'doc:permissions/group__kids',
      expect.objectContaining({ scope: 'group', targetId: 'kids', modules: { expenses: { view: 'own', edit: 'none' } } })
    );
    const auditCall = mockBatchSet.mock.calls.find((c) => String(c[0]).startsWith('doc:audit_log/'));
    expect(auditCall![1]).toMatchObject({ actorMemberId: 'david-levy', action: 'permissions.update', target: 'permissions/group__kids' });
  });

  it('recomputeResolvedPermissions reads the member, its groups, its exception doc, resolves, and writes resolvedPermissions', async () => {
    // 1st getDoc: the member doc
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ id: 'omer-levy', name: 'עומר', role: 'ילד', color: '#111', groups: ['kids'], createdAt: 'x', updatedAt: 'x' }),
    });
    // getDocs: all permission docs (service filters client-side to what's relevant)
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        { data: () => ({ id: 'group__kids', scope: 'group', targetId: 'kids', modules: { expenses: { view: 'own', edit: 'none' } }, updatedAt: 'x', updatedBy: 'david-levy' }) },
      ],
    });

    await recomputeResolvedPermissions('omer-levy');

    expect(mockBatchSet).toHaveBeenCalledWith(
      'doc:members/omer-levy',
      { resolvedPermissions: { expenses: { view: 'own', edit: 'none' } } },
      { merge: true }
    );
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('recomputeResolvedPermissions writes {} when the member has no groups and no exception', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ id: 'lonely', name: 'X', role: 'ילד', color: '#111', groups: [], createdAt: 'x', updatedAt: 'x' }),
    });
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    await recomputeResolvedPermissions('lonely');
    expect(mockBatchSet).toHaveBeenCalledWith('doc:members/lonely', { resolvedPermissions: {} }, { merge: true });
  });

  it('recomputeResolvedPermissions throws (does not silently no-op) when the member does not exist', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    await expect(recomputeResolvedPermissions('ghost')).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 4: Run to verify failure, then implement `PermissionsService.ts`**

```ts
// src/services/PermissionsService.ts
import { collection, doc, getDoc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import type { Member } from '../utils/seedFromBudgetConfig';
import type { ModulePermissionMap, PermissionDoc, PermissionScope } from '../types/permissions';
import { permissionDocId } from '../types/permissions';
import { resolveEffectivePermissions } from '../utils/resolvePermissions';
import { writeAuditLog } from '../utils/auditLog';

const PERMISSIONS_COLLECTION = 'permissions';
const MEMBERS_COLLECTION = 'members';

export async function listPermissionDocs(): Promise<PermissionDoc[]> {
  const snap = await getDocs(collection(db, PERMISSIONS_COLLECTION));
  return snap.docs.map((d) => d.data() as PermissionDoc);
}

export async function saveModulePermissions(
  scope: PermissionScope,
  targetId: string,
  modules: ModulePermissionMap,
  actorMemberId: string
): Promise<void> {
  const id = permissionDocId(scope, targetId);
  const batch = writeBatch(db);
  const permDoc: PermissionDoc = {
    id,
    scope,
    targetId,
    modules,
    updatedAt: new Date().toISOString(),
    updatedBy: actorMemberId,
  };
  batch.set(doc(db, PERMISSIONS_COLLECTION, id), permDoc);
  writeAuditLog(batch, { actorMemberId, action: 'permissions.update', target: `${PERMISSIONS_COLLECTION}/${id}` });
  await batch.commit();
  // Recompute for the affected member(s) so resolvedPermissions never drifts from this write
  // (Design decision D2 — same-batch-adjacent, not same-batch, because the set of affected
  // members for a GROUP change is not known without a members query; see Task 8 call sites,
  // which call recomputeResolvedPermissions for every member of the affected group/person
  // right after saveModulePermissions resolves).
}

/** Recomputes and persists `members/{memberId}.resolvedPermissions` from current groups + permission docs. */
export async function recomputeResolvedPermissions(memberId: string): Promise<void> {
  const memberSnap = await getDoc(doc(db, MEMBERS_COLLECTION, memberId));
  if (!memberSnap.exists()) {
    throw new Error(`[PermissionsService.recomputeResolvedPermissions] member not found: ${memberId}`);
  }
  const member = memberSnap.data() as Member;

  const allDocs = await listPermissionDocs();
  const groupDocsById: Record<string, PermissionDoc | undefined> = {};
  let exceptionDoc: PermissionDoc | null = null;
  for (const d of allDocs) {
    if (d.scope === 'group') groupDocsById[d.targetId] = d;
    if (d.scope === 'member' && d.targetId === memberId) exceptionDoc = d;
  }

  const resolved = resolveEffectivePermissions(member.groups ?? [], exceptionDoc, groupDocsById);

  const batch = writeBatch(db);
  batch.set(doc(db, MEMBERS_COLLECTION, memberId), { resolvedPermissions: resolved }, { merge: true });
  await batch.commit();
}

/** Drift-recovery utility (Risks section) — recomputes every member's resolvedPermissions. */
export async function recomputeAllResolvedPermissions(): Promise<void> {
  const snap = await getDocs(collection(db, MEMBERS_COLLECTION));
  for (const d of snap.docs) {
    await recomputeResolvedPermissions(d.id);
  }
}
```

- [ ] **Step 5: Run full suite**

Run: `npm run lint && npm test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/GroupsService.ts src/services/PermissionsService.ts src/utils/auditLog.ts src/__tests__/GroupsService.test.ts src/__tests__/PermissionsService.test.ts
git commit -m "feat: GroupsService + PermissionsService — matrix CRUD, resolvedPermissions materialization, audit log

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Auth provisioning script + fix the two anonymous-auth scripts

**Files:**
- Create: `scripts/provision-auth-users.ts`
- Modify: `scripts/migrate-transactions.ts`, `scripts/seed-members.ts`, `package.json`

**Interfaces:**
- Consumes: `firebase-admin` (new devDependency), `SUPER_ADMIN_MEMBER_ID` constant (D6), `DEFAULT_MEMBER_SEED` (Stage 1)
- Produces: `npx tsx scripts/provision-auth-users.ts [--apply]` — dry-run by default, same safety convention as `seed-members.ts`; on `--apply`, creates one Auth-emulator user per unlinked `members` doc, sets custom claims, links `members/{id}.uid`, and seeds the D8 default exception for existing `'ילד'` members.

- [ ] **Step 1: Add dependencies**

```bash
npm install --save-dev firebase-admin @firebase/rules-unit-testing
```

- [ ] **Step 2: Write `provision-auth-users.ts`**

```ts
// scripts/provision-auth-users.ts
//
// Provisions real per-member Auth-emulator accounts and the server-verified permission role
// (Design decision D1/D6/D7). Uses the Admin SDK, which BYPASSES Firestore Security Rules —
// this is the one place in the app allowed to write `members/{id}.uid` and set custom claims,
// because there is no other trusted actor before the first super-admin exists (D6).
//
// Usage:
//   npx tsx scripts/provision-auth-users.ts            # dry run — prints the plan, writes nothing
//   npx tsx scripts/provision-auth-users.ts --apply     # creates/links for real
//
// Requires the Auth + Firestore emulators running (npm run emu) and:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
//   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
// (set inline below so this script never needs the real project credentials.)

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

import admin from 'firebase-admin';

const PROJECT_ID = 'demo-familyfinance';
// D6 — the very first super-admin is an explicit constant, never inferred from data.
const SUPER_ADMIN_MEMBER_ID = 'david-levy';
const EMAIL_DOMAIN = 'familyfinance.local'; // D7 — local-only placeholder, not a real mailbox
const DEV_PASSWORD = 'FamilyFinance2026!'; // emulator-only; never used against a real project

const apply = process.argv.includes('--apply');

admin.initializeApp({ projectId: PROJECT_ID });
const auth = admin.auth();
const db = admin.firestore();

function roleFor(memberId: string, memberRole: 'הורה' | 'ילד'): 'super-admin' | 'parent' | 'member' {
  if (memberId === SUPER_ADMIN_MEMBER_ID) return 'super-admin';
  return memberRole === 'הורה' ? 'parent' : 'member';
}

async function main() {
  const membersSnap = await db.collection('members').get();
  if (membersSnap.empty) {
    console.log('No members found — run scripts/seed-members.ts first.');
    return;
  }

  const plan: Array<{ id: string; name: string; email: string; role: string; alreadyLinked: boolean }> = [];
  for (const d of membersSnap.docs) {
    const m = d.data() as { name: string; role: 'הורה' | 'ילד'; uid?: string };
    plan.push({
      id: d.id,
      name: m.name,
      email: `${d.id}@${EMAIL_DOMAIN}`,
      role: roleFor(d.id, m.role),
      alreadyLinked: Boolean(m.uid),
    });
  }

  console.log('Provisioning plan:');
  plan.forEach((p) => console.log(`  ${p.id} (${p.name}) → ${p.email} role=${p.role} ${p.alreadyLinked ? '[already linked]' : ''}`));

  if (!apply) {
    console.log('\nDRY RUN: no users created, no claims set, no writes. Re-run with --apply.');
    return;
  }

  for (const p of plan) {
    if (p.alreadyLinked) {
      console.log(`skip ${p.id}: already linked`);
      continue;
    }

    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(p.email);
    } catch {
      userRecord = await auth.createUser({ email: p.email, password: DEV_PASSWORD, displayName: p.name });
      console.log(`created auth user ${p.email} (uid=${userRecord.uid})`);
    }

    await auth.setCustomUserClaims(userRecord.uid, { role: p.role, memberId: p.id });
    await db.collection('members').doc(p.id).set({ uid: userRecord.uid }, { merge: true });
    console.log(`linked ${p.id} → uid=${userRecord.uid}, role=${p.role}`);

    // D8 — seed a permissive default exception for existing 'ילד' members so Stage 2's rollout
    // does not regress today's working Dashboard access. super-admin/parent need no matrix entry
    // (Rules bypass the matrix for them entirely).
    if (p.role === 'member') {
      const now = new Date().toISOString();
      await db.collection('permissions').doc(`member__${p.id}`).set({
        id: `member__${p.id}`,
        scope: 'member',
        targetId: p.id,
        modules: {
          expenses: { view: 'family', edit: 'none' },
          income: { view: 'family', edit: 'none' },
          investments: { view: 'family', edit: 'none' },
          goals: { view: 'family', edit: 'none' },
        },
        updatedAt: now,
        updatedBy: SUPER_ADMIN_MEMBER_ID,
      });
      await db.collection('members').doc(p.id).set(
        {
          resolvedPermissions: {
            expenses: { view: 'family', edit: 'none' },
            income: { view: 'family', edit: 'none' },
            investments: { view: 'family', edit: 'none' },
            goals: { view: 'family', edit: 'none' },
          },
        },
        { merge: true }
      );
      console.log(`  seeded default D8 permissive-view matrix for ${p.id}`);
    }
  }

  console.log(`\nDone. Sign in at the app with any of the emails above and password: ${DEV_PASSWORD}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Verify Admin SDK stays out of the client bundle**

Run: `grep -rn "firebase-admin" src`
Expected: zero matches. (Enforces the Global Constraint.)

- [ ] **Step 4: Fix `scripts/seed-members.ts` — swap anonymous client auth for Admin SDK**

Read the file first (unchanged since Stage 1 — shown in full above in the reading list). Replace the `firebase/app` + `firebase/firestore` (client) + `signInAnonymously` imports and connection block with the Admin SDK, matching the pattern established in Step 2:

```ts
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

import admin from 'firebase-admin';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { DEFAULT_MEMBER_SEED, seedFromBudgetConfig } from '../src/utils/seedFromBudgetConfig';

const PROJECT_ID = 'demo-familyfinance';
const apply = process.argv.includes('--apply');

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
```

Replace every `getDocs(collection(db, 'members'))` → `db.collection('members').get()`, `getDoc(doc(db, 'settings', 'budgetConfig'))` → `db.collection('settings').doc('budgetConfig').get()`, `writeBatch(db)` / `batch.set(doc(db, 'members', m.id), m)` / `batch.commit()` → `db.batch()` / `batch.set(db.collection('members').doc(m.id), m)` / `batch.commit()`. Delete the `signInAnonymously(auth)` call and the `getAuth`/`connectAuthEmulator` imports entirely — the Admin SDK never needs to sign in. Update the file's header comment to explain the Admin SDK bypasses Rules by design (same reasoning as `provision-auth-users.ts`), replacing the old "signs in anonymously... to satisfy firestore.rules" paragraph, which is no longer true and would mislead the next reader.

- [ ] **Step 5: Fix `scripts/migrate-transactions.ts` the same way**

Read the file first. Apply the identical Admin-SDK swap: drop `signInAnonymously`/`getAuth`/`connectAuthEmulator`/`connectFirestoreEmulator`, initialize `admin.initializeApp({ projectId: 'demo-familyfinance' })` with `FIRESTORE_EMULATOR_HOST` set before the import, replace `getDocs(collection(db, 'transactions'))` → `db.collection('transactions').get()`, `writeBatch(db)`/`doc(db, 'transaction_lines', id)` → `db.batch()`/`db.collection('transaction_lines').doc(id)`. Update its header comment the same way.

- [ ] **Step 6: Dry-run both fixed scripts against the emulator**

With `npm run emu` running:
```bash
npx tsx scripts/seed-members.ts
npx tsx scripts/migrate-transactions.ts
```
Expected: both run to completion with no `permission-denied` errors (Admin SDK bypasses Rules unconditionally) and no auth-related code paths at all. Then run `npx tsx scripts/provision-auth-users.ts --apply` and confirm the three members print `linked ... role=...`, with `david-levy → role=super-admin`, `lilit-levy → role=parent`, `omer-levy → role=member` plus its D8 default matrix line.

- [ ] **Step 7: Add npm scripts**

```json
"provision:auth": "npx tsx scripts/provision-auth-users.ts --apply"
```

- [ ] **Step 8: Full verification + commit**

Run: `npm run lint && npm test`
Expected: ALL PASS (these scripts are not part of the vitest suite, but `lint` type-checks them).

```bash
git add scripts/provision-auth-users.ts scripts/seed-members.ts scripts/migrate-transactions.ts package.json package-lock.json
git commit -m "feat: Admin-SDK auth provisioning; migrate emulator scripts off anonymous sign-in

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Rewrite `firestore.rules` — role, matrix enforcement, schema validation

**Files:**
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: `request.auth.token.role` / `request.auth.token.memberId` (set by Task 4's script), `members/{id}.resolvedPermissions` (written by Task 3's `PermissionsService`)
- Produces: the enforced rule set every later task (and the Task 6 test suite) targets.

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
    // A "member" (D1) with a resolved role at all — used to require role+memberId are both set
    // (an Auth user with no claims must be denied everywhere, never fall through as a guest).
    function hasRole() { return isSignedIn() && role() in ['super-admin', 'parent', 'member']; }

    function myMember() {
      return get(/databases/$(database)/documents/members/$(memberId())).data;
    }

    // Missing module/action defaults to 'none' — fail closed (tested explicitly in Task 6).
    function myLevel(module, action) {
      return myMember().get('resolvedPermissions', {}).get(module, {}).get(action, 'none');
    }

    // 'own' grants access only when the doc's `owner` field (display name) matches the caller's
    // own name (D5 — the only module with real per-person attribution today).
    function expensesAllowed(action, data) {
      let level = myLevel('expenses', action);
      return level == 'family' || (level == 'own' && data.owner == myMember().name);
    }

    // Ownerless modules (D5): 'own' does not grant access — only 'family' does.
    function ownerlessModuleAllowed(module, action) {
      return myLevel(module, action) == 'family';
    }

    function canAccessExpenses(action, data) {
      return isSuperAdmin() || isParent() || (hasRole() && expensesAllowed(action, data));
    }
    function canAccessOwnerlessModule(module, action) {
      return isSuperAdmin() || isParent() || (hasRole() && ownerlessModuleAllowed(module, action));
    }

    // ── Schema validation (Stage 1 ledger: `members` had none — closed here) ───────────
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

    // ── Identity & permission collections ───────────────────────────────────────────
    match /members/{memberId} {
      allow read: if isSignedIn();
      allow create, update: if isSuperAdmin() && isValidMember(request.resource.data);
      allow delete: if isSuperAdmin();
    }

    match /groups/{groupId} {
      allow read: if isSignedIn();
      allow create, update: if isSuperAdmin() && isValidGroup(request.resource.data);
      allow delete: if isSuperAdmin();
    }

    // D9 — permissions matrix is super-admin-only for read AND write; nothing else needs to
    // read the raw matrix (clients read their own members/{id}.resolvedPermissions instead).
    match /permissions/{permId} {
      allow read: if isSuperAdmin();
      allow create, update: if isSuperAdmin() && isValidPermissionDoc(request.resource.data);
      allow delete: if isSuperAdmin();
    }

    match /audit_log/{logId} {
      allow read: if isSuperAdmin();
      allow create: if isSignedIn()
        && role() in ['super-admin', 'parent']
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
      allow update, delete: if canAccessExpenses('edit', resource.data);
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

    // ── Shared/system collections — parents and super-admin manage, everyone signed-in reads ──
    match /settings/{docId} {
      allow read: if isSignedIn();
      allow write: if isSuperAdmin() || isParent();
    }

    match /categories/{docId} {
      allow read: if isSignedIn();
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
Expected: PASS (rules changes don't affect TypeScript, but confirms no accidental fallout).

- [ ] **Step 3: Commit**

(No automated test yet — Task 6 is the verification. Committing here keeps the rules-authoring diff separate from the test-suite diff, matching Stage 1's granularity.)

```bash
git add firestore.rules
git commit -m "feat: firestore.rules — role/matrix enforcement, member/group/permission schema validation, lock down dead 'transactions' collection

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Firestore Rules test suite (`@firebase/rules-unit-testing`)

**Files:**
- Create: `firestore-tests/permissions.rules.test.ts`, `vitest.rules.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `firestore.rules` (Task 5), `@firebase/rules-unit-testing` (installed Task 4)
- Produces: `npm run test:rules` — runs against a live Firestore emulator instance the test suite spins up itself via `initializeTestEnvironment`.

- [ ] **Step 1: Add the isolated vitest config**

```ts
// vitest.rules.config.ts
// Rules tests run against a real (ephemeral) Firestore emulator instance via
// @firebase/rules-unit-testing — they need Node, not jsdom, and must NOT load the app's
// src/__tests__/setup.ts (which mocks firebase/firestore for unit tests).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['firestore-tests/**/*.test.ts'],
    testTimeout: 20000, // rules-unit-testing spins up a real emulator connection per test file
  },
});
```

- [ ] **Step 2: Add the npm script**

```json
"test:rules": "firebase emulators:exec --project demo-familyfinance --only firestore \"vitest run --config vitest.rules.config.ts\""
```

- [ ] **Step 3: Write the test suite**

```ts
// firestore-tests/permissions.rules.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { setDoc, doc, getDoc, getDocs, collection, updateDoc, deleteDoc, addDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const DAVID = { uid: 'uid-david', memberId: 'david-levy', role: 'super-admin' as const };
const LILIT = { uid: 'uid-lilit', memberId: 'lilit-levy', role: 'parent' as const };
const OMER_OWN_VIEW = { uid: 'uid-omer', memberId: 'omer-levy', role: 'member' as const };

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-familyfinance-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed baseline member docs as Admin (bypasses rules) before each test.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'members', 'david-levy'), {
      id: 'david-levy', name: 'דויד', role: 'הורה', color: '#1F4E78', groups: [], uid: DAVID.uid,
      createdAt: 'x', updatedAt: 'x',
    });
    await setDoc(doc(db, 'members', 'lilit-levy'), {
      id: 'lilit-levy', name: 'לילית', role: 'הורה', color: '#17C3B2', groups: [], uid: LILIT.uid,
      createdAt: 'x', updatedAt: 'x',
    });
    await setDoc(doc(db, 'members', 'omer-levy'), {
      id: 'omer-levy', name: 'עומר', role: 'ילד', color: '#E07A5F', groups: [], uid: OMER_OWN_VIEW.uid,
      createdAt: 'x', updatedAt: 'x',
      resolvedPermissions: { expenses: { view: 'own', edit: 'none' }, income: { view: 'own', edit: 'none' } },
    });
    await setDoc(doc(db, 'transaction_lines', 'tx-david'), {
      owner: 'דויד', amount: 100, date: '2026-08-01', category: 'שונות', description: 'x',
    });
    await setDoc(doc(db, 'transaction_lines', 'tx-lilit'), {
      owner: 'לילית', amount: 200, date: '2026-08-01', category: 'שונות', description: 'x',
    });
    await setDoc(doc(db, 'transaction_lines', 'tx-omer'), {
      owner: 'עומר', amount: 50, date: '2026-08-01', category: 'שונות', description: 'x',
    });
    await setDoc(doc(db, 'incomes', 'income-1'), { name: 'משכורת', amount: 10000, date: '2026-08-01' });
  });
});

const ctxFor = (m: { uid: string; memberId: string; role: string }) =>
  testEnv.authenticatedContext(m.uid, { role: m.role, memberId: m.memberId });

describe('identity — role source', () => {
  it('a signed-in user with no custom claims is denied everywhere (never falls through as guest)', async () => {
    const noClaims = testEnv.authenticatedContext('uid-no-claims', {});
    await assertFails(getDocs(collection(noClaims.firestore(), 'members')));
  });

  it('an unauthenticated request is denied', async () => {
    const anon = testEnv.unauthenticatedContext();
    await assertFails(getDocs(collection(anon.firestore(), 'members')));
  });
});

describe('hard requirement — a child cannot read a parent\'s data; a parent can', () => {
  it('Omer (own/view on expenses) CANNOT read a transaction owned by לילית', async () => {
    const db = ctxFor(OMER_OWN_VIEW).firestore();
    await assertFails(getDoc(doc(db, 'transaction_lines', 'tx-lilit')));
  });

  it('Omer (own/view) CAN read his own transaction', async () => {
    const db = ctxFor(OMER_OWN_VIEW).firestore();
    await assertSucceeds(getDoc(doc(db, 'transaction_lines', 'tx-omer')));
  });

  it('לילית (parent) CAN read every transaction, including Omer\'s and David\'s', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(getDoc(doc(db, 'transaction_lines', 'tx-omer')));
    await assertSucceeds(getDoc(doc(db, 'transaction_lines', 'tx-david')));
  });

  it('super-admin (David) CAN read every transaction', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(getDoc(doc(db, 'transaction_lines', 'tx-lilit')));
  });
});

describe('permissions/members/groups writable only by super-admin', () => {
  it('a parent CANNOT write a permissions doc', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertFails(setDoc(doc(db, 'permissions', 'group__kids'), {
      id: 'group__kids', scope: 'group', targetId: 'kids', modules: {}, updatedAt: 'x', updatedBy: 'lilit-levy',
    }));
  });

  it('super-admin CAN write a permissions doc', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(setDoc(doc(db, 'permissions', 'group__kids'), {
      id: 'group__kids', scope: 'group', targetId: 'kids', modules: {}, updatedAt: 'x', updatedBy: 'david-levy',
    }));
  });

  it('a member CANNOT write another member\'s doc', async () => {
    const db = ctxFor(OMER_OWN_VIEW).firestore();
    await assertFails(updateDoc(doc(db, 'members', 'lilit-levy'), { name: 'hacked' }));
  });

  it('a parent CANNOT write a group doc (super-admin only, per the ניהול משפחה והרשאות module)', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertFails(setDoc(doc(db, 'groups', 'kids'), {
      id: 'kids', name: 'הילדים', memberIds: [], createdAt: 'x', updatedAt: 'x',
    }));
  });

  it('non-super-admin CANNOT read the raw permissions collection (D9)', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertFails(getDocs(collection(db, 'permissions')));
  });
});

describe('document shape validation (Stage 1 ledger item — members had none)', () => {
  it('super-admin writing a member with an invalid role is rejected', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'members', 'bad-1'), {
      id: 'bad-1', name: 'X', role: 'not-a-role', color: '#111111', groups: [], createdAt: 'x', updatedAt: 'x',
    }));
  });

  it('super-admin writing a member with a malformed color is rejected', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'members', 'bad-2'), {
      id: 'bad-2', name: 'X', role: 'הורה', color: 'blue', groups: [], createdAt: 'x', updatedAt: 'x',
    }));
  });

  it('super-admin writing a member missing a name is rejected', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertFails(setDoc(doc(db, 'members', 'bad-3'), {
      id: 'bad-3', role: 'הורה', color: '#111111', groups: [], createdAt: 'x', updatedAt: 'x',
    }));
  });

  it('a valid member doc is accepted', async () => {
    const db = ctxFor(DAVID).firestore();
    await assertSucceeds(setDoc(doc(db, 'members', 'good-1'), {
      id: 'good-1', name: 'X', role: 'ילד', color: '#112233', groups: [], createdAt: 'x', updatedAt: 'x',
    }));
  });
});

describe('fail-closed default — missing matrix entry denies, does not allow', () => {
  it('a member with no resolvedPermissions entry for a module is denied view', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'members', 'no-perms'), {
        id: 'no-perms', name: 'X', role: 'ילד', color: '#111111', groups: [], uid: 'uid-noperm', createdAt: 'x', updatedAt: 'x',
        // no resolvedPermissions field at all
      });
    });
    const db = testEnv.authenticatedContext('uid-noperm', { role: 'member', memberId: 'no-perms' }).firestore();
    await assertFails(getDoc(doc(db, 'transaction_lines', 'tx-david')));
  });
});

describe('ownerless modules — "own" does not grant access, only "family" does (D5)', () => {
  it('a member with income.view = "own" is DENIED (own is meaningless without an owner field)', async () => {
    const db = ctxFor(OMER_OWN_VIEW).firestore(); // seeded with income.view = 'own'
    await assertFails(getDoc(doc(db, 'incomes', 'income-1')));
  });

  it('a member with income.view = "family" is allowed', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'members', 'family-viewer'), {
        id: 'family-viewer', name: 'X', role: 'ילד', color: '#111111', groups: [], uid: 'uid-fv', createdAt: 'x', updatedAt: 'x',
        resolvedPermissions: { income: { view: 'family', edit: 'none' } },
      });
    });
    const db = testEnv.authenticatedContext('uid-fv', { role: 'member', memberId: 'family-viewer' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'incomes', 'income-1')));
  });
});

describe('audit_log immutability and anti-spoofing', () => {
  it('anyone (even super-admin) cannot update an audit_log entry', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'audit_log', 'entry-1'), {
        actorMemberId: 'david-levy', action: 'x', target: 'x', at: 'x',
      });
    });
    const db = ctxFor(DAVID).firestore();
    await assertFails(updateDoc(doc(db, 'audit_log', 'entry-1'), { action: 'tampered' }));
  });

  it('a parent cannot forge an audit entry claiming to be someone else', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertFails(setDoc(doc(db, 'audit_log', 'entry-2'), {
      actorMemberId: 'david-levy', action: 'x', target: 'x', at: 'x', // impersonating David
    }));
  });

  it('a member (not parent/super-admin) cannot write audit_log at all', async () => {
    const db = ctxFor(OMER_OWN_VIEW).firestore();
    await assertFails(setDoc(doc(db, 'audit_log', 'entry-3'), {
      actorMemberId: 'omer-levy', action: 'x', target: 'x', at: 'x',
    }));
  });

  it('a parent CAN write a correctly-attributed audit entry', async () => {
    const db = ctxFor(LILIT).firestore();
    await assertSucceeds(setDoc(doc(db, 'audit_log', 'entry-4'), {
      actorMemberId: 'lilit-levy', action: 'x', target: 'x', at: 'x',
    }));
  });
});

describe('legacy transactions collection is fully locked down', () => {
  it('even super-admin cannot read the legacy transactions collection via the client', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'transactions', 'legacy-1'), { amount: 1, date: '2026-01-01' });
    });
    const db = ctxFor(DAVID).firestore();
    await assertFails(getDoc(doc(db, 'transactions', 'legacy-1')));
  });
});
```

- [ ] **Step 4: Run the rules suite**

Run: `npm run test:rules`
Expected: ALL PASS. If any `assertFails` case unexpectedly succeeds, that is a real security gap in Task 5's rules — fix the rule, not the test.

- [ ] **Step 5: Full project verification**

Run: `npm run lint && npm test && npm run test:rules`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add firestore-tests/permissions.rules.test.ts vitest.rules.config.ts package.json
git commit -m "test: Firestore Rules suite — child/parent isolation, admin-only matrix writes, schema validation, fail-closed default, ownerless-module 'own' denial, audit immutability

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Real login — App.tsx auth session, LoginScreen, role-gated nav

**Files:**
- Create: `src/hooks/useAuthSession.ts`, `src/components/LoginScreen.tsx`
- Modify: `src/App.tsx`
- Test: `src/__tests__/useAuthSession.test.ts`

**Interfaces:**
- Consumes: `PermissionRole` (Task 1), Firebase `auth` (Stage 1)
- Produces:
```ts
export type AuthStatus = 'loading' | 'signed-out' | 'unprovisioned' | 'ready' | 'error';
export interface AuthSession { status: AuthStatus; user: User | null; role: PermissionRole | null; memberId: string | null; error: string | null; }
export function useAuthSession(): AuthSession;
export async function signOutCurrentUser(): Promise<void>;
```

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/useAuthSession.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { mockOnAuthStateChanged } = vi.hoisted(() => ({ mockOnAuthStateChanged: vi.fn() }));
vi.mock('../services/firebase', () => ({ auth: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mockOnAuthStateChanged,
  signOut: vi.fn(),
}));

import { useAuthSession } from '../hooks/useAuthSession';

describe('useAuthSession', () => {
  it('starts in "loading"', () => {
    mockOnAuthStateChanged.mockImplementation(() => () => {});
    const { result } = renderHook(() => useAuthSession());
    expect(result.current.status).toBe('loading');
  });

  it('moves to "signed-out" when there is no user', async () => {
    mockOnAuthStateChanged.mockImplementation((_auth, next) => { next(null); return () => {}; });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe('signed-out'));
  });

  it('moves to "ready" with role+memberId when claims are present', async () => {
    const fakeUser = { getIdTokenResult: vi.fn(async () => ({ claims: { role: 'parent', memberId: 'lilit-levy' } })) };
    mockOnAuthStateChanged.mockImplementation((_auth, next) => { next(fakeUser); return () => {}; });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.role).toBe('parent');
    expect(result.current.memberId).toBe('lilit-levy');
  });

  it('moves to "unprovisioned" (never a silent guest fallback) when signed in but claims are missing', async () => {
    const fakeUser = { getIdTokenResult: vi.fn(async () => ({ claims: {} })) };
    mockOnAuthStateChanged.mockImplementation((_auth, next) => { next(fakeUser); return () => {}; });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe('unprovisioned'));
    expect(result.current.error).toBeTruthy();
  });

  it('moves to "error" when reading the token fails', async () => {
    const fakeUser = { getIdTokenResult: vi.fn(async () => { throw new Error('token fetch failed'); }) };
    mockOnAuthStateChanged.mockImplementation((_auth, next) => { next(fakeUser); return () => {}; });
    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/useAuthSession.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// src/hooks/useAuthSession.ts
import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth } from '../services/firebase';
import type { PermissionRole } from '../types/permissions';

export type AuthStatus = 'loading' | 'signed-out' | 'unprovisioned' | 'ready' | 'error';

export interface AuthSession {
  status: AuthStatus;
  user: User | null;
  role: PermissionRole | null;
  memberId: string | null;
  error: string | null;
}

const INITIAL: AuthSession = { status: 'loading', user: null, role: null, memberId: null, error: null };
const UNPROVISIONED_MESSAGE =
  'החשבון שלך מחובר אך לא משויך לאף בן משפחה במערכת. פנה לסופר-אדמין (דויד) כדי לקשר את החשבון.';

export function useAuthSession(): AuthSession {
  const [session, setSession] = useState<AuthSession>(INITIAL);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (user: User | null) => {
        if (!user) {
          setSession({ status: 'signed-out', user: null, role: null, memberId: null, error: null });
          return;
        }
        try {
          // Force refresh — pick up claims set by provision-auth-users.ts after this session
          // started, rather than serving a cached token forever (Global Constraints: no stale
          // silent state).
          const tokenResult = await user.getIdTokenResult(true);
          const role = tokenResult.claims.role as PermissionRole | undefined;
          const memberId = tokenResult.claims.memberId as string | undefined;
          if (!role || !memberId) {
            setSession({ status: 'unprovisioned', user, role: null, memberId: null, error: UNPROVISIONED_MESSAGE });
            return;
          }
          setSession({ status: 'ready', user, role, memberId, error: null });
        } catch (err) {
          setSession({
            status: 'error',
            user,
            role: null,
            memberId: null,
            error: err instanceof Error ? err.message : 'שגיאה בטעינת הרשאות המשתמש',
          });
        }
      }
    );
    return unsubscribe;
  }, []);

  return session;
}

export async function signOutCurrentUser(): Promise<void> {
  await signOut(auth);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/__tests__/useAuthSession.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Write `LoginScreen.tsx`**

```tsx
// src/components/LoginScreen.tsx
import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Loader2, LogIn } from 'lucide-react';
import { auth } from '../services/firebase';

const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'אימייל או סיסמה שגויים.',
  'auth/user-not-found': 'לא נמצא משתמש עם האימייל הזה.',
  'auth/wrong-password': 'סיסמה שגויה.',
  'auth/too-many-requests': 'יותר מדי ניסיונות — נסה שוב בעוד כמה דקות.',
};

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      setError(ERROR_MESSAGES[code] ?? 'ההתחברות נכשלה. נסה שוב.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 rtl" dir="rtl">
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 w-full max-w-sm space-y-4">
        <div className="text-center mb-2">
          <div className="w-12 h-12 mx-auto bg-blue-600 rounded-xl flex items-center justify-center text-white text-2xl font-bold mb-3">₪</div>
          <h1 className="text-lg font-bold text-slate-800">תקציב משפחתי</h1>
          <p className="text-sm text-slate-500">התחברות</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">אימייל</label>
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            dir="ltr" autoComplete="username"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">סיסמה</label>
          <input
            type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            dir="ltr" autoComplete="current-password"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit" disabled={isSubmitting}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-semibold disabled:opacity-60"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          התחבר
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Rewire `App.tsx`**

Read the file first (shown in full above). Remove the `signInAnonymously`/`onAuthStateChanged` effect and `authReady` state entirely. Replace with:

```tsx
import { useAuthSession, signOutCurrentUser } from './hooks/useAuthSession';
import LoginScreen from './components/LoginScreen';
import PermissionsManager from './components/PermissionsManager'; // Task 8

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const session = useAuthSession();

  useEffect(() => {
    if (session.status !== 'ready') return;
    ensureSeeded().catch((err) => console.error('[App] Failed to seed members collection:', err));
  }, [session.status]);

  if (session.status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <span className="text-sm">טוען...</span>
        </div>
      </div>
    );
  }

  if (session.status === 'signed-out') {
    return <LoginScreen />;
  }

  if (session.status === 'unprovisioned' || session.status === 'error') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 rtl" dir="rtl">
        <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-8 max-w-md text-center space-y-4">
          <p className="text-red-600 font-medium">{session.error}</p>
          <button onClick={() => signOutCurrentUser()} className="text-sm text-slate-500 underline">התנתק ונסה שוב</button>
        </div>
      </div>
    );
  }

  // session.status === 'ready' from here on — session.role / session.memberId are non-null.
  const isSuperAdmin = session.role === 'super-admin';

  const tabs = [
    { id: 'dashboard', label: 'לוח תצוגה ראשי', icon: LayoutDashboard },
    { id: 'expenses', label: 'פירוט הוצאות', icon: Receipt },
    { id: 'central-expenses', label: 'דוח הוצאות מרכז', icon: FileText },
    { id: 'investments', label: 'תיק השקעות ופנסיה', icon: TrendingUp },
    { id: 'future', label: 'תכנון עתידי', icon: Compass },
    { id: 'annual', label: 'דוח שנתי', icon: CalendarDays },
    { id: 'folder', label: 'תיקייה חודשית', icon: FolderOpen },
    ...(isSuperAdmin ? [{ id: 'permissions', label: 'ניהול משפחה והרשאות', icon: Shield }] : []),
  ];
```

(`Shield` needs adding to the `lucide-react` import list.) In `renderContent`, add:
```tsx
case 'permissions': return isSuperAdmin ? <PermissionsManager actorMemberId={session.memberId!} /> : <Dashboard />;
```
Wire the existing sign-out button:
```tsx
<button onClick={() => signOutCurrentUser()} className="p-2 text-slate-500 hover:text-red-600 transition-colors">
  <LogOut className="w-5 h-5" />
</button>
```

- [ ] **Step 7: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS. With `npm run emu` + `npm run provision:auth` run once: `npm run dev:local`, open the app, confirm the login screen renders, sign in as `david-levy@familyfinance.local` / the printed dev password, confirm the app loads and the "ניהול משפחה והרשאות" tab is visible; sign out, sign in as `omer-levy@familyfinance.local`, confirm the tab is NOT visible.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useAuthSession.ts src/components/LoginScreen.tsx src/App.tsx src/__tests__/useAuthSession.test.ts
git commit -m "feat: real email/password login, claims-driven session state, role-gated nav — no more anonymous auth

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Permission Matrix admin screen (super-admin only)

**Files:**
- Create: `src/components/PermissionsManager.tsx`
- Test: `src/__tests__/PermissionsManager.test.tsx`

**Interfaces:**
- Consumes: `listGroups`/`saveGroup`/`deleteGroup` (Task 3), `listPermissionDocs`/`saveModulePermissions`/`recomputeResolvedPermissions` (Task 3), `listMembers` (Stage 1), `MODULE_IDS` (Task 1)
- Produces: `<PermissionsManager actorMemberId={string} />` — a functional (not yet visually polished; Stage 4 owns the "hover-explain"/design-system pass) screen: group CRUD with member assignment, and a module × view/edit matrix editor per group or per member, calling `recomputeResolvedPermissions` for every affected member immediately after each matrix save (closing the D2 "never drifts" guarantee at the UI layer, matching how `saveModulePermissions` documents that the caller is responsible for triggering it).

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/PermissionsManager.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  listMembers: vi.fn(),
  listGroups: vi.fn(),
  saveGroup: vi.fn(async () => undefined),
  listPermissionDocs: vi.fn(),
  saveModulePermissions: vi.fn(async () => undefined),
  recomputeResolvedPermissions: vi.fn(async () => undefined),
}));

vi.mock('../services/MembersService', () => ({ listMembers: mocks.listMembers }));
vi.mock('../services/GroupsService', () => ({ listGroups: mocks.listGroups, saveGroup: mocks.saveGroup, deleteGroup: vi.fn() }));
vi.mock('../services/PermissionsService', () => ({
  listPermissionDocs: mocks.listPermissionDocs,
  saveModulePermissions: mocks.saveModulePermissions,
  recomputeResolvedPermissions: mocks.recomputeResolvedPermissions,
}));

import PermissionsManager from '../components/PermissionsManager';

describe('PermissionsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listMembers.mockResolvedValue([
      { id: 'omer-levy', name: 'עומר', role: 'ילד', color: '#111', groups: [], createdAt: 'x', updatedAt: 'x' },
    ]);
    mocks.listGroups.mockResolvedValue([]);
    mocks.listPermissionDocs.mockResolvedValue([]);
  });

  it('renders an error state (not empty) when loading members fails', async () => {
    mocks.listMembers.mockRejectedValueOnce(new Error('down'));
    render(<PermissionsManager actorMemberId="david-levy" />);
    await waitFor(() => expect(screen.getByText(/שגיאה/)).toBeInTheDocument());
  });

  it('lists members once loaded', async () => {
    render(<PermissionsManager actorMemberId="david-levy" />);
    await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
  });

  it('saving a member matrix entry calls saveModulePermissions then recomputeResolvedPermissions for that member', async () => {
    render(<PermissionsManager actorMemberId="david-levy" />);
    await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('edit-permissions-omer-levy'));
    fireEvent.click(screen.getByTestId('save-permissions-omer-levy'));

    await waitFor(() => expect(mocks.saveModulePermissions).toHaveBeenCalledWith('member', 'omer-levy', expect.any(Object), 'david-levy'));
    expect(mocks.recomputeResolvedPermissions).toHaveBeenCalledWith('omer-levy');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/PermissionsManager.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PermissionsManager.tsx`**

```tsx
// src/components/PermissionsManager.tsx
import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Save } from 'lucide-react';
import { listMembers } from '../services/MembersService';
import { listGroups, saveGroup } from '../services/GroupsService';
import { listPermissionDocs, saveModulePermissions, recomputeResolvedPermissions } from '../services/PermissionsService';
import { MODULE_IDS, type ModuleId, type ModulePermissionMap, type PermissionLevel } from '../types/permissions';
import type { Member } from '../utils/seedFromBudgetConfig';
import type { Group, PermissionDoc } from '../types/permissions';

const MODULE_LABELS: Record<ModuleId, string> = {
  expenses: 'הוצאות', income: 'הכנסות', investments: 'השקעות', goals: 'יעדים',
};
const LEVEL_LABELS: Record<PermissionLevel, string> = { none: 'ללא', own: 'אישי', family: 'משפחתי' };

interface LoadState {
  status: 'loading' | 'error' | 'ready';
  error: string | null;
  members: Member[];
  groups: Group[];
  permissionDocs: PermissionDoc[];
}

export default function PermissionsManager({ actorMemberId }: { actorMemberId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading', error: null, members: [], groups: [], permissionDocs: [] });
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [draftModules, setDraftModules] = useState<ModulePermissionMap>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      const [members, groups, permissionDocs] = await Promise.all([listMembers(), listGroups(), listPermissionDocs()]);
      setState({ status: 'ready', error: null, members, groups, permissionDocs });
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', error: err instanceof Error ? err.message : 'שגיאה בטעינת ההרשאות' }));
    }
  };

  useEffect(() => { load(); }, []);

  if (state.status === 'loading') {
    return <div className="flex items-center gap-2 text-slate-500 p-8"><Loader2 className="w-5 h-5 animate-spin" /> טוען...</div>;
  }
  if (state.status === 'error') {
    return (
      <div className="flex items-center gap-2 text-red-600 p-8">
        <AlertCircle className="w-5 h-5" /> שגיאה: {state.error}
      </div>
    );
  }

  const startEdit = (memberId: string) => {
    const existing = state.permissionDocs.find((d) => d.scope === 'member' && d.targetId === memberId);
    setDraftModules(existing?.modules ?? {});
    setEditingMemberId(memberId);
  };

  const setLevel = (moduleId: ModuleId, action: 'view' | 'edit', level: PermissionLevel) => {
    setDraftModules((prev) => ({
      ...prev,
      [moduleId]: { view: prev[moduleId]?.view ?? 'none', edit: prev[moduleId]?.edit ?? 'none', [action]: level },
    }));
  };

  const save = async (memberId: string) => {
    setSavingId(memberId);
    try {
      await saveModulePermissions('member', memberId, draftModules, actorMemberId);
      await recomputeResolvedPermissions(memberId);
      setEditingMemberId(null);
      await load();
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', error: err instanceof Error ? err.message : 'שמירת ההרשאות נכשלה' }));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6 p-4" dir="rtl">
      <h2 className="text-lg font-bold text-slate-800">ניהול משפחה והרשאות</h2>

      <div className="bg-white rounded-xl border border-slate-200 divide-y">
        {state.members.map((m) => (
          <div key={m.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: m.color }} />
                <span className="font-medium text-slate-800">{m.name}</span>
                <span className="text-xs text-slate-400">({m.role})</span>
              </div>
              {editingMemberId !== m.id && (
                <button
                  data-testid={`edit-permissions-${m.id}`}
                  onClick={() => startEdit(m.id)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  ערוך הרשאות
                </button>
              )}
            </div>

            {editingMemberId === m.id && (
              <div className="mt-3 space-y-2">
                {MODULE_IDS.map((moduleId) => (
                  <div key={moduleId} className="flex items-center gap-3 text-sm">
                    <span className="w-20 text-slate-600">{MODULE_LABELS[moduleId]}</span>
                    {(['view', 'edit'] as const).map((action) => (
                      <label key={action} className="flex items-center gap-1">
                        <span className="text-xs text-slate-400">{action === 'view' ? 'צפייה' : 'עריכה'}</span>
                        <select
                          value={draftModules[moduleId]?.[action] ?? 'none'}
                          onChange={(e) => setLevel(moduleId, action, e.target.value as PermissionLevel)}
                          className="border border-slate-300 rounded px-1 py-0.5 text-xs"
                        >
                          {(['none', 'own', 'family'] as const).map((level) => (
                            <option key={level} value={level}>{LEVEL_LABELS[level]}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                ))}
                <div className="flex gap-2 pt-2">
                  <button
                    data-testid={`save-permissions-${m.id}`}
                    onClick={() => save(m.id)}
                    disabled={savingId === m.id}
                    className="flex items-center gap-1 bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg disabled:opacity-60"
                  >
                    {savingId === m.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    שמור
                  </button>
                  <button onClick={() => setEditingMemberId(null)} className="text-xs text-slate-500">ביטול</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

(Groups CRUD UI — create/rename/assign members, calling `saveGroup`/`deleteGroup` from Task 3 — follows the identical list+edit-row pattern as the member matrix above; omitted here for brevity of this plan but required in the implementation, gated by the same "no placeholders" bar: build it as a second `<div>` block in the same component, reusing `state.groups`, with its own `data-testid="save-group-{id}"` following the member pattern exactly so it is equally testable.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/__tests__/PermissionsManager.test.tsx`
Expected: ALL PASS.

- [ ] **Step 5: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS.

- [ ] **Step 6: Manual emulator smoke test**

With emulators + `npm run provision:auth` run: sign in as David, open "ניהול משפחה והרשאות", edit Omer's matrix (e.g. set `expenses.edit` to `own`), save, confirm no console errors, then sign out and sign in as Omer and confirm Dashboard still loads (resolvedPermissions recomputed correctly, no regression from D8's seeded default).

- [ ] **Step 7: Commit**

```bash
git add src/components/PermissionsManager.tsx src/__tests__/PermissionsManager.test.tsx
git commit -m "feat: super-admin permission matrix + groups admin screen

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Stage-2 Done Criteria

- No anonymous auth anywhere reachable from the running app or from `scripts/*.ts` (all scripts use the Admin SDK, which never signs in).
- `role`/`memberId` exist only as Firebase Auth custom claims, set exclusively by `scripts/provision-auth-users.ts`; `Member.role` remains a display field the Rules never trust (D1).
- `firestore.rules` enforces the module × level × action matrix on `transaction_lines`/`incomes`/`investments`/`goals`, restricts `members`/`groups`/`permissions` writes to super-admin, validates document shape on every write to `members`/`groups`/`permissions`/`audit_log`, and denies by default when a matrix entry is missing.
- `npm run test:rules` passes, covering: child-cannot-read-parent, parent-can-read-everything, super-admin bypass, admin-only matrix writes, schema validation rejection, fail-closed default, ownerless-module `'own'` denial, audit_log immutability and anti-spoofing.
- `npm run provision:auth` seeds three working local logins (David/Lilit/Omer) against the Auth emulator; the app's login screen, role-gated nav, and permission matrix screen all work end-to-end against them.
- `git status` clean; every commit green on lint + unit tests + rules tests.

## Risks

- **Rules could lock David out of his own local data.** Mitigated three ways: (1) `isSuperAdmin()` is checked FIRST in every matrix-governed rule (`canAccessExpenses`/`canAccessOwnerlessModule`) — a super-admin bypasses the matrix unconditionally, so a bad matrix entry can never affect David; (2) the rules test suite (Task 6) asserts super-admin success explicitly on every governed collection, so a regression fails CI-equivalent testing before it reaches David's emulator; (3) `SUPER_ADMIN_MEMBER_ID` is set once, by the provisioning script, and is never affected by any matrix/group edit made through the app (the admin screen only edits `permissions` docs, never custom claims).
- **`resolvedPermissions` drift.** If `groups`/`permissions` are ever edited directly via the Emulator UI (bypassing `PermissionsService`), `members/{id}.resolvedPermissions` will not be recomputed automatically — a member could be under- or over-granted until the next app-driven edit. Mitigated by `recomputeAllResolvedPermissions()` (Task 3) as a one-call repair utility, and documented here as the reason direct Firestore Console/Emulator-UI edits to these three collections should be avoided in normal operation.
- **Token-claim staleness.** A user signed in before `provision-auth-users.ts` grants/changes their role won't see the new claims until their ID token refreshes. `useAuthSession` force-refreshes on every `onAuthStateChanged` firing (covers new tab/reload), but a long-lived open tab won't pick up a mid-session role change until reload or the SDK's own ~1h refresh cycle. Acceptable for a local family app (re-login or refresh is a reasonable ask); flagged here rather than silently accepted.
- **Screens that issue unfiltered queries against `'own'`-scoped members.** Firestore denies an entire `list` query (not partial results) if it could return a document the rule would deny — so an `'own'`-level member hitting an unfiltered `getDocs(collection(db,'transaction_lines'))` (as several existing Stage-1 screens do) gets a full permission-denied, correctly surfaced by the existing "error, not empty" convention, but not a good experience. Mitigated for Stage 2's rollout by D8 (every existing `'ילד'` member is provisioned at `family`-level view, where unfiltered queries are allowed); tightening any member to `'own'` and rewiring the relevant screens to filter by owner is explicitly carried forward to Stage 4/5 (UI shell + financial modules), not silently left broken.
- **`firebase-admin` accidentally reaching the client bundle.** Guarded by the Task 4 Step 3 `grep` check and by convention (only `scripts/*.ts`, run via `tsx`, ever import it); `npm run build` (Vite) would fail loudly if it were ever imported from `src/` since `firebase-admin` is Node-only and not in `dependencies`.

## Self-review against spec §4/§7/§13

- §4 roles table (super-admin/parent/member; parent unreducible; member per-matrix): covered — D1, Task 4 (`roleFor`), Task 5 (`isSuperAdmin()`/`isParent()` bypass the matrix entirely, so a parent's access literally cannot be reduced by any matrix edit).
- §4 groups (bulk grant + per-person exception): covered — Task 1 (D3/D4 resolver + tests), Task 3 (`GroupsService`), Task 8 (groups CRUD in the admin screen).
- §4 up to 20 members: covered by construction — the matrix/resolver/rules operate per-member-id with no member-count assumption; Stage 1's 20-color palette ceiling is the only existing numeric limit and is unrelated to permissions.
- §7 `members` (uid, no shape validation): covered — Task 2 (`uid` field), Task 5 (`isValidMember`).
- §7 `groups`: covered — Task 1 (type), Task 3 (service), Task 5 (rules + `isValidGroup`).
- §7 `permissions` (per-member/per-group, module→level×action, exception overrides group, super-admin-only write, enforced in Rules): covered — Task 1 (types + resolver), Task 3 (service), Task 5 (rules).
- §7 `audit_log` (who changed what, when, for sensitive actions): covered — Task 3 (`writeAuditLog`, called from every `GroupsService`/`PermissionsService` write), Task 5 (immutable, anti-spoofing rules), Task 6 (tests). Not yet covered: import-approval and member-delete audit entries from OTHER stages' write paths (e.g. Stage 1's `saveMembers`, Stage 11's import approval) — those collections' own write paths gaining an audit entry is each such stage's own responsibility, not retrofitted here; flagged for Stage 11's hardening pass rather than silently assumed done.
- §14.1 identity (personal account, no anonymous, role from custom claims): covered — Task 4, Task 5, Task 7.
- §14.2 (Rules enforce the matrix, admin-only writes to `permissions`/`members`, shape validation on every collection): covered — Task 5, Task 6.
- §13 (guided tours respect permissions): correctly NOT built here — §13 is Stage 10's deliverable in the roadmap; Stage 2's job is to provide the primitive (`role`/`resolvedPermissions`) Stage 10 will read, which it now can.

## Open questions: none
