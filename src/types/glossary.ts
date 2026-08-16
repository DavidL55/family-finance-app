// D4 — the shape every glossary entry must satisfy. Spec §5.2 requires that a hover/tap on any
// number answers, in plain language: what is this, how was it computed, which data does it come
// from, and as of when. `source` and `asOf` carry the last two explicitly rather than folding
// them into free-text `explanation`, so a future Firestore-backed glossary (spec §7, not this
// stage — see glossary.ts's header comment) can render them as separate fields without a text
// re-parse.
export interface GlossaryEntry {
  id: string;
  title: string;
  explanation: string;
  howComputed: string;
  source: string;
  asOf?: string;
}
