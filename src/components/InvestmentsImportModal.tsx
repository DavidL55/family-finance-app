import React, { useState, useRef, useEffect } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import {
  X,
  Loader2,
  ChevronRight,
  Home,
  File as FileIcon,
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
  extractForReview,
  commitExtractionDraft,
  ExtractedData,
  ExtractionDraft,
  CATEGORY_MAP,
} from '../utils/FileProcessor';
import ExtractionReviewModal, { type ExtractionReviewDecision } from './ExtractionReviewModal';
import ModelPicker from './ModelPicker';
import AiExtractionEgressNotice from './AiExtractionEgressNotice';
import { useAiModels } from '../hooks/useAiModels';
import { db } from '../services/firebase';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { listMembers } from '../services/MembersService';
import { Investment } from './AssetCard';

interface InvestmentsImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void; // called after Firestore is updated so parent can reload
}

// D7 — 'review' is a NEW phase: extraction succeeded and the draft is waiting on
// ExtractionReviewModal. Nothing is saved (transaction_lines) or applied to the portfolio
// (investments) until the reviewer commits from there.
type Phase = 'browser' | 'processing' | 'review' | 'result';

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
    sessionStorage.getItem('drive_token')
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

  // D7 — extraction review gate. The old "unknown category" modal-within-a-modal (Feature 3
  // hook) is replaced by ExtractionReviewModal's own per-row inline category select — the
  // reviewer fixes an unrecognised category in the same pass as everything else, so a separate
  // picker overlay is no longer needed.
  const [reviewDraft, setReviewDraft] = useState<ExtractionDraft | null>(null);
  const [reviewFile, setReviewFile] = useState<File | null>(null);

  // Task 7 — spec §8's real model switcher for extraction, reusing Task 6's ModelPicker (not
  // cloned). Defaults to the registry's first 'extraction'-tagged model once, on load.
  const extractionModels = useAiModels('extraction');
  const [modelId, setModelId] = useState('');
  useEffect(() => {
    if (extractionModels.status === 'ready' && extractionModels.models.length > 0 && !modelId) {
      setModelId(extractionModels.models[0].modelId);
    }
  }, [extractionModels.status, extractionModels.models, modelId]);

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
      sessionStorage.setItem('drive_token', t);
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

  // ── File import (D7 — extraction only; nothing is saved until the review gate commits) ────

  const handleImportFile = async (file: DriveItem) => {
    if (!token || !modelId) return;
    setPhase('processing');
    setProgressMessage(`מוריד את ${file.name}...`);

    try {
      // Fetch family members for owner attribution (Task 6: from the `members` collection —
      // a failed read propagates and is caught by this function's own catch block below,
      // same as any other failure in this import flow).
      const familyMembers: string[] = (await listMembers()).map((m) => m.name);

      const buffer = await downloadFileBuffer(token, file.id);
      const fileObj = new File([buffer], file.name, { type: file.mimeType });

      const draft = await extractForReview(fileObj, (msg) => setProgressMessage(msg), familyMembers, modelId);

      if (draft.items.length === 0) {
        setResult({ ok: false, message: 'לא נמצאו עסקאות במסמך', wasQuarterly: false });
        setPhase('result');
        return;
      }

      setReviewFile(fileObj);
      setReviewDraft(draft);
      setPhase('review');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה לא ידועה';
      setResult({ ok: false, message: `שגיאה: ${msg}`, wasQuarterly: false });
      setPhase('result');
    }
  };

  // D7 — called only after the reviewer approves (possibly-edited) rows. Mirrors the old
  // processAndUploadFile behavior exactly: every approved line is saved to transaction_lines
  // (Drive upload now happens HERE, at commit time, not before), and if the FIRST approved line
  // is a quarterly report, the existing account-mapping human gate (Feature 2, unchanged) still
  // runs before the investments collection is touched.
  const handleReviewCommit = async (decisions: ExtractionReviewDecision[]) => {
    if (!reviewDraft || !token) return;
    const commitResult = await commitExtractionDraft(reviewDraft, decisions, { token, file: reviewFile ?? undefined });

    const firstIncluded = decisions.find((d) => d.include)?.item;
    const wasQuarterly = !!(firstIncluded?.isQuarterlyReport && firstIncluded.quarterlyData);

    // Unmount the review modal BEFORE the account-mapping overlay (a separate fixed overlay)
    // might appear — otherwise the two would stack on top of each other.
    setReviewDraft(null);
    setReviewFile(null);

    if (wasQuarterly && firstIncluded) {
      setProgressMessage('ממתין לשיוך חשבון השקעה...');
      const investmentId = await promptForAccountMapping(firstIncluded);
      // investmentId is 'new' if user cancelled — still apply as new asset
      await applyQuarterlyData(investmentId, firstIncluded);
      onSuccess(); // tell parent to reload
    }

    setResult({
      ok: true,
      message: commitResult.savedCount === 0
        ? 'לא נשמרו עסקאות (הכל בוטל או כפילות)'
        : wasQuarterly
        ? 'הדוח יובא ותיק ההשקעות עודכן בהצלחה'
        : 'הקובץ יובא בהצלחה',
      wasQuarterly,
    });
    setPhase('result');
  };

  const handleReviewCancel = () => {
    setReviewDraft(null);
    setReviewFile(null);
    setPhase('browser');
  };

  // ── Reset on close ───────────────────────────────────────────────────────

  const handleClose = () => {
    setPhase('browser');
    setResult(null);
    setProgressMessage('');
    setBrowserFolders([]);
    setBrowserFiles([]);
    setBrowserPath([]);
    setReviewDraft(null);
    setReviewFile(null);
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

              {/* Model picker (Task 7 — spec §8's real switcher for extraction) */}
              <div className="px-3 py-1.5 border-b border-slate-100 shrink-0">
                <ModelPicker action="extraction" value={modelId} onChange={setModelId} />
                {/* Batch 3 — the document-egress disclosure, beside the picker whose provider it
                    names and directly above the folder list the report is chosen from. */}
                <AiExtractionEgressNotice modelId={modelId} className="mt-1.5" />
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
                          <FileIcon className="w-4 h-4 shrink-0 text-slate-300" />
                          <span className="truncate flex-1">{file.name}</span>
                          <button
                            onClick={() => handleImportFile(file)}
                            disabled={!modelId}
                            className="text-xs px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium shrink-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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

          {/* Phase: processing (extraction only — nothing saved yet, D7) */}
          {phase === 'processing' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
              <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
              <p className="text-slate-700 font-medium">{progressMessage}</p>
            </div>
          )}

          {/* Phase: review — a quarterly-report account-mapping wait shows the same spinner
              (handleReviewCommit sets progressMessage before the mapping prompt appears) */}
          {phase === 'review' && !reviewDraft && (
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

      {/* D7 — human review-and-approve gate; nothing reaches Firestore/the portfolio until this
          is confirmed. Replaces the old "unknown category" picker overlay (its job is now the
          modal's own per-row inline category select). */}
      {reviewDraft && (
        <ExtractionReviewModal draft={reviewDraft} onCommit={handleReviewCommit} onCancel={handleReviewCancel} />
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
