# Family Finance App — Architecture Document

## Overview

Family Finance App (מערכת חכמה לניהול תקציב משפחתי) is a Progressive Web App (PWA) for a Hebrew-speaking family to manage household finances. It tracks monthly expenses, monitors investments, plans savings goals, and provides AI-powered insights — all backed by Google Drive for file storage and Firestore as the cloud database.

**Language:** Hebrew (RTL, `dir="rtl"`)
**Platform:** Web browser + installable PWA (iOS, Android, desktop)
**User:** A single family unit — not a multi-tenant SaaS product.

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| UI Framework | React | 19.0.0 |
| Build Tool | Vite | 6.2.0 |
| Language | TypeScript | 5.8.2 (strict) |
| Styling | Tailwind CSS | 4.1.14 |
| PWA | vite-plugin-pwa | 1.2.0 |
| Database | Firebase Firestore | 12.10.0 |
| Auth | Firebase Authentication | 12.10.0 |
| AI | Google GenAI (Gemini) | 1.29.0 |
| File Storage | Google Drive API v3 | — |
| OAuth | @react-oauth/google | 0.13.4 |
| Charts | Recharts | 3.7.0 |
| Animations | Framer Motion | 12.34.3 |
| Icons | Lucide React | 0.546.0 |
| Date Utilities | date-fns | 4.1.0 |

---

## Directory Structure

```
Family-Finance-App/
├── index.html                      # HTML entry point, lang="he", dir="rtl"
├── package.json                    # Dependencies and npm scripts
├── tsconfig.json                   # TypeScript strict config, ESNext, JSX React
├── vite.config.ts                  # Vite config: Tailwind, PWA, GEMINI_API_KEY define
├── firebase.json                   # Firebase hosting config (public: dist/, SPA rewrite)
├── firestore.rules                 # Firestore security rules (currently open for dev)
├── .firebaserc                     # Firebase project: family-finance-app-c9aa4
├── .env.example                    # Environment variable template
│
├── public/
│   ├── manifest.json               # PWA manifest: name, icons, theme_color, display
│   └── icons/                      # PWA icons: 192x192, 512x512, Apple splash screens
│
└── src/
    ├── main.tsx                    # React entry: ErrorBoundary + GoogleOAuthProvider + App
    ├── App.tsx                     # App shell: tab router, Firebase anonymous auth, layout
    ├── index.css                   # Global styles: Assistant + JetBrains Mono fonts, Tailwind
    ├── vite-env.d.ts               # Vite environment type declarations
    │
    ├── components/
    │   ├── Dashboard.tsx           # Main dashboard: budget, income, ecosystem, AI insights, chat
    │   ├── SyncButton.tsx          # Google Drive sync orchestrator UI
    │   ├── ExpensesBreakdown.tsx   # Monthly expense ledger (filtered, paginated)
    │   ├── CentralExpenseReport.tsx# Expense clustering and categorization management
    │   ├── FuturePlanning.tsx      # Savings goals with progress and projections
    │   ├── InvestmentsPortfolio.tsx# Asset portfolio: investments, pensions, crypto
    │   ├── FolderLogic.tsx         # Local file drag-and-drop upload queue
    │   ├── AssetCard.tsx           # Investment asset card with quarterly report upload
    │   ├── EditClusterModal.tsx    # Modal for creating/editing expense clusters
    │   └── FamilyManagerModal.tsx  # Modal for managing family members
    │
    ├── contexts/
    │   └── NotificationContext.tsx # Global toast notification system (success/error)
    │
    ├── services/
    │   ├── firebase.ts             # Firebase app init: Firestore (offline persist) + Auth
    │   ├── ai.ts                   # Gemini: financial insights generation + chat session
    │   ├── SyncService.ts          # Drive sync pipeline: fetch → extract → organize → save
    │   └── GoogleDriveService.ts   # Drive API: folders, files, upload, download, inference
    │
    ├── utils/
    │   ├── FileProcessor.ts        # Gemini extraction + duplicate check + Firestore save
    │   └── validation.ts           # Israeli ID (תעודת זהות) checksum validation
    │
    ├── data/
    │   └── expenses.ts             # Demo expense data generator (mock data for development)
    │
    └── lib/
        └── utils.ts                # cn() — Tailwind class merge utility (clsx + tailwind-merge)
```

---

## Application Entry Points

### index.html
- Language: `he`, Direction: `rtl`
- Title: `מערכת חכמה לניהול תקציב משפחתי`
- Links to `/manifest.json` for PWA
- Mounts React at `<div id="root">`

### src/main.tsx
Bootstrap hierarchy:
```
React.StrictMode
  └── ErrorBoundary (Hebrew crash page + reload button)
        └── GoogleOAuthProvider (clientId from VITE_GOOGLE_CLIENT_ID)
              └── NotificationProvider (global toast context)
                    └── App
```

