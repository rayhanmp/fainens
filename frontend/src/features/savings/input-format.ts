/** Reading what people type into the simulator's fields. */

const SUFFIXES: Record<string, number> = { k: 1e3, rb: 1e3, jt: 1e6, m: 1e6, b: 1e9, miliar: 1e9 };

/** "5jt", "500rb", "1,5m", "12.500.000" → rupiah; 0 when empty, null when it isn't an amount. */
export function parseMoneyText(text: string): number | null {
  const match = text.trim().toLowerCase().replace(/\s+/g, '').match(/^([\d.,]+)(k|rb|jt|m|b|miliar)?$/);
  if (!match) return text.trim() === '' ? 0 : null;
  const [, digits, suffix] = match;
  if (!suffix) return Number(digits!.replace(/[.,]/g, '')) || 0;
  // With a suffix a comma or a lone dot is a decimal point: "1,5jt", "1.5jt"; "1.500rb" still groups.
  const value = Number(digits!.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(value) ? Math.round(value * SUFFIXES[suffix]!) : null;
}

/** A calendar month as an `<input type="month">` value, and back. */
export function monthInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function parseMonthInput(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : null;
}
