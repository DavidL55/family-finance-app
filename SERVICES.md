# Family Finance App — Service Layer

All external communication (Firebase, Google Drive, Gemini AI) is isolated in `src/services/` and `src/utils/`. UI components never call external APIs directly.

---

## Service: `src/services/firebase.ts`

Initializes the Firebase app and exports two singletons used everywhere.

### What It Does
```typescript
import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const app = initializeApp(firebaseConfig);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache()   // Offline reads/writes cached locally
});

export const auth = getAuth(app);
export default app;
```

### Key Decisions
- **`persistentLocalCache()`** — uses IndexedDB to persist Firestore data offline. Reads succeed while offline; writes queue and sync when reconnected.
- Uses Firebase v10+ modern API (not `enableIndexedDbPersistence()` which is v9 compat mode).
- Config values read from `import.meta.env.VITE_FIREBASE_*` (Vite env vars).

### Exports
| Export | Type | Purpose |
|--------|------|---------|
| `db` | `Firestore` | Used for all Firestore reads/writes |
| `auth` | `Auth` | Used for anonymous sign-in in App.tsx |
| `default` | `FirebaseApp` | Rarely used directly |

---

## Service: `src/services/ai.ts`

Wraps all Gemini AI interactions at the session/insight level. File-level extraction lives in `FileProcessor.ts`.

### Function: `generateFinancialInsights(data)`

```typescript
async function generateFinancialInsights(data: any): Promise<string[]>
```

**Reads:** `process.env.GEMINI_API_KEY` (injected by Vite define)
**Returns:** Array of 3 Hebrew insight strings

**Flow:**
1. Check for API key — if absent/empty, return hardcoded fallback strings
2. Build Hebrew prompt with `JSON.stringify(data, null, 2)` as context
3. Call `gemini-3-flash-preview` with `responseMimeType: "application/json"` and `responseSchema` (array of strings)
4. Strip markdown code fences from response
5. `JSON.parse()` and return
6. On any error, return hardcoded fallback strings (never throws to caller)

**Fallback strings (always available):**
```
"שים לב: הוצאות המזון חרגו ב-20% מהתקציב."
"טיפ: מעבר לחברת ביטוח אחרת יכול לחסוך לך 100 ש״ח בחודש."
"הכנסות החודש גבוהות ב-5% מהחודש שעבר, כל הכבוד!"
```

### Function: `getFinancialChatSession(data)`

```typescript
function getFinancialChatSession(data: any): ChatSession | null
```

**Returns:** A Gemini `ChatSession` object (with `.sendMessage()`) or `null` if no API key.

**System instruction includes:**
- Role: "יועץ פיננסי חכם למשפחות" (smart family financial advisor)
- Context: Full `JSON.stringify(data)` of current month's finances
- Constraints: Hebrew only, short chat-style answers

Dashboard stores the session and uses it for multi-turn conversation.

---

## Service: `src/services/GoogleDriveService.ts`

Low-level Google Drive API v3 utilities. All functions take an `accessToken` (from Google OAuth) as first argument. Uses `fetch()` directly — no Drive client library.

### Function: `getOrCreateFolder(token, folderName, parentId?)`

```typescript
async function getOrCreateFolder(token, folderName, parentId?): Promise<string>
```

The canonical implementation for folder management. Used by both `FileProcessor.ts` and `SyncService.ts`.

**Logic:**
1. Search: `mimeType='application/vnd.google-apps.folder' and name='{folderName}' and trashed=false [and '{parentId}' in parents]`
2. If found → return existing folder ID
3. If not found → POST to Drive API to create folder, return new ID

**Used to build the folder tree:** `Family_Finance / YYYY / MM / Hebrew_Category`

---

### Function: `fetchDriveFolders(accessToken)`

```typescript
async function fetchDriveFolders(accessToken): Promise<DriveFolder[]>
```

Returns all folders in the user's Drive. Paginated (100 per page), follows `nextPageToken` until exhausted. Ordered by name.

Used by SyncButton to populate the initial folder list before user browses.

---

### Function: `fetchFolderContents(accessToken, folderId = 'root')`

```typescript
async function fetchFolderContents(accessToken, folderId): Promise<{ folders: DriveFolder[], files: DriveItem[] }>
```

Returns items inside a specific folder, split into folders and non-folders. Ordered by `folder,name` (folders first). Used by SyncButton's folder browser navigation.

Pass `folderId = 'root'` to start from My Drive.

---

### Function: `fetchFolderById(accessToken, folderId)`

```typescript
async function fetchFolderById(accessToken, folderId): Promise<DriveFolder>
```

Fetches metadata (id, name) for a single folder by ID. Used to validate a pasted Google Drive link. Throws Hebrew error if folder not found.

---

### Function: `fetchFilesFromFolder(accessToken, folderId, dateRange?, pageSize)`

```typescript
async function fetchFilesFromFolder(accessToken, folderId, dateRange?, pageSize = 50): Promise<FetchFilesResponse>
```

