import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { RequireAuth } from '../lib/auth';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type AgentMemory, type PersonalProfile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAccountsLedgerQuery } from '../features/accounts/queries';
import { useAgentMemoriesQuery } from '../features/agent/queries';
import { agentCommands } from '../features/agent/commands';
import { queryKeys } from '../features/core/query-keys';
import { cn } from '../lib/utils';
import { loadTransferFeeRules, saveTransferFeeRules, type TransferFeePayer, type TransferFeeRule } from '../lib/transferFees';
import { birthdayPassword, loadReportSecuritySettings, passwordFormatDescription, type PdfPasswordFormat } from '../lib/reportSecurity';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { useTheme } from '../hooks/useTheme';
import { useExportDataMutation, type ExportSelection } from '../features/settings/queries';
import {
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
  Search,
} from 'lucide-react';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
} as any);

interface AppSettings {
  dateFormat: string;
  opportunityCostYield: number;
  salaryDay: number;
  defaultBankAccountId: number | null;
  defaultExpenseAccountId: number | null;
  defaultIncomeAccountId: number | null;
  theme: 'light' | 'dark' | 'auto';
  transferFeeRules: TransferFeeRule[];
  pdfPasswordEnabled: boolean;
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

type TabType = 'profile' | 'general' | 'accounts' | 'appearance' | 'agent' | 'data';

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

interface SettingsSectionProps {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}

function SettingsSection({ title, action, children }: SettingsSectionProps) {
  return (
    <section className="pb-4 last:pb-0">
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-4">
          {title && <div className="min-w-0 text-base font-semibold text-[var(--color-text-primary)]">{title}</div>}
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

interface SettingsRowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

function SettingsRow({ label, description, action }: SettingsRowProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--color-border)] py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">{label}</p>
        {description && <p className="mt-1 max-w-xl text-xs leading-relaxed text-[var(--color-text-secondary)]">{description}</p>}
      </div>
      {action && <div className="shrink-0 sm:min-w-[180px] sm:text-right">{action}</div>}
    </div>
  );
}

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
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
  { value: 'DD MMM YYYY', label: 'DD MMM YYYY' },
];

const TIMEZONES = [
  { value: 'Asia/Jakarta', label: 'Jakarta (UTC+7)' },
  { value: 'Asia/Singapore', label: 'Singapore (UTC+8)' },
  { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur (UTC+8)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London' },
  { value: 'America/New_York', label: 'New York' },
];

const INCOME_PATTERNS = [
  { value: '', label: 'Choose later' },
  { value: 'salary', label: 'Regular salary' },
  { value: 'freelance', label: 'Freelance or contract work' },
  { value: 'business', label: 'Business income' },
  { value: 'mixed', label: 'A mix of sources' },
  { value: 'irregular', label: 'Irregular income' },
  { value: 'other', label: 'Something else' },
];

const FINANCIAL_GOALS = [
  { value: '', label: 'Choose later' },
  { value: 'build_savings', label: 'Build savings' },
  { value: 'pay_debt', label: 'Pay off debt' },
  { value: 'control_spending', label: 'Control spending' },
  { value: 'plan_purchase', label: 'Plan a large purchase' },
  { value: 'understand_finances', label: 'Understand my finances' },
  { value: 'other', label: 'Something else' },
];

const DEFAULT_AGENT_CONTEXT: PersonalProfile['agentContext'] = {
  fullName: false,
  preferredName: true,
  pronouns: false,
  age: false,
  country: false,
  timezone: true,
  language: true,
  currency: true,
  incomePattern: false,
  primaryGoal: false,
  agentTone: true,
  agentVerbosity: true,
};

const AGENT_CONTEXT_OPTIONS: Array<{ key: keyof PersonalProfile['agentContext']; label: string; description: string }> = [
  { key: 'fullName', label: 'Full name', description: 'Use it in personalized greetings and summaries.' },
  { key: 'preferredName', label: 'Preferred name', description: 'Use it when addressing you.' },
  { key: 'pronouns', label: 'Pronouns', description: 'Use them when they help phrase a response naturally.' },
  { key: 'age', label: 'Age', description: 'Share your derived age; your date of birth is never sent.' },
  { key: 'country', label: 'Country or region', description: 'Use it for relevant context and examples.' },
  { key: 'timezone', label: 'Timezone', description: 'Use it for dates, times, and reminders.' },
  { key: 'language', label: 'Language', description: 'Use it to choose the response language.' },
  { key: 'currency', label: 'Currency', description: 'Use it when formatting financial answers.' },
  { key: 'incomePattern', label: 'Income pattern', description: 'Use it to tailor financial guidance.' },
  { key: 'primaryGoal', label: 'Main financial goal', description: 'Use it to keep recommendations aligned.' },
  { key: 'agentTone', label: 'Agent tone', description: 'Use your preferred conversational tone.' },
  { key: 'agentVerbosity', label: 'Agent detail', description: 'Use your preferred response depth.' },
];

const TABS: { id: TabType; label: string; icon: React.ElementType }[] = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'accounts', label: 'Accounts', icon: CreditCard },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'agent', label: 'Agent', icon: Brain },
  { id: 'data', label: 'Data', icon: Database },
];

