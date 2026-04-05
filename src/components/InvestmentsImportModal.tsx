import React, { useState, useRef } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import {
  X,
  Loader2,
  ChevronRight,
  Home,
  File,
  Folder,
  FolderOpen,
  AlertCircle,
  CheckCircle,
  Upload,
} from 'lucide-react';
import {
  fetchFolderContents,
  downloadFileBuffer,
  DriveFolder,
  DriveItem,
} from '../services/GoogleDriveService';
import {
  processAndUploadFile,
  ExtractedData,
  CATEGORY_MAP,
  OnUnknownCategoryCallback,
} from '../utils/FileProcessor';
import { db } from '../services/firebase';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { Investment } from './AssetCard';

interface InvestmentsImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void; // called after Firestore is updated so parent can reload
}

type Phase = 'browser' | 'processing' | 'result';

interface ResultState {
  ok: boolean;
  message: string;
  wasQuarterly: boolean;
}

export default function InvestmentsImportModal({
  isOpen,
  onClose,
  onSuccess,
}: InvestmentsImportModalProps) {
  // Auth
  const [token, setToken] = useState<string | null>(
    localStorage.getItem('drive_token')
  );

  // Drive browser
  const [phase, setPhase] = useState<Phase>('browser');
  const [browserPath, setBrowserPath] = useState<{ id: string; name: string }[]>([]);
  const [browserFolders, setBrowserFolders] = useState<DriveFolder[]>([]);
  const [browserFiles, setBrowserFiles] = useState<DriveItem[]>([]);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [browserSearch, setBrowserSearch] = useState('');
  const [progressMessage, setProgressMessage] = useState('');

  // Result
  const [result, setResult] = useState<ResultState | null>(null);

  // Category picker — Feature 3 hook (fires if Gemini returns 'שונות')
  const [pendingCategoryPick, setPendingCategoryPick] = useState<{
    data: ExtractedData;
  } | null>(null);
  const categoryResolveRef = useRef<((category: string) => void) | null>(null);

  // Account mapping — Feature 2 human gate
  const [pendingMapping, setPendingMapping] = useState<{
    extractedData: ExtractedData;
  } | null>(null);
  const mappingResolveRef = useRef<((investmentId: string | 'new') => void) | null>(null);
  const [existingInvestments, setExistingInvestments] = useState<Investment[]>([]);
  const [selectedInvestmentId, setSelectedInvestmentId] = useState<string>('');

  // ── OAuth ────────────────────────────────────────────────────────────────

  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      const t = tokenResponse.access_token;
      setToken(t);
      localStorage.setItem('drive_token', t);
      await openBrowser(t);
    },
    scope:
      'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly',
    onError: () => console.error('[InvestmentsImportModal] Login failed'),
  });

  // ── Drive browser ────────────────────────────────────────────────────────

  const openBrowser = async (
    accessToken: string,
    folderId = 'root',
    path: { id: string; name: string }[] = []
  ) => {
    setIsBrowsing(true);
    setBrowserSearch('');
    try {
      const { folders, files } = await fetchFolderContents(accessToken, folderId);
      setBrowserFolders(folders);
      setBrowserFiles(files);
      setBrowserPath(path);
    } finally {
      setIsBrowsing(false);
    }
  };

  // ── Category picker (Feature 3 hook) ────────────────────────────────────

  const buildCategoryCallback = (): OnUnknownCategoryCallback =>
    async (data: ExtractedData) =>
      new Promise<string>((resolve) => {
        setPendingCategoryPick({ data });
        categoryResolveRef.current = resolve;
      });

  const handleCategorySelection = (hebrewCategory: string) => {
    setPendingCategoryPick(null);
    categoryResolveRef.current?.(hebrewCategory);
    categoryResolveRef.current = null;
  };

  // ── Account mapping (Feature 2 human gate) ───────────────────────────────

  const promptForAccountMapping = async (
    extractedData: ExtractedData
  ): Promise<string | 'new'> => {
    // Load existing investments for the dropdown
    const snap = await getDocs(collection(db, 'investments'));
    const loaded: Investment[] = snap.docs.map((d, i) => ({
      id: (d.data().id as number) || i + 1,
      firestoreId: d.id,
      name: d.data().name as string,
      type: d.data().type as string,
      value: d.data().value as number,
      monthlyDeposit: d.data().monthlyDeposit as number,
      returnPct: d.data().returnPct as number,
      returnVal: d.data().returnVal as number,
    }));
    setExistingInvestments(loaded);
    setSelectedInvestmentId('');

    return new Promise<string | 'new'>((resolve) => {
      setPendingMapping({ extractedData });
      mappingResolveRef.current = resolve;
    });
  };

  const handleMappingConfirm = () => {
    if (!selectedInvestmentId) return;
    setPendingMapping(null);
    mappingResolveRef.current?.(selectedInvestmentId as string | 'new');
    mappingResolveRef.current = null;
  };

  const handleMappingCancel = () => {
    setPendingMapping(null);
    mappingResolveRef.current?.('new'); // treat cancel as skip mapping → no upsert
    mappingResolveRef.current = null;
  };

  // ── Apply quarterly data to investments collection ───────────────────────

  const applyQuarterlyData = async (
    investmentId: string | 'new',
    extractedData: ExtractedData
  ) => {
    const qd = extractedData.quarterlyData!;
    const value = qd.balance;
    const monthlyDeposit = qd.contribution;
    const returnPct = qd.yield * 100;
    const returnVal = value * qd.yield;

    if (investmentId === 'new') {
      // Infer type from category
      const type =
        extractedData.category === CATEGORY_MAP.Insurance_Pension
          ? 'pension'
          : 'investment';

      // Get next local ID
      const snap = await getDocs(collection(db, 'investments'));
      const nextId =
        snap.docs.reduce((max, d) => Math.max(max, (d.data().id as number) || 0), 0) + 1;

      await addDoc(collection(db, 'investments'), {
        id: nextId,
        name: extractedData.vendor,
        type,
        value,
        monthlyDeposit,
        returnPct,
        returnVal,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'investments', investmentId), {
        value,
        monthlyDeposit,
        returnPct,
        returnVal,
        updated_at: serverTimestamp(),
      });
    }
  };

  // ── File import ──────────────────────────────────────────────────────────

  const handleImportFile = async (file: DriveItem) => {
    if (!token) return;
    setPhase('processing');
    setProgressMessage(`מוריד את ${file.name}...`);

    try {
      // Fetch family members for owner attribution
      const budgetSnap = await getDoc(doc(db, 'settings', 'budgetConfig'));
      const familyMembers: string[] = (
        (budgetSnap.data()?.members ?? []) as { name: string }[]
      ).map((m) => m.name);

      const buffer = await downloadFileBuffer(token, file.id);
      const fileObj = new File([buffer], file.name, { type: file.mimeType });

      const result = await processAndUploadFile(
        fileObj,
        token,
        (msg) => setProgressMessage(msg),
        familyMembers,
        buildCategoryCallback()
      );

      if (!result.success) {
        setResult({
          ok: false,
          message: result.duplicate
            ? 'הקובץ כבר קיים במערכת'
            : (result.errorMessage ?? 'שגיאה בעיבוד הקובץ'),
          wasQuarterly: false,
        });
        setPhase('result');
        return;
      }

      const wasQuarterly = !!(result.data?.isQuarterlyReport && result.data.quarterlyData);

      if (wasQuarterly && result.data) {
        setProgressMessage('ממתין לשיוך חשבון השקעה...');
        const investmentId = await promptForAccountMapping(result.data);
        // investmentId is 'new' if user cancelled — still apply as new asset
        await applyQuarterlyData(investmentId, result.data);
        onSuccess(); // tell parent to reload
      }

      setResult({
        ok: true,
        message: wasQuarterly
          ? 'הדוח יובא ותיק ההשקעות עודכן בהצלחה'
          : 'הקובץ יובא בהצלחה',
        wasQuarterly,
      });
      setPhase('result');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה לא ידועה';
      setResult({ ok: false, message: `שגיאה: ${msg}`, wasQuarterly: false });
      setPhase('result');
    }
  };

  // ── Reset on close ───────────────────────────────────────────────────────

  const handleClose = () => {
    setPhase('browser');
    setResult(null);
    setProgressMessage('');
    setBrowserFolders([]);
    setBrowserFiles([]);
    setBrowserPath([]);
    setPendingCategoryPick(null);
    setPendingMapping(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[190]"
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl z-[200] overflow-hidden flex flex-col"
        style={{ width: '560px', height: '600px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-slate-800">ייבוא דוח השקעות / פנסיה מ-Drive</h3>
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col">

          {/* Phase: no token */}
          {!token && phase === 'browser' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
              <Upload className="w-10 h-10 text-indigo-300" />
              <p className="text-slate-600 font-medium">חיבור ל-Google Drive נדרש</p>
              <button
                onClick={() => login()}
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors"
              >
                התחבר ל-Google Drive
              </button>
            </div>
          )}

          {/* Phase: browser */}
          {token && phase === 'browser' && (
            <>
              {/* Breadcrumb */}
              <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-1 flex-wrap shrink-0 min-h-[36px]">
                <button
                  onClick={() => token && openBrowser(token, 'root', [])}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium shrink-0"
                >
                  <Home className="w-3 h-3" />
                  <span>My Drive</span>
                </button>
                {browserPath.map((segment, i) => (
                  <React.Fragment key={segment.id}>
                    <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                    <button
                      onClick={() =>
                        token && openBrowser(token, segment.id, browserPath.slice(0, i + 1))
                      }
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium truncate max-w-[120px]"
                    >
                      {segment.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>

              {/* Search */}
              <div className="px-2 py-1.5 border-b border-slate-100 shrink-0">
                <input
                  type="text"
                  value={browserSearch}
                  onChange={(e) => setBrowserSearch(e.target.value)}
                  placeholder="חיפוש בתיקייה הנוכחית..."
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 focus:border-transparent text-right"
                />
              </div>

              {/* Contents */}
              <div className="overflow-y-auto flex-1 p-2 space-y-0.5">
                {isBrowsing ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
                  </div>
                ) : browserFolders.length === 0 && browserFiles.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">
                    {browserPath.length === 0
                      ? 'לחץ על "My Drive" לצפייה בתיקיות'
                      : 'תיקייה ריקה'}
                  </p>
                ) : (
                  <>
                    {browserFolders
                      .filter((f) =>
                        f.name.toLowerCase().includes(browserSearch.toLowerCase())
                      )
                      .map((folder) => (
                        <div key={folder.id} className="flex items-center gap-1">
                          <div className="flex-1 text-right flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-700">
                            <FolderOpen className="w-4 h-4 shrink-0 text-yellow-500" />
                            <span className="truncate flex-1">{folder.name}</span>
                          </div>
                          <button
                            onClick={() =>
                              token &&
                              openBrowser(token, folder.id, [
                                ...browserPath,
                                { id: folder.id, name: folder.name },
                              ])
                            }
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors shrink-0"
                            title="פתח תיקייה"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      ))}

                    {browserFiles
                      .filter((f) =>
                        f.name.toLowerCase().includes(browserSearch.toLowerCase())
                      )
                      .map((file) => (
                        <div
                          key={file.id}
                          className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500 rounded-lg hover:bg-slate-50"
                        >
                          <File className="w-4 h-4 shrink-0 text-slate-300" />
                          <span className="truncate flex-1">{file.name}</span>
                          <button
                            onClick={() => handleImportFile(file)}
                            className="text-xs px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium shrink-0 transition-colors"
                          >
                            ייבא
                          </button>
                        </div>
                      ))}
                  </>
                )}
              </div>

              {/* Hint */}
              <div className="p-3 border-t border-slate-100 bg-slate-50 shrink-0">
                <p className="text-xs text-slate-400 text-center">
                  דוחות רבעוניים יעדכנו אוטומטית את תיק ההשקעות לאחר אישורך
                </p>
              </div>
            </>
          )}

          {/* Phase: processing */}
          {phase === 'processing' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
              <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
              <p className="text-slate-700 font-medium">{progressMessage}</p>
            </div>
          )}

          {/* Phase: result */}
          {phase === 'result' && result && (
            <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center">
              {result.ok ? (
                <CheckCircle className="w-12 h-12 text-emerald-500" />
              ) : (
                <AlertCircle className="w-12 h-12 text-red-400" />
              )}
              <p
                className={`font-semibold text-lg ${
                  result.ok ? 'text-slate-800' : 'text-red-700'
                }`}
              >
                {result.message}
              </p>
              <div className="flex gap-3">
                {result.ok && (
                  <button
                    onClick={() => {
                      setPhase('browser');
                      setResult(null);
                    }}
                    className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors"
                  >
                    ייבא קובץ נוסף
                  </button>
                )}
                <button
                  onClick={handleClose}
                  className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
                >
                  סגור
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Category Picker overlay (Feature 3 hook — fires if Gemini returns 'שונות') */}
      {pendingCategoryPick && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[210] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100 flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-bold text-slate-800">היכן לתייק את המסמך?</h3>
                <p className="text-sm text-slate-500 mt-1">
                  הבינה המלאכותית לא זיהתה קטגוריה עבור "
                  {pendingCategoryPick.data.vendor}"
                </p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-slate-50 rounded-lg p-4 text-sm space-y-1">
                <p>
                  <span className="font-semibold">ספק: </span>
                  {pendingCategoryPick.data.vendor}
                </p>
                <p>
                  <span className="font-semibold">סכום: </span>₪
                  {pendingCategoryPick.data.amount}
                </p>
                <p>
                  <span className="font-semibold">תאריך: </span>
                  {pendingCategoryPick.data.date}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(CATEGORY_MAP)
                  .filter(([key]) => key !== 'General_Misc')
                  .map(([key, hebrew]) => (
                    <button
                      key={key}
                      onClick={() => handleCategorySelection(hebrew)}
                      className="px-3 py-2 text-sm rounded-lg border border-slate-200 hover:bg-indigo-50 hover:border-indigo-300 text-right transition-colors"
                    >
                      {hebrew}
                    </button>
                  ))}
              </div>
              <button
                onClick={() => handleCategorySelection(CATEGORY_MAP.General_Misc)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 transition-colors"
              >
                השאר תחת "שונות"
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Account Mapping overlay — Feature 2 human gate */}
      {pendingMapping && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[210] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800">לאיזה חשבון שייך הדוח הזה?</h3>
              <p className="text-sm text-slate-500 mt-1">
                נמצא דוח רבעוני. בחר את הנכס המתאים כדי לעדכן את היתרה, ההפקדה והתשואה.
              </p>
            </div>

            <div className="p-6 space-y-4">
              {/* Extracted data summary */}
              <div className="bg-indigo-50 rounded-lg p-4 text-sm space-y-1">
                <p>
                  <span className="font-semibold">קרן/חברה: </span>
                  {pendingMapping.extractedData.vendor}
                </p>
                <p>
                  <span className="font-semibold">יתרה: </span>₪
                  {pendingMapping.extractedData.quarterlyData?.balance.toLocaleString()}
                </p>
                <p>
                  <span className="font-semibold">הפקדה: </span>₪
                  {pendingMapping.extractedData.quarterlyData?.contribution.toLocaleString()}
                </p>
                <p>
                  <span className="font-semibold">תשואה: </span>
                  {(
                    (pendingMapping.extractedData.quarterlyData?.yield ?? 0) * 100
                  ).toFixed(2)}
                  %
                </p>
              </div>

              {/* Dropdown */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  שייך לחשבון
                </label>
                <select
                  value={selectedInvestmentId}
                  onChange={(e) => setSelectedInvestmentId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-indigo-500 focus:border-transparent"
                  dir="rtl"
                >
                  <option value="">-- בחר חשבון קיים --</option>
                  {existingInvestments.map((inv) => (
                    <option key={inv.firestoreId} value={inv.firestoreId}>
                      {inv.name} ({inv.type}) — ₪{inv.value.toLocaleString()}
                    </option>
                  ))}
                  <option value="new">+ צור נכס חדש</option>
                </select>
              </div>

              <div className="flex gap-3 justify-end pt-1">
                <button
                  onClick={handleMappingCancel}
                  className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  ביטול
                </button>
                <button
                  disabled={!selectedInvestmentId}
                  onClick={handleMappingConfirm}
                  className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  אשר עדכון
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
