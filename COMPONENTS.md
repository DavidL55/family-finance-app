# Family Finance App — Frontend Components

All components are in `src/components/`. They are pure UI — no business logic, no direct API calls. External data comes via service imports. All text is Hebrew (RTL).

---

## Component Tree

```
App (src/App.tsx)
├── SyncButton
└── [activeTab switch]
    ├── Dashboard
    │   ├── FamilyManagerModal
    │   └── (inline income editor, chat panel)
    ├── ExpensesBreakdown
    ├── CentralExpenseReport
    │   └── EditClusterModal
    ├── InvestmentsPortfolio
    │   └── AssetCard (one per asset)
    ├── FuturePlanning
    └── FolderLogic
```

---

## App Shell (`src/App.tsx`)

**Purpose:** Top-level shell. Handles Firebase anonymous auth, tab routing, and responsive layout.

**State:**
```typescript
activeTab: string               // Current tab ID
isMobileMenuOpen: boolean       // Mobile "more" drawer open
authReady: boolean              // False until Firebase auth resolves
```

**Auth:** On mount, `onAuthStateChanged` listens for a Firebase user. If none, `signInAnonymously()` is called. Until `authReady = true`, a full-screen loading spinner is shown.

**Layout:**
- **Sticky top header:** Logo (`₪`), family name badge, SyncButton, LogOut button
- **Desktop sidebar (md+):** Vertical nav with all 6 tabs
- **Mobile bottom nav:** First 5 tabs as icon+label buttons
- **Mobile "More" drawer:** Slide-up panel for tab 6+ (currently FolderLogic only)
- **Main content:** `max-w-5xl mx-auto`, `pb-20 md:pb-0` (space for mobile nav bar)

---

## Dashboard (`src/components/Dashboard.tsx`)

**Purpose:** The primary financial overview. Shows budget vs actual, income tracking, net worth ecosystem, AI insights, and financial chat.

**State:**
```typescript
selectedMonth: string           // "01"–"12"
selectedYear: string            // "2024"–"2027"
selectedMember: string          // "all" or family member ID
familyMembers: FamilyMember[]   // Stored in component state (not Firestore)
incomes: IncomeEntry[]          // Real-time from Firestore (onSnapshot)
budgetVsActual: BudgetCategory[] // Computed from budgetConfig + transactions
ecosystem: EcosystemData        // From Firestore settings/ecosystem
insights: string[]              // From generateFinancialInsights()
chatSession: ChatSession | null // From getFinancialChatSession()
messages: Array<{role, text}>   // Chat history
inputMessage: string            // Current chat input
isLoadingInsights: boolean
isChatLoading: boolean
showFamilyManager: boolean      // FamilyManagerModal open
```

**Sections:**

### Month/Year/Member Selector
- Prev/next month buttons (arrow navigation)
- Year dropdown (2024–2027)
- Family member filter pills (all + each member)

### Income Panel
- Real-time list of `incomes` for selected month/year
- Inline add: name + amount
- Delete per entry (with trash icon)
- Total income sum displayed

### Budget vs Actual (Recharts Bar Chart)
- Loads `settings/budgetConfig` on mount
- Queries `transactions` for selected month/year (and member if filtered)
- Compares `budget` vs `actual` per category
- Horizontal bar chart via Recharts `BarChart`

### Ecosystem Panel
- Loads `settings/ecosystem`
- Shows 6 categories with color-coded cards
- Computed net worth: `liquid + investments + pensions + crypto + realEstate - mortgage`
- Inline edit (each field)

### AI Insights
- Calls `generateFinancialInsights(financialData)` on mount and on month change
- Shows 3 Hebrew insight cards with yellow/amber styling
- Falls back to hardcoded strings if no API key

### Financial Chat
- Gemini chat session initialized with `getFinancialChatSession(financialData)`
- Messages rendered with role-based alignment (user = right, model = left)
- Input field + send button
- Auto-scroll to latest message
- Disabled while Gemini is responding

### Family Manager
- Button opens `FamilyManagerModal`
- State passed down and updated via callback

---

## SyncButton (`src/components/SyncButton.tsx`)

**Purpose:** Full Google Drive sync UI — OAuth login, folder browser, sync mode selection, progress tracking, duplicate handling.

**State (simplified):**
```typescript
isSyncing: boolean
selectedFolder: string | null        // Drive folder ID
selectedFolderName: string | null
token: string | null                 // OAuth access token
showFolderSelect: boolean            // Folder browser modal
browserPath: Array<{id, name}>       // Breadcrumb path in browser
syncMode: 'all' | 'incremental' | 'custom'
dateRange: { startDate, endDate }    // For 'custom' mode
syncProgress: SyncProgressStatus
showSyncProgress: boolean
currentDuplicate: DuplicateFile | null
duplicateResolvers: ref to pending promise resolve
monthStructure: Array<{ year, months[] }>   // Drive year/month folders
showMonthBoard: boolean
```

**Key Behaviors:**

