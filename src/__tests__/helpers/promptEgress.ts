// Stage 6 closing review B-i — READING WHAT ACTUALLY LEAVES, RATHER THAN ONE SHAPE OF IT.
//
// Batch 9 pinned the egress disclosure to the payload, and the three mutations it was built
// against genuinely fail. But the closing review found FOUR bypasses that pass all 1620 tests,
// and every one of them exploits the same thing: the guard was a whitelist over ONE object's
// TOP-LEVEL members and ONE template literal's `${}` SPANS.
//
//   1. a field added to the NESTED AiFilterScope rides inside the same JSON.stringify(ctx);
//   2. buildExtractionPrompt widened by `+` concatenation instead of a `${}` span — under a test
//      title claiming it "accounts for EVERY interpolation";
//   3. a new server read appended beside the context in aiChat.ts, sending the exact thing the
//      copy's negative line promises does not leave;
//   4. a field disclosed only on the super-admin banner, leaving the line everyone else reads
//      untouched.
//
// This module is the answer to (1)-(3): it walks NESTED types transitively, and it derives the
// prompt payload from the WHOLE expression that reaches the adapter — templates, concatenations,
// conditionals, array and object literals, and local `const` bindings resolved through — rather
// than from template spans alone. (4) is closed in the guard, by requiring every phrase on both
// the banner and the per-surface notice.
//
// EVERYTHING HERE FAILS CLOSED. An expression shape it does not understand is RECORDED as a
// contributor (so it must be disclosed or the guard fails), never skipped; a nested type it cannot
// resolve THROWS rather than being treated as a leaf. A guard for this defect class must never be
// able to lose track of something quietly — that is the defect class.
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';

export function parseTs(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// TRANSITIVE TYPE FLATTENING (closes bypass 1)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Type references the flattener is allowed to treat as a single opaque value. Anything else that
 * is not declared in the same file throws — an unresolvable nested object is exactly the hole
 * bypass 1 walked through, and guessing "probably a leaf" would re-open it one type-import away.
 */
const OPAQUE_LEAF_TYPES = new Set(['Date', 'RegExp']);

function isNullish(t: ts.TypeNode): boolean {
  if (t.kind === ts.SyntaxKind.NullKeyword || t.kind === ts.SyntaxKind.UndefinedKeyword) return true;
  return ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword;
}

/**
 * Every LEAF field of `typeName`, as dotted paths, following nested interfaces, type aliases and
 * inline type literals declared in the same file.
 *
 * Leaves rather than containers: a container entry ("filterScope is disclosed") is precisely what
 * let a new `categoryIds` ride along undisclosed. Every path returned here names something that
 * carries a VALUE into the JSON the model receives.
 */
export function flattenTypeLeaves(filePath: string, typeName: string): string[] {
  const sourceFile = parseTs(filePath);
  const declared = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>();
  sourceFile.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node)) declared.set(node.name.text, node);
    else if (ts.isTypeAliasDeclaration(node)) declared.set(node.name.text, node);
  });

  const root = declared.get(typeName);
  if (!root || !ts.isInterfaceDeclaration(root)) {
    throw new Error(`interface ${typeName} not found in ${filePath} — this guard is looking at the wrong file`);
  }

  const leaves: string[] = [];

  const visitMembers = (members: readonly ts.TypeElement[], prefix: string, depth: number): void => {
    for (const member of members) {
      if (!ts.isPropertySignature(member) || !member.type) continue;
      const name = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : '';
      if (!name) continue;
      visitType(member.type, prefix ? `${prefix}.${name}` : name, depth + 1);
    }
  };

  const visitType = (type: ts.TypeNode, path: string, depth: number): void => {
    if (depth > 12) {
      throw new Error(`type ${typeName} nests more than 12 deep at ${path} — probably a cycle this guard cannot flatten`);
    }
    if (ts.isParenthesizedTypeNode(type)) return visitType(type.type, path, depth);
    if (ts.isUnionTypeNode(type)) {
      const meaningful = type.types.filter((t) => !isNullish(t));
      // A union of literals ('own' | 'family' | 'none') is a VALUE, not a shape to descend into.
      if (meaningful.length === 0 || meaningful.every((t) => ts.isLiteralTypeNode(t))) {
        leaves.push(path);
        return;
      }
      if (meaningful.length === 1) return visitType(meaningful[0], path, depth);
      // A union of two different object shapes: descend into each, so neither can hide a field.
      for (const t of meaningful) visitType(t, path, depth + 1);
      return;
    }
    if (ts.isTypeLiteralNode(type)) return visitMembers(type.members, path, depth);
    if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
      const target = declared.get(type.typeName.text);
      if (target && ts.isInterfaceDeclaration(target)) return visitMembers(target.members, path, depth + 1);
      if (target && ts.isTypeAliasDeclaration(target)) return visitType(target.type, path, depth + 1);
      if (OPAQUE_LEAF_TYPES.has(type.typeName.text)) {
        leaves.push(path);
        return;
      }
      throw new Error(
        `${typeName}.${path} is typed ${type.typeName.text}, which is not declared in ${filePath}. ` +
        'This guard cannot see its fields, so it cannot promise they are disclosed — move the type ' +
        'into this file or add it to OPAQUE_LEAF_TYPES with a reason.'
      );
    }
    // Primitives, arrays, tuples, index signatures: a value, disclosed as one thing.
    leaves.push(path);
  };

  visitMembers(root.members, '', 0);
  return [...new Set(leaves)].sort();
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// STRING-EXPRESSION DECOMPOSITION (closes bypasses 2 and 3)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The innermost `const` binding of `name` visible from `node`, or null.
 *
 * Resolving through local bindings is what makes the decomposition deep enough to matter: without
 * it aiChat.ts's whole scope disclosure collapses to the single opaque contributor
 * `scopeDisclosure`, and widening THAT — which is bypass 3's shape one level down — would pass.
 */
