// Stage 6 batch 9 — the Tailwind→sRGB→WCAG math, extracted so a second surface can measure
// without transcribing it.
//
// Batch 5's rule, kept verbatim because it is the whole reason this exists: a hardcoded ratio is
// a comment that a Tailwind upgrade silently falsifies. The palette is READ from the installed
// theme file at test time, never written down — so a palette shift in a future upgrade fails a
// test instead of quietly degrading text nobody re-measures.
//
// It moved out of AiExtractionSurfaces.contrast.test.ts when the chat surface needed the same
// measurement (the per-answer model badge, text-indigo-400, missed by batch 5's 29-class sweep).
// Copying forty lines of colour-space conversion into a second test file is the F4 class exactly:
// two copies, one of them going quietly stale.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type RGB = [number, number, number];

/** The palette the app actually ships, read from the installed Tailwind theme — not transcribed. */
function loadPalette(): Record<string, RGB> {
  const css = readFileSync(
    resolve(__dirname, '../../..', 'node_modules/tailwindcss/theme.css'),
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
export function oklchToSrgb(L: number, C: number, hDeg: number): RGB {
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
export function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(fg: RGB, bg: RGB): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const PALETTE = loadPalette();

/** Contrast between two Tailwind colour tokens, e.g. ratio('indigo-600', 'white'). */
export const ratio = (token: string, bg: string): number => contrast(PALETTE[token], PALETTE[bg]);

/** WCAG 2.1 AA for normal-size text. Anything below 18.66px-bold / 24px is held to this. */
export const AA_NORMAL = 4.5;