**Google OAuth:** Handled by `useGoogleLogin()` from `@react-oauth/google`. Scopes:
- `https://www.googleapis.com/auth/drive.readonly`
- `https://www.googleapis.com/auth/drive.file`
- `https://www.googleapis.com/auth/drive.metadata.readonly`

Token stored in `localStorage` under key `google_access_token`. On mount, previously saved token is loaded.

**Folder Browser:**
- Opens modal showing Drive contents (folders + files)
- Breadcrumb navigation: `My Drive > FolderA > FolderB`
- Text search to filter folder names
- Paste a Google Drive link → `fetchFolderById()` validates it and extracts folder ID
- Select a folder → `selectedFolder` and `selectedFolderName` are set

**Sync Modes:**
- `all` — sync all files in folder
- `incremental` — sync files modified after last sync time (from `getLastSyncTime()`)
- `custom` — date range picker (start/end date)

**Month Structure Board:**
- Scans Drive folder for year/month subfolders (matching `YYYY` and `MM` patterns)
- Shows interactive grid: year sections with month checkboxes
- Multi-select months for targeted re-sync

**Sync Progress Modal:**
- Shows real-time `SyncProgressStatus` updates from `SyncService`
- Format: message + `processed/total` counter

**Duplicate Handler:**
- When `onDuplicate` is triggered during sync, a modal appears
- Pauses sync via Promise (the modal's buttons resolve/reject it)
- Three choices: skip this file, overwrite, or cancel entire sync
- Uses a ref (`duplicateResolvers`) to hold the pending resolve/reject functions

---

## ExpensesBreakdown (`src/components/ExpensesBreakdown.tsx`)

**Purpose:** Monthly expense ledger — full list of transactions for the selected month.

**State:**
```typescript
selectedMonth: string
selectedYear: string
filterOwner: string        // "" = all
filterPayment: string      // "" = all
transactions: any[]        // From Firestore
loading: boolean
showPreview: string | null // File preview modal (drive file ID)
```

**Features:**
- Month navigation (prev/next arrows)
- Filter by owner (family member) and payment method
- Table: date, vendor, amount, category, file icon
- Transaction count and total sum in header
- File preview: clicking file icon shows PDF/image preview from Drive
- Date parsing: handles both `YYYY-MM-DD` and `DD/MM/YYYY` formats

**Firestore Query:**
Loads transactions where `date` starts with `{year}-{month}` (string prefix match).

---

## CentralExpenseReport (`src/components/CentralExpenseReport.tsx`)

**Purpose:** Expense clustering — group and categorize expenses by user-defined clusters.

**State:**
```typescript
clusters: ExpenseCluster[]    // From Firestore settings/expenseClusters
transactions: any[]           // From Firestore (current month)
selectedMonth, selectedYear
showEditModal: boolean
editingCluster: ExpenseCluster | null
loading: boolean
```

**Cluster Structure:**
```typescript
interface ExpenseCluster {
  id: string;
  name: string;
  type: 'fixed' | 'variable';
  icon: string;             // Lucide icon name
  keywords: string[];       // Matched against vendor names
}
```

**Matching Logic:**
For each transaction, check if `vendor.toLowerCase()` contains any keyword from any cluster. Transactions matched to their cluster; unmatched go to a "שונות" bucket.

**Features:**
- Expandable sections: fixed expenses vs variable expenses
- Each cluster shows matched transactions and total
- Add/edit/delete clusters
- Opens `EditClusterModal` for create/edit
- Seeds default clusters from `DEFAULT_CLUSTERS` constant if Firestore is empty

---

## FuturePlanning (`src/components/FuturePlanning.tsx`)

**Purpose:** Savings goals with progress tracking and monthly projection.

**State:**
```typescript
goals: SavingsGoal[]
showAddGoal: boolean
newGoal: Partial<SavingsGoal>
loading: boolean
```

**SavingsGoal Structure:**
```typescript
interface SavingsGoal {
  id: string;
  name: string;
  target: number;
  current: number;
  date: string;         // Target date
  categoryId: string;   // vacation | home | event | car | education | other
}
```

**Features:**
- Goal cards with progress bar (`current / target * 100%`)
- Required monthly savings: `(target - current) / monthsRemaining`
- Countdown timer: days until target date
- Category icon mapping (Plane, Home, Star, Car, Book, Tag)
- Add goal form: name, target amount, current savings, target date, category
- Delete goal (trash button)
- Real-time Firestore sync (`onSnapshot` on `goals` collection)

---

## InvestmentsPortfolio (`src/components/InvestmentsPortfolio.tsx`)

**Purpose:** Asset portfolio — investments, pension funds, insurance, crypto.

**State:**
```typescript
assets: Asset[]
showAddAsset: boolean
newAsset: Partial<Asset>
loading: boolean
```

**Asset Structure:**
```typescript
interface Asset {
  id: string;
  name: string;
  type: 'investment' | 'pension' | 'insurance' | 'crypto';
  value: number;
  monthlyDeposit?: number;
  returnPct?: number;
  returnVal?: number;
}
```

**Features:**
- Tab sections by asset type
- Summary cards: total value, total monthly deposits, total returns
- Pie chart (Recharts) breakdown by asset type
- Add asset form: name, type, value, monthly deposit, return %
- Each asset renders as an `AssetCard` component
- `AssetCard` can upload a quarterly report → Gemini extracts balance/contribution/yield → updates asset in Firestore

---

## FolderLogic (`src/components/FolderLogic.tsx`)

**Purpose:** Local file upload and processing queue.

**State:**
```typescript
files: FileQueueItem[]    // Queue of files with status
isDragging: boolean       // Drag-over state
```

**FileQueueItem:**
```typescript
{
  file: File;
  status: 'pending' | 'processing' | 'success' | 'duplicate' | 'error' | 'retrying';
  progress: string;       // Status message
  errorType?: ProcessErrorType;
  retryable?: boolean;
  retryAfterMs?: number;
  data?: ExtractedData;   // On success
}
```

**Features:**
- Drag-and-drop zone with visual drag state
- File input with `multiple` select
- Queue list with per-file status badges (color-coded)
- Auto-processes files sequentially on drop/select
- Calls `processLocalFile(file, onProgress)` for each file
- Rate-limit retry: waits `retryAfterMs` then auto-retries
- Manual retry button for retryable errors
- Duplicate detection: shows "כפול — דילוג" badge
- Infers month from filename via `inferMonthFromFileName()` for Firestore organization

---

## AssetCard (`src/components/AssetCard.tsx`)

**Purpose:** Individual investment/pension asset card with quarterly report upload.

**Props:**
```typescript
{
  asset: Asset;
  onUpdate: (id: string, data: Partial<Asset>) => void;
}
```

**State:**
```typescript
isUploading: boolean
progress: string
```

**Features:**
- Displays asset name, type, value, monthly deposit, return
- File upload button (PDF/image)
- On upload: calls `extractDataWithGemini(file)`
- If `isQuarterlyReport: true` → calls `onUpdate` with new `{ value: balance, returnVal: yield }`
- Progress messages shown during extraction
- Error handling with notification toast

---

## EditClusterModal (`src/components/EditClusterModal.tsx`)

**Purpose:** Create or edit an expense cluster.

**Props:**
```typescript
{
  cluster?: ExpenseCluster;    // null = create new
  onSave: (cluster: ExpenseCluster) => void;
  onClose: () => void;
}
```

**Features:**
- Fields: name (text), type (fixed/variable toggle), icon picker, keywords list
- 10 available icons (Home, Zap, Phone, Shield, ShoppingCart, Coffee, Car, Heart, Tag, Settings)
- Add keyword: Enter key or "+" button
- Remove keyword: "×" badge button
- Save disabled if name is empty
- RTL-aware layout

---

## FamilyManagerModal (`src/components/FamilyManagerModal.tsx`)

**Purpose:** Add, edit, or delete family members.

**Props:**
```typescript
{
  members: FamilyMember[];
  onUpdate: (members: FamilyMember[]) => void;
  onClose: () => void;
}
```

**FamilyMember:**
```typescript
{
  id: string;
  name: string;
  role: 'הורה' | 'ילד';
  idNumber?: string;    // Israeli ID (optional)
}
```

**Features:**
- List of existing members with edit/delete buttons
- Add/edit form: name, role dropdown, Israeli ID field
- ID validated with `validateIsraeliID()` — shows error if invalid
- Edit mode: fills form with existing member data
- Delete: removes from array, calls `onUpdate`
- Toast notifications for save/delete

---

## NotificationContext (`src/contexts/NotificationContext.tsx`)

**Purpose:** App-wide toast notification system. Not a component rendered directly, but provides the `useNotification` hook.

**Context Value:**
```typescript
{
  addNotification: (type: 'success' | 'error', message: string) => void
}
```

**Notification Behavior:**
- Appears top-right of screen
- Animated entry/exit (Framer Motion `AnimatePresence`)
- Auto-dismisses after 10 seconds
- Manual close button (×)
- Success: green with `CheckCircle` icon
- Error: red with `AlertCircle` icon
- Multiple notifications stack vertically

**Usage:**
```typescript
const { addNotification } = useNotification();
addNotification('success', 'הקובץ הועלה בהצלחה');
addNotification('error', 'שגיאה בעיבוד הקובץ');
```

---

## Styling Conventions

- **Tailwind CSS 4** with RTL-aware utilities
- **Direction:** All root elements have `dir="rtl"` via `App.tsx` (`<div dir="rtl">`)
- **Font:** Assistant (Hebrew-friendly Google Font) for body, JetBrains Mono for monospace
- **Color palette:** slate (neutral), blue (primary), emerald (success), amber (warning), red (error), indigo (special)
- **Mobile-first:** `md:` breakpoint for desktop features
- **Animations:** Framer Motion for modals, notifications, and transitions
- **Icons:** Lucide React (tree-shaken, SVG-based)
- **Charts:** Recharts (only on Dashboard and InvestmentsPortfolio)
