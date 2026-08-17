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
    exclude: [...configDefaults.exclude, 'firestore-tests/**', 'functions/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
