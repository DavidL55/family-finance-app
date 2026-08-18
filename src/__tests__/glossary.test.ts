import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { GLOSSARY, getGlossaryEntry } from '../config/glossary';
import { violatesPlainLanguage } from '../utils/plainLanguage';
import { AI_EGRESS_DISCLOSURE_ALL_HE } from '../config/aiDisclosure';
import { UNVERIFIED_PRICING_CAVEAT_HE } from '../config/aiCeiling';

/** The Hebrew block, used to keep the derived corpus to copy rather than class names and paths. */
const HEBREW = /[֐-׿]/;

const REQUIRED_IDS = [
  'dashboard.totalIncome', 'dashboard.totalExpenses', 'dashboard.monthlyBalance', 'dashboard.plannedBudget',
  'dashboard.netWorth',
  'netWorth.assets.accounts', 'netWorth.assets.investments', 'netWorth.assets.realEstate', 'netWorth.liabilities.loans',
  'expenses.listTotal',
  'accounts.totalBalance', 'accounts.rowBalance',
  'loans.totalBalance', 'loans.rowInterestRate', 'loans.rowMonthlyPayment', 'loans.payoffProgress',
  'insurances.totalPremium', 'insurances.rowPremium', 'insurances.rowCoverageAmount',
  'recurring.totalMonthly', 'recurring.rowAmount',
];

// Every entry actually in GLOSSARY, not just the hardcoded REQUIRED_IDS list — so a new entry
// added to GLOSSARY without also touching REQUIRED_IDS still gets the completeness and
// plain-language checks below (fix for the silent-skip gap REQUIRED_IDS alone left open).
const ALL_IDS = Object.keys(GLOSSARY);

