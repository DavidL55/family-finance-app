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
import * as ts from 'typescript';
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CLOSE VERIFICATION F3 — THE ROUTE NOTHING IN THIS FILE COVERED, AND THE ONE THAT NEEDS NO
// CONFIG CHANGE AT ALL.
//
// Everything above closes the routes a REINTRODUCED CLIENT-SIDE CALL would need: the vendor SDK,
// and the `define:` block that used to inline the key. Both require editing a config file. The
// route that requires editing NOTHING was never checked: the repo-root .env holds the live Gemini
// key under a `VITE_` prefix, and the `VITE_` prefix is precisely Vite's contract for "inline this
// into the client bundle". `import.meta.env.VITE_GEMINI_API_KEY` in any file under src/ is the
// whole exploit — no define:, no SDK, no dependency.
//
// PROVEN ON THIS TREE before this guard existed: two lines at the top of src/App.tsx,
// `npx vite build`, and the 41-character live key was sitting in dist/assets/index-*.js. All 1215
// tests green. vite.config.ts's own comment asserted the key "is now read only by functions/ and
// by scripts, never by the client build" — a property nothing checked, and one that was false the
// moment anybody wrote that line. (The comment is corrected in the same commit as this guard.)
//
// THE GUARD MUST NOT DEPEND ON WHAT THE .env HAPPENS TO CONTAIN. The root .env is David's file and
// holds his live secret; it is being renamed and rotated separately, and this guard has to stand
// whatever it ends up saying. So nothing below reads .env. Two properties instead:
//
//   1. THE PIN. The set of environment-variable names read anywhere under src/ is EXACT. Any new
//      one — whatever it is called — fails until somebody puts it in the list and says why. This
//      is the layer that does not care what the variable is named.
//   2. THE DERIVED PROVIDER-KEY RULE, which a pin edit CANNOT wave through. The AI provider key
//      names are read out of functions/src/providers/*Adapter.ts — the code that actually consumes
//      them — and no name src/ reads may BE or END WITH one of them. `VITE_GEMINI_API_KEY` ends
//      with `GEMINI_API_KEY` and is refused even if a future author adds it to the pin. A fourth
//      provider added to functions/ is covered on the day its adapter is written, with no edit
//      here — the same "derive it from the tree rather than restate it" move the egress maps use.
//
// Deliberately NOT a text scan: this file names `VITE_GEMINI_API_KEY` as data in its own tests,
// and a substring guard would report itself. The reads are taken off the AST, so a name in a
// string or a comment is not a read.
//
// WHAT THIS DOES NOT CLOSE, measured rather than guessed. Six attack shapes were replanted against
// the finished guard and all six fail it: the reproduced leak verbatim, renamed destructuring,
// bracket access, taking the whole env object and indexing it later, the same key under a NEW NAME,
// and a secret-shaped new name. Adding the key to the pin fails too, on the derived rule. The one
// shape that survives is a provider key renamed to something that names neither a provider nor a
// secret — `VITE_LLM_THING` — AND deliberately added to CLIENT_ENV_READS with a written reason
// that is false. That is not a hole a predicate can close: it is an author asserting in prose that
// a secret is public. It is held the same way the egress copy is — the pin edit is visible in the
// diff and gets human eyes.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** One environment-variable read: `import.meta.env.X`, `process.env.X`, or a destructuring of either. */
interface EnvRead {
  /** The variable name, or WHOLE_OBJECT when the code took the env object itself. */
  name: string;
  /** `import.meta.env` or `process.env` — which door it went through. */
  via: string;
}

/**
 * The sentinel for `const e = import.meta.env` — a read this scan cannot attribute to a name.
 * Recorded rather than ignored, because ignoring it is the one edit that defeats the pin: taking
 * the whole object and indexing it later reads every VITE_ variable there is.
 */
const WHOLE_ENV_OBJECT = '*the whole env object*';

