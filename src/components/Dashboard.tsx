import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { generateFinancialInsights, getFinancialChatSession } from '../services/ai';
import { TrendingUp, TrendingDown, Wallet, Lightbulb, Banknote, Target, MessageSquare, Send, Bot, User as UserIcon, CalendarDays, Pencil, Plus, Trash2, X, Landmark, Shield, Bitcoin, Home, PiggyBank, Settings, Scale, AlertTriangle } from 'lucide-react';
import FamilyManagerModal from './FamilyManagerModal';
import { db } from '../services/firebase';
import { saveMembers, StaleMembersError } from '../services/MembersService';
import { useNotification } from '../contexts/NotificationContext';
import { useGlobalFilters } from '../contexts/FilterContext';
import { useNavigation } from '../contexts/NavigationContext';
import { MODULE_REGISTRY } from '../config/moduleRegistry';
import { resolveEcosystemKey, resolveMemberSelectionNames } from '../utils/resolveMemberSelection';
import type { Member } from '../utils/seedFromBudgetConfig';
import { Explain } from './Explain';
import { DrillAffordance } from './DrillAffordance';
import { ComparisonTable, type ComparisonRow } from './ComparisonTable';
import { matchesMonthYear, isExpenseRow } from '../utils/transactionFilters';
import {
  collection, query, onSnapshot, where,
  getDocs, addDoc, deleteDoc, doc, setDoc, getDoc, serverTimestamp
} from 'firebase/firestore';

// ── Types ────────────────────────────────────────────────────────────────────

interface IncomeEntry {
  firestoreId?: string;
  id: number;
  name: string;
  amount: number;
  date: string;
}

interface BudgetCategory {
  name: string;
  budget: number;
  actual: number;
}

interface EcosystemData {
  liquid: number;
  investments: number;
  pensions: number;
  crypto: number;
  realEstate: number;
  mortgage: number;
}

