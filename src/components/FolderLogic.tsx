import React, { useState, useRef } from 'react';
import { Folder, FileText, FileImage, FileSpreadsheet, ChevronDown, ChevronLeft, HardDrive, Calendar, CreditCard, Receipt, FileBarChart, Upload, X, CheckCircle2, RefreshCw, FolderPlus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const months = [
  '01_ינואר', '02_פברואר', '03_מרץ', '04_אפריל', '05_מאי', '06_יוני',
  '07_יולי', '08_אוגוסט', '09_ספטמבר', '10_אוקטובר', '11_נובמבר', '12_דצמבר'
];

const YEARS = ['2024', '2025', '2026', '2027'];

const subFolders = [
  { id: 'cc', name: 'דוחות כרטיסי אשראי', icon: CreditCard, color: 'text-blue-500' },
  { id: 'receipts', name: 'קבלות וחשבוניות (JPG/PDF)', icon: Receipt, color: 'text-amber-500' },
  { id: 'banks', name: 'דוחות בנק (אקסל)', icon: FileBarChart, color: 'text-emerald-500' },
];

const initialBankFiles = [
  { name: 'עובר_ושב_לילית_פרטי.xlsx', type: 'excel', size: '45 KB' },
  { name: 'עובר_ושב_דוד_פרטי.xlsx', type: 'excel', size: '38 KB' },
  { name: 'עובר_ושב_משותף.xlsx', type: 'excel', size: '112 KB' },
];

const initialCcFiles = [
  { name: 'פירוט_ויזה_כאל_דוד.csv', type: 'csv', size: '12 KB' },
  { name: 'פירוט_מקס_דוד.csv', type: 'csv', size: '8 KB' },
  { name: 'פירוט_אמקס_דוד.csv', type: 'csv', size: '5 KB' },
  { name: 'פירוט_מאסטרקרד_לילית.csv', type: 'csv', size: '15 KB' },
  { name: 'פירוט_ויזה_לילית.csv', type: 'csv', size: '9 KB' },
  { name: 'פירוט_פלייקארד_לילית.csv', type: 'csv', size: '11 KB' },
];

const initialReceiptFiles = [
  { name: 'חשבונית_חשמל_מרץ.pdf', type: 'pdf', size: '1.2 MB' },
  { name: 'חשבונית_ארנונה.pdf', type: 'pdf', size: '0.8 MB' },
  { name: 'ביטוח_רכב_מקיף.pdf', type: 'pdf', size: '2.1 MB' },
  { name: 'קבלה_סופר_רמי_לוי.jpg', type: 'image', size: '3.4 MB' },
  { name: 'קבלה_פז_דלק.jpg', type: 'image', size: '2.8 MB' },
  { name: 'קבלה_בית_מרקחת.jpg', type: 'image', size: '1.5 MB' },
];

export default function FolderLogic() {
  const [folderYears, setFolderYears] = useState(['2026']);
  const [expandedYear, setExpandedYear] = useState<string | null>('2026');
  const [expandedMonth, setExpandedMonth] = useState<string | null>('03_מרץ');
  const [expandedSub, setExpandedSub] = useState<string | null>(null);

  const handleAddYear = () => {
    const currentYearStr = new Date().getFullYear().toString();
    const minYear = Math.min(...folderYears.map(y => parseInt(y)));
    const suggestedYear = (minYear - 1).toString();
    const newYear = window.prompt("הכנס שנה להוספה:", suggestedYear);
    
    if (newYear && !isNaN(parseInt(newYear)) && !folderYears.includes(newYear)) {
      const updatedYears = [...folderYears, newYear].sort((a, b) => {
        if (a === currentYearStr) return -1;
        if (b === currentYearStr) return 1;
        return b.localeCompare(a);
      });
      setFolderYears(updatedYears);
      setExpandedYear(newYear);
      setExpandedMonth(null);
      setExpandedSub(null);
    }
  };

  // State for files to allow adding new ones
  const [bankFiles, setBankFiles] = useState(initialBankFiles);
  const [ccFiles, setCcFiles] = useState(initialCcFiles);
  const [receiptFiles, setReceiptFiles] = useState(initialReceiptFiles);

  // Upload Modal State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadYear, setUploadYear] = useState('2026');
  const [uploadMonth, setUploadMonth] = useState('03_מרץ');
  const [uploadCategory, setUploadCategory] = useState('receipts');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [syncingMonth, setSyncingMonth] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSync = (month: string) => {
    setSyncingMonth(month);
    setTimeout(() => {
      setSyncingMonth(null);
    }, 1500);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
      setUploadSuccess(false);
    }
  };

  const handleUpload = () => {
    if (!selectedFile) return;

    setIsUploading(true);

    // Simulate upload delay
    setTimeout(() => {
      const newFile = {
        name: selectedFile.name,
        type: selectedFile.name.endsWith('.pdf') ? 'pdf' : 
              selectedFile.name.endsWith('.csv') ? 'csv' : 
              selectedFile.name.endsWith('.xlsx') || selectedFile.name.endsWith('.xls') ? 'excel' : 'image',
        size: (selectedFile.size / 1024).toFixed(1) + ' KB'
      };

      if (uploadCategory === 'banks') {
        setBankFiles(prev => [newFile, ...prev]);
      } else if (uploadCategory === 'cc') {
        setCcFiles(prev => [newFile, ...prev]);
      } else {
        setReceiptFiles(prev => [newFile, ...prev]);
      }

      setIsUploading(false);
      setUploadSuccess(true);
      
      // Auto close after success
      setTimeout(() => {
        setIsUploadModalOpen(false);
        setSelectedFile(null);
        setUploadSuccess(false);
        // Expand the folder where the file was uploaded
        setExpandedYear(uploadYear);
        setExpandedMonth(uploadMonth);
        setExpandedSub(uploadCategory);
      }, 1500);
    }, 1500);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">מערכת קבצים ותיקיות</h1>
          <p className="text-slate-500 mt-1">סנכרון מלא מול Google Drive / Firebase Storage</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleAddYear}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl shadow-sm flex items-center gap-2 transition-colors font-medium"
          >
            <FolderPlus className="w-5 h-5" />
            הוסף שנה
          </button>
          <button 
            onClick={() => setIsUploadModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl shadow-sm flex items-center gap-2 transition-colors font-medium"
          >
            <Upload className="w-5 h-5" />
            העלאת קבצים ידנית
          </button>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <HardDrive className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">כונן ראשי (My Drive)</h2>
            <p className="text-sm text-slate-500">Family_Finance_Ecosystem/</p>
          </div>
        </div>

        <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
          <h3 className="font-bold text-slate-700">תיקיות שנים</h3>
        </div>

        <div className="select-none" dir="rtl">
          {folderYears.map(year => (
            <div key={year} className="mb-2">
              {/* Year Folder */}
              <div 
                className={`flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-2 rounded-lg transition-colors ${expandedYear === year ? 'bg-slate-50' : ''}`}
                onClick={() => setExpandedYear(expandedYear === year ? null : year)}
              >
                {expandedYear === year ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronLeft className="w-4 h-4 text-slate-400" />}
                <Folder className="w-5 h-5 text-slate-700 fill-slate-200" />
                <span className="font-bold text-slate-800">שנת_{year}</span>
              </div>

              <AnimatePresence>
                {expandedYear === year && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="mr-6 border-r-2 border-slate-100 pr-4 mt-1 space-y-1 overflow-hidden"
                  >
                    {months.map(month => (
                  <div key={month}>
                    <div 
                      className={`flex items-center justify-between group hover:bg-slate-50 p-2 rounded-lg transition-colors ${expandedMonth === month ? 'bg-blue-50/50' : ''}`}
                    >
                      <div 
                        className="flex items-center gap-2 cursor-pointer flex-1"
                        onClick={() => setExpandedMonth(expandedMonth === month ? null : month)}
                      >
                        {expandedMonth === month ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronLeft className="w-4 h-4 text-slate-400" />}
                        <Folder className="w-5 h-5 text-blue-500 fill-blue-100" />
                        <span className="font-medium text-slate-700">{month}</span>
                      </div>
                      <button 
                        className={`opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md ${syncingMonth === month ? 'text-emerald-600 bg-emerald-50' : 'text-blue-600 bg-blue-50 hover:bg-blue-100'}`}
                        onClick={(e) => { e.stopPropagation(); handleSync(month); }}
                        disabled={syncingMonth === month}
                      >
                        <RefreshCw className={`w-3 h-3 ${syncingMonth === month ? 'animate-spin text-emerald-600' : ''}`} />
                        {syncingMonth === month ? 'מסנכרן...' : 'סנכרן עם Drive'}
                      </button>
                    </div>

                    <AnimatePresence>
                      {expandedMonth === month && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="mr-6 border-r-2 border-slate-100 pr-4 mt-1 space-y-1 overflow-hidden"
                        >
                          {subFolders.map(sub => (
                            <div key={sub.id}>
                              <div 
                                className={`flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-2 rounded-lg transition-colors ${expandedSub === sub.id ? 'bg-slate-100' : ''}`}
                                onClick={() => setExpandedSub(expandedSub === sub.id ? null : sub.id)}
                              >
                                {expandedSub === sub.id ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronLeft className="w-4 h-4 text-slate-400" />}
                                <Folder className={`w-5 h-5 ${sub.color} fill-current opacity-20`} />
                                <Folder className={`w-5 h-5 ${sub.color} absolute`} />
                                <span className="text-sm font-medium text-slate-600">{sub.name}</span>
                              </div>

                              <AnimatePresence>
                                {expandedSub === sub.id && (
                                  <motion.div 
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="mr-6 border-r-2 border-slate-100 pr-4 py-2 space-y-2 overflow-hidden"
                                  >
                                    {sub.id === 'banks' && bankFiles.map((file, i) => (
                                      <div key={i} className="flex items-center justify-between group hover:bg-slate-50 p-1.5 rounded-md">
                                        <div className="flex items-center gap-2">
                                          <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                                          <span className="text-sm text-slate-600">{file.name}</span>
                                        </div>
                                        <span className="text-xs text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">{file.size}</span>
                                      </div>
                                    ))}
                                    {sub.id === 'cc' && ccFiles.map((file, i) => (
                                      <div key={i} className="flex items-center justify-between group hover:bg-slate-50 p-1.5 rounded-md">
                                        <div className="flex items-center gap-2">
                                          <FileSpreadsheet className="w-4 h-4 text-blue-400" />
                                          <span className="text-sm text-slate-600">{file.name}</span>
                                        </div>
                                        <span className="text-xs text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">{file.size}</span>
                                      </div>
                                    ))}
                                    {sub.id === 'receipts' && receiptFiles.map((file, i) => (
                                      <div key={i} className="flex items-center justify-between group hover:bg-slate-50 p-1.5 rounded-md">
                                        <div className="flex items-center gap-2">
                                          {file.type === 'pdf' ? <FileText className="w-4 h-4 text-red-400" /> : <FileImage className="w-4 h-4 text-amber-400" />}
                                          <span className="text-sm text-slate-600">{file.name}</span>
                                        </div>
                                        <span className="text-xs text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">{file.size}</span>
                                      </div>
                                    ))}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
            </div>
          ))}
        </div>
      </div>

      {/* Upload Modal */}
      <AnimatePresence>
        {isUploadModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => !isUploading && setIsUploadModalOpen(false)}
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
                  <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                    <Upload className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-slate-800 text-lg">העלאת קבצים ידנית</h3>
                </div>
                <button 
                  onClick={() => !isUploading && setIsUploadModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  disabled={isUploading}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                {/* File Selection */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">בחר קובץ להעלאה</label>
                  <div 
                    className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${selectedFile ? 'border-blue-400 bg-blue-50' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'}`}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileChange} 
                      className="hidden" 
                      accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx,.xls"
                    />
                    {selectedFile ? (
                      <div className="flex flex-col items-center gap-2">
                        <FileText className="w-8 h-8 text-blue-500" />
                        <span className="font-medium text-slate-800">{selectedFile.name}</span>
                        <span className="text-xs text-slate-500">{(selectedFile.size / 1024).toFixed(1)} KB</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Upload className="w-8 h-8 text-slate-400" />
                        <span className="font-medium text-slate-600">לחץ לבחירת קובץ או גרור לכאן</span>
                        <span className="text-xs text-slate-400">תומך ב- PDF, JPG, PNG, CSV, Excel</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Routing Options */}
                <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <h4 className="font-medium text-slate-800 text-sm flex items-center gap-2">
                    <Folder className="w-4 h-4 text-slate-500" />
                    ניתוב ושמירה בתיקייה
                  </h4>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">שנה</label>
                      <select 
                        value={uploadYear}
                        onChange={(e) => setUploadYear(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
                      >
                        {folderYears.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">חודש</label>
                      <select 
                        value={uploadMonth}
                        onChange={(e) => setUploadMonth(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
                      >
                        {months.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">סוג מסמך (תת-תיקייה)</label>
                    <select 
                      value={uploadCategory}
                      onChange={(e) => setUploadCategory(e.target.value)}
                      className="w-full bg-white border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
                    >
                      {subFolders.map(sub => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* Status / Action */}
                <div className="pt-2">
                  {uploadSuccess ? (
                    <div className="bg-emerald-50 text-emerald-700 p-3 rounded-xl flex items-center justify-center gap-2 font-medium">
                      <CheckCircle2 className="w-5 h-5" />
                      הקובץ הועלה ותויק בהצלחה!
                    </div>
                  ) : (
                    <button
                      onClick={handleUpload}
                      disabled={!selectedFile || isUploading}
                      className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                      {isUploading ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          מעלה ומנתח...
                        </>
                      ) : (
                        <>
                          <Upload className="w-5 h-5" />
                          העלה ושמור בתיקייה
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
