# Family Finance App — AI Agents & Pipelines

This document describes every AI interaction in the system: which model is used, what it does, the exact prompt design, how outputs are structured, and how errors are handled.

---

## AI Provider

**Provider:** Google GenAI (`@google/genai` v1.29.0)
**Models in use:**

| Task | Model | Why |
|------|-------|-----|
| Document extraction (OCR + parsing) | `gemini-2.0-flash` | Multimodal, fast, cheap per token |
| Financial insights generation | `gemini-3-flash-preview` | Best reasoning for structured JSON |
| Financial advisor chat | `gemini-3-flash-preview` | Multi-turn chat support |

**API Key:** `GEMINI_API_KEY` — server-side environment variable, injected into client bundle via Vite's `define`. Not hardcoded.

---

## Agent 1: Document Extraction

**File:** `src/utils/FileProcessor.ts` → `extractDataWithGemini()`
**Model:** `gemini-2.0-flash`
**Trigger:** User uploads a file (PDF or image) via FolderLogic or Google Drive sync

### What it does
Receives a file (receipt, invoice, bank statement, pension quarterly report), reads it visually (inline data / base64), and extracts structured financial data as JSON.

### Input
```typescript
file: File  // PDF | image/jpeg | image/png | image/gif | image/webp
```

The file is base64-encoded using `FileReader.readAsDataURL()`, then passed as `inlineData` to Gemini.

### Prompt
```
Extract financial data from this document.
Language: Hebrew/English.
Return JSON ONLY with:
- date: Transaction date (YYYY-MM-DD)
- vendor: Name of the business/provider
- amount: Total amount paid
- vat: Tax/VAT amount (if present)
- category: One of [Housing_Utilities, Insurance_Pension, Transportation, Groceries_Dining, Health, Education, Leisure_Travel, Income_Investments, General_Misc]
- isQuarterlyReport: boolean
- quarterlyData: { balance, contribution, yield } (ONLY if isQuarterlyReport is true)
```

### API Call Structure
```typescript
await ai.models.generateContent({
  model: 'gemini-2.0-flash',
  contents: [
    { inlineData: { data: base64Data, mimeType: file.type || 'application/pdf' } },
    { text: prompt }
  ],
  config: { responseMimeType: "application/json" }
});
```

### Output Schema
```typescript
interface ExtractedData {
  date: string;                  // "YYYY-MM-DD"
  vendor: string;                // Business name
  amount: number;                // Total paid
  vat?: number;                  // Tax/VAT if present
  category: string;              // One of 9 category keys
  isQuarterlyReport?: boolean;   // True for pension/investment reports
  quarterlyData?: {
    balance: number;             // Total balance
    contribution: number;        // Monthly contribution
    yield: number;               // Return/yield amount
  };
}
```

### Error Classification
After extraction, all errors are classified by `classifyError()`:

| Error Type | Detection | Retryable | Message (Hebrew) |
|-----------|-----------|-----------|-----------------|
| `network` | `TypeError` with "fetch" | Yes | בעיית רשת — בדוק את החיבור ונסה שוב |
| `extraction_failed` | `SyntaxError` (bad JSON) | No | לא ניתן לנתח את המסמך |
| `rate_limit` (minute) | HTTP 429 | Yes (with delay) | מגבלת Gemini — ממתין X שניות |
| `rate_limit` (daily) | "PerDay" in message | No | מגבלת יומית מוצתה — נסה מחר |
| `upload_failed` | "Upload" in message | Yes | העלאה נכשלה |
| `unknown` | Anything else | Yes | error.message |

Retry delay is extracted from Gemini's error message via regex: `/"retryDelay"\s*:\s*"(\d+)s"/`. Default: 30 seconds.

### Rate Limiting Strategy
Google's free tier: **15 requests per minute**.
`SyncService` enforces a **4,500ms delay** between consecutive Gemini extraction calls.
The delay is skipped for the first file in a batch.

---

## Agent 2: Financial Insights Generator

**File:** `src/services/ai.ts` → `generateFinancialInsights()`
**Model:** `gemini-3-flash-preview`
**Trigger:** Dashboard mounts or month/year selection changes

### What it does
Receives a snapshot of the family's current month financial data and returns 3 short, actionable Hebrew insights.

### Input
```typescript
data: any  // Financial data object: budget vs actual, incomes, expenses breakdown
```

