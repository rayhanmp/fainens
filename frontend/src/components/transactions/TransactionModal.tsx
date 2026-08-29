import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { CurrencyInput } from '../ui/CurrencyInput';
import { useConfirm } from '../ui/ConfirmDialog';
import { formatCurrency, cn, getAccountTypeLabel, parseIdNominalToInt, parseSignedIdNominalToInt, formatFileSize } from '../../lib/utils';
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
  CalendarClock,
  Sparkles,
  Check,
  Pencil,
  RotateCcw,
} from 'lucide-react';
import MapPicker, { TransportRoute, calculateDistance } from '../ui/MapPicker';
import { AttachmentUploader, uploadPendingAttachments } from '../ui/AttachmentUploader';
import { loadTransferFeeRules, type TransferFeeRule } from '../../lib/transferFees';
import {
  editMetadataSchema,
  formatValidationError,
  journalFormSchema,
  simpleTransactionFormSchema,
  type EditMetadataValues,
  type JournalFormLineValues,
  type JournalFormValues,
} from '../../features/transactions/schemas';
import {
  createSimpleFormDefaults,
  startOfLocalDayMs,
  stickyFooter,
  stitchSelect,
  toDateInputLocal,
  toDatetimeLocal,
  toTimeInputLocal,
} from '../../features/transactions/modal-helpers';
import { useSimpleTransactionForm } from '../../features/transactions/modal-controller';
import { TransferFeePanel, type TransferFeeDetails } from '../../features/transactions/TransferFeePanel';
import {
  useApprovePendingTransactionMutation,
  useCreatePendingTransactionMutation,
  useCreateTransaction,
  useCreateTransportRouteTemplateMutation,
  useDeleteTransportRouteTemplateMutation,
  usePreviewPendingTransactionMutation,
  useRecommendCategoryMutation,
  useTransportRouteTemplatesQuery,
  useUpdatePendingTransactionMutation,
  useUpdateTransportRouteTemplateMutation,
  useUpdateTransaction,
} from '../../features/transactions/queries';
import type { PendingTransactionParsed } from '../../features/transactions/queries';
import { useCalculatePaylaterScheduleMutation, usePaylaterQuery, useRecognizePaylaterMutation, useSettlePaylaterMutation } from '../../features/paylater/queries';
import { useAttachmentDownload, useAttachmentsQuery, useDeleteAttachmentMutation } from '../../features/attachments/queries';

export type WalletAccount = {
  id: number;
  name: string;
  type: string;
  balance: number;
  systemKey?: string | null;
  liquidityClass?: 'cash_equivalent' | 'receivable' | 'investment' | 'non_cash';
};

export type CategoryRow = {
  id: number;
  name: string;
  icon?: string | null;
  color?: string | null;
};

export type TagRow = { id: number; name: string; color: string };

type TransportRouteTemplate = {
  id: number;
  name: string;
  provider: string | null;
  service: string | null;
  originName: string | null;
  originLat: number | null;
  originLng: number | null;
  destName: string | null;
  destLat: number | null;
  destLng: number | null;
  categoryId: number | null;
  defaultAccountId: number | null;
  notes: string | null;
  tagIds: number[];
};

type TxLine = {
  id: number;
  accountId: number;
  debit: number;
  credit: number;
  description?: string;
  cashFlowClass?: 'operating' | 'investing' | 'financing' | 'transfer' | 'recovery' | null;
};

export type EditingTransaction = {
  id: number;
  date: number;
  description: string;
  reference?: string;
  notes?: string;
  place?: string;
  categoryId?: number | null;
  txType?: string;
  lines: TxLine[];
  categoryAllocations?: Array<{ categoryId: number; amount: number; categoryName?: string | null }>;
  tags: Array<{ tagId: number; name: string; color: string }>;
};

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  onSuccess?: (txId: number) => void;
  accounts: WalletAccount[];
  categories: CategoryRow[];
  tags: TagRow[];
  editingTransaction: EditingTransaction | null;
  periodId?: number | null;
  initialMode?: 'view' | 'edit';
  pendingTransaction?: {
    id: number;
    parsedData: PendingTransactionParsed;
  } | null;
}

const WALLET_ICONS = [Landmark, Wallet, Banknote] as const;

