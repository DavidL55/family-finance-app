import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAdapterForModel } from '../providers/registry';
import { quote, spend, reconcileSpend, ApprovalRequiredError } from '../costGate/costGate';
import { toAiHttpsError } from '../providers/providerErrors';
import type { PermissionRole } from '../shared/permissions';
import type { AiExtractDocumentRequest, AiExtractDocumentResponse, DocumentAnalysis, AiCostRefusalDetails } from './types';

const KNOWN_ROLES: PermissionRole[] = ['super-admin', 'parent', 'member'];

// D17/third-lens M7 — a multi-page scanned statement, base64-encoded, can exceed the onCall
// request-size ceiling or the target model's context window before any of this stage's own code
// runs. Base64 inflates a source file's size ~33% over the original (D7's own note) — ~7MB base64
// leaves headroom under the callable payload ceiling for the rest of the request body (mimeType,
// familyMembers, modelId). Checked FIRST, before quote()/spend()/any adapter call, so an oversized
// request never costs anything.
export const MAX_DOCUMENT_BASE64_BYTES = 7 * 1024 * 1024; // ~7MB base64 ≈ ~5.25MB source file

/**
 * Batch 8 (closing review B4) — the flat output-token guess quote() is sized with, NAMED, for the
 * same reason aiChat.ts's CHAT_OUTPUT_TOKEN_ESTIMATE is: it is now read twice (to price the call,
 * and to tell a refused caller what to request an approval FOR), and two literals that must agree
 * is how a token gets minted for an amount the retry then re-quotes past.
 */
export const EXTRACTION_OUTPUT_TOKEN_ESTIMATE = 800;

const OVERSIZED_DOCUMENT_MESSAGE_HE =
  'המסמך גדול מדי לעיבוד — פצל אותו למספר קבצים קטנים יותר או העלה עמודים בודדים.';

const ALLOWED_CATEGORIES = [
  'מגורים ובית', 'ביטוח ופנסיה', 'תחבורה ורכב', 'מזון וצריכה',
  'בריאות', 'חינוך וחוגים', 'פנאי ובילוי', 'הכנסות והשקעות', 'שונות',
];

