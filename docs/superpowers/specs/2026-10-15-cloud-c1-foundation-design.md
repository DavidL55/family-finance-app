# המערכת בענן — שיתוף חי לדויד, לילית ולכל מי שיוזמן (C1: תשתית)

**סטטוס:** טיוטה לאישור דויד · **תאריך:** 15.10.2026 · **מחליף בפועל:** "מצב חי" מקומי כמקור האמת (`2026-08-29-real-family-data-import-design.md`) — האמולטור נשאר לפיתוח ודמו בלבד.
**הכרעות שהתקבלו בשיחה (15.10):** שיתוף של **המערכת כולה**, חי, עם **עריכה** (לא תמונת מצב, לא צפייה בלבד) → הענן הוא מקור האמת היחיד · **קודם הענן (C1–C3), אחר כך Stage 9 S2** · כניסה: **Google + אימייל/סיסמה** · אזור: **`me-west1` (תל אביב)** · שיוך זהות: **רשימת הזמנות + `claimInvite`** · ביטול גישה: **מיידי** (`access/{uid}` נבדק ב‑rules).

## 1. מטרה ולא‑מטרות

**מטרה.** דויד, לילית וכל אדם שדויד מזמין נכנסים למערכת מכל מכשיר, רואים ועורכים בדיוק מה שההרשאות שלהם מתירות, ודויד יכול לבטל גישה בכל רגע — והביטול חל בבקשה הבאה.

**מדדי הצלחה.** (1) *זהות:* 0 משתמשים עם גישה בלי הזמנה מנוצלת ומסמך `access` פעיל — נאכף ב‑rules ובטסט. (2) *ביטול:* משתמש שבוטל נחסם בבקשה הראשונה אחרי הביטול (טסט rules + אימות ב‑prod). (3) *שלמות המעבר (C2):* כל אוסף בענן זהה לאמולטור — ספירה ו‑Σסכומים עד ₪0.01. (4) *שום אובדן:* גיבוי מתוזמן פעיל **לפני** שהנתון האמיתי הראשון עולה.

**לא‑מטרות.** קישורי צפייה ציבוריים/אנונימיים · אפליקציית מובייל נייטיב · דומיין מותאם (ברירת מחדל `*.web.app`; דומיין = שינוי ספק) · Storage (המערכת לא משתמשת בו; מסמכים יושבים ב‑Firestore) · שינוי במטריצת ההרשאות הקיימת.

## 2. פירוק — ארבעה תת‑פרויקטים, כל אחד נסגר לבד

| # | תת‑פרויקט | "גמור" |
|---|---|---|
| **C1** | תשתית ענן (הספק הזה): פריסה, אזור, כניסה, הזמנות ושיוך, `access`, App Check, Secret Manager, גיבוי | §8 |
| **C2** | העברת `family-data/live-db` לענן: העתקה חד‑פעמית, אימות ספירה+Σ לכל אוסף, cutover. האמולטור → פיתוח/דמו | כל אוסף זהה עד ₪0.01; יתרות המשותף/לילית תואמות |
| **C3** | הצינור כותב לענן: `ingest_bank`, `inject.py`, `ingest_cal`, כפתור הסנכרון — דרך ADC של דויד (בלי קובץ מפתח), dry‑run + גיבוי לפני כל כתיבה | סנכרון חודשי מלא מול הענן; ריצה כפולה = 0 כתיבות |
| **C4** | מסך שיתוף ב"ניהול משפחה והרשאות": הזמנה לפי מייל (בן משפחה קיים או אורח חדש), הרשאות, רשימת גישות, ביטול | לילית נכנסת ועורכת; אורח רואה רק מה שהותר; ביטול מנתק מיד |

סדר: C1 → C2 → C3; C4 במקביל ל‑C3. **Stage 9 S2** (`card_cycles`, `accountProjection`, R1/R3/R5) ממתין לסיום C3 — כדי לא לבנות את הכותב בצינור פעמיים. ממצאי S2 שנאספו (15.10) נשמרים לספק שלו: רק ל‑4989 יש מקור "חיובים קרובים" (`excelNewBank`); מהמשותף יורדים גם מקס ×2 ו"פרימיום אקספרס" (1534); השאלה "הערכה מסומנת מול קפדני" פתוחה.

## 3. פריסה ואזור

