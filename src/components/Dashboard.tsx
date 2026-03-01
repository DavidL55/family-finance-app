import React, { useEffect, useState, useRef } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { generateFinancialInsights, getFinancialChatSession } from '../services/ai';
import { AlertCircle, TrendingUp, TrendingDown, Wallet, CreditCard, Lightbulb, Banknote, Target, MessageSquare, Send, Bot, User as UserIcon, CalendarDays, ChevronRight, ChevronLeft, Pencil, Plus, Trash2, X, Landmark, Shield, Bitcoin, Briefcase, Home, PiggyBank, Activity, PieChart as PieChartIcon, Users, Settings } from 'lucide-react';
import FamilyManagerModal, { FamilyMember } from './FamilyManagerModal';

const MONTHS = [
  { value: '01', label: 'ינואר' }, { value: '02', label: 'פברואר' }, { value: '03', label: 'מרץ' },
  { value: '04', label: 'אפריל' }, { value: '05', label: 'מאי' }, { value: '06', label: 'יוני' },
  { value: '07', label: 'יולי' }, { value: '08', label: 'אוגוסט' }, { value: '09', label: 'ספטמבר' },
  { value: '10', label: 'אוקטובר' }, { value: '11', label: 'נובמבר' }, { value: '12', label: 'דצמבר' }
];

const YEARS = ['2024', '2025', '2026', '2027'];