interface ChatSession {
  sendMessage: (opts: { message: string }) => Promise<{ text: string }>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_ECOSYSTEM: EcosystemData = {
  liquid: 0, investments: 0, pensions: 0, crypto: 0, realEstate: 0, mortgage: 0
};

const MONTHS = [
  { value: '01', label: 'ינואר' }, { value: '02', label: 'פברואר' }, { value: '03', label: 'מרץ' },
  { value: '04', label: 'אפריל' }, { value: '05', label: 'מאי' }, { value: '06', label: 'יוני' },
  { value: '07', label: 'יולי' }, { value: '08', label: 'אוגוסט' }, { value: '09', label: 'ספטמבר' },
  { value: '10', label: 'אוקטובר' }, { value: '11', label: 'נובמבר' }, { value: '12', label: 'דצמבר' }
];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

// A calm, consistent "you don't have access" message reused across every card this component can
// deny (ecosystem/net-worth, budget-vs-actual, category breakdown, and the KPI cards derived from
// either) — S2 ruling: never the red error banner, never a silent ₪0, for a permission-denied
// refusal specifically (distinct from a genuine connectivity failure, which keeps its own
// specific red-banner copy per card below).
const ACCESS_DENIED_MESSAGE = 'אין לך הרשאה לצפות בנתון זה';

// D12 (Stage 5 Task 2) — a drill-down destination not yet wired onto the global filter bar
// (usesGlobalFilters: false) must say so on arrival, rather than silently dropping the מי
// selection the viewer just set. Shown via NotificationContext's new 'info' type (calm, not an
// error) — see drillDownTo below.
const FILTER_NOT_APPLIED_MESSAGE = 'הפילטור לא חל כאן עדיין — מסך זה עדיין לא מחובר לסינון הגלובלי.';

// Firestore's client SDK throws a FirebaseError with a `code` field, but catch variables aren't
// typed as `unknown` project-wide (strict mode isn't enabled in tsconfig.json) — this narrows the
// permission-denied check honestly wherever a catch block is typed `unknown` explicitly, without
// widening the whole file to strict mode just for this.
function isPermissionDenied(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'permission-denied';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { addNotification } = useNotification();
  const { navigateTo } = useNavigation();
  const { filters, familyMembers: familyMembersState, groups: groupsState } = useGlobalFilters();

  // D8 — spec §5.1 drill-down: every headline number is a button that opens the cluster behind
  // it. D12 — a destination not yet rewired onto FilterContext (usesGlobalFilters: false) shows a
  // one-time arrival notice instead of silently dropping the מי selection the viewer just set.
  const drillDownTo = (moduleId: string): void => {
    const entry = MODULE_REGISTRY.find((m) => m.id === moduleId);
    if (entry && !entry.usesGlobalFilters) {
      addNotification('info', FILTER_NOT_APPLIED_MESSAGE);
    }
    navigateTo(moduleId);
  };
  const selectedMonth = filters.period.month;
  const selectedYear = filters.period.year;
  // D8 — settings/ecosystem and settings/budgetConfig are legacy single-key-per-member documents
  // that do not support multi-member summing this stage; resolveEcosystemKey falls back to 'all'
  // for anything but exactly one specific member selected (mode 'all', a group, or 2+ members).
  const ecosystemKey = resolveEcosystemKey(filters.member);
  // Memoized: resolveMemberSelectionNames returns a brand-new Set instance on every call. Without
  // memoizing it here, loadBudget's effect below (which depends on this value) would re-run on
  // EVERY render — including renders triggered by loadBudget's own setState calls — an unbounded
  // refetch loop. filters.member (not the whole `filters` object) is the correct dependency: the
  // FilterContext spread-preserves unrelated fields on every setPeriod/setCategoryFilter call, so
  // filters.member's reference only changes when the מי selection itself actually changes.
  const selectedMemberNames = useMemo(
    () => resolveMemberSelectionNames(
      filters.member,
      familyMembersState.members,
      groupsState.status === 'ready' ? groupsState.groups : []
    ),
    [filters.member, familyMembersState.members, groupsState.status, groupsState.groups]
  );

  // M2 — the shared members/groups fetch now lives in FilterContext (Task 4), consumed by both
  // FilterBar and Dashboard; Dashboard no longer mounts its own listMembers() effect (one fetch
  // per app, not two). The local override below exists ONLY for FamilyManagerModal's
  // optimistic-update/rollback flow — the shared hook's `members` array is otherwise read-only
  // from Dashboard's point of view, since other consumers (FilterBar) read it too. Typed
  // `Member[]` (not FamilyManagerModal's narrower `FamilyMember`) so the ComparisonTable's
  // per-owner `color` lookup below stays type-safe.
  const [membersOverride, setMembersOverride] = useState<Member[] | null>(null);
  // Cleared automatically once the SHARED fetch produces a fresh array (e.g. after a successful
  // familyMembersState.reload()) — the optimistic view never goes stale once the real data
  // catches up. Note this only fires on a reference change to `.members` itself; a failed reload
  // (which never touches `members`, per useFamilyMembers' own carry-forward-on-error rule) does
  // NOT clear the override on its own — the onSave handler below clears it explicitly on failure
  // instead, deliberately, so the shared hook's own error status can take over the gate (see that
  // handler's comment).
  useEffect(() => {
    setMembersOverride(null);
  }, [familyMembersState.members]);
  const familyMembers = membersOverride ?? familyMembersState.members;
  // Distinguishes "the members read failed" from "the members collection is genuinely empty" —
  // a failed read must render an explicit error state and must NEVER fall back to a default/empty
  // member list (Global Constraints). Reuses Dashboard's own existing, well-tested Hebrew copy
  // rather than passing through the shared hook's generic `familyMembersState.error` (which just
  // carries `err.message` verbatim and may not be Hebrew or user-friendly) — consistent with how
  // FilterBar's own מי/מה sections never surface a raw error string either, always a fixed label.
  const familyMembersError =
    membersOverride === null && familyMembersState.status === 'error'
      ? 'טעינת בני המשפחה נכשלה. בדוק את החיבור ונסה שוב.'
      : null;
  const [isFamilyModalOpen, setIsFamilyModalOpen] = useState(false);

  // ── Income state ──────────────────────────────────────────────────────────
  const [incomes, setIncomes] = useState<IncomeEntry[]>([]);
  // S3 (security investigation gap): the onSnapshot error callback below previously only
  // console.error'd, leaving totalIncome silently ₪0 — indistinguishable from a genuinely
  // income-free month. A 'member'-role session with no expenses grant legitimately gets
  // permission-denied here (transaction_lines/incomes are denied wholesale for a viewer without
  // the matching family-level grant, confirmed by the Sasha security investigation) — that is a
  // real, common case for Dashboard specifically, since it is the one always-visible,
  // permission-ungated screen every role lands on.
  const [incomesLoadError, setIncomesLoadError] = useState<string | null>(null);
  const [incomesAccessDenied, setIncomesAccessDenied] = useState(false);
  const [isEditingIncomes, setIsEditingIncomes] = useState(false);
  const [editingIncomesList, setEditingIncomesList] = useState<IncomeEntry[]>([]);

  // ── Budget / Ecosystem state ───────────────────────────────────────────────
  const [budgetVsActual, setBudgetVsActual] = useState<BudgetCategory[]>([]);
  const [categories, setCategories] = useState<{ name: string; value: number }[]>([]);
  const [ecosystem, setEcosystem] = useState<EcosystemData>(EMPTY_ECOSYSTEM);
  const [budgetLoadError, setBudgetLoadError] = useState<string | null>(null);
  const [budgetAccessDenied, setBudgetAccessDenied] = useState(false);
  const [ecosystemLoadError, setEcosystemLoadError] = useState<string | null>(null);
  const [ecosystemAccessDenied, setEcosystemAccessDenied] = useState(false);

  // ── Settlement state ──────────────────────────────────────────────────────
  const [settlementData, setSettlementData] = useState<{ name: string; paid: number; target: number }[]>([]);
  const [settlementLoadError, setSettlementLoadError] = useState<string | null>(null);
  const [settlementAccessDenied, setSettlementAccessDenied] = useState(false);

  // ── Chat / Insights state ─────────────────────────────────────────────────
  const [insights, setInsights] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([
    { role: 'model', text: 'שלום! אני היועץ הפיננסי הווירטואלי שלכם. קראתי את כל הנתונים הפיננסיים. איך אוכל לעזור לכם היום?' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Load incomes (real-time) ───────────────────────────────────────────────
  useEffect(() => {
    const q = query(
      collection(db, 'incomes'),
      where('month', '==', selectedMonth),
      where('year', '==', selectedYear)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entries: IncomeEntry[] = snapshot.docs.map((d, idx) => ({
        firestoreId: d.id,
        id: idx + 1,
        name: d.data().name as string,
        amount: d.data().amount as number,
        date: d.data().date as string,
      }));
      setIncomes(entries);
      setIncomesLoadError(null);
      setIncomesAccessDenied(false);
    }, (err: any) => {
      console.error('Failed to load incomes:', err);
      if (err?.code === 'permission-denied') {
        setIncomesAccessDenied(true);
      } else {
        setIncomesLoadError('טעינת ההכנסות נכשלה. בדוק את החיבור ונסה שוב.');
      }
    });

    return () => unsubscribe();
  }, [selectedMonth, selectedYear]);

  // ── Load ecosystem ─────────────────────────────────────────────────────────
  useEffect(() => {
    const loadEcosystem = async () => {
      setEcosystemLoadError(null);
      setEcosystemAccessDenied(false);
      try {
        const snap = await getDoc(doc(db, 'settings', 'ecosystem'));
        if (snap.exists()) {
          const data = snap.data();
          const memberData = (data[ecosystemKey] ?? data['all'] ?? EMPTY_ECOSYSTEM) as EcosystemData;
          setEcosystem(memberData);
        } else {
          // A genuinely missing doc is a legitimate empty state, not an error.
          setEcosystem(EMPTY_ECOSYSTEM);
        }
      } catch (err: unknown) {
        if (isPermissionDenied(err)) {
          // Expected for a 'member'-role session after commit 60d1c32 (settings/ecosystem is now
          // super-admin/parent-only) — a genuine "you don't have access" case, not a connectivity
          // failure. Never a silent ₪0, never the red error banner.
          setEcosystemAccessDenied(true);
        } else {
          // Carry-forward fix (Stage 1 Task 6a / Task 5 review): a failed read must render an
          // error, never silently reset to EMPTY_ECOSYSTEM — that would show "₪0 everywhere"
          // indistinguishable from a genuinely empty household. Deliberately does NOT call
          // setEcosystem here.
          console.error('Failed to load ecosystem:', err);
          setEcosystemLoadError('טעינת נתוני הנכסים נכשלה. בדוק את החיבור ונסה שוב.');
        }
      }
    };
    loadEcosystem();
  }, [ecosystemKey]);

  // ── Load budget config + compute actuals from transaction_lines ────────────
  useEffect(() => {
    const loadBudget = async () => {
      setBudgetLoadError(null);
      setBudgetAccessDenied(false);
      try {
        const budgetSnap = await getDoc(doc(db, 'settings', 'budgetConfig'));
        const budgetMap: Record<string, number> = {};

        if (budgetSnap.exists()) {
          const data = budgetSnap.data();
          const memberBudget = (data[ecosystemKey] ?? data['all'] ?? []) as { name: string; budget: number }[];
          memberBudget.forEach(b => { budgetMap[b.name] = b.budget; });
        }

        // Aggregate actuals from transaction_lines — the single canonical collection
        // (Task 5). It now holds both natively-written rows (YYYY-MM-DD dates) and
        // migrated legacy rows, which kept their original date/category formatting
        // verbatim, so both date formats and the pre-mapping category name must still
        // be handled here, matching what the removed legacy-collection block did.
        const actuals: Record<string, number> = {};

        const tlSnap = await getDocs(collection(db, 'transaction_lines'));

        tlSnap.docs.forEach(d => {
          const data = d.data();
          if (!isExpenseRow(data)) return;
          // selectedMemberNames (resolveMemberSelectionNames) replaces the old single-id
          // filterOwnerName lookup — supports the full מי multi-select/group selection, not just
          // a single member (this is a plain Set<string> owner-name filter over real rows, no
          // data-shape limitation the way settings/ecosystem's D8 fallback has).
          if (selectedMemberNames && data.owner && !selectedMemberNames.has(data.owner)) return;
          if (!matchesMonthYear(data.date, selectedMonth, selectedYear)) return;

          const cat: string = data.category ?? 'שונות';
          // M1 — the מה/category filter was state-only before this fix; wiring it here is the
          // one-line change the "what-did-we-miss" review flagged as missing from an already-open
          // loop. Empty categories array = no category filter (show everything).
          if (filters.category.categories.length > 0 && !filters.category.categories.includes(cat)) return;
          actuals[cat] = (actuals[cat] ?? 0) + ((data.amount as number) ?? 0);
        });

        // Merge budget categories with actuals
        const allNames = Array.from(new Set([...Object.keys(budgetMap), ...Object.keys(actuals)]));
        const merged: BudgetCategory[] = allNames
          .map(name => ({ name, budget: budgetMap[name] ?? 0, actual: actuals[name] ?? 0 }))
          .filter(c => c.budget > 0 || c.actual > 0);

        setBudgetVsActual(merged);

        // Pie chart: top categories by actual spend
        const pieData = Object.entries(actuals)
          .map(([name, value]) => ({ name, value }))
          .filter(c => c.value > 0)
          .sort((a, b) => b.value - a.value)
          .slice(0, 6);
        setCategories(pieData);

      } catch (err: unknown) {
        if (isPermissionDenied(err)) {
          // The budgetConfig read (first line of this try block) is what throws for a
          // 'member'-role session post-60d1c32 — execution never reaches the transaction_lines
          // read, so the whole budget-vs-actual card is access-denied this render, not just the
          // target half (disclosed in this task's report — a finer split is Stage 5+ work, out of
          // this shell plan's scope).
          setBudgetAccessDenied(true);
        } else {
          // A failed read must render as an error state, not an empty one — do NOT
          // reset budgetVsActual/categories here. The explicit budgetLoadError flag
          // lets the render branch distinguish "no data this month" from "the query
          // failed".
          console.error('Failed to load budget:', err);
          setBudgetLoadError('טעינת נתוני התקציב נכשלה. בדוק את החיבור ונסה שוב.');
        }
      }
    };
    loadBudget();
    // NOTE: `familyMembers` is deliberately NOT a dependency here — the effect body no longer
    // reads it (the old single-id filterOwnerName lookup was replaced by selectedMemberNames,
    // which already depends on familyMembersState.members via the memoized selector above).
    // Including it would refetch on every FamilyManagerModal optimistic-update tick for no
    // behavioral benefit.
  }, [selectedMonth, selectedYear, ecosystemKey, selectedMemberNames, filters.category.categories]);

  // ── Settlement: who paid what this month ──────────────────────────────────
  useEffect(() => {
    const loadSettlement = async () => {
      setSettlementLoadError(null);
      setSettlementAccessDenied(false);
      try {
        // familyMembers (state, loaded from the `members` collection above) is now the single
        // source of truth for the member list — no separate settings/budgetConfig read needed.
        // Settlement is only between adults (הורה), not children.
        let adultNames = familyMembers
          .filter(m => m.role !== 'ילד')
          .map(m => m.name);

        // transaction_lines is the single canonical collection (Task 5) — reused below
        // for both the owner-derivation fallback and the paid-per-owner computation.
        const tlSnap = await getDocs(collection(db, 'transaction_lines'));

        // If no configured members, derive from owners across all transaction_lines
        if (adultNames.length === 0) {
          const ownerSet = new Set<string>();
          tlSnap.docs.forEach(d => {
            const data = d.data();
            if (data.owner && !data.isCredit) ownerSet.add(data.owner);
          });
          adultNames = Array.from(ownerSet);
        }

        if (adultNames.length === 0) return;

        const paid: Record<string, number> = {};
        adultNames.forEach(n => { paid[n] = 0; });

        const prefix = `${selectedYear}-${selectedMonth}`;

        tlSnap.docs.forEach(d => {
          const data = d.data();
          if (data.isCredit) return;
          const date: string = data.date ?? '';
          const isThisMonth = date.startsWith(prefix) ||
            (date.includes('/') && date.split('/')[1] === selectedMonth && date.split('/')[2]?.startsWith(selectedYear));
          if (!isThisMonth) return;
          const owner: string = data.owner ?? '';
          if (paid[owner] !== undefined) paid[owner] += (data.amount ?? 0);
        });

        const SETTLEMENT_TARGET = 7000;
        setSettlementData(adultNames.map(name => ({ name, paid: paid[name] ?? 0, target: SETTLEMENT_TARGET })));
      } catch (err: unknown) {
        if (isPermissionDenied(err)) {
          // transaction_lines is denied WHOLESALE for a member without an expenses grant (same
          // rule loadBudget's transaction_lines read above already handles) — a genuine "you
          // don't have access" case, not a connectivity failure. Never the red error banner,
          // never a silent "אין נתונים להשוואה." that's indistinguishable from a genuinely quiet
          // household (closing review fix — this is exactly the silent-empty-on-denial violation
          // this stage exists to eliminate, on the D9 comparison card this stage itself added).
          setSettlementAccessDenied(true);
        } else {
          // A failed read must render as an error state, not an empty one — do NOT
          // reset settlementData here. The explicit settlementLoadError flag lets the
          // render branch distinguish "fewer than two adults configured" (nothing to
          // settle) from "the query failed".
          console.error('[Dashboard] Settlement load error:', err);
          setSettlementLoadError('טעינת נתוני ההתחשבנות נכשלה. בדוק את החיבור ונסה שוב.');
        }
      }
    };
    loadSettlement();
  }, [selectedMonth, selectedYear, familyMembers]);

  // ── AI Insights ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function fetchInsights() {
      setLoading(true);
      try {
        const res = await generateFinancialInsights({
          income: incomes,
          budgetVsActual,
          categories,
          ecosystem
        });
        setInsights(res);
      } catch (err) {
        console.error('Failed to fetch insights:', err);
        setInsights(['לא ניתן לטעון תובנות כעת.']);
      } finally {
        setLoading(false);
      }
    }
    fetchInsights();

    const session = getFinancialChatSession({
      income: incomes,
      budgetVsActual,
      categories,
      ecosystem
    });
    if (session) {
      setChatSession(session as ChatSession);
    }
    // filters.member replaces the old selectedMember dependency — its body never referenced
    // selectedMember directly, it was only a re-trigger dependency; filters.member preserves the
    // same "re-run when the מי selection changes" trigger.
  }, [filters.member, incomes]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // ── Income CRUD ────────────────────────────────────────────────────────────
  const handleSaveIncomes = async () => {
    try {
      const toDelete = incomes.filter(e => e.firestoreId && !editingIncomesList.some(ed => ed.firestoreId === e.firestoreId));
      const toAdd = editingIncomesList.filter(e => !e.firestoreId);
      const toUpdate = editingIncomesList.filter(e => e.firestoreId);

      await Promise.all(toDelete.map(e => deleteDoc(doc(db, 'incomes', e.firestoreId!))));
      await Promise.all(toUpdate.map(e =>
        setDoc(doc(db, 'incomes', e.firestoreId!), {
          name: e.name,
          amount: e.amount,
          date: e.date,
          month: selectedMonth,
          year: selectedYear,
          updated_at: serverTimestamp(),
        }, { merge: true })
      ));
      await Promise.all(toAdd.map(e =>
        addDoc(collection(db, 'incomes'), {
          name: e.name,
          amount: e.amount,
          date: e.date,
          month: selectedMonth,
          year: selectedYear,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        })
      ));

      setIsEditingIncomes(false);
    } catch (err) {
      console.error('Failed to save incomes:', err);
    }
  };

  const handleAddIncome = () => {
    const newId = Math.max(0, ...editingIncomesList.map(i => i.id)) + 1;
    setEditingIncomesList([
      ...editingIncomesList,
      { id: newId, name: 'הכנסה חדשה', amount: 0, date: `01/${selectedMonth}/${selectedYear}` }
    ]);
  };

  const handleUpdateIncome = (id: number, field: string, value: string | number) => {
    setEditingIncomesList(editingIncomesList.map(item =>
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  const handleRemoveIncome = (id: number) => {
    setEditingIncomesList(editingIncomesList.filter(item => item.id !== id));
  };

  // ── Chat ───────────────────────────────────────────────────────────────────
  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim() || !chatSession) return;

    const userMsg = inputValue;
    setInputValue('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsTyping(true);

    try {
      const response = await chatSession.sendMessage({ message: userMsg });
      setMessages(prev => [...prev, { role: 'model', text: response.text }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'model', text: 'מצטער, חלה שגיאה בתקשורת. אנא נסה שוב.' }]);
    } finally {
      setIsTyping(false);
    }
  };

  // ── Derived totals ─────────────────────────────────────────────────────────
  const totalIncome = incomes.reduce((sum, item) => sum + item.amount, 0);
  const totalExpenses = budgetVsActual.reduce((sum, item) => sum + item.actual, 0);
  const totalBudget = budgetVsActual.reduce((sum, item) => sum + item.budget, 0);
  const balance = totalIncome - totalExpenses;

  const totalAssets = ecosystem.liquid + ecosystem.investments + ecosystem.pensions + ecosystem.crypto + ecosystem.realEstate;
  const totalLiabilities = ecosystem.mortgage;
  const netWorth = totalAssets - totalLiabilities;

  const currentMonthLabel = MONTHS.find(m => m.value === selectedMonth)?.label || '';
  const selectedMemberLabel =
    filters.member.mode === 'members' && filters.member.memberIds.length === 1
      ? familyMembers.find((m) => m.id === filters.member.memberIds[0])?.name ?? null
      : filters.member.mode === 'members' && filters.member.memberIds.length > 1
      ? `${filters.member.memberIds.length} נבחרו`
      : filters.member.mode === 'group' && groupsState.status === 'ready'
      ? groupsState.groups.find((g) => g.id === filters.member.groupId)?.name ?? null
      : null;

  // D8 (Ofra ruling B1) — resolveEcosystemKey falls back to 'all' for any 2+-member or group
  // selection; the ecosystem/net-worth cards must disclose that they're showing household-wide
  // figures rather than silently describing someone other than who's selected.
  const showEcosystemAllFallbackNote = ecosystemKey === 'all' && filters.member.mode !== 'all';

  // D9 — "מי הוציא כמה החודש" (ComparisonTable) is fed directly by loadSettlement's existing
  // per-owner settlementData, not a new aggregation — no new Firestore read. Recomputed on
  // render, not memoized, matching Dashboard's existing style for its other small derived arrays
  // (categories/pieData were never memoized either).
  const comparisonRows: ComparisonRow[] = settlementData.map((s) => ({
    memberId: familyMembers.find((m) => m.name === s.name)?.id ?? s.name,
    name: s.name,
    color: familyMembers.find((m) => m.name === s.name)?.color ?? '#94a3b8',
    value: s.paid,
  }));

  // S3 — KPI-card access/error helpers. "יתרה חודשית" (balance) combines both the income and
  // budget reads, so it reflects whichever of the two is currently blocked/failed rather than
  // silently picking a winner — both underlying messages are real and either is informative
  // enough for a compact KPI card.
  const balanceAccessDenied = incomesAccessDenied || budgetAccessDenied;
  const balanceLoadError = incomesLoadError ?? budgetLoadError;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="bg-white p-3 md:p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col lg:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 w-full lg:w-auto">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg shrink-0">
            <CalendarDays className="w-5 h-5 md:w-6 md:h-6" />
          </div>
          <div className="truncate">
            <h1 className="text-lg md:text-xl font-bold text-slate-800 truncate">לוח תצוגה - {currentMonthLabel} {selectedYear}</h1>
            <p className="text-[10px] md:text-sm text-slate-500">אקוסיסטם פיננסי משפחתי</p>
          </div>
        </div>

        {/* Member/date selection now lives in the global FilterBar (D7) — this button is the one
            piece that stays put: it's a management entry point, not a filter control. */}
        <div className="flex items-center gap-2 w-full lg:w-auto justify-end">
          <button
            onClick={() => setIsFamilyModalOpen(true)}
            disabled={!!familyMembersError}
            // The manage-members entry point must never be reachable while familyMembersError
            // is set — opening it would render FamilyManagerModal with members=[] and falsely
            // claim "no family members configured", which is how a stale/empty edit can wipe
            // out real Firestore data on save (see MembersService.saveMembers's basedOnIds
            // guard for the second, service-layer line of defense against the same defect).
            className={`p-2.5 rounded-xl border shadow-sm transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center ${
              familyMembersError
                ? 'text-slate-300 bg-slate-50 border-slate-200 cursor-not-allowed'
                : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border-slate-200 bg-white'
            }`}
            title={
              familyMembersError
                ? 'ניהול בני משפחה — טעינת הרשימה נכשלה, לא ניתן לערוך כעת'
                : 'ניהול בני משפחה'
            }
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Net Worth & Ecosystem Summary — three-way branch: access-denied (calm message, S2) vs.
          a genuine load failure (red banner, carry-forward — never resets ecosystem to zero) vs.
          the real tiles. */}
      {ecosystemAccessDenied ? (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-slate-500 text-sm">
          {ACCESS_DENIED_MESSAGE}
        </div>
      ) : ecosystemLoadError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
          <p className="text-red-600 font-medium">{ecosystemLoadError}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-indigo-600 to-blue-700 p-5 md:p-6 rounded-2xl shadow-md text-white flex flex-col justify-between">
              <div className="flex items-center justify-between mb-4">
                {/* Explain's own root is a <div> (for its popover) — kept as a sibling of the
                    <h2>, not nested inside it, since a <div> is not valid heading content and
                    browsers will silently mis-parse/auto-close a <p>/<h*> around one. */}
                <div className="flex items-center gap-1.5">
                  <h2 className="text-base md:text-lg font-medium text-indigo-100">שווי נקי (Net Worth)</h2>
                  <Explain id="dashboard.netWorth" />
                </div>
                <Landmark className="w-5 h-5 md:w-6 md:h-6 text-indigo-200" />
              </div>
              <div>
                <p className="text-3xl md:text-4xl font-bold mb-1">₪{netWorth.toLocaleString()}</p>
                <div className="flex flex-wrap items-center gap-2 text-[10px] md:text-sm text-indigo-100">
                  <span className="bg-white/20 px-2 py-0.5 rounded-md">נכסים: ₪{totalAssets.toLocaleString()}</span>
                  <span className="bg-black/10 px-2 py-0.5 rounded-md">חובות: ₪{totalLiabilities.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-slate-100 lg:col-span-2">
              <h2 className="text-base md:text-lg font-bold text-slate-800 mb-4">התגלגלות נכסים</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div className="flex flex-col items-center justify-center p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <PiggyBank className="w-5 h-5 text-blue-600 mb-1" />
                  <div className="text-[10px] text-slate-500 mb-1 text-center flex items-center justify-center gap-0.5">
                    עו"ש וחסכון <Explain id="dashboard.ecosystem.liquid" />
                  </div>
                  <p className="text-sm md:text-base font-bold text-slate-800">₪{(ecosystem.liquid / 1000).toFixed(0)}K</p>
                </div>
                <div className="flex flex-col items-center justify-center p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                  <TrendingUp className="w-5 h-5 text-emerald-600 mb-1" />
                  <div className="text-[10px] text-slate-500 mb-1 text-center flex items-center justify-center gap-0.5">
                    תיק השקעות <Explain id="dashboard.ecosystem.investments" />
                  </div>
                  <p className="text-sm md:text-base font-bold text-slate-800">₪{(ecosystem.investments / 1000).toFixed(0)}K</p>
                </div>
                <div className="flex flex-col items-center justify-center p-3 bg-purple-50 rounded-xl border border-purple-100">
                  <Shield className="w-5 h-5 text-purple-600 mb-1" />
                  <div className="text-[10px] text-slate-500 mb-1 text-center flex items-center justify-center gap-0.5">
                    פנסיה <Explain id="dashboard.ecosystem.pensions" />
                  </div>
                  <p className="text-sm md:text-base font-bold text-slate-800">₪{(ecosystem.pensions / 1000).toFixed(0)}K</p>
                </div>
                <div className="flex flex-col items-center justify-center p-3 bg-amber-50 rounded-xl border border-amber-100">
                  <Bitcoin className="w-5 h-5 text-amber-600 mb-1" />
                  <div className="text-[10px] text-slate-500 mb-1 text-center flex items-center justify-center gap-0.5">
                    קריפטו <Explain id="dashboard.ecosystem.crypto" />
                  </div>
                  <p className="text-sm md:text-base font-bold text-slate-800">₪{(ecosystem.crypto / 1000).toFixed(0)}K</p>
                </div>
                <div className="flex flex-col items-center justify-center p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <Home className="w-5 h-5 text-slate-600 mb-1" />
                  <div className="text-[10px] text-slate-500 mb-1 text-center flex items-center justify-center gap-0.5">
                    נדל"ן <Explain id="dashboard.ecosystem.realEstate" />
                  </div>
                  <p className="text-sm md:text-base font-bold text-slate-800">₪{(ecosystem.realEstate / 1000000).toFixed(1)}M</p>
                </div>
              </div>
            </div>
          </div>
          {showEcosystemAllFallbackNote && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
              מציג את נתוני כל המשפחה — סיכום לפי כמה בני משפחה עדיין לא נתמך
            </p>
          )}
        </>
      )}

