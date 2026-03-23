import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { CurrencyInput } from '../ui/CurrencyInput';
import { api } from '../../lib/api';
import { formatCurrency, cn, getAccountTypeLabel, parseIdNominalToInt, formatFileSize } from '../../lib/utils';
import {
  Plus,
  Trash2,
  ArrowRightLeft,
  ArrowRight,
  Calculator,
  Tag as TagIcon,
  Landmark,
  Wallet,
  Banknote,
  Save,
  Users,
  ImagePlus,
  StickyNote,
  CreditCard,
  ArrowUpRight,
  ArrowDownRight,
  ShoppingCart,
  X,
} from 'lucide-react';
import MapPicker, { TransportRoute, type Location as MapLocation, calculateDistance } from '../ui/MapPicker';
import { AttachmentUploader, uploadPendingAttachments } from '../ui/AttachmentUploader';

export type WalletAccount = {
  id: number;
  name: string;
  type: string;
  balance: number;
  systemKey?: string | null;
};

export type CategoryRow = {
  id: number;
  name: string;
  icon?: string | null;
  color?: string | null;
};

export type TagRow = { id: number; name: string; color: string };

type SimpleTxType = 'expense' | 'income' | 'transfer' | 'paylater';

type TxLine = {
  id: number;
  accountId: number;
  debit: number;
  credit: number;
  description?: string;
};

export type EditingTransaction = {
  id: number;
  date: number;
  description: string;
  notes?: string;
  place?: string;
  categoryId?: number | null;
  txType?: string;
  lines: TxLine[];
  tags: Array<{ tagId: number; name: string; color: string }>;
};

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  accounts: WalletAccount[];
  categories: CategoryRow[];
  tags: TagRow[];
  editingTransaction: EditingTransaction | null;
  periodId?: number | null;
  initialMode?: 'view' | 'edit';
}

const WALLET_ICONS = [Landmark, Wallet, Banknote] as const;

