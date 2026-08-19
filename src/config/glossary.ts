// D4 — central hover-explain glossary (spec §5.2: "ההסברים יושבים במילון מונחים מרכזי אחד — לא
// מפוזרים בקוד"). This is a static, typed TS config for this stage, not yet backed by the
// settings/metricGlossary Firestore doc spec §7 describes — migrating to an editable,
// Firestore-backed store is real future work (candidate: whenever a "הגדרות מערכת" admin screen
// exists to edit it), not a silently-dropped requirement. A single typed module satisfies
// today's actual requirement: one place, not scattered across components.
//
// Concrete list, NOW vs deferred (D4): wired now — Dashboard's four KPI cards
// (dashboard.totalIncome/totalExpenses/monthlyBalance/plannedBudget), its five ecosystem tiles
// (dashboard.ecosystem.liquid/investments/pensions/crypto/realEstate), and its net-worth card
// (dashboard.netWorth). Authored now but not yet wired to a live trigger anywhere —
// expenses.listTotal, documenting ExpensesBreakdown's refund/cancellation carve-out per the
// Stage 1 ledger's explicit instruction ("surface it in the hover-explain glossary in Stage 4");
// the entry exists here so Stage 5's ExpensesBreakdown work is "attach the trigger," not "invent
// the copy." Deferred entirely — every other screen's figures (Stage 5+), the forecast/insights
// vocabulary (Stage 7/8, doesn't exist yet).
//
// Every entry below is written against src/utils/plainLanguage.ts's testable standard (short
// sentences, no banned jargon) AND, per Ofra ruling I5, must be read end-to-end by a named
// non-technical reviewer before this task's commit — see this task's report for that sign-off.
// The automated check catches jargon/length; it cannot catch "technically simple words in a
// confusing order," which is why a human review is still required.
//
// Stage 5 Task 5 (D3/D4) — computeNetWorth() becomes the sole, authoritative net-worth
// calculation app-wide; the five dashboard.ecosystem.* entries (fed by the retired
// settings/ecosystem arithmetic) are REMOVED, replaced by four entries keyed to
// NetWorthLineItem.source (netWorth.assets.accounts/investments/realEstate,
// netWorth.liabilities.loans), looked up dynamically via netWorthGlossaryId(side, source) so
// NetWorthScreen and Dashboard's card never invent their own id mapping twice. dashboard.netWorth
// itself is rewritten to describe computeNetWorth()'s real behavior (own/family-scoped; assets =
// accounts + investments + real estate, liabilities = loans) — the mortgage-double-count caveat
// that used to live on dashboard.ecosystem.realEstate's copy moves to
// netWorth.assets.realEstate, since D3 closes that specific risk for accounts/loans generally
// (a mortgage recorded as a real Loan can no longer double up against the hand-typed ecosystem
// figure) but real estate itself still has no dedicated collection or per-item freshness date.
//
// expenses.listTotal's howComputed mirrors transactionFilters.ts's isExpenseListRow (vs.
// isExpenseRow) distinction in plain words: a refund or cancellation credit row stays visible and
// counted, while any other credit row is excluded — the one deliberate divergence documented in
// that file's comments.
//
// Stage 5 Task 3 (D13/D14 dispatch) — accounts.totalBalance/accounts.rowBalance. Binding
// requirement beyond the plan's own AccountsScreen snippet, which wired an <Explain> only to the
// aggregate total: the spec says "כל מספר" (every number) literally, so the per-row balance each
// account renders gets its own glossary entry and trigger too, not just the summary line.
import type { GlossaryEntry } from '../types/glossary';