const mockData = {
  income: {
    all: [
      { id: 1, name: 'משכורת - דוד', amount: 14500, date: '01/03/2026' },
      { id: 2, name: 'משכורת - שרה', amount: 12000, date: '10/03/2026' },
      { id: 3, name: 'בונוס רבעוני', amount: 3500, date: '15/03/2026' },
      { id: 4, name: 'קצבת ילדים', amount: 330, date: '20/03/2026' },
    ],
    david: [
      { id: 1, name: 'משכורת - דוד', amount: 14500, date: '01/03/2026' },
      { id: 3, name: 'בונוס רבעוני', amount: 3500, date: '15/03/2026' },
    ],
    sarah: [
      { id: 2, name: 'משכורת - שרה', amount: 12000, date: '10/03/2026' },
      { id: 4, name: 'קצבת ילדים', amount: 330, date: '20/03/2026' },
    ]
  },
  budgetVsActual: {
    all: [
      { name: 'מזון', budget: 3000, actual: 3600 },
      { name: 'דיור', budget: 5000, actual: 5000 },
      { name: 'תחבורה', budget: 1500, actual: 1200 },
      { name: 'פנאי', budget: 1000, actual: 800 },
      { name: 'בריאות', budget: 500, actual: 450 },
    ],
    david: [
      { name: 'מזון', budget: 1500, actual: 1800 },
      { name: 'דיור', budget: 2500, actual: 2500 },
      { name: 'תחבורה', budget: 1000, actual: 800 },
      { name: 'פנאי', budget: 500, actual: 400 },
      { name: 'בריאות', budget: 250, actual: 200 },
    ],
    sarah: [
      { name: 'מזון', budget: 1500, actual: 1800 },
      { name: 'דיור', budget: 2500, actual: 2500 },
      { name: 'תחבורה', budget: 500, actual: 400 },
      { name: 'פנאי', budget: 500, actual: 400 },
      { name: 'בריאות', budget: 250, actual: 250 },
    ]
  },
  categories: {
    all: [
      { name: 'הוצאות קבועות (משכנתא, ביטוח)', value: 6500 },
      { name: 'הוצאות משתנות (מזון, פנאי)', value: 4550 },
    ],
    david: [
      { name: 'הוצאות קבועות', value: 3250 },
      { name: 'הוצאות משתנות', value: 2500 },
    ],
    sarah: [
      { name: 'הוצאות קבועות', value: 3250 },
      { name: 'הוצאות משתנות', value: 2050 },
    ]
  },
  ecosystem: {
    all: {
      liquid: 45000,
      investments: 262000,
      pensions: 330000,
      crypto: 45000,
      realEstate: 1500000,
      mortgage: 850000,
    },
    david: {
      liquid: 25000,
      investments: 230000,
      pensions: 120000,
      crypto: 45000,
      realEstate: 750000,
      mortgage: 425000,
    },
    sarah: {
      liquid: 20000,
      investments: 32000,
      pensions: 210000,
      crypto: 0,
      realEstate: 750000,
      mortgage: 425000,
    }
  }
};

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function Dashboard() {
  const [selectedMonth, setSelectedMonth] = useState('03');
  const [selectedYear, setSelectedYear] = useState('2026');
  const [selectedMember, setSelectedMember] = useState<string>('all');
  
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([
    { id: 'david', name: 'דוד', role: 'הורה', idNumber: '123456782' },
    { id: 'sarah', name: 'שרה', role: 'הורה', idNumber: '876543210' }
  ]);
  const [isFamilyModalOpen, setIsFamilyModalOpen] = useState(false);

  const memberOptions = [
    { id: 'all', label: 'כל המשפחה' },
    ...familyMembers.map(m => ({ id: m.id, label: m.name }))
  ];
  
  // Fallback to 'all' if selected member is deleted
  const safeSelectedMember = mockData.income[selectedMember as keyof typeof mockData.income] ? selectedMember : 'all';

  const [incomes, setIncomes] = useState(mockData.income[safeSelectedMember as keyof typeof mockData.income] || []);
  const [isEditingIncomes, setIsEditingIncomes] = useState(false);
  const [editingIncomesList, setEditingIncomesList] = useState(mockData.income[safeSelectedMember as keyof typeof mockData.income] || []);

  // Update incomes when member changes
  useEffect(() => {
    setIncomes(mockData.income[safeSelectedMember as keyof typeof mockData.income] || []);
  }, [safeSelectedMember]);

  const [insights, setInsights] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Chat State
  const [chatSession, setChatSession] = useState<any>(null);
  const [messages, setMessages] = useState<{role: string, text: string}[]>([
    { role: 'model', text: 'שלום! אני היועץ הפיננסי הווירטואלי שלכם. קראתי את כל הנתונים של חודש מרץ 2026. איך אוכל לעזור לכם היום?' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentBudgetVsActual = mockData.budgetVsActual[safeSelectedMember as keyof typeof mockData.budgetVsActual] || [];
  const currentCategories = mockData.categories[safeSelectedMember as keyof typeof mockData.categories] || [];
  const currentEcosystem = mockData.ecosystem[safeSelectedMember as keyof typeof mockData.ecosystem] || { liquid: 0, investments: 0, pensions: 0, crypto: 0, realEstate: 0, mortgage: 0 };

  const totalIncome = incomes.reduce((sum, item) => sum + item.amount, 0);
  const totalExpenses = currentBudgetVsActual.reduce((sum, item) => sum + item.actual, 0);
  const totalBudget = currentBudgetVsActual.reduce((sum, item) => sum + item.budget, 0);
  const balance = totalIncome - totalExpenses;

  const totalAssets = currentEcosystem.liquid + currentEcosystem.investments + currentEcosystem.pensions + currentEcosystem.crypto + currentEcosystem.realEstate;
  const totalLiabilities = currentEcosystem.mortgage;
  const netWorth = totalAssets - totalLiabilities;

  const ecosystemChartData = [
    { name: 'עו"ש וחסכונות', value: currentEcosystem.liquid, color: '#3b82f6' },
    { name: 'השקעות', value: currentEcosystem.investments, color: '#10b981' },
    { name: 'פנסיה וביטוחים', value: currentEcosystem.pensions, color: '#8b5cf6' },
    { name: 'קריפטו', value: currentEcosystem.crypto, color: '#f59e0b' },
    { name: 'נדל"ן', value: currentEcosystem.realEstate, color: '#64748b' },
  ];

  useEffect(() => {
    async function fetchInsights() {
      setLoading(true);
      const res = await generateFinancialInsights({
        income: incomes,
        budgetVsActual: currentBudgetVsActual,
        categories: currentCategories,
        ecosystem: currentEcosystem
      });
      setInsights(res);
      setLoading(false);
    }
    fetchInsights();
    
    // Initialize Chat Session
    const session = getFinancialChatSession({
      income: incomes,
      budgetVsActual: currentBudgetVsActual,
      categories: currentCategories,
      ecosystem: currentEcosystem
    });
    if (session) {
      setChatSession(session);
    }
  }, [selectedMember, incomes]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

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

  const handlePrevMonth = () => {
    const currentIndex = MONTHS.findIndex(m => m.value === selectedMonth);
    if (currentIndex > 0) {
      setSelectedMonth(MONTHS[currentIndex - 1].value);
    } else {
      setSelectedMonth('12');
      setSelectedYear((parseInt(selectedYear) - 1).toString());
    }
  };

  const handleNextMonth = () => {
    const currentIndex = MONTHS.findIndex(m => m.value === selectedMonth);
    if (currentIndex < 11) {
      setSelectedMonth(MONTHS[currentIndex + 1].value);
    } else {
      setSelectedMonth('01');
      setSelectedYear((parseInt(selectedYear) + 1).toString());
    }
  };

  const handleSaveIncomes = () => {
    setIncomes(editingIncomesList);
    setIsEditingIncomes(false);
  };

  const handleAddIncome = () => {
    const newId = Math.max(0, ...editingIncomesList.map(i => i.id)) + 1;
    setEditingIncomesList([...editingIncomesList, { id: newId, name: 'הכנסה חדשה', amount: 0, date: `01/${selectedMonth}/${selectedYear}` }]);
  };

  const handleUpdateIncome = (id: number, field: string, value: string | number) => {
    setEditingIncomesList(editingIncomesList.map(item => 
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  const handleRemoveIncome = (id: number) => {
    setEditingIncomesList(editingIncomesList.filter(item => item.id !== id));
  };

  const currentMonthLabel = MONTHS.find(m => m.value === selectedMonth)?.label || '';

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
            <CalendarDays className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">לוח תצוגה ראשי - {currentMonthLabel} {selectedYear}</h1>
            <p className="text-sm text-slate-500">אקוסיסטם פיננסי משפחתי כולל</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4">
          {/* Member Selector */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200">
              {memberOptions.map(member => (
                <button
                  key={member.id}
                  onClick={() => setSelectedMember(member.id)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                    selectedMember === member.id 
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
              className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl border border-slate-200 bg-white shadow-sm transition-colors"
              title="ניהול בני משפחה"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>

          {/* Date Selector */}
          <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200">
            <button 
              onClick={handleNextMonth}
              className="p-2 hover:bg-white rounded-lg transition-colors text-slate-600 hover:text-slate-900 shadow-sm"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            
            <div className="flex items-center gap-2 px-2">
              <select 
                value={selectedMonth} 
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-transparent border-none text-slate-800 font-bold text-lg focus:ring-0 cursor-pointer p-0 pr-2"
              >
                {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <span className="text-slate-400 font-bold">/</span>
              <select 
                value={selectedYear} 
                onChange={(e) => setSelectedYear(e.target.value)}
                className="bg-transparent border-none text-slate-800 font-bold text-lg focus:ring-0 cursor-pointer p-0"
              >
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            <button 
              onClick={handlePrevMonth}
              className="p-2 hover:bg-white rounded-lg transition-colors text-slate-600 hover:text-slate-900 shadow-sm"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Net Worth & Ecosystem Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-indigo-600 to-blue-700 p-6 rounded-2xl shadow-md text-white flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-indigo-100">שווי נקי כולל (Net Worth)</h2>
            <Landmark className="w-6 h-6 text-indigo-200" />
          </div>
          <div>
            <p className="text-4xl font-bold mb-1">₪{netWorth.toLocaleString()}</p>
            <div className="flex items-center gap-2 text-sm text-indigo-100">
              <span className="bg-white/20 px-2 py-0.5 rounded-md">נכסים: ₪{totalAssets.toLocaleString()}</span>
              <span className="bg-black/20 px-2 py-0.5 rounded-md">התחייבויות: ₪{totalLiabilities.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 md:col-span-2">
          <h2 className="text-lg font-bold text-slate-800 mb-4">התפלגות נכסים (אקוסיסטם)</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="flex flex-col items-center justify-center p-3 bg-blue-50 rounded-xl border border-blue-100">
              <PiggyBank className="w-5 h-5 text-blue-600 mb-2" />
              <p className="text-xs text-slate-500 mb-1">עו"ש וחסכונות</p>
              <p className="font-bold text-slate-800">₪{(currentEcosystem.liquid / 1000).toFixed(0)}K</p>
            </div>
            <div className="flex flex-col items-center justify-center p-3 bg-emerald-50 rounded-xl border border-emerald-100">
              <TrendingUp className="w-5 h-5 text-emerald-600 mb-2" />
              <p className="text-xs text-slate-500 mb-1">תיק השקעות</p>
              <p className="font-bold text-slate-800">₪{(currentEcosystem.investments / 1000).toFixed(0)}K</p>
            </div>
            <div className="flex flex-col items-center justify-center p-3 bg-purple-50 rounded-xl border border-purple-100">
              <Shield className="w-5 h-5 text-purple-600 mb-2" />
              <p className="text-xs text-slate-500 mb-1">פנסיה וביטוח</p>
              <p className="font-bold text-slate-800">₪{(currentEcosystem.pensions / 1000).toFixed(0)}K</p>
            </div>
            <div className="flex flex-col items-center justify-center p-3 bg-amber-50 rounded-xl border border-amber-100">
              <Bitcoin className="w-5 h-5 text-amber-600 mb-2" />
              <p className="text-xs text-slate-500 mb-1">קריפטו</p>
              <p className="font-bold text-slate-800">₪{(currentEcosystem.crypto / 1000).toFixed(0)}K</p>
            </div>
            <div className="flex flex-col items-center justify-center p-3 bg-slate-50 rounded-xl border border-slate-200">
              <Home className="w-5 h-5 text-slate-600 mb-2" />
              <p className="text-xs text-slate-500 mb-1">נדל"ן</p>
              <p className="font-bold text-slate-800">₪{(currentEcosystem.realEstate / 1000000).toFixed(1)}M</p>
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
            {incomes.map(item => (
              <div key={item.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 hover:bg-slate-100 transition-colors">
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
            ))}
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
                <div className={`p-3 rounded-2xl text-sm shadow-sm max-w-[85%] ${
                  msg.role === 'user' 
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
          <div className="h-72 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={currentBudgetVsActual} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} />
                <Tooltip 
                  cursor={{fill: '#f1f5f9'}}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                <Bar dataKey="budget" name="תקציב" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" name="בפועל" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Categorization */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-800 mb-6">חלוקת הוצאות (קבועות מול משתנות)</h2>
          <div className="h-72 w-full flex items-center justify-center" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={currentCategories}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {currentCategories.map((entry, index) => (
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
        onSave={(updatedMembers) => setFamilyMembers(updatedMembers)}
      />
    </div>
  );
}

