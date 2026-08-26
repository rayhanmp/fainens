import { createFileRoute } from '@tanstack/react-router';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { RequireAuth } from '../lib/auth';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDate } from '../lib/utils';
import { Plus, Calendar, ChevronRight, Edit2, Trash2, TrendingUp, Wallet, Lock, LockOpen, History } from 'lucide-react';
import { useConfirm } from '../components/ui/ConfirmDialog';

export const Route = createFileRoute('/periods')({
  component: PeriodsPage,
} as any);

interface Period {
  id: number;
  name: string;
  startDate: number;
  endDate: number;
  status: 'open' | 'closed';
  closedAt: number | null;
  reopenedAt: number | null;
  coverageStatus: 'complete' | 'partial' | 'skipped' | 'unknown';
  coverageReason: string | null;
}

function PeriodsPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<Period | null>(null);
  const { confirm } = useConfirm();
  const [suggestedDates, setSuggestedDates] = useState<{
    suggestedName: string;
    suggestedStartDate: string;
    suggestedEndDate: string;
  } | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    startDate: '',
    endDate: '',
  });
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [returnPreview, setReturnPreview] = useState<Array<{ name: string; startDate: number; endDate: number; isCurrent: boolean }>>([]);
  const [returnError, setReturnError] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [periodsData, suggestion] = await Promise.all([
        api.periods.list(),
        api.periods.suggestNext(),
      ]);
      setPeriods(periodsData);
      setSuggestedDates(suggestion);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setIsSubmitting(true);

    const start = new Date(formData.startDate);
    const end = new Date(formData.endDate);

    if (end <= start) {
      setFormError('End date must be after start date');
      setIsSubmitting(false);
      return;
    }

    try {
      if (editingPeriod) {
        await api.periods.update(editingPeriod.id, {
          name: formData.name,
          startDate: formData.startDate,
          endDate: formData.endDate,
        });
      } else {
        await api.periods.create({
          name: formData.name,
          startDate: formData.startDate,
          endDate: formData.endDate,
        });
      }
      await loadData();
      closeModal();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    const confirmed = await confirm({
      title: 'Delete Period',
      message: 'Are you sure you want to delete this period? All associated budgets will be deleted.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/periods/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to delete');
      await loadData();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleAutoCreate = async () => {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/periods/auto-create', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to create' }));
        throw new Error(error.error || 'Failed to create period');
      }
      await loadData();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = async (period: Period) => {
    const confirmed = await confirm({
      title: 'Close Accounting Period',
      message: `Close ${period.name}? New or backdated journals and budget changes for this period will be blocked until you explicitly reopen it.`,
      confirmLabel: 'Close Period',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.periods.close(period.id);
      await loadData();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleReopen = async (period: Period) => {
    const confirmed = await confirm({
      title: 'Reopen Accounting Period',
      message: `Reopen ${period.name}? This permits new corrections and budget changes in that historical period.`,
      confirmLabel: 'Reopen Period',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.periods.reopen(period.id);
      await loadData();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const openModal = (period?: Period) => {
    if (period) {
      setEditingPeriod(period);
      setFormData({
        name: period.name,
        startDate: new Date(period.startDate).toISOString().split('T')[0],
        endDate: new Date(period.endDate).toISOString().split('T')[0],
      });
    } else if (suggestedDates) {
      setEditingPeriod(null);
      setFormData({
        name: suggestedDates.suggestedName,
        startDate: suggestedDates.suggestedStartDate,
        endDate: suggestedDates.suggestedEndDate,
      });
    } else {
      setEditingPeriod(null);
      setFormData({ name: '', startDate: '', endDate: '' });
    }
    setFormError('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPeriod(null);
    setFormData({ name: '', startDate: '', endDate: '' });
    setFormError('');
  };

  const loadReturnPreview = async (date = returnDate) => {
    setReturnError('');
    const asOfDate = new Date(`${date}T23:59:59.999`).getTime();
    try {
      const result = await api.periods.returnPreview(asOfDate);
      if (result.reason) {
        setReturnPreview([]);
        setReturnError(result.reason);
      } else {
        setReturnPreview(result.candidates);
      }
    } catch (err) {
      setReturnPreview([]);
      setReturnError((err as Error).message);
    }
  };

  const openReturnModal = () => {
    const date = new Date().toISOString().slice(0, 10);
    setReturnDate(date);
    setReturnPreview([]);
    setReturnError('');
    setIsReturnModalOpen(true);
    void loadReturnPreview(date);
  };

  const createReturnBackfill = async () => {
    const asOfDate = new Date(`${returnDate}T23:59:59.999`).getTime();
    setIsSubmitting(true);
    setReturnError('');
    try {
      await api.periods.createReturnBackfill(asOfDate);
      await loadData();
      setIsReturnModalOpen(false);
    } catch (err) {
      setReturnError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RequireAuth>
      <PageContainer>
        <div className="flex items-center justify-between">
          <PageHeader
            subtext="Period tracking"
            title="Salary Periods"
          />
          <div className="flex gap-2">
            <Button onClick={openReturnModal} variant="secondary">
              <History className="w-4 h-4 mr-2" />
              Returning After a Break
            </Button>
            <Button onClick={handleAutoCreate} isLoading={isSubmitting} variant="secondary">
              <Plus className="w-4 h-4 mr-2" />
              Auto-Create Next
            </Button>
            <Button onClick={() => openModal()}>
              <Plus className="w-4 h-4 mr-2" />
              New Period
            </Button>
          </div>
        </div>

        {isLoading ? (
          <Card className="p-8 text-center">
            <p>Loading periods...</p>
          </Card>
        ) : periods.length === 0 ? (
          <Card className="p-8 text-center">
            <Calendar className="w-12 h-12 mx-auto mb-4 text-[var(--color-muted)]" />
            <p className="text-[var(--color-text-secondary)] mb-4">
              No salary periods yet. Create your first period to start budgeting.
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={handleAutoCreate} isLoading={isSubmitting}>
                <Plus className="w-4 h-4 mr-2" />
                Auto-Create This Month
              </Button>
              <Button variant="secondary" onClick={() => openModal()}>
                Custom Period
              </Button>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {periods.map((period) => (
              <Card key={period.id} className="hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-mono font-bold text-lg">{period.name}</h3>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {formatDate(period.startDate)} - {formatDate(period.endDate)}
                    </p>
                    <span className={`inline-flex mt-2 px-2 py-0.5 text-xs font-mono border ${period.status === 'closed'
                      ? 'border-[var(--color-warning)] text-[var(--color-warning)]'
                      : 'border-[var(--color-success)] text-[var(--color-success)]'}`}>
                      {period.status === 'closed' ? 'CLOSED' : 'OPEN'}
                    </span>
                    <span className={`ml-2 inline-flex mt-2 px-2 py-0.5 text-xs font-mono border ${period.coverageStatus === 'complete'
                      ? 'border-[var(--color-success)] text-[var(--color-success)]'
                      : period.coverageStatus === 'partial'
                        ? 'border-[var(--color-warning)] text-[var(--color-warning)]'
                        : 'border-[var(--ref-outline)] text-[var(--ref-on-surface-variant)]'}`} title={period.coverageReason ?? undefined}>
                      {period.coverageStatus.toUpperCase()} COVERAGE
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {period.status === 'closed' ? (
                      <button
                        title="Reopen period"
                        onClick={() => handleReopen(period)}
                        className="cursor-pointer p-1 hover:bg-[var(--color-accent)]/20 transition-colors"
                      >
                        <LockOpen className="w-4 h-4" />
                      </button>
                    ) : <>
                      <button
                        title="Close period"
                        onClick={() => handleClose(period)}
                        className="cursor-pointer p-1 hover:bg-[var(--color-warning)]/20 text-[var(--color-warning)] transition-colors"
                      >
                        <Lock className="w-4 h-4" />
                      </button>
                      <button
                        title="Edit period"
                        onClick={() => openModal(period)}
                        className="cursor-pointer p-1 hover:bg-[var(--color-accent)]/20 transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        title="Delete period"
                        onClick={() => handleDelete(period.id)}
                        className="cursor-pointer p-1 hover:bg-[var(--color-danger)]/20 text-[var(--color-danger)] transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>}
                  </div>
                </div>

                <div className="space-y-3">
                  <a
                    href={`/budget?periodId=${period.id}`}
                    className="flex items-center justify-between p-3 bg-[var(--color-accent)]/10 hover:bg-[var(--color-accent)]/20 transition-colors border-2 border-[var(--color-border)]"
                  >
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4" />
                      <span className="font-mono text-sm">Budget</span>
                    </div>
                    <ChevronRight className="w-4 h-4" />
                  </a>

                  <a
                    href={`/transactions?periodId=${period.id}`}
                    className="flex items-center justify-between p-3 bg-[var(--color-accent)]/10 hover:bg-[var(--color-accent)]/20 transition-colors border-2 border-[var(--color-border)]"
                  >
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" />
                      <span className="font-mono text-sm">Transactions</span>
                    </div>
                    <ChevronRight className="w-4 h-4" />
                  </a>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Modal */}
        <Modal
          isOpen={isReturnModalOpen}
          onClose={() => setIsReturnModalOpen(false)}
          title="Return after an untracked break"
          subtitle="Create period headers that explicitly say activity was not tracked. This creates no transactions, budgets, or opening balances."
        >
          <div className="space-y-4">
            <Input
              label="Return / balance snapshot date"
              type="date"
              value={returnDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => {
                setReturnDate(event.target.value);
                void loadReturnPreview(event.target.value);
              }}
            />
            {returnError && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{returnError}</p>}
            {!returnError && (
              <div className="rounded-md border border-[var(--color-border)] p-3 text-sm">
                {returnPreview.length === 0 ? (
                  <p className="text-[var(--color-text-secondary)]">No missing periods were found before this date.</p>
                ) : (
                  <>
                    <p className="mb-2 font-semibold">{returnPreview.length} periods will be created as skipped coverage</p>
                    <ul className="max-h-48 space-y-1 overflow-auto text-[var(--color-text-secondary)]">
                      {returnPreview.map((period) => <li key={period.startDate}>{period.name}{period.isCurrent ? ' · current period remains open' : ' · closed skipped period'}</li>)}
                    </ul>
                  </>
                )}
              </div>
            )}
            <p className="text-xs text-[var(--color-text-secondary)]">After this, use Accounts → Reconciliation and select “I am returning after an untracked period” to record your actual balances.</p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setIsReturnModalOpen(false)}>Cancel</Button>
              <Button onClick={createReturnBackfill} isLoading={isSubmitting} disabled={returnPreview.length === 0 || !!returnError}>Create skipped periods</Button>
            </div>
          </div>
        </Modal>
        <Modal
          isOpen={isModalOpen}
          onClose={closeModal}
          title={editingPeriod ? 'Edit Period' : 'New Salary Period'}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Period Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., January 2024"
              required
            />

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Start Date"
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                required
              />

              <Input
                label="End Date"
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                required
              />
            </div>

            {formError && (
              <p className="text-sm text-[var(--color-danger)]">{formError}</p>
            )}

            <div className="flex gap-3 pt-4">
              <Button type="submit" isLoading={isSubmitting} className="flex-1">
                {editingPeriod ? 'Save Changes' : 'Create Period'}
              </Button>
              <Button type="button" variant="secondary" onClick={closeModal}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      </PageContainer>
    </RequireAuth>
  );
}
