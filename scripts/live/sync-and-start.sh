#!/bin/zsh
# sync-and-start.sh — the desktop button: sync whatever new statements are in ~/Downloads, then
# open FamilyFinance in LIVE mode. One click does the monthly routine (ROUTINE.md §ב):
#
#   1. Looks in ~/Downloads for sync sources — statement PDFs (<card>_<MM>_<YYYY>.pdf), Drive
#      folders/zips named "השלמת מסמכים*", Hapoalim xlsx exports (30537x_/30536x_/excelNew*),
#      and Cal exports ("פירוט חיובים לכרטיס*.xlsx").
#   2. If any: stages them (family-data/tools/statements/stage_sync.py — placement, deterministic
#      extraction, sum-vs-printed-total validation, ledger merge), prints the validation table,
#      and moves the consumed sources to ~/Downloads/נקלט-<date>/ so they are not seen twice.
#   3. Starts live mode (start-live.sh: backup → emulator with export-on-exit → dev server).
#   4. If something was staged: shows what would be injected and asks before writing — the law
#      of the pipeline is that nothing reaches the DB unseen. Only sum-verified rows are ever
#      offered (inject.py --only-new; ingest_bank.py).
#   5. Stays attached so Ctrl+C in this window saves the DB (export-on-exit), exactly as before.
#
# No sources in Downloads = plain "open the app". The demo ledger is never touched.

set -uo pipefail
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$APP_DIR/family-data/tools/statements"
DL="$HOME/Downloads"
STAMP="$(date +%Y%m%d-%H%M)"
STAGE="$DL/סנכרון-$STAMP"
DONE="$DL/נקלט-$STAMP"

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
# Without a terminal (piped, cron, a smoke test) there is nobody to see the table — answer NO.
ask()  { [ -t 0 ] || { printf '\n(אין טרמינל — "%s" → לא)\n' "$1"; return 1; }
         printf '\n\033[1m%s\033[0m [Enter=כן / n=לא] ' "$1"; read -r a; [[ "${a:-}" != [nN]* ]]; }

cd "$APP_DIR"

# ── 1. Collect sync sources ───────────────────────────────────────────────────────────────────
setopt null_glob
typeset -a SRC
SRC=(
  "$DL"/השלמת\ מסמכים*(N)
  "$DL"/[0-9][0-9][0-9][0-9]_[0-9][0-9]_20[0-9][0-9].pdf(N)
  "$DL"/30537[0-9]_*.xlsx(N) "$DL"/30536[0-9]_*.xlsx(N) "$DL"/excelNew*.xlsx(N)
  "$DL"/עוש*.pdf(N) "$DL"/עוש*.xlsx(N)
)
CAL=( "$DL"/פירוט\ חיובים\ לכרטיס*.xlsx(N) )
SYNCED=0

