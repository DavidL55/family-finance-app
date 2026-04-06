import React, { useState, useEffect, useMemo } from 'react';
import { CalendarDays, Loader2 } from 'lucide-react';
import { db } from '../services/firebase';
import { collection, getDocs } from 'firebase/firestore';

const MONTHS_HE = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
const MONTH_KEYS = ['01','02','03','04','05','06','07','08','09','10','11','12'];
const YEARS = ['2024', '2025', '2026', '2027'];

type Matrix = Record<string, Record<string, number>>; // matrix[category][month] = sum

function heatClass(amount: number, avg: number): string {
  if (avg === 0) return '';
  if (amount < avg * 0.8) return 'bg-emerald-50 text-emerald-800';
  if (amount > avg * 1.4) return 'bg-red-100 text-red-800';
  return 'text-slate-700';
}

interface AnnualReportProps {
  onNavigateToExpenses?: (month: string, year: string, category: string) => void;
}

export default function AnnualReport({ onNavigateToExpenses }: AnnualReportProps) {
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear().toString());
  const [matrix, setMatrix]             = useState<Matrix>({});
  const [isLoading, setIsLoading]       = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const m: Matrix = {};

        const addEntry = (category: string, month: string, amount: number) => {
          if (!m[category]) m[category] = {};
          m[category][month] = (m[category][month] ?? 0) + amount;
        };

        // transaction_lines
        const tlSnap = await getDocs(collection(db, 'transaction_lines'));
        tlSnap.docs.forEach(d => {
          const data = d.data();
          if (data.isCredit) return;
          const date: string = data.date ?? '';
          if (!date.startsWith(selectedYear)) return;
          const month = date.substring(5, 7);
          if (!MONTH_KEYS.includes(month)) return;
          addEntry(data.category ?? 'שונות', month, data.amount ?? 0);
        });

        // transactions (legacy)
        const txSnap = await getDocs(collection(db, 'transactions'));
        txSnap.docs.forEach(d => {
          const data = d.data();
          if (data.isCredit) return;
          const date: string = data.date ?? '';
          let month = '';
          if (date.includes('-') && date.startsWith(selectedYear)) {
            month = date.substring(5, 7);
          } else if (date.includes('/')) {
            const parts = date.split('/');
            if (parts[2]?.startsWith(selectedYear)) month = parts[1]?.padStart(2, '0') ?? '';
          }
          if (!month || !MONTH_KEYS.includes(month)) return;
          const cat = data.category ?? 'שונות';
          if (cat === 'הכנסות והשקעות' || cat === 'Income_Investments') return;
          addEntry(cat, month, data.amount ?? 0);
        });

        setMatrix(m);
      } catch (err) {
        console.error('[AnnualReport] load error:', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [selectedYear]);

  const categories = useMemo(() => Object.keys(matrix).sort(), [matrix]);

  const monthlyTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    MONTH_KEYS.forEach(m => {
      totals[m] = categories.reduce((s, cat) => s + (matrix[cat]?.[m] ?? 0), 0);
    });
    return totals;
  }, [matrix, categories]);

  const annualTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    categories.forEach(cat => {
      totals[cat] = MONTH_KEYS.reduce((s, m) => s + (matrix[cat]?.[m] ?? 0), 0);
    });
    return totals;
  }, [matrix, categories]);

  const grandTotal = Object.values(monthlyTotals).reduce((s, v) => s + v, 0);

  const rowAvg = (cat: string) => (annualTotals[cat] ?? 0) / 12;

  const isEmpty = categories.length === 0;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600">
            <CalendarDays className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">דוח שנתי</h1>
            <p className="text-slate-500 text-sm">מטריצת הוצאות לפי קטגוריה וחודש</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2">
          <CalendarDays className="w-4 h-4 text-slate-400" />
          <select
            value={selectedYear}
            onChange={e => setSelectedYear(e.target.value)}
            className="bg-transparent text-slate-800 font-bold text-sm focus:ring-0 border-none cursor-pointer"
          >
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
        </div>
      ) : isEmpty ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center py-24 text-center">
          <CalendarDays className="w-16 h-16 text-slate-200 mb-4" />
          <p className="text-slate-500 font-medium">אין נתונים לשנת {selectedYear}</p>
          <p className="text-slate-400 text-sm mt-1">יבא מסמכים פיננסיים כדי לראות את המטריצה</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {/* Sticky category column header */}
                  <th className="sticky right-0 bg-slate-50 z-10 px-4 py-3 text-right font-semibold text-slate-600 min-w-[140px] border-l border-slate-200">
                    קטגוריה
                  </th>
                  {MONTHS_HE.map((label, i) => (
                    <th key={i} className="px-3 py-3 text-center font-semibold text-slate-500 min-w-[80px]">
                      {label}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center font-bold text-slate-700 min-w-[90px] border-r border-slate-200 bg-slate-100">
                    סה"כ
                  </th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat, rowIdx) => {
                  const avg = rowAvg(cat);
                  return (
                    <tr
                      key={cat}
                      className={`border-b border-slate-100 ${rowIdx % 2 === 0 ? '' : 'bg-slate-50/40'}`}
                    >
                      {/* Category label — sticky */}
                      <td className="sticky right-0 z-10 bg-white px-4 py-2.5 font-medium text-slate-800 border-l border-slate-200 text-right"
                          style={{ backgroundColor: rowIdx % 2 === 0 ? 'white' : 'rgb(248 250 252 / 0.4)' }}>
                        {cat}
                      </td>
                      {MONTH_KEYS.map(month => {
                        const val = matrix[cat]?.[month] ?? 0;
                        const heat = val > 0 ? heatClass(val, avg) : 'text-slate-300';
                        return (
                          <td key={month} className="px-2 py-2.5 text-center">
                            {val > 0 ? (
                              <button
                                onClick={() => onNavigateToExpenses?.(month, selectedYear, cat)}
                                className={`w-full rounded-lg px-1 py-1 text-xs font-semibold tabular-nums transition-all hover:ring-2 hover:ring-blue-300 hover:scale-105 ${heat}`}
                                title={`${cat} — ${MONTHS_HE[parseInt(month) - 1]} ${selectedYear}`}
                              >
                                ₪{val >= 1000 ? `${(val / 1000).toFixed(1)}K` : val.toLocaleString()}
                              </button>
                            ) : (
                              <span className={`text-xs ${heat}`}>—</span>
                            )}
                          </td>
                        );
                      })}
                      {/* Annual total */}
                      <td className="px-4 py-2.5 text-center font-bold text-slate-800 bg-slate-50 border-r border-slate-200 tabular-nums">
                        ₪{(annualTotals[cat] ?? 0).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}

                {/* Monthly totals row */}
                <tr className="bg-slate-800 text-white font-bold border-t-2 border-slate-300">
                  <td className="sticky right-0 z-10 bg-slate-800 px-4 py-3 text-right border-l border-slate-600">
                    סה"כ חודשי
                  </td>
                  {MONTH_KEYS.map(month => (
                    <td key={month} className="px-2 py-3 text-center tabular-nums text-xs">
                      {monthlyTotals[month] > 0
                        ? `₪${monthlyTotals[month] >= 1000 ? `${(monthlyTotals[month] / 1000).toFixed(1)}K` : monthlyTotals[month].toLocaleString()}`
                        : '—'}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-center bg-slate-700 border-r border-slate-600 tabular-nums">
                    ₪{grandTotal.toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Heat-map legend */}
          <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-4 text-xs text-slate-500">
            <span>מקרא:</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-emerald-100"></span>נמוך מהממוצע</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-red-100"></span>גבוה מהממוצע</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-slate-100"></span>בסביבות הממוצע</span>
            <span className="mr-auto text-slate-400">לחץ על תא לפירוט</span>
          </div>
        </div>
      )}
    </div>
  );
}
