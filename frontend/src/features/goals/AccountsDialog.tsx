import { Modal } from '../../components/ui/Modal';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { Toggle } from '../settings/controls';
import type { GoalsOverview } from './queries';

/** Which accounts count as your money for goals; switch one off to leave it out. */
export function AccountsDialog({ overview, busy, onToggle, onClose }: { overview: GoalsOverview; busy: boolean; onToggle: (accountId: number, included: boolean) => void; onClose: () => void }) {
  const { formatAmount } = useBalanceVisibility();
  return (
    <Modal isOpen onClose={onClose} title="Accounts that count" subtitle="Your active cash, bank, e-wallet and investment accounts. Switch one off if its money isn’t for goals, like a business account.">
      <ul className="-mx-1 divide-y divide-[var(--color-border)]">
        {overview.accounts.map((account) => (
          <li key={account.id} className="flex items-center justify-between gap-3 px-1 py-2.5">
            <span className="min-w-0">
              <span className="block truncate text-sm text-[var(--ref-on-surface)]">{account.name}</span>
              <span className="block text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{formatAmount(account.balance)}{account.liquidityClass === 'investment' ? ' · investment' : ''}</span>
            </span>
            <Toggle label={`Count ${account.name}`} checked={account.included} disabled={busy} onChange={(on) => onToggle(account.id, on)} />
          </li>
        ))}
      </ul>
      <p className="flex justify-between border-t border-[var(--color-border)] px-1 pt-3 text-sm">
        <span className="text-[var(--ref-on-surface-variant)]">Counted</span>
        <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(overview.available)}</span>
      </p>
    </Modal>
  );
}
