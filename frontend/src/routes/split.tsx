import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { cn } from '../lib/utils';
import { 
  Plus, 
  Wallet, 
  Search,
  Landmark,
  Banknote,
  ChevronDown,
  Trash2,
  Upload,
} from 'lucide-react';

interface ParsedReceiptItem {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes: string | null;
}

interface ParsedReceipt {
  merchantName: string;
  receiptDate: string;
  expenseCategory: string;
  items: ParsedReceiptItem[];
  subtotal: number;
  tax: number;
  taxPercent: number;
  serviceFee: number;
  servicePercent: number;
  discount: number;
  discountPercent: number;
  total: number;
  paymentMethod: string | null;
  currency: string;
}

interface SplitBillPerson {
  id?: number;
  name: string;
  isMe?: boolean;
  isRecent?: boolean;
}

interface ItemAssignment {
  itemIndex: number;
  personIds: number[];
}

interface PersonSplitResult {
  personId: number;
  personName: string;
  assignedItems: ParsedReceiptItem[];
  subtotal: number;
  taxShare: number;
  serviceShare: number;
  discountShare: number;
  total: number;
  itemCount: number;
}

interface WalletAccount {
  id: number;
  name: string;
  type: string;
  balance: number;
}

interface Contact {
  id: number;
  name: string;
  fullName?: string | null;
  nickname?: string | null;
  relationship?: string;
}

const WALLET_ICONS = [Landmark, Wallet, Banknote];

