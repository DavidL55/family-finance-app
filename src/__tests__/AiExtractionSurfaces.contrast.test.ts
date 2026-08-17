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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

/** The three backgrounds the extraction surfaces actually paint helper text on. */
const BACKGROUNDS = ['white', 'slate-50', 'slate-100'] as const;

/** WCAG 2.1 AA for normal-size text. All the helper text in question is text-xs/text-sm (≤14px), */
/** which is nowhere near the ≥18.66px-bold / ≥24px "large text" exemption, so 4.5:1 is the bar. */
const AA_NORMAL = 4.5;

const ratio = (token: string, bg: string) => contrast(PALETTE[token], PALETTE[bg]);

describe('the tokens these surfaces use for helper text clear WCAG AA', () => {
  it('slate-600 — the replacement — clears AA on every background in use', () => {
    for (const bg of BACKGROUNDS) {
      expect(ratio('slate-600', bg)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('amber-800 — the egress notice — clears AA on every background in use', () => {
    for (const bg of BACKGROUNDS) {
      expect(ratio('amber-800', bg)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('the notice stays visually DISTINCT from the helper text beside it, not merely legible', () => {
    // The reason the notice is not simply slate-600 as well: a disclosure that renders in the
    // same colour as the surrounding boilerplate is read as boilerplate and skipped. Both clear
    // AA; they must also differ from each other.
    expect(PALETTE['amber-800']).not.toEqual(PALETTE['slate-600']);
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
// THE STRUCTURAL HALF. Measuring the tokens proves slate-600 is a sound choice; it does not prove
// the surfaces USE it. This is the same grep-guard technique the project already applies to the
// Functions-mirroring constraint, the transaction write guard and the disclosure's role axis.
//
// Matching on a class list that carries BOTH a text-size utility AND the colour is what keeps
// this from firing on icons: `<X className="w-4 h-4 text-slate-400" />` is an icon (governed by
// the 3:1 non-text rule, not 4.5:1), while `className="text-xs text-slate-500"` is prose.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('no extraction surface styles prose with a token that fails AA', () => {
  const SURFACES = [
    'src/components/FolderLogic.tsx',
    'src/components/SyncButton.tsx',
    'src/components/AssetCard.tsx',
    'src/components/InvestmentsImportModal.tsx',
    'src/components/ModelPicker.tsx',
    'src/components/AiExtractionEgressNotice.tsx',
  ];

  const CLASS_ATTR = /className=\{?["'`]([^"'`]*)["'`]/g;
  const SETS_TEXT_SIZE = /\btext-(?:xs|sm|base|lg|\[\d+px\])\b/;
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
