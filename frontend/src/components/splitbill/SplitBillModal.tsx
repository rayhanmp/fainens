import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { useAuth } from '../../lib/auth';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';

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
  isNew?: boolean;
  avatar?: string;
}

interface ItemAssignment {
  itemIndex: number;
  personIds: number[];
  splitType: 'equal' | 'percentage' | 'exact';
  customValues?: Record<number, number>;
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
}

interface Contact {
  id: number;
  name: string;
  avatar?: string;
}

interface SplitBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: WalletAccount[];
}

type Step = 'upload' | 'split';

export function SplitBillModal({ isOpen, onClose, accounts }: SplitBillModalProps) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('upload');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [parsedReceipt, setParsedReceipt] = useState<ParsedReceipt | null>(null);
  
  const [people, setPeople] = useState<SplitBillPerson[]>([]);
  const [assignments, setAssignments] = useState<ItemAssignment[]>([]);
  const [splitResults, setSplitResults] = useState<PersonSplitResult[]>([]);
  
  const [isBorrower, setIsBorrower] = useState(true);
  const [selectedWalletId, setSelectedWalletId] = useState<number>(accounts[0]?.id || 0);
  
  const [createdLoans, setCreatedLoans] = useState<Array<{ id: number; direction: string; amountCents: number }>>([]);
  
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [newPersonName, setNewPersonName] = useState('');
  const [showAddPerson, setShowAddPerson] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const meId = 0;

  useEffect(() => {
    if (isOpen && user?.email) {
      const mePerson: SplitBillPerson = {
        id: meId,
        name: 'Me',
        isNew: false,
      };
      setPeople([mePerson]);
    }
  }, [isOpen, user]);

  const loadContacts = useCallback(async () => {
    try {
      const data = await api.contacts.list() as Contact[];
      setContacts(data);
    } catch (err) {
      console.error('Failed to load contacts:', err);
    }
  }, []);

  const resetState = useCallback(() => {
    setStep('upload');
    setIsLoading(false);
    setError(null);
    setParsedReceipt(null);
    setPeople([{ id: meId, name: 'Me', isNew: false }]);
    setAssignments([]);
    setSplitResults([]);
    setIsBorrower(true);
    setCreatedLoans([]);
    setContactSearch('');
    setNewPersonName('');
    setShowAddPerson(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        try {
          const result = await api.splitbill.scan(base64, file.name);
          setParsedReceipt(result.parsed);
          
          const defaultAssignments = result.parsed.items.map((_: ParsedReceiptItem, idx: number) => ({
            itemIndex: idx,
            personIds: [meId],
            splitType: 'equal' as const,
          }));
          setAssignments(defaultAssignments);
          
          calculateResults(result.parsed, [{ id: meId, name: 'Me', isNew: false }], defaultAssignments);
          setStep('split');
        } catch (err) {
          setError((err as Error).message || 'Failed to scan receipt');
        } finally {
          setIsLoading(false);
        }
      };
      reader.onerror = () => {
        setError('Failed to read file');
        setIsLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError((err as Error).message);
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

      if (assignment.splitType === 'equal') {
        const sharePerPerson = item.totalPrice / assignment.personIds.length;
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
      } else if (assignment.splitType === 'exact' && assignment.customValues) {
        for (const personId of assignment.personIds) {
          const exactAmount = assignment.customValues[personId] || 0;
          if (personSubtotals[personId] !== undefined) {
            personSubtotals[personId] += exactAmount;
            personItemCounts[personId] += 1;
            personItems[personId].push({
              ...item,
              totalPrice: exactAmount,
              quantity: 1,
            });
          }
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
    let newAssignments = [...assignments];
    
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
        splitType: currentIds.length > 1 ? 'equal' : newAssignments[existingIdx].splitType,
      };
    } else if (action === 'add') {
      newAssignments.push({
        itemIndex,
        personIds: [personId],
        splitType: 'equal',
      });
    }
    
    setAssignments(newAssignments);
    
    if (parsedReceipt) {
      calculateResults(parsedReceipt, people, newAssignments);
    }
  }, [assignments, parsedReceipt, people, calculateResults]);

  const handleAddPerson = useCallback(() => {
    if (!newPersonName.trim()) return;
    
    const newPerson: SplitBillPerson = {
      id: people.length > 0 ? Math.max(...people.filter(p => p.id !== undefined).map(p => p.id || 0)) + 1 : 1,
      name: newPersonName.trim(),
      isNew: true,
    };
    
    const newPeople = [...people, newPerson];
    setPeople(newPeople);
    setNewPersonName('');
    setShowAddPerson(false);
    
    if (parsedReceipt) {
      calculateResults(parsedReceipt, newPeople, assignments);
    }
  }, [newPersonName, people, parsedReceipt, assignments, calculateResults]);

  const handleSelectContact = useCallback((contact: Contact) => {
    const exists = people.some(p => p.id === contact.id);
    if (!exists) {
      const newPerson: SplitBillPerson = {
        id: contact.id,
        name: contact.name,
        avatar: contact.avatar,
      };
      const newPeople = [...people, newPerson];
      setPeople(newPeople);
      
      if (parsedReceipt) {
        calculateResults(parsedReceipt, newPeople, assignments);
      }
    }
    setContactSearch('');
  }, [people, parsedReceipt, assignments, calculateResults]);

  const handleRemovePerson = useCallback((personId: number) => {
    if (personId === meId) return;
    
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

  const handleCreateLoans = useCallback(async () => {
    if (!selectedWalletId || splitResults.length === 0) return;
    
    setIsLoading(true);
    try {
      const loans = await api.splitbill.createLoans({
        splitResults: splitResults.map(r => ({
          personId: r.personId,
          personName: r.personName,
          total: r.total,
        })),
        isBorrower,
        walletAccountId: selectedWalletId,
      });
      setCreatedLoans(loans);
      handleClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedWalletId, splitResults, isBorrower]);

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
  const unallocated = (parsedReceipt?.subtotal || 0) - totalAllocated;

  const renderUploadStep = () => (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Scan Receipt</h2>
      <p className="text-sm text-[var(--color-text-secondary)]">
        Upload a photo of your receipt to automatically extract items and calculate split.
      </p>
      
      <div 
        className="border-2 border-dashed border-[var(--color-border)] rounded-xl p-12 text-center cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors"
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
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
            <p className="text-sm text-[var(--color-text-secondary)]">Scanning receipt...</p>
          </div>
        ) : (
          <>
            <div className="text-4xl mb-3">📷</div>
            <p className="font-semibold">Click to upload receipt</p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1">PNG, JPG up to 5MB</p>
          </>
        )}
      </div>
      
      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}
    </div>
  );

  const renderSplitStep = () => {
    if (!parsedReceipt) return null;

    return (
      <div className="flex flex-col lg:flex-row gap-8 -m-6 p-4 lg:p-6 max-h-[80vh] overflow-hidden">
        {/* Left Column - Receipt Items */}
        <div className="lg:col-span-8 space-y-6 overflow-y-auto pr-2">
          {/* Merchant Header */}
          <div className="bg-[var(--color-surface-container-lowest)] p-6 rounded-xl border-l-4 border-[var(--color-primary)]">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-secondary)]">Merchant</span>
                <h1 className="text-2xl font-extrabold mt-1">{parsedReceipt.merchantName || 'Restaurant'}</h1>
                <p className="text-[var(--color-text-secondary)] text-sm mt-1">
                  {formatDate(parsedReceipt.receiptDate)}
                </p>
              </div>
              <div className="text-right">
                <span className="text-xs text-[var(--color-text-secondary)]">Total Bill</span>
                <div className="text-2xl font-bold text-[var(--color-primary)] mt-1">
                  {formatCurrency(parsedReceipt.total)}
                </div>
              </div>
            </div>
          </div>

          {/* Bill Items */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Bill Items</h2>
            </div>

            <div className="space-y-4">
              {parsedReceipt.items.map((item, itemIdx) => {
                const assignedIds = getAssignedPeople(itemIdx);
                
                return (
                  <div 
                    key={itemIdx} 
                    className="bg-[var(--color-surface-container-lowest)] p-5 rounded-xl hover:shadow-md transition-all"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-bold text-base">{item.name}</h3>
                        <p className="font-bold text-[var(--color-primary)] mt-1">
                          {formatCurrency(item.totalPrice)}
                          {item.quantity > 1 && (
                            <span className="text-xs font-normal text-[var(--color-text-secondary)] ml-2">
                              (Qty: {item.quantity})
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Participant Pills */}
                    <div className="flex flex-wrap gap-2">
                      {people.map(person => {
                        const isAssigned = assignedIds.includes(person.id!);
                        const personResult = splitResults.find(r => r.personId === person.id);
                        const share = isAssigned && personResult 
                          ? (assignedIds.length > 1 
                              ? item.totalPrice / assignedIds.length 
                              : item.totalPrice)
                          : 0;

                        return (
                          <button
                            key={person.id}
                            onClick={() => handleAssignItem(
                              itemIdx, 
                              person.id!, 
                              isAssigned ? 'remove' : 'add'
                            )}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border-2 transition-all ${
                              isAssigned 
                                ? 'border-[var(--color-primary)] bg-[var(--color-primary-fixed)]/30' 
                                : 'border-[var(--color-outline-variant)] hover:border-[var(--color-primary)]'
                            }`}
                          >
                            <div className="w-6 h-6 rounded-full bg-[var(--color-surface-container)] flex items-center justify-center text-xs font-bold">
                              {person.name.charAt(0).toUpperCase()}
                            </div>
                            <span className={`text-sm font-semibold ${isAssigned ? 'text-[var(--color-primary)]' : ''}`}>
                              {person.name}
                            </span>
                            {isAssigned && (
                              <span className="text-[10px] font-bold bg-[var(--color-primary)]/10 text-[var(--color-primary)] px-1.5 py-0.5 rounded">
                                {formatCurrency(share)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                      
                      {/* Add person button */}
                      <button
                        onClick={() => setShowAddPerson(true)}
                        className="w-9 h-9 flex items-center justify-center rounded-full bg-[var(--color-surface-container)] text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-fixed)] transition-colors"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tax & Service */}
          <div className="bg-[var(--color-surface-container)] p-5 rounded-xl border-t-4 border-[var(--color-tertiary)]">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-bold">Tax & Service ({(parsedReceipt.taxPercent || 0) + (parsedReceipt.servicePercent || 0)}%)</h3>
                <p className="font-bold text-[var(--color-tertiary)] mt-1">
                  {formatCurrency(parsedReceipt.tax + parsedReceipt.serviceFee)}
                </p>
              </div>
              <div className="text-xs text-[var(--color-text-secondary)] italic flex items-center gap-1">
                <span>ℹ️</span>
                Split proportionally
              </div>
            </div>
            <div className="w-full bg-[var(--color-surface-container-highest)] h-2 rounded-full overflow-hidden">
              <div className="bg-[var(--color-tertiary)] w-full h-full"></div>
            </div>
          </div>

          {/* Add Person Quick Add */}
          {showAddPerson && (
            <div className="bg-[var(--color-surface-container-lowest)] p-4 rounded-xl space-y-3">
              <div className="flex gap-2">
                <Input
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Search contacts..."
                  className="flex-1"
                  onFocus={loadContacts}
                />
                <Button size="sm" onClick={handleAddPerson}>Add</Button>
                <Button size="sm" variant="secondary" onClick={() => setShowAddPerson(false)}>✕</Button>
              </div>
              {contactSearch && filteredContacts.length > 0 && (
                <div className="border rounded-lg max-h-32 overflow-y-auto">
                  {filteredContacts.slice(0, 5).map(contact => (
                    <button
                      key={contact.id}
                      onClick={() => handleSelectContact(contact)}
                      className="w-full px-3 py-2 text-left hover:bg-[var(--color-surface-hover)] flex items-center gap-2"
                    >
                      <div className="w-6 h-6 rounded-full bg-[var(--color-surface-container)] flex items-center justify-center text-xs">
                        {contact.name.charAt(0)}
                      </div>
                      {contact.name}
                    </button>
                  ))}
                </div>
              )}
              <Input
                value={newPersonName}
                onChange={(e) => setNewPersonName(e.target.value)}
                placeholder="Or add new person..."
                className="w-full"
                onKeyDown={(e) => e.key === 'Enter' && handleAddPerson()}
              />
            </div>
          )}

          {/* Participants List */}
          <div className="space-y-2">
            <h3 className="font-bold text-sm">Participants ({people.length})</h3>
            <div className="flex flex-wrap gap-2">
              {people.map(person => (
                <div 
                  key={person.id}
                  className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-surface-container)] rounded-full"
                >
                  <div className="w-5 h-5 rounded-full bg-[var(--color-primary-fixed)] flex items-center justify-center text-[10px] font-bold">
                    {person.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm font-medium">{person.name}</span>
                  {person.id !== meId && (
                    <button 
                      onClick={() => handleRemovePerson(person.id!)}
                      className="text-[var(--color-text-secondary)] hover:text-red-500"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column - Summary */}
        <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-0">
          <div className="bg-[var(--color-surface-container-lowest)] p-6 rounded-xl shadow-lg border border-[var(--color-surface-container-high)]">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
              <span>📊</span>
              Summary
            </h2>
            
            <div className="space-y-4">
              {splitResults.filter(r => r.total > 0).map(result => (
                <div key={result.personId} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[var(--color-primary-fixed)] flex items-center justify-center font-bold">
                      {result.personName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-bold text-sm">{result.personName}</p>
                      <p className="text-[10px] text-[var(--color-text-secondary)] uppercase tracking-wider">
                        {result.itemCount} Items
                      </p>
                    </div>
                  </div>
                  <p className="font-bold text-lg">{formatCurrency(result.total)}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-6 border-t border-[var(--color-surface-container-high)]">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-[var(--color-text-secondary)]">Allocated</span>
                <span className="font-bold text-sm">{formatCurrency(totalAllocated)} / {formatCurrency(parsedReceipt.subtotal)}</span>
              </div>
              <div className="w-full bg-[var(--color-surface-container-high)] h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-[var(--color-primary)] h-full transition-all"
                  style={{ width: `${parsedReceipt.subtotal > 0 ? (totalAllocated / parsedReceipt.subtotal) * 100 : 0}%` }}
                ></div>
              </div>
              {unallocated > 0 && (
                <p className="text-[11px] text-red-500 mt-2 flex items-center gap-1 font-medium">
                  ⚠️ {formatCurrency(unallocated)} unassigned
                </p>
              )}
            </div>

            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={isBorrower}
                    onChange={() => setIsBorrower(true)}
                    className="text-[var(--color-primary)]"
                  />
                  <span className="text-sm">I borrowed</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={!isBorrower}
                    onChange={() => setIsBorrower(false)}
                    className="text-[var(--color-primary)]"
                  />
                  <span className="text-sm">I lent</span>
                </label>
              </div>

              <select
                value={selectedWalletId}
                onChange={(e) => setSelectedWalletId(parseInt(e.target.value))}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                {accounts.filter(a => a.type === 'asset').map(account => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </div>

            <Button 
              onClick={handleCreateLoans} 
              className="w-full mt-6 bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-primary-container)] text-white py-3 rounded-full font-bold shadow-lg hover:opacity-90"
              disabled={isLoading || unallocated > 0}
            >
              {isLoading ? 'Creating...' : 'Confirm Split & Create Loans'}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const filteredContacts = contacts.filter(c => 
    c.name.toLowerCase().includes(contactSearch.toLowerCase())
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={step === 'upload' ? 'Split Bill' : parsedReceipt?.merchantName || 'Split Bill'}
      className="max-w-6xl w-full"
      size="xl"
    >
      {step === 'upload' ? renderUploadStep() : renderSplitStep()}
    </Modal>
  );
}