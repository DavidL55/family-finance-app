# Family Finance App — מסמך ארכיטקטורה מלא

**גרסה:** אפריל 2026
**משפחה:** דויד לוי, לילית לוי, עומר לוי
**כתובת ייצור:** https://family-finance-app-c9aa4.web.app
**ריפוזיטורי:** https://github.com/DavidL55/family-finance-app

---

## 1. סקירה כללית

אפליקציית תקציב משפחתי היא Progressive Web App (PWA) בעברית לניהול פיננסי של משפחת לוי. האפליקציה:

- **מייבאת** מסמכים פיננסיים (תדפיסי כרטיס אשראי, דפי חשבון בנק, קבצי Excel) מגוגל דרייב או מהמכשיר
- **מנתחת** אותם בעזרת Gemini AI ומוציאה כל עסקה בנפרד
- **מסווגת** כל עסקה לקטגוריה (9 קטגוריות) ולסוג הוצאה (קבועה / חצי-משתנה / משתנה)
- **מאחסנת** הכל ב-Firestore עם תמיכה מלאה במצב אופליין
- **מציגה** לוח תצוגה חודשי, דוח שנתי, דוח 60/20/20, ניהול השקעות ותכנון עתידי
- **מאפשרת** סינון הוצאות לפי בן משפחה (דויד / לילית / עומר / כל המשפחה)

---

## 2. טכנולוגיות

| שכבה | טכנולוגיה | גרסה |
|------|-----------|-------|
| Frontend | React | 19.0.0 |
| שפה | TypeScript (strict) | 5.8.2 |
| Build | Vite | 6.2.0 |
| עיצוב | Tailwind CSS | 4.1.14 |
| אנימציות | Framer Motion | 12.34.3 |
| גרפים | Recharts | 3.7.0 |
| אייקונים | Lucide React | 0.546.0 |
| מסד נתונים | Firebase Firestore | 12.10.0 |
| אימות | Firebase Anonymous Auth | 12.10.0 |
| AI ניתוח מסמכים | Google Gemini 2.5 Flash | @google/genai 1.29.0 |
| AI ייעוץ פיננסי | Google Gemini Flash Preview | @google/genai 1.29.0 |
| אחסון קבצים | Google Drive API v3 | — |
| כניסה | Google OAuth 2.0 | @react-oauth/google 0.13.4 |
| בדיקות | Vitest + Testing Library | 4.1.2 |
| PWA | vite-plugin-pwa | 1.2.0 |
| פריסה | Firebase Hosting | — |

---

## 3. מבנה הקבצים

```
src/
├── App.tsx                          # ניווט ראשי, Firebase auth
├── main.tsx                         # כניסה ל-React, ErrorBoundary, providers
│
├── components/
│   ├── Dashboard.tsx                # לוח תצוגה ראשי
│   ├── SyncButton.tsx               # סנכרון עם גוגל דרייב
│   ├── ExpensesBreakdown.tsx        # פירוט הוצאות חודשי
│   ├── CentralExpenseReport.tsx     # דוח הוצאות 60/20/20
│   ├── AnnualReport.tsx             # דוח שנתי - מטריצת חום
│   ├── FuturePlanning.tsx           # תכנון יעדים חסכון
│   ├── InvestmentsPortfolio.tsx     # תיק השקעות ופנסיה
│   ├── FolderLogic.tsx              # העלאת קבצים ידנית
│   ├── AssetCard.tsx                # כרטיס נכס בודד
│   ├── FamilyManagerModal.tsx       # ניהול בני משפחה
│   ├── EditClusterModal.tsx         # עריכת אשכולות הוצאות
│   └── InvestmentsImportModal.tsx   # ייבוא דוחות רבעוניים
│
├── services/
│   ├── firebase.ts                  # אתחול Firebase + Firestore
│   ├── ai.ts                        # Gemini תובנות + צ'אט
│   ├── SyncService.ts               # pipeline ראשי לסנכרון
│   ├── GoogleDriveService.ts        # Drive API wrapper
│   └── CategoriesService.ts        # ניהול קטגוריות הוצאות
│
├── utils/
│   ├── FileProcessor.ts             # מנוע ניתוח מסמכים Gemini
│   └── validation.ts               # ולידציה תעודת זהות ישראלית
│
├── contexts/
│   └── NotificationContext.tsx      # הודעות toast גלובליות
│
└── data/
    └── expenses.ts                  # נתוני דמו לפיתוח
```

