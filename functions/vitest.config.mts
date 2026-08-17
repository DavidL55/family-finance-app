import { defineConfig } from 'vitest/config';

// Deliberately separate from the root's vitest.config.ts (D2 — functions/ is a standalone
// Firebase-CLI-managed package, not an npm workspace of the root). Without a config file here,
// Vite's config resolution walks up to the root's vitest.config.ts, which sets jsdom + a
// setupFiles path that only exists relative to the root project — breaking every test in this
// package. Node environment, no setup file: functions/ tests are plain server-side TS, no DOM.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Restrict discovery to src/ only. Without this, a stray `lib/` (the tsc build output —
    // gitignored, but present on disk after anyone runs `npm run build`) gets picked up too,
    // since it contains compiled *.test.js copies of the same tests — vitest then tries to
    // `require()` the CJS-compiled copy, which fails immediately (vitest is ESM-only).
    include: ['src/**/*.{test,spec}.ts'],
  },
});
