// Stage 6 batch 10 — THE HELPER THAT EVERY COMMENT-SATISFIABILITY GUARD RESTS ON, TESTED AT LAST.
//
// stripComments had no test of its own. It was written in batch 7 to close the original HIGH
// bypass (a reviewer defeated a guard by leaving the expected literal in a comment) and was then
// trusted by seven guard files, and the one thing nobody checked was the stripper itself. It was
// wrong: a hand-rolled character scanner that knew the three quote characters and nothing about
// regex literals, so the first `/…"…/` in a file desynchronised it permanently.
//
// The cost of that, measured on the real tree before the fix (each of these passed 1174/1174):
//
//   · the extraction disclosure resolving its provider off the CHAT model list, with the
//     `useAiModels('extraction')` the guard greps for sitting in a comment;
//   · a live `session.role === 'super-admin'` gate inside useActorMemberId — F4's exact mechanism,
//     on the accessor the four egress surfaces use;
//   · a `define` block inlining the repo-root Gemini key back into the browser bundle.
//
// The first is comment-satisfiability. The other two are the inverse and are worse: once
// desynchronised the scanner reads real code as a block comment and DELETES it, so a guard that
// says "this file must not contain X" stops being able to see X at all. A stripper that can hide
// code fails OPEN on every negative guard built on it.
//
// So the shapes below are not a tidy lexer exercise. Each one is a way the previous implementation
// could be made to lie, and the two end-to-end tests at the bottom are the actual property the
// seven guard files depend on.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  EXTRACTION_ACTION,
  __derivedForTest,
  __resetSourceCaches,
  collectionAliases,
  jsxOpeningTags,
  parseSource,
  readSourceCached,
  referencesCollection,
  resolveObjectLiteral,
  stringLiterals,
  stripComments,
} from './helpers/extractionSurfaces';

/**
 * A throwaway directory of source files, for the cross-file half of the collection-alias
 * technique. A temp dir, never a probe written into `src/`: vitest runs test files in parallel and
 * a file appearing under src/ mid-run changes what every other tree-walk guard sees.
 */
