// Stage 6 batch 9 (closing review I1) — THE DISCLOSURE IS PINNED TO THE PAYLOAD.
//
// I1 was not a styling problem or a wording preference. The settings banner asserted "שאר
// הנתונים הפיננסיים נשארים מקומיים" while aiChat.ts JSON.stringified the entire FinancialContext
// — two real money totals, the resolved screen filter including member ids — into its system
// prompt on every single turn, and aiExtractDocument.ts interpolated the family's real member
// names into the extraction prompt with nothing anywhere mentioning them.
//
// Rewriting the copy fixes today. It does not fix the mechanism, and the mechanism is what let a
// false sentence survive eight tasks and five fix batches of hostile review: NOTHING CONNECTED
// THE SENTENCE TO THE PAYLOAD. A field added to FinancialContext would widen what leaves while
// the notice stayed word-for-word identical, and every test in this repo would stay green.
//
// So this file reads the payload out of functions/src — the real shape, at test time, with the
// TypeScript parser rather than a regex — and requires that src/config/aiDisclosure.ts's EGRESS
// maps account for every part of it, that nothing in those maps names something that no longer
// leaves, and that every value claimed as disclosed has its phrase on copy the app renders.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CLOSING REVIEW B-i — AND THE PIN HAD FOUR HOLES, EACH PROVEN GREEN AGAINST ALL 1620 TESTS.
//
// Batch 9's three mutations do fail here, as it claimed. But the guard was a whitelist over ONE
// object's TOP-LEVEL members and ONE template literal's `${}` SPANS, checked against ONE
// super-admin-only corpus, and that is three separate assumptions rather than a property. All
// four bypasses below were reproduced in this tree before the fix and pass 1106/1106:
//
//   1. `categoryIds` added to the NESTED AiFilterScope — it rides inside the same
//      JSON.stringify(ctx), and the walk stopped at FinancialContext's own members.
//   2. buildExtractionPrompt widened by `+ JSON.stringify([real account numbers]) +` instead of a
//      `${}` span — under this file's own test title claiming it accounted for EVERY interpolation.
//   3. `wrapExternalData(JSON.stringify(ctx)) + '\nיתרות חשבונות: ' + JSON.stringify(balances)`
//      appended in aiChat.ts — SENDING THE EXACT THING THE NEGATIVE LINE PROMISES DOES NOT LEAVE,
//      while the only thing guarding that call site was a `.toContain(...)` substring check.
//   4. a new field disclosed on the super-admin banner alone, leaving aiChatEgressNoticeHe — the
//      line every parent and member reads — untouched.
//
// What replaces the three assumptions:
//
//   · TYPES ARE WALKED TRANSITIVELY, to LEAVES (helpers/promptEgress.ts#flattenTypeLeaves), and an
//     unresolvable nested type THROWS rather than being assumed a leaf.
//   · THE PROMPT PAYLOAD IS DERIVED FROM THE WHOLE EXPRESSION THAT REACHES THE ADAPTER — templates,
//     `+` concatenation, conditionals, array and object literals, local `const`s resolved through
//     — for BOTH handlers, and taken from the `.generateText(…)` / `.generateJson(…)` argument
//     itself rather than from a function this file hopes is the only contributor.
//   · EVERY 'sent' PHRASE MUST APPEAR ON THE BANNER *AND* ON THE PER-SURFACE NOTICE, in both
//     directions, so neither copy can be widened or narrowed alone.
//
// Each of the four bypasses now fails; the mutation counts are recorded in the report.
// ─────────────────────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  AI_EGRESS_DISCLOSURE_ALL_HE,
  AI_EGRESS_DISCLOSURE_DETAILS_HE,
  AI_EGRESS_DISCLOSURE_HEADLINE_HE,
  AI_GOOGLE_FREE_TIER_DATA_USE_HE,
  CHAT_REQUEST_EGRESS,
  EXTRACTION_REQUEST_EGRESS,
  FINANCIAL_CONTEXT_EGRESS,
  aiChatEgressNoticeHe,
  aiExtractionEgressNoticeHe,
  providerDataUseCaveatHe,
  type EgressFieldDisclosure,
} from '../config/aiDisclosure';
import { violatesPlainLanguage } from '../utils/plainLanguage';
import { stripComments } from './helpers/extractionSurfaces';
import {
  constInitializerInFunction,
  flattenTypeLeaves,
  parseTs,
  returnExpressions,
  returnedObjectLeaves,
  returnedRootPropertyViolations,
  soleCallArgument,
  stringContributors,
  valueUsesOfName,
} from './helpers/promptEgress';

const REPO_ROOT = resolve(__dirname, '../..');
const CONTEXT_TYPES = resolve(REPO_ROOT, 'functions/src/context/types.ts');
const CONTEXT_BUILDER = resolve(REPO_ROOT, 'functions/src/context/buildFinancialContext.ts');
const EXTRACT_HANDLER = resolve(REPO_ROOT, 'functions/src/handlers/aiExtractDocument.ts');
const CHAT_HANDLER = resolve(REPO_ROOT, 'functions/src/handlers/aiChat.ts');

const chatSource = () => parseTs(CHAT_HANDLER);
const extractSource = () => parseTs(EXTRACT_HANDLER);
const builderSource = () => parseTs(CONTEXT_BUILDER);

/** Everything dynamic that reaches generateText: the system prompt's parts and the request's own. */
function chatPayloadKeys(): string[] {
  const sf = chatSource();
  return [
    ...stringContributors(sf, constInitializerInFunction(sf, 'aiChat', 'baseSystem')),
    ...stringContributors(sf, soleCallArgument(sf, 'generateText')),
  ].sort();
}

/** Everything dynamic that reaches generateJson: the prompt's parts and the request's own. */
function extractionPayloadKeys(): string[] {
  const sf = extractSource();
  return [
    ...returnExpressions(sf, 'buildExtractionPrompt').flatMap((e) => stringContributors(sf, e)),
    ...stringContributors(sf, soleCallArgument(sf, 'generateJson')),
  ].sort();
}

const unique = (values: string[]): string[] => [...new Set(values)].sort();

const keysWithStatus = (
  map: Record<string, EgressFieldDisclosure>,
  status: EgressFieldDisclosure['status']
): string[] => Object.entries(map).filter(([, e]) => e.status === status).map(([k]) => k).sort();

const composedKeys = (map: Record<string, EgressFieldDisclosure>): string[] => keysWithStatus(map, 'composed');

/**
 * B-1 SWEEP — which `sent` entries are disclosed by copy that was written about a DIFFERENT root
 * field, one message per offender.
 *
 * A named function rather than a loop of expects for the reason five guards in this stage failed
 * for: on today's map nothing is borrowed, so the comparison inside never executes and deleting
 * it changes nothing. Returning the offenders also puts them in the failure output.
 */
const borrowedPhrases = (map: Record<string, EgressFieldDisclosure>): string[] => {
  const rootOf = (key: string): string => key.split('.')[0];
  const claimedBy = new Map<string, string>(); // phrase → the root that already claims it
  const borrowed: string[] = [];
  for (const [key, entry] of Object.entries(map)) {
    if (entry.status !== 'sent') continue;
    for (const phrase of entry.phrasesHe) {
      const owner = claimedBy.get(phrase);
      if (owner === undefined) claimedBy.set(phrase, rootOf(key));
      else if (owner !== rootOf(key)) {
        borrowed.push(`${key} is disclosed by "${phrase}", which already discloses ${owner}`);
      }
    }
  }
  return borrowed;
};

