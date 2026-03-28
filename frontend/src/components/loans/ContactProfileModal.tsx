import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { formatCurrency } from '../../lib/utils';
import { 
  Phone, 
  Mail, 
  User, 
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  CheckCircle2,
  XCircle,
  UserX,
  Pencil,
  X,
  Save,
  FileText,
} from 'lucide-react';


interface ContactProfileModalProps {
  contactId: number | null;
  isOpen: boolean;
  onClose: () => void;
}

interface Loan {
  id: number;
  contactId: number;
  direction: 'lent' | 'borrowed';
  amountCents: number;
  remainingCents: number;
  startDate: number;
  dueDate: number | null;
  status: 'active' | 'repaid' | 'defaulted' | 'written_off';
  description: string | null;
  createdAt: number;
}

interface ContactDetails {
  id: number;
  name: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  relationshipType: string | null;
  notes: string | null;
  createdAt: number;
  loans: Loan[];
  summary: {
    totalLent: number;
    totalBorrowed: number;
    netBalance: number;
    activeLoansCount: number;
    repaidLoansCount: number;
    totalLentAllTime: number;
    totalBorrowedAllTime: number;
  };
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  family: 'Family',
  friend: 'Friend',
  colleague: 'Colleague',
  professional: 'Professional',
  others: 'Others',
};

