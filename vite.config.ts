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
// The repo-root .env still holds a real Gemini key. It is David's file and is deliberately not
// touched here; it is now read only by functions/ and by scripts, never by the client build.
// Guarded by src/__tests__/clientAiPlumbing.test.ts.
export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
