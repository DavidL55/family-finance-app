// Stage 6 close — CONTAINMENT OF THE MODULE GRAPH IS NOT CONTAINMENT OF THE BUNDLE.
//
// THE FINDING. clientAiPlumbing.test.ts closes four routes an environment value can take into the
// shipped output — a `define:` block, a `%NAME%` placeholder in an HTML build input, an inline
// `<script type="module">`, and a module outside src/ reached through the `@` alias. Every one of
// those rules is a scan of SOURCE TEXT, and every one of them has now been bypassed by moving the
// source. VITE PLUGINS REACH THE BUNDLE WITHOUT BEING IN THE MODULE GRAPH AT ALL. Two shapes,
// both reproduced on this tree at 1314/1314 GREEN with `tsc --noEmit` clean and the live
// 39-character key sitting in dist/:
//
//   1. A SEVEN-LINE INLINE PLUGIN. `transformIndexHtml` + `loadEnv('production', process.cwd(),
//      'VITE_')`, injecting `window.__buildConfig = ${JSON.stringify(env)}`. NO KEY NAME IS TYPED
//      ANYWHERE — JSON.stringify dumps every VITE_ variable there is, so no name-based rule has a
//      name to match on. "Inject the build config into the page" is an ordinary thing an honest
//      author writes, which makes this MORE likely than the index.html route closed a round
//      earlier, not less. Measured: the key landed in dist/index.html.
//   2. THE SAME `define:` BLOCK, ONE FILE AWAY. A plugin returning `{ define: { … } }` from its
//      `config()` hook, in buildConfig/runtimeConfig.ts. The existing rule is
//      `expect(config).not.toMatch(/\bdefine\s*:/)` — textual, on vite.config.ts alone. Inline the
//      plugin and it correctly fails; relocate it and it does not. Measured: the key landed in
//      dist/assets/index-*.js.
//
// THE FIX IS NOT A FIFTH SOURCE-TEXT RULE. It is an assertion about the ARTIFACT: run the
// production build, then check that no environment VALUE appears anywhere in dist/. That is
// route-independent by construction. It does not care whether the value arrived through `define`,
// a plugin hook, HTML replacement, an inline module, a Rollup output plugin, or something nobody
// in this repo has thought of yet — it only cares that the bytes are in the thing we ship.
//
// WHAT MAY LEGITIMATELY APPEAR, AND WHY IT IS NOT A SECOND LIST. Seven values really are in
// dist/assets/*.js today and belong there: the six Firebase web-config values and the OAuth client
// id. They live in the same .env as the provider key, so "no .env value in dist/" flat would be
// false on a clean tree. The allowlist is therefore CLIENT_ENV_READS — the SAME pin the source
// guard uses, imported rather than restated. A value may sit in the bundle exactly when a pinned
// name put it there, and the two refusals already attached to that pin (no pinned name may carry a
// provider key name derived from the adapters; none may be secret-shaped) are what stop an author
// buying silence here by adding a line there. See helpers/clientEnvPin.ts.
//
// WHERE IT LIVES, AND WHAT IT COSTS. Its own vitest project (vitest.build.config.ts), run by
// `npm run test:build` and wired into `npm run test:all` — NOT into the default `npm test`. Three
// reasons, stated rather than assumed:
//
//   · it costs a production build, ~2.5s wall clock, on a default suite that runs in ~9.8s. That
//     is a 25% tax on the loop developers run most, for a property that cannot change between two
//     edits of a component;
//   · it is the only test in this repo with a SIDE EFFECT — it rewrites dist/. The default suite
//     is hermetic and should stay that way;
//   · and it depends on a working build toolchain and on files (.env*) that need not exist. A
//     failure of any of those should read as "the build guard could not run", not as a mysterious
//     unit-test failure.
//
// `npm run test:all` is the gate this stage commits against, so the guard is on the real gate.
//
// WHEN .env DOES NOT EXIST. The root .env is David's file; it is being renamed and rotated
// separately and this guard must stand whatever it ends up saying — including saying nothing,
// because the file is absent. So: nothing here names a variable, nothing assumes one exists, and
// the value corpus is whatever `.env*` happens to hold. If that corpus is EMPTY the leak assertion
// has nothing to say, and it SKIPS WITH A STATED REASON rather than passing green — a vacuous pass
// is the failure mode this stage has recorded twelve times. The two predicates below are exercised
// on synthetic inputs regardless, so the logic is proven with no .env on the machine at all.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLIENT_ENV_READS } from './helpers/clientEnvPin';
import { REPO_ROOT } from './helpers/extractionSurfaces';

