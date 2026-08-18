// Stage 6 batch 9 — THE ONE THE 29-CLASS SWEEP MISSED.
//
// Batch 5 measured every slate-400/500 prose token on the extraction surfaces and moved 29 of
// them to slate-600. It never looked at the chat panel, so the per-answer model badge
// ("נענה על-ידי Claude Sonnet 5") kept shipping as text-[10px] text-indigo-400 — 3.12:1 on the
// white answer bubble it sits in, below WCAG AA's 4.5:1 for normal text and only just over the
// 3:1 floor that applies to non-text, on ten-pixel type.
//
// The badge is not decoration: it is the only place a reader learns WHICH model answered them,
// which is the whole point of a model switcher, and (since batch 3) the egress notice a few lines
// below names a provider that has to agree with it. A label you cannot read is a switcher you
// cannot audit.
//
// Measured, not asserted about: the ratios come from the installed Tailwind theme via
// ./helpers/tailwindContrast, and the TOKEN comes out of Dashboard.tsx. Batch 7's S3 finding was
// exactly this — a "contrast" test that compared two Tailwind constants and never opened the
// component it claimed to protect.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, stripComments } from './helpers/extractionSurfaces';
import { AA_NORMAL, PALETTE, ratio } from './helpers/tailwindContrast';

const DASHBOARD = resolve(REPO_ROOT, 'src/components/Dashboard.tsx');

/** Backgrounds the chat panel actually paints these two lines on. */
const CHAT_BACKGROUNDS = ['white', 'indigo-50', 'indigo-100'] as const;

const COLOUR_TOKEN = /^text-([a-z]+-\d{2,3})$/;

function soleColourToken(classList: string, what: string): string {
  const tokens = classList
    .split(/\s+/)
    .map((cl) => cl.match(COLOUR_TOKEN)?.[1])
    .filter((t): t is string => Boolean(t));
  if (tokens.length !== 1) {
    throw new Error(
      `expected exactly one palette colour on ${what}, found [${tokens.join(', ')}] in "${classList}" — ` +
      'this guard can no longer tell which colour it renders in'
    );
  }
  return tokens[0];
}

/** The className on the element whose own text starts with `marker`. Comments stripped first, so
 *  a comment quoting the markup cannot satisfy the match (batch 7's S2 lesson). */
function tokenOfElementRendering(marker: string, what: string): string {
  const src = stripComments(readFileSync(DASHBOARD, 'utf8'), DASHBOARD);
  const m = new RegExp(`className="([^"]*)"[^>]*>\\s*${marker}`).exec(src);
  if (!m) throw new Error(`could not find the ${what} element in Dashboard.tsx — this guard is looking at the wrong markup`);
  return soleColourToken(m[1], what);
}

/** Same, for an element located by its data-testid rather than by its text. */
function tokenOfTestId(testId: string, what: string): string {
  const src = stripComments(readFileSync(DASHBOARD, 'utf8'), DASHBOARD);
  const m = new RegExp(`data-testid="${testId}"[\\s\\S]{0,400}?className="([^"]*)"`).exec(src);
  if (!m) throw new Error(`could not find [data-testid="${testId}"] in Dashboard.tsx`);
  return soleColourToken(m[1], what);
}

describe('the chat surface is readable, measured against the installed palette (batch 9)', () => {
  it('the per-answer model badge clears AA on every background the chat panel uses', () => {
    const token = tokenOfElementRendering('נענה על-ידי', 'the per-answer model badge');
    for (const bg of CHAT_BACKGROUNDS) {
      expect(ratio(token, bg)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('the egress notice clears AA there too — it did before this batch and must keep doing so', () => {
    const token = tokenOfTestId('ai-chat-egress-notice', 'the chat egress notice');
    for (const bg of CHAT_BACKGROUNDS) {
      expect(ratio(token, bg)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('the badge stays QUIETER than the answer text it annotates — legible is not the same as loud', () => {
    // The reason this is not simply "make it slate-700": the badge is metadata about the answer,
    // not part of it. It has to clear AA and still recede, or every answer reads as two answers.
    const badge = tokenOfElementRendering('נענה על-ידי', 'the per-answer model badge');
    expect(ratio(badge, 'white')).toBeLessThan(ratio('slate-700', 'white'));
  });

  it('records WHY indigo-400 was replaced: it fails AA on the white answer bubble', () => {
    // Kept as an assertion rather than a sentence in a comment, for the reason batch 5 gave: a
    // written-down measurement is a claim a Tailwind upgrade can silently falsify. If a future
    // release makes indigo-400 pass, this fails and the decision can be revisited on evidence.
    expect(ratio('indigo-400', 'white')).toBeLessThan(AA_NORMAL);
    expect(PALETTE['indigo-400']).toBeDefined();
  });
});
