// Module registry (D6) — the single source of truth for a nav tab's visibility, label, icon,
// and permission gate. It does NOT own screen rendering (App.tsx's `renderContent` switch stays
// hand-written, one line per screen — several screens need per-call-site props this shape can't
// express, e.g. AnnualReport's onNavigateToExpenses callback, PermissionsManager's
// actorMemberId/role) or a `dashboardCards` field (every entry would be `[]` this stage — no
// per-card component exists yet; an always-empty field is the placeholder this plan's quality
// bar forbids). Both are additive, non-breaking additions whenever their first real consumer
// exists — see D6 in docs/superpowers/plans/2026-08-16-stage4-ui-shell.md.
import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard, FolderOpen, Receipt, Compass, TrendingUp, FileText, CalendarDays, Landmark, LineChart, Scale, Shield, Repeat } from 'lucide-react';
import type { ModuleId, ModulePermissionMap, PermissionRole } from '../types/permissions';

// A literal union, not `id: string` — App.tsx's compile-time exhaustiveness guard (Sun's
// architecture ruling) switches on `ModuleRegistryEntry['id']`. If `id` were typed as plain
// `string`, that switch's discriminant would collapse to `string` too and could never narrow to
// `never` no matter how many/few cases were handled — the "guard" would silently accept a missing
// case, exactly the gap it exists to catch. Verified by hand against tsc (see task-3-report.md):
// a `string`-typed id makes the exhaustiveness check a no-op in both directions.
export type ModuleRegistryId =
  | 'dashboard' | 'expenses' | 'central-expenses' | 'investments' | 'future' | 'annual' | 'folder'
  | 'accounts' | 'loans' | 'net-worth' | 'insurances' | 'recurring' // Stage 5 Task 7 — the last new tab
  | 'forecast'; // Stage 7 T7b — see MODULE_REGISTRY's own entry for why it could not land earlier

export interface ModuleRegistryEntry {
  id: ModuleRegistryId; // App.tsx activeTab id
  label: string;
  icon: LucideIcon;
  permissionModuleId: ModuleId | null; // null = ungated (visible to every role)
  usesGlobalFilters: boolean; // D7
  // D2 (Stage 5 Task 2) — which module's `view` level drives FilterBar's dead-end filtering while
  // THIS entry is active (see src/utils/memberVisibility.ts). Required on every entry (never left
  // implicit/undefined) so a newly-added screen can't silently fall through to "unrestricted" by
  // omission. `null` is an explicit, deliberate choice ("offer everyone") for an entry whose data
  // isn't cleanly gated by one single module — matches pre-Stage-4 behavior, not a placeholder.
  filterModuleId: ModuleId | null;
}