/** One environment variable as an env FILE gives it: a name and the literal value Vite would use. */
interface EnvEntry {
  name: string;
  value: string;
}

/** One file of shipped output, read byte-for-byte. */
interface OutputFile {
  file: string;
  text: string;
}

/**
 * The shortest value this scan will look for in the build output.
 *
 * MEASURED, not guessed. `.env.local` holds `VITE_USE_EMULATOR=1`, and searching dist/ for "1"
 * matches EIGHT files including three JPEGs and the stylesheet. Short values are flags, ports,
 * modes and version strings; they collide with minified identifiers and with raw bytes inside
 * binary assets, and a guard that cries wolf about them is a guard somebody deletes.
 *
 * The floor is safe for what this exists to catch: every provider key in play is 39 characters or
 * more (Gemini 39, OpenAI ~51, Anthropic ~108), and the shortest genuine VALUE in the repo's own
 * env files is the 12-character Firebase messaging sender id. Nothing that could be a credential
 * is anywhere near this line.
 *
 * The cost is stated rather than hidden: a secret shorter than this is not searched for. That is
 * accepted, and it is why this guard is the SECOND layer — the name pin in clientAiPlumbing.test.ts
 * has no length floor at all.
 */
const MIN_SCANNABLE_VALUE_LENGTH = 12;

/**
 * Every variable an env file declares.
 *
 * A named predicate with synthetic tests, written before it had a body, for the reason this stage
 * has now recorded twelve times: on the real tree `.env` is eight plain `NAME=value` lines, so a
 * version of this that handled ONLY that shape — or returned [] — satisfies every assertion made
 * about the real tree, and the one shape it mishandles is the one an attacker picks.
 *
 * Known limit, stated because guessing it either way is how this gets re-litigated: a quoted value
 * spanning multiple lines yields its first line only. That searches for a PREFIX of the real value,
 * which is a broader search, not a narrower one — it fails closed.
 */
