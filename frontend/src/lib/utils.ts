import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * While typing a nominal amount: insert Indonesian thousand separators (dots).
 * Pass the raw input value; non-digits are stripped.
 */
export function formatIdNominalInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits === '') return '';
  try {
    return BigInt(digits).toLocaleString('id-ID');
  } catch {
    return '';
  }
}

/** Parse a display string from {@link formatIdNominalInput} to integer rupiah. */
export function parseIdNominalToInt(formatted: string): number {
  const digits = formatted.replace(/\D/g, '');
  if (digits === '') return Number.NaN;
  return parseInt(digits, 10);
}

// Format currency (cents to IDR)
// Note: 1 IDR = 100 cents in storage, but displayed as whole rupiah
export function formatCurrency(cents: number, currency = 'Rp'): string {
  const absolute = Math.abs(cents);
  const rupiah = Math.round(absolute); // IDR uses whole numbers, no cents
  const sign = cents < 0 ? '-' : '';
  
  // Format with Indonesian number format (dots for thousands, no decimals)
  const formatted = rupiah.toLocaleString('id-ID');
  return `${sign}${currency} ${formatted}`;
}

// Format date (timestamp ms to locale date)
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Audit / log views — date + time */
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Format percentage
export function formatPercentage(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

// Format number with commas
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

// Get account type color (for UI badges)
export function getAccountTypeColor(type: string): string {
  const colors: Record<string, string> = {
    asset: 'bg-green-100 text-green-800',
    liability: 'bg-red-100 text-red-800',
    equity: 'bg-blue-100 text-blue-800',
    revenue: 'bg-purple-100 text-purple-800',
    expense: 'bg-orange-100 text-orange-800',
  };
  return colors[type] || 'bg-gray-100 text-gray-800';
}

// Get account type label
export function getAccountTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    asset: 'Asset',
    liability: 'Liability',
    equity: 'Equity',
    revenue: 'Revenue',
    expense: 'Expense',
  };
  return labels[type] || type;
}
