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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type RGB = [number, number, number];

/** The palette the app actually ships, read from the installed Tailwind theme — not transcribed. */
function loadPalette(): Record<string, RGB> {
  const css = readFileSync(
    resolve(__dirname, '../..', 'node_modules/tailwindcss/theme.css'),
    'utf8'
  );
  const palette: Record<string, RGB> = { white: [1, 1, 1] };
  const re = /--color-([a-z]+-\d+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g;
  for (const m of css.matchAll(re)) {
    palette[m[1]] = oklchToSrgb(Number(m[2]) / 100, Number(m[3]), Number(m[4]));
  }
  return palette;
}

/** OKLCH → linear LMS → linear sRGB → gamma-encoded sRGB (Björn Ottosson's published matrices). */
function oklchToSrgb(L: number, C: number, hDeg: number): RGB {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((u) => {
    const c = Math.min(1, Math.max(0, u));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  }) as RGB;
}

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg: RGB, bg: RGB): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const PALETTE = loadPalette();

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BATCH 7 — THE SURFACES AND THE TOKENS ARE BOTH READ FROM THE TREE NOW.
//
// The mutation sweep found two holes in this file. Both were the same mistake: the file measured
// TAILWIND, and never looked at what the app actually renders.
//
//  · The "distinctness" test asserted PALETTE['amber-800'] !== PALETTE['slate-600'] — two library
//    constants compared to each other, a tautology that holds no matter what the notice is styled
//    with. Setting the notice to the same token as the surrounding prose, precisely the failure
//    its own comment describes, changed nothing.
//  · The per-file structural guard iterated a six-path hardcoded list, so a fifth extraction
//    surface with AA-failing prose was invisible to it.
//
// So the surface list is now DERIVED by walking src/ (the same recursion transactionWriteGuard
// .test.ts uses, and the same one AiExtractionEgressNotice.surfaces.test.tsx's role and notice
// guards now run off), and the notice's colour is PARSED OUT OF THE COMPONENT rather than
// restated here. See findExtractionSurfaces' own note on why the walk is duplicated across the
// two test files rather than shared.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, '../..');
const SRC_ROOT = resolve(__dirname, '..');

/** Removes `//` and block comments, respecting string and template literals. */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function listSourceFiles(dir: string): string[] {
  let files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'fixtures') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files = files.concat(listSourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full);
  }
  return files;
}

/** Brace-depth aware, so a `>` inside a JSX expression cannot terminate the tag early. */
function jsxOpeningTags(source: string, name: string): string[] {
  const tags: string[] = [];
  const re = new RegExp(`<${name}\\b`, 'g');
  for (let m = re.exec(source); m; m = re.exec(source)) {
    let depth = 0;
    for (let i = m.index; i < source.length; i++) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) {
        tags.push(source.slice(m.index, i + 1));
        break;
      }
    }
  }
  return tags;
}

const EXTRACTION_ACTION = /\baction\s*=\s*(?:"extraction"|'extraction'|\{\s*['"]extraction['"]\s*\})/;

/**
 * Every file under src/ that mounts an extraction ModelPicker.
 *
 * Duplicated from AiExtractionEgressNotice.surfaces.test.tsx on purpose: importing that file here
 * would execute its vi.mock registrations and its forty render cases inside this suite. The copy
 * is safe in the direction that matters — both walk the tree, so neither can drift away from what
 * the tree contains, which is exactly the property the two hardcoded arrays lacked.
 */
function findExtractionSurfaces(): string[] {
  return listSourceFiles(SRC_ROOT)
    .filter((full) =>
      jsxOpeningTags(stripComments(readFileSync(full, 'utf8')), 'ModelPicker')
        .some((tag) => EXTRACTION_ACTION.test(tag))
    )
    .map((full) => relative(REPO_ROOT, full).replace(/\\/g, '/'))
    .sort();
}

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
const SETS_TEXT_SIZE = /\btext-(?:xs|sm|base|lg|\[\d+px\])\b/;

/**
 * The colour token the notice ACTUALLY renders with, read out of the component.
 *
 * `text-xs` and `leading-snug` are rejected by the trailing \d requirement, so the one match is
 * the palette colour. Throwing rather than returning null is deliberate: if the component stops
 * carrying a parseable colour class this file must fail loudly, not quietly stop checking.
 */
function noticeColourToken(): string {
  const src = stripComments(readFileSync(resolve(REPO_ROOT, NOTICE_FILE), 'utf8'));
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
    const src = stripComments(readFileSync(resolve(REPO_ROOT, rel), 'utf8'));
    for (const m of src.matchAll(CLASS_ATTR)) {
      if (!SETS_TEXT_SIZE.test(m[1])) continue;
      for (const t of m[1].matchAll(NEUTRAL_TOKEN)) found.add(t[1]);
    }
  }
  return [...found].sort();
}

/** The three backgrounds the extraction surfaces actually paint helper text on. */
const BACKGROUNDS = ['white', 'slate-50', 'slate-100'] as const;

/** WCAG 2.1 AA for normal-size text. All the helper text in question is text-xs/text-sm (≤14px), */
/** which is nowhere near the ≥18.66px-bold / ≥24px "large text" exemption, so 4.5:1 is the bar. */
const AA_NORMAL = 4.5;

const ratio = (token: string, bg: string) => contrast(PALETTE[token], PALETTE[bg]);

describe('the tokens these surfaces use for helper text clear WCAG AA', () => {
  it('the derived surface list is non-vacuous and still covers every surface known to exist', () => {
    expect(EXTRACTION_SURFACES).toEqual(expect.arrayContaining(KNOWN_SURFACES));
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
