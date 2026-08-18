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
  CHAT_REQUEST_EGRESS,
  EXTRACTION_REQUEST_EGRESS,
  FINANCIAL_CONTEXT_EGRESS,
  aiChatEgressNoticeHe,
  aiExtractionEgressNoticeHe,
  type EgressFieldDisclosure,
} from '../config/aiDisclosure';
import { violatesPlainLanguage } from '../utils/plainLanguage';
import {
  constInitializerInFunction,
  flattenTypeLeaves,
  parseTs,
  returnExpressions,
  returnedObjectLeaves,
  soleCallArgument,
  stringContributors,
} from './helpers/promptEgress';

const REPO_ROOT = resolve(__dirname, '../..');
const CONTEXT_TYPES = resolve(REPO_ROOT, 'functions/src/context/types.ts');
const CONTEXT_BUILDER = resolve(REPO_ROOT, 'functions/src/context/buildFinancialContext.ts');
const EXTRACT_HANDLER = resolve(REPO_ROOT, 'functions/src/handlers/aiExtractDocument.ts');
const CHAT_HANDLER = resolve(REPO_ROOT, 'functions/src/handlers/aiChat.ts');

const chatSource = () => parseTs(CHAT_HANDLER);
const extractSource = () => parseTs(EXTRACT_HANDLER);

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

  it('a field excused as NEVER-POPULATED is verified against the producer, not taken on trust', () => {
    // This is the status a future author would reach for to wave a live field through. So the
    // excuse is checked: buildFinancialContext must literally assign null to the ROOT field.
    const builder = readFileSync(CONTEXT_BUILDER, 'utf8');
    for (const [path, entry] of Object.entries(FINANCIAL_CONTEXT_EGRESS)) {
      if (entry.status !== 'never-populated') continue;
      expect(builder).toMatch(new RegExp(`\\b${path.split('.')[0]}\\s*:\\s*null\\s*,`));
      expect(entry.whyHe.length).toBeGreaterThan(0);
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
   * The request fields that carry family data on the extraction path. Stated — this pair IS what
   * "the document and the people in it" means — but VERIFIED to still be destructured from
   * request.data below, the same way EXTRACTION_ROOTS is stated-then-verified.
   */
  const EXTRACTION_FAMILY_DATA_BINDINGS = ['fileBase64', 'familyMembers'];

  it("'not-family-data' is pinned to an exact key set, exactly as 'composed' is (R-2)", () => {
    // Layer 1. The status that accepts any field name is the one that most needs the pin, and it
    // was the only one that did not have it. Minting a new key with this excuse now fails here.
    expect(keysWithStatus(FINANCIAL_CONTEXT_EGRESS, 'not-family-data')).toEqual([
      'totalMonthlyExpense.asOf',
      'totalMonthlyExpense.source',
      'totalMonthlyIncome.asOf',
      'totalMonthlyIncome.source',
    ]);
    expect(keysWithStatus(CHAT_REQUEST_EGRESS, 'not-family-data')).toEqual(['modelId']);
    expect(keysWithStatus(EXTRACTION_REQUEST_EGRESS, 'not-family-data'))
      .toEqual(["ALLOWED_CATEGORIES.join(', ')", 'modelId']);
  });

  it('every status is accounted for — no key can sit outside the four, and both unverified ones are pinned', () => {
    // Layer 2. Without this, a FIFTH status ('internal', 'transient', …) is a new hatch with no
    // floor at all, and the pins above would not see it.
    for (const map of [FINANCIAL_CONTEXT_EGRESS, CHAT_REQUEST_EGRESS, EXTRACTION_REQUEST_EGRESS]) {
      const byStatus = (['sent', 'never-populated', 'not-family-data', 'composed'] as const)
        .flatMap((status) => keysWithStatus(map, status));
      expect(unique(byStatus)).toEqual(Object.keys(map).sort());
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

  it('no request contributor excused as not-family-data is derived from the context or the document (R-2)', () => {
    // Layer 3, request half. Anything read off the FinancialContext is family data by
    // construction — its own disclosure lives in FINANCIAL_CONTEXT_EGRESS — so this excuse can
    // never apply to it. Same for the document and the member names on the extraction path.
    const ctxName = contextBindingName();
    for (const key of keysWithStatus(CHAT_REQUEST_EGRESS, 'not-family-data')) {
      expect(
        new RegExp(`\\b${ctxName}\\b`).test(key),
        `${key} reads off \`${ctxName}\`, the financial context — it cannot be "not family data"`
      ).toBe(false);
    }
    const extractHandler = readFileSync(EXTRACT_HANDLER, 'utf8');
    for (const binding of EXTRACTION_FAMILY_DATA_BINDINGS) {
      // Stated-then-verified: if the handler stops destructuring these, the rule below would be
      // checking against names nothing uses.
      expect(extractHandler, `${binding} is no longer read off request.data in aiExtractDocument.ts`)
        .toMatch(new RegExp(`\\b${binding}\\b`));
    }
    for (const key of keysWithStatus(EXTRACTION_REQUEST_EGRESS, 'not-family-data')) {
      for (const binding of EXTRACTION_FAMILY_DATA_BINDINGS) {
        expect(
          new RegExp(`\\b${binding}\\b`).test(key),
          `${key} carries ${binding} — the document and the family's names are the family data`
        ).toBe(false);
      }
    }
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
    expect(Object.keys(EXTRACTION_REQUEST_EGRESS).sort()).toEqual(unique(extractionPayloadKeys()));
  });

  it('the composed entry is exactly the prompt bridge', () => {
    expect(composedKeys(EXTRACTION_REQUEST_EGRESS)).toEqual(['buildExtractionPrompt(familyMembers ?? [])']);
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