if (( ${#SRC} + ${#CAL} > 0 )); then
  say "נמצאו מקורות לסנכרון בהורדות:"
  for f in "${SRC[@]}" "${CAL[@]}"; do printf '   • %s\n' "${f:t}"; done
  if ask "להריץ סנכרון על הקבצים האלה?"; then
    mkdir -p "$STAGE" "$DONE"
    for f in "${SRC[@]}"; do
      if [ -d "$f" ]; then cp -R "$f"/. "$STAGE"/; else cp "$f" "$STAGE"/; fi
    done
    if (( ${#SRC} > 0 )); then
      say "שלב א — מיקום, חילוץ ואימות (סכום מול סך מודפס בכל דף)…"
      python3 "$TOOLS/stage_sync.py" "$STAGE" || say "⚠ שלב א נכשל — ראה את הפלט למעלה; ממשיך לפתיחת המערכת בלי הזרקה."
    fi
    if (( ${#CAL} > 0 )); then
      say "שלב ב — ייצואי כאל (xlsx)…"
      python3 "$TOOLS/ingest_cal.py" || say "⚠ קליטת כאל נכשלה — ראה למעלה."
    fi
    # Consumed sources leave Downloads (copies live in family-data now); Cal xlsx were moved by ingest_cal.
    for f in "${SRC[@]}"; do [ -e "$f" ] && mv "$f" "$DONE"/ 2>/dev/null; done
    rm -rf "$STAGE"
    rmdir "$DONE" 2>/dev/null || true
    SYNCED=1
  fi
else
  say "אין קבצים חדשים לסנכרון בהורדות — פותח את המערכת."
fi

# ── 2. Live mode (start-live.sh does backup → emulator → dev server → browser) ─────────────────
LIVE_PID=""
if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  # Port 8080 answers — but is it OUR live emulator? start-live.sh leaves a marker while it runs.
  # Without it, something else (another project's emulator, a test run) holds the port, and the
  # app would silently read the wrong database. Refuse, and say exactly what is in the way.
  if [ ! -f "$APP_DIR/family-data/logs/live.mode" ]; then
    HOLDER="$(lsof -nP -iTCP:8080 -sTCP:LISTEN | awk 'NR==2{print $1" (pid "$2")"}')"
    HPID="$(lsof -nP -iTCP:8080 -sTCP:LISTEN -t | head -1)"
    HCWD="$(lsof -a -p "$HPID" -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2-)"
    if [ "$HCWD" = "$APP_DIR" ]; then
      # Our own emulator, orphaned (its CLI died without export — e.g. the Terminal window was
      # closed). Its memory is the latest truth: export it, make it the live-db, then stop it.
      say "נמצא אמולטור יתום של FamilyFinance (pid $HPID) עם נתונים שלא נשמרו — שומר אותם…"
      ORPHAN="$APP_DIR/family-data/backups/orphan-export-$STAMP"; mkdir -p "$ORPHAN"
      if curl -s -m 120 -X POST "http://127.0.0.1:8080/emulator/v1/projects/family-finance-app-c9aa4:export" \
           -H "Content-Type: application/json" \
           -d "{\"database\":\"projects/family-finance-app-c9aa4/databases/(default)\",\"export_directory\":\"$ORPHAN\"}" \
           | grep -q '"error"'; then
        say "⚠ השמירה נכשלה — לא נוגע ב-live-db. סוגר את היתום ומתחיל מה-live-db האחרון."
      else
        # The emulator writes <dir>/firestore_export_<ts>/firestore_export_<ts>.overall_export_metadata;
        # live-db/firebase-export-metadata.json expects firestore_export/firestore_export.overall_export_metadata.
        EXP="$(ls -d "$ORPHAN"/firestore_export_* | head -1)"
        cp -R "$APP_DIR/family-data/live-db" "$APP_DIR/family-data/backups/live-db-before-orphan-$STAMP"
        rm -rf "$APP_DIR/family-data/live-db/firestore_export"
        cp -R "$EXP" "$APP_DIR/family-data/live-db/firestore_export"
        mv "$APP_DIR/family-data/live-db/firestore_export/"*.overall_export_metadata \
           "$APP_DIR/family-data/live-db/firestore_export/firestore_export.overall_export_metadata"
        say "נשמר. live-db עודכן מהיתום (גיבוי: backups/live-db-before-orphan-$STAMP)."
      fi
      kill "$HPID" 2>/dev/null; sleep 2; kill -9 "$HPID" 2>/dev/null
      for i in {1..10}; do lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 1; done
    else
      say "⛔ פורט 8080 תפוס על ידי תהליך אחר — לא של FamilyFinance:"
      printf '   %s\n   מתוך: %s\n' "$HOLDER" "${HCWD:-?}"
      say "זה כנראה אמולטור של פרויקט אחר (סשן Claude אחר / ריצת טסטים). חכה שיסיים, או סגור אותו, ולחץ שוב."
      printf '\nלחץ Enter לסגירת החלון. '; read -r _
      exit 1
    fi
  fi
fi
if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  say "המערכת כבר רצה — משתמש בה."
  [ "$SYNCED" = "1" ] || open "http://localhost:3000"
else
  zsh "$APP_DIR/scripts/live/start-live.sh" &
  LIVE_PID=$!
  for i in {1..90}; do
    lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1 && break
    kill -0 $LIVE_PID 2>/dev/null || { say "המערכת לא עלתה — ראה family-data/logs/emulator.log"; exit 1; }
    sleep 1
  done
  sleep 3  # let the emulator finish its import before the first write
fi

# ── 3. Inject what was verified — only after David sees it ─────────────────────────────────────
if [ "$SYNCED" = "1" ]; then
  say "שלב ג — מה ייכנס ל-DB (רק שורות שאומתו; מסמכים קיימים לא נוגעים):"
  python3 "$TOOLS/inject.py" --only-new | tail -3
  if ask "להזריק את העסקאות?"; then
    python3 "$TOOLS/inject.py" --only-new --apply | tail -1
  fi
  say "שלב ד — יתרות והכנסות מהעו\"ש:"
  python3 "$TOOLS/ingest_bank.py"
  if ask "להחיל את עדכוני הבנק?"; then
    python3 "$TOOLS/ingest_bank.py" --apply | tail -1
  fi
  say "הסנכרון הסתיים. רענן את הדפדפן (Cmd+R) כדי לראות את הנתונים החדשים."
  open "http://localhost:3000"
fi

# ── 4. Stay attached: Ctrl+C here = export-on-exit = the save ──────────────────────────────────
if [ -n "$LIVE_PID" ]; then
  say "לסגירה: Ctrl+C בחלון הזה — הנתונים נשמרים אוטומטית."
  wait $LIVE_PID
fi