Fetches PDF and image files from a folder, with optional date range filter.

**Supported file types:** `application/pdf`, `image/jpeg`, `image/png`, `image/gif`, `image/webp`

**Date range:** Filters by `modifiedTime >= startISO and modifiedTime < endISO`

**Returns:** `{ files: DriveFile[], nextPageToken?: string }`

Used by `SyncService` to get the list of files to process.

---

### Function: `downloadFileBuffer(accessToken, fileId)`

```typescript
async function downloadFileBuffer(accessToken, fileId): Promise<ArrayBuffer>
```

Downloads a file's binary content from Drive as `ArrayBuffer`. Used by `SyncService` to get file data before passing to Gemini.

URL: `https://www.googleapis.com/drive/v3/files/{fileId}?alt=media`

---

### Function: `inferMonthFromFileName(fileName)`

```typescript
function inferMonthFromFileName(fileName): { year: string, month: string } | null
```

Parses date information from a filename using 3 regex patterns:

| Pattern | Example | Extracted |
|---------|---------|-----------|
| `YYYY-MM-DD` or `YYYY-MM` | `2026-03-15_invoice.pdf` | year=2026, month=03 |
| `MM_YYYY` or `MM-YYYY` | `03_2026_salary.pdf` | year=2026, month=03 |
| `YYYYMM` (no separator) | `202603_receipt.pdf` | year=2026, month=03 |

Returns `null` if no pattern matches — SyncService then falls back to the file's `createdTime`.

---

## Service: `src/services/SyncService.ts`

Orchestrates the full Google Drive → AI extraction → Firestore sync pipeline. This is the most complex service.

### Function: `syncFilesFromDrive(...)`

```typescript
async function syncFilesFromDrive(
  accessToken: string,
  selectedFolderId: string,
  dateRange: { startDate: Date, endDate: Date } | undefined,
  onProgress: (status: SyncProgressStatus) => void,
  onDuplicate: (fileName: string, duplicate: ExtractedData) => Promise<DuplicateHandlerResponse>
): Promise<SyncSummary>
```

**Parameters:**
- `accessToken` — Google OAuth token
- `selectedFolderId` — Drive folder to sync from
- `dateRange` — optional date filter (incremental or custom sync modes)
- `onProgress` — callback for UI progress updates: `{ message, processed, total }`
- `onDuplicate` — async callback that pauses sync and awaits user decision: `skip | overwrite | cancel`

**Returns:** `SyncSummary { processed, duplicates, errors, skipped, failed[] }`

**Full Step-by-Step Flow:**

```
1. fetchFilesFromFolder(token, folderId, dateRange, 100)
   └── Get up to 100 PDF/image files

2. For each file (index i):

   a. Rate limit: if i > 0, wait 4,500ms before calling Gemini

   b. Report progress: "מעבד קובץ: {filename}"

   c. downloadFileBuffer(token, file.id)
      └── ArrayBuffer of file content

   d. arrayBufferToFile(buffer, fileName, mimeType)
      └── Convert ArrayBuffer → File object (Blob wrapper)

   e. extractDataWithGemini(fileObj)
      └── Gemini 2.0 Flash → ExtractedData

   f. checkDuplicate(extractedData)
      └── Firestore query: vendor + amount + date
      ├── Duplicate found:
      │     summary.duplicates++
      │     response = await onDuplicate(fileName, data)
      │     ├── 'cancel' → return summary immediately
      │     ├── 'skip'   → summary.skipped++, continue to next file
      │     └── 'overwrite' → continue processing
      └── No duplicate: continue

   g. inferMonthFromFileName(file.name)
      └── Fallback: new Date(file.createdTime)

   h. ensureFolderPathForMonth(token, category, { year, month })
      └── getOrCreateFolder × 4:
          Family_Finance → year → month → hebrewCategory
      └── Returns: categoryFolderId

   i. Upload file to Drive (multipart):
      POST https://upload.googleapis.com/upload/drive/v3/files?uploadType=multipart
      Headers: { Authorization: Bearer {token} }
      Body: FormData { metadata (JSON blob), file (binary) }
      Filename: {date}_{vendor}_{amount}.{ext}

   j. addDoc(db, 'transactions', {
        ...extractedData,
        created_at: serverTimestamp(),
        driveFileId: uploadedFile.id,
        syncFolderId: selectedFolderId
      })

   k. summary.processed++

3. Return SyncSummary
```

**Helper: `arrayBufferToFile(buffer, fileName, mimeType)`**
Converts `ArrayBuffer` to `File` object by wrapping in a `Blob`. Needed because Gemini's `extractDataWithGemini` expects a `File`.

**Helper: `ensureFolderPathForMonth(token, category, { year, month })`**
Creates or fetches 4 nested folders in Drive: `Family_Finance / YYYY / MM / hebrewCategory`. Returns the deepest folder ID.

