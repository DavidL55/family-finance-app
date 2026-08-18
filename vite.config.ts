import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

// Stage 6 batch 9 (closing review M3) — STALE CLIENT CONFIG, REMOVED.
//
// Two things used to live here and no longer have anything to serve:
//
//  · `define` inlined the repo-root .env's Gemini key into the browser bundle. Task 7 moved every
//    provider call into Cloud Functions, so nothing in src/ reads it. The closing review
//    confirmed by grep that the built dist/ contains neither the key value, the name, nor
//    GoogleGenAI — so this was dead weight rather than a live leak — but a build step that
//    inlines a secret is one reintroduced import away from becoming one, and it was the last
//    thing keeping a server-side key in the client build graph.
//  · `optimizeDeps.include` pre-bundled the browser entry of a package that is no longer a root
//    dependency at all (it stays a functions/ dependency, where the real adapters use the NODE
//    entry). Pre-bundling a package nothing imports is a no-op at best.
//
// CLOSE VERIFICATION F3 — AND THE SENTENCE THAT USED TO SIT HERE WAS A CLAIM NOTHING CHECKED.
//
// It said the repo-root key "is now read only by functions/ and by scripts, never by the client
// build". Deleting the `define` block above does not make that true, and it never was: the key
// lives in the repo-root .env under a `VITE_` prefix, and the VITE_ prefix IS Vite's contract for
// "inline this into the client bundle". One `import.meta.env.VITE_GEMINI_API_KEY` anywhere under
// src/ puts the live key into dist/assets/*.js with no change to this file at all — reproduced,
// key in the bundle, whole suite green, nothing here touched.
//
// What is true, and what a test now checks: NOTHING UNDER src/ READS THAT VARIABLE — because the
// set of environment variables src/ may read is pinned to an exact list, and no pinned name may be
// one of the provider key names read by functions/src/providers/*Adapter.ts, whatever prefix it
// wears. See src/__tests__/clientAiPlumbing.test.ts, which still closes the `define:` route and
// the vendor-SDK-import route as well.
//
// FINAL VERIFICATION — AND THE ALIAS BELOW USED TO POINT AT THE REPO ROOT.
//
// `'@': path.resolve(__dirname, '.')` meant `@/anything` resolved to ANY FILE IN THE REPO, so a
// module sitting OUTSIDE src/ could be pulled into the client graph and read the key there — where
// the guard, which walks src/, never looked. Reproduced: a two-line `probeRootModule.ts` at the
// repo root, imported from src/main.tsx as `@/probeRootModule`, put the live 39-character key into
// dist/assets/index-*.js with all 1260 tests green and both tsc clean. It is the ORIGINAL F3
// exploit relocated one directory up.
//
// The alias now points at src/, which is what every other project means by `@`. Nothing used `@/`
// (zero call sites at the time of the change), so this narrows what is reachable and breaks
// nothing. tsconfig.json's `paths` is moved with it, and clientAiPlumbing.test.ts asserts BOTH
// point inside src/ and that no import under src/ climbs out of it — containment is the premise
// that makes "walk src/" a complete scan rather than a lucky one.
//
// The repo-root .env is David's file and is deliberately not touched here.
export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
