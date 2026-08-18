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
// TypeScript parser rather than a regex over an interface body — and requires that
// src/config/aiDisclosure.ts's EGRESS maps account for every member of it, that nothing in those
// maps names a field that no longer exists, and that every field claimed as disclosed has its
// phrase on a line the screen actually renders.
//
// The 'never-populated' status is the one that could have become a loophole ("mark it null and
// say nothing"), so it is not taken on trust: the guard goes back to buildFinancialContext.ts and
// checks the producer really does assign a literal null to that field. A field that starts
// carrying a value fails here even if this file's map is untouched.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  AI_EGRESS_DISCLOSURE_ALL_HE,
  AI_EGRESS_DISCLOSURE_DETAILS_HE,
  AI_EGRESS_DISCLOSURE_HEADLINE_HE,
  EXTRACTION_PROMPT_EGRESS,
  FINANCIAL_CONTEXT_EGRESS,
  aiChatEgressNoticeHe,
  aiExtractionEgressNoticeHe,
} from '../config/aiDisclosure';
import { violatesPlainLanguage } from '../utils/plainLanguage';

const REPO_ROOT = resolve(__dirname, '../..');
const CONTEXT_TYPES = resolve(REPO_ROOT, 'functions/src/context/types.ts');
const CONTEXT_BUILDER = resolve(REPO_ROOT, 'functions/src/context/buildFinancialContext.ts');
const EXTRACT_HANDLER = resolve(REPO_ROOT, 'functions/src/handlers/aiExtractDocument.ts');
const CHAT_HANDLER = resolve(REPO_ROOT, 'functions/src/handlers/aiChat.ts');

function parse(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

/** Property names declared on an exported interface, in declaration order. */
function interfaceMembers(filePath: string, interfaceName: string): string[] {
  const sourceFile = parse(filePath);
  let members: string[] | null = null;
  sourceFile.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      members = node.members
        .filter(ts.isPropertySignature)
        .map((m) => (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text : ''))
        .filter((name) => name.length > 0);
    }
  });
  if (members === null) {
    throw new Error(`interface ${interfaceName} not found in ${filePath} — this guard is looking at the wrong file`);
  }
  return members;
}

/**
 * The text of every `${…}` expression inside the template literal returned by `functionName`.
 * Uses the printer on the parsed expression rather than a brace-matching regex so a nested `}`
 * (an object literal, a `.join('}')`) cannot truncate a match and quietly hide an interpolation.
 */
function templateInterpolations(filePath: string, functionName: string): string[] {
  const sourceFile = parse(filePath);
  const printer = ts.createPrinter({ removeComments: true });
  const found: string[] = [];
  let seen = false;

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      seen = true;
      const collect = (inner: ts.Node): void => {
        if (ts.isTemplateExpression(inner)) {
          for (const span of inner.templateSpans) {
            found.push(printer.printNode(ts.EmitHint.Expression, span.expression, sourceFile));
          }
        }
        inner.forEachChild(collect);
      };
      node.forEachChild(collect);
      return;
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);

  if (!seen) {
    throw new Error(`function ${functionName} not found in ${filePath} — this guard is looking at the wrong file`);
  }
  return found;
}

describe('the egress disclosure is pinned to the chat payload (closing review I1)', () => {
  it('accounts for EVERY field of FinancialContext — adding one to the type fails here', () => {
    // The whole object is JSON.stringify'd into the system prompt, so "a field of this interface"
    // and "a thing that leaves the house" are the same set. That equality is the guard.
    const declared = interfaceMembers(CONTEXT_TYPES, 'FinancialContext').sort();
    const disclosed = Object.keys(FINANCIAL_CONTEXT_EGRESS).sort();
    expect(disclosed).toEqual(declared);
  });

  it('aiChat.ts really does send the whole context object, which is why the field list is the payload', () => {
    // If the handler ever stops stringifying the context wholesale and starts picking fields, the
    // premise above ("every field leaves") changes and this guard has to be re-derived rather than
    // silently continuing to measure the wrong thing.
    expect(readFileSync(CHAT_HANDLER, 'utf8')).toContain('wrapExternalData(JSON.stringify(ctx))');
  });

  it('every field claimed as SENT has its phrase on a line the banner actually renders', () => {
    const missing: string[] = [];
    for (const [field, entry] of Object.entries(FINANCIAL_CONTEXT_EGRESS)) {
      if (entry.status !== 'sent') continue;
      for (const phrase of entry.phrasesHe) {
        if (!AI_EGRESS_DISCLOSURE_ALL_HE.includes(phrase)) missing.push(`${field}: "${phrase}"`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('a field excused as NEVER-POPULATED is verified against the producer, not taken on trust', () => {
    // This is the status a future author would reach for to wave a live field through. So the
    // excuse is checked: buildFinancialContext must literally assign null to that field.
    const builder = readFileSync(CONTEXT_BUILDER, 'utf8');
    for (const [field, entry] of Object.entries(FINANCIAL_CONTEXT_EGRESS)) {
      if (entry.status !== 'never-populated') continue;
      expect(builder).toMatch(new RegExp(`\\b${field}\\s*:\\s*null\\s*,`));
      expect(entry.whyHe.length).toBeGreaterThan(0);
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

describe('the egress disclosure is pinned to the extraction payload (closing review I1)', () => {
  it('accounts for EVERY interpolation in buildExtractionPrompt — adding one fails here', () => {
    const declared = templateInterpolations(EXTRACT_HANDLER, 'buildExtractionPrompt').sort();
    const disclosed = Object.keys(EXTRACTION_PROMPT_EGRESS).sort();
    expect(disclosed).toEqual(declared);
  });

  it('the family member names are disclosed on the surfaces that send them', () => {
    // Named on BOTH the settings banner and the per-surface notice: the banner is the only place a
    // super-admin sees it, the notice is the only place everybody else does.
    expect(AI_EGRESS_DISCLOSURE_ALL_HE).toContain('שמות בני המשפחה');
    expect(aiExtractionEgressNoticeHe('anthropic')).toContain('שמות בני המשפחה');
    expect(aiExtractionEgressNoticeHe(null)).toContain('שמות בני המשפחה');
  });

  it('the MOCK line still claims no egress at all, for the document AND the names', () => {
    // The mock adapter runs inside our own Cloud Function. A "sent to מודל דמה" line would be a
    // disclosure that states a falsehood — the defect class this whole batch is about.
    const mock = aiExtractionEgressNoticeHe('mock');
    expect(mock).not.toContain('המסמך עצמו נשלח');
    expect(mock).toContain('לא נשלחים');
    expect(aiChatEgressNoticeHe('mock')).not.toContain('נשלחות ל-');
  });
});

describe('the chat-surface line says the same thing the banner does', () => {
  it('names the summary figures and the filter, not only the questions', () => {
    // The pre-batch line said only that your QUESTIONS were sent, while the handler was shipping
    // two money totals and the resolved filter with every turn — strictly less than what left.
    for (const line of [aiChatEgressNoticeHe('anthropic'), aiChatEgressNoticeHe(null)]) {
      expect(line).toContain('סך ההוצאות וההכנסות הקבועות');
      expect(line).toContain('הסינון שבחרת');
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
    const variants = [
      aiChatEgressNoticeHe('anthropic'), aiChatEgressNoticeHe('mock'), aiChatEgressNoticeHe(null),
      aiExtractionEgressNoticeHe('google'), aiExtractionEgressNoticeHe('mock'), aiExtractionEgressNoticeHe(null),
    ];
    for (const line of variants) expect(violatesPlainLanguage(line)).toEqual([]);
  });
});
