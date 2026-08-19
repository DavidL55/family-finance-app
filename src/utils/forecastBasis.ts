// src/utils/forecastBasis.ts — Stage 7, D19/D20. THE PROVENANCE VOCABULARY, AND WHO SPEAKS FOR A BUCKET.
//
// ── WHY THIS MODULE EXISTS ─────────────────────────────────────────────────────────────────────
//
// Split out of `forecast.ts` (T7c), which the T5 review named and the T6 and T7b reviews restated:
// at 2,181 lines that file held four separable things, and this is the one every other one depends
// on. Nothing here computes money. It states WHAT A FORECAST LINE ITEM IS — the `ForecastBasis`
// provenance union, the layer it derives to, the bucket an assumption's scope maps onto — and then
// resolves which source speaks for a bucket when two of them disagree.
//
// The split is one-directional, like `forecastCopy.ts`'s before it: this module imports the pure
// calendar and the copy TYPES, and imports nothing from `forecast.ts` or `statisticalLayer.ts`. It
// is the bottom of the engine's own DAG, so a cycle here would be visible as an import back up.
//
// ── WHAT MOVED WITH IT, AND WHAT DELIBERATELY DID NOT ─────────────────────────────────────────
//
//   · THE THREE `CATEGORY_*` BUCKET KEYS came here because they ARE the bucket vocabulary — a
//     bucket key is the thing `resolveCategoryOfScope` returns and `resolveLayerPrecedence` groups
//     on. They are NOT copy (`forecastCopy.test.ts` says so in as many words) and they must stay
//     byte-identical to what `RecurringService` stamps, so the seam guard that used to walk
//     `forecast.ts` for Hebrew literals now walks all three modules of the split and still allows
//     exactly these three.
//   · `roundILS` came here because it is the rule every producer of an amount obeys, in all three
//     modules, and a second copy is this repo's counted F4 class.
//   · `import { CATEGORY_MAP } from './categoryMap'` DID NOT come. It was an unused value import in
//     `forecast.ts` — `CATEGORY_MAP` appears only in the two doc comments below — and the split is
//     what surfaced it, because a move forces the question "which module needs this?". Dropping it
//     costs the forecast closure nothing: `seasonality.ts`, a named forecast entry module, imports
//     `categoryMap.ts` on its own account, so the file stays inside every guard that walks the
//     closure.
//
// ── PURITY ────────────────────────────────────────────────────────────────────────────────────
//
// No I/O, no Firebase, no clock, no `Date` parameter. `forecastPurity.test.ts` walks this file as
// part of `forecast.ts`'s transitive closure and asserts its membership BY INSPECTION rather than
// by luck — a module the walk does not reach is a module that guard has stopped checking.
import { comparePeriod } from './periodMath';
import type { BandBasis } from './forecastCopy';
import type { SeasonalFactor } from './seasonality';
import type { AssumptionScopeKind } from '../types/finance';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The bucket keys — no bare literals, and each one is pinned to something that already exists
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The bucket a recurring item with no category falls into. Byte-identical to the default
 * `RecurringService` already stamps on every autoposted row (`category: item.category ?? 'שונות'`)
 * — if the two drift, a recurring item's forward projection and its own posted rows land in
 * different buckets and D23's double-count disclosure silently stops lining up. Pinned by a test
 * against `CATEGORY_MAP.General_Misc`.
 */
export const CATEGORY_OTHER = 'שונות';

/**
 * Insurance premiums land in the extraction taxonomy's own insurance category, so a projected
 * premium and an extracted premium row share a bucket.
 */
export const CATEGORY_INSURANCE = 'ביטוח ופנסיה';

/**
 * Loan repayments land in a category that is DELIBERATELY NOT in `CATEGORY_MAP`. There is no loan
 * category in the extraction taxonomy, because a bank statement's loan debit gets whatever category
 * the extractor picked — which is exactly why D23 DISCLOSES the loan double-count instead of
 * fixing it (fuzzy-matching a bank row to a loan is Stage 8's duplicate detection). Merging the two
 * into one bucket would hide the duplicate this stage promises to show. Pinned by a test.
 */