- **פרויקט:** `family-finance-app-c9aa4` (ה‑`.env` כבר מכוון אליו; `vite build` תמיד מכוון ל‑prod, אמולטור רק ב‑`DEV && VITE_USE_EMULATOR=1`). שלב 0 של התוכנית מאמת שהפרויקט קיים ב‑GCP ובתוכנית Blaze; אם לא — יוצרים אותו באותו מזהה או מעדכנים `.firebaserc`+`.env` (החלטה בתוכנית, לא כאן).
- **אזור:** Firestore ב‑`me-west1`. Functions: `setGlobalOptions({ region: 'me-west1' })`; הקליינט קורא ל‑`getFunctions(app, 'me-west1')`.
- **סדר פריסה** (כל פקודה עם `--project family-finance-app-c9aa4` מפורש; כל פקודה שמשנה prod — באישור דויד אחת‑אחת):
  1. יצירת מסד Firestore `(default)` ב‑`me-west1`.
  2. גיבוי: לוח יומי (שמירה 7 ימים) + שבועי (14 שבועות); PITR דולק.
  3. `firestore:rules` · 4. `firestore:indexes` · 5. סודות ב‑Secret Manager + `functions` · 6. `hosting`.
- **יחידות פריסה:** rules ו‑indexes לבד; function + הסודות שלה = יחידה אחת.
- **חזרה לאחור:** Hosting — גרסה קודמת בקונסול · Rules — ruleset קודם · Functions — פריסה מחדש מהתג הקודם. כל פריסה מתויגת `deploy/c1-YYYYMMDD`.

## 4. כניסה ושיוך זהות

### 4.1 שיטות כניסה
Google (`signInWithPopup`) + אימייל/סיסמה (הקיים). אימייל/סיסמה: מדיניות סיסמה ≥10 תווים, email enumeration protection דולק, **ושיוך רק למייל מאומת** (`email_verified == true`; Google תמיד מאומת). מסך הכניסה מקבל כפתור Google; מסך "לא משויך" מקבל כפתור "יש לי הזמנה — שייך אותי" שקורא ל‑`claimInvite`, ואז `getIdToken(true)`.

### 4.2 מודל נתונים
```ts
// invites/{emailLower}  — כתיבה: super-admin בלבד (Admin SDK / C4 callable). קריאה מהדפדפן: אין.
interface Invite { email: string; memberId: string; role: 'super-admin' | 'parent' | 'member';
  createdBy: string; createdAt: Timestamp; expiresAt: Timestamp;   // ברירת מחדל: 14 יום
  usedBy?: string; usedAt?: Timestamp; }
// access/{uid}  — כתיבה: רק claimInvite / revokeAccess (Admin SDK). קריאה: המשתמש עצמו (לבדיקת סטטוס).
interface Access { uid: string; memberId: string; role: Invite['role']; email: string;
  grantedAt: Timestamp; grantedVia: string /* invite id */; }
```

### 4.3 `claimInvite` (onCall, `me-west1`, App Check נאכף)
הנקודה **היחידה** שמשייכת claims ב‑prod. בודק: מחובר · `email_verified` · קיימת `invites/{email}` · לא פגה · לא נוצלה · `members/{memberId}` קיים. בטרנזקציה: מסמן `usedBy/usedAt`, כותב `access/{uid}`, `setCustomUserClaims(uid, {role, memberId})`, רושם ב‑`audit_log`. כל כישלון → `HttpsError` עם סיבה בעברית, בלי לחשוף אם הזמנה קיימת למייל אחר.

### 4.4 `revokeAccess` (onCall, super-admin בלבד)
מוחק `access/{uid}`, מנקה claims, `revokeRefreshTokens(uid)`, רושם ב‑`audit_log`. החסימה המיידית באה מ‑§5 — לא מהטוקן.

### 4.5 bootstrap
ה‑super‑admin הראשון (דויד) נוצר פעם אחת בסקריפט `scripts/cloud/bootstrap-owner.ts` שרץ מהמק עם ADC (`gcloud auth application-default login`), כותב `access` + claims, ומסרב לרוץ אם קיים כבר super-admin. אין קובץ service-account על הדיסק. סקריפטי האמולטור (`bootstrap-live.ts`, `provision-auth-users.ts`) לא משתנים ולא נוגעים ב‑prod.

## 5. Rules — בדיקה אחת שכל השאר יורש
```
function hasAccess() {
  return exists(/databases/$(database)/documents/access/$(request.auth.uid))
      && get(/databases/$(database)/documents/access/$(request.auth.uid)).data.memberId == memberId();
}
function hasRole() { return isSignedIn() && role() in ['super-admin','parent','member'] && hasAccess(); }
```
`isSuperAdmin()` ו‑`isParent()` מקבלים `&& hasAccess()` גם הם, כך שכל `match` קיים יורש את הבדיקה דרך שלוש הפונקציות האלה בלבד — אף `match` לא נערך. `invites`: `allow read, write: if false`. `access/{uid}`: `allow get: if request.auth.uid == uid; allow list, write: if false`.

