import React, { useState } from 'react';
import { LayoutDashboard, FolderOpen, Network, Menu, X, LogOut, User, Receipt, Compass, TrendingUp, FileText } from 'lucide-react';
import Dashboard from './components/Dashboard';
import FolderLogic from './components/FolderLogic';
import Architecture from './components/Architecture';
import ExpensesBreakdown from './components/ExpensesBreakdown';
import FuturePlanning from './components/FuturePlanning';
import InvestmentsPortfolio from './components/InvestmentsPortfolio';
import CentralExpenseReport from './components/CentralExpenseReport';
import SyncButton from './components/SyncButton';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const tabs = [
    { id: 'dashboard', label: 'לוח תצוגה ראשי', icon: LayoutDashboard },
    { id: 'expenses', label: 'פירוט הוצאות', icon: Receipt },
    { id: 'central-expenses', label: 'דוח הוצאות מרכז', icon: FileText },
    { id: 'investments', label: 'תיק השקעות ופנסיה', icon: TrendingUp },
    { id: 'future', label: 'תכנון עתידי', icon: Compass },
    { id: 'folder', label: 'תיקייה חודשית', icon: FolderOpen },
    { id: 'architecture', label: 'ארכיטקטורה', icon: Network },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard />;
      case 'expenses': return <ExpensesBreakdown />;
      case 'central-expenses': return <CentralExpenseReport />;
      case 'investments': return <InvestmentsPortfolio />;
      case 'future': return <FuturePlanning />;
      case 'folder': return <FolderLogic />;
      case 'architecture': return <Architecture />;
      default: return <Dashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row rtl:flex-row-reverse" dir="rtl">
      
      {/* Mobile Header */}
      <div className="md:hidden bg-white border-b border-slate-200 p-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">
            ₪
          </div>
          <span className="font-bold text-slate-800">תקציב משפחתי</span>
        </div>
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
        >
          {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Sidebar (Desktop) / Drawer (Mobile) */}
      <aside className={`
        fixed inset-y-0 right-0 z-40 w-64 bg-white border-l border-slate-200 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0
        ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'}
      `}>
        <div className="h-full flex flex-col">
          <div className="p-6 hidden md:flex items-center gap-3 border-b border-slate-100">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-sm shadow-blue-200">
              ₪
            </div>
            <span className="font-bold text-xl text-slate-800">תקציב משפחתי</span>
          </div>

          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-50 border border-slate-100 mb-3">
              <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center shrink-0">
                <User className="w-4 h-4" />
              </div>
              <div className="flex-1 text-right truncate">
                <p className="text-sm font-bold text-slate-800 truncate">משפחת כהן</p>
                <p className="text-xs text-slate-500 truncate">Google Auth (Private)</p>
              </div>
            </div>
            
            <div className="mb-3">
              <SyncButton />
            </div>

            <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors font-medium">
              <LogOut className="w-4 h-4" />
              <span>התנתק</span>
            </button>
          </div>

          <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
            {tabs.map((tab) => {
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
                    w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200
                    ${isActive 
                      ? 'bg-blue-50 text-blue-700 font-semibold shadow-sm border border-blue-100' 
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }
                  `}
                >
                  <Icon className={`w-5 h-5 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          {renderContent()}
        </div>
      </main>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-30 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </div>
  );
}
