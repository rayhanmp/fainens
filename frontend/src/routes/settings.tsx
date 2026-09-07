import { Link, createFileRoute } from '@tanstack/react-router';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { RequireAuth } from '../lib/auth';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type AgentMemory } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAccountsLedgerQuery } from '../features/accounts/queries';
import { useAgentMemoriesQuery } from '../features/agent/queries';
import { agentCommands } from '../features/agent/commands';
import { queryKeys } from '../features/core/query-keys';
import { cn } from '../lib/utils';
import { loadTransferFeeRules, saveTransferFeeRules, type TransferFeePayer, type TransferFeeRule } from '../lib/transferFees';
import { birthdayPassword, passwordFormatDescription, type PdfPasswordFormat } from '../lib/reportSecurity';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { useTheme } from '../hooks/useTheme';
import { useExportDataMutation, type ExportSelection } from '../features/settings/queries';
import {
  DollarSign,
  Percent,
  Calendar,
  Database,
  Trash2,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  CreditCard,
  User,
  Settings2,
  Palette,
  Download,
  Upload,
  ChevronRight,
  Moon,
  Sun,
  Monitor,
  Check,
  Brain,
  Pencil,
  ArrowRightLeft,
  Plus,
  LockKeyhole,
} from 'lucide-react';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
} as any);

interface AppSettings {
  currency: string;
  dateFormat: string;
  opportunityCostYield: number;
  salaryDay: number;
  defaultBankAccountId: number | null;
  defaultExpenseAccountId: number | null;
  defaultIncomeAccountId: number | null;
  theme: 'light' | 'dark' | 'auto';
  transferFeeRules: TransferFeeRule[];
  pdfPasswordEnabled: boolean;
  birthDate: string;
  pdfPasswordFormat: PdfPasswordFormat;
}

interface ExportOptions {
  transactions: boolean;
  accounts: boolean;
  categories: boolean;
  budgets: boolean;
  settings: boolean;
  memories: boolean;
}

type TabType = 'general' | 'accounts' | 'appearance' | 'memory' | 'agent' | 'data';

type AgentModel = {
  id: number;
  name: string;
  model: string;
  baseUrl: string;
  isDefault: boolean;
  apiKeyConfigured: boolean;
  apiKeySource: 'database' | 'environment' | 'none';
  createdAt: number | string;
  updatedAt: number | string;
};

const CURRENCIES = [
  { value: 'IDR', label: 'Rp (IDR - Indonesian Rupiah)', symbol: 'Rp' },
  { value: 'USD', label: '$ (USD - US Dollar)', symbol: '$' },
  { value: 'EUR', label: '€ (EUR - Euro)', symbol: '€' },
  { value: 'GBP', label: '£ (GBP - British Pound)', symbol: '£' },
  { value: 'JPY', label: '¥ (JPY - Japanese Yen)', symbol: '¥' },
  { value: 'SGD', label: 'S$ (SGD - Singapore Dollar)', symbol: 'S$' },
  { value: 'MYR', label: 'RM (MYR - Malaysian Ringgit)', symbol: 'RM' },
];

const DATE_FORMATS = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/12/2024)' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/31/2024)' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2024-12-31)' },
  { value: 'DD MMM YYYY', label: 'DD MMM YYYY (31 Dec 2024)' },
];

const TABS: { id: TabType; label: string; icon: React.ElementType }[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'accounts', label: 'Accounts', icon: CreditCard },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'memory', label: 'Agent memory', icon: Brain },
  { id: 'agent', label: 'Agent provider', icon: Brain },
  { id: 'data', label: 'Data', icon: Database },
];

