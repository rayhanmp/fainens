/**
 * CSV Parser Utilities
 * Helper functions for parsing CSV transaction imports
 */

/**
 * Parse a CSV line handling quoted fields and escaped quotes
 */
export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

/**
 * Parse date from DD/MM/YYYY format to ISO string
 * Returns null if invalid
 */
export function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;
  
  // Expected format: DD/MM/YYYY
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900) return null;
  
  // Create date and verify it's valid
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  
  // Return ISO string
  return date.toISOString();
}

/**
 * Parse amount from Rp format (e.g., "Rp65,000" -> 65000)
 * Returns null if invalid
 */
export function parseAmount(amountStr: string): number | null {
  if (!amountStr) return null;
  
  // Remove Rp, spaces, and thousand separators (commas)
  const cleaned = amountStr
    .replace(/Rp/gi, '')
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .trim();
  
  const amount = parseInt(cleaned, 10);
  
  if (isNaN(amount) || amount < 0) return null;
  
  // Return amount in rupiah (IDR uses whole numbers, no cents)
  return amount;
}
