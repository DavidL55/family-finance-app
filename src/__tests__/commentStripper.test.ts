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
import { describe, expect, it } from 'vitest';
import { EXTRACTION_ACTION, jsxOpeningTags, stringLiterals, stripComments } from './helpers/extractionSurfaces';

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