/** Every environment-variable read in `source`, read off the AST. */
function envReadsIn(source: string, fileName: string): EnvRead[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const reads: EnvRead[] = [];

  /** Which env object `node` IS, if it is one. `config.env` is not one; `import.meta.url` is not one. */
  const envDoor = (node: ts.Node): string | null => {
    if (!ts.isPropertyAccessExpression(node) || node.name.text !== 'env') return null;
    const target = node.expression;
    if (ts.isMetaProperty(target) && target.keywordToken === ts.SyntaxKind.ImportKeyword) {
      return 'import.meta.env';
    }
    if (ts.isIdentifier(target) && target.text === 'process') return 'process.env';
    return null;
  };

  const visit = (node: ts.Node): void => {
    const via = envDoor(node);
    if (via === null) {
      node.forEachChild(visit);
      return;
    }
    // The env object itself. What happens to it IMMEDIATELY is what decides which name was read;
    // anything this scan cannot name is recorded as the whole object rather than dropped.
    const parent = node.parent;
    if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      reads.push({ name: parent.name.text, via });
    } else if (parent && ts.isElementAccessExpression(parent) && parent.expression === node) {
      const argument = parent.argumentExpression;
      reads.push(
        ts.isStringLiteralLike(argument)
          ? { name: argument.text, via }
          : { name: WHOLE_ENV_OBJECT, via } // a computed key reads whichever variable it evaluates to
      );
    } else if (
      parent && ts.isVariableDeclaration(parent) && parent.initializer === node &&
      ts.isObjectBindingPattern(parent.name)
    ) {
      for (const element of parent.name.elements) {
        if (element.dotDotDotToken) {
          reads.push({ name: WHOLE_ENV_OBJECT, via }); // `...rest` is every remaining variable
          continue;
        }
        const property = element.propertyName ?? element.name;
        reads.push(
          ts.isIdentifier(property) || ts.isStringLiteralLike(property)
            ? { name: property.text, via }
            : { name: WHOLE_ENV_OBJECT, via }
        );
      }
    } else {
      // Passed to a function, spread, parenthesised, returned — the object escapes with every
      // variable in it.
      reads.push({ name: WHOLE_ENV_OBJECT, via });
    }
  };
  sourceFile.forEachChild(visit);
  return reads;
}

/** Every `process.env.X` name the given files read — the provider key names, from the code that uses them. */
function serverKeyNames(files: string[]): string[] {
  const found = new Set<string>();
  for (const full of files) {
    for (const read of envReadsIn(readFileSync(full, 'utf8'), full)) {
      if (read.via === 'process.env') found.add(read.name);
    }
  }
  return [...found].sort();
}

/**
 * Every environment variable src/ is allowed to read, and why it is safe in a public bundle.
 *
 * Adding a line here is a deliberate act with a reviewer attached — which is the point. It is also
 * NOT sufficient on its own: a name matching a provider key or a secret shape is refused whatever
 * this list says (see the two tests below).
 */
const CLIENT_ENV_READS: ReadonlyArray<{ name: string; whyPublic: string }> = [
  { name: 'DEV', whyPublic: "Vite's own build-mode flag — a boolean, not a value of ours." },
  { name: 'NODE_ENV', whyPublic: "the build mode again, via process.env in a dev-only console warning." },
  { name: 'VITE_USE_EMULATOR', whyPublic: 'a local-development switch — "1" or absent.' },
  {
    name: 'VITE_FIREBASE_API_KEY',
    whyPublic:
      'the Firebase WEB API key, which is a public client identifier by design — it identifies ' +
      'the project to Google and authorises nothing on its own. Firestore Rules and App Check are ' +
      'the access boundary, and both assume every client holds this value. It is NOT a provider ' +
      'secret, which is why the provider-key rule below is derived from the adapters rather than ' +
      'written as "anything called API_KEY".',
  },
  { name: 'VITE_FIREBASE_AUTH_DOMAIN', whyPublic: 'public Firebase project config.' },
  { name: 'VITE_FIREBASE_PROJECT_ID', whyPublic: 'public Firebase project config.' },
  { name: 'VITE_FIREBASE_STORAGE_BUCKET', whyPublic: 'public Firebase project config.' },
  { name: 'VITE_FIREBASE_MESSAGING_SENDER_ID', whyPublic: 'public Firebase project config.' },
  { name: 'VITE_FIREBASE_APP_ID', whyPublic: 'public Firebase project config.' },
  {
    name: 'VITE_GOOGLE_CLIENT_ID',
    whyPublic:
      'the OAuth CLIENT id — public by construction; it is half of a pair and the secret half ' +
      'never leaves the server.',
  },
];

