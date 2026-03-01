import React, { useState, useEffect, useRef } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { Cloud, Loader2, Folder, CheckCircle, X } from 'lucide-react';
import { fetchDriveFolders } from '../services/GoogleDriveService';

export default function SyncButton() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [folders, setFolders] = useState<any[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(localStorage.getItem('drive_folder_id'));
  const [token, setToken] = useState<string | null>(localStorage.getItem('drive_token'));
  const [showFolderSelect, setShowFolderSelect] = useState(false);
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

  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      const accessToken = tokenResponse.access_token;
      setToken(accessToken);
      localStorage.setItem('drive_token', accessToken);
      setIsSyncing(true);
      try {
        const driveFolders = await fetchDriveFolders(accessToken);
        setFolders(driveFolders);
        setShowFolderSelect(true);
      } catch (error) {
        console.error(error);
      } finally {
        setIsSyncing(false);
      }
    },
    scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file',
    onError: () => {
      console.error('Login Failed');
      setIsSyncing(false);
    }
  });

  const handleSyncClick = () => {
    if (!token) {
      setIsSyncing(true);
      login();
    } else {
      setIsSyncing(true);
      fetchDriveFolders(token).then(driveFolders => {
        setFolders(driveFolders);
        setShowFolderSelect(true);
        setIsSyncing(false);
      }).catch(() => {
        localStorage.removeItem('drive_token');
        setToken(null);
        login();
      });
    }
  };

  const handleFolderSelect = (folderId: string) => {
    setSelectedFolder(folderId);
    localStorage.setItem('drive_folder_id', folderId);
    setShowFolderSelect(false);
  };

  const handleDisconnect = (e: React.MouseEvent) => {
    e.stopPropagation();
    localStorage.removeItem('drive_token');
    localStorage.removeItem('drive_folder_id');
    setToken(null);
    setSelectedFolder(null);
    setShowFolderSelect(false);
  };

  return (
    <div className="relative w-full" ref={dropdownRef}>
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
        <span className="truncate">{isSyncing ? 'מסנכרן...' : selectedFolder ? 'מחובר לדרייב' : 'סנכרן עם גוגל דרייב'}</span>
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

      {showFolderSelect && folders.length > 0 && (
        <div className="absolute top-full right-0 mt-2 w-full bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden flex flex-col max-h-80">
          <div className="p-3 border-b border-slate-100 bg-slate-50 sticky top-0 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 text-sm">בחר תיקיית יעד</h3>
            <button onClick={() => setShowFolderSelect(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-2 overflow-y-auto flex-1 space-y-1 custom-scrollbar">
            {folders.map(folder => (
              <button
                key={folder.id}
                onClick={() => handleFolderSelect(folder.id)}
                className={`w-full text-right flex items-center gap-3 p-3 rounded-lg text-sm transition-colors ${
                  selectedFolder === folder.id 
                    ? 'bg-emerald-50 text-emerald-700 font-bold border border-emerald-100' 
                    : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                }`}
              >
                <Folder className={`w-5 h-5 shrink-0 ${selectedFolder === folder.id ? 'text-emerald-500' : 'text-slate-400'}`} />
                <span className="truncate flex-1">{folder.name}</span>
                {selectedFolder === folder.id && <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
