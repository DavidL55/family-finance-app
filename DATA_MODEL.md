# Family Finance App — Data Model

This document describes every Firestore collection, document shape, and field type used in the app. It also covers the lifecycle of a transaction, query patterns, security rules, and the Drive folder structure.

---

## Firestore Project

**Project ID:** `family-finance-app-c9aa4`
**Region:** Default (Google-managed)
**Persistence:** `persistentLocalCache()` — offline reads and writes are cached locally and synced when reconnected.

---

## Collection: `transactions`

The central collection. Every expense or income document extracted from a file lands here.

### Document Shape

```typescript
{
  // Core extracted fields (from Gemini AI)
  date: string;              // "YYYY-MM-DD" — transaction date
  vendor: string;            // Business/provider name (e.g. "שופרסל", "YES")
  amount: number;            // Total amount paid (ILS)
  vat?: number;              // VAT/tax amount if detected
  category: string;          // Category key (see Category Mapping below)
  isQuarterlyReport?: boolean; // true for pension/investment quarterly reports
  quarterlyData?: {          // Only present if isQuarterlyReport is true
    balance: number;
    contribution: number;
    yield: number;
  };

  // Metadata — local upload path
  fileName?: string;         // Original filename (local upload only)
  fileSize?: number;         // File size in bytes (local upload only)
  driveFileId?: string;      // null until Drive-synced; string after Drive upload
  driveSynced?: boolean;     // false for local-only, true after Drive sync

  // Metadata — Drive sync path
  syncFolderId?: string;     // Source Drive folder ID (Drive sync only)

  // Timestamp
  created_at: Timestamp;     // serverTimestamp() — always present
}
```

### Key Query Patterns

**Filter by month/year:**
```typescript
query(
  collection(db, 'transactions'),
  where('date', '>=', '2026-03-01'),
  where('date', '<=', '2026-03-31')
)
```

**Duplicate detection:**
```typescript
query(
  collection(db, 'transactions'),
  where('vendor', '==', vendor),
  where('amount', '==', amount),
  where('date', '==', date)
)
```

**Last sync time for a folder:**
```typescript
query(
  collection(db, 'transactions'),
  where('syncFolderId', '==', folderId)
)
// Then scan results for max(doc.data().timestamp)
```

### Category Keys (Stored Values)

| Stored Key | Display Label (Hebrew) |
|-----------|----------------------|
| `Housing_Utilities` | מגורים ובית |
| `Insurance_Pension` | ביטוח ופנסיה |
| `Transportation` | תחבורה ורכב |
| `Groceries_Dining` | מזון וצריכה |
| `Health` | בריאות |
| `Education` | חינוך וחוגים |
| `Leisure_Travel` | פנאי ובילוי |
| `Income_Investments` | הכנסות והשקעות |
| `General_Misc` | שונות |

Category mapping lives in `src/utils/FileProcessor.ts → CATEGORY_MAP`.

---

## Collection: `incomes`

Monthly income entries. Managed from the Dashboard income panel.

### Document Shape

```typescript
{
  name: string;     // Income description, e.g. "משכורת", "שכר דירה"
  amount: number;   // Amount in ILS
  month: string;    // "01" through "12" (zero-padded)
  year: string;     // "2026"
  date: string;     // Date string (may be YYYY-MM-DD or free-form)
}
```

### Query Pattern

**Load incomes for selected month/year:**
```typescript
query(
  collection(db, 'incomes'),
  where('month', '==', selectedMonth),
  where('year', '==', selectedYear)
)
```

Dashboard uses `onSnapshot()` for real-time updates.

---

## Collection: `investments`

Asset portfolio entries: investment accounts, pension funds, insurance policies, crypto holdings.

### Document Shape

```typescript
{
  name: string;              // Asset name, e.g. "קרן פנסיה מנורה"
  type: string;              // "investment" | "pension" | "insurance" | "crypto"
  value: number;             // Current total value in ILS
  monthlyDeposit?: number;   // Monthly contribution
  returnPct?: number;        // Annual return percentage
  returnVal?: number;        // Return value in ILS
}
```

### Notes
- `returnVal` is typically derived from quarterly reports (uploaded via AssetCard)
- `type` controls which section of InvestmentsPortfolio the asset appears in
- Updated when user uploads a quarterly report (Gemini extracts new balance/contribution/yield)

---

## Collection: `goals`

Savings goals with progress tracking.

### Document Shape

```typescript
{
  name: string;         // Goal name, e.g. "חופשה באירופה"
  target: number;       // Target amount in ILS
  current: number;      // Amount saved so far
  date: string;         // Target completion date
  categoryId: string;   // "vacation" | "home" | "event" | "car" | "education" | "other"
}
```

