import { describe, expect, it } from 'vitest';
import { MODULE_REGISTRY, isModuleVisible } from '../config/moduleRegistry';

describe('MODULE_REGISTRY', () => {
  it('contains exactly the thirteen tabs, in order (Stage 7 T7b adds "forecast", beside the dashboard)', () => {
    expect(MODULE_REGISTRY.map((e) => e.id)).toEqual([
      'dashboard', 'forecast', 'expenses', 'central-expenses', 'investments', 'future', 'annual', 'folder', 'accounts', 'loans', 'net-worth', 'insurances', 'recurring',
    ]);
  });
  it('"dashboard", "accounts", "loans", "net-worth", "insurances", and "recurring" use global filters — every Stage 5 owned-collection/aggregate screen flips this on in the same commit it ships (D7)', () => {
    expect(MODULE_REGISTRY.filter((e) => e.usesGlobalFilters).map((e) => e.id)).toEqual([
      'dashboard', 'forecast', 'accounts', 'loans', 'net-worth', 'insurances', 'recurring',
    ]);
  });

  it("accounts' registry entry is correctly gated and self-filtered (Task 3)", () => {
    const accounts = MODULE_REGISTRY.find((e) => e.id === 'accounts');
    expect(accounts?.permissionModuleId).toBe('accounts');
    expect(accounts?.filterModuleId).toBe('accounts');
    expect(accounts?.usesGlobalFilters).toBe(true);
  });

  it("loans' registry entry is correctly gated and self-filtered (Task 4)", () => {
    const loans = MODULE_REGISTRY.find((e) => e.id === 'loans');
    expect(loans?.permissionModuleId).toBe('loans');
    expect(loans?.filterModuleId).toBe('loans');
    expect(loans?.usesGlobalFilters).toBe(true);
  });

  it("net-worth's registry entry is ungated and unfiltered (D2/D3 — spans three independently-gradable modules)", () => {
    const netWorth = MODULE_REGISTRY.find((e) => e.id === 'net-worth');
    expect(netWorth?.permissionModuleId).toBeNull();
    expect(netWorth?.filterModuleId).toBeNull();
    expect(netWorth?.usesGlobalFilters).toBe(true);
  });

  it("insurances' registry entry is correctly gated and self-filtered (Task 6)", () => {
    const insurances = MODULE_REGISTRY.find((e) => e.id === 'insurances');
    expect(insurances?.permissionModuleId).toBe('insurances');
    expect(insurances?.filterModuleId).toBe('insurances');
    expect(insurances?.usesGlobalFilters).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // STAGE 7 T7b — THE FORECAST TAB
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("!! forecast's entry is UNGATED — net worth's precedent, and every input carries its own gate", () => {
    const forecast = MODULE_REGISTRY.find((e) => e.id === 'forecast');
    expect(forecast?.permissionModuleId).toBeNull();
    // …and the consequence, asserted rather than left implicit: an ungated entry is visible to
    // EVERY role including a child. That is why the entry could not ship in T2 with the ModuleId.
    expect(isModuleVisible(forecast!, 'member', {})).toBe(true);
    expect(isModuleVisible(forecast!, 'member', null)).toBe(true);
  });

  it("!! forecast's filterModuleId is 'expenses', which is LOAD-BEARING for the מי decision", () => {
    // T7b's מי decision re-targets every read at a single selected member. `filterViewableMembers`
    // reads this field to decide which מי chips to offer, so a viewer who cannot read another
    // member's expenses is never offered that member — which is what stops the re-target from
    // becoming a guaranteed dead end.
    const forecast = MODULE_REGISTRY.find((e) => e.id === 'forecast');
    expect(forecast?.filterModuleId).toBe('expenses');
    expect(forecast?.usesGlobalFilters).toBe(true);
  });

  it("!! D31 — the 'future' tab is relabelled, so two tabs do not both promise the future", () => {
    expect(MODULE_REGISTRY.find((e) => e.id === 'future')?.label).toBe('יעדי חיסכון');
    expect(MODULE_REGISTRY.find((e) => e.id === 'forecast')?.label).toBe('תחזית');
  });

  it("recurring's registry entry is correctly gated and self-filtered (Task 7, FINAL)", () => {
    const recurring = MODULE_REGISTRY.find((e) => e.id === 'recurring');
    expect(recurring?.permissionModuleId).toBe('recurring');
    expect(recurring?.filterModuleId).toBe('recurring');
    expect(recurring?.usesGlobalFilters).toBe(true);
  });

  // D2 — every entry must declare which module's permission level drives FilterBar's dead-end
  // filtering while that entry is active; a missing field on a newly-added entry would silently
  // fall back to `undefined`, which memberVisibility.ts must NOT treat the same as an explicit
  // `null` ("offer everyone").
  it('every entry declares filterModuleId (D2) — never left undefined', () => {
    MODULE_REGISTRY.forEach((entry) => {
      expect('filterModuleId' in entry).toBe(true);
    });
  });

  it("dashboard's filterModuleId is 'expenses' — its KPI cards are driven by transaction_lines/expenses data (D2)", () => {
    expect(MODULE_REGISTRY.find((e) => e.id === 'dashboard')?.filterModuleId).toBe('expenses');
  });
});

describe('isModuleVisible', () => {
  const gated = MODULE_REGISTRY.find((e) => e.id === 'expenses')!; // permissionModuleId: 'expenses'
  const ungated = MODULE_REGISTRY.find((e) => e.id === 'dashboard')!; // permissionModuleId: null

  it('an ungated entry is always visible, regardless of role or permissions', () => {
    expect(isModuleVisible(ungated, 'member', null)).toBe(true);
    expect(isModuleVisible(ungated, 'member', {})).toBe(true);
  });
  it('super-admin and parent see a gated entry regardless of resolvedPermissions', () => {
    expect(isModuleVisible(gated, 'super-admin', null)).toBe(true);
    expect(isModuleVisible(gated, 'parent', {})).toBe(true);
  });
  it('a member with no view permission on the module does not see it', () => {
    expect(isModuleVisible(gated, 'member', { expenses: { view: 'none', edit: 'none' } })).toBe(false);
    expect(isModuleVisible(gated, 'member', null)).toBe(false);
    expect(isModuleVisible(gated, 'member', {})).toBe(false);
  });
  it('a member with own/family view permission sees it', () => {
    expect(isModuleVisible(gated, 'member', { expenses: { view: 'own', edit: 'none' } })).toBe(true);
    expect(isModuleVisible(gated, 'member', { expenses: { view: 'family', edit: 'none' } })).toBe(true);
  });
});

// Sun's architecture ruling: MODULE_REGISTRY and App.tsx's renderContent switch are two lists
// keyed by the same id with no tripwire today — a missing case silently falls through to
// `default: <Dashboard/>` with no error. This runtime check is the belt to the compile-time
// exhaustiveness guard added to renderContent itself (Step 5) — the guard proves every id at
// BUILD time, this proves it again at TEST time against the literal known-render-id list so a
// reviewer scanning this file alone (without reading App.tsx) still sees the invariant enforced.
describe('MODULE_REGISTRY / renderContent exhaustiveness (Sun ruling)', () => {
  it('every MODULE_REGISTRY id is a case App.tsx\'s renderContent switch actually handles', () => {
    const KNOWN_RENDER_IDS = ['dashboard', 'forecast', 'expenses', 'central-expenses', 'investments', 'future', 'annual', 'folder', 'accounts', 'loans', 'net-worth', 'insurances', 'recurring', 'permissions'];
    MODULE_REGISTRY.forEach((entry) => expect(KNOWN_RENDER_IDS).toContain(entry.id));
  });
});
