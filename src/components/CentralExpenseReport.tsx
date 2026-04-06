import React, { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp, ReceiptText, Tag, Loader2 } from 'lucide-react';
import { db } from '../services/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';

type ExpenseClassification = 'Fixed' | 'Semi-Variable' | 'Variable' | 'Unclassified';

interface TransactionEntry {
  id: string;
  vendor: string;
  amount: number;
  date: string;
  category: string;
  expenseClassification: ExpenseClassification;
  owner?: string;
}

const MONTHS = [
  { value: '01', label: 'ינואר' }, { value: '02', label: 'פברואר' }, { value: '03', label: 'מרץ' },
  { value: '04', label: 'אפריל' }, { value: '05', label: 'מאי' }, { value: '06', label: 'יוני' },
  { value: '07', label: 'יולי' }, { value: '08', label: 'אוגוסט' }, { value: '09', label: 'ספטמבר' },
  { value: '10', label: 'אוקטובר' }, { value: '11', label: 'נובמבר' }, { value: '12', label: 'דצמבר' },
];
const YEARS = ['2024', '2025', '2026', '2027'];

const SECTIONS: { key: ExpenseClassification; label: string; target: number; color: string; bar: string; bg: string }[] = [
  { key: 'Fixed',        label: 'הוצאות קבועות',        target: 60, color: 'text-indigo-700',  bar: 'bg-indigo-500',  bg: 'bg-indigo-50' },
  { key: 'Semi-Variable', label: 'הוצאות חצי-משתנות',   target: 20, color: 'text-amber-700',   bar: 'bg-amber-400',   bg: 'bg-amber-50'  },
  { key: 'Variable',     label: 'הוצאות משתנות',        target: 20, color: 'text-rose-700',    bar: 'bg-rose-500',    bg: 'bg-rose-50'   },
];