export const GLOSSARY: Record<string, GlossaryEntry> = {
  'dashboard.totalIncome': {
    id: 'dashboard.totalIncome',
    title: 'סך ההכנסות',
    explanation: 'זה הסכום הכולל של כל הכסף שנכנס למשפחה בחודש שנבחר, לפני הוצאות.',
    howComputed: 'מחברים יחד את כל ההכנסות שנרשמו לחודש שנבחר בפילטר, כמו משכורת או מענק.',
    source: 'הכנסות שהוזנו ידנית ברשימת ההכנסות, וכן הכנסות קבועות שמתווספות אליה אוטומטית מדי חודש.',
    asOf: 'מתעדכן בכל פעם שנכנסים למסך, לפי החודש שנבחר למעלה',
  },
  'dashboard.totalExpenses': {
    id: 'dashboard.totalExpenses',
    title: 'סך ההוצאות',
    explanation: 'זה הסכום הכולל של כל הכסף שיצא מהמשפחה בחודש שנבחר.',
    howComputed: 'מחברים את כל התנועות שמסומנות כהוצאה, ולא כוללים זיכויים כמו החזרים.',
    source: 'תנועות מחשבונות הבנק והאשראי שסונכרנו למערכת',
    asOf: 'מתעדכן בכל פעם שנכנסים למסך, לפי החודש שנבחר למעלה',
  },
  'dashboard.monthlyBalance': {
    id: 'dashboard.monthlyBalance',
    title: 'מאזן חודשי',
    explanation: 'זה ההפרש בין כמה כסף נכנס לכמה כסף יצא, באותו חודש.',
    howComputed: 'לוקחים את סך ההכנסות ומחסירים ממנו את סך ההוצאות של אותו חודש.',
    source: 'סך ההכנסות שהוזנו ידנית, וסך ההוצאות מתנועות הבנק והאשראי שסונכרנו למערכת.',
    asOf: 'מתעדכן בכל פעם שנכנסים למסך, לפי החודש שנבחר למעלה',
  },
  'dashboard.plannedBudget': {
    id: 'dashboard.plannedBudget',
    title: 'תקציב מתוכנן',
    explanation: 'זה הסכום שהמשפחה קבעה מראש כמסגרת הוצאה לחודש הזה.',
    howComputed: 'מחברים את הסכומים שהוגדרו מראש לכל קטגוריית הוצאה בחודש שנבחר.',
    source: 'הגדרות התקציב שהמשפחה שמרה במערכת',
    asOf: 'נכון לתקציב האחרון שנשמר עבור החודש שנבחר',
  },
  'dashboard.netWorth': {
    id: 'dashboard.netWorth',
    title: 'שווי נקי',
    explanation: 'זה כל מה ששווה למשפחה (או לך, לפי הבחירה למעלה) פחות כל מה שחייבים.',
    howComputed: 'מחברים את כל החשבונות, ההשקעות והנדל״ן, ומחסירים מהסכום את יתרת ההלוואות.',
    source: 'החשבונות וההלוואות שהוזנו במסכים המתאימים, ההשקעות שהוזנו במערכת, והנדל״ן שהוזן בעבר.',
    asOf: 'נכון לרגע העדכון האחרון של כל אחד מהמרכיבים בנפרד',
  },
  'netWorth.assets.accounts': {
    id: 'netWorth.assets.accounts',
    title: 'חשבונות ומזומן',
    explanation: 'זה סך היתרות בכל החשבונות הפעילים.',
    howComputed: 'מחברים את היתרה העדכנית של כל חשבון פעיל. חשבון בארכיון לא נכלל.',
    source: 'מסך החשבונות',
    asOf: 'מתעדכן בכל עריכת יתרה',
  },
  'netWorth.assets.investments': {
    id: 'netWorth.assets.investments',
    title: 'השקעות ופנסיה',
    explanation: 'זה השווי הכולל של תיקי ההשקעות והפנסיה.',
    howComputed: 'מחברים את השווי העדכני שדווח עבור כל תיק שהוזן.',
    source: 'מסך תיק ההשקעות',
    asOf: 'אין תאריך עדכון פרטני לכל השקעה עדיין',
  },
  'netWorth.assets.realEstate': {
    id: 'netWorth.assets.realEstate',
    title: 'נדל״ן',
    explanation: 'זה השווי המוערך של נדל״ן שבבעלות המשפחה.',
    howComputed: 'לוקחים את השווי שהוזן בעבר עבור הנדל״ן.',
    source: 'ערך שהוזן ידנית בעבר במערכת הישנה',
    asOf: 'אין תאריך עדכון פרטני לנדל״ן עדיין, בשונה מחשבונות והלוואות',
  },
  'netWorth.liabilities.loans': {
    id: 'netWorth.liabilities.loans',
    title: 'הלוואות וחובות',
    explanation: 'זה סך היתרה שנשארה לשלם על כל ההלוואות, כולל משכנתא אם נרשמה כהלוואה.',
    howComputed: 'מחברים את היתרה שנשארה לשלם על כל הלוואה פעילה.',
    source: 'מסך ההלוואות',
    asOf: 'מתעדכן בכל עריכת יתרה',
  },
  'expenses.listTotal': {
    id: 'expenses.listTotal',
    title: 'סך ההוצאות ברשימה',
    explanation:
      'זה סכום כל ההוצאות שרואים ברשימה למטה, בחודש שנבחר. שורת החזר או ביטול נשארת ברשימה ונספרת, כדי שיהיה אפשר לראות שהיא קרתה.',
    howComputed: 'סופרים כל שורה שאינה הכנסה. זיכוי בגלל החזר או ביטול נשאר ונספר, וכל זיכוי אחר לא נספר.',
    source: 'תנועות ההוצאה מהחודש שנבחר, כפי שמוצגות במסך ההוצאות',
    asOf: 'מתעדכן בכל פעם שנכנסים למסך, לפי החודש שנבחר למעלה',
  },
  'accounts.totalBalance': {
    id: 'accounts.totalBalance',
    title: 'סך היתרות',
    explanation: 'זה סכום כל היתרות בחשבונות הפעילים שרואים ברשימה, לפי הבחירה של מי למעלה.',
    howComputed: 'מחברים את היתרה העדכנית של כל חשבון פעיל. חשבון שנמצא בארכיון לא נכלל בסכום.',
    source: 'החשבונות שהוזנו במסך הזה',
    asOf: 'מתעדכן בכל פעם שנכנסים למסך',
  },
  'accounts.rowBalance': {
    id: 'accounts.rowBalance',
    title: 'יתרת חשבון',
    explanation: 'זה הסכום שנמצא כרגע בחשבון הזה, לפי מה שהוזן או עודכן לאחרונה.',
    howComputed: 'זה המספר שהוזן ידנית כיתרה העדכנית של החשבון, בפעם האחרונה שהוא עודכן.',
    source: 'הערך שהוזן ידנית עבור החשבון הזה',
    asOf: 'מתעדכן כשהיתרה של החשבון מתעדכנת ידנית',
  },
  // Stage 5 Task 4 — loans.totalBalance/rowInterestRate/rowMonthlyPayment/payoffProgress. Same
  // "כל מספר" requirement as accounts.rowBalance: every number the LoansScreen renders gets its
  // own entry, not just the aggregate total. payoffProgress is a DERIVED figure (not a raw stored
  // field) — verified against LoansScreen.tsx's own paidOffPct() before writing this copy:
  // Math.round((1 - balance / principal) * 100), clamped [0, 100].
  'loans.totalBalance': {
    id: 'loans.totalBalance',
    title: 'סך היתרה שנותרה',
    explanation: 'זה סכום כל היתרות שנשארו לשלם על כל ההלוואות שרואים ברשימה, לפי הבחירה של מי למעלה.',
    howComputed: 'מחברים את היתרה הנוכחית של כל הלוואה פעילה. הלוואה שסומנה כשולמה במלואה לא נכללת בסכום.',
    source: 'ההלוואות שהוזנו במסך הזה',
    asOf: 'מתעדכן בכל פעם שנכנסים למסך',
  },
  'loans.rowInterestRate': {
    id: 'loans.rowInterestRate',
    title: 'ריבית שנתית',
    explanation: 'זה שיעור הריבית השנתי שנקבע להלוואה הזו, כפי שהוזן ידנית.',
    howComputed: 'זה המספר שהוזן ידנית כריבית השנתית של ההלוואה. הוא לא מחושב מהתשלומים בפועל.',
    source: 'הערך שהוזן ידנית עבור ההלוואה הזו',
    asOf: 'מתעדכן כשהריבית של ההלוואה מתעדכנת ידנית',
  },
  'loans.rowMonthlyPayment': {
    id: 'loans.rowMonthlyPayment',
    title: 'תשלום חודשי',
    explanation: 'זה הסכום שמשולם על ההלוואה הזו כל חודש, לפי מה שהוזן.',
    howComputed: 'זה המספר שהוזן ידנית כתשלום החודשי הקבוע של ההלוואה.',
    source: 'הערך שהוזן ידנית עבור ההלוואה הזו',
    asOf: 'מתעדכן כשהתשלום החודשי של ההלוואה מתעדכן ידנית',
  },
  'loans.payoffProgress': {
    id: 'loans.payoffProgress',
    title: 'כמה נשאר לשלם',
    explanation: 'זה מראה כמה אחוז מההלוואה כבר שולם, וכמה כסף עוד נשאר לשלם עליה.',
    howComputed:
      'לוקחים את הסכום המקורי של ההלוואה, מחסירים ממנו את היתרה שנשארה, ומחשבים כמה אחוז זה מהסכום המקורי, מעוגל למספר השלם הקרוב.',
    source: 'הסכום המקורי והיתרה הנוכחית שהוזנו עבור ההלוואה הזו',
    asOf: 'מתעדכן כשהיתרה של ההלוואה מתעדכנת ידנית',
  },
  // Stage 5 Task 6 — insurances.totalPremium/rowPremium/rowCoverageAmount. Same "כל מספר"
  // requirement as accounts/loans: every number InsurancesScreen renders gets its own entry, not
  // just the aggregate total. totalPremium is a DERIVED figure (not a raw stored field) —
  // verified against InsurancesScreen.tsx's own totalPremium computation before writing this
  // copy: filters to status === 'active', divides a yearly premium by 12, sums.
  'insurances.totalPremium': {
    id: 'insurances.totalPremium',
    title: 'סך הפרמיה החודשית',
    explanation: 'זה סך הפרמיה החודשית לכל הפוליסות שרואים ברשימה. פוליסה שנרשמה כשנתית מחולקת ל-12.',
    howComputed:
      'מחשבים כל פוליסה פעילה: פוליסה חודשית נספרת כמו שהיא, ופוליסה שנתית מתחלקת ב-12. מחברים את כל הפוליסות הפעילות יחד. פוליסה שפגה או בוטלה לא נכללת.',
    source: 'הפוליסות שהוזנו במסך הזה',
    asOf: 'מתעדכן בכל פעם שנכנסים למסך',
  },
  'insurances.rowPremium': {
    id: 'insurances.rowPremium',
    title: 'פרמיה',
    explanation: 'זה הסכום ששולם על הפוליסה הזו, לפי התדירות שנבחרה לה — חודשי או שנתי.',
    howComputed: 'זה המספר שהוזן ידנית כפרמיה של הפוליסה, בתדירות שנבחרה. הוא לא מומר כאן לחודשי.',
    source: 'הערך שהוזן ידנית עבור הפוליסה הזו',
    asOf: 'מתעדכן כשהפרמיה של הפוליסה מתעדכנת ידנית',
  },
  'insurances.rowCoverageAmount': {
    id: 'insurances.rowCoverageAmount',
    title: 'סכום כיסוי',
    explanation: 'זה סכום הכיסוי המרבי שהפוליסה מכסה עבור הסעיף הזה, אם הוזן.',
    howComputed: 'זה המספר שהוזן ידנית כסכום הכיסוי לסעיף הזה בפוליסה.',
    source: 'הערך שהוזן ידנית עבור סעיף הכיסוי הזה',
    asOf: 'מתעדכן כשסכום הכיסוי מתעדכן ידנית',
  },
  // Stage 5 Task 7 (FINAL) — recurring.totalMonthly/rowAmount. Same "כל מספר" requirement as
  // accounts/loans/insurances: every number RecurringScreen renders gets its own entry.
  // totalMonthly is a DERIVED figure (not a raw stored field).
  //
  // Fix 1 (ship-blocker, review post-Stage-5): this entry's title/label — "סך ההתחייבות
  // החודשית" — was factually wrong before this fix. The screen used to sum BOTH kinds
  // (income and expense) into this one "obligation" figure: an active recurring salary sat inside
  // a number labeled "monthly obligation" as if it were committed spend. RE-VERIFIED against
  // RecurringScreen.tsx's `totalMonthlyObligation` before writing this copy: filters to
  // status === 'active' AND kind === 'expense' only, sums item.amount. Recurring income now gets
  // its OWN entry (recurring.totalMonthlyIncome, below) rather than being folded in here or
  // silently dropped.
  'recurring.totalMonthly': {
    id: 'recurring.totalMonthly',
    title: 'סך ההתחייבות החודשית',
    explanation:
      'זה סך ההתחייבות החודשית מכל התנועות הקבועות מסוג הוצאה שרואים ברשימה — כמה יירשם אוטומטית כל חודש. תנועות הכנסה קבועות לא נכללות כאן — יש להן מספר נפרד משלהן.',
    howComputed:
      'מחברים את הסכום של כל תנועה קבועה מסוג "הוצאה" שהסטטוס שלה "פעילה". תנועת הכנסה, וכן תנועה שמושהית או שהסתיימה, לא נכללות בסכום.',
    source: 'התנועות הקבועות מסוג הוצאה שהוזנו במסך הזה',
    asOf: 'מתעדכן בכל פעם שנכנסים למסך',
  },
  // Fix 1 — the income-side figure that used to be silently folded into recurring.totalMonthly
  // above. RE-VERIFIED against RecurringScreen.tsx's `totalMonthlyIncome`: filters to
  // status === 'active' AND kind === 'income' only, sums item.amount.
  'recurring.totalMonthlyIncome': {
    id: 'recurring.totalMonthlyIncome',
    title: 'סך ההכנסה הקבועה החודשית',
    explanation:
      'זה סך ההכנסה החודשית מכל התנועות הקבועות מסוג הכנסה שרואים ברשימה — כמה יירשם אוטומטית כל חודש. זה לא חלק מהסכום המוצג כ"התחייבות חודשית".',
    howComputed:
      'מחברים את הסכום של כל תנועה קבועה מסוג "הכנסה" שהסטטוס שלה "פעילה". תנועת הוצאה, וכן תנועה שמושהית או שהסתיימה, לא נכללות בסכום.',
    source: 'התנועות הקבועות מסוג הכנסה שהוזנו במסך הזה',
    asOf: 'מתעדכן בכל פעם שנכנסים למסך',
  },
  'recurring.rowAmount': {
    id: 'recurring.rowAmount',
    title: 'סכום התנועה הקבועה',
    explanation: 'זה הסכום שנרשם אוטומטית בכל חודש עבור התנועה הקבועה הזו, לפי מה שהוזן.',
    howComputed: 'זה המספר שהוזן ידנית כסכום הקבוע של התנועה הזו. הוא לא מחושב מתנועות שכבר נרשמו בפועל.',
    source: 'הערך שהוזן ידנית עבור התנועה הקבועה הזו',
    asOf: 'מתעדכן כשהסכום של התנועה הקבועה מתעדכן ידנית',
  },
  // Stage 6 Task 8 (D15) — AiSettingsScreen's own numbers. usedThisMonthILS is a DERIVED figure
  // (not a raw stored field) — verified against getAiUsageSummary.ts before writing this copy:
  // for the provider row it comes straight from costGate's own running monthly counter (the SAME
  // number the cost gate enforces the ceiling against); for the byModel row it's summed from this
  // month's ai_usage ledger entries for that specific model.
  // Task 8 review F5 — BOTH entries now disclose that the per-token prices these ₪ figures are
  // derived from are placeholders. registry.ts's own 20-line banner records why (vendor pricing
  // pages blocked or ambiguous); the screen disclosed only the FX half of the conversion, so a
  // reader saw ₪12.47 with no way to know the rate card behind it was never checked.
  'aiSettings.providerSpend': {
    id: 'aiSettings.providerSpend',
    // Batch 9 — THE WORD "ספק" COLLIDES, and the collision is not hypothetical: this app already
    // uses it for the MERCHANT on a transaction (ExtractionReviewModal's row field,
    // CentralExpenseReport's column header) and for the INSURER on a policy (InsurancesScreen).
    // On a screen of ₪ figures, "עלות החודש לספק" reads as "what I paid that business". Fixed at
    // the source — AiSettingsScreen's own <th> and <h2> now say ספק AI too — and the entry now
    // says outright what a ספק AI is NOT, because a suffix alone teaches nobody anything.
    title: 'עלות החודש לספק AI',
    explanation: 'זה כמה כסף עלו קריאות ה-AI לספק ה-AI הזה בחודש הנוכחי. ספק AI הוא החברה שמפעילה את המודל, כמו Anthropic או Google — ולא בית העסק שבו שילמת. הסכום מחושב בדולרים ומומר לשקלים לפי שער החליפין המוצג בעמוד. מחירי המודלים לא אומתו מול ספקי ה-AI, ולכן הסכום הוא הערכה ולא חיוב מדויק.',
    howComputed: 'מחברים את העלות המשוערת של כל קריאת AI לספק ה-AI הזה החודש, ומתקנים אותה לעלות בפועל אחרי שהתשובה מתקבלת.',
    source: 'יומן קריאות ה-AI שנשמר בשרת עבור ספק AI זה',
    asOf: 'מתעדכן בכל פעם שנכנסים למסך',
  },
  'aiSettings.modelSpend': {
    id: 'aiSettings.modelSpend',
    title: 'עלות החודש למודל',
    // Batch 9 — "מודל" WAS NEVER DEFINED ANYWHERE IN THE 25-ENTRY GLOSSARY, while the table this
    // entry explains lists raw ids like claude-sonnet-5. The definition points at the COLUMN
    // rather than naming an example model on purpose: a model id written into the glossary is a
    // fact the registry can retire underneath it, and stale copy is this stage's own signature
    // defect.
    explanation: 'מודל הוא תוכנת ה-AI עצמה שעונה על השאלה, והשם הטכני שלו מופיע בעמודה הראשונה בטבלה. לכל ספק AI יש כמה מודלים, וכל אחד גובה מחיר אחר. זה כמה כסף עלו קריאות ה-AI במודל הזה בחודש הנוכחי. מחירי המודלים לא אומתו מול ספקי ה-AI, ולכן הסכום הוא הערכה ולא חיוב מדויק.',
    // Task 8 review — this said "מחברים את העלות בפועל" (we add up the ACTUAL cost), which
    // overstated: byModel sums ai_usage.amountILS, and that field holds the ESTIMATE until
    // reconcileSpend rewrites it after the answer lands. Its providerSpend sibling, written in the
    // same commit, already described exactly that. Two entries, one number, two stories — aligned.
    howComputed: 'מחברים את העלות המשוערת של כל קריאת AI שהשתמשה במודל הזה החודש, ומתקנים אותה לעלות בפועל אחרי שהתשובה מתקבלת.',
    source: 'יומן קריאות ה-AI שנשמר בשרת עבור מודל זה',
    asOf: 'מתעדכן בכל פעם שנכנסים למסך',
  },
  'aiSettings.ceiling': {
    id: 'aiSettings.ceiling',
    title: 'תקרת AI חודשית',
    // Task 8 review F2 — this entry promised a cap the code did not enforce: the ceiling was one
    // number but was checked against a SEPARATE counter per provider, so four providers could each
    // spend up to it (a real 4x). The gate is now genuinely family-wide, and the wording says so
    // explicitly instead of leaving "the system" ambiguous.
    // Batch 8 (closing review B4) — THE APPROVAL SENTENCE WAS WRITTEN AS THOUGH THE PATH EXISTED.
    //
    // "חריגה ממנו דורשת אישור מפורש של סופר-אדמין" described spec §8, not the code. Only §8's
    // REFUSAL half had shipped, so an overage did not "require approval" — it was simply
    // impossible: no request type carried a token, neither handler passed one, no client wrapper
    // and no UI existed. A glossary entry is this app's promise about what a number MEANS, so this
    // was a promise the code could not keep.
    //
    // The path is real end to end now, so the sentence became true rather than being softened.
    // What is added is WHERE and HOW MUCH: an entry that says approval is required without saying
    // where to get it is still a wall, and "one call at a time" is the fact that keeps "approve"
    // from reading as "turn the ceiling off" (the token is single-use, 120 seconds, and bound to
    // that one call's provider, model and amount).
    explanation: 'זה סכום הכסף המרבי שהמערכת מרשה להוציא על קריאות AI בחודש. זה סכום אחד לכל ספקי ה-AI יחד, ולא תקרה נפרדת לכל ספק AI. חריגה ממנו דורשת אישור מפורש של סופר-אדמין, שניתן במסך הצ׳אט לקריאה אחת בכל פעם. תקרה של 0 חוסמת קריאות AI בתשלום.',
    howComputed: 'זה המספר שהוגדר ידנית על ידי סופר-אדמין, ומולו נמדד סכום ההוצאה של כל ספקי ה-AI יחד באותו חודש.',
    source: 'הערך שהוגדר ידנית במסך הגדרות ה-AI',
    asOf: 'מתעדכן כשהתקרה מעודכנת ידנית',
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // STAGE 7 T7b — THE FORECAST VOCABULARY (§11)
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  //
  // A25 ruled that seventeen was a FLOOR and not a target, and §11 names the real set. Two of v1's
  // seventeen are deliberately absent: a loan repayment reuses `loans.rowMonthlyPayment` and an
  // insurance premium reuses `insurances.rowPremium`, because the forecast figure IS that figure
  // and a second entry describing it would be two stories about one number — the class this
  // glossary already had to fix once between `aiSettings.providerSpend` and `aiSettings.modelSpend`.
  // Where a forecast entry genuinely differs, the difference IS the entire content of the entry.
  //
  // ── !! IN THIS APP, HOVER COPY *IS* A GLOSSARY ENTRY ─────────────────────────────────────────
  //
  // `Explain` renders NOTHING for an unknown id (Explain.tsx:47-53). So a decision that promises
  // "stated in the hover copy" and never writes an entry has promised a hover that does not exist.
  // D10's `planKey` caveat and D23's double-count caveat are both in that position, and both have
  // an id below for exactly that reason.
  //
  // ── AND WHAT IS DELIBERATELY *NOT* HERE ──────────────────────────────────────────────────────
  //
  //  · `forecast.adviceBoundary` — §9 makes the advice-boundary notice PERMANENT ON-SCREEN TEXT,
  //    not hover copy. It lives in `config/adviceBoundary.ts` and is rendered beside the allowance
  //    row, held there by `adviceBoundary.test.ts`'s pairing guard. Stated so nobody adds it here
  //    by reflex.
  //  · Anything describing an INSIGHT-SOURCED assumption (A16). Rules pin client writes to
  //    `source: 'user'`; Stage 8 owns the other half. An entry describing a capability the app
  //    does not have is the defect A16 was caught from the glossary direction.
  //  · `forecast.savedSnapshot` — cut with the `forecasts` collection (D28).

  'forecast.projectedBalance': {
    id: 'forecast.projectedBalance',
    title: 'כמה כסף צפוי להישאר',
    explanation:
      'זה הסכום שצפוי להישאר בחשבונות בסוף החודש האחרון בטווח. הוא מחושב מהיתרה של היום, ועוד ההכנסות פחות ההוצאות של כל חודש בטווח. אם חסר אחד הנתונים, לא מוצג כאן מספר בכלל.',
    howComputed:
      'לוקחים את סך היתרות בחשבונות הפעילים, מוסיפים את ההכנסות של כל חודש ומחסירים את ההוצאות שלו, חודש אחרי חודש.',
    source: 'יתרות החשבונות, הכנסות, הוצאות קבועות, הלוואות, ביטוחים והיסטוריית ההוצאות',
    asOf: 'מתחשב ביתרה שהוזנה לאחרונה בכל חשבון',
  },
  'forecast.openingBalance': {
    id: 'forecast.openingBalance',
    title: 'היתרה שממנה מתחילים',
    explanation:
      'זו נקודת הפתיחה של החישוב. זה סך הכסף שנמצא כרגע בחשבונות הפעילים, לפני שמוסיפים הכנסות או מחסירים הוצאות.',
    howComputed: 'מחברים את היתרה של כל חשבון שסומן פעיל. חשבון בארכיון אינו נספר.',
    source: 'היתרות שהוזנו ידנית במסך החשבונות',
    asOf: 'לפי תאריך העדכון האחרון של כל חשבון',
  },
  'forecast.balanceAsOf': {
    id: 'forecast.balanceAsOf',
    title: 'מתי היתרה עודכנה',
    explanation:
      'זה התאריך שבו עודכנה לאחרונה היתרה הישנה ביותר מבין החשבונות. כל החישוב מתחיל מהמספר הזה, ולכן חשוב לדעת מתי הוא נכון.',
    howComputed: 'לוקחים את תאריך העדכון הישן ביותר מבין החשבונות הפעילים.',
    source: 'שדה תאריך העדכון של כל חשבון במסך החשבונות',
  },
  'forecast.balanceStaleness': {
    id: 'forecast.balanceStaleness',
    title: 'עד כמה היתרה עדכנית',
    explanation:
      'זה שיפוט על התאריך שליד. יתרה שעודכנה החודש נחשבת עדכנית. יתרה בת חודש עד שלושה חודשים מסומנת כישנה, ומעבר לכך כישנה מאוד. יתרה ישנה מזיזה את כל התחזית.',
    howComputed: 'סופרים את הימים מאז העדכון האחרון ומשווים אותם לשני גבולות קבועים במערכת.',
    source: 'תאריך העדכון של החשבון הישן ביותר',
  },
  'forecast.certainTotal': {
    id: 'forecast.certainTotal',
    title: 'כמה כבר סגור',
    explanation:
      'זה החלק בהוצאות שידוע מראש. הוצאות קבועות, החזרי הלוואות, פרמיות ביטוח ותשלומים שכבר נקבעו. זה לא הערכה אלא סכום שנקבע בהסכם.',
    howComputed:
      'מחברים את כל התשלומים הידועים שאמורים לצאת בחודש הזה, לפי התאריכים והסכומים שנרשמו במסכים שלהם.',
    source: 'הוצאות קבועות, הלוואות, ביטוחים ותוכניות תשלומים מתוך ההיסטוריה',
  },
  'forecast.estimatedTotal': {
    id: 'forecast.estimatedTotal',
    title: 'הוצאות משתנות מוערכות',
    explanation:
      'זה החלק בהוצאות שאינו ידוע מראש, כמו קניות ודלק. הוא נאמד לפי מה שהיה בחודשים האחרונים, ולכן הוא הערכה ולא סכום סגור.',
    howComputed:
      'מחשבים ממוצע חודשי לכל קטגוריה לפי החודשים שנקראו, בלי תנועות שנוצרו מהוצאה קבועה, ומחילים אותו על כל חודש בטווח.',
    source: 'תנועות ההוצאות מהחשבונות שסונכרנו למערכת',
  },
  'forecast.bandHigh': {
    id: 'forecast.bandHigh',
    title: 'הכי יקר שהיה',
    explanation:
      'זה החודש היקר ביותר שנצפה בפועל בקטגוריות המשתנות, מתוך החודשים שנקראו. זה לא תחזית לרעה אלא מספר שכבר קרה.',
    howComputed: 'לוקחים את הסכום החודשי הגבוה ביותר מבין החודשים שנקראו בכל קטגוריה ומחברים אותם.',
    source: 'תנועות ההוצאות של החודשים שנקראו',
  },
  'forecast.bandMid': {
    id: 'forecast.bandMid',
    title: 'האמצע',
    explanation:
      'זה הערך האמצעי מבין החודשים שנצפו. חצי מהחודשים היו מתחתיו וחצי מעליו. הוא פחות מושפע מחודש חריג אחד מאשר ממוצע.',
    howComputed: 'מסדרים את הסכומים החודשיים של כל קטגוריה ולוקחים את הערך האמצעי.',
    source: 'תנועות ההוצאות של החודשים שנקראו',
  },
  'forecast.bandLow': {
    id: 'forecast.bandLow',
    title: 'הכי זול שהיה',
    explanation:
      'זה החודש הזול ביותר שנצפה בפועל בקטגוריות המשתנות, מתוך החודשים שנקראו. גם הוא מספר שכבר קרה ולא תרחיש.',
    howComputed: 'לוקחים את הסכום החודשי הנמוך ביותר מבין החודשים שנקראו בכל קטגוריה ומחברים אותם.',
    source: 'תנועות ההוצאות של החודשים שנקראו',
  },
  'forecast.monthIncome': {
    id: 'forecast.monthIncome',
    title: 'הכנסה בחודש',
    explanation:
      'זה סך הכסף שאמור להיכנס בחודש הזה. נספרות רק הכנסות שהמערכת יודעת עליהן מראש. אם אין כאלה, לא מוצג מספר.',
    howComputed: 'מחברים את ההכנסות הקבועות שרשומות למשפחה ואמורות להיכנס בחודש הזה.',
    source: 'רשימת ההכנסות וההכנסות הקבועות',
  },
  'forecast.monthExpense': {
    id: 'forecast.monthExpense',
    title: 'הוצאה בחודש',
    explanation:
      'זה סך הכסף שאמור לצאת בחודש הזה. הוא מורכב משני חלקים, החלק שכבר סגור והחלק המוערך מההיסטוריה.',
    howComputed: 'מחברים את התשלומים הידועים של החודש ואת ההערכה של ההוצאות המשתנות שלו.',
    source: 'הוצאות קבועות, הלוואות, ביטוחים, תשלומים והיסטוריית ההוצאות',
  },
  'forecast.historyDepth': {
    id: 'forecast.historyDepth',
    title: 'כמה חודשים נקראו',
    explanation:
      'זה מספר החודשים שהיו בהיסטוריה ושימשו להערכה. פחות משלושה חודשים אינם מספיקים כדי להראות טווח, ולכן הטווח לא מצויר.',
    howComputed: 'סופרים את החודשים שבהם נצפתה הוצאה בקטגוריה החלשה ביותר מבין הקטגוריות שנספרו.',
    source: 'תנועות ההוצאות שסומנו בחודש שלהן',
  },
  'forecast.monthConfidence': {
    id: 'forecast.monthConfidence',
    title: 'עד כמה החודש מבוסס',
    explanation:
      'זה סימון שאומר על מה נשען המספר של החודש. חודש שרובו תשלומים סגורים מבוסס היטב גם עם היסטוריה קצרה. חודש עם היסטוריה ארוכה מבוסס גם אם מעט בו סגור.',
    howComputed: 'בודקים כמה חודשים נקראו וכמה מההוצאה של החודש כבר סגורה, ודי באחד מהשניים כדי לקבל סימון גבוה יותר.',
    source: 'היסטוריית ההוצאות והתשלומים הידועים של אותו חודש',
  },
  'forecast.horizon': {
    id: 'forecast.horizon',
    title: 'טווח התחזית',
    explanation:
      'זה מספר החודשים קדימה שהמסך מחשב. ברירת המחדל היא שלושה חודשים. הטווח שייך למסך הזה בלבד ואינו משנה מסכים אחרים.',
    howComputed: 'סופרים חודשים קדימה מהחודש שממנו מתחילה התחזית, לפי הבחירה בכפתורי הטווח.',
    source: 'הבחירה בכפתורי הטווח שבראש המסך',
  },
  'forecast.anchorClamp': {
    id: 'forecast.anchorClamp',
    title: 'למה התחזית מתחילה מהחודש הנוכחי',
    explanation:
      'בורר החודש שלמעלה יכול להצביע על חודש שכבר עבר. חודש שעבר אינו נחזה אחורה, ולכן התחזית מתחילה תמיד מהחודש הנוכחי לכל המאוחר.',
    howComputed: 'משווים את החודש שנבחר לחודש הנוכחי ולוקחים את המאוחר מביניהם.',
    source: 'בורר החודש שבסרגל הפילטרים',
  },
  'forecast.seasonalAdjustment': {
    id: 'forecast.seasonalAdjustment',
    title: 'התאמה עונתית',
    explanation:
      'יש חודשים שיקרים או זולים מהרגיל באופן קבוע, כמו ספטמבר או ניסן. התאמה עונתית מזיזה את ההערכה של אותו חודש למעלה או למטה.',
    howComputed:
      'משווים את החודשים הדומים בהיסטוריה לשאר החודשים. נדרשים לפחות שני חודשים דומים, אחרת לא מוחלת שום התאמה.',
    source: 'היסטוריית ההוצאות, או סכום שנקבע ידנית ואושר על ידי בן משפחה',
  },
  'forecast.installmentsCommitted': {
    id: 'forecast.installmentsCommitted',
    title: 'תשלומים שנותרו',
    explanation:
      'כשקנייה מחולקת לתשלומים, התשלומים שעוד לא נגבו ידועים מראש. הם נספרים כחלק הסגור של החודש ולא כהערכה.',
    howComputed:
      'מזהים בכל תוכנית את מספר התשלום הגבוה ביותר שכבר נצפה, ומוסיפים את התשלומים שאחריו עד סוף הטווח.',
    source: 'שורות התשלומים בהיסטוריית ההוצאות',
  },
  'forecast.installmentPlanKey': {
    id: 'forecast.installmentPlanKey',
    title: 'איך מזהים תוכנית תשלומים',
    explanation:
      'לתשלומים אין מספר תוכנית בנתונים. הזיהוי נעשה לפי בית העסק, מספר התשלומים והסכום. שתי תוכניות זהות באותו בית עסק ייספרו כתוכנית אחת.',
    howComputed: 'מרכיבים מפתח משלושת השדות האלה וקושרים אליו כל שורה שמתאימה לו.',
    source: 'שדות בית העסק, מספר התשלום והסכום בשורות שיובאו',
  },
  'forecast.doubleCountCaveat': {
    id: 'forecast.doubleCountCaveat',
    title: 'למה תשלום עלול להיספר פעמיים',
    explanation:
      'החזר הלוואה או פרמיית ביטוח יוצאים גם כשורה רגילה בחשבון. אין בשורה סימן שמאפשר לזהות אותה, ולכן ייתכן שהיא נספרת גם בהערכת ההוצאות המשתנות.',
    howComputed:
      'התשלום הידוע נלקח ממסך ההלוואות או הביטוחים, ואילו ההערכה נלקחת מהתנועות בחשבון. אין קשר בין השניים בנתונים.',
    source: 'מסכי ההלוואות והביטוחים מול תנועות החשבון',
  },
  'forecast.instalmentDoubleCount': {
    id: 'forecast.instalmentDoubleCount',
    title: 'למה הערכת ההוצאות עשויה להיות גבוהה',
    explanation:
      'תשלומים שכבר נגבו נכללים בממוצע ההוצאות המשתנות. במקביל התשלומים שנותרו מוצגים בנפרד כתשלום ידוע. לכן ההערכה של החלק המשתנה עשויה להיות גבוהה מעט.',
    howComputed:
      'הממוצע נלקח מכל התנועות של החודשים שנקראו, למעט תנועות שנוצרו מהוצאה קבועה. תנועות תשלומים אינן מוחרגות ממנו.',
    source: 'שורות התשלומים בהיסטוריית ההוצאות',
  },
  'forecast.categoryAllowance': {
    id: 'forecast.categoryAllowance',
    title: 'כמה נשאר לקטגוריה',
    explanation:
      'זה הסכום שנשאר לקטגוריה בתקופה אם רוצים לעמוד ביעד. הוא חלוקה יחסית של הפער בין הקטגוריות המשתנות, לפי הגודל שלהן.',
    howComputed:
      'מחשבים את הפער מול היעד, מחלקים אותו בין הקטגוריות המשתנות לפי חלקן בהוצאה, ומחסירים מכל אחת את חלקה.',
    source: 'ההערכה של ההוצאות המשתנות מול היעד שנקרא',
  },
  'forecast.shortfall': {
    id: 'forecast.shortfall',
    title: 'הפער מול היעד',
    explanation:
      'זה ההפרש בין היעד לבין מה שצפוי להיחסך בתקופה. פער חיובי אומר שחסר כסף כדי להגיע ליעד בזמן.',
    howComputed: 'מחסירים מהיעד את ההכנסות פחות ההוצאות של כל חודשי הטווח יחד.',
    source: 'היעד שנקרא, מול ההכנסות וההוצאות של הטווח',
  },
  'forecast.unreachableTarget': {
    id: 'forecast.unreachableTarget',
    title: 'יעד שלא ניתן להגיע אליו בטווח',
    explanation:
      'לפעמים הפער גדול מכל ההוצאות המשתנות של התקופה. במצב כזה גם ויתור מלא עליהן לא סוגר אותו, ולכן לא מוצגת חלוקה בין קטגוריות.',
    howComputed: 'משווים את הפער לסך ההוצאות המשתנות שניתן לצמצם, ומציגים את ההפרש שנשאר.',
    source: 'היעד שנקרא, מול ההערכה של ההוצאות המשתנות',
  },
  'forecast.targetSource': {
    id: 'forecast.targetSource',
    title: 'מאיפה נלקח היעד',
    explanation:
      'יעד יכול להגיע משני מקומות. יעד אישי שנקבע במסך הזה, או יעד חיסכון משפחתי מרשימת היעדים. יעד משפחתי מסומן ככזה כדי שלא ייקרא כיעד אישי.',
    howComputed: 'מעדיפים יעד אישי אם קיים לתקופה. אחרת מחברים את היתרה שנותרה בכל יעד משפחתי שמועדו בטווח.',
    source: 'סכומים שנקבעו ידנית ורשימת יעדי החיסכון',
  },
  'forecast.personalTarget': {
    id: 'forecast.personalTarget',
    title: 'יעד אישי',
    explanation:
      'זה יעד חיסכון ששייך לבן משפחה אחד ולא למשפחה כולה. הוא מאפשר לבן משפחה לראות תשובה משלו במקום סירוב.',
    howComputed: 'לוקחים את הסכום שנקבע ידנית ליעד האישי שתוקפו חל על הטווח שנבחר.',
    source: 'סכום שנקבע ידנית ושייך לבן המשפחה המחובר',
  },
  'forecast.assumptionOverride': {
    id: 'forecast.assumptionOverride',
    title: 'סכום שנקבע ידנית במקום החישוב',
    explanation:
      'אפשר לקבוע סכום ידנית לקטגוריה ולחודש. סכום כזה גובר גם על ההערכה מההיסטוריה וגם על תשלום שהיה ידוע מראש. שני המספרים מוצגים זה לצד זה.',
    howComputed:
      'כשיש כמה סכומים ידניים לאותה קטגוריה ולאותו חודש, נבחר האחרון שנשמר. השאר נשמרים ומוצגים כמה הוחלף.',
    source: 'סכומים שנקבעו ידנית על ידי בני המשפחה',
    asOf: 'לפי מועד השמירה האחרון של כל סכום',
  },
  'forecast.balanceSuppressed': {
    id: 'forecast.balanceSuppressed',
    title: 'למה לא מוצג מספר',
    explanation:
      'כשחסר אחד הנתונים שהיתרה מחושבת מהם, לא מוצג כאן שום סכום. אפס היה נקרא כאילו אין כסף, וזו אמירה על המשפחה ולא על הנתונים.',
    howComputed: 'בודקים כל אחד מהנתונים הדרושים. די בכך שאחד מהם חסר או חסום כדי שלא יוצג מספר.',
    source: 'מצב הקריאה של כל אחד מהנתונים שהתחזית מחושבת מהם',
  },
  'forecast.unusableRows': {
    id: 'forecast.unusableRows',
    title: 'שורות שלא ניתן היה לקרוא',
    explanation:
      'אלה שורות הוצאה שהתאריך שלהן לא ניתן לקריאה, ולכן אינן משתתפות בשום הערכה. המספר הזה הוא על כל ההיסטוריה, לא רק על הטווח שנבחר. שינוי הטווח אינו משנה אותו.',
    howComputed: 'סופרים את השורות שסומנו כשורות שתאריכן אינו ניתן לקריאה בעת סימון החודשים.',
    source: 'תנועות ההוצאות שסימון החודש שלהן נכשל',
  },
  'forecast.gapNoHistory': {
    id: 'forecast.gapNoHistory',
    title: 'הסימן במקום הערכה',
    explanation:
      'כשאין היסטוריה להעריך ממנה, החודש מסומן בסימן שאלה במקום בעמודה. הסימן זהה בכל חודש כזה ואינו מייצג סכום. אפס היה נקרא כאילו לא צפויה הוצאה.',
    howComputed: 'החלק הסגור של החודש מצויר בגובהו האמיתי, והחלק המשתנה מוחלף בסימן קבוע.',
    source: 'היסטוריית ההוצאות, כשאין בה חודשים שנקראו',
  },
  // !! T7b-review F7 — THE THIRTIETH FORECAST ENTRY, AND WHY IT IS AN ENTRY AT ALL. The figure it
  // explains already shipped, bare and unlabelled, under the month list. It is the top of the
  // chart's value scale, and the reflex on meeting an unexplained number is to delete it — but the
  // chart is `aria-hidden` by the declared D39 departure, so its axis ticks reach nobody, and this
  // line is the only place the scale exists in text. A figure that stays has to say what it is.
  // §11 named 28 entries and T7b shipped 29; this is the stated reason for the thirtieth.
  'forecast.axisMax': {
    id: 'forecast.axisMax',
    title: 'הגובה המלא של התרשים',
    explanation:
      'זהו הגובה שאליו מגיעה העמודה הגבוהה ביותר בתרשים. אין זה סכום שיצא ואין זה סך הכל של התקופה — זו רק המידה שלפיה מצוירות כל העמודות.',
    howComputed:
      'לוקחים מכל חודש את הגבוה מבין העמודה השלמה וקצה הטווח העליון, ובוחרים את הגדול מביניהם.',
    source: 'החודשים שבטווח שנבחר',
  },
};

export function getGlossaryEntry(id: string): GlossaryEntry | null {
  return GLOSSARY[id] ?? null;
}