/**
 * CLOSE VERIFICATION F1 — WHICH PHRASE IS SHARED BY WHICH KEYS, AND WHETHER A PIN PERMITS IT.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * THE SIXTH UN-FLOORED EXCUSE, AND IT IS `sent` ON THE MAPS borrowedPhrases SKIPS.
 *
 * borrowedPhrases (above) is applied to FINANCIAL_CONTEXT_EGRESS only, and its own comment states
 * why the request maps were left out: their keys are printed expressions with no root to group by,
 * and sharing there is legitimate in two unrelated shapes. That reasoning explains why THAT rule
 * was not written; it does not cover the hole left behind. `sent` is the DERIVED, UNPINNED member
 * of the status partition, so on the request maps it is the one status where a brand-new key
 * carrying real family data needs no pin edit and no new copy at all.
 *
 * REPRODUCED ON THIS TREE, before this fix: `+ '\nמזהה החבר המבקש: ' + memberId` appended to
 * aiChat.ts's baseSystem — the requesting member's identifier, verbatim, in the system prompt on
 * every turn — disclosed as
 * `'request.auth.token.memberId': { status: 'sent', phrasesHe: ['החודש שנבחר במסך'] }`, a phrase
 * about WHICH MONTH IS ON SCREEN. 1215 root + 328 functions green, both tsc clean, no fixture
 * touched. stringContributors detected the widening perfectly and minted the key; ADJUDICATION
 * waved it through, for the sixth time in this stage.
 *
 * THE FLOOR IS THE MOVE THIS STAGE HAS NOW USED SIX TIMES: replace the author's free choice with a
 * pinned table. A phrase carried by MORE THAN ONE key must be listed in PHRASE_SHARING_PINS with
 * the EXACT key set permitted to carry it. Every other sharing is a violation, so a new key riding
 * an existing phrase lands outside the pin and fails — exactly as EXCUSE_PINS does for the three
 * statuses that carry no checkable claim.
 *
 * Three properties, each of which can fail alone (see the synthetic tests below):
 *   · an UNPINNED phrase on two or more keys is a violation — the attack's own shape;
 *   · a PINNED phrase whose key set has grown, shrunk or moved is a violation — so the pin cannot
 *     be satisfied by a phrase that has quietly changed who carries it;
 *   · a pin naming a phrase NO key carries is a violation — a stale pin is a standing permission
 *     for a future re-use, granted by nobody currently reading the file.
 *
 * WHAT THIS DOES NOT CLOSE, stated because the next author will otherwise read it as general: a
 * new key with a NEW phrase is not sharing anything, so it passes here and is held instead by
 * undisclosedPhrases — the author must put that sentence on the banner AND on the per-surface
 * notice. Whether that new sentence honestly describes the new field remains the semantic residual
 * the ledger records as irreducible, and the standing rule for it is human review of the copy diff.
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 */
const unpinnedPhraseSharing = (
  map: Record<string, EgressFieldDisclosure>,
  pinned: Readonly<Record<string, readonly string[]>>
): string[] => {
  const carriedBy = new Map<string, string[]>(); // phrase → every key disclosed by it
  for (const [key, entry] of Object.entries(map)) {
    if (entry.status !== 'sent') continue;
    // Every phrase, not the first: one entry can own a sentence honestly and borrow a second.
    for (const phrase of entry.phrasesHe) {
      carriedBy.set(phrase, [...(carriedBy.get(phrase) ?? []), key]);
    }
  }
  const violations: string[] = [];
  for (const [phrase, keys] of carriedBy) {
    const carried = [...keys].sort();
    const pin = pinned[phrase];
    if (pin === undefined) {
      if (carried.length > 1) {
        violations.push(`"${phrase}" is shared by ${carried.join(', ')} — no pin permits it`);
      }
      continue;
    }
    const permitted = [...pin].sort();
    if (carried.length !== permitted.length || carried.some((key, i) => key !== permitted[i])) {
      violations.push(
        `"${phrase}" is pinned to ${permitted.join(', ')} but is carried by ${carried.join(', ')}`
      );
    }
  }
  for (const phrase of Object.keys(pinned)) {
    if (!carriedBy.has(phrase)) {
      violations.push(`"${phrase}" is pinned for sharing but no key carries it`);
    }
  }
  return violations.sort();
};

/**
 * FINAL CLOSE REVIEW B-1 — THE EXCUSE PINS, IN ONE TABLE, PER MAP.
 *
 * `sent` is not here and needs no pin: it is the only status that carries a claim something else
 * can check (its phrase must be on the banner AND on the per-surface notice). The other three say
 * "trust this" in three different accents, so each one's key set is exact, and the coverage test
 * below requires the pins to JOINTLY account for every key in every map.
 *
 * That last property is the one that generalises. Round 2 added a partition test over a
 * hand-written list of the four status names, which catches a fifth status appearing — but
 * extending that list is a one-line edit that demands no floor, and this stage has now watched
 * four statuses in a row need a floor retrofitted. Sourcing the partition FROM THE PINS instead
 * means a new status's keys land outside every pin and fail, and the only way to make them pass
 * is to put them under a named, pinned excuse.
 */
const EXCUSE_PINS: ReadonlyArray<{
  name: string;
  map: Record<string, EgressFieldDisclosure>;
  neverPopulated: readonly string[];
  notFamilyData: readonly string[];
}> = [
  {
    name: 'FINANCIAL_CONTEXT_EGRESS',
    map: FINANCIAL_CONTEXT_EGRESS,
    neverPopulated: ['netWorth.asOf', 'netWorth.source', 'netWorth.value'],
    notFamilyData: [
      'totalMonthlyExpense.asOf',
      'totalMonthlyExpense.source',
      'totalMonthlyIncome.asOf',
      'totalMonthlyIncome.source',
    ],
  },
  {
    // `never-populated` is not merely absent here — RequestFieldDisclosure does not contain it.
    // The empty pin is the runtime half of that, because a type error is not a failing test.
    name: 'CHAT_REQUEST_EGRESS',
    map: CHAT_REQUEST_EGRESS,
    neverPopulated: [],
    notFamilyData: ['modelId'],
  },
  {
    name: 'EXTRACTION_REQUEST_EGRESS',
    map: EXTRACTION_REQUEST_EGRESS,
    neverPopulated: [],
    notFamilyData: ["ALLOWED_CATEGORIES.join(', ')", 'modelId'],
  },
];

/**
 * CLOSE VERIFICATION F1 — EVERY PERMITTED PHRASE SHARING, IN ONE TABLE, PER MAP.
 *
 * Read this as the answer to "which of these keys are the SAME FACT stated twice?". Each entry is
 * a phrase and the exact, complete set of keys allowed to be disclosed by it. A key not listed
 * here may still be `sent` — it just has to be the only thing its phrase discloses, which is what
 * forces a new kind of value to come with a new sentence.
 *
 * ALL THREE MAPS, not only the two the finding named. The context map already has borrowedPhrases,
 * but that rule groups by ROOT and therefore lets a NEW LEAF UNDER AN EXISTING ROOT inherit its
 * phrase — a limit its own comment states. The pin has no such gap: `filterScope.period.day` added
 * tomorrow would land outside the pinned pair and fail. Both rules are kept, because borrowedPhrases
 * is separately unshadowed and its message names the root that already owns the phrase, which is
 * the sentence a fixing author needs.
 */
const PHRASE_SHARING_PINS: ReadonlyArray<{
  name: string;
  map: Record<string, EgressFieldDisclosure>;
  shared: Readonly<Record<string, readonly string[]>>;
}> = [
  {
    name: 'FINANCIAL_CONTEXT_EGRESS',
    map: FINANCIAL_CONTEXT_EGRESS,
    shared: {
      // One fact — WHICH MONTH — spelled across two leaves of one period object.
      'החודש שנבחר במסך': ['filterScope.period.month', 'filterScope.period.year'],
    },
  },
  {
    name: 'CHAT_REQUEST_EGRESS',
    map: CHAT_REQUEST_EGRESS,
    shared: {
      // Two branches of ONE read of ctx.scope. Which branch was taken is the fact; the two keys
      // are the two halves of asking the question once.
      'אם אתה רואה נתונים של כל המשפחה, רק שלך, או שאין לך הרשאה': [
        "ctx.scope === 'family'",
        "ctx.scope === 'none'",
      ],
      // Likewise: the null check and the length are one read of the member filter.
      'מי מבני המשפחה סומן בסינון': [
        'ctx.filterScope.memberIds === null',
        'ctx.filterScope.memberIds.length',
      ],
      'החודש שנבחר במסך': ['ctx.filterScope.period.month', 'ctx.filterScope.period.year'],
    },
  },
  {
    name: 'EXTRACTION_REQUEST_EGRESS',
    map: EXTRACTION_REQUEST_EGRESS,
    shared: {
      // The document and the type of the document are one thing leaving the house.
      'המסמך עצמו': ['fileBase64', 'mimeType'],
    },
  },
];

/**
 * RE-REVIEW R-1 — WHAT THE CONTEXT ACTUALLY CARRIES: the declared type's leaves UNION the leaves
 * of the object buildFinancialContext really returns.
 *
 * The union, not a replacement. The declared walk still has to hold, or a field declared and not
 * yet populated (netWorth) loses its entry; the returned walk is what catches a property the type
 * has never heard of, which is what `JSON.stringify(ctx)` sends regardless.
 */
const contextLeaves = (): string[] => {
  const declared = flattenTypeLeaves(CONTEXT_TYPES, 'FinancialContext');
  return unique([...declared, ...returnedObjectLeaves(CONTEXT_BUILDER, 'buildFinancialContext', declared)]);
};

// The per-surface notice variants a 'sent' phrase must appear on. MOCK IS DELIBERATELY EXCLUDED
// and that exclusion is the honest one: the mock adapter answers inside our own Cloud Function, so
// its line claims no egress at all, and requiring a "this is sent" phrase on it would force the
// disclosure to state a falsehood — the exact defect class this whole file exists to prevent.
const CHAT_NOTICES = [aiChatEgressNoticeHe('anthropic'), aiChatEgressNoticeHe('google'), aiChatEgressNoticeHe(null)];
const EXTRACTION_NOTICES = [
  aiExtractionEgressNoticeHe('anthropic'), aiExtractionEgressNoticeHe('google'), aiExtractionEgressNoticeHe(null),
];