export function ContactProfileModal({ contactId, isOpen, onClose }: ContactProfileModalProps) {
  const [contact, setContact] = useState<ContactDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'loans'>('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    fullName: '',
    email: '',
    phone: '',
    relationshipType: '',
    notes: '',
  });

  useEffect(() => {
    if (isOpen && contactId) {
      loadContact();
    }
  }, [isOpen, contactId]);

  const loadContact = async () => {
    if (!contactId) return;
    
    setIsLoading(true);
    setError('');
    setIsEditing(false);
    try {
      const data = await api.contacts.get(contactId);
      setContact(data);
      setEditForm({
        name: data.name || '',
        fullName: data.fullName || '',
        email: data.email || '',
        phone: data.phone || '',
        relationshipType: data.relationshipType || '',
        notes: data.notes || '',
      });
    } catch (err) {
      setError('Failed to load contact details');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const formatPhone = (phone: string | null) => {
    if (!phone) return null;
    // Format Indonesian phone number
    if (phone.startsWith('0')) {
      return '+62' + phone.slice(1);
    }
    return '+62' + phone;
  };

  const formatDate = (date: number | Date | string | null | undefined, options?: Intl.DateTimeFormatOptions) => {
    if (!date) return '';
    let dateObj: Date;
    if (typeof date === 'number') {
      dateObj = new Date(date);
    } else if (typeof date === 'string') {
      dateObj = new Date(date);
    } else {
      dateObj = date;
    }
    if (isNaN(dateObj.getTime())) {
      return '';
    }
    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    };
    return dateObj.toLocaleDateString('en-US', options || defaultOptions);
  };

  const getLoanStatusIcon = (status: string) => {
    switch (status) {
      case 'repaid':
        return <CheckCircle2 className="w-4 h-4 text-[var(--color-success)]" />;
      case 'defaulted':
      case 'written_off':
        return <XCircle className="w-4 h-4 text-[var(--color-danger)]" />;
      default:
        return <Clock className="w-4 h-4 text-[var(--color-warning)]" />;
    }
  };

  const getLoanStatusText = (status: string) => {
    switch (status) {
      case 'repaid':
        return 'Repaid';
      case 'defaulted':
        return 'Defaulted';
      case 'written_off':
        return 'Written Off';
      default:
        return 'Active';
    }
  };

  const handleSaveEdit = async () => {
    if (!contactId || !editForm.name.trim()) return;

    setIsSaving(true);
    try {
      const updated = await api.contacts.update(contactId, {
        name: editForm.name.trim(),
        fullName: editForm.fullName.trim() || null,
        email: editForm.email.trim() || null,
        phone: editForm.phone.trim() || null,
        relationshipType: editForm.relationshipType || null,
        notes: editForm.notes.trim() || null,
      });
      setContact(prev => prev ? { ...prev, ...updated } : null);
      setIsEditing(false);
    } catch (err) {
      setError('Failed to update contact');
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  if (!contactId) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Contact Profile"
      size="xl"
      className="max-w-4xl"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : error ? (
        <div className="p-4 bg-[var(--ref-error-container)] text-[var(--ref-on-error-container)] rounded-xl text-sm font-medium">
          {error}
        </div>
      ) : contact ? (
        <div className="flex flex-col md:flex-row gap-0">
          {/* Left Sidebar - Contact Info */}
          <div className="w-full md:w-1/3 bg-[var(--ref-surface-container-low)] p-6 md:p-8">
            {/* Avatar */}
            <div className="flex flex-col items-center mb-6">
              <div className="w-24 h-24 rounded-full bg-[var(--ref-primary-container)] flex items-center justify-center mb-4">
                <span className="text-2xl font-bold text-white">
                  {getInitials(isEditing ? editForm.name : contact.name)}
                </span>
              </div>
              {isEditing ? (
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="text-xl font-bold text-[var(--color-text-primary)] text-center bg-transparent border-b border-[var(--color-border)] focus:border-primary outline-none w-full py-1"
                  placeholder="Name"
                />
              ) : (
                <h2 className="text-xl font-bold text-[var(--color-text-primary)] text-center">
                  {contact.name}
                </h2>
              )}
              {isEditing ? (
                <input
                  type="text"
                  value={editForm.fullName}
                  onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                  className="text-sm text-[var(--color-muted)] text-center bg-transparent border-b border-[var(--color-border)] focus:border-primary outline-none w-full py-1 mt-1"
                  placeholder="Full Name (optional)"
                />
              ) : (
                contact.fullName && contact.fullName !== contact.name && (
                  <p className="text-sm text-[var(--color-muted)] text-center">
                    {contact.fullName}
                  </p>
                )
              )}
              {isEditing ? (
                <select
                  value={editForm.relationshipType}
                  onChange={(e) => setEditForm({ ...editForm, relationshipType: e.target.value })}
                  className="mt-2 px-3 py-1 bg-[var(--ref-surface-container-highest)] rounded-full text-xs font-medium text-[var(--color-text-secondary)] border-none outline-none cursor-pointer"
                >
                  <option value="">No relationship</option>
                  {Object.entries(RELATIONSHIP_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              ) : contact.relationshipType ? (
                <span className="mt-2 px-3 py-1 bg-[var(--ref-surface-container-highest)] rounded-full text-xs font-medium text-[var(--color-text-secondary)]">
                  {RELATIONSHIP_LABELS[contact.relationshipType] || contact.relationshipType}
                </span>
              ) : null}
            </div>

            {/* Edit/Save Actions */}
            <div className="flex justify-center gap-2 mb-6">
              {isEditing ? (
                <>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="p-2 rounded-lg bg-[var(--ref-surface-container-highest)] text-[var(--color-muted)] hover:bg-[var(--color-border)] transition-colors"
                    disabled={isSaving}
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={isSaving || !editForm.name.trim()}
                    className="p-2 rounded-lg bg-[var(--ref-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {isSaving ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-[var(--color-muted)] hover:bg-[var(--ref-surface-container-highest)] transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                  Edit
                </button>
              )}
            </div>

            {/* Contact Details */}
            <div className="space-y-4">
              {isEditing ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-highest)] flex items-center justify-center">
                      <Phone className="w-5 h-5 text-[var(--color-muted)]" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-[var(--color-muted)]">Phone</p>
                      <input
                        type="tel"
                        value={editForm.phone}
                        onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                        className="w-full text-sm font-medium text-[var(--color-text-primary)] bg-transparent border-b border-[var(--color-border)] focus:border-primary outline-none py-1"
                        placeholder="Phone number"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-highest)] flex items-center justify-center">
                      <Mail className="w-5 h-5 text-[var(--color-muted)]" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-[var(--color-muted)]">Email</p>
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                        className="w-full text-sm font-medium text-[var(--color-text-primary)] bg-transparent border-b border-[var(--color-border)] focus:border-primary outline-none py-1"
                        placeholder="Email address"
                      />
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-highest)] flex items-center justify-center">
                      <FileText className="w-5 h-5 text-[var(--color-muted)]" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-[var(--color-muted)]">Notes</p>
                      <textarea
                        value={editForm.notes}
                        onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                        className="w-full text-sm font-medium text-[var(--color-text-primary)] bg-transparent border-b border-[var(--color-border)] focus:border-primary outline-none py-1 resize-none"
                        rows={2}
                        placeholder="Notes..."
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {contact.phone && (
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-highest)] flex items-center justify-center">
                        <Phone className="w-5 h-5 text-[var(--color-muted)]" />
                      </div>
                      <div>
                        <p className="text-xs text-[var(--color-muted)]">Phone</p>
                        <p className="text-sm font-medium text-[var(--color-text-primary)]">
                          {formatPhone(contact.phone)}
                        </p>
                      </div>
                    </div>
                  )}
                  {contact.email && (
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-highest)] flex items-center justify-center">
                        <Mail className="w-5 h-5 text-[var(--color-muted)]" />
                      </div>
                      <div>
                        <p className="text-xs text-[var(--color-muted)]">Email</p>
                        <p className="text-sm font-medium text-[var(--color-text-primary)]">
                          {contact.email}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-highest)] flex items-center justify-center">
                  <User className="w-5 h-5 text-[var(--color-muted)]" />
                </div>
                <div>
                  <p className="text-xs text-[var(--color-muted)]">Contact Since</p>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {formatDate(contact.createdAt)}
                  </p>
                </div>
              </div>

              {contact.notes && (
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-highest)] flex items-center justify-center">
                    <FileText className="w-5 h-5 text-[var(--color-muted)]" />
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-muted)]">Notes</p>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      {contact.notes}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Content */}
          <div className="w-full md:w-2/3 p-6 md:p-8">
            {/* Tabs */}
            <div className="flex gap-6 border-b border-[var(--color-border)] mb-6">
              <button
                onClick={() => setActiveTab('overview')}
                className={cn(
                  'pb-3 text-sm font-semibold transition-colors relative',
                  activeTab === 'overview'
                    ? 'text-[var(--color-text-primary)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-text-secondary)]'
                )}
              >
                Overview
                {activeTab === 'overview' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
                )}
              </button>
              <button
                onClick={() => setActiveTab('loans')}
                className={cn(
                  'pb-3 text-sm font-semibold transition-colors relative',
                  activeTab === 'loans'
                    ? 'text-[var(--color-text-primary)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-text-secondary)]'
                )}
              >
                Loan History ({contact.loans.length})
                {activeTab === 'loans' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
                )}
              </button>
            </div>

            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[var(--ref-surface-container-low)] rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <ArrowUpRight className="w-4 h-4 text-[var(--color-success)]" />
                      <span className="text-xs font-medium text-[var(--color-muted)]">You Lent</span>
                    </div>
                    <p className="text-xl font-bold text-[var(--color-text-primary)]">
                      {formatCurrency(contact.summary.totalLentAllTime)}
                    </p>
                    <p className="text-xs text-[var(--color-muted)] mt-1">
                      Active: {formatCurrency(contact.summary.totalLent)}
                    </p>
                  </div>

                  <div className="bg-[var(--ref-surface-container-low)] rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <ArrowDownRight className="w-4 h-4 text-[var(--color-danger)]" />
                      <span className="text-xs font-medium text-[var(--color-muted)]">You Borrowed</span>
                    </div>
                    <p className="text-xl font-bold text-[var(--color-text-primary)]">
                      {formatCurrency(contact.summary.totalBorrowedAllTime)}
                    </p>
                    <p className="text-xs text-[var(--color-muted)] mt-1">
                      Active: {formatCurrency(contact.summary.totalBorrowed)}
                    </p>
                  </div>
                </div>

                {/* Net Balance */}
                <div className={cn(
                  'rounded-xl p-4 flex items-center justify-between',
                  contact.summary.netBalance > 0 
                    ? 'bg-[var(--color-success)]/10'
                    : contact.summary.netBalance < 0
                    ? 'bg-[var(--color-danger)]/10'
                    : 'bg-[var(--ref-surface-container-low)]'
                )}>
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'w-10 h-10 rounded-lg flex items-center justify-center',
                      contact.summary.netBalance > 0 
                        ? 'bg-[var(--color-success)]/20'
                        : contact.summary.netBalance < 0
                        ? 'bg-[var(--color-danger)]/20'
                        : 'bg-[var(--ref-surface-container-highest)]'
                    )}>
                      <Wallet className={cn(
                        'w-5 h-5',
                        contact.summary.netBalance > 0 
                          ? 'text-[var(--color-success)]'
                          : contact.summary.netBalance < 0
                          ? 'text-[var(--color-danger)]'
                          : 'text-[var(--color-muted)]'
                      )} />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-[var(--color-muted)]">Net Balance</p>
                      <p className={cn(
                        'text-lg font-bold',
                        contact.summary.netBalance > 0 
                          ? 'text-[var(--color-success)]'
                          : contact.summary.netBalance < 0
                          ? 'text-[var(--color-danger)]'
                          : 'text-[var(--color-text-primary)]'
                      )}>
                        {contact.summary.netBalance > 0 ? '+' : ''}{formatCurrency(contact.summary.netBalance)}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-[var(--color-muted)]">
                    {contact.summary.netBalance > 0 
                      ? 'They owe you'
                      : contact.summary.netBalance < 0
                      ? 'You owe them'
                      : 'All settled up'}
                  </p>
                </div>

                {/* Quick Stats */}
                <div className="flex gap-4">
                  <div className="flex-1 bg-[var(--ref-surface-container-low)] rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-[var(--color-text-primary)]">
                      {contact.summary.activeLoansCount}
                    </p>
                    <p className="text-xs text-[var(--color-muted)]">Active Loans</p>
                  </div>
                  <div className="flex-1 bg-[var(--ref-surface-container-low)] rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-[var(--color-text-primary)]">
                      {contact.summary.repaidLoansCount}
                    </p>
                    <p className="text-xs text-[var(--color-muted)]">Repaid Loans</p>
                  </div>
                </div>
              </div>
            )}

            {/* Loans Tab */}
            {activeTab === 'loans' && (
              <div className="space-y-3">
                {contact.loans.length === 0 ? (
                  <div className="text-center py-12 text-[var(--color-muted)]">
                    <UserX className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p className="text-sm font-medium">No loans yet</p>
                    <p className="text-xs mt-1">Start tracking loans with this contact</p>
                  </div>
                ) : (
                  contact.loans.map((loan) => (
                    <div
                      key={loan.id}
                      className="bg-[var(--ref-surface-container-low)] rounded-xl p-4 hover:bg-[var(--ref-surface-container)] transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            'w-10 h-10 rounded-lg flex items-center justify-center',
                            loan.direction === 'lent'
                              ? 'bg-[var(--color-success)]/10'
                              : 'bg-[var(--color-danger)]/10'
                          )}>
                            {loan.direction === 'lent' ? (
                              <ArrowUpRight className="w-5 h-5 text-[var(--color-success)]" />
                            ) : (
                              <ArrowDownRight className="w-5 h-5 text-[var(--color-danger)]" />
                            )}
                          </div>
                          <div>
                            <p className="font-semibold text-sm text-[var(--color-text-primary)]">
                              {loan.direction === 'lent' ? 'Lent' : 'Borrowed'}{' '}
                              {formatCurrency(loan.amountCents)}
                            </p>
                            {loan.description && (
                              <p className="text-xs text-[var(--color-muted)] mt-0.5 line-clamp-1">
                                {loan.description}
                              </p>
                            )}
                            <p className="text-xs text-[var(--color-muted)] mt-1">
                              {formatDate(loan.startDate, { month: 'short', day: 'numeric', year: 'numeric' })}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="flex items-center gap-1.5">
                            {getLoanStatusIcon(loan.status)}
                            <span className={cn(
                              'text-xs font-medium',
                              loan.status === 'repaid' && 'text-[var(--color-success)]',
                              loan.status === 'active' && 'text-[var(--color-warning)]',
                              (loan.status === 'defaulted' || loan.status === 'written_off') && 'text-[var(--color-danger)]'
                            )}>
                              {getLoanStatusText(loan.status)}
                            </span>
                          </div>
                          {loan.status === 'active' && loan.remainingCents !== loan.amountCents && (
                            <p className="text-xs text-[var(--color-muted)] mt-1">
                              Remaining: {formatCurrency(loan.remainingCents)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