export const CATEGORY_LOAN_REPAYMENT = 'החזרי הלוואות';

/**
 * Money is rounded to agorot at the point it is produced, so float dust never reaches a total.
 *
 * HELD BY A TEST, NOT BY THIS SENTENCE (T1-review follow-up 2). Replacing this body with the
 * identity left all 1449 tests green while three yearly policies over three months rendered
 * `11671.692500000001` instead of `11671.71` — in the `text-4xl` headline, and an agora out besides.
 * `forecast.test.ts`'s "roundILS is the reason the headline is a number and not a float" block is
 * what makes that mutation fail.
 */
// T7b — EXPORTED, so `forecastView.ts` can compose totals without a THIRD private copy of this
// helper. Two already exist (`forecastTargets.ts` has its own), which is the F4 class starting; a
// third one written for a render model would be the first to disagree with the engine it draws.
export function roundILS(amount: number): number {
  return Math.round(amount * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D19 — the provenance union
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * D24's seasonal multiplier. **MOVED to `./seasonality` in T6 and re-exported**, so every importer
 * that named it from the forecast engine is unchanged; T7c carried the re-export here with the
 * `ForecastBasis` union that names it.
 *
 * The move is load-bearing, not tidy. The no-month-literal guard derives the scope of its integer
 * ban from the tree, by finding the modules that DECLARE a seasonally-named export. Declaring this
 * interface in an engine module would put that module inside the scope — where `months < 1` and
 * `monthsObserved >= 1` are integer literals in 1..12 that are not months, and the guard would be
 * born red on exactly the constants the T5 ledger warned T6 about by name. A RE-EXPORT IS NOT A
 * DECLARATION, which is what keeps this file, `forecast.ts` and `statisticalLayer.ts` all outside
 * it — and `monthLiteralGuard.test.ts` asserts all three, so carrying the declaration back into any
 * of them fails the scope assertion before it fails the ban.
 */
export type { SeasonalFactor } from './seasonality';

/**
 * D3's band — the family's OWN observed monthly totals for one category, over the lookback window.
 *
 * `low`/`mid`/`high` are `min`/`median`/`max`, and the names are deliberately not `p10`/`p50`/`p90`
 * or `lower`/`upper`: those spellings imply a distribution and an interval, and there is no
 * distributional model here to support one. The Hebrew the screen renders is in
 * `BAND_LABEL_HE` — "הכי זול שהיה" / "האמצע" / "הכי יקר שהיה" — three things that HAPPENED, not
 * three things that might.
 */
export interface ObservedBand {
  lowILS: number;
  midILS: number;
  highILS: number;
}

export type ForecastBasis =
  | { kind: 'recurring'; recurringId: string; description: string; chargeDay: number }
  | { kind: 'loan'; loanId: string; name: string }
  | { kind: 'insurance'; insuranceId: string; provider: string }
  | { kind: 'installment'; planKey: string; observedNumber: number; totalInstallments: number }
  | {
      kind: 'movingAverage';
      monthsObserved: number;
      periods: string[];
      seasonalFactor: SeasonalFactor | null;
      /**
       * D3's band, CARRIED AND NOT INFERRED, with `bandBasis` naming which of the two `null`s this
       * is — "we looked and there is no range" versus "there are not enough months to look". A
       * renderer that recomputed the basis from `monthsObserved` would be one refactor from
       * drawing a band on an assumption-set amount, which D3 forbids in its own sentence: the user
       * asserted a number; we do not add error bars to their assertion.
       */
      band: ObservedBand | null;
      bandBasis: BandBasis;
    }
  | {
      kind: 'assumption';
      assumptionId: string;
      source: 'user' | 'insight';
      updatedAt: string;
      /** ORDERED STACK, nearest-overridden first. Empty when the assumption displaced nothing. */
      overrides: ForecastBasis[];
    };

export type ForecastLayer = 'certain' | 'statistical' | 'assumption';

export interface ForecastLineItem {
  period: string; // 'YYYY-MM'
  categoryId: string;
  direction: 'income' | 'expense';
  /** Always POSITIVE. `direction` carries the sign; a negative amount here is a bug, not an inflow. */
  amountILS: number;
  /** `layer` is NOT a field — see `layerOf`. */
  basis: ForecastBasis;
}

/**
 * The scopes an assumption can be attached to.
 *
 * MOVED TO `types/finance.ts` IN T2, where the rest of the document shape lives and where Rules'
 * own `data.scopeKind in [...]` list is held against it. Re-exported here because this module is
 * where `resolveCategoryOfScope` consumes it, and because T1's importers name it from here.
 */
export type { AssumptionScopeKind } from '../types/finance';

/**
 * The copy key union that appears INSIDE `ForecastBasis`, re-exported from where its sentences live.
 *
 * THE TYPES ARE RE-EXPORTED AND THE STRINGS ARE NOT, AND THAT ASYMMETRY IS THE SPLIT. `BandBasis`
 * is a discriminant INSIDE `ForecastBasis`, so a consumer naming one has to be able to name the
 * other from the same place — re-exporting it costs nothing and keeps the domain vocabulary whole.
 * A re-exported `BAND_LABEL_HE`, by contrast, would leave this module a second address for every
 * string in the product, and T7c's exact-match guard would be pointing at a module that is not the
 * only way to reach what it is guarding. Copy is imported from `./forecastCopy`, by everyone.
 *
 * !! T7c — THIS LINE USED TO CARRY FOUR TYPES, AND THE OTHER THREE FOLLOWED THEIR CONSUMERS rather
 * than following this one. `MonthConfidence` and `StatisticalGapReason` name shapes inside
 * `statisticalLayer.ts`'s own declared types and are re-exported there; `ForecastInputKey` names
 * the input table `forecast.ts` declares and is re-exported there. The rule all four were obeying
 * is "a module re-exports the copy types that appear inside the types IT declares" — which is one
 * address per type, and no module made a second address for a type it does not itself use.
 */
export type { BandBasis } from './forecastCopy';

/**
 * Derives the layer from the basis. Total over the union; the `never` assignment in the default
 * branch makes adding a union member a BUILD failure, and the throw makes a hand-built object with
 * an unknown kind a loud runtime failure rather than a silent "certain".
 */
export function layerOf(basis: ForecastBasis): ForecastLayer {
  const kind = basis.kind;
  switch (basis.kind) {
    case 'recurring':
    case 'loan':
    case 'insurance':
    case 'installment':
      return 'certain';
    case 'movingAverage':
      return 'statistical';
    case 'assumption':
      return 'assumption';
    default: {
      const exhaustive: never = basis;
      void exhaustive;
      throw new Error(`layerOf: unrecognised basis kind "${String(kind)}"`);
    }
  }
}

/**
 * Maps an assumption's (scopeKind, scopeId) onto the (period, category) bucket precedence resolves
 * in. WITHOUT THIS, D19's most valuable disclosure never fires: a loan-scoped assumption and the
 * loan's own certain item would never share a key, so an assumption could not override a certain
 * item at all, while a test on a hand-built fixture passed.
 *
 * Returns `null` rather than guessing when a recurring scope names an item that is not in the
 * certain set — an assumption pointed at a deleted item must disappear, not land in `'שונות'`.
 */
export function resolveCategoryOfScope(
  scopeKind: AssumptionScopeKind,
  scopeId: string,
  certainItems: ForecastLineItem[]
): string | null {
  switch (scopeKind) {
    case 'recurring': {
      const match = certainItems.find(
        (item) => item.basis.kind === 'recurring' && item.basis.recurringId === scopeId
      );
      return match ? match.categoryId : null;
    }
    case 'loan':
      return CATEGORY_LOAN_REPAYMENT;
    case 'insurance':
      return CATEGORY_INSURANCE;
    case 'category':
      return scopeId;
    case 'seasonality':
      // DELIBERATELY NO CATEGORY — and for a SHARPER reason than `personalTarget`'s below.
      //
      // A seasonality assumption carries `factor` and, per D25's own comment, an UNUSED
      // `amountILS`. Every writer in this repo stamps that as `0`, because Rules require the field
      // to be a non-negative number. So if this returned the category out of `${categoryId}:${monthKey}`,
      // the assumption would land in that (period, category) bucket, D19 lets an assumption beat a
      // statistical item, and `resolveLayerPrecedence` would REPLACE the ₪2,400 groceries estimate
      // WITH ₪0 — silently, in the month the family said was expensive. A multiplier is not a
      // bucket entry; `seasonality.ts` applies it where the estimate is produced instead.
      return null;
    case 'personalTarget':
      // DELIBERATELY NO CATEGORY, and this is a mapping rather than an omission. A personalTarget
      // is what D29(d)'s allowance is computed AGAINST ("כמה נשאר לי להוציא") — it is not a line
      // item competing for a (period, categoryId) bucket. Giving it one would let a child's ₪500
      // target DISPLACE the family's ₪6,000 rent line, because D19 lets an assumption override a
      // CERTAIN item and precedence resolves per bucket. `null` means "overrides nothing", which is
      // exactly right here and is the same answer this function already gives a recurring scope
      // naming a deleted item.
      return null;
    default: {
      const exhaustive: never = scopeKind;
      void exhaustive;
      throw new Error(`resolveCategoryOfScope: unrecognised scope kind "${String(scopeKind)}"`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D20 — precedence as a TOTAL order
// ─────────────────────────────────────────────────────────────────────────────────────────────

type AssumptionBasis = Extract<ForecastBasis, { kind: 'assumption' }>;
type AssumptionLineItem = ForecastLineItem & { basis: AssumptionBasis };

function isAssumptionItem(item: ForecastLineItem): item is AssumptionLineItem {
  return item.basis.kind === 'assumption';
}

const LAYER_RANK: Record<ForecastLayer, number> = { assumption: 0, statistical: 1, certain: 2 };

/**
 * A stable, input-order-independent key for a basis. Every branch is derived from data the basis
 * already carries, so two items that sort equal here are genuinely indistinguishable.
 */
function basisSortKey(basis: ForecastBasis): string {
  switch (basis.kind) {
    case 'recurring':
      return `recurring|${basis.recurringId}`;
    case 'loan':
      return `loan|${basis.loanId}`;
    case 'insurance':
      return `insurance|${basis.insuranceId}`;
    case 'installment':
      return `installment|${basis.planKey}|${basis.observedNumber}`;
    case 'movingAverage':
      return `movingAverage|${basis.monthsObserved}|${basis.periods.join(',')}`;
    case 'assumption':
      return `assumption|${basis.assumptionId}`;
    default: {
      const exhaustive: never = basis;
      void exhaustive;
      throw new Error('basisSortKey: unrecognised basis kind');
    }
  }
}

/**
 * THE TOTAL ORDER, and the reason it exists: `list('family')` returns every member's assumptions,
 * and two members can collide on the same (period, category). `source: 'user'` beats `'insight'` →
 * then the LATEST `updatedAt` → then `id` ascending.
 *
 * The final `id` tiebreak is not decoration. Two parents editing the same category in the same
 * minute is ordinary, and without it the winner is Firestore's iteration order — a headline number
 * no one could reproduce. `id` is available because `createOwnedCollectionRepo.save` stamps
 * `merged.id` into the document body; T2 asserts the repo is the only writer, because
 * `list` returns `d.data()` WITHOUT `d.id` and this tiebreak degenerates silently for anything
 * written another way.
 */
function compareAssumptions(a: AssumptionLineItem, b: AssumptionLineItem): number {
  const sourceRank = (item: AssumptionLineItem) => (item.basis.source === 'user' ? 0 : 1);
  if (sourceRank(a) !== sourceRank(b)) return sourceRank(a) - sourceRank(b);
  if (a.basis.updatedAt !== b.basis.updatedAt) return a.basis.updatedAt > b.basis.updatedAt ? -1 : 1;
  return a.basis.assumptionId < b.basis.assumptionId ? -1 : a.basis.assumptionId > b.basis.assumptionId ? 1 : 0;
}

function compareByBasis(a: ForecastLineItem, b: ForecastLineItem): number {
  const rank = LAYER_RANK[layerOf(a.basis)] - LAYER_RANK[layerOf(b.basis)];
  if (rank !== 0) return rank;
  const keyA = basisSortKey(a.basis);
  const keyB = basisSortKey(b.basis);
  if (keyA !== keyB) return keyA < keyB ? -1 : 1;
  return a.amountILS - b.amountILS;
}

function compareOutput(a: ForecastLineItem, b: ForecastLineItem): number {
  const byPeriod = comparePeriod(a.period, b.period);
  if (byPeriod !== 0) return byPeriod;
  if (a.categoryId !== b.categoryId) return a.categoryId < b.categoryId ? -1 : 1;
  if (a.direction !== b.direction) return a.direction < b.direction ? -1 : 1;
  return compareByBasis(a, b);
}

/**
 * The bucket precedence resolves in.
 *
 * D19 states the key as (period, categoryId). `direction` is carried too, and that is a deliberate
 * REFINEMENT rather than a deviation: without it, an assumption about a category's SPEND would
 * swallow an income line that happens to sit in the same category and month, and the money would
 * vanish rather than be overridden. The refinement can only ever refuse to net two things that
 * mean opposite directions; it can never merge two things D19's key would have kept apart.
 */
function bucketKey(item: ForecastLineItem): string {
  // JSON.stringify, not a delimiter-joined string. Category ids are free Hebrew text written by
  // the extractor and by users, so ANY separator character could occur inside one and merge two
  // buckets that must stay apart. (The first draft of this line used a NUL separator, which is
  // collision-proof but makes the whole SOURCE FILE binary to `grep` and `git diff` — and this
  // repo's guards are grep- and AST-based over source text, so a file they silently skip is a
  // guard that fails open. Caught by the mutation sweep, on this line.)
  return JSON.stringify([item.period, item.categoryId, item.direction]);
}

/**
 * Resolves which source speaks for each (period, category, direction) bucket, and records what the
 * winner displaced.
 *
 * NOT a deduplicator. Two recurring charges in one category in one month are two real payments and
 * both survive — precedence is about which source speaks when sources DISAGREE about the same
 * quantity, never about collapsing facts that do not disagree.
 *
 * An assumption may override a CERTAIN item, not only a statistical one. That is the canonical §4.4
 * scenario: a user who knows the rent rises to ₪6,000 in October is the most valuable assumption in
 * the system. The certain item is not deleted — it is pushed onto `overrides`, nearest-overridden
 * first, so the card can show both numbers and name what was displaced.
 *
 * The returned array is fully sorted by `compareOutput`, which is what makes the whole function
 * order-independent rather than merely "picks the same winner".
 */
export function resolveLayerPrecedence(items: ForecastLineItem[]): ForecastLineItem[] {
  const buckets = new Map<string, ForecastLineItem[]>();
  for (const item of items) {
    const key = bucketKey(item);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const resolved: ForecastLineItem[] = [];
  for (const bucket of buckets.values()) {
    const assumptions = bucket.filter(isAssumptionItem).sort(compareAssumptions);
    if (assumptions.length === 0) {
      resolved.push(...bucket.slice().sort(compareByBasis));
      continue;
    }
    const others = bucket.filter((item) => !isAssumptionItem(item)).sort(compareByBasis);
    const winner = assumptions[0];
    const overrides = [
      ...assumptions.slice(1).map((item) => item.basis as ForecastBasis),
      ...others.map((item) => item.basis),
    ];
    resolved.push({ ...winner, basis: { ...winner.basis, overrides } });
  }
  return resolved.sort(compareOutput);
}