### Derived Values (computed in UI, not stored)
- Progress percentage: `(current / target) * 100`
- Monthly required savings: `(target - current) / monthsRemaining`
- Countdown: days until `date`

---

## Collection: `settings` (document-per-config pattern)

Three fixed documents under the `settings` collection.

### Document: `settings/ecosystem`

Net worth breakdown. Edited directly in the Dashboard ecosystem panel.

```typescript
{
  liquid: number;        // Cash, bank accounts
  investments: number;   // Investment portfolio value
  pensions: number;      // Pension fund total
  crypto: number;        // Cryptocurrency holdings
  realEstate: number;    // Real estate value
  mortgage: number;      // Outstanding mortgage (negative net worth component)
}
```

Net worth formula: `liquid + investments + pensions + crypto + realEstate - mortgage`

### Document: `settings/budgetConfig`

Budget limits per expense category, optionally split by family member.

```typescript
{
  categories: Array<{
    id: string;          // Category key (matches CATEGORY_MAP)
    name: string;        // Display label (Hebrew)
    budget: number;      // Total monthly budget in ILS
    memberBudgets?: Record<string, number>;  // Per-member overrides
  }>
}
```

Dashboard reads this and compares against actual `transactions` spending for the month to produce the budget vs actual bar chart.

### Document: `settings/expenseClusters`

User-defined clusters for grouping similar expenses in the Central Expense Report.

```typescript
{
  clusters: Array<{
    id: string;          // UUID or auto-generated ID
    name: string;        // Cluster name, e.g. "חשמל ומים"
    type: 'fixed' | 'variable';  // Fixed or variable expense
    icon: string;        // Lucide icon name, e.g. "Home", "Zap"
    keywords: string[];  // Keywords to match against vendor names
  }>
}
```

Default clusters are seeded by `CentralExpenseReport.tsx` on first load if the document doesn't exist.

---

## Transaction Lifecycle

```
1. FILE_RECEIVED
   └── User uploads PDF/image (FolderLogic) or Drive sync runs (SyncButton)

2. EXTRACTING
   └── Gemini 2.0 Flash reads file, returns ExtractedData JSON

3. DUPLICATE_CHECK
   └── Query Firestore: vendor + amount + date
       ├── Match found → DUPLICATE (user chooses skip/overwrite)
       └── No match → continue

4. SAVING
   └── addDoc(db, 'transactions', { ...data, created_at: serverTimestamp() })
       ├── Local upload: driveFileId = null, driveSynced = false
       └── Drive sync: driveFileId = uploadedFile.id, syncFolderId = folderId

5. VISIBLE
   └── Appears in ExpensesBreakdown and Dashboard aggregations
       └── Real-time via Firestore listeners (onSnapshot)
```

---

## Indexes Required

Compound indexes needed for multi-field queries:

| Collection | Fields | Direction |
|-----------|--------|-----------|
| `transactions` | `vendor` ASC, `amount` ASC, `date` ASC | For duplicate check |
| `transactions` | `date` ASC | For date range filter |
| `transactions` | `syncFolderId` ASC, `created_at` DESC | For last sync time |
| `incomes` | `month` ASC, `year` ASC | For monthly income load |

Firestore will prompt to create these indexes when queries fail in development.

---

## Security Rules

### Current (Development)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

**This is wide open. Never ship to production with this rule.**

### Production Target
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Since the app uses anonymous Firebase Auth (no email/password), `request.auth != null` is satisfied after `signInAnonymously()`. Every user session has a unique `uid` from Firebase.

---

## Google Drive Data Model

The app creates and manages its own folder hierarchy in the user's Google Drive.

### Folder Tree
```
My Drive/
└── Family_Finance/                     (root folder, created once)
    └── 2026/                           (year folder)
        └── 03/                         (month folder, zero-padded)
            ├── מגורים ובית/
            ├── ביטוח ופנסיה/
            ├── תחבורה ורכב/
            ├── מזון וצריכה/
            ├── בריאות/
            ├── חינוך וחוגים/
            ├── פנאי ובילוי/
            ├── הכנסות והשקעות/
            └── שונות/
```

### File Naming Convention
Uploaded files are renamed to: `{YYYY-MM-DD}_{vendor}_{amount}.{ext}`

Example: `2026-03-15_שופרסל_350.pdf`

### Folder ID Storage
- Each folder ID is fetched or created via `getOrCreateFolder()` on every sync
- Firestore stores `driveFileId` (the uploaded file's Drive ID) in each transaction
- Firestore stores `syncFolderId` (the user's source folder) for sync history

### Drive Metadata per File
```typescript
{
  id: string;           // Drive file ID
  name: string;         // Original filename
  mimeType: string;     // "application/pdf" | "image/jpeg" | ...
  createdTime: string;  // ISO timestamp
  modifiedTime: string; // ISO timestamp
}
```
