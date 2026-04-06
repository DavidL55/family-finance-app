import { GoogleGenAI } from "@google/genai/web";
import { db } from "../services/firebase";
import { collection, query, where, getDocs, addDoc, serverTimestamp } from "firebase/firestore";
import { getOrCreateFolder } from "../services/GoogleDriveService";

// Hebrew Category Mapping
export const CATEGORY_MAP: Record<string, string> = {
  Housing_Utilities: 'מגורים ובית',
  Insurance_Pension: 'ביטוח ופנסיה',
  Transportation: 'תחבורה ורכב',
  Groceries_Dining: 'מזון וצריכה',
  Health: 'בריאות',
  Education: 'חינוך וחוגים',
  Leisure_Travel: 'פנאי ובילוי',
  Income_Investments: 'הכנסות והשקעות',
  General_Misc: 'שונות'
};

async function ensureFolderPath(token: string, category: string): Promise<string> {
  const date = new Date();
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  // category is already a Hebrew string from Gemini; fall back to 'שונות' only if unrecognised
  const hebrewCategory = category || CATEGORY_MAP.General_Misc;

  const rootId = await getOrCreateFolder(token, 'Family_Finance');
  const yearId = await getOrCreateFolder(token, year, rootId);
  const monthId = await getOrCreateFolder(token, month, yearId);
  const categoryId = await getOrCreateFolder(token, hebrewCategory, monthId);

  return categoryId;
}

export interface ExtractedData {
  date: string; // YYYY-MM-DD
  vendor: string;
  amount: number;
  vat?: number;
  category: string;
  owner: string | null;
  isQuarterlyReport?: boolean;
  quarterlyData?: {
    balance: number;
    contribution: number;
    yield: number;
  };
  // Multi-line extraction fields
  description?: string;
  paymentType?: PaymentType;
  installmentNumber?: number;
  totalInstallments?: number;
  isCredit?: boolean;
  expenseClassification?: 'Fixed' | 'Semi-Variable' | 'Variable';
}

export type PaymentType = 'one_time' | 'installment' | 'standing_order' | 'direct_debit' | 'transfer' | 'fee' | 'interest' | 'refund' | 'cancellation' | 'atm';

export type DocumentType = 'credit_card' | 'bank_statement' | 'invoice' | 'investment_report' | 'loan' | 'insurance' | 'other';

export interface TransactionLine {
  date: string;              // YYYY-MM-DD
  description: string;       // original Hebrew description from document
  vendor: string;            // cleaned business name
  amount: number;            // charge amount (always positive)
  creditAmount?: number;     // for bank statements: credit side
  debitAmount?: number;      // for bank statements: debit side
  runningBalance?: number;   // for bank statements
  category: string;          // Hebrew category string
  paymentType: PaymentType;
  installmentNumber?: number;
  totalInstallments?: number;
  isCredit: boolean;         // true = income/refund, false = expense
  expenseClassification?: 'Fixed' | 'Semi-Variable' | 'Variable';
  originalAmount?: number;   // foreign currency original amount
  originalCurrency?: string; // e.g. "USD", "EUR", "LKR"
  voucherNumber?: string;
}

export interface DocumentAnalysis {
  documentType: DocumentType;
  issuer: string;            // "אמריקן אקספרס", "MAX", "ישראכרט", "בנק הפועלים"
  accountId: string;         // last 4 digits of card OR full account number
  periodStart: string;       // YYYY-MM-DD
  periodEnd: string;         // YYYY-MM-DD
  chargeDate?: string;       // YYYY-MM-DD - for credit cards: the debit date
  owner: string | null;      // cardholder/account holder name
  totalAmount: number;       // total charge amount
  openingBalance?: number;   // bank statements
  closingBalance?: number;   // bank statements
  currency: string;          // "ILS"
  transactions: TransactionLine[];
}

export type ProcessErrorType = 'extraction_failed' | 'duplicate' | 'upload_failed' | 'network' | 'rate_limit' | 'unknown';

