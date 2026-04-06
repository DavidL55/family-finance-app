import React, { useState, useEffect } from 'react';
import { LayoutDashboard, FolderOpen, Menu, X, LogOut, User, Receipt, Compass, TrendingUp, FileText, CalendarDays, Loader2 } from 'lucide-react';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { auth } from './services/firebase';
import Dashboard from './components/Dashboard';
import FolderLogic from './components/FolderLogic';
import ExpensesBreakdown from './components/ExpensesBreakdown';
import FuturePlanning from './components/FuturePlanning';
import InvestmentsPortfolio from './components/InvestmentsPortfolio';
import CentralExpenseReport from './components/CentralExpenseReport';
import AnnualReport from './components/AnnualReport';
import SyncButton from './components/SyncButton';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setAuthReady(true);
      } else {
        signInAnonymously(auth).catch((err) => {
          console.error('[Auth] Anonymous sign-in failed:', err);
          setAuthReady(true); // still render, Firestore will show permission errors
        });
      }
    });
    return unsubscribe;
  }, []);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <span className="text-sm">טוען...</span>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'dashboard', label: 'לוח תצוגה ראשי', icon: LayoutDashboard },
    { id: 'expenses', label: 'פירוט הוצאות', icon: Receipt },
    { id: 'central-expenses', label: 'דוח הוצאות מרכז', icon: FileText },
    { id: 'investments', label: 'תיק השקעות ופנסיה', icon: TrendingUp },
    { id: 'future', label: 'תכנון עתידי', icon: Compass },
    { id: 'annual', label: 'דוח שנתי', icon: CalendarDays },
    { id: 'folder', label: 'תיקייה חודשית', icon: FolderOpen },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard />;
      case 'expenses': return <ExpensesBreakdown />;
      case 'central-expenses': return <CentralExpenseReport />;
      case 'investments': return <InvestmentsPortfolio />;
      case 'future': return <FuturePlanning />;
      case 'annual': return (
        <AnnualReport
          onNavigateToExpenses={(month, year, _category) => {
            setActiveTab('expenses');
            // ExpensesBreakdown reads its own state; pass via sessionStorage as a simple bridge
            sessionStorage.setItem('expensesFilter', JSON.stringify({ month, year }));
          }}
        />
      );
      case 'folder': return <FolderLogic />;
      default: return <Dashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col rtl" dir="rtl">

      {/* Top Header (Mobile & Desktop) */}
      <div className="bg-white border-b border-slate-200 p-3 md:p-4 flex items-center justify-between sticky top-0 z-50 w-full">
        <div className="flex items-center gap-2">
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
          <button className="p-2 text-slate-500 hover:text-red-600 transition-colors">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>

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
                  onClick={() => setActiveTab(tab.id)}
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
          </nav>
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
                  onClick={() => setActiveTab(tab.id)}
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
                      onClick={() => {
                        setActiveTab(tab.id);
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