export const MODULE_REGISTRY: readonly ModuleRegistryEntry[] = [
  // Dashboard's KPI cards are driven by transaction_lines (the 'expenses' module) — same module
  // Stage 4 originally hardcoded before D2 generalized this field.
  { id: 'dashboard', label: 'לוח תצוגה ראשי', icon: LayoutDashboard, permissionModuleId: null, usesGlobalFilters: true, filterModuleId: 'expenses' },
  // Stage 7 T7b (D31/D25d/A41) — THE FORECAST TAB, and it lands in ONE COMMIT WITH ITS SCREEN.
  //
  // `App.tsx`'s `default` branch ends in `const _exhaustive: never = tab`, so this entry with no
  // matching `case` FAILS `tsc --noEmit`. That is why T2 built `'forecast'` into `ModuleId`,
  // `MODULE_IDS` and `MODULE_LABELS` and deliberately left this line out: the id had to exist for
  // the permission matrix, and the TAB could not exist before the screen did.
  //
  // `permissionModuleId: null` — NET WORTH'S PRECEDENT, and the same argument. The forecast spans
  // eight independently gradable inputs and every one of them carries its own gate inside
  // `useForecast`; a viewer with no grant anywhere still sees the screen, with the calm named-gap
  // state its own hook produces. Gating the TAB on one of the eight would hide a screen that
  // correctly explains why it is empty. Note the consequence, stated rather than discovered: this
  // tab is visible to every role INCLUDING A CHILD, which is exactly why it could not ship early.
  //
  // `filterModuleId: 'expenses'` — the מי control's dead-end filtering follows the module that
  // dominates the forecast's data volume, and it is load-bearing for T7b's מי decision: a single
  // selected member re-targets every read, so `filterViewableMembers` must not offer a chip for a
  // member whose expenses this viewer can never read.
  { id: 'forecast', label: 'תחזית', icon: LineChart, permissionModuleId: null, usesGlobalFilters: true, filterModuleId: 'expenses' },
  { id: 'expenses', label: 'פירוט הוצאות', icon: Receipt, permissionModuleId: 'expenses', usesGlobalFilters: false, filterModuleId: 'expenses' },
  { id: 'central-expenses', label: 'דוח הוצאות מרכז', icon: FileText, permissionModuleId: 'expenses', usesGlobalFilters: false, filterModuleId: 'expenses' },
  { id: 'investments', label: 'תיק השקעות ופנסיה', icon: TrendingUp, permissionModuleId: 'investments', usesGlobalFilters: false, filterModuleId: 'investments' },
  // D31 — RELABELLED by T7b. Two tabs both promising the future is an information-architecture
  // defect the moment a real forecast ships, and the label is only the smallest half of the fix:
  // `FuturePlanning.tsx`'s fake `תחזיות AI לעתיד` panel is deleted in the same commit.
  { id: 'future', label: 'יעדי חיסכון', icon: Compass, permissionModuleId: null, usesGlobalFilters: false, filterModuleId: null },
  { id: 'annual', label: 'דוח שנתי', icon: CalendarDays, permissionModuleId: 'expenses', usesGlobalFilters: false, filterModuleId: 'expenses' },
  { id: 'folder', label: 'תיקייה חודשית', icon: FolderOpen, permissionModuleId: null, usesGlobalFilters: false, filterModuleId: null },
  // Stage 5 Task 3 — the first owned-collection screen. usesGlobalFilters:true from the same
  // commit it ships (Stage 4's D7 rule, restated in the Stage 5 plan's build-order item 5) —
  // never a screen with both a local selector and the global one. filterModuleId matches its own
  // permissionModuleId (a single-module screen, unlike net-worth's later null).
  { id: 'accounts', label: 'חשבונות ויתרות', icon: Landmark, permissionModuleId: 'accounts', usesGlobalFilters: true, filterModuleId: 'accounts' },
  // Stage 5 Task 4 — the second owned-collection screen, built on the same
  // useOwnedCollectionScreen<T> shell Task 3 extracted. Same filterModuleId/permissionModuleId
  // single-module shape as accounts.
  { id: 'loans', label: 'הלוואות וחובות', icon: Scale, permissionModuleId: 'loans', usesGlobalFilters: true, filterModuleId: 'loans' },
  // Stage 5 Task 5 — the dedicated Net Worth screen (D3). Ungated (permissionModuleId: null, per
  // Stage 3 D4 — no single dead-end-filtering module) — its own accounts/loans/investments reads
  // each carry their own permission gate individually (useNetWorth's status), so a viewer with no
  // grant on any of them still sees the screen itself, just with the calm permission-denied state
  // its own hook produces. filterModuleId: null (D2) — net worth spans accounts+investments+loans,
  // each independently gradable, so FilterBar's dead-end filtering offers everyone rather than
  // inventing a composite rule (a selection that turns out inaccessible on a given line surfaces
  // that line's own permission-denied state instead).
  { id: 'net-worth', label: 'שווי נקי', icon: Landmark, permissionModuleId: null, usesGlobalFilters: true, filterModuleId: null },
  // Stage 5 Task 6 — the third owned-collection screen, built on the same
  // useOwnedCollectionScreen<T> shell Task 3 extracted (zero hook changes needed — see
  // task-6-report.md). Same filterModuleId/permissionModuleId single-module shape as
  // accounts/loans.
  { id: 'insurances', label: 'ביטוחים', icon: Shield, permissionModuleId: 'insurances', usesGlobalFilters: true, filterModuleId: 'insurances' },
  // Stage 5 Task 7 (FINAL) — the fourth and last owned-collection screen, built on the same
  // useOwnedCollectionScreen<T> shell Task 3 extracted (zero hook changes needed — see
  // task-7-report.md). Same filterModuleId/permissionModuleId single-module shape as
  // accounts/loans/insurances — this is also the one screen wiring the מה (category) filter
  // dimension (D5), which reads off this same 'recurring' filterModuleId's underlying data.
  { id: 'recurring', label: 'תנועות קבועות', icon: Repeat, permissionModuleId: 'recurring', usesGlobalFilters: true, filterModuleId: 'recurring' },
] as const;

/**
 * Visibility comes from the session's role + resolvedPermissions (claims-driven role, materialized
 * permissions doc) — never a Firestore-readable field alone. An ungated entry (`permissionModuleId
 * === null`) is always visible. super-admin/parent bypass the permission check entirely for a
 * gated entry (matching the Rules layer's own super-admin/parent bypass). A 'member' role needs a
 * non-'none' `view` level on the gated module; missing/null `resolvedPermissions` fails closed
 * (same fail-closed-while-loading posture as the Rules layer itself — deny until proven allowed).
 */
export function isModuleVisible(
  entry: ModuleRegistryEntry,
  role: PermissionRole,
  resolvedPermissions: ModulePermissionMap | null
): boolean {
  if (entry.permissionModuleId === null) return true;
  if (role === 'super-admin' || role === 'parent') return true;
  const level = resolvedPermissions?.[entry.permissionModuleId]?.view ?? 'none';
  return level !== 'none';
}
