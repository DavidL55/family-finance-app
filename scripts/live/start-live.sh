#!/bin/zsh
# start-live.sh — launch FamilyFinance in LIVE mode (the family's real data).
#
# What it does, in order:
#   1. Backs up family-data/live-db into family-data/backups/<timestamp>/ (if it exists).
#   2. Starts the Firebase emulator on the app's project id, importing live-db and exporting
#      back to it on exit — this is the persistence David chose (spec 2026-08-29, option A).
#   3. First run ever (no live-db): starts empty and bootstraps the five family members.
#   4. Starts the Vite dev server if it is not already up.
#   5. Opens the browser at the login screen.
#
# The demo ledger (.emulator-data) is NOT touched by this script in either direction.

set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LIVE_DB="$APP_DIR/family-data/live-db"
BACKUPS="$APP_DIR/family-data/backups"
LOG_DIR="$APP_DIR/family-data/logs"
PROJECT_ID="family-finance-app-c9aa4"
mkdir -p "$BACKUPS" "$LOG_DIR"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

cd "$APP_DIR"

# ── Already running? Just open the browser. ─────────────────────────────────────────────────────
if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  if [ -f "$LOG_DIR/live.mode" ]; then
    say "המערכת כבר רצה במצב חי — פותח דפדפן."
    open "http://localhost:3000"
    exit 0
  fi
  say "שים לב: אמולטור אחר (כנראה מצב דמו/פיתוח) כבר רץ על פורט 8080."
  say "סגור אותו קודם, ואז לחץ שוב על האייקון."
  exit 1
fi

# ── Backup, then start. ─────────────────────────────────────────────────────────────────────────
FIRST_RUN=0
if [ -d "$LIVE_DB" ]; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  say "מגבה את הנתונים ל-backups/$STAMP …"
  cp -R "$LIVE_DB" "$BACKUPS/live-db-$STAMP"
  # Keep the newest 30 backups; the family's data is small and disks are not infinite.
  ls -1dt "$BACKUPS"/live-db-* 2>/dev/null | tail -n +31 | xargs rm -rf 2>/dev/null || true
  IMPORT_FLAG=(--import="$LIVE_DB")
else
  FIRST_RUN=1
  say "הפעלה ראשונה — אין עדיין נתונים. המערכת תיפתח ריקה וניצור את בני המשפחה."
  IMPORT_FLAG=()
fi

say "מפעיל את בסיס הנתונים (מצב חי)…"
touch "$LOG_DIR/live.mode"
trap 'rm -f "$LOG_DIR/live.mode"' EXIT
npx firebase emulators:start --project "$PROJECT_ID" "${IMPORT_FLAG[@]}" \
  --export-on-exit="$LIVE_DB" > "$LOG_DIR/emulator.log" 2>&1 &
EMU_PID=$!

for i in {1..60}; do
  if grep -q "All emulators ready" "$LOG_DIR/emulator.log" 2>/dev/null; then break; fi
  if ! kill -0 $EMU_PID 2>/dev/null; then
    say "בסיס הנתונים לא הצליח לעלות. עיין ב-family-data/logs/emulator.log"
    exit 1
  fi
  sleep 1
done

if [ "$FIRST_RUN" = "1" ]; then
  say "יוצר את חמשת בני המשפחה…"
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
    npx tsx scripts/live/bootstrap-live.ts --apply
fi

# ── Dev server. ────────────────────────────────────────────────────────────────────────────────
if ! lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  say "מפעיל את שרת האפליקציה…"
  npm run dev > "$LOG_DIR/dev-server.log" 2>&1 &
  for i in {1..60}; do
    if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi

say "פותח את המערכת בדפדפן. לסגירה: חזור לחלון הזה ולחץ Ctrl+C — הנתונים נשמרים אוטומטית."
open "http://localhost:3000"

# Keep the terminal attached to the emulator so Ctrl+C triggers export-on-exit (the save).
wait $EMU_PID
