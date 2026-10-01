export const HIDDEN_BALANCE = '••••••';

export function formatPrivateAmount(value: number, hidden: boolean, formatter: (value: number, currency: string) => string, currency = 'Rp'): string {
  return hidden ? HIDDEN_BALANCE : formatter(value, currency);
}

/** Redact amounts in descriptive copy without changing the underlying data. */
export function maskCurrencyAmounts(text: string): string {
  return text.replace(/(?:Rp|IDR)\s*[+-]?\s*\d+(?:[.,]\d+)*(?:[kMBT])?/g, HIDDEN_BALANCE);
}
