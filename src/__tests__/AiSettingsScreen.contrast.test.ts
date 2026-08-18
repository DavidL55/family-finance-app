// Stage 6 closing review (cheap items 4 and 5) — TWO SCREENS THAT CLAIMED TO HAVE BEEN MEASURED
// AND WERE IN NO GUARD AT ALL, AND ONE TOKEN THAT ACTUALLY FAILED.
//
// AiExtractionSurfaces.contrast.test.ts derives its file list from extraction surfaces, so
// AiSettingsScreen.tsx and AiOverageApprovalPanel.tsx were never in any contrast guard — while
// both carried comments stating their tokens had been measured by it. That is this stage's
// signature defect (a comment asserting a property is not a test) in two more places, and the
// SHIPPED defect is the comment: had anyone taken the measurement, they would have found one real
// failure sitting under it.
//
// THE REAL FAILURE. AiSettingsScreen's usage bar has three semantic bands, and the bar is a
// non-text graphic carrying information, so WCAG 1.4.11 puts it at 3:1 against its own track
// (bg-slate-100). Measured from the installed Tailwind theme:
//
//   ok    bg-emerald-600  3.34 : 1   ✔
//   over  bg-red-600      4.35 : 1   ✔
//   near  bg-amber-500    1.96 : 1   ✗   — off by a factor of one and a half
//
// The 'near' band is the one that exists to say "start watching", i.e. the state a reader most
// needs to notice, and it was the invisible one. Fixed to amber-700 (4.61:1); amber-600 is 2.91
// and would have been a knowing near-miss. WCAG 1.4.1 was never violated — each band also
// carries a Hebrew word — so this was a contrast defect, not a colour-only-signal one.
//
// EVERYTHING BELOW IS DERIVED. No ratio is written down as an expectation and no token is
// hardcoded as the thing under test: the class strings are read out of the components and the
// palette out of node_modules/tailwindcss/theme.css, for exactly the reason batch 5 gave — a
// transcribed ratio is a comment a Tailwind upgrade silently falsifies, which is how the comments
// this file replaces came to be wrong.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/extractionSurfaces';
import { AA_NORMAL, PALETTE, SETS_TEXT_SIZE, ratio } from './helpers/tailwindContrast';

const REPO_ROOT = resolve(__dirname, '../..');
const SETTINGS = 'src/components/AiSettingsScreen.tsx';
const OVERAGE_PANEL = 'src/components/AiOverageApprovalPanel.tsx';

/** WCAG 1.4.11: non-text content that conveys information needs 3:1 against what is behind it. */
const NON_TEXT_MIN = 3;

const read = (rel: string): string => stripComments(readFileSync(resolve(REPO_ROOT, rel), 'utf8'));

/**
 * EVERY quoted string in the file, not only the ones sitting directly after `className=`.
 *
 * The `className=\{?["'`]…` regex the sibling extraction guard uses — which this file started
 * with — cannot see a class list inside a TERNARY (`className={cond ? '…' : '…'}`), because the
 * quote does not immediately follow the brace. That blind spot is not academic: the one real AA
 * failure on this screen, `text-slate-500` on its own `bg-slate-100` pill, is in exactly such a
 * ternary, so the first version of this guard measured everything EXCEPT the defect it was written
 * to find. Caught by mutation — reverting the token failed only the explicit regex check beside
 * this, not the measurement.
 *
 * Scanning all string literals costs nothing here: a string with no Tailwind colour utility in it
 * contributes no pair, so Hebrew copy and test ids fall out on their own.
 */
const QUOTED_STRING = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

// RE-REVIEW R-4 — this line used to carry its own copy of the size predicate, in the DEAD `\b`
// form, added in the same commit that fixed the sibling guard's copy to `(?![\w-])`. Proven:
// `text-[10px] text-slate-400` planted on this screen passed 10/10 here while the control
// `text-xs text-slate-400` failed 1. It now imports the one definition; see the helper's header.

/**
 * The `bar:` tokens of AiSettingsScreen's USAGE_STYLES map, read out of the source.
 *
 * Parsed from the map rather than by grepping for `bg-` anywhere in the file: the point is to
 * measure the three tokens that actually paint the usage bar, and a file-wide sweep would drag in
 * every card and button background and drown them.
 */
