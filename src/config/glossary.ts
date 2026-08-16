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
};

export function getGlossaryEntry(id: string): GlossaryEntry | null {
  return GLOSSARY[id] ?? null;
}
