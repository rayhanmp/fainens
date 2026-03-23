import { createFileRoute } from '@tanstack/react-router';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { RequireAuth } from '../lib/auth';
import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
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
}

interface ExportOptions {
  transactions: boolean;
  accounts: boolean;
  categories: boolean;
  budgets: boolean;
  settings: boolean;
}

type TabType = 'general' | 'accounts' | 'appearance' | 'data';

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
  { id: 'data', label: 'Data', icon: Database },
];

function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({
    currency: 'IDR',
    dateFormat: 'DD/MM/YYYY',
    opportunityCostYield: 4.0,
    salaryDay: 25,
    defaultBankAccountId: null,
    defaultExpenseAccountId: null,
    defaultIncomeAccountId: null,
    theme: 'auto',
  });
  const [accounts, setAccounts] = useState<Array<{ id: number; name: string; type: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showClearCacheModal, setShowClearCacheModal] = useState(false);
  const [showDeleteDataModal, setShowDeleteDataModal] = useState(false);
  const [showExportSuccess, setShowExportSuccess] = useState(false);
  
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    transactions: true,
    accounts: true,
    categories: true,
    budgets: true,
    settings: true,
  });
  
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadSettings();
    loadAccounts();
  }, []);

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
      });
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadAccounts = async () => {
    try {
      const data = await api.accounts.list();
      setAccounts(data.map(({ id, name, type }) => ({ id, name, type })));
    } catch (err) {
      console.error('Failed to load accounts:', err);
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
      if (exportOptions.transactions) {
        exportData.transactions = await api.transactions.list();
      }
      if (exportOptions.accounts) {
        exportData.accounts = await api.accounts.list();
      }
      if (exportOptions.categories) {
        exportData.categories = await api.categories.list();
        exportData.tags = []; // TODO: add tags API
      }
      if (exportOptions.budgets) {
        exportData.budgets = await api.budgets.list();
        exportData.periods = await api.periods.list();
      }
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
  }, [exportOptions, settings]);

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
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-mono text-3xl font-bold">Settings</h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              Configure your app preferences
            </p>
          </div>
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
                  'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all duration-200 relative',
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
            <div className="max-w-2xl animate-in fade-in duration-300">
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
                        onClick={() => setSettings({ ...settings, theme: value as any })}
                        className={cn(
                          'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all',
                          settings.theme === value
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
                    Auto follows your system preference. Theme changes will apply on next reload.
                  </p>
                </div>
              </Card>
            </div>
          )}

          {/* Data Tab */}
          {activeTab === 'data' && (
            <div className="space-y-6 animate-in fade-in duration-300">
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
              <span>Logged in as rayhanmpramanda@gmail.com</span>
            </div>
            <div className="flex items-center gap-4">
              <span>Fainens v1.0.0</span>
              <Button variant="secondary" size="sm" onClick={() => api.auth.logout()}>
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
      </div>
    </RequireAuth>
  );
}
