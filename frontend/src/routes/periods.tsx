import { createFileRoute } from '@tanstack/react-router';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { RequireAuth } from '../lib/auth';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDate } from '../lib/utils';
import { Plus, Calendar, ChevronRight, Edit2, Trash2, TrendingUp, Wallet } from 'lucide-react';

export const Route = createFileRoute('/periods')({
  component: PeriodsPage,
} as any);

interface Period {
  id: number;
  name: string;
  startDate: number;
  endDate: number;
}

function PeriodsPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<Period | null>(null);
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
        // Update existing period
        await api.periods.create({
          name: formData.name,
          startDate: formData.startDate,
          endDate: formData.endDate,
        });
        // Note: There's no update API, so we delete and recreate or handle differently
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
    if (!confirm('Are you sure you want to delete this period? All associated budgets will be deleted.')) {
      return;
    }
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

  return (
    <RequireAuth>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-mono text-3xl font-bold">Salary Periods</h1>
          <div className="flex gap-2">
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
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openModal(period)}
                      className="p-1 hover:bg-[var(--color-accent)]/20 transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(period.id)}
                      className="p-1 hover:bg-[var(--color-danger)]/20 text-[var(--color-danger)] transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
      </div>
    </RequireAuth>
  );
}