function withTree(files: Record<string, string>, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'coll-alias-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(dir, name), contents, 'utf8');
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('stripComments removes comments and nothing else', () => {
  it('does not desynchronise on a regex literal containing a quote character — THE exploit', () => {
    const src = [
      'const CLASS_ATTR = /className=\\{?["\'`]([^"\'`]*)["\'`]/g;',
      '// SECRET_MARKER',
      'const after = 1;',
    ].join('\n');
    expect(stripComments(src)).not.toContain('SECRET_MARKER');
    // …and the regex literal itself is untouched.
    expect(stripComments(src)).toContain('const CLASS_ATTR = /className=');
    expect(stripComments(src)).toContain('const after = 1;');
  });

  it('does not read real code as a comment — the DELETION half, which fails negative guards open', () => {
    // The shape that hid a role gate and a secret-inlining `define` block from two guards: the
    // old scanner desynchronised on `/"/`, then took the `/*` inside the next string literal as
    // the start of a block comment and deleted everything up to the `*/` inside a later one.
    const src = [
      'const Q = /"/;',
      'const OPEN_MARKER = "/*";',
      'const role = session.role;',
      'const CLOSE_MARKER = "*/";',
    ].join('\n');
    const out = stripComments(src);
    expect(out).toContain('const role = session.role;');
    expect(out).toContain('const Q = /"/;');
  });

  it('keeps a regex character class that contains a slash from ending the literal early', () => {
    const src = 'const RE = /[/]"x/g;\n// SECRET_MARKER\nconst after = 1;';
    const out = stripComments(src);
    expect(out).not.toContain('SECRET_MARKER');
    expect(out).toContain('const after = 1;');
  });

  it('treats division as division, not as the start of a regex', () => {
    // `a / b` followed later by another slash is two divisions. A scanner that guesses "regex"
    // swallows the code between them; one that guesses "division" everywhere misses real regexes.
    // Only the parser knows, which is the entire argument for using it.
    const src = 'const ratio = width / height;\nconst other = total / count; // SECRET_MARKER\n';
    const out = stripComments(src);
    expect(out).not.toContain('SECRET_MARKER');
    expect(out).toContain('const ratio = width / height;');
    expect(out).toContain('const other = total / count;');
  });

  it('leaves comment markers that are STRING CONTENT alone', () => {
    const src = "const url = 'https://example.com/a';\nconst block = '/* not a comment */';\n// SECRET_MARKER";
    const out = stripComments(src);
    expect(out).toContain('https://example.com/a');
    expect(out).toContain('/* not a comment */');
    expect(out).not.toContain('SECRET_MARKER');
  });

  it('handles nested template substitutions, including a comment inside one', () => {
    const src = 'const t = `a${ `b${ c /* SECRET_MARKER */ }d` }e`;\nconst after = 1;';
    const out = stripComments(src);
    expect(out).not.toContain('SECRET_MARKER');
    expect(out).toContain('const t = `a${');
    expect(out).toContain('const after = 1;');
  });

  it('does NOT delete JSX text that merely looks like a comment — that text is rendered', () => {
    // A guard reading these components' markup would otherwise lose real copy from under itself.
    // The own-line form is the one that distinguishes: with the text mid-line the trivia scan
    // stops on the first real character anyway, so `<p>50 km // hour</p>` cannot tell a correct
    // implementation from a broken one. Skipping the JsxText NODE is likewise not enough — the
    // scan runs again at the full start of the SyntaxList holding the children, which is the same
    // position — so the fix is a span check, and this is the mutation that proves it.
    const src = ['const El = () => (', '  <p>', '    // 50 km per hour, rendered', '  </p>', ');'].join('\n');
    expect(stripComments(src, 'El.tsx')).toContain('// 50 km per hour, rendered');
    // …while a real comment in the same component still goes.
    const withReal = ['const El = () => (', '  // SECRET_MARKER', '  <p>', '    // rendered', '  </p>', ');'].join('\n');
    const out = stripComments(withReal, 'El.tsx');
    expect(out).not.toContain('SECRET_MARKER');
    expect(out).toContain('// rendered');
  });

  it('strips a comment sitting inside a JSX opening tag, where the surfaces really put them', () => {
    const src = [
      'const El = () => (',
      '  <p',
      '    data-testid="x"',
      '    // SECRET_MARKER',
      '    className="text-xs"',
      '  />',
      ');',
    ].join('\n');
    const out = stripComments(src, 'El.tsx');
    expect(out).not.toContain('SECRET_MARKER');
    expect(out).toContain('className="text-xs"');
  });

  it('blanks rather than deletes, so a block comment cannot fuse the tokens either side of it', () => {
    // The old implementation returned `foobar` here — an identifier present in neither the source
    // nor the stripped source, and a match a guard could be handed for free.
    expect(stripComments('foo/*c*/bar;')).not.toContain('foobar');
    expect(stripComments('foo/*c*/bar;')).toMatch(/foo\s+bar;/);
  });

  it('preserves every byte offset and line number, so windowed matches see the same geometry', () => {
    // The block comment SPANS LINES on purpose: a single-line comment's range stops before its
    // newline, so a blanker that also flattened newlines would look correct on one. Line numbers
    // are what a guard's failure output points at, and what any positional report is measured in.
    const src = 'const a = 1; /* one\n * two\n */\n// three\nconst b = 2;\n';
    const out = stripComments(src);
    expect(out).toHaveLength(src.length);
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    expect(out.indexOf('const b')).toBe(src.indexOf('const b'));
    expect(out).not.toContain('two');
  });

  it('parses .ts as TS and .tsx as TSX, so neither mode mangles the other', () => {
    const tsx = 'const El = () => <div className="x" />; // SECRET_MARKER';
    expect(stripComments(tsx, 'a.tsx')).toContain('className="x"');
    expect(stripComments(tsx, 'a.tsx')).not.toContain('SECRET_MARKER');
    const tsFile = 'export const n: number = 1; // SECRET_MARKER';
    expect(stripComments(tsFile, 'a.ts')).not.toContain('SECRET_MARKER');
  });

  it('THE PROPERTY THE GUARDS ACTUALLY DEPEND ON: a literal only present in a comment is gone', () => {
    // Written as the attack rather than as a lexer assertion, because this is the shape that has
    // twice defeated a real guard in this stage.
    const attack = [
      'const TIDY = /["\']/g;',
      "// renders <AiExtractionEgressNotice source=\"default\" /> and calls useAiModels('extraction')",
      "const { models } = useAiModels('chat');",
    ].join('\n');
    const out = stripComments(attack);
    expect(out).not.toMatch(/<AiExtractionEgressNotice\b/);
    expect(out).not.toMatch(/useAiModels\(\s*'extraction'\s*\)/);
    // The real call is still there to be measured, which is the other half of being useful.
    expect(out).toMatch(/useAiModels\(\s*'chat'\s*\)/);
  });

  it('strips an END-OF-LINE comment, not only one on its own line', () => {
    // The bug this file caught in its own subject before it shipped. TypeScript splits the trivia
    // in front of a token at its first newline, and getLeadingCommentRanges returns only the half
    // after it — so a leading-only implementation keeps every trailing `// …` in the repo, which
    // is most of them, while looking perfectly correct on own-line comments.
    expect(stripComments('const a = 1; // SECRET_MARKER\n')).not.toContain('SECRET_MARKER');
    expect(stripComments('const a = 1; /* SECRET_MARKER */ const b = 2;')).not.toContain('SECRET_MARKER');
  });

  it('clears EVERY comment in one trivia gap, on both sides of the newline that splits it', () => {
    const src = [
      'const a = 1; /* ONE */ // TWO',
      '  // THREE',
      '  /* FOUR */ const b = 2;',
    ].join('\n');
    const out = stripComments(src);
    for (const marker of ['ONE', 'TWO', 'THREE', 'FOUR']) expect(out).not.toContain(marker);
    expect(out).toContain('const a = 1;');
    expect(out).toContain('const b = 2;');
  });

  it('is not vacuous — it really does return the code, not an empty string', () => {
    const src = 'const a = 1;\n// gone\nconst b = 2;';
    const out = stripComments(src);
    expect(out).toContain('const a = 1;');
    expect(out).toContain('const b = 2;');
    expect(out.trim().length).toBeGreaterThan(0);
  });
});

describe('stringLiterals reads literals off the AST, not with a second hand-rolled lexer', () => {
  it('is not shifted by a regex literal containing a quote — the QUOTED_STRING defect', () => {
    // The regex form paired the `"` inside `/"/` with the next real quote and swallowed the class
    // list into one oversized pseudo-string, which then split into tokens no anchor could match.
    const src = ["const Q = /\"/;", "const CLS = 'mt-1 text-xs text-slate-400';"].join('\n');
    expect(stringLiterals(src)).toContain('mt-1 text-xs text-slate-400');
  });

  it('returns the parts of a template literal, not one blob', () => {
    const src = 'const t = `head ${x} tail`;';
    expect(stringLiterals(src)).toEqual(expect.arrayContaining(['head ', ' tail']));
  });

  it('never returns comment text, which is what closes comment-satisfiability here by construction', () => {
    const src = "// 'mt-1 text-xs text-slate-400'\nconst real = 'ok';";
    expect(stringLiterals(src)).toEqual(['ok']);
  });

  it('reads a class list out of a ternary, which the className-anchored regex could not see', () => {
    const src = "const El = () => <p className={hot ? 'text-xs text-red-600' : 'text-xs text-slate-700'} />;";
    expect(stringLiterals(src, 'El.tsx')).toEqual(
      expect.arrayContaining(['text-xs text-red-600', 'text-xs text-slate-700'])
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────────────────────
// CLOSE VERIFICATION F2 — THE THIRD HAND-ROLLED LEXER, AND THE ONE THAT FAILED OPEN SILENTLY.
//
// jsxOpeningTags was a brace-depth scanner over raw text and it had NO test of its own — the same
// omission stringLiterals and stripComments above were written to close, one file over. Two
// separate defects, and the second is the one that makes this the ninth shadowed guard in the
// stage:
//
//   1. IT FAILED OPEN ON A BRACE INSIDE A STRING. `value={modelId.replace('}', '')}` decremented
//      the depth counter, no `>` was ever seen at depth 0, and the tag was DROPPED — so the file
//      stopped counting as an extraction surface and every guard built on the derived list
//      stopped examining it. Demonstrated live: tsc clean, 1218 green, notice deleted.
//   2. IT WAS ENTIRELY UNOBSERVED. Replacing the whole body with `return []` left ALL 1215 TESTS
//      GREEN, because findExtractionSurfaces is a UNION and all four known surfaces are also
//      reached by the call half. The commit that built that union wrote an explicit non-vacuity
//      canary for the CALL half and never wrote the mirror.
//
// These cases are the mirror at the unit level; AiExtractionEgressNotice.surfaces.test.tsx carries
// the mirror at the derived-list level.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('jsxOpeningTags reads opening elements off the AST, not with a third hand-rolled lexer', () => {
  const tag = (body: string): string[] =>
    jsxOpeningTags(`const El = () => <div>${body}</div>;`, 'ModelPicker', 'El.tsx');

  it('F2 EXACTLY: a `}` inside a STRING in the tag no longer drops it', () => {
    // The whole finding. The depth counter went negative on the `'}'` and never recovered.
    const tags = tag(`<ModelPicker action="extraction" value={modelId.replace('}', '')} />`);
    expect(tags).toHaveLength(1);
    expect(EXTRACTION_ACTION.test(tags[0])).toBe(true);
  });

  it('…and a `{` inside a string is the same defect in the other direction', () => {
    // The counter never returns to 0, so every subsequent `>` in the FILE is read as still inside
    // the tag — which drops this tag and can swallow the ones after it.
    const tags = tag(`<ModelPicker action="extraction" label={"{"} />`);
    expect(tags).toHaveLength(1);
    expect(EXTRACTION_ACTION.test(tags[0])).toBe(true);
  });

  it('the property the old comment claimed still holds — a `>` inside a JSX expression', () => {
    // Precision, and the reason the scanner counted braces at all: this must not regress while
    // fixing the case above.
    const tags = tag(`<ModelPicker action="extraction" hidden={count > 3}>x</ModelPicker>`);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('count > 3');
    expect(EXTRACTION_ACTION.test(tags[0])).toBe(true);
  });

  it('finds a multi-line tag and both of two tags in one file', () => {
    const tags = jsxOpeningTags(
      [
        'const El = () => <div>',
        '  <ModelPicker',
        '    action="extraction"',
        '  />',
        '  <ModelPicker action={"chat"} />',
        '</div>;',
      ].join('\n'),
      'ModelPicker',
      'El.tsx'
    );
    expect(tags).toHaveLength(2);
    expect(tags.filter((t) => EXTRACTION_ACTION.test(t))).toHaveLength(1);
  });

  it('a self-closing tag and a tag with children are both returned, ending at their own `>`', () => {
    expect(tag('<ModelPicker a="1" />')).toEqual(['<ModelPicker a="1" />']);
    expect(tag('<ModelPicker a="1">child</ModelPicker>')).toEqual(['<ModelPicker a="1">']);
  });

  it('a DIFFERENT component whose name merely starts with the same letters is not a match', () => {
    // The old regex used `\b` after the name, which happened to be right; an exact tag-name
    // comparison keeps that property rather than inheriting it.
    expect(tag('<ModelPickerRow action="extraction" />')).toEqual([]);
    expect(tag('<Model action="extraction" />')).toEqual([]);
  });

  it('a tag inside a COMMENT is not a tag — the notice component\'s own header is the real case', () => {
    // AiExtractionEgressNotice.tsx documents itself with the literal `<ModelPicker
    // action="extraction">`. Callers strip comments first, and the parser treats them as trivia
    // regardless, so this holds on the raw source too.
    const src = 'const El = () => <div>{/* <ModelPicker action="extraction" /> */}</div>;';
    expect(jsxOpeningTags(src, 'ModelPicker', 'El.tsx')).toEqual([]);
    expect(jsxOpeningTags('// <ModelPicker action="extraction" />\nconst x = 1;', 'ModelPicker', 'El.tsx'))
      .toEqual([]);
  });

  it('a tag named inside a STRING is not a tag either', () => {
    expect(jsxOpeningTags(`const s = '<ModelPicker action="extraction" />';`, 'ModelPicker', 'El.tsx'))
      .toEqual([]);
  });

  it('a file with no such tag returns nothing — so the positives above are not everything matching', () => {
    expect(tag('<OwnerPicker action="extraction" />')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// STAGE 7 T2 — THE PARSE CACHE, AND THE TWO WAYS A CACHE CAN LIE.
//
// The tree-walk guard family was ~31–34% of this suite's per-file time and its worst assertion sat
// 3–4x under vitest's (unconfigured, accidental) 5000 ms default; T1 pushed three of these guards
// over it INTERMITTENTLY, and a vitest timeout inside an `it()` presents as an assertion failure
// with a different set each run. The fix is a memoised read + parse in extractionSurfaces.ts.
//
// A cache introduces exactly two new failure modes, and both fail OPEN on every guard downstream
// of them, so both get a test here rather than a comment:
//
//   1. COLLISION — two different sources sharing one key. This is not hypothetical: the brief's
//      literal "(path, mtime)" key would do it, because `stripComments`/`stringLiterals`/
//      `jsxOpeningTags` are all called with SYNTHETIC source under a real or defaulted fileName
//      (forecastPurity.test.ts drives every non-vacuity case through a fabricated
//      `utils/synthetic.ts`; this very file calls stripComments with no fileName at all, so every
//      case above shares the key `source.tsx`). A guard asking about synthetic text would get the
//      real tree's answer back and pass on evidence about a different file.
//   2. STALENESS — a file edited after it was cached. `readSourceCached` keys on (path, mtime,
//      size) and the whole-tree derivations key on a fingerprint over that same triple; the test
//      below EDITS A REAL FILE IN src/ and asserts the derived surface list moves, then restores.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('the source cache cannot serve one file’s answer for another’s question', () => {
  it('two different sources under the SAME fileName strip independently — the collision a (path,mtime) key would make', () => {
    const name = '/some/where/collide.ts';
    const a = stripComments("const a = 1; // alpha\n", name);
    const b = stripComments("const b = 2; /* beta */\n", name);
    expect(a).toContain('const a = 1;');
    expect(a).not.toContain('alpha');
    expect(b).toContain('const b = 2;');
    expect(b).not.toContain('beta');
    // …and asking for the first one again still gets the first one.
    expect(stripComments("const a = 1; // alpha\n", name)).toBe(a);
  });

  it('the SAME source under the same fileName is byte-identical whether cached or cold', () => {
    const name = '/some/where/cold.tsx';
    const src = "const R = /[\"']/g;\n// the literal a guard greps for\nconst x = <p>{'hi'}</p>;\n";
    const warm = stripComments(src, name);
    __resetSourceCaches();
    expect(stripComments(src, name)).toBe(warm);
    expect(stringLiterals(src, name)).toEqual(stringLiterals(src, name));
  });

  it('re-reads a file whose bytes changed on disk AFTER it was cached', () => {
    // The order is the whole test. Creating a file and reading it once proves nothing about
    // staleness: there was no cache entry to be stale. (Written that way first, and a mutation that
    // made `readSourceCached` ignore mtime and size survived the whole 1452-test suite.)
    //
    // In the OS temp directory, NOT in src/. vitest runs test files in parallel, so a probe file
    // appearing under src/components/ mid-run changes what every other tree-walk guard sees — which
    // would manufacture the exact intermittent, different-set-each-run failure this cache exists to
    // remove. A guard whose own test can break its neighbours is not an improvement.
    const dir = mkdtempSync(join(tmpdir(), 'ffa-cache-'));
    const probe = join(dir, 'probe.tsx');
    const inert = 'export const Probe = () => <p>nothing to see</p>;\n';
    const changed = 'export const Probe = () => <ModelPicker action="extraction" />;\n';
    expect(inert.length).not.toBe(changed.length); // so `size` catches a same-millisecond rewrite
    try {
      writeFileSync(probe, inert, 'utf8');
      expect(readSourceCached(probe)).toBe(inert); // step 1 — CACHE IT
      writeFileSync(probe, changed, 'utf8');
      expect(readSourceCached(probe)).toBe(changed); // step 2 — CHANGED UNDER THE CACHE
      // …and the parsed form follows the text, so a downstream guard sees the new file too.
      expect(jsxOpeningTags(stripComments(readSourceCached(probe), probe), 'ModelPicker', probe))
        .toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the DERIVED-list cache consults its (path, mtime, size) fingerprint, not just its key', () => {
    // The second staleness surface: whole-tree derivations (findExtractionPickerSurfaces,
    // findExtractionCallerFiles) are memoised on a fingerprint over the scanned set, one level above
    // the parse cache. Driven through the same seam the real ones use, over a temp tree.
    const dir = mkdtempSync(join(tmpdir(), 'ffa-derived-'));
    const a = join(dir, 'a.ts');
    try {
      writeFileSync(a, 'one', 'utf8');
      const build = (): string[] => [readSourceCached(a)];
      expect(__derivedForTest('probe', [a], build)).toEqual(['one']);
      // Same bytes ⇒ served from the cache, and the caller gets a COPY it cannot poison.
      const served = __derivedForTest('probe', [a], build);
      served.push('poison');
      expect(__derivedForTest('probe', [a], build)).toEqual(['one']);
      // Different bytes ⇒ re-derived.
      writeFileSync(a, 'two-and-longer', 'utf8');
      expect(__derivedForTest('probe', [a], build)).toEqual(['two-and-longer']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T3 REVIEW F2 — "DOES THIS CALL TARGET COLLECTION C, AND WHAT ROW DOES IT WRITE?"
//
// THE SHARED TECHNIQUE, FIXED AT THE LEVEL EVERY GUARD IN THIS FAMILY ASKS THE QUESTION.
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Three guards had hand-rolled the same two decisions and all three got them wrong the same way:
//
//   · `transactionStampGuard` required the literal `'transaction_lines'` inside the write call's
//     OWN subtree, so hoisting `const ref = collection(db, 'transaction_lines')` — or using this
//     repo's own exported `TRANSACTION_LINES_COLLECTION` — made the write invisible;
//   · `forecastAssumptions`' `auditAtExpressions` did `arguments[0].getText().includes('audit_log')`
//     and required the payload to be an inline literal, so `auditLog.ts:45`
//     (`writer.set(doc(collection(db, AUDIT_LOG_COLLECTION), id), fullEntry)`) was invisible on
//     BOTH counts — which is why a separate hand-written text check existed beside it.
//
// The same class as the comment-satisfiability bypass this file already exists for, and the same
// answer: state the technique once, test it against synthetic source, and let the guards ask.
// A guard whose "is this my collection?" test can be defeated by a `const` is a guard that fails
// OPEN, and it fails open silently — it reports zero offenders, which is what a clean tree looks
// like.
describe('collectionAliases / referencesCollection — a hoisted reference is still the collection (F2)', () => {
  const sf = (src: string) => parseSource('/x/probe.ts', src);
  const aliases = (src: string, col = 'transaction_lines') =>
    [...collectionAliases(sf(src), '/x/probe.ts', col)].sort();
  const refs = (src: string, col = 'transaction_lines') => {
    const file = sf(src);
    const found: string[] = [];
    const alias = collectionAliases(file, '/x/probe.ts', col);
    // OUTERMOST match only — `addDoc(collection(db, X), row)` is one write, not two.
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && referencesCollection(n, col, alias)) {
        found.push(n.getText(file).split('\n')[0]);
        return;
      }
      n.forEachChild(visit);
    };
    file.forEachChild(visit);
    return found;
  };

  it('an inline literal needs no alias at all', () => {
    expect(refs("addDoc(collection(db, 'transaction_lines'), row);")).toEqual([
      "addDoc(collection(db, 'transaction_lines'), row)",
    ]);
  });

  it('!! A STRING CONSTANT IS THE COLLECTION — the repo exports exactly this one', () => {
    expect(aliases("const TRANSACTION_LINES_COLLECTION = 'transaction_lines';")).toEqual([
      'TRANSACTION_LINES_COLLECTION',
    ]);
    expect(
      refs(
        [
          "const TRANSACTION_LINES_COLLECTION = 'transaction_lines';",
          'addDoc(collection(db, TRANSACTION_LINES_COLLECTION), row);',
        ].join('\n')
      )
    ).toEqual(['addDoc(collection(db, TRANSACTION_LINES_COLLECTION), row)']);
  });

  it('!! A HOISTED REFERENCE IS THE COLLECTION — the 50th mutation, in one line', () => {
    expect(
      refs(
        [
          "const ref = collection(db, 'transaction_lines');",
          'await addDoc(ref, row);',
        ].join('\n')
      )
      // The binding's own `collection(...)` call names it too, which is how `ref` became an alias.
    ).toEqual(["collection(db, 'transaction_lines')", 'addDoc(ref, row)']);
  });

  it('follows a chain of bindings to a fixpoint, in either declaration order', () => {
    expect(
      aliases(
        [
          "const NAME = 'transaction_lines';",
          'const ref = collection(db, NAME);',
          'const rowRef = doc(ref, id);',
        ].join('\n')
      )
    ).toEqual(['NAME', 'ref', 'rowRef']);
    // Declared AFTER its use site, which is what a fixpoint buys over a single pass.
    expect(
      aliases(
        [
          'const rowRef = doc(ref, id);',
          'const ref = collection(db, NAME);',
          "const NAME = 'transaction_lines';",
        ].join('\n')
      )
    ).toEqual(['NAME', 'ref', 'rowRef']);
  });

  it('sees the Admin SDK spelling too', () => {
    expect(
      refs(
        [
          "const ref = db.collection('transaction_lines');",
          'batch.set(ref.doc(id), row);',
        ].join('\n')
      )
    ).toEqual(["db.collection('transaction_lines')", 'batch.set(ref.doc(id), row)']);
  });

  it('!! DOES NOT CLAIM A DIFFERENT COLLECTION — the alias set is per-collection', () => {
    const src = [
      "const INCOMES = 'incomes';",
      "const LINES = 'transaction_lines';",
      'addDoc(collection(db, INCOMES), row);',
    ].join('\n');
    expect(aliases(src)).toEqual(['LINES']);
    expect(refs(src)).toEqual([]);
    expect(refs(src, 'incomes')).toEqual(['addDoc(collection(db, INCOMES), row)']);
  });

  it('a commented-out binding does not create an alias', () => {
    // The comment-satisfiability property this file exists for, on the new technique. Callers pass
    // STRIPPED source, so the binding is simply not there.
    const src = "// const ref = collection(db, 'transaction_lines');\nawait addDoc(ref, row);";
    expect(aliases(stripComments(src, '/x/probe.ts'))).toEqual([]);
  });

  it('resolves an imported string constant across a relative import', () => {
    withTree(
      {
        'svc.ts': "export const TRANSACTION_LINES_COLLECTION = 'transaction_lines';",
        'writer.ts': [
          "import { TRANSACTION_LINES_COLLECTION } from './svc';",
          'await addDoc(collection(db, TRANSACTION_LINES_COLLECTION), row);',
        ].join('\n'),
      },
      (dir) => {
        const path = join(dir, 'writer.ts');
        const file = parseSource(path, readFileSync(path, 'utf8'));
        expect([...collectionAliases(file, path, 'transaction_lines')]).toEqual([
          'TRANSACTION_LINES_COLLECTION',
        ]);
      }
    );
  });

  it('an import of a constant holding a DIFFERENT collection is not an alias', () => {
    withTree(
      {
        'svc.ts': "export const AUDIT_LOG_COLLECTION = 'audit_log';",
        'writer.ts': [
          "import { AUDIT_LOG_COLLECTION } from './svc';",
          'await addDoc(collection(db, AUDIT_LOG_COLLECTION), row);',
        ].join('\n'),
      },
      (dir) => {
        const path = join(dir, 'writer.ts');
        const file = parseSource(path, readFileSync(path, 'utf8'));
        expect([...collectionAliases(file, path, 'transaction_lines')]).toEqual([]);
        expect([...collectionAliases(file, path, 'audit_log')]).toEqual(['AUDIT_LOG_COLLECTION']);
      }
    );
  });
});

describe('resolveObjectLiteral — the row a write call names, when it is not written inline (F2)', () => {
  const sf = (src: string) => parseSource('/x/probe.ts', src);
  const firstCallArg = (src: string, index = 1) => {
    const file = sf(src);
    let arg: ts.Node | null = null;
    const visit = (n: ts.Node): void => {
      if (arg === null && ts.isCallExpression(n) && n.arguments.length > index) arg = n.arguments[index];
      if (arg === null) n.forEachChild(visit);
    };
    file.forEachChild(visit);
    return { arg: arg as unknown as ts.Node, file };
  };
  const keys = (src: string, index = 1) => {
    const { arg, file } = firstCallArg(src, index);
    const literal = resolveObjectLiteral(arg, file);
    return literal === null
      ? null
      : literal.properties
          .map((p) => (p.name === undefined ? '...' : p.name.getText(file)))
          .sort();
  };

  it('an inline literal resolves to itself', () => {
    expect(keys("addDoc(ref, { date: d, period: p });")).toEqual(['date', 'period']);
  });

  it('!! A VARIABLE PAYLOAD RESOLVES TO THE LITERAL IT WAS BUILT FROM — auditLog.ts:45s shape', () => {
    expect(
      keys(
        [
          "const fullEntry = { ...entry, at: new Date().toISOString() };",
          'writer.set(doc(collection(db, AUDIT_LOG_COLLECTION), id), fullEntry);',
        ].join('\n')
      )
    ).toEqual(['...', 'at']);
  });

  it('resolves a `let` and a typed declaration too, and follows one alias hop', () => {
    expect(keys(['let row = { date: d };', 'addDoc(ref, row);'].join('\n'))).toEqual(['date']);
    expect(
      keys(['const row: Line = { date: d, ownerId: o };', 'addDoc(ref, row);'].join('\n'))
    ).toEqual(['date', 'ownerId']);
    expect(
      keys(['const base = { date: d };', 'const row = base;', 'addDoc(ref, row);'].join('\n'))
    ).toEqual(['date']);
  });

  it('returns null when the payload came from somewhere this file cannot see', () => {
    expect(keys(['const row = buildRow(item);', 'addDoc(ref, row);'].join('\n'))).toBeNull();
    expect(keys('addDoc(ref, item.patch);')).toBeNull();
    expect(keys('addDoc(ref, rowsFromElsewhere);')).toBeNull();
  });

  it('!! DOES NOT INVENT A LITERAL FROM A REASSIGNED BINDING', () => {
    // Two initializers for one name is not one row; guessing which is exactly the "silently
    // wrong" direction. Refusing turns into an INDIRECT classification upstream, which is a
    // declaration the guard then checks — not a pass.
    expect(
      keys(['let row = { date: d };', 'row = buildRow();', 'addDoc(ref, row);'].join('\n'))
    ).toBeNull();
  });
});
