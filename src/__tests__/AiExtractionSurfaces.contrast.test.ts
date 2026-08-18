// Stage 6 review fixes batch 5 — A PRE-EXISTING AA FAILURE, FOUND WHILE MEASURING RATHER THAN
// COPYING.
//
// Batch 3 picked amber-800 for the egress notice by MEASURING it (7.1:1 on white, 6.5:1 on
// slate-100) instead of copying whatever token sat nearby. That measurement turned up the inverse
// finding, which is what this file exists for: slate-500 — the token the helper text on those
// same surfaces already used — is 4.35:1 on slate-100 and FAILS WCAG AA for normal text, and
// slate-400 fails on every background these surfaces use, by a wide margin.
//
// Leaving that would have made the disclosure the only legible line on the screen, which is its
// own kind of dishonesty: text nobody can comfortably read is text that does not communicate,
// and a notice that stands out only because everything around it is washed out is being read as
// decoration.
//
// WHY THE NUMBERS ARE COMPUTED HERE AND NOT WRITTEN DOWN.
//
// A comment saying "slate-600 is 6.9:1" is exactly the kind of claim this batch exists to stop
// shipping — it is true until Tailwind changes a palette value, and then it is a confident
// statement the code does not support. So the ratios below are derived from the ACTUAL oklch
// values in the installed tailwindcss theme, converted to sRGB and run through the WCAG 2.x
// relative-luminance formula. A palette shift in a future Tailwind upgrade fails this file
// instead of silently degrading every helper line in the app.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// Batch 9 — the ~70-line tree-walk + comment-stripper this file and
// AiExtractionEgressNotice.surfaces.test.tsx each carried a verbatim copy of, and the
// Tailwind→WCAG conversion, now live in one place each. Batch 7 recorded why importing the other
// TEST file was not an option (forty render cases and a pile of vi.mock registrations would
// execute inside this suite); a plain helper module has neither problem, and both guards still
// derive their surface list from the tree, which is the property that protects them.
//
// CLOSING REVIEW B-ii — findExtractionSurfaces is now the UNION of the ModelPicker scan and a call
// graph seeded on extractDocument/extractForReview. This file needed no change to benefit: it
// already derived its list from that one function, which is the property batch 7 bought. The
// picker-less hostile surface the review built (AA-failing text-slate-400 prose, no notice) fails
// two of the tests below the moment the predicate covers it.
import {
  REPO_ROOT,
  findExtractionSurfaces,
  findExtractionCallerFiles,
  findExtractionPickerSurfaces,
  stripComments,
} from './helpers/extractionSurfaces';
import { AA_NORMAL, PALETTE, SETS_TEXT_SIZE, ratio } from './helpers/tailwindContrast';

const EXTRACTION_SURFACES = findExtractionSurfaces();

/** Canary only — never the source of the list. An empty derivation would turn every it.each below
 *  into zero silently-passing tests, which is the failure mode this file was just caught in. */
const KNOWN_SURFACES = [
  'src/components/AssetCard.tsx',
  'src/components/FolderLogic.tsx',
  'src/components/InvestmentsImportModal.tsx',
  'src/components/SyncButton.tsx',
];

const NOTICE_FILE = 'src/components/AiExtractionEgressNotice.tsx';
/** The picker itself is not a surface (it mounts nothing), but its own label sits in the same eye-line. */
const PICKER_FILE = 'src/components/ModelPicker.tsx';