const parseEnvFile = (source: string): EnvEntry[] =>
  source.split(/\r?\n/).flatMap((line) => {
    const declaration = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (declaration === null) return [];
    const [, name, rest] = declaration;
    const quoted = /^(["'])([\s\S]*?)\1/.exec(rest.trimEnd());
    if (quoted !== null) return [{ name, value: quoted[2] }];
    // Unquoted: dotenv ends the value at a WHITESPACE-preceded `#`, so `v#x` is a value and
    // `v # x` is a value plus a comment. Getting this wrong lengthens the search string and the
    // leak goes unreported, which is the fail-OPEN direction.
    return [{ name, value: rest.replace(/\s+#.*$/, '').trim() }];
  });

/**
 * Which environment values reach the build output, and where.
 *
 * `allowed` is a set of variable NAMES — CLIENT_ENV_READS. The comparison is by VALUE, not by
 * name, so two variables sharing one value do not produce a phantom violation: if the Firebase
 * project id and some new unpinned variable both hold "family-finance-prod", the bytes in dist/
 * were put there by the pinned one and there is nothing to report.
 *
 * Returns "NAME appears in FILE" strings. It never returns the value — a guard that prints the
 * secret it found is a guard that puts the secret in CI logs.
 */
const envValuesInOutput = (
  entries: readonly EnvEntry[],
  allowed: ReadonlySet<string>,
  output: readonly OutputFile[]
): string[] => {
  // By VALUE, and ONLY by value. Filtering on the NAME as well would be dead weight — a pinned
  // name's value is in this set by construction — and the mutation sweep proved it: neutering the
  // name clause left all 31 green. One condition that is exercised beats two where one is not.
  const allowedValues = new Set(entries.filter((e) => allowed.has(e.name)).map((e) => e.value));
  return entries
    .filter((e) => e.value.length >= MIN_SCANNABLE_VALUE_LENGTH && !allowedValues.has(e.value))
    .flatMap((e) => output.filter((o) => o.text.includes(e.value)).map((o) => `${e.name} appears in ${o.file}`))
    .sort();
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE PREDICATES, ON SHAPES THEY CAN FAIL AGAINST.
//
// Everything in this section runs on synthetic inputs and needs no .env, no build and no dist/.
// It is the half of this file that is proven on a machine where the real corpus is empty — and
// it was written stub-first, `return []`, and watched to fail, before any of it had a body.
//
// THE MUTATION SWEEP, INCLUDING WHAT SURVIVED. Twenty-eight mutations were run; the five that
// survived a first pass are recorded here because three of them were real defects in this file
// and the stage's rule is that a survivor gets written down, not quietly patched:
//
//   · `!allowed.has(e.name)` in envValuesInOutput — NEUTERING IT CHANGED NOTHING (31/31 green).
//     It was genuinely dead: a pinned name's value is in allowedValues by construction. Deleted
//     rather than given a test, because a condition that cannot fail is not a safeguard.
//   · READING dist/ AS utf8 WHILE READING .env AS utf8 TOO — still green, and it stays green: the
//     two sides move together and nothing here can tell the difference. Recorded as an equivalent
//     mutant with the argument for latin1 stated at readBytes, not dressed up in a contrived test.
//   · READING THE TWO SIDES DIFFERENTLY — green, and a REAL FAIL-OPEN THIS FILE SHIPPED FIRST: a
//     value with one non-ASCII byte decoded to two different strings and could never match. Fixed
//     structurally (one readBytes, one declaredEnv) and now caught.
//   · `envFilePaths -> []` — green, WITH THE LEAK TEST SKIPPED. The skip is right when .env is
//     absent and a silent licence when it is present. Now told apart by an on-disk recount.
//   · `declaredEnv -> paths.slice(0, 1)` — green, because .env.local's only variable is under the
//     length floor. Now covered synthetically.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('parseEnvFile, on the shapes an env file actually takes', () => {
  it('the plain line, which is what .env is made of today', () => {
    expect(parseEnvFile('VITE_FIREBASE_PROJECT_ID=family-finance-prod')).toEqual([
      { name: 'VITE_FIREBASE_PROJECT_ID', value: 'family-finance-prod' },
    ]);
  });

  it('a DOUBLE-QUOTED value, which is what .env.example is made of', () => {
    expect(parseEnvFile('GEMINI_API_KEY="AIzaSyExampleValue0123456789"')).toEqual([
      { name: 'GEMINI_API_KEY', value: 'AIzaSyExampleValue0123456789' },
    ]);
  });

  it('a single-quoted value too', () => {
    expect(parseEnvFile("VITE_A='quoted-value-here'")).toEqual([{ name: 'VITE_A', value: 'quoted-value-here' }]);
  });

  it('every line, not the first', () => {
    expect(parseEnvFile('VITE_A=one\nVITE_B=two\nVITE_C=three').map((e) => e.name))
      .toEqual(['VITE_A', 'VITE_B', 'VITE_C']);
  });

  it('comments and blank lines declare nothing', () => {
    expect(parseEnvFile('# VITE_COMMENTED=secretvalue\n\n   \nVITE_REAL=v')).toEqual([
      { name: 'VITE_REAL', value: 'v' },
    ]);
  });

  it('an `export ` prefix is still a declaration — some people write env files that way', () => {
    expect(parseEnvFile('export VITE_A=exported-value')).toEqual([{ name: 'VITE_A', value: 'exported-value' }]);
  });

  it('a TRAILING COMMENT is not part of the value, which is the fail-OPEN case', () => {
    // Keeping " # rotate me" attached would search dist/ for a longer string than the one that is
    // actually in it, and the leak would go unreported. This is the mistake that matters here.
    expect(parseEnvFile('VITE_A=the-real-value # rotate me quarterly')).toEqual([
      { name: 'VITE_A', value: 'the-real-value' },
    ]);
  });

  it('…but a `#` INSIDE a quoted value is part of the value', () => {
    expect(parseEnvFile('VITE_A="value#with#hashes"')).toEqual([{ name: 'VITE_A', value: 'value#with#hashes' }]);
  });

  it('…and a `#` with no space before it is part of an unquoted value, as dotenv reads it', () => {
    expect(parseEnvFile('VITE_A=value#notacomment')).toEqual([{ name: 'VITE_A', value: 'value#notacomment' }]);
  });

  it('a value containing `=` survives — base64 padding is the obvious case', () => {
    expect(parseEnvFile('VITE_A=c2VjcmV0dmFsdWU=')).toEqual([{ name: 'VITE_A', value: 'c2VjcmV0dmFsdWU=' }]);
  });

  it('surrounding whitespace is not part of the name or the value', () => {
    expect(parseEnvFile('  VITE_A =  spaced-value  ')).toEqual([{ name: 'VITE_A', value: 'spaced-value' }]);
  });

  it('an empty value is declared, not dropped — the length floor is what excuses it, not a silence here', () => {
    expect(parseEnvFile('VITE_EMPTY=')).toEqual([{ name: 'VITE_EMPTY', value: '' }]);
  });

  it('a line that is not a declaration at all contributes nothing', () => {
    expect(parseEnvFile('this is prose\n[section]\n---')).toEqual([]);
  });

  it('CRLF line endings do not end up inside the value', () => {
    // A trailing \r would be searched for as part of the value and never found in the bundle.
    expect(parseEnvFile('VITE_A=windows-value\r\nVITE_B=second\r\n')).toEqual([
      { name: 'VITE_A', value: 'windows-value' },
      { name: 'VITE_B', value: 'second' },
    ]);
  });
});

describe('envValuesInOutput, on the leaks it exists to catch', () => {
  const PINNED = new Set(['VITE_FIREBASE_API_KEY', 'VITE_USE_EMULATOR']);
  const KEY = 'AIzaSyLiveProviderKeyValue0123456789xyz';
  const FIREBASE = 'AIzaSyFirebaseWebKeyValue0123456789abc';

  it('SHAPE 1 EXACTLY: the plugin dumped every VITE_ variable into dist/index.html', () => {
    expect(
      envValuesInOutput(
        [{ name: 'VITE_GEMINI_API_KEY', value: KEY }, { name: 'VITE_FIREBASE_API_KEY', value: FIREBASE }],
        PINNED,
        [{ file: 'dist/index.html', text: `<script>window.__buildConfig={"VITE_GEMINI_API_KEY":"${KEY}"}</script>` }]
      )
    ).toEqual(['VITE_GEMINI_API_KEY appears in dist/index.html']);
  });

  it('SHAPE 2 EXACTLY: the relocated `define:` inlined it into the JS chunk', () => {
    expect(
      envValuesInOutput(
        [{ name: 'VITE_GEMINI_API_KEY', value: KEY }],
        PINNED,
        [{ file: 'dist/assets/index-BDxLccue.js', text: `const c={VITE_GEMINI_API_KEY:"${KEY}"};` }]
      )
    ).toEqual(['VITE_GEMINI_API_KEY appears in dist/assets/index-BDxLccue.js']);
  });

  it('the value is reported by NAME and FILE and never printed — this is a secret', () => {
    const offenders = envValuesInOutput(
      [{ name: 'VITE_GEMINI_API_KEY', value: KEY }],
      PINNED,
      [{ file: 'dist/index.html', text: KEY }]
    );
    expect(offenders.some((o) => o.includes(KEY))).toBe(false);
  });

  it('THE PRECISION CASE: a pinned value in the bundle is not a violation — it is the app working', () => {
    // The six Firebase values and the OAuth client id are in dist/assets/*.js today, deliberately.
    // Without this the guard fails on a clean tree and gets deleted in a week.
    expect(
      envValuesInOutput(
        [{ name: 'VITE_FIREBASE_API_KEY', value: FIREBASE }],
        PINNED,
        [{ file: 'dist/assets/index.js', text: `apiKey:"${FIREBASE}"` }]
      )
    ).toEqual([]);
  });

  it('an unpinned value that is NOT in the output is not a violation either', () => {
    expect(
      envValuesInOutput([{ name: 'VITE_GEMINI_API_KEY', value: KEY }], PINNED, [
        { file: 'dist/assets/index.js', text: 'the bundle, with no key in it' },
      ])
    ).toEqual([]);
  });

  it('EVERY file carrying it is reported, and the list is sorted', () => {
    expect(
      envValuesInOutput([{ name: 'VITE_GEMINI_API_KEY', value: KEY }], PINNED, [
        { file: 'dist/index.html', text: KEY },
        { file: 'dist/assets/index.js', text: KEY },
      ])
    ).toEqual([
      'VITE_GEMINI_API_KEY appears in dist/assets/index.js',
      'VITE_GEMINI_API_KEY appears in dist/index.html',
    ]);
  });

  it('EVERY offending variable is reported, not the first', () => {
    expect(
      envValuesInOutput(
        [{ name: 'VITE_B_SECRET_VALUE', value: 'bbbbbbbbbbbbbbbbbbbb' }, { name: 'VITE_A_OTHER_VALUE', value: 'aaaaaaaaaaaaaaaaaaaa' }],
        PINNED,
        [{ file: 'dist/assets/index.js', text: 'aaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbb' }]
      )
    ).toEqual([
      'VITE_A_OTHER_VALUE appears in dist/assets/index.js',
      'VITE_B_SECRET_VALUE appears in dist/assets/index.js',
    ]);
  });

  it('A SHARED VALUE IS NOT A PHANTOM: an unpinned name holding a PINNED value is not reported', () => {
    // Two variables, one value. The bytes in dist/ were put there by the pinned one; blaming the
    // other is a false positive, and false positives are how a guard earns an exemption list.
    expect(
      envValuesInOutput(
        [{ name: 'VITE_FIREBASE_API_KEY', value: FIREBASE }, { name: 'VITE_MIRROR_OF_IT', value: FIREBASE }],
        PINNED,
        [{ file: 'dist/assets/index.js', text: FIREBASE }]
      )
    ).toEqual([]);
  });

  it('A VALUE SHORTER THAN THE FLOOR IS NOT SEARCHED FOR — the measured false-positive case', () => {
    // VITE_USE_EMULATOR="1" matches eight files in a real dist/, three of them JPEGs. An unpinned
    // one-character value would do the same and say nothing true.
    expect(
      envValuesInOutput([{ name: 'VITE_UNPINNED_FLAG', value: '1' }], PINNED, [
        { file: 'dist/icons/icon-512x512.png', text: 'binary bytes with a 1 in them' },
      ])
    ).toEqual([]);
  });

  it('…and the floor is a FLOOR, not a licence: one character longer and it is searched for', () => {
    const atFloor = 'x'.repeat(MIN_SCANNABLE_VALUE_LENGTH);
    const belowFloor = 'y'.repeat(MIN_SCANNABLE_VALUE_LENGTH - 1);
    expect(
      envValuesInOutput(
        [{ name: 'VITE_AT_FLOOR', value: atFloor }, { name: 'VITE_BELOW_FLOOR', value: belowFloor }],
        PINNED,
        [{ file: 'dist/assets/index.js', text: `${atFloor} ${belowFloor}` }]
      )
    ).toEqual(['VITE_AT_FLOOR appears in dist/assets/index.js']);
  });

  it('an EMPTY value is never a violation — otherwise every file "contains" it', () => {
    expect(
      envValuesInOutput([{ name: 'VITE_EMPTY', value: '' }], PINNED, [
        { file: 'dist/assets/index.js', text: 'anything at all' },
      ])
    ).toEqual([]);
  });

  it('a SUBSTRING match counts — the value does not have to be delimited to have leaked', () => {
    // Minified output has no whitespace and no quotes to anchor on. A rule that demanded word
    // boundaries would miss `{k:"…KEY…"}` concatenated into a template.
    expect(
      envValuesInOutput([{ name: 'VITE_LEAKED', value: 'abcdefghijklmnop' }], PINNED, [
        { file: 'dist/assets/index.js', text: 'zzzabcdefghijklmnopzzz' },
      ])
    ).toEqual(['VITE_LEAKED appears in dist/assets/index.js']);
  });

  it('an empty output corpus reports nothing — which is why the corpus is checked separately', () => {
    expect(envValuesInOutput([{ name: 'VITE_GEMINI_API_KEY', value: KEY }], PINNED, [])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE REAL BUILD.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Env files Vite would load, wherever a future author adds one. */
const envFilePaths = (): string[] =>
  readdirSync(REPO_ROOT)
    .filter((name) => /^\.env(\..+)?$/.test(name) && !name.endsWith('.example'))
    // .env.example is EXCLUDED and this is the whole reason: it is committed placeholder text
    // ("MY_GEMINI_API_KEY"), it is not loaded by Vite, and it therefore declares no value that
    // could reach dist/. Every other .env* is in scope whatever it is called.
    .map((name) => resolve(REPO_ROOT, name))
    .filter((full) => statSync(full).isFile())
    .sort();

/**
 * Every byte of a file, as a string in which one character IS one byte.
 *
 * ONE READER FOR BOTH SIDES OF THE COMPARISON, and that is the whole point of it having a name.
 * This search is a BYTE search: does the byte sequence of a declared value occur in the byte
 * sequence of a shipped file. Encode the two sides differently and the search silently stops
 * working on anything outside ASCII — measured, and it is a mistake this file made first:
 *
 *   value read as utf8 ("café…"), dist read as latin1 ("cafÃ©…")  ->  NOT FOUND
 *   both read as latin1                                            ->  found
 *
 * A guard that cannot find a non-ASCII secret is a guard with a documented way past it. latin1 for
 * both is the fix: it is a total, byte-for-byte mapping, so nothing is lost on the way in from
 * either side, and the binary assets under dist/icons/ come through as bytes rather than as
 * replacement characters.
 *
 * TWO CLAIMS THIS DOES NOT MAKE, because the sweep forced them to be checked rather than asserted:
 *
 *   · Reading dist/ as utf8 would not by itself LOSE an ASCII match. Node's decoder replaces an
 *     invalid sequence and then re-processes the next byte, so ASCII sitting beside binary junk
 *     survives either way. The encoding matters for the PAIRING, not for the junk.
 *   · And moving BOTH sides to utf8 together is not observably different on any corpus this repo
 *     has — the mutation survives, and it is recorded as surviving rather than dressed up in a
 *     contrived test. latin1 is chosen because it is TOTAL: every byte sequence has exactly one
 *     representation and none is lost, which is a property utf8 does not have. That is an argument
 *     for the safer default, not a defect anything here demonstrates.
 *
 * What IS demonstrated, and what the sweep caught: the two sides moving SEPARATELY. Hence one
 * function, used by both readers below, and a pairing that no call site can get wrong.
 */
const readBytes = (full: string): string => readFileSync(full, 'latin1');

/** Every file in the build output, read byte-for-byte. */
const outputFiles = (dir: string, root: string): OutputFile[] => {
  let out: OutputFile[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(outputFiles(full, root));
    else out.push({ file: relative(root, full).replace(/\\/g, '/'), text: readBytes(full) });
  }
  return out;
};

describe('outputFiles, on the bytes dist/ actually contains', () => {
  /** A throwaway tree, so this can assert about BINARY content without shipping a binary fixture. */
  const withTree = (files: Record<string, Buffer | string>, run: (dir: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-dist-'));
    try {
      for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('an ASCII value inside a BINARY file is found — dist/icons/* are JPEGs and are not skipped', () => {
    const marker = 'AIzaSyMarkerValue0123456789';
    withTree(
      {
        'icon.png': Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x80]),
          Buffer.from(marker, 'latin1'),
          Buffer.from([0xc3, 0x28, 0x00]),
        ]),
      },
      (dir) => {
        const [file] = outputFiles(dir, dir);
        expect(file.file).toBe('icon.png');
        expect(file.text.includes(marker)).toBe(true);
      }
    );
  });

  it('EVERY env file contributes, not the first — .env.local is a second file, and Vite loads it', () => {
    // The real tree cannot show this: .env.local holds only VITE_USE_EMULATOR=1, which is under
    // the length floor, so dropping the file changes nothing anybody could see. Neutering
    // declaredEnv to `paths.slice(0, 1)` left all 36 green until this existed.
    const dir = mkdtempSync(join(tmpdir(), 'ff-multi-'));
    try {
      writeFileSync(join(dir, 'a'), 'VITE_FROM_FIRST=aaaaaaaaaaaaaaaa\n');
      writeFileSync(join(dir, 'b'), 'VITE_FROM_SECOND=bbbbbbbbbbbbbbbb\n');
      expect(declaredEnv([join(dir, 'a'), join(dir, 'b')]).map((e) => e.name))
        .toEqual(['VITE_FROM_FIRST', 'VITE_FROM_SECOND']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('A NON-ASCII VALUE IS STILL FOUND — the two sides must be read the SAME way, and are', () => {
    // THE MUTATION-FOUND DEFECT, kept as the test that would have caught it. The env file was read
    // as utf8 and dist/ as latin1, so a value with one accented character decoded to two different
    // strings and `includes` could never match: a secret containing any non-ASCII byte was
    // invisible to this guard. Both sides go through readBytes now. Flipping either one back to
    // utf8 fails HERE, which is what nothing did before.
    const value = 'café-secret-value-0123456789';
    const dir = mkdtempSync(join(tmpdir(), 'ff-pair-'));
    try {
      writeFileSync(join(dir, 'env'), Buffer.from(`VITE_LEAKED=${value}\n`, 'utf8'));
      writeFileSync(join(dir, 'index.js'), Buffer.from(`const c={k:"${value}"};`, 'utf8'));
      const entries = declaredEnv([join(dir, 'env')]);
      const output = outputFiles(dir, dir).filter((f) => f.file === 'index.js');
      expect(entries.map((e) => e.name)).toEqual(['VITE_LEAKED']);
      expect(envValuesInOutput(entries, new Set<string>(), output))
        .toEqual(['VITE_LEAKED appears in index.js']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('every file is returned, with a path relative to the output root', () => {
    withTree({ 'a.js': 'aaa', 'b.css': 'bbb' }, (dir) => {
      expect(outputFiles(dir, dir).map((f) => f.file).sort()).toEqual(['a.js', 'b.css']);
    });
  });

  it('and it recurses — dist/assets/ is where the chunk actually is', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-dist-'));
    try {
      const nested = join(dir, 'assets');
      execFileSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(nested)})`]);
      writeFileSync(join(nested, 'index.js'), 'chunk');
      expect(outputFiles(dir, dir).map((f) => f.file)).toEqual(['assets/index.js']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Every variable declared by the given env files — the value corpus, read the SAME way the output
 * corpus is.
 *
 * A named function and not an inline flatMap in beforeAll, because the encoding pairing is the
 * thing that has to be exercised: with the read inlined, a test could only reach parseEnvFile with
 * a string it had decoded itself, and the mutation that broke the pairing at the real call site
 * survived untouched.
 */
const declaredEnv = (paths: readonly string[]): EnvEntry[] =>
  paths.flatMap((full) => parseEnvFile(readBytes(full)));

describe('no environment value reaches the build output (Stage 6 close)', () => {
  const DIST = resolve(REPO_ROOT, 'dist');
  const PINNED_NAMES = new Set(CLIENT_ENV_READS.map((e) => e.name));

  let built: OutputFile[] = [];
  let declared: EnvEntry[] = [];

  beforeAll(() => {
    // The LOCAL vite binary, run through this node — not `npx`, which may go to the network.
    const vite = resolve(REPO_ROOT, 'node_modules/vite/bin/vite.js');
    expect(existsSync(vite), 'vite is not installed — the build guard cannot run').toBe(true);
    execFileSync(process.execPath, [vite, 'build'], { cwd: REPO_ROOT, stdio: 'pipe', encoding: 'utf8' });
    built = outputFiles(DIST, REPO_ROOT);
    declared = declaredEnv(envFilePaths());
  });

  it('the build really produced the output this scans — an HTML entry and a JS chunk', () => {
    // Non-vacuity of the OUTPUT corpus, which needs no .env and therefore always runs. Without it
    // a build that silently emitted nothing would make every rule below pass over an empty list.
    const names = built.map((f) => f.file);
    expect(names, 'the production build emitted no index.html').toContain('dist/index.html');
    expect(names.filter((f) => f.endsWith('.js')).length, 'the build emitted no JS').toBeGreaterThan(0);
  });

  it('NO ENV VALUE APPEARS IN dist/ EXCEPT ONE A PINNED NAME PUT THERE', (ctx) => {
    const scannable = declared.filter((e) => e.value.length >= MIN_SCANNABLE_VALUE_LENGTH);
    ctx.skip(
      scannable.length === 0,
      `no env file at the repo root declares a value of ${MIN_SCANNABLE_VALUE_LENGTH}+ characters, ` +
        'so there is nothing to look for in dist/. This guard is deliberately blind to what .env ' +
        'happens to contain; the predicates above are proven on synthetic input instead. SKIPPED, ' +
        'not passed — a vacuous green is the failure this file exists to stop repeating.'
    );
    expect(
      envValuesInOutput(declared, PINNED_NAMES, built),
      'an environment VALUE is in the shipped build output and no pinned variable put it there. ' +
        'This is route-independent on purpose: it does not matter whether it arrived through ' +
        '`define`, a plugin hook, HTML replacement or an inline module — the bytes are in dist/. ' +
        'If the variable is genuinely public, add it to CLIENT_ENV_READS in ' +
        'src/__tests__/helpers/clientEnvPin.ts with the reason. If it is a secret, it belongs in ' +
        'functions/ and the build step that put it here has to go.'
    ).toEqual([]);
  });

  it('the value scan really reaches into dist/ — a pinned value IS found there', (ctx) => {
    // Stated-then-verified, the same way the adapter derivation is. This is the end-to-end proof
    // that parse -> build -> read -> match works on the REAL artifact: if it found nothing at all,
    // the rule above would be searching correctly-formed haystacks for nothing.
    const pinnedScannable = declared.filter(
      (e) => PINNED_NAMES.has(e.name) && e.value.length >= MIN_SCANNABLE_VALUE_LENGTH
    );
    ctx.skip(
      pinnedScannable.length === 0,
      'no pinned variable has a value long enough to search for, so there is no positive control ' +
        'available on this machine. SKIPPED rather than passed.'
    );
    const found = pinnedScannable.filter((e) => built.some((f) => f.text.includes(e.value)));
    expect(
      found.map((e) => e.name).length,
      'not one pinned environment value could be found anywhere in dist/, though the app cannot ' +
        'reach Firebase without them. The scan is looking in the wrong place or parsing the wrong ' +
        'thing, and every clean result it reports is worthless.'
    ).toBeGreaterThan(0);
  });

  it('the env-file corpus is the one Vite loads, and .env.example is not in it', () => {
    const names = envFilePaths().map((f) => relative(REPO_ROOT, f));
    expect(names).not.toContain('.env.example');
    for (const name of names) expect(name.startsWith('.env')).toBe(true);
  });

  it('A .env* ON DISK IS A .env* IN THE SCAN — the skip must mean absent, never overlooked', (ctx) => {
    // THE SHADOWING CHECK, and it is not hypothetical: neutering envFilePaths to `[]` left the
    // leak assertion SKIPPED and the run GREEN. "Skip when there is nothing to scan" is the right
    // behaviour when .env genuinely does not exist and a silent licence to find nothing when it
    // does. The two cases have to be told apart, so the on-disk list is recomputed here by a
    // dumber rule than the one under test — a prefix, not the same regex.
    const onDisk = readdirSync(REPO_ROOT)
      .filter((name) => name.startsWith('.env') && !name.endsWith('.example'))
      .sort();
    ctx.skip(
      onDisk.length === 0,
      'there is no .env* at the repo root at all, so there is genuinely nothing for the value ' +
        'scan to look for. SKIPPED, and the predicates above carry the proof instead.'
    );
    expect(
      envFilePaths().map((f) => relative(REPO_ROOT, f)).sort(),
      'an env file is on disk and the scan did not pick it up — every clean result it reports ' +
        'about dist/ is about a corpus that is missing values Vite would have loaded.'
    ).toEqual(onDisk);
    expect(
      declared.length,
      `${onDisk.join(', ')} exists but parsed into no declarations at all — the parser is the ` +
        'thing that is broken, and the leak rule above is searching dist/ for nothing.'
    ).toBeGreaterThan(0);
  });
});