function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { logout, user } = useAuth();
  const exportDataMutation = useExportDataMutation();
  const queryClient = useQueryClient();
  const accountsQuery = useAccountsLedgerQuery();
  const memoriesQuery = useAgentMemoriesQuery();
  const [settings, setSettings] = useState<AppSettings>({
    currency: 'IDR',
    dateFormat: 'DD/MM/YYYY',
    opportunityCostYield: 4.0,
    salaryDay: 25,
    defaultBankAccountId: null,
    defaultExpenseAccountId: null,
    defaultIncomeAccountId: null,
    theme: 'auto',
    transferFeeRules: [],
    pdfPasswordEnabled: false,
    birthDate: '',
    pdfPasswordFormat: 'DDMMYYYY',
  });
  const reportPassword = birthdayPassword(settings.birthDate, settings.pdfPasswordFormat);
  const accounts = (accountsQuery.data ?? []).map(({ id, name, type, systemKey }) => ({ id, name, type, systemKey }));
  const memories = memoriesQuery.data?.memories ?? [];
  const memoryLimits = memoriesQuery.data?.limits ?? { maxItems: 50, maxLabelLength: 80, maxContentLength: 1000 };
  const [memoryLabel, setMemoryLabel] = useState('');
  const [memoryContent, setMemoryContent] = useState('');
  const [editingMemoryId, setEditingMemoryId] = useState<number | null>(null);
  const isLoadingMemories = memoriesQuery.isPending && !memoriesQuery.data;
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showClearCacheModal, setShowClearCacheModal] = useState(false);
  const [showDeleteDataModal, setShowDeleteDataModal] = useState(false);
  const [showExportSuccess, setShowExportSuccess] = useState(false);
  const [agentProviderBusy, setAgentProviderBusy] = useState(false);
  const [agentProviderNotice, setAgentProviderNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [agentModels, setAgentModels] = useState<AgentModel[]>([]);
  const [agentModelDraft, setAgentModelDraft] = useState({ name: '', model: '', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '' });
  const [editingAgentModelId, setEditingAgentModelId] = useState<number | null>(null);
  const [feeRuleFrom, setFeeRuleFrom] = useState('');
  const [feeRuleTo, setFeeRuleTo] = useState('');
  const [feeRuleAmount, setFeeRuleAmount] = useState('');
  const [feeRulePayer, setFeeRulePayer] = useState<TransferFeePayer>('sender');
  const { confirm } = useConfirm();
  
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    transactions: true,
    accounts: true,
    categories: true,
    budgets: true,
    settings: true,
    memories: true,
  });
  
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadSettings();
    void api.agentProvider.models.list().then(setAgentModels).catch(() => setAgentProviderNotice({ tone: 'error', text: 'Could not load Agent models.' }));
  }, []);

  const resetAgentModelDraft = () => {
    setEditingAgentModelId(null);
    setAgentModelDraft({ name: '', model: '', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '' });
  };

  const saveAgentModel = async () => {
    if (!agentModelDraft.name.trim() || !agentModelDraft.model.trim() || !agentModelDraft.baseUrl.trim()) return;
    setAgentProviderBusy(true);
    setAgentProviderNotice(null);
    try {
      if (editingAgentModelId == null) {
        await api.agentProvider.models.create({ name: agentModelDraft.name, model: agentModelDraft.model, baseUrl: agentModelDraft.baseUrl, ...(agentModelDraft.apiKey.trim() ? { apiKey: agentModelDraft.apiKey.trim() } : {}) });
      } else {
        await api.agentProvider.models.update(editingAgentModelId, { name: agentModelDraft.name, model: agentModelDraft.model, baseUrl: agentModelDraft.baseUrl, ...(agentModelDraft.apiKey.trim() ? { apiKey: agentModelDraft.apiKey.trim() } : {}) });
      }
      setAgentModels(await api.agentProvider.models.list());
      resetAgentModelDraft();
      setAgentProviderNotice({ tone: 'success', text: 'Agent model saved.' });
    } catch (error) { setAgentProviderNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save Agent model.' }); }
    finally { setAgentProviderBusy(false); }
  };

  const makeAgentModelDefault = async (id: number) => {
    setAgentProviderBusy(true);
    try { await api.agentProvider.models.setDefault(id); setAgentModels(await api.agentProvider.models.list()); setAgentProviderNotice({ tone: 'success', text: 'Default Agent model updated.' }); }
    catch (error) { setAgentProviderNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not set the default model.' }); }
    finally { setAgentProviderBusy(false); }
  };

  const clearAgentModelKey = async (id: number) => {
    setAgentProviderBusy(true);
    try { await api.agentProvider.models.update(id, { clearApiKey: true }); setAgentModels(await api.agentProvider.models.list()); setAgentProviderNotice({ tone: 'success', text: 'Stored key cleared. The environment fallback remains available.' }); }
    catch (error) { setAgentProviderNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not clear the stored key.' }); }
    finally { setAgentProviderBusy(false); }
  };

  const removeAgentModel = async (id: number) => {
    const model = agentModels.find((item) => item.id === id);
    if (!model) return;
    const confirmed = await confirm({ title: 'Delete Agent model?', message: `Remove “${model.name}” from your saved models?`, confirmLabel: 'Delete', variant: 'danger' });
    if (!confirmed) return;
    setAgentProviderBusy(true);
    try { await api.agentProvider.models.remove(id); setAgentModels(await api.agentProvider.models.list()); setAgentProviderNotice({ tone: 'success', text: 'Agent model deleted.' }); }
    catch (error) { setAgentProviderNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not delete the model.' }); }
    finally { setAgentProviderBusy(false); }
  };

  // Auto-save with 500ms debounce
  useEffect(() => {
    if (isLoading) return;
    
    setSaveStatus('saving');
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem('fainens-settings', JSON.stringify(settings));
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (err) {
        console.error('Failed to save settings:', err);
        setSaveStatus('idle');
      }
    }, 500);
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [settings, isLoading]);

  const loadSettings = async () => {
    try {
      const saved = localStorage.getItem('fainens-settings');
      const parsed = saved ? JSON.parse(saved) : {};

      setSettings({
        currency: parsed.currency || 'IDR',
        dateFormat: parsed.dateFormat || 'DD/MM/YYYY',
        opportunityCostYield: parsed.opportunityCostYield ?? 4.0,
        salaryDay: parsed.salaryDay || 25,
        defaultBankAccountId: parsed.defaultBankAccountId || null,
        defaultExpenseAccountId: parsed.defaultExpenseAccountId || null,
        defaultIncomeAccountId: parsed.defaultIncomeAccountId || null,
        theme: parsed.theme || 'auto',
        transferFeeRules: loadTransferFeeRules(),
        pdfPasswordEnabled: parsed.pdfPasswordEnabled === true,
        birthDate: typeof parsed.birthDate === 'string' ? parsed.birthDate : '',
        pdfPasswordFormat: parsed.pdfPasswordFormat === 'YYYYMMDD' ? 'YYYYMMDD' : 'DDMMYYYY',
      });
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const addTransferFeeRule = () => {
    const fromAccountId = Number(feeRuleFrom);
    const toAccountId = Number(feeRuleTo);
    const feeCents = Number(feeRuleAmount);
    if (!Number.isSafeInteger(fromAccountId) || !Number.isSafeInteger(toAccountId) || fromAccountId <= 0 || toAccountId <= 0 || fromAccountId === toAccountId) return;
    if (!Number.isSafeInteger(feeCents) || feeCents < 0) return;
    const nextRule: TransferFeeRule = { fromAccountId, toAccountId, feeCents, payer: feeRulePayer };
    const next = [...settings.transferFeeRules.filter((rule) => !(rule.fromAccountId === fromAccountId && rule.toAccountId === toAccountId)), nextRule];
    setSettings({ ...settings, transferFeeRules: next });
    saveTransferFeeRules(next);
    setFeeRuleFrom('');
    setFeeRuleTo('');
    setFeeRuleAmount('');
  };

  const removeTransferFeeRule = (rule: TransferFeeRule) => {
    const next = settings.transferFeeRules.filter((candidate) => candidate !== rule && !(candidate.fromAccountId === rule.fromAccountId && candidate.toAccountId === rule.toAccountId));
    setSettings({ ...settings, transferFeeRules: next });
    saveTransferFeeRules(next);
  };

  const resetMemoryForm = () => {
    setEditingMemoryId(null);
    setMemoryLabel('');
    setMemoryContent('');
  };

  const saveMemory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const label = memoryLabel.trim();
    const content = memoryContent.trim();
    if (!label || !content) {
      setMemoryError('Add a short name and the memory you want the agent to remember.');
      return;
    }
    setIsSavingMemory(true);
    setMemoryError(null);
    try {
      if (editingMemoryId == null) {
        await agentCommands.memories.create({ label, content });
      } else {
        await agentCommands.memories.update(editingMemoryId, { label, content });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.agent.memories });
      resetMemoryForm();
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : 'Could not save agent memory.');
    } finally {
      setIsSavingMemory(false);
    }
  };

  const editMemory = (memory: AgentMemory) => {
    setEditingMemoryId(memory.id);
    setMemoryLabel(memory.label);
    setMemoryContent(memory.content);
    setMemoryError(null);
  };

  const deleteMemory = async (memory: AgentMemory) => {
    const confirmed = await confirm({
      title: 'Delete personal memory',
      message: `Remove “${memory.label}” from the information supplied to the agent?`,
      confirmLabel: 'Delete memory',
      variant: 'danger',
    });
    if (!confirmed) return;
    setMemoryError(null);
    try {
      await agentCommands.memories.delete(memory.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.agent.memories });
      if (editingMemoryId === memory.id) resetMemoryForm();
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : 'Could not delete agent memory.');
    }
  };

  const getAccountOptions = (type?: string) => {
    const options = [{ value: '', label: 'None (Auto-select)' }];
    const filtered = type ? accounts.filter((a) => a.type === type) : accounts;
    return [
      ...options,
      ...filtered.map((a) => ({ value: a.id.toString(), label: a.name })),
    ];
  };

  const handleExport = useCallback(async () => {
    const exportData: any = {
      exportedAt: new Date().toISOString(),
      version: '1.0.0',
    };

    try {
      Object.assign(exportData, await exportDataMutation.mutateAsync(exportOptions as ExportSelection));
      if (exportOptions.settings) {
        exportData.settings = settings;
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fainens-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setShowExportSuccess(true);
      setTimeout(() => setShowExportSuccess(false), 3000);
    } catch (err) {
      alert('Failed to export data: ' + (err as Error).message);
    }
  }, [exportOptions, settings, exportDataMutation]);

  const handleImport = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      console.log('Import data preview:', Object.keys(data));
      
      // TODO: Implement import logic
      alert('Import functionality coming soon!');
    } catch (err) {
      alert('Failed to import file: ' + (err as Error).message);
    }
    
    // Reset input
    event.target.value = '';
  }, []);

  const handleClearCache = () => {
    localStorage.removeItem('fainens-cache');
    sessionStorage.clear();
    setShowClearCacheModal(false);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  const handleDeleteAllData = () => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = '/login';
  };

  if (isLoading) {
    return (
      <RequireAuth>
        <div className="flex items-center justify-center h-64">
          <p>Loading settings...</p>
        </div>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <PageContainer>
        {/* Header */}
        <div className="flex items-center justify-between">
          <PageHeader
            subtext="App configuration"
            title="Settings"
            description="Configure your app preferences"
          />
          <div className="flex items-center gap-3">
            {saveStatus !== 'idle' && (
              <div
                className={cn(
                  'flex items-center gap-2 px-4 py-2 border-2 text-sm font-medium transition-all duration-300',
                  saveStatus === 'saving'
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                    : 'border-[var(--color-success)] bg-[var(--color-success)]/10 text-[var(--color-success)]'
                )}
              >
                {saveStatus === 'saving' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>{saveStatus === 'saving' ? 'Saving...' : 'Saved!'}</span>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-[var(--color-border)]">
          <div className="flex gap-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={cn(
                  'cursor-pointer flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all duration-200 relative',
                  activeTab === id
                    ? 'text-[var(--color-accent)]'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
                {activeTab === id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-accent)]" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="transition-opacity duration-300">
          {/* General Tab */}
          {activeTab === 'general' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-300">
              <Card
                title={
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-5 h-5" />
                    Currency & Format
                  </div>
                }
              >
                <div className="space-y-4">
                  <Select
                    label="Currency"
                    value={settings.currency}
                    onChange={(e) => setSettings({ ...settings, currency: e.target.value })}
                    options={CURRENCIES.map((c) => ({ value: c.value, label: c.label }))}
                  />
                  <Select
                    label="Date Format"
                    value={settings.dateFormat}
                    onChange={(e) => setSettings({ ...settings, dateFormat: e.target.value })}
                    options={DATE_FORMATS.map((d) => ({ value: d.value, label: d.label }))}
                  />
                  <p className="text-xs text-[var(--color-muted)]">
                    These affect how amounts and dates are displayed throughout the app.
                  </p>
                </div>
              </Card>

              <Card
                title={
                  <div className="flex items-center gap-2">
                    <Percent className="w-5 h-5" />
                    Opportunity Cost
                  </div>
                }
              >
                <div className="space-y-4">
                  <Input
                    label="Baseline Yield (%)"
                    type="number"
                    value={settings.opportunityCostYield.toString()}
                    onChange={(e) =>
                      setSettings({ ...settings, opportunityCostYield: parseFloat(e.target.value) || 0 })
                    }
                    step="0.1"
                    min="0"
                    max="20"
                  />
                  <p className="text-xs text-[var(--color-muted)]">
                    Annual money market rate used for opportunity cost calculations in the simulator.
                  </p>
                </div>
              </Card>

              <Card
                title={
                  <div className="flex items-center gap-2">
                    <Calendar className="w-5 h-5" />
                    Salary Period
                  </div>
                }
              >
                <div className="space-y-4">
                  <Input
                    label="Salary Day of Month"
                    type="number"
                    value={settings.salaryDay.toString()}
                    onChange={(e) =>
                      setSettings({ ...settings, salaryDay: parseInt(e.target.value) || 1 })
                    }
                    min="1"
                    max="31"
                  />
                  <p className="text-xs text-[var(--color-muted)]">
                    Day of the month you receive your salary. Budget periods are calculated from this date.
                  </p>
                </div>
              </Card>
            </div>
          )}

          {/* Accounts Tab */}
          {activeTab === 'accounts' && (
            <div className="max-w-2xl space-y-6 animate-in fade-in duration-300">
              <Card
                title={
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5" />
                    Default Accounts
                  </div>
                }
              >
                <div className="space-y-4">
                  <Select
                    label="Default Bank Account"
                    value={settings.defaultBankAccountId?.toString() || ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        defaultBankAccountId: e.target.value ? parseInt(e.target.value) : null,
                      })
                    }
                    options={getAccountOptions('asset')}
                  />
                  <Select
                    label="Default Expense Account"
                    value={settings.defaultExpenseAccountId?.toString() || ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        defaultExpenseAccountId: e.target.value ? parseInt(e.target.value) : null,
                      })
                    }
                    options={getAccountOptions('expense')}
                  />
                  <Select
                    label="Default Income Account"
                    value={settings.defaultIncomeAccountId?.toString() || ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        defaultIncomeAccountId: e.target.value ? parseInt(e.target.value) : null,
                      })
                    }
                    options={getAccountOptions('revenue')}
                  />
                  <p className="text-xs text-[var(--color-muted)]">
                    These accounts will be pre-selected when creating transactions.
                  </p>
                </div>
              </Card>
              <Card
                title={
                  <div className="flex items-center gap-2">
                    <ArrowRightLeft className="w-5 h-5" />
                    Transfer fee defaults
                  </div>
                }
              >
                <div className="space-y-4">
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    Set a fee for a specific source-to-destination pair. The transfer form uses this amount automatically, and you can override it for an individual transfer.
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Select
                      label="From account"
                      value={feeRuleFrom}
                      onChange={(event) => setFeeRuleFrom(event.target.value)}
                      options={[
                        { value: '', label: 'Choose source…' },
                        ...accounts.filter((account) => account.type === 'asset' && !account.systemKey).map((account) => ({ value: String(account.id), label: account.name })),
                      ]}
                    />
                    <Select
                      label="To account"
                      value={feeRuleTo}
                      onChange={(event) => setFeeRuleTo(event.target.value)}
                      options={[
                        { value: '', label: 'Choose destination…' },
                        ...accounts.filter((account) => account.type === 'asset' && !account.systemKey).map((account) => ({ value: String(account.id), label: account.name })),
                      ]}
                    />
                    <Input
                      label="Fee (IDR)"
                      type="number"
                      min="0"
                      step="1"
                      value={feeRuleAmount}
                      onChange={(event) => setFeeRuleAmount(event.target.value)}
                      placeholder="e.g. 1000"
                    />
                    <Select
                      label="Who pays"
                      value={feeRulePayer}
                      onChange={(event) => setFeeRulePayer(event.target.value as TransferFeePayer)}
                      options={[{ value: 'sender', label: 'Sender' }, { value: 'recipient', label: 'Recipient' }]}
                    />
                  </div>
                  <Button type="button" onClick={addTransferFeeRule} disabled={!feeRuleFrom || !feeRuleTo || !feeRuleAmount}>
                    <Plus className="h-4 w-4" /> Save pair default
                  </Button>
                  {settings.transferFeeRules.length > 0 ? (
                    <div className="divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)]">
                      {settings.transferFeeRules.map((rule) => (
                        <div key={`${rule.fromAccountId}-${rule.toAccountId}`} className="flex items-center justify-between gap-3 p-3 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{accounts.find((account) => account.id === rule.fromAccountId)?.name ?? `Account #${rule.fromAccountId}`} → {accounts.find((account) => account.id === rule.toAccountId)?.name ?? `Account #${rule.toAccountId}`}</p>
                            <p className="text-xs text-[var(--color-text-secondary)]">{rule.feeCents.toLocaleString('id-ID')} IDR · paid by {rule.payer}</p>
                          </div>
                          <Button type="button" size="sm" variant="danger" onClick={() => removeTransferFeeRule(rule)}>
                            <Trash2 className="h-3.5 w-3.5" /> Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--color-muted)]">No pair defaults yet. Built-in provider defaults still apply where recognized.</p>
                  )}
                </div>
              </Card>
            </div>
          )}

          {/* Appearance Tab */}
          {activeTab === 'appearance' && (
            <div className="max-w-2xl animate-in fade-in duration-300">
              <Card
                title={
                  <div className="flex items-center gap-2">
                    <Palette className="w-5 h-5" />
                    Theme
                  </div>
                }
              >
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { value: 'light', label: 'Light', icon: Sun },
                      { value: 'dark', label: 'Dark', icon: Moon },
                      { value: 'auto', label: 'Auto', icon: Monitor },
                    ].map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => setTheme(value as 'light' | 'dark' | 'auto')}
                        className={cn(
                          'cursor-pointer flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all',
                          theme === value
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                            : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/50'
                        )}
                      >
                        <Icon className="w-6 h-6" />
                        <span className="text-sm font-medium">{label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-[var(--color-muted)]">
                    Auto follows your system preference.
                  </p>
                </div>
              </Card>
            </div>
          )}

          {/* Agent provider Tab */}
          {activeTab === 'agent' && (
            <div className="max-w-3xl space-y-6 animate-in fade-in duration-300">
              <Card title={<div className="flex items-center gap-2"><Brain className="w-5 h-5" /> Agent models</div>}>
                <div className="space-y-5">
                  <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">Save the models you use with a friendly name and an OpenAI-compatible base URL. API keys are optional, encrypted on the server, and never returned to this page. If a model has no stored key, the server environment key is used when available.</p>
                  <div className="space-y-3">
                    {agentModels.length === 0 && <p className="rounded-lg bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-secondary)]">No saved models yet. Add one below; the first model becomes the default.</p>}
                    {agentModels.map((model) => <div key={model.id} className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold">{model.name}</p>{model.isDefault && <span className="rounded-full bg-[var(--ref-primary)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--ref-primary)]">Default</span>}</div><p className="mt-1 truncate font-mono text-xs text-[var(--color-text-secondary)]">{model.model}</p><p className="mt-1 truncate text-xs text-[var(--color-muted)]">{model.baseUrl} · key {model.apiKeyConfigured ? `configured via ${model.apiKeySource}` : 'not configured'}</p></div>
                      <div className="flex shrink-0 flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => { setEditingAgentModelId(model.id); setAgentModelDraft({ name: model.name, model: model.model, baseUrl: model.baseUrl, apiKey: '' }); }}>Edit</Button>{model.apiKeySource === 'database' && <Button type="button" size="sm" variant="secondary" onClick={() => void clearAgentModelKey(model.id)} disabled={agentProviderBusy}>Clear key</Button>}{!model.isDefault && <Button type="button" size="sm" variant="secondary" onClick={() => void makeAgentModelDefault(model.id)} disabled={agentProviderBusy}>Make default</Button>}<Button type="button" size="sm" variant="danger" onClick={() => void removeAgentModel(model.id)} disabled={agentProviderBusy}>Delete</Button></div>
                    </div>)}
                  </div>
                  <div className="border-t border-[var(--color-border)] pt-5"><p className="mb-3 text-sm font-bold">{editingAgentModelId == null ? 'Add model' : 'Edit model'}</p><div className="grid gap-3 sm:grid-cols-2"><Input label="Name" value={agentModelDraft.name} onChange={(event) => setAgentModelDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="e.g. Fast daily model" maxLength={120} /><Input label="Model ID" value={agentModelDraft.model} onChange={(event) => setAgentModelDraft((draft) => ({ ...draft, model: event.target.value }))} placeholder="e.g. z-ai/glm-5.3-flash" maxLength={200} /><div className="sm:col-span-2"><Input label="Base URL" value={agentModelDraft.baseUrl} onChange={(event) => setAgentModelDraft((draft) => ({ ...draft, baseUrl: event.target.value }))} placeholder="https://openrouter.ai/api/v1" maxLength={500} /></div><div className="sm:col-span-2 space-y-1"><label htmlFor="agent-model-api-key" className="block text-sm font-medium text-[var(--color-text-secondary)]">API key (optional)</label><input id="agent-model-api-key" type="password" value={agentModelDraft.apiKey} onChange={(event) => setAgentModelDraft((draft) => ({ ...draft, apiKey: event.target.value }))} placeholder={editingAgentModelId == null ? 'Leave blank to use the server environment key' : 'Leave blank to keep the stored key'} autoComplete="new-password" className="brutalist-input" /></div></div><div className="mt-4 flex flex-wrap gap-2"><Button type="button" onClick={() => void saveAgentModel()} disabled={agentProviderBusy || !agentModelDraft.name.trim() || !agentModelDraft.model.trim() || !agentModelDraft.baseUrl.trim()}>{agentProviderBusy ? 'Saving…' : editingAgentModelId == null ? 'Add model' : 'Save changes'}</Button>{editingAgentModelId != null && <Button type="button" variant="secondary" onClick={resetAgentModelDraft}>Cancel</Button>}</div></div>
                  {agentProviderNotice && <p role="status" className={cn('rounded-lg border p-3 text-sm', agentProviderNotice.tone === 'success' ? 'border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[var(--color-success)]' : 'border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 text-[var(--color-danger)]')}>{agentProviderNotice.text}</p>}
                </div>
              </Card>
            </div>
          )}

          {/* Agent memory Tab */}
          {activeTab === 'memory' && (
            <div className="max-w-3xl space-y-6 animate-in fade-in duration-300">
              <Card
                title={
                  <div className="flex items-center gap-2">
                    <Brain className="w-5 h-5" />
                    Personal memory
                  </div>
                }
              >
                <div className="space-y-4">
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    Save useful preferences and background so the agent can personalize future chats. Memories are context only—not ledger evidence, and never authorization to change your data.
                  </p>
                  <form className="space-y-4" onSubmit={(event) => void saveMemory(event)}>
                    <Input
                      label="Memory name"
                      value={memoryLabel}
                      onChange={(event) => setMemoryLabel(event.target.value)}
                      placeholder="e.g. Financial goal"
                      maxLength={memoryLimits.maxLabelLength}
                      required
                    />
                    <div className="space-y-1">
                      <label htmlFor="agent-memory-content" className="block text-sm font-medium text-[var(--color-text-secondary)]">What should the agent remember?</label>
                      <textarea
                        id="agent-memory-content"
                        value={memoryContent}
                        onChange={(event) => setMemoryContent(event.target.value)}
                        placeholder="e.g. I am saving for a down payment and prefer conservative suggestions."
                        maxLength={memoryLimits.maxContentLength}
                        required
                        rows={3}
                        className="brutalist-input min-h-24 w-full resize-y"
                      />
                      <p className="text-xs text-[var(--color-muted)]">{memoryContent.length}/{memoryLimits.maxContentLength}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" isLoading={isSavingMemory} disabled={memories.length >= memoryLimits.maxItems && editingMemoryId == null}>
                        {editingMemoryId == null ? 'Add memory' : 'Save changes'}
                      </Button>
                      {editingMemoryId != null && <Button type="button" variant="secondary" onClick={resetMemoryForm} disabled={isSavingMemory}>Cancel</Button>}
                    </div>
                  </form>
                  {memories.length >= memoryLimits.maxItems && editingMemoryId == null && <p className="text-xs text-[var(--color-warning)]">You have reached the {memoryLimits.maxItems}-memory limit. Edit or delete an existing memory to add another.</p>}
                  {memoryError && <p role="alert" className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">{memoryError}</p>}
                </div>
              </Card>

              <Card
                title="Saved memories"
                action={<span className="text-xs text-[var(--color-text-secondary)]">{memories.length}/{memoryLimits.maxItems}</span>}
              >
                {isLoadingMemories ? (
                  <p className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><RefreshCw className="h-4 w-4 animate-spin" /> Loading memories…</p>
                ) : memories.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-secondary)]">No memories saved yet. Add preferences, goals, or stable background that helps the agent understand you.</p>
                ) : (
                  <div className="space-y-3">
                    {memories.map((memory) => (
                      <div key={memory.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="font-semibold">{memory.label}</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{memory.content}</p>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button type="button" size="sm" variant="secondary" onClick={() => editMemory(memory)} disabled={isSavingMemory}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                            <Button type="button" size="sm" variant="danger" onClick={() => void deleteMemory(memory)} disabled={isSavingMemory}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* Data Tab */}
          {activeTab === 'data' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <Card title="Data & security tools">
                <div className="divide-y divide-[var(--color-border)]">
                  {[
                    { to: '/anomalies', label: 'Data quality', description: 'Review issues and inconsistencies in your records.' },
                    { to: '/gallery', label: 'Image storage', description: 'Manage receipt, conversation, and wishlist images.' },
                    { to: '/audit-log', label: 'Security audit', description: 'Review account activity and security events.' },
                  ].map(item => <Link key={item.to} to={item.to} className="flex items-center justify-between gap-4 py-4 text-sm hover:text-[var(--color-accent)]"><span><strong className="block font-semibold">{item.label}</strong><span className="mt-1 block text-[var(--color-text-secondary)]">{item.description}</span></span><ChevronRight className="h-4 w-4 shrink-0" /></Link>)}
                </div>
              </Card>
              <Card
                title={
                  <div className="flex items-center gap-2">
                    <LockKeyhole className="h-5 w-5" />
                    PDF report security
                  </div>
                }
              >
                <div className="space-y-5">
                  <label className="flex cursor-pointer items-start justify-between gap-5">
                    <span>
                      <span className="block text-sm font-semibold text-[var(--color-text-primary)]">Password-protect monthly reports</span>
                      <span className="mt-1 block text-xs leading-relaxed text-[var(--color-text-secondary)]">Applies AES-256 encryption in your browser before the PDF is downloaded.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.pdfPasswordEnabled}
                      onChange={(event) => setSettings({ ...settings, pdfPasswordEnabled: event.target.checked })}
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                    />
                  </label>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                      label="Birthday"
                      type="date"
                      value={settings.birthDate}
                      onChange={(event) => setSettings({ ...settings, birthDate: event.target.value })}
                      disabled={!settings.pdfPasswordEnabled}
                    />
                    <Select
                      label="Password format"
                      value={settings.pdfPasswordFormat}
                      onChange={(event) => setSettings({ ...settings, pdfPasswordFormat: event.target.value as PdfPasswordFormat })}
                      disabled={!settings.pdfPasswordEnabled}
                      options={[
                        { value: 'DDMMYYYY', label: 'DDMMYYYY (day first)' },
                        { value: 'YYYYMMDD', label: 'YYYYMMDD (year first)' },
                      ]}
                    />
                  </div>

                  {settings.pdfPasswordEnabled && (
                    <div className={cn('border-l-4 px-3 py-2 text-xs leading-relaxed', reportPassword ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5 text-[var(--color-text-secondary)]' : 'border-[var(--color-danger)] bg-[var(--color-danger)]/5 text-[var(--color-danger)]')}>
                      {reportPassword
                        ? `Your PDF password will be your birthday in ${passwordFormatDescription(settings.pdfPasswordFormat)} format (${reportPassword.length} digits).`
                        : 'Add a valid birthday before downloading a protected report.'}
                    </div>
                  )}

                  <p className="text-xs leading-relaxed text-[var(--color-muted)]">Birthday-based passwords are convenient but easier to guess than a unique password. The birthday is stored only in this browser's local settings.</p>
                </div>
              </Card>

              {/* Export Section */}
              <Card
                title={
                  <div className="flex items-center gap-2">
                    <Download className="w-5 h-5" />
                    Export Data
                  </div>
                }
              >
                <div className="space-y-4">
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    Download a backup of your data as a JSON file.
                  </p>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Select what to export:</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { key: 'transactions', label: 'Transactions' },
                        { key: 'accounts', label: 'Accounts' },
                        { key: 'categories', label: 'Categories & Tags' },
                        { key: 'budgets', label: 'Budgets & Periods' },
                        { key: 'settings', label: 'Settings' },
                        { key: 'memories', label: 'Agent memory' },
                      ].map(({ key, label }) => (
                        <label
                          key={key}
                          className="flex items-center gap-2 p-3 rounded-lg border border-[var(--color-border)] cursor-pointer hover:bg-[var(--ref-surface-container)] transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={exportOptions[key as keyof ExportOptions]}
                            onChange={(e) =>
                              setExportOptions({ ...exportOptions, [key]: e.target.checked })
                            }
                            className="w-4 h-4 accent-[var(--color-accent)]"
                          />
                          <span className="text-sm">{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <Button
                    onClick={handleExport}
                    disabled={!Object.values(exportOptions).some(Boolean)}
                    className="w-full sm:w-auto"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download JSON
                  </Button>

                  {showExportSuccess && (
                    <div className="flex items-center gap-2 text-[var(--color-success)] text-sm">
                      <CheckCircle className="w-4 h-4" />
                      Export downloaded successfully!
                    </div>
                  )}
                </div>
              </Card>

              {/* Import Section */}
              <Card
                title={
                  <div className="flex items-center gap-2">
                    <Upload className="w-5 h-5" />
                    Import Data
                  </div>
                }
              >
                <div className="space-y-4">
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    Restore data from a previously exported JSON file.
                  </p>
                  <div className="flex items-center gap-3">
                    <label className="flex-1">
                      <input
                        type="file"
                        accept=".json"
                        onChange={handleImport}
                        className="block w-full text-sm text-[var(--color-text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-2 file:border-[var(--color-border)] file:bg-transparent file:text-sm file:font-medium hover:file:bg-[var(--color-accent)]/10 cursor-pointer"
                      />
                    </label>
                  </div>
                  <p className="text-xs text-[var(--color-muted)]">
                    Import will merge with existing data. Duplicate transactions may be created.
                  </p>
                </div>
              </Card>

              {/* Data Management */}
              <Card
                title={
                  <div className="flex items-center gap-2">
                    <Database className="w-5 h-5" />
                    Data Management
                  </div>
                }
              >
                <div className="space-y-3">
                  <Button
                    variant="secondary"
                    className="w-full justify-between"
                    onClick={() => setShowClearCacheModal(true)}
                  >
                    <span className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4" />
                      Clear Local Cache
                    </span>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full justify-between text-[var(--color-danger)] border-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
                    onClick={() => setShowDeleteDataModal(true)}
                  >
                    <span className="flex items-center gap-2">
                      <Trash2 className="w-4 h-4" />
                      Delete All Data
                    </span>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-6 border-t border-[var(--color-border)]">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-[var(--color-muted)]">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4" />
              <span>Logged in as {user?.email || "Unknown user"}</span>
            </div>
            <div className="flex items-center gap-4">
              <span>Fainens v1.0.0</span>
              <Button variant="secondary" size="sm" onClick={async () => {
                const confirmed = await confirm({
                  title: 'Sign Out',
                  message: 'Are you sure you want to sign out?',
                  confirmLabel: 'Sign Out',
                  variant: 'default',
                });
                if (confirmed) {
                  await logout();
                }
              }}>
                Sign Out
              </Button>
            </div>
          </div>
        </div>

        {/* Clear Cache Modal */}
        <Modal
          isOpen={showClearCacheModal}
          onClose={() => setShowClearCacheModal(false)}
          title="Clear Cache"
        >
          <div className="space-y-4">
            <p>Are you sure you want to clear the local cache?</p>
            <p className="text-sm text-[var(--color-muted)]">
              This will refresh all data from the server. You won't lose any transactions or accounts.
            </p>
            <div className="flex gap-3">
              <Button onClick={handleClearCache} className="flex-1">
                <RefreshCw className="w-4 h-4 mr-2" />
                Clear Cache
              </Button>
              <Button variant="secondary" onClick={() => setShowClearCacheModal(false)} className="flex-1">
                Cancel
              </Button>
            </div>
          </div>
        </Modal>

        {/* Delete Data Modal */}
        <Modal
          isOpen={showDeleteDataModal}
          onClose={() => setShowDeleteDataModal(false)}
          title="Delete All Data"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-[var(--color-danger)]/10 border-2 border-[var(--color-danger)]">
              <AlertTriangle className="w-6 h-6 text-[var(--color-danger)]" />
              <p className="font-bold text-[var(--color-danger)]">
                This action cannot be undone!
              </p>
            </div>
            <p>Deleting all data will permanently remove:</p>
            <ul className="list-disc list-inside text-sm text-[var(--color-text-secondary)] space-y-1">
              <li>All transactions</li>
              <li>All accounts (except system defaults)</li>
              <li>All categories and tags</li>
              <li>All budget plans and periods</li>
              <li>All audit logs</li>
            </ul>
            <div className="flex gap-3">
              <Button
                onClick={handleDeleteAllData}
                className="flex-1 bg-[var(--color-danger)] hover:bg-[var(--color-danger)]/90"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Everything
              </Button>
              <Button variant="secondary" onClick={() => setShowDeleteDataModal(false)} className="flex-1">
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      </PageContainer>
    </RequireAuth>
  );
}
