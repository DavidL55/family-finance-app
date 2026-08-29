# Real family data import — design

Approved by David in chat, 2026-08-29. Decisions taken during brainstorming:

- **Persistence: local (option A).** Real data lives in `family-data/live-db/` on this machine
  only. Nothing goes to any cloud. Backups are automatic and local.
- **Extraction: deterministic-first.** Credit-card PDF statements are parsed locally. Gemini is a
  fallback offered ONLY for files the parser cannot read, behind an explicit approval list David
  sees before anything is sent. Medical documents are never sent anywhere and never enter the
  finance system.
- **Members: five.** David (super-admin), Lilit (parent), Omer, Shaked, Lior (member).

## The two worlds

| | Demo (exists today) | Live (this design) |
|---|---|---|
| Data | synthetic corpus, 374 docs | the family's real records |
| Store | `.emulator-data/` — READ-ONLY ledger, `--import` only | `family-data/live-db/` — writable, `--export-on-exit` |
| Purpose | development, tests | daily use |
| Startup | manual commands | desktop icon |

The standing "never `--export-on-exit`" constraint protects the demo ledger; it does not apply to
`live-db`, whose whole purpose is persistence. The two directories never mix. `family-data` is
gitignored (commit `b6db157`) — no real document or record ever enters git.

## Components

1. **Archive** — `family-data/archive/`: the 917 extracted Takeout files sorted by topic → year
   → month, with an `INDEX.md`. Originals in Downloads untouched. Medical and family-document
   folders are archive-only.
2. **Live mode** — `scripts/live/start-live.sh`: timestamped backup of `live-db` into
   `family-data/backups/`, then emulator with `--import=family-data/live-db
   --export-on-exit=family-data/live-db --project family-finance-app-c9aa4`, then dev server,
   then browser. First run (no `live-db`): starts empty and runs the bootstrap.
3. **Bootstrap** — `scripts/live/bootstrap-live.ts`: creates the five auth users
   (`{first}-levy@familyfinance.local`, custom claims `{role, memberId}`) and their
   `members/{id}` + `permissions/member__{id}` docs, mirroring the demo schema exactly
   (roles: super-admin / parent / member; member docs: name, role, color, timestamps).
4. **Extractor** — `scripts/live/extract-statements.ts`: reads the 87 credit-card PDFs
   (5 cards, 2025-01..2026-05) and the shared-house xlsx files into one reviewable
   intermediate file `family-data/extracted/transactions.json` (date, amount, description,
   card, source file, inferred category, member attribution). Unparseable files land in
   `family-data/extracted/needs-review.md`, never silently skipped.
5. **Injector** — `scripts/live/inject-transactions.ts`: writes the reviewed intermediate file
   into the live Firestore (`transaction_lines` in the app's schema, `created_at` server
   timestamps, audit_log entries). Idempotent: a (source file, row) key prevents double import.
6. **Desktop icon** — `~/Desktop/FamilyFinance.command` runs `start-live.sh`.

## Delivery stages

- **A** — live mode + bootstrap + desktop icon. Done when: icon click → app opens → David logs
  in → five members exist → restart → data survives.
- **B** — archive organization + INDEX.md. Done when: every one of the 917 files has a home and
  the index says what lives where.
- **C** — extractor + injector for 2025–2026. Done when: statements are in the live system,
  categorized, attributed, and the forecast/dashboard screens render them.
- **D** — joint review of the picture; decide on 2018–2022 history, insurance/pension/currency
  records, and what insight surfaces are missing.

## Out of scope (for now)

Cloud sync, Google Drive import, the 2018–2022 history (until D), automated category learning,
and any change to the forecast engine itself.
