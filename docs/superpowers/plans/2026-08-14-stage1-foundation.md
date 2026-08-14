# FamilyFinance v2 — Stage 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the existing Family-Finance-App running fully locally on the Firebase Emulator Suite, with a clean repo, a single canonical transactions collection, and family members as a real collection.

**Architecture:** The app stays a Vite + React 19 + TypeScript client talking to Firestore. This stage adds no features — it repairs the base: emulator-first local runtime (the old cloud project `family-finance-app-c9aa4` is deleted), completes the half-finished `transactions` → `transaction_lines` migration, and extracts family members from `settings/budgetConfig` into a `members` collection so Stage 2 (auth + permissions) has a real entity to attach users to.

**Tech Stack:** Vite 6, React 19, TypeScript 5.8 strict, Firebase JS SDK v12, firebase-tools 15 (already a devDependency), Vitest 4, tsx.

**Spec:** `docs/superpowers/specs/2026-08-14-family-finance-v2-design.md` (§2 debts table, §7 migration, §15 local-first)

## Global Constraints

- All work on branch `familyfinance-v2`. Never commit to `main`.
- UI language Hebrew, RTL; dates DD/MM/YYYY; amounts always ₪-labeled (existing conventions — do not regress).
- TypeScript strict; `npm run lint` (tsc --noEmit) and `npm test` must pass before every commit.
- Data-integrity law: archive before destructive change — the migration exports a JSON backup before writing anything.
- A failed read renders as an error, never as an empty state (applies to any component you touch).
- Emulator project id is exactly `demo-familyfinance` (the `demo-` prefix guarantees firebase-tools never touches a real cloud project).
- Do not modify files under `dist/`; do not touch `src/services/ai.ts` (Stage 6 replaces it).

---

### Task 1: Checkpoint the April working tree

The repo carries ~11 uncommitted files from April (hardened `firestore.rules`, `firebase.json` headers, real fixes in SyncService/GoogleDriveService/FileProcessor/SyncButton, `NOTEBOOKLM.md`, deletions of `BORIS.md`/`LOLA.md`). Losing them would regress the sync pipeline. Recommendation approved with the spec: preserve them as-is in one checkpoint commit on `familyfinance-v2`.

**Files:**
- Modify: none (commit existing working tree verbatim)

**Interfaces:**
- Consumes: nothing
- Produces: a clean `git status` so every later task's diff is only its own change

- [ ] **Step 1: Verify the tree matches the expected state**

Run: `git status --short`
Expected: exactly the known set — ` D BORIS.md`, ` D LOLA.md`, ` M CLAUDE.md`, ` M firebase.json`, ` M firestore.rules`, ` M src/components/AssetCard.tsx`, ` M src/components/InvestmentsImportModal.tsx`, ` M src/components/SyncButton.tsx`, ` M src/services/GoogleDriveService.ts`, ` M src/services/SyncService.ts`, ` M src/utils/FileProcessor.ts`, `?? NOTEBOOKLM.md`, and the committed `docs/` additions from planning. If anything else appears, stop and report instead of committing it.

- [ ] **Step 2: Confirm the suite is green on this tree**

Run: `npm install && npm run lint && npm test`
Expected: install succeeds, tsc emits no errors, all 4 existing test files pass. If tests fail, report the failure — do not fix unrelated code in this task.

- [ ] **Step 3: Commit the checkpoint**

