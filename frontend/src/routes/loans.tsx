import { createFileRoute } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { RequireAuth } from '../lib/auth';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatCurrency, cn } from '../lib/utils';
import { NewLoanModal } from '../components/loans/NewLoanModal';
import { RecordPaymentModal } from '../components/loans/RecordPaymentModal';
import { ContactProfileModal } from '../components/loans/ContactProfileModal';
import {
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  History,
  AlertCircle,
  User,
  ChevronRight,
  Clock,
  Trash2,
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
};

type ContactSummary = {
  id: number;
  name: string;
  totalLent: number;
  totalBorrowed: number;
  netBalance: number;
  activeLoansCount: number;
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
  const [loans, setLoans] = useState<Loan[]>([]);
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isNewLoanModalOpen, setIsNewLoanModalOpen] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const [isContactProfileOpen, setIsContactProfileOpen] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [loansData, contactsData, summaryData] = await Promise.all([
        api.loans.list(),
        api.contacts.list(),
        api.loans.summary(),
      ]);
      setLoans(loansData);
      setContacts(contactsData);
      setSummary(summaryData);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Group contacts by net balance for display
  const contactsWithLoans = useMemo(() => {
    return contacts
      .filter(c => c.activeLoansCount > 0)
      .sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance));
  }, [contacts]);

  // Recent activity (last 5 loans)
  const recentActivity = useMemo(() => {
    return loans
      .slice(0, 5)
      .map(loan => ({
        ...loan,
        date: new Date(loan.startDate).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
      }));
  }, [loans]);

  const handleLoanCreated = () => {
    setIsNewLoanModalOpen(false);
    loadData();
  };

  const handlePaymentRecorded = () => {
    setIsPaymentModalOpen(false);
    setSelectedLoan(null);
    loadData();
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
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Hero Section */}
        <section className="mb-12">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
            <div>
              <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-[var(--color-text-primary)] mb-2">
                Command Center
              </h1>
              <p className="text-[var(--color-muted)] text-lg">
                Manage your private lending circle with precision.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => {}}
                className="flex items-center gap-2"
                disabled
              >
                <History className="w-4 h-4" />
                History
              </Button>
              <Button
                onClick={() => setIsNewLoanModalOpen(true)}
                className="flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                New Loan
              </Button>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Total Lent */}
            <div className="bg-[var(--ref-primary-container)] p-8 rounded-2xl flex flex-col justify-between min-h-[200px]">
              <div className="flex justify-between items-start">
                <div className="p-3 bg-white/10 rounded-xl">
                  <ArrowUpRight className="w-6 h-6 text-white" />
                </div>
                <span className="text-white/60 text-sm font-medium">Lending Activity</span>
              </div>
              <div>
                <p className="text-white/80 font-medium mb-1">Total Lent Out</p>
                <h2 className="text-white text-4xl font-bold">
                  {formatCurrency(summary?.totalLent || 0)}
                </h2>
              </div>
            </div>

            {/* Total Borrowed */}
            <div className="bg-[var(--ref-surface-container-lowest)] p-8 rounded-2xl flex flex-col justify-between min-h-[200px] editorial-shadow border border-[var(--color-border)]">
              <div className="flex justify-between items-start">
                <div className="p-3 bg-[var(--ref-secondary-container)] rounded-xl">
                  <ArrowDownRight className="w-6 h-6 text-[var(--ref-on-secondary-container)]" />
                </div>
                <span className="text-[var(--color-muted)] text-sm font-medium">Debt Portfolio</span>
              </div>
              <div>
                <p className="text-[var(--color-muted)] font-medium mb-1">My Total Debt</p>
                <h2 className="text-[var(--color-text-primary)] text-4xl font-bold">
                  {formatCurrency(summary?.totalBorrowed || 0)}
                </h2>
              </div>
            </div>

            {/* Net Position */}
            <div className={cn(
              "p-8 rounded-2xl flex flex-col justify-between min-h-[200px]",
              (summary?.netPosition || 0) >= 0 
                ? "bg-[var(--ref-secondary)]" 
                : "bg-[var(--ref-error)]"
            )}>
              <div className="flex justify-between items-start">
                <div className="p-3 bg-white/10 rounded-xl">
                  <Wallet className="w-6 h-6 text-white" />
                </div>
                <div className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded-full",
                  "bg-white/20"
                )}>
                  {(summary?.netPosition || 0) >= 0 ? (
                    <ArrowUpRight className="w-4 h-4 text-white" />
                  ) : (
                    <ArrowDownRight className="w-4 h-4 text-white" />
                  )}
                  <span className="text-white text-xs font-bold">
                    {(summary?.netPosition || 0) >= 0 ? '+' : ''}
                    {formatCurrency(Math.abs(summary?.netPosition || 0))}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-white/80 font-medium mb-1">Net Position</p>
                <h2 className="text-white text-4xl font-bold">
                  {formatCurrency(summary?.netPosition || 0)}
                </h2>
              </div>
            </div>
          </div>
        </section>

        {/* Contact Network Grid */}
        <section className="mb-12">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-2xl font-bold text-[var(--color-text-primary)]">Contact Network</h3>
            <span className="text-[var(--color-muted)] flex items-center gap-1 text-sm">
              View all contacts
              <ChevronRight className="w-4 h-4" />
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {contactsWithLoans.map((contact) => (
              <div
                key={contact.id}
                className="bg-[var(--ref-surface-container-lowest)] rounded-2xl p-6 editorial-shadow border border-[var(--color-border)] hover:shadow-lg transition-shadow"
              >
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-14 h-14 rounded-full bg-[var(--ref-primary-container)] flex items-center justify-center text-white font-bold text-lg">
                    {getInitials(contact.name)}
                  </div>
                  <div>
                    <h4 className="font-bold text-lg text-[var(--color-text-primary)]">
                      {contact.name}
                    </h4>
                    <p className="text-sm text-[var(--color-muted)] flex items-center gap-1">
                      <span
                        className={cn(
                          'w-2 h-2 rounded-full',
                          contact.netBalance > 0
                            ? 'bg-[var(--ref-secondary)]'
                            : contact.netBalance < 0
                            ? 'bg-[var(--ref-error)]'
                            : 'bg-[var(--color-muted)]'
                        )}
                      />
                      {contact.netBalance > 0
                        ? 'Owes You'
                        : contact.netBalance < 0
                        ? 'You Owe'
                        : 'Settled'}
                    </p>
                  </div>
                </div>

                <div className="mb-6 bg-[var(--ref-surface-container-low)] p-4 rounded-xl">
                  <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    {contact.netBalance > 0 ? 'Balance Owed to You' : 'Balance You Owe'}
                  </p>
                  <p
                    className={cn(
                      'text-2xl font-bold',
                      contact.netBalance > 0
                        ? 'text-[var(--ref-secondary)]'
                        : 'text-[var(--ref-error)]'
                    )}
                  >
                    {formatCurrency(Math.abs(contact.netBalance))}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    size="sm"
                    onClick={() => {
                      const loan = loans.find(
                        l => l.contactId === contact.id && l.status === 'active'
                      );
                      if (loan) openPaymentModal(loan);
                    }}
                    disabled={!loans.some(
                      l => l.contactId === contact.id && l.status === 'active'
                    )}
                  >
                    {contact.netBalance > 0 ? 'Record' : 'Pay'}
                  </Button>
                  <Button 
                    variant="secondary" 
                    size="sm"
                    onClick={() => {
                      setSelectedContactId(contact.id);
                      setIsContactProfileOpen(true);
                    }}
                  >
                    Details
                  </Button>
                </div>
              </div>
            ))}

            {/* Add Contact Card */}
            <button
              onClick={() => setIsNewLoanModalOpen(true)}
              className="border-2 border-dashed border-[var(--color-border)] rounded-2xl p-6 flex flex-col items-center justify-center min-h-[250px] group cursor-pointer hover:border-[var(--ref-primary)]/50 transition-colors text-left"
            >
              <div className="w-12 h-12 rounded-full bg-[var(--ref-surface-container-high)] flex items-center justify-center mb-4 group-hover:bg-[var(--ref-primary-container)] transition-colors">
                <User className="w-6 h-6 text-[var(--color-muted)] group-hover:text-white" />
              </div>
              <p className="font-bold text-[var(--color-text-primary)]">Add Contact</p>
              <p className="text-sm text-[var(--color-muted)] text-center mt-1">
                Start tracking a new loan
              </p>
            </button>
          </div>
        </section>

        {/* Bottom Section: Recent Activity */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Cash Flow Narrative */}
          <div className="bg-[var(--ref-surface-container-low)] rounded-2xl p-8 relative overflow-hidden">
            <div className="relative z-10">
              <h3 className="text-2xl font-bold mb-4">Cash Flow Narrative</h3>
              <p className="text-[var(--color-muted)] leading-relaxed mb-8 max-w-md">
                Your lending activity shows a healthy balance. You are currently a net{' '}
                {(summary?.netPosition || 0) >= 0 ? 'lender' : 'borrower'} with{' '}
                {formatCurrency(Math.abs(summary?.netPosition || 0))} in{' '}
                {(summary?.netPosition || 0) >= 0 ? 'outstanding receivables' : 'outstanding payables'}.
              </p>
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-xs font-bold text-[var(--color-muted)] uppercase tracking-widest mb-1">
                    Active Loans
                  </p>
                  <p className="text-2xl font-bold">{summary?.activeLoansCount || 0}</p>
                </div>
                <div className="w-px h-10 bg-[var(--color-border)]" />
                <div>
                  <p className="text-xs font-bold text-[var(--color-muted)] uppercase tracking-widest mb-1">
                    Active Contacts
                  </p>
                  <p className="text-2xl font-bold">{contactsWithLoans.length}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Activity List */}
          <div className="bg-[var(--ref-surface-container-lowest)] rounded-2xl p-8 editorial-shadow border border-[var(--color-border)]">
            <h3 className="text-xl font-bold mb-6">Recent Records</h3>
            <div className="space-y-4">
              {recentActivity.length === 0 ? (
                <p className="text-[var(--color-muted)] text-center py-8">
                  No recent loan activity
                </p>
              ) : (
                recentActivity.map((loan) => (
                  <div key={loan.id} className="flex items-center justify-between group">
                    <div className="flex items-center gap-4">
                      <div
                        className={cn(
                          'p-2 rounded-lg',
                          loan.direction === 'lent'
                            ? 'bg-[var(--ref-secondary-container)]'
                            : 'bg-[var(--ref-primary-container)]'
                        )}
                      >
                        {loan.direction === 'lent' ? (
                          <ArrowUpRight className="w-5 h-5 text-[var(--ref-on-secondary-container)]" />
                        ) : (
                          <ArrowDownRight className="w-5 h-5 text-white" />
                        )}
                      </div>
                      <div>
                        <p className="font-bold text-[var(--color-text-primary)]">
                          {loan.direction === 'lent' ? 'Lent to' : 'Borrowed from'}{' '}
                          {loan.contact.name}
                        </p>
                        <p className="text-xs text-[var(--color-muted)] flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {loan.date}
                          {loan.isOverdue && (
                            <span className="text-[var(--ref-error)] flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              Overdue
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <p
                        className={cn(
                          'font-bold',
                          loan.direction === 'lent'
                            ? 'text-[var(--color-text-primary)]'
                            : 'text-[var(--ref-error)]'
                        )}
                      >
                        {formatCurrency(loan.amountCents)}
                      </p>
                      <button
                        onClick={async () => {
                          if (confirm('Delete this loan? This will also delete the associated transaction.')) {
                            try {
                              await api.loans.delete(loan.id);
                              loadData();
                            } catch (err) {
                              alert((err as Error).message);
                            }
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 p-2 text-[var(--color-muted)] hover:text-[var(--ref-error)] hover:bg-[var(--ref-error)]/10 rounded-lg transition-all"
                        title="Delete loan"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>

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
    </RequireAuth>
  );
}

export default LoansPage;
