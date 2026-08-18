// RE-REVIEW R-1 — the returned-object walk's own test subjects.
//
// This file is PARSED, never imported or executed: returnedObjectLeaves reads it off disk with
// the TypeScript parser, the same way it reads functions/src/context/buildFinancialContext.ts.
//
// It exists because the real builder cannot test the walk. buildFinancialContext returns exactly
// its declared shape, so the union of the declared walk and the returned walk equals the declared
// walk, and every branch that makes the returned walk WORTH having — the undeclared property, the
// helper-built nested object, the spread, the unresolvable root — does no work against src/. A
// `return []` at the top of returnedObjectLeaves would leave the suite green. That shadowing is
// this project's recorded signature defect, so the branches get subjects of their own.
//
// EVERY WIDENING BELOW USES THE REVIEWER'S OWN MECHANISM, not a type assertion: the literal is
// bound to an inferred `const` and the `const` is returned. TypeScript's excess-property check
// fires on a FRESH object literal in a typed position and nowhere else, so each of these compiles
// clean — under functions/'s strict config too — while sending a field the type never declared.
// Written with `as` instead, the fixture would be testing the walk against a shape a reviewer
// would notice; written this way it is testing it against the shape one would not.

interface Fact {
  value: number;
  source: string;
}

interface Ctx {
  scope: string;
  fact: Fact | null;
}

/** The honest shape: exactly what the type declares, nothing more. */
export function buildHonest(scope: string): Ctx {
  return { scope, fact: { value: 1, source: 'recurring' } };
}

/** R-1 EXACTLY: an inferred `const` carrying a field the type has never heard of. */
export function buildWithUndeclaredProperty(scope: string): Ctx {
  const recurringItems = [{ ownerId: 'omer', amount: 4200, label: 'שכר דירה' }];
  const out = { scope, fact: { value: 1, source: 'recurring' }, recurringItems };
  return out;
}

/** The same widening one level down, inside a LOCAL helper the walk has to follow into. */
export function buildViaHelper(scope: string): Ctx {
  const fact = (value: number) => ({ value, source: 'recurring', accountNumber: '12-345-67890' });
  const out = { scope, fact: fact(1) };
  return out;
}

/** A spread of something the walk cannot enumerate — it must be recorded, not waved through. */
export function buildWithOpaqueSpread(scope: string, extra: { fact: Fact | null }): Ctx {
  const out = { scope, ...extra };
  return out;
}

/** A spread of a LOCAL literal, which the walk can enumerate and therefore should. */
export function buildWithResolvableSpread(scope: string): Ctx {
  const tail = { fact: { value: 1, source: 'recurring' }, ledgerDigest: 'omer:4200;noa:310' };
  const out = { scope, ...tail };
  return out;
}

/** Two returns, two shapes — the early-exit branch must be walked as well as the main one. */
export function buildWithTwoReturns(scope: string, empty: boolean): Ctx {
  if (empty) return { scope, fact: null };
  const out = { scope, fact: { value: 1, source: 'recurring' }, auditTrail: ['omer:4200'] };
  return out;
}

/** Not resolvable to a literal at all — the walk must refuse rather than fall back to the type. */
export function buildOpaqueRoot(scope: string): Ctx {
  let out = { scope, fact: null };
  out = { ...out };
  return out;
}
