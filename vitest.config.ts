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
    exclude: [...configDefaults.exclude, 'firestore-tests/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
