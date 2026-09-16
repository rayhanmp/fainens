import { createFileRoute, Link } from '@tanstack/react-router';
import './loans.css';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { RequireAuth } from '../lib/auth';
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useArchiveContactMutation,
  useDeleteLoanMutation,
  useLoansQuery,
  useRestoreContactMutation,
} from '../features/loans/queries';
import { invalidateFinancialSummaries } from '../features/core/query-keys';
import { formatCurrency, cn } from '../lib/utils';
import { NewLoanModal } from '../components/loans/NewLoanModal';
import { RecordPaymentModal } from '../components/loans/RecordPaymentModal';
import { ContactProfileModal } from '../components/loans/ContactProfileModal';
import { NewContactModal } from '../components/loans/NewContactModal';
import { useConfirm } from '../components/ui/ConfirmDialog';
import {
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  Search,
  Users,
  ReceiptText,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Archive,
  RotateCcw,
} from 'lucide-react';

export const Route = createFileRoute('/loans')({
  component: LoansPage,
} as any);

type Loan = {
  id: number;
  contactId: number;
  direction: 'lent' | 'borrowed';
  amountCents: number;
  remainingCents: number;
  startDate: number;
  dueDate: number | null;
  status: string;
  description: string | null;
  contact: { id: number; name: string };
  isOverdue: boolean;
  daysOverdue: number;
  sourceType?: string;
  sourceTransactionId?: number | null;
  sourceDescription?: string;
  tags?: Array<{ id: number; name: string; color: string }>;
};

type ContactSummary = {
  id: number;
  name: string;
  totalLent: number;
  totalBorrowed: number;
  netBalance: number;
  activeLoansCount: number;
  isActive: boolean;
};