export function TransactionModal({
  isOpen,
  onClose,
  onSaved,
  onSuccess,
  accounts,
  categories,
  tags,
  editingTransaction,
  periodId,
  initialMode = 'edit',
  pendingTransaction,
}: TransactionModalProps) {
  const createTransactionMutation = useCreateTransaction();
  const updateTransactionMutation = useUpdateTransaction();
  const previewPendingMutation = usePreviewPendingTransactionMutation();
  const createPendingMutation = useCreatePendingTransactionMutation();
  const updatePendingMutation = useUpdatePendingTransactionMutation();
  const approvePendingMutation = useApprovePendingTransactionMutation();
  const routeTemplatesQuery = useTransportRouteTemplatesQuery(isOpen);
  const createRouteTemplateMutation = useCreateTransportRouteTemplateMutation();
  const updateRouteTemplateMutation = useUpdateTransportRouteTemplateMutation();
  const deleteRouteTemplateMutation = useDeleteTransportRouteTemplateMutation();
  const paylaterQuery = usePaylaterQuery(isOpen && !editingTransaction);
  const calculatePaylaterScheduleMutation = useCalculatePaylaterScheduleMutation();
  const settlePaylaterMutation = useSettlePaylaterMutation();
  const recognizePaylaterMutation = useRecognizePaylaterMutation();
  const recommendCategoryMutation = useRecommendCategoryMutation();
  const attachmentsQuery = useAttachmentsQuery(isOpen && editingTransaction ? editingTransaction.id : null);
  const downloadAttachment = useAttachmentDownload();
  const deleteAttachmentMutation = useDeleteAttachmentMutation();
  const [inputMode, setInputMode] = useState<'simple' | 'ai' | 'journal'>('simple');
  const [viewMode, setViewMode] = useState(initialMode === 'view');
  const [activeDetailField, setActiveDetailField] = useState<string | null>(null);
  const { confirm } = useConfirm();
  
  // Reset view mode when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setViewMode(initialMode === 'view' && editingTransaction !== null);
      setActiveDetailField(null);
    }
  }, [isOpen, initialMode, editingTransaction]);

  // Prefill form when editing pending transaction
  useEffect(() => {
    console.log('Pending tx effect running:', { hasPending: !!pendingTransaction, isOpen });
    if (!pendingTransaction || !isOpen) return;
    
    const parsed = pendingTransaction.parsedData;
    const cat = categories.find(c => c.name === parsed.category);
    const fromAcc = accounts.find(a => a.name.toLowerCase().includes((parsed.fromAccount || '').toLowerCase()));
    
    setSimpleForm(prev => ({
      ...prev,
      subscriptionId: '',
      dateTime: parsed.date ? `${parsed.date}T${new Date().getHours().toString().padStart(2,'0')}:${new Date().getMinutes().toString().padStart(2,'0')}` : toDatetimeLocal(),
      type: parsed.type === 'income' ? 'income' : parsed.type === 'transfer' ? 'transfer' : 'expense',
      fromAccountId: fromAcc?.id.toString() || '',
      categoryId: cat?.id.toString() || '',
      amount: parsed.amount.toString(),
      description: parsed.description,
      notes: parsed.memo || '',
      place: parsed.place || '',
    }));
    setInputMode('simple');
  }, [pendingTransaction, isOpen, categories, accounts]);

  // Reset form when modal opens for new transaction
  useEffect(() => {
    if (!isOpen || pendingTransaction) return;
    
    setSimpleForm(prev => ({ ...prev, subscriptionId: '' }));
    setAiInput('');
    setAiParsed(null);
    setParseError('');
  }, [isOpen, pendingTransaction]);

  // Reset AI form when switching away from AI mode
  useEffect(() => {
    if (inputMode !== 'ai') {
      setAiInput('');
      setAiParsed(null);
      setParseError('');
    }
  }, [inputMode]);

  // Keep server-facing form data in RHF so conditional fields, validation, and
  // resets share one source of truth. UI-only state (map pickers, previews,
  // loading indicators) intentionally remains local to this component.
  const { methods: simpleFormMethods, values: simpleForm, update: setSimpleForm } = useSimpleTransactionForm();

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
  const paylaterObligationsState = paylaterQuery.data?.obligations ?? null;

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

  const journalForm = useForm<JournalFormValues>({
    resolver: zodResolver(journalFormSchema),
    defaultValues: {
      dateTime: toDatetimeLocal(),
      description: '',
      notes: '',
      place: '',
      tagIds: [],
      lines: [
        { accountId: '', debit: '', credit: '', description: '', cashFlowClass: '' },
        { accountId: '', debit: '', credit: '', description: '', cashFlowClass: '' },
      ],
      categoryAllocations: [],
    },
    mode: 'onSubmit',
  });
  const journalLines = useFieldArray({ control: journalForm.control, name: 'lines' });
  const journalAllocations = useFieldArray({ control: journalForm.control, name: 'categoryAllocations' });
  const journalValues = journalForm.watch();

  // AI mode state
  const [aiInput, setAiInput] = useState('');
  const [aiParsed, setAiParsed] = useState<PendingTransactionParsed | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [parseError, setParseError] = useState('');

  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transferFeeRules, setTransferFeeRules] = useState<TransferFeeRule[]>([]);
  const [transferFeeControlsOpen, setTransferFeeControlsOpen] = useState(false);
  const [showAllTransferFromAccounts, setShowAllTransferFromAccounts] = useState(false);
  const [showAllTransferToAccounts, setShowAllTransferToAccounts] = useState(false);
  const routeTemplates = (routeTemplatesQuery.data ?? []) as TransportRouteTemplate[];
  const [isSavingRouteTemplate, setIsSavingRouteTemplate] = useState(false);
  const [isUpdatingRouteTemplate, setIsUpdatingRouteTemplate] = useState(false);
  const [selectedRouteTemplateId, setSelectedRouteTemplateId] = useState<number | null>(null);
  const [routeTemplateEditorMode, setRouteTemplateEditorMode] = useState<'save' | 'rename' | null>(null);
  const [routeTemplateName, setRouteTemplateName] = useState('');
  const autoTransferDescriptionRef = useRef('');
  const autoTransportDescriptionRef = useRef('');

  const [categoryRecommendation, setCategoryRecommendation] = useState<{
    categoryId: number;
    categoryName: string;
  } | null>(null);
  const isLoadingRecommendation = recommendCategoryMutation.isPending;

  // Debounced category recommendation
  useEffect(() => {
    if (!simpleForm.description || simpleForm.description.length < 3) {
      setCategoryRecommendation(null);
      return;
    }

    const timer = setTimeout(async () => {
      // Only recommend if no category is selected yet
      if (simpleForm.categoryId) return;

      try {
        const result = await recommendCategoryMutation.mutateAsync(simpleForm.description);
        setCategoryRecommendation(result);
      } catch {
        setCategoryRecommendation(null);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [simpleForm.description, simpleForm.categoryId, recommendCategoryMutation]);

  const applyCategoryRecommendation = () => {
    if (categoryRecommendation) {
      setSimpleForm({ ...simpleForm, categoryId: categoryRecommendation.categoryId.toString() });
      setCategoryRecommendation(null);
    }
  };

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

  const defaultTransferDescription = (fromAccountId: string, toAccountId: string) => {
    const from = accounts.find((account) => account.id.toString() === fromAccountId);
    const to = accounts.find((account) => account.id.toString() === toAccountId);
    return from && to ? `Transfer ${from.name} -> ${to.name}` : '';
  };

  useEffect(() => {
    if (simpleForm.type !== 'transfer') {
      autoTransferDescriptionRef.current = '';
      return;
    }
    const generated = defaultTransferDescription(simpleForm.fromAccountId, simpleForm.toAccountId);
    if (!generated) return;
    setSimpleForm((current) => {
      if (current.type !== 'transfer') return current;
      if (current.description.trim() !== '' && current.description !== autoTransferDescriptionRef.current) return current;
      autoTransferDescriptionRef.current = generated;
      return { ...current, description: generated };
    });
  }, [simpleForm.type, simpleForm.fromAccountId, simpleForm.toAccountId, accounts]);

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

    const rule = transferFeeRules.find((candidate) => candidate.fromAccountId === Number(fromId) && candidate.toAccountId === Number(toId));
    // Preserve the previous provider defaults when no custom pair rule exists.
    const builtIn = isBankAccount(fromId) && isGoPayAccount(toId)
      ? { fee: 1000, senderPays: true as const }
      : isOVOAccount(toId)
        ? { fee: 1000, senderPays: false as const }
        : { fee: 0, senderPays: true as const };
    const manualFeeEntered = simpleForm.transferAdminFee.trim() !== '';
    const parsedManualFee = manualFeeEntered ? parseSignedIdNominalToInt(simpleForm.transferAdminFee) : null;
    if (manualFeeEntered && (parsedManualFee == null || parsedManualFee < 0)) {
      return { error: 'Transfer fee must be zero or a positive amount' };
    }
    const fee = parsedManualFee ?? rule?.feeCents ?? builtIn.fee;
    const senderPays = simpleForm.transferFeePayerOverride
      ? simpleForm.transferFeePayerOverride === 'sender'
      : rule?.payer
        ? rule.payer === 'sender'
        : builtIn.senderPays;
    const fromAmount = senderPays ? amount + fee : amount;
    const toAmount = senderPays ? amount : amount - fee;
    if (toAmount < 0) return { error: 'Transfer fee cannot exceed the transfer amount when paid by the recipient' };
    return {
      fee,
      senderPays,
      fromAmount,
      toAmount,
      source: manualFeeEntered ? 'manual' as const : rule ? 'default' as const : builtIn.fee > 0 ? 'provider' as const : 'none' as const,
      description: senderPays
        ? `Transfer ${formatCurrency(amount)} + Fee ${formatCurrency(fee)} = ${formatCurrency(fromAmount)} deducted from source`
        : `Transfer ${formatCurrency(amount)} - Fee ${formatCurrency(fee)} = ${formatCurrency(toAmount)} received (fee deducted at destination)`,
    };
  };

  const [editMeta, setEditMeta] = useState({
    date: '',
    time: '',
    description: '',
    reference: '',
    notes: '',
    place: '',
    categoryId: '',
    tagIds: [] as number[],
  });

  const editMetadataForm = useForm<EditMetadataValues>({
    resolver: zodResolver(editMetadataSchema),
    defaultValues: {
      date: '',
      time: '',
      description: '',
      reference: '',
      notes: '',
      place: '',
      categoryId: '',
      tagIds: [],
    },
    mode: 'onSubmit',
  });
  const editMetadataTagIds = editMetadataForm.watch('tagIds');

  useEffect(() => {
    if (!isOpen) return;
    setTransferFeeControlsOpen(false);
    setShowAllTransferFromAccounts(false);
    setShowAllTransferToAccounts(false);
    autoTransferDescriptionRef.current = '';
    autoTransportDescriptionRef.current = '';
    if (editingTransaction) {
      setInputMode('simple');
      const txDate = new Date(editingTransaction.date);
      setEditMeta({
        date: toDateInputLocal(txDate),
        time: toTimeInputLocal(txDate),
        description: editingTransaction.description,
        reference: editingTransaction.reference || '',
        notes: editingTransaction.notes || '',
        place: editingTransaction.place || '',
        categoryId: editingTransaction.categoryId?.toString() || '',
        tagIds: editingTransaction.tags.map((t) => t.tagId),
      });
      editMetadataForm.reset({
        date: toDateInputLocal(txDate),
        time: toTimeInputLocal(txDate),
        description: editingTransaction.description,
        reference: editingTransaction.reference || '',
        notes: editingTransaction.notes || '',
        place: editingTransaction.place || '',
        categoryId: editingTransaction.categoryId?.toString() || '',
        tagIds: editingTransaction.tags.map((t) => t.tagId),
      });
      journalForm.reset({
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
          cashFlowClass: l.cashFlowClass === 'operating' || l.cashFlowClass === 'investing' || l.cashFlowClass === 'financing' || l.cashFlowClass === 'transfer' ? l.cashFlowClass : '',
        })),
        categoryAllocations: (editingTransaction.categoryAllocations ?? []).map((allocation) => ({
          categoryId: allocation.categoryId.toString(),
          amount: allocation.amount.toString(),
        })),
      });
    } else {
      setInputMode('simple');
      setRouteTemplateName('');
      setSelectedRouteTemplateId(null);
      setRouteTemplateEditorMode(null);
      setSimpleForm(createSimpleFormDefaults());
      editMetadataForm.reset();
      setInstallmentPreview(null);
      setAttachments([]);
      setAttachmentUrls({});
      setPendingAttachments([]);
      setCategoryRecommendation(null);
      journalForm.reset({
        dateTime: toDatetimeLocal(),
        description: '',
        notes: '',
        place: '',
        tagIds: [],
        lines: [
          { accountId: '', debit: '', credit: '', description: '', cashFlowClass: '' },
          { accountId: '', debit: '', credit: '', description: '', cashFlowClass: '' },
        ],
        categoryAllocations: [],
      });
    }
    setFormError('');
  }, [isOpen, editingTransaction]);

  useEffect(() => {
    if (!isOpen || !editingTransaction || !attachmentsQuery.data) return;
    setAttachments(attachmentsQuery.data);
    attachmentsQuery.data
      .filter((attachment) => attachment.mimetype.startsWith('image/'))
      .forEach((attachment) => {
        void downloadAttachment(attachment.id)
          .then(({ url }) => setAttachmentUrls((current) => ({ ...current, [attachment.id]: url })))
          .catch(() => undefined);
      });
  }, [isOpen, editingTransaction, attachmentsQuery.data, downloadAttachment]);

  useEffect(() => {
    if (isOpen) setTransferFeeRules(loadTransferFeeRules());
  }, [isOpen]);

  const applyRouteTemplate = (template: TransportRouteTemplate) => {
    const origin = template.originName && template.originLat != null && template.originLng != null
      ? { name: template.originName, lat: template.originLat, lng: template.originLng }
      : null;
    const destination = template.destName && template.destLat != null && template.destLng != null
      ? { name: template.destName, lat: template.destLat, lng: template.destLng }
      : null;
    const hasDefaultAccount = template.defaultAccountId != null && accounts.some((account) => account.id === template.defaultAccountId);
    const hasCategory = template.categoryId != null && categories.some((category) => category.id === template.categoryId);
    setSimpleForm((current) => ({
      ...current,
      origin,
      destination,
      rideProvider: (template.provider === 'gojek' || template.provider === 'grab' || template.provider === 'others') ? template.provider : '',
      rideService: template.service || '',
      categoryId: hasCategory ? String(template.categoryId) : current.categoryId,
      fromAccountId: hasDefaultAccount ? String(template.defaultAccountId) : current.fromAccountId,
      notes: template.notes || current.notes,
      tagIds: template.tagIds,
      description: '',
    }));
    setRouteTemplateName(template.name);
    setRouteTemplateEditorMode(null);
  };

  const currentRouteTemplateFallbackName = () => {
    if (!simpleForm.origin || !simpleForm.destination) return '';
    return `${simpleForm.origin.name.split(',')[0].trim()} -> ${simpleForm.destination.name.split(',')[0].trim()}`;
  };

  const openRouteTemplateEditor = (mode: 'save' | 'rename') => {
    if (mode === 'rename') {
      const selected = routeTemplates.find((template) => template.id === selectedRouteTemplateId);
      if (!selected) return;
      setRouteTemplateName(selected.name);
    } else {
      setRouteTemplateName(currentRouteTemplateFallbackName());
    }
    setRouteTemplateEditorMode(mode);
  };

  const closeRouteTemplateEditor = () => {
    const selected = routeTemplates.find((template) => template.id === selectedRouteTemplateId);
    setRouteTemplateName(selected?.name ?? '');
    setRouteTemplateEditorMode(null);
  };

  const saveCurrentRouteTemplate = async () => {
    if (!simpleForm.origin || !simpleForm.destination) return;
    const fallbackName = currentRouteTemplateFallbackName();
    const name = routeTemplateName.trim() || fallbackName;
    setIsSavingRouteTemplate(true);
    try {
      const created = await createRouteTemplateMutation.mutateAsync({
        name,
        provider: simpleForm.rideProvider || null,
        service: simpleForm.rideService || null,
        originName: simpleForm.origin.name,
        originLat: simpleForm.origin.lat,
        originLng: simpleForm.origin.lng,
        destName: simpleForm.destination.name,
        destLat: simpleForm.destination.lat,
        destLng: simpleForm.destination.lng,
        categoryId: simpleForm.categoryId ? Number(simpleForm.categoryId) : null,
        defaultAccountId: simpleForm.fromAccountId ? Number(simpleForm.fromAccountId) : null,
        notes: simpleForm.notes || null,
        tagIds: simpleForm.tagIds,
      });
      setSelectedRouteTemplateId((created as unknown as TransportRouteTemplate).id);
      setRouteTemplateName(name);
      setRouteTemplateEditorMode(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not save route');
    } finally {
      setIsSavingRouteTemplate(false);
    }
  };

  const renameRouteTemplate = async () => {
    if (!selectedRouteTemplateId || !routeTemplateName.trim()) return;
    setIsUpdatingRouteTemplate(true);
    try {
      await updateRouteTemplateMutation.mutateAsync({ id: selectedRouteTemplateId, data: { name: routeTemplateName.trim() } });
      setRouteTemplateEditorMode(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not rename route');
    } finally {
      setIsUpdatingRouteTemplate(false);
    }
  };

  const deleteRouteTemplate = async () => {
    if (!selectedRouteTemplateId) return;
    const confirmed = await confirm({
      title: 'Delete saved route?',
      message: 'This only removes the reusable route shortcut. Existing transactions stay unchanged.',
      confirmLabel: 'Delete route',
      variant: 'warning',
    });
    if (!confirmed) return;
    setIsUpdatingRouteTemplate(true);
    try {
      await deleteRouteTemplateMutation.mutateAsync(selectedRouteTemplateId);
      setSelectedRouteTemplateId(null);
      setRouteTemplateName('');
      setRouteTemplateEditorMode(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not delete route');
    } finally {
      setIsUpdatingRouteTemplate(false);
    }
  };

  // Auto-generate a compact, consistent name for transport expenses.
  useEffect(() => {
    const selectedCategory = categories.find(c => c.id.toString() === simpleForm.categoryId);
    const isTransport = simpleForm.type === 'expense' && selectedCategory && /transport/i.test(selectedCategory.name);
    if (!isTransport || !simpleForm.origin || !simpleForm.destination) {
      autoTransportDescriptionRef.current = '';
      return;
    }
    const originName = simpleForm.origin.name.split(',')[0].trim();
    const destName = simpleForm.destination.name.split(',')[0].trim();
    const routeName = routeTemplateName.trim() || `${originName} -> ${destName}`;
    const providerName = simpleForm.rideService || (
      simpleForm.rideProvider === 'gojek' ? 'GoJek' :
        simpleForm.rideProvider === 'grab' ? 'Grab' :
          simpleForm.rideProvider === 'others' ? 'Transport' : ''
    );
    const generated = [providerName, routeName].filter(Boolean).join(' ');
    if (!generated) return;
    setSimpleForm((current) => {
      if (current.description.trim() !== '' && current.description !== autoTransportDescriptionRef.current) return current;
      autoTransportDescriptionRef.current = generated;
      return { ...current, description: generated };
    });
  }, [simpleForm.type, simpleForm.origin, simpleForm.destination, simpleForm.rideProvider, simpleForm.rideService, simpleForm.categoryId, categories, routeTemplateName]);

  // Calculate installment preview for paylater
  const calculateInstallmentPreview = async (form: typeof simpleForm) => {
    if (!form.amount || !form.paylaterFirstDueDate) return;
    
    try {
      const amount = parseIdNominalToInt(form.amount);
      const result = await calculatePaylaterScheduleMutation.mutateAsync({
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

  const handleEditMetaSubmit = editMetadataForm.handleSubmit(
    async (values) => {
      await applyMetadataChanges(values);
    },
    (errors) => {
      const firstError = Object.values(errors)[0];
      setFormError(firstError?.message || 'Please check the form values');
    },
  );

  const applyMetadataChanges = async (values?: EditMetadataValues) => {
    if (!editingTransaction) return;
    setFormError('');
    setIsSubmitting(true);
    try {
      const metadata = values ?? editMeta;
      const dateTime = metadata.time ? `${metadata.date}T${metadata.time}:00` : metadata.date;
      await updateTransactionMutation.mutateAsync({ id: editingTransaction.id, data: {
        description: metadata.description,
        reference: metadata.reference || null,
        notes: metadata.notes || null,
        place: metadata.place || null,
        date: dateTime,
        tagIds: metadata.tagIds,
        categoryId: metadata.categoryId ? parseInt(metadata.categoryId, 10) : null,
      } });
      onSaved();
      onClose();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetMetadataChanges = () => {
    if (!editingTransaction) return;
    const txDate = new Date(editingTransaction.date);
    setEditMeta({
      date: toDateInputLocal(txDate),
      time: toTimeInputLocal(txDate),
      description: editingTransaction.description,
      reference: editingTransaction.reference || '',
      notes: editingTransaction.notes || '',
      place: editingTransaction.place || '',
      categoryId: editingTransaction.categoryId?.toString() || '',
      tagIds: editingTransaction.tags.map((tag) => tag.tagId),
    });
    editMetadataForm.reset({
      date: toDateInputLocal(txDate),
      time: toTimeInputLocal(txDate),
      description: editingTransaction.description,
      reference: editingTransaction.reference || '',
      notes: editingTransaction.notes || '',
      place: editingTransaction.place || '',
      categoryId: editingTransaction.categoryId?.toString() || '',
      tagIds: editingTransaction.tags.map((tag) => tag.tagId),
    });
    setActiveDetailField(null);
    setFormError('');
  };

  const hasPendingMetadataChanges = (() => {
    if (!editingTransaction) return false;
    const txDate = new Date(editingTransaction.date);
    const originalTagIds = editingTransaction.tags.map((tag) => tag.tagId).sort((a, b) => a - b);
    const currentTagIds = [...editMeta.tagIds].sort((a, b) => a - b);
    return (
      editMeta.date !== toDateInputLocal(txDate) ||
      editMeta.time !== toTimeInputLocal(txDate) ||
      editMeta.description !== editingTransaction.description ||
      editMeta.reference !== (editingTransaction.reference || '') ||
      editMeta.notes !== (editingTransaction.notes || '') ||
      editMeta.place !== (editingTransaction.place || '') ||
      originalTagIds.length !== currentTagIds.length ||
      originalTagIds.some((tagId, index) => tagId !== currentTagIds[index])
    );
  })();

  const closeDetail = async () => {
    if (hasPendingMetadataChanges) {
      const discard = await confirm({
        title: 'Discard unsaved edits?',
        message: 'Your changes have not been applied to this transaction.',
        confirmLabel: 'Discard edits',
        variant: 'warning',
      });
      if (!discard) return;
      resetMetadataChanges();
    }
    onClose();
  };

  const handleSimpleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const formIsValid = await simpleFormMethods.trigger();
    if (!formIsValid) {
      const firstError = Object.values(simpleFormMethods.formState.errors)[0];
      setFormError(firstError?.message || 'Please check the form values');
      return;
    }

    const simpleValidation = simpleTransactionFormSchema.safeParse(simpleForm);
    if (!simpleValidation.success) {
      setFormError(formatValidationError(simpleValidation.error));
      return;
    }

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
        await settlePaylaterMutation.mutateAsync({
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
          await recognizePaylaterMutation.mutateAsync({
            date: new Date(simpleForm.dateTime).getTime(),
            description: simpleForm.description || 'PayLater purchase',
            principalAmount: amount,
            paylaterLiabilityAccountId: parseInt(simpleForm.fromAccountId, 10),
            categoryId: simpleForm.categoryId ? parseInt(simpleForm.categoryId, 10) : undefined,
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
      const transferDetails = calculateTransferDetails();
      if (transferDetails && 'error' in transferDetails) {
        setFormError(transferDetails.error ?? 'Invalid transfer details');
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
        if (transferDetails && !('error' in transferDetails) && transferDetails.fee > 0) {
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
          mainTransaction = await createTransactionMutation.mutateAsync({
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
          
          // Fee transaction: debit expense and credit the wallet that actually
          // paid it. Recipient-deducted OVO fees reduce the destination wallet.
          await createTransactionMutation.mutateAsync({
            kind: 'expense',
            amountCents: feeAmount,
            description: feeDescription,
            notes: `Admin fee for transfer #${mainTransaction.id}. ${transferDetails.senderPays ? 'Fee paid by sender' : 'Fee deducted from recipient'}`,
            place: simpleForm.place || null,
            date: dateIso,
            periodId: periodId ?? null,
            categoryId: null, // Will use auto expense account
            walletAccountId: transferDetails.senderPays ? walletAccountId : toWalletAccountId!,
            linkedTxId: mainTransaction.id, // Link to parent transfer transaction
          });
        } else {
          // No fee - create normal transfer
          mainTransaction = await createTransactionMutation.mutateAsync({
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
        mainTransaction = await createTransactionMutation.mutateAsync({
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
      onSuccess?.(mainTransaction.id);
      onClose();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addJournalLine = () => {
    journalLines.append({ accountId: '', debit: '', credit: '', description: '', cashFlowClass: '' });
  };

  const removeJournalLine = (index: number) => {
    if (journalLines.fields.length <= 2) {
      setFormError('Journal entry must have at least 2 lines');
      return;
    }
    journalLines.remove(index);
  };

  const updateJournalLine = (index: number, field: keyof JournalFormLineValues, value: string) => {
    const line = journalValues.lines[index];
    if (!line) return;
    if (field === 'accountId') {
      const account = accounts.find((item) => item.id.toString() === value);
      journalForm.setValue(`lines.${index}.accountId`, value, { shouldDirty: true });
      journalForm.setValue(
        `lines.${index}.cashFlowClass`,
        account?.liquidityClass === 'cash_equivalent' ? line.cashFlowClass : '',
        { shouldDirty: true },
      );
    } else {
      journalForm.setValue(`lines.${index}.${field}`, value, { shouldDirty: true });
    }
  };

  const calculateJournalTotals = (values: JournalFormValues = journalValues) => {
    const totalDebit = values.lines.reduce(
      (sum, line) => sum + (parseInt(line.debit, 10) || 0),
      0,
    );
    const totalCredit = values.lines.reduce(
      (sum, line) => sum + (parseInt(line.credit, 10) || 0),
      0,
    );
    return { totalDebit, totalCredit, isBalanced: totalDebit === totalCredit && totalDebit > 0 };
  };

  const calculateJournalNetExpense = (values: JournalFormValues = journalValues) => values.lines.reduce((sum, line) => {
    const account = accounts.find((item) => item.id.toString() === line.accountId);
    if (account?.type !== 'expense') return sum;
    return sum + (parseInt(line.debit, 10) || 0) - (parseInt(line.credit, 10) || 0);
  }, 0);

  const updateCategoryAllocation = (index: number, field: 'categoryId' | 'amount', value: string) => {
    journalForm.setValue(`categoryAllocations.${index}.${field}`, value, { shouldDirty: true });
  };

  const addCategoryAllocation = () => {
    journalAllocations.append({ categoryId: '', amount: '' });
  };

  const removeCategoryAllocation = (index: number) => {
    journalAllocations.remove(index);
  };

  const handleJournalSubmit = journalForm.handleSubmit(async (values) => {
    setFormError('');

    const journalValidation = journalFormSchema.safeParse(values);
    if (!journalValidation.success) {
      setFormError(formatValidationError(journalValidation.error));
      return;
    }

    const { totalDebit, totalCredit, isBalanced } = calculateJournalTotals(values);

    if (!isBalanced) {
      setFormError(`Journal not balanced: Debits ${totalDebit} ≠ Credits ${totalCredit}`);
      return;
    }

    const validLines = values.lines.filter(
      (line) =>
        line.accountId && (parseInt(line.debit, 10) > 0 || parseInt(line.credit, 10) > 0),
    );

    if (validLines.length < 2) {
      setFormError('At least 2 accounts must have non-zero amounts');
      return;
    }
    const unclassifiedCashLine = validLines.find((line) => {
      const account = accounts.find((item) => item.id.toString() === line.accountId);
      return account?.liquidityClass === 'cash_equivalent' && !line.cashFlowClass;
    });
    if (unclassifiedCashLine) {
      setFormError('Choose a cash-flow class for every cash-equivalent journal line');
      return;
    }

    const netExpense = calculateJournalNetExpense(values);
    const allocationRows = values.categoryAllocations.filter((allocation) => allocation.categoryId || allocation.amount);
    const parsedAllocations = allocationRows.map((allocation) => ({
      categoryId: parseInt(allocation.categoryId, 10),
      amount: parseInt(allocation.amount, 10),
    }));
    if (parsedAllocations.some((allocation) => !Number.isSafeInteger(allocation.categoryId) || allocation.categoryId <= 0 || !Number.isSafeInteger(allocation.amount) || allocation.amount === 0)) {
      setFormError('Each category allocation needs a category and a non-zero whole-rupiah amount');
      return;
    }
    if (new Set(parsedAllocations.map((allocation) => allocation.categoryId)).size !== parsedAllocations.length) {
      setFormError('A category can appear only once in the allocation list');
      return;
    }
    const allocationTotal = parsedAllocations.reduce((sum, allocation) => sum + allocation.amount, 0);
    if (netExpense !== 0 && allocationTotal !== netExpense) {
      setFormError(`Category allocations must equal the journal's net expense (${formatCurrency(netExpense)}). Current total: ${formatCurrency(allocationTotal)}.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const dateIso = new Date(values.dateTime).toISOString();
      await createTransactionMutation.mutateAsync({
        date: dateIso,
        description: values.description,
        notes: values.notes || null,
        place: values.place || null,
        tagIds: values.tagIds,
        lines: validLines.map((line) => ({
          accountId: parseInt(line.accountId, 10),
          debit: parseInt(line.debit, 10) || 0,
          credit: parseInt(line.credit, 10) || 0,
          description: line.description || undefined,
          cashFlowClass: line.cashFlowClass || undefined,
        })),
        categoryAllocations: parsedAllocations,
      });
      onSaved();
      onClose();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  });

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
    compact = false,
    disabled = false,
    disabledHint?: string,
  ) => {
    const Icon = WALLET_ICONS[idx % 3];
    return (
      <button
        key={a.id}
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        title={disabled ? disabledHint : undefined}
        className={cn(
          'flex flex-col items-start rounded-xl transition-all text-left',
          compact ? 'min-w-0 w-full p-3 min-h-[72px]' : 'p-4 min-h-[96px]',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          selected
            ? 'bg-[var(--ref-surface-container-lowest)] border-2 border-[var(--ref-primary-container)] shadow-sm'
            : 'bg-[var(--ref-surface-container-low)] border-2 border-transparent hover:border-[var(--ref-surface-container-highest)]',
        )}
      >
        <Icon
          className={cn(
            compact ? 'w-5 h-5 mb-1.5' : 'w-6 h-6 mb-2',
            selected ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]',
          )}
        />
        <span className="text-xs font-bold text-[var(--color-text-primary)] line-clamp-2">
          {a.name}
        </span>
        <span className="text-[10px] text-[var(--color-muted)]">
          {getAccountTypeLabel(a.type)} · {formatCurrency(a.balance)}
        </span>
        {disabled && disabledHint && (
          <span className="mt-0.5 text-[10px] font-semibold text-[var(--color-muted)]">
            {disabledHint}
          </span>
        )}
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
      const detailDate = editMeta.date
        ? new Date(`${editMeta.date}T${editMeta.time || '00:00'}:00`)
        : new Date(editingTransaction.date);
      
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
                  <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-high)] flex items-center justify-center group-hover:bg-[var(--color-surface)] transition-colors">
                    <StickyNote className="w-5 h-5 text-[var(--color-muted)]" />
                  </div>
                  <div>
                    <p className="font-label text-xs text-[var(--color-muted)]">Date Recorded</p>
                    <p className="font-body text-sm font-semibold">{new Date(editingTransaction.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                  </div>
                </div>

                {/* Purpose/Description */}
                <div className="bg-[var(--ref-surface-container-lowest)] p-5 rounded-xl flex items-center gap-4 group transition-all hover:bg-[var(--ref-surface-container)]">
                  <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-high)] flex items-center justify-center group-hover:bg-[var(--color-surface)] transition-colors">
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
                    <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-high)] flex items-center justify-center group-hover:bg-[var(--color-surface)] transition-colors">
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
                  <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-high)] flex items-center justify-center group-hover:bg-[var(--color-surface)] transition-colors">
                    <StickyNote className="w-5 h-5 text-[var(--color-muted)]" />
                  </div>
                  <div className="flex-1">
                    <p className="font-label text-xs text-[var(--color-muted)]">Note</p>
                    <p className="font-body text-sm font-semibold italic">{editingTransaction.notes}</p>
                  </div>
                </div>
              )}
              {editingTransaction.reference && (
                <div className="bg-[var(--ref-surface-container-lowest)] p-5 rounded-xl flex items-center gap-4 group transition-all hover:bg-[var(--ref-surface-container)] mb-6">
                  <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-high)] flex items-center justify-center group-hover:bg-[var(--color-surface)] transition-colors">
                    <TagIcon className="w-5 h-5 text-[var(--color-muted)]" />
                  </div>
                  <div className="flex-1">
                    <p className="font-label text-xs text-[var(--color-muted)]">Reference</p>
                    <p className="font-body text-sm font-semibold">{editingTransaction.reference}</p>
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
          onClose={() => { void closeDetail(); }}
          title={isExpense ? "Expense Detail" : "Income Detail"}
          subtitle={hasPendingMetadataChanges ? 'Unsaved edits' : `ID: #${editingTransaction.id}`}
          size="default"
          className="max-w-4xl"
          footer={
            <div className="w-full space-y-3">
              {formError && <div className="rounded-xl bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{formError}</div>}
              <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                <p className="text-xs text-[var(--color-muted)]">Click a detail to edit it. Amounts and accounts stay protected.</p>
                <div className="flex w-full gap-3 md:w-auto">
                  {hasPendingMetadataChanges && <Button type="button" variant="secondary" onClick={resetMetadataChanges} disabled={isSubmitting} className="flex-1 md:flex-none rounded-full px-5"><RotateCcw className="mr-2 h-4 w-4" />Discard</Button>}
                  {hasPendingMetadataChanges ? <Button type="button" onClick={() => void applyMetadataChanges()} isLoading={isSubmitting} className="flex-1 md:flex-none rounded-full px-6"><Check className="mr-2 h-4 w-4" />Apply changes</Button> : <Button type="button" variant="secondary" onClick={() => { void closeDetail(); }} className="flex-1 md:flex-none rounded-full px-6">Close</Button>}
                </div>
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
                    {activeDetailField === 'description' ? <input autoFocus value={editMeta.description} onChange={(event) => setEditMeta({ ...editMeta, description: event.target.value })} onBlur={() => setActiveDetailField(null)} className="w-full rounded-lg bg-[var(--ref-surface-container-low)] px-2 py-1 font-headline text-base font-bold tracking-tight outline-none ring-[var(--ref-primary)] focus:ring-2" /> : <button type="button" onClick={() => setActiveDetailField('description')} className="group flex items-center gap-1 rounded-lg -ml-2 px-2 py-1 text-left transition-colors hover:bg-[var(--ref-surface-container-low)]"><h1 className="font-headline font-bold text-base tracking-tight text-[var(--color-on-background)]">{editMeta.description || 'Untitled transaction'}</h1><Pencil className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-60" /></button>}
                    {activeDetailField === 'date' ? <div className="mt-1 flex gap-1"><input autoFocus type="date" value={editMeta.date} onChange={(event) => setEditMeta({ ...editMeta, date: event.target.value })} className="min-w-0 rounded bg-[var(--ref-surface-container-low)] px-1 py-0.5 text-xs outline-none ring-[var(--ref-primary)] focus:ring-1" /><input type="time" value={editMeta.time} onChange={(event) => setEditMeta({ ...editMeta, time: event.target.value })} onBlur={() => setActiveDetailField(null)} className="w-20 rounded bg-[var(--ref-surface-container-low)] px-1 py-0.5 text-xs outline-none ring-[var(--ref-primary)] focus:ring-1" /></div> : <button type="button" onClick={() => setActiveDetailField('date')} className="group mt-0.5 flex items-center gap-1 rounded px-1 -ml-1 text-[var(--color-muted)] font-label text-xs uppercase tracking-widest transition-colors hover:bg-[var(--ref-surface-container-low)]">{detailDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })} • {detailDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}<Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" /></button>}
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
                  <p className="pt-1 text-[10px] text-[var(--color-muted)]">Reporting classification · protected</p>
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
                  <p className="pt-1 text-[10px] text-[var(--color-muted)]">Balance-affecting · protected</p>
                </div>

                {/* Tags */}
                <div className="space-y-0.5 rounded-xl p-2 -m-2 transition-colors hover:bg-[var(--ref-surface-container-low)]">
                  <p className="font-label text-[10px] text-[var(--color-muted)] uppercase tracking-wider">Tags</p>
                  {activeDetailField === 'tags' ? <div className="flex flex-wrap gap-1.5 pt-1">{tags.map((tag) => <button key={tag.id} type="button" onClick={() => setEditMeta({ ...editMeta, tagIds: editMeta.tagIds.includes(tag.id) ? editMeta.tagIds.filter((id) => id !== tag.id) : [...editMeta.tagIds, tag.id] })} className={cn('rounded-full border px-2 py-1 text-xs font-semibold transition-colors', editMeta.tagIds.includes(tag.id) ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)] text-white' : 'border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-[var(--color-text-secondary)]')}>{tag.name}</button>)}<button type="button" onClick={() => setActiveDetailField(null)} className="px-1.5 text-xs font-bold text-[var(--ref-primary)]">Done</button></div> : <button type="button" onClick={() => setActiveDetailField('tags')} className="group flex flex-wrap items-center gap-1.5 text-left">{editMeta.tagIds.length > 0 ? tags.filter((tag) => editMeta.tagIds.includes(tag.id)).map((tag) => <span key={tag.id} className="rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]">{tag.name}</span>) : <span className="text-sm text-[var(--color-muted)]">Add tags</span>}<Pencil className="h-3.5 w-3.5 text-[var(--color-muted)] opacity-0 transition-opacity group-hover:opacity-70" /></button>}
                </div>

                {/* Location */}
                <div className="space-y-0.5 rounded-xl p-2 -m-2 transition-colors hover:bg-[var(--ref-surface-container-low)]">
                  <p className="font-label text-[10px] text-[var(--color-muted)] uppercase tracking-wider">Location</p>
                  <div className="flex items-center gap-2">
                    <div className="p-1 bg-[var(--ref-surface-container-high)] text-[var(--color-muted)] rounded-md">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    {activeDetailField === 'place' ? <input autoFocus value={editMeta.place} onChange={(event) => setEditMeta({ ...editMeta, place: event.target.value })} onBlur={() => setActiveDetailField(null)} placeholder="Add location" className="min-w-0 flex-1 rounded bg-[var(--ref-surface-container-lowest)] px-2 py-1 text-base font-semibold outline-none ring-[var(--ref-primary)] focus:ring-2" /> : <button type="button" onClick={() => setActiveDetailField('place')} className="group flex min-w-0 items-center gap-1 text-left"><p className={cn('font-headline text-base font-semibold', !editMeta.place && 'text-sm font-normal text-[var(--color-muted)]')}>{editMeta.place || 'Add location'}</p><Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)] opacity-0 transition-opacity group-hover:opacity-70" /></button>}
                  </div>
                </div>

                {/* Notes */}
                <div className="space-y-0.5 rounded-xl p-2 -m-2 transition-colors hover:bg-[var(--ref-surface-container-low)]">
                  <p className="font-label text-[10px] text-[var(--color-muted)] uppercase tracking-wider">Note</p>
                  <div className="flex items-center gap-2">
                    <div className="p-1 bg-[var(--ref-surface-container-high)] text-[var(--color-muted)] rounded-md">
                      <StickyNote className="w-3.5 h-3.5" />
                    </div>
                    {activeDetailField === 'notes' ? <textarea autoFocus value={editMeta.notes} onChange={(event) => setEditMeta({ ...editMeta, notes: event.target.value })} onBlur={() => setActiveDetailField(null)} placeholder="Add a note" rows={2} className="min-w-0 flex-1 resize-none rounded bg-[var(--ref-surface-container-lowest)] px-2 py-1 text-base font-semibold italic outline-none ring-[var(--ref-primary)] focus:ring-2" /> : <button type="button" onClick={() => setActiveDetailField('notes')} className="group flex min-w-0 items-center gap-1 text-left"><p className={cn('font-headline text-base font-semibold italic', !editMeta.notes && 'text-sm font-normal not-italic text-[var(--color-muted)]')}>{editMeta.notes || 'Add a note'}</p><Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)] opacity-0 transition-opacity group-hover:opacity-70" /></button>}
                  </div>
                </div>
                <div className="space-y-0.5 rounded-xl p-2 -m-2 transition-colors hover:bg-[var(--ref-surface-container-low)]">
                  <p className="font-label text-[10px] text-[var(--color-muted)] uppercase tracking-wider">Reference</p>
                  <div className="flex items-center gap-2">
                    <div className="p-1 bg-[var(--ref-surface-container-high)] text-[var(--color-muted)] rounded-md">
                      <TagIcon className="w-3.5 h-3.5" />
                    </div>
                    {activeDetailField === 'reference' ? <input autoFocus value={editMeta.reference} onChange={(event) => setEditMeta({ ...editMeta, reference: event.target.value })} onBlur={() => setActiveDetailField(null)} placeholder="Add reference" className="min-w-0 flex-1 rounded bg-[var(--ref-surface-container-lowest)] px-2 py-1 text-base font-semibold outline-none ring-[var(--ref-primary)] focus:ring-2" /> : <button type="button" onClick={() => setActiveDetailField('reference')} className="group flex min-w-0 items-center gap-1 text-left"><p className={cn('font-headline text-base font-semibold', !editMeta.reference && 'text-sm font-normal text-[var(--color-muted)]')}>{editMeta.reference || 'Add reference'}</p><Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)] opacity-0 transition-opacity group-hover:opacity-70" /></button>}
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
                              const { url } = await downloadAttachment(att.id);
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
                          } catch {
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
                            const confirmed = await confirm({
                              title: 'Delete Attachment',
                              message: 'Are you sure you want to delete this attachment?',
                              confirmLabel: 'Delete',
                              variant: 'danger',
                            });
                            if (confirmed) {
                              try {
                                await deleteAttachmentMutation.mutateAsync(att.id);
                                setAttachments(attachments.filter(a => a.id !== att.id));
                                setAttachmentUrls(prev => {
                                  const updated = { ...prev };
                                  delete updated[att.id];
                                  return updated;
                                });
                              } catch {
                                alert('Failed to delete attachment');
                              }
                            }
                          }}
                          className="cursor-pointer p-2 text-[var(--color-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 rounded-lg transition-colors"
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
        <div className="bg-[var(--ref-surface-container-low)] rounded-2xl p-4 mb-6">
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <StickyNote className="w-4 h-4 text-[var(--color-warning)]" />
            <span>Names, notes, references, places, tags, and dates within the same period can be updated. Posted amounts, accounts, and cross-period changes require a correction.</span>
          </div>
        </div>
        <form onSubmit={handleEditMetaSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Date & Time */}
            <div className="bg-[var(--ref-surface-container-lowest)] p-4 rounded-xl space-y-2 group hover:bg-[var(--ref-surface-container-low)] transition-colors">
              <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
                <CalendarClock className="w-3.5 h-3.5" />
                Date & Time
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  {...editMetadataForm.register('date')}
                  className="flex-1 bg-transparent text-sm font-semibold text-[var(--color-text-primary)] focus:outline-none cursor-pointer"
                  required
                />
                <input
                  type="time"
                  {...editMetadataForm.register('time')}
                  className="w-24 bg-transparent text-sm font-semibold text-[var(--color-text-primary)] focus:outline-none cursor-pointer"
                  required
                />
              </div>
              <p className="text-[11px] text-[var(--color-muted)]">Keep the date in this transaction's period.</p>
            </div>

            {/* Category (if available) */}
            {showCategoryOnEdit && (
              <div className="bg-[var(--ref-surface-container-lowest)] p-4 rounded-xl space-y-2 group hover:bg-[var(--ref-surface-container-low)] transition-colors">
                <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
                  <TagIcon className="w-3.5 h-3.5" />
                  Category
                </label>
                <select
                  {...editMetadataForm.register('categoryId')}
                  className="w-full bg-transparent text-sm font-semibold text-[var(--color-text-primary)] focus:outline-none cursor-pointer"
                >
                  <option value="">None</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id.toString()}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[var(--color-muted)]">Category changes affect reporting and are handled separately from descriptive edits.</p>
              </div>
            )}

            {/* Transaction Name */}
            <div className="md:col-span-2 bg-[var(--ref-surface-container-lowest)] p-5 rounded-xl space-y-2 group hover:bg-[var(--ref-surface-container-low)] transition-colors">
              <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
                <TagIcon className="w-3.5 h-3.5" />
                Transaction Name
              </label>
              <input
                type="text"
                {...editMetadataForm.register('description')}
                className="w-full bg-transparent text-base font-semibold text-[var(--color-text-primary)] focus:outline-none placeholder:text-[var(--color-muted)]/50"
                placeholder="Enter transaction description..."
                required
              />
            </div>

            {/* Place */}
            <div className="bg-[var(--ref-surface-container-lowest)] p-4 rounded-xl space-y-2 group hover:bg-[var(--ref-surface-container-low)] transition-colors">
              <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Place
              </label>
              <input
                type="text"
                {...editMetadataForm.register('place')}
                className="w-full bg-transparent text-sm font-semibold text-[var(--color-text-primary)] focus:outline-none placeholder:text-[var(--color-muted)]/50"
                placeholder="e.g. Starbucks, Indomaret, Online"
              />
            </div>

            {/* Reference */}
            <div className="bg-[var(--ref-surface-container-lowest)] p-4 rounded-xl space-y-2 group hover:bg-[var(--ref-surface-container-low)] transition-colors">
              <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
                <StickyNote className="w-3.5 h-3.5" />
                Reference
              </label>
              <input
                type="text"
                {...editMetadataForm.register('reference')}
                className="w-full bg-transparent text-sm font-semibold text-[var(--color-text-primary)] focus:outline-none placeholder:text-[var(--color-muted)]/50"
                placeholder="e.g. receipt or bank reference"
                maxLength={500}
              />
            </div>

            {/* Tags */}
            <div className="bg-[var(--ref-surface-container-lowest)] p-4 rounded-xl space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
                <TagIcon className="w-3.5 h-3.5" />
                Tags
              </label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => {
                      const next = editMetadataTagIds.includes(tag.id)
                        ? editMetadataTagIds.filter((id) => id !== tag.id)
                        : [...editMetadataTagIds, tag.id];
                      editMetadataForm.setValue('tagIds', next, { shouldDirty: true });
                    }}
                    className={cn(
                      'cursor-pointer px-2.5 py-1 text-xs rounded-full border transition-all',
                      editMetadataTagIds.includes(tag.id)
                        ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)] shadow-sm'
                        : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/40 bg-[var(--ref-surface-container)]',
                    )}
                  >
                    {tag.name}
                  </button>
                ))}
                {tags.length === 0 && (
                  <span className="text-xs text-[var(--color-muted)]">No tags available</span>
                )}
              </div>
            </div>

            {/* Notes - Full Width */}
            <div className="md:col-span-2 bg-[var(--ref-surface-container-lowest)] p-5 rounded-xl space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
                <StickyNote className="w-3.5 h-3.5" />
                Memo
              </label>
              <textarea
                className="w-full min-h-[100px] rounded-lg bg-transparent px-2 py-1 text-sm text-[var(--color-text-primary)] focus:outline-none placeholder:text-[var(--color-muted)]/50 resize-none"
                placeholder="Write a note..."
                {...editMetadataForm.register('notes')}
              />
            </div>
          </div>

          {formError && (
            <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-sm">
              <StickyNote className="w-4 h-4" />
              {formError}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-[var(--color-border)]">
            <Button type="submit" isLoading={isSubmitting} className="flex-1 rounded-full py-3.5 shadow-lg shadow-[var(--color-primary)]/20">
              <Save className="w-4 h-4 mr-2" />
              Save changes
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} className="rounded-full py-3.5">
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    );
  }

  const transferWalletAccounts = walletAccounts.filter((account) => !isPaylaterAccount(account.id.toString()));
  const transferAccountChoices = (_selectedId: string, showAll: boolean) =>
    showAll ? transferWalletAccounts : transferWalletAccounts.slice(0, 3);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add transaction"
      subtitle="Create a detailed record for your books."
      size="xl"
      headerExtra={
        <button
          type="button"
          onClick={() => {
            if (inputMode === 'simple') setInputMode('ai');
            else if (inputMode === 'ai') setInputMode('journal');
            else setInputMode('simple');
          }}
          className="cursor-pointer group inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] transition-colors hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)]"
          title="Cycle through input modes"
        >
          {inputMode === 'simple' && <><Sparkles className="h-3.5 w-3.5 opacity-70 transition-opacity group-hover:opacity-100" /> AI</>}
          {inputMode === 'ai' && <><Calculator className="h-3.5 w-3.5 opacity-70 transition-opacity group-hover:opacity-100" /> Journal</>}
          {inputMode === 'journal' && <><ArrowRightLeft className="h-3.5 w-3.5 opacity-70 transition-opacity group-hover:opacity-100" /> Simple</>}
        </button>
      }
    >
      {inputMode === 'journal' ? (
        <form onSubmit={handleJournalSubmit} className="flex flex-col gap-0">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
          <div className="lg:col-span-8 space-y-6 lg:space-y-8">
            <div>
              <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                Date &amp; time
              </label>
              <input
                type="datetime-local"
                value={journalValues.dateTime}
                onChange={(e) => journalForm.setValue('dateTime', e.target.value, { shouldDirty: true })}
                className={cn('brutalist-input w-full', stitchSelect)}
                required
              />
            </div>

            <Input
              label="Description"
              value={journalValues.description}
              onChange={(e) => journalForm.setValue('description', e.target.value, { shouldDirty: true })}
              placeholder="e.g., Monthly salary payment"
              className="rounded-xl border-none bg-[var(--ref-surface-container-low)] px-3 py-3"
              required
            />

            <div className="space-y-2">
              <label className="text-sm font-semibold text-[var(--color-text-primary)]">
                Journal lines (debits = credits)
              </label>
              {journalLines.fields.map((field, index) => {
                const line = journalValues.lines[index] ?? field;
                return <div key={field.id} className="flex gap-2 items-start flex-wrap">
                  {(() => {
                    const selectedAccount = allAccountsForJournal.find((account) => account.id.toString() === line.accountId);
                    return <>
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
                  {selectedAccount?.liquidityClass === 'cash_equivalent' && (
                    <Select
                      value={line.cashFlowClass}
                      onChange={(e) => updateJournalLine(index, 'cashFlowClass', e.target.value)}
                      options={[
                        { value: '', label: 'Cash flow…' },
                        { value: 'operating', label: 'Operating' },
                        { value: 'investing', label: 'Investing' },
                        { value: 'financing', label: 'Financing' },
                        { value: 'transfer', label: 'Internal transfer' },
                      ]}
                      className={cn('w-40', stitchSelect)}
                    />
                  )}
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
                    className="cursor-pointer p-2 rounded-lg hover:bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                    </>;
                  })()}
                </div>;
              })}
              <Button type="button" variant="secondary" onClick={addJournalLine} size="sm" className="rounded-full">
                <Plus className="w-4 h-4 mr-1" />
                Add line
              </Button>
            </div>

            <div className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <label className="text-sm font-semibold text-[var(--color-text-primary)]">Category allocations</label>
                  <p className="mt-1 text-xs text-[var(--color-muted)]">Split the journal's net expense across categories. Refunds can use negative amounts.</p>
                </div>
                <Button type="button" variant="secondary" onClick={addCategoryAllocation} size="sm" className="shrink-0 rounded-full">
                  <Plus className="mr-1 h-4 w-4" /> Add category
                </Button>
              </div>
              {journalValues.categoryAllocations.length === 0 ? (
                <p className="text-xs text-[var(--color-muted)]">No split added. Expense journals must add allocations before recording.</p>
              ) : journalAllocations.fields.map((field, index) => {
                const allocation = journalValues.categoryAllocations[index] ?? field;
                return <div key={field.id} className="flex flex-wrap items-center gap-2">
                  <Select
                    value={allocation.categoryId}
                    onChange={(e) => updateCategoryAllocation(index, 'categoryId', e.target.value)}
                    options={[{ value: '', label: 'Category...' }, ...categories.map((category) => ({ value: category.id.toString(), label: category.name }))]}
                    className={cn('min-w-[180px] flex-1', stitchSelect)}
                  />
                  <Input
                    type="number"
                    value={allocation.amount}
                    onChange={(e) => updateCategoryAllocation(index, 'amount', e.target.value)}
                    placeholder="Amount"
                    className="w-32 rounded-xl"
                  />
                  <button type="button" onClick={() => removeCategoryAllocation(index)} className="rounded-lg p-2 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10" aria-label="Remove category allocation">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>;
              })}
              {(() => {
                const netExpense = calculateJournalNetExpense();
                const allocated = journalValues.categoryAllocations.reduce((sum, allocation) => sum + (parseInt(allocation.amount, 10) || 0), 0);
                return <p className={cn('text-xs font-semibold', netExpense === allocated ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]')}>
                  Allocated {formatCurrency(allocated)} · Net expense {formatCurrency(netExpense)}
                </p>;
              })()}
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
                value={journalValues.place}
                onChange={(e) => journalForm.setValue('place', e.target.value, { shouldDirty: true })}
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
                  value={journalValues.notes}
                  onChange={(e) => journalForm.setValue('notes', e.target.value, { shouldDirty: true })}
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
                        const next = journalValues.tagIds.includes(tag.id)
                          ? journalValues.tagIds.filter((id) => id !== tag.id)
                          : [...journalValues.tagIds, tag.id];
                        journalForm.setValue('tagIds', next, { shouldDirty: true });
                      }}
                      className={cn(
                        'cursor-pointer px-3 py-1.5 text-xs rounded-full border-2 transition-colors',
                        journalValues.tagIds.includes(tag.id)
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
      ) : inputMode === 'ai' ? (
        <div className="flex flex-col gap-4">
          {!aiParsed ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!aiInput.trim()) return;
                setIsParsing(true);
                setParseError('');
                try {
                  const result = await previewPendingMutation.mutateAsync(aiInput);
                  if (result.parsed && result.parsed.confidence > 0) {
                    setAiParsed(result.parsed);
                  } else {
                    setParseError('Failed to parse transaction');
                  }
                } catch (err) {
                  setParseError(err instanceof Error ? err.message : 'Failed to parse');
                } finally {
                  setIsParsing(false);
                }
              }}
              className="flex flex-col gap-4"
            >
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                  Describe your transaction
                </label>
                <textarea
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  placeholder="e.g., Makan siang di McD 45rb, belanja grocery di Indomaret 150rb untuk minggu ini"
                  className="w-full h-32 bg-[var(--ref-surface-container-low)] border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-[var(--color-accent)]/20 text-[var(--color-text-primary)] transition-all resize-none"
                />
              </div>
              {parseError && (
                <p className="text-red-500 text-sm">{parseError}</p>
              )}
              <div className="flex justify-end">
                <Button type="submit" isLoading={isParsing} className="rounded-full">
                  <Sparkles className="w-4 h-4" />
                  Parse
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="p-4 bg-[var(--ref-surface-container-low)] rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--color-muted)]">Type</span>
                  <span className="font-medium capitalize">{aiParsed.type}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--color-muted)]">Amount</span>
                  <span className="font-medium">{formatCurrency(aiParsed.amount)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--color-muted)]">Category</span>
                  <span className="font-medium">{aiParsed.category}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--color-muted)]">Description</span>
                  <span className="font-medium">{aiParsed.description}</span>
                </div>
                {aiParsed.date && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--color-muted)]">Date</span>
                    <span className="font-medium">{aiParsed.date}</span>
                  </div>
                )}
                {aiParsed.place && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--color-muted)]">Place</span>
                    <span className="font-medium">{aiParsed.place}</span>
                  </div>
                )}
                {aiParsed.fromAccount && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--color-muted)]">Account</span>
                    <span className="font-medium">{aiParsed.fromAccount}</span>
                  </div>
                )}
                {aiParsed.toAccount && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--color-muted)]">To Account</span>
                    <span className="font-medium">{aiParsed.toAccount}</span>
                  </div>
                )}
                {aiParsed.memo && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--color-muted)]">Memo</span>
                    <span className="font-medium">{aiParsed.memo}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--color-muted)]">Confidence</span>
                  <span className="font-medium">{Math.round(aiParsed.confidence * 100)}%</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setAiParsed(null);
                    setAiInput('');
                    setParseError('');
                  }}
                  className="flex-1 rounded-full"
                >
                  Try Again
                </Button>
                <Button
                  type="button"
                  isLoading={isConfirming}
                  onClick={async () => {
                    if (!aiParsed) return;
                    setIsConfirming(true);
                    try {
                      await createPendingMutation.mutateAsync({ message: aiInput, parsed: aiParsed });
                      onSaved();
                      onClose();
                    } catch (err) {
                      setParseError(err instanceof Error ? err.message : 'Failed to create pending transaction');
                    } finally {
                      setIsConfirming(false);
                    }
                  }}
                  className="flex-1 rounded-full"
                >
                  Confirm
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={handleSimpleSubmit} className="flex flex-col gap-0">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
          <div className="lg:col-span-8 space-y-6 lg:space-y-8">
            <div className="grid grid-cols-2 sm:grid-cols-4 p-1 bg-[var(--ref-surface-container)] rounded-2xl gap-1">
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
                  onClick={() => {
                    if (t.value !== 'transfer') setTransferFeeControlsOpen(false);
                    setSimpleForm(() => {
                      const generated = t.value === 'transfer'
                        ? defaultTransferDescription(simpleForm.fromAccountId, simpleForm.toAccountId)
                        : '';
                      autoTransferDescriptionRef.current = generated;
                      return {
                        ...simpleForm,
                        type: t.value,
                        description: t.value === 'transfer' && generated ? generated : simpleForm.description,
                        paylaterRecognitionId:
                          t.value === 'paylater' ? simpleForm.paylaterRecognitionId : '',
                      };
                    });
                  }}
                  className={cn(
                    'cursor-pointer w-full min-w-0 inline-flex items-center justify-center gap-1.5 px-2 sm:px-3 py-2.5 rounded-xl sm:rounded-full text-xs sm:text-sm transition-all',
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
              hintInline={simpleForm.type === 'transfer'}
              hint={simpleForm.type === 'transfer' ? (() => {
                const details = calculateTransferDetails();
                return details && !('error' in details) && details.fee > 0
                  ? `* ${formatCurrency(details.fee)} transfer fee from ${details.senderPays ? 'sender' : 'recipient'}`
                  : undefined;
              })() : undefined}
            />

            <div className="relative grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
              {simpleForm.type !== 'transfer' && <div className="md:col-span-2 space-y-2">
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
                {categoryRecommendation && (
                  <button
                    type="button"
                    onClick={applyCategoryRecommendation}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] text-sm hover:bg-[var(--color-accent)]/20 transition-colors"
                  >
                    <span>Recommend:</span>
                    <span className="font-medium">{categoryRecommendation.categoryName}</span>
                    <span className="text-xs opacity-70">(click to apply)</span>
                  </button>
                )}
                {isLoadingRecommendation && !categoryRecommendation && (
                  <p className="text-xs text-[var(--color-muted)]">Getting category recommendation...</p>
                )}
              </div>}
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
              {simpleForm.type === 'transfer' && <div className="md:absolute md:left-1/2 md:right-0 md:top-0 md:z-20">
                <TransferFeePanel
                  details={calculateTransferDetails() as TransferFeeDetails | { error: string } | null}
                  manualPayerOverride={simpleForm.transferFeePayerOverride}
                  controlsOpen={transferFeeControlsOpen}
                  transferAdminFee={simpleForm.transferAdminFee}
                  onToggleControls={() => setTransferFeeControlsOpen((open) => !open)}
                  onFeeChange={(value) => setSimpleForm({ ...simpleForm, transferAdminFee: value })}
                  onPayerChange={(value) => setSimpleForm({ ...simpleForm, transferFeePayerOverride: value })}
                />
              </div>}
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
                            'cursor-pointer py-2 rounded-lg text-sm font-medium transition-all border-2 text-center w-full',
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
                      onChange={(e) => {
                        setSimpleForm({ ...simpleForm, categoryId: e.target.value });
                        setCategoryRecommendation(null);
                      }}
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
                    <div className="md:col-span-2 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">Saved route</label>
                        {simpleForm.origin && simpleForm.destination && (
                          <button
                            type="button"
                            onClick={() => openRouteTemplateEditor('save')}
                            className="text-xs font-semibold text-[var(--color-accent)] hover:underline"
                          >
                            Save as new route
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="relative min-w-0 flex-1">
                          <select
                            value={selectedRouteTemplateId?.toString() ?? ''}
                            onChange={(event) => {
                              const selected = routeTemplates.find((template) => template.id === Number(event.target.value));
                              setSelectedRouteTemplateId(selected?.id ?? null);
                              if (selected) applyRouteTemplate(selected);
                              else {
                                setRouteTemplateName('');
                                setRouteTemplateEditorMode(null);
                              }
                            }}
                            disabled={routeTemplates.length === 0}
                            className={cn('w-full appearance-none', stitchSelect, routeTemplates.length === 0 && 'cursor-not-allowed opacity-60')}
                          >
                            <option value="">{routeTemplates.length ? 'Choose a saved route…' : 'No saved routes yet'}</option>
                            {routeTemplates.map((template) => (
                              <option key={template.id} value={template.id}>{template.name}</option>
                            ))}
                          </select>
                          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-muted)] text-lg">▾</span>
                        </div>
                        {selectedRouteTemplateId && (
                          <>
                            <button type="button" onClick={() => openRouteTemplateEditor('rename')} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--ref-surface-container-low)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)]" title="Rename saved route" aria-label="Rename saved route">
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={deleteRouteTemplate} disabled={isUpdatingRouteTemplate} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--ref-surface-container-low)] text-[var(--color-text-secondary)] transition-colors hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50" title="Delete saved route" aria-label="Delete saved route">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                      {routeTemplateEditorMode && (
                        <div className="flex flex-col gap-2 rounded-xl bg-[var(--ref-surface-container-low)] p-2 sm:flex-row sm:items-center">
                          <input
                            autoFocus
                            type="text"
                            value={routeTemplateName}
                            onChange={(event) => setRouteTemplateName(event.target.value)}
                            placeholder="Route name"
                            maxLength={150}
                            className={cn('min-w-0 flex-1', stitchSelect)}
                          />
                          <div className="flex items-center justify-end gap-2">
                            <button type="button" onClick={closeRouteTemplateEditor} disabled={isSavingRouteTemplate || isUpdatingRouteTemplate} className="px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">Cancel</button>
                            <button
                              type="button"
                              onClick={routeTemplateEditorMode === 'save' ? saveCurrentRouteTemplate : renameRouteTemplate}
                              disabled={!routeTemplateName.trim() || isSavingRouteTemplate || isUpdatingRouteTemplate}
                              className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              {isSavingRouteTemplate || isUpdatingRouteTemplate ? 'Saving…' : routeTemplateEditorMode === 'save' ? 'Save route' : 'Rename'}
                            </button>
                          </div>
                        </div>
                      )}
                      <p className="text-xs text-[var(--color-text-secondary)]">Reuse the route details and enter this trip’s fare separately.</p>
                    </div>
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
                  <div className={cn('grid grid-cols-2 sm:grid-cols-4 gap-3 overflow-hidden transition-[max-height] duration-300 ease-out', showAllTransferFromAccounts ? 'max-h-[1000px]' : 'max-h-[180px]')}>
                    {transferAccountChoices(simpleForm.fromAccountId, showAllTransferFromAccounts).map((a, idx) =>
                      renderWalletCard(a, idx, simpleForm.fromAccountId === a.id.toString(), () =>
                        setSimpleForm({ ...simpleForm, fromAccountId: a.id.toString() }),
                        true,
                      ),
                    )}
                    {transferWalletAccounts.length > 3 && <button type="button" onClick={() => setShowAllTransferFromAccounts((show) => !show)} aria-expanded={showAllTransferFromAccounts} className="min-h-[72px] w-full rounded-xl border-2 border-dashed border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-accent)] transition-colors hover:bg-[var(--ref-surface-container-low)]">{showAllTransferFromAccounts ? 'Show less' : `+${transferWalletAccounts.length - 3} more`}</button>}
                  </div>
                </div>
                <div className="space-y-4">
                  <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                    To account
                  </label>
                  <div className={cn('grid grid-cols-2 sm:grid-cols-4 gap-3 overflow-hidden transition-[max-height] duration-300 ease-out', showAllTransferToAccounts ? 'max-h-[1000px]' : 'max-h-[180px]')}>
                    {transferAccountChoices(simpleForm.toAccountId, showAllTransferToAccounts).map((a, idx) =>
                      renderWalletCard(a, idx, simpleForm.toAccountId === a.id.toString(), () =>
                        setSimpleForm({ ...simpleForm, toAccountId: a.id.toString() }),
                        true,
                        a.id.toString() === simpleForm.fromAccountId,
                        'Same as source account',
                      ),
                    )}
                    {transferWalletAccounts.length > 3 && <button type="button" onClick={() => setShowAllTransferToAccounts((show) => !show)} aria-expanded={showAllTransferToAccounts} className="min-h-[72px] w-full rounded-xl border-2 border-dashed border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-accent)] transition-colors hover:bg-[var(--ref-surface-container-low)]">{showAllTransferToAccounts ? 'Show less' : `+${transferWalletAccounts.length - 3} more`}</button>}
                  </div>
                </div>

              </>
            )}
          </div>

          <div className="lg:col-span-4 space-y-6">
            <div className="bg-[var(--ref-surface-container-low)] rounded-xl p-5 space-y-6">
              <h3 className="text-base font-bold text-[var(--color-text-primary)] font-headline">
                Advanced options
              </h3>

              <div className="space-y-3 opacity-60">
                {simpleForm.type === 'expense' && (
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
                )}
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

              {simpleForm.type === 'expense' && (
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
              )}

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
            {pendingTransaction ? (
              <div className="flex gap-2 w-full max-w-md mx-auto">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    if (!pendingTransaction) return;
                    setIsSubmitting(true);
                    try {
                      await updatePendingMutation.mutateAsync({ id: pendingTransaction.id, parsed: {
                        type: simpleForm.type === 'expense' ? 'expense' : simpleForm.type === 'income' ? 'income' : 'transfer',
                        amount: parseIdNominalToInt(simpleForm.amount) || 0,
                        description: simpleForm.description,
                        category: categories.find(c => c.id.toString() === simpleForm.categoryId)?.name || 'Others',
                        date: simpleForm.dateTime.split('T')[0],
                        place: simpleForm.place || undefined,
                        memo: simpleForm.notes || undefined,
                        fromAccount: accounts.find(a => a.id.toString() === simpleForm.fromAccountId)?.name,
                        toAccount: accounts.find(a => a.id.toString() === simpleForm.toAccountId)?.name,
                        confidence: 1,
                      }});
                      onSaved();
                      onClose();
                    } catch (err) {
                      setFormError(err instanceof Error ? err.message : 'Failed to save');
                    } finally {
                      setIsSubmitting(false);
                    }
                  }}
                  isLoading={isSubmitting}
                  className="flex-1 rounded-full"
                >
                  Save & Keep Pending
                </Button>
                <Button
                  type="button"
                  onClick={async () => {
                    if (!pendingTransaction) return;
                    setIsSubmitting(true);
                    try {
                      await updatePendingMutation.mutateAsync({ id: pendingTransaction.id, parsed: {
                        type: simpleForm.type === 'expense' ? 'expense' : simpleForm.type === 'income' ? 'income' : 'transfer',
                        amount: parseIdNominalToInt(simpleForm.amount) || 0,
                        description: simpleForm.description,
                        category: categories.find(c => c.id.toString() === simpleForm.categoryId)?.name || 'Others',
                        date: simpleForm.dateTime.split('T')[0],
                        place: simpleForm.place || undefined,
                        memo: simpleForm.notes || undefined,
                        fromAccount: accounts.find(a => a.id.toString() === simpleForm.fromAccountId)?.name,
                        toAccount: accounts.find(a => a.id.toString() === simpleForm.toAccountId)?.name,
                        confidence: 1,
                      }});
                      await approvePendingMutation.mutateAsync(pendingTransaction.id);
                      onSaved();
                      onClose();
                    } catch (err) {
                      setFormError(err instanceof Error ? err.message : 'Failed to approve');
                    } finally {
                      setIsSubmitting(false);
                    }
                  }}
                  isLoading={isSubmitting}
                  className="flex-1 rounded-full"
                >
                  Approve
                </Button>
              </div>
            ) : (
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
            )}
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
                className="cursor-pointer p-2 hover:bg-[var(--ref-surface-container-high)] rounded-full transition-colors"
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
                    className="cursor-pointer px-6 py-2 bg-[var(--color-primary)] text-white rounded-full"
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
                className="cursor-pointer px-6 py-2 bg-[var(--ref-surface-container-high)] hover:bg-[var(--ref-surface-container)] rounded-full text-sm font-semibold transition-colors"
              >
                Open in New Tab
              </button>
              <button
                onClick={() => setPreviewAttachment(null)}
                className="cursor-pointer px-6 py-2 bg-[var(--color-primary)] text-white rounded-full text-sm font-semibold hover:opacity-90 transition-opacity"
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
