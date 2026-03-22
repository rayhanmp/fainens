import { createFileRoute, Link } from '@tanstack/react-router';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { RequireAuth } from '../lib/auth';
import { useEffect, useState } from 'react';
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
  Save,
  CreditCard,
  User,
  Settings2,
  BarChart3,
  Tag,
  Shield,
  CalendarDays,
} from 'lucide-react';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
} as any);

interface AppSettings {
  currency: string;
  opportunityCostYield: number;
  salaryDay: number;
  defaultBankAccountId: number | null;
  defaultExpenseAccountId: number | null;
  defaultIncomeAccountId: number | null;
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

function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({
    currency: 'IDR',
    opportunityCostYield: 4.0,
    salaryDay: 25,
    defaultBankAccountId: null,
    defaultExpenseAccountId: null,
    defaultIncomeAccountId: null,
  });
  const [accounts, setAccounts] = useState<Array<{ id: number; name: string; type: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [showClearCacheModal, setShowClearCacheModal] = useState(false);
  const [showDeleteDataModal, setShowDeleteDataModal] = useState(false);
  const [appVersion] = useState('1.0.0');

  useEffect(() => {
    loadSettings();
    loadAccounts();
  }, []);

  const loadSettings = async () => {
    try {
      const saved = localStorage.getItem('fainens-settings');
      const parsed = saved ? JSON.parse(saved) : {};

      setSettings({
        currency: parsed.currency || 'IDR',
        opportunityCostYield: parsed.opportunityCostYield ?? 4.0,
        salaryDay: parsed.salaryDay || 25,
        defaultBankAccountId: parsed.defaultBankAccountId || null,
        defaultExpenseAccountId: parsed.defaultExpenseAccountId || null,
        defaultIncomeAccountId: parsed.defaultIncomeAccountId || null,
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

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage('');

    try {
      localStorage.setItem('fainens-settings', JSON.stringify({
        currency: settings.currency,
        opportunityCostYield: settings.opportunityCostYield,
        salaryDay: settings.salaryDay,
        defaultBankAccountId: settings.defaultBankAccountId,
        defaultExpenseAccountId: settings.defaultExpenseAccountId,
        defaultIncomeAccountId: settings.defaultIncomeAccountId,
      }));

      setSaveMessage('Settings saved successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (err) {
      setSaveMessage('Failed to save settings: ' + (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearCache = () => {
    localStorage.removeItem('fainens-cache');
    sessionStorage.clear();
    setShowClearCacheModal(false);
    setSaveMessage('Cache cleared!');
    setTimeout(() => setSaveMessage(''), 3000);
  };

  const handleDeleteAllData = () => {
    // In a real app, this would call a backend endpoint to wipe data
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = '/login';
  };

  const getAccountOptions = (type?: string) => {
    const options = [{ value: '', label: 'None (Auto-select)' }];
    const filtered = type ? accounts.filter((a) => a.type === type) : accounts;
    return [
      ...options,
      ...filtered.map((a) => ({ value: a.id.toString(), label: a.name })),
    ];
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
          {saveMessage && (
            <div
              className={cn(
                'flex items-center gap-2 px-4 py-2 border-2',
                saveMessage.includes('Failed')
                  ? 'border-[var(--color-danger)] bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
                  : 'border-[var(--color-success)] bg-[var(--color-success)]/10 text-[var(--color-success)]'
              )}
            >
              {saveMessage.includes('Failed') ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              <span className="font-mono text-sm">{saveMessage}</span>
            </div>
          )}
        </div>

        <Card title="Quick links">
          <p className="text-sm text-[var(--color-text-secondary)] mb-4 md:hidden">
            On mobile, the bottom bar lists core screens — jump to everything else here.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { to: '/categories', label: 'Categories', icon: Tag },
              { to: '/reports', label: 'Reports', icon: BarChart3 },
              { to: '/paylater', label: 'Pay later', icon: CreditCard },
              { to: '/periods', label: 'Salary periods', icon: CalendarDays },
              { to: '/audit-log', label: 'Security audit', icon: Shield },
            ].map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10 transition-colors"
              >
                <Icon className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                {label}
              </Link>
            ))}
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Currency Settings */}
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
              <p className="text-xs text-[var(--color-muted)]">
                This affects how amounts are displayed throughout the app.
              </p>
            </div>
          </Card>

          {/* Opportunity Cost Settings */}
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

          {/* Salary Period Settings */}
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

          {/* Default Accounts */}
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

          {/* User Profile */}
          <Card
            title={
              <div className="flex items-center gap-2">
                <User className="w-5 h-5" />
                User Profile
              </div>
            }
          >
            <div className="space-y-4">
              <div className="p-4 bg-[var(--color-accent)]/10 border-2 border-[var(--color-border)]">
                <p className="text-sm text-[var(--color-text-secondary)]">Logged in as</p>
                <p className="font-mono font-bold">your.email@gmail.com</p>
                <p className="text-xs text-[var(--color-muted)] mt-1">
                  Single-user mode is enabled
                </p>
              </div>
              <Button variant="secondary" className="w-full" onClick={() => api.auth.logout()}>
                Sign Out
              </Button>
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
                className="w-full"
                onClick={() => setShowClearCacheModal(true)}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Clear Local Cache
              </Button>
              <Button
                variant="secondary"
                className="w-full text-[var(--color-danger)] border-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
                onClick={() => setShowDeleteDataModal(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete All Data
              </Button>
              <p className="text-xs text-[var(--color-muted)]">
                Clear cache fixes display issues. Delete all data wipes everything permanently.
              </p>
            </div>
          </Card>

          {/* About */}
          <Card
            title={
              <div className="flex items-center gap-2">
                <Settings2 className="w-5 h-5" />
                About
              </div>
            }
          >
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-[var(--color-border)]">
                <span className="text-[var(--color-text-secondary)]">App Version</span>
                <span className="font-mono">{appVersion}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-[var(--color-border)]">
                <span className="text-[var(--color-text-secondary)]">Database</span>
                <span className="font-mono">SQLite (better-sqlite3)</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-[var(--color-border)]">
                <span className="text-[var(--color-text-secondary)]">Cache</span>
                <span className="font-mono">Redis</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-[var(--color-text-secondary)]">Frontend</span>
                <span className="font-mono">React + Vite + Tailwind</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button onClick={handleSave} isLoading={isSaving} size="lg">
            <Save className="w-5 h-5 mr-2" />
            Save Settings
          </Button>
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
