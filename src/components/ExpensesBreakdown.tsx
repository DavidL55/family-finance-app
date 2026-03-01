import React, { useState, useMemo, useEffect } from 'react';
import { generateExpenses } from '../data/expenses';
import { FileText, FileImage, FileSpreadsheet, Tag, User, CreditCard, Filter, CalendarDays, ChevronLeft, ChevronRight, X, Download, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const MONTHS = [
  { value: '01', label: 'ינואר' }, { value: '02', label: 'פברואר' }, { value: '03', label: 'מרץ' },
  { value: '04', label: 'אפריל' }, { value: '05', label: 'מאי' }, { value: '06', label: 'יוני' },
  { value: '07', label: 'יולי' }, { value: '08', label: 'אוגוסט' }, { value: '09', label: 'ספטמבר' },
  { value: '10', label: 'אוקטובר' }, { value: '11', label: 'נובמבר' }, { value: '12', label: 'דצמבר' }
];

const YEARS = ['2024', '2025', '2026', '2027'];

export default function ExpensesBreakdown() {
  const [selectedMonth, setSelectedMonth] = useState('03');
  const [selectedYear, setSelectedYear] = useState('2026');
  const [expenses, setExpenses] = useState(() => generateExpenses(selectedMonth, selectedYear));
  
  const [filterOwner, setFilterOwner] = useState('הכל');
  const [filterPayment, setFilterPayment] = useState('הכל');
  const [previewFile, setPreviewFile] = useState<any | null>(null);

  // Generate new data when month/year changes
  useEffect(() => {
    setExpenses(generateExpenses(selectedMonth, selectedYear));
    // Reset filters when changing dates
    setFilterOwner('הכל');
    setFilterPayment('הכל');
  }, [selectedMonth, selectedYear]);

  const owners = ['הכל', 'דוד', 'לילית', 'משותף'];
  const paymentMethods = ['הכל', ...Array.from(new Set(expenses.map(e => e.paymentMethod)))];

  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => {
      if (filterOwner !== 'הכל' && e.owner !== filterOwner) return false;
      if (filterPayment !== 'הכל' && e.paymentMethod !== filterPayment) return false;
      return true;
    });
  }, [expenses, filterOwner, filterPayment]);

  const fixedExpenses = filteredExpenses.filter(e => e.type === 'fixed');
  const variableExpenses = filteredExpenses.filter(e => e.type === 'variable');

  const totalFixed = fixedExpenses.reduce((sum, e) => sum + e.amount, 0);
  const totalVariable = variableExpenses.reduce((sum, e) => sum + e.amount, 0);

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

  const renderExpenseList = (list: typeof expenses, title: string, total: number, colorClass: string, bgClass: string) => (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 h-[800px] flex flex-col">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100 shrink-0">
        <h2 className={`text-xl font-bold ${colorClass}`}>{title} ({list.length} רשומות)</h2>
        <div className={`px-4 py-1 rounded-full font-bold ${bgClass} ${colorClass}`}>
          ₪{total.toLocaleString()}
        </div>
      </div>
      <div className="space-y-4 overflow-y-auto flex-1 pr-2 custom-scrollbar">
        {list.length === 0 ? (
          <p className="text-slate-500 text-center py-10">לא נמצאו רשומות התואמות לסינון</p>
        ) : (
          list.map(expense => {
            const Icon = expense.icon;
            return (
              <div key={expense.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors gap-4">
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-xl ${bgClass} ${colorClass} shrink-0`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">{expense.name}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-slate-500">
                      <span className="flex items-center gap-1"><Tag className="w-3 h-3" /> {expense.category}</span>
                      <span className="flex items-center gap-1"><User className="w-3 h-3" /> {expense.owner}</span>
                      <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" /> {expense.paymentMethod}</span>
                      <span>• {expense.date}</span>
                    </div>
                    <button 
                      onClick={() => setPreviewFile(expense)}
                      className="flex items-center gap-1 mt-2 text-xs text-slate-500 bg-slate-100 hover:bg-blue-100 hover:text-blue-700 transition-colors inline-flex px-2 py-1 rounded-md cursor-pointer group"
                    >
                      {expense.fileType === 'pdf' && <FileText className="w-3 h-3 text-red-400 group-hover:text-blue-600" />}
                      {expense.fileType === 'image' && <FileImage className="w-3 h-3 text-blue-400 group-hover:text-blue-600" />}
                      {expense.fileType === 'csv' && <FileSpreadsheet className="w-3 h-3 text-green-400 group-hover:text-blue-600" />}
                      <span className="underline decoration-transparent group-hover:decoration-blue-400 transition-all">מקור: {expense.sourceFile}</span>
                    </button>
                  </div>
                </div>
                <div className="text-left rtl:text-right sm:text-left shrink-0">
                  <p className="font-bold text-slate-800 text-lg">₪{expense.amount.toLocaleString()}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  const currentMonthLabel = MONTHS.find(m => m.value === selectedMonth)?.label || '';

  return (
    <div className="space-y-6">
      {/* Date Selector Header */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
            <CalendarDays className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">פירוט הוצאות - {currentMonthLabel} {selectedYear}</h1>
            <p className="text-sm text-slate-500">מציג {filteredExpenses.length} רשומות שחולצו אוטומטית</p>
          </div>
        </div>

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

      {/* Filters */}
      <div className="flex items-center justify-end gap-3">
        <div className="flex items-center gap-3 bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
          <Filter className="w-5 h-5 text-slate-400 ml-2" />
          <select 
            value={filterOwner} 
            onChange={(e) => setFilterOwner(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
          >
            {owners.map(o => <option key={o} value={o}>שיוך: {o}</option>)}
          </select>
          <select 
            value={filterPayment} 
            onChange={(e) => setFilterPayment(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 max-w-[150px] truncate"
          >
            {paymentMethods.map(p => <option key={p} value={p}>אמצעי: {p}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {renderExpenseList(fixedExpenses, 'הוצאות קבועות', totalFixed, 'text-blue-700', 'bg-blue-50')}
        {renderExpenseList(variableExpenses, 'הוצאות משתנות', totalVariable, 'text-amber-700', 'bg-amber-50')}
      </div>

      {/* File Preview Modal */}
      <AnimatePresence>
        {previewFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setPreviewFile(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white rounded-lg shadow-sm border border-slate-100">
                    {previewFile.fileType === 'pdf' && <FileText className="w-5 h-5 text-red-500" />}
                    {previewFile.fileType === 'image' && <FileImage className="w-5 h-5 text-blue-500" />}
                    {previewFile.fileType === 'csv' && <FileSpreadsheet className="w-5 h-5 text-green-500" />}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-lg">{previewFile.sourceFile}</h3>
                    <p className="text-xs text-slate-500">נשלף מתיקיית Finance_{selectedYear}_{selectedMonth}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                    <Download className="w-5 h-5" />
                  </button>
                  <button className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                    <ExternalLink className="w-5 h-5" />
                  </button>
                  <div className="w-px h-6 bg-slate-200 mx-1"></div>
                  <button 
                    onClick={() => setPreviewFile(null)}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Modal Body - Simulated Document Preview */}
              <div className="p-6 overflow-y-auto bg-slate-100/50 flex-1 flex items-center justify-center min-h-[400px]">
                
                {previewFile.fileType === 'image' && (
                  <div className="bg-white p-8 rounded-lg shadow-md border border-slate-200 w-full max-w-sm transform rotate-1">
                    <div className="text-center border-b-2 border-dashed border-slate-200 pb-4 mb-4">
                      <h4 className="font-bold text-xl text-slate-800">{previewFile.name.split(' - ')[0]}</h4>
                      <p className="text-sm text-slate-500">{previewFile.date}</p>
                    </div>
                    <div className="space-y-3 font-mono text-sm text-slate-600">
                      <div className="flex justify-between"><span>פריט 1</span><span>₪{(previewFile.amount * 0.4).toFixed(2)}</span></div>
                      <div className="flex justify-between"><span>פריט 2</span><span>₪{(previewFile.amount * 0.35).toFixed(2)}</span></div>
                      <div className="flex justify-between"><span>פריט 3</span><span>₪{(previewFile.amount * 0.25).toFixed(2)}</span></div>
                    </div>
                    <div className="mt-6 pt-4 border-t-2 border-slate-800 flex justify-between items-center font-bold text-lg text-slate-900">
                      <span>סך הכל:</span>
                      <span>₪{previewFile.amount.toLocaleString()}</span>
                    </div>
                    <div className="mt-8 text-center text-xs text-slate-400">
                      <p>שולם באמצעות: {previewFile.paymentMethod}</p>
                      <p>תודה שקניתם!</p>
                    </div>
                  </div>
                )}

                {previewFile.fileType === 'pdf' && (
                  <div className="bg-white w-full max-w-2xl min-h-[500px] shadow-lg border border-slate-200 p-10 flex flex-col">
                    <div className="flex justify-between items-start border-b-4 border-blue-600 pb-6 mb-8">
                      <div>
                        <h1 className="text-3xl font-bold text-slate-800">{previewFile.name}</h1>
                        <p className="text-slate-500 mt-1">חשבונית מס / קבלה</p>
                      </div>
                      <div className="text-left rtl:text-right">
                        <p className="font-bold text-slate-700">תאריך: {previewFile.date}</p>
                        <p className="text-slate-500">לכבוד: משפחת כהן ({previewFile.owner})</p>
                      </div>
                    </div>
                    <div className="flex-1">
                      <table className="w-full text-right">
                        <thead>
                          <tr className="border-b-2 border-slate-200 text-slate-600">
                            <th className="py-3 font-bold">תיאור השירות</th>
                            <th className="py-3 font-bold">כמות</th>
                            <th className="py-3 font-bold">סה"כ</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-slate-100">
                            <td className="py-4">{previewFile.category} - חיוב תקופתי</td>
                            <td className="py-4">1</td>
                            <td className="py-4 font-bold">₪{previewFile.amount.toLocaleString()}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-auto pt-8 border-t border-slate-200 flex justify-between items-end">
                      <div className="text-sm text-slate-500">
                        <p>אמצעי תשלום: {previewFile.paymentMethod}</p>
                        <p>המסמך הופק דיגיטלית ואושר ע"י המערכת.</p>
                      </div>
                      <div className="text-2xl font-bold text-blue-700 bg-blue-50 px-6 py-3 rounded-xl">
                        לתשלום: ₪{previewFile.amount.toLocaleString()}
                      </div>
                    </div>
                  </div>
                )}

                {previewFile.fileType === 'csv' && (
                  <div className="bg-white w-full max-w-2xl shadow-sm border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-slate-800 text-white p-4 flex items-center gap-3">
                      <FileSpreadsheet className="w-6 h-6 text-green-400" />
                      <h2 className="font-bold text-lg">ייצוא נתוני אשראי - {previewFile.paymentMethod}</h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                          <tr>
                            <th className="p-3">תאריך עסקה</th>
                            <th className="p-3">שם בית העסק</th>
                            <th className="p-3">סכום חיוב</th>
                            <th className="p-3">קטגוריה</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-slate-100 bg-green-50/50">
                            <td className="p-3 font-medium">{previewFile.date}</td>
                            <td className="p-3 font-bold text-slate-800">{previewFile.name}</td>
                            <td className="p-3 font-bold text-red-600">-₪{previewFile.amount.toLocaleString()}</td>
                            <td className="p-3 text-slate-500">{previewFile.category}</td>
                          </tr>
                          <tr className="border-b border-slate-100">
                            <td className="p-3 text-slate-400">...</td>
                            <td className="p-3 text-slate-400">עסקאות קודמות</td>
                            <td className="p-3 text-slate-400">...</td>
                            <td className="p-3 text-slate-400">...</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


