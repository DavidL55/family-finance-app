// src/__tests__/forecastDeepLinks.test.ts — Stage 7 T7b review, F5.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A DEEP LINK THAT LANDS ON AN EMPTY LIST IS NOT A DEEP LINK
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// D26's gap links and D36's drill shipped as BARE TAB SWITCHES. So the family clicked
// `יתרות חשבונות` — a chip rendered inside a sentence explaining that they have no accounts — and
// arrived at a screen with no accounts on it and no form open. Meanwhile `AccountsScreen` and
// `LoansScreen` had consumed a navigation payload since Stage 5 D11, `NetWorthIncompleteNotice` had
// been sending one, and `forecastCopy.ts`'s comment on `balanceGapHe` already claimed T7b "turns
// each named input into its create form". Nothing held that claim.
//
// ── WHAT THIS FILE GUARDS, AND WHY IT IS DERIVED RATHER THAN LISTED ───────────────────────────
//
// `FORECAST_DESTINATIONS_OPENING_CREATE` is a two-element list, and a two-element list in a source
// file is exactly the enumeration guard this stage has counted repeatedly. So the same set is
// DERIVED FROM THE TREE and the two are compared:
//
//   · `App.tsx`'s `case '<tab>': return <Component …/>` gives tab → component, off the AST. That is
//     the app's own routing table, so a screen that is renamed or re-routed moves this set with it.
//   · the component's own imports say whether it reads the payload (`readsOpenCreate`).
//
// Compared in BOTH directions. Under-sending is a link that quietly does nothing; over-sending is a
// payload nobody reads, which is indistinguishable from sending none — a link that LOOKS built.
//
// !! AND IT IS HOW THE UNBUILT HALF GETS BUILT. D36's drill goes to `expenses`, whose screen
// (`ExpensesBreakdown`) has no category filter and reads no payload at all, so the drill is a plain
// tab switch and is recorded as one below rather than pre-filled with an invented destination.
// Giving that v1 screen a filter is a FEATURE, not a review fix. The day it gets one, this guard
// turns red and the drill gets its payload — which is the difference between an omission that is
// owed and an omission that is a comment.
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import * as ts from 'typescript';
import { SRC_ROOT, parseSource, readSourceCached } from './helpers/extractionSurfaces';
import {
  FORECAST_DESTINATIONS_OPENING_CREATE,
  FORECAST_INPUT_DESTINATION,
  forecastGapPayload,
} from '../components/ForecastCard';
import { OPEN_CREATE_PAYLOAD, readsOpenCreate } from '../utils/navigationPayload';

const APP = join(SRC_ROOT, 'App.tsx');

/** `import Name from './components/Name'` → `Name` → the resolved absolute path, for this file. */
function componentImportsIn(fileName: string, source: string): Map<string, string> {
  const sourceFile = parseSource(fileName, source);
  const byLocalName = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('./components/')) continue;
    const clause = statement.importClause;
    if (clause?.name !== undefined) {
      byLocalName.set(clause.name.text, join(SRC_ROOT, `${specifier.slice(2)}.tsx`));
    }
    if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        byLocalName.set(element.name.text, join(SRC_ROOT, `${specifier.slice(2)}.tsx`));
      }
    }
  }
  return byLocalName;
}

/**
 * The app's own routing table, off the AST: `case 'accounts': return <AccountsScreen … />`.
 *
 * The FIRST JSX tag inside the clause, because that is the screen the tab renders; a wrapper would
 * be reported instead, which is the honest answer — a wrapper is what the payload would reach.
 */
function tabToComponentFile(): Map<string, string> {
  const source = readSourceCached(APP);
  const imports = componentImportsIn(APP, source);
  const sourceFile = parseSource(APP, source);
  const byTab = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression)) {
      const tab = node.expression.text;
      let tagName: string | null = null;
      const findTag = (n: ts.Node): void => {
        if (tagName !== null) return;
        if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && ts.isIdentifier(n.tagName)) {
          tagName = n.tagName.text;
          return;
        }
        n.forEachChild(findTag);
      };
      node.forEachChild(findTag);
      const file = tagName === null ? undefined : imports.get(tagName);
      if (file !== undefined) byTab.set(tab, file);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return byTab;
}