type Summary = {
  totalLent: number;
  totalBorrowed: number;
  netPosition: number;
  totalRepaid: number;
  activeLoansCount: number;
  repaidLoansCount: number;
  defaultedLoansCount: number;
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function LoansPage() {
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const loansQuery = useLoansQuery(showArchived);
  const deleteLoanMutation = useDeleteLoanMutation();
  const archiveContactMutation = useArchiveContactMutation();
  const restoreContactMutation = useRestoreContactMutation();
  const loans = (loansQuery.data?.loans ?? []) as Loan[];
  const contacts = (loansQuery.data?.contacts ?? [])
    .filter((contact) => showArchived || contact.isActive) as ContactSummary[];
  const summary = (loansQuery.data?.summary ?? null) as Summary | null;
  const isLoading = loansQuery.isPending && !loansQuery.data;
  const splitBills = useMemo(() => {
    const grouped = new Map<number, Loan[]>();
    for (const loan of loans) {
      if (loan.sourceType !== 'split_bill' || !loan.sourceTransactionId) continue;
      const group = grouped.get(loan.sourceTransactionId) ?? [];
      group.push(loan);
      grouped.set(loan.sourceTransactionId, group);
    }
    return [...grouped.entries()].sort((a, b) => b[0] - a[0]);
  }, [loans]);
  const [isNewLoanModalOpen, setIsNewLoanModalOpen] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const [isContactProfileOpen, setIsContactProfileOpen] = useState(false);
  const [isNewContactModalOpen, setIsNewContactModalOpen] = useState(false);
  const { confirm } = useConfirm();

  const loadData = useCallback(
    () => invalidateFinancialSummaries(queryClient),
    [queryClient],
  );

  // Group contacts by net balance for display
  const contactsWithLoans = useMemo(() => {
    return [...contacts].sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance));
  }, [contacts]);

  const [view, setView] = useState<'loans' | 'contacts' | 'split'>('loans');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [direction, setDirection] = useState('all');
  const searchTerm = search.trim().toLowerCase();
  const overdueCount = loans.filter(loan => loan.status === 'active' && loan.isOverdue).length;
  const matchesSearch = (loan: Loan) => [loan.contact.name, loan.description, loan.sourceDescription, ...(loan.tags?.map(tag => tag.name) ?? [])].join(' ').toLowerCase().includes(searchTerm);
  const filteredLoans = [...loans]
    .filter(loan => (status === 'all' || (status === 'overdue' ? loan.status === 'active' && loan.isOverdue : loan.status === status))
      && (direction === 'all' || loan.direction === direction) && matchesSearch(loan))
    .sort((a, b) => Number(b.status === 'active' && b.isOverdue) - Number(a.status === 'active' && a.isOverdue)
      || Number(b.status === 'active') - Number(a.status === 'active') || b.startDate - a.startDate);
  const filteredContacts = contactsWithLoans.filter(contact => contact.name.toLowerCase().includes(searchTerm));
  const filteredSplitBills = splitBills.filter(([, group]) => group.some(matchesSearch));

  const openContact = (contactId: number) => {
    setSelectedContactId(contactId);
    setIsContactProfileOpen(true);
  };

  const handleDeleteLoan = async (loan: Loan) => {
    const confirmed = await confirm({
      title: 'Delete loan',
      message: 'Delete this loan? This will also delete the associated transaction.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteLoanMutation.mutateAsync(loan.id);
      void loadData();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleLoanCreated = () => {
    setIsNewLoanModalOpen(false);
    void loadData();
  };

  const handleContactCreated = () => {
    setIsNewContactModalOpen(false);
    void loadData();
  };

  const handleContactLifecycle = async (contact: ContactSummary) => {
    const isArchiving = contact.isActive;
    const confirmed = await confirm({
      title: isArchiving ? 'Archive contact' : 'Restore contact',
      message: isArchiving
        ? `Archive ${contact.name}? Their loan history will be kept, but they will be hidden from active contact lists.`
        : `Restore ${contact.name} to your active contact lists?`,
      confirmLabel: isArchiving ? 'Archive' : 'Restore',
      variant: isArchiving ? 'danger' : 'default',
    });
    if (!confirmed) return;

    try {
      if (isArchiving) {
        await archiveContactMutation.mutateAsync(contact.id);
      } else {
        await restoreContactMutation.mutateAsync(contact.id);
      }
      await loadData();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handlePaymentRecorded = () => {
    setIsPaymentModalOpen(false);
    setSelectedLoan(null);
    void loadData();
  };

  const openPaymentModal = (loan: Loan) => {
    setSelectedLoan(loan);
    setIsPaymentModalOpen(true);
  };

  if (isLoading) {
    return (
      <RequireAuth>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--ref-primary)]" />
        </div>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <PageContainer className="loans-page">
        <div className="loans-heading">
          <PageHeader subtext="Lending & borrowing" title="Loans" description="A clear view of what you owe and what comes back to you." />
          <div className="loans-heading-actions">
            <Button variant="secondary" onClick={() => setIsNewContactModalOpen(true)}><Users size={16} /> Add contact</Button>
            <Button onClick={() => setIsNewLoanModalOpen(true)}><Plus size={16} /> New loan</Button>
          </div>
        </div>
        {loansQuery.isError && <div className="loans-error" role="alert"><AlertCircle size={18} /><span>We couldn't load your loans. Please try again.</span><Button size="sm" variant="secondary" onClick={() => void loansQuery.refetch()}>Retry</Button></div>}
        <section className="loans-summary" aria-label="Loan balances">
          <div className="loans-stat">
            <div className="loans-stat-label"><span className="loans-stat-icon loans-positive"><ArrowUpRight size={19} /></span> Owed to you</div>
            <p className="loans-stat-value">{formatCurrency(summary?.totalLent ?? 0)}</p>
            <p className="loans-caption">Outstanding money you've lent</p>
          </div>
          <div className="loans-stat">
            <div className="loans-stat-label"><span className="loans-stat-icon loans-debt"><ArrowDownRight size={19} /></span> You owe</div>
            <p className="loans-stat-value">{formatCurrency(summary?.totalBorrowed ?? 0)}</p>
            <p className="loans-caption">Outstanding money you've borrowed</p>
          </div>
          <div className="loans-stat loans-stat-net">
            <div className="loans-stat-label"><span className="loans-stat-icon"><Wallet size={19} /></span> Net balance</div>
            <p className="loans-stat-value">{formatCurrency(summary?.netPosition ?? 0)}</p>
            <p className="loans-caption">{(summary?.netPosition ?? 0) === 0 ? 'Lending and borrowing are in balance' : (summary?.netPosition ?? 0) > 0 ? 'More owed to you than you owe' : 'More to pay back than to receive'}</p>
          </div>
        </section>
        <div className="loans-overview">
          <span><span className="loans-dot" /><strong>{summary?.activeLoansCount ?? 0}</strong> active loans</span>
          <span><CheckCircle2 size={15} /><strong>{summary?.repaidLoansCount ?? 0}</strong> repaid</span>
          {overdueCount > 0 && <button className="loans-overdue-link" onClick={() => { setView('loans'); setStatus('overdue'); setDirection('all'); setSearch(''); }}><AlertCircle size={15} />{overdueCount} overdue <ChevronRight size={14} /></button>}
        </div>
        <section className="loans-workspace" aria-label="Loan records and contacts">
          <div className="loans-tabs" aria-label="Views">
            {([
              ['loans', 'All loans', ReceiptText, loans.length],
              ['contacts', 'Contacts', Users, contacts.length],
              ['split', 'Split bills', Wallet, splitBills.length],
            ] as const).map(([key, label, Icon, count]) => <button key={key} aria-pressed={view === key} className={cn('loans-tab', view === key && 'is-selected')} onClick={() => { setView(key); setSearch(''); }}><Icon size={17} /><span>{label}</span><span className="loans-tab-count">{count}</span></button>)}
          </div>
          <div className="loans-toolbar">
            <label className="loans-search"><Search size={17} /><input aria-label={'Search ' + (view === 'split' ? 'split bills' : view)} placeholder={view === 'contacts' ? 'Search contacts...' : 'Search by name or description...'} value={search} onChange={event => setSearch(event.target.value)} /></label>
            {view === 'loans' && <div className="loans-filters">
              <select aria-label="Loan direction" value={direction} onChange={event => setDirection(event.target.value)}><option value="all">All directions</option><option value="lent">Owed to you</option><option value="borrowed">You owe</option></select>
              <select aria-label="Loan status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="overdue">Overdue</option><option value="repaid">Repaid</option><option value="defaulted">Defaulted</option><option value="written_off">Written off</option></select>
            </div>}
            {view === 'contacts' && <label className="loans-archived"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} /> Show archived</label>}
          </div>
          {view === 'loans' && <>
            {filteredLoans.length > 0 ? <div className="loans-list">
              <div className="loans-list-heading" aria-hidden="true"><span>Contact / loan</span><span>Balance remaining</span><span>Due date</span><span>Status</span><span /></div>
              {filteredLoans.map(loan => <article className="loans-row" key={loan.id}>
                <div className="loans-person"><span className={cn('loans-avatar', loan.direction === 'lent' ? 'loans-positive' : 'loans-debt')}>{loan.direction === 'lent' ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}</span><div className="loans-person-copy"><button className="loans-name" onClick={() => openContact(loan.contactId)}>{loan.contact.name}</button><p className="loans-caption loans-description" title={loan.description ?? undefined}>{loan.description || (loan.direction === 'lent' ? 'Money lent' : 'Money borrowed')}</p><span className="loans-direction">{loan.direction === 'lent' ? 'Owes you' : 'You owe'}</span></div></div>
                <div className="loans-amount"><strong>{formatCurrency(loan.remainingCents)}</strong><span className="loans-caption">of {formatCurrency(loan.amountCents)}</span></div>
                <div className="loans-due"><span className="loans-mobile-label">Due </span>{loan.dueDate ? new Date(loan.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No due date'}</div>
                <div className="loans-status"><span className={cn('loans-badge', loan.status === 'active' && loan.isOverdue ? 'is-overdue' : loan.status === 'repaid' ? 'is-repaid' : loan.status === 'active' ? 'is-active' : '')}>{loan.status === 'active' && loan.isOverdue ? 'Overdue' : loan.status === 'written_off' ? 'Written off' : loan.status.charAt(0).toUpperCase() + loan.status.slice(1)}</span></div>
                <div className="loans-row-actions">{loan.status === 'active' && loan.remainingCents > 0 ? <Button variant="secondary" size="sm" onClick={() => openPaymentModal(loan)}>Record payment</Button> : <button className="loans-details" onClick={() => openContact(loan.contactId)}>Details <ChevronRight size={15} /></button>}<button className="loans-icon-button" aria-label={'Delete loan for ' + loan.contact.name} title="Delete loan" disabled={deleteLoanMutation.isPending} onClick={() => void handleDeleteLoan(loan)}><Trash2 size={15} /></button></div>
              </article>)}
              <div className="loans-list-footer">Showing {filteredLoans.length} of {loans.length} loans <span>Overdue and active loans appear first</span></div>
            </div> : <div className="loans-empty"><span className="loans-empty-icon"><ReceiptText size={26} /></span><h2>{loans.length === 0 ? 'Your loans, all in one place' : 'No loans match these filters'}</h2><p>{loans.length === 0 ? 'Add money you have lent or borrowed to start tracking repayments.' : 'Try another name, direction, or status.'}</p>{loans.length === 0 ? <Button onClick={() => setIsNewLoanModalOpen(true)}><Plus size={16} /> Add your first loan</Button> : <Button variant="secondary" onClick={() => { setSearch(''); setStatus('all'); setDirection('all'); }}>Clear filters</Button>}</div>}
          </>}
          {view === 'contacts' && <div className="loans-contacts">
            {filteredContacts.map(contact => <article className="loans-contact" key={contact.id}>
              <div className="loans-person"><span className="loans-avatar">{getInitials(contact.name)}</span><div className="loans-person-copy"><button className="loans-name" onClick={() => openContact(contact.id)}>{contact.name}</button><p className="loans-caption">{contact.activeLoansCount} active {contact.activeLoansCount === 1 ? 'loan' : 'loans'}{!contact.isActive && ' · Archived'}</p></div></div>
              <div className="loans-contact-balance"><span className="loans-caption">{contact.netBalance > 0 ? 'Owes you' : contact.netBalance < 0 ? 'You owe' : 'Settled up'}</span><strong className={cn(contact.netBalance > 0 && 'loans-positive-text', contact.netBalance < 0 && 'loans-debt-text')}>{formatCurrency(Math.abs(contact.netBalance))}</strong></div>
              <div className="loans-contact-actions"><button className="loans-details" onClick={() => openContact(contact.id)}>View details <ChevronRight size={15} /></button><button className="loans-icon-button" aria-label={(contact.isActive ? 'Archive ' : 'Restore ') + contact.name} title={contact.isActive ? 'Archive contact' : 'Restore contact'} disabled={archiveContactMutation.isPending || restoreContactMutation.isPending} onClick={() => void handleContactLifecycle(contact)}>{contact.isActive ? <Archive size={16} /> : <RotateCcw size={16} />}</button></div>
            </article>)}
            {filteredContacts.length === 0 && <div className="loans-empty"><Users size={28} /><h2>{searchTerm ? 'No matching contacts' : 'Your lending circle starts here'}</h2><p>{searchTerm ? 'Try searching for another name.' : 'Add a contact to keep your loans organized by person.'}</p><Button variant="secondary" onClick={() => setIsNewContactModalOpen(true)}>Add contact</Button></div>}
          </div>}
          {view === 'split' && <div className="loans-split-list">
            {filteredSplitBills.map(([sourceId, group]) => <article className="loans-split-card" key={sourceId}>
              <div className="loans-split-heading"><div><span className="loans-eyebrow">Shared expense · {group.length} {group.length === 1 ? 'person' : 'people'}</span><h2>{(group[0]?.sourceDescription ?? group[0]?.description ?? 'Split bill').replace(/^Split bill - /, '')}</h2></div><Link to="/transactions" search={{ periodId: 'all', transactionId: String(sourceId) }} className="loans-details">Source payment <ArrowUpRight size={15} /></Link></div>
              <div className="loans-tags">{group[0]?.tags?.map(tag => <span key={tag.id}>{tag.name}</span>)}</div>
              {group.map(loan => <div className="loans-split-person" key={loan.id}><button className="loans-name" onClick={() => openContact(loan.contactId)}>{loan.contact.name}<span className="loans-caption">{loan.direction === 'lent' ? 'Owes you' : 'You owe'}</span></button><span className="loans-caption">{loan.status === 'written_off' ? 'Written off' : loan.status}</span><strong>{formatCurrency(loan.remainingCents)}</strong>{loan.status === 'active' && loan.remainingCents > 0 && <Button variant="secondary" size="sm" onClick={() => openPaymentModal(loan)}>Record payment</Button>}</div>)}
              <div className="loans-split-footer"><div><span>To receive <strong>{formatCurrency(group.filter(loan => loan.direction === 'lent' && loan.status === 'active').reduce((sum, loan) => sum + loan.remainingCents, 0))}</strong></span>{group.some(loan => loan.direction === 'borrowed') && <span>To pay <strong>{formatCurrency(group.filter(loan => loan.direction === 'borrowed' && loan.status === 'active').reduce((sum, loan) => sum + loan.remainingCents, 0))}</strong></span>}</div>{group[0]?.tags?.filter(tag => tag.name === 'Split bill #' + sourceId).map(tag => <Link key={tag.id} to="/transactions" search={{ periodId: 'all', tagId: String(tag.id) }} className="loans-details">Bill activity <ChevronRight size={15} /></Link>)}</div>
            </article>)}
            {filteredSplitBills.length === 0 && <div className="loans-empty"><ReceiptText size={28} /><h2>{searchTerm ? 'No matching split bills' : 'No split bills yet'}</h2><p>{searchTerm ? 'Try another name or description.' : 'Shared expenses linked to your loans will appear here.'}</p></div>}
          </div>}
        </section>
      </PageContainer>

      {/* Modals */}
      <NewLoanModal
        isOpen={isNewLoanModalOpen}
        onClose={() => setIsNewLoanModalOpen(false)}
        onSuccess={handleLoanCreated}
      />

      {selectedLoan && (
        <RecordPaymentModal
          isOpen={isPaymentModalOpen}
          onClose={() => {
            setIsPaymentModalOpen(false);
            setSelectedLoan(null);
          }}
          onSuccess={handlePaymentRecorded}
          loan={selectedLoan}
        />
      )}

      <ContactProfileModal
        contactId={selectedContactId}
        isOpen={isContactProfileOpen}
        onClose={() => {
          setIsContactProfileOpen(false);
          setSelectedContactId(null);
        }}
      />

      <NewContactModal
        isOpen={isNewContactModalOpen}
        onClose={() => setIsNewContactModalOpen(false)}
        onSuccess={handleContactCreated}
      />
    </RequireAuth>
  );
}

export default LoansPage;
