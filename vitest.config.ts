import react from '@vitejs/plugin-react';
import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/__tests__/setup.ts'],
    globals: true,
    // Stage 7 T2 — EXPLICIT, because the accident was the problem.
    //
    // This config declared no timeout at all, so every test in it sat on vitest's 5000 ms default
    // BY ACCIDENT. That default is fine for a render test and wrong for the tree-walk guard
    // family, which parses the whole of src/ with the TypeScript compiler: measured at HEAD
    // f2eae0c over three consecutive runs, that family was 31–34% of this suite's per-file time,
    // the worst single assertion was 1248–1678 ms, and AiExtractionEgressNotice.surfaces alone was
    // 3785–4239 ms. T1 added one more full-src parse and pushed three of them over 5000 ms
    // INTERMITTENTLY — and a vitest timeout inside an `it()` surfaces as an assertion failure with
    // a different set each run, so the cost lands as hours on a false trail rather than as seconds
    // on a clock. (The Stage 6 ledger recorded the same shape three times as "AiSettingsScreen
    // flake"; load was the trigger, the 5s budget was already spent.)
    //
    // The parse cache in src/__tests__/helpers/extractionSurfaces.ts is the real fix. 20000 ms is
    // the decision that stops the growth rate deciding for us as T4–T8 add guards: ample headroom
    // over the post-cache worst case, and still short enough that a genuinely hung test reports
    // rather than hangs the run. Sibling configs (vitest.rules.config.ts 20000,
    // vitest.build.config.ts 180000) already state theirs; this was the only one that did not.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // firestore-tests/ requires a live Firestore emulator and its own config
    // (vitest.rules.config.ts, run via `npm run test:rules`) — exclude it here so the
    // default unit suite doesn't try to pick it up and fail for lack of an emulator.
    // functions/ is a separate Firebase-CLI-managed package (D2) with its own vitest config,
    // env (node, not jsdom), and green gate (`npm run test:functions`) — without this exclude,
    // vitest's default discovery also picks up functions/src/**/*.test.ts and silently
    // double-runs it here under the wrong environment, which is not this suite's job to do.
    //
    // *.build.test.ts runs a real production build and writes dist/ — ~2.5s of wall clock and the
    // only side effect in the repo's tests. It has its own config (vitest.build.config.ts) and its
    // own gate (`npm run test:build`, wired into `npm run test:all`); this suite stays hermetic
    // and fast. Excluded here and included there, so exactly one config collects it.
    exclude: [
      ...configDefaults.exclude,
      'firestore-tests/**',
      'functions/**',
      'src/__tests__/**/*.build.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
