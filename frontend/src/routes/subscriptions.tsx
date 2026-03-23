import { createFileRoute } from '@tanstack/react-router';
import {
  Car,
  Film,
  Music,
  Signal,
  TrendingDown,
  Sparkles,
  Plus,
  CalendarClock,
  Pencil,
  Trash2,
  CreditCard,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RequireAuth } from '../lib/auth';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { CurrencyInput } from '../components/ui/CurrencyInput';
import { cn, formatCurrency, parseIdNominalToInt } from '../lib/utils';

export const Route = createFileRoute('/subscriptions')({
  component: SubscriptionsPage,
} as any);

type SubStatus = 'active' | 'expiring' | 'paused';

type ApiSubscription = {
  id: number;
  name: string;
  linkedAccountId: number;
  linkedAccountName: string;
  categoryId: number | null;
  amount: number;
  billingCycle: string;
  nextRenewalAt: number;
  status: string;
  iconKey: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

const ICON_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'car', label: 'Transport' },
  { value: 'film', label: 'Video' },
  { value: 'music', label: 'Music' },
  { value: 'signal', label: 'Mobile / data' },
  { value: 'sparkles', label: 'Other' },
] as const;

const BILLING_CYCLE_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
] as const;

const ICON_MAP: Record<string, typeof Car> = {
  car: Car,
  film: Film,
  music: Music,
  signal: Signal,
  sparkles: Sparkles,
  default: CalendarClock,
};