```bash
git add -A
git commit -m "checkpoint: preserve April sync/rules hardening work pre-v2

Uncommitted since April: hardened firestore.rules + CSP headers,
sync-pipeline fixes, NOTEBOOKLM.md (accurate architecture doc),
persona-file consolidation (BORIS.md/LOLA.md removed).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Repo hygiene — package identity and dead dependencies

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1's clean tree
- Produces: package name `familyfinance`; dependencies without `express`, `better-sqlite3`, `dotenv`, `@types/express`

- [ ] **Step 1: Prove the dependencies are dead**

Run: `grep -rn "express\|better-sqlite3\|dotenv" src index.html vite.config.ts --include="*.ts" --include="*.tsx" --include="*.html"`
Expected: zero matches (they were AI-Studio boilerplate; nothing imports them). If any match appears, stop — that dependency stays, note it in the commit message.

- [ ] **Step 2: Edit package.json**

Change `"name": "react-example"` → `"name": "familyfinance"` and `"version": "0.0.0"` → `"version": "2.0.0-dev"`. Delete the dependency lines for `express`, `better-sqlite3`, `dotenv` and the devDependency `@types/express`.

- [ ] **Step 3: Reinstall and verify green**

Run: `npm install && npm run lint && npm test && npm run build`
Expected: all pass; `npm run build` produces `dist/` without errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: rename package to familyfinance, drop unused server deps

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Firebase Emulator Suite — local-first runtime

**Files:**
- Modify: `firebase.json` (add `emulators` block), `.firebaserc` (add `demo` alias), `src/services/firebase.ts` (emulator connection), `package.json` (scripts), `.gitignore`
- Create: `.env.local`

**Interfaces:**
- Consumes: Task 2's clean package
- Produces: `npm run emu` (starts emulators with persistent data), `npm run dev:local` (Vite pointed at emulators); `src/services/firebase.ts` connects to emulators when `import.meta.env.VITE_USE_EMULATOR === '1'`

- [ ] **Step 1: Add the emulators block to firebase.json**

Append as a top-level key next to `firestore`/`hosting`:

```json
"emulators": {
  "auth": { "port": 9099 },
  "firestore": { "port": 8080 },
  "ui": { "enabled": true, "port": 4400 },
  "singleProjectMode": true
}
```

- [ ] **Step 2: Add the demo project alias to .firebaserc**

```json
{
  "projects": {
    "default": "family-finance-app-c9aa4",
    "demo": "demo-familyfinance"
  }
}
```

- [ ] **Step 3: Add npm scripts and gitignore entries**

In `package.json` scripts:

```json
"emu": "firebase emulators:start --project demo-familyfinance --import=./.emulator-data --export-on-exit=./.emulator-data",
"dev:local": "vite --port=3000 --host=0.0.0.0"
```

(`dev:local` is identical to `dev` today; it exists so the two modes are named — `.env.local` drives the difference.)

Append to `.gitignore`:

```
.emulator-data/
.env.local
```

- [ ] **Step 4: Create .env.local**

```
VITE_USE_EMULATOR=1
```

- [ ] **Step 5: Wire the emulator connection in src/services/firebase.ts**

Read the file first. After the existing `initializeApp`/`getFirestore`/`getAuth` calls (whatever their existing names are — do not rename them), add:

```ts
import { connectFirestoreEmulator } from 'firebase/firestore';
import { connectAuthEmulator } from 'firebase/auth';