function usageBarTokens(): Record<string, string> {
  const source = read(SETTINGS);
  const block = /const USAGE_STYLES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source);
  if (!block) {
    throw new Error(`USAGE_STYLES not found in ${SETTINGS} — this guard can no longer tell which colours the bar uses`);
  }
  const tokens: Record<string, string> = {};
  for (const m of block[1].matchAll(/(\w+):\s*\{[^}]*\bbar:\s*'bg-([a-z]+-\d{2,3})'/g)) {
    tokens[m[1]] = m[2];
  }
  if (Object.keys(tokens).length !== 3) {
    throw new Error(`expected three usage bands in ${SETTINGS}, parsed [${Object.keys(tokens).join(', ')}]`);
  }
  return tokens;
}

/** The `text:` tokens of the same map. */
function usageTextTokens(): string[] {
  const source = read(SETTINGS);
  const block = /const USAGE_STYLES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source);
  if (!block) throw new Error(`USAGE_STYLES not found in ${SETTINGS}`);
  return [...block[1].matchAll(/\btext:\s*'text-([a-z]+-\d{2,3})'/g)].map((m) => m[1]).sort();
}

/** The track the bar is painted on, read out of the JSX rather than assumed. */
function barTrackToken(): string {
  const source = read(SETTINGS);
  const m = /className="w-full bg-([a-z]+-\d{2,3}) rounded-full h-2"/.exec(source);
  if (!m) {
    throw new Error(
      `the usage bar's track background is no longer parseable out of ${SETTINGS} — ` +
      'the 3:1 measurements below would be against the wrong colour'
    );
  }
  return m[1];
}

/**
 * Every (foreground, background) pair the file actually renders sized text in.
 *
 * PAIRS, not a cross-product of tokens against every background the screen uses anywhere. The
 * first version of this guard took the cross-product and flagged `text-red-600` — which sits on
 * the white card — against slate-100, which it never touches. A guard that reports a colour
 * combination the app does not render is a guard whose failures get waved through, and the badge
 * defect it DID find (text-slate-500 on its own bg-slate-100 pill, 4.35:1, a real AA failure)
 * would have been waved through with it.
 *
 * The rule: if a class list carries its own `bg-*`, that is the background — this is the precise
 * case, and it is the one that caught the badge. Otherwise the text sits on the screen's ambient
 * surfaces, listed per file and asserted below to be the ones the file really paints.
 */
function textOnBackgroundPairs(rel: string, ambient: readonly string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const m of read(rel).matchAll(QUOTED_STRING)) {
    const classList = m[2];
    if (!SETS_TEXT_SIZE.test(classList)) continue;
    const classes = classList.split(/\s+/);
    // Bare occurrences only: WCAG 1.4.3 exempts text in an INACTIVE component, so
    // `disabled:text-amber-600` / `disabled:bg-slate-100` are real exemptions, not defects.
    const foregrounds = classes
      .map((c) => /^text-([a-z]+-\d{2,3})$/.exec(c)?.[1])
      .filter((t): t is string => Boolean(t) && Boolean(PALETTE[t as string]));
    if (foregrounds.length === 0) continue;
    const own = classes.map((c) => /^bg-([a-z]+-\d{2,3})$/.exec(c)?.[1]).find((t) => t && PALETTE[t]);
    const backgrounds = own ? [own] : ambient;
    for (const fg of foregrounds) for (const bg of backgrounds) pairs.push([fg, bg as string]);
  }
  return pairs;
}