describe('GLOSSARY', () => {
  it.each(REQUIRED_IDS)('the required id %s exists in GLOSSARY', (id) => {
    expect(getGlossaryEntry(id)).not.toBeNull();
  });
  it.each(ALL_IDS)('has a complete entry for %s (title/explanation/howComputed/source all non-empty)', (id) => {
    const entry = getGlossaryEntry(id);
    expect(entry).not.toBeNull();
    expect(entry!.title.length).toBeGreaterThan(0);
    expect(entry!.explanation.length).toBeGreaterThan(0);
    expect(entry!.howComputed.length).toBeGreaterThan(0);
    expect(entry!.source.length).toBeGreaterThan(0);
  });
  it('getGlossaryEntry returns null for an unknown id (never throws)', () => {
    expect(getGlossaryEntry('nonexistent.id')).toBeNull();
  });
  it('the real-estate entry discloses it has no per-item freshness date the way accounts/loans do', () => {
    expect(GLOSSARY['netWorth.assets.realEstate'].asOf).toMatch(/אין תאריך עדכון פרטני/);
  });
  it('the expenses.listTotal entry documents the refund/cancellation carve-out (Stage 1 ledger carry-forward)', () => {
    expect(GLOSSARY['expenses.listTotal'].explanation).toMatch(/החזר|ביטול/);
  });
  it('insurances.totalPremium discloses that a yearly premium is divided by 12 before summing', () => {
    expect(GLOSSARY['insurances.totalPremium'].explanation).toMatch(/12/);
  });
  it('recurring.totalMonthly discloses that a paused/ended item is excluded from the sum', () => {
    expect(GLOSSARY['recurring.totalMonthly'].howComputed).toMatch(/מושהית|הסתיימה/);
  });
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Task 8 review — the two AI-spend entries were written in the SAME commit and contradicted
  // each other about the same number. providerSpend says "משוערת ... ומתקנים" (an estimate, later
  // corrected); modelSpend claimed "מחברים את העלות בפועל" (the ACTUAL cost). byModel sums
  // ai_usage.amountILS, which IS the estimate until reconcileSpend rewrites it — exactly what
  // providerSpend describes. modelSpend overstated.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  it('aiSettings.modelSpend describes an estimate later corrected — not a cost already known to be actual', () => {
    const howComputed = GLOSSARY['aiSettings.modelSpend'].howComputed;
    expect(howComputed).not.toMatch(/מחברים את העלות בפועל/);
    expect(howComputed).toMatch(/משוער/);
    expect(howComputed).toMatch(/בפועל/); // it IS corrected to the real cost — just not from the start
  });

  // Task 8 review F5 — every ₪ figure on the AI settings screen is derived from registry.ts's
  // per-token prices, which that file's own 20-line banner records as UNVERIFIED placeholders.
  // The FX half of the conversion was disclosed; this half was not, on screen or here.
  it.each(['aiSettings.providerSpend', 'aiSettings.modelSpend'])(
    '%s discloses that the underlying model prices are not verified against the vendors (F5)',
    (id) => {
      const entry = GLOSSARY[id];
      expect(`${entry.explanation} ${entry.howComputed}`).toMatch(/לא אומת|אינם מאומתים/);
    }
  );

  // Task 8 review F2 fix (commit 9ca9eea) made the cost gate GLOBAL. Pinning that this entry
  // still describes the gate as it actually is — one family-wide cap, not a per-provider one.
  it('aiSettings.ceiling describes ONE family-wide cap, matching the global gate the code enforces', () => {
    const explanation = GLOSSARY['aiSettings.ceiling'].explanation;
    expect(explanation).toMatch(/סכום אחד לכל ספקי ה-AI יחד/);
    expect(explanation).toMatch(/ולא תקרה נפרדת לכל ספק/);
  });

  // Batch 8 (closing review B4) — this entry promised super-admin approval of an overage while
  // spec §8 had shipped its REFUSAL half only: `grep -rn approvalToken functions/src` outside
  // costGate.ts returned zero, so the capability the entry described did not exist anywhere in
  // the app. The path is real now (aiClient.requestAiOverageApproval -> approvalToken on both
  // spending callables -> costGate.consumeApproval, single-use, proven under real concurrency in
  // firestore-tests/ai-overage-approval.emulator.test.ts), and this pins the entry to what the
  // code actually does rather than to the spec it was transcribed from.
  it('aiSettings.ceiling describes the approval path the code now genuinely has — where it is given, and that it covers one call', () => {
    const explanation = GLOSSARY['aiSettings.ceiling'].explanation;
    expect(explanation).toMatch(/אישור מפורש של סופר-אדמין/);
    // WHERE. An entry that says approval is required without saying where to get it is a wall
    // described in plain Hebrew, which is what this entry was before the path existed.
    expect(explanation).toMatch(/מסך הצ׳אט/);
    // HOW MUCH. The token is single-use and bound to one call's amount (bd97326) — "approve" must
    // not read as "raise the ceiling", which is a different control on a different screen.
    expect(explanation).toMatch(/לקריאה אחת/);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // BATCH 9 — THE TERM COLLISION. The stage's own cold-read acceptance check FAILED here, and it
  // is judgment rather than a broken assertion: the automated plain-language floor passes 15/15
  // on copy a reader can still misunderstand.
  //
  // "ספק" already means the MERCHANT on a transaction in this app (ExtractionReviewModal's row
  // field, CentralExpenseReport's column) and the INSURER on a policy (InsurancesScreen). A
  // family member reading "עלות החודש לספק" on a screen full of ₪ figures has every reason to
  // read it as "what I paid that business". The AI table's own column header was a bare "ספק"
  // too — which is why the fix is at the source (AiSettingsScreen's <th> and <h2>, guarded in
  // AiSettingsScreen.test.tsx) and not only in the prose that explains the number.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  const AI_ENTRY_IDS = ALL_IDS.filter((id) => id.startsWith('aiSettings.'));

  // NOT `\b` after the Hebrew alternative: JavaScript's \b is defined over [A-Za-z0-9_], so no
  // boundary exists between a Hebrew letter and a following space, and `/המודל\b/` never matches.
  // A negative lookahead for another Hebrew letter is the equivalent that actually works here.
  const QUALIFIED_AFTER = /^\s*(?:AI\b|ה-AI\b|המודל(?![֐-׿]))/;

  it.each(AI_ENTRY_IDS)('%s never leaves the word "ספק" bare, where it could read as the merchant', (id) => {
    const entry = getGlossaryEntry(id)!;
    const text = `${entry.title} ${entry.explanation} ${entry.howComputed} ${entry.source}`;
    // Every occurrence of ספק / ספקי / ספקים must be qualified by AI on the spot. Checking the
    // TEXT AFTER each match rather than counting a whole-string substring, because a single
    // qualified mention elsewhere in the entry must not excuse a bare one.
    const bare: string[] = [];
    for (const m of text.matchAll(/ספק(?:ים|י)?/g)) {
      const after = text.slice(m.index + m[0].length);
      if (!QUALIFIED_AFTER.test(after)) bare.push(text.slice(Math.max(0, m.index - 12), m.index + 20));
    }
    expect(bare).toEqual([]);
  });

  it('aiSettings.providerSpend says outright that this is not the business you paid', () => {
    // The disambiguation a reader can act on, not merely a suffix on a noun.
    expect(GLOSSARY['aiSettings.providerSpend'].explanation).toMatch(/לא בית העסק/);
  });

  it('aiSettings.modelSpend DEFINES "מודל" — the word appeared in no entry of the glossary', () => {
    // The table this entry explains shows raw ids like claude-sonnet-5, and 25 entries never said
    // what a model is. Deliberately points at the column rather than naming a model: a model id
    // written into the glossary is a fact the registry can retire underneath it.
    const explanation = GLOSSARY['aiSettings.modelSpend'].explanation;
    expect(explanation).toMatch(/מודל הוא/);
    expect(explanation).toMatch(/בטבלה/);
    // ...and no specific model id, which would go stale the day that model leaves the registry.
    expect(explanation).not.toMatch(/claude|gpt|gemini/i);
  });

  // Batch 9 — the disclosure copy is held to the SAME term rule, because it is read by every role
  // on every send surface while the glossary above is only reachable from one screen.
  it('the shared egress copy never leaves "ספק" bare either', () => {
    const bare: string[] = [];
    for (const m of AI_EGRESS_DISCLOSURE_ALL_HE.matchAll(/ספק(?:ים|י)?/g)) {
      const after = AI_EGRESS_DISCLOSURE_ALL_HE.slice(m.index + m[0].length);
      if (!QUALIFIED_AFTER.test(after)) bare.push(after.slice(0, 20));
    }
    expect(bare).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ACCEPTANCE RE-MEASURE — WHY THE TWO GUARDS ABOVE MISSED THE ONE OCCURRENCE THAT SHIPPED.
  //
  // The re-measure found AiSettingsScreen.tsx:43 still reading "מול הספקים" after batch 9's sweep
  // had corrected every other occurrence. The regex was never the problem — point it at that
  // sentence and it flags it immediately. THE CORPUS WAS.
  //
  // The two guards above read exactly two things: glossary entries whose id starts with
  // `aiSettings.`, and the single joined string AI_EGRESS_DISCLOSURE_ALL_HE. Neither reads a line
  // of COMPONENT copy or a line of any OTHER config module — and the screen-level check in
  // AiSettingsScreen.test.tsx that looks like it should have caught it uses
  // `queryByText('ספקים')`, an EXACT full-string match, so it can only ever see a heading that is
  // the bare word and never the word inside a sentence. Three guards, and the sentence was in
  // none of their fields of view.
  //
  // That is an ENUMERATION guard, and this stage has now been bitten by that shape four separate
  // times: the picker scan that could not see a barrel re-export, the call graph that could not
  // see a function passed as a prop, the sibling contrast guard whose \b was dead the day it was
  // written, and this. The fix is the same fix each time — DERIVE the corpus:
  //
  //   · the FILE LIST comes from a directory glob (src/config/ai*.ts, src/components/Ai*.tsx), so
  //     a new AI copy module is covered the day it is created rather than the day someone
  //     remembers to add it to a list;
  //   · the STRINGS come from the TypeScript AST — string literals, template spans and JSX text —
  //     rather than from a regex over the raw source. That is not fastidiousness: these files
  //     discuss the word ספק at length IN THEIR COMMENTS (the batch-9 note in AiSettingsScreen
  //     literally contains the string `a bare ספק column`), and a source-text scan would drown in
  //     them. Comments are not AST nodes, so the parser excludes them for free, exactly.
  //
  // STILL OUT OF SCOPE, stated rather than left implicit: Hebrew copy defined outside those two
  // globs — a hook, a service, a non-Ai-prefixed component. Every user-facing AI string in the
  // app is inside them today, and the canary below fails if the globs ever stop matching, but
  // this guard does not claim to cover copy that moves out of them.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  const REPO_ROOT = resolve(__dirname, '../..');

  const AI_COPY_FILES = [
    ...readdirSync(join(REPO_ROOT, 'src/config'))
      .filter((f) => /^ai[A-Za-z]*\.ts$/.test(f))
      .map((f) => `src/config/${f}`),
    ...readdirSync(join(REPO_ROOT, 'src/components'))
      .filter((f) => /^Ai[A-Za-z]*\.tsx$/.test(f))
      .map((f) => `src/components/${f}`),
  ].sort();

  /** Every Hebrew-bearing string literal, template span and JSX text node in one file. */
  function hebrewLiterals(relPath: string): string[] {
    const source = readFileSync(join(REPO_ROOT, relPath), 'utf8');
    const sourceFile = ts.createSourceFile(
      relPath, source, ts.ScriptTarget.Latest, /* setParentNodes */ true,
      relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isStringLiteral(node)
        || ts.isNoSubstitutionTemplateLiteral(node)
        || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
        || ts.isJsxText(node)
      ) {
        found.push(node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found.filter((text) => HEBREW.test(text));
  }

  function bareOccurrences(text: string): string[] {
    const bare: string[] = [];
    for (const m of text.matchAll(/ספק(?:ים|י)?/g)) {
      const after = text.slice(m.index + m[0].length);
      if (!QUALIFIED_AFTER.test(after)) bare.push(text.slice(Math.max(0, m.index - 12), m.index + 20));
    }
    return bare;
  }

  it('the derived corpus really is derived, really reads copy, and really excludes comments (canary)', () => {
    // Without this, every assertion below passes vacuously the moment a glob stops matching.
    expect(AI_COPY_FILES).toContain('src/config/aiCeiling.ts');
    expect(AI_COPY_FILES).toContain('src/config/aiDisclosure.ts');
    expect(AI_COPY_FILES).toContain('src/components/AiSettingsScreen.tsx');
    expect(AI_COPY_FILES).toContain('src/components/AiOverageApprovalPanel.tsx');
    expect(AI_COPY_FILES.length).toBeGreaterThanOrEqual(6);

    // It reads a module constant...
    expect(hebrewLiterals('src/config/aiCeiling.ts')).toContain(UNVERIFIED_PRICING_CAVEAT_HE);
    // ...and JSX text, which is a different node kind and the one a naive scan forgets.
    const settings = hebrewLiterals('src/components/AiSettingsScreen.tsx');
    expect(settings.some((t) => t.includes('סה״כ הוצאות AI החודש'))).toBe(true);
    expect(settings).toContain('ספקי AI');

    // AND IT EXCLUDES COMMENTS. This file's batch-9 note contains a bare "ספקים" in prose; the
    // guard below must stay silent about it, so assert the prose is genuinely there — otherwise
    // "no comment false-positives" would be a claim about a file that has no such comment.
    const raw = readFileSync(join(REPO_ROOT, 'src/components/AiSettingsScreen.tsx'), 'utf8');
    expect(raw).toContain('not a bare "ספקים"');
    expect(settings.every((t) => !t.includes('not a bare'))).toBe(true);
  });

  it.each(AI_COPY_FILES)(
    '%s never leaves "ספק" bare in any user-facing string it defines',
    (relPath) => {
      const bare = hebrewLiterals(relPath).flatMap(bareOccurrences);
      expect(bare).toEqual([]);
    },
  );

  // Batch 9 — VERIFIED, NOT REWRITTEN, per the brief. aiSettings.ceiling's claims were re-derived
  // against HEAD: the gate really is family-wide (costGate.spend sums every provider counter in
  // one transaction) and the approval path really exists end to end. Only the term was touched —
  // "לכל ספק" became "לכל ספק AI" — so the two pins above it still hold unchanged.
  it('aiSettings.ceiling still says everything it said before the term fix', () => {
    const explanation = GLOSSARY['aiSettings.ceiling'].explanation;
    expect(explanation).toMatch(/סכום אחד לכל ספקי ה-AI יחד/);
    expect(explanation).toMatch(/תקרה של 0 חוסמת/);
  });

  // Ofra ruling I5 — spec §5.2's actual requirement is plain Hebrew a child understands;
  // "the string is non-empty" (above) doesn't test that. Every entry's explanation/howComputed
  // must pass the same testable plain-language standard used across the app.
  it.each(ALL_IDS)('%s has no plain-language violations (Ofra I5 — banned jargon / sentence length)', (id) => {
    const entry = getGlossaryEntry(id)!;
    expect(violatesPlainLanguage(entry.explanation)).toEqual([]);
    expect(violatesPlainLanguage(entry.howComputed)).toEqual([]);
  });
});