/**
 * Called when Gemini returns 'שונות' (unknown category).
 * Must return a Hebrew category string from CATEGORY_MAP values.
 * If not provided, the file is silently filed under 'שונות'.
 */
export type OnUnknownCategoryCallback = (data: ExtractedData) => Promise<string>;

export interface ProcessResult {
  success: boolean;
  duplicate?: boolean;
  data?: ExtractedData;        // first item (backward compat)
  results?: ExtractedData[];   // all extracted items
  savedCount?: number;
  skippedCount?: number;
  errorType?: ProcessErrorType;
  errorMessage?: string;
  retryable?: boolean;
  retryAfterMs?: number;
}

function extractRetryDelay(error: unknown): number {
  try {
    const msg = error instanceof Error ? error.message : String(error);
    const match = msg.match(/"retryDelay"\s*:\s*"(\d+)s"/);
    if (match) return parseInt(match[1], 10) * 1000;
  } catch { /* ignore */ }
  return 65000; // default: 65s ensures a full new minute window
}

function isDailyQuotaError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('RESOURCE_EXHAUSTED') || msg.includes('PerDay') || msg.includes('per day');
}

export async function extractDataWithGemini(file: File, familyMembers: string[]): Promise<ExtractedData[]> {
  const analysis = await analyzeDocument(file, familyMembers);
  return analysis.transactions.map(line => ({
    date: line.date,
    vendor: line.vendor,
    amount: line.amount,
    category: line.category,
    owner: analysis.owner,
    description: line.description,
    paymentType: line.paymentType,
    installmentNumber: line.installmentNumber,
    totalInstallments: line.totalInstallments,
    isCredit: line.isCredit,
    expenseClassification: line.expenseClassification,
    isQuarterlyReport: false,
  }));
}

