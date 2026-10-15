export const KEEP_BACKUPS = 30;
export const MAX_RESTORE_DOCS = 18000; // Spark: 20K writes/day — leave headroom for the app itself

const pad = (n: number) => String(n).padStart(2, '0');
export const backupFileName = (d: Date): string => `cloud-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
export const shouldSkipToday = (files: string[], d: Date): boolean => files.includes(backupFileName(d));
export function filesToPrune(files: string[], keep = KEEP_BACKUPS): string[] {
  const cloud = files.filter((f) => /^cloud-\d{8}\.json$/.test(f)).sort();
  return cloud.slice(0, Math.max(0, cloud.length - keep));
}

// A snapshot that is empty, or under half of the newest kept backup, is more likely a broken read
// (rules/ADC/outage) than real data loss. Writing it would enter the keep-30 rotation and, after
// 30 such days, prune the last good copies — so the caller exits 1 without writing or pruning.
export const SHRINK_FLOOR_RATIO = 0.5;
export function isSuspiciousShrink(newCount: number, previousCount: number | null): boolean {
  if (newCount === 0) return true;
  return previousCount !== null && newCount < previousCount * SHRINK_FLOOR_RATIO;
}

// Newest kept cloud backup by file name (cloud-YYYYMMDD.json sorts chronologically), or null.
export function newestBackup(files: string[]): string | null {
  const cloud = files.filter((f) => /^cloud-\d{8}\.json$/.test(f)).sort();
  return cloud.length > 0 ? cloud[cloud.length - 1] : null;
}
