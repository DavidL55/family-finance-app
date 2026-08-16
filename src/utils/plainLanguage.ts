// Ofra ruling I5 — spec §5.2 requires glossary copy "בשפה פשוטה", plain Hebrew a family member
// (including a child) understands. "The string is non-empty" does not test that requirement at
// all. This module is the testable standard: a short banned-jargon list (financial/technical
// terms this app must never surface to a lay reader, including untranslated English acronyms
// like 'ROI') plus a hard cap on sentence length. Both are cheap, deterministic, and catch the
// two most common ways "plain language" copy quietly drifts back into jargon: a stray technical
// term, or a sentence so long a child loses the thread halfway through. It does NOT catch
// "technically simple words in a confusing order" — that residual risk is why the glossary
// entries additionally require a named human reviewer (see glossary.ts's header comment) before
// this task closes; this function is the automated floor, not the whole standard.
export const BANNED_JARGON: readonly string[] = [
  'נזילות',
  'תזרים',
  'רגרסיה',
  'ROI',
  'וריאנס',
  'provenance',
  'rollup',
  'aggregation',
  'materialized',
  'context',
];

// A sentence longer than this is assumed too dense for a lay reader to follow in one read,
// regardless of vocabulary — an arbitrary but concrete, enforceable line (Ofra I5).
export const MAX_SENTENCE_WORDS = 22;

/**
 * Splits `text` into sentences on `. ! ? ׃`, then flags:
 *  - any sentence with more than MAX_SENTENCE_WORDS words, and
 *  - any occurrence (case-insensitive) of a BANNED_JARGON term anywhere in `text`.
 * Returns a human-readable reason string per violation; an empty array means compliant.
 */
export function violatesPlainLanguage(text: string): string[] {
  const violations: string[] = [];

  const sentences = text
    .split(/[.!?׃]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const sentence of sentences) {
    const wordCount = sentence.split(/\s+/).filter((w) => w.length > 0).length;
    if (wordCount > MAX_SENTENCE_WORDS) {
      violations.push(
        `המשפט "${sentence}" ארוך מדי (${wordCount} מילים, מקסימום ${MAX_SENTENCE_WORDS})`
      );
    }
  }

  const lowerText = text.toLowerCase();
  for (const term of BANNED_JARGON) {
    if (lowerText.includes(term.toLowerCase())) {
      violations.push(`המילה "${term}" היא ז'רגון שאסור להשתמש בו`);
    }
  }

  return violations;
}
