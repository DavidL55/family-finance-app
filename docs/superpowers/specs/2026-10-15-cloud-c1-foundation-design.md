# המערכת בענן — שיתוף חי לדויד, לילית ולכל מי שיוזמן (C1: תשתית)

**סטטוס:** אושר ע"י דויד (15.10), בתנאי **₪0 — הכול חינמי** · **תאריך:** 15.10.2026 · **מחליף בפועל:** "מצב חי" מקומי כמקור האמת (`2026-08-29-real-family-data-import-design.md`) — האמולטור נשאר לפיתוח ודמו בלבד.
**הכרעות שהתקבלו בשיחה (15.10):** שיתוף של **המערכת כולה**, חי, עם **עריכה** → הענן הוא מקור האמת היחיד · **קודם הענן (C1–C3), אחר כך Stage 9 S2** · כניסה: **Google + אימייל/סיסמה** · אזור: **`me-west1` (תל אביב)** · שיוך זהות: **רשימת הזמנות** · ביטול גישה: **מיידי** · **תוכנית Spark בלבד — בלי כרטיס אשראי, בלי Cloud Functions, בלי שירות בתשלום** · **תכונות AI באפליקציה (צ'אט, חילוץ מסמך שמועלה) לא זמינות בענן** (דויד, 15.10: "א").

## 1. מטרה ולא‑מטרות

**מטרה.** דויד, לילית וכל אדם שדויד מזמין נכנסים למערכת מכל מכשיר, רואים ועורכים בדיוק מה שההרשאות שלהם מתירות, ודויד יכול לבטל גישה בכל רגע — והביטול חל בבקשה הבאה. **עלות: ₪0.**

**מדדי הצלחה.** (1) *זהות:* 0 משתמשים עם גישה בלי מסמך `access` תקף — נאכף ב‑rules ובטסט. (2) *ביטול:* משתמש שבוטל נחסם בבקשה הראשונה אחרי הביטול. (3) *שלמות המעבר (C2):* כל אוסף בענן זהה לאמולטור — ספירה ו‑Σסכומים עד ₪0.01. (4) *שום אובדן:* גיבוי ענן→מק עובד **לפני** שהנתון האמיתי הראשון עולה. (5) *עלות:* הפרויקט נשאר על Spark; אין חשבון חיוב מקושר.

**לא‑מטרות.** Cloud Functions מכל סוג (דורשות Blaze) · תכונות AI בענן — הכפתורים מוסתרים ב‑build של prod (`VITE_AI_ENABLED` כבוי); חזרה ל‑AI = החלטה חדשה על עלות · גיבוי מתוזמן מנוהל / PITR (דורשים חיוב) · קישורי צפייה אנונימיים · דומיין מותאם (`*.web.app`) · Storage (לא בשימוש) · שינוי במטריצת ההרשאות.

**מכסות Spark (ליום):** 50K קריאות · 20K כתיבות · 20K מחיקות · 1GB אחסון · Hosting 10GB/360MB ליום. שימוש משפחתי רחוק מהן; שני מקומות שצריכים תשומת לב — העברת C2 (צריך לפצל אם > 20K מסמכים) והגיבוי (§6.2, פעם ביום לכל היותר).

## 2. פירוק — ארבעה תת‑פרויקטים, כל אחד נסגר לבד

| # | תת‑פרויקט | "גמור" |
|---|---|---|
| **C1** | תשתית (הספק הזה): פרויקט Spark, אזור, כניסה, הזמנות ו‑`access`, rules, App Check, גיבוי ענן→מק | §8 |
| **C2** | העברת `family-data/live-db` לענן: העתקה חד‑פעמית (Admin SDK + ADC, בתוך מכסת הכתיבות היומית), אימות ספירה+Σ לכל אוסף, cutover | כל אוסף זהה עד ₪0.01; יתרות המשותף/לילית תואמות |
| **C3** | הצינור כותב לענן: `ingest_bank`, `inject.py`, `ingest_cal`, כפתור הסנכרון — דרך ADC של דויד (בלי קובץ מפתח), dry‑run + גיבוי לפני כל כתיבה | סנכרון חודשי מלא מול הענן; ריצה כפולה = 0 כתיבות |
| **C4** | מסך שיתוף ב"ניהול משפחה והרשאות": הזמנה לפי מייל (בן משפחה קיים או אורח חדש), הרשאות, רשימת גישות, ביטול | לילית נכנסת ועורכת; אורח רואה רק מה שהותר; ביטול מנתק מיד |

סדר: C1 → C2 → C3; C4 במקביל ל‑C3. **Stage 9 S2** ממתין לסיום C3. ממצאי S2 (15.10): רק ל‑4989 יש מקור "חיובים קרובים" (`excelNewBank`); מהמשותף יורדים גם מקס ×2 ו"פרימיום אקספרס" (1534); השאלה "הערכה מסומנת מול קפדני" פתוחה לספק S2.

## 3. פרויקט, אזור, פריסה

- **פרויקט:** `family-finance-app-c9aa4` (ה‑`.env` כבר מכוון אליו). שלב 0 בתוכנית: לאמת שהוא קיים ושהוא **על Spark בלי חשבון חיוב**; אם לא קיים — יוצרים פרויקט חדש על Spark ומעדכנים `.firebaserc`+`.env`.
- **אזור:** Firestore `(default)` ב‑`me-west1`.
- **מה נפרס:** `firestore:rules`, `firestore:indexes`, `hosting` — **לא** `functions` (נשארות בקוד לאמולטור; `firebase.json` לא משתנה, הפריסה תמיד עם `--only`).
- **סדר:** (1) יצירת מסד ב‑`me-west1` · (2) `firestore:rules` · (3) `firestore:indexes` · (4) `hosting`. כל פקודה עם `--project` מפורש, באישור דויד אחת‑אחת.
- **חזרה לאחור:** Hosting — גרסה קודמת בקונסול · Rules — ruleset קודם. תג `deploy/c1-YYYYMMDD` לכל פריסה.

## 4. כניסה וזהות — בלי claims, בלי פונקציות

### 4.1 שיטות כניסה
Google (`signInWithPopup`) + אימייל/סיסמה (קיים; הרשמה עצמית למי שהוזמן + `sendEmailVerification`). email enumeration protection דולק. מדיניות סיסמה ≥10 תווים — אם היא דורשת Identity Platform (בתשלום), נאכפת בטופס ההרשמה בלבד. **שיוך רק למייל מאומת** (`email_verified`; Google תמיד מאומת).

### 4.2 מודל נתונים
```ts
// invites/{emailLower}
interface Invite { email: string; memberId: string; role: 'super-admin' | 'parent' | 'member';
  createdBy: string; createdAt: Timestamp; expiresAt: Timestamp;   // ברירת מחדל 14 יום
  usedBy?: string; usedAt?: Timestamp; }
// access/{uid} — מקור האמת לתפקיד ולבן המשפחה. מחליף את ה‑custom claims.
interface Access { uid: string; memberId: string; role: Invite['role']; email: string;
  grantedAt: Timestamp; grantedVia: string /* invite id או 'bootstrap' */; }
```

### 4.3 פדיון הזמנה — בדפדפן, נאכף ב‑rules
משתמש מחובר בלי `access` רואה את מסך "לא משויך" עם כפתור "יש לי הזמנה". הלקוח קורא את `invites/{email-שלו}` ומבצע **batch אחד**: `update` להזמנה (`usedBy=uid, usedAt=request.time`) + `create` ל‑`access/{uid}` עם `memberId/role` מההזמנה. ה‑rules (§5) מאשרים רק אם: המייל מאומת ותואם למזהה ההזמנה · ההזמנה לא פגה ולא נוצלה · `access` החדש תואם להזמנה בדיוק · שתי הכתיבות באותו batch (`getAfter`/`existsAfter`). אין קוד שרת — הגבול הוא ה‑rules.

### 4.4 ביטול
super‑admin מוחק `access/{uid}` (ב‑C1 בסקריפט או בקונסול; ב‑C4 בכפתור). חל מיד, כי כל בדיקה קוראת את המסמך. רישום ב‑`audit_log` מהלקוח באותו batch.

### 4.5 bootstrap
`scripts/cloud/bootstrap-owner.ts` רץ פעם אחת מהמק עם ADC (`gcloud auth application-default login`), Admin SDK, ויוצר `access/{uid-של-דויד}` עם `super-admin` ו‑`members/david-levy` אם חסר. מסרב לרוץ אם קיים super‑admin. אין קובץ service‑account על הדיסק.

## 5. Rules — התפקיד נקרא מ‑`access`, לא מהטוקן
```
function myAccess() { return get(/databases/$(database)/documents/access/$(request.auth.uid)).data; }
function hasAccess() { return isSignedIn() && exists(/databases/$(database)/documents/access/$(request.auth.uid)); }
function role()      { return myAccess().role; }
function memberId()  { return myAccess().memberId; }
// isSignedIn/hasRole/isSuperAdmin/isParent נשארים בשמם; hasRole/isSuperAdmin/isParent דורשים hasAccess().
```
- כל `match` קיים ממשיך לקרוא ל‑`role()`/`memberId()` — אף `match` לא נערך; רק מקור הערך משתנה.
- `invites/{email}`: `get` — רק המוזמן (`request.auth.token.email.lower() == email && email_verified`) או super‑admin · `create/delete` — super‑admin · `update` — רק פדיון לפי §4.3 · `list` — super‑admin.
- `access/{uid}`: `get` — בעליו או super‑admin · `create` — פדיון לפי §4.3, או super‑admin · `update` — super‑admin (שינוי תפקיד) · `delete` — super‑admin · `list` — super‑admin.
- **מגבלת rules:** עד 10 קריאות `get/exists` לבקשה; קריאות לאותו מסמך נשמרות ב‑cache. טסט על ה‑rule המורכב ביותר (`transaction_lines` עם `myLevel`) מוודא שלא עוברים.
- **האמולטור יורש את אותם rules, ומצב חי הוא מקור האמת עד C2.** באותו קומיט: `bootstrap-live.ts --ensure-access` אידמפוטנטי כותב `access/{uid}` לכל משתמש באמולטור לפי ה‑claims הקיימים שלו, ו‑`start-live.sh` מריץ אותו **בכל הפעלה**. `provision-auth-users.ts` (דמו) כותב `access` גם הוא. בלי זה המשפחה ננעלת ברגע המיזוג.

## 6. הגנות

### 6.1 בענן
- **App Check:** reCAPTCHA v3 (חינמי), נאכף על Firestore מהיום הראשון. פיתוח: debug token מ‑`.env.local`. CSP מורחב לדומייני reCAPTCHA; `hostingCsp.test.ts` מתעדכן.
- **בלי מפתחות בבאנדל:** `VITE_GEMINI_API_KEY` (לא בשימוש) יוצא מ‑`.env`; טסט build — אין `AIza…`/`sk-…` בבאנדל. מפתח ה‑Firebase web config הוא ציבורי מטבעו; ההגנה היא rules + App Check.
- **Audit:** הזמנה, פדיון, ביטול → `audit_log`.
- **OAuth של Drive:** דומיין ה‑prod נוסף ל‑Authorized JavaScript origins (דויד, Cloud Console).
- **האמולטור לעולם לא נחשף לרשת.**

### 6.2 גיבוי — מהענן אל המק, בחינם
`scripts/cloud/backup-prod.ts` (Admin SDK + ADC) קורא את כל האוספים ושומר JSON ל‑`family-data/backups/cloud-<YYYYMMDD>.json`; שומר 30 אחרונים. **פעם ביום לכל היותר** (אם קיים קובץ של היום — מדלג), כדי לשמור על מכסת הקריאות. רץ מכפתור שולחן העבודה, בשלב 0. שחזור: `scripts/cloud/restore-prod.ts --from <file>` עם dry‑run ואישור. **חייב לעבוד ולהיבדק (גיבוי + שחזור לפרויקט ריק/אמולטור) לפני C2.**

## 7. טסטים
- **תנאי מקדים:** `test:rules` עובר לפורט ייעודי (לא 8080) — הרצת טסטים לעולם לא נוגעת ב‑DB החי. (סוגר את סעיף 1 בהאנדאובר 11.10.)
- **Rules — זהות:** בלי `access` → נחסם בכל אוסף · claims בטוקן בלי `access` → נחסם (ה‑claims כבר לא קובעים) · `access` לא כתיב ע"י member על אחר.
- **Rules — פדיון:** הצלחה · מייל לא מאומת · מייל אחר · הזמנה פגה · הזמנה מנוצלת · `access` עם תפקיד גבוה מההזמנה · `access` בלי עדכון ההזמנה באותו batch · יצירת `access` למשתמש אחר — כל אלה נדחים חוץ מהראשון.
- **Rules — ביטול:** אחרי מחיקת `access` הבקשה הבאה נחסמת. כל הטסטים הקיימים עוברים (פיקסצ'רים מקבלים `access`).
- **Client (vitest):** `useAuthSession` קורא תפקיד מ‑`access` · מסך "לא משויך" → פדיון → המערכת נטענת · ב‑build של prod כפתורי AI לא מרונדרים.
- **סקריפטים:** `--ensure-access` פעמיים = 0 כתיבות · `backup-prod` מדלג כשיש גיבוי של היום · `restore-prod` dry‑run לא כותב.

## 8. "גמור" ל‑C1 (ב‑prod, מאומת)
1. דויד נכנס מהטלפון עם Google ורואה מערכת ריקה כ‑super‑admin.
2. חשבון Google שני, מוזמן כ‑`member` לבן משפחה קיים עם הרשאות מוגבלות (למשל `omer-levy`), פודה את ההזמנה ורואה רק מה שמותר.
3. אחרי מחיקת ה‑`access` שלו — נחסם בבקשה הבאה.
4. `backup-prod` יוצר קובץ, ו‑`restore-prod` משחזר אותו לאמולטור זהה.
5. App Check: בקשות verified; 0 שגיאות CSP; אין כפתורי AI.
6. מצב חי המקומי ממשיך לעבוד אחרי המיזוג (5 בני המשפחה נכנסים).
7. הקונסול מראה Spark, בלי חשבון חיוב.

## 9. מה נדרש מדויד
`firebase login --reauth` · `gcloud auth application-default login` · אישור כל פקודת prod · מקור OAuth של Drive · חשבון Google שני לבדיקה. **לא** נדרש: כרטיס אשראי, Blaze.

## 10. שאלות פתוחות
אין. קיום הפרויקט ומצב החיוב נבדקים בשלב 0; התוצאה מכריעה רק את מזהה הפרויקט.