### System Prompt
```
אתה יועץ פיננסי חכם למשפחות.
להלן נתונים פיננסיים של משפחה לחודש הנוכחי:
${JSON.stringify(data, null, 2)}

אנא ספק 3 תובנות קצרות וברורות בעברית בלבד (RTL).
התובנות צריכות להיות מעשיות, למשל: "שים לב: הוצאות ה... חרגו ב-...", "טיפ: ...".
החזר את התשובה כמערך JSON של מחרוזות (strings).
```

### API Call Structure
```typescript
await ai.models.generateContent({
  model: "gemini-3-flash-preview",
  contents: prompt,
  config: {
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.ARRAY,
      items: { type: Type.STRING }
    }
  }
});
```

Uses `responseSchema` to enforce strict JSON array output.

### Output
```typescript
string[]  // Array of 3 Hebrew strings
// Example:
[
  "שים לב: הוצאות המזון חרגו ב-20% מהתקציב.",
  "טיפ: מעבר לחברת ביטוח אחרת יכול לחסוך לך 100 ש״ח בחודש.",
  "הכנסות החודש גבוהות ב-5% מהחודש שעבר, כל הכבוד!"
]
```

### Fallback
If `GEMINI_API_KEY` is missing or the call fails, the function returns the same 3 hardcoded Hebrew strings shown above. The UI is always populated — never empty.

Post-processing: strips markdown code fences (` ```json ... ``` `) before `JSON.parse()`.

---

## Agent 3: Financial Advisor Chat

**File:** `src/services/ai.ts` → `getFinancialChatSession()`
**Model:** `gemini-3-flash-preview`
**Trigger:** User types a message in the Dashboard chat panel

### What it does
Creates a persistent, multi-turn chat session that acts as a personal financial advisor. The session is initialized with the family's current month data as context. The user can ask follow-up questions, and Gemini maintains conversation history.

### Session Creation
```typescript
ai.chats.create({
  model: "gemini-3-flash-preview",
  config: {
    systemInstruction: `אתה יועץ פיננסי חכם למשפחות, הפועל כעוזר אישי...
    להלן הנתונים הפיננסיים של המשפחה לחודש הנוכחי:
    ${JSON.stringify(data)}
    עליך לענות על שאלות המשתמש לגבי התקציב, ההוצאות, וההכנסות שלו.
    ענה תמיד בעברית. היה מקצועי, אדיב, ותן עצות פרקטיות לחיסכון וניהול נכון.
    התשובות שלך צריכות להיות קצרות וקולעות, מותאמות לתצוגת צ'אט.`
  }
});
```

### System Instruction Context
The `systemInstruction` includes the full financial data JSON for the selected month, including:
- Budget categories vs actual spending
- Income entries
- Ecosystem (net worth breakdown)

### Chat Interface
The returned session has a `sendMessage(text)` method. Dashboard manages:
- `messages: Array<{ role: 'user' | 'model', text: string }>`
- Auto-scroll to latest message
- Disabled input during response

### Fallback
If no API key → `getFinancialChatSession()` returns `null`. Dashboard disables the chat panel gracefully.

---

## AI Usage in AssetCard (Pension Report Extraction)

**File:** `src/components/AssetCard.tsx`
**Delegated to:** `FileProcessor.ts → extractDataWithGemini()`

When a user uploads a quarterly pension/investment report to an AssetCard:
1. `extractDataWithGemini(file)` is called
2. Gemini detects `isQuarterlyReport: true`
3. Returns `quarterlyData: { balance, contribution, yield }`
4. AssetCard updates the parent InvestmentsPortfolio with new values

---

## Gemini Models Reference

| Model ID | Capability | Used For |
|----------|-----------|---------|
| `gemini-2.0-flash` | Multimodal (image + text), fast | Receipt/document OCR + data extraction |
| `gemini-3-flash-preview` | Text reasoning, structured JSON, chat | Insights + advisor chat |

Both models support `responseMimeType: "application/json"` for guaranteed structured output.

---

## Future AI Expansion Points

The current architecture is designed to extend cleanly:

1. **Gmail Integration** — Auto-fetch invoices from Gmail, pipe to `extractDataWithGemini()`
2. **Bank Statement Parser** — CSV/XLSX extraction via Gemini or a dedicated parser
3. **Budget Recommendations** — Use insights agent to suggest budget limits based on history
4. **Category Auto-learning** — Track user corrections and fine-tune category classification
5. **Voice Queries** — Gemini Live API for spoken financial questions
6. **Tax Report Generation** — Aggregate year-end data and generate summary with Gemini
