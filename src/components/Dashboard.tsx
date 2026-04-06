import React, { useEffect, useState, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { generateFinancialInsights, getFinancialChatSession } from '../services/ai';
import { TrendingUp, TrendingDown, Wallet, Lightbulb, Banknote, Target, MessageSquare, Send, Bot, User as UserIcon, CalendarDays, ChevronRight, ChevronLeft, Pencil, Plus, Trash2, X, Landmark, Shield, Bitcoin, Home, PiggyBank, Users, Settings, Scale } from 'lucide-react';
import FamilyManagerModal, { FamilyMember } from './FamilyManagerModal';
import { db } from '../services/firebase';
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

interface FirestoreTransaction {
  vendor: string;
  amount: number;
  date: string;
  category: string;
  owner?: string;
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

const YEARS = ['2024', '2025', '2026', '2027'];
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

// ── Component ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [selectedMonth, setSelectedMonth] = useState(() => String(new Date().getMonth() + 1).padStart(2, '0'));
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear().toString());
  const [selectedMember, setSelectedMember] = useState<string>('all');

  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [isFamilyModalOpen, setIsFamilyModalOpen] = useState(false);

  const memberOptions = [
    { id: 'all', label: 'כל המשפחה' },
    ...familyMembers.map(m => ({ id: m.id, label: m.name }))
  ];

  // ── Income state ──────────────────────────────────────────────────────────
  const [incomes, setIncomes] = useState<IncomeEntry[]>([]);
  const [isEditingIncomes, setIsEditingIncomes] = useState(false);
  const [editingIncomesList, setEditingIncomesList] = useState<IncomeEntry[]>([]);

  // ── Budget / Ecosystem state ───────────────────────────────────────────────
  const [budgetVsActual, setBudgetVsActual] = useState<BudgetCategory[]>([]);
  const [categories, setCategories] = useState<{ name: string; value: number }[]>([]);
  const [ecosystem, setEcosystem] = useState<EcosystemData>(EMPTY_ECOSYSTEM);

  // ── Settlement state ──────────────────────────────────────────────────────
  const [settlementData, setSettlementData] = useState<{ name: string; paid: number; target: number }[]>([]);

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

  // ── Load family members from Firestore (seed defaults if empty) ──────────
  useEffect(() => {
    const DEFAULT_MEMBERS: FamilyMember[] = [
      { id: 'david-levy', name: 'דויד', role: 'הורה' },
      { id: 'lilit-levy', name: 'לילית', role: 'הורה' },
      { id: 'omer-levy',  name: 'עומר',  role: 'ילד'  },
    ];

    const loadMembers = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'budgetConfig'));
        const existing = snap.exists() ? ((snap.data().members ?? []) as FamilyMember[]) : [];
        if (existing.length > 0) {
          setFamilyMembers(existing);
        } else {
          // First run — seed default Levy family and persist
          setFamilyMembers(DEFAULT_MEMBERS);
          await setDoc(doc(db, 'settings', 'budgetConfig'), { members: DEFAULT_MEMBERS }, { merge: true });
        }
      } catch (err) {
        console.error('[Dashboard] Failed to load family members:', err);
        setFamilyMembers(DEFAULT_MEMBERS);
      }
    };
    loadMembers();
  }, []);

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
    }, (err) => {
      console.error('Failed to load incomes:', err);
    });

    return () => unsubscribe();
  }, [selectedMonth, selectedYear]);

  // ── Load ecosystem ─────────────────────────────────────────────────────────
  useEffect(() => {
    const loadEcosystem = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'ecosystem'));
        if (snap.exists()) {
          const data = snap.data();
          const memberData = (data[selectedMember] ?? data['all'] ?? EMPTY_ECOSYSTEM) as EcosystemData;
          setEcosystem(memberData);
        } else {
          setEcosystem(EMPTY_ECOSYSTEM);
        }
      } catch (err) {
        console.error('Failed to load ecosystem:', err);
        setEcosystem(EMPTY_ECOSYSTEM);
      }
    };
    loadEcosystem();
  }, [selectedMember]);

  // ── Load budget config + compute actuals from transactions ─────────────────
  useEffect(() => {
    const loadBudget = async () => {
      try {
        const budgetSnap = await getDoc(doc(db, 'settings', 'budgetConfig'));
        const budgetMap: Record<string, number> = {};

        if (budgetSnap.exists()) {
          const data = budgetSnap.data();
          const memberBudget = (data[selectedMember] ?? data['all'] ?? []) as { name: string; budget: number }[];
          memberBudget.forEach(b => { budgetMap[b.name] = b.budget; });
        }

        // Resolve which owner name to filter on (null = all)
        const filterOwnerName = selectedMember === 'all'
          ? null
          : familyMembers.find(m => m.id === selectedMember)?.name ?? null;

        // Aggregate actuals from transactions + transaction_lines
        const actuals: Record<string, number> = {};

        const [txSnap, tlSnap] = await Promise.all([
          getDocs(collection(db, 'transactions')),
          getDocs(collection(db, 'transaction_lines')),
        ]);

        txSnap.docs.forEach(d => {
          const tx = d.data() as FirestoreTransaction;
          if (filterOwnerName && tx.owner !== filterOwnerName) return;
          const txDate = tx.date || '';
          let txMonth = '';
          let txYear = '';

          if (txDate.includes('/')) {
            const parts = txDate.split('/');
            txMonth = parts[1] ?? '';
            txYear = parts[2] ?? '';
          } else if (txDate.includes('-')) {
            const parts = txDate.split('-');
            txYear = parts[0] ?? '';
            txMonth = parts[1] ?? '';
          }

          if (txMonth === selectedMonth && txYear === selectedYear) {
            const cat = tx.category || 'אחר';
            if (cat !== 'Income_Investments') {
              actuals[cat] = (actuals[cat] ?? 0) + (tx.amount ?? 0);
            }
          }
        });

        tlSnap.docs.forEach(d => {
          const data = d.data();
          if (data.isCredit) return;
          if (filterOwnerName && data.owner !== filterOwnerName) return;
          const date: string = data.date ?? '';
          if (!date.startsWith(`${selectedYear}-${selectedMonth}`)) return;
          const cat: string = data.category ?? 'שונות';
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

      } catch (err) {
        console.error('Failed to load budget:', err);
        setBudgetVsActual([]);
        setCategories([]);
      }
    };
    loadBudget();
  }, [selectedMonth, selectedYear, selectedMember, familyMembers]);

  // ── Settlement: who paid what this month ──────────────────────────────────
  useEffect(() => {
    const loadSettlement = async () => {
      try {
        const budgetSnap = await getDoc(doc(db, 'settings', 'budgetConfig'));
        const allMembers: FamilyMember[] = budgetSnap.exists()
          ? ((budgetSnap.data().members ?? []) as FamilyMember[])
          : familyMembers;

        // Settlement is only between adults (הורה), not children
        let adultNames = allMembers
          .filter(m => m.role !== 'ילד')
          .map(m => m.name);

        // If no configured members, derive from owners across ALL transactions
        if (adultNames.length === 0) {
          const ownerSet = new Set<string>();
          const [txFallback, tlFallback] = await Promise.all([
            getDocs(collection(db, 'transactions')),
            getDocs(collection(db, 'transaction_lines')),
          ]);
          txFallback.docs.forEach(d => {
            const data = d.data();
            if (data.owner && !data.isCredit) ownerSet.add(data.owner);
          });
          tlFallback.docs.forEach(d => {
            const data = d.data();
            if (data.owner && !data.isCredit) ownerSet.add(data.owner);
          });
          adultNames = Array.from(ownerSet);
        }

        if (adultNames.length === 0) return;

        const paid: Record<string, number> = {};
        adultNames.forEach(n => { paid[n] = 0; });

        const prefix = `${selectedYear}-${selectedMonth}`;

        // Query both collections
        const [txSnap, tlSnap] = await Promise.all([
          getDocs(collection(db, 'transactions')),
          getDocs(collection(db, 'transaction_lines')),
        ]);

        txSnap.docs.forEach(d => {
          const data = d.data();
          if (data.isCredit) return;
          const date: string = data.date ?? '';
          const isThisMonth = date.startsWith(prefix) ||
            (date.includes('/') && date.split('/')[1] === selectedMonth && date.split('/')[2]?.startsWith(selectedYear));
          if (!isThisMonth) return;
          const owner: string = data.owner ?? '';
          if (paid[owner] !== undefined) paid[owner] += (data.amount ?? 0);
        });

        tlSnap.docs.forEach(d => {
          const data = d.data();
          if (data.isCredit) return;
          const date: string = data.date ?? '';
          if (!date.startsWith(prefix)) return;
          const owner: string = data.owner ?? '';
          if (paid[owner] !== undefined) paid[owner] += (data.amount ?? 0);
        });

        const SETTLEMENT_TARGET = 7000;
        setSettlementData(adultNames.map(name => ({ name, paid: paid[name] ?? 0, target: SETTLEMENT_TARGET })));
      } catch (err) {
        console.error('[Dashboard] Settlement load error:', err);
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
  }, [selectedMember, incomes]);

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

  // ── Month navigation ───────────────────────────────────────────────────────
  const handlePrevMonth = () => {
    const idx = MONTHS.findIndex(m => m.value === selectedMonth);
    if (idx > 0) {
      setSelectedMonth(MONTHS[idx - 1].value);
    } else {
      setSelectedMonth('12');
      setSelectedYear((parseInt(selectedYear) - 1).toString());
    }
  };

  const handleNextMonth = () => {
    const idx = MONTHS.findIndex(m => m.value === selectedMonth);
    if (idx < 11) {
      setSelectedMonth(MONTHS[idx + 1].value);
    } else {
      setSelectedMonth('01');
      setSelectedYear((parseInt(selectedYear) + 1).toString());
    }
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

        <div className="flex flex-col md:flex-row items-center gap-3 w-full lg:w-auto">
          {/* Member Selector */}
          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0 scrollbar-hide">
            <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200 shrink-0">
              {memberOptions.map(member => (
                <button
                  key={member.id}
                  onClick={() => setSelectedMember(member.id)}
                  className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition-colors flex items-center gap-2 min-h-[44px] md:min-h-0 ${selectedMember === member.id
                    ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/50'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                    }`}
                >
                  {member.id === 'all' ? <Users className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
                  {member.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setIsFamilyModalOpen(true)}
              className="p-2.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl border border-slate-200 bg-white shadow-sm transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              title="ניהול בני משפחה"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>

          {/* Date Selector */}
          <div className="flex items-center justify-between w-full md:w-auto gap-2 bg-slate-50 p-1 rounded-xl border border-slate-200">
            <button
              onClick={handleNextMonth}
              className="p-2.5 hover:bg-white rounded-lg transition-colors text-slate-600 hover:text-slate-900 shadow-sm min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <ChevronRight className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-1 px-1">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-transparent border-none text-slate-800 font-bold text-base md:text-lg focus:ring-0 cursor-pointer p-0 pr-1 appearance-none"
              >
                {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <span className="text-slate-400 font-bold">/</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="bg-transparent border-none text-slate-800 font-bold text-base md:text-lg focus:ring-0 cursor-pointer p-0 appearance-none"
              >
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            <button
              onClick={handlePrevMonth}
              className="p-2.5 hover:bg-white rounded-lg transition-colors text-slate-600 hover:text-slate-900 shadow-sm min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Net Worth & Ecosystem Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-indigo-600 to-blue-700 p-5 md:p-6 rounded-2xl shadow-md text-white flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base md:text-lg font-medium text-indigo-100">שווי נקי (Net Worth)</h2>
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
              <p className="text-[10px] text-slate-500 mb-1 text-center">עו"ש וחסכון</p>
              <p className="text-sm md:text-base font-bold text-slate-800">₪{(ecosystem.liquid / 1000).toFixed(0)}K</p>
            </div>
            <div className="flex flex-col items-center justify-center p-3 bg-emerald-50 rounded-xl border border-emerald-100">
              <TrendingUp className="w-5 h-5 text-emerald-600 mb-1" />
              <p className="text-[10px] text-slate-500 mb-1 text-center">תיק השקעות</p>
              <p className="text-sm md:text-base font-bold text-slate-800">₪{(ecosystem.investments / 1000).toFixed(0)}K</p>
            </div>
            <div className="flex flex-col items-center justify-center p-3 bg-purple-50 rounded-xl border border-purple-100">
              <Shield className="w-5 h-5 text-purple-600 mb-1" />
              <p className="text-[10px] text-slate-500 mb-1 text-center">פנסיה</p>
              <p className="text-sm md:text-base font-bold text-slate-800">₪{(ecosystem.pensions / 1000).toFixed(0)}K</p>
            </div>
            <div className="flex flex-col items-center justify-center p-3 bg-amber-50 rounded-xl border border-amber-100">
              <Bitcoin className="w-5 h-5 text-amber-600 mb-1" />
              <p className="text-[10px] text-slate-500 mb-1 text-center">קריפטו</p>
              <p className="text-sm md:text-base font-bold text-slate-800">₪{(ecosystem.crypto / 1000).toFixed(0)}K</p>
            </div>
            <div className="flex flex-col items-center justify-center p-3 bg-slate-50 rounded-xl border border-slate-200">
              <Home className="w-5 h-5 text-slate-600 mb-1" />
              <p className="text-[10px] text-slate-500 mb-1 text-center">נדל"ן</p>
              <p className="text-sm md:text-base font-bold text-slate-800">₪{(ecosystem.realEstate / 1000000).toFixed(1)}M</p>
            </div>
          </div>
        </div>
      </div>

      {/* Monthly Cash Flow Stats */}
      <h2 className="text-xl font-bold text-slate-800 mt-8 mb-4">תזרים מזומנים חודשי ({currentMonthLabel} {selectedYear})</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-500 font-medium">סך הכנסות</p>
            <p className="text-2xl font-bold text-slate-800">₪{totalIncome.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-red-50 text-red-600 rounded-xl">
            <TrendingDown className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-500 font-medium">סך הוצאות</p>
            <p className="text-2xl font-bold text-slate-800">₪{totalExpenses.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-500 font-medium">יתרה חודשית</p>
            <p className={`text-2xl font-bold ${balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {balance >= 0 ? '+' : '-'}₪{Math.abs(balance).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <Target className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-500 font-medium">תקציב מתוכנן</p>
            <p className="text-2xl font-bold text-slate-800">₪{totalBudget.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* ── Settlement Widget ───────────────────────────────────────────────── */}
      {settlementData.length >= 2 && (() => {
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
          <h2 className="text-lg font-bold text-slate-800 mb-6">תקציב מול ביצוע (Budget vs. Actual)</h2>
          {budgetVsActual.length === 0 ? (
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
          <h2 className="text-lg font-bold text-slate-800 mb-6">חלוקת הוצאות לפי קטגוריה</h2>
          {categories.length === 0 ? (
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
          setFamilyMembers(updatedMembers);
          try {
            await setDoc(doc(db, 'settings', 'budgetConfig'), { members: updatedMembers }, { merge: true });
          } catch (err) {
            console.error('[Dashboard] Failed to save members:', err);
          }
        }}
      />
    </div>
  );
}
