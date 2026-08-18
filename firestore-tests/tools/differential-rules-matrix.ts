/**
 * THE DIFFERENTIAL RULES MATRIX — v2.
 *
 * Runs one rules file against a fixed grid of sessions × collections × operations on a live
 * emulator and writes ALLOW/DENY per cell. Two runs, two rules files, one diff: every cell that
 * WIDENED and every cell that NARROWED, so a rules change can be reviewed by what it actually
 * decides rather than by what its diff looks like.
 *
 *   npx tsx firestore-tests/tools/differential-rules-matrix.ts <rulesFile> <projectId> <outJson>
 *   npx tsx firestore-tests/tools/differential-rules-matrix.ts --diff <beforeJson> <afterJson>
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * !! WHY v2 EXISTS: v1 WAS BLIND TO THE RULE THIS STAGE MOST DEPENDS ON
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * v1 lived in a reviewer's scratchpad and had been trusted FOUR TIMES on this project. The T3
 * review then deleted BOTH of D21(d)'s immutability conjuncts — the entire reason the backfill has
 * to run on the Admin SDK — and v1 reported **1602 cells compared, 1602 identical, 0 different.**
 *
 * Four structural causes, all fixed here, none of them a bug in the diffing:
 *
 *  1. ONE BENIGN PATCH PER COLLECTION. `transaction_lines`' patch was `{ description: 'd2' }`,
 *     which touches neither `period` nor `ownerId`, so no cell in the grid could observe a rule
 *     about them. → A PER-FIELD PATCH AXIS: every field of the fixture is patched on its own doc,
 *     plus every field the fixture deliberately LACKS is added on its own doc, because
 *     `.get(field, null)` distinguishes changing a field from adding one and only the second shape
 *     can see it.
 *
 *  2. THE HARNESS ISSUED ZERO QUERIES. Firestore verifies a `list` rule SYMBOLICALLY against the
 *     QUERY'S CONSTRAINTS, not against documents, so the entire list path — which is what T3's
 *     read path IS — was invisible to a grid built from `getDoc`. → A QUERY AXIS: an unconstrained
 *     scan and an owner-scoped one per collection, plus D21(b)'s exact `ownerId` + 7-value
 *     `period in` shape.
 *
 *  3. `SETTINGS_DOCS` OMITTED `migrationState` — the completion marker, the document T5's whole
 *     correctness rests on, and the one `settings` doc whose rule this stage changes.
 *
 *  4. ONE FIXTURE BODY PER COLLECTION, so a value-dependent validator was only ever exercised on
 *     its valid branch. → SEVERAL BODIES PER COLLECTION wherever a validator branches on a value,
 *     each named, each its own cell.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * v2.1 — THE SIXTH BLINDNESS: THERE WAS NO FIELD-DELETION AXIS (T4 review F-3)
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * v2 patched three ways — `set:` a same-type value, `type:` a different-type value, `add:` a field
 * the fixture lacks — and every one of them WRITES something. None of them took a field AWAY. That
 * is the direct cause of T4 review F-1 going unmeasured: `request.resource.data.get('date','')` is
 * satisfied by ABSENCE, so a `deleteField()` sailed through the type check written to stop that
 * field being unreadable, and 7209 cells could not see it because not one of them deleted a field.
 *
 * → A `del:<field>` AXIS, on every field of `bodies[0]`. Its cells are the only ones that can
 *   distinguish "the rule constrains the field's VALUE" from "the rule constrains the field".
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * !! WHAT THIS HARNESS STILL CANNOT SEE — READ THIS BEFORE TRUSTING A RUN
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * v1 disclosed one limitation ("cannot see D21(a)") and v2 closed it — and then declared none of
 * its own, which is how a tool that has been trusted four times gets trusted a fifth. A tool that
 * states no limits reads as complete. These are v2.1's, and each one is a real hole, not a caveat:
 *
 *  L1. THE GRID IS A HAND-WRITTEN LIST. A collection in `firestore.rules` that is not in
 *      `COLLECTIONS`, a `settings` document id not in `SETTINGS_DOCS`, a field not in a fixture
 *      body, a query shape not in `queries` — every one of those is INVISIBLE, and the diff
 *      reports it as "0 different", which is indistinguishable from "no change". `migrationState`
 *      was missing for four reviews for exactly this reason.
 *  L2. ONE BIT PER CELL. A cell records ALLOW or DENY and nothing else. A rules change that alters
 *      WHICH DOCUMENTS a query returns, rather than whether the query is permitted, is invisible:
 *      `getDocs` succeeding is one bit whether it returns three rows or none. D21(a)'s widening is
 *      visible only because it flipped a `list` from DENY to ALLOW.
 *  L3. NO NESTED-FIELD PATCHES. Every patch is a top-level key. `updateDoc(ref, {'a.b': v})` and
 *      the map-merge shapes are never issued, which matters most for `settings`, whose documents
 *      are maps of maps — the completion marker itself is a nested object.
 *  L4. TWO CLAIMS, TWO OWNERS, NO GROUPS. Sessions carry `role` and `memberId` only, and every
 *      seeded member has `groups: []`. A rule keyed on any other claim, on `sign_in_provider`, on
 *      `email_verified`, or on GROUP membership (`scope: 'group'` permissions are a real shape in
 *      this app) has no cell that can reach it.
 *  L5. NO TIME AXIS. Every cell runs at "now", so a `request.time`-dependent rule grades
 *      identically in both runs of a diff by construction.
 *  L6. PER-DOCUMENT ONLY. No transactions, no batched writes, no `getAfter()` chains — so a rule
 *      whose correctness depends on two documents changing together is graded on neither.
 *  L7. IT CANNOT SAY WHICH RULE GRANTED. Firestore ORs across every matching `match` block; a cell
 *      reports the OR. A newly-added block that is fully shadowed by an existing one shows up as
 *      "0 different" — correct about access, silent about dead rules.
 *
 * Kept from v1 unchanged: the session list, the ALLOW/DENY-per-cell shape, and the property that
 * makes the whole thing worth running — the grid is written independently of the rules file, so it
 * cannot be tuned to agree with whatever the rules currently say.
 *
 * NOT a vitest file (no `.test.ts`), deliberately: it is a two-run comparison tool, and a single
 * run of it asserts nothing at all. `vitest.rules.config.ts` collects `firestore-tests/**\/*.test.ts`.
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

/**
 * The db handle `@firebase/rules-unit-testing` hands back. Inferred rather than imported as
 * `Firestore`: the library returns the compat type, which the modular `collection()`/`doc()`
 * helpers accept but which is not assignable to the modular `Firestore` interface.
 */
