import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import * as ts from 'typescript';
import { resolveOwnedModuleScope as clientResolve } from '../utils/ownedModuleScope';
import { resolveOwnedModuleScope as functionsResolve } from '../../functions/src/shared/permissions';
import { MODULE_IDS } from '../types/permissions';
import type { PermissionLevel, PermissionRole } from '../types/permissions';

const ROLES: PermissionRole[] = ['super-admin', 'parent', 'member'];
const LEVELS: (PermissionLevel | undefined)[] = ['none', 'own', 'family', undefined];

describe('functions/src/shared/permissions mirrors src/utils/ownedModuleScope (D2)', () => {
  it('agrees with the client implementation for every (role, level) pair', () => {
    for (const role of ROLES) {
      for (const level of LEVELS) {
        expect(functionsResolve(role, level)).toBe(clientResolve(role, level));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// STAGE 7 T2 (finding 1.2.5) — THE TWO `ModuleId` UNIONS, AND NOTHING HELD THEM IN SYNC.
//
// `ModuleId` is declared TWICE: `src/types/permissions.ts` and, mirrored by hand across the deploy
// boundary, `functions/src/shared/permissions.ts`. The mirrored file's own header says the contract
// test in THIS file "is what actually enforces it" — and it did not. It compared
// `resolveOwnedModuleScope`'s BEHAVIOUR for every (role, level) pair, which is a function of the
// LEVEL and never touches the module union at all. So adding a module broke the build client-side
// (MODULE_LABELS is a total `Record<ModuleId, string>` — good, loud) and drifted SILENTLY
// server-side, where nothing is total over it.
//
// Both halves are compared, because they fail in opposite directions:
//   · the two `ModuleId` TYPE declarations — read off the AST of each file, so a mirror that goes
//     stale is a red test rather than a divergence nobody sees;
//   · `MODULE_IDS` against the client union — the array is typed `readonly ModuleId[]`, which
//     accepts a SHORT array quite happily, so a member added to the type and forgotten in the array
//     type-checks and then never appears in the permissions matrix UI.
// ---------------------------------------------------------------------------

/** The member names of a `type X = 'a' | 'b'` union declaration, read off one file's AST. */
function unionMembersOf(filePath: string, typeName: string): string[] {
  const source = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const members: string[] = [];
  let found = false;
  sourceFile.forEachChild((node) => {
    if (!ts.isTypeAliasDeclaration(node) || node.name.text !== typeName) return;
    found = true;
    const collect = (t: ts.TypeNode): void => {
      if (ts.isUnionTypeNode(t)) {
        for (const part of t.types) collect(part);
        return;
      }
      if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) members.push(t.literal.text);
    };
    collect(node.type);
  });
  expect(found, `${filePath} must declare \`type ${typeName}\``).toBe(true);
  return members.sort();
}

describe('the two ModuleId unions are the SAME union (finding 1.2.5)', () => {
  // Both paths computed locally rather than off FUNCTIONS_SRC_ROOT, which is declared further
  // down this file: vitest defers describe callbacks past module evaluation so the reference would
  // work, but a guard that depends on that is one refactor from a ReferenceError.
  const CLIENT = join(process.cwd(), 'src', 'types', 'permissions.ts');
  const FUNCTIONS = join(process.cwd(), 'functions', 'src', 'shared', 'permissions.ts');

  it('functions/src/shared/permissions.ts declares exactly the client ModuleId union', () => {
    const client = unionMembersOf(CLIENT, 'ModuleId');
    // Non-vacuity: a parser change or a rename that made either side empty would otherwise let
    // `[] === []` pass as agreement.
    expect(client.length).toBeGreaterThanOrEqual(9);
    expect(client).toContain('forecast');
    expect(unionMembersOf(FUNCTIONS, 'ModuleId')).toEqual(client);
  });

  it('MODULE_IDS holds every member of the union — a short array type-checks fine', () => {
    expect([...MODULE_IDS].sort()).toEqual(unionMembersOf(CLIENT, 'ModuleId'));
  });

  it('the reader is non-vacuous — it can see a union that differs', () => {
    // Proven on the real files rather than assumed: PermissionLevel is a DIFFERENT union in the
    // same two files, so reading it back proves the extractor is reading declarations and not
    // returning whatever it was asked for.
    expect(unionMembersOf(CLIENT, 'PermissionLevel')).toEqual(['family', 'none', 'own']);
    expect(unionMembersOf(CLIENT, 'PermissionLevel')).not.toEqual(unionMembersOf(CLIENT, 'ModuleId'));
    expect(unionMembersOf(FUNCTIONS, 'PermissionRole')).toEqual(unionMembersOf(CLIENT, 'PermissionRole'));
  });
});

// ---------------------------------------------------------------------------
// D2/D8 regression guard
//
// The contract: a verified PermissionRole in Functions always comes from
// `request.auth.token.role` (or a local variable that is itself just that token, however far it
// got destructured/renamed along the way — `const { role } = token`, `const { auth: { token } } =
// req; token.role`, etc.). NOTHING in functions/src may read `.role` off anything else — most
// importantly not off a Member document — because Member.role is the family relationship
// (הורה/ילד), not this union (see functions/src/shared/permissions.ts's header).
//
// This used to be a regex (`/(?<!token)\.role\b/`) scanning only functions/src/{handlers,context}.
// A reviewer found it bypassable three ways and blind to a fourth:
//   1. `const { role } = member`      — destructuring never matches a `.role` regex at all.
//   2. `member['role']`               — bracket access never matches `\.role\b` either.
//   3. delegating to a helper defined elsewhere — the caller file stays clean; only the helper's
//      file contains the actual `.role` read, and that helper could live outside the two scanned
//      directories.
//   4. the scan roots themselves: functions/src/shared (where permissions.ts lives, and exactly
//      where a "helper" in (3) would most naturally be added) was never scanned, so a data-reading
//      helper placed directly beside the mirrored contract — the one thing its own file header
//      forbids — would pass every test.
//
// This version walks the real TypeScript AST (the compiler API is already a project dependency,
// so no new dependency to add) instead of pattern-matching source text, and scans every non-test
// .ts file under functions/src recursively — closing (4) by construction: wherever Task 3+ adds a
// new directory, it's inside functions/src and therefore in scope. AST catches (1) destructuring
// bindings and (2) bracket/computed member access directly as node kinds, not as text patterns.
// (3) is closed because the helper's *own* file is scanned like any other — delegating doesn't
// evade the guard, it just moves which file trips it.
//
// What it still can't catch: a helper that lives entirely outside functions/src (out of scope for
// a functions/src-only contract), or a role value laundered through something the checker can't
// statically resolve to 'role' as a property/binding name (e.g. `const key = 'ro' + 'le'; member[key]`).
// Closing that would need real type-flow analysis, not worth it for a deliberately-obfuscated
// attack against your own codebase — the goal here is catching the natural ways this bug recurs,
// not adversarial-proofing against a hostile committer.
//
// SECOND ESCAPE HATCH, v2 (v1 — a same-line `// role-guard-allow: not-auth-role` comment, no
// structural check at all — was proven by review to defeat the guard entirely: the reviewer wrote
// a genuine `member.role` authorization read behind that exact comment and the guard reported
// zero violations, identical code minus the comment failed correctly. A same-line comment is not
// evidence about the EXPRESSION; it is evidence about what the author chose to type next to it,
// which is exactly as trustworthy as a self-attested "trust me". `isTokenLike` never had this
// problem because it inspects the expression's own text, not a human's claim about it.)
//
// v2 replaces the comment with a structural check: `isMessagesMapElementRoleAccess` below verifies
// the READ SITE, not a claim about it. It allows a `.role` access only when it is the mapped
// element's own property, read directly inside a `.map()` callback whose receiver's text matches
// /messages|history/i — i.e. exactly the shape every real adapter use has:
// `messages.map((m) => ({ role: m.role === 'model' ? ... }))`. `ChatMessage.role` ('user' |
// 'model', functions/src/providers/types.ts) is which of the two conversation turns is speaking —
// every major LLM SDK's own message-turn convention names this field `role` too — and has NOTHING
// to do with PermissionRole or authorization; a Member/auth-shaped read can't be dressed up in
// this shape because member lookups are never the direct callback parameter of a
// `messages`/`history` `.map()` call. The reviewer's exact abuse snippet — `member.role` and
// `(member.role as string)`, no enclosing `.map()` at all — is rejected by construction: no
// enclosing arrow-function-as-map-callback exists to climb to, so the structural check returns
// false and the read still trips a violation, comment or no comment.
//
// A full TypeChecker-based alternative (resolve the property's declaring type against
// `ChatMessage`) was considered and would be strictly more precise, but requires building a full
// `ts.Program` with module resolution across functions/src (this file currently only parses each
// file standalone via `ts.createSourceFile`, no type-checking) — a real increase in this guard's
// own complexity and runtime for a codebase where the map-callback shape already fully separates
// the one legitimate case from the one attack the reviewer demonstrated. Worth revisiting if a
// future legitimate `.role` read doesn't fit the `.map()`-over-messages/history shape.

const FUNCTIONS_SRC_ROOT = join(process.cwd(), 'functions', 'src');

/** True when the expression text is exactly `token`, or ends with `.token` — e.g. `auth.token`,
 *  `request.auth.token`, `context.auth.token`. Those are the legitimate source of `.role`. */
function isTokenLike(exprText: string): boolean {
  return exprText === 'token' || exprText.endsWith('.token');
}

interface Violation {
  file: string;
  line: number;
  detail: string;
}

function collectRoleViolations(filePath: string, relPath: string): Violation[] {
  const violations: Violation[] = [];
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const bindingElementPropName = (el: ts.BindingElement): string | undefined => {
    const nameNode = el.propertyName ?? el.name;
    return ts.isIdentifier(nameNode) ? nameNode.text : undefined;
  };

  /** True when `node` (the `.role` read/binding site itself — a PropertyAccessExpression,
   *  ElementAccessExpression, or BindingElement) sits directly inside a `.map()` callback of the
   *  shape `<messages-or-history-like>.map((el) => ... el.role ...)`, reading `.role` off that
   *  callback's OWN first parameter (`sourceExprText`) — the only shape every legitimate
   *  ChatMessage.role use in this codebase has, and one the reviewer's abuse snippet (a bare
   *  `member.role`/`member['role']`/`const { role } = member` with no enclosing map at all)
   *  cannot produce no matter what comment sits next to it. See file header for the v1-to-v2
   *  rationale. */
  const isMessagesMapElementRoleAccess = (node: ts.Node, sourceExprText: string): boolean => {
    let current: ts.Node = node;
    while (current.parent) {
      current = current.parent;
      if (!ts.isFunctionLike(current)) continue;
      // Reached the nearest enclosing function/method/arrow boundary. The role read must live
      // directly inside THIS callback to count — climbing further out would let a bypass borrow
      // an unrelated outer map() it isn't actually inside.
      if (
        (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
        ts.isCallExpression(current.parent) &&
        ts.isPropertyAccessExpression(current.parent.expression) &&
        current.parent.expression.name.text === 'map' &&
        current.parent.arguments[0] === current
      ) {
        const param = current.parameters[0];
        const paramName = param && ts.isIdentifier(param.name) ? param.name.text : undefined;
        if (paramName !== undefined && paramName === sourceExprText) {
          const receiverText = current.parent.expression.expression.getText(sourceFile);
          if (/messages|history/i.test(receiverText)) return true;
        }
      }
      return false;
    }
    return false;
  };

  const visit = (node: ts.Node): void => {
    // member.role
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'role') {
      const exprText = node.expression.getText(sourceFile);
      if (!isTokenLike(exprText) && !isMessagesMapElementRoleAccess(node, exprText)) {
        violations.push({
          file: relPath,
          line: lineOf(node),
          detail: `property access \`${node.getText(sourceFile)}\` (not on \`token\`)`,
        });
      }
    }

    // member['role'] / member["role"]
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'role'
    ) {
      const exprText = node.expression.getText(sourceFile);
      if (!isTokenLike(exprText) && !isMessagesMapElementRoleAccess(node, exprText)) {
        violations.push({
          file: relPath,
          line: lineOf(node),
          detail: `bracket access \`${node.getText(sourceFile)}\` (not on \`token\`)`,
        });
      }
    }

    // const { role } = member  /  const { role: r } = member
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
      const initText = node.initializer.getText(sourceFile);
      for (const el of node.name.elements) {
        if (bindingElementPropName(el) === 'role' && !isTokenLike(initText) && !isMessagesMapElementRoleAccess(el, initText)) {
          violations.push({
            file: relPath,
            line: lineOf(el),
            detail: `destructures \`role\` from \`${initText}\` (not \`token\`)`,
          });
        }
      }
    }

    // function f({ role }: SomeType) — can't see the runtime source, so require the annotation to
    // mention "token", or an explicit same-line escape hatch comment naming it, to pass.
    if (ts.isParameter(node) && ts.isObjectBindingPattern(node.name)) {
      const typeText = node.type ? node.type.getText(sourceFile) : '';
      const lineText = sourceFile.text.split('\n')[lineOf(node) - 1] ?? '';
      const allowed = /token/i.test(typeText) || lineText.includes('role-guard-allow: token');
      for (const el of node.name.elements) {
        if (bindingElementPropName(el) === 'role' && !allowed) {
          violations.push({
            file: relPath,
            line: lineOf(el),
            detail: `parameter destructures \`role\` (type: ${typeText || 'unannotated'}) — annotate the ` +
              'parameter type with something containing "token", or add a same-line `// role-guard-allow: token` ' +
              'comment if this is genuinely a decoded token payload',
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

function listScannedFiles(dir: string, base: string): { path: string; rel: string }[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: { path: string; rel: string }[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listScannedFiles(full, base));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || entry.endsWith('.d.ts')) continue;
    out.push({ path: full, rel: relative(base, full) });
  }
  return out;
}

describe('functions/src never reads Member.role for an authorization decision (D2/D8 regression guard)', () => {
  it('no committed .ts file under functions/src reads a non-token `role` via property access, ' +
     'bracket access, or destructuring', () => {
    const files = listScannedFiles(FUNCTIONS_SRC_ROOT, FUNCTIONS_SRC_ROOT);
    expect(files.length, 'expected to find at least functions/src/shared/permissions.ts').toBeGreaterThan(0);

    const violations = files.flatMap(({ path, rel }) => collectRoleViolations(path, rel));

    expect(
      violations,
      violations
        .map((v) => `functions/src/${v.file}:${v.line} — ${v.detail}`)
        .join('\n') || undefined
    ).toEqual([]);
  });
});