export function SettingsPage({ onClose }: { onClose?: () => void } = {}) {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { logout, user } = useAuth();
  const exportDataMutation = useExportDataMutation();
  const queryClient = useQueryClient();
  const accountsQuery = useAccountsLedgerQuery();
  const memoriesQuery = useAgentMemoriesQuery();
  const [settings, setSettings] = useState<AppSettings>({
    dateFormat: 'DD/MM/YYYY',
    opportunityCostYield: 4.0,
    salaryDay: 25,
    defaultBankAccountId: null,
    defaultExpenseAccountId: null,
    defaultIncomeAccountId: null,
    theme: 'auto',
    transferFeeRules: [],
    pdfPasswordEnabled: false,
    pdfPasswordFormat: 'DDMMYYYY',
  });
  const [profile, setProfile] = useState<PersonalProfile>({
    email: user?.email ?? '',
    fullName: null,
    preferredName: null,
    pronouns: null,
    dateOfBirth: null,
    age: null,
    country: null,
    timezone: 'Asia/Jakarta',
    language: 'en',
    currency: 'IDR',
    incomePattern: null,
    primaryGoal: null,
    agentTone: 'warm',
    agentVerbosity: 'concise',
    agentContext: DEFAULT_AGENT_CONTEXT,
  });
  const [profileBusy, setProfileBusy] = useState(false);
  const [contextDraft, setContextDraft] = useState<PersonalProfile['agentContext'] | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [profileNotice, setProfileNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [legacyBirthDate, setLegacyBirthDate] = useState(() => loadReportSecuritySettings().birthDate);
  const reportPassword = birthdayPassword(profile.dateOfBirth || legacyBirthDate, settings.pdfPasswordFormat);
  const accounts = (accountsQuery.data ?? []).map(({ id, name, type, systemKey }) => ({ id, name, type, systemKey }));
  const memories = memoriesQuery.data?.memories ?? [];
  const memoryLimits = memoriesQuery.data?.limits ?? { maxItems: 50, maxLabelLength: 80, maxContentLength: 1000 };
  const [memoryLabel, setMemoryLabel] = useState('');
  const [memoryContent, setMemoryContent] = useState('');
  const [editingMemoryId, setEditingMemoryId] = useState<number | null>(null);
  const [showMemoryForm, setShowMemoryForm] = useState(false);
  const isLoadingMemories = memoriesQuery.isPending && !memoriesQuery.data;
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showClearCacheModal, setShowClearCacheModal] = useState(false);
  const [showDeleteDataModal, setShowDeleteDataModal] = useState(false);
  const [showExportSuccess, setShowExportSuccess] = useState(false);
  const [agentProviderBusy, setAgentProviderBusy] = useState(false);
  const [agentProviderNotice, setAgentProviderNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [agentModels, setAgentModels] = useState<AgentModel[]>([]);
  const [agentModelDraft, setAgentModelDraft] = useState({ name: '', model: '', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '' });
  const [editingAgentModelId, setEditingAgentModelId] = useState<number | null>(null);
  const [showAgentModelForm, setShowAgentModelForm] = useState(false);
  const [feeRuleFrom, setFeeRuleFrom] = useState('');
  const [feeRuleTo, setFeeRuleTo] = useState('');
  const [feeRuleAmount, setFeeRuleAmount] = useState('');
  const [feeRulePayer, setFeeRulePayer] = useState<TransferFeePayer>('sender');
  const { confirm } = useConfirm();
  const visibleTabs = TABS.filter((tab) => tab.label.toLowerCase().includes(settingsSearch.trim().toLowerCase()));
  const closeSettings = onClose ?? (() => { void navigate({ to: '/' }); });
  
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
    void api.profile.get().then((savedProfile) => {
      setProfile({ ...savedProfile, agentContext: { ...DEFAULT_AGENT_CONTEXT, ...(savedProfile.agentContext ?? {}) } });
      if (!savedProfile.dateOfBirth && legacyBirthDate) {
        void api.profile.update({ dateOfBirth: legacyBirthDate })
          .then((migratedProfile) => {
            setProfile({ ...migratedProfile, agentContext: { ...DEFAULT_AGENT_CONTEXT, ...(migratedProfile.agentContext ?? {}) } });
            setLegacyBirthDate('');
          })
          .catch(() => undefined);
      } else {
        setLegacyBirthDate('');
      }
    }).catch(() => setProfileNotice({ tone: 'error', text: 'Could not load your profile.' }));
    void api.agentProvider.models.list().then(setAgentModels).catch(() => setAgentProviderNotice({ tone: 'error', text: 'Could not load Agent models.' }));
  }, [legacyBirthDate]);

  const saveProfile = async () => {
    setProfileBusy(true);
    setProfileNotice(null);
    try {
      const { email, age, agentContext, ...input } = profile;
      void email;
      void age;
      void agentContext;
      const saved = await api.profile.update(input);
      setProfile({ ...saved, agentContext: { ...DEFAULT_AGENT_CONTEXT, ...(saved.agentContext ?? {}) } });
      queryClient.setQueryData(queryKeys.agent.profile, { nickname: saved.preferredName });
      setProfileNotice({ tone: 'success', text: 'Profile saved.' });
    } catch (error) {
      setProfileNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save your profile.' });
    } finally {
      setProfileBusy(false);
    }
  };

  const saveAgentContext = async () => {
    if (!contextDraft) return;
    setContextBusy(true);
    setContextError(null);
    try {
      const saved = await api.profile.update({ agentContext: contextDraft });
      setProfile((current) => ({ ...current, agentContext: saved.agentContext }));
      setContextDraft(null);
    } catch (error) {
      setContextError(error instanceof Error ? error.message : 'Could not save sharing preferences.');
    } finally {
      setContextBusy(false);
    }
  };

  const resetAgentModelDraft = () => {
    setEditingAgentModelId(null);
    setAgentModelDraft({ name: '', model: '', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '' });
    setShowAgentModelForm(false);
  };

  const openAgentModelForm = (model?: AgentModel) => {
    setAgentProviderNotice(null);
    if (model) {
      setEditingAgentModelId(model.id);
      setAgentModelDraft({ name: model.name, model: model.model, baseUrl: model.baseUrl, apiKey: '' });
    } else {
      setEditingAgentModelId(null);
      setAgentModelDraft({ name: '', model: '', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '' });
    }
    setShowAgentModelForm(true);
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
        dateFormat: parsed.dateFormat || 'DD/MM/YYYY',
        opportunityCostYield: parsed.opportunityCostYield ?? 4.0,
        salaryDay: parsed.salaryDay || 25,
        defaultBankAccountId: parsed.defaultBankAccountId || null,
        defaultExpenseAccountId: parsed.defaultExpenseAccountId || null,
        defaultIncomeAccountId: parsed.defaultIncomeAccountId || null,
        theme: parsed.theme || 'auto',
        transferFeeRules: loadTransferFeeRules(),
        pdfPasswordEnabled: parsed.pdfPasswordEnabled === true,
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
    setShowMemoryForm(false);
  };

  const openMemoryForm = () => {
    resetMemoryForm();
    setMemoryError(null);
    setShowMemoryForm(true);
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
    setShowMemoryForm(true);
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
      <Modal
        isOpen
        onClose={closeSettings}
        title="Settings"
        subtitle="Configure Fainens around the way you manage money."
        size="xl"
        showCloseLabel={false}
        className="h-[min(680px,82vh)] max-w-[min(920px,92vw)] !rounded-xl !shadow-xl"
        contentClassName="!overflow-hidden !p-0"
      >
        <div className="flex h-full min-h-0 flex-col md:flex-row">
          <aside className="flex w-full shrink-0 flex-col border-b border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-3 md:w-48 md:border-b-0 md:border-r">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
              <input value={settingsSearch} onChange={(event) => setSettingsSearch(event.target.value)} placeholder="Search settings" className="w-full rounded-full border border-[var(--color-border)] bg-transparent py-2 pl-9 pr-3 text-sm outline-none transition focus:border-[var(--color-accent)]" aria-label="Search settings" />
            </label>
            <nav className="mt-3 flex gap-1 overflow-x-auto md:block md:space-y-1">
              {visibleTabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    'flex shrink-0 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors md:w-full',
                    activeTab === id
                      ? 'bg-[var(--color-background)] text-[var(--color-text-primary)] shadow-sm'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background)]/70 hover:text-[var(--color-text-primary)]'
                  )}
                >
                  <Icon className={cn('h-4 w-4', activeTab === id && 'text-[var(--color-accent)]')} />
                  {label}
                </button>
              ))}
              {visibleTabs.length === 0 && <p className="px-2 py-3 text-xs text-[var(--color-muted)]">No matching settings</p>}
            </nav>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3 sm:px-5">
              <h1 className="font-headline text-xl font-bold text-[var(--color-text-primary)]">{TABS.find((tab) => tab.id === activeTab)?.label}</h1>
              {saveStatus !== 'idle' && (
                <span className={cn('flex items-center gap-1.5 text-xs font-medium', saveStatus === 'saving' ? 'text-[var(--color-accent)]' : 'text-[var(--color-success)]')}>
                  {saveStatus === 'saving' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {saveStatus === 'saving' ? 'Saving' : 'Saved'}
                </span>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {/* Tab Content */}
              <div className="transition-opacity duration-300">
          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <div className="max-w-3xl space-y-4 animate-in fade-in duration-300">
              <SettingsSection title="About you">
                <div className="space-y-5">
                  <div className="grid max-w-xl gap-4">
                    <Input label="Name" value={profile.fullName ?? ''} onChange={(event) => setProfile((current) => ({ ...current, fullName: event.target.value || null }))} placeholder="Your full name" maxLength={120} />
                    <Input label="Preferred name" value={profile.preferredName ?? ''} onChange={(event) => setProfile((current) => ({ ...current, preferredName: event.target.value || null }))} placeholder="What should we call you?" maxLength={80} />
                    <Input label="Pronouns (optional)" value={profile.pronouns ?? ''} onChange={(event) => setProfile((current) => ({ ...current, pronouns: event.target.value || null }))} placeholder="e.g. they/them" maxLength={80} />
                    <Input label="Date of birth (optional)" type="date" value={profile.dateOfBirth ?? ''} onChange={(event) => setProfile((current) => ({ ...current, dateOfBirth: event.target.value || null }))} />
                  </div>
                  <details className="group border-t border-[var(--color-border)] pt-5">
                    <summary className="cursor-pointer text-sm font-semibold">Regional preferences</summary>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <Input label="Country or region" value={profile.country ?? ''} onChange={(event) => setProfile((current) => ({ ...current, country: event.target.value || null }))} placeholder="e.g. Indonesia" maxLength={80} />
                    <Select label="Timezone" value={profile.timezone} onChange={(event) => setProfile((current) => ({ ...current, timezone: event.target.value }))} options={TIMEZONES} />
                    <Select label="Language" value={profile.language} onChange={(event) => setProfile((current) => ({ ...current, language: event.target.value as PersonalProfile['language'] }))} options={[{ value: 'en', label: 'English' }, { value: 'id', label: 'Bahasa Indonesia' }]} />
                    <Select label="Default currency" value={profile.currency} onChange={(event) => setProfile((current) => ({ ...current, currency: event.target.value }))} options={CURRENCIES.map((currency) => ({ value: currency.value, label: currency.label }))} />
                    </div>
                  </details>
                  <details className="group border-t border-[var(--color-border)] pt-5">
                    <summary className="cursor-pointer text-sm font-semibold">Financial preferences</summary>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <Select label="Income pattern" value={profile.incomePattern ?? ''} onChange={(event) => setProfile((current) => ({ ...current, incomePattern: (event.target.value || null) as PersonalProfile['incomePattern'] }))} options={INCOME_PATTERNS} />
                    <Select label="Main financial goal" value={profile.primaryGoal ?? ''} onChange={(event) => setProfile((current) => ({ ...current, primaryGoal: (event.target.value || null) as PersonalProfile['primaryGoal'] }))} options={FINANCIAL_GOALS} />
                    </div>
                  </details>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-5">
                    <div><p className="text-sm font-semibold">Agent context</p><p className="mt-1 text-xs text-[var(--color-muted)]">{Object.values(profile.agentContext).filter(Boolean).length} profile fields enabled for sharing</p></div>
                    <Button type="button" size="sm" variant="secondary" disabled={profileBusy} onClick={() => { setContextError(null); setContextDraft({ ...profile.agentContext }); }}>Manage sharing</Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-5">
                    <Button type="button" onClick={() => void saveProfile()} disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save profile'}</Button>
                    <span className="text-xs text-[var(--color-muted)]">Signed in as {profile.email || user?.email || 'your account'}</span>
                  </div>
                  {profileNotice && <p role="status" className={cn('rounded-lg border p-3 text-sm', profileNotice.tone === 'success' ? 'border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[var(--color-success)]' : 'border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 text-[var(--color-danger)]')}>{profileNotice.text}</p>}
                </div>
              </SettingsSection>
            </div>
          )}

          {/* General Tab */}
          {activeTab === 'general' && (
            <div className="max-w-3xl animate-in fade-in duration-300">
              <SettingsSection>
                <div>
                  <SettingsRow
                    label="Date format"
                    description="How dates are displayed throughout Fainens. Currency is managed in Profile."
                    action={<Select label="" aria-label="Date format" className="w-full sm:w-48" value={settings.dateFormat} onChange={(event) => setSettings({ ...settings, dateFormat: event.target.value })} options={DATE_FORMATS.map((dateFormat) => ({ value: dateFormat.value, label: dateFormat.label }))} />}
                  />
                  <SettingsRow
                    label="Opportunity cost yield"
                    description="Annual money market rate used for opportunity cost calculations."
                    action={<Input label="" aria-label="Baseline yield" className="w-full sm:w-32" type="number" value={settings.opportunityCostYield.toString()} onChange={(event) => setSettings({ ...settings, opportunityCostYield: parseFloat(event.target.value) || 0 })} step="0.1" min="0" max="20" />}
                  />
                  <SettingsRow
                    label="Salary day"
                    description="The day you receive your salary. Budget periods are calculated from this date."
                    action={<Input label="" aria-label="Salary day of month" className="w-full sm:w-32" type="number" value={settings.salaryDay.toString()} onChange={(event) => setSettings({ ...settings, salaryDay: parseInt(event.target.value) || 1 })} min="1" max="31" />}
                  />
                </div>
              </SettingsSection>
            </div>
          )}

          {/* Accounts Tab */}
          {activeTab === 'accounts' && (
            <div className="max-w-3xl space-y-4 animate-in fade-in duration-300">
              <SettingsSection>
                <div>
                  <SettingsRow label="Default bank account" description="Pre-selected when you create a transaction." action={<Select label="" aria-label="Default bank account" className="w-full sm:w-52" value={settings.defaultBankAccountId?.toString() || ''} onChange={(event) => setSettings({ ...settings, defaultBankAccountId: event.target.value ? parseInt(event.target.value) : null })} options={getAccountOptions('asset')} />} />
                  <SettingsRow label="Default expense account" description="Used as the default source for new expenses." action={<Select label="" aria-label="Default expense account" className="w-full sm:w-52" value={settings.defaultExpenseAccountId?.toString() || ''} onChange={(event) => setSettings({ ...settings, defaultExpenseAccountId: event.target.value ? parseInt(event.target.value) : null })} options={getAccountOptions('expense')} />} />
                  <SettingsRow label="Default income account" description="Used as the default destination for new income." action={<Select label="" aria-label="Default income account" className="w-full sm:w-52" value={settings.defaultIncomeAccountId?.toString() || ''} onChange={(event) => setSettings({ ...settings, defaultIncomeAccountId: event.target.value ? parseInt(event.target.value) : null })} options={getAccountOptions('revenue')} />} />
                </div>
              </SettingsSection>
              <details className="group border-b border-[var(--color-border)] pb-6">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-2 [&::-webkit-details-marker]:hidden">
                  <span><span className="block text-sm font-semibold">Transfer fee defaults</span><span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{settings.transferFeeRules.length} saved pair defaults</span></span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted)] transition-transform group-open:rotate-90" />
                </summary>
                <div className="mt-4 space-y-4">
                  <p className="text-sm text-[var(--color-text-secondary)]">Automatically apply a fee when moving money between a specific source and destination.</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Select label="From account" value={feeRuleFrom} onChange={(event) => setFeeRuleFrom(event.target.value)} options={[{ value: '', label: 'Choose source…' }, ...accounts.filter((account) => account.type === 'asset' && !account.systemKey).map((account) => ({ value: String(account.id), label: account.name }))]} />
                    <Select label="To account" value={feeRuleTo} onChange={(event) => setFeeRuleTo(event.target.value)} options={[{ value: '', label: 'Choose destination…' }, ...accounts.filter((account) => account.type === 'asset' && !account.systemKey).map((account) => ({ value: String(account.id), label: account.name }))]} />
                    <Input label="Fee (IDR)" type="number" min="0" step="1" value={feeRuleAmount} onChange={(event) => setFeeRuleAmount(event.target.value)} placeholder="e.g. 1000" />
                    <Select label="Who pays" value={feeRulePayer} onChange={(event) => setFeeRulePayer(event.target.value as TransferFeePayer)} options={[{ value: 'sender', label: 'Sender' }, { value: 'recipient', label: 'Recipient' }]} />
                  </div>
                  <Button type="button" onClick={addTransferFeeRule} disabled={!feeRuleFrom || !feeRuleTo || !feeRuleAmount}><Plus className="h-4 w-4" /> Save pair default</Button>
                  {settings.transferFeeRules.length > 0 ? <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">{settings.transferFeeRules.map((rule) => <div key={`${rule.fromAccountId}-${rule.toAccountId}`} className="flex items-center justify-between gap-3 py-3 text-sm"><div className="min-w-0"><p className="truncate font-semibold">{accounts.find((account) => account.id === rule.fromAccountId)?.name ?? `Account #${rule.fromAccountId}`} → {accounts.find((account) => account.id === rule.toAccountId)?.name ?? `Account #${rule.toAccountId}`}</p><p className="text-xs text-[var(--color-text-secondary)]">{rule.feeCents.toLocaleString('id-ID')} IDR · paid by {rule.payer}</p></div><Button type="button" size="sm" variant="danger" onClick={() => removeTransferFeeRule(rule)}><Trash2 className="h-3.5 w-3.5" /> Remove</Button></div>)}</div> : <p className="text-xs text-[var(--color-muted)]">No pair defaults yet.</p>}
                </div>
              </details>
            </div>
          )}

          {/* Appearance Tab */}
          {activeTab === 'appearance' && (
            <div className="max-w-3xl animate-in fade-in duration-300">
              <SettingsSection>
                <div>
                  <SettingsRow
                    label="Theme"
                    description="Choose light, dark, or follow your system preference."
                    action={<Select label="" aria-label="Theme" className="w-full sm:w-40" value={theme} onChange={(event) => setTheme(event.target.value as 'light' | 'dark' | 'auto')} options={[{ value: 'auto', label: 'System' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />}
                  />
                </div>
              </SettingsSection>
            </div>
          )}

          {/* Agent tab */}
          {activeTab === 'agent' && (
            <div className="max-w-3xl space-y-4 animate-in fade-in duration-300">
              <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden">
                    <span><span className="block text-sm font-semibold">Response style</span><span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{profile.agentTone.charAt(0).toUpperCase() + profile.agentTone.slice(1)} · {profile.agentVerbosity.charAt(0).toUpperCase() + profile.agentVerbosity.slice(1)}</span></span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted)] transition-transform group-open:rotate-90" />
                  </summary>
                  <div className="pb-5">
                    <div className="space-y-4">
                    <p className="text-sm text-[var(--color-text-secondary)]">Set the default tone and amount of detail for everyday conversations.</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Select label="Agent tone" value={profile.agentTone} onChange={(event) => setProfile((current) => ({ ...current, agentTone: event.target.value as PersonalProfile['agentTone'] }))} options={[{ value: 'warm', label: 'Warm and friendly' }, { value: 'direct', label: 'Direct and practical' }, { value: 'encouraging', label: 'Encouraging and supportive' }]} />
                      <Select label="Agent detail" value={profile.agentVerbosity} onChange={(event) => setProfile((current) => ({ ...current, agentVerbosity: event.target.value as PersonalProfile['agentVerbosity'] }))} options={[{ value: 'concise', label: 'Concise' }, { value: 'balanced', label: 'Balanced' }, { value: 'detailed', label: 'Detailed' }]} />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button type="button" size="sm" onClick={() => void saveProfile()} disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save response style'}</Button>
                      {profileNotice && <span role="status" className={cn('text-xs', profileNotice.tone === 'success' ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>{profileNotice.text}</span>}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-5">
                      <div><p className="text-sm font-semibold">Personal context</p><p className="mt-1 text-xs text-[var(--color-muted)]">{Object.values(profile.agentContext).filter(Boolean).length} profile fields shared · {memories.length} memories available</p></div>
                      <Button type="button" size="sm" variant="secondary" onClick={() => { setActiveTab('profile'); setContextError(null); setContextDraft({ ...profile.agentContext }); }}>Manage context</Button>
                    </div>
                  </div>
                </div>
              </details>

              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden">
                  <span><span className="block text-sm font-semibold">Models</span><span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{agentModels.find((model) => model.isDefault)?.name ?? 'No model configured'} · {agentModels.length} saved</span></span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted)] transition-transform group-open:rotate-90" />
                </summary>
                <div className="pb-5">
                    <div className="space-y-4">
                    <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">Choose which OpenAI-compatible model Agent uses. API keys are encrypted and never shown again.</p>
                    {agentModels.length === 0 ? (
                      <p className="border-y border-[var(--color-border)] py-4 text-sm text-[var(--color-text-secondary)]">No saved models yet. Add one to connect Agent to a provider.</p>
                    ) : (
                      <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
                        {agentModels.map((model) => (
                          <div key={model.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{model.name}</p>{model.isDefault && <span className="rounded-full bg-[var(--ref-primary)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--ref-primary)]">Default</span>}</div><p className="mt-1 truncate font-mono text-xs text-[var(--color-text-secondary)]">{model.model}</p><p className="mt-1 truncate text-xs text-[var(--color-muted)]">{model.baseUrl} · {model.apiKeyConfigured ? `key via ${model.apiKeySource}` : 'no saved key'}</p></div>
                            <div className="flex shrink-0 flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => openAgentModelForm(model)}>Edit</Button>{model.apiKeySource === 'database' && <Button type="button" size="sm" variant="secondary" onClick={() => void clearAgentModelKey(model.id)} disabled={agentProviderBusy}>Clear key</Button>}{!model.isDefault && <Button type="button" size="sm" variant="secondary" onClick={() => void makeAgentModelDefault(model.id)} disabled={agentProviderBusy}>Make default</Button>}<Button type="button" size="sm" variant="danger" onClick={() => void removeAgentModel(model.id)} disabled={agentProviderBusy}>Delete</Button></div>
                          </div>
                        ))}
                      </div>
                    )}
                    {!showAgentModelForm && <Button type="button" size="sm" variant="secondary" onClick={() => openAgentModelForm()}><Plus className="h-4 w-4" /> Add model</Button>}
                    {showAgentModelForm && (
                      <div className="border-t border-[var(--color-border)] pt-5">
                        <p className="mb-3 text-sm font-semibold">{editingAgentModelId == null ? 'Add model' : 'Edit model'}</p>
                        <div className="grid gap-3 sm:grid-cols-2"><Input label="Name" value={agentModelDraft.name} onChange={(event) => setAgentModelDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="e.g. Fast daily model" maxLength={120} /><Input label="Model ID" value={agentModelDraft.model} onChange={(event) => setAgentModelDraft((draft) => ({ ...draft, model: event.target.value }))} placeholder="e.g. z-ai/glm-5.3-flash" maxLength={200} /><div className="sm:col-span-2"><Input label="Base URL" value={agentModelDraft.baseUrl} onChange={(event) => setAgentModelDraft((draft) => ({ ...draft, baseUrl: event.target.value }))} placeholder="https://openrouter.ai/api/v1" maxLength={500} /></div><div className="sm:col-span-2 space-y-1"><label htmlFor="agent-model-api-key" className="block text-sm font-medium text-[var(--color-text-secondary)]">API key (optional)</label><input id="agent-model-api-key" type="password" value={agentModelDraft.apiKey} onChange={(event) => setAgentModelDraft((draft) => ({ ...draft, apiKey: event.target.value }))} placeholder={editingAgentModelId == null ? 'Leave blank to use the server environment key' : 'Leave blank to keep the stored key'} autoComplete="new-password" className="brutalist-input" /></div></div>
                        <div className="mt-4 flex flex-wrap gap-2"><Button type="button" onClick={() => void saveAgentModel()} disabled={agentProviderBusy || !agentModelDraft.name.trim() || !agentModelDraft.model.trim() || !agentModelDraft.baseUrl.trim()}>{agentProviderBusy ? 'Saving…' : editingAgentModelId == null ? 'Add model' : 'Save changes'}</Button><Button type="button" variant="secondary" onClick={resetAgentModelDraft}>Cancel</Button></div>
                      </div>
                    )}
                    {agentProviderNotice && <p role="status" className={cn('text-sm', agentProviderNotice.tone === 'success' ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>{agentProviderNotice.text}</p>}
                  </div>
                </div>
              </details>

              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden">
                  <span><span className="block text-sm font-semibold">Memory</span><span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{memories.length} saved memories</span></span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted)] transition-transform group-open:rotate-90" />
                </summary>
                <div className="pb-5">
                    <div className="space-y-4">
                    <p className="text-sm text-[var(--color-text-secondary)]">Save stable preferences or background that helps Agent personalize future chats. Memories are context only—not ledger evidence or permission to change data.</p>
                    {!showMemoryForm && <Button type="button" size="sm" variant="secondary" onClick={openMemoryForm} disabled={memories.length >= memoryLimits.maxItems}><Plus className="h-4 w-4" /> Add memory</Button>}
                    {showMemoryForm && (
                      <form className="space-y-4 border-t border-[var(--color-border)] pt-5" onSubmit={(event) => void saveMemory(event)}>
                        <Input label="Memory name" value={memoryLabel} onChange={(event) => setMemoryLabel(event.target.value)} placeholder="e.g. Financial goal" maxLength={memoryLimits.maxLabelLength} required />
                        <div className="space-y-1"><label htmlFor="agent-memory-content" className="block text-sm font-medium text-[var(--color-text-secondary)]">What should Agent remember?</label><textarea id="agent-memory-content" value={memoryContent} onChange={(event) => setMemoryContent(event.target.value)} placeholder="e.g. I am saving for a down payment and prefer conservative suggestions." maxLength={memoryLimits.maxContentLength} required rows={3} className="brutalist-input min-h-24 w-full resize-y" /><p className="text-xs text-[var(--color-muted)]">{memoryContent.length}/{memoryLimits.maxContentLength}</p></div>
                        <div className="flex flex-wrap gap-2"><Button type="submit" isLoading={isSavingMemory}>{editingMemoryId == null ? 'Add memory' : 'Save changes'}</Button><Button type="button" variant="secondary" onClick={resetMemoryForm} disabled={isSavingMemory}>Cancel</Button></div>
                      </form>
                    )}
                    {memories.length >= memoryLimits.maxItems && !showMemoryForm && <p className="text-xs text-[var(--color-warning)]">You have reached the {memoryLimits.maxItems}-memory limit.</p>}
                    {memoryError && <p role="alert" className="text-sm text-[var(--color-danger)]">{memoryError}</p>}
                    {isLoadingMemories ? (
                      <p className="flex items-center gap-2 border-y border-[var(--color-border)] py-4 text-sm text-[var(--color-text-secondary)]"><RefreshCw className="h-4 w-4 animate-spin" /> Loading memories…</p>
                    ) : memories.length === 0 ? (
                      <p className="border-y border-[var(--color-border)] py-4 text-sm text-[var(--color-text-secondary)]">No memories saved yet.</p>
                    ) : (
                      <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
                        {memories.map((memory) => (
                          <div key={memory.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0"><p className="font-semibold">{memory.label}</p><p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{memory.content}</p></div>
                            <div className="flex shrink-0 gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => editMemory(memory)} disabled={isSavingMemory}><Pencil className="h-3.5 w-3.5" /> Edit</Button><Button type="button" size="sm" variant="danger" onClick={() => void deleteMemory(memory)} disabled={isSavingMemory}><Trash2 className="h-3.5 w-3.5" /> Delete</Button></div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </details>
              </div>
            </div>
          )}

          {/* Data Tab */}
          {activeTab === 'data' && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <SettingsSection title="Data & security tools">
                <div className="divide-y divide-[var(--color-border)]">
                  {[
                    { to: '/anomalies', label: 'Data quality', description: 'Review issues and inconsistencies in your records.' },
                    { to: '/gallery', label: 'Image storage', description: 'Manage receipt, conversation, and wishlist images.' },
                    { to: '/audit-log', label: 'Security audit', description: 'Review account activity and security events.' },
                  ].map(item => <Link key={item.to} to={item.to} className="flex items-center justify-between gap-4 py-4 text-sm hover:text-[var(--color-accent)]"><span><strong className="block font-semibold">{item.label}</strong><span className="mt-1 block text-[var(--color-text-secondary)]">{item.description}</span></span><ChevronRight className="h-4 w-4 shrink-0" /></Link>)}
                </div>
              </SettingsSection>
              <SettingsSection
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

                  <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">Birthday</p>
                        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                          {profile.dateOfBirth ? `Using ${profile.dateOfBirth} from your Profile.` : 'Add your birthday in Profile to use this option.'}
                        </p>
                      </div>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setActiveTab('profile')}>Open Profile</Button>
                    </div>
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

                  <p className="text-xs leading-relaxed text-[var(--color-muted)]">Birthday-based passwords are convenient but easier to guess than a unique password. Your birthday is managed securely in Profile; this page only controls whether the report password is enabled and how it is formatted.</p>
                </div>
              </SettingsSection>

              {/* Export Section */}
              <SettingsSection
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
              </SettingsSection>

              {/* Import Section */}
              <SettingsSection
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
              </SettingsSection>

              {/* Data Management */}
              <SettingsSection
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
              </SettingsSection>
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
            </div>

        {/* Clear Cache Modal */}
        <Modal
          isOpen={contextDraft !== null}
          onClose={() => { if (!contextBusy) setContextDraft(null); }}
          title="Agent context"
          subtitle="Choose what Agent can use from your saved profile."
          overlayClassName="!z-[60]"
          footer={<div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={contextBusy} onClick={() => setContextDraft(null)}>Cancel</Button><Button type="button" disabled={contextBusy} onClick={() => void saveAgentContext()}>{contextBusy ? 'Saving…' : 'Save sharing'}</Button></div>}
        >
          <div className="divide-y divide-[var(--color-border)]">
            {AGENT_CONTEXT_OPTIONS.map((option) => (
              <label key={option.key} className="flex cursor-pointer items-center justify-between gap-4 py-3">
                <span><span className="block text-sm font-medium">{option.label}</span><span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{option.description}</span></span>
                <input type="checkbox" checked={contextDraft?.[option.key] ?? false} disabled={contextBusy} onChange={(event) => setContextDraft((current) => current ? { ...current, [option.key]: event.target.checked } : current)} className="h-4 w-4 shrink-0 accent-[var(--color-accent)]" />
              </label>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-[var(--color-muted)]">Sharing changes apply after saving. Profile details remain available to other app features. Existing chats and memories are managed separately.</p>
          {contextError && <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">{contextError}</p>}
        </Modal>

        <Modal
          isOpen={showClearCacheModal}
          onClose={() => setShowClearCacheModal(false)}
          title="Clear Cache"
          overlayClassName="!z-[60]"
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
          overlayClassName="!z-[60]"
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
          </main>
        </div>
      </Modal>
    </RequireAuth>
  );
}
