export type TransferFeePayer = 'sender' | 'recipient';

export type TransferFeeRule = {
  fromAccountId: number;
  toAccountId: number;
  feeCents: number;
  payer: TransferFeePayer;
};

export const TRANSFER_FEE_RULES_STORAGE_KEY = 'fainens-transfer-fee-rules';

export function loadTransferFeeRules(): TransferFeeRule[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(TRANSFER_FEE_RULES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is TransferFeeRule => {
      if (!value || typeof value !== 'object') return false;
      const row = value as Record<string, unknown>;
      return Number.isSafeInteger(row.fromAccountId)
        && Number.isSafeInteger(row.toAccountId)
        && Number.isSafeInteger(row.feeCents)
        && Number(row.fromAccountId) > 0
        && Number(row.toAccountId) > 0
        && Number(row.feeCents) >= 0
        && (row.payer === 'sender' || row.payer === 'recipient');
    });
  } catch {
    return [];
  }
}

export function saveTransferFeeRules(rules: TransferFeeRule[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TRANSFER_FEE_RULES_STORAGE_KEY, JSON.stringify(rules));
}
