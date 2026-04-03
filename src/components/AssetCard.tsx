import React, { useState, useRef } from 'react';
import { ArrowUpRight, UploadCloud, Loader2, CheckCircle, AlertCircle, X, Save } from 'lucide-react';
import { processAndUploadFile, ExtractedData } from '../utils/FileProcessor';
import { useNotification } from '../contexts/NotificationContext';

export interface Investment {
  id: number;
  name: string;
  type: string;
  value: number;
  monthlyDeposit: number;
  returnPct: number;
  returnVal: number;
  firestoreId?: string;
}

export interface TypeConfig {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  chartColor: string;
}

export interface AssetUpdateData {
  currentBalance?: number;
  monthlyContribution?: number;
  yieldPercentage?: number;
}

interface AssetCardProps {
  inv: Investment;
  config: TypeConfig;
  onUpdate: (id: number, data: AssetUpdateData) => void;
}

interface ManualEntryState {
  currentBalance: number;
  monthlyContribution: number;
  yieldPercentage: number;
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
  const [manualData, setManualData] = useState<ManualEntryState>({
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
      if (!token) {
        addNotification('error', 'לא מחובר לגוגל דרייב');
        return;
      }

      setProgress(40);
      const result = await processAndUploadFile(file, token, (status) => {
        if (status.includes('Analyzing')) setProgress(50);
        if (status.includes('Organizing')) setProgress(70);
        if (status.includes('Uploading')) setProgress(90);
      });

      if (result.success && result.data) {
        setProgress(100);
        const extracted = result.data as ExtractedData;

        const updatePayload = extracted.isQuarterlyReport && extracted.quarterlyData ? {
          currentBalance: extracted.quarterlyData.balance,
          monthlyContribution: extracted.quarterlyData.contribution,
          yieldPercentage: extracted.quarterlyData.yield
        } : {
          currentBalance: extracted.amount,
          monthlyContribution: inv.monthlyDeposit,
          yieldPercentage: inv.returnPct
        };

        onUpdate(inv.id, updatePayload);
        setSyncStage('success');
        addNotification('success', `הדוח נקלט בהצלחה`);
      } else {
        throw new Error('Processing failed');
      }

      setTimeout(() => {
        setSyncStage('idle');
        setProgress(0);
        setSelectedFile(null);
      }, 3000);

    } catch (error) {
      console.error("Error processing file:", error);
      setSyncStage('manual_entry');
      addNotification('error', 'הסריקה נכשלה, ניתן להזין ידנית');
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
      onUpdate(inv.id, manualData);
      setSyncStage('success');
      setProgress(100);
      addNotification('success', `הנתונים עודכנו בהצלחה.`);

      setTimeout(() => {
        setSyncStage('idle');
        setProgress(0);
        setSelectedFile(null);
      }, 3000);
    } catch (error) {
      console.error("Error updating manually:", error);
      addNotification('error', 'שגיאה בעדכון הנתונים.');
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
                  onChange={e => setManualData({ ...manualData, currentBalance: Number(e.target.value) })}
                  className="w-full text-sm p-1.5 border border-slate-200 rounded"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-500">הפקדה (₪)</label>
                  <input
                    type="number"
                    value={manualData.monthlyContribution}
                    onChange={e => setManualData({ ...manualData, monthlyContribution: Number(e.target.value) })}
                    className="w-full text-sm p-1.5 border border-slate-200 rounded"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">תשואה (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={manualData.yieldPercentage}
                    onChange={e => setManualData({ ...manualData, yieldPercentage: Number(e.target.value) })}
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
              className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${syncStage === 'success'
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
