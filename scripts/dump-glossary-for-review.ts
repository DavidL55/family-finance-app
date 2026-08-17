// Stage 6 Task 8 Step 6 (D12) — consolidates the hover-explain glossary (src/config/glossary.ts)
// into ONE Hebrew markdown file for David to read end-to-end in a single pass. This is the
// concrete artifact the controller ledger's "batch to David" note has repeated across four
// separate stages (Stage 4/5/5/5) without ever producing one document — this script closes that.
//
// Connection: this script runs under `npx tsx` (plain Node, not Vite), same reasoning as
// scripts/seed-members.ts — it only imports the pure, dependency-free glossary config, never
// anything that reads `import.meta.env` or touches Firestore.
//
// Usage:
//   npx tsx scripts/dump-glossary-for-review.ts
//
// Writes docs/superpowers/glossary-review-<today's date>.md — NOT committed as part of this
// task's code diff (per the brief), generated fresh and handed to David directly for the sign-off
// glossary.ts's own header describes as still outstanding.
//
// Grouping note: GlossaryEntry (src/types/glossary.ts) carries no literal "stage" field — this
// script infers a stage/screen grouping from each entry id's namespace prefix ('dashboard.',
// 'accounts.', ...), cross-referenced by hand against glossary.ts's own inline stage comments at
// the time this script was written. This is a readable APPROXIMATION for a human review pass, not
// a data-driven guarantee: an id whose prefix isn't in the map below still appears, grouped under
// an explicit "לא משויך לשלב ידוע" bucket, rather than being silently dropped.

import { writeFileSync } from 'node:fs';
import { GLOSSARY } from '../src/config/glossary';
import type { GlossaryEntry } from '../src/types/glossary';

const STAGE_BY_PREFIX: Record<string, string> = {
  dashboard: 'שלב 4 — לוח הבקרה',
  netWorth: 'שלב 5 — שווי נקי',
  expenses: 'שלב 5 — הוצאות',
  accounts: 'שלב 5 — חשבונות',
  loans: 'שלב 5 — הלוואות',
  insurances: 'שלב 5 — ביטוחים',
  recurring: 'שלב 5 — תנועות קבועות',
  aiSettings: 'שלב 6 — הגדרות AI',
};

const UNASSIGNED_STAGE_LABEL = 'לא משויך לשלב ידוע';

function stageFor(id: string): string {
  const prefix = id.split('.')[0];
  return STAGE_BY_PREFIX[prefix] ?? UNASSIGNED_STAGE_LABEL;
}

function buildMarkdown(entries: GlossaryEntry[]): { markdown: string; stageCount: number } {
  const byStage = new Map<string, GlossaryEntry[]>();
  for (const entry of entries) {
    const stage = stageFor(entry.id);
    const list = byStage.get(stage) ?? [];
    list.push(entry);
    byStage.set(stage, list);
  }

  const lines: string[] = [];
  lines.push('# סקירת מילון המונחים המצטבר');
  lines.push('');
  lines.push(`נוצר אוטומטית על ידי \`scripts/dump-glossary-for-review.ts\` ב-${new Date().toISOString().slice(0, 10)}.`);
  lines.push(`סה"כ ${entries.length} מונחים, ${byStage.size} קבוצות.`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const [stage, stageEntries] of byStage) {
    lines.push(`## ${stage} (${stageEntries.length} מונחים)`);
    lines.push('');
    for (const entry of [...stageEntries].sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(`### ${entry.title} (\`${entry.id}\`)`);
      lines.push('');
      lines.push(`**הסבר:** ${entry.explanation}`);
      lines.push('');
      lines.push(`**איך מחשבים:** ${entry.howComputed}`);
      lines.push('');
      lines.push(`**מקור:** ${entry.source}`);
      if (entry.asOf) {
        lines.push('');
        lines.push(`**נכון ל:** ${entry.asOf}`);
      }
      lines.push('');
    }
  }

  return { markdown: lines.join('\n'), stageCount: byStage.size };
}

function main() {
  const entries = Object.values(GLOSSARY);
  if (entries.length === 0) {
    throw new Error('[dump-glossary-for-review] GLOSSARY is empty — refusing to write an empty review file.');
  }

  const { markdown, stageCount } = buildMarkdown(entries);
  const outPath = `docs/superpowers/glossary-review-${new Date().toISOString().slice(0, 10)}.md`;
  writeFileSync(outPath, markdown, 'utf-8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${entries.length} glossary entries across ${stageCount} stage groups to ${outPath}`);
}

main();
