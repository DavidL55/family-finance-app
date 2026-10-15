// @vitest-environment node
// Lives in scripts/__tests__ (not src/__tests__): it reads the repo's shell scripts and
// src/__tests__/clientAiPlumbing.test.ts pins process.env / fs reads for everything under src/.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('live mode reads a rules snapshot, never the tracked file (Sun, C1)', () => {
  const sh = readFileSync('scripts/live/start-live.sh', 'utf8');
  it('snapshots firestore.rules and starts the emulator from the generated config', () => {
    const snap = sh.indexOf('live.rules');
    const start = sh.indexOf('emulators:start');
    expect(snap).toBeGreaterThan(-1);
    expect(snap).toBeLessThan(start);
    expect(sh.slice(start, sh.indexOf('\n', start))).toContain('--config .firebase-live.json');
  });
  it('the config rewrite throws unless firestore.rules is a string, so the pin cannot be silently skipped', () => {
    const rewrite = sh.slice(sh.indexOf("node -e '"), sh.indexOf('\n', sh.indexOf('.firebase-live.json')));
    expect(rewrite).toContain("typeof c.firestore?.rules !== \"string\"");
    expect(rewrite.indexOf('throw new Error')).toBeGreaterThan(-1);
    expect(rewrite.indexOf('throw new Error')).toBeLessThan(rewrite.indexOf('c.firestore.rules=process.argv[2]'));
  });
  it('runs --ensure-access on every start, after the emulator is ready', () => {
    const ensure = sh.indexOf('bootstrap-live.ts --ensure-access');
    expect(ensure).toBeGreaterThan(-1);
    expect(ensure).toBeGreaterThan(sh.indexOf('All emulators ready'));
  });
  it('the generated config is git-ignored', () => {
    expect(readFileSync('.gitignore', 'utf8')).toMatch(/^\.firebase-live\.json$/m);
  });
});