### src/App.tsx
**State:**
- `activeTab` — which screen is rendered (`dashboard` | `expenses` | `central-expenses` | `investments` | `future` | `folder`)
- `isMobileMenuOpen` — mobile "more" drawer
- `authReady` — blocks render until Firebase auth resolves

**Auth flow:**
1. `onAuthStateChanged` fires on mount
2. If no user → `signInAnonymously()` (anonymous Firebase auth)
3. Once resolved → `authReady = true` → app renders

**Layout:**
- Sticky top header: logo, family badge ("משפחת כהן"), SyncButton, LogOut
- Desktop sidebar (md+): full tab list, 64px wide
- Mobile: bottom navigation bar (first 5 tabs) + "More" slide-up drawer for tab 6+
- Main content area: `max-w-5xl mx-auto` with dynamic component based on `activeTab`

**Tabs:**
| ID | Label | Component |
|----|-------|-----------|
| `dashboard` | לוח תצוגה ראשי | Dashboard |
| `expenses` | פירוט הוצאות | ExpensesBreakdown |
| `central-expenses` | דוח הוצאות מרכז | CentralExpenseReport |
| `investments` | תיק השקעות ופנסיה | InvestmentsPortfolio |
| `future` | תכנון עתידי | FuturePlanning |
| `folder` | תיקייה חודשית | FolderLogic |

---

## Firestore Collections

```
Firestore (family-finance-app-c9aa4)
│
├── transactions/            # Extracted expense/income documents
│   └── {docId}
│       ├── date             string    "YYYY-MM-DD"
│       ├── vendor           string    "שופרסל"
│       ├── amount           number    350
│       ├── vat?             number
│       ├── category         string    "Groceries_Dining"
│       ├── isQuarterlyReport? boolean
│       ├── quarterlyData?   object    { balance, contribution, yield }
│       ├── fileName?        string    (local upload only)
│       ├── fileSize?        number    (local upload only)
│       ├── driveFileId?     string    (null until Drive synced)
│       ├── driveSynced?     boolean
│       ├── syncFolderId?    string    (Drive sync source folder ID)
│       └── created_at       Timestamp (serverTimestamp)
│
├── incomes/                 # Monthly income entries
│   └── {docId}
│       ├── name             string    "משכורת"
│       ├── amount           number
│       ├── month            string    "03"
│       ├── year             string    "2026"
│       └── date             string
│
├── investments/             # Asset portfolio entries
│   └── {docId}
│       ├── name             string
│       ├── type             string    "investment" | "pension" | "insurance" | "crypto"
│       ├── value            number
│       ├── monthlyDeposit?  number
│       ├── returnPct?       number
│       └── returnVal?       number
│
├── goals/                   # Savings goals
│   └── {docId}
│       ├── name             string
│       ├── target           number
│       ├── current          number
│       ├── date             string    target date
│       └── categoryId       string    "vacation" | "home" | "event" | "car" | "education" | "other"
│
└── settings/                # App-level configuration
    ├── ecosystem            # Net worth breakdown
    │   ├── liquid           number
    │   ├── investments      number
    │   ├── pensions         number
    │   ├── crypto           number
    │   ├── realEstate       number
    │   └── mortgage         number
    │
    ├── budgetConfig         # Budget limits per category per family member
    │   └── categories: Array<{ id, name, budget, memberBudgets }>
    │
    └── expenseClusters      # User-defined expense grouping clusters
        └── clusters: Array<{ id, name, type, icon, keywords }>
```

---

## Environment Variables

```env
# Server-side (Vite define — accessible as process.env.GEMINI_API_KEY)
GEMINI_API_KEY="..."

# Client-side (VITE_ prefix — bundled into JS)
VITE_GOOGLE_CLIENT_ID="..."          # Google OAuth client (Drive access)
VITE_FIREBASE_API_KEY="..."
VITE_FIREBASE_AUTH_DOMAIN="family-finance-app-c9aa4.firebaseapp.com"
VITE_FIREBASE_PROJECT_ID="family-finance-app-c9aa4"
VITE_FIREBASE_STORAGE_BUCKET="family-finance-app-c9aa4.appspot.com"
VITE_FIREBASE_MESSAGING_SENDER_ID="..."
VITE_FIREBASE_APP_ID="..."
```

`GEMINI_API_KEY` is exposed to the client via Vite's `define` (in `vite.config.ts`), mapped to `process.env.GEMINI_API_KEY`.

---

## Build & Deployment

### Development
```bash
npm run dev       # Vite dev server on port 3000 (all interfaces)
npm run lint      # TypeScript type check (tsc --noEmit)
```

### Production
```bash
npm run build     # Output to dist/
firebase deploy --only hosting   # Deploy to Firebase Hosting
```

