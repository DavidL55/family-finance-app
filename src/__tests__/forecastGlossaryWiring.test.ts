// src/__tests__/forecastGlossaryWiring.test.ts — Stage 7 T7b. §11's "wired to a LIVE `<Explain>`".
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AN UNWIRED GLOSSARY ENTRY IS INVISIBLE, AND AN UNENTRIED HOVER IS ABSENT
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// `Explain` renders NOTHING for an unknown id (`Explain.tsx:47-53`) — it warns in dev and returns
// `null`. So the two failure modes are silent in opposite directions:
//
//   · an entry nobody renders is copy that ships and is never read;
//   · an `<Explain id="…">` with no entry is a hover the user reaches for and does not get.
//
// Both are checked here, BOTH DIRECTIONS, over a corpus DERIVED from the tree rather than
// enumerated: the id set comes from `GLOSSARY` itself and the render set comes from the AST of
// every component under `src/components`. A hardcoded testid list is the enumeration-guard class
// this stage has counted repeatedly and would not fail on the fifth file.
//
// ── WHAT THIS IS *NOT* ────────────────────────────────────────────────────────────────────────
//
// This is SOURCE presence, not RENDER presence. It cannot tell an `<Explain>` on a live branch from
// one behind a condition that is never true. T7c owns the render-presence conversion and the
// DOM-derived coverage guard; this is the floor underneath it, and it is written now because
// without it the 29 entries this task adds would be checkable only by reading.
import { describe, expect, it } from 'vitest';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
import { SRC_ROOT, listSourceFiles, parseSource, readSourceCached } from './helpers/extractionSurfaces';
import { GLOSSARY } from '../config/glossary';

const COMPONENTS_ROOT = join(SRC_ROOT, 'components');

/**
 * Every id passed to `<Explain id="…">` in one file, off the AST.
 *
 * Attribute nodes rather than a text search: a comment discussing an id is not a render of it, and
 * this file's siblings have had to learn that twice. A NON-LITERAL id (`<Explain id={x} />`) is
 * reported separately rather than silently skipped — a computed id is a real pattern (the screen
 * picks between the two target entries with a ternary) and pretending it is not present would make
 * this guard quietly weaker than it looks.
 */
function explainIdsIn(fileName: string, source: string): { literal: string[]; computed: string[] } {
  const sourceFile = parseSource(fileName, source);
  const literal: string[] = [];
  const computed: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === 'Explain'
    ) {
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(sourceFile) !== 'id') continue;
        const initializer = attribute.initializer;
        if (initializer !== undefined && ts.isStringLiteral(initializer)) {
          literal.push(initializer.text);
        } else if (
          initializer !== undefined &&
          ts.isJsxExpression(initializer) &&
          initializer.expression !== undefined
        ) {
          // !! ONLY THE BRANCHES OF A TERNARY, NEVER EVERY NESTED LITERAL — and the first draft got
          // this wrong in a way that proves why it matters. Collecting every string inside the
          // expression reported `netWorthGlossaryId('assets', …)`'s ARGUMENTS as glossary ids, and
          // the `'personalTarget'` in a `target.source === 'personalTarget' ? … : …` COMPARISON. All
          // three were flagged as ids that do not exist, which is a guard crying wolf on correct
          // code — and a guard that cries wolf is one the next person deletes.
          //
          // A ternary's two branches ARE two real render sites; anything else is opaque and is
          // reported as such below rather than guessed at.
          const branches = (n: ts.Node): void => {
            if (ts.isConditionalExpression(n)) {
              branches(n.whenTrue);
              branches(n.whenFalse);
              return;
            }
            if (ts.isParenthesizedExpression(n)) {
              branches(n.expression);
              return;
            }
            if (ts.isStringLiteral(n)) computed.push(n.text);
          };
          branches(initializer.expression);
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return { literal, computed };
}

function everyExplainId(): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  for (const file of listSourceFiles(COMPONENTS_ROOT)) {
    const { literal, computed } = explainIdsIn(file, readSourceCached(file));
    for (const id of [...literal, ...computed]) {
      byId.set(id, [...(byId.get(id) ?? []), relative(SRC_ROOT, file)]);
    }
  }
  return byId;
}

const FORECAST_PREFIX = 'forecast.';

