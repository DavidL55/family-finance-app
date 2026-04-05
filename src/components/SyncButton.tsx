import React, { useState, useEffect, useRef } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import {
  Cloud,
  Loader2,
  Folder,
  FolderOpen,
  CheckCircle,
  X,
  AlertCircle,
  Play,
  ChevronRight,
  Home,
  File,
  LayoutGrid,
  Filter,
} from 'lucide-react';
import { fetchFolderContents, fetchFolderById, downloadFileBuffer, fetchFilesByYearAndCategory, DriveFolder, DriveItem } from '../services/GoogleDriveService';
import { syncFilesFromDrive, SyncSummary } from '../services/SyncService';
import { ExtractedData, CATEGORY_MAP, OnUnknownCategoryCallback, processAndUploadFile, processLocalFile } from '../utils/FileProcessor';
import { db } from '../services/firebase';
import { doc, getDoc } from 'firebase/firestore';

const HEBREW_MONTHS: Record<string, string> = {
  '01': 'ינואר', '02': 'פברואר', '03': 'מרץ', '04': 'אפריל',
  '05': 'מאי',  '06': 'יוני',   '07': 'יולי', '08': 'אוגוסט',
  '09': 'ספטמבר','10': 'אוקטובר','11': 'נובמבר','12': 'דצמבר',
};

interface DuplicateHandlerResponse {
  action: 'skip' | 'overwrite' | 'cancel';
}

interface DuplicateFile {
  fileName: string;
  duplicate: ExtractedData;
  handled: boolean;
}

interface SyncProgressStatus {
  message: string;
  processed: number;
  total: number;
}

