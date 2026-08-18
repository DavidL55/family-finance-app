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

/** Every expression a `return` inside `fn` hands back, ignoring nested functions' own returns. */
function functionReturnExpressions(fn: ts.Node): ts.Expression[] {
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
  return out;
}

/** Every expression a `return` inside `functionName` hands back. */
export function returnExpressions(sourceFile: ts.SourceFile, functionName: string): ts.Expression[] {
  const fn = findFunctionLike(sourceFile, functionName);
  const out = functionReturnExpressions(fn);
  if (out.length === 0) {
    throw new Error(`${functionName} returns nothing this guard can see — it cannot derive the payload from it`);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RE-REVIEW R-1 — THE GUARD READ THE DECLARED TYPE; JSON.stringify SENDS THE RUNTIME OBJECT.
//
// flattenTypeLeaves above walks functions/src/context/types.ts. aiChat.ts does not send a type;
// it sends `JSON.stringify(ctx)`, and `ctx` is whatever buildFinancialContext actually returns.
// Those two are the same set only for as long as TypeScript makes them the same set — and it
// does not. Excess-property checking fires on a FRESH OBJECT LITERAL in a typed position only.
// Assign the literal to an inferred `const` and hand that back as `Promise<FinancialContext>`:
//
//     const out = { scope, filterScope, …, recurringItems };   // inferred, wider than the type
//     return out;                                              // assignable, no excess check
//
// It compiles clean under functions/'s strict config, types.ts never changes, so the whitelist
// still matches the declared leaves exactly. Reproduced here: every recurring line item — owner
// id, exact amount, label — added to the returned object, ALL 1655 GREEN, both tsc clean.
//
// So the leaf set is derived from what the BUILDER RETURNS, and the declared walk is kept beside
// it as a union rather than replaced: a field declared but not yet populated (netWorth) still has
// to be accounted for, and a property returned but not declared (the bypass) now has to be too.
//
// The walk resolves through the three things a real builder does — a `const` bound to the
// literal, a nested literal, and a LOCAL helper that builds one (`fact(expenseTotal, '…')`) — and
// falls back to the declared shape only where it genuinely cannot see (an imported call, a
// parameter). At the ROOT it does not fall back at all: an unresolvable root return is the whole
// bypass, so it throws.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The function-like `name` resolves to WITHIN this file, or null if it comes from elsewhere. */
function resolveLocalFunction(node: ts.Node, name: string): ts.Node | null {
  const initializer = resolveConstInitializer(node, name);
  if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
    return initializer;
  }
  let found: ts.Node | null = null;
  const sourceFile = node.getSourceFile();
  sourceFile.forEachChild((child) => {
    if (ts.isFunctionDeclaration(child) && child.name?.text === name) found = child;
  });
  return found;
}

/**
 * Every LEAF the object `functionName` RETURNS carries, as dotted paths.
 *
 * `declaredLeaves` is the declared-type walk's output, used as the fallback shape wherever this
 * one hits an expression it cannot see into: `filterScope` is a parameter, so the runtime shape
 * is unknowable here and the type is the best available answer. A path with no declared leaves
 * under it is an UNDECLARED runtime property — the bypass — and is returned as a leaf of its own,
 * so the disclosure map has to grow an entry for it or fail.
 */
export function returnedObjectLeaves(
  filePath: string,
  functionName: string,
  declaredLeaves: readonly string[]
): string[] {
  const sourceFile = parseTs(filePath);
  const returns = returnExpressions(sourceFile, functionName);

  const printer = ts.createPrinter({ removeComments: true });
  const print = (node: ts.Node): string =>
    printer.printNode(ts.EmitHint.Expression, node, sourceFile).replace(/\s+/g, ' ').trim();

  const leaves: string[] = [];
  const join = (prefix: string, name: string): string => (prefix ? `${prefix}.${name}` : name);

  /** What the DECLARED type says lives at or under `path` — the fallback where we cannot see. */
  const declaredUnder = (path: string): string[] =>
    declaredLeaves.filter((leaf) => leaf === path || leaf.startsWith(`${path}.`));

  const opaque = (path: string, node: ts.Node): void => {
    if (path === '') {
      throw new Error(
        `${functionName} returns \`${print(node)}\`, which this guard cannot resolve to an object ` +
        'literal. It therefore cannot see what actually leaves — which is exactly the bypass this ' +
        'walk exists to close. Return an object literal, or a `const` bound to one.'
      );
    }
    const declared = declaredUnder(path);
    if (declared.length > 0) leaves.push(...declared);
    else leaves.push(path); // undeclared at runtime: a value with no type entry to hide behind
  };

  const seen = new Set<string>(); // `${path}|${kind}:${name}` — one resolution each, and the cycle guard

  const walk = (node: ts.Node, path: string, depth: number): void => {
    if (depth > 16) {
      throw new Error(`${functionName}'s returned object nests more than 16 deep at ${path || '<root>'} — probably a cycle`);
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
      return walk(node.expression, path, depth);
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) {
          if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
            walk(property.initializer, join(path, property.name.text), depth + 1);
          } else {
            // A computed key is a runtime-chosen field name. Recorded, never skipped.
            leaves.push(join(path, `[${print(property.name)}]`));
          }
        } else if (ts.isShorthandPropertyAssignment(property)) {
          walk(property.name, join(path, property.name.text), depth + 1);
        } else if (ts.isSpreadAssignment(property)) {
          const inner = ts.isIdentifier(property.expression)
            ? resolveConstInitializer(property.expression, property.expression.text)
            : null;
          if (inner && ts.isObjectLiteralExpression(inner)) walk(inner, path, depth + 1);
          // A spread of anything else merges keys this guard cannot enumerate. Fail closed.
          else leaves.push(join(path, `...${print(property.expression)}`));
        } else {
          leaves.push(join(path, print(property)));
        }
      }
      return;
    }
    if (ts.isConditionalExpression(node)) {
      // Both branches are shapes the caller may actually receive.
      walk(node.whenTrue, path, depth + 1);
      walk(node.whenFalse, path, depth + 1);
      return;
    }
    if (ts.isIdentifier(node)) {
      const key = `${path}|id:${node.text}`;
      if (seen.has(key)) return;
      const initializer = resolveConstInitializer(node, node.text);
      if (initializer === null) return opaque(path, node);
      seen.add(key);
      return walk(initializer, path, depth + 1);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      // A LOCAL helper that builds the object — `fact(expenseTotal, 'recurring …')`. Following it
      // is what makes `totalMonthlyExpense.value` a real derivation rather than a type echo, and
      // it means a field added inside the helper is caught too.
      const key = `${path}|call:${node.expression.text}`;
      if (seen.has(key)) return;
      const fn = resolveLocalFunction(node, node.expression.text);
      if (fn === null) return opaque(path, node);
      const bodies = functionReturnExpressions(fn);
      if (bodies.length === 0) return opaque(path, node);
      seen.add(key);
      for (const body of bodies) walk(body, path, depth + 1);
      return;
    }
    // A literal, an imported call, a property access, an array, an await: a value whose runtime
    // shape this guard cannot enumerate. The declared type is the honest fallback.
    return opaque(path, node);
  };

  for (const expression of returns) walk(expression, '', 0);
  return [...new Set(leaves)].sort();
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