export async function analyzeDocument(file: File, familyMembers: string[]): Promise<DocumentAnalysis> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({ apiKey });

  const base64Data = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });

  const allowedCategories = [
    'מגורים ובית', 'ביטוח ופנסיה', 'תחבורה ורכב', 'מזון וצריכה',
    'בריאות', 'חינוך וחוגים', 'פנאי ובילוי', 'הכנסות והשקעות', 'שונות'
  ];
  const membersJson = JSON.stringify(familyMembers);

  const prompt = `You are a financial document analysis agent specializing in Israeli financial documents (Hebrew/English).

Analyze this document and return ONLY a valid JSON object. No markdown, no explanation — pure JSON.

DOCUMENT TYPES:
- "credit_card": credit card statement (פירוט עסקאות, חיובי כרטיס)
- "bank_statement": bank account statement (תנועות בחשבון, דף חשבון)
- "invoice": single invoice or receipt (חשבונית, קבלה)
- "investment_report": pension/investment quarterly report (דוח רבעוני, קרן פנסיה)
- "loan": loan or mortgage document (הלוואה, משכנתא)
- "insurance": insurance policy (פוליסת ביטוח)
- "other": anything else

PAYMENT TYPES for each transaction:
- "one_time": regular one-time purchase
- "installment": installment payment (תשלום X מתוך Y)
- "standing_order": recurring standing order (הוראת קבע, הו"ק)
- "direct_debit": direct debit
- "transfer": bank transfer (העברה בנקאית, העברה-נייד)
- "fee": card fee or bank fee (דמי כרטיס, עמלה)
- "interest": interest (ריבית)
- "refund": refund or credit (זיכוי)
- "cancellation": cancelled transaction (ביטול עסקה)
- "atm": ATM withdrawal (משיכת מזומן)

EXPENSE CLASSIFICATION — classify EVERY transaction into exactly one:
- "Fixed": recurring, amount rarely changes — rent, mortgage, insurance (ביטוח חיים/רכב/בריאות/דירה),
  pension/provident deposits, subscriptions (HOT, Netflix, Spotify, Pango standing order),
  loan repayments, car lease, standing orders for utilities
- "Semi-Variable": necessary but amount varies — groceries (שופרסל, רמי לוי, יוחננוף),
  fuel (PAZ, Yellow), electricity, water, gas, pharmacies (סופר פארם, כללית),
  school/kindergarten fees, health fund (קופת חולים), public transport (Pango one-time, bus, train)
- "Variable": discretionary — restaurants, coffee shops, clothing, entertainment, travel,
  hotels, gifts, cosmetics, home goods, ATM cash, one-off purchases, beauty treatments,
  online shopping (Amazon, AliExpress)
- Refunds/credits: use the same classification as the original purchase type

CATEGORY RULES — use ONLY these exact Hebrew strings:
${allowedCategories.join(', ')}

Category guidelines:
- מגורים ובית: rent, electricity, water, HOT, gas, property
- ביטוח ופנסיה: all insurance (ביטוח חיים, רכב, בריאות, דירה, AIG, הפניקס, כלל ביטוח), pension, provident funds
- תחבורה ורכב: gas (PAZ, YELLOW app), road 6 (כביש 6), car expenses, public transport, Pango
- מזון וצריכה: supermarkets (שופרסל, רמי לוי, יוחננוף, מחסני השוק), restaurants, food delivery
- בריאות: pharmacies (סופר פארם, כללית, מאוחדת), medical clinics, health services
- חינוך וחוגים: schools, kindergartens, tennis, sports clubs, tutoring
- פנאי ובילוי: cinema, entertainment, travel, hotels, restaurants (non-food)
- הכנסות והשקעות: salary, transfers in, investments, bank interest received
- שונות: anything that doesn't fit above

OWNER RULES:
Match cardholder/account holder name to this family list: ${membersJson}
Return exact matching string or null if no match.

REQUIRED JSON STRUCTURE:
{
  "documentType": "credit_card",
  "issuer": "MAX",
  "accountId": "2190",
  "periodStart": "2026-02-01",
  "periodEnd": "2026-02-28",
  "chargeDate": "2026-03-10",
  "owner": "חובב",
  "totalAmount": 6610.02,
  "currency": "ILS",
  "transactions": [
    {
      "date": "2026-02-26",
      "description": "פנגו חשבונית חודשית",
      "vendor": "פנגו",
      "amount": 32.53,
      "category": "תחבורה ורכב",
      "paymentType": "standing_order",
      "expenseClassification": "Fixed",
      "isCredit": false
    },
    {
      "date": "2025-12-30",
      "description": "AIG רכב חובה תשלום 3 מתוך 6",
      "vendor": "AIG",
      "amount": 284.00,
      "category": "ביטוח ופנסיה",
      "paymentType": "installment",
      "installmentNumber": 3,
      "totalInstallments": 6,
      "expenseClassification": "Fixed",
      "isCredit": false
    },
    {
      "date": "2026-02-26",
      "description": "ביטול עסקה קופת תל אביב",
      "vendor": "קופת תל אביב",
      "amount": 290.00,
      "category": "בריאות",
      "paymentType": "cancellation",
      "isCredit": true
    }
  ]
}

For BANK STATEMENTS, include creditAmount, debitAmount, and runningBalance for each transaction:
{
  "date": "2025-01-10",
  "description": "מסטרקרד",
  "vendor": "מסטרקרד",
  "amount": 8149.38,
  "debitAmount": 8149.38,
  "creditAmount": 0,
  "runningBalance": 7649.96,
  "category": "שונות",
  "paymentType": "direct_debit",
  "isCredit": false
}

IMPORTANT RULES:
1. Extract EVERY SINGLE transaction line from the document — do not skip any
2. For installments: set installmentNumber and totalInstallments
3. For bank statements: include openingBalance and closingBalance at document level
4. Return amount as always positive — use isCredit=true for refunds/credits/income
5. Dates in YYYY-MM-DD format
6. Clean vendor names (remove branch details, just business name)
7. Return ONLY the JSON object, nothing else`;

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          { inlineData: { data: base64Data, mimeType: file.type || 'application/pdf' } },
          { text: prompt }
        ],
        config: { responseMimeType: "application/json" }
      });
      const result = JSON.parse(response.text) as DocumentAnalysis;
      return result;
    } catch (error) {
      const is429 = error instanceof Error &&
        (error.message.includes('429') || error.message.includes('Too Many Requests'));
      if (!is429 || attempt === MAX_RETRIES - 1) throw error;
      if (isDailyQuotaError(error)) throw error;
      const delayMs = extractRetryDelay(error);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('Document analysis failed after max retries');
}

