import React, { useState, useEffect } from 'react';
import { Menu, X, LogOut, User, Loader2, Shield, ChevronRight } from 'lucide-react';
import { useAuthSession, signOutCurrentUser } from './hooks/useAuthSession';
import { useRecurringCatchup } from './hooks/useRecurringCatchup';
import { useResolvedPermissions } from './hooks/useResolvedPermissions';
import { useNavigation } from './contexts/NavigationContext';
import { FilterProvider } from './contexts/FilterContext';
import { MODULE_REGISTRY, isModuleVisible, type ModuleRegistryEntry } from './config/moduleRegistry';
import { MODULE_IDS, type PermissionLevel } from './types/permissions';
import type { ViewerAccess } from './utils/memberVisibility';
import LoginScreen from './components/LoginScreen';
import { ensureSeeded } from './services/MembersService';
import Dashboard from './components/Dashboard';
import FolderLogic from './components/FolderLogic';
import ExpensesBreakdown from './components/ExpensesBreakdown';
import FuturePlanning from './components/FuturePlanning';
import InvestmentsPortfolio from './components/InvestmentsPortfolio';
import CentralExpenseReport from './components/CentralExpenseReport';
import AnnualReport from './components/AnnualReport';
import SyncButton from './components/SyncButton';
import PermissionsManager from './components/PermissionsManager';
import AccountsScreen from './components/AccountsScreen';
import LoansScreen from './components/LoansScreen';
import FilterBar from './components/FilterBar';
import { FilterActiveBadge } from './components/FilterActiveBadge';

// Nav skeleton (UX review, worth-doing) — while a 'member' session's resolvedPermissions read is
// still in flight, gated tabs fail-closed to hidden (see isModuleVisible), which otherwise reads
// as an empty-then-suddenly-filling nav once the read lands. A generic, label-free placeholder
// (no icon/text tied to any specific module) reserves visual space for "more tabs may appear"
// without revealing which gated modules exist to a member who may end up with no grant on them —
// the skeleton itself must not leak the same information the permission gate exists to hide.
function NavSkeletonItem({ compact = false }: { compact?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={
        compact
          ? 'flex flex-col items-center gap-1 p-2 min-w-[64px] min-h-[44px] justify-center'
          : 'flex items-center gap-3 px-4 py-3 min-h-[44px]'
      }
    >
      <div className={`animate-pulse rounded-full bg-slate-200 ${compact ? 'w-6 h-6' : 'w-5 h-5'}`} />
      {!compact && <div className="animate-pulse h-3 w-20 rounded bg-slate-200" />}
    </div>
  );
}

// Number of MODULE_REGISTRY entries gated behind a permission — the upper bound on how many nav
// slots could still appear once a 'member' session's resolvedPermissions read lands. Computed
// once at module scope since MODULE_REGISTRY is a static constant.
const GATED_MODULE_COUNT = MODULE_REGISTRY.filter((e) => e.permissionModuleId !== null).length;

// TabId mirrors every id renderContent's switch actually handles: every MODULE_REGISTRY id, plus
// the super-admin-only 'permissions' screen that isn't a registry entry (D6 — it's not a nav
// module gated by ModuleId/resolvedPermissions, it's gated directly on role).
type TabId = ModuleRegistryEntry['id'] | 'permissions';

