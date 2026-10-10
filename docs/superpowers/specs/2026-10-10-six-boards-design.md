# שישה לוחות — כל מספר מסביר את עצמו, כל לוח עונה על שאלה (Stage 9)

**סטטוס:** טיוטה לאישור דויד · **תאריך:** 10.10.2026 · **ממשיך את:** Stage 8 "מבט אחד" (`2026-08-29-glanceable-screens-design.md`) — שלושת הכללים שם נשארים בתוקף, והתוכנית הזו נותנת להם עמוד שדרה.
**הכרעות שהתקבלו בשיחה (10.10):** גישה ג' (רג'יסטרי לוחות + רנדרר אחד) · חמשת הלוחות + השישי כמפורט · המלצות דטרמיניסטיות, לא AI · תנועות קבועות = ציפייה ולא פרסום כשיש להן מקור אמיתי · לשקד וליאור אין לוח משלהם (בתוך לוח המשפחה) · אין הזנה ידנית ב‑v1.

## 1. מטרה ולא‑מטרות

**מטרה.** מסך אחד, בורר לוחות, ובו שישה לוחות. בכל לוח אותם חמישה רבדים — **סטטוס · יתרות · מגמות · עתיד · המלצות** — כאקורדיונים. **כל מספר** (וכל כותרת) מסביר בריחוף ממה הוא מורכב ומאיפה הוא מגיע, ונפתח בלחיצה לפירוק. הלוח השישי (חשבונות הבנק, המשותף בעומק מלא) הוא הראשון שנבנה.

**מדדי הצלחה.** (1) *שלמות הסבר:* 100% מהמספרים בכל לוח עם `explainId` תקף ומקור — נאכף בטסט, לא בסקירה. (2) *דיוק ההמלצה:* המלצת ההעברה למשותף צודקת ±₪500 מול מה שקרה בפועל, שלושה חודשים ברצף. (3) *זמן למבט:* כל לוח נטען עם "סטטוס" פתוח ונקרא בלי גלילה במובייל.

**לא‑מטרות.** צ'אט/תובנות‑AI · הזנה ידנית של עסקאות (עדיין פריט 11 ברודמאפ) · לוחות לשקד/ליאור (אותו מנגנון כמו עומר, אחר כך) · שינוי במסך התחזית המשפחתית (Stage 7 נשאר כמו שהוא; הלוחות צורכים אותו) · גרפים מעבר ל‑sparkline של 12 חודשים.

## 2. הלוחות

