// Transfer fees (in rupiah cents)
export const TRANSFER_FEES = {
  BANK_TO_GOPAY: 1000,
  TO_OVO: 1000,
} as const;

// Pagination
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 10,
  MAX_PAGE_SIZE: 100,
} as const;

// Currency
export const CURRENCY = {
  DEFAULT_CODE: 'IDR',
  DEFAULT_SYMBOL: 'Rp',
  DEFAULT_LOCALE: 'id-ID',
} as const;

// Time constants (milliseconds)
export const TIME = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
  MONTH_APPROX: 30 * 24 * 60 * 60 * 1000,
  YEAR_APPROX: 365 * 24 * 60 * 60 * 1000,
} as const;

// Preset colors for categories
export const PRESET_COLORS = [
  '#F59E0B', // Amber
  '#3B82F6', // Blue
  '#8B5CF6', // Violet
  '#EF4444', // Red
  '#10B981', // Emerald
  '#F97316', // Orange
  '#06B6D4', // Cyan
  '#EC4899', // Pink
  '#84CC16', // Lime
  '#6366F1', // Indigo
] as const;

// Default settings
export const DEFAULT_SETTINGS = {
  CURRENCY: 'IDR',
  OPPORTUNITY_COST_YIELD: 4.0,
  SALARY_DAY: 25,
  DATE_FORMAT: 'DD/MM/YYYY',
} as const;

// API constants
export const API = {
  DEFAULT_TIMEOUT: 30000, // 30 seconds
  MAX_RETRY_ATTEMPTS: 3,
} as const;

// File upload
export const UPLOAD = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  ALLOWED_DOCUMENT_TYPES: ['application/pdf', 'text/plain'],
} as const;