function resolveConstInitializer(node: ts.Node, name: string): ts.Expression | null {
  for (let scope: ts.Node | undefined = node; scope; scope = scope.parent) {
    const statements = ts.isSourceFile(scope) ? scope.statements : ts.isBlock(scope) ? scope.statements : null;
    if (!statements) continue;
    for (const statement of statements) {
      if (!ts.isVariableStatement(statement)) continue;
      if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
      for (const decl of statement.declarationList.declarations) {
        // Only a plain `const x = …`. A destructuring pattern (`const { message } = request.data`)
        // deliberately does NOT resolve: `message` is request input, and naming it as the
        // contributor is more honest than naming the object it was pulled out of.
        if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) return decl.initializer;
      }
    }
  }
  return null;
}

/**
 * Every DYNAMIC value that reaches the string (or request object) `expr` builds.
 *
 * Static text contributes nothing — it is our own prose. Everything else is a contributor and must
 * be accounted for by the disclosure. The shapes that are decomposed rather than recorded whole:
 *
 *   template literal   → each `${}` span                    (what batch 9 already had)
 *   `a + b`            → both sides                          ← BYPASS 2
 *   `c ? a : b`        → the CONDITION, plus both branches
 *   array / object     → every element and property value    ← BYPASS 3, on the messages array
 *   identifier         → its local `const` initializer, resolved through
 *
 * The condition of a conditional is recorded even when both branches are static literals, because
 * WHICH branch was taken is itself a fact about the family that reaches the model —
 * `ctx.scope === 'family' ? 'משפחתי' : 'אישי'` discloses the caller's permission scope in prose
 * while leaking no "dynamic" substring at all.
 *
 * Anything else — a call, a property access, a name with no local binding — is RECORDED. Fail
 * closed: an expression this function does not understand becomes something the disclosure must
 * name, never something it may omit.
 */
