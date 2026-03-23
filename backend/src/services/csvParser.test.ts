import { describe, it, expect } from 'vitest';
import { parseCSVLine, parseDate, parseAmount } from './csvParser';

describe('CSV Parser', () => {
  describe('parseCSVLine', () => {
    it('should parse simple comma-separated values', () => {
      const result = parseCSVLine('a,b,c');
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should handle quoted fields with commas', () => {
      const result = parseCSVLine('a,"b,c",d');
      expect(result).toEqual(['a', 'b,c', 'd']);
    });

    it('should handle escaped quotes', () => {
      const result = parseCSVLine('a,"b""c",d');
      expect(result).toEqual(['a', 'b"c', 'd']);
    });

    it('should handle empty fields', () => {
      const result = parseCSVLine('a,,c');
      expect(result).toEqual(['a', '', 'c']);
    });

    it('should handle Rp formatted amounts', () => {
      const result = parseCSVLine('12/02/2026,"Rp65,000",Hokben');
      expect(result).toEqual(['12/02/2026', 'Rp65,000', 'Hokben']);
    });
  });

  describe('parseDate', () => {
    it('should parse valid DD/MM/YYYY dates', () => {
      const result = parseDate('12/02/2026');
      expect(result).toBe('2026-02-11T17:00:00.000Z'); // UTC time
    });

    it('should return null for invalid format', () => {
      expect(parseDate('2026-02-12')).toBeNull();
      expect(parseDate('12-02-2026')).toBeNull();
      expect(parseDate('invalid')).toBeNull();
    });

    it('should return null for invalid dates', () => {
      expect(parseDate('32/02/2026')).toBeNull(); // Invalid day
      expect(parseDate('12/13/2026')).toBeNull(); // Invalid month
      expect(parseDate('12/02/1899')).toBeNull(); // Year too old
    });

    it('should handle leap year dates', () => {
      const result = parseDate('29/02/2024'); // Leap year
      expect(result).not.toBeNull();
    });

    it('should return null for non-leap year Feb 29', () => {
      expect(parseDate('29/02/2023')).toBeNull(); // Not a leap year
    });
  });

  describe('parseAmount', () => {
    it('should parse Rp formatted amounts', () => {
      expect(parseAmount('Rp65,000')).toBe(65000);
      expect(parseAmount('Rp 65,000')).toBe(65000);
      expect(parseAmount('Rp1,000,000')).toBe(1000000);
    });

    it('should handle amounts without Rp prefix', () => {
      expect(parseAmount('65,000')).toBe(65000);
      expect(parseAmount('1000000')).toBe(1000000);
    });

    it('should return null for invalid amounts', () => {
      expect(parseAmount('')).toBeNull();
      expect(parseAmount('invalid')).toBeNull();
      expect(parseAmount('Rpabc')).toBeNull();
    });

    it('should return null for negative amounts', () => {
      expect(parseAmount('-5000')).toBeNull();
      expect(parseAmount('Rp-5000')).toBeNull();
    });

    it('should handle zero amount', () => {
      expect(parseAmount('Rp0')).toBe(0);
      expect(parseAmount('0')).toBe(0);
    });
  });
});
