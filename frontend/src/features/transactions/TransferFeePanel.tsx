import { Info } from 'lucide-react';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { formatCurrency } from '../../lib/utils';

export type TransferFeeDetails = {
  fee: number;
  senderPays: boolean;
  fromAmount: number;
  toAmount: number;
  source: 'manual' | 'default' | 'provider' | 'none';
};

type TransferFeePanelProps = {
  details: TransferFeeDetails | { error: string } | null;
  manualPayerOverride: '' | 'sender' | 'recipient';
  controlsOpen: boolean;
  transferAdminFee: string;
  onToggleControls: () => void;
  onFeeChange: (value: string) => void;
  onPayerChange: (value: '' | 'sender' | 'recipient') => void;
};

export function TransferFeePanel({
  details,
  manualPayerOverride,
  controlsOpen,
  transferAdminFee,
  onToggleControls,
  onFeeChange,
  onPayerChange,
}: TransferFeePanelProps) {
  if (!details) return null;
  if ('error' in details) {
    return <div className="rounded-xl border border-[var(--color-danger)]/20 bg-[var(--color-danger)]/10 p-4 text-sm text-[var(--color-danger)]">{details.error}</div>;
  }

  const ruleLabel = manualPayerOverride
    ? 'Manual payer override'
    : details.source === 'manual'
      ? 'Manual override'
      : details.source === 'default'
        ? 'Settings default'
        : details.source === 'provider'
          ? 'Provider default'
          : 'No fee rule';
  const defaultPayer = details.senderPays ? 'sender' : 'recipient';
  const alternatePayer = defaultPayer === 'sender' ? 'recipient' : 'sender';
  const feeSummary = details.fee > 0
    ? `${formatCurrency(details.fee)} · ${details.senderPays ? 'Sender pays' : 'Recipient pays'}`
    : 'No fee';

  return <div className="space-y-2">
    <label className="block text-sm font-semibold text-[var(--color-text-primary)]">Transfer fee</label>
    <button type="button" onClick={onToggleControls} className="flex w-full items-center justify-between gap-3 rounded-xl border-none bg-[var(--ref-surface-container-low)] px-3 py-3 text-left text-sm text-[var(--color-text-primary)] focus:ring-2 focus:ring-[var(--color-accent)]/20" aria-expanded={controlsOpen}>
      <span className="min-w-0 truncate">{feeSummary}</span>
      <span className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[var(--color-accent)]">
        <span className="group relative inline-flex" tabIndex={0} aria-label="Show transfer fee details">
          <Info className="h-4 w-4" />
          <span role="tooltip" className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-72 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 text-left text-xs font-normal leading-relaxed text-[var(--color-text-primary)] shadow-lg group-hover:block group-focus-within:block">
            {formatCurrency(details.fromAmount)} deducted from the source and {formatCurrency(details.toAmount)} received. Applied rule: {ruleLabel}.
          </span>
        </span>
        <span>{controlsOpen ? 'Done' : 'Adjust'}</span>
      </span>
    </button>
    {controlsOpen && <div className="space-y-2 rounded-xl bg-[var(--ref-surface-container-low)] p-3">
      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Override the fee or who incurs it for this transfer only.</p>
      <Input label="Fee override (IDR)" type="number" min="0" step="1" value={transferAdminFee} onChange={(event) => onFeeChange(event.target.value)} placeholder={details.fee > 0 ? String(details.fee) : '0'} className="mt-2 rounded-xl" />
      <Select label="Fee incurred by" value={manualPayerOverride === defaultPayer ? '' : manualPayerOverride} onChange={(event) => onPayerChange(event.target.value as '' | 'sender' | 'recipient')} options={[{ value: '', label: `${defaultPayer === 'sender' ? 'Sender' : 'Recipient'} (default)` }, { value: alternatePayer, label: alternatePayer === 'sender' ? 'Sender' : 'Recipient' }]} className="mt-2 rounded-xl" />
    </div>}
  </div>;
}
