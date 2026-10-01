import { useCallback } from 'react';
import { useUiStore } from '../stores/ui-store';
import { formatCurrency } from '../lib/utils';
import { formatPrivateAmount, maskCurrencyAmounts } from '../lib/balance-visibility';

export function useBalanceVisibility() {
  const balancesHidden = useUiStore((state) => state.balancesHidden);
  const formatAmount = useCallback((value: number, currency = 'Rp') => formatPrivateAmount(value, balancesHidden, formatCurrency, currency), [balancesHidden]);
  const maskAmounts = useCallback((text: string) => balancesHidden ? maskCurrencyAmounts(text) : text, [balancesHidden]);
  return { balancesHidden, formatAmount, maskAmounts };
}
