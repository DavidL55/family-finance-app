# Glanceable Screens — every figure explains itself (Stage 8)
Approved by David 29.08.2026 ("מבט אחד" + "ערסלים"). Lenses: Ofra (UX), Lola (scope), Sun (boundaries).

## The three rules
1. **Every rendered ₪ figure and count carries an explanation** — hover on desktop, tap on
   touch — in plain Hebrew: what the number is, where it comes from. Mechanism: the EXISTING
   `Explain` + glossary system (Stage 7), extended app-wide. No parallel tooltip system.
2. **A composite figure expands in place**: clicking a figure that is a sum (net worth, total
   premium, monthly expenses…) opens an accordion DIRECTLY BENEATH it listing its components
   with amounts; click again collapses. New shared component: `FigureBreakdown`.
3. **The nav menu is grouped accordions**: modules grouped יומיומי / נכסים והתחייבויות /
   דוחות / ניהול; groups expand/collapse; state persists per session (sessionStorage,
   fail-open like FilterContext).

## Constraints (from the codebase's own rulings)
- Hover is NEVER the only path (Ofra): `Explain` popovers must open on click/tap too.
- Glossary entries are the single source of explanation text (D6-style registry); adding a
  figure without an entry FAILS a test — extend the render-presence guards
  (`unexplainedMoneyFigures`) beyond forecast to each converted screen, screen by screen.
- `FigureBreakdown` renders REAL data passed by the screen — no fetching of its own (Sun:
  UI components render only). Empty ≠ error branches per Boris.
- RTL first: accordion chevrons and indentation follow dir=rtl; tabular-nums on all figures.

## Rollout stages — each shippable
- **S1 Dashboard**: 4 KPI tiles + net-worth card figures → Explain ids + FigureBreakdown
  (net worth → assets/liabilities lines; monthly expenses → by category; incomes → by source).
- **S2 Nav accordion** (App-level, MODULE_REGISTRY gains `group`).
- **S3 Net-worth, Insurances, Investments, Recurring screens** (composite-heavy).
- **S4 Expenses/Annual/Central-report + remaining screens**; then the app-wide guard flips on.

## Testing
TDD per component; per-screen render-presence guard (every ₪ figure explained — the forecast
suite's pattern, reusing `helpers/renderPresence.ts`); accordion a11y (button role,
aria-expanded, keyboard); glossary count pinned per screen conversion.