/** Whether a screen file imports the payload predicate — i.e. whether it honours `openCreate`. */
function honoursOpenCreate(file: string): boolean {
  const source = readSourceCached(file);
  const sourceFile = parseSource(file, source);
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (clause?.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const element of clause.namedBindings.elements) {
      if (element.name.text === 'readsOpenCreate') return true;
    }
  }
  return false;
}

describe('!! `readsOpenCreate` — the predicate, on synthetic inputs, before anything renders', () => {
  it('accepts the exported payload and nothing else that merely looks like it', () => {
    expect(readsOpenCreate(OPEN_CREATE_PAYLOAD)).toBe(true);
    expect(readsOpenCreate({ openCreate: true, extra: 1 })).toBe(true);
  });

  it('!! rejects every near-miss, because an unread payload is indistinguishable from none', () => {
    // The payload crosses `history.pushState`, so it is serialised and revived — identity does not
    // survive the trip and only the SHAPE does. `'true'` is the one that matters: a string survives
    // JSON perfectly and a truthy check would accept it.
    for (const notAPayload of [undefined, null, false, 0, '', 'openCreate', { openCreate: false }, { openCreate: 'true' }, { prefillCreate: {} }, []]) {
      expect(readsOpenCreate(notAPayload), JSON.stringify(notAPayload ?? null)).toBe(false);
    }
  });

  it('survives a JSON round trip, which is what `pushState` does to it', () => {
    expect(readsOpenCreate(JSON.parse(JSON.stringify(OPEN_CREATE_PAYLOAD)))).toBe(true);
  });
});

describe('!! `forecastGapPayload` sends the payload exactly where a screen reads it', () => {
  it('carries it for `accounts` and `loans`, and NOTHING for the rest', () => {
    expect(forecastGapPayload('accounts')).toBe(OPEN_CREATE_PAYLOAD);
    expect(forecastGapPayload('loans')).toBe(OPEN_CREATE_PAYLOAD);
    for (const bare of ['recurring', 'insurances', 'expenses']) {
      expect(forecastGapPayload(bare), bare).toBeUndefined();
    }
  });

  it('every non-null gap destination is a real tab in `App.tsx`', () => {
    // A destination that no `case` matches is a link to nothing — the defect `incomes: null` exists
    // to avoid, checked for the five that are not null.
    const tabs = tabToComponentFile();
    for (const destination of Object.values(FORECAST_INPUT_DESTINATION)) {
      if (destination === null) continue;
      expect(tabs.has(destination), `no <case '${destination}'> in App.tsx`).toBe(true);
    }
  });
});

describe('!! the list of payload-carrying destinations is DERIVED FROM THE TREE, not trusted', () => {
  it('!! matches exactly the gap destinations whose screen honours `openCreate` — both directions', () => {
    // UNDER-sending is a deep link that quietly does nothing. OVER-sending is a payload nobody
    // reads, which looks identical from the sending side and is how "the drill is built" becomes
    // true in a comment and false on the screen.
    const tabs = tabToComponentFile();
    const derived = [...new Set(Object.values(FORECAST_INPUT_DESTINATION))]
      .filter((destination): destination is string => destination !== null)
      .filter((destination) => {
        const file = tabs.get(destination);
        return file !== undefined && honoursOpenCreate(file);
      })
      .sort();
    expect(derived).toEqual([...FORECAST_DESTINATIONS_OPENING_CREATE].sort());
  });

  it('!! the derivation is NOT vacuous — it finds two, and names them', () => {
    // A derivation that returned `[]` would satisfy the equality above against an empty constant,
    // which is the guard-that-cannot-fail shape this stage has deleted twice.
    const tabs = tabToComponentFile();
    expect(honoursOpenCreate(tabs.get('accounts') as string)).toBe(true);
    expect(honoursOpenCreate(tabs.get('loans') as string)).toBe(true);
  });

  it('!! `expenses` does NOT honour it today — D36`s drill is a tab switch, and this is the pin', () => {
    // `ExpensesBreakdown` is a v1 screen with its own local state, no category filter and no
    // payload consumption at all. Building one is a feature rather than a review fix, so the drill
    // stays a plain tab switch — RECORDED HERE rather than in a comment, so the day that screen
    // learns to open pre-filtered, this line turns red and the drill gets wired.
    const tabs = tabToComponentFile();
    expect(honoursOpenCreate(tabs.get('expenses') as string)).toBe(false);
    expect(FORECAST_INPUT_DESTINATION.history).toBe('expenses');
  });
});