export function stringContributors(sourceFile: ts.SourceFile, expr: ts.Expression): string[] {
  const printer = ts.createPrinter({ removeComments: true });
  const print = (node: ts.Node): string =>
    printer.printNode(ts.EmitHint.Expression, node, sourceFile).replace(/\s+/g, ' ').trim();

  const found: string[] = [];
  const resolved = new Set<string>(); // one resolution per name — also the cycle guard

  const walk = (node: ts.Node): void => {
    if (ts.isParenthesizedExpression(node)) return walk(node.expression);
    if (ts.isAsExpression(node) || ts.isNonNullExpression(node)) return walk(node.expression);

    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isNumericLiteral(node) ||
      node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword ||
      node.kind === ts.SyntaxKind.NullKeyword ||
      node.kind === ts.SyntaxKind.UndefinedKeyword
    ) {
      return; // our own static text or a constant — nothing about this family
    }

    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) walk(span.expression);
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      walk(node.left);
      walk(node.right);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      found.push(print(node.condition));
      walk(node.whenTrue);
      walk(node.whenFalse);
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) walk(element);
      return;
    }
    if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) return walk(node.expression);
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) walk(property.initializer);
        else if (ts.isShorthandPropertyAssignment(property)) walk(property.name);
        else if (ts.isSpreadAssignment(property)) walk(property.expression);
        else found.push(print(property));
      }
      return;
    }
    if (ts.isIdentifier(node)) {
      const initializer = resolveConstInitializer(node, node.text);
      if (initializer) {
        // Already followed once — its contributors are in `found`; recording the name too would
        // double-count it as a separate thing that leaves.
        if (resolved.has(node.text)) return;
        resolved.add(node.text);
        walk(initializer);
        return;
      }
      found.push(node.text);
      return;
    }
    found.push(print(node));
  };

  walk(expr);
  return [...new Set(found)].sort();
}

/** The initializer of the module-or-function-scoped `const name = …` inside `functionName`. */
export function constInitializerInFunction(
  sourceFile: ts.SourceFile,
  functionName: string,
  name: string
): ts.Expression {
  const fn = findFunctionLike(sourceFile, functionName);
  let found: ts.Expression | null = null;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      if (found !== null) {
        throw new Error(`${functionName} declares ${name} more than once — this guard cannot tell which one reaches the model`);
      }
      found = node.initializer;
    }
    node.forEachChild(visit);
  };
  visit(fn);
  if (found === null) {
    throw new Error(`no \`const ${name}\` inside ${functionName} — this guard is looking at the wrong expression`);
  }
  return found;
}

/**
 * The function/arrow named `functionName`, or the sole callback of an `onCall(...)` export bound
 * to it. Handlers in functions/src are `export const aiChat = onCall(async (request) => {…})`.
 */
function findFunctionLike(sourceFile: ts.SourceFile, functionName: string): ts.Node {
  let found: ts.Node | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) found = node;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === functionName &&
      node.initializer
    ) {
      found = node.initializer;
    }
    if (found === null) node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  if (found === null) {
    throw new Error(`function ${functionName} not found in ${sourceFile.fileName} — this guard is looking at the wrong file`);
  }
  return found;
}

/** Every expression a `return` inside `functionName` hands back. */
export function returnExpressions(sourceFile: ts.SourceFile, functionName: string): ts.Expression[] {
  const fn = findFunctionLike(sourceFile, functionName);
  const out: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    // Does not descend into a NESTED function's returns — those belong to that function.
    if (node !== fn && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) return;
    if (ts.isReturnStatement(node) && node.expression) out.push(node.expression);
    node.forEachChild(visit);
  };
  fn.forEachChild(visit);
  // A concise arrow body (`() => expr`) is a return with no ReturnStatement.
  if (out.length === 0 && ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) out.push(fn.body);
  if (out.length === 0) {
    throw new Error(`${functionName} returns nothing this guard can see — it cannot derive the payload from it`);
  }
  return out;
}

/**
 * The single argument object of the one `…​.method(…)` call in the file. Throws on zero or on more
 * than one: a second call site is a second egress path, and silently measuring only the first is
 * how the guard would go stale exactly when it matters.
 */
export function soleCallArgument(sourceFile: ts.SourceFile, methodName: string): ts.Expression {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === methodName
    ) {
      calls.push(node);
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  if (calls.length !== 1) {
    throw new Error(
      `expected exactly one .${methodName}(…) call in ${sourceFile.fileName}, found ${calls.length} — ` +
      'each one is a separate thing leaving the house and this guard would only measure the first'
    );
  }
  const [arg] = calls[0].arguments;
  if (!arg) throw new Error(`.${methodName}(…) was called with no argument`);
  return arg;
}