const CLASS_ATTR = /className=\{?["'`]([^"'`]*)["'`]/g;
// CLOSING REVIEW — the trailing `\b` this used to end with NEVER matched an arbitrary size:
// `text-[10px] text-slate-400` ends the alternative on `]`, and `]` followed by a space is not a
// word boundary, so the whole class list was skipped. `\[\d+px\]` was therefore dead the day it
// was written, and it hid a real one — FolderLogic's file-size label, slate-400 at 10px, ~2.6:1,
// the exact token this file's own test calls "fails on every background, not marginally".
//
// RE-REVIEW R-4 — and the fix was applied HERE while a second copy carrying the dead form was
// added to AiSettingsScreen.contrast.test.ts IN THE SAME COMMIT. The predicate now has exactly
// one definition, in ./helpers/tailwindContrast.ts, and the last test in this file asserts that
// no test file grows another one.

/**
 * The colour token the notice ACTUALLY renders with, read out of the component.
 *
 * `text-xs` and `leading-snug` are rejected by the trailing \d requirement, so the one match is
 * the palette colour. Throwing rather than returning null is deliberate: if the component stops
 * carrying a parseable colour class this file must fail loudly, not quietly stop checking.
 */
function noticeColourToken(): string {
  const src = stripComments(readFileSync(resolve(REPO_ROOT, NOTICE_FILE), 'utf8'), NOTICE_FILE);
  const tokens = [...src.matchAll(CLASS_ATTR)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter((cl) => /^text-[a-z]+-\d{2,3}$/.test(cl))
    .map((cl) => cl.replace(/^text-/, ''));
  if (tokens.length !== 1) {
    throw new Error(
      `expected exactly one colour token in ${NOTICE_FILE}, found [${tokens.join(', ')}] — ` +
      'this guard can no longer tell which colour the disclosure renders in'
    );
  }
  return tokens[0];
}

/**
 * Every NEUTRAL (grey-family) colour token the surfaces use for sized text — i.e. the ordinary
 * boilerplate prose the disclosure has to stand apart from. Bare occurrences only, for the same
 * WCAG 1.4.3 reason the `disabled:` exemption is honoured further down.
 */
function siblingProseTokens(): string[] {
  const NEUTRAL_TOKEN = /(?<![\w:-])text-((?:slate|gray|zinc|neutral|stone)-\d{2,3})\b/g;
  const found = new Set<string>();
  for (const rel of [...EXTRACTION_SURFACES, PICKER_FILE]) {
    const src = stripComments(readFileSync(resolve(REPO_ROOT, rel), 'utf8'), rel);
    for (const m of src.matchAll(CLASS_ATTR)) {
      if (!SETS_TEXT_SIZE.test(m[1])) continue;
      for (const t of m[1].matchAll(NEUTRAL_TOKEN)) found.add(t[1]);
    }
  }
  return [...found].sort();
}

/** The three backgrounds the extraction surfaces actually paint helper text on. */
const BACKGROUNDS = ['white', 'slate-50', 'slate-100'] as const;

// AA_NORMAL (4.5:1) comes from the shared helper: all the helper text in question is
// text-xs/text-sm (≤14px), nowhere near the ≥18.66px-bold / ≥24px "large text" exemption.

describe('the tokens these surfaces use for helper text clear WCAG AA', () => {
  it('the derived surface list is non-vacuous and still covers every surface known to exist', () => {
    expect(EXTRACTION_SURFACES).toEqual(expect.arrayContaining(KNOWN_SURFACES));
  });

  it('the CALL half of the predicate is non-vacuous here too — the picker half cannot cover for it', () => {
    // Same shadowing note as the sibling guard's: all four known surfaces mount a picker, so the
    // canary above is satisfied by the picker scan alone and would stay green with the call graph
    // returning nothing. These modules are visible only to the call graph.
    const callers = findExtractionCallerFiles();
    for (const rel of ['src/services/aiClient.ts', 'src/utils/FileProcessor.ts', 'src/services/SyncService.ts']) {
      expect(callers).toContain(rel);
      expect(findExtractionPickerSurfaces()).not.toContain(rel);
    }
  });

  it('EVERY neutral prose token the surfaces actually use clears AA on every background in use', () => {
    // Derived, not asserted about slate-600 by name. This is the general form of the old
    // "slate-600 — the replacement — clears AA" test: it keeps holding when the surfaces move to
    // a different grey, and it catches a grey this file has never heard of (slate-300 on a card,
    // gray-500 copied in from somewhere) which the 400/500 token list below cannot see.
    const tokens = siblingProseTokens();
    expect(tokens.length).toBeGreaterThan(0);
    const failing = tokens.filter((t) =>
      BACKGROUNDS.some((bg) => ratio(t, bg) < AA_NORMAL)
    );
    expect(failing).toEqual([]);
  });

  it('the colour the egress notice ACTUALLY renders in clears AA on every background in use', () => {
    // Reads the token out of AiExtractionEgressNotice.tsx instead of restating 'amber-800' here.
    // The old version of this test asserted a fact about Tailwind; this one asserts a fact about
    // the component, which is what a reader of the disclosure is affected by.
    const token = noticeColourToken();
    for (const bg of BACKGROUNDS) {
      expect(ratio(token, bg)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('the notice stays visually DISTINCT from the boilerplate prose beside it, not merely legible', () => {
    // The reason the notice is not simply the same grey as everything around it: a disclosure that
    // renders in the colour of the surrounding boilerplate is READ as boilerplate and skipped.
    //
    // The previous version of this test compared two Tailwind constants to each other — a
    // tautology that never opened the component, so styling the notice with the surrounding
    // prose's own token (exactly the failure this comment describes) left it green. Both halves
    // are now derived: the notice's token from the component, the prose tokens from the surfaces.
    const token = noticeColourToken();
    const prose = siblingProseTokens();
    expect(prose.length).toBeGreaterThan(0);
    expect(prose).not.toContain(token);
    // Legibility is not distinctness, and distinctness is not legibility — the notice must also
    // not merely be a barely-different shade of the same thing.
    for (const t of prose) {
      expect(PALETTE[token]).not.toEqual(PALETTE[t]);
    }
  });

  // The findings that motivated the change, kept as assertions rather than prose so they cannot
  // become stale claims. If a future Tailwind release makes slate-500 pass, this fails and the
  // change can be revisited on evidence instead of being carried forever as folklore.
  it('records WHY slate-500 was replaced: it fails AA on slate-100', () => {
    expect(ratio('slate-500', 'slate-100')).toBeLessThan(AA_NORMAL);
  });

  it('records WHY slate-400 was replaced: it fails AA on every background, not marginally', () => {
    for (const bg of BACKGROUNDS) {
      expect(ratio('slate-400', bg)).toBeLessThan(3);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE STRUCTURAL HALF, BY NAMED TOKEN. The block above derives the tokens the surfaces use and
// measures those; this one is the complementary direction — a denylist of the two specific greys
// batch 5 removed, so a reintroduction is named in the failure output rather than showing up as
// an anonymous ratio. Same grep-guard technique the project already applies to the
// Functions-mirroring constraint, the transaction write guard and the disclosure's role axis.
//
// Matching on a class list that carries BOTH a text-size utility AND the colour is what keeps
// this from firing on icons: `<X className="w-4 h-4 text-slate-400" />` is an icon (governed by
// the 3:1 non-text rule, not 4.5:1), while `className="text-xs text-slate-500"` is prose.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('no extraction surface styles prose with a token that fails AA', () => {
  // DERIVED, not listed. The hardcoded version of this array is what let the mutation sweep add a
  // real ReceiptsImportModal.tsx with prose in the AA-failing text-slate-400 and see 1002 tests
  // pass. The picker and the notice are appended because neither mounts an extraction picker
  // itself, so the walk cannot find them — they are genuinely fixed members of this set.
  const SURFACES = [...EXTRACTION_SURFACES, PICKER_FILE, NOTICE_FILE];

  // A BARE occurrence only. The lookbehind rejects variant-prefixed forms such as
  // `disabled:text-slate-400`: WCAG 1.4.3 explicitly exempts text in an INACTIVE user-interface
  // component from the contrast minimum, so a disabled <select>'s greyed-out label is not a
  // defect and flagging it would push a real exemption into a false positive.
  const BARE_FAILING_TOKEN = /(?<![\w:-])text-slate-(?:400|500)\b/;

  it.each(SURFACES)('%s uses no AA-failing slate token for sized text', (rel) => {
    const src = readFileSync(resolve(__dirname, '../..', rel), 'utf8');
    const offenders = [...src.matchAll(CLASS_ATTR)]
      .map((m) => m[1])
      .filter((cl) => SETS_TEXT_SIZE.test(cl) && BARE_FAILING_TOKEN.test(cl));
    // Named in the failure output, so a regression points at the exact class list to fix rather
    // than at a bare "expected false to be true".
    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RE-REVIEW R-4 — THE PREDICATE THAT DECIDES WHETHER A CLASS LIST IS EVEN LOOKED AT.
//
// Everything above, and everything in AiSettingsScreen.contrast.test.ts, starts by asking
// SETS_TEXT_SIZE whether a class list sizes any text. A predicate that quietly answers "no" turns
// the guard off for that class list — which is exactly what `\[\d+px\]\b` did from the day it was
// written, and exactly what the second copy of it kept doing after this one was fixed.
//
// So the predicate is now tested DIRECTLY rather than only through the surfaces that happen to
// use it today. The `text-[10px] text-slate-400` case below is the reviewer's own planted shape:
// it passed 10/10 on the settings screen while the control `text-xs text-slate-400` failed 1.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the shared text-size predicate (R-4)', () => {
  it('matches an ARBITRARY size followed by another utility — the case the `\\b` form could not', () => {
    expect(SETS_TEXT_SIZE.test('text-[10px] text-slate-400')).toBe(true);
    expect(SETS_TEXT_SIZE.test('mt-1 text-[11px] text-slate-500 leading-snug')).toBe(true);
    // At end-of-string too, where `\b` happened to be harmless and the bug therefore hid.
    expect(SETS_TEXT_SIZE.test('text-slate-400 text-[10px]')).toBe(true);
  });

  it('matches the named sizes BOTH former copies covered — neither guard narrowed in the merge', () => {
    for (const size of ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl']) {
      expect(SETS_TEXT_SIZE.test(`text-${size} text-slate-500`), `text-${size}`).toBe(true);
    }
  });

  it('does NOT match a colour utility, which is what keeps icons out of the prose measurement', () => {
    expect(SETS_TEXT_SIZE.test('w-4 h-4 text-slate-400')).toBe(false);
    expect(SETS_TEXT_SIZE.test('text-slate-500')).toBe(false);
    expect(SETS_TEXT_SIZE.test('text-white bg-amber-600')).toBe(false);
  });

  it('has exactly ONE definition — two copies drifted apart inside a single commit', () => {
    // The defect was not "the regex was wrong", it was "the regex existed twice". A third copy
    // would be free to be wrong again in the same silent way, so the tree is asserted rather
    // than the fix being left as a comment.
    const offenders = readdirSync(__dirname)
      .filter((f) => /\.test\.tsx?$/.test(f))
      .filter((f) => {
        // Two shapes: re-declaring the name, and hand-rolling a size alternation under some
        // other name. The second is what the drift actually looked like — the alternation
        // written out afresh in a new file rather than the existing constant being imported.
        //
        // BATCH 10 — THE WORKAROUND HERE IS GONE, BECAUSE THE THING IT WORKED AROUND IS FIXED.
        //
        // This used to match the RAW source, under a comment explaining that stripComments
        // desynchronised on a regex literal containing a quote character — which this file's own
        // CLASS_ATTR is. That was true, and it is now false: the stripper is parser-backed (see
        // helpers/extractionSurfaces.ts) and this file strips cleanly. A live comment asserting a
        // bug that no longer exists is how the next author gets misled, so it does not survive
        // the fix that falsified it.
        //
        // Stripping is also strictly the better predicate. It never weakens this guard — a second
        // DEFINITION cannot hide inside a comment, so the only thing comments can contribute here
        // is a false positive — and it buys back the freedom the old note had to give up: the
        // patterns may now be written out in prose without the guard reporting its own
        // explanation as a violation.
        const src = stripComments(readFileSync(resolve(__dirname, f), 'utf8'), f);
        return /^\s*(?:const|let|var)\s+SETS_TEXT_SIZE\s*=/m.test(src) || /\btext-\(\?:/.test(src);
      });
    expect(offenders).toEqual([]);
  });
});
