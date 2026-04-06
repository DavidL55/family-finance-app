import React, { useState, useMemo, useEffect } from 'react';
import { FileText, FileImage, FileSpreadsheet, Tag, User, CreditCard, Filter, CalendarDays, ChevronLeft, ChevronRight, X, Download, ExternalLink, Loader2, InboxIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { db } from '../services/firebase';
import { collection, getDocs } from 'firebase/firestore';

const MONTHS = [
  { value: '01', label: 'ינואר' }, { value: '02', label: 'פברואר' }, { value: '03', label: 'מרץ' },
  { value: '04', label: 'אפריל' }, { value: '05', label: 'מאי' }, { value: '06', label: 'יוני' },
  { value: '07', label: 'יולי' }, { value: '08', label: 'אוגוסט' }, { value: '09', label: 'ספטמבר' },
  { value: '10', label: 'אוקטובר' }, { value: '11', label: 'נובמבר' }, { value: '12', label: 'דצמבר' }
];

const YEARS = ['2024', '2025', '2026', '2027'];

interface TransactionEntry {
  id: string;
  name: string;
  amount: number;
  date: string;
  category: string;
  sourceFile: string;
  fileType: 'pdf' | 'image' | 'csv';
  owner?: string;
  paymentMethod?: string;
  paymentType?: string;
  installmentNumber?: number;
  totalInstallments?: number;
  isCredit?: boolean;
  documentId?: string;
  issuer?: string;
}

function parseTransactionDate(dateStr: string): { month: string; year: string } {
  if (!dateStr) return { month: '', year: '' };

  if (dateStr.includes('/')) {
    // DD/MM/YYYY
    const parts = dateStr.split('/');
    return { month: parts[1] ?? '', year: parts[2] ?? '' };
  }
  if (dateStr.includes('-')) {
    // YYYY-MM-DD
    const parts = dateStr.split('-');
    return { month: parts[1] ?? '', year: parts[0] ?? '' };
  }
  return { month: '', year: '' };
}

function guessFileType(fileName: string): 'pdf' | 'image' | 'csv' {
  if (!fileName) return 'pdf';
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.csv') || lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'csv';
  return 'image';
}

export default function ExpensesBreakdown() {
  const [selectedMonth, setSelectedMonth] = useState(() => String(new Date().getMonth() + 1).padStart(2, '0'));
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear().toString());
  const [expenses, setExpenses] = useState<TransactionEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [filterOwner, setFilterOwner] = useState('הכל');
  const [filterPayment, setFilterPayment] = useState('הכל');
  const [previewFile, setPreviewFile] = useState<TransactionEntry | null>(null);

  // Load transactions from Firestore for the selected month/year
  // Reads from both transaction_lines (new) and transactions (legacy)
  useEffect(() => {
    const loadTransactions = async () => {
      setIsLoading(true);
      setFilterOwner('הכל');
      setFilterPayment('הכל');

      try {
        const entries: TransactionEntry[] = [];

        // NEW: transaction_lines collection
        const linesSnap = await getDocs(collection(db, 'transaction_lines'));
        linesSnap.docs.forEach(d => {
          const tx = d.data();
          const txDate = (tx.date as string) || '';
          const { month, year } = parseTransactionDate(txDate);

          if (month === selectedMonth && year === selectedYear) {
            const cat = (tx.category as string) || 'שונות';
            // Exclude income/credit entries from expense view (except credits which are refunds)
            if (!tx.isCredit || tx.paymentType === 'refund' || tx.paymentType === 'cancellation') {
              entries.push({
                id: d.id,
                name: (tx.vendor as string) || (tx.description as string) || 'לא ידוע',
                amount: (tx.amount as number) || 0,
                date: txDate,
                category: cat,
                sourceFile: (tx.issuer as string) || '',
                fileType: 'pdf',
                owner: tx.owner as string | undefined,
                paymentMethod: tx.paymentType as string | undefined,
                paymentType: tx.paymentType as string | undefined,
                installmentNumber: tx.installmentNumber as number | undefined,
                totalInstallments: tx.totalInstallments as number | undefined,
                isCredit: tx.isCredit as boolean | undefined,
                documentId: tx.documentId as string | undefined,
                issuer: tx.issuer as string | undefined,
              });
            }
          }
        });

        // LEGACY: transactions collection (old imports)
        const legacySnap = await getDocs(collection(db, 'transactions'));
        legacySnap.docs.forEach(d => {
          const tx = d.data();
          const txDate = (tx.date as string) || '';
          const { month, year } = parseTransactionDate(txDate);

          if (month === selectedMonth && year === selectedYear) {
            const cat = (tx.category as string) || 'אחר';
            if (cat !== 'Income_Investments') {
              entries.push({
                id: d.id,
                name: (tx.vendor as string) || 'לא ידוע',
                amount: (tx.amount as number) || 0,
                date: txDate,
                category: cat,
                sourceFile: (tx.fileName as string) || '',
                fileType: guessFileType((tx.fileName as string) || ''),
                owner: tx.owner as string | undefined,
                paymentMethod: tx.paymentMethod as string | undefined,
              });
            }
          }
        });

        // Sort by date descending
        entries.sort((a, b) => {
          const da = a.date.includes('/') ? a.date.split('/').reverse().join('-') : a.date;
          const db2 = b.date.includes('/') ? b.date.split('/').reverse().join('-') : b.date;
          return db2.localeCompare(da);
        });

        setExpenses(entries);
      } catch (err) {
        console.error('Failed to load transactions:', err);
        setExpenses([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadTransactions();
  }, [selectedMonth, selectedYear]);

  const owners = useMemo(() => {
    const unique = Array.from(new Set(expenses.map(e => e.owner).filter(Boolean))) as string[];
    return ['הכל', ...unique];
  }, [expenses]);

  const paymentMethods = useMemo(() => {
    const unique = Array.from(new Set(expenses.map(e => e.paymentMethod).filter(Boolean))) as string[];
    return ['הכל', ...unique];
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => {
      if (filterOwner !== 'הכל' && e.owner !== filterOwner) return false;
      if (filterPayment !== 'הכל' && e.paymentMethod !== filterPayment) return false;
      return true;
    });
  }, [expenses, filterOwner, filterPayment]);

  const totalAmount = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

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
            <p className="text-sm text-slate-500">
              {isLoading ? 'טוען...' : `מציג ${filteredExpenses.length} רשומות`}
            </p>
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
      {expenses.length > 0 && (
        <div className="flex items-center justify-end gap-3">
          <div className="flex items-center gap-3 bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
            <Filter className="w-5 h-5 text-slate-400 ml-2" />
            {owners.length > 1 && (
              <select
                value={filterOwner}
                onChange={(e) => setFilterOwner(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
              >
                {owners.map(o => <option key={o} value={o}>שיוך: {o}</option>)}
              </select>
            )}
            {paymentMethods.length > 1 && (
              <select
                value={filterPayment}
                onChange={(e) => setFilterPayment(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 max-w-[150px] truncate"
              >
                {paymentMethods.map(p => <option key={p} value={p}>אמצעי: {p}</option>)}
              </select>
            )}
          </div>
        </div>
      )}

      {/* Expenses List */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 min-h-[400px] flex flex-col">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100 shrink-0">
          <h2 className="text-xl font-bold text-blue-700">הוצאות ({filteredExpenses.length} רשומות)</h2>
          <div className="px-4 py-1 rounded-full font-bold bg-blue-50 text-blue-700">
            ₪{totalAmount.toLocaleString()}
          </div>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-10 h-10 animate-spin text-blue-300" />
          </div>
        ) : filteredExpenses.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
            <InboxIcon className="w-16 h-16 text-slate-200 mb-4" />
            <p className="text-slate-500 font-medium">אין הוצאות לחודש זה</p>
            <p className="text-sm text-slate-400 mt-2">
              סנכרן קבצים מגוגל דרייב כדי לטעון עסקאות אמיתיות.
            </p>
          </div>
        ) : (
          <div className="space-y-4 overflow-y-auto flex-1 pr-2 custom-scrollbar">
            {filteredExpenses.map(expense => (
              <div key={expense.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors gap-4">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-blue-50 text-blue-700 shrink-0">
                    <Tag className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">{expense.name}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-slate-500">
                      <span className="flex items-center gap-1"><Tag className="w-3 h-3" /> {expense.category}</span>
                      {expense.owner && (
                        <span className="flex items-center gap-1"><User className="w-3 h-3" /> {expense.owner}</span>
                      )}
                      {expense.paymentMethod && (
                        <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" /> {expense.paymentMethod}</span>
                      )}
                      <span>• {expense.date}</span>
                    </div>
                    {expense.sourceFile && (
                      <button
                        onClick={() => setPreviewFile(expense)}
                        className="flex items-center gap-1 mt-2 text-xs text-slate-500 bg-slate-100 hover:bg-blue-100 hover:text-blue-700 transition-colors inline-flex px-2 py-1 rounded-md cursor-pointer group"
                      >
                        {expense.fileType === 'pdf' && <FileText className="w-3 h-3 text-red-400 group-hover:text-blue-600" />}
                        {expense.fileType === 'image' && <FileImage className="w-3 h-3 text-blue-400 group-hover:text-blue-600" />}
                        {expense.fileType === 'csv' && <FileSpreadsheet className="w-3 h-3 text-green-400 group-hover:text-blue-600" />}
                        <span className="underline decoration-transparent group-hover:decoration-blue-400 transition-all">מקור: {expense.sourceFile}</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-left rtl:text-right sm:text-left shrink-0">
                  <p className="font-bold text-slate-800 text-lg">₪{expense.amount.toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
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
                    <p className="text-xs text-slate-500">מקור: {previewFile.name}</p>
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

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto bg-slate-100/50 flex-1 flex items-center justify-center min-h-[300px]">
                <div className="bg-white w-full max-w-2xl shadow-sm border border-slate-200 rounded-xl p-8 text-center">
                  <div className="mb-4">
                    {previewFile.fileType === 'pdf' && <FileText className="w-16 h-16 mx-auto text-red-400" />}
                    {previewFile.fileType === 'image' && <FileImage className="w-16 h-16 mx-auto text-blue-400" />}
                    {previewFile.fileType === 'csv' && <FileSpreadsheet className="w-16 h-16 mx-auto text-green-400" />}
                  </div>
                  <h3 className="font-bold text-slate-800 text-xl mb-2">{previewFile.name}</h3>
                  <p className="text-slate-500 mb-1">{previewFile.date}</p>
                  <p className="text-slate-500 mb-4">{previewFile.category}</p>
                  <div className="text-2xl font-bold text-blue-700 bg-blue-50 px-6 py-3 rounded-xl inline-block">
                    ₪{previewFile.amount.toLocaleString()}
                  </div>
                  <p className="text-xs text-slate-400 mt-4">
                    הקובץ שמור בגוגל דרייב. לצפייה בקובץ המקורי, פתח את תיקיית Drive.
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
