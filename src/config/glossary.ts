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
// dashboard.ecosystem.realEstate carries netWorth.ts's own D5 double-counting caveat verbatim in
// spirit (real estate has no dedicated collection yet; if a mortgage is ALSO recorded separately
// as a loan, the same debt can be counted twice) — per netWorth.ts's header comment instruction
// that Stage 4's hover-explain copy should call this out explicitly.
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
    explanation:
      'זה סך כל הנכסים של המשפחה כפי שהוזנו במסך הנכסים, אחרי שמחסירים את המשכנתא. שימו לב, אם יש גם משכנתא שנרשמה בנפרד כהלוואה, אותו סכום עלול להיספר פעמיים.',
    howComputed:
      'מחברים את כל חמשת מרכיבי האקוסיסטם המשפחתי: כסף מזומן, השקעות, קרנות פנסיה, מטבעות דיגיטליים ונדל"ן, ומחסירים מהסכום את המשכנתא.',
    source: 'הנתונים שהוזנו ידנית במסך הנכסים המשפחתיים, כולל סכום המשכנתא.',
    asOf: 'נכון לתאריך העדכון האחרון שהוזן עבור כל אחד ממרכיבי הסכום.',
  },
  'dashboard.ecosystem.liquid': {
    id: 'dashboard.ecosystem.liquid',
    title: 'כסף מזומן',
    explanation: 'זה כל הכסף שנמצא בחשבונות העובר ושב ובחיסכון, וזמין לשימוש מיידי.',
    howComputed: 'מחברים את היתרות שהוזנו ידנית עבור חשבונות העובר ושב והחיסכון של המשפחה.',
    source: 'הנתון שהוזן ידנית במסך הנכסים המשפחתיים',
    asOf: 'נכון לתאריך העדכון האחרון שהוזן במסך הנכסים',
  },
  'dashboard.ecosystem.investments': {
    id: 'dashboard.ecosystem.investments',
    title: 'השקעות',
    explanation: 'זה השווי הכולל של תיקי ההשקעות של המשפחה, כמו קרנות ומניות.',
    howComputed: 'מחברים את השווי העדכני שדווח עבור כל תיק השקעות שהוזן במערכת.',
    source: 'רשימת ההשקעות שהמשפחה הזינה במערכת',
    asOf: 'נכון לתאריך העדכון האחרון של כל השקעה',
  },
  'dashboard.ecosystem.pensions': {
    id: 'dashboard.ecosystem.pensions',
    title: 'קרנות פנסיה',
    explanation: 'זה הסכום שנצבר עבור בני המשפחה בקרנות הפנסיה שלהם.',
    howComputed: 'מחברים את הסכומים הצבורים שדווחו עבור כל קרן פנסיה של בני המשפחה.',
    source: 'דוחות הפנסיה שהוזנו ידנית במערכת',
    asOf: 'נכון לתאריך הדוח האחרון שהוזן',
  },
  'dashboard.ecosystem.crypto': {
    id: 'dashboard.ecosystem.crypto',
    title: 'מטבעות דיגיטליים',
    explanation: 'זה השווי המוערך של מטבעות דיגיטליים, כמו ביטקוין, שבבעלות המשפחה.',
    howComputed: 'מחברים את הכמות שהוזנה כפול המחיר העדכני של כל מטבע.',
    source: 'השווי העדכני שהוזן ידנית עבור נכסי הקריפטו',
    asOf: 'נכון לרגע עדכון המחיר האחרון שהוזן',
  },
  'dashboard.ecosystem.realEstate': {
    id: 'dashboard.ecosystem.realEstate',
    title: 'נדל"ן',
    explanation:
      'זה השווי המוערך של הנכסים שבבעלות המשפחה, כמו דירה או בית. שימו לב, אם יש גם משכנתא שנרשמה בנפרד כהלוואה, הסכום עלול להיספר פעמיים.',
    howComputed: 'לוקחים את השווי שהוזן ידנית עבור הנדל"ן של המשפחה, בלי לבדוק הלוואות אחרות.',
    source: 'השווי שהוזן ידנית במסך הנכסים המשפחתיים',
    asOf: 'נכון לתאריך העדכון האחרון שהוזן עבור הנדל"ן',
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
};

export function getGlossaryEntry(id: string): GlossaryEntry | null {
  return GLOSSARY[id] ?? null;
}