// Ported VERBATIM from src/utils/FileProcessor.ts's (now-retired) client-side analyzeDocument —
// the Hebrew category rules/document-type taxonomy are real, tested-by-usage content, not
// rewritten for this migration (task-7-brief.md Step 3). Only the CALL moved server-side; the
// prompt itself is unchanged.
function buildExtractionPrompt(familyMembers: string[]): string {
  const membersJson = JSON.stringify(familyMembers);
  return `You are a financial document analysis agent specializing in Israeli financial documents (Hebrew/English).

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
${ALLOWED_CATEGORIES.join(', ')}

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
}

// Short, prompt-embedded structure reminder for the providers whose generateJson only has a
// prompt-embedded JSON mode (Anthropic/OpenAI's fallback path in their own adapters) — the full
// REQUIRED JSON STRUCTURE section already lives in the extraction prompt itself above; this is
// the same short hint shape aiChat.ts's sibling callers would pass, not a second full copy of it.
const JSON_SCHEMA_HINT =
  '{"documentType": "...", "issuer": "...", "accountId": "...", "periodStart": "YYYY-MM-DD", ' +
  '"periodEnd": "YYYY-MM-DD", "owner": "... | null", "totalAmount": 0, "currency": "ILS", "transactions": [...]}';

/**
 * Task 7 — the AI CALL only. The Firestore write stays exactly where Task 1 put it
 * (commitExtractionDraft, client-side, unchanged) — only the extraction call itself needed a
 * provider key, so only it moves server-side. The human review-and-approve gate
 * (ExtractionReviewModal) is untouched by this handler; nothing here writes to
 * transaction_lines/documents/investments.
 *
 * The document's binary content is sent to the model as a real attachment (mimeType + base64),
 * not as prompt text — there is no textual "document content" to fence with wrapExternalData
 * (D6) on the way IN, since nothing document-derived is ever embedded as literal text in this
 * handler's own prompt. The extraction PROMPT itself (buildExtractionPrompt above) is our own
 * authored instructions, not external content. What the model returns (vendor names, etc.) is
 * untrusted on the way OUT, into any LATER prompt — a chat-context concern for whichever future
 * stage feeds extracted vendor names back into a chat prompt (cross-referenced to D6/Task 5, not
 * re-guarded here).
 */
export const aiExtractDocument = onCall<AiExtractDocumentRequest, Promise<AiExtractDocumentResponse>>(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'נדרשת התחברות');
  const role = request.auth.token.role as PermissionRole | undefined;
  if (!role || !KNOWN_ROLES.includes(role)) {
    // An account with no provisioned role claim yet must not be able to spend shared AI budget
    // (Sasha W10) — auth != null alone is not a sufficient guard. Same pattern as aiChat.ts.
    throw new HttpsError('permission-denied', 'החשבון עדיין לא שויך לתפקיד — פנה לסופר-אדמין');
  }
  const memberId = request.auth.token.memberId as string;
  const { fileBase64, mimeType, familyMembers, modelId, approvalToken } = request.data;

  // D17 — the FIRST check after the auth/role guard, before getAdapterForModel, before quote(),
  // before spend(), before any adapter call. Boundary is inclusive: exactly
  // MAX_DOCUMENT_BASE64_BYTES is still accepted.
  if (fileBase64.length > MAX_DOCUMENT_BASE64_BYTES) {
    throw new HttpsError('invalid-argument', OVERSIZED_DOCUMENT_MESSAGE_HE);
  }

  // Task 7 review, Important 1 — the action tag is verified SERVER-SIDE, before quote()/spend().
  // ModelPicker's listConfiguredModels('extraction') is a convenience filter, not a boundary: a
  // direct callable invocation with a chat-only model id used to reach the adapter (for a PDF,
  // OpenAI's adapter sends only its disclosed-gap note — no real document reaches the model) and
  // still burn budget. `action` is a required argument of getAdapterForModel precisely so this
  // handler, and every handler after it, cannot forget it. Same ordering discipline as D17's size
  // guard above: guard first, never spend on a request that cannot succeed.
  const found = getAdapterForModel(modelId, 'extraction');
  if (!found.ok) throw new HttpsError('invalid-argument', found.messageHe, { reason: found.reason });

  const prompt = buildExtractionPrompt(familyMembers ?? []);

  // Rough estimate for the pre-call ceiling gate (D14) — chars/4 for the prompt text plus the
  // base64 payload itself (a deliberately generous stand-in for vision-token cost; the adapter's
  // REAL token counts correct this via reconcileSpend once the call succeeds, same as aiChat.ts).
  const estIn = Math.ceil((prompt.length + fileBase64.length) / 4);
  const q = quote(found.model.providerId, modelId, estIn, EXTRACTION_OUTPUT_TOKEN_ESTIMATE);
  let spendResult;
  try {
    // Batch 8 (closing review B4) — spec §8's redemption half; see aiChat.ts's own note. Forwarded
    // verbatim, interpreted only by costGate.consumeApproval.
    spendResult = await spend(memberId, 'extraction', q, approvalToken);
  } catch (err) {
    if (err instanceof ApprovalRequiredError) {
      // Rethrown as a real HttpsError (D4 fix, Sasha I4) — same pattern as aiChat.ts. err.reason
      // (Task 3 fix) keeps "no ceiling configured yet" distinguishable from "over budget".
      //
      // Batch 8 (closing review B4) — carries the SERVER's own estimate inputs for the same reason
      // aiChat.ts does: the client cannot recompute estIn (it covers the extraction prompt plus
      // the base64 payload), so a client-side guess would mint an approval the retry's re-quote
      // exceeds, and consumeApproval's `<=` ceiling would refuse it after burning the token.
      const details: AiCostRefusalDetails = {
        quote: err.quote, usedThisMonthILS: err.usedThisMonthILS, ceilingILS: err.ceilingILS, reason: err.reason,
        estimatedInputTokens: estIn, estimatedOutputTokens: EXTRACTION_OUTPUT_TOKEN_ESTIMATE,
      };
      throw new HttpsError('resource-exhausted', err.message, details);
    }
    throw err;
  }

  // The adapter call (and the JSON.parse of its result) are the genuinely unpredictable steps
  // here (third-lens M2/D14) — both wrapped in the SAME try/catch so a malformed (non-JSON)
  // response is translated exactly like a rate-limit/timeout/context-overflow failure, and so
  // EITHER failure mode is provably distinguishable from success for the reconcileSpend decision
  // right below it.
  let result;
  let analysis: DocumentAnalysis;
  try {
    result = await found.adapter.generateJson({
      systemPrompt: '',
      messages: [{ role: 'user', text: prompt }],
      modelId,
      jsonSchemaHint: JSON_SCHEMA_HINT,
      attachment: { mimeType, base64Data: fileBase64 },
    });
    analysis = JSON.parse(result.text) as DocumentAnalysis;
  } catch (err) {
    // Deliberately does NOT call reconcileSpend here — the pre-call ESTIMATE stands for a failed
    // (or unparseable) call (D14: over-states spend rather than under-states it, so the ceiling
    // stays at least as protective as before, never less).
    throw toAiHttpsError(err, 'extraction', role);
  }

  // Corrects the ledger entry spend() already wrote, using the adapter's REAL token counts —
  // never re-runs the ceiling admission decision, only the accuracy of the record (D14). Same
  // pattern as aiChat.ts.
  let costILS = q.estimatedILS;
  if (spendResult.ledgerId) {
    const reconciled = await reconcileSpend(spendResult.ledgerId, result.inputTokens, result.outputTokens, {
      providerId: found.model.providerId, modelId,
    });
    // Batch 6 (closing review I2/B1) — reconcileSpend returns null when it cannot state the cost:
    // an unpriceable pair (the stamped model has left the registry) or an unreadable stored amount.
    // Falling back to the pre-call estimate reports a real number instead of a 0 that would tell
    // the client a paid call was free — the same safe direction the module documents for a ledger
    // entry that never gets reconciled at all.
    costILS = reconciled.correctedAmountILS ?? q.estimatedILS;
  }

  return { analysis, providerId: found.model.providerId, modelId, costILS };
});
