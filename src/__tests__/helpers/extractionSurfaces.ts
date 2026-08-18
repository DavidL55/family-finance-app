// Stage 6 batch 9 — the tree-walk that batch 7 had to duplicate, extracted at last.
//
// Batch 7 rewrote three guards (mutation-sweep survivors S1–S4) to DERIVE the extraction-surface
// list by walking src/ instead of iterating a hardcoded array, because the hardcoded arrays sat
// under comments promising "this fails the day a FIFTH extraction surface is added without the
// notice" and could not. The rewrite left the ~70 lines of walker and comment-stripper copied
// verbatim into two test files, and recorded WHY the obvious fix was unavailable:
//
//   importing AiExtractionEgressNotice.surfaces.test.tsx from
//   AiExtractionSurfaces.contrast.test.ts would execute forty render cases and every vi.mock
//   registration in the other file, inside this suite.
//
// A helper MODULE has neither problem: it registers no mocks, renders nothing, and is not itself
// a test file, so vitest never collects it. Both guards keep reading the tree — the property that
// actually protects them — and now read it through one implementation.
//
// It lives under __tests__/ so the walkers below, which skip any directory named __tests__, can
// never scan themselves. That is not incidental: AiExtractionEgressNotice.tsx's own header
// comment contains the literal `<ModelPicker action="extraction">`, which is exactly why
// stripComments has to run before any of this matching (batch 7 caught that the naive version of
// this fix misclassifies the notice component as a surface and then fails looking for a notice
// inside the notice).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const REPO_ROOT = resolve(__dirname, '../../..');
export const SRC_ROOT = resolve(__dirname, '../..');

/** Removes `//` and block comments, respecting string and template literals. */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Every non-test .ts/.tsx file under `dir`, recursively. */
export function listSourceFiles(dir: string): string[] {
  let files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'fixtures') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files = files.concat(listSourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full);
  }
  return files;
}

/** Brace-depth aware, so a `>` inside a JSX expression cannot terminate the tag early. */
export function jsxOpeningTags(source: string, name: string): string[] {
  const tags: string[] = [];
  const re = new RegExp(`<${name}\\b`, 'g');
  for (let m = re.exec(source); m; m = re.exec(source)) {
    let depth = 0;
    for (let i = m.index; i < source.length; i++) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) {
        tags.push(source.slice(m.index, i + 1));
        break;
      }
    }
  }
  return tags;
}

export const EXTRACTION_ACTION =
  /\baction\s*=\s*(?:"extraction"|'extraction'|\{\s*['"]extraction['"]\s*\})/;

/** Repo-relative, POSIX-separated paths of every file under src/ that mounts an extraction ModelPicker. */
export function findExtractionSurfaces(): string[] {
  return listSourceFiles(SRC_ROOT)
    .filter((full) =>
      jsxOpeningTags(stripComments(readFileSync(full, 'utf8')), 'ModelPicker')
        .some((tag) => EXTRACTION_ACTION.test(tag))
    )
    .map((full) => relative(REPO_ROOT, full).replace(/\\/g, '/'))
    .sort();
}
