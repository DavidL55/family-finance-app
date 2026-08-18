import react from '@vitejs/plugin-react';
import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/__tests__/setup.ts'],
    globals: true,
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
