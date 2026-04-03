import React, { useState, useEffect } from 'react';
import { TrendingUp, Briefcase, ArrowUpRight, Plus, Shield, Bitcoin, Landmark, X, PieChart as PieChartIcon, Activity } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import AssetCard, { Investment, TypeConfig, AssetUpdateData } from './AssetCard';
import { db } from '../services/firebase';
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';

type InvestmentType = 'investment' | 'pension' | 'insurance' | 'crypto';

const TYPE_CONFIG: Record<InvestmentType, TypeConfig> = {
  investment: { label: 'השקעות', icon: Landmark, color: 'text-blue-600', bg: 'bg-blue-50', chartColor: '#3b82f6' },
  pension: { label: 'פנסיה', icon: Briefcase, color: 'text-emerald-600', bg: 'bg-emerald-50', chartColor: '#10b981' },
  insurance: { label: 'ביטוח', icon: Shield, color: 'text-purple-600', bg: 'bg-purple-50', chartColor: '#8b5cf6' },
  crypto: { label: 'קריפטו', icon: Bitcoin, color: 'text-amber-600', bg: 'bg-amber-50', chartColor: '#f59e0b' },
};

export default function InvestmentsPortfolio() {
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [newItem, setNewItem] = useState<Partial<Investment>>({
    name: '',
    type: 'investment',
    value: 0,
    monthlyDeposit: 0,
    returnPct: 0,
  });

  // Load investments from Firestore on mount
  useEffect(() => {
    const loadInvestments = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'investments'));
        if (!snapshot.empty) {
          const loaded: Investment[] = snapshot.docs.map((d, index) => ({
            id: (d.data().id as number) || index + 1,
            firestoreId: d.id,
            name: d.data().name as string,
            type: d.data().type as string,
            value: d.data().value as number,
            monthlyDeposit: d.data().monthlyDeposit as number,
            returnPct: d.data().returnPct as number,
            returnVal: d.data().returnVal as number,
          }));
          setInvestments(loaded);
        }
      } catch (error) {
        console.error('[InvestmentsPortfolio] Failed to load investments:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadInvestments();
  }, []);

  const totalValue = investments.reduce((sum, inv) => sum + inv.value, 0);
  const totalMonthly = investments.reduce((sum, inv) => sum + inv.monthlyDeposit, 0);
  const totalReturn = investments.reduce((sum, inv) => sum + inv.returnVal, 0);

  const handleUpdateAsset = async (id: number, data: AssetUpdateData) => {
    setInvestments(prev => prev.map(inv => {
      if (inv.id !== id) return inv;

      const newValue = data.currentBalance ?? inv.value;
      const newReturnPct = data.yieldPercentage ?? inv.returnPct;
      const updated: Investment = {
        ...inv,
        value: newValue,
        monthlyDeposit: data.monthlyContribution ?? inv.monthlyDeposit,
        returnPct: newReturnPct,
        returnVal: newValue * (newReturnPct / 100),
      };

      if (inv.firestoreId) {
        updateDoc(doc(db, 'investments', inv.firestoreId), {
          value: updated.value,
          monthlyDeposit: updated.monthlyDeposit,
          returnPct: updated.returnPct,
          returnVal: updated.returnVal,
          updated_at: serverTimestamp(),
        }).catch(err => console.error('[InvestmentsPortfolio] Failed to update investment:', err));
      }

      return updated;
    }));
  };

  const handleSave = async () => {
    if (!newItem.name) return;

    const value = Number(newItem.value) || 0;
    const returnPct = Number(newItem.returnPct) || 0;
    const returnVal = value * (returnPct / 100);
    const nextId = Math.max(0, ...investments.map(i => i.id)) + 1;

    const investmentData = {
      id: nextId,
      name: newItem.name,
      type: newItem.type as InvestmentType,
      value,
      monthlyDeposit: Number(newItem.monthlyDeposit) || 0,
      returnPct,
      returnVal,
    };

    try {
      const docRef = await addDoc(collection(db, 'investments'), {
        ...investmentData,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });

      const investment: Investment = { ...investmentData, firestoreId: docRef.id };
      setInvestments(prev => [...prev, investment]);
    } catch (error) {
      console.error('[InvestmentsPortfolio] Failed to save investment:', error);
    }

    setIsModalOpen(false);
    setNewItem({ name: '', type: 'investment', value: 0, monthlyDeposit: 0, returnPct: 0 });
  };

  const chartData = Object.entries(TYPE_CONFIG).map(([type, config]) => {
    const value = investments.filter(i => i.type === type).reduce((sum, i) => sum + i.value, 0);
    return { name: config.label, value, color: config.chartColor };
  }).filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">תיק השקעות ופנסיה</h1>
          <p className="text-slate-500 mt-1">מעקב דינמי אחר חסכונות, פנסיה, ביטוחים וקריפטו</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl shadow-sm flex items-center gap-2 transition-colors font-medium"
        >
          <Plus className="w-5 h-5" />
          הוסף נכס חדש
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-500 font-medium">שווי כולל</p>
            <p className="text-2xl font-bold text-slate-800">₪{totalValue.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-500 font-medium">הפקדות חודשיות</p>
            <p className="text-2xl font-bold text-slate-800">₪{totalMonthly.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <ArrowUpRight className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-slate-500 font-medium">רווח משוער (שנתי)</p>
            <p className="text-2xl font-bold text-emerald-600">+₪{totalReturn.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-500">
          <Activity className="w-6 h-6 animate-spin mr-2" />
          טוען נתונים...
        </div>
      ) : investments.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
          <TrendingUp className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-600 mb-2">אין נכסים עדיין</h3>
          <p className="text-slate-400 mb-6">הוסף את הנכסים, הפנסיה וההשקעות שלך כדי להתחיל לעקוב</p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-medium transition-colors inline-flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            הוסף נכס ראשון
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 lg:col-span-1">
            <div className="flex items-center gap-2 mb-6">
              <PieChartIcon className="w-6 h-6 text-slate-600" />
              <h2 className="text-lg font-bold text-slate-800">התפלגות התיק</h2>
            </div>
            <div className="h-64 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => `₪${value.toLocaleString()}`}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Portfolio List */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 lg:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <Briefcase className="w-6 h-6 text-indigo-600" />
              <h2 className="text-lg font-bold text-slate-800">פירוט נכסים</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {investments.map(inv => {
                const config = TYPE_CONFIG[inv.type as InvestmentType] || TYPE_CONFIG.investment;
                return (
                  <AssetCard
                    key={inv.id}
                    inv={inv}
                    config={config}
                    onUpdate={(id, data) => { void handleUpdateAsset(id, data); }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Add Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setIsModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                    <Plus className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-slate-800 text-lg">הוספת נכס חדש</h3>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">סוג הנכס</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.entries(TYPE_CONFIG) as [InvestmentType, TypeConfig][]).map(([type, config]) => {
                      const Icon = config.icon;
                      const isSelected = newItem.type === type;
                      return (
                        <button
                          key={type}
                          onClick={() => setNewItem({ ...newItem, type })}
                          className={`flex items-center gap-2 p-3 rounded-xl border transition-all ${isSelected
                            ? `border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500`
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                            }`}
                        >
                          <Icon className={`w-5 h-5 ${isSelected ? config.color : 'text-slate-400'}`} />
                          <span className={`font-medium text-sm ${isSelected ? 'text-slate-800' : 'text-slate-600'}`}>
                            {config.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">שם הנכס / קופה</label>
                  <input
                    type="text"
                    value={newItem.name}
                    onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                    placeholder="לדוגמה: קרן השתלמות מגדל"
                    className="w-full bg-white border border-slate-200 text-slate-800 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">שווי נוכחי (₪)</label>
                    <input
                      type="number"
                      value={newItem.value || ''}
                      onChange={(e) => setNewItem({ ...newItem, value: Number(e.target.value) })}
                      className="w-full bg-white border border-slate-200 text-slate-800 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">הפקדה חודשית (₪)</label>
                    <input
                      type="number"
                      value={newItem.monthlyDeposit || ''}
                      onChange={(e) => setNewItem({ ...newItem, monthlyDeposit: Number(e.target.value) })}
                      placeholder="0 אם אין"
                      className="w-full bg-white border border-slate-200 text-slate-800 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">תשואה שנתית משוערת (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newItem.returnPct || ''}
                    onChange={(e) => setNewItem({ ...newItem, returnPct: Number(e.target.value) })}
                    className="w-full bg-white border border-slate-200 text-slate-800 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
                  />
                </div>

                <button
                  onClick={handleSave}
                  disabled={!newItem.name || !newItem.value}
                  className="w-full mt-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  שמור נכס
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