---

### Function: `getLastSyncTime(folderId)`

```typescript
async function getLastSyncTime(folderId: string): Promise<Date | null>
```

Queries all transactions with `syncFolderId == folderId`, finds the one with the latest `timestamp` field, returns it as a `Date`. Used by SyncButton to determine the cutoff for incremental sync.

Returns `null` if no transactions exist for this folder or if Firestore is unreachable.

---

## Utility: `src/utils/FileProcessor.ts`

The file extraction and local save pipeline. Handles files uploaded directly by the user (not from Drive sync).

### Function: `extractDataWithGemini(file)`

```typescript
async function extractDataWithGemini(file: File): Promise<ExtractedData>
```

1. Read `file` with `FileReader.readAsDataURL()` → base64 string
2. Build Gemini prompt (structured extraction, 9 categories)
3. Call `gemini-2.0-flash` with `inlineData` + text prompt
4. Parse response JSON → `ExtractedData`

API key source: `import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY`

---

### Function: `checkDuplicate(data)`

```typescript
async function checkDuplicate(data: ExtractedData): Promise<boolean>
```

Queries Firestore: `where vendor == AND amount == AND date ==`.
Returns `false` on any error (offline tolerance — better to allow a duplicate than block upload).

---

### Function: `processLocalFile(file, onProgress)`

```typescript
async function processLocalFile(file, onProgress): Promise<ProcessResult>
```

Local-only pipeline (no Drive):
1. `extractDataWithGemini(file)`
2. `checkDuplicate(data)` → if duplicate: `{ success: false, duplicate: true, data }`
3. `addDoc(db, 'transactions', { ...data, driveFileId: null, driveSynced: false, created_at: serverTimestamp() })`
4. Return `{ success: true, data }`

Catches errors → `classifyError()` → returns typed `ProcessResult`.

---

### Function: `processAndUploadFile(file, token, onProgress)`

```typescript
async function processAndUploadFile(file, token, onProgress): Promise<ProcessResult>
```

Full pipeline with Drive upload (used when user has Google OAuth token):
1. Extract with Gemini
2. Check duplicate
3. `ensureFolderPath(token, category)` — builds Drive folder tree for current month
4. Upload file to Drive (multipart)
5. Save to Firestore with `driveFileId`

---

### Error Classification: `classifyError(error)`

```typescript
function classifyError(error: unknown): {
  errorType: ProcessErrorType,
  errorMessage: string,
  retryable: boolean,
  retryAfterMs?: number
}
```

| Condition | errorType | retryable |
|-----------|-----------|-----------|
| TypeError + "fetch" | `network` | Yes |
| SyntaxError | `extraction_failed` | No |
| HTTP 429 + "PerDay" | `rate_limit` (daily) | No |
| HTTP 429 (other) | `rate_limit` (minute) | Yes |
| "Upload" in message | `upload_failed` | Yes |
| Anything else | `unknown` | Yes |

Retry delay parsed from Gemini error body: `/"retryDelay"\s*:\s*"(\d+)s"/`. Default: 30,000ms.

---

## Utility: `src/utils/validation.ts`

### Function: `validateIsraeliID(id)`

```typescript
function validateIsraeliID(id: string): boolean
```

Validates an Israeli identity card number (תעודת זהות):
1. Strip non-digits
2. Pad to 9 characters with leading zeros
3. Apply checksum (Luhn-like modulo 10 algorithm)
4. Return true if sum % 10 === 0

Used by `FamilyManagerModal.tsx` when adding family members.

---

## Utility: `src/lib/utils.ts`

```typescript
export function cn(...inputs: ClassValue[]): string
```

Merges Tailwind CSS classes intelligently using `clsx` + `tailwind-merge`. Prevents class conflicts (e.g. `p-2 p-4` → `p-4`). Used throughout components.

---

## Data Dependencies Map

```
App.tsx
  └── auth (firebase.ts)

Dashboard.tsx
  ├── db (firebase.ts) — incomes, settings/budgetConfig, settings/ecosystem, transactions
  ├── generateFinancialInsights (ai.ts)
  └── getFinancialChatSession (ai.ts)

SyncButton.tsx
  ├── GoogleDriveService.ts — fetchFolderContents, fetchFolderById, fetchDriveFolders
  └── SyncService.ts — syncFilesFromDrive, getLastSyncTime

FolderLogic.tsx
  └── FileProcessor.ts — processLocalFile

AssetCard.tsx
  └── FileProcessor.ts — extractDataWithGemini

ExpensesBreakdown.tsx
  └── db (firebase.ts) — transactions

InvestmentsPortfolio.tsx
  └── db (firebase.ts) — investments

FuturePlanning.tsx
  └── db (firebase.ts) — goals

CentralExpenseReport.tsx
  └── db (firebase.ts) — settings/expenseClusters, transactions

FamilyManagerModal.tsx
  └── validation.ts — validateIsraeliID
```