export default function App() {
  const session = useAuthSession();
  const { activeTab, navigateTo, goBack, canGoBack } = useNavigation();
  const permState = useResolvedPermissions(session);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    // Members bootstrap (Stage 1 Task 6, re-gated here for Stage 2): run once per session,
    // before any component mounts, so Dashboard/etc. never race an empty `members` collection
    // against first-run seeding. Gated to super-admin only — firestore.rules now requires
    // isSuperAdmin() for any `members` create/update (Task 5/6), so calling this for a
    // 'parent'/'member' session would only ever produce a permission-denied error, never actually
    // seed anything. A seeding failure must not block the app from rendering — each consumer
    // calls listMembers() independently and renders its own error state if reads keep failing —
    // but it must not be swallowed into a silent no-op either, hence the console.error.
    if (session.status !== 'ready' || session.role !== 'super-admin') return;
    ensureSeeded().catch((err) => console.error('[App] Failed to seed members collection:', err));
  }, [session.status, session.role]);

  // Stage 3 recurring catch-up (spec §11 "תנועות קבועות... נרשמות אוטומטית בתאריך שלהן") — see
  // hooks/useRecurringCatchup.ts for the full rationale (runs for every ready session regardless
  // of role, unlike ensureSeeded above; fire-and-forget with a non-blocking Hebrew failure notice;
  // double-run guarded per memberId). D1: the hook itself resolves session.role +
  // resolvedPermissions.recurring.view into an own/family/none scope and skips entirely on
  // 'none' — this call site just passes the raw level through.
  useRecurringCatchup(session, permState.resolvedPermissions?.recurring?.view);

  if (session.status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <span className="text-sm">טוען...</span>
        </div>
      </div>
    );
  }

  if (session.status === 'signed-out') {
    return <LoginScreen />;
  }

  if (session.status === 'unprovisioned' || session.status === 'error') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-8 w-full max-w-sm text-center space-y-4">
          <p className="text-red-600 font-medium">{session.error}</p>
          <button
            onClick={() => signOutCurrentUser()}
            className="text-sm text-slate-500 underline hover:text-slate-700"
          >
            התנתק ונסה שוב
          </button>
        </div>
      </div>
    );
  }

  // session.status === 'ready' from here on — session.role / session.memberId are non-null.
  // Task 8: super-admin-only "ניהול משפחה והרשאות" tab (PermissionsManager). Gated on
  // `session.role === 'super-admin'` (Firebase Auth custom claims, not any Firestore document) —
  // both here (tab isn't offered / route isn't reachable for other roles) AND again inside
  // PermissionsManager itself (defense in depth per Sasha's review — a future refactor that
  // mounts it from an unguarded call site must still fail closed).
  const isSuperAdmin = session.role === 'super-admin';

  // Dead-end avoidance for FilterBar's מי control (controller ruling, Task 4; generalized to
  // every matrix-governed module by D2, Stage 5 Task 2 — see src/utils/memberVisibility.ts).
  // Computed once here for every ModuleId FilterBar might ever need across the app's screens (not
  // just 'expenses' — five more owned modules gained independently grantable levels in Stage 5),
  // so a screen change never has to re-derive this. super-admin/parent get 'family' (full
  // visibility) on every module, same as isModuleVisible's own bypass; a 'member' falls back to
  // their own resolved <module>.view, defaulting to 'none' while permState is still loading
  // (fail-closed-while-loading, same posture as the nav itself).
  const levelsByModule: Partial<Record<(typeof MODULE_IDS)[number], PermissionLevel>> =
    Object.fromEntries(
      MODULE_IDS.map((moduleId) => [
        moduleId,
        isSuperAdmin || session.role === 'parent'
          ? 'family'
          : (permState.resolvedPermissions?.[moduleId]?.view ?? 'none'),
      ])
    );
  const viewerAccess: ViewerAccess = {
    role: session.role!,
    memberId: session.memberId!,
    levelsByModule,
  };

  // Visibility is claims-driven: role comes from the Firebase Auth ID token (useAuthSession),
  // resolvedPermissions from PermissionsService's materialized doc (useResolvedPermissions) —
  // never a Firestore-readable field a member could edit. super-admin/parent bypass the check
  // entirely (isModuleVisible); a 'member' whose resolvedPermissions read hasn't landed yet sees
  // only ungated tabs (dashboard/future/folder) — the same fail-closed-while-loading posture as
  // the Rules layer itself, not a bug. Gated tabs appear once resolvedPermissions is 'ready'.
  const visibleModules = MODULE_REGISTRY.filter((entry) =>
    isModuleVisible(entry, session.role!, permState.resolvedPermissions)
  );
  const tabs = [
    ...visibleModules.map((m) => ({ id: m.id, label: m.label, icon: m.icon })),
    ...(isSuperAdmin ? [{ id: 'permissions' as const, label: 'ניהול משפחה והרשאות', icon: Shield }] : []),
  ];

  // D7 (Stage 4) — only the registry entries with usesGlobalFilters:true mount FilterBar; D2
  // (Stage 5 Task 2) — the SAME entry supplies the filterModuleId prop, so FilterBar's dead-end
  // filtering reads whichever module actually drives the currently active screen, not a hardcoded
  // one. Computed once and reused by both the render-gate and the prop below.
  const activeModuleEntry = MODULE_REGISTRY.find((m) => m.id === activeTab);

  const isPermLoading = session.role === 'member' && permState.status === 'loading';
  const isPermError = session.role === 'member' && permState.status === 'error';

  const renderContent = () => {
    // Single cast to a local `tab` binding — deliberately NOT `switch (activeTab as TabId)` with
    // a re-cast-to-`never` in `default` (the pattern first drafted from the task brief). Verified
    // by hand against tsc: re-casting a fresh `x as T` expression inside `default` is a bare
    // assertion, not a narrowed reference, so it type-checks as `T` unconditionally regardless of
    // how many cases are handled — it neither catches a missing case nor accepts a complete one.
    // Switching on a single already-typed local (`tab`) lets TS's control-flow narrowing actually
    // exclude each handled literal from `tab`'s type as the switch progresses, so the `default`
    // branch's `const _exhaustive: never = tab;` (a plain reference, no cast) only type-checks
    // when every TabId member has been handled above.
    const tab = activeTab as TabId;

    // Controller ruling (Task 3 review, folded into Task 4): navigateTo(tabId: string) accepts
    // any string, and until this check, renderContent dispatched purely on activeTab with NO
    // isModuleVisible recheck — permission gating existed only on the nav BUTTONS, which is a gap
    // for exactly the callers Stage 8 (insight deep-links) and Stage 10 (guided tours) are
    // designed to be: programmatic navigateTo calls that never go through a nav button at all.
    // Reuses the same `visibleModules` list the nav already computes (no duplicated gating
    // logic). 'permissions' isn't a MODULE_REGISTRY entry — it's gated directly on `isSuperAdmin`
    // in its own switch case below, unaffected by this check.
    if (tab !== 'permissions' && !visibleModules.some((m) => m.id === tab)) {
      return (
        <div className="p-8 text-center text-slate-500" dir="rtl">
          <p>אין לך הרשאה לצפות במסך זה.</p>
        </div>
      );
    }

    switch (tab) {
      case 'dashboard': return <Dashboard />;
      case 'expenses': return <ExpensesBreakdown />;
      case 'central-expenses': return <CentralExpenseReport />;
      case 'investments': return <InvestmentsPortfolio />;
      case 'future': return <FuturePlanning />;
      case 'annual': return (
        <AnnualReport
          onNavigateToExpenses={(month, year, _category) => {
            navigateTo('expenses');
            // ExpensesBreakdown reads its own state; pass via sessionStorage as a simple bridge
            sessionStorage.setItem('expensesFilter', JSON.stringify({ month, year }));
          }}
        />
      );
      case 'folder': return <FolderLogic />;
      case 'accounts': return (
        <AccountsScreen
          session={{ memberId: session.memberId!, role: session.role! }}
          accountsViewLevel={permState.resolvedPermissions?.accounts?.view}
          accountsEditLevel={permState.resolvedPermissions?.accounts?.edit}
        />
      );
      case 'loans': return (
        <LoansScreen
          session={{ memberId: session.memberId!, role: session.role! }}
          loansViewLevel={permState.resolvedPermissions?.loans?.view}
          loansEditLevel={permState.resolvedPermissions?.loans?.edit}
        />
      );
      case 'permissions':
        return isSuperAdmin
          ? <PermissionsManager actorMemberId={session.memberId!} role={session.role!} />
          : <Dashboard />;
      default: {
        // If MODULE_REGISTRY ever grows an id with no matching case above, `tab`'s narrowed type
        // in this branch stops being `never` and `npm run lint` (tsc --noEmit) FAILS TO BUILD —
        // instead of the module silently rendering <Dashboard/> with no error, which is exactly
        // the gap the architecture review flagged. A cast-based guard, not a runtime throw,
        // because a genuinely corrupt `activeTab` value (there is no legitimate way to produce
        // one — it only ever comes from `navigateTo` calls within this same file) shouldn't
        // crash the whole app; it renders a visible, honest error instead of a wrong screen.
        const _exhaustive: never = tab;
        console.error('[App] No render case for module id:', _exhaustive);
        return <div className="p-8 text-center text-red-600">מודול לא ידוע. פנה לתמיכה.</div>;
      }
    }
  };

  const permissionErrorBanner = isPermError && (
    <div className="px-4 py-2 text-xs text-red-600 flex items-center gap-1">
      טעינת הרשאות נכשלה
      <button onClick={permState.retry} className="underline">נסה שוב</button>
    </div>
  );

  return (
    <FilterProvider viewerAccess={viewerAccess}>
    <div className="min-h-screen bg-slate-50 flex flex-col rtl" dir="rtl">

      {/* Top Header (Mobile & Desktop) */}
      <div className="bg-white border-b border-slate-200 p-3 md:p-4 flex items-center justify-between sticky top-0 z-50 w-full">
        <div className="flex items-center gap-2">
          {/* D11 — a header back button wherever canGoBack, for a mouse/desktop user with no OS
              back gesture. RTL — "back" points right (ChevronRight), matching FilterBar's own
              month-navigation arrow convention. */}
          {canGoBack && (
            <button
              onClick={goBack}
              aria-label="חזרה"
              data-tour-id="nav.back"
              className="p-2 -ms-2 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
          <div className="w-8 h-8 md:w-10 md:h-10 bg-blue-600 rounded-lg md:rounded-xl flex items-center justify-center text-white font-bold text-lg md:text-xl shadow-sm">
            ₪
          </div>
          <span className="font-bold text-slate-800 text-sm md:text-xl">תקציב משפחתי</span>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
            <User className="w-4 h-4 text-indigo-500" />
            <span className="text-xs font-bold text-slate-700">משפחת לוי</span>
          </div>
          <SyncButton />
          {/* Ofra ruling I4 — visible on EVERY screen (lives in the header, outside FilterBar's
              conditional per-screen mount below), so the persisted-but-invisible D7 half-state
              (filters survive in sessionStorage but only Dashboard renders FilterBar) stops being
              a silent surprise. */}
          <FilterActiveBadge />
          <button
            onClick={() => signOutCurrentUser()}
            className="p-2 text-slate-500 hover:text-red-600 transition-colors"
            title="התנתק"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* D7 — only the registry entries with usesGlobalFilters:true mount FilterBar (this stage:
          dashboard only). Every other screen keeps its own pre-existing local selectors. D2 —
          filterModuleId travels with it, from the same registry entry. */}
      {activeModuleEntry?.usesGlobalFilters && <FilterBar filterModuleId={activeModuleEntry.filterModuleId} />}

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar (Desktop Only) */}
        <aside className="hidden md:flex flex-col w-64 bg-white border-l border-slate-200 sticky top-[73px] h-[calc(100vh-73px)]">
          <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  data-tour-id={`nav.${tab.id}`}
                  onClick={() => navigateTo(tab.id)}
                  className={`
                    w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200
                    ${isActive
                      ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-100'
                      : 'text-slate-600 hover:bg-slate-50'
                    }
                  `}
                >
                  <Icon className={`w-5 h-5 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span className="text-sm">{tab.label}</span>
                </button>
              );
            })}
            {isPermLoading && Array.from({ length: GATED_MODULE_COUNT }).map((_, i) => (
              <NavSkeletonItem key={`nav-skeleton-${i}`} />
            ))}
          </nav>
          {permissionErrorBanner}
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
          <div className="max-w-5xl mx-auto p-4 md:p-8">
            {renderContent()}
          </div>
        </main>

        {/* Bottom Navigation (Mobile Only) */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2 py-1 z-50">
          <div className="flex justify-around items-center max-w-md mx-auto">
            {tabs.slice(0, 5).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  data-tour-id={`nav.${tab.id}`}
                  onClick={() => navigateTo(tab.id)}
                  className={`
                    flex flex-col items-center gap-1 p-2 min-w-[64px] transition-colors
                    ${isActive ? 'text-blue-600' : 'text-slate-400'}
                  `}
                >
                  <Icon className={`w-6 h-6 ${isActive ? 'scale-110' : ''} transition-transform`} />
                  <span className="text-[10px] font-medium leading-tight text-center">{tab.label.split(' ')[0]}</span>
                </button>
              );
            })}
            {isPermLoading && Array.from({ length: Math.max(0, Math.min(GATED_MODULE_COUNT, 5 - tabs.length)) }).map((_, i) => (
              <NavSkeletonItem key={`nav-skeleton-mobile-${i}`} compact />
            ))}
            {/* More menu button for mobile if more than 5 tabs */}
            {tabs.length > 5 && (
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className={`flex flex-col items-center gap-1 p-2 min-w-[64px] text-slate-400`}
              >
                <Menu className="w-6 h-6" />
                <span className="text-[10px] font-medium">עוד</span>
              </button>
            )}
          </div>
        </div>

        {/* Mobile More Tabs Drawer */}
        {isMobileMenuOpen && (
          <div className="fixed inset-0 z-[60] md:hidden">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />
            <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl p-6 shadow-xl animate-in slide-in-from-bottom duration-300">
              <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto mb-6" />
              <h3 className="text-lg font-bold text-slate-800 mb-4 text-center">תפריט נוסף</h3>
              <div className="grid grid-cols-2 gap-4">
                {tabs.slice(5).map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      data-tour-id={`nav.${tab.id}`}
                      onClick={() => {
                        navigateTo(tab.id);
                        setIsMobileMenuOpen(false);
                      }}
                      className={`
                        flex items-center gap-3 p-4 rounded-xl border transition-all
                        ${isActive ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-slate-50 border-slate-100 text-slate-600'}
                      `}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="font-medium">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
              {permissionErrorBanner}
            </div>
          </div>
        )}
      </div>
    </div>
    </FilterProvider>
  );
}
