// src/config/adviceBoundary.ts — §9's advice boundary. PRODUCT-WIDE, not a forecast feature.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS SENTENCE HAS ITS OWN MODULE, AND WHY IT IS NOT IN `forecastCopy.ts`
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// T6 shipped this constant inside `utils/forecastCopy.ts`, and shipping it EARLY was right: the
// allowance row is the first thing this app ships that tells a family what to do with money, and a
// boundary notice arriving one stage after the surface that needs it is late by exactly the amount
// that mattered.
//
// But §9 pins this line to the INSIGHTS screen too, which is Stage 8. Left in a FEATURE copy module
// it leaves Stage 8 exactly two options, and both are defects this project has already paid for:
// import forecast copy into an insights screen (a feature module becoming a product-wide address),
// or write the sentence out a second time (the duplicate-map class — two copies agree until one is
// edited, and then the app makes two different licensing statements). So it MOVED, once, before
// there was a second caller to break.
//
// ── WHAT IT IS ────────────────────────────────────────────────────────────────────────────────
//
// §9's own sentence plus the licensing half §9 also states. It is a LEGAL/PRODUCT boundary rather
// than a caption: the first half says the screen is a picture to check rather than an instruction,
// and the second says what this system is not. Neither half is optional and neither is per-feature,
// which is the other half of the argument for this file.
//
// ── THE BINDING ───────────────────────────────────────────────────────────────────────────────
//
// T6 also shipped it with NO BINDING — the constant was imported by nothing and nothing required it
// to appear wherever an allowance row appears (T6 review, F10). `adviceBoundary.test.ts` holds the
// pairing guard: any module that reaches for the allowance lead must also reach for this notice.

/** §9's own sentence, both halves. */
export const ADVICE_BOUNDARY_NOTICE_HE =
  'זו תמונת מצב לבדיקה, לא הוראת פעולה. המערכת אינה יועץ פיננסי מורשה.';