| # | `BoardId` | היקף | השאלות שהלוח עונה |
|---|---|---|---|
| 1 | `family` | `{kind:'family'}` | איפה אנחנו החודש מול התקציב ומול שנה שעברה; מה גדל; שווי נקי |
| 2 | `david` | `{kind:'member', memberId:'david-levy'}` | החשבון שלי (305370), הכרטיסים שלי (1527/2190/7691), ההכנסות שלי, מה הוצא עבורי |
| 3 | `lilit` | `{kind:'member', memberId:'lilit-levy'}` | 305362, 1534/3135/4989, משכורת+אלברט+קצבה, מה הוצא עבורה |
| 4 | `omer` | `{kind:'member', memberId:'omer-levy'}` | מה הוצא עבורו (`forMemberId`), קצבת ילדים, חיסכון לכל ילד |
| 5 | `monthly` | `{kind:'household'}` | החודש כזרימה: נכנס → באיזה חשבון → יצא לאן (כרטיסים / הו"ק / מזומן / העברות פנימיות מנוטרלות) |
| 6 | `bank` | `{kind:'account', accountId}` ×3 | לכל חשבון: יתרה היום ומה קרה לה; המשותף בעומק: מי הזרים, מה ירד, מה יורד בקרוב, כמה חסר ועד מתי |

**רבדים בכל לוח** (`SectionLayer`): `status` (3–5 KPI) · `balances` (יתרות/סכומים בפירוק) · `trends` (12 חודשים, sparkline + דלתא) · `future` (עד 90 יום) · `advice` (כללים, §6). לוח שלא רלוונטי לו רובד — לא מציג אותו (לעומר אין `future` ב‑v1).

## 3. הכללים (ירושה מ‑Stage 8 + אחד חדש)

1. **ריחוף = הסבר.** כל מספר עטוף ב‑`<Explain id>` עם ערך ב‑`GLOSSARY` (`title / explanation / howComputed / source / asOf`). במובייל: אייקון ⓘ, לא ריחוף‑בלבד.
2. **לחיצה = פירוק.** כל מספר מורכב ב‑`FigureBreakdown` עם `items` שסכומם = המספר (טסט: הסכום מתכנס, ±₪0.01).
3. **תפריטים = אקורדיונים.** בורר הלוחות למעלה; בתוך הלוח — רובד = אקורדיון; במובייל רק `status` פתוח.
4. **חדש — מקור על כל מספר.** כל `ResolvedFigure` נושא `source: {collection, filter, asOf}`; ה‑Explain מציג אותו ("מתוך 47 שורות bank_lines של 305370 עד 05.10"). מספר בלי מקור לא מרונדר (השומר, §8).

## 4. מודל נתונים — מה משתנה ולמה

מבנה‑על: **לכל עובדה מקור אחד.** דפי כרטיס = הוצאות כרטיס. תנועות עו"ש = הכסף בבנק. תנועות קבועות = ציפייה. זה מה שסוגר את הכפל של 09.10.

### 4.1 `bank_lines` — חדש
```ts
interface BankLine extends OwnedRecord {        // ownerId = בעל החשבון (למשותף: 'david-levy'; לילית קוראת כ-parent)
  id: string;                                   // 'bl-' + sha1(account|date|balance|signedAmount)[:20] — המפתח של merge_ledgers
  accountId: string;                            // 'acc-poalim-joint' | 'acc-poalim-david' | 'acc-poalim-lilit'
  accountNumber: string;                        // '12-559-305397'
  date: string;                                 // ISO
  period: string;                               // 'YYYY-MM' (נגזר, כמו transaction_lines)
  action: string;                               // טקסט הבנק: 'העברה-נייד', 'כרטיסי אשראי ל', 'מכבי' …
  debit: number | null; credit: number | null;
  balance: number;                              // היתרה אחרי התנועה — המקור של "יתרות"
  kind: 'card-charge' | 'standing-order' | 'transfer-internal' | 'transfer-in' | 'cash' | 'fee' | 'income' | 'other';
  counterpartAccountId: string | null;          // ל-transfer-internal: הצד השני (הזוג שזוהה ב-ingest_bank)
  source: string; verified: boolean;            // 'archive/בנק/…xlsx' | PDF; כיוון מאומת משרשרת יתרות
}
```
`kind` נקבע בקליטה מטבלת כללים (`BANK_KIND_RULES` ב‑`ingest_bank.py`: 'כרטיסי אשראי ל'→card-charge, 'משיכה מבנקט'→cash, הו"ק ידועות→standing-order, זוג חובה/זכות בין חשבונותינו→transfer-internal). `accounts` מקבל `accountNumber` (היום בתוך `name`).

### 4.2 בעלות והקצאה — שדות על אוספים קיימים
- `incomes.ownerId`, `incomes.accountId` — מילוי אחורה: יעל תוכנה/אלברט/קצבה → lilit / 305362; מייסדים → david / 305370. `recurring` מקבל `ownerId` ו‑`accountId` גם הוא, והפרסום יורש.
- `transaction_lines.forMemberId: string | null` — "עבור מי". `FOR_MEMBER_RULES` (בית‑עסק מכיל → חבר; לדוגמה 'בית ספר לטניס'→omer-levy), דריסה ידנית מהשורה (שדה קיים `expenseClassification` נשאר ריק — לא משתמשים בו). `null` = משק הבית.
- `recurring.actualsSource: 'card' | 'bank' | 'none'` — הקומפלט (`useRecurringCatchup`) **מפרסם רק כש‑`none`**; `card`/`bank` = ציפייה: משתתפים ב‑`future` ובהמלצות, לא ב‑`transaction_lines`. מיגרציה: 10 הפריטים של 09/2026 שפורסמו — נשארים (מתועדים); מעכשיו לא.

### 4.3 `card_cycles` — חדש, הדלק של "עתיד"
```ts
interface CardCycle { id: string;               // 'cc-cycle-<card>-<YYYY-MM-DD>'
  card: string; chargeDate: string; amountILS: number; accountId: string;   // 4989 → joint
  source: 'statement-next-cycle' | 'future-charge-rows' | 'issuer-export'; asOf: string; }
```
נכתב בסנכרון מ‑`futureCharge` rows (סכום לכרטיס למחזור) ומייצואי "המחזור הבא" (לאומי‑סגנון / `excelNewBank`). אין הזנה ידנית ב‑v1 — כשחסר, הלוח אומר "אין נתון חיוב קרוב ל‑4989" (המלצה R5), לא מנחש.

## 5. הרג'יסטרי והרנדרר

```ts
// src/config/boards.ts — הצהרה בלבד, אפס fetch
type BoardScope = {kind:'family'} | {kind:'household'} | {kind:'member'; memberId:string} | {kind:'account'; accountId:string};
type SectionLayer = 'status'|'balances'|'trends'|'future'|'advice';
type SectionQuery =
  | {kind:'kpi'; metric:'income'|'expense'|'net'|'budgetGap'|'netWorth'; period:'month'|'ytd'}
  | {kind:'accountBalance'} | {kind:'ledger'; months:number; groupBy:'kind'|'action'}
  | {kind:'cardsByMember'} | {kind:'incomesByOwner'} | {kind:'forMember'}
  | {kind:'trend'; metric:string; months:12} | {kind:'projection'; horizonDays:30|60|90}
  | {kind:'advice'; rules: RuleId[]} | {kind:'flow'}  /* לוח 5 */;
interface BoardSection { id:string; layer:SectionLayer; titleHe:string; explainId:string; query:SectionQuery; defaultOpen?:boolean; }
interface BoardDef { id:BoardId; labelHe:string; icon:LucideIcon; scope:BoardScope; sections:BoardSection[]; visibleFor:(role, perms)=>boolean; }
export const BOARDS: readonly BoardDef[];
```
```ts
// src/lib/boards/resolve.ts — טהור ככל האפשר: מקבל readers (כמו ForecastReaders), מחזיר ResolvedSection
interface ResolvedFigure { id:string; explainId:string; value:number|null; items:BreakdownItem[]; source:{collection:string; filter:string; asOf:string|null}; state:'ok'|'empty'|'error'; }
interface ResolvedSection { sectionId:string; figures:ResolvedFigure[]; state:'loading'|'ok'|'empty'|'error'; error?:string; }
```
`BoardScreen` (קומפוננטה אחת, `src/components/BoardScreen.tsx`): בורר לוחות (`sessionStorage ff_board`, fail‑open), רשימת `SectionAccordion`, וכל figure = `<FigureBreakdown figure={<Explain id>…} items>`. **אין** לוגיקה עסקית ברכיב. `MODULE_REGISTRY` מקבל ערך `boards` בקבוצה `daily`; `dashboard` הקיים נשאר עד שלב 3 ואז מפנה ללוח `family`.

**היקף והרשאות.** `scope` מתורגם ל‑`MemberSelection` הקיים ול‑`ownerId` בשאילתות; `visibleFor` משתמש ב‑`isModuleVisible` + בעלות (ילד רואה רק את הלוח שלו ואת `family` אם יש לו `view`). הרנדרר לעולם לא מסנן בעצמו — הסינון בשאילתה וב‑Rules.

## 6. עתיד והמלצות — טהור, נבדק, מוסבר

- `src/lib/accountProjection.ts` — `projectAccount(input): DailyPoint[]`: יתרה אחרונה (`bank_lines`) + `card_cycles` + ציפיות `recurring` (לפי `accountId`, `actualsSource≠none`) + הכנסות צפויות (`recurring.kind='income'`) → נתיב יתרה יומי עד האופק, עם `events[]` מוסברים. אותו דפוס כמו `forecast.ts` (ליבה טהורה, בלי Firestore). התחזית המשפחתית של Stage 7 לא נוגעת.
- `src/lib/advice/rules.ts` — `type Rule = (ctx: AdviceContext) => Advice | null`; `Advice = {ruleId, severity:'info'|'warn'|'act', titleHe, reasonHe, amountILS?, byDate?, sources: ResolvedFigure['source'][]}`.
  - **R1 shortfall** (`bank`, משותף): `min(projection ≤ next inflow) < buffer(₪1,000)` → "העבר ₪X עד D" (X = חסר + buffer, D = יום לפני האירוע הראשון שמוריד מתחת ל‑buffer).
  - **R2 cycleAnomaly**: `card_cycle > 1.3 × median(3 מחזורים אחרונים)` → "חיוב 4989 גבוה ב‑N% מהרגיל — M שורות של ₪500+".
  - **R3 drift** (לכל חשבון): יציאה נטו 30 יום > כניסה → "יורד ₪Z/חודש; בקצב הזה אפס בעוד N חודשים" (305370: ₪42K ב‑5 שבועות).
  - **R4 premiumDrift**: סכום פרמיות החודש מול חציון 3 חודשים > 3% → "ביטוחים עלו ₪W".
  - **R5 dataGap**: כרטיס/חשבון בלי מקור למחזור הסגור האחרון → "חסר דף 4989 ספטמבר — הסנכרון לא שלם" (מחבר את ROUTINE ללוח).
  כל כלל: fixture מחודש אמיתי (מוסווה) + טסט "המלצה/אין המלצה/סף".

## 7. סנכרון (צינור `family-data/tools/statements/`)
`ingest_bank.py` כותב `bank_lines` (idempotent, `--only-new` כמו `inject.py`), מסמן `kind` ו‑`counterpartAccountId`, כותב `card_cycles`, ממשיך לקדם `lastPostedPeriod` (עד שהמיגרציה ל‑`actualsSource` תייתר זאת). `stage_sync.py` לא משתנה. הכפתור לא משתנה. ROUTINE מתעדכן.

## 8. טסטים ושומרים (מה "גמור" אומר)
- **רג'יסטרי:** לכל `BoardSection.explainId` יש `GLOSSARY` entry; לכל `BoardId` יש `visibleFor`; אין שני sections עם אותו id. (vitest, `boards.registry.test.ts`.)
- **פירוק מתכנס:** לכל figure עם items: `Σitems = value ± 0.01` (טסט על resolve עם fixtures).
- **שומר רינדור (S4):** figure בלי `source` או בלי Explain → `renderPresence` נכשל. מדליקים app‑wide בשלב 3.
- **הזרקה:** ריצה כפולה של `ingest_bank.py --apply` = 0 כתיבות חדשות (self-test פייתון).
- **Rules:** `bank_lines`/`card_cycles` — parent/super-admin קוראים הכל; member קורא רק `ownerId == memberId`; ילד בלי `accounts.view` — כלום (firestore-tests).
- **App:** החלפת לוח לא משנה סדר hooks (רגרסיה כמו 09.10): טסט שעובר על כל ששת הלוחות באותו מופע.

## 9. אבטחה (סשה) וגבולות
`bank_lines` ו‑`card_cycles` תחת אותו `canAccessOwnedModule('accounts', …)` כמו `accounts`; `ownerId` immutable; אין שדה חופשי שמגיע מהדפדפן — הכתיבה רק מהצינור (אמולטור, `Bearer owner`). ה‑AI לא נוגע בשום דבר כאן.

## 10. שלבים — כל אחד נסגר לבד
| שלב | תוצר | "גמור" |
|---|---|---|
| **1** | `bank_lines` + `accounts.accountNumber` + rules + `ingest_bank` כותב; לוח `bank` עם `status/balances/trends` למשותף (ואז 2 האחרים) | כל השורות המאומתות של `extracted/bank-ledgers.json` ב‑DB (573 היום); המשותף מציג יתרה=יתרת הבנק האחרונה; כל figure עם Explain+source; הזרקה כפולה = 0 |
| **2** | `card_cycles` + `accountProjection` + R1/R3/R5 על לוח `bank` | R1 מחזיר "העבר ₪X" על נתוני 10.2026 האמיתיים; טסטים לכללים |
| **3** | לוח `family` = הדשבורד הקיים בתבנית 5 הרבדים; השומר app‑wide דולק | 0 figures בלי Explain בכל האפליקציה (Stage 8 S3–S4 נסגרים כאן) |
| **4** | `incomes/recurring.ownerId+accountId`, `actualsSource`, לוחות `david`/`lilit` | פרסום אוטומטי אפס לפריטים עם מקור; לוח לילית מראה משכורת+אלברט+קצבה |
| **5** | `forMemberId` + `FOR_MEMBER_RULES` + לוח `omer` | ≥80% מהוצאות עומר הידועות (טניס, חוגים) מסומנות בכלל, השאר ידני |
| **6** | לוח `monthly` (flow) + R2/R4 | זרימה: Σנכנס − Σיצא − העברות פנימיות = Δיתרות ±₪1 |

## 11. שאלות פתוחות
אין. מה שלא הוכרע למעלה — הוכרע כברירת מחדל ומסומן "v1"; שינוי = עדכון ספק.