      {/* Monthly Cash Flow Stats */}
      <div className="flex items-center gap-3 mt-8 mb-4">
        <h2 className="text-xl font-bold text-slate-800">תזרים מזומנים חודשי ({currentMonthLabel} {selectedYear})</h2>
        {selectedMemberLabel && (
          <span className="flex items-center gap-1.5 bg-indigo-100 text-indigo-700 text-sm font-semibold px-3 py-1 rounded-full">
            <UserIcon className="w-3.5 h-3.5" />
            {selectedMemberLabel}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm text-slate-500 font-medium flex items-center gap-1">
              סך ההכנסות <Explain id="dashboard.totalIncome" />
            </div>
            {incomesAccessDenied ? (
              <p className="text-sm font-medium text-slate-400">{ACCESS_DENIED_MESSAGE}</p>
            ) : incomesLoadError ? (
              <p className="text-sm font-medium text-red-600">{incomesLoadError}</p>
            ) : (
              <p className="text-2xl font-bold text-slate-800">₪{totalIncome.toLocaleString()}</p>
            )}
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-red-50 text-red-600 rounded-xl">
            <TrendingDown className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm text-slate-500 font-medium flex items-center gap-1">
              סך ההוצאות <Explain id="dashboard.totalExpenses" />
            </div>
            {budgetAccessDenied ? (
              <p data-testid="kpi.totalExpenses" className="text-sm font-medium text-slate-400">{ACCESS_DENIED_MESSAGE}</p>
            ) : budgetLoadError ? (
              <p data-testid="kpi.totalExpenses" className="text-sm font-medium text-red-600">{budgetLoadError}</p>
            ) : (
              // D8 — a real <button>, not a <div onClick>, for keyboard/focus semantics. Kept
              // outside the label row above (which owns its own <Explain> trigger button) so this
              // never nests one <button> inside another.
              <button
                type="button"
                onClick={() => drillDownTo('expenses')}
                data-testid="kpi.totalExpenses"
                data-tour-id="kpi.totalExpenses"
                className="inline-flex items-center gap-1 text-2xl font-bold text-slate-800 hover:text-blue-600 transition-colors text-right"
              >
                ₪{totalExpenses.toLocaleString()}
                <DrillAffordance />
              </button>
            )}
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm text-slate-500 font-medium flex items-center gap-1">
              יתרה חודשית <Explain id="dashboard.monthlyBalance" />
            </div>
            {balanceAccessDenied ? (
              <p className="text-sm font-medium text-slate-400">{ACCESS_DENIED_MESSAGE}</p>
            ) : balanceLoadError ? (
              <p className="text-sm font-medium text-red-600">{balanceLoadError}</p>
            ) : (
              <p className={`text-2xl font-bold ${balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {balance >= 0 ? '+' : '-'}₪{Math.abs(balance).toLocaleString()}
              </p>
            )}
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <Target className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm text-slate-500 font-medium flex items-center gap-1">
              תקציב מתוכנן <Explain id="dashboard.plannedBudget" />
            </div>
            {budgetAccessDenied ? (
              <p data-testid="kpi.plannedBudget" className="text-sm font-medium text-slate-400">{ACCESS_DENIED_MESSAGE}</p>
            ) : budgetLoadError ? (
              <p data-testid="kpi.plannedBudget" className="text-sm font-medium text-red-600">{budgetLoadError}</p>
            ) : (
              <button
                type="button"
                onClick={() => drillDownTo('expenses')}
                data-testid="kpi.plannedBudget"
                data-tour-id="kpi.plannedBudget"
                className="inline-flex items-center gap-1 text-2xl font-bold text-slate-800 hover:text-blue-600 transition-colors text-right"
              >
                ₪{totalBudget.toLocaleString()}
                <DrillAffordance />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Family members load error ──────────────────────────────────────── */}
      {familyMembersError && (
        <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-5 md:p-6 flex items-center gap-3" dir="rtl">
          <AlertTriangle className="w-6 h-6 text-red-400 shrink-0" />
          <div>
            <p className="text-red-600 font-medium">{familyMembersError}</p>
            <p className="text-slate-400 text-sm mt-1">נסה לרענן את הדף או לבדוק את חיבור ה-Firestore</p>
          </div>
        </div>
      )}

      {/* ── Settlement Widget ───────────────────────────────────────────────── */}
      {/* Three-way branch, matching loadEcosystem/loadBudget above: access-denied (calm slate
          message, S2) vs. a genuine load failure (red banner) vs. the real widget/nothing. */}
      {settlementAccessDenied ? (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-slate-500 text-sm" dir="rtl">
          {ACCESS_DENIED_MESSAGE}
        </div>
      ) : settlementLoadError ? (
        <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-5 md:p-6 flex items-center gap-3" dir="rtl">
          <AlertTriangle className="w-6 h-6 text-red-400 shrink-0" />
          <div>
            <p className="text-red-600 font-medium">{settlementLoadError}</p>
            <p className="text-slate-400 text-sm mt-1">נסה לרענן את הדף או לבדוק את חיבור ה-Firestore</p>
          </div>
        </div>
      ) : settlementData.length >= 2 && (() => {
        const [p1, p2] = settlementData;
        const diff = Math.abs(p1.paid - p2.paid);
        const debtor = p1.paid < p2.paid ? p1 : p2;
        const creditor = p1.paid < p2.paid ? p2 : p1;
        return (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 md:p-6" dir="rtl">
            <div className="flex items-center gap-2 mb-5">
              <div className="p-2 bg-violet-100 text-violet-600 rounded-xl">
                <Scale className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-bold text-slate-800">התחשבנות זוגית — {currentMonthLabel} {selectedYear}</h2>
            </div>
            <div className="space-y-4">
              {settlementData.map(person => {
                const pct = Math.min((person.paid / person.target) * 100, 100);
                const over = person.paid > person.target;
                const delta = Math.abs(person.paid - person.target);
                return (
                  <div key={person.name}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-slate-700">{person.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-500" dir="ltr">₪{person.paid.toLocaleString()} / ₪{person.target.toLocaleString()}</span>
                        <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${over ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {over ? '+' : '-'}₪{delta.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                      <div
                        className={`h-3 rounded-full transition-all duration-700 ${over ? 'bg-emerald-500' : 'bg-amber-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {diff > 0 && (
              <div className="mt-5 flex items-center gap-2 bg-violet-50 border border-violet-100 rounded-xl px-4 py-3 text-sm font-medium text-violet-800">
                <span>💸</span>
                <span>{debtor.name} חייב/ת להעביר <strong>₪{diff.toLocaleString()}</strong> ← {creditor.name}</span>
              </div>
            )}
          </div>
        );
      })()}