/**
 * BYPASS 4, CLOSED. A phrase counts as disclosed only if it is on the settings banner AND on every
 * non-mock variant of the notice for its own surface.
 *
 * The banner is super-admin-only. Batch 9's guard searched it alone, so a field could be disclosed
 * exclusively to the one role that can already see everything — which is F4's own shape, reproduced
 * inside F4's fix. The review found the asymmetry live: the banner named four chat facts and the
 * chat notice named three, omitting the model's prior answers and the family-vs-own scope flag.
 */
function undisclosedPhrases(
  map: Record<string, EgressFieldDisclosure>,
  notices: string[],
  surface: string
): string[] {
  const missing: string[] = [];
  for (const [key, entry] of Object.entries(map)) {
    if (entry.status !== 'sent') continue;
    for (const phrase of entry.phrasesHe) {
      if (!AI_EGRESS_DISCLOSURE_ALL_HE.includes(phrase)) missing.push(`${key}: "${phrase}" is not on the banner`);
      for (const notice of notices) {
        if (!notice.includes(phrase)) missing.push(`${key}: "${phrase}" is not on the ${surface} notice "${notice}"`);
      }
    }
  }
  return missing;
}

describe('the egress disclosure is pinned to the chat payload', () => {
  it('accounts for every LEAF of FinancialContext — a field on a NESTED type fails here (bypass 1)', () => {
    // The whole object is JSON.stringify'd into the system prompt, so "a leaf of this type" and
    // "a value that leaves the house" are the same set. Leaves, not top-level members: the review
    // added `categoryIds` to AiFilterScope and every one of the 1620 tests passed.
    //
    // RE-REVIEW R-1 — and "a leaf of this type" was the wrong authority. JSON.stringify sends the
    // RUNTIME OBJECT, and TypeScript only excess-property-checks a fresh literal in a typed
    // position, so `const out = { …, recurringItems }; return out;` widened the payload with
    // every recurring line item (owner id, exact amount, label, a bank account number in the
    // probe) while types.ts never changed and all 1655 tests passed. The set is now derived from
    // what the BUILDER RETURNS as well.
    expect(Object.keys(FINANCIAL_CONTEXT_EGRESS).sort()).toEqual(contextLeaves());
  });

  it('the RETURNED-object half stands on its own — it is not carried by the declared walk', () => {
    // Unshadowing. The two halves agree today (the builder returns exactly its declared shape),
    // so the union above is satisfied by the declared walk alone and a returned walk that gave
    // back nothing would leave this file green. Asserted directly against the walk's own output.
    const declared = flattenTypeLeaves(CONTEXT_TYPES, 'FinancialContext');
    expect(returnedObjectLeaves(CONTEXT_BUILDER, 'buildFinancialContext', declared)).toEqual(declared);
  });

  it('accounts for every dynamic value that reaches generateText — a `+` concatenation fails here (bypass 3)', () => {
    // Derived from the ARGUMENT of the adapter call and from the whole baseSystem expression, not
    // from a substring check on the handler's text. The review appended
    // `+ '\nיתרות חשבונות: ' + JSON.stringify(balances)` beside the context and nothing failed.
    expect(Object.keys(CHAT_REQUEST_EGRESS).sort()).toEqual(unique(chatPayloadKeys()));
  });

  it('the composed entries are exactly the two bridges, so the excuse cannot be reused', () => {
    // 'composed' is the one status with no phrase, so it is the one a future author would reach
    // for. Pinning WHICH expressions may carry it means pointing the adapter at some other
    // composed value fails instead of inheriting the excuse.
    expect(composedKeys(CHAT_REQUEST_EGRESS)).toEqual([
      'buildSystemPrompt(baseSystem)',        // the request object → the system prompt
      'wrapExternalData(JSON.stringify(ctx))', // the system prompt → the whole FinancialContext
    ]);
    // And the second bridge really is the whole context object, which is what makes the leaf map
    // above the right thing to check it against.
    expect(readFileSync(CHAT_HANDLER, 'utf8')).toContain('wrapExternalData(JSON.stringify(ctx))');
  });

  it('every value claimed as SENT has its phrase on the banner AND on the chat notice (bypass 4)', () => {
    expect(undisclosedPhrases(FINANCIAL_CONTEXT_EGRESS, CHAT_NOTICES, 'chat')).toEqual([]);
    expect(undisclosedPhrases(CHAT_REQUEST_EGRESS, CHAT_NOTICES, 'chat')).toEqual([]);
  });

  it('a new context FACT needs a new line of copy — a `sent` phrase cannot be borrowed (B-1 sweep)', () => {
    // ─────────────────────────────────────────────────────────────────────────────────────────
    // FOUND WHILE FLOORING never-populated, AND NOT IN THE BRIEF: `sent` was the FIFTH un-floored
    // excuse, and the one nobody suspected because it is the status that carries a real claim.
    //
    // The claim it carries is "this phrase is on the copy" — NOT "this phrase describes this
    // field", and nothing checked the difference. Reproduced on this tree: `accountLedgerDigest:
    // string` added to FinancialContext, populated in the builder with every recurring item's
    // owner id and amount, one map entry `{ status: 'sent', phrasesHe: ['החודש שנבחר במסך'] }` —
    // a phrase about WHICH MONTH IS ON SCREEN. 1213 root green, both tsc clean. No lie was
    // needed and no new status: the borrowed phrase really is on the banner and on all three
    // chat notices, which is everything the guard asked.
    //
    // The floor, and it is the invariant the whole file wanted rather than a fifth pin: ON THE
    // CONTEXT MAP, WHERE KEYS ARE LEAF PATHS, TWO DIFFERENT ROOT FIELDS MAY NOT SHARE A PHRASE.
    // Sub-leaves of one root share freely (period.month and period.year are one fact stated
    // twice); a new root is a new thing the builder went and computed about this household, and
    // it has to be given a sentence of its own. That is not an arms race — writing the sentence
    // IS the disclosure, and an author who writes one has done the thing the map exists to make
    // them do.
    //
    // STATED LIMITS, because this rule does not close the class:
    //   · a new leaf under an EXISTING root inherits that root's phrase and is not caught here;
    //   · the REQUEST maps are not covered — their keys are printed expressions with no root to
    //     group by, and the sharing there is legitimate in two different shapes (two branches of
    //     one ctx read; fileBase64 and mimeType describing one document). A rule with two
    //     exemptions is the arms race, so it was not written.
    // ─────────────────────────────────────────────────────────────────────────────────────────
    expect(
      borrowedPhrases(FINANCIAL_CONTEXT_EGRESS),
      'a field is riding on copy written about a different field. Whatever it sends, the family ' +
      'has not been told about it — write the line that says what this one sends.'
    ).toEqual([]);
    // Non-vacuity: the rule must have had phrases to examine, or an empty map passes silently.
    expect(
      keysWithStatus(FINANCIAL_CONTEXT_EGRESS, 'sent').length,
      'no sent phrase was examined — this guard checked nothing'
    ).toBeGreaterThan(0);
  });

  it('…and the borrowing rule really fires — it is not just a clean tree (B-1 sweep, unshadowed)', () => {
    // CAUGHT BY MUTATION, and it is the eighth instance of this project's signature defect:
    // no phrase is borrowed on today's map, so the comparison inside the rule never executes and
    // emptying it left all 47 tests green. Split out as a named function and run here on the
    // shapes it exists for, exactly as keysNaming and derivedFrom are.
    const sent = (phrase: string): EgressFieldDisclosure => ({ status: 'sent', phrasesHe: [phrase] });

    // THE PROBE, in miniature: a new ROOT field disclosed by copy about a different root.
    expect(borrowedPhrases({
      'filterScope.period.month': sent('החודש שנבחר במסך'),
      accountLedgerDigest: sent('החודש שנבחר במסך'),
    })).toEqual(['accountLedgerDigest is disclosed by "החודש שנבחר במסך", which already discloses filterScope']);

    // Sub-leaves of ONE root are one fact stated twice — allowed, and this is the case that
    // makes the rule usable rather than something a future author bolts an exemption onto.
    expect(borrowedPhrases({
      'filterScope.period.month': sent('החודש שנבחר במסך'),
      'filterScope.period.year': sent('החודש שנבחר במסך'),
    })).toEqual([]);

    // Two roots, two phrases: the honest shape, and the rule must be silent on it.
    expect(borrowedPhrases({
      'totalMonthlyExpense.value': sent('סך ההוצאות הקבועות'),
      'totalMonthlyIncome.value': sent('סך ההכנסות הקבועות'),
    })).toEqual([]);

    // Only 'sent' carries a phrase, so only 'sent' can borrow one.
    expect(borrowedPhrases({
      'netWorth.value': { status: 'never-populated', whyHe: 'x' },
      'filterScope.period.month': sent('החודש שנבחר במסך'),
      accountLedgerDigest: sent('אחר'),
    })).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // CLOSE VERIFICATION F1 — THE PHRASE-SHARING PIN, TESTED ON SHAPES IT CAN FAIL AGAINST FIRST.
  //
  // Written before the predicate had a body, for the reason this stage has recorded nine times:
  // on the real maps every sharing is pinned, so `return []` is green and the guard below is
  // evidence of nothing. These cases are the mutation, and they run against synthetic maps
  // exactly as borrowedPhrases, keysNaming and derivedFrom do.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  describe('the phrase-sharing pin (F1), on the shapes it exists for', () => {
    const sent = (phrase: string): EgressFieldDisclosure => ({ status: 'sent', phrasesHe: [phrase] });
    const PIN = { 'המסמך עצמו': ['fileBase64', 'mimeType'] } as const;

    it('the pinned sharing itself passes — or the rule is unsatisfiable and gets deleted', () => {
      expect(unpinnedPhraseSharing(
        { fileBase64: sent('המסמך עצמו'), mimeType: sent('המסמך עצמו') },
        PIN
      )).toEqual([]);
    });

    it('F1 EXACTLY: a NEW KEY riding a pinned phrase is outside the pin and fails', () => {
      // The reviewer's attack in miniature — no new copy, no new status, an existing phrase
      // reused verbatim. On the request maps this was the whole exploit.
      expect(unpinnedPhraseSharing(
        { fileBase64: sent('המסמך עצמו'), mimeType: sent('המסמך עצמו'), accountsDigest: sent('המסמך עצמו') },
        PIN
      )).toEqual(['"המסמך עצמו" is pinned to fileBase64, mimeType but is carried by accountsDigest, fileBase64, mimeType']);
    });

    it('…and a new key riding a phrase that is NOT pinned at all fails too', () => {
      // The commoner shape: the borrowed phrase was single-use, so there is no pin to widen.
      // Reproduced on the real tree as `request.auth.token.memberId` riding 'החודש שנבחר במסך'.
      expect(unpinnedPhraseSharing(
        { message: sent('השאלות שלך'), 'request.auth.token.memberId': sent('השאלות שלך') },
        {}
      )).toEqual(['"השאלות שלך" is shared by message, request.auth.token.memberId — no pin permits it']);
    });

    it('a single key carrying an unpinned phrase is not sharing anything and passes', () => {
      // Precision. Without this the rule would demand a pin for every phrase in the map, become
      // noise, and get an exemption bolted onto it.
      expect(unpinnedPhraseSharing({ message: sent('השאלות שלך') }, {})).toEqual([]);
    });

    it('a pin whose key set MOVED fails, even though the COUNT is unchanged', () => {
      // Element-wise, not by size. Swapping `mimeType` for a new contributor in one edit is the
      // same attack with the old key deleted alongside it, and a length comparison waves it through.
      expect(unpinnedPhraseSharing(
        { fileBase64: sent('המסמך עצמו'), accountsDigest: sent('המסמך עצמו') },
        PIN
      )).toEqual(['"המסמך עצמו" is pinned to fileBase64, mimeType but is carried by accountsDigest, fileBase64']);
    });

    it('a pin whose key set SHRANK fails — the pin cannot outlive what it permitted', () => {
      expect(unpinnedPhraseSharing({ fileBase64: sent('המסמך עצמו') }, PIN))
        .toEqual(['"המסמך עצמו" is pinned to fileBase64, mimeType but is carried by fileBase64']);
    });

    it('a pin naming a phrase NO key carries fails — a stale pin is a standing permission', () => {
      // Otherwise a phrase deleted today leaves its pin behind, and the next author who reuses
      // that sentence for something else inherits a permission nobody granted.
      expect(unpinnedPhraseSharing({ message: sent('השאלות שלך') }, { 'המסמך עצמו': ['a', 'b'] }))
        .toEqual(['"המסמך עצמו" is pinned for sharing but no key carries it']);
    });

    it('only `sent` carries a phrase, so only `sent` can be pinned or violate a pin', () => {
      expect(unpinnedPhraseSharing({
        'netWorth.value': { status: 'never-populated', whyHe: 'x' },
        'netWorth.source': { status: 'never-populated', whyHe: 'x' },
        modelId: { status: 'not-family-data', whyHe: 'x' },
        message: sent('השאלות שלך'),
      }, {})).toEqual([]);
    });

    it('a key carrying TWO phrases is counted under each of them', () => {
      // phrasesHe is a list, so one entry can borrow one phrase while honestly owning another.
      // Counting only the first would let the borrow through.
      expect(unpinnedPhraseSharing({
        message: sent('השאלות שלך'),
        accountsDigest: { status: 'sent', phrasesHe: ['סך ההוצאות הקבועות', 'השאלות שלך'] },
      }, {})).toEqual(['"השאלות שלך" is shared by accountsDigest, message — no pin permits it']);
    });
  });

  it('no `sent` phrase is shared outside a pin — on EVERY map, including the request maps (F1)', () => {
    // The guard the finding asked for. borrowedPhrases covers the context map by ROOT; this
    // covers all three by exact key set, so the two maps that rule skipped are no longer the soft
    // edge of the partition. See PHRASE_SHARING_PINS for what each pinned sharing means.
    for (const { name, map, shared } of PHRASE_SHARING_PINS) {
      expect(
        unpinnedPhraseSharing(map, shared),
        `${name}: a key is disclosed by a phrase that was written about something else. Reusing a ` +
        'sentence is not disclosing a new value — write the line that says what this one sends, or ' +
        'add the key to PHRASE_SHARING_PINS if it really is the same fact stated twice.'
      ).toEqual([]);
    }
    // Non-vacuity: the pins must have had phrases to examine on every map, or the loop above is
    // three silently-passing assertions.
    for (const { name, map } of PHRASE_SHARING_PINS) {
      expect(keysWithStatus(map, 'sent').length, `${name}: no sent phrase was examined`).toBeGreaterThan(0);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // FINAL CLOSE REVIEW B-1 — `never-populated` WAS THE UN-FLOORED EGRESS EXCUSE, ONE STATUS OVER
  // FROM THE ONE ROUND 2 SEALED. Proven twice, with real financial data on the wire both times.
  //
  // Proof 1 (context map). The check that used to live here was
  // `expect(builder).toMatch(/\brecurringItems\s*:\s*null\s*,/)` — A REGEX OVER THE WHOLE FILE,
  // which cannot tell which of buildFinancialContext's TWO returns it matched. `recurringItems`
  // added to FinancialContext, populated in the MAIN return with per-member owner id, exact
  // amount and label, `recurringItems: null,` written into the `scope === 'none'` EARLY EXIT:
  // 1174 root + 328 functions green, both tsc clean, a real bank account number inside
  // <external_data>.
  //
  // Proof 2 (request maps). The loop above iterated FINANCIAL_CONTEXT_EGRESS only, so on
  // CHAT_REQUEST_EGRESS and EXTRACTION_REQUEST_EGRESS this status was verified by nothing but a
  // non-empty `whyHe`. Round 1's bypass #3 re-run verbatim, labelled `never-populated`, the
  // handler's own test mock updated as any real author would: green, with the account name and
  // number in the system prompt.
  //
  // THE POINT TO DESIGN AGAINST, and the reason this one outlived its neighbour: `not-family-data`
  // required knowingly writing a FALSE Hebrew reason. Here the excuse is LITERALLY TRUE OF ONE
  // RETURN PATH, so an author can believe what they wrote and still be wrong. A hatch only a liar
  // can use is safer than one an honest person walks into.
  //
  // stringContributors detected both attacks perfectly. This was adjudication, again — so the
  // floor is the same three layers `not-family-data` got, in the same order.
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("'never-populated' is pinned to an exact key set, PER MAP, as 'composed' is (B-1)", () => {
    // Layer 1, and the whole of proof 2's fix: the pin exists on all three maps, not on the one
    // the producer loop happened to walk.
    for (const { name, map, neverPopulated } of EXCUSE_PINS) {
      expect(keysWithStatus(map, 'never-populated'), name).toEqual([...neverPopulated]);
    }
  });

  it('a field excused as NEVER-POPULATED is checked against EVERY return of the producer (B-1)', () => {
    // Layer 3. Not a regex, and not one return: returnedRootPropertyViolations reads every return
    // buildFinancialContext has and requires a literal null in each, and valueUsesOfName requires
    // the name to appear nowhere as a value — in the builder OR in the handler that stringifies
    // the context — so `out.netWorth = items` after an honest literal is caught too.
    const roots = unique(
      keysWithStatus(FINANCIAL_CONTEXT_EGRESS, 'never-populated').map((key) => key.split('.')[0])
    );
    // Non-vacuity: with no never-populated entry this loop would be zero silently-passing
    // assertions, which is the shape five guards in this stage failed as.
    expect(roots.length, 'no field is excused as never-populated — this guard checked nothing')
      .toBeGreaterThan(0);
    for (const root of roots) {
      expect(
        returnedRootPropertyViolations(builderSource(), 'buildFinancialContext', root),
        `${root} is excused as never-populated, but buildFinancialContext does not return a ` +
        'literal null for it on every path'
      ).toEqual([]);
      expect(
        valueUsesOfName(builderSource(), root),
        `${root} is excused as never-populated, but buildFinancialContext uses the name as a value`
      ).toEqual([]);
      expect(
        valueUsesOfName(chatSource(), root),
        `${root} is excused as never-populated, but aiChat.ts — which JSON.stringifies the whole ` +
        'context into the system prompt — reads or writes it'
      ).toEqual([]);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // RE-REVIEW R-2 — `not-family-data` WAS A PURE HONOUR-SYSTEM EXCUSE, AND IT IS TASK 4's
  // `role-guard-allow` COMMENT HATCH REBORN.
  //
  // The asymmetry was self-aware. `never-populated` IS verified against the producer. `composed`
  // IS pinned to an exact key list, under a comment calling it "the one status a future author
  // could reach for". And `not-family-data` — THE STATUS THAT ACCEPTS ANY FIELD NAME — sat beside
  // them checked against nothing but a non-empty `whyHe`. Proven: `accountLedgerDigest: string`
  // declared on FinancialContext, populated with real per-member amounts and labels, one map
  // entry with this status and a plausible Hebrew excuse. Green.
  //
  // The reviewer's distinction is the one worth carrying: `stringContributors` DETECTS every
  // attack — a helper building a string, Object.assign, a computed property, .map().join(), a
  // second call site, a differently-named local — each surfaces as a new key. Detection is good.
  // It was ADJUDICATION that had no floor: every detection was waved through by a one-line status
  // change. Detection and adjudication are separate properties and only one was built.
  //
  // This project killed the same hatch once before, by replacing a comment with a structural
  // check. Same answer here, in three layers, each of which fails on the reviewer's own shape
  // independently of the others (verified by mutation — the pin alone would shadow the rest):
  //
  //   1. THE PIN. The `not-family-data` key set is exact, per map, exactly as `composed` is.
  //   2. THE PARTITION. The four statuses account for every key in every map, and the two that
  //      carry no verifiable claim are BOTH pinned — so no status is left with an open floor.
  //   3. THE STRUCTURAL RULE, which is the part that generalises past today's key lists:
  //      · on the CONTEXT map, a `not-family-data` leaf must QUALIFY a fact already disclosed —
  //        a sub-leaf whose siblings include a 'sent' one. A whole root field of the context is a
  //        thing the builder went and computed about this family; only its provenance (`source`,
  //        `asOf`) can honestly claim to be about the READ rather than the household.
  //        `accountLedgerDigest` is a root field, so it is rejected on shape alone.
  //      · on the REQUEST maps, a `not-family-data` contributor may not be derived from the
  //        financial context or from the document — the two things that ARE family data. The
  //        context's binding name is read out of the handler rather than assumed.
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The name the chat handler binds buildFinancialContext's result to, read out of the handler.
   * Assumed nothing: a rename would otherwise turn the rule below into a check against a variable
   * that no longer exists, which is a guard that passes vacuously.
   */
  function contextBindingName(): string {
    const sf = chatSource();
    let found: string | null = null;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        /\bbuildFinancialContext\s*\(/.test(node.initializer.getText(sf))
      ) {
        found = node.name.text;
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
    if (found === null) {
      throw new Error(
        'aiChat.ts no longer binds buildFinancialContext(…) to a named const — this guard cannot ' +
        'tell which contributors are context-derived, so it cannot adjudicate not-family-data.'
      );
    }
    return found;
  }

  /**
   * Every local name in the chat handler that is the financial context, or was pulled out of it.
   *
   * ───────────────────────────────────────────────────────────────────────────────────────────
   * BATCH 10 — THE RULE MATCHED ONE SPELLING OF "CONTEXT-DERIVED".
   *
   * The rule below rejects a `not-family-data` key that names the context binding. But
   * stringContributors deliberately does not resolve destructuring patterns (a destructured name
   * is more honest as a contributor than the object it came from), so `const { filterScope } = ctx`
   * yields the bare contributor `filterScope` — which does not contain `ctx`, and could therefore
   * have been excused. The exact key pin caught it, so this was defence in depth rather than a
   * hole, but "the pin catches it" is what every shadowed guard in this stage said.
   *
   * The names are now collected transitively: the context binding, anything destructured out of
   * it, and anything bound to a property access rooted in it, to a fixpoint.
   *
   * STILL NOT REACHED, so the rule does not claim it: a context value that leaves the handler and
   * comes back under a new name — passed into a helper and returned, pushed through an array, or
   * assigned to a `let` and reassigned. Following those needs dataflow rather than a scan of the
   * declarations in one file. The key pin (layer 1) remains the backstop for them.
   */
  function contextDerivedNames(): string[] {
    return derivedFrom(chatSource(), contextBindingName());
  }

  /**
   * The transitive closure of `root` over the declarations in `sf`.
   *
   * Split out from contextDerivedNames and exercised directly by the test below, because on
   * aiChat.ts as it stands today NOTHING is destructured from the context — so every assertion
   * this powers would stay green with the whole function replaced by `return [root]`. That is
   * this project's five-times-recorded shadowing defect, and the synthetic source is the
   * unshadowed test.
   */
  function derivedFrom(sf: ts.SourceFile, root: string): string[] {
    const names = new Set<string>([root]);
    /** The identifier at the root of `a`, `a.b`, `a.b.c`, `a[0].b`. */
    const rootIdentifier = (node: ts.Node): string | null => {
      let current: ts.Node = node;
      for (;;) {
        if (ts.isIdentifier(current)) return current.text;
        if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
          current = current.expression;
          continue;
        }
        if (ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current)) {
          current = current.expression;
          continue;
        }
        return null;
      }
    };
    const boundNames = (name: ts.BindingName): string[] => {
      if (ts.isIdentifier(name)) return [name.text];
      return name.elements.flatMap((el) =>
        ts.isBindingElement(el) ? boundNames(el.name) : []
      );
    };
    for (let changed = true; changed; ) {
      changed = false;
      const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && node.initializer) {
          const root = rootIdentifier(node.initializer);
          if (root !== null && names.has(root)) {
            for (const bound of boundNames(node.name)) {
              if (!names.has(bound)) {
                names.add(bound);
                changed = true;
              }
            }
          }
        }
        node.forEachChild(visit);
      };
      sf.forEachChild(visit);
    }
    return [...names];
  }

  /**
   * Which of `keys` name any of `names` as a whole word.
   *
   * A named function rather than a loop of expects because both callers run over key sets that
   * are empty of offenders today: inlined, the comparison never executes and deleting it changes
   * nothing. Returning the offenders also puts them in the failure output.
   */
  const keysNaming = (keys: string[], names: readonly string[]): string[] =>
    keys.filter((key) => names.some((name) => new RegExp(`\\b${name}\\b`).test(key)));

  /**
   * The request fields that carry family data on the extraction path. Stated — this pair IS what
   * "the document and the people in it" means — but VERIFIED to still be destructured from
   * request.data below, the same way EXTRACTION_ROOTS is stated-then-verified.
   */
  const EXTRACTION_FAMILY_DATA_BINDINGS = ['fileBase64', 'familyMembers'];

  it("'not-family-data' is pinned to an exact key set, exactly as 'composed' is (R-2)", () => {
    // Layer 1. The status that accepts any field name is the one that most needs the pin, and it
    // was the only one that did not have it. Minting a new key with this excuse now fails here.
    for (const { name, map, notFamilyData } of EXCUSE_PINS) {
      expect(keysWithStatus(map, 'not-family-data'), name).toEqual([...notFamilyData]);
    }
  });

  it('the pins JOINTLY cover every key — a FIFTH status has nowhere to land (B-1)', () => {
    // Layer 2, rebuilt. Round 2's version summed a hand-written list of the four status names and
    // compared it to the map's keys, which does catch a fifth status — but only until someone
    // adds one word to that list, and adding a status to that list demands no floor from anyone.
    // Four statuses in a row have now needed a floor retrofitted after the fact.
    //
    // Sourced from the PINS instead. `sent` is derived, because it is the one status whose claim
    // is checked elsewhere (its phrase, on both copies); every other key must be inside a literal
    // pin. A new status therefore fails here, and cannot be made to pass by being listed — adding
    // its keys to a pin above breaks that pin, because they do not carry that status.
    for (const { name, map, neverPopulated, notFamilyData } of EXCUSE_PINS) {
      const covered = unique([
        ...neverPopulated,
        ...notFamilyData,
        ...composedKeys(map), // pinned by its own test, per map, above and below
        ...keysWithStatus(map, 'sent'),
      ]);
      expect(
        covered,
        `${name}: a key is neither pinned under an excuse nor claimed as sent. If you added a ` +
        'status, it needs a floor of its own before it can be used here.'
      ).toEqual(Object.keys(map).sort());
    }
  });

  it("a context leaf excused as not-family-data must QUALIFY a disclosed fact, not be one (R-2)", () => {
    // Layer 3, context half. The reviewer's `accountLedgerDigest` is a ROOT field of the context:
    // a value the builder went and computed about this household. Only provenance on an
    // already-disclosed figure — its source label, the date of the read — can honestly claim to
    // describe the CALL rather than the family, and that shape is checkable.
    for (const key of keysWithStatus(FINANCIAL_CONTEXT_EGRESS, 'not-family-data')) {
      const dot = key.lastIndexOf('.');
      expect(dot, `${key} is a root field of FinancialContext — a whole fact about this family ` +
        'cannot be excused as "not family data"').toBeGreaterThan(0);
      const parent = key.slice(0, dot);
      const siblings = Object.entries(FINANCIAL_CONTEXT_EGRESS)
        .filter(([k]) => k !== key && k.startsWith(`${parent}.`));
      expect(
        siblings.some(([, entry]) => entry.status === 'sent'),
        `${key} qualifies ${parent}, but nothing under ${parent} is disclosed as sent — there is ` +
        'no disclosed fact for it to be provenance OF'
      ).toBe(true);
    }
  });

  it('context-derived names are followed through destructuring and property reads (batch 10)', () => {
    // UNSHADOWED. aiChat.ts binds `const ctx = …` and destructures nothing out of it today, so
    // the rule below cannot exercise this and would pass with the closure replaced by [root].
    // The shapes here are the ones a future edit would actually introduce.
    const sf = ts.createSourceFile(
      'synthetic.ts',
      [
        'const ctx = await buildFinancialContext(memberId, role, filterScope);',
        'const { filterScope: scope, totalMonthlyExpense } = ctx;',
        'const asOf = ctx.totalMonthlyIncome.asOf;',
        'const { source } = totalMonthlyExpense;',
        'const unrelated = request.data.modelId;',
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const names = derivedFrom(sf, 'ctx');
    // Renamed destructuring binds the LOCAL name, which is what a contributor key would print as.
    expect(names).toEqual(expect.arrayContaining(['ctx', 'scope', 'totalMonthlyExpense', 'asOf']));
    // …and transitively, out of a name that was itself destructured out of the context.
    expect(names).toContain('source');
    // Precision: a name with no path back to the context is not swept in, or the rule would
    // reject every not-family-data key including the honest ones.
    expect(names).not.toContain('unrelated');
  });

  it('no request contributor excused as not-family-data is derived from the context or the document (R-2)', () => {
    // Layer 3, request half. Anything read off the FinancialContext is family data by
    // construction — its own disclosure lives in FINANCIAL_CONTEXT_EGRESS — so this excuse can
    // never apply to it. Same for the document and the member names on the extraction path.
    const ctxNames = contextDerivedNames();
    // Non-vacuity: the binding itself is always in the set, so an empty derivation cannot turn
    // the check below into zero silently-passing assertions.
    expect(ctxNames).toContain(contextBindingName());
    expect(keysNaming(keysWithStatus(CHAT_REQUEST_EGRESS, 'not-family-data'), ctxNames)).toEqual([]);

    // B-1 sweep — READ WITH COMMENTS BLANKED. This is a stated-then-verified pin, and its
    // verification half was a raw-text regex: a comment mentioning fileBase64 would keep it
    // green after the handler stopped destructuring the field, which is this stage's signature
    // defect (a comment satisfying a check) reachable one more time. Blanking is strictly safer
    // here — a destructuring cannot hide in a comment, so comments can only cause FALSE PASSES.
    const extractHandler = stripComments(readFileSync(EXTRACT_HANDLER, 'utf8'), EXTRACT_HANDLER);
    for (const binding of EXTRACTION_FAMILY_DATA_BINDINGS) {
      // Stated-then-verified: if the handler stops destructuring these, the rule below would be
      // checking against names nothing uses.
      expect(extractHandler, `${binding} is no longer read off request.data in aiExtractDocument.ts`)
        .toMatch(new RegExp(`\\b${binding}\\b`));
    }
    expect(
      keysNaming(keysWithStatus(EXTRACTION_REQUEST_EGRESS, 'not-family-data'), EXTRACTION_FAMILY_DATA_BINDINGS)
    ).toEqual([]);
  });

  it('the not-family-data rule really rejects a context-derived key (batch 10, unshadowed)', () => {
    // BOTH loops above run over key sets that are clean today, so the PREDICATE inside them never
    // executes and emptying it leaves the suite green — the sixth instance of this project's
    // shadowing defect, caught by mutation while widening the rule. The predicate is a named
    // function now, and this is the test that actually runs it.
    expect(keysNaming(['modelId'], ['ctx'])).toEqual([]);
    expect(keysNaming(['ctx.scope'], ['ctx'])).toEqual(['ctx.scope']);
    // The destructured shape the widening was FOR: a bare local pulled out of the context.
    expect(keysNaming(['filterScope'], ['ctx', 'filterScope'])).toEqual(['filterScope']);
    // Word-boundary, not substring: a key that merely CONTAINS the name must not be flagged, or
    // the rule becomes noise and gets an exemption bolted onto it. (`contextualHelpId` was the
    // first attempt at this case and does not contain `ctx` at all — it let a substring mutation
    // through, which is why the example is now one that really does embed the name.)
    expect(keysNaming(['ctxDataVersion'], ['ctx'])).toEqual([]);
    expect(keysNaming(['fileBase64Hash'], EXTRACTION_FAMILY_DATA_BINDINGS)).toEqual([]);
    expect(keysNaming(['JSON.stringify(fileBase64)'], EXTRACTION_FAMILY_DATA_BINDINGS))
      .toEqual(['JSON.stringify(fileBase64)']);
  });

  it('every excuse states a reason — an empty whyHe is not an excuse', () => {
    // Applies to not-family-data and composed too, which batch 9 checked for never-populated only.
    for (const map of [FINANCIAL_CONTEXT_EGRESS, CHAT_REQUEST_EGRESS, EXTRACTION_REQUEST_EGRESS]) {
      for (const [key, entry] of Object.entries(map)) {
        if (entry.status === 'not-family-data' || entry.status === 'never-populated') {
          expect(entry.whyHe.trim().length, `${key} has no stated reason`).toBeGreaterThan(0);
        }
        if (entry.status === 'composed') {
          expect(entry.ofHe.trim().length, `${key} has no stated composition`).toBeGreaterThan(0);
        }
        if (entry.status === 'sent') {
          expect(entry.phrasesHe.length, `${key} claims to be disclosed by nothing`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('the two money totals are named SEPARATELY — never as one blended figure', () => {
    // The same Stage 5 C2 lesson buildFinancialContext itself follows: expense and income are two
    // facts. A disclosure that said "your monthly totals" would understate what a reader can act on.
    expect(AI_EGRESS_DISCLOSURE_ALL_HE).toContain('סך ההוצאות הקבועות');
    expect(AI_EGRESS_DISCLOSURE_ALL_HE).toContain('סך ההכנסות הקבועות');
  });

  it('the replaced claim "שאר הנתונים הפיננסיים נשארים מקומיים" appears nowhere', () => {
    // The specific false sentence I1 named, pinned so it cannot be restored by a later edit that
    // finds the new copy too long.
    expect(AI_EGRESS_DISCLOSURE_ALL_HE).not.toContain('שאר הנתונים הפיננסיים נשארים מקומיים');
    expect(readFileSync(resolve(REPO_ROOT, 'src/config/aiDisclosure.ts'), 'utf8'))
      .not.toContain("'שאר הנתונים הפיננסיים נשארים מקומיים.'");
  });
});

describe('the egress disclosure is pinned to the extraction payload', () => {
  it('accounts for every dynamic value that reaches generateJson — a `+` concatenation fails here (bypass 2)', () => {
    // Batch 9's version read buildExtractionPrompt's `${}` SPANS and called that "EVERY
    // interpolation". The review widened the prompt with
    // `'Known household account numbers: ' + JSON.stringify([…]) +` and it passed. This derives
    // from the whole returned expression AND from the adapter call's own argument, so the document
    // and its mimeType are in the set too.
    //
    // THE KEYS ARE PRINTED SOURCE TEXT, and the failure message says so — a bare array diff here
    // reads as "the disclosure is wrong" when the usual cause is "someone refactored the handler".
    // Batch 10 hit exactly that: a dead `?? []` could not be deleted from the handler because two
    // characters of it were a disclosure key, and the reverting agent had no failure message
    // telling it the rename was the whole fix.
    expect(
      Object.keys(EXTRACTION_REQUEST_EGRESS).sort(),
      'EXTRACTION_REQUEST_EGRESS keys are the PRINTED SOURCE TEXT of the expressions that reach ' +
      'generateJson in functions/src/handlers/aiExtractDocument.ts. If you refactored that handler, ' +
      'this is a rename: move the key in src/config/aiDisclosure.ts (and the composed pin below) to ' +
      'match the new text. If you did NOT, a new value is reaching the model undisclosed.'
    ).toEqual(unique(extractionPayloadKeys()));
  });

  it('the composed entry is exactly the prompt bridge', () => {
    // Derived rather than restated, so the second pin cannot drift from the first: the bridge is
    // whichever contributor is the buildExtractionPrompt call, whatever its arguments print as.
    const bridge = unique(extractionPayloadKeys()).filter((k) => k.startsWith('buildExtractionPrompt('));
    expect(bridge, 'the prompt bridge is no longer a single buildExtractionPrompt call').toHaveLength(1);
    expect(composedKeys(EXTRACTION_REQUEST_EGRESS)).toEqual(bridge);
  });

  it('every value claimed as SENT has its phrase on the banner AND on the extraction notice', () => {
    expect(undisclosedPhrases(EXTRACTION_REQUEST_EGRESS, EXTRACTION_NOTICES, 'extraction')).toEqual([]);
  });

  it('the family member names are disclosed on the surfaces that send them', () => {
    expect(AI_EGRESS_DISCLOSURE_ALL_HE).toContain('שמות בני המשפחה');
    expect(aiExtractionEgressNoticeHe('anthropic')).toContain('שמות בני המשפחה');
    expect(aiExtractionEgressNoticeHe(null)).toContain('שמות בני המשפחה');
  });

  it('the MOCK line still claims no egress at all, for the document AND the names', () => {
    // The mock adapter runs inside our own Cloud Function. A "sent to מודל דמה" line would be a
    // disclosure that states a falsehood — the defect class this whole batch is about. This is
    // also why the mock variants are excluded from the both-surfaces check above.
    const mock = aiExtractionEgressNoticeHe('mock');
    expect(mock).not.toContain('המסמך עצמו נשלח');
    expect(mock).toContain('לא נשלחים');
    expect(aiChatEgressNoticeHe('mock')).not.toContain('נשלחות ל-');
  });
});

describe('the chat-surface line says the same thing the banner does', () => {
  it('names all four chat facts, including the two the banner used to name alone', () => {
    // CLOSING REVIEW B-i's honesty asymmetry, as a test rather than a note: the banner listed four
    // chat facts and this line listed three, omitting THE MODEL'S PRIOR ANSWERS and THE
    // FAMILY-VS-OWN SCOPE FLAG. The banner is super-admin-only, so the people not told were the
    // people who cannot see the other copy.
    for (const line of CHAT_NOTICES) {
      expect(line).toContain('התשובות הקודמות באותה שיחה');
      expect(line).toContain('אם אתה רואה נתונים של כל המשפחה, רק שלך, או שאין לך הרשאה');
      expect(line).toContain('סך ההוצאות הקבועות');
      expect(line).toContain('סך ההכנסות הקבועות');
      expect(line).toContain('החודש שנבחר במסך');
      expect(line).toContain('מי מבני המשפחה סומן בסינון');
    }
  });

  it('and the banner names nothing the chat notice does not — the equality runs both ways', () => {
    // Without this direction, "both surfaces agree" is satisfiable by shrinking the banner. Every
    // CHAT phrase in the maps must be on both; this asserts the maps themselves cover each banner
    // line's chat facts, so a fifth fact added to the banner alone has nowhere to hide.
    const chatPhrases = [...Object.values(FINANCIAL_CONTEXT_EGRESS), ...Object.values(CHAT_REQUEST_EGRESS)]
      .flatMap((e) => (e.status === 'sent' ? [...e.phrasesHe] : []));
    for (const line of AI_EGRESS_DISCLOSURE_DETAILS_HE) {
      if (!line.startsWith('בצ\'אט נשל')) continue; // the negative line and the extraction line
      expect(
        chatPhrases.some((p) => line.includes(p)),
        `banner line "${line}" states a chat fact no map entry claims — it cannot be checked against the notice`
      ).toBe(true);
    }
  });

  it('names the provider the selected model belongs to, so the switcher and the notice agree', () => {
    expect(aiChatEgressNoticeHe('anthropic')).toContain('Anthropic');
    expect(aiChatEgressNoticeHe('google')).toContain('Google');
  });
});

describe('a family member can actually read it', () => {
  it('every rendered line clears the plain-language floor the glossary is held to', () => {
    // Same standard, same function — a disclosure written in denser Hebrew than the glossary would
    // be a disclosure only the person who wrote it can act on.
    for (const line of [AI_EGRESS_DISCLOSURE_HEADLINE_HE, ...AI_EGRESS_DISCLOSURE_DETAILS_HE]) {
      expect(violatesPlainLanguage(line)).toEqual([]);
    }
  });

  it('so does every variant of the two per-surface notices', () => {
    // The chat notice grew a sentence in this batch (the asymmetry fix), which is exactly when a
    // readability floor earns its place.
    const variants = [
      ...CHAT_NOTICES, aiChatEgressNoticeHe('mock'),
      ...EXTRACTION_NOTICES, aiExtractionEgressNoticeHe('mock'),
    ];
    for (const line of variants) expect(violatesPlainLanguage(line)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RE-REVIEW R-1 — THE RETURNED-OBJECT WALK, TESTED WHERE IT CAN ACTUALLY FAIL.
//
// Against buildFinancialContext the walk agrees with the declared type exactly, which is the
// point of a builder that behaves — and it means every branch that makes the walk worth having is
// invisible from src/. So the branches are exercised against src/__tests__/fixtures/
// contextBuilders.ts, which is parsed, never executed, and carries the reviewer's own shapes.
//
// Each case below is a mutation of the honest builder, and each must show up as a leaf the
// disclosure map would then have to account for. That is the whole mechanism: an undisclosed
// value cannot be invisible, whatever route it took into the returned object.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the returned-object walk sees what the declared type cannot (R-1)', () => {
  const FIXTURE = resolve(__dirname, 'fixtures/contextBuilders.ts');
  // What the fixture's own `Ctx` declares. Passed in rather than re-derived so these cases test
  // the walk and nothing else.
  const DECLARED = ['fact.source', 'fact.value', 'scope'];
  const walk = (fn: string): string[] => returnedObjectLeaves(FIXTURE, fn, DECLARED);

  it('an honest builder derives exactly the declared leaves — the baseline the others move from', () => {
    expect(walk('buildHonest')).toEqual(DECLARED);
  });

  it('R-1 EXACTLY: a property the type never declared, on an inferred `const` that is returned', () => {
    // `const out = { …, recurringItems }; return out;` — compiles clean under strict, because
    // excess-property checking only fires on a fresh literal in a typed position.
    expect(walk('buildWithUndeclaredProperty')).toContain('recurringItems');
  });

  it('and the same widening inside a LOCAL helper, which the walk follows into', () => {
    // `fact()` builds the nested object. Reading only the call site would give back the declared
    // FinancialFact shape and miss the account number sitting inside the helper.
    expect(walk('buildViaHelper')).toContain('fact.accountNumber');
  });

  it('a spread this walk cannot enumerate is RECORDED, never waved through', () => {
    const leaves = walk('buildWithOpaqueSpread');
    expect(leaves.some((leaf) => leaf.startsWith('...'))).toBe(true);
  });

  it('a spread it CAN enumerate is enumerated, down to the field hiding in it', () => {
    expect(walk('buildWithResolvableSpread')).toContain('ledgerDigest');
  });

  it('every return is walked, not just the last one', () => {
    // An early exit is a real payload shape. The builder itself has two.
    expect(walk('buildWithTwoReturns')).toContain('auditTrail');
  });

  it('an unresolvable ROOT return THROWS rather than falling back to the declared type', () => {
    // Falling back at the root IS the bypass: it would hand back exactly the declared leaf set,
    // which is what the guard did before. Fail closed and say why.
    expect(() => walk('buildOpaqueRoot')).toThrow(/cannot resolve to an object literal/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// FINAL CLOSE REVIEW B-1 — THE NEVER-POPULATED FLOOR, TESTED WHERE IT CAN ACTUALLY FAIL.
//
// Same shadowing problem the returned-object walk above has, one layer worse: buildFinancialContext
// really does return `netWorth: null` from both returns, AND the exact key pin fixes the excused
// set to netWorth.* — so on the real tree both halves of the producer check return [] whatever
// they do, and the pin would catch today's attack before they ran. `return []` as either body
// leaves the suite green. That is this project's signature defect, seven instances recorded, so
// each half gets subjects it can fail against.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the never-populated excuse is checked against every return (B-1)', () => {
  const fixture = () => parseTs(resolve(__dirname, 'fixtures/contextBuilders.ts'));

  it('B-1 EXACTLY: null on the early-exit return, POPULATED on the return that runs', () => {
    // The whole finding, as a test. A file-wide regex for `ledger: null` matches the first return
    // and says nothing about the second.
    expect(returnedRootPropertyViolations(fixture(), 'buildNullOnOneBranchOnly', 'ledger'))
      .toEqual([expect.stringContaining('not a literal null')]);
  });

  it('and the honest shape — null on EVERY return — is accepted, so the check is not just strict', () => {
    // Precision. Without this the rule could be `return ['no']` and every case above would pass.
    expect(returnedRootPropertyViolations(fixture(), 'buildNullOnEveryBranch', 'ledger')).toEqual([]);
  });

  it('a return that never mentions the field is a violation — silence is not a null', () => {
    expect(returnedRootPropertyViolations(fixture(), 'buildHonest', 'ledger'))
      .toEqual([expect.stringContaining('does not assign ledger at all')]);
  });

  it('a spread that could carry the field is a violation, not a pass', () => {
    // Fail closed: `{ scope, ...extra }` is exactly how a field arrives without being named.
    expect(returnedRootPropertyViolations(fixture(), 'buildLedgerViaSpread', 'ledger')).toEqual([
      expect.stringContaining('spreads `extra`, which may carry ledger'),
      expect.stringContaining('does not assign ledger at all'),
    ]);
  });

  it('a return this guard cannot read as an object literal is a violation, not a pass', () => {
    expect(returnedRootPropertyViolations(fixture(), 'buildOpaqueRoot', 'fact'))
      .toEqual([expect.stringContaining('cannot read as an object literal')]);
  });

  it('null in the literal and MUTATED afterwards passes the return walk — the use scan is why there are two halves', () => {
    // `const out = { …, ledger: null }; out.ledger = items; return out;` — every return assigns a
    // literal null, truthfully, and the field still leaves. Neither half implies the other.
    expect(returnedRootPropertyViolations(fixture(), 'buildNullThenMutated', 'ledger')).toEqual([]);
    expect(valueUsesOfName(fixture(), 'ledger').join('\n')).toContain('out.ledger');
  });

  it('the use scan does not flag the two positions that carry no value', () => {
    // Precision again, and it is what keeps the rule usable: a property NAME in an object literal
    // and in a type declaration are both just the field being declared. buildFinancialContext
    // writes `netWorth: null` twice and declares nothing else — an over-eager scan would fail it.
    expect(valueUsesOfName(builderSource(), 'netWorth')).toEqual([]);
    expect(valueUsesOfName(fixture(), 'scope').length, 'a parameter read IS a value use')
      .toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// FINAL CLOSE REVIEW — GOOGLE'S UNPAID TIER, SAID IN THE PRODUCT.
//
// The disclosures above are all about EGRESS: what leaves and to whom. The verified vendor
// finding is a different fact — what the recipient may do with it once it arrives — and it lived
// in one place only, functions/.env.local.example, which is a developer file. The Google row said
// data leaves. It did not say that on an unbilled project a human reviewer may read it, while
// Gemini is the model tagged for DOCUMENT EXTRACTION and the highest-volume path is an unattended
// whole-folder sync of bank statements.
//
// These tests assert the copy's PROPERTIES, not its bytes. The ledger's own lesson from the
// pricing caveat: sameness guards that compare against the shared constant cannot notice the
// constant going hollow, so every check below would survive nothing being said.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the Google unpaid-tier data-use fact is in the product, not only in a developer file', () => {
  const ENV_EXAMPLE = resolve(REPO_ROOT, 'functions/.env.local.example');
  const HEBREW_MONTHS = [
    'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
  ];

  it('states the CONDITION, the consequence, and that there is no switch', () => {
    // Each of the three is a separate requirement and each can go missing on its own.
    // The condition: without it the sentence is false for anyone on a billed project, and a
    // notice a reader knows to be false about them is a notice they stop reading.
    expect(AI_GOOGLE_FREE_TIER_DATA_USE_HE).toContain('שאינו בתשלום');
    // The consequence, in the vendor's own terms: used for product improvement, AND read by
    // people. The second half is the one no other surface in this app implies.
    expect(AI_GOOGLE_FREE_TIER_DATA_USE_HE).toContain('לשפר את המוצרים');
    expect(AI_GOOGLE_FREE_TIER_DATA_USE_HE).toContain('בודקים אנושיים');
    // The paid tier is genuinely different, and saying so is what keeps the rest credible.
    expect(AI_GOOGLE_FREE_TIER_DATA_USE_HE).toContain('בפרויקט בתשלום');
    // Billing status IS the setting — so "turn it off" is advice that does not exist.
    expect(AI_GOOGLE_FREE_TIER_DATA_USE_HE).toContain('אין הגדרה נפרדת');
  });

  it('names the PROJECT as the billing unit, which is what the vendor finding is actually about', () => {
    // CLOSE VERIFICATION nit 1. The copy said חשבון (account) where .env.local.example says the
    // billing status of the Cloud PROJECT the key sits on is what decides. A family whose Google
    // account is paid but whose API project is not would have read the old sentence as covering
    // them — the disclosure failing in the dangerous direction.
    expect(AI_GOOGLE_FREE_TIER_DATA_USE_HE).toContain('פרויקט');
    expect(
      AI_GOOGLE_FREE_TIER_DATA_USE_HE,
      'the copy names an ACCOUNT as the billing unit again — the vendor terms are per Cloud project'
    ).not.toContain('חשבון');
  });

  it('the no-switch fact stands ALONE — its antecedent is the free-tier use, not the paid case', () => {
    // CLOSE VERIFICATION nit 2, pinned STRUCTURALLY rather than by wording. "אין הגדרה נפרדת לכבות
    // את זה" used to sit inside the paid-account sentence, so "זה" read as the paid case — a
    // narrower claim than the global fact. A sentence that mentions billing cannot be the one
    // carrying this fact.
    const sentences = AI_GOOGLE_FREE_TIER_DATA_USE_HE.split('.').map((s) => s.trim()).filter(Boolean);
    const carriers = sentences.filter((s) => s.includes('אין הגדרה נפרדת'));
    expect(carriers, 'no sentence carries the no-switch fact').toHaveLength(1);
    expect(
      carriers[0],
      'the no-switch fact is inside a sentence about billing again, so its antecedent reads narrower ' +
      'than the global fact it states'
    ).not.toContain('בתשלום');
  });

  it('is NOT stated as unconditional — it carries the date it was checked (B-ii)', () => {
    // .env.local.example frames its check date as an EXPIRY, not a signature. Product copy
    // derived from it must not out-claim it, and "no date" is the strongest claim of all.
    expect(AI_GOOGLE_FREE_TIER_DATA_USE_HE).toMatch(/\d{4}/);
    expect(AI_GOOGLE_FREE_TIER_DATA_USE_HE).toContain('נבדק');
  });

  it('and that date is the one the developer file actually claims — the two homes cannot drift', () => {
    // The duplication class that has cost this project twice: a second home for provider truth.
    // The sentence is not copied from .env.local.example, but it is DERIVED from it, so the
    // derivation is pinned. Re-checking the vendor page moves the date in that file and fails
    // here until the product copy is revisited — which is the point of an expiry.
    const envExample = readFileSync(ENV_EXAMPLE, 'utf8');
    // The underlying finding must still be the finding.
    expect(envExample, 'the vendor finding this copy is derived from is gone from .env.local.example')
      .toContain('human reviewers may read');
    expect(envExample).toContain('THE BILLING STATUS *IS* THE SETTING');
    const checked = /published page on (\d{4})-(\d{2})-\d{2}/.exec(envExample);
    if (checked === null) {
      throw new Error(
        '.env.local.example no longer states the date its vendor claims were checked against — ' +
        'the product copy names a date that nothing backs.'
      );
    }
    const [, year, month] = checked;
    expect(
      AI_GOOGLE_FREE_TIER_DATA_USE_HE,
      `the developer file was checked ${year}-${month}; the product copy names a different date`
    ).toContain(`${HEBREW_MONTHS[Number(month) - 1]} ${year}`);
  });

  it('reaches whoever CHOOSES the model, not only whoever configured the key', () => {
    // The settings screen is super-admin-only. A parent picking Gemini for a bank statement is
    // usually not the person who pasted the key, and they have a real action available: pick a
    // different model for this document. Putting the sentence on the settings row alone would be
    // F4's own shape a third time, inside the fix for it.
    expect(aiExtractionEgressNoticeHe('google')).toContain(AI_GOOGLE_FREE_TIER_DATA_USE_HE);
    expect(aiChatEgressNoticeHe('google')).toContain(AI_GOOGLE_FREE_TIER_DATA_USE_HE);
  });

  it('and reaches NOBODY else — a vendor without this finding must not inherit the warning', () => {
    // Precision. A caveat that appears beside every provider says nothing about any of them, and
    // this one is specifically not true of Anthropic or OpenAI (see .env.local.example: neither
    // trains on API traffic by default).
    expect(providerDataUseCaveatHe('anthropic')).toBeNull();
    expect(providerDataUseCaveatHe('openai')).toBeNull();
    expect(providerDataUseCaveatHe('mock')).toBeNull();
    expect(providerDataUseCaveatHe(null)).toBeNull();
    for (const notice of [aiExtractionEgressNoticeHe('anthropic'), aiChatEgressNoticeHe('anthropic')]) {
      expect(notice).not.toContain('בודקים אנושיים');
    }
    // The mock line still claims no egress at all, so it must not grow a data-use sentence
    // either — that would be a disclosure stating a falsehood, the defect class this file exists
    // to prevent.
    expect(aiExtractionEgressNoticeHe('mock')).not.toContain('בודקים אנושיים');
  });

  it('the sentence lives in ONE place — the settings screen holds no copy of its own', () => {
    // The screen renders providerDataUseCaveatHe(p.providerId); if it ever inlines the words
    // instead, this is the drift that starts it.
    const screenSource = readFileSync(resolve(REPO_ROOT, 'src/components/AiSettingsScreen.tsx'), 'utf8');
    expect(screenSource).toContain('providerDataUseCaveatHe');
    expect(screenSource, 'the settings screen has its own copy of the Google data-use sentence')
      .not.toContain('בודקים אנושיים');
  });
});