function classificationBadge(pct: number, target: number) {
  const diff = pct - target;
  if (diff <= 5)  return 'bg-emerald-100 text-emerald-700';
  if (diff <= 15) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

export default function CentralExpenseReport() {
  const [selectedMonth, setSelectedMonth] = useState(() => String(new Date().getMonth() + 1).padStart(2, '0'));
  const [selectedYear, setSelectedYear]   = useState(() => new Date().getFullYear().toString());
  const [entries, setEntries]             = useState<TransactionEntry[]>([]);
  const [totalIncome, setTotalIncome]     = useState(0);
  const [isLoading, setIsLoading]         = useState(true);
  const [expanded, setExpanded]           = useState<Record<string, boolean>>({ Fixed: true });

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const prefix = `${selectedYear}-${selectedMonth}`;
        const all: TransactionEntry[] = [];

        // transaction_lines (new)
        const tlSnap = await getDocs(collection(db, 'transaction_lines'));
        tlSnap.docs.forEach(d => {
          const data = d.data();
          if (data.isCredit) return;
          const date: string = data.date ?? '';
          if (!date.startsWith(prefix)) return;
          all.push({
            id: `tl-${d.id}`,
            vendor: data.vendor ?? data.description ?? '—',
            amount: data.amount ?? 0,
            date,
            category: data.category ?? 'שונות',
            expenseClassification: (data.expenseClassification as ExpenseClassification) ?? 'Unclassified',
            owner: data.owner,
          });
        });

        // transactions (legacy)
        const txSnap = await getDocs(collection(db, 'transactions'));
        txSnap.docs.forEach(d => {
          const data = d.data();
          if (data.isCredit) return;
          const date: string = data.date ?? '';
          const isThisMonth = date.startsWith(prefix) ||
            (date.includes('/') && date.split('/')[1] === selectedMonth && date.split('/')[2]?.startsWith(selectedYear));
          if (!isThisMonth) return;
          if (data.category === 'הכנסות והשקעות' || data.category === 'Income_Investments') return;
          all.push({
            id: `tx-${d.id}`,
            vendor: data.vendor ?? '—',
            amount: data.amount ?? 0,
            date,
            category: data.category ?? 'שונות',
            expenseClassification: (data.expenseClassification as ExpenseClassification) ?? 'Unclassified',
            owner: data.owner,
          });
        });

        setEntries(all);

        // Income for the month
        const incomeSnap = await getDocs(
          query(collection(db, 'incomes'), where('month', '==', selectedMonth), where('year', '==', selectedYear))
        );
        const income = incomeSnap.docs.reduce((s, d) => s + ((d.data().amount as number) ?? 0), 0);
        setTotalIncome(income);
      } catch (err) {
        console.error('[CentralExpenseReport] load error:', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [selectedMonth, selectedYear]);

  const groups = useMemo(() => {
    const g: Record<ExpenseClassification, TransactionEntry[]> = {
      Fixed: [], 'Semi-Variable': [], Variable: [], Unclassified: [],
    };
    entries.forEach(e => { g[e.expenseClassification].push(e); });
    return g;
  }, [entries]);

  const grandTotal = entries.reduce((s, e) => s + e.amount, 0);
  const incomeBase = totalIncome > 0 ? totalIncome : grandTotal || 1;

  const currentMonthLabel = MONTHS.find(m => m.value === selectedMonth)?.label ?? '';

  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600">
            <ReceiptText className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">דוח הוצאות מרכז</h1>
            <p className="text-slate-500 text-sm">60/20/20 — {currentMonthLabel} {selectedYear}</p>
          </div>
        </div>

        {/* Month/Year selector */}
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-1.5">
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="bg-transparent text-slate-800 font-semibold text-sm focus:ring-0 border-none cursor-pointer"
          >
            {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <span className="text-slate-300">/</span>
          <select
            value={selectedYear}
            onChange={e => setSelectedYear(e.target.value)}
            className="bg-transparent text-slate-800 font-semibold text-sm focus:ring-0 border-none cursor-pointer"
          >
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
        </div>
      ) : (
        <>
          {/* Three classification sections */}
          {SECTIONS.map(section => {
            const items = groups[section.key];
            const sectionTotal = items.reduce((s, e) => s + e.amount, 0);
            const pct = Math.round((sectionTotal / incomeBase) * 100);
            const badgeCls = classificationBadge(pct, section.target);
            const isExpanded = expanded[section.key];

            return (
              <div key={section.key} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <button
                  onClick={() => toggle(section.key)}
                  className="w-full flex items-center justify-between p-4 md:p-5 hover:bg-slate-50 transition-colors text-right"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${section.bg}`}>
                      {isExpanded
                        ? <ChevronUp className={`w-5 h-5 ${section.color}`} />
                        : <ChevronDown className={`w-5 h-5 ${section.color}`} />}
                    </div>
                    <span className={`font-bold text-lg ${section.color}`}>{section.label}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badgeCls}`}>
                      {pct}% {pct > section.target ? '↑' : '✓'} יעד: {section.target}%
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right hidden sm:block">
                      <p className="text-xs text-slate-400">{items.length} עסקאות</p>
                    </div>
                    <span className="font-bold text-slate-800 text-lg" dir="ltr">
                      ₪{sectionTotal.toLocaleString()}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50">
                    {items.length === 0 ? (
                      <p className="text-center py-6 text-sm text-slate-400">אין עסקאות בקטגוריה זו</p>
                    ) : (
                      <>
                        {/* Desktop table */}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="w-full text-right text-sm">
                            <thead>
                              <tr className="text-slate-400 border-b border-slate-200 text-xs">
                                <th className="px-5 py-3 font-medium">תאריך</th>
                                <th className="px-5 py-3 font-medium">ספק</th>
                                <th className="px-5 py-3 font-medium">קטגוריה</th>
                                <th className="px-5 py-3 font-medium">בעלים</th>
                                <th className="px-5 py-3 font-medium text-left">סכום</th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map(e => (
                                <tr key={e.id} className="border-b border-slate-100 last:border-0 hover:bg-white transition-colors">
                                  <td className="px-5 py-3 text-slate-500 tabular-nums">{e.date}</td>
                                  <td className="px-5 py-3 font-medium text-slate-800">{e.vendor}</td>
                                  <td className="px-5 py-3">
                                    <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full">{e.category}</span>
                                  </td>
                                  <td className="px-5 py-3 text-slate-500 text-xs">{e.owner ?? '—'}</td>
                                  <td className="px-5 py-3 font-bold text-slate-800 text-left" dir="ltr">₪{e.amount.toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile cards */}
                        <div className="md:hidden space-y-2 p-3">
                          {items.map(e => (
                            <div key={e.id} className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between">
                              <div>
                                <p className="font-medium text-slate-800 text-sm">{e.vendor}</p>
                                <p className="text-xs text-slate-400">{e.date} · {e.category}</p>
                              </div>
                              <span className="font-bold text-slate-800" dir="ltr">₪{e.amount.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Unclassified (legacy records) — shown only if non-empty */}
          {groups.Unclassified.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden opacity-80">
              <button
                onClick={() => toggle('Unclassified')}
                className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors text-right"
              >
                <div className="flex items-center gap-3">
                  <Tag className="w-5 h-5 text-slate-400" />
                  <span className="font-semibold text-slate-500">לא מסווג (רשומות ישנות)</span>
                </div>
                <span className="font-bold text-slate-600" dir="ltr">
                  ₪{groups.Unclassified.reduce((s, e) => s + e.amount, 0).toLocaleString()}
                </span>
              </button>
              {expanded.Unclassified && (
                <div className="border-t border-slate-100 bg-slate-50 p-3 space-y-2 md:hidden">
                  {groups.Unclassified.map(e => (
                    <div key={e.id} className="bg-white p-3 rounded-xl border border-slate-100 flex justify-between">
                      <span className="text-sm text-slate-700">{e.vendor}</span>
                      <span className="font-bold text-slate-700 text-sm" dir="ltr">₪{e.amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Grand total footer */}
          <div className="bg-slate-800 text-white rounded-2xl p-5 md:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
            <div>
              <p className="text-slate-400 text-sm">סה"כ הוצאות</p>
              <p className="text-3xl font-bold">₪{grandTotal.toLocaleString()}</p>
            </div>
            {totalIncome > 0 && (
              <div className="text-right">
                <p className="text-slate-400 text-sm">מתוך הכנסה</p>
                <p className="text-xl font-bold text-emerald-400">₪{totalIncome.toLocaleString()}</p>
                <p className="text-xs text-slate-400 mt-0.5">{Math.round((grandTotal / totalIncome) * 100)}% מההכנסה</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