if (import.meta.env.VITE_USE_EMULATOR === '1') {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
```

Adjust `db`/`auth` to the actual exported instance names in the file. Note: the existing code enables `persistentLocalCache` — if Firestore is initialized via `initializeFirestore(app, {...})`, keep that call and pass the same instance to `connectFirestoreEmulator`.

- [ ] **Step 6: Verify the local stack boots**

Run (background): `npm run emu` — wait for "All emulators ready".
Run (second terminal): `npm run dev:local`, open `http://localhost:3000`.
Expected: app loads, no Firestore connection errors in the browser console (empty-data states are fine — the emulator is empty), Emulator UI reachable at `http://localhost:4400`. `npm run lint` still passes.

- [ ] **Step 7: Commit**

```bash
git add firebase.json .firebaserc package.json .gitignore src/services/firebase.ts
git commit -m "feat: Firebase Emulator Suite local-first runtime (demo-familyfinance)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Migration script — legacy `transactions` → `transaction_lines`

Legacy `transactions` docs store English category keys (`Housing_Utilities`, `General_Misc`, …); canonical `transaction_lines` docs store Hebrew categories. `CATEGORY_MAP` in `src/utils/FileProcessor.ts` already maps English → Hebrew (covered by `src/__tests__/categoryMap.test.ts`).

**Files:**
- Create: `scripts/migrate-transactions.ts`, `src/utils/migrateLegacyTransaction.ts`
- Test: `src/__tests__/migrateLegacyTransaction.test.ts`

**Interfaces:**
- Consumes: `CATEGORY_MAP` from `src/utils/FileProcessor.ts`
- Produces: `migrateLegacyTransaction(legacy: Record<string, unknown>, id: string): { line: Record<string, unknown>; warnings: string[] }` — pure function; and a runnable script `npx tsx scripts/migrate-transactions.ts` that backs up, converts, writes, and reports.

- [ ] **Step 1: Read the real legacy shape**

Read `src/components/Dashboard.tsx` and `src/services/SyncService.ts` where they query `'transactions'`, and list every field the app actually reads from a legacy doc (at minimum: date, amount, category, description/vendor, owner). Write the exact field list into the test in Step 2 — the test is the contract.

- [ ] **Step 2: Write the failing test**

```ts
// src/__tests__/migrateLegacyTransaction.test.ts
import { describe, expect, it } from 'vitest';
import { migrateLegacyTransaction } from '../utils/migrateLegacyTransaction';

describe('migrateLegacyTransaction', () => {
  it('converts an English category to its Hebrew canonical value', () => {
    const { line, warnings } = migrateLegacyTransaction(
      { date: '2026-03-15', amount: 250, category: 'Housing_Utilities', description: 'חשמל', owner: 'דויד' },
      'legacy-1'
    );
    expect(line.category).toBe('מגורים ובית');
    expect(line.legacyId).toBe('legacy-1');
    expect(line.migratedAt).toBeTypeOf('string');
    expect(warnings).toEqual([]);
  });

  it('keeps an already-Hebrew category as-is', () => {
    const { line, warnings } = migrateLegacyTransaction(
      { date: '2026-03-15', amount: 100, category: 'בריאות', description: 'קופת חולים', owner: 'לילית' },
      'legacy-2'
    );
    expect(line.category).toBe('בריאות');
    expect(warnings).toEqual([]);
  });

  it('maps an unknown category to שונות with a warning, never drops the row', () => {
    const { line, warnings } = migrateLegacyTransaction(
      { date: '2026-03-15', amount: 50, category: 'Mystery_Key', description: '?', owner: 'דויד' },
      'legacy-3'
    );
    expect(line.category).toBe('שונות');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Mystery_Key');
  });

  it('preserves amount, date, owner and description verbatim', () => {
    const legacy = { date: '2026-01-02', amount: 99.9, category: 'General_Misc', description: 'בדיקה', owner: 'עומר' };
    const { line } = migrateLegacyTransaction(legacy, 'legacy-4');
    expect(line.amount).toBe(99.9);
    expect(line.date).toBe('2026-01-02');
    expect(line.owner).toBe('עומר');
    expect(line.description).toBe('בדיקה');
  });
});
```

Extend the "preserves" test with every additional field found in Step 1.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/migrateLegacyTransaction.test.ts`
Expected: FAIL — module `../utils/migrateLegacyTransaction` not found.

- [ ] **Step 4: Implement the pure converter**

```ts
// src/utils/migrateLegacyTransaction.ts
import { CATEGORY_MAP } from './FileProcessor';

const HEBREW_CATEGORIES = Object.values(CATEGORY_MAP);
const FALLBACK_CATEGORY = CATEGORY_MAP.General_Misc; // 'שונות'

export function migrateLegacyTransaction(
  legacy: Record<string, unknown>,
  id: string
): { line: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];
  const raw = String(legacy.category ?? '');
  let category: string;
  if (HEBREW_CATEGORIES.includes(raw)) {
    category = raw;
  } else if (raw in CATEGORY_MAP) {
    category = CATEGORY_MAP[raw as keyof typeof CATEGORY_MAP];
  } else {
    category = FALLBACK_CATEGORY;
    warnings.push(`unknown category "${raw}" on legacy doc ${id} → ${FALLBACK_CATEGORY}`);
  }
  return {
    line: { ...legacy, category, legacyId: id, migratedAt: new Date().toISOString() },
    warnings,
  };
}
```

Spread first, then override — every legacy field survives verbatim unless explicitly converted.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run` (full suite — the FileProcessor import must not break other tests)
Expected: ALL PASS.

- [ ] **Step 6: Write the runner script**

```ts
// scripts/migrate-transactions.ts
// Run with emulators up: npx tsx scripts/migrate-transactions.ts
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { mkdirSync, writeFileSync } from 'node:fs';
import { migrateLegacyTransaction } from '../src/utils/migrateLegacyTransaction';

const app = initializeApp({ projectId: 'demo-familyfinance' });
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);

