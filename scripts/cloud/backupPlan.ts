export const KEEP_BACKUPS = 30;
export const MAX_RESTORE_DOCS = 18000; // Spark: 20K writes/day — leave headroom for the app itself

const pad = (n: number) => String(n).padStart(2, '0');
export const backupFileName = (d: Date): string => `cloud-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
export const shouldSkipToday = (files: string[], d: Date): boolean => files.includes(backupFileName(d));
export function filesToPrune(files: string[], keep = KEEP_BACKUPS): string[] {
  const cloud = files.filter((f) => /^cloud-\d{8}\.json$/.test(f)).sort();
  return cloud.slice(0, Math.max(0, cloud.length - keep));
}
