import React, { useState, useRef } from 'react';
import { ArrowUpRight, UploadCloud, Loader2, CheckCircle, AlertCircle, X, Save } from 'lucide-react';
import { parseFinancialReport, autoFileAndSync, ProcessedData } from '../utils/FileProcessor';
import { useNotification } from '../contexts/NotificationContext';

interface AssetCardProps {
  key?: React.Key;
  inv: any;
  config: any;
  onUpdate: (id: number, data: ProcessedData) => void;
}

type SyncStage = 'idle' | 'uploading' | 'scanning' | 'filing' | 'success' | 'error' | 'manual_entry';

export default function AssetCard({ inv, config, onUpdate }: AssetCardProps) {
  const Icon = config.icon;
  const { addNotification } = useNotification();
  const [syncStage, setSyncStage] = useState<SyncStage>('idle');
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Manual entry state
  const [manualData, setManualData] = useState<ProcessedData>({
    currentBalance: inv.value,
    monthlyContribution: inv.monthlyDeposit,
    yieldPercentage: inv.returnPct
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setSyncStage('scanning');
    setProgress(20);

    try {
      const token = localStorage.getItem('drive_token');
      const rootFolderId = localStorage.getItem('drive_folder_id');

      // 1. Scan Data
      setProgress(40);
      let extractedData: ProcessedData;
      try {
        extractedData = await parseFinancialReport(file, { name: inv.name, type: config.label });
        setProgress(70);
      } catch (scanError) {
        console.error("Scanning failed:", scanError);
        addNotification('error', 'הסריקה נכשלה. אנא הזן את הנתונים ידנית.');
        setSyncStage('manual_entry');
        return;
      }

      // 2. File to Google Drive
      setSyncStage('filing');
      setProgress(80);
      if (token) {
        await autoFileAndSync(file, { name: inv.name, type: config.label }, token, rootFolderId);
      } else {
        addNotification('error', 'לא מחובר לגוגל דרייב. הקובץ לא תויק.');
      }

      // 3. Update State
      setProgress(100);
      onUpdate(inv.id, extractedData);
      setSyncStage('success');
      addNotification('success', `הדוח נקלט בהצלחה, שווי הנכס עודכן ל-₪${extractedData.currentBalance.toLocaleString()}`);
      
      setTimeout(() => {
        setSyncStage('idle');
        setProgress(0);
        setSelectedFile(null);
      }, 3000);

    } catch (error) {
      console.error("Error processing file:", error);
      setSyncStage('error');
      addNotification('error', 'אירעה שגיאה בתהליך. נסה שוב.');
      setTimeout(() => setSyncStage('idle'), 3000);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleManualSave = async () => {
    setSyncStage('filing');
    setProgress(80);
    try {
      const token = localStorage.getItem('drive_token');
      const rootFolderId = localStorage.getItem('drive_folder_id');

      if (selectedFile && token) {
        await autoFileAndSync(selectedFile, { name: inv.name, type: config.label }, token, rootFolderId);
      }

      onUpdate(inv.id, manualData);
      setSyncStage('success');
      setProgress(100);
      addNotification('success', `הנתונים עודכנו והקובץ תויק בהצלחה.`);
      
      setTimeout(() => {
        setSyncStage('idle');
        setProgress(0);
        setSelectedFile(null);
      }, 3000);
    } catch (error) {
      console.error("Error filing manually:", error);
      addNotification('error', 'שגיאה בתיוק הקובץ.');
      setSyncStage('idle');
    }
  };

  const getStageText = () => {
    switch (syncStage) {
      case 'uploading': return 'מעלה קובץ...';
      case 'scanning': return 'סורק נתונים...';
      case 'filing': return 'מתייק בענן...';
      case 'success': return 'עודכן בהצלחה';
      case 'error': return 'שגיאה';
      default: return 'סנכרן ותייק דוח';
    }
  };

  const isProcessing = ['uploading', 'scanning', 'filing'].includes(syncStage);

  return (
    <div className="p-4 rounded-xl border border-slate-100 hover:border-indigo-200 transition-colors bg-slate-50/50 flex flex-col h-full relative overflow-hidden">
      {/* Progress Bar Background */}
      {isProcessing && (
        <div 
          className="absolute top-0 left-0 h-1 bg-indigo-500 transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      )}

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-slate-700">
          <div className={`p-2 rounded-lg ${config.bg} ${config.color}`}>
            <Icon className="w-4 h-4" />
          </div>
          <span className="text-sm font-bold truncate">{inv.name}</span>
        </div>
        <span className="text-xs font-medium text-slate-500 bg-white px-2 py-1 rounded-md border border-slate-200">
          {config.label}
        </span>
      </div>
      
      <div className="mt-2 flex-1 flex items-end justify-between">
        <div>
          <p className="text-xs text-slate-500 mb-1">שווי נוכחי</p>
          <p className="text-xl font-bold text-slate-800">₪{inv.value.toLocaleString()}</p>
        </div>
        <div className="text-left rtl:text-right">
          {inv.monthlyDeposit > 0 && (
            <p className="text-xs text-slate-500 mb-1">הפקדה חודשית: ₪{inv.monthlyDeposit.toLocaleString()}</p>
          )}
          <div className="flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 inline-flex px-2 py-1 rounded-md">
            <ArrowUpRight className="w-3 h-3" />
            <span>{inv.returnPct}%</span>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-200/60">
        {syncStage === 'manual_entry' ? (
          <div className="space-y-3 bg-white p-3 rounded-lg border border-amber-200 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-700 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                הזנה ידנית
              </span>
              <button onClick={() => setSyncStage('idle')} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-slate-500">שווי נוכחי (₪)</label>
                <input 
                  type="number" 
                  value={manualData.currentBalance}
                  onChange={e => setManualData({...manualData, currentBalance: Number(e.target.value)})}
                  className="w-full text-sm p-1.5 border border-slate-200 rounded"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-500">הפקדה (₪)</label>
                  <input 
                    type="number" 
                    value={manualData.monthlyContribution}
                    onChange={e => setManualData({...manualData, monthlyContribution: Number(e.target.value)})}
                    className="w-full text-sm p-1.5 border border-slate-200 rounded"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">תשואה (%)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    value={manualData.yieldPercentage}
                    onChange={e => setManualData({...manualData, yieldPercentage: Number(e.target.value)})}
                    className="w-full text-sm p-1.5 border border-slate-200 rounded"
                  />
                </div>
              </div>
            </div>
            <button
              onClick={handleManualSave}
              className="w-full bg-indigo-600 text-white text-xs font-medium py-2 rounded-md flex items-center justify-center gap-1 hover:bg-indigo-700"
            >
              <Save className="w-3 h-3" />
              שמור ותייק קובץ
            </button>
          </div>
        ) : (
          <>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              className="hidden" 
              accept=".pdf,image/*,.xlsx,.xls"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                syncStage === 'success' 
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : syncStage === 'error'
                  ? 'bg-red-50 text-red-700 border border-red-200'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
              }`}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                  <span className="text-indigo-700">{getStageText()}</span>
                </>
              ) : syncStage === 'success' ? (
                <>
                  <CheckCircle className="w-4 h-4" />
                  <span>{getStageText()}</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>{getStageText()}</span>
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
