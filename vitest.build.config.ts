import { defineConfig } from 'vitest/config';

// Stage 6 close — THE BUILD-OUTPUT GUARD, ON ITS OWN CLOCK.
//
// src/__tests__/bundleEnvLeak.build.test.ts runs a real production build and then asserts about
// dist/. That is ~2.5s of wall clock and a write to dist/, and the default suite (`npm test`,
// ~9.8s, 1314 tests, hermetic) should carry neither. It runs from `npm run test:all` instead, next
// to the Firestore-rules suite, which is also gated on a real external thing.
//
// Its file name is what routes it: `*.build.test.ts` is INCLUDED here and EXCLUDED in
// vitest.config.ts, so exactly one of the two configs ever collects it. It is a suffix and not a
// directory called build/ on purpose — .gitignore's `build/` would have swallowed the file whole.
//
// environment: 'node' — this suite reads the filesystem and spawns a build; it renders nothing, so
// jsdom and the shared setup file are cost with no benefit.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.build.test.ts'],
    // The build alone outlives vitest's 5s default, and a cold one on CI outlives it by more.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
