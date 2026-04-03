import React, { useState, useRef, useEffect } from 'react';
import { HardDrive, Upload, X, CheckCircle2, AlertTriangle, Loader2, FileText, FileImage, FileSpreadsheet, FolderOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { processLocalFile } from '../utils/FileProcessor';
import { db } from '../services/firebase';
import { doc, getDoc } from 'firebase/firestore';

// ── Types ─────────────────────────────────────────────────────────────────────

type FileStatus = 'pending' | 'processing' | 'success' | 'error' | 'duplicate';

interface QueuedFile {
  id: string;
  file: File;
  status: FileStatus;
  statusMessage: string;
  filedPath?: string; // e.g. "Family_Finance/2026/03_מרץ/..."
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileIcon(file: File) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return <FileText className="w-5 h-5 text-red-400 shrink-0" />;
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv'))
    return <FileSpreadsheet className="w-5 h-5 text-emerald-500 shrink-0" />;
  return <FileImage className="w-5 h-5 text-blue-400 shrink-0" />;
}

function statusBadge(status: FileStatus, msg: string) {
  switch (status) {
    case 'pending':
      return <span className="text-xs text-slate-400">ממתין</span>;
    case 'processing':
      return (
        <span className="flex items-center gap-1 text-xs text-blue-600">
          <Loader2 className="w-3 h-3 animate-spin" />
          {msg || 'מעבד...'}
        </span>
      );
    case 'success':
      return (
        <span className="flex items-center gap-1 text-xs text-emerald-600">
          <CheckCircle2 className="w-3 h-3" />
          נשמר בהצלחה
        </span>
      );
    case 'duplicate':
      return (
        <span className="flex items-center gap-1 text-xs text-amber-600">
          <AlertTriangle className="w-3 h-3" />
          כפילות — דולג
        </span>
      );
    case 'error':
      return (
        <span className="flex items-center gap-1 text-xs text-red-500">
          <X className="w-3 h-3" />
          {msg || 'שגיאה'}
        </span>
      );
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FolderLogic() {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [familyMembers, setFamilyMembers] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getDoc(doc(db, 'settings', 'budgetConfig')).then(snap => {
      setFamilyMembers(
        ((snap.data()?.members ?? []) as { name: string }[]).map((m) => m.name)
      );
    });
  }, []);

  const processed = queue.filter(f => f.status === 'success' || f.status === 'duplicate').length;
  const errors = queue.filter(f => f.status === 'error').length;
  const pending = queue.filter(f => f.status === 'pending' || f.status === 'processing').length;
  const done = isProcessing === false && queue.length > 0 && pending === 0;

  const updateFile = (id: string, patch: Partial<QueuedFile>) => {
    setQueue(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  };

  const addFiles = (files: FileList | File[]) => {
    const newEntries: QueuedFile[] = Array.from(files).map(file => ({
      id: `${file.name}-${Date.now()}-${Math.random()}`,
      file,
      status: 'pending',
      statusMessage: '',
    }));
    setQueue(prev => [...prev, ...newEntries]);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    // reset input so same files can be re-selected
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const removeFile = (id: string) => {
    setQueue(prev => prev.filter(f => f.id !== id));
  };

  const handleRetryErrors = () => {
    setQueue(prev => prev.map(f =>
      f.status === 'error' ? { ...f, status: 'pending', statusMessage: '' } : f
    ));
  };

  const handleStartProcessing = async () => {
    setIsProcessing(true);

    const pendingFiles = queue.filter(f => f.status === 'pending');

    for (let i = 0; i < pendingFiles.length; i++) {
      const qf = pendingFiles[i];
      updateFile(qf.id, { status: 'processing', statusMessage: 'סורק מסמך...' });

      let result = await processLocalFile(qf.file, (msg) => {
        updateFile(qf.id, { statusMessage: msg });
      }, familyMembers);

      // Auto-retry once on rate limit with the suggested delay (only if retryable)
      if (!result.success && result.errorType === 'rate_limit' && result.retryable && result.retryAfterMs) {
        const waitSec = Math.ceil(result.retryAfterMs / 1000);
        for (let t = waitSec; t > 0; t--) {
          updateFile(qf.id, { statusMessage: `מגבלת API — מנסה שוב בעוד ${t} שניות...` });
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        updateFile(qf.id, { statusMessage: 'מנסה שוב...' });
        result = await processLocalFile(qf.file, (msg) => {
          updateFile(qf.id, { statusMessage: msg });
        }, familyMembers);
      }

      // Throttle: Gemini free tier = 15 req/min → 5s between files
      if (i < pendingFiles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      if (result.success) {
        const month = result.data?.date
          ? (() => {
              const d = new Date(result.data.date);
              return isNaN(d.getTime()) ? '' : `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
            })()
          : '';
        updateFile(qf.id, {
          status: 'success',
          statusMessage: '',
          filedPath: month ? `Family_Finance/${month}/` : 'Family_Finance/',
        });
      } else if (result.duplicate) {
        updateFile(qf.id, { status: 'duplicate', statusMessage: '' });
      } else {
        updateFile(qf.id, {
          status: 'error',
          statusMessage: result.errorMessage || 'שגיאה בעיבוד',
        });
      }
    }

    setIsProcessing(false);
  };

  const handleClose = () => {
    if (isProcessing) return;
    setIsUploadModalOpen(false);
    setQueue([]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">ניהול מסמכים חכם</h1>
          <p className="text-slate-500 mt-1">תיוק אוטומטי ל-Drive לפי שנה וחודש, זיהוי כפילויות מבוסס AI</p>
        </div>
        <button
          onClick={() => setIsUploadModalOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-2xl shadow-lg flex items-center justify-center gap-2 transition-all font-bold active:scale-95"
        >
          <Upload className="w-5 h-5" />
          העלאת מסמכים
        </button>
      </div>

      {/* Info Panel */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <HardDrive className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">כונן Google Drive</h2>
            <p className="text-sm text-slate-500">Family_Finance / שנה / חודש / קטגוריה</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center">
            <FolderOpen className="w-8 h-8 text-blue-500 mx-auto mb-2" />
            <p className="text-sm font-bold text-blue-800">דוחות אשראי</p>
            <p className="text-xs text-blue-600 mt-1">CSV / Excel</p>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-center">
            <FolderOpen className="w-8 h-8 text-amber-500 mx-auto mb-2" />
            <p className="text-sm font-bold text-amber-800">קבלות וחשבוניות</p>
            <p className="text-xs text-amber-600 mt-1">JPG / PDF</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-center">
            <FolderOpen className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-bold text-emerald-800">דוחות בנק</p>
            <p className="text-xs text-emerald-600 mt-1">Excel / PDF</p>
          </div>
        </div>

        <p className="text-xs text-slate-400 mt-4 text-center">
          המערכת מזהה אוטומטית את סוג המסמך, חולצת את הנתונים, ושומרת ב-Firestore.
          סנכרון ל-Google Drive יתבצע לאחר חיבור החשבון.
        </p>
      </div>

      {/* Upload Modal */}
      <AnimatePresence>
        {isUploadModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md"
            onClick={() => !isProcessing && handleClose()}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div>
                  <h3 className="font-bold text-slate-800">העלאת מסמכים חכמה</h3>
                  <p className="text-xs text-slate-500 mt-0.5">בחר קבצים ללא הגבלה — יתויקו אוטומטית לפי שנה וחודש</p>
                </div>
                <button
                  onClick={handleClose}
                  disabled={isProcessing}
                  className="p-2 hover:bg-slate-200 rounded-full disabled:opacity-40"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              {/* Drop Zone */}
              <div className="p-4 border-b border-slate-100">
                <div
                  className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
                    isDragOver
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/50'
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileInputChange}
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv,image/*"
                    multiple
                  />
                  <Upload className={`w-10 h-10 mx-auto mb-3 ${isDragOver ? 'text-blue-500' : 'text-slate-300'}`} />
                  <p className="font-bold text-slate-700">גרור קבצים לכאן, או לחץ לבחירה</p>
                  <p className="text-xs text-slate-400 mt-1">PDF, JPG, PNG, Excel, CSV — ללא הגבלת כמות</p>
                </div>
              </div>

              {/* Queue */}
              {queue.length > 0 && (
                <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                  {queue.map(qf => (
                    <div
                      key={qf.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border ${
                        qf.status === 'success' ? 'bg-emerald-50 border-emerald-100' :
                        qf.status === 'error' ? 'bg-red-50 border-red-100' :
                        qf.status === 'duplicate' ? 'bg-amber-50 border-amber-100' :
                        qf.status === 'processing' ? 'bg-blue-50 border-blue-100' :
                        'bg-slate-50 border-slate-100'
                      }`}
                    >
                      {fileIcon(qf.file)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{qf.file.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-slate-400">{(qf.file.size / 1024).toFixed(0)} KB</span>
                          {qf.filedPath && (
                            <span className="text-[10px] text-emerald-600">→ {qf.filedPath}</span>
                          )}
                        </div>
                        <div className="mt-1">{statusBadge(qf.status, qf.statusMessage)}</div>
                      </div>
                      {qf.status === 'pending' && !isProcessing && (
                        <button
                          onClick={() => removeFile(qf.id)}
                          className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Footer */}
              <div className="p-4 border-t border-slate-100 bg-slate-50 space-y-3">
                {/* Progress summary */}
                {queue.length > 0 && (
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{queue.length} קבצים נבחרו</span>
                    <span className="flex gap-3">
                      {processed > 0 && <span className="text-emerald-600">✓ {processed} הצליחו</span>}
                      {errors > 0 && <span className="text-red-500">✗ {errors} נכשלו</span>}
                      {pending > 0 && <span className="text-blue-500">⏳ {pending} ממתינים</span>}
                    </span>
                  </div>
                )}
                {/* Retry failed files */}
                {errors > 0 && !isProcessing && (
                  <button
                    onClick={handleRetryErrors}
                    className="w-full py-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors"
                  >
                    נסה שוב {errors} קבצים שנכשלו
                  </button>
                )}

                {done ? (
                  <button
                    onClick={handleClose}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-2xl transition-all flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    סיום ({processed} קבצים תויקו)
                  </button>
                ) : (
                  <button
                    onClick={handleStartProcessing}
                    disabled={isProcessing || queue.filter(f => f.status === 'pending').length === 0}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-3 rounded-2xl transition-all flex items-center justify-center gap-2"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        מעבד קבצים...
                      </>
                    ) : (
                      <>
                        <Upload className="w-5 h-5" />
                        {queue.length === 0
                          ? 'בחר קבצים תחילה'
                          : `נתח ותייק ${queue.filter(f => f.status === 'pending').length} קבצים`}
                      </>
                    )}
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