type MatrixDb = ReturnType<ReturnType<RulesTestEnvironment['unauthenticatedContext']>['firestore']>;

const iso = '2026-08-18T00:00:00.000Z';

const F = (v: string) => ({ view: v, edit: v });

interface Session {
  key: string;
  kind: 'anon' | 'claimless' | 'auth';
  uid?: string;
  memberId?: string;
  role?: string;
  name?: string;
  perms?: Record<string, { view: string; edit: string }> | null;
}

/** Unchanged from v1 — the same eight session types plus anonymous. */
const SESSIONS: Session[] = [
  { key: 'anon', kind: 'anon' },
  { key: 'claimless', kind: 'claimless' },
  { key: 'david-super', kind: 'auth', uid: 'u-david', memberId: 'david-levy', role: 'super-admin', name: 'David', perms: null },
  { key: 'lilit-parent', kind: 'auth', uid: 'u-lilit', memberId: 'lilit-levy', role: 'parent', name: 'Lilit', perms: null },
  { key: 'omer-zero', kind: 'auth', uid: 'u-omer', memberId: 'omer-levy', role: 'member', name: 'Omer', perms: null },
  { key: 'maya-allfamily', kind: 'auth', uid: 'u-maya', memberId: 'maya-levy', role: 'member', name: 'Maya',
    perms: { expenses: F('family'), income: F('family'), investments: F('family'), goals: F('family'), accounts: F('family'), recurring: F('family'), loans: F('family'), insurances: F('family'), forecast: F('family') } },
  { key: 'noa-forecastonly', kind: 'auth', uid: 'u-noa', memberId: 'noa-levy', role: 'member', name: 'Noa',
    perms: { expenses: F('family'), forecast: F('family'), loans: F('none'), insurances: F('none'), recurring: F('none') } },
  { key: 'raz-expown', kind: 'auth', uid: 'u-raz', memberId: 'raz-levy', role: 'member', name: 'Raz',
    perms: { expenses: F('own') } },
  { key: 'ido-allown', kind: 'auth', uid: 'u-ido', memberId: 'ido-levy', role: 'member', name: 'Ido',
    perms: { expenses: F('own'), income: F('own'), investments: F('own'), goals: F('own'), accounts: F('own'), recurring: F('own'), loans: F('own'), insurances: F('own'), forecast: F('own') } },
];