export default function SyncButton() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(
    localStorage.getItem('drive_folder_id')
  );
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(
    localStorage.getItem('drive_token')
  );
  const [showFolderSelect, setShowFolderSelect] = useState(false);

  // Folder browser state
  const [browserPath, setBrowserPath] = useState<{ id: string; name: string }[]>([]);
  const [browserFolders, setBrowserFolders] = useState<DriveFolder[]>([]);
  const [browserFiles, setBrowserFiles] = useState<DriveItem[]>([]);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [browserSearch, setBrowserSearch] = useState('');
  const [pasteLink, setPasteLink] = useState('');
  const [pasteLinkError, setPasteLinkError] = useState<string | null>(null);
  const [isValidatingLink, setIsValidatingLink] = useState(false);
  const [showSyncMode, setShowSyncMode] = useState(false);
  const [showMonthBoard, setShowMonthBoard] = useState(false);
  const [monthStructure, setMonthStructure] = useState<{
    year: string; yearId: string;
    months: { id: string; name: string; hebrewName: string }[];
  }[]>([]);
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [isLoadingMonths, setIsLoadingMonths] = useState(false);
  const [showSyncProgress, setShowSyncProgress] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgressStatus>({
    message: '',
    processed: 0,
    total: 0,
  });

  // Sync mode: 'all' | 'incremental' | 'custom' | 'category'
  type SyncMode = 'all' | 'incremental' | 'custom' | 'category';
  const [syncMode, setSyncMode] = useState<SyncMode>('incremental');

  // Category import state
  const [categoryImportYear, setCategoryImportYear] = useState<string>(
    new Date().getFullYear().toString()
  );
  const [categoryImportCategory, setCategoryImportCategory] = useState<string>('');
  const [customDateRange, setCustomDateRange] = useState<{ startDate: Date; endDate: Date }>(() => {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { startDate, endDate };
  });

  const getLastSyncKey = (folderId: string) => `last_sync_${folderId}`;

  const getLastSyncTime = (folderId: string): Date | null => {
    const stored = localStorage.getItem(getLastSyncKey(folderId));
    return stored ? new Date(stored) : null;
  };

  const saveLastSyncTime = (folderId: string) => {
    localStorage.setItem(getLastSyncKey(folderId), new Date().toISOString());
  };

  // Duplicate handling state
  const [currentDuplicate, setCurrentDuplicate] = useState<DuplicateFile | null>(null);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);

  // Ref-based pattern to bridge async sync flow with UI duplicate modal
  const duplicateResolveRef = useRef<((response: DuplicateHandlerResponse) => void) | null>(null);

  // Unknown-category state — same ref+Promise pattern as duplicate handler
  const [unknownCategoryFile, setUnknownCategoryFile] = useState<{
    data: ExtractedData;
  } | null>(null);
  const unknownCategoryResolveRef = useRef<((category: string) => void) | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowFolderSelect(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const openBrowser = async (accessToken: string, folderId = 'root', path: { id: string; name: string }[] = []) => {
    setIsBrowsing(true);
    setBrowserSearch('');
    try {
      const { folders, files } = await fetchFolderContents(accessToken, folderId);
      setBrowserFolders(folders);
      setBrowserFiles(files);
      setBrowserPath(path);
      setShowFolderSelect(true);
    } catch (error) {
      setIsBrowsing(false);
      throw error; // propagate so handleSyncClick can refresh token
    }
    setIsBrowsing(false);
  };

  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      const accessToken = tokenResponse.access_token;
      setToken(accessToken);
      localStorage.setItem('drive_token', accessToken);
      setIsSyncing(true);
      try {
        await openBrowser(accessToken);
      } finally {
        setIsSyncing(false);
      }
    },
    scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly',
    onError: () => {
      console.error('Login Failed');
      setIsSyncing(false);
    },
  });

  const isTokenExpired = (error: unknown): boolean => {
    const msg = error instanceof Error ? error.message : String(error);
    return msg.includes('HTTP 401') || msg.includes('401');
  };

  const clearTokenAndRelogin = () => {
    localStorage.removeItem('drive_token');
    setToken(null);
    login();
  };

  // Load year/month subfolder structure from the selected root folder
  const loadMonthStructure = async (accessToken: string, rootFolderId: string) => {
    setIsLoadingMonths(true);
    setShowMonthBoard(true);
    setSelectedMonths(new Set());
    try {
      const { folders: topFolders } = await fetchFolderContents(accessToken, rootFolderId);
      const yearFolders = topFolders
        .filter((f) => /^\d{4}$/.test(f.name))
        .sort((a, b) => b.name.localeCompare(a.name));

      if (yearFolders.length === 0) {
        setMonthStructure([]);
        setIsLoadingMonths(false);
        return;
      }

      const structure = await Promise.all(
        yearFolders.map(async (yearFolder) => {
          const { folders: monthFolders } = await fetchFolderContents(accessToken, yearFolder.id);
          const months = monthFolders
            .filter((f) => /^\d{2}$/.test(f.name))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((f) => ({
              id: f.id,
              name: f.name,
              hebrewName: HEBREW_MONTHS[f.name] || f.name,
            }));
          return { year: yearFolder.name, yearId: yearFolder.id, months };
        })
      );

      setMonthStructure(structure.filter((y) => y.months.length > 0));
    } catch (error) {
      if (isTokenExpired(error)) throw error; // propagate so caller can re-login
      console.error('Error loading month structure:', error);
      setMonthStructure([]);
    } finally {
      setIsLoadingMonths(false);
    }
  };

  // Sync each selected month folder sequentially
  const handleSyncSelectedMonths = async () => {
    if (!token || selectedMonths.size === 0) return;
    const accessToken: string = token; // capture before async loop

    setShowMonthBoard(false);
    setShowSyncProgress(true);
    setSyncSummary(null);
    setCurrentDuplicate(null);

    const monthIds: string[] = Array.from(selectedMonths);
    let totalProcessed = 0;
    let totalErrors = 0;
    let totalDuplicates = 0;
    let totalSkipped = 0;
    const allFailed: { fileName: string; error: string }[] = [];

    for (let i = 0; i < monthIds.length; i++) {
      const monthId = monthIds[i];
      const allMonths = monthStructure.flatMap((y) => y.months);
      const monthInfo = allMonths.find((m) => m.id === monthId);
      const yearInfo = monthStructure.find((y) => y.months.some((m) => m.id === monthId));
      const label = monthInfo ? `${monthInfo.hebrewName} ${yearInfo?.year ?? ''}` : monthId;

      setSyncProgress({
        message: `מסנכרן ${label}... (${i + 1}/${monthIds.length})`,
        processed: i,
        total: monthIds.length,
      });

      try {
        const summary = await syncFilesFromDrive(
          accessToken,
          monthId,
          undefined,
          (status) =>
            setSyncProgress({
              ...status,
              message: `[${label}] ${status.message}`,
            }),
          async (fileName, duplicate) =>
            new Promise<{ action: 'skip' | 'overwrite' | 'cancel' }>((resolve) => {
              setCurrentDuplicate({ fileName, duplicate, handled: false });
              duplicateResolveRef.current = resolve;
            }),
          buildOnUnknownCategoryCallback()
        );
        totalProcessed += summary.processed;
        totalErrors += summary.errors;
        totalDuplicates += summary.duplicates;
        totalSkipped += summary.skipped;
        allFailed.push(...summary.failed);
      } catch (error) {
        if (isTokenExpired(error)) {
          setShowSyncProgress(false);
          clearTokenAndRelogin();
          return; // abort loop — user will re-auth and restart
        }
        console.error(`Error syncing month ${monthId}:`, error);
        totalErrors++;
      }
    }

    if (selectedFolder) saveLastSyncTime(selectedFolder);

    const finalSummary: SyncSummary = {
      processed: totalProcessed,
      errors: totalErrors,
      duplicates: totalDuplicates,
      skipped: totalSkipped,
      failed: allFailed,
    };
    setSyncSummary(finalSummary);
    setSyncProgress({
      message: `סיום סנכרון: ${totalProcessed} קבצים טוענו בהצלחה`,
      processed: monthIds.length,
      total: monthIds.length,
    });
  };

  const handleSyncClick = () => {
    if (!token) {
      setIsSyncing(true);
      login();
    } else if (selectedFolder) {
      // Folder already chosen — go straight to monthly board
      loadMonthStructure(token, selectedFolder).catch((error) => {
        if (isTokenExpired(error)) {
          clearTokenAndRelogin();
        } else {
          console.error('Failed to load month structure:', error);
        }
      });
    } else {
      setIsSyncing(true);
      openBrowser(token)
        .then(() => setIsSyncing(false))
        .catch(() => {
          localStorage.removeItem('drive_token');
          setToken(null);
          login();
        });
    }
  };

  const handleFolderSelect = (folderId: string, folderName: string) => {
    setSelectedFolder(folderId);
    setSelectedFolderName(folderName);
    localStorage.setItem('drive_folder_id', folderId);
    localStorage.setItem('drive_folder_name', folderName);
    setShowFolderSelect(false);
    // Load month board right after selection
    if (token) loadMonthStructure(token, folderId);
  };

  const handlePasteLink = async () => {
    if (!token || !pasteLink.trim()) return;
    setPasteLinkError(null);
    setIsValidatingLink(true);
    try {
      const match = pasteLink.match(/folders\/([a-zA-Z0-9_-]+)/);
      const folderId = match ? match[1] : pasteLink.trim();
      const folder = await fetchFolderById(token, folderId);
      handleFolderSelect(folder.id, folder.name);
      setPasteLink('');
    } catch {
      setPasteLinkError('לא נמצאה תיקייה — בדוק שהקישור נכון ושיש לך גישה אליה');
    } finally {
      setIsValidatingLink(false);
    }
  };

  const handleDisconnect = (e: React.MouseEvent) => {
    e.stopPropagation();
    localStorage.removeItem('drive_token');
    localStorage.removeItem('drive_folder_id');
    localStorage.removeItem('drive_folder_name');
    setToken(null);
    setSelectedFolder(null);
    setSelectedFolderName(null);
    setShowFolderSelect(false);
  };

  const handleDuplicateAction = (action: 'skip' | 'overwrite' | 'cancel') => {
    setCurrentDuplicate(null);
    duplicateResolveRef.current?.({ action });
    duplicateResolveRef.current = null;
  };

  const buildOnUnknownCategoryCallback = (): OnUnknownCategoryCallback =>
    async (data: ExtractedData) =>
      new Promise<string>((resolve) => {
        setUnknownCategoryFile({ data });
        unknownCategoryResolveRef.current = resolve;
      });

  const handleCategorySelection = (hebrewCategory: string) => {
    setUnknownCategoryFile(null);
    unknownCategoryResolveRef.current?.(hebrewCategory);
    unknownCategoryResolveRef.current = null;
  };

  const handleImportSingleFile = async (file: DriveItem) => {
    if (!token) return;

    setShowFolderSelect(false);
    setSyncSummary(null);
    setSyncProgress({ message: `מוריד את ${file.name}...`, processed: 0, total: 1 });
    setShowSyncProgress(true);

    try {
      // Fetch family members for owner attribution (same pattern as SyncService)
      const budgetSnap = await getDoc(doc(db, 'settings', 'budgetConfig'));
      const familyMembers: string[] = ((budgetSnap.data()?.members ?? []) as { name: string }[]).map(
        (m) => m.name
      );

      const buffer = await downloadFileBuffer(token, file.id);
      const fileObj = new File([buffer], file.name, { type: file.mimeType });

      const result = await processAndUploadFile(
        fileObj,
        token,
        (status) => setSyncProgress({ message: status, processed: 0, total: 1 }),
        familyMembers,
        buildOnUnknownCategoryCallback()
      );

      setSyncSummary({
        processed: result.success ? 1 : 0,
        duplicates: result.duplicate ? 1 : 0,
        errors: result.success ? 0 : 1,
        skipped: 0,
        failed: result.success ? [] : [{ fileName: file.name, error: result.errorMessage ?? 'שגיאה לא ידועה' }],
      });
      setSyncProgress({
        message: result.success
          ? 'הקובץ יובא בהצלחה'
          : result.duplicate
          ? 'הקובץ כבר קיים במערכת'
          : (result.errorMessage ?? 'שגיאה בייבוא'),
        processed: 1,
        total: 1,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה לא ידועה';
      setSyncProgress({ message: `שגיאה: ${msg}`, processed: 0, total: 1 });
    }
  };

  const handleCategoryImport = async () => {
    if (!token || !selectedFolder || !categoryImportCategory) return;

    setShowSyncMode(false);
    setShowSyncProgress(true);
    setSyncSummary(null);
    setSyncProgress({ message: 'מחפש קבצים...', processed: 0, total: 0 });

    try {
      const files = await fetchFilesByYearAndCategory(
        token,
        categoryImportYear,
        categoryImportCategory,
        selectedFolder
      );

      if (files.length === 0) {
        setSyncProgress({ message: 'לא נמצאו קבצים בתיקייה זו', processed: 0, total: 0 });
        setSyncSummary({ processed: 0, duplicates: 0, errors: 0, skipped: 0, failed: [] });
        return;
      }

      const total = files.length;
      setSyncProgress({ message: `נמצאו ${total} קבצים. מתחיל עיבוד...`, processed: 0, total });

      // Fetch family members once
      const budgetSnap = await getDoc(doc(db, 'settings', 'budgetConfig'));
      const familyMembers: string[] = (
        (budgetSnap.data()?.members ?? []) as { name: string }[]
      ).map((m) => m.name);

      let processed = 0;
      let errors = 0;
      let duplicates = 0;
      const failed: { fileName: string; error: string }[] = [];

      const GEMINI_DELAY_MS = 5500;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (i > 0) {
          setSyncProgress({ message: `ממתין לפני עיבוד הבא... (${i}/${total})`, processed: i, total });
          await new Promise((r) => setTimeout(r, GEMINI_DELAY_MS));
        }

        setSyncProgress({ message: `מעבד: ${file.name}`, processed: i, total });

        try {
          const buffer = await downloadFileBuffer(token, file.id);
          const fileObj = new File([buffer], file.name, { type: file.mimeType });

          // Files are already filed in Drive — extract + save to Firestore only
          const result = await processLocalFile(
            fileObj,
            (msg) => setSyncProgress({ message: msg, processed: i, total }),
            familyMembers
          );

          if (result.success) {
            processed++;
          } else if (result.duplicate) {
            duplicates++;
          } else {
            errors++;
            failed.push({ fileName: file.name, error: result.errorMessage ?? 'שגיאה לא ידועה' });
          }
        } catch (err) {
          errors++;
          failed.push({
            fileName: file.name,
            error: err instanceof Error ? err.message : 'שגיאה לא ידועה',
          });
        }

        setSyncProgress({ message: `הושלם: ${file.name}`, processed: i + 1, total });
      }

      const finalSummary: SyncSummary = { processed, duplicates, errors, skipped: 0, failed };
      setSyncSummary(finalSummary);
      setSyncProgress({
        message: `סיום: ${processed} קבצים עובדו בהצלחה`,
        processed: total,
        total,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה לא ידועה';
      setSyncProgress({ message: `שגיאה: ${msg}`, processed: 0, total: 0 });
    }
  };

  const handleStartSync = async (mode: SyncMode = syncMode) => {
    if (!token || !selectedFolder) return;

    setShowSyncMode(false);
    setShowSyncProgress(true);
    setSyncProgress({ message: 'מתחיל סנכרון...', processed: 0, total: 0 });
    setSyncSummary(null);
    setCurrentDuplicate(null);

    // Resolve date range based on mode
    let resolvedRange: { startDate: Date; endDate: Date } | undefined;
    if (mode === 'all') {
      resolvedRange = undefined;
    } else if (mode === 'incremental') {
      const lastSync = getLastSyncTime(selectedFolder);
      resolvedRange = lastSync
        ? { startDate: lastSync, endDate: new Date() }
        : undefined; // first time → sync all
    } else {
      resolvedRange = customDateRange;
    }

    try {
      const summary = await syncFilesFromDrive(
        token,
        selectedFolder,
        resolvedRange,
        (status) => setSyncProgress(status),
        async (fileName, duplicate) =>
          new Promise<DuplicateHandlerResponse>((resolve) => {
            setCurrentDuplicate({ fileName, duplicate, handled: false });
            duplicateResolveRef.current = resolve;
          }),
        buildOnUnknownCategoryCallback()
      );

      saveLastSyncTime(selectedFolder);
      setSyncSummary(summary);
      setSyncProgress({
        message: `סיום סנכרון: ${summary.processed} קבצים טוענו בהצלחה`,
        processed: summary.processed,
        total: summary.processed + summary.skipped,
      });
    } catch (error) {
      console.error('Sync error:', error);
      setSyncProgress({
        message: `שגיאה בסנכרון: ${error instanceof Error ? error.message : 'שגיאה לא ידועה'}`,
        processed: syncProgress.processed,
        total: syncProgress.total,
      });
    }
  };

  return (
    <div className="relative w-full" ref={dropdownRef}>
      {/* Main Sync Button */}
      <button
        onClick={handleSyncClick}
        disabled={isSyncing}
        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-colors ${
          selectedFolder
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
            : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
        }`}
      >
        {isSyncing ? (
          <Loader2 className="w-5 h-5 animate-spin shrink-0" />
        ) : selectedFolder ? (
          <CheckCircle className="w-5 h-5 shrink-0" />
        ) : (
          <Cloud className="w-5 h-5 shrink-0" />
        )}
        <span className="truncate">
          {isSyncing ? 'מסנכרן...' : selectedFolder ? 'מחובר לדרייב' : 'סנכרן עם גוגל דרייב'}
        </span>
        {selectedFolder && !isSyncing && (
          <div
            onClick={handleDisconnect}
            className="p-1 hover:bg-emerald-200 rounded-md mr-auto transition-colors"
            title="התנתק מגוגל דרייב"
          >
            <X className="w-4 h-4" />
          </div>
        )}
      </button>

      {/* Folder Browser */}
      {showFolderSelect && (
        <>
        <div className="fixed inset-0 bg-black/40 z-[199]" onClick={() => setShowFolderSelect(false)} />
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl border border-slate-200 z-[200] overflow-hidden flex flex-col" style={{ width: '560px', height: '600px' }}>

          {/* Header */}
          <div className="p-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
            <h3 className="font-bold text-slate-800 text-sm">בחר תיקייה לסנכרון</h3>
            <button onClick={() => setShowFolderSelect(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Paste Drive link */}
          <div className="p-2 border-b border-slate-100 shrink-0">
            <div className="flex gap-1">
              <button
                onClick={handlePasteLink}
                disabled={isValidatingLink || !pasteLink.trim()}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 shrink-0"
              >
                {isValidatingLink ? <Loader2 className="w-3 h-3 animate-spin" /> : 'אישור'}
              </button>
              <input
                type="text"
                value={pasteLink}
                onChange={(e) => { setPasteLink(e.target.value); setPasteLinkError(null); }}
                onKeyDown={(e) => e.key === 'Enter' && handlePasteLink()}
                placeholder="הדבק קישור לתיקייה..."
                dir="ltr"
                className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            {pasteLinkError && <p className="text-xs text-red-500 mt-1 text-right">{pasteLinkError}</p>}
          </div>

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
                  onClick={() => token && openBrowser(token, segment.id, browserPath.slice(0, i + 1))}
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
              className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-transparent text-right"
            />
          </div>

          {/* Contents */}
          <div className="overflow-y-auto flex-1 p-2 space-y-0.5 custom-scrollbar">
            {isBrowsing ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              </div>
            ) : (
              <>
                {/* Folders */}
                {browserFolders
                  .filter((f) => f.name.toLowerCase().includes(browserSearch.toLowerCase()))
                  .map((folder) => (
                    <div key={folder.id} className="flex items-center gap-1">
                      <button
                        onClick={() => handleFolderSelect(folder.id, folder.name)}
                        className={`flex-1 text-right flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                          selectedFolder === folder.id
                            ? 'bg-emerald-50 text-emerald-700 font-bold border border-emerald-100'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <FolderOpen className={`w-4 h-4 shrink-0 ${selectedFolder === folder.id ? 'text-emerald-500' : 'text-yellow-500'}`} />
                        <span className="truncate flex-1">{folder.name}</span>
                        {selectedFolder === folder.id && <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                      </button>
                      <button
                        onClick={() => token && openBrowser(token, folder.id, [...browserPath, { id: folder.id, name: folder.name }])}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors shrink-0"
                        title="פתח תיקייה"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  ))}

                {/* Files */}
                {browserFiles
                  .filter((f) => f.name.toLowerCase().includes(browserSearch.toLowerCase()))
                  .map((file) => (
                    <div key={file.id} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500 rounded-lg hover:bg-slate-50">
                      <File className="w-4 h-4 shrink-0 text-slate-300" />
                      <span className="truncate flex-1">{file.name}</span>
                      <button
                        onClick={() => handleImportSingleFile(file)}
                        className="text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium shrink-0 transition-colors"
                      >
                        ייבא
                      </button>
                    </div>
                  ))}

                {browserFolders.length === 0 && browserFiles.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-6">תיקייה ריקה</p>
                )}
              </>
            )}
          </div>

          {/* Bottom actions */}
          <div className="p-2 border-t border-slate-100 bg-slate-50 shrink-0 space-y-1.5">
            {/* Select current folder button */}
            {browserPath.length > 0 && (
              <button
                onClick={() => {
                  const current = browserPath[browserPath.length - 1];
                  handleFolderSelect(current.id, current.name);
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors border border-slate-200"
              >
                <Folder className="w-4 h-4" />
                בחר תיקייה זו: {browserPath[browserPath.length - 1]?.name}
              </button>
            )}
            {selectedFolder && (
              <button
                onClick={() => {
                  setShowFolderSelect(false);
                  if (token) loadMonthStructure(token, selectedFolder);
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors text-sm"
              >
                <LayoutGrid className="w-4 h-4" />
                בחר חודשים לסנכרון
              </button>
            )}
          </div>
        </div>
        </>
      )}

      {/* Monthly Board Modal */}
      {showMonthBoard && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[199]" onClick={() => setShowMonthBoard(false)} />
          <div
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl border border-slate-200 z-[200] overflow-hidden flex flex-col"
            style={{ width: '540px', maxHeight: '80vh' }}
          >
            {/* Header */}
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <LayoutGrid className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-slate-800">בחר חודשים לסנכרון</h3>
              </div>
              <div className="flex items-center gap-3">
                {selectedMonths.size > 0 && (
                  <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                    {selectedMonths.size} נבחרו
                  </span>
                )}
                <button onClick={() => setShowMonthBoard(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="overflow-y-auto flex-1 p-4 space-y-5">
              {isLoadingMonths ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                  <p className="text-sm text-slate-500">טוען מבנה תיקיות...</p>
                </div>
              ) : monthStructure.length === 0 ? (
                /* No year/month structure — offer to sync whole folder */
                <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
                  <Folder className="w-10 h-10 text-slate-300" />
                  <div>
                    <p className="font-semibold text-slate-700 text-sm">התיקייה אינה מאורגנת לפי שנה/חודש</p>
                    <p className="text-xs text-slate-400 mt-1">ניתן לסנכרן את כל התיקייה כמקשה אחת</p>
                  </div>
                  <button
                    onClick={() => {
                      setShowMonthBoard(false);
                      setShowSyncMode(true);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    <Play className="w-4 h-4" />
                    סנכרן את כל התיקייה
                  </button>
                </div>
              ) : (
                monthStructure.map((yearGroup) => {
                  const allSelected = yearGroup.months.every((m) => selectedMonths.has(m.id));
                  return (
                    <div key={yearGroup.yearId}>
                      {/* Year header */}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-bold text-slate-700">{yearGroup.year}</span>
                        <button
                          onClick={() => {
                            setSelectedMonths((prev) => {
                              const next = new Set(prev);
                              if (allSelected) {
                                yearGroup.months.forEach((m) => next.delete(m.id));
                              } else {
                                yearGroup.months.forEach((m) => next.add(m.id));
                              }
                              return next;
                            });
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                        >
                          {allSelected ? 'בטל הכל' : 'בחר הכל'}
                        </button>
                      </div>
                      {/* Month grid */}
                      <div className="grid grid-cols-4 gap-2">
                        {yearGroup.months.map((month) => {
                          const isSelected = selectedMonths.has(month.id);
                          return (
                            <button
                              key={month.id}
                              onClick={() => {
                                setSelectedMonths((prev) => {
                                  const next = new Set(prev);
                                  if (isSelected) next.delete(month.id);
                                  else next.add(month.id);
                                  return next;
                                });
                              }}
                              className={`relative flex flex-col items-center justify-center py-3 px-2 rounded-xl border-2 transition-all text-sm font-medium ${
                                isSelected
                                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                                  : 'border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-slate-50'
                              }`}
                            >
                              <span className="text-xs text-slate-400 font-normal mb-0.5">{month.name}</span>
                              <span>{month.hebrewName}</span>
                              {isSelected && (
                                <CheckCircle className="absolute top-1 left-1 w-3 h-3 text-blue-500" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            {!isLoadingMonths && monthStructure.length > 0 && (
              <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0 flex gap-2">
                <button
                  onClick={() => setShowMonthBoard(false)}
                  className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  ביטול
                </button>
                <button
                  onClick={handleSyncSelectedMonths}
                  disabled={selectedMonths.size === 0}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Play className="w-4 h-4" />
                  {selectedMonths.size > 0
                    ? `סנכרן ${selectedMonths.size} חודש${selectedMonths.size > 1 ? 'ים' : ''}`
                    : 'בחר חודשים'}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Sync Mode Modal */}
      {showSyncMode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">בחר אופן סנכרון</h3>
              <button onClick={() => setShowSyncMode(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-2">
              {/* All */}
              <button
                onClick={() => { setSyncMode('all'); handleStartSync('all'); }}
                className="w-full text-right flex items-start gap-3 p-4 rounded-xl border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-all"
              >
                <span className="text-2xl shrink-0">📂</span>
                <div>
                  <p className="font-bold text-slate-800 text-sm">סנכרן את כל התיקייה</p>
                  <p className="text-xs text-slate-500 mt-0.5">טוען את כל המסמכים בתיקייה, ללא תלות בתאריך</p>
                </div>
              </button>

              {/* Incremental */}
              <button
                onClick={() => { setSyncMode('incremental'); handleStartSync('incremental'); }}
                className="w-full text-right flex items-start gap-3 p-4 rounded-xl border-2 border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50 transition-all"
              >
                <span className="text-2xl shrink-0">⚡</span>
                <div>
                  <p className="font-bold text-slate-800 text-sm">סנכרן חדש בלבד</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedFolder && getLastSyncTime(selectedFolder)
                      ? `רק מסמכים שהשתנו מאז ${getLastSyncTime(selectedFolder)!.toLocaleDateString('he-IL')}`
                      : 'סנכרון ראשון — יטען הכל'}
                  </p>
                </div>
              </button>

              {/* Custom */}
              <button
                onClick={() => setSyncMode('custom')}
                className={`w-full text-right flex items-start gap-3 p-4 rounded-xl border-2 transition-all ${syncMode === 'custom' ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'}`}
              >
                <span className="text-2xl shrink-0">📅</span>
                <div className="flex-1">
                  <p className="font-bold text-slate-800 text-sm">בחר טווח תאריכים</p>
                  <p className="text-xs text-slate-500 mt-0.5">טוען רק מסמכים מטווח ספציפי</p>
                </div>
              </button>

              {/* Custom date inputs */}
              {syncMode === 'custom' && (
                <div className="px-1 pt-1 space-y-3">
                  <div className="flex gap-3 items-center">
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-slate-600 mb-1 text-right">מתאריך</label>
                      <input
                        type="date"
                        value={customDateRange.startDate.toISOString().split('T')[0]}
                        onChange={(e) => setCustomDateRange({ ...customDateRange, startDate: new Date(e.target.value) })}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-slate-600 mb-1 text-right">עד תאריך</label>
                      <input
                        type="date"
                        value={customDateRange.endDate.toISOString().split('T')[0]}
                        onChange={(e) => setCustomDateRange({ ...customDateRange, endDate: new Date(e.target.value) })}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => handleStartSync('custom')}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm"
                  >
                    <Play className="w-4 h-4" />
                    התחל סנכרון
                  </button>
                </div>
              )}

              {/* Category Import */}
              <button
                onClick={() => setSyncMode('category')}
                className={`w-full text-right flex items-start gap-3 p-4 rounded-xl border-2 transition-all ${syncMode === 'category' ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'}`}
              >
                <Filter className="w-6 h-6 shrink-0 mt-0.5 text-indigo-500" />
                <div className="flex-1">
                  <p className="font-bold text-slate-800 text-sm">ייבוא לפי קטגוריה</p>
                  <p className="text-xs text-slate-500 mt-0.5">טוען קבצים לפי שנה וקטגוריה ספציפית (ללא העלאה מחדש)</p>
                </div>
              </button>

              {/* Category import selectors */}
              {syncMode === 'category' && (
                <div className="px-1 pt-1 space-y-3">
                  <div className="flex gap-3">
                    <div className="w-28 shrink-0">
                      <label className="block text-xs font-semibold text-slate-600 mb-1 text-right">שנה</label>
                      <select
                        value={categoryImportYear}
                        onChange={(e) => setCategoryImportYear(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        dir="rtl"
                      >
                        {['2022', '2023', '2024', '2025', '2026'].map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-slate-600 mb-1 text-right">קטגוריה</label>
                      <select
                        value={categoryImportCategory}
                        onChange={(e) => setCategoryImportCategory(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        dir="rtl"
                      >
                        <option value="">-- בחר קטגוריה --</option>
                        {Object.values(CATEGORY_MAP).map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button
                    disabled={!categoryImportCategory}
                    onClick={handleCategoryImport}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm"
                  >
                    <Filter className="w-4 h-4" />
                    התחל ייבוא
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sync Progress Modal */}
      {showSyncProgress && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800">סנכרון בתהליך</h3>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-blue-600 h-full transition-all duration-300"
                    style={{
                      width: `${
                        syncProgress.total > 0
                          ? (syncProgress.processed / syncProgress.total) * 100
                          : 0
                      }%`,
                    }}
                  ></div>
                </div>
                {syncProgress.total > 0 && (
                  <p className="text-sm text-slate-600 mt-2 text-center">
                    {syncProgress.processed} / {syncProgress.total}
                  </p>
                )}
              </div>

              <div className="flex items-start gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600 shrink-0 mt-0.5" />
                <p className="text-slate-700 text-sm">{syncProgress.message}</p>
              </div>

              {syncSummary && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                  <h4 className="font-semibold text-emerald-900 mb-2">סיכום סנכרון:</h4>
                  <ul className="space-y-1 text-sm text-emerald-800">
                    <li>✅ קבצים טוענו: {syncSummary.processed}</li>
                    {syncSummary.duplicates > 0 && (
                      <li>⚠️ דילוגו כפילויות: {syncSummary.duplicates}</li>
                    )}
                    {syncSummary.errors > 0 && (
                      <li>❌ שגיאות: {syncSummary.errors}</li>
                    )}
                    {syncSummary.errors > 0 && syncSummary.failed.length > 0 && (
                      <li className="text-xs text-red-600 mt-1 break-all">
                        דוגמת שגיאה: {syncSummary.failed[0].error}
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {syncSummary && (
                <button
                  onClick={() => {
                    setShowSyncProgress(false);
                    setSyncSummary(null);
                    setSyncProgress({ message: '', processed: 0, total: 0 });
                  }}
                  className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  סגור
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Category Picker Modal — shown when Gemini returns 'שונות' */}
      {unknownCategoryFile && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[115] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100 flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-bold text-slate-800">היכן לתייק את המסמך?</h3>
                <p className="text-sm text-slate-500 mt-1">
                  הבינה המלאכותית לא זיהתה קטגוריה עבור "{unknownCategoryFile.data.vendor}"
                </p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-slate-50 rounded-lg p-4 text-sm space-y-1">
                <p><span className="font-semibold">ספק: </span>{unknownCategoryFile.data.vendor}</p>
                <p><span className="font-semibold">סכום: </span>₪{unknownCategoryFile.data.amount}</p>
                <p><span className="font-semibold">תאריך: </span>{unknownCategoryFile.data.date}</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {Object.entries(CATEGORY_MAP)
                  .filter(([key]) => key !== 'General_Misc')
                  .map(([key, hebrew]) => (
                    <button
                      key={key}
                      onClick={() => handleCategorySelection(hebrew)}
                      className="px-3 py-2 text-sm rounded-lg border border-slate-200 hover:bg-blue-50 hover:border-blue-300 text-right transition-colors"
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

      {/* Duplicate Handler Modal */}
      {currentDuplicate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100 flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-bold text-slate-800">קובץ כפול נמצא</h3>
                <p className="text-sm text-slate-600 mt-1">
                  הקובץ "{currentDuplicate.fileName}" קיים כבר במערכת
                </p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-700">
                <p className="font-semibold mb-2">פרטי הקובץ הקיים:</p>
                <p>תאריך: {new Date(currentDuplicate.duplicate.date).toLocaleDateString('he-IL')}</p>
                <p>סכום: ₪{currentDuplicate.duplicate.amount}</p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => handleDuplicateAction('skip')}
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors"
                >
                  דלג
                </button>
                <button
                  onClick={() => handleDuplicateAction('overwrite')}
                  className="flex-1 px-4 py-2.5 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 transition-colors"
                >
                  עדכן
                </button>
                <button
                  onClick={() => handleDuplicateAction('cancel')}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
                >
                  בטל
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