function toDateInputValue(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fromDateInputValue(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

function deriveDisplayStatus(row: { status: string; nextRenewalAt: number }): SubStatus {
  if (row.status === 'paused') return 'paused';
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  if (row.status === 'active' && row.nextRenewalAt <= now + week) return 'expiring';
  return 'active';
}

function statusBadge(status: SubStatus) {
  switch (status) {
    case 'active':
      return (
        <span className="rounded-full bg-[var(--ref-secondary-container)]/30 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ref-secondary)]">
          Active
        </span>
      );
    case 'expiring':
      return (
        <span className="rounded-full bg-[var(--ref-error)]/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ref-error)]">
          Due soon
        </span>
      );
    case 'paused':
      return (
        <span className="rounded-full bg-[var(--ref-surface-container)] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ref-on-surface-variant)]">
          Paused
        </span>
      );
  }
}

function formatShortDate(ms: number) {
  return new Date(ms).toLocaleDateString('en-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatBillingCycle(cycle: string) {
  return cycle === 'annual' ? '/yr' : '/mo';
}

function SubscriptionsPage() {
  const [rows, setRows] = useState<ApiSubscription[]>([]);
  const [accounts, setAccounts] = useState<Array<{ id: number; name: string }>>([]);
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    linkedAccountId: '',
    categoryId: '',
    amountDisplay: '',
    billingCycle: 'monthly',
    nextRenewalDate: '',
    status: 'active',
    iconKey: 'default',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setBanner(null);
    try {
      const [data, accs, cats] = await Promise.all([
        api.subscriptions.list(),
        api.accounts.list(),
        api.categories.list(),
      ]);
      setRows(data.subscriptions);
      setAccounts(accs.map((a) => ({ id: a.id, name: a.name })));
      setCategories(cats.map((c) => ({ id: c.id, name: c.name })));
      if (data.renewal.errors.length > 0) {
        setBanner({ type: 'error', text: data.renewal.errors.join(' ') });
      } else if (data.renewal.processed > 0) {
        setBanner({
          type: 'success',
          text: `Posted ${data.renewal.processed} renewal charge(s) to Transactions.`,
        });
      }
    } catch (e) {
      setBanner({ type: 'error', text: e instanceof Error ? e.message : 'Failed to load subscriptions' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      name: '',
      linkedAccountId: accounts.length > 0 ? String(accounts[0].id) : '',
      categoryId: '',
      amountDisplay: '',
      billingCycle: 'monthly',
      nextRenewalDate: toDateInputValue(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: 'active',
      iconKey: 'default',
    });
    setModalOpen(true);
  };

  const openEdit = (s: ApiSubscription) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      linkedAccountId: String(s.linkedAccountId),
      categoryId: s.categoryId != null ? String(s.categoryId) : '',
      amountDisplay: new Intl.NumberFormat('id-ID').format(s.amount),
      billingCycle: s.billingCycle,
      nextRenewalDate: toDateInputValue(s.nextRenewalAt),
      status: s.status,
      iconKey: ICON_OPTIONS.some((o) => o.value === s.iconKey) ? s.iconKey : 'default',
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setBanner({ type: 'error', text: 'Name is required.' });
      return;
    }
    if (!form.linkedAccountId) {
      setBanner({ type: 'error', text: 'Please select a payment account.' });
      return;
    }
    const amount = parseIdNominalToInt(form.amountDisplay);
    if (!Number.isFinite(amount) || amount < 0) {
      setBanner({ type: 'error', text: 'Enter a valid amount.' });
      return;
    }
    if (!form.nextRenewalDate) {
      setBanner({ type: 'error', text: 'Pick a next renewal date.' });
      return;
    }
    const nextRenewalAt = fromDateInputValue(form.nextRenewalDate);
    const linkedAccountId = parseInt(form.linkedAccountId, 10);
    const categoryId = form.categoryId === '' ? null : parseInt(form.categoryId, 10);

    setSaving(true);
    setBanner(null);
    try {
      if (editingId == null) {
        await api.subscriptions.create({
          name,
          linkedAccountId,
          categoryId,
          amount,
          billingCycle: form.billingCycle,
          nextRenewalAt,
          status: form.status,
          iconKey: form.iconKey,
        });
        setBanner({ type: 'success', text: 'Subscription added.' });
      } else {
        await api.subscriptions.update(editingId, {
          name,
          linkedAccountId,
          categoryId,
          amount,
          billingCycle: form.billingCycle,
          nextRenewalAt,
          status: form.status,
          iconKey: form.iconKey,
        });
        setBanner({ type: 'success', text: 'Subscription updated.' });
      }
      closeModal();
      await load();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number, label: string) => {
    if (!window.confirm(`Remove "${label}" from subscriptions?`)) return;
    setBanner(null);
    try {
      await api.subscriptions.delete(id);
      setBanner({ type: 'success', text: 'Subscription removed.' });
      await load();
    } catch (e) {
      setBanner({ type: 'error', text: e instanceof Error ? e.message : 'Delete failed' });
    }
  };

  // Calculate total monthly equivalent
  const totalMonthly = useMemo(
    () => rows.filter((r) => r.status === 'active').reduce((s, r) => {
      const monthlyEquivalent = r.billingCycle === 'annual' ? r.amount / 12 : r.amount;
      return s + monthlyEquivalent;
    }, 0),
    [rows],
  );

  const activeCount = useMemo(() => rows.filter((r) => r.status === 'active').length, [rows]);

  const uniqueAccounts = useMemo(() => new Set(rows.map((r) => r.linkedAccountId)).size, [rows]);

  const sortedByRenewal = useMemo(
    () => [...rows].sort((a, b) => a.nextRenewalAt - b.nextRenewalAt),
    [rows],
  );

  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const monthMs = 30 * 24 * 60 * 60 * 1000;

  const renew7 = sortedByRenewal.filter(
    (r) => r.status === 'active' && r.nextRenewalAt >= now - weekMs && r.nextRenewalAt <= now + weekMs,
  );
  const renew30 = sortedByRenewal.filter(
    (r) =>
      r.status === 'active' &&
      r.nextRenewalAt > now + weekMs &&
      r.nextRenewalAt <= now + monthMs,
  );

  return (
    <RequireAuth>
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        {banner && (
          <div
            className={cn(
              'mb-6 rounded-xl border px-4 py-3 text-sm',
              banner.type === 'error'
                ? 'border-[var(--color-danger)] bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
                : 'border-[var(--ref-secondary)] bg-[var(--ref-secondary-container)]/30 text-[var(--ref-on-secondary-container)]',
            )}
          >
            {banner.text}
          </div>
        )}

        <header className="mb-12 flex flex-col justify-between gap-6 md:mb-16 md:flex-row md:items-end">
          <div>
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-[var(--ref-tertiary)]">
              Total monthly commitment
            </p>
            <h1 className="font-headline text-5xl font-extrabold tracking-tighter text-[var(--ref-on-surface)] md:text-6xl lg:text-7xl">
              {formatCurrency(totalMonthly)}
              <span className="ml-1 text-2xl font-medium text-[var(--ref-on-surface-variant)]">/mo</span>
            </h1>
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2 rounded-full bg-[var(--ref-secondary-container)] px-4 py-2 text-sm font-semibold text-[var(--ref-on-secondary-container)]">
              <TrendingDown className="h-4 w-4 shrink-0" aria-hidden />
              {activeCount} active · {uniqueAccounts} payment source{uniqueAccounts === 1 ? '' : 's'}
            </div>
            <Button type="button" className="rounded-full shadow-md" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add subscription
            </Button>
          </div>
        </header>

        {loading ? (
          <p className="text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
              <section className="space-y-8 md:col-span-8">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-headline text-2xl font-bold text-[var(--ref-on-surface)]">
                    Subscriptions
                  </h2>
                </div>
                {rows.length === 0 ? (
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-10 text-center editorial-shadow">
                    <p className="mb-4 text-[var(--ref-on-surface-variant)]">
                      No subscriptions yet. Add recurring bills or streaming services to track renewals.
                    </p>
                    <Button type="button" className="rounded-full" onClick={openCreate}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add your first subscription
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {rows.map((sub) => {
                      const Icon = ICON_MAP[sub.iconKey] ?? ICON_MAP.default;
                      const display = deriveDisplayStatus(sub);
                      const highlight = display === 'expiring';
                      return (
                        <div
                          key={sub.id}
                          className={cn(
                            'group rounded-xl bg-[var(--ref-surface-container-lowest)] p-6 transition-all duration-300 editorial-shadow hover:shadow-[0px_20px_40px_rgba(25,27,35,0.06)]',
                            highlight && 'border-b-2 border-[var(--ref-primary)]',
                          )}
                        >
                          <div className="mb-6 flex items-start justify-between gap-2">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--ref-surface-container-highest)]">
                              <Icon
                                className={cn(
                                  'h-6 w-6',
                                  display === 'expiring' && 'text-[var(--ref-error)]',
                                  display === 'paused' && 'text-[var(--ref-secondary)]',
                                  display === 'active' &&
                                    sub.iconKey === 'signal' &&
                                    'text-[var(--ref-primary)]',
                                  display === 'active' &&
                                    sub.iconKey !== 'signal' &&
                                    'text-[var(--ref-secondary)]',
                                )}
                                aria-hidden
                              />
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              {statusBadge(display)}
                              <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 md:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => openEdit(sub)}
                                  className="rounded-full p-2 text-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/10 cursor-pointer"
                                  aria-label={`Edit ${sub.name}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void remove(sub.id, sub.name)}
                                  className="rounded-full p-2 text-[var(--ref-error)] hover:bg-[var(--ref-error)]/10 cursor-pointer"
                                  aria-label={`Remove ${sub.name}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                          <h3 className="mb-1 font-headline text-xl font-bold text-[var(--ref-on-surface)]">
                            {sub.name}
                          </h3>
                          <p className="mb-4 text-sm text-[var(--ref-on-surface-variant)]">
                            Linked to{' '}
                            <span className="font-semibold text-[var(--ref-on-surface)]">{sub.linkedAccountName}</span>
                          </p>
                          <div className="flex items-end justify-between">
                            <div>
                              <p className="font-mono text-xs uppercase text-[var(--ref-on-surface-variant)]/70">
                                {sub.status === 'paused' ? 'Resume / next' : 'Next renewal'}
                              </p>
                              <p className="font-semibold text-[var(--ref-on-surface)]">
                                {formatShortDate(sub.nextRenewalAt)}
                              </p>
                            </div>
                            <p className="font-headline text-lg font-bold text-[var(--ref-on-surface)]">
                              {formatCurrency(sub.amount)}{formatBillingCycle(sub.billingCycle)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <aside className="space-y-8 md:col-span-4">
                <div className="rounded-xl bg-[var(--ref-surface-container-low)] p-8">
                  <h2 className="mb-6 font-headline text-xl font-bold text-[var(--ref-on-surface)]">
                    Upcoming renewals
                  </h2>
                  <div className="relative space-y-6">
                    <div
                      className="absolute bottom-0 left-4 top-0 w-px bg-[var(--ref-outline-variant)]/30"
                      aria-hidden
                    />
                    <div className="relative pl-10">
                      <div
                        className="absolute left-[13px] top-1.5 h-2 w-2 rounded-full border-4 border-[var(--ref-surface-container-lowest)] bg-[var(--ref-primary)] ring-2 ring-[var(--ref-primary)]"
                        aria-hidden
                      />
                      <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[var(--ref-primary)]">
                        Next 7 days
                      </p>
                      {renew7.length === 0 ? (
                        <p className="text-sm text-[var(--ref-on-surface-variant)]">None scheduled.</p>
                      ) : (
                        <div className="space-y-2">
                          {renew7.map((r) => (
                            <div key={r.id} className="rounded-xl bg-[var(--ref-surface-container-lowest)] p-4">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-semibold text-[var(--ref-on-surface)]">{r.name}</span>
                                <span className="text-sm font-bold text-[var(--ref-on-surface)]">
                                  {formatCurrency(r.amount)}
                                </span>
                              </div>
                              <p className="text-[11px] text-[var(--ref-on-surface-variant)]">
                                Due {formatShortDate(r.nextRenewalAt)} · {r.linkedAccountName}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="relative pl-10">
                      <div
                        className="absolute left-[13px] top-1.5 h-2 w-2 rounded-full border-4 border-[var(--ref-surface-container-lowest)] bg-[var(--ref-outline-variant)] ring-2 ring-[var(--ref-outline-variant)]"
                        aria-hidden
                      />
                      <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[var(--ref-on-surface-variant)]">
                        Next 30 days (after 7d)
                      </p>
                      {renew30.length === 0 ? (
                        <p className="text-sm text-[var(--ref-on-surface-variant)]">None in this window.</p>
                      ) : (
                        <div className="space-y-2">
                          {renew30.map((r) => (
                            <div key={r.id} className="rounded-xl bg-[var(--ref-surface-container-lowest)] p-4">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-semibold text-[var(--ref-on-surface)]">{r.name}</span>
                                <span className="text-sm font-bold text-[var(--ref-on-surface)]">
                                  {formatCurrency(r.amount)}
                                </span>
                              </div>
                              <p className="text-[11px] text-[var(--ref-on-surface-variant)]">
                                Due {formatShortDate(r.nextRenewalAt)} · {r.linkedAccountName}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="group relative overflow-hidden rounded-xl bg-[var(--ref-primary)] p-8 text-white">
                  <div
                    className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/10 blur-3xl transition-transform duration-700 group-hover:scale-110"
                    aria-hidden
                  />
                  <Sparkles className="mb-4 h-8 w-8" aria-hidden />
                  <h2 className="mb-4 font-headline text-xl font-bold">Tips</h2>
                  <p className="text-xs leading-relaxed text-white/80">
                    After the renewal moment passes, Fainens posts an expense to <strong className="text-white">Transactions</strong>{' '}
                    and advances the next date by the billing cycle. Use{' '}
                    <strong className="text-white">paused</strong> to skip charges without posting.
                  </p>
                </div>
              </aside>
            </div>

            <section className="mt-16">
              <h2 className="mb-8 font-headline text-2xl font-bold text-[var(--ref-on-surface)]">
                Linked payment accounts
              </h2>
              {uniqueAccounts === 0 ? (
                <p className="text-sm text-[var(--ref-on-surface-variant)]">
                  Accounts appear from the subscriptions you create.
                </p>
              ) : (
                <div className="flex flex-wrap gap-4">
                  {[...new Set(rows.map((r) => r.linkedAccountName))].map((label) => (
                    <div
                      key={label}
                      className="flex items-center gap-4 rounded-full border border-[var(--ref-outline-variant)]/20 bg-[var(--ref-surface-container-high)] px-6 py-4"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ref-primary)] text-[10px] font-bold text-white">
                        {label.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs font-bold leading-none text-[var(--ref-on-surface)]">{label}</p>
                        <p className="text-[10px] font-medium text-[var(--ref-on-surface-variant)]">
                          Used in {rows.filter((r) => r.linkedAccountName === label).length} subscription(s)
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <Modal
          isOpen={modalOpen}
          onClose={closeModal}
          title={editingId == null ? 'Add subscription' : 'Edit subscription'}
          subtitle="When the renewal date passes, an expense is posted to Transactions (tx type: subscription_renewal). Link a wallet or card account so the charge can be recorded."
          size="xl"
        >
          <form onSubmit={(e) => void submitForm(e)} className="flex flex-col gap-0">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
              <div className="lg:col-span-8 space-y-6 lg:space-y-8">
                {/* Billing Cycle Toggle */}
                <div className="inline-flex p-0.5 bg-[var(--ref-surface-container)] rounded-full flex-wrap gap-0.5">
                  {BILLING_CYCLE_OPTIONS.map((cycle) => (
                    <button
                      key={cycle.value}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, billingCycle: cycle.value }))}
                      className={cn(
                        'cursor-pointer inline-flex items-center gap-1.5 px-4 sm:px-5 py-2 rounded-full text-sm transition-all',
                        form.billingCycle === cycle.value
                          ? 'bg-[var(--ref-surface-container-lowest)] text-[var(--color-accent)] font-bold shadow-sm'
                          : 'text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-accent)]',
                      )}
                    >
                      {cycle.label}
                    </button>
                  ))}
                </div>

                {/* Amount Input */}
                <CurrencyInput
                  label="Amount"
                  value={form.amountDisplay}
                  onChange={(value) =>
                    setForm((f) => ({ ...f, amountDisplay: value }))
                  }
                  size="lg"
                  required
                />

                {/* Name & Date */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
                  <div className="md:col-span-2 space-y-2">
                    <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                      Subscription name
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Netflix, Spotify, Gym membership"
                      className="w-full bg-[var(--ref-surface-container-low)] border-none rounded-xl px-3 py-3 focus:ring-2 focus:ring-[var(--color-accent)]/20 text-[var(--color-text-primary)] transition-all"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                      Next renewal date
                    </label>
                    <input
                      type="date"
                      value={form.nextRenewalDate}
                      onChange={(e) => setForm((f) => ({ ...f, nextRenewalDate: e.target.value }))}
                      className="w-full bg-[var(--ref-surface-container-low)] border-none rounded-xl px-3 py-3 focus:ring-2 focus:ring-[var(--color-accent)]/20 text-[var(--color-text-primary)] transition-all"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                      Status
                    </label>
                    <div className="relative">
                      <select
                        value={form.status}
                        onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                        className="w-full appearance-none bg-[var(--ref-surface-container-low)] border-none rounded-xl px-3 py-3 focus:ring-2 focus:ring-[var(--color-accent)]/20 text-[var(--color-text-primary)] transition-all"
                      >
                        <option value="active">Active</option>
                        <option value="paused">Paused</option>
                      </select>
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-muted)] text-lg">
                        ▾
                      </span>
                    </div>
                  </div>
                </div>

                {/* Category */}
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                    Category (for posted expense)
                  </label>
                  <div className="relative">
                    <select
                      value={form.categoryId}
                      onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                      className="w-full appearance-none bg-[var(--ref-surface-container-low)] border-none rounded-xl px-3 py-3 focus:ring-2 focus:ring-[var(--color-accent)]/20 text-[var(--color-text-primary)] transition-all"
                    >
                      <option value="">None</option>
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

                {/* Pay from Account */}
                <div className="space-y-4">
                  <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                    Pay from account
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {accounts.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, linkedAccountId: String(a.id) }))}
                        className={cn(
                          'flex flex-col items-start p-4 rounded-xl transition-all text-left min-h-[96px]',
                          form.linkedAccountId === String(a.id)
                            ? 'bg-[var(--ref-surface-container-lowest)] border-2 border-[var(--ref-primary-container)] shadow-sm'
                            : 'bg-[var(--ref-surface-container-low)] border-2 border-transparent hover:border-[var(--ref-surface-container-highest)]',
                        )}
                      >
                        <CreditCard
                          className={cn(
                            'w-6 h-6 mb-2',
                            form.linkedAccountId === String(a.id) ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]',
                          )}
                        />
                        <span className="text-xs font-bold text-[var(--color-text-primary)] line-clamp-2">
                          {a.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Sidebar */}
              <div className="lg:col-span-4 space-y-6">
                <div className="rounded-xl bg-[var(--ref-surface-container-low)] p-6">
                  <h3 className="font-headline font-bold text-lg mb-4">Icon</h3>
                  <div className="grid grid-cols-3 gap-3">
                    {ICON_OPTIONS.map((icon) => {
                      const Icon = ICON_MAP[icon.value];
                      return (
                        <button
                          key={icon.value}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, iconKey: icon.value }))}
                          className={cn(
                            'flex flex-col items-center justify-center p-4 rounded-xl transition-all',
                            form.iconKey === icon.value
                              ? 'bg-[var(--ref-surface-container-lowest)] border-2 border-[var(--ref-primary-container)] shadow-sm'
                              : 'bg-[var(--ref-surface-container)] border-2 border-transparent hover:border-[var(--ref-surface-container-highest)]',
                          )}
                        >
                          <Icon
                            className={cn(
                              'w-6 h-6 mb-2',
                              form.iconKey === icon.value ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]',
                            )}
                          />
                          <span className="text-[10px] font-medium text-[var(--color-text-secondary)] text-center">
                            {icon.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)]/50 p-4 text-sm text-[var(--color-text-secondary)]">
                  <strong className="text-[var(--color-text-primary)]">Auto-renewal:</strong> When the renewal date passes, an expense transaction is automatically posted to your Transactions page.
                </div>
              </div>
            </div>

            {/* Sticky Footer */}
            <div className="sticky bottom-0 z-10 -mx-5 mt-6 flex flex-col gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 px-5 py-4 backdrop-blur-sm shadow-[0_-10px_30px_-12px_rgba(15,23,42,0.12)] lg:-mx-6 lg:px-6">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                <Button type="button" variant="secondary" onClick={closeModal} className="rounded-full py-3 sm:min-w-[120px]">
                  Cancel
                </Button>
                <Button
                  type="submit"
                  isLoading={saving}
                  className="rounded-full py-3 shadow-lg sm:min-w-[200px]"
                >
                  <Plus className="w-5 h-5" />
                  {editingId == null ? 'Add subscription' : 'Save changes'}
                </Button>
              </div>
            </div>
          </form>
        </Modal>
      </div>
    </RequireAuth>
  );
}