const ZED = { memberId: 'zed-levy', name: 'Zed' };

type Body = (ownerId: string, ownerName: string) => Record<string, unknown>;

interface CollectionSpec {
  /**
   * Named fixture bodies. `bodies[0]` is the one the patch axis is derived from. More than one
   * wherever the collection's validator branches on a VALUE rather than on the caller — v1's
   * single body meant those branches were never reached.
   */
  bodies: Array<{ name: string; body: Body }>;
  /**
   * Fields the patch axis must ADD rather than change, because `bodies[0]` deliberately lacks
   * them. `resource.data.get(f, null) == request.resource.data.get(f, null)` allows a document
   * without the field to stay without it and denies ADDING it — two different cells, and only the
   * second one can see the second half of the rule.
   */
  addFields?: Record<string, unknown>;
  /** Query shapes to verify the `list` rule symbolically. `me` is the acting session's memberId. */
  queries?: Array<{ name: string; build: (db: MatrixDb, me: string) => ReturnType<typeof query> }>;
}

const SIX_PERIODS_PLUS_UNKNOWN = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', 'unknown'];

/** The `list` shapes every owned collection should be probed with, plus a bare scan. */
const ownedQueries = (col: string): CollectionSpec['queries'] => [
  { name: 'bare', build: (db) => query(collection(db, col)) },
  { name: 'ownerId', build: (db, me) => query(collection(db, col), where('ownerId', '==', me)) },
];

