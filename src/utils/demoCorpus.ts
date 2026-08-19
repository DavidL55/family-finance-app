// src/utils/demoCorpus.ts — Stage 7 T4 (D27). THE DEMO-DATA GENERATOR, AS A PURE FUNCTION.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS IS A PREREQUISITE FOR EVIDENCE AND NOT A CONVENIENCE
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// T0 measured the entire ledger at FOURTEEN DOCUMENTS: `transaction_lines` 3 (all ISO, all inside
// one week of March 2026), legacy `transactions` 3, `members` 3, `permissions` 1,
// `settings/budgetConfig` 1 (`{"members": []}`), `audit_log` 2, one chat session. `recurring`,
// `loans`, `insurances`, `incomes`, `goals` and `accounts` DO NOT EXIST AS COLLECTIONS — not
// "are empty", do not exist. With three rows in one month, cold start is not an edge case; it is
// the only state that renders on real data at all.
//
// So the statistical layer, the uncertainty band, D26's cold-start table, the 20-member success
// metric and four otherwise-live guard paths have NO NON-SYNTHETIC CORPUS TO BE TESTED AGAINST.
// R8 (as corrected by T0) names the four paths that are reachable ONLY through this module:
// `period: 'unknown'`, `ownerId: 'unknown'`, D10's instalment-`null` branch, and D33's row ceiling.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY IT IS PURE, AND WHY THE SCRIPT IS A SHELL AROUND IT
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// `scripts/backfill-transaction-periods.ts` set the precedent T3's ledger states plainly: a `tsx`
// entrypoint is the one place NO SUITE IN THIS REPO EXECUTES — the root suite mocks Firestore, the
// rules suite runs Rules, and neither runs a script. Every decision about the corpus therefore
// lives HERE, where it is ordinary tested code, and `scripts/seed-demo-finances.ts` keeps only
// what is genuinely I/O: connect, refuse the wrong project, write, report.
//
// It imports nothing from `firebase/*`, `firebase-admin/*` or `src/services/*` for the same
// reason `backfillPlan.ts` does not: the Admin-SDK script runs under plain Node, where
// `src/services/firebase.ts` cannot even be imported (it reads `import.meta.env`).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// !! DETERMINISM IS THE PROPERTY THIS FILE EXISTS TO HAVE
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Every test downstream of T4 is built on this corpus. A generator whose output moves between runs
// makes all of them flaky, and this project has already spent real time on flakes that presented
// as assertion failures (T1's tree-walk timeouts; T2's own probe file, removed before commit).
// Three rules, all enforced by `demoCorpus.test.ts`:
//
//   1. NO CLOCK. Nothing here calls `new Date()` or `Date.now()`. The corpus's notion of "today"
//      is `options.asOfDate`, a parameter with a NAMED default, and every date in the output is
//      derived from it by string arithmetic — the same discipline `periodMath.ts` is held to.
//   2. NO UNSEEDED RANDOMNESS. `Math.random` is never called. Amount jitter comes from a seeded
//      mulberry32 whose seed is a parameter, drawn in a FIXED ORDER.
//   3. NO ITERATION-ORDER DEPENDENCE. Document ids are derived from the data, never from a
//      counter that a re-ordering would shift, and every collection is emitted in a stated order.
//
// `buildDemoCorpus(o)` deep-equals `buildDemoCorpus(o)` — proven by generating twice and comparing
// the serialised bytes, in `demoCorpus.test.ts` and again on a live emulator in
// `firestore-tests/demo-corpus.emulator.test.ts`.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// TWO PLACES D27 IS NOT BUILDABLE AS WRITTEN — recorded here because the corpus shape encodes
// the resolution, and a reader who does not know will read the shape as a mistake.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// (1) THE 8-CHARACTER `"9/3/2026"` IS NOT AN UNPARSEABLE DATE. D27 asks for "≥1 unparseable date
//     in both forms — the 8-char `"9/3/2026"` and the 10-char `"9999-99-99"`". T0's measurement is
//     right about what it measured (Rules' `date.size() == 10` BLOCKS the 8-char form on create),
//     but `parseTransactionDate` reads `DD/MM/YYYY` deliberately — `periodMath.ts`'s own header
//     records `"9/3/2026"` → `"2026-03"` as a REQUIREMENT, and five of `periodOf`'s named tests
//     turn on it. The 8-char row therefore lands in `2026-03`, not in `'unknown'`.
//     RESOLVED, not skipped: the corpus emits BOTH the 8-char legacy row (which proves `periodOf`
//     is not the old `slice(0,7)` and that the form is Admin-SDK-only) AND **two distinct 10-char
//     Rules-passing forms** — `"9999-99-99"` and `"2026/03/15"` — which are the ones that actually
//     produce `period: 'unknown'`. Both facts are asserted by name, including the one D27 got
//     wrong, so nobody re-derives it.
//
// (2) AN ACTIVE INSURANCE MAKES AN EMPTY-CERTAIN-LAYER MONTH UNREACHABLE. D27 asks for both
//     `premiumFrequency` values AND for "a month inside the horizon with no recurring/loan/
//     insurance charge at all". `projectInsuranceForward` (T1, written after v2.1) has NO END
//     BOUND by design — "`Insurance` has a `renewalDate`, which is a RENEWAL, not an end" — so any
//     `status: 'active'` policy charges in EVERY horizon month and no month can be empty.
//     `status` is the only lever and it is not a function of period. The two requirements are
//     therefore mutually exclusive in one corpus.
//     RESOLVED toward the named checkbox condition: both `premiumFrequency` values are present as
//     DOCUMENTS (one `'lapsed'`, one `'cancelled'`), the empty-certain-layer month exists, and the
//     cost is stated — the certain layer carries no insurance line, so `projectInsuranceForward`'s
//     ACTIVE branch has no demo-corpus instance and keeps its T1 unit tests as its only evidence.
//     Its `status !== 'active'` early return, which had none, now has two.
import {
  UNKNOWN_PERIOD,
  clampDayToMonth,
  monthKeyOf,
  nextPeriod,
  periodOrUnknown,
  periodOrUnknownFromMonthYear,
  periodsBetween,
  previousPeriod,
} from './periodMath';
import { ownerIdOrUnknown } from './resolveOwnerId';
import { LOOKBACK_MONTHS_MAX } from './forecast';
import { seasonalityScopeId } from './seasonality';
import { CATEGORY_MAP } from './categoryMap';
import type { Account, AssumptionScopeKind, ForecastAssumption, Insurance, Loan, RecurringItem } from '../types/finance';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Named constants. No bare literals — every number below is either measured (T0) or ruled (D26,
// D27, D33) and says which.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The corpus's notion of "today". A parameter with a default, never a clock read. */
export const DEMO_AS_OF_DATE = '2026-08-18';

/** The month `DEMO_AS_OF_DATE` falls in — the anchor of every forecast computed over this corpus. */
export const DEMO_ANCHOR_PERIOD = '2026-08';

/** The PRNG seed. Changing it changes every jittered amount, and therefore every downstream figure. */
export const DEMO_SEED = 20260818;

/**
 * Eight periods of history (D27), ending the month BEFORE the anchor. Eight rather than six so the
 * §10 window cap has something to cap: a category observed in all eight still reports six.
 */
export const DEMO_HISTORY_MONTHS = 8;

/**
 * The statistical window's width — `LOOKBACK_MONTHS_MAX`, IMPORTED (T5).
 *
 * T4 wrote this as a local `6` because T5 had not run yet, and said so in this comment: *"T5
 * should import this or pin the two against each other — a second, silently-diverging 6 is exactly
 * the defect this stage keeps finding."* T5 has run. The dependency points this way round because
 * `forecast.ts` is the module the purity guard walks and the corpus is the thing arranged around
 * the rule, never the other way about.
 */
export const DEMO_WINDOW_MONTHS = LOOKBACK_MONTHS_MAX;

/**
 * The base corpus's member count. FOUR, not D27's three, and the fourth is the point: it carries a
 * DUPLICATE DISPLAY NAME, which `resolveOwnerId` deliberately resolves to `'unknown'` rather than
 * to the first match. T3's ledger names this as the generator's job.
 */
export const DEMO_BASE_MEMBER_COUNT = 4;

/** §3's success metric and D33's measured payload — the `--members=20` variant. */
export const DEMO_LARGE_MEMBER_COUNT = 20;

/**
 * Rows per member per period in the bulk cohort. Chosen so that a `DEMO_WINDOW_MONTHS`-wide
 * FAMILY read over the `DEMO_LARGE_MEMBER_COUNT` corpus crosses `HISTORY_ROW_CEILING`:
 * 6 periods × 20 rows × 18 ATTRIBUTABLE members = 2160 > 2000. Eighteen, not twenty: the two
 * members sharing a display name own no bulk rows, because a row written in their name resolves to
 * `'unknown'` and a corpus where half the ledger is unattributable is not a realistic one. Held by
 * `demoCorpus.test.ts`, not by this arithmetic.
 */
export const DEMO_BULK_ROWS_PER_MEMBER_PERIOD = 20;

/**
 * T6 CLOSED THE GAP THIS CONSTANT EXISTED FOR. Between T2 and T6 `firestore.rules` accepted
 * `'seasonality'` while `ASSUMPTION_SCOPE_KINDS` did not, so this corpus widened the demo document
 * type by exactly that one string literal in order to emit one. T6 added the member to the real
 * union, which turned the pins in `forecastAssumptions.test.ts` and `demoCorpus.test.ts` red — and
 * the widening with them. Both are gone; `DemoForecastAssumption` is now `ForecastAssumption`.
 */

/** The categories the corpus uses, all drawn from the extraction taxonomy so no bucket is invented. */
export const DEMO_CATEGORY_GROCERIES = CATEGORY_MAP.Groceries_Dining;   // n = 8 — above the window cap
export const DEMO_CATEGORY_TRANSPORT = CATEGORY_MAP.Transportation;     // n = 6
export const DEMO_CATEGORY_HEALTH = CATEGORY_MAP.Health;                // n = 3, recurring + manual
export const DEMO_CATEGORY_LEISURE = CATEGORY_MAP.Leisure_Travel;       // n = 2
export const DEMO_CATEGORY_HOUSING = CATEGORY_MAP.Housing_Utilities;    // n = 1, single observation ₪0
export const DEMO_CATEGORY_EDUCATION = CATEGORY_MAP.Education;          // n = 0 — a recurring item, no rows
export const DEMO_CATEGORY_MISC = CATEGORY_MAP.General_Misc;            // instalment plans
export const DEMO_CATEGORY_INCOME = CATEGORY_MAP.Income_Investments;    // the salary recurring items

/**
 * The three dates D27's staleness bullet needs, expressed as ages in days against
 * `DEMO_AS_OF_DATE` and mapped through `STALENESS_CURRENT_MAX_DAYS` (31) /
 * `STALENESS_STALE_MAX_DAYS` (92). One per band, deliberately not on a boundary — a fixture that
 * sits exactly on `<=` proves the boundary and not the band.
 */
export const DEMO_ACCOUNT_AGES_DAYS = [5, 59, 150] as const;

/** The two 10-character forms Rules ACCEPT and `parseTransactionDate` REFUSES. Both → `'unknown'`. */
export const DEMO_UNPARSEABLE_DATES = ['9999-99-99', '2026/03/15'] as const;

/**
 * The 8-character legacy form Rules BLOCK on create (`date.size() == 10`) and
 * `parseTransactionDate` READS. It is here to make both halves of that visible at once, and it is
 * NOT one of the `'unknown'` rows — see this file's header, defect (1).
 */
export const DEMO_RULES_BLOCKED_LEGACY_DATE = '9/3/2026';

/** A display name no member carries — the rename case for `ownerId: 'unknown'`. */
export const DEMO_ORPHANED_OWNER_NAME = 'רותי כהן-לוי';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Document shapes
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface DemoMember {
  id: string;
  name: string;
  role: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A `transaction_lines` row as the app actually persists one — the field list is
 * `FileProcessor.ts:553`'s, minus `created_at` (a `serverTimestamp()` sentinel, which is I/O and
 * belongs to the script, not to a pure builder).
 */
export interface DemoTransactionLine {
  id: string;
  date: string;
  description: string;
  vendor: string;
  amount: number;
  category: string;
  paymentType: string;
  installmentNumber: number | null;
  totalInstallments: number | null;
  isCredit: boolean;
  expenseClassification: string | null;
  owner: string;
  ownerId: string;
  period: string;
  recurringId: string | null;
  recurringPeriod: string | null;
}

/** An `incomes` row as `Dashboard.handleSaveIncomes` persists one (D23b — `period` from month/year). */
export interface DemoIncome {
  id: string;
  name: string;
  amount: number;
  date: string;
  month: string;
  year: string;
  period: string;
}

/**
 * The corpus's assumption shape IS the shipped one, since T6. It was a widened alias for exactly
 * as long as the client union was one member short of Rules; keeping the alias name means every
 * signature in this file and its tests is unchanged by the narrowing.
 */
export type DemoForecastAssumption = ForecastAssumption;

/**
 * !! THIS IS `TransactionPeriodBackfillMarker`, AND IT MUST PARSE (T5 fix).
 *
 * T4 wrote four fields. The T3 REVIEW (F7) had already made SEVEN of them required — `lastRunAt`,
 * `lastRunCommit` and `transactionRows` distinguish the run that STAMPED the corpus from a later
 * run that merely looked at it — and `parseBackfillMarker` returns `null` for anything short of
 * all seven. So the seeded demo corpus's marker parsed as `null`, the gate refused, and the
 * statistical layer computed NOTHING on the very corpus that exists to give it evidence, while
 * this file's own comment on `DemoCorpus.backfillMarker` said the opposite.
 *
 * Nothing could see it: T4 asserted the marker's `rowsUnknown` and the emulator test read
 * `rowsStamped` off the raw document, and neither ever ran it through the parser. `statisticalLayerCorpus.test.ts`
 * now does, which is what makes this a property rather than a shape.
 */
export interface DemoBackfillMarker {
  completedAt: string;
  rowsStamped: number;
  rowsUnknown: number;
  sourceCommit: string;
  lastRunAt: string;
  lastRunCommit: string;
  transactionRows: number;
}

export interface DemoCorpus {
  seed: number;
  asOfDate: string;
  anchorPeriod: string;
  /** The eight history periods, ascending, ending the month before `anchorPeriod`. */
  historyPeriods: string[];
  /** The last `DEMO_WINDOW_MONTHS` of `historyPeriods` — what a statistical read actually sees. */
  windowPeriods: string[];
  /** The forecast horizon this corpus is arranged around, ascending, starting at `anchorPeriod`. */
  horizonPeriods: string[];
  /** The horizon month deliberately left with no recurring, loan or insurance charge (D27/A9). */
  emptyCertainPeriod: string;
  members: DemoMember[];
  accounts: Account[];
  recurring: RecurringItem[];
  loans: Loan[];
  insurances: Insurance[];
  incomes: DemoIncome[];
  transactionLines: DemoTransactionLine[];
  forecastAssumptions: DemoForecastAssumption[];
  /** D21(d)'s completion marker, so `loadStatisticalHistory` does not refuse on this corpus. */
  backfillMarker: DemoBackfillMarker;
}

export interface DemoCorpusOptions {
  seed?: number;
  asOfDate?: string;
  memberCount?: number;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Deterministic primitives
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * mulberry32 — 32-bit state, one multiply-xor round. Chosen because it is short enough to read in
 * full and has no hidden state: given the same seed it yields the same sequence on every engine,
 * which `Math.random` cannot promise and which is the whole requirement here.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An amount jittered by ±`spreadILS`, rounded to agorot. Draws exactly one number, always. */
function jitter(random: () => number, baseILS: number, spreadILS: number): number {
  const offset = (random() * 2 - 1) * spreadILS;
  return Math.round((baseILS + offset) * 100) / 100;
}

/** `'YYYY-MM-DD'` for `day` in `period`, clamped to the month's real length (bank semantics). */
function dateIn(period: string, day: number): string {
  const [year, month] = period.split('-').map(Number);
  return `${period}-${String(clampDayToMonth(year, month, day)).padStart(2, '0')}`;
}

/**
 * `date` shifted by `days`, as `'YYYY-MM-DD'`.
 *
 * Integer civil-calendar arithmetic, with NO `Date` OBJECT ANYWHERE — the same discipline
 * `periodMath.ts` and `recurringCatchup.ts` are held to, and for the same reason: a `Date` reads a
 * timezone, and a corpus whose dates depend on the machine's timezone is a corpus that fails the
 * determinism property this whole module exists to have. (`new Date(millis).toISOString()` would
 * in fact be safe here; the point is that nothing downstream has to verify that, and the next edit
 * to this function does not get to be the one that introduces `new Date()` without a `millis`.)
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z: number): { year: number; month: number; day: number } {
  const shifted = z + 719468;
  const era = Math.floor(shifted / 146097);
  const doe = shifted - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: month <= 2 ? y + 1 : y, month, day };
}

function shiftDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const civil = civilFromDays(daysFromCivil(year, month, day) + days);
  return `${String(civil.year).padStart(4, '0')}-${String(civil.month).padStart(2, '0')}-${String(civil.day).padStart(2, '0')}`;
}

/**
 * A stable ISO instant for a date string. Every `createdAt`/`updatedAt`/`balanceUpdatedAt` in the
 * corpus goes through here, so no timestamp can carry a clock read or a sub-second difference
 * between two runs.
 */
function instantOf(date: string, hour = 9): string {
  return `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`;
}

/** The last `count` entries of `periods`. */
function lastPeriods(periods: string[], count: number): string[] {
  return periods.slice(Math.max(0, periods.length - count));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Members
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The four named members. The last two SHARE A DISPLAY NAME on purpose: `resolveOwnerId` returns
 * `null` for a name carried by more than one member — "picking the first would be a coin flip
 * nobody is told about" — and nothing in the tree proves it, because the real corpus has three
 * distinct names. A row owned by `'עומר לוי'` is therefore attributable to nobody, which is what
 * `ownerId: 'unknown'` means and what D26 must not render as "not enough history yet".
 */
const DEMO_NAMED_MEMBERS: ReadonlyArray<{ id: string; name: string; role: string; color: string }> = [
  { id: 'demo-david', name: 'דויד לוי', role: 'הורה', color: '#1F4E78' },
  { id: 'demo-lilit', name: 'לילית לוי', role: 'הורה', color: '#8E44AD' },
  { id: 'demo-omer', name: 'עומר לוי', role: 'ילד', color: '#16A085' },
  { id: 'demo-omer-2', name: 'עומר לוי', role: 'ילד', color: '#D35400' },
];

/**
 * `largeFamily.ts`'s name shape, restated rather than imported: that fixture lives under
 * `src/__tests__/` and is typed `as any[]`, and neither a test directory nor an `any` belongs in a
 * module the production bundle and an Admin-SDK script both load. `demoCorpus.test.ts` asserts the
 * two formulas agree, so a change to either turns a test red instead of drifting.
 */
export function largeFamilyMemberName(index: number): string {
  return `בן משפחה ${index}`;
}

/**
 * The members a row can actually be attributed to: those whose display name is carried by exactly
 * one member. `resolveOwnerId` refuses a name carried by two, so a row written in an ambiguous
 * name lands on `'unknown'` however it was meant — and a corpus where routine spending is
 * unattributable would make `ownerId: 'unknown'` look like the normal case rather than the
 * exception D26 must not render as "not enough history yet".
 */
export function attributableMembers(members: ReadonlyArray<DemoMember>): DemoMember[] {
  const counts = new Map<string, number>();
  for (const member of members) counts.set(member.name, (counts.get(member.name) ?? 0) + 1);
  return members.filter((member) => counts.get(member.name) === 1);
}

function buildMembers(memberCount: number, asOfDate: string): DemoMember[] {
  const createdAt = instantOf(shiftDays(asOfDate, -400));
  const members: DemoMember[] = DEMO_NAMED_MEMBERS.slice(0, memberCount).map((m) => ({
    id: m.id,
    name: m.name,
    role: m.role,
    color: m.color,
    createdAt,
    updatedAt: createdAt,
  }));
  for (let i = DEMO_NAMED_MEMBERS.length; i < memberCount; i++) {
    members.push({
      id: `demo-m${i}`,
      name: largeFamilyMemberName(i),
      role: 'ילד',
      color: '#1F4E78',
      createdAt,
      updatedAt: createdAt,
    });
  }
  return members;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The builder
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The whole corpus, deterministically, from `(seed, asOfDate, memberCount)` and nothing else.
 *
 * REFUSES rather than degrading on a malformed argument — `horizonPeriods`' rule, for the same
 * reason: a corpus silently built from one member, or from an unreadable date, renders exactly
 * like a corpus that is genuinely thin, and the whole point of this module is that the thin cases
 * are DELIBERATE and named.
 */
export function buildDemoCorpus(options: DemoCorpusOptions = {}): DemoCorpus {
  const seed = options.seed ?? DEMO_SEED;
  const asOfDate = options.asOfDate ?? DEMO_AS_OF_DATE;
  const memberCount = options.memberCount ?? DEMO_BASE_MEMBER_COUNT;

  if (!Number.isInteger(memberCount) || memberCount < DEMO_BASE_MEMBER_COUNT) {
    throw new Error(
      `buildDemoCorpus: memberCount must be an integer >= ${DEMO_BASE_MEMBER_COUNT} (the four named ` +
        `members carry the duplicate display name and the three staleness bands), got ${String(memberCount)}`
    );
  }
  if (!Number.isInteger(seed)) {
    throw new Error(`buildDemoCorpus: seed must be an integer, got ${String(seed)}`);
  }
  const anchorPeriod = periodOrUnknown(asOfDate);
  if (anchorPeriod === UNKNOWN_PERIOD) {
    throw new Error(`buildDemoCorpus: asOfDate must be a readable date, got ${JSON.stringify(asOfDate)}`);
  }

  const random = mulberry32(seed);
  const members = buildMembers(memberCount, asOfDate);
  const memberNames = members.map((m) => ({ id: m.id, name: m.name }));

  // ── periods ───────────────────────────────────────────────────────────────────────────────
  // History ends the month BEFORE the anchor: the anchor month is being forecast, not observed.
  let historyStart = anchorPeriod;
  for (let i = 0; i < DEMO_HISTORY_MONTHS; i++) historyStart = previousPeriod(historyStart);
  const historyPeriods = periodsBetween(historyStart, previousPeriod(anchorPeriod));
  const windowPeriods = lastPeriods(historyPeriods, DEMO_WINDOW_MONTHS);

  // The horizon this corpus is ARRANGED AROUND. Three months is `DEFAULT_HORIZON_MONTHS`; the
  // empty-certain month is the middle one, so it is bracketed by a month with a full certain layer
  // on each side — an empty month at an end could be mistaken for the horizon simply running out.
  const horizon = [anchorPeriod, nextPeriod(anchorPeriod), nextPeriod(nextPeriod(anchorPeriod))];
  const emptyCertainPeriod = horizon[1];
  const certainResumePeriod = horizon[2];

  const accounts = buildAccounts(members, asOfDate);
  const recurring = buildRecurring(members, historyPeriods, anchorPeriod, certainResumePeriod, asOfDate);
  const loans = buildLoans(members, anchorPeriod, certainResumePeriod, asOfDate);
  const insurances = buildInsurances(members, asOfDate);
  const incomes = buildIncomes(members, windowPeriods);
  const transactionLines = buildTransactionLines(random, members, memberNames, historyPeriods, windowPeriods);
  const forecastAssumptions = buildAssumptions(members, anchorPeriod, asOfDate);

  return {
    seed,
    asOfDate,
    anchorPeriod,
    historyPeriods,
    windowPeriods,
    horizonPeriods: horizon,
    emptyCertainPeriod,
    members,
    accounts,
    recurring,
    loans,
    insurances,
    incomes,
    transactionLines,
    forecastAssumptions,
    backfillMarker: {
      completedAt: instantOf(asOfDate, 6),
      rowsStamped: transactionLines.length,
      rowsUnknown: transactionLines.filter((row) => row.period === UNKNOWN_PERIOD).length,
      sourceCommit: 'demo-corpus',
      // The corpus is written by ONE run, so the "last run" half is that same run. Stated rather
      // than left absent: `parseBackfillMarker` requires all seven, and a marker short of them
      // parses as `null`, which refuses the whole statistical layer.
      lastRunAt: instantOf(asOfDate, 6),
      lastRunCommit: 'demo-corpus',
      transactionRows: transactionLines.length,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// accounts — D16's three staleness bands, one account each
// ─────────────────────────────────────────────────────────────────────────────────────────────

function buildAccounts(members: DemoMember[], asOfDate: string): Account[] {
  const createdAt = instantOf(shiftDays(asOfDate, -400));
  const types = ['bank', 'cash', 'credit'] as const;
  const balances = [42580.4, 1250, -8340.15];

  // One account per band, each owned by a different member, so `computeOpeningBalance([account])`
  // yields a DIFFERENT band for each — the function grades on `max(balanceUpdatedAt)` across the
  // list it is handed, so three accounts in one call can only ever produce one answer.
  return DEMO_ACCOUNT_AGES_DAYS.map((ageDays, i) => ({
    id: `demo-acc-${types[i]}`,
    ownerId: members[i % members.length].id,
    name: `חשבון ${types[i]}`,
    type: types[i],
    balance: balances[i],
    balanceUpdatedAt: instantOf(shiftDays(asOfDate, -ageDays)),
    status: 'active' as const,
    createdAt,
    updatedAt: createdAt,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// recurring / loans / insurances — the certain layer, arranged around `emptyCertainPeriod`
//
// TWO COHORTS, and the split is the whole mechanism. Everything in cohort A ENDS at the last day
// of the anchor month; everything in cohort B STARTS on the first day of `certainResumePeriod`.
// The month between them therefore has no recurring charge and no loan repayment, which is D27's
// tenth condition and §12's A9 branch. Insurance cannot be bounded this way — see this file's
// header, defect (2) — so both policies are inactive.
// ─────────────────────────────────────────────────────────────────────────────────────────────

function lastDayOf(period: string): string {
  return dateIn(period, 31);
}

function buildRecurring(
  members: DemoMember[],
  historyPeriods: string[],
  anchorPeriod: string,
  certainResumePeriod: string,
  asOfDate: string
): RecurringItem[] {
  const createdAt = instantOf(shiftDays(asOfDate, -400));
  const cohortAEnd = lastDayOf(anchorPeriod);
  const cohortBStart = dateIn(certainResumePeriod, 1);
  const historyStart = dateIn(historyPeriods[0], 1);
  const base = { createdAt, updatedAt: createdAt, status: 'active' as const };

  return [
    // Cohort A — income and expense, both `kind`s present (D27).
    {
      ...base,
      id: 'demo-rec-salary-a',
      ownerId: members[0].id,
      kind: 'income',
      description: 'משכורת',
      amount: 18500,
      category: DEMO_CATEGORY_INCOME,
      chargeDay: 1,
      startDate: shiftDays(historyStart, -365),
      endDate: cohortAEnd,
    },
    {
      // The `recurringId` half of D23(b): this item's posted rows sit in DEMO_CATEGORY_HEALTH
      // alongside MANUAL rows in the same months, so removing the exclusion changes a NUMBER
      // rather than a count.
      ...base,
      id: 'demo-rec-clinic-a',
      ownerId: members[1].id,
      kind: 'expense',
      description: 'מנוי מרפאה',
      amount: 220,
      category: DEMO_CATEGORY_HEALTH,
      chargeDay: 5,
      startDate: shiftDays(historyStart, -60),
      endDate: cohortAEnd,
    },
    {
      // DEMO_CATEGORY_EDUCATION's ONLY appearance in the corpus. It is a certain-layer category
      // with ZERO transaction rows, which is the only way `monthsObserved === 0` exists for a
      // category the screen actually draws — D26's row that is otherwise unreachable.
      ...base,
      id: 'demo-rec-tuition-a',
      ownerId: members[0].id,
      kind: 'expense',
      description: 'שכר לימוד',
      amount: 1450,
      category: DEMO_CATEGORY_EDUCATION,
      chargeDay: 10,
      startDate: shiftDays(historyStart, 30),
      endDate: cohortAEnd,
    },
    // Cohort B — resumes AFTER the empty month.
    {
      ...base,
      id: 'demo-rec-salary-b',
      ownerId: members[0].id,
      kind: 'income',
      description: 'משכורת (חוזה חדש)',
      amount: 19200,
      category: DEMO_CATEGORY_INCOME,
      chargeDay: 1,
      startDate: cohortBStart,
    },
    {
      ...base,
      id: 'demo-rec-streaming-b',
      ownerId: members[2].id,
      kind: 'expense',
      description: 'מנוי סטרימינג',
      amount: 65,
      category: DEMO_CATEGORY_LEISURE,
      chargeDay: 12,
      startDate: cohortBStart,
    },
    {
      // `status: 'paused'` — `projectRecurringForward`'s early return had no corpus instance.
      ...base,
      status: 'paused',
      id: 'demo-rec-paused',
      ownerId: members[1].id,
      kind: 'expense',
      description: 'חדר כושר (הוקפא)',
      amount: 199,
      category: DEMO_CATEGORY_HEALTH,
      chargeDay: 20,
      startDate: shiftDays(historyStart, -200),
    },
  ];
}

function buildLoans(
  members: DemoMember[],
  anchorPeriod: string,
  certainResumePeriod: string,
  asOfDate: string
): Loan[] {
  const createdAt = instantOf(shiftDays(asOfDate, -400));
  return [
    {
      // endDate INSIDE the horizon (D27) — it makes its last payment in the anchor month.
      id: 'demo-loan-car',
      ownerId: members[0].id,
      name: 'הלוואת רכב',
      loanType: 'personal',
      principal: 90000,
      balance: 1850,
      interestRate: 5.4,
      monthlyPayment: 1850,
      startDate: '2023-03-01',
      endDate: lastDayOf(anchorPeriod),
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    },
    {
      // endDate OUTSIDE the horizon (D27), and a start date AFTER the empty month, which is what
      // lets an open-ended repayment coexist with a month that has no certain layer at all.
      id: 'demo-loan-mortgage',
      ownerId: members[1].id,
      name: 'משכנתא',
      loanType: 'mortgage',
      principal: 1150000,
      balance: 1150000,
      interestRate: 4.1,
      monthlyPayment: 6200,
      startDate: dateIn(certainResumePeriod, 1),
      endDate: '2051-09-30',
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    },
  ];
}

function buildInsurances(members: DemoMember[], asOfDate: string): Insurance[] {
  const createdAt = instantOf(shiftDays(asOfDate, -400));
  return [
    {
      id: 'demo-ins-health',
      ownerId: members[0].id,
      type: 'health',
      provider: 'הראל',
      insuredMemberId: members[2].id,
      premium: 480,
      premiumFrequency: 'monthly',
      coverages: [{ label: 'ניתוחים בישראל', amount: 500000 }],
      renewalDate: shiftDays(asOfDate, 200),
      status: 'lapsed',
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: 'demo-ins-car',
      ownerId: members[1].id,
      type: 'car',
      provider: 'כלל',
      insuredMemberId: members[1].id,
      premium: 3600,
      premiumFrequency: 'yearly',
      coverages: [{ label: 'צד ג׳' }],
      renewalDate: shiftDays(asOfDate, 90),
      status: 'cancelled',
      createdAt,
      updatedAt: createdAt,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// incomes — D23(b)'s month/year stamp, including a malformed pair
// ─────────────────────────────────────────────────────────────────────────────────────────────

function buildIncomes(members: DemoMember[], windowPeriods: string[]): DemoIncome[] {
  const rows: DemoIncome[] = [];
  for (const period of windowPeriods) {
    const [year, month] = period.split('-');
    rows.push({
      id: `demo-income-${period}`,
      name: `משכורת ${members[0].name}`,
      amount: 18500,
      date: dateIn(period, 1),
      month,
      year,
      period: periodOrUnknownFromMonthYear(month, year),
    });
  }
  // THE MALFORMED PAIR (D27). `month: '13'` is what a hand-edited row looks like; T0 could not
  // measure the divergence at all because `incomes` has no documents, so this row is the ONLY
  // evidence `periodOrUnknownFromMonthYear` refuses rather than guessing.
  rows.push({
    id: 'demo-income-malformed',
    name: `בונוס ${members[1].name}`,
    amount: 4200,
    date: dateIn(windowPeriods[windowPeriods.length - 1], 14),
    month: '13',
    year: '2026',
    period: periodOrUnknownFromMonthYear('13', '2026'),
  });
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// transaction_lines
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface RowSpec {
  id: string;
  period: string;
  day: number;
  ownerName: string;
  category: string;
  vendor: string;
  description: string;
  amount: number;
  paymentType?: string;
  isCredit?: boolean;
  installmentNumber?: number | null;
  totalInstallments?: number | null;
  recurringId?: string;
  dateOverride?: string;
}

function buildTransactionLines(
  random: () => number,
  members: DemoMember[],
  memberNames: ReadonlyArray<{ id: string; name: string }>,
  historyPeriods: string[],
  windowPeriods: string[]
): DemoTransactionLine[] {
  const specs: RowSpec[] = [];

  // The members whose display name is UNIQUE, and therefore the only ones a row can actually be
  // attributed to. Everything routine in the ledger belongs to one of these; the ambiguous pair is
  // used exactly twice, deliberately, further down.
  const attributable = attributableMembers(members);
  const owner = (i: number): string => attributable[i % attributable.length].name;

  // ── bulk cohort: DEMO_CATEGORY_GROCERIES, every attributable member, every history period ──
  // The only category with a row in all eight periods, so it is the one that exercises the window
  // CAP (n = 8 observed, 6 read) and the one that supplies the volume D33's ceiling needs.
  for (const period of historyPeriods) {
    for (let m = 0; m < attributable.length; m++) {
      for (let k = 0; k < DEMO_BULK_ROWS_PER_MEMBER_PERIOD; k++) {
        specs.push({
          id: `demo-tx-groceries-${period}-${attributable[m].id}-${String(k).padStart(2, '0')}`,
          period,
          day: 2 + ((k * 3) % 26),
          ownerName: attributable[m].name,
          category: DEMO_CATEGORY_GROCERIES,
          vendor: k % 2 === 0 ? 'שופרסל' : 'רמי לוי',
          description: 'קניות',
          amount: jitter(random, 180, 90),
        });
      }
    }
  }

  // ── DEMO_CATEGORY_TRANSPORT — exactly the six window periods (n = 6) ───────────────────────
  windowPeriods.forEach((period, i) => {
    specs.push({
      id: `demo-tx-transport-${period}`,
      period,
      day: 8,
      ownerName: owner(i),
      category: DEMO_CATEGORY_TRANSPORT,
      vendor: 'פז',
      description: 'דלק',
      amount: jitter(random, 420, 110),
    });
  });

  // ── DEMO_CATEGORY_HEALTH — three periods (n = 3), each carrying BOTH a recurring-posted row
  //    and a manual row, which is what makes D23's `recurringId` exclusion change a NUMBER.
  const healthPeriods = lastPeriods(historyPeriods, 3);
  healthPeriods.forEach((period, i) => {
    specs.push({
      id: `demo-rec-clinic-a__${period}`,
      period,
      day: 5,
      ownerName: members[1].name,
      category: DEMO_CATEGORY_HEALTH,
      vendor: 'מרפאת שיניים',
      description: 'מנוי מרפאה',
      amount: 220,
      recurringId: 'demo-rec-clinic-a',
    });
    specs.push({
      id: `demo-tx-health-manual-${period}`,
      period,
      day: 17,
      ownerName: owner(i),
      category: DEMO_CATEGORY_HEALTH,
      vendor: 'סופר-פארם',
      description: 'תרופות',
      amount: jitter(random, 260, 70),
    });
  });

  // ── DEMO_CATEGORY_LEISURE — two periods (n = 2, the "average, no band" band) ───────────────
  lastPeriods(historyPeriods, 2).forEach((period, i) => {
    specs.push({
      id: `demo-tx-leisure-${period}`,
      period,
      day: 22,
      ownerName: owner(i),
      category: DEMO_CATEGORY_LEISURE,
      vendor: 'סינמה סיטי',
      description: 'סרט',
      amount: jitter(random, 150, 40),
    });
  });

  // ── DEMO_CATEGORY_HOUSING — ONE period, ONE row, amount ₪0 ────────────────────────────────
  // §12's first no-₪0 branch. An n=1 category with a ₪300 observation exercises NOTHING: the
  // misleading `₪0` is rendered by the branch that HAS an observation and the observation is zero,
  // which a guard scoped only to the zero-HISTORY branch cannot see.
  const lastHistoryPeriod = historyPeriods[historyPeriods.length - 1];
  specs.push({
    id: 'demo-tx-housing-zero',
    period: lastHistoryPeriod,
    day: 3,
    ownerName: members[0].name,
    category: DEMO_CATEGORY_HOUSING,
    vendor: 'חברת החשמל',
    description: 'חשבון חשמל (זוכה במלואו)',
    amount: 0,
  });

  // ── the refund credit row ─────────────────────────────────────────────────────────────────
  // `isCredit: true` AND `paymentType: 'refund'` — the ONLY shape where `isExpenseRow`
  // (transactionFilters.ts:114-118, excludes every credit) and `isExpenseListRow` (:128-132, keeps
  // refunds and cancellations) DISAGREE. In DEMO_CATEGORY_GROCERIES and inside the window, so
  // swapping one predicate for the other moves a number the average reads.
  specs.push({
    id: 'demo-tx-refund',
    period: windowPeriods[windowPeriods.length - 2],
    day: 11,
    ownerName: members[0].name,
    category: DEMO_CATEGORY_GROCERIES,
    vendor: 'שופרסל',
    description: 'זיכוי החזרת מוצר',
    amount: 137.9,
    paymentType: 'refund',
    isCredit: true,
  });

  // ── instalments (D10) ─────────────────────────────────────────────────────────────────────
  // (a) `totalInstallments` set with `installmentNumber: null` — the shape `FileProcessor.ts`
  //     actually writes (`item.installmentNumber ?? null`), and the branch a `!== undefined` check
  //     reads as PRESENT before projecting from `NaN`. Zero instances on the real corpus (T0).
  specs.push({
    id: 'demo-tx-instalment-null',
    period: windowPeriods[windowPeriods.length - 3],
    day: 9,
    ownerName: members[1].name,
    category: DEMO_CATEGORY_MISC,
    vendor: 'אלקטרה',
    description: 'מזגן — תשלומים',
    amount: 450,
    paymentType: 'installment',
    installmentNumber: null,
    totalInstallments: 6,
  });
  // (b) TWO DISTINCT PLANS THAT COLLIDE under `planKeyOf` = (vendor, totalInstallments, amount).
  //     Same vendor, same 4 payments, same ₪300 — bought a month apart, so they are genuinely two
  //     purchases and the key cannot tell. R5's permanently-documented wrong output: the merged
  //     plan projects ONE further charge where the truth is three.
  const planPeriod = lastHistoryPeriod;
  specs.push({
    id: 'demo-tx-plan-a',
    period: planPeriod,
    day: 5,
    ownerName: members[0].name,
    category: DEMO_CATEGORY_MISC,
    vendor: 'אייס',
    description: 'ריהוט — תשלום 3/4',
    amount: 300,
    paymentType: 'installment',
    installmentNumber: 3,
    totalInstallments: 4,
  });
  specs.push({
    id: 'demo-tx-plan-b',
    period: planPeriod,
    day: 20,
    ownerName: members[0].name,
    category: DEMO_CATEGORY_MISC,
    vendor: 'אייס',
    description: 'כלי עבודה — תשלום 2/4',
    amount: 300,
    paymentType: 'installment',
    installmentNumber: 2,
    totalInstallments: 4,
  });

  // ── `period: 'unknown'` — the two 10-character forms Rules ACCEPT ──────────────────────────
  DEMO_UNPARSEABLE_DATES.forEach((date, i) => {
    specs.push({
      id: `demo-tx-unparseable-${i}`,
      period: lastHistoryPeriod,
      day: 1,
      dateOverride: date,
      ownerName: members[0].name,
      category: DEMO_CATEGORY_MISC,
      vendor: 'ספק לא מזוהה',
      description: 'שורה עם תאריך שלא ניתן לקריאה',
      amount: 88.5,
    });
  });
  // The 8-character legacy form. Rules BLOCK it on create; `parseTransactionDate` READS it. It is
  // NOT an `'unknown'` row — see this file's header, defect (1) — and its `period` is asserted to
  // be the real month precisely so nobody "fixes" it back into the unknown set.
  specs.push({
    id: 'demo-tx-legacy-8char',
    period: lastHistoryPeriod,
    day: 1,
    dateOverride: DEMO_RULES_BLOCKED_LEGACY_DATE,
    ownerName: members[0].name,
    category: DEMO_CATEGORY_MISC,
    vendor: 'ייבוא ישן',
    description: 'שורה שהועברה מהמערכת הישנה',
    amount: 64.2,
  });

  // ── `ownerId: 'unknown'` — both routes ─────────────────────────────────────────────────────
  // (a) the DUPLICATE display name: two members carry it, so `resolveOwnerId` refuses to guess.
  specs.push({
    id: 'demo-tx-owner-duplicate',
    period: lastHistoryPeriod,
    day: 12,
    ownerName: DEMO_NAMED_MEMBERS[2].name,
    category: DEMO_CATEGORY_GROCERIES,
    vendor: 'רמי לוי',
    description: 'קניות (בעלים דו-משמעי)',
    amount: 212.4,
  });
  // (b) a name no member carries — A6's orphan set, the rename case.
  specs.push({
    id: 'demo-tx-owner-orphan',
    period: lastHistoryPeriod,
    day: 13,
    ownerName: DEMO_ORPHANED_OWNER_NAME,
    category: DEMO_CATEGORY_GROCERIES,
    vendor: 'שופרסל',
    description: 'קניות (בעלים ששמו שונה)',
    amount: 176.05,
  });

  // Sorted by id so the emitted order is a property of the DATA and not of the code above it —
  // re-ordering a block cannot change the corpus.
  return specs
    .map((spec) => toRow(spec, memberNames))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * A `RowSpec` becomes a persisted row.
 *
 * !! `period` AND `ownerId` GO THROUGH `periodOrUnknown`/`ownerIdOrUnknown`, NEVER THROUGH A
 * LITERAL. That is the difference between a corpus that CONTAINS `'unknown'` and a corpus that
 * PROVES the shipped resolvers produce it: a hardcoded `'unknown'` would keep passing after
 * someone broke `resolveOwnerId`'s duplicate-name refusal, which is the exact defect T3 wrote that
 * loop not to have. `scripts/seed-demo-finances.ts` is registered as an INDIRECT writer in
 * `transactionStampGuard.test.ts` and this literal is what that redirect checks.
 */
function toRow(spec: RowSpec, members: ReadonlyArray<{ id: string; name: string }>): DemoTransactionLine {
  const date = spec.dateOverride ?? dateIn(spec.period, spec.day);
  return {
    id: spec.id,
    date,
    description: spec.description,
    vendor: spec.vendor,
    amount: spec.amount,
    category: spec.category,
    paymentType: spec.paymentType ?? 'one_time',
    installmentNumber: spec.installmentNumber ?? null,
    totalInstallments: spec.totalInstallments ?? null,
    isCredit: spec.isCredit ?? false,
    expenseClassification: spec.recurringId ? 'Fixed' : 'Variable',
    owner: spec.ownerName,
    period: periodOrUnknown(date),
    ownerId: ownerIdOrUnknown(spec.ownerName, members),
    recurringId: spec.recurringId ?? null,
    recurringPeriod: spec.recurringId ? spec.period : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// forecast_assumptions (D25) — all `source: 'user'`
//
// `'insight'` is DENIED by Rules in Stage 7 (D25b, the Stage 8 seam). A generator that wrote one
// would either fail against the live emulator or, worse, succeed — and succeeding would mean the
// floor is not enforced. Emitting only `'user'` is a decision, not an omission, and
// `demoCorpusConditions.ts` asserts it by name.
// ─────────────────────────────────────────────────────────────────────────────────────────────

function buildAssumptions(
  members: DemoMember[],
  anchorPeriod: string,
  asOfDate: string
): DemoForecastAssumption[] {
  const createdAt = instantOf(shiftDays(asOfDate, -30));
  const base = { createdAt, source: 'user' as const, status: 'active' as const };

  return [
    // THE COLLIDING PAIR (D20). Same (fromPeriod, scopeKind, scopeId) and the same direction, from
    // DIFFERENT owners, with DIFFERENT `updatedAt` AND DIFFERENT `amountILS` — so the winner shows
    // up in a FIGURE and not only in an ordering, and shuffle-invariance has a real corpus instead
    // of a hand-built fixture. `updatedAt` is D20's middle tier; without two different values the
    // tier is shadowed (v2.1a).
    {
      ...base,
      id: 'demo-fa-groceries-david',
      ownerId: members[0].id,
      scopeKind: 'category',
      scopeId: DEMO_CATEGORY_GROCERIES,
      fromPeriod: anchorPeriod,
      amountILS: 4200,
      reasonHe: 'הקיץ יקר יותר — אירוח וחופשות.',
      updatedAt: instantOf(shiftDays(asOfDate, -8), 9),
    },
    {
      ...base,
      id: 'demo-fa-groceries-lilit',
      ownerId: members[1].id,
      scopeKind: 'category',
      scopeId: DEMO_CATEGORY_GROCERIES,
      fromPeriod: anchorPeriod,
      amountILS: 3500,
      reasonHe: 'עברנו לקנייה מרוכזת פעם בשבוע.',
      updatedAt: instantOf(shiftDays(asOfDate, -4), 17),
    },
    // AN ASSUMPTION OVERRIDING A CERTAIN ITEM (D19). `resolveCategoryOfScope('loan', …)` maps to
    // CATEGORY_LOAN_REPAYMENT, so this lands in the same bucket as `demo-loan-car`'s certain line
    // and displaces it — the only way `forecast.assumptionOverride` is exercised on real data.
    {
      ...base,
      id: 'demo-fa-loan-override',
      ownerId: members[0].id,
      scopeKind: 'loan',
      scopeId: 'demo-loan-car',
      fromPeriod: anchorPeriod,
      amountILS: 1500,
      reasonHe: 'סיכמנו עם הבנק על תשלום אחרון מופחת.',
      updatedAt: instantOf(shiftDays(asOfDate, -6), 11),
    },
    // T6/D24 — A SEASONALITY ASSUMPTION THAT ACTUALLY APPLIES TO SOMETHING.
    //
    // Two things changed when T6 landed the real scope kind, and both were inert defects the T4
    // corpus could not have seen:
    //
    //  · THE SCOPE ID NOW PARSES. D24's shape is `${categoryId}:${monthKey}`; this document carried
    //    a bare category, so `parseSeasonalityScopeId` returns null for it and the factor is stored,
    //    listed, and NEVER APPLIED — the worst of the three available failures. The month key is
    //    derived from the assumption's own `fromPeriod` rather than written as a literal, so the
    //    corpus cannot drift out of alignment with the month it is about.
    //  · THE CATEGORY IS ONE THE STATISTICAL LAYER ESTIMATES. `DEMO_CATEGORY_EDUCATION` has n = 0
    //    rows by construction (it is a recurring item with no history), so a factor on it could
    //    never scale a number either. Transport has n = 6 and no competing `'category'` assumption,
    //    so this is the one document in the corpus that exercises a factor end to end.
    {
      ...base,
      id: 'demo-fa-seasonality-transport',
      ownerId: members[0].id,
      scopeKind: 'seasonality',
      scopeId: seasonalityScopeId(DEMO_CATEGORY_TRANSPORT, monthKeyOf(nextPeriod(anchorPeriod))),
      fromPeriod: nextPeriod(anchorPeriod),
      amountILS: 0,
      factor: 1.8,
      reasonHe: 'חודש יקר אצלנו — נסיעות וטיפולים.',
      updatedAt: instantOf(shiftDays(asOfDate, -3), 8),
    },
    // A30 as amended: a self-owned `personalTarget`, authored by the CHILD, authorized by the
    // owned-module pattern rather than by a `forecast` grant.
    {
      ...base,
      id: 'demo-fa-personal-target-omer',
      ownerId: members[2].id,
      scopeKind: 'personalTarget',
      scopeId: members[2].id,
      fromPeriod: anchorPeriod,
      amountILS: 500,
      reasonHe: 'רוצה לחסוך לאופניים.',
      updatedAt: instantOf(shiftDays(asOfDate, -2), 15),
    },
  ];
}

// NOTE: there is deliberately NO exported list of collection names here. `seed-demo-finances.ts`
// writes each collection in its own block with the name INLINED, because `transactionStampGuard`
// finds a row writer by looking for the string literal inside the write call's own subtree — a
// tidy `for (const name of COLLECTIONS)` loop would make the newest writer in the tree invisible
// to it. A shared array would be the first step back toward that loop, and it would also put
// `'forecast_assumptions'` into `src/`, which `forecastAssumptions.test.ts` reserves for its one
// writer.