export async function checkDuplicate(data: ExtractedData): Promise<boolean> {
  try {
    const recordsRef = collection(db, "transactions");
    const q = query(
      recordsRef,
      where("vendor", "==", data.vendor),
      where("amount", "==", data.amount),
      where("date", "==", data.date)
    );
    const querySnapshot = await getDocs(q);
    return !querySnapshot.empty;
  } catch {
    // If Firestore is offline, assume no duplicate and continue
    return false;
  }
}

function classifyError(error: unknown): { errorType: ProcessErrorType; errorMessage: string; retryable: boolean; retryAfterMs?: number } {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return { errorType: 'network', errorMessage: 'בעיית רשת — בדוק את החיבור ונסה שוב', retryable: true };
  }
  if (error instanceof SyntaxError) {
    return { errorType: 'extraction_failed', errorMessage: 'לא ניתן לנתח את המסמך — נסה PDF או תמונה ברורה יותר', retryable: false };
  }
  if (error instanceof Error && (error.message.includes('429') || error.message.includes('Quota') || error.message.includes('quota'))) {
    const msg = error.message;
    const isDaily = msg.includes('Day') || msg.includes('PerDay');
    if (isDaily) {
      return { errorType: 'rate_limit', errorMessage: 'מגבלת יומית של Gemini מוצתה — נסה מחר או הוסף חיוב ב-Google AI Studio', retryable: false };
    }
    const retryAfterMs = extractRetryDelay(error);
    return { errorType: 'rate_limit', errorMessage: `מגבלת Gemini — ממתין ${Math.round(retryAfterMs / 1000)} שניות`, retryable: true, retryAfterMs };
  }
  if (error instanceof Error && error.message.includes('Upload')) {
    return { errorType: 'upload_failed', errorMessage: 'העלאה נכשלה — נסה שוב בעוד מספר שניות', retryable: true };
  }
  const message = error instanceof Error ? error.message : 'שגיאה לא ידועה';
  return { errorType: 'unknown', errorMessage: message, retryable: true };
}

// Process file locally: extract with Gemini + save to Firestore, no Drive needed.
// driveFileId will be null until user syncs to Drive later.
export async function processLocalFile(
  file: File,
  onProgress: (status: string) => void,
  familyMembers: string[] = []
): Promise<ProcessResult> {
  try {
    onProgress('מנתח מסמך באמצעות AI...');
    const items = await extractDataWithGemini(file, familyMembers);

    if (items.length === 0) {
      return { success: false, errorType: 'extraction_failed', errorMessage: 'לא נמצאו עסקאות במסמך', retryable: false };
    }

    let savedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < items.length; i++) {
      const data = items[i];
      onProgress(`בודק כפילויות... (${i + 1}/${items.length})`);
      const isDup = await checkDuplicate(data);
      if (isDup) { skippedCount++; continue; }

      onProgress(`שומר עסקה ${i + 1} מתוך ${items.length}...`);
      await addDoc(collection(db, 'transactions'), {
        ...data,
        fileName: file.name,
        fileSize: file.size,
        created_at: serverTimestamp(),
        driveFileId: null,
        driveSynced: false,
      });
      savedCount++;
    }

    if (savedCount === 0 && skippedCount === items.length) {
      return { success: false, duplicate: true, results: items, skippedCount };
    }

    onProgress(`הסתיים! ${savedCount} עסקאות נשמרו${skippedCount > 0 ? `, ${skippedCount} כפילויות דולגו` : ''}`);
    return { success: true, data: items[0], results: items, savedCount, skippedCount };
  } catch (error) {
    const { errorType, errorMessage, retryable, retryAfterMs } = classifyError(error);
    console.error(`[FileProcessor] ${errorType}:`, error);
    onProgress(`שגיאה: ${errorMessage}`);
    return { success: false, errorType, errorMessage, retryable, retryAfterMs };
  }
}

