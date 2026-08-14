# FamilyFinance v2 — Roadmap of Implementation Plans

**Spec:** `docs/superpowers/specs/2026-08-14-family-finance-v2-design.md` (approved by David 14.08.2026)

The approved spec covers the full system. Per the build order (spec §16), the work is delivered as **11 sequential plans**, each producing working, testable software on its own. Each plan gets its own file in this directory when its stage begins; a stage is not planned in detail until the previous stage's code is real (so plans stay accurate).

| # | Plan | Spec sections | Status |
|---|------|---------------|--------|
| 1 | Foundation — emulator, repo hygiene, data migration | §2, §7 (migration), §14→15 (local) | **Planned — `2026-08-14-stage1-foundation.md`** |
| 2 | Identity & permissions — real auth, roles, matrix, Rules + tests | §4, §7 (`members`, `groups`, `permissions`), §14 (1–2) | pending |
| 3 | Full data model — new collections + typed services | §7 | pending |
| 4 | UI shell — global filters, module registry, hover-explain layer, state rules | §5, §6 | pending |
| 5 | Financial modules — accounts, loans, insurances, net worth; extend existing | §6 | pending |
| 6 | AI provider layer — server-side multi-provider, model switcher, cost gate | §8 | pending |
| 7 | Forecast engine | §10 | pending |
| 8 | Insights engine + refine loop | §9 | pending |
| 9 | AI chat | §8 | pending |
| 10 | Interactive guide (tours) + demo mode | §13 | pending |
| 11 | Archive screen, backups, hardening, docs refresh | §12, §14 (5–7), cleanup | pending |

**Working branch:** `familyfinance-v2` (spec committed as its first commit).
**Rule carried across all plans:** TDD; frequent commits; a failed read renders as an error, never as empty; no hardcoded values; every new feature ships with its tour script (from plan 10 onward).