function getInitials(name: string) {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export const Route = createFileRoute('/split')({
  component: SplitBillPage,
});

function SplitBillPage() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [parsedReceipt, setParsedReceipt] = useState<ParsedReceipt | null>(null);
  
  const [people, setPeople] = useState<SplitBillPerson[]>([]);
  const [assignments, setAssignments] = useState<ItemAssignment[]>([]);
  const [splitResults, setSplitResults] = useState<PersonSplitResult[]>([]);
  
  const [payerId, setPayerId] = useState<number | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [recentContacts, setRecentContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [isCreatingContact, setIsCreatingContact] = useState(false);
  
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [isAccountExpanded, setIsAccountExpanded] = useState(false);
  const [isPayerExpanded, setIsPayerExpanded] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const meId = 0; // Backend uses 0 to identify "Me"

  useEffect(() => {
    loadInitialData();
    
    // Check for parsed receipt from localStorage (set by transactions page)
    const storedData = localStorage.getItem('splitbill_parsed');
    if (storedData) {
      try {
        const { parsed, imageUrl } = JSON.parse(storedData);
        setParsedReceipt(parsed);
        setUploadedImageUrl(imageUrl);
        
        const defaultAssignments = parsed.items.map((_: ParsedReceiptItem, idx: number) => ({
          itemIndex: idx,
          personIds: [],
        }));
        setAssignments(defaultAssignments);
        setSplitResults([]);
        
        // Clear from localStorage
        localStorage.removeItem('splitbill_parsed');
      } catch (e) {
        console.error('Failed to parse stored receipt data', e);
      }
    }
    
    // Add "Me" to people array by default
    const mePerson: SplitBillPerson = {
      id: meId,
      name: 'Me',
      isMe: true,
    };
    setPeople([mePerson]);
  }, []);

  const loadInitialData = async () => {
    try {
      const [accountsData, contactsData] = await Promise.all([
        api.accounts.list() as Promise<WalletAccount[]>,
        api.contacts.list() as Promise<Contact[]>,
      ]);
      
      setAccounts(accountsData.filter(a => a.type === 'asset'));
      if (accountsData.length > 0) {
        setSelectedAccountId(accountsData[0].id);
      }
      
      setContacts(contactsData);
      const recent = contactsData.slice(0, 3);
      setRecentContacts(recent);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  };

  const createEmptyReceipt = useCallback((imageUrl?: string | null) => {
    const emptyReceipt: ParsedReceipt = {
      merchantName: 'Unknown Merchant',
      receiptDate: new Date().toISOString(),
      expenseCategory: 'Food & Dining',
      items: [],
      subtotal: 0,
      tax: 0,
      taxPercent: 10,
      serviceFee: 0,
      servicePercent: 5,
      discount: 0,
      discountPercent: 0,
      total: 0,
      paymentMethod: null,
      currency: 'IDR',
    };
    setParsedReceipt(emptyReceipt);
    setUploadedImageUrl(imageUrl || null);
    setAssignments([]);
    setSplitResults([]);
    setError(null);
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        setUploadedImageUrl(base64);
        try {
          const result = await api.splitbill.scan(base64, file.name);
          setParsedReceipt(result.parsed);
          
          const defaultAssignments = result.parsed.items.map((_: ParsedReceiptItem, idx: number) => ({
            itemIndex: idx,
            personIds: [],
          }));
          setAssignments(defaultAssignments);
          setSplitResults([]);
        } catch (err: unknown) {
          const errorData = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
          if (errorData?.error === 'not_a_receipt' || errorData?.error === 'no_items_found') {
            setError(errorData.message || 'Failed to parse receipt');
          } else {
            setError((err as Error)?.message || 'Failed to scan receipt');
          }
        } finally {
          setIsLoading(false);
        }
      };
      reader.onerror = () => {
        setError('Failed to read file');
        setIsLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err: unknown) {
      setError((err as Error)?.message);
      setIsLoading(false);
    }
  }, []);

  const calculateResults = useCallback((
    receipt: ParsedReceipt,
    currentPeople: SplitBillPerson[],
    currentAssignments: ItemAssignment[]
  ) => {
    const personSubtotals: Record<number, number> = {};
    const personItemCounts: Record<number, number> = {};
    const personItems: Record<number, ParsedReceiptItem[]> = {};

    for (const person of currentPeople) {
      if (person.id !== undefined) {
        personSubtotals[person.id] = 0;
        personItemCounts[person.id] = 0;
        personItems[person.id] = [];
      }
    }

    for (const assignment of currentAssignments) {
      const item = receipt.items[assignment.itemIndex];
      if (!item) continue;

      const sharePerPerson = assignment.personIds.length > 0 
        ? item.totalPrice / assignment.personIds.length 
        : 0;
        
      for (const personId of assignment.personIds) {
        if (personSubtotals[personId] !== undefined) {
          personSubtotals[personId] += sharePerPerson;
          personItemCounts[personId] += 1;
          personItems[personId].push({
            ...item,
            totalPrice: sharePerPerson,
            quantity: 1 / assignment.personIds.length,
          });
        }
      }
    }

    const totalItemSubtotal = receipt.items.reduce((sum, i) => sum + i.totalPrice, 0);
    const results: PersonSplitResult[] = [];

    for (const person of currentPeople) {
      if (person.id === undefined) continue;

      const subtotal = personSubtotals[person.id] || 0;
      const proportion = totalItemSubtotal > 0 ? subtotal / totalItemSubtotal : 0;

      results.push({
        personId: person.id,
        personName: person.name,
        assignedItems: personItems[person.id] || [],
        subtotal,
        taxShare: Math.round(receipt.tax * proportion),
        serviceShare: Math.round(receipt.serviceFee * proportion),
        discountShare: Math.round(receipt.discount * proportion),
        total: subtotal + Math.round(receipt.tax * proportion) + Math.round(receipt.serviceFee * proportion) - Math.round(receipt.discount * proportion),
        itemCount: personItemCounts[person.id] || 0,
      });
    }

    setSplitResults(results);
    return results;
  }, []);

  const handleAssignItem = useCallback((
    itemIndex: number, 
    personId: number, 
    action: 'add' | 'remove'
  ) => {
    const existingIdx = assignments.findIndex(a => a.itemIndex === itemIndex);
    const newAssignments = [...assignments];
    
    if (existingIdx >= 0) {
      let currentIds = [...newAssignments[existingIdx].personIds];
      if (action === 'add' && !currentIds.includes(personId)) {
        currentIds.push(personId);
      } else if (action === 'remove') {
        currentIds = currentIds.filter(id => id !== personId);
      }
      newAssignments[existingIdx] = { 
        ...newAssignments[existingIdx], 
        personIds: currentIds,
      };
    } else if (action === 'add') {
      newAssignments.push({
        itemIndex,
        personIds: [personId],
      });
    }
    
    setAssignments(newAssignments);
    
    if (parsedReceipt) {
      calculateResults(parsedReceipt, people, newAssignments);
    }
  }, [assignments, parsedReceipt, people, calculateResults]);

  const handleAddParticipant = useCallback((contact: Contact) => {
    const exists = people.some(p => p.id === contact.id);
    if (!exists) {
      const newPerson: SplitBillPerson = {
        id: contact.id,
        name: contact.name,
        isRecent: true,
      };
      const newPeople = [...people, newPerson];
      setPeople(newPeople);
      
      if (parsedReceipt) {
        calculateResults(parsedReceipt, newPeople, assignments);
      }
    }
    setContactSearch('');
    setShowAddContact(false);
  }, [people, parsedReceipt, assignments, calculateResults]);

  const handleRemoveParticipant = useCallback((personId: number) => {
    if (personId === meId) return; // Can't remove "Me"
    
    const newPeople = people.filter(p => p.id !== personId);
    setPeople(newPeople);
    
    const newAssignments = assignments.map(a => ({
      ...a,
      personIds: a.personIds.filter(id => id !== personId),
    })).filter(a => a.personIds.length > 0);
    setAssignments(newAssignments);
    
    if (parsedReceipt) {
      calculateResults(parsedReceipt, newPeople, newAssignments);
    }
  }, [people, parsedReceipt, assignments, calculateResults]);

  const handleCreateContact = useCallback(async () => {
    if (!newContactName.trim()) return;
    
    setIsCreatingContact(true);
    try {
      const contact = await api.contacts.create({ 
        name: newContactName.trim(),
      });
      handleAddParticipant({ id: contact.id, name: contact.name });
      setNewContactName('');
    } catch {
      setError('Failed to create contact');
    } finally {
      setIsCreatingContact(false);
    }
  }, [newContactName, handleAddParticipant]);

  const handleDeleteItem = useCallback((itemIndex: number) => {
    if (!parsedReceipt) return;

    const newItems = parsedReceipt.items.filter((_, idx) => idx !== itemIndex);
    const subtotal = newItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const tax = Math.round(subtotal * ((parsedReceipt.taxPercent || 10) / 100));
    const serviceFee = Math.round(subtotal * ((parsedReceipt.servicePercent || 5) / 100));
    const total = subtotal + tax + serviceFee - parsedReceipt.discount;

    setParsedReceipt({
      ...parsedReceipt,
      items: newItems,
      subtotal,
      tax,
      serviceFee,
      total,
    });

    const newAssignments = assignments
      .filter((_, idx) => idx !== itemIndex)
      .map((a, idx) => ({ ...a, itemIndex: idx }));

    setAssignments(newAssignments);
    calculateResults({ ...parsedReceipt, items: newItems, subtotal, tax, serviceFee, total }, people, newAssignments);
  }, [parsedReceipt, assignments, people, calculateResults]);

  const handleAddItem = useCallback(() => {
    if (!parsedReceipt) return;

    const newItem: ParsedReceiptItem = {
      name: 'New Item',
      quantity: 1,
      unitPrice: 0,
      totalPrice: 0,
      notes: null,
    };

    const newItems = [...parsedReceipt.items, newItem];
    const newItemIndex = newItems.length - 1;

    const newAssignments = [...assignments, { itemIndex: newItemIndex, personIds: [] }];

    setParsedReceipt({
      ...parsedReceipt,
      items: newItems,
      subtotal: parsedReceipt.subtotal,
      total: parsedReceipt.subtotal,
    });
    setAssignments(newAssignments);
  }, [parsedReceipt, assignments]);

  const handleCreateLoans = useCallback(async () => {
    if (payerId === null) return;
    if (payerId === meId && !selectedAccountId) return; // Me pays requires wallet
    
    setIsLoading(true);
    try {
      const splitResultsToSave: PersonSplitResult[] = [];

      if (payerId === meId) {
        const borrowerResults = splitResults.filter(r => r.personId !== meId && r.total > 0);
        splitResultsToSave.push(...borrowerResults);
      } else {
        const meResult = splitResults.find(r => r.personId === meId && r.total > 0);
        if (meResult) {
          splitResultsToSave.push(meResult);
        }
      }

      if (splitResultsToSave.length > 0 || payerId !== meId) {
        await api.splitbill.createLoans({
          splitResults: splitResultsToSave.map(r => ({
            personId: r.personId,
            personName: r.personName,
            total: r.total,
          })),
          isBorrower: payerId !== meId,
          walletAccountId: payerId === meId ? selectedAccountId! : undefined,
          expenseCategory: parsedReceipt?.expenseCategory || 'Food & Dining',
        });
      }
      
      navigate({ to: '/transactions' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedAccountId, payerId, splitResults, navigate, parsedReceipt?.expenseCategory]);

  const getAssignedPeople = (itemIndex: number): number[] => {
    const assignment = assignments.find(a => a.itemIndex === itemIndex);
    return assignment?.personIds || [];
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return 'Today';
    }
  };

  const totalAllocated = splitResults.reduce((sum, r) => sum + r.subtotal, 0);
  const totalBill = parsedReceipt?.total || 0;
  const unallocated = (parsedReceipt?.subtotal || 0) - totalAllocated;

  const filteredContacts = useMemo(() => {
    const query = contactSearch.toLowerCase().trim();
    if (!query) return recentContacts;
    return contacts.filter(c => c.name.toLowerCase().includes(query));
  }, [contacts, contactSearch, recentContacts]);

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);
  const selectedAccountIconIndex = accounts.findIndex(a => a.id === selectedAccountId);
  const SelectedAccountIcon = selectedAccountIconIndex >= 0 ? WALLET_ICONS[selectedAccountIconIndex % 3] : null;

  if (!parsedReceipt) {
    return (
      <>
        <PageHeader 
          subtext="Bookkeeping"
          title="Split Bill"
          className="mb-8"
        />
        <PageContainer>
          <div className="max-w-xl mx-auto py-12">
            <div 
              className="border-2 border-dashed border-[var(--color-border)] rounded-xl p-12 text-center cursor-pointer hover:bg-[var(--color-surface)] transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelect}
              />
              {isLoading ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
                  <p className="text-sm text-[var(--color-text-secondary)]">Scanning receipt...</p>
                </div>
              ) : (
                <>
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center">
                    <Upload className="w-8 h-8 text-[var(--color-text-secondary)]" />
                  </div>
                  <p className="font-semibold text-lg">Upload Receipt</p>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1">PNG, JPG up to 5MB</p>
                </>
              )}
            </div>
            
            {error && (
              <div className="mt-6 p-5 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-50 flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p className="text-[var(--color-text-primary)] font-medium mb-1">Oops! Something went wrong</p>
                <p className="text-sm text-[var(--color-text-secondary)] mb-4">{error}</p>
                <div className="flex flex-col sm:flex-row gap-2 justify-center">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-5 py-2.5 text-sm font-medium text-[var(--color-accent)] border border-[var(--color-accent)] rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    Try Another Photo
                  </button>
                  <button
                    onClick={() => createEmptyReceipt(uploadedImageUrl)}
                    className="px-5 py-2.5 text-sm font-medium bg-[var(--color-accent)] text-white rounded-lg hover:opacity-90 transition-colors"
                  >
                    Fill in Manually
                  </button>
                </div>
              </div>
            )}
            
            {!error && (
              <div className="mt-8 text-center">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-[var(--color-border)]"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-[var(--color-background)] text-[var(--color-text-secondary)]">or</span>
                  </div>
                </div>
                <button
                  onClick={() => createEmptyReceipt()}
                  className="mt-4 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors"
                >
                  Start with empty receipt instead
                </button>
              </div>
            )}
          </div>
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <PageHeader 
        subtext="Bookkeeping"
        title="Split Bill"
        className="mb-8"
      />
      <PageContainer className="pb-32 lg:pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-[var(--color-surface)] p-6 rounded-xl border-l-4 border-[var(--color-accent)] shadow-sm">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-success)]">Merchant Details</span>
                  <div className="h-1" />
                  <input
                    type="text"
                    value={parsedReceipt.merchantName}
                    onChange={(e) => setParsedReceipt({ ...parsedReceipt, merchantName: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    className="text-3xl font-extrabold bg-transparent border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none w-full"
                  />
                  <div className="h-1" />
                  <p className="text-[var(--color-text-secondary)]">{formatDate(parsedReceipt.receiptDate)}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-[var(--color-text-text-secondary)]">Total Bill Amount</span>
                  <div className="text-2xl font-bold text-[var(--color-accent)]">{formatCurrency(totalBill)}</div>
                </div>
              </div>
            </div>

            {/* Mobile Participants Card */}
            <div className="lg:hidden bg-[var(--color-surface)] p-4 rounded-xl shadow-md border border-[var(--color-border)]">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">Participants</h3>
              
              {showAddContact ? (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-secondary)]" />
                    <input
                      type="text"
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      placeholder="Search contacts..."
                      className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg py-2 pl-10 pr-4 text-sm"
                      autoFocus
                    />
                  </div>
                  {contactSearch && filteredContacts.length > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {filteredContacts.slice(0, 5).map((contact) => (
                        <button
                          key={contact.id}
                          onClick={() => handleAddParticipant(contact)}
                          className="w-full px-3 py-2 text-left hover:bg-[var(--ref-surface-container-low)] rounded-lg flex items-center gap-2"
                        >
                          <div className="w-6 h-6 rounded-full bg-[var(--ref-surface-container-highest)] flex items-center justify-center text-[10px] font-bold">
                            {getInitials(contact.name)}
                          </div>
                          <span className="text-sm">{contact.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                      placeholder="New contact..."
                      className="flex-1 text-sm"
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateContact()}
                    />
                    <Button onClick={handleCreateContact} isLoading={isCreatingContact} size="sm">Add</Button>
                  </div>
                  <button
                    onClick={() => {
                      setShowAddContact(false);
                      setContactSearch('');
                      setNewContactName('');
                    }}
                    className="w-full text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <div className="flex items-center px-3 py-1.5 rounded-full bg-[var(--ref-surface-container-low)]">
                    <div className="w-6 h-6 rounded-full bg-[var(--color-accent)] text-white flex items-center justify-center text-[10px] font-bold mr-2">
                      Me
                    </div>
                    <span className="text-sm font-medium">Me</span>
                  </div>
                  {people.filter(p => p.id !== meId).map(person => (
                    <div key={person.id} className="flex items-center px-3 py-1.5 rounded-full bg-[var(--ref-surface-container-low)]">
                      <div className="w-6 h-6 rounded-full bg-[var(--ref-surface-container-highest)] flex items-center justify-center text-[10px] font-bold mr-2">
                        {getInitials(person.name)}
                      </div>
                      <span className="text-sm font-medium">{person.name}</span>
                      <button
                        onClick={() => handleRemoveParticipant(person.id!)}
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[var(--color-text-secondary)] hover:bg-red-50 hover:text-red-500 ml-1"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setShowAddContact(true)}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm text-[var(--color-accent)] hover:bg-blue-50 rounded-full transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add
                  </button>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Bill Itemization</h2>
                <button
                  onClick={handleAddItem}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-[var(--color-accent)] hover:bg-blue-50 rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Item
                </button>
              </div>

              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-[var(--color-text-secondary)]">Assigned</span>
                  <span className="text-sm font-semibold">{formatCurrency(totalAllocated)} / {formatCurrency(parsedReceipt?.subtotal || 0)}</span>
                </div>
                <div className="w-full bg-[var(--color-border)] h-2 rounded-full overflow-hidden">
                  <div 
                    className="bg-[var(--color-accent)] h-full transition-all"
                    style={{ width: `${parsedReceipt?.subtotal ? Math.min((totalAllocated / parsedReceipt.subtotal) * 100, 100) : 0}%` }}
                  ></div>
                </div>
                {unallocated > 0 && (
                  <p className="text-xs text-[var(--color-danger)] mt-1">{formatCurrency(unallocated)} unassigned</p>
                )}
              </div>

              <div className="space-y-3">
                {parsedReceipt.items.map((item, itemIdx) => {
                  const assignedIds = getAssignedPeople(itemIdx);
                  
                  return (
                    <div 
                      key={itemIdx} 
                      className="bg-[var(--color-surface)] p-5 rounded-xl border border-[var(--color-border)] hover:shadow-md transition-all"
                    >
                      <div className="flex flex-col md:flex-row md:items-center gap-4">
                        <div className="flex-1">
                          <div className="flex justify-between items-start gap-4">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <input
                                type="text"
                                value={item.name}
                                onChange={(e) => {
                                  const newItems = [...parsedReceipt.items];
                                  newItems[itemIdx] = { ...newItems[itemIdx], name: e.target.value };
                                  setParsedReceipt({ ...parsedReceipt, items: newItems });
                                }}
                                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                className="font-semibold bg-transparent border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none min-w-0 flex-1 truncate"
                              />
                              <button
                                onClick={() => handleDeleteItem(itemIdx)}
                                className="p-1.5 rounded-lg hover:bg-red-50 text-[var(--color-text-secondary)] hover:text-red-500 transition-colors"
                                title="Delete item"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="flex items-center gap-1 text-sm shrink-0">
                              <input
                                type="number"
                                min="0"
                                value={item.unitPrice}
                                onChange={(e) => {
                                  const newItems = [...parsedReceipt.items];
                                  const newUnitPrice = parseInt(e.target.value) || 0;
                                  newItems[itemIdx] = { 
                                    ...newItems[itemIdx], 
                                    unitPrice: newUnitPrice,
                                    totalPrice: newUnitPrice * item.quantity 
                                  };
                                  const subtotal = newItems.reduce((sum, i) => sum + i.totalPrice, 0);
                                  const tax = Math.round(subtotal * ((parsedReceipt.taxPercent || 10) / 100));
                                  const serviceFee = Math.round(subtotal * ((parsedReceipt.servicePercent || 5) / 100));
                                  setParsedReceipt({ ...parsedReceipt, items: newItems, subtotal, tax, serviceFee, total: subtotal + tax + serviceFee - parsedReceipt.discount });
                                }}
                                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                className="font-bold text-[var(--color-accent)] bg-transparent border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none w-20 text-right text-sm"
                              />
                              <span className="text-[var(--color-text-secondary)] text-xs">×</span>
                              <input
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={(e) => {
                                  const newItems = [...parsedReceipt.items];
                                  const newQty = parseInt(e.target.value) || 1;
                                  newItems[itemIdx] = { 
                                    ...newItems[itemIdx], 
                                    quantity: newQty,
                                    totalPrice: item.unitPrice * newQty 
                                  };
                                  const subtotal = newItems.reduce((sum, i) => sum + i.totalPrice, 0);
                                  const tax = Math.round(subtotal * ((parsedReceipt.taxPercent || 10) / 100));
                                  const serviceFee = Math.round(subtotal * ((parsedReceipt.servicePercent || 5) / 100));
                                  setParsedReceipt({ ...parsedReceipt, items: newItems, subtotal, tax, serviceFee, total: subtotal + tax + serviceFee - parsedReceipt.discount });
                                }}
                                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                className="font-bold text-[var(--color-text-secondary)] bg-transparent border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none w-10 text-center text-sm"
                              />
                              <span className="text-[var(--color-text-secondary)] text-xs">=</span>
                              <span className="font-bold text-[var(--color-accent)]">{formatCurrency(item.unitPrice * item.quantity)}</span>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 mt-3">
                            {people.map(person => {
                              const isAssigned = assignedIds.includes(person.id!);
                              const isMe = person.id === meId;
                              const share = isAssigned && assignedIds.length > 0 
                                ? item.totalPrice / assignedIds.length 
                                : 0;

                              return (
                                <div
                                  key={person.id}
                                  className={cn(
                                    'flex items-center gap-1 px-1 py-1 rounded-full border-2 text-sm font-medium transition-all',
                                    isAssigned 
                                      ? 'border-[var(--color-accent)] bg-blue-50 text-[var(--color-accent)]' 
                                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'
                                  )}
                                >
                                  <button
                                    onClick={() => handleAssignItem(itemIdx, person.id!, isAssigned ? 'remove' : 'add')}
                                    className="flex items-center gap-2 px-2"
                                  >
                                    <div className="w-5 h-5 rounded-full bg-[var(--color-accent)] text-white flex items-center justify-center text-[10px] font-bold">
                                      {person.name.charAt(0).toUpperCase()}
                                    </div>
                                    <span>{person.name}</span>
                                    {isAssigned && (
                                      <span className="text-[10px] font-bold bg-[var(--color-accent)] text-white px-1.5 py-0.5 rounded">
                                        {formatCurrency(share)}
                                      </span>
                                    )}
                                  </button>
                                  {!isMe && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemoveParticipant(person.id!);
                                      }}
                                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] hover:bg-red-100 hover:text-red-500 transition-colors mr-1"
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                            <button
                              onClick={() => setShowAddContact(true)}
                              className="w-8 h-8 flex items-center justify-center rounded-full bg-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)] hover:text-white transition-colors"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-[var(--color-surface)] p-5 rounded-xl border border-[var(--color-border)] border-t-4 border-t-[var(--color-warning)]">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-semibold">Tax & Service ({(parsedReceipt.taxPercent || 0) + (parsedReceipt.servicePercent || 0)}%)</h3>
                  <p className="font-bold text-[var(--color-warning)] mt-0.5">{formatCurrency(parsedReceipt.tax + parsedReceipt.serviceFee)}</p>
                </div>
                <div className="text-sm text-[var(--color-text-secondary)] flex items-center gap-2">
                  <span>i</span>
                  Split proportionally
                </div>
              </div>
            </div>
          </div>

          <aside className="lg:col-span-4 space-y-6 lg:sticky lg:top-24">
            {/* Card 0: Receipt Image */}
            {uploadedImageUrl && (
              <div className="bg-[var(--color-surface)] p-4 rounded-xl shadow-md border border-[var(--color-border)]">
                <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">Receipt</h3>
                <div className="relative rounded-lg overflow-hidden bg-[var(--ref-surface-container-low)]">
                  <img 
                    src={uploadedImageUrl} 
                    alt="Uploaded receipt"
                    className="w-full h-auto max-h-48 object-contain"
                  />
                </div>
              </div>
            )}

            {/* Card 1: Participants - hidden on mobile since we show it in main column */}
            <div className="hidden lg:block">
            <div className="bg-[var(--color-surface)] p-6 rounded-xl shadow-md border border-[var(--color-border)]">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-4">Participants</h3>
              
              <div className="space-y-2 mb-4">
                {/* Me - always first, can't remove */}
                <div className="flex items-center p-3 rounded-xl bg-[var(--ref-surface-container-low)]">
                  <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] text-white flex items-center justify-center font-bold text-sm">
                    Me
                  </div>
                  <div className="ml-3 flex-1">
                    <p className="font-semibold text-sm">Me</p>
                  </div>
                </div>

                {/* Contacts */}
                {people.filter(p => p.id !== meId).map(person => (
                  <div key={person.id} className="flex items-center p-3 rounded-xl bg-[var(--ref-surface-container-low)]">
                    <div className="w-8 h-8 rounded-full bg-[var(--ref-surface-container-highest)] flex items-center justify-center font-bold text-sm">
                      {getInitials(person.name)}
                    </div>
                    <div className="ml-3 flex-1">
                      <p className="font-semibold text-sm">{person.name}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveParticipant(person.id!)}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--color-text-secondary)] hover:bg-red-50 hover:text-red-500 transition-colors"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              {showAddContact ? (
                <div className="p-3 bg-[var(--ref-surface-container-low)] rounded-xl space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-secondary)]" />
                    <input
                      type="text"
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      placeholder="Search contacts..."
                      className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg py-2 pl-10 pr-4 text-sm"
                      autoFocus
                    />
                  </div>
                  {contactSearch && filteredContacts.length > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {filteredContacts.slice(0, 5).map((contact) => (
                        <button
                          key={contact.id}
                          onClick={() => handleAddParticipant(contact)}
                          className="w-full px-3 py-2 text-left hover:bg-[var(--color-surface)] rounded-lg flex items-center gap-2"
                        >
                          <div className="w-6 h-6 rounded-full bg-[var(--ref-surface-container-highest)] flex items-center justify-center text-[10px] font-bold">
                            {getInitials(contact.name)}
                          </div>
                          <span className="text-sm">{contact.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                      placeholder="New contact..."
                      className="flex-1 text-sm"
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateContact()}
                    />
                    <Button onClick={handleCreateContact} isLoading={isCreatingContact} size="sm">Add</Button>
                  </div>
                  <button
                    onClick={() => {
                      setShowAddContact(false);
                      setContactSearch('');
                      setNewContactName('');
                    }}
                    className="w-full text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddContact(true)}
                  className="w-full flex items-center justify-center gap-2 p-2 text-sm text-[var(--color-accent)] hover:bg-blue-50 rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Participant
                </button>
              )}
            </div>
            </div>

            {/* Card 2: Who Paid? */}
            <div className="bg-[var(--color-surface)] p-6 rounded-xl shadow-md border border-[var(--color-border)]">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-4">Who Paid?</h3>
              
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsPayerExpanded(!isPayerExpanded)}
                  className={cn(
                    'w-full flex items-center justify-between px-4 py-3 bg-[var(--ref-surface-container)] hover:bg-[var(--ref-surface-container-high)] transition-colors rounded-xl border border-[var(--color-border)]/10',
                    isPayerExpanded && 'rounded-b-none border-b-0'
                  )}
                >
                  <div className="flex items-center gap-3">
                    {payerId !== null ? (
                      <>
                        <div className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm',
                          payerId === meId ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--ref-surface-container-highest)] text-[var(--color-text-primary)]'
                        )}>
                          {payerId === meId ? 'Me' : getInitials(people.find(p => p.id === payerId)?.name || '')}
                        </div>
                        <span className="font-semibold text-sm">
                          {payerId === meId ? 'Me' : people.find(p => p.id === payerId)?.name}
                        </span>
                      </>
                    ) : (
                      <span className="text-[var(--color-text-secondary)]">Select who paid...</span>
                    )}
                  </div>
                  <ChevronDown className={cn('w-4 h-4 text-[var(--color-text-secondary)] transition-transform', isPayerExpanded && 'rotate-180')} />
                </button>
                
                <div className={cn(
                  'absolute left-0 right-0 z-50 overflow-hidden bg-[var(--ref-surface-container-lowest)] border border-[var(--color-border)]/10 rounded-b-xl shadow-lg transition-all',
                  isPayerExpanded ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0'
                )}
                >
                  <div className="p-2 space-y-1">
                    {people.map(person => {
                      const isMe = person.id === meId;
                      const isSelected = payerId === person.id;
                      return (
                        <button
                          key={person.id}
                          type="button"
                          onClick={() => {
                            setPayerId(person.id!);
                            setIsPayerExpanded(false);
                          }}
                          className={cn(
                            'w-full flex items-center gap-2 p-2 rounded-lg transition-all text-left',
                            isSelected
                              ? 'bg-[var(--color-accent)] text-white'
                              : 'hover:bg-[var(--ref-surface-container-low)]'
                          )}
                        >
                          <div className={cn(
                            'w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs',
                            isSelected ? 'bg-white/20 text-white' : 'bg-[var(--ref-surface-container-highest)] text-[var(--color-text-primary)]'
                          )}>
                            {isMe ? 'M' : getInitials(person.name)}
                          </div>
                          <span className={cn('font-semibold text-sm', isSelected ? 'text-white' : '')}>{person.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Card 3: Fund Source - only when Me pays */}
            {payerId === meId && (
              <div className="bg-[var(--color-surface)] p-6 rounded-xl shadow-md border border-[var(--color-border)]">
                <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3 block">
                  Fund Source
                </label>
                <div className="w-full">
                  <button
                    type="button"
                    onClick={() => setIsAccountExpanded(!isAccountExpanded)}
                    className={cn(
                      'w-full flex items-center justify-between px-4 py-3 bg-[var(--ref-surface-container)] hover:bg-[var(--ref-surface-container-high)] transition-colors rounded-xl border border-[var(--color-border)]/10',
                      isAccountExpanded && 'rounded-b-none border-b-0'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[var(--color-accent)] flex items-center justify-center">
                        {SelectedAccountIcon && <SelectedAccountIcon className="w-5 h-5 text-white" />}
                      </div>
                      <div className="text-left">
                        <p className="font-semibold text-sm">{selectedAccount?.name || 'Select account'}</p>
                        <p className="text-xs text-[var(--color-muted)]">{selectedAccount ? formatCurrency(selectedAccount.balance) : 'Required'}</p>
                      </div>
                    </div>
                    <ChevronDown className={cn('w-4 h-4 text-[var(--color-text-secondary)] transition-transform', isAccountExpanded && 'rotate-180')} />
                  </button>
                  
                  <div className={cn(
                    'absolute left-0 right-0 z-50 overflow-hidden bg-[var(--ref-surface-container-lowest)] border border-[var(--color-border)]/10 rounded-b-xl shadow-lg transition-all',
                    isAccountExpanded ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0'
                  )}
                  style={{ maxWidth: '28rem' }}
                  >
                    <div className="p-2 space-y-1">
                      {accounts.map((account, idx) => {
                        const Icon = WALLET_ICONS[idx % 3];
                        const isSelected = selectedAccountId === account.id;
                        return (
                          <button
                            key={account.id}
                            type="button"
                            onClick={() => {
                              setSelectedAccountId(account.id);
                              setIsAccountExpanded(false);
                            }}
                            className={cn(
                              'w-full flex items-center gap-2 p-2 rounded-lg transition-all text-left',
                              isSelected
                                ? 'bg-[var(--color-accent)] text-white'
                                : 'hover:bg-[var(--ref-surface-container-low)]'
                            )}
                          >
                            <Icon className={cn('w-4 h-4', isSelected ? 'text-white' : 'text-[var(--color-muted)]')} />
                            <div className="flex-1">
                              <p className={cn('font-semibold text-sm', isSelected ? 'text-white' : '')}>{account.name}</p>
                              <p className={cn('text-xs', isSelected ? 'text-white/80' : 'text-[var(--color-muted)]')}>{formatCurrency(account.balance)}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Card 4: Split Preview */}
            <div className="bg-[var(--color-surface)] p-6 rounded-xl shadow-md border border-[var(--color-border)]">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-4">Split Preview</h3>
              
              <div className="space-y-4">
                {splitResults.filter(r => r.total > 0).map(result => (
                  <div key={result.personId} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] text-white flex items-center justify-center font-bold text-xs">
                        {result.personName === 'Me' ? 'M' : getInitials(result.personName)}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{result.personName}</p>
                        <p className="text-[10px] text-[var(--color-text-secondary)] uppercase">
                          {result.itemCount} {result.itemCount === 1 ? 'Item' : 'Items'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{formatCurrency(result.total)}</p>
                      {payerId === meId && result.personName !== 'Me' && (
                        <p className="text-[10px] text-[var(--color-success)]">Owes Me</p>
                      )}
                      {payerId !== meId && payerId === result.personId && (
                        <p className="text-[10px] text-[var(--color-danger)]">Paid</p>
                      )}
                      {payerId !== meId && payerId !== result.personId && result.personName === 'Me' && (
                        <p className="text-[10px] text-[var(--color-warning)]">Owes</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {unallocated > 0 && (
                <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                  <p className="text-[11px] text-[var(--color-danger)] flex items-center gap-1">
                    <span>!</span>
                    {formatCurrency(unallocated)} unassigned
                  </p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <Button 
                onClick={() => {}} 
                variant="secondary"
                className="w-full"
              >
                Save as Draft
              </Button>
              <Button 
                onClick={handleCreateLoans} 
                className="w-full"
                disabled={isLoading || payerId === null || unallocated > 0 || (payerId === meId && !selectedAccountId)}
              >
                {isLoading ? 'Processing...' : 'Confirm Split'}
              </Button>
            </div>
          </aside>
        </div>
      </PageContainer>
    </>
  );
}
