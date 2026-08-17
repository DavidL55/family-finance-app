import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import * as ts from 'typescript';
import { resolveOwnedModuleScope as clientResolve } from '../utils/ownedModuleScope';
import { resolveOwnedModuleScope as functionsResolve } from '../../functions/src/shared/permissions';
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
// SECOND ESCAPE HATCH (added when Task 4's real provider adapters first wrote code that reads
// `ChatMessage.role`): `ChatMessage.role` ('user' | 'model', functions/src/providers/types.ts) is
// which of the two conversation turns is speaking — every major LLM SDK's own message-turn
// convention names this field `role` too — and has NOTHING to do with PermissionRole or
// authorization. Every normal way to read that field's VALUE (dot access, bracket access,
// variable destructuring) trips one of the three checks below, and reusing the existing
// `role-guard-allow: token` hatch would be a FALSE claim there (it is not a token payload) —
// exactly the kind of dishonest-comment bypass this guard exists to make costly, not cheap.
// `role-guard-allow: not-auth-role` is a second, honestly-labeled hatch instead: same mechanic (an
// explicit, visible, same-line, human-written comment — never a file- or project-wide
// suppression), a different and accurate claim ("this is a same-named but unrelated field, not
// Member.role and not PermissionRole"). It does not weaken what this guard actually protects
// against (Member.role driving an authorization decision) — it only lets a genuinely different
// domain concept share the English word "role" without permanently blocking every future feature
// that also needs a turn/speaker marker.

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

  /** True when the source line containing `node` carries a `// role-guard-allow: not-auth-role`
   *  comment — the second, honestly-labeled escape hatch (see the file header). Deliberately a
   *  DIFFERENT string than the parameter case's `role-guard-allow: token`, so the two claims can
   *  never be confused with each other in a diff or a grep. */
  const hasNotAuthRoleAllowComment = (node: ts.Node): boolean =>
    (sourceFile.text.split('\n')[lineOf(node) - 1] ?? '').includes('role-guard-allow: not-auth-role');

  const visit = (node: ts.Node): void => {
    // member.role
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'role') {
      const exprText = node.expression.getText(sourceFile);
      if (!isTokenLike(exprText) && !hasNotAuthRoleAllowComment(node)) {
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
      if (!isTokenLike(exprText) && !hasNotAuthRoleAllowComment(node)) {
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
        if (bindingElementPropName(el) === 'role' && !isTokenLike(initText) && !hasNotAuthRoleAllowComment(el)) {
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
