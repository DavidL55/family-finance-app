import { GoogleGenAI } from "@google/genai";
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
  const hebrewCategory = Object.values(CATEGORY_MAP).includes(category)
    ? category
    : CATEGORY_MAP.General_Misc;

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
  data?: ExtractedData;
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

export async function extractDataWithGemini(file: File, familyMembers: string[]): Promise<ExtractedData> {
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

  const prompt = `
You are a financial document analysis agent. Extract structured data from this document (Hebrew or English).

Return ONLY a valid JSON object with these exact fields:

{
  "date": "YYYY-MM-DD",
  "vendor": "cleaned business name (e.g. 'סופר פארם', not 'סופר פארם סניף קניון ערים')",
  "amount": <total final charge as a number, no currency symbol>,
  "category": "<one of the allowed categories below>",
  "owner": "<family member name or null>",
  "isQuarterlyReport": <true|false>,
  "quarterlyData": { "balance": <number>, "contribution": <number>, "yield": <number> }
}

CATEGORY RULES — you MUST use one of these exact Hebrew strings:
${allowedCategories.join(', ')}
If the category is ambiguous or unclear, you MUST return "שונות". Never invent a category outside this list.

OWNER RULES:
Look for a cardholder name, account holder name, or "על שם" field in the document.
If found, return the EXACT matching string from this list: ${membersJson}
If no name is found or it does not match anyone in the list, return null.

QUARTERLY REPORT RULES:
If this is a periodic/quarterly/annual report for a pension fund, provident fund, or investment account:
- Set "isQuarterlyReport": true
- Include "quarterlyData" with balance (total value), contribution (periodic deposit), and yield (return percentage as decimal)
Otherwise:
- Set "isQuarterlyReport": false
- OMIT "quarterlyData" entirely from the JSON

CONTEXT (do not include in output):
The output will be filed under: Family_Finance/YYYY/MM/<Hebrew category>/
The file will be renamed to: YYYY-MM-DD_vendor_amount.ext
Ensure your extracted values are accurate enough to produce a meaningful folder path and filename.
`;

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [
          { inlineData: { data: base64Data, mimeType: file.type || 'application/pdf' } },
          { text: prompt }
        ],
        config: { responseMimeType: "application/json" }
      });
      return JSON.parse(response.text) as ExtractedData;
    } catch (error) {
      const is429 = error instanceof Error &&
        (error.message.includes('429') || error.message.includes('Too Many Requests'));

      // Not a rate-limit error, or we've exhausted retries — propagate
      if (!is429 || attempt === MAX_RETRIES - 1) throw error;

      // Daily quota — non-retryable, no point waiting
      if (isDailyQuotaError(error)) throw error;

      // Per-minute rate limit — wait and retry
      const delayMs = extractRetryDelay(error);
      console.warn(`[Gemini] 429 rate limit (attempt ${attempt + 1}/${MAX_RETRIES}), waiting ${Math.round(delayMs / 1000)}s...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error('Gemini extraction failed after max retries');
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
    const data = await extractDataWithGemini(file, familyMembers);

    onProgress('בודק כפילויות...');
    const isDuplicate = await checkDuplicate(data);
    if (isDuplicate) {
      return { success: false, duplicate: true, data };
    }

    onProgress('שומר ל-Firestore...');
    await addDoc(collection(db, 'transactions'), {
      ...data,
      fileName: file.name,
      fileSize: file.size,
      created_at: serverTimestamp(),
      driveFileId: null,
      driveSynced: false,
    });

    onProgress('הסתיים בהצלחה!');
    return { success: true, data };
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
    const data = await extractDataWithGemini(file, familyMembers);

    onProgress("בודק כפילויות...");
    const isDuplicate = await checkDuplicate(data);
    if (isDuplicate) {
      return { success: false, duplicate: true, data };
    }

    // If Gemini returned 'שונות' (unknown), pause and ask the user where to file
    let resolvedCategory = data.category;
    if (
      data.category === CATEGORY_MAP.General_Misc ||
      !Object.values(CATEGORY_MAP).includes(data.category)
    ) {
      if (onUnknownCategory) {
        onProgress("ממתין לבחירת קטגוריה...");
        resolvedCategory = await onUnknownCategory(data);
      }
    }

    onProgress("מארגן תיקיות ב-Drive...");
    const folderId = await ensureFolderPath(token, resolvedCategory);

    onProgress("מעלה קובץ...");
    const ext = file.name.split('.').pop();
    const fileName = `${data.date}_${data.vendor}_${data.amount}.${ext}`;

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

    await addDoc(collection(db, "transactions"), {
      ...data,
      created_at: serverTimestamp(),
      driveFileId: uploadedFile.id
    });

    onProgress("הסתיים בהצלחה!");
    return { success: true, data };
  } catch (error) {
    const { errorType, errorMessage, retryable } = classifyError(error);
    console.error(`[FileProcessor] ${errorType}:`, error);
    onProgress(`שגיאה: ${errorMessage}`);
    return { success: false, errorType, errorMessage, retryable };
  }
}