**האמולטור יורש את אותם rules — ומצב חי הוא עדיין מקור האמת עד C2.** לכן, באותו קומיט שמכניס את `hasAccess()`: `bootstrap-live.ts` מקבל מסלול `--ensure-access` אידמפוטנטי שכותב `access/{uid}` לכל משתמש קיים ב‑Auth של האמולטור שיש לו claims (5 בני המשפחה ב‑`live-db`), ו‑`start-live.sh` מריץ אותו **בכל הפעלה** אחרי שהאמולטור עולה (לא רק בהרצה הראשונה). `provision-auth-users.ts` (דמו) כותב `access` גם הוא. בלי זה מצב חי והדמו ננעלים ברגע המיזוג. טסט: הרצה כפולה של `--ensure-access` = 0 כתיבות.

## 6. הגנות
- **App Check:** reCAPTCHA Enterprise, נאכף על Firestore ועל כל ה‑callables (`enforceAppCheck: true`) מהיום הראשון — אין עדיין משתמשים לשבור. פיתוח: debug token מ‑`.env.local` (לא נכנס ל‑git). CSP ב‑`firebase.json` מורחב לדומייני reCAPTCHA, ו‑`hostingCsp.test.ts` מתעדכן.
- **סודות:** `GEMINI_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` → `defineSecret`, קשורים רק לפונקציות שצריכות אותם. `VITE_GEMINI_API_KEY` (לא בשימוש) יוצא מ‑`.env`. טסט build: אף מחרוזת `AIza…`/`sk-…` לא בבאנדל.
- **Audit:** הזמנה, שיוך, ביטול → `audit_log` הקיים.
- **OAuth של Drive:** דומיין ה‑prod מתווסף ל‑Authorized JavaScript origins (פעולה של דויד ב‑Cloud Console).
- **האמולטור לעולם לא נחשף לרשת.** אין בו אימות אמיתי.

## 7. טסטים
- **תנאי מקדים:** `test:rules` עובר לפורט אמולטור ייעודי (לא 8080), כך שהרצת טסטים לעולם לא נוגעת ב‑DB החי. (סוגר את סעיף 1 בהאנדאובר 11.10.)
- **Rules:** claims תקינים בלי `access` → נחסם בכל אוסף · `access` עם `memberId` שונה מה‑claim → נחסם · `invites` לא קריא/כתיב מהדפדפן · `access` לא כתיב, וקריא רק לבעליו · כל הטסטים הקיימים עוברים (עם `access` בפיקסצ'ר).
- **Functions (`test:functions`):** `claimInvite` — לא מחובר / מייל לא מאומת / אין הזמנה / פגה / נוצלה / member לא קיים / הצלחה (claims + `access` + `usedBy` + audit, אטומי). `revokeAccess` — לא super-admin נדחה; הצלחה מוחקת `access`, מנקה claims, מנתקת refresh tokens.
- **Client:** מסך "לא משויך" → `claimInvite` → רענון טוקן → המערכת נטענת (vitest עם mock).

## 8. "גמור" ל‑C1 (ב‑prod, מאומת, לא רק נפרס)
1. דויד נכנס מהטלפון עם Google ורואה מערכת ריקה כ‑super‑admin.
2. חשבון Google שני שהוזמן כ‑`member` וממופה לבן משפחה קיים עם הרשאות מוגבלות (למשל `omer-levy`; אורח חדש = C4) — רואה רק מה שמותר.
7. מצב חי המקומי ממשיך לעבוד אחרי המיזוג (כל 5 בני המשפחה נכנסים; `--ensure-access` רץ).
3. אחרי `revokeAccess` — החשבון השני נחסם בבקשה הבאה (לא אחרי שעה).
4. לוח הגיבויים מופיע ב‑`gcloud firestore backups schedules list`.
5. מדדי App Check: בקשות verified, 0 unverified מהאפליקציה.
6. 0 שגיאות CSP בקונסול הדפדפן; לוגי functions נקיים ב‑5 הדקות הראשונות.

## 9. מה נדרש מדויד
`firebase login --reauth` · תוכנית Blaze בפרויקט · אישור כל פקודת prod · `gcloud auth application-default login` לסקריפט ה‑bootstrap · מקור OAuth של Drive · חשבון Google שני לבדיקה.

## 10. שאלות פתוחות
אין. קיום הפרויקט ב‑GCP נבדק בשלב 0 של התוכנית; התוצאה מכריעה רק את מזהה הפרויקט, לא את העיצוב.
