import { formatCurrency } from '../../lib/utils';

export function formatRecapCurrency(amount: number) {
  return formatCurrency(amount).replace('Rp ', 'Rp');
}