async function main() {
  const legacySnap = await getDocs(collection(db, 'transactions'));
  console.log(`legacy docs: ${legacySnap.size}`);

  // archive-before-overwrite (Global Constraints)
  mkdirSync('backups', { recursive: true });
  const backupPath = `backups/transactions-${new Date().toISOString().replace(/:/g, '-')}.json`;
  writeFileSync(backupPath, JSON.stringify(legacySnap.docs.map(d => ({ id: d.id, ...d.data() })), null, 2));
  console.log(`backup written: ${backupPath}`);

  const allWarnings: string[] = [];
  let batch = writeBatch(db);
  let inBatch = 0;
  for (const legacyDoc of legacySnap.docs) {
    const { line, warnings } = migrateLegacyTransaction(legacyDoc.data(), legacyDoc.id);
    allWarnings.push(...warnings);
    batch.set(doc(db, 'transaction_lines', `migrated-${legacyDoc.id}`), line);
    if (++inBatch === 400) { await batch.commit(); batch = writeBatch(db); inBatch = 0; }
  }
  if (inBatch > 0) await batch.commit();

  console.log(`migrated: ${legacySnap.size}, warnings: ${allWarnings.length}`);
  allWarnings.forEach(w => console.warn(w));
  console.log('legacy collection left in place; deleted only in Task 5 after dual-read removal ships.');
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
```

Add `backups/` to `.gitignore`.

- [ ] **Step 7: Dry-run against the emulator**

With `npm run emu` running: seed 2 fake legacy docs via the Emulator UI (`http://localhost:4400` → Firestore → `transactions`), one with `category: "Housing_Utilities"`, one with `category: "Mystery_Key"`. Run `npx tsx scripts/migrate-transactions.ts`.
Expected: backup file appears under `backups/`; `transaction_lines` contains `migrated-<id>` docs, categories `מגורים ובית` and `שונות`, one warning printed.

- [ ] **Step 8: Commit**

```bash
git add src/utils/migrateLegacyTransaction.ts src/__tests__/migrateLegacyTransaction.test.ts scripts/migrate-transactions.ts .gitignore
git commit -m "feat: transactions→transaction_lines migration with backup and category mapping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Note: when real April data is restored from any surviving backup/Drive export, the same script runs against it; the deleted cloud project means current emulator data is demo-only, so this is safe to iterate on.

---

### Task 5: Remove the dual reads — one canonical collection

**Files:**
- Modify: `src/components/Dashboard.tsx`, `src/components/AnnualReport.tsx`, `src/components/ExpensesBreakdown.tsx`, `src/components/CentralExpenseReport.tsx`, `src/services/SyncService.ts`, `src/utils/FileProcessor.ts` (these six are the only files matching `'transactions'` today)

**Interfaces:**
- Consumes: Task 4's migration (legacy data reachable in `transaction_lines`)
- Produces: exactly one Firestore collection name for transactions across `src/`: `transaction_lines`

- [ ] **Step 1: Inventory every legacy read**

Run: `grep -rn "'transactions'" src --include="*.ts" --include="*.tsx"`
Expected: hits only in the six files above. Record each hit (file:line) — that list is this task's checklist.

- [ ] **Step 2: Remove legacy reads file-by-file**

For each hit: if it is a *dual read* (querying both collections and merging), delete the `transactions` query and the merge, keep the `transaction_lines` path; if it is a *write*, redirect it to `transaction_lines` (SyncService/FileProcessor writes should already target `transaction_lines` — verify, don't assume). Preserve each component's existing filter/sort behavior; change only the data source. After each file: `npm run lint`.

- [ ] **Step 3: Verify no reference survives**

Run: `grep -rn "'transactions'" src --include="*.ts" --include="*.tsx"`
Expected: zero hits. (`scripts/migrate-transactions.ts` legitimately still references it.)

- [ ] **Step 4: Full suite + manual smoke**

Run: `npm run lint && npm test`. With emulators up and the Task 4 demo data present, open the Dashboard, פירוט הוצאות, and דוח שנתי screens.
Expected: tests pass; all three screens render the migrated demo rows; browser console free of Firestore errors.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "refactor: single canonical transaction_lines collection, dual reads removed

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `members` as a real collection

Today family members live as an array inside `settings/budgetConfig`, seeded with דויד / לילית / עומר. Stage 2 attaches auth users and permissions to members, so they must become documents.

**Files:**
- Create: `src/services/MembersService.ts`
- Test: `src/__tests__/MembersService.test.ts`
- Modify: every file that reads the members array from `settings/budgetConfig` (find them in Step 1)

**Interfaces:**
- Consumes: existing `db` export from `src/services/firebase.ts`
- Produces:

```ts
export interface Member {
  id: string;
  name: string;
  role: 'הורה' | 'ילד';
  color: string;        // stable per-member hex, spec §5.4
  groups: string[];     // group ids, spec §4 — empty for now, Stage 2 fills
  idNumber?: string;
  createdAt: string;    // ISO
  updatedAt: string;    // ISO
}
export function seedFromBudgetConfig(raw: unknown): Member[];       // pure — tested
export async function listMembers(): Promise<Member[]>;             // reads 'members' collection
export async function ensureSeeded(): Promise<void>;                // if collection empty, seed from settings/budgetConfig array (default: דויד/לילית/עומר), then write
```

- [ ] **Step 1: Inventory current member reads**

Run: `grep -rn "budgetConfig" src --include="*.ts" --include="*.tsx"`
Record every file reading the members array; those are the call sites Step 5 rewires.

- [ ] **Step 2: Write the failing test for the pure seed transform**

```ts
// src/__tests__/MembersService.test.ts
import { describe, expect, it } from 'vitest';
import { seedFromBudgetConfig } from '../services/MembersService';

describe('seedFromBudgetConfig', () => {
  it('converts the legacy array to Member docs with defaults', () => {
    const members = seedFromBudgetConfig({
      members: [
        { id: 'm1', name: 'דויד', role: 'הורה' },
        { id: 'm2', name: 'עומר', role: 'ילד', idNumber: '123' },
      ],
    });
    expect(members).toHaveLength(2);
    expect(members[0]).toMatchObject({ id: 'm1', name: 'דויד', role: 'הורה', groups: [] });
    expect(members[0].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(members[1].idNumber).toBe('123');
    expect(members[0].createdAt).toBeTypeOf('string');
  });

  it('assigns distinct colors to distinct members', () => {
    const members = seedFromBudgetConfig({
      members: [
        { id: 'a', name: 'א', role: 'הורה' },
        { id: 'b', name: 'ב', role: 'ילד' },
      ],
    });
    expect(members[0].color).not.toBe(members[1].color);
  });

  it('returns [] for malformed input instead of throwing', () => {
    expect(seedFromBudgetConfig(null)).toEqual([]);
    expect(seedFromBudgetConfig({})).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/MembersService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement MembersService**

```ts
// src/services/MembersService.ts
import { collection, doc, getDocs, writeBatch, getDoc } from 'firebase/firestore';
import { db } from './firebase'; // adjust to the actual export name

export interface Member {
  id: string;
  name: string;
  role: 'הורה' | 'ילד';
  color: string;
  groups: string[];
  idNumber?: string;
  createdAt: string;
  updatedAt: string;
}

// Aniccai member palette — stable order, spec §5.4 (one fixed color per member everywhere)
const MEMBER_COLORS = ['#1F4E78', '#17C3B2', '#E07A5F', '#8E7DBE', '#3D8361', '#C98A2B',
  '#5B7DB1', '#B5656F', '#4F9D9D', '#7A6C5D', '#9A4E8A', '#647D2F',
  '#2B6CB0', '#B7791F', '#553C9A', '#276749', '#97266D', '#2C7A7B', '#975A16', '#702459'];

export function seedFromBudgetConfig(raw: unknown): Member[] {
  if (!raw || typeof raw !== 'object') return [];
  const arr = (raw as { members?: unknown }).members;
  if (!Array.isArray(arr)) return [];
  const now = new Date().toISOString();
  return arr.flatMap((m, i) => {
    if (!m || typeof m !== 'object') return [];
    const { id, name, role, idNumber } = m as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string') return [];
    if (role !== 'הורה' && role !== 'ילד') return [];
    return [{
      id, name, role,
      color: MEMBER_COLORS[i % MEMBER_COLORS.length],
      groups: [],
      ...(typeof idNumber === 'string' ? { idNumber } : {}),
      createdAt: now, updatedAt: now,
    }];
  });
}

export async function listMembers(): Promise<Member[]> {
  const snap = await getDocs(collection(db, 'members'));
  return snap.docs.map(d => d.data() as Member);
}

export async function ensureSeeded(): Promise<void> {
  const existing = await getDocs(collection(db, 'members'));
  if (!existing.empty) return;
  const cfg = await getDoc(doc(db, 'settings', 'budgetConfig'));
  const members = seedFromBudgetConfig(cfg.exists() ? cfg.data() : null);
  if (members.length === 0) return;
  const batch = writeBatch(db);
  members.forEach(m => batch.set(doc(db, 'members', m.id), m));
  await batch.commit();
}
```

- [ ] **Step 5: Rewire call sites**

For each file from Step 1: replace the read of the members array with `listMembers()` (call `ensureSeeded()` once at app bootstrap — in `App.tsx`'s existing startup effect — not in every component). Keep each component's rendering unchanged; if the members fetch fails, the component must show its error state, not an empty member list (Global Constraints).

- [ ] **Step 6: Full verification**

Run: `npm run lint && npm test`
Expected: ALL PASS. With emulators up: fresh emulator DB + app boot creates 3 `members` docs (דויד/לילית/עומר — the existing seed defaults land via `settings/budgetConfig` seeding, then `ensureSeeded()` mirrors them); the member filter on the Dashboard still lists them.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat: members as a first-class collection with seeded palette

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Stage-1 Done Criteria

- `npm run emu` + `npm run dev:local` = the whole app runs with zero cloud dependencies.
- `git status` clean; every commit green on lint + tests.
- One transactions collection (`transaction_lines`), members are documents, a JSON backup exists for anything the migration touched.
- Demo to David: the app running locally in his browser, showing migrated demo data — the "before we add anything new, the house is standing again" checkpoint.
