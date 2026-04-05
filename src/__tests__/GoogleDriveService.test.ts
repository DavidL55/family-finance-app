import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchFilesByYearAndCategory } from '../services/GoogleDriveService';

// fetchFolderContents uses global fetch internally.
// We stub fetch to simulate the Drive folder tree:
//   root → Family_Finance → 2024 → 01, 02, 03 → {category} → files

type DriveFile = { id: string; name: string; mimeType: string };
type DriveFolder = { id: string; name: string; mimeType: string };

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const PDF_MIME = 'application/pdf';

function driveResponse(files: (DriveFile | DriveFolder)[]) {
  return {
    ok: true,
    json: async () => ({ files }),
  };
}

// Stable IDs for the folder tree
const IDS = {
  root: 'root',
  familyFinance: 'ff-id',
  year2024: '2024-id',
  month01: 'jan-id',
  month02: 'feb-id',
  month03: 'mar-id',
  catJan: 'cat-jan-id',
  catFeb: 'cat-feb-id',
};

function buildFetchMock(category: string) {
  return vi.fn(async (url: string) => {
    const q = new URL(url as string).searchParams.get('q') ?? '';

    // root contents
    if (q.includes(`'root' in parents`)) {
      return driveResponse([{ id: IDS.familyFinance, name: 'Family_Finance', mimeType: FOLDER_MIME }]);
    }
    // Family_Finance contents → year folder
    if (q.includes(`'${IDS.familyFinance}' in parents`)) {
      return driveResponse([{ id: IDS.year2024, name: '2024', mimeType: FOLDER_MIME }]);
    }
    // Year 2024 → month folders
    if (q.includes(`'${IDS.year2024}' in parents`)) {
      return driveResponse([
        { id: IDS.month01, name: '01', mimeType: FOLDER_MIME },
        { id: IDS.month02, name: '02', mimeType: FOLDER_MIME },
        { id: IDS.month03, name: '03', mimeType: FOLDER_MIME },
      ]);
    }
    // Jan → has category folder
    if (q.includes(`'${IDS.month01}' in parents`)) {
      return driveResponse([{ id: IDS.catJan, name: category, mimeType: FOLDER_MIME }]);
    }
    // Feb → has category folder
    if (q.includes(`'${IDS.month02}' in parents`)) {
      return driveResponse([{ id: IDS.catFeb, name: category, mimeType: FOLDER_MIME }]);
    }
    // Mar → no category folder
    if (q.includes(`'${IDS.month03}' in parents`)) {
      return driveResponse([{ id: 'other-cat-id', name: 'אחר', mimeType: FOLDER_MIME }]);
    }
    // Category folder contents (Jan)
    if (q.includes(`'${IDS.catJan}' in parents`)) {
      return driveResponse([
        { id: 'file-jan-1', name: 'jan-report.pdf', mimeType: PDF_MIME },
        { id: 'file-jan-2', name: 'jan-invoice.pdf', mimeType: PDF_MIME },
      ]);
    }
    // Category folder contents (Feb)
    if (q.includes(`'${IDS.catFeb}' in parents`)) {
      return driveResponse([{ id: 'file-feb-1', name: 'feb-report.pdf', mimeType: PDF_MIME }]);
    }

    return driveResponse([]);
  });
}

