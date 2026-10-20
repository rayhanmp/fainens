import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronRight, Trash2, Wallet } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDate } from '../../lib/utils';
import '../../routes/loans.css';
import { useSequence } from './motion';
import { VisualFrame } from './visuals';

/**
 * The Loans page’s summary and a loan row, copied from its markup with its own stylesheet (the
 * live rows record payments and delete loans, so they can’t run here). A sample loan to Ani, paid
 * back in two parts.
 */
export function LoanRepaymentDemo() {
  const { ref, step, replay } = useSequence(3, 1300);
  const { formatAmount } = useBalanceVisibility();
  const [due] = useState(() => Date.now() + 12 * 86_400_000);
  const lent = 500_000;
  const remaining = step >= 3 ? 0 : step >= 2 ? 300_000 : lent;
  const repaid = remaining === 0;

  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="The Loans page with a sample loan to Ani, paid back in two parts. None of it counts as income or spending.">
      <div className="loans-page pointer-events-none mx-auto max-w-4xl space-y-4">
        <section className="loans-summary" aria-label="Loan balances">
          <div className="loans-stat">
            <div className="loans-stat-label"><span className="loans-stat-icon loans-positive"><ArrowUpRight size={19} /></span> Owed to you</div>
            <p className="loans-stat-value">{formatAmount(remaining)}</p>
            <p className="loans-caption">Outstanding money you've lent</p>
          </div>
          <div className="loans-stat">
            <div className="loans-stat-label"><span className="loans-stat-icon loans-debt"><ArrowDownRight size={19} /></span> You owe</div>
            <p className="loans-stat-value">{formatAmount(0)}</p>
            <p className="loans-caption">Outstanding money you've borrowed</p>
          </div>
          <div className="loans-stat loans-stat-net">
            <div className="loans-stat-label"><span className="loans-stat-icon"><Wallet size={19} /></span> Net balance</div>
            <p className="loans-stat-value">{formatAmount(remaining)}</p>
            <p className="loans-caption">{remaining === 0 ? 'Lending and borrowing are in balance' : 'More owed to you than you owe'}</p>
          </div>
        </section>
        <div className="loans-list">
          <div className="loans-list-heading" aria-hidden="true"><span>Contact / loan</span><span>Balance remaining</span><span>Due date</span><span>Status</span><span /></div>
          <article className="loans-row">
            <div className="loans-person"><span className="loans-avatar loans-positive"><ArrowUpRight size={20} /></span><div className="loans-person-copy"><span className="loans-name">Ani</span><p className="loans-caption loans-description">Concert tickets</p><span className="loans-direction">Owes you</span></div></div>
            <div className="loans-amount"><strong>{formatAmount(remaining)}</strong><span className="loans-caption">of {formatAmount(lent)}</span></div>
            <div className="loans-due"><span className="loans-mobile-label">Due </span>{formatDate(due)}</div>
            <div className="loans-status"><span key={String(repaid)} className={cn('loans-badge animate-[finance-page-header-in_300ms_ease-out]', repaid ? 'is-repaid' : 'is-active')}>{repaid ? 'Repaid' : 'Active'}</span></div>
            <div className="loans-row-actions">{repaid ? <span className="loans-details">Details <ChevronRight size={15} /></span> : <Button variant="secondary" size="sm" tabIndex={-1} className={cn(step >= 1 && 'ring-4 ring-[var(--color-accent)]/25')}>Record payment</Button>}<span className="loans-icon-button" aria-hidden><Trash2 size={15} /></span></div>
          </article>
        </div>
      </div>
    </VisualFrame>
  );
}
