import { ArrowRight, Receipt } from 'lucide-react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatIdNominalInput } from '../../lib/utils';
import { Field, fieldControl } from '../../components/transactions/EntryPickers';

export type TransferFeeDetails = {
  fee: number;
  senderPays: boolean;
  fromAmount: number;
  toAmount: number;
  source: 'manual' | 'default' | 'provider' | 'none';
};

type TransferFeePanelProps = {
  details: TransferFeeDetails | { error: string } | null;
  fromName?: string;
  toName?: string;
  manualPayerOverride: '' | 'sender' | 'recipient';
  transferAdminFee: string;
  onFeeChange: (value: string) => void;
  onPayerChange: (value: '' | 'sender' | 'recipient') => void;
};

/**
 * The transfer fee as one editable line: the amount, who pays it, and what that means for
 * both accounts. Leaving the amount empty keeps the rule's default, shown as the placeholder.
 */
export function TransferFeePanel({ details, fromName, toName, manualPayerOverride, transferAdminFee, onFeeChange, onPayerChange }: TransferFeePanelProps) {
  const { formatAmount } = useBalanceVisibility();
  const resolved = details && !('error' in details) ? details : null;
  const error = details && 'error' in details ? details.error : null;
  const defaultPayer: 'sender' | 'recipient' = resolved ? (resolved.senderPays ? 'sender' : 'recipient') : 'sender';
  const payer = manualPayerOverride || defaultPayer;
  const source = manualPayerOverride || transferAdminFee.trim() !== ''
    ? 'Custom'
    : resolved?.source === 'default' ? 'From settings'
      : resolved?.source === 'provider' ? 'Provider default'
        : 'No rule';

  return (
    <Field label="Transfer fee" icon={Receipt} htmlFor="entry-fee" hint={<span className="text-xs font-normal text-[var(--ref-outline)]">{source}</span>}>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--ref-on-surface-variant)]">Rp</span>
          <input
            id="entry-fee"
            inputMode="numeric"
            value={transferAdminFee}
            onChange={(event) => onFeeChange(formatIdNominalInput(event.target.value))}
            placeholder={resolved ? formatIdNominalInput(String(resolved.fee)) : '0'}
            aria-describedby={error ? 'entry-fee-error' : undefined}
            aria-invalid={error ? 'true' : undefined}
            className={cn(fieldControl, 'pl-9 tabular-nums', error && 'border-[var(--color-danger)]')}
          />
        </div>
        <div role="radiogroup" aria-label="Who pays the fee" title="Who pays the fee" className="inline-flex shrink-0 rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-0.5">
          {(['sender', 'recipient'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={payer === option}
              onClick={() => onPayerChange(option === defaultPayer ? '' : option)}
              className={cn(
                'h-8 rounded-md px-2.5 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]',
                payer === option ? 'bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]' : 'text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-on-surface)]',
              )}
            >
              {option === 'sender' ? 'Sender' : 'Recipient'}
            </button>
          ))}
        </div>
      </div>
      {error
        ? <p id="entry-fee-error" role="alert" className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>
        : resolved && resolved.fee > 0 && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1 text-xs text-[var(--ref-on-surface-variant)]">
            <strong className="font-semibold text-[var(--ref-on-surface)]">{formatAmount(resolved.fromAmount)}</strong> from {fromName ?? 'source'}
            <ArrowRight className="h-3 w-3" aria-hidden />
            <strong className="font-semibold text-[var(--ref-on-surface)]">{formatAmount(resolved.toAmount)}</strong> to {toName ?? 'destination'}
          </p>
        )}
    </Field>
  );
}