/**
 * Name shapes that can never be pinned, whatever provider they belong to. Matched on whole
 * underscore-delimited words, so VITE_TOKENIZER_MODE is not a token and VITE_ACCESS_TOKEN_V2 is.
 *
 * Deliberately does NOT include API_KEY: the Firebase WEB key legitimately carries that suffix and
 * is public by design, and an exemption list beside a blocklist is the arms race this stage keeps
 * refusing. Provider keys are caught by DERIVATION from the adapters instead — see below.
 */
const SECRET_SHAPED = /(^|_)(SECRET|TOKEN|PASSWORD|CREDENTIALS?|PRIVATE_KEY|BEARER)(_|$)/i;

/**
 * Which of `names` carries one of the server's provider key names.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * A NAMED FUNCTION, AND IT IS THE TENTH SHADOWING INSTANCE IN THIS STAGE — CAUGHT BY MUTATION IN
 * MY OWN NEW GUARD, BEFORE THE FIRST COMMIT THIS TIME.
 *
 * Both of the rules below run over CLIENT_ENV_READS, which is clean today. So the comparison inside
 * them never executed: neutering either one — `.filter(() => false)` — left ALL 21 TESTS GREEN. The
 * same defect the ledger records nine times, reproduced inside the fix for the ninth. Both
 * predicates are extracted and exercised on synthetic name lists, exactly as unpinnedPhraseSharing,
 * borrowedPhrases and keysNaming are.
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 */
const providerKeysAmong = (names: readonly string[], keys: readonly string[]): string[] =>
  names.filter((name) => keys.some((key) => name.includes(key))).sort();

/** Which of `names` is secret-shaped, whatever it belongs to. */
const secretShapedAmong = (names: readonly string[]): string[] =>
  names.filter((name) => SECRET_SHAPED.test(name)).sort();

