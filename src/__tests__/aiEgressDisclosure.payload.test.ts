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

const composedKeys = (map: Record<string, EgressFieldDisclosure>): string[] =>
  Object.entries(map).filter(([, e]) => e.status === 'composed').map(([k]) => k).sort();

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
    expect(Object.keys(FINANCIAL_CONTEXT_EGRESS).sort()).toEqual(
      flattenTypeLeaves(CONTEXT_TYPES, 'FinancialContext')
    );
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