---

## 4. מודול אימות וגישה (App.tsx)

### כיצד עובד האימות
1. בטעינה: `onAuthStateChanged` מחכה למשתמש
2. אם אין משתמש: `signInAnonymously(auth)` — כניסה אנונימית
3. הכניסה האנונימית מזהה את המכשיר באופן קבוע
4. מסך טעינה מוצג עד שהאימות מוכן (`authReady = true`)

### ניווט בין דפים
App.tsx מנהל `activeTab` state עם 7 לשוניות:

| ID | שם עברי | קומפוננטה |
|----|---------|-----------|
| dashboard | לוח תצוגה ראשי | Dashboard |
| expenses | פירוט הוצאות | ExpensesBreakdown |
| central-expenses | דוח הוצאות מרכז | CentralExpenseReport |
| investments | תיק השקעות ופנסיה | InvestmentsPortfolio |
| future | תכנון עתידי | FuturePlanning |
| annual | דוח שנתי | AnnualReport |
| folder | תיקייה חודשית | FolderLogic |

ניווט דסקטופ: sidebar שמאלי עם כפתורים.
ניווט מובייל: bottom navigation עם 5 כפתורים + "עוד" לשאר.

---

## 5. לוח התצוגה הראשי (Dashboard.tsx)

### מה מוצג
- **בחירת חודש/שנה** — ניווט חודשי עם חצים
- **בחירת בן משפחה** — כפתורים: כל המשפחה / דויד / לילית / עומר (+ כפתור ⚙ לניהול)
- **שווי נקי (Net Worth)** — נכסים פחות חובות
- **התגלגלות נכסים** — עו"ש, תיק השקעות, פנסיה, קריפטו, נדל"ן
- **תזרים מזומנים** — סך הכנסות, סך הוצאות, יתרה, תקציב מתוכנן
- **התחשבנות זוגית** — דויד ולילית כל אחד תורמ/ת 7,000₪ לבריכה משותפת; מי חייב למי כמה
- **פירוט הכנסות** — הכנסות חודשיות עם עריכה מובנית (משכורת, שכ"ד, וכו')
- **יועץ פיננסי AI** — 3 תובנות אוטומטיות + צ'אט חופשי
- **תקציב מול ביצוע** — תרשים עמודות לפי קטגוריה
- **חלוקת הוצאות** — תרשים עוגה לפי קטגוריה

### סינון לפי בן משפחה
כשלוחצים על "דויד":
- הוצאות ששויכו במפורש ל"דויד" מוצגות
- הוצאות ללא שיוך (owner: null = הוצאות משותפות) מוצגות לכולם
- הוצאות של "לילית" **לא** מוצגות לדויד
- תג "דויד" מופיע ליד כל כותרת נתונים

### Firestore שנקראים
- `incomes` — בזמן אמת via onSnapshot (לפי חודש/שנה)
- `transactions` — עסקאות legacy
- `transaction_lines` — עסקאות חדשות
- `settings/budgetConfig` — בני משפחה + תקציב
- `settings/ecosystem` — נתוני נכסים

### Firestore שנכתבים
- `incomes` — addDoc / deleteDoc / setDoc
- `settings/budgetConfig` — שמירת בני משפחה, זרע ראשוני של משפחת לוי
- `settings/ecosystem` — עדכון נכסים

### ווידג'ט ההתחשבנות (settlement)
- מציג רק הורים (role: 'הורה') — עומר (role: 'ילד') לא נכלל
- יעד: 7,000₪ לכל הורה לחודש
- מחשב: מי שילם כמה מהוצאות החודש → מי חייב למי

---

## 6. סנכרון עם גוגל דרייב (SyncButton.tsx)

### מסכי הסנכרון

**מסך 1: חיבור Drive**
- כפתור "חבר לגוגל דרייב" → OAuth popup
- Token נשמר ב-localStorage

**מסך 2: בחירת תיקייה**
- Browser של תיקיות Drive (ניווט היררכי)
- נקודת ברירת מחדל: `Family_Finance/`

**מסך 3: בחירת מצב סנכרון**
- **Incremental:** קבצים שנוספו/שונו מאז הסנכרון האחרון
- **All:** כל הקבצים מחדש
- **Custom:** בחירת טווח תאריכים
- **Category:** שנה + קטגוריה ספציפית

**מסך 4: ייבוא קובץ בודד מ-Drive**
- ניווט ב-Drive לקובץ ספציפי → ייבוא + שמירה

### Pipeline הסנכרון (SyncService.ts)
```
1. טעינת בני המשפחה מ-settings/budgetConfig
2. אחזור רשימת קבצים מ-Drive (PDF + תמונות בלבד, מקסימום 100)
3. לכל קובץ:
   a. הורדת buffer
   b. ניתוח Gemini → ExtractedData[]
   c. בדיקת כפילויות (vendor + amount + date)
   d. אם כפול → modal אצל המשתמש (דלג/החלף/בטל)
   e. הסקת חודש מהשם (YYYY-MM-DD, YYYY-MM, MM-YYYY, YYYYMM)
   f. פתרון קטגוריה לא ידועה → modal בחירה
   g. יצירת מבנה תיקיות: Family_Finance/שנה/חודש/קטגוריה/
   h. העלאה ל-Drive עם שם חדש: {YYYY-MM-DD}_{vendor}_{amount}.ext
   i. שמירת N רשומות ב-Firestore transaction_lines
4. דוח סיכום: עובדו / כפילויות / שגיאות
```

### קצב בקשות Gemini
- עיכוב 1,000ms בין קבצים (tier בתשלום: 2,000 RPM)

---

## 7. מנוע ניתוח המסמכים (FileProcessor.ts)

### שלושה מצבי עיבוד

| פונקציה | שימוש | Drive | Firestore |
|---------|-------|-------|-----------|
| `processLocalFile()` | העלאה ידנית | ✗ | transactions |
| `processAndUploadFile()` | סנכרון Drive legacy | ✓ | transactions |
| `processDocumentFile()` | סנכרון Drive חדש | ✓ | transaction_lines + documents |

### מה Gemini מנתח

**מסמכים נתמכים:**
- `credit_card` — כרטיס אשראי (MAX, אמקס, ויזה, מאסטרקארד, ישראכרט)
- `bank_statement` — דף חשבון בנק
- `invoice` — חשבונית
- `investment_report` — דוח רבעוני (השקעות, פנסיה)
- `loan` — הלוואה
- `insurance` — ביטוח
- `other` — אחר

**לכל מסמך מוחזר:**
```json
{
  "documentType": "credit_card",
  "issuer": "MAX",
  "accountId": "1234",
  "periodStart": "2025-08-01",
  "periodEnd": "2025-08-31",
  "chargeDate": "2025-09-10",
  "owner": "דויד",
  "totalAmount": 8450.50,
  "currency": "ILS",
  "transactions": [...]
}
```

**לכל עסקה:**
```json
{
  "date": "2025-08-14",
  "vendor": "שופרסל",
  "description": "שופרסל דיל",
  "amount": 284.50,
  "category": "מזון וצריכה",
  "paymentType": "one_time",
  "isCredit": false,
  "expenseClassification": "Semi-Variable"
}
```

### קטגוריות הוצאות (9 קטגוריות)

| ערך ב-Firestore | תצוגה בעברית |
|----------------|--------------|
| מגורים ובית | מגורים ובית |
| ביטוח ופנסיה | ביטוח ופנסיה |
| תחבורה ורכב | תחבורה ורכב |
| מזון וצריכה | מזון וצריכה |
| בריאות | בריאות |
| חינוך וחוגים | חינוך וחוגים |
| פנאי ובילוי | פנאי ובילוי |
| הכנסות והשקעות | הכנסות והשקעות |
| שונות | שונות |

### סיווג הוצאות (60/20/20 מודל)

| סיווג | expenseClassification | דוגמאות |
|-------|----------------------|---------|
| קבועות | Fixed | שכ"ד, ביטוח, מנויים (HOT/Netflix), פנסיה, הלוואות |
| חצי-משתנות | Semi-Variable | סופר (שופרסל/רמי לוי), דלק (PAZ/Yellow), חשמל, מים, גז, קופת חולים |
| משתנות | Variable | מסעדות, בגדים, בילויים, נסיעות, קניות אינטרנט, מזומן מכספומט |

### סוגי תשלום (paymentType)

| ערך | משמעות |
|-----|--------|
| one_time | רכישה חד-פעמית |
| installment | תשלומים (כולל מספר תשלום מתוך סה"כ) |
| standing_order | הוראת קבע |
| direct_debit | חיוב אוטומטי |
| transfer | העברה |
| fee | עמלה |
| interest | ריבית |
| refund | זיכוי / החזר |
| cancellation | ביטול |
| atm | כספומט |

### טיפול בשגיאות Gemini

| סוג שגיאה | טיפול |
|-----------|-------|
| 429 (Rate Limit) | retry עם עיכוב מה-header |
| PerDay quota | **לא** retry — מדווח כשגיאה |
| שגיאת רשת | retry עד 3 פעמים |
| JSON לא תקין | מנסה לנקות markdown ולנתח שוב |
| אין עסקאות | מחזיר מערך ריק |

---

## 8. מודל הנתונים ב-Firestore

### אוסף: `transaction_lines` (עיקרי — חדש)
```typescript
{
  documentId: string;          // מזהה המסמך המקור
  date: string;                // "YYYY-MM-DD"
  description: string;         // טקסט מקורי מהמסמך
  vendor: string;              // שם הספק
  amount: number;              // סכום בשקלים
  creditAmount?: number;       // לדפי בנק: זכות
  debitAmount?: number;        // לדפי בנק: חובה
  runningBalance?: number;     // יתרה שוטפת
  category: string;            // קטגוריה בעברית
  paymentType: string;         // one_time / installment / ...
  installmentNumber?: number;  // תשלום מס'
  totalInstallments?: number;  // סה"כ תשלומים
  isCredit: boolean;           // true = זיכוי/הכנסה
  expenseClassification?: 'Fixed' | 'Semi-Variable' | 'Variable';
  originalAmount?: number;     // סכום מטבע מקורי
  originalCurrency?: string;   // USD, EUR, ...
  voucherNumber?: string;      // מספר שובר
  owner?: string;              // שם בן/בת משפחה
  issuer?: string;             // מנפיק הכרטיס (MAX, אמקס, ...)
  accountId?: string;          // 4 ספרות אחרונות
  created_at: Timestamp;
}
```

### אוסף: `transactions` (legacy — נשמר לתאימות לאחור)
```typescript
{
  date: string;                // "YYYY-MM-DD" או "DD/MM/YYYY"
  vendor: string;
  amount: number;
  category: string;
  owner?: string;
  isCredit?: boolean;
  isQuarterlyReport?: boolean;
  quarterlyData?: { balance, contribution, yield };
  driveFileId?: string;
  fileName?: string;
  created_at: Timestamp;
}
```

### אוסף: `documents` (מטא-דאטה על מסמכים)
```typescript
{
  documentType: string;        // credit_card / bank_statement / ...
  issuer: string;              // MAX / לאומי / ...
  accountId: string;           // 4 ספרות
  periodStart: string;         // "YYYY-MM-DD"
  periodEnd: string;
  chargeDate?: string;         // לכרטיסי אשראי: תאריך חיוב
  owner?: string;
  totalAmount: number;
  openingBalance?: number;
  closingBalance?: number;
  currency: string;
  fileName: string;
  driveFileId: string;
  transactionCount: number;
  created_at: Timestamp;
}
```

### אוסף: `incomes` (הכנסות חודשיות)
```typescript
{
  name: string;      // "משכורת לילית" / "שכר דירה"
  amount: number;
  month: string;     // "01"-"12"
  year: string;      // "2026"
  date: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

### אוסף: `investments` (תיק השקעות)
```typescript
{
  name: string;              // "קרן פנסיה מנורה"
  type: 'investment' | 'pension' | 'insurance' | 'crypto';
  value: number;             // שווי נוכחי
  monthlyDeposit?: number;
  returnPct?: number;        // תשואה שנתית %
  returnVal?: number;        // תשואה בשקלים
  created_at?: Timestamp;
  updated_at?: Timestamp;
}
```

### אוסף: `goals` (יעדי חסכון)
```typescript
{
  name: string;          // "חופשה משפחתית"
  target: number;        // יעד בשקלים
  current: number;       // חסוך עד כה
  date: string;          // תאריך יעד "YYYY-MM-DD"
  categoryId: string;    // vacation/home/car/education/event/other
  created_at?: Timestamp;
}
```

### `settings/budgetConfig` (הגדרות תקציב ומשפחה)
```typescript
{
  members: Array<{
    id: string;         // "david-levy" / "lilit-levy" / "omer-levy"
    name: string;       // "דויד" / "לילית" / "עומר"
    role: 'הורה' | 'ילד';
    idNumber?: string;  // תעודת זהות (אופציונלי)
  }>;
  // ניתן להוסיף: all/david/lilit → [{name, budget}] לתקציב לפי קטגוריה
}
```

### `settings/ecosystem` (נכסים ונטו)
```typescript
{
  liquid: number;       // עו"ש + חסכונות
  investments: number;  // תיק השקעות
  pensions: number;     // פנסיות
  crypto: number;       // קריפטו
  realEstate: number;   // נדל"ן
  mortgage: number;     // משכנתא (חוב)
}
```

### `settings/categories` (קטגוריות מותאמות אישית)
מנוהל ע"י `CategoriesService.ts` — אפשרות הרחבה ב-runtime.

### `settings/expenseClusters` (אשכולות הוצאות)
```typescript
{
  clusters: Array<{
    id: string;
    name: string;         // "חשמל ומים"
    type: 'fixed' | 'variable';
    iconName: string;     // שם אייקון Lucide
    keywords: string[];   // ["חברת חשמל", "מי אביב"]
  }>;
}
```

---

## 9. רכיבי ממשק — פירוט מלא

### ExpensesBreakdown — פירוט הוצאות
**מה מוצג:** רשימת כל העסקאות לחודש נבחר
**פילטרים:** לפי בעלים (owner) + לפי אמצעי תשלום
**מקורות:** `transaction_lines` + `transactions` (legacy)
**תכונות:**
- ניווט חודשי עם חצים + dropdown
- תצוגת תשלומים: "תשלום 3 מתוך 12"
- תצוגה מורחבת לעסקה בודדת (modal)
- ייצוא עתידי (placeholder)
- sessionStorage bridge: AnnualReport יכול לשלוח חודש + קטגוריה לסינון אוטומטי

### CentralExpenseReport — דוח 60/20/20
**מה מוצג:** חלוקת הוצאות לפי הכלל 60/20/20
**מקורות:** `transaction_lines` + `transactions` + `incomes`
**תכונות:**
- 3 קטגוריות מתקפלות: קבועות / חצי-משתנות / משתנות
- אחוז מההכנסה + תג (ירוק/צהוב/אדום) לפי יעד
- קטגוריה 4 "לא מסווג" — מוצגת רק אם יש רשומות legacy
- footer: סה"כ הוצאות מול הכנסה חודשית

| קטגוריה | יעד | צבע |
|---------|-----|-----|
| קבועות | 60% | אינדיגו |
| חצי-משתנות | 20% | ענבר |
| משתנות | 20% | ורוד/אדום |

### AnnualReport — דוח שנתי
**מה מוצג:** מטריצת 12 חודשים × קטגוריות עם צביעת חום
**מקורות:** `transaction_lines` + `transactions`
**תכונות:**
- בחירת שנה (2024-2027)
- עמודה ראשונה נקבעת (שם קטגוריה), שורה ראשונה נקבעת (חודשים)
- צביעת חום: < 80% מממוצע → ירוק; > 140% → אדום
- לחיצה על תא → מעבר ל-ExpensesBreakdown לחודש + קטגוריה ספציפיים
- שורת סיכום חודשית (שורה אחרונה כהה)
- עמודת סיכום שנתית

### FuturePlanning — תכנון עתידי
**מה מוצג:** יעדי חסכון עם מעקב התקדמות
**מקור:** `goals` (onSnapshot)
**תבניות מהירות:**
- טיפול NLP (3,000₪)
- לייזר (2,500₪)
- דלתות פנים (8,000₪)
- חופשה משפחתית (15,000₪)
- קרן חירום (30,000₪)

**תכונות:**
- חישוב חיסכון נדרש לחודש (target - current) / חודשים שנותרו
- אייקון לפי קטגוריה
- מחיקת יעד

### InvestmentsPortfolio — תיק השקעות
**מה מוצג:** כל הנכסים הפיננסיים
**מקור:** `investments`
**תכונות:**
- חלוקה ל-4 סקציות: השקעות / פנסיה / ביטוח מנהלים / קריפטו
- תרשים עוגה של חלוקת הפורטפוליו
- הוספת נכס חדש (modal)
- לכל נכס: AssetCard עם אפשרות העלאת דוח רבעוני
- ייבוא דוח רבעוני מ-Drive (InvestmentsImportModal)

### FolderLogic — תיקייה חודשית (העלאה ידנית)
**מה מוצג:** תור קבצים לעיבוד ידני
**מקור:** כותב ל-`transactions`
**תכונות:**
- גרירה ושחרור קבצים
- סטטוסים: ממתין / מעבד / הצלחה / שגיאה / כפול
- טיפול בכפילויות (modal)
- retry אוטומטי עם ספירה לאחור
- עיבוד מקבילי (batch)

---

## 10. שירות ה-AI (ai.ts)

### מודלים בשימוש
| מודל | שימוש |
|------|-------|
| `gemini-2.5-flash` | ניתוח מסמכים פיננסיים (FileProcessor) |
| `gemini-2.0-flash-preview` | תובנות + צ'אט (ai.ts) |

### `generateFinancialInsights(data)`
קולט: הכנסות, תקציב מול ביצוע, קטגוריות, אקוסיסטם
מחזיר: מערך של 3 טיפים פיננסיים בעברית
Prompt: יועץ פיננסי למשפחה ישראלית דוברת עברית

### `getFinancialChatSession(data)`
פותח session רב-שיחתי עם Gemini
System instruction: "אתה יועץ פיננסי אישי למשפחה ישראלית..."
מאפשר שאלות חופשיות על המצב הפיננסי

---

## 11. Google Drive — מבנה תיקיות

```
My Drive/
└── Family_Finance/              ← תיקייה ראשית (נוצרת אוטומטית)
    ├── 2024/
    │   ├── 08/                  ← אוגוסט 2024
    │   │   ├── מגורים ובית/
    │   │   ├── ביטוח ופנסיה/
    │   │   ├── תחבורה ורכב/
    │   │   ├── מזון וצריכה/
    │   │   ├── בריאות/
    │   │   ├── חינוך וחוגים/
    │   │   ├── פנאי ובילוי/
    │   │   ├── הכנסות והשקעות/
    │   │   └── שונות/
    │   └── ...
    └── 2025/
        └── ...
```

**שמות קבצים לאחר העלאה:**
`{YYYY-MM-DD}_{vendor}_{amount}.pdf`
לדוגמה: `2025-08-14_שופרסל_284.50.pdf`

---

## 12. רצף זרימת הנתונים — מסמך חדש

```
משתמש גורר/בוחר קובץ
         ↓
[SyncButton / FolderLogic]
   העלאת קובץ לזיכרון
         ↓
[FileProcessor.processDocumentFile()]
   1. הורדת buffer
   2. base64 encode
   3. שליחה ל-Gemini 2.5 Flash
         ↓
[Gemini API]
   ניתוח מבנה המסמך → JSON
         ↓
[FileProcessor]
   4. ולידציה ופירסור JSON
   5. בדיקת כפילות (vendor + amount + date)
   6. אם כפול → שאל משתמש
         ↓
[GoogleDriveService]
   7. יצירת תיקיות (Year/Month/Category)
   8. העלאת קובץ עם שם חדש
         ↓
[Firestore]
   9. שמירת document ב-documents
   10. שמירת N רשומות ב-transaction_lines
   (כל עסקה = רשומה נפרדת)
         ↓
[Dashboard / ExpensesBreakdown]
   11. Firestore onSnapshot → עדכון UI
```

---

## 13. מנגנון תמיכה אופליין

**Firebase Offline Persistence:**
```typescript
initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
})
```

- קריאות עובדות מ-IndexedDB גם ללא אינטרנט
- כתיבות נשמרות בתור → מסונכרנות עם חיבור
- תמיכה במספר tabs בו-זמנית
- PWA: Service Worker מאחסן assets ב-cache

---

## 14. משפחת לוי — פרטי הגדרה

| חבר משפחה | id | role | שיוך עסקאות |
|-----------|-----|------|------------|
| דויד לוי | david-levy | הורה | owner: "דויד" |
| לילית לוי | lilit-levy | הורה | owner: "לילית" |
| עומר לוי | omer-levy | ילד | owner: "עומר" |

**ההתחשבנות הזוגית:**
- רק הורים (role: 'הורה') משתתפים
- יעד: 7,000₪ לכל הורה לחודש
- חישוב: סה"כ הוצאות ששויכו לכל אחד → מי חייב למי

**הכנסות משפחת לוי:**
- לילית: ~12,000₪/חודש
- דויד: ~8,000₪/חודש
- סה"כ: ~20,000₪/חודש

---

## 15. משתני סביבה

| משתנה | שימוש |
|-------|-------|
| `VITE_GEMINI_API_KEY` | Gemini AI (ניתוח + צ'אט) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth |
| `VITE_FIREBASE_API_KEY` | Firebase |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth |
| `VITE_FIREBASE_PROJECT_ID` | Firestore |
| `VITE_FIREBASE_STORAGE_BUCKET` | Storage |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | FCM |
| `VITE_FIREBASE_APP_ID` | Firebase App |

---

## 16. תבניות ארכיטקטוניות מרכזיות

### 1. Ref-based Promise Bridge (SyncButton)
מחבר בין async sync flow ל-React modals:
```typescript
// בזמן סנכרון:
await new Promise(resolve => {
  duplicateResolveRef.current = resolve;
  setCurrentDuplicate(file);  // פותח modal
});
// בסגירת modal:
duplicateResolveRef.current?.({ action: 'skip' });
```

### 2. Dual Collection Read (רוב הקומפוננטות)
קריאה מ-2 אוספים — תאימות legacy + נתונים חדשים:
```typescript
const [newSnap, legacySnap] = await Promise.all([
  getDocs(collection(db, 'transaction_lines')),
  getDocs(collection(db, 'transactions')),
]);
```

### 3. Member Filter — Lenient
מסנן הוצאות לפי בן משפחה אך שומר הוצאות משותפות:
```typescript
// לא מסנן החוצה כשowner=null (הוצאות משותפות)
if (filterOwnerName && tx.owner && tx.owner !== filterOwnerName) return;
```

### 4. SessionStorage Bridge
AnnualReport → ExpensesBreakdown (cross-tab routing):
```typescript
sessionStorage.setItem('expensesFilter', JSON.stringify({ month, year }));
setActiveTab('expenses');
```

### 5. Seeded Defaults
בטעינה ראשונה — זריעת בני משפחת לוי לFirestore אם ריק:
```typescript
if (existing.length === 0) {
  setFamilyMembers(DEFAULT_MEMBERS);
  await setDoc(doc(db, 'settings', 'budgetConfig'), { members: DEFAULT_MEMBERS }, { merge: true });
}
```

---

## 17. ניהול שגיאות

| שכבה | מנגנון |
|------|--------|
| React | ErrorBoundary ב-main.tsx |
| Firestore | try/catch + console.error בכל effect |
| Gemini | Retry עד 3 פעמים, backoff אקספוננציאלי |
| 429 Rate Limit | הוצאת retry delay מ-header |
| הודעות משתמש | NotificationContext (toast) |
| Drive Auth | Token refresh + re-login prompt |

---

## 18. אבטחה

**נוכחי (פיתוח):**
- Firestore rules: `allow read, write: if true` — פתוח לכולם
- Auth אנונימי — זיהוי לפי מכשיר, ללא סיסמה

**יעד לפרודקשן:**
- Firestore rules: `allow read, write: if request.auth != null`
- כניסה אנונימית מספקת auth token → עומד בתנאי
- אפשרות עתידית: Google Sign-In לזיהוי ספציפי של המשתמש

---

## 19. תלויות עיקריות (package.json)

```json
{
  "dependencies": {
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "firebase": "12.10.0",
    "@google/genai": "1.29.0",
    "@react-oauth/google": "0.13.4",
    "recharts": "3.7.0",
    "framer-motion": "12.34.3",
    "lucide-react": "0.546.0",
    "tailwindcss": "4.1.14",
    "date-fns": "4.1.0"
  },
  "devDependencies": {
    "vite": "6.2.0",
    "typescript": "5.8.2",
    "vitest": "4.1.2",
    "@testing-library/react": "16.3.2",
    "firebase-tools": "15.13.0"
  }
}
```

---

## 20. תרשים קשרים בין קומפוננטות

```
App.tsx (ניווט + אימות)
├── Dashboard.tsx
│   ├── FamilyManagerModal.tsx      ← ניהול בני משפחה
│   ├── ai.ts                       ← תובנות + צ'אט
│   ├── firebase.ts                 ← incomes, budgetConfig, ecosystem
│   └── [settlement widget]         ← חישוב ידני מ-transactions
│
├── SyncButton.tsx
│   ├── GoogleDriveService.ts       ← Drive API
│   ├── SyncService.ts              ← pipeline ראשי
│   ├── FileProcessor.ts            ← Gemini + Firestore
│   └── CategoriesService.ts        ← קטגוריות
│
├── ExpensesBreakdown.tsx           ← transaction_lines + transactions
├── CentralExpenseReport.tsx        ← transaction_lines + transactions + incomes
├── AnnualReport.tsx                ← transaction_lines + transactions
├── FuturePlanning.tsx              ← goals
│
├── InvestmentsPortfolio.tsx
│   ├── AssetCard.tsx               ← FileProcessor (דוחות רבעוניים)
│   └── InvestmentsImportModal.tsx  ← Drive browser
│
└── FolderLogic.tsx                 ← FileProcessor (העלאה ידנית)

כל הקומפוננטות משתמשות ב:
├── firebase.ts (db)
├── NotificationContext.tsx (toasts)
└── Tailwind + Lucide icons
```

---

*מסמך זה נוצר אוטומטית מהקוד ומיועד לייבוא ל-NotebookLM לצורך הבנה מלאה של האפליקציה.*
