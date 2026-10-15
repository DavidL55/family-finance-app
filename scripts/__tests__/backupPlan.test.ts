// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { backupFileName, filesToPrune, isSuspiciousShrink, newestBackup, shouldSkipToday } from '../cloud/backupPlan';

const d = new Date(2026, 9, 15, 9, 0); // local time
describe('backup plan (spec §6.2 — at most once a day, keep 30)', () => {
  it('names the file by local date', () => { expect(backupFileName(d)).toBe('cloud-20261015.json'); });
  it('skips when today\'s file exists', () => {
    expect(shouldSkipToday(['cloud-20261014.json', 'cloud-20261015.json'], d)).toBe(true);
    expect(shouldSkipToday(['cloud-20261014.json', 'live-db-20261015-090000'], d)).toBe(false);
  });
  it('prunes the oldest beyond 30, ignoring non-cloud files', () => {
    const files = Array.from({ length: 32 }, (_, i) => `cloud-202609${String(i + 1).padStart(2, '0')}.json`).concat(['live-db-x']);
    expect(filesToPrune(files)).toEqual(['cloud-20260901.json', 'cloud-20260902.json']);
  });
  it('flags an empty snapshot, with or without a previous backup', () => {
    expect(isSuspiciousShrink(0, null)).toBe(true);
    expect(isSuspiciousShrink(0, 1200)).toBe(true);
  });
  it('flags a count below half of the newest kept backup, accepts half or more', () => {
    expect(isSuspiciousShrink(599, 1200)).toBe(true);
    expect(isSuspiciousShrink(600, 1200)).toBe(false);
    expect(isSuspiciousShrink(1300, 1200)).toBe(false);
  });
  it('accepts any non-empty snapshot when there is no previous backup to compare', () => {
    expect(isSuspiciousShrink(1, null)).toBe(false);
  });
  it('finds the newest cloud backup, ignoring other files', () => {
    expect(newestBackup(['cloud-20261013.json', 'cloud-20261015.json', 'cloud-20261014.json', 'live-db-x', 'cloud-20261016.json.tmp'])).toBe('cloud-20261015.json');
    expect(newestBackup(['live-db-x'])).toBeNull();
  });
});
