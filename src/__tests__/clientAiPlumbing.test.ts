// Stage 6 batch 9 (closing review M3) — THE DEAD CLIENT-SIDE AI PLUMBING STAYS DEAD.
//
// M3 was explicit that this is NOT a key leak: the closing reviewer grepped the built dist/ for
// the literal key value, for GEMINI_API_KEY and for GoogleGenAI, and found all three absent, so
// Task 7's claim held. What it found was stale CONFIG — four things still wired up for a
// client-side Gemini call that has not existed since Task 7:
//
//   · vite.config.ts inlined `process.env.GEMINI_API_KEY` into the bundle via `define`
//   · optimizeDeps pre-bundled '@google/genai/web'
//   · @google/genai was still a ROOT dependency
//   · the Hosting CSP named generativelanguage.googleapis.com (see hostingCsp.test.ts)
//
// None of it did anything. All of it made a reintroduction cheap and invisible: an author who
// imports GoogleGenAI in a component today gets a resolution error; before this batch they got a
// working client with a real key already inlined for them.
//
// FileProcessor.test.ts used to carry the regression guard for this as a `vi.mock` of
// '@google/genai/web' plus `expect(constructor).not.toHaveBeenCalled()`. That guard could only
// ever observe a call it was already mocking — it proved the current call path, not the absence
// of the package. This file asserts the absence directly, which is the stronger claim and the one
// that actually forecloses the reintroduction.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, stripComments } from './helpers/extractionSurfaces';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(rel: string): PackageJson {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, rel), 'utf8')) as PackageJson;
}

/** Every non-test source file under a directory, recursively. Includes __tests__ deliberately —
 *  a client-side provider SDK smuggled in behind a test helper would be just as reintroduced. */
function allFiles(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(allFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('no vendor AI SDK can reach the browser bundle (closing review M3)', () => {
  it('@google/genai is not a root dependency — a client-side import would not even resolve', () => {
    const pkg = readPackageJson('package.json');
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(all)).not.toContain('@google/genai');
  });

  it('…but functions/ still depends on it, because that is where the real adapter lives', () => {
    // The complementary half, stated so "remove the dependency" can never be read as "remove the
    // Google provider". The Google adapter is the only one tagged for extraction today.
    const pkg = readPackageJson('functions/package.json');
    expect(Object.keys(pkg.dependencies ?? {})).toContain('@google/genai');
  });

  it('no file under src/ imports a vendor AI SDK', () => {
    // Matches the IMPORT FORMS specifically (`from '…'`, `import('…')`, `require('…')`) rather
    // than the bare package name: this guard's own assertions above contain the string
    // '@google/genai' as data, and a name-substring scan would report this file as its own
    // violation. A vi.mock of one of these paths counts too, deliberately — that is how the
    // previous, weaker version of this guard was written.
    const SDK = String.raw`@google/genai(?:/\w+)?|@anthropic-ai/sdk|openai`;
    const IMPORTS = new RegExp(String.raw`(?:from|import|require|vi\.mock)\s*\(?\s*['"](?:${SDK})['"]`);
    const offenders = allFiles(resolve(REPO_ROOT, 'src'))
      .filter((full) => IMPORTS.test(stripComments(readFileSync(full, 'utf8'), full)))
      .map((full) => relative(REPO_ROOT, full));
    expect(offenders).toEqual([]);
  });

  it('the Vite build no longer inlines a provider key into the bundle', () => {
    const config = stripComments(readFileSync(resolve(REPO_ROOT, 'vite.config.ts'), 'utf8'), 'vite.config.ts');
    // Comments are stripped first: this file's own explanation of what was removed names the very
    // string being searched for, which is precisely the comment-satisfiability trap batch 7's
    // mutation sweep found in two other guards.
    expect(config).not.toMatch(/GEMINI_API_KEY/);
    expect(config).not.toMatch(/@google\/genai/);
    // And no `define` block at all: it existed only to carry that key, so its return is the
    // signal worth catching, not merely that one particular key name came back.
    expect(config).not.toMatch(/\bdefine\s*:/);
  });
});