describe('fetchFilesByYearAndCategory', () => {
  const CATEGORY = 'ביטוח ופנסיה';

  beforeEach(() => {
    vi.stubGlobal('fetch', buildFetchMock(CATEGORY));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns files from all months that contain the target category', async () => {
    const files = await fetchFilesByYearAndCategory('token', '2024', CATEGORY);
    expect(files).toHaveLength(3); // 2 from Jan + 1 from Feb
    expect(files.map((f) => f.id)).toEqual(
      expect.arrayContaining(['file-jan-1', 'file-jan-2', 'file-feb-1'])
    );
  });

  it('skips months that do not have the target category folder', async () => {
    const files = await fetchFilesByYearAndCategory('token', '2024', CATEGORY);
    // March has no 'ביטוח ופנסיה' folder — only 3 files total, not 4
    const marchIds = files.filter((f) => f.id.startsWith('file-mar'));
    expect(marchIds).toHaveLength(0);
  });

  it('returns empty array when Family_Finance folder does not exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        driveResponse([{ id: 'other', name: 'SomeOtherFolder', mimeType: FOLDER_MIME }])
      )
    );
    const files = await fetchFilesByYearAndCategory('token', '2024', CATEGORY);
    expect(files).toHaveLength(0);
  });

  it('returns empty array when the requested year folder does not exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const q = new URL(url as string).searchParams.get('q') ?? '';
        if (q.includes(`'root' in parents`)) {
          return driveResponse([{ id: IDS.familyFinance, name: 'Family_Finance', mimeType: FOLDER_MIME }]);
        }
        if (q.includes(`'${IDS.familyFinance}' in parents`)) {
          return driveResponse([{ id: '2023-id', name: '2023', mimeType: FOLDER_MIME }]);
        }
        return driveResponse([]);
      })
    );

    const files = await fetchFilesByYearAndCategory('token', '2024', CATEGORY);
    expect(files).toHaveLength(0);
  });

  it('returns empty array when no month has the target category', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const q = new URL(url as string).searchParams.get('q') ?? '';
        if (q.includes(`'root' in parents`)) {
          return driveResponse([{ id: IDS.familyFinance, name: 'Family_Finance', mimeType: FOLDER_MIME }]);
        }
        if (q.includes(`'${IDS.familyFinance}' in parents`)) {
          return driveResponse([{ id: IDS.year2024, name: '2024', mimeType: FOLDER_MIME }]);
        }
        if (q.includes(`'${IDS.year2024}' in parents`)) {
          return driveResponse([{ id: IDS.month01, name: '01', mimeType: FOLDER_MIME }]);
        }
        // Month has only unrelated category
        return driveResponse([{ id: 'other', name: 'מגורים ובית', mimeType: FOLDER_MIME }]);
      })
    );

    const files = await fetchFilesByYearAndCategory('token', '2024', 'ביטוח ופנסיה');
    expect(files).toHaveLength(0);
  });

  it('ignores non-two-digit folder names (e.g. year or misc folders inside year)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const q = new URL(url as string).searchParams.get('q') ?? '';
        if (q.includes(`'root' in parents`)) {
          return driveResponse([{ id: IDS.familyFinance, name: 'Family_Finance', mimeType: FOLDER_MIME }]);
        }
        if (q.includes(`'${IDS.familyFinance}' in parents`)) {
          return driveResponse([{ id: IDS.year2024, name: '2024', mimeType: FOLDER_MIME }]);
        }
        if (q.includes(`'${IDS.year2024}' in parents`)) {
          // Mix of valid month folders and noise
          return driveResponse([
            { id: IDS.month01, name: '01', mimeType: FOLDER_MIME },
            { id: 'noise', name: 'archive', mimeType: FOLDER_MIME },
            { id: 'noise2', name: '1', mimeType: FOLDER_MIME }, // single digit — invalid
          ]);
        }
        if (q.includes(`'${IDS.month01}' in parents`)) {
          return driveResponse([{ id: IDS.catJan, name: CATEGORY, mimeType: FOLDER_MIME }]);
        }
        if (q.includes(`'${IDS.catJan}' in parents`)) {
          return driveResponse([{ id: 'file-jan-1', name: 'jan.pdf', mimeType: PDF_MIME }]);
        }
        return driveResponse([]);
      })
    );

    const files = await fetchFilesByYearAndCategory('token', '2024', CATEGORY);
    // Only file from valid month '01' should appear
    expect(files).toHaveLength(1);
    expect(files[0].id).toBe('file-jan-1');
  });
});
