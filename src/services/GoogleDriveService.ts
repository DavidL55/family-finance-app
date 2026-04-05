interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  modifiedTime: string;
}

export interface DriveFolder {
  id: string;
  name: string;
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
}

interface FetchFilesResponse {
  files: DriveFile[];
  nextPageToken?: string;
}

interface DriveCreateMetadata {
  name: string;
  mimeType: string;
  parents?: string[];
}

/**
 * Get an existing Drive folder by name (and optional parent), or create it if it doesn't exist.
 * Single canonical implementation — used by FileProcessor and SyncService.
 */
export const getOrCreateFolder = async (
  token: string,
  folderName: string,
  parentId?: string
): Promise<string> => {
  const queryStr = `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false${parentId ? ` and '${parentId}' in parents` : ''}`;
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(queryStr)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!searchRes.ok) {
    throw new Error(`Failed to search folder: ${folderName} HTTP ${searchRes.status}`);
  }

  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id as string;
  }

  const metadata: DriveCreateMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    ...(parentId ? { parents: [parentId] } : {}),
  };

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });

  if (!createRes.ok) {
    throw new Error(`Failed to create folder: ${folderName} HTTP ${createRes.status}`);
  }

  const createData = await createRes.json();
  return createData.id as string;
};

export const fetchDriveFolders = async (accessToken: string): Promise<DriveFolder[]> => {
  const allFolders: DriveFolder[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: 'files(id,name),nextPageToken',
      orderBy: 'name',
      pageSize: '100',
      ...(pageToken ? { pageToken } : {}),
    });

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch folders HTTP ${response.status}`);
    }

    const data = await response.json();
    allFolders.push(...(data.files as DriveFolder[]));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFolders;
};

/**
 * Fetch contents of a specific Drive folder (folders + files), used for browser navigation.
 * Pass folderId='root' to start at My Drive.
 */
export const fetchFolderContents = async (
  accessToken: string,
  folderId: string = 'root'
): Promise<{ folders: DriveFolder[]; files: DriveItem[] }> => {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType)',
    orderBy: 'folder,name',
    pageSize: '100',
  });

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch folder contents HTTP ${response.status}`);
  }

  const data = await response.json();
  const items: DriveItem[] = data.files || [];
  const FOLDER_MIME = 'application/vnd.google-apps.folder';

  return {
    folders: items.filter((f) => f.mimeType === FOLDER_MIME),
    files: items.filter((f) => f.mimeType !== FOLDER_MIME),
  };
};

/**
 * Fetch a single folder's metadata by ID — used to validate a pasted Drive link
 */
export const fetchFolderById = async (
  accessToken: string,
  folderId: string
): Promise<DriveFolder> => {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) {
    throw new Error('לא נמצאה תיקייה עם המזהה הזה');
  }
  const data = await response.json();
  return { id: data.id, name: data.name } as DriveFolder;
};

/**
 * Fetch files from a specific Drive folder with optional date range filtering
 * Supports PDF and image files only
 */
export const fetchFilesFromFolder = async (
  accessToken: string,
  folderId: string,
  dateRange?: { startDate: Date; endDate: Date },
  pageSize: number = 50
): Promise<FetchFilesResponse> => {
  // Build query for PDF and image files in the folder
  let query = `'${folderId}' in parents and trashed=false and (mimeType='application/pdf' or mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/gif' or mimeType='image/webp')`;

  // Add date range filter if provided
  if (dateRange) {
    const startISO = dateRange.startDate.toISOString();
    const endISO = dateRange.endDate.toISOString();
    query += ` and modifiedTime>='${startISO}' and modifiedTime<'${endISO}'`;
  }

  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name,mimeType,createdTime,modifiedTime),nextPageToken',
    pageSize: pageSize.toString(),
    orderBy: 'modifiedTime desc',
  });

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch files from folder HTTP ${response.status}`);
  }

  const data = await response.json();
  return {
    files: data.files || [],
    nextPageToken: data.nextPageToken,
  };
};

/**
 * Download a file from Google Drive and return it as an ArrayBuffer
 */
export const downloadFileBuffer = async (
  accessToken: string,
  fileId: string
): Promise<ArrayBuffer> => {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to download file ${fileId}: HTTP ${response.status} ${response.statusText}`);
  }

  return response.arrayBuffer();
};

/**
 * Traverse the known Family_Finance/YYYY/MM/<category> folder structure and
 * collect all files under a specific year + Hebrew category across all months.
 * Uses sequential fetchFolderContents calls (max 12 for a full year) to stay
 * within Drive API rate limits.
 */
export const fetchFilesByYearAndCategory = async (
  accessToken: string,
  year: string,
  categoryHebrew: string,
  rootFolderId: string = 'root'
): Promise<DriveItem[]> => {
  // Step 1: Find Family_Finance under the chosen root
  const rootContents = await fetchFolderContents(accessToken, rootFolderId);
  const familyFinanceFolder = rootContents.folders.find((f) => f.name === 'Family_Finance');
  if (!familyFinanceFolder) return [];

  // Step 2: Find the year folder
  const yearContents = await fetchFolderContents(accessToken, familyFinanceFolder.id);
  const yearFolder = yearContents.folders.find((f) => f.name === year);
  if (!yearFolder) return [];

  // Step 3: Get all two-digit month folders
  const monthContents = await fetchFolderContents(accessToken, yearFolder.id);
  const monthFolders = monthContents.folders
    .filter((f) => /^\d{2}$/.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Step 4: For each month, look for the category subfolder and collect files
  const allFiles: DriveItem[] = [];
  for (const monthFolder of monthFolders) {
    const monthItems = await fetchFolderContents(accessToken, monthFolder.id);
    const categoryFolder = monthItems.folders.find((f) => f.name === categoryHebrew);
    if (!categoryFolder) continue;

    const categoryItems = await fetchFolderContents(accessToken, categoryFolder.id);
    allFiles.push(...categoryItems.files);
  }

  return allFiles;
};

/**
 * Infer month and year from a filename
 * Supports patterns like: 2026-03-15_..., 2026_03_..., 03_2026_..., etc.
 * Falls back to null if no pattern match
 */
export const inferMonthFromFileName = (fileName: string): { year: string; month: string } | null => {
  // Pattern 1: YYYY-MM-DD or YYYY-MM format
  const pattern1 = /(\d{4})[-._ ](\d{2})/;
  const match1 = fileName.match(pattern1);
  if (match1) {
    return { year: match1[1], month: match1[2] };
  }

  // Pattern 2: MM_YYYY or MM-YYYY format
  const pattern2 = /(\d{2})[-._ ](\d{4})/;
  const match2 = fileName.match(pattern2);
  if (match2) {
    return { year: match2[2], month: match2[1] };
  }

  // Pattern 3: YYYYMM format (no separators)
  const pattern3 = /(\d{4})(\d{2})/;
  const match3 = fileName.match(pattern3);
  if (match3) {
    return { year: match3[1], month: match3[2] };
  }

  return null;
};
