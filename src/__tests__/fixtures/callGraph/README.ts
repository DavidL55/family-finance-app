// RE-REVIEW R-3 — the call graph's own test tree.
//
// These files exist ONLY to be walked by extractionCallerFilesIn (see
// ../../helpers/extractionSurfaces.ts). They are never imported by anything, never rendered, and
// never collected by vitest.
//
// They live here rather than in src/ for a reason that is the whole point of the fixture: a file
// in src/ that reaches the extractor IS an extraction surface, so a hostile shape planted there
// to test the graph would have to carry a real disclosure — at which point it stops testing the
// thing it was written for. listSourceFiles skips both `__tests__` and `fixtures`, so nothing
// here can leak into the real derived surface list.
export const CALL_GRAPH_FIXTURE_README = true;