describe('the usage bar clears WCAG 1.4.11 against its own track (closing review, cheap item 4)', () => {
  it('the tokens and the track are still parseable — a silent parse failure would turn this file off', () => {
    // Non-vacuity. The two readers throw rather than returning empty, but that only helps if
    // something calls them where the failure is legible.
    expect(Object.keys(usageBarTokens()).sort()).toEqual(['near', 'ok', 'over']);
    expect(PALETTE[barTrackToken()]).toBeDefined();
  });

  it('EVERY band clears 3:1 — including `near`, which was the one that did not', () => {
    const track = barTrackToken();
    const failing = Object.entries(usageBarTokens())
      .filter(([, token]) => ratio(token, track) < NON_TEXT_MIN)
      .map(([band, token]) => `${band}: ${token} = ${ratio(token, track).toFixed(2)}:1 on ${track}`);
    expect(failing).toEqual([]);
  });

  it('records WHY amber-500 was replaced, and why amber-600 was not the fix', () => {
    // Kept as assertions rather than prose for the same reason batch 5 kept its slate-500 finding:
    // a future Tailwind release could make either of these pass, and the decision should then be
    // revisited on evidence rather than carried forward as folklore.
    expect(ratio('amber-500', 'slate-100')).toBeLessThan(NON_TEXT_MIN);
    expect(ratio('amber-600', 'slate-100')).toBeLessThan(NON_TEXT_MIN); // 2.91 — a knowing near-miss
    expect(ratio('amber-700', 'slate-100')).toBeGreaterThanOrEqual(NON_TEXT_MIN);
  });

  it('the three bands stay distinguishable from EACH OTHER, not merely from the track', () => {
    // A band that clears the track but is the same colour as its neighbour tells a sighted reader
    // nothing the track ratio can detect. (WCAG 1.4.1 is separately satisfied by the Hebrew band
    // word, which is why this is a quality bar rather than a conformance one.)
    const tokens = Object.values(usageBarTokens());
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const a of tokens) {
      for (const b of tokens) {
        if (a !== b) expect(PALETTE[a]).not.toEqual(PALETTE[b]);
      }
    }
  });

  it('the band TEXT tokens clear AA on the white card they sit on', () => {
    for (const token of usageTextTokens()) {
      expect(ratio(token, 'white'), `${token} on white`).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });
});

describe('two screens that claimed to be measured are now actually measured (closing review, cheap item 5)', () => {
  // The AMBIENT surface of each screen — what text with no background of its own sits on. Every
  // card on the settings screen is bg-white; the overage panel is one bg-amber-50 block, which is
  // precisely the background the comment in that file claimed had been measured by a guard that
  // has never heard of it. Both are asserted against the source below, not assumed.
  const AMBIENT: Record<string, readonly string[]> = {
    [SETTINGS]: ['white'],
    [OVERAGE_PANEL]: ['amber-50'],
  };

  it.each(Object.keys(AMBIENT))('%s styles no sized text below AA on the background it is really on', (rel) => {
    const pairs = textOnBackgroundPairs(rel, AMBIENT[rel]);
    expect(pairs.length, `no text/background pairs parsed out of ${rel} — this guard would pass vacuously`)
      .toBeGreaterThan(0);
    const failing = pairs
      .filter(([fg, bg]) => ratio(fg, bg) < AA_NORMAL)
      .map(([fg, bg]) => `${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}:1`);
    expect([...new Set(failing)]).toEqual([]);
  });

  it('records the badge finding: text-slate-500 on its bg-slate-100 pill failed AA', () => {
    // The defect this file found on its first run, kept as evidence rather than prose. It is the
    // SAME token pair batch 5 measured and replaced on the extraction surfaces — this file was in
    // no contrast guard, so the settings screen kept it while carrying a comment saying otherwise.
    expect(ratio('slate-500', 'slate-100')).toBeLessThan(AA_NORMAL);
    expect(ratio('slate-600', 'slate-100')).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(read(SETTINGS)).not.toMatch(/bg-slate-100[^"']*\btext-slate-500\b/);
  });

  it('each screen really does paint on the ambient surface this guard measures against', () => {
    // Without this, the measurements above are against colours the components may have stopped
    // using — which is the exact shape of the comments they replace.
    expect(read(SETTINGS)).toContain('bg-white');
    expect(read(OVERAGE_PANEL)).toContain('bg-amber-50');
  });

  it('white text on the approve button clears AA against the button, not against the panel', () => {
    // The one place on either screen where the foreground is white: measured against the button's
    // own fill, since that is what is behind it. A sweep over panel backgrounds would either miss
    // it or measure it against the wrong thing.
    const source = read(OVERAGE_PANEL);
    const m = /bg-amber-(\d{2,3})[^"']*\btext-white\b|\btext-white\b[^"']*bg-amber-(\d{2,3})/.exec(source);
    expect(m, 'the approve button no longer pairs text-white with an amber fill').not.toBeNull();
    expect(ratio('white', `amber-${m![1] ?? m![2]}`)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});