function toDatetimeLocal(d: Date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const stitchSelect =
  'rounded-xl border-none bg-[var(--ref-surface-container-low)] px-3 py-3 text-[var(--color-text-primary)] focus:ring-2 focus:ring-[var(--color-accent)]/20';

const stickyFooter =
  'sticky bottom-0 z-10 -mx-5 mt-4 flex flex-col gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 px-5 py-3 backdrop-blur-sm shadow-[0_-10px_30px_-12px_rgba(15,23,42,0.12)] lg:-mx-6 lg:px-6';

function startOfLocalDayMs(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function TransactionModal({
  isOpen,
  onClose,
  onSaved,
  accounts,
  categories,
  tags,
  editingTransaction,
  periodId,
  initialMode = 'edit',
}: TransactionModalProps) {
  const [isAccountingMode, setIsAccountingMode] = useState(false);
  const [viewMode, setViewMode] = useState(initialMode === 'view');
  
  // Reset view mode when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setViewMode(initialMode === 'view' && editingTransaction !== null);
    }
  }, [isOpen, initialMode, editingTransaction]);

  const [simpleForm, setSimpleForm] = useState({
    dateTime: toDatetimeLocal(),
    type: 'expense' as SimpleTxType,
    fromAccountId: '',
    toAccountId: '',
    categoryId: '',
    /** Recognition tx id for paylater settlement */
    paylaterRecognitionId: '',
    paylaterExpenseId: '',
    paylaterLiabilityId: '',
    /** Installment options for paylater_buy */
    paylaterInstallmentMonths: '3' as '1' | '3' | '6' | '12',
    paylaterInterestRate: '',
    paylaterAdminFee: '',
    paylaterFirstDueDate: '',
    amount: '',
    description: '',
    notes: '',
    place: '',
    tagIds: [] as number[],
    /** Transport location fields */
    origin: null as MapLocation | null,
    destination: null as MapLocation | null,
    /** Transport service fields */
    rideProvider: '' as 'gojek' | 'grab' | 'others' | '',
    rideService: '',
    /** Transfer admin fee (in rupiah) */
    transferAdminFee: '',
  });

  // Map picker modal state
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [mapPickerMode, setMapPickerMode] = useState<'origin' | 'destination'>('origin');

  /** Installment schedule preview for paylater */
  const [installmentPreview, setInstallmentPreview] = useState<Array<{
    installmentNumber: number;
    totalInstallments: number;
    dueDate: number;
    principalCents: number;
    interestCents: number;
    feeCents: number;
    totalCents: number;
  }> | null>(null);

  /** Loaded when add-transaction modal opens — used for Pay later type */
  const [paylaterObligationsState, setPaylaterObligationsState] = useState<Awaited<
    ReturnType<typeof api.paylater.obligations>
  > | null>(null);

  /** Attachments for the transaction */
  const [attachments, setAttachments] = useState<Array<{
    id: number;
    transactionId: number;
    filename: string;
    mimetype: string;
    fileSize: number;
  }>>([]);

  /** Pending attachments (not yet uploaded) */
  const [pendingAttachments, setPendingAttachments] = useState<Array<{
    id: string;
    file: File;
    filename: string;
    mimetype: string;
    fileSize: number;
    preview?: string;
  }>>([]);

  /** Attachment preview modal */
  const [previewAttachment, setPreviewAttachment] = useState<{
    id: number;
    url: string;
    filename: string;
    mimetype: string;
  } | null>(null);

  /** Attachment URLs for thumbnails (id -> url) */
  const [attachmentUrls, setAttachmentUrls] = useState<Record<number, string>>({});

  const [journalForm, setJournalForm] = useState({
    dateTime: toDatetimeLocal(),
    description: '',
    notes: '',
    place: '',
    tagIds: [] as number[],
    lines: [
      { accountId: '', debit: '', credit: '', description: '' },
      { accountId: '', debit: '', credit: '', description: '' },
    ] as Array<{ accountId: string; debit: string; credit: string; description: string }>,
  });

  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const walletAccounts = accounts.filter(
    (a) => (a.type === 'asset' || a.type === 'liability') && !a.systemKey,
  );
  
  // Helper to check if an account is a paylater account
  const isPaylaterAccount = (accountId: string): boolean => {
    const account = accounts.find(a => a.id.toString() === accountId);
    return account?.type === 'liability' && !account.systemKey;
  };

  // Helper to check if account is a bank account
  const isBankAccount = (accountId: string): boolean => {
    const account = accounts.find(a => a.id.toString() === accountId);
    return account?.type === 'asset' && !account.systemKey && 
           (account.name.toLowerCase().includes('bank') || 
            account.name.toLowerCase().includes('bca') ||
            account.name.toLowerCase().includes('bni') ||
            account.name.toLowerCase().includes('mandiri') ||
            account.name.toLowerCase().includes('bri'));
  };

  // Helper to check if account is GoPay
  const isGoPayAccount = (accountId: string): boolean => {
    const account = accounts.find(a => a.id.toString() === accountId);
    return account?.type === 'asset' && !account.systemKey && 
           account.name.toLowerCase().includes('gopay');
  };

  // Helper to check if account is OVO
  const isOVOAccount = (accountId: string): boolean => {
    const account = accounts.find(a => a.id.toString() === accountId);
    return account?.type === 'asset' && !account.systemKey && 
           account.name.toLowerCase().includes('ovo');
  };

  // Calculate transfer fee and amounts
  const calculateTransferDetails = () => {
    if (simpleForm.type !== 'transfer' || !simpleForm.fromAccountId || !simpleForm.toAccountId) {
      return null;
    }

    const amount = parseIdNominalToInt(simpleForm.amount);
    if (!amount || amount <= 0) return null;

    const fromId = simpleForm.fromAccountId;
    const toId = simpleForm.toAccountId;

    // Check if either account is paylater - no transfers allowed
    if (isPaylaterAccount(fromId) || isPaylaterAccount(toId)) {
      return { error: 'Cannot transfer to or from paylater accounts' };
    }

    // Bank to GoPay: sender pays fee (amount + 1000 deducted from bank)
    if (isBankAccount(fromId) && isGoPayAccount(toId)) {
      const fee = 1000;
      return {
        fee,
        senderPays: true,
        fromAmount: amount + fee,
        toAmount: amount,
        description: `Transfer ${formatCurrency(amount)} + Fee ${formatCurrency(fee)} = ${formatCurrency(amount + fee)} deducted from source`
      };
    }

    // To OVO: recipient pays fee (amount sent, but fee deducted at destination)
    if (isOVOAccount(toId)) {
      const fee = 1000;
      return {
        fee,
        senderPays: false,
        fromAmount: amount,
        toAmount: amount - fee,
        description: `Transfer ${formatCurrency(amount)} - Fee ${formatCurrency(fee)} = ${formatCurrency(amount - fee)} received (fee deducted at destination)`
      };
    }

    return null;
  };

  const [editMeta, setEditMeta] = useState({
    date: '',
    description: '',
    notes: '',
    place: '',
    categoryId: '',
    tagIds: [] as number[],
  });

  useEffect(() => {
    if (!isOpen) return;
    if (editingTransaction) {
      setIsAccountingMode(false);
      setEditMeta({
        date: new Date(editingTransaction.date).toISOString().split('T')[0],
        description: editingTransaction.description,
        notes: editingTransaction.notes || '',
        place: editingTransaction.place || '',
        categoryId: editingTransaction.categoryId?.toString() || '',
        tagIds: editingTransaction.tags.map((t) => t.tagId),
      });
      setJournalForm({
        dateTime: toDatetimeLocal(new Date(editingTransaction.date)),
        description: editingTransaction.description,
        notes: editingTransaction.notes || '',
        place: editingTransaction.place || '',
        tagIds: editingTransaction.tags.map((t) => t.tagId),
        lines: editingTransaction.lines.map((l) => ({
          accountId: l.accountId.toString(),
          debit: l.debit.toString(),
          credit: l.credit.toString(),
          description: l.description || '',
        })),
      });
      // Load attachments for editing transaction
      api.attachments.list(editingTransaction.id.toString())
        .then((atts) => {
          setAttachments(atts);
          // Fetch URLs for image attachments to show thumbnails
          atts.filter(a => a.mimetype.startsWith('image/')).forEach(att => {
            api.attachments.getUrl(att.id, 3600).then(({ url }) => {
              setAttachmentUrls(prev => ({ ...prev, [att.id]: url }));
            }).catch(() => {
              // Silently fail - will show placeholder
            });
          });
        })
        .catch(() => setAttachments([]));
    } else {
      setIsAccountingMode(false);
      setSimpleForm({
        dateTime: toDatetimeLocal(),
        type: 'expense',
        fromAccountId: '',
        toAccountId: '',
        categoryId: '',
        paylaterRecognitionId: '',
        paylaterExpenseId: '',
        paylaterLiabilityId: '',
        paylaterInstallmentMonths: '3',
        paylaterInterestRate: '',
        paylaterAdminFee: '',
        paylaterFirstDueDate: '',
        amount: '',
        description: '',
        notes: '',
        place: '',
        tagIds: [],
        origin: null,
        destination: null,
        rideProvider: '',
        rideService: '',
        transferAdminFee: '',
      });
      setInstallmentPreview(null);
      setAttachments([]);
      setAttachmentUrls({});
      setPendingAttachments([]);
      setJournalForm({
        dateTime: toDatetimeLocal(),
        description: '',
        notes: '',
        place: '',
        tagIds: [],
        lines: [
          { accountId: '', debit: '', credit: '', description: '' },
          { accountId: '', debit: '', credit: '', description: '' },
        ],
      });
    }
    setFormError('');
  }, [isOpen, editingTransaction]);

  useEffect(() => {
    if (!isOpen || editingTransaction) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await api.paylater.obligations();
        if (!cancelled) setPaylaterObligationsState(p);
      } catch {
        if (!cancelled) setPaylaterObligationsState(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, editingTransaction]);

  // Auto-generate transaction name for transport expenses
  useEffect(() => {
    if (!simpleForm.description && simpleForm.origin && simpleForm.destination) {
      const selectedCategory = categories.find(c => c.id.toString() === simpleForm.categoryId);
      const isTransport = selectedCategory && /transport/i.test(selectedCategory.name);
      
      if (isTransport) {
        // Extract short place names (first part before comma)
        const originName = simpleForm.origin.name.split(',')[0].trim();
        const destName = simpleForm.destination.name.split(',')[0].trim();
        const rideService = simpleForm.rideService ? ` [${simpleForm.rideService}]` : '';
        
        setSimpleForm(prev => ({
          ...prev,
          description: `${originName} to ${destName}${rideService}`
        }));
      }
    }
  }, [simpleForm.origin, simpleForm.destination, simpleForm.rideService, simpleForm.categoryId, categories]);

  // Calculate installment preview for paylater
  const calculateInstallmentPreview = async (form: typeof simpleForm) => {
    if (!form.amount || !form.paylaterFirstDueDate) return;
    
    try {
      const amount = parseIdNominalToInt(form.amount);
      const result = await api.paylater.calculateSchedule({
        principalAmount: amount,
        installmentMonths: parseInt(form.paylaterInstallmentMonths, 10) as 1 | 3 | 6 | 12,
        interestRatePercent: form.paylaterInterestRate ? parseFloat(form.paylaterInterestRate) : undefined,
        adminFeeCents: form.paylaterAdminFee ? parseIdNominalToInt(form.paylaterAdminFee) : undefined,
        firstDueDate: startOfLocalDayMs(new Date(form.paylaterFirstDueDate).getTime()),
      });
      setInstallmentPreview(result.installments);
    } catch {
      setInstallmentPreview(null);
    }
  };

  const handleEditMetaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTransaction) return;
    setFormError('');
    setIsSubmitting(true);
    try {
      await api.transactions.update(editingTransaction.id, {
        description: editMeta.description,
        notes: editMeta.notes || null,
        place: editMeta.place || null,
        date: editMeta.date,
        tagIds: editMeta.tagIds,
        categoryId: editMeta.categoryId ? parseInt(editMeta.categoryId, 10) : null,
      });
      onSaved();
      onClose();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSimpleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const amount = parseIdNominalToInt(simpleForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('Please enter a valid amount');
      return;
    }

    let walletAccountId: number;
    let toWalletAccountId: number | undefined;

    if (simpleForm.type === 'paylater') {
      if (!simpleForm.fromAccountId) {
        setFormError('Please select a wallet to pay from');
        return;
      }
      if (!simpleForm.paylaterRecognitionId) {
        setFormError('Please select a paylater obligation');
        return;
      }
      const recognitionId = parseInt(simpleForm.paylaterRecognitionId, 10);
      const outstanding = paylaterObligationsState?.obligations.find(
        (o) => o.recognitionTxId === recognitionId,
      );
      if (!outstanding || outstanding.outstandingCents <= 0) {
        setFormError('Selected obligation not found or already paid');
        return;
      }
      if (amount > outstanding.outstandingCents) {
        setFormError(
          `Amount cannot exceed remaining balance (${formatCurrency(outstanding.outstandingCents)})`,
        );
        return;
      }

      setIsSubmitting(true);
      try {
        await api.paylater.settle({
          date: new Date(simpleForm.dateTime).getTime(),
          description: simpleForm.description || 'Paylater payment',
          paymentAmount: amount,
          paylaterLiabilityAccountId: outstanding.liabilityAccountId,
          bankAccountId: parseInt(simpleForm.fromAccountId, 10),
          originalTxId: recognitionId,
          notes: simpleForm.notes || undefined,
        });
        onSaved();
        onClose();
      } catch (err) {
        setFormError((err as Error).message);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (simpleForm.type === 'expense') {
      if (!simpleForm.fromAccountId) {
        setFormError('Please select a wallet');
        return;
      }
      if (!simpleForm.categoryId) {
        setFormError('Please select a category');
        return;
      }
      
      // Check if this is a paylater expense
      const selectedAccount = accounts.find(a => a.id.toString() === simpleForm.fromAccountId);
      if (selectedAccount?.type === 'liability') {
        // PayLater purchase
        if (!simpleForm.paylaterFirstDueDate) {
          setFormError('Select first installment due date');
          return;
        }
        setIsSubmitting(true);
        try {
          await api.paylater.recognize({
            date: new Date(simpleForm.dateTime).getTime(),
            description: simpleForm.description || 'PayLater purchase',
            principalAmount: amount,
            expenseAccountId: parseInt(simpleForm.categoryId, 10),
            paylaterLiabilityAccountId: parseInt(simpleForm.fromAccountId, 10),
            installmentMonths: parseInt(simpleForm.paylaterInstallmentMonths, 10) as 1 | 3 | 6 | 12,
            interestRatePercent: simpleForm.paylaterInterestRate ? parseFloat(simpleForm.paylaterInterestRate) : undefined,
            adminFeeCents: simpleForm.paylaterAdminFee ? parseIdNominalToInt(simpleForm.paylaterAdminFee) : undefined,
            firstDueDate: startOfLocalDayMs(new Date(simpleForm.paylaterFirstDueDate).getTime()),
            notes: simpleForm.notes || undefined,
          });
          onSaved();
          onClose();
        } catch (err) {
          setFormError((err as Error).message);
        } finally {
          setIsSubmitting(false);
        }
        return;
      }
      
      walletAccountId = parseInt(simpleForm.fromAccountId, 10);
    } else if (simpleForm.type === 'income') {
      if (!simpleForm.toAccountId) {
        setFormError('Please select a wallet');
        return;
      }
      walletAccountId = parseInt(simpleForm.toAccountId, 10);
    } else {
      if (!simpleForm.fromAccountId || !simpleForm.toAccountId) {
        setFormError('Please select both wallets');
        return;
      }
      if (simpleForm.fromAccountId === simpleForm.toAccountId) {
        setFormError('Source and destination must differ');
        return;
      }
      
      // Prevent transfers to/from paylater accounts
      if (isPaylaterAccount(simpleForm.fromAccountId) || isPaylaterAccount(simpleForm.toAccountId)) {
        setFormError('Cannot transfer to or from paylater accounts');
        return;
      }
      
      walletAccountId = parseInt(simpleForm.fromAccountId, 10);
      toWalletAccountId = parseInt(simpleForm.toAccountId, 10);
    }

    setIsSubmitting(true);
    try {
      const dateIso = new Date(simpleForm.dateTime).toISOString();
      
      // Check if this is a transport expense and include location data
      const selectedCategory = simpleForm.type === 'expense' && simpleForm.categoryId
        ? categories.find(c => c.id.toString() === simpleForm.categoryId)
        : null;
      const isTransport = selectedCategory && /transport/i.test(selectedCategory.name);
      
      // Build notes with ride provider/service info for transport
      let finalNotes = simpleForm.notes || null;
      if (isTransport && (simpleForm.rideProvider || simpleForm.rideService)) {
        const transportInfo = [
          simpleForm.notes,
          simpleForm.rideProvider && `Provider: ${simpleForm.rideProvider}`,
          simpleForm.rideService && `Service: ${simpleForm.rideService}`
        ].filter(Boolean).join('\n');
        finalNotes = transportInfo || null;
      }
      
      // Add transfer fee info to notes
      if (simpleForm.type === 'transfer') {
        const transferDetails = calculateTransferDetails();
        if (transferDetails && !('error' in transferDetails)) {
          const feeInfo = [
            finalNotes,
            `Transfer Fee: ${formatCurrency(transferDetails.fee)}`,
            transferDetails.senderPays 
              ? `Total deducted from source: ${formatCurrency(transferDetails.fromAmount)}`
              : `Amount received: ${formatCurrency(transferDetails.toAmount)} (fee deducted)`
          ].filter(Boolean).join('\n');
          finalNotes = feeInfo || null;
        }
      }
      
      // Handle transfer with fee - create main transfer first
      let mainTransaction;
      
      if (simpleForm.type === 'transfer') {
        const transferDetails = calculateTransferDetails();
        
        if (transferDetails && !('error' in transferDetails) && transferDetails.fee > 0) {
          // Create main transfer with the actual transfer amount
          mainTransaction = await api.transactions.create({
            kind: 'transfer',
            amountCents: amount,
            description: simpleForm.description,
            notes: finalNotes,
            place: simpleForm.place || null,
            date: dateIso,
            periodId: periodId ?? null,
            tagIds: simpleForm.tagIds.length ? simpleForm.tagIds : undefined,
            categoryId: null,
            walletAccountId,
            toWalletAccountId,
          });
          
          // Create separate fee transaction
          const feeAmount = transferDetails.fee;
          const feeDescription = `Transfer fee: ${simpleForm.description || 'Transfer'}`;
          
          // Fee transaction: Debit expense (Transfer Fee), Credit source wallet
          await api.transactions.create({
            kind: 'expense',
            amountCents: feeAmount,
            description: feeDescription,
            notes: `Admin fee for transfer #${mainTransaction.id}. ${transferDetails.senderPays ? 'Fee paid by sender' : 'Fee deducted from recipient'}`,
            place: simpleForm.place || null,
            date: dateIso,
            periodId: periodId ?? null,
            categoryId: null, // Will use auto expense account
            walletAccountId,
            linkedTxId: mainTransaction.id, // Link to parent transfer transaction
          });
        } else {
          // No fee - create normal transfer
          mainTransaction = await api.transactions.create({
            kind: 'transfer',
            amountCents: amount,
            description: simpleForm.description,
            notes: finalNotes,
            place: simpleForm.place || null,
            date: dateIso,
            periodId: periodId ?? null,
            tagIds: simpleForm.tagIds.length ? simpleForm.tagIds : undefined,
            categoryId: null,
            walletAccountId,
            toWalletAccountId,
          });
        }
      } else {
        // Non-transfer transactions
        mainTransaction = await api.transactions.create({
          kind: simpleForm.type,
          amountCents: amount,
          description: simpleForm.description,
          notes: finalNotes,
          place: simpleForm.place || null,
          date: dateIso,
          periodId: periodId ?? null,
          tagIds: simpleForm.tagIds.length ? simpleForm.tagIds : undefined,
          categoryId:
            simpleForm.type === 'expense' && simpleForm.categoryId
              ? parseInt(simpleForm.categoryId, 10)
              : null,
          walletAccountId,
          toWalletAccountId,
          // Transport location fields (only for transport expenses)
          ...(isTransport && simpleForm.origin ? {
            originLat: simpleForm.origin.lat,
            originLng: simpleForm.origin.lng,
            originName: simpleForm.origin.name,
          } : {}),
          ...(isTransport && simpleForm.destination ? {
            destLat: simpleForm.destination.lat,
            destLng: simpleForm.destination.lng,
            destName: simpleForm.destination.name,
          } : {}),
          ...(isTransport && simpleForm.origin && simpleForm.destination ? {
            distanceKm: calculateDistance(
              simpleForm.origin.lat,
              simpleForm.origin.lng,
              simpleForm.destination.lat,
              simpleForm.destination.lng
            ),
          } : {}),
        });
      }
      
      // Upload pending attachments after transaction is created
      if (pendingAttachments.length > 0) {
        await uploadPendingAttachments(mainTransaction.id, pendingAttachments);
      }
      
      onSaved();
      onClose();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addJournalLine = () => {
    setJournalForm({
      ...journalForm,
      lines: [...journalForm.lines, { accountId: '', debit: '', credit: '', description: '' }],
    });
  };

  const removeJournalLine = (index: number) => {
    if (journalForm.lines.length <= 2) {
      setFormError('Journal entry must have at least 2 lines');
      return;
    }
    setJournalForm({
      ...journalForm,
      lines: journalForm.lines.filter((_, i) => i !== index),
    });
  };

  const updateJournalLine = (index: number, field: string, value: string) => {
    const newLines = [...journalForm.lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setJournalForm({ ...journalForm, lines: newLines });
  };

  const calculateJournalTotals = () => {
    const totalDebit = journalForm.lines.reduce(
      (sum, line) => sum + (parseInt(line.debit, 10) || 0),
      0,
    );
    const totalCredit = journalForm.lines.reduce(
      (sum, line) => sum + (parseInt(line.credit, 10) || 0),
      0,
    );
    return { totalDebit, totalCredit, isBalanced: totalDebit === totalCredit && totalDebit > 0 };
  };

  const handleJournalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const { totalDebit, totalCredit, isBalanced } = calculateJournalTotals();

    if (!isBalanced) {
      setFormError(`Journal not balanced: Debits ${totalDebit} ≠ Credits ${totalCredit}`);
      return;
    }

    const validLines = journalForm.lines.filter(
      (line) =>
        line.accountId && (parseInt(line.debit, 10) > 0 || parseInt(line.credit, 10) > 0),
    );

    if (validLines.length < 2) {
      setFormError('At least 2 accounts must have non-zero amounts');
      return;
    }

    setIsSubmitting(true);
    try {
      const dateIso = new Date(journalForm.dateTime).toISOString();
      await api.transactions.create({
        date: dateIso,
        description: journalForm.description,
        notes: journalForm.notes || null,
        place: journalForm.place || null,
        tagIds: journalForm.tagIds,
        lines: validLines.map((line) => ({
          accountId: parseInt(line.accountId, 10),
          debit: parseInt(line.debit, 10) || 0,
          credit: parseInt(line.credit, 10) || 0,
          description: line.description || undefined,
        })),
      });
      onSaved();
      onClose();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const allAccountsForJournal = accounts.filter((a) => !a.systemKey);

  const showCategoryOnEdit =
    editingTransaction &&
    (editingTransaction.txType?.startsWith('simple_expense') ||
      editingTransaction.categoryId != null);

  const renderWalletCard = (
    a: WalletAccount,
    idx: number,
    selected: boolean,
    onSelect: () => void,
  ) => {
    const Icon = WALLET_ICONS[idx % 3];
    return (
      <button
        key={a.id}
        type="button"
        onClick={onSelect}
        className={cn(
          'flex flex-col items-start p-4 rounded-xl transition-all text-left min-h-[96px]',
          selected
            ? 'bg-[var(--ref-surface-container-lowest)] border-2 border-[var(--ref-primary-container)] shadow-sm'
            : 'bg-[var(--ref-surface-container-low)] border-2 border-transparent hover:border-[var(--ref-surface-container-highest)]',
        )}
      >
        <Icon
          className={cn(
            'w-6 h-6 mb-2',
            selected ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]',
          )}
        />
        <span className="text-xs font-bold text-[var(--color-text-primary)] line-clamp-2">
          {a.name}
        </span>
        <span className="text-[10px] text-[var(--color-muted)]">
          {getAccountTypeLabel(a.type)} · {formatCurrency(a.balance)}
        </span>
      </button>
    );
  };

  if (editingTransaction) {
    // View Mode - Show transaction details read-only
    if (viewMode) {
      const category = editingTransaction.categoryId ? categories.find(c => c.id === editingTransaction.categoryId) : null;
      const amount = editingTransaction.lines?.length ? Math.max(...editingTransaction.lines.map(l => Math.max(l.debit, l.credit))) : 0;
      const isTransfer = editingTransaction.txType?.includes('transfer');
      const isExpense = editingTransaction.txType?.includes('expense');
      const isIncome = editingTransaction.txType?.includes('income');
      
      // Find the wallet account: for expense it's the line with credit, for income it's the line with debit
      const walletAccount = editingTransaction.lines.find(l => {
        if (isExpense) return l.credit > 0;
        if (isIncome) return l.debit > 0;
        return false;
      });
      const account = walletAccount ? accounts.find(a => a.id === walletAccount.accountId) : null;
      
      // For transfer, we need both accounts
      const fromAccount = accounts.find(a => editingTransaction.lines[0]?.accountId === a.id);
      const toAccount = editingTransaction.lines[1]?.accountId ? accounts.find(a => editingTransaction.lines[1].accountId === a.id) : null;
      
      // For transfer, use the enhanced design
      if (isTransfer && fromAccount && toAccount) {
        return (
          <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Transfer Detail"
            subtitle={`ID: #${editingTransaction.id}`}
            size="default"
            className="max-w-2xl shadow-2xl"
          >
            <div className="px-2 pb-6 max-w-2xl mx-auto">
              {/* Status Badge */}
              <div className="mb-6">
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--ref-surface-container-highest)] text-[var(--color-muted)] font-label text-xs font-semibold tracking-wide">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]"></span>
                  LOGGED RECORD
                </span>
              </div>

              {/* Main Value Display */}
              <div className="mb-8 text-center">
                <p className="font-label text-sm text-[var(--color-muted)] mb-2">Total Amount</p>
                <h2 className="font-headline text-5xl font-extrabold text-[var(--color-on-background)] tracking-tighter">
                  <span className="text-2xl font-bold text-[var(--color-primary)] align-top mr-1">Rp</span>
                  {amount.toLocaleString('id-ID')}
                </h2>
              </div>

              {/* Visual Transfer Path */}
              <div className="bg-[var(--ref-surface-container-low)] rounded-xl p-6 mb-6 relative">
                <div className="flex flex-col md:flex-row items-center justify-between gap-6 relative">
                  {/* Source Account */}
                  <div className="flex flex-col items-center md:items-start text-center md:text-left z-10 w-full md:w-1/3">
                    <div className="w-14 h-14 bg-[var(--ref-surface-container-lowest)] rounded-full flex items-center justify-center shadow-sm mb-3">
                      <Landmark className="w-7 h-7 text-[var(--color-primary)]" />
                    </div>
                    <h4 className="font-headline font-semibold text-[var(--color-text-primary)]">{fromAccount.name}</h4>
                    <p className="font-label text-xs text-[var(--color-muted)] uppercase tracking-widest mt-1">From Account</p>
                  </div>

                  {/* Connector */}
                  <div className="hidden md:flex flex-grow items-center justify-center relative px-4">
                    <div className="h-[2px] w-full bg-[var(--color-border)]/30 absolute"></div>
                    <div className="w-10 h-10 bg-[var(--color-primary)] rounded-full flex items-center justify-center z-10 shadow-lg shadow-[var(--color-primary)]/20">
                      <ArrowRight className="w-5 h-5 text-black" />
                    </div>
                  </div>
                  <div className="md:hidden flex items-center justify-center">
                    <div className="w-10 h-10 bg-[var(--color-primary)] rounded-full flex items-center justify-center z-10 shadow-lg shadow-[var(--color-primary)]/20">
                      <ArrowRight className="w-5 h-5 text-black" />
                    </div>
                  </div>

                  {/* Destination Account */}
                  <div className="flex flex-col items-center md:items-end text-center md:text-right z-10 w-full md:w-1/3">
                    <div className="w-14 h-14 bg-[var(--ref-surface-container-lowest)] rounded-full flex items-center justify-center shadow-sm mb-3">
                      <Wallet className="w-7 h-7 text-[var(--color-secondary)]" />
                    </div>
                    <h4 className="font-headline font-semibold text-[var(--color-text-primary)]">{toAccount.name}</h4>
                    <p className="font-label text-xs text-[var(--color-muted)] uppercase tracking-widest mt-1">To Destination</p>
                  </div>
                </div>
              </div>

              {/* Details Bento Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {/* Date */}
                <div className="bg-[var(--ref-surface-container-lowest)] p-5 rounded-xl flex items-center gap-4 group transition-all hover:bg-[var(--ref-surface-container)]">
                  <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-high)] flex items-center justify-center group-hover:bg-white transition-colors">
                    <StickyNote className="w-5 h-5 text-[var(--color-muted)]" />
                  </div>
                  <div>
                    <p className="font-label text-xs text-[var(--color-muted)]">Date Recorded</p>
                    <p className="font-body text-sm font-semibold">{new Date(editingTransaction.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                  </div>
                </div>

                {/* Purpose/Description */}
                <div className="bg-[var(--ref-surface-container-lowest)] p-5 rounded-xl flex items-center gap-4 group transition-all hover:bg-[var(--ref-surface-container)]">
                  <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-high)] flex items-center justify-center group-hover:bg-white transition-colors">
                    <TagIcon className="w-5 h-5 text-[var(--color-muted)]" />
                  </div>
                  <div>
                    <p className="font-label text-xs text-[var(--color-muted)]">Purpose</p>
                    <p className="font-body text-sm font-semibold">{editingTransaction.description}</p>
                  </div>
                </div>

                {/* Category */}
                {category && (
                  <div className="bg-[var(--ref-surface-container-lowest)] p-5 rounded-xl flex items-center gap-4 group transition-all hover:bg-[var(--ref-surface-container)]">
                    <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-high)] flex items-center justify-center group-hover:bg-white transition-colors">
                      <TagIcon className="w-5 h-5 text-[var(--color-muted)]" />
                    </div>
                    <div>
                      <p className="font-label text-xs text-[var(--color-muted)]">Category</p>
                      <div className="flex gap-2 mt-1">
                        <span 
                          className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-tight"
                          style={{ backgroundColor: `${category.color || '#666'}22`, color: category.color || '#666' }}
                        >
                          {category.name}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Note - Full Width */}
              {editingTransaction.notes && (
                <div className="bg-[var(--ref-surface-container-lowest)] p-5 rounded-xl flex items-center gap-4 group transition-all hover:bg-[var(--ref-surface-container)] mb-6">
                  <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-high)] flex items-center justify-center group-hover:bg-white transition-colors">
                    <StickyNote className="w-5 h-5 text-[var(--color-muted)]" />
                  </div>
                  <div className="flex-1">
                    <p className="font-label text-xs text-[var(--color-muted)]">Note</p>
                    <p className="font-body text-sm font-semibold italic">{editingTransaction.notes}</p>
                  </div>
                </div>
              )}

              {/* Action Buttons - Sticky at bottom */}
              <div className="sticky bottom-0 bg-[var(--ref-surface-container-lowest)] pt-4 pb-2 border-t border-[var(--color-border)] mt-auto">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                  <Button 
                    type="button" 
                    variant="secondary"
                    onClick={onClose}
                    className="w-full md:w-auto px-6 py-2.5 rounded-full font-headline font-semibold text-sm"
                  >
                    Close
                  </Button>
                  <div className="flex gap-3 w-full md:w-auto">
                    <Button 
                      type="button" 
                      variant="secondary"
                      onClick={() => setViewMode(false)} 
                      className="flex-1 md:flex-none px-6 py-2.5 rounded-full font-headline font-semibold text-sm"
                    >
                      Edit Record
                    </Button>
                    <Button 
                      type="button" 
                      onClick={onClose}
                      className="flex-1 md:flex-none px-8 py-2.5 rounded-full font-headline font-semibold text-sm shadow-lg shadow-[var(--color-primary)]/20"
                    >
                      Got it
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Modal>
        );
      }
      
      // Expense/Income view mode - enhanced design
      return (
        <Modal
          isOpen={isOpen}
          onClose={onClose}
          title={isExpense ? "Expense Detail" : "Income Detail"}
          subtitle={`ID: #${editingTransaction.id}`}
          size="default"
          className="max-w-4xl"
          footer={
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 w-full">
              <Button 
                type="button" 
                variant="secondary"
                onClick={onClose}
                className="w-full md:w-auto px-6 py-2.5 rounded-full font-headline font-semibold text-sm"
              >
                Close
              </Button>
              <div className="flex gap-3 w-full md:w-auto">
                <Button 
                  type="button" 
                  variant="secondary"
                  onClick={() => setViewMode(false)} 
                  className="flex-1 md:flex-none px-6 py-2.5 rounded-full font-headline font-semibold text-sm"
                >
                  Edit Record
                </Button>
                <Button 
                  type="button" 
                  onClick={onClose}
                  className="flex-1 md:flex-none px-8 py-2.5 rounded-full font-headline font-semibold text-sm shadow-lg shadow-[var(--color-primary)]/20"
                >
                  Got it
                </Button>
              </div>
            </div>
          }
        >
          <div className="flex flex-col md:flex-row gap-8 p-4">
            {/* Left Column - Main Content */}
            <div className="flex-1 px-2">
              {/* Header with merchant icon and status */}
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[var(--ref-surface-container)] flex items-center justify-center">
                    {category?.icon ? (
                      <span className="text-lg">{category.icon}</span>
                    ) : (
                      <ShoppingCart className="w-5 h-5 text-[var(--color-primary)]" />
                    )}
                  </div>
                  <div>
                    <h1 className="font-headline font-bold text-base tracking-tight text-[var(--color-on-background)]">
                      {editingTransaction.description}
                    </h1>
                    <p className="text-[var(--color-muted)] font-label text-xs mt-0.5 uppercase tracking-widest">
                      {new Date(editingTransaction.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })} • {new Date(editingTransaction.date).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-[var(--color-secondary-container)]/30 text-[var(--color-on-secondary-container)] px-3 py-1.5 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-[var(--color-success)]"></span>
                  <span className="font-label text-xs font-semibold">LOGGED</span>
                </div>
              </div>

              {/* Amount Hero */}
              <div className="mb-10">
                <p className="font-label text-[var(--color-muted)] text-sm mb-2">Total Amount</p>
                <div className="flex items-baseline gap-2">
                  <span className="font-headline font-bold text-3xl text-[var(--color-primary)]">Rp</span>
                  <span className="font-headline font-extrabold text-6xl tracking-tighter text-[var(--color-on-background)]">
                    {amount.toLocaleString('id-ID')}
                  </span>
                </div>
              </div>

              {/* Bento Grid Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-[var(--color-border)]/30 pt-6 mb-6">
                {/* Category */}
                <div className="space-y-0.5">
                  <p className="font-label text-[10px] text-[var(--color-muted)] uppercase tracking-wider">Category</p>
                  <div className="flex items-center gap-2">
                    <div className="p-1 bg-[var(--color-tertiary-container)]/10 text-[var(--color-tertiary)] rounded-md">
                      <TagIcon className="w-3.5 h-3.5" />
                    </div>
                    {category ? (
                      <p className="font-headline font-semibold text-base">{category.name}</p>
                    ) : (
                      <span className="text-[var(--color-muted)] text-sm">—</span>
                    )}
                  </div>
                </div>

                {/* Account */}
                <div className="space-y-0.5">
                  <p className="font-label text-[10px] text-[var(--color-muted)] uppercase tracking-wider">Account</p>
                  <div className="flex items-center gap-2">
                    <div className="p-1 bg-[var(--color-primary-container)]/10 text-[var(--color-primary)] rounded-md">
                      <Landmark className="w-3.5 h-3.5" />
                    </div>
                    {account ? (
                      <p className="font-headline font-semibold text-base">{account.name}</p>
                    ) : (
                      <span className="text-[var(--color-muted)] text-sm">—</span>
                    )}
                  </div>
                </div>

                {/* Tags */}
                <div className="space-y-0.5">
                  <p className="font-label text-[10px] text-[var(--color-muted)] uppercase tracking-wider">Tags</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {editingTransaction.tags.length > 0 ? (
                      editingTransaction.tags.map(tag => (
                        <span 
                          key={tag.tagId}
                          className="px-2 py-0.5 rounded-full text-xs font-medium border border-[var(--color-border)] text-[var(--color-text-secondary)] bg-[var(--ref-surface-container)]"
                        >
                          {tag.name}
                        </span>
                      ))
                    ) : (
                      <span className="text-[var(--color-muted)] text-sm">—</span>
                    )}
                  </div>
                </div>

                {/* Location */}
                <div className="space-y-0.5">
                  <p className="font-label text-[10px] text-[var(--color-muted)] uppercase tracking-wider">Location</p>
                  <div className="flex items-center gap-2">
                    <div className="p-1 bg-[var(--ref-surface-container-high)] text-[var(--color-muted)] rounded-md">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    {editingTransaction.place ? (
                      <p className="font-headline font-semibold text-base">{editingTransaction.place}</p>
                    ) : (
                      <span className="text-[var(--color-muted)] text-sm">—</span>
                    )}
                  </div>
                </div>

                {/* Notes */}
                <div className="space-y-0.5">
                  <p className="font-label text-[10px] text-[var(--color-muted)] uppercase tracking-wider">Note</p>
                  <div className="flex items-center gap-2">
                    <div className="p-1 bg-[var(--ref-surface-container-high)] text-[var(--color-muted)] rounded-md">
                      <StickyNote className="w-3.5 h-3.5" />
                    </div>
                    {editingTransaction.notes ? (
                      <p className="font-headline font-semibold text-base italic">{editingTransaction.notes}</p>
                    ) : (
                      <span className="text-[var(--color-muted)] text-sm">—</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column - Sidebar (Attachments) */}
            <div className="w-full md:w-72 bg-[var(--ref-surface-container-low)] p-6 rounded-2xl border border-[var(--color-border)]/10">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-headline font-bold text-[var(--color-on-background)]">Attachments</h3>
                <span className="text-[var(--color-muted)] font-label text-xs">{attachments.length} files</span>
              </div>
              
              {attachments.length > 0 ? (
                <div className="space-y-3">
                  {attachments.map(att => (
                    <div 
                      key={att.id} 
                      className="bg-[var(--ref-surface-container-lowest)] p-3 rounded-xl group relative overflow-hidden"
                    >
                      {/* Preview or Icon */}
                      <div 
                        className="w-full h-24 rounded-lg bg-[var(--ref-surface-container-high)] flex items-center justify-center mb-3 cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={async () => {
                          try {
                            if (att.mimetype.startsWith('image/') && attachmentUrls[att.id]) {
                              // Use cached URL for images
                              setPreviewAttachment({
                                id: att.id,
                                url: attachmentUrls[att.id],
                                filename: att.filename,
                                mimetype: att.mimetype,
                              });
                            } else {
                              // Fetch URL for non-images or if not cached
                              const { url } = await api.attachments.getUrl(att.id, 3600);
                              if (att.mimetype.startsWith('image/')) {
                                setPreviewAttachment({
                                  id: att.id,
                                  url,
                                  filename: att.filename,
                                  mimetype: att.mimetype,
                                });
                              } else {
                                window.open(url, '_blank');
                              }
                            }
                          } catch (err) {
                            alert('Failed to load attachment');
                          }
                        }}
                      >
                        {att.mimetype.startsWith('image/') ? (
                          attachmentUrls[att.id] ? (
                            <img
                              src={attachmentUrls[att.id]}
                              alt={att.filename}
                              className="w-full h-full object-cover rounded-lg"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[var(--color-muted)]">
                              <div className="animate-pulse flex items-center">
                                <ImagePlus className="w-8 h-8 opacity-50" />
                                <span className="ml-2 text-xs">Loading...</span>
                              </div>
                            </div>
                          )
                        ) : (
                          <div className="text-center">
                            <svg className="w-8 h-8 mx-auto text-[var(--color-muted)] mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="text-xs text-[var(--color-muted)]">Click to open</span>
                          </div>
                        )}
                      </div>
                      
                      {/* File Info */}
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{att.filename}</p>
                          <p className="text-xs text-[var(--color-muted)]">{formatFileSize(att.fileSize)}</p>
                        </div>
                        
                        {/* Delete Button */}
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (confirm('Delete this attachment?')) {
                              try {
                                await api.attachments.delete(att.id);
                                setAttachments(attachments.filter(a => a.id !== att.id));
                                setAttachmentUrls(prev => {
                                  const updated = { ...prev };
                                  delete updated[att.id];
                                  return updated;
                                });
                              } catch (err) {
                                alert('Failed to delete attachment');
                              }
                            }
                          }}
                          className="p-2 text-[var(--color-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <ImagePlus className="w-12 h-12 text-[var(--color-muted)] mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-[var(--color-muted)]">No attachments</p>
                  <p className="text-xs text-[var(--color-muted)] mt-1">Receipts and documents will appear here</p>
                </div>
              )}
            </div>
          </div>
        </Modal>
      );
    }

    // Edit Mode
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Edit transaction"
        subtitle="Update description, date, notes, tags, and category."
        size="xl"
      >
        <p className="text-sm text-[var(--color-text-secondary)] mb-8 lg:mb-10">
          Amounts and accounts can't be changed here — delete this entry and add a new one to adjust
          those.
        </p>
        <form onSubmit={handleEditMetaSubmit} className="space-y-8 lg:space-y-10 max-w-3xl">
          <Input
            label="Date"
            type="date"
            value={editMeta.date}
            onChange={(e) => setEditMeta({ ...editMeta, date: e.target.value })}
            className="rounded-xl border-none bg-[var(--ref-surface-container-low)] px-4 py-4"
            required
          />
          <Input
            label="Transaction name"
            value={editMeta.description}
            onChange={(e) => setEditMeta({ ...editMeta, description: e.target.value })}
            className="rounded-xl border-none bg-[var(--ref-surface-container-low)] px-4 py-4"
            required
          />
          {showCategoryOnEdit && (
            <Select
              label="Category"
              value={editMeta.categoryId}
              onChange={(e) => setEditMeta({ ...editMeta, categoryId: e.target.value })}
              className={stitchSelect}
              options={[
                { value: '', label: 'None' },
                ...categories.map((c) => ({ value: c.id.toString(), label: c.name })),
              ]}
            />
          )}
          <Input
            label="Place (optional)"
            value={editMeta.place}
            onChange={(e) => setEditMeta({ ...editMeta, place: e.target.value })}
            placeholder="e.g. Starbucks, Indomaret, Online"
            className="rounded-xl border-none bg-[var(--ref-surface-container-low)] px-4 py-4"
          />
          <div>
            <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">
              Tags
            </label>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => {
                    const next = editMeta.tagIds.includes(tag.id)
                      ? editMeta.tagIds.filter((id) => id !== tag.id)
                      : [...editMeta.tagIds, tag.id];
                    setEditMeta({ ...editMeta, tagIds: next });
                  }}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-full border-2 transition-colors',
                    editMeta.tagIds.includes(tag.id)
                      ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/40 bg-[var(--ref-surface-container)]',
                  )}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)] mb-2">
              <StickyNote className="w-4 h-4" />
              Memo
            </label>
            <textarea
              className="w-full min-h-[100px] rounded-xl border-none bg-[var(--ref-surface-container-lowest)] px-4 py-3 text-sm text-[var(--color-text-primary)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
              placeholder="Write a note..."
              value={editMeta.notes}
              onChange={(e) => setEditMeta({ ...editMeta, notes: e.target.value })}
            />
          </div>
          {formError && <p className="text-sm text-[var(--color-danger)]">{formError}</p>}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button type="submit" isLoading={isSubmitting} className="flex-1 rounded-full py-4">
              <Save className="w-5 h-5" />
              Save changes
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} className="rounded-full py-4">
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add transaction"
      subtitle="Create a detailed record for your books."
      size="xl"
      headerExtra={
        !isAccountingMode ? (
          <button
            type="button"
            onClick={() => setIsAccountingMode(true)}
            className="group inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] transition-colors hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)]"
            title="Switch to journal entry (multi-line debits & credits)"
          >
            <Calculator className="h-3.5 w-3.5 opacity-70 transition-opacity group-hover:opacity-100" />
            Journal
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setIsAccountingMode(false)}
            className="group inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] transition-colors hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)]"
            title="Back to simple transaction"
          >
            <ArrowRightLeft className="h-3.5 w-3.5 opacity-70 transition-opacity group-hover:opacity-100" />
            Simple
          </button>
        )
      }
    >
      {isAccountingMode ? (
        <form onSubmit={handleJournalSubmit} className="flex flex-col gap-0">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
          <div className="lg:col-span-8 space-y-6 lg:space-y-8">
            <div>
              <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                Date &amp; time
              </label>
              <input
                type="datetime-local"
                value={journalForm.dateTime}
                onChange={(e) => setJournalForm({ ...journalForm, dateTime: e.target.value })}
                className={cn('brutalist-input w-full', stitchSelect)}
                required
              />
            </div>

            <Input
              label="Description"
              value={journalForm.description}
              onChange={(e) => setJournalForm({ ...journalForm, description: e.target.value })}
              placeholder="e.g., Monthly salary payment"
              className="rounded-xl border-none bg-[var(--ref-surface-container-low)] px-3 py-3"
              required
            />

            <div className="space-y-2">
              <label className="text-sm font-semibold text-[var(--color-text-primary)]">
                Journal lines (debits = credits)
              </label>
              {journalForm.lines.map((line, index) => (
                <div key={index} className="flex gap-2 items-start flex-wrap">
                  <Select
                    value={line.accountId}
                    onChange={(e) => updateJournalLine(index, 'accountId', e.target.value)}
                    options={[
                      { value: '', label: 'Account...' },
                      ...allAccountsForJournal.map((a) => ({
                        value: a.id.toString(),
                        label: a.name,
                      })),
                    ]}
                    className={cn('flex-1 min-w-[140px]', stitchSelect)}
                  />
                  <Input
                    type="number"
                    placeholder="Debit"
                    value={line.debit}
                    onChange={(e) => updateJournalLine(index, 'debit', e.target.value)}
                    className="w-24 rounded-xl"
                  />
                  <Input
                    type="number"
                    placeholder="Credit"
                    value={line.credit}
                    onChange={(e) => updateJournalLine(index, 'credit', e.target.value)}
                    className="w-24 rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={() => removeJournalLine(index)}
                    className="p-2 rounded-lg hover:bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <Button type="button" variant="secondary" onClick={addJournalLine} size="sm" className="rounded-full">
                <Plus className="w-4 h-4 mr-1" />
                Add line
              </Button>
            </div>

            {(() => {
              const { totalDebit, totalCredit, isBalanced } = calculateJournalTotals();
              return (
                <div
                  className={cn(
                    'p-4 rounded-xl font-mono text-sm border-2',
                    isBalanced
                      ? 'border-[var(--color-success)] bg-[var(--ref-secondary-container)]/30'
                      : 'border-[var(--color-warning)] bg-amber-50/80',
                  )}
                >
                  Debits: {formatCurrency(totalDebit)} | Credits: {formatCurrency(totalCredit)}
                  {!isBalanced && (
                    <span className="ml-2 text-[var(--color-danger)]">Not balanced</span>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="lg:col-span-4 space-y-6">
            <div className="bg-[var(--ref-surface-container-low)] rounded-xl p-5 space-y-5">
              <h3 className="text-base font-bold text-[var(--color-text-primary)] font-headline">
                Details
              </h3>
              <Input
                label="Place (optional)"
                value={journalForm.place}
                onChange={(e) => setJournalForm({ ...journalForm, place: e.target.value })}
                placeholder="e.g. Office, Client Site, Online"
                className="rounded-xl border-none bg-[var(--ref-surface-container-lowest)] px-3 py-2.5 text-sm"
              />
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                  <StickyNote className="w-4 h-4" />
                  Memo
                </label>
                <textarea
                  className="w-full min-h-[80px] rounded-xl border-none bg-[var(--ref-surface-container-lowest)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
                  placeholder="Write a note..."
                  value={journalForm.notes}
                  onChange={(e) => setJournalForm({ ...journalForm, notes: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--color-text-primary)] mb-2 block">
                  Tags
                </label>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => {
                        const next = journalForm.tagIds.includes(tag.id)
                          ? journalForm.tagIds.filter((id) => id !== tag.id)
                          : [...journalForm.tagIds, tag.id];
                        setJournalForm({ ...journalForm, tagIds: next });
                      }}
                      className={cn(
                        'px-3 py-1.5 text-xs rounded-full border-2 transition-colors',
                        journalForm.tagIds.includes(tag.id)
                          ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                          : 'border-[var(--color-border)] text-[var(--color-text-secondary)] bg-[var(--ref-surface-container)]',
                      )}
                    >
                      <TagIcon className="w-3 h-3 inline mr-1" />
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          </div>

          <div className={stickyFooter}>
            {formError && <p className="text-sm text-[var(--color-danger)]">{formError}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
              <Button type="button" variant="secondary" onClick={onClose} className="rounded-full py-3 sm:min-w-[120px]">
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={isSubmitting}
                className="rounded-full py-3 shadow-lg sm:min-w-[200px]"
              >
                <Save className="w-5 h-5" />
                Record journal
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <form onSubmit={handleSimpleSubmit} className="flex flex-col gap-0">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
          <div className="lg:col-span-8 space-y-6 lg:space-y-8">
            <div className="inline-flex p-0.5 bg-[var(--ref-surface-container)] rounded-full flex-wrap gap-0.5">
              {(
                [
                  { value: 'expense' as const, label: 'Expense', icon: ArrowUpRight },
                  { value: 'income' as const, label: 'Income', icon: ArrowDownRight },
                  { value: 'transfer' as const, label: 'Transfer', icon: ArrowRightLeft },
                  { value: 'paylater' as const, label: 'Settlement', icon: CreditCard },
                ] as const
              ).map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() =>
                    setSimpleForm({
                      ...simpleForm,
                      type: t.value,
                      paylaterRecognitionId:
                        t.value === 'paylater' ? simpleForm.paylaterRecognitionId : '',
                    })
                  }
                  className={cn(
                    'inline-flex items-center gap-1.5 px-4 sm:px-5 py-2 rounded-full text-sm transition-all',
                    simpleForm.type === t.value
                      ? 'bg-[var(--ref-surface-container-lowest)] text-[var(--color-accent)] font-bold shadow-sm'
                      : 'text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-accent)]',
                  )}
                >
                  {'icon' in t && t.icon ? <t.icon className="w-3.5 h-3.5 opacity-80" /> : null}
                  {t.label}
                </button>
              ))}
            </div>

            <CurrencyInput
              label={simpleForm.type === 'paylater' ? 'Payment' : 'Amount'}
              value={simpleForm.amount}
              onChange={(value) => setSimpleForm({ ...simpleForm, amount: value })}
              size="lg"
              required
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
              <div className="md:col-span-2 space-y-2">
                <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                  Transaction name
                </label>
                <input
                  type="text"
                  value={simpleForm.description}
                  onChange={(e) => setSimpleForm({ ...simpleForm, description: e.target.value })}
                  placeholder="e.g. Weekly grocery at Alfamart"
                  className="w-full bg-[var(--ref-surface-container-low)] border-none rounded-xl px-3 py-3 focus:ring-2 focus:ring-[var(--color-accent)]/20 text-[var(--color-text-primary)] transition-all"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                  Date &amp; time
                </label>
                <input
                  type="datetime-local"
                  value={simpleForm.dateTime}
                  onChange={(e) => setSimpleForm({ ...simpleForm, dateTime: e.target.value })}
                  className={cn('w-full brutalist-input', stitchSelect)}
                  required
                />
              </div>
              {(simpleForm.type === 'expense' && isPaylaterAccount(simpleForm.fromAccountId)) && (
                <>
                  {/* Installment Term */}
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                      Installment term
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { value: '1', label: '1 month' },
                        { value: '3', label: '3 months' },
                        { value: '6', label: '6 months' },
                        { value: '12', label: '12 months' },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setSimpleForm({ ...simpleForm, paylaterInstallmentMonths: option.value as '1' | '3' | '6' | '12' });
                            // Recalculate preview if we have the data
                            if (simpleForm.amount && simpleForm.paylaterFirstDueDate) {
                              calculateInstallmentPreview({
                                ...simpleForm,
                                paylaterInstallmentMonths: option.value as '1' | '3' | '6' | '12',
                              });
                            }
                          }}
                          className={cn(
                            'py-2 rounded-lg text-sm font-medium transition-all border-2 text-center w-full',
                            simpleForm.paylaterInstallmentMonths === option.value
                              ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                              : 'bg-[var(--ref-surface-container-low)] border-transparent hover:border-[var(--color-accent)]/30'
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Interest Rate */}
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                      Annual interest rate % (optional)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={simpleForm.paylaterInterestRate}
                      onChange={(e) => setSimpleForm({ ...simpleForm, paylaterInterestRate: e.target.value })}
                      placeholder="e.g., 12 for 12%"
                      className={cn('w-full brutalist-input', stitchSelect)}
                    />
                  </div>

                  {/* Admin Fee */}
                  <CurrencyInput
                    label="Admin fee (optional)"
                    value={simpleForm.paylaterAdminFee}
                    onChange={(value) => setSimpleForm({ ...simpleForm, paylaterAdminFee: value })}
                    size="sm"
                    showDivider={false}
                  />

                  {/* First Due Date */}
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                      First installment due date
                    </label>
                    <input
                      type="date"
                      value={simpleForm.paylaterFirstDueDate}
                      onChange={(e) => setSimpleForm({ ...simpleForm, paylaterFirstDueDate: e.target.value })}
                      className={cn('w-full brutalist-input', stitchSelect)}
                      required
                    />
                  </div>

                  {/* Installment Preview */}
                  {installmentPreview && installmentPreview.length > 0 && (
                    <div className="mt-4 p-4 bg-[var(--ref-surface-container-low)] rounded-xl">
                      <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">
                        Installment Schedule
                      </h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {installmentPreview.map((inst) => (
                          <div key={inst.installmentNumber} className="flex justify-between items-center text-sm">
                            <span className="text-[var(--color-text-secondary)]">
                              #{inst.installmentNumber} - {new Date(inst.dueDate).toLocaleDateString()}
                            </span>
                            <span className="font-medium text-[var(--color-text-primary)]">
                              {formatCurrency(inst.totalCents)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex justify-between items-center">
                        <span className="text-sm font-semibold text-[var(--color-text-primary)]">Total</span>
                        <span className="font-bold text-[var(--color-accent)]">
                          {formatCurrency(installmentPreview.reduce((sum, i) => sum + i.totalCents, 0))}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
              {simpleForm.type === 'expense' && (
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                    Category
                  </label>
                  <div className="relative">
                    <select
                      value={simpleForm.categoryId}
                      onChange={(e) => setSimpleForm({ ...simpleForm, categoryId: e.target.value })}
                      className={cn('w-full appearance-none', stitchSelect)}
                      required
                    >
                      <option value="">Select category…</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-muted)] text-lg">
                      ▾
                    </span>
                  </div>
                </div>
              )}
              {/* Transport Location Picker */}
              {simpleForm.type === 'expense' && simpleForm.categoryId && (() => {
                const selectedCategory = categories.find(c => c.id.toString() === simpleForm.categoryId);
                const isTransport = selectedCategory && /transport/i.test(selectedCategory.name);
                return isTransport ? (
                  <>
                    <div className="md:col-span-2">
                      <TransportRoute
                        origin={simpleForm.origin}
                        destination={simpleForm.destination}
                        onEditOrigin={() => {
                          setMapPickerMode('origin');
                          setMapPickerOpen(true);
                        }}
                        onEditDestination={() => {
                          setMapPickerMode('destination');
                          setMapPickerOpen(true);
                        }}
                      />
                    </div>
                    {/* Ride Provider */}
                    <div className="space-y-2">
                      <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                        Ride Provider
                      </label>
                      <div className="relative">
                        <select
                          value={simpleForm.rideProvider}
                          onChange={(e) => setSimpleForm({ 
                            ...simpleForm, 
                            rideProvider: e.target.value as 'gojek' | 'grab' | 'others',
                            rideService: '' // Reset service when provider changes
                          })}
                          className={cn('w-full appearance-none', stitchSelect)}
                        >
                          <option value="">Select provider…</option>
                          <option value="gojek">GoJek</option>
                          <option value="grab">Grab</option>
                          <option value="others">Others</option>
                        </select>
                        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-muted)] text-lg">
                          ▾
                        </span>
                      </div>
                    </div>
                    {/* Ride Service */}
                    {simpleForm.rideProvider && (
                      <div className="space-y-2">
                        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                          Service Type
                        </label>
                        <div className="relative">
                          <select
                            value={simpleForm.rideService}
                            onChange={(e) => setSimpleForm({ ...simpleForm, rideService: e.target.value })}
                            className={cn('w-full appearance-none', stitchSelect)}
                          >
                            <option value="">Select service…</option>
                            {simpleForm.rideProvider === 'gojek' && (
                              <>
                                <option value="GoRide">GoRide</option>
                                <option value="GoRide Hemat">GoRide Hemat</option>
                                <option value="GoRide Comfort">GoRide Comfort</option>
                                <option value="GoCar">GoCar</option>
                                <option value="GoCar Prioritas">GoCar Prioritas</option>
                                <option value="GoCar Hemat">GoCar Hemat</option>
                                <option value="GoCar XL">GoCar XL</option>
                              </>
                            )}
                            {simpleForm.rideProvider === 'grab' && (
                              <>
                                <option value="Bike Standard">Bike Standard</option>
                                <option value="Bike Comfort">Bike Comfort</option>
                                <option value="Car Standard">Car Standard</option>
                                <option value="Car Plus (4 seat)">Car Plus (4 seat)</option>
                                <option value="Car Plus (6 seat)">Car Plus (6 seat)</option>
                                <option value="Car Premium">Car Premium</option>
                                <option value="Car Priority">Car Priority</option>
                              </>
                            )}
                            {simpleForm.rideProvider === 'others' && (
                              <>
                                <option value="Blue Bird">Blue Bird</option>
                                <option value="Silver Bird">Silver Bird</option>
                                <option value="Maxim">Maxim</option>
                                <option value="InDriver">InDriver</option>
                                <option value="Other">Other</option>
                              </>
                            )}
                          </select>
                          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-muted)] text-lg">
                            ▾
                          </span>
                        </div>
                      </div>
                    )}
                  </>
                ) : null;
              })()}
              {simpleForm.type === 'paylater' && (
                <div className="md:col-span-2 space-y-2">
                  <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                    Pay toward obligation
                  </label>
                  <div className="relative">
                    <select
                      value={simpleForm.paylaterRecognitionId}
                      onChange={(e) =>
                        setSimpleForm({ ...simpleForm, paylaterRecognitionId: e.target.value })
                      }
                      className={cn('w-full appearance-none', stitchSelect)}
                      required
                    >
                      <option value="">Select installment / obligation…</option>
                      {(paylaterObligationsState?.obligations ?? [])
                        .filter((o) => o.outstandingCents > 0)
                        .map((o) => (
                          <option key={o.recognitionTxId} value={o.recognitionTxId}>
                            #{o.recognitionTxId} · {o.description} · {o.liabilityAccountName} · remaining{' '}
                            {formatCurrency(o.outstandingCents)}
                          </option>
                        ))}
                    </select>
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-muted)] text-lg">
                      ▾
                    </span>
                  </div>
                  {paylaterObligationsState && paylaterObligationsState.obligations.filter((o) => o.outstandingCents > 0).length === 0 && (
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      No open obligations yet. Use{' '}
                      <strong>Add transaction</strong> → <strong>Buy later</strong> to record an
                      installment purchase first.
                    </p>
                  )}
                </div>
              )}
            </div>

            {simpleForm.type === 'income' ? (
              <div className="space-y-4">
                <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                  Destination account
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {walletAccounts.filter(a => !isPaylaterAccount(a.id.toString())).map((a, idx) =>
                    renderWalletCard(a, idx, simpleForm.toAccountId === a.id.toString(), () =>
                      setSimpleForm({ ...simpleForm, toAccountId: a.id.toString() }),
                    ),
                  )}
                  <Link
                    to="/accounts"
                    className="flex flex-col items-center justify-center p-4 min-h-[96px] bg-[var(--ref-surface-container-low)] border-2 border-dashed border-[var(--color-border-strong)]/60 rounded-xl hover:bg-[var(--ref-surface-container-highest)] transition-colors"
                    title="Manage accounts"
                  >
                    <Plus className="w-7 h-7 text-[var(--color-muted)]" />
                  </Link>
                </div>
              </div>
            ) : simpleForm.type === 'expense' ? (
              <div className="space-y-4">
                <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                  Source account
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {walletAccounts.map((a, idx) =>
                    renderWalletCard(a, idx, simpleForm.fromAccountId === a.id.toString(), () =>
                      setSimpleForm({ ...simpleForm, fromAccountId: a.id.toString() }),
                    ),
                  )}
                  <Link
                    to="/accounts"
                    className="flex flex-col items-center justify-center p-4 min-h-[96px] bg-[var(--ref-surface-container-low)] border-2 border-dashed border-[var(--color-border-strong)]/60 rounded-xl hover:bg-[var(--ref-surface-container-highest)] transition-colors"
                    title="Manage accounts"
                  >
                    <Plus className="w-7 h-7 text-[var(--color-muted)]" />
                  </Link>
                </div>
                {isPaylaterAccount(simpleForm.fromAccountId) && (
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)]/50 px-4 py-3 text-sm text-[var(--color-text-secondary)]">
                    <strong className="text-[var(--color-text-primary)]">PayLater detected:</strong> This purchase will be paid in installments. Configure options below.
                  </div>
                )}
              </div>
            ) : simpleForm.type === 'paylater' ? (
              <div className="space-y-4">
                <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                  Pay from (wallet)
                </label>
                <p className="text-xs text-[var(--color-text-secondary)] -mt-2">
                  Reduces the paylater liability and credits your wallet—same as a settlement on the
                  PayLater page.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {walletAccounts.filter(a => !isPaylaterAccount(a.id.toString())).map((a, idx) =>
                    renderWalletCard(a, idx, simpleForm.fromAccountId === a.id.toString(), () =>
                      setSimpleForm({ ...simpleForm, fromAccountId: a.id.toString() }),
                    ),
                  )}
                  <Link
                    to="/accounts"
                    className="flex flex-col items-center justify-center p-4 min-h-[96px] bg-[var(--ref-surface-container-low)] border-2 border-dashed border-[var(--color-border-strong)]/60 rounded-xl hover:bg-[var(--ref-surface-container-highest)] transition-colors"
                    title="Manage accounts"
                  >
                    <Plus className="w-7 h-7 text-[var(--color-muted)]" />
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                    From account
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {walletAccounts.filter(a => !isPaylaterAccount(a.id.toString())).map((a, idx) =>
                      renderWalletCard(a, idx, simpleForm.fromAccountId === a.id.toString(), () =>
                        setSimpleForm({ ...simpleForm, fromAccountId: a.id.toString() }),
                      ),
                    )}
                  </div>
                </div>
                <div className="space-y-4">
                  <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                    To account
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {walletAccounts.filter(a => !isPaylaterAccount(a.id.toString())).map((a, idx) =>
                      renderWalletCard(a, idx, simpleForm.toAccountId === a.id.toString(), () =>
                        setSimpleForm({ ...simpleForm, toAccountId: a.id.toString() }),
                      ),
                    )}
                    <Link
                      to="/accounts"
                      className="flex flex-col items-center justify-center p-4 min-h-[96px] bg-[var(--ref-surface-container-low)] border-2 border-dashed border-[var(--color-border-strong)]/60 rounded-xl hover:bg-[var(--ref-surface-container-highest)] transition-colors"
                      title="Manage accounts"
                    >
                      <Plus className="w-7 h-7 text-[var(--color-muted)]" />
                    </Link>
                  </div>
                </div>

                {/* Transfer Fee Calculation */}
                {(() => {
                  const details = calculateTransferDetails();
                  if (!details) return null;
                  if ('error' in details) {
                    return (
                      <div className="p-4 rounded-xl bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 text-[var(--color-danger)] text-sm">
                        {details.error}
                      </div>
                    );
                  }
                  return (
                    <div className="p-4 rounded-xl bg-[var(--ref-surface-container-low)] border border-[var(--color-border)]">
                      <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                        Transfer Summary
                      </h4>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-[var(--color-text-secondary)]">Amount:</span>
                          <span>{formatCurrency(parseIdNominalToInt(simpleForm.amount))}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--color-text-secondary)]">Admin Fee:</span>
                          <span>{formatCurrency(details.fee)}</span>
                        </div>
                        <div className="h-px bg-[var(--color-border)] my-2" />
                        <div className="flex justify-between font-medium">
                          <span className="text-[var(--color-text-secondary)]">From Account:</span>
                          <span className="text-[var(--color-danger)]">-{formatCurrency(details.fromAmount)}</span>
                        </div>
                        <div className="flex justify-between font-medium">
                          <span className="text-[var(--color-text-secondary)]">To Account:</span>
                          <span className="text-[var(--color-success)]">+{formatCurrency(details.toAmount)}</span>
                        </div>
                        {details.senderPays ? (
                          <p className="text-xs text-[var(--color-text-secondary)] mt-2">
                            *Fee paid by sender (added to source deduction)
                          </p>
                        ) : (
                          <p className="text-xs text-[var(--color-text-secondary)] mt-2">
                            *Fee deducted from recipient amount
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>

          <div className="lg:col-span-4 space-y-6">
            <div className="bg-[var(--ref-surface-container-low)] rounded-xl p-5 space-y-6">
              <h3 className="text-base font-bold text-[var(--color-text-primary)] font-headline">
                Advanced options
              </h3>

              <div className="space-y-3 opacity-60">
                <div className="flex justify-between items-center gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <Users className="w-5 h-5 text-[var(--ref-tertiary)] shrink-0" />
                    <span className="font-semibold text-[var(--color-text-primary)]">Split bill</span>
                  </div>
                  <button
                    type="button"
                    disabled
                    title="Coming soon"
                    className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed items-center rounded-full bg-[var(--ref-surface-container-highest)]"
                  >
                    <span className="inline-block h-5 w-5 translate-x-1 rounded-full bg-white shadow" />
                  </button>
                </div>
              </div>

              <div className="h-px bg-[var(--color-border)]/40" />

              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                  <StickyNote className="w-4 h-4" />
                  Memo
                </label>
                <textarea
                  className="w-full min-h-[72px] rounded-xl border-none bg-[var(--ref-surface-container-lowest)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
                  placeholder="Write a note..."
                  value={simpleForm.notes}
                  onChange={(e) => setSimpleForm({ ...simpleForm, notes: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                  Place (optional)
                </label>
                <input
                  type="text"
                  value={simpleForm.place}
                  onChange={(e) => setSimpleForm({ ...simpleForm, place: e.target.value })}
                  placeholder="e.g. Starbucks, Indomaret, Online"
                  className="w-full bg-[var(--ref-surface-container-lowest)] border-none rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--color-accent)]/20"
                />
              </div>

              {simpleForm.type !== 'paylater' ? (
                <div>
                  <label className="text-sm font-semibold text-[var(--color-text-primary)] mb-2 block">
                    Tags
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => {
                          const newTagIds = simpleForm.tagIds.includes(tag.id)
                            ? simpleForm.tagIds.filter((id) => id !== tag.id)
                            : [...simpleForm.tagIds, tag.id];
                          setSimpleForm({ ...simpleForm, tagIds: newTagIds });
                        }}
                        className={cn(
                          'px-3 py-1.5 text-xs rounded-full border-2 transition-colors',
                          simpleForm.tagIds.includes(tag.id)
                            ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                            : 'border-[var(--color-border)] text-[var(--color-text-secondary)] bg-[var(--ref-surface-container)] hover:border-[var(--color-accent)]/30',
                        )}
                      >
                        <TagIcon className="w-3 h-3 inline mr-1" />
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Tags aren&apos;t attached to paylater entries from this form (notes and reference are
                  stored on the journal).
                </p>
              )}

              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                  <ImagePlus className="w-4 h-4" />
                  Attachments
                </label>
                <AttachmentUploader
                  transactionId={editingTransaction ? (editingTransaction as EditingTransaction).id : undefined}
                  attachments={attachments}
                  pendingAttachments={pendingAttachments}
                  onAttachmentsChange={setAttachments}
                  onPendingAttachmentsChange={setPendingAttachments}
                  disabled={isSubmitting}
                />
              </div>
            </div>
          </div>
          </div>

          <div className={stickyFooter}>
            {formError && <p className="text-sm text-[var(--color-danger)]">{formError}</p>}
            <Button
              type="submit"
              isLoading={isSubmitting}
              className="w-full max-w-md mx-auto py-4 rounded-full text-base shadow-lg justify-center hover:scale-[1.01] transition-transform sm:max-w-none"
            >
              {simpleForm.type === 'paylater' ? (
                <CreditCard className="w-5 h-5" />
              ) : (
                <Save className="w-5 h-5" />
              )}
              {simpleForm.type === 'paylater'
                ? 'Record settlement'
                : 'Save transaction'}
            </Button>
          </div>
        </form>
      )}

      {/* Map Picker Modal */}
      <MapPicker
        isOpen={mapPickerOpen}
        onClose={() => setMapPickerOpen(false)}
        title={mapPickerMode === 'origin' ? 'Select Origin' : 'Select Destination'}
        initialLocation={mapPickerMode === 'origin' ? simpleForm.origin : simpleForm.destination}
        onSelect={(location) => {
          if (mapPickerMode === 'origin') {
            setSimpleForm({ ...simpleForm, origin: location });
          } else {
            setSimpleForm({ ...simpleForm, destination: location });
          }
        }}
      />

      {/* Attachment Preview Modal */}
      {previewAttachment && (
        <div 
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewAttachment(null)}
        >
          <div 
            className="relative max-w-4xl max-h-[90vh] bg-[var(--ref-surface-container-lowest)] rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
              <h3 className="font-headline font-bold text-lg truncate pr-4">{previewAttachment.filename}</h3>
              <button
                onClick={() => setPreviewAttachment(null)}
                className="p-2 hover:bg-[var(--ref-surface-container-high)] rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Preview Content */}
            <div className="p-4 flex items-center justify-center bg-black">
              {previewAttachment.mimetype.startsWith('image/') ? (
                <img 
                  src={previewAttachment.url} 
                  alt={previewAttachment.filename}
                  className="max-w-full max-h-[70vh] object-contain"
                />
              ) : (
                <div className="text-center text-white py-12">
                  <p className="text-lg mb-4">Preview not available</p>
                  <button
                    onClick={() => window.open(previewAttachment.url, '_blank')}
                    className="px-6 py-2 bg-[var(--color-primary)] text-white rounded-full"
                  >
                    Open File
                  </button>
                </div>
              )}
            </div>
            
            {/* Footer Actions */}
            <div className="flex items-center justify-between p-4 border-t border-[var(--color-border)]">
              <button
                onClick={() => window.open(previewAttachment.url, '_blank')}
                className="px-6 py-2 bg-[var(--ref-surface-container-high)] hover:bg-[var(--ref-surface-container)] rounded-full text-sm font-semibold transition-colors"
              >
                Open in New Tab
              </button>
              <button
                onClick={() => setPreviewAttachment(null)}
                className="px-6 py-2 bg-[var(--color-primary)] text-white rounded-full text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