const COLLECTIONS: Record<string, CollectionSpec> = {
  members: {
    bodies: [
      { name: 'valid', body: (o, n) => ({ name: n, role: 'הורה', color: '#112233', groups: [], createdAt: iso, updatedAt: iso }) },
      // Value-dependent: `role in ['הורה','ילד']` and the `#RRGGBB` colour regex.
      { name: 'bad-role', body: (o, n) => ({ name: n, role: 'admin', color: '#112233', groups: [], createdAt: iso, updatedAt: iso }) },
      { name: 'bad-color', body: (o, n) => ({ name: n, role: 'הורה', color: 'blue', groups: [], createdAt: iso, updatedAt: iso }) },
    ],
    queries: [{ name: 'bare', build: (db) => query(collection(db, 'members')) }],
  },
  groups: {
    bodies: [
      { name: 'valid', body: (o, n) => ({ name: 'g-' + n, memberIds: [], createdAt: iso, updatedAt: iso }) },
      { name: 'empty-name', body: () => ({ name: '', memberIds: [], createdAt: iso, updatedAt: iso }) },
    ],
    queries: [{ name: 'bare', build: (db) => query(collection(db, 'groups')) }],
  },
  permissions: {
    bodies: [
      { name: 'valid', body: (o) => ({ scope: 'member', targetId: o, modules: {}, updatedAt: iso, updatedBy: o }) },
      // Value-dependent: `scope in ['group','member']`, and the I3 anti-spoof `updatedBy` binding.
      { name: 'bad-scope', body: (o) => ({ scope: 'household', targetId: o, modules: {}, updatedAt: iso, updatedBy: o }) },
      { name: 'spoofed-updatedBy', body: (o) => ({ scope: 'member', targetId: o, modules: {}, updatedAt: iso, updatedBy: ZED.memberId }) },
    ],
    queries: [{ name: 'bare', build: (db) => query(collection(db, 'permissions')) }],
  },
  audit_log: {
    bodies: [
      { name: 'valid', body: (o) => ({ actorMemberId: o, action: 'x', target: 't', at: iso }) },
      // Value-dependent: the anti-spoof `actorMemberId == memberId()` binding.
      { name: 'spoofed-actor', body: () => ({ actorMemberId: ZED.memberId, action: 'x', target: 't', at: iso }) },
    ],
    queries: [{ name: 'bare', build: (db) => query(collection(db, 'audit_log')) }],
  },
  transaction_lines: {
    bodies: [
      { name: 'stamped', body: (o, n) => ({ owner: n, ownerId: o, amount: 100, date: '2026-08-01', period: '2026-08', description: 'd' }) },
      // The pre-backfill state — no `period`, no `ownerId`. This is the body the `addFields` axis
      // needs, and D21(a)'s `owner`-only read disjunct is the only thing that can reach it.
      { name: 'unstamped', body: (o, n) => ({ owner: n, amount: 100, date: '2026-08-01', description: 'd' }) },
      // Value-dependent: `amount > 0`, `date.size() == 10`, and (T3 review F1) `owner is string`.
      { name: 'zero-amount', body: (o, n) => ({ owner: n, ownerId: o, amount: 0, date: '2026-08-01', period: '2026-08' }) },
      { name: 'short-date', body: (o, n) => ({ owner: n, ownerId: o, amount: 100, date: '2026-8-1', period: '2026-08' }) },
      { name: 'numeric-owner', body: (o) => ({ owner: 12345, ownerId: o, amount: 100, date: '2026-08-01', period: '2026-08' }) },
    ],
    queries: [
      { name: 'bare', build: (db) => query(collection(db, 'transaction_lines')) },
      { name: 'ownerId', build: (db, me) => query(collection(db, 'transaction_lines'), where('ownerId', '==', me)) },
      { name: 'period-in', build: (db) => query(collection(db, 'transaction_lines'), where('period', 'in', SIX_PERIODS_PLUS_UNKNOWN)) },
      // D21(b)'s exact shape — the one the app issues, and the one whose acceptance is the whole
      // read path. `||` absorbing an error on one operand is what makes it verify.
      { name: 'ownerId+period-in', build: (db, me) => query(collection(db, 'transaction_lines'), where('ownerId', '==', me), where('period', 'in', SIX_PERIODS_PLUS_UNKNOWN)) },
      { name: 'owner-name', build: (db, me) => query(collection(db, 'transaction_lines'), where('owner', '==', me)) },
    ],
  },
  incomes: {
    bodies: [
      { name: 'valid', body: (o, n) => ({ owner: n, ownerId: o, amount: 100, month: 8, year: 2026, period: '2026-08' }) },
      { name: 'zero-amount', body: (o, n) => ({ owner: n, ownerId: o, amount: 0, month: 8, year: 2026 }) },
    ],
    queries: ownedQueries('incomes'),
  },
  investments: { bodies: [{ name: 'valid', body: (o, n) => ({ owner: n, ownerId: o, value: 100 }) }], queries: ownedQueries('investments') },
  goals: { bodies: [{ name: 'valid', body: (o, n) => ({ owner: n, ownerId: o, target: 100 }) }], queries: ownedQueries('goals') },
  accounts: {
    bodies: [
      { name: 'valid', body: (o, n) => ({ name: 'acc', type: 'bank', ownerId: o, owner: n, balance: 10, balanceUpdatedAt: iso, status: 'active', createdAt: iso, updatedAt: iso }) },
      { name: 'bad-type', body: (o, n) => ({ name: 'acc', type: 'mattress', ownerId: o, owner: n, balance: 10, balanceUpdatedAt: iso, status: 'active', createdAt: iso, updatedAt: iso }) },
    ],
    queries: ownedQueries('accounts'),
  },
  recurring: {
    bodies: [
      { name: 'valid', body: (o, n) => ({ kind: 'expense', description: 'r', amount: 10, chargeDay: 5, ownerId: o, owner: n, status: 'active', startDate: '2026-01-01', createdAt: iso, updatedAt: iso }) },
      { name: 'bad-chargeDay', body: (o, n) => ({ kind: 'expense', description: 'r', amount: 10, chargeDay: 45, ownerId: o, owner: n, status: 'active', startDate: '2026-01-01', createdAt: iso, updatedAt: iso }) },
    ],
    queries: ownedQueries('recurring'),
  },
  loans: {
    bodies: [
      { name: 'valid', body: (o, n) => ({ name: 'l', loanType: 'personal', ownerId: o, owner: n, principal: 10, balance: 10, interestRate: 1, monthlyPayment: 1, startDate: '2026-01-01', endDate: '2027-01-01', status: 'active', createdAt: iso, updatedAt: iso }) },
      { name: 'bad-loanType', body: (o, n) => ({ name: 'l', loanType: 'shark', ownerId: o, owner: n, principal: 10, balance: 10, interestRate: 1, monthlyPayment: 1, startDate: '2026-01-01', endDate: '2027-01-01', status: 'active', createdAt: iso, updatedAt: iso }) },
    ],
    queries: ownedQueries('loans'),
  },
  insurances: {
    bodies: [
      { name: 'valid', body: (o, n) => ({ type: 'car', provider: 'p', insuredMemberId: o, ownerId: o, owner: n, premium: 10, premiumFrequency: 'monthly', coverages: [], renewalDate: '2027-01-01', status: 'active', createdAt: iso, updatedAt: iso }) },
      { name: 'bad-frequency', body: (o, n) => ({ type: 'car', provider: 'p', insuredMemberId: o, ownerId: o, owner: n, premium: 10, premiumFrequency: 'fortnightly', coverages: [], renewalDate: '2027-01-01', status: 'active', createdAt: iso, updatedAt: iso }) },
    ],
    queries: ownedQueries('insurances'),
  },
  forecast_assumptions: {
    bodies: [
      { name: 'category', body: (o, n) => ({ ownerId: o, owner: n, scopeKind: 'category', scopeId: 'cat', fromPeriod: '2026-09', amountILS: 100, reasonHe: 'סיבה', source: 'user', status: 'active', createdAt: iso, updatedAt: iso }) },
      // Value-dependent, and each branch is a different rule: the scope's own module gates
      // authorship, `source` is the Stage 8 seam, `factor` is bounded, and `fromPeriod` is matched
      // against a real YYYY-MM pattern rather than a length.
      { name: 'loan-scope', body: (o, n) => ({ ownerId: o, owner: n, scopeKind: 'loan', scopeId: 'l1', fromPeriod: '2026-09', amountILS: 100, reasonHe: 'סיבה', source: 'user', status: 'active', createdAt: iso, updatedAt: iso }) },
      { name: 'seasonality-in-range', body: (o, n) => ({ ownerId: o, owner: n, scopeKind: 'seasonality', scopeId: 'cat', fromPeriod: '2026-09', factor: 1.2, reasonHe: 'סיבה', source: 'user', status: 'active', createdAt: iso, updatedAt: iso }) },
      { name: 'seasonality-out-of-range', body: (o, n) => ({ ownerId: o, owner: n, scopeKind: 'seasonality', scopeId: 'cat', fromPeriod: '2026-09', factor: 99, reasonHe: 'סיבה', source: 'user', status: 'active', createdAt: iso, updatedAt: iso }) },
      { name: 'source-insight', body: (o, n) => ({ ownerId: o, owner: n, scopeKind: 'category', scopeId: 'cat', fromPeriod: '2026-09', amountILS: 100, reasonHe: 'סיבה', source: 'insight', status: 'active', createdAt: iso, updatedAt: iso }) },
      { name: 'bad-period', body: (o, n) => ({ ownerId: o, owner: n, scopeKind: 'category', scopeId: 'cat', fromPeriod: '9999-99-99', amountILS: 100, reasonHe: 'סיבה', source: 'user', status: 'active', createdAt: iso, updatedAt: iso }) },
    ],
    queries: [
      { name: 'bare', build: (db) => query(collection(db, 'forecast_assumptions')) },
      { name: 'ownerId', build: (db, me) => query(collection(db, 'forecast_assumptions'), where('ownerId', '==', me)) },
    ],
  },
  categories: { bodies: [{ name: 'valid', body: (o, n) => ({ name: 'c', owner: n, ownerId: o }) }], queries: [{ name: 'bare', build: (db) => query(collection(db, 'categories')) }] },
  sync_logs: { bodies: [{ name: 'valid', body: (o, n) => ({ at: iso, owner: n, ownerId: o }) }], queries: [{ name: 'bare', build: (db) => query(collection(db, 'sync_logs')) }] },
  documents: { bodies: [{ name: 'valid', body: (o, n) => ({ name: 'd', owner: n, ownerId: o }) }], queries: [{ name: 'bare', build: (db) => query(collection(db, 'documents')) }] },
  transactions: { bodies: [{ name: 'valid', body: (o, n) => ({ owner: n, ownerId: o, amount: 1 }) }], queries: [{ name: 'bare', build: (db) => query(collection(db, 'transactions')) }] },
};

