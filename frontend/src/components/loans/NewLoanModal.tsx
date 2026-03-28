import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { formatCurrency } from '../../lib/utils';
import { 
  Plus, 
  Wallet, 
  CheckCircle2,
  Search,
  Landmark,
  Banknote,
} from 'lucide-react';

interface NewLoanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface Contact {
  id: number;
  name: string;
  fullName?: string | null;
  nickname?: string | null;
  relationship?: string;
  relationshipType?: string | null;
  phone?: string | null;
  email?: string | null;
}

const RELATIONSHIP_TYPES = [
  { value: 'family', label: 'Family' },
  { value: 'friend', label: 'Friend' },
  { value: 'colleague', label: 'Colleague' },
  { value: 'professional', label: 'Professional' },
  { value: 'others', label: 'Others' },
];

const WALLET_ICONS = [Landmark, Wallet, Banknote];

export function NewLoanModal({ isOpen, onClose, onSuccess }: NewLoanModalProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [accounts, setAccounts] = useState<Array<{ id: number; name: string; type: string; balance: number }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactFullName, setNewContactFullName] = useState('');
  const [newContactNickname, setNewContactNickname] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactRelationshipType, setNewContactRelationshipType] = useState('');
  const [isCreatingContact, setIsCreatingContact] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAccountExpanded, setIsAccountExpanded] = useState(false);
  
  const [formData, setFormData] = useState({
    contactId: '',
    direction: 'lent' as 'lent' | 'borrowed',
    amount: '',
    rawAmount: '',
    description: '',
    dueDate: '',
    walletAccountId: '',
  });

  const filteredContacts = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return contacts;
    return contacts.filter(c => c.name.toLowerCase().includes(query));
  }, [contacts, searchQuery]);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const loadData = async () => {
    try {
      const [contactsData, accountsData] = await Promise.all([
        api.contacts.list(),
        api.accounts.list({ type: 'asset' }),
      ]);
      const contactsWithMeta = contactsData.map((c: Contact, i: number) => ({
        ...c,
        relationship: ['Close Friend', 'Family member', 'Colleague', 'Friend'][i % 4],
      }));
      setContacts(contactsWithMeta);
      setAccounts(accountsData.filter((a: { type: string; systemKey: string | null }) => a.type === 'asset' && !a.systemKey));
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  };

  const handleCreateContact = async () => {
    if (!newContactName.trim()) return;
    
    setIsCreatingContact(true);
    try {
      const contact = await api.contacts.create({ 
        name: newContactName.trim(),
        fullName: newContactFullName.trim() || null,
        nickname: newContactNickname.trim() || null,
        phone: newContactPhone.trim() || null,
        relationshipType: newContactRelationshipType || null,
      });
      setContacts([...contacts, { 
        ...contact, 
        relationship: RELATIONSHIP_TYPES.find(r => r.value === newContactRelationshipType)?.label || 'Contact' 
      }]);
      setFormData({ ...formData, contactId: contact.id.toString() });
      setIsContactModalOpen(false);
      resetContactForm();
    } catch (err) {
      setError('Failed to create contact');
    } finally {
      setIsCreatingContact(false);
    }
  };

  const resetContactForm = () => {
    setNewContactName('');
    setNewContactFullName('');
    setNewContactNickname('');
    setNewContactPhone('');
    setNewContactRelationshipType('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!formData.contactId || !formData.rawAmount || !formData.walletAccountId) {
      setError('Please fill in all required fields');
      return;
    }

    const amountCents = Math.round(parseFloat(formData.rawAmount));
    if (amountCents <= 0 || isNaN(amountCents)) {
      setError('Amount must be greater than 0');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.loans.create({
        contactId: parseInt(formData.contactId),
        direction: formData.direction,
        amountCents,
        description: formData.description || undefined,
        dueDate: formData.dueDate ? new Date(formData.dueDate).getTime() : null,
        walletAccountId: parseInt(formData.walletAccountId),
      });
      
      onSuccess();
      setFormData({
        contactId: '',
        direction: 'lent',
        amount: '',
        rawAmount: '',
        description: '',
        dueDate: '',
        walletAccountId: '',
      });
      setSearchQuery('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create loan');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^\d]/g, '');
    if (value) {
      const numValue = parseInt(value, 10);
      const formatted = new Intl.NumberFormat('id-ID').format(numValue);
      setFormData({ 
        ...formData, 
        amount: formatted,
        rawAmount: value
      });
    } else {
      setFormData({ ...formData, amount: '', rawAmount: '' });
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

  const isFormValid = formData.contactId && formData.rawAmount && formData.walletAccountId;

  return (
    <>
      <Modal 
        isOpen={isOpen} 
        onClose={onClose}
        title="New Loan"
        size="xl"
        className="max-w-5xl"
      >
        <form id="loan-form" onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 p-4 bg-[var(--ref-error-container)] text-[var(--ref-on-error-container)] rounded-xl text-sm font-medium">
              {error}
            </div>
          )}

          <div className="flex flex-col md:flex-row gap-0 min-h-[500px]">
            {/* Left Column: Contact Selection */}
            <div className="w-full md:w-4/12 bg-[var(--ref-surface-container-low)] p-6 md:p-8 flex flex-col">
              {/* Header */}
              <div className="mb-6">
                <span className="text-xs font-bold tracking-[0.2em] text-tertiary uppercase mb-1 block">
                  New Loan
                </span>
                <h2 className="text-2xl font-extrabold text-[var(--color-text-primary)] tracking-tight">
                  SELECT CONTACT
                </h2>
                <p className="text-sm text-[var(--color-text-secondary)] mt-2 leading-relaxed">
                  Choose a counterparty and define the nature of your financial bond.
                </p>
              </div>

              {/* Search or Select Contact */}
              <div className="flex-grow">
                <label className="text-[0.6875rem] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3 block">
                  Search or Select Contact
                </label>
                
                {/* Search Input */}
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] w-4 h-4" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search contacts..."
                    className="w-full bg-[var(--ref-surface-container-lowest)] border border-[var(--color-border)]/10 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:border-primary focus:ring-0 transition-all"
                  />
                </div>

                {/* Add New Contact Button */}
                <button
                  type="button"
                  onClick={() => setIsContactModalOpen(true)}
                  className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-[var(--ref-surface-container-lowest)] border border-dashed border-[var(--color-border)] hover:border-primary/50 hover:bg-[var(--color-surface)] transition-all group mb-4"
                >
                  <Plus className="w-4 h-4 text-[var(--color-text-secondary)] group-hover:text-primary transition-colors" />
                  <span className="text-sm font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]">
                    Add New Contact
                  </span>
                </button>

                {/* Contact List */}
                <div className="space-y-2 max-h-[280px] overflow-y-auto custom-scrollbar pr-1">
                  {filteredContacts.length === 0 ? (
                    <div className="text-center py-8 text-[var(--color-text-secondary)]">
                      <p className="text-sm">No contacts found</p>
                      <p className="text-xs mt-1">Add a new contact to get started</p>
                    </div>
                  ) : (
                    filteredContacts.map((contact) => {
                      const isSelected = formData.contactId === contact.id.toString();
                      return (
                        <button
                          key={contact.id}
                          type="button"
                          onClick={() => setFormData({ ...formData, contactId: contact.id.toString() })}
                          className={cn(
                            'w-full flex items-center p-3 rounded-xl transition-all group text-left',
                            isSelected
                              ? 'bg-[var(--ref-surface-container-lowest)] border-l-4 border-primary'
                              : 'bg-[var(--ref-surface-container-lowest)] border-l-4 border-transparent hover:bg-[var(--color-surface)] hover:border-primary/50'
                          )}
                        >
                          {/* Avatar */}
                          <div className="w-10 h-10 rounded-full bg-[var(--ref-surface-container-highest)] flex items-center justify-center shrink-0">
                            <span className="text-sm font-bold text-[var(--color-text-primary)]">
                              {getInitials(contact.name)}
                            </span>
                          </div>
                          
                          {/* Contact Info */}
                          <div className="ml-3 flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                              {contact.name}
                            </p>
                            <p className="text-[0.6875rem] text-[var(--color-text-secondary)]">
                              {contact.relationship || 'Contact'}
                            </p>
                          </div>
                          
                          {/* Check Icon */}
                          <CheckCircle2 
                            className={cn(
                              'ml-auto w-5 h-5 shrink-0 transition-opacity',
                              isSelected 
                                ? 'text-primary opacity-100' 
                                : 'text-primary opacity-0 group-hover:opacity-100'
                            )} 
                          />
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Loan Mechanics */}
            <div className="w-full md:w-8/12 flex flex-col h-[580px]">
              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-40">
                {/* Header Toggle with Sliding Animation */}
                <div className="mb-8">
                  <div className="relative flex bg-[var(--ref-surface-container)] p-1 rounded-full w-52">
                    {/* Sliding Background Pill */}
                    <div
                      className={cn(
                        'absolute top-1 bottom-1 rounded-full transition-all duration-300 ease-out shadow-sm',
                        formData.direction === 'lent' 
                          ? 'left-1 bg-[var(--color-success)] w-[calc(50%-4px)]' 
                          : 'left-[calc(50%+2px)] bg-[var(--color-danger)] w-[calc(50%-4px)]'
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, direction: 'lent' })}
                      className={cn(
                        'relative z-10 flex-1 py-2 rounded-full text-sm font-bold transition-colors duration-200 text-center',
                        formData.direction === 'lent'
                          ? 'text-white'
                          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                      )}
                    >
                      Lend
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, direction: 'borrowed' })}
                      className={cn(
                        'relative z-10 flex-1 py-2 rounded-full text-sm font-bold transition-colors duration-200 text-center',
                        formData.direction === 'borrowed'
                          ? 'text-white'
                          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                      )}
                    >
                      Borrow
                    </button>
                  </div>
                </div>

                <div className={cn('space-y-8', isAccountExpanded ? 'pb-44' : 'pb-4')}>
                  {/* Amount Section */}
                  <div>
                    <label className="text-[0.6875rem] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2 block">
                      Transaction Amount
                    </label>
                    <div className="relative group">
                      <span className="absolute left-0 bottom-3 text-2xl font-headline font-light text-[var(--color-outline)]">
                        Rp
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={formData.amount}
                        onChange={handleAmountChange}
                        placeholder="0"
                        className="w-full bg-transparent border-none border-b-2 border-[var(--ref-surface-container-highest)] focus:border-primary focus:ring-0 text-4xl font-headline font-bold text-[var(--color-text-primary)] pl-12 pb-2 transition-all"
                      />
                    </div>
                  </div>

                  {/* Account & Date - Two Column Layout */}
                  <div className="grid grid-cols-12 gap-4 items-start">
                    {/* Account Selection - Collapsible */}
                    <div className="col-span-7">
                      <label className="text-[0.6875rem] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3 block">
                        {formData.direction === 'lent' ? 'Funding Source' : 'Receiving Account'}
                      </label>
                      <div className="w-full">
                      <div className="border border-[var(--color-border)]/10 rounded-xl relative">
                      <button
                        type="button"
                        onClick={() => setIsAccountExpanded(!isAccountExpanded)}
                        className={cn(
                          'w-full flex items-center justify-between px-4 py-[15px] bg-[var(--ref-surface-container)] hover:bg-[var(--ref-surface-container-high)] transition-colors h-[68px]',
                          isAccountExpanded && 'rounded-b-none'
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {formData.walletAccountId ? (
                            (() => {
                              const account = accounts.find(a => a.id.toString() === formData.walletAccountId);
                              const idx = accounts.findIndex(a => a.id.toString() === formData.walletAccountId);
                              const Icon = WALLET_ICONS[idx % 3];
                              return (
                                <>
                                  <div className="w-8 h-8 rounded-lg bg-[var(--ref-primary-container)] flex items-center justify-center shrink-0">
                                    <Icon className="w-4 h-4 text-white" />
                                  </div>
                                  <div className="text-left min-w-0 flex-1">
                                    <p className="font-semibold text-base text-[var(--color-text-primary)] truncate">
                                      {account?.name}
                                    </p>
                                    <p className="text-sm text-[var(--color-muted)]">
                                      {formatCurrency(account?.balance || 0)}
                                    </p>
                                  </div>
                                </>
                              );
                            })()
                          ) : (
                            <>
                              <div className="w-8 h-8 rounded-lg bg-[var(--ref-surface-container-high)] flex items-center justify-center shrink-0">
                                <Wallet className="w-4 h-4 text-[var(--color-muted)]" />
                              </div>
                              <div className="text-left min-w-0 flex-1">
                                <p className="font-semibold text-base text-[var(--color-text-secondary)] truncate">
                                  {formData.direction === 'lent' ? 'Select account' : 'Select account'}
                                </p>
                                <p className="text-sm text-[var(--color-muted)]">
                                  Required
                                </p>
                              </div>
                            </>
                          )}
                        </div>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={cn(
                            'text-[var(--color-text-secondary)] transition-transform duration-300',
                            isAccountExpanded ? 'rotate-180' : ''
                          )}
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                      
                       {/* Expandable Content */}
                      <div
                         className={cn(
                           'absolute top-full left-0 right-0 z-50 overflow-hidden transition-all duration-300 ease-in-out bg-[var(--ref-surface-container-lowest)] border border-t-0 border-[var(--color-border)]/10 rounded-b-xl shadow-lg',
                           isAccountExpanded ? 'max-h-[350px] opacity-100' : 'max-h-0 opacity-0 border-transparent shadow-none'
                         )}
                      >
                        <div className="p-2 space-y-1">
                          {accounts.map((account, idx) => {
                            const Icon = WALLET_ICONS[idx % 3];
                            const isSelected = formData.walletAccountId === account.id.toString();
                            return (
                              <button
                                key={account.id}
                                type="button"
                                onClick={() => {
                                  setFormData({ ...formData, walletAccountId: account.id.toString() });
                                  setIsAccountExpanded(false);
                                }}
                                className={cn(
                                  'w-full flex items-center gap-2 p-2 rounded-lg transition-all text-left',
                                  isSelected
                                    ? 'bg-[var(--ref-surface-container)] border-2 border-primary'
                                    : 'bg-[var(--ref-surface-container-low)] border-2 border-transparent hover:border-[var(--ref-surface-container-highest)]'
                                )}
                              >
                                <div className={cn(
                                  'w-6 h-6 rounded-md flex items-center justify-center shrink-0',
                                  isSelected ? 'bg-[var(--ref-primary-container)]' : 'bg-[var(--ref-surface-container-highest)]'
                                )}>
                                  <Icon className={cn(
                                    'w-3 h-3',
                                    isSelected ? 'text-white' : 'text-[var(--color-muted)]'
                                  )} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className={cn(
                                    'font-semibold text-base truncate',
                                    isSelected ? 'text-primary' : 'text-[var(--color-text-primary)]'
                                  )}>
                                    {account.name}
                                  </p>
                                  <p className="text-xs text-[var(--color-muted)]">
                                    {formatCurrency(account.balance)}
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                       </div>
                      </div>
                      </div>
                    </div>

                    {/* Expected Return Date */}
                    <div className="col-span-5">
                      <label className="text-[0.6875rem] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3 block">
                        Due Date
                      </label>
                      <input
                        type="date"
                        value={formData.dueDate}
                        onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                        className="w-full bg-[var(--ref-surface-container)] border-none rounded-xl px-4 py-[13px] text-sm font-semibold text-[var(--color-text-primary)] focus:ring-2 focus:ring-primary/20 transition-all h-[68px]"
                      />
                    </div>
                  </div>

                  {/* Loan Details */}
                  <div>
                    <label className="text-[0.6875rem] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3 block">
                      Loan Details
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="e.g. For dinner last night at The Grand Bistro..."
                      rows={3}
                      className="w-full bg-[var(--ref-surface-container)] border border-[var(--color-border)]/10 rounded-xl p-4 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-outline)] focus:border-primary focus:ring-0 resize-none transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Footer Actions - Fixed at bottom */}
              <div className="flex items-center justify-end gap-3 border-t border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-6 py-4 shadow-[0_-4px_20px_-8px_rgba(15,23,42,0.1)]">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-2.5 text-sm font-semibold text-[var(--color-text-primary)] bg-[var(--ref-surface-container)] hover:bg-[var(--ref-surface-container-high)] border border-[var(--color-border)] rounded-full transition-colors"
                >
                  Discard Entry
                </button>
                <Button
                  type="submit"
                  isLoading={isSubmitting}
                  disabled={!isFormValid}
                  className="px-8 py-2.5 rounded-full font-bold text-sm shadow-lg hover:shadow-[var(--ref-primary)]/20 active:scale-95 transition-all"
                >
                  Save Loan
                </Button>
              </div>
            </div>
          </div>
        </form>
      </Modal>

      {/* Contact Creation Modal */}
      <Modal
        isOpen={isContactModalOpen}
        onClose={() => {
          setIsContactModalOpen(false);
          resetContactForm();
        }}
        title="New Contact"
        size="default"
        className="max-w-lg"
      >
        <div className="space-y-5">
          {/* Display Name / Nickname */}
          <div>
            <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2 block">
              Display Name <span className="text-[var(--color-danger)]">*</span>
            </label>
            <input
              type="text"
              value={newContactName}
              onChange={(e) => setNewContactName(e.target.value)}
                placeholder="e.g., John"
                className="w-full bg-[var(--ref-surface-container)] border-none rounded-xl px-4 py-3 text-sm font-semibold text-[var(--color-text-primary)] placeholder:text-[var(--color-muted)]/60 focus:ring-2 focus:ring-primary/20 transition-all"
              autoFocus
            />
            <p className="text-xs text-[var(--color-muted)] mt-1">This is how the contact will be displayed</p>
          </div>

          {/* Full Name */}
          <div>
            <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2 block">
              Full Name
            </label>
            <input
              type="text"
              value={newContactFullName}
              onChange={(e) => setNewContactFullName(e.target.value)}
              placeholder="e.g., John Michael Smith"
              className="w-full bg-[var(--ref-surface-container)] border-none rounded-xl px-4 py-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-muted)]/60 focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>

          {/* Phone Number */}
          <div>
            <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2 block">
              Phone Number
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)]">+62</span>
              <input
                type="tel"
                value={newContactPhone}
                onChange={(e) => {
                  // Only allow digits
                  const value = e.target.value.replace(/\D/g, '');
                  setNewContactPhone(value);
                }}
                placeholder="81234567890"
                className="w-full bg-[var(--ref-surface-container)] border-none rounded-xl pl-12 pr-4 py-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-muted)]/60 focus:ring-2 focus:ring-primary/20 transition-all"
                maxLength={15}
              />
            </div>
          </div>

          {/* Relationship Type */}
          <div>
            <label className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3 block">
              Relationship
            </label>
            <div className="flex flex-wrap gap-2">
              {RELATIONSHIP_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setNewContactRelationshipType(type.value)}
                  className={cn(
                    'px-4 py-2 rounded-full text-sm font-medium transition-all border-2',
                    newContactRelationshipType === type.value
                      ? 'bg-[var(--ref-primary-container)] border-[var(--ref-primary-container)] text-white'
                      : 'bg-[var(--ref-surface-container)] border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-high)] hover:border-[var(--color-border)]'
                  )}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3 pt-6 border-t border-[var(--color-border)]">
            <Button 
              type="button" 
              variant="secondary"
              onClick={() => {
                setIsContactModalOpen(false);
                resetContactForm();
              }}
              className="rounded-full py-3 sm:min-w-[100px]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateContact}
              isLoading={isCreatingContact}
              disabled={!newContactName.trim()}
            >
              <Plus className="w-4 h-4 mr-1" />
              Create Contact
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