export async function processAndUploadFile(
  file: File,
  token: string,
  onProgress: (status: string) => void,
  familyMembers: string[] = [],
  onUnknownCategory?: OnUnknownCategoryCallback
): Promise<ProcessResult> {
  try {
    onProgress("מנתח מסמך באמצעות AI...");
    const items = await extractDataWithGemini(file, familyMembers);

    if (items.length === 0) {
      return { success: false, errorType: 'extraction_failed', errorMessage: 'לא נמצאו עסקאות במסמך', retryable: false };
    }

    // Filter duplicates per item
    onProgress("בודק כפילויות...");
    const nonDuplicates: ExtractedData[] = [];
    let skippedCount = 0;
    for (const item of items) {
      const isDup = await checkDuplicate(item);
      if (isDup) { skippedCount++; } else { nonDuplicates.push(item); }
    }

    if (nonDuplicates.length === 0) {
      return { success: false, duplicate: true, results: items, skippedCount };
    }

    // Resolve unknown categories per item
    for (let i = 0; i < nonDuplicates.length; i++) {
      const item = nonDuplicates[i];
      if (
        (item.category === CATEGORY_MAP.General_Misc ||
         !Object.values(CATEGORY_MAP).includes(item.category)) &&
        onUnknownCategory
      ) {
        onProgress("ממתין לבחירת קטגוריה...");
        item.category = await onUnknownCategory(item);
      }
    }

    // Pick primary category: first non-credit item, fallback to first item
    const primaryItem = nonDuplicates.find(i => !i.isCredit) ?? nonDuplicates[0];

    onProgress("מארגן תיקיות ב-Drive...");
    const folderId = await ensureFolderPath(token, primaryItem.category);

    // Upload file ONCE
    onProgress("מעלה קובץ...");
    const ext = file.name.split('.').pop();
    const fileName = `${primaryItem.date}_${primaryItem.vendor}_${primaryItem.amount}.${ext}`;

    const metadata = { name: fileName, parents: [folderId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    const uploadRes = await fetch('https://upload.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });

    if (!uploadRes.ok) throw new Error("Upload failed");
    const uploadedFile = await uploadRes.json() as { id: string };

    // Save N Firestore records with same driveFileId
    onProgress(`שומר ${nonDuplicates.length} עסקאות...`);
    for (const item of nonDuplicates) {
      await addDoc(collection(db, "transactions"), {
        ...item,
        created_at: serverTimestamp(),
        driveFileId: uploadedFile.id,
        fileName: file.name,
        driveSynced: true,
      });
    }

    onProgress(`הסתיים! ${nonDuplicates.length} עסקאות נשמרו${skippedCount > 0 ? `, ${skippedCount} כפילויות דולגו` : ''}`);
    return { success: true, data: nonDuplicates[0], results: nonDuplicates, savedCount: nonDuplicates.length, skippedCount };
  } catch (error) {
    const { errorType, errorMessage, retryable } = classifyError(error);
    console.error(`[FileProcessor] ${errorType}:`, error);
    onProgress(`שגיאה: ${errorMessage}`);
    return { success: false, errorType, errorMessage, retryable };
  }
}

// Helper: allowed category values (used in processDocumentFile)
const allowedCategoryValues = [
  'מגורים ובית', 'ביטוח ופנסיה', 'תחבורה ורכב', 'מזון וצריכה',
  'בריאות', 'חינוך וחוגים', 'פנאי ובילוי', 'הכנסות והשקעות', 'שונות'
];

export interface DocumentProcessResult {
  success: boolean;
  documentId?: string;
  analysis?: DocumentAnalysis;
  transactionCount?: number;
  duplicate?: boolean;
  errorType?: ProcessErrorType;
  errorMessage?: string;
  retryable?: boolean;
}

export async function processDocumentFile(
  file: File,
  token: string,
  onProgress: (status: string) => void,
  familyMembers: string[] = [],
  onUnknownCategory?: (line: TransactionLine, lineIndex: number) => Promise<string>
): Promise<DocumentProcessResult> {
  try {
    onProgress("מנתח מסמך באמצעות AI...");
    const analysis = await analyzeDocument(file, familyMembers);

    // Check for duplicate document (same issuer + accountId + periodStart)
    const docsRef = collection(db, 'documents');
    const dupQ = query(
      docsRef,
      where('issuer', '==', analysis.issuer),
      where('accountId', '==', analysis.accountId),
      where('periodStart', '==', analysis.periodStart)
    );
    const dupSnap = await getDocs(dupQ);
    if (!dupSnap.empty) {
      return { success: false, duplicate: true, analysis };
    }

    // Resolve categories for unknown transactions
    onProgress(`נמצאו ${analysis.transactions.length} עסקאות — שומר...`);
    const resolvedTransactions = [...analysis.transactions];
    for (let i = 0; i < resolvedTransactions.length; i++) {
      const line = resolvedTransactions[i];
      if (
        (line.category === 'שונות' || !allowedCategoryValues.includes(line.category)) &&
        onUnknownCategory
      ) {
        line.category = await onUnknownCategory(line, i);
      }
    }

    // Upload file to Drive
    onProgress("מעלה קובץ ל-Drive...");
    const ext = file.name.split('.').pop();
    const fileName = `${analysis.periodStart}_${analysis.issuer}_${analysis.accountId}.${ext}`;
    const folderId = await ensureFolderPath(token, analysis.documentType === 'bank_statement' ? 'הכנסות והשקעות' : resolvedTransactions[0]?.category || 'שונות');

    const metadata = { name: fileName, parents: [folderId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    const uploadRes = await fetch('https://upload.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });

    if (!uploadRes.ok) throw new Error("Upload failed");
    const uploadedFile = await uploadRes.json() as { id: string };

    // Save document record
    onProgress("שומר מסמך ל-Firestore...");
    const docRef = await addDoc(collection(db, 'documents'), {
      documentType: analysis.documentType,
      issuer: analysis.issuer,
      accountId: analysis.accountId,
      periodStart: analysis.periodStart,
      periodEnd: analysis.periodEnd,
      chargeDate: analysis.chargeDate ?? null,
      owner: analysis.owner,
      totalAmount: analysis.totalAmount,
      openingBalance: analysis.openingBalance ?? null,
      closingBalance: analysis.closingBalance ?? null,
      currency: analysis.currency || 'ILS',
      fileName: file.name,
      driveFileId: uploadedFile.id,
      transactionCount: resolvedTransactions.length,
      created_at: serverTimestamp(),
    });

    // Save each transaction line
    onProgress("שומר עסקאות...");
    for (const line of resolvedTransactions) {
      await addDoc(collection(db, 'transaction_lines'), {
        documentId: docRef.id,
        date: line.date,
        description: line.description,
        vendor: line.vendor,
        amount: line.amount,
        creditAmount: line.creditAmount ?? null,
        debitAmount: line.debitAmount ?? null,
        runningBalance: line.runningBalance ?? null,
        category: line.category,
        paymentType: line.paymentType,
        installmentNumber: line.installmentNumber ?? null,
        totalInstallments: line.totalInstallments ?? null,
        isCredit: line.isCredit,
        expenseClassification: line.expenseClassification ?? null,
        originalAmount: line.originalAmount ?? null,
        originalCurrency: line.originalCurrency ?? null,
        voucherNumber: line.voucherNumber ?? null,
        owner: analysis.owner,
        issuer: analysis.issuer,
        accountId: analysis.accountId,
        created_at: serverTimestamp(),
      });
    }

    onProgress(`הושלם! ${resolvedTransactions.length} עסקאות נשמרו.`);
    return {
      success: true,
      documentId: docRef.id,
      analysis,
      transactionCount: resolvedTransactions.length,
    };
  } catch (error) {
    const { errorType, errorMessage, retryable } = classifyError(error);
    console.error(`[FileProcessor] processDocumentFile ${errorType}:`, error);
    onProgress(`שגיאה: ${errorMessage}`);
    return { success: false, errorType, errorMessage, retryable };
  }
}