/** Fields the fixture deliberately lacks, per collection — the ADD half of the patch axis. */
COLLECTIONS.transaction_lines.addFields = { period: '2099-01', ownerId: 'someone-else', category: 'שונות' };
COLLECTIONS.forecast_assumptions.addFields = { toPeriod: '2027-01', factor: 1.5 };
COLLECTIONS.accounts.addFields = { institution: 'bank' };

/**
 * `settings` documents. `migrationState` is the one v1 omitted, and it is the completion marker
 * D21(d)'s refusal — and therefore the whole statistical layer — depends on.
 */
const SETTINGS_DOCS = ['ecosystem', 'budgetConfig', 'aiCostConfig', 'migrationState', 'syncState', 'other'];

/** Patch values per settings doc, so a value-dependent validator (`aiCostConfig`) is exercised. */
const SETTINGS_PATCHES: Array<{ name: string; patch: Record<string, unknown> }> = [
  { name: 'ceiling-valid', patch: { monthlyCeilingILS: 7 } },
  { name: 'ceiling-negative', patch: { monthlyCeilingILS: -1 } },
  // v2.1's deletion axis, on the settings half too — the seeded doc carries both of these.
  { name: 'del:monthlyCeilingILS', patch: { monthlyCeilingILS: deleteField() } },
  { name: 'del:v', patch: { v: deleteField() } },
  { name: 'marker', patch: { transactionPeriodBackfill: { completedAt: iso, rowsStamped: 3, rowsUnknown: 0, sourceCommit: 'a86c4e9', lastRunAt: iso, lastRunCommit: 'a86c4e9', transactionRows: 3 } } },
];

