/** An account a subscription can be paid from, with its current balance. */
export type PaymentAccount = { id: number; name: string; type: string; balance: number };

const PAYLATER_PATTERN = /pay\s*later|traveloka|kredivo|akulaku|split|defer|humm|afterpay/i;

/**
 * Wallets, banks and cards: active asset or liability accounts that the app doesn't run itself.
 * PayLater lines track installments, so the server refuses them (services/subscription-renewals.ts).
 */
export function isPaymentAccount(account: { type: string; name: string; [key: string]: unknown }): boolean {
  if (account.isActive === false || account.systemKey) return false;
  if (account.type === 'asset') return true;
  if (account.type !== 'liability') return false;
  return !PAYLATER_PATTERN.test(`${account.name} ${typeof account.provider === 'string' ? account.provider : ''}`);
}