Firebase Hosting serves `dist/` and rewrites all routes to `index.html` (SPA mode). HTTPS is automatic. CDN-distributed globally.

### PWA
- Service workers generated by `vite-plugin-pwa`
- Installable on home screen (iOS, Android, desktop)
- Offline asset caching
- Manifest: theme_color `#3b82f6` (blue-500)

---

## Data Flow: File Upload Pipeline

```
User drops file (PDF/image)
        │
        ▼
FolderLogic.tsx or AssetCard.tsx
        │
        ▼
FileProcessor.ts → extractDataWithGemini(file)
        │  - Base64 encode file
        │  - Call Gemini 2.0 Flash with inline image + prompt
        │  - Returns ExtractedData JSON
        ▼
checkDuplicate(data)
        │  - Query Firestore: vendor + amount + date
        │  - Returns true if already exists
        ▼
  Duplicate? ──yes──→ Return { success: false, duplicate: true }
        │                      (UI shows skip/overwrite choice)
        │ no
        ▼
addDoc(collection(db, 'transactions'), { ...data, created_at, driveFileId, ... })
        │
        ▼
  Success: { success: true, data }
  Error:   classifyError() → { errorType, errorMessage, retryable, retryAfterMs }
```

---

## Data Flow: Google Drive Sync Pipeline

```
User selects Drive folder + sync mode
        │
        ▼
SyncService.syncFilesFromDrive(token, folderId, dateRange, onProgress, onDuplicate)
        │
        ├── fetchFilesFromFolder()  (PDF + images, max 100)
        │
        └── For each file (rate-limited: 4.5s between Gemini calls):
              │
              ├── downloadFileBuffer(token, fileId)
              │
              ├── extractDataWithGemini(fileObj)   ← Gemini 2.0 Flash
              │
              ├── checkDuplicate(extractedData)
              │     └── Duplicate → onDuplicate() modal → skip/overwrite/cancel
              │
              ├── inferMonthFromFileName(fileName)
              │     └── Fallback: use file.createdTime
              │
              ├── ensureFolderPathForMonth()
              │     └── getOrCreateFolder() × 4 levels:
              │         Family_Finance / YYYY / MM / Hebrew_Category
              │
              ├── Upload to Drive (multipart)
              │     └── Filename: {date}_{vendor}_{amount}.{ext}
              │
              └── addDoc(db, 'transactions', { ...data, driveFileId, syncFolderId })

Returns SyncSummary: { processed, duplicates, errors, skipped, failed[] }
```

---

## Google Drive Folder Structure (Created by App)

```
My Drive/
└── Family_Finance/
    └── 2026/
        └── 03/           (month as 2-digit string)
            ├── מגורים ובית/        (Housing_Utilities)
            ├── ביטוח ופנסיה/       (Insurance_Pension)
            ├── תחבורה ורכב/        (Transportation)
            ├── מזון וצריכה/        (Groceries_Dining)
            ├── בריאות/             (Health)
            ├── חינוך וחוגים/       (Education)
            ├── פנאי ובילוי/        (Leisure_Travel)
            ├── הכנסות והשקעות/     (Income_Investments)
            └── שונות/              (General_Misc)
```

Files are renamed on upload: `{YYYY-MM-DD}_{vendor}_{amount}.{ext}`

---

## Category Mapping

| English Key | Hebrew Label |
|-------------|-------------|
| Housing_Utilities | מגורים ובית |
| Insurance_Pension | ביטוח ופנסיה |
| Transportation | תחבורה ורכב |
| Groceries_Dining | מזון וצריכה |
| Health | בריאות |
| Education | חינוך וחוגים |
| Leisure_Travel | פנאי ובילוי |
| Income_Investments | הכנסות והשקעות |
| General_Misc | שונות |

---

## Security

### Current (Development)
```
// firestore.rules
allow read, write: if true;  // WIDE OPEN — temporary
```

### Production Target
```
allow read, write: if request.auth != null;
```

### API Keys
- `GEMINI_API_KEY` — in environment, injected via Vite define (not hardcoded)
- Firebase config — standard public keys (safe to bundle)
- Google OAuth client ID — public (standard OAuth practice)

### Data Privacy
- All files stored in the **user's own** Google Drive (user-owned)
- Firestore data tied to the Firebase project (family-controlled)
- No third-party data sharing beyond Google services

---

## Performance Considerations

- **Gemini rate limiting:** 4.5s delay between calls (15 req/min free tier cap)
- **Firestore offline persistence:** `persistentLocalCache()` — reads work offline
- **Vite code splitting:** Each route/component is a separate chunk (lazy by tab switch)
- **Tailwind CSS:** Only used classes are bundled (PurgeCSS via Vite plugin)
- **PWA service worker:** Assets cached after first load
- **Recharts:** Loaded only on Dashboard tab