/**
 * Every patch cell for one collection, on THREE axes:
 *
 *   `set:<f>`  — a different value of the SAME type. Sees immutability rules (D21d).
 *   `type:<f>` — a value of a DIFFERENT type. Sees `is string`/`is number` rules, which a
 *                same-type change cannot: v1's `{ description: 'd2' }` could never have observed
 *                T3 review F1's `request.resource.data.get('date','') is string`.
 *   `add:<f>`  — a field the fixture LACKS. `.get(f, null) == .get(f, null)` allows a row without
 *                the field to stay without it and DENIES adding it; only this shape sees the
 *                second half.
 *   `del:<f>`  — the field REMOVED (v2.1, T4 review F-3). The only axis that can tell a rule
 *                constraining a field's VALUE from a rule constraining the FIELD: every check of
 *                the form `request.resource.data.get(f, <default>) is <type>` is satisfied by
 *                absence, so all three axes above pass it and only this one does not.
 */
function patchAxis(spec: CollectionSpec): Array<{ name: string; patch: Record<string, unknown> }> {
  const base = spec.bodies[0].body('owner-placeholder', 'Owner Placeholder');
  const axis: Array<{ name: string; patch: Record<string, unknown> }> = [];
  for (const [field, value] of Object.entries(base)) {
    axis.push({ name: `set:${field}`, patch: { [field]: mutate(value) } });
    axis.push({ name: `type:${field}`, patch: { [field]: retype(value) } });
    axis.push({ name: `del:${field}`, patch: { [field]: deleteField() } });
  }
  for (const [field, value] of Object.entries(spec.addFields ?? {})) {
    axis.push({ name: `add:${field}`, patch: { [field]: value } });
  }
  return axis;
}

/** A different value of the same TYPE — so the cell tests the rule about the field, not about types. */
function mutate(value: unknown): unknown {
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'boolean') return !value;
  if (Array.isArray(value)) return [...value, 'extra'];
  if (value !== null && typeof value === 'object') return { ...(value as Record<string, unknown>), extra: 1 };
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return '2026-09-02';
    if (/^\d{4}-\d{2}$/.test(value)) return '2026-10';
    return `${value}-changed`;
  }
  return 'changed';
}

