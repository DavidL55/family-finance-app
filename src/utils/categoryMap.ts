// Hebrew Category Mapping — pure data, deliberately kept free of any Firebase import.
//
// This used to live inline in FileProcessor.ts, but FileProcessor.ts imports `db` from
// `../services/firebase` at module scope, which reads `import.meta.env` — a Vite-only global
// that is `undefined` under plain Node (e.g. `npx tsx scripts/migrate-transactions.ts`). Any
// consumer that only needs CATEGORY_MAP (like the migration script) would otherwise be forced
// to load firebase.ts and crash outside a Vite runtime. Extracting it here lets non-Vite
// entrypoints depend on CATEGORY_MAP without dragging in Firebase. FileProcessor.ts re-exports
// this for backward compatibility with existing imports (e.g. `import { CATEGORY_MAP } from
// './FileProcessor'`).
export const CATEGORY_MAP: Record<string, string> = {
  Housing_Utilities: 'מגורים ובית',
  Insurance_Pension: 'ביטוח ופנסיה',
  Transportation: 'תחבורה ורכב',
  Groceries_Dining: 'מזון וצריכה',
  Health: 'בריאות',
  Education: 'חינוך וחוגים',
  Leisure_Travel: 'פנאי ובילוי',
  Income_Investments: 'הכנסות והשקעות',
  General_Misc: 'שונות'
};