      {/* D9 — "מי הוציא כמה החודש" comparison card, fed by loadSettlement's existing per-owner
          settlementData above (no new Firestore read). ComparisonTable renders its own explicit
          empty state ("אין נתונים להשוואה.") when there's genuinely nothing to compare, but that
          text is indistinguishable from a permission refusal or a load failure — so this card
          must gate on settlementAccessDenied/settlementLoadError itself before ever reaching
          ComparisonTable, same three-way split as the settlement widget above (closing review
          fix — this was the exact silent-empty-on-denial violation this stage exists to
          eliminate, on the card this stage itself added). */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-6">
        {/* D8 — a real <button>, not a <div onClick>, wrapping just the title (not the whole
            card): ComparisonTable below has its own interactive children (a search input, a
            "show all" button), and nesting THOSE inside an outer <button> would be invalid,
            broken HTML. A card whose own state is access-denied/error stays a plain, non-button
            heading — never clickable into a screen that would show the same denial. */}
        {settlementAccessDenied || settlementLoadError ? (
          <h3 data-testid="card.comparison" className="text-sm font-semibold text-slate-700 mb-3">
            מי הוציא כמה החודש
          </h3>
        ) : (
          <button
            type="button"
            onClick={() => drillDownTo('expenses')}
            data-testid="card.comparison"
            data-tour-id="card.comparison"
            className="text-sm font-semibold text-slate-700 mb-3 hover:text-blue-600 transition-colors text-right w-fit"
          >
            מי הוציא כמה החודש
          </button>
        )}
        {settlementAccessDenied ? (
          <div className="text-sm text-slate-400 p-4 text-center" dir="rtl">
            {ACCESS_DENIED_MESSAGE}
          </div>
        ) : settlementLoadError ? (
          <div className="text-sm text-red-600 font-medium p-4 text-center" dir="rtl">
            {settlementLoadError}
          </div>
        ) : (
          <ComparisonTable rows={comparisonRows} valueLabel="הוצאות" topN={8} />
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Income Details Section */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 xl:col-span-1">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Banknote className="w-6 h-6 text-emerald-600" />
              <h2 className="text-lg font-bold text-slate-800">פירוט הכנסות</h2>
            </div>
            <button
              onClick={() => {
                setEditingIncomesList(incomes);
                setIsEditingIncomes(true);
              }}
              className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
              title="ערוך הכנסות"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            {incomes.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">אין הכנסות לחודש זה. לחץ על עריכה להוסיף.</p>
            ) : (
              incomes.map(item => (
                <div key={item.firestoreId ?? item.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 hover:bg-slate-100 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                      <Banknote className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-800 text-sm">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.date}</p>
                    </div>
                  </div>
                  <p className="font-bold text-emerald-600">+₪{item.amount.toLocaleString()}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* AI Insights & Chat Section */}
        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 p-6 rounded-2xl border border-indigo-100 xl:col-span-2 flex flex-col h-[500px]">
          <div className="flex items-center gap-2 mb-4 shrink-0">
            <MessageSquare className="w-6 h-6 text-indigo-600" />
            <h2 className="text-lg font-bold text-indigo-900">יועץ פיננסי אישי (NotebookLM)</h2>
          </div>

          {/* Chat Messages Area */}
          <div className="flex-1 overflow-y-auto bg-white/50 rounded-xl p-4 mb-4 border border-indigo-100/50 space-y-4 custom-scrollbar">
            {/* Initial Auto-Insights */}
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                <Lightbulb className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="bg-white border border-indigo-100 rounded-2xl rounded-tr-none p-3 text-sm text-slate-700 shadow-sm w-full">
                <p className="font-bold text-indigo-900 mb-2">תובנות אוטומטיות לחודש זה:</p>
                {loading ? (
                  <div className="animate-pulse space-y-2">
                    <div className="h-2 bg-indigo-100 rounded w-3/4"></div>
                    <div className="h-2 bg-indigo-100 rounded w-5/6"></div>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {insights.map((insight, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-indigo-400 mt-0.5">•</span>
                        <span>{insight}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Interactive Chat Messages */}
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-indigo-100 text-indigo-600'}`}>
                  {msg.role === 'user' ? <UserIcon className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div className={`p-3 rounded-2xl text-sm shadow-sm max-w-[85%] ${msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-tl-none'
                  : 'bg-white border border-indigo-100 text-slate-700 rounded-tr-none'
                  }`}>
                  {msg.text}
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="bg-white border border-indigo-100 rounded-2xl rounded-tr-none p-4 text-sm shadow-sm flex items-center gap-1">
                  <div className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input */}
          <form onSubmit={handleSendMessage} className="flex gap-2 shrink-0">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="שאל אותי על ההוצאות, התקציב או איך לחסוך..."
              className="flex-1 bg-white border border-indigo-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent shadow-sm"
              disabled={!chatSession || isTyping}
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || !chatSession || isTyping}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white p-3 rounded-xl transition-colors shadow-sm flex items-center justify-center"
            >
              <Send className="w-5 h-5 rtl:-scale-x-100" />
            </button>
          </form>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Budget vs Actual */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-6">
            <h2 className="text-lg font-bold text-slate-800">תקציב מול ביצוע (Budget vs. Actual)</h2>
            {selectedMemberLabel && (
              <span className="text-xs bg-indigo-50 text-indigo-600 font-semibold px-2 py-0.5 rounded-full">{selectedMemberLabel}</span>
            )}
          </div>
          {budgetAccessDenied ? (
            <div className="h-72 flex flex-col items-center justify-center text-center">
              <AlertTriangle className="w-12 h-12 mb-3 text-slate-300" />
              <p className="text-sm text-slate-500 font-medium">{ACCESS_DENIED_MESSAGE}</p>
            </div>
          ) : budgetLoadError ? (
            <div className="h-72 flex flex-col items-center justify-center text-center">
              <AlertTriangle className="w-12 h-12 mb-3 text-red-300" />
              <p className="text-sm text-red-600 font-medium">{budgetLoadError}</p>
              <p className="text-xs text-slate-400 mt-1">נסה לרענן את הדף</p>
            </div>
          ) : budgetVsActual.length === 0 ? (
            <div className="h-72 flex flex-col items-center justify-center text-slate-400">
              <Target className="w-12 h-12 mb-3 text-slate-200" />
              <p className="text-sm">אין נתוני תקציב לחודש זה.</p>
              <p className="text-xs mt-1">הגדר תקציב בהגדרות או סנכרן קבצים.</p>
            </div>
          ) : (
            <div className="h-72 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={budgetVsActual} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} />
                  <Tooltip
                    cursor={{ fill: '#f1f5f9' }}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Bar dataKey="budget" name="תקציב" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="actual" name="בפועל" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Category Breakdown */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-6">
            <h2 className="text-lg font-bold text-slate-800">חלוקת הוצאות לפי קטגוריה</h2>
            {selectedMemberLabel && (
              <span className="text-xs bg-indigo-50 text-indigo-600 font-semibold px-2 py-0.5 rounded-full">{selectedMemberLabel}</span>
            )}
          </div>
          {budgetAccessDenied ? (
            <div className="h-72 flex flex-col items-center justify-center text-center">
              <AlertTriangle className="w-12 h-12 mb-3 text-slate-300" />
              <p className="text-sm text-slate-500 font-medium">{ACCESS_DENIED_MESSAGE}</p>
            </div>
          ) : budgetLoadError ? (
            <div className="h-72 flex flex-col items-center justify-center text-center">
              <AlertTriangle className="w-12 h-12 mb-3 text-red-300" />
              <p className="text-sm text-red-600 font-medium">{budgetLoadError}</p>
              <p className="text-xs text-slate-400 mt-1">נסה לרענן את הדף</p>
            </div>
          ) : categories.length === 0 ? (
            <div className="h-72 flex flex-col items-center justify-center text-slate-400">
              <div className="w-24 h-24 rounded-full border-4 border-slate-100 mb-3" />
              <p className="text-sm">אין הוצאות לחודש זה.</p>
              <p className="text-xs mt-1">סנכרן קבצים כדי לטעון נתונים.</p>
            </div>
          ) : (
            <div className="h-72 w-full flex items-center justify-center" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categories}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {categories.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Edit Incomes Modal */}
      {isEditingIncomes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
              <div className="flex items-center gap-2">
                <Banknote className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-800 text-lg">עריכת הכנסות</h3>
              </div>
              <button
                onClick={() => setIsEditingIncomes(false)}
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {editingIncomesList.map(item => (
                <div key={item.id} className="flex flex-col sm:flex-row gap-3 items-end sm:items-center bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div className="flex-1 w-full">
                    <label className="block text-xs font-medium text-slate-500 mb-1">סוג הכנסה</label>
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => handleUpdateIncome(item.id, 'name', e.target.value)}
                      className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-lg focus:ring-emerald-500 focus:border-emerald-500 block p-2.5"
                    />
                  </div>
                  <div className="w-full sm:w-32">
                    <label className="block text-xs font-medium text-slate-500 mb-1">סכום (₪)</label>
                    <input
                      type="number"
                      value={item.amount}
                      onChange={(e) => handleUpdateIncome(item.id, 'amount', Number(e.target.value))}
                      className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-lg focus:ring-emerald-500 focus:border-emerald-500 block p-2.5"
                    />
                  </div>
                  <div className="w-full sm:w-32">
                    <label className="block text-xs font-medium text-slate-500 mb-1">תאריך</label>
                    <input
                      type="text"
                      value={item.date}
                      placeholder="DD/MM/YYYY"
                      onChange={(e) => handleUpdateIncome(item.id, 'date', e.target.value)}
                      className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-lg focus:ring-emerald-500 focus:border-emerald-500 block p-2.5 text-left"
                      dir="ltr"
                    />
                  </div>
                  <button
                    onClick={() => handleRemoveIncome(item.id)}
                    className="p-2.5 text-red-500 hover:bg-red-100 rounded-lg transition-colors mt-2 sm:mt-0"
                    title="מחק הכנסה"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))}

              <button
                onClick={handleAddIncome}
                className="w-full py-3 border-2 border-dashed border-slate-200 text-slate-500 hover:text-emerald-600 hover:border-emerald-300 hover:bg-emerald-50 rounded-xl transition-colors flex items-center justify-center gap-2 font-medium"
              >
                <Plus className="w-5 h-5" />
                הוסף הכנסה חדשה
              </button>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button
                onClick={() => setIsEditingIncomes(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-lg font-medium transition-colors"
              >
                ביטול
              </button>
              <button
                onClick={handleSaveIncomes}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors shadow-sm"
              >
                שמור שינויים
              </button>
            </div>
          </div>
        </div>
      )}

      <FamilyManagerModal
        isOpen={isFamilyModalOpen}
        onClose={() => setIsFamilyModalOpen(false)}
        members={familyMembers}
        onSave={async (updatedMembers) => {
          // The ids Dashboard actually had loaded/rendered before this edit — saveMembers uses
          // this as its optimistic-concurrency guard (basedOnIds): if Firestore's members
          // collection contains an id not in this list, the caller's picture was stale and
          // saveMembers must abort without writing rather than treat "not in my edit" as "the
          // user deleted it".
          const basedOnIds = familyMembers.map((m) => m.id);

          // FamilyManagerModal only knows FamilyMember's shape (id/name/role/idNumber) — backfill
          // the extra Member fields (color/groups/createdAt/updatedAt) from the last known-good
          // entry for an edited member, or a short-lived placeholder for a brand-new one.
          // saveMembers assigns the real color server-side; a successful familyMembersState.reload()
          // below replaces this optimistic view with the real data within one tick either way.
          const optimisticMembers: Member[] = updatedMembers.map((edit) => {
            const existing = familyMembers.find((m) => m.id === edit.id);
            return existing
              ? { ...existing, name: edit.name, role: edit.role, idNumber: edit.idNumber }
              : {
                  id: edit.id,
                  name: edit.name,
                  role: edit.role,
                  idNumber: edit.idNumber,
                  color: '#94a3b8',
                  groups: [],
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                };
          });

          // Optimistic update — FamilyManagerModal already shows its own success toast
          // synchronously on add/edit/delete, before this promise settles.
          setMembersOverride(optimisticMembers);
          try {
            await saveMembers(updatedMembers, basedOnIds);
            familyMembersState.reload(); // M2 — resync the ONE shared fetch; FilterBar sees the change too
          } catch (err) {
            if (err instanceof StaleMembersError) {
              // Not an ordinary write failure: the save was correctly refused because our view
              // of the collection was out of date (or someone else edited it concurrently).
              // Nothing was written — tell the user plainly and re-sync from the source of truth.
              console.error('[Dashboard] Stale member list — edit rejected without writing:', err);
              addNotification(
                'error',
                'רשימת בני המשפחה השתנתה בינתיים ולכן העדכון לא נשמר. הרשימה מסונכרנת מחדש.'
              );
            } else {
              // The edit must never be silently lost: tell the user the save failed (the modal's
              // earlier "success" toast was optimistic and was wrong).
              console.error('[Dashboard] Failed to save members:', err);
              addNotification('error', 'שמירת בני המשפחה נכשלה. בדוק את החיבור ונסה שוב.');
            }
            // Roll back the optimistic view entirely and trust the shared hook's own
            // last-known-good `members` (which itself never resets on a failed read, per
            // useFamilyMembers' own carry-forward-on-error rule) — no local snapshot needed here.
            // If the resync ALSO fails, familyMembersState.status flips to 'error' and
            // familyMembersError above surfaces the generic gate automatically, since
            // membersOverride is null again by then.
            setMembersOverride(null);
            familyMembersState.reload();
          }
        }}
      />
    </div>
  );
}
