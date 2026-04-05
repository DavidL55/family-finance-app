import { describe, expect, it } from 'vitest';
import { inferMonthFromFileName } from '../services/GoogleDriveService';

describe('inferMonthFromFileName', () => {
  describe('YYYY-MM-DD pattern', () => {
    it('parses date-prefixed filenames', () => {
      expect(inferMonthFromFileName('2026-03-15_ספר_250.pdf')).toEqual({ year: '2026', month: '03' });
    });

    it('parses YYYY-MM with no day', () => {
      expect(inferMonthFromFileName('2025-11_invoice.pdf')).toEqual({ year: '2025', month: '11' });
    });

    it('handles underscore separator', () => {
      expect(inferMonthFromFileName('2026_03_15_vendor.pdf')).toEqual({ year: '2026', month: '03' });
    });
  });

  describe('MM_YYYY pattern', () => {
    it('parses month-first filenames', () => {
      expect(inferMonthFromFileName('03_2026_receipt.pdf')).toEqual({ year: '2026', month: '03' });
    });

    it('handles dash separator', () => {
      expect(inferMonthFromFileName('11-2025_document.pdf')).toEqual({ year: '2025', month: '11' });
    });
  });

  describe('YYYYMM pattern (no separators)', () => {
    it('parses compact date format', () => {
      expect(inferMonthFromFileName('202603_report.pdf')).toEqual({ year: '2026', month: '03' });
    });
  });

  describe('no match', () => {
    it('returns null for names with no date', () => {
      expect(inferMonthFromFileName('receipt.pdf')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(inferMonthFromFileName('')).toBeNull();
    });
  });
});