/** A value of a DIFFERENT type. `12345` for strings — the literal value T0 probed a parent writing. */
function retype(value: unknown): unknown {
  return typeof value === 'string' ? 12345 : 'not-the-right-type';
}

const cellKey = (parts: string[]): string => parts.join('|');

async function seed(env: RulesTestEnvironment, docs: Array<{ col: string; id: string; body: Record<string, unknown> }>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (let i = 0; i < docs.length; i += 400) {
      const batch = writeBatch(db);
      for (const d of docs.slice(i, i + 400)) batch.set(doc(db, d.col, d.id), d.body);
      await batch.commit();
    }
  });
}

async function reseedSetting(env: RulesTestEnvironment, docId: string): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'settings', docId), { v: 1, monthlyCeilingILS: 5 });
  });
}

async function runMatrix(rulesFile: string, projectId: string, outFile: string): Promise<void> {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync(rulesFile, 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  await env.clearFirestore();

  const toSeed: Array<{ col: string; id: string; body: Record<string, unknown> }> = [];
  for (const s of SESSIONS) {
    if (s.kind !== 'auth') continue;
    toSeed.push({
      col: 'members',
      id: s.memberId!,
      body: { name: s.name, role: 'הורה', color: '#112233', groups: [], createdAt: iso, updatedAt: iso, ...(s.perms ? { resolvedPermissions: s.perms } : {}) },
    });
  }
  toSeed.push({ col: 'members', id: ZED.memberId, body: { name: ZED.name, role: 'הורה', color: '#112233', groups: [], createdAt: iso, updatedAt: iso } });

  for (const [col, spec] of Object.entries(COLLECTIONS)) {
    const axis = patchAxis(spec);
    for (const s of SESSIONS) {
      const ownerId = s.kind === 'auth' ? s.memberId! : 'nobody';
      const ownerName = s.kind === 'auth' ? s.name! : 'Nobody';
      for (const [who, oid, onm] of [['own', ownerId, ownerName], ['other', ZED.memberId, ZED.name]] as const) {
        for (let b = 0; b < spec.bodies.length; b += 1) {
          toSeed.push({ col, id: `${s.key}-read-${who}-b${b}`, body: spec.bodies[b].body(oid, onm) });
          toSeed.push({ col, id: `${s.key}-delete-${who}-b${b}`, body: spec.bodies[b].body(oid, onm) });
          toSeed.push({ col, id: `${s.key}-setover-${who}-b${b}`, body: spec.bodies[b].body(oid, onm) });
        }
        // One document per patch cell, so a successful patch cannot change what the next one sees.
        for (const p of axis) {
          toSeed.push({ col, id: `${s.key}-patch-${who}-${p.name}`, body: spec.bodies[0].body(oid, onm) });
        }
      }
    }
  }
  // !! THE SETTINGS RULE IS KEYED ON THE DOCUMENT ID, so a cell must act on the REAL id.
  // v1 patched `${d}-u` and this harness first copied that, which meant every `settings` write
  // cell fell through to the `else` branch — `migrationState` and `aiCostConfig` were graded as if
  // they were `other`. The doc is re-seeded between cells instead (see below), which is what the
  // suffix trick was avoiding.
  for (const d of SETTINGS_DOCS) toSeed.push({ col: 'settings', id: d, body: { v: 1, monthlyCeilingILS: 5 } });
  await seed(env, toSeed);

  const ctxOf = (s: Session) =>
    s.kind === 'anon' ? env.unauthenticatedContext()
    : s.kind === 'claimless' ? env.authenticatedContext('u-claimless', {})
    : env.authenticatedContext(s.uid!, { role: s.role, memberId: s.memberId });

  const results: Record<string, string> = {};
  const run = async (key: string, fn: () => Promise<unknown>): Promise<void> => {
    try { await fn(); results[key] = 'ALLOW'; } catch { results[key] = 'DENY'; }
  };

  for (const s of SESSIONS) {
    const db = ctxOf(s).firestore();
    const me = s.kind === 'auth' ? s.memberId! : 'nobody';
    const myName = s.kind === 'auth' ? s.name! : 'Nobody';
    for (const [col, spec] of Object.entries(COLLECTIONS)) {
      const axis = patchAxis(spec);
      for (const [who, oid, onm] of [['own', me, myName], ['other', ZED.memberId, ZED.name]] as const) {
        for (let b = 0; b < spec.bodies.length; b += 1) {
          const name = spec.bodies[b].name;
          await run(cellKey([col, s.key, `read:${name}`, who]), () => getDoc(doc(db, col, `${s.key}-read-${who}-b${b}`)));
          await run(cellKey([col, s.key, `create:${name}`, who]), () => setDoc(doc(db, col, `${s.key}-create-${who}-b${b}`), spec.bodies[b].body(oid, onm)));
          await run(cellKey([col, s.key, `delete:${name}`, who]), () => deleteDoc(doc(db, col, `${s.key}-delete-${who}-b${b}`)));
          await run(cellKey([col, s.key, `setover:${name}`, who]), () => setDoc(doc(db, col, `${s.key}-setover-${who}-b${b}`), spec.bodies[b].body(oid, onm)));
        }
        for (const p of axis) {
          await run(cellKey([col, s.key, `patch:${p.name}`, who]), () => updateDoc(doc(db, col, `${s.key}-patch-${who}-${p.name}`), p.patch));
        }
      }
      for (const q of spec.queries ?? []) {
        await run(cellKey([col, s.key, `list:${q.name}`, '-']), () => getDocs(q.build(db, me)));
      }
    }
    for (const d of SETTINGS_DOCS) {
      await run(cellKey([`settings/${d}`, s.key, 'read', '-']), () => getDoc(doc(db, 'settings', d)));
      for (const p of SETTINGS_PATCHES) {
        await reseedSetting(env, d);
        await run(cellKey([`settings/${d}`, s.key, `patch:${p.name}`, '-']), () => updateDoc(doc(db, 'settings', d), p.patch));
        await reseedSetting(env, d);
        await run(cellKey([`settings/${d}`, s.key, `create:${p.name}`, '-']), () => setDoc(doc(db, 'settings', d), { v: 1, ...p.patch }));
      }
      await reseedSetting(env, d);
      await run(cellKey([`settings/${d}`, s.key, 'delete', '-']), () => deleteDoc(doc(db, 'settings', d)));
    }
  }

  await env.cleanup();
  writeFileSync(outFile, JSON.stringify(results, null, 1));
  const allow = Object.values(results).filter((v) => v === 'ALLOW').length;
  console.log(`${outFile}: ${Object.keys(results).length} cells, ALLOW=${allow}, DENY=${Object.keys(results).length - allow}`);
}

function diff(beforeFile: string, afterFile: string): void {
  const before = JSON.parse(readFileSync(beforeFile, 'utf8')) as Record<string, string>;
  const after = JSON.parse(readFileSync(afterFile, 'utf8')) as Record<string, string>;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const widened: string[] = [];
  const narrowed: string[] = [];
  let identical = 0;
  for (const k of keys) {
    const b = before[k] ?? 'MISSING';
    const a = after[k] ?? 'MISSING';
    if (a === b) { identical += 1; continue; }
    if (b === 'DENY' && a === 'ALLOW') widened.push(k);
    else narrowed.push(`${k}  ${b} -> ${a}`);
  }
  console.log(`cells compared: ${keys.length}   identical: ${identical}   widened: ${widened.length}   narrowed/other: ${narrowed.length}`);
  if (widened.length > 0) {
    console.log('\n!! WIDENED (a session may now do something it could not):');
    for (const k of widened) console.log(`  + ${k}`);
  }
  if (narrowed.length > 0) {
    console.log('\nNARROWED / changed:');
    for (const k of narrowed) console.log(`  - ${k}`);
  }
}

const argv = process.argv.slice(2);
if (argv[0] === '--diff') {
  diff(argv[1], argv[2]);
} else {
  const [rulesFile, projectId, outFile] = argv;
  runMatrix(rulesFile, projectId, outFile).catch((e) => { console.error(e); process.exit(1); });
}