describe('!! §11 — every forecast glossary entry is wired to a live `<Explain>`', () => {
  it('the extractor FIRES on both attribute forms, and ignores prose', () => {
    // Non-vacuity, proven on synthetic sources before the real tree is touched. Without this, a
    // broken extractor would report "no unwired entries" for the worst possible reason.
    const probe = join(COMPONENTS_ROOT, 'Probe.tsx');
    const found = explainIdsIn(
      probe,
      `
        // <Explain id="forecast.notARender" /> — discussed, not rendered.
        export const P = () => (
          <div>
            <Explain id="forecast.literal" />
            <Explain id={flag ? 'forecast.a' : 'forecast.b'} />
            <NotExplain id="forecast.other" />
          </div>
        );
      `
    );
    expect(found.literal).toEqual(['forecast.literal']);
    expect(found.computed.sort()).toEqual(['forecast.a', 'forecast.b']);
  });

  it('!! and it does NOT mistake a CALL ARGUMENT or a COMPARISON operand for a glossary id', () => {
    // The three false positives the first draft of the extractor produced, kept as the regression.
    const probe = join(COMPONENTS_ROOT, 'Probe2.tsx');
    const found = explainIdsIn(
      probe,
      `
        export const P = () => (
          <div>
            <Explain id={netWorthGlossaryId('assets', line.source)} />
            <Explain id={kind === 'personalTarget' ? 'forecast.personalTarget' : 'forecast.targetSource'} />
          </div>
        );
      `
    );
    expect(found.literal).toEqual([]);
    // The call is OPAQUE and contributes nothing; the ternary contributes exactly its two branches.
    expect(found.computed.sort()).toEqual(['forecast.personalTarget', 'forecast.targetSource']);
  });

  it('!! NO `forecast.*` entry is unwired — an entry nobody renders is copy that ships unread', () => {
    const rendered = everyExplainId();
    const unwired = Object.keys(GLOSSARY)
      .filter((id) => id.startsWith(FORECAST_PREFIX))
      .filter((id) => !rendered.has(id))
      .sort();
    expect(unwired).toEqual([]);
  });

  it('!! NO `<Explain>` anywhere in the app points at an id that does not exist', () => {
    // The other direction, and it is app-wide rather than forecast-scoped on purpose: `Explain`
    // renders `null` for an unknown id, so a typo anywhere is a hover a user reaches for and does
    // not get, with nothing but a dev-only console warning to say so.
    const unknown = [...everyExplainId().entries()]
      .filter(([id]) => GLOSSARY[id] === undefined)
      .map(([id, files]) => `${id} (${files.join(', ')})`)
      .sort();
    expect(unknown).toEqual([]);
  });

  it('!! the forecast vocabulary is ~23 entries and A25`s floor of 17 is comfortably cleared', () => {
    // A25 ruled 17 a FLOOR, not a target; §11 named 28 and this task ships 29. The extra one is
    // `forecast.instalmentDoubleCount`: §11 folded the instalment double count into
    // `forecast.doubleCountCaveat`, and they are DIFFERENT problems — the loan/insurance one has no
    // discriminator on the bank row and cannot be excluded at all, while the instalment one has
    // `installmentNumber` and is excludable in principle. One entry describing both would be the
    // "two stories, one number" defect this glossary already had to fix once.
    const forecastIds = Object.keys(GLOSSARY).filter((id) => id.startsWith(FORECAST_PREFIX));
    expect(forecastIds.length).toBeGreaterThanOrEqual(17);
    expect(forecastIds).toHaveLength(29);
  });

  it('!! §11 — `forecast.adviceBoundary` is deliberately NOT an entry', () => {
    // §9 makes the advice-boundary notice PERMANENT ON-SCREEN TEXT, not hover copy. Asserted so
    // nobody adds it here by reflex, and so the reason survives in a place that fails.
    expect(GLOSSARY['forecast.adviceBoundary']).toBeUndefined();
  });

  it('!! A16 — no entry describes an insight-sourced assumption', () => {
    // Rules pin client writes to `source: 'user'`; the insight half is Stage 8's. B4 was caught
    // from the GLOSSARY direction rather than the code direction, which is why this check is here
    // and not only in the Rules suite.
    for (const [id, entry] of Object.entries(GLOSSARY)) {
      if (!id.startsWith(FORECAST_PREFIX)) continue;
      const text = `${entry.title} ${entry.explanation} ${entry.howComputed} ${entry.source}`;
      expect(text, id).not.toMatch(/תובנ|בינה מלאכותית|AI/);
    }
  });

  it('!! §11 — `forecast.unusableRows` states its own LEDGER-WIDE scope inside the entry', () => {
    // The figure counts `'unknown'` rows returned by a query that sends `'unknown'` on EVERY
    // window, so changing מתי does not change it. Without this clause the number invites a reader
    // to conclude the months they selected are damaged when they are not.
    const entry = GLOSSARY['forecast.unusableRows'];
    expect(entry.explanation).toMatch(/כל ההיסטוריה/);
    expect(entry.explanation).toMatch(/לא רק/);
  });

  it('!! the band is THREE entries, not one — A25`s split', () => {
    // One entry cannot define "הכי יקר שהיה", "האמצע" and "הכי זול שהיה"; they are three different
    // questions about three different numbers.
    for (const id of ['forecast.bandHigh', 'forecast.bandMid', 'forecast.bandLow']) {
      expect(GLOSSARY[id], id).toBeDefined();
    }
    expect(GLOSSARY['forecast.band']).toBeUndefined();
  });

  it('!! the two entries §11 CUT as duplicates were not re-added under a forecast name', () => {
    // `forecast.loanRepayments` reuses `loans.rowMonthlyPayment` and `forecast.insurancePremiums`
    // reuses `insurances.rowPremium`: the forecast figure IS that figure, and a second entry about
    // it would be two stories about one number.
    expect(GLOSSARY['forecast.loanRepayments']).toBeUndefined();
    expect(GLOSSARY['forecast.insurancePremiums']).toBeUndefined();
    expect(GLOSSARY['forecast.savedSnapshot']).toBeUndefined();
    expect(GLOSSARY['loans.rowMonthlyPayment']).toBeDefined();
    expect(GLOSSARY['insurances.rowPremium']).toBeDefined();
  });

  it('the two caveat entries D10 and D23 PROMISE as hover copy actually exist', () => {
    // In this app hover copy IS a glossary entry. A decision that says "stated in the hover copy"
    // and writes no entry has promised a hover that renders nothing.
    expect(GLOSSARY['forecast.installmentPlanKey'].explanation).toMatch(/בית העסק/);
    expect(GLOSSARY['forecast.doubleCountCaveat'].explanation).toMatch(/פעמיים|נספרת/);
  });
});