describe('the env-var route into the browser bundle is closed (close verification F3)', () => {
  const PROVIDER_ADAPTERS = ['anthropicAdapter.ts', 'googleAdapter.ts', 'openaiAdapter.ts']
    .map((f) => resolve(REPO_ROOT, 'functions/src/providers', f));

  const providerKeyNames = (): string[] => serverKeyNames(PROVIDER_ADAPTERS);

  const srcEnvReads = (): Array<EnvRead & { file: string }> =>
    allFiles(resolve(REPO_ROOT, 'src')).flatMap((full) =>
      envReadsIn(readFileSync(full, 'utf8'), full)
        .map((read) => ({ ...read, file: relative(REPO_ROOT, full).replace(/\\/g, '/') }))
    );

  it('the provider key names are DERIVED from the adapters, and the derivation is not vacuous', () => {
    // Stated-then-verified, the same way EXTRACTION_ROOTS is: if the adapters stop reading their
    // keys off process.env, this rule would be checking src/ against an empty list and every
    // assertion built on it would pass vacuously.
    const names = providerKeyNames();
    expect(names, 'no adapter reads a key off process.env — the provider-key rule is seeded on nothing')
      .toEqual(['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY']);
  });

  it('src/ reads EXACTLY the pinned environment variables and no others', () => {
    // The layer that does not care what the variable is called. Renaming the Gemini key to
    // VITE_LLM_THING and reading it here still fails: the name is not on this list.
    const read = [...new Set(srcEnvReads().map((r) => r.name))].sort();
    expect(
      read,
      'a file under src/ reads an environment variable that is not pinned. Vite INLINES every ' +
      'VITE_* variable into the browser bundle, so this list is the complete set of values the ' +
      'public build is allowed to carry. If the new one is genuinely public, add it to ' +
      'CLIENT_ENV_READS with the reason. If it is a secret, it belongs in functions/.'
    ).toEqual(CLIENT_ENV_READS.map((e) => e.name).sort());
  });

  it('…and NO pinned name is a provider key — a pin edit cannot let one through (F3)', () => {
    // The layer a pin edit cannot defeat, and the whole finding: VITE_GEMINI_API_KEY ends with
    // GEMINI_API_KEY, so adding it to the list above fails HERE instead.
    expect(
      providerKeysAmong(CLIENT_ENV_READS.map((e) => e.name), providerKeyNames()),
      'a pinned client env var is an AI provider key. The VITE_ prefix is exactly what puts it in ' +
      'the browser bundle — there is no configuration that makes this safe.'
    ).toEqual([]);
  });

  it('…and no pinned name is secret-SHAPED either, whatever provider it belongs to', () => {
    expect(secretShapedAmong(CLIENT_ENV_READS.map((e) => e.name))).toEqual([]);
  });

  it('no file under src/ takes the whole env object, which would defeat the name pin', () => {
    expect(srcEnvReads().filter((r) => r.name === WHOLE_ENV_OBJECT)).toEqual([]);
  });

  it('every pinned variable states why it is safe in a public bundle', () => {
    for (const entry of CLIENT_ENV_READS) {
      expect(entry.whyPublic.trim().length, `${entry.name} has no stated reason`).toBeGreaterThan(20);
    }
  });

  describe('the two name rules, on shapes they can fail against (the tenth shadowing instance)', () => {
    const KEYS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY'];

    it('F3 EXACTLY: a VITE_-prefixed provider key is flagged', () => {
      expect(providerKeysAmong(['VITE_GEMINI_API_KEY'], KEYS)).toEqual(['VITE_GEMINI_API_KEY']);
    });

    it('the bare server name is flagged too, and so is one with something appended', () => {
      // Substring, not endsWith: `VITE_GEMINI_API_KEY_2` is the same key with a suffix, and a
      // rule anchored at the end waves it through.
      expect(providerKeysAmong(['GEMINI_API_KEY', 'VITE_OPENAI_API_KEY_2'], KEYS))
        .toEqual(['GEMINI_API_KEY', 'VITE_OPENAI_API_KEY_2']);
    });

    it('THE PRECISION CASE: the Firebase web API key is NOT a provider key', () => {
      // This is the one that keeps the rule usable rather than something a future author bolts an
      // exemption onto. It carries API_KEY, it is public by design, and it must pass.
      expect(providerKeysAmong(['VITE_FIREBASE_API_KEY', 'VITE_USE_EMULATOR', 'DEV'], KEYS)).toEqual([]);
    });

    it('and the rule is DERIVED — a fourth provider is covered the day its adapter is written', () => {
      expect(providerKeysAmong(['VITE_MISTRAL_API_KEY'], [...KEYS, 'MISTRAL_API_KEY']))
        .toEqual(['VITE_MISTRAL_API_KEY']);
      // …and is not covered before that, which is what makes the derivation the load-bearing part.
      expect(providerKeysAmong(['VITE_MISTRAL_API_KEY'], KEYS)).toEqual([]);
    });

    it('secret-shaped names are flagged on whole words', () => {
      expect(secretShapedAmong([
        'VITE_PROVIDER_SECRET', 'VITE_ACCESS_TOKEN_V2', 'VITE_DB_PASSWORD', 'VITE_SERVICE_PRIVATE_KEY',
      ])).toEqual([
        'VITE_ACCESS_TOKEN_V2', 'VITE_DB_PASSWORD', 'VITE_PROVIDER_SECRET', 'VITE_SERVICE_PRIVATE_KEY',
      ]);
    });

    it('…and a name that merely CONTAINS one of those letters is not', () => {
      // Otherwise the rule becomes noise and gets an exemption bolted onto it — and the pinned
      // Firebase key, which really does carry API_KEY, has to keep passing.
      expect(secretShapedAmong(['VITE_TOKENIZER_MODE', 'VITE_FIREBASE_API_KEY', 'VITE_SECRETARIAT_URL']))
        .toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // THE SCANNER, ON SHAPES IT CAN FAIL AGAINST.
  //
  // Written before the scanner had a body. On the real tree every read is a plain
  // `import.meta.env.NAME`, so `return []` satisfies every assertion above — the shadowing defect
  // this stage has now recorded nine times, and the reason the fix for F2 exists at all.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  describe('envReadsIn, on the shapes a key would actually arrive through', () => {
    const scan = (src: string): EnvRead[] => envReadsIn(src, 'probe.ts');
    const names = (src: string): string[] => scan(src).map((r) => r.name).sort();

    it('F3 EXACTLY: a plain `import.meta.env.VITE_*_API_KEY` member read', () => {
      expect(scan('const k = import.meta.env.VITE_GEMINI_API_KEY;'))
        .toEqual([{ name: 'VITE_GEMINI_API_KEY', via: 'import.meta.env' }]);
    });

    it('bracket access with a string literal is the same read', () => {
      expect(names("const k = import.meta.env['VITE_GEMINI_API_KEY'];")).toEqual(['VITE_GEMINI_API_KEY']);
    });

    it('destructuring is the same read, and a RENAMED binding still reports the variable', () => {
      expect(names('const { VITE_GEMINI_API_KEY: k, DEV } = import.meta.env;'))
        .toEqual(['DEV', 'VITE_GEMINI_API_KEY']);
    });

    it('taking the whole object is recorded, never ignored — it reads everything', () => {
      expect(names('const e = import.meta.env;\nconst k = e[pick];')).toEqual([WHOLE_ENV_OBJECT]);
    });

    it('a computed access whose key is not a literal is a whole-object read — fail closed', () => {
      expect(names('const k = import.meta.env[pick];')).toEqual([WHOLE_ENV_OBJECT]);
    });

    it('process.env is the other door and is reported as such', () => {
      expect(scan("if (process.env.NODE_ENV !== 'production') {}"))
        .toEqual([{ name: 'NODE_ENV', via: 'process.env' }]);
    });

    it('several reads in one file are all reported, including inside JSX', () => {
      const src = 'const El = () => <p x={import.meta.env.VITE_A} y={import.meta.env.VITE_B} />;';
      expect(envReadsIn(src, 'probe.tsx').map((r) => r.name).sort()).toEqual(['VITE_A', 'VITE_B']);
    });

    it('a name in a STRING or a COMMENT is not a read — which is why this file can name the key', () => {
      expect(names("const s = 'import.meta.env.VITE_GEMINI_API_KEY';")).toEqual([]);
      expect(names('// import.meta.env.VITE_GEMINI_API_KEY\nconst x = 1;')).toEqual([]);
    });

    it('an unrelated `.env` property on some other object is not an env read', () => {
      // Precision: without it the rule flags `config.env.mode` and gets deleted as noise.
      expect(names('const m = config.env.MODE;')).toEqual([]);
      expect(names('const m = somethingElse.env;')).toEqual([]);
    });

    it('`import.meta` used for something other than env is not an env read', () => {
      expect(names('const u = import.meta.url;')).toEqual([]);
    });
  });
});

describe("vite.config.ts's comment claims only what a test checks (F3)", () => {
  it('does not claim the key is unreachable from the client build without naming the guard', () => {
    // The comment used to assert the repo-root key "is now read only by functions/ and by
    // scripts, never by the client build". That was a property nothing checked, and it was
    // reachable in one line. The sentence is corrected; this pins the false version out.
    const config = readFileSync(resolve(REPO_ROOT, 'vite.config.ts'), 'utf8');
    expect(config).not.toContain('never by the client build');
    // …and the corrected comment must point at the guard that makes the claim true, so the next
    // reader can check it rather than believe it.
    expect(config).toContain('import.meta.env');
    expect(config).toContain('clientAiPlumbing.test.ts');
  });
});
